/**
 * Life tables for the forensic and actuarial calculators (Release F2, gap items #8 and #17).
 *
 * A table is an lx column by single year of age, from a start age to a closing age where lx reaches 0. It comes from
 * the bundled CDC/NCHS United States Life Tables, 2024 (usLifeTable2024.ts: total, males, females; public domain), or
 * from the user's own pasted qx or lx column (any table: a state table, an annuity table, a textbook table). Worklife
 * tables are never bundled (the Skoog–Ciecka–Krueger tables are proprietary): worklife figures are the user's inputs.
 *
 * CONVENTIONS (printed by the callers):
 *  - The CDC open interval "100 and over" is extended with a constant one-year survival p = (2e₁₀₀ − 1)/(2e₁₀₀ + 1)
 *    (e₁₀₀ the published expectation of life at 100): with lx linear between whole ages the complete expectation at
 *    100 is (1 + p)/(2(1 − p)) = e₁₀₀, so the extended table reproduces the published value. It is closed (lx = 0) at
 *    age 131, where fewer than 10⁻⁶ of the lives at 100 remain.
 *  - A pasted table runs over consecutive whole ages. Its last row closes it: every life alive at the last age dies
 *    within that year (q = 1 there), and a note says so when the pasted last value did not already close it.
 *  - Between whole ages lx is interpolated linearly (uniform distribution of deaths, UDD).
 *  - Commutation functions at the annual effective rate i, v = 1/(1 + i): Dₓ = vˣ lₓ, Nₓ = Σ_{k≥x} D_k,
 *    Cₓ = vˣ⁺¹ dₓ, Mₓ = Σ_{k≥x} C_k. äₓ = Nₓ/Dₓ, aₓ = Nₓ₊₁/Dₓ, Aₓ = Mₓ/Dₓ (death benefit at the end of the year of
 *    death), ₙEₓ = Dₓ₊ₙ/Dₓ, äₓ:ₙ = (Nₓ − Nₓ₊ₙ)/Dₓ, A¹ₓ:ₙ = (Mₓ − Mₓ₊ₙ)/Dₓ, ₘ|äₓ = Nₓ₊ₘ/Dₓ.
 */
import { readDataBlock } from "./dataBlock";
import { US_LIFE_2024, US_LIFE_2024_SHORT, US_LIFE_2024_SOURCE, type UsLifeSex } from "./usLifeTable2024";

/** Oldest age a pasted table may reach (the Illustrative Life Table and annuity tables run to 120–140). */
export const LT_MAX_AGE = 150;
/** Where the extended CDC table closes. */
export const CDC_CLOSE_AGE = 131;

export interface LifeTable {
  /** "CDC 2024 United States, males" or "your qx table". */
  label: string;
  /** Source line for the result text. */
  source: string;
  startAge: number;
  /** lx at ages startAge, startAge + 1, …; the last entry is 0 (the closing age). */
  lx: number[];
  notes: string[];
  /** Conventions sentence for the result text. */
  convention: string;
}

export interface Refusal {
  error: string;
}
export const isRefusal = (x: unknown): x is Refusal => typeof x === "object" && x !== null && "error" in x;

const SEX_WORDS: Record<UsLifeSex, string> = { total: "total population", male: "males", female: "females" };

/** The bundled CDC 2024 table for one sex, extended past 100 at the one-year survival (2e₁₀₀ − 1)/(2e₁₀₀ + 1), closed at 131. */
export function cdcTable(sex: UsLifeSex): LifeTable {
  const t = US_LIFE_2024[sex];
  const lx: number[] = [100000];
  for (let x = 0; x < 100; x++) lx.push(lx[x] * (1 - t.qx[x]));
  const p = (2 * t.e100 - 1) / (2 * t.e100 + 1);
  for (let x = 100; x < CDC_CLOSE_AGE - 1; x++) lx.push(lx[x] * p);
  lx.push(0);
  return {
    label: `CDC 2024 United States life table, ${SEX_WORDS[sex]}`,
    source: US_LIFE_2024_SOURCE,
    startAge: 0,
    lx,
    notes: [],
    convention:
      `life table ${US_LIFE_2024_SHORT}, ${SEX_WORDS[sex]} (period table, public domain); ages 100 and over at the one-year survival (2e₁₀₀ − 1)/(2e₁₀₀ + 1), e₁₀₀ = ${t.e100} ` +
      `(reproduces the published e₁₀₀), closed at ${CDC_CLOSE_AGE}; lx linear between whole ages (UDD)`,
  };
}

