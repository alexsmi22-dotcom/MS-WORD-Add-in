// Oracle tests for the stress, torsion and buckling engines.
//
// Every expected value here is a closed form worked independently of the code
// under test — from the invariants of the stress tensor, from a Mohr's circle
// constructed by hand, or from the standard mechanics-of-materials formulas.

import {
  analyzeStress,
  transformPlane,
  factorOfSafety,
  analyzeTorsion,
  analyzeColumn,
  StressState,
  PrincipalResult,
} from "../stress";

const S = (sx: number, sy: number, txy: number, sz = 0, tyz = 0, tzx = 0): StressState => ({
  sx,
  sy,
  sz,
  txy,
  tyz,
  tzx,
});

function ok(s: StressState): PrincipalResult {
  const r = analyzeStress(s);
  if (!r.ok) throw new Error(`expected a result, got: ${r.error}`);
  return r;
}

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

describe("plane stress principal values", () => {
  // Hand-built Mohr circle: centre (80 + -40)/2 = 20, radius = sqrt(60^2 + 25^2) = 65.
  // So s1 = 85, s2 = -45, and the out-of-plane principal is 0.
  test("classic textbook state", () => {
    const r = ok(S(80, -40, 25));
    near(r.inPlane![0], 85);
    near(r.inPlane![1], -45);
    near(r.mohrCentre!, 20);
    near(r.mohrRadius!, 65);
    expect(r.plane).toBe(true);
    // The zero out-of-plane principal sits BETWEEN 85 and -45, so the absolute
    // and in-plane maximum shears agree here.
    near(r.tauInPlane!, 65);
    near(r.tauAbsMax, 65);
    near(r.principal[0], 85);
    near(r.principal[1], 0, 1e-6);
    near(r.principal[2], -45);
  });

  // THE TRAP THIS MODULE EXISTS FOR. Both principals positive, so the zero
  // out-of-plane principal is the MINIMUM and the absolute max shear is
  // (100 - 0)/2 = 50, not the in-plane (100 - 60)/2 = 20.
  test("biaxial tension: absolute max shear exceeds the in-plane value", () => {
    const r = ok(S(100, 60, 0));
    near(r.tauInPlane!, 20);
    near(r.tauAbsMax, 50);
    expect(r.notes.join(" ")).toMatch(/absolute maximum shear is LARGER/i);
  });

  test("pure shear gives equal and opposite principals at 45 degrees", () => {
    const r = ok(S(0, 0, 30));
    near(r.inPlane![0], 30);
    near(r.inPlane![1], -30);
    near(r.thetaP!, 45);
    near(r.tauInPlane!, 30);
    near(r.tauAbsMax, 30);
  });

  test("uniaxial tension is its own principal state at zero degrees", () => {
    const r = ok(S(120, 0, 0));
    near(r.inPlane![0], 120);
    near(r.inPlane![1], 0, 1e-6);
    near(r.thetaP!, 0);
    near(r.vonMises, 120);
    near(r.tresca, 120);
    // For uniaxial tension both criteria reduce to the applied stress exactly.
  });

  // atan2 is used precisely so this case is right: with sx < sy the naive
  // atan(2t/(sx-sy))/2 lands in the wrong quadrant and is off by 90 degrees.
  test("principal angle is correct when sy exceeds sx", () => {
    const r = ok(S(-40, 80, 25));
    // Centre 20, radius 65 again, so the same magnitudes as the first case.
    near(r.inPlane![0], 85);
    near(r.inPlane![1], -45);
    // s1 now lies close to the y axis rather than the x axis.
    expect(Math.abs(r.thetaP!)).toBeGreaterThan(45);
    // Rotating the state by the reported angle must diagonalise it.
    const t = transformPlane(-40, 80, 25, r.thetaP!) as { sxp: number; syp: number; txyp: number };
    near(t.sxp, 85);
    near(t.txyp, 0, 1e-6);
  });

  test("isotropic in-plane state reports that every direction is principal", () => {
    const r = ok(S(50, 50, 0));
    near(r.mohrRadius!, 0, 1e-9);
    expect(r.notes.join(" ")).toMatch(/every\s+direction is principal/i);
  });
});

