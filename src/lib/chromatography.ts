// HPLC / GC peak-table figures of merit (Release C gap #7). Reads a PASTED PEAK TABLE (retention time, area,
// height, widths) and computes the system-suitability numbers a chromatographer reports. It does NOT read a raw
// detector trace: no peak detection, no baseline, no integration (out of this release, said in the tool's hint).
//
// CONVENTION (settled by the integrator; printed in every result as CHROM_CONVENTION):
//   USP ⟨621⟩ Chromatography / Ph. Eur. 2.2.46 Chromatographic separation techniques, HARMONIZED text (USP official
//   1 December 2022; Ph. Eur. 11.0, 1 January 2023), half-height ("HH") family:
//     plate number         N   = 5.54 (tR / W₀.₅)²
//     resolution           Rs  = 1.18 (tR2 − tR1) / (W₀.₅,1 + W₀.₅,2)
//     retention factor     k   = (tR − tM) / tM
//     separation factor    α   = k₂ / k₁            (k₁ the earlier of the two peaks)
//     symmetry (tailing)   T   = W₀.₀₅ / (2f)       (W₀.₀₅ the width at 5 % height, f the FRONT half-width there)
//     area percent         area / Σ area × 100
//   Where the constants come from: for a Gaussian W₀.₅ = 2√(2 ln 2) σ, so N = (tR/σ)² = 8 ln 2 (tR/W₀.₅)²
//   = 5.545 (tR/W₀.₅)², and Rs = 2Δt/(4σ₁ + 4σ₂) = √(2 ln 2) Δt/(W₀.₅,1 + W₀.₅,2) = 1.177 Δt/(…). The PHARMACOPOEIA
//   ROUNDS THEM to 5.54 and 1.18 and so does this file: the compendial number, not the Gaussian one.
//   No tangent (baseline) width method in this release.
//
// SOURCES checked 2026-10-22:
//   - Waters, "CRI-4304 Redefined USP Calculations" (June 2023), quoting the harmonized ⟨621⟩ HH formulas:
//     "N = 5.54*(Retention Time/Width @50%)**2" and "R = 1.18*((Retention Time)-…)/(Width @ 50%+…)", and that the
//     symmetry factor (formerly the USP tailing factor) keeps the previous USP formula:
//     https://support.waters.com/@api/deki/files/24249/CRI-4304_Redefined_USP_Calculations_June_2023.pdf?revision=1
//   - USP notice of adoption of the harmonized ⟨621⟩ (official 1 December 2022): https://usp.org/node/34576
//   - Symmetry factor As = W₀.₀₅ / 2f (f = distance from the perpendicular at the peak maximum to the leading edge at
//     5 % height; Ph. Eur. writes it d): https://gmpinsiders.com/peak-tailing-in-chromatography/
//   The Waters note also says the symmetry factor "uses the width at 50% height"; the settled convention (and the
//   unchanged USP formula it cites) is the 5 %-height one, which this file implements.
//
// Pasted numbers go through dataBlock.readDataBlock (RULE N, the ONE number reader). This file only PEELS a text
// name column off each line before handing the remaining numeric columns to it (dataBlock refuses words beside
// numbers, by design), and maps header names to columns. It is a column peeler, not a second number reader.
// Pure: no Office.js. Every loop is bounded by the 200-peak cap.

import { readDataBlock } from "./dataBlock";
import { fmtSig, MINUS } from "./axis";

/** A number for a message: up to six significant figures, U+2212 minus, ×10ⁿ outside 10⁻³…10⁶ (never e-notation). */
export function showNum(v: number, sig = 6): string {
  if (!Number.isFinite(v)) return "not finite";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return (v < 0 ? MINUS : "") + String(Number(a.toPrecision(sig)));
  // ×10ⁿ with the mantissa's trailing zeros dropped ("4×10⁶", not "4.00000×10⁶").
  return fmtSig(v, sig).replace(/\.(\d*?)0+(?=×)/, (_m, d: string) => (d ? `.${d}` : ""));
}

