// Release E, gap #7: Kalman filter / sensor fusion + attitude kinematics. The FIXED CASE TABLE from the brief (oracle:
// scipy.linalg.solve_discrete_are and scipy.spatial.transform.Rotation, ~/jurislab-relE/oracle_kalman.py) is pinned
// row by row first; reviewers add rows; every later fix round keeps every earlier row's outcome.
//
// Further oracle values come from the venv at C:\Users\AlexanderSmith\jurislab-oracle-venv (numpy 2, scipy). The
// scripts are recorded inline beside the values they produced.

import { KALMAN_CALCS } from "../kalmanCalcs";
import { steadyState, runFilter, constantVelocityModel, randomWalkModel, riccatiHistory, MAX_SAMPLES } from "../kalman";
import { eulerToQuat, quatToEuler, quatToMatrix, matrixToQuat, canonical, quatMul, slerp, axisAngleToQuat, quatToAxisAngle, quatNormalize, type Quat } from "../attitude";
import { dhForward } from "../robotics";
import { chiSquareDist } from "../probdist";
import type { AnalyzeOutput } from "../analyzeBlocks";

const D = Math.PI / 180;
const calc = (id: string) => {
  const c = KALMAN_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (o: AnalyzeOutput, key: string): number => {
  const e = (o.outputs ?? []).find((x) => x.key === key);
  if (!e) throw new Error(`no output ${key}: ${o.text}`);
  return e.value;
};
const near = (a: number, b: number, rel = 1e-5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1e-12, Math.abs(b)));
const nearAbs = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** The display contract on every ok result: no e-notation, carets, NaN/Infinity/undefined, em dash or ASCII minus before a digit in prose. */
function displayClean(o: AnalyzeOutput): void {
  const t = o.text;
  expect(t).not.toMatch(/\d[eE][-+]?\d/);
  expect(t).not.toMatch(/\^/);
  expect(t).not.toMatch(/NaN|Infinity|undefined/);
  expect(t).not.toMatch(/\u2014/);
  expect(t).not.toMatch(/(^|[\s(,=\[])-\d/m);
  for (const b of o.blocks ?? []) {
    if (b.kind === "plot") {
      expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(b.svg).not.toMatch(/>[^<]*\d[eE][-+]?\d[^<]*</);
    }
  }
}

// ====================================================================== the fixed case table

describe("fixed case table (brief)", () => {
  test("scalar random walk Q 0.01, R 1: steady prior P 0.105125, K 0.0951249", () => {
    const o = run("kalman-steady", { model: "rw", q: "0.01", r: "1" });
    expect(o.ok).not.toBe(false);
    near(out(o, "Pprior11"), 0.105125, 5e-6);
    near(out(o, "K11"), 0.0951249, 5e-6);
    displayClean(o);
  });

  test("CV tracker dt 0.1, q 1, r 0.25: prior P, K, posterior P", () => {
    const o = run("kalman-steady", { model: "cv", dt: "0.1", q: "1", r: "0.25" });
    expect(o.ok).not.toBe(false);
    near(out(o, "Pprior11"), 0.106779, 5e-6);
    near(out(o, "Pprior12"), 0.188886, 5e-6);
    near(out(o, "Pprior22"), 0.615309, 5e-6);
    near(out(o, "K11"), 0.299286, 5e-6);
    near(out(o, "K21"), 0.52942, 5e-6);
    const ss = steadyState(constantVelocityModel(0.1, 1, 0.25));
    if (!ss.ok) throw new Error(ss.error);
    near(ss.posterior[0][0], 0.0748215, 5e-6);
    near(ss.posterior[0][1], 0.132355, 5e-6);
    near(ss.posterior[1][1], 0.515309, 5e-6);
    near(out(o, "sigmaPost1"), Math.sqrt(0.0748215), 5e-6);
    displayClean(o);
  });

  test("undetectable pair (H = 0 on an unstable F): named refusal", () => {
    const o = run("kalman-steady", { model: "matrix", F: "1.2 0\n0 1", H: "0 0", Q: "1 0\n0 1", R: "1" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/not detectable/);
  });

  test("Euler ZYX intrinsic (30, 20, 10): quaternion, DCM row 1, extrinsic xyz", () => {
    const o = run("attitude-convert", { op: "convert", formA: "euler", seqA: "ZYX", frame: "intrinsic", a1: "30", a2: "20", a3: "10" });
    expect(o.ok).not.toBe(false);
    nearAbs(out(o, "qx"), 0.0381346, 5e-7);
    nearAbs(out(o, "qy"), 0.189308, 5e-7);
    nearAbs(out(o, "qz"), 0.239298, 5e-7);
    nearAbs(out(o, "qw"), 0.951549, 5e-7);
    nearAbs(out(o, "R11"), 0.813798, 5e-7);
    nearAbs(out(o, "R12"), -0.44097, 5e-7);
    nearAbs(out(o, "R13"), 0.378522, 5e-7);
    expect(o.text).toContain("extrinsic xyz (the reversed sequence about the other frame): (10°, 20°, 30°)");
    expect(o.text).toContain("−0.44097");
    displayClean(o);
  });

  test("Euler ZXZ intrinsic (45, 30, 60): quaternion (0.256605, −0.0337827, 0.766320, 0.588018)", () => {
    const o = run("attitude-convert", { formA: "euler", seqA: "ZXZ", a1: "45", a2: "30", a3: "60" });
    nearAbs(out(o, "qx"), 0.256605, 5e-7);
    nearAbs(out(o, "qy"), -0.0337827, 5e-7);
    nearAbs(out(o, "qz"), 0.76632, 5e-7);
    nearAbs(out(o, "qw"), 0.588018, 5e-7);
    displayClean(o);
  });

  test("slerp from identity to 90° about Z at t = 0.5: yaw 45, pitch 0, roll 0", () => {
    const o = run("attitude-convert", { op: "slerp", formA: "quat", quatA: "0, 0, 0, 1", formB: "euler", seqB: "ZYX", b1: "90", b2: "0", b3: "0", seqA: "ZYX", t: "0.5" });
    expect(o.ok).not.toBe(false);
    nearAbs(out(o, "e1"), 45, 1e-9);
    nearAbs(out(o, "e2"), 0, 1e-9);
    nearAbs(out(o, "e3"), 0, 1e-9);
    expect(o.text).toContain("(45°, 0°, 0°)");
    displayClean(o);
  });

  test("composition (ZYX 30,20,10) ⊗ (ZXZ 45,30,60)", () => {
    const o = run("attitude-convert", { op: "compose", formA: "euler", seqA: "ZYX", a1: "30", a2: "20", a3: "10", formB: "euler", seqB: "ZXZ", b1: "45", b2: "30", b3: "60" });
    nearAbs(out(o, "qx"), 0.41975, 5e-7);
    nearAbs(out(o, "qy"), 0.111352, 5e-7);
    nearAbs(out(o, "qz"), 0.820037, 5e-7);
    nearAbs(out(o, "qw"), 0.372759, 5e-7);
    displayClean(o);
  });

  test("ZYX with pitch 90°: gimbal lock named; quaternion still exact", () => {
    const o = run("attitude-convert", { formA: "euler", seqA: "ZYX", a1: "30", a2: "90", a3: "10" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/GIMBAL LOCK/);
    expect(o.text).toMatch(/third angle is set to 0°/);
    nearAbs(out(o, "qx"), -0.122788, 5e-7);
    nearAbs(out(o, "qy"), 0.696364, 5e-7);
    nearAbs(out(o, "qz"), 0.122788, 5e-7);
    nearAbs(out(o, "qw"), 0.696364, 5e-7);
    // scipy as_euler("ZYX") on that rotation: [20, 90, 0] (yaw − roll is what survives; third angle 0).
    nearAbs(out(o, "e1"), 20, 1e-6);
    nearAbs(out(o, "e2"), 90, 1e-6);
    nearAbs(out(o, "e3"), 0, 1e-9);
    expect(o.text).toMatch(/only their difference is determined/);
    displayClean(o);
  });

  test("non-unit quaternion: normalised, with a note stating the norm", () => {
    const o = run("attitude-convert", { formA: "quat", quatA: "0, 0, 2, 2" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/norm 2\.828427/);
    expect(o.text).toMatch(/normalised/);
    nearAbs(out(o, "qz"), Math.SQRT1_2, 1e-12);
    nearAbs(out(o, "qw"), Math.SQRT1_2, 1e-12);
    displayClean(o);
  });

  test("matrix that is not a rotation: named refusal (not orthogonal; reflection)", () => {
    const a = run("attitude-convert", { formA: "matrix", dcmA: "1 0 0\n0 1 0.001\n0 0 1" });
    expect(a.ok).toBe(false);
    expect(a.text).toMatch(/not a rotation/);
    const b = run("attitude-convert", { formA: "matrix", dcmA: "1 0 0\n0 1 0\n0 0 -1" });
    expect(b.ok).toBe(false);
    expect(b.text).toMatch(/reflection/);
    const c = run("attitude-convert", { formA: "matrix", dcmA: "2 0 0\n0 2 0\n0 0 2" });
    expect(c.ok).toBe(false);
    expect(c.text).toMatch(/not a rotation/);
  });
});

// ====================================================================== attitude against scipy, all 12 sequences

// Oracle (scipy 1.x, venv):
//   rng = R.random(6, random_state=11); for each q, each of the 12 sequences, intrinsic ("ZYX") and extrinsic ("zyx"):
//   r.as_euler(seq, degrees=True); quaternions canonicalised to w >= 0. Gimbal rows: R.from_euler(seq, [35, mid, -20])
//   with mid = ±90 (Tait–Bryan) or 0 / 180 (proper), then as_euler (scipy sets the third angle to 0).
const ORACLE: { rows: [number[], string, "intrinsic" | "extrinsic", number[]][]; lock: [number[], string, "intrinsic" | "extrinsic", number[]][] } = {"rows": [[[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "ZYX", "intrinsic", [9.118936858, 17.967631402, -65.352764606]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "ZYX", "extrinsic", [20.058161765, -0.97555656, -66.624864772]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "XYZ", "intrinsic", [-66.624864772, -0.97555656, 20.058161765]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "XYZ", "extrinsic", [-65.352764606, 17.967631402, 9.118936858]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "XZY", "intrinsic", [-66.981038429, 20.055129456, -1.038536478]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "XZY", "extrinsic", [-68.18745073, 8.670698295, 18.182574971]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "YXZ", "intrinsic", [-2.457601703, -66.605657529, 22.313951501]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "YXZ", "extrinsic", [37.869708245, -59.833273325, 43.032393273]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "YZX", "intrinsic", [18.182574971, 8.670698295, -68.18745073]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "YZX", "extrinsic", [-1.038536478, 20.055129456, -66.981038429]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "ZXY", "intrinsic", [43.032393273, -59.833273325, 37.869708245]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "ZXY", "extrinsic", [22.313951501, -66.605657529, -2.457601703]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "ZXZ", "intrinsic", [-178.937236767, 66.628454357, -160.363468721]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "ZXZ", "extrinsic", [-160.363468721, 66.628454357, -178.937236767]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "ZYZ", "intrinsic", [91.062763233, 66.628454357, -70.363468721]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "ZYZ", "extrinsic", [-70.363468721, 66.628454357, 91.062763233]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "XYX", "intrinsic", [26.04494958, 20.080895457, -92.842345924]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "XYX", "extrinsic", [-92.842345924, 20.080895457, 26.04494958]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "XZX", "intrinsic", [-63.95505042, 20.080895457, -2.842345924]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "XZX", "extrinsic", [-2.842345924, 20.080895457, -63.95505042]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "YXY", "intrinsic", [-158.364606303, 68.449290656, 170.671988697]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "YXY", "extrinsic", [170.671988697, 68.449290656, -158.364606303]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "YZY", "intrinsic", [-68.364606303, 68.449290656, 80.671988697]], [[-0.5420314059, 0.088633644, 0.1501322176, 0.8220744184], "YZY", "extrinsic", [80.671988697, 68.449290656, -68.364606303]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "ZYX", "intrinsic", [-131.091007366, -25.461486535, 49.826125738]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "ZYX", "extrinsic", [-130.204888774, -23.177986296, -50.684358102]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "XYZ", "intrinsic", [-50.684358102, -23.177986296, -130.204888774]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "XYZ", "extrinsic", [49.826125738, -25.461486535, -131.091007366]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "XZY", "intrinsic", [104.345716648, -44.595477181, -146.445500409]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "XZY", "extrinsic", [-103.932203601, -42.880091381, -144.078499057]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "YXZ", "intrinsic", [-34.048610368, -45.334425558, -104.535776398]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "YXZ", "extrinsic", [-36.430774668, 43.62041974, -104.106094533]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "YZX", "intrinsic", [-144.078499057, -42.880091381, -103.932203601]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "YZX", "extrinsic", [-146.445500409, -44.595477181, 104.345716648]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "ZXY", "intrinsic", [-104.106094533, 43.62041974, -36.430774668]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "ZXY", "extrinsic", [-104.535776398, -45.334425558, -34.048610368]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "ZXZ", "intrinsic", [-151.039950747, 54.376758142, 31.92952032]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "ZXZ", "extrinsic", [31.92952032, 54.376758142, -151.039950747]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "ZYZ", "intrinsic", [118.960049253, 54.376758142, 121.92952032]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "ZYZ", "extrinsic", [121.92952032, 54.376758142, 118.960049253]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "XYX", "intrinsic", [-122.283836191, 126.400117004, 119.274570742]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "XYX", "extrinsic", [119.274570742, 126.400117004, -122.283836191]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "XZX", "intrinsic", [147.716163809, 126.400117004, -150.725429258]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "XZX", "extrinsic", [-150.725429258, 126.400117004, 147.716163809]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "YXY", "intrinsic", [45.502950199, 100.162114997, -136.266004783]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "YXY", "extrinsic", [-136.266004783, 100.162114997, 45.502950199]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "YZY", "intrinsic", [135.502950199, 100.162114997, 133.733995217]], [[-0.0118390179, -0.4567641192, -0.7668616593, 0.4507211694], "YZY", "extrinsic", [133.733995217, 100.162114997, 135.502950199]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "ZYX", "intrinsic", [-177.95731243, 49.219886979, 101.43654726]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "ZYX", "extrinsic", [131.079904703, 6.610092798, -97.491349234]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "XYZ", "intrinsic", [-97.491349234, 6.610092798, 131.079904703]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "XYZ", "extrinsic", [101.43654726, 49.219886979, -177.95731243]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "XZY", "intrinsic", [74.986322186, 48.485072853, 169.998640249]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "XZY", "extrinsic", [-80.110499909, -1.334035265, 130.762100926]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "YXZ", "intrinsic", [138.368365361, -80.021816146, -7.721686433]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "YXZ", "extrinsic", [99.705552466, 39.805936576, 77.084892736]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "YZX", "intrinsic", [130.762100926, -1.334035265, -80.110499909]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "YZX", "extrinsic", [169.998640249, 48.485072853, 74.986322186]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "ZXY", "intrinsic", [77.084892736, 39.805936576, 99.705552466]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "ZXY", "extrinsic", [-7.721686433, -80.021816146, 138.368365361]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "ZXZ", "intrinsic", [173.333511462, 97.441267662, -49.787322092]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "ZXZ", "extrinsic", [-49.787322092, 97.441267662, 173.333511462]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "ZYZ", "intrinsic", [83.333511462, 97.441267662, 40.212677908]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "ZYZ", "extrinsic", [40.212677908, 97.441267662, 83.333511462]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "XYX", "intrinsic", [-1.761035733, 130.748715333, -81.260211022]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "XYX", "extrinsic", [-81.260211022, 130.748715333, -1.761035733]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "XZX", "intrinsic", [-91.761035733, 130.748715333, 8.739788978]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "XZX", "extrinsic", [8.739788978, 130.748715333, -91.761035733]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "YXY", "intrinsic", [-49.470451298, 80.113207328, -178.645850506]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "YXY", "extrinsic", [-178.645850506, 80.113207328, -49.470451298]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "YZY", "intrinsic", [40.529548702, 80.113207328, 91.354149494]], [[-0.276163465, 0.6989196313, 0.581276812, 0.3120294175], "YZY", "extrinsic", [91.354149494, 80.113207328, 40.529548702]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "ZYX", "intrinsic", [94.492841564, 8.350338441, -54.242986557]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "ZYX", "extrinsic", [97.698818902, -54.652324205, -2.083471402]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "XYZ", "intrinsic", [-2.083471402, -54.652324205, 97.698818902]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "XYZ", "extrinsic", [-54.242986557, 8.350338441, 94.492841564]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "XZY", "intrinsic", [-101.493949681, 34.982176055, -95.427976467]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "XZY", "extrinsic", [-172.659119121, 80.525265215, 118.08798918]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "YXZ", "intrinsic", [-54.670201787, -1.205187566, 99.398466543]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "YXZ", "extrinsic", [14.100302814, -53.40787166, 105.895238005]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "YZX", "intrinsic", [118.08798918, 80.525265215, -172.659119121]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "YZX", "extrinsic", [-95.427976467, 34.982176055, -101.493949681]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "ZXY", "intrinsic", [105.895238005, -53.40787166, 14.100302814]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "ZXY", "extrinsic", [99.398466543, -1.205187566, -54.670201787]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "ZXZ", "intrinsic", [-91.477131285, 54.679185437, -169.747398007]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "ZXZ", "extrinsic", [-169.747398007, 54.679185437, -91.477131285]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "ZYZ", "intrinsic", [178.522868715, 54.679185437, -79.747398007]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "ZYZ", "extrinsic", [-79.747398007, 54.679185437, 178.522868715]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "XYX", "intrinsic", [81.624287522, 94.445114754, -144.896774038]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "XYX", "extrinsic", [-144.896774038, 94.445114754, 81.624287522]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "XZX", "intrinsic", [-8.375712478, 94.445114754, -54.896774038]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "XZX", "extrinsic", [-54.896774038, 94.445114754, -8.375712478]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "YXY", "intrinsic", [-144.470732934, 99.396368601, 91.221580543]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "YXY", "extrinsic", [91.221580543, 99.396368601, -144.470732934]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "YZY", "intrinsic", [-54.470732934, 99.396368601, 1.221580543]], [[-0.3562321131, -0.2898648722, 0.6743370064, 0.578227152], "YZY", "extrinsic", [1.221580543, 99.396368601, -54.470732934]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "ZYX", "intrinsic", [121.892784928, -37.122327088, -156.606016036]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "ZYX", "extrinsic", [-122.841286856, -39.032310675, -160.404860677]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "XYZ", "intrinsic", [-160.404860677, -39.032310675, -122.841286856]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "XYZ", "extrinsic", [-156.606016036, -37.122327088, 121.892784928]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "XZY", "intrinsic", [-24.698701159, -40.741029584, -123.779754801]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "XZY", "extrinsic", [-20.729591843, 42.608068241, -124.915573612]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "YXZ", "intrinsic", [-139.286143898, -15.100543142, 44.522688835]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "YXZ", "extrinsic", [-140.487590907, -18.4567404, -43.474481618]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "YZX", "intrinsic", [-124.915573612, 42.608068241, -20.729591843]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "YZX", "extrinsic", [-123.779754801, -40.741029584, -24.698701159]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "ZXY", "intrinsic", [-43.474481618, -18.4567404, -140.487590907]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "ZXY", "extrinsic", [44.522688835, -15.100543142, -139.286143898]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "ZXZ", "intrinsic", [-112.47352412, 137.037827209, 117.68021008]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "ZXZ", "extrinsic", [117.68021008, 137.037827209, -112.47352412]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "ZYZ", "intrinsic", [157.52647588, 137.037827209, -152.31978992]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "ZYZ", "extrinsic", [-152.31978992, 137.037827209, 157.52647588]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "XYX", "intrinsic", [131.716599069, 114.91444204, 133.977747052]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "XYX", "extrinsic", [133.977747052, 114.91444204, 131.716599069]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "XZX", "intrinsic", [41.716599069, 114.91444204, -136.022252948]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "XZX", "extrinsic", [-136.022252948, 114.91444204, 41.716599069]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "YXY", "intrinsic", [115.87747948, 46.500045493, 111.047602567]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "YXY", "extrinsic", [111.047602567, 46.500045493, 115.87747948]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "YZY", "intrinsic", [-154.12252052, 46.500045493, 21.047602567]], [[-0.3943936402, -0.8428259361, 0.0166330013, 0.3658161305], "YZY", "extrinsic", [21.047602567, 46.500045493, -154.12252052]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "ZYX", "intrinsic", [27.804186227, -37.139638597, 61.035425775]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "ZYX", "extrinsic", [44.508732331, 8.596891109, 67.018775503]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "XYZ", "intrinsic", [67.018775503, 8.596891109, 44.508732331]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "XYZ", "extrinsic", [61.035425775, -37.139638597, 27.804186227]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "XZY", "intrinsic", [75.377999789, 43.879316631, 11.969012226]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "XZY", "extrinsic", [78.696001962, 21.829095903, -40.571375673]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "YXZ", "intrinsic", [21.167167947, 65.545329199, 63.925160023]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "YXZ", "extrinsic", [-57.405226957, 44.223276123, 75.290917172]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "YZX", "intrinsic", [-40.571375673, 21.829095903, 78.696001962]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "YZX", "extrinsic", [11.969012226, 43.879316631, 75.377999789]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "ZXY", "intrinsic", [75.290917172, 44.223276123, -57.405226957]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "ZXY", "extrinsic", [63.925160023, 65.545329199, 21.167167947]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "ZXZ", "intrinsic", [9.325507024, 67.291506762, 40.88141125]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "ZXZ", "extrinsic", [40.88141125, 67.291506762, 9.325507024]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "ZYZ", "intrinsic", [-80.674492976, 67.291506762, 130.88141125]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "ZYZ", "extrinsic", [130.88141125, 67.291506762, -80.674492976]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "XYX", "intrinsic", [148.372203511, 45.159864661, -77.830078201]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "XYX", "extrinsic", [-77.830078201, 45.159864661, 148.372203511]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "XZX", "intrinsic", [58.372203511, 45.159864661, 12.169921799]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "XZX", "extrinsic", [12.169921799, 45.159864661, 58.372203511]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "YXY", "intrinsic", [-44.82222858, 79.516068822, 22.219270786]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "YXY", "extrinsic", [22.219270786, 79.516068822, -44.82222858]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "YZY", "intrinsic", [45.17777142, 79.516068822, -67.780729214]], [[0.5331811455, -0.1506534793, 0.353182652, 0.7538457465], "YZY", "extrinsic", [-67.780729214, 79.516068822, 45.17777142]]], "lock": [[[-0.3265055756, 0.6272113751, 0.3265055756, 0.6272113751], "ZYX", "intrinsic", [55.0, 90.0, 0.0]], [[0.0922959556, -0.7010573846, 0.0922959556, 0.7010573846], "ZYX", "intrinsic", [15.0, -90.0, 0.0]], [[0.0922959556, 0.7010573846, 0.0922959556, 0.7010573846], "ZYX", "extrinsic", [15.0, 90.0, -0.0]], [[-0.3265055756, -0.6272113751, 0.3265055756, 0.6272113751], "ZYX", "extrinsic", [55.0, -90.0, -0.0]], [[0.0922959556, 0.7010573846, 0.0922959556, 0.7010573846], "XYZ", "intrinsic", [15.0, 90.0, 0.0]], [[0.3265055756, -0.6272113751, -0.3265055756, 0.6272113751], "XYZ", "intrinsic", [55.0, -90.0, 0.0]], [[0.3265055756, 0.6272113751, -0.3265055756, 0.6272113751], "XYZ", "extrinsic", [55.0, 90.0, 0.0]], [[0.0922959556, -0.7010573846, 0.0922959556, 0.7010573846], "XYZ", "extrinsic", [15.0, -90.0, 0.0]], [[0.3265055756, -0.3265055756, 0.6272113751, 0.6272113751], "XZY", "intrinsic", [55.0, 90.0, 0.0]], [[0.0922959556, 0.0922959556, -0.7010573846, 0.7010573846], "XZY", "intrinsic", [15.0, -90.0, 0.0]], [[0.0922959556, 0.0922959556, 0.7010573846, 0.7010573846], "XZY", "extrinsic", [15.0, 90.0, -0.0]], [[0.3265055756, -0.3265055756, -0.6272113751, 0.6272113751], "XZY", "extrinsic", [55.0, -90.0, -0.0]], [[0.6272113751, 0.3265055756, -0.3265055756, 0.6272113751], "YXZ", "intrinsic", [55.0, 90.0, 0.0]], [[-0.7010573846, 0.0922959556, 0.0922959556, 0.7010573846], "YXZ", "intrinsic", [15.0, -90.0, 0.0]], [[0.7010573846, 0.0922959556, 0.0922959556, 0.7010573846], "YXZ", "extrinsic", [15.0, 90.0, -0.0]], [[-0.6272113751, 0.3265055756, -0.3265055756, 0.6272113751], "YXZ", "extrinsic", [55.0, -90.0, -0.0]], [[0.0922959556, 0.0922959556, 0.7010573846, 0.7010573846], "YZX", "intrinsic", [15.0, 90.0, 0.0]], [[-0.3265055756, 0.3265055756, -0.6272113751, 0.6272113751], "YZX", "intrinsic", [55.0, -90.0, 0.0]], [[-0.3265055756, 0.3265055756, 0.6272113751, 0.6272113751], "YZX", "extrinsic", [55.0, 90.0, 0.0]], [[0.0922959556, 0.0922959556, -0.7010573846, 0.7010573846], "YZX", "extrinsic", [15.0, -90.0, 0.0]], [[0.7010573846, 0.0922959556, 0.0922959556, 0.7010573846], "ZXY", "intrinsic", [15.0, 90.0, 0.0]], [[-0.6272113751, -0.3265055756, 0.3265055756, 0.6272113751], "ZXY", "intrinsic", [55.0, -90.0, 0.0]], [[0.6272113751, -0.3265055756, 0.3265055756, 0.6272113751], "ZXY", "extrinsic", [55.0, 90.0, 0.0]], [[-0.7010573846, 0.0922959556, 0.0922959556, 0.7010573846], "ZXY", "extrinsic", [15.0, -90.0, 0.0]], [[0.0, 0.0, 0.1305261922, 0.9914448614], "ZXZ", "intrinsic", [15.0, 0.0, 0.0]], [[0.8870108332, 0.4617486132, 0.0, 0.0], "ZXZ", "intrinsic", [55.0, 180.0, 0.0]], [[0.0, 0.0, 0.1305261922, 0.9914448614], "ZXZ", "extrinsic", [15.0, 0.0, 0.0]], [[0.8870108332, -0.4617486132, 0.0, 0.0], "ZXZ", "extrinsic", [55.0, 180.0, 0.0]], [[0.0, 0.0, 0.1305261922, 0.9914448614], "ZYZ", "intrinsic", [15.0, 0.0, 0.0]], [[-0.4617486132, 0.8870108332, 0.0, 0.0], "ZYZ", "intrinsic", [55.0, 180.0, 0.0]], [[0.0, 0.0, 0.1305261922, 0.9914448614], "ZYZ", "extrinsic", [15.0, 0.0, 0.0]], [[0.4617486132, 0.8870108332, 0.0, 0.0], "ZYZ", "extrinsic", [55.0, 180.0, 0.0]], [[0.1305261922, 0.0, 0.0, 0.9914448614], "XYX", "intrinsic", [15.0, 0.0, 0.0]], [[0.0, 0.8870108332, 0.4617486132, 0.0], "XYX", "intrinsic", [55.0, 180.0, 0.0]], [[0.1305261922, 0.0, 0.0, 0.9914448614], "XYX", "extrinsic", [15.0, 0.0, 0.0]], [[0.0, 0.8870108332, -0.4617486132, 0.0], "XYX", "extrinsic", [55.0, 180.0, 0.0]], [[0.1305261922, 0.0, 0.0, 0.9914448614], "XZX", "intrinsic", [15.0, 0.0, 0.0]], [[0.0, -0.4617486132, 0.8870108332, 0.0], "XZX", "intrinsic", [55.0, 180.0, 0.0]], [[0.1305261922, 0.0, 0.0, 0.9914448614], "XZX", "extrinsic", [15.0, 0.0, 0.0]], [[0.0, 0.4617486132, 0.8870108332, 0.0], "XZX", "extrinsic", [55.0, 180.0, 0.0]], [[0.0, 0.1305261922, 0.0, 0.9914448614], "YXY", "intrinsic", [15.0, 0.0, 0.0]], [[0.8870108332, 0.0, -0.4617486132, 0.0], "YXY", "intrinsic", [55.0, 180.0, 0.0]], [[0.0, 0.1305261922, 0.0, 0.9914448614], "YXY", "extrinsic", [15.0, 0.0, 0.0]], [[0.8870108332, 0.0, 0.4617486132, 0.0], "YXY", "extrinsic", [55.0, 180.0, 0.0]], [[0.0, 0.1305261922, 0.0, 0.9914448614], "YZY", "intrinsic", [15.0, 0.0, 0.0]], [[0.4617486132, 0.0, 0.8870108332, 0.0], "YZY", "intrinsic", [55.0, 180.0, 0.0]], [[0.0, 0.1305261922, 0.0, 0.9914448614], "YZY", "extrinsic", [15.0, 0.0, 0.0]], [[-0.4617486132, 0.0, 0.8870108332, 0.0], "YZY", "extrinsic", [55.0, 180.0, 0.0]]]};

describe("attitude against scipy.spatial.transform.Rotation", () => {
  test.each(ORACLE.rows.map((r, i) => [i, ...r] as const))("row %d: %s %s %s", (_i, q, seq, frame, ang) => {
    const e = quatToEuler(q as Quat, seq, frame);
    expect(e.gimbalLock).toBe(false);
    e.angles.forEach((a, k) => expect(angDiff(a / D, ang[k])).toBeLessThan(1e-7));
    const back = canonical(eulerToQuat(seq, ang.map((v) => v * D) as [number, number, number], frame));
    back.forEach((v, k) => nearAbs(v, q[k], 1e-9));
  });
  test.each(ORACLE.lock.map((r, i) => [i, ...r] as const))("gimbal %d: %s %s %s", (_i, q, seq, frame, ang) => {
    const e = quatToEuler(q as Quat, seq, frame);
    expect(e.gimbalLock).toBe(true);
    e.angles.forEach((a, k) => expect(angDiff(a / D, ang[k])).toBeLessThan(1e-6));
    expect(e.angles[2]).toBe(0);
    // The reported triple is still the same rotation.
    const back = canonical(eulerToQuat(seq, e.angles, frame));
    back.forEach((v, k) => nearAbs(v, q[k], 1e-9));
  });
  test("matrix ↔ quaternion round trip through Shepperd's branches (all four pivots)", () => {
    for (const q0 of [
      [0.1, 0.2, 0.3, 0.9],
      [0.9, 0.1, -0.2, 0.1],
      [0.1, -0.95, 0.2, 0.05],
      [0.05, 0.1, 0.98, 0.02],
    ]) {
      const n = quatNormalize(q0);
      if (!n.ok) throw new Error();
      const m = matrixToQuat(quatToMatrix(n.q));
      if (!m.ok) throw new Error(m.error);
      canonical(n.q).forEach((v, k) => nearAbs(v, m.q[k], 1e-12));
    }
  });
  test("axis–angle round trip; identity has no axis; zero axis refused", () => {
    const a = axisAngleToQuat([1, 2, 2], 2);
    if (!a.ok) throw new Error();
    expect(a.axisNorm).toBe(3);
    const back = quatToAxisAngle(a.q);
    nearAbs(back.angle, 2, 1e-12);
    (back.axis as number[]).forEach((v, k) => nearAbs(v, [1 / 3, 2 / 3, 2 / 3][k], 1e-12));
    expect(quatToAxisAngle([0, 0, 0, 1]).axis).toBeNull();
    expect(axisAngleToQuat([0, 0, 0], 1).ok).toBe(false);
  });
  test("slerp takes the shorter arc (q and −q) and hits both ends", () => {
    const a: Quat = [0, 0, 0, 1];
    const b = canonical(eulerToQuat("ZYX", [170 * D, 0, 0], "intrinsic"));
    const negB = b.map((v) => -v) as Quat;
    const mid1 = canonical(slerp(a, b, 0.5));
    const mid2 = canonical(slerp(a, negB, 0.5));
    mid1.forEach((v, k) => nearAbs(v, mid2[k], 1e-12));
    nearAbs(quatToEuler(mid1, "ZYX", "intrinsic").angles[0] / D, 85, 1e-9);
    canonical(slerp(a, b, 1)).forEach((v, k) => nearAbs(v, b[k], 1e-12));
  });
  test("composition is R_A·R_B (Hamilton product, active)", () => {
    const qa = eulerToQuat("ZYX", [30 * D, 20 * D, 10 * D], "intrinsic");
    const qb = eulerToQuat("ZXZ", [45 * D, 30 * D, 60 * D], "intrinsic");
    const Ra = quatToMatrix(qa), Rb = quatToMatrix(qb), Rc = quatToMatrix(quatMul(qa, qb));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) nearAbs(Rc[i][j], Ra[i][0] * Rb[0][j] + Ra[i][1] * Rb[1][j] + Ra[i][2] * Rb[2][j], 1e-12);
  });
});

describe("agreement with robotics.ts dhForward (same rotation, same ZYX roll/pitch/yaw)", () => {
  test("a 3-joint DH chain with non-zero twists", () => {
    const res = dhForward([
      { a: 0.3, alpha: 0.7, d: 0.1, theta: 0.4 },
      { a: 0.2, alpha: -1.1, d: 0, theta: 1.2 },
      { a: 0.1, alpha: 0.3, d: 0.05, theta: -0.8 },
    ]);
    if (!res || !res.rpy) throw new Error("dhForward");
    const R = [res.rotation.slice(0, 3), res.rotation.slice(3, 6), res.rotation.slice(6, 9)];
    const m = matrixToQuat(R);
    if (!m.ok) throw new Error(m.error);
    const e = quatToEuler(m.q, "ZYX", "intrinsic");
    const [roll, pitch, yaw] = res.rpy;
    nearAbs(e.angles[0], yaw, 1e-9);
    nearAbs(e.angles[1], pitch, 1e-9);
    nearAbs(e.angles[2], roll, 1e-9);
  });
  test("both name gimbal lock on the same pose", () => {
    // R₃₁ = sin α₁ sin θ₂ for two DH rows, so α₁ = θ₂ = 90° is pitch −90°.
    const res = dhForward([{ a: 0.2, alpha: Math.PI / 2, d: 0, theta: 0.3 }, { a: 0.1, alpha: 0.4, d: 0, theta: Math.PI / 2 }]);
    expect(res?.gimbalLock).toBe(true);
    if (!res) throw new Error("dhForward");
    const R = [res.rotation.slice(0, 3), res.rotation.slice(3, 6), res.rotation.slice(6, 9)];
    const m = matrixToQuat(R);
    if (!m.ok) throw new Error(m.error);
    expect(quatToEuler(m.q, "ZYX", "intrinsic").gimbalLock).toBe(res.gimbalLock);
  });
});

// ====================================================================== Kalman: further oracle rows

// Oracle (numpy, venv): the same predict/update loop (Joseph form), x0 and P0 as the prior at the first measurement:
//   for z in series: if z present: S = HPHᵀ + R; K = PHᵀS⁻¹; ν = z − Hx; NIS = νᵀS⁻¹ν; x += Kν;
//                    P = (I−KH)P(I−KH)ᵀ + KRKᵀ;  then x = Fx; P = FPFᵀ + Q
//   NIS bounds: scipy.stats.chi2.ppf(0.025 / 0.975, N·m) / N.
describe("Kalman run on data (numpy oracle)", () => {
  test("default series (CV tracker, x0 = 0, P0 = 10·I): final estimate, σ, mean NIS and its 95% range", () => {
    const o = run("kalman-run");
    expect(o.ok).not.toBe(false);
    near(out(o, "final1"), 9.650510139250015, 1e-9);
    near(out(o, "final2"), 2.9322834371962174, 1e-9);
    near(out(o, "finalSigma1"), 0.27353531027105465, 1e-9);
    near(out(o, "finalSigma2"), 0.717851778081719, 1e-9);
    near(out(o, "meanNis"), 1.046911083270004, 1e-9);
    near(out(o, "nisLow"), 0.6108259792701972, 1e-6);
    near(out(o, "nisHigh"), 1.4835426785792794, 1e-6);
    expect(o.text).toMatch(/inside the range/);
    displayClean(o);
  });
  test("missing values skip the update (rows 6 and 7), x0 = (0.5, 1), P0 = 4·I", () => {
    const series = "0.60, 1.53, 1.62, 1.18, 1.76, NA, NA, 2.62, 2.75, 2.63, 3.66, 3.37, 3.88, 3.91, 4.22, 4.42, 4.13, 5.24, 4.68, 4.75, 5.56, 6.74, 5.24, 6.12, 5.14, 6.15, 6.09, 5.71, 6.19, 6.44, 6.68, 7.44, 6.68, 8.70, 7.82, 9.17, 8.32, 9.92, 10.13, 8.75";
    const o = run("kalman-run", { data: series, x0: "0.5, 1", p0: "4" });
    expect(o.ok).not.toBe(false);
    near(out(o, "final1"), 9.650694631094217, 1e-9);
    near(out(o, "final2"), 2.9327579822000023, 1e-9);
    near(out(o, "meanNis"), 1.0872040538128676, 1e-9);
    expect(out(o, "updates")).toBe(38);
    expect(o.text).toMatch(/2 rows have a missing value/);
  });
  test("random walk Q 0.01, R 1 on five values (one value per line)", () => {
    const o = run("kalman-run", { model: "rw", q: "0.01", r: "1", data: "1.0\n1.2\n0.9\n1.1\n1.05", x0: "0", p0: "10" });
    near(out(o, "final1"), 1.0302363832953767, 1e-9);
    near(out(o, "finalSigma1"), 0.45620590376869596, 1e-9);
    near(out(o, "meanNis"), 0.031562768357423845, 1e-8);
  });
  test("3 states, 2 correlated measurements (matrix model): run and steady state", () => {
    const M = { model: "matrix", F: "1 0.1 0\n0 1 0\n0 0 0.9", H: "1 0 0\n0 0 1", Q: "0.01 0 0\n0 0.1 0\n0 0 0.05", R: "0.2 0.05\n0.05 0.3" };
    const o = run("kalman-run", { ...M, data: "1 0.5\n1.2 0.4\n1.1 0.6\n1.5 0.2\n1.6 0.1\n1.9 0.3", x0: "", p0: "1" });
    expect(o.ok).not.toBe(false);
    near(out(o, "final1"), 1.633442159841024, 1e-9);
    near(out(o, "final2"), 1.021178720896482, 1e-9);
    near(out(o, "final3"), 0.21576414968861676, 1e-9);
    near(out(o, "finalSigma2"), 0.946338635236118, 1e-9);
    near(out(o, "meanNis"), 0.5667813335179624, 1e-9);
    near(out(o, "nisLow"), 0.7339647511636169, 1e-6);
    near(out(o, "nisHigh"), 3.88944402644089, 1e-6);
    expect(o.text).toMatch(/BELOW the range/);
    const s = run("kalman-steady", M);
    near(out(s, "Pprior11"), 0.10888267899621262, 1e-8);
    near(out(s, "Pprior12"), 0.17460068895974395, 1e-8);
    near(out(s, "Pprior33"), 0.11877897016827715, 1e-8);
    near(out(s, "K12"), -0.02799422147628131, 1e-7);
    near(out(s, "K31"), -0.02428661491794193, 1e-7);
    near(out(s, "K32"), 0.28708879865207326, 1e-8);
    displayClean(s);
  });
  test("χ² quantiles at the cap (2000 updates × 4 measurements = 8000 df) agree with scipy", () => {
    const d = chiSquareDist({ value: 8000 });
    near(d.quantile(0.025) / 2000, 3.87699084827249, 1e-6);
    near(d.quantile(0.975) / 2000, 4.124903423555152, 1e-6);
  });
  test("huge magnitudes (q 10¹², r 10¹⁰): steady P matches scipy, text in ×10ⁿ", () => {
    const o = run("kalman-steady", { model: "cv", q: "1e12", r: "1e10" });
    expect(o.ok).not.toBe(false);
    near(out(o, "Pprior11"), 12149749575.845032, 1e-8);
    near(out(o, "Pprior22"), 308156411979.2122, 1e-8);
    displayClean(o);
    expect(o.text).toMatch(/×10/);
  });
  test("tiny magnitudes (Q 10⁻²², R 10⁻²⁰): same gain as Q 0.01, R 1 (the DARE is homogeneous)", () => {
    const o = run("kalman-steady", { model: "rw", q: "1e-22", r: "1e-20" });
    near(out(o, "K11"), 0.0951249219725039, 1e-9);
    near(out(o, "Pprior11"), 1.0512492197250402e-21, 1e-8);
    displayClean(o);
  });
  test("the recursion converges to the doubling solution", () => {
    const m = constantVelocityModel(0.1, 1, 0.25);
    const h = riccatiHistory(m, [[10, 0], [0, 10]], 200);
    const ss = steadyState(m);
    if (!h || !ss.ok) throw new Error();
    near(h[200][0][0], ss.prior[0][0], 1e-10);
    near(h[200][1][1], ss.prior[1][1], 1e-10);
  });
});

// ====================================================================== refusals and adversarial input

describe("named refusals", () => {
  test.each([
    ["Q = 0 on a random walk (no stabilising solution)", { model: "rw", q: "0", r: "1" }, /No stabilising steady state/],
    ["F = 2, H = 0, Q = 0 (unstable, unseen, undriven)", { model: "matrix", F: "2", H: "0", Q: "0", R: "1" }, /No stabilising steady state/],
    ["random walk unseen (F = I, H measures one of two)", { model: "matrix", F: "1 0\n0 1", H: "0 1", Q: "1 0\n0 1", R: "1" }, /not detectable/],
    ["Q not PSD", { model: "matrix", F: "1", H: "1", Q: "-1", R: "1" }, /not positive semi-definite/],
    ["Q not symmetric", { model: "matrix", Q: "1 0.2\n0.1 1" }, /not symmetric/],
    ["R singular", { model: "matrix", F: "1 0\n0 1", H: "1 0\n1 0", Q: "1 0\n0 1", R: "1 1\n1 1" }, /positive definite/],
    ["R zero (preset)", { model: "cv", r: "0" }, /measurement variance must be positive/],
    ["negative q", { model: "cv", q: "-1" }, /cannot be negative/],
    ["zero Δt", { model: "cv", dt: "0" }, /Δt: must be positive/],
    ["H with the wrong column count", { model: "matrix", H: "1 0 0" }, /H must have 2 columns/],
    ["F not square", { model: "matrix", F: "1 0.1" }, /F must be square/],
    ["seven states", { model: "matrix", F: Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => (i === j ? "1" : "0")).join(" ")).join("\n") }, /at most 6/],
    ["a unit typed in a same-units field", { model: "cv", dt: "0.1 s" }, /has a unit; this tool works in your own consistent units/],
    ["empty r", { model: "cv", r: "" }, /required/],
    ["non-finite matrix entry", { model: "matrix", F: "1 Infinity\n0 1" }, /not a number|non-finite/],
    ["p0 zero", { p0: "0" }, /must be positive/],
  ])("steady: %s", (_n, over, re) => {
    const o = run("kalman-steady", over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re as RegExp);
    expect(o.text).not.toMatch(/\u2014/);
  });

  test.each([
    ["wrong column count", { data: "1 2\n3 4" }, /line 1 has 2 values, but the model measures 1/],
    ["words in the series", { data: "1\n2\nabc\n4" }, /line 3/i],
    ["empty series", { data: "" }, /nothing to read/],
    ["x0 of the wrong length", { x0: "1, 2, 3" }, /needs exactly 2 numbers/],
    ["all missing", { data: "NA\nNA" }, /never updated/],
    ["more than 2000 samples (one per line)", { data: Array.from({ length: 2001 }, (_, i) => String(i)).join("\n") }, /more than 2000 rows/],
    ["more than 2000 samples (one line)", { data: Array.from({ length: 2001 }, (_, i) => String(i)).join(", ") }, /at most 2000/],
  ])("run: %s", (_n, over, re) => {
    const o = run("kalman-run", over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re as RegExp);
  });

  test.each([
    ["a mass in an angle field", { a1: "5 kg" }, /not compatible with °/],
    ["an empty angle", { a2: "" }, /required/],
    ["the zero quaternion", { formA: "quat", quatA: "0, 0, 0, 0" }, /zero quaternion/],
    ["three numbers for a quaternion", { formA: "quat", quatA: "0, 0, 1" }, /exactly 4 numbers/],
    ["a 2 × 2 matrix", { formA: "matrix", dcmA: "1 0\n0 1" }, /3 × 3/],
    ["a 4-digit rounded DCM is refused by name (7 significant figures asked)", { formA: "matrix", dcmA: "0.8138 -0.4410 0.3785\n0.4698 0.8826 0.0180\n-0.3420 0.1632 0.9254" }, /7 significant figures/],
    ["the zero axis", { formA: "axis", axisA: "0, 0, 0" }, /no direction/],
    ["t above 1", { op: "slerp", t: "1.5" }, /between 0 \(rotation A\) and 1/],
    ["t not a number", { op: "slerp", t: "half" }, /not a plain number/],
    ["matrix form for B", { op: "compose", formB: "matrix" }, /rotation B is given as Euler angles or a quaternion/],
  ])("attitude: %s", (_n, over, re) => {
    const o = run("attitude-convert", over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re as RegExp);
  });
});

describe("attitude input conveniences", () => {
  test("angles convert through the unit layer (rad, arcmin), with a converted note", () => {
    const o = run("attitude-convert", { a1: `${(30 * Math.PI) / 180} rad`, a2: "1200 arcmin", a3: "10°" });
    nearAbs(out(o, "qx"), 0.0381346, 5e-7);
    nearAbs(out(o, "qw"), 0.951549, 5e-7);
    expect(o.text).toMatch(/Converted: A, first angle/);
  });
  test("scalar-first input reads (w, x, y, z) and also echoes the scalar-first order", () => {
    const o = run("attitude-convert", { formA: "quat", order: "first", quatA: "0.951549, 0.0381346, 0.189308, 0.239298" });
    nearAbs(out(o, "e1"), 30, 1e-4);
    nearAbs(out(o, "e2"), 20, 1e-4);
    nearAbs(out(o, "e3"), 10, 1e-4);
    expect(o.text).toMatch(/scalar-first order, \(w, x, y, z\) = \(0\.951549/);
  });
  test("a rotation matrix typed exactly (8 digits) is accepted and gives the ZYX angles back", () => {
    const R = quatToMatrix(eulerToQuat("ZYX", [30 * D, 20 * D, 10 * D], "intrinsic"));
    const o = run("attitude-convert", { formA: "matrix", dcmA: R.map((r) => r.map((v) => v.toFixed(9)).join(" ")).join("\n") });
    expect(o.ok).not.toBe(false);
    nearAbs(out(o, "e1"), 30, 1e-6);
    nearAbs(out(o, "e3"), 10, 1e-6);
  });
  test("the brief's 6-digit DCM (case-table row 1 precision) passes the 1×10⁻⁶ check and gives ZYX (30, 20, 10)", () => {
    const o = run("attitude-convert", { formA: "matrix", dcmA: "0.813798 -0.440970 0.378522\n0.469846 0.882564 0.018028\n-0.342020 0.163176 0.925417" });
    expect(o.ok).not.toBe(false);
    nearAbs(out(o, "e1"), 30, 1e-4);
    nearAbs(out(o, "e2"), 20, 1e-4);
    nearAbs(out(o, "e3"), 10, 1e-4);
  });
  test("extrinsic frame: the primary report is extrinsic, the reversed intrinsic is the alternative", () => {
    const o = run("attitude-convert", { frame: "extrinsic", seqA: "XYZ", a1: "10", a2: "20", a3: "30" });
    nearAbs(out(o, "qx"), 0.0381346, 5e-7);
    expect(o.text).toContain("Euler angles, extrinsic xyz: (10°, 20°, 30°)");
    expect(o.text).toContain("intrinsic ZYX (the reversed sequence about the other frame): (30°, 20°, 10°)");
  });
  test("proper Euler lock (ZXZ, middle 0°): named, the sum determined", () => {
    const o = run("attitude-convert", { seqA: "ZXZ", a1: "40", a2: "0", a3: "25" });
    expect(o.text).toMatch(/GIMBAL LOCK/);
    expect(o.text).toMatch(/only their sum is determined/);
    nearAbs(out(o, "e1"), 65, 1e-9);
    nearAbs(out(o, "e3"), 0, 1e-12);
  });
  test("every default tool draws a figure and is display-clean", () => {
    for (const c of KALMAN_CALCS) {
      const o = run(c.id);
      expect(o.ok).not.toBe(false);
      expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
      expect((o.blocks ?? []).some((b) => b.kind === "math")).toBe(true);
      expect((o.outputs ?? []).length).toBeGreaterThan(0);
      displayClean(o);
    }
  });
});

describe("work is bounded at the documented caps", () => {
  test("2000 samples through a 6-state, 4-measurement model runs to completion", () => {
    const n = 6, m = 4;
    const F = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0.95 : j === i + 1 ? 0.1 : 0)));
    const H = Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    const Q = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0.1 : 0)));
    const R = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 0.5 : 0)));
    const z = Array.from({ length: MAX_SAMPLES }, (_, k) => Array.from({ length: m }, (_, i) => Math.sin(k / 50 + i)));
    const res = runFilter({ F, H, Q, R }, new Array(n).fill(0), Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))), z);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.steps.length).toBe(MAX_SAMPLES);
    const ss = steadyState({ F, H, Q, R });
    expect(ss.ok).toBe(true);
    if (ss.ok) expect(ss.iterations).toBeLessThanOrEqual(60);
  });
  test("random walk preset is the 1 × 1 model", () => {
    expect(randomWalkModel(0.5, 2)).toEqual({ F: [[1]], H: [[1]], Q: [[0.5]], R: [[2]] });
  });
});
