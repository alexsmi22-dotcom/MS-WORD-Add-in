// VFX & compositing, time: retimes and speed ramps (a time-warp curve through cubic Hermite segments), and a shot's
// frame range with handles, file-name padding and audio sync. Pure functions; the pane glue is vfxCalcs.ts and the
// figures vfxCharts.ts.
//
// CONVENTIONS (stated in every result by the pane glue):
//   - A frame is an INTERVAL. Source frame n covers source time [n, n + 1); output frame k shows the source position
//     S(k), so a 48-frame shot at 40 % runs 48/0.4 = 120 output frames and its last few positions fall inside the
//     last source frame's interval (between it and a frame that does not exist): they hold it, or need a tail handle.
//   - Every interpolation is a cubic Hermite segment (value and slope at both ends): "linear" uses the secant slope
//     on both ends (a straight line), "ease" uses zero slopes (ease-in/ease-out, the smoothstep shape), and "hermite"
//     uses the monotone Fritsch–Carlson slopes of scipy.interpolate.PchipInterpolator (no overshoot between keys).
//     Outside the keys the end value is held. Integrals are closed form (a speed ramp's source position is the integral
//     of its speed).
//   - Audio samples per frame are exact rationals; a non-integer count is distributed by rounding the CUMULATIVE count
//     to the nearest sample at each frame boundary, which at 48 kHz and 30000/1001 fps gives SMPTE ST 299-1's
//     five-frame sequence 1602, 1601, 1602, 1601, 1602 (8008 samples).

import { rat, ratCmp, ratDiv, ratFromText, ratMul, ratToDecimal, ratToNumber, type Rational } from "./timecode";

export type Interp = "linear" | "ease" | "hermite";

