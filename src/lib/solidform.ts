// Solid-form characterization (gap item 2, docs/SCOPE-SOLID-FORM.md): X-ray powder diffraction (XRPD) patterns and
// peak lists, DSC and TGA thermograms — the data polymorph and salt patents rest on. Bragg's law gives each peak's
// d-spacing; peaks are picked from a measured pattern over a fitted background, above a noise floor measured from the
// pattern itself; thermal events are read with the conventions the instrument software uses (onset by the tangent at
// the inflection, a glass transition by its half-height midpoint, steps by the derivative). It writes the peak table and
// the "characterized by" text the claims cite.
//
// Pure: no Office.js. Every number here comes from the user's own data; nothing is predicted.

import { maxOf, minOf } from "./minmax";

export const SOLID_SOURCE =
  "Bragg: nλ = 2d sin θ. Wavelengths: Cu Kα1 1.540598 Å, Cu Kα2 1.544426 Å, Cu Kα (weighted) 1.541874 Å, Co Kα1 1.788965 Å, Mo Kα1 0.709300 Å (Hölzer et al., Phys. Rev. A 56, 4554 (1997); International Tables C, 4.2.2). Background: SNIP (Ryan et al. 1988; Morháč 1997). DSC onset: the extrapolated baseline meets the tangent at the leading edge's inflection (ASTM E794 / ISO 11357-1); glass transition: half-height midpoint (ASTM E1356).";

export const WAVELENGTHS = {
  CuKa1: { a: 1.540598, name: "Cu Kα1 (1.5406 Å)", radiation: "Cu Kα1" },
  CuKa: { a: 1.541874, name: "Cu Kα, weighted (1.5419 Å)", radiation: "Cu Kα" },
  CoKa1: { a: 1.788965, name: "Co Kα1 (1.7890 Å)", radiation: "Co Kα1" },
  MoKa1: { a: 0.7093, name: "Mo Kα1 (0.7093 Å)", radiation: "Mo Kα1" },
} as const;
export type WavelengthId = keyof typeof WAVELENGTHS;
const CU_KA2 = 1.544426;

export type XY = [number, number];

// ---------------------------------------------------------------------------
// Small numerics
// ---------------------------------------------------------------------------

function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/**
 * At most `max` points: consecutive groups averaged (in both coordinates). A 0.01 °C thermogram then costs what a
 * 0.05 °C one does — onsets and steps are read to 0.1 °C, far coarser than the thinned spacing.
 */
function thin(pts: XY[], max = 5000): XY[] {
  if (pts.length <= max) return pts;
  const g = Math.ceil(pts.length / max);
  const out: XY[] = [];
  for (let i = 0; i < pts.length; i += g) {
    let sx = 0, sy = 0, c = 0;
    for (let j = i; j < Math.min(pts.length, i + g); j++) (sx += pts[j][0]), (sy += pts[j][1]), c++;
    out.push([sx / c, sy / c]);
  }
  return out;
}

/** Robust standard deviation: 1.4826 × the median absolute deviation from the median. */
function robustSigma(v: number[]): number {
  const m = median(v);
  return 1.4826 * median(v.map((x) => Math.abs(x - m)));
}
/** Savitzky–Golay quadratic smoothing weights for a window of 2m + 1, and their centre weight (the noise gain²). */
function sgWeights(m: number): number[] {
  const den = (2 * m - 1) * (2 * m + 1) * (2 * m + 3);
  return Array.from({ length: 2 * m + 1 }, (_, i) => {
    const k = i - m;
    return (3 * (3 * m * m + 3 * m - 1) - 15 * k * k) / den;
  });
}
function sgSmooth(y: number[], m: number): number[] {
  if (m < 1 || y.length < 2 * m + 1) return [...y];
  const w = sgWeights(m);
  const n = y.length;
  return y.map((_, i) => {
    if (i < m || i >= n - m) {
      // Near the ends: a centred moving average over what is there.
      const a = Math.max(0, i - m), b = Math.min(n - 1, i + m);
      const h = Math.min(i - a, b - i);
      let s = 0;
      for (let j = i - h; j <= i + h; j++) s += y[j];
      return s / (2 * h + 1);
    }
    let s = 0;
    for (let k = -m; k <= m; k++) s += w[k + m] * y[i + k];
    return s;
  });
}
/** The half-sample mode (Bickel & Frühwirth 2006): repeatedly keep the half of the sorted values with the least range. */
function halfSampleMode(v: number[]): number {
  let s = [...v].filter(Number.isFinite).sort((a, b) => a - b);
  while (s.length > 3) {
    const h = Math.ceil(s.length / 2);
    let best = 0;
    for (let i = 1; i + h - 1 < s.length; i++) if (s[i + h - 1] - s[i] < s[best + h - 1] - s[best]) best = i;
    s = s.slice(best, best + h);
  }
  return s.length === 3 ? (s[1] - s[0] < s[2] - s[1] ? (s[0] + s[1]) / 2 : s[1] - s[0] > s[2] - s[1] ? (s[1] + s[2]) / 2 : s[1]) : s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
}

function fitLine(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  if (!n) return { a: NaN, b: NaN };
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) (sxy += (xs[i] - mx) * (ys[i] - my)), (sxx += (xs[i] - mx) ** 2);
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

// ---------------------------------------------------------------------------
// Reading pasted tables
// ---------------------------------------------------------------------------

export interface Table {
  /** Data rows, each the same number of columns. */
  rows: number[][];
  /** Column names from the header line above the data, when it has as many fields. */
  header: string[] | null;
  decimalComma: boolean;
  notes: string[];
  errors: string[];
}

const NUMTOK = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const COMMA_DECIMAL_TOK = /^[-+]?\d+,\d+([eE][-+]?\d+)?$/;
const THOUSANDS_TOK = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * A pasted table, any common export: headers and metadata lines skipped (said), separators decided once for the whole
 * input — semicolon, tab, comma or spaces — and decimal commas recognised when the file uses them throughout
 * ("3,02<tab>202", "3,02 202", "5,2;10,4").
 */
