/**
 * DERIV_CALCS (F1, gap item #7) through the pane's read path: number fields through readFinanceField first, then
 * compute (run() copied from finSpreadContract.test.ts). Every default must be insertable with ≤ 6-column tables and a
 * "Conventions:" line; hostile field text must refuse by name (never insertable); each compute must finish within
 * 300 ms at its caps. Numbers are checked against the engines (themselves oracle-checked in derivOracle.test.ts).
 */
import * as fs from "fs";
import * as path from "path";
import { DERIV_CALCS } from "../derivCalcs";
import { FIN_GROUP_ORDER, type FinCalcDef, type FinResult } from "../finCalc";
import { readFinanceField } from "../finance";
import { insertableResultText } from "../insertGate";

/** The pane's read: number fields through the product's cell reader, everything else as typed. */
function run(c: FinCalcDef, over: Record<string, string> = {}): FinResult {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return c.compute((k) => numeric.get(k) ?? raw(k));
}
const obj = (o: FinResult) => (typeof o === "string" ? { text: o, ok: undefined, svg: undefined, tables: undefined } : o);
const calc = (id: string): FinCalcDef => {
  const c = DERIV_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const ok = (id: string, over: Record<string, string> = {}) => {
  const o = obj(run(calc(id), over));
  if (o.ok === false) throw new Error(`${id} refused: ${o.text}`);
  expect(insertableResultText(o.text)).toBe(true);
  return o;
};
const refusal = (id: string, over: Record<string, string>): string => {
  const o = obj(run(calc(id), over));
  expect(o.ok).toBe(false);
  return o.text;
};

test("ids, groups and names", () => {
  expect(DERIV_CALCS.map((c) => c.id)).toEqual(["deriv-black76", "deriv-crr", "deriv-parity", "deriv-carry", "deriv-strategy", "deriv-swap"]);
  const ids = new Set<string>();
  for (const c of DERIV_CALCS) {
    expect(c.group).toBe("Derivatives");
    expect(FIN_GROUP_ORDER as readonly string[]).toContain(c.group);
    expect(c.name.toLowerCase().startsWith(c.group.toLowerCase())).toBe(false);
    expect(c.id).toMatch(/^[a-z0-9-]+$/);
    expect(ids.has(c.id)).toBe(false);
    ids.add(c.id);
    expect(c.assumes ?? "").not.toContain("—");
    for (const f of c.fields) expect(typeof f.default).toBe("string");
  }
});

test("no id collides with the pane's inline Finance ids", () => {
  const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
  const i = pane.indexOf("const FIN_CALCS: FinCalc[] = [");
  const body = pane.slice(i, pane.indexOf("\n];", i));
  const inline = [...body.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]);
  expect(inline.length).toBeGreaterThan(30);
  for (const c of DERIV_CALCS) expect(inline).not.toContain(c.id);
});

test("the modules draw no Math.random", () => {
  for (const f of ["derivCalcs", "derivatives"]) {
    expect(fs.readFileSync(path.join(__dirname, "..", f + ".ts"), "utf8")).not.toMatch(/Math\.random\s*\(/);
  }
});

describe.each(DERIV_CALCS.map((c) => [c.id, c] as const))("%s defaults", (_id, c) => {
  test("insertable, Conventions line, true minus, no e-notation, ≤ 6-column tables with insertable cells", () => {
    const o = obj(run(c));
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).toMatch(/\nConventions: /);
    expect(o.text).not.toMatch(/(^|[^\w])-\d/);
    expect(o.text).not.toMatch(/\de[-+]?\d/);
    expect(o.text).not.toMatch(/\^/);
    expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
    if (c.id !== "deriv-parity") expect(o.svg ?? "").toContain("<svg");
    for (const t of o.tables ?? []) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) {
        expect(row.length).toBe(t.rows[0].length);
        for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
      }
    }
  });
});

