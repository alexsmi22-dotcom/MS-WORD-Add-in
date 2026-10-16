// v2.143.0 independent-review defects in the significance brackets, pinned.
//
//   1. The brackets ignored the engine's α: Tukey at α = 0.01 drew "*" on a pair
//      the text called not significant (p = 0.0382), and "Hide ns" kept it; at
//      α = 0.10 a pair the text starred was drawn "ns".
//   6. bracketsFromTukey accepted a result with every p edited to 0.00001.
//   -  A 6-group Tukey whose brackets cannot fit even 1.5× tall told the user to
//      "make the chart taller".

import { createHash } from "crypto";
import { tukeyHSD, type TukeyResult } from "../tukey";
import { bracketedBoxPlot } from "../statsBrackets";
import { bracketsFromTukey, bracketsFromDunn, bracketLegend, planBrackets } from "../sigBrackets";
import { dunnTest } from "../nonparametric";
import { twoSampleTTest } from "../stats";
import { mannWhitneyU } from "../stats2";

const r = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const G4 = [r(1, 5), r(6, 10), r(11, 15), r(3, 7)];
const boxes = (g: number[][]) => g.map((v, i) => ({ label: `group ${i + 1}`, values: v }));
const xOf = (k: number): number => 50 + 60 * k;

/** label drawn on bracket i-j, read back from the SVG. */
function drawnLabels(svg: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<g data-sig-bracket="(\d+-\d+)"[^>]*>.*?<text[^>]*>([^<]*)<\/text><\/g>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) out.set(m[1], m[2]);
  return out;
}

describe("brackets follow the engine's α (item 1)", () => {
  test("Tukey α = 0.01: pair 1–3 (p = 0.0382, not significant) is drawn ns, and Hide ns hides it", () => {
    const t = tukeyHSD(G4, 0.01) as TukeyResult;
    const p13 = t.pairs.find((p) => p.i === 1 && p.j === 3)!;
    expect(p13.significant).toBe(false);
    expect(p13.p).toBeGreaterThan(0.01);
    expect(p13.p).toBeLessThan(0.05);
    const f = bracketedBoxPlot(boxes(G4), { title: "T", ylabel: "value" }, { kind: "tukey", result: t }, { label: "stars", hideNs: false, tall: false });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(drawnLabels(f.svg).get("1-3")).toBe("ns");
    const hidden = bracketedBoxPlot(boxes(G4), { title: "T", ylabel: "value" }, { kind: "tukey", result: t }, { label: "stars", hideNs: true, tall: false });
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    expect(drawnLabels(hidden.svg).has("1-3")).toBe(false);
    expect(hidden.caption).toContain("2 non-significant comparisons not shown");
  });

  test.each([0.01, 0.05, 0.1])("Tukey α = %s: the figure agrees with the text for EVERY pair", (alpha) => {
    for (const shift of [0, 1.3, 2.5]) {
      const g = [r(1, 5), r(1, 5).map((x) => x + 1 + shift), r(1, 5).map((x) => x + 2), r(1, 5).map((x) => x + 4)];
      const t = tukeyHSD(g, alpha) as TukeyResult;
      const f = bracketedBoxPlot(boxes(g), { title: "T", ylabel: "value" }, { kind: "tukey", result: t }, { label: "stars", hideNs: false, tall: true });
      expect(f.ok).toBe(true);
      if (!f.ok) return;
      const drawn = drawnLabels(f.svg);
      for (const pr of t.pairs) {
        const lab = drawn.get(`${pr.i}-${pr.j}`);
        expect(lab).toBeDefined();
        expect(lab === "ns").toBe(!pr.significant);
      }
    }
  });

  test("Tukey α = 0.10: a significant pair with 0.05 ≤ p < 0.10 is marked, and the legend names that mark's bound", () => {
    const g = [r(1, 5), r(1, 5).map((x) => x + 2.3), r(1, 5).map((x) => x + 2)];
    const t = tukeyHSD(g, 0.1) as TukeyResult;
    const pr = t.pairs.find((p) => p.i === 0 && p.j === 1)!;
    expect(pr.p).toBeGreaterThan(0.05);
    expect(pr.p).toBeLessThan(0.1);
    expect(pr.significant).toBe(true);
    const f = bracketedBoxPlot(boxes(g), { title: "T", ylabel: "value" }, { kind: "tukey", result: t }, { label: "stars", hideNs: false, tall: false });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    const lab = drawnLabels(f.svg).get("0-1")!;
    expect(lab).not.toBe("ns");
    // Every mark keeps its standard reading: "*" still means p < 0.05.
    expect(lab).not.toContain("*");
    expect(f.caption).toContain(`${lab} p < 0.1`);
    expect(f.caption).toContain("ns p ≥ 0.1");
  });

  test("the legend states α (α = 0.01: ** is the weakest mark, ns p ≥ 0.01)", () => {
    const t = tukeyHSD(G4, 0.01) as TukeyResult;
    const leg = bracketLegend(bracketsFromTukey(t));
    expect(leg).toContain("ns p ≥ 0.01");
    expect(leg).toContain("** p < 0.01");
    expect(leg).not.toContain("* p < 0.05");
  });

  test("Dunn: a result whose significant flags were made at another α is refused", () => {
    const d = dunnTest(G4, "holm", 0.05);
    const edited = { ...d, comparisons: d.comparisons.map((c) => ({ ...c, significant: !c.significant })) };
    expect(() => bracketsFromDunn(edited, 4, "holm")).toThrow(/significan/);
    // and the genuine one follows its own flags
    const set = bracketsFromDunn(d, 4, "holm");
    const plan = planBrackets(set, 4, xOf, { showNs: false });
    expect(plan.items.length).toBe(d.comparisons.filter((c) => c.significant).length);
  });

  test("α = 0.05 output is byte-identical to before the fix (captions and SVG)", () => {
    // Less the title mark (data-figure-title, item 2), the only other deliberate byte change.
    const hash = (s: string) => createHash("sha256").update(s.split(' data-figure-title=\\"1\\"').join("")).digest("hex").slice(0, 16);
    const groups = boxes(G4);
    const got: string[] = [];
    for (const choice of [
      { label: "stars" as const, hideNs: false, tall: false },
      { label: "p" as const, hideNs: false, tall: false },
      { label: "stars" as const, hideNs: true, tall: false },
    ]) {
      const t5 = tukeyHSD(G4, 0.05)!;
      got.push(hash(JSON.stringify(bracketedBoxPlot(groups, { title: "T", ylabel: "value" }, { kind: "tukey", result: t5 }, choice))));
      const tt = twoSampleTTest([1, 2, 3, 4], [3, 5, 6, 8]);
      got.push(hash(JSON.stringify(bracketedBoxPlot(groups.slice(0, 2), { title: "T", ylabel: "value" }, { kind: "t", result: tt }, choice))));
      const mw = mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
      got.push(hash(JSON.stringify(bracketedBoxPlot(groups.slice(0, 2), { title: "T", ylabel: "value" }, { kind: "mann-whitney", result: mw }, choice))));
      const d = dunnTest(G4, "holm");
      got.push(hash(JSON.stringify(bracketedBoxPlot(groups, { title: "T", ylabel: "value" }, { kind: "dunn", result: d, k: 4, correction: "holm" }, choice))));
    }
    // Recorded from the shipped (pre-fix) code.
    expect(got).toEqual([
      "90c244264dcc2e9f", "d8cb78a7e2df9d1b", "1d43bfc653328710", "c3f353d59a14086e",
      "4968de460b47e543", "3652d32eceec7f34", "59754492a2c52f06", "7df73bf44e37af79",
      "fb1c2afcfa40b3ca", "9f883b6f82338bfe", "1d43bfc653328710", "93f9950bdad608ca",
    ]);
  });
});

