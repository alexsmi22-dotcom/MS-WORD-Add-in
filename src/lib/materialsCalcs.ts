// Pane glue for the materials-testing and quality calculators: tensile test,
// Weibull strength, Scherrer crystallite size, process capability and
// tolerance stack-up. Kept OUT of taskpane.ts so the exact objects the pane
// registers can be tested (nothing can import the pane under jest).
//
// Each entry is shaped exactly like the pane's EngCalc (taskpane.ts): the
// pane spreads MATERIALS_CALCS into ENG_CALCS. No number is computed here
// that materialsTesting.ts (or the engine it reuses) does not own; this file
// adds the wording, the unit handling and the figures.
//
// THE RESULT TEXT NEVER CONTAINS AN EM DASH, "NaN" OR "Infinity", an ASCII
// hyphen as a minus, a caret or e-notation: numbers go through fmtSig (axis.ts:
// ×10ⁿ, U+2212) and every line through trueMinus (numberList.ts).

import type { EngUnitContract } from "./engCalc";
import { engReport, plainDashes, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput } from "./analyzeBlocks";
import { fmtSig, superscript } from "./axis";
import { trueMinus } from "./numberList";
import { minOf, maxOf } from "./minmax";
import { readDataBlock, type DataBlock } from "./dataBlock";
import { convert, parseMeasured } from "./units";
import { buildPlotSvg, type Point, type Series } from "./plot";
import { hBarSvg } from "./mechchart";
import { WAVELENGTHS, type WavelengthId } from "./solidform";
import { normalityTest } from "./diagnostics";
import { monteCarlo, mcHistogramSvg } from "./monteCarlo";
import { normalCdfPrecise } from "./probdist";
import {
  tensileTest,
  weibullStrength,
  weibullPf,
  scherrer,
  capability,
  toleranceStack,
  AUTO_WINDOW,
  MAX_ROWS,
  type Broadening,
  type PeakIn,
  type StackDim,
  type CapIndex,
} from "./materialsTesting";

// ------------------------------------------------------------------ types

/** The pane's AnalyzeField, structurally (taskpane.ts does not export it). */
export interface MatField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  rows?: number;
  options?: { value: string; label: string }[];
}
/** The ENG_GROUP_ORDER names these calculators use (all already exist in the pane). */
export type MatGroup = "Structural & solids" | "Fatigue & machine design" | "Reliability";
/** The pane's EngCalc, structurally. */
export interface MatCalc {
  id: string;
  name: string;
  group: MatGroup;
  hint: string;
  fields: MatField[];
  /** The unit contract this tool keeps (engCalc.ts EngUnitContract). */
  unitContract: EngUnitContract;
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

// ------------------------------------------------------------- formatting

/** Significant figures, ×10ⁿ outside 10⁻³…10⁶, U+2212. Callers pass finite values only. */
function f(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return "not finite";
  if (v === 0) return "0";
  return fmtSig(v, sig, 6);
}
/** A number as the user would have typed it (shortest round trip), ×10ⁿ only at the extremes. */
function plain(v: number): string {
  const a = Math.abs(v);
  if (!Number.isFinite(v)) return "not finite";
  if (a !== 0 && (a < 1e-3 || a >= 1e9)) return f(v, 6);
  const s = String(v);
  return /e/i.test(s) ? f(v, 6) : trueMinus(s);
}
/** A measured field as typed, echoed under the display contract ("1e-3 in^2" → "0.001 in²"). */
function typed(raw: string): string {
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/.exec(raw.trim());
  if (!m) return raw.trim();
  const unit = m[2].replace(/\^\s*(-?\d+)/g, (_s, n: string) => superscript(Number(n)));
  return `${plain(Number(m[1]))}${unit ? ` ${unit}` : ""}`;
}
/** Fixed decimals (a drawing's dimensions), ×10ⁿ only at the extremes. */
function fixed(v: number, dp: number): string {
  if (!Number.isFinite(v)) return "not finite";
  if (Math.abs(v) >= 1e12) return f(v, 6);
  const s = v.toFixed(dp);
  return trueMinus(/^-0(\.0*)?$/.test(s) ? s.slice(1) : s);
}
/** Decimals a typed value carries (String's shortest form), capped at 6. */
function decimalsOf(v: number): number {
  const s = String(Math.abs(v));
  const e = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (e) return Math.min(20, Math.max(0, (e[2]?.length ?? 0) - Number(e[3])));
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(20, s.length - i - 1);
}
/** A percentage with a space before %. */
function pct(frac: number, sig = 3): string {
  return `${f(frac * 100, sig)} %`;
}
/** A small parts-per-million figure. */
function ppmText(ppm: number): string {
  if (ppm === 0) return "0 ppm";
  if (ppm < 0.001) return "below 0.001 ppm";
  return `${f(ppm, 3)} ppm`;
}
const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(plainDashes(text)), ok: false });
function report(lines: EngLine[], plots: AnalyzeBlock[]): AnalyzeOutput {
  return engReport(lines.map((l) => (typeof l === "string" ? trueMinus(l) : l)), plots);
}
function plot(svg: string, caption: string, alt: string, w: number, h: number): AnalyzeBlock {
  return { kind: "plot", svg, caption, alt, w, h };
}
/** The w/h an SVG declares (buildPlotSvg grows the canvas for legends and notes). */
function svgSize(svg: string, w: number, h: number): { w: number; h: number } {
  const mw = /<svg[^>]*\bwidth="([\d.]+)"/.exec(svg);
  const mh = /<svg[^>]*\bheight="([\d.]+)"/.exec(svg);
  return { w: mw ? Number(mw[1]) : w, h: mh ? Number(mh[1]) : h };
}
function plotOf(svg: string, caption: string, alt: string, w: number, h: number): AnalyzeBlock {
  const s = svgSize(svg, w, h);
  return plot(svg, caption, alt, s.w, s.h);
}

const UNIT_NOTE_CONVERT =
  "Units: a bare number is read in the unit that field names; write another unit " +
  "(50 mm, 0.5 in, 78.5 mm², 10 kN) and it is converted for you, and a unit of the " +
  "wrong quantity is refused rather than silently ignored.";
const TENSILE_UNIT_NOTE =
  "Units: the stress column is read in the unit chosen (MPa, GPa, psi or ksi, converted through the unit " +
  "system) and stresses are reported in it; E is reported in GPa (ksi for psi/ksi), energies per volume in " +
  "MJ/m³ (in·lbf/in³ for psi/ksi), and strain as % whichever strain column you chose.";
const UNIT_NOTE_SAME =
  "Units: whatever you type, used consistently; nothing is converted and nothing needs to be, " +
  "because every quantity here is the same kind and the answer comes back in the unit you went in with.";

// ---------------------------------------------------------------- parsing

const MINUS_RE = /[−–]/g;

/** One cell to a number: U+2212 accepted, empty/garbage → NaN. */
function cellNum(t: string): number {
  const s = t.trim().replace(MINUS_RE, "-").replace(/^\+/, "");
  if (!s) return NaN;
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) ? Number(s) : NaN;
}

/**
 * NUMBER BLOCKS follow RULE N, implemented once in dataBlock.readDataBlock
 * (separators, decimal commas vs points, European 1.234,5, headers, words
 * mixed with numbers): the tensile, Scherrer, Weibull and capability readers
 * call it and add only their own shape checks. A missing-value token (-, NA)
 * is refused here, because every one of these tools needs every value.
 */
function blockOf(text: string, what: string, lone: boolean): DataBlock | { error: string } {
  // RULE R1: the one-value-per-line lists (strengths, measurements) pass singleColumn, so "1234,5" on its own line is one
  // decimal-comma value; the multi-column tables never do.
  const b = readDataBlock(text, what, { maxRows: MAX_ROWS, loneCommaPairAmbiguous: lone, singleColumn: lone });
  if (!b.ok) return { error: b.error };
  // TRAILING empty cells (a row ending in tabs or semicolons, as spreadsheets export) are not values: they are
  // dropped before the column count. Only an INTERIOR empty cell, or a typed NA / - anywhere, is a missing value.
  const srcLines = text.replace(/\r\n?/g, "\n").split("\n");
  const sep = b.separator === "tab" ? "\t" : b.separator === "semicolon" ? ";" : null;
  if (sep) {
    for (let i = 0; i < b.rows.length; i++) {
      const cells = (srcLines[b.lines[i] - 1] ?? "").split(sep);
      let trailing = 0;
      for (let c = cells.length - 1; c >= 0 && cells[c].trim() === ""; c--) trailing++;
      const row = b.rows[i];
      while (trailing > 0 && row.length && row[row.length - 1] === null) {
        row.pop();
        trailing--;
      }
    }
  }
  for (let i = 0; i < b.rows.length; i++) {
    if (b.rows[i].some((v) => v === null)) {
      return { error: `${what}: line ${b.lines[i]} has a missing value; every value is needed here, so fill it in or delete the row.` };
    }
  }
  return b;
}

