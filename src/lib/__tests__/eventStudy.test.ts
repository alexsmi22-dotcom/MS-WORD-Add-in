/**
 * es-event (Release E3c): the market-model event study pinned against an independent numpy oracle
 * (scripts/econ-event-study-oracle.py, matrix formulas of Campbell, Lo & MacKinlay 1997 §4.4 with V formed
 * explicitly), the diagonal of V against MacKinlay (1997) eq. (8), and the hostile inputs of the E3 brief.
 */
import fixture from "./fixtures/econ-event-study-oracle.json";
import { runEventStudy, carVariance, readIntField, type EventStudyOptions, type ReturnInput } from "../eventStudy";
import { esEventCalc, ES_EVENT_DEFAULTS } from "../econE3Calcs";
import { insertableResultText } from "../insertGate";
import { tableCellsInsertable, civilDay, civilFromDay } from "../damagesInterest";
import type { StatOutput } from "../analyzeBlocks";

type Case = (typeof fixture.cases)[number];

const readInt = (s: string): number => Number(s.replace("−", "-"));
function opts(c: Case): EventStudyOptions {
  return {
    input: c.fields.input as ReturnInput,
    market: c.fields.market,
    estFrom: readInt(c.fields.est_from),
    estTo: readInt(c.fields.est_to),
    evFrom: readInt(c.fields.ev_from),
    evTo: readInt(c.fields.ev_to),
  };
}

function close(actual: number, expected: number, rel: number, abs = 1e-15): void {
  const tol = Math.max(abs, rel * Math.abs(expected));
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`expected ${expected}, got ${actual} (|Δ| = ${Math.abs(actual - expected)}, tol ${tol})`);
}

/** Display contract on an ok result. */
function clean(out: StatOutput): string[] {
  const bad: string[] = [];
  const all = [out.text, ...(out.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])];
  for (const s of all) {
    if (/NaN|Infinity|undefined/.test(s)) bad.push(`broken: ${s}`);
    if (/\d[eE][-+]?\d/.test(s)) bad.push(`e-notation: ${s}`);
    if (s.includes("—")) bad.push(`em dash: ${s}`);
    if (/[_^{}]/.test(s)) bad.push(`ASCII sub/superscript notation: ${s}`);
    if (/(^|[\s(])-\d/.test(s)) bad.push(`hyphen minus: ${s}`);
  }
  if (!insertableResultText(out.text)) bad.push("gate: text");
  for (const t of out.tables ?? []) if (!tableCellsInsertable(t.rows)) bad.push(`gate: ${t.label}`);
  return bad;
}

const calc = (over: Record<string, string>): StatOutput => esEventCalc((k) => over[k] ?? ES_EVENT_DEFAULTS[k] ?? "");

