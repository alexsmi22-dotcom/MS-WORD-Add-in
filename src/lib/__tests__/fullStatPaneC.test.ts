/**
 * "Fully inclusive" (2026-10-28), Stats pane part C: the plain-language readings of iv-2sls, game-nash, macro-solow,
 * macro-islm and macro-taylor (lib/statPaneModelReadings.ts wrappers around ivCalcs.ts and gameMacroCalcs.ts).
 */
import type { StatOutput } from "../analyzeBlocks";
import { readingProblems } from "../calcReading";
import { iv2slsCalc, IV_2SLS_DEFAULTS } from "../ivCalcs";
import {
  gameNashCalc,
  GAME_NASH_DEFAULTS,
  macroIslmCalc,
  MACRO_ISLM_DEFAULTS,
  macroSolowCalc,
  MACRO_SOLOW_DEFAULTS,
  macroTaylorCalc,
  MACRO_TAYLOR_DEFAULTS,
} from "../gameMacroCalcs";
import {
  gameNashWithReading,
  iv2slsWithReading,
  macroIslmWithReading,
  macroSolowWithReading,
  macroTaylorWithReading,
} from "../statPaneModelReadings";

type Calc = (read: (k: string) => string) => StatOutput;
const reader = (d: Record<string, string>, over: Record<string, string> = {}) => (k: string): string => over[k] ?? d[k] ?? "";