export function parseTable(text: string, maxRows = 200000): Table {
  const out: Table = { rows: [], header: null, decimalComma: false, notes: [], errors: [] };
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l && !/^[#!%*/]/.test(l));
  const anyDot = lines.some((l) => /\d\.\d/.test(l));
  const semis = lines.filter((l) => l.includes(";")).length;
  const tabs = lines.filter((l) => l.includes("\t")).length;
  // Thousands separators ("1,234" in a file that writes decimals with points, as copied from a spreadsheet): split on
  // tabs or spaces, every token a number or a comma-grouped number, at least one of the latter, two or more per line.
  const wsToks = lines.map((l) => l.split(/\s+/).filter(Boolean));
  const numericWs = wsToks.filter((tk) => tk.length >= 2 && tk.every((t) => NUMTOK.test(t) || THOUSANDS_TOK.test(t)));
  const thousands = anyDot && numericWs.length >= 0.5 * lines.length && numericWs.some((tk) => tk.some((t) => THOUSANDS_TOK.test(t) && !NUMTOK.test(t)));
  const sep: "semi" | "tab" | "comma" | "space" =
    semis > lines.length / 2 ? "semi" : tabs > lines.length / 2 ? "tab" : thousands ? "space" : lines.some((l) => /\d\s*,\s*[-+.\d]/.test(l)) ? "comma" : "space";
  // Decimal comma: no dotted decimals anywhere, and comma-decimal tokens once split on the other separators.
  // Tab-separated DATA rows split on any whitespace: a paste that mixes tabs and spaces between the columns
  // ("5.20\t100" on one row, "10.40 85" on the next — hand-edited exports do this) kept only its tab rows, and the
  // space rows were dropped as "not numbers". Data cells are numbers, so no cell has a space inside; a HEADER's cells
  // can ("2θ (deg)\tIntensity"), so the header alone is still split on tabs (headerSplit below).
  const splitBy = (l: string, s: typeof sep): string[] =>
    (s === "semi" ? l.split(";") : s === "tab" ? l.split(/\s+/) : s === "comma" ? l.split(/\s*,\s*|\s+/) : l.split(/\s+/)).map((x) => x.trim()).filter((x) => x !== "");
  const headerSplit = (l: string): string[] => l.split(/\t+/).map((x) => x.trim()).filter((x) => x !== "");
  // Decimal commas: no dotted decimal anywhere, and — split on the other separators — tokens like 3,02 with every data
  // line still holding at least two numbers (one comma-number per line stays an "x,y" pair: 6,100 is 6 and 100).
  let decimalComma = false;
  let effSep = sep;
  if (!anyDot) {
    const trySep = sep === "comma" ? (tabs ? "tab" : "space") : sep;
    const split = lines.map((l) => splitBy(l, trySep));
    const numeric = split.filter((toks) => toks.length > 0 && toks.every((t) => NUMTOK.test(t) || COMMA_DECIMAL_TOK.test(t)));
    const hasCommaDec = numeric.some((toks) => toks.some((t) => COMMA_DECIMAL_TOK.test(t)));
    if (hasCommaDec && (sep === "semi" || (numeric.length > 0 && numeric.every((toks) => toks.length >= 2)))) {
      decimalComma = true;
      effSep = trySep;
    }
  }
  out.decimalComma = decimalComma;
  const lens = new Map<number, number>();
  const parsed: Array<{ nums: number[] | null; raw: string }> = lines.map((l) => {
    const toks = splitBy(l, effSep).map((t) => (decimalComma ? t.replace(",", ".") : thousands && THOUSANDS_TOK.test(t) ? t.replace(/,/g, "") : t));
    const nums = toks.map((t) => (NUMTOK.test(t) ? Number(t) : NaN));
    if (!toks.length || nums.some((x) => !Number.isFinite(x))) return { nums: null, raw: l };
    lens.set(nums.length, (lens.get(nums.length) ?? 0) + 1);
    return { nums, raw: l };
  });
  let width = 0, best = 0;
  for (const [w, c] of lens) if (c > best || (c === best && w > width)) (width = w), (best = c);
  let firstData = -1, skippedBefore = 0, odd = 0;
  const after: string[] = [];
  parsed.forEach((p, i) => {
    if (p.nums && p.nums.length === width) {
      if (firstData < 0) firstData = i;
      if (out.rows.length < maxRows) out.rows.push(p.nums);
      else if (out.rows.length === maxRows) out.errors.push(`More than ${maxRows.toLocaleString("en-US")} rows — trim the range or export a coarser step.`);
    } else if (firstData < 0) skippedBefore++;
    else if (p.nums) odd++;
    else after.push(p.raw);
  });
  if (firstData > 0) {
    const hl = lines[firstData - 1];
    const h = (effSep === "tab" || effSep === "space") && hl.includes("\t") ? headerSplit(hl) : splitBy(hl, effSep);
    if (h.length === width) out.header = h;
  }
  if (skippedBefore) out.notes.push(`${skippedBefore} header line${skippedBefore === 1 ? "" : "s"} skipped.`);
  if (odd) out.notes.push(`${odd} row${odd === 1 ? "" : "s"} with a different number of columns left out.`);
  for (const a of after.slice(0, 3)) out.notes.push(`A line after the data was not numbers and was left out: “${a.slice(0, 50)}”.`);
  if (decimalComma) out.notes.push("Read with decimal commas (3,02 = 3.02).");
  if (thousands) out.notes.push("Read with thousands separators (5,230 = 5230). If those commas are decimal commas (5.230), write the numbers with points, or separate the columns with semicolons.");
  if (!out.rows.length) out.errors.push("No data: paste columns of numbers (2θ and intensity, or temperature and signal).");
  return out;
}

/** d = λ / (2 sin θ), first order; θ is half the 2θ angle. */
export function dSpacing(twoThetaDeg: number, lambdaA: number): number {
  return lambdaA / (2 * Math.sin((twoThetaDeg * Math.PI) / 360));
}

// ---------------------------------------------------------------------------
// XRPD
// ---------------------------------------------------------------------------

export interface Peak {
  twoTheta: number;
  d: number;
  /** Net height above background (pattern units), or as given. */
  height: number;
  /** Height relative to the strongest peak, %. */
  rel: number;
}

export interface PickOptions {
  /** Smallest peak kept, % of the strongest (default 5). */
  minRelative?: number;
  /** Peaks closer than this (° 2θ) are one peak (default 0.15). */
  minSeparation?: number;
  /** The anode, for Kα2 shoulders (Cu data only). */
  wavelength?: WavelengthId;
}

/** A measured pattern, not a list: many points on a steady step. */
export function isPattern(xs: number[]): boolean {
  if (xs.length < 30) return false;
  const s = [...xs].sort((a, b) => a - b);
  const steps = s.slice(1).map((x, i) => x - s[i]);
  const m = median(steps);
  if (!(m > 0 && m <= 0.5)) return false;
  const dev = steps.map((d) => Math.abs(d - m));
  return median(dev) <= 0.2 * m && steps.filter((d) => Math.abs(d - m) > 0.5 * m).length <= steps.length * 0.05;
}

/** SNIP background (log-log-square-root transform, clipping windows decreasing from `w` points to 1). */
function snip(y0: number[], w: number): number[] {
  // Mirrored at both ends by the window, so the points near an end are clipped like any other.
  const pad = Math.min(w, y0.length - 1);
  const y = [...y0.slice(1, pad + 1).reverse(), ...y0, ...y0.slice(-pad - 1, -1).reverse()];
  const n = y.length;
  const lo = minOf(y);
  const shift = lo < 0 ? -lo : 0;
  let v = y.map((x) => Math.log(Math.log(Math.sqrt(x + shift + 1) + 1) + 1));
  for (let p = w; p >= 1; p--) {
    const nv = [...v];
    for (let i = p; i < n - p; i++) nv[i] = Math.min(v[i], (v[i - p] + v[i + p]) / 2);
    v = nv;
  }
  return v.slice(pad, pad + y0.length).map((x) => (Math.exp(Math.exp(x) - 1) - 1) ** 2 - 1 - shift);
}

/**
 * Peaks from a measured XRPD pattern. The background is clipped away (SNIP over about 1° 2θ, so broad features —
 * an amorphous halo, a steep low-angle rise — stay in it); the pattern is smoothed (Savitzky–Golay, window scaled to
 * the step); the noise is measured from the pattern itself (the robust spread of what smoothing removes, degree by
 * degree), so counts, cps and normalised data are all handled; a peak must stand 5 noise widths above the
 * background and 4 above the dip to its taller neighbour, and above `minRelative` % of the strongest. Each is refined
 * by a parabola; neighbours closer than `minSeparation` merge; for Cu data, a Kα2 shoulder of a stronger peak is
 * left out and named.
 */
export function pickPeaks(points: XY[], lambdaA: number, opts: PickOptions = {}): { peaks: Peak[]; errors: string[]; notes: string[]; amorphous: { center: number } | null } {
  const errors: string[] = [];
  const notes: string[] = [];
  const pts = [...points].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const fail = (e: string) => ({ peaks: [], errors: [e], notes, amorphous: null });
  if (pts.length < 15) return fail("Too few points to find peaks in (at least 15) — or paste a peak list instead.");
  if (pts[0][0] <= 0 || pts[pts.length - 1][0] >= 180) return fail("The first column must be 2θ in degrees, between 0 and 180.");
  for (let i = 1; i < pts.length; i++) if (pts[i][0] === pts[i - 1][0]) return fail(`Two points at the same angle (${pts[i][0]}° 2θ) — the data is not one pattern.`);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const step = median(xs.slice(1).map((x, i) => x - xs[i]));
  // Smoothing over about 0.05° each side of a point (never wider than a sharp reflection).
  // Smoothing only with at least two points each side (quadratic Savitzky–Golay over three points is no smoothing).
  const mWant = Math.round(0.05 / step);
  const m = mWant >= 2 ? Math.min(8, mWant) : 0;
  const smooth = sgSmooth(ys, m);
  const h0 = m >= 2 ? sgWeights(m)[m] : 1;
  // Noise, measured the same way whatever the step: the second difference y − (y₋ + y₊)/2 (σ√1.5 for white noise),
  // its robust spread per 1° block, scaled to the smoothed signal. Never NaN; never below a floor.
  const resid = ys.map((y, i) => (i > 0 && i < n - 1 ? y - (ys[i - 1] + ys[i + 1]) / 2 : 0));
  const block = Math.max(15, Math.round(1 / step));
  const sigBlock: number[] = [];
  for (let s = 0; s < n; s += block) {
    const v = robustSigma(resid.slice(s, Math.min(n, s + block))) / Math.sqrt(1.5);
    sigBlock.push(Number.isFinite(v) ? v : 0);
  }
  const positive = sigBlock.filter((v) => v > 0);
  const scale = maxOf(ys) - minOf(ys);
  const globalSig = positive.length ? median(positive) : 0;
  // Per point: its block's noise (no worse than a quarter of the typical, and a hair above zero for noise-free data).
  const floor = Math.max(0.25 * globalSig, 1e-9 * (scale || 1));
  const sigPt = xs.map((_, i) => Math.max(sigBlock[Math.min(sigBlock.length - 1, Math.floor(i / block))], floor));
  const gainS = Math.sqrt(h0);
  const noiseAt = (i: number): number => sigPt[i] * gainS;
  // Background on the smoothed pattern (clipping raw noise biases a background low).
  // A fine step clips on a copy thinned to 0.01° and is interpolated back: the background varies over degrees, and the
  // clipping costs (points × window), which at 0.0004° would be minutes.
  const fct = Math.max(1, Math.ceil(0.01 / step));
  let bg: number[];
  if (fct === 1) bg = snip(smooth, Math.max(3, Math.round(1 / step)));
  else {
    const cx: number[] = [], cy: number[] = [];
    for (let i = 0; i < n; i += fct) {
      let sx = 0, sy = 0, c = 0;
      for (let j = i; j < Math.min(n, i + fct); j++) (sx += xs[j]), (sy += smooth[j]), c++;
      cx.push(sx / c);
      cy.push(sy / c);
    }
    const cb = snip(cy, Math.max(3, Math.round(1 / (step * fct))));
    let k = 0;
    bg = xs.map((x) => {
      while (k + 1 < cx.length - 1 && cx[k + 1] < x) k++;
      const t = Math.max(0, Math.min(1, (x - cx[k]) / (cx[k + 1] - cx[k] || 1)));
      return cb[k] + (cb[Math.min(cb.length - 1, k + 1)] - cb[k]) * t;
    });
  }
  const raw = smooth.map((v, i) => v - bg[i]);
  // Clipping follows the noise's lower envelope, so the clipped background sits a few noise widths low: the median of
  // what is left, degree by degree (peaks are a small part of any degree), is that bias, and it comes off.
  const offC: number[] = [], offV: number[] = [];
  for (let s0 = 0; s0 < n; s0 += block) {
    const seg = raw.slice(s0, Math.min(n, s0 + block));
    offC.push(xs[Math.min(n - 1, s0 + (seg.length >> 1))]);
    offV.push(median(seg));
  }
  let ok = 0;
  const net = raw.map((v, i) => {
    while (ok + 1 < offC.length && offC[ok + 1] < xs[i]) ok++;
    const t = ok + 1 < offC.length ? Math.max(0, Math.min(1, (xs[i] - offC[ok]) / (offC[ok + 1] - offC[ok] || 1))) : 0;
    return v - Math.max(0, offV[ok] + (offV[Math.min(offV.length - 1, ok + 1)] - offV[ok]) * t);
  });
  const minRel = opts.minRelative ?? 5;
  const minSep = opts.minSeparation ?? 0.15;
  // Local maxima that clear the noise floor.
  const cand: number[] = [];
  for (let i = 1; i < n - 1; i++) if (net[i] > net[i - 1] && net[i] >= net[i + 1] && net[i] > 5 * noiseAt(i)) cand.push(i);
  // Prominence: the drop from the peak to the higher of the two lowest points between it and a taller peak (or the end).
  const prominent = cand.filter((i) => {
    let leftMin = net[i], rightMin = net[i];
    for (let j = i - 1; j >= 0; j--) {
      if (net[j] > net[i]) break;
      leftMin = Math.min(leftMin, net[j]);
    }
    for (let j = i + 1; j < n; j++) {
      if (net[j] > net[i]) break;
      rightMin = Math.min(rightMin, net[j]);
    }
    return net[i] - Math.max(leftMin, rightMin) > 4 * noiseAt(i);
  });
  const found: Peak[] = prominent.map((i) => {
    const y0 = net[i - 1], y1 = net[i], y2 = net[i + 1];
    const denom = y0 - 2 * y1 + y2;
    const off = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
    const tt = xs[i] + (off * (xs[i + 1] - xs[i - 1])) / 2;
    return { twoTheta: tt, d: dSpacing(tt, lambdaA), height: y1 - 0.25 * (y0 - y2) * off, rel: 0 };
  });
  const merged: Peak[] = [];
  for (const c of found.sort((a, b) => b.height - a.height)) if (!merged.some((p) => Math.abs(p.twoTheta - c.twoTheta) < minSep)) merged.push(c);
  // Kα2: Cu data only; a shoulder 0.3–0.7 of a stronger peak where Kα2 falls.
  let peaks = merged;
  // Only for unstripped Cu Kα (the weighted wavelength): with Cu Kα1 chosen the data are taken as stripped or monochromated.
  const isCu = opts.wavelength === undefined ? Math.abs(lambdaA - 1.541874) < 1e-4 : opts.wavelength === "CuKa";
  if (isCu) {
    const dropped: string[] = [];
    peaks = merged.filter((q) => {
      const parent = merged.find((p) => {
        if (p === q || p.height <= q.height) return false;
        const t2 = (2 * Math.asin(Math.min(1, (CU_KA2 / 1.540598) * Math.sin((p.twoTheta * Math.PI) / 360))) * 180) / Math.PI;
        const r = q.height / p.height;
        return Math.abs(q.twoTheta - t2) <= Math.max(0.03, 2 * step) && r >= 0.3 && r <= 0.7;
      });
      if (parent) dropped.push(`${q.twoTheta.toFixed(2)}° (Kα2 of ${parent.twoTheta.toFixed(2)}°)`);
      return !parent;
    });
    if (dropped.length) notes.push(`Left out as Cu Kα2 shoulders of stronger peaks: ${dropped.join(", ")}. Strip Kα2 in the instrument software to be sure.`);
  }
  const top = peaks.length ? maxOf(peaks.map((p) => p.height)) : 0;
  peaks = peaks.filter((p) => (p.height / top) * 100 >= minRel);
  for (const p of peaks) p.rel = (p.height / top) * 100;
  peaks.sort((a, b) => a.twoTheta - b.twoTheta);
  if (step > 0.05) notes.push(`The step is ${step.toFixed(3)}° 2θ — coarse for peak positions; a step of 0.02° or finer is usual.`);
  // An amorphous halo: no sharp peak, but a broad hump well above the noise.
  let amorphous: { center: number } | null = null;
  if (!peaks.length) {
    const line = (i: number) => smooth[0] + ((smooth[n - 1] - smooth[0]) * (xs[i] - xs[0])) / (xs[n - 1] - xs[0]);
    let k = 0;
    for (let i = 0; i < n; i++) if (smooth[i] - line(i) > smooth[k] - line(k)) k = i;
    if (smooth[k] - line(k) > 10 * Math.max(globalSig, 1e-12)) amorphous = { center: xs[k] };
  }
  return { peaks, errors, notes, amorphous };
}

/**
 * A peak list typed or pasted: 2θ, optionally with an intensity (relative or counts), or a "2θ d I" table (the
 * d column is recognised by agreeing with Bragg's law, in whichever position it is). Degree, percent and ± tolerance
 * marks are ignored; a header row is skipped; near-duplicates (within 0.05°) merge.
 */
export function parsePeakList(text: string, lambdaA: number): { peaks: Peak[]; errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const notes: string[] = [];
  // Marks that are not numbers: °, %, and a "± 0.2" tolerance.
  const cleaned = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/±\s*[\d.,]+\s*°?/g, " ").replace(/[°%]/g, " ").replace(/2θ|2-?theta/gi, "2T").trim())
    .filter(Boolean);
  let vals: Array<[number, number | null]> = [];
  if (cleaned.length === 1 && /[;,]/.test(cleaned[0]) && cleaned[0].split(/\s*[;,]\s*/).filter(Boolean).length >= 3) {
    // One line, a list: "5.2, 10.4, 15.6" or (decimal commas) "5,2;10,4;15,6".
    const line = cleaned[0];
    const parts = line.includes(";") ? line.split(/\s*;\s*/).map((p) => p.replace(",", ".")) : line.split(/\s*,\s*/);
    for (const p of parts.filter(Boolean)) {
      const f = p.trim().split(/\s+/);
      const a = NUMTOK.test(f[0]) ? Number(f[0]) : NaN, b = f[1] !== undefined && NUMTOK.test(f[1]) ? Number(f[1]) : null;
      if (!Number.isFinite(a) || (f[1] !== undefined && b === null)) {
        errors.push(`“${p.trim()}” is not an angle.`);
        continue;
      }
      vals.push([a, b]);
    }
    if (line.includes(";") && line.includes(",")) notes.push("Read with decimal commas (5,2 = 5.2).");
  } else {
    const t = parseTable(cleaned.join("\n"));
    if (t.errors.length) {
      // Nothing numeric: name the lines that are not.
      const bad = cleaned.filter((l) => !/\d/.test(l) || l.split(/[\s,;\t]+/).some((x) => x && !NUMTOK.test(x.replace(",", "."))));
      return { peaks: [], errors: bad.length ? bad.slice(0, 5).map((l) => `“${l.slice(0, 40)}” is not “2θ” or “2θ intensity”.`) : ["No peaks: type 2θ values (one per line, or comma-separated), optionally with intensities."], notes };
    }
    notes.push(...t.notes.filter((x) => !/header line/.test(x)));
    const w = t.rows[0].length;
    // "5,2" alone on each line: an angle and an intensity, or an angle with a decimal comma? Read as the first, and said.
    if (cleaned.every((l) => /^\d+\s*,\s*\d+$/.test(l)))
      notes.push("Read “5,2” as 2θ 5° with intensity 2. If the commas are decimal commas (5.2°), write the angles with points, or on one line separated by semicolons: 5,2;10,4;15,6.");
    if (w === 1) vals = t.rows.map((r) => [r[0], null]);
    else if (w === 2) vals = t.rows.map((r) => [r[0], r[1]]);
    else {
      // Which column is d? The one that agrees with Bragg's law for column 1 (any of the usual anodes).
      const lambdas = [lambdaA, ...Object.values(WAVELENGTHS).map((x) => x.a)];
      const isD = (c: number): boolean => lambdas.some((lam) => t.rows.filter((r) => Math.abs(r[c] - dSpacing(r[0], lam)) <= 0.03 * dSpacing(r[0], lam)).length >= 0.8 * t.rows.length);
      const dCol = [1, 2, 3].find((c) => c < w && isD(c));
      const iCol = [1, 2, 3].find((c) => c < w && c !== dCol)!;
      vals = t.rows.map((r) => [r[0], r[iCol]]);
      notes.push(dCol !== undefined ? `Read as 2θ, d and intensity (column ${iCol + 1} as the intensity).` : `More than two columns: column ${iCol + 1} is read as the intensity.`);
    }
  }
  if (!vals.length && !errors.length) errors.push("No peaks: type 2θ values (one per line, or comma-separated), optionally with intensities.");
  for (const [a] of vals) if (!(a > 0 && a < 180)) errors.push(`${a}° is not a 2θ angle between 0 and 180.`);
  if (errors.length) return { peaks: [], errors, notes };
  const hasI = vals.every((v) => v[1] !== null);
  if (!hasI && vals.some((v) => v[1] !== null)) notes.push("Some peaks have intensities and some do not — relative intensities are left out.");
  vals.sort((x, y) => x[0] - y[0]);
  // Near-duplicates: within 0.05°, one peak (the stronger kept).
  const kept: Array<[number, number | null]> = [];
  for (const v of vals) {
    const prev = kept[kept.length - 1];
    if (prev && v[0] - prev[0] <= 0.05 + 1e-9) {
      notes.push(`${prev[0]}° and ${v[0]}° are within 0.05° — merged into one peak.`);
      if (hasI && (v[1] ?? 0) > (prev[1] ?? 0)) kept[kept.length - 1] = v;
      continue;
    }
    kept.push(v);
  }
  const top = hasI ? maxOf(kept.map((v) => v[1]!)) : 1;
  const peaks = kept.map(([a, b]) => ({ twoTheta: a, d: dSpacing(a, lambdaA), height: hasI ? b! : NaN, rel: hasI && top > 0 ? (b! / top) * 100 : NaN }));
  return { peaks, errors, notes };
}