describe("es-event against the numpy oracle", () => {
  for (const c of fixture.cases) {
    test(c.name, () => {
      const r = runEventStudy(c.data, c.events, opts(c));
      if (!r.ok) throw new Error(r.reason);
      const res = r.result;
      const ex = c.expect;
      expect(res.L1).toBe(ex.L1);
      expect(res.events).toHaveLength(ex.events.length);
      res.events.forEach((e, i) => {
        const x = ex.events[i];
        expect(e.firm).toBe(x.firm);
        const { y, m, d } = civilFromDay(e.day);
        expect(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`).toBe(x.day_used);
        close(e.fit.alpha, x.alpha, 1e-9, 1e-14);
        close(e.fit.beta, x.beta, 1e-9);
        close(e.fit.sigma2, x.sigma2, 1e-9);
        e.ar.forEach((v, k) => close(v, x.ar[k], 1e-9, 1e-13));
        // The diagonal of V = σ²(I + X*(X'X)⁻¹X*'), and MacKinlay eq. (8) with its σ²ε factor restored.
        e.rmEvent.forEach((rm, k) => {
          close(carVariance(e.fit, e.rmEvent, k, k), x.Vdiag[k], 1e-10);
          const eq8 = e.fit.sigma2 * (1 + 1 / e.fit.L1 + (rm - e.fit.meanM) ** 2 / e.fit.sxx);
          close(eq8, x.Vdiag[k], 1e-10);
        });
        close(e.car, x.main.car, 1e-9, 1e-13);
        close(e.carVar, x.main.var, 1e-9);
        close(e.scar, x.main.scar, 1e-8, 1e-10);
        close(e.p, x.main.p, 1e-7, 1e-12);
        if ("car11" in x && x.car11) {
          expect(e.car11).toBeDefined();
          close(e.car11!.car, x.car11.car, 1e-9, 1e-13);
          close(e.car11!.carVar, x.car11.var, 1e-9);
          close(e.car11!.scar, x.car11.scar, 1e-8, 1e-10);
          close(e.car11!.p, x.car11.p, 1e-7, 1e-12);
        } else expect(e.car11).toBeUndefined();
      });
      res.aar.forEach((v, k) => close(v, ex.aar[k], 1e-9, 1e-13));
      res.caar.forEach((v, k) => close(v, ex.caar[k], 1e-9, 1e-13));
      res.caarSe.forEach((v, k) => close(v, ex.caar_se[k], 1e-9));
      const check = (win: string, tests: Record<string, number[] | undefined>): void => {
        const names: Record<string, string> = { J1: "J₁", J2: "J₂", BMP: "BMP", CS: "Cross-sectional" };
        for (const [k, sp] of Object.entries(tests)) {
          if (!sp) continue;
          const [stat, p] = sp;
          const t = res.tests.find((x) => x.window === win && x.name.startsWith(names[k]));
          expect(t?.stat).toBeDefined();
          close(t!.stat!, stat, 1e-8, 1e-10);
          close(t!.p!, p, 1e-7, 1e-12);
        }
      };
      const evFrom = opts(c).evFrom;
      const evTo = opts(c).evTo;
      const w = (a: number, b: number): string => `(${a > 0 ? "+" + a : a < 0 ? "−" + -a : "0"}, ${b > 0 ? "+" + b : b < 0 ? "−" + -b : "0"})`;
      check(w(evFrom, evTo), ex.tests_main);
      if ("tests_11" in ex && ex.tests_11) check(w(-1, 1), ex.tests_11);
    });
  }

  test("the calculator prints the oracle's numbers and the conventions", () => {
    const c = fixture.cases[0];
    const out = calc({ data: c.data, events: c.events, ...c.fields });
    expect(out.ok).not.toBe(false);
    expect(clean(out)).toEqual([]);
    expect(out.text).toContain("MacKinlay 1997");
    expect(out.text).toContain("4.4.9");
    expect(out.text).toContain("Student t with L₁ − 2 = 118 df");
    expect(out.text).toMatch(/Boehmer, Musumeci & Poulsen 1991/);
    // The Saturday event moves to Monday, said per event.
    expect(out.text).toContain("Beta, October 7, 2023 is not a trading day in the table; it moves to the next trading day, October 9, 2023.");
    const ev = out.tables![0];
    expect(ev.rows[1][5]).toBe((c.expect.events[0].main.car * 100).toFixed(3).replace("-", "−"));
    expect(out.tables![2].rows.length).toBe(1 + 8);
    expect(out.svg).toContain("<svg");
  });

  test("one event: BMP and the cross-sectional test say why they are absent", () => {
    const c = fixture.cases[3];
    const out = calc({ data: c.data, events: c.events, ...c.fields });
    expect(clean(out)).toEqual([]);
    const rows = out.tables![2].rows;
    expect(rows.find((r) => r[0].startsWith("BMP"))![2]).toBe("needs 2 or more events");
    expect(rows.find((r) => r[0].startsWith("Cross"))![2]).toBe("needs 2 or more events");
    // A one-day event window has no CAR(−1, +1) columns, and the text says why.
    expect(out.tables![0].rows[0]).toHaveLength(8);
    expect(out.text).toContain("CAR(−1, +1) is not reported: the event window (0, 0) does not contain days −1 to +1.");
  });

  test("price inputs print clean, with the return definition", () => {
    for (const c of [fixture.cases[1], fixture.cases[2]]) {
      const out = calc({ data: c.data, events: c.events, ...c.fields });
      expect(out.ok).not.toBe(false);
      expect(clean(out)).toEqual([]);
      expect(out.text).toContain(c.fields.input === "log" ? "log returns ln(Pₜ/Pₜ₋₁)" : "simple returns Pₜ/Pₜ₋₁ − 1");
    }
  });
});

describe("es-event worked default and units", () => {
  test("the default runs clean", () => {
    const out = calc({});
    expect(out.ok).not.toBe(false);
    expect(clean(out)).toEqual([]);
    expect(out.text).toContain("Borealis, August 17, 2024 is not a trading day");
  });

  test("percent returns give the same tests and the same displayed CARs", () => {
    const c = fixture.cases[0];
    const lines = c.data.split("\n");
    const pctData = [lines[0], ...lines.slice(1).map((l) => l.split("\t").map((v, j) => (j === 0 ? v : (Number(v) * 100).toFixed(4))).join("\t"))].join("\n");
    const a = calc({ data: c.data, events: c.events, ...c.fields });
    const b = calc({ data: pctData, events: c.events, ...c.fields, units: "percent" });
    expect(clean(b)).toEqual([]);
    expect(b.tables![2].rows).toEqual(a.tables![2].rows);
    expect(b.tables![0].rows.map((r) => r[5])).toEqual(a.tables![0].rows.map((r) => r[5]));
  });

  test("tiny and huge scales: the test statistics do not move", () => {
    const c = fixture.cases[0];
    const base = runEventStudy(c.data, c.events, opts(c));
    if (!base.ok) throw new Error(base.reason);
    for (const s of [1e-12, 1e12]) {
      const lines = c.data.split("\n");
      const data = [lines[0], ...lines.slice(1).map((l) => l.split("\t").map((v, j) => (j === 0 ? v : String(Number(v) * s))).join("\t"))].join("\n");
      const r = runEventStudy(data, c.events, opts(c));
      if (!r.ok) throw new Error(r.reason);
      r.result.tests.forEach((t, k) => close(t.stat!, base.result.tests[k].stat!, 1e-9));
      close(r.result.caar[10], base.result.caar[10] * s, 1e-9);
      const out = calc({ data, events: c.events, ...c.fields });
      expect(clean(out)).toEqual([]);
    }
  });
});

describe("es-event refusals", () => {
  const c = fixture.cases[0];
  const run = (over: Record<string, string>): StatOutput => calc({ data: c.data, events: c.events, ...c.fields, ...over });
  const refused = (over: Record<string, string>, re: RegExp): void => {
    const out = run(over);
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(re);
  };

  test("window fields: rubbish, U+2212, out of range, overlap, too short, too long", () => {
    refused({ est_from: "abc" }, /Estimation window start: “abc” is not a whole number/);
    refused({ est_to: "1e400" }, /not a whole number/);
    refused({ ev_from: "−50000" }, /outside −1000 to 1000/);
    refused({ est_to: "−1" }, /must end before the event window starts/);
    refused({ est_from: "−20" }, /10 trading days; at least 30/);
    refused({ ev_from: "−100", ev_to: "100", est_from: "−400", est_to: "−101" }, /event window has 201 days; the most is 121/);
    refused({ est_from: "−5", est_to: "−50" }, /starts after it ends/);
    // A blank field takes the default.
    expect(run({ est_from: "" }).ok).not.toBe(false);
    expect(readIntField("−130", "x", -1000, 1000)).toBe(-130);
  });

  test("unknown selects, firms, events", () => {
    refused({ input: "bogus" }, /Unknown input type/);
    refused({ units: "basis points" }, /Unknown return units/);
    refused({ events: "Delta: 2023-09-14" }, /no firm column is named “Delta”/);
    refused({ events: "2023-09-14" }, /names no firm, and the table has 3 firm columns/);
    refused({ events: "Alpha: 2023-02-30" }, /not a calendar date/);
    refused({ events: "Alpha: soon" }, /“soon” is not a date/);
    refused({ events: "" }, /at least one event/);
    refused({ events: "Alpha: 2023-09-14\nalpha: 2023-09-14" }, /already has an event/);
    refused({ events: "Alpha: 2023-02-01" }, /needs 130 trading days of returns before the event; the table has \d+/);
    refused({ events: "Alpha: 2024-03-20" }, /needs 5 trading days of returns after the event/);
    refused({ events: "Alpha: 2030-01-01" }, /end on .* before the event/);
    refused({ market: "SPX" }, /No column is named “SPX”/);
  });

  test("data: too few rows, missing cell, periods instead of days, constant and degenerate series", () => {
    refused({ data: "Date\tMarket\tAlpha\n2024-01-02\t0.1\t0.2" }, /at least 3/);
    const lines = c.data.split("\n");
    const holed = [...lines];
    holed[50] = holed[50].replace(/\t[^\t]+$/, "\t");
    refused({ data: holed.join("\n") }, /Row 50 \(.*\) has no value in “Gamma”/);
    const monthly = ["Date\tMarket\tAlpha", ...Array.from({ length: 40 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}\t0.0${i % 7}\t0.0${(i * 3) % 7}`)].join("\n");
    refused({ data: monthly, events: "Alpha: 2021-06-01" }, /holds months; an event study here takes one row per trading day/);
    const mixed = ["Date\tMarket\tAlpha", "2020\t0.01\t0.02", "2021-03-04\t0.02\t0.01", "2021-03-05\t0.03\t0.02", "2021-03-08\t0.01\t0.0"].join("\n");
    refused({ data: mixed, events: "Alpha: 2021-03-05" }, /a mix of periods/);
    const hdr = lines[0];
    const constM = [hdr, ...lines.slice(1).map((l) => l.split("\t").map((v, j) => (j === 1 ? "0.001" : v)).join("\t"))].join("\n");
    refused({ data: constM }, /“Market” has the same return on every estimation day/);
    const constF = [hdr, ...lines.slice(1).map((l) => l.split("\t").map((v, j) => (j === 2 ? "0" : v)).join("\t"))].join("\n");
    refused({ data: constF }, /“Alpha” has the same return on every estimation day/);
    const exact = [hdr, ...lines.slice(1).map((l) => { const p = l.split("\t"); p[2] = String(2 * Number(p[1])); return p.join("\t"); })].join("\n");
    refused({ data: exact, events: "Alpha: 2023-09-14" }, /moves exactly with the market/);
  });

  test("prices: a zero or negative price is refused by date before any log or ratio", () => {
    const p = fixture.cases[1];
    const lines = p.data.split("\n");
    const bad = [...lines];
    bad[40] = bad[40].replace(/\t[^\t]+\t/, "\t0\t");
    const out = calc({ data: bad.join("\n"), events: p.events, ...p.fields });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/“Firm A” on .*: a price must be greater than zero/);
    bad[40] = lines[40].replace(/\t[^\t]+\t/, "\t−3.5\t");
    expect(calc({ data: bad.join("\n"), events: p.events, ...p.fields }).text).toMatch(/a price must be greater than zero/);
  });
});

describe("es-event at scale", () => {
  function bigTable(rows: number, weekdaysOnly = true): { text: string; dates: string[] } {
    let seed = 7;
    const u = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const lines = ["Date\tMarket\tF1\tF2"];
    const dates: string[] = [];
    let day = civilDay(1901, 1, 2);
    for (let i = 0; i < rows; i++) {
      while (weekdaysOnly && ((day + 4) % 7 === 0 || (day + 4) % 7 === 6)) day++;
      const { y, m, d } = civilFromDay(day);
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      dates.push(iso);
      const mk = 0.02 * u();
      lines.push(`${iso}\t${mk.toFixed(6)}\t${(mk + 0.02 * u()).toFixed(6)}\t${(0.5 * mk + 0.02 * u()).toFixed(6)}`);
      day++;
    }
    return { text: lines.join("\n"), dates };
  }

  test("100,000 daily rows (consecutive days 1901–2174) with 200 events stays bounded", () => {
    const { text, dates } = bigTable(100000, false);
    const events = Array.from({ length: 200 }, (_, k) => `${k % 2 ? "F2" : "F1"}: ${dates[200 + k * 495]}`).join("\n");
    const t0 = Date.now();
    const out = calc({ data: text, events, est_from: "−130", est_to: "−11", ev_from: "−5", ev_to: "5" });
    const ms = Date.now() - t0;
    expect(out.ok).not.toBe(false);
    expect(clean(out)).toEqual([]);
    // Measured 0.6–1.0 s alone (one worker, cold run the slower; most of it reading the table); bounded at 4×.
    expect(ms).toBeLessThan(4000);
  });

  test("100,000 rows: refused by date range quickly (100,000 weekdays from 1901 pass 2200)", () => {
    const { text, dates } = bigTable(100000);
    const t0 = Date.now();
    const out = calc({ data: text, events: `F1: ${dates[500]}` });
    const ms = Date.now() - t0;
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/dates must fall between 1900 and 2200/);
    // Measured 0.54 s alone; bounded at 3.7×.
    expect(ms).toBeLessThan(2000);
  });
});