/** Every number in the reading appears, formatted the same, in the text or a table (cells, labels, notes). */
function numbersMissing(o: StatOutput): string[] {
  const hay = [o.text, ...(o.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n");
  const toks = (o.reading ?? "").match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return toks.map((t) => t.replace(/,$/, "")).filter((t) => !hay.includes(t));
}

const CALCS: [string, Calc, Calc, Record<string, string>][] = [
  ["iv-2sls", iv2slsWithReading, iv2slsCalc, IV_2SLS_DEFAULTS],
  ["game-nash", gameNashWithReading, gameNashCalc, GAME_NASH_DEFAULTS],
  ["macro-solow", macroSolowWithReading, macroSolowCalc, MACRO_SOLOW_DEFAULTS],
  ["macro-islm", macroIslmWithReading, macroIslmCalc, MACRO_ISLM_DEFAULTS],
  ["macro-taylor", macroTaylorWithReading, macroTaylorCalc, MACRO_TAYLOR_DEFAULTS],
];

/** Input sets per calculator, one per wording branch; each must give a reading that keeps every rule. */
const BRANCHES: Record<string, [string, Record<string, string>, RegExp][]> = {
  "iv-2sls": [
    ["default: significant, strong instruments", {}, /clearly different from zero\. The instruments pass the usual strength check/],
    ["not significant", { instruments: "sibs" }, /not clearly different from zero/],
    ["two instrumented regressors, weak", { spec: "lwage", endog: "educ + exper", instruments: "dist + sibs" }, /estimated effects .*below the rule-of-thumb 10, so the instruments are weak and the estimates/],
    ["classical SEs, t statistics", { se: "classical", small: "t" }, /estimated effect of a one-unit rise in educ/],
  ],
  "game-nash": [
    ["several equilibria", {}, /there are 3 equilibria \(2 pure, 1 mixed\).*Concert with Concert and Stadium with Stadium/],
    ["one pure (prisoner's dilemma)", { row: "R\\C\tC\tD\nC\t3\t0\nD\t5\t1", col: "R\\C\tC\tD\nC\t3\t5\nD\t0\t1" }, /the only equilibrium is D for the row player and D for the column player, paying 1 and 1/],
    ["one mixed (matching pennies)", { row: "R\\C\tH\tT\nH\t1\t-1\nT\t-1\t1", col: "R\\C\tH\tT\nH\t-1\t1\nT\t1\t-1" }, /only equilibrium is mixed/],
    ["degenerate: the search found", { row: "R\\C\tA\tB\nA\t1\t1\nB\t1\t1", col: "R\\C\tA\tB\nA\t1\t1\nB\t1\t1" }, /the search found 4 equilibria/],
  ],
  "macro-solow": [
    ["below the golden rule, rising", {}, /rises from 1\.0000 toward a steady state of 5\.0743.*below the golden-rule rate of 0\.3000/],
    ["above the golden rule, falling", { s: "40%", k0: "20" }, /falls from 20\.0000 .*above the golden-rule rate/],
    ["at the golden rule", { s: "0.3" }, /at the golden-rule rate of 0\.3000/],
  ],
  "macro-islm": [
    ["fiscal expansion: crowding out", {}, /raises output by 100 to 1,900 and pushes the rate up to 7%, crowding out investment/],
    ["no policy: multipliers", { dG: "0" }, /raise output by 2 once crowding out is counted \(4 without it\)/],
    ["monetary expansion: crowding in", { dG: "0", dM: "100" }, /brings the rate down to 5%, and investment rises by 25/],
    ["tax rise: output falls", { dG: "0", dT: "30" }, /changes output by −45 to 1,755/],
    // R6 #13: output RETURNS to full employment; 1.2 is the long-run price level before the policy.
    ["vertical AS", { as: "vertical", Yf: "1700" }, /In the long run output returns to full employment \(1,700\); the price level rises from 1\.2 \(long run, before the policy\) to 1\.5\./],
    ["vertical AS with no long-run solution", { as: "vertical", Yf: "1000" }, /long-run part is not shown/],
  ],
  "macro-taylor": [
    ["tight", {}, /policy rate of 6%, with inflation above target and output above potential\. That is a real rate of 3%, above the neutral 2%/],
    ["loose", { pi: "1", gap: "-3" }, /below the neutral 2%, so policy is looser/],
    ["neutral", { pi: "2", gap: "0" }, /inflation on target and output at potential.*a neutral stance/],
    ["lower bound binds", { pi: "-1", gap: "-6", floor: "0.25" }, /the rule gives −3\.5%, but the lower bound sets the policy rate at 0\.25%/],
    ["series", { series: "Period Inflation Gap\n2020Q1 1.5 -2\n2020Q2 0.5 -8\n2020Q3 2 -1", floor: "0" }, /over 3 periods.*2\.25% in 2020Q1 and 3\.5% in 2020Q3; the lower bound binds in 1 of them/],
  ],
};

describe.each(CALCS)("%s", (id, withReading, base, defaults) => {
  test("the defaults carry a reading that keeps the rules", () => {
    const o = withReading(reader(defaults));
    expect(readingProblems(o.reading)).toEqual([]);
  });

  test("text, tables and figure are the calculator's own, unchanged", () => {
    const o = withReading(reader(defaults));
    const b = base(reader(defaults));
    expect(o.text).toBe(b.text);
    expect(o.tables).toEqual(b.tables);
    // Each figure numbers its clip paths per call (plotclip1, plotclip2…); everything else is identical.
    const norm = (s: string | undefined): string => (s ?? "").replace(/plotclip\d+/g, "plotclip");
    expect(norm(o.svg)).toBe(norm(b.svg));
    expect(o.svg).toMatch(/^<svg[\s>]/);
  });

  test.each(BRANCHES[id])("%s", (_name, over, wording) => {
    const o = withReading(reader(defaults, over));
    expect(o.ok).not.toBe(false);
    expect(readingProblems(o.reading)).toEqual([]);
    expect(o.reading).toMatch(wording);
    expect(numbersMissing(o)).toEqual([]);
  });

  test("the reading changes with the input", () => {
    const readings = new Set(BRANCHES[id].map(([, over]) => withReading(reader(defaults, over)).reading));
    expect(readings.size).toBe(BRANCHES[id].length);
  });
});

test("a refusal carries no reading", () => {
  expect(iv2slsWithReading(reader(IV_2SLS_DEFAULTS, { endog: "nosuch" })).reading).toBeUndefined();
  expect(gameNashWithReading(reader(GAME_NASH_DEFAULTS, { row: "x" })).reading).toBeUndefined();
  expect(macroSolowWithReading(reader(MACRO_SOLOW_DEFAULTS, { alpha: "2" })).reading).toBeUndefined();
  expect(macroIslmWithReading(reader(MACRO_ISLM_DEFAULTS, { c: "abc" })).reading).toBeUndefined();
  expect(macroTaylorWithReading(reader(MACRO_TAYLOR_DEFAULTS, { aPi: "-1" })).reading).toBeUndefined();
});
