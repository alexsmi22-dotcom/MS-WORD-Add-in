/**
 * Release E5c calculators, pure functions of the field reader (taskpane.ts declares the fields and calls these):
 *  - game-nash     two-player games: dominance, pure and mixed Nash equilibria, zero-sum value (nash.ts);
 *  - macro-solow   the Solow growth model in discrete time (macroModels.ts);
 *  - macro-islm    linear IS–LM with an AD–AS closure and a policy experiment (macroModels.ts);
 *  - macro-taylor  the Taylor (1993) rule, one reading or a series (macroModels.ts).
 *
 * Every worked default is invented (textbook-shaped numbers written for this module); nothing is copied.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import type { E3Field } from "./econE3Calcs";
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratSign, ratEq, ratIsZero, ratToNumber, parseRatLiteral, RAT_ZERO, RAT_ONE, CasBail } from "./cas";
import { parseRegData, readRegCell, isMissingCell } from "./regData";
import { fmtFixed, groupThousands, intText } from "./regTable";
import { buildPlotSvg, combineSvgs, type Series } from "./plot";
import {
  Game,
  Equilibrium,
  NASH_MAX,
  NASH_WALL_MS,
  NashTimeout,
  eliminate,
  pureEquilibria,
  enumerateSupports,
  degeneracyEvidence,
  constantSum,
  zeroSumValue,
  supportPairs,
  isEquilibrium,
} from "./nash";
import {
  SolowParams,
  SOLOW_T_MAX,
  solowSteady,
  solowPath,
  measuredHalfLife,
  IslmParams,
  islmCheck,
  islmSolve,
  islmMultipliers,
  adOutput,
  adPriceAt,
  taylorRate,
} from "./macroModels";

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;
const MINUS = "−";

// ---------------------------------------------------------------------------------------------------------------
// Readers and number text

/** The largest magnitude any field or payoff may have (and the smallest nonzero one). */
export const VALUE_MAX = 1e15;
export const VALUE_MIN = 1e-15;

const PLAIN = /^-?(\d+(\.\d*)?|\.\d+)$/;
const FRACTION = /^-?\d+\/\d+$/;
const ENOTATION = /^-?(\d+(\.\d*)?|\.\d+)[eE][-+]?\d+$/;
/** No-break, thin and narrow no-break spaces (built from code points so the source shows no invisible character). */
const SPACE_LIKE = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f)}]`, "g");

/**
 * A number typed by the user, as an EXACT rational: "0.1" is 1/10. Accepts a plain decimal, an integer fraction
 * ("2/3"), e-notation, a true minus (U+2212), a decimal comma by the product's table rule ("0,5", "1,5"; "1,500" groups
 * thousands), and "1.5×10⁻⁵". `percent` accepts a trailing % and divides by 100 (`percentAsIs` strips it and keeps the
 * number, for a field already in percent). Magnitudes beyond 10¹⁵, or nonzero below 10⁻¹⁵, are refused by name.
 */
export function readRat(raw: string, label: string, opts: { percent?: boolean; percentAsIs?: boolean; semicolon?: boolean } = {}): { value: Rat; percent: boolean; decimalComma: boolean } | { error: string } {
  let t = String(raw ?? "").replace(SPACE_LIKE, " ").trim();
  if (t === "") return { error: `${label} is empty.` };
  const shown = t;
  t = t.replace(/^[−–]/, "-").replace(/^\+/, "");
  let percent = false;
  if (t.endsWith("%")) {
    if (!opts.percent && !opts.percentAsIs) return { error: `${label}: ${q(shown)} is not a number (no % sign here).` };
    percent = true;
    t = t.slice(0, -1).trim();
  }
  let decimalComma = false;
  if (t.includes(",")) {
    const r = readRegCell(t, !!opts.semicolon);
    if (!Number.isFinite(r.value)) return { error: `${label}: ${q(shown)} is not a number.` };
    decimalComma = r.decimalComma;
    t = r.decimalComma ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  }
  let v: Rat | null = null;
  try {
    if (PLAIN.test(t) || FRACTION.test(t) || ENOTATION.test(t)) v = parseRatLiteral(t);
    else {
      // "1.5×10⁻⁵" and the other forms the shared cell reader takes, through the shortest decimal of its double.
      const r = readRegCell(t, !!opts.semicolon);
      if (Number.isFinite(r.value) && /×|x10|X10|·10/.test(t)) v = parseRatLiteral(String(r.value));
    }
  } catch (e) {
    if (!(e instanceof CasBail)) throw e;
    v = null;
  }
  if (!v) return { error: `${label}: ${q(shown)} is not a number.` };
  if (percent && opts.percent) v = ratDiv(v, { n: 100n, d: 1n });
  const a = Math.abs(ratToNumber(v));
  if (!(a <= VALUE_MAX)) return { error: `${label}: ${q(shown)} is too large (the limit is 10¹⁵ in magnitude).` };
  if (a !== 0 && a < VALUE_MIN) return { error: `${label}: ${q(shown)} is too small (nonzero values must be at least 10⁻¹⁵ in magnitude).` };
  return { value: v, percent, decimalComma };
}

const withMinus = (s: string): string => (s.startsWith("-") ? MINUS + s.slice(1) : s);

/** The exact decimal text of r when its denominator is 2ᵃ5ᵇ with at most `maxDp` places, else null. */
function exactDecimal(r: Rat, maxDp = 8): string | null {
  let d = r.d;
  let p2 = 0;
  let p5 = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    p2++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    p5++;
  }
  if (d !== 1n) return null;
  const dp = Math.max(p2, p5);
  if (dp > maxDp) return null;
  const neg = r.n < 0n;
  const scaled = ((neg ? -r.n : r.n) * 10n ** BigInt(dp)) / r.d;
  let s = scaled.toString();
  if (dp > 0) {
    s = s.padStart(dp + 1, "0");
    s = `${s.slice(0, s.length - dp)}.${s.slice(s.length - dp)}`;
  }
  s = groupThousands(s);
  return (neg ? MINUS : "") + s;
}

const fracText = (r: Rat): string => withMinus(`${r.n}/${r.d}`);

/** An exact value: a terminating decimal, a short fraction ("2/3"), else "≈" and six decimals. */
export function fmtExact(r: Rat): string {
  const dec = exactDecimal(r);
  if (dec !== null) return dec;
  const f = fracText(r);
  if (f.length <= 20) return f;
  return `≈ ${fmtFixed(ratToNumber(r), 6)}`;
}

/** An exact value with its decimal when it is a fraction: "5400/7 ≈ 771.4286". */
export function fmtExactDec(r: Rat, dp = 4): string {
  const dec = exactDecimal(r);
  if (dec !== null) return dec;
  const f = fracText(r);
  const approx = fmtFixed(ratToNumber(r), dp);
  if (f.length <= 20) return `${f} ≈ ${approx}`;
  return `≈ ${approx}`;
}

const R = (n: number): Rat => ({ n: BigInt(n), d: 1n });

const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
/** A whole number in subscript digits (k₁₀₀). */
const subDigits = (n: number): string => String(n).replace(/\d/g, (d) => SUB_DIGITS[Number(d)]);

// ---------------------------------------------------------------------------------------------------------------
// game-nash

export const GAME_NASH_FIELDS: E3Field[] = [
  {
    key: "row",
    label: "Row player's payoffs: a label in the corner (Row\\Col), the column strategies across the top, then one row per row strategy",
    kind: "block",
  },
  { key: "col", label: "Column player's payoffs: the same layout, the same strategy names in the same order", kind: "block" },
  {
    key: "elim",
    label: "Eliminate strictly dominated strategies",
    kind: "select",
    options: [
      { value: "pure", label: "Dominated by another pure strategy" },
      { value: "mixed", label: "Dominated by a pure strategy or a mixture" },
      { value: "none", label: "Do not eliminate" },
    ],
  },
];

export const GAME_NASH_DEFAULTS: Record<string, string> = {
  row: ["Row\\Col\tConcert\tStadium", "Concert\t3\t0", "Stadium\t0\t2"].join("\n"),
  col: ["Row\\Col\tConcert\tStadium", "Concert\t2\t0", "Stadium\t0\t3"].join("\n"),
  elim: "pure",
};

interface ParsedTable {
  corner: string;
  rows: string[];
  cols: string[];
  M: Rat[][];
  notes: string[];
}

function parsePayoffTable(text: string, who: string): ParsedTable | { error: string } {
  if (!String(text ?? "").trim()) return { error: `The ${who}'s payoff table is empty.` };
  const p = parseRegData(text);
  if (!p.ok) {
    const hint = /more cells than there are columns|has no name in the header row/.test(p.reason) ? " The corner cell above the row names needs a label (for example Row\\Col)." : "";
    return { error: `The ${who}'s payoff table: ${p.reason}${hint}` };
  }
  const d = p.data;
  if (!d.named) {
    return {
      error: `The ${who}'s payoff table needs a header row naming the column strategies (with a label such as Row\\Col in the corner); strategy names must not be numbers.`,
    };
  }
  if (d.names.length < 2) return { error: `The ${who}'s payoff table needs at least one column strategy after the row names.` };
  const cols = d.names.slice(1);
  const rows = d.rows.map((r) => r[0]);
  if (rows.length > NASH_MAX || cols.length > NASH_MAX) {
    return { error: `The ${who}'s payoff table is ${rows.length} × ${cols.length}; the largest game handled is ${NASH_MAX} × ${NASH_MAX} (support enumeration grows as 4ⁿ).` };
  }
  for (const [i, nm] of rows.entries()) {
    if (!nm || isMissingCell(nm)) return { error: `Row ${i + 1} of the ${who}'s payoff table has no strategy name in its first cell.` };
    const v = readRegCell(nm, !!d.semicolon).value;
    if (Number.isFinite(v)) return { error: `Row ${i + 1} of the ${who}'s payoff table starts with the number ${q(nm)}; the first cell of each row is the row strategy's name.` };
  }
  const dup = (xs: string[]): string | undefined => xs.find((x, i) => xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) !== i);
  const dr = dup(rows);
  if (dr) return { error: `The row strategy ${q(dr)} appears twice in the ${who}'s payoff table.` };
  const dc = dup(cols);
  if (dc) return { error: `The column strategy ${q(dc)} appears twice in the ${who}'s payoff table.` };
  const M: Rat[][] = [];
  const notes: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const out: Rat[] = [];
    for (let j = 0; j < cols.length; j++) {
      const cell = d.rows[i][j + 1];
      const where = `the ${who}'s payoff at (${rows[i]}, ${cols[j]})`;
      if (isMissingCell(cell)) return { error: `${where[0].toUpperCase()}${where.slice(1)} is empty or missing; every cell needs a number.` };
      const r = readRat(cell, where[0].toUpperCase() + where.slice(1), { semicolon: !!d.semicolon });
      if ("error" in r) return { error: r.error };
      // "3,1" is a decimal comma (3.1), never a payoff pair: say so once, since a pasted bimatrix would be misread.
      if (r.decimalComma && !d.semicolon && !notes.length) {
        notes.push(`${q(cell)} at (${rows[i]}, ${cols[j]}) in the ${who}'s table was read as ${fmtExact(r.value)} (a decimal comma); each player's payoffs go in their own table, one number per cell.`);
      }
      out.push(r.value);
    }
    M.push(out);
  }
  return { corner: d.names[0], rows, cols, M, notes };
}

