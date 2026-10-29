/**
 * THE FIGURE-STYLE GATE (2026-10-28, "fully inclusive" figure fix). Every Finance and Statistics figure reachable from
 * lib is redrawn through the shared figure context (lib/figContext.ts figureRenderer — the render callback the pane
 * hands to prepareFigure) and inserted under EVERY figure style at EVERY width it offers, exactly as the pane inserts it
 * (insertCapability.prepareFigure). Each must be accepted, and (round 2) LEGIBLE: prepareFigure refuses a fit that
 * runs labels together, off the canvas or under a line (the check:figures layout audit, lib/figureLayoutAudit.ts), and
 * the gate checks again that no accepted figure has a layout defect its fit introduced.
 *
 * WHAT IS COVERED, AND HOW (stated honestly; the corpus is figureGateCases.ts):
 *  - REAL CALCULATORS (105 at round 2): every calculator in the library registries the pane spreads into
 *    FIN_CALCS and STAT_CALCS (read from the pane's own spread lines, so a new registry is covered the day it is
 *    spread), on its defaults (71); the Statistics calculators the pane defines inline but computes in a lib function
 *    (econ-ols … macro-taylor, rmanova, cox, welchanova, gameshowell: 31), on the pane's defaults; and three inline
 *    Finance calculators whose figure comes from a lib function the pane calls (fin-currency through
 *    finCurrencyWithFigure, dmg-prejudgment and dmg-postjudgment through their damagesInterest reports).
 *  - STAND-INS, the other 50 inline calculators that draw: their compute lives in taskpane.ts, which no test can import, so the
 *    gate draws the SHARED BUILDER each one calls (box plots for descriptive/twosample/paired/anova/kruskal/friedman/
 *    assumptions/mannwhitney/wilcoxon; brackets for the t-tests and Tukey; forest for dunnett/tukey; grouped bars for
 *    chigof/chiind/twoway/multcomp; regression diagnostics for regression/multiregress/polyregress; Kaplan–Meier for
 *    survival/logrank; hBar for uncertainty/ear/rate-forms; the power curve; money-over-time for fv/pv/compound/
 *    annuity/perpetuity/gann/cagr; cash-flow ladders for npv/irr/dcf/xirr; bond and option curves for bond/ytm/
 *    bondrisk/bs/greeks/iv; the two-series plot for loan/amort/returns/depr/depr-sl; damages columns for royalty/lost
 *    profits/summary/lost earnings) with representative inputs written here, NOT the pane's own call. A pane-only
 *    layout decision (a label the pane builds, an option it passes) is outside this gate.
 *
 * A case that genuinely cannot meet a style is a NAMED EXCEPTION below with its reason, and the gate pins the set both
 * ways: a new refusal fails, and so does an exception that has started to pass (remove it).
 */
import * as fs from "fs";
import * as path from "path";
import { figureRenderer } from "../figContext";
import { prepareFigure, type FigurePresetChoice } from "../insertCapability";
import type { PresetWidth } from "../figureStyle";
import { introducedLayoutFindings } from "../figureLayoutAudit";
import { CASES, STAT_INLINE_LIB, STAT_INLINE_BUILDERS, FIN_INLINE_BUILDERS } from "./figureGateCases";

const PRESETS: Exclude<FigurePresetChoice, "asdrawn">[] = ["nature", "elsevier", "acs", "cell", "thesis", "uspto"];
const WIDTHS: PresetWidth[] = ["single", "oneAndHalf", "double"];
/** USPTO sheets have no 1.5-column width (figureStyle.ts: oneAndHalf is []); every other style offers all three. */
const offered = (p: string, w: PresetWidth): boolean => !(p === "uspto" && w === "oneAndHalf");

/**
 * Cases that genuinely cannot meet a style, each with its reason. Key: "<case id> <preset>/<width>".
 */
