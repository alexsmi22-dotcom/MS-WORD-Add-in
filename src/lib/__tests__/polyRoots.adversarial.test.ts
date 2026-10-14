// v2.136.0 — adversarial pass over the exact polynomial-root engine (§C step 4,
// §E.18). Written to break it, not to confirm it: every multiplicity pattern to
// degree 8, roots 1e-9 apart, casus irreducibilis without a special angle, huge
// and lossy coefficients, roots of unity, a quartic whose Ferrari form is too big,
// a quintic, and a 4 s gross-freeze bound on every input.

import { solveEquation, parseExpr, evalAst } from "../solve";
import { tryRecurrence } from "../recurrence";

type R = NonNullable<ReturnType<typeof solveEquation>>;

const FREEZE_MS = 4000;

function timed(s: string): R {
  const t0 = Date.now();
  const r = solveEquation(s);
  const ms = Date.now() - t0;
  expect(ms).toBeLessThan(FREEZE_MS);
  if (!r) throw new Error(`no result for ${s}`);
  return r;
}

const mults = (r: R): number[] => r.roots.map((x) => x.mult ?? 1);
const total = (r: R): number => mults(r).reduce((a, b) => a + b, 0);

function expectContract(r: R): void {
  for (const root of r.roots) {
    const shown = root.display.replace(/ \(×\d+\)$/, "");
    const ast = parseExpr(shown);
    const re = evalAst(ast, { i: 0 });
    const im = evalAst(ast, { i: 1 }) - re;
    const scale = Math.max(1, Math.hypot(root.re, root.im));
    expect(Math.abs(re - root.re)).toBeLessThanOrEqual(1e-9 * scale);
    expect(Math.abs(im - root.im)).toBeLessThanOrEqual(1e-9 * scale);
  }
}

/** |p(z)| relative to Σ|aₖ||z|ᵏ, p given by ascending double coefficients. */
function relResidual(c: number[], re: number, im: number): number {
  let ar = 0, ai = 0, scale = 0;
  const mag = Math.hypot(re, im);
  for (let k = c.length - 1; k >= 0; k--) {
    const nr = ar * re - ai * im + c[k];
    const ni = ar * im + ai * re;
    ar = nr; ai = ni;
    scale = scale * mag + Math.abs(c[k]);
  }
  return Math.hypot(ar, ai) / Math.max(scale, 1e-300);
}