function mixText(names: string[], w: Rat[]): string {
  const parts = w.map((v, i) => ({ v, i })).filter((t) => ratSign(t.v) > 0);
  if (parts.length === 1) return names[parts[0].i];
  return parts.map((t) => `${names[t.i]} ${fmtExact(t.v)}`).join(", ");
}

/** Both payoff tables read into one game (same shape, same names in the same order), or the refusal. */
export function parseGame(rowText: string, colText: string): { game: Game; corner: string; notes: string[] } | { error: string } {
  const a = parsePayoffTable(rowText, "row player");
  if ("error" in a) return a;
  const b = parsePayoffTable(colText, "column player");
  if ("error" in b) return b;
  if (a.rows.length !== b.rows.length || a.cols.length !== b.cols.length) {
    return { error: `The two payoff tables have different shapes: ${a.rows.length} × ${a.cols.length} for the row player and ${b.rows.length} × ${b.cols.length} for the column player.` };
  }
  for (let i = 0; i < a.rows.length; i++) {
    if (a.rows[i].toLowerCase() !== b.rows[i].toLowerCase()) return { error: `Row ${i + 1} is ${q(a.rows[i])} in the row player's table but ${q(b.rows[i])} in the column player's; use the same names in the same order.` };
  }
  for (let j = 0; j < a.cols.length; j++) {
    if (a.cols[j].toLowerCase() !== b.cols[j].toLowerCase()) return { error: `Column ${j + 1} is ${q(a.cols[j])} in the row player's table but ${q(b.cols[j])} in the column player's; use the same names in the same order.` };
  }
  return { game: { rowNames: a.rows, colNames: a.cols, A: a.M, B: b.M }, corner: a.corner, notes: [...a.notes, ...b.notes] };
}

