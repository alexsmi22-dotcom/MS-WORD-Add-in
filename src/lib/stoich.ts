// Reaction stoichiometry: limiting reagent, theoretical and percent yield.
//
// The reaction is balanced first by balance.ts (an unbalanced or non-unique
// reaction is refused with that module's message). Each reactant amount is
// read with its unit and reduced to moles through units.ts convert():
//
//   mass      g, mg, kg, …           n = m / M
//   amount    mol, mmol, …           n
//   solution  volume + molarity      n = V · c
//   liquid    volume + density       n = V · ρ / M   (never an assumed 1 g/mL)
//   gas       volume + conditions    n = P·V / (R·T), R = 8.314462618 J/(mol·K)
//
// GAS CONDITIONS ARE NEVER ASSUMED. "STP" names two different standards —
// IUPAC (273.15 K, 100 kPa → 22.711 L/mol) and the older 273.15 K, 1 atm
// (→ 22.414 L/mol) — which differ by 1.3 %, and a silent choice is a wrong
// answer for half the textbooks. A bare "STP", or no conditions, is refused
// naming both.
//
// Molar masses are IUPAC conventional weights (chemValidate PERIODIC), printed
// per species. Results are quoted to the fewest significant figures any input
// carries (units.ts resultFigures).

import { balanceReaction, balanceAsWritten, parseSpecies, formatSpecies, Species, BalanceOk } from "./balance";
import { convert, formatSig, resultFigures } from "./units";

/** CODATA 2018 molar gas constant, exact. */
export const R_GAS = 8.314462618;

export type GasConditions = "IUPAC-STP" | "STP-1atm" | { T: string; P: string };

export interface StoichAmount {
  /** The species as written in the reaction (or any spelling of the same formula). */
  species: string;
  /** "10.0 g", "0.25 mol", "25.0 mL", "10.0 L". */
  amount: string;
  /** For a liquid volume: "1.082 g/mL". */
  density?: string;
  /** For a solution volume: "0.100 M", "0.100 mol/L". */
  molarity?: string;
  /**
   * "gas" marks a volume as an ideal gas (as does the state symbol (g) in the
   * reaction). A volume with none of density, molarity or gas is REFUSED — a
   * gas condition set for the request never turns a liquid into a gas.
   */
  phase?: "gas";
}

export interface StoichInput {
  reaction: string;
  amounts: StoichAmount[];
  /** Required for any gas volume. The bare string "STP" is refused (which STP?). */
  gas?: GasConditions | string;
  /** An actual yield of one product, for percent yield. */
  actual?: StoichAmount;
}

export interface ReactantRow {
  species: string;
  molarMass: number;
  coefficient: number;
  /** Moles available, or null when no amount was given (assumed in excess). */
  moles: number | null;
  /** How the moles were obtained, said in words. */
  how: string | null;
  /** The extent ξ = n/ν this reactant alone would allow. */
  extent: number | null;
  /** Moles consumed at the limiting extent. */
  needed: number;
  limiting: boolean;
  /** Left over after the reaction (mol and g); null for limiting or unspecified reactants. */
  excessMoles: number | null;
  excessMass: number | null;
}

export interface ProductRow {
  species: string;
  molarMass: number;
  coefficient: number;
  moles: number;
  mass: number;
}

export interface StoichOk {
  ok: true;
  equation: string;
  balance: BalanceOk;
  reactants: ReactantRow[];
  products: ProductRow[];
  /** Display names of the limiting reagent(s); more than one is a tie. */
  limiting: string[];
  /** The limiting extent ξ in mol. */
  extent: number;
  percentYield: { value: number; text: string; caveat: string | null } | null;
  /** Significant figures the results are quoted to. */
  figures: number;
  notes: string[];
  /** Ready-to-print lines (display contract: H₂O, mol, g). */
  lines: string[];
  /** Figure data: moles available vs needed per reactant with an amount. */
  chart: Array<{ species: string; available: number; needed: number; limiting: boolean }>;
}

export type StoichResult = StoichOk | { ok: false; message: string };

const NUM_RE = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*$/;

/** Local aliases convert() does not know. */
const PRESSURE_ALIASES: Record<string, [number, string]> = { torr: [101325 / 760, "Pa"], Torr: [101325 / 760, "Pa"] };