/** A numeric table of `min`–`max` columns. */
function numericTable(text: string, min: number, max: number, what: string): { data: number[][]; notes: string[]; header?: string[] | null } | { error: string } {
  const b = blockOf(text, what, false);
  if ("error" in b) return b;
  const out: number[][] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i] as number[];
    if (row.length < min || row.length > max) {
      return { error: `Line ${b.lines[i]}: expected ${min === max ? min : `${min}–${max}`} numbers (${what}), found ${row.length}.` };
    }
    out.push(row);
  }
  if (!out.length) return { error: `Enter the data: ${what}, one row per line.` };
  return { data: out, notes: b.notes, header: b.header };
}

/**
 * The stress unit a column header names ("stress MPa", "σ (GPa)", "Stress, ksi"), or null when it names none.
 * Longest first, so "MPa" is not read as "Pa" and "ksi" not as "psi".
 */
function headerStressUnit(cell: string | undefined): string | null {
  if (!cell) return null;
  const m = /(?:^|[^A-Za-z])(GPa|MPa|kPa|ksi|psi|N\/mm²|N\/mm\^2)(?![A-Za-z])/.exec(cell);
  if (!m) return null;
  return /^N\/mm/.test(m[1]) ? "MPa" : m[1];
}

/** A flat list of numbers in any separator. A lone "4,76" is refused as ambiguous (one decimal or two values). */
function numberList(text: string, what: string): { data: number[]; notes: string[] } | { error: string } {
  const b = blockOf(text, what, true);
  if ("error" in b) return b;
  const out = (b.rows as number[][]).flat();
  if (out.length > MAX_ROWS) return { error: `That is more than ${MAX_ROWS.toLocaleString("en-US")} values.` };
  return { data: out, notes: b.notes };
}

/**
 * The tolerance stack has WORDS on every line (a name, a sign), so it keeps its
 * own row parser; its NUMBERS go through RULE N all the same. Every number in
 * the stack is gathered into one block and read by readDataBlock, so the
 * decimal-mark decision (and any refusal of mixed marks) is the shared one,
 * then written back into the cells as plain dot-decimals.
 */
const STACK_NUM = /\d[\d.,]*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?/g;
/** A cell that can only be a number, a tolerance or a unit (never part of a name). */
const STACK_NUMERIC_CELL = /^(?:±|\+\/-)?\s*[+\-−]?(?:\d[\d.,]*|\.\d+)(?:[eE][+-]?\d+)?(?:\s*\/\s*[+\-−]?(?:\d[\d.,]*|\.\d+)(?:[eE][+-]?\d+)?)?\s*(?:mm|in|µm|μm|um)?$/i;
/**
 * The cells at the END of a stack line that hold its numbers: walking left from
 * the last cell over unit and numeric cells (at most three numbers: a nominal
 * and a one- or two-cell tolerance), stopping at a lone sign or a word. The
 * name to the left is never touched, so "O-ring 2-014" and "Part 007 rev 1.10"
 * are echoed exactly as typed.
 */
function numericTail(cells: string[]): number {
  let i = cells.length;
  let nums = 0;
  if (i > 0 && STACK_UNIT.test(cells[i - 1])) i--;
  while (i > 0) {
    const c = cells[i - 1];
    if (c === "±" || c === "+/-") i--; // "± 0.10" typed with a space
    else if (nums < 3 && STACK_NUMERIC_CELL.test(c)) {
      i--;
      nums++;
    } else break;
  }
  return i;
}
function stackRows(
  text: string,
): { rows: { cells: string[]; orig: string[]; line: number }[]; notes: string[] } | { error: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > MAX_ROWS + 1) return { error: `That is more than ${MAX_ROWS.toLocaleString("en-US")} rows.` };
  const tabbed = lines.some((l) => l.includes("\t"));
  const semi = !tabbed && lines.some((l) => l.includes(";"));
  const rows: { cells: string[]; orig: string[]; line: number; tail: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const orig = (tabbed ? l.split("\t") : semi ? l.split(";") : l.split(/,\s+|\s+/)).map((c) => c.trim()).filter((c) => c !== "");
    const cells = orig.map((c) => c.replace(MINUS_RE, "−"));
    rows.push({ cells, orig, line: i + 1, tail: numericTail(cells) });
  }
  // Only the numeric tail of each line feeds the shared reader (a name's digits are not data).
  const tokens: string[] = [];
  for (const r of rows) for (let c = r.tail; c < r.cells.length; c++) for (const m of r.cells[c].match(STACK_NUM) ?? []) tokens.push(m.replace(/[.,]$/, ""));
  if (!tokens.length) return { rows, notes: [] };
  const b = readDataBlock(tokens.join("\t"), "Stack numbers", { maxRows: MAX_ROWS });
  if (!b.ok) return { error: b.error };
  const values = (b.rows as (number | null)[][]).flat();
  if (b.header || values.length !== tokens.length || values.some((v) => v === null)) {
    return { error: "A number in the stack could not be read; write each nominal and tolerance as a plain number (50.00, ±0.10)." };
  }
  let k = 0;
  for (const r of rows) {
    r.cells = r.cells.map((c, ci) =>
      ci < r.tail
        ? c
        : c.replace(STACK_NUM, (m) => {
            const trail = /[.,]$/.test(m) ? m.slice(-1) : "";
            const v = values[k++] as number;
            return String(v) + trail;
          }),
    );
  }
  // The block notes name "Stack numbers"; only a decimal-comma reading is worth repeating.
  return { rows, notes: b.notes.filter((n) => /comma/i.test(n)) };
}

/** A header row (stack): none of its fields reads as a number. */
const isHeader = (cells: string[]): boolean => !cells.some((c) => Number.isFinite(cellNum(c)));
const headerNote = (cells: string[]): string => `The first line (“${cells.join(" ").slice(0, 60)}”) was read as a column header.`;


/** An optional plain number field: null when blank, NaN when unreadable. */
function optNum(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  return cellNum(t);
}


// ------------------------------------------------------------- 1. tensile

const STRESS_UNITS = [
  { value: "MPa", label: "MPa" },
  { value: "GPa", label: "GPa" },
  { value: "psi", label: "psi" },
  { value: "ksi", label: "ksi" },
];

/** MPa per one of the user's stress unit, from units.ts. */
function toMPa(unit: string): number | null {
  const k = convert(1, unit, "MPa");
  return k !== null && Number.isFinite(k) && k > 0 ? k : null;
}

const TENSILE_DEFAULT = [
  "strain %\tstress MPa",
  "0\t0",
  "0.0357\t25",
  "0.0714\t50",
  "0.1072\t75",
  "0.1431\t100",
  "0.1804\t125",
  "0.2240\t150",
  "0.2888\t175",
  "0.4146\t200",
  "0.6183\t220",
  "0.8861\t235",
  "1.3177\t250",
  "1.8391\t262",
  "2.4406\t272",
  "3.1519\t281",
  "3.9539\t289",
  "4.8151\t296",
  "5.6930\t302",
  "6.5382\t307",
  "7.2976\t311",
  "7.9203\t314",
  "11.5\t313",
  "12.5\t308",
  "13.4\t298",
  "14.1\t282",
].join("\n");