/** game-nash run with an explicit wall clock (tests pass a negative one to see the refusal). */
export function gameNashRun(rowText: string, colText: string, elimMode: string, wallMs = NASH_WALL_MS): StatOutput {
  if (!["pure", "mixed", "none"].includes(elimMode)) return refuse(`Unknown elimination choice ${q(elimMode)}.`);
  const parsed = parseGame(rowText, colText);
  if ("error" in parsed) return refuse(parsed.error);
  const g = parsed.game;
  const corner = parsed.corner;
  const m = g.rowNames.length;
  const n = g.colNames.length;
  const started = Date.now();
  let el;
  let en;
  try {
    el = elimMode === "none" ? { rows: g.rowNames.map((_, i) => i), cols: g.colNames.map((_, j) => j), steps: [] } : eliminate(g, elimMode === "mixed", wallMs);
    en = enumerateSupports(g, el.rows, el.cols, wallMs - (Date.now() - started));
  } catch (e) {
    if (e instanceof NashTimeout) {
      return refuse(
        `The equilibrium search stopped at the ${(Math.max(0, wallMs) / 1000).toFixed(0)} s limit while ${e.message} (${intText(supportPairs(m, n))} support pairs for a ${m} × ${n} game). Remove dominated or irrelevant strategies and try again.`,
      );
    }
    throw e;
  }
  const pures = pureEquilibria(g);
  const eqs = en.equilibria;
  // The pure equilibria found directly must be exactly the size-1 supports the enumeration found.
  const enumPure = eqs.filter((e) => e.pure);
  const samePure =
    enumPure.length === pures.length &&
    pures.every(([i, j]) => enumPure.some((e) => ratEq(e.x[i], RAT_ONE) && ratEq(e.y[j], RAT_ONE)));
  if (!samePure) throw new Error("game-nash: the direct pure-equilibrium check and the support enumeration disagree");
  for (const e of eqs) if (!isEquilibrium(g, e.x, e.y)) throw new Error("game-nash: an equilibrium failed verification");
  eqs.sort((u, v) => (u.pure === v.pure ? 0 : u.pure ? -1 : 1));
  const degen = degeneracyEvidence(g, eqs);
  // Wilson (1971): a nondegenerate game has an odd number of equilibria, so an even count proves degeneracy.
  if (eqs.length % 2 === 0) degen.push(`${eqs.length === 0 ? "no" : "an even number of"} equilibri${eqs.length === 0 ? "um was" : "a were"} found at equal-size supports, while a nondegenerate game has an odd number (Wilson 1971)`);
  const caution = en.singular > 0;
  const nPure = eqs.filter((e) => e.pure).length;
  const nMixed = eqs.length - nPure;

  const lines: string[] = [];
  const countText = `${eqs.length} Nash equilibri${eqs.length === 1 ? "um" : "a"} (${nPure} pure, ${nMixed} mixed)`;
  lines.push(`Two-player game, ${m} × ${n}: ${degen.length || caution ? `${countText} found` : countText}`);
  eqs.forEach((e, k) => {
    if (e.pure) {
      const i = e.x.findIndex((v) => ratEq(v, RAT_ONE));
      const j = e.y.findIndex((v) => ratEq(v, RAT_ONE));
      lines.push(`Equilibrium ${k + 1} (pure): ${g.rowNames[i]}, ${g.colNames[j]}; payoffs ${fmtExact(e.u1)} to the row player and ${fmtExact(e.u2)} to the column player.`);
    } else {
      lines.push(
        `Equilibrium ${k + 1} (mixed): row player ${mixText(g.rowNames, e.x)}; column player ${mixText(g.colNames, e.y)}; expected payoffs ${fmtExact(e.u1)} and ${fmtExact(e.u2)}.`,
      );
    }
  });
  if (!eqs.length) lines.push("No equilibrium was found at equal-size supports; every finite game has one (Nash 1951), so this game is degenerate (see below) and its equilibria lie where the enumeration does not look.");

  // Elimination
  const nameOf = (player: "row" | "col", i: number): string => (player === "row" ? g.rowNames[i] : g.colNames[i]);
  const elimRows: string[][] = [["Step", "Player", "Strategy removed", "Strictly dominated by"]];
  el.steps.forEach((s, k) => {
    const by = "pure" in s.by ? nameOf(s.player, s.by.pure) : s.by.mix.map((t) => `${fmtExact(t.w)} ${nameOf(s.player, t.idx)}`).join(" + ");
    elimRows.push([String(k + 1), s.player === "row" ? "Row" : "Column", nameOf(s.player, s.removed), by]);
  });
  if (elimMode !== "none") {
    if (el.steps.length) {
      const left = `${el.rows.map((i) => g.rowNames[i]).join(", ")} × ${el.cols.map((j) => g.colNames[j]).join(", ")}`;
      lines.push(`Iterated elimination of strictly dominated strategies removed ${el.steps.length} strateg${el.steps.length === 1 ? "y" : "ies"}; ${left} remain${el.rows.length * el.cols.length === 1 ? "s (the game is dominance solvable)" : ""}.`);
    } else {
      lines.push(`No strategy is strictly dominated${elimMode === "mixed" ? " by a pure strategy or a mixture" : " by another pure strategy"}.`);
    }
  }

  // Zero-sum / constant-sum value
  const cs = constantSum(g);
  let zs: ReturnType<typeof zeroSumValue> | null = null;
  if (cs) {
    zs = zeroSumValue(g.A);
    for (const e of eqs) if (!ratEq(e.u1, zs.value)) throw new Error("game-nash: an equilibrium payoff differs from the LP value");
    const kind = ratIsZero(cs) ? "zero-sum" : `constant-sum (the payoffs add to ${fmtExact(cs)} in every cell, strategically a zero-sum game)`;
    lines.push(
      `The game is ${kind}. Value by linear programming: ${fmtExact(zs.value)} to the row player${ratIsZero(cs) ? "" : `, ${fmtExact(ratSub(cs, zs.value))} to the column player`}; ` +
        `a maximin row strategy is ${mixText(g.rowNames, zs.x)} and a minimax column strategy is ${mixText(g.colNames, zs.y)}.`,
    );
  }

  lines.push("");
  lines.push(...parsed.notes);
  lines.push(
    "Conventions: payoffs are von Neumann–Morgenstern utilities; a mixed strategy's payoff is its expected payoff. A strategy is strictly dominated when another strategy" +
      (elimMode === "mixed" ? " (pure, or a mixture found by an exact linear program)" : "") +
      " pays strictly more against every remaining strategy of the opponent; strictly dominated strategies are never played in any equilibrium and the order of removal does not change what survives. Weak dominance is not used.",
  );
  lines.push(
    `Equilibria by support enumeration (von Stengel 2007, Algorithmic Game Theory §3.4) over the ${elimMode === "none" ? "full game" : "strategies that survive elimination"}: for each pair of supports of equal size the opponent's mix must make each player indifferent over the support. ` +
      `${intText(en.pairs)} support pair${en.pairs === 1 ? "" : "s"} examined, in exact rational arithmetic; every equilibrium printed is verified against the full game (no pure strategy pays strictly more).`,
  );
  const skipped = `${intText(en.singular)} support pair${en.singular === 1 ? " was" : "s were"} skipped because ${en.singular === 1 ? "its" : "their"} indifference system${en.singular === 1 ? " has" : "s have"} infinitely many solutions`;
  if (degen.length) {
    lines.push(
      `The game is DEGENERATE (${degen.join("; ")}${caution ? `; ${skipped}` : ""}). A degenerate game can have a continuum of equilibria; the list above is what the enumeration found at equal-size supports with a unique solution, and it may not be all of them.`,
    );
  } else if (caution) {
    lines.push(`No degeneracy was proved, but ${skipped}; the game may be degenerate there, so the list may not be all of the equilibria.`);
  } else {
    lines.push(
      `No degeneracy was detected by the tests used (no pure strategy has two pure best responses, no found equilibrium has more pure best responses than the opponent's support size, no support pair has infinitely many indifference solutions, and the count is odd). For a nondegenerate game support enumeration finds every equilibrium, and their number is odd (here ${eqs.length}).`,
    );
  }
  if (m === 2 && n === 2) lines.push(`Figure: p is the probability that the row player plays ${g.rowNames[0]} and q the probability that the column player plays ${g.colNames[0]}.`);

  // Tables
  const pureSet = new Set(pures.map(([i, j]) => `${i},${j}`));
  const payRows: string[][] = [[corner, ...g.colNames]];
  for (let i = 0; i < m; i++) payRows.push([g.rowNames[i], ...g.colNames.map((_, j) => `${fmtExact(g.A[i][j])}, ${fmtExact(g.B[i][j])}${pureSet.has(`${i},${j}`) ? " *" : ""}`)]);
  const eqRows: string[][] = [["Equilibrium", "Type", "Row player's strategy", "Column player's strategy", "Row payoff", "Column payoff"]];
  eqs.forEach((e, k) => eqRows.push([String(k + 1), e.pure ? "Pure" : "Mixed", mixText(g.rowNames, e.x), mixText(g.colNames, e.y), fmtExact(e.u1), fmtExact(e.u2)]));
  const tables: StatTable[] = [
    {
      label: "Payoffs (row player, column player)",
      rows: payRows,
      align: ["left", ...g.colNames.map((): "center" => "center")],
      note: pures.length ? "* marks a pure Nash equilibrium." : "No cell is a pure Nash equilibrium.",
    },
  ];
  if (eqs.length) tables.push({ label: "Nash equilibria", rows: eqRows, align: ["left", "left", "left", "left", "right", "right"], note: "A mixed strategy lists the probability of each strategy it plays." });
  if (el.steps.length) tables.push({ label: "Iterated elimination of strictly dominated strategies", rows: elimRows, align: ["left", "left", "left", "left"] });

  const out: StatOutput = { text: lines.join("\n"), tables };
  if (m === 2 && n === 2) out.svg = bestResponseSvg(g, eqs);
  return out;
}

/** Best-response correspondences of a 2 × 2 game in (p, q), equilibria marked. */
function bestResponseSvg(g: Game, eqs: Equilibrium[]): string {
  const num = ratToNumber;
  const series: Series[] = [];
  const rowColor = "#0369a1";
  const colColor = "#b45309";
  let rowLabelled = false;
  let colLabelled = false;
  const seg = (pts: { x: number; y: number }[], color: string, who: "row" | "col"): void => {
    let label: string | undefined;
    // Short legend names (the title says these are best responses): longer ones are cut with "…" in the legend.
    if (who === "row" && !rowLabelled) {
      label = "Row player";
      rowLabelled = true;
    }
    if (who === "col" && !colLabelled) {
      label = "Column player";
      colLabelled = true;
    }
    series.push({ type: "line", points: pts, color, label });
  };
  // Row player: diff(q) = payoff(row 1) − payoff(row 2) = (A11 − A21)q + (A12 − A22)(1 − q).
  const d1 = ratSub(g.A[0][0], g.A[1][0]);
  const d0 = ratSub(g.A[0][1], g.A[1][1]);
  breakpointsAndDraw(d0, d1, (lo, hi, sign) => {
    if (sign > 0) seg([{ x: 1, y: lo }, { x: 1, y: hi }], rowColor, "row");
    else if (sign < 0) seg([{ x: 0, y: lo }, { x: 0, y: hi }], rowColor, "row");
  }, (at) => seg([{ x: 0, y: at }, { x: 1, y: at }], rowColor, "row"), (lo, hi) => {
    // Indifferent on a whole interval: every p is a best response there.
    seg([{ x: 0, y: lo }, { x: 0, y: hi }], rowColor, "row");
    seg([{ x: 1, y: lo }, { x: 1, y: hi }], rowColor, "row");
    seg([{ x: 0, y: lo }, { x: 1, y: lo }], rowColor, "row");
    seg([{ x: 0, y: hi }, { x: 1, y: hi }], rowColor, "row");
  });
  // Column player: diff(p) = payoff(col 1) − payoff(col 2) = (B11 − B12)p + (B21 − B22)(1 − p).
  const e1 = ratSub(g.B[0][0], g.B[0][1]);
  const e0 = ratSub(g.B[1][0], g.B[1][1]);
  breakpointsAndDraw(e0, e1, (lo, hi, sign) => {
    if (sign > 0) seg([{ x: lo, y: 1 }, { x: hi, y: 1 }], colColor, "col");
    else if (sign < 0) seg([{ x: lo, y: 0 }, { x: hi, y: 0 }], colColor, "col");
  }, (at) => seg([{ x: at, y: 0 }, { x: at, y: 1 }], colColor, "col"), (lo, hi) => {
    seg([{ x: lo, y: 0 }, { x: lo, y: 1 }], colColor, "col");
    seg([{ x: hi, y: 0 }, { x: hi, y: 1 }], colColor, "col");
    seg([{ x: lo, y: 0 }, { x: hi, y: 0 }], colColor, "col");
    seg([{ x: lo, y: 1 }, { x: hi, y: 1 }], colColor, "col");
  });
  if (eqs.length) series.push({ type: "scatter", points: eqs.map((e) => ({ x: num(e.x[0]), y: num(e.y[0]) })), color: "#15803d", label: "Nash equilibria" });
  return buildPlotSvg(series, {
    width: 400,
    height: 300,
    title: "Best-response correspondences",
    xlabel: `p = P(row plays ${g.rowNames[0]}) (probability)`,
    ylabel: `q = P(column plays ${g.colNames[0]}) (probability)`,
    // A small margin so the correspondences on p, q = 0 or 1 and equilibria in the corners are not drawn on the frame.
    xLimits: { min: -0.05, max: 1.05 },
    yLimits: { min: -0.05, max: 1.05 },
  });
}

