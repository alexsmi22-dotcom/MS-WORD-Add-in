// Pane glue for the control-design Engineering calculators: root locus, Nyquist,
// lead/lag design and discrete time (c2d). Kept OUT of taskpane.ts so the exact
// objects the pane registers can be tested (nothing can import the pane under
// jest), the same pattern as assayQuantCalcs.ts / welchCalcs.ts.
//
// Each entry is shaped exactly like the pane's EngCalc (taskpane.ts): fields of
// kind text/select, compute(read) -> AnalyzeOutput built with engReport(). The
// plant is typed the SAME WAY as in the four existing control tools (keys "num"
// and "den", highest power first, "1 3 2" or "s^2+3*s+2"), and parsed by the same
// parseTf, so a plant typed once means the same thing everywhere.
//
// No number is computed here: control.ts and controlDesign.ts own them all. What
// this file adds is wording and the display contract — U+2212 minus, superscript
// powers, ×10ⁿ (never e-notation), no em dash (the insert gate's non-finite
// sentinel), no "NaN"/"Infinity" — and the figures.

import type { EngUnitContract } from "./engCalc";
import type { AnalyzeOutput, AnalyzeBlock } from "./analyzeBlocks";
import { engReport, type EngLine } from "./engReport";
import { Rat, ratToNumber, ratSign, ratNeg, ratIsZero, parseRatLiteral } from "./cas";
import type { Complex } from "./linalg";
import { superscript, timesTen } from "./axis";
import { trueMinus } from "./numberList";
import {
  parseTf,
  trimPoly,
  TransferFunction,
  series,
  frequencyResponse,
  autoFrequencies,
  timeResponse,
  analyzeStability,
  Margins,
} from "./control";
import {
  rootLocus,
  nyquist,
  designCompensator,
  c2d,
  discreteStep,
  stepWindow,
  STEP_BUDGET,
  ROUTH_WORK_LIMIT,
  fmtShort,
  ratPlain,
  type C2dMethod,
  type JwCrossing,
} from "./controlDesign";
import { rootLocusSvg, nyquistSvg, zPlaneSvg, S_PLANE_W } from "./controlCharts";
import { buildPlotSvg, combineSvgs, type Series } from "./plot";