/** Decimal places: 2θ to 0.1° (patent practice for ±0.2° claims) or 0.01°; d to 0.01 Å; relative intensity whole %. */
export function peakRows(peaks: Peak[], decimals2t = 1): string[][] {
  return peaks.map((p) => [p.twoTheta.toFixed(decimals2t), p.d.toFixed(2), Number.isFinite(p.rel) ? String(Math.round(p.rel)) : "—"]);
}

export interface ClaimTextOptions {
  /** How many peaks to cite (the strongest; default 5). */
  count?: number;
  /** ± tolerance, ° 2θ (default 0.2). */
  tolerance?: number;
  wavelength: WavelengthId;
  /** The form's name ("crystalline Form A of compound 1"); default "A crystalline form". */
  subject?: string;
}

/** The subject as a sentence's first words: capitalised, defaulting to "A crystalline form". */
export const sentenceSubject = (s: string | undefined): string => {
  const t = (s ?? "").trim() || "A crystalline form";
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * "…characterized by an X-ray powder diffraction pattern comprising peaks at 2θ angles of about 5.2°, 10.4° and 15.6°
 * ± 0.2° 2θ, measured with Cu Kα1 radiation." The cited peaks are the strongest, listed by angle.
 */
export function claimText(peaks: Peak[], o: ClaimTextOptions): { text: string; cited: Peak[]; notes: string[] } {
  const notes: string[] = [];
  const count = Math.max(1, Math.min(o.count ?? 5, peaks.length));
  const ranked = Number.isFinite(peaks[0]?.rel) ? [...peaks].sort((a, b) => b.rel - a.rel) : [...peaks];
  if (!Number.isFinite(peaks[0]?.rel) && (o.count ?? 5) < peaks.length) notes.push("The list has no intensities, so the first peaks by angle are cited, not the strongest.");
  const cited = ranked.slice(0, count).sort((a, b) => a.twoTheta - b.twoTheta);
  const tol = o.tolerance ?? 0.2;
  const dec = tol < 0.1 ? 2 : 1;
  const angles = cited.map((p) => `${p.twoTheta.toFixed(dec)}°`);
  const list = angles.length === 1 ? angles[0] : angles.length === 2 ? `${angles[0]} and ${angles[1]}` : `${angles.slice(0, -1).join(", ")} and ${angles[angles.length - 1]}`;
  // Closely spaced cited peaks overlap within the tolerance: said, since a claim citing both reads on one peak.
  for (let i = 1; i < cited.length; i++) if (cited[i].twoTheta - cited[i - 1].twoTheta <= 2 * tol) notes.push(`${cited[i - 1].twoTheta.toFixed(dec)}° and ${cited[i].twoTheta.toFixed(dec)}° are within 2 × ±${tol}° of each other.`);
  const text = `${sentenceSubject(o.subject)}, characterized by an X-ray powder diffraction pattern comprising peaks at 2θ angles of about ${list} ± ${tol}° 2θ, measured with ${WAVELENGTHS[o.wavelength].radiation} radiation.`;
  return { text, cited, notes };
}

// ---------------------------------------------------------------------------
// DSC and TGA
// ---------------------------------------------------------------------------

export interface DscEvent {
  /** A peak (endotherm or exotherm), or a step change in heat flow (a glass transition). */
  kind: "endotherm" | "exotherm" | "step";
  /** Extrapolated onset (null when it cannot be placed between the event's start and its peak). */
  onset: number | null;
  /** The peak temperature; for a step, its half-height midpoint. */
  peak: number;
  start: number;
  end: number;
}

/**
 * Runs of points where the smoothed derivative leaves its quiet level — the candidate events. Everything here is in
 * °C, not points, so the result does not change with the sampling: short quiet gaps (under 0.3 °C) are bridged, and a
 * run must be at least 0.3 °C wide.
 */
function eventRuns(T: number[], s: number[], q: number, step: number): { d: number[]; runs: Array<[number, number]>; quiet: boolean[] } {
  const n = T.length;
  const d = T.map((_, i) => {
    const a = Math.max(0, i - q), b = Math.min(n - 1, i + q);
    return (s[b] - s[a]) / (T[b] - T[a] || 1);
  });
  const med = median(d);
  const dev = d.map((v) => Math.abs(v - med));
  const sd = robustSigma(d);
  const thr = Math.max(5 * sd, 0.005 * maxOf(dev));
  // The first and last q points are barely smoothed (the window runs off the data): never the start of an event.
  const quiet = dev.map((v, i) => v <= thr || i < q || i >= n - q);
  const gap = Math.max(2, Math.round(0.3 / step));
  const minW = Math.max(3, Math.round(0.3 / step));
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < n) {
    if (quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    for (;;) {
      let k = j + 1;
      while (k < n && quiet[k] && k - j <= gap) k++;
      if (k < n && !quiet[k] && k - j <= gap + 1) j = k;
      else break;
    }
    if (j - i + 1 >= minW) runs.push([i, j]);
    i = j + 1;
  }
  return { d, runs, quiet };
}

/**
 * Thermal events in a DSC trace (temperature, heat flow). The trace is smoothed (over about 1 °C) and its derivative
 * marks each event where it leaves its quiet level. Two runs are one event when the trace between them stays far from
 * the baseline (the derivative passes zero at a peak's apex, which would otherwise split it). Each event gets local
 * baselines before and after it. When the two are offset by more than the excursion between them, it is a step (a glass
 * transition), reported at its half-height midpoint (ASTM E1356). Otherwise its lobes are found — the excursion from the
 * baseline split where it changes sign, or dips below half of the smaller of two neighbouring maxima — and each lobe is
 * an endotherm or exotherm by its direction (`endoDown`: endotherms point down, "exo up"), with its onset where the
 * tangent at its leading edge's inflection meets the baseline (ASTM E794), the slope from a local fit.
 */
export function dscEvents(points: XY[], endoDown = true): { events: DscEvent[]; errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const notes: string[] = [];
  const pts = thin([...points].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]));
  if (pts.length < 20) return { events: [], errors: ["Too few points for a thermogram (at least 20)."], notes };
  const n = pts.length;
  const T = pts.map((p) => p[0]);
  const y = pts.map((p) => p[1]);
  const span = maxOf(y) - minOf(y);
  if (!(span > 0)) return { events: [], errors: ["The signal is flat — no events."], notes };
  const step = median(T.slice(1).map((t, i) => t - T[i]));
  const m = Math.max(2, Math.min(400, Math.round(0.5 / step)));
  const s = sgSmooth(y, m);
  const sig = robustSigma(y.map((v, i) => v - s[i]));
  const { d, runs: raw, quiet } = eventRuns(T, s, m, step);
  const win = Math.max(5, Math.round(5 / step));
  const fitQuiet = (from: number, to: number): { a: number; b: number } | null => {
    const xs: number[] = [], ys: number[] = [];
    for (let k = Math.max(0, from); k <= Math.min(n - 1, to); k++) if (quiet[k]) xs.push(T[k]), ys.push(s[k]);
    return xs.length >= 3 ? fitLine(xs, ys) : null;
  };
  const at = (L: { a: number; b: number }, t: number) => L.a + L.b * t;
  const floor = Math.max(6 * sig * Math.sqrt(sgWeights(m)[m]), 0.01 * span);
  // Merge runs split at an apex: the trace between them stays far from the line joining the outer baselines.
  const runs = [...raw];
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = 0; r + 1 < runs.length; r++) {
      const [a, b] = runs[r], [c, e] = runs[r + 1];
      if (T[c] - T[b] > 0.5 * (T[b] - T[a] + T[e] - T[c])) continue;
      const pre = fitQuiet(a - win, a - 1), post = fitQuiet(e + 1, e + win);
      const L0 = pre ?? post, L1 = post ?? pre;
      if (!L0 || !L1) continue;
      const line = (k: number) => at(L0, T[a]) + ((at(L1, T[e]) - at(L0, T[a])) * (T[k] - T[a])) / (T[e] - T[a] || 1);
      let gapDev = 0, exc = 0;
      for (let k = b + 1; k < c; k++) gapDev = Math.max(gapDev, Math.abs(s[k] - line(k)));
      // Compared with the excursion just beside the gap, not the whole of both runs: at an apex the trace beside the gap
      // is as far out as in it; between two events it falls back toward the baseline.
      const reach = Math.max(3, 2 * (c - b));
      for (let k = Math.max(a, b - reach); k <= Math.min(e, c + reach); k++) if (k <= b || k >= c) exc = Math.max(exc, Math.abs(s[k] - line(k)));
      // Or two halves that would each read as a step, in opposite directions, cancelling: one peak split at its apex.
      const mid = fitQuiet(b + 1, c - 1);
      const offA = mid && pre ? at(mid, (T[a] + T[b]) / 2) - at(pre, (T[a] + T[b]) / 2) : 0;
      const offB = mid && post ? at(post, (T[c] + T[e]) / 2) - at(mid, (T[c] + T[e]) / 2) : 0;
      const cancelling = offA * offB < 0 && Math.abs(offA + offB) < 0.5 * Math.max(Math.abs(offA), Math.abs(offB)) && Math.max(Math.abs(offA), Math.abs(offB)) > floor;
      if (gapDev > 0.3 * exc || cancelling) {
        runs.splice(r, 2, [a, e]);
        changed = true;
        break;
      }
    }
  }
  const events: DscEvent[] = [];
  for (const [a, b] of runs) {
    const pre = fitQuiet(a - win, a - 1), post = fitQuiet(b + 1, b + win);
    const preL = pre ?? post, postL = post ?? pre;
    if (!preL || !postL) continue;
    const blend = (k: number) => {
      const f = (T[k] - T[a]) / (T[b] - T[a] || 1);
      return at(preL, T[k]) * (1 - f) + at(postL, T[k]) * f;
    };
    const dev = s.slice(a, b + 1).map((v, i) => v - blend(a + i));
    const depth = maxOf(dev.map(Math.abs));
    const tc = (T[a] + T[b]) / 2;
    const offset = Math.abs(at(postL, tc) - at(preL, tc));
    if (offset > 1.5 * depth && offset > floor && pre && post) {
      // A step: the half-height midpoint, where the trace crosses halfway between the two baselines.
      for (let i = a; i < b; i++) {
        const h0 = (at(preL, T[i]) + at(postL, T[i])) / 2, h1 = (at(preL, T[i + 1]) + at(postL, T[i + 1])) / 2;
        if ((s[i] - h0) * (s[i + 1] - h1) <= 0) {
          const fr = (s[i] - h0) / (s[i] - h0 - (s[i + 1] - h1) || 1);
          events.push({ kind: "step", onset: null, peak: T[i] + fr * (T[i + 1] - T[i]), start: T[a], end: T[b] });
          break;
        }
      }
      continue;
    }
    if (depth <= floor) continue;
    if (offset > floor && offset > 0.25 * depth) notes.push(`The baseline shifts by ${+offset.toPrecision(2)} across the event near ${tc.toFixed(0)} °C — a heat-capacity change (or a glass transition) under it?`);
    // Lobes are measured outside the band between the baselines before and after the event, not from the straight blend
    // across it: under a heat-capacity shift (or a Tg) the trace runs on one side of the blend without being a peak of
    // the other sign. A lobe splits off where the excursion leaves the band on the other side, or dips below half the
    // smaller of two neighbouring maxima.
    const band = s.slice(a, b + 1).map((v, i) => {
      const t = T[a + i], p0 = at(preL, t), p1 = at(postL, t);
      return v < Math.min(p0, p1) ? v - Math.min(p0, p1) : v > Math.max(p0, p1) ? v - Math.max(p0, p1) : 0;
    });
    const lobes: Array<[number, number]> = [];
    let ls = 0, lastSign = 0;
    for (let i = 0; i < band.length; i++) {
      const sg = Math.sign(band[i]);
      if (sg !== 0 && lastSign !== 0 && sg !== lastSign && Math.abs(band[i]) > floor) {
        lobes.push([ls, i - 1]);
        ls = i;
      }
      if (sg !== 0 && Math.abs(band[i]) > floor) lastSign = sg;
    }
    lobes.push([ls, band.length - 1]);
    const split: Array<[number, number]> = [];
    for (const [p0, p1] of lobes) {
      // Within one sign: local maxima of the excursion with a deep enough dip between them.
      const absd = band.slice(p0, p1 + 1).map(Math.abs);
      const maxima: number[] = [];
      for (let i = 1; i + 1 < absd.length; i++) if (absd[i] > absd[i - 1] && absd[i] >= absd[i + 1] && absd[i] > floor) maxima.push(i);
      let start = 0;
      let last = -1;
      for (const mx of maxima) {
        if (last >= 0) {
          let lo = last;
          for (let i = last; i <= mx; i++) if (absd[i] < absd[lo]) lo = i;
          if (absd[lo] < 0.5 * Math.min(absd[last], absd[mx])) {
            split.push([p0 + start, p0 + lo]);
            start = lo + 1;
            last = mx;
            continue;
          }
          if (absd[mx] > absd[last]) last = mx;
          continue;
        }
        last = mx;
      }
      split.push([p0 + start, p1]);
    }
    for (const [q0, q1] of split) {
      const la = a + q0, lb = a + q1;
      // The lobe's extreme, and its direction, outside the band.
      let k = la;
      for (let i = la; i <= lb; i++) if (Math.abs(band[i - a]) > Math.abs(band[k - a])) k = i;
      const ext = Math.abs(band[k - a]);
      if (ext <= floor) continue;
      const down = band[k - a] < 0;
      const kind: DscEvent["kind"] = down === endoDown ? "endotherm" : "exotherm";
      // The inflection of the leading edge, and the baseline it meets: the one before the event for its first lobe,
      // the baseline under the event (through this lobe's start, with the slope before it) for a later one.
      let st = la;
      for (let i = la; i <= k; i++) if (Math.abs(d[i]) > Math.abs(d[st])) st = i;
      const q = Math.max(2, Math.round(m / 2));
      const tan = fitLine(T.slice(Math.max(la, st - q), Math.min(k, st + q) + 1), s.slice(Math.max(la, st - q), Math.min(k, st + q) + 1));
      const base = la === a ? preL : { a: blend(la) - preL.b * T[la], b: preL.b };
      let onset: number | null = null;
      if (tan.b !== base.b && Number.isFinite(tan.b)) {
        const x = (base.a - tan.a) / (tan.b - base.b);
        if (x >= T[la] - 2 * step && x <= T[k]) onset = x;
      }
      if (onset === null) notes.push(`The ${kind} peaking at ${T[k].toFixed(1)} °C has no onset that can be placed before its peak (its leading edge overlaps another event, or is too shallow) — its peak is given alone.`);
      events.push({ kind, onset, peak: T[k], start: T[la], end: T[lb] });
    }
  }
  if (events.some((e) => e.kind === "step")) notes.push("A step change in heat flow is reported at its half-height midpoint (a glass transition, ASTM E1356) — it is not an endotherm or exotherm.");
  if (!events.length) notes.push("No event stands out from the baseline.");
  return { events, errors, notes };
}

