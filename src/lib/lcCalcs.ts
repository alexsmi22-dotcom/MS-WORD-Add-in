// Pane glue for the liquid-crystal retarder calculators in the Engineering "Optics & photonics" group:
//   optics-lc-retarder  birefringent / LC wave-plate stack: spectrum, achromatic band, design tilt, measured overlay
//   optics-lc-voltage   Fréedericksz transition, director profile, retardance against voltage
// Kept OUT of taskpane.ts so the exact objects the pane registers can be tested (as filmCalcs.ts is).
//
// No physics is computed here: lcRetarder.ts owns it, and every polarisation result goes through jones.ts (the
// engine of the "optics-jones" calculator). This file reads the fields, words the result (display contract:
// U+2212 minus, ×10⁻ⁿ, sub/superscripts, no carets, no e-notation, no em dash in an ok result) and draws.

import type { EngUnitContract } from "./engCalc";
import type { AnalyzeBlock, AnalyzeOutput } from "./analyzeBlocks";
import { engReport } from "./engReport";
import { qNum } from "./assayQuant";
import { readDataBlock } from "./dataBlock";
import {
  BUILTIN_MATERIALS,
  cauchyN,
  dnEff,
  nEff,
  cellRetardance,
  transmission,
  spectrum,
  findBands,
  designTilt,
  targetOf,
  orderOf,
  targetT,
  thresholdVoltage,
  profileAt,
  profileSamples,
  thetaAtZ,
  thetaAtZExact,
  solveMid,
  midApprox,
  midForGamma,
  voltageOfMid,
  tiltForDn,
  THETA_M_MAX,
  type Band,
  type Cell,
  type Material,
  type Target,
  type LcElastic,
  type Optics,
} from "./lcRetarder";
import {
  lcTransmissionSvg,
  lcNetRetardanceSvg,
  lcMeasuredSvg,
  lcProfilesSvg,
  lcGammaVoltageSvg,
  lcMidTiltSvg,
  type Level,
  type LcStyle,
} from "./lcCharts";
import { lcCellSvg, lcDirectorSvg, lcDeviceSvg, DEVICE_MAX_CELLS } from "./lcDrawings";

/** The pane's AnalyzeField, structurally (taskpane.ts does not export it). */
export interface LcField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  rows?: number;
  options?: { value: string; label: string }[];
}
/** The pane's EngCalc, structurally; the group is the literal the pane's EngGroup union holds. */
export interface LcCalc {
  id: string;
  name: string;
  group: "Optics & photonics";
  hint: string;
  fields: LcField[];
  /** The unit contract this tool keeps (engCalc.ts EngUnitContract). */
  unitContract: EngUnitContract;
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

// ------------------------------------------------------------- formatting

const PI = Math.PI;
const snap0 = (x: number, tol = 1e-12): number => (Math.abs(x) < tol ? 0 : x);
const num = (x: number, sig = 4): string => qNum(snap0(x), sig);
const piText = (rad: number, sig = 4): string => {
  const v = snap0(rad / PI, 1e-12);
  if (v === 0) return "0";
  const s = qNum(v, sig);
  return s === "1" ? "π" : s === "−1" ? "−π" : `${s}π`;
};
const degText = (x: number, sig = 5): string => `${num(x, sig)}°`;
/** A multiple of π for a label: "π" for 1 (never "1π"), else 0.53π. */
const piMul = (k: number): string => (Math.abs(k - 1) < 5e-5 ? "π" : `${qNum(k, 4)}π`);
/** The wave-plate condition of any order: π/2 + mπ (quarter wave) or (2m + 1)π (half wave). */
const orderForm = (t: Target): string => (t === "qwp" ? "π/2 + mπ" : "(2m + 1)π");
/** A level retardance x as the set with the same T crossed: π/2 + mπ, (2m + 1)π, 2mπ, or ±x + 2mπ. */
function anyOrder(g: number): string {
  const k = g / PI;
  const fr = k - 2 * Math.floor(k / 2); // [0, 2)
  const x = fr > 1 ? 2 - fr : fr; // folded to [0, 1]
  if (Math.abs(x - 0.5) < 5e-5) return "π/2 + mπ";
  if (Math.abs(x - 1) < 5e-5) return "(2m + 1)π";
  if (x < 5e-5) return "2mπ";
  return `±${piMul(x)} + 2mπ`;
}
/** ||net| − target| in units of π; rounding noise (below 10⁻¹² of the retardance) prints as 0. */
/** A tilt in degrees: `sig` figures, with more decimals near 90° so a tilt below 90° never prints as 90°. */
function tiltText(deg: number, sig = 5): string {
  let t = degText(deg, sig);
  for (let k = sig + 1; deg < 90 && /^90(\.0*)?°$/.test(t) && k <= 16; k++) t = degText(deg, k);
  return t;
}
function offBy(net: number, tgt: number): string {
  const d = Math.abs(Math.abs(net) - tgt);
  return d <= 1e-12 * Math.max(1, Math.abs(net)) ? "0" : `${qNum(d / PI, 4)}π`;
}
const nm = (x: number): string => `${qNum(x, 5)} nm`;
const pctText = (T: number, sig = 4): string => `${qNum(snap0(T * 100, 1e-9), sig)} %`;
const quote = (t: string): string => `"${t.replace(/"/g, "'").slice(0, 60)}"`;
const refuse = (text: string): AnalyzeOutput => ({ text, ok: false });

function svgSize(svg: string): { w: number; h: number } {
  const m = /^<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 460, h: 320 };
}
function plotBlock(svg: string, caption: string, alt: string): AnalyzeBlock {
  const s = svgSize(svg);
  return { kind: "plot", svg, caption, alt, w: s.w, h: s.h };
}

// ------------------------------------------------------------- readers

const NUM_RE = /^[+\-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-−]?\d+)?$/;
/** A plain number token (dot decimal; U+2212 accepted); a comma is refused by name. */
function numToken(t: string): number | string {
  if (/\d,\d/.test(t)) return `${quote(t)} uses a comma; write the decimal mark as a dot (1.7, not 1,7).`;
  if (!NUM_RE.test(t)) return `${quote(t)} is not a number.`;
  return Number(t.replace(/−/g, "-"));
}

/** One number from a text field, units in `strip` removed. */
function readField(text: string, what: string, strip: RegExp, test: (x: number) => boolean, rule: string): number | string {
  const t = (text ?? "").trim().replace(strip, "").trim();
  if (!t) return `${what} is empty.`;
  const v = numToken(t);
  if (typeof v === "string") return `${what}: ${v}`;
  if (!Number.isFinite(v)) return `${what} is not a finite number.`;
  if (!test(v)) return `${what} ${rule}.`;
  return v;
}

const MAT_NAME = /^[A-Za-z][A-Za-z0-9_\-+.]*$/;
const MAX_MATERIALS = 12;

/**
 * Materials, one per line: NAME ne A [B [C]] no A [B [C]] — Cauchy n = A + B/λ² + C/λ⁴ with λ in µm (B in µm²,
 * C in µm⁴); a missing B or C is 0 (a constant index). "#" starts a comment.
 */
export function readMaterials(text: string): { ok: true; mats: Map<string, Material> } | { ok: false; reason: string } {
  const mats = new Map<string, Material>();
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, "").trim();
    if (!line) continue;
    const where = `Materials line ${i + 1}`;
    const tok = line.split(/\s+/);
    const name = tok[0];
    if (!MAT_NAME.test(name) || /^n[eo]$/i.test(name))
      return { ok: false, reason: `${where}: ${quote(name)} is not a material name (start with a letter; letters, digits, - _ + . allowed), e.g. "LC-A ne 1.70 0.008 0.002 no 1.50 0.006 0.0003".` };
    const coef: Record<"ne" | "no", number[] | undefined> = { ne: undefined, no: undefined };
    let cur: "ne" | "no" | null = null;
    for (let k = 1; k < tok.length; k++) {
      const key = tok[k].replace(/[:=]$/, "").replace(/ₑ/g, "e").replace(/ₒ/g, "o").toLowerCase().replace(/^n_?/, "n");
      if (key === "ne" || key === "no") {
        if (coef[key]) return { ok: false, reason: `${where}: ${key === "ne" ? "nₑ" : "nₒ"} is given twice.` };
        cur = key;
        coef[key] = [];
        continue;
      }
      if (!cur) return { ok: false, reason: `${where}: after the name write "ne" and its Cauchy coefficients, then "no" and its coefficients.` };
      const v = numToken(tok[k]);
      if (typeof v === "string") return { ok: false, reason: `${where}: ${v}` };
      const arr = coef[cur]!;
      if (arr.length >= 3) return { ok: false, reason: `${where}: at most three Cauchy coefficients (A, B, C) per index.` };
      arr.push(v);
    }
    if (!coef.ne || !coef.no || !coef.ne.length || !coef.no.length)
      return { ok: false, reason: `${where}: both indices are needed, e.g. "${name} ne 1.70 no 1.50" (constant) or "${name} ne 1.70 0.008 0.002 no 1.50 0.006 0.0003" (Cauchy).` };
    const mk = (a: number[]): { A: number; B: number; C: number } => ({ A: a[0], B: a[1] ?? 0, C: a[2] ?? 0 });
    const ne = mk(coef.ne);
    const no = mk(coef.no);
    for (const [lab, c] of [["nₑ", ne], ["nₒ", no]] as const) {
      if (!(c.A > 1 && c.A < 4)) return { ok: false, reason: `${where}: the Cauchy A of ${lab} must be between 1 and 4 (it is the long-wavelength index).` };
      if (!(Math.abs(c.B) < 1) || !(Math.abs(c.C) < 1))
        return { ok: false, reason: `${where}: a Cauchy B or C of ${lab} is outside ±1 (B is in µm², C in µm⁴; typical values are 10⁻³ to 10⁻²).` };
    }
    if (mats.has(name.toLowerCase())) return { ok: false, reason: `${where}: the material ${quote(name)} is defined twice.` };
    if (mats.size >= MAX_MATERIALS) return { ok: false, reason: `More than ${MAX_MATERIALS} materials.` };
    mats.set(name.toLowerCase(), { name, ne, no });
  }
  return { ok: true, mats };
}