describe("every multiplicity pattern up to degree 8 is exact — no complex shards", () => {
  // Distinct rational roots; each pattern is a partition of the degree (3–8 —
  // degree 2 is the untouched quadratic path, which reports a double root once).
  const ROOTS = ["1", "-2", "1/3", "5", "-1/2", "3", "-4", "2/7"];
  const PATTERNS: number[][] = [
    [3], [4], [5], [6], [7], [8],
    [2, 1], [3, 1], [2, 2], [4, 1], [3, 2], [2, 2, 1], [5, 1], [4, 2], [3, 3], [3, 2, 1], [2, 2, 2],
    [6, 1], [5, 2], [4, 3], [4, 2, 1], [3, 3, 1], [3, 2, 2], [2, 2, 2, 1],
    [7, 1], [6, 2], [5, 3], [4, 4], [5, 1, 1, 1], [4, 2, 2], [3, 3, 2], [3, 2, 1, 1, 1], [2, 2, 2, 2], [2, 2, 1, 1, 1, 1],
  ];
  it.each(PATTERNS.map((p) => [p.join("+"), p]))("pattern %s", (_name, pattern) => {
    const pat = pattern as number[];
    const eq = pat.map((m, k) => `(x - ${ROOTS[k]})^${m}`).join("*") + " = 0";
    const r = timed(eq);
    expect(r.method).toBe("exact (factored over ℚ)");
    expect(r.roots).toHaveLength(pat.length);
    expect(r.roots.every((x) => x.im === 0 && x.exact)).toBe(true);
    const got = new Map(r.roots.map((x) => [x.display.replace(/ \(×\d+\)$/, ""), x.mult ?? 1]));
    pat.forEach((m, k) => expect(got.get(ROOTS[k])).toBe(m));
    expectContract(r);
  });

  it.each([
    ["(x^2-2)^3*(x-1)^2 = 0", { "sqrt(2)": 3, "-sqrt(2)": 3, "1": 2 }],
    ["(x^3-2)^2*(x+1)^2 = 0", { "cbrt(2)": 2, "-1": 2 }],
    ["(x^2+x+1)^4 = 0", { "-1/2 + sqrt(3)/2*i": 4, "-1/2 - sqrt(3)/2*i": 4 }],
    ["(x^3 - 3x + 1)^2*(x - 5) = 0", { "2*cos(2*pi/9)": 2, "5": 1 }],
    ["(x^4 + 4x - 1)^2 = 0", { "-sqrt(2)/2 + sqrt(sqrt(2) - 1/2)": 2 }],
    ["(x^2 + 1)^3*(x^2 - 3)*(x - 1/2) = 0", { "i": 3, "-i": 3, "sqrt(3)": 1, "1/2": 1 }],
  ] as [string, Record<string, number>][])("irrational and complex repeated roots: %s", (eq, want) => {
    const r = timed(eq);
    const got = new Map(r.roots.map((x) => [x.display.replace(/ \(×\d+\)$/, ""), x.mult ?? 1]));
    for (const [d, m] of Object.entries(want)) expect(got.get(d)).toBe(m);
    expect(r.roots.every((x) => x.exact)).toBe(true);
    expectContract(r);
  });
});

describe("near-repeated roots stay DISTINCT", () => {
  it("1 and 1 + 1e-9 (cubic, so it reaches the new engine)", () => {
    const r = timed("(x-1)*(x-1.000000001)*(x+2) = 0");
    expect(r.roots.map((x) => x.display)).toEqual(["1000000001/1000000000", "1", "-2"]);
    expect(r.roots.every((x) => (x.mult ?? 1) === 1)).toBe(true);
  });
  it("a double root beside a near neighbour keeps both multiplicities", () => {
    const r = timed("(x-1)^2*(x-1.000000001) = 0");
    const got = new Map(r.roots.map((x) => [x.display.replace(/ \(×\d+\)$/, ""), x.mult ?? 1]));
    expect(got.get("1")).toBe(2);
    expect(got.get("1000000001/1000000000")).toBe(1);
  });
  it("the small root of x^3 - 1234567x + 1 is not merged with or snapped to 0", () => {
    const r = timed("x^3 - 1234567x + 1 = 0");
    const small = r.roots.find((x) => Math.abs(x.re) < 1)!;
    expect(small.re).not.toBe(0);
    expect(Math.abs(small.re - 8.100005913004e-7) / 8.1e-7).toBeLessThan(1e-9);
  });
});

