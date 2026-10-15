// SMPTE timecode (ST 12-1) — label <-> frame count <-> real time, exactly.
//
// DROP-FRAME IS A LABELLING SCHEME. No picture is ever dropped. At 30000/1001
// frames per second a counter that ticks 30 labels per "second" falls behind
// the wall clock by 3.6 s per hour, so ST 12-1 skips LABELS: ;00 and ;01 at the
// start of every minute except minutes divisible by ten (;00–;03 at 60000/1001).
// Real elapsed time is ALWAYS frames × 1001/30000 s, whatever the label says.
//
// EVERYTHING HERE IS INTEGER OR RATIONAL ARITHMETIC. Frame numbers are integers
// and real time is a BigInt fraction; nothing is accumulated in floating point,
// and nothing iterates per frame (a 24-hour count is a few multiplications).
//
// VALIDITY IS DECIDED BY THE ST 12-1 RULE, NOT BY A LIBRARY. The Python
// `timecode` package silently maps the non-existent label 00:01:00;00 to frame
// 1798; a label that does not exist is REFUSED here, by name, with the real
// labels either side of it.
//
// Frame numbers are 0-based: 00:00:00:00 is frame 0.

export interface TcError {
  ok: false;
  error: string;
}

// --- Exact rationals (BigInt) ------------------------------------------------

/** A reduced fraction with a positive denominator. */
export interface Rational {
  num: bigint;
  den: bigint;
}

function babs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Build a reduced rational. Throws on a zero denominator (a programming error). */
export function rat(num: bigint | number, den: bigint | number = 1n): Rational {
  let n = typeof num === "bigint" ? num : BigInt(num);
  let d = typeof den === "bigint" ? den : BigInt(den);
  if (d === 0n) throw new Error("zero denominator");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bgcd(n, d) || 1n;
  return { num: n / g, den: d / g };
}

export function ratAdd(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den + b.num * a.den, a.den * b.den);
}
export function ratSub(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den - b.num * a.den, a.den * b.den);
}
export function ratMul(a: Rational, b: Rational): Rational {
  return rat(a.num * b.num, a.den * b.den);
}
export function ratDiv(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new Error("division by zero");
  return rat(a.num * b.den, a.den * b.num);
}
/** -1, 0 or 1. */
export function ratCmp(a: Rational, b: Rational): number {
  const d = a.num * b.den - b.num * a.den;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}
export function ratFloor(a: Rational): bigint {
  const q = a.num / a.den;
  return a.num < 0n && q * a.den !== a.num ? q - 1n : q;
}
export function ratCeil(a: Rational): bigint {
  const q = a.num / a.den;
  return a.num > 0n && q * a.den !== a.num ? q + 1n : q;
}
export function ratIsInteger(a: Rational): boolean {
  return a.den === 1n;
}
/** Nearest double. Splits the integer part off so large values keep their digits. */
export function ratToNumber(a: Rational): number {
  const q = a.num / a.den;
  const r = a.num - q * a.den;
  return Number(q) + Number(r) / Number(a.den);
}

/**
 * The rational a finite double DISPLAYS as — its shortest round-trip decimal,
 * which is what the user typed. 29.97 becomes 2997/100, not the binary value
 * 29.969999999999998863…; 1e-7 and 1e21 (exponent notation) are handled.
 */
export function ratFromNumber(x: number): Rational | null {
  if (!Number.isFinite(x)) return null;
  return ratFromDecimalString(String(x));
}

/** Parse "12", "-0.25", "2.39", "1e-7", "3.5E+2" exactly; null otherwise. */
export function ratFromDecimalString(s: string): Rational | null {
  const m = /^\s*([+-])?(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d{1,4}))?\s*$/.exec(s);
  if (!m) return null;
  const intPart = m[2] ?? "";
  const frac = m[3] ?? "";
  if (intPart === "" && frac === "") return null;
  if (intPart.length + frac.length > 400) return null;
  let num = BigInt((intPart || "0") + frac);
  let den = 10n ** BigInt(frac.length);
  const e = m[4] ? parseInt(m[4], 10) : 0;
  if (e > 0) num *= 10n ** BigInt(e);
  else if (e < 0) den *= 10n ** BigInt(-e);
  if (m[1] === "-") num = -num;
  return rat(num, den);
}