function readNumber(text: string, what: string): { value: number; unit: string; figuresText: string } | { error: string } {
  const m = NUM_RE.exec(text);
  if (!m) return { error: `${what}: “${text.trim()}” does not start with a number.` };
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return { error: `${what}: “${m[1]}” is not a finite number.` };
  return { value, unit: m[2].replace(/·/g, "*"), figuresText: m[1] };
}

function gasConditionsKPa(gas: StoichInput["gas"]): { T: number; P: number; label: string } | { error: string } {
  const both =
    "IUPAC STP (273.15 K, 100 kPa: 22.711 L/mol) or the older STP (273.15 K, 1 atm: 22.414 L/mol) — they differ by 1.3 %";
  if (gas === undefined) return { error: `a gas volume needs its conditions: ${both}, or a stated temperature and pressure.` };
  if (typeof gas === "string") {
    const g = gas.trim().toLowerCase();
    if (g === "iupac-stp" || g === "iupac") return { T: 273.15, P: 100000, label: "IUPAC STP (273.15 K, 100 kPa)" };
    if (g === "stp-1atm" || g === "1 atm" || g === "1atm") return { T: 273.15, P: 101325, label: "273.15 K and 1 atm" };
    if (g === "stp") return { error: `“STP” is ambiguous — which one: ${both}?` };
    return { error: `“${gas}” is not a gas condition this reads — choose ${both}, or give T and P.` };
  }
  const t = readNumber(gas.T, "Temperature");
  if ("error" in t) return t;
  const p = readNumber(gas.P, "Pressure");
  if ("error" in p) return p;
  if (!t.unit) return { error: "Temperature: give a unit (K or °C)." };
  if (!p.unit) return { error: "Pressure: give a unit (kPa, atm, bar, Pa, mmHg, torr)." };
  const T = convert(t.value, t.unit, "K");
  const P = PRESSURE_ALIASES[p.unit] ? p.value * PRESSURE_ALIASES[p.unit][0] : convert(p.value, p.unit, "Pa");
  if (T === null) return { error: `Temperature: “${t.unit}” is not a temperature unit.` };
  if (P === null) return { error: `Pressure: “${p.unit}” is not a pressure unit.` };
  if (!(T > 0)) return { error: "Temperature must be above absolute zero." };
  if (!(P > 0)) return { error: "Pressure must be positive." };
  return { T, P, label: `${gas.T.trim()} and ${gas.P.trim()}` };
}

interface Moles {
  mol: number;
  how: string;
  figures: string[];
}

function toMoles(a: StoichAmount, sp: Species, gas: StoichInput["gas"], allowZero: boolean): Moles | { error: string } {
  const name = formatSpecies(sp);
  const n = readNumber(a.amount, name);
  if ("error" in n) return n;
  if (n.value < 0 || (!allowZero && n.value === 0)) return { error: `${name}: an amount must be positive (got ${a.amount.trim()}).` };
  if (!n.unit) return { error: `${name}: give a unit (g, mol, mL, L …) — a bare number is not an amount.` };
  const figures = [n.figuresText];
  const M = sp.molarMass;
  const g = convert(n.value, n.unit, "g");
  if (g !== null) return { mol: g / M, how: `${a.amount.trim()} ÷ ${formatSig(M, 6)} g/mol`, figures };
  const mol = convert(n.value, n.unit, "mol");
  if (mol !== null) return { mol, how: a.amount.trim(), figures };
  const L = convert(n.value, n.unit, "L");
  if (L === null) return { error: `${name}: “${n.unit}” is not a mass, amount or volume unit.` };
  if (a.molarity) {
    const c = readNumber(a.molarity, `${name} molarity`);
    if ("error" in c) return c;
    if (!(c.value > 0)) return { error: `${name}: the molarity must be positive.` };
    const M2 = convert(c.value, c.unit || "M", "M") ?? convert(c.value, c.unit, "mol/L");
    if (M2 === null) return { error: `${name}: “${c.unit}” is not a molarity unit (M, mM, mol/L).` };
    return { mol: L * M2, how: `${a.amount.trim()} × ${a.molarity.trim()}`, figures: [...figures, c.figuresText] };
  }
  if (a.density) {
    const d = readNumber(a.density, `${name} density`);
    if ("error" in d) return d;
    if (!(d.value > 0)) return { error: `${name}: the density must be positive.` };
    const rho = d.unit ? convert(d.value, d.unit, "g/mL") : null;
    if (rho === null) return { error: `${name}: give the density with a unit, e.g. 1.082 g/mL.` };
    const mass = L * 1000 * rho;
    return { mol: mass / M, how: `${a.amount.trim()} × ${a.density.trim()} ÷ ${formatSig(M, 6)} g/mol`, figures: [...figures, d.figuresText] };
  }
  const st = (sp.state ?? "").toLowerCase();
  if (st === "(l)" || st === "(s)" || st === "(cr)") {
    return { error: `${a.amount.trim()} of ${name} — give its density in g/mL (a liquid's density is never assumed to be 1 g/mL).` };
  }
  if (st === "(aq)") return { error: `${a.amount.trim()} of ${name} — give the solution's molarity.` };
  if (st !== "(g)" && a.phase !== "gas") {
    return {
      error:
        `${a.amount.trim()} of ${name}: is it a liquid, a solution or a gas? Give its density (a liquid's density is never assumed to be 1 g/mL), ` +
        `its molarity (a solution), or mark it as a gas — (g) in the reaction — with the gas conditions.`,
    };
  }
  const cond = gasConditionsKPa(gas);
  if ("error" in cond) return { error: `${a.amount.trim()} of ${name}: ${cond.error}` };
  const molGas = (cond.P * (L / 1000)) / (R_GAS * cond.T);
  const vm = (R_GAS * cond.T) / cond.P * 1000;
  return { mol: molGas, how: `${a.amount.trim()} of gas at ${cond.label} (ideal gas, V_m = ${formatSig(vm, 5)} L/mol)`, figures };
}