/**
 * For a linear diff(t) = c0(1 − t) + c1·t on [0, 1]: calls `interval(lo, hi, sign)` for each open piece of constant
 * sign, `point(t)` where diff crosses zero at an isolated t, and `flat(0, 1)` when diff is zero throughout.
 */
function breakpointsAndDraw(c0: Rat, c1: Rat, interval: (lo: number, hi: number, sign: number) => void, point: (t: number) => void, flat: (lo: number, hi: number) => void): void {
  if (ratIsZero(c0) && ratIsZero(c1)) {
    flat(0, 1);
    return;
  }
  const slope = ratSub(c1, c0);
  let t0: Rat | null = null;
  if (!ratIsZero(slope)) {
    const t = ratDiv(ratSub(RAT_ZERO, c0), slope);
    if (ratSign(t) >= 0 && ratSign(ratSub(t, RAT_ONE)) <= 0) t0 = t;
  }
  if (!t0) {
    interval(0, 1, ratSign(ratIsZero(c0) ? c1 : c0));
    return;
  }
  const z = ratToNumber(t0);
  if (z > 0) interval(0, z, ratSign(c0));
  point(z);
  if (z < 1) interval(z, 1, ratSign(c1));
}

/** game-nash. */
export function gameNashCalc(read: Read): StatOutput {
  const get = (k: string): string => String(read(k) ?? "");
  return gameNashRun(get("row"), get("col"), get("elim") || "pure");
}

// ---------------------------------------------------------------------------------------------------------------
// macro-solow

export const MACRO_SOLOW_FIELDS: E3Field[] = [
  { key: "alpha", label: "Capital share α (0 < α < 1)", kind: "text" },
  { key: "s", label: "Saving rate s (0.25 or 25%)", kind: "text" },
  { key: "n", label: "Population growth n per period", kind: "text" },
  { key: "g", label: "Technology growth g per period", kind: "text" },
  { key: "delta", label: "Depreciation rate δ per period", kind: "text" },
  { key: "k0", label: "Starting capital per effective worker k₀", kind: "text" },
  { key: "T", label: "Periods to simulate T", kind: "text" },
];

export const MACRO_SOLOW_DEFAULTS: Record<string, string> = {
  alpha: "0.3",
  s: "0.25",
  n: "0.01",
  g: "0.02",
  delta: "0.05",
  k0: "1",
  T: "100",
};

function readNumber(raw: string, label: string, percent: boolean): { value: number; percent: boolean } | { error: string } {
  const r = readRat(raw, label, { percent });
  if ("error" in r) return r;
  return { value: ratToNumber(r.value), percent: r.percent };
}

/** macro-solow. */
export function macroSolowCalc(read: Read): StatOutput {
  const get = (k: string): string => String(read(k) ?? "");
  const vals: Record<string, number> = {};
  const pctUsed: string[] = [];
  const specs: [string, string][] = [
    ["alpha", "The capital share α"],
    ["s", "The saving rate s"],
    ["n", "Population growth n"],
    ["g", "Technology growth g"],
    ["delta", "The depreciation rate δ"],
    ["k0", "Starting capital k₀"],
  ];
  for (const [k, label] of specs) {
    const r = readNumber(get(k), label, k !== "k0");
    if ("error" in r) return refuse(r.error);
    vals[k] = r.value;
    if (r.percent) pctUsed.push(label.charAt(0).toLowerCase() + label.slice(1));
  }
  const tRaw = get("T").trim().replace(/,/g, "");
  if (!/^\d+$/.test(tRaw)) return refuse(`Periods to simulate T: ${q(get("T"))} is not a whole number of periods.`);
  const T = Number(tRaw);
  if (T < 1 || T > SOLOW_T_MAX) return refuse(`Periods to simulate T must be from 1 to ${intText(SOLOW_T_MAX)}.`);
  const p: SolowParams = { alpha: vals.alpha, s: vals.s, n: vals.n, g: vals.g, delta: vals.delta };
  if (!(vals.k0 > 0)) return refuse("Starting capital k₀ must be greater than zero.");
  const ss = solowSteady(p);
  if ("error" in ss) return refuse(ss.error);
  const k = solowPath(p, vals.k0, T);
  for (let t = 0; t <= T; t++) if (!Number.isFinite(k[t]) || k[t] <= 0) return refuse(`The simulated capital stock is not a finite positive number at period ${t}.`);
  // The half-life checked on the map itself: a path started 0.1% above k* (where the linearisation is accurate).
  const probeT = Math.min(SOLOW_T_MAX, Math.max(50, Math.ceil(ss.halfLife * 3) + 5));
  const probe = solowPath(p, ss.kStar * 1.001, probeT);
  const probeHalf = measuredHalfLife(probe, ss.kStar);
  // A start within 10⁻¹² of k* (relative) is the steady state: the rounding of k* itself is not a gap to halve.
  const atSteady = Math.abs(vals.k0 - ss.kStar) <= 1e-12 * ss.kStar;
  const userHalf = atSteady ? null : measuredHalfLife(k, ss.kStar);
  // Per-period gap ratio at the end of the user's path, when the gap is still measurable.
  let endRatio: number | null = null;
  for (let t = T; t >= 1; t--) {
    const g1 = k[t] - ss.kStar;
    const g0 = k[t - 1] - ss.kStar;
    if (Math.abs(g0) > 1e-7 * ss.kStar && Math.abs(g1) > 1e-9 * ss.kStar) {
      endRatio = g1 / g0; // the last period with a measurable gap
      break;
    }
  }
  const f = (v: number, d = 4): string => fmtFixed(v, d);
  const y = (kt: number): number => Math.pow(kt, p.alpha);

  const lines: string[] = [];
  lines.push(`Solow model (discrete time, per effective worker): k* = ${f(ss.kStar)}, y* = ${f(ss.yStar)}, c* = ${f(ss.cStar)}`);
  lines.push(`Golden rule: s = α = ${f(ss.sGold, 3)}, k(gold) = ${f(ss.kGold)}, c(gold) = ${f(ss.cGold)} (${vals.s < ss.sGold ? "saving is below the golden rule: more saving would raise steady-state consumption" : vals.s > ss.sGold ? "saving is above the golden rule (dynamic inefficiency): less saving would raise consumption in every period" : "saving is at the golden rule"}).`);
  lines.push(
    `Convergence near k*: φ′(k*) = ${f(ss.phi, 6)}, λ = −ln φ′ = ${f(ss.lambda, 6)} a period, half-life ln 2/λ = ${f(ss.halfLife, 2)} periods.` +
      (probeHalf !== null ? ` Check on the simulated map: from 0.1% above k* the gap first falls to half in period ${probeHalf}.` : ""),
  );
  lines.push(
    `From k₀ = ${f(vals.k0)}: k${subDigits(T)} = ${f(k[T])} (${f((k[T] / ss.kStar - 1) * 100, 3)}% from k*)` +
      (userHalf !== null ? `; the gap to k* first halved in period ${userHalf}` : atSteady ? "; the path starts at the steady state" : "; the gap did not halve within the simulation") +
      (endRatio !== null ? `; the last measurable per-period gap ratio is ${f(endRatio, 6)} (it tends to φ′)` : "") +
      ".",
  );
  lines.push("");
  lines.push(
    "Conventions: y = kᵅ (Cobb–Douglas), all per effective worker. Discrete time: k₍ₜ₊₁₎ = (s·kₜᵅ + (1 − δ)kₜ)/((1 + n)(1 + g)). " +
      `Its steady state solves s·kᵅ = (n + g + ng + δ)k, so k* is s/(n + g + ng + δ) raised to the power 1/(1 − α), with n + g + ng + δ = ${f(ss.D, 6)}; the continuous-time model's break-even rate n + g + δ omits ng. c = (1 − s)y.`,
  );
  lines.push("Golden rule: maximising c* = kᵅ − (n + g + ng + δ)k gives s = α, and k(gold) is α/(n + g + ng + δ) raised to the power 1/(1 − α).");
  lines.push(
    "Convergence: φ′(k*) = (α(n + g + ng + δ) + 1 − δ)/((1 + n)(1 + g)) is the slope of the map at k*; near k* the gap shrinks by that factor each period, so the half-life ln 2/(−ln φ′) is a local measure that is exact as kₜ approaches k* (a path far from k* halves its gap at a different pace). " +
      (Number.isFinite(ss.halfLifeC) ? `The continuous-time approximation λ ≈ (1 − α)(n + g + δ) = ${f(ss.lambdaC, 6)} gives ${f(ss.halfLifeC, 2)} periods.` : "The continuous-time approximation (1 − α)(n + g + δ) is not positive here, so it gives no half-life."),
  );
  if (pctUsed.length) lines.push(`Read as percent and divided by 100: ${pctUsed.join(", ")}.`);
  if (p.n < 0 || p.g < 0) lines.push("A negative growth rate is allowed as long as n + g + ng + δ stays positive.");

  // Steady-state table
  const ssRows: string[][] = [
    ["Quantity", "Value"],
    ["k* (capital per effective worker)", f(ss.kStar)],
    ["y* = (k*)ᵅ (output per effective worker)", f(ss.yStar)],
    ["c* = (1 − s)y*", f(ss.cStar)],
    ["Investment s·y* = (n + g + ng + δ)k*", f(vals.s * ss.yStar)],
    ["Break-even rate n + g + ng + δ", f(ss.D, 6)],
    ["Golden-rule saving s = α", f(ss.sGold, 4)],
    ["k(gold)", f(ss.kGold)],
    ["y(gold)", f(ss.yGold)],
    ["c(gold) = (1 − α)y(gold)", f(ss.cGold)],
    ["φ′(k*)", f(ss.phi, 6)],
    ["λ = −ln φ′ (per period)", f(ss.lambda, 6)],
    ["Half-life ln 2/λ (periods)", f(ss.halfLife, 2)],
    ["Continuous-time approximation (1 − α)(n + g + δ)", f(ss.lambdaC, 6)],
  ];
  if (Number.isFinite(ss.halfLifeC)) ssRows.push(["Approximate half-life ln 2/((1 − α)(n + g + δ)) (periods)", f(ss.halfLifeC, 2)]);
  // Path table at selected periods
  const marks = new Set<number>([0, 1, 2, 3, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, T]);
  if (T <= 20) for (let t = 0; t <= T; t++) marks.add(t);
  if (probeHalf !== null) marks.add(Math.round(ss.halfLife));
  const sel = [...marks].filter((t) => t >= 0 && t <= T).sort((u, v) => u - v);
  const pathRows: string[][] = [["Period t", "kₜ", "yₜ", "cₜ", "Gap to k* (%)"]];
  for (const t of sel) pathRows.push([intText(t), f(k[t]), f(y(k[t])), f((1 - vals.s) * y(k[t])), f((k[t] / ss.kStar - 1) * 100, 3)]);
  const tables: StatTable[] = [
    { label: "Steady state and convergence (discrete time)", rows: ssRows, align: ["left", "right"] },
    { label: `Simulated path from k₀ = ${f(vals.k0)} (selected periods)`, rows: pathRows, align: ["left", "right", "right", "right", "right"] },
  ];

  // Figures
  const step = T > 2000 ? Math.ceil(T / 2000) : 1;
  const kPts: { x: number; y: number }[] = [];
  const yPts: { x: number; y: number }[] = [];
  for (let t = 0; t <= T; t += step) {
    kPts.push({ x: t, y: k[t] });
    yPts.push({ x: t, y: y(k[t]) });
  }
  if (T % step !== 0) {
    kPts.push({ x: T, y: k[T] });
    yPts.push({ x: T, y: y(k[T]) });
  }
  const pathSvg = buildPlotSvg(
    [
      { type: "line", points: kPts, color: "#0369a1", label: "kₜ" },
      { type: "line", points: yPts, color: "#b45309", label: "yₜ" },
      { type: "line", points: [{ x: 0, y: ss.kStar }, { x: T, y: ss.kStar }], color: "#7dd3fc", label: "k*" },
      { type: "line", points: [{ x: 0, y: ss.yStar }, { x: T, y: ss.yStar }], color: "#fcd34d", label: "y*" },
    ],
    { width: 420, height: 260, title: "Convergence to the steady state", xlabel: "Period t", ylabel: "Per effective worker (units of output)" },
  );
  const kMax = 2 * Math.max(ss.kStar, ss.kGold, Math.min(vals.k0, 5 * Math.max(ss.kStar, ss.kGold)));
  const sf: { x: number; y: number }[] = [];
  const fk: { x: number; y: number }[] = [];
  for (let i = 0; i <= 200; i++) {
    const kk = (kMax * i) / 200;
    sf.push({ x: kk, y: vals.s * Math.pow(kk, p.alpha) });
    fk.push({ x: kk, y: Math.pow(kk, p.alpha) });
  }
  const diagNotes: string[] = [];
  const yTop = Math.pow(kMax, p.alpha) * 1.05;
  if (vals.k0 > kMax) diagNotes.push(`k₀ = ${f(vals.k0)} is beyond the plotted range.`);
  const diagSvg = buildPlotSvg(
    [
      { type: "line", points: fk, color: "#94a3b8", label: "f(k) = kᵅ" },
      { type: "line", points: sf, color: "#0369a1", label: "s·f(k)" },
      // Stopped at the top of the frame when it would leave it (the line is steeper than f at large k).
      { type: "line", points: [{ x: 0, y: 0 }, { x: Math.min(kMax, yTop / ss.D), y: Math.min(ss.D * kMax, yTop) }], color: "#b91c1c", label: "(n + g + ng + δ)k" },
      { type: "scatter", points: [{ x: ss.kStar, y: vals.s * ss.yStar }], color: "#15803d", label: "Steady state k*" },
    ],
    {
      width: 420,
      height: 260,
      title: "Saving and break-even investment",
      xlabel: "k (capital per effective worker)",
      ylabel: "Per effective worker (units of output)",
      yLimits: { min: 0, max: yTop },
      xLimits: { min: 0, max: kMax },
      notes: diagNotes.length ? diagNotes : undefined,
    },
  );
  return { text: lines.join("\n"), tables, svg: combineSvgs([pathSvg, diagSvg]).svg };
}

