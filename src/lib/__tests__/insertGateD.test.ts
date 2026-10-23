// Release D, data entry, defect 1: "NaN3"-style names were uninsertable.
//
// BEFORE: the pane's insertableResultText was `!text.includes("NaN") && !text.includes("Infinity")`, a SUBSTRING test,
// so a standard-curve result naming its sodium-azide sample (NaN₃, NaN3) — or sodium nitrate NaNO₃, sodium amide
// NaNH₂ — could never be inserted. The QC drivers used /\bNaN\b/, whose ASCII \b passed NaN3 but blocked NaN₃: three
// gates, three answers. AFTER: one rule, src/lib/insertGate.ts hasBrokenNumber, with a JavaScript copy in each driver;
// this file runs the same table against all three.
import * as fs from "fs";
import * as path from "path";
import { hasBrokenNumber, insertableResultText } from "../insertGate";
import { ASSAY_QUANT_CALCS } from "../assayQuantCalcs";
import { rmAnovaCalc } from "../statsBatchCalcs";

const SCRIPTS = path.join(__dirname, "..", "..", "..", "scripts");
/** The driver's own badNumbers, extracted from its source and evaluated (the drivers are page IIFEs). */
function driverBadNumbers(file: string): (t: string) => boolean {
  const src = fs.readFileSync(path.join(SCRIPTS, file), "utf8");
  const fn = /function badNumbers\(text\) \{[\s\S]*?\n {2}\}/.exec(src);
  if (!fn) throw new Error(`no badNumbers in ${file}`);
  // eslint-disable-next-line no-new-func
  return new Function(`${fn[0]}; return badNumbers;`)() as (t: string) => boolean;
}
const DRIVERS = ["engineering-audit-driver.js", "pane-audit-driver.js"].map((f) => [f, driverBadNumbers(f)] as const);

// [text, broken?] — broken = prints NaN/Infinity/undefined as a value.
const TABLE: Array<[string, boolean]> = [
  // insertable (names and formulas are words)
  ["NaN₃ standard 12.5 µM", false],
  ["NaN₃ 12.5 µM", false],
  ["NaN3 standard 12.5 µM", false],
  ["Ca(NO₃)₂ 0.25 M", false],
  ["NaNO₃ and NaNO₂ blanks", false],
  ["NaNH₂ 1.0 equiv", false],
  ["2NaN₃ → 2Na + 3N₂", false],
  ["NaN₃·3 replicates", false],
  ["Ten NaNs were dropped", false],
  ['rejected "NaN" as a width', false],
  ['"Infinity" is not a number', false],
  ['the cell "undefined" was skipped', false],
  // "undefined" as an English word in ok-result prose (fluids, geometryParse, algebraTools notes)
  ["There is no flow, so there is no head loss. The friction factor is undefined at zero flow.", false],
  ["The line is vertical, so its slope is undefined.", false],
  ["Cancelling a factor can remove points where the ORIGINAL was undefined (0/0)", false],
  ["Called out but undefined: (3), (4)", false],
  ["t(8) = 2.31, p = .049", false],
  // a value with its explanation is a mathematical statement (multivar, probdist)
  ["(1, 0): f = 1, λ = undefined (∇g = 0 here: a singular point of the curve)", false],
  ["mean E[X] = undefined (df ≤ 1)", false],
  ["variance Var(X) = undefined (df2 ≤ 4)", false],
  // review D1: "undefined" followed by ordinary words is a sentence (RM ANOVA, 2 subjects × 4 conditions)
  ["  Huynh–Feldt: undefined at this sample size", false],
  ["Status: undefined behaviour", false],
  ["ε: undefined for fewer than 3 subjects", false],
  ["x = undefined because the variance is zero", false],
  ["p = undefined.", false],
  // review D1 judgement: quotes are blanked per line, so a stray quote never hides a NaN on another line
  ['12" pipe\nvelocity = NaN m/s\nsample "B"', true],
  ['v: "a\nNaN\nb" end', true],
  ['a "quoted NaN" here\nand "Infinity" there', false],
  // blocked (a JavaScript non-number escaped into the text)
  ["x = NaN", true],
  ["mean NaN µM", true],
  ["d = NaN", true],
  ["NaN", true],
  ["Infinity", true],
  ["ratio = Infinity", true],
  ["slope −Infinity", true],
  ["fold change NaN%", true],
  ["(NaN)", true],
  ["undefined", true],
  ["x = undefined", true],
  ["Result: undefined m", true],
  ["a\nundefined µM", true],
  ["Kd ≈ undefined", true],
  ["0.5 ± undefined", true],
  // review D1: "undefined" that ENDS the value (line end, , ; ) ], a number or a unit symbol) is blocked
  ["mean: undefined µM", true],
  ["mean: undefined μM", true],
  ["x = undefined, see note", true],
  ["(x = undefined)", true],
  ["c = undefined mol/L", true],
  ["T = undefined °C", true],
  ["p = undefined mmHg", true],
  ["d = undefined mL", true],
  ["v = undefined 3", true],
  ["μ = undefinedµM", true],
  ["a\n  undefined", true],
  ['"NaN₃": x = NaN', true],
  // fix round eng-9: the formatters' "not finite" (engNum, gasDynamicsCalcs num, ...) is a broken number anywhere
  ["x = not finite", true],
  ["  Range at that angle not finite m", true],
  ["the range is not finite m", true],
  ["Not finite", true],
  ["p₂ = not finite kPa", true],
  ['rejected "not finite" as a width', false],
  ["finite element mesh, not infinite", false],
  ["a cannot-finitely-many case", false],
];