describe("casus irreducibilis — real roots are never complex-radical expressions", () => {
  // x³ − a x + b with three real roots and no rational root.
  const CASES: [number, number][] = [[7, 7], [6, 2], [5, 1], [9, 3], [10, 5], [12, 1], [21, 7], [3, 1]];
  it.each(CASES)("x^3 - %d*x + %d", (a, b) => {
    const r = timed(`x^3 - ${a}*x + ${b} = 0`);
    expect(r.method).toBe("exact (cubic — trigonometric form, three real roots)");
    expect(r.roots).toHaveLength(3);
    for (const root of r.roots) {
      expect(root.im).toBe(0);
      expect(root.display).not.toMatch(/cbrt|\*i\b|(^|[^a-z])i($|[^a-z(])/);
      expect(relResidual([b, -a, 0, 1], root.re, 0)).toBeLessThan(1e-12);
    }
    expectContract(r);
  });
  it("a casus with a shift and a fractional coefficient", () => {
    const r = timed("2x^3 - 3x^2 - 6x + 1 = 0");
    expect(r.roots.every((x) => x.im === 0 && x.exact)).toBe(true);
    expectContract(r);
  });
  it("Bombelli's x^3 - 15x - 4: rational root first, no radicals of complex numbers", () => {
    const r = timed("x^3 - 15x - 4 = 0");
    expect(r.roots.map((x) => x.display)).toEqual(["4", "-2 + sqrt(3)", "-2 - sqrt(3)"]);
  });
});

describe("huge and lossy coefficients", () => {
  it("a 30-digit literal: multiplicities kept, values shown as decimals, the rounding SAID", () => {
    const r = timed("(x - 123456789012345678901234567890)*(x^2+1) = 0");
    expect(r.roots).toHaveLength(3);
    expect(r.roots.every((x) => !x.exact)).toBe(true);
    expect(r.method).toBe("complete (all roots)");
    expect(r.caveats.join(" ")).toMatch(/123456789012345678901234567890 has more than the ~16 significant digits/);
  });
  it("operands past 64 bits: the Cardano form is not attempted, by name", () => {
    const r = timed("x^3 + 2^70*x + 1 = 0");
    expect(r.method).toBe("complete (all roots)");
    expect(r.caveats.join(" ")).toMatch(/past 64 bits/);
    for (const root of r.roots) expect(relResidual([1, 2 ** 70, 0, 1], root.re, root.im)).toBeLessThan(1e-12);
  });
  it("a 65-bit quartic: Ferrari not attempted, said", () => {
    // Written as 2^65, not as its 20 digits: a 20-digit literal is read through a
    // double's shortest decimal, which the lossy-literal guard (tested above) catches.
    const r = timed("x^4 + 2^65*x + 1 = 0");
    expect(r.caveats.join(" ")).toMatch(/past 64 bits, so the Ferrari form is not attempted/);
  });
  it("tiny exact coefficients stay exact", () => {
    const r = timed("x^3 - 0.000001 = 0");
    expect(r.roots.map((x) => x.display)).toEqual(["1/100", "-1/200 - sqrt(3)/200*i", "-1/200 + sqrt(3)/200*i"]);
  });
  it("a highly composite constant at degree 8 stays under the freeze bound", () => {
    const r = timed("963761198400*x^8 + 963761198401*x + 963761198400 = 0");
    expect(total(r)).toBe(8);
  });
  // Dense, 30-bit coefficients — the shapes that made the exact stages slow:
  // a candidate search by exact Horner (6 s at degree 60) and Euclid over ℚ.
  const dense = (deg: number): string[] => {
    let a = 7;
    const out: string[] = [];
    for (let k = 0; k <= deg; k++) { a = (a * 48271) % 2147483647; out.push(`(${a % 999999937})*x^${k}`); }
    return out;
  };
  it("a dense degree-60 polynomial with 30-bit coefficients", () => {
    const r = timed(`${dense(60).join(" + ")} = 0`);
    expect(total(r)).toBe(60);
  });
  it("its square (degree 60, every root double) — multiplicities exact", () => {
    const r = timed(`(${dense(30).join(" + ")})^2 = 0`);
    expect(r.roots).toHaveLength(30);
    expect(r.roots.every((x) => x.mult === 2)).toBe(true);
  });
  it("a cube (degree 60, every root triple)", () => {
    const r = timed(`(${dense(20).join(" + ")})^3 = 0`);
    expect(r.roots).toHaveLength(20);
    expect(r.roots.every((x) => x.mult === 3)).toBe(true);
  });
  it("degree 64 (the cap) answers inside the bound", () => {
    const r = timed("x^64 - 1 = 0");
    expect(total(r)).toBe(64);
    for (const root of r.roots) expect(Math.abs(Math.hypot(root.re, root.im) - 1)).toBeLessThan(1e-12);
  });
  it("(x - 1)^64 is one root of multiplicity 64", () => {
    const r = timed("(x-1)^64 = 0");
    expect(r.roots.map((x) => x.display)).toEqual(["1 (×64)"]);
  });
});

describe("Abel–Ruffini, stated generally", () => {
  it("x^5 - x - 1: numeric, every root a true root", () => {
    const r = timed("x^5 - x - 1 = 0");
    expect(r.method).toBe("complete (all roots)");
    expect(r.roots).toHaveLength(5);
    for (const root of r.roots) expect(relResidual([-1, -1, 0, 0, 0, 1], root.re, root.im)).toBeLessThan(1e-13);
    expect(r.caveats.join(" ")).toMatch(/was not tested for solvability by radicals/);
  });
  it("a degree-7 factor names no particular polynomial as unsolvable", () => {
    const r = timed("x^7 - x - 1 = 0");
    expect(r.caveats.join(" ")).toMatch(/Degree 7: no general formula in radicals exists \(Abel–Ruffini\); this septic/);
  });
});

describe("roots of unity", () => {
  it.each([3, 4, 5, 6, 7, 8, 9, 10, 12])("x^%d - 1: n roots on the unit circle, exact where certified", (n) => {
    const r = timed(`x^${n} - 1 = 0`);
    expect(total(r)).toBe(n);
    for (const root of r.roots) {
      expect(Math.abs(Math.hypot(root.re, root.im) - 1)).toBeLessThan(1e-13);
      // every one is a distinct n-th root of unity
      const k = (Math.atan2(root.im, root.re) * n) / (2 * Math.PI);
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-11);
    }
    expect(r.roots.find((x) => x.display === "1")?.exact).toBe(true);
    expectContract(r);
  });
});

