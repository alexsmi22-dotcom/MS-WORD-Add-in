/**
 * Release E5b calculators (Stats registry), pure functions of the field reader (taskpane.ts declares the fields and
 * calls these):
 *  - micro-market     supply and demand: equilibrium, elasticities, surplus, tax / subsidy incidence, price controls
 *                     (microMarket.ts);
 *  - micro-oligopoly  perfect competition, monopoly, Cournot, Bertrand and Stackelberg compared (oligopoly.ts).
 *
 * The worked defaults are invented numbers (no textbook exercise is copied).
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratSign, ratIsZero, ratToNumber, RAT_ZERO } from "./cas";
import {
  readRatField,
  solveMarket,
  marketFigureSvg,
  fmtExact,
  fmtExactShort,
  eqText,
  fmtPct,
  linText,
  cmp,
  R,
  type MarketSpec,
  type MarketOutcome,
  type Policy,
  type Side,
} from "./microMarket";
import { solveOligopoly, bestResponseIntercepts, OLIGOPOLY_MAX_FIRMS, type Firm, type Structure } from "./oligopoly";
import { buildPlotSvg, type Series } from "./plot";

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });

export interface E5Field {
  key: string;
  label: string;
  kind: "block" | "text" | "select";
  options?: { value: string; label: string }[];
}

/** Longest unit / currency label accepted (it is printed on an axis). */
export const UNIT_MAX_CHARS = 16;

function readLabel(raw: string, dflt: string, label: string): { ok: true; v: string } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: true, v: dflt };
  if (s.length > UNIT_MAX_CHARS) return { ok: false, error: `${label}: at most ${UNIT_MAX_CHARS} characters (it is printed on the figure's axis).` };
  for (const ch of s) if (ch.charCodeAt(0) < 32) return { ok: false, error: `${label}: contains a control character.` };
  return { ok: true, v: s };
}

function readParam(get: (k: string) => string, key: string, label: string): Rat | string {
  const r = readRatField(get(key), label);
  if (!r.ok) return r.error;
  if (r.v === null) return `Enter the ${label}.`;
  return r.v;
}

// ---------------------------------------------------------------------------------------------------------------
// micro-market

export const MICRO_MARKET_FIELDS: E5Field[] = [
  { key: "a", label: "Demand intercept a (demand P = a − bQ)", kind: "text" },
  { key: "b", label: "Demand slope b (greater than 0)", kind: "text" },
  { key: "c", label: "Supply intercept c (supply P = c + dQ)", kind: "text" },
  { key: "d", label: "Supply slope d (0 or more; 0 = perfectly elastic)", kind: "text" },
  {
    key: "policy",
    label: "Policy",
    kind: "select",
    options: [
      { value: "none", label: "No policy" },
      { value: "tax", label: "Per-unit tax" },
      { value: "subsidy", label: "Per-unit subsidy" },
      { value: "ceiling", label: "Price ceiling" },
      { value: "floor", label: "Price floor" },
    ],
  },
  { key: "amount", label: "Tax or subsidy per unit, or the controlled price", kind: "text" },
  {
    key: "side",
    label: "Tax levied on (subsidy paid to)",
    kind: "select",
    options: [
      { value: "sellers", label: "Sellers" },
      { value: "buyers", label: "Buyers" },
    ],
  },
  { key: "qunit", label: "Quantity unit, singular (for the axis)", kind: "text" },
  { key: "cur", label: "Currency (for the axis)", kind: "text" },
];

export const MICRO_MARKET_DEFAULTS: Record<string, string> = {
  a: "120",
  b: "2",
  c: "20",
  d: "3",
  policy: "tax",
  amount: "10",
  side: "sellers",
  qunit: "unit",
  cur: "$",
};

const POLICIES: Policy[] = ["none", "tax", "subsidy", "ceiling", "floor"];

