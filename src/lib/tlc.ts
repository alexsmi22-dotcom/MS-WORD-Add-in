// TLC plate: lanes of spots → Rf values and a schematic plate (tlcChart.ts draws it).
//
// Rf = distance travelled by the spot ÷ distance travelled by the solvent front, both measured from the origin
// (IUPAC Compendium of Chemical Terminology, "retardation factor, R_F, in planar chromatography"). The chemist
// gives the Rf values, or the spot distances and the front distance; nothing is predicted.
//
// Input: one lane per line, "label: values" ("SM: 0.62", "co: 0.62, 0.35", "rxn: 0.35"). A line with no colon is a
// lane numbered by its position. Every lane's values are read TOGETHER through dataBlock.readDataBlock (RULE N, the
// one number reader), so one decimal mark holds across the plate.
//
// Settled rules (pinned in tlcCases.test.ts):
//   - Rf outside (0, 1] is refused (a spot on the origin did not move: Rf 0 is not a position on this schematic).
//   - A spot distance above the front, a front ≤ 0, more than 12 lanes, more than 10 spots in a lane, a non-finite
//     value: refused by name.
//   - Two spots in one lane at the same Rf (to 0.01, the precision printed) are one spot: MERGED, with a note
//     naming the lane. A co-spot lane with the starting material and the product at different Rf keeps both.
//   - A lane with no values is refused (a blank lane is not drawn).

import { readDataBlock } from "./dataBlock";
import { fmtSig } from "./axis";

export const TLC_MAX_LANES = 12;
export const TLC_MAX_SPOTS = 10;
/** Longest lane label drawn (never truncated: longer is refused). */
export const TLC_MAX_LABEL = 12;
/** Longest eluent text drawn above the plate. */
export const TLC_MAX_ELUENT = 60;

export type TlcStyle = "uv" | "stain";

export interface TlcSpot {
  rf: number;
  /** The spot's distance, when the input was distances (in the front's unit). */
  distance?: number;
}
export interface TlcLane {
  label: string;
  spots: TlcSpot[];
}
export interface TlcPlate {
  lanes: TlcLane[];
  eluent: string;
  style: TlcStyle;
  /** Plate width × height (cm), when given: the figure keeps its proportions. */
  size?: { w: number; h: number };
  /** The solvent front distance, when the input was distances. */
  front?: number;
  unit?: string;
}
export interface TlcOk {
  ok: true;
  plate: TlcPlate;
  notes: string[];
}
export interface TlcRefusal {
  ok: false;
  error: string;
}

export interface TlcInput {
  lanes: string;
  mode: "rf" | "distance";
  /** The solvent front distance (distance mode), e.g. "8.0" or "8.0 cm". */
  front?: string;
  eluent?: string;
  /** "2.5 × 7.5 cm", "2.5 x 7.5", "25 x 75 mm". */
  plate?: string;
  style?: TlcStyle;
}

/** Rf to the 0.01 a TLC Rf is reported to (half-up, epsilon-safe). */
export const rf2 = (x: number): string => (Math.round(x * 100 + 1e-9) / 100).toFixed(2);

const NUMLIKE = /^[-+−–]?(?:\d[\d.,]*|[.,]\d[\d.,]*)(?:[eE][-+−]?\d+)?$/;
const MINUS = "−";
const neg = (s: string): string => s.replace(/^-/, MINUS);

/** A number in text: plain digits from 10⁻³ to 10⁶ (up to 6 significant figures), else m×10ⁿ; U+2212. Never e-notation. */
export function plainNum(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return "0";
  const s = a >= 1e-3 && a < 1e6 ? String(Number(a.toPrecision(6))) : fmtSig(a, 4).replace(/(\.\d*?)0+×/, "$1×").replace(/\.×/, "×");
  return v < 0 ? MINUS + s : s;
}

/** A length with an optional cm / mm unit → cm. */
function readLength(raw: string, what: string): { cm: number; unit: string } | string {
  const t = raw.trim().replace(/−/g, "-");
  const m = /^(-?\d+(?:\.\d+)?)\s*(cm|mm)?$/i.exec(t);
  if (!m) return `${what}: “${raw.trim()}” is not a length (write 8.0, 8.0 cm or 80 mm).`;
  const v = Number(m[1]);
  if (!(v > 0) || !Number.isFinite(v)) return `${what} must be above zero (${neg(m[1])} given).`;
  const unit = (m[2] ?? "cm").toLowerCase();
  return { cm: unit === "mm" ? v / 10 : v, unit };
}