const tensileCalc: MatCalc = {
  id: "mat-tensile",
  name: "Tensile test: modulus, 0.2 % yield, UTS",
  group: "Structural & solids",
  unitContract: "converts",
  hint:
    "Paste the curve as two columns in test order: strain then stress, or extension then load with the gauge length " +
    "and area. The modulus is a straight-line fit over the elastic region (automatically the rising curve between " +
    "10 % and 40 % of the maximum stress, or a strain window you give); the offset yield is where the line shifted " +
    "by the offset meets the curve. Stresses are ENGINEERING stresses (original area). When there is no straight elastic " +
    "region, the modulus and everything built on it (offset yield, plastic strains, resilience) are reported as not " +
    "determined rather than guessed; UTS, elongations and toughness are always reported.",
  fields: [
    {
      key: "mode",
      label: "Data columns",
      default: "ss",
      kind: "select",
      options: [
        { value: "ss", label: "strain, stress" },
        { value: "le", label: "extension, load" },
      ],
    },
    { key: "data", label: "One row per line (Use table at cursor works)", default: TENSILE_DEFAULT, kind: "block", rows: 10 },
    {
      key: "strainUnit",
      label: "Strain column (strain, stress mode)",
      default: "pct",
      kind: "select",
      options: [
        { value: "pct", label: "% (percent)" },
        { value: "frac", label: "mm/mm (dimensionless)" },
      ],
    },
    { key: "stressUnit", label: "Stress unit (of the column, and of the report)", default: "MPa", kind: "select", options: STRESS_UNITS },
    {
      key: "loadUnit",
      label: "Load column (extension, load mode)",
      default: "kN",
      kind: "select",
      options: [
        { value: "N", label: "N" },
        { value: "kN", label: "kN" },
        { value: "lbf", label: "lbf" },
        { value: "kip", label: "kip" },
      ],
    },
    {
      key: "extUnit",
      label: "Extension column (extension, load mode)",
      default: "mm",
      kind: "select",
      options: [
        { value: "mm", label: "mm" },
        { value: "in", label: "in" },
      ],
    },
    { key: "gauge", label: "Gauge length L₀ (extension, load mode), mm", default: "50 mm", kind: "text" },
    { key: "area", label: "Original cross-section A₀ (extension, load mode), mm²", default: "78.54 mm²", kind: "text" },
    { key: "offset", label: "Offset for the proof stress, % strain", default: "0.2", kind: "text" },
    { key: "window", label: "Elastic strain window, as % strain, or mm/mm when the strain column is mm/mm (blank = automatic), e.g. 0.05–0.15", default: "", kind: "text" },
  ],
  compute: (r) => {
    const mode = r("mode") === "le" ? "le" : "ss";
    const sUnit = r("stressUnit") || "MPa";
    const kOut = toMPa(sUnit);
    if (kOut === null) return refuse(`"${sUnit}" is not a stress unit this tool reads.`);
    const tblR = numericTable(r("data"), 2, 2, mode === "ss" ? "strain and stress" : "extension and load");
    if ("error" in tblR) return refuse(tblR.error);
    const tbl = tblR.data;
    let strain: number[];
    let stress: number[];
    let strainPct: boolean;
    const conv: string[] = [];
    if (mode === "ss") {
      // A header that names a stress unit must agree with the unit selected: "stress MPa" read as GPa is a factor of
      // 1000 in every number, so the conflict is refused rather than one side guessed.
      const hU = headerStressUnit(tblR.header?.[1]);
      if (hU !== null && hU !== sUnit) {
        return refuse(
          `The stress column header says ${hU} ("${tblR.header?.[1]}"), but the stress unit selected is ${sUnit}. ` +
            `Choose ${hU} as the stress unit, or correct the header.`,
        );
      }
      strainPct = r("strainUnit") !== "frac";
      strain = tbl.map((row) => (strainPct ? row[0] / 100 : row[0]));
      stress = tbl.map((row) => row[1] * kOut);
    } else {
      strainPct = true;
      const L = parseMeasured(r("gauge"), "mm");
      if ("error" in L) return refuse(`Gauge length: ${L.error}`);
      const A = parseMeasured(r("area"), "mm^2");
      if ("error" in A) return refuse(`Area: ${A.error}`);
      if (!(L.inTarget > 0) || !(A.inTarget > 0)) return refuse("The gauge length and the area must both be greater than zero.");
      if (!A.assumed) conv.push(`Area: ${typed(r("area"))} = ${f(A.inTarget, 6)} mm²`);
      if (!L.assumed) conv.push(`Gauge length: ${typed(r("gauge"))} = ${f(L.inTarget, 6)} mm`);
      const kF = convert(1, r("loadUnit") || "N", "N");
      const kX = convert(1, r("extUnit") || "mm", "mm");
      if (kF === null || kX === null) return refuse("The load or extension unit is not one this tool reads.");
      strain = tbl.map((row) => (row[0] * kX) / L.inTarget);
      stress = tbl.map((row) => (row[1] * kF) / A.inTarget); // N/mm² = MPa
    }
    const offRaw = cellNum(r("offset") || "0.2");
    if (!Number.isFinite(offRaw) || offRaw < 0) return refuse("The offset must be a percentage strain such as 0.2.");
    let window: { lo: number; hi: number } | undefined;
    const wRaw = r("window").trim();
    if (wRaw) {
      // "0.05–0.15", "0.05 - 0.15", "0.05-0.15", "0.05 to 0.15", "0.05 0.15" (strains are not negative).
      const norm = wRaw.replace(/,/g, " ").replace(/(\d|\.)\s*[-–]\s*(?=[\d.])/g, "$1 ").replace(/\s+to\s+/gi, " ");
      const m = /^\s*(\S+)\s+(\S+)\s*$/.exec(norm);
      const lo = m ? cellNum(m[1]) : NaN;
      const hi = m ? cellNum(m[2]) : NaN;
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) {
        return refuse('The strain window is two strains, lower then upper, such as "0.05–0.15".');
      }
      const k = mode === "ss" && !strainPct ? 1 : 0.01;
      window = { lo: lo * k, hi: hi * k };
    }
    const res = tensileTest({ strain, stress, offset: offRaw / 100, window });
    if (!res.ok) return refuse(res.error);

    const S = (mpa: number, sig = 4): string => `${f(mpa / kOut, sig)} ${sUnit}`;
    const us = sUnit === "psi" || sUnit === "ksi";
    const modOf = (E: number): string => (us ? `${f(E / (toMPa("ksi") as number), 4)} ksi` : `${f(E / 1000, 4)} GPa`);
    // MPa × (mm/mm) = MJ/m³; psi × (in/in) = in·lbf/in³.
    const energy = (mpa: number): string =>
      us ? `${f(mpa / (toMPa("psi") as number), 4)} in·lbf/in³` : `${f(mpa, 4)} MJ/m³`;
    const eText = (e: number): string => pct(e, 4);
    const mod = res.modulus;
    const oy = res.offsetYield;
    const yd = res.yieldDrop;
    const lines: EngLine[] = ["Tensile test (engineering stress and strain)", ""];
    // RULE T: anything built on E prints "not determined (reason)" when the modulus was withheld.
    const nd = `not determined (${res.withheld ?? "no modulus"})`;
    if (mod) {
      lines.push(
        `  Young's modulus E        ${modOf(mod.E)}   (R² = ${mod.r2.toFixed(5)}, ${mod.points} points${mod.curved ? "; chord over a slightly curved region" : ""})`,
        `  Elastic region           ${mod.windowRule}, strain ${eText(mod.windowLo)} to ${eText(mod.windowHi)}`,
      );
    } else {
      lines.push(`  Young's modulus E        ${nd}`);
    }
    // A detected yield drop is the headline; the offset value follows it, for comparison.
    if (yd) {
      lines.push(
        `  Yield drop               upper ${S(yd.upper)} at strain ${eText(yd.upperStrain)}, lower ${S(yd.lower)} at strain ${eText(yd.lowerStrain)}`,
        "                           (for metals these are ReH and ReL, ISO 6892-1; for plastics ISO 527 reports the yield stress σy at the peak)",
        `  Yield-drop elongation    ${eText(yd.elongation)}   (Ae for metals)`,
      );
    }
    lines.push(
      !mod
        ? `  ${plain(offRaw)} % offset yield     ${nd}`
        : oy
          ? `  ${plain(offRaw)} % offset yield     ${S(oy.stress)}   at strain ${eText(oy.strain)}${yd ? "   (for comparison)" : ""}`
          : `  ${plain(offRaw)} % offset yield     none (the offset line never meets the curve)`,
    );
    const plasticText = (p: number | null): string => (p === null ? `plastic ${nd}` : `${eText(p)} plastic`);
    lines.push(
      `  Ultimate strength UTS    ${S(res.uts)}   at strain ${eText(res.utsStrain)}`,
      "",
      `  Uniform elongation       ${eText(res.uniformTotal)} total, ${plasticText(res.uniformPlastic)} (at UTS)`,
      `  Elongation at fracture   ${eText(res.fractureTotal)} total, ${plasticText(res.fracturePlastic)} (row ${res.rowsUsed})`,
      `  Toughness (area)         ${energy(res.toughness)}`,
    );
    if (!mod) {
      lines.push(`  Modulus of resilience    ${nd}`, `  Yield ratio σy/UTS       ${nd}`);
    } else if (res.resilience !== null && oy) {
      lines.push(`  Modulus of resilience    ${energy(res.resilience)}   (σy²/2E, offset yield)`);
      lines.push(`  Yield ratio σy/UTS       ${f(oy.stress / res.uts, 3)}`);
    }
    if (yd && mod) {
      lines.push(`  Resilience from lower    ${energy((yd.lower * yd.lower) / (2 * mod.E))}   (lower yield²/2E)`);
      lines.push(`  Yield ratio lower/UTS    ${f(yd.lower / res.uts, 3)}`);
    }

    lines.push(
      "",
      "Method: E is the least-squares slope of stress on strain over the elastic region; the offset line is that line " +
        `shifted by ${plain(offRaw)} % strain, and the yield is its first crossing of the curve, by linear interpolation ` +
        "between rows. Toughness is the trapezoid area under the curve to fracture; plastic strains subtract the elastic " +
        "recovery σ/E along the modulus line. Fracture is the last row, after dropping only a terminal run of rows below 10 % of " +
        "the UTS (a machine logging after the break). Straightness of the elastic region is judged by a quadratic fit; a slope change " +
        "of 5–15 % across it is reported with a caveat; past 15 % there is no linear elastic region and everything built on E is not determined.",
    );
    if (yd) {
      lines.push(
        "Yield drop: considered only at the end of the elastic region (the peak within 0.5 % plastic strain of the modulus line); " +
          "the first fall of at least 3 % of the peak and eight noise SDs of the elastic fit that stays down for 3 rows and then " +
          "recovers at least halfway. Lower: the lowest stress before that recovery; elongation: from the peak to the last row " +
          "within a quarter of the drop above the lower value. Later serrations are not read.",
      );
    }
    if (res.jitter) lines.push(`Note: the strain stepped back slightly at ${res.jitter} row(s) (within 0.1 % of the range, read as noise).`);
    for (const n of res.notes) lines.push(`Note: ${n}`);
    for (const n of tblR.notes) lines.push(`Note: ${n}`);
    lines.push(
      "Note: an extensometer is needed for a modulus to standard (ASTM E111, ISO 6892-1); a modulus from crosshead " +
        "travel includes machine compliance and reads low.",
    );
    if (conv.length) lines.push("", "Units read", ...conv.map((c) => `  ${c}`));
    lines.push(mode === "le" ? UNIT_NOTE_CONVERT : TENSILE_UNIT_NOTE);

    // Figure, in the user's units, strain in %.
    const k = 1 / kOut;
    strain = strain.slice(0, res.rowsUsed);
    stress = stress.slice(0, res.rowsUsed);
    // DRAWN curve thinned to about 2 000 points (every row still went into the
    // numbers): a 100 000-point polyline is a multi-megabyte picture in Word.
    // The first, last and maximum-stress rows are always kept.
    const stride = Math.max(1, Math.ceil(strain.length / 2000));
    let iMax = 0;
    for (let i = 1; i < stress.length; i++) if (stress[i] > stress[iMax]) iMax = i;
    const curve: Point[] = [];
    for (let i = 0; i < strain.length; i++) {
      if (i % stride === 0 || i === iMax || i === strain.length - 1) curve.push({ x: strain[i] * 100, y: stress[i] * k });
    }
    const W = 420;
    const H = 280;
    const series: Series[] = [{ points: curve, type: "line", color: "#111111", label: "test curve" }];
    const yRef = oy ? oy.stress : yd ? yd.upper : res.uts * 0.6;
    const yTop = Math.min(res.uts, yRef * 1.25);
    if (mod) {
      const lineSeg = (shift: number): Point[] => [
        { x: ((0 - mod.intercept) / mod.E + shift) * 100, y: 0 },
        { x: ((yTop - mod.intercept) / mod.E + shift) * 100, y: yTop * k },
      ];
      series.push({ points: lineSeg(0), type: "line", color: "#2563eb", label: `${mod.curved ? "chord" : "modulus"} ${modOf(mod.E)}` });
      series.push({ points: lineSeg(offRaw / 100), type: "line", color: "#9ca3af", label: `${plain(offRaw)} % offset` });
    }
    if (oy) series.push({ points: [{ x: oy.strain * 100, y: oy.stress * k }], type: "scatter", color: "#b91c1c", label: `yield ${S(oy.stress, 3)}` });
    if (yd) {
      series.push({
        points: [
          { x: yd.upperStrain * 100, y: yd.upper * k },
          { x: yd.lowerStrain * 100, y: yd.lower * k },
        ],
        type: "scatter",
        color: "#7c3aed",
        label: "yield drop",
      });
    }
    const svg = buildPlotSvg([...series, { points: [{ x: res.utsStrain * 100, y: res.uts * k }], type: "scatter", color: "#15803d", label: `UTS ${S(res.uts, 3)}` }], {
      width: W,
      height: H,
      xlabel: "Engineering strain (%)",
      ylabel: `Engineering stress (${sUnit})`,
      title: "Stress–strain curve",
    });
    const blocks: AnalyzeBlock[] = [
      // Caption and alt text name only what is actually drawn.
      plotOf(
        svg,
        mod
          ? `Stress–strain curve with the ${mod.curved ? "chord" : "modulus"} line, the offset line${oy ? ", the offset yield" : ""}${yd ? ", the yield drop" : ""} and the UTS`
          : "Stress–strain curve with the UTS (no modulus line: see the note on the elastic region)",
        mod
          ? `Engineering stress against strain with the fitted ${mod.curved ? "chord" : "modulus"} line, offset line${oy ? ", yield point" : ""}${yd ? ", yield-drop points" : ""} and ultimate strength marked`
          : "Engineering stress against strain with the ultimate strength marked",
        W,
        H,
      ),
    ];
    if (mod) {
      // The elastic region and yield are crowded at the origin of a full curve; a
      // second panel zooms to it so the offset construction can be read.
      const yStrainRef = oy ? oy.strain : yd ? yd.upperStrain : mod.windowHi;
      const zoomX = Math.min(maxOf(strain) * 100, Math.max(yStrainRef * 100 * 2.2, (offRaw / 100) * 300, mod.windowHi * 100 * 1.5));
      // The curve is cut AT the panel edge (interpolated), so nothing falls outside the limits.
      const zc: Point[] = [];
      for (let i = 0; i < curve.length; i++) {
        const p = curve[i];
        if (p.x <= zoomX) zc.push(p);
        else {
          const q = curve[i - 1];
          if (q && q.x < zoomX) zc.push({ x: zoomX, y: q.y + ((p.y - q.y) * (zoomX - q.x)) / (p.x - q.x) });
          break;
        }
      }
      const zoom: Series[] = [
        { ...series[0], points: zc },
        ...series.slice(1).map((sr) => ({ ...sr, points: sr.points.filter((p) => p.x <= zoomX) })).filter((sr) => sr.points.length),
      ];
      const zTop = maxOf(zoom.flatMap((s) => s.points.map((p) => p.y)), yTop * k) * 1.08;
      const svg2 = buildPlotSvg(zoom, {
        width: W,
        height: H,
        xlabel: "Engineering strain (%)",
        ylabel: `Engineering stress (${sUnit})`,
        title: "Elastic region and offset yield",
        // The modulus line starts at its own strain intercept, which a toe puts just below zero.
        xLimits: { min: minOf(zoom.flatMap((s) => s.points.map((p) => p.x)), 0), max: zoomX },
        yLimits: { min: minOf(zoom.flatMap((s) => s.points.map((p) => p.y)), 0), max: zTop },
      });
      blocks.push(
        plotOf(
          svg2,
          "Close-up of the elastic region and the offset construction",
          `The elastic part of the curve with the ${mod.curved ? "chord" : "modulus"} line and the parallel offset line${oy ? " crossing the curve at the yield point" : ", which does not meet the curve"}`,
          W,
          H,
        ),
      );
    }
    return report(lines, blocks);
  },
};