function lookupMaterial(mats: Map<string, Material>, name: string): Material | null {
  const m = mats.get(name.toLowerCase());
  if (m) return m;
  return BUILTIN_MATERIALS.find((b) => b.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export const MAX_CELLS = 6;
const UNIT_TOKEN = /^(µm|μm|um|°|deg|degrees?)$/i;

/** Cells, one per line in the order the light meets them: thickness (µm), tilt (°), optic axis (°), material. */
export function readCells(text: string, mats: Map<string, Material>): { ok: true; cells: Cell[] } | { ok: false; reason: string } {
  const cells: Cell[] = [];
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, "").trim();
    if (!line) continue;
    const where = `Cells line ${i + 1}`;
    const tok = line
      .split(/\s+/)
      .filter((t) => !UNIT_TOKEN.test(t))
      .map((t) => t.replace(/(µm|μm|um|°|deg)$/i, ""));
    if (tok.length !== 4)
      return { ok: false, reason: `${where} ${quote(line)}: write thickness (µm), tilt (°), optic-axis angle (°) and the material name, e.g. "20 5 45 LC-A".` };
    const vals: number[] = [];
    for (const t of tok.slice(0, 3)) {
      const v = numToken(t);
      if (typeof v === "string") return { ok: false, reason: `${where}: ${v}` };
      vals.push(v);
    }
    const [d, tilt, oa] = vals;
    if (!(d > 0 && d <= 1000)) return { ok: false, reason: `${where}: the thickness must be above 0 and at most 1000 µm.` };
    if (!(tilt >= 0 && tilt <= 90)) return { ok: false, reason: `${where}: the tilt is measured from the substrate plane and must be 0° to 90°.` };
    if (!(Math.abs(oa) <= 360)) return { ok: false, reason: `${where}: the optic-axis angle must be within ±360°.` };
    const mat = lookupMaterial(mats, tok[3]);
    if (!mat)
      return { ok: false, reason: `${where}: no material named ${quote(tok[3])}. Define it in the materials box (or use the built-in E7).` };
    cells.push({ d, tilt, oa, material: mat });
    if (cells.length > MAX_CELLS) return { ok: false, reason: `More than ${MAX_CELLS} cells: the stack is limited to ${MAX_CELLS}.` };
  }
  if (!cells.length) return { ok: false, reason: "No cells: give at least one line, e.g. \"20 5 45 LC-A\"." };
  return { ok: true, cells };
}

/**
 * Retardation levels, separated by commas or semicolons: 0.47π, 0.53π, π/2, 3π/2, "π/2 ± 0.03π" (two levels).
 * "pi" is accepted for π. A bare number with no π is refused (it could be radians or a multiple of π).
 */
export function readLevels(text: string): { ok: true; levels: Level[] } | { ok: false; reason: string } {
  const out: Level[] = [];
  const items = (text ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const one = (raw: string): { v: number; label: string } | string => {
    const t = raw.replace(/\s+/g, "").replace(/pi/gi, "π").replace(/−/g, "-");
    const m = /^(\d+(?:\.\d+)?|\.\d+)?(π)?(?:\/(\d+(?:\.\d+)?))?$/.exec(t);
    if (!m || (!m[1] && !m[2])) return `${quote(raw)} is not a retardation level; write it as a multiple of π, e.g. 0.53π, π/2 or 3π/2.`;
    if (!m[2]) return `${quote(raw)} has no π; write retardation levels as multiples of π (0.5π, not 0.5).`;
    const a = m[1] ? Number(m[1]) : 1;
    const den = m[3] ? Number(m[3]) : 1;
    if (!(den > 0)) return `${quote(raw)}: the denominator must be positive.`;
    const v = (a / den) * PI;
    const label = m[3] ? `${m[1] && a !== 1 ? qNum(a, 4) : ""}π/${qNum(den, 4)}` : piMul(a);
    return { v, label };
  };
  for (const it of items) {
    const pm = it.split(/±|\+\/-|\+-/);
    if (pm.length > 2) return { ok: false, reason: `${quote(it)}: one ± per level.` };
    const c = one(pm[0]);
    if (typeof c === "string") return { ok: false, reason: c };
    if (pm.length === 2) {
      const w = one(pm[1]);
      if (typeof w === "string") return { ok: false, reason: w };
      const lo = c.v - w.v;
      const hi = c.v + w.v;
      if (lo < 0) return { ok: false, reason: `${quote(it)} goes below zero.` };
      out.push({ gamma: hi, label: `retardation ${piMul(hi / PI)}` }, { gamma: lo, label: `retardation ${piMul(lo / PI)}` });
    } else out.push({ gamma: c.v, label: `retardation ${c.label}` });
    if (out.length > 8) return { ok: false, reason: "At most 8 retardation levels." };
  }
  for (const L of out) if (!(L.gamma <= 100 * PI)) return { ok: false, reason: "Retardation levels are limited to 100π." };
  return { ok: true, levels: out };
}

/** A retardance whose crossed-polariser transmission is T (rad, in [0, π]). */
const gammaOfT = (T: number): number => 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, T))));

// ------------------------------------------------------------- measured spectra

export interface Measured {
  lam: number[];
  Tc: number[];
  Tp: number[] | null;
  notes: string[];
}

/**
 * Measured spectra: columns λ (nm), T crossed, T parallel (by header name, else that order), read by readDataBlock
 * (RULE N). `units` is the user's explicit choice ("%" or "fraction"); `normalise` replaces T_c, T_p by
 * T⊥/(T⊥ + T∥) and T∥/(T⊥ + T∥), which removes the common loss of the polarisers and cells.
 */
