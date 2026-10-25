/**
 * Release E5b: the linear market model behind micro-market (supply and demand, surplus, tax incidence, subsidies and
 * price controls), its figure, and the exact-number helpers the microeconomics calculators share (oligopoly.ts uses
 * them too).
 *
 * Everything is EXACT: the inputs are read as rationals (cas.ts Rat: "2.5" is 5/2, never the double nearest it), the
 * equilibrium, prices, elasticities and every surplus are rationals, and each surplus is the shoelace area of the SAME
 * exact polygon the figure shades. So the number printed for consumer surplus and the region drawn for it cannot
 * disagree: they are one object.
 *
 * Model (inverse form, one form only, printed back): demand P = a − bQ, supply P = c + dQ, with b > 0 and d ≥ 0
 * (d = 0 is a perfectly elastic supply). Prices are never negative: when c < 0 the supply curve meets P = 0 at a
 * positive quantity and producer surplus is measured over prices P ≥ 0 only (the region is clipped at the Q axis).
 */
import {
  Rat,
  ratAdd,
  ratSub,
  ratMul,
  ratDiv,
  ratNeg,
  ratSign,
  ratIsZero,
  ratInt,
  ratToNumber,
  parseRatLiteral,
  RAT_ZERO,
} from "./cas";
import { fmtFixed, fmtSci, groupThousands, NBSP } from "./regTable";
import { linearAxis, THIN_SPACE } from "./axis";

export const MINUS = "−";

// ---------------------------------------------------------------------------------------------------------------
// Exact-number helpers shared by the microeconomics calculators.

/** Largest magnitude a parameter field accepts, and the smallest non-zero one (both said in the refusal). */
export const INPUT_MAX = 1e12;
export const INPUT_MIN = 1e-9;
/** A field longer than this is refused before it is parsed (BigInt arithmetic on a 10,000-digit literal is a hang). */
export const FIELD_MAX_CHARS = 40;

export const cmp = (x: Rat, y: Rat): number => ratSign(ratSub(x, y));
export const rmax = (x: Rat, y: Rat): Rat => (cmp(x, y) >= 0 ? x : y);
export const rmin = (x: Rat, y: Rat): Rat => (cmp(x, y) <= 0 ? x : y);
export const R = (n: number): Rat => ratInt(n);

const quote = (s: string): string => `“${s.length > FIELD_MAX_CHARS ? s.slice(0, FIELD_MAX_CHARS) + "…" : s}”`;

export type RatField = { ok: true; v: Rat | null } | { ok: false; error: string };

/**
 * A number the user typed, as an exact rational. Accepts a decimal ("2.5"), a fraction ("7/3"), scientific notation
 * ("1.2e3"), a true minus (U+2212), thousands grouped with commas ("1,250.5") or thin/no-break spaces, and a decimal
 * comma ("2,5"; "2,500" is read as two thousand five hundred, US style, and the model is printed back so the reading
 * is visible). Blank gives null (the caller decides what blank means).
 */
export function readRatField(raw: string | undefined | null, label: string): RatField {
  const original = String(raw ?? "").trim();
  if (original === "") return { ok: true, v: null };
  if (original.length > FIELD_MAX_CHARS) return { ok: false, error: `${label}: ${quote(original)} is longer than ${FIELD_MAX_CHARS} characters.` };
  let s = original.split(MINUS).join("-").split(String.fromCharCode(0x2013)).join("-");
  for (const sp of [NBSP, THIN_SPACE, String.fromCharCode(0x202f), " "]) s = s.split(sp).join("");
  if (s.includes(",")) {
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.split(",").join("");
    else if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
    else return { ok: false, error: `${label}: ${quote(original)} is not a number.` };
  }
  const r = /^[+-]?[\d./eE+-]+$/.test(s) ? parseRatLiteral(s) : null;
  if (!r) return { ok: false, error: `${label}: ${quote(original)} is not a number.` };
  const v = ratToNumber(r);
  if (!Number.isFinite(v) || Math.abs(v) > INPUT_MAX) return { ok: false, error: `${label}: ${quote(original)} is larger in magnitude than 10¹², the largest value accepted (rescale the units).` };
  // Tested on the rational, not the double: 1e−400 is a non-zero rational whose double is 0.
  if (!ratIsZero(r) && (v === 0 || Math.abs(v) < INPUT_MIN)) return { ok: false, error: `${label}: ${quote(original)} is smaller in magnitude than 10⁻⁹, the smallest non-zero value accepted (rescale the units).` };
  return { ok: true, v: r };
}

/** A decimal under the display contract with at least four significant digits for values below 1. */
export function fmtDec(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  // Below 10⁻³, four significant digits as m×10ⁿ (six fixed decimals would leave one digit of 3.333×10⁻⁶).
  if (a < 1e-3) return fmtSci(v);
  const dec = a >= 1 ? 3 : Math.min(6, 3 + Math.ceil(-Math.log10(a)));
  return fmtFixed(v, dec);
}