// ---------------------------------------------------------------------------------------------------------------
// macro-islm

export const MACRO_ISLM_FIELDS: E3Field[] = [
  { key: "C0", label: "Autonomous consumption C₀", kind: "text" },
  { key: "c", label: "Marginal propensity to consume c (0 ≤ c < 1)", kind: "text" },
  { key: "T", label: "Taxes T", kind: "text" },
  { key: "I0", label: "Autonomous investment I₀", kind: "text" },
  { key: "b", label: "Investment sensitivity b (per percentage point of r)", kind: "text" },
  { key: "G", label: "Government spending G", kind: "text" },
  { key: "M", label: "Money supply M", kind: "text" },
  { key: "P", label: "Price level P", kind: "text" },
  { key: "k", label: "Money demand: income sensitivity k", kind: "text" },
  { key: "h", label: "Money demand: interest sensitivity h (per percentage point)", kind: "text" },
  { key: "dG", label: "Policy: change in G (ΔG)", kind: "text" },
  { key: "dT", label: "Policy: change in T (ΔT)", kind: "text" },
  { key: "dM", label: "Policy: change in M (ΔM)", kind: "text" },
  {
    key: "as",
    label: "Aggregate supply",
    kind: "select",
    options: [
      { value: "horizontal", label: "Horizontal at P (short run, fixed prices)" },
      { value: "vertical", label: "Vertical at full-employment output Yₚ (long run)" },
    ],
  },
  { key: "Yf", label: "Full-employment output Yₚ (vertical AS)", kind: "text" },
];

export const MACRO_ISLM_DEFAULTS: Record<string, string> = {
  C0: "200",
  c: "0.75",
  T: "200",
  I0: "300",
  b: "25",
  G: "250",
  M: "600",
  P: "1",
  k: "0.5",
  h: "50",
  dG: "50",
  dT: "0",
  dM: "0",
  as: "horizontal",
  Yf: "1800",
};

