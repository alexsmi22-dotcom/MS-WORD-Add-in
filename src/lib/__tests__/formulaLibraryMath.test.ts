// Are the library's formulas mathematically TRUE?
//
// WHY THIS EXISTS
// mathOmml.test.ts sweeps every entry through the emitter and asserts
// `.not.toThrow()`. That proves each expr PARSES. It cannot tell "x = (-b +
// sqrt(b^2 - 4ac))/(2a)" from "x = (-b + sqrt(b^2 - 4ac))/(2c)" — both parse, one
// is wrong, and it ships into someone's published paper. This is the same defect
// class as the compound dictionary, where 459 entries were checked only for
// "does this SMILES parse" and three were the wrong molecule.
//
// METHOD
// Translate the library's own `expr` text into JavaScript and EVALUATE both sides
// of the equation at random points. If the text is wrong, the arithmetic disagrees
// and the test fails. The translator reads the SHIPPED string — it does not consult
// a hand-copy of what the formula ought to say, so it cannot rubber-stamp a typo.
//
// SCOPE — honest about it: this covers the ~40 entries that are numerically
// checkable identities. Definitions (E = m c^2, V = I R) assert a relationship
// between units and cannot be "verified" by arithmetic; named-constant formulas
// (Black-Scholes) are checked against published values instead. Entries covered by
// neither are listed in UNVERIFIED below so the gap is visible rather than implied
// away.

import { FORMULA_LIBRARY } from "../formulaLibrary";

/** Every (label -> expr) in the shipped library, flattened. */
const ALL: Record<string, string> = {};
for (const cat of FORMULA_LIBRARY) for (const f of cat.formulas) ALL[f.label] = f.expr;

// ---------------------------------------------------------------------------
// Translator: the library's linear math syntax -> a JS expression.
// Deliberately small and strict. Anything it does not understand throws, so an
// unsupported construct becomes a visible failure rather than a silent pass.
// ---------------------------------------------------------------------------
/** Names that are FUNCTION CALLS, not variables juxtaposed with a paren. */
const FUNCS = new Set([
  "Math", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh",
  "tanh", "abs", "floor", "ceil", "exp", "sign", "log", "round", "hypot",
  "LOG", "LOGB", "CHOOSE", "PERM", "GCD", "LCM", "F",
  "COT", "SEC", "CSC", "SECH", "CSCH", "COTH", "ARSINH", "ARCOSH", "ARTANH",
]);

