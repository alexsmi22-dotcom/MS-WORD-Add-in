/**
 * Routing, not engine (student pack, release A): the Solve pane must REACH the
 * significant-figures and Monte Carlo verbs, and they must take nothing that
 * another Solve kind or verb owns.
 *
 * taskpane.ts is not edited in this branch: the exact edits are in
 * INTEGRATION.md. This file holds the same edits (PANE_EDITS), proves each
 * one's anchor occurs exactly once in today's pane, APPLIES them to the pane
 * text in memory, and re-runs every chain/guard/order pin the existing routing
 * tests make (probability, interp/spline, LP, symbolic, algebra, chemistry)
 * against the patched text — so the integration cannot break them. Once the
 * edits are applied for real, the same assertions run against the real pane.
 *
 * Both directions of stealing are tested: no earlier switch or verb claims the
 * pack's phrases (on the raw input AND on the folded text the chain sees), and
 * the pack's decision claims none of the string literals in the other routing
 * test files.
 */
import * as fs from "fs";
import * as path from "path";
import { studentPackVerb, isStudentPackRequest } from "../studentPack";
import { foldPastedMath, normalizeTaskProse, hasProseWords } from "../pasteMath";
import { algebraKindFor } from "../algebraSwitch";
import { computationKindFor } from "../ctSwitch";
import { chemistryKindFor } from "../balance";
import { tryStatsIntent } from "../statsIntent";
import { trySum, tryAlgebraVerb } from "../algebraTools";
import { isSeriesOrRadiusRequest } from "../solveTypeset";
import { parseLimitRequest } from "../analysis";
import { PROB_VERB_RE, tryProbability } from "../probability";
import { MARKOV_VERB_RE, tryMarkov } from "../markov";
import { MULTIVAR_VERB_RE, tryMultivar } from "../multivar";
import { LP_VERB_RE, isLpInput, tryLp } from "../lp";
import { LP_WORDS_RE, tryLpWords } from "../lpWords";
import { INTERP_VERB_RE, tryInterpolate } from "../interpolate";
import { SPLINE_VERB_RE, trySpline } from "../spline";
import { tryLaplace } from "../laplace";
import { tryFourierSeries } from "../fourier";
import { tryComplex } from "../complexAlgebra";
import { solveWordProblem } from "../wordproblem";

const ROOT = path.join(__dirname, "..", "..", "..");
const PANE = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");
// INTEGRATION.md is a hand-off file: once the edits are merged it may be
// deleted, and the pane pins below must then stand on their own.
const INTEGRATION_PATH = path.join(ROOT, "INTEGRATION.md");
const INTEGRATION = fs.existsSync(INTEGRATION_PATH) ? fs.readFileSync(INTEGRATION_PATH, "utf8") : null;

/** The exact edits INTEGRATION.md asks for, in order. */
export const PANE_EDITS: { name: string; old: string; new: string }[] = [
  {
    name: "import",
    old: 'import { tryLaplace, solveIvpLaplace, hasInitialConditions } from "../lib/laplace";',
    new: 'import { tryLaplace, solveIvpLaplace, hasInitialConditions } from "../lib/laplace";\nimport { studentPackVerb } from "../lib/studentPack";',
  },
  {
    name: "decide once on the raw input; no fold notes when it answers",
    old: '  solvePasteNoteEl.textContent = text ? folded.notes.filter((n) => !(PROB_VERB_RE.test(text) && /^Greek letters read as variables/.test(n))).join(" ") : "";',
    new:
      "  // STUDENT PACK (significant figures, Monte Carlo): decided ONCE, on the RAW\n" +
      '  // input — the fold drops the "." of "1200." (four figures → an ambiguous two)\n' +
      '  // and notes "± means two expressions" — so when it answers, none of the\n' +
      "  // fold's notes describe what was read. One decision function, shared with\n" +
      "  // the tests (studentPack.ts; studentPackRouting.test.ts).\n" +
      '  const studentVerb = kind === "equation" ? studentPackVerb(solveInput.value) : null;\n' +
      '  solvePasteNoteEl.textContent = text && !studentVerb ? folded.notes.filter((n) => !(PROB_VERB_RE.test(text) && /^Greek letters read as variables/.test(n))).join(" ") : "";',
  },
  {
    name: "transformVerb stands the prose switches aside",
    old: "      const transformVerb =\n        /^\\s*(?:inverse\\s+)?laplace\\b",
    new: "      const transformVerb =\n        studentVerb !== null ||\n        /^\\s*(?:inverse\\s+)?laplace\\b",
  },
  {
    name: "offered at the end of the verb chain",
    old: "        tryAlgebraVerb(taskText) ??\n        tryAlgebraVerb(text);\n      if (verb) {",
    new:
      "        tryAlgebraVerb(taskText) ??\n        tryAlgebraVerb(text) ??\n" +
      "        // The student pack (sig figs, Monte Carlo), decided above on the RAW\n" +
      "        // input — last, because no verb before it claims those lines.\n" +
      "        studentVerb;\n      if (verb) {",
  },
];

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
const APPLIED = PANE_EDITS.every((e) => PANE.includes(e.new));
const PATCHED = APPLIED ? PANE : PANE_EDITS.reduce((t, e) => t.replace(e.old, () => e.new), PANE);

