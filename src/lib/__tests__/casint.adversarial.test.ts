// Adversarial bug test — symbolic integration (casint.ts).
//
// Built to FALSIFY the integrator, in the house style. The ONE property that
// must never break is not 'it finds an answer' but 'if it returns an F, then
// F' = f'. A refusal is always acceptable; a wrong antiderivative carrying an
// authoritative-looking derivation is the worst output this product can
// produce, and is the exact failure mode the CAS verification gate exists to
// prevent. So: nasty inputs in, independent differentiation out, plus a
// fine-grid quadrature cross-check on every result labelled exact.

import { parseExpr, evalAst, format, derivative, differentiate, integrate, simplify } from "../solve";
import { symbolicIntegrate } from "../casint";

const A = (src: string): string | null => {
  const r = symbolicIntegrate(parseExpr(src), "x", derivative);
  return r ? format(r.F) : null;
};

// The single property that must NEVER break: if it returns an F, then F' = f.
function mustBeCorrect(src: string): void {
  const F = A(src);
  if (F === null) return; // refusal is always acceptable
  const dF = parseExpr(differentiate(F)!.derivative);
  const f = parseExpr(src);
  for (const x of [0.37, 0.83, 1.41, 2.29, 3.77, -0.61, -1.53]) {
    let want: number, got: number;
    try {
      want = evalAst(f, { x });
      got = evalAst(dF, { x });
    } catch {
      continue;
    }
    if (!Number.isFinite(want) || !Number.isFinite(got)) continue;
    if (Math.abs(got - want) > 1e-5 * (1 + Math.abs(want))) {
      throw new Error(`WRONG: ∫${src} -> ${F}; at x=${x} F'=${got} but f=${want}`);
    }
  }
}

it("adversarial sweep: never returns a wrong antiderivative", () => {
  const NASTY = [
    // repeated roots, high multiplicity
    "1/(x-1)^2", "1/(x-1)^3", "1/(x^2*(x-1)^2)", "x/(x-2)^2",
    // improper fractions
    "x^4/(x^2-1)", "(x^5+1)/(x^2+1)", "x^2/(x+1)",
    // negative / zero / unit coefficients
    "-1/x", "0*x", "1", "x^0",
    // nested substitution
    "x*sin(x^2)", "x^2*exp(x^3)", "sin(x)*exp(cos(x))", "ln(x)/x",
    "1/(x*ln(x))", "cos(x)/sin(x)", "x/sqrt(x^2+1)",
    // by parts chains
    "x^3*exp(x)", "x^2*cos(x)", "x*atan(x)", "ln(x)^2", "x*exp(-x)",
    // quadratics of every discriminant sign
    "1/(x^2+1)", "1/(x^2-1)", "1/(x^2+2*x+1)", "1/(x^2-2*x+5)",
    "1/(2*x^2+3*x+7)", "(3*x-1)/(x^2+x+1)",
    // things with no elementary form (must refuse)
    "exp(x^2)", "sin(x)/x", "exp(x)/x", "sqrt(1+x^3)", "x^x",
    // pathological
    "1/(x^2)", "x^(-3)", "sqrt(x)", "1/sqrt(x)", "abs(x)",
    "exp(x)*sin(x)", "sin(x)^2", "cos(x)^2", "tan(x)^2",
  ];
  for (const src of NASTY) mustBeCorrect(src);
});

it("adversarial: definite integrals agree with high-accuracy quadrature", () => {
  // Independent check — Simpson on a fine grid, compared to whatever path
  // integrate() actually took. A wrong symbolic answer shows up here.
  const simpson = (f: (x: number) => number, a: number, b: number, n = 20000) => {
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return (s * h) / 3;
  };
  const CASES: [string, number, number][] = [
    ["x*exp(x)", 0, 2],
    ["ln(x)", 1, 3],
    ["x*sin(x)", 0, 2],
    ["1/(x*(x+1))", 1, 4],
    ["1/(x^2+4)", 0, 3],
    ["x^3/(x^2+1)", 0, 2],
    ["(2*x+3)/(x^2+3*x+2)", 1, 3],
    ["x^2*exp(x)", 0, 1.5],
    ["atan(x)", 0, 1],
    ["x*ln(x)", 1, 2.5],
    ["1/(x-1)^2", 2, 5],
    ["x/sqrt(x^2+1)", 0, 2],
    ["tan(x)", 0.1, 1.0],
    ["1/(x^2-2*x+5)", 0, 3],
  ];
  for (const [src, a, b] of CASES) {
    const e = parseExpr(src);
    const ref = simpson((x) => evalAst(e, { x }), a, b);
    const r = integrate(src, a, b)!;
    expect(r).not.toBeNull();
    if (Math.abs(r.value - ref) > 1e-5 * (1 + Math.abs(ref))) {
      throw new Error(`∫${src} [${a},${b}] = ${r.value} via ${r.method}, reference ${ref}`);
    }
  }
});

it("adversarial: no crash, no hang on hostile input", () => {
  const HOSTILE = [
    "x/0", "1/(x-x)", "0/0", "x^999", "(x+1)^60",
    "sin(sin(sin(x)))", "exp(exp(exp(x)))",
    "1/(x^7+x^5+x^3+x+1)", "((((x))))", "x*x*x*x*x*x*x*x",
  ];
  for (const src of HOSTILE) {
    const t0 = Date.now();
    expect(() => {
      try {
        symbolicIntegrate(parseExpr(src), "x", derivative);
      } catch (e) {
        if (e instanceof RangeError) throw e; // stack overflow is a real failure
      }
    }).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(5000);
  }
});

it("adversarial: integrate() never reports exact with a wrong value", () => {
  // Scan a batch; any result labelled exact must match fine quadrature.
  const SRCS = [
    "x^2", "x*exp(x)", "sin(x)", "1/x", "ln(x)", "1/(x^2+1)", "x/(x^2+1)",
    "x*sin(x)", "exp(2*x)", "1/(x*(x+1))", "x^3-2*x", "sqrt(x)", "atan(x)",
  ];
  for (const src of SRCS) {
    const r = integrate(src, 1, 2);
    if (!r || r.method !== "exact (symbolic)") continue;
    const e = parseExpr(src);
    const n = 20000, a = 1, b = 2, h = (b - a) / n;
    let s = evalAst(e, { x: a }) + evalAst(e, { x: b });
    for (let i = 1; i < n; i++) s += evalAst(e, { x: a + i * h }) * (i % 2 ? 4 : 2);
    const ref = (s * h) / 3;
    expect(Math.abs(r.value - ref)).toBeLessThan(1e-6 * (1 + Math.abs(ref)));
  }
});