/**
 * A table cell: decimals only. The exact decimal when it terminates within three places, else fmtDec (three decimals,
 * four significant digits below 1, m×10ⁿ below 10⁻³). Exact fractions go in the text: "250000/49 ≈ 5,102.041" in a
 * table cell is broken mid-number by Word.
 */
export function fmtCell(r: Rat): string {
  const v = ratToNumber(r);
  // From 10⁹ up, m×10ⁿ (fmtDec through fmtFixed) so a cell never runs to "400,000,000,000,000".
  if (Math.abs(v) >= 1e9) return fmtDec(v);
  const k = terminatingPlaces(r);
  if (k !== null && k <= 3) return exactDecimal(r, k);
  return fmtDec(v);
}

/** The note every decimal-cell table carries. */
export const CELL_NOTE = "Decimals: exact when they terminate within three places, else rounded to three places (four significant digits below 1; m×10ⁿ from 10⁹ up); the text gives exact fractions.";

/** The power of ten that makes a rational's decimal terminate, if it does within six places. */
function terminatingPlaces(r: Rat): number | null {
  let d = r.d;
  let e2 = 0;
  let e5 = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    e2++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    e5++;
  }
  if (d !== 1n) return null;
  const k = Math.max(e2, e5);
  return k <= 6 ? k : null;
}

/** The exact decimal string of a rational that terminates within six places (grouped, true minus). */
function exactDecimal(r: Rat, k: number): string {
  const neg = r.n < 0n;
  const scaled = ((neg ? -r.n : r.n) * 10n ** BigInt(k)) / r.d;
  let digits = scaled.toString();
  if (k > 0) {
    digits = digits.padStart(k + 1, "0");
    digits = `${digits.slice(0, -k)}.${digits.slice(-k)}`;
  }
  return (neg ? MINUS : "") + groupThousands(digits);
}

/**
 * A rational for display: the exact decimal when it terminates within six places ("2.5", "1,250"), else the short
 * fraction and its decimal ("70/3 ≈ 23.333"), else the decimal alone ("≈ 1.235×10¹²").
 */
export function fmtExact(r: Rat): string {
  const k = terminatingPlaces(r);
  if (k !== null && (r.n < 0n ? -r.n : r.n) < 10n ** 15n) return exactDecimal(r, k);
  const dec = fmtDec(ratToNumber(r));
  const an = r.n < 0n ? -r.n : r.n;
  if (an < 10n ** 7n && r.d < 10n ** 7n) return `${r.n < 0n ? MINUS : ""}${an}/${r.d} ≈ ${dec}`;
  return `≈ ${dec}`;
}

/** "Q* = 70/3 ≈ 23.333", or "Q* ≈ 5.000×10⁻³⁸" when only a decimal can be shown (never "= ≈"). */
export function eqText(name: string, r: Rat): string {
  const s = fmtExact(r);
  return s.startsWith("≈ ") ? `${name} ${s}` : `${name} = ${s}`;
}

/** A share as a percent: exact when it terminates ("40%"), else "≈ 33.333%". */
export function fmtPct(r: Rat): string {
  const x = ratMul(r, R(100));
  const k = terminatingPlaces(x);
  if (k !== null) return `${exactDecimal(x, k)}%`;
  return `≈ ${fmtDec(ratToNumber(x))}%`;
}

/** "120 − 2Q", "20 + 3Q", "−5 + 0.5Q", "20" (d = 0): a linear inverse curve as typed back. */
export function linText(p0: Rat, slope: Rat, sign: 1 | -1): string {
  const s = ratMul(slope, R(sign));
  const head = fmtExactShort(p0);
  if (ratIsZero(s)) return head;
  const mag = ratSign(s) < 0 ? ratNeg(s) : s;
  const coef = cmp(mag, R(1)) === 0 ? "" : fmtExactShort(mag);
  return `${head} ${ratSign(s) < 0 ? MINUS : "+"} ${coef}Q`;
}

/** The exact value only (no "≈ decimal" tail), for formulas: "70/3", "2.5". */
export function fmtExactShort(r: Rat): string {
  const k = terminatingPlaces(r);
  if (k !== null && (r.n < 0n ? -r.n : r.n) < 10n ** 15n) return exactDecimal(r, k);
  const an = r.n < 0n ? -r.n : r.n;
  if (an < 10n ** 7n && r.d < 10n ** 7n) return `${r.n < 0n ? MINUS : ""}${an}/${r.d}`;
  return fmtDec(ratToNumber(r));
}

// ---------------------------------------------------------------------------------------------------------------
// Exact polygons.

export type Pt = [Rat, Rat];