/** macro-islm. */
export function macroIslmCalc(read: Read): StatOutput {
  const get = (k: string): string => String(read(k) ?? "");
  const labels: Record<string, string> = {
    C0: "Autonomous consumption C₀",
    c: "The marginal propensity to consume c",
    T: "Taxes T",
    I0: "Autonomous investment I₀",
    b: "The investment sensitivity b",
    G: "Government spending G",
    M: "The money supply M",
    P: "The price level P",
    k: "The income sensitivity k",
    h: "The interest sensitivity h",
    dG: "The change in G",
    dT: "The change in T",
    dM: "The change in M",
    Yf: "Full-employment output Yₚ",
  };
  const v: Record<string, Rat> = {};
  for (const key of ["C0", "c", "T", "I0", "b", "G", "M", "P", "k", "h", "dG", "dT", "dM"]) {
    const raw = get(key);
    if (["dG", "dT", "dM"].includes(key) && raw.trim() === "") {
      v[key] = RAT_ZERO;
      continue;
    }
    const r = readRat(raw, labels[key]);
    if ("error" in r) return refuse(r.error);
    v[key] = r.value;
  }
  const asType = get("as") || "horizontal";
  if (asType !== "horizontal" && asType !== "vertical") return refuse(`Unknown aggregate supply ${q(asType)}.`);
  let Yf: Rat | null = null;
  if (asType === "vertical") {
    const r = readRat(get("Yf"), labels.Yf);
    if ("error" in r) return refuse(r.error);
    if (ratSign(r.value) <= 0) return refuse("Full-employment output Yₚ must be greater than zero.");
    Yf = r.value;
  }
  const p0: IslmParams = { C0: v.C0, c: v.c, T: v.T, I0: v.I0, b: v.b, G: v.G, M: v.M, P: v.P, k: v.k, h: v.h };
  const p1: IslmParams = { ...p0, G: ratAdd(v.G, v.dG), T: ratAdd(v.T, v.dT), M: ratAdd(v.M, v.dM) };
  const bad = islmCheck(p0);
  if (bad) return refuse(bad);
  if (ratSign(p1.M) < 0) return refuse("The policy makes the money supply negative (M + ΔM < 0).");
  const s0 = islmSolve(p0);
  const s1 = islmSolve(p1);
  if (ratSign(s0.Y) <= 0) return refuse(`There is no positive-output equilibrium: these parameters give Y* = ${fmtExactDec(s0.Y)}.`);
  if (ratSign(s1.Y) <= 0) return refuse(`After the policy change there is no positive-output equilibrium: Y* = ${fmtExactDec(s1.Y)}.`);
  const mu = islmMultipliers(p0);
  const policy = !ratIsZero(v.dG) || !ratIsZero(v.dT) || !ratIsZero(v.dM);
  const X = fmtExactDec;
  const one_c = ratSub(RAT_ONE, v.c);

  const lines: string[] = [];
  lines.push(`IS–LM equilibrium: Y* = ${X(s0.Y)}, r* = ${X(s0.r)}% (consumption ${X(s0.C)}, investment ${X(s0.I)}, real balances M/P = ${X(s0.m)})`);
  const dY = ratSub(s1.Y, s0.Y);
  const dr = ratSub(s1.r, s0.r);
  const keynes = ratDiv(ratSub(v.dG, ratMul(v.c, v.dT)), one_c);
  if (policy) {
    const what = [
      ratIsZero(v.dG) ? "" : `ΔG = ${X(v.dG)}`,
      ratIsZero(v.dT) ? "" : `ΔT = ${X(v.dT)}`,
      ratIsZero(v.dM) ? "" : `ΔM = ${X(v.dM)}`,
    ].filter(Boolean).join(", ");
    lines.push(
      `Policy (${what}): Y* ${X(s0.Y)} → ${X(s1.Y)} (ΔY = ${X(dY)}), r* ${X(s0.r)}% → ${X(s1.r)}% (Δr = ${X(dr)} percentage points), investment changes by ${X(ratSub(s1.I, s0.I))}.`,
    );
    if (!ratIsZero(v.dG) || !ratIsZero(v.dT)) {
      lines.push(`With r held fixed (Keynesian cross, no crowding out) the fiscal change alone would move Y by (ΔG − cΔT)/(1 − c) = ${X(keynes)}.`);
    }
  } else {
    lines.push("No policy change entered (ΔG = ΔT = ΔM = 0).");
  }
  lines.push(`Multipliers: ∂Y/∂G = h/D = ${X(mu.dYdG)} with crowding out, 1/(1 − c) = ${X(mu.kG)} without; ∂Y/∂T = ${X(mu.dYdT)} (${X(mu.kT)} without); ∂Y/∂M = b/(P·D) = ${X(mu.dYdM)}.`);

  // AD–AS
  let adas: { P0: Rat; P1: Rat; Y0: Rat; Y1: Rat; r0: Rat; r1: Rat } | null = null;
  if (asType === "horizontal") {
    adas = { P0: v.P, P1: v.P, Y0: s0.Y, Y1: s1.Y, r0: s0.r, r1: s1.r };
    lines.push(`AD–AS with a horizontal AS at P = ${X(v.P)}: the price level does not move, so the AD–AS equilibrium is the IS–LM one${policy ? ` (ΔY = ${X(dY)})` : ""}.`);
  } else {
    const P0 = adPriceAt(p0, Yf!);
    const P1 = adPriceAt(p1, Yf!);
    if (!P0 || !P1) {
      lines.push(
        `AD–AS with a vertical AS at Yₚ = ${X(Yf!)}: no positive price level puts aggregate demand at Yₚ ${ratIsZero(v.b) || ratIsZero(v.M) ? "(with b = 0 or M = 0 aggregate demand does not depend on P)" : "(Yₚ is beyond the output aggregate demand reaches at any price level, hA/D)"}; the AD–AS part is not shown.`,
      );
    } else {
      // At Yₚ the IS curve gives r directly (b > 0 here, since a positive P needs b·M > 0).
      const rAt = (p: IslmParams): Rat => ratDiv(ratSub(islmSolve(p).A, ratMul(one_c, Yf!)), p.b);
      adas = { P0, P1, Y0: Yf!, Y1: Yf!, r0: rAt(p0), r1: rAt(p1) };
      lines.push(
        `AD–AS with a vertical AS at Yₚ = ${X(Yf!)}: P = bM/(D·Yₚ − hA) = ${X(P0)}, r = ${X(adas.r0)}%` +
          (policy ? `; after the policy P = ${X(P1)}, r = ${X(adas.r1)}% and output stays at Yₚ (${!ratIsZero(v.dG) || !ratIsZero(v.dT) ? "fiscal policy crowds out investment one for one" : "money is neutral: P moves in proportion and r is unchanged"}).` : "."),
      );
    }
  }
  if (ratSign(s0.r) < 0 || ratSign(s1.r) < 0) lines.push("Note: an equilibrium interest rate is negative.");
  if (ratSign(s0.I) < 0 || ratSign(s1.I) < 0) lines.push("Note: investment I₀ − b·r is negative at an equilibrium; the linear model allows it, but it signals parameters outside the model's sensible range.");
  if (ratSign(s0.C) < 0 || ratSign(s1.C) < 0) lines.push("Note: consumption is negative at an equilibrium; the linear model allows it, but it signals parameters outside the model's sensible range.");
  if (asType === "vertical") lines.push(`The IS–LM equilibrium, its table and the IS–LM figure hold the price level at the given P = ${X(v.P)} (the short run); the AD–AS lines and figure are the long run, where P adjusts.`);

  lines.push("");
  lines.push(
    "Conventions: IS Y = C₀ + c(Y − T) + I₀ − b·r + G; LM M/P = kY − h·r; r in percentage points (r = 5 is 5%), b and h per percentage point. " +
      "With A = C₀ − cT + I₀ + G and D = h(1 − c) + b·k: Y* = (hA + b·M/P)/D and r* = (kA − (1 − c)M/P)/D. Exact rational arithmetic; fractions are shown with their decimals.",
  );
  lines.push(
    "Multipliers with crowding out (IS–LM): ∂Y/∂G = h/D, ∂Y/∂T = −c·h/D, ∂Y/∂M = b/(P·D); without crowding out (r held fixed, the simple Keynesian multiplier): 1/(1 − c) and −c/(1 − c), and money has no effect unless r moves. Crowding out of investment is −b·Δr.",
  );
  lines.push(
    asType === "horizontal"
      ? "AD is the IS–LM output at each price level, Y(P) = (hA + b·M/P)/D; AS is horizontal at the given P (prices fixed in the short run)."
      : "AD is the IS–LM output at each price level, Y(P) = (hA + b·M/P)/D; AS is vertical at Yₚ (prices flexible, output at full employment), so the price level clears the goods and money markets.",
  );
  if (ratIsZero(v.h)) lines.push("h = 0: the LM curve is vertical (the quantity theory), so fiscal policy changes r but not Y.");
  if (ratIsZero(v.b)) lines.push("b = 0: the IS curve is vertical, so monetary policy changes r but not Y, and fiscal policy has its full Keynesian effect.");

  const eqRows: string[][] = [
    ["Quantity", "Before", "After", "Change"],
    ["Output Y", X(s0.Y), X(s1.Y), X(dY)],
    ["Interest rate r (%)", X(s0.r), X(s1.r), X(dr)],
    ["Consumption C", X(s0.C), X(s1.C), X(ratSub(s1.C, s0.C))],
    ["Investment I", X(s0.I), X(s1.I), X(ratSub(s1.I, s0.I))],
    ["Government spending G", X(p0.G), X(p1.G), X(v.dG)],
    ["Taxes T", X(p0.T), X(p1.T), X(v.dT)],
    ["Real balances M/P", X(s0.m), X(s1.m), X(ratSub(s1.m, s0.m))],
  ];
  const muRows: string[][] = [
    ["Multiplier", "IS–LM (with crowding out)", "r held fixed (Keynesian cross)"],
    ["∂Y/∂G", X(mu.dYdG), X(mu.kG)],
    ["∂Y/∂T", X(mu.dYdT), X(mu.kT)],
    ["Balanced budget (ΔG = ΔT)", X(ratAdd(mu.dYdG, mu.dYdT)), "1"],
    ["∂Y/∂M", X(mu.dYdM), "0 (money works only through r)"],
    ["∂r/∂G (percentage points)", X(mu.drdG), "0"],
    ["∂r/∂T (percentage points)", X(mu.drdT), "0"],
    ["∂r/∂M (percentage points)", X(mu.drdM), "0"],
  ];
  const tables: StatTable[] = [
    { label: `IS–LM equilibrium at P = ${X(v.P)}, before and after the policy`, rows: eqRows, align: ["left", "right", "right", "right"] },
    { label: "Multipliers", rows: muRows, align: ["left", "right", "right"], note: `D = h(1 − c) + b·k = ${X(s0.D)}.` },
  ];
  if (adas) {
    tables.push({
      label: `AD–AS (${asType === "horizontal" ? "horizontal AS" : "vertical AS"})`,
      rows: [
        ["Quantity", "Before", "After", "Change"],
        ["Price level P", X(adas.P0), X(adas.P1), X(ratSub(adas.P1, adas.P0))],
        ["Output Y", X(adas.Y0), X(adas.Y1), X(ratSub(adas.Y1, adas.Y0))],
        ["Interest rate r (%)", X(adas.r0), X(adas.r1), X(ratSub(adas.r1, adas.r0))],
      ],
      align: ["left", "right", "right", "right"],
    });
  }
  const svgs = [islmSvg(p0, p1, s0, s1, policy)];
  if (adas) svgs.push(adasSvg(p0, p1, adas, asType, Yf, policy));
  return { text: lines.join("\n"), tables, svg: combineSvgs(svgs).svg };
}