const num = (x: number): string => (Number.isInteger(x) ? String(x) : String(+x.toPrecision(6)));

/** A pasted qx or lx column: "age, value" rows over consecutive whole ages. */
export function userTable(text: string, kind: "qx" | "lx"): LifeTable | Refusal {
  const what = kind === "qx" ? "Your life table (age, qx)" : "Your life table (age, lx)";
  const b = readDataBlock(text, what, { maxRows: LT_MAX_AGE + 1 });
  if (!b.ok) return { error: b.error };
  const ages: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    const line = b.lines[i];
    if (row.length !== 2 || row.some((v) => v === null)) return { error: `${what}, line ${line}: each row is an age and one ${kind} value.` };
    const [a, v] = row as number[];
    if (!Number.isInteger(a) || a < 0 || a > LT_MAX_AGE) return { error: `${what}, line ${line}: the age (${num(a)}) must be a whole number from 0 to ${LT_MAX_AGE}.` };
    if (ages.length && a !== ages[ages.length - 1] + 1) return { error: `${what}, line ${line}: age ${a} does not follow ${ages[ages.length - 1]}; give one row per age, in order.` };
    if (kind === "qx" && !(v >= 0 && v <= 1)) return { error: `${what}, line ${line} (age ${a}): qx must be from 0 to 1 (a probability, not per 1,000).` };
    if (kind === "lx") {
      if (!(v >= 0) || v > 1e12) return { error: `${what}, line ${line} (age ${a}): lx must be from 0 to one trillion.` };
      if (vals.length && v > vals[vals.length - 1]) return { error: `${what}, line ${line} (age ${a}): lx rises from ${num(vals[vals.length - 1])} to ${num(v)}; lx cannot increase with age.` };
      if (!vals.length && !(v > 0)) return { error: `${what}, line ${line}: the first lx must be above 0.` };
    }
    ages.push(a);
    vals.push(v);
  }
  if (ages.length < 2) return { error: `${what}: give at least two ages.` };
  const notes = [...b.notes];
  const lx: number[] = [];
  const last = ages[ages.length - 1];
  if (kind === "qx") {
    lx.push(100000);
    for (let i = 0; i < vals.length - 1; i++) lx.push(lx[i] * (1 - vals[i]));
    // The last row closes the table.
    if (vals[vals.length - 1] < 1) notes.push(`Your table's last qx (age ${last}) is ${num(vals[vals.length - 1])}; it was taken as 1 (every life alive at ${last} dies within that year), closing the table.`);
    lx.push(0);
  } else {
    lx.push(...vals);
    if (vals[vals.length - 1] > 0) {
      notes.push(`Your table's last lx (age ${last}) is ${num(vals[vals.length - 1])}; the table was closed with lx = 0 at age ${last + 1}.`);
      if (last + 1 > LT_MAX_AGE + 1) return { error: `${what}: the table must close by age ${LT_MAX_AGE + 1}.` };
      lx.push(0);
    }
  }
  // Trim trailing zeros after the first zero (a table that reaches 0 early).
  const z = lx.indexOf(0);
  if (z > 0) lx.length = z + 1;
  if (z === 0) return { error: `${what}: the first age has no lives.` };
  return {
    label: `your ${kind} table`,
    source: `your pasted ${kind} column, ages ${ages[0]}–${last}`,
    startAge: ages[0],
    lx,
    notes,
    convention: `life table: your pasted ${kind} column (ages ${ages[0]}–${last}), closed after its last age; lx linear between whole ages (UDD)`,
  };
}

