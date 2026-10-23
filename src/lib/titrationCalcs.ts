// Pane glue for the Chemistry & electrochemistry calculators: an exact titration curve, a speciation (distribution)
// diagram, the pH of a solution or buffer, the Randles–Ševčík peak current with a simulated reversible voltammogram,
// and a Randles–Ševčík analysis of measured peak currents. Kept OUT of taskpane.ts so the exact objects the pane
// registers can be tested (nothing can import the pane under jest), the pattern of assayQuantCalcs.ts.
//
// Each entry is shaped exactly like the pane's EngCalc ({id, name, group, hint, fields, compute}); the field and
// calculator types are declared structurally here because the pane does not export them.
//
// No number is computed here: titration.ts and electrochem.ts own them all (and electrochem.ts's F, R and RT/F are
// the ones every electrochemistry tool uses). This file reads the fields (units through units.ts parseMeasured, the
// same contract as the pane's engUnits), words the result under the display contract (U+2212 minus, ×10ⁿ, never an
// em dash, NaN or Infinity in the text) and draws.

import type { EngUnitContract } from "./engCalc";
import { engReport } from "./engReport";
import type { AnalyzeOutput, AnalyzeBlock } from "./analyzeBlocks";
import { parseMeasured } from "./units";
import { fmtSig, MINUS } from "./axis";
import { trueMinus } from "./numberList";
import { hendersonHasselbalch } from "./assay";
import {
  KW_25C,
  TITRATION_SOURCE,
  titrate,
  titrationPH,
  equivalenceVolumes,
  measuredEndpoints,
  solvePH,
  fractions,
  bufferCapacity,
  speciesLabel,
  pKbToPKa,
  isAcidAnalyte,
  type AnalyteKind,
  type SolutionSpec,
  type TitrationSpec,
} from "./titration";
import {
  FARADAY,
  R_GAS_EC,
  randlesSevcik,
  rsConstant,
  reversiblePeaks,
  randlesSevcikAnalysis,
  simulateReversibleCv,
  thermalVoltage,
  type CvSim,
} from "./electrochem";
import { titrationCurveSvg, speciationSvg, bufferCapacitySvg, rsLineSvg, cvSimSvg, rsAnalysisSvg, currentUnit } from "./titrationCharts";
import { combineSvgs } from "./plot";
import { readDataBlock } from "./dataBlock";

/** The pane's AnalyzeField, structurally. */
export interface ChemEngField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  rows?: number;
  options?: { value: string; label: string }[];
}
/** The new Engineering group these calculators belong to (to be added to ENG_GROUP_ORDER). */
export const CHEM_ENG_GROUP = "Chemistry & electrochemistry" as const;
/** The pane's EngCalc, structurally. */
export interface ChemEngCalc {
  id: string;
  name: string;
  group: typeof CHEM_ENG_GROUP;
  hint: string;
  fields: ChemEngField[];
  /** The unit contract this tool keeps (engCalc.ts EngUnitContract). */
  unitContract: EngUnitContract;
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

// ------------------------------------------------------------------ helpers

/** The constants line: electrochem.ts's F and R, the ones every electrochemistry tool uses. */
const CONSTANTS_SOURCE = `F = ${FARADAY} C/mol, R = ${R_GAS_EC} J mol⁻¹ K⁻¹ (CODATA 2018).`;

/** The unit contract, worded as the pane's ENG_UNIT_NOTE. */
export const CHEM_UNIT_NOTE =
  "Units: a bare number is read in the unit that field names; write another unit (25 mL or 0.025 L, 0.1 M or " +
  "100 mM, 7 mm², 100 mV/s) and it is converted for you, and a unit of the wrong quantity is refused rather than " +
  "silently ignored.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")).replace(/[“”]/g, '"'), ok: false });

/** Unit-aware field reading (the pane's engUnits, for this file): errors collected, conversions reported. */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/−/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!m.assumed && m.inTarget !== m.value) conversions.push(`${label}: ${num(m.value, 6)} ${m.unit} = ${num(m.inTarget, 4)} ${si.replace("^2", "²").replace("^3", "³")}`);
    return m.inTarget;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, label: string): number => read(key, si, label, true) as number,
    opt: (key: string, si: string, label: string): number | null => read(key, si, label, false),
  };
}

/** A plain number field (no unit): NaN when blank or unreadable. */
function plain(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/−/g, "-");
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : NaN;
}

/** Significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁶, U+2212. */
function num(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return "not finite";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return (v < 0 ? MINUS : "") + String(Number(a.toPrecision(sig)));
  return fmtSig(v, sig);
}
/** A pH (two decimals, U+2212 below zero). */
/** "R² = 0.9987", and "R² > 0.9999" for a value that rounds to 1 but is not 1. */
export const r2Text = (r2: number): string => (r2 < 1 && r2.toFixed(4) === "1.0000" ? "R² > 0.9999" : `R² = ${r2.toFixed(4)}`);
const ph2 = (x: number): string => (Math.abs(x) < 0.005 ? "0.00" : x.toFixed(2)).replace(/^-/, MINUS);
/** A concentration in M with ×10ⁿ. */
const conc = (c: number): string => `${fmtSig(c, 3)} M`;

