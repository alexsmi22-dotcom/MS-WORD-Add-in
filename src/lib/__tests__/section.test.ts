// Section-property tests.
//
// The strong ones here are the INDEPENDENT CROSS-CHECKS: every shape's second
// moment of area and first moment Q are recomputed by numerically integrating a
// width(y) profile that is written directly from the shape's dimensions, not
// from the signed-strip decomposition under test. A transcription error in the
// strips cannot survive that, whereas comparing the implementation against a
// closed form I typed from the same mental model can.
//
// The tau checks are the other kind of independent oracle: tau_max = 3V/2A for a
// rectangle and 4V/3A for a circle are textbook results that fall out of VQ/It
// only if BOTH Q and t are right.

import { sectionProperties, bendingStress, SectionSpec, SectionProps } from "../section";

function props(spec: SectionSpec): SectionProps {
  const p = sectionProperties(spec);
  if ("error" in p) throw new Error(`expected properties, got: ${p.error}`);
  return p;
}

/**
 * Width of the section at height y above the bottom fibre — written from the
 * dimensions, independently of the implementation's strip decomposition.
 *
 * `breaks` lists the heights where the width STEPS. Integrating across a step
 * with Simpson's rule is what makes a quadrature check lie: the first run of
 * this file failed the box, I-beam and tee on AREA by 1e-4, which looked like a
 * bug and was not. The error is panel-width times the size of the jump — for
 * the I-beam, (300/20000) x 142 / 5808 = 3.7e-4, which is what came out. The
 * profiles are exactly right and the quadrature was wrong. Splitting the
 * integral at every step makes each piece a polynomial, where Simpson is exact,
 * and lets the tolerance drop from 1e-6 to 1e-12.
 */
function widthProfile(spec: SectionSpec): { w: (y: number) => number; depth: number; breaks: number[] } {
  switch (spec.kind) {
    case "rect":
      return { w: () => spec.b, depth: spec.h, breaks: [] };
    case "box":
      return {
        w: (y) => (y > spec.t && y < spec.h - spec.t ? 2 * spec.t : spec.b),
        depth: spec.h,
        breaks: [spec.t, spec.h - spec.t],
      };
    case "ibeam":
      return {
        w: (y) => (y < spec.tf || y > spec.d - spec.tf ? spec.bf : spec.tw),
        depth: spec.d,
        breaks: [spec.tf, spec.d - spec.tf],
      };
    case "tee":
      return {
        w: (y) => (y > spec.d - spec.tf ? spec.bf : spec.tw),
        depth: spec.d,
        breaks: [spec.d - spec.tf],
      };
    case "circle":
      return {
        w: (y) => {
          const r = spec.d / 2;
          const dy = y - r;
          const s = r * r - dy * dy;
          return s > 0 ? 2 * Math.sqrt(s) : 0;
        },
        depth: spec.d,
        breaks: [],
      };
    case "pipe":
      return {
        w: (y) => {
          const ro = spec.d / 2;
          const ri = ro - spec.t;
          const dy = y - ro;
          const so = ro * ro - dy * dy;
          const si = ri * ri - dy * dy;
          return (so > 0 ? 2 * Math.sqrt(so) : 0) - (si > 0 ? 2 * Math.sqrt(si) : 0);
        },
        depth: spec.d,
        breaks: [spec.t, spec.d - spec.t],
      };
  }
}

/**
 * Composite 2-point Gauss-Legendre. Exact for cubics on each panel, and — the
 * reason it is used here rather than Simpson — it NEVER EVALUATES AT A PANEL
 * ENDPOINT. Simpson does, and at a step in the width the endpoint lands exactly
 * on the discontinuity where `y > d - tf ? bf : tw` picks the wrong side. That
 * left a residual 4.3e-5 on the tee even after splitting at the break: the
 * endpoint weight h/3 times the 140 mm jump, over an area of 4100. Sampling
 * strictly inside each panel removes it entirely.
 */
function gauss(f: (x: number) => number, a: number, b: number, n: number): number {
  if (b <= a) return 0;
  const h = (b - a) / n;
  const off = h / (2 * Math.sqrt(3));
  let s = 0;
  for (let i = 0; i < n; i++) {
    const mid = a + h * (i + 0.5);
    s += f(mid - off) + f(mid + off);
  }
  return s * (h / 2);
}