function islmSvg(p0: IslmParams, p1: IslmParams, s0: ReturnType<typeof islmSolve>, s1: ReturnType<typeof islmSolve>, policy: boolean): string {
  const num = ratToNumber;
  const Y0 = num(s0.Y);
  const Y1 = num(s1.Y);
  const span = Math.max(Math.abs(Y1 - Y0) * 1.5, 0.4 * Math.max(Y0, Y1));
  const lo = Math.max(0, Math.min(Y0, Y1) - span);
  const hi = Math.max(Y0, Y1) + span;
  // The r window: around both equilibria, so steep curves do not flatten the picture.
  const rs = [num(s0.r), num(s1.r)];
  const rspan = Math.max(4, Math.abs(rs[1] - rs[0]) * 2, Math.max(...rs.map(Math.abs)) * 0.8);
  const rlo = Math.min(...rs) - rspan;
  const rhi = Math.max(...rs) + rspan;
  // Each curve is a straight line a·Y + b·r = c, drawn as the segment inside the window (nothing past the frame).
  const segment = (a: number, b: number, c: number): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    const add = (x: number, y: number): void => {
      if (x >= lo - 1e-9 * (hi - lo) && x <= hi + 1e-9 * (hi - lo) && y >= rlo - 1e-9 * (rhi - rlo) && y <= rhi + 1e-9 * (rhi - rlo)) {
        if (!pts.some((q) => Math.abs(q.x - x) <= 1e-12 * (hi - lo) && Math.abs(q.y - y) <= 1e-12 * (rhi - rlo))) pts.push({ x, y });
      }
    };
    if (b !== 0) {
      add(lo, (c - a * lo) / b);
      add(hi, (c - a * hi) / b);
    }
    if (a !== 0) {
      add((c - b * rlo) / a, rlo);
      add((c - b * rhi) / a, rhi);
    }
    pts.sort((u, v) => u.x - v.x || u.y - v.y);
    return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : [];
  };
  const curves = (p: IslmParams, s: ReturnType<typeof islmSolve>): { is: { x: number; y: number }[]; lm: { x: number; y: number }[] } => {
    // IS: (1 − c)Y + b·r = A; LM: kY − h·r = M/P.
    const is = segment(1 - num(p.c), num(p.b), num(s.A));
    const lm = segment(num(p.k), -num(p.h), num(s.m));
    return { is, lm };
  };
  const c0 = curves(p0, s0);
  const series: Series[] = [
    { type: "line", points: c0.is, color: "#0369a1", label: "IS" },
    { type: "line", points: c0.lm, color: "#b45309", label: "LM" },
  ];
  const isMoved = policy && !ratEq(s0.A, s1.A);
  const lmMoved = policy && !ratEq(s0.m, s1.m);
  if (isMoved || lmMoved) {
    const c1 = curves(p1, s1);
    if (isMoved) series.push({ type: "line", points: c1.is, color: "#7dd3fc", label: "IS after policy" });
    if (lmMoved) series.push({ type: "line", points: c1.lm, color: "#fcd34d", label: "LM after policy" });
  }
  series.push({ type: "scatter", points: [{ x: Y0, y: num(s0.r) }], color: "#15803d", label: "Equilibrium" });
  if (isMoved || lmMoved) series.push({ type: "scatter", points: [{ x: Y1, y: num(s1.r) }], color: "#7c3aed", label: "After policy" });
  return buildPlotSvg(
    series.filter((s) => s.points.length > 0),
    {
      width: 420,
      height: 280,
      title: `IS–LM at P = ${fmtExactDec(p0.P, 3)}`,
      xlabel: "Output Y (per period)",
      ylabel: "Interest rate r (%)",
      xLimits: { min: lo, max: hi },
      yLimits: { min: rlo, max: rhi },
    },
  );
}