/** Parse "30000/1001", "2.39", "16:9"-style is NOT accepted here (see video.ts). */
export function ratFromText(s: string): Rational | null {
  const t = s.trim();
  if (t.length > 64) return null;
  const slash = /^([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (slash) {
    const a = ratFromDecimalString(slash[1]);
    const b = ratFromDecimalString(slash[2]);
    if (!a || !b || b.num === 0n) return null;
    return ratDiv(a, b);
  }
  return ratFromDecimalString(t);
}

/**
 * Exact decimal text when the fraction terminates within `maxDigits`, otherwise
 * `maxDigits` places followed by "…". Never exponent notation, never float noise.
 */
export function ratToDecimal(a: Rational, maxDigits = 9): { text: string; exact: boolean } {
  const neg = a.num < 0n;
  const n = babs(a.num);
  const ip = n / a.den;
  let rem = n % a.den;
  let digits = "";
  while (rem !== 0n && digits.length < maxDigits) {
    rem *= 10n;
    digits += (rem / a.den).toString();
    rem %= a.den;
  }
  const exact = rem === 0n;
  const body = digits ? `${ip}.${digits}` : `${ip}`;
  return { text: (neg ? "-" : "") + body + (exact ? "" : "…"), exact };
}

/** "3603.6", or "1001/30 (33.3666…)" when the decimal does not terminate. */
export function ratLabel(a: Rational, maxDigits = 6): string {
  const d = ratToDecimal(a, maxDigits);
  if (d.exact) return d.text;
  return `${a.num}/${a.den} (${d.text})`;
}

// --- Frame rates -------------------------------------------------------------

export interface FrameRate {
  ok: true;
  /** Canonical id: "23.976", "24", "25", "29.97", "30", "50", "59.94", "60". */
  id: string;
  /** Exact frames per second. */
  fps: Rational;
  /** The integer count of labels per timecode second (24, 25, 30, 50, 60). */
  nominal: number;
  /** True for the 1000/1001 rates. */
  fractional: boolean;
  /** Labels dropped per minute when drop-frame is used; 0 where DF is undefined. */
  dropPerMinute: number;
  /** Set when the input was a decimal snapped to a 1000/1001 rational, saying so. */
  snapNote: string | null;
  /** Drop-frame requested in the rate text ("29.97 DF" → true, "NDF" → false), else null. */
  dfInText: boolean | null;
}

interface RateDef {
  id: string;
  nominal: number;
  fractional: boolean;
  drop: number;
}

const RATES: RateDef[] = [
  { id: "23.976", nominal: 24, fractional: true, drop: 0 },
  { id: "24", nominal: 24, fractional: false, drop: 0 },
  { id: "25", nominal: 25, fractional: false, drop: 0 },
  { id: "29.97", nominal: 30, fractional: true, drop: 2 },
  { id: "30", nominal: 30, fractional: false, drop: 0 },
  { id: "50", nominal: 50, fractional: false, drop: 0 },
  { id: "59.94", nominal: 60, fractional: true, drop: 4 },
  { id: "60", nominal: 60, fractional: false, drop: 0 },
];

/** The rate list in one line, for refusals. */
export const RATE_LIST = "23.976, 24, 25, 29.97, 30, 50, 59.94 and 60";

function makeRate(def: RateDef, snapNote: string | null, dfInText: boolean | null): FrameRate {
  return {
    ok: true,
    id: def.id,
    fps: def.fractional ? rat(def.nominal * 1000, 1001) : rat(def.nominal),
    nominal: def.nominal,
    fractional: def.fractional,
    dropPerMinute: def.drop,
    snapNote,
    dfInText,
  };
}

/**
 * Read a frame rate: a number, "29.97", "29.97 fps", "29.97 DF", "59.94 NDF",
 * "30000/1001", "23.98". The 1000/1001 rates are SNAPPED to their exact
 * rationals and the snap is reported: a decimal 29.97 is about 1 ppm slower
 * than 30000/1001, which would run elapsed time ~3.6 ms per hour long.
 * Anything else is refused by name — there is no "nearest" rate.
 */
export function parseRate(input: string | number): FrameRate | TcError {
  let text: string;
  let dfInText: boolean | null = null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, error: "The frame rate must be a finite number." };
    text = String(input);
  } else {
    text = input.trim();
    if (text.length > 40) return { ok: false, error: "That frame rate is too long to be one." };
    const flag = /\s*(NDF|DF)\s*$/i.exec(text);
    if (flag) {
      dfInText = flag[1].toUpperCase() === "DF";
      text = text.slice(0, flag.index).trim();
    }
    text = text.replace(/\s*(fps|frames\/s|frames per second|hz|p)\s*$/i, "").trim();
    // The product comma rule: "29,97" is 29.97 (a decimal comma).
    if (/^\d+,\d+$/.test(text)) text = text.replace(",", ".");
  }
  const r = ratFromText(text);
  if (!r) return { ok: false, error: `"${typeof input === "string" ? input.trim() : input}" is not a frame rate.` };
  if (r.num <= 0n) return { ok: false, error: "The frame rate must be greater than zero." };

  for (const def of RATES) {
    const exact = def.fractional ? rat(def.nominal * 1000, 1001) : rat(def.nominal);
    if (ratCmp(r, exact) === 0) return makeRate(def, null, dfInText);
  }
  // Decimal spellings of the 1000/1001 rates: within 0.005 fps (23.98, 23.976,
  // 29.97, 59.94, 29.97002997…). 29.96 or 30.5 are not a rate and are refused.
  const x = ratToNumber(r);
  for (const def of RATES) {
    if (!def.fractional) continue;
    const exactN = (def.nominal * 1000) / 1001;
    if (Math.abs(x - exactN) <= 0.005) {
      const typed = ratToDecimal(r, 6).text;
      const ppm = Math.abs(((x - exactN) / exactN) * 1e6);
      const exactName = `${def.nominal * 1000}/1001 = ${ratToDecimal(rat(def.nominal * 1000, 1001), 6).text} fps`;
      return makeRate(
        def,
        ppm < 0.001
          ? `${typed} fps is taken as exactly ${exactName}, the 1000/1001 rate it rounds.`
          : `${typed} fps is taken as ${exactName}, the 1000/1001 rate it names. A decimal ${typed} is not that ` +
              `rate (it differs by ${ppm.toFixed(ppm < 1 ? 3 : 1)} ppm), and dividing frames by it would put elapsed ` +
              "time off by that much.",
        dfInText,
      );
    }
  }
  return {
    ok: false,
    error:
      `${ratToDecimal(r, 6).text} fps is not a timecode rate. SMPTE ST 12-1 timecode is defined here at ${RATE_LIST} fps.`,
  };
}