function sameSpecies(a: Species, b: Species): boolean {
  if (a.electron !== b.electron || a.charge !== b.charge) return false;
  const keys = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
  for (const k of keys) {
    const x = a.counts[k];
    const y = b.counts[k];
    if (!x || !y || x.n !== y.n || x.d !== y.d) return false;
  }
  return true;
}

/** Limiting reagent, theoretical yield, excess and percent yield. */
export function stoichiometry(input: StoichInput): StoichResult {
  let first = balanceReaction(input.reaction);
  const preNotes: string[] = [];
  if (!first.ok && first.kind === "not-unique") {
    // The formulas alone admit several balancings; the equation AS WRITTEN
    // (coefficients typed, 1 where none) may still be a valid one — the
    // chemist's equation then fixes the ratio, and we say so.
    const w = balanceAsWritten(input.reaction);
    if (w.ok) {
      first = w;
      preNotes.push(
        `The formulas alone allow more than one balancing; the equation as written (${w.equation}) conserves every element and the charge, so its coefficients are used.`,
      );
    }
  }
  if (!first.ok) return { ok: false, message: `The reaction must balance first: ${first.message}` };
  const b: BalanceOk = first;
  if (b.species.some((s) => s.electron)) return { ok: false, message: "This equation has free electrons (a half-reaction) — it is not a mass problem." };
  if (!input.amounts.length) return { ok: false, message: "Give an amount for at least one reactant." };

  const n = b.species.length;
  const moles: Array<Moles | null> = new Array(n).fill(null);
  const findIndex = (text: string): number | { error: string } => {
    const p = parseSpecies(text);
    if (!p.ok) return { error: `“${text}”: ${p.error}` };
    const hits = b.species.map((s, j) => (sameSpecies(s, p.species) ? j : -1)).filter((j) => j >= 0);
    if (!hits.length) return { error: `${formatSpecies(p.species)} is not in this reaction.` };
    return hits[0];
  };
  for (const a of input.amounts) {
    const j = findIndex(a.species);
    if (typeof j !== "number") return { ok: false, message: j.error };
    const sp = b.species[j];
    if (b.sides[j] === "right") return { ok: false, message: `${formatSpecies(sp)} is a product — give amounts for reactants (use the actual yield for a product).` };
    if (moles[j]) return { ok: false, message: `Two amounts were given for ${formatSpecies(sp)}.` };
    const m = toMoles(a, sp, input.gas, false);
    if ("error" in m) return { ok: false, message: m.error };
    moles[j] = m;
  }

  const figureTexts: string[] = [];
  for (const m of moles) if (m) figureTexts.push(...m.figures);
  let actualMoles: Moles | null = null;
  let actualIndex = -1;
  if (input.actual) {
    const j = findIndex(input.actual.species);
    if (typeof j !== "number") return { ok: false, message: j.error };
    if (b.sides[j] !== "right") return { ok: false, message: `The actual yield must be of a product; ${formatSpecies(b.species[j])} is a reactant.` };
    const m = toMoles(input.actual, b.species[j], input.gas, true);
    if ("error" in m) return { ok: false, message: m.error };
    actualMoles = m;
    actualIndex = j;
    figureTexts.push(...m.figures);
  }
  const sig = resultFigures(figureTexts);
  const f = (x: number): string => formatSig(x, sig);

  // Extents.
  let xi = Infinity;
  const extents = b.species.map((_, j) => (moles[j] ? moles[j]!.mol / b.coefficients[j] : null));
  for (const e of extents) if (e !== null && e < xi) xi = e;
  // A tie is equality at the significant figures the result is quoted to.
  const limitingIdx = extents.map((e, j) => (e !== null && f(e) === f(xi) ? j : -1)).filter((j) => j >= 0);

  const reactants: ReactantRow[] = [];
  const products: ProductRow[] = [];
  const notes: string[] = [...preNotes];
  b.species.forEach((s, j) => {
    const nu = b.coefficients[j];
    if (b.sides[j] === "left") {
      const m = moles[j];
      const lim = limitingIdx.includes(j);
      const left = m && !lim ? m.mol - nu * xi : null;
      reactants.push({
        species: formatSpecies(s),
        molarMass: s.molarMass,
        coefficient: nu,
        moles: m ? m.mol : null,
        how: m ? m.how : null,
        extent: extents[j],
        needed: nu * xi,
        limiting: lim,
        excessMoles: left,
        excessMass: left === null ? null : left * s.molarMass,
      });
      if (!m) notes.push(`No amount was given for ${formatSpecies(s)}; it is assumed to be in excess.`);
    } else {
      products.push({ species: formatSpecies(s), molarMass: s.molarMass, coefficient: nu, moles: nu * xi, mass: nu * xi * s.molarMass });
    }
  });
  const limiting = limitingIdx.map((j) => formatSpecies(b.species[j]));

  let percentYield: StoichOk["percentYield"] = null;
  if (actualMoles) {
    const theo = b.coefficients[actualIndex] * xi;
    const value = (actualMoles.mol / theo) * 100;
    const caveat = value > 100 ? "above 100 % — wet or impure product, or the wrong limiting reagent" : null;
    percentYield = { value, text: `${f(value)} %`, caveat };
  }

  const lines: string[] = [];
  lines.push(`Balanced: ${b.equation}`);
  for (const r of reactants) {
    lines.push(
      r.moles === null
        ? `${r.species} (M = ${formatSig(r.molarMass, 6)} g/mol): no amount given — in excess; ${f(r.needed)} mol (${f(r.needed * r.molarMass)} g) is consumed.`
        : `${r.species} (M = ${formatSig(r.molarMass, 6)} g/mol): ${f(r.moles)} mol (${r.how}); allows ξ = ${f(r.extent!)} mol.`,
    );
  }
  lines.push(
    limiting.length > 1
      ? `Limiting: ${limiting.join(" and ")} are both exhausted (equal at ${sig} significant figures); ξ = ${f(xi)} mol.`
      : `Limiting reagent: ${limiting[0]} (ξ = ${f(xi)} mol).`,
  );
  for (const p of products) lines.push(`Theoretical ${p.species} (M = ${formatSig(p.molarMass, 6)} g/mol): ${f(p.moles)} mol = ${f(p.mass)} g.`);
  for (const r of reactants) {
    if (r.excessMoles !== null) lines.push(`${r.species} left over: ${f(r.excessMoles)} mol = ${f(r.excessMass!)} g.`);
  }
  if (percentYield) {
    lines.push(`Percent yield of ${formatSpecies(b.species[actualIndex])}: ${percentYield.text}${percentYield.caveat ? ` — ${percentYield.caveat}` : ""}.`);
  }
  if (b.asWritten && !b.asWritten.balanced) notes.push(b.asWritten.message);
  notes.push(...b.notes);
  notes.push("Ideal-gas volumes only; molar masses from IUPAC conventional atomic weights.");

  return {
    ok: true,
    equation: b.equation,
    balance: b,
    reactants,
    products,
    limiting,
    extent: xi,
    percentYield,
    figures: sig,
    notes,
    lines,
    chart: reactants
      .filter((r) => r.moles !== null)
      .map((r) => ({ species: r.species, available: r.moles as number, needed: r.needed, limiting: r.limiting })),
  };
}
