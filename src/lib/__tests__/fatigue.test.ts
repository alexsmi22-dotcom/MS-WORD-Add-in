// Oracle tests for the fatigue engine.
//
// The expected values are standard Marin-factor and mean-stress closed forms
// worked independently of the code. The strongest checks here are the ones that
// verify the S-N construction against ITS OWN ENDPOINTS — the line must pass
// through 0.9*Sut at 10^3 cycles and Se at 10^6 — and the ordering of the four
// mean-stress criteria, which is a property of the criteria rather than of any
// particular number.

import {
  normalVariate,
  SURFACE_FACTORS,
  enduranceLimit,
  notchFactor,
  meanStressAnalysis,
  finiteLife,
  minerDamage,
  EnduranceInput,
  EnduranceResult,
  MeanStressResult,
  FiniteLifeResult,
  MinerResult,
} from "../fatigue";

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

// Typed as EnduranceInput rather than inferred: `as const` on the string fields
// would narrow them to single literals, and Partial<typeof BASE> would then
// reject every other surface finish and load type in the overrides below.
const BASE: EnduranceInput = {
  sut: 700,
  materialClass: "steel",
  surface: "machined",
  diameter: 25,
  load: "bending",
  tempC: 20,
  reliability: 0.5,
};

function endurance(over: Partial<EnduranceInput> = {}): EnduranceResult {
  const r = enduranceLimit({ ...BASE, ...over });
  if (!r.ok) throw new Error(r.error);
  return r;
}

