/**
 * Release E5b: market structures with linear inverse demand P = a − bQ and constant marginal costs, in EXACT rational
 * arithmetic (cas.ts Rat). Perfect competition, monopoly, Cournot–Nash with n asymmetric firms (exits handled by an
 * active-set iteration), Bertrand with homogeneous goods, and Stackelberg with firm 1 leading (two firms).
 *
 * Corners (no negative quantity is ever produced):
 *  - Cournot: a firm whose interior quantity would be ≤ 0 exits. Removing a firm whose cost is at or above the Cournot
 *    price can only LOWER the price (P′ − P = (P − cᵢ)/k ≤ 0), so a removed firm never comes back and the iteration
 *    ends in at most n rounds; the excluded firms' best response at the final price is ≤ 0, so it is an equilibrium.
 *  - Bertrand: price = min(c₂, (a + c₁)/2) with c₁ < c₂ the two lowest costs: the low-cost firm charges the rival's
 *    cost (ties broken in its favour, the limit of undercutting by ε) unless its own monopoly price is lower. Tied
 *    lowest costs: price = that cost, the tied firms split the market equally (a convention), profit 0.
 *  - Stackelberg: the leader maximises over the follower's whole best response q₂ = max(0, (a − c₂ − bq₁)/(2b)), a
 *    piecewise concave profit; both pieces' maximisers are compared exactly, so a deterred follower (q₂ = 0) gives the
 *    leader its limit quantity (a − c₂)/b or its monopoly quantity.
 */
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratSign, ratIsZero, RAT_ZERO } from "./cas";
import { cmp, rmax, rmin, R, fmtExactShort } from "./microMarket";

export const OLIGOPOLY_MAX_FIRMS = 20;
/** Wall clock for the Cournot active-set iteration (bounded by n rounds anyway), as arima.ts ARIMA_WALL_MS. */
export const OLIGOPOLY_WALL_MS = 6000;

export interface Firm {
  name: string;
  c: Rat;
}

export type StructureKey = "competition" | "monopoly" | "cournot" | "bertrand" | "stackelberg";

export interface Structure {
  key: StructureKey;
  label: string;
  price: Rat;
  total: Rat;
  q: Rat[];
  profit: Rat[];
  cs: Rat;
  ps: Rat;
  ts: Rat;
  dwl: Rat;
  /** Industry Lerner index Σ sᵢ(P − cᵢ)/P (output shares); 0 when P = MC = 0. */
  lerner: Rat;
  /** Σ (100·sᵢ)², on the 0 to 10,000 scale. */
  hhi: Rat;
}

export interface OligopolyOutcome {
  firms: Firm[];
  structures: Structure[];
  /** Indices of firms that exit in the Cournot equilibrium. */
  cournotOut: number[];
  cournotRounds: number;
  /** Index of the monopolist (the first firm with the lowest cost). */
  monopolist: number;
  bertrandRule: string;
  stackelbergRegime?: string;
}

export type OligopolyResult = { ok: true; r: OligopolyOutcome } | { ok: false; reason: string };

function metrics(key: StructureKey, label: string, a: Rat, b: Rat, firms: Firm[], price: Rat, q: Rat[], tsComp: Rat | null): Structure {
  const total = q.reduce((s, x) => ratAdd(s, x), RAT_ZERO);
  const profit = q.map((qi, i) => ratMul(ratSub(price, firms[i].c), qi));
  const cs = ratDiv(ratMul(b, ratMul(total, total)), R(2));
  const ps = profit.reduce((s, x) => ratAdd(s, x), RAT_ZERO);
  const ts = ratAdd(cs, ps);
  let lerner = RAT_ZERO;
  let hhi = RAT_ZERO;
  if (ratSign(total) > 0) {
    for (let i = 0; i < firms.length; i++) {
      if (ratSign(q[i]) <= 0) continue;
      const s = ratDiv(q[i], total);
      if (ratSign(price) > 0) lerner = ratAdd(lerner, ratMul(s, ratDiv(ratSub(price, firms[i].c), price)));
      const pct = ratMul(s, R(100));
      hhi = ratAdd(hhi, ratMul(pct, pct));
    }
  }
  // Every structure's price must lie on the demand curve at its total output (an exact self-check).
  if (cmp(price, ratSub(a, ratMul(b, total))) !== 0) throw new Error(`internal: ${label} price is off the demand curve`);
  return { key, label, price, total, q, profit, cs, ps, ts, dwl: tsComp === null ? RAT_ZERO : ratSub(tsComp, ts), lerner, hhi };
}