/** micro-market: supply and demand. */
export function microMarketCalc(read: Read): StatOutput {
  const get = (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
  const vals: Rat[] = [];
  for (const [k, label] of [
    ["a", "demand intercept a"],
    ["b", "demand slope b"],
    ["c", "supply intercept c"],
    ["d", "supply slope d"],
  ] as const) {
    const v = readParam(get, k, label);
    if (typeof v === "string") return refuse(v.charAt(0).toUpperCase() + v.slice(1));
    vals.push(v);
  }
  const [a, b, c, d] = vals;
  const policyRaw = get("policy").trim() || "none";
  if (!POLICIES.includes(policyRaw as Policy)) return refuse(`Unknown policy “${policyRaw}”.`);
  const policy = policyRaw as Policy;
  const sideRaw = get("side").trim() || "sellers";
  if (sideRaw !== "sellers" && sideRaw !== "buyers") return refuse(`Unknown side “${sideRaw}” (sellers or buyers).`);
  const side = sideRaw as Side;
  let amount: Rat | null = null;
  if (policy !== "none") {
    const amtLabel = policy === "tax" ? "Tax per unit" : policy === "subsidy" ? "Subsidy per unit" : policy === "ceiling" ? "Price ceiling" : "Price floor";
    const r = readRatField(get("amount"), amtLabel);
    if (!r.ok) return refuse(r.error);
    if (r.v === null) return refuse(`Enter the ${amtLabel.toLowerCase()}, or choose No policy.`);
    amount = r.v;
  }
  const qu = readLabel(get("qunit"), "unit", "Quantity unit");
  if (!qu.ok) return refuse(qu.error);
  const cu = readLabel(get("cur"), "$", "Currency");
  if (!cu.ok) return refuse(cu.error);
  const spec: MarketSpec = { a, b, c, d, policy, amount, side };
  const res = solveMarket(spec);
  if (!res.ok) return refuse(res.reason);
  const r = res.r;
  const qunit = qu.v;
  const cur = cu.v;

  const lines: string[] = [];
  lines.push(`Supply and demand: demand P = ${linText(a, b, -1)}, supply P = ${linText(c, d, 1)} (P in ${cur} per ${qunit}, Q in ${qunit})`);
  lines.push(`Equilibrium: ${eqText("Q*", r.qe)}, ${eqText("P*", r.pe)}`);
  lines.push(`Point elasticities at the equilibrium: demand ${eqText("ε", r.eps)}, supply ${r.eta ? eqText("η", r.eta) : "η = perfectly elastic (d = 0)"}`);
  const amt = amount ? fmtExactShort(amount) : "";
  const tsOf = (o: { cs: Rat; ps: Rat; rev: Rat; sub: Rat }): Rat => ratSub(ratAdd(ratAdd(o.cs, o.ps), o.rev), o.sub);
  if (policy === "tax" || policy === "subsidy") {
    const w = r.ways![side];
    const word = policy === "tax" ? "tax" : "subsidy";
    lines.push(
      `Per-unit ${word} ${policy === "tax" ? "t" : "s"} = ${amt} ${policy === "tax" ? "levied on" : "paid to"} ${side}: quantity ${fmtExact(r.q)}, buyers pay ${fmtExact(r.buyers)}, sellers receive ${fmtExact(r.sellers)}`,
    );
    lines.push(
      policy === "tax"
        ? `Incidence: buyers bear ${fmtPct(w.buyerShare)} of the tax and sellers ${fmtPct(w.sellerShare)}, the same whichever side it is levied on (table).`
        : `Incidence: buyers receive ${fmtPct(w.buyerShare)} of the subsidy and sellers ${fmtPct(w.sellerShare)}, the same whichever side it is paid to (table).`,
    );
    lines.push(
      `Consumer surplus ${fmtExact(r.cs)}, producer surplus ${fmtExact(r.ps)}, ${policy === "tax" ? `tax revenue ${fmtExact(r.rev)}` : `subsidy cost ${fmtExact(r.sub)}`}, deadweight loss ${fmtExact(r.dwl)} (${cur})`,
    );
  } else if (policy === "ceiling" || policy === "floor") {
    const name = policy === "ceiling" ? "price ceiling" : "price floor";
    if (!r.binding) {
      lines.push(
        `The ${name} ${amt} is ${policy === "ceiling" ? "at or above" : "at or below"} ${eqText("P*", r.pe)}: it does not bind, and the market clears at the equilibrium.`,
      );
      lines.push(`Consumer surplus ${fmtExact(r.csE)}, producer surplus ${fmtExact(r.psE)} (${cur})`);
    } else {
      const gap = policy === "ceiling" ? ratSub(r.qd!, r.qs!) : r.qs ? ratSub(r.qs, r.qd!) : null;
      lines.push(
        `The ${name} ${amt} binds: quantity demanded ${fmtExact(r.qd!)}, quantity supplied ${r.qs ? fmtExact(r.qs) : "unbounded (perfectly elastic supply)"}, ` +
          `${policy === "ceiling" ? "shortage" : "excess supply"} ${gap ? fmtExact(gap) : "unbounded"}; quantity traded ${fmtExact(r.q)}`,
      );
      lines.push(`Consumer surplus ${fmtExact(r.cs)}, producer surplus ${fmtExact(r.ps)}, deadweight loss ${fmtExact(r.dwl)} (${cur})`);
    }
  } else {
    lines.push(`Consumer surplus ${fmtExact(r.csE)}, producer surplus ${fmtExact(r.psE)}, total surplus ${fmtExact(ratAdd(r.csE, r.psE))} (${cur})`);
  }

  lines.push("");
  lines.push(
    "Conventions: linear inverse demand P = a − bQ and supply P = c + dQ, read exactly as typed (decimals and fractions are exact rationals), so every result is exact; a fraction is shown with its decimal. " +
      "Equilibrium Q* = (a − c)/(b + d), P* = a − bQ*.",
  );
  lines.push("Point elasticities ε = (dQ/dP)·(P/Q) at (Q*, P*): demand ε = −P*/(bQ*), supply η = P*/(dQ*); ε and η are plain symbols, defined here.");
  lines.push(
    "Consumer surplus is the area below demand and above the price buyers pay, over the units traded; producer surplus is the area above supply and below the price sellers receive, over prices P ≥ 0. Each is the exact area of the region shaded in the figure.",
  );
  if (policy === "tax" && r.binding) {
    lines.push(
      "A tax t levied on sellers shifts supply up to P = c + t + dQ; levied on buyers it shifts demand down to P = a − t − bQ. Both give the same quantity and the same buyers' and sellers' prices (computed both ways in the table). " +
        "Buyers' share = (buyers' price − P*)/t = η/(η − ε); sellers' share = (P* − sellers' price)/t = −ε/(η − ε)" +
        (r.eta ? "." : " (with perfectly elastic supply, buyers bear all of it).") +
        " Tax revenue = t·Qₜ; deadweight loss = ½·t·(Q* − Qₜ), with Qₜ the quantity traded under the tax.",
    );
  }
  if (policy === "subsidy" && r.binding) {
    lines.push(
      "A per-unit subsidy s is a negative tax: paid to sellers it shifts supply down to P = c − s + dQ; paid to buyers it shifts demand up to P = a + s − bQ; both give the same outcome. " +
        "Buyers' share = (P* − buyers' price)/s, sellers' share = (sellers' price − P*)/s. Subsidy cost = s·Qₛ; deadweight loss = ½·s·(Qₛ − Q*) (units whose cost exceeds their value), with Qₛ the quantity traded under the subsidy.",
    );
    lines.push(
      "In the figure, consumer and producer surplus overlap inside the subsidy rectangle (dashed outline): the subsidy pays for both gains, so total surplus = CS + PS − subsidy cost.",
    );
  }
  if (policy === "ceiling" && r.binding) {
    lines.push(
      "Efficient rationing is assumed: the units supplied go to the buyers who value them most, so consumer surplus is the area between demand and the ceiling over the units supplied. With random rationing consumer surplus would be lower (not computed). Deadweight loss is the surplus on the units no longer traded.",
    );
  }
  if (policy === "floor" && r.binding) {
    lines.push(
      "Efficient production is assumed: only the quantity demanded is produced, by the lowest-cost sellers, and no unsold output is produced (if it were, its cost would be a further loss, not counted here). Deadweight loss is the surplus on the units no longer traded.",
    );
  }
  if (ratSign(c) < 0) lines.push(`The supply intercept c = ${fmtExactShort(c)} is negative: supply reaches P = 0 at ${eqText("Q", ratDiv(ratSub(RAT_ZERO, c), d))}, and producer surplus counts prices P ≥ 0 only.`);
  if (ratIsZero(d)) lines.push("Supply is perfectly elastic (d = 0): sellers supply any quantity at P = c, so producer surplus is zero without a policy.");
  lines.push("A non-binding control is reported as such (not refused); a tax that closes the market, a subsidy that would make the buyers' price negative, and a ceiling below every supply price are refused.");

  // Tables.
  const tables: StatTable[] = [];
  const qL = `(${qunit})`;
  const pL = `(${cur} per ${qunit})`;
  const mL = `(${cur})`;
  tables.push({
    label: "Equilibrium without a policy",
    rows: [
      ["Measure", "Value"],
      [`Quantity Q* ${qL}`, fmtExact(r.qe)],
      [`Price P* ${pL}`, fmtExact(r.pe)],
      ["Demand elasticity ε", fmtExact(r.eps)],
      ["Supply elasticity η", r.eta ? fmtExact(r.eta) : "perfectly elastic"],
      [`Consumer surplus ${mL}`, fmtExact(r.csE)],
      [`Producer surplus ${mL}`, fmtExact(r.psE)],
      [`Total surplus ${mL}`, fmtExact(ratAdd(r.csE, r.psE))],
    ],
    align: ["left", "right"],
  });
  if (r.binding) {
    const head = policy === "tax" ? "With the tax" : policy === "subsidy" ? "With the subsidy" : policy === "ceiling" ? "With the ceiling" : "With the floor";
    const rows: string[][] = [["Measure", "No policy", head, "Change"]];
    const row = (name: string, before: Rat, after: Rat | null): void => {
      rows.push([name, fmtExact(before), after ? fmtExact(after) : "unbounded", after ? fmtExact(ratSub(after, before)) : "unbounded"]);
    };
    row(`Quantity traded ${qL}`, r.qe, r.q);
    row(`Buyers' price ${pL}`, r.pe, r.buyers);
    row(`Sellers' price ${pL}`, r.pe, r.sellers);
    if (policy === "ceiling" || policy === "floor") {
      row(`Quantity demanded ${qL}`, r.qe, r.qd!);
      row(`Quantity supplied ${qL}`, r.qe, r.qs ?? null);
      const gap = policy === "ceiling" ? ratSub(r.qd!, r.qs!) : r.qs ? ratSub(r.qs, r.qd!) : null;
      row(`${policy === "ceiling" ? "Shortage" : "Excess supply"} ${qL}`, RAT_ZERO, gap);
    }
    row(`Consumer surplus ${mL}`, r.csE, r.cs);
    row(`Producer surplus ${mL}`, r.psE, r.ps);
    if (policy === "tax") row(`Tax revenue ${mL}`, RAT_ZERO, r.rev);
    if (policy === "subsidy") row(`Subsidy cost ${mL}`, RAT_ZERO, r.sub);
    row(`Total surplus ${mL}`, ratAdd(r.csE, r.psE), tsOf(r));
    row(`Deadweight loss ${mL}`, RAT_ZERO, r.dwl);
    tables.push({
      label: `${head}: welfare`,
      rows,
      align: ["left", "right", "right", "right"],
      note: policy === "subsidy" ? "Total surplus = consumer surplus + producer surplus − subsidy cost." : policy === "tax" ? "Total surplus = consumer surplus + producer surplus + tax revenue." : undefined,
    });
    if (r.ways) {
      const verb = policy === "tax" ? "Levied on" : "Paid to";
      const wr = (w: MarketOutcome["ways"]): string[][] => {
        const s = w!.sellers;
        const bq = w!.buyers;
        return [
          ["Measure", `${verb} sellers`, `${verb} buyers`],
          [`Quantity traded ${qL}`, fmtExact(s.q), fmtExact(bq.q)],
          [`Buyers' price ${pL}`, fmtExact(s.buyers), fmtExact(bq.buyers)],
          [`Sellers' price ${pL}`, fmtExact(s.sellers), fmtExact(bq.sellers)],
          [`Buyers' share of the ${policy}`, fmtPct(s.buyerShare), fmtPct(bq.buyerShare)],
          [`Sellers' share of the ${policy}`, fmtPct(s.sellerShare), fmtPct(bq.sellerShare)],
        ];
      };
      tables.push({ label: `Incidence: the ${policy} on either side of the market`, rows: wr(r.ways), align: ["left", "right", "right"], note: "Each column is computed separately from its own shifted curve." });
    }
  }
  const svg = marketFigureSvg(spec, r, { qunit, cur });
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------------------------------------------------------
// micro-oligopoly

export const MICRO_OLIGOPOLY_FIELDS: E5Field[] = [
  { key: "a", label: "Demand intercept a (inverse demand P = a − bQ)", kind: "text" },
  { key: "b", label: "Demand slope b (greater than 0)", kind: "text" },
  { key: "costs", label: `Firms and marginal costs, one per line: Name<Tab>MC, or just the MC (at most ${OLIGOPOLY_MAX_FIRMS}; the first firm leads in Stackelberg)`, kind: "block" },
  { key: "qunit", label: "Quantity unit, singular (for the axis)", kind: "text" },
  { key: "cur", label: "Currency", kind: "text" },
];

export const MICRO_OLIGOPOLY_DEFAULTS: Record<string, string> = {
  a: "120",
  b: "1",
  costs: "Firm 1\t10\nFirm 2\t20",
  qunit: "unit",
  cur: "$",
};

/** Reads "Name<Tab>MC", "Name: MC", "Name MC" or a bare "MC" per line; a first line without a cost is a header. */
export function parseFirms(text: string): { ok: true; firms: Firm[] } | { ok: false; reason: string } {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (raw.length === 0) return { ok: false, reason: "Enter at least one firm's marginal cost (one per line)." };
  if (raw.length > OLIGOPOLY_MAX_FIRMS + 1) return { ok: false, reason: `At most ${OLIGOPOLY_MAX_FIRMS} firms (${raw.length} lines were entered).` };
  const firms: Firm[] = [];
  for (let li = 0; li < raw.length; li++) {
    const line = raw[li];
    let name = "";
    let costText = line;
    if (line.includes("\t")) {
      const k = line.lastIndexOf("\t");
      name = line.slice(0, k).trim();
      costText = line.slice(k + 1).trim();
    } else if (line.includes(":")) {
      const k = line.lastIndexOf(":");
      name = line.slice(0, k).trim();
      costText = line.slice(k + 1).trim();
    } else {
      const m = /^(.*\S)\s+(\S+)$/.exec(line);
      if (m && readRatField(m[2], "x").ok) {
        name = m[1];
        costText = m[2];
      }
    }
    if (!name) name = `Firm ${firms.length + 1}`;
    const r = readRatField(costText, `Marginal cost of ${name}`);
    if (!r.ok || r.v === null) {
      // A header row ("Firm<Tab>MC"): only a first line whose cost text has no digit at all, so a mistyped first cost
      // ("1e-400", "1O") is still refused rather than skipped.
      if (li === 0 && raw.length > 1 && !/\d/.test(costText)) continue;
      const bare = costText === line;
      return { ok: false, reason: r.ok || bare ? `Line ${li + 1} (“${line.slice(0, 40)}”) has no marginal cost (write Name<Tab>MC, or the MC alone).` : r.error };
    }
    if (name.length > 30) return { ok: false, reason: `Line ${li + 1}: a firm name may have at most 30 characters.` };
    if (firms.some((f) => f.name.toLowerCase() === name.toLowerCase())) return { ok: false, reason: `Two firms are named “${name}”; give each firm its own name.` };
    firms.push({ name, c: r.v });
  }
  if (firms.length > OLIGOPOLY_MAX_FIRMS) return { ok: false, reason: `At most ${OLIGOPOLY_MAX_FIRMS} firms (${firms.length} were entered).` };
  if (firms.length === 0) return { ok: false, reason: "Enter at least one firm's marginal cost (one per line)." };
  return { ok: true, firms };
}

/** micro-oligopoly: market structures compared. */
export function microOligopolyCalc(read: Read): StatOutput {
  const get = (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
  const a = readParam(get, "a", "demand intercept a");
  if (typeof a === "string") return refuse(a.charAt(0).toUpperCase() + a.slice(1));
  const b = readParam(get, "b", "demand slope b");
  if (typeof b === "string") return refuse(b.charAt(0).toUpperCase() + b.slice(1));
  const pf = parseFirms(get("costs"));
  if (!pf.ok) return refuse(pf.reason);
  const qu = readLabel(get("qunit"), "unit", "Quantity unit");
  if (!qu.ok) return refuse(qu.error);
  const cu = readLabel(get("cur"), "$", "Currency");
  if (!cu.ok) return refuse(cu.error);
  const res = solveOligopoly(a, b, pf.firms);
  if (!res.ok) return refuse(res.reason);
  const r = res.r;
  const firms = r.firms;
  const n = firms.length;
  const qunit = qu.v;
  const cur = cu.v;
  const by = (k: string): Structure | undefined => r.structures.find((s) => s.key === k);
  const cournot = by("cournot")!;

  const lines: string[] = [];
  lines.push(
    `Market structures: inverse demand P = ${linText(a, b, -1)}, ${n} firm${n === 1 ? "" : "s"} with constant marginal cost${n === 1 ? "" : "s"} (${firms.map((f) => `${f.name} ${fmtExactShort(f.c)}`).join(", ")})`,
  );
  for (const s of r.structures) lines.push(`${s.label}: price ${fmtExact(s.price)}, total output ${fmtExact(s.total)}, deadweight loss ${fmtExact(s.dwl)}`);
  if (r.cournotOut.length) lines.push(`Cournot exits: ${r.cournotOut.map((i) => firms[i].name).join(", ")} (cost at or above the Cournot price ${fmtExact(cournot.price)}, so ${r.cournotOut.length === 1 ? "it produces" : "they produce"} 0).`);
  lines.push("");
  lines.push(
    `Conventions: inverse demand P = a − bQ, constant marginal costs, no fixed costs, homogeneous good; prices in ${cur} per ${qunit}, quantities in ${qunit}, surplus and profit in ${cur}. Every value is exact (rational arithmetic); a fraction is shown with its decimal.`,
  );
  const mName = firms[r.monopolist].name;
  lines.push(`Perfect competition: P = the lowest marginal cost; the lowest-cost firm${by("competition")!.q.filter((x) => ratSign(x) > 0).length > 1 ? "s split" : " supplies"} the output (a tie is split equally, a convention: at P = MC the split is indeterminate, and HHI depends on it). Profit 0.`);
  lines.push(`Monopoly: a single firm with the lowest marginal cost (${mName}), Q = (a − c)/(2b), P = (a + c)/2; shown in ${mName}'s column, the others produce 0.`);
  lines.push(
    "Cournot–Nash: qᵢ = (P − cᵢ)/b with P = (a + Σcⱼ)/(k + 1) over the k active firms; a firm whose quantity would be 0 or less exits and the active set is recomputed (bounded by n rounds" +
      (r.cournotOut.length ? `; settled in ${r.cournotRounds} rounds` : "") +
      ").",
  );
  lines.push(`Bertrand (homogeneous goods, simultaneous prices): ${r.bertrandRule}.`);
  if (r.stackelbergRegime) {
    lines.push(
      `Stackelberg: ${firms[0].name} (the first line) leads and ${firms[1].name} follows with q₂ = max(0, (a − c₂ − bq₁)/(2b)); the leader maximises its profit over that whole response. Regime: ${r.stackelbergRegime}.`,
    );
  } else {
    lines.push(`Stackelberg is computed for exactly two firms (the first leads); with ${n} firm${n === 1 ? "" : "s"} it is not shown.`);
  }
  lines.push(
    "Consumer surplus = bQ²/2; total surplus = consumer surplus + total profit; deadweight loss is measured against perfect competition. Lerner index = Σ sᵢ(P − cᵢ)/P with output shares sᵢ (0 when P = MC = 0). HHI = Σ(100·sᵢ)² on the 0 to 10,000 scale.",
  );

  const tables: StatTable[] = [];
  const mRows: string[][] = [
    ["Market structure", `Price (${cur} per ${qunit})`, `Total output (${qunit})`, `Consumer surplus (${cur})`, `Total profit (${cur})`, `Total surplus (${cur})`, `Deadweight loss (${cur})`, "Lerner index", "HHI"],
  ];
  for (const s of r.structures) {
    const lerner = ratSign(s.price) === 0 ? "0 (P = MC = 0)" : fmtExact(s.lerner);
    mRows.push([s.label, fmtExact(s.price), fmtExact(s.total), fmtExact(s.cs), fmtExact(s.ps), fmtExact(s.ts), fmtExact(s.dwl), lerner, fmtExact(s.hhi)]);
  }
  tables.push({ label: "Market outcomes by structure", rows: mRows, align: ["left", "right", "right", "right", "right", "right", "right", "right", "right"] });
  const head = ["Firm", `Marginal cost (${cur} per ${qunit})`, ...r.structures.map((s) => s.label)];
  const qRows: string[][] = [head];
  const pRows: string[][] = [head];
  firms.forEach((f, i) => {
    qRows.push([f.name, fmtExact(f.c), ...r.structures.map((s) => fmtExact(s.q[i]))]);
    pRows.push([f.name, fmtExact(f.c), ...r.structures.map((s) => fmtExact(s.profit[i]))]);
  });
  const align = head.map((_, j): "left" | "right" => (j === 0 ? "left" : "right"));
  tables.push({ label: `Output by firm (${qunit})`, rows: qRows, align });
  tables.push({ label: `Profit by firm (${cur})`, rows: pRows, align });

  let svg: string | undefined;
  if (n >= 2) svg = bestResponseFigure(a, b, firms, cournot, by("stackelberg"), qunit);
  else lines.push("With one firm there are no best-response functions to draw.");
  return { text: lines.join("\n"), tables, svg };
}

/** A firm's name on an axis title, or "firm k" when the name is too long for the axis (the figure's note names it). */
function axisName(name: string, k: number): string {
  return name.length <= 14 ? name : `firm ${k}`;
}

function bestResponseFigure(a: Rat, b: Rat, firms: Firm[], cournot: Structure, stack: Structure | undefined, qunit: string): string {
  const num = ratToNumber;
  const { A1, A2, others } = bestResponseIntercepts(a, b, firms, cournot.q);
  const lim = (A: Rat): number => (ratSign(A) > 0 ? num(ratDiv(A, b)) : 0);
  const pts = [lim(A1), lim(A2), num(cournot.q[0]), num(cournot.q[1])];
  if (stack) pts.push(num(stack.q[0]), num(stack.q[1]));
  const top = Math.max(...pts, 1e-9) * 1.08;
  // Firm 1's response q₁ = max(0, (A₁ − bq₂)/(2b)) in the (q₁, q₂) plane, and firm 2's q₂ = max(0, (A₂ − bq₁)/(2b)).
  const br1 =
    ratSign(A1) > 0
      ? [
          { x: num(ratDiv(A1, ratMul(R(2), b))), y: 0 },
          { x: 0, y: num(ratDiv(A1, b)) },
          { x: 0, y: top },
        ]
      : [
          { x: 0, y: 0 },
          { x: 0, y: top },
        ];
  const br2 =
    ratSign(A2) > 0
      ? [
          { x: 0, y: num(ratDiv(A2, ratMul(R(2), b))) },
          { x: num(ratDiv(A2, b)), y: 0 },
          { x: top, y: 0 },
        ]
      : [
          { x: 0, y: 0 },
          { x: top, y: 0 },
        ];
  const series: Series[] = [
    // Legend labels are capped at 22 characters by plot.ts; the axis titles carry the firms' names.
    { type: "line", points: br1, color: "#1d4ed8", label: "Best response q₁(q₂)" },
    { type: "line", points: br2, color: "#b45309", label: "Best response q₂(q₁)" },
    { type: "scatter", points: [{ x: num(cournot.q[0]), y: num(cournot.q[1]) }], color: "#111827", label: "Cournot–Nash" },
  ];
  if (stack) series.push({ type: "scatter", points: [{ x: num(stack.q[0]), y: num(stack.q[1]) }], color: "#be123c", label: "Stackelberg" });
  const notes: string[] = [];
  const renamed = [0, 1].filter((i) => axisName(firms[i].name, i + 1) !== firms[i].name);
  if (renamed.length) notes.push(renamed.map((i) => `Firm ${i + 1} is ${firms[i].name}.`).join(" "));
  if (firms.length === 3) notes.push(`${firms[2].name} is held at its Cournot output, ${fmtExactShort(others)} (${qunit}).`);
  if (firms.length > 3) notes.push(`The other ${firms.length - 2} firms are held at their Cournot outputs, ${fmtExactShort(others)} in total (${qunit}).`);
  return buildPlotSvg(series, {
    width: 420,
    height: 300,
    title: "Cournot best responses",
    xlabel: `q₁, output of ${axisName(firms[0].name, 1)} (${qunit})`,
    ylabel: `q₂, output of ${axisName(firms[1].name, 2)} (${qunit})`,
    xLimits: { min: 0, max: top },
    yLimits: { min: 0, max: top },
    notes,
  });
}

/** Exposed for tests: the identity CS + PS + revenue − subsidy cost + DWL = total surplus without the policy. */
export function welfareIdentityHolds(r: MarketOutcome): boolean {
  const ts = ratSub(ratAdd(ratAdd(r.cs, r.ps), r.rev), r.sub);
  return cmp(ratAdd(ts, r.dwl), ratAdd(r.csE, r.psE)) === 0;
}
