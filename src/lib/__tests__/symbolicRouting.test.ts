/**
 * v2.136.0 routing — not engines. A green polyRoots/radius suite proves
 * nothing about whether the PANE reaches those engines from the phrasings a
 * student types (three Solve features once shipped tested and unreachable).
 * taskpane.ts cannot be imported under jest (Office.js), so the wiring is
 * asserted on the source text, and the decisions it makes are exercised
 * through the SAME lib functions the pane calls.
 */
import * as fs from "fs";
import * as path from "path";
import { normalizeTaskProse, resolveTaskVerb, foldPastedMath } from "../pasteMath";
import { isSeriesOrRadiusRequest, isProseRequest, rootDisplayIsComplex, seriesFailureMessage, solveToTypesetDsl } from "../solveTypeset";
import { solveEquation } from "../solve";
import { tryRadius, radiusSvg } from "../radius";
import { taylorSeries, parseSeriesRequest } from "../analysis";
import { trySum, tryAlgebraVerb } from "../algebraTools";
import { solveWordProblem } from "../wordproblem";
import { tryStatsIntent } from "../statsIntent";
import { PROB_VERB_RE, tryProbability } from "../probability";
import { MARKOV_VERB_RE, tryMarkov } from "../markov";
import { MULTIVAR_VERB_RE } from "../multivar";
import { LP_VERB_RE, isLpInput } from "../lp";
import { LP_WORDS_RE } from "../lpWords";
import { INTERP_VERB_RE } from "../interpolate";
import { SPLINE_VERB_RE } from "../spline";
import { mathToOmml } from "../mathOmml";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

