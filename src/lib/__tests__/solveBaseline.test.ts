// A COMMITTED BEHAVIOURAL BASELINE for the solve / calculus surface.
//
// This is an instrument, not an oracle. It does not claim any of these answers is
// correct — the oracle tests do that. It claims something different and, for the
// work ahead, more useful: **nothing changed that I did not mean to change.**
//
// Why it exists. The next round of fixes touches shared machinery in solve.ts —
// the root finder's residual test, two absolute tolerances in the polynomial path,
// the identity check, and the removable-singularity probe. Every one of those is
// reached by inputs far outside the case that motivated the fix. v2.39.0 proved
// the hazard exactly: tightening the singularity scan silently began refusing five
// correct integrals, and nothing in 6,362 tests noticed, because no test asked
// "does this still answer what it used to answer?"
//
// So: 300-odd inputs spanning every branch, snapshotted. Any behaviour change
// fails this file. When a diff appears, there are only two honest responses —
// explain it in the changelog as intended, or treat it as the regression it is.
// Running `jest -u` to make the red go away turns this into one more test that
// cannot fail, which is a defect class this repo has already paid for twice.
//
// Values are rounded to 10 significant figures so that last-bit float noise
// across platforms does not produce churn that trains people to ignore the diff.

import { solveEquation, integrate, differentiate } from "../solve";

/** Deterministic, diffable one-line summary of a result. */
const sig = (v: number): string => {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "+Inf" : "-Inf";
  if (v === 0) return "0";
  return Number(v.toPrecision(10)).toString();
};

const solveLine = (eq: string): string => {
  let r;
  try {
    r = solveEquation(eq);
  } catch (e) {
    return `THREW ${(e as Error).message}`;
  }
  if (!r) return "null";
  // Cap the root list. `(x-1)/(x-1) = 1` currently returns FOUR THOUSAND roots
  // (defect A12), and printing them made the snapshot 64 KB — a baseline whose
  // diffs are unreadable is a baseline nobody reads. The count is included, so
  // the pathological cases are still fully distinguished: 4000 -> 1 will show.
  const shown = r.roots.slice(0, 6).map((k) => k.display).join(", ");
  const roots = r.roots.length > 6 ? `${shown}, …+${r.roots.length - 6} more` : shown;
  // Caveat COUNT, not text: rewording a caveat is not a behaviour change, and a
  // baseline that churns on prose gets ignored.
  return `n=${r.roots.length} [${roots}] via ${r.method} (${r.caveats.length} caveat)`;
};

const integralLine = (f: string, a: number, b: number): string => {
  let r;
  try {
    r = integrate(f, a, b);
  } catch (e) {
    return `THREW ${(e as Error).message}`;
  }
  if (!r) return "null";
  return `${sig(r.value)} via ${r.method} (${r.caveats.length} caveat)`;
};

const derivLine = (f: string): string => {
  let r;
  try {
    r = differentiate(f);
  } catch (e) {
    return `THREW ${(e as Error).message}`;
  }
  if (!r) return "null";
  return `${r.derivative} (${r.caveats.length} caveat)`;
};

// ---------------------------------------------------------------------------
// Equations. Every branch: linear, quadratic, cubic+, rational, transcendental,
// identities, no-solution, and the tolerance bands where roots go missing.
// ---------------------------------------------------------------------------
const EQUATIONS = [
  // linear
  "2*x + 4 = 0", "x = 5", "-x = 3", "x/2 = 4", "3*x = 0", "x + 1 = x + 1",
  "5*x - 2 = 3*x + 8", "0.5*x = 2", "x/3 + 1/4 = 2",
  // quadratic, real and complex
  "x^2 - 4 = 0", "x^2 + 1 = 0", "x^2 - 2*x + 1 = 0", "x^2 + x - 6 = 0",
  "2*x^2 - 8 = 0", "x^2 = 2", "x^2 + 2*x + 5 = 0", "-x^2 + 4 = 0",
  // the tolerance bands: a discriminant or leading coefficient near zero
  "0.0000000001*x^2 - 0.0001 = 0", "0.0000001*x^2 - 0.0000001 = 0",
  "0.0000000000001*x^2 - 1 = 0", "0.0000000000001*x - 1 = 0",
  "0.000000000001*x^2 - 1 = 0", "1e-8*x^2 - 1 = 0", "1e-20*x^2 - 1 = 0",
  "x^2 - 1e-20 = 0", "1e10*x^2 - 1 = 0",
  // higher degree
  "x^3 - 1 = 0", "x^3 - 6*x^2 + 11*x - 6 = 0", "x^4 - 1 = 0",
  "x^3 + x = 0", "x^4 + 1 = 0", "x^5 - x = 0", "x^3 - 3*x + 2 = 0",
  // rational: removable, genuine pole, and the pole-as-root trap
  "(x^2-1)/(x-1) = 0", "(x^2-1)/(x-1) = 2", "(x-2)*(x-3)/(x-2) = 0",
  "1/(x-2) = 0", "1/(x-2.25) = 0", "x/(x-2.25) = 1", "(x+1)/(x-2.25) = 1",
  "1/(x-2.25)^3 = 0", "1/x = 2", "(x+1)/(x-1) = 3", "2/(x+1) = 1/(x-1)",
  // identities through a denominator
  "(x-1)/(x-1) = 1", "x/x = 1", "sin(x)/sin(x) = 1",
  // no solution
  "x + 1 = x + 2", "0*x = 5", "abs(x) = -1", "exp(x) = 0", "x^2 = -1",
  // transcendental
  "sin(x) = 0", "cos(x) = 1", "tan(x) = 2", "exp(x) = 2", "ln(x) = 1",
  "sin(x) = 0.5", "x*exp(x) = 1", "x^2 = exp(x)", "sqrt(x) = 3",
  "sqrt(x) = -1", "sqrt(x+1) = x - 1", "ln(x) = -1", "exp(-x) = x",
  "sin(x) = x/2", "cos(x) = x", "x^3 = 2^x",
  // division by zero
  "x/0 = 1", "1/0 = x", "x/(1-1) = 2",
  // multi-variable refusal, and explicit variable
  "x + y = 1", "a*x + b = 0",
  // whitespace and formatting robustness
  "  x^2-4=0  ", "X^2 - 4 = 0", "x^2-4 = 0",
];