/** Integrate over each smooth piece, so a step in the integrand is never straddled. */
function piecewise(f: (y: number) => number, a: number, b: number, breaks: number[], n: number): number {
  const cuts = [a, ...breaks.filter((c) => c > a && c < b).sort((p, q) => p - q), b];
  let total = 0;
  for (let i = 0; i + 1 < cuts.length; i++) total += gauss(f, cuts[i], cuts[i + 1], n);
  return total;
}

function numericCheck(spec: SectionSpec, tol: number): void {
  const p = props(spec);
  const { w, depth, breaks } = widthProfile(spec);
  const n = 4000;
  const A = piecewise(w, 0, depth, breaks, n);
  const Ay = piecewise((y) => y * w(y), 0, depth, breaks, n);
  const yBar = Ay / A;
  const I = piecewise((y) => (y - yBar) ** 2 * w(y), 0, depth, breaks, n);
  const Q = piecewise((y) => (y - yBar) * w(y), yBar, depth, breaks, n);
  expect(Math.abs(A / p.A - 1)).toBeLessThan(tol);
  expect(Math.abs(yBar / p.yBar - 1)).toBeLessThan(tol);
  expect(Math.abs(I / p.I - 1)).toBeLessThan(tol);
  expect(Math.abs(Q / p.Q - 1)).toBeLessThan(tol);
}

describe("closed forms", () => {
  test("rectangle", () => {
    const p = props({ kind: "rect", b: 50, h: 200 });
    expect(p.A).toBeCloseTo(10000, 9);
    expect(p.I).toBeCloseTo((50 * 200 ** 3) / 12, 6);
    expect(p.sTop).toBeCloseTo((50 * 200 ** 2) / 6, 6);
    expect(p.symmetric).toBe(true);
  });

  test("solid circle", () => {
    const d = 60;
    const p = props({ kind: "circle", d });
    expect(p.A).toBeCloseTo((Math.PI * d * d) / 4, 9);
    expect(p.I).toBeCloseTo((Math.PI * d ** 4) / 64, 6);
    expect(p.r).toBeCloseTo(d / 4, 9);
  });

  test("box is the outer rectangle minus the void", () => {
    const p = props({ kind: "box", b: 100, h: 150, t: 8 });
    expect(p.I).toBeCloseTo((100 * 150 ** 3 - 84 * 134 ** 3) / 12, 6);
    expect(p.tNA).toBeCloseTo(16, 9);
  });

  test("pipe", () => {
    const p = props({ kind: "pipe", d: 100, t: 5 });
    expect(p.I).toBeCloseTo((Math.PI * (100 ** 4 - 90 ** 4)) / 64, 6);
  });
});

describe("independent numerical cross-check of I, Q and the centroid", () => {
  const cases: [string, SectionSpec, number][] = [
    // Polygonal shapes: piecewise-constant width, so Simpson is exact on each
    // piece and the only error left is floating point.
    ["rectangle", { kind: "rect", b: 50, h: 200 }, 1e-12],
    ["box", { kind: "box", b: 100, h: 150, t: 8 }, 1e-12],
    ["I-beam", { kind: "ibeam", bf: 150, tf: 12, d: 300, tw: 8 }, 1e-12],
    ["tee", { kind: "tee", bf: 150, tf: 15, d: 200, tw: 10 }, 1e-12],
    // Curved boundaries have a vertical tangent at the extreme fibres, where the
    // width goes as sqrt of the distance. No amount of panel-splitting fixes
    // that, so the tolerance here is the QUADRATURE'S limit, not the
    // implementation's — the closed forms above pin these shapes tightly.
    ["circle", { kind: "circle", d: 60 }, 1e-5],
    ["pipe", { kind: "pipe", d: 100, t: 5 }, 1e-4],
  ];
  for (const [name, spec, tol] of cases) {
    test(name, () => numericCheck(spec, tol));
  }
});