export const CHROM_CONVENTION = "USP ⟨621⟩ / Ph. Eur. 2.2.46 (harmonized), half-height widths";
/** Plate-number constant of the harmonized half-height formula (USP ⟨621⟩ / Ph. Eur. 2.2.46). */
export const N_HALF_HEIGHT = 5.54;
/** Resolution constant of the harmonized half-height formula. */
export const RS_HALF_HEIGHT = 1.18;
/** Most peaks one table may hold. */
export const MAX_PEAKS = 200;

export type PeakColumn = "name" | "tR" | "area" | "height" | "w50" | "w05" | "f";
/** The column order read when the table has no header (a text name column first is allowed with tabs or semicolons). */
export const DEFAULT_ORDER: PeakColumn[] = ["tR", "area", "w50", "height", "w05", "f"];

export interface PeakRow {
  /** 1-based line of the pasted text, for messages. */
  line: number;
  name: string | null;
  tR: number;
  area: number | null;
  height: number | null;
  w50: number | null;
  w05: number | null;
  f: number | null;
}

export interface PeakTable {
  ok: true;
  rows: PeakRow[];
  notes: string[];
  /** The columns that were present. */
  columns: PeakColumn[];
}
export interface ChromRefusal {
  ok: false;
  error: string;
}

/** A header name reduced for matching: lower case, units in () or [] dropped, spaces, underscores and hyphens gone. */
function headerKey(h: string): string {
  return h
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[\s_\-]+/g, "")
    .replace(/,/g, ".")
    .trim();
}

const ALIASES: Record<PeakColumn, string[]> = {
  name: ["peak", "name", "peakname", "compound", "component", "analyte", "substance", "#", "no", "no.", "peakno", "peakno.", "peak#", "id"],
  tR: ["rt", "tr", "retentiontime", "rettime", "ret.time", "tret"],
  area: ["area", "peakarea"],
  height: ["height", "ht", "peakheight"],
  w50: ["w0.5", "w05", "w50", "w50%", "w½", "w1/2", "wh", "width50%", "width@50%", "widthat50%", "widthat50%height", "widthathalfheight", "halfheightwidth", "fwhm", "width0.5", "w0.50"],
  w05: ["w0.05", "w005", "w5", "w5%", "width5%", "width@5%", "widthat5%", "widthat5%height", "width0.05"],
  f: ["f", "frontwidth", "fronthalfwidth", "f0.05", "fronthalfwidthat5%", "front"],
};
/** Headers that name a width or a time without saying which: refused by name rather than guessed. */
const AMBIGUOUS: Record<string, string> = {
  width: "could be the baseline (tangent) width or the width at half height",
  w: "could be the baseline (tangent) width or the width at half height",
  peakwidth: "could be the baseline (tangent) width or the width at half height",
  halfwidth: "could be the full width at half height or half of a width (f)",
  wb: "is a baseline (tangent) width, which this release does not use",
  basewidth: "is a baseline (tangent) width, which this release does not use",
  w4σ: "is a baseline (tangent) width, which this release does not use",
  time: "does not say it is the retention time",
};
const COMPUTED = ["area%", "areapercent", "height%", "plates", "n", "platecount", "platenumber", "resolution", "rs", "tailing", "symmetry", "symmetryfactor", "k", "k'", "tailingfactor", "as"];

const NUMBER_LIKE = /^[-+−–]?(\d[\d.,   ]*|[.,]\d[\d.,]*)([eE][-+−]?\d+)?%?$/;
const MISSING = /^(|[-−–]|\.|na|n\/a|nan)$/i;
const isNumberLike = (f: string): boolean => NUMBER_LIKE.test(f.trim());

