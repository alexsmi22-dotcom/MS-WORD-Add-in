// Optics tests. Every expected value is derived independently of the
// implementation — from a closed form, a textbook identity, or a case whose
// answer is fixed by physics — rather than from what the code happens to return.

import {
  photonRelations,
  gaussianBeam,
  waistForDivergence,
  systemMatrix,
  elementMatrix,
  qFromBeam,
  beamFromQ,
  propagateQ,
  resonator,
  pulseMetrics,
  refraction,
  airy,
  grating,
  fibre,
  C_LIGHT,
} from "../optics";

describe("photon relations", () => {
  test("1239.84 eV*nm is reproduced, not assumed", () => {
    // hc/e in eV*nm is a derived constant; check the code agrees with it.
    const r = photonRelations(1064, "nm")!;
    expect(r.energyEv).toBeCloseTo(1239.841984 / 1064, 9);
    expect(r.energyEv).toBeCloseTo(1.16526, 4);
  });

  test("frequency and wavenumber for 1064 nm", () => {
    const r = photonRelations(1064, "nm")!;
    expect(r.frequencyTHz).toBeCloseTo(C_LIGHT / 1064e-9 / 1e12, 6);
    expect(r.frequencyTHz).toBeCloseTo(281.76, 1);
    expect(r.wavenumberCm).toBeCloseTo(1e7 / 1064, 6); // 9398.5 cm^-1
  });

  test("telecom C band lands at the textbook 0.8 eV", () => {
    expect(photonRelations(1550, "nm")!.energyEv).toBeCloseTo(0.79990, 4);
  });

  test("every entry point agrees — round trips through all five units", () => {
    const base = photonRelations(800, "nm")!;
    for (const [v, u] of [
      [base.frequencyTHz, "THz"],
      [base.energyEv, "eV"],
      [base.energyJ, "J"],
      [base.wavenumberCm, "cm-1"],
      [0.8, "um"],
    ] as const) {
      expect(photonRelations(v, u)!.wavelengthNm).toBeCloseTo(800, 6);
    }
  });

  test("a medium changes the wavelength but not the photon", () => {
    const vac = photonRelations(1000, "nm", 1)!;
    const inGlass = photonRelations(1000, "nm", 1.5)!;
    // Given a 1000 nm wavelength measured IN the medium, the vacuum wavelength is longer.
    expect(inGlass.wavelengthNm).toBeCloseTo(1500, 6);
    expect(inGlass.energyEv).toBeLessThan(vac.energyEv);
    expect(inGlass.notes.join(" ")).toMatch(/VACUUM wavelength/);
  });

  test("non-physical inputs are refused, not returned as NaN", () => {
    expect(photonRelations(0, "nm")).toBeNull();
    expect(photonRelations(-5, "nm")).toBeNull();
    expect(photonRelations(NaN, "eV")).toBeNull();
    expect(photonRelations(Infinity, "THz")).toBeNull();
    expect(photonRelations(500, "nm", 0)).toBeNull();
  });
});

