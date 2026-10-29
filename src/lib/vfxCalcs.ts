// Pane glue for the VFX & compositing calculators: retime and speed ramps, shot frame ranges with handles, padding and
// audio sync, camera match (filmback, focal length, field of view, anamorphic, fit), projection and parallax, 3D
// transforms, surface normals and shading, camera log ↔ scene linear, compositing math, chroma key, miniature and
// simulation scale, and rigid-body collision. Kept OUT of taskpane.ts; the integrator spreads VFX_CALCS into ENG_CALCS
// (group "VFX & compositing").
//
// No number is computed here: vfxTime.ts, vfxCamera.ts, vfxGeometry.ts, vfxColour.ts and vfxSim.ts own them. This file
// reads the fields (dimensional ones through units.ts parseMeasured), words the result under the display contract
// (U+2212, ×10ⁿ, no em dash, NaN or Infinity in an ok result), opens every result with a plain-language reading built
// from the computed numbers, and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { refuseNonFinite } from "./finiteResult";
import { audioCadence, frameRange, padFrame, readRate, retime, syncOffset, type Interp, type OffsetUnit, type RetimeMode } from "./vfxTime";
import { retimeSpeedSvg, retimeWarpSvg, timelineSvg, BLUE, GREY, ORANGE, RED, GREEN } from "./vfxCharts";
import { axesSvg, bounceSvg, cbcrSvg, compositeSvg, fovWedgesSvg, froudeSvg, logCurveSvg, parallaxTopSvg, shadingSvg } from "./vfxFigures";
import { cameraMatch, ORDERS, projection, SENSOR_PRESETS, type FitMode, type FovAxis, type Order, type Vec3 } from "./vfxCamera";
import { shading, transform, type GreenConvention, type NormalEncoding, type UpConvert } from "./vfxGeometry";
import { chromaKey, composite, LOG_CURVES, logConvert, logCurve, type BlendMode, type KeyMetric, type LogInputKind, type PorterDuff, type RGBA, type SpillVariant, type YcbcrMatrix } from "./vfxColour";
import { cfl, drop, froudeScale, G0, impact, SCENE_UNITS } from "./vfxSim";

export type VfxCalc = EngCalcDef<"VFX & compositing">;

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (35 mm, 1.4 in, 2 cm) and it is " +
  "converted for you, and a unit of the wrong quantity is refused rather than silently ignored.";

export const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Six significant figures, trailing zeros kept, ×10ⁿ outside 10⁻³…10⁵, U+2212. */
export const n6 = (v: number): string => fmtSig(v, 6);
/** Significant figures with trailing zeros dropped: "0.4", "1048.6", "−12.5". */
export const t = (v: number, s = 6): string => {
  if (Object.is(v, -0) || Math.abs(v) < 1e-12) return "0";
  return fmtSig(v, s).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
};
/** Fixed decimals with trailing zeros dropped, U+2212. */
export const d = (v: number, places = 4): string => {
  const s = Number(v.toFixed(places));
  return trueMinus(String(Object.is(s, -0) ? 0 : s));
};

/**
 * Unit-aware field reading: errors collected, conversions reported (the laserCalcs.ts pattern).
 */
export function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (m.unit.replace(/\s+/g, "") === si) return m.value;
    if (!m.assumed && Math.abs(m.inTarget / m.value - 1) > 1e-12) conversions.push(`${label}: ${t(m.value)} ${formatUnit(m.unit)} = ${t(m.inTarget)} ${shown}`);
    return m.inTarget;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    opt: (key: string, si: string, shown: string, label: string): number | null => read(key, si, shown, label, false),
  };
}

/** A plain number (no unit): NaN when blank or unreadable. "inf"/"NaN" are not numbers here. */
export function plain(v: string | undefined): number {
  const s = (v ?? "").trim().replace(/[−–]/g, "-").replace(/\s*%$/, "").replace(/\s*°$/, "");
  return s !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? Number(s) : NaN;
}

/** A required plain number, or the refusal naming the field. */
export function num(r: (k: string) => string, key: string, label: string): number | string {
  const raw = (r(key) ?? "").trim();
  if (!raw) return `${label}: this field is required.`;
  const v = plain(raw);
  if (!Number.isFinite(v)) return `${label}: "${raw}" is not a finite number.`;
  return v;
}

/** Numbers separated by commas, spaces, tabs or semicolons ("1, 2, 3", "1 2 3"). */
export function numList(raw: string, label: string, count?: number): number[] | string {
  const s = (raw ?? "").trim();
  if (!s) return `${label}: this field is required.`;
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  const vals = parts.map(plain);
  const bad = parts.find((p, i) => !Number.isFinite(vals[i]));
  if (bad !== undefined) return `${label}: "${bad}" is not a finite number.`;
  if (count !== undefined && vals.length !== count) return `${label}: give ${count} numbers (found ${vals.length}).`;
  return vals;
}

/** Rows of number pairs, one per line. */
export function pairRows(raw: string, label: string): Array<[number, number]> | string {
  const rows = (raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return `${label}: give at least one row.`;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < rows.length; i++) {
    const v = numList(rows[i], `${label}, row ${i + 1}`, 2);
    if (typeof v === "string") return v;
    out.push([v[0], v[1]]);
  }
  return out;
}

export const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 304);
  return { kind: "plot", svg, caption, alt, w, h };
};

export const table = (label: string, rows: string[][]): AnalyzeBlock => ({ kind: "table", label, rows: rows.map((row) => row.map((c) => trueMinus(c))) });

export function finish(lines: EngLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[], unitNote = true): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  if (unitNote) lines.push(UNIT_NOTE);
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l) : { math: l.math, fallback: trueMinus(l.fallback) }));
  return refuseNonFinite({ ...engReport(clean, extra), outputs });
}

const plural = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;
/** "a, b and c". */
const andList = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ---------------------------------------------------------------------------------------------------------------
// 1. Retime and speed ramp
// ---------------------------------------------------------------------------------------------------------------

const RETIME_MODES = [
  { value: "constant", label: "Constant speed" },
  { value: "ramp", label: "Speed ramp (keys of output frame, speed %)" },
  { value: "map", label: "Frame map (keys of output frame, source frame)" },
];
const INTERP_OPTIONS = [
  { value: "linear", label: "Linear" },
  { value: "ease", label: "Ease in/out (flat at each key)" },
  { value: "hermite", label: "Cubic Hermite, monotone (PCHIP)" },
];

const INTERP_WORDS: Record<Interp, string> = { linear: "linear", ease: "ease in/out (flat at each key)", hermite: "monotone cubic Hermite (PCHIP)" };

const STATUS_WORDS: Record<string, string> = {
  on: "on a source frame",
  repeat: "repeats the previous frame",
  between: "between frames: blend or optical flow",
  outside: "past the source: hold or handle",
};

