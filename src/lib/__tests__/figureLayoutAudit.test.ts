/**
 * The product's copy of the layout audit (lib/figureLayoutAudit.ts, run by prepareFigure on every styled insert) must
 * report EXACTLY what the QC gate's copy (scripts/figure-layout-audit.js) reports: the same findings, in the same order,
 * with the same text, over the whole as-drawn corpus the gate audits and over figures redrawn narrow and in black and
 * white (where the findings are).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { auditLayout, introducedLayoutFindings, findingSentence } from "../figureLayoutAudit";
import { withFigCtx } from "../figContext";
import { buildPlotSvg } from "../plot";
import { hBarSvg } from "../mechchart";
import { groupedBarSvg, boxPlotSvg } from "../statchart";

const script = require("../../../scripts/figure-layout-audit.js") as { auditSvg: (name: string, svg: string) => { found: string[] } };

describe("figureLayoutAudit is the QC gate's audit", () => {
  test("identical findings over the whole check:figures corpus", () => {
    const { figures } = require("../../../scripts/figure-layout-run.ts") as { figures: [string, string][] };
    expect(figures.length).toBeGreaterThan(900);
    const diff: string[] = [];
    for (const [name, svg] of figures) {
      const a = script.auditSvg(name, svg).found;
      const b = auditLayout(svg).map((f) => f.line);
      if (JSON.stringify(a) !== JSON.stringify(b)) diff.push(name);
    }
    expect(diff).toEqual([]);
  }, 240000);

  test("identical findings on crowded, narrow and black-and-white redraws", () => {
    const svgs: string[] = [];
    const years = Array.from({ length: 12 }, (_, i) => ({ x: 2020 + i, y: 1000 * i }));
    for (const w of [120, 160, 220, 400])
      for (const bw of [false, true]) {
        withFigCtx({ width: w, bw }, () => {
          svgs.push(buildPlotSvg([{ type: "line", points: years, label: "a very long legend label that will not fit the column" }], { title: "A long title that runs well past a narrow canvas", xlabel: "year", ylabel: "amount" }));
          svgs.push(hBarSvg([{ name: "Interest coverage ratio (EBIT/interest)", value: 3 }, { name: "Interest coverage ratio (EBITDA/interest)", value: 4 }], { title: "t", unit: "" }));
          svgs.push(groupedBarSvg(["strongly agree", "agree", "neutral", "disagree", "strongly disagree"], [{ label: "obs", values: [1, 2, 3, 4, 5] }], { title: "x" }));
          svgs.push(boxPlotSvg([{ label: "a long group name", values: [1, 2, 3] }, { label: "another long group name", values: [2, 3, 4] }], { title: "b" }));
        });
      }
    let findings = 0;
    for (const svg of svgs) {
      const a = script.auditSvg("x", svg).found;
      const b = auditLayout(svg).map((f) => f.line);
      findings += a.length;
      expect(b).toEqual(a);
    }
    // The set is only a test of parity if it HAS findings.
    expect(findings).toBeGreaterThan(0);
  });

  test("introduced findings: a defect the figure already has as drawn is not the style's", () => {
    const bad = '<svg width="200" height="100"><g font-size="10"><text x="50" y="50">overlapping</text><text x="52" y="52">overlapping</text></g></svg>';
    const worse = '<svg width="200" height="100"><g font-size="10"><text x="50" y="50">overlapping</text><text x="52" y="52">overlapping</text><text x="190" y="80">off the edge</text></g></svg>';
    expect(introducedLayoutFindings(bad, bad)).toEqual([]);
    const got = introducedLayoutFindings(bad, worse);
    expect(got.map((f) => f.kind)).toEqual(["CLIPPED"]);
    expect(findingSentence(got[0])).toBe("the label “off the edge” runs off the edge of the figure");
  });
});