/** The pane's AnalyzeField, structurally (taskpane.ts does not export it). */
export interface ControlField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  rows?: number;
  options?: { value: string; label: string }[];
}
/** The pane's EngCalc, structurally; the group is the existing "Control systems" heading. */
export interface ControlCalc {
  id: string;
  name: string;
  group: "Control systems";
  hint: string;
  fields: ControlField[];
  /** The unit contract this tool keeps (engCalc.ts EngUnitContract). */
  unitContract: EngUnitContract;
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

const MINUS = "−";

/** Same wording as the pane's ENG_CONTROL_UNIT_NOTE, with 2π typeset. */
const UNIT_NOTE =
  "Units: set by your coefficients and not converted. Write the transfer function in the time unit you " +
  "want back; with s in rad/s, times are seconds and frequencies rad/s; divide a frequency by 2π for Hz.";

// ---------------------------------------------------------------- display contract

/**
 * Makes one prose line contract-clean: e-notation -> ×10ⁿ, carets -> superscripts,
 * "+/-" -> ±, sign hyphens -> U+2212. Engine notes are prose written for a reader
 * and can carry any of these; nothing reaches the result without passing here.
 */
export function clean(line: string): string {
  let s = line.replace(/(\d(?:\.\d+)?)[eE]([+-]?\d+)\b/g, (_m, mant: string, ex: string) => `${mant}${timesTen(Number(ex))}`);
  s = s.replace(/\^\(?([+-]?\d+)\)?/g, (_m, ex: string) => superscript(Number(ex)));
  s = s.replace(/\+\/-/g, "±");
  // The engine verdicts read "STABLE — every pole ..."; the em dash is the insert gate's
  // non-finite sentinel, so the verdict form becomes a colon and any other one a comma.
  s = s.replace(/\b([A-Z][A-Z ]+[A-Z]) — /g, "$1: ").replace(/\s*—\s*/g, ", ");
  s = s.replace(/-180 degrees/g, `${MINUS}180°`).replace(/ degrees\b/g, "°");
  return trueMinus(s);
}

const num = (v: number, sig = 4): string => fmtShort(v, sig);

/** A plain decimal for the MATH source (the typesetter's syntax), never e-notation. */
function plainDecimal(v: number, sig = 5): string {
  const p = Math.abs(v).toPrecision(sig);
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(p);
  let s = p;
  if (m) {
    const digits = m[1] + (m[2] ?? "");
    const e = Number(m[3]);
    if (e < 0) s = `0.${"0".repeat(-e - 1)}${digits}`;
    else s = digits.length > e + 1 ? `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}` : digits + "0".repeat(e + 1 - digits.length);
  }
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return (v < 0 ? "-" : "") + s;
}

/** True when q is an exact decimal with a short expansion (denominator 2^a·5^b). */
function shortDecimal(q: Rat): string | null {
  let d = q.d;
  let k = 0;
  while (d % 10n === 0n) {
    d /= 10n;
    k++;
  }
  let twos = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  let fives = 0;
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  if (d !== 1n) return null;
  const places = k + Math.max(twos, fives);
  if (places > 8) return null;
  const scaled = (q.n * 10n ** BigInt(places)) / q.d;
  const neg = scaled < 0n;
  let digits = (neg ? -scaled : scaled).toString();
  if (places > 0) {
    digits = digits.padStart(places + 1, "0");
    digits = `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (digits.replace(".", "").replace(/^0+/, "").length > 9) return null;
  return (neg ? "-" : "") + digits;
}

/** A coefficient for display (text) and for the math source. */
function coef(q: Rat): { text: string; math: string; one: boolean } {
  const mag = ratSign(q) < 0 ? ratNeg(q) : q;
  const one = mag.n === 1n && mag.d === 1n;
  if (mag.d === 1n && mag.n < 1000000000n) return { text: String(mag.n), math: String(mag.n), one };
  const dec = shortDecimal(mag);
  if (dec !== null) return { text: dec, math: dec, one };
  if (mag.d <= 1000n && mag.n <= 1000000n) return { text: `${mag.n}/${mag.d}`, math: `(${mag.n}/${mag.d})`, one };
  const v = ratToNumber(mag);
  return { text: num(v, 5), math: plainDecimal(v, 5), one: false };
}

/** A double coefficient, five significant figures. */
function coefNum(v: number): { text: string; math: string; one: boolean } {
  const a = Math.abs(v);
  return { text: num(a, 5), math: plainDecimal(a, 5), one: Math.abs(a - 1) < 1e-12 };
}

function polyText(cs: Array<{ text: string; math: string; one: boolean; neg: boolean; zero: boolean }>, x: string): { text: string; math: string } {
  const n = cs.length - 1;
  // The tools accept order 20 at most; anything longer is not a transfer function here.
  if (n > 64) return { text: `a polynomial of degree ${n}`, math: "0" };
  const tp: string[] = [];
  const mp: string[] = [];
  for (let i = 0; i <= n; i++) {
    const c = cs[i];
    if (c.zero) continue;
    const pw = n - i;
    const ct = c.one && pw > 0 ? "" : pw > 0 && c.text.includes("/") ? `(${c.text})` : c.text;
    const cm = c.one && pw > 0 ? "" : c.math;
    const xt = pw === 0 ? "" : pw === 1 ? x : `${x}${superscript(pw)}`;
    const xm = pw === 0 ? "" : pw === 1 ? x : `${x}^${pw}`;
    const first = tp.length === 0;
    tp.push((first ? (c.neg ? MINUS : "") : c.neg ? ` ${MINUS} ` : " + ") + ct + xt);
    mp.push((first ? (c.neg ? "-" : "") : c.neg ? " - " : " + ") + cm + xm);
  }
  return tp.length ? { text: tp.join(""), math: mp.join("") } : { text: "0", math: "0" };
}

export function ratPolyDisplay(p: Rat[], x = "s"): { text: string; math: string } {
  const t = trimPoly(p);
  return polyText(
    t.map((q) => ({ ...coef(q), neg: ratSign(q) < 0, zero: ratIsZero(q) })),
    x,
  );
}

export function numPolyDisplay(p: number[], x = "z"): { text: string; math: string } {
  let i0 = 0;
  while (i0 < p.length - 1 && p[i0] === 0) i0++;
  return polyText(
    p.slice(i0).map((v) => ({ ...coefNum(v), neg: v < 0, zero: v === 0 })),
    x,
  );
}

function tfMath(name: string, n: { text: string; math: string }, d: { text: string; math: string }): EngLine {
  return { math: `${name} = (${n.math})/(${d.math})`, fallback: `${name} = (${n.text})/(${d.text})` };
}
const tfLine = (name: string, tf: TransferFunction): EngLine => tfMath(name, ratPolyDisplay(tf.num), ratPolyDisplay(tf.den));

export function complexText(z: Complex, unit = "j"): string {
  const tiny = 1e-12 * Math.max(1, Math.hypot(z.re, z.im));
  if (Math.abs(z.im) <= tiny) return num(Math.abs(z.re) <= tiny ? 0 : z.re);
  const re = Math.abs(z.re) <= tiny ? "" : num(z.re);
  const im = num(Math.abs(z.im));
  if (!re) return `${z.im < 0 ? MINUS : ""}${im}${unit}`;
  return `${re} ${z.im < 0 ? MINUS : "+"} ${im}${unit}`;
}

/** Conjugate pairs listed once as "a ± bj". */
function rootList(roots: Complex[]): string {
  const out: string[] = [];
  const used = new Array(roots.length).fill(false);
  const sorted = roots.map((z, i) => ({ z, i })).sort((a, b) => b.z.re - a.z.re || b.z.im - a.z.im);
  for (const { z, i } of sorted) {
    if (used[i]) continue;
    used[i] = true;
    const tiny = 1e-12 * Math.max(1, Math.hypot(z.re, z.im));
    if (Math.abs(z.im) > tiny) {
      const j = sorted.find((q) => !used[q.i] && Math.abs(q.z.re - z.re) <= 1e-9 * Math.max(1, Math.abs(z.re)) && Math.abs(q.z.im + z.im) <= 1e-9 * Math.max(1, Math.abs(z.im)));
      if (j) {
        used[j.i] = true;
        const re = Math.abs(z.re) <= tiny ? "" : `${num(z.re)} `;
        out.push(`${re}±${re ? " " : ""}${num(Math.abs(z.im))}j`);
        continue;
      }
    }
    out.push(complexText(z));
  }
  return out.join(", ");
}

function readNumber(raw: string, what: string): { v: number | null; error?: string } {
  const t = raw.trim().replace(/−/g, "-");
  if (!t) return { v: null };
  const q = parseRatLiteral(t);
  if (!q) return { v: null, error: `${what} must be a number (got "${raw.trim()}").` };
  const v = ratToNumber(q);
  if (!Number.isFinite(v)) return { v: null, error: `${what} is too large.` };
  return { v };
}

/** The SVG's OWN canvas size: a legend outside the frame widens it past the size asked for. */
function svgSize(svg: string, w0: number, h0: number): { w: number; h: number } {
  const head = /^<svg[^>]*>/.exec(svg.trim())?.[0] ?? "";
  const w = Number(/\swidth="([\d.]+)"/.exec(head)?.[1] ?? w0);
  const h = Number(/\sheight="([\d.]+)"/.exec(head)?.[1] ?? h0);
  return { w: Number.isFinite(w) && w > 0 ? w : w0, h: Number.isFinite(h) && h > 0 ? h : h0 };
}

function fail(text: string): AnalyzeOutput {
  return { text: clean(text), ok: false };
}

/** engReport with every prose line made contract-clean. */
function report(lines: EngLine[], figures: AnalyzeBlock[]): AnalyzeOutput {
  const cleaned = lines.map((l) => (typeof l === "string" ? clean(l) : { math: l.math, fallback: clean(l.fallback) }));
  return engReport(cleaned, figures);
}

function marginLines(mg: Margins | null, indent = ""): string[] {
  if (!mg) return [`${indent}Margins could not be computed.`];
  const out: string[] = [];
  out.push(
    mg.gainMarginDb !== null && mg.phaseCrossoverW !== null
      ? `${indent}Gain margin = ${num(mg.gainMarginDb)} dB at ${num(mg.phaseCrossoverW)} rad/s`
      : `${indent}Gain margin: infinite (the phase never reaches ${MINUS}180°).`,
  );
  out.push(
    mg.phaseMarginDeg !== null && mg.gainCrossoverW !== null
      ? `${indent}Phase margin = ${num(mg.phaseMarginDeg)}° at ${num(mg.gainCrossoverW)} rad/s`
      : `${indent}Phase margin: none (the magnitude never crosses 0 dB).`,
  );
  return out;
}

const PLANT_HINT = 'Coefficients highest power first ("1 3 2") or written out ("s^2+3*s+2"), as in the other control tools.';

// ---------------------------------------------------------------- 1. root locus

function omegaText(c: JwCrossing): string {
  if (c.wExact) return ratPlain(c.wExact);
  if (c.w2Exact) {
    const inner = c.w2Exact.d === 1n ? String(c.w2Exact.n) : `(${c.w2Exact.n}/${c.w2Exact.d})`;
    return `√${inner} ≈ ${num(c.w)}`;
  }
  if (c.w2Surd) return `√(${c.w2Surd}) ≈ ${num(c.w)}`;
  return num(c.w);
}

const rootLocusCalc: ControlCalc = {
  id: "control-rlocus",
  name: "Root locus",
  group: "Control systems",
  unitContract: "same-units",
  hint:
    "Enter the OPEN-LOOP G(s)H(s); the locus is the closed-loop poles of 1 + K·G(s)H(s) = 0 as K rises from 0. " +
    "Asymptotes, real-axis segments, breakaway points and the gain at each imaginary-axis crossing are derived " +
    "exactly where the algebra allows, and every crossing gain is confirmed by the exact Routh array. " +
    PLANT_HINT,
  fields: [
    { key: "num", label: "Open-loop numerator", default: "1", kind: "text" },
    { key: "den", label: "Open-loop denominator", default: "s^3+3*s^2+2*s", kind: "text" },
    { key: "k", label: "Mark the closed-loop poles at K = (optional)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const tf = parseTf(r("num"), r("den"));
    if ("ok" in tf) return fail(tf.error);
    let kAt: Rat | null = null;
    const kRaw = r("k").trim().replace(/−/g, "-");
    if (kRaw) {
      kAt = parseRatLiteral(kRaw);
      if (!kAt) return fail(`K must be a number (got "${r("k").trim()}").`);
      if (ratSign(kAt) < 0) return fail("K must be zero or positive: this is the K ≥ 0 locus.");
      if (!Number.isFinite(ratToNumber(kAt))) return fail("K is too large.");
    }
    const rl = rootLocus(tf, kAt);
    if (!rl.ok) return fail(rl.error);

    const lines: EngLine[] = [];
    lines.push(tfLine("G(s)H(s)", tf));
    const charDisp = ratPolyDisplay(tf.den);
    const numDisp = ratPolyDisplay(tf.num);
    const numConst = trimPoly(tf.num).length === 1;
    let kTerm: string;
    if (numConst) {
      const c0 = trimPoly(tf.num)[0];
      const mag = coef(ratSign(c0) < 0 ? ratNeg(c0) : c0).text;
      kTerm = `${ratSign(c0) < 0 ? " − " : " + "}${mag === "1" ? "K" : `${mag}K`}`;
    } else kTerm = ` + K·(${numDisp.text})`;
    lines.push(`Characteristic equation: ${charDisp.text}${kTerm} = 0, K ≥ 0`);
    lines.push("");
    lines.push(`Open-loop poles (n = ${rl.n}): ${rootList(rl.poles)}`);
    lines.push(rl.m > 0 ? `Open-loop zeros (m = ${rl.m}): ${rootList(rl.zeros)}` : "Open-loop zeros: none");
    lines.push(
      `Branches: ${rl.n}, starting at the poles (K = 0)` +
        (rl.m > 0 ? `; ${rl.m} end at the zeros` : "") +
        (rl.n - rl.m > 0 ? `; ${rl.n - rl.m} go to infinity along the asymptotes.` : "."),
    );
    if (rl.centroid && rl.asymptoteAnglesDeg.length) {
      lines.push(
        `Asymptotes: centroid σ = ${ratPlain(rl.centroid)} (exact: (Σ poles − Σ zeros)/(n − m)), angles ` +
          rl.asymptoteAnglesDeg.map((a) => `${num(a)}°`).join(", ") +
          (rl.complementary ? " (0° locus)" : ""),
      );
    }
    if (rl.realSegments.length) {
      // enough figures that neighbouring end points never print alike (clustered poles)
      const ends = rl.realSegments.flatMap((s) => [s.from, s.to]).filter(Number.isFinite);
      let sig = 4;
      for (; sig < 10; sig++) {
        const txt = ends.map((v) => num(v, sig));
        if (ends.every((v, i) => ends.every((w, j) => v === w || txt[i] !== txt[j]))) break;
      }
      const seg = rl.realSegments.map((s) => {
        if (!Number.isFinite(s.from) && !Number.isFinite(s.to)) return "the whole real axis";
        if (!Number.isFinite(s.from)) return `s ≤ ${num(s.to, sig)}`;
        if (!Number.isFinite(s.to)) return `s ≥ ${num(s.from, sig)}`;
        return `${num(s.from, sig)} ≤ s ≤ ${num(s.to, sig)}`;
      });
      lines.push(`On the real axis: ${seg.join("; ")}`);
    } else lines.push("No part of the real axis is on the locus.");
    lines.push("");
    if (rl.breakaways.length) {
      lines.push("Breakaway / break-in points (roots of dK/ds = 0 with a real K > 0):");
      for (const b of rl.breakaways) {
        const sTxt = b.sExact ? ratPlain(b.sExact) : complexText(b.s);
        const kTxt = b.kExact ? `${ratPlain(b.kExact)}${b.kExact.d !== 1n ? ` ≈ ${num(b.K)}` : ""}` : num(b.K);
        lines.push(`  s = ${sTxt} at K = ${kTxt}`);
      }
    } else if (!rl.unresolvedBreakaways.length) {
      lines.push("No breakaway or break-in points (no root of dK/ds = 0 lies on the locus with K > 0).");
    }
    if (rl.repeatedPoleBreaks.length) {
      lines.push(
        `At the repeated open-loop pole(s) s = ${rl.repeatedPoleBreaks.map((z) => complexText(z)).join(", ")}, dK/ds = 0 with K = 0: ` +
          "the branches break away from the double pole as K rises from 0 (not a meeting point at a positive gain).",
      );
    }
    if (rl.unresolvedBreakaways.length) {
      lines.push(
        `Not resolved: dK/ds = 0 also at s ≈ ${rl.unresolvedBreakaways.map((x) => num(x, 6)).join(", ")}, inside a cluster of ` +
          "nearly repeated poles where K = −den/num is below double-precision round-off, so whether branches meet there at a positive gain cannot be decided.",
      );
    }
    if (rl.crossings.length) {
      lines.push("Imaginary-axis crossings (exact elimination in ω², then the Routh array at that K):");
      for (const c of rl.crossings) {
        const kTxt = c.kExact ? `${ratPlain(c.kExact)}${c.kExact.d !== 1n ? ` ≈ ${num(c.K)}` : ""}` : `${num(c.K)}`;
        const conf =
          c.routhConfirmed === true
            ? "; the exact Routh array at this K has a row of zeros and its auxiliary polynomial has roots at ±jω: confirmed"
            : c.routhConfirmed === false
              ? "; the exact Routh array at this K did NOT show the expected row of zeros, so treat this crossing with caution"
              : c.kExact
                ? "; K is exact (elimination in ω²), but the Routh array at this K is too long to tabulate within the time budget, so it was not cross-checked"
                : c.w2Irrational
                ? "; ω² is irrational (proven), so no exact Routh array can be formed at this K: computed in double precision"
                : "; not verified exactly (the exact rational search was outside its work budget): computed numerically";
        lines.push(`  s = ±j${omegaText(c)} rad/s at K = ${kTxt}${conf}`);
      }
    } else if (!rl.jwAxisLocus) {
      lines.push("No imaginary-axis crossing for K > 0.");
    }
    if (rl.originCrossingK) lines.push(`A real branch passes through s = 0 at K = ${ratPlain(rl.originCrossingK)}.`);
    if (rl.stableRanges.length) {
      const rngs = rl.stableRanges.map((s) => {
        const lo = s.loExact ? ratPlain(s.loExact) : num(s.lo);
        if (s.hi === null) return `K > ${lo}`;
        const hi = s.hiExact ? ratPlain(s.hiExact) : num(s.hi);
        return `${lo} < K < ${hi}`;
      });
      lines.push(`Closed loop STABLE for ${rngs.join(" and ")} (each interval checked by the Routh / pole analysis at a gain inside it).`);
    } else {
      lines.push("The closed loop is NOT stable for any K > 0 tested between the critical gains.");
    }
    if (rl.stableRangeDoubt) {
      lines.push("Note: at one of the probe gains the two stability methods disagreed or could not decide, so a range boundary may be marginal.");
    }
    if (rl.atK) {
      const st = rl.atK.stability;
      lines.push("");
      lines.push(`At K = ${ratPlain(rl.atK.K)}: closed-loop poles ${rootList(st.poles)}`);
      lines.push(`  ${st.verdict}`);
    }
    lines.push("");
    lines.push(
      `Loci traced over ${rl.gains.length} gain steps with the roots matched step to step by minimum total movement` +
        (rl.sweepCapped ? " (step limit reached: see note)." : "."),
    );
    for (const nt of rl.notes) lines.push(`Note: ${nt}`);
    lines.push(UNIT_NOTE);

    const svg = rootLocusSvg(rl);
    const sz = svgSize(svg, S_PLANE_W, 400);
    return report(lines, [
      {
        kind: "plot",
        svg,
        caption: "Root locus on the s-plane",
        alt: "Root locus branches from the open-loop poles, with asymptotes, breakaway points and imaginary-axis crossings marked",
        w: sz.w,
        h: sz.h,
      },
    ]);
  },
};

// ---------------------------------------------------------------- 2. Nyquist

const nyquistCalc: ControlCalc = {
  id: "control-nyquist",
  name: "Nyquist plot & encirclements",
  group: "Control systems",
  unitContract: "same-units",
  hint:
    "Enter the OPEN-LOOP L(s) = G·H. Counts the clockwise encirclements N of −1 around the Nyquist contour " +
    "(indented around any imaginary-axis poles), takes P = open-loop right-half-plane poles, and gives Z = N + P. " +
    "Z is then checked against the closed-loop poles computed directly; if the two disagree, both are shown and " +
    "nothing is decided. " +
    PLANT_HINT,
  fields: [
    { key: "num", label: "Open-loop numerator", default: "1", kind: "text" },
    { key: "den", label: "Open-loop denominator", default: "s^3+3*s^2+2*s", kind: "text" },
  ],
  compute: (r) => {
    const tf = parseTf(r("num"), r("den"));
    if ("ok" in tf) return fail(tf.error);
    const ny = nyquist(tf);
    if (!ny.ok) return fail(ny.error);
    const lines: EngLine[] = [];
    lines.push(tfLine("L(s)", tf));
    lines.push("");
    lines.push(ny.verdict);
    lines.push("");
    const ax = ny.axisPoles.length
      ? ` (not counting the imaginary-axis pole(s) at ${ny.axisPoles
          .map((p) => (p.w === 0 ? "s = 0" : `s = ±j${num(p.w)}`) + (p.mult > 1 ? ` ×${p.mult}` : ""))
          .join(", ")}, which the indented contour leaves outside)`
      : "";
    lines.push(`P = ${ny.P}: open-loop poles strictly in the right half plane${ax}`);
    lines.push(
      ny.N !== null
        ? `N = ${ny.N < 0 ? MINUS + -ny.N : ny.N}: net CLOCKWISE encirclements of −1, from the winding number of 1 + L(s) around the contour` +
            (ny.N < 0 ? " (negative: counter-clockwise)" : "")
        : "N: not counted (see the verdict).",
    );
    if (ny.Z !== null) lines.push(`Z = N + P = ${ny.Z}: closed-loop poles in the right half plane, by the Nyquist criterion`);
    if (ny.closedRhp !== null) {
      lines.push(
        `Cross-check: the closed loop L/(1 + L), solved directly (exact Routh array and computed poles), has ${ny.closedRhp} ` +
          `pole(s) in the right half plane` +
          (ny.agree === true ? ", which AGREES with Z." : ny.agree === false ? ", which DISAGREES with Z: see the verdict." : "."),
      );
    } else if (ny.closed) {
      lines.push(`Closed loop solved directly: ${ny.closed.verdict}`);
    }
    if (ny.closed) lines.push(`  closed-loop poles: ${rootList(ny.closed.poles)}`);
    lines.push("");
    lines.push("Margins (open loop, shown on the plot)");
    lines.push(...marginLines(ny.margins, "  "));
    // every −180° crossing, and what the margins mean against the closed-loop poles
    for (const nt of ny.margins?.notes ?? []) lines.push(`  Note: ${nt}`);
    for (const nt of ny.notes) lines.push(`Note: ${nt}`);
    lines.push(UNIT_NOTE);

    const svg = nyquistSvg(ny);
    const sz = svgSize(svg, S_PLANE_W, 400);
    return report(lines, [
      {
        kind: "plot",
        svg,
        caption: "Nyquist plot of the open loop",
        alt: "L of j omega in the complex plane with its mirror image, the minus one point and the unit circle",
        w: sz.w,
        h: sz.h,
      },
    ]);
  },
};

// ---------------------------------------------------------------- 3. lead / lag

function bodePair(before: TransferFunction, after: TransferFunction): { svg: string; w: number; h: number } {
  const freqs = autoFrequencies(after, 300);
  const fb = frequencyResponse(before, freqs);
  const fa = frequencyResponse(after, freqs);
  const ok = (v: number): boolean => Number.isFinite(v);
  const mag: Series[] = [
    { points: fb.filter((p) => ok(p.magnitudeDb)).map((p) => ({ x: p.w, y: p.magnitudeDb })), type: "line", color: "#9ca3af", label: "G (before)" },
    { points: fa.filter((p) => ok(p.magnitudeDb)).map((p) => ({ x: p.w, y: p.magnitudeDb })), type: "line", color: "#2563eb", label: "C·G (after)" },
  ];
  const ph: Series[] = [
    { points: fb.filter((p) => ok(p.phaseDeg)).map((p) => ({ x: p.w, y: p.phaseDeg })), type: "line", color: "#9ca3af", label: "G (before)" },
    { points: fa.filter((p) => ok(p.phaseDeg)).map((p) => ({ x: p.w, y: p.phaseDeg })), type: "line", color: "#b91c1c", label: "C·G (after)" },
  ];
  const a = buildPlotSvg(mag, { width: 380, height: 220, xScale: "log", xlabel: "Frequency (rad/s)", ylabel: "Magnitude (dB)", title: "Bode magnitude, before and after" });
  const b = buildPlotSvg(ph, { width: 380, height: 220, xScale: "log", xlabel: "Frequency (rad/s)", ylabel: "Phase (°)", title: "Bode phase, before and after" });
  const c = combineSvgs([a, b]);
  return { svg: c.svg, w: c.width, h: c.height };
}

const leadLagCalc: ControlCalc = {
  id: "control-leadlag",
  name: "Lead / lag compensator design",
  group: "Control systems",
  unitContract: "same-units",
  hint:
    "Classical Bode design in series with your plant, unity feedback. LEAD adds phase at the crossover for a " +
    "target phase margin (optionally at a crossover you choose); LAG meets an error constant (Kp, Kv or Ka by the " +
    "loop's type) and restores the phase margin by lowering the crossover. C(s) is printed rounded to 4 significant " +
    "figures and that exact C(s) is what is then verified by closing the loop. " +
    PLANT_HINT,
  fields: [
    { key: "num", label: "Plant numerator", default: "4", kind: "text" },
    { key: "den", label: "Plant denominator", default: "s^2+2*s", kind: "text" },
    {
      key: "kind",
      label: "Compensator",
      default: "lead",
      kind: "select",
      options: [
        { value: "lead", label: "Lead (phase margin)" },
        { value: "lag", label: "Lag (error constant + phase margin)" },
      ],
    },
    { key: "pm", label: "Target phase margin (°)", default: "50", kind: "text" },
    { key: "err", label: "Error constant to meet: Kp, Kv or Ka by type (optional)", default: "20", kind: "text" },
    { key: "wc", label: "Lead only: target crossover, rad/s (optional)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const plant = parseTf(r("num"), r("den"));
    if ("ok" in plant) return fail(plant.error);
    const kind = r("kind") === "lag" ? "lag" : "lead";
    const pm = readNumber(r("pm"), "The target phase margin");
    if (pm.error) return fail(pm.error);
    if (pm.v === null) return fail("Enter a target phase margin in degrees (45 to 60 is the usual range).");
    const err = readNumber(r("err"), "The error constant");
    if (err.error) return fail(err.error);
    const wc = readNumber(r("wc"), "The target crossover");
    if (wc.error) return fail(wc.error);
    const res = designCompensator(plant, { kind, pm: pm.v, wc: kind === "lead" ? wc.v : null, errorConst: err.v });
    if (!res.ok) return fail(res.error);

    const lines: EngLine[] = [];
    lines.push(tfLine("G(s)", plant));
    lines.push(
      `${kind === "lead" ? "Lead" : "Lag"} design for a ${num(pm.v)}° phase margin` +
        (res.errBefore.name && err.v !== null && !(kind === "lead" && wc.v !== null) ? `, ${res.errBefore.name} = ${num(err.v)}` : "") +
        (kind === "lead" && wc.v !== null ? `, crossover at ${num(wc.v)} rad/s` : ""),
    );
    lines.push("");
    lines.push(tfLine("C(s)", res.C));
    // The same C(s) as coefficient lists, ready to type into the other control tools.
    const coefList = (p: Rat[]): string => trimPoly(p).map((c) => coef(c).text).join(" ");
    lines.push(`  as coefficients (highest power first): numerator ${coefList(res.C.num)}; denominator ${coefList(res.C.den)}`);
    if (res.C.den.length === 2) {
      const k = res.gain;
      lines.push(
        `  = K·(Ts + 1)/(${kind === "lead" ? "α" : "β"}Ts + 1) with K = ${num(k)}, T = ${num(res.T)} s, ` +
          `${kind === "lead" ? "α" : "β"} = ${num(res.ratio)}: zero at s = ${num(res.zero)}, pole at s = ${num(res.pole)}` +
          (res.phiMaxDeg !== null ? `; φmax = ${num(res.phiMaxDeg)}°` : ""),
      );
    }
    if (kind === "lag" && wc.v !== null) lines.push("  (The target-crossover field applies to lead designs only and was not used.)");
    lines.push("");
    lines.push("Verification: the loop closed around C(s) exactly as printed");
    const b = res.before;
    const a = res.after;
    const pmT = (m: Margins | null): string =>
      m && m.phaseMarginDeg !== null && m.gainCrossoverW !== null ? `${num(m.phaseMarginDeg)}° at ${num(m.gainCrossoverW)} rad/s` : "none";
    const gmT = (m: Margins | null): string =>
      m && m.gainMarginDb !== null && m.phaseCrossoverW !== null ? `${num(m.gainMarginDb)} dB at ${num(m.phaseCrossoverW)} rad/s` : "infinite";
    lines.push(`  Phase margin: ${pmT(b)} before, ${pmT(a)} after`);
    lines.push(`  Gain margin: ${gmT(b)} before, ${gmT(a)} after`);
    if (res.errAfter.name) {
      lines.push(`  ${res.errAfter.name}: ${num(res.errBefore.value)} before, ${num(res.errAfter.value)} after`);
    }
    lines.push(`  Closed loop with C(s): ${res.closedAfter.verdict}`);
    const os = (s: typeof res.stepAfter): string =>
      s && s.withheld
        ? "not reported (the simulation could not resolve this plant)"
        : s && s.overshootPct !== null
          ? `${s.overshootPct < 1e-6 ? "0" : num(s.overshootPct, 3)} %`
          : s
            ? "no final value (not stable)"
            : "not simulated";
    lines.push(`  Step overshoot (simulated): ${os(res.stepBefore)} before, ${os(res.stepAfter)} after`);
    lines.push(res.targetMet ? "  Target met." : "  Target NOT met: see the note.");
    for (const nt of res.notes) lines.push(`Note: ${nt}`);
    lines.push(UNIT_NOTE);

    const L = series(res.C, plant);
    const bode = bodePair(plant, L);
    const blocks: AnalyzeBlock[] = [
      { kind: "plot", svg: bode.svg, caption: "Bode plot before and after compensation", alt: "Open-loop magnitude and phase of the plant and of the compensated loop", w: bode.w, h: bode.h },
    ];
    const sA = res.stepAfter;
    if (sA) {
      const ser: Series[] = [];
      const notes: string[] = [];
      const sB = res.stepBefore;
      if (sB && res.closedBefore && res.closedBefore.stable) {
        ser.push({ points: sB.t.map((t, i) => ({ x: t, y: sB.y[i] })), type: "line", color: "#9ca3af", label: "before (G)" });
      } else notes.push("The uncompensated closed loop is not stable, so its step is not drawn.");
      ser.push({ points: sA.t.map((t, i) => ({ x: t, y: sA.y[i] })), type: "line", color: "#2563eb", label: "after (C·G)" });
      const svg = buildPlotSvg(ser, { width: 380, height: 240, xlabel: "Time (s)", ylabel: "Output", title: "Closed-loop step, before and after", notes });
      const sz = svgSize(svg, 380, 240);
      blocks.push({ kind: "plot", svg, caption: "Closed-loop step response before and after", alt: "Unit step response of the closed loop with and without the compensator", w: sz.w, h: sz.h });
    }
    return report(lines, blocks);
  },
};

// ---------------------------------------------------------------- 4. c2d

const METHOD_NAME: Record<C2dMethod, string> = {
  zoh: "zero-order hold (ZOH)",
  tustin: "Tustin (bilinear)",
  matched: "matched pole-zero",
};

const c2dCalc: ControlCalc = {
  id: "control-c2d",
  name: "Discrete time (c2d) & z-plane stability",
  group: "Control systems",
  unitContract: "same-units",
  hint:
    "Converts G(s) to Gd(z) at sample time T by zero-order hold, Tustin (optionally prewarped) or matched " +
    "pole-zero, then tests |z| < 1 twice: exactly by the Jury (Schur–Cohn) test and from the computed poles. The " +
    "discrete step comes from the difference equation and is drawn over the continuous step. " +
    PLANT_HINT,
  fields: [
    { key: "num", label: "Numerator", default: "4", kind: "text" },
    { key: "den", label: "Denominator", default: "s^2+2*s+4", kind: "text" },
    { key: "T", label: "Sample time T (s)", default: "0.2", kind: "text" },
    {
      key: "method",
      label: "Method",
      default: "zoh",
      kind: "select",
      options: [
        { value: "zoh", label: "Zero-order hold" },
        { value: "tustin", label: "Tustin (bilinear)" },
        { value: "matched", label: "Matched pole-zero" },
      ],
    },
    { key: "prewarp", label: "Tustin prewarp frequency, rad/s (optional)", default: "", kind: "text" },
    { key: "samples", label: "Samples to simulate (blank to choose from the poles)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const tf = parseTf(r("num"), r("den"));
    if ("ok" in tf) return fail(tf.error);
    const Tr = readNumber(r("T"), "The sample time T");
    if (Tr.error) return fail(Tr.error);
    if (Tr.v === null || !(Tr.v > 0)) return fail("The sample time T must be a positive number of seconds.");
    const T = Tr.v;
    const method = (["zoh", "tustin", "matched"].includes(r("method")) ? r("method") : "zoh") as C2dMethod;
    const pw = readNumber(r("prewarp"), "The prewarp frequency");
    if (pw.error) return fail(pw.error);
    const nS = readNumber(r("samples"), "The number of samples");
    if (nS.error) return fail(nS.error);
    if (nS.v !== null && (!(nS.v >= 2) || !Number.isInteger(nS.v))) return fail("The number of samples must be a whole number of at least 2.");
    const res = c2d(tf, T, method, method === "tustin" ? pw.v : null);
    if (!res.ok) return fail(res.error);

    const contSt = analyzeStability(tf, { routhWorkLimit: ROUTH_WORK_LIMIT });
    const tEnd = nS.v !== null ? (nS.v - 1) * T : Math.min(stepWindow(contSt.ok ? contSt : null), 2000 * T);
    const samples = Math.min(2000, Math.max(2, Math.floor(tEnd / T + 1e-9) + 1));
    const yd = discreteStep(res.gd, samples);
    const contKnown = contSt.ok ? contSt : undefined;
    const cont = timeResponse(tf, "step", Math.max(T, (samples - 1) * T), 400, STEP_BUDGET, contKnown);

    const lines: EngLine[] = [];
    lines.push(tfLine("G(s)", tf));
    lines.push(`Method: ${METHOD_NAME[method]}, T = ${num(T)} s` + (res.prewarp !== null ? `, prewarped at ${num(res.prewarp)} rad/s` : ""));
    if (method !== "tustin" && pw.v !== null) lines.push("  (The prewarp field applies to Tustin only and was not used.)");
    if (nS.v !== null && nS.v > 2000) lines.push("  (The simulation is capped at 2000 samples.)");
    lines.push("");
    const nd = res.gd.numExact ? ratPolyDisplay(res.gd.numExact, "z") : numPolyDisplay(res.gd.num, "z");
    const dd = res.gd.denExact ? ratPolyDisplay(res.gd.denExact, "z") : numPolyDisplay(res.gd.den, "z");
    lines.push(tfMath("Gd(z)", nd, dd));
    if (res.gd.numExact) lines.push("  (exact: Tustin with a rational T maps rational coefficients to rational coefficients)");
    lines.push("");
    lines.push(`Discrete poles: ${rootList(res.poles)}`);
    lines.push(`  |z| = ${res.poles.map((z) => num(Math.hypot(z.re, z.im))).join(", ")}`);
    lines.push(res.zeros.length ? `Discrete zeros: ${rootList(res.zeros)}` : "Discrete zeros: none");
    lines.push(res.verdict);
    if (res.juryStable !== null) {
      if (res.onCircle > 0) {
        lines.push(
          "Jury (Schur–Cohn) test: not decisive here. A pole ON the unit circle sits exactly on the boundary the test " +
            "draws, and the coefficients above carry rounding at the last digit, so the exact test on them lands either side of it.",
        );
      } else {
        lines.push(
          `Jury (Schur–Cohn) test, exact over the rationals on these coefficients: ${res.juryStable ? "all poles inside |z| < 1" : "NOT all poles inside |z| < 1"}` +
            (res.disagreement ? "; this DISAGREES with the computed poles (see the verdict)." : "; agrees with the computed poles."),
        );
      }
    }
    lines.push("");
    lines.push(`Discrete step response: ${yd.length} samples (k = 0 to ${yd.length - 1}) by the difference equation`);
    if (res.numericStable && !res.onCircle) {
      const sumN = res.gd.num.reduce((a, v) => a + v, 0);
      const sumD = res.gd.den.reduce((a, v) => a + v, 0);
      if (sumD !== 0) lines.push(`  final value Gd(1) = ${num(sumN / sumD)}`);
    }
    // ZOH is exact at the sampling instants for a step input, so the continuous
    // simulation sampled AT those instants (timeResponse on a grid of step T) must
    // agree with the difference equation to integration accuracy: an independent check.
    const atSamples = method === "zoh" && yd.length >= 2 ? timeResponse(tf, "step", (yd.length - 1) * T, yd.length, STEP_BUDGET, contKnown) : null;
    if (atSamples && atSamples.ok && atSamples.y.length === yd.length) {
      let worst = 0;
      let scale = 1e-300;
      for (let k = 0; k < yd.length; k++) {
        worst = Math.max(worst, Math.abs(atSamples.y[k] - yd[k]));
        scale = Math.max(scale, Math.abs(yd[k]));
      }
      const rel = worst / scale;
      lines.push(
        `  Check: a ZOH model is EXACT at the sampling instants for a step input; against the continuous ` +
          `simulation at those instants the largest gap is ${rel === 0 ? "0" : num(rel, 2)} of the response's size` +
          (rel < 1e-4 ? " (integration error only)." : ": larger than integration error, so treat the discrete model with care."),
      );
    }
    for (const nt of res.notes) lines.push(`Note: ${nt}`);
    lines.push(UNIT_NOTE);