type Sep = "tab" | "semicolon" | "space" | "comma";
const splitLine = (line: string, sep: Sep): string[] =>
  sep === "tab"
    ? line.split("\t").map((f) => f.trim())
    : sep === "semicolon"
      ? line.split(";").map((f) => f.trim())
      : sep === "space"
        ? line.trim().split(/,[ \t\f\v]+|[ \t\f\v]+/).filter((f) => f !== "")
        : line.trim().split(",").map((f) => f.trim());
const JOIN: Record<Sep, string> = { tab: "\t", semicolon: ";", space: " ", comma: "," };

/** Time units a header may carry in () or []: min and s convert exactly (× 60), anything else in a time column is refused. */
const TIME_UNIT: Record<string, "min" | "s"> = { min: "min", mins: "min", minute: "min", minutes: "min", s: "s", sec: "s", secs: "s", second: "s", seconds: "s" };
const TIME_ROLES: PeakColumn[] = ["tR", "w50", "w05", "f"];
/** Text columns a chromatography report carries beside the numbers (ChemStation's Type: BB, VV, BV …): read past. */
const TEXT_COLUMNS: Record<string, string> = { type: "peak type codes", peaktype: "peak type codes", flag: "flags", flags: "flags", mark: "marks", baseline: "baseline codes" };

export interface PeakTableOptions {
  /** The time unit of the table and of tM (the calculator's select). A unit written in a time-column header must equal it. */
  unit?: "min" | "s";
}