describe("shear stress reproduces the textbook peaks", () => {
  test("rectangle gives tau_max = 3V/2A", () => {
    const p = props({ kind: "rect", b: 40, h: 120 });
    const V = 9000;
    const { tau } = bendingStress(p, 0, V);
    expect(tau).toBeCloseTo((1.5 * V) / p.A, 9);
  });

  test("circle gives tau_max = 4V/3A", () => {
    const p = props({ kind: "circle", d: 80 });
    const V = 5000;
    const { tau } = bendingStress(p, 0, V);
    expect(tau).toBeCloseTo((4 * V) / (3 * p.A), 6);
  });
});

describe("non-symmetric sections", () => {
  test("a tee has two different section moduli and says so", () => {
    const p = props({ kind: "tee", bf: 150, tf: 15, d: 200, tw: 10 });
    expect(p.symmetric).toBe(false);
    expect(Math.abs(p.sTop - p.sBot)).toBeGreaterThan(0.1 * Math.max(p.sTop, p.sBot));
    expect(p.notes.join(" ")).toMatch(/different section moduli/i);
  });

  test("the governing fibre is the one with the smaller modulus", () => {
    const p = props({ kind: "tee", bf: 150, tf: 15, d: 200, tw: 10 });
    const s = bendingStress(p, 25e6);
    const expected = 25e6 / Math.min(p.sTop, p.sBot);
    expect(s.sigma).toBeCloseTo(expected, 6);
    expect(s.fibre).toBe(p.sTop < p.sBot ? "top" : "bottom");
  });

  test("an I-beam IS symmetric, so both moduli agree", () => {
    const p = props({ kind: "ibeam", bf: 150, tf: 12, d: 300, tw: 8 });
    expect(p.symmetric).toBe(true);
    expect(p.sTop).toBeCloseTo(p.sBot, 6);
  });
});

describe("refusals", () => {
  test("a wall thicker than half the section is refused, not folded to solid", () => {
    expect(sectionProperties({ kind: "box", b: 40, h: 40, t: 20 })).toHaveProperty("error");
    expect(sectionProperties({ kind: "pipe", d: 40, t: 20 })).toHaveProperty("error");
  });

  test("flanges deeper than the section are refused", () => {
    expect(sectionProperties({ kind: "ibeam", bf: 100, tf: 60, d: 100, tw: 8 })).toHaveProperty("error");
    expect(sectionProperties({ kind: "tee", bf: 100, tf: 120, d: 100, tw: 8 })).toHaveProperty("error");
  });

  test("non-positive dimensions are refused", () => {
    expect(sectionProperties({ kind: "rect", b: 0, h: 10 })).toHaveProperty("error");
    expect(sectionProperties({ kind: "circle", d: -5 })).toHaveProperty("error");
  });

  // Promoted from a scratch probe. Dimensions this small are POSITIVE AND
  // FINITE, so every input check passes, and I still underflows to exactly
  // zero — after which sigma = M/S divided by zero and the peak stress came
  // back as Infinity rather than as a refusal. The oracle tests could not have
  // found this: they only ever use sensible dimensions.
  test("dimensions that underflow the second moment are refused, not returned as Infinity", () => {
    for (const spec of [
      { kind: "rect" as const, b: 1e-300, h: 1e-300 },
      { kind: "circle" as const, d: 1e-200 },
      { kind: "ibeam" as const, bf: 1e-200, tf: 1e-201, d: 1e-200, tw: 1e-201 },
    ]) {
      const p = sectionProperties(spec);
      expect(p).toHaveProperty("error");
    }
  });

  test("every shape either refuses or returns finite properties throughout", () => {
    const specs: SectionSpec[] = [
      { kind: "rect", b: 1e9, h: 1e-9 },
      { kind: "pipe", d: 100, t: 1e-6 },
      { kind: "box", b: 1e6, h: 1e6, t: 1 },
      { kind: "tee", bf: 1e-150, tf: 1e-150, d: 1e-149, tw: 1e-150 },
      { kind: "circle", d: 1e150 },
    ];
    for (const spec of specs) {
      const p = sectionProperties(spec);
      if ("error" in p) continue;
      for (const [k, v] of Object.entries(p)) {
        if (typeof v === "number") expect({ shape: spec.kind, k, finite: Number.isFinite(v) }).toEqual({ shape: spec.kind, k, finite: true });
      }
    }
  });
});