describe("numbers as printed", () => {
  test("Black-76 default and implied volatility round trip", () => {
    const o = ok("deriv-black76");
    expect(o.text).toMatch(/Call price = 55\.8874/);
    expect(o.text).toMatch(/Put–call parity: C − P = 19\.6825 = exp\(−rt\)·\(F − K\) = 19\.6825/);
    const iv = ok("deriv-black76", { solve: "iv", price: "55.8874", sig: "" });
    expect(iv.text).toMatch(/σ = 30\.000\d% \(implied from the price 55\.8874\)/);
    expect(refusal("deriv-black76", { solve: "iv", price: "1000" })).toMatch(/outside the no-arbitrage range/);
    expect(refusal("deriv-black76", { solve: "iv", price: "" })).toMatch(/Enter the option price/);
  });
  test("CRR default is Hull's American put: 4.4885, early exercise named, tree drawn", () => {
    const o = ok("deriv-crr");
    expect(o.text).toMatch(/CRR American put price = 4\.4885/);
    expect(o.text).toMatch(/Early exercise is optimal at 3 nodes, the earliest at step 3/);
    expect(o.text).toMatch(/u = exp\(σ√Δt\) = 1\.12240090, d = 1\/u = 0\.89094725, p = \(exp\(\(r − q\)Δt\) − d\)\/\(u − d\) = 0\.50731928/);
    expect(o.svg).toContain("50.00 / 4.49");
  });
  test("CRR above the figure cap draws the convergence figure; European tree vs analytic", () => {
    const o = ok("deriv-crr", { style: "european", n: "200" });
    expect(o.svg).toContain("Binomial price against the number of steps");
    expect(o.text).toMatch(/tree − analytic = −?0\.00\d\d/);
  });
  test("CRR American call with q > r exercises early; with q = 0 it never does", () => {
    expect(ok("deriv-crr", { type: "call", q: "8", r: "3", s: "100", k: "95", n: "50" }).text).toMatch(/Early exercise is optimal at/);
    expect(ok("deriv-crr", { type: "call", q: "0" }).text).toMatch(/never exercised early/);
  });
  test("CRR deep in-the-money American put exercises today", () => {
    expect(ok("deriv-crr", { s: "10", k: "100", n: "4" }).text).toMatch(/exercising NOW \(step 0\) beats holding: the option is worth its intrinsic value 90\.0000/);
  });
  test("parity: violation sign gives the trade; a band absorbs it; exact parity holds", () => {
    expect(ok("deriv-parity").text).toMatch(/Violation .* = 0\.6729 per share\nThe call is rich relative to the put\. Conversion/);
    expect(ok("deriv-parity", { p: "6.5" }).text).toMatch(/The put is rich relative to the call\. Reverse conversion/);
    expect(ok("deriv-parity", { cost: "1" }).text).toMatch(/within the trading cost band 1: no arbitrage after costs/);
    const exact = ok("deriv-parity", { c: "10", p: "10", s: "100", k: "100", r: "0", q: "0" });
    expect(exact.text).toMatch(/Parity holds exactly/);
  });
  test("carry: cash-and-carry above fair, reverse below, existing forward value", () => {
    expect(ok("deriv-carry").text).toMatch(/F₀ = .* = 1,869\.9865/);
    expect(ok("deriv-carry").text).toMatch(/Cash-and-carry/);
    expect(ok("deriv-carry", { mkt: "1850" }).text).toMatch(/Reverse cash-and-carry/);
    expect(ok("deriv-carry", { deliv: "1800" }).text).toMatch(/existing long forward with delivery price 1,800: \(F₀ − K\)·exp\(−rt\) = 67\.918\d/);
    expect(ok("deriv-carry", { mkt: "" }).text).not.toMatch(/Market futures price/);
  });
  test("strategy: iron condor numbers; straddle unlimited profit; short stock unlimited loss", () => {
    const o = ok("deriv-strategy");
    expect(o.text).toMatch(/Net premium received \(credit\) = 2\.80/);
    expect(o.text).toMatch(/Maximum profit = 2\.80, reached for underlying prices from 95 to 105\./);
    expect(o.text).toMatch(/Maximum loss = 2\.20, reached for underlying prices from 0 to 90 and for underlying prices from 110 up\./);
    expect(o.text).toMatch(/Breakevens: 92\.2; 107\.8\./);
    const st = ok("deriv-strategy", { legs: "Type, Strike, Qty, Premium\ncall, 100, 1, 6\nput, 100, 1, 5.5", mult: "100" });
    expect(st.text).toMatch(/Maximum profit: unlimited/);
    expect(st.text).toMatch(/Maximum loss = 1,150\.00/);
    expect(st.text).toMatch(/Breakevens: 88\.5; 111\.5\./);
    expect(ok("deriv-strategy", { legs: "stock, 50, −1" }).text).toMatch(/Maximum loss: unlimited/);
  });
  test("strategy: a zero-quantity leg is left out with a note; all zero refuses", () => {
    expect(ok("deriv-strategy", { legs: "call, 100, 1, 3\nput, 90, 0, 1" }).text).toMatch(/Line 2 has quantity 0 and is left out\./);
    expect(refusal("deriv-strategy", { legs: "call, 100, 0, 3" })).toMatch(/every leg has quantity 0/);
  });
  test("swap: default payer value, receiver is its negative, zero-rate curves", () => {
    const pay = ok("deriv-swap");
    expect(pay.text).toMatch(/Swap value to this side = 77,086\.87 \(floating − fixed\)/);
    expect(pay.text).toMatch(/Par swap rate = 4\.372867%/);
    expect(ok("deriv-swap", { side: "receive" }).text).toMatch(/Swap value to this side = −77,086\.87/);
    const z = ok("deriv-swap", { ckind: "zcont", curve: "1\t4\n2\t4.2\n5\t4.5" });
    expect(z.text).toMatch(/zero rates continuously compounded/);
    // An unsorted curve is sorted with a note and gives the same value as the sorted one.
    const sorted = ok("deriv-swap", { curve: "1 0.96\n3 0.88\n5 0.80" });
    const unsorted = ok("deriv-swap", { curve: "5 0.80\n1 0.96\n3 0.88" });
    expect(unsorted.text).toMatch(/not in tenor order; they are sorted/);
    const val = (t: string) => /Swap value to this side = ([−\d.,]+)/.exec(t)![1];
    expect(val(unsorted.text)).toBe(val(sorted.text));
    // Negative rates (discount factors above 1) are allowed.
    expect(ok("deriv-swap", { fixed: "−0.1", curve: "0.25 1.0012\n1 1.0035\n2 1.004\n5 0.995", tenor: "2", ffix: "1" }).text).toMatch(/Swap value/);
  });
});