describe("the edits apply cleanly (and, before they land, INTEGRATION.md carries them verbatim)", () => {
  it.each(PANE_EDITS.map((e) => [e.name, e] as const))("%s", (_n, e) => {
    if (!APPLIED) {
      expect(INTEGRATION).not.toBeNull();
      expect(INTEGRATION).toContain(e.old);
      expect(INTEGRATION).toContain(e.new);
      expect(count(PANE, e.old)).toBe(1);
    }
    expect(count(PATCHED, e.new)).toBe(1);
  });
});

/** The body of a pane function, as chembioRouting.test reads it. */
function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  return src.slice(at, src.indexOf("\nfunction ", at + 10));
}

describe("the patched pane keeps every existing routing pin", () => {
  const P = PATCHED;
  it("probability / interp / LP chain pins (probabilityRouting, interpSplineRouting, lpRouting)", () => {
    expect(P).toMatch(/const verb =\s*tryLp\(text\) \?\?\s*tryLpWords\(text\) \?\?\s*tryInterpolate\(text\) \?\?\s*trySpline\(text\) \?\?\s*tryMarkov\(text\) \?\?\s*tryProbability\(text\) \?\?\s*tryProbability\(taskText\) \?\?\s*tryMultivar\(text\)/);
    expect(P).toMatch(/INTERP_VERB_RE\.test\(text\) \|\|\s*SPLINE_VERB_RE\.test\(text\)/);
    expect(P).toMatch(/else if \(verb\.svg\)/);
  });
  it("the transformVerb pieces symbolicRouting copies are all still there", () => {
    for (const piece of ["MULTIVAR_VERB_RE.test(text) ||", "PROB_VERB_RE.test(text) ||", "MARKOV_VERB_RE.test(text) ||", "LP_VERB_RE.test(text) ||", "isLpInput(text) ||", "LP_WORDS_RE.test(text) ||", "INTERP_VERB_RE.test(text) ||", "SPLINE_VERB_RE.test(text);"]) {
      expect(P).toContain(piece);
    }
    expect(P).toContain("const sum = transformVerb ? null : (trySum(taskText) ?? trySum(text));");
    expect(P).toContain("if (!transformVerb && isSeriesOrRadiusRequest(taskText)) {");
    expect(P).not.toMatch(/\(\?<[=!]/); // no lookbehind (old WebKit)
  });
  it("order pins: chemistry before the fold, algebra before transformVerb (chembioRouting, algebraPaneRouting)", () => {
    expect(P).toContain('if (kind === "equation" && !algebraKindFor(solveInput.value) && !computationKindFor(solveInput.value)) {\n    const chemOwner = chemistryKindFor(solveInput.value);');
    const body = fnBody(P, "updateSolve");
    const chem = body.indexOf("const chemOwner = chemistryKindFor(solveInput.value);");
    expect(chem).toBeGreaterThan(0);
    expect(chem).toBeLessThan(body.indexOf("const folded ="));
    const alg = body.indexOf("const algebraOwner = algebraKindFor(solveInput.value);");
    expect(alg).toBeLessThan(body.indexOf("const transformVerb ="));
    expect(alg).toBeLessThan(body.indexOf("const owner = computationKindFor(solveInput.value);"));
    expect(alg).toBeLessThan(body.indexOf("const iq = solveInequality(text);"));
  });
  it("the pack is decided on the RAW input, before transformVerb, and offered last in the chain", () => {
    const body = fnBody(P, "updateSolve");
    const at = body.indexOf('const studentVerb = kind === "equation" ? studentPackVerb(solveInput.value) : null;');
    expect(at).toBeGreaterThan(body.indexOf("const chemOwner = chemistryKindFor(solveInput.value);"));
    expect(at).toBeLessThan(body.indexOf("const transformVerb ="));
    expect(body).toMatch(/const transformVerb =\s*studentVerb !== null \|\|/);
    expect(body).toMatch(/tryAlgebraVerb\(text\) \?\?\s*(?:\/\/[^\n]*\n\s*)*studentVerb;\s*if \(verb\) \{/);
  });
});

// ---------------------------------------------------------------------------
// The pack's phrases reach the pack.
// ---------------------------------------------------------------------------

const SIGFIG = [
  "how many significant figures in 0.00450",
  "How many sig figs are in 1200?",
  "sig figs in 1200.",
  "significant figures of 1.200×10³",
  "how many sig figs in 1.200 x 10^3",
  "count the significant figures in 0.0500",
  "3.40 × 2.1 with sig figs",
  "3.40 * 2.1 sig figs",
  "calculate 12.11 + 18.0 + 1.013 to the correct number of significant figures",
  "(3.0 + 4.12) × 2.000 sig figs",
  "12 eggs × 0.0450 kg with sig figs",
  "round 0.0045678 to 3 sig figs",
  "round 12345 to 2 significant figures",
  "round 3.14159 to 3 s.f.",
  "round 10.0 ± 0.123 to the uncertainty",
  "round 9.87654 +/- 0.0234 to the uncertainty",
  "10.0 ± 0.123 sig figs",
];
const MC = [
  "monte carlo  a*b/c  a = 10.0 ± 0.1, b = 4.00 ± 0.05, c = 2.0 ± 0.1",
  "Monte Carlo: y = a^2 + b, a = 1.0 ± 0.1, b = 2 ± 0.2 samples 5000 seed 3",
  "monte-carlo uncertainty propagation of sqrt(g*h) g = 9.81 ± 0.01; h = 2.0 ± 0.1",
  "propagate uncertainty by monte carlo x*y x = 3 ± 0.2 and y = 4 ± 0.3",
];

/** The equation-kind fold options, as updateSolve builds them for a raw input. */
const fold = (raw: string): string =>
  foldPastedMath(raw.trim(), {
    geometry: false,
    ode: false,
    lp: isLpInput(raw) || LP_WORDS_RE.test(raw),
    stackedFractions: true,
    bareStackedPairs: true,
    extractFromProse: true,
    topology: false,
  }).text.trim();

describe("every pack phrase reaches the pack, and nothing ahead of it claims the line", () => {
  it.each([...SIGFIG, ...MC])("%s", (raw) => {
    const v = studentPackVerb(raw);
    expect(v).not.toBeNull();
    expect(v!.lines.length).toBeGreaterThan(0);
    // The switches the pane runs on the RAW input before the pack's turn.
    expect(algebraKindFor(raw)).toBeNull();
    expect(computationKindFor(raw)).toBeNull();
    expect(chemistryKindFor(raw)).toBeNull();
    // Everything the chain and the prose switches see: the folded text.
    const text = fold(raw);
    const taskText = normalizeTaskProse(text);
    for (const t of [text, taskText]) {
      expect(tryLp(t)).toBeNull();
      expect(tryLpWords(t)).toBeNull();
      expect(tryInterpolate(t)).toBeNull();
      expect(trySpline(t)).toBeNull();
      expect(tryMarkov(t)).toBeNull();
      expect(tryProbability(t)).toBeNull();
      expect(tryMultivar(t)).toBeNull();
      expect(tryLaplace(t)).toBeNull();
      expect(tryFourierSeries(t)).toBeNull();
      expect(tryComplex(t)).toBeNull();
      expect(tryAlgebraVerb(t)).toBeNull();
      // Stood aside by transformVerb anyway — and they would not have claimed it.
      expect(tryStatsIntent(t)).toBeNull();
      expect(trySum(t)).toBeNull();
      expect(isSeriesOrRadiusRequest(t)).toBe(false);
    }
    expect(/\blim(it)?\b/i.test(taskText) && !!parseLimitRequest(taskText)).toBe(false);
    expect(hasProseWords(text) && !/[=<>≤≥≠]/.test(text) && !text.includes("\n") && !!solveWordProblem(text)).toBe(false);
  });
  it("the sig-fig reading needs the RAW input: the fold drops the point of “1200.”", () => {
    expect(fold("sig figs in 1200.")).toBe("sig figs in 1200");
    expect(studentPackVerb("sig figs in 1200.")!.lines[0].text).toBe("1200.: 4 significant figures");
  });
});

// ---------------------------------------------------------------------------
// The pack claims nothing the others own.
// ---------------------------------------------------------------------------

const LEFT_ALONE = [
  "x^2 - 5x + 6 = 0",
  "solve 2x + 3 = 7",
  "E = mc^2",
  "F = m a\nm = 3 kg\na = 2 m/s^2",
  "solve x^2 = 2 to 3 significant figures", // an equation with a precision request: the solver's
  "mean of 3, 5, 8",
  "x = 10 ± 0.5",
  "10.0 ± 0.123",
  "a = 10 ± 0.1\nb = 20 ± 0.2",
  "uncertainty a*b/c",
  "round(2.5)",
  "derivative of x^2",
  "integral of sin(x) from 0 to pi",
  "limit of sin(x)/x as x -> 0",
  "binomial n=10 p=0.4 P(X <= 3)",
  "Fe2O3 + 3CO -> 2Fe + 3CO2",
];

/** Every string literal in the other Solve routing tests — their corpora. */
function corpusLiterals(): string[] {
  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /(?:Routing|routing\.adversarial|statsIntent|simplifyVerb|wordproblem|proportionCi|solve\.adversarial|solveBaseline|pasteMath)\.test\.ts$/.test(f) && f !== "studentPackRouting.test.ts");
  const out = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/"((?:[^"\\\n]|\\.){4,})"/g)) {
      try {
        out.add(JSON.parse(`"${m[1]}"`));
      } catch {
        /* not a JSON-compatible literal */
      }
    }
  }
  return [...out];
}