/** The pane's transformVerb guard, copied from its definition (pinned below). */
const transformVerb = (text: string): boolean =>
  /^\s*(?:inverse\s+)?laplace\b|^\s*(?:ℒ|L)\s*\{|^\s*(?:ℒ|L)\s*(?:\^\s*[({]?\s*-\s*1|⁻¹)|^\s*fourier\s+series\b/i.test(text) ||
  MULTIVAR_VERB_RE.test(text) || PROB_VERB_RE.test(text) || MARKOV_VERB_RE.test(text) || LP_VERB_RE.test(text) ||
  isLpInput(text) || LP_WORDS_RE.test(text) || INTERP_VERB_RE.test(text) || SPLINE_VERB_RE.test(text);

describe("the pane source is wired (§E.13, §E.12, §E.8)", () => {
  it("re-solves on the stripped task text when solveEquation comes back unsolved", () => {
    expect(PANE).toMatch(/import \{[^}]*\bresolveTaskVerb\b[^}]*\} from "\.\.\/lib\/pasteMath";/);
    expect(PANE).toMatch(/if \(r && !extracted\) \{\s*const tv = resolveTaskVerb\(text, r\);\s*if \(tv\) \{\s*r = tv\.result;\s*extracted = tv\.text;\s*text = tv\.text;/);
    // …AFTER the extractor and BEFORE the "Read the equation out of the sentence" note.
    const solveAt = PANE.indexOf("let r = solveEquation(text);");
    const resolveAt = PANE.indexOf("const tv = resolveTaskVerb(text, r);");
    const noteAt = PANE.indexOf("Read the equation out of the sentence: ${extracted}");
    expect(solveAt).toBeGreaterThan(0);
    expect(resolveAt).toBeGreaterThan(solveAt);
    expect(noteAt).toBeGreaterThan(resolveAt);
  });
  it("switches series and radius requests to the Derivative kind beside the limit switch, ahead of trySum", () => {
    const lim = PANE.indexOf("The question asks for a LIMIT");
    const ser = PANE.indexOf("if (!transformVerb && isSeriesOrRadiusRequest(taskText)) {");
    const sum = PANE.indexOf("const sum = transformVerb ? null : (trySum(taskText) ?? trySum(text));");
    expect(lim).toBeGreaterThan(0);
    expect(ser).toBeGreaterThan(lim);
    expect(sum).toBeGreaterThan(ser);
  });
  it("the Derivative kind answers radius requests (with the disc) before Taylor series, and draws the Taylor disc", () => {
    const rad = PANE.indexOf("const radiusVerb = tryRadius(normalizeTaskProse(text));");
    const ser = PANE.indexOf("const ser = parseSeriesRequest(normalizeTaskProse(text));");
    expect(rad).toBeGreaterThan(0);
    expect(ser).toBeGreaterThan(rad);
    expect(PANE).toContain("currentSolveSvg = radiusVerb.svg;");
    expect(PANE).toContain("const discSvg = sr.radius ? radiusSvg(sr.radius) : \"\";");
    expect(PANE).toContain("seriesFailureMessage(ser.expr, ser.variable, ser.centre)");
  });
  it("the root typesetting test is token-aware and the old /[i×]/ test is gone", () => {
    expect(PANE).not.toContain("if (/[i×]/.test(root.display)) say(plain);");
    // Review 2026-10-24: complex roots are typeset too; only a multiplicity marker keeps a root as text.
    expect(PANE).toContain("if (/×/.test(root.display)) say(eNotationToText(plain));");
    expect(PANE).toContain("else sayMath(solveToTypesetDsl(plain), eNotationToText(plain));");
  });
  it("the transformVerb guard copied above is still the pane's", () => {
    for (const piece of ["MULTIVAR_VERB_RE.test(text) ||", "PROB_VERB_RE.test(text) ||", "MARKOV_VERB_RE.test(text) ||", "LP_VERB_RE.test(text) ||", "isLpInput(text) ||", "LP_WORDS_RE.test(text) ||", "INTERP_VERB_RE.test(text) ||", "SPLINE_VERB_RE.test(text);"]) {
      expect(PANE).toContain(piece);
    }
  });
  it("taskpane.ts carries no regex lookbehind (a SyntaxError blanks the pane on old WebKit)", () => {
    expect(PANE).not.toMatch(/\(\?<[=!]/);
  });
});

describe("the pop-out canvas (solvedialog.ts) is wired through the SAME functions", () => {
  const DIALOG = fs.readFileSync(path.join(__dirname, "..", "..", "solvedialog", "solvedialog.ts"), "utf8");
  it("imports the shared decision functions rather than copying them", () => {
    expect(DIALOG).toMatch(/import \{[^}]*\bresolveTaskVerb\b[^}]*\} from "\.\.\/lib\/pasteMath";/);
    expect(DIALOG).toMatch(/import \{[^}]*\bisSeriesOrRadiusRequest\b[^}]*\bseriesFailureMessage\b[^}]*\} from "\.\.\/lib\/solveTypeset";/);
    expect(DIALOG).toMatch(/import \{ tryRadius, radiusSvg \} from "\.\.\/lib\/radius";/);
  });
  it("re-solves on the task-stripped text after solveEquation, unless a chip chose the variable", () => {
    const solveAt = DIALOG.indexOf("let r = solveEquation(dialogText, varChoice ?? undefined);");
    const tvAt = DIALOG.indexOf("const tv = resolveTaskVerb(dialogText, r);");
    expect(solveAt).toBeGreaterThan(0);
    expect(tvAt).toBeGreaterThan(solveAt);
    expect(DIALOG).toMatch(/\} else if \(!varChoice\) \{[\s\S]{0,400}const tv = resolveTaskVerb\(dialogText, r\);\s*if \(tv\) \{\s*r = tv\.result;\s*dialogText = tv\.text;/);
  });
  it("answers series/radius in the equation kind (after limits, before trySum) and in the derivative kind", () => {
    const lim = DIALOG.indexOf("const limReq = parseLimitRequest(taskText);");
    const ser = DIALOG.indexOf("if (isSeriesOrRadiusRequest(taskText) && seriesOrRadius(taskText)) return;");
    const sum = DIALOG.indexOf("const sum = trySum(taskText) ?? trySum(folded);");
    expect(lim).toBeGreaterThan(0);
    expect(ser).toBeGreaterThan(lim);
    expect(sum).toBeGreaterThan(ser);
    expect(DIALOG).toContain("if (seriesOrRadius(normalizeTaskProse(folded))) return;");
    // The helper: radius verb first (with its disc), then the series with the
    // Taylor disc, and the reason by name when the series cannot be expanded.
    expect(DIALOG).toMatch(/const rv = tryRadius\(text\);[\s\S]*const ser = parseSeriesRequest\(text\);[\s\S]*radiusSvg\(res\.radius\)[\s\S]*seriesFailureMessage\(ser\.expr, ser\.variable, ser\.centre\)/);
  });
  it("carries no regex lookbehind either", () => {
    expect(DIALOG).not.toMatch(/\(\?<[=!]/);
  });
});

describe("task words are not unknowns (§A finding 7) — through resolveTaskVerb", () => {
  const cases: [string, string, string[]][] = [
    ["solve x^2 - 5x + 6 = 0", "x^2 - 5x + 6 = 0", ["3", "2"]],
    ["solve x^3 + 3x^2 - 4 = 0", "x^3 + 3x^2 - 4 = 0", ["1", "-2 (×2)"]],
    ["find the roots of x^3 - 7x + 6", "x^3 - 7x + 6 = 0", ["2", "1", "-3"]],
    ["exact roots of x^3 - 3x + 1", "x^3 - 3x + 1 = 0", ["2*cos(2*pi/9)", "2*cos(4*pi/9)", "2*cos(8*pi/9)"]],
    ["x^3 - 2 = 0 exactly", "x^3 - 2 = 0", ["cbrt(2)", "-1/2*cbrt(2) - sqrt(3)/2*cbrt(2)*i", "-1/2*cbrt(2) + sqrt(3)/2*cbrt(2)*i"]],
    ["find all roots of x^4 - 5x^2 + 4", "x^4 - 5x^2 + 4 = 0", ["2", "1", "-1", "-2"]],
    ["find the zeros of x^2 - 4", "x^2 - 4 = 0", ["2", "-2"]],
    ["solve x^2 = 4", "x^2 = 4", ["2", "-2"]],
  ];
  it.each(cases)("%s → reads %s", (input, read, roots) => {
    const first = solveEquation(input)!;
    expect(first.method).toBe("unsolved"); // the defect this repairs
    const tv = resolveTaskVerb(input, first)!;
    expect(tv).not.toBeNull();
    expect(tv.text).toBe(read);
    expect(tv.result.roots.map((r) => r.display)).toEqual(roots);
  });
  it.each(["solve = 5", "roots = 3", "solve + x = 2", "solve - x = 2", "solve*x = 2", "solve^2 = 4"])("a variable named after a task word keeps it: %s", (q) => {
    const r = solveEquation(q)!;
    expect(resolveTaskVerb(q, r)).toBeNull();
  });
  it("solve F = m a re-solves without the task word but stays a multi-unknown rearrangement", () => {
    const tv = resolveTaskVerb("solve F = m a", solveEquation("solve F = m a"))!;
    expect(tv.result.method).toBe("unsolved");
    expect(tv.result.unknowns).toEqual(["F", "m", "a"]);
  });
  it("an unknown that is not a task word blocks the re-solve (x + y = 3 stays two unknowns)", () => {
    expect(resolveTaskVerb("x + y = 3", solveEquation("x + y = 3"))).toBeNull();
    expect(resolveTaskVerb("roots of x + y = 3", solveEquation("roots of x + y = 3"))!.result.unknowns).toEqual(["x", "y"]);
  });
  it("nothing earlier in the equation chain claims the task phrasings first", () => {
    for (const [input] of cases) {
      const task = normalizeTaskProse(input);
      expect(transformVerb(input)).toBe(false);
      expect(isSeriesOrRadiusRequest(task)).toBe(false);
      expect(tryStatsIntent(input)).toBeNull();
      expect(trySum(task) ?? trySum(input)).toBeNull();
      expect(tryAlgebraVerb(task) ?? tryAlgebraVerb(input)).toBeNull();
      if (!/[=<>]/.test(input)) expect(solveWordProblem(input)).toBeNull();
    }
  });
});

describe("normalizeTaskProse", () => {
  it.each([
    ["solve x^2 - 5x + 6 = 0", "x^2 - 5x + 6 = 0"],
    ["Solve the equation x^3 = 2", "x^3 = 2"],
    ["find the roots of x^3 - 7x + 6", "x^3 - 7x + 6"],
    ["find all the real roots of the polynomial x^3 - 1", "x^3 - 1"],
    ["exact roots of x^3 - 3x + 1", "x^3 - 3x + 1"],
    ["zeros of x^2 - 9", "x^2 - 9"],
    ["x^3 - 2 = 0 exactly", "x^3 - 2 = 0"],
    ["x^3 - 2 = 0, exactly", "x^3 - 2 = 0"],
    ["solve = 5", "solve = 5"],
    ["roots = 3", "roots = 3"],
    ["Find the sum of 1 to 100", "sum of 1 to 100"],
    ["Evaluate the limit of sin(x)/x as x approaches 0", "limit sin(x)/x as x -> 0"],
  ])("%s → %s", (input, out) => {
    expect(normalizeTaskProse(input)).toBe(out);
  });
});

describe("series and radius phrasings switch (§E.12) — through isSeriesOrRadiusRequest", () => {
  const switching = [
    "taylor 1/(1-x)", "series 1/(1-x)", "taylor series of 1/(1+x^2)", "maclaurin series for exp(x)",
    "radius of convergence of 1/(1-x)", "interval of convergence of sum x^n/n^2", "radius of convergence sum x^n/n",
    "find the radius of convergence of 1/(x^2+4) about 1", "taylor abs(x)",
  ];
  it.each(switching)("%s switches", (q) => {
    const task = normalizeTaskProse(q);
    expect(transformVerb(q)).toBe(false);
    expect(isSeriesOrRadiusRequest(task)).toBe(true);
    expect(isProseRequest(task)).toBe(true); // the preview must not typeset "radiusofconvergence"
  });
  it.each(["series = 5", "x^3 = 2", "taylor = 3", "solve x^2 = 4", "limit sin(x)/x as x -> 0"])("%s does not", (q) => {
    expect(isSeriesOrRadiusRequest(normalizeTaskProse(q))).toBe(false);
  });
  it("the Derivative kind's radius verb answers with R and the disc", () => {
    const v = tryRadius(normalizeTaskProse("find the radius of convergence of 1/(x^2+4) about 1"))!;
    expect(v.lines[0]).toEqual({ text: "R = sqrt(5)", math: true });
    expect(v.svg).toMatch(/^<svg/);
  });
  it("the Taylor branch has a disc to draw (and none for R = ∞)", () => {
    const ser = parseSeriesRequest("taylor 1/(1+x^2)")!;
    const sr = taylorSeries(ser.expr, ser.variable, ser.centre, ser.order)!;
    expect(sr.radiusLine).toContain("R = 1");
    expect(radiusSvg(sr.radius!)).toMatch(/^<svg/);
    expect(radiusSvg(taylorSeries("exp(x)")!.radius!)).toBe("");
  });
  it("a series that cannot be expanded says WHY by name", () => {
    expect(taylorSeries("abs(x)")).toBeNull();
    expect(seriesFailureMessage("abs(x)", "x", 0)).toBe(
      "Couldn't expand abs(x) as a Taylor series about x = 0: abs(…) is not analytic — it has no complex-analytic extension, so no power series represents it.",
    );
    expect(seriesFailureMessage("ln(x)", "x", 0)).toContain("branch point");
    expect(seriesFailureMessage("1/x", "x", 0)).toContain("pole");
    // A table miss is about R, not about the expansion: the generic line stays.
    expect(seriesFailureMessage("floor(x)", "x", 0)).toMatch(/^Couldn't expand that as a series/);
  });
  it.each([
    ["radius of convergence Σ x^n/n", "Σ"], // U+03A3 GREEK CAPITAL SIGMA
    ["radius of convergence ∑ x^n/n", "∑"], // U+2211 N-ARY SUMMATION
  ])("%s survives the fold with the EXACT pasted bytes, without a false note", (pasted, glyph) => {
    const f = foldPastedMath(pasted, { stackedFractions: true, bareStackedPairs: true, extractFromProse: true });
    expect(f.text).toBe(pasted);
    expect(f.text).toContain(glyph);
    expect(f.notes).toEqual([]);
    const v = tryRadius(normalizeTaskProse(f.text))!;
    expect(v.lines[0].text).toBe("R = 1");
    expect(v.lines.map((l) => l.text).join("\n")).toContain("Interval of convergence: [-1, 1)");
  });
  it("∑ outside a convergence request still gets its note", () => {
    expect(foldPastedMath("∑ x = 3").notes.join(" ")).toContain("Σ-sum notation");
  });
});

describe("root typesetting (§E.8)", () => {
  it.each([
    ["2*cos(2*pi/9)", false],
    ["2*sqrt(1234567/3)*cos(acos(-3/2469134*sqrt(3/1234567))/3)", false],
    ["sin(1)", false],
    ["cbrt(2)", false],
    ["i", true],
    ["-i", true],
    ["1 + i", true],
    ["-1/2*cbrt(2) + sqrt(3)/2*cbrt(2)*i", true],
    ["140737488355328i", true],
    ["1 (×4)", true],
  ])("%s → complex/marked: %s", (d, want) => {
    expect(rootDisplayIsComplex(d)).toBe(want);
  });
  it.each([
    ["x = cbrt(2)", "x = root(3, 2)", 1],
    ["x = 2^(1/4)", "x = root(4, 2)", 1],
    ["x = -2^(1/4)", "x = -root(4, 2)", 1],
    ["x = cbrt(4)/2", "x = root(3, 4)/2", 1],
    ["x = cbrt(5/2 + sqrt(1929)/18) + cbrt(5/2 - sqrt(1929)/18)", "x = root(3, 5/2 + sqrt(1929)/18) + root(3, 5/2 - sqrt(1929)/18)", 2],
  ])("%s typesets as %s — a real radical with a degree in Word", (line, dsl, degrees) => {
    expect(solveToTypesetDsl(line)).toBe(dsl);
    const omml = mathToOmml(solveToTypesetDsl(line));
    expect((omml.match(/<m:rad>/g) ?? []).length).toBeGreaterThanOrEqual(degrees);
    expect(omml).not.toContain("cbrt");
  });
  it("the trigonometric and arccos forms typeset without throwing", () => {
    for (const line of ["x = 2*cos(2*pi/9)", "x = 2*sqrt(1234567/3)*cos(acos(-3/2469134*sqrt(3/1234567))/3)", "x = -sqrt(2)/2 + sqrt(sqrt(2) - 1/2)"]) {
      expect(() => mathToOmml(solveToTypesetDsl(line))).not.toThrow();
    }
  });
});

describe("probability and Markov (§C row E) — transformVerb stands aside, figures come back on verb.svg", () => {
  const ci = [
    "confidence interval 95% proportion p = 0 n = 20",
    "95% confidence interval for a proportion with 12 successes out of 40",
    "confidence interval x = 12 n = 40",
    "wilson interval 12 of 40",
    "clopper pearson 12 of 40",
    "exact binomial confidence interval 12 of 40",
  ];
  it.each(ci)("%s is claimed by the probability verb and draws the interval bars", (q) => {
    expect(PROB_VERB_RE.test(q)).toBe(true); // so transformVerb stands aside for the prose switches
    const v = tryProbability(q)!;
    expect(v.title).toContain("confidence interval for a proportion");
    expect(v.svg).toMatch(/^<svg/);
  });
  const P1 = "markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]]";
  it.each([
    `${P1} expected hitting time from 1 to 3`,
    `${P1} probability of reaching 3 before 1 starting from 2`,
    `${P1} mean first passage time`,
    `${P1} expected return time`,
    "markov [[1,0],[0.5,0.5]] expected hitting time from 1 to 2",
  ])("%s answers with the ringed diagram, and ∞ appears in TEXT lines only", (q) => {
    expect(MARKOV_VERB_RE.test(q)).toBe(true);
    const v = tryMarkov(q)!;
    expect(v.svg).toMatch(/^<svg/);
    for (const l of v.lines) if (l.math) expect(l.text).not.toContain("∞");
  });
  it("the unreachable target says ∞ in words", () => {
    const v = tryMarkov("markov [[1,0],[0.5,0.5]] expected hitting time from 1 to 2")!;
    expect(v.lines.map((l) => l.text).join("\n")).toContain("∞ — S2 cannot be reached from S1");
  });
});