describe("hostile inputs refuse by name (never insertable)", () => {
  test("blank, 1e400, words, negatives, zero", () => {
    expect(refusal("deriv-black76", { f: "" })).toMatch(/Enter the futures price F/);
    expect(refusal("deriv-black76", { k: "1e400" })).toMatch(/Strike K: “1e400” is not a finite number/);
    expect(refusal("deriv-black76", { t: "0" })).toMatch(/Time to expiry \(years\) must be above 0/);
    expect(refusal("deriv-black76", { sig: "-5" })).toMatch(/Volatility \(%\) must be at least 0/);
    expect(refusal("deriv-black76", { sig: "0", f: "600" })).toMatch(/exactly at the money/);
    expect(refusal("deriv-crr", { s: "abc" })).toMatch(/Spot price S/);
    expect(refusal("deriv-crr", { sig: "0" })).toMatch(/Volatility \(%\) must be above 0/);
    expect(refusal("deriv-crr", { n: "2.5" })).toMatch(/Number of steps n must be a whole number/);
    expect(refusal("deriv-crr", { n: "100000" })).toMatch(/number of steps n must be at most 2,500|Number of steps n must be at most 2,500/);
    expect(refusal("deriv-crr", { n: "0" })).toMatch(/at least 1/);
    expect(refusal("deriv-crr", { r: "50", sig: "5", n: "1", t: "1" })).toMatch(/outside \(0, 1\)/);
    expect(refusal("deriv-crr", { t: "1e400" })).toMatch(/Time to expiry/);
    expect(refusal("deriv-parity", { c: "0" })).toMatch(/Call price must be above 0/);
    expect(refusal("deriv-parity", { cost: "-1" })).toMatch(/cost band/);
    expect(refusal("deriv-carry", { s: "10", inc: "20", stor: "0" })).toMatch(/S − I \+ U\) must be above zero/);
    expect(refusal("deriv-carry", { mkt: "x" })).toMatch(/Market futures price/);
    expect(refusal("deriv-strategy", { mult: "0" })).toMatch(/Contract multiplier must be above 0/);
    expect(refusal("deriv-swap", { notional: "" })).toMatch(/Enter the notional/);
    expect(refusal("deriv-swap", { ffix: "3" })).toMatch(/Fixed-leg payments must be 1, 2, 4 or 12/);
  });
  test("decimal comma, thousands, true minus and percent sign through the pane's reader", () => {
    expect(ok("deriv-black76", { r: "4,5" }).text).toMatch(/r = 4\.5%/);
    expect(ok("deriv-swap", { notional: "1,000,000" }).text).toMatch(/notional 1,000,000\.00/);
    expect(ok("deriv-crr", { r: "−1", type: "put" }).text).toMatch(/r = −1%/);
    expect(ok("deriv-parity", { r: "5%" }).text).toMatch(/r = 5%/);
  });
  test("strategy legs block", () => {
    expect(refusal("deriv-strategy", { legs: "" })).toMatch(/Strategy legs/);
    expect(refusal("deriv-strategy", { legs: "straddle, 100, 1, 2" })).toMatch(/Strategy legs: line 1/);
    expect(refusal("deriv-strategy", { legs: "100, 1, 2" })).toMatch(/line 1: start the line with call, put or stock/);
    expect(refusal("deriv-strategy", { legs: "call, 100, 1" })).toMatch(/line 1: the premium must be/);
    expect(refusal("deriv-strategy", { legs: "call, -100, 1, 2" })).toMatch(/line 1: the strike must be a positive number/);
    expect(refusal("deriv-strategy", { legs: "call, 100, 1, -2" })).toMatch(/premium must be zero or a positive number/);
    expect(refusal("deriv-strategy", { legs: "stock, 50, 1, 3" })).toMatch(/a stock leg has no premium/);
    expect(refusal("deriv-strategy", { legs: "call, 100, 1e400, 2" })).toMatch(/Strategy legs/);
    expect(refusal("deriv-strategy", { legs: Array.from({ length: 21 }, () => "call, 100, 1, 2").join("\n") })).toMatch(/Strategy legs/);
  });
  test("swap curve block", () => {
    expect(refusal("deriv-swap", { curve: "" })).toMatch(/Discount curve/);
    expect(refusal("deriv-swap", { curve: "1 0.96\n1 0.95\n5 0.8" })).toMatch(/tenor 1 appears twice \(lines 1 and 2\)/);
    expect(refusal("deriv-swap", { curve: "1 0.96\n5 0" })).toMatch(/line 2: a discount factor must be above 0/);
    expect(refusal("deriv-swap", { curve: "1 0.96\n3 0.88" })).toMatch(/past the curve's last point \(3 years\)/);
    expect(refusal("deriv-swap", { curve: "0 0.99\n5 0.8" })).toMatch(/tenor 0 must be 1/);
    expect(ok("deriv-swap", { curve: "0 1\n1 0.96\n5 0.8" }).text).toMatch(/tenor 0\) is left out/);
    expect(refusal("deriv-swap", { curve: "1 0.96 3\n5 0.8" })).toMatch(/line 1: needs 2 numbers/);
    expect(refusal("deriv-swap", { tenor: "5.1" })).toMatch(/not a whole number of fixed-leg periods/);
  });
});