function resolveRate(rate: FrameRate | string | number): FrameRate | TcError {
  return typeof rate === "object" ? rate : parseRate(rate);
}

/**
 * Settle drop-frame from the explicit flag, the rate text ("29.97 DF") and the
 * label's separator. Conflicts are refused rather than guessed.
 */
function settleDf(rate: FrameRate, df: boolean | undefined, labelSemicolon: boolean | null): boolean | TcError {
  if (df !== undefined && rate.dfInText !== null && df !== rate.dfInText) {
    return { ok: false, error: `The rate says ${rate.dfInText ? "DF" : "NDF"} but drop-frame was set ${df ? "on" : "off"}.` };
  }
  let want = df ?? rate.dfInText ?? (labelSemicolon === true && rate.dropPerMinute > 0);
  if (want && rate.dropPerMinute === 0) {
    return {
      ok: false,
      error:
        `Drop-frame is not defined at ${rate.id} fps. SMPTE ST 12-1 defines it only for the 1000/1001 rates of ` +
        "30 and 60 frames (29.97 and 59.94); 23.976 timecode is always counted non-drop, and 25 fps needs none.",
    };
  }
  if (!want && labelSemicolon === true) {
    return {
      ok: false,
      error:
        rate.dropPerMinute === 0
          ? `A ";" before the frames marks a drop-frame label, and drop-frame does not exist at ${rate.id} fps. ` +
            "Write the label with colons (HH:MM:SS:FF)."
          : `A ";" before the frames marks a drop-frame label, but non-drop (NDF) was chosen. ` +
            "Write NDF labels with colons, or choose drop-frame.",
    };
  }
  want = !!want;
  return want;
}

