/**
 * PORTCORP_CALCS (F1, gap items #4 and #5, defect D6) through the pane's read path: number fields through
 * readFinanceField first, then compute. run() is the stricter copy in ipValuation.test.ts (finSpreadContract.test.ts's
 * read plus the pane's two hold-backs: an unreadable number field refused with the pane's own message before compute,
 * a blank non-optional field holding the result back); runLoose() is finSpreadContract's own. Every default must be insertable
 * with ≤ 6-column tables, a "Conventions:" line and a figure; defaults print the oracle's numbers; hostile field text
 * must refuse by name (never insertable); each compute must finish within 300 ms at its caps.
 */
import * as fs from "fs";
import * as path from "path";
import { PORTCORP_CALCS } from "../portcorpCalcs";
import { FIN_GROUP_ORDER, type FinCalcDef, type FinResult } from "../finCalc";
import { readFinanceField } from "../finance";
import { withFinFig } from "../financeFigures";
import { insertableResultText } from "../insertGate";

/** finSpreadContract.test.ts's read: number fields through the product's cell reader, everything else as typed. */
function runLoose(c: FinCalcDef, over: Record<string, string> = {}): FinResult {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return c.compute((k) => numeric.get(k) ?? raw(k));
}
/** The pane's read as updateFinancePreview does it (ipValuation.test.ts's copy, with the two hold-backs). */
function run(c: FinCalcDef, over: Record<string, string> = {}): FinResult {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  let fieldRefusal = "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const r = raw(f.key);
    if (!r.trim()) continue;
    const v = readFinanceField(r);
    if (!Number.isFinite(v)) {
      if (!fieldRefusal) fieldRefusal = `${f.label}: “${r.trim()}” is not a number.`;
    } else numeric.set(f.key, String(v));
  }
  const read = (k: string): string => numeric.get(k) ?? raw(k);
  if (c.fields.some((f) => f.kind !== "select" && !f.optional && read(f.key).trim() === "")) return { text: "Enter all values to compute.", ok: false };
  if (fieldRefusal) return { text: fieldRefusal, ok: false };
  return c.compute(read);
}
const obj = (o: FinResult) => (typeof o === "string" ? { text: o, ok: undefined, svg: undefined, tables: undefined } : o);
const calc = (id: string): FinCalcDef => {
  const c = PORTCORP_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const ok = (id: string, over: Record<string, string> = {}) => {
  const o = obj(run(calc(id), over));
  if (o.ok === false) throw new Error(`${id} refused: ${o.text}`);
  expect(insertableResultText(o.text)).toBe(true);
  expect(o.text).not.toContain("—");
  expect(o.text).not.toMatch(/(^|[^\w])-\d/);
  expect(o.text).not.toMatch(/\de[-+]?\d/);
  expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
  for (const t of o.tables ?? []) for (const row of t.rows) for (const cell of row) expect(cell).not.toMatch(/—|NaN|Infinity|(^|[^\w])-\d/);
  return o;
};
const refusal = (id: string, over: Record<string, string>): string => {
  const o = obj(run(calc(id), over));
  expect(o.ok).toBe(false);
  return o.text;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FX: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "portcorp-oracle.json"), "utf8"));
const p4 = (x: number): string => (x * 100).toFixed(4);

const IDS = ["port-capm", "port-performance", "port-var", "port-frontier", "corp-wacc", "corp-capbudget", "corp-dcf"];