export function readMeasured(text: string, units: string, normalise: boolean): { ok: true; m: Measured } | { ok: false; reason: string } {
  const blk = readDataBlock(text, "Measured spectra", { maxRows: 20000 });
  if (!blk.ok) return { ok: false, reason: blk.error };
  const notes = [...blk.notes];
  let iL = 0;
  let iC = 1;
  let iP = 2;
  if (blk.header) {
    const h = blk.header.map((s) => s.toLowerCase());
    const find = (re: RegExp): number => h.findIndex((s) => re.test(s));
    const l = find(/λ|lambda|wave|nm/);
    const c = find(/cross|⊥|perp|^t_?c\b/);
    const p = find(/paral|∥|^t_?p\b/);
    if (l >= 0 && c >= 0) {
      iL = l;
      iC = c;
      iP = p;
    } else notes.push("The header names did not identify the columns, so they were read in the default order: λ, T crossed, T parallel.");
  }
  const width = Math.max(...blk.rows.map((r) => r.length));
  if (width < 2) return { ok: false, reason: "Measured spectra: give at least two columns, λ (nm) and T crossed (and T parallel)." };
  if (iP >= width) iP = -1;
  if (normalise && iP < 0) return { ok: false, reason: "Normalising needs both T crossed and T parallel columns." };
  const scale = units === "fraction" ? 1 : 0.01;
  type Row = { l: number; c: number; p: number | null };
  const rows: Row[] = [];
  let skipped = 0;
  for (const r of blk.rows) {
    const l = r[iL];
    const c = r[iC];
    const p = iP >= 0 ? (r[iP] ?? null) : null;
    if (l === null || l === undefined || c === null || c === undefined || (normalise && p === null)) {
      skipped++;
      continue;
    }
    rows.push({ l, c: c * scale, p: p === null ? null : p * scale });
  }
  if (skipped) notes.push(`${skipped} row${skipped === 1 ? "" : "s"} with a missing value ${skipped === 1 ? "was" : "were"} skipped.`);
  if (rows.length < 3) return { ok: false, reason: "Measured spectra: fewer than three complete rows." };
  const lmin = Math.min(...rows.map((r) => r.l));
  const lmax = Math.max(...rows.map((r) => r.l));
  if (lmin < 100 || lmax > 20000)
    return { ok: false, reason: `Measured spectra: wavelengths run ${qNum(lmin, 4)} to ${qNum(lmax, 4)}; the first column must be λ in nm (100 to 20000).` };
  const tmax = Math.max(...rows.map((r) => Math.max(r.c, r.p ?? 0)));
  const tmin = Math.min(...rows.map((r) => Math.min(r.c, r.p ?? 0)));
  if (tmax > 1.5)
    return {
      ok: false,
      reason: units === "fraction" ? `Measured spectra: transmissions reach ${qNum(tmax, 4)}, above 1.5; choose "%" for the data units.` : `Measured spectra: transmissions reach ${qNum(tmax * 100, 4)} %, above 150 %; check the columns and units.`,
    };
  if (tmin < -0.5) return { ok: false, reason: "Measured spectra: transmissions below −50 %; check the columns and units." };
  if (units !== "fraction" && !normalise && tmax <= 0.015)
    return { ok: false, reason: `Measured spectra: the data units are set to percent but no transmission exceeds 1.5 %; if the data run 0 to 1, choose "0 to 1" for the data units.` };
  let sorted = true;
  for (let i = 1; i < rows.length; i++) if (rows[i].l < rows[i - 1].l) sorted = false;
  if (!sorted) {
    rows.sort((a, b) => a.l - b.l);
    notes.push("The rows were sorted by wavelength.");
  }
  let lam = rows.map((r) => r.l);
  let Tc = rows.map((r) => r.c);
  let Tp: number[] | null = iP >= 0 && rows.every((r) => r.p !== null) ? rows.map((r) => r.p as number) : null;
  if (normalise && Tp) {
    const keep: number[] = [];
    rows.forEach((r, i) => {
      if ((r.c + (r.p as number)) > 0) keep.push(i);
    });
    if (keep.length < rows.length) notes.push(`${rows.length - keep.length} rows with T⊥ + T∥ ≤ 0 could not be normalised and were skipped.`);
    if (keep.length < 3) return { ok: false, reason: "Measured spectra: fewer than three rows can be normalised." };
    const tp = Tp;
    lam = keep.map((i) => lam[i]);
    const c2 = keep.map((i) => Tc[i] / (Tc[i] + tp[i]));
    const p2 = keep.map((i) => tp[i] / (Tc[i] + tp[i]));
    Tc = c2;
    Tp = p2;
  }
  return { ok: true, m: { lam, Tc, Tp, notes } };
}

// ------------------------------------------------------------- band wording

function bandLines(bands: Band[], total: number, worstUnit: (w: number) => string, label: string): string[] {
  if (!bands.length) return [`  ${label}: none in the computed range.`];
  const out: string[] = [];
  let longest = bands[0];
  for (const b of bands) if (b.to - b.from > longest.to - longest.from) longest = b;
  const show = bands.slice(0, 6);
  show.forEach((b) => {
    const lo = b.openLow ? `at or below ${nm(b.from)}` : nm(b.from);
    const hi = b.openHigh ? `at or above ${nm(b.to)}` : nm(b.to);
    out.push(`  ${label}: ${lo} to ${hi} (width ${qNum(b.to - b.from, 4)} nm; largest sampled deviation ${worstUnit(b.worst)})`);
  });
  if (total > show.length) out.push(`  … and ${total - show.length} more band${total - show.length === 1 ? "" : "s"}.`);
  if (total > 1) out.push(`  Longest band: ${nm(longest.from)} to ${nm(longest.to)} (${qNum(longest.to - longest.from, 4)} nm).`);
  if (show.some((b) => b.openLow || b.openHigh)) out.push("  A band marked \"at or below / at or above\" runs into the end of the computed range; its true edge may lie beyond it.");
  return out;
}

// ------------------------------------------------------------- calculator A

const STYLE_FIELD: LcField = {
  key: "style",
  label: "Figure style",
  default: "colour",
  kind: "select",
  options: [
    { value: "colour", label: "Colour" },
    { value: "bw", label: "Black and white (patent drawings)" },
  ],
};
const ANGLE_STRIP = /\s*(°|deg|degrees?)\s*$/i;
const NM_STRIP = /\s*nm\s*$/i;

/**
 * Published examples: the two-cell devices of R. Abuleil and I. Abdulhalim, "Tunable achromatic liquid crystal
 * waveplates", Opt. Lett. 39, 5487–5490 (2014), doi:10.1364/OL.39.005487 — BL036 cell 27.23 µm at +45°, E7 cell
 * 49.51 µm at −45°, between a polariser at 0° and a crossed analyser, with the tilts the paper gives. The indices are
 * the built-in Wahle & Kitzerow (2014) tables (the paper used the Li & Wu coefficients it cites, which may differ, and
 * the retardance difference of two thick cells is very sensitive to them). The bands the paper reports are quoted
 * beside the computed ones, not fitted.
 */
const PAPER = "R. Abuleil and I. Abdulhalim, Opt. Lett. 39, 5487 (2014), doi:10.1364/OL.39.005487";
const PRESETS: Record<string, { fields: Record<string, string>; intro: string[]; reported: [number, number] | null }> = {
  "ol-aqwp": {
    fields: { mode: "analyse", materials: "", cells: "27.23 2 45 BL036\n49.51 29.91 -45 E7", pol: "0", analyser: "crossed", lamFrom: "400", lamTo: "1100", lam0: "700", target: "qwp", rule: "retardance", tolPi: "0.03", levels: "auto" },
    intro: [
      `Published example: achromatic quarter-wave plate of ${PAPER}, which defines a quarter-wave plate as |Γ₁ − Γ₂| = π/2 + mπ for any integer m.`,
      "  Indices: the built-in Wahle & Kitzerow (2014) tables, not the coefficients the paper used; nothing is adjusted to match.",
    ],
    reported: [570, 860],
  },
  "ol-tuned": {
    fields: { mode: "analyse", materials: "", cells: "27.23 35 45 BL036\n49.51 46.26 -45 E7", pol: "0", analyser: "crossed", lamFrom: "400", lamTo: "1100", lam0: "540", target: "qwp", rule: "retardance", tolPi: "0.06", levels: "auto" },
    intro: [
      `Published example: voltage-tuned achromatic quarter-wave plate of ${PAPER} (|Γ₁ − Γ₂| = π/2 + mπ for any integer m).`,
      "  Indices: the built-in Wahle & Kitzerow (2014) tables, not the coefficients the paper used; nothing is adjusted to match.",
    ],
    reported: [435, 645],
  },
  "ol-ahwp": {
    fields: { mode: "analyse", materials: "", cells: "27.23 2 45 BL036\n49.51 30.85 -45 E7", pol: "0", analyser: "crossed", lamFrom: "400", lamTo: "1750", lam0: "700", target: "hwp", rule: "retardance", tolPi: "0.2", levels: "auto" },
    intro: [
      `Published example: achromatic half-wave plate of ${PAPER} (|Γ₁ − Γ₂| = (2m + 1)π; band shown within ± 0.2π, the 0.8π level of the paper's figure).`,
      "  Indices: the built-in Wahle & Kitzerow (2014) tables, not the coefficients the paper used; the paper quotes no band edges for this device.",
    ],
    reported: null,
  },
};

