// Present value of lost earnings (E1a). Money pinned from the independent Python oracle
// (C:\Users\AlexanderSmith\jurislab-relE\oracle_e1a_interest.py, Decimal arithmetic, half-up cents).
import { lostEarnings, lostEarningsReport } from "../lostEarnings";
import { insertableResultText } from "../insertGate";

const MINUS = String.fromCharCode(0x2212);

const rep = (o: Partial<Parameters<typeof lostEarningsReport>[0]> = {}) =>
  lostEarningsReport({
    base: 65000,
    growthPct: 3,
    discountPct: 4.5,
    horizonMode: "years",
    horizon: 20,
    startAge: 45,
    consumptionPct: 0,
    fringePct: 22,
    midYear: "off",
    ...o,
  });

function run(base: number, g: number, d: number, years: number, c: number, f: number, mid: boolean) {
  const r = lostEarnings({ base, growth: g / 100, discount: d / 100, years, startAge: 40, consumption: c / 100, fringe: f / 100, midYear: mid });
  if ("error" in r) throw new Error(r.error);
  return r;
}

describe("lost earnings against the oracle, to the cent", () => {
  test("case L1: 20 years, end-of-year discounting", () => {
    const r = run(65000, 3, 4.5, 20, 0, 22, false);
    expect(r.totalPvCents / 100).toBe(1327528.91);
    expect(r.totalNetCents / 100).toBe(2130820.71);
    expect(r.rows.slice(0, 3).map((x) => x.pvCents / 100)).toEqual([75885.17, 74795.91, 73722.28]);
    expect(r.rows[19].pvCents / 100).toBe(57657.35);
    expect(r.rows[19].netCents / 100).toBe(139053.03);
  });
  test("case L2: the same, mid-year discounting", () => {
    const r = run(65000, 3, 4.5, 20, 0, 22, true);
    expect(r.totalPvCents / 100).toBe(1357069.64);
    expect(r.rows[0].pvCents / 100).toBe(77573.8);
    expect(r.rows[0].discountFactor).toBeCloseTo(0.978231976, 9);
  });
  test("case L3: a partial final year, personal consumption", () => {
    const r = run(82500.5, 2.5, 5, 10.5, 30, 15, false);
    expect(r.rows.length).toBe(11);
    expect(r.rows[10].earningsCents / 100).toBe(52803.81);
    expect(r.rows[10].pvCents / 100).toBe(25466.75);
    expect(r.totalPvCents / 100).toBe(594330.79);
    expect(r.totalNetCents / 100).toBe(786556.17);
  });
  test("case L4: zero growth and zero discount is plain multiplication", () => {
    expect(run(40000, 0, 0, 3, 0, 0, false).totalPvCents / 100).toBe(120000);
  });
  test("case L5: a partial final year with mid-year discounting", () => {
    const r = run(120000, 4, 3, 7.25, 25, 18.5, true);
    expect(r.rows[7].pvCents / 100).toBe(28422.94);
    expect(r.totalPvCents / 100).toBe(785795.76);
    expect(r.totalNetCents / 100).toBe(877439.14);
  });
});

describe("lost earnings report", () => {
  test("default: grouped money, a table that adds, insertable, a figure", () => {
    const r = rep();
    expect(r.ok).toBe(true);
    expect(r.text).toContain("computed from the inputs given");
    expect(r.text).toContain("Present value 1,327,528.91 (net loss before discounting 2,130,820.71)");
    expect(insertableResultText(r.text)).toBe(true);
    expect(r.text).not.toMatch(/NaN|Infinity|undefined|e\+|\^/);
    const rows = r.table!.rows;
    expect(rows[0]).toEqual(["Year", "Age", "Earnings", "Net loss", "Discount factor", "Present value"]);
    expect(rows[1]).toEqual(["1", "45", "65,000.00", "79,300.00", "0.956938", "75,885.17"]);
    expect(rows[rows.length - 1][5]).toBe("1,327,528.91");
    expect(r.svg).toContain("<svg");
  });
  test("end age mode", () => {
    const r = rep({ horizonMode: "age", horizon: 55.5, startAge: 45 });
    expect(r.ok).toBe(true);
    expect(r.table!.rows.length).toBe(1 + 11 + 1);
    expect(r.table!.rows[11][0]).toBe("11 (0.50 yr)");
  });
  test("refusals by name", () => {
    expect(rep({ horizonMode: "age", horizon: 40, startAge: 45 }).text).toBe("The end age (40) must be above the starting age (45).");
    expect(rep({ base: -1 }).text).toBe("Annual earnings must be zero or positive.");
    expect(rep({ horizon: 0 }).ok).toBe(false);
    expect(rep({ horizon: 101 }).text).toContain("More than 100 years");
    expect(rep({ consumptionPct: 120 }).ok).toBe(false);
    expect(rep({ discountPct: -100 }).ok).toBe(false);
    expect(rep({ base: NaN }).ok).toBe(false);
    expect(rep({ base: 2e15 }).text).toContain("outside this calculator");
  });
  test("negative growth prints a true minus; 1e12 (the cap) stays grouped; zero base is zeros", () => {
    const r = rep({ growthPct: -2.5 });
    expect(r.ok).toBe(true);
    expect(r.text).toContain(`growth ${MINUS}2.5%`);
    const big = rep({ base: 4e11, horizon: 2, growthPct: 0, fringePct: 0, consumptionPct: 0 });
    expect(big.ok).toBe(true);
    expect(big.text).not.toMatch(/e\+/);
    expect(big.table!.rows[1][2]).toBe("400,000,000,000.00");
    expect(rep({ base: 0 }).text).toContain("Present value 0.00");
  });
});
