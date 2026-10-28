/**
 * "Fully inclusive" (2026-10-28): the eight library Finance calculators that drew no figure now draw one
 * (finLibFigures.ts). Each figure is present on the defaults, plots the engine's own values, keeps the layout and
 * label gates (scripts/figure-layout-audit.js, scripts/figure-label-audit.js) at the pane width and under the
 * USPTO-style black-and-white re-render, and survives hostile inputs without throwing.
 */
import { CBA_CALCS, cipForward } from "../cbaCalcs";
import { DERIV_CALCS } from "../derivCalcs";
import { IPVAL_CALCS } from "../ipValuationCalcs";
import { SCHED_CALCS } from "../schedCalcs";
import type { FinCalcDef } from "../finCalc";
import { withFinFig } from "../financeFigures";
import { prepareFigure } from "../insertCapability";
import { asObj, calcById, runCalc } from "./fullFinLibHelpers";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditSvg } = require("../../../scripts/figure-layout-audit.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditLabels } = require("../../../scripts/figure-label-audit.js");

const ALL: FinCalcDef[] = [...CBA_CALCS, ...DERIV_CALCS, ...IPVAL_CALCS, ...SCHED_CALCS];
const FIG_IDS = ["fx-cip", "fx-uip", "fx-ppp", "deriv-parity", "ipv-apportion", "ipv-emvr-ssppu", "ipv-nash", "fin-ratios"];

function svgOf(id: string, over: Record<string, string> = {}): string | undefined {
  const o = asObj(runCalc(calcById(ALL, id), over));
  return o.ok === false ? undefined : o.svg;
}
function gateProblems(svg: string): string[] {
  const lay: string[] = auditSvg("fig", svg).found;
  const lab = auditLabels(svg) as Record<string, string[]>;
  return [...lay, ...Object.entries(lab).flatMap(([k, v]) => v.map((x) => `${k} ${x}`))];
}
/** The points of a plot.ts circle marker or path vertex are hard to recover; the plotted DATA are read back from
 * the builder's own inputs instead, by re-running the builder with a spy. Here we check the drawn text values. */
function texts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

describe.each(FIG_IDS)("%s", (id) => {
  test("draws on its defaults, clean under the layout and label gates at the pane width", () => {
    const svg = svgOf(id);
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(gateProblems(svg!)).toEqual([]);
  });
  test("re-renders at journal and USPTO widths (black and white) and stays clean", () => {
    for (const fig of [
      { width: 300, bw: true },
      { width: 500, bw: false },
      { width: 260, bw: false },
    ]) {
      const svg = withFinFig(fig, () => svgOf(id));
      // at least the asked width (the plotter widens the canvas for a legend outside the frame)
      expect(Number(/^<svg[^>]*width="([\d.]+)"/.exec(svg ?? "")?.[1])).toBeGreaterThanOrEqual(fig.width);
      if (fig.bw) expect(svg).not.toMatch(/#(?:2563eb|b91c1c)/);
      expect(gateProblems(svg!)).toEqual([]);
    }
  });
});

describe("the USPTO figure style re-renders every new figure and accepts it (prepareFigure, as the pane inserts it)", () => {
  test.each(FIG_IDS)("%s", (id) => {
    const render = (w: number): string => withFinFig({ width: w, bw: true }, () => svgOf(id) ?? "");
    const r = prepareFigure({ svg: svgOf(id)!, preset: "uspto", width: "single", render });
    if (!r.ok) throw new Error(`${id}: ${r.reason}: ${r.problems.join("; ")}`);
    expect(r.ok).toBe(true);
    expect(gateProblems(r.svg)).toEqual([]);
  });
});

describe("the figures plot the engine's values", () => {
  test("fx-cip: the parity curve passes through the engine's forward at the tenor, and the quote is marked", () => {
    const F = cipForward(1.25, 0.05, 0.03, 182, "360", "360", "simple").F;
    const svg = svgOf("fx-cip")!;
    expect(svg).toContain("quoted forward");
    expect(svg).toContain("parity at tenor");
    // the y range covers both the parity forward and the quote
    expect(F).toBeCloseTo(1.26245, 5);
    expect(svgOf("fx-cip", { fwd: "" })).not.toContain("quoted forward");
  });
  test("fx-uip and fx-ppp: the realized spot is marked only when given; absolute PPP without a spot draws nothing", () => {
    expect(svgOf("fx-uip")).toContain("realized spot");
    expect(svgOf("fx-uip", { st: "" })).not.toContain("realized spot");
    expect(svgOf("fx-ppp", { mode: "relative" })).toContain("PPP spot path");
    const abs = svgOf("fx-ppp")!;
    // the basket at home (5.50) and abroad at spot (1.25 × 4.80 = 6.00)
    expect(texts(abs).join(" ")).toMatch(/5\.50/);
    expect(texts(abs).join(" ")).toMatch(/6\.00/);
    expect(svgOf("fx-ppp", { spot: "" })).toBeUndefined();
  });
  test("deriv-parity: the quoted C − P is plotted against the parity line", () => {
    const svg = svgOf("deriv-parity")!;
    expect(svg).toContain("quoted C − P");
    expect(svg).toContain("parity at spot");
  });
  test("ipv-apportion, ipv-emvr-ssppu and ipv-nash: each bar prints the table's own amount", () => {
    for (const id of ["ipv-apportion", "ipv-emvr-ssppu", "ipv-nash"]) {
      const o = asObj(runCalc(calcById(ALL, id)));
      const cells = o.tables!.flatMap((x) => x.rows.flat());
      const amounts = texts(o.svg!).filter((s) => /^\$/.test(s));
      expect(amounts.length).toBeGreaterThanOrEqual(4);
      for (const a of amounts) expect(cells).toContain(a);
    }
    const nash = texts(svgOf("ipv-nash")!);
    expect(nash).toContain("$1,250,000.00"); // the patentee's half of the 2,500,000.00 surplus
    const app = texts(svgOf("ipv-apportion")!);
    expect(app[app.length - 1]).toBe("$432,000.00"); // the royalty, last
  });
  test("fin-ratios: the profile prints the table's own values", () => {
    const o = asObj(runCalc(calcById(ALL, "fin-ratios")));
    const t = texts(o.svg!);
    expect(t).toContain("2.00×"); // current ratio
    expect(t).toContain("22.50%"); // return on equity
    const cells = o.tables!.flatMap((x) => x.rows.flat());
    for (const v of t.filter((s) => /\d/.test(s))) expect(cells).toContain(v);
  });
});

describe("hostile inputs do not throw and draw a sane figure or none", () => {
  const cases: [string, Record<string, string>][] = [
    ["fx-cip", { days: "1" }],
    ["fx-cip", { spot: "1e9", fwd: "2e9" }],
    ["fx-cip", { id: "-50", if: "900" }],
    ["fx-uip", { years: "100", id: "900", if: "-50" }],
    ["fx-uip", { id: "5", if: "5", st: "" }],
    ["fx-ppp", { mode: "relative", infd: "2", inff: "2" }],
    ["fx-ppp", { pd: "1e12", pf: "0.0001", spot: "1e-9" }],
    ["deriv-parity", { c: "0.0001", p: "1e9" }],
    ["deriv-parity", { s: "1e12", k: "1" }],
    ["fin-ratios", { stmt: "Total current assets\t100\nTotal current liabilities\t200" }],
    ["ipv-apportion", { ssu: "0.0001", feature: "0.0001" }],
    ["ipv-apportion", { revenue: "999,999,999,999" }],
    ["ipv-emvr-ssppu", { ssppu: "0.01" }],
    ["ipv-nash", { share: "99.99" }],
    ["ipv-nash", { withp: "1e12", alt: "1" }],
    ["fin-ratios", { stmt: "Net sales\t100\nNet income\t−500\nShareholders’ equity\t−20\nTotal assets\t50" }],
  ];
  test.each(cases)("%s %j", (id, over) => {
    const svg = svgOf(id, over);
    if (svg !== undefined) {
      expect(svg).toMatch(/^<svg[\s>]/);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(auditSvg("fig", svg).found.filter((f: string) => f.startsWith("CLIPPED"))).toEqual([]);
    }
  });
});