describe("Gaussian beams", () => {
  const lambda = 1064e-9;
  const w0 = 1e-3;

  test("Rayleigh range and divergence match the closed forms", () => {
    const g = gaussianBeam({ w0, lambda })!;
    expect(g.rayleighM).toBeCloseTo((Math.PI * w0 * w0) / lambda, 12);
    expect(g.rayleighM).toBeCloseTo(2.9526, 4);
    expect(g.thetaHalfRad).toBeCloseTo(lambda / (Math.PI * w0), 12);
  });

  test("the beam is sqrt(2) wider at one Rayleigh range — the defining property", () => {
    const zR = gaussianBeam({ w0, lambda })!.rayleighM;
    const at = gaussianBeam({ w0, lambda, z: zR })!;
    expect(at.wAtZ).toBeCloseTo(w0 * Math.SQRT2, 12);
    // Curvature is tightest at z = z_R, where R = 2*z_R.
    expect(at.rAtZ).toBeCloseTo(2 * zR, 9);
    expect(at.gouyRad).toBeCloseTo(Math.PI / 4, 12);
  });

  test("the wavefront is flat at the waist", () => {
    expect(gaussianBeam({ w0, lambda, z: 0 })!.rAtZ).toBe(Infinity);
  });

  test("M^2 shortens the Rayleigh range and widens the divergence, both linearly", () => {
    const a = gaussianBeam({ w0, lambda, m2: 1 })!;
    const b = gaussianBeam({ w0, lambda, m2: 4 })!;
    expect(b.rayleighM).toBeCloseTo(a.rayleighM / 4, 12);
    expect(b.thetaHalfRad).toBeCloseTo(a.thetaHalfRad * 4, 12);
    // BPP is M^2 * lambda/pi by definition.
    expect(b.bpp).toBeCloseTo((4 * lambda) / Math.PI, 15);
  });

  test("M^2 below 1 is refused — nothing beats the diffraction limit", () => {
    expect(gaussianBeam({ w0, lambda, m2: 0.5 })).toBeNull();
    expect(gaussianBeam({ w0: 0, lambda })).toBeNull();
    expect(gaussianBeam({ w0, lambda: -1 })).toBeNull();
  });

  test("waistForDivergence inverts gaussianBeam exactly", () => {
    const theta = gaussianBeam({ w0, lambda, m2: 2 })!.thetaHalfRad;
    expect(waistForDivergence(theta, lambda, 2)!).toBeCloseTo(w0, 12);
  });
});

describe("ABCD ray matrices", () => {
  test("a thin lens turns a parallel ray into one aimed at the focus", () => {
    const m = elementMatrix({ kind: "lens", f: 0.1 })!;
    // Ray (y=2mm, theta=0) -> theta' = -y/f.
    const y = 0.002;
    expect(m[0] * y + m[1] * 0).toBeCloseTo(y, 15);
    expect(m[2] * y + m[3] * 0).toBeCloseTo(-y / 0.1, 15);
  });

  test("every element matrix is unimodular where it must be", () => {
    // det = n1/n2 for a refracting surface, and exactly 1 for space, lens, mirror.
    const det = (m: number[]) => m[0] * m[3] - m[1] * m[2];
    expect(det(elementMatrix({ kind: "space", d: 0.3 })!)).toBeCloseTo(1, 15);
    expect(det(elementMatrix({ kind: "lens", f: 0.25 })!)).toBeCloseTo(1, 15);
    expect(det(elementMatrix({ kind: "mirror", R: 0.5 })!)).toBeCloseTo(1, 15);
    expect(det(elementMatrix({ kind: "flat", n1: 1, n2: 1.5 })!)).toBeCloseTo(1 / 1.5, 15);
    expect(det(elementMatrix({ kind: "curved", n1: 1, n2: 1.5, R: 0.1 })!)).toBeCloseTo(1 / 1.5, 15);
  });

  test("ORDER: the product runs opposite to the propagation order", () => {
    // Space then lens, in propagation order. Worked by hand:
    //   L*S = [[1,0],[-1/f,1]] * [[1,d],[0,1]] = [[1, d],[-1/f, 1 - d/f]]
    const d = 0.3;
    const f = 0.1;
    const m = systemMatrix([{ kind: "space", d }, { kind: "lens", f }])!;
    expect(m[0]).toBeCloseTo(1, 12);
    expect(m[1]).toBeCloseTo(d, 12);
    expect(m[2]).toBeCloseTo(-1 / f, 12);
    expect(m[3]).toBeCloseTo(1 - d / f, 12);

    // The reversed system is genuinely different, which is what makes the order
    // a trap: both are valid matrices and neither errors. Note B is d in BOTH
    // orders, so B is useless as the discriminator — it is A and D that swap:
    //   S*L = [[1 - d/f, d], [-1/f, 1]]
    const rev = systemMatrix([{ kind: "lens", f }, { kind: "space", d }])!;
    expect(rev[0]).toBeCloseTo(1 - d / f, 12);
    expect(rev[3]).toBeCloseTo(1, 12);
    expect(rev[0]).not.toBeCloseTo(m[0], 6);
    expect(rev[3]).not.toBeCloseTo(m[3], 6);
  });

  test("the imaging condition B = 0 reproduces the thin-lens equation", () => {
    // 1/s + 1/s' = 1/f with f = 100 mm, s = 150 mm gives s' = 300 mm.
    const f = 0.1;
    const s = 0.15;
    const sp = 1 / (1 / f - 1 / s);
    expect(sp).toBeCloseTo(0.3, 12);
    const m = systemMatrix([
      { kind: "space", d: s },
      { kind: "lens", f },
      { kind: "space", d: sp },
    ])!;
    expect(m[1]).toBeCloseTo(0, 12); // B = 0 <=> object and image are conjugate
    expect(m[0]).toBeCloseTo(-sp / s, 10); // A = transverse magnification, inverted
  });

  test("q-parameter round trip and free-space propagation", () => {
    const lambda = 1064e-9;
    const w0 = 5e-4;
    const q = qFromBeam(w0, Infinity, lambda)!;
    const back = beamFromQ(q, lambda)!;
    expect(back.w).toBeCloseTo(w0, 12);
    expect(back.R).toBe(Infinity);

    // Propagating a waist by z_R must widen it by sqrt(2) — same law as above,
    // reached through the matrix machinery instead.
    const zR = gaussianBeam({ w0, lambda })!.rayleighM;
    const moved = propagateQ(q, systemMatrix([{ kind: "space", d: zR }])!)!;
    expect(beamFromQ(moved, lambda)!.w).toBeCloseTo(w0 * Math.SQRT2, 12);
  });

  test("a lens focuses a collimated beam one focal length away", () => {
    const lambda = 632.8e-9;
    const w = 1e-3;
    const f = 0.2;
    // A large collimated beam at a lens, then propagate f.
    const q0 = qFromBeam(w, Infinity, lambda)!;
    const q1 = propagateQ(q0, systemMatrix([{ kind: "lens", f }, { kind: "space", d: f }])!)!;
    const out = beamFromQ(q1, lambda)!;
    // Focused waist ~ lambda*f/(pi*w) when the input Rayleigh range >> f.
    expect(out.w).toBeCloseTo((lambda * f) / (Math.PI * w), 7);
  });
});