/** Solves every market structure. `now` is injectable for the clock test. */
export function solveOligopoly(a: Rat, b: Rat, firms: Firm[], now: () => number = Date.now): OligopolyResult {
  const fail = (reason: string): OligopolyResult => ({ ok: false, reason });
  const n = firms.length;
  if (n === 0) return fail("Enter at least one firm's marginal cost.");
  if (n > OLIGOPOLY_MAX_FIRMS) return fail(`At most ${OLIGOPOLY_MAX_FIRMS} firms (${n} were entered).`);
  if (ratSign(b) <= 0) return fail(`The demand slope b must be greater than 0 (P = a − bQ slopes down); it is ${fmtExactShort(b)}.`);
  for (const f of firms) if (ratSign(f.c) < 0) return fail(`The marginal cost of ${f.name} is ${fmtExactShort(f.c)}; a marginal cost cannot be negative.`);
  const cmin = firms.reduce((m, f) => rmin(m, f.c), firms[0].c);
  if (cmp(cmin, a) >= 0) return fail(`No firm can sell at a price above its cost: the lowest marginal cost ${fmtExactShort(cmin)} is not below the demand intercept a = ${fmtExactShort(a)}.`);
  const start = now();
  const zeros = (): Rat[] => firms.map(() => RAT_ZERO);

  // Perfect competition: P = lowest MC; the tied lowest-cost firms split the output equally (the split is indeterminate
  // at P = MC; HHI depends on this convention).
  const tied = firms.map((f, i) => (cmp(f.c, cmin) === 0 ? i : -1)).filter((i) => i >= 0);
  const qComp = ratDiv(ratSub(a, cmin), b);
  const qc = zeros();
  for (const i of tied) qc[i] = ratDiv(qComp, R(tied.length));
  const comp = metrics("competition", "Perfect competition", a, b, firms, cmin, qc, null);
  const tsComp = comp.ts;

  // Monopoly: one firm with the lowest MC.
  const m = tied[0];
  const qm = zeros();
  qm[m] = ratDiv(ratSub(a, cmin), ratMul(R(2), b));
  const mono = metrics("monopoly", "Monopoly", a, b, firms, ratDiv(ratAdd(a, cmin), R(2)), qm, tsComp);

  // Cournot–Nash with exits.
  let active = firms.map((_, i) => i);
  let price = RAT_ZERO;
  let rounds = 0;
  for (;;) {
    rounds++;
    if (rounds > n + 1) return fail("The Cournot active-set iteration did not settle within n + 1 rounds (an internal error; please report the inputs).");
    if (now() - start > OLIGOPOLY_WALL_MS) return fail(`The Cournot computation exceeded ${OLIGOPOLY_WALL_MS / 1000} s and was stopped.`);
    const sum = active.reduce((s, i) => ratAdd(s, firms[i].c), RAT_ZERO);
    price = ratDiv(ratAdd(a, sum), R(active.length + 1));
    const keep = active.filter((i) => cmp(firms[i].c, price) < 0);
    if (keep.length === active.length) break;
    active = keep;
  }
  const qn = zeros();
  for (const i of active) qn[i] = ratDiv(ratSub(price, firms[i].c), b);
  const cournot = metrics("cournot", "Cournot–Nash", a, b, firms, price, qn, tsComp);
  const cournotOut = firms.map((_, i) => i).filter((i) => !active.includes(i));

  // Bertrand (homogeneous goods).
  const order = firms.map((_, i) => i).sort((x, y) => cmp(firms[x].c, firms[y].c) || x - y);
  const qb = zeros();
  let pB: Rat;
  let bertrandRule: string;
  const pMono = ratDiv(ratAdd(a, cmin), R(2));
  if (n === 1) {
    pB = pMono;
    qb[m] = ratDiv(ratSub(a, pB), b);
    bertrandRule = "one firm: Bertrand is the monopoly outcome";
  } else if (tied.length >= 2) {
    pB = cmin;
    for (const i of tied) qb[i] = ratDiv(ratDiv(ratSub(a, pB), b), R(tied.length));
    bertrandRule = `${tied.length} firms tie at the lowest cost: price = that cost, the market split equally among them (a convention), profit 0`;
  } else {
    const c2 = firms[order[1]].c;
    pB = rmin(c2, pMono);
    qb[m] = ratDiv(ratSub(a, pB), b);
    bertrandRule =
      cmp(pMono, c2) <= 0
        ? `${firms[m].name}'s monopoly price (a + c₁)/2 = ${fmtExactShort(pMono)} is at or below the next-lowest cost ${fmtExactShort(c2)}, so it charges its monopoly price`
        : `${firms[m].name} charges the next-lowest cost c₂ = ${fmtExactShort(c2)} (ties broken in favour of the low-cost firm: the limit of undercutting by ε) and serves the whole market`;
  }
  const bertrand = metrics("bertrand", "Bertrand", a, b, firms, pB, qb, tsComp);

  const structures = [comp, mono, cournot, bertrand];
  let stackelbergRegime: string | undefined;
  if (n === 2) {
    const s = stackelberg(a, b, firms[0].c, firms[1].c);
    const pS = ratSub(a, ratMul(b, ratAdd(s.q1, s.q2)));
    structures.push(metrics("stackelberg", "Stackelberg (firm 1 leads)", a, b, firms, pS, [s.q1, s.q2], tsComp));
    stackelbergRegime = s.regime;
  }
  return { ok: true, r: { firms, structures, cournotOut, cournotRounds: rounds, monopolist: m, bertrandRule, stackelbergRegime } };
}