/** Reads a pasted peak table. Columns by header name where there is a header; DEFAULT_ORDER otherwise. */
export function readPeakTable(text: string, opts: PeakTableOptions = {}): PeakTable | ChromRefusal {
  const what = "Peak table";
  const target = opts.unit ?? "min";
  const refuse = (error: string): ChromRefusal => ({ ok: false, error });
  const all = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const used: number[] = [];
  for (let i = 0; i < all.length; i++) if (all[i].trim()) used.push(i);
  if (!used.length) return refuse(`${what}: nothing to read. Paste one line per peak (retention time, area, W₀.₅ …).`);
  // The separator, decided as dataBlock's N1 decides it (dataBlock re-decides it on the text handed over).
  const sep: Sep = all.some((l) => l.includes("\t"))
    ? "tab"
    : used.some((i) => all[i].includes(";"))
      ? "semicolon"
      : used.some((i) => /[ \t\f\v]/.test(all[i].trim()))
        ? "space"
        : "comma";
  const fields = used.map((i) => splitLine(all[i], sep));

  // Header: the first line, when none of its non-empty fields is number-like (dataBlock's N4/R4 rule).
  const first = fields[0].filter((f) => !MISSING.test(f));
  const hasHeader = first.length > 0 && !first.some(isNumberLike);
  const dataCount = used.length - (hasHeader ? 1 : 0);
  if (dataCount < 1) return refuse(`${what}: only a header line; add one line per peak.`);
  if (dataCount > MAX_PEAKS) return refuse(`${what}: ${dataCount} peaks; at most ${MAX_PEAKS} peaks per table.`);

  // Without tabs or semicolons a header word and a data value are matched by POSITION only: "RT (min)" is two
  // header fields, "Peak 1" two data fields. Any count mismatch would shift every column after it (a W₀.₅ read from
  // the area column), so it is refused, and BEFORE the header is interpreted, so the reason given is the real one.
  if (hasHeader && (sep === "space" || sep === "comma"))
    for (let j = 1; j < used.length; j++) {
      const n = fields[j].length, h = fields[0].length;
      if (n === h) continue;
      if (h === 1 && fields[0][0].includes(","))
        return refuse(
          `${what}: the header is comma-separated, but a space in the data (such as “${fields[j][0]} ${(fields[j][1] ?? "").split(",")[0]}”) makes spaces separate the columns too, so line ${used[j] + 1} does not line up with the header. Separate the columns with tabs, or write the names without spaces.`,
        );
      return refuse(
        `${what}: line ${used[j] + 1} has ${n} values under ${h} header fields (${fields[0].join(" ")}). Without tabs, a header with units such as “RT (min)” or a name such as “Peak 1” splits into extra fields: separate the columns with tabs, or drop the units from the header.`,
      );
    }

  const notes: string[] = [];
  /** Per column: its role, a text column read past, or unused. */
  let roles: Array<PeakColumn | "text" | null>;
  if (hasHeader) {
    roles = [];
    const ignored: string[] = [];
    for (const h of fields[0]) {
      const key = headerKey(h);
      if (!key) {
        roles.push(null);
        continue;
      }
      if (AMBIGUOUS[key]) return refuse(`${what}: the column “${h}” ${AMBIGUOUS[key]}. Name it ${key === "time" ? "RT or tR (retention time)" : "W0.5 (width at half height) or W0.05 (width at 5 % height)"}.`);
      if (TEXT_COLUMNS[key]) {
        roles.push("text");
        ignored.push(`${h} (${TEXT_COLUMNS[key]})`);
        continue;
      }
      const role = (Object.keys(ALIASES) as PeakColumn[]).find((c) => ALIASES[c].includes(key)) ?? null;
      if (role && roles.includes(role)) return refuse(`${what}: two columns are read as ${COLUMN_NAME[role]} (“${h}” is the second); keep one.`);
      if (!role) ignored.push(COMPUTED.includes(key) ? `${h} (computed here)` : h);
      // RULE U (integrator, round 3): a unit in the header of a time column must EQUAL the time-unit select; nothing
      // is converted (a conversion of some columns but not tM was its own wrong answer). Unknown units are refused.
      const unitText = /[([]\s*([^)\]]*?)\s*[)\]]/.exec(h)?.[1];
      if (role && TIME_ROLES.includes(role) && unitText !== undefined && unitText !== "") {
        const u = TIME_UNIT[unitText.toLowerCase()];
        if (!u) return refuse(`${what}: the column “${h}” is in “${unitText}”; retention times and widths must be in min or s.`);
        const bare = h.replace(/[([][^)\]]*[)\]]/g, "").trim() || h;
        if (u !== target)
          return refuse(`${what}: the ${bare} column header says ${u} but the time unit is set to ${target}; set the time unit to ${u} (all time columns and tM must be in one unit).`);
      }
      roles.push(role);
    }
    if (!roles.includes("tR")) return refuse(`${what}: no retention-time column. Name it RT or tR (columns found: ${fields[0].filter(Boolean).join(", ")}).`);
    notes.push(`Columns read by their headers: ${roles.map((r, i) => (r && r !== "text" ? `${fields[0][i]} as ${COLUMN_NAME[r]}` : null)).filter(Boolean).join(", ")}.`);
    if (ignored.length) notes.push(`Not used: ${ignored.join(", ")}.`);
  } else {
    // No header: a word in the FIRST field of every line is a name column, but only where names can hold spaces
    // safely (tab or semicolon columns). Otherwise the documented default order.
    const wordFirst = fields.every((r) => r.length > 1 && !MISSING.test(r[0]) && !isNumberLike(r[0]));
    if (wordFirst && (sep === "space" || sep === "comma"))
      return refuse(`${what}: peak names without a header row need tab-separated columns (a name such as “Peak 1” would split into two). Add a header line (Peak, RT, Area, W0.5 …) or use tabs.`);
    // RULE R (integrator, round 3): with no header the columns are known only by POSITION, so a line with fewer
    // fields than the others would shift every value after the gap (a W₀.₅ read as the area). Refused by name. A
    // trailing empty tab or semicolon cell is still a field (a missing value), so it does not count as short.
    // The widest line is measured without its trailing EMPTY cells (a stray tab at a line's end widens nothing);
    // a line is short only if it has fewer cells, empty ones included, than that.
    const filled = (r: string[]): number => {
      let n = r.length;
      while (n > 0 && r[n - 1].trim() === "") n--;
      return n;
    };
    const widest = Math.max(...fields.map(filled));
    const short = fields.findIndex((r) => r.length < widest);
    if (short >= 0)
      return refuse(
        `${what}: line ${used[short] + 1} has ${fields[short].length} value${fields[short].length === 1 ? "" : "s"} but another line has ${widest}. With no header the columns are read by position (tR, area, W₀.₅, height, W₀.₀₅, f), so a missing value must be written as - (or left as an empty tab-separated cell), not left out; or add a header line.`,
      );
    roles = wordFirst ? ["name", ...DEFAULT_ORDER] : [...DEFAULT_ORDER];
    notes.push(
      `No header line: columns read in the default order ${wordFirst ? "name, " : ""}tR, area, W₀.₅, height, W₀.₀₅, f (a header such as “Peak RT Area W0.5” sets any order).`,
    );
  }

  // Only the columns this tool uses go to dataBlock (names, type codes and unused columns are peeled off here, so
  // a text column never trips dataBlock's words-beside-numbers rule); everything sent is numbers, same separator.
  const nameIdx = roles.indexOf("name");
  const keep: number[] = [];
  roles.forEach((r, i) => {
    if (r !== null && r !== "text" && r !== "name") keep.push(i);
  });
  const names: Array<string | null> = [];
  const numeric = all.map(() => "");
  let extra = 0;
  for (let j = hasHeader ? 1 : 0; j < used.length; j++) {
    const fs = fields[j];
    const nm = nameIdx >= 0 ? (fs[nameIdx] ?? "") : "";
    names.push(nameIdx >= 0 && !MISSING.test(nm) ? nm : null);
    if (fs.slice(roles.length).some((f) => !MISSING.test(f))) extra++;
    numeric[used[j]] = keep.map((i) => (fs[i] === undefined || fs[i] === "" ? "-" : fs[i])).join(JOIN[sep]);
  }
  const block = readDataBlock(numeric.join("\n"), what, { maxRows: MAX_PEAKS });
  if (!block.ok) {
    // dataBlock saw only the numeric columns, with the header already taken off, so its "put a header on its own
    // first line" advice would be wrong here: name the field and its column instead.
    const m = /line (\d+) \(.*\) (?:mixes words and numbers|has no numbers)/.exec(block.error);
    if (m) {
      const ln = Number(m[1]);
      const j = used.indexOf(ln - 1);
      const bad = j >= 0 ? keep.find((i) => {
        const f = fields[j][i] ?? "";
        return !MISSING.test(f) && !isNumberLike(f);
      }) : undefined;
      if (bad !== undefined) {
        const role = roles[bad] as PeakColumn;
        return refuse(`${what}: line ${ln}: “${fields[j][bad]}” is not a number, in the column read as ${COLUMN_NAME[role]}${hasHeader && fields[0][bad] ? ` (“${fields[0][bad]}”)` : ""}. Use plain digits (0–9, a decimal point or comma, a minus sign).`);
      }
      return refuse(block.error.replace(/ Remove the text, or put a header on its own first line\.| Only the first line may be a header\./, " Use plain numbers in the retention-time, area, height and width columns."));
    }
    return refuse(block.error);
  }
  // Every line sent is data; dataBlock reading the first as a header would mean its numeric columns hold words.
  if (block.header) return refuse(`${what}: line ${used[hasHeader ? 1 : 0] + 1} has no numbers in its retention-time and width columns.`);
  notes.push(...block.notes);

  const col = (r: PeakColumn): number => keep.findIndex((i) => roles[i] === r);
  const rows: PeakRow[] = [];
  for (let i = 0; i < block.rows.length; i++) {
    const v = block.rows[i];
    const at = (r: PeakColumn): number | null => {
      const c = col(r);
      const x = c >= 0 ? (v[c] ?? null) : null;
      return x;
    };
    const tR = at("tR");
    const line = block.lines[i];
    if (tR === null) return refuse(`${what}: line ${line} has no retention time.`);
    rows.push({ line, name: names[i] ?? null, tR, area: at("area"), height: at("height"), w50: at("w50"), w05: at("w05"), f: at("f") });
  }
  if (extra) notes.push(`${extra} line${extra > 1 ? "s have" : " has"} more columns than ${hasHeader ? "the header names" : "the default order uses"}; the extra values were not read.`);
  return { ok: true, rows, notes, columns: roles.filter((r): r is PeakColumn => r !== null && r !== "text") };
}