const retarderCalc: LcCalc = {
  id: "optics-lc-retarder",
  name: "Liquid-crystal retarder / achromatic wave plate",
  group: "Optics & photonics",
  unitContract: "domain",
  hint:
    "A stack of 1–6 birefringent (liquid-crystal) cells between a polariser and an analyser, at normal incidence. " +
    "Each cell: thickness (µm), tilt θ of the director FROM THE SUBSTRATE PLANE (θ = 0 gives the full Δn, 90° gives none), " +
    "optic-axis angle from x, and a material. n(θ) = nₑ nₒ/√(nₑ² sin²θ + nₒ² cos²θ) (index ellipsoid; the same as " +
    "Abuleil & Abdulhalim, Opt. Lett. 39, 5487 (2014), with n∥ = nₑ, n⊥ = nₒ) and Γ = 2π Δn(θ) d/λ. Indices by the " +
    "Cauchy model n = A + B/λ² + C/λ⁴ (λ in µm; Li & Wu, J. Appl. Phys. 95, 896 (2004)); E7 is built in (published fit, cited in " +
    "the result). Transmissions by Jones calculus (the same engine as the Jones-calculus tool). Design mode finds the tilt of one " +
    "cell that makes a quarter- or half-wave plate at λ₀. Optional measured spectra (λ nm, T crossed, T parallel) are overlaid.",
  fields: [
    {
      key: "mode",
      label: "Mode",
      default: "analyse",
      kind: "select",
      options: [
        { value: "analyse", label: "Analyse the stack as given" },
        { value: "design", label: "Design: find one cell's tilt for a wave plate at λ₀" },
      ],
    },
    {
      key: "preset",
      label: "Published example (replaces the stack and the band settings)",
      default: "none",
      kind: "select",
      options: [
        { value: "none", label: "None: use the boxes below" },
        { value: "ol-aqwp", label: "Opt. Lett. 39, 5487 (2014): achromatic QWP, tilts 2° and 29.91°" },
        { value: "ol-tuned", label: "Opt. Lett. 39, 5487 (2014): tuned achromatic QWP, tilts 35° and 46.26°" },
        { value: "ol-ahwp", label: "Opt. Lett. 39, 5487 (2014): achromatic HWP, tilts 2° and 30.85°" },
      ],
    },
    {
      key: "materials",
      label: "Materials: name ne A B C no A B C (Cauchy, λ in µm; B, C may be omitted)",
      default: "LC-A ne 1.580 0.0060 0.0010 no 1.480 0.0050 0.0002\nLC-B ne 1.700 0.0120 0.0030 no 1.500 0.0065 0.0004",
      kind: "block",
      rows: 3,
    },
    {
      key: "cells",
      label: "Cells in order: thickness µm, tilt °, optic axis °, material",
      default: "10 0 45 LC-A\n5 24.26 -45 LC-B",
      kind: "block",
      rows: 4,
    },
    { key: "pol", label: "Input polariser angle from x, °", default: "0", kind: "text" },
    {
      key: "analyser",
      label: "Analyser",
      default: "crossed",
      kind: "select",
      options: [
        { value: "crossed", label: "Crossed (polariser + 90°)" },
        { value: "parallel", label: "Parallel" },
        { value: "angle", label: "At an angle (below)" },
      ],
    },
    { key: "anaAngle", label: "Analyser angle from x, ° (when \"at an angle\")", default: "45", kind: "text" },
    { key: "lamFrom", label: "Wavelength from, nm", default: "400", kind: "text" },
    { key: "lamTo", label: "Wavelength to, nm", default: "900", kind: "text" },
    { key: "points", label: "Points (at most 2000)", default: "501", kind: "text" },
    { key: "lam0", label: "Design / table wavelength λ₀, nm", default: "600", kind: "text" },
    {
      key: "target",
      label: "Target",
      default: "qwp",
      kind: "select",
      options: [
        { value: "qwp", label: "Quarter-wave (π/2 + mπ)" },
        { value: "hwp", label: "Half-wave ((2m + 1)π)" },
      ],
    },
    { key: "designCell", label: "Design: number of the cell whose tilt is solved", default: "2", kind: "text" },
    {
      key: "rule",
      label: "Achromatic band rule",
      default: "retardance",
      kind: "select",
      options: [
        { value: "retardance", label: "Net retardance within ± tolerance × π" },
        { value: "transmission", label: "Crossed transmission within ± tolerance %" },
      ],
    },
    { key: "tolPi", label: "Retardance tolerance, in units of π", default: "0.03", kind: "text" },
    { key: "tolT", label: "Transmission tolerance, percentage points", default: "5", kind: "text" },
    { key: "levels", label: "Retardation-level lines (e.g. 0.47π, 0.53π; \"auto\" = band limits; empty = none)", default: "auto", kind: "text" },
    {
      key: "tunits",
      label: "Transmission axis",
      default: "percent",
      kind: "select",
      options: [
        { value: "percent", label: "Percent" },
        { value: "fraction", label: "0 to 1" },
      ],
    },
    { key: "measured", label: "Measured spectra (optional): λ nm, T crossed, T parallel", default: "", kind: "block", rows: 4 },
    {
      key: "munits",
      label: "Measured data units",
      default: "%",
      kind: "select",
      options: [
        { value: "%", label: "Percent" },
        { value: "fraction", label: "0 to 1" },
      ],
    },
    {
      key: "mnorm",
      label: "Measured data",
      default: "normalised",
      kind: "select",
      options: [
        { value: "normalised", label: "Normalised: T⊥/(T⊥ + T∥), T∥/(T⊥ + T∥)" },
        { value: "asis", label: "As measured" },
      ],
    },
    {
      key: "overlay",
      label: "Model curves on the measured figure",
      default: "on",
      kind: "select",
      options: [
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ],
    },
    STYLE_FIELD,
  ],
  compute: (r0) => {
    const preset = PRESETS[r0("preset")] ?? null;
    const r = (k: string): string => (preset && preset.fields[k] !== undefined ? preset.fields[k] : r0(k));
    const style: LcStyle = r("style") === "bw" ? "bw" : "colour";
    const mr = readMaterials(r("materials"));
    if (!mr.ok) return refuse(mr.reason);
    const cr = readCells(r("cells"), mr.mats);
    if (!cr.ok) return refuse(cr.reason);
    let cells = cr.cells;
    const pol = readField(r("pol"), "The polariser angle", ANGLE_STRIP, (x) => Math.abs(x) <= 360, "must be within ±360°");
    if (typeof pol === "string") return refuse(pol);
    const anaMode = r("analyser");
    let ana = pol + 90;
    let anaLabel = "crossed";
    if (anaMode === "parallel") {
      ana = pol;
      anaLabel = "parallel";
    } else if (anaMode === "angle") {
      const a = readField(r("anaAngle"), "The analyser angle", ANGLE_STRIP, (x) => Math.abs(x) <= 360, "must be within ±360°");
      if (typeof a === "string") return refuse(a);
      ana = a;
      anaLabel = `at ${degText(a)}`;
    }
    const l0 = readField(r("lamFrom"), "The start wavelength", NM_STRIP, (x) => x >= 200 && x <= 20000, "must be 200 to 20000 nm");
    if (typeof l0 === "string") return refuse(l0);
    const l1 = readField(r("lamTo"), "The end wavelength", NM_STRIP, (x) => x >= 200 && x <= 20000, "must be 200 to 20000 nm");
    if (typeof l1 === "string") return refuse(l1);
    if (!(l1 > l0)) return refuse(`The wavelength range is reversed or empty (${qNum(l0, 5)} to ${qNum(l1, 5)} nm): the end must be above the start.`);
    const npts = readField(r("points"), "The number of points", /\s*$/, (x) => Number.isInteger(x) && x >= 2 && x <= 2000, "must be a whole number from 2 to 2000");
    if (typeof npts === "string") return refuse(npts);
    const lam0 = readField(r("lam0"), "λ₀", NM_STRIP, (x) => x >= 200 && x <= 20000, "must be 200 to 20000 nm");
    if (typeof lam0 === "string") return refuse(lam0);
    const target: Target = r("target") === "hwp" ? "hwp" : "qwp";
    const rule = r("rule") === "transmission" ? "transmission" : "retardance";
    const tolPi = readField(r("tolPi"), "The retardance tolerance", /\s*(π|pi)\s*$/i, (x) => x > 0 && x <= 0.5, "must be above 0 and at most 0.5 (in units of π)");
    if (typeof tolPi === "string") return refuse(tolPi);
    const tolT = readField(r("tolT"), "The transmission tolerance", /\s*%\s*$/, (x) => x > 0 && x <= 50, "must be above 0 and at most 50 percentage points");
    if (typeof tolT === "string") return refuse(tolT);
    const percent = r("tunits") !== "fraction";

    // Indices must stay physical over everything computed (Cauchy terms blow up at short λ).
    const lo = Math.min(l0, lam0);
    const hi = Math.max(l1, lam0);
    for (const c of cells) {
      for (let i = 0; i <= 50; i++) {
        const l = lo + ((hi - lo) * i) / 50;
        const ne = cauchyN(c.material.ne, l);
        const no = cauchyN(c.material.no, l);
        if (!(ne > 1 && ne < 4 && no > 1 && no < 4))
          return refuse(`The Cauchy indices of ${quote(c.material.name)} leave 1 to 4 at ${nm(l)} (nₑ = ${num(ne, 5)}, nₒ = ${num(no, 5)}); check the coefficients and the wavelength range.`);
      }
    }

    const lines: string[] = [];
    const notes: string[] = [];
    let designRootsText: string[] = [];
    if (r("mode") === "design") {
      const k = readField(r("designCell"), "The design cell number", /\s*$/, (x) => Number.isInteger(x) && x >= 1 && x <= cells.length, `must be a whole number from 1 to ${cells.length}`);
      if (typeof k === "string") return refuse(k);
      const res = designTilt(cells, k - 1, lam0, target);
      if (!res) return refuse("Design mode needs every optic axis parallel or perpendicular to cell 1's (for example +45° and −45°), so that the net retardance is Γ₁ − Γ₂ … with signs.");
      if (!res.roots.length) {
        const at = (th: number): number => {
          const cc = cells.map((c, i) => (i === k - 1 ? { ...c, tilt: th } : c));
          return cc.reduce((s, c, i) => s + (i === 0 || ((c.oa - cells[0].oa) % 180 + 180) % 180 < 1e-9 ? 1 : -1) * cellRetardance(c, lam0), 0);
        };
        return refuse(
          `No tilt of cell ${k} from 0° to 90° makes a ${target === "qwp" ? "quarter" : "half"}-wave plate at ${nm(lam0)}: the net retardance only spans ${piText(Math.min(at(0), at(90)))} to ${piText(Math.max(at(0), at(90)))}. Change a thickness, a material or the other tilts.`,
        );
      }
      // The lowest-order root drives the spectrum and the figures.
      let best = res.roots[0];
      for (const q of res.roots) if (Math.abs(q.net) < Math.abs(best.net)) best = q;
      designRootsText = [`Design: tilt of cell ${k} for a ${target === "qwp" ? "quarter" : "half"}-wave plate at ${nm(lam0)} (θ from 0° to 90°)`];
      // All roots by tilt, at most 24; the root used is always listed (it replaces the last when it falls beyond).
      const CAP = 24;
      let shown = res.roots.slice(0, CAP);
      if (!shown.includes(best)) shown = [...shown.slice(0, CAP - 1), best].sort((p, q) => p.tilt - q.tilt);
      shown.forEach((q) =>
        designRootsText.push(`  θ = ${degText(q.tilt, 7)}: net retardance ${piText(q.net, 6)} (order m = ${q.order})${q === best ? "  ← used (lowest order)" : ""}`),
      );
      const total = res.roots.length + (res.more ? 1 : 0);
      if (total > shown.length)
        designRootsText.push(`  … ${res.more ? "more than " : ""}${res.roots.length} roots in all (thick cells reach many orders); ${shown.length} are listed, sorted by tilt.`);
      designRootsText.push("");
      cells = cells.map((c, i) => (i === k - 1 ? { ...c, tilt: best.tilt } : c));
    }

    const sp = spectrum({ cells, polDeg: pol, anaDeg: ana, lam0: l0, lam1: l1, points: npts });
    const net0 = sp.signs ? cells.reduce((s, c, i) => s + sp.signs![i] * cellRetardance(c, lam0), 0) : null;
    const m = net0 !== null ? orderOf(target, net0) : 0;
    const tgt = targetOf(target, m);

    // Band
    let useRule = rule;
    if (rule === "retardance" && !sp.net) {
      useRule = "transmission";
      notes.push(
        `The optic axes are not all parallel or perpendicular, so the stack is an elliptical retarder in general and a net retardance is not defined; the band uses the transmission rule (±${qNum(tolT, 4)} percentage points) instead.`,
      );
    }
    let dev: number[];
    let tol: number;
    let worstUnit: (w: number) => string;
    let bandLabel: string;
    if (useRule === "retardance" && sp.net) {
      dev = sp.net.map((g) => Math.abs(Math.abs(g) - tgt));
      tol = tolPi * PI;
      worstUnit = (w) => `${qNum(w / PI, 3)}π`;
      bandLabel = `achromatic band, |net| = ${orderForm(target)} ± ${qNum(tolPi, 4)}π, m = ${m}`;
    } else {
      const tT = targetT(target);
      dev = sp.Tc.map((T) => Math.abs(T - tT) * 100);
      tol = tolT;
      worstUnit = (w) => `${qNum(w, 3)} percentage points`;
      bandLabel = `achromatic band, T crossed = ${qNum(tT * 100, 4)} ± ${qNum(tolT, 4)} %`;
    }
    const bands = findBands(sp.lam, dev, tol);

    // Levels
    let levels: Level[] = [];
    const lvText = (r("levels") ?? "").trim();
    if (/^auto$/i.test(lvText)) {
      if (useRule === "retardance") {
        // Lines of constant T crossed = sin²(Γ/2) at the band limits serve every order m, so they are labelled by
        // the order form, not by an m = 0 value.
        const base = target === "qwp" ? PI / 2 : PI;
        const lab = `retardation ${orderForm(target)} ± ${qNum(tolPi, 4)}π`;
        levels =
          target === "qwp"
            ? [
                { gamma: base + tolPi * PI, label: lab },
                { gamma: base - tolPi * PI, label: "", pair: true },
              ]
            : [
                { gamma: PI, label: "retardation (2m + 1)π" },
                { gamma: PI - tolPi * PI, label: lab },
              ];
      } else {
        const tT = targetT(target);
        const a = Math.min(1, tT + tolT / 100);
        const b = Math.max(0, tT - tolT / 100);
        levels =
          target === "qwp"
            ? [
                { gamma: gammaOfT(a), label: `T crossed ${qNum(tT * 100, 4)} ± ${qNum(tolT, 4)} %` },
                { gamma: gammaOfT(b), label: "", pair: true },
              ]
            : [{ gamma: gammaOfT(b), label: `T crossed ${qNum(b * 100, 4)} %` }];
      }
    } else if (lvText) {
      const lv = readLevels(lvText);
      if (!lv.ok) return refuse(lv.reason);
      levels = lv.levels.map((L) => ({ ...L, label: `retardation ${anyOrder(L.gamma)}` }));
      notes.push(
        "A retardation-level line is a line of constant T crossed = sin²(Γ/2): the line for x also marks 2mπ ± x for every integer m, so it applies to a band of any order.",
      );
    }

    // Text
    if (preset) lines.push(...preset.intro, "");
    lines.push(`Liquid-crystal retarder: ${cells.length} cell${cells.length === 1 ? "" : "s"}, polariser at ${degText(pol)}, analyser ${anaLabel}`);
    lines.push("");
    if (designRootsText.length) lines.push(...designRootsText);
    lines.push(`At λ₀ = ${nm(lam0)}:`);
    const usedMats = [...new Set(cells.map((c) => c.material))];
    for (const mt of usedMats) {
      const ne = cauchyN(mt.ne, lam0);
      const no = cauchyN(mt.no, lam0);
      lines.push(`  ${mt.name}: nₑ = ${num(ne, 6)}, nₒ = ${num(no, 6)}, Δn = ${num(ne - no, 5)}`);
    }
    cells.forEach((c, i) => {
      const ne = cauchyN(c.material.ne, lam0);
      const no = cauchyN(c.material.no, lam0);
      const g = cellRetardance(c, lam0);
      lines.push(
        `  Cell ${i + 1} (${c.material.name}, d = ${num(c.d, 6)} µm, tilt ${degText(c.tilt, 7)}, optic axis ${degText(c.oa)}): ` +
          `n(θ) = ${num(nEff(ne, no, c.tilt), 6)}, Δn(θ) = ${num(dnEff(ne, no, c.tilt), 5)}, Γ = ${num(g, 6)} rad = ${piText(g, 6)} (${num(g / (2 * PI), 5)} waves)`,
      );
    });
    if (net0 !== null) {
      lines.push(
        `  Net retardance (signed sum, + for axes parallel to cell 1, − for perpendicular): ${num(net0, 6)} rad = ${piText(net0, 6)}; nearest ${target === "qwp" ? "quarter" : "half"}-wave target |net| = ${piText(tgt)} (${orderForm(target)} with m = ${m}), off by ${offBy(net0, tgt)}`,
      );
    } else lines.push("  Net retardance: not defined (optic axes neither parallel nor perpendicular).");
    const Tc0 = transmission(pol, cells, pol + 90, lam0);
    const Tp0 = transmission(pol, cells, pol, lam0);
    lines.push(`  T crossed = ${pctText(Tc0, 5)}, T parallel = ${pctText(Tp0, 5)}${anaMode === "angle" ? `, T at the analyser angle = ${pctText(transmission(pol, cells, ana, lam0), 5)}` : ""}`);
    lines.push("");
    lines.push(
      `Achromatic ${target === "qwp" ? "quarter" : "half"}-wave band over ${nm(l0)} to ${nm(l1)} (${sp.lam.length} points), rule: ${useRule === "retardance" ? `|net| within ${orderForm(target)} ± ${qNum(tolPi, 4)}π with m = ${m} (${piText(tgt)}), the m nearest at λ₀ kept fixed across λ` : `T crossed within ${qNum(targetT(target) * 100, 4)} ± ${qNum(tolT, 4)} %`}`,
    );
    lines.push(...bandLines(bands.bands, bands.total, worstUnit, "Band"));
    if (preset) {
      const longest = bands.bands.length ? bands.bands.reduce((x, y) => (y.to - y.from > x.to - x.from ? y : x)) : null;
      const ours = longest ? `${qNum(longest.from, 4)}–${qNum(longest.to, 4)} nm` : "none in the computed range";
      lines.push(
        preset.reported
          ? `  Comparison with the paper: with these indices the device is the m = ${m} ${target === "qwp" ? "quarter" : "half"}-wave plate (|net| = ${piText(tgt)} at ${nm(lam0)}), which the paper's condition allows; computed band ${ours}, reported ${preset.reported[0]}–${preset.reported[1]} nm.`
          : `  With these indices the device is the m = ${m} half-wave plate (|net| = ${piText(tgt)} at ${nm(lam0)}); computed band ${ours}.`,
      );
    }
    if (useRule === "transmission" && target === "qwp" && sp.net)
      lines.push("  The transmission rule cannot tell orders apart: the band is the union over all m of the ranges where |net| is near π/2 + mπ.");

    // Measured
    const blocks: AnalyzeBlock[] = [];
    const measText = (r("measured") ?? "").trim();
    let meas: Measured | null = null;
    if (measText) {
      const mm = readMeasured(measText, r("munits"), r("mnorm") !== "asis");
      if (!mm.ok) return refuse(mm.reason);
      meas = mm.m;
      const normalised = r("mnorm") !== "asis";
      lines.push("");
      lines.push(`Measured spectra: ${meas.lam.length} rows, ${nm(meas.lam[0])} to ${nm(meas.lam[meas.lam.length - 1])}${normalised ? ", normalised as T⊥/(T⊥ + T∥) and T∥/(T⊥ + T∥)" : ", as measured"}`);
      for (const n of meas.notes) lines.push(`  Note: ${n}`);
      let mdev: number[];
      let mtol: number;
      let munit: (w: number) => string;
      // Γ = 2 arcsin √T holds only for parallel/perpendicular optic axes at ±45° to the polariser (T crossed =
      // sin²(Γ/2)); for any other geometry the data are overlaid on the model and no measured band is claimed.
      const at45 = !!sp.signs && cells.every((c) => Math.abs((((c.oa - pol) % 90) + 90) % 90 - 45) < 1e-9);
      if (!at45) {
        mdev = [];
        mtol = 0;
        munit = (w) => String(w);
        lines.push(
          "  No measured band is given: reading a retardance or a wave-plate band from T crossed needs every optic axis at ±45° to the polariser and the axes parallel or perpendicular to each other, and this stack is not like that. The measured and model transmissions are overlaid for comparison.",
        );
      } else if (rule === "retardance") {
        const fold = target === "qwp" ? PI / 2 : PI;
        mdev = meas.Tc.map((T) => Math.abs(gammaOfT(T) - fold));
        mtol = tolPi * PI;
        munit = (w) => `${qNum(w / PI, 3)}π`;
        lines.push(
          `  Rule: the retardance read back from T crossed as Γ = 2 arcsin √T (the axes are at ±45° to the polariser), which cannot tell orders apart: |net| within ${orderForm(target)} ± ${qNum(tolPi, 4)}π for any m`,
        );
      } else {
        const tT = targetT(target);
        mdev = meas.Tc.map((T) => Math.abs(T - tT) * 100);
        mtol = tolT;
        munit = (w) => `${qNum(w, 3)} percentage points`;
        lines.push(`  Rule: T crossed within ${qNum(tT * 100, 4)} ± ${qNum(tolT, 4)} %`);
      }
      const mb = at45 ? findBands(meas.lam, mdev, mtol) : { bands: [] as Band[], total: 0 };
      if (at45) lines.push(...bandLines(mb.bands, mb.total, munit, "Measured band"));
      if (mb.total > 1) lines.push("  Noisy data split the band into fragments; they are reported as found (no smoothing).");
      // Many slivers of shading read as a rendering fault, so a fragmented band shades its longest piece only (the
      // text lists every fragment, and the legend says which is shaded).
      const fragmented = mb.total > 3;
      let shade = mb.bands;
      if (fragmented) shade = [mb.bands.reduce((x, y) => (y.to - y.from > x.to - x.from ? y : x))];
      const overlay = r("overlay") !== "off";
      const msp = overlay ? spectrum({ cells, polDeg: pol, anaDeg: ana, lam0: meas.lam[0], lam1: meas.lam[meas.lam.length - 1], points: 600 }) : null;
      const msvg = lcMeasuredSvg({
        lam: meas.lam,
        Tc: meas.Tc,
        Tp: meas.Tp,
        model: msp ? { lam: msp.lam, Tc: msp.Tc, Tp: msp.Tp } : null,
        levels,
        bands: shade.map((b) => ({ x0: b.from, x1: b.to })),
        bandLabel: (fragmented ? "longest " : "") + (rule === "retardance" ? `measured band, ${orderForm(target)} ± ${qNum(tolPi, 4)}π (any m)` : `measured band, T crossed ± ${qNum(tolT, 4)} %`),
        normalised,
        percent,
        style,
      });
      blocks.push(plotBlock(msvg, at45 ? "Measured transmission spectra with the model overlaid; the measured achromatic band is shaded" : "Measured transmission spectra with the model overlaid (no measured band for this geometry)", "Measured crossed and parallel transmission against wavelength, with model curves and retardation-level lines"));
    }

    lines.push("");
    const builtin = usedMats.filter((x) => x.source);
    for (const b of builtin) {
      notes.push(`${b.name} indices: ${b.source}.`);
      if (b.fitRangeNm && (lo < b.fitRangeNm[0] || hi > b.fitRangeNm[1]))
        notes.push(`${b.name}: the fit covers about ${b.fitRangeNm[0]}–${b.fitRangeNm[1]} nm; outside that range the indices are an extrapolation.`);
    }
    notes.push(
      "T is relative to the light leaving the input polariser (ideal polarisers, lossless cells, no reflections); normal incidence; each cell has a uniform tilt. The optic axis is the slow axis for nₑ > nₒ.",
    );
    notes.push(
      `Jones-calculus check at λ₀: the same stack in the Jones-calculus tool is "polariser ${qNum(pol, 6)}" then ${cells
        .map((c) => `"retarder ${qNum(c.oa + 90, 6)} ${qNum((((cellRetardance(c, lam0) * 180) / PI) % 360), 8)}"`)
        .join(", ")} then "polariser ${qNum(ana, 6)}" (fast axis = optic axis + 90°, δ in degrees modulo 360°).`,
    );
    if (cells.length > DEVICE_MAX_CELLS)
      notes.push(
        `The device drawing shows the first ${DEVICE_MAX_CELLS} of the ${cells.length} cells (more would make its labels too small to read when inserted); the calculation uses all of them.`,
      );
    for (const n of notes) lines.push(`Note: ${n}`);

    // Figures
    const bandRects = bands.bands.map((b) => ({ x0: b.from, x1: b.to }));
    const tsvg = lcTransmissionSvg({
      lam: sp.lam,
      Tc: sp.Tc,
      Tp: sp.Tp,
      Ta: anaMode === "angle" ? sp.Ta : null,
      anaLabel: `Analyser at ${degText(ana)}`,
      levels,
      bands: bandRects,
      bandLabel,
      percent,
      style,
    });
    blocks.unshift(plotBlock(tsvg, "Transmission between crossed and parallel polarisers against wavelength; the achromatic band is shaded", "Crossed and parallel transmission spectra with retardation-level lines"));
    if (sp.net) {
      const sgn = net0 !== null && net0 < 0 ? -1 : 1;
      const nsvg = lcNetRetardanceSvg({
        lam: sp.lam,
        netOverPi: sp.net.map((g) => g / PI),
        netLabel: cells.length === 2 && sp.signs && sp.signs[1] === -1 ? "Γ₁ − Γ₂ (net)" : "net retardance",
        target: (sgn * tgt) / PI,
        targetLabel: `target ${piText(sgn * tgt)} (${orderForm(target)}, m = ${m})`,
        tol: useRule === "retardance" ? tolPi : null,
        bands: bandRects,
        bandLabel,
        style,
      });
      blocks.splice(1, 0, plotBlock(nsvg, "Net retardance against wavelength with the wave-plate target", "Net retardance divided by pi against wavelength"));
    }
    // Drawings from the same parameters
    blocks.push(
      plotBlock(lcCellSvg({ tiltsDeg: [cells[0].tilt], uniformTiltDeg: cells[0].tilt, style, title: `Cell 1: uniform tilt θ = ${degText(cells[0].tilt, 4)}` }), "Cross-section of cell 1 with its uniform director tilt", "Liquid-crystal cell cross-section"),
    );
    blocks.push(plotBlock(lcDirectorSvg({ tiltDeg: cells[0].tilt, style }), "Director and index geometry: tilt θ from the substrate plane, n∥ along the director, n⊥ across it", "Director index ellipse geometry"));
    blocks.push(
      plotBlock(
        lcDeviceSvg({ polDeg: pol, cellsOaDeg: cells.slice(0, DEVICE_MAX_CELLS).map((c) => c.oa), anaDeg: ana, style }),
        cells.length > DEVICE_MAX_CELLS
          ? `Device: polariser P, the first ${DEVICE_MAX_CELLS} of ${cells.length} cells with optic axes OA, analyser A, along the beam`
          : "Device: polariser P, cells with optic axes OA, analyser A, along the beam",
        "Pseudo-three-dimensional schematic of the polariser, cells and analyser",
      ),
    );
    return engReport(lines, blocks);
  },
};