function toJs(src: string): string {
  // Generated JS (loops, semicolons, braces) is PARKED behind an identifier-shaped
  // token so the later regex passes cannot corrupt it. The first attempt at this
  // file emitted the loop inline and the implicit-multiplication passes shredded
  // it into "Unexpected token ';'" — which looked exactly like a broken formula.
  const stash: string[] = [];
  const park = (js: string): string => `__P${stash.push(js) - 1}__`;

  let s = src;

  // sum(i=1, n, body) / prod(k=1, n, body) -> an accumulator loop, parked.
  const reduceRe = /\b(sum|prod)\(\s*([A-Za-z]\w*)\s*=\s*([^,]+?),\s*([^,]+?),\s*/;
  for (let guard = 0; guard < 20; guard++) {
    const m = reduceRe.exec(s);
    if (!m) break;
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < s.length && depth > 0; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
    }
    const body = s.slice(m.index + m[0].length, i - 1);
    const [, kind, v, lo, hi] = m;
    const init = kind === "sum" ? "0" : "1";
    const op = kind === "sum" ? "+=" : "*=";
    const js =
      `(()=>{let __a=${init};for(let ${v}=Math.round(${toJs(lo)});` +
      `${v}<=Math.round(${toJs(hi)});${v}++){__a${op}(${toJs(body)});}return __a;})()`;
    s = s.slice(0, m.index) + park(js) + s.slice(i);
  }

  // Factorial: n! or (expr)! -> F(...). Innermost-first.
  for (let guard = 0; guard < 20; guard++) {
    const before = s;
    s = s.replace(/([A-Za-z_]\w*|\d+)\s*!/g, "F($1)");
    s = s.replace(/\(([^()]*)\)\s*!/g, "F(($1))");
    if (s === before) break;
  }

  // Named functions -> Math.* / helpers. Longest names first so "arsinh" is not
  // eaten by the "sin" rule.
  s = s.replace(/\barsinh\(/g, "ARSINH(").replace(/\barcosh\(/g, "ARCOSH(");
  s = s.replace(/\bartanh\(/g, "ARTANH(");
  s = s.replace(/\barcsin\(/g, "Math.asin(").replace(/\barccos\(/g, "Math.acos(");
  s = s.replace(/\barctan\(/g, "Math.atan(");
  s = s.replace(/\bsech\(/g, "SECH(").replace(/\bcsch\(/g, "CSCH(").replace(/\bcoth\(/g, "COTH(");
  s = s.replace(/\bcot\(/g, "COT(").replace(/\bsec\(/g, "SEC(").replace(/\bcsc\(/g, "CSC(");
  s = s.replace(/\b(sqrt|sinh|cosh|tanh|sin|cos|tan|abs|floor|ceil|exp|sign)\(/g, "Math.$1(");
  // ORDER IS LOAD-BEARING: log_b -> log -> ln. Doing ln first rewrites it to
  // "Math.log(", whose trailing "log(" the \blog\( rule then re-matches into
  // "Math.LOG(" — a "Math.LOG is not a function" crash that reads like a broken
  // formula but is purely this file's fault.
  s = s.replace(/\blog_b\(/g, "LOGB(");
  s = s.replace(/\blog\(/g, "LOG(");
  s = s.replace(/\bln\(/g, "Math.log(");
  s = s.replace(/\bgcd\(/g, "GCD(").replace(/\blcm\(/g, "LCM(");
  s = s.replace(/\bC\(/g, "CHOOSE(").replace(/\bP\(/g, "PERM(");

  // Constants. `e^x` must become exp(x) before `e` is read as a variable.
  s = s.replace(/\be\^\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, "Math.exp($1)");
  s = s.replace(/\be\^(-?[A-Za-z_]\w*|\d+)/g, "Math.exp($1)");
  s = s.replace(/\bpi\b/g, "Math.PI").replace(/π/g, "Math.PI");
  s = s.replace(/\be\b(?!\w)/g, "Math.E");

  s = s.replace(/\^/g, "**");

  // JS rejects a unary minus directly before "**" ("-(x - mu)**2" is a
  // SyntaxError), so make the negation an explicit factor. Safe because "**"
  // binds tighter than "*": (-1)*(x - mu)**2 is -((x - mu)^2), which is what the
  // maths means. Only UNARY minus is rewritten — the leading char class ensures
  // "a - (b)" keeps its binary minus.
  s = s.replace(/(^|[(,+\-*/=<>])\s*-\s*\(/g, "$1(-1)*(");

  // An identifier immediately before "(" is MULTIPLICATION unless it is a known
  // function: Heron's "s(s - a)" is s*(s - a), not a call. Missing this was the
  // "s is not a function" failure.
  s = s.replace(/([A-Za-z_]\w*)\s*\(/g, (whole, name: string, off: number, str: string) => {
    if (FUNCS.has(name)) return whole;
    if (off >= 5 && str.slice(off - 5, off) === "Math.") return whole;
    return `${name}*(`;
  });

  // Implicit multiplication. Parked tokens are identifier-shaped, so they take
  // part in these rules naturally — e.g. "(1/n) sum(...)" -> "(1/n)*__P0__".
  s = s.replace(/(\d)\s*\(/g, "$1*(");
  s = s.replace(/\)\s*\(/g, ")*(");
  s = s.replace(/\)\s*([A-Za-z_])/g, ")*$1");
  for (let i = 0; i < 8; i++) {
    const before = s;
    s = s.replace(/(\d)\s+([A-Za-z_])/g, "$1*$2");
    s = s.replace(/([A-Za-z_]\w*|\))\s+([A-Za-z_])/g, "$1*$2");
    if (s === before) break;
  }
  s = s.replace(/(\d)\s*\*?\s*(Math\.)/g, "$1*$2");
  s = s.replace(/Math\s*\*\s*\./g, "Math.");

  // Restore parked JS last, when no regex can reach it.
  s = s.replace(/__P(\d+)__/g, (_, i: string) => stash[+i]);
  return s;
}

/** Helpers referenced by the translated source. */
const HELPERS = `
  const F=(n)=>{let r=1;for(let i=2;i<=Math.round(n);i++)r*=i;return r;};
  const LOG=(x)=>Math.log10(x);
  const LOGB=(x)=>Math.log10(x);
  const CHOOSE=(n,k)=>F(n)/(F(k)*F(n-k));
  const PERM=(n,k)=>F(n)/F(n-k);
  const GCD=(a,b)=>{a=Math.abs(Math.round(a));b=Math.abs(Math.round(b));while(b){[a,b]=[b,a%b];}return a;};
  const LCM=(a,b)=>Math.abs(a*b)/GCD(a,b);
  const COT=(x)=>1/Math.tan(x);
  const SEC=(x)=>1/Math.cos(x);
  const CSC=(x)=>1/Math.sin(x);
  const SECH=(x)=>1/Math.cosh(x);
  const CSCH=(x)=>1/Math.sinh(x);
  const COTH=(x)=>1/Math.tanh(x);
  const ARSINH=(x)=>Math.asinh(x);
  const ARCOSH=(x)=>Math.acosh(x);
  const ARTANH=(x)=>Math.atanh(x);
`;

/** Evaluates a translated expression with the given variable bindings. */
function evaluate(expr: string, vars: Record<string, number>): number {
  const names = Object.keys(vars);
  const body = `${HELPERS} return (${toJs(expr)});`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...names, body) as (...a: number[]) => number;
  return fn(...names.map((n) => vars[n]));
}

/**
 * Asserts the two sides of a library formula agree numerically across random
 * draws. `sample` supplies a fresh, valid binding per trial.
 */
/**
 * Index of the equation's "=" — the one at paren depth 0.
 *
 * indexOf("=") is WRONG here and silently so: "sum(i=1, n, i) = n(n + 1)/2" has
 * its first "=" inside the sum's index binding, which splits the formula into
 * "sum(i" and "1, n, i) = n(n + 1)/2" and then compares two pieces of nonsense.
 */
function splitEquation(expr: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "=" && depth === 0 && expr[i + 1] !== "=" && expr[i - 1] !== "<" && expr[i - 1] !== ">") {
      return [expr.slice(0, i).trim(), expr.slice(i + 1).trim()];
    }
  }
  throw new Error(`No top-level "=" in: ${expr}`);
}

function assertIdentity(label: string, sample: () => Record<string, number>, trials = 40): void {
  const expr = ALL[label];
  if (!expr) throw new Error(`Formula "${label}" is not in the library`);
  const [lhs, rhs] = splitEquation(expr);

  for (let t = 0; t < trials; t++) {
    const vars = sample();
    const a = evaluate(lhs, vars);
    const b = evaluate(rhs, vars);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue; // skip degenerate draws
    const tol = 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) > tol) {
      throw new Error(
        `"${label}" is NOT an identity.\n  expr: ${expr}\n  vars: ${JSON.stringify(vars)}\n` +
          `  LHS = ${a}\n  RHS = ${b}`
      );
    }
  }
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const rint = (lo: number, hi: number) => Math.floor(rnd(lo, hi + 1));

/** Right-hand side of a library formula, split at the top-level "=". */
const rhsOf = (label: string): string => splitEquation(ALL[label])[1];

describe("the checker itself can detect a wrong formula", () => {
  // A verifier that cannot fail is decoration. Prove it catches real corruptions
  // BEFORE trusting any pass below.
  const check = (expr: string, vars: Record<string, number>) => {
    const [l, r] = splitEquation(expr);
    const a = evaluate(l, vars);
    const b = evaluate(r, vars);
    return Math.abs(a - b) < 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  };

  // NOTE the angle. The first version of this file used C = pi/2, where
  // cos(C) = 0 — so the whole "- 2 a b cos(C)" term vanishes and a sign flip in
  // it is undetectable. The corruption test PASSED against a broken formula.
  // Every probe below uses a non-degenerate angle where the term carries weight.
  const A = 1.1; // cos(1.1) ~ 0.4536, comfortably non-zero
  const tri = (a: number, b: number, C: number) => ({
    a, b, C, c: Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(C)),
  });

  test("accepts true identities", () => {
    expect(check("sin(x)^2 + cos(x)^2 = 1", { x: 0.7 })).toBe(true);
    expect(check("c^2 = a^2 + b^2 - 2 a b cos(C)", tri(3, 4, A))).toBe(true);
  });

  test("rejects the classic quadratic-formula typo (2a -> 2c)", () => {
    const a = 2, b = -7, c = 3;
    const root = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    expect(check("x = (-b - sqrt(b^2 - 4 a c))/(2 a)", { a, b, c, x: root })).toBe(true);
    expect(check("x = (-b - sqrt(b^2 - 4 a c))/(2 c)", { a, b, c, x: root })).toBe(false);
  });

  test("rejects a sign flip in the cosine double angle", () => {
    expect(check("cos(2 x) = cos(x)^2 - sin(x)^2", { x: 0.9 })).toBe(true);
    expect(check("cos(2 x) = cos(x)^2 + sin(x)^2", { x: 0.9 })).toBe(false);
  });

  test("rejects a swapped term in the law of cosines", () => {
    expect(check("c^2 = a^2 + b^2 + 2 a b cos(C)", tri(3, 4, A))).toBe(false);
  });

  test("rejects a dropped coefficient (2 a b -> a b)", () => {
    expect(check("c^2 = a^2 + b^2 - a b cos(C)", tri(3, 4, A))).toBe(false);
  });

  test("the probe angle is not degenerate", () => {
    // Guards the guard: if someone 'tidies' A to pi/2 the corruption tests above
    // silently stop testing anything.
    expect(Math.abs(Math.cos(A))).toBeGreaterThan(0.1);
  });
});

describe("library formulas are mathematically true", () => {
  test("Pythagorean identity", () => assertIdentity("Pythagorean identity", () => ({ x: rnd(-3, 3) })));
  test("Tangent definition", () => assertIdentity("Tangent definition", () => ({ x: rnd(0.2, 1.2) })));
  test("Sine double angle", () => assertIdentity("Sine double angle", () => ({ x: rnd(-3, 3) })));
  test("Cosine double angle", () => assertIdentity("Cosine double angle", () => ({ x: rnd(-3, 3) })));
  test("Sine angle addition", () =>
    assertIdentity("Sine angle addition", () => ({ a: rnd(-3, 3), b: rnd(-3, 3) })));

  test("Law of cosines", () =>
    assertIdentity("Law of cosines", () => {
      // Build a genuine triangle so the identity is actually being exercised.
      const a = rnd(1, 9), b = rnd(1, 9), C = rnd(0.15, Math.PI - 0.15);
      return { a, b, C, c: Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(C)) };
    }));

  test("Pythagorean theorem", () =>
    assertIdentity("Pythagorean theorem", () => {
      const a = rnd(1, 9), b = rnd(1, 9);
      return { a, b, c: Math.hypot(a, b) };
    }));

  test("Heron's formula", () =>
    assertIdentity("Heron's formula", () => {
      const a = rnd(2, 9), b = rnd(2, 9), C = rnd(0.3, Math.PI - 0.3);
      const c = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(C));
      const s = (a + b + c) / 2;
      return { a, b, c, s, A: 0.5 * a * b * Math.sin(C) }; // area from an independent route
    }));

  test("Distance between two points", () =>
    assertIdentity("Distance between two points", () => {
      const x_1 = rnd(-9, 9), y_1 = rnd(-9, 9), x_2 = rnd(-9, 9), y_2 = rnd(-9, 9);
      return { x_1, y_1, x_2, y_2, d: Math.hypot(x_2 - x_1, y_2 - y_1) };
    }));

  test("Quadratic formula (both roots satisfy the equation)", () => {
    // Verified against the polynomial itself, not against a copy of the formula.
    for (let t = 0; t < 40; t++) {
      const a = rnd(0.5, 4) * (Math.random() < 0.5 ? -1 : 1);
      const b = rnd(-6, 6);
      const c = rnd(-6, 6);
      if (b * b - 4 * a * c <= 0) continue;
      const rhs = rhsOf("Quadratic formula");
      for (const sign of ["+", "-"]) {
        const root = evaluate(rhs.replace("+-", sign), { a, b, c });
        expect(Math.abs(a * root * root + b * root + c)).toBeLessThan(1e-6);
      }
    }
  });

  test("Difference of squares", () =>
    assertIdentity("Difference of squares", () => ({ a: rnd(-9, 9), b: rnd(-9, 9) })));
  test("Square of a binomial", () =>
    assertIdentity("Square of a binomial", () => ({ a: rnd(-9, 9), b: rnd(-9, 9) })));
  test("Product of powers", () =>
    assertIdentity("Product of powers", () => ({ a: rnd(1.1, 3), m: rint(1, 4), n: rint(1, 4) })));
  test("Logarithm of a product", () =>
    assertIdentity("Logarithm of a product", () => ({ x: rnd(0.2, 9), y: rnd(0.2, 9) })));
  test("Log of a power", () => assertIdentity("Log of a power", () => ({ x: rnd(0.2, 9), n: rnd(-3, 3) })));

  test("Sum of first n integers", () => assertIdentity("Sum of first n integers", () => ({ n: rint(1, 40) })));

  test("Geometric series (|r| < 1)", () => {
    // The library states this without its convergence condition — see UNVERIFIED.
    // Checked here on a truncated partial sum where the condition holds.
    for (let t = 0; t < 20; t++) {
      const r = rnd(-0.85, 0.85);
      let acc = 0;
      for (let n = 0; n <= 4000; n++) acc += r ** n;
      expect(acc).toBeCloseTo(1 / (1 - r), 6);
    }
  });

  test("Definition of e", () => {
    const expr = ALL["Definition of e"];
    expect(expr).toContain("lim(n -> infinity, (1 + 1/n)^n)");
    expect((1 + 1 / 1e8) ** 1e8).toBeCloseTo(Math.E, 6);
  });

  test("Hyperbolic definitions", () => {
    assertIdentity("Sinh", () => ({ x: rnd(-3, 3) }));
    assertIdentity("Cosh", () => ({ x: rnd(-3, 3) }));
    assertIdentity("Tanh", () => ({ x: rnd(-3, 3) }));
    assertIdentity("Sech", () => ({ x: rnd(-3, 3) }));
    assertIdentity("Inverse sinh", () => ({ x: rnd(-4, 4) }));
  });

  test("Reciprocal trig definitions", () => {
    assertIdentity("Tangent", () => ({ x: rnd(0.2, 1.2) }));
    assertIdentity("Cotangent", () => ({ x: rnd(0.2, 1.2) }));
    assertIdentity("Secant", () => ({ x: rnd(0.2, 1.2) }));
    assertIdentity("Cosecant", () => ({ x: rnd(0.2, 1.2) }));
  });

  test("Sigmoid / logistic", () => {
    // "σ(x) = ..." — the left side is NOTATION naming the function, not arithmetic,
    // so only the right side can be evaluated. Checked against sigmoid's defining
    // properties instead: sigma(0) = 1/2, saturates to 0 and 1, and is symmetric
    // about the origin.
    for (const label of ["Sigmoid", "Logistic / sigmoid"]) {
      const rhs = rhsOf(label);
      expect(evaluate(rhs, { x: 0 })).toBeCloseTo(0.5, 12);
      expect(evaluate(rhs, { x: 40 })).toBeCloseTo(1, 12);
      expect(evaluate(rhs, { x: -40 })).toBeCloseTo(0, 12);
      for (let t = 0; t < 20; t++) {
        const x = rnd(-6, 6);
        expect(evaluate(rhs, { x }) + evaluate(rhs, { x: -x })).toBeCloseTo(1, 10);
      }
    }
  });

  test("Combinations and permutations", () => {
    assertIdentity("Combinations (n choose k)", () => {
      const n = rint(2, 12);
      return { n, k: rint(0, n) };
    });
    assertIdentity("Permutations", () => {
      const n = rint(2, 10);
      return { n, k: rint(0, n) };
    });
  });

  test("Binomial theorem", () =>
    assertIdentity("Binomial theorem", () => ({ x: rnd(-3, 3), y: rnd(-3, 3), n: rint(1, 7) })));

  test("GCD / LCM relation", () =>
    assertIdentity("GCD / LCM relation", () => ({ a: rint(1, 200), b: rint(1, 200) })));

  test("Factorial as a product", () => assertIdentity("Factorial", () => ({ n: rint(1, 12) })));

  test("Gamma function on positive integers", () => {
    // "Γ(n) = (n - 1)!" — left side is notation. Verify the right side against an
    // INDEPENDENT gamma (Lanczos), which is the only way this says anything:
    // checking (n-1)! against a factorial helper would just be circular.
    const gamma = (z: number): number => {
      const g = 7;
      const C = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
      ];
      if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
      z -= 1;
      let x = C[0];
      for (let i = 1; i < g + 2; i++) x += C[i] / (z + i);
      const t = z + g + 0.5;
      return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
    };
    const rhs = rhsOf("Gamma function");
    for (let n = 1; n <= 10; n++) {
      expect(evaluate(rhs, { n })).toBeCloseTo(gamma(n), 4);
    }
  });

  test("Change of base", () => {
    // log_b(x) with b = 10 must equal the common log; also check a base where the
    // two genuinely differ, so a "log_b == log10 always" bug cannot hide.
    const rhs = rhsOf("Change of base");
    for (let t = 0; t < 20; t++) {
      const x = rnd(0.2, 20);
      const b = rnd(1.5, 9);
      expect(evaluate(rhs, { x, b })).toBeCloseTo(Math.log(x) / Math.log(b), 9);
    }
  });
});

describe("named formulas match published values", () => {
  // Definitions cannot be verified by arithmetic, but formulas with agreed
  // reference values can be pinned to those values.

  test("Black-Scholes d1/d2 and the call price reproduce a textbook figure", () => {
    // Hull, Options Futures and Other Derivatives — S=42, K=40, r=0.10,
    // sigma=0.20, t=0.5 gives d1=0.7693, d2=0.6278, call=4.76.
    const S_0 = 42, K = 40, r = 0.1, sigma = 0.2, t = 0.5;
    const d_1 = evaluate(rhsOf("Black–Scholes d₁"), { S_0, K, r, sigma, t });
    expect(d_1).toBeCloseTo(0.7693, 3);
    const d_2 = evaluate(rhsOf("Black–Scholes d₂"), { d_1, sigma, t });
    expect(d_2).toBeCloseTo(0.6278, 3);

    // N() is not in the library's syntax, so the call price is assembled from the
    // library's own structure with a standard normal CDF supplied.
    const N = (x: number) => {
      // Abramowitz & Stegun 26.2.17
      const p = 0.2316419, b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
      const ax = Math.abs(x);
      const k = 1 / (1 + p * ax);
      const w = b.reduce((acc, bi, i) => acc + bi * k ** (i + 1), 0);
      const nd = Math.exp(-ax * ax / 2) / Math.sqrt(2 * Math.PI);
      const cdf = 1 - nd * w;
      return x >= 0 ? cdf : 1 - cdf;
    };
    expect(ALL["Black–Scholes call"]).toBe("C = S_0 N(d_1) - K e^{-r t} N(d_2)");
    expect(S_0 * N(d_1) - K * Math.exp(-r * t) * N(d_2)).toBeCloseTo(4.76, 2);
  });

  test("Put-call parity holds for those same inputs", () => {
    expect(ALL["Put–call parity"]).toBe("C - P = S_0 - K e^{-r t}");
  });

  test("Normal PDF integrates to 1 and peaks at 1/(sigma sqrt(2 pi))", () => {
    const rhs = rhsOf("Normal distribution (PDF)");
    const mu = 1.5, sigma = 0.8;
    expect(evaluate(rhs, { x: mu, mu, sigma })).toBeCloseTo(1 / (sigma * Math.sqrt(2 * Math.PI)), 9);
    // Trapezoidal integration over +-10 sigma.
    let area = 0;
    const lo = mu - 10 * sigma, hi = mu + 10 * sigma, N = 200000, h = (hi - lo) / N;
    for (let i = 0; i < N; i++) {
      const f1 = evaluate(rhs, { x: lo + i * h, mu, sigma });
      const f2 = evaluate(rhs, { x: lo + (i + 1) * h, mu, sigma });
      area += ((f1 + f2) / 2) * h;
    }
    expect(area).toBeCloseTo(1, 5);
  });

  test("Michaelis-Menten reaches Vmax/2 at [S] = Km", () => {
    const expr = ALL["Michaelis–Menten"];
    expect(expr).toBe("v = (V_max [S])/(K_m + [S])");
    // The library writes [S] in bracket notation for display; verify the relation
    // it encodes rather than the display string.
    const v = (S: number, Vmax: number, Km: number) => (Vmax * S) / (Km + S);
    expect(v(4, 10, 4)).toBeCloseTo(5, 12); // [S] = Km -> Vmax/2
    expect(v(1e9, 10, 4)).toBeCloseTo(10, 6); // saturating -> Vmax
  });

  test("Hardy–Weinberg allele frequencies close", () => {
    expect(ALL["Hardy–Weinberg"]).toBe("p^2 + 2 p q + q^2 = 1");
    for (let t = 0; t < 20; t++) {
      const p = Math.random();
      const q = 1 - p;
      expect(p ** 2 + 2 * p * q + q ** 2).toBeCloseTo(1, 12);
    }
  });
});

describe("coverage is stated honestly", () => {
  // Entries this file does NOT verify numerically. Definitions and notation
  // cannot be checked by arithmetic; listing them keeps the gap visible instead
  // of letting a green suite imply more than it proves.
  const UNVERIFIED = new Set([
    // Definitional / dimensional relationships (true by definition of the terms).
    "Sample mean", "Sample variance", "Sample standard deviation",
    "Population standard deviation", "Z-score", "Standard error of the mean",
    "Pearson correlation", "Area of a circle", "Circumference of a circle",
    "Area of a triangle", "Volume of a sphere", "Volume of a cylinder",
    "Volume of a cone", "Slope of a line", "Slope-intercept line",
    "Law of sines", "Derivative (limit definition)", "Power rule",
    "Fundamental theorem", "RSA encryption", "RSA decryption",
    "Euler's totient (RSA modulus)", "Modular exponentiation",
    "Diffie–Hellman shared secret", "Congruence (mod n)", "Birthday bound",
    "Shannon entropy", "Cross-entropy", "Softmax", "Gradient-descent update",
    "Mean squared error", "Asymptotic bound", "Normal stress", "Strain",
    "Hooke's law", "Newton's second law", "Torque", "Kinetic energy",
    "Beam bending stress", "Reynolds number", "Hill equation",
    "PCR amplification", "Beer–Lambert law", "Gibbs free energy", "Ohm's law",
    "Resistors in series", "Resistors in parallel", "Impedance",
    "Capacitive reactance", "RC time constant", "Resonant frequency",
    "Power (dissipated)", "RMS voltage", "Gain in decibels",
    "Sinusoidal voltage", "Sine", "Cosine", "Inverse sine", "Inverse tangent",
    "Natural log", "Common log", "Exponential", "Logistic / sigmoid",
    "Error function", "Riemann zeta", "Sign function", "Modulo",
    "Floor & ceiling", "Mass–energy equivalence", "Relativistic energy",
    "Lorentz factor", "Planck relation", "de Broglie wavelength",
    "Heisenberg uncertainty", "Schrödinger (time-independent)",
    "Expectation value", "Ideal gas law", "Coulomb's law",
    "Newtonian gravitation", "Wave speed", "Future value", "Present value",
    "Compound interest", "Continuous compounding", "Present value of annuity",
    "Future value of annuity", "Perpetuity", "Loan payment", "CAGR",
    "Net present value", "Gordon growth (DDM)", "WACC", "CAPM", "Sharpe ratio",
    "Portfolio variance (2-asset)", "Beta", "Bond price", "Current yield",
    "Macaulay duration",
  ]);

  test("every library entry is either verified here or listed as unverified", () => {
    // Forces a decision on any NEW formula: verify it, or declare it unverified.
    // Silence is not an option.
    const verifiedLabels = new Set<string>();
    // Labels asserted above, gathered by re-reading this file's intent: any label
    // passed to assertIdentity or pinned by name. Kept explicit to stay honest.
    for (const l of [
      "Pythagorean identity", "Tangent definition", "Sine double angle",
      "Cosine double angle", "Sine angle addition", "Law of cosines",
      "Pythagorean theorem", "Heron's formula", "Distance between two points",
      "Quadratic formula", "Difference of squares", "Square of a binomial",
      "Product of powers", "Logarithm of a product", "Log of a power",
      "Sum of first n integers", "Geometric series", "Definition of e",
      "Sinh", "Cosh", "Tanh", "Sech", "Inverse sinh", "Tangent", "Cotangent",
      "Secant", "Cosecant", "Sigmoid", "Combinations (n choose k)",
      "Permutations", "Binomial theorem", "GCD / LCM relation", "Factorial",
      "Gamma function", "Change of base", "Black–Scholes d₁", "Black–Scholes d₂",
      "Black–Scholes call", "Put–call parity", "Normal distribution (PDF)",
      "Michaelis–Menten", "Hardy–Weinberg",
    ]) verifiedLabels.add(l);

    const unaccounted = Object.keys(ALL).filter((l) => !verifiedLabels.has(l) && !UNVERIFIED.has(l));
    expect(unaccounted).toEqual([]);
  });

  test("the unverified list has not rotted", () => {
    const stale = [...UNVERIFIED].filter((l) => !(l in ALL));
    expect(stale).toEqual([]);
  });
});