const COLUMN_NAME: Record<PeakColumn, string> = {
  name: "the peak name",
  tR: "the retention time t(R)",
  area: "the area",
  height: "the height",
  w50: "W₀.₅ (width at half height)",
  w05: "W₀.₀₅ (width at 5 % height)",
  f: "f (front half-width at 5 % height)",
};

export interface PeakResult {
  /** 1-based, in elution order. */
  index: number;
  /** The table's name, or "peak n". */
  label: string;
  /** True when the table gave the name. */
  named: boolean;
  /** How every message names this peak (RULE I): "peak 1 (Caffeine)", "peak 1 (ID 2)", "peak 1". */
  ref: string;
  /** The name or ID exactly as the table gave it (a numeric Peak column too), or null. */
  id: string | null;
  line: number;
  tR: number;
  area: number | null;
  height: number | null;
  w50: number | null;
  w05: number | null;
  f: number | null;
  areaPct: number | null;
  k: number | null;
  N: number | null;
  /** To the NEXT peak in elution order. */
  Rs: number | null;
  alpha: number | null;
  T: number | null;
}

export interface ChromResult {
  ok: true;
  peaks: PeakResult[];
  tM: number | null;
  notes: string[];
  /** True when the rows were not in retention order and were sorted. */
  sorted: boolean;
}

