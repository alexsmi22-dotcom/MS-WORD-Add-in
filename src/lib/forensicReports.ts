/**
 * Field readers and result builders for the Release F2 forensic and actuarial calculators (gap items #8 and #17),
 * wired into the pane by forensicCalcs.ts. Engines: forensicEarnings.ts (lost earnings, LPE), lifeTable.ts (life
 * tables, commutation functions), retirement.ts (schedule, Monte Carlo).
 */
import type { FinResult, FinTable } from "./finCalc";
import { readDataBlock } from "./dataBlock";
import { parseDateField, longDate } from "./damagesInterest";
import { usd } from "./damagesUsd";
import { finPlotSvg } from "./financeFigures";
import { readNum, fixedText, pctText, isRefusal, type Refusal } from "./ipValuation";
import { PCG_MAX_SEED, PCG_STREAM } from "./prng";
import { superscript } from "./axis";
import { chooseTable, commutation, completeExpectation, curtateExpectation, endAge, lAt, type LifeTable } from "./lifeTable";
import { DAYS_PER_YEAR, lostEarningsLpe, lpeFigure, money, rowLabel, type PeRow } from "./forensicEarnings";
import { retirementSchedule, swrMonteCarlo } from "./retirement";

type Read = (k: string) => string;
type Align = "left" | "center" | "right";
const refuse = (e: Refusal): FinResult => ({ text: e.error, ok: false });
const q = (s: string): string => `“${s.length > 40 ? s.slice(0, 40) + "…" : s}”`;
const yrs = (x: number): string => fixedText(x, 2);
const ageText = (x: number): string => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : fixedText(x, 2));
/** A probability or factor: six decimals. */
const f6 = (x: number): string => fixedText(x, 6);
/** A factor: four decimals (äx, as the tables print it). */
const f4 = (x: number): string => fixedText(x, 4);
/** Bare money (currency-neutral Finance). */
const amt = (x: number): string => fixedText(x, 2);

/**
 * Six significant digits, grouped, true minus; outside 0.001 … 10¹⁵ as "1.23456 × 10⁻⁵" (no e-notation), for the
 * commutation columns, whose values span many orders of magnitude.
 */
export function sigText(x: number, sig = 6): string {
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const ax = Math.abs(x);
  if (ax >= 1e-3 && ax < 1e15) {
    const e = Math.floor(Math.log10(ax));
    return fixedText(x, Math.max(0, sig - 1 - e));
  }
  const [mant, ex] = x.toExponential(sig - 1).split("e");
  const m = fixedText(Number(mant), sig - 1);
  return `${m} × 10${superscript(Number(ex))}`;
}

const LIFE_NOTE_WLE =
  "No worklife table is bundled: worklife expectancy, participation and employment figures are your inputs (published worklife tables such as Skoog–Ciecka–Krueger are proprietary).";

// ---------------------------------------------------------------------------------------------------------------
// #8 Lost earnings, forensic grade
// ---------------------------------------------------------------------------------------------------------------

/** "From age, participation %, employment %" rows, read by RULE N. */
export function readPeBlock(text: string, ageInjury: number): PeRow[] | Refusal {
  const what = "Participation and employment (from age, participation %, employment %)";
  const b = readDataBlock(text, what, { maxRows: 130 });
  if (!b.ok) return { error: b.error };
  const out: PeRow[] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    const line = b.lines[i];
    if (row.length !== 3 || row.some((v) => v === null)) return { error: `${what}, line ${line}: each row is a from-age, a participation % and an employment %.` };
    const [a, p, e] = row as number[];
    if (!(a >= 0 && a <= 125)) return { error: `${what}, line ${line}: the from-age must be from 0 to 125.` };
    if (out.length && !(a > out[out.length - 1].fromAge)) return { error: `${what}, line ${line}: from-age ${ageText(a)} does not follow ${ageText(out[out.length - 1].fromAge)}; list the rows by rising age.` };
    if (!(p >= 0 && p <= 100)) return { error: `${what}, line ${line} (age ${ageText(a)}): participation must be from 0% to 100%.` };
    if (!(e >= 0 && e <= 100)) return { error: `${what}, line ${line} (age ${ageText(a)}): employment must be from 0% to 100%.` };
    // A value strictly between 0 and 1 is a decimal typed into a percent column (0.88 for 88%): read as 0.88% it would
    // understate that row a hundredfold, so it is refused rather than guessed.
    for (const [v, name] of [[p, "participation"], [e, "employment"]] as const) {
      if (v > 0 && v < 1) return { error: `${what}, line ${line} (age ${ageText(a)}): ${name} ${fixedText(v, 4).replace(/0+$/, "")} reads as less than 1%; enter percentages (88, not 0.88).` };
    }
    out.push({ fromAge: a, part: p / 100, emp: e / 100 });
  }
  if (!out.length) return { error: `${what}: enter at least one row.` };
  if (out[0].fromAge > ageInjury + 1e-9) return { error: `${what}: the first row starts at age ${ageText(out[0].fromAge)}, after the age at injury (${yrs(ageInjury)}); add a row starting at or before it.` };
  return out;
}

function readPct(read: Read, key: string, label: string, min: number, max: number, range: string, o: { minExclusive?: boolean; maxExclusive?: boolean } = {}): number | Refusal {
  const v = readNum(read(key), label, { min, max, range, ...o });
  return isRefusal(v) ? v : v / 100;
}