// ------------------------------------------------------------- calculator B

const voltageCalc: LcCalc = {
  id: "optics-lc-voltage",
  name: "Liquid-crystal cell: Fréedericksz transition and retardance vs voltage",
  group: "Optics & photonics",
  unitContract: "domain",
  hint:
    "A planar nematic cell with strong anchoring and positive dielectric anisotropy. Vₜₕ = π√(K₁₁/(ε₀Δε)); above it the " +
    "director tilts (splay–bend, K₁₁ and K₃₃) in a non-uniform field (D uniform, V = ∫E dz), solved through the first integral " +
    "of the Euler–Lagrange equation (Deuling 1972). Retardance Γ = (2π/λ)∫(n(θ(z)) − nₒ) dz with θ from the substrate plane. " +
    "Indices: \"ne A B C no A B C\" (Cauchy, λ in µm) or \"E7\". Gives θ(z), Γ(V), the midplane tilt (and, for comparison, the uniform-profile approximation of " +
    "Abuleil & Abdulhalim 2014 for comparison), the voltage for a target retardance or tilt, and the uniform tilt with the same Γ.",
  fields: [
    { key: "K11", label: "K₁₁ (splay), pN", default: "11", kind: "text" },
    { key: "K33", label: "K₃₃ (bend), pN", default: "17", kind: "text" },
    { key: "epar", label: "ε∥ (relative)", default: "18", kind: "text" },
    { key: "eperp", label: "ε⊥ (relative)", default: "5", kind: "text" },
    { key: "d", label: "Cell gap d, µm", default: "5", kind: "text" },
    { key: "pretilt", label: "Pretilt θ₀, °", default: "2", kind: "text" },
    { key: "indices", label: "Indices: ne A B C no A B C (λ in µm), or E7", default: "ne 1.700 0.0120 0.0030 no 1.500 0.0065 0.0004", kind: "text" },
    { key: "lam", label: "Wavelength λ, nm", default: "600", kind: "text" },
    { key: "vFrom", label: "Voltage from, V rms", default: "0", kind: "text" },
    { key: "vTo", label: "Voltage to, V rms", default: "6", kind: "text" },
    { key: "points", label: "Voltage points (at most 400)", default: "121", kind: "text" },
    { key: "vProfile", label: "Voltage for the profile table and the cell drawing, V rms", default: "2", kind: "text" },
    {
      key: "targetKind",
      label: "Find the voltage for",
      default: "none",
      kind: "select",
      options: [
        { value: "none", label: "Nothing" },
        { value: "gamma", label: "A target retardance (below)" },
        { value: "tilt", label: "A target midplane tilt (below)" },
      ],
    },
    { key: "targetGamma", label: "Target retardance (multiple of π, e.g. 0.5π)", default: "0.5π", kind: "text" },
    { key: "targetTilt", label: "Target midplane tilt, °", default: "45", kind: "text" },
    STYLE_FIELD,
  ],
  compute: (r) => {
    const style: LcStyle = r("style") === "bw" ? "bw" : "colour";
    const pos = (x: number): boolean => x > 0;
    const K11 = readField(r("K11"), "K₁₁", /\s*pN\s*$/i, pos, "must be above 0 (no splay elasticity means no restoring torque)");
    if (typeof K11 === "string") return refuse(K11);
    const K33 = readField(r("K33"), "K₃₃", /\s*pN\s*$/i, pos, "must be above 0");
    if (typeof K33 === "string") return refuse(K33);
    if (K11 > 1e4 || K33 > 1e4) return refuse("Elastic constants above 10⁴ pN are not nematic values; check the units (pN).");
    const ep = readField(r("epar"), "ε∥", /\s*$/, (x) => x >= 1 && x <= 1000, "must be 1 to 1000");
    if (typeof ep === "string") return refuse(ep);
    const eo = readField(r("eperp"), "ε⊥", /\s*$/, (x) => x >= 1 && x <= 1000, "must be 1 to 1000");
    if (typeof eo === "string") return refuse(eo);
    if (!(ep - eo > 0))
      return refuse(
        `Δε = ε∥ − ε⊥ = ${num(ep - eo, 4)} is not positive: there is no splay Fréedericksz transition for zero or negative dielectric anisotropy in a planar cell (the field holds the director in the plane).`,
      );
    const dUm = readField(r("d"), "The cell gap", /\s*(µm|μm|um)\s*$/i, (x) => x > 0 && x <= 1000, "must be above 0 and at most 1000 µm");
    if (typeof dUm === "string") return refuse(dUm);
    const pre = readField(r("pretilt"), "The pretilt", ANGLE_STRIP, (x) => x >= 0 && x < 45, "must be 0° or more and below 45°");
    if (typeof pre === "string") return refuse(pre);
    const lam = readField(r("lam"), "The wavelength", NM_STRIP, (x) => x >= 200 && x <= 20000, "must be 200 to 20000 nm");
    if (typeof lam === "string") return refuse(lam);
    const idx = (r("indices") ?? "").trim();
    let mat: Material | null;
    if (/^e7$/i.test(idx)) mat = BUILTIN_MATERIALS[0];
    else {
      const mm = readMaterials(`LC ${idx}`);
      if (!mm.ok) return refuse(mm.reason.replace(/^Materials line 1: /, "Indices: "));
      mat = [...mm.mats.values()][0] ?? null;
    }
    if (!mat) return refuse("Indices: give \"ne A B C no A B C\" or E7.");
    const ne = cauchyN(mat.ne, lam);
    const no = cauchyN(mat.no, lam);
    if (!(ne > 1 && ne < 4 && no > 1 && no < 4)) return refuse(`The indices leave 1 to 4 at ${nm(lam)}; check the coefficients.`);
    if (!(ne > no)) return refuse("This tool needs nₑ > nₒ (a positive-birefringence nematic): the retardance and tilt searches assume Γ falls as the director tilts.");
    const v0 = readField(r("vFrom"), "The start voltage", /\s*V\s*(rms)?\s*$/i, (x) => x >= 0, "must be 0 or more");
    if (typeof v0 === "string") return refuse(v0);
    const v1 = readField(r("vTo"), "The end voltage", /\s*V\s*(rms)?\s*$/i, (x) => x > 0, "must be above 0");
    if (typeof v1 === "string") return refuse(v1);
    if (!(v1 > v0)) return refuse("The voltage range is reversed or empty: the end must be above the start.");
    const np = readField(r("points"), "The number of voltage points", /\s*$/, (x) => Number.isInteger(x) && x >= 2 && x <= 400, "must be a whole number from 2 to 400");
    if (typeof np === "string") return refuse(np);
    const vp = readField(r("vProfile"), "The profile voltage", /\s*V\s*(rms)?\s*$/i, (x) => x >= 0, "must be 0 or more");
    if (typeof vp === "string") return refuse(vp);

    const p: LcElastic = { K11: K11 * 1e-12, K33: K33 * 1e-12, epsPar: ep, epsPerp: eo, d: dUm * 1e-6, theta0: (pre * PI) / 180 };
    const o: Optics = { ne, no, lam };
    const dEps = ep - eo;
    const vth = thresholdVoltage(p.K11, dEps);
    const vMax = voltageOfMid(p, THETA_M_MAX);
    const tooHigh = (V: number): string =>
      `${qNum(V, 4)} V is beyond what the solver resolves for this cell (about ${qNum(vMax, 3)} V = ${qNum(vMax / vth, 3)} Vₜₕ, where the midplane is within 10⁻¹⁰ rad of 90°). Lower the voltage.`;
    if (v1 > vMax) return refuse(tooHigh(v1));
    if (vp > vMax) return refuse(tooHigh(vp));

    // Sweep
    const V: number[] = [];
    const gam: number[] = [];
    const thm: number[] = [];
    const apx: number[] = [];
    let prevThm: number | undefined;
    let prevV: number | undefined;
    for (let i = 0; i < np; i++) {
      const v = v0 + ((v1 - v0) * i) / (np - 1);
      const pr = profileAt(p, o, v, i === np - 1, { lo: prevThm, vAtLo: prevV, vMax });
      if (pr.ok && !pr.uniform) {
        prevThm = pr.thetaM;
        prevV = v;
      }
      if (!pr.ok) return refuse(pr.reason === "beyond" ? tooHigh(v) : pr.reason);
      V.push(v);
      gam.push(pr.gamma);
      thm.push((pr.thetaM * 180) / PI);
      apx.push((midApprox(p.theta0, v / vth) * 180) / PI);
    }
    const prof = profileAt(p, o, vp);
    if (!prof.ok) return refuse(prof.reason === "beyond" ? tooHigh(vp) : prof.reason);
    const samp = profileSamples(p, prof.thetaM, prof.uniform);

    const lines: string[] = [];
    lines.push(`Nematic cell: d = ${num(dUm, 5)} µm, K₁₁ = ${num(K11, 4)} pN, K₃₃ = ${num(K33, 4)} pN, ε∥ = ${num(ep, 4)}, ε⊥ = ${num(eo, 4)} (Δε = ${num(dEps, 4)}), pretilt θ₀ = ${degText(pre, 4)}`);
    lines.push(`  At λ = ${nm(lam)}: nₑ = ${num(ne, 6)}, nₒ = ${num(no, 6)}, Δn = ${num(ne - no, 5)}${mat.source ? ` (${mat.name}: ${mat.source})` : ""}`);
    lines.push("");
    lines.push(`  Fréedericksz threshold Vₜₕ = π√(K₁₁/(ε₀Δε)) = ${qNum(vth, 5)} V rms (zero pretilt; independent of d)`);
    if (pre > 0)
      lines.push("  With a pretilt there is no sharp threshold: the midplane tilt rises from θ₀ as soon as any voltage is applied, steeply near Vₜₕ.");
    lines.push("");
    lines.push(`At V = ${qNum(vp, 5)} V rms (V/Vₜₕ = ${qNum(vp / vth, 4)}):`);
    lines.push(
      `  Midplane tilt θₘ = ${tiltText((prof.thetaM * 180) / PI, 6)}${prof.uniform ? " (below threshold: the cell is undeformed)" : ""}; the approximation θₘ ≈ θ₀ + (π/2 − θ₀)√(1 − 1/Vᵣ²) (the uniform-profile approximation of Abdulhalim & Menashe, Liq. Cryst. 37, 233 (2010), as used by Abuleil & Abdulhalim, Opt. Lett. 39, 5487 (2014)) gives ${degText((midApprox(p.theta0, vp / vth) * 180) / PI, 5)}`,
    );
    lines.push(`  Retardance Γ = ${num(prof.gamma, 6)} rad = ${piText(prof.gamma, 6)} (${num(prof.gamma / (2 * PI), 5)} waves); mean Δn(θ) = ${num(prof.dnMean, 6)}`);
    const full = (2 * PI * (ne - no) * dUm) / (lam / 1000);
    lines.push(`  Undeformed (θ = 0) retardance 2πΔn d/λ = ${num(full, 6)} rad = ${piText(full, 6)}: the uniform-tilt formula is the special case θ(z) = constant.`);
    const tu = tiltForDn(ne, no, prof.dnMean);
    if (tu !== null)
      lines.push(
        `  Uniform-tilt equivalent: a uniform tilt of ${degText(tu, 6)} gives the same Γ at ${nm(lam)} (for the retarder calculator; at other wavelengths it is close but not exact, because nₑ and nₒ disperse differently).`,
      );
    lines.push("  Profile θ(z) (symmetric about the midplane):");
    const rowsZ = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5];
    lines.push("    " + rowsZ.map((zr) => `z/d = ${qNum(zr, 2)}: ${tiltText((thetaAtZExact(p, prof.thetaM, prof.uniform, zr) * 180) / PI, 6)}`).join(";  "));
    lines.push("");
    // Sweep summary
    lines.push(`Sweep ${qNum(v0, 4)} to ${qNum(v1, 4)} V rms (${np} points):`);
    const picks = [0, Math.floor((np - 1) / 4), Math.floor((np - 1) / 2), Math.floor((3 * (np - 1)) / 4), np - 1].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of picks) lines.push(`  V = ${qNum(V[i], 4)} V: θₘ = ${tiltText(thm[i], 5)}, Γ = ${piText(gam[i], 5)}`);

    // Target
    let markV: number | null = null;
    let markLabel = "";
    const tk = r("targetKind");
    if (tk === "gamma" || tk === "tilt") {
      lines.push("");
      const tv = (r(tk === "gamma" ? "targetGamma" : "targetTilt") ?? "").trim();
      if (tk === "gamma") {
        const lv = readLevels(tv);
        if (!lv.ok || lv.levels.length !== 1) return refuse(lv.ok ? "Give one target retardance, e.g. 0.5π." : lv.reason);
        const g = lv.levels[0].gamma;
        const tm = midForGamma(p, o, g);
        if (tm === null)
          return refuse(`A retardance of ${piText(g)} is out of reach: Γ runs from ${piText(profileAt(p, o, 0).ok ? (profileAt(p, o, 0) as { gamma: number }).gamma : full)} (no field) down toward 0 at saturation.`);
        const vt = voltageOfMid(p, tm);
        markV = vt;
        markLabel = `Γ = ${piText(g)} at ${qNum(vt, 4)} V`;
        lines.push(`Voltage for Γ = ${piText(g)}: ${qNum(vt, 6)} V rms (θₘ = ${tiltText((tm * 180) / PI, 6)})`);
      } else {
        const tMax = (THETA_M_MAX * 180) / PI;
        const t = readField(
          tv,
          "The target tilt",
          ANGLE_STRIP,
          (x) => x > pre && x <= tMax,
          `must be above the pretilt (${degText(pre, 4)}) and at most ${tiltText(tMax, 11)} (the solver resolves the midplane to within 10⁻¹⁰ rad of 90°)`,
        );
        if (typeof t === "string") return refuse(t);
        const vt = voltageOfMid(p, (t * PI) / 180);
        markV = vt;
        markLabel = `θₘ = ${tiltText(t, 4)} at ${qNum(vt, 4)} V`;
        lines.push(`Voltage for a midplane tilt of ${tiltText(t, 5)}: ${qNum(vt, 6)} V rms`);
      }
      if (markV !== null && (markV < v0 || markV > v1))
        lines.push(`  This voltage lies outside the plotted sweep (${qNum(v0, 4)} to ${qNum(v1, 4)} V), so it is not marked on the figure.`);
    }
    lines.push("");
    if (mat.fitRangeNm && (lam < mat.fitRangeNm[0] || lam > mat.fitRangeNm[1]))
      lines.push(`Note: ${mat.name}: the index fit covers about ${mat.fitRangeNm[0]}–${mat.fitRangeNm[1]} nm; at ${nm(lam)} the indices are an extrapolation.`);
    lines.push(
      "Note: one-dimensional director (no twist), strong anchoring at θ₀, rms field (no frequency dependence), no flexoelectric or ionic effects, normal incidence. The profile is checked by a coarse/fine quadrature agreement and refused if they differ.",
    );

    // Figures
    const profV = [1.2, 1.5, 2, 3, 5].map((k) => k * vth).filter((v) => v >= v0 && v <= v1);
    if (!profV.length) profV.push(vp);
    const profiles = profV.slice(0, 6).map((v) => {
      const pr = solveMid(p, v);
      const s = pr.ok ? profileSamples(p, pr.thetaM, pr.uniform) : samp;
      return { label: `V = ${qNum(v, 3)} V (${qNum(v / vth, 3)} Vₜₕ)`, z: s.z.map((z) => z / p.d), thetaDeg: s.theta.map((t) => (t * 180) / PI) };
    });
    const blocks: AnalyzeBlock[] = [];
    blocks.push(plotBlock(lcProfilesSvg({ profiles, style }), "Director tilt θ(z) across the cell at several voltages", "Director tilt profiles across the cell"));
    const vthLabel = `Vₜₕ = ${qNum(vth, 4)} V`;
    blocks.push(
      plotBlock(
        lcGammaVoltageSvg({ V, gammaOverPi: gam.map((g) => g / PI), vth: vth >= v0 && vth <= v1 ? vth : null, vthLabel, markV: markV !== null && markV >= v0 && markV <= v1 ? markV : null, markLabel, style }),
        `Retardance against voltage at ${nm(lam)}, threshold marked`,
        "Retardance divided by pi against rms voltage",
      ),
    );
    blocks.push(
      plotBlock(
        lcMidTiltSvg({ V, full: thm, approx: apx, vth: vth >= v0 && vth <= v1 ? vth : null, vthLabel, style }),
        "Midplane tilt against voltage: the full solution and the uniform-profile approximation",
        "Midplane tilt against rms voltage",
      ),
    );
    const zRows = 9;
    const tilts: number[] = [];
    for (let j = 0; j < zRows; j++) tilts.push((thetaAtZ(samp, ((j + 0.5) / zRows) * p.d) * 180) / PI);
    blocks.push(
      plotBlock(
        lcCellSvg({ tiltsDeg: tilts, uniformTiltDeg: null, pretiltDeg: pre, voltage: vp, style, title: `Director profile at ${qNum(vp, 4)} V rms` }),
        `Cell cross-section with the computed director profile at ${qNum(vp, 4)} V rms`,
        "Liquid-crystal cell cross-section with tilted molecules",
      ),
    );
    return engReport(lines, blocks);
  },
};

export const LC_CALCS: LcCalc[] = [retarderCalc, voltageCalc];