/**
 * RULE I (integrator, round 3): a peak is named everywhere in ONE form, the results table's: its elution number,
 * then the table's own name or ID ("peak 1 (Caffeine)", "peak 1 (ID 2)", "peak 1"). A bare user ID that looks like
 * a row number ("peak 2" for the row the table numbers 1) is never printed.
 */
export function peakRef(index: number, id: string | null): string {
  return `peak ${index}${id === null ? "" : isNumberLike(id) ? ` (ID ${id})` : ` (${id})`}`;
}
/** peakRef with the pasted line, for refusals: "peak 1 (Caffeine, line 2)", "peak 1 (ID 2, line 3)", "peak 1 (line 2)". */
const peakAt = (index: number, r: PeakRow): string =>
  `peak ${index} (${r.name === null ? "" : isNumberLike(r.name) ? `ID ${r.name}, ` : `${r.name}, `}line ${r.line})`;

/** The figures of merit for a read table; tM (same time unit) optional. */
export function analyzePeaks(rows: PeakRow[], tM: number | null): ChromResult | ChromRefusal {
  const refuse = (error: string): ChromRefusal => ({ ok: false, error });
  if (!rows.length) return refuse("Peak table: at least one peak is needed.");
  if (rows.length > MAX_PEAKS) return refuse(`Peak table: at most ${MAX_PEAKS} peaks.`);
  if (tM !== null && !(Number.isFinite(tM) && tM > 0)) return refuse("Dead time tM must be a positive number (the retention time of an unretained marker), or left blank.");
  // Elution order first, so even a refusal names a peak by the number the results table would give it.
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.tR - b.r.tR || a.i - b.i);
  const elution: number[] = [];
  order.forEach((o, j) => (elution[o.i] = j + 1));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const who = peakAt(elution[i], r);
    const art = (nm: string): string => (nm === "area" ? "an" : "a");
    const vals: Array<[number | null, string]> = [[r.tR, "retention time"], [r.area, "area"], [r.height, "height"], [r.w50, "W₀.₅"], [r.w05, "W₀.₀₅"], [r.f, "f"]];
    for (const [v, nm] of vals) {
      if (v === null) continue;
      if (!Number.isFinite(v)) return refuse(`Peak table: ${who} has ${art(nm)} ${nm} that is not a finite number.`);
      if (v <= 0) return refuse(`Peak table: ${who} has ${art(nm)} ${nm} of ${showNum(v)}; ${art(nm)} ${nm} must be greater than zero.`);
    }
    if (r.w05 !== null && r.f !== null && r.f >= r.w05)
      return refuse(`Peak table: ${who}: f (${showNum(r.f)}) is not smaller than W₀.₀₅ (${showNum(r.w05)}); f is the FRONT part of the width at 5 % height. Are the columns swapped?`);
    if (r.w05 !== null && r.w50 !== null && r.w05 < r.w50)
      return refuse(`Peak table: ${who}: W₀.₀₅ (${showNum(r.w05)}) is narrower than W₀.₅ (${showNum(r.w50)}), which no peak is (the width at 5 % height is the wider one). Are the columns swapped?`);
    if (tM !== null && r.tR <= tM)
      return refuse(`Peak table: ${who} elutes at ${showNum(r.tR)}, not after the dead time t(M) = ${showNum(tM)}; every retained peak has t(R) > t(M). Check t(M) and the time unit.`);
  }
  // Sorted by retention time (stable); a tie is refused rather than ordered by guess.
  for (let j = 1; j < order.length; j++)
    if (order[j].r.tR === order[j - 1].r.tR) {
      const a = order[j - 1], b = order[j];
      return refuse(`Peak table: ${peakAt(j, a.r)} and ${peakAt(j + 1, b.r)} have the same retention time ${showNum(a.r.tR)}; one peak per retention time.`);
    }
  const sorted = order.some((o, j) => o.i !== j);
  const notes: string[] = [];
  if (sorted) notes.push("The rows were not in retention order; they were sorted by t(R) (peak numbers and “next peak” follow elution order).");
  const allArea = rows.every((r) => r.area !== null);
  const sumArea = allArea ? rows.reduce((s, r) => s + (r.area as number), 0) : 0;
  const peaks: PeakResult[] = order.map(({ r }, j) => ({
    index: j + 1,
    label: r.name !== null && !isNumberLike(r.name) ? r.name : `peak ${j + 1}`,
    ref: peakRef(j + 1, r.name),
    named: r.name !== null && !isNumberLike(r.name),
    id: r.name,
    line: r.line,
    tR: r.tR,
    area: r.area,
    height: r.height,
    w50: r.w50,
    w05: r.w05,
    f: r.f,
    areaPct: allArea && Number.isFinite(sumArea) && sumArea > 0 ? ((r.area as number) / sumArea) * 100 : null,
    k: tM !== null ? (r.tR - tM) / tM : null,
    N: r.w50 !== null ? N_HALF_HEIGHT * (r.tR / r.w50) ** 2 : null,
    Rs: null,
    alpha: null,
    T: r.w05 !== null && r.f !== null ? r.w05 / (2 * r.f) : null,
  }));
  for (let j = 0; j + 1 < peaks.length; j++) {
    const a = peaks[j], b = peaks[j + 1];
    if (a.w50 !== null && b.w50 !== null) a.Rs = (RS_HALF_HEIGHT * (b.tR - a.tR)) / (a.w50 + b.w50);
    if (a.k !== null && b.k !== null && a.k > 0) a.alpha = b.k / a.k;
  }
  if (!allArea) {
    const missing = peaks.filter((p) => p.area === null).map((p) => p.ref);
    notes.push(rows.some((r) => r.area !== null) ? `Area % not computed: no area for ${listOf(missing)} (the percentages need every peak's area).` : "Area % not computed: the table has no areas.");
  } else if (!Number.isFinite(sumArea)) return refuse("Peak table: the areas are too large to add up.");
  if (tM === null) notes.push("Retention factor k and separation factor α not computed: no dead time t(M) given.");
  const noW = peaks.filter((p) => p.w50 === null).map((p) => p.ref);
  if (noW.length) notes.push(noW.length === peaks.length ? "Plate number N and resolution Rs not computed: the table has no W₀.₅ (width at half height)." : `N and Rs not computed for ${listOf(noW)}: no W₀.₅ (width at half height).`);
  const noT = peaks.filter((p) => p.T === null).map((p) => p.ref);
  if (noT.length) notes.push(noT.length === peaks.length ? "Symmetry factor T not computed: it needs W₀.₀₅ and f (width and front half-width at 5 % height)." : `Symmetry factor T not computed for ${listOf(noT)}: it needs W₀.₀₅ and f.`);
  return { ok: true, peaks, tM, notes, sorted };
}