export function lpeCalc(read: Read): FinResult {
  const dob = parseDateField(read("dob"), "date of birth");
  if (typeof dob !== "number") return refuse(dob);
  const injury = parseDateField(read("injury"), "date of injury");
  if (typeof injury !== "number") return refuse(injury);
  const trial = parseDateField(read("trial"), "trial date");
  if (typeof trial !== "number") return refuse(trial);
  if (!(injury > dob)) return refuse({ error: `The date of injury (${longDate(injury)}) must be after the date of birth (${longDate(dob)}).` });
  if (trial < injury) return refuse({ error: `The trial date (${longDate(trial)}) is before the date of injury (${longDate(injury)}).` });
  const ageInjury = (injury - dob) / DAYS_PER_YEAR;
  if (ageInjury > 110) return refuse({ error: `The age at injury (${yrs(ageInjury)}) is above 110, outside this calculator.` });
  if ((trial - injury) / DAYS_PER_YEAR > 60) return refuse({ error: "More than 60 years between the injury and the trial is outside this calculator." });
  const table = chooseTable(read("table"), read("usertable"));
  if (isRefusal(table)) return refuse(table);
  const base = readNum(read("base"), "Pre-injury annual earnings", { min: 0, max: 1e12, range: "0 to one trillion" });
  if (isRefusal(base)) return refuse(base);
  const residual = readNum(read("residual"), "Residual earning capacity per year", { min: 0, max: 1e12, range: "0 to one trillion" });
  if (isRefusal(residual)) return refuse(residual);
  if (residual > base) return refuse({ error: `The residual earning capacity (${usd(amt(residual))}) is above the pre-injury earnings (${usd(amt(base))}): there is no earnings loss to compute.` });
  const growth = readPct(read, "growth", "Earnings growth (% a year)", -100, 100, "above −100% and at most 100% a year", { minExclusive: true });
  if (isRefusal(growth)) return refuse(growth);
  const method = read("method") === "wle" ? "wle" : "lpe";
  let workEndAge = NaN;
  let wle = NaN;
  let pe: PeRow[] = [{ fromAge: 0, part: 1, emp: 1 }];
  if (method === "lpe") {
    const w = readNum(read("workend"), "Earnings end age", { min: 0, max: 110, range: "an age above the age at injury, at most 110" });
    if (isRefusal(w)) return refuse(w);
    if (!(w > ageInjury)) return refuse({ error: `Earnings end age (${ageText(w)}) must be above the age at injury (${yrs(ageInjury)}).` });
    workEndAge = w;
    const p = readPeBlock(read("pe"), ageInjury);
    if (isRefusal(p)) return refuse(p);
    pe = p;
  } else {
    const w = readNum(read("wle"), "Worklife expectancy (years, from your worklife table)", { min: 0, max: 80, minExclusive: true, range: "more than 0 and at most 80 years" });
    if (isRefusal(w)) return refuse(w);
    wle = w;
  }
  const fringe = readPct(read, "fringe", "Fringe benefits (% of earnings)", 0, 200, "0% to 200%");
  if (isRefusal(fringe)) return refuse(fringe);
  const tax = readPct(read, "tax", "Effective tax rate (%)", 0, 100, "0% to less than 100%", { maxExclusive: true });
  if (isRefusal(tax)) return refuse(tax);
  const consumption = readPct(read, "consumption", "Personal consumption (%)", 0, 100, "0% to 100%");
  if (isRefusal(consumption)) return refuse(consumption);
  const hhHours = readNum(read("hhhours"), "Household services (hours a week)", { min: 0, max: 168, range: "0 to 168 hours a week" });
  if (isRefusal(hhHours)) return refuse(hhHours);
  const hhValue = readNum(read("hhvalue"), "Value of household services (an hour)", { min: 0, max: 1e6, range: "0 to 1,000,000 an hour" });
  if (isRefusal(hhValue)) return refuse(hhValue);
  let hhGrowth = 0;
  let hhEndAge = 0;
  const hhOn = hhHours > 0 && hhValue > 0;
  if (hhOn) {
    const g = readPct(read, "hhgrowth", "Household services growth (% a year)", -100, 100, "above −100% and at most 100% a year", { minExclusive: true });
    if (isRefusal(g)) return refuse(g);
    hhGrowth = g;
    const e = readNum(read("hhend"), "Household services end age", { min: 0, max: 110, range: "an age above the age at injury, at most 110" });
    if (isRefusal(e)) return refuse(e);
    if (!(e > ageInjury)) return refuse({ error: `Household services end age (${ageText(e)}) must be above the age at injury (${yrs(ageInjury)}), or set the hours to 0.` });
    hhEndAge = e;
  }
  const survivalFrom = read("survival") === "injury" ? "injury" : "trial";
  const discountMode = read("dmode") === "ndr" ? "ndr" : "growth";
  let discount = 0;
  let ndr = 0;
  if (discountMode === "growth") {
    const d = readPct(read, "discount", "Discount rate (% a year)", -100, 100, "above −100% and at most 100% a year", { minExclusive: true });
    if (isRefusal(d)) return refuse(d);
    discount = d;
  } else {
    const d = readPct(read, "ndr", "Net discount rate (% a year)", -20, 20, "−20% to 20% a year");
    if (isRefusal(d)) return refuse(d);
    ndr = d;
  }
  const midYear = read("mid") !== "end";
  const pjiPct = readNum(read("pji"), "Prejudgment interest rate (% a year)", { min: 0, max: 100, range: "0% to 100% a year" });
  if (isRefusal(pjiPct)) return refuse(pjiPct);
  if (Math.abs(pjiPct * 1e4 - Math.round(pjiPct * 1e4)) > 1e-6) return refuse({ error: `Prejudgment interest rate (% a year): ${q(read("pji"))} has more than four decimals.` });
  const pjiMethod = read("pjimethod") === "annual" ? "annual" : "simple";

  const res = lostEarningsLpe({
    dob, injury, trial, table, base, residual, growth, method, workEndAge, wle, pe, fringe, tax, consumption,
    hhHours, hhValue, hhGrowth, hhEndAge, survivalFrom, discountMode, discount, ndr, midYear, pjiRate: pjiPct / 100, pjiMethod,
  });
  if ("error" in res) return refuse(res);

  const splitK = res.rows.find((r, i) => i > 0 && res.rows[i - 1].k === r.k)?.k ?? -1;
  const t1: string[][] = [["Loss year", "Age", "Earning capacity lost", "P(alive)", "P(part.) × P(emp.)", "Expected net earnings loss"]];
  const t2: string[][] = [["Loss year", "Household services", "Total loss", "Prejudgment interest", "Discount factor", "Value at trial date"]];
  let sCap = 0;
  let sEarn = 0;
  let sHh = 0;
  let sTot = 0;
  let sVal = 0;
  for (const r of res.rows) {
    const lab = rowLabel(r, r.k === splitK) + (r.b - r.a < 1 - 1e-9 ? ` (${fixedText(r.b - r.a, 2)} yr)` : "");
    const showP = method === "lpe" && r.earnLen > 0;
    t1.push([lab, fixedText(r.ageMid, 2), money(r.capacityCents), showP ? f6(r.pAliveEarn) : "", showP ? f6(r.pPe) : "", money(r.earnCents)]);
    t2.push([lab, money(r.hhCents), money(r.totalCents), r.past ? money(r.interestCents) : "", r.past ? "" : f6(r.df), money(r.valueCents + r.interestCents)]);
    sCap += r.capacityCents;
    sEarn += r.earnCents;
    sHh += r.hhCents;
    sTot += r.totalCents;
    sVal += r.valueCents + r.interestCents;
  }
  t1.push(["Total", "", money(sCap), "", "", money(sEarn)]);
  t2.push(["Total", money(sHh), money(sTot), money(res.interestCents), "", money(sVal)]);
  const t3: string[][] = [
    ["Component", "Amount"],
    ["Past losses (injury to trial)", money(res.pastCents)],
    ["Prejudgment interest on past losses", money(res.interestCents)],
    ["Future losses before discounting", money(res.futureCents)],
    ["Present value of future losses", money(res.futurePvCents)],
    ["Total at the trial date", money(res.totalCents)],
  ];
  const right6: Align[] = ["left", "right", "right", "right", "right", "right"];
  const tables: FinTable[] = [
    { label: "Lost earning capacity by loss year", rows: t1, align: right6 },
    { label: "Losses valued at the trial date", rows: t2, align: right6 },
    { label: "Lost earnings summary", rows: t3, align: ["left", "right"] },
  ];

  const rateWord = discountMode === "ndr" ? `net discount rate ${pctText(ndr * 100)}` : `discount rate ${pctText(discount * 100)} with growth ${pctText(growth * 100)}`;
  const lines = [
    `Lost earnings and household services (${method === "lpe" ? "LPE method" : "worklife expectancy method"}), computed from the inputs given`,
    `Total at the trial date: ${money(res.totalCents)} = past losses ${money(res.pastCents)} + prejudgment interest ${money(res.interestCents)} + present value of future losses ${money(res.futurePvCents)}`,
    `Past: injury on ${longDate(injury)} to trial on ${longDate(trial)} (${yrs(res.tTrial)} years); prejudgment interest at ${pctText(pjiPct)} a year, ${pjiMethod === "simple" ? "simple" : "compounded annually"}, on each past period from its middle day.`,
    `Future: ${money(res.futureCents)} before discounting, present value ${money(res.futurePvCents)} at the ${rateWord}.`,
    `Ages: ${yrs(res.ageInjury)} at injury, ${yrs(res.ageTrial)} at trial; earnings ${method === "lpe" ? `to age ${ageText(workEndAge)}` : `for ${ageText(wle)} years after the injury (worklife expectancy from your table)`}${hhOn ? `, household services to age ${ageText(hhEndAge)}` : ""}.`,
    `Inputs: pre-injury earnings ${usd(amt(base))} a year less residual earning capacity ${usd(amt(residual))} a year; earnings growth ${pctText(growth * 100)}; fringe benefits ${pctText(fringe * 100)}; effective tax rate ${pctText(tax * 100)}; personal consumption ${pctText(consumption * 100)}` +
      (hhOn ? `; household services ${fixedText(hhHours, 2).replace(/\.00$/, "")} hours a week × ${usd(amt(hhValue))} an hour, growing ${pctText(hhGrowth * 100)} a year.` : "; no household services."),
    method === "lpe"
      ? "Expected loss = (pre-injury − residual) × (1 + g)ᵏ⁻¹ × share of the year × (1 − tax + fringe) × (1 − consumption) × P(alive) × P(participating) × P(employed), plus household services × P(alive)."
      : "Expected loss = (pre-injury − residual) × (1 + g)ᵏ⁻¹ × share of the year × (1 − tax + fringe) × (1 − consumption) over the worklife expectancy (no probabilities applied: the worklife figure already reflects them), plus household services × P(alive).",
    `Conventions: t = days ÷ 365.25 since the injury; loss year k covers [k − 1, k), split at the trial date; growth on each anniversary of the injury; P(alive) ${
      survivalFrom === "trial" ? "1 for past periods (living plaintiff) and l(age)/l(age at trial) for future periods" : "l(age)/l(age at injury) for every period (wrongful death)"
    }, at the middle of each period; ${table.convention}; ${
      discountMode === "ndr" ? "net discount rate: future periods held at the level of the loss year holding the trial date" : "growth + discount: every period grows at g"
    }; future periods discounted from the trial date to the period's ${midYear ? "middle (mid-year)" : "end (end of year)"}; prejudgment interest actual/365 up to, not including, the trial date; amounts rounded to the cent per period, totals are sums of the rounded rows.`,
    `Note: life table source: ${table.source}.`,
    `Note: ${LIFE_NOTE_WLE} The tax rate is the single effective rate you entered (not tax advice); interest and discount rates are yours, none is bundled as law.`,
  ];
  if (method === "lpe") {
    lines.push(`Note: participation and employment rows: ${pe.map((p) => `from ${ageText(p.fromAge)}: ${pctText(p.part * 100)} × ${pctText(p.emp * 100)}`).join("; ")}.`);
  }
  for (const n of table.notes) lines.push(`Note: ${n}`);
  return { text: lines.join("\n"), reading: lpeReading(res, survivalFrom === "injury"), tables, svg: lpeFigure(res) };
}