describe("adversarial pass findings (fixed)", () => {
  test("a gap that rounds to 0.0000 is not reported as a trade", () => {
    expect(ok("deriv-carry", { mkt: "1869.9865" }).text).toMatch(/matches the fair price to the 4 decimals shown/);
    expect(ok("deriv-parity", { c: "10.4500", p: "5.57290" }).text).toMatch(/Parity holds to the 4 decimals shown/);
  });
  test("absurd magnitudes refuse instead of printing 130-digit numbers", () => {
    expect(refusal("deriv-carry", { r: "100", t: "100", u: "100", q: "−100" })).toMatch(/exceeds 10¹⁵/);
    expect(refusal("deriv-swap", { curve: "1 1e-300\n5 1e-300" })).toMatch(/line 1: the discount factor it gives is outside 0\.00000001 to 10/);
    expect(refusal("deriv-swap", { ckind: "zann", curve: "1 −99.9\n5 4" })).toMatch(/line 1: the discount factor it gives is outside/);
  });
  test("American put with negative rates never exercises early; American call with r < 0 < q does", () => {
    expect(ok("deriv-crr", { r: "−5", n: "6" }).text).toMatch(/never optimal/);
    expect(ok("deriv-crr", { type: "call", r: "−5", q: "5", n: "6" }).text).toMatch(/Early exercise is optimal at 6 nodes/);
  });
});

describe("timing at the caps (≤ 300 ms each)", () => {
  const time = (id: string, over: Record<string, string>): number => {
    const t0 = performance.now();
    const o = obj(run(calc(id), over));
    const ms = performance.now() - t0;
    expect(o.ok).not.toBe(false);
    return ms;
  };
  test("American put with 2,500 steps (the cap) (and its European twin and convergence figure)", () => {
    expect(time("deriv-crr", { n: "2500" })).toBeLessThan(300);
  });
  test("100-year monthly swap on a 200-point curve", () => {
    const curve = Array.from({ length: 200 }, (_, i) => `${((i + 1) / 2).toFixed(1)}\t${Math.exp(-0.04 * ((i + 1) / 2)).toFixed(10)}`).join("\n");
    expect(time("deriv-swap", { tenor: "100", ffix: "12", fflt: "12", curve })).toBeLessThan(300);
  });
  test("20 legs", () => {
    const legs = Array.from({ length: 20 }, (_, i) => `${i % 2 ? "put" : "call"}, ${80 + i * 2}, ${i % 3 ? 1 : -2}, 1.5`).join("\n");
    expect(time("deriv-strategy", { legs })).toBeLessThan(300);
  });
});