// ---------------------------------------------------------------------------
describe("the reliability variate is derived, not tabulated", () => {
  test("it inverts the standard normal at the familiar points", () => {
    near(normalVariate(0.5) as number, 0, 1e-6);
    expect(Math.abs((normalVariate(0.9) as number) - 1.2816)).toBeLessThan(0.002);
    expect(Math.abs((normalVariate(0.95) as number) - 1.645)).toBeLessThan(0.002);
    expect(Math.abs((normalVariate(0.99) as number) - 2.326)).toBeLessThan(0.002);
    expect(Math.abs((normalVariate(0.999) as number) - 3.091)).toBeLessThan(0.003);
  });

  // ke = 1 - 0.08*z is the definition; the textbook table is that formula at
  // five points, so the derived values must reproduce it.
  test("the derived ke reproduces the textbook reliability table", () => {
    const table: [number, number][] = [
      [0.5, 1.0],
      [0.9, 0.897],
      [0.95, 0.868],
      [0.99, 0.814],
      [0.999, 0.753],
    ];
    for (const [rel, expected] of table) {
      const ke = 1 - 0.08 * (normalVariate(rel) as number);
      expect({ rel, ok: Math.abs(ke - expected) < 0.002 }).toEqual({ rel, ok: true });
    }
  });

  test("out-of-range reliabilities give null", () => {
    for (const v of [0, 1, -0.5, 1.5, NaN, Infinity]) expect(normalVariate(v)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("endurance limit", () => {
  test("the uncorrected limit is half the ultimate strength for steel", () => {
    near(endurance({ sut: 700 }).sePrime, 350);
    near(endurance({ sut: 1000 }).sePrime, 500);
  });

  test("above 1400 MPa the steel endurance limit plateaus at 700 MPa", () => {
    const r = endurance({ sut: 1800 });
    near(r.sePrime, 700);
    expect(r.notes.join(" ")).toMatch(/plateaus near 700/i);
    expect(r.notes.join(" ")).toMatch(/NO fatigue strength/);
  });

  test("the surface factor matches a*Sut^b", () => {
    for (const key of ["ground", "machined", "hot-rolled", "as-forged"] as const) {
      const sf = SURFACE_FACTORS[key];
      const r = endurance({ surface: key });
      near(r.ka, Math.min(1, sf.a * Math.pow(700, sf.b)));
    }
  });

  test("surface finish is the dominant factor and the ordering is right", () => {
    const ground = endurance({ surface: "ground" }).ka;
    const machined = endurance({ surface: "machined" }).ka;
    const hot = endurance({ surface: "hot-rolled" }).ka;
    const forged = endurance({ surface: "as-forged" }).ka;
    expect(ground).toBeGreaterThan(machined);
    expect(machined).toBeGreaterThan(hot);
    expect(hot).toBeGreaterThan(forged);
    // As-forged more than halves it relative to ground.
    expect(forged).toBeLessThan(ground / 2);
  });

  test("the size factor matches the piecewise fit and falls with diameter", () => {
    near(endurance({ diameter: 25 }).kb, 1.24 * Math.pow(25, -0.107));
    near(endurance({ diameter: 100 }).kb, 1.51 * Math.pow(100, -0.157));
    expect(endurance({ diameter: 100 }).kb).toBeLessThan(endurance({ diameter: 10 }).kb);
  });

  test("axial loading has no size factor but a smaller load factor", () => {
    const ax = endurance({ load: "axial" });
    expect(ax.kb).toBe(1);
    expect(ax.kc).toBe(0.85);
    expect(ax.notes.join(" ")).toMatch(/no size factor/i);
    expect(ax.notes.join(" ")).toMatch(/stress GRADIENT/i);
  });

  test("the load factors are the standard values", () => {
    expect(endurance({ load: "bending" }).kc).toBe(1);
    expect(endurance({ load: "axial" }).kc).toBe(0.85);
    expect(endurance({ load: "torsion" }).kc).toBe(0.59);
  });

  test("the corrected limit is the product of every factor", () => {
    const r = endurance({ reliability: 0.99, surface: "hot-rolled", diameter: 40, load: "torsion" });
    near(r.se, r.sePrime * r.ka * r.kb * r.kc * r.kd * r.ke);
    expect(r.se).toBeLessThan(r.sePrime);
  });

  // The result that matters most for a non-ferrous part.
  test("a non-ferrous material is told it has no endurance limit at all", () => {
    const r = endurance({ materialClass: "non-ferrous" });
    expect(r.notes.join(" ")).toMatch(/NO TRUE ENDURANCE LIMIT/);
    expect(r.notes.join(" ")).toMatch(/infinite-life design is not available/i);
  });

  test("creep temperatures are refused rather than derated", () => {
    const r = enduranceLimit({ ...BASE, tempC: 600 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/CREEP/);
  });

  test("a low temperature warns about brittle fracture instead", () => {
    expect(endurance({ tempC: -80 }).notes.join(" ")).toMatch(/BRITTLE/);
  });

  test("higher reliability lowers the endurance limit", () => {
    expect(endurance({ reliability: 0.999 }).se).toBeLessThan(endurance({ reliability: 0.9 }).se);
    near(endurance({ reliability: 0.5 }).ke, 1, 1e-6);
  });

  test("non-physical inputs are refused", () => {
    expect(enduranceLimit({ ...BASE, sut: 0 }).ok).toBe(false);
    expect(enduranceLimit({ ...BASE, diameter: 0 }).ok).toBe(false);
    expect(enduranceLimit({ ...BASE, reliability: 1 }).ok).toBe(false);
    expect(enduranceLimit({ ...BASE, tempC: NaN }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("notch sensitivity", () => {
  test("Kf equals 1 + q(Kt - 1)", () => {
    for (const [kt, q] of [
      [2, 0.8],
      [3, 0.6],
      [1.5, 1],
    ]) {
      const r = notchFactor(kt, q);
      if (!r.ok) throw new Error(r.error);
      near(r.kf, 1 + q * (kt - 1));
    }
  });

  test("q = 1 gives Kf = Kt and says it is the conservative default", () => {
    const r = notchFactor(3);
    if (!r.ok) throw new Error(r.error);
    expect(r.kf).toBe(3);
    expect(r.notes.join(" ")).toMatch(/CONSERVATIVE/);
  });

  test("q = 0 means the notch has no fatigue effect at all", () => {
    const r = notchFactor(3, 0);
    if (!r.ok) throw new Error(r.error);
    expect(r.kf).toBe(1);
  });

  test("a severe notch is called out", () => {
    const r = notchFactor(4);
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/generous fillet radius/i);
  });

  test("a Kt below 1 is refused, because a notch cannot reduce stress", () => {
    expect(notchFactor(0.9).ok).toBe(false);
    expect(notchFactor(2, 1.5).ok).toBe(false);
    expect(notchFactor(2, -0.1).ok).toBe(false);
    expect(notchFactor(NaN).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("mean stress criteria", () => {
  const SE = 250;
  const SUT = 700;
  const SY = 500;

  function ms(sa: number, sm: number, crit: Parameters<typeof meanStressAnalysis>[5] = "goodman"): MeanStressResult {
    const r = meanStressAnalysis(sa, sm, SE, SUT, SY, crit);
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("Goodman matches its closed form", () => {
    const r = ms(100, 200);
    near(r.nFatigue, 1 / (100 / SE + 200 / SUT));
  });

  test("Soderberg matches its closed form and is the most conservative", () => {
    const r = ms(100, 200, "soderberg");
    near(r.nFatigue, 1 / (100 / SE + 200 / SY));
    const all = r.comparison;
    const sod = all.find((c) => c.criterion === "soderberg")!.n;
    for (const c of all) expect(sod).toBeLessThanOrEqual(c.n + 1e-12);
  });

  test("Gerber is the least conservative", () => {
    const all = ms(100, 200).comparison;
    const ger = all.find((c) => c.criterion === "gerber")!.n;
    for (const c of all) expect(ger).toBeGreaterThanOrEqual(c.n - 1e-12);
  });

  test("the Gerber root really satisfies its own parabola", () => {
    // Substituting back is the independent check on the quadratic solve.
    const sa = 100,
      sm = 200;
    const n = ms(sa, sm, "gerber").nFatigue;
    const residual = (n * sa) / SE + ((n * sm) / SUT) ** 2 - 1;
    expect(Math.abs(residual)).toBeLessThan(1e-9);
  });

  test("with zero mean stress every criterion reduces to Se over the amplitude", () => {
    const r = ms(100, 0);
    for (const c of r.comparison) near(c.n, SE / 100, 1e-9);
  });

  test("the ASME ellipse matches its closed form", () => {
    const r = ms(100, 200, "asme-elliptic");
    near(r.nFatigue, 1 / Math.sqrt((100 / SE) ** 2 + (200 / SY) ** 2));
  });

  // The check none of the fatigue criteria performs.
  test("first-cycle yield can govern, and is reported when it does", () => {
    // A large mean stress with a small alternating one: Goodman is happy, the
    // part yields immediately.
    const r = ms(20, 470);
    expect(r.governedBy).toBe("first-cycle yield");
    expect(r.nYield).toBeLessThan(r.nFatigue);
    near(r.nGoverning, r.nYield);
    expect(r.notes.join(" ")).toMatch(/FIRST-CYCLE YIELD GOVERNS/);
    expect(r.notes.join(" ")).toMatch(/they do not know about yield/i);
  });

  test("fatigue governs in the ordinary case", () => {
    const r = ms(150, 100);
    expect(r.governedBy).toBe("fatigue");
    near(r.nGoverning, r.nFatigue);
  });

  test("the Langer yield factor matches Sy/(sa + sm)", () => {
    near(ms(100, 200).nYield, SY / 300);
  });

  // Compressive mean stress helps; feeding it in as negative would overstate it.
  test("a compressive mean stress is treated as zero and said to be", () => {
    const r = ms(100, -200);
    near(r.nFatigue, SE / 100);
    expect(r.notes.join(" ")).toMatch(/COMPRESSIVE and has been treated as zero/i);
    expect(r.notes.join(" ")).toMatch(/shot peening/i);
  });

  test("a failing factor of safety is called failure, not marginal", () => {
    expect(ms(240, 400).notes.join(" ")).toMatch(/predicted to FAIL/);
  });

  test("the spread between criteria is reported when it is large", () => {
    expect(ms(50, 400).notes.join(" ")).toMatch(/honest uncertainty in the method/i);
  });

  test("impossible material data is refused", () => {
    expect(meanStressAnalysis(100, 100, 250, 500, 700).ok).toBe(false); // Sy > Sut
    expect(meanStressAnalysis(-1, 100, 250, 700, 500).ok).toBe(false);
    expect(meanStressAnalysis(0, 0, 250, 700, 500).ok).toBe(false);
    expect(meanStressAnalysis(100, 100, 0, 700, 500).ok).toBe(false);
    expect(meanStressAnalysis(NaN, 100, 250, 700, 500).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("finite life", () => {
  const SE = 250;
  const SUT = 700;

  function life(sa: number, mc: "steel" | "non-ferrous" = "steel"): FiniteLifeResult {
    const r = finiteLife(sa, SE, SUT, mc);
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  // The S-N line must pass through its own construction points.
  test("the line passes through 0.9*Sut at 10^3 cycles", () => {
    const r = life(0.9 * SUT * 0.999);
    expect(Math.abs(Math.log10(r.cycles) - 3)).toBeLessThan(0.01);
  });

  test("the line passes through Se at 10^6 cycles", () => {
    // Just above Se so it is not clipped to infinite life.
    const r = life(SE * 1.0001);
    expect(Math.abs(Math.log10(r.cycles) - 6)).toBeLessThan(0.01);
  });

  test("the coefficients satisfy S = a*N^b at both endpoints", () => {
    const r = life(400);
    near(r.a * Math.pow(1000, r.b), 0.9 * SUT, 1e-9);
    near(r.a * Math.pow(1e6, r.b), SE, 1e-9);
    // And at the returned life.
    near(r.a * Math.pow(r.cycles, r.b), 400, 1e-9);
  });

  test("life falls as stress rises", () => {
    expect(life(500).cycles).toBeLessThan(life(400).cycles);
    expect(life(400).cycles).toBeLessThan(life(300).cycles);
  });

  test("a steel below its endurance limit has infinite life", () => {
    const r = life(200);
    expect(r.cycles).toBe(Infinity);
    expect(r.infiniteLife).toBe(true);
    expect(r.notes.join(" ")).toMatch(/INFINITE life/);
    expect(r.notes.join(" ")).toMatch(/corrosion, fretting/i);
  });

  // The same stress on a non-ferrous alloy is NOT infinite life.
  test("a non-ferrous material below the same stress gets a finite life and a warning", () => {
    const r = life(200, "non-ferrous");
    expect(r.infiniteLife).toBe(false);
    expect(Number.isFinite(r.cycles)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/NO ENDURANCE LIMIT/);
  });

  test("low-cycle fatigue is flagged as outside the method", () => {
    const r = life(0.95 * SUT);
    expect(r.notes.join(" ")).toMatch(/LOW-CYCLE/);
    expect(r.notes.join(" ")).toMatch(/Coffin-Manson/);
  });

  test("the scatter caveat is always present on a finite life", () => {
    expect(life(400).notes.join(" ")).toMatch(/factor of three/i);
  });

  test("an uncorrected endurance limit is caught", () => {
    // Se >= 0.9*Sut leaves the S-N line with no slope.
    const r = finiteLife(400, 650, 700);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/CORRECTED/);
  });

  test("bad inputs are refused", () => {
    expect(finiteLife(0, 250, 700).ok).toBe(false);
    expect(finiteLife(400, 0, 700).ok).toBe(false);
    expect(finiteLife(400, 250, 0).ok).toBe(false);
    expect(finiteLife(NaN, 250, 700).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Miner cumulative damage", () => {
  const SE = 250;
  const SUT = 700;

  function miner(blocks: { sigmaA: number; cycles: number }[]): MinerResult {
    const r = minerDamage(blocks, SE, SUT);
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("damage is the sum of applied over allowable", () => {
    const r = miner([
      { sigmaA: 400, cycles: 1000 },
      { sigmaA: 350, cycles: 5000 },
    ]);
    let expected = 0;
    for (const b of r.blocks) expected += b.applied / b.allowable;
    near(r.damage, expected);
    expect(r.blocks).toHaveLength(2);
  });

  test("each block's allowable life matches finiteLife", () => {
    const r = miner([{ sigmaA: 400, cycles: 100 }]);
    const direct = finiteLife(400, SE, SUT);
    if (!direct.ok) throw new Error(direct.error);
    near(r.blocks[0].allowable, direct.cycles);
  });

  test("exactly consuming one life gives a damage of 1", () => {
    const direct = finiteLife(400, SE, SUT);
    if (!direct.ok) throw new Error(direct.error);
    const r = miner([{ sigmaA: 400, cycles: direct.cycles }]);
    near(r.damage, 1, 1e-9);
    near(r.repeats, 1, 1e-9);
  });

  test("repeats is the reciprocal of the damage", () => {
    const r = miner([
      { sigmaA: 400, cycles: 100 },
      { sigmaA: 300, cycles: 2000 },
    ]);
    near(r.repeats, 1 / r.damage);
  });

  test("blocks below the endurance limit contribute nothing, and that is flagged as optimistic", () => {
    const r = miner([
      { sigmaA: 400, cycles: 100 },
      { sigmaA: 100, cycles: 1e9 },
    ]);
    expect(r.blocks[1].allowable).toBe(Infinity);
    expect(r.blocks[1].damage).toBe(0);
    expect(r.notes.join(" ")).toMatch(/the small cycles are not free/i);
  });

  test("the load-order caveat is always stated", () => {
    const r = miner([{ sigmaA: 400, cycles: 100 }]);
    expect(r.notes.join(" ")).toMatch(/no account of the ORDER/i);
    expect(r.notes.join(" ")).toMatch(/between about 0\.3 and 3/);
  });

  test("a damage sum near 1 is reported as indeterminate", () => {
    const direct = finiteLife(400, SE, SUT);
    if (!direct.ok) throw new Error(direct.error);
    const r = miner([{ sigmaA: 400, cycles: direct.cycles * 0.9 }]);
    expect(r.notes.join(" ")).toMatch(/cannot distinguish survival from failure/i);
  });

  test("bad blocks are refused", () => {
    expect(minerDamage([], SE, SUT).ok).toBe(false);
    expect(minerDamage([{ sigmaA: 0, cycles: 100 }], SE, SUT).ok).toBe(false);
    expect(minerDamage([{ sigmaA: 400, cycles: -1 }], SE, SUT).ok).toBe(false);
    expect(minerDamage([{ sigmaA: NaN, cycles: 100 }], SE, SUT).ok).toBe(false);
    expect(minerDamage(new Array(300).fill({ sigmaA: 400, cycles: 1 }), SE, SUT).ok).toBe(false);
  });
});