/** The plain-language reading of the lost-earnings result: the total at trial and how it splits into past, interest and future. */
export function lpeReading(res: { totalCents: number; pastCents: number; interestCents: number; futurePvCents: number }, death: boolean): string {
  const what = death ? "Estimated economic losses from the death" : "Estimated lost earnings and household services";
  if (res.pastCents === 0 && res.interestCents === 0) {
    return `${what} come to ${money(res.totalCents)} at the trial date, all of it future losses in present value, on the inputs given.`;
  }
  return `${what} come to ${money(res.totalCents)} at the trial date: ${money(res.pastCents)} already lost, ${money(res.interestCents)} of prejudgment interest and ${money(res.futurePvCents)} for future losses in present value, on the inputs given.`;
}

// ---------------------------------------------------------------------------------------------------------------
// #17 Actuarial: life annuity factors and commutation functions
// ---------------------------------------------------------------------------------------------------------------

/** Most rows of the commutation table. */
export const COMM_ROWS = 41;

export function annuityCalc(read: Read): FinResult {
  const table = chooseTable(read("table"), read("usertable"));
  if (isRefusal(table)) return refuse(table);
  const top = endAge(table) - 1;
  const x = readNum(read("age"), "Age x", { min: table.startAge, max: top, integer: true, range: `a whole age from ${table.startAge} to ${top} for this table` });
  if (isRefusal(x)) return refuse(x);
  const iPct = readNum(read("rate"), "Interest rate (% a year)", { min: -5, max: 25, minExclusive: true, range: "above −5% and at most 25% a year" });
  if (isRefusal(iPct)) return refuse(iPct);
  const n = readNum(read("term"), "Term n (years)", { min: 1, max: 150, integer: true, range: "1 to 150 whole years" });
  if (isRefusal(n)) return refuse(n);
  const m = readNum(read("defer"), "Deferral m (years)", { min: 0, max: 150, integer: true, range: "0 to 150 whole years" });
  if (isRefusal(m)) return refuse(m);
  const pay = readNum(read("payment"), "Annual payment (or benefit)", { min: 0, max: 1e12, range: "0 to one trillion" });
  if (isRefusal(pay)) return refuse(pay);
  const i = iPct / 100;
  const c = commutation(table, i);
  const k0 = x - table.startAge;
  const at = (arr: number[], k: number): number => (k < arr.length ? arr[k] : 0);
  const Dx = c.D[k0];
  const ad = c.N[k0] / Dx;
  const a = at(c.N, k0 + 1) / Dx;
  const A = c.M[k0] / Dx;
  const adn = (c.N[k0] - at(c.N, k0 + n)) / Dx;
  const an = (at(c.N, k0 + 1) - at(c.N, k0 + n + 1)) / Dx;
  const A1n = (c.M[k0] - at(c.M, k0 + n)) / Dx;
  const nE = at(c.D, k0 + n) / Dx;
  const endow = A1n + nE;
  const mad = at(c.N, k0 + m) / Dx;
  const madn = (at(c.N, k0 + m) - at(c.N, k0 + m + n)) / Dx;
  const d = i / (1 + i);
  const check = Math.abs(A - (1 - d * ad));
  const eC = completeExpectation(table, x);
  const eK = curtateExpectation(table, x);
  const cur = (v: number): string => (pay > 0 ? amt(pay * v) : "");
  const rows: string[][] = [
    ["Function", "Symbol", "Value", pay > 0 ? `Present value (payment a year, or benefit once, of ${amt(pay)})` : "Present value (no payment entered)"],
    ["Whole life annuity-due (payments at the start of each year)", "äₓ", f4(ad), cur(ad)],
    ["Whole life annuity-immediate (payments at the end of each year)", "aₓ", f4(a), cur(a)],
    ["Whole life insurance (benefit at the end of the year of death)", "Aₓ", f6(A), cur(A)],
    [`Temporary annuity-due, ${n} years`, "äₓ:ₙ", f4(adn), cur(adn)],
    [`Temporary annuity-immediate, ${n} years`, "aₓ:ₙ", f4(an), cur(an)],
    [`Term insurance, ${n} years`, "A¹ₓ:ₙ", f6(A1n), cur(A1n)],
    [`Pure endowment, ${n} years`, "ₙEₓ", f6(nE), cur(nE)],
    [`Endowment insurance, ${n} years`, "Aₓ:ₙ", f6(endow), cur(endow)],
    [`Deferred whole life annuity-due, deferred ${m} years`, "ₘ|äₓ", f4(mad), cur(mad)],
    [`Deferred temporary annuity-due, deferred ${m}, for ${n} years`, "ₘ|äₓ:ₙ", f4(madn), cur(madn)],
  ];
  const ct: string[][] = [["Age", "lₓ", "Dₓ", "Nₓ", "Cₓ", "Mₓ"]];
  const last = Math.min(c.ages.length - 1, k0 + COMM_ROWS - 1);
  for (let k = k0; k <= last; k++) ct.push([String(c.ages[k]), sigText(table.lx[k]), sigText(c.D[k]), sigText(c.N[k]), sigText(c.C[k]), sigText(c.M[k])]);
  const tables: FinTable[] = [
    { label: `Life annuity and insurance factors at age ${x}, ${pctText(iPct)} a year`, rows, align: ["left", "center", "right", "right"] },
    {
      label: `Commutation columns at ${pctText(iPct)} a year`,
      rows: ct,
      align: ["left", "right", "right", "right", "right", "right"],
      note: last < c.ages.length - 1 ? `Ages ${x}–${c.ages[last]} shown; the table runs to ${endAge(table)}.` : undefined,
    },
  ];
  const lines = [
    `Life annuity and insurance factors at age ${x}, interest ${pctText(iPct)} a year (${table.label})`,
    `äₓ = ${f4(ad)} (whole life annuity-due); aₓ = ${f4(a)} (annuity-immediate, äₓ − 1); Aₓ = ${f6(A)} (whole life insurance)`,
    `Temporary, n = ${n}: äₓ:ₙ = ${f4(adn)}; aₓ:ₙ = ${f4(an)}; A¹ₓ:ₙ = ${f6(A1n)}; ₙEₓ = ${f6(nE)}; Aₓ:ₙ = ${f6(endow)}`,
    `Deferred, m = ${m}: ₘ|äₓ = ${f4(mad)}; ₘ|äₓ:ₙ = ${f4(madn)}`,
    `Life expectancy at ${x}: complete ${fixedText(eC, 2)} years, curtate ${fixedText(eK, 2)} years`,
    ...(pay > 0 ? [`Present value of ${amt(pay)} a year for life, paid at the start of each year: ${amt(pay * ad)}; at the end of each year: ${amt(pay * a)}`] : []),
    `Check: Aₓ = 1 − d × äₓ with d = i/(1 + i) holds to ${check < 1e-12 ? "within 10⁻¹²" : sigText(check, 3)}.`,
    `Formulas: Dₓ = vˣ lₓ, Nₓ = Σ D, Cₓ = vˣ⁺¹ dₓ, Mₓ = Σ C (from x to the end of the table); äₓ = Nₓ/Dₓ, aₓ = Nₓ₊₁/Dₓ, Aₓ = Mₓ/Dₓ, äₓ:ₙ = (Nₓ − Nₓ₊ₙ)/Dₓ, A¹ₓ:ₙ = (Mₓ − Mₓ₊ₙ)/Dₓ, ₙEₓ = Dₓ₊ₙ/Dₓ, ₘ|äₓ = Nₓ₊ₘ/Dₓ.`,
    `Conventions: annual effective interest i, v = 1/(1 + i); payments annual (no 1/m-thly adjustment); death benefits at the end of the year of death; ${table.convention}.`,
    `Note: life table source: ${table.source}.`,
    ...table.notes.map((s) => `Note: ${s}`),
  ];
  // Figure: survival and discounted survival from age x.
  const pts: { x: number; y: number }[] = [];
  const dpts: { x: number; y: number }[] = [];
  const lx0 = table.lx[k0];
  for (let k = k0; k < table.lx.length; k++) {
    const p = table.lx[k] / lx0;
    pts.push({ x: c.ages[k], y: p });
    dpts.push({ x: c.ages[k], y: (c.D[k] / Dx) });
  }
  const svg =
    pts.length >= 2
      ? finPlotSvg(
          [
            { points: pts, type: "line", color: "#2563eb", label: "ₜpₓ (alive)" },
            { points: dpts, type: "line", color: "#b45309", label: "vᵗ ₜpₓ (discounted)" },
          ],
          { width: 380, height: 250, title: `Survival from age ${x} (${table.label.replace(/^CDC 2024 United States life table, /, "CDC 2024, ")})`, xlabel: "age", ylabel: "probability" },
        )
      : undefined;
  return { text: lines.join("\n"), reading: annuityReading(x, iPct, ad, pay, eC), tables, svg };
}