/** Clips a convex polygon to the half-plane P ≥ 0 (Sutherland–Hodgman, exact). */
export function clipToNonNegativeP(poly: Pt[]): Pt[] {
  const out: Pt[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i];
    const prev = poly[(i + n - 1) % n];
    const cIn = ratSign(cur[1]) >= 0;
    const pIn = ratSign(prev[1]) >= 0;
    const cross = (): Pt => {
      const t = ratDiv(prev[1], ratSub(prev[1], cur[1]));
      return [ratAdd(prev[0], ratMul(t, ratSub(cur[0], prev[0]))), RAT_ZERO];
    };
    if (cIn) {
      if (!pIn) out.push(cross());
      out.push(cur);
    } else if (pIn) out.push(cross());
  }
  // Drop repeated vertices (a vertex on the boundary is pushed once by each neighbour).
  const dedup: Pt[] = [];
  for (const p of out) {
    const last = dedup[dedup.length - 1];
    if (!last || cmp(last[0], p[0]) !== 0 || cmp(last[1], p[1]) !== 0) dedup.push(p);
  }
  while (dedup.length > 1 && cmp(dedup[0][0], dedup[dedup.length - 1][0]) === 0 && cmp(dedup[0][1], dedup[dedup.length - 1][1]) === 0) dedup.pop();
  return dedup;
}

/** The exact (unsigned) shoelace area of a polygon. */
export function polygonArea(poly: Pt[]): Rat {
  let s = RAT_ZERO;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s = ratAdd(s, ratSub(ratMul(x1, y2), ratMul(x2, y1)));
  }
  const half = ratDiv(s, R(2));
  return ratSign(half) < 0 ? ratNeg(half) : half;
}

// ---------------------------------------------------------------------------------------------------------------
// The market model.

export type Policy = "none" | "tax" | "subsidy" | "ceiling" | "floor";
export type Side = "sellers" | "buyers";

export interface MarketSpec {
  a: Rat;
  b: Rat;
  c: Rat;
  d: Rat;
  policy: Policy;
  /** The tax or subsidy per unit, or the controlled price (null for "none"). */
  amount: Rat | null;
  /** Who the tax is levied on (or the subsidy paid to). The outcome is the same; the figure draws that curve shifted. */
  side: Side;
}

export type RegionKind = "cs" | "ps" | "rev" | "sub" | "dwl";

export interface MarketRegion {
  kind: RegionKind;
  /** Exact vertices (Q, P), already clipped to P ≥ 0. */
  poly: Pt[];
  area: Rat;
}

export interface WedgeWay {
  q: Rat;
  buyers: Rat;
  sellers: Rat;
  buyerShare: Rat;
  sellerShare: Rat;
}

export interface MarketOutcome {
  /**
   * True when the market trades nothing WITHOUT the policy (a ≤ c) and a subsidy opens it: qe = 0, there is no
   * no-policy price (pe is set to a, never printed), ε, η and the incidence shares do not exist, and ways is absent.
   */
  closed?: boolean;
  /** True when a price control closes the market (a ceiling at or below c, a floor at or above a): q = 0. */
  closes?: boolean;
  qe: Rat;
  pe: Rat;
  /** Point elasticity of demand at the equilibrium (negative). */
  eps: Rat;
  /** Point elasticity of supply at the equilibrium; null when supply is perfectly elastic (d = 0). */
  eta: Rat | null;
  csE: Rat;
  psE: Rat;
  regionsE: MarketRegion[];
  policy: Policy;
  /** False for a price control that does not bind (the market clears at the equilibrium). */
  binding: boolean;
  /** Quantity traded, the price buyers pay and the price sellers receive, under the policy. */
  q: Rat;
  buyers: Rat;
  sellers: Rat;
  /** Price controls: quantity demanded and supplied at the controlled price (qs null = unbounded, d = 0 floor). */
  qd?: Rat;
  qs?: Rat | null;
  cs: Rat;
  ps: Rat;
  /** Tax revenue (tax) or the government's subsidy cost (subsidy); zero otherwise. */
  rev: Rat;
  sub: Rat;
  dwl: Rat;
  regions: MarketRegion[];
  /** Tax / subsidy computed BOTH ways (levied on sellers, levied on buyers), independently. */
  ways?: { sellers: WedgeWay; buyers: WedgeWay };
}

export type MarketResult = { ok: true; r: MarketOutcome } | { ok: false; reason: string };

function region(kind: RegionKind, poly: Pt[]): MarketRegion {
  const clipped = clipToNonNegativeP(poly);
  return { kind, poly: clipped, area: clipped.length >= 3 ? polygonArea(clipped) : RAT_ZERO };
}