// --- Labels ------------------------------------------------------------------

export interface TcLabel {
  h: number;
  m: number;
  s: number;
  f: number;
  /** True when the label used ";" (the drop-frame convention). */
  semicolon: boolean;
}

/** Parse "HH:MM:SS:FF" or "HH:MM:SS;FF" (also all-";" and "." before frames). */
export function parseTimecode(text: string): TcLabel | TcError {
  const t = text.trim();
  if (t.length > 32) return { ok: false, error: "That is too long to be a timecode." };
  if (/^-/.test(t)) {
    return {
      ok: false,
      error:
        "A timecode label cannot be negative: SMPTE ST 12-1 time addresses run from 00:00:00:00 to " +
        "23:59:59 and the last frame. For a negative duration, enter the two timecodes the other way round.",
    };
  }
  const m = /^(\d{1,2})([:;])(\d{2})([:;])(\d{2})([:;.])(\d{2})$/.exec(t);
  if (!m) {
    return { ok: false, error: `"${t}" is not a timecode. Write HH:MM:SS:FF, or HH:MM:SS;FF for drop-frame.` };
  }
  // ";" anywhere, or "." before the frames (the ST 12-1 alternative where ";"
  // is unavailable), marks a drop-frame label.
  const semicolon = m[2] === ";" || m[4] === ";" || m[6] === ";" || m[6] === ".";
  return { h: +m[1], m: +m[3], s: +m[5], f: +m[7], semicolon };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Canonical text for a label. */
export function formatTimecode(h: number, m: number, s: number, f: number, df: boolean): string {
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}${df ? ";" : ":"}${pad2(f)}`;
}

/** Frames in one 24-hour timecode day at this rate and counting mode. */
export function framesPerDay(rate: FrameRate, df: boolean): number {
  const n = rate.nominal;
  if (!df) return 24 * 3600 * n;
  // 1440 minutes, of which 144 (the multiples of 10) keep every label.
  return 24 * 3600 * n - rate.dropPerMinute * (1440 - 144);
}

export interface TcFramesResult {
  ok: true;
  /** 0-based frame number of the label. */
  frames: number;
  /** The label as written canonically (";" before the frames for DF). */
  label: string;
  df: boolean;
  rate: FrameRate;
  /** Real elapsed time from 00:00:00:00, exact. */
  realSeconds: Rational;
  notes: string[];
}

/**
 * Timecode label → 0-based frame number (SMPTE ST 12-1).
 * DF: frames = (3600h + 60m + s)·N + f − D·(totalMinutes − ⌊totalMinutes/10⌋),
 * N = 30 or 60, D = 2 or 4. A label the drop rule skipped is REFUSED.
 */
export function tcToFrames(tc: string, rateIn: FrameRate | string | number, df?: boolean): TcFramesResult | TcError {
  const rate = resolveRate(rateIn);
  if (!rate.ok) return rate;
  const L = parseTimecode(tc);
  if ("ok" in L) return L;
  const dfR = settleDf(rate, df, L.semicolon);
  if (typeof dfR !== "boolean") return dfR;
  const isDf = dfR;
  const notes: string[] = [];
  if (L.h > 23) {
    return {
      ok: false,
      error: `Hour ${L.h} does not exist: SMPTE ST 12-1 timecode is a 24-hour clock (00–23) and wraps to 00:00:00:00 at midnight.`,
    };
  }
  if (L.m > 59) return { ok: false, error: `Minute ${L.m} does not exist (00–59).` };
  if (L.s > 59) return { ok: false, error: `Second ${L.s} does not exist (00–59).` };
  if (L.f >= rate.nominal) {
    return {
      ok: false,
      error:
        `Frame ${pad2(L.f)} does not exist at ${rate.id} fps: the frame field counts 00–${pad2(rate.nominal - 1)} ` +
        `(${rate.nominal} labels per timecode second).`,
    };
  }
  const D = rate.dropPerMinute;
  if (isDf && L.s === 0 && L.f < D && L.m % 10 !== 0) {
    const minuteStart = tcToFramesUnchecked(L.h, L.m, 0, D, rate.nominal, D, true);
    const before = framesToLabel(minuteStart - 1, rate, true);
    const after = formatTimecode(L.h, L.m, 0, D, true);
    const dropped = D === 2 ? ";00 and ;01" : ";00–;03";
    return {
      ok: false,
      error:
        `${formatTimecode(L.h, L.m, L.s, L.f, true)} does not exist at ${rate.id} drop-frame: labels ${dropped} of ` +
        `minute ${L.m} are dropped (SMPTE ST 12-1 skips them at the start of every minute except minutes divisible ` +
        `by 10). The label before it is ${before} and the next is ${after}.`,
    };
  }
  if (isDf && !L.semicolon) {
    notes.push("Drop-frame labels are conventionally written with \";\" before the frames (HH:MM:SS;FF); read as drop-frame as chosen.");
  }
  const frames = tcToFramesUnchecked(L.h, L.m, L.s, L.f, rate.nominal, D, isDf);
  const realSeconds = framesToSeconds(frames, rate);
  if (rate.snapNote) notes.push(rate.snapNote);
  notes.push("Frame numbers are 0-based: 00:00:00:00 is frame 0.");
  return { ok: true, frames, label: formatTimecode(L.h, L.m, L.s, L.f, isDf), df: isDf, rate, realSeconds, notes };
}

function tcToFramesUnchecked(h: number, m: number, s: number, f: number, n: number, D: number, df: boolean): number {
  const base = (3600 * h + 60 * m + s) * n + f;
  if (!df) return base;
  const tm = 60 * h + m;
  return base - D * (tm - Math.floor(tm / 10));
}

/** Label for an in-range frame number (0 ≤ n < framesPerDay). */
function framesToLabel(n: number, rate: FrameRate, df: boolean): string {
  const N = rate.nominal;
  let x = n;
  if (df) {
    const D = rate.dropPerMinute;
    const per10 = 600 * N - 9 * D;
    const perMin = 60 * N - D;
    const d = Math.floor(x / per10);
    const r = x % per10;
    x += 9 * D * d + (r > D ? D * Math.floor((r - D) / perMin) : 0);
  }
  const f = x % N;
  const totalS = Math.floor(x / N);
  return formatTimecode(Math.floor(totalS / 3600), Math.floor(totalS / 60) % 60, totalS % 60, f, df);
}

export interface TcLabelResult {
  ok: true;
  label: string;
  frames: number;
  df: boolean;
  rate: FrameRate;
  /** Whole 24-hour days the count wrapped by (0 inside one day; negative before midnight). */
  dayOffset: number;
  realSeconds: Rational;
  notes: string[];
}

/**
 * 0-based frame number → timecode label. A count outside one 24-hour day is
 * WRAPPED (timecode is a 24-hour clock), and the wrap is reported in
 * `dayOffset` and in a note — never silently.
 */
export function framesToTc(nIn: number | string, rateIn: FrameRate | string | number, df?: boolean): TcLabelResult | TcError {
  const rate = resolveRate(rateIn);
  if (!rate.ok) return rate;
  let n: number;
  if (typeof nIn === "string") {
    // A comma is accepted ONLY as a thousands separator in strict groups of
    // three ("1,800"); "1,5" is a decimal comma in much of the world and is
    // refused, never read as 15.
    const raw = nIn.trim();
    if (raw.length > 40) return { ok: false, error: "That is too long to be a frame count." };
    const grouped = /^[+-]?\d{1,3}(,\d{3})+$/.test(raw);
    if (raw.includes(",") && !grouped) {
      return { ok: false, error: `"${raw}" is not a whole number of frames (a comma here reads as a decimal point; frames are whole).` };
    }
    const t = raw.replace(/,/g, "");
    if (!/^[+-]?\d{1,16}$/.test(t)) return { ok: false, error: `"${raw}" is not a whole number of frames.` };
    n = Number(t);
  } else n = nIn;
  if (!Number.isFinite(n)) return { ok: false, error: "The frame count must be a finite number." };
  if (!Number.isInteger(n)) return { ok: false, error: "A frame count is a whole number; frames are not divisible." };
  if (!Number.isSafeInteger(n)) return { ok: false, error: "That frame count is beyond exact integer range (over 9×10¹⁵)." };
  const dfR = settleDf(rate, df, null);
  if (typeof dfR !== "boolean") return dfR;
  const perDay = framesPerDay(rate, dfR);
  const dayOffset = Math.floor(n / perDay);
  const inDay = n - dayOffset * perDay;
  const notes: string[] = [];
  if (dayOffset !== 0) {
    notes.push(
      `Frame ${n} is ${dayOffset > 0 ? "past" : "before"} one 24-hour timecode day (${perDay} frames at ${rate.id}` +
        `${dfR ? " DF" : rate.dropPerMinute ? " NDF" : ""}). Timecode is a 24-hour clock, so the label WRAPS: it is ` +
        `shown on day ${dayOffset > 0 ? "+" : ""}${dayOffset} relative to 00:00:00:00.`,
    );
  }
  if (rate.snapNote) notes.push(rate.snapNote);
  notes.push("Frame numbers are 0-based: frame 0 is 00:00:00:00.");
  return {
    ok: true,
    label: framesToLabel(inDay, rate, dfR),
    frames: n,
    df: dfR,
    rate,
    dayOffset,
    realSeconds: framesToSeconds(n, rate),
    notes,
  };
}

/** Real elapsed time of n frames: n / fps, exact (n × 1001/30000 s at 29.97). */
export function framesToSeconds(n: number, rate: FrameRate): Rational {
  return ratDiv(rat(n), rate.fps);
}

export interface RealTimeResult {
  ok: true;
  frames: number;
  seconds: Rational;
  /** Seconds as a number (display only). */
  secondsApprox: number;
  /** "1:00:03.6" style real time, exact where it terminates. */
  clock: string;
  /** What the NON-DROP label reads, in seconds (frames / nominal). */
  ndfLabelSeconds: Rational;
  /** Real minus NDF-label time, s (positive: the NDF label runs slow). */
  ndfDriftSeconds: Rational;
  notes: string[];
}

/** h:mm:ss.fff of an exact rational second count (sign kept). */
export function clockText(sec: Rational, maxDigits = 6): string {
  const neg = sec.num < 0n;
  const a = neg ? rat(-sec.num, sec.den) : sec;
  const whole = ratFloor(a);
  const frac = ratSub(a, rat(whole));
  const h = whole / 3600n;
  const mm = (whole / 60n) % 60n;
  const ss = whole % 60n;
  const fd = ratToDecimal(frac, maxDigits);
  const fracText = fd.text === "0" ? "" : fd.text.replace(/^0/, "");
  return `${neg ? "−" : ""}${h}:${pad2(Number(mm))}:${pad2(Number(ss))}${fracText}`;
}

/** Real time of a frame count, exact, with the NDF label drift beside it. */
export function realTimeOf(nIn: number, rateIn: FrameRate | string | number): RealTimeResult | TcError {
  const rate = resolveRate(rateIn);
  if (!rate.ok) return rate;
  if (!Number.isSafeInteger(nIn)) return { ok: false, error: "The frame count must be a whole number within exact integer range." };
  const seconds = framesToSeconds(nIn, rate);
  const ndfLabelSeconds = rat(nIn, rate.nominal);
  const ndfDriftSeconds = ratSub(seconds, ndfLabelSeconds);
  const notes: string[] = [];
  if (rate.fractional) {
    notes.push(
      `At ${rate.id} fps a non-drop label counts ${rate.nominal} labels per "second" while only ${ratLabel(rate.fps)} frames ` +
        "play per real second, so the NDF label falls behind the wall clock by 3.6 s per hour " +
        `(${(rate.nominal * 3.6).toFixed(0)} frames). Drop-frame labels exist to remove exactly that drift.`,
    );
  }
  if (rate.snapNote) notes.push(rate.snapNote);
  return {
    ok: true,
    frames: nIn,
    seconds,
    secondsApprox: ratToNumber(seconds),
    clock: clockText(seconds),
    ndfLabelSeconds,
    ndfDriftSeconds,
    notes,
  };
}

export interface TcDurationResult {
  ok: true;
  a: TcFramesResult;
  b: TcFramesResult;
  /** b − a in frames; negative when B is earlier than A. */
  frames: number;
  /** Real elapsed time of the span, exact (negative when B is earlier). */
  seconds: Rational;
  /** The span written as a label of the same counting mode (sign prefixed). */
  durationLabel: string;
  /** When B < A: the span if B is on the NEXT day (through midnight), else null. */
  acrossMidnightFrames: number | null;
  notes: string[];
}

/** Duration from timecode A to timecode B, in frames, real seconds and as a label. */
export function tcDuration(
  aText: string,
  bText: string,
  rateIn: FrameRate | string | number,
  df?: boolean,
): TcDurationResult | TcError {
  const rate = resolveRate(rateIn);
  if (!rate.ok) return rate;
  const a = tcToFrames(aText, rate, df);
  if (!a.ok) return { ok: false, error: `Timecode A: ${a.error}` };
  const b = tcToFrames(bText, rate, df);
  if (!b.ok) return { ok: false, error: `Timecode B: ${b.error}` };
  if (a.df !== b.df) return { ok: false, error: "A and B must use the same counting mode (both drop-frame or both non-drop)." };
  const isDf = a.df;
  const frames = b.frames - a.frames;
  const seconds = framesToSeconds(frames, rate);
  const perDay = framesPerDay(rate, isDf);
  const mag = framesToLabel(Math.abs(frames), rate, isDf);
  const notes: string[] = [];
  let acrossMidnightFrames: number | null = null;
  if (frames < 0) {
    acrossMidnightFrames = frames + perDay;
    notes.push(
      `B is earlier than A, so the duration is negative (${frames} frames). If B is on the next day (the recording ` +
        `ran through midnight), the span is ${acrossMidnightFrames} frames = ${framesToLabel(acrossMidnightFrames, rate, isDf)}.`,
    );
  }
  if (isDf) {
    notes.push(
      "A drop-frame duration label counts LABELS; the real elapsed time is the seconds line (frames × 1001/" +
        `${rate.nominal * 1000}), which a DF label tracks to within a few frames.`,
    );
  } else if (rate.fractional) {
    notes.push(
      `A non-drop duration label at ${rate.id} reads 0.1% short of real time (3.6 s per hour); trust the seconds line.`,
    );
  }
  return {
    ok: true,
    a,
    b,
    frames,
    seconds,
    durationLabel: (frames < 0 ? "−" : "") + mag,
    acrossMidnightFrames,
    notes,
  };
}

// --- Drift figure ------------------------------------------------------------

export interface DriftPoint {
  /** Real elapsed time, minutes. */
  realMin: number;
  /** What the label reads minus real time, seconds (negative: the label is behind). */
  driftS: number;
}

export interface DriftFigure {
  ok: true;
  ndf: DriftPoint[];
  /** Empty when drop-frame is not defined at this rate. */
  df: DriftPoint[];
  /** The marked point (the entered frame), if given. */
  mark: { realMin: number; ndfDriftS: number; dfDriftS: number | null } | null;
  caption: string;
}

/** Label seconds of an in-day frame for the counting mode (label read as h:m:s + f/N). */
function labelSecondsOf(n: number, rate: FrameRate, df: boolean): number {
  const lab = framesToLabel(n, rate, df);
  const p = parseTimecode(lab) as TcLabel;
  return p.h * 3600 + p.m * 60 + p.s + p.f / rate.nominal;
}

/**
 * Label time minus wall-clock time across a span (default 60 min), for NDF and
 * DF. NDF is a straight line falling 3.6 s per hour; DF is a sawtooth that
 * creeps behind by up to two frames within each minute and jumps back at each
 * drop. Arithmetic per sample, bounded at `samples` points plus two per minute.
 */
export function driftFigure(
  rateIn: FrameRate | string | number,
  spanMinutes = 60,
  markFrame?: number,
  samples = 240,
): DriftFigure | TcError {
  const rate = resolveRate(rateIn);
  if (!rate.ok) return rate;
  if (!Number.isFinite(spanMinutes) || spanMinutes <= 0 || spanMinutes > 1440) {
    return { ok: false, error: "The span must be between 0 and 1440 minutes (one timecode day)." };
  }
  const nSamples = Math.max(2, Math.min(2000, Math.floor(samples)));
  const fpsN = ratToNumber(rate.fps);
  const lastFrame = Math.min(Math.floor(spanMinutes * 60 * fpsN), framesPerDay(rate, false) - 1);
  const frameSet = new Set<number>();
  for (let i = 0; i <= nSamples; i++) frameSet.add(Math.round((lastFrame * i) / nSamples));
  const hasDf = rate.dropPerMinute > 0;
  if (hasDf) {
    // The frame either side of each drop, so the sawtooth's teeth are drawn.
    for (let mi = 1; mi <= Math.ceil(spanMinutes) && mi < 1440; mi++) {
      if (mi % 10 === 0) continue;
      const atMin = tcToFramesUnchecked(Math.floor(mi / 60), mi % 60, 0, rate.dropPerMinute, rate.nominal, rate.dropPerMinute, true);
      for (const f of [atMin - 1, atMin]) if (f >= 0 && f <= lastFrame) frameSet.add(f);
    }
  }
  const frames = [...frameSet].sort((x, y) => x - y);
  const ndf: DriftPoint[] = [];
  const dfPts: DriftPoint[] = [];
  const dfDay = hasDf ? framesPerDay(rate, true) : 0;
  for (const n of frames) {
    const real = n / fpsN;
    ndf.push({ realMin: real / 60, driftS: n / rate.nominal - real });
    if (hasDf && n < dfDay) dfPts.push({ realMin: real / 60, driftS: labelSecondsOf(n, rate, true) - real });
  }
  let mark: DriftFigure["mark"] = null;
  if (markFrame !== undefined && Number.isSafeInteger(markFrame) && markFrame >= 0) {
    const real = markFrame / fpsN;
    mark = {
      realMin: real / 60,
      ndfDriftS: markFrame / rate.nominal - real,
      dfDriftS: hasDf && markFrame < dfDay ? labelSecondsOf(markFrame, rate, true) - real : null,
    };
  }
  const caption = rate.fractional
    ? `Label time minus real time at ${rate.id} fps: non-drop falls behind 3.6 s per hour` +
      (hasDf ? "; drop-frame stays within a few frames, jumping back at each minute's skipped labels." : "; drop-frame is not defined at this rate.")
    : `At ${rate.id} fps the label and the wall clock agree exactly: there is no drift to correct.`;
  return { ok: true, ndf, df: dfPts, mark, caption };
}