/** "a, b and c", at most eight named then "and n more". */
export function listOf(xs: string[]): string {
  const shown = xs.slice(0, 8);
  const rest = xs.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** Gaussian height from area and W₀.₅: area / (1.0645 W₀.₅), since area = √(2π) σ h and W₀.₅ = 2√(2 ln 2) σ. */
export const GAUSS_AREA_FACTOR = 1.0645;
/** W₀.₅ / σ for a Gaussian, 2√(2 ln 2). */
export const FWHM_PER_SIGMA = 2.3548;

export interface DrawPeak {
  label: string;
  /** The peak as messages name it (PeakResult.ref). */
  ref: string;
  tR: number;
  /** Relative height, tallest = 100. */
  rel: number;
  /** σ in time units; null = drawn as a line (no W₀.₅). */
  sigma: number | null;
}

/** What the reconstructed chromatogram draws, and the notes that say how it was sized. */
export function drawPlan(peaks: PeakResult[]): { draw: DrawPeak[]; notes: string[] } {
  const notes: string[] = [];
  const allHeight = peaks.every((p) => p.height !== null);
  const fromArea = (p: PeakResult): number | null => (p.area !== null && p.w50 !== null ? p.area / (GAUSS_AREA_FACTOR * p.w50) : null);
  let raw: Array<number | null>;
  if (allHeight) raw = peaks.map((p) => p.height);
  else if (peaks.some((p) => fromArea(p) !== null)) {
    // Mixed tables are sized ONE way, so every peak is on one scale: area / (1.0645 W₀.₅) for all of them.
    raw = peaks.map(fromArea);
    notes.push("Peak heights from area / (1.0645 W₀.₅) (a Gaussian's height).");
    const skipped = peaks.filter((p) => fromArea(p) === null).map((p) => p.ref);
    if (skipped.length) notes.push(`Not drawn: ${listOf(skipped)} (needs a height, or an area and W₀.₅).`);
  } else {
    raw = peaks.map(() => 1);
    // Said from what the table holds: "No heights or areas" was printed beside a table full of areas.
    const anyArea = peaks.some((p) => p.area !== null);
    const anyHeight = peaks.some((p) => p.height !== null);
    notes.push(
      anyArea || anyHeight
        ? `${anyHeight ? "Heights are not given for every peak" : "No heights in the table"}${anyArea ? ", and the areas have no W₀.₅ to turn them into heights" : ""}: every peak is drawn at the same height.`
        : "No heights or areas in the table: every peak is drawn at the same height.",
    );
  }
  const max = Math.max(...raw.map((v) => (v === null ? 0 : v)));
  const draw: DrawPeak[] = [];
  peaks.forEach((p, i) => {
    const h = raw[i];
    if (h === null || !(max > 0)) return;
    draw.push({ label: p.label, ref: p.ref, tR: p.tR, rel: (h / max) * 100, sigma: p.w50 !== null ? p.w50 / FWHM_PER_SIGMA : null });
  });
  const sticks = draw.filter((d) => d.sigma === null).map((d) => d.ref);
  if (sticks.length) notes.push(`Drawn as a line (no W₀.₅): ${listOf(sticks)}.`);
  return { draw, notes };
}