export interface TgaStep {
  start: number;
  end: number;
  /** Weight lost over the step (drift removed), percentage points of the starting weight. */
  loss: number;
  /** Temperature of the fastest loss (the DTG peak). */
  dtgPeak: number;
}

/**
 * Weight-loss steps in a TGA trace (temperature, weight % or mg). The trace is expressed as % of its starting weight,
 * smoothed (over about 2 °C) and differentiated (DTG); a steady drift (buoyancy, a slow loss) is measured from the
 * quiet stretches and taken out; each DTG peak clear of the noise is a step, two steps are split at the DTG minimum
 * between them when it dips below half the smaller peak, and each runs out to where the rate falls to 2 % of its peak.
 * A weight gain is said, never counted as a loss.
 */
export function tgaSteps(points: XY[]): { steps: TgaStep[]; totalLoss: number; errors: string[]; notes: string[]; percent: XY[]; converted: boolean } {
  const errors: string[] = [];
  const notes: string[] = [];
  const pts = thin([...points].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]));
  const none = { steps: [], totalLoss: 0, percent: [] as XY[], converted: false };
  if (pts.length < 20) return { ...none, errors: ["Too few points for a thermogram (at least 20)."], notes };
  const w0 = median(pts.slice(0, Math.min(5, pts.length)).map((p) => p[1]));
  if (!(w0 > 0)) return { ...none, errors: ["The first weight must be positive."], notes };
  const converted = Math.abs(w0 - 100) > 2;
  const pct = pts.map(([t, w]) => [t, (w / w0) * 100] as XY);
  if (converted) notes.push(`Weights read as % of the starting weight (${+w0.toPrecision(6)}).`);
  const n = pct.length;
  const T = pct.map((p) => p[0]);
  const step = median(T.slice(1).map((t, i) => t - T[i]));
  const m = Math.max(1, Math.min(30, Math.round(1 / step)));
  const s = sgSmooth(pct.map((p) => p[1]), m);
  const dtg = T.map((_, i) => {
    const a = Math.max(0, i - m), b = Math.min(n - 1, i + m);
    return -(s[b] - s[a]) / (T[b] - T[a] || 1);
  });
  // The steady rate between steps is the DTG's most common value — its half-sample mode, which the steps' long one-sided
  // tails do not pull (a mean, or even a median, of the "quiet" points would). It is taken out only when it is clearly
  // not zero.
  const mode = halfSampleMode(dtg);
  const sdAll = robustSigma(dtg);
  const sd = robustSigma(dtg.filter((v) => Math.abs(v - mode) <= 4 * sdAll + 1e-12));
  const quietN = dtg.filter((v) => Math.abs(v - mode) <= 3 * sd + 1e-12).length;
  // A real drift shows at both ends of the scan, not just in the mode: the first and last 15 % must each show it.
  const edge = Math.max(3, Math.round(0.15 * n));
  const e1 = median(dtg.slice(0, edge)), e2 = median(dtg.slice(n - edge));
  const bothEnds = Math.sign(e1) === Math.sign(mode) && Math.sign(e2) === Math.sign(mode) && Math.min(Math.abs(e1), Math.abs(e2)) >= 0.5 * Math.abs(mode);
  const driftClear = bothEnds && Math.abs(mode) > 3 * (sd / Math.sqrt(Math.max(1, quietN / Math.max(1, 2 * m)))) && Math.abs(mode) * (T[n - 1] - T[0]) > 0.1;
  const drift = driftClear ? mode : 0;
  const dd = dtg.map((v) => v - drift);
  const top = maxOf(dd);
  // Clear of the noise, and of a hair of the largest rate — so a 0.5 % hydrate loss beside a 60 % decomposition counts.
  const thr = Math.max(6 * sd, 0.005 * top, 1e-9);
  if (driftClear) notes.push(`A steady drift of ${(drift * 100).toFixed(2)} % per 100 °C is taken out of the step losses.`);
  // DTG peaks clear of the noise, with prominence — including a step still under way where the scan starts or ends.
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!(dd[i] > thr)) continue;
    const left = i === 0 || dd[i] >= dd[i - 1], right = i === n - 1 || dd[i] > dd[i + 1];
    if (left && right) peaks.push(i);
  }
  const prom = peaks.filter((i) => {
    let l = dd[i], r = dd[i];
    for (let j = i - 1; j >= 0 && dd[j] <= dd[i]; j--) l = Math.min(l, dd[j]);
    for (let j = i + 1; j < n && dd[j] <= dd[i]; j++) r = Math.min(r, dd[j]);
    // At an end of the scan only the inner side can drop.
    const base = i === 0 ? r : i === n - 1 ? l : Math.max(l, r);
    return dd[i] - base > 3 * sd;
  });
  for (const i of prom) if (i === 0 || i === n - 1) notes.push(`The trace ${i === 0 ? "starts" : "ends"} while a weight loss is still under way (near ${T[i].toFixed(0)} °C): the loss given is the part inside the scan, not the whole step.`);
  // Group peaks into steps: split at the DTG minimum between neighbours when it dips below half the smaller peak.
  const groups: number[][] = [];
  for (const p of prom) {
    const g = groups[groups.length - 1];
    if (g) {
      const last = g[g.length - 1];
      let lo = last;
      for (let j = last; j <= p; j++) if (dd[j] < dd[lo]) lo = j;
      if (dd[lo] >= 0.5 * Math.min(dd[last], dd[p])) {
        g.push(p);
        continue;
      }
    }
    groups.push([p]);
  }
  const steps: TgaStep[] = [];
  const bounds: Array<[number, number, number]> = [];
  groups.forEach((g, gi) => {
    const pk = g.reduce((a, b) => (dd[b] > dd[a] ? b : a), g[0]);
    const cut = 0.02 * dd[pk];
    let a = g[0], b = g[g.length - 1];
    const prevEnd = gi > 0 ? bounds[gi - 1][1] : 0;
    while (a > prevEnd && dd[a - 1] > Math.max(cut, 2 * sd)) a--;
    // Toward the next step: stop at the DTG minimum between them.
    const next = groups[gi + 1]?.[0] ?? n - 1;
    let lim = next;
    if (groups[gi + 1]) for (let j = b; j <= next; j++) if (dd[j] < dd[lim]) lim = j;
    while (b < lim && dd[b + 1] > Math.max(cut, 2 * sd)) b++;
    if (groups[gi + 1] && b >= lim) b = lim;
    bounds.push([a, b, pk]);
  });
  bounds.forEach(([a, b, pk], k) => {
    // The loss is measured across the step's whole tail — widened by its own width each side, never past the split from
    // a neighbouring step or the end of the data — while its stated range is where the rate stands clear of the noise.
    const wdt = Math.max(b - a, 2 * m);
    const lo = Math.max(k > 0 ? bounds[k - 1][1] : 0, a - wdt), hi = Math.min(k + 1 < bounds.length ? bounds[k + 1][0] : n - 1, b + wdt);
    const loss = s[lo] - s[hi] - drift * (T[hi] - T[lo]);
    // Under 0.1 % is not a step a claim would cite (and is where noise on a big step's flank lives).
    if (loss >= 0.1) steps.push({ start: T[a], end: T[b], loss, dtgPeak: T[pk] });
  });
  // Gains: a DTG trough as clear as a step would be.
  let gi = -1;
  for (let i = 1; i < n - 1; i++) if (-dd[i] > Math.max(6 * sd, 1e-9) && (gi < 0 || dd[i] < dd[gi])) gi = i;
  if (gi >= 0) {
    let a = gi, b = gi;
    while (a > 0 && -dd[a - 1] > 2 * sd) a--;
    while (b < n - 1 && -dd[b + 1] > 2 * sd) b++;
    const gain = s[b] - s[a] + drift * (T[b] - T[a]);
    if (gain > 0.05) notes.push(`A weight gain of about ${gain.toFixed(1)}% between about ${T[a].toFixed(0)} °C and ${T[b].toFixed(0)} °C (oxidation, or buoyancy?) — not counted as a loss.`);
  }
  const totalLoss = s[0] - s[n - 1];
  if (!steps.length && !notes.some((x) => /gain/.test(x))) notes.push("No weight-loss step stands out from the noise.");
  return { steps, totalLoss, errors, notes, percent: pct, converted };
}

