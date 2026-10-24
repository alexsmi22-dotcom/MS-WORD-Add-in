/**
 * Engineering fix round 2 (fix2-eng1) — each confirmed reviewer defect pinned: engines directly, pane-literal fixes by
 * source scan (taskpane.ts cannot be imported in a test; the engFixes2193 / engineeringRouting way).
 *
 * Oracles (C:\Users\AlexanderSmith\jurislab-oracle-venv, recorded inline):
 *  - Marin (Shigley Table 6-2 ka = a·Sut^b; kb = 1.24·d^−0.107; ke = 1 − 0.08·z, scipy norm.ppf(0.9)):
 *      sut=700; kb=1.24*25**-0.107; ke=1-0.08*norm.ppf(0.9)
 *      hot-rolled ka 0.5229 → Se 144.32 MPa; as-forged ka 0.4015 → Se 110.82 MPa; machined 0.7947 → 219.36 MPa.
 *  - NCA (IV bolus; linear trapezoids to tlast, C0 by log-linear back-extrapolation through the first two points,
 *    λz by log-linear least squares on (1, 8), (2, 5), (4, 2), dose 500):
 *      t=[0.5,1,2,4]; c=[10,8,5,2]; auc=np.trapezoid(c,t); l1=log(10/8)/0.5; c0=10*exp(l1*0.5); auc+=(c0-10)/l1
 *      sl,_=np.polyfit(t[1:],log(c[1:]),1); lz=-sl; aucinf=auc+2/lz
 *    → λz 0.461533, AUClast 23.6018, AUC∞ 27.9352, CL 17.8986, Vz 38.7807. (Oral route: AUC∞ 24.8334 — the task's
 *    27.94 / 17.90 / 38.8 are the IV figures.)
 */
import * as fs from "fs";
import * as path from "path";
import { enduranceLimit, minerDamage, SURFACE_FACTORS, type SurfaceFinish } from "../fatigue";
import { nca } from "../pk";
import { jointStatics } from "../biomed";
import { flueGas } from "../energy";
import { readTlc } from "../tlc";
import { MATERIALS_CALCS } from "../materialsCalcs";
import { fillNormals } from "../monteCarlo";
import type { AnalyzeOutput } from "../analyzeBlocks";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
function toolSource(id: string): string {
  const start = PANE.indexOf(`id: "${id}",`);
  if (start < 0) throw new Error(`no tool ${id}`);
  const next = PANE.indexOf("\n    id: \"", start + 10);
  return PANE.slice(start, next < 0 ? undefined : next);
}
const textOf = (o: AnalyzeOutput): string => ((o as { text?: string }).text ?? "");

const MARIN = { sut: 700, materialClass: "steel" as const, diameter: 25, load: "bending" as const, tempC: 20, reliability: 0.9 };

describe("1. Fatigue surface finish keys", () => {
  test.each([
    ["hot-rolled", 0.5229, 144.32],
    ["as-forged", 0.4015, 110.82],
    ["machined", 0.7947, 219.36],
  ])("%s → ka %p, Se %p MPa (fatigue-safety Marin defaults)", (surface, ka, se) => {
    const r = enduranceLimit({ ...MARIN, surface: surface as SurfaceFinish });
    if (!r.ok) throw new Error(r.error);
    expect(r.ka).toBeCloseTo(ka, 3);
    expect(r.se).toBeCloseTo(se, 1);
  });
  test("an unknown finish is refused, never defaulted to machined", () => {
    for (const bad of ["hotrolled", "forged", "", "Machined"]) {
      const r = enduranceLimit({ ...MARIN, surface: bad as SurfaceFinish });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Unknown surface finish/);
    }
  });
  test("every fatigue tool's surface options are the table keys", () => {
    for (const id of ["fatigue-endurance", "fatigue-safety"]) {
      const src = toolSource(id);
      expect(src).not.toMatch(/"hotrolled"|"forged"/);
      expect(src).toMatch(/options: \(Object\.keys\(SURFACE_FACTORS\) as SurfaceFinish\[\]\)/);
    }
    expect(Object.keys(SURFACE_FACTORS).sort()).toEqual(["as-forged", "ground", "hot-rolled", "machined"]);
  });
});