/** The follower's best response q₂ = max(0, (a − c₂ − bq₁)/(2b)). */
export function followerResponse(a: Rat, b: Rat, c2: Rat, q1: Rat): Rat {
  return rmax(RAT_ZERO, ratDiv(ratSub(ratSub(a, c2), ratMul(b, q1)), ratMul(R(2), b)));
}

/** Stackelberg with firm 1 leading, over the follower's whole (kinked) best response. */
export function stackelberg(a: Rat, b: Rat, c1: Rat, c2: Rat): { q1: Rat; q2: Rat; regime: string } {
  const profit1 = (q1: Rat): Rat => ratMul(ratSub(ratSub(a, ratMul(b, ratAdd(q1, followerResponse(a, b, c2, q1)))), c1), q1);
  // q1 at or beyond the limit quantity deters the follower.
  const qLim = rmax(RAT_ZERO, ratDiv(ratSub(a, c2), b));
  const qMon = rmax(RAT_ZERO, ratDiv(ratSub(a, c1), ratMul(R(2), b)));
  // Piece A, q1 in [0, qLim]: price (a + c₂ − bq₁)/2, profit ((a + c₂ − 2c₁ − bq₁)/2)q₁, maximiser clamped.
  const qA = rmin(qLim, rmax(RAT_ZERO, ratDiv(ratSub(ratAdd(a, c2), ratMul(R(2), c1)), ratMul(R(2), b))));
  // Piece B, q1 ≥ qLim: the follower is out, profit (a − c₁ − bq₁)q₁.
  const qB = rmax(qMon, qLim);
  const pA = profit1(qA);
  const pB = profit1(qB);
  // Ties go to the larger leader output.
  const useB = cmp(pB, pA) > 0 || (cmp(pB, pA) === 0 && cmp(qB, qA) >= 0);
  const q1 = useB ? qB : qA;
  const q2 = followerResponse(a, b, c2, q1);
  let regime: string;
  if (ratIsZero(q1)) regime = "the leader's cost is so high that it produces nothing; the follower is a monopolist";
  else if (ratSign(q2) > 0) regime = "interior: both firms produce";
  else if (cmp(q1, qMon) === 0 && cmp(qMon, qLim) >= 0) regime = "the follower is deterred (q₂ = 0): the leader produces its monopoly quantity, which already leaves the follower no room";
  else regime = `the follower is deterred (q₂ = 0): the leader produces the limit quantity (a − c₂)/b = ${fmtExactShort(qLim)}`;
  return { q1, q2, regime };
}

/** Residual best responses of firms 1 and 2 with every other firm held at its Cournot output (n ≥ 2). */
export function bestResponseIntercepts(a: Rat, b: Rat, firms: Firm[], cournotQ: Rat[]): { A1: Rat; A2: Rat; others: Rat } {
  let others = RAT_ZERO;
  for (let i = 2; i < firms.length; i++) others = ratAdd(others, cournotQ[i]);
  const A1 = ratSub(ratSub(a, firms[0].c), ratMul(b, others));
  const A2 = ratSub(ratSub(a, firms[1].c), ratMul(b, others));
  return { A1, A2, others };
}