test("ids, groups, names, house form", () => {
  expect(PORTCORP_CALCS.map((c) => c.id)).toEqual(IDS);
  for (const c of PORTCORP_CALCS) {
    expect(FIN_GROUP_ORDER as readonly string[]).toContain(c.group);
    expect(c.name.toLowerCase().startsWith(c.group.toLowerCase())).toBe(false);
    expect(c.name.toLowerCase().startsWith(c.group.split(" ")[0].toLowerCase())).toBe(false);
    expect(c.id).toMatch(/^[a-z0-9-]+$/);
    expect(c.assumes ?? "").not.toContain("—");
    for (const f of c.fields) {
      expect(typeof f.default).toBe("string");
      if (/%/.test(f.label)) expect(f.label).toMatch(/\(%|% per period|% a year/);
    }
  }
  const src = fs.readFileSync(path.join(__dirname, "..", "portcorpCalcs.ts"), "utf8");
  expect(src.match(/^ {4}id: "/gm)?.length).toBe(IDS.length);
  expect(src.match(/^ {4}compute: \(r\) => \{\n {6}\/\/ /gm)?.length).toBe(IDS.length);
});

test("ids are unique against the pane's inline FIN_CALCS and the registries already spread", () => {
  const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
  const i = pane.indexOf("const FIN_CALCS: FinCalc[] = [");
  const body = pane.slice(i, pane.indexOf("\n];", i));
  const inline = [...body.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]);
  expect(inline.length).toBeGreaterThan(30);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // PORTCORP_CALCS itself is skipped once it is spread (it is IDS).
  const spread = [...body.matchAll(/^\s*\.\.\.([A-Z][A-Z0-9_]*_CALCS),/gm)].filter((m) => m[1] !== "PORTCORP_CALCS").flatMap((m) => {
    const imp = new RegExp(`import \\{[^}]*\\b${m[1]}\\b[^}]*\\} from "\\.\\./lib/([A-Za-z0-9]+)"`).exec(pane)!;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require(path.join(__dirname, "..", imp[1]))[m[1]] as FinCalcDef[]).map((c) => c.id);
  });
  const all = [...inline, ...spread, ...IDS];
  expect(all.filter((id, k) => all.indexOf(id) !== k)).toEqual([]);
});

test("the modules draw no Math.random", () => {
  for (const f of ["portcorpCalcs", "portfolioRisk", "corpFinance", "qpActiveSet"]) {
    expect(fs.readFileSync(path.join(__dirname, "..", f + ".ts"), "utf8")).not.toMatch(/Math\.random\s*\(/);
  }
});

describe.each(PORTCORP_CALCS.map((c) => [c.id, c] as const))("%s defaults", (_id, c) => {
  test("insertable, Conventions line, figure, ≤ 6-column tables with insertable cells", () => {
    const o = ok(c.id);
    expect(o.text).toMatch(/\nConventions: /);
    expect(o.svg ?? "").toContain("<svg");
    const tables = o.tables ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) {
        expect(row.length).toBe(t.rows[0].length);
        for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
      }
    }
  });
});

describe("defaults print the oracle's numbers", () => {
  test("port-capm (statsmodels, classical / HC1 / HAC)", () => {
    for (const cv of FX.capm) {
      const o = ok("port-capm", { se: cv.cov });
      expect(o.text).toContain(`β = ${cv.beta.toFixed(4)} (SE ${cv.betaSe.toFixed(4)}`);
      expect(o.text).toContain(`α = ${p4(cv.alpha)}% per period (SE ${p4(cv.alphaSe)}%`);
    }
  });
  test("port-performance", () => {
    const c = FX.perf[0];
    const o = ok("port-performance");
    expect(o.text).toContain(`Sharpe ratio = ${c.sharpe.toFixed(4)}`);
    expect(o.text).toContain(`Sortino ratio = ${c.sortino.toFixed(4)}`);
    expect(o.text).toContain(`Maximum drawdown = −${(-c.maxDD * 100).toFixed(2)}%: from the peak after period ${c.peak} to the trough after period ${c.trough}`);
  });
  test("port-var (seed 1, 20,000 draws, ν = 5)", () => {
    const c = FX.var[0];
    const o = ok("port-var");
    expect(o.text).toContain(`Historical: VaR ${(c.hist[0] * 100).toFixed(3)}%`);
    expect(o.text).toContain(`Parametric normal: VaR ${(c.normal[0] * 100).toFixed(3)}%`);
    expect(o.text).toContain(`Parametric Student t: VaR ${(c.t[0] * 100).toFixed(3)}%`);
    expect(o.text).toContain(`Monte Carlo (normal): VaR ${(c.mc[0] * 100).toFixed(3)}%`);
    expect(o.text).toContain("seeded with 1");
  });
  test("port-frontier (PyPortfolioOpt)", () => {
    const c = FX.frontier[0];
    const o = ok("port-frontier");
    expect(o.text).toContain(`Sharpe ratio ${c.tanSharpe.toFixed(4)}`);
    expect(o.text).toContain(`volatility ${(Math.sqrt(c.minVolVar) * 100).toFixed(3)}% a year`);
  });
  test("corp-wacc, corp-capbudget, corp-dcf", () => {
    expect(ok("corp-wacc").text).toContain(`= ${p4(FX.wacc[0].wacc)}%`);
    const b = ok("corp-capbudget").text;
    expect(b).toContain(`IRR (Project A): ${p4(FX.budget[0].irrs[0])}%`);
    expect(b).toContain(`MIRR (Project A) = ${p4(FX.budget[0].mirr)}%`);
    expect(b).toMatch(/Crossover rate \(NPV A = NPV B; the IRR of A − B\): 13\.\d{4}%/);
    expect(ok("corp-dcf").text).toContain(`= ${FX.dcf[0].perShare.toFixed(4)} per share`);
    expect(ok("corp-dcf", { timing: "mid" }).text).toContain(`= ${FX.dcf[1].perShare.toFixed(4)} per share`);
  });
});

describe("options and alternatives", () => {
  test("every IRR listed (D6): two roots and three roots, with Descartes' bound", () => {
    const two = ok("corp-capbudget", { cfa: "-1600, 10000, -10000", cfb: "" }).text;
    expect(two).toMatch(/IRR \(Project A\): 2 roots: 25\.0000%, 400\.0000% \(2 sign changes/);
    expect(two).toMatch(/The NPV profile is drawn from 0% to 100% per period; the rates listed above outside that range are not marked on it\.\nConventions:/);
    expect(ok("corp-capbudget").text).not.toMatch(/The NPV profile is drawn/);
    const three = ok("corp-capbudget", { cfa: "-1, 6, -11, 6", cfb: "" }).text;
    expect(three).toMatch(/3 roots: 0\.0000%, 100\.0000%, 200\.0000%/);
  });
  test("a double root (NPV touches zero) is reported as one", () => {
    const o = ok("corp-capbudget", { cfa: "-1, 2.2, -1.21", cfb: "" }).text; // (1 − 1.1v)²: r = 10% double
    expect(o).toMatch(/10\.0000% \(NPV touches zero without changing sign: a double root\)/);
  });
  test("all-positive cash flows: no IRR, MIRR and PI not defined, still insertable", () => {
    const o = ok("corp-capbudget", { cfa: "100, 50, 25", cfb: "" }).text;
    expect(o).toMatch(/IRR \(Project A\): none \(the cash flows never change sign/);
    expect(o).toMatch(/MIRR \(Project A\): not defined/);
    expect(o).toMatch(/Payback \(Project A\) not applicable/);
  });
  test("never paid back; unequal lives padded for the crossover", () => {
    expect(ok("corp-capbudget", { cfa: "-1000, 100, 100", cfb: "" }).text).toMatch(/Payback \(Project A\) not reached/);
    expect(ok("corp-capbudget", { cfb: "-1000, 1200" }).text).toMatch(/padded with zero flows to 5 flows/);
  });
  test("grouped thousands and decimal commas reach the right values", () => {
    expect(ok("corp-capbudget", { cfa: "-3,500,000; 1,000,000; 1,500,000; 2,000,000", cfb: "" }).text).toMatch(/Project A: 4 flows/);
    expect(ok("corp-capbudget", { cfa: "-3,500,000; 1,000,000; 1,500,000; 2,000,000", cfb: "" }).text).toContain("NPV at 10.000% = 151,389.93");
    expect(ok("corp-capbudget", { cfa: "−1000\n300,5\n400\n500", cfb: "" }).text).toMatch(/Project A: 4 flows/);
    expect(ok("corp-capbudget", { rate: "10,5" }).text).toContain("NPV at 10.500%");
    expect(ok("port-var", { value: "2,500,000" }).text).toContain("on a portfolio of 2,500,000.00");
  });
  test("returns pasted as a column, and the CAPM with a risk-free column", () => {
    expect(ok("port-performance", { rets: "1.2\n−0.5\n2.1\n0.4\n−1.3" }).text).toMatch(/^5 periods/);
    const o = ok("port-capm", { data: "1.0 0.8 0.2\n-0.5 -0.9 0.2\n2.1 1.7 0.21\n0.3 0.1 0.21\n-1.4 -1.1 0.22\n0.9 1.2 0.22" }).text;
    expect(o).toContain("the risk-free rate from the third column");
  });
  test("WACC: unlevered and peer betas; zero debt", () => {
    expect(ok("corp-wacc", { betakind: "unlevered", beta: "0.9" }).text).toContain(`= ${p4(FX.wacc[1].wacc)}%`);
    expect(ok("corp-wacc", { betakind: "peer", e: "5000", d: "3000", rd: "7", tax: "21", rf: "3.5", mrp: "6", beta: "1.3", peerde: "0.8", peertax: "30" }).text).toContain(`= ${p4(FX.wacc[2].wacc)}%`);
    expect(ok("corp-wacc", { d: "0" }).text).toMatch(/D\/V = 0\.00%/);
  });
  test("DCF: exit multiple with a metric, no shares, negative equity, no fade", () => {
    const e = ok("corp-dcf", { terminal: "exit", fade: "0", metric: "220", timing: "mid", shares: "" }).text;
    expect(e).toContain(`equity value ${FX.dcf[2].equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    expect(e).toMatch(/implied perpetual growth/);
    expect(ok("corp-dcf", { netdebt: "5000" }).text).toMatch(/Equity value is negative/);
    expect(ok("corp-dcf", { fade: "3", fadestart: "" }).text).toMatch(/growth 5\.469% fading/);
    expect(ok("corp-dcf", { g: "7.5" }).tables![2].note).toMatch(/n\/a: \d+ cells? where the WACC is not above g/);
  });
  test("VaR horizon 10 days scales and says so; t with ν = 30", () => {
    const o = ok("port-var", { horizon: "10", conf: "99" }).text;
    expect(o).toMatch(/× √10 \(square-root-of-time/);
    expect(ok("port-var", { nu: "30" }).text).toContain("ν = 30.00");
  });
  test("frontier: eight assets, no header", () => {
    const rows = (FX.frontier[1].R as number[][]).map((r) => r.join("\t")).join("\n");
    const o = ok("port-frontier", { data: rows, rf: "2" }).text;
    expect(o).toContain(`Sharpe ratio ${FX.frontier[1].tanSharpe.toFixed(4)}`);
    expect(obj(run(calc("port-frontier"), { data: rows, rf: "2" })).tables![0].rows[1][0]).toBe("Asset 1");
  });
  test("performance: constant returns and no downside say 'not defined' instead of printing a number", () => {
    const o = ok("port-performance", { rets: "1, 1, 1, 1", rf: "1" }).text;
    expect(o).toMatch(/Sharpe ratio: not defined/);
    expect(o).toMatch(/Sortino ratio: not defined/);
    expect(o).toMatch(/Maximum drawdown = 0%/);
    expect(ok("port-performance", { beta: "" }).text).toMatch(/Treynor ratio: enter a beta/);
  });
});

describe("adversarial-pass fixes (F1 builder B)", () => {
  test("an IRR exactly on a bound of the searched range is found (−99% and 10,000%)", () => {
    expect(ok("corp-capbudget", { cfa: "-1, 101", cfb: "" }).text).toMatch(/IRR \(Project A\): 10,000\.0000%/);
    expect(ok("corp-capbudget", { cfa: "-1, 0.01", cfb: "" }).text).toMatch(/IRR \(Project A\): −99\.0000%/);
    expect(ok("corp-capbudget", { cfa: "-1, 102", cfb: "" }).text).toMatch(/none found between −99% and 10,000%/);
  });
  test("a double root at 0% (−1, 2, −1) is reported", () => {
    expect(ok("corp-capbudget", { cfa: "-1, 2, -1", cfb: "" }).text).toMatch(/IRR \(Project A\): 0\.0000% \(NPV touches zero/);
  });
  test("DCF with zero free cash flows prints (no implied multiple) instead of refusing", () => {
    expect(ok("corp-dcf", { fcf: "0, 0" }).text).toMatch(/no implied multiple \(the final-year FCF is 0\)/);
  });
  test("a figure above 10²¹ (a tiny share count) is refused by name, not printed as 300 digits", () => {
    expect(refusal("corp-dcf", { shares: "1e-300" })).toMatch(/above 10²¹/);
  });
  test("negative operands in printed formulas are parenthesised", () => {
    const o = ok("corp-wacc", { beta: "-2", rd: "-1" }).text;
    expect(o).toContain("4.200% + (−2.0000) × 5.500%");
    expect(o).toContain("(−1.000%) × (1 − 25.00%)");
    expect(ok("corp-dcf", { g: "-3" }).text).toContain("(9.000% − (−3.000%))");
  });
  test("VaR says when a loss above 100% is a model artifact and when the sample is too short for the tail", () => {
    const o = ok("port-var", { horizon: "250", conf: "99" }).text;
    expect(o).toMatch(/A loss above 100% is an artifact of the model/);
    expect(o).toMatch(/Only 48 returns for a 1\.00% tail/);
    expect(ok("port-var").text).not.toMatch(/Only \d+ returns/);
  });
  test("frontier with exactly equal means (the active-set method cycled here before the fix)", () => {
    const o = ok("port-frontier", { data: "A B C\n1 3 1.1\n3 1 3.2\n2 2 1.9\n0 4 0.2\n4 0 3.7\n1 1 1" }).text;
    expect(o).toMatch(/Minimum-variance portfolio: A 50\.00%, B 50\.00%/);
  });
  test("a space inside a number in a semicolon list is refused, not read as two values", () => {
    expect(refusal("corp-capbudget", { cfa: "−1 000; 300; 400", cfb: "" })).toMatch(/“−1 000” is one number grouped in thousands with spaces/);
  });
});

describe("review fixes", () => {
  test("every figure follows the Finance figure style (width, USPTO black and white), the DCF heat map included", () => {
    for (const c of PORTCORP_CALCS) {
      const o = withFinFig({ width: 300, bw: true }, () => obj(run(c)));
      // Black and white: none of the colour figure's series colours survive (plot figures widen past the nominal width
      // for an outside legend, by design, so only the heat map's width is pinned exactly).
      expect(o.svg ?? "").not.toMatch(/#(2563eb|b91c1c|ea580c|16a34a|9333ea)/i);
      if (c.id === "corp-dcf") {
        expect(o.svg ?? "").toMatch(/<svg[^>]*\swidth="300"/);
        const fills = [...(o.svg ?? "").matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
        // The house grey ramp (chartPalette SEQUENTIAL_GREY, a warm neutral): every fill within 16 levels across R, G,
        // B, where the colour figure's blue ramp is far apart.
        const spread = (f: string): number => {
          const ch = [1, 3, 5].map((i) => parseInt(f.slice(i, i + 2), 16));
          return Math.max(...ch) - Math.min(...ch);
        };
        expect(fills.length).toBeGreaterThan(20);
        for (const f of fills) expect(spread(f)).toBeLessThanOrEqual(16);
        const colour = [...(obj(run(c)).svg ?? "").matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
        expect(colour.some((f) => spread(f) > 40)).toBe(true);
      }
    }
    expect(obj(run(calc("corp-dcf"))).svg).toMatch(/<svg[^>]*\swidth="520"/);
  });
  test("prices in place of returns (pₜ/pₜ₋₁ − 1), refusing a price of 0 by name", () => {
    const o = ok("port-performance", { input: "prices", rets: "100, 102, 99.96, 104.958, 103.90842" }).text;
    expect(o).toMatch(/^4 periods/);
    expect(o).toContain("Mean return 1.0000% per period");
    expect(o).toMatch(/returns computed from the pasted prices as simple returns/);
    expect(refusal("port-var", { input: "prices", rets: "100, 0, 101" })).toMatch(/^Prices: price 2 \(0\.0000\) must be above 0/);
    expect(ok("port-var", { input: "prices", rets: "100\n101\n99\n102\n100.5" }).text).toMatch(/from 4 returns/);
    const capm = ok("port-capm", { input: "prices", data: "Fund Index\n100 50\n103 51\n101 50.2\n106 52\n104 51.5\n108 53" }).text;
    expect(capm).toMatch(/5 periods/);
    expect(ok("port-frontier", { input: "prices", data: "A B C\n100 50 20\n103 50.4 20.5\n101 50.9 20.2\n106 51 20.8\n104 51.6 21.1\n108 51.9 20.9" }).text).toMatch(/from 5 periods/);
  });
  test("tangency when r_f sits just below the top mean (6.600%)", () => {
    for (const rf of ["6.5", "6.599", "6.5999999"]) {
      const o = ok("port-frontier", { rf }).text;
      expect(o).toMatch(/Tangency \(maximum Sharpe\) portfolio at r_f = 6\.\d+%: Stocks 100\.00%/);
    }
  });
  test("the CAPM risk-free field is optional (a third column supplies the rate)", () => {
    expect(calc("port-capm").fields.find((f) => f.key === "rf")!.optional).toBe(true);
    expect(ok("port-capm", { rf: "", data: "1.0 0.8 0.2\n-0.5 -0.9 0.2\n2.1 1.7 0.21\n0.3 0.1 0.21\n-1.4 -1.1 0.22\n0.9 1.2 0.22" }).text).toContain("third column");
  });
  test("the pane's old defaults through the new calculators (dcf, irr, npv)", () => {
    // dcf: 100, 110, 121 at 10%, Gordon g 3% printed Value = 1,610.39.
    expect(ok("corp-dcf", { fcf: "100, 110, 121", wacc: "10", fade: "0", g: "3", netdebt: "0", shares: "" }).text).toContain("Enterprise value = 1,610.39");
    // irr / npv: −1000, 500, 500, 500 at 10%.
    const b = ok("corp-capbudget", { cfa: "-1000, 500, 500, 500", cfb: "" }).text;
    expect(b).toContain("NPV at 10.000% = 243.43");
    expect(b).toMatch(/IRR \(Project A\): 23\.3752%/);
  });
});

describe("hostile inputs refuse by name (never insertable)", () => {
  test("blank, 1e400, words, NaN", () => {
    expect(refusal("port-performance", { rets: "1, 1e400, 2" })).toMatch(/Returns \(%\)/);
    expect(refusal("port-performance", { rets: "1, abc, 2" })).toMatch(/Returns \(%\).*not a number/);
    expect(refusal("port-performance", { ppy: "1e400" })).toMatch(/^Periods per year \(12 monthly, 52 weekly, 252 trading days\): “1e400” is not a number\.$/);
    expect(refusal("port-performance", { rets: "" })).toBe("Enter all values to compute.");
    // Called directly (the loose read), compute names the field itself.
    expect(obj(runLoose(calc("port-performance"), { ppy: "1e400" })).text).toMatch(/Periods per year: “1e400” is not a finite number/);
    expect(obj(runLoose(calc("port-performance"), { rets: "" })).text).toMatch(/Returns \(%\): nothing to read/);
    expect(refusal("port-performance", { ppy: "0" })).toMatch(/Periods per year must be at least 1/);
    expect(refusal("port-performance", { ppy: "12.5" })).toMatch(/Periods per year must be a whole number/);
    expect(refusal("port-performance", { rets: "5" })).toMatch(/at least 2 periods/);
    expect(refusal("port-performance", { rets: "5, -100, 3" })).toMatch(/−100% or below/);
    expect(refusal("port-performance", { beta: "NaN" })).toMatch(/^Beta for the Treynor ratio \(optional\): “NaN” is not a number\.$/);
    expect(obj(runLoose(calc("port-capm"), { data: "" })).text).toMatch(/Returns \(%\): nothing to read/);
    expect(refusal("port-capm", { data: "1\n2\n3" })).toMatch(/1 column; expected 2 to 3/);
    expect(refusal("port-capm", { data: "1 2\n2 1e400\n3 4" })).toMatch(/Returns \(%\)/);
    expect(refusal("port-capm", { data: "1 2\n2 3" })).toMatch(/at least 3 periods/);
    expect(refusal("port-capm", { data: "1 2\n2 2\n3 2\n4 2" })).toMatch(/market's excess return does not vary/);
    expect(refusal("port-capm", { data: "1 2\n2 NA\n3 2\n4 2" })).toMatch(/line 2: a value is missing/);
    expect(refusal("port-capm", { rf: "" })).toMatch(/Enter the risk-free rate/);
  });
  test("VaR bounds", () => {
    expect(refusal("port-var", { conf: "100" })).toMatch(/Confidence level \(%\) must be below 100/);
    expect(refusal("port-var", { conf: "50" })).toMatch(/Confidence level \(%\) must be above 50/);
    expect(refusal("port-var", { horizon: "0" })).toMatch(/Horizon \(periods\) must be at least 1/);
    expect(refusal("port-var", { sims: "1e9" })).toMatch(/Monte Carlo draws must be at most 200,000/);
    expect(refusal("port-var", { sims: "1e400" })).toMatch(/^Monte Carlo draws: “1e400” is not a number\.$/);
    expect(refusal("port-var", { seed: "-1" })).toMatch(/Seed must be at least 0/);
    expect(refusal("port-var", { seed: "1.5" })).toMatch(/Seed must be a whole number/);
    expect(refusal("port-var", { nu: "2" })).toMatch(/degrees of freedom ν must be above 2/);
    expect(refusal("port-var", { rets: "2, 2, 2, 2" })).toMatch(/volatility is zero/);
    expect(refusal("port-var", { value: "0" })).toMatch(/Portfolio value must be above 0/);
  });
  test("frontier: singular covariance, no asset above r_f, too few periods, too many assets", () => {
    expect(refusal("port-frontier", { data: "A B C\n1 1 2\n2 2 1\n3 3 5\n-1 -1 0\n0.5 0.5 1" })).toMatch(/covariance matrix is singular: asset 2 \(B\)/);
    expect(refusal("port-frontier", { rf: "50" })).toMatch(/No asset's mean return is above the risk-free rate/);
    expect(refusal("port-frontier", { data: "1 2 3\n2 1 3\n3 3 1" })).toMatch(/3 periods for 3 assets/);
    const wide = Array.from({ length: 30 }, (_, i) => Array.from({ length: 21 }, (_, j) => ((i * 7 + j * 13) % 11) - 5).join("\t")).join("\n");
    expect(refusal("port-frontier", { data: wide })).toMatch(/21 columns; expected 2 to 20/);
    expect(refusal("port-frontier", { data: "A B\n1 2\n2 2\n3 2\n4 2" })).toMatch(/singular: asset 2 \(B\)/);
  });
  test("WACC", () => {
    expect(refusal("corp-wacc", { e: "0" })).toMatch(/Market value of equity must be above 0/);
    expect(refusal("corp-wacc", { tax: "100" })).toMatch(/Tax rate \(%\) must be below 100/);
    expect(refusal("corp-wacc", { betakind: "peer", peerde: "" })).toMatch(/Enter the peer debt-to-equity/);
    expect(refusal("corp-wacc", { beta: "1e400" })).toMatch(/^Beta: “1e400” is not a number\.$/);
    expect(refusal("corp-wacc", { rd: "" })).toBe("Enter all values to compute.");
  });
  test("capital budgeting", () => {
    expect(refusal("corp-capbudget", { cfa: "-1000" })).toMatch(/Project A cash flows: enter at least 2 flows/);
    expect(refusal("corp-capbudget", { cfa: "-1000, 1e400" })).toMatch(/Project A cash flows/);
    expect(refusal("corp-capbudget", { cfa: "-1000, 1e16" })).toMatch(/larger than 1,000,000,000,000,000/);
    expect(refusal("corp-capbudget", { cfb: "x" })).toMatch(/Project B cash flows/);
    expect(refusal("corp-capbudget", { rate: "-100" })).toMatch(/Discount rate \(% per period\) must be above −99/);
    const many = Array.from({ length: 1001 }, (_, i) => (i ? 10 : -1000)).join(", ");
    expect(refusal("corp-capbudget", { cfa: many })).toMatch(/more than 1,000 values/);
  });
  test("DCF", () => {
    expect(refusal("corp-dcf", { g: "9" })).toMatch(/WACC\) must be above the terminal growth rate g/);
    expect(refusal("corp-dcf", { shares: "0" })).toMatch(/Shares outstanding must be above 0/);
    expect(refusal("corp-dcf", { fcf: "100", fadestart: "" })).toMatch(/First fade-year growth \(%\): enter it/);
    expect(refusal("corp-dcf", { fade: "200" })).toMatch(/Fade years must be at most 100/);
    expect(refusal("corp-dcf", { fcf: "" })).toBe("Enter all values to compute.");
    expect(obj(runLoose(calc("corp-dcf"), { fcf: "" })).text).toMatch(/Explicit free cash flows: nothing to read/);
    expect(refusal("corp-dcf", { terminal: "exit", multiple: "" })).toMatch(/Enter the exit multiple/);
    expect(refusal("corp-dcf", { wstep: "0" })).toMatch(/Sensitivity step for WACC/);
  });
});

describe("timing at the caps (≤ 300 ms each)", () => {
  const time = (id: string, over: Record<string, string>): number => {
    const t0 = performance.now();
    const o = obj(run(calc(id), over));
    const ms = performance.now() - t0;
    if (o.ok === false) throw new Error(o.text);
    return ms;
  };
  const series = (n: number, f: (i: number) => number): string => Array.from({ length: n }, (_, i) => f(i).toFixed(3)).join("\n");
  test("capital budgeting: two 1,000-flow projects", () => {
    const a = Array.from({ length: 1000 }, (_, i) => (i ? 12 + Math.sin(i) : -1000)).join(", ");
    const b = Array.from({ length: 1000 }, (_, i) => (i ? 11 + Math.cos(i) : -900)).join(", ");
    expect(time("corp-capbudget", { cfa: a, cfb: b })).toBeLessThan(300);
  });
  test("VaR: 10,000 returns and 200,000 draws", () => {
    expect(time("port-var", { rets: series(10000, (i) => 3 * Math.sin(i * 1.7) + 0.2), sims: "200000" })).toBeLessThan(300);
  });
  test("frontier: 20 assets × 2,000 periods (the cap)", () => {
    const rows = Array.from({ length: 2000 }, (_, i) => Array.from({ length: 20 }, (_, j) => (Math.sin(i * (j + 1.3)) * (1 + j / 5) + 0.05 * j).toFixed(3)).join("\t")).join("\n");
    expect(time("port-frontier", { data: rows })).toBeLessThan(300);
  });
  test("CAPM: 5,000 periods, Newey–West", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `${(1.1 * Math.sin(i) + 0.3 * Math.cos(3 * i)).toFixed(3)}\t${Math.sin(i).toFixed(3)}`).join("\n");
    expect(time("port-capm", { data: rows, se: "hac" })).toBeLessThan(300);
  });
  test("DCF: 100 years", () => {
    expect(time("corp-dcf", { fcf: Array.from({ length: 50 }, (_, i) => 100 + i).join(", "), fade: "50" })).toBeLessThan(300);
  });
});

describe("F1 review C fixes", () => {
  test("identical projects: the NPVs are equal and coincide at every rate (never 'A has the higher NPV')", () => {
    const o = ok("corp-capbudget", { cfa: "-100, 100", cfb: "-100, 100" }).text;
    expect(o).toContain("Crossover rate: none; the two projects' cash flows are identical, so their NPVs coincide at every rate. The NPVs are equal at");
    expect(o).not.toContain("has the higher NPV");
    expect(o).not.toContain("one project's NPV is above the other's");
  });
  test("different flows whose NPVs are equal to the cent at the rate say equal", () => {
    // at 10%: A = −100 + 110/1.1 = 0, B = −50 + 55/1.1 = 0; A − B = (−50, 55) crosses at 10%
    const o = ok("corp-capbudget", { rate: "10", cfa: "-100, 110", cfb: "-50, 55" }).text;
    expect(o).toContain("The NPVs are equal at 10.000% (to the cent shown).");
    expect(o).not.toContain("has the higher NPV");
  });
  test("a triple root at 0 prints 0.0000%, no false minus", () => {
    const o = ok("corp-capbudget", { cfa: "-100, 300, -300, 100", cfb: "" }).text;
    expect(o).toMatch(/IRR \(Project A\): 0\.0000%/);
    expect(o).not.toContain("−0.000");
    // a well-conditioned root is not moved by the snap (the default project, oracle-checked elsewhere)
    expect(ok("corp-capbudget", { cfb: "" }).text).toMatch(/IRR \(Project A\): \d+\.\d{4}%/);
  });
  test("DCF: a tiny share count prints its digits, never '÷ 0 shares'", () => {
    const o = ok("corp-dcf", { shares: "0.0000001" }).text;
    expect(o).not.toContain("÷ 0 shares");
    expect(o).toContain("÷ 0.0000001 shares");
    expect(ok("corp-dcf", { shares: "1" }).text).toContain("÷ 1 share =");
    expect(ok("corp-dcf").text).toContain("÷ 50 shares =");
  });
  test("US spelling in user-visible text", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "portcorpCalcs.ts"), "utf8") + fs.readFileSync(path.join(__dirname, "..", "qpActiveSet.ts"), "utf8");
    expect(src).not.toMatch(/centre|programme|optimiser|artefact/);
  });
  test("every refusal of every portfolio/corporate calculator starts with a capital", () => {
    for (const c of PORTCORP_CALCS)
      for (const f of c.fields) {
        if (f.kind === "select" || f.kind === "block" || f.kind === "list" || f.kind === "text") continue;
        for (const v of ["−5", "0", "1e400", "2.5", "-0.5", "100", "1e9"]) {
          const o = obj(runLoose(c, { [f.key]: v }));
          if (o.ok === false) expect([c.id, f.key, v, /^[A-Z“(]/.test(o.text)]).toEqual([c.id, f.key, v, true]);
        }
      }
  });
});