describe("stress transformation", () => {
  // Rotating to the principal angle must zero the shear — the defining property.
  test("rotating to the principal angle removes the shear", () => {
    const r = ok(S(80, -40, 25));
    const t = transformPlane(80, -40, 25, r.thetaP!) as { sxp: number; syp: number; txyp: number };
    near(t.sxp, 85);
    near(t.syp, -45);
    near(t.txyp, 0, 1e-6);
  });

  test("the sum of normal stresses is invariant under rotation", () => {
    for (const deg of [0, 17, 45, 90, 133, 180, -60]) {
      const t = transformPlane(70, -25, 40, deg) as { sxp: number; syp: number; txyp: number };
      near(t.sxp + t.syp, 70 - 25);
    }
  });

  test("a 90 degree rotation swaps the normal stresses and flips the shear", () => {
    const t = transformPlane(70, -25, 40, 90) as { sxp: number; syp: number; txyp: number };
    near(t.sxp, -25);
    near(t.syp, 70);
    near(t.txyp, -40);
  });

  test("rotating by 45 degrees on pure shear gives pure normal stress", () => {
    const t = transformPlane(0, 0, 30, 45) as { sxp: number; syp: number; txyp: number };
    near(t.sxp, 30);
    near(t.syp, -30);
    near(t.txyp, 0, 1e-6);
  });
});

describe("three-dimensional states", () => {
  test("a diagonal tensor is already principal", () => {
    const r = ok(S(50, 20, 0, -10));
    near(r.principal[0], 50);
    near(r.principal[1], 20);
    near(r.principal[2], -10);
    near(r.tauAbsMax, 30);
    expect(r.plane).toBe(false);
  });

  test("principal stresses reproduce the tensor invariants", () => {
    const s = S(10, -20, 15, 35, -8, 22);
    const r = ok(s);
    const I1 = s.sx + s.sy + s.sz;
    const I3 =
      s.sx * s.sy * s.sz +
      2 * s.txy * s.tyz * s.tzx -
      s.sx * s.tyz * s.tyz -
      s.sy * s.tzx * s.tzx -
      s.sz * s.txy * s.txy;
    near(r.principal[0] + r.principal[1] + r.principal[2], I1, 1e-8);
    near(r.principal[0] * r.principal[1] * r.principal[2], I3, 1e-8);
    expect(r.principal[0]).toBeGreaterThanOrEqual(r.principal[1]);
    expect(r.principal[1]).toBeGreaterThanOrEqual(r.principal[2]);
  });

  test("a hydrostatic state has zero von Mises and zero shear", () => {
    const r = ok(S(100, 100, 0, 100));
    near(r.vonMises, 0, 1e-6);
    near(r.tauAbsMax, 0, 1e-6);
    near(r.hydrostatic, 100);
  });

  test("von Mises is unchanged by adding hydrostatic pressure", () => {
    // The defining property of the distortion-energy criterion: it depends only
    // on the deviatoric part, so a uniform pressure cannot cause yield.
    const a = ok(S(80, -40, 25));
    const b = ok(S(80 + 500, -40 + 500, 25, 500));
    near(a.vonMises, b.vonMises, 1e-8);
  });
});

describe("failure criteria", () => {
  test("Tresca is always the more conservative of the two", () => {
    for (const s of [S(80, -40, 25), S(100, 60, 0), S(0, 0, 30), S(120, 0, 0), S(10, -20, 15, 35, -8, 22)]) {
      const r = ok(s);
      expect(r.tresca).toBeGreaterThanOrEqual(r.vonMises - 1e-9);
    }
  });

  test("the two criteria never differ by more than about 15 percent", () => {
    // The extreme is pure shear, where Tresca/von Mises = 2/sqrt(3) = 1.1547.
    const r = ok(S(0, 0, 30));
    near(r.tresca / r.vonMises, 2 / Math.sqrt(3));
  });

  test("factor of safety divides yield by the equivalent stress", () => {
    const r = ok(S(120, 0, 0));
    const f = factorOfSafety(r, 250) as { vonMises: number; tresca: number };
    near(f.vonMises, 250 / 120);
    near(f.tresca, 250 / 120);
  });

  test("a non-positive yield strength is refused", () => {
    const r = ok(S(120, 0, 0));
    expect(factorOfSafety(r, 0)).toEqual({ ok: false, error: expect.any(String) });
    expect(factorOfSafety(r, -5)).toEqual({ ok: false, error: expect.any(String) });
  });

  test("an unstressed state has infinite factor of safety rather than a division by zero", () => {
    const r = ok(S(0, 0, 0));
    const f = factorOfSafety(r, 250) as { vonMises: number; tresca: number };
    expect(f.vonMises).toBe(Infinity);
    expect(f.tresca).toBe(Infinity);
  });
});