/**
 * A pasted table or one-line list, read by RULE N (dataBlock.readDataBlock: one separator decision per block,
 * mixed decimal marks refused, header only when wholly non-numeric, words beside numbers refused by line). On top:
 * each row needs `need` numbers; up to `optional` more are used when present (rows may differ, a missing-value
 * token ends the optional part); further columns are ignored and said so. `pairAmbiguity`: a lone "4,76" is refused.
 */
export function readTable(
  text: string,
  what: string,
  opts: { need: number; optional?: number; cap?: number; pairAmbiguity?: boolean; singleColumn?: boolean },
): { rows: number[][]; notes: string[] } | string {
  const optional = opts.optional ?? 0;
  const b = readDataBlock(text, what, { maxRows: opts.cap ?? 2000, loneCommaPairAmbiguous: opts.pairAmbiguity, singleColumn: opts.singleColumn });
  if (!b.ok) return b.error;
  const rows: number[][] = [];
  let extra = 0;
  for (let i = 0; i < b.rows.length; i++) {
    const vals = b.rows[i];
    const head = vals.slice(0, opts.need);
    if (head.length < opts.need || head.some((v) => v === null))
      return `${what}: line ${b.lines[i]} does not have ${opts.need} number${opts.need > 1 ? "s" : ""}${opts.need > 1 ? " (one per column)" : ""}.`;
    const row = head as number[];
    for (let k = opts.need; k < Math.min(vals.length, opts.need + optional); k++) {
      const v = vals[k];
      if (v === null) break;
      row.push(v);
    }
    if (vals.slice(opts.need + optional).some((v) => v !== null)) extra++;
    rows.push(row);
  }
  const notes = [...b.notes];
  if (extra) notes.push(`${what}: ${extra} row${extra > 1 ? "s have" : " has"} more columns than are used; only the first ${opts.need + optional} were read.`);
  return { rows, notes };
}

/** "4.76", "2.15, 7.20, 12.35" or "2,15 7,20": one to four numbers. */
function readPKList(text: string, label: string): number[] | string {
  if (!(text ?? "").trim()) return `${label}: give one to four values, comma separated (for example 2.15, 7.20, 12.35).`;
  const t = readTable(text, label, { need: 1, optional: 3, cap: 4, pairAmbiguity: true, singleColumn: true });
  if (typeof t === "string") return t;
  const out = t.rows.flat();
  if (out.length > 4 || t.notes.some((n) => /more columns/.test(n))) return `${label}: at most four values.`;
  return out;
}

/** pKa list (of the fully protonated form, ascending) from the pKa/pKb fields. */
function readSystemPKa(r: (k: string) => string, base: boolean, pKw: number): number[] | string {
  const list = readPKList(r("pk"), base && r("pktype") === "pkb" ? "pKb values" : "pKa values");
  if (typeof list === "string") return list;
  if (base && r("pktype") === "pkb") return pKbToPKa(list, pKw);
  for (let i = 1; i < list.length; i++)
    if (list[i] < list[i - 1])
      return `List the pKa values in ascending order (pKa₁ < pKa₂ < …): each proton is harder to remove than the last.${
        /,(?!\s)/.test(r("pk")) && !/\s/.test(r("pk").trim()) ? " Commas without spaces were read as separators; for decimal commas write 2,15 7,20." : ""
      }`;
  return list;
}

function readPKw(r: (k: string) => string): number | string {
  const t = (r("pkw") ?? "").trim();
  if (!t) return 14;
  const v = plain(t);
  if (!(v >= 10 && v <= 16)) return "pKw must be a number from 10 to 16 (14.00 at 25 °C; type the value for your temperature and solvent if you have it).";
  return v;
}

/** "V pH" lines; a non-numeric first line is a header. */
function readPairs(text: string, what: string): { pairs: Array<[number, number]>; notes: string[] } | string {
  const t = readTable(text, `Measured ${what}`, { need: 2 });
  if (typeof t === "string") return t;
  return { pairs: t.rows.map((r) => [r[0], r[1]] as [number, number]), notes: t.notes };
}

const plot = (svg: { svg: string; width: number; height: number } | string, caption: string, alt: string): AnalyzeBlock => {
  if (typeof svg === "string") {
    const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 420), h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 269);
    return { kind: "plot", svg, caption, alt, w, h };
  }
  return { kind: "plot", svg: svg.svg, caption, alt, w: svg.width, h: svg.height };
};