export interface Err {
  ok: false;
  error: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Frame rates: any positive rate, the 1000/1001 family snapped to its exact rational.
// ---------------------------------------------------------------------------------------------------------------

export interface Rate {
  fps: Rational;
  value: number;
  /** "24", "24000/1001 (23.976)". */
  label: string;
  /** Set when a decimal was snapped to a 1000/1001 rational. */
  snap: string | null;
}

const NTSC_BASES = [24, 30, 48, 60, 120];

/** Reads "24", "23.976", "29.97 fps", "30000/1001". Refuses zero, negative and non-finite rates by name. */
export function readRate(text: string): Rate | Err {
  const raw = (text ?? "").trim();
  if (!raw) return { ok: false, error: "Frame rate: this field is required." };
  const t = raw.replace(/\s*(fps|frames\/s|frames per second|hz|p)\s*$/i, "").replace(/[−–]/g, "-").replace(/^(\d+),(\d+)$/, "$1.$2").trim();
  if (/^[-+]?(inf|infinity|nan)$/i.test(t)) return { ok: false, error: `Frame rate: "${raw}" is not a finite number.` };
  const r = ratFromText(t);
  if (!r) return { ok: false, error: `Frame rate: "${raw}" is not a number (write 24, 23.976 or 30000/1001).` };
  if (r.num <= 0n) return { ok: false, error: `Frame rate: ${raw} fps is not a rate; a frame rate must be greater than zero.` };
  const x = ratToNumber(r);
  if (!Number.isFinite(x) || x > 10000) return { ok: false, error: `Frame rate: ${raw} fps is outside 0 to 10 000 fps.` };
  for (const n of NTSC_BASES) {
    const exact = rat(n * 1000, 1001);
    if (ratCmp(r, exact) === 0) return { fps: exact, value: ratToNumber(exact), label: `${n * 1000}/1001 (${ratToDecimal(exact, 3).text})`, snap: null };
    if (Math.abs(x - (n * 1000) / 1001) <= 0.005) {
      return {
        fps: exact,
        value: ratToNumber(exact),
        label: `${n * 1000}/1001 (${ratToDecimal(exact, 3).text})`,
        snap: `${raw} fps is taken as exactly ${n * 1000}/1001 fps, the 1000/1001 rate it names.`,
      };
    }
  }
  return { fps: r, value: x, label: ratToDecimal(r, 6).text, snap: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Cubic Hermite curves through keys
// ---------------------------------------------------------------------------------------------------------------

export interface Seg {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  m0: number;
  m1: number;
}

export interface Curve {
  keys: Array<[number, number]>;
  segs: Seg[];
}

const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** The PCHIP knot slopes, exactly scipy.interpolate.PchipInterpolator's (_find_derivatives and _edge_case). */
export function pchipSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const h = xs.slice(1).map((x, i) => x - xs[i]);
  const d = ys.slice(1).map((y, i) => (y - ys[i]) / h[i]);
  if (n === 2) return [d[0], d[0]];
  const m = new Array<number>(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    if (sign(d[k - 1]) !== sign(d[k]) || d[k - 1] === 0 || d[k] === 0) m[k] = 0;
    else {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
    }
  }
  const edge = (h0: number, h1: number, d0: number, d1: number): number => {
    let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (sign(v) !== sign(d0)) v = 0;
    else if (sign(d0) !== sign(d1) && Math.abs(v) > Math.abs(3 * d0)) v = 3 * d0;
    return v;
  };
  m[0] = edge(h[0], h[1], d[0], d[1]);
  m[n - 1] = edge(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  return m;
}

/** A curve through the keys (sorted, strictly increasing x). One key is a constant. */
export function makeCurve(keys: Array<[number, number]>, interp: Interp): Curve {
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const segs: Seg[] = [];
  const pm = interp === "hermite" && keys.length >= 2 ? pchipSlopes(xs, ys) : [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const sec = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    const m0 = interp === "linear" ? sec : interp === "ease" ? 0 : pm[i];
    const m1 = interp === "linear" ? sec : interp === "ease" ? 0 : pm[i + 1];
    segs.push({ x0: xs[i], x1: xs[i + 1], y0: ys[i], y1: ys[i + 1], m0, m1 });
  }
  return { keys, segs };
}

function segAt(c: Curve, x: number): Seg | null {
  if (!c.segs.length) return null;
  let lo = 0;
  let hi = c.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.segs[mid].x0 <= x) lo = mid;
    else hi = mid - 1;
  }
  return c.segs[lo];
}

/** The curve's value; the end value is held outside the keys. */
export function curveValue(c: Curve, x: number): number {
  const first = c.keys[0];
  const last = c.keys[c.keys.length - 1];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  const s = segAt(c, x) as Seg;
  const h = s.x1 - s.x0;
  const u = (x - s.x0) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * s.y0 + (u3 - 2 * u2 + u) * h * s.m0 + (-2 * u3 + 3 * u2) * s.y1 + (u3 - u2) * h * s.m1;
}

/** The curve's slope dy/dx (0 outside the keys, where the value is held). */
export function curveSlope(c: Curve, x: number): number {
  const first = c.keys[0];
  const last = c.keys[c.keys.length - 1];
  if (x < first[0] || x > last[0] || c.segs.length === 0) return 0;
  const s = segAt(c, Math.min(x, last[0] - 1e-12)) as Seg;
  const h = s.x1 - s.x0;
  const u = (x - s.x0) / h;
  const u2 = u * u;
  return ((6 * u2 - 6 * u) * s.y0 + (3 * u2 - 4 * u + 1) * h * s.m0 + (-6 * u2 + 6 * u) * s.y1 + (3 * u2 - 2 * u) * h * s.m1) / h;
}

/** ∫ from x0 to x of one segment, x inside it. */
function segIntegral(s: Seg, x: number): number {
  const h = s.x1 - s.x0;
  const u = (x - s.x0) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  return h * ((u4 / 2 - u3 + u) * s.y0 + (u4 / 4 - (2 * u3) / 3 + u2 / 2) * h * s.m0 + (-u4 / 2 + u3) * s.y1 + (u4 / 4 - u3 / 3) * h * s.m1);
}

/** ∫ from a to b of the curve (end values held outside the keys), closed form. */
export function curveIntegral(c: Curve, a: number, b: number): number {
  if (b < a) return -curveIntegral(c, b, a);
  const first = c.keys[0];
  const last = c.keys[c.keys.length - 1];
  let total = 0;
  // Before the first key.
  if (a < first[0]) {
    const e = Math.min(b, first[0]);
    total += first[1] * (e - a);
    a = e;
    if (a >= b) return total;
  }
  // Inside the keys.
  for (const s of c.segs) {
    if (b <= s.x0) break;
    if (a >= s.x1) continue;
    const lo = Math.max(a, s.x0);
    const hi = Math.min(b, s.x1);
    total += segIntegral(s, hi) - segIntegral(s, lo);
  }
  // After the last key.
  if (b > last[0]) total += last[1] * (b - Math.max(a, last[0]));
  return total;
}

// ---------------------------------------------------------------------------------------------------------------
// Retime
// ---------------------------------------------------------------------------------------------------------------

export type RetimeMode = "constant" | "ramp" | "map";

export type FrameStatus = "on" | "repeat" | "between" | "outside";

export interface RetimeFrame {
  /** Output frame number. */
  out: number;
  /** Source position (frames, fractional). */
  src: number;
  /** Speed at this frame, % (source frames per output frame × 100). */
  speed: number;
  status: FrameStatus;
}

export interface RetimeResult {
  ok: true;
  mode: RetimeMode;
  interp: Interp;
  first: number;
  last: number;
  nSrc: number;
  outFirst: number;
  frames: RetimeFrame[];
  nOut: number;
  /** Seconds at the frame rate. */
  durationIn: number;
  durationOut: number;
  counts: { on: number; repeat: number; between: number; outside: number };
  /** Source frames inside the shown range that a nearest-frame retime never shows. */
  dropped: number[];
  speedMin: number;
  speedMax: number;
  /** Constant mode only: the exact speed. */
  constant: number | null;
  /** The output count was not a whole number (constant mode): nSrc/|s| was rounded up. */
  fractionalCount: number | null;
  curve: Curve | null;
  /** Shutter angle as shot, and the effective angle after the retime at the min and max |speed| (null where 0 %). */
  shutter: number;
  effMin: number | null;
  effMax: number | null;
  /** Any frame at 0 % (a freeze), where the effective shutter is unbounded. */
  freezes: boolean;
}

export const MAX_OUTPUT_FRAMES = 20000;
const ON_TOL = 1e-6;

export interface RetimeInput {
  mode: RetimeMode;
  interp: Interp;
  first: number;
  last: number;
  outFirst: number;
  /** Constant speed in percent (negative = reverse). */
  speed: number;
  /** Ramp: [output frame, speed %]; map: [output frame, source frame]. */
  keys: Array<[number, number]>;
  fps: number;
  shutter: number;
}

export function retime(inp: RetimeInput): RetimeResult | Err {
  const { first, last, outFirst, fps, shutter } = inp;
  for (const [v, name] of [[first, "First source frame"], [last, "Last source frame"], [outFirst, "First output frame"]] as Array<[number, string]>) {
    if (!Number.isFinite(v)) return { ok: false, error: `${name}: not a finite number.` };
    if (!Number.isInteger(v)) return { ok: false, error: `${name}: ${v} is not a whole frame number.` };
  }
  if (last < first) return { ok: false, error: `The last source frame (${last}) is before the first (${first}).` };
  if (!(fps > 0) || !Number.isFinite(fps)) return { ok: false, error: "Frame rate: must be a finite number greater than zero." };
  if (!Number.isFinite(shutter) || shutter <= 0 || shutter > 360) return { ok: false, error: `Shutter angle: ${shutter}° is outside (0°, 360°].` };
  const nSrc = last - first + 1;
  const pos: number[] = [];
  const spd: number[] = [];
  let curve: Curve | null = null;
  let constant: number | null = null;
  let fractionalCount: number | null = null;

  if (inp.mode === "constant") {
    const s = inp.speed;
    if (!Number.isFinite(s)) return { ok: false, error: "Speed: not a finite number." };
    if (s === 0) return { ok: false, error: "Speed: 0 % is a freeze frame and never reaches the end of the shot. To hold a frame, use the source-frame map mode with two keys on the same source frame." };
    const f = s / 100;
    const exactCount = nSrc / Math.abs(f);
    const n = Math.ceil(exactCount - 1e-9);
    if (n > MAX_OUTPUT_FRAMES) return { ok: false, error: `At ${s} % the ${nSrc}-frame shot would run ${Math.ceil(exactCount)} output frames, above the ${MAX_OUTPUT_FRAMES} this tool lists.` };
    if (Math.abs(exactCount - Math.round(exactCount)) > 1e-9) fractionalCount = exactCount;
    const start = f > 0 ? first : last;
    for (let k = 0; k < n; k++) {
      pos.push(start + f * k);
      spd.push(s);
    }
    constant = s;
  } else {
    const keys = inp.keys;
    if (!keys.length) return { ok: false, error: inp.mode === "ramp" ? "Speed keys: give at least one row of output frame, speed %." : "Frame map: give at least two rows of output frame, source frame." };
    for (let i = 0; i < keys.length; i++) {
      if (!keys.every((k) => Number.isFinite(k[0]) && Number.isFinite(k[1]))) return { ok: false, error: "Keys: every value must be a finite number." };
      if (i > 0 && keys[i][0] <= keys[i - 1][0]) return { ok: false, error: `Keys: output frames must increase down the list (row ${i + 1}, frame ${keys[i][0]}, is not after ${keys[i - 1][0]}).` };
    }
    curve = makeCurve(keys, inp.interp);
    if (inp.mode === "ramp") {
      // Source position = first + ∫ speed/100 from the first output frame; the output runs until the source is used up.
      const endSpeed = keys[keys.length - 1][1];
      let k = 0;
      for (;;) {
        const o = outFirst + k;
        const p = first + curveIntegral(curve, outFirst, o) / 100;
        if (p >= first + nSrc - 1e-9) break;
        if (p < first - 1e-9) return { ok: false, error: `The ramp runs backwards off the head of the shot (source position ${p.toFixed(2)} at output frame ${o}, before frame ${first}). Keep the speed positive early on, or start later in the source.` };
        if (k >= MAX_OUTPUT_FRAMES) {
          return {
            ok: false,
            error: endSpeed <= 0
              ? `The ramp ends at ${endSpeed} % after its last key, so it never reaches the end of the shot. End on a positive speed.`
              : `The ramp would run more than ${MAX_OUTPUT_FRAMES} output frames before using up the ${nSrc} source frames.`,
          };
        }
        pos.push(p);
        spd.push(curveValue(curve, o));
        k++;
      }
      if (!pos.length) return { ok: false, error: "The ramp produces no output frames." };
    } else {
      if (keys.length < 2) return { ok: false, error: "Frame map: give at least two rows of output frame, source frame (one key is a freeze of unknown length)." };
      const o0 = keys[0][0];
      const o1 = keys[keys.length - 1][0];
      if (!Number.isInteger(o0) || !Number.isInteger(o1)) return { ok: false, error: "Frame map: the first and last output frames must be whole frame numbers." };
      if (o1 - o0 + 1 > MAX_OUTPUT_FRAMES) return { ok: false, error: `Frame map: ${o1 - o0 + 1} output frames is above the ${MAX_OUTPUT_FRAMES} this tool lists.` };
      for (let o = o0; o <= o1; o++) {
        pos.push(curveValue(curve, o));
        spd.push(curveSlope(curve, o) * 100);
      }
    }
  }

  const oStart = inp.mode === "map" ? inp.keys[0][0] : outFirst;
  const frames: RetimeFrame[] = [];
  const counts = { on: 0, repeat: 0, between: 0, outside: 0 };
  let prevOn: number | null = null;
  const shown = new Set<number>();
  for (let i = 0; i < pos.length; i++) {
    const p = Math.abs(pos[i] - Math.round(pos[i])) < ON_TOL ? Math.round(pos[i]) : pos[i];
    let status: FrameStatus;
    if (p < first - ON_TOL || p > last + ON_TOL) status = "outside";
    else if (Number.isInteger(p)) status = prevOn === p ? "repeat" : "on";
    else status = "between";
    prevOn = Number.isInteger(p) ? p : null;
    counts[status]++;
    if (status !== "outside") shown.add(Math.min(last, Math.max(first, Math.round(p))));
    frames.push({ out: oStart + i, src: p, speed: spd[i], status });
  }
  const used = [...shown].sort((a, b) => a - b);
  const dropped: number[] = [];
  if (used.length) for (let f = used[0]; f <= used[used.length - 1]; f++) if (!shown.has(f)) dropped.push(f);
  const abs = spd.map(Math.abs);
  const nonzero = abs.filter((v) => v > 1e-9);
  const sMin = Math.min(...spd);
  const sMax = Math.max(...spd);
  const effMin = nonzero.length ? shutter / (Math.max(...nonzero) / 100) : null;
  const effMax = nonzero.length ? shutter / (Math.min(...nonzero) / 100) : null;
  return {
    ok: true,
    mode: inp.mode,
    interp: inp.interp,
    first,
    last,
    nSrc,
    outFirst: oStart,
    frames,
    nOut: frames.length,
    durationIn: nSrc / fps,
    durationOut: frames.length / fps,
    counts,
    dropped,
    speedMin: sMin,
    speedMax: sMax,
    constant,
    fractionalCount,
    curve,
    shutter,
    effMin,
    effMax,
    freezes: abs.some((v) => v <= 1e-9),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Shot frame range, padding and audio
// ---------------------------------------------------------------------------------------------------------------

export interface FrameRangeInput {
  cutIn: number;
  cutOut: number;
  head: number;
  tail: number;
  start: number;
  pad: number;
}

export interface FrameRangeResult {
  ok: true;
  cutLength: number;
  total: number;
  /** Plate frames (file numbers). */
  plateFirst: number;
  plateLast: number;
  /** The cut inside the plate. */
  cutFirst: number;
  cutLast: number;
  /** plate frame = editorial frame + offset. */
  offset: number;
  /** Digits the last frame needs. */
  digits: number;
}

export function frameRange(inp: FrameRangeInput): FrameRangeResult | Err {
  const names: Array<[number, string]> = [[inp.cutIn, "Cut in"], [inp.cutOut, "Cut out"], [inp.head, "Head handle"], [inp.tail, "Tail handle"], [inp.start, "Plate start frame"], [inp.pad, "Padding"]];
  for (const [v, n] of names) {
    if (!Number.isFinite(v)) return { ok: false, error: `${n}: not a finite number.` };
    if (!Number.isInteger(v)) return { ok: false, error: `${n}: ${v} is not a whole number of frames.` };
  }
  if (inp.cutOut < inp.cutIn) return { ok: false, error: `Cut out (${inp.cutOut}) is before cut in (${inp.cutIn}).` };
  if (inp.head < 0 || inp.tail < 0) return { ok: false, error: "Handles: a handle is a count of extra frames and cannot be negative." };
  if (inp.start < 0) return { ok: false, error: `Plate start frame: ${inp.start} is negative. A negative frame number is written with a minus sign (-001) that sorts before frame 0 and breaks %0Nd padding; start at 0, 1 or the 1001 convention.` };
  if (inp.pad < 1 || inp.pad > 10) return { ok: false, error: `Padding: ${inp.pad} digits is outside 1 to 10.` };
  const cutLength = inp.cutOut - inp.cutIn + 1;
  const total = cutLength + inp.head + inp.tail;
  const plateFirst = inp.start;
  const plateLast = inp.start + total - 1;
  const digits = String(plateLast).length;
  if (digits > inp.pad) {
    return {
      ok: false,
      error: `Padding overflow: the plate runs to frame ${plateLast}, which needs ${digits} digits, and a ${inp.pad}-digit pad holds at most ${"9".repeat(inp.pad)}. %0${inp.pad}d would write ${plateLast} with ${digits} digits, so the files no longer sort or match a ${"#".repeat(inp.pad)} pattern. Use a ${digits}-digit pad (or more).`,
    };
  }
  return {
    ok: true,
    cutLength,
    total,
    plateFirst,
    plateLast,
    cutFirst: plateFirst + inp.head,
    cutLast: plateFirst + inp.head + cutLength - 1,
    offset: plateFirst + inp.head - inp.cutIn,
    digits,
  };
}

/** A frame number zero-padded to `pad` digits. */
export const padFrame = (n: number, pad: number): string => String(n).padStart(pad, "0");

export interface AudioCadence {
  /** Samples per frame, exact. */
  perFrame: Rational;
  perFrameValue: number;
  /** Frames in one repeating cycle (the denominator of samples per frame). */
  cycle: number;
  /** Samples in each frame of one cycle (round-to-nearest of the cumulative count). */
  sequence: number[];
  cycleSamples: number;
}

/** Samples per frame at a sample rate and frame rate, and the per-frame sequence over one cycle (cycle ≤ 1001). */
export function audioCadence(sampleRate: number, fps: Rational): AudioCadence | Err {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) return { ok: false, error: "Sample rate: must be a whole number of samples per second." };
  const per = ratDiv(rat(sampleRate), fps);
  const cycle = Number(per.den);
  if (cycle > 1001) return { ok: false, error: `At this frame rate the sample count repeats only every ${cycle} frames; give a standard rate.` };
  const seq: number[] = [];
  let prev = 0n;
  for (let k = 1; k <= cycle; k++) {
    // round(k·num/den), halves up: floor((2·k·num + den) / (2·den)).
    const cum = (2n * BigInt(k) * per.num + per.den) / (2n * per.den);
    seq.push(Number(cum - prev));
    prev = cum;
  }
  return { perFrame: per, perFrameValue: ratToNumber(per), cycle, sequence: seq, cycleSamples: Number(prev) };
}

export type OffsetUnit = "frames" | "samples" | "ms";

export interface SyncOffset {
  frames: number;
  samples: number;
  ms: number;
  /** True when the samples are a whole number. */
  wholeSamples: boolean;
}

/** An audio sync offset in frames ↔ samples ↔ milliseconds. */
export function syncOffset(value: number, unit: OffsetUnit, sampleRate: number, fps: Rational): SyncOffset | Err {
  if (!Number.isFinite(value)) return { ok: false, error: "Sync offset: not a finite number." };
  const f = ratToNumber(fps);
  const perFrame = sampleRate / f;
  let frames: number;
  if (unit === "frames") frames = value;
  else if (unit === "samples") frames = value / perFrame;
  else frames = (value / 1000) * f;
  // Exact samples where the input is a whole number of frames.
  const samples = unit === "samples" ? value : unit === "frames" && Number.isInteger(value) ? ratToNumber(ratMul(rat(sampleRate), ratDiv(rat(value), fps))) : frames * perFrame;
  return { frames, samples, ms: (frames / f) * 1000, wholeSamples: Math.abs(samples - Math.round(samples)) < 1e-9 };
}