/** Reads and checks the plate. */
export function readTlc(input: TlcInput): TlcOk | TlcRefusal {
  const refuse = (error: string): TlcRefusal => ({ ok: false, error });
  const notes: string[] = [];
  const lines = (input.lanes ?? "").replace(/\r\n?/g, "\n").split("\n");
  const rows = lines.map((l, i) => ({ text: l.trim(), line: i + 1 })).filter((r) => r.text);
  if (!rows.length) return refuse("Lanes: nothing to read. Write one lane per line, e.g. “SM: 0.62”.");
  if (rows.length > TLC_MAX_LANES) return refuse(`Lanes: ${rows.length} lanes; a plate here takes at most ${TLC_MAX_LANES}.`);

  const eluent = (input.eluent ?? "").trim();
  if (eluent.length > TLC_MAX_ELUENT) return refuse(`Eluent: ${eluent.length} characters; at most ${TLC_MAX_ELUENT} fit above the plate.`);

  // Distances may carry their unit ("4.96 cm", "49.6 mm"): each is rewritten into the solvent front's unit before
  // the one number reader sees it. (They used to be refused as "“cm” is not a number".)
  let frontUnit: string | null = null;
  if (input.mode === "distance") {
    if (!(input.front ?? "").trim()) return refuse("Solvent front: give the distance the solvent front travelled from the origin (same unit as the spot distances).");
    const f0 = readLength(input.front as string, "Solvent front");
    if (typeof f0 === "string") return refuse(f0);
    frontUnit = f0.unit;
  }
  const UNIT_ON_NUMBER = /((?:\d+(?:\.\d*)?|\.\d+))\s*(cm|mm)\b/gi;
  const labels: string[] = [];
  const valueLines = lines.map(() => "");
  const valueTexts: string[][] = [];
  for (const r of rows) {
    const c = r.text.indexOf(":");
    const vals = c >= 0 ? r.text.slice(c + 1) : r.text;
    if (!/\d\s*(cm|mm)\b/i.test(vals)) continue;
    if (input.mode !== "distance") return refuse(`Lanes: “${vals.trim()}” carries a length unit, but the spots are set to Rf values (no unit). Choose “Distances from the origin”, or give Rf values.`);
  }
  rows.forEach((r, k) => {
    const c = r.text.indexOf(":");
    const label = c >= 0 ? r.text.slice(0, c).trim() : String(k + 1);
    let vals = c >= 0 ? r.text.slice(c + 1).trim() : r.text;
    if (input.mode === "distance" && frontUnit) {
      const fu = frontUnit;
      vals = vals.replace(UNIT_ON_NUMBER, (_m, n: string, u: string) => {
        const v = Number(n);
        const lu = u.toLowerCase();
        const conv = lu === fu ? v : lu === "mm" ? v / 10 : v * 10;
        return String(Number(conv.toPrecision(12)));
      });
    }
    labels.push(label);
    valueLines[r.line - 1] = vals;
    valueTexts.push(vals.split(/,\s+|\s+|;|\t/).filter(Boolean));
  });
  for (let k = 0; k < rows.length; k++) {
    const where = `lane ${k + 1} (“${labels[k] || rows[k].text}”)`;
    if (!labels[k]) return refuse(`Lanes: line ${rows[k].line} has no label before the colon.`);
    if (labels[k].length > TLC_MAX_LABEL) return refuse(`Lanes: the label “${labels[k]}” has ${labels[k].length} characters; at most ${TLC_MAX_LABEL} fit under a lane (abbreviate: SM, co, rxn, P).`);
    if (!valueLines[rows[k].line - 1]) return refuse(`Lanes: ${where} has no spots.`);
    for (const t of valueTexts[k]) if (!NUMLIKE.test(t)) return refuse(`Lanes: ${where}: “${t}” is not a number.`);
  }
  const block = readDataBlock(valueLines.join("\n"), "Lanes");
  if (!block.ok) return refuse(block.error);
  // A bare "0,45" (no space, tab or semicolon anywhere): one decimal-comma value, or 0 and 45? Refused by name.
  if (block.separator === "comma") {
    const pair = valueTexts.flat().find((t) => /^\d+,\d+$/.test(t));
    if (pair) return refuse(`Lanes: “${pair}” could be one value with a decimal comma or two values. Write ${pair.replace(",", ".")}, or separate two spots with “, ”.`);
  }
  for (const n of block.notes) notes.push(n);

  let front: number | undefined;
  let unit: string | undefined;
  if (input.mode === "distance") {
    if (!(input.front ?? "").trim()) return refuse("Solvent front: give the distance the solvent front travelled from the origin (same unit as the spot distances).");
    const f = readLength(input.front as string, "Solvent front");
    if (typeof f === "string") return refuse(f);
    front = f.cm;
    unit = f.unit;
  }

  let size: TlcPlate["size"];
  const plateText = (input.plate ?? "").trim();
  if (plateText) {
    const m = /^(\d+(?:\.\d+)?)\s*(?:×|x|X|by|\*)\s*(\d+(?:\.\d+)?)\s*(cm|mm)?$/.exec(plateText);
    if (!m) return refuse(`Plate size: “${plateText}” is not width × height (write 2.5 × 7.5 cm).`);
    const k = (m[3] ?? "cm").toLowerCase() === "mm" ? 0.1 : 1;
    const w = Number(m[1]) * k;
    const h = Number(m[2]) * k;
    if (!(w > 0 && h > 0)) return refuse("Plate size: the width and height must be above zero.");
    if (h / w > 8 || w / h > 8) return refuse(`Plate size: ${m[1]} × ${m[2]} is too narrow to draw (more than 8 : 1).`);
    size = { w, h };
    if (front !== undefined && front > h) return refuse(`Solvent front ${front} cm is longer than the plate (${h} cm high).`);
  }

  const lanes: TlcLane[] = [];
  for (let k = 0; k < rows.length; k++) {
    const where = `lane ${k + 1} (“${labels[k]}”)`;
    const vals = block.rows[k];
    if (vals.length > TLC_MAX_SPOTS) return refuse(`Lanes: ${where} has ${vals.length} spots; at most ${TLC_MAX_SPOTS} per lane.`);
    const spots: TlcSpot[] = [];
    for (const v of vals) {
      if (v === null || !Number.isFinite(v)) return refuse(`Lanes: ${where}: a value is missing or not a number.`);
      if (input.mode === "distance") {
        const fcm = front as number;
        const d = unit === "mm" ? v / 10 : v;
        const show = plainNum;
        if (!(d > 0)) return refuse(`Lanes: ${where}: a spot distance of ${show(v)} ${unit} is not above the origin.`);
        if (d > fcm + 1e-12) return refuse(`Lanes: ${where}: the spot at ${show(v)} ${unit} is beyond the solvent front (${show(unit === "mm" ? fcm * 10 : fcm)} ${unit}).`);
        if (rf2(d / fcm) === "0.00") return refuse(`Lanes: ${where}: the spot at ${show(v)} ${unit} is Rf ${plainNum(d / fcm)}, which rounds to 0.00: it did not move off the origin.`);
        spots.push({ rf: d / fcm, distance: v });
      } else {
        if (!(v > 0 && v <= 1)) return refuse(`Lanes: ${where}: Rf ${plainNum(v)} is outside (0, 1]. Rf is the spot's distance over the solvent front's, from the origin.`);
        if (rf2(v) === "0.00") return refuse(`Lanes: ${where}: Rf ${plainNum(v)} rounds to 0.00: the spot did not move off the origin.`);
        spots.push({ rf: v });
      }
    }
    // The same Rf twice in one lane (at the 0.01 printed) is one spot.
    const merged: TlcSpot[] = [];
    for (const s of spots) {
      if (merged.some((m) => rf2(m.rf) === rf2(s.rf))) {
        notes.push(`Lane ${labels[k]}: Rf ${rf2(s.rf)} is listed twice; drawn as one spot.`);
        continue;
      }
      merged.push(s);
    }
    merged.sort((a, b) => b.rf - a.rf);
    lanes.push({ label: labels[k], spots: merged });
  }
  return { ok: true, plate: { lanes, eluent, style: input.style ?? "uv", size, front, unit }, notes };
}