describe("two-mirror resonator", () => {
  const lambda = 1064e-9;

  test("symmetric cavity matches the closed form for w0", () => {
    // Symmetric: w0^2 = (lambda*L/2pi) * sqrt((1+g)/(1-g)).
    const L = 0.5;
    const R = 1.0;
    const g = 1 - L / R;
    const r = resonator(L, R, R, lambda)!;
    expect(r.g1).toBeCloseTo(g, 15);
    expect(r.stable).toBe(true);
    const expected = Math.sqrt(((lambda * L) / (2 * Math.PI)) * Math.sqrt((1 + g) / (1 - g)));
    expect(r.waistM!).toBeCloseTo(expected, 12);
    // By symmetry the waist sits at the centre.
    expect(r.waistFromM1!).toBeCloseTo(L / 2, 12);
    expect(r.spot1M!).toBeCloseTo(r.spot2M!, 12);
  });

  test("unstable cavity reports no mode rather than a number", () => {
    // L between R and 2R for a symmetric cavity is unstable: L=1.5, R=1 -> g=-0.5,
    // g1g2 = 0.25 which IS stable; use L = 2.5 -> g = -1.5, g1g2 = 2.25.
    const r = resonator(2.5, 1, 1, lambda)!;
    expect(r.product).toBeCloseTo(2.25, 12);
    expect(r.stable).toBe(false);
    expect(r.waistM).toBeNull();
    expect(r.notes.join(" ")).toMatch(/UNSTABLE/);
  });

  test("confocal and plane-parallel are named as marginal, not reported as stable sizes", () => {
    const confocal = resonator(1, 1, 1, lambda)!; // g1=g2=0
    expect(confocal.product).toBeCloseTo(0, 12);
    expect(confocal.waistM).toBeNull();
    expect(confocal.notes.join(" ")).toMatch(/MARGINALLY stable/);

    const planar = resonator(0.5, Infinity, Infinity, lambda)!; // g1=g2=1
    expect(planar.g1).toBe(1);
    expect(planar.product).toBeCloseTo(1, 12);
    expect(planar.waistM).toBeNull();
    expect(planar.notes.join(" ")).toMatch(/MARGINALLY stable/);
  });

  test("hemispherical cavity is stable and asymmetric", () => {
    // One flat, one curved with L < R: g1 = 1, g2 = 1 - L/R.
    const r = resonator(0.09, Infinity, 0.1, lambda)!;
    expect(r.g1).toBe(1);
    expect(r.g2).toBeCloseTo(0.1, 12);
    expect(r.stable).toBe(true);
    // The waist sits ON the flat mirror for a hemispherical cavity.
    expect(r.waistFromM1!).toBeCloseTo(0, 9);
  });

  test("degenerate inputs are refused", () => {
    expect(resonator(0, 1, 1, lambda)).toBeNull();
    expect(resonator(-1, 1, 1, lambda)).toBeNull();
    expect(resonator(1, 1, 1, 0)).toBeNull();
  });
});