describe("one broken-number rule: the lib helper and both QC drivers agree", () => {
  test.each(TABLE)("%j → broken %s", (text, broken) => {
    expect(hasBrokenNumber(text)).toBe(broken);
    for (const [, fn] of DRIVERS) expect(fn(text)).toBe(broken);
  });

  test("the drivers' self-checks still hold under the shared rule", () => {
    for (const [, fn] of DRIVERS) {
      expect(fn("x = NaN")).toBe(true);
      expect(fn('rejected "NaN" as a width')).toBe(false);
      expect(fn("NaN₃ standard 12.5 µM")).toBe(false);
    }
  });

  test("insertableResultText keeps the em-dash sentinel and the empty-text refusal", () => {
    expect(insertableResultText("")).toBe(false);
    expect(insertableResultText("value = —")).toBe(false);
    expect(insertableResultText("1.5–2.5 µM")).toBe(true);
    expect(insertableResultText("NaN₃ standard 12.5 µM")).toBe(true);
    expect(insertableResultText("mean NaN µM")).toBe(false);
  });

  test("the pane imports the gate instead of keeping its own copy", () => {
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    expect(pane).toMatch(/import \{ insertableResultText \} from "\.\.\/lib\/insertGate";/);
    expect(pane).not.toMatch(/function insertableResultText/);
    // Every registry's insert gate is the shared one (the five call sites plus the Engineering Explore panel's since
    // v2.191.0, Finance's "no solution" kept).
    expect(pane.match(/insertableResultText\(/g)?.length).toBe(6);
    expect(pane).toMatch(/insertableResultText\(text\) && !text\.includes\("no solution"\)/);
  });
});

describe("end to end: a standard-curve result naming NaN₃ inserts", () => {
  const calc = ASSAY_QUANT_CALCS.find((c) => c.id === "stdcurve")!;
  const run = (unk: string) => {
    const vals: Record<string, string> = Object.fromEntries(calc.fields.map((f) => [f.key, f.default]));
    vals.unk = unk;
    return calc.compute((k) => vals[k] ?? "");
  };
  test.each([
    ["NaN₃ standard\t0.412\t0.405\t0.418", "NaN₃ standard"],
    ["NaN₃: 0.412 0.405 0.418", "NaN₃"],
    ["NaN3\t0.412\t0.405\t0.418", "NaN3"],
    ["NaNO₃ blank\t0.231\t0.226\t0.236", "NaNO₃ blank"],
  ])("%j", (unk, name) => {
    const out = run(unk);
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain(name);
    // The old substring gate refused exactly this text; the shared gate (what the pane now calls) accepts it.
    expect(out.text.includes("NaN")).toBe(true);
    expect(insertableResultText(out.text)).toBe(true);
  });
});

describe("review D1: RM ANOVA at 2 subjects × 4 conditions inserts (Huynh–Feldt: undefined at this sample size)", () => {
  test("ok result passes the gate", () => {
    const TAB = String.fromCharCode(9);
    const NL = String.fromCharCode(10);
    const text = ["10.0", "10.5", "10.4", "16.7"].join(TAB) + NL + ["17.5", "13.8", "14.3", "14.3"].join(TAB);
    const out = rmAnovaCalc(text, "none");
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("Huynh–Feldt: undefined at this sample size");
    expect(insertableResultText(out.text)).toBe(true);
  });
});