/** The plain-language reading of the annuity factors: what a life annuity from age x is worth today, and the life expectancy behind it. */
export function annuityReading(x: number, iPct: number, ad: number, pay: number, eC: number): string {
  const life = `life expectancy at ${x} is ${fixedText(eC, 2)} years`;
  if (pay > 0) {
    return `A life annuity of ${amt(pay)} a year from age ${x}, paid at the start of each year, is worth ${amt(pay * ad)} today at ${pctText(iPct)} interest; ${life} on this table.`;
  }
  return `A payment of 1 a year for life from age ${x}, starting now, is worth ${f4(ad)} today at ${pctText(iPct)} interest (äₓ); ${life} on this table.`;
}

// ---------------------------------------------------------------------------------------------------------------
// #17 Retirement accumulation and drawdown
// ---------------------------------------------------------------------------------------------------------------

export function retireCalc(read: Read): FinResult {
  const age = readNum(read("age"), "Current age", { min: 0, max: 119, integer: true, range: "a whole age from 0 to 119" });
  if (isRefusal(age)) return refuse(age);
  const retireAge = readNum(read("retire"), "Retirement age", { min: 0, max: 120, integer: true, range: "a whole age, at least the current age" });
  if (isRefusal(retireAge)) return refuse(retireAge);
  const endA = readNum(read("end"), "Plan to age", { min: 1, max: 120, integer: true, range: "a whole age above the current age, at most 120" });
  if (isRefusal(endA)) return refuse(endA);
  if (retireAge < age) return refuse({ error: `Retirement age (${retireAge}) is below the current age (${age}).` });
  if (!(endA > age)) return refuse({ error: `Plan to age (${endA}) must be above the current age (${age}).` });
  if (retireAge > endA) return refuse({ error: `Retirement age (${retireAge}) is after the plan-to age (${endA}).` });
  const balance = readNum(read("balance"), "Savings today", { min: 0, max: 1e12, range: "0 to one trillion" });
  if (isRefusal(balance)) return refuse(balance);
  const contribution = readNum(read("contrib"), "Contribution a year (today's money)", { min: 0, max: 1e12, range: "0 to one trillion" });
  if (isRefusal(contribution)) return refuse(contribution);
  const withdrawal = readNum(read("withdraw"), "Withdrawal a year in retirement (today's money)", { min: 0, max: 1e12, range: "0 to one trillion" });
  if (isRefusal(withdrawal)) return refuse(withdrawal);
  const ret = readNum(read("return"), "Nominal return (% a year)", { min: -100, max: 100, minExclusive: true, range: "above −100% and at most 100% a year" });
  if (isRefusal(ret)) return refuse(ret);
  const infl = readNum(read("inflation"), "Inflation (% a year)", { min: -50, max: 100, range: "−50% to 100% a year" });
  if (isRefusal(infl)) return refuse(infl);
  const r = retirementSchedule({ age, retireAge, endAge: endA, balance, contribution, withdrawal, ret: ret / 100, infl: infl / 100 });
  const big = r.rows.find((x) => !(Math.abs(x.end) <= 1e15) || !(Math.abs(x.flow) <= 1e15));
  if (big) return refuse({ error: `Age ${big.age}: the balance passes 10¹⁵, outside this calculator; lower the return or the horizon.` });
  const t: string[][] = [["Age", "Start balance", "Contribution (+) / withdrawal (−)", "Investment return", "End balance", "End balance, today's money"]];
  for (const x of r.rows) t.push([String(x.age) + (x.depleted ? " (depleted)" : ""), amt(x.start), amt(x.flow), amt(x.growth), amt(x.end), amt(x.real)]);
  const lastRow = r.rows[r.rows.length - 1];
  const lines = [
    "Retirement accumulation and drawdown, computed from the inputs given",
    `Balance at retirement (age ${retireAge}): ${amt(r.atRetire)} (${amt(r.atRetireReal)} in today's money)`,
    r.runsOutAge === null
      ? `The money lasts to age ${endA}: ${amt(lastRow.end)} left (${amt(lastRow.real)} in today's money).`
      : `The money runs out at age ${r.runsOutAge}: that year's withdrawal could not be paid in full.`,
    ...(r.sustainable !== null && endA > retireAge
      ? [`Sustainable withdrawal: ${amt(r.sustainable)} a year in today's money uses the balance at retirement exactly by age ${endA} at the real return.`]
      : []),
    `Real return = (1 + ${pctText(ret)})/(1 + ${pctText(infl)}) − 1 = ${pctText(r.realReturn * 100)}.`,
    `Inputs: age ${age}, retirement at ${retireAge}, plan to ${endA}; savings ${amt(balance)}; contributions ${amt(contribution)} a year and withdrawals ${amt(withdrawal)} a year in today's money; nominal return ${pctText(ret)}; inflation ${pctText(infl)}.`,
    "Conventions: contributions (before the retirement age) and withdrawals (from it) at the start of each year, indexed by inflation, (1 + π)ᵗ⁻¹ in year t; the balance after the flow earns the nominal return; today's money = nominal ÷ (1 + π)ᵗ at the end of year t; sustainable withdrawal = balance at retirement in today's money ÷ the annuity-due factor at the real return; amounts unrounded, rounded for display; currency-neutral.",
    "Note: a fixed return every year; for the risk of a bad sequence of returns use the safe-withdrawal Monte Carlo.",
  ];
  const svg = finPlotSvg(
    [
      { points: r.rows.map((x) => ({ x: x.age + 1, y: x.end })), type: "line", color: "#2563eb", label: "balance" },
      { points: r.rows.map((x) => ({ x: x.age + 1, y: x.real })), type: "line", color: "#b45309", label: "today's money" },
    ],
    { width: 380, height: 250, title: "Retirement balance by age (from the inputs given)", xlabel: "age (end of year)", ylabel: "balance", yGrouping: "comma" },
  );
  return {
    text: lines.join("\n"),
    reading: retireReading({ retireAge, endAge: endA, ret, withdrawal, atRetire: r.atRetire, atRetireReal: r.atRetireReal, runsOutAge: r.runsOutAge, left: lastRow.end, sustainable: r.sustainable }),
    tables: [{ label: "Retirement schedule", rows: t, align: ["left", "right", "right", "right", "right", "right"] }],
    svg: r.rows.length >= 2 ? svg : undefined,
  };
}