describe("2. NCA ends AUClast / Clast / λz at the last positive concentration", () => {
  const t = [0.5, 1, 2, 4, 8, 12];
  const c = [10, 8, 5, 2, 0, 0];
  test("IV bolus, dose 500: matches the oracle", () => {
    const r = nca(t, c, 500, "iv");
    if (!r.ok) throw new Error(r.error);
    expect(r.lambdaZ).toBeCloseTo(0.461533, 5);
    expect(r.aucLast).toBeCloseTo(23.6018, 3);
    expect(r.aucInf).toBeCloseTo(27.9352, 3);
    expect(r.clearance).toBeCloseTo(17.8986, 3);
    expect(r.volume).toBeCloseTo(38.7807, 3);
    expect(r.lambdaPoints).toBe(3);
    expect(r.notes.join(" ")).toMatch(/last positive concentration, at t = 4/);
  });
  test("oral route on the same data: AUC∞ 24.8334", () => {
    const r = nca(t, c, 500, "oral");
    if (!r.ok) throw new Error(r.error);
    expect(r.aucInf).toBeCloseTo(24.8334, 3);
  });
  test("trailing zeros change nothing against the same data without them", () => {
    const a = nca(t, c, 500, "iv");
    const b = nca(t.slice(0, 4), c.slice(0, 4), 500, "iv");
    if (!a.ok || !b.ok) throw new Error("refused");
    expect(a.aucInf).toBeCloseTo(b.aucInf, 12);
    expect(a.lambdaZ).toBeCloseTo(b.lambdaZ, 12);
  });
});

describe("3. Joint reaction comparison follows the values", () => {
  const note = (inp: Parameters<typeof jointStatics>[0]): string => {
    const r = jointStatics(inp);
    if (!r.ok) throw new Error(r.error);
    return r.notes.find((n) => /JOINT REACTION FORCE/.test(n)) as string;
  };
  test("third-class lever at 90°: larger than the load, smaller than the muscle (600 N vs 100 N / 700 N)", () => {
    const n = note({ load: 100, loadArm: 0.35, muscleArm: 0.05 });
    expect(n).toMatch(/is 600 N: larger than the external load \(100 N\) but smaller than the muscle force \(700 N\)/);
    expect(n).not.toMatch(/larger than either/);
  });
  test("muscle arm longer than the load arm: larger than the muscle, smaller than the load", () => {
    expect(note({ load: 100, loadArm: 0.01, muscleArm: 0.05 })).toMatch(/larger than the muscle force \(20 N\) but smaller than the external load \(100 N\)/);
  });
  test("equal arms: smaller than both", () => {
    expect(note({ load: 100, loadArm: 0.05, muscleArm: 0.05 })).toMatch(/smaller than both/);
  });
  test("the pane hint no longer claims larger than either", () => {
    expect(toolSource("biomechanics")).not.toMatch(/larger than either/);
  });
});