/** The life-table select's options, shared by the calculators. */
export const LIFE_TABLE_OPTIONS = [
  { value: "cdc-total", label: "CDC 2024 US life table: total population" },
  { value: "cdc-male", label: "CDC 2024 US life table: males" },
  { value: "cdc-female", label: "CDC 2024 US life table: females" },
  { value: "user-qx", label: "Your table: paste age, qx" },
  { value: "user-lx", label: "Your table: paste age, lx" },
];

/** The table named by the select (and the pasted block for the user's own table). */
export function chooseTable(choice: string, block: string): LifeTable | Refusal {
  if (choice === "cdc-male") return cdcTable("male");
  if (choice === "cdc-female") return cdcTable("female");
  if (choice === "user-qx" || choice === "user-lx") {
    if (!(block ?? "").trim()) return { error: "Your life table: paste an age, qx (or lx) row for each age, or choose a CDC table." };
    return userTable(block, choice === "user-qx" ? "qx" : "lx");
  }
  return cdcTable("total");
}

export const endAge = (t: LifeTable): number => t.startAge + t.lx.length - 1;

/** lx at a (possibly fractional) age, linear between whole ages (UDD); 0 at and past the closing age; NaN below the start. */
export function lAt(t: LifeTable, age: number): number {
  if (!(age >= t.startAge)) return NaN;
  const k = age - t.startAge;
  if (k >= t.lx.length - 1) return 0;
  const i = Math.floor(k);
  const f = k - i;
  return f === 0 ? t.lx[i] : t.lx[i] + (t.lx[i + 1] - t.lx[i]) * f;
}

/** P(alive at age `to` | alive at age `from`), UDD; NaN when `from` is outside the table or has no lives. */
export function survival(t: LifeTable, from: number, to: number): number {
  const l0 = lAt(t, from);
  if (!(l0 > 0)) return NaN;
  if (to <= from) return 1;
  return lAt(t, to) / l0;
}

/** Complete expectation of life at a whole age x under UDD: ˚eₓ = Σ_{k≥x} (l_k + l_{k+1})/2 / lₓ. */
export function completeExpectation(t: LifeTable, x: number): number {
  const i0 = x - t.startAge;
  if (!(i0 >= 0) || i0 >= t.lx.length - 1 || !(t.lx[i0] > 0)) return NaN;
  let s = 0;
  for (let i = i0; i < t.lx.length - 1; i++) s += (t.lx[i] + t.lx[i + 1]) / 2;
  return s / t.lx[i0];
}

/** Curtate expectation eₓ = Σ_{k≥1} lₓ₊ₖ / lₓ. */
export function curtateExpectation(t: LifeTable, x: number): number {
  const i0 = x - t.startAge;
  if (!(i0 >= 0) || i0 >= t.lx.length - 1 || !(t.lx[i0] > 0)) return NaN;
  let s = 0;
  for (let i = i0 + 1; i < t.lx.length; i++) s += t.lx[i];
  return s / t.lx[i0];
}

export interface Commutation {
  /** Ages startAge … endAge (the last has lx = 0). */
  ages: number[];
  D: number[];
  N: number[];
  C: number[];
  M: number[];
}

/**
 * Commutation columns at the annual effective rate i, Dₓ = vˣ lₓ as in the textbooks (callers keep i within
 * −5% … 25%, so v¹⁵⁰ stays well inside a double).
 */
export function commutation(t: LifeTable, i: number): Commutation {
  const v = 1 / (1 + i);
  const n = t.lx.length;
  const ages: number[] = [];
  const D: number[] = new Array(n);
  const C: number[] = new Array(n);
  let vp = Math.pow(v, t.startAge);
  for (let k = 0; k < n; k++) {
    ages.push(t.startAge + k);
    D[k] = vp * t.lx[k];
    C[k] = k < n - 1 ? vp * v * (t.lx[k] - t.lx[k + 1]) : 0;
    vp *= v;
  }
  const N: number[] = new Array(n);
  const M: number[] = new Array(n);
  let sn = 0;
  let sm = 0;
  for (let k = n - 1; k >= 0; k--) {
    sn += D[k];
    sm += C[k];
    N[k] = sn;
    M[k] = sm;
  }
  return { ages, D, N, C, M };
}