function finish(lines: string[], conversions: string[], figures: AnalyzeBlock[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(CHEM_UNIT_NOTE);
  return engReport(lines.map((l) => trueMinus(l)), figures);
}

const KIND_OPTIONS = [
  { value: "weak-acid", label: "Weak acid (mono- or polyprotic)" },
  { value: "strong-acid", label: "Strong acid (HCl, HNO₃)" },
  { value: "weak-base", label: "Weak base (mono- or polybasic)" },
  { value: "strong-base", label: "Strong base (NaOH, KOH)" },
];
const PKTYPE_OPTIONS = [
  { value: "pka", label: "pKa (of the acid, or of a base's conjugate acid)" },
  { value: "pkb", label: "pKb (bases only)" },
];
const PKA_HINT_TAIL =
  " pKa values are yours to give (literature values, or the group-typical estimate in the pKa block of a structure's properties in Chemistry); concentrations " +
  "stand in for activities, so expect a few hundredths of a pH unit from a measured curve at ionic strengths above about 0.01 M.";

// --------------------------------------------------------------- titration

const titrationCalc: ChemEngCalc = {
  id: "chem-titration",
  name: "Titration curve (exact pH)",
  group: CHEM_ENG_GROUP,
  unitContract: "converts",
  hint:
    "An acid titrated with a strong base (NaOH), or a base with a strong acid (HCl): the pH at every volume from the exact " +
    "charge balance, solved for [H⁺] numerically, not from Henderson–Hasselbalch. Gives the equivalence volume(s), the pH at " +
    "the start, at each half-equivalence and equivalence point and at your volume, and dpH/dV. Paste measured " +
    "(volume, pH) pairs to overlay them and locate their endpoints from the first-derivative maximum and the " +
    "second-derivative zero." +
    PKA_HINT_TAIL,
  fields: [
    { key: "kind", label: "Analyte", default: "weak-acid", kind: "select", options: KIND_OPTIONS },
    { key: "pk", label: "pKa values, ascending (weak only; up to four)", default: "4.76", kind: "text" },
    { key: "pktype", label: "Constants given as", default: "pka", kind: "select", options: PKTYPE_OPTIONS },
    { key: "c0", label: "Analyte concentration (M; mM converts)", default: "0.1 M", kind: "text" },
    { key: "v0", label: "Analyte volume (mL; L converts)", default: "25 mL", kind: "text" },
    { key: "ct", label: "Titrant concentration (M; mM converts)", default: "0.1 M", kind: "text" },
    { key: "vat", label: "pH at titrant volume (mL; optional)", default: "20 mL", kind: "text" },
    { key: "vmax", label: "Plot to titrant volume (mL; blank: 1.5 × last equivalence)", default: "", kind: "text" },
    { key: "pkw", label: "pKw (14.00 at 25 °C)", default: "14.00", kind: "text" },
    { key: "data", label: "Measured volume (mL), pH (optional)", default: "", kind: "block", rows: 5 },
  ],
  compute: (r) => {
    const kind = r("kind") as AnalyteKind;
    if (!["weak-acid", "strong-acid", "weak-base", "strong-base"].includes(kind)) return refuse("Choose the analyte: weak or strong acid, weak or strong base.");
    const pKw = readPKw(r);
    if (typeof pKw === "string") return refuse(pKw);
    const weak = kind === "weak-acid" || kind === "weak-base";
    const acid = isAcidAnalyte(kind);
    let pKa: number[] = [];
    if (weak) {
      if (acid && r("pktype") === "pkb") return refuse("pKb applies to a base: for an acid, give its pKa values.");
      const p = readSystemPKa(r, !acid, pKw);
      if (typeof p === "string") return refuse(p);
      pKa = p;
    }
    const u = unitReader(r);
    const C0 = u.req("c0", "M", "Analyte concentration");
    const V0 = u.req("v0", "mL", "Analyte volume");
    const Ct = u.req("ct", "M", "Titrant concentration");
    const Vat = u.opt("vat", "mL", "Titrant volume");
    const Vmax = u.opt("vmax", "mL", "Plot to titrant volume");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const spec: TitrationSpec = { kind, pKa, C0, V0, Ct, Kw: Math.pow(10, -pKw) };
    let measured: Array<[number, number]> = [];
    let dataNotes: string[] = [];
    if ((r("data") ?? "").trim()) {
      const m = readPairs(r("data"), "volume pH");
      if (typeof m === "string") return refuse(m);
      if (m.pairs.some(([, p]) => p < -2 || p > 16)) return refuse("A measured pH outside −2 to 16: are the columns volume first, then pH?");
      measured = m.pairs;
      dataNotes = m.notes;
    }
    const veq = equivalenceVolumes(spec);
    if (Vmax !== null && veq.length && Vmax < 0.2 * veq[0]) return refuse(`Plot to at least ${num(0.2 * veq[0], 3)} mL: the first equivalence is at ${num(veq[0], 4)} mL.`);
    // Unless a range is given, the plot reaches past the last equivalence, the last measured volume and your volume.
    const autoMax = Math.max(1.5 * veq[veq.length - 1], measured.length ? measured[measured.length - 1][0] : 0, Vat !== null && Vat <= 20 * veq[veq.length - 1] ? 1.05 * Vat : 0);
    const res = titrate(spec, Vmax ?? autoMax);
    if (typeof res === "string") return refuse(`Cannot compute: ${res}.`);
    const titrant = acid ? "strong base" : "strong acid";
    const lines: string[] = [...dataNotes];
    const nm = weak ? pKa.length : 1;
    lines.push(
      `${acid ? "Acid" : "Base"} ${conc(C0)}, ${num(V0, 4)} mL, titrated with ${conc(Ct)} ${titrant}${weak ? ` (pKa ${pKa.map((p) => ph2(p)).join(", ")}${!acid ? " of the conjugate acid" : ""})` : ""}.`,
    );
    lines.push(`Equivalence volume${nm > 1 ? "s" : ""}: ${veq.map((v) => `${num(v, 4)} mL`).join(", ")}.`);
    lines.push(`pH at the start: ${ph2(res.pHstart)}.`);
    for (const h of res.halves)
      lines.push(`Half-equivalence, ${num(h.V, 4)} mL: pH ${ph2(h.pH)}${h.pKa === null ? "" : ` (pKa ${ph2(h.pKa)}; the difference is the error of the pH = pKa shortcut)`}.`);
    res.breaks.forEach((b, i) => {
      const label = nm > 1 ? `Equivalence point ${i + 1}` : "Equivalence point";
      const inf = b.inflection
        ? `steepest at ${num(b.inflection.V, 5)} mL, pH ${ph2(b.inflection.pH)}, dpH/dV = ${num(b.inflection.slope, 3)} per mL`
        : weak
          ? "no clear break: the pH change here is too gradual (pKa too close to the next one, or to pKw) for an indicator or electrode to locate"
          : "no clear break: at this dilution the pH jump at equivalence is too small (water's own H⁺ and OH⁻ swamp it) for an indicator or electrode to locate";
      lines.push(`${label}, ${num(b.Veq, 4)} mL: pH ${ph2(b.pHeq)}; ${inf}.`);
    });
    let at: { V: number; pH: number } | null = null;
    if (Vat !== null) {
      const p = titrationPH(spec, Vat);
      if (typeof p === "string") return refuse(`Titrant volume: ${p}.`);
      at = { V: Vat, pH: p };
      lines.push(`At ${num(Vat, 4)} mL of titrant: pH ${ph2(p)}.`);
    }
    if (measured.length) {
      const eps = measuredEndpoints(measured);
      if (typeof eps === "string") lines.push(`Measured data: ${eps}.`);
      else
        for (const e of eps)
          lines.push(
            `Measured endpoint: ${num(e.Vfirst, 4)} mL from the first-derivative maximum (ΔpH/ΔV = ${num(e.slope, 3)} per mL)${
              e.Vsecond !== null ? `, ${num(e.Vsecond, 4)} mL from the second-derivative zero crossing` : ""
            }.`,
          );
    }
    lines.push(TITRATION_SOURCE);
    const fig = titrationCurveSvg(res, { measured, at, acid });
    return finish(lines, u.conversions, [plot(fig, "Titration curve with dpH/dV", "pH against titrant volume with the equivalence points marked, over the first derivative")]);
  },
};

// --------------------------------------------------------------- speciation

const speciationCalc: ChemEngCalc = {
  id: "chem-speciation",
  name: "Speciation (distribution) diagram",
  group: CHEM_ENG_GROUP,
  unitContract: "domain",
  hint:
    "The fraction of each protonation state of a mono- or polyprotic acid (or a base) against pH, exactly: " +
    "αₖ ∝ [H⁺]ᵏ·Ka₁·…·Ka₍ₙ₋ₖ₎. Gives the fractions at your pH and which form dominates." +
    PKA_HINT_TAIL,
  fields: [
    { key: "sys", label: "System", default: "acid", kind: "select", options: [{ value: "acid", label: "Acid HₙA" }, { value: "base", label: "Base B" }] },
    { key: "pk", label: "pKa values, ascending (up to four)", default: "2.15, 7.20, 12.35", kind: "text" },
    { key: "pktype", label: "Constants given as", default: "pka", kind: "select", options: PKTYPE_OPTIONS },
    { key: "ph", label: "pH of interest (optional)", default: "7.4", kind: "text" },
    { key: "pkw", label: "pKw (14.00 at 25 °C; sets the pH axis)", default: "14.00", kind: "text" },
  ],
  compute: (r) => {
    const base = r("sys") === "base";
    const pKw = readPKw(r);
    if (typeof pKw === "string") return refuse(pKw);
    if (!base && r("pktype") === "pkb") return refuse("pKb applies to a base: choose System ▸ Base, or give pKa values.");
    const pKa = readSystemPKa(r, base, pKw);
    if (typeof pKa === "string") return refuse(pKa);
    if (pKa.some((p) => !(p >= -2 && p <= 16))) return refuse("Each pKa must be a number from −2 to 16.");
    const phRaw = (r("ph") ?? "").trim();
    const pH = phRaw ? plain(phRaw) : null;
    if (pH !== null && !(pH >= -2 && pH <= 16)) return refuse("The pH of interest must be a number from −2 to 16.");
    const n = pKa.length;
    const lines: string[] = [`${base ? "Base" : "Acid"} with pKa ${pKa.map(ph2).join(", ")}${base ? " (conjugate acid)" : ""}: ${n + 1} forms, ${Array.from({ length: n + 1 }, (_, i) => speciesLabel(n - i, n, base)).join(", ")}.`];
    for (let j = 0; j < n; j++) lines.push(`Equal amounts of ${speciesLabel(n - j, n, base)} and ${speciesLabel(n - j - 1, n, base)} at pH ${ph2(pKa[j])}${n > 1 && j > 0 && pKa[j] - pKa[j - 1] < 2 ? " (pKa values under 2 apart: the forms overlap and neither peaks near 1)" : ""}.`);
    if (pH !== null) {
      const f = fractions(pKa, pH);
      const parts = f.map((x, k) => ({ k, x })).reverse();
      lines.push(`At pH ${ph2(pH)}: ${parts.map(({ k, x }) => `${speciesLabel(k, n, base)} ${pct(x)}`).join(", ")}.`);
      // Ties (to 0.05 %) are reported as ties: at pH = pKa neither form dominates.
      const top = Math.max(...parts.map((q) => q.x));
      const doms = parts.filter((q) => q.x >= top - 5e-4);
      lines.push(doms.length > 1 ? `No single dominant form: ${doms.map((q) => speciesLabel(q.k, n, base)).join(" and ")} are equal.` : `Dominant form: ${speciesLabel(doms[0].k, n, base)}.`);
    }
    lines.push("Fractions are exact for the pKa values given (concentrations as activities).");
    const svg = speciationSvg(pKa, base, pKw, pH);
    return finish(lines, [], [plot(svg, "Speciation diagram", "Fraction of each protonation state against pH")]);
  },
};

/** A fraction as a percentage, three significant figures, ×10ⁿ for the vanishing ones. */
function pct(x: number): string {
  const p = x * 100;
  if (p >= 0.01) return `${String(Number(p.toPrecision(3)))} %`;
  if (p === 0) return "0 %";
  return `${fmtSig(p, 2)} %`;
}

// --------------------------------------------------------------- solution pH

const solutionCalc: ChemEngCalc = {
  id: "chem-solution-ph",
  name: "pH of a solution or buffer",
  group: CHEM_ENG_GROUP,
  unitContract: "converts",
  hint:
    "The exact pH of a weak acid or base, its salt, a buffer of the two, and any added strong acid or base, from the " +
    "charge balance. For an acid HₙA the salt is its one-step conjugate (NaHₙ₋₁A: sodium acetate, NaH₂PO₄); for a base B " +
    "it is the protonated salt BH⁺Cl⁻ (NH₄Cl). Other mixtures are the acid plus strong base: Na₂HPO₄ is H₃PO₄ with two " +
    "equivalents of NaOH. Gives the buffer capacity β and, for a two-component buffer, how far Henderson–Hasselbalch is off." +
    PKA_HINT_TAIL,
  fields: [
    { key: "sys", label: "Weak system", default: "acid", kind: "select", options: [{ value: "acid", label: "Weak acid HₙA" }, { value: "base", label: "Weak base B" }, { value: "none", label: "None (strong acid/base only)" }] },
    { key: "pk", label: "pKa values, ascending (up to four)", default: "4.76", kind: "text" },
    { key: "pktype", label: "Constants given as", default: "pka", kind: "select", options: PKTYPE_OPTIONS },
    { key: "cfree", label: "Acid HₙA or base B (M; mM converts)", default: "0.1 M", kind: "text" },
    { key: "csalt", label: "Its salt NaHₙ₋₁A or BH⁺Cl⁻ (M)", default: "0.1 M", kind: "text" },
    { key: "csa", label: "Added strong acid (M)", default: "0", kind: "text" },
    { key: "csb", label: "Added strong base (M)", default: "0", kind: "text" },
    { key: "pkw", label: "pKw (14.00 at 25 °C)", default: "14.00", kind: "text" },
  ],
  compute: (r) => {
    const sys = r("sys");
    if (!["acid", "base", "none"].includes(sys)) return refuse("Choose the weak system: acid, base or none.");
    const pKw = readPKw(r);
    if (typeof pKw === "string") return refuse(pKw);
    const base = sys === "base";
    const u = unitReader(r);
    const Csa = u.opt("csa", "M", "Strong acid") ?? 0;
    const Csb = u.opt("csb", "M", "Strong base") ?? 0;
    let Cf = 0, Cs = 0;
    let pKa: number[] = [];
    if (sys !== "none") {
      Cf = u.opt("cfree", "M", base ? "Base" : "Acid") ?? 0;
      Cs = u.opt("csalt", "M", "Salt") ?? 0;
      if (sys === "acid" && r("pktype") === "pkb") return refuse("pKb applies to a base: choose Weak system ▸ Weak base, or give pKa values.");
      const p = readSystemPKa(r, base, pKw);
      if (typeof p === "string") return refuse(p);
      pKa = p;
    }
    if (u.errors.length) return refuse(u.errors.join("\n"));
    for (const [v, name] of [[Cf, "The acid/base concentration"], [Cs, "The salt concentration"], [Csa, "The strong acid"], [Csb, "The strong base"]] as const)
      if (!(v >= 0)) return refuse(`${name} must be zero or above.`);
    const n = pKa.length;
    // A salt is the free form plus its spectator ion: NaHₙ₋₁A = HₙA + NaOH, BH⁺Cl⁻ = B + HCl. The charge balance is the same.
    const s: SolutionSpec = {
      weak: sys === "none" || Cf + Cs === 0 ? null : { pKa, C: Cf + Cs, m: base ? 0 : n },
      Ca: Csa + (base ? Cs : 0),
      Cb: Csb + (base ? 0 : Cs),
      Kw: Math.pow(10, -pKw),
    };
    const pH = solvePH(s);
    if (typeof pH === "string") return refuse(`Cannot compute: ${pH}.`);
    const h = Math.pow(10, -pH);
    const beta = bufferCapacity(s, pH);
    const lines: string[] = [`pH = ${ph2(pH)} ([H⁺] = ${conc(h)}, [OH⁻] = ${conc(s.Kw / h)}).`];
    if (s.weak) {
      const f = fractions(pKa, pH);
      lines.push(`Forms: ${f.map((x, k) => ({ k, x })).reverse().map(({ k, x }) => `${speciesLabel(k, n, base)} ${pct(x)}`).join(", ")}.`);
    }
    lines.push(`Buffer capacity β = ${num(beta * 1000, 3)} mM per pH unit: about ${num(beta * 1000 * 0.1, 3)} mM of strong acid or base moves the pH by 0.1.`);
    if (s.weak && n === 1 && Cf > 0 && Cs > 0 && Csa === 0 && Csb === 0) {
      // Bio/Assay ▸ Henderson–Hasselbalch is the same formula; quoting its number shows exactly how far it is off.
      const hh = hendersonHasselbalch(pKa[0], base ? Cf : Cs, base ? Cs : Cf);
      if (Number.isFinite(hh)) lines.push(`Henderson–Hasselbalch gives pH ${ph2(hh)}; the exact charge balance differs by ${num(Math.abs(hh - pH), 2)} pH units${Math.abs(hh - pH) > 0.05 ? " (the shortcut ignores the water and the acid's own dissociation, which matters when the buffer is dilute or the pKa is near 2 or 12)" : ""}.`);
    }
    lines.push(TITRATION_SOURCE);
    const figs: string[] = [];
    if (s.weak) figs.push(speciationSvg(pKa, base, pKw, pH));
    figs.push(bufferCapacitySvg(s, pH));
    const fig = combineSvgs(figs);
    return finish(lines, u.conversions, [
      plot(fig, s.weak ? "Speciation and buffer capacity, this solution marked" : "Buffer capacity of water with strong acid or base", "Species fractions and buffer capacity against pH with the solution's pH marked"),
    ]);
  },
};

// --------------------------------------------------------- cyclic voltammetry

const SCAN_UNITS = [
  { value: "V/s", label: "V/s" },
  { value: "mV/s", label: "mV/s" },
];

function readRates(text: string, unit: string): number[] | string {
  if (!(text ?? "").trim()) return "Give at least one scan rate.";
  const t = readTable(text, "Scan rates", { need: 1, optional: 49, cap: 50, singleColumn: true });
  if (typeof t === "string") return t;
  const parts = t.rows.flat();
  if (parts.length > 50 || t.notes.some((n) => /more columns/.test(n))) return "At most 50 scan rates.";
  const k = unit === "mV/s" ? 1e-3 : 1;
  const out: number[] = [];
  for (const v of parts) {
    if (!(v > 0)) return `Scan rate ${num(v)} is not above zero.`;
    out.push(v * k);
  }
  if (out.some((v) => v > 1e6)) return "A scan rate above 10⁶ V/s is beyond what the diffusion model (and any potentiostat) covers.";
  if (out.some((v) => v < 1e-6)) return "A scan rate below 1 µV/s is not a voltammetric sweep (natural convection takes over long before).";
  return out;
}

/** Reads n, A, C, D/T fields shared by the two CV tools. */
function readCell(r: (k: string) => string, u: ReturnType<typeof unitReader>, needD: boolean) {
  const n = plain(r("n"));
  const A = u.req("area", "cm^2", "Electrode area");
  // Bare numbers are M, as in every concentration field of this group (the titration and solution tools); the
  // Randles–Ševčík equation wants mol/cm³: 1 M = 10⁻³ mol/cm³.
  const C = u.req("c", "M", "Concentration") / 1000;
  const D = needD ? u.req("d", "cm^2/s", "Diffusion coefficient") : NaN;
  const tRaw = (r("t") ?? "").trim();
  const T = tRaw ? plain(tRaw) : 25;
  return { n, A, C, D, T };
}
function cellRefusal(c: { n: number; A: number; C: number; D: number; T: number }, needD: boolean): string | null {
  if (!(Number.isInteger(c.n) && c.n >= 1 && c.n <= 6)) return "n (electrons transferred) must be a whole number from 1 to 6.";
  if (!(c.A > 0 && c.A < 1e4)) return "The electrode area must be above zero (cm²).";
  if (!(c.C > 0 && c.C <= 0.02)) return "The concentration must be above zero and at most 20 M.";
  if (needD && !(c.D > 0 && c.D < 1)) return "The diffusion coefficient must be above zero (cm²/s; 10⁻⁵ is typical in water).";
  if (!(c.T > -273.15 && c.T < 1000)) return "Give the temperature in °C, above −273.15.";
  return null;
}

const cvCalc: ChemEngCalc = {
  id: "chem-cv-peak",
  name: "Cyclic voltammetry: Randles–Ševčík peak current",
  group: CHEM_ENG_GROUP,
  unitContract: "converts",
  hint:
    "A reversible, diffusion-controlled couple O + n e⁻ ⇌ R at a planar electrode: peak current ip = 0.4463·nFAC·√(nFvD/RT) " +
    "(at 25 °C, 2.69×10⁵·n·√n·A·C·√(Dv) with A in cm², C in mol/cm³, D in cm²/s, v in V/s; the temperature-dependent " +
    "form is used), peak separation ΔEp ≈ 2.218·RT/nF (57/n mV at 25 °C) and the peak potentials about E½. With E½ given, " +
    "the voltammogram itself is simulated by the convolution method (Nicholson–Shain current function), one curve per scan rate.",
  fields: [
    { key: "n", label: "Electrons n", default: "1", kind: "text" },
    { key: "area", label: "Electrode area (cm²; mm² converts)", default: "0.0707 cm²", kind: "text" },
    { key: "c", label: "Bulk concentration (M; mM converts)", default: "1 mM", kind: "text" },
    { key: "d", label: "Diffusion coefficient (cm²/s)", default: "7.6e-6 cm²/s", kind: "text" },
    { key: "rates", label: "Scan rates (separated by commas or spaces)", default: "25, 50, 100, 200", kind: "text" },
    { key: "vunit", label: "Scan-rate unit", default: "mV/s", kind: "select", options: SCAN_UNITS },
    { key: "ehalf", label: "E½ (V vs your reference; optional, for the simulated CV)", default: "0.25", kind: "text" },
    {
      key: "dir",
      label: "First sweep",
      default: "red",
      kind: "select",
      options: [
        { value: "red", label: "Reduction (O in solution, sweep negative)" },
        { value: "ox", label: "Oxidation (R in solution, sweep positive)" },
      ],
    },
    { key: "t", label: "Temperature (°C)", default: "25", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const c = readCell(r, u, true);
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const bad = cellRefusal(c, true);
    if (bad) return refuse(bad);
    const rates = readRates(r("rates"), r("vunit"));
    if (typeof rates === "string") return refuse(rates);
    const eRaw = (r("ehalf") ?? "").trim();
    const Ehalf = eRaw ? plain(eRaw) : null;
    if (Ehalf !== null && !(Math.abs(Ehalf) <= 5)) return refuse("E½ must be a number of volts between −5 and 5.");
    const ip = rates.map((v) => randlesSevcik(c.n, c.A, c.C, c.D, v, c.T));
    const { scale, unit } = currentUnit(Math.max(...ip));
    const pk = reversiblePeaks(c.n, c.T);
    const lines: string[] = [];
    lines.push(`Peak current ip = 0.4463·nFAC·√(nFvD/RT), n = ${c.n}, A = ${num(c.A, 4)} cm², C = ${fmtSig(c.C * 1000, 3)} M (${fmtSig(c.C, 3)} mol/cm³), D = ${fmtSig(c.D, 3)} cm²/s, ${num(c.T, 4)} °C:`);
    rates.forEach((v, i) => lines.push(`  v = ${num(v * 1000, 4)} mV/s: ip = ${num(ip[i] * scale, 4)} ${unit}`));
    lines.push(`Randles–Ševčík constant at ${num(c.T, 4)} °C: ${fmtSig(rsConstant(c.T), 4)} (2.69×10⁵ at 25 °C), so ip = ${fmtSig(rsConstant(c.T), 4)}·n·√n·A·C·√(Dv).`);
    lines.push(`Reversible peaks: ΔEp = 2.218·RT/nF = ${num(pk.deltaEp * 1000, 3)} mV (rising toward ${num((2.3 * thermalVoltage(c.T) * 1000) / c.n, 3)} mV if the sweep is reversed close to the peak); each peak ${num(pk.epOffset * 1000, 3)} mV from E½; |Ep − Ep/2| = ${num((2.2 * thermalVoltage(c.T) * 1000) / c.n, 3)} mV.`);
    const figs: string[] = [rsLineSvg(rates, ip)];
    if (Ehalf !== null) {
      const red = r("dir") !== "ox";
      lines.push(`Ep,c = ${num(Ehalf - pk.epOffset, 4)} V and Ep,a = ${num(Ehalf + pk.epOffset, 4)} V (E½ = ${num(Ehalf, 4)} V, taken as E°′: D(O) = D(R) assumed).`);
      const span = Math.max(0.3, (12 * thermalVoltage(c.T)) / c.n);
      const sims: Array<{ v: number; sim: CvSim }> = [];
      for (const v of rates.slice(0, 6)) {
        const sim = simulateReversibleCv({ n: c.n, E0: Ehalf, Estart: Ehalf + (red ? span : -span), Eswitch: Ehalf - (red ? span : -span), v, D: c.D, A: c.A, C: c.C, tC: c.T, steps: 1000 });
        if (typeof sim === "string") return refuse(`Cannot simulate: ${sim}.`);
        sims.push({ v, sim });
      }
      const s0 = sims[0].sim;
      lines.push(
        `Simulated (convolution, ${num(span * 1000, 3)} mV either side of E½): at ${num(sims[0].v * 1000, 4)} mV/s the forward peak is ${num(Math.abs(s0.forward.i) * scale, 4)} ${unit} at ${num(s0.forward.E, 4)} V, the reverse ${num(Math.abs(s0.reverse.i) * scale, 4)} ${unit} at ${num(s0.reverse.E, 4)} V (ΔEp = ${num(Math.abs(s0.reverse.E - s0.forward.E) * 1000, 3)} mV; the reverse peak is read from zero current, not from the decaying forward baseline).`,
      );
      if (rates.length > 6) lines.push("The figure draws the first six scan rates.");
      figs.push(cvSimSvg(sims));
    } else lines.push("Give E½ to simulate the voltammogram itself.");
    lines.push("Model: reversible (Nernstian) electron transfer, semi-infinite linear diffusion to a planar electrode, no double-layer charging or iR drop. At a microelectrode (radius under about 25 µm) or slow scans, radial diffusion adds a steady-state current this does not include.");
    lines.push(`${CONSTANTS_SOURCE} Randles–Ševčík and the current function: Nicholson & Shain, Anal. Chem. 36 (1964) 706; Bard & Faulkner, Electrochemical Methods, 2nd ed., §6.2 and §6.7.`);
    const fig = combineSvgs(figs);
    return finish(lines, u.conversions, [plot(fig, Ehalf !== null ? "Randles–Ševčík line and simulated reversible voltammograms" : "Randles–Ševčík line", "Peak current against the square root of scan rate" + (Ehalf !== null ? ", over simulated cyclic voltammograms" : ""))]);
  },
};

const IP_UNITS = [
  { value: "uA", label: "µA" },
  { value: "nA", label: "nA" },
  { value: "mA", label: "mA" },
  { value: "A", label: "A" },
];
const IP_SCALE: Record<string, [number, string]> = { A: [1, "A"], mA: [1e-3, "mA"], uA: [1e-6, "µA"], nA: [1e-9, "nA"] };

const rsCalc: ChemEngCalc = {
  id: "chem-cv-randles",
  name: "Randles–Ševčík analysis (D from ip against √v)",
  group: CHEM_ENG_GROUP,
  unitContract: "converts",
  hint:
    "Paste scan rate and peak current, one pair per line (a third column, ΔEp in mV, is optional). ip is fitted against √v " +
    "by least squares, keeping the intercept; the slope gives the diffusion coefficient D = (slope / (0.4463·nFAC·√(nF/RT)))². " +
    "The intercept, R² and the slope of log ip against log v (0.5 for diffusion, 1 for an adsorbed layer) say whether the " +
    "wave is reversible and diffusion-controlled; a ΔEp growing with v says it is quasi-reversible.",
  fields: [
    { key: "data", label: "Scan rate, peak current (, ΔEp in mV)", default: "10 5.30 58\n25 8.25 58\n50 11.68 59\n100 16.62 59\n200 23.35 60\n400 33.20 60", kind: "block", rows: 6 },
    { key: "vunit", label: "Scan-rate unit", default: "mV/s", kind: "select", options: SCAN_UNITS },
    { key: "iunit", label: "Current unit", default: "uA", kind: "select", options: IP_UNITS },
    { key: "n", label: "Electrons n", default: "1", kind: "text" },
    { key: "area", label: "Electrode area (cm²; mm² converts)", default: "0.0707 cm²", kind: "text" },
    { key: "c", label: "Bulk concentration (M; mM converts)", default: "1 mM", kind: "text" },
    { key: "t", label: "Temperature (°C)", default: "25", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const c = readCell(r, u, false);
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const bad = cellRefusal(c, false);
    if (bad) return refuse(bad);
    const [iScale, iName] = IP_SCALE[r("iunit")] ?? IP_SCALE.uA;
    const vScale = r("vunit") === "V/s" ? 1 : 1e-3;
    const table = readTable(r("data"), "Scan rate, peak current data", { need: 2, optional: 1, cap: 500 });
    if (typeof table === "string") return refuse(table);
    const data: Array<[number, number]> = table.rows.map((row) => [row[0] * vScale, row[1] * iScale]);
    const dEp: number[] = table.rows.filter((row) => row.length >= 3).map((row) => row[2]);
    const res = randlesSevcikAnalysis(data, c.n, c.A, c.C, c.T);
    if (typeof res === "string") return refuse(`Cannot fit: ${res}.`);
    const lines: string[] = [...table.notes];
    lines.push(`|ip| = ${num(res.intercept / iScale, 4)} ${iName} + ${num(res.slope / iScale, 4)} ${iName} per √(V/s) × √v, ${r2Text(res.r2)} (${res.n} points).`);
    lines.push(`Diffusion coefficient D = ${fmtSig(res.D, 3)} cm²/s (n = ${c.n}, A = ${num(c.A, 4)} cm², C = ${fmtSig(c.C * 1000, 3)} M (${fmtSig(c.C, 3)} mol/cm³), ${num(c.T, 4)} °C).`);
    lines.push(`log ip against log v: slope ${res.logSlope.toFixed(3)} (0.5 for a diffusing species, 1 for an adsorbed one).`);
    if (dEp.length && dEp.length === data.length) {
      const rev = (2.218 * thermalVoltage(c.T) * 1000) / c.n;
      const mean = dEp.reduce((a, b) => a + b, 0) / dEp.length;
      const sorted = data.map(([v], i) => [v, dEp[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
      const rise = sorted[sorted.length - 1][1] - sorted[0][1];
      lines.push(`ΔEp: mean ${num(mean, 3)} mV against ${num(rev, 3)} mV for a reversible ${c.n}-electron couple; it ${rise > 0 ? "rises" : "changes"} by ${num(rise, 3)} mV across the scan rates.`);
      if (mean > 1.2 * rev || rise > 10) res.flags.push("ΔEp is larger than reversible or grows with scan rate: the electron transfer is quasi-reversible (or iR drop is uncompensated), so D from Randles–Ševčík is an estimate");
    } else if (dEp.length) lines.push("ΔEp was given on only some lines, so it is not used.");
    if (res.flags.length) for (const f of res.flags) lines.push(`Note: ${f}.`);
    else lines.push("ip is linear in √v through about zero: consistent with a reversible, diffusion-controlled wave.");
    lines.push("D is only as good as A (use the electrochemically active area) and C; the 0.4463 factor assumes a reversible wave, semi-infinite linear diffusion and a planar electrode.");
    lines.push(`${CONSTANTS_SOURCE} Randles–Ševčík: Nicholson & Shain, Anal. Chem. 36 (1964) 706; Bard & Faulkner, Electrochemical Methods, 2nd ed., §6.2.`);
    const fig = rsAnalysisSvg(data, res, 1 / iScale, iName);
    return finish(lines, u.conversions, [plot(fig, "Randles–Ševčík analysis", "Peak current against the square root of scan rate with the fit, over log peak current against log scan rate")]);
  },
};

/** The Chemistry & electrochemistry Engineering calculators, in dropdown order. */
export const TITRATION_CALCS: ChemEngCalc[] = [titrationCalc, speciationCalc, solutionCalc, cvCalc, rsCalc];
