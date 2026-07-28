// Oracle tests for the open-channel, NPSH, compressible-flow and biomedical
// engines.
//
// The strongest checks here are the ones that verify a physical invariant rather
// than a formula: the critical depth found by bisection is confirmed to give
// Froude = 1 when fed back in, and the compressible relations are checked
// against the sonic condition they define.

import {
  openChannelFlow,
  npshAnalysis,
  compressibleFlow,
  MANNING_N,
  G,
  ChannelResult,
  NpshResult,
  CompressibleResult,
} from "../fluids";
import {
  vesselFlow,
  circulation,
  jointStatics,
  samplingCheck,
  PA_PER_MMHG,
  VesselResult,
  CirculationResult,
  JointResult,
  SamplingResult,
} from "../biomed";

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

// ---------------------------------------------------------------------------
describe("open-channel flow", () => {
  function chan(over: Partial<Parameters<typeof openChannelFlow>[0]> = {}): ChannelResult {
    const r = openChannelFlow({ shape: "rectangular", b: 3, y: 1, n: 0.013, S: 0.001, ...over });
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("rectangular geometry and Manning's equation match by hand", () => {
    const r = chan();
    near(r.area, 3);
    near(r.perimeter, 5);
    near(r.hydraulicRadius, 0.6);
    near(r.velocity, (1 / 0.013) * Math.pow(0.6, 2 / 3) * Math.sqrt(0.001));
    near(r.discharge, r.velocity * 3);
  });

  test("the Froude number uses the hydraulic depth", () => {
    // For a rectangle the hydraulic depth equals the flow depth.
    const r = chan();
    near(r.froude, r.velocity / Math.sqrt(G * 1));
  });

  // The independent check on the bisection.
  test("the critical depth really has Froude = 1 for the same discharge", () => {
    const r = chan();
    expect(r.criticalDepth).not.toBeNull();
    const yc = r.criticalDepth as number;
    // At the critical depth, Q^2*T/(g*A^3) = 1 for a rectangle: A = b*yc, T = b.
    const A = 3 * yc;
    const lhs = (r.discharge * r.discharge * 3) / (G * A * A * A);
    expect(Math.abs(lhs - 1)).toBeLessThan(1e-6);
  });

  test("regime is classified against the critical depth consistently", () => {
    const sub = chan({ S: 0.0005 });
    expect(sub.regime).toBe("subcritical");
    expect(sub.froude).toBeLessThan(1);
    // A steep slope drives the same channel supercritical.
    const sup = chan({ S: 0.05 });
    expect(sup.regime).toBe("supercritical");
    expect(sup.froude).toBeGreaterThan(1);
    expect(sup.notes.join(" ")).toMatch(/HYDRAULIC JUMP/);
  });

  test("subcritical flow is described as downstream-controlled", () => {
    expect(chan({ S: 0.0005 }).notes.join(" ")).toMatch(/controlled from DOWNSTREAM/);
  });

  test("a trapezoid has a larger area and perimeter than the rectangle it contains", () => {
    const rect = chan();
    const trap = chan({ shape: "trapezoidal", z: 2 });
    expect(trap.area).toBeGreaterThan(rect.area);
    expect(trap.perimeter).toBeGreaterThan(rect.perimeter);
    near(trap.area, (3 + 2 * 1) * 1);
    near(trap.perimeter, 3 + 2 * 1 * Math.sqrt(5));
  });

  test("a triangular channel matches its closed form", () => {
    const r = chan({ shape: "triangular", b: undefined, z: 1.5 });
    near(r.area, 1.5 * 1 * 1);
    near(r.perimeter, 2 * 1 * Math.sqrt(1 + 2.25));
  });

  test("a half-full circular pipe has the expected geometry", () => {
    const r = chan({ shape: "circular", b: undefined, D: 2, y: 1 });
    // Half full: area = pi*R^2/2 = pi/2, perimeter = pi*R = pi.
    near(r.area, Math.PI / 2, 1e-9);
    near(r.perimeter, Math.PI, 1e-9);
  });

  test("specific energy is depth plus velocity head", () => {
    const r = chan();
    near(r.specificEnergy, 1 + (r.velocity * r.velocity) / (2 * G));
  });

  test("discharge is inversely proportional to Manning's n", () => {
    const a = chan({ n: 0.013 });
    const b = chan({ n: 0.026 });
    near(b.discharge, a.discharge / 2, 1e-9);
    expect(a.notes.join(" ")).toMatch(/dominant uncertainty/i);
  });

  test("the SI-versus-customary trap is stated", () => {
    expect(chan().notes.join(" ")).toMatch(/1\.486/);
  });

  test("the roughness table gives ranges rather than single values", () => {
    for (const m of MANNING_N) {
      expect(m.min).toBeLessThan(m.typical);
      expect(m.typical).toBeLessThan(m.max);
    }
  });

  test("non-physical channels are refused", () => {
    expect(openChannelFlow({ shape: "rectangular", b: 3, y: 0, n: 0.013, S: 0.001 }).ok).toBe(false);
    expect(openChannelFlow({ shape: "rectangular", b: 0, y: 1, n: 0.013, S: 0.001 }).ok).toBe(false);
    expect(openChannelFlow({ shape: "rectangular", b: 3, y: 1, n: 0, S: 0.001 }).ok).toBe(false);
    expect(openChannelFlow({ shape: "circular", D: 1, y: 2, n: 0.013, S: 0.001 }).ok).toBe(false);
  });

  test("a level channel is refused with the reason", () => {
    const r = openChannelFlow({ shape: "rectangular", b: 3, y: 1, n: 0.013, S: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/UNIFORM flow/);
  });
});

// ---------------------------------------------------------------------------
describe("NPSH and cavitation", () => {
  const BASE = {
    pSurface: 101325,
    pVapour: 2339, // water at 20 C
    rho: 998,
    staticHead: 2,
    suctionLosses: 0.5,
    npshRequired: 3,
  };
  function npsh(over: Partial<typeof BASE> = {}): NpshResult {
    const r = npshAnalysis({ ...BASE, ...over });
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("NPSH available matches the closed form", () => {
    const r = npsh();
    near(r.npshAvailable, (101325 - 2339) / (998 * G) + 2 - 0.5);
    near(r.margin, r.npshAvailable - 3);
  });

  test("a comfortable margin is not flagged as cavitating", () => {
    const r = npsh();
    expect(r.cavitating).toBe(false);
    expect(r.margin).toBeGreaterThan(0.5);
  });

  // The failure this tool exists for.
  test("a pump below its required NPSH is told it will cavitate", () => {
    const r = npsh({ npshRequired: 20 });
    expect(r.cavitating).toBe(true);
    expect(r.notes.join(" ")).toMatch(/WILL CAVITATE/);
    expect(r.notes.join(" ")).toMatch(/DISCHARGE side/);
  });

  test("hot liquid reduces the available NPSH", () => {
    // Water at 80 C has a vapour pressure of about 47.4 kPa.
    const cold = npsh({ pVapour: 2339 });
    const hot = npsh({ pVapour: 47400 });
    expect(hot.npshAvailable).toBeLessThan(cold.npshAvailable);
    expect(hot.notes.join(" ")).toMatch(/hotter/i);
  });

  test("a suction lift reduces NPSH relative to a flooded suction", () => {
    const flooded = npsh({ staticHead: 2 });
    const lift = npsh({ staticHead: -3 });
    near(flooded.npshAvailable - lift.npshAvailable, 5);
  });

  test("a thin margin is flagged even when not yet cavitating", () => {
    // NPSHa here is about 11.6 m, so 11.3 leaves a margin of 0.3 m — positive,
    // but inside the 0.5 m that practice wants.
    const r = npsh({ npshRequired: 11.3 });
    expect(r.cavitating).toBe(false);
    expect(r.margin).toBeLessThan(0.5);
    expect(r.notes.join(" ")).toMatch(/3%/);
  });

  test("pump power follows rho*g*Q*H over the efficiency", () => {
    const r = npsh({ Q: 0.05, head: 30, eta: 0.75 } as Partial<typeof BASE>);
    near(r.hydraulicPower as number, 998 * G * 0.05 * 30);
    near(r.shaftPower as number, (998 * G * 0.05 * 30) / 0.75);
  });

  test("a boiling liquid is refused", () => {
    const r = npshAnalysis({ ...BASE, pVapour: 101325 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already boiling/);
  });

  test("gauge pressure entered by mistake is caught", () => {
    expect(npshAnalysis({ ...BASE, pSurface: 0 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("compressible flow", () => {
  function comp(m: number, k = 1.4): CompressibleResult {
    const r = compressibleFlow(m, k);
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("stagnation ratios match the isentropic relations", () => {
    const m = 0.8;
    const r = comp(m);
    const t = 1 + 0.2 * m * m;
    near(r.temperatureRatio, t);
    near(r.pressureRatio, Math.pow(t, 3.5));
    near(r.densityRatio, Math.pow(t, 2.5));
  });

  test("at Mach 0 everything is 1 and the area ratio is infinite", () => {
    const r = comp(0);
    near(r.temperatureRatio, 1);
    near(r.pressureRatio, 1);
    expect(r.areaRatio).toBe(Infinity);
  });

  // The defining property of the sonic condition.
  test("at Mach 1 the pressure ratio is exactly the critical one and the area ratio is 1", () => {
    const r = comp(1);
    near(1 / r.pressureRatio, r.criticalPressureRatio, 1e-12);
    near(r.areaRatio, 1, 1e-12);
    expect(r.choked).toBe(true);
    expect(r.notes.join(" ")).toMatch(/CHOKED/);
  });

  test("the critical pressure ratio for air is 0.528", () => {
    expect(comp(1).criticalPressureRatio).toBeCloseTo(0.5283, 4);
  });

  test("the area ratio has a minimum at Mach 1 on both sides", () => {
    expect(comp(0.5).areaRatio).toBeGreaterThan(1);
    expect(comp(2).areaRatio).toBeGreaterThan(1);
    expect(comp(1).areaRatio).toBeCloseTo(1, 9);
  });

  test("regimes are classified and supersonic is explained", () => {
    expect(comp(0.5).regime).toBe("subsonic");
    expect(comp(1).regime).toBe("sonic");
    expect(comp(2).regime).toBe("supersonic");
    expect(comp(2).notes.join(" ")).toMatch(/BACKWARDS from intuition/);
  });

  test("the incompressible threshold is stated in both directions", () => {
    expect(comp(0.1).notes.join(" ")).toMatch(/effectively incompressible/);
    expect(comp(0.6).notes.join(" ")).toMatch(/compressibility matters/);
  });

  test("the speed of sound is right for air at standard temperature", () => {
    const r = compressibleFlow(0.5, 1.4, 288.15);
    if (!r.ok) throw new Error(r.error);
    expect(r.speedOfSound).toBeCloseTo(340.3, 0);
  });

  test("bad arguments are refused", () => {
    expect(compressibleFlow(-1).ok).toBe(false);
    expect(compressibleFlow(NaN).ok).toBe(false);
    expect(compressibleFlow(1, 0.9).ok).toBe(false);
    expect(compressibleFlow(1, 1.4, 0).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("haemodynamics", () => {
  const BASE = { radius: 0.002, length: 0.1, flow: 5e-6, viscosity: 3.5e-3, density: 1060 };
  function vessel(over: Partial<typeof BASE> = {}): VesselResult {
    const r = vesselFlow({ ...BASE, ...over });
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("resistance matches Poiseuille exactly", () => {
    const r = vessel();
    near(r.resistance, (8 * 3.5e-3 * 0.1) / (Math.PI * Math.pow(0.002, 4)));
    near(r.pressureDrop, r.resistance * 5e-6);
    near(r.pressureDropMmHg, r.pressureDrop / PA_PER_MMHG);
  });

  // The fourth power, which is the whole point.
  test("halving the radius multiplies resistance by sixteen", () => {
    const wide = vessel({ radius: 0.002 });
    const narrow = vessel({ radius: 0.001 });
    near(narrow.resistance / wide.resistance, 16, 1e-9);
  });

  test("a 20 percent narrowing more than doubles the resistance", () => {
    const wide = vessel({ radius: 0.002 });
    const narrow = vessel({ radius: 0.0016 });
    expect(narrow.resistance / wide.resistance).toBeGreaterThan(2.4);
    expect(wide.notes.join(" ")).toMatch(/fourth power/i);
  });

  test("wall shear stress matches its closed form", () => {
    const r = vessel();
    near(r.wallShearStress, (4 * 3.5e-3 * 5e-6) / (Math.PI * Math.pow(0.002, 3)));
  });

  test("low wall shear is flagged as where plaque forms", () => {
    const r = vessel({ flow: 1e-7 });
    expect(r.wallShearStress).toBeLessThan(0.4);
    expect(r.notes.join(" ")).toMatch(/plaque forms preferentially/);
  });

  test("turbulence is detected and the Poiseuille caveat raised", () => {
    const r = vessel({ radius: 0.015, flow: 1e-3 });
    expect(r.reynolds).toBeGreaterThan(2300);
    expect(r.turbulent).toBe(true);
    expect(r.notes.join(" ")).toMatch(/bruit/);
  });

  test("the rigid-Newtonian-steady caveat is always present", () => {
    expect(vessel().notes.join(" ")).toMatch(/RIGID straight tube/);
  });

  test("non-physical vessels are refused", () => {
    expect(vesselFlow({ ...BASE, radius: 0 }).ok).toBe(false);
    expect(vesselFlow({ ...BASE, viscosity: 0 }).ok).toBe(false);
    expect(vesselFlow({ ...BASE, flow: -1 }).ok).toBe(false);
    expect(vesselFlow({ ...BASE, length: NaN }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("circulation", () => {
  function circ(over: Partial<Parameters<typeof circulation>[0]> = {}): CirculationResult {
    const r = circulation({ mapMmHg: 93, cvpMmHg: 5, cardiacOutputLmin: 5, ...over });
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("the clinical SVR formula is 80*(MAP-CVP)/CO", () => {
    near(circ().svrClinical, (80 * (93 - 5)) / 5);
  });

  test("a normal SVR lands in the usual range", () => {
    const r = circ();
    expect(r.svrClinical).toBeGreaterThan(800);
    expect(r.svrClinical).toBeLessThan(1600);
  });

  test("the SI and clinical resistances describe the same thing", () => {
    const r = circ();
    // dyn*s/cm^5 to Pa*s/m^3 is a factor of 1e5. They agree to about 0.01%
    // rather than exactly, because the clinical constant 80 is rounded from
    // 79.99 — which the result says.
    near(r.svrSI, r.svrClinical * 1e5, 1e-3);
    expect(r.notes.join(" ")).toMatch(/rounded from 79\.99/);
  });

  test("the driving pressure is MAP minus CVP, and it is said", () => {
    const withCvp = circ({ cvpMmHg: 20 });
    const withoutCvp = circ({ cvpMmHg: 0 });
    expect(withCvp.svrClinical).toBeLessThan(withoutCvp.svrClinical);
    expect(withCvp.notes.join(" ")).toMatch(/MAP minus CVP/);
  });

  test("a vasodilated and a vasoconstricted pattern are both named", () => {
    expect(circ({ cardiacOutputLmin: 12 }).notes.join(" ")).toMatch(/sepsis/i);
    expect(circ({ cardiacOutputLmin: 2.5 }).notes.join(" ")).toMatch(/cardiogenic/i);
  });

  test("stroke volume and cardiac index follow from rate and body size", () => {
    const r = circ({ heartRate: 70, bsa: 1.8 });
    near(r.strokeVolume as number, (5 * 1000) / 70);
    near(r.cardiacIndex as number, 5 / 1.8);
  });

  test("a low cardiac index is flagged against the shock threshold", () => {
    const r = circ({ cardiacOutputLmin: 3, bsa: 2.0 });
    expect(r.cardiacIndex as number).toBeLessThan(2.2);
    expect(r.notes.join(" ")).toMatch(/cardiogenic shock/);
  });

  test("an impossible pressure gradient is refused", () => {
    expect(circulation({ mapMmHg: 10, cvpMmHg: 20, cardiacOutputLmin: 5 }).ok).toBe(false);
    expect(circulation({ mapMmHg: 93, cvpMmHg: 5, cardiacOutputLmin: 0 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("joint statics", () => {
  const BASE = { load: 100, loadArm: 0.35, muscleArm: 0.05 };
  function joint(over: Partial<Parameters<typeof jointStatics>[0]> = {}): JointResult {
    const r = jointStatics({ ...BASE, ...over });
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("moment balance gives the muscle force", () => {
    const r = joint();
    near(r.externalMoment, 100 * 0.35);
    near(r.muscleForce, (100 * 0.35) / 0.05);
  });

  // The third-class lever result.
  test("the muscle force is many times the load and it says so", () => {
    const r = joint();
    near(r.muscleForce, 700);
    expect(r.mechanicalAdvantage).toBeLessThan(1);
    expect(r.notes.join(" ")).toMatch(/THIRD-CLASS LEVER/);
    expect(r.notes.join(" ")).toMatch(/7\.0 times the external load/);
  });

  test("the joint reaction is reported and exceeds the load", () => {
    const r = joint();
    expect(r.jointReaction).toBeGreaterThan(100);
    expect(r.notes.join(" ")).toMatch(/JOINT REACTION FORCE/);
    expect(r.notes.join(" ")).toMatch(/most often left out/);
  });

  test("segment weight adds to the external moment", () => {
    const bare = joint();
    const withSeg = joint({ segmentWeight: 20, segmentArm: 0.15 });
    near(withSeg.externalMoment, 100 * 0.35 + 20 * 0.15);
    expect(withSeg.muscleForce).toBeGreaterThan(bare.muscleForce);
  });

  test("a non-perpendicular pull needs more force and the waste is quantified", () => {
    const perp = joint({ pullAngleDeg: 90 });
    const oblique = joint({ pullAngleDeg: 30 });
    near(oblique.muscleForce, perp.muscleForce / Math.sin(Math.PI / 6));
    expect(oblique.notes.join(" ")).toMatch(/only 50% of the muscle force/);
  });

  test("a pull along the bone produces no moment and is refused", () => {
    expect(jointStatics({ ...BASE, pullAngleDeg: 180 }).ok).toBe(false);
    expect(jointStatics({ ...BASE, pullAngleDeg: 0 }).ok).toBe(false);
  });

  test("the single-muscle indeterminacy caveat is stated", () => {
    expect(joint().notes.join(" ")).toMatch(/indeterminate/);
  });

  test("bad geometry is refused", () => {
    expect(jointStatics({ ...BASE, muscleArm: 0 }).ok).toBe(false);
    expect(jointStatics({ ...BASE, load: -1 }).ok).toBe(false);
    expect(jointStatics({ ...BASE, loadArm: NaN }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("sampling and aliasing", () => {
  function samp(fs: number, fmax: number, rec?: number, interf?: number): SamplingResult {
    const r = samplingCheck(fs, fmax, rec, interf);
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("the Nyquist frequency is half the sampling rate", () => {
    near(samp(1000, 100).nyquist, 500);
  });

  test("an adequate rate is confirmed with its margin", () => {
    const r = samp(1000, 100);
    expect(r.adequate).toBe(true);
    expect(r.notes.join(" ")).toMatch(/sound margin/);
  });

  // The irreversible failure.
  test("under-sampling is detected and the fold-down frequency computed", () => {
    // 900 Hz sampled at 1000 Hz folds to 100 Hz.
    const r = samp(1000, 900);
    expect(r.adequate).toBe(false);
    near(r.aliasedTo as number, 100);
    expect(r.notes.join(" ")).toMatch(/UNDER-SAMPLED/);
    expect(r.notes.join(" ")).toMatch(/not recoverable/);
    expect(r.notes.join(" ")).toMatch(/ANALOGUE/);
  });

  test("a bare-Nyquist rate is flagged as impractical", () => {
    const r = samp(220, 100);
    expect(r.adequate).toBe(true);
    expect(r.notes.join(" ")).toMatch(/not a practical design/);
    expect(r.notes.join(" ")).toMatch(/ECG/);
  });

  test("interference above Nyquist aliases and is named", () => {
    // Mains at 1050 Hz sampled at 1000 Hz would fold to 50 Hz.
    const r = samp(1000, 100, undefined, 1050);
    near(r.aliasedTo as number, 50);
    expect(r.notes.join(" ")).toMatch(/will ALIAS/);
  });

  test("interference below Nyquist is sampled correctly and is removable", () => {
    const r = samp(1000, 100, undefined, 50);
    near(r.aliasedTo as number, 50);
    expect(r.notes.join(" ")).toMatch(/notch filter/);
  });

  // The other half of the sampling trade.
  test("frequency resolution depends only on record length, not sampling rate", () => {
    const slow = samp(1000, 100, 4);
    const fast = samp(8000, 100, 4);
    near(slow.resolution as number, 0.25);
    near(fast.resolution as number, 0.25);
    expect(fast.samples as number).toBeGreaterThan(slow.samples as number);
    expect(slow.notes.join(" ")).toMatch(/ONLY on the record LENGTH/);
  });

  test("bad arguments are refused", () => {
    expect(samplingCheck(0, 100).ok).toBe(false);
    expect(samplingCheck(1000, 0).ok).toBe(false);
    expect(samplingCheck(NaN, 100).ok).toBe(false);
  });
});