/** Solves the linear market under one policy. Refusals name the condition that fails. */
export function solveMarket(spec: MarketSpec): MarketResult {
  const { a, b, c, d, policy, side } = spec;
  const fail = (reason: string): MarketResult => ({ ok: false, reason });
  if (ratSign(b) <= 0) return fail(`The demand slope b must be greater than 0 (demand P = a − bQ slopes down); it is ${fmtExactShort(b)}.`);
  if (ratSign(d) < 0) return fail(`The supply slope d must be 0 or more (supply P = c + dQ cannot slope down); it is ${fmtExactShort(d)}.`);
  const bd = ratAdd(b, d);
  const D = (q: Rat): Rat => ratSub(a, ratMul(b, q));
  const S = (q: Rat): Rat => ratAdd(c, ratMul(d, q));
  const z = RAT_ZERO;
  if (cmp(a, c) <= 0) {
    // Without a policy nothing is traded. A large enough subsidy opens the market: existence is checked on the
    // post-policy curves (a + s > c), not the pre-policy ones.
    const s = spec.amount;
    const closedWhy = `the demand intercept a = ${fmtExactShort(a)} is not above the supply intercept c = ${fmtExactShort(c)}, so buyers' highest willingness to pay never covers the lowest supply price`;
    if (policy === "subsidy" && s && ratSign(s) > 0 && cmp(ratAdd(a, s), c) > 0) {
      const q = ratDiv(ratAdd(ratSub(a, c), s), bd);
      const pb = D(q);
      const ps = ratAdd(pb, s);
      if (ratSign(pb) < 0) return fail(`With this subsidy the buyers' price would be ${fmtExactShort(pb)}, below 0 (buyers would be paid to take the good); choose a smaller subsidy.`);
      const cs = region("cs", [[z, a], [z, pb], [q, pb]]);
      const prs = region("ps", [[z, c], [q, ps], [z, ps]]);
      const subR = region("sub", [[z, pb], [q, pb], [q, ps], [z, ps]]);
      // Every unit traded costs more than it is worth (supply lies above demand from Q = 0): the loss is the whole
      // area between the curves over the units traded.
      const dwl = region("dwl", [[z, a], [q, pb], [q, ps], [z, c]]);
      return {
        ok: true,
        r: {
          closed: true,
          qe: z,
          pe: a,
          eps: z,
          eta: null,
          csE: z,
          psE: z,
          regionsE: [],
          policy,
          binding: true,
          q,
          buyers: pb,
          sellers: ps,
          cs: cs.area,
          ps: prs.area,
          rev: z,
          sub: subR.area,
          dwl: dwl.area,
          regions: [cs, prs, subR, dwl],
        },
      };
    }
    const hint =
      policy === "subsidy" && s && ratSign(s) > 0
        ? ` A subsidy opens the market only when it exceeds c − a = ${fmtExactShort(ratSub(c, a))}.`
        : "";
    return fail(`No equilibrium with a positive quantity: ${closedWhy}.${hint}`);
  }
  const qe = ratDiv(ratSub(a, c), bd);
  const pe = D(qe);
  if (ratSign(pe) <= 0) return fail(`The equilibrium price would be ${fmtExactShort(pe)}, not above 0; this calculator needs a positive equilibrium price (raise c or a).`);
  const eps = ratNeg(ratDiv(pe, ratMul(b, qe)));
  const eta = ratIsZero(d) ? null : ratDiv(pe, ratMul(d, qe));
  const csRegE = region("cs", [[z, a], [z, pe], [qe, pe]]);
  const psRegE = region("ps", [[z, c], [qe, pe], [z, pe]]);
  const base: MarketOutcome = {
    qe,
    pe,
    eps,
    eta,
    csE: csRegE.area,
    psE: psRegE.area,
    regionsE: [csRegE, psRegE],
    policy,
    binding: false,
    q: qe,
    buyers: pe,
    sellers: pe,
    cs: csRegE.area,
    ps: psRegE.area,
    rev: z,
    sub: z,
    dwl: z,
    regions: [csRegE, psRegE],
  };
  if (policy === "none") return { ok: true, r: base };
  const t = spec.amount;
  if (!t) return fail("Enter the policy amount (the tax or subsidy per unit, or the controlled price), or choose No policy.");

  if (policy === "tax" || policy === "subsidy") {
    if (ratSign(t) <= 0) return fail(`The ${policy} per unit must be greater than 0; it is ${fmtExactShort(t)}.`);
    // A subsidy is a negative tax: the wedge w = P(buyers) − P(sellers) is +t for a tax and −s for a subsidy.
    const w = policy === "tax" ? t : ratNeg(t);
    // Levied on sellers: supply shifts to P = c + w + dQ; buyers pay the market price, sellers keep it minus w.
    const qS = ratDiv(ratSub(ratSub(a, c), w), bd);
    const buyS = D(qS);
    const sellS = ratSub(buyS, w);
    // Levied on buyers: demand shifts to P = a − w − bQ; sellers receive the market price, buyers pay it plus w.
    const qB = ratDiv(ratSub(ratSub(a, w), c), bd);
    const sellB = ratSub(D(qB), w);
    const buyB = ratAdd(sellB, w);
    const share = (buy: Rat, sell: Rat): { buyerShare: Rat; sellerShare: Rat } => ({
      buyerShare: ratDiv(ratSub(buy, pe), w),
      sellerShare: ratDiv(ratSub(pe, sell), w),
    });
    const ways = {
      sellers: { q: qS, buyers: buyS, sellers: sellS, ...share(buyS, sellS) },
      buyers: { q: qB, buyers: buyB, sellers: sellB, ...share(buyB, sellB) },
    };
    const way = ways[side];
    const q = way.q;
    if (ratSign(q) <= 0) {
      return fail(`A tax of ${fmtExactShort(t)} per unit is at or above a − c = ${fmtExactShort(ratSub(a, c))}: no quantity would be traded (the market closes).`);
    }
    if (ratSign(way.sellers) < 0) return fail(`With this tax the sellers' price would be ${fmtExactShort(way.sellers)}, below 0 (c < 0); prices here are never negative.`);
    if (ratSign(way.buyers) < 0) return fail(`With this subsidy the buyers' price would be ${fmtExactShort(way.buyers)}, below 0 (buyers would be paid to take the good); choose a smaller subsidy.`);
    const pb = way.buyers;
    const ps = way.sellers;
    const cs = region("cs", [[z, a], [z, pb], [q, pb]]);
    const prs = region("ps", [[z, c], [q, ps], [z, ps]]);
    const regions: MarketRegion[] = [cs, prs];
    let rev = z;
    let sub = z;
    let dwl: MarketRegion;
    if (policy === "tax") {
      const revR = region("rev", [[z, ps], [q, ps], [q, pb], [z, pb]]);
      rev = revR.area;
      dwl = region("dwl", [[q, pb], [q, ps], [qe, pe]]);
      regions.push(revR, dwl);
    } else {
      const subR = region("sub", [[z, pb], [q, pb], [q, ps], [z, ps]]);
      sub = subR.area;
      dwl = region("dwl", [[qe, pe], [q, ps], [q, pb]]);
      regions.push(subR, dwl);
    }
    return { ok: true, r: { ...base, binding: true, q, buyers: pb, sellers: ps, cs: cs.area, ps: prs.area, rev, sub, dwl: dwl.area, regions, ways } };
  }

  // Price controls.
  const pc = t;
  if (ratSign(pc) < 0) return fail(`A controlled price must be 0 or more; it is ${fmtExactShort(pc)}.`);
  if (policy === "ceiling") {
    if (cmp(pc, pe) >= 0) return { ok: true, r: { ...base } };
    if (ratIsZero(d) || cmp(pc, c) <= 0) {
      // At or below the lowest supply price nothing is supplied: the market closes (Q = 0) and the whole no-policy
      // surplus is lost (with d = 0 a ceiling below P* = c is below c).
      const qd = ratDiv(ratSub(a, pc), b);
      const dwl = region("dwl", [[z, a], [qe, pe], [z, c]]);
      return { ok: true, r: { ...base, binding: true, closes: true, q: z, buyers: pc, sellers: pc, qd, qs: z, cs: z, ps: z, dwl: dwl.area, regions: [dwl] } };
    }
    const qs = ratDiv(ratSub(pc, c), d);
    const qd = ratDiv(ratSub(a, pc), b);
    const dq = D(qs);
    const cs = region("cs", [[z, a], [z, pc], [qs, pc], [qs, dq]]);
    const prs = region("ps", [[z, c], [qs, pc], [z, pc]]);
    const dwl = region("dwl", [[qs, dq], [qs, pc], [qe, pe]]);
    return { ok: true, r: { ...base, binding: true, q: qs, buyers: pc, sellers: pc, qd, qs, cs: cs.area, ps: prs.area, dwl: dwl.area, regions: [cs, prs, dwl] } };
  }
  // Floor.
  if (cmp(pc, pe) <= 0) return { ok: true, r: { ...base } };
  if (cmp(pc, a) >= 0) {
    // At or above the demand intercept nothing is bought: the market closes (Q = 0) and the whole surplus is lost.
    const qsF = ratIsZero(d) ? null : ratDiv(ratSub(pc, c), d);
    const dwl = region("dwl", [[z, a], [qe, pe], [z, c]]);
    return { ok: true, r: { ...base, binding: true, closes: true, q: z, buyers: pc, sellers: pc, qd: z, qs: qsF, cs: z, ps: z, dwl: dwl.area, regions: [dwl] } };
  }
  const qd = ratDiv(ratSub(a, pc), b);
  const qs = ratIsZero(d) ? null : ratDiv(ratSub(pc, c), d);
  const sq = S(qd);
  const cs = region("cs", [[z, a], [z, pc], [qd, pc]]);
  const prs = region("ps", [[z, c], [qd, sq], [qd, pc], [z, pc]]);
  const dwl = region("dwl", [[qd, pc], [qd, sq], [qe, pe]]);
  return { ok: true, r: { ...base, binding: true, q: qd, buyers: pc, sellers: pc, qd, qs, cs: cs.area, ps: prs.area, dwl: dwl.area, regions: [cs, prs, dwl] } };
}