describe("a quartic whose Ferrari form is enormous falls back, said", () => {
  it.each(["x^4 + x + 1 = 0", "x^4 - x - 1 = 0", "x^4 + 3x + 1 = 0", "x^4 - 2x + 2 = 0"])("%s", (s) => {
    const r = timed(s);
    expect(r.method).toBe("complete (all roots)");
    expect(r.caveats[0]).toMatch(/a closed form exists \(Ferrari\)/);
    expect(r.roots.every((x) => !x.exact)).toBe(true);
  });
});

describe("callers that count roots honour the multiplicity field", () => {
  it("recurrence: characteristic (r² − 2)² keeps its n·rⁿ terms", () => {
    const r = tryRecurrence("a(n) = 4a(n-2) - 4a(n-4), a(0)=1, a(1)=1, a(2)=1, a(3)=1");
    const text = JSON.stringify(r);
    expect(text).toMatch(/multiplicity 2/);
    expect(text).toMatch(/n·\(1\.414213562\)ⁿ/);
    expect(text).toMatch(/Verified: the closed form reproduces/);
  });
});

describe("randomised: degree 3–8 integer polynomials (deterministic)", () => {
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const cases: number[][] = [];
  for (let k = 0; k < 60; k++) {
    const deg = 3 + Math.floor(rnd() * 6);
    const c = Array.from({ length: deg + 1 }, () => Math.floor(rnd() * 19) - 9);
    if (c[deg] === 0) c[deg] = 1;
    cases.push(c);
  }
  it.each(cases.map((c) => [c.map((v, k) => `(${v})*x^${k}`).join(" + "), c]))("%s", (_s, c) => {
    const coeffs = c as number[];
    const eq = coeffs.map((v, k) => `(${v})*x^${k}`).join(" + ") + " = 0";
    const r = timed(eq);
    const deg = coeffs.length - 1 - [...coeffs].reverse().findIndex((v) => v !== 0);
    if (deg < 3) return;
    expect(total(r)).toBe(deg);
    for (const root of r.roots) expect(relResidual(coeffs.slice(0, deg + 1), root.re, root.im)).toBeLessThan(1e-9);
    expectContract(r);
  });
});