describe("bracketsFromTukey checks the result against itself (item 6)", () => {
  const t = tukeyHSD(G4, 0.05) as TukeyResult;
  const edit = (f: (p: TukeyResult["pairs"][number]) => Partial<TukeyResult["pairs"][number]>): TukeyResult => ({
    ...t,
    pairs: t.pairs.map((p) => ({ ...p, ...f(p) })),
  });

  test("the genuine result is accepted", () => {
    expect(bracketsFromTukey(t).brackets.length).toBe(6);
  });
  test("every p edited to 0.00001 is refused", () => {
    expect(() => bracketsFromTukey(edit(() => ({ p: 0.00001 })))).toThrow(RangeError);
  });
  test("one p edited is refused", () => {
    const one: TukeyResult = { ...t, pairs: t.pairs.map((p, k) => (k === 2 ? { ...p, p: p.p / 10 } : p)) };
    expect(() => bracketsFromTukey(one)).toThrow(/not the studentized-range p of its own q/);
  });
  test("a flipped significant flag is refused", () => {
    expect(() => bracketsFromTukey(edit((p) => ({ significant: !p.significant })))).toThrow(RangeError);
  });
  test("an edited α (so the flags no longer match the critical value) is refused", () => {
    expect(() => bracketsFromTukey({ ...t, alpha: 0.01 })).toThrow(RangeError);
  });
  test("q and p edited together, consistently, still disagree with the confidence interval", () => {
    expect(() =>
      bracketsFromTukey(
        edit((p) => {
          const q = p.q * 3;
          return { q, p: require("../tukey").studentizedRangeP(q, t.k, t.dfWithin), significant: q > t.qCritical };
        }),
      ),
    ).toThrow(RangeError);
  });
});

describe("a bracket refusal names a remedy that can work", () => {
  test("6-group Tukey that cannot fit even 1.5× tall does not say 'taller'", () => {
    const six = Array.from({ length: 6 }, (_, k) => r(1, 5).map((x) => x + k * 3));
    const t6 = tukeyHSD(six, 0.05) as TukeyResult;
    for (const tall of [false, true]) {
      const f = bracketedBoxPlot(boxes(six), { title: "T", ylabel: "value" }, { kind: "tukey", result: t6 }, { label: "p", hideNs: false, tall });
      expect(f.ok).toBe(false);
      if (f.ok) return;
      // Taller ALONE never fits here, so it is never offered alone. (Since the
      // second review every remedy is render-checked: with "Hide ns" too it
      // does fit, and that combination is now named — and verified below.)
      expect(f.error).not.toMatch(/tick "Taller figure"(?! and)/);
      if (/tick both "Taller figure" and "Hide ns"/.test(f.error)) {
        expect(bracketedBoxPlot(boxes(six), { title: "T", ylabel: "value" }, { kind: "tukey", result: t6 }, { label: "p", hideNs: true, tall: true }).ok).toBe(true);
      }
      expect(f.error).toMatch(/Hide ns|fewer|wider/);
    }
  });
});