describe("6. Unit traps", () => {
  test("flue gas at air's own O₂ is infinite excess air", () => {
    for (const o2 of [21, 20.9]) {
      const r = flueGas({ formula: "CH4", o2DryPct: o2 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/infinite excess air \(no combustion oxygen consumed\)/);
    }
    expect(flueGas({ formula: "CH4", o2DryPct: 3 }).ok).toBe(true);
  });
  test("TLC distances accept cm / mm and convert to the front's unit", () => {
    const rf = (lanes: string, front: string): number => {
      const r = readTlc({ lanes, mode: "distance", front });
      if (!r.ok) throw new Error(r.error);
      return r.plate.lanes[0].spots[0].rf;
    };
    expect(rf("A: 4.96 cm", "8 cm")).toBeCloseTo(0.62, 12);
    expect(rf("A: 49.6 mm", "8 cm")).toBeCloseTo(0.62, 12);
    expect(rf("A: 4.96", "8")).toBeCloseTo(0.62, 12);
    expect(rf("A: 4.96 cm, 2 cm", "80 mm")).toBeCloseTo(0.62, 12);
    const rfMode = readTlc({ lanes: "A: 4.96 cm", mode: "rf" });
    expect(rfMode.ok).toBe(false);
    if (!rfMode.ok) expect(rfMode.error).toMatch(/carries a length unit/);
  });
  test("tensile: a header naming MPa with GPa selected is refused; matching is fine", () => {
    const tensile = MATERIALS_CALCS.find((c) => c.id === "mat-tensile")!;
    const data = "strain %\tstress MPa\n0\t0\n0.05\t100\n0.1\t200\n0.15\t300\n0.3\t350\n1\t400\n2\t380";
    const run = (unit: string): AnalyzeOutput =>
      tensile.compute((k) => ({ mode: "ss", data, strainUnit: "pct", stressUnit: unit, offset: "0.2", window: "" } as Record<string, string>)[k] ?? "");
    const bad = run("GPa");
    expect(bad.ok).toBe(false);
    expect(textOf(bad)).toMatch(/header says MPa .*selected is GPa/);
    expect(run("MPa").ok).not.toBe(false);
  });
  test("fatigue fields read through the unit layer; compressible and thermo-process too", () => {
    expect(toolSource("fatigue-endurance")).toMatch(/u\.opt\("sut", "MPa"/);
    expect(toolSource("fatigue-endurance")).toMatch(/u\.opt\("temp", "°C"/);
    expect(toolSource("fatigue-endurance")).toMatch(/u\.opt\("dia", "mm"/);
    const fs2 = toolSource("fatigue-safety");
    for (const k of ["sa", "sm", "sut", "sy"]) expect(fs2).toMatch(new RegExp(`u\\.opt\\("${k}", "MPa"`));
    expect(fs2).toMatch(/fromMarin \? 0 : u\.opt\("se", "MPa"/);
    expect(toolSource("fatigue-life")).toMatch(/u\.opt\("se", "MPa"/);
    expect(toolSource("compressible")).toMatch(/u\.opt\("T", "K"/);
    expect(toolSource("compressible")).not.toMatch(/ENG_THERMO_UNIT_NOTE/);
    expect(toolSource("thermo-process")).toMatch(/u\.optNull\("p2", "Pa"/);
  });
  test("Paris threshold: bare number in MPa·√m, stated in the result", () => {
    const src = toolSource("fracture-paris");
    expect(src).toMatch(/u\.opt\("dkth", "MPa\*m\^0\.5"/);
    expect(src).toMatch(/Threshold ΔKth = .*MPa·√m \(a bare threshold is read in MPa·√m/);
  });
});

describe("Suspicion: fatigue-life low-cycle caveat on a spectrum", () => {
  test("a block allowing < 1000 cycles is named", () => {
    const r = minerDamage([{ sigmaA: 660, cycles: 100 }, { sigmaA: 300, cycles: 1e5 }], 250, 700);
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/LOW-CYCLE: block 1 allows fewer than 1000 cycles/);
  });
});

describe("Suspicion: Monte Carlo normal stream is i.i.d. N(0, 1) in each dimension", () => {
  // The reviewer's SD 0.939 is the FIXED workbench seed 20261023 at 2000 draws: one 3.9σ sample (SE of a sample SD
  // at n = 2000 is 1/√(2·1999) = 0.0158) that repeats on every run because the seed is fixed. Over 200 seeds the
  // per-dimension SDs centre on 1 with the theoretical spread, and the two Box–Muller outputs are uncorrelated.
  test("200 seeds × 2000 draws, two dimensions", () => {
    const n = 2000;
    const sds: number[][] = [[], []];
    const cors: number[] = [];
    for (let s = 0; s < 200; s++) {
      const st = new Int32Array([(Math.imul(s + 1, 2654435761) ^ 0x5bd1e995) | 0]);
      const z = new Float64Array(2);
      let s0 = 0, s1 = 0, q0 = 0, q1 = 0, x01 = 0;
      for (let d = 0; d < n; d++) {
        fillNormals(st, z);
        s0 += z[0]; s1 += z[1]; q0 += z[0] * z[0]; q1 += z[1] * z[1]; x01 += z[0] * z[1];
      }
      const m0 = s0 / n, m1 = s1 / n;
      const v0 = (q0 - n * m0 * m0) / (n - 1), v1 = (q1 - n * m1 * m1) / (n - 1);
      sds[0].push(Math.sqrt(v0));
      sds[1].push(Math.sqrt(v1));
      cors.push((x01 - n * m0 * m1) / (n - 1) / Math.sqrt(v0 * v1));
    }
    const se = 1 / Math.sqrt(2 * (n - 1));
    for (const a of sds) {
      const mean = a.reduce((x, y) => x + y, 0) / a.length;
      const spread = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / (a.length - 1));
      expect(Math.abs(mean - 1)).toBeLessThan(4 * se / Math.sqrt(a.length));
      expect(spread).toBeGreaterThan(0.75 * se);
      expect(spread).toBeLessThan(1.25 * se);
    }
    expect(Math.max(...cors.map(Math.abs))).toBeLessThan(0.1);
  });
});