describe("the pack claims nothing the other kinds own", () => {
  it.each(LEFT_ALONE)("%s is left alone", (q) => {
    expect(studentPackVerb(q)).toBeNull();
  });
  it("no string literal in the other Solve routing corpora is claimed", () => {
    const lits = corpusLiterals();
    expect(lits.length).toBeGreaterThan(500);
    const claimed = lits.filter((s) => isStudentPackRequest(s) && studentPackVerb(s) !== null);
    expect(claimed).toEqual([]);
  });
  it("the verbs' guards still claim their own lines (nothing in the pack shadows them)", () => {
    expect(PROB_VERB_RE.test("binomial n=10 p=0.4 P(X <= 3)")).toBe(true);
    expect(MARKOV_VERB_RE.test("markov chain [[0.9, 0.1], [0.5, 0.5]] stationary distribution")).toBe(true);
    expect(LP_VERB_RE.test("maximize 3x + 2y subject to x + y <= 4")).toBe(true);
    expect(INTERP_VERB_RE.test("interpolate (1, 2), (2, 3), (4, 7)")).toBe(true);
    expect(SPLINE_VERB_RE.test("natural cubic spline through (0, 0), (1, 1), (2, 0)")).toBe(true);
    expect(MULTIVAR_VERB_RE.test("gradient of x^2 y")).toBe(true);
  });
});