const EXCEPTIONS: Record<string, string> = {
  // The 5-step CRR lattice draws 6 nodes in its widest row, each two 12 px numerals wide ("103.05" over "7.62"): the
  // layout is 394 units wide at its narrowest legible spacing, and 8 pt text in a 75 mm column needs at most 318.
  // It meets every other style and width; the 150 mm thesis width takes it.
  "deriv-crr thesis/single": "a 6-node-wide lattice cannot be drawn narrow enough for 8 pt text in 75 mm",
  // corp-dcf's sensitivity grid is a heat map: its shading carries the value scale, and black-and-white line art has
  // no honest way to draw a continuous shade (USPTO refuses heat maps outright: figureStyle.ts refusedChartKinds).
  // The heat map marks itself (data-chart-kind), so the refusal says so in words (round 2; it listed grey paints).
  "corp-dcf uspto/single": "a heat map's shading cannot be drawn in black-and-white line art (37 CFR 1.84(a)(1))",
  "corp-dcf uspto/double": "a heat map's shading cannot be drawn in black-and-white line art (37 CFR 1.84(a)(1))",
  "corp-dcf (exit multiple, mid-year) uspto/single": "a heat map (as corp-dcf above)",
  "corp-dcf (exit multiple, mid-year) uspto/double": "a heat map (as corp-dcf above)",
  // The default econ-regtable has six terms × three models: six forest panels. At USPTO lettering (3.52 mm) even two
  // to a row they need 272 mm, above the 244 mm sight; fewer terms fit. Every journal style takes it.
  "econ-regtable uspto/single": "six coefficient panels at USPTO lettering need more than the 244 mm sight",
  "econ-regtable uspto/double": "six coefficient panels at USPTO lettering need more than the 244 mm sight",
  // LAYOUT EXCEPTIONS (round 2: the fitted figure is audited). Each is refused naming the labels that would collide.
  // corp-dcf's five sensitivity columns ("g 1.50%" … "g 3.50%") at 8 pt need about 34 mm of headings side by side and
  // the 75 mm thesis column leaves 30 mm after the row labels; turning them upright leaves no height for the grid at
  // this aspect. The 112.5 and 150 mm thesis widths take it, as does every journal style.
  "corp-dcf thesis/single": "five sensitivity-column headings do not fit side by side in a 75 mm column at 8 pt",
  // econ-mlogit draws one coefficient panel per outcome, two to a row on the USPTO sight; at USPTO lettering (lowercase
  // 3.5 mm) a panel's two category names ("income", "age") need more than its 13 mm per category. The table carries the
  // same intervals; every journal style takes the figure.
  "econ-mlogit uspto/single": "two category names per half-width panel do not fit at USPTO lettering",
  "econ-mlogit uspto/double": "two category names per half-width panel do not fit at USPTO lettering",
  // CATEGORY AXES ARE NEVER THINNED (a category dropped to make room is a figure that no longer says what it shows).
  // econ-heckman: the selection and outcome panels side by side, five covariate names per panel at USPTO lettering.
  "econ-heckman uspto/single": "five covariate names per half-width panel do not fit side by side at USPTO lettering",
  "econ-heckman uspto/double": "five covariate names per half-width panel do not fit side by side at USPTO lettering",
  // panel-dyn-gmm: the estimator names ("Diff. GMM", "Sys. GMM" …) under each coefficient at 8 pt in 75 mm, or at
  // USPTO lettering; the 112.5/150 mm thesis widths and every journal style take it.
  "panel-dyn-gmm thesis/single": "the estimator names do not fit side by side in a 75 mm column at 8 pt",
  "panel-dyn-gmm uspto/single": "the estimator names do not fit side by side at USPTO lettering",
  "panel-dyn-gmm uspto/double": "the estimator names do not fit side by side at USPTO lettering",
  // clin-meta (v2.206.0): the default forest plot draws all 13 BCG trials and three pooled rows; at USPTO lettering
  // (3.5 mm) sixteen rows need about 274 mm, above the 244 mm sight. Fewer studies fit; every journal style takes it.
  "clin-meta uspto/single": "sixteen forest-plot rows at USPTO lettering are taller than the 244 mm sight",
  "clin-meta uspto/double": "sixteen forest-plot rows at USPTO lettering are taller than the 244 mm sight",
  // rmanova: four condition names under the profile plot ("Stick insect", "Kangaroo te…") at 8 pt in 75 mm or at USPTO
  // lettering (round 1 accepted it with the names run together; thinning would name only two of the four).
  "rmanova thesis/single": "four condition names do not fit under the profile plot in a 75 mm column at 8 pt",
  "rmanova uspto/single": "four condition names do not fit under the profile plot at USPTO lettering",
  "rmanova uspto/double": "four condition names do not fit under the profile plot at USPTO lettering",
  // Tukey on four groups with every pair bracketed and labelled with its p: six brackets need 110 px above the data,
  // more than 60% of the plot at a single column (and on the USPTO sight, where the lettering fills the plot). The
  // bracket builder refuses BY NAME with the remedy ("tick Taller figure or Hide ns"), and with that remedy the same
  // figure meets every style and width ("brackets: tukey, p values, taller with ns hidden" above).
  ...Object.fromEntries(
    ["nature/single", "elsevier/single", "acs/single", "cell/single", "thesis/single", "thesis/oneAndHalf", "uspto/single", "uspto/double"].map((k) => [
      `brackets: tukey, p values ${k}`,
      "six p-value brackets do not fit a single-column plot; refused by name with the remedy, which passes",
    ]),
  ),
};