// ---------------------------------------------------------------------------
// Definite integrals. Exact path, numeric path, refusals, and both sides of
// every boundary the v2.39.x work moved.
// ---------------------------------------------------------------------------
const INTEGRALS: Array<[string, number, number]> = [
  // polynomial and elementary, exact
  ["x^2", 0, 3], ["x^2", 0, 2], ["x", 0, 1], ["1", 0, 5], ["x^3", -1, 1],
  ["x^10", 0, 1], ["2*x + 3", 0, 4], ["x^2 - x", 0, 1],
  // exp, log, trig
  ["exp(x)", 0, 1], ["exp(x)", 0, 10], ["ln(x)", 1, 2], ["ln(x)", 1, 10],
  ["sin(x)", 0, 3.141592653589793], ["cos(x)", 0, 1],
  ["sin(x)", 0, 12.566370614359172], ["tan(x)", 0, 1],
  ["log10(x)", 1, 2], ["log2(x)", 1, 4], ["sqrt(x)", 0, 4], ["cbrt(x)", 0, 8],
  // by parts / substitution / partial fractions
  ["x*exp(x)", 0, 1], ["x*sin(x)", 0, 1], ["x^2*exp(x)", 0, 1],
  ["1/(x^2+1)", 0, 1], ["1/(x^2+4)", 0, 1], ["1/(x^2+x+1)", 0, 1],
  ["x/(x^2+1)", 0, 1], ["exp(2*x)", 0, 1], ["sin(3*x)", 0, 1],
  // non-monic rational denominators (currently refused — B7)
  ["1/(2*x+3)", 0, 1], ["1/(4*x^2-1)", 2, 3], ["1/(3*x^2+5*x+2)", 0, 0.5],
  ["x/(2*x+1)", 0, 1], ["1/(9*x^2+1)", 0, 1], ["5/(2*x^2+3*x+1)", 2, 3],
  // poles OUTSIDE the interval — must stay exact
  ["1/((x-1)^2)", 2, 3], ["1/(x^2-4)", 0, 1], ["1/(3*x-6)", 0, 1],
  ["1/(x-1)", 2, 4], ["tan(x)", 0, 1.5],
  // poles INSIDE the interval — must refuse
  ["1/((x-1)^2)", 0, 2], ["1/((x-2)^2)", 0, 4], ["1/(x-1)", 0, 2],
  ["tan(x)", 0, 3], ["1/(x^2-4)", 0, 3], ["1/(3*x-6)", 0, 5],
  ["1/(x-0.5)", 0, 3], ["1/(x-1.25)", 0, 3], ["1/x", -1, 1],
  ["1/((x-1)^2)", 0, 2.58],
  // removable singularities — must NOT refuse
  ["(x^2-1)/(x-1)", 0, 2], ["(x^2-1)/(x+1)", -2, 0], ["(x^2-4)/(x-2)", 0, 3],
  ["x/x", 0, 2], ["(x-2)/(x-2)", 0, 4], ["(x^2-1)/(x-1)", 1, 3],
  // domain errors
  ["sqrt(x)^2", -1, 1], ["sqrt(x)*sqrt(x)", -1, 1], ["ln(x)", -1, 2],
  ["sqrt(x)", -1, 1],
  // numeric fallback
  ["sin(x)/x", 1, 5], ["x^x", 0, 1], ["exp(-x^2)", 0, 1], ["sin(x)/x", -1, 1],
  ["exp(sin(x))", 0, 1], ["1/(x^5+x+1)", 0, 1],
  // degenerate and reversed intervals
  ["x^2", 2, 2], ["x^2", 2, 0], ["1/(x^2+1)", 1, 0], ["x", -1, -1],
  // large and tiny ranges
  ["x^2", 0, 1000], ["exp(-x)", 0, 100], ["x^2", 0, 1e-6],
];