const retimeCalc: VfxCalc = {
  id: "vfx-retime",
  name: "Retime & speed ramp (time warp)",
  group: "VFX & compositing",
  unitContract: "domain",
  hint:
    "A source frame range retimed at a constant speed, by a keyed speed ramp, or by a map of source frame at output " +
    "frame (a TimeWarp curve), with linear, ease or monotone cubic Hermite interpolation between keys. Lists the source " +
    "frame behind every output frame, which land between frames (frame blending or optical flow), repeat or drop, and " +
    "what the retime does to the shot's motion blur. Negative speeds play backwards. Timecode is under Video & display.",
  fields: [
    { key: "first", label: "First source frame", default: "1001", kind: "text" },
    { key: "last", label: "Last source frame", default: "1048", kind: "text" },
    { key: "fps", label: "Frame rate (fps; 23.976 snaps to 24000/1001)", default: "24", kind: "text" },
    { key: "mode", label: "Retime by", default: "constant", kind: "select", options: RETIME_MODES },
    { key: "speed", label: "Constant speed (%; negative plays backwards)", default: "40", kind: "text" },
    { key: "outFirst", label: "First output frame", default: "1001", kind: "text" },
    { key: "ramp", label: "Speed ramp keys: output frame, speed % (one per line)", default: "1001, 100\n1013, 25\n1060, 25\n1075, 100", kind: "block", rows: 4 },
    { key: "map", label: "Frame map keys: output frame, source frame (one per line)", default: "1001, 1001\n1030, 1010\n1060, 1048", kind: "block", rows: 4 },
    { key: "interp", label: "Interpolation between keys", default: "linear", kind: "select", options: INTERP_OPTIONS },
    { key: "shutter", label: "Shutter angle as shot (degrees)", default: "180", kind: "text" },
  ],
  compute: (r) => {
    const mode = (["constant", "ramp", "map"].includes(r("mode")) ? r("mode") : "constant") as RetimeMode;
    const interp = (["linear", "ease", "hermite"].includes(r("interp")) ? r("interp") : "linear") as Interp;
    const first = num(r, "first", "First source frame");
    if (typeof first === "string") return refuse(first);
    const last = num(r, "last", "Last source frame");
    if (typeof last === "string") return refuse(last);
    const outFirst = num(r, "outFirst", "First output frame");
    if (typeof outFirst === "string") return refuse(outFirst);
    const rate = readRate(r("fps"));
    if ("error" in rate) return refuse(rate.error);
    const shutter = num(r, "shutter", "Shutter angle");
    if (typeof shutter === "string") return refuse(shutter);
    let speed = 100;
    let keys: Array<[number, number]> = [];
    if (mode === "constant") {
      const s = num(r, "speed", "Speed");
      if (typeof s === "string") return refuse(s);
      speed = s;
    } else {
      const k = pairRows(r(mode === "ramp" ? "ramp" : "map"), mode === "ramp" ? "Speed ramp keys" : "Frame map keys");
      if (typeof k === "string") return refuse(k);
      keys = k;
    }
    const res = retime({ mode, interp, first, last, outFirst, speed, keys, fps: rate.value, shutter });
    if (!res.ok) return refuse(res.error);
    const c = res.counts;
    const lines: EngLine[] = [];
    // The reading, from this run's numbers.
    const what = res.constant !== null ? `At ${t(res.constant)} % speed the ${res.nSrc}-frame shot` : mode === "ramp" ? `With this speed ramp the ${res.nSrc}-frame shot` : `This frame map`;
    const becomes = `${what} ${mode === "map" ? "runs" : "becomes"} ${plural(res.nOut, "frame")} (${t(res.durationOut, 4)} s at ${t(rate.value, 5)} fps)`;
    const issues: string[] = [];
    if (c.between) issues.push(`${c.between === res.nOut ? "every output frame falls" : `${c.between} fall`} between source frames, so frame blending or optical flow is needed`);
    if (c.repeat) issues.push(`${c.repeat} repeat${c.repeat === 1 ? "s" : ""} the frame before`);
    if (res.dropped.length) issues.push(`${plural(res.dropped.length, "source frame")} ${res.dropped.length === 1 ? "is" : "are"} never shown`);
    if (c.outside) issues.push(`${plural(c.outside, "frame")} ${c.outside === 1 ? "samples" : "sample"} past the ends of the source (hold the end frame, or add a handle)`);
    lines.push(issues.length ? `${becomes}; ${andList(issues)}.` : `${becomes}; every output frame lands on a whole source frame, so a plain frame retime is clean.`);
    if (rate.snap) lines.push(rate.snap);
    if (res.constant !== null) {
      lines.push({ math: "S(k) = S_0 + s k", fallback: "S(k) = S₀ + s·k" });
      lines.push("S(k) is the source position of output frame k and s = speed/100.");
      lines.push({ math: "N_out = N_src/abs(s)", fallback: "N(out) = N(src)/|s|" });
      if (res.fractionalCount !== null) lines.push(`${res.nSrc}/${t(Math.abs(res.constant) / 100)} = ${t(res.fractionalCount)} is not a whole number of frames: the count is rounded up to ${res.nOut}, and the last output frame covers only part of a frame's worth of source.`);
    } else if (mode === "ramp") {
      lines.push({ math: "S(k) = S_0 + 1/100 int(k_0, k, v(tau) d tau)", fallback: "S(k) = S₀ + (1/100)·∫ₖ₀ᵏ v(τ) dτ" });
      lines.push("The source position is the integral of the speed v (in %) from the first output frame k₀.");
      lines.push(`Speed between keys: ${INTERP_WORDS[interp]}; the last key's speed is held until the ${res.nSrc} source frames are used up.`);
    } else {
      lines.push({ math: "v(k) = 100 (d S)/(d k)", fallback: "v(k) = 100·dS/dk" });
      lines.push("The speed is the slope of the frame map.");
      lines.push(`Source frame between keys: ${INTERP_WORDS[interp]}.`);
    }
    lines.push(`Source ${res.first} to ${res.last} (${res.nSrc} frames, ${t(res.durationIn, 4)} s) → output ${res.outFirst} to ${res.outFirst + res.nOut - 1} (${res.nOut} frames, ${t(res.durationOut, 4)} s). ${res.speedMin === res.speedMax ? `Speed ${t(res.speedMin, 4)} %.` : `Speed ranges ${t(res.speedMin, 4)} % to ${t(res.speedMax, 4)} %.`}`);
    lines.push(`Output frames: ${c.on} on a whole source frame, ${c.repeat} repeating the frame before, ${c.between} between frames, ${c.outside} past the source.${res.dropped.length ? ` Source frames never shown by a nearest-frame retime: ${res.dropped.length > 12 ? `${res.dropped.slice(0, 12).join(", ")} and ${res.dropped.length - 12} more` : res.dropped.join(", ")}.` : ""}`);
    // Motion blur.
    lines.push({ math: "theta_eff = theta/abs(s)", fallback: "θ(eff) = θ/|s|" });
    if (res.effMin !== null && res.effMax !== null) {
      const range = Math.abs(res.effMax - res.effMin) < 1e-9 ? `${t(res.effMax, 4)}°` : `${t(res.effMin, 4)}° to ${t(res.effMax, 4)}°`;
      const verdict = res.effMax > 360
        ? "above 360°, the blur is longer than the motion between output frames, so slowed action looks smeared; it cannot be removed afterwards (shoot at a higher frame rate for slow motion)"
        : res.effMin < 90
          ? "the blur is short for the motion between output frames, so sped-up action strobes; add vector motion blur to match"
          : "close enough to a normal shutter that the retimed motion blur reads naturally";
      lines.push(`Shot at ${t(res.shutter, 4)}°, the retimed shot's motion blur looks like a ${range} shutter: ${verdict}.${res.freezes ? " At 0 % the frame freezes and keeps the blur it was shot with." : ""}`);
    } else lines.push("Every output frame is a freeze (0 %): the frame keeps the blur it was shot with.");
    lines.push("Assumes: frames are intervals (source frame n covers [n, n + 1)), positions are not wrapped, and 'between frames' means the position is more than 10⁻⁶ frame from a whole frame. Repeats and drops are counted for a nearest-frame retime (no blending); optical flow can synthesise the in-between frames but not new motion blur.");
    // Table, truncated.
    const rows: string[][] = [["Output frame", "Source frame", "Speed (%)", "Status"]];
    const row = (f: (typeof res.frames)[number]): string[] => [String(f.out), d(f.src, 4), t(f.speed, 4), STATUS_WORDS[f.status]];
    if (res.frames.length <= 40) res.frames.forEach((f) => rows.push(row(f)));
    else {
      res.frames.slice(0, 30).forEach((f) => rows.push(row(f)));
      rows.push([`${res.frames.length - 35} rows not listed`, "", "", ""]);
      res.frames.slice(-5).forEach((f) => rows.push(row(f)));
    }
    const outputs: EngOutput[] = [
      { key: "nOut", label: "Output frames", value: res.nOut, unit: "" },
      { key: "durationOut", label: "Output duration", value: res.durationOut, unit: "s" },
      { key: "between", label: "Frames between source frames", value: c.between, unit: "" },
      { key: "dropped", label: "Source frames never shown", value: res.dropped.length, unit: "" },
    ];
    if (res.effMax !== null) outputs.push({ key: "effShutter", label: "Effective shutter angle (max)", value: res.effMax, unit: "°" });
    return finish(lines, [], [
      table("Source frame behind each output frame", rows),
      plot(retimeWarpSvg(res), "Time warp: the source frame shown at each output frame", "Source frame against output frame for the retime, the 100 percent line for reference, frames that fall between source frames marked"),
      plot(retimeSpeedSvg(res), "Speed of the retime at each output frame", "Retime speed in percent against output frame, with 100 percent marked"),
    ], outputs, false);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Shot frame range, handles, padding and audio sync
// ---------------------------------------------------------------------------------------------------------------

const OFFSET_UNITS = [
  { value: "frames", label: "frames" },
  { value: "samples", label: "samples" },
  { value: "ms", label: "milliseconds" },
];

const frameRangeCalc: VfxCalc = {
  id: "vfx-frame-range",
  name: "Shot frame range, handles, padding & audio sync",
  group: "VFX & compositing",
  unitContract: "domain",
  hint:
    "An editorial cut (in and out frames, inclusive), its head and tail handles and the plate's start frame (the 1001 " +
    "convention) give the plate's frame range, the offset from editorial to plate frames and the file names with " +
    "%04d, #### and $F4 padding; a pad too narrow for the last frame is refused. Audio: the samples in each frame at 48 " +
    "or 96 kHz, with the per-frame sequence when the count is not whole (1602, 1601, 1602, 1601, 1602 at 29.97), and a " +
    "sync offset in frames, samples and milliseconds. Pulldown and shutter are under Frame rates (Video & display).",
  fields: [
    { key: "cutIn", label: "Cut in (editorial frame, inclusive)", default: "101", kind: "text" },
    { key: "cutOut", label: "Cut out (editorial frame, inclusive)", default: "148", kind: "text" },
    { key: "head", label: "Head handle (frames)", default: "8", kind: "text" },
    { key: "tail", label: "Tail handle (frames)", default: "8", kind: "text" },
    { key: "start", label: "Plate start frame (first handle frame)", default: "1001", kind: "text" },
    { key: "pad", label: "Padding (digits)", default: "4", kind: "text" },
    { key: "prefix", label: "File name before the frame number", default: "sh010_comp_v001", kind: "text" },
    { key: "ext", label: "Extension", default: "exr", kind: "text" },
    { key: "fps", label: "Frame rate (fps)", default: "24", kind: "text" },
    { key: "rate", label: "Audio sample rate", default: "48000", kind: "select", options: [{ value: "48000", label: "48 kHz" }, { value: "96000", label: "96 kHz" }] },
    { key: "offset", label: "Audio sync offset (blank for none)", default: "2", kind: "text" },
    { key: "offUnit", label: "Offset is in", default: "frames", kind: "select", options: OFFSET_UNITS },
  ],
  compute: (r) => {
    const vals: Record<string, number> = {};
    for (const [k, label] of [["cutIn", "Cut in"], ["cutOut", "Cut out"], ["head", "Head handle"], ["tail", "Tail handle"], ["start", "Plate start frame"], ["pad", "Padding"]] as const) {
      const v = num(r, k, label);
      if (typeof v === "string") return refuse(v);
      vals[k] = v;
    }
    const prefix = (r("prefix") ?? "").trim();
    const ext = (r("ext") ?? "").trim().replace(/^\./, "");
    if (/[\s/\\]/.test(prefix)) return refuse(`File name: "${prefix}" contains a space or a path separator; give the name only.`);
    if (!/^[A-Za-z0-9]{1,8}$/.test(ext)) return refuse(`Extension: "${ext}" is not a file extension (letters and digits, such as exr or dpx).`);
    const res = frameRange({ cutIn: vals.cutIn, cutOut: vals.cutOut, head: vals.head, tail: vals.tail, start: vals.start, pad: vals.pad });
    if (!res.ok) return refuse(res.error);
    const rate = readRate(r("fps"));
    if ("error" in rate) return refuse(rate.error);
    const sr = Number(r("rate") === "96000" ? 96000 : 48000);
    const cad = audioCadence(sr, rate.fps);
    if ("error" in cad) return refuse(cad.error);
    const offRaw = (r("offset") ?? "").trim();
    const unit = (["frames", "samples", "ms"].includes(r("offUnit")) ? r("offUnit") : "frames") as OffsetUnit;
    let off = null as ReturnType<typeof syncOffset> | null;
    if (offRaw) {
      const v = plain(offRaw);
      if (!Number.isFinite(v)) return refuse(`Audio sync offset: "${offRaw}" is not a finite number.`);
      off = syncOffset(v, unit, sr, rate.fps);
      if ("error" in off) return refuse(off.error);
    }
    const pad = vals.pad;
    const sep = prefix && !/[._-]$/.test(prefix) ? "." : "";
    const name = (n: number): string => `${prefix}${sep}${padFrame(n, pad)}.${ext}`;
    const patterns = [`${prefix}${sep}%0${pad}d.${ext}`, `${prefix}${sep}${"#".repeat(pad)}.${ext}`, `${prefix}${sep}$F${pad}.${ext}`];
    const khz = sr / 1000;
    const whole = cad.cycle === 1;
    const lines: EngLine[] = [];
    const perText = whole ? `exactly ${cad.sequence[0]} samples` : `${t(cad.perFrameValue, 6)} samples on average (${cad.sequence.length <= 10 ? `the ${cad.cycle}-frame sequence ${cad.sequence.join(", ")}` : `a ${cad.cycle}-frame cycle`}, ${cad.cycleSamples} samples in all)`;
    lines.push(
      `The ${res.cutLength}-frame cut with ${vals.head} + ${vals.tail} handle frames is a ${res.total}-frame plate, files ${name(res.plateFirst)} to ${name(res.plateLast)}, and a ${pad}-digit pad holds it. ` +
        `At ${t(rate.value, 5)} fps and ${khz} kHz each frame carries ${perText}${off && !("error" in off) ? `; the ${t(off.frames, 6)}-frame offset is ${t(off.samples, 8)} samples (${t(off.ms, 6)} ms)` : ""}.`,
    );
    if (rate.snap) lines.push(rate.snap);
    lines.push({ math: "N = (t_out - t_in + 1) + h_head + h_tail", fallback: "N = (t(out) − t(in) + 1) + h(head) + h(tail)" });
    lines.push({ math: "f_plate = f_edit + (F_start + h_head - t_in)", fallback: "f(plate) = f(edit) + (F(start) + h(head) − t(in))" });
    lines.push(`Cut ${vals.cutIn} to ${vals.cutOut} (${res.cutLength} frames) → plate frames ${res.cutFirst} to ${res.cutLast}; with handles, plate ${res.plateFirst} to ${res.plateLast} (${res.total} frames). Plate frame = editorial frame ${res.offset >= 0 ? "+" : "−"} ${Math.abs(res.offset)}.`);
    lines.push(`File patterns: ${patterns[0]} (printf: Nuke, ffmpeg, OIIO); ${patterns[1]} (Nuke, RV, Resolve: one # per digit); ${patterns[2]} (Houdini). First file ${name(res.plateFirst)}, cut in ${name(res.cutFirst)}, cut out ${name(res.cutLast)}, last ${name(res.plateLast)}.`);
    lines.push(`The last frame needs ${res.digits} digit${res.digits === 1 ? "" : "s"}; the pad overflows at frame ${"1" + "0".repeat(pad)}, ${Math.pow(10, pad) - 1 - res.plateLast} frames past this plate.`);
    lines.push({ math: "n_a = f_s/f", fallback: "nₐ = fₛ/f" });
    if (whole) lines.push(`${khz} kHz at ${rate.label} fps: ${cad.sequence[0]} samples in every frame, so any whole-frame offset is a whole number of samples.`);
    else {
      lines.push(`${khz} kHz at ${rate.label} fps: ${cad.perFrame.num}/${cad.perFrame.den} = ${t(cad.perFrameValue, 7)} samples per frame, not whole, so the samples per frame follow a ${cad.cycle}-frame cycle carrying ${cad.cycleSamples} samples${cad.sequence.length <= 10 ? `: ${cad.sequence.join(", ")}` : ""}.`);
      lines.push("The cycle is the cumulative sample count rounded to the nearest sample at each frame boundary, starting at the first frame of the cycle; at 48 kHz and 29.97 fps that is SMPTE ST 299-1's 1602, 1601, 1602, 1601, 1602. A device may start the cycle on a different frame (the same five numbers, rotated), so check its frame-sequence phase.");
    }
    const outputs: EngOutput[] = [
      { key: "total", label: "Plate frames", value: res.total, unit: "" },
      { key: "plateFirst", label: "Plate first frame", value: res.plateFirst, unit: "" },
      { key: "plateLast", label: "Plate last frame", value: res.plateLast, unit: "" },
      { key: "samplesPerFrame", label: "Audio samples per frame", value: cad.perFrameValue, unit: "" },
    ];
    const rows: string[][] = [["Quantity", "Value"], ["Cut (editorial)", `${vals.cutIn} to ${vals.cutOut} (${res.cutLength})`], ["Plate (with handles)", `${res.plateFirst} to ${res.plateLast} (${res.total})`], ["Cut in the plate", `${res.cutFirst} to ${res.cutLast}`], ["Editorial → plate offset", `${res.offset >= 0 ? "+" : "−"}${Math.abs(res.offset)}`], ["printf pattern", patterns[0]], ["Hash pattern", patterns[1]], ["Houdini pattern", patterns[2]], ["Samples per frame", whole ? String(cad.sequence[0]) : `${t(cad.perFrameValue, 7)} (${cad.sequence.length <= 10 ? cad.sequence.join(", ") : `${cad.cycle}-frame cycle`})`]];
    if (off && !("error" in off)) {
      lines.push({ math: "t = N_f/f = N_s/f_s", fallback: "t = N(f)/f = N(s)/fₛ" });
      lines.push(`Sync offset: ${t(off.frames, 8)} frames = ${t(off.samples, 8)} samples = ${t(off.ms, 8)} ms at ${rate.label} fps and ${khz} kHz.${off.wholeSamples ? "" : " The offset is not a whole number of samples: an editor can only slip by whole samples, so round it."}${Math.abs(off.frames - Math.round(off.frames)) > 1e-9 ? " It is not a whole number of frames: a picture-only slip cannot correct it; slip the audio." : ""}`);
      rows.push(["Sync offset", `${t(off.frames, 8)} frames = ${t(off.samples, 8)} samples = ${t(off.ms, 8)} ms`]);
      outputs.push({ key: "offsetSamples", label: "Sync offset", value: off.samples, unit: "samples" }, { key: "offsetMs", label: "Sync offset", value: off.ms, unit: "ms" });
    }
    lines.push("Assumes: cut in and out are inclusive frame numbers, handles are whole frames on each end, and frames are numbered upward from the plate start. A negative frame (a minus sign in the file name) is refused. Audio cadence is the round-to-nearest rule above; real recorders and SDI embedders follow it at 48 kHz.");
    return finish(lines, [], [
      table("Shot frame range", rows),
      plot(timelineSvg(res, vals.head, vals.tail, `Files: ${patterns[0]}`, `Editorial ${vals.cutIn} to ${vals.cutOut} becomes plate ${res.cutFirst} to ${res.cutLast} (offset ${res.offset >= 0 ? "+" : "−"}${Math.abs(res.offset)}).`), "The plate: head handle, cut and tail handle, with frame numbers", "A bar of the plate's frames: a grey head handle, the blue cut and a grey tail handle, the first and last frame numbers at each end"),
    ], outputs, false);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Shared readers
// ---------------------------------------------------------------------------------------------------------------

/** Three numbers ("1, 2, 3"). */
function vec3(r: (k: string) => string, key: string, label: string): Vec3 | string {
  const v = numList(r(key), label, 3);
  return typeof v === "string" ? v : [v[0], v[1], v[2]];
}

/** "4448 × 3096", "4448x3096", "4448, 3096". */
function resolution(raw: string): [number, number] | string {
  const m = /^\s*(\d+)\s*(?:[x×X*,]|\s)\s*(\d+)\s*(?:px)?\s*$/.exec(raw ?? "");
  if (!m) return `Resolution: "${(raw ?? "").trim()}" is not a width × height in pixels (write 4096 × 2160).`;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0 && h > 0)) return "Resolution: the width and height must be greater than zero.";
  if (w > 100000 || h > 100000) return "Resolution: above 100 000 pixels on a side is not an image size.";
  return [w, h];
}

const v3 = (v: readonly number[], p = 4): string => `(${v.map((x) => d(x, p)).join(", ")})`;
const ORDER_OPTIONS = ORDERS.map((o) => ({ value: o, label: `${o} (${o[0]} first, then ${o[1]}, then ${o[2]})` }));
const readOrder = (v: string): Order => ((ORDERS as readonly string[]).includes(v) ? (v as Order) : "XYZ");
const inch = (mm: number): string => t(mm / 25.4, 5);

// ---------------------------------------------------------------------------------------------------------------
// 3. Camera match: filmback, focal length, field of view
// ---------------------------------------------------------------------------------------------------------------

const FIT_OPTIONS = [
  { value: "fill", label: "Fill (the image stays inside the filmback)" },
  { value: "horizontal", label: "Horizontal (filmback width = image width)" },
  { value: "vertical", label: "Vertical (filmback height = image height)" },
  { value: "overscan", label: "Overscan (the filmback stays inside the image)" },
];

const cameraCalc: VfxCalc = {
  id: "vfx-camera-match",
  name: "Camera match: filmback, focal length & field of view",
  group: "VFX & compositing",
  unitContract: "converts",
  hint:
    "Match a CG camera to a plate: the sensor area recorded (an ARRI preset from ARRI's published data, or typed), the " +
    "anamorphic squeeze, and the focal length or a field of view give the horizontal, vertical and diagonal fields of " +
    "view, the crop factor and full-frame equivalent, the aperture in inches for Maya and in mm for Houdini, Nuke and " +
    "Blender, and what the film-fit mode does when the image aspect differs from the filmback. Depth of field and " +
    "circle of confusion are under Exposure (Light & camera); pixel and display aspect under Aspect (Video & display).",
  fields: [
    { key: "preset", label: "Sensor / filmback", default: "lf-og", kind: "select", options: [{ value: "custom", label: "Custom (type the width and height)" }, ...SENSOR_PRESETS.map((p) => ({ value: p.id, label: p.label }))] },
    { key: "W", label: "Filmback width (mm; custom only)", default: "24.89 mm", kind: "text" },
    { key: "H", label: "Filmback height (mm; custom only)", default: "18.66 mm", kind: "text" },
    { key: "squeeze", label: "Anamorphic squeeze", default: "1", kind: "select", options: ["1", "1.3", "1.5", "1.8", "2"].map((s) => ({ value: s, label: s === "1" ? "1× (spherical)" : `${s}×` })) },
    { key: "given", label: "Given", default: "focal", kind: "select", options: [{ value: "focal", label: "Focal length" }, { value: "fov", label: "A field of view" }] },
    { key: "f", label: "Focal length (mm)", default: "35 mm", kind: "text" },
    { key: "fov", label: "Field of view (degrees; when given)", default: "54.4", kind: "text" },
    { key: "axis", label: "That field of view is", default: "h", kind: "select", options: [{ value: "h", label: "Horizontal" }, { value: "v", label: "Vertical" }, { value: "d", label: "Diagonal" }] },
    { key: "res", label: "Image resolution as recorded (width × height px)", default: "4448 × 3096", kind: "text" },
    { key: "fit", label: "CG film fit", default: "fill", kind: "select", options: FIT_OPTIONS },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const presetId = r("preset");
    const preset = SENSOR_PRESETS.find((p) => p.id === presetId) ?? null;
    let W = preset?.W ?? NaN;
    let Hh = preset?.H ?? NaN;
    if (!preset) {
      W = u.req("W", "mm", "mm", "Filmback width");
      Hh = u.req("H", "mm", "mm", "Filmback height");
    }
    const given = r("given") === "fov" ? "fov" : "focal";
    const f = given === "focal" ? u.req("f", "mm", "mm", "Focal length") : null;
    if (u.errors.length) return refuse(u.errors.join("\n"));
    let fovIn: number | null = null;
    if (given === "fov") {
      const v = num(r, "fov", "Field of view");
      if (typeof v === "string") return refuse(v);
      fovIn = v;
    }
    const axis = (["h", "v", "d"].includes(r("axis")) ? r("axis") : "h") as FovAxis;
    const res = resolution(r("res"));
    if (typeof res === "string") return refuse(res);
    const squeeze = Number(r("squeeze")) || 1;
    const fit = (["fill", "horizontal", "vertical", "overscan"].includes(r("fit")) ? r("fit") : "fill") as FitMode;
    const c = cameraMatch({ W, H: Hh, squeeze, f, fov: fovIn, fovAxis: axis, resW: res[0], resH: res[1], fit });
    if (!c.ok) return refuse(c.error);
    const name = preset ? preset.label.replace(/ \([^)]*\)$/, "") : `a ${t(W)} × ${t(Hh)} mm filmback`;
    const fitWord = FIT_OPTIONS.find((o) => o.value === fit)?.label.split(" (")[0] ?? fit;
    const lines: EngLine[] = [];
    lines.push(
      `A ${t(c.f, 4)} mm lens on ${name}${squeeze > 1 ? ` with a ${squeeze}× squeeze` : ""} sees ${t(c.hFov, 4)}° across and ${t(c.vFov, 4)}° high. ` +
        `In Maya set Camera Aperture to ${inch(W)} × ${inch(Hh)} in${squeeze > 1 ? `, Lens Squeeze Ratio ${squeeze}` : ""}, focal length ${t(c.f, 5)} mm and Film Fit ${fitWord} (here it fits ${c.resolvedFit === "horizontal" ? "the width" : "the height"}).`,
    );
    lines.push({ math: "theta_h = 2 arctan((s W)/(2 f))", fallback: "θₕ = 2·arctan(s·W/(2f))" });
    lines.push({ math: "theta_v = 2 arctan(H/(2 f))", fallback: "θᵥ = 2·arctan(H/(2f))" });
    lines.push({ math: "f = d/(2 tan(theta/2))", fallback: "f = d/(2·tan(θ/2))" });
    lines.push({ math: "k = d_FF/sqrt(W^2 + H^2)", fallback: "k = d(FF)/√(W² + H²)" });
    lines.push(`Filmback ${t(W)} × ${t(Hh)} mm (${preset ? preset.source : "typed"})${squeeze > 1 ? `; desqueezed ${t(c.We, 5)} × ${t(Hh)} mm` : ""}: aspect ${t(c.filmAspect, 4)}:1, diagonal ${t(c.diag, 5)} mm.`);
    if (given === "fov") lines.push(`A ${t(fovIn as number)}° ${axis === "h" ? "horizontal" : axis === "v" ? "vertical" : "diagonal"} field of view on this filmback needs f = ${t(c.f, 6)} mm.`);
    lines.push(`Field of view at ${t(c.f, 5)} mm: ${t(c.hFov, 5)}° horizontal, ${t(c.vFov, 5)}° vertical, ${t(c.dFov, 5)}° diagonal.`);
    lines.push(squeeze > 1
      ? `Crop factor ${t(c.crop, 4)} on the recorded area against full frame (36 × 24 mm, diagonal ${t(Math.hypot(36, 24), 5)} mm). Desqueezed, the frame is ${t(c.We, 5)} × ${t(Hh)} mm (diagonal ${t(c.diag, 5)} mm): the same diagonal view needs ${t(c.fEqDiag, 4)} mm on full frame, the same horizontal view ${t(c.fEqH, 4)} mm.`
      : `Crop factor ${t(c.crop, 4)} against full frame (36 × 24 mm, diagonal ${t(Math.hypot(36, 24), 5)} mm): the same diagonal view needs ${t(c.fEqDiag, 4)} mm on full frame.`);
    const covW = c.coverH < 1 ? `the plate fills ${t(c.coverH * 100, 4)} % of the image width` : "";
    const covH = c.coverV < 1 ? `the plate fills ${t(c.coverV * 100, 4)} % of the image height` : "";
    lines.push(
      `Image ${res[0]} × ${res[1]} px${squeeze > 1 ? ` (pixel aspect ${squeeze}, desqueezed aspect ${t(c.imageAspect, 4)}:1)` : ` (aspect ${t(c.imageAspect, 4)}:1)`} against filmback ${t(c.filmAspect, 4)}:1. Film fit ${fitWord} fits ${c.resolvedFit === "horizontal" ? "the width" : "the height"}: the render gate is ${t(c.gateW, 5)} × ${t(c.gateH, 5)} mm, ${t(c.renderH, 5)}° × ${t(c.renderV, 5)}°` +
        (c.aspectMatch ? ", the filmback itself (the aspects agree within 0.1 %, so every fit mode gives the same camera)." : covW || covH ? `, and ${[covW, covH].filter(Boolean).join(" and ")}, so the CG camera sees beyond the plate there (overscan: extend the plate or crop the render).` : c.gateW < c.We - 1e-9 || c.gateH < Hh - 1e-9 ? ", inside the filmback: the render crops the plate." : ", the same as the filmback."),
    );
    lines.push(`CG settings: Maya Camera Aperture ${inch(W)} × ${inch(Hh)} in${squeeze > 1 ? `, Lens Squeeze Ratio ${squeeze}` : ""}, Film Fit ${fitWord}; Houdini Focal Length ${t(c.f, 5)} mm with Aperture ${t(c.We, 5)} mm${squeeze > 1 ? ` and Pixel Aspect Ratio ${squeeze}` : ""}; Nuke Camera horizontal aperture ${t(c.We, 5)} mm, vertical ${t(Hh)} mm; Blender Sensor Width ${t(c.We, 5)} mm, Sensor Fit Horizontal${squeeze > 1 ? `, pixel aspect X ${squeeze}` : ""}.`);
    lines.push("Assumes: a pinhole (rectilinear) lens focused at infinity: a real lens focused close has a longer effective focal length (focus breathing) and distortion, which a lens grid measures. The filmback is the area recorded in this sensor mode, not the whole sensor. Preset sizes are ARRI's published active image areas.");
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Focal length", `${t(c.f, 6)} mm`],
      ["Horizontal field of view", `${t(c.hFov, 6)}°`],
      ["Vertical field of view", `${t(c.vFov, 6)}°`],
      ["Diagonal field of view", `${t(c.dFov, 6)}°`],
      ["Crop factor (diagonal)", t(c.crop, 5)],
      ["Full-frame equivalent focal length", `${t(c.fEqDiag, 5)} mm`],
      ["Maya Camera Aperture", `${inch(W)} × ${inch(Hh)} in`],
      ["Houdini / Nuke / Blender aperture", `${t(c.We, 5)} mm horizontal`],
      [`Render (${fitWord})`, `${t(c.renderH, 5)}° × ${t(c.renderV, 5)}°`],
    ];
    const outputs: EngOutput[] = [
      { key: "f", label: "Focal length", value: c.f, unit: "mm" },
      { key: "hFov", label: "Horizontal field of view", value: c.hFov, unit: "°" },
      { key: "vFov", label: "Vertical field of view", value: c.vFov, unit: "°" },
      { key: "dFov", label: "Diagonal field of view", value: c.dFov, unit: "°" },
      { key: "crop", label: "Crop factor", value: c.crop, unit: "" },
    ];
    const wedges = [
      { label: `${preset ? preset.label.replace(/^ARRI /, "").replace(/ \([^)]*\)$/, "") : "This filmback"}${squeeze > 1 ? `, ${squeeze}× desqueezed` : ""}`, fov: c.hFov, colour: BLUE },
      { label: `Full frame 36 mm at ${t(c.f, 4)} mm`, fov: (2 * Math.atan(36 / (2 * c.f)) * 180) / Math.PI, colour: GREY },
    ];
    if (Math.abs(c.renderH - c.hFov) > 0.05) wedges.push({ label: `The render (${fitWord})`, fov: c.renderH, colour: ORANGE });
    return finish(lines, u.conversions, [
      table("Camera match", rows),
      plot(fovWedgesSvg(wedges, `Horizontal field of view at ${t(c.f, 4)} mm`), "Horizontal field of view, from above", "Field-of-view wedges seen from above for this filmback and full frame at the same focal length"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Projection and parallax
// ---------------------------------------------------------------------------------------------------------------

const projectionCalc: VfxCalc = {
  id: "vfx-projection",
  name: "Camera projection, parallax & screen-space motion blur",
  group: "VFX & compositing",
  unitContract: "converts",
  hint:
    "A pinhole camera (position, rotation and rotation order, focal length, filmback, resolution) projects a 3D point " +
    "to pixels; a camera move per frame gives the point's screen-space velocity and its motion-blur streak at the " +
    "shutter angle, and the parallax between two depths (how far a near and a far plane slide against each other), " +
    "which decides whether a 2.5D card or a projection holds up. Positions are in scene units; Y up, the camera looks " +
    "down −Z. Camera match finds the filmback and focal length; 3D transforms builds the rotation.",
  fields: [
    { key: "cam", label: "Camera position (x, y, z; scene units)", default: "0, 1.6, 10", kind: "text" },
    { key: "rot", label: "Camera rotation (rx, ry, rz; degrees)", default: "-5, 15, 0", kind: "text" },
    { key: "order", label: "Rotation order", default: "ZXY", kind: "select", options: ORDER_OPTIONS },
    { key: "f", label: "Focal length (mm)", default: "35 mm", kind: "text" },
    { key: "W", label: "Filmback width (mm)", default: "36.7 mm", kind: "text" },
    { key: "H", label: "Filmback height (mm)", default: "25.54 mm", kind: "text" },
    { key: "res", label: "Resolution (width × height px)", default: "4448 × 3096", kind: "text" },
    { key: "point", label: "World point (x, y, z)", default: "1, 1, 0", kind: "text" },
    { key: "move", label: "Camera move per frame (dx, dy, dz)", default: "0.05, 0, 0", kind: "text" },
    { key: "near", label: "Parallax near depth (along the view)", default: "5", kind: "text" },
    { key: "far", label: "Parallax far depth", default: "50", kind: "text" },
    { key: "shutter", label: "Shutter angle (degrees)", default: "180", kind: "text" },
    { key: "frames", label: "Frames in the move", default: "24", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const f = u.req("f", "mm", "mm", "Focal length");
    const W = u.req("W", "mm", "mm", "Filmback width");
    const Hh = u.req("H", "mm", "mm", "Filmback height");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const vals: Record<string, Vec3> = {};
    for (const [k, label] of [["cam", "Camera position"], ["rot", "Camera rotation"], ["point", "World point"], ["move", "Camera move"]] as const) {
      const v = vec3(r, k, label);
      if (typeof v === "string") return refuse(v);
      vals[k] = v;
    }
    const sc: Record<string, number> = {};
    for (const [k, label] of [["near", "Near depth"], ["far", "Far depth"], ["shutter", "Shutter angle"], ["frames", "Frames in the move"]] as const) {
      const v = num(r, k, label);
      if (typeof v === "string") return refuse(v);
      sc[k] = v;
    }
    const res = resolution(r("res"));
    if (typeof res === "string") return refuse(res);
    const order = readOrder(r("order"));
    const inp = { cam: vals.cam, rot: vals.rot, order, f, W, H: Hh, resW: res[0], resH: res[1], point: vals.point, move: vals.move, near: sc.near, far: sc.far, shutter: sc.shutter, frames: sc.frames };
    const p = projection(inp);
    if (!p.ok) return refuse(p.error);
    const lines: EngLine[] = [];
    const where = p.p0.inFrame ? `lands at pixel (${d(p.p0.u, 1)}, ${d(p.p0.v, 1)}) of the ${res[0]} × ${res[1]} frame` : `projects to (${d(p.p0.u, 1)}, ${d(p.p0.v, 1)}), outside the ${res[0]} × ${res[1]} frame`;
    lines.push(
      `The point ${v3(vals.point, 3)} ${where}, ${t(p.p0.depth, 4)} units in front of the camera; the move shifts it ${t(p.speed, 4)} px per frame, a blur streak of ${t(p.blur, 4)} px at ${t(sc.shutter, 4)}°. ` +
        (p.lateral !== 0 ? `The near (${t(sc.near)}) and far (${t(sc.far)}) depths slide ${t(p.parallax, 4)} px apart per frame, ${t(p.parallaxShot, 4)} px over ${sc.frames} frames.` : "The camera does not move sideways, so the two depths show no parallax."),
    );
    lines.push({ math: "p_c = R^T (p - C)", fallback: "p(c) = Rᵀ(p − C)" });
    lines.push({ math: "x = f X_c/(-Z_c), y = f Y_c/(-Z_c)", fallback: "x = f·X(c)/(−Z(c)), y = f·Y(c)/(−Z(c))" });
    lines.push({ math: "u = W_px/2 + k x, v = H_px/2 - k y", fallback: "u = W(px)/2 + k·x, v = H(px)/2 − k·y" });
    lines.push({ math: "Delta u = (f b k)/d", fallback: "Δu = f·b·k/d" });
    lines.push(`Conventions: right-handed, Y up, the camera looks down its local −Z; rotation order ${order} (${order[0]} first) about the parent axes, R = R${order[2].toLowerCase()}·R${order[1].toLowerCase()}·R${order[0].toLowerCase()}; pixels from the top-left, v down (Nuke counts v from the bottom: ${d(p.p0.vNuke, 2)}). k = ${t(p.k, 6)} px per mm of film (horizontal fit).`);
    if (Math.abs(p.gateMismatch - 1) > 0.005) lines.push(`The resolution's aspect (${t(res[0] / res[1], 4)}) differs from the filmback's (${t(W / Hh, 4)}): with the width fitted, the image covers ${t((res[1] / p.k), 5)} mm of the ${t(Hh)} mm height. Set the CG camera's film fit to match (Camera match).`);
    lines.push(`Camera-space point ${v3(p.p0.pc, 4)}; on the film (${d(p.p0.xf, 4)}, ${d(p.p0.yf, 4)}) mm from centre.`);
    lines.push(`After one frame of the move ${v3(vals.move, 4)}: pixel (${d(p.p1.u, 2)}, ${d(p.p1.v, 2)}), a screen velocity of (${d(p.du, 3)}, ${d(p.dv, 3)}) px per frame, ${t(p.speed, 5)} px per frame in all. Motion blur at ${t(sc.shutter, 4)}°: ${t(p.speed, 5)} × ${t(sc.shutter, 4)}/360 = ${t(p.blur, 5)} px.`);
    lines.push(`Parallax: the move has ${d(p.lateral, 4)} units per frame sideways (along the camera's right axis) and ${d(p.dolly, 4)} toward the view. A point straight ahead at depth ${t(sc.near)} slides ${t(Math.abs(p.shiftNear), 5)} px per frame and one at ${t(sc.far)} slides ${t(Math.abs(p.shiftFar), 5)} px: ${t(p.parallax, 5)} px of parallax per frame, ${t(p.parallaxShot, 5)} px over ${sc.frames} frames.${p.parallaxShot < 1 ? " Under a pixel over the whole move: a flat card or a matte painting holds." : " More than a pixel: a single flat card cannot hold both depths; split them into layers or project onto geometry."}`);
    lines.push("Assumes: a pinhole lens (no distortion), square pixels and the width of the filmback fitted to the image; the camera translates without rotating during the move; parallax is computed for points on the view axis (the sideways component of the move only; a dolly adds a scale change).");
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Pixel (u, v), origin top-left", `(${d(p.p0.u, 3)}, ${d(p.p0.v, 3)})`],
      ["Pixel v from the bottom (Nuke)", d(p.p0.vNuke, 3)],
      ["Depth along the view", t(p.p0.depth, 6)],
      ["In frame", p.p0.inFrame ? "yes" : "no"],
      ["Screen velocity (px per frame)", t(p.speed, 6)],
      ["Motion-blur length (px)", t(p.blur, 6)],
      ["Parallax per frame (px)", t(p.parallax, 6)],
      [`Parallax over ${sc.frames} frames (px)`, t(p.parallaxShot, 6)],
    ];
    const outputs: EngOutput[] = [
      { key: "u", label: "Pixel u", value: p.p0.u, unit: "px" },
      { key: "v", label: "Pixel v", value: p.p0.v, unit: "px" },
      { key: "speed", label: "Screen velocity", value: p.speed, unit: "px/frame" },
      { key: "blur", label: "Motion-blur length", value: p.blur, unit: "px" },
      { key: "parallax", label: "Parallax per frame", value: p.parallax, unit: "px" },
    ];
    return finish(lines, u.conversions, [
      table("Projection and parallax", rows),
      plot(parallaxTopSvg(p, inp), "Top-down: the camera, two depths and the rays before and after one frame's move", "A top-down diagram of the camera frustum with a near and a far depth line, rays from the camera before and after its sideways move, and the projected point"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. 3D transforms
// ---------------------------------------------------------------------------------------------------------------

const matRows = (m: number[][], p = 6): string[][] => m.map((row) => row.map((v) => d(v, p)));

const transformCalc: VfxCalc = {
  id: "vfx-transform",
  name: "3D transforms: TRS matrix, pivot, rotation order",
  group: "VFX & compositing",
  unitContract: "same-units",
  hint:
    "Translate, rotate and scale composed into one 4×4 matrix about a pivot, with the rotation order a DCC uses (XYZ … " +
    "ZYX, the first letter applied first), applied to points, inverted and checked (determinant, orthogonality), with " +
    "the rotation as a quaternion and an axis–angle, gimbal lock named, and an optional Y-up ↔ Z-up conversion. Every " +
    "Euler sequence, intrinsic or extrinsic, slerp and composition: Attitude (Robotics & kinematics).",
  fields: [
    { key: "t", label: "Translate (tx, ty, tz)", default: "1, 2, 3", kind: "text" },
    { key: "r", label: "Rotate (rx, ry, rz; degrees)", default: "30, 45, 60", kind: "text" },
    { key: "s", label: "Scale (sx, sy, sz)", default: "1, 1, 1", kind: "text" },
    { key: "order", label: "Rotation order", default: "XYZ", kind: "select", options: ORDER_OPTIONS },
    { key: "pivot", label: "Pivot (x, y, z)", default: "0, 0, 0", kind: "text" },
    { key: "points", label: "Points to transform (x, y, z per line; up to 50)", default: "1, 0, 0\n0, 1, 0\n0, 0, 1", kind: "block", rows: 3 },
    { key: "up", label: "Up-axis conversion", default: "none", kind: "select", options: [{ value: "none", label: "None" }, { value: "y2z", label: "Y-up → Z-up (Maya/Houdini → Blender/Unreal/3ds Max)" }, { value: "z2y", label: "Z-up → Y-up" }] },
  ],
  compute: (r) => {
    const vals: Record<string, Vec3> = {};
    for (const [k, label] of [["t", "Translate"], ["r", "Rotate"], ["s", "Scale"], ["pivot", "Pivot"]] as const) {
      const v = vec3(r, k, label);
      if (typeof v === "string") return refuse(v);
      vals[k] = v;
    }
    const rawPts = (r("points") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (rawPts.length > 50) return refuse(`Points: ${rawPts.length} lines is above the 50 this tool lists.`);
    const points: Vec3[] = [];
    for (let i = 0; i < rawPts.length; i++) {
      const v = numList(rawPts[i], `Points, line ${i + 1}`, 3);
      if (typeof v === "string") return refuse(v);
      points.push([v[0], v[1], v[2]]);
    }
    const order = readOrder(r("order"));
    const up = (["none", "y2z", "z2y"].includes(r("up")) ? r("up") : "none") as UpConvert;
    const res = transform({ t: vals.t, r: vals.r, s: vals.s, order, pivot: vals.pivot, points, up });
    if (!res.ok) return refuse(res.error);
    const lines: EngLine[] = [];
    const first = points.length ? ` maps ${v3(points[0], 4)} to ${v3(res.out[0], 4)};` : "";
    lines.push(
      `Rotating ${order} by ${v3(vals.r, 4).replace(/[()]/g, "")}° (${t(res.angle, 5)}° about ${res.axis ? v3(res.axis, 4) : "no axis"}), scaling ${v3(vals.s, 4)} and moving ${v3(vals.t, 4)}${first} the determinant is ${t(res.det, 6)}${res.mirrored ? ", negative, so the transform mirrors (normals flip and winding reverses)" : ""}.` +
        (res.gimbal.locked ? ` The middle rotation (${res.gimbal.middle} = ${t(res.gimbal.angle)}°) is at gimbal lock: the first and third rotations turn about the same axis, so one degree of freedom is lost and curves through here flip; key quaternions instead.` : ""),
    );
    lines.push({ math: "M = T(t) T(p) R S T(-p)", fallback: "M = T(t)·T(p)·R·S·T(−p)" });
    lines.push({ math: "M^(-1) = T(p) S^(-1) R^T T(-p) T(-t)", fallback: "M⁻¹ = T(p)·S⁻¹·Rᵀ·T(−p)·T(−t)" });
    lines.push(`Rotation order ${order}: ${order[0]} is applied first, about the fixed parent axes, so R = R${order[2].toLowerCase()}·R${order[1].toLowerCase()}·R${order[0].toLowerCase()} (Maya's rotate order; scipy Rotation with the lower-case axes "${order.toLowerCase()}"; intrinsic ${[...order].reverse().join("")} in Attitude). Column vectors, p′ = M·p; Maya's MMatrix and Houdini's VEX store the transpose (row vectors).`);
    lines.push(`Determinant ${t(res.det, 6)} (sx·sy·sz); rotation orthogonality |RᵀR − I| = ${res.orthoErr < 1e-15 ? "0" : t(res.orthoErr, 2)}; inverse check |M⁻¹M − I| = ${res.invErr < 1e-15 ? "0" : t(res.invErr, 2)}.`);
    lines.push(`Rotation as a quaternion (x, y, z, w) ${v3(res.quat, 6)}; as an axis and angle, ${t(res.angle, 6)}° about ${res.axis ? v3(res.axis, 6) : "no axis (identity)"}.`);
    if (!res.gimbal.locked) lines.push(`Gimbal lock: none (the middle rotation, ${res.gimbal.middle} = ${t(res.gimbal.angle)}°, is not ±90°).`);
    if (res.conv) lines.push(`${up === "y2z" ? "Y-up → Z-up" : "Z-up → Y-up"}: points as C·p with C = ${up === "y2z" ? "+90°" : "−90°"} about X ((x, y, z) → ${up === "y2z" ? "(x, −z, y)" : "(x, z, −y)"}); the matrix becomes C·M·C⁻¹.`);
    lines.push("Assumes: one pivot for rotate and scale (no shear, no separate rotate/scale pivots or pivot translation, no joint orient); angles in degrees; values within 10⁻¹² of a whole number are printed as that number (cos 90° is exactly 0).");
    const extra = [
      table("Transform matrix M (column vectors, p′ = M·p)", matRows(res.M)),
      table("Inverse M⁻¹", matRows(res.inv)),
    ];
    if (points.length) {
      const head = ["Point", "Transformed"];
      if (res.conv) head.push(up === "y2z" ? "In Z-up" : "In Y-up");
      extra.push(table("Points", [head, ...points.map((p, i) => [v3(p, 4), v3(res.out[i], 6), ...(res.conv ? [v3(res.conv.points[i], 6)] : [])])]));
    }
    if (res.conv) extra.push(table(`M in ${up === "y2z" ? "Z-up" : "Y-up"} (C·M·C⁻¹)`, matRows(res.conv.M)));
    extra.push(plot(axesSvg(res), "Axes before and after the transform", "An isometric view of the world axes in grey and the transformed axes in red, green and blue from the moved origin, with the transformed points"));
    const outputs: EngOutput[] = [
      { key: "det", label: "Determinant", value: res.det, unit: "" },
      { key: "angle", label: "Rotation angle", value: res.angle, unit: "°" },
      { key: "qw", label: "Quaternion w", value: res.quat[3], unit: "" },
    ];
    return finish(lines, [], extra, outputs, false);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 6. Surface normals and shading
// ---------------------------------------------------------------------------------------------------------------

const shadingCalc: VfxCalc = {
  id: "vfx-shading",
  name: "Normal maps & shading: TBN, Lambert, Blinn–Phong, Fresnel",
  group: "VFX & compositing",
  unitContract: "domain",
  hint:
    "A normal-map texel (8-bit, 16-bit or float) decoded to a tangent-space normal, with the OpenGL or DirectX green " +
    "convention, placed in the world through the tangent, bitangent and geometric normal (the TBN matrix); then the " +
    "facing ratio n·V, Lambert n·L, the Blinn–Phong half-vector and Phong highlights, and Schlick's Fresnel beside the " +
    "exact dielectric value. Exact Fresnel for both polarisations and coatings: Fresnel (Optics & photonics).",
  fields: [
    { key: "texel", label: "Normal-map texel (R, G, B)", default: "180, 140, 230", kind: "text" },
    { key: "enc", label: "Texel encoding", default: "8", kind: "select", options: [{ value: "8", label: "8-bit (0–255)" }, { value: "16", label: "16-bit (0–65535)" }, { value: "float", label: "Float (0–1)" }] },
    { key: "green", label: "Green channel", default: "gl", kind: "select", options: [{ value: "gl", label: "OpenGL, Y+ (Maya, Blender, Houdini)" }, { value: "dx", label: "DirectX, Y− (Unreal, 3ds Max, Substance DX)" }] },
    { key: "T", label: "Tangent T (world)", default: "1, 0, 0", kind: "text" },
    { key: "B", label: "Bitangent B (world)", default: "0, 0, -1", kind: "text" },
    { key: "N", label: "Geometric normal N (world)", default: "0, 1, 0", kind: "text" },
    { key: "L", label: "Toward the light L", default: "1, 2, 0.5", kind: "text" },
    { key: "V", label: "Toward the camera V", default: "-0.5, 1, 1", kind: "text" },
    { key: "shin", label: "Specular exponent (shininess)", default: "32", kind: "text" },
    { key: "ior", label: "Index of refraction (blank to give F0)", default: "1.5", kind: "text" },
    { key: "f0", label: "F0, reflectance at normal incidence (when no IOR)", default: "0.04", kind: "text" },
  ],
  compute: (r) => {
    const vals: Record<string, Vec3> = {};
    for (const [k, label] of [["texel", "Normal-map texel"], ["T", "Tangent T"], ["B", "Bitangent B"], ["N", "Geometric normal N"], ["L", "Light direction L"], ["V", "View direction V"]] as const) {
      const v = vec3(r, k, label);
      if (typeof v === "string") return refuse(v);
      vals[k] = v;
    }
    const shin = num(r, "shin", "Specular exponent");
    if (typeof shin === "string") return refuse(shin);
    const iorRaw = (r("ior") ?? "").trim();
    let ior: number | null = null;
    let f0: number | null = null;
    if (iorRaw) {
      ior = plain(iorRaw);
      if (!Number.isFinite(ior)) return refuse(`Index of refraction: "${iorRaw}" is not a finite number.`);
    } else {
      const v = num(r, "f0", "F0");
      if (typeof v === "string") return refuse(v);
      f0 = v;
    }
    const enc = (["8", "16", "float"].includes(r("enc")) ? r("enc") : "8") as NormalEncoding;
    const green = (r("green") === "dx" ? "dx" : "gl") as GreenConvention;
    const s = shading({ texel: vals.texel, encoding: enc, green, T: vals.T, B: vals.B, N: vals.N, L: vals.L, V: vals.V, shininess: shin, ior, f0 });
    if (!s.ok) return refuse(s.error);
    const lines: EngLine[] = [];
    lines.push(
      `The texel decodes to a normal tilted ${t(s.tilt, 3)}° from the surface; it faces the camera at n·V = ${d(s.nDotV, 3)} and the light at n·L = ${d(s.nDotL, 3)}, so Lambert gives ${d(s.lambert, 3)}${s.nDotL <= 0 ? " (lit from behind: no direct light)" : ""}, ` +
        `a Blinn–Phong highlight of ${t(s.blinn, 3)} at exponent ${t(shin)}, and Schlick Fresnel ${d(s.schlickVH, 4)} at the half-vector angle.`,
    );
    lines.push({ math: "n_t = 2 c/c_max - 1", fallback: "n(t) = 2c/c(max) − 1" });
    lines.push({ math: "n = normalize(T n_x + B n_y + N n_z)", fallback: "n = normalize(T·nₓ + B·n(y) + N·n(z))" });
    lines.push({ math: "H = (L + V)/abs(L + V)", fallback: "H = (L + V)/|L + V|" });
    lines.push({ math: "F = F_0 + (1 - F_0) (1 - cos(theta))^5", fallback: "F = F₀ + (1 − F₀)(1 − cos θ)⁵" });
    lines.push(`Texel ${v3(vals.texel, 6)} (${enc === "float" ? "float" : `${enc}-bit`}, ${green === "gl" ? "OpenGL: green is +Y" : "DirectX: green flipped, −Y"}) decodes to ${v3(s.decoded, 6)}, length ${t(s.decodedLength, 6)}${Math.abs(s.decodedLength - 1) > 0.002 ? " (not unit length: 8-bit quantisation, filtering or compression; renormalised)" : ""}, so n(tangent) = ${v3(s.nTangent, 5)}.${enc === "8" ? " In 8 bits 128 decodes to +0.0039, not 0 (2·128/255 − 1); some engines use (c − 128)/127 instead, so a flat map reads exactly (0, 0, 1) there." : ""}`);
    if (s.intoSurface) lines.push("The decoded normal's z is at or below 0: it points into the surface. A tangent-space normal map should have blue above 128 (8-bit); check that the channels are not swapped.");
    lines.push(`TBN: T, B, N normalised; the largest dot product between them is ${t(s.tbnOrtho, 3)}${s.tbnOrtho > 0.01 ? " (not orthogonal, as interpolated MikkTSpace tangents often are; used as given)" : " (orthogonal)"}; handedness ${s.handedness > 0 ? "+1 (B = N × T, right-handed)" : "−1 (mirrored UVs: the bitangent sign flips)"}. World normal n = ${v3(s.n, 5)}.`);
    lines.push(`Directions (normalised): L = ${v3(s.l, 4)}, V = ${v3(s.v, 4)}, H = ${v3(s.h, 4)}, R = 2(n·L)n − L = ${v3(s.r, 4)}.`);
    lines.push(`Facing ratio n·V = ${d(s.nDotV, 5)}${s.nDotV < 0 ? " (negative: the mapped normal faces away from the camera, a common normal-map artefact at grazing angles)" : ""}; Lambert max(0, n·L) = ${d(s.lambert, 5)}; Blinn–Phong (n·H)ⁿ = ${t(s.blinn, 5)} with n·H = ${d(s.nDotH, 5)}; Phong (R·V)ⁿ = ${t(s.phong, 5)} with R·V = ${d(s.rDotV, 5)}.`);
    lines.push(`Fresnel: F0 = ${ior !== null ? `((n − 1)/(n + 1))² = ${t(s.f0, 5)} for n = ${t(ior)}` : t(s.f0, 5)}. Schlick at V·H = ${d(s.vDotH, 4)}: ${t(s.schlickVH, 5)}${s.exactVH !== null ? ` (exact unpolarised ${t(s.exactVH, 5)})` : ""}; at n·V = ${d(s.nDotV, 4)} (the rim): ${t(s.schlickNV, 5)}${s.exactNV !== null ? ` (exact ${t(s.exactNV, 5)})` : ""}.`);
    lines.push("Assumes: directions point away from the surface (L toward the light, V toward the camera), a dielectric from air (n₁ = 1), unpolarised light, and no normalisation factor on the specular lobes (an energy-conserving BRDF scales Blinn–Phong by (n + 8)/(8π)).");
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Decoded tangent-space normal", v3(s.decoded, 5)],
      ["World normal n", v3(s.n, 5)],
      ["Facing ratio n·V", d(s.nDotV, 5)],
      ["Lambert max(0, n·L)", d(s.lambert, 5)],
      ["Blinn–Phong (n·H)ⁿ", t(s.blinn, 5)],
      ["Phong (R·V)ⁿ", t(s.phong, 5)],
      ["Schlick Fresnel at V·H", t(s.schlickVH, 5)],
    ];
    if (s.exactVH !== null) rows.push(["Exact Fresnel at V·H", t(s.exactVH, 5)]);
    const outputs: EngOutput[] = [
      { key: "nDotV", label: "Facing ratio", value: s.nDotV, unit: "" },
      { key: "lambert", label: "Lambert", value: s.lambert, unit: "" },
      { key: "blinn", label: "Blinn–Phong", value: s.blinn, unit: "" },
      { key: "fresnel", label: "Schlick Fresnel", value: s.schlickVH, unit: "" },
    ];
    return finish(lines, [], [
      table("Shading", rows),
      plot(shadingSvg(s, vals.N), "The shading vectors at the surface point", "An isometric view of the geometric normal, the mapped normal, the light, view, half and reflection vectors above the tangent plane"),
    ], outputs, false);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 7. Camera log ↔ scene linear
// ---------------------------------------------------------------------------------------------------------------

const LOG_OPTIONS = [...LOG_CURVES.map((c) => ({ value: c.id, label: c.label })), { value: "cineon", label: "Cineon (Kodak printing density)" }];

const logCalc: VfxCalc = {
  id: "vfx-log",
  name: "Camera log ↔ scene linear (LogC, S-Log3, V-Log, Log3G10, ACEScct, Cineon)",
  group: "VFX & compositing",
  unitContract: "domain",
  hint:
    "A scene-linear value (0.18 is 18 % grey), stops from grey, or a log code value (0–1, or 10-bit 0–1023) converted " +
    "through a camera log curve: ARRI LogC3 (EI 800) and LogC4, Sony S-Log3, Panasonic V-Log, RED Log3G10, ACEScct, " +
    "ACEScc, or Cineon with your black and white points. Each curve is the manufacturer's published formula, checked " +
    "against a second source; Canon Log 3 is left out (one source only). Display curves (BT.709, BT.1886, sRGB, PQ, " +
    "HLG) are under Transfer functions (Video & display); colour spaces and gamuts under Colour & appearance.",
  fields: [
    { key: "curve", label: "Log curve", default: "slog3", kind: "select", options: LOG_OPTIONS },
    { key: "kind", label: "The value is", default: "linear", kind: "select", options: [{ value: "linear", label: "Scene linear (0.18 = 18 % grey)" }, { value: "stops", label: "Stops from 18 % grey" }, { value: "code", label: "Log code value, 0 to 1" }, { value: "code10", label: "Log code value, 10-bit (0 to 1023)" }] },
    { key: "value", label: "Value", default: "0.18", kind: "text" },
    { key: "black", label: "Cineon reference black (10-bit code)", default: "95", kind: "text" },
    { key: "white", label: "Cineon reference white (10-bit code)", default: "685", kind: "text" },
  ],
  compute: (r) => {
    const id = r("curve");
    let black = 95;
    let white = 685;
    if (id === "cineon") {
      const b = num(r, "black", "Cineon black");
      if (typeof b === "string") return refuse(b);
      const w = num(r, "white", "Cineon white");
      if (typeof w === "string") return refuse(w);
      if (!(b >= 0 && w <= 1023 && b < w)) return refuse(`Cineon: the black point (${b}) must be below the white point (${w}), both within 0 to 1023.`);
      black = b;
      white = w;
    }
    const curve = logCurve(id, black, white);
    if (!curve) return refuse(`Log curve: "${id}" is not one of the curves listed.`);
    const kind = (["linear", "stops", "code", "code10"].includes(r("kind")) ? r("kind") : "linear") as LogInputKind;
    const value = num(r, "value", "Value");
    if (typeof value === "string") return refuse(value);
    const res = logConvert(curve, value, kind);
    if (!res.ok) return refuse(res.error);
    const lines: EngLine[] = [];
    const code10 = `10-bit ${d(res.code10, 1)}`;
    if (res.belowBlack) {
      lines.push(`Code ${d(res.code, 4)} (${code10}) is below ${curve.label}'s black (code ${d(res.blackCode, 4)}, 10-bit ${d(res.blackCode * 1023, 1)}): it decodes to ${t(res.linear, 4)} linear, a negative value (noise below black) with no stops from grey; most comps keep it through the math and clamp only at the end.`);
    } else {
      lines.push(`${t(res.linear, 5)} linear (${res.stops === null ? "at black" : Math.abs(res.stops) < 0.005 ? "18 % grey itself" : `${res.stops > 0 ? "+" : ""}${d(res.stops, 2)} stops from 18 % grey`}) is ${curve.label} code ${d(res.code, 4)} (${code10}); 18 % grey sits at ${d(res.greyCode, 4)} on this curve.`);
    }
    lines.push(`${curve.label}: ${curve.source}.`);
    lines.push(`Linear ${t(res.linear, 7)}; stops from 18 % grey ${res.stops === null ? "none (at or below linear 0)" : d(res.stops, 4)}; code value ${d(res.code, 6)} (10-bit ${d(res.code10, 2)}).`);
    lines.push({ math: "stops = log_2(x/0.18)", fallback: "stops = log₂(x/0.18)" });
    if (res.codeOutside) lines.push(`The code value is outside 0 to 1: ${res.code < 0 ? "below" : "above"} the range a file stores, so a camera would clip it.`);
    lines.push(`On this curve: linear 0 (black) is code ${d(res.blackCode, 4)} (10-bit ${d(res.blackCode * 1023, 1)}), 18 % grey ${d(res.greyCode, 4)} (10-bit ${d(res.greyCode * 1023, 1)}). ${curve.note}`);
    lines.push("Assumes: code values are full range (10-bit code = normalised × 1023), as these curves are defined; a file delivered in legal range must be scaled first. The curve converts brightness only: the camera's gamut (ARRI Wide Gamut, S-Gamut3, V-Gamut, REDWideGamutRGB, AP1) is a separate matrix.");
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Scene linear", t(res.linear, 7)],
      ["Stops from 18 % grey", res.stops === null ? "none (at or below 0)" : d(res.stops, 4)],
      ["Code value (0 to 1)", d(res.code, 6)],
      ["10-bit code value", d(res.code10, 2)],
      ["Black (linear 0) code", d(res.blackCode, 6)],
      ["18 % grey code", d(res.greyCode, 6)],
    ];
    const outputs: EngOutput[] = [
      { key: "linear", label: "Scene linear", value: res.linear, unit: "" },
      { key: "code", label: "Code value", value: res.code, unit: "" },
      { key: "code10", label: "10-bit code value", value: res.code10, unit: "" },
    ];
    if (res.stops !== null) outputs.push({ key: "stops", label: "Stops from grey", value: res.stops, unit: "stops" });
    return finish(lines, [], [
      table(curve.label, rows),
      plot(logCurveSvg(curve, res.stops, res.code), `${curve.label}: code value against stops from 18 % grey`, `The ${curve.label} curve, code value against exposure in stops from 18 percent grey, with grey and this value marked`),
    ], outputs, false);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 8. Compositing math
// ---------------------------------------------------------------------------------------------------------------

const PD_OPTIONS: Array<{ value: PorterDuff; label: string }> = [
  { value: "over", label: "A over B" },
  { value: "in", label: "A in B" },
  { value: "out", label: "A out B" },
  { value: "atop", label: "A atop B" },
  { value: "xor", label: "A xor B" },
  { value: "plus", label: "A plus B" },
];
const BLEND_OPTIONS: Array<{ value: BlendMode; label: string }> = [
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "add", label: "Add" },
  { value: "difference", label: "Difference" },
];

const compositeCalc: VfxCalc = {
  id: "vfx-composite",
  name: "Compositing: Porter–Duff, premultiplied alpha & blend modes",
  group: "VFX & compositing",
  unitContract: "domain",
  hint:
    "Two RGBA pixels in scene-linear light, premultiplied or straight: the Porter–Duff operator (over, in, out, atop, " +
    "xor, plus), the fringe the wrong alpha association gives (premultiplying twice darkens edges; straight colour used " +
    "as premultiplied brightens them), and a blend mode (multiply, screen, add, difference) done in linear light " +
    "against the same blend on sRGB-encoded values, to show why compositing is done linear.",
  fields: [
    { key: "A", label: "A, foreground (R, G, B, alpha)", default: "0.8, 0.4, 0.1, 0.5", kind: "text" },
    { key: "B", label: "B, background (R, G, B, alpha)", default: "0.1, 0.2, 0.6, 1", kind: "text" },
    { key: "assoc", label: "A and B are", default: "straight", kind: "select", options: [{ value: "straight", label: "Straight (unpremultiplied)" }, { value: "premult", label: "Premultiplied (associated)" }] },
    { key: "op", label: "Operator", default: "over", kind: "select", options: PD_OPTIONS },
    { key: "mode", label: "Blend mode", default: "screen", kind: "select", options: BLEND_OPTIONS },
  ],
  compute: (r) => {
    const px: Record<string, RGBA> = {};
    for (const [k, label] of [["A", "A"], ["B", "B"]] as const) {
      const v = numList(r(k), label, 4);
      if (typeof v === "string") return refuse(v);
      px[k] = [v[0], v[1], v[2], v[3]];
    }
    const assoc = r("assoc") === "premult" ? "premult" : "straight";
    const op = (PD_OPTIONS.find((o) => o.value === r("op"))?.value ?? "over") as PorterDuff;
    const mode = (BLEND_OPTIONS.find((o) => o.value === r("mode"))?.value ?? "screen") as BlendMode;
    const c = composite(px.A, px.B, assoc, op, mode);
    if (!c.ok) return refuse(c.error);
    const opName = PD_OPTIONS.find((o) => o.value === op)?.label ?? op;
    const modeName = (BLEND_OPTIONS.find((o) => o.value === mode)?.label ?? mode).toLowerCase();
    const rgb = (v: readonly number[]): string => `(${v.slice(0, 3).map((x) => d(x, 4)).join(", ")})`;
    const worst = c.mistake.delta.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    const mistakeWords = c.mistake.kind === "double" ? "multiplying the premultiplied colour by alpha again" : "using the straight colour as if it were premultiplied";
    const fringe = worst < -1e-9 ? "darker (a dark fringe)" : worst > 1e-9 ? "brighter (a bright halo)" : "unchanged here";
    const lumLin = (v: number[]): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    const dl = lumLin(c.blendDisplay) / Math.max(1e-12, lumLin(c.blendLinear)) - 1;
    const lines: EngLine[] = [];
    lines.push(
      `${opName} gives ${rgb(c.result)} premultiplied at alpha ${d(c.result[3], 4)}; ${mistakeWords} would make it ${fringe}${Math.abs(worst) > 1e-9 ? ` by up to ${d(Math.abs(worst), 4)}` : ""}. ` +
        `A ${modeName} blend computed on display (sRGB) values comes out ${Math.abs(dl) < 1e-6 ? "the same as" : `${t(Math.abs(dl) * 100, 3)} % ${dl < 0 ? "darker" : "brighter"} than`} the same blend in linear light.`,
    );
    lines.push({ math: "C_o = C_A F_A + C_B F_B", fallback: "Cₒ = C(A)·F(A) + C(B)·F(B)" });
    lines.push({ math: "alpha_o = alpha_A F_A + alpha_B F_B", fallback: "αₒ = α(A)·F(A) + α(B)·F(B)" });
    lines.push(`Porter–Duff on premultiplied values (Porter and Duff 1984): over F(A) = 1, F(B) = 1 − α(A); in α(B), 0; out 1 − α(B), 0; atop α(B), 1 − α(A); xor 1 − α(B), 1 − α(A); plus 1, 1. Here F(A) and F(B) are for ${opName}.`);
    lines.push(`Inputs ${assoc === "straight" ? "straight, premultiplied first" : "premultiplied"}: A ${rgb(c.Apm)} α ${d(c.Apm[3], 4)}, B ${rgb(c.Bpm)} α ${d(c.Bpm[3], 4)}. Result ${rgb(c.result)} α ${d(c.result[3], 4)}${c.resultStraight ? `; unpremultiplied ${rgb(c.resultStraight)}` : "; alpha 0, so no colour to unpremultiply"}.`);
    if (c.plusOver1) lines.push(`Plus sums the alphas to ${d(c.result[3], 4)}, above 1: clamp it (Nuke's plus does not) before another over.`);
    if (c.emissive) lines.push("A premultiplied colour above its alpha is light with no coverage (a glow, fire, a lens flare): valid premultiplied, and it adds rather than covers.");
    lines.push(`The mistake (${mistakeWords}): ${rgb(c.mistake.result)}, a change of ${rgb(c.mistake.delta)}. Premultiplying twice darkens every partly covered edge pixel (a dark fringe round a key or a motion-blurred edge); treating straight colour as premultiplied adds colour where there is no coverage (a bright halo).`);
    lines.push(`Blend ${modeName} of A's colour onto B's, mixed by A's alpha: in linear light ${rgb(c.blendLinear)}; on sRGB-encoded values (decoded back to linear) ${rgb(c.blendDisplay)}. Light adds linearly, so only the linear result matches what a camera would record; display-referred blends change the result with the brightness of the inputs.${mode === "screen" && [...c.Ast.slice(0, 3), ...c.Bst.slice(0, 3)].some((v) => v > 1) ? " Screen assumes values at most 1: with HDR values above 1 it goes negative or inverts; use add or max instead." : ""}`);
    lines.push("Assumes: scene-linear RGB with alpha as coverage (0 to 1); sRGB is IEC 61966-2-1; blends mix the colours (alpha ignored inside the blend) and then use A's alpha over B.");
    const rows: string[][] = [
      ["Result", "R", "G", "B", "Alpha"],
      [`${opName} (premultiplied)`, ...c.result.map((v) => d(v, 5))],
      [`Mistake: ${c.mistake.kind === "double" ? "premultiplied twice" : "straight as premultiplied"}`, ...c.mistake.result.map((v) => d(v, 5))],
      [`${BLEND_OPTIONS.find((o) => o.value === mode)?.label} in linear light`, ...c.blendLinear.map((v) => d(v, 5)), ""],
      [`${BLEND_OPTIONS.find((o) => o.value === mode)?.label} on sRGB values`, ...c.blendDisplay.map((v) => d(v, 5)), ""],
    ];
    const swatches = [
      { label: "A", rgb: c.Ast.slice(0, 3), alpha: c.Ast[3] },
      { label: "B", rgb: c.Bst.slice(0, 3), alpha: c.Bst[3] },
      { label: "Result", rgb: (c.resultStraight ?? [0, 0, 0, 0]).slice(0, 3), alpha: Math.min(1, c.result[3]) },
      { label: "Mistake", rgb: c.mistake.result[3] > 0 ? c.mistake.result.slice(0, 3).map((v) => v / c.mistake.result[3]) : [0, 0, 0], alpha: Math.min(1, c.mistake.result[3]) },
      { label: "Blend lin", rgb: c.blendLinear, alpha: 1 },
      { label: "Blend sRGB", rgb: c.blendDisplay, alpha: 1 },
    ];
    const bars = [
      { label: `${opName}, premultiplied`, colour: BLUE, values: [...c.result] },
      { label: `the mistake (${c.mistake.kind === "double" ? "premultiplied twice" : "straight as premultiplied"})`, colour: RED, values: [...c.mistake.result] },
      { label: `${modeName}, linear light`, colour: GREEN, values: [...c.blendLinear] },
      { label: `${modeName}, on sRGB values`, colour: ORANGE, values: [...c.blendDisplay] },
    ];
    const outputs: EngOutput[] = [
      { key: "R", label: "Result R", value: c.result[0], unit: "" },
      { key: "G", label: "Result G", value: c.result[1], unit: "" },
      { key: "B", label: "Result B", value: c.result[2], unit: "" },
      { key: "alpha", label: "Result alpha", value: c.result[3], unit: "" },
    ];
    return finish(lines, [], [
      table("Compositing", rows),
      plot(compositeSvg(swatches, bars, `${opName} and a ${modeName} blend`), "Swatches and channel values: the result, the alpha mistake and the blend in linear and display light", "Colour swatches over a checkerboard for A, B, the result, the alpha mistake and the blend in linear and sRGB light, above a grouped bar chart of their channel values"),
    ], outputs, false);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 9. Chroma key
// ---------------------------------------------------------------------------------------------------------------

const chromaCalc: VfxCalc = {
  id: "vfx-chroma-key",
  name: "Chroma key: CbCr distance, alpha & spill suppression",
  group: "VFX & compositing",
  unitContract: "domain",
  hint:
    "A key (screen) colour and a pixel in R′G′B′, converted to Y′CbCr by the BT.601 or BT.709 matrix: the distance in " +
    "RGB and in the CbCr plane (which ignores brightness, so shadows on the screen still key), the alpha from a " +
    "tolerance and softness ramp, and spill suppression that limits green (or blue) to the average or the larger of " +
    "the other two channels. Colour difference (ΔE) and colour conversion are under Colour & appearance.",
  fields: [
    { key: "key", label: "Key colour R′, G′, B′", default: "0.1, 0.65, 0.2", kind: "text" },
    { key: "pix", label: "Pixel R′, G′, B′", default: "0.35, 0.55, 0.3", kind: "text" },
    { key: "scale", label: "Values are", default: "1", kind: "select", options: [{ value: "1", label: "0 to 1" }, { value: "255", label: "8-bit, 0 to 255" }] },
    { key: "matrix", label: "Y′CbCr matrix", default: "709", kind: "select", options: [{ value: "709", label: "BT.709 (HD)" }, { value: "601", label: "BT.601 (SD)" }] },
    { key: "metric", label: "Alpha from the distance in", default: "cbcr", kind: "select", options: [{ value: "cbcr", label: "CbCr (chroma only)" }, { value: "rgb", label: "RGB" }] },
    { key: "tol", label: "Tolerance (distance keyed fully out)", default: "0.08", kind: "text" },
    { key: "soft", label: "Softness (ramp width beyond the tolerance)", default: "0.15", kind: "text" },
    { key: "screen", label: "Screen colour", default: "auto", kind: "select", options: [{ value: "auto", label: "From the key colour" }, { value: "green", label: "Green" }, { value: "blue", label: "Blue" }] },
    { key: "spill", label: "Spill limit", default: "average", kind: "select", options: [{ value: "average", label: "Average of the other two" }, { value: "max", label: "Larger of the other two" }] },
  ],
  compute: (r) => {
    const sc = r("scale") === "255" ? 255 : 1;
    const cols: Record<string, [number, number, number]> = {};
    for (const [k, label] of [["key", "Key colour"], ["pix", "Pixel"]] as const) {
      const v = vec3(r, k, label);
      if (typeof v === "string") return refuse(v);
      cols[k] = [v[0] / sc, v[1] / sc, v[2] / sc];
    }
    const tol = num(r, "tol", "Tolerance");
    if (typeof tol === "string") return refuse(tol);
    const soft = num(r, "soft", "Softness");
    if (typeof soft === "string") return refuse(soft);
    const m = (r("matrix") === "601" ? "601" : "709") as YcbcrMatrix;
    const metric = (r("metric") === "rgb" ? "rgb" : "cbcr") as KeyMetric;
    const screen = (["auto", "green", "blue"].includes(r("screen")) ? r("screen") : "auto") as "auto" | "green" | "blue";
    const variant = (r("spill") === "max" ? "max" : "average") as SpillVariant;
    const k = chromaKey(cols.key, cols.pix, m, metric, tol, soft, screen, variant);
    if (!k.ok) return refuse(k.error);
    const ch = k.channel === 1 ? "green" : "blue";
    const others = k.channel === 1 ? "red and blue" : "red and green";
    const where = k.alpha === 0 ? "inside the tolerance, so it keys fully out (alpha 0)" : k.alpha === 1 ? "beyond the softness edge, so it stays fully opaque (alpha 1)" : `between the tolerance and the softness edge, so it keys to alpha ${d(k.alpha, 3)}`;
    const lines: EngLine[] = [];
    lines.push(
      `The pixel is ${d(k.dCbCr, 4)} from the key in CbCr (${d(k.dRgb, 4)} in RGB), ${where}; spill suppression (${variant === "average" ? "average" : "max"} of ${others}) ${k.spill > 0 ? `lowers its ${ch} from ${d(cols.pix[k.channel], 4)} to ${d(k.suppressed[k.channel], 4)}` : `leaves its ${ch} at ${d(cols.pix[k.channel], 4)} (no spill)`}.`,
    );
    lines.push({ math: "Y' = K_R R' + (1 - K_R - K_B) G' + K_B B'", fallback: "Y′ = K(R)·R′ + (1 − K(R) − K(B))·G′ + K(B)·B′" });
    lines.push({ math: "C_b = (B' - Y')/(2 (1 - K_B)), C_r = (R' - Y')/(2 (1 - K_R))", fallback: "C(b) = (B′ − Y′)/(2(1 − K(B))), C(r) = (R′ − Y′)/(2(1 − K(R)))" });
    lines.push({ math: "alpha = min(1, max(0, (d - t)/s))", fallback: "α = min(1, max(0, (d − t)/s))" });
    lines.push(`BT.${m}: K(R) = ${KR(m)[0]}, K(B) = ${KR(m)[1]}. Key Y′CbCr ${v3(k.keyYcc, 5)}; pixel ${v3(k.pixYcc, 5)} (Y′ 0 to 1, Cb and Cr −0.5 to 0.5; 8-bit narrow range: Y′ ${d(16 + 219 * k.pixYcc[0], 1)}, Cb ${d(128 + 224 * k.pixYcc[1], 1)}, Cr ${d(128 + 224 * k.pixYcc[2], 1)}).`);
    lines.push(`Distance: CbCr ${d(k.dCbCr, 5)}, RGB ${d(k.dRgb, 5)} (RGB distances run to √3 = 1.732; CbCr to √2/2 = 0.7071 for colours inside the RGB cube). The alpha uses the ${metric === "cbcr" ? "CbCr" : "RGB"} distance: tolerance ${t(tol)}, softness ${t(soft)}${soft === 0 ? " (a hard key)" : ""}, alpha ${d(k.alpha, 5)}.`);
    lines.push(`Spill: ${ch} is limited to the ${variant === "average" ? `average of ${others}, ${d(k.limit, 5)}` : `larger of ${others}, ${d(k.limit, 5)}`}; suppressed pixel ${v3(k.suppressed, 5)}, ${d(k.spill, 5)} of ${ch} removed. The ${variant === "average" ? "max" : "average"} variant's limit would be ${d(k.otherLimit, 5)} (${variant === "average" ? "gentler: it keeps more of yellows and cyans" : "stronger: it also pulls greys toward magenta"}).`);
    lines.push("Assumes: gamma-encoded R′G′B′ (Y′CbCr is defined on the encoded signal, not on linear light), full-range values, and a key that is a single colour; keyers such as Keylight and Primatte use their own colour models. The ramp is linear in the distance.");
    const rows: string[][] = [
      ["Quantity", "Key", "Pixel"],
      ["Y′", d(k.keyYcc[0], 5), d(k.pixYcc[0], 5)],
      ["Cb", d(k.keyYcc[1], 5), d(k.pixYcc[1], 5)],
      ["Cr", d(k.keyYcc[2], 5), d(k.pixYcc[2], 5)],
      ["Distance CbCr / RGB", "", `${d(k.dCbCr, 5)} / ${d(k.dRgb, 5)}`],
      ["Alpha", "", d(k.alpha, 5)],
      ["After spill suppression", "", v3(k.suppressed, 5)],
    ];
    const outputs: EngOutput[] = [
      { key: "dCbCr", label: "CbCr distance", value: k.dCbCr, unit: "" },
      { key: "dRgb", label: "RGB distance", value: k.dRgb, unit: "" },
      { key: "alpha", label: "Alpha", value: k.alpha, unit: "" },
      { key: "spill", label: "Spill removed", value: k.spill, unit: "" },
    ];
    return finish(lines, [], [
      table("Chroma key", rows),
      plot(cbcrSvg([k.keyYcc[1], k.keyYcc[2]], [k.pixYcc[1], k.pixYcc[2]], metric === "cbcr" ? tol : null, metric === "cbcr" ? soft : null), "The CbCr plane: the key, the pixel and the tolerance and softness circles", "The Cb against Cr chroma plane with the key colour, the pixel, the neutral point and the tolerance and softness circles around the key"),
    ], outputs, false);
  },
};

const KR = (m: YcbcrMatrix): [number, number] => (m === "601" ? [0.299, 0.114] : [0.2126, 0.0722]);

// ---------------------------------------------------------------------------------------------------------------
// 10. Miniatures, high-speed and simulation scale
// ---------------------------------------------------------------------------------------------------------------

/** "1:16", "1/16" or "16". */
function scaleN(raw: string): number | string {
  const s = (raw ?? "").trim();
  const m = /^\s*1\s*[:/]\s*([0-9.]+)\s*$/.exec(s);
  const v = m ? Number(m[1]) : plain(s);
  if (!Number.isFinite(v)) return `Scale: "${s}" is not a scale (write 1:16 or 16).`;
  return v;
}

const simScaleCalc: VfxCalc = {
  id: "vfx-sim-scale",
  name: "Miniatures, high-speed & sim scale (Froude, Reynolds, CFL)",
  group: "VFX & compositing",
  unitContract: "converts",
  hint:
    "Froude scaling for miniature effects: a 1:n model shot at fps·√n plays back with real-looking gravity (time, " +
    "velocity and fall scale by √n); the Reynolds and Weber numbers it cannot match (why miniature water looks wrong); " +
    "and a fluid sim's CFL timestep and substeps per frame from the voxel size and the fastest velocity. Navier–Stokes " +
    "is solved by the simulator, not by a calculator: this is the part of it a calculator can answer honestly. " +
    "Reynolds number on its own and pipe flow are under Fluids.",
  fields: [
    { key: "n", label: "Miniature scale (1:n)", default: "1:16", kind: "text" },
    { key: "fps", label: "Playback frame rate (fps)", default: "24", kind: "text" },
    { key: "fall", label: "Real fall height (m; blank to skip)", default: "10 m", kind: "text" },
    { key: "U", label: "Real characteristic velocity (m/s)", default: "5 m/s", kind: "text" },
    { key: "L", label: "Real characteristic length (m)", default: "2 m", kind: "text" },
    { key: "nu", label: "Kinematic viscosity (m²/s; water 1.004 cSt at 20 °C)", default: "1.004 cSt", kind: "text" },
    { key: "rho", label: "Density (kg/m³)", default: "998 kg/m^3", kind: "text" },
    { key: "sigma", label: "Surface tension (N/m; blank to skip Weber)", default: "0.0728 N/m", kind: "text" },
    { key: "dx", label: "Sim voxel size (m)", default: "5 cm", kind: "text" },
    { key: "umax", label: "Sim maximum velocity (m/s)", default: "8 m/s", kind: "text" },
    { key: "simFps", label: "Sim frame rate (fps)", default: "24", kind: "text" },
    { key: "C", label: "CFL number (1 is common for FLIP; lower for smoke)", default: "1", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const fall = u.opt("fall", "m", "m", "Fall height");
    const U = u.req("U", "m/s", "m/s", "Velocity");
    const L = u.req("L", "m", "m", "Length");
    const nu = u.req("nu", "m^2/s", "m²/s", "Kinematic viscosity");
    const rho = u.req("rho", "kg/m^3", "kg/m³", "Density");
    const sigma = u.opt("sigma", "N/m", "N/m", "Surface tension");
    const dx = u.req("dx", "m", "m", "Voxel size");
    const umax = u.req("umax", "m/s", "m/s", "Maximum velocity");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const n = scaleN(r("n"));
    if (typeof n === "string") return refuse(n);
    const fps = num(r, "fps", "Playback frame rate");
    if (typeof fps === "string") return refuse(fps);
    const simFps = num(r, "simFps", "Sim frame rate");
    if (typeof simFps === "string") return refuse(simFps);
    const C = num(r, "C", "CFL number");
    if (typeof C === "string") return refuse(C);
    const s = froudeScale({ n, fps, fall, U, L, nu, rho, sigma });
    if (!s.ok) return refuse(s.error);
    const c = cfl(dx, umax, simFps, C);
    if (!c.ok) return refuse(c.error);
    const lines: EngLine[] = [];
    lines.push(
      `A 1:${t(n, 4)} miniature must be shot at ${t(s.shootFps, 4)} fps to play back at ${t(fps, 4)} fps with real-looking gravity; its Reynolds number is ${t(Math.pow(n, 1.5), 4)} times lower, so the water or smoke will not break up like the real thing. ` +
        `The sim needs ${plural(c.substeps, "substep")} per frame at CFL ${t(C)} (${t(umax, 4)} m/s through ${t(dx * 100, 4)} cm voxels).`,
    );
    lines.push({ math: "f_shoot = f sqrt(n)", fallback: "f(shoot) = f·√n" });
    lines.push({ math: "t_m = t/sqrt(n), v_m = v/sqrt(n), L_m = L/n", fallback: "t(m) = t/√n, v(m) = v/√n, L(m) = L/n" });
    lines.push({ math: "Fr = U/sqrt(g L), Re = (U L)/nu, We = (rho U^2 L)/sigma", fallback: "Fr = U/√(g·L), Re = U·L/ν, We = ρ·U²·L/σ" });
    lines.push({ math: "Delta t <= (C Delta x)/u_max", fallback: "Δt ≤ C·Δx/u(max)" });
    lines.push(`Froude scaling keeps Fr = U/√(gL) = ${t(s.Fr, 4)} the same at both scales: velocities scale by 1/√n = ${t(1 / s.sqrtN, 4)} (${t(U, 4)} → ${t(s.Um, 4)} m/s), lengths by 1/n (${t(L, 4)} → ${t(s.Lm, 4)} m), times by 1/√n, so the camera runs √n = ${t(s.sqrtN, 4)} times faster: ${t(s.shootFps, 5)} fps for ${t(fps, 4)} fps playback.`);
    if (s.fall) lines.push(`Fall: ${t(s.fall.h, 4)} m takes ${t(s.fall.t, 4)} s and lands at ${t(s.fall.vReal, 4)} m/s; the model's ${t(s.fall.hm, 4)} m takes ${t(s.fall.tm, 4)} s and lands at ${t(s.fall.vModel, 4)} m/s, which at ${t(s.shootFps, 4)} fps plays back over ${t(s.fall.t, 4)} s.`);
    lines.push(`Reynolds number: real ${t(s.Re, 4)}, model ${t(s.ReM, 4)} (÷ n^1.5 = ${t(Math.pow(n, 1.5), 4)}). Matching both Fr and Re would need a model fluid with ν = ${t(s.nuNeeded, 3)} m²/s; no practical liquid is that thin, which is why miniature water reads as small.${s.We !== null && s.WeM !== null ? ` Weber number: real ${t(s.We, 4)}, model ${t(s.WeM, 4)} (÷ n²): surface tension dominates the model, so drops are too big and too round.` : ""}`);
    lines.push(`CFL: Δt(max) = ${t(C)} × ${t(dx, 4)} m / ${t(umax, 4)} m/s = ${t(c.dtMax, 4)} s against a ${t(c.frameTime, 4)} s frame: ${plural(c.substeps, "substep")} per frame (Δt = ${t(c.dt, 4)} s). The fastest fluid crosses ${t(c.cellsPerFrame, 4)} voxels per frame.`);
    lines.push(`Gravity in the sim's units: ${t(G0)} m/s² is ${t(G0 * 100)} cm/s² in a centimetre scene; a sim built in centimetres with g left at 9.81 falls 100 times too weakly, and everything moves √100 = 10 times too slowly. Voxel size and velocity must be in the same unit as the scene.`);
    lines.push("Assumes: gravity-driven motion at both scales (Froude similarity), the same fluid in the model, and incompressible flow for the CFL limit; viscosity and surface tension are real-world values at about 20 °C unless typed. The CFL number a solver allows is its own (FLIP and PIC tolerate about 1 to 5; explicit smoke advection about 1).");
    const rows: string[][] = [
      ["Quantity", "Real", "Model (1:" + t(n, 4) + ")"],
      ["Frame rate (fps)", t(fps, 5), t(s.shootFps, 5)],
      ["Velocity (m/s)", t(U, 5), t(s.Um, 5)],
      ["Length (m)", t(L, 5), t(s.Lm, 5)],
      ["Froude number", t(s.Fr, 5), t(s.Fr, 5)],
      ["Reynolds number", t(s.Re, 5), t(s.ReM, 5)],
    ];
    if (s.We !== null && s.WeM !== null) rows.push(["Weber number", t(s.We, 5), t(s.WeM, 5)]);
    if (s.fall) rows.push(["Fall time (s)", t(s.fall.t, 5), t(s.fall.tm, 5)]);
    rows.push(["CFL substeps per frame", String(c.substeps), ""]);
    const outputs: EngOutput[] = [
      { key: "shootFps", label: "Shooting frame rate", value: s.shootFps, unit: "fps" },
      { key: "ReM", label: "Model Reynolds number", value: s.ReM, unit: "" },
      { key: "substeps", label: "CFL substeps per frame", value: c.substeps, unit: "" },
      { key: "dtMax", label: "CFL timestep", value: c.dtMax, unit: "s" },
    ];
    return finish(lines, u.conversions, [
      table("Miniature and simulation scale", rows),
      plot(froudeSvg(fps, n), "Shooting frame rate for a miniature under Froude scaling", "The shooting frame rate rising as the square root of the miniature scale, this scale marked"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 11. Rigid-body collision and drop
// ---------------------------------------------------------------------------------------------------------------

const collisionCalc: VfxCalc = {
  id: "vfx-collision",
  name: "Rigid-body drop & collision: restitution, friction, scene units",
  group: "VFX & compositing",
  unitContract: "domain",
  hint:
    "A body dropped in the scene's units (gravity is 980.665 cm/s² in a centimetre scene, not 9.81): drop time, impact " +
    "speed, bounce height and the time until it settles; then the impact itself with restitution and Coulomb friction " +
    "(impulse model, against the ground or a second body): velocities before and after, whether it slides or sticks, " +
    "and the energy lost. Projectiles with drag: Trajectory & orbits.",
  fields: [
    { key: "unit", label: "Scene unit", default: "cm", kind: "select", options: Object.entries(SCENE_UNITS).map(([value, u]) => ({ value, label: u.label })) },
    { key: "h", label: "Drop height (scene units)", default: "200", kind: "text" },
    { key: "e", label: "Restitution e (0 to 1)", default: "0.6", kind: "text" },
    { key: "mu", label: "Friction coefficient μ", default: "0.4", kind: "text" },
    { key: "m1", label: "Body 1 mass (any unit)", default: "1", kind: "text" },
    { key: "m2", label: "Body 2 mass (blank = the immovable ground)", default: "", kind: "text" },
    { key: "u1", label: "Body 1 normal speed toward body 2 (blank = the drop's impact speed)", default: "", kind: "text" },
    { key: "u2", label: "Body 2 normal speed, same direction (0 for the ground)", default: "0", kind: "text" },
    { key: "vt", label: "Body 1 sliding speed along the surface (scene units/s)", default: "150", kind: "text" },
  ],
  compute: (r) => {
    const unit = SCENE_UNITS[r("unit")] ? r("unit") : "cm";
    const U = SCENE_UNITS[unit];
    const vals: Record<string, number> = {};
    for (const [k, label] of [["h", "Drop height"], ["e", "Restitution"], ["mu", "Friction coefficient"], ["m1", "Body 1 mass"], ["u2", "Body 2 speed"], ["vt", "Sliding speed"]] as const) {
      const v = num(r, k, label);
      if (typeof v === "string") return refuse(v);
      vals[k] = v;
    }
    const dr = drop(vals.h, U.m, vals.e);
    if (!dr.ok) return refuse(dr.error);
    const m2raw = (r("m2") ?? "").trim();
    const m2 = m2raw ? plain(m2raw) : null;
    if (m2raw && !Number.isFinite(m2 as number)) return refuse(`Body 2 mass: "${m2raw}" is not a finite number.`);
    const u1raw = (r("u1") ?? "").trim();
    const u1 = u1raw ? plain(u1raw) : dr.v;
    if (u1raw && !Number.isFinite(u1)) return refuse(`Body 1 speed: "${u1raw}" is not a finite number.`);
    const im = impact({ m1: vals.m1, m2, u1, u2: vals.u2, vt: vals.vt, e: vals.e, mu: vals.mu });
    if (!im.ok) return refuse(im.error);
    const us = unit === "m" ? "m" : unit;
    const lines: EngLine[] = [];
    const frac = im.keBefore > 0 ? im.lost / im.keBefore : 0;
    lines.push(
      `Dropped ${t(vals.h)} ${us} in a ${U.noun} scene (g = ${t(dr.g, 6)} ${us}/s²), it lands after ${t(dr.t, 4)} s at ${t(dr.v, 4)} ${us}/s and bounces back to ${t(dr.bounce, 4)} ${us}${dr.tRest !== null ? `, settling after about ${t(dr.tRest, 3)} s` : ""}. ` +
        `The impact loses ${t(frac * 100, 3)} % of the kinetic energy, and friction ${im.sticks ? "stops the sliding at contact" : `slows the sliding from ${t(vals.vt, 4)} to ${t(im.v1t, 4)} ${us}/s`}.`,
    );
    lines.push({ math: "t = sqrt((2 h)/g), v = sqrt(2 g h), h_1 = e^2 h", fallback: "t = √(2h/g), v = √(2g·h), h₁ = e²·h" });
    lines.push({ math: "J_n = (1 + e) m_eff v_rel", fallback: "J(n) = (1 + e)·m(eff)·v(rel)" });
    lines.push({ math: "J_t = min(mu J_n, m_eff abs(v_t))", fallback: "J(t) = min(μ·J(n), m(eff)·|v(t)|)" });
    lines.push(`Drop: g = 9.80665 m/s² = ${t(dr.g, 6)} ${us}/s²; ${t(vals.h)} ${us} takes ${t(dr.t, 5)} s and lands at ${t(dr.v, 5)} ${us}/s. With e = ${t(vals.e)} it rebounds to e²h = ${t(dr.bounce, 5)} ${us}${dr.tRest !== null ? `; the bounces sum to t(1 + e)/(1 − e) = ${t(dr.tRest, 5)} s` : "; e = 1 bounces for ever"}. ${unit === "m" ? "" : `A sim built in ${U.label} with g left at 9.81 would take ${t(Math.sqrt(dr.g / 9.81), 4)} times as long to fall.`}`);
    lines.push(`Impact (${m2 === null ? "against the immovable ground" : `body 2 of mass ${t(m2 as number)}`}): closing speed ${t(im.approach, 5)} ${us}/s, effective mass ${t(im.mEff, 5)}; normal impulse ${t(im.Jn, 5)}, friction impulse ${t(im.Jt, 5)} (${im.sticks ? "μJ(n) is enough to stop the sliding: the contact sticks" : "below what stopping the slide needs: it keeps sliding"}).`);
    lines.push(`After: body 1 normal ${d(im.v1n, 4)} ${us}/s (${im.v1n < 0 ? "rebounding" : "still moving toward body 2"}), sliding ${d(im.v1t, 4)} ${us}/s${m2 !== null ? `; body 2 normal ${d(im.v2n, 4)}, sliding ${d(im.v2t, 4)} ${us}/s` : ""}.`);
    lines.push(`Kinetic energy (mass × ${us}²/s²): ${t(im.keBefore, 5)} before, ${t(im.keAfter, 5)} after; ${t(im.lost, 5)} lost (${t(frac * 100, 4)} %): ${t(im.lostNormal, 5)} to restitution (1 − e² of the normal closing energy) and ${t(im.lostFriction, 5)} to friction.`);
    lines.push("Assumes: point masses (no rotation: a real ball's friction would also start it spinning and rolling), one instantaneous impulse (Newton's restitution and Coulomb friction), no air drag, and the ground immovable unless body 2 has a mass. Rigid-body solvers (Bullet, PhysX, Houdini RBD) use the same impulse model with their own contact iteration.");
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Gravity", `${t(dr.g, 6)} ${us}/s²`],
      ["Drop time", `${t(dr.t, 5)} s`],
      ["Impact speed", `${t(dr.v, 5)} ${us}/s`],
      ["Bounce height", `${t(dr.bounce, 5)} ${us}`],
      ["Body 1 after (normal, sliding)", `${d(im.v1n, 4)}, ${d(im.v1t, 4)} ${us}/s`],
      ["Energy lost", `${t(frac * 100, 4)} %`],
    ];
    const outputs: EngOutput[] = [
      { key: "t", label: "Drop time", value: dr.t, unit: "s" },
      { key: "v", label: "Impact speed", value: dr.v, unit: `${us}/s` },
      { key: "bounce", label: "Bounce height", value: dr.bounce, unit: us },
      { key: "lost", label: "Energy lost", value: frac * 100, unit: "%" },
    ];
    return finish(lines, [], [
      table("Drop and impact", rows),
      plot(bounceSvg(vals.h, vals.e, U.m, us), `Height against time, gravity ${t(dr.g, 5)} ${us}/s²`, "Height of the dropped body against time through its bounces, the impacts marked"),
    ], outputs, false);
  },
};


/** The VFX & compositing calculators, in dropdown order. */
export const VFX_CALCS: VfxCalc[] = [retimeCalc, frameRangeCalc, cameraCalc, projectionCalc, transformCalc, shadingCalc, logCalc, compositeCalc, chromaCalc, simScaleCalc, collisionCalc];