/** The sentences an Example uses: one per DSC trace or TGA trace. */
export function thermalText(kind: "dsc" | "tga", r: { events?: DscEvent[]; steps?: TgaStep[] }, subject?: string): string[] {
  const fmt = (t: number): string => t.toFixed(1);
  const subj = sentenceSubject(subject);
  const list = (parts: string[]): string => (parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);
  if (kind === "dsc") {
    const ev = r.events ?? [];
    if (!ev.length) return [];
    const parts = ev.map((e) =>
      e.kind === "step"
        ? `a step change in heat flow (a glass transition) with a midpoint at about ${fmt(e.peak)} °C`
        : e.onset !== null
          ? `an ${e.kind} with an onset at about ${fmt(e.onset)} °C and a peak at about ${fmt(e.peak)} °C`
          : `an ${e.kind} with a peak at about ${fmt(e.peak)} °C`,
    );
    return [`${subj} exhibits a differential scanning calorimetry thermogram comprising ${list(parts)}.`];
  }
  const st = r.steps ?? [];
  if (!st.length) return [];
  const parts = st.map((s) => `a weight loss of about ${s.loss.toFixed(1)}% between about ${fmt(s.start)} °C and ${fmt(s.end)} °C`);
  return [`${subj} exhibits a thermogravimetric analysis thermogram showing ${list(parts)}.`];
}