describe("every Finance and Statistics figure meets every figure style at every width", () => {
  const failures = new Map<string, string>();
  /** Accepted inserts whose fit introduced a layout defect (labels overlapping, run off, struck through). */
  const dirty = new Map<string, string>();
  let accepted = 0;
  let total = 0;
  const drewNothing: string[] = [];
  /** The slowest style insert (its re-renders included), reported for the integrator: a style re-runs the calculator. */
  let slowest = { id: "", ms: 0 };
  beforeAll(() => {
    for (const c of CASES) {
      let svg: string | undefined;
      try {
        svg = c.draw();
      } catch {
        svg = undefined;
      }
      if (!svg) {
        drewNothing.push(c.id);
        continue;
      }
      // Style compliance, not time: no re-render budget here (figContext.test.ts checks the budget), because jest on a
      // loaded machine runs the calculators several times slower than the production bundle.
      const render = figureRenderer(c.draw, Number.POSITIVE_INFINITY);
      for (const p of PRESETS)
        for (const w of WIDTHS) {
          if (!offered(p, w)) continue;
          total++;
          const t0 = Date.now();
          const r = prepareFigure({ svg, preset: p, width: w, render });
          const ms = Date.now() - t0;
          if (ms > slowest.ms) slowest = { id: `${c.id} ${p}/${w}`, ms };
          if (r.ok) {
            accepted++;
            const bad = introducedLayoutFindings(svg, r.svg);
            if (bad.length) dirty.set(`${c.id} ${p}/${w}`, bad.map((f) => f.line).join(" | "));
          } else failures.set(`${c.id} ${p}/${w}`, `${r.reason}: ${r.problems.join("; ")}`);
        }
    }
  });

  test("the corpus is the whole surface: every inline family draws, and the spread calculators that draw nothing are the known ones", () => {
    const inline = new Set([...STAT_INLINE_LIB, ...STAT_INLINE_BUILDERS, ...FIN_INLINE_BUILDERS].map((c) => c.id));
    expect(drewNothing.filter((id) => inline.has(id))).toEqual([]);
    // Every spread calculator draws on its defaults (a figure that silently stops drawing would leave the gate).
    expect(drewNothing).toEqual([]);
    expect(total).toBeGreaterThan(2000);
  });

  test("no refusal outside the named exceptions", () => {
    const unexpected = [...failures.entries()].filter(([k]) => !(k in EXCEPTIONS)).map(([k, v]) => `${k}: ${v.slice(0, 300)}`);
    if (process.env.FIG_GATE_OUT) {
      const head = `accepted ${accepted}/${total}; refused ${failures.size} (named ${[...failures.keys()].filter((k) => k in EXCEPTIONS).length}); layout-dirty accepted ${dirty.size}; slowest ${slowest.id} ${slowest.ms} ms; drew nothing: ${drewNothing.join(", ")}`;
      const named = [...failures.entries()].filter(([k]) => k in EXCEPTIONS).map(([k, v]) => `NAMED ${k}: ${v.slice(0, 300)}`);
      const dirt = [...dirty.entries()].map(([k, v]) => `DIRTY ${k}: ${v.slice(0, 400)}`);
      fs.writeFileSync(process.env.FIG_GATE_OUT, [head, ...unexpected, ...named, ...dirt].join("\n"));
    }
    expect(unexpected).toEqual([]);
  });

  test("every named exception is still refused (an exception that passes must be removed)", () => {
    expect(Object.keys(EXCEPTIONS).filter((k) => !failures.has(k))).toEqual([]);
  });

  test("every accepted figure is legible: no layout defect introduced by its fit (round 2)", () => {
    expect([...dirty.entries()].map(([k, v]) => `${k}: ${v.slice(0, 200)}`)).toEqual([]);
  });

  test("refusals are in the user's words: the heat map says so, a fixed-width layout says what to do", () => {
    expect(failures.get("corp-dcf uspto/single")).toMatch(/cannot draw a heat map/);
    const crr = failures.get("deriv-crr thesis/single") ?? "";
    expect(crr).toMatch(/fixed width/);
    expect(crr).not.toMatch(/builder|ignored the requested/);
    for (const v of failures.values()) expect(v).not.toMatch(/COLLISION|CLIPPED|STRIKETHROUGH|px²/);
  });
});