describe("pulses", () => {
  test("Gaussian peak power is 0.94 E/tau, not E/tau", () => {
    const r = pulseMetrics(1e-3, 10e-9, 1000, "gaussian")!;
    expect(r.averagePowerW).toBeCloseTo(1, 12);
    expect(r.peakPowerW).toBeCloseTo((2 * Math.sqrt(Math.log(2) / Math.PI) * 1e-3) / 10e-9, 6);
    expect(r.peakPowerW).toBeCloseTo(93943.7, 1);
    expect(r.dutyCycle).toBeCloseTo(1e-5, 15);
    expect(r.notes.join(" ")).toMatch(/not E\/tau/);
  });

  test("rectangular is exactly E/tau, and sech^2 sits between", () => {
    const rect = pulseMetrics(1e-3, 10e-9, 1000, "rectangular")!;
    expect(rect.peakPowerW).toBeCloseTo(1e5, 6);
    const sech = pulseMetrics(1e-3, 10e-9, 1000, "sech2")!;
    expect(sech.peakPowerW).toBeLessThan(pulseMetrics(1e-3, 10e-9, 1000, "gaussian")!.peakPowerW);
    expect(sech.peakPowerW).toBeLessThan(rect.peakPowerW);
  });

  test("peak fluence is TWICE the energy over the 1/e^2 area", () => {
    const w = 100e-6;
    const E = 1e-3;
    const r = pulseMetrics(E, 10e-9, 1000, "gaussian", w)!;
    const flatAverage = E / (Math.PI * w * w);
    expect(r.peakFluenceJm2!).toBeCloseTo(2 * flatAverage, 6);
  });

  test("a duty cycle above 1 is called out rather than silently returned", () => {
    const r = pulseMetrics(1e-3, 1e-3, 2000)!;
    expect(r.dutyCycle).toBeCloseTo(2, 12);
    expect(r.notes.join(" ")).toMatch(/greater than 1/);
  });

  test("non-physical inputs are refused", () => {
    expect(pulseMetrics(0, 1e-9, 1000)).toBeNull();
    expect(pulseMetrics(1e-3, 0, 1000)).toBeNull();
    expect(pulseMetrics(1e-3, 1e-9, -1)).toBeNull();
    expect(pulseMetrics(1e-3, 1e-9, 1000, "gaussian", 0)).toBeNull();
  });
});

describe("refraction", () => {
  test("glass to air: critical, Brewster and normal reflectance", () => {
    const r = refraction(1.5, 1.0, 30)!;
    expect(r.criticalDeg!).toBeCloseTo((Math.asin(1 / 1.5) * 180) / Math.PI, 12);
    expect(r.criticalDeg!).toBeCloseTo(41.81, 2);
    expect(r.brewsterDeg).toBeCloseTo((Math.atan(1 / 1.5) * 180) / Math.PI, 12);
    expect(r.brewsterDeg).toBeCloseTo(33.69, 2);
    expect(r.reflectanceNormal).toBeCloseTo(0.04, 12); // the familiar 4% per surface
    expect(r.thetaTDeg!).toBeCloseTo((Math.asin(1.5 * Math.sin(Math.PI / 6)) * 180) / Math.PI, 12);
  });

  test("beyond the critical angle there is no transmitted ray at all", () => {
    const r = refraction(1.5, 1.0, 60)!;
    expect(r.tir).toBe(true);
    expect(r.thetaTDeg).toBeNull();
    expect(r.notes.join(" ")).toMatch(/total internal reflection/i);
  });

  test("air to glass has NO critical angle, and says so instead of NaN", () => {
    const r = refraction(1.0, 1.5, 30)!;
    expect(r.criticalDeg).toBeNull();
    expect(r.tir).toBe(false);
    expect(r.notes.join(" ")).toMatch(/no critical angle/i);
    expect(Number.isNaN(r.thetaTDeg as number)).toBe(false);
  });

  test("Snell is self-consistent: the angle refracts back to where it came from", () => {
    const fwd = refraction(1.0, 1.5, 40)!;
    const back = refraction(1.5, 1.0, fwd.thetaTDeg!)!;
    expect(back.thetaTDeg!).toBeCloseTo(40, 9);
  });
});