// ---------------------------------------------------------------------------------------------------------------
// The figure.

const COLORS = {
  demand: "#1d4ed8",
  supply: "#15803d",
  control: "#7c2d12",
  guide: "#64748b",
  frame: "#333333",
  ink: "#222222",
  cs: "#93c5fd",
  ps: "#86efac",
  rev: "#fcd34d",
  sub: "#7c3aed",
  dwl: "#f87171",
};

const REGION_LABEL: Record<RegionKind, string> = {
  cs: "Consumer surplus",
  ps: "Producer surplus",
  rev: "Tax revenue",
  sub: "Subsidy cost",
  dwl: "Deadweight loss",
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f2 = (v: number): string => {
  const s = v.toFixed(2);
  return s === "-0.00" ? "0.00" : s;
};

type LegendItem =
  | { kind: "line"; color: string; dash?: string; label: string }
  | { kind: "fill"; color: string; opacity: number; label: string }
  | { kind: "overlap"; label: string }
  | { kind: "outline"; color: string; label: string }
  | { kind: "dot"; color: string; label: string };

/** Liang–Barsky: the part of segment p→q inside [0, X] × [0, Y] (null if none). */
function clipSegment(x0: number, y0: number, x1: number, y1: number, X: number, Y: number): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const eps = 1e-12 * Math.max(1, X, Y);
  const tests: [number, number][] = [
    [-dx, x0 - 0 + eps],
    [dx, X - x0 + eps],
    [-dy, y0 - 0 + eps],
    [dy, Y - y0 + eps],
  ];
  for (const [p, qv] of tests) {
    if (p === 0) {
      if (qv < 0) return null;
    } else {
      const r = qv / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t1 - t0 <= 0) return null;
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

export interface MarketFigureLabels {
  /** Quantity unit (singular), e.g. "unit", "tonne". */
  qunit: string;
  /** Currency, e.g. "$". */
  cur: string;
}

/**
 * The supply-and-demand figure: demand and supply (and the shifted curve or the controlled price), the equilibrium
 * point, and the shaded regions, each the exact polygon whose area is printed. Every polygon edge lies on a drawn line
 * (a curve, a guide at a policy price or quantity, or an axis), so the shading is bounded by lines the reader sees.
 * Legend in a gutter to the right of the frame; nothing is drawn outside the frame except text.
 */
export function marketFigureSvg(spec: MarketSpec, r: MarketOutcome, labels: MarketFigureLabels): string {
  const { a, b, c, d } = spec;
  const num = ratToNumber;
  const policyOn = r.binding;
  const regions = policyOn ? r.regions : r.regionsE;

  // Window: every region vertex and every marked quantity, with headroom; P from exactly 0.
  const qs: number[] = [num(r.qe)];
  const ps: number[] = [num(a), num(r.pe)];
  for (const g of regions) for (const [x, y] of g.poly) {
    qs.push(num(x));
    ps.push(num(y));
  }
  // The shortage / excess-supply end is shown when it fits within 2.5× the rest (a nearly flat supply would
  // otherwise squash the picture); the table always gives it.
  const core = Math.max(...qs);
  for (const extra of [r.qd, r.qs]) if (policyOn && extra && num(extra) <= 2.5 * core) qs.push(num(extra));
  // A control that does not bind is still drawn when it lies inside the demand curve's price range.
  const isControl = (spec.policy === "ceiling" || spec.policy === "floor") && spec.amount !== null;
  const showControl = isControl && (policyOn || cmp(spec.amount!, a) < 0);
  if (showControl) ps.push(num(spec.amount!));
  const X = Math.max(...qs) * 1.18;
  const Y = Math.max(...ps) * 1.1;

  const xRow = linearAxis(0, X, { target: 5 });
  const yRow = linearAxis(0, Y, { target: 5 });
  const yTickW = Math.max(...yRow.labels.map((s) => s.length), 1) * 10 * 0.58;
  const ML = Math.max(52, Math.ceil(yTickW + 30));
  const MT = 34;
  const pw = 330;
  const ph = 250;
  const MB = 46;

  const legend: LegendItem[] = [
    { kind: "line", color: COLORS.demand, label: "Demand D" },
    { kind: "line", color: COLORS.supply, label: "Supply S" },
  ];
  if (policyOn && spec.policy === "tax") legend.push(spec.side === "sellers" ? { kind: "line", color: COLORS.supply, dash: "6 4", label: "S + t (tax on sellers)" } : { kind: "line", color: COLORS.demand, dash: "6 4", label: "D − t (tax on buyers)" });
  if (policyOn && spec.policy === "subsidy") legend.push(spec.side === "sellers" ? { kind: "line", color: COLORS.supply, dash: "6 4", label: "S − s (to sellers)" } : { kind: "line", color: COLORS.demand, dash: "6 4", label: "D + s (to buyers)" });
  if (showControl) {
    const name = spec.policy === "ceiling" ? "Price ceiling" : "Price floor";
    legend.push({ kind: "line", color: COLORS.control, label: policyOn ? name : `${name} (not binding)` });
  }
  // A market closed without the policy has no equilibrium point to mark.
  if (!r.closed) legend.push({ kind: "dot", color: COLORS.ink, label: "Equilibrium E" });
  const subsidy = policyOn && spec.policy === "subsidy";
  const fillOpacity = subsidy ? 0.5 : 0.85;
  for (const g of regions) {
    if (g.poly.length < 3 || ratIsZero(g.area)) continue;
    if (g.kind === "sub") legend.push({ kind: "outline", color: COLORS.sub, label: REGION_LABEL.sub });
    else legend.push({ kind: "fill", color: COLORS[g.kind], opacity: g.kind === "dwl" ? 0.85 : fillOpacity, label: REGION_LABEL[g.kind] });
    if (subsidy && g.kind === "ps") legend.push({ kind: "overlap", label: "CS and PS overlap" });
  }

  const LEG_FS = 10;
  const legendTextW = Math.max(...legend.map((l) => l.label.length)) * LEG_FS * 0.58;
  const legX = ML + pw + 14;
  const W = Math.ceil(legX + 26 + legendTextW + 10);
  const H = MT + ph + MB;

  const px = (q: number): number => ML + (q / X) * pw;
  const py = (p: number): number => MT + ph - (p / Y) * ph;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);

  // Regions first (the lines are drawn over their edges).
  for (const g of regions) {
    if (g.poly.length < 3 || ratIsZero(g.area)) continue;
    const pts = g.poly.map(([x, y]) => `${f2(px(num(x)))},${f2(py(num(y)))}`).join(" ");
    if (g.kind === "sub") out.push(`<polygon data-region="sub" points="${pts}" fill="none" stroke="${COLORS.sub}" stroke-width="1.4" stroke-dasharray="5 3"/>`);
    else out.push(`<polygon data-region="${g.kind}" points="${pts}" fill="${COLORS[g.kind]}" fill-opacity="${g.kind === "dwl" ? 0.85 : fillOpacity}" stroke="none"/>`);
  }

  const line = (x0: number, y0: number, x1: number, y1: number, attrs: string, role: string): void => {
    const s = clipSegment(x0, y0, x1, y1, X, Y);
    if (!s) return;
    out.push(`<line data-role="${role}" x1="${f2(px(s[0]))}" y1="${f2(py(s[1]))}" x2="${f2(px(s[2]))}" y2="${f2(py(s[3]))}" ${attrs}/>`);
  };
  const guide = (x0: number, y0: number, x1: number, y1: number): void => line(x0, y0, x1, y1, `stroke="${COLORS.guide}" stroke-width="0.9" stroke-dasharray="2 2"`, "guide");

  // Guides at the policy's prices and quantities: they are the horizontal and vertical edges of the regions.
  const n = num;
  if (!policyOn) {
    guide(0, n(r.pe), n(r.qe), n(r.pe));
    guide(n(r.qe), 0, n(r.qe), n(r.pe));
  } else if (spec.policy === "tax" || spec.policy === "subsidy") {
    const top = n(rmax(r.buyers, r.sellers));
    guide(0, n(r.buyers), n(r.q), n(r.buyers));
    guide(0, n(r.sellers), n(r.q), n(r.sellers));
    guide(n(r.q), 0, n(r.q), top);
  } else if (spec.policy === "ceiling") {
    guide(n(r.q), 0, n(r.q), n(ratSub(a, ratMul(b, r.q))));
    if (r.qd) guide(n(r.qd), 0, n(r.qd), n(spec.amount!));
  } else {
    guide(n(r.q), 0, n(r.q), n(spec.amount!));
    if (r.qs) guide(n(r.qs), 0, n(r.qs), n(spec.amount!));
  }

  // The curves: from Q = 0 to the frame's right edge, clipped to the frame.
  const curve = (p0: Rat, slope: number, attrs: string, role: string): void => line(0, n(p0), X, n(p0) + slope * X, attrs, role);
  const demandAttrs = `stroke="${COLORS.demand}" stroke-width="2"`;
  const supplyAttrs = `stroke="${COLORS.supply}" stroke-width="2"`;
  curve(a, -n(b), demandAttrs, "demand");
  curve(c, n(d), supplyAttrs, "supply");
  if (policyOn && (spec.policy === "tax" || spec.policy === "subsidy")) {
    const w = spec.policy === "tax" ? spec.amount! : ratNeg(spec.amount!);
    if (spec.side === "sellers") curve(ratAdd(c, w), n(d), `stroke="${COLORS.supply}" stroke-width="1.6" stroke-dasharray="6 4"`, "shifted");
    else curve(ratSub(a, w), -n(b), `stroke="${COLORS.demand}" stroke-width="1.6" stroke-dasharray="6 4"`, "shifted");
  }
  if (showControl) line(0, n(spec.amount!), X, n(spec.amount!), `stroke="${COLORS.control}" stroke-width="1.6"`, "control");

  // Frame (the left and bottom edges are the P and Q axes).
  const fx0 = ML;
  const fx1 = ML + pw;
  const fy0 = MT;
  const fy1 = MT + ph;
  out.push(`<line data-role="axis" x1="${fx0}" y1="${fy1}" x2="${fx1}" y2="${fy1}" stroke="${COLORS.frame}" stroke-width="1"/>`);
  out.push(`<line data-role="axis" x1="${fx0}" y1="${fy0}" x2="${fx0}" y2="${fy1}" stroke="${COLORS.frame}" stroke-width="1"/>`);
  out.push(`<line data-role="frame" x1="${fx0}" y1="${fy0}" x2="${fx1}" y2="${fy0}" stroke="#cccccc" stroke-width="1"/>`);
  out.push(`<line data-role="frame" x1="${fx1}" y1="${fy0}" x2="${fx1}" y2="${fy1}" stroke="#cccccc" stroke-width="1"/>`);

  // The equilibrium point.
  if (!r.closed) out.push(`<circle cx="${f2(px(n(r.qe)))}" cy="${f2(py(n(r.pe)))}" r="3.2" fill="${COLORS.ink}"/>`);

  // Ticks and labels.
  xRow.values.forEach((v, i) => {
    const x = f2(px(v));
    out.push(`<line data-role="tick" x1="${x}" y1="${fy1}" x2="${x}" y2="${fy1 + 4}" stroke="${COLORS.frame}" stroke-width="1"/>`);
    out.push(`<text x="${x}" y="${fy1 + 16}" text-anchor="middle" font-size="10" fill="${COLORS.ink}">${esc(xRow.labels[i])}</text>`);
  });
  yRow.values.forEach((v, i) => {
    const y = f2(py(v));
    out.push(`<line data-role="tick" x1="${fx0 - 4}" y1="${y}" x2="${fx0}" y2="${y}" stroke="${COLORS.frame}" stroke-width="1"/>`);
    out.push(`<text x="${fx0 - 7}" y="${f2(py(v) + 3)}" text-anchor="end" font-size="10" fill="${COLORS.ink}">${esc(yRow.labels[i])}</text>`);
  });
  const xTitle = `Quantity Q (${labels.qunit})${xRow.multiplier ? ` (${xRow.multiplier})` : ""}`;
  const yTitle = `Price P (${labels.cur} per ${labels.qunit})${yRow.multiplier ? ` (${yRow.multiplier})` : ""}`;
  out.push(`<text x="${ML + pw / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${COLORS.ink}">${esc(xTitle)}</text>`);
  const ycx = 14;
  const ycy = MT + ph / 2;
  out.push(`<text x="${ycx}" y="${ycy}" text-anchor="middle" font-size="11" fill="${COLORS.ink}" transform="rotate(-90 ${ycx} ${ycy})">${esc(yTitle)}</text>`);
  const title =
    !policyOn
      ? "Supply and demand: equilibrium and surplus"
      : spec.policy === "tax"
        ? "Supply and demand with a per-unit tax"
        : spec.policy === "subsidy"
          ? "Supply and demand with a per-unit subsidy"
          : spec.policy === "ceiling"
            ? "Supply and demand with a price ceiling"
            : "Supply and demand with a price floor";
  out.push(`<text x="${f2(W / 2)}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${COLORS.ink}">${esc(title)}</text>`);

  // Legend in the right gutter.
  const LH = 17;
  const legH = legend.length * LH + 8;
  const legY = MT;
  out.push(`<rect x="${legX}" y="${legY}" width="${f2(W - legX - 4)}" height="${legH}" fill="#ffffff" stroke="#cccccc"/>`);
  legend.forEach((l, i) => {
    const cy = legY + 4 + i * LH + LH / 2;
    const sx = legX + 6;
    if (l.kind === "line") out.push(`<path d="M${sx},${f2(cy)} L${sx + 16},${f2(cy)}" stroke="${l.color}" stroke-width="2"${l.dash ? ` stroke-dasharray="4 2"` : ""} fill="none"/>`);
    else if (l.kind === "fill") out.push(`<rect x="${sx}" y="${f2(cy - 5)}" width="16" height="10" fill="${l.color}" fill-opacity="${l.opacity}"/>`);
    else if (l.kind === "outline") out.push(`<rect x="${sx + 0.7}" y="${f2(cy - 4.3)}" width="14.6" height="8.6" fill="none" stroke="${l.color}" stroke-width="1.4" stroke-dasharray="3 2"/>`);
    else if (l.kind === "overlap") {
      out.push(`<rect x="${sx}" y="${f2(cy - 5)}" width="16" height="10" fill="${COLORS.cs}" fill-opacity="${fillOpacity}"/>`);
      out.push(`<rect x="${sx}" y="${f2(cy - 5)}" width="16" height="10" fill="${COLORS.ps}" fill-opacity="${fillOpacity}"/>`);
    } else out.push(`<circle cx="${sx + 8}" cy="${f2(cy)}" r="3.2" fill="${l.color}"/>`);
    out.push(`<text x="${sx + 22}" y="${f2(cy + 3.5)}" font-size="${LEG_FS}" fill="${COLORS.ink}">${esc(l.label)}</text>`);
  });
  out.push("</svg>");
  return out.join("");
}
