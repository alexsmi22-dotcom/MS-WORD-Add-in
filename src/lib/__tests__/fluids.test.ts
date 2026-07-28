// Oracle tests for pipe flow and heat transfer.
//
// The friction-factor cases are checked by SUBSTITUTING BACK INTO COLEBROOK'S
// EQUATION rather than against a value copied from a Moody chart. Reading a
// chart to three figures is not possible, and a test that asserts what the code
// already returned proves nothing. Substitution checks the thing that actually
// has to be true.

import { analyzePipe, colebrook, waterProperties, G, PipeResult } from "../fluids";
import { analyzeWall, analyzeExchanger, WallResult, ExchangerResult } from "../heat";

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

const water20 = { rho: 998.2, mu: 1.002e-3 };

function pipe(over: Partial<Parameters<typeof analyzePipe>[0]> = {}): PipeResult {
  const r = analyzePipe({ D: 0.1, L: 100, V: 2, eps: 4.5e-5, ...water20, ...over });
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("Colebrook-White", () => {
  test("the returned factor satisfies the equation it solves", () => {
    for (const Re of [4000, 1e4, 5e4, 1e5, 1e6, 1e7, 1e8]) {
      for (const rel of [0, 1e-6, 1e-4, 1e-3, 1e-2, 5e-2]) {
        const f = colebrook(Re, rel);
        expect(f).not.toBeNull();
        const lhs = 1 / Math.sqrt(f as number);
        const rhs = -2 * Math.log10(rel / 3.7 + 2.51 / (Re * Math.sqrt(f as number)));
        near(lhs, rhs, 1e-10);
      }
    }
  });

  test("a smooth pipe at Re = 1e5 is close to the Blasius correlation", () => {
    // Blasius, f = 0.316 Re^-0.25, is an independent fit valid for smooth pipes
    // to Re = 1e5. Agreement to a couple of percent is the expected accuracy.
    const f = colebrook(1e5, 0) as number;
    const blasius = 0.316 * Math.pow(1e5, -0.25);
    expect(Math.abs(f - blasius) / blasius).toBeLessThan(0.03);
  });

  test("roughness raises the friction factor and Reynolds number lowers it", () => {
    const smooth = colebrook(1e5, 0) as number;
    const rough = colebrook(1e5, 1e-3) as number;
    expect(rough).toBeGreaterThan(smooth);
    expect(colebrook(1e6, 0) as number).toBeLessThan(smooth);
  });

  test("a fully rough pipe becomes independent of Reynolds number", () => {
    // The physical signature of the fully rough regime: f stops changing with Re.
    const a = colebrook(1e7, 1e-2) as number;
    const b = colebrook(1e8, 1e-2) as number;
    expect(Math.abs(a - b) / a).toBeLessThan(0.01);
  });

  test("nonsense arguments give null rather than a number", () => {
    expect(colebrook(0, 1e-4)).toBeNull();
    expect(colebrook(-100, 1e-4)).toBeNull();
    expect(colebrook(NaN, 1e-4)).toBeNull();
    expect(colebrook(1e5, -1)).toBeNull();
  });
});

describe("pipe flow", () => {
  test("Reynolds number and flow rate follow from the geometry", () => {
    const r = pipe();
    near(r.Re, (998.2 * 2 * 0.1) / 1.002e-3);
    near(r.Q, 2 * Math.PI * 0.0025);
    expect(r.regime).toBe("turbulent");
  });

  test("head loss is the Darcy-Weisbach form", () => {
    const r = pipe();
    near(r.hMajor, (r.f * 100 * 2 * 2) / (0.1 * 2 * G));
    near(r.dp, 998.2 * G * r.hTotal);
  });

  test("laminar flow uses f = 64/Re exactly and ignores roughness", () => {
    // Very low velocity in a small pipe: Re about 200.
    const r = pipe({ D: 0.01, V: 0.02 });
    expect(r.regime).toBe("laminar");
    near(r.f, 64 / r.Re);
    const rough = pipe({ D: 0.01, V: 0.02, eps: 1e-3 });
    near(rough.f, r.f);
    expect(rough.notes.join(" ")).toMatch(/roughness has NO effect/i);
  });

  test("the transition band returns a number and says it is unreliable", () => {
    // Choose a velocity landing Re between 2300 and 4000.
    const V = (3000 * 1.002e-3) / (998.2 * 0.01);
    const r = pipe({ D: 0.01, V });
    expect(r.regime).toBe("transition");
    expect(r.notes.join(" ")).toMatch(/TRANSITION band/);
    expect(r.notes.join(" ")).toMatch(/not repeatable|order-of-magnitude/i);
    expect(Number.isFinite(r.f)).toBe(true);
  });

  test("minor losses add K times the velocity head", () => {
    const bare = pipe();
    const withK = pipe({ sumK: 5 });
    near(withK.hMinor, (5 * 2 * 2) / (2 * G));
    near(withK.hTotal - bare.hTotal, withK.hMinor);
  });

  test("minor losses larger than the pipe friction are called out", () => {
    const r = pipe({ L: 1, sumK: 20 });
    expect(r.notes.join(" ")).toMatch(/calling them minor is misleading/i);
  });

  test("wall shear and lost power are consistent with the head loss", () => {
    const r = pipe({ sumK: 0 });
    near(r.tauWall, (r.f * 998.2 * 4) / 8);
    // A force balance on the pipe: the pressure drop acting on the cross-section
    // equals the wall shear acting on the wetted wall.
    near(r.dp * (Math.PI * 0.01) / 4, r.tauWall * Math.PI * 0.1 * 100);
    near(r.powerLost, r.dp * r.Q);
  });

  test("pump power divides by the efficiency", () => {
    const r = pipe({ eta: 0.7 });
    near(r.pumpPower as number, r.powerLost / 0.7);
    expect(pipe({ eta: 1.4 }).pumpPower).toBeNull();
    expect(pipe({ eta: 0 }).pumpPower).toBeNull();
  });

  test("flow rate may be given instead of velocity", () => {
    const byV = pipe({ V: 2 });
    const byQ = pipe({ V: undefined, Q: 2 * Math.PI * 0.0025 });
    near(byQ.V, byV.V);
    near(byQ.hTotal, byV.hTotal);
  });

  test("zero flow gives zero loss rather than a division by zero", () => {
    const r = pipe({ V: 0 });
    expect(r.hTotal).toBe(0);
    expect(r.dp).toBe(0);
    expect(Number.isNaN(r.f)).toBe(false);
  });

  test("non-physical inputs are refused", () => {
    const base = { D: 0.1, L: 100, V: 2, eps: 4.5e-5, ...water20 };
    expect(analyzePipe({ ...base, D: 0 }).ok).toBe(false);
    expect(analyzePipe({ ...base, rho: 0 }).ok).toBe(false);
    expect(analyzePipe({ ...base, mu: 0 }).ok).toBe(false);
    expect(analyzePipe({ ...base, eps: -1 }).ok).toBe(false);
    expect(analyzePipe({ ...base, V: -2 }).ok).toBe(false);
    expect(analyzePipe({ ...base, D: NaN }).ok).toBe(false);
    expect(analyzePipe({ ...base, V: undefined }).ok).toBe(false);
  });

  test("water properties interpolate and refuse to extrapolate", () => {
    const w = waterProperties(20) as { rho: number; mu: number };
    near(w.rho, 998.2);
    near(w.mu, 1.002e-3);
    const mid = waterProperties(25) as { rho: number; mu: number };
    expect(mid.rho).toBeLessThan(998.2);
    expect(mid.rho).toBeGreaterThan(995.7);
    expect(waterProperties(-5)).toBeNull();
    expect(waterProperties(150)).toBeNull();
    expect(waterProperties(NaN)).toBeNull();
  });
});

describe("composite wall", () => {
  // A plane wall, 1 m^2, one layer 0.2 m of k = 0.5, films of 10 and 25.
  // R = 1/10 + 0.2/0.5 + 1/25 = 0.1 + 0.4 + 0.04 = 0.54 K/W exactly.
  const plane = () =>
    analyzeWall({
      geometry: "plane",
      layers: [{ name: "Brick", k: 0.5, t: 0.2 }],
      A: 1,
      hIn: 10,
      hOut: 25,
      tIn: 20,
      tOut: -5,
    }) as WallResult;

  test("series resistances add and give the heat rate", () => {
    const r = plane();
    near(r.Rtotal, 0.54);
    near(r.Q, 25 / 0.54);
    near(r.U, 1 / 0.54);
  });

  test("interface temperatures drop in proportion to each resistance", () => {
    const r = plane();
    const Q = 25 / 0.54;
    near(r.steps[0].tAfter, 20 - Q * 0.1);
    near(r.steps[1].tAfter, 20 - Q * 0.5);
    // The last step must land exactly on the outside fluid temperature.
    near(r.steps[2].tAfter, -5, 1e-8);
  });

  test("the controlling resistance is identified", () => {
    const r = plane();
    expect(r.controlling).toBe("Brick");
    expect(r.steps.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 12);
  });

  test("adding insulation reduces the heat rate for a plane wall", () => {
    const bare = plane();
    const insulated = analyzeWall({
      geometry: "plane",
      layers: [
        { name: "Brick", k: 0.5, t: 0.2 },
        { name: "Mineral wool", k: 0.04, t: 0.1 },
      ],
      A: 1,
      hIn: 10,
      hOut: 25,
      tIn: 20,
      tOut: -5,
    }) as WallResult;
    expect(Math.abs(insulated.Q)).toBeLessThan(Math.abs(bare.Q));
    expect(insulated.controlling).toBe("Mineral wool");
    expect(insulated.notes.join(" ")).toMatch(/controls this wall/i);
  });

  test("a cylinder uses the logarithmic resistance, not the plane one", () => {
    const r = analyzeWall({
      geometry: "cylinder",
      layers: [{ name: "Insulation", k: 0.04, t: 0.02 }],
      r1: 0.02,
      L: 1,
      hIn: 0,
      hOut: 10,
      tIn: 100,
      tOut: 20,
    }) as WallResult;
    const Rcond = Math.log(0.04 / 0.02) / (2 * Math.PI * 0.04 * 1);
    const Rconv = 1 / (10 * 2 * Math.PI * 0.04 * 1);
    near(r.Rtotal, Rcond + Rconv);
    // The plane formula would give t/(kA) with some area — a different number.
    expect(Math.abs(r.Rtotal - 0.02 / (0.04 * 2 * Math.PI * 0.02))).toBeGreaterThan(1e-3);
  });

  // THE CRITICAL RADIUS. k/h = 0.04/10 = 0.004 m. A pipe of outer radius 0.003 m
  // is below it, so insulating it INCREASES the loss.
  test("insulation below the critical radius is called out as making things worse", () => {
    const r = analyzeWall({
      geometry: "cylinder",
      layers: [{ name: "Insulation", k: 0.04, t: 0.001 }],
      r1: 0.002,
      L: 1,
      hIn: 0,
      hOut: 10,
      tIn: 100,
      tOut: 20,
    }) as WallResult;
    near(r.criticalRadius as number, 0.004);
    expect(r.notes.join(" ")).toMatch(/MAKING THIS WORSE/);
  });

  test("and the physics behind that warning is real: more insulation, more loss", () => {
    const mk = (t: number) =>
      analyzeWall({
        geometry: "cylinder",
        layers: [{ name: "Insulation", k: 0.04, t }],
        r1: 0.002,
        L: 1,
        hIn: 0,
        hOut: 10,
        tIn: 100,
        tOut: 20,
      }) as WallResult;
    // Both thicknesses stay below the critical radius of 0.004 m.
    expect(mk(0.0015).Q).toBeGreaterThan(mk(0.0005).Q);
  });

  test("bad geometry and layers are refused", () => {
    const base = {
      geometry: "plane" as const,
      layers: [{ name: "X", k: 1, t: 0.1 }],
      A: 1,
      hIn: 10,
      hOut: 10,
      tIn: 20,
      tOut: 0,
    };
    expect(analyzeWall({ ...base, layers: [] }).ok).toBe(false);
    expect(analyzeWall({ ...base, A: 0 }).ok).toBe(false);
    expect(analyzeWall({ ...base, layers: [{ name: "X", k: 0, t: 0.1 }] }).ok).toBe(false);
    expect(analyzeWall({ ...base, layers: [{ name: "X", k: 1, t: 0 }] }).ok).toBe(false);
    expect(analyzeWall({ ...base, hIn: -1 }).ok).toBe(false);
    expect(analyzeWall({ ...base, tIn: NaN }).ok).toBe(false);
    expect(analyzeWall({ ...base, geometry: "cylinder", r1: 0 }).ok).toBe(false);
    expect(analyzeWall({ ...base, geometry: "cylinder", r1: 0.01, L: 0 }).ok).toBe(false);
  });
});

describe("heat exchanger", () => {
  // Counterflow, hot 150 -> 90, cold 30 -> 70.
  // dt1 = 150 - 70 = 80, dt2 = 90 - 30 = 60, LMTD = 20/ln(80/60) = 69.5...
  const base = { flow: "counter" as const, thIn: 150, thOut: 90, tcIn: 30, tcOut: 70, U: 500 };

  test("LMTD matches the closed form", () => {
    const r = analyzeExchanger({ ...base, A: 10 }) as ExchangerResult;
    near(r.dt1, 80);
    near(r.dt2, 60);
    near(r.lmtd, 20 / Math.log(80 / 60));
    near(r.Q, 500 * 10 * r.lmtd);
  });

  test("area and duty are inverses of each other", () => {
    const byArea = analyzeExchanger({ ...base, A: 10 }) as ExchangerResult;
    const byDuty = analyzeExchanger({ ...base, Q: byArea.Q }) as ExchangerResult;
    near(byDuty.A, 10);
  });

  // The removable singularity: equal terminal differences must give dt1, not NaN.
  test("equal terminal differences give the limit rather than a division by zero", () => {
    const r = analyzeExchanger({
      flow: "counter",
      thIn: 100,
      thOut: 60,
      tcIn: 40,
      tcOut: 80,
      U: 500,
      A: 10,
    }) as ExchangerResult;
    near(r.dt1, 20);
    near(r.dt2, 20);
    near(r.lmtd, 20);
    expect(Number.isNaN(r.lmtd)).toBe(false);
  });

  test("nearly equal terminal differences do not blow up either", () => {
    const r = analyzeExchanger({
      flow: "counter",
      thIn: 100,
      thOut: 60,
      tcIn: 40,
      tcOut: 80 - 1e-11,
      U: 500,
      A: 10,
    }) as ExchangerResult;
    expect(Number.isFinite(r.lmtd)).toBe(true);
    near(r.lmtd, 20, 1e-6);
  });

  test("LMTD always lies between the two terminal differences", () => {
    for (const [a, b] of [
      [80, 60],
      [100, 5],
      [5, 100],
      [30, 30],
    ]) {
      const r = analyzeExchanger({
        flow: "counter",
        thIn: 200,
        thOut: 200 - 1,
        tcIn: 200 - 1 - b,
        tcOut: 200 - a,
        U: 100,
        A: 1,
      });
      if (!r.ok) continue;
      expect(r.lmtd).toBeLessThanOrEqual(Math.max(r.dt1, r.dt2) + 1e-9);
      expect(r.lmtd).toBeGreaterThanOrEqual(Math.min(r.dt1, r.dt2) - 1e-9);
    }
  });

  test("counterflow permits a temperature cross and says so", () => {
    const r = analyzeExchanger({
      flow: "counter",
      thIn: 150,
      thOut: 60,
      tcIn: 30,
      tcOut: 90,
      U: 500,
      A: 10,
    }) as ExchangerResult;
    expect(r.crossed).toBe(true);
    expect(r.notes.join(" ")).toMatch(/CROSS/);
  });

  test("parallel flow refuses the same cross as impossible", () => {
    const r = analyzeExchanger({
      flow: "parallel",
      thIn: 150,
      thOut: 60,
      tcIn: 30,
      tcOut: 90,
      U: 500,
      A: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PARALLEL flow/);
  });

  test("parallel flow needs more area than counterflow for the same duty", () => {
    const c = analyzeExchanger({ ...base, Q: 300000 }) as ExchangerResult;
    const p = analyzeExchanger({ ...base, flow: "parallel", Q: 300000 }) as ExchangerResult;
    expect(p.A).toBeGreaterThan(c.A);
  });

  test("the counterflow report warns that a real unit needs the F correction", () => {
    const r = analyzeExchanger({ ...base, A: 10 }) as ExchangerResult;
    expect(r.notes.join(" ")).toMatch(/correction factor F/);
    expect(r.notes.join(" ")).toMatch(/LOWER BOUND/);
  });

  test("thermodynamically impossible temperatures are refused", () => {
    // Cold outlet above the hot inlet.
    expect(analyzeExchanger({ ...base, tcOut: 200, A: 1 }).ok).toBe(false);
    // Hot stream heating up.
    expect(analyzeExchanger({ ...base, thOut: 200, A: 1 }).ok).toBe(false);
    // Cold stream cooling down.
    expect(analyzeExchanger({ ...base, tcOut: 10, A: 1 }).ok).toBe(false);
    expect(analyzeExchanger({ ...base, U: 0, A: 1 }).ok).toBe(false);
    expect(analyzeExchanger({ ...base, A: 0 }).ok).toBe(false);
    expect(analyzeExchanger({ ...base }).ok).toBe(false);
    expect(analyzeExchanger({ ...base, thIn: NaN, A: 1 }).ok).toBe(false);
  });
});