describe("diffraction", () => {
  test("Airy half-angle and disc diameter", () => {
    const r = airy(500e-9, 0.01, 0.5)!;
    expect(r.airyHalfAngleRad).toBeCloseTo((1.22 * 500e-9) / 0.01, 15);
    expect(r.airyDiameterM!).toBeCloseTo((2.44 * 500e-9 * 0.5) / 0.01, 15);
    // The disc diameter is exactly twice the half-angle times f.
    expect(r.airyDiameterM!).toBeCloseTo(2 * r.airyHalfAngleRad * 0.5, 15);
  });

  test("grating orders that do not exist are omitted, not NaN", () => {
    // 600 lines/mm, 500 nm, normal incidence: sin(theta_m) = m*0.3.
    const r = grating(500e-9, 600, 0)!;
    const ms = r.orders.map((o) => o.m).sort((a, b) => a - b);
    expect(ms).toEqual([-3, -2, -1, 0, 1, 2, 3]); // |m*0.3| <= 1 => |m| <= 3
    expect(r.maxOrder).toBe(3);
    const first = r.orders.find((o) => o.m === 1)!;
    expect(first.angleDeg).toBeCloseTo((Math.asin(0.3) * 180) / Math.PI, 12);
    expect(first.angleDeg).toBeCloseTo(17.458, 3);
    expect(r.orders.every((o) => Number.isFinite(o.angleDeg))).toBe(true);
  });

  test("zeroth order is undeviated at normal incidence", () => {
    const r = grating(633e-9, 1200, 0)!;
    expect(r.orders.find((o) => o.m === 0)!.angleDeg).toBeCloseTo(0, 12);
  });

  test("a grating too fine for the wavelength has only the zeroth order", () => {
    // 3000 lines/mm, d = 333 nm < lambda: no first order exists.
    const r = grating(633e-9, 3000, 0)!;
    expect(r.orders.map((o) => o.m)).toEqual([0]);
    expect(r.maxOrder).toBe(0);
  });
});

describe("step-index fibre", () => {
  test("SMF-28-like fibre is single mode at 1550 nm", () => {
    const r = fibre(1.4570, 1.4520, 4.1e-6, 1550e-9)!;
    expect(r.na).toBeCloseTo(Math.sqrt(1.457 ** 2 - 1.452 ** 2), 12);
    expect(r.na).toBeCloseTo(0.1206, 4);
    expect(r.vNumber).toBeLessThan(2.405);
    expect(r.singleMode).toBe(true);
    expect(r.approxModes).toBeNull();
  });

  test("the same fibre is multimode at a short enough wavelength", () => {
    const r = fibre(1.4570, 1.4520, 4.1e-6, 400e-9)!;
    expect(r.singleMode).toBe(false);
    expect(r.approxModes).toBeCloseTo((r.vNumber * r.vNumber) / 2, 12);
    expect(r.notes.join(" ")).toMatch(/MULTIMODE/);
  });

  test("cutoff wavelength is the one where V = 2.405 exactly", () => {
    const r = fibre(1.4570, 1.4520, 4.1e-6, 1550e-9)!;
    const atCutoff = fibre(1.4570, 1.4520, 4.1e-6, r.cutoffWavelengthM)!;
    expect(atCutoff.vNumber).toBeCloseTo(2.405, 9);
  });

  test("a core that does not exceed the cladding cannot guide, and is refused", () => {
    expect(fibre(1.45, 1.45, 4e-6, 1550e-9)).toBeNull();
    expect(fibre(1.45, 1.46, 4e-6, 1550e-9)).toBeNull();
  });
});