function adasSvg(p0: IslmParams, p1: IslmParams, adas: { P0: Rat; P1: Rat; Y0: Rat; Y1: Rat }, asType: string, Yf: Rat | null, policy: boolean): string {
  const num = ratToNumber;
  const Pc = Math.max(num(adas.P0), num(adas.P1));
  const Plo = 0.5 * Math.min(num(adas.P0), num(adas.P1));
  const Phi = 1.6 * Pc;
  const adCurve = (p: IslmParams): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const P = Plo + ((Phi - Plo) * i) / 60;
      // Y(P) = (hA + b·M/P)/D, in doubles for the drawing only.
      const s = islmSolve(p);
      pts.push({ x: (num(p.h) * num(s.A) + (num(p.b) * num(p.M)) / P) / num(s.D), y: P });
    }
    return pts;
  };
  const ad0 = adCurve(p0);
  const ys = ad0.map((t) => t.x);
  const series: Series[] = [{ type: "line", points: ad0, color: "#0369a1", label: "AD" }];
  const adMoved = policy && !ratEq(adOutput(p0, adas.P0), adOutput(p1, adas.P0));
  if (adMoved) {
    const ad1 = adCurve(p1);
    ys.push(...ad1.map((t) => t.x));
    series.push({ type: "line", points: ad1, color: "#7dd3fc", label: "AD after policy" });
  }
  let ylo = Math.min(...ys);
  let yhi = Math.max(...ys);
  if (asType === "horizontal") {
    series.push({ type: "line", points: [{ x: ylo, y: num(adas.P0) }, { x: yhi, y: num(adas.P0) }], color: "#b45309", label: "AS (horizontal)" });
  } else {
    const yf = num(Yf!);
    ylo = Math.min(ylo, yf);
    yhi = Math.max(yhi, yf);
    series.push({ type: "line", points: [{ x: yf, y: Plo }, { x: yf, y: Phi }], color: "#b45309", label: "AS (vertical at Yₚ)" });
  }
  series.push({ type: "scatter", points: [{ x: num(adas.Y0), y: num(adas.P0) }], color: "#15803d", label: "Equilibrium" });
  if (adMoved) series.push({ type: "scatter", points: [{ x: num(adas.Y1), y: num(adas.P1) }], color: "#7c3aed", label: "After policy" });
  const pad = Math.max((yhi - ylo) * 0.05, 1e-9);
  return buildPlotSvg(series, {
    width: 420,
    height: 280,
    title: "AD–AS",
    xlabel: "Output Y (per period)",
    ylabel: "Price level P (index)",
    xLimits: { min: Math.max(0, ylo - pad), max: yhi + pad },
    yLimits: { min: Plo, max: Phi },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// macro-taylor

export const MACRO_TAYLOR_FIELDS: E3Field[] = [
  { key: "rn", label: "Neutral real interest rate rⁿ (%)", kind: "text" },
  { key: "pi", label: "Inflation π (%), over the past year", kind: "text" },
  { key: "piStar", label: "Inflation target π* (%)", kind: "text" },
  { key: "gap", label: "Output gap (% of potential output; positive = above potential)", kind: "text" },
  { key: "aPi", label: "Weight on the inflation gap a", kind: "text" },
  { key: "aY", label: "Weight on the output gap b", kind: "text" },
  { key: "floor", label: "Lower bound on the policy rate (%; blank = none)", kind: "text" },
  { key: "series", label: "Optional series: Period | Inflation (%) | Output gap (%) (blank = the single reading above)", kind: "block" },
];

export const MACRO_TAYLOR_DEFAULTS: Record<string, string> = {
  rn: "2",
  pi: "3",
  piStar: "2",
  gap: "1",
  aPi: "0.5",
  aY: "0.5",
  floor: "",
  series: "",
};

export const TAYLOR_SERIES_MAX = 10_000;

/** macro-taylor. */
export function macroTaylorCalc(read: Read): StatOutput {
  const get = (k: string): string => String(read(k) ?? "");
  const lab: Record<string, string> = {
    rn: "The neutral real rate rⁿ",
    pi: "Inflation π",
    piStar: "The inflation target π*",
    gap: "The output gap",
    aPi: "The weight a",
    aY: "The weight b",
    floor: "The lower bound",
  };
  const v: Record<string, Rat> = {};
  const seriesText = get("series");
  const useSeries = seriesText.trim() !== "";
  for (const key of ["rn", "piStar", "aPi", "aY", ...(useSeries ? [] : ["pi", "gap"])]) {
    const r = readRat(get(key), lab[key], { percentAsIs: true });
    if ("error" in r) return refuse(r.error);
    v[key] = r.value;
  }
  let floor: Rat | null = null;
  if (get("floor").trim() !== "") {
    const r = readRat(get("floor"), lab.floor, { percentAsIs: true });
    if ("error" in r) return refuse(r.error);
    floor = r.value;
  }
  if (ratSign(v.aPi) < 0 || ratSign(v.aY) < 0) return refuse("The weights a and b cannot be negative (the rule leans against inflation and the output gap).");
  const X = fmtExactDec;
  const apply = (pi: Rat, gap: Rat): { i: Rat; raw: Rat; bound: boolean; terms: Rat[]; real: Rat } => {
    const t = taylorRate({ rn: v.rn, pi, piStar: v.piStar, gap, aPi: v.aPi, aY: v.aY });
    const bound = floor !== null && ratSign(ratSub(t.i, floor)) < 0;
    const i = bound ? floor! : t.i;
    return { i, raw: t.i, bound, terms: t.terms, real: ratSub(i, pi) };
  };
  const conventions = [
    "Conventions: Taylor (1993), “Discretion versus policy rules in practice”, Carnegie-Rochester Conference Series on Public Policy 39, 195–214: i = rⁿ + π + a(π − π*) + b·(output gap), all in percent, with Taylor's a = b = 0.5 and rⁿ = π* = 2 (the defaults; every value is editable). " +
      "π is inflation over the previous four quarters and the output gap is 100·(Y − Yₚ)/Yₚ with Yₚ potential output; rⁿ is the neutral real rate.",
    `Taylor principle: the nominal rate moves by 1 + a = ${X(ratAdd(RAT_ONE, v.aPi))} for each point of inflation, so the real rate ${ratSign(v.aPi) > 0 ? "rises" : "does not rise"} when inflation rises.`,
    "Exact rational arithmetic; fractions are shown with their decimals. The rule is a benchmark, not a forecast of what a central bank will do.",
  ];
  if (floor !== null) conventions.push(`A prescription below the lower bound ${X(floor)}% is replaced by the bound; the rule's unconstrained value is shown beside it.`);

  if (!useSeries) {
    const r = apply(v.pi, v.gap);
    const lines: string[] = [];
    lines.push(`Taylor rule policy rate: i = ${X(r.i)}%${r.bound ? ` (the lower bound; the rule gives ${X(r.raw)}%)` : ""}`);
    const P = (x: Rat): string => (ratSign(x) < 0 ? `(${X(x)})` : X(x));
    lines.push(`i = ${X(v.rn)} + ${P(v.pi)} + ${X(v.aPi)}·(${X(v.pi)} − ${P(v.piStar)}) + ${X(v.aY)}·${P(v.gap)}; implied real rate i − π = ${X(r.real)}%.`);
    lines.push("");
    lines.push(...conventions);
    const rows: string[][] = [
      ["Term", "Value (percentage points)"],
      ["Neutral real rate rⁿ", X(r.terms[0])],
      ["Inflation π", X(r.terms[1])],
      ["Inflation-gap response a(π − π*)", X(r.terms[2])],
      ["Output-gap response b·gap", X(r.terms[3])],
      ["Rule rate i", X(r.raw)],
    ];
    if (floor !== null) rows.push(["Policy rate after the lower bound", X(r.i)]);
    rows.push(["Real rate i − π", X(r.real)]);
    // Figure: the rule's rate against inflation at the given output gap.
    const ps = ratToNumber(v.piStar);
    const pNow = ratToNumber(v.pi);
    const lo = Math.min(ps - 4, pNow - 2);
    const hi = Math.max(ps + 6, pNow + 2);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = lo + ((hi - lo) * i) / 40;
      const t = taylorRate({ rn: v.rn, pi: ratFromFloat(x), piStar: v.piStar, gap: v.gap, aPi: v.aPi, aY: v.aY });
      let y = ratToNumber(t.i);
      if (floor !== null) y = Math.max(y, ratToNumber(floor));
      pts.push({ x, y });
    }
    const svg = buildPlotSvg(
      [
        { type: "line", points: pts, color: "#0369a1", label: "Rule at this gap" },
        { type: "line", points: [{ x: lo, y: lo }, { x: hi, y: hi }], color: "#94a3b8", label: "i = π (zero real rate)" },
        { type: "scatter", points: [{ x: pNow, y: ratToNumber(r.i) }], color: "#15803d", label: "This reading" },
      ],
      { width: 400, height: 260, title: "Taylor rule", xlabel: "Inflation π (%)", ylabel: "Policy rate i (%)" },
    );
    return { text: lines.join("\n"), tables: [{ label: "Taylor rule terms", rows, align: ["left", "right"] }], svg };
  }

  // Series
  const pd = parseRegData(seriesText);
  if (!pd.ok) return refuse(`The series: ${pd.reason}`);
  const d = pd.data;
  if (d.names.length < 3) return refuse("The series needs three columns: Period, Inflation (%), Output gap (%).");
  if (d.rows.length > TAYLOR_SERIES_MAX) return refuse(`The series has ${intText(d.rows.length)} rows; the limit is ${intText(TAYLOR_SERIES_MAX)}.`);
  const rowsOut: string[][] = [["Period", "Inflation π (%)", "Output gap (%)", "Rule rate i (%)", ...(floor !== null ? ["Policy rate (%)"] : []), "Real rate i − π (%)"]];
  const iPts: { x: number; y: number }[] = [];
  const piPts: { x: number; y: number }[] = [];
  const periods: string[] = [];
  let nBound = 0;
  for (let t = 0; t < d.rows.length; t++) {
    const row = d.rows[t];
    const label = row[0] || `Row ${t + 1}`;
    if (isMissingCell(row[1]) || isMissingCell(row[2])) return refuse(`The series row ${q(label)} has a missing inflation or output-gap value.`);
    const pi = readRat(row[1], `Inflation in ${q(label)}`, { percentAsIs: true, semicolon: !!d.semicolon });
    if ("error" in pi) return refuse(pi.error);
    const gap = readRat(row[2], `The output gap in ${q(label)}`, { percentAsIs: true, semicolon: !!d.semicolon });
    if ("error" in gap) return refuse(gap.error);
    const r = apply(pi.value, gap.value);
    if (r.bound) nBound++;
    rowsOut.push([label, X(pi.value), X(gap.value), X(r.raw), ...(floor !== null ? [X(r.i)] : []), X(r.real)]);
    periods.push(label);
    iPts.push({ x: t + 1, y: ratToNumber(r.i) });
    piPts.push({ x: t + 1, y: ratToNumber(pi.value) });
  }
  const last = rowsOut[rowsOut.length - 1];
  const lines: string[] = [];
  lines.push(`Taylor rule over ${intText(d.rows.length)} period${d.rows.length === 1 ? "" : "s"}: ${periods[periods.length - 1]} policy rate ${floor !== null ? last[4] : last[3]}%`);
  lines.push(`rⁿ = ${X(v.rn)}%, π* = ${X(v.piStar)}%, a = ${X(v.aPi)}, b = ${X(v.aY)}${floor !== null ? `; the lower bound ${X(floor)}% binds in ${intText(nBound)} period${nBound === 1 ? "" : "s"}` : ""}.`);
  lines.push("");
  lines.push(...conventions);
  lines.push(`The series columns read: ${q(d.names[0])} as the period, ${q(d.names[1])} as inflation, ${q(d.names[2])} as the output gap${d.names.length > 3 ? `; ${d.names.length - 3} further column${d.names.length === 4 ? " was" : "s were"} ignored` : ""}.`);
  const svg = buildPlotSvg(
    [
      { type: "line", points: iPts, color: "#0369a1", label: "Policy rate i" },
      { type: "line", points: piPts, color: "#b45309", label: "Inflation π" },
    ],
    {
      width: 420,
      height: 260,
      title: "Taylor rule over time",
      xlabel: "Period",
      ylabel: "Percent",
      xTickLabel: (x: number) => {
        const t = Math.round(x);
        return Math.abs(x - t) < 1e-9 && t >= 1 && t <= periods.length ? periods[t - 1] : "";
      },
    },
  );
  return { text: lines.join("\n"), tables: [{ label: "Taylor rule by period", rows: rowsOut, align: ["left", ...rowsOut[0].slice(1).map((): "right" => "right")] }], svg };
}

/** A double as a rational (drawing only: the figure's sample points). */
function ratFromFloat(x: number): Rat {
  const s = Math.round(x * 1e6);
  return ratDiv(R(s), R(1_000_000));
}