    const ser: Series[] = [];
    if (cont.ok) ser.push({ points: cont.t.map((t, i) => ({ x: t, y: cont.y[i] })), type: "line", color: "#9ca3af", label: "continuous y(t)" });
    const stairs: { x: number; y: number }[] = [];
    yd.forEach((v, k) => {
      stairs.push({ x: k * T, y: v });
      if (k + 1 < yd.length) stairs.push({ x: (k + 1) * T, y: v });
    });
    ser.push({ points: stairs, type: "line", color: "#2563eb", label: "discrete y[k] (held)" });
    if (yd.length <= 120) ser.push({ points: yd.map((v, k) => ({ x: k * T, y: v })), type: "scatter", color: "#1d4ed8", label: "samples" });
    const step = buildPlotSvg(ser, { width: 380, height: 250, xlabel: "Time (s)", ylabel: "Output", title: "Step response: discrete over continuous" });
    const ss = svgSize(step, 380, 250);
    const zp = zPlaneSvg(res);
    const zs = svgSize(zp, S_PLANE_W, 400);
    return report(lines, [
      { kind: "plot", svg: step, caption: "Discrete step response over the continuous one", alt: "Held discrete samples of the step response drawn over the continuous step response", w: ss.w, h: ss.h },
      { kind: "plot", svg: zp, caption: "Discrete poles and zeros on the z-plane", alt: "Discrete poles and zeros with the unit circle", w: zs.w, h: zs.h },
    ]);
  },
};

export const CONTROL_CALCS: ControlCalc[] = [rootLocusCalc, nyquistCalc, leadLagCalc, c2dCalc];