describe("torsion", () => {
  // Solid shaft: J = pi*d^4/32, tau = 16T/(pi*d^3).
  test("solid shaft matches the closed form", () => {
    const r = analyzeTorsion({ T: 1000, d: 0.05, di: 0, L: 0, G: 0 });
    if (!r.ok) throw new Error(r.error);
    near(r.J, (Math.PI * 0.05 ** 4) / 32);
    near(r.tauMax, (16 * 1000) / (Math.PI * 0.05 ** 3));
    expect(r.tauInner).toBe(0);
    expect(r.twistRad).toBeNull();
  });

  test("hollow shaft removes the core's contribution", () => {
    const r = analyzeTorsion({ T: 1000, d: 0.05, di: 0.03, L: 0, G: 0 });
    if (!r.ok) throw new Error(r.error);
    near(r.J, (Math.PI * (0.05 ** 4 - 0.03 ** 4)) / 32);
    // Stress varies linearly with radius, so the inner surface sees di/d of the peak.
    near(r.tauInner / r.tauMax, 0.03 / 0.05);
  });

  test("angle of twist is TL/GJ", () => {
    const T = 1200,
      d = 0.04,
      L = 1.5,
      G = 80e9;
    const r = analyzeTorsion({ T, d, di: 0, L, G });
    if (!r.ok) throw new Error(r.error);
    const J = (Math.PI * d ** 4) / 32;
    near(r.twistRad!, (T * L) / (G * J));
    near(r.twistDeg!, ((T * L) / (G * J)) * (180 / Math.PI));
  });

  test("a bore at least as large as the shaft is refused", () => {
    expect(analyzeTorsion({ T: 100, d: 0.05, di: 0.05, L: 0, G: 0 }).ok).toBe(false);
    expect(analyzeTorsion({ T: 100, d: 0.05, di: 0.06, L: 0, G: 0 }).ok).toBe(false);
  });

  test("a thin wall is flagged for buckling", () => {
    const r = analyzeTorsion({ T: 100, d: 0.1, di: 0.098, L: 0, G: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/thin-walled/i);
  });

  test("non-finite input is refused rather than propagated", () => {
    expect(analyzeTorsion({ T: NaN, d: 0.05, di: 0, L: 0, G: 0 }).ok).toBe(false);
    expect(analyzeTorsion({ T: 100, d: Infinity, di: 0, L: 0, G: 0 }).ok).toBe(false);
  });
});

describe("column buckling", () => {
  // Pcr = pi^2 EI / (KL)^2.
  test("pinned Euler load matches the closed form", () => {
    const E = 200e9,
      I = 1e-6,
      L = 3;
    const r = analyzeColumn({ L, E, I, A: 2e-3, Fy: 0, end: "pinned" });
    if (!r.ok) throw new Error(r.error);
    expect(r.K).toBe(1);
    near(r.pEuler, (Math.PI ** 2 * E * I) / L ** 2);
    expect(r.governs).toBe("euler-only");
  });

  test("effective length factors scale the critical load as 1/K^2", () => {
    const base = { L: 3, E: 200e9, I: 1e-6, A: 2e-3, Fy: 0 };
    const pinned = analyzeColumn({ ...base, end: "pinned" });
    const fixed = analyzeColumn({ ...base, end: "fixed" });
    const cantilever = analyzeColumn({ ...base, end: "fixed-free" });
    if (!pinned.ok || !fixed.ok || !cantilever.ok) throw new Error("expected results");
    // K = 0.5 quadruples the load; K = 2 quarters it.
    near(fixed.pEuler / pinned.pEuler, 4);
    near(cantilever.pEuler / pinned.pEuler, 0.25);
  });

  test("a slender column is governed by Euler", () => {
    const r = analyzeColumn({ L: 6, E: 200e9, I: 1e-6, A: 2e-3, Fy: 250e6, end: "pinned" });
    if (!r.ok) throw new Error(r.error);
    expect(r.governs).toBe("euler");
    near(r.pCritical, r.pEuler);
    // Slenderness above the transition is what makes Euler apply.
    expect(r.slenderness).toBeGreaterThan(r.slendernessTransition!);
  });

  // THE REASON JOHNSON IS HERE. A stocky column's Euler load is unreachable:
  // it implies a stress above yield. The critical load must be capped.
  test("a short column is governed by Johnson and never exceeds the squash load", () => {
    const r = analyzeColumn({ L: 0.4, E: 200e9, I: 1e-6, A: 2e-3, Fy: 250e6, end: "pinned" });
    if (!r.ok) throw new Error(r.error);
    expect(r.governs).toBe("johnson");
    expect(r.slenderness).toBeLessThan(r.slendernessTransition!);
    expect(r.pCritical).toBeLessThan(r.pEuler);
    expect(r.pCritical).toBeLessThanOrEqual(r.pSquash! + 1e-6);
    expect(r.notes.join(" ")).toMatch(/Euler load is not attainable/i);
  });

  test("Johnson and Euler agree at the transition slenderness", () => {
    // The parabola is constructed tangent to the hyperbola there, so the two
    // must give the same critical stress. Solve for the length that lands on it.
    const E = 200e9,
      Fy = 250e6,
      I = 1e-6,
      A = 2e-3;
    const rGyr = Math.sqrt(I / A);
    const lambdaC = Math.sqrt((2 * Math.PI ** 2 * E) / Fy);
    const L = lambdaC * rGyr; // K = 1
    const r = analyzeColumn({ L, E, I, A, Fy, end: "pinned" });
    if (!r.ok) throw new Error(r.error);
    near(r.slenderness, lambdaC, 1e-9);
    // At the transition the Euler stress is exactly half the yield stress.
    near(r.sigmaEuler, Fy / 2, 1e-9);
    near(r.pCritical, r.pEuler, 1e-8);
  });

  test("a custom K is honoured and a bad one refused", () => {
    const base = { L: 3, E: 200e9, I: 1e-6, A: 2e-3, Fy: 0 };
    const r = analyzeColumn({ ...base, end: "custom", kCustom: 0.65 });
    if (!r.ok) throw new Error(r.error);
    expect(r.K).toBe(0.65);
    near(r.Le, 0.65 * 3);
    expect(analyzeColumn({ ...base, end: "custom" }).ok).toBe(false);
    expect(analyzeColumn({ ...base, end: "custom", kCustom: 0 }).ok).toBe(false);
    expect(analyzeColumn({ ...base, end: "custom", kCustom: -1 }).ok).toBe(false);
  });

  test("non-positive geometry is refused", () => {
    const base = { L: 3, E: 200e9, I: 1e-6, A: 2e-3, Fy: 0, end: "pinned" as const };
    expect(analyzeColumn({ ...base, L: 0 }).ok).toBe(false);
    expect(analyzeColumn({ ...base, E: 0 }).ok).toBe(false);
    expect(analyzeColumn({ ...base, I: 0 }).ok).toBe(false);
    expect(analyzeColumn({ ...base, A: 0 }).ok).toBe(false);
    expect(analyzeColumn({ ...base, Fy: -1 }).ok).toBe(false);
    expect(analyzeColumn({ ...base, L: NaN }).ok).toBe(false);
    expect(analyzeColumn({ ...base, I: Infinity }).ok).toBe(false);
  });

  test("without a yield strength the report says the Euler figure may be unconservative", () => {
    const r = analyzeColumn({ L: 0.4, E: 200e9, I: 1e-6, A: 2e-3, Fy: 0, end: "pinned" });
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/unconservative/i);
  });
});