// --------------------------------------------------------- 2. Weibull strength

const weibullStrengthCalc: MatCalc = {
  id: "mat-weibull-strength",
  name: "Weibull modulus of strength (ceramics, fibres)",
  group: "Structural & solids",
  unitContract: "same-units",
  hint:
    "Paste the fracture strengths of nominally identical specimens. Two estimates are shown side by side: the " +
    "linearised median-rank regression (Bernard ranks, the Weibull-plot line) and maximum likelihood, the same fitter " +
    "as Reliability › Life data. The modulus m measures scatter: higher m means more predictable strength. Strengths are " +
    "your units and are not converted.",
  fields: [
    {
      key: "data",
      label: "Fracture strengths (any separator, one specimen each)",
      default: "312 334 351 362 371 380 387 393 399 405\n411 417 424 430 437 445 454 465 480 502",
      kind: "block",
      rows: 6,
    },
    { key: "unit", label: "Unit of the strengths (label only)", default: "MPa", kind: "select", options: [...STRESS_UNITS, { value: "N", label: "N (load)" }] },
    { key: "at", label: "Probability of failure at this stress (blank to skip)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const listR = numberList(r("data"), "Strengths");
    if ("error" in listR) return refuse(listR.error);
    const list = listR.data;
    const u = r("unit") || "MPa";
    const res = weibullStrength(list);
    if (!res.ok) return refuse(res.error);
    const at = optNum(r("at"));
    if (at !== null && !(Number.isFinite(at) && at >= 0)) return refuse("The stress for the failure probability must be a number of zero or more.");
    const ci =
      res.mle.mLow !== null && res.mle.mHigh !== null
        ? `${f(res.mle.mLow, 3)} to ${f(res.mle.mHigh, 3)}`
        : "not resolved from this data";
    const lines: EngLine[] = [
      `Weibull strength, ${res.n} specimens`,
      "",
      "  Median-rank regression (Bernard F = (i − 0.3)/(n + 0.4); ln ln(1/(1 − F)) regressed on ln σ)",
      `    Weibull modulus m          ${f(res.reg.m, 4)}`,
      `    Characteristic strength σ₀ ${f(res.reg.sigma0, 4)} ${u}   (R² = ${res.reg.r2.toFixed(4)})`,
      "",
      "  Maximum likelihood (not corrected for small-sample bias)",
      `    Weibull modulus m          ${f(res.mle.m, 4)}   (95 % likelihood-ratio interval ${ci})`,
      `    Characteristic strength σ₀ ${f(res.mle.sigma0, 4)} ${u}`,
    ];
    if (at !== null) {
      lines.push(
        "",
        `  Probability of failure at ${f(at, 4)} ${u}:  ${pct(weibullPf(at, res.mle.m, res.mle.sigma0), 3)} (maximum likelihood), ` +
          `${pct(weibullPf(at, res.reg.m, res.reg.sigma0), 3)} (regression)`,
      );
    }
    lines.push(
      "",
      "Note: σ₀ is the stress at which 63.2 % of specimens of THIS size and loading fail; strength depends on the " +
        "stressed volume or area, so it does not transfer to another geometry without a size-scaling step.",
      "Note: the ceramic-strength practice ASTM C1239 specifies maximum likelihood with a small-sample unbiasing " +
        "factor on m. That factor is NOT applied here, so the maximum-likelihood m above reads somewhat high for small n.",
    );
    if (res.n < 30) lines.push(`Note: ${res.n} specimens; with a sample this small m is uncertain, so read the interval rather than the point estimate.`);
    for (const n of listR.notes) lines.push(`Note: ${n}`);
    lines.push(UNIT_NOTE_SAME);

    const pts: Point[] = res.sorted.map((s, i) => ({ x: Math.log(s), y: Math.log(-Math.log(1 - res.F[i])) }));
    const x0 = pts[0].x;
    const x1 = pts[pts.length - 1].x;
    const lineOf = (m: number, s0: number): Point[] => [
      { x: x0, y: m * (x0 - Math.log(s0)) },
      { x: x1, y: m * (x1 - Math.log(s0)) },
    ];
    const W = 420;
    const H = 280;
    const svg = buildPlotSvg(
      [
        { points: pts, type: "scatter", color: "#2563eb", label: "specimens" },
        { points: lineOf(res.reg.m, res.reg.sigma0), type: "line", color: "#111111", label: `regression m = ${f(res.reg.m, 3)}` },
        { points: lineOf(res.mle.m, res.mle.sigma0), type: "line", color: "#b91c1c", label: `MLE m = ${f(res.mle.m, 3)}` },
      ],
      { width: W, height: H, xlabel: `ln σ  (σ in ${u})`, ylabel: "ln ln(1/(1 − F))", title: "Weibull plot: straight means Weibull" },
    );
    return report(lines, [
      plotOf(svg, "Weibull plot of the strengths with the regression and maximum-likelihood lines; the slope is the Weibull modulus", "Weibull probability plot of fracture strengths with two fitted straight lines", W, H),
    ]);
  },
};

// --------------------------------------------------------------- 3. Scherrer

const LAMBDA_OPTIONS = [
  ...(Object.keys(WAVELENGTHS) as WavelengthId[]).map((k) => ({ value: k, label: WAVELENGTHS[k].name })),
  { value: "custom", label: "other (enter below)" },
];

const scherrerCalc: MatCalc = {
  id: "mat-scherrer",
  name: "Crystallite size: Scherrer and Williamson–Hall",
  group: "Structural & solids",
  unitContract: "converts",
  hint:
    "One XRD peak per line: 2θ and FWHM, both in degrees 2θ (an optional third column is that peak's instrumental FWHM). " +
    "τ = Kλ/(β cos θ) with β the sample broadening in radians. Instrumental broadening is subtracted in quadrature " +
    "(Gaussian profiles, the default) or linearly (Lorentzian). With three or more peaks a Williamson–Hall fit separates " +
    "size from microstrain. Scherrer sizes are a LOWER bound and lose meaning above about 100–200 nm.",
  fields: [
    {
      key: "peaks",
      label: "2θ (°)  FWHM (°)  [instrumental FWHM (°)]",
      default: "28.44\t0.250\n47.30\t0.290\n56.12\t0.320\n69.13\t0.370\n76.37\t0.410",
      kind: "block",
      rows: 6,
    },
    { key: "inst", label: "Instrumental FWHM, ° 2θ (from a standard such as LaB₆; blank = none)", default: "0.08", kind: "text" },
    {
      key: "mode",
      label: "Instrumental correction",
      default: "gauss",
      kind: "select",
      options: [
        { value: "gauss", label: "Gaussian: β² = β²obs − β²inst (default)" },
        { value: "lorentz", label: "Lorentzian: β = βobs − βinst" },
        { value: "none", label: "none (observed FWHM used as is)" },
      ],
    },
    { key: "K", label: "Shape factor K", default: "0.9", kind: "text" },
    { key: "lambda", label: "Wavelength λ", default: "CuKa1", kind: "select", options: LAMBDA_OPTIONS },
    { key: "lambdaCustom", label: "Other wavelength (when chosen above), Å", default: "", kind: "text" },
  ],
  compute: (r) => {
    const tblR = numericTable(r("peaks"), 2, 3, "2θ, FWHM and optionally the instrumental FWHM");
    if ("error" in tblR) return refuse(tblR.error);
    const tbl = tblR.data;
    const instRaw = optNum(r("inst"));
    if (instRaw !== null && !Number.isFinite(instRaw)) return refuse("The instrumental FWHM is not a number.");
    const mode = (["gauss", "lorentz", "none"].includes(r("mode")) ? r("mode") : "gauss") as Broadening;
    const K = cellNum(r("K") || "0.9");
    let lambda: number;
    let lambdaName: string;
    const lid = r("lambda") || "CuKa1";
    const conv: string[] = [];
    if (lid === "custom") {
      const m = parseMeasured(r("lambdaCustom"), "Å");
      if ("error" in m) return refuse(`Wavelength: ${m.error}`);
      lambda = m.inTarget;
      lambdaName = `${f(lambda, 6)} Å`;
      if (!m.assumed) conv.push(`Wavelength: ${typed(r("lambdaCustom"))} = ${f(lambda, 6)} Å`);
    } else {
      const w = WAVELENGTHS[lid as WavelengthId];
      if (!w) return refuse("Choose a wavelength.");
      lambda = w.a;
      lambdaName = `${w.radiation}, ${w.a} Å`;
    }
    const peaks: PeakIn[] = tbl.map((row) => ({ twoTheta: row[0], fwhm: row[1], inst: row.length > 2 ? row[2] : undefined }));
    const res = scherrer(peaks, { K, lambda, instrument: instRaw ?? 0, mode });
    if (!res.ok) return refuse(res.error);
    // Past 200 nm the sample broadening is lost next to the instrument's: a size there is a bound, not a measurement.
    const SIZE_CAP_A = 2000;
    const nm = (a: number): string => (a > SIZE_CAP_A ? "> 200 nm (beyond the method's range)" : `${f(a / 10, 3)} nm`);
    const modeText =
      mode === "gauss" ? "Gaussian quadrature, β² = β²obs − β²inst" : mode === "lorentz" ? "Lorentzian, β = βobs − βinst" : "none";
    const lines: EngLine[] = [
      `Crystallite size (Scherrer), K = ${f(K, 3)}, λ = ${lambdaName}`,
      `Instrumental correction: ${modeText}`,
      "",
      "  2θ (°)     FWHM obs (°)   inst (°)   β (°)     τ",
      ...res.peaks.map(
        (p) =>
          `  ${p.twoTheta.toFixed(2).padEnd(10)} ${f(p.fwhmObs, 3).padEnd(14)} ${f(p.inst, 3).padEnd(10)} ${f(p.beta, 3).padEnd(9)} ${nm(p.size)}`,
      ),
    ];
    const big = res.peaks.some((p) => p.size > 1000);
    if (res.wh) {
      const { fit, size, strain } = res.wh;
      lines.push(
        "",
        "  Williamson–Hall (β cos θ = Kλ/D + 4ε sin θ, β in radians)",
        size === null
          ? "    Size D                  not determinable: the intercept is zero or negative, so the broadening is all strain or noise"
          : `    Size D                  ${nm(size)}`,
        `    Microstrain ε           ${f(strain, 3)}   (${pct(strain, 3)})`,
        `    Fit                      R² = ${fit.r2.toFixed(4)}, ${fit.n} peaks`,
      );
      if (strain < 0) lines.push("Note: the W–H slope is negative, which no uniform strain produces; the peaks are probably broadened anisotropically or the FWHMs carry large errors.");
      if (fit.r2 < 0.8) lines.push("Note: the W–H points are far from a straight line; size and strain from this fit are not reliable.");
    } else {
      lines.push("", "A Williamson–Hall size/strain separation needs at least 3 peaks; Scherrer sizes only.");
    }
    lines.push(
      "",
      "Note: Scherrer gives a LOWER bound on the coherent-domain size (strain and defects also broaden peaks), and above about " +
        "100–200 nm the sample broadening is too small next to the instrument's to measure reliably.",
    );
    if (big) lines.push("Note: at least one size exceeds 100 nm; treat it as \"larger than about 100 nm\", not as a measurement.");
    lines.push("Note: K depends on the crystallite shape and on whether β is the FWHM or the integral breadth; 0.9 is the common FWHM choice for roughly spherical crystallites.");
    if (conv.length) lines.push("", "Units read", ...conv.map((c) => `  ${c}`));
    for (const n of tblR.notes) lines.push(`Note: ${n}`);
    lines.push("Units: angles in degrees 2θ and the wavelength in ångströms (write 0.15406 nm and it is converted); sizes are reported in nm.");

    const blocks: AnalyzeBlock[] = [];
    const bars = hBarSvg(
      res.peaks.map((p) => ({ name: `${p.twoTheta.toFixed(2)}° 2θ${p.size > SIZE_CAP_A ? " (> 200 nm)" : ""}`, value: Math.min(p.size, SIZE_CAP_A) / 10 })),
      { title: "Scherrer crystallite size per peak", unit: "nm", w: 420 },
    );
    blocks.push(plotOf(bars, "Scherrer crystallite size for each peak", "Horizontal bars of the crystallite size computed from each diffraction peak", 420, 160));
    if (res.wh) {
      const W = 420;
      const H = 280;
      const { fit, xs, ys } = res.wh;
      const lo = Math.min(0, ...xs);
      const hi = maxOf(xs) * 1.05;
      const svg = buildPlotSvg(
        [
          { points: xs.map((x, i) => ({ x, y: ys[i] * 1000 })), type: "scatter", color: "#2563eb", label: "peaks" },
          {
            points: [
              { x: lo, y: (fit.intercept + fit.slope * lo) * 1000 },
              { x: hi, y: (fit.intercept + fit.slope * hi) * 1000 },
            ],
            type: "line",
            color: "#b91c1c",
            label: "least-squares line",
          },
        ],
        { width: W, height: H, xlabel: "4 sin θ", ylabel: "β cos θ (10⁻³ rad)", title: "Williamson–Hall plot" },
      );
      blocks.push(plotOf(svg, "Williamson–Hall plot: the intercept gives the size, the slope the microstrain", "Williamson–Hall plot of beta cos theta against four sin theta with a fitted line", W, H));
    }
    return report(lines, blocks);
  },
};

// ---------------------------------------------------------- 4. capability

const CPK_DEFAULT = [
  "9.989 10.015 10.012 9.978 9.982",
  "9.995 10.017 10.005 10.021 9.969",
  "10.049 10.016 10.032 10.015 10.010",
  "10.009 10.016 9.996 9.997 10.014",
  "9.967 9.954 9.992 9.971 9.946",
  "9.994 10.001 9.986 9.980 10.011",
].join("\n");

function idxLines(name: string, pName: string, c: CapIndex, confPct: string): string[] {
  const out: string[] = [];
  out.push(`  ${pName.padEnd(5)} ${c.p === null ? "not defined (one-sided limit)" : f(c.p, 3)}`);
  if (c.upper !== null) out.push(`  ${name}u   ${f(c.upper, 3)}`);
  if (c.lower !== null) out.push(`  ${name}l   ${f(c.lower, 3)}`);
  out.push(`  ${name}k   ${f(c.k, 3)}   (${confPct} % interval ${f(c.kLow, 3)} to ${f(c.kHigh, 3)}, Bissell)`);
  out.push(`  expected out of spec   ${ppmText(c.ppm)}`);
  return out;
}

const capabilityCalc: MatCalc = {
  id: "qual-capability",
  name: "Process capability: Cp, Cpk, Pp, Ppk",
  group: "Reliability",
  unitContract: "same-units",
  hint:
    "Paste the measurements in production order and give the specification limits (one-sided is fine). Cp/Cpk use " +
    "the WITHIN-subgroup σ (R̄/d₂ with a subgroup size; for individuals the moving range MR̄/1.128), Pp/Ppk the overall standard deviation; a gap " +
    "between them means the process drifts between subgroups. Every index and ppm figure assumes a normal, stable " +
    "process; a normality check is reported alongside.",
  fields: [
    { key: "data", label: "Measurements (in time order; any separator)", default: CPK_DEFAULT, kind: "block", rows: 7 },
    { key: "lsl", label: "Lower specification limit LSL (blank if none)", default: "9.90", kind: "text" },
    { key: "usl", label: "Upper specification limit USL (blank if none)", default: "10.10", kind: "text" },
    { key: "target", label: "Target (blank = none; drawn only)", default: "10.00", kind: "text" },
    { key: "subgroup", label: "Subgroup size, consecutive values (blank or 1 = individuals)", default: "5", kind: "text" },
    {
      key: "conf",
      label: "Confidence for the Cpk interval",
      default: "0.95",
      kind: "select",
      options: [
        { value: "0.90", label: "90 %" },
        { value: "0.95", label: "95 %" },
        { value: "0.99", label: "99 %" },
      ],
    },
  ],
  compute: (r) => {
    const dataR = numberList(r("data"), "Measurements");
    if ("error" in dataR) return refuse(dataR.error);
    const data = dataR.data;
    const lsl = optNum(r("lsl"));
    const usl = optNum(r("usl"));
    const target = optNum(r("target"));
    for (const [v, name] of [
      [lsl, "LSL"],
      [usl, "USL"],
      [target, "target"],
    ] as const) {
      if (v !== null && !Number.isFinite(v)) return refuse(`The ${name} is not a number.`);
    }
    const sgRaw = optNum(r("subgroup"));
    if (sgRaw !== null && !Number.isFinite(sgRaw)) return refuse("The subgroup size is not a number.");
    const conf = Number(r("conf") || "0.95");
    const res = capability({ data, lsl, usl, target, subgroup: sgRaw, confidence: conf });
    if (!res.ok) return refuse(res.error);
    const confPct = String(Math.round(conf * 100));
    const lines: EngLine[] = [
      `Process capability, n = ${res.n}${res.subgroups ? ` (${res.subgroups} subgroups)` : ""}`,
      `  LSL ${lsl === null ? "none" : plain(lsl)}   USL ${usl === null ? "none" : plain(usl)}${target === null ? "" : `   target ${plain(target)}`}`,
      `  Mean ${f(res.mean, 6)}`,
      `  σ within  ${f(res.sWithin, 4)}   (${res.withinMethod})`,
      `  σ overall ${f(res.sOverall, 4)}   (sample standard deviation s, n − 1)`,
      "",
      "Potential (within-subgroup σ)",
      ...idxLines("Cp", "Cp", res.within, confPct),
      "",
      "Performance (overall σ)",
      ...idxLines("Pp", "Pp", res.overall, confPct),
      "",
      `Observed out of spec: ${res.observedOut} of ${res.n} (${ppmText(res.observedPpm)})`,
      "",
      `Method: Cpk = min(USL − x̄, x̄ − LSL)/3σ; with one limit only Cpk is the one-sided index and Cp is not defined. ` +
        `The interval is Bissell's (1990) normal approximation, Ĉpk ± z·√(1/(9n) + Ĉpk²/(2(n − 1))), with n = ${res.n} ` +
        `all measurements; for the within index it is approximate. Expected ppm are normal tail areas at each σ. d₂ constants: ASTM E2587, Montgomery (Appendix VI).`,
    ];
    const nt = normalityTest(data);
    if (nt.ok) {
      const pText = nt.p < 0.001 ? "p < 0.001" : `p = ${nt.p.toFixed(3)}`;
      lines.push(
        nt.normal
          ? `Normality (D'Agostino–Pearson K²): ${pText}; normality not rejected. That supports, but does not prove, the ppm figures.`
          : `Normality (D'Agostino–Pearson K²): ${pText}; the data are NOT normal, so the indices and ppm figures are unreliable (transform the data or use a non-normal capability method).`,
      );
    } else if (nt.reason) {
      lines.push(`Normality: ${plainDashes(nt.reason)}`);
    }
    if (res.orderSuspect) {
      const src = res.subgroups ? "within-subgroup ranges" : "moving ranges";
      lines.push(
        res.sWithin < 0.5 * res.sOverall
          ? `Note: σ within from ${src} is much smaller than σ overall (${f(res.sWithin / res.sOverall, 2)} of it): either the data ` +
              "are sorted or the process shifts between groups. Cp/Cpk describe the short-term spread only; Pp/Ppk use the overall σ."
          : `Note: the values run monotonically, so σ within from ${src} may not describe the process (sorted data, or a steady trend). ` +
              "Pp/Ppk use the overall σ.",
      );
    }

    if (res.n < 100) lines.push(`Note: n = ${res.n}; capability indices from fewer than about 100 values carry wide intervals (see above).`);
    lines.push("Note: capability presumes a process in statistical control; check a control chart first, because an index of an unstable process predicts nothing.");
    for (const n of dataR.notes) lines.push(`Note: ${n}`);
    lines.push(UNIT_NOTE_SAME);

    // Histogram (step outline) with the fitted normal, LSL/USL/target.
    let lo = minOf(data);
    let hi = maxOf(data);
    const bins = Math.max(5, Math.min(30, Math.ceil(Math.sqrt(res.n))));
    if (hi === lo) hi = lo + 1;
    const bw = (hi - lo) / bins;
    const counts = new Array<number>(bins).fill(0);
    for (const v of data) counts[Math.min(bins - 1, Math.floor((v - lo) / bw))]++;
    const step: Point[] = [{ x: lo, y: 0 }];
    for (let b = 0; b < bins; b++) {
      step.push({ x: lo + b * bw, y: counts[b] }, { x: lo + (b + 1) * bw, y: counts[b] });
    }
    step.push({ x: hi, y: 0 });
    const xs = [lo, hi, res.mean - 4 * res.sOverall, res.mean + 4 * res.sOverall];
    if (lsl !== null) xs.push(lsl);
    if (usl !== null) xs.push(usl);
    const x0 = minOf(xs);
    const x1 = maxOf(xs);
    lo = x0;
    hi = x1;
    const curve: Point[] = [];
    for (let i = 0; i <= 120; i++) {
      const x = lo + ((hi - lo) * i) / 120;
      const z = (x - res.mean) / res.sOverall;
      curve.push({ x, y: (res.n * bw * Math.exp(-0.5 * z * z)) / (res.sOverall * Math.sqrt(2 * Math.PI)) });
    }
    const top = Math.max(maxOf(counts), maxOf(curve.map((p) => p.y))) * 1.1;
    const vline = (x: number): Point[] => [
      { x, y: 0 },
      { x, y: top },
    ];
    const series: Series[] = [
      { points: step, type: "line", color: "#2563eb", label: "measurements" },
      { points: curve, type: "line", color: "#111111", label: "normal, overall σ" },
    ];
    if (lsl !== null) series.push({ points: vline(lsl), type: "line", color: "#b91c1c", label: "LSL" });
    if (usl !== null) series.push({ points: vline(usl), type: "line", color: "#b91c1c", label: "USL" });
    if (target !== null) series.push({ points: vline(target), type: "line", color: "#15803d", label: "target" });
    const W = 420;
    const H = 280;
    const svg = buildPlotSvg(series, {
      width: W,
      height: H,
      xlabel: "Measured value",
      ylabel: "Count",
      title: `Capability: Cpk ${f(res.within.k, 3)}, Ppk ${f(res.overall.k, 3)}`,
      yLimits: { min: 0, max: top },
    });
    return report(lines, [
      plotOf(svg, "Histogram of the measurements with the fitted normal curve and the specification limits", "Histogram of measurements with a normal curve and vertical lines at the specification limits and target", W, H),
    ]);
  },
};

// ------------------------------------------------------------ 5. stack-up

const STACK_DEFAULT = [
  "Housing bore depth\t+\t50.00\t±0.10",
  "Spacer\t−\t20.00\t±0.05",
  "Bearing A\t−\t14.00\t±0.04",
  "Bearing B\t−\t14.00\t±0.04",
  "Retaining clip\t−\t1.50\t+0/−0.06",
].join("\n");

/** A plain number, e-notation allowed ("1e-3", "0.10", ".5"). */
const NUM = String.raw`(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const TOL_SYM = new RegExp(`^(?:±|\\+/-)\\s*(${NUM})$`);
const TOL_BARE = new RegExp(`^(${NUM})$`);
const TOL_PAIR = new RegExp(`^([+-]?${NUM})\\s*(?:/|\\s)\\s*([+-]?${NUM})$`);

/** "±0.1", "0.1", "±1e-3", "+0.10/−0.05", "+0.1 -0.05" → [plus, minus]. */
function readTol(cells: string[]): [number, number] | null {
  const t = cells.join(" ").replace(MINUS_RE, "-").replace(/\s+/g, " ").trim();
  const m1 = TOL_SYM.exec(t) ?? TOL_BARE.exec(t);
  if (m1) {
    const v = Number(m1[1]);
    return Number.isFinite(v) ? [v, -v] : null;
  }
  const m2 = TOL_PAIR.exec(t);
  if (m2) {
    const a = Number(m2[1]);
    const b = Number(m2[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [Math.max(a, b), Math.min(a, b)];
  }
  return null;
}

/** Length units a stack line may carry ("50 mm", "50mm", "±0.10 mm"); labels only, never converted. */
const STACK_UNIT = /^(mm|in|µm|μm|um)$/i;
const STACK_UNIT_SUFFIX = /^(.*[\d.])\s*(mm|in|µm|μm|um)$/i;
const canonUnit = (u: string): string => (/^(µm|μm|um)$/i.test(u) ? "µm" : u.toLowerCase());

/** One stack line: [name] sign nominal tolerance [unit] — or [name] signed-nominal tolerance [unit]. */
function parseStack(text: string): { dims: StackDim[]; unit: string | null; notes: string[] } | { error: string } {
  const rows = stackRows(text);
  if ("error" in rows) return rows;
  const dims: StackDim[] = [];
  const notes = [...rows.notes];
  let unit: string | null = null;
  for (let r = 0; r < rows.rows.length; r++) {
    const { cells: raw, orig, line } = rows.rows[r];
    let cells = raw.filter((c) => c !== "");
    // Units: a trailing unit cell, and units glued to numbers, are stripped and must agree.
    const seen: string[] = [];
    if (cells.length && STACK_UNIT.test(cells[cells.length - 1])) seen.push(canonUnit(cells.pop() as string));
    cells = cells.map((c) => {
      const m = STACK_UNIT_SUFFIX.exec(c);
      if (m && /\d/.test(m[1])) {
        seen.push(canonUnit(m[2]));
        return m[1].trim();
      }
      return c;
    });
    // A HEADER is a first line none of whose fields (units stripped) reads as a
    // number or a tolerance; any other unreadable line is refused.
    if (r === 0 && isHeader(cells) && !cells.some((c) => readTol([c]) !== null)) {
      notes.push(headerNote(raw.filter((c) => c !== "")));
      continue;
    }
    for (const u of seen) {
      if (unit === null) unit = u;
      else if (u !== unit) {
        return { error: `Line ${line}: the stack mixes ${unit} and ${u}. Write every dimension in one unit (nothing is converted here).` };
      }
    }
    // Read from the RIGHT, so a name may contain numbers ("Bearing 2"): the
    // tolerance is the last cell (or the last two, "+0.10 −0.05"), the nominal
    // the cell before it, an optional lone sign before that, and the rest the name.
    let tol: [number, number] | null = null;
    let nomAt = -1;
    for (const take of [1, 2]) {
      const at = cells.length - take - 1;
      if (at < 0) break;
      const t = readTol(cells.slice(cells.length - take));
      if (t && Number.isFinite(cellNum(cells[at]))) {
        tol = t;
        nomAt = at;
        break;
      }
    }
    if (!tol) {
      return {
        error:
          `Line ${line} (“${raw.join(" ").slice(0, 60)}”): expected a name, a sign (+ or −), a nominal size and a tolerance ` +
          "written ±0.10, 0.10 or +0.10/−0.05 (an optional unit such as mm may follow).",
      };
    }
    let sign: 1 | -1;
    let nameEnd = nomAt;
    const nomCell = cells[nomAt];
    const nominalSigned = cellNum(nomCell);
    if (nomAt > 0 && /^[+\-−]$/.test(cells[nomAt - 1])) {
      sign = cells[nomAt - 1] === "+" ? 1 : -1;
      nameEnd = nomAt - 1;
      if (nominalSigned < 0) return { error: `Line ${line}: give either a sign column or a signed nominal, not both.` };
    } else {
      sign = /^[-−]/.test(nomCell.trim()) ? -1 : 1;
    }
    const nominal = Math.abs(nominalSigned);
    // The name is echoed exactly as typed (the original cells, never the normalised numbers).
    const name = orig.filter((c) => c !== "").slice(0, nameEnd).join(" ").trim() || `Dimension ${dims.length + 1}`;
    dims.push({ name: name.slice(0, 40), sign, nominal, plus: tol[0], minus: tol[1] });
  }
  if (!dims.length) return { error: "Enter at least one dimension: name, sign (+ or −), nominal and tolerance." };
  return { dims, unit, notes };
}


const stackCalc: MatCalc = {
  id: "qual-tolerance-stack",
  name: "Tolerance stack-up: worst case and RSS",
  group: "Fatigue & machine design",
  unitContract: "same-units",
  hint:
    "One dimension per line around the loop: a name, + or − (the direction it adds to the gap), the nominal and its " +
    "tolerance (±0.10, or +0.10/−0.05 for unequal limits, which are re-centred). Worst case adds every tolerance; RSS " +
    "adds them in quadrature and assumes each is ±kσ of an independent, centred normal process. The bars show which " +
    "dimension owns the variance, which is where tightening pays.",
  fields: [
    { key: "dims", label: "Name, sign, nominal, tolerance (one per line)", default: STACK_DEFAULT, kind: "block", rows: 7 },
    { key: "k", label: "Each tolerance is ± how many σ (for the RSS probability and Monte Carlo)", default: "3", kind: "text" },
    { key: "gapMin", label: "Minimum allowed gap (blank = none)", default: "0", kind: "text" },
    { key: "gapMax", label: "Maximum allowed gap (blank = none)", default: "", kind: "text" },
    {
      key: "mc",
      label: "Monte Carlo check",
      default: "off",
      kind: "select",
      options: [
        { value: "off", label: "off" },
        { value: "on", label: "on (normal draws, seed 1; 100 000 up to 10 dimensions)" },
      ],
    },
  ],
  compute: (r) => {
    const parsed = parseStack(r("dims"));
    if ("error" in parsed) return refuse(parsed.error);
    const dims = parsed.dims;
    const k = cellNum(r("k") || "3");
    if (!(Number.isFinite(k) && k > 0 && k <= 10)) return refuse("The σ multiple k must be a number above 0 and at most 10 (3 is usual).");
    const gMin = optNum(r("gapMin"));
    const gMax = optNum(r("gapMax"));
    if ((gMin !== null && !Number.isFinite(gMin)) || (gMax !== null && !Number.isFinite(gMax))) return refuse("The gap limits must be numbers.");
    if (gMin !== null && gMax !== null && !(gMax > gMin)) return refuse("The maximum gap must be larger than the minimum.");
    const res = toleranceStack(dims);
    if (!res.ok) return refuse(res.error);
    // Dimensions print at the decimals they were typed to; results one place finer.
    // Past 8 decimals fixed notation is unreadable, so values switch to enough
    // significant figures to show the smallest tolerance next to the largest
    // dimension (never printing a real tolerance as zero).
    const dp = Math.max(...res.rows.flatMap((x) => [decimalsOf(x.nominal), decimalsOf(x.plus), decimalsOf(x.minus)]));
    const big = Math.max(1e-300, ...res.rows.flatMap((x) => [Math.abs(x.nominal), Math.abs(x.plus), Math.abs(x.minus)]), Math.abs(res.centre) + res.worst);
    const smallTol = Math.min(...res.rows.map((x) => x.half).filter((h) => h > 0), res.rss > 0 ? res.rss : Infinity);
    const sigNeed = Number.isFinite(smallTol) ? Math.min(15, Math.max(3, Math.ceil(Math.log10(big / smallTol)) + 2)) : 6;
    const fmtAt = (v: number, places: number): string => (places <= 8 ? fixed(v, places) : v === 0 ? "0" : f(v, sigNeed));
    const di = (v: number): string => fmtAt(v, dp);
    const d = (v: number): string => fmtAt(v, dp + 1);
    const signed = (v: number): string => (v >= 0 ? `+${di(v)}` : di(v));
    const shifted = res.rows.some((x) => x.plus !== -x.minus);
    const lines: EngLine[] = [
      `Tolerance stack-up, ${res.rows.length} dimensions`,
      "",
      ...res.rows.map(
        (x) =>
          `  ${x.sign > 0 ? "+" : "−"} ${x.name.padEnd(22)} ${di(x.nominal)}` +
          (x.plus === -x.minus ? ` ±${di(x.half)}` : ` ${signed(x.plus)}/${signed(x.minus)} (as ${d(x.mid)} ±${d(x.half)})`) +
          `   ${pct(x.share, 3)} of RSS variance`,
      ),
      "",
      `  Nominal gap        ${d(res.nominal)}`,
    ];
    if (shifted) lines.push(`  Centred gap        ${d(res.centre)}   (unequal tolerances re-centred)`);
    lines.push(
      `  Worst case         ${d(res.centre)} ±${d(res.worst)}   →  ${d(res.centre - res.worst)} to ${d(res.centre + res.worst)}`,
      `  RSS (statistical)  ${d(res.centre)} ±${d(res.rss)}   →  ${d(res.centre - res.rss)} to ${d(res.centre + res.rss)}`,
    );
    const sigma = res.rss / k;
    if (gMin !== null || gMax !== null) {
      const wcOk = (gMin === null || res.centre - res.worst >= gMin) && (gMax === null || res.centre + res.worst <= gMax);
      const pOut =
        sigma > 0
          ? (gMin === null ? 0 : normalCdfPrecise((gMin - res.centre) / sigma)) + (gMax === null ? 0 : normalCdfPrecise(-(gMax - res.centre) / sigma))
          : (gMin !== null && res.centre < gMin) || (gMax !== null && res.centre > gMax)
            ? 1
            : 0;
      lines.push(
        "",
        `  Limits: gap ${gMin === null ? "" : `≥ ${di(gMin)}`}${gMin !== null && gMax !== null ? " and " : ""}${gMax === null ? "" : `≤ ${di(gMax)}`}`,
        `  Worst case         ${wcOk ? "every assembly meets the limits" : "some assemblies can violate the limits"}`,
        `  RSS, σ = RSS/${plain(k)}  expected outside the limits: ` +
          (pOut >= 1e-4 ? `${pct(pOut, 3)} (${ppmText(pOut * 1e6)})` : ppmText(pOut * 1e6)),
      );
    }
    const blocks: AnalyzeBlock[] = [];
    if (r("mc") === "on" && sigma > 0) {
      const names = res.rows.map((_, i) => `d${i + 1}`);
      const expr = res.rows.map((x, i) => `${i === 0 ? (x.sign > 0 ? "" : "-") : x.sign > 0 ? " + " : " - "}${names[i]}`).join("");
      try {
        // FREEZE CAP: the draws scale with the dimensions, so the sample count is budgeted (10⁶ dimension-draws, at least 10 000).
        const mcSamples = Math.max(10000, Math.min(100000, Math.round(1e6 / res.rows.length)));
        const mc = monteCarlo(expr, res.rows.map((x, i) => ({ name: names[i], value: x.mid, u: x.half / k })), { samples: mcSamples, seed: 1 });
        let outMc = 0;
        const hist = mcHistogramSvg(mc, "gap");
        blocks.push(plotOf(hist, "Monte Carlo distribution of the gap", "Histogram of simulated assembly gaps with the 95 % interval marked", 420, 280));
        for (const v of mc.sorted) if ((gMin !== null && v < gMin) || (gMax !== null && v > gMax)) outMc++;
        lines.push(
          "",
          `  Monte Carlo (${mc.samples.toLocaleString("en-US").replace(/,/g, " ")} draws, seed ${mc.seed}): mean ${d(mc.mean)}, σ ${f(mc.sd, 4)}, 95 % of assemblies ${d(mc.lo)} to ${d(mc.hi)}` +
            (gMin !== null || gMax !== null ? `, ${pct(outMc / mc.samples, 3)} outside the limits` : ""),
          "Note: the draws are normal with σ = tolerance/k, so for this linear loop the Monte Carlo reproduces RSS by construction; it confirms the arithmetic, not the distribution assumption.",
        );
      } catch (e) {
        lines.push("", `Monte Carlo not run: ${plainDashes(e instanceof Error ? e.message : String(e))}`);
      }
    }
    lines.push(
      "",
      `Method: worst case = Σ|tᵢ|; RSS = √(Σtᵢ²), which treats each tolerance as ±${plain(k)}σ of an independent, centred normal ` +
        "distribution; contributions are tᵢ²/Σtᵢ². RSS is optimistic when processes are not centred or the loop has few dimensions; " +
        "worst case is the guarantee.",
      ...parsed.notes.map((n) => `Note: ${n}`),
      parsed.unit ? `Dimensions are in ${parsed.unit}, as written; nothing is converted.` : UNIT_NOTE_SAME,
    );
    const W = 420;
    const bar = hBarSvg(
      res.rows.map((x) => ({ name: `${x.sign > 0 ? "+" : "−"} ${x.name}`, value: x.share * 100, colour: x.sign > 0 ? "#2563eb" : "#b45309" })),
      { title: "Contribution to the RSS variance", unit: "%", w: W },
    );
    blocks.unshift(plotOf(bar, "Percentage contribution of each dimension to the stack's RSS variance", "Horizontal bars of each dimension's share of the stack-up variance", W, 160));
    return report(lines, blocks);
  },
};

/** The five calculators, in menu order; the pane spreads these into ENG_CALCS. */
export const MATERIALS_CALCS: MatCalc[] = [tensileCalc, weibullStrengthCalc, scherrerCalc, capabilityCalc, stackCalc];

/** For tests: the automatic-window fractions, as the hint states them. */
export const TENSILE_AUTO_WINDOW = AUTO_WINDOW;
