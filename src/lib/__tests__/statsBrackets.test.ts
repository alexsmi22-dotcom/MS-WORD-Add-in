/**
 * statsBrackets (v2.143.0): the Statistics pane's bracketed box plots, built ONLY
 * from engine results, plus Dunn brackets (sigBrackets.bracketsFromDunn).
 */
import { bracketedBoxPlot, BRACKETS_OFF, type BracketChoice } from "../statsBrackets";
import { boxPlotSvg } from "../statchart";
import { twoSampleTTest, pairedTTest } from "../stats";
import { mannWhitneyU, wilcoxonSignedRank, adjustPValues } from "../stats2";
import { tukeyHSD } from "../tukey";
import { kruskalWallis, dunnTest } from "../nonparametric";
import { bracketsFromDunn, formatPValue } from "../sigBrackets";

const xml = (t: string): string => t.replace(/</g, "&lt;");
const A = [5.1, 5.4, 5.0, 5.6, 5.3, 5.2];
const B = [6.4, 6.8, 6.1, 6.9, 6.5, 6.6];
const C = [5.2, 5.5, 5.1, 5.7, 5.0, 5.4];
const two = [
  { label: "group 1", values: A },
  { label: "group 2", values: B },
];
const stars: BracketChoice = { label: "stars", hideNs: false, tall: false };
const exact: BracketChoice = { label: "p", hideNs: false, tall: false };

describe("off is the plain figure, byte for byte", () => {
  test("label off: exactly boxPlotSvg at the default size (the figure every Stats test drew before)", () => {
    const opts = { title: "t", ylabel: "value" };
    const r = bracketedBoxPlot(two, opts, { kind: "t", result: twoSampleTTest(A, B) }, BRACKETS_OFF);
    expect(r).toEqual({ ok: true, svg: boxPlotSvg(two, opts), caption: "" });
  });
});

describe("each engine's own p, and the test named in the caption", () => {
  test("two-sample t-test", () => {
    const res = twoSampleTTest(A, B);
    const r = bracketedBoxPlot(two, {}, { kind: "t", result: res }, exact);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.caption).toBe("t-test.");
    expect(r.svg).toContain(`data-p="${String(res.p)}"`);
    expect(r.svg).toContain(xml(formatPValue(res.p)));
  });
  test("paired t-test is labelled PAIRED (dKind dz), not as an independent-samples test", () => {
    const res = pairedTTest(A, B);
    const r = bracketedBoxPlot(two, {}, { kind: "t", result: res }, stars);
    expect(r.ok && r.caption).toMatch(/paired t-test/);
  });
  test("Mann–Whitney and Wilcoxon", () => {
    const mw = bracketedBoxPlot(two, {}, { kind: "mann-whitney", result: mannWhitneyU(A, B) }, stars);
    expect(mw.ok && mw.caption).toMatch(/Mann–Whitney U/);
    const wx = bracketedBoxPlot(two, {}, { kind: "wilcoxon", result: wilcoxonSignedRank(A, B) }, stars);
    expect(wx.ok && wx.caption).toMatch(/Wilcoxon signed-rank/);
  });
  test("Tukey HSD: one bracket per pair, family-wise, never re-corrected", () => {
    const groups = [A, B, C];
    const res = tukeyHSD(groups, 0.05);
    expect(res).not.toBeNull();
    if (!res) return;
    const r = bracketedBoxPlot(
      groups.map((g, i) => ({ label: `group ${i + 1}`, values: g })),
      {},
      { kind: "tukey", result: res },
      exact,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.caption).toMatch(/Tukey HSD, 3 pairwise comparisons; p values are family-wise adjusted/);
    for (const pr of res.pairs) expect(r.svg).toContain(`data-p="${String(pr.p)}"`);
  });
  test("a forged engine result is refused as a message, and the plain figure is kept", () => {
    const forged = { ...twoSampleTTest(A, B), p: 0.0001 };
    const r = bracketedBoxPlot(two, {}, { kind: "t", result: forged }, stars);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/not self-consistent/);
      expect(r.svg).toBe(boxPlotSvg(two, { w: 380, h: 280 }));
    }
  });
});

describe("ns, height and correction are explicit", () => {
  test("hide ns: the hidden brackets are COUNTED in the caption, never silently dropped", () => {
    const groups = [A, C, B];
    const res = tukeyHSD(groups, 0.05);
    if (!res) throw new Error("tukey");
    const ns = res.pairs.filter((p) => p.p >= 0.05).length;
    expect(ns).toBeGreaterThan(0);
    const r = bracketedBoxPlot(
      groups.map((g, i) => ({ label: `g${i}`, values: g })),
      {},
      { kind: "tukey", result: res },
      { label: "stars", hideNs: true, tall: false },
    );
    expect(r.ok && r.caption).toMatch(new RegExp(`${ns} non-significant comparison`));
  });
  test("taller: 1.5× the height at the same width", () => {
    const r = bracketedBoxPlot(two, {}, { kind: "t", result: twoSampleTTest(A, B) }, { ...stars, tall: true });
    expect(r.ok && r.svg).toMatch(/^<svg[^>]*height="420"/);
  });
  test("a canvas width re-renders in proportion (for the figure styles)", () => {
    const r = bracketedBoxPlot(two, {}, { kind: "t", result: twoSampleTTest(A, B) }, stars, 760);
    expect(r.ok && r.svg).toMatch(/^<svg[^>]*width="760"[^>]*height="560"/);
  });
});

describe("Dunn brackets after Kruskal–Wallis", () => {
  const groups = [A, B, C];
  test("built from dunnTest's own Holm-adjusted p; the correction is named in the caption", () => {
    expect(kruskalWallis(groups).p).toBeLessThan(0.05);
    const d = dunnTest(groups, "holm");
    const r = bracketedBoxPlot(
      groups.map((g, i) => ({ label: `group ${i + 1}`, values: g })),
      {},
      { kind: "dunn", result: d, k: 3, correction: "holm" },
      exact,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.caption).toBe("Dunn; 3 comparisons, p values adjusted by Holm.");
    for (const c of d.comparisons) expect(r.svg).toContain(`data-p="${String(c.pAdjusted)}"`);
  });
  test("bracket p = the engine's pAdjusted, rawP = its raw p (never adjusted twice)", () => {
    const d = dunnTest(groups, "holm");
    const set = bracketsFromDunn(d, 3, "holm");
    set.brackets.forEach((b, n) => {
      expect(b.p).toBe(d.comparisons[n].pAdjusted);
      expect(b.rawP).toBe(d.comparisons[n].p);
      expect(b.test).toBe("Dunn");
    });
    expect(adjustPValues(d.comparisons.map((c) => c.p), "holm")).toEqual(d.comparisons.map((c) => c.pAdjusted));
  });
  test("a Holm run named as Bonferroni, an edited pAdjusted, a wrong k, or a failed run is refused", () => {
    const d = dunnTest(groups, "holm");
    expect(() => bracketsFromDunn(d, 3, "bonferroni")).toThrow(/another correction or edited/);
    const edited = { ...d, comparisons: d.comparisons.map((c, i) => (i === 0 ? { ...c, pAdjusted: 0.0001 } : c)) };
    expect(() => bracketsFromDunn(edited, 3, "holm")).toThrow(RangeError);
    expect(() => bracketsFromDunn(d, 4, "holm")).toThrow(/has 6 pairs, this one has 3/);
    expect(() => bracketsFromDunn({ ok: false, comparisons: [] }, 3, "holm")).toThrow(TypeError);
  });
});