/** The plain-language reading of the retirement schedule: whether the money lasts, and the withdrawal that would just last. */
export function retireReading(o: {
  retireAge: number;
  endAge: number;
  ret: number;
  withdrawal: number;
  atRetire: number;
  atRetireReal: number;
  runsOutAge: number | null;
  left: number;
  sustainable: number | null;
}): string {
  const reach = `savings reach ${amt(o.atRetire)} at age ${o.retireAge} (${amt(o.atRetireReal)} in today's money)`;
  // The same sustainable-withdrawal condition as the text's line.
  // A sustainable withdrawal that prints as 0.00 (nothing saved) says nothing useful, so it is left out.
  const sus = o.sustainable !== null && o.endAge > o.retireAge && amt(o.sustainable) !== "0.00" ? amt(o.sustainable) : null;
  if (o.runsOutAge === null) {
    return `With a steady ${pctText(o.ret)} return, ${reach} and last to age ${o.endAge} with ${amt(o.left)} left.${sus ? ` About ${sus} a year in today's money would use them up exactly by then.` : ""}`;
  }
  return `With a steady ${pctText(o.ret)} return the money runs out at age ${o.runsOutAge}, before age ${o.endAge}: ${reach}.${sus ? ` About ${sus} a year in today's money, not ${amt(o.withdrawal)}, would last to age ${o.endAge}.` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// #17 Safe-withdrawal Monte Carlo
// ---------------------------------------------------------------------------------------------------------------

export const SWR_MAX_PATHS = 100000;
export const SWR_MIN_PATHS = 1000;
export const SWR_MAX_YEARS = 60;
/** paths × years (100,000 × 36, 90,000 × 40 or 60,000 × 60; about 190 ms under jest at the cap since the bucketed percentiles). */
export const SWR_WORK_BUDGET = 3_600_000;

export function swrCalc(read: Read): FinResult {
  const balance = readNum(read("balance"), "Starting portfolio", { min: 0, max: 1e12, minExclusive: true, range: "more than 0, at most one trillion" });
  if (isRefusal(balance)) return refuse(balance);
  const withdrawal = readNum(read("withdraw"), "Withdrawal a year (today's money)", { min: 0, max: 1e12, minExclusive: true, range: "more than 0, at most one trillion" });
  if (isRefusal(withdrawal)) return refuse(withdrawal);
  const years = readNum(read("years"), "Years", { min: 1, max: SWR_MAX_YEARS, integer: true, range: `1 to ${SWR_MAX_YEARS} whole years` });
  if (isRefusal(years)) return refuse(years);
  const mean = readNum(read("mean"), "Mean real return (% a year)", { min: -50, max: 50, range: "−50% to 50% a year" });
  if (isRefusal(mean)) return refuse(mean);
  const sd = readNum(read("sd"), "Standard deviation of the real return (% a year)", { min: 0, max: 100, range: "0% to 100% a year" });
  if (isRefusal(sd)) return refuse(sd);
  const paths = readNum(read("paths"), "Paths", { min: SWR_MIN_PATHS, max: SWR_MAX_PATHS, integer: true, range: `${SWR_MIN_PATHS.toLocaleString("en-US")} to ${SWR_MAX_PATHS.toLocaleString("en-US")}` });
  if (isRefusal(paths)) return refuse(paths);
  if (paths * years > SWR_WORK_BUDGET) {
    return refuse({ error: `Paths × years = ${(paths * years).toLocaleString("en-US")} is above the work budget of ${SWR_WORK_BUDGET.toLocaleString("en-US")}; lower the paths (at most ${Math.floor(SWR_WORK_BUDGET / years).toLocaleString("en-US")} for ${years} years).` });
  }
  const seedRaw = (read("seed") ?? "").trim();
  if (!/^\d+$/.test(seedRaw) || !(Number(seedRaw) <= PCG_MAX_SEED)) {
    return refuse({ error: `Seed: ${q(seedRaw || "(blank)")} must be a whole number from 0 to ${PCG_MAX_SEED.toLocaleString("en-US")}.` });
  }
  const seed = Number(seedRaw);
  let table: LifeTable | null = null;
  let alive: number[] | null = null;
  let age = NaN;
  if (read("table") !== "none") {
    const t = chooseTable(read("table"), read("usertable"));
    if (isRefusal(t)) return refuse(t);
    const a = readNum(read("age"), "Age at the start", { min: t.startAge, max: endAge(t) - 1, range: `${t.startAge} to ${endAge(t) - 1} for this table` });
    if (isRefusal(a)) return refuse(a);
    table = t;
    age = a;
    const l0 = lAt(t, a);
    alive = [];
    for (let k = 0; k < years; k++) alive.push(lAt(t, a + k) / l0);
  }
  const r = swrMonteCarlo({ balance, withdrawal, years, mean: mean / 100, sd: sd / 100, paths, seed, alive });
  const pc = (x: number): string => pctText(Math.round(x * 1e6) / 1e4);
  const head = ["Year", "Ruined by year end", "10th percentile balance", "Median balance", "90th percentile balance"];
  if (alive) head.push("P(alive) at start");
  const t: string[][] = [head];
  for (let k = 0; k < years; k++) {
    const row = [String(k + 1), pc(r.ruinBy[k]), amt(r.p10[k]), amt(r.p50[k]), amt(r.p90[k])];
    if (alive) row.push(f6(alive[k]));
    t.push(row);
  }
  const rate = (withdrawal / balance) * 100;
  const lines = [
    "Safe-withdrawal Monte Carlo (probability of ruin), computed from the inputs given",
    `Probability of ruin within ${years} years: ${pc(r.ruinBy[years - 1])} (${paths.toLocaleString("en-US")} paths, seed ${seed})`,
    ...(alive && table
      ? [
          `Probability the money runs out while alive (age ${ageText(age)} at the start, ${table.label}): ${pc(r.ruinWhileAlive!)}; P(alive after ${years} years) = ${f6(lAt(table, age + years) / lAt(table, age))} (ruin after year ${years} is not counted).`,
        ]
      : []),
    `Withdrawal ${amt(withdrawal)} a year in today's money from ${amt(balance)} (an initial withdrawal rate of ${pctText(Math.round(rate * 1e4) / 1e4)}).`,
    `Real return each year: lognormal, mean ${pctText(mean)}, standard deviation ${pctText(sd)} (ln(1 + R) ~ N(${fixedText(r.m, 6)}, ${fixedText(r.s, 6)}²)).`,
    `Conventions: real terms (the withdrawal keeps its buying power); the withdrawal is taken at the start of each year and a balance below it is ruin in that year; balance ← (balance − withdrawal) × (1 + R); PCG32 (O'Neill 2014, stream ${PCG_STREAM}) seeded with ${seed}, uniforms (r + 0.5)/2³², Box–Muller z = √(−2 ln u₁) cos(2π u₂), draws year by year then path by path, every path drawing every year; percentiles Hyndman–Fan type 7 with ruined paths at 0; work budget paths × years ≤ ${SWR_WORK_BUDGET.toLocaleString("en-US")}; currency-neutral.`,
    ...(alive ? ["Note: P(ruin while alive) = Σ P(ruin in year t) × P(alive at the start of year t), death and returns independent."] : []),
    ...(table ? [`Note: life table source: ${table.source}.`, ...table.notes.map((s) => `Note: ${s}`)] : []),
    "Note: returns are independent from year to year; no fees, taxes or changes to the withdrawal are modelled.",
  ];
  const series = [{ points: r.ruinBy.map((p, k) => ({ x: k + 1, y: p * 100 })), type: "line" as const, color: "#b91c1c", label: "ruined by year end (%)" }];
  if (alive) series.push({ points: alive.map((p, k) => ({ x: k + 1, y: p * 100 })), type: "line" as const, color: "#2563eb", label: "alive at start (%)" });
  const svg = years >= 2 ? finPlotSvg(series, { width: 380, height: 250, title: "Probability of ruin by year", xlabel: "year", ylabel: "percent" }) : undefined;
  return {
    text: lines.join("\n"),
    reading: swrReading(pc(r.ruinBy[years - 1]), alive ? pc(r.ruinWhileAlive!) : null, amt(withdrawal), amt(balance), years, paths.toLocaleString("en-US")),
    tables: [{ label: "Probability of ruin by year", rows: t, align: alive ? ["left", "right", "right", "right", "right", "right"] : ["left", "right", "right", "right", "right"] }],
    svg,
  };
}

/** The plain-language reading of the safe-withdrawal Monte Carlo (values already formatted as the text prints them). */
export function swrReading(ruin: string, ruinAlive: string | null, withdrawal: string, balance: string, years: number, paths: string): string {
  const head = `Withdrawing ${withdrawal} a year from ${balance} runs out of money within ${years} year${years === 1 ? "" : "s"} in about ${ruin} of ${paths} simulated return paths`;
  return ruinAlive === null
    ? `${head}, an estimate that rests on the return assumptions entered.`
    : `${head}; allowing for the chance of dying first, the estimated risk of outliving the money is ${ruinAlive}.`;
}