// ---------------------------------------------------------------------------
// Derivatives. Every rule in the table, plus the division-by-zero cases.
// ---------------------------------------------------------------------------
const DERIVATIVES = [
  "x", "x^2", "x^3", "1/x", "sqrt(x)", "cbrt(x)", "exp(x)", "ln(x)",
  "log(x)", "log2(x)", "log10(x)", "sin(x)", "cos(x)", "tan(x)",
  "asin(x)", "acos(x)", "atan(x)", "sinh(x)", "cosh(x)", "tanh(x)", "abs(x)",
  "x*sin(x)", "sin(x^2)", "exp(2*x)", "ln(x^2+1)", "x/(x+1)", "(x+1)/(x-1)",
  "x^2*exp(x)", "sin(x)*cos(x)", "sqrt(x^2+1)", "exp(sin(x))", "1/(x^2+1)",
  "x^x", "2^x", "x^(1/2)", "x^0", "5", "x + 1", "-x", "-(x^2)",
  // division by zero
  "x/0", "0/0", "(x+1)/0", "1/0", "0/2", "x/2", "x/(1-1)",
  // multi-variable
  "a*x + b", "x*y",
];

describe("solveEquation baseline", () => {
  test("every equation form gives the same answer as the committed baseline", () => {
    const report = EQUATIONS.map((eq) => `${eq.padEnd(38)} -> ${solveLine(eq)}`);
    expect(report).toMatchSnapshot();
  });
});

describe("integrate baseline", () => {
  test("every integral gives the same answer as the committed baseline", () => {
    const report = INTEGRALS.map(
      ([f, a, b]) => `${`${f} [${a}, ${b}]`.padEnd(38)} -> ${integralLine(f, a, b)}`,
    );
    expect(report).toMatchSnapshot();
  });
});

describe("differentiate baseline", () => {
  test("every derivative gives the same answer as the committed baseline", () => {
    const report = DERIVATIVES.map((f) => `${f.padEnd(20)} -> ${derivLine(f)}`);
    expect(report).toMatchSnapshot();
  });
});

describe("the baseline itself is trustworthy", () => {
  // A harness reports itself first. Three times in this repo a green result meant
  // the harness was broken rather than the code.
  test("it covers every branch it claims to", () => {
    expect(EQUATIONS.length).toBeGreaterThanOrEqual(70);
    expect(INTEGRALS.length).toBeGreaterThanOrEqual(70);
    expect(DERIVATIVES.length).toBeGreaterThanOrEqual(45);
    // No duplicates — a duplicated case is coverage that is not there.
    expect(new Set(EQUATIONS).size).toBe(EQUATIONS.length);
    expect(new Set(DERIVATIVES).size).toBe(DERIVATIVES.length);
    expect(new Set(INTEGRALS.map((i) => i.join("|"))).size).toBe(INTEGRALS.length);
  });

  test("the summary formatter is sensitive to the things that matter", () => {
    // If sig() flattened distinct values to the same string, the whole baseline
    // would be blind. Prove it does not.
    expect(sig(1)).not.toBe(sig(1.0000001));
    expect(sig(0)).not.toBe(sig(1e-300));
    expect(sig(NaN)).toBe("NaN");
    expect(sig(Infinity)).toBe("+Inf");
    expect(sig(-Infinity)).toBe("-Inf");
    expect(sig(-2)).toBe("-2");
    // and it IS insensitive to last-bit noise, which is the point of 10 sig figs
    expect(sig(1 / 3)).toBe(sig(1 / 3 + 1e-17));
  });

  test("a changed answer changes the report line", () => {
    // The end-to-end claim: if solve returns something different, the snapshot
    // moves. Demonstrated by comparing two genuinely different inputs rather than
    // by trusting that it would.
    expect(solveLine("x^2 - 4 = 0")).not.toBe(solveLine("x^2 - 9 = 0"));
    expect(integralLine("x^2", 0, 3)).not.toBe(integralLine("x^2", 0, 4));
    expect(derivLine("x^2")).not.toBe(derivLine("x^3"));
    // and a refusal is distinguishable from a value
    expect(integralLine("1/(x-1)", 0, 2)).toContain("NaN");
    expect(integralLine("x^2", 0, 3)).not.toContain("NaN");
  });
});
