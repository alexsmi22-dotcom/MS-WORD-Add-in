// Release Q, part Q4 — linear optical quantum computing. The FIXED CASE TABLE (integrator's oracle,
// ~/jurislab-relE/oracle_quantum2.py section Q4), then oracle-backed engine tests, adversarial tests and the contract.
// Every later fix round must keep every row's outcome (cumulative gate); reviewers add rows at the end of CASES.
//
// Further reference values come from this oracle, run in C:\Users\AlexanderSmith\jurislab-oracle-venv (numpy, scipy):
//   import numpy as np, math, itertools
//   from scipy.stats import unitary_group
//   from scipy.integrate import quad
//   def perm(M):
//       n=M.shape[0]; return sum(np.prod([M[i,p[i]] for i in range(n)]) for p in itertools.permutations(range(n))) if n else 1.0
//   def sub(U,s,t):
//       cols=[j for j,k in enumerate(s) for _ in range(k)]; rows=[i for i,k in enumerate(t) for _ in range(k)]
//       return U[np.ix_(rows,cols)]
//   def prob(U,s,t): M=sub(U,s,t); return abs(perm(M))**2/(np.prod([math.factorial(k) for k in s])*np.prod([math.factorial(k) for k in t]))
//   def pdist(U,s,t): M=sub(U,s,t); return perm(np.abs(M)**2).real/np.prod([math.factorial(k) for k in t])
//   def BS(R): T=1-R; return np.array([[math.sqrt(T),1j*math.sqrt(R)],[1j*math.sqrt(R),math.sqrt(T)]])
//   # HOM R=0.3, M=0.5 -> 0.37
//   # dip: psi(t)=(2πs²)^(-1/4) exp(-t²/(4s²)), s = w/(2√(2 ln2)), w=1 ps, tau=0.8 ps:
//   #   quad(psi(t)psi(t-tau))² = 0.41179550863378644 = exp(-tau²/(4s²)); 50:50 P11 = 0.2941022456831068
//   # tritter |1,1,1>: P(3,0,0)=P(0,3,0)=P(0,0,3)=2/9, P(1,1,1)=1/3, others 0; distinguishable 1/27, 1/9 ×6, 2/9
//   # 4-mode DFT |1,1,0,0>: eight patterns at 1/8 each (sum 1)
//   # chain R=[0.5,0.5] (BS(0,1) then BS(1,2)), |1,1,0>: P(2,0,0)=0.5, P(0,2,0)=0.125, P(0,1,1)=0.25, P(0,0,2)=0.125
//   # U8 = unitary_group.rvs(8, random_state=7) (rows below), s=(1,)*8:
//   #   (1,…,1) 0.00024249074711318766 dist 0.0043773530964463575; (2,0,1,1,1,1,1,1) 0.00011473323579448351;
//   #   (8,0,…) 0.000235533641151806 dist 5.841608163494638e-09; (0,0,3,0,2,0,1,2) 4.984775531065034e-05
//   #   perm(U8[:5,:5]) = -0.010090965547529737-0.03669917564684807j
//   # MZI R1=0.3 R2=0.6 φ=40°, input 0: [0.11604689809680944, 0.8839531019031907]; V0 0.9760845356801586, V1 0.831479419283098
import { LINEAR_OPTICS_CALCS, probShow } from "../linearOpticsCalcs";
import type { AnalyzeOutput } from "../analyzeBlocks";
import {
  FWHM_TO_SIGMA,
  LO_GATES,
  WORK_CAP,
  beamSplitter,
  beamSplitterChain,
  dftUnitary,
  dualRail,
  fockPatterns,
  gateRate,
  gaussianOverlap,
  hom,
  machZehnder,
  multiphoton,
  patternCount,
  patternProbability,
  permanent,
  readComplexMatrix,
  runWork,
} from "../linearOptics";
import { cx, isUnitary, type CMat } from "../quantumCore";
import { mathToOmml } from "../mathOmml";

const calc = (id: string) => {
  const c = LINEAR_OPTICS_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
};
const run = (id: string, over: Record<string, string> = {}): AnalyzeOutput => {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
};
const out = (o: AnalyzeOutput, key: string): number => {
  const v = o.outputs?.find((x) => x.key === key);
  if (!v) throw new Error(`no output ${key} in ${o.text}`);
  return v.value;
};

// ---------------------------------------------------------------------------------------------------------------
// THE FIXED CASE TABLE
// ---------------------------------------------------------------------------------------------------------------

type Case = { name: string; id: string; over: Record<string, string>; expect: Record<string, number> } | { name: string; id: string; over: Record<string, string>; refuse: RegExp };

const CASES: Case[] = [
  { name: "50:50, |1,1⟩ in (multiphoton tool)", id: "lo-multiphoton", over: { net: "bs", R: "0.5", input: "1, 1" }, expect: { p_11: 0, p_20: 0.5, p_02: 0.5 } },
  { name: "50:50, |1,1⟩ in (HOM tool)", id: "lo-hom", over: { R: "0.5", M0: "1", delay: "0" }, expect: { p11: 0, p20: 0.5, p02: 0.5 } },
  { name: "R = 0.3, |1,1⟩ in (multiphoton tool)", id: "lo-multiphoton", over: { net: "bs", R: "0.3", input: "1, 1" }, expect: { p_11: 0.16 } },
  { name: "R = 0.3, |1,1⟩ in (HOM tool)", id: "lo-hom", over: { R: "0.3", M0: "1", delay: "0" }, expect: { p11: 0.16 } },
  // Port 0 = the same-index output (transmitted at both splitters): P0 = sin²(φ/2) = 0.25, P1 = cos²(φ/2) = 0.75.
  { name: "MZI φ = 60°, one photon in port 0", id: "lo-mach-zehnder", over: { R1: "0.5", R2: "0.5", phi: "60", input: "0" }, expect: { p0: 0.25, p1: 0.75 } },
  { name: "Balanced tritter (3-mode DFT), |1,1,1⟩", id: "lo-multiphoton", over: { net: "dft", m: "3", input: "1, 1, 1" }, expect: { p_111: 1 / 3 } },
  { name: "Overlap 0 (distinguishable), 50:50", id: "lo-hom", over: { R: "0.5", M0: "0", delay: "0" }, expect: { p11: 0.5 } },
  { name: "9 photons", id: "lo-multiphoton", over: { net: "dft", m: "9", input: "1,1,1,1,1,1,1,1,1" }, refuse: /9 photons: the multiphoton calculation is limited to 8 photons/ },
  { name: "Non-unitary matrix", id: "lo-multiphoton", over: { net: "typed", U: "1, 1\n0, 1", input: "1, 1" }, refuse: /not unitary/ },
];

describe("Q4 fixed case table", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const o = run(c.id, c.over);
    if ("refuse" in c) {
      expect(o.ok).toBe(false);
      expect(o.text).toMatch(c.refuse);
    } else {
      expect(o.ok).not.toBe(false);
      for (const [k, v] of Object.entries(c.expect)) expect(Math.abs(out(o, k) - v)).toBeLessThan(1e-12);
    }
  });
  test("the MZI result names which port is which", () => {
    const o = run("lo-mach-zehnder", { phi: "60" });
    expect(o.text).toMatch(/Port 0 is the output path transmitted at both splitters/);
    expect(o.text).toMatch(/P\(port 0\) = 1\/4 = 0\.25; P\(port 1\) = 3\/4 = 0\.75/);
  });
  test("the tritter's 1/3 is written as a fraction", () => {
    expect(run("lo-multiphoton").text).toMatch(/\|1,1,1⟩ with 1\/3 ≈ 0\.333333/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Engine against the oracle
// ---------------------------------------------------------------------------------------------------------------

// scipy.stats.unitary_group.rvs(8, random_state=7)
const U8_RAW: [number, number][][] = [
  [[0.38474642621023336, -0.08726319626056865], [-0.24227393647137366, -0.3144351410882991], [-0.21206795322198735, -0.3326273220021942], [0.051537121732219436, -0.21265589327187187], [-0.12386194052977584, -0.3477465413602076], [-0.06228029890582517, 0.076479308288594], [0.20660449381984905, 0.4378731824261314], [-0.31760044724663705, -0.04484535040311677]],
  [[0.23160859364815767, 0.024727262384823152], [0.1516748571435598, 0.44314826333291274], [-0.08661554308849076, 0.3532909358483169], [0.20113118488201695, -0.3714321327026717], [-0.0035880741012342546, -0.03672613193408901], [-0.1450384487250882, 0.23746494016541528], [-0.13482493199874476, -0.1528095075991692], [-0.4370293101590145, -0.3229821938860024]],
  [[0.1262168286275042, 0.14900434767300963], [0.030018181084331474, 0.24962020259606338], [0.13553450408359835, 0.06702646868553246], [-0.38265611137122, -0.48742350959654196], [0.2556065327845578, -0.09395269692929226], [-0.2970652540829374, -0.1940954130130501], [0.2802920498845808, 0.20093370093580654], [0.4131974845284925, 0.045093272312176434]],
  [[-0.01032939797927895, 0.34811674038969537], [-0.43804536462838023, 0.14856579281583482], [-0.04785972774772042, 0.18747595087735994], [-0.393532398542106, 0.33893957512822454], [0.2592956719523441, -0.16260089199824287], [-0.14356025929349517, 0.02253906712919033], [-0.2560307802664757, 0.08776047018915324], [-0.3434223544856002, 0.22712002343066154]],
  [[-0.37576798211278245, 0.5143409086146171], [0.3079056965325794, 0.21777940580483085], [-0.2620806843975467, -0.20671812078027302], [-0.11905500776818588, 0.015061606097005173], [-0.23935172607770377, 0.16140971760269515], [0.15558864870435193, 0.17155914924598475], [0.23062696772656946, 0.33696062867786075], [-0.13319313392562854, -0.06887715799210714]],
  [[0.1913423200745775, 0.11068493585063614], [-0.08737521718207802, -0.23014147888992156], [0.05197690853041595, 0.30881241018430167], [-0.13578362073772768, 0.011373303580002807], [-0.591000160902242, 0.3444569437534939], [-0.3232774423274614, 0.07153925288062675], [-0.29500061845005054, 0.24655195114322792], [0.20236890743130814, -0.087062249806752]],
  [[0.06131534219465655, 0.24032307432712638], [-0.15997739708442643, 0.12948912950658692], [0.5464823996544593, -0.33990808874717293], [0.04701492417524354, -0.05187153144209504], [-0.3352599373707791, 0.11264321052087398], [-0.14392144576806326, -0.3139131837477754], [0.18797674995749533, -0.3084919025117878], [-0.31508203179622546, 0.05405255365215335]],
  [[-0.32658306469892595, -0.08884798569285013], [0.22347432940402376, -0.22527110020994118], [0.006681386358532042, 0.16750833432621054], [0.25639603858860627, 0.1278404232451032], [0.13470572696982813, 0.005128530309254475], [-0.6944148785639059, 0.032780275384823254], [0.28667436869596064, 0.0680610479277128], [-0.20589984932218208, 0.20954272785281564]],
];
const U8: CMat = U8_RAW.map((row) => row.map(([re, im]) => cx(re, im)));

/** Brute-force permanent over all permutations (the oracle's definition). */
function permBrute(M: CMat): { re: number; im: number } {
  const n = M.length;
  let re = 0, im = 0;
  const p = Array.from({ length: n }, (_, i) => i);
  const rec = (k: number): void => {
    if (k === n) {
      let pr = 1, pi = 0;
      for (let i = 0; i < n; i++) {
        const z = M[i][p[i]];
        const a = pr * z.re - pi * z.im;
        pi = pr * z.im + pi * z.re;
        pr = a;
      }
      re += pr;
      im += pi;
      return;
    }
    for (let i = k; i < n; i++) {
      [p[k], p[i]] = [p[i], p[k]];
      rec(k + 1);
      [p[k], p[i]] = [p[i], p[k]];
    }
  };
  rec(0);
  return { re, im };
}

describe("permanents (Ryser) and multiphoton probabilities", () => {
  test("Ryser equals the brute-force permanent to 10⁻¹² on Haar-random submatrices up to 8×8", () => {
    for (let n = 0; n <= 8; n++) {
      const M = U8.slice(0, n).map((row) => row.slice(0, n));
      const a = permanent(M);
      const b = n ? permBrute(M) : { re: 1, im: 0 };
      expect(Math.abs(a.re - b.re)).toBeLessThan(1e-12);
      expect(Math.abs(a.im - b.im)).toBeLessThan(1e-12);
    }
    const p5 = permanent(U8.slice(0, 5).map((r) => r.slice(0, 5)));
    expect(Math.abs(p5.re - -0.010090965547529737)).toBeLessThan(1e-12);
    expect(Math.abs(p5.im - -0.03669917564684807)).toBeLessThan(1e-12);
  });
  test("n = 8 Haar unitary: pattern probabilities match numpy's brute force", () => {
    expect(isUnitary(U8, 1e-12)).toBe(true);
    const s = [1, 1, 1, 1, 1, 1, 1, 1];
    const rows: [number[], number, number | null][] = [
      [[1, 1, 1, 1, 1, 1, 1, 1], 0.00024249074711318766, 0.0043773530964463575],
      [[2, 0, 1, 1, 1, 1, 1, 1], 0.00011473323579448351, 0.001944093251473677],
      [[8, 0, 0, 0, 0, 0, 0, 0], 0.000235533641151806, 5.841608163494638e-9],
      [[0, 0, 3, 0, 2, 0, 1, 2], 4.984775531065034e-5, 9.057101112413034e-5],
    ];
    for (const [t, p, pd] of rows) {
      const r = patternProbability(U8, s, t);
      expect(Math.abs(r.p - p)).toBeLessThan(1e-15);
      if (pd !== null) expect(Math.abs(r.pDist - pd) / pd).toBeLessThan(1e-9);
    }
  });
  test("8 photons in 7 modes: all 3003 patterns run within the work bound and sum to 1", () => {
    const U = beamSplitterChain([0.5, 0.3, 0.7, 0.5, 0.2, 0.6]);
    const r = multiphoton(U, [2, 1, 1, 1, 1, 1, 1]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results.length).toBe(3003);
      expect(Math.abs(r.total - 1)).toBeLessThan(1e-10);
      expect(Math.abs(r.totalDist - 1)).toBeLessThan(1e-10);
    }
    expect(runWork(8, patternCount(8, 7))).toBeLessThanOrEqual(WORK_CAP);
  });
  test("8 photons in 8 modes: the full enumeration is refused by name; listed patterns still run", () => {
    expect(runWork(8, patternCount(8, 8))).toBeGreaterThan(WORK_CAP);
    const r = multiphoton(U8, [1, 1, 1, 1, 1, 1, 1, 1]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/8 photons in 8 modes have 6,435 patterns/);
    const l = multiphoton(U8, [1, 1, 1, 1, 1, 1, 1, 1], [[1, 1, 1, 1, 1, 1, 1, 1]]);
    expect(l.ok && Math.abs(l.results[0].p - 0.00024249074711318766) < 1e-15).toBe(true);
  });
  test("tritter |1,1,1⟩: every pattern, quantum and distinguishable", () => {
    const r = multiphoton(dftUnitary(3), [1, 1, 1]);
    if (!r.ok) throw new Error(r.error);
    const get = (t: number[]) => r.results.find((x) => x.t.join() === t.join())!;
    expect(get([3, 0, 0]).p).toBeCloseTo(2 / 9, 12);
    expect(get([0, 0, 3]).p).toBeCloseTo(2 / 9, 12);
    expect(get([1, 1, 1]).p).toBeCloseTo(1 / 3, 12);
    expect(get([2, 1, 0]).p).toBeCloseTo(0, 12);
    expect(get([1, 1, 1]).pDist).toBeCloseTo(2 / 9, 12);
    expect(get([3, 0, 0]).pDist).toBeCloseTo(1 / 27, 12);
    expect(get([2, 1, 0]).pDist).toBeCloseTo(1 / 9, 12);
    expect(r.total).toBeCloseTo(1, 12);
  });
  test("4-mode DFT |1,1,0,0⟩: eight patterns of 1/8", () => {
    const r = multiphoton(dftUnitary(4), [1, 1, 0, 0]);
    if (!r.ok) throw new Error(r.error);
    const nz = r.results.filter((x) => x.p > 1e-12);
    expect(nz.length).toBe(8);
    for (const x of nz) expect(x.p).toBeCloseTo(0.125, 12);
  });
  test("chain of two 50:50 splitters (0–1 then 1–2), |1,1,0⟩", () => {
    const U = beamSplitterChain([0.5, 0.5]);
    expect(Math.abs(U[1][0].im - 0.5)).toBeLessThan(1e-15);
    expect(Math.abs(U[2][0].re - -0.5)).toBeLessThan(1e-15);
    const r = multiphoton(U, [1, 1, 0]);
    if (!r.ok) throw new Error(r.error);
    const get = (t: number[]) => r.results.find((x) => x.t.join() === t.join())!.p;
    expect(get([2, 0, 0])).toBeCloseTo(0.5, 12);
    expect(get([1, 1, 0])).toBeCloseTo(0, 12);
    expect(get([0, 2, 0])).toBeCloseTo(0.125, 12);
    expect(get([0, 1, 1])).toBeCloseTo(0.25, 12);
    expect(get([0, 0, 2])).toBeCloseTo(0.125, 12);
    // Through the pane, the chain preset.
    const o = run("lo-multiphoton", { net: "chain", chain: "0.5, 0.5", input: "1, 1, 0" });
    expect(out(o, "p_011")).toBeCloseTo(0.25, 12);
  });
  test("pattern enumeration: C(n + m − 1, n) patterns, (n,0,…) first", () => {
    expect(fockPatterns(3, 3).length).toBe(10);
    expect(fockPatterns(3, 3)[0]).toEqual([3, 0, 0]);
    expect(patternCount(8, 12)).toBe(75582);
    expect(patternCount(2, 2)).toBe(3);
  });
  test("photon number is conserved: an output pattern with the wrong count is refused", () => {
    const r = multiphoton(beamSplitter(0.5), [1, 1], [[1, 0]]);
    expect(r.ok).toBe(false);
  });
});

describe("Hong–Ou–Mandel", () => {
  test("partial distinguishability: R = 0.3, M = 0.5 → 0.37; probabilities sum to 1", () => {
    const h = hom(0.3, 0.5);
    expect(h.p11).toBeCloseTo(0.37, 14);
    expect(h.p11 + h.p20 + h.p02).toBeCloseTo(1, 14);
  });
  test("the dip at τ = 0.8 ps for w = 1 ps matches the numerical overlap integral", () => {
    expect(Math.abs(gaussianOverlap(0.8e-12, 1e-12, 1) - 0.41179550863378644)).toBeLessThan(1e-13);
    const o = run("lo-hom", { width: "1 ps", delay: "0.8 ps" });
    expect(Math.abs(out(o, "p11") - 0.2941022456831068)).toBeLessThan(1e-13);
    expect(o.text).toMatch(/Photon duration: 1 ps = 1000 fs/);
  });
  test("the dip's FWHM is √2·w", () => {
    const w = 300e-15;
    const half = Math.SQRT2 * w / 2;
    expect(gaussianOverlap(half, w, 1)).toBeCloseTo(0.5, 12);
    expect(FWHM_TO_SIGMA * 2 * Math.sqrt(2 * Math.LN2)).toBeCloseTo(1, 15);
    expect(out(run("lo-hom", { width: "300 fs" }), "dipFwhm")).toBeCloseTo(Math.SQRT2 * 300, 9);
    // The output is in the unit the text shows it in: ps for a 2 ps photon.
    const o2 = run("lo-hom", { width: "2 ps" });
    expect(out(o2, "dipFwhm")).toBeCloseTo(2 * Math.SQRT2, 12);
    expect(o2.outputs!.find((x) => x.key === "dipFwhm")!.unit).toBe("ps");
  });
  test("bare numbers are read in the unit the fields name (fs)", () => {
    const a = run("lo-hom", { width: "500", delay: "300" });
    const b = run("lo-hom", { width: "500 fs", delay: "0.3 ps" });
    expect(out(a, "p11")).toBeCloseTo(out(b, "p11"), 15);
    expect(out(a, "overlap")).toBeCloseTo(gaussianOverlap(300, 500, 1), 15);
    expect(out(a, "dipFwhm")).toBeCloseTo(Math.SQRT2 * 500, 9);
  });
  test("visibility 2RT·M₀/(T² + R²)", () => {
    expect(out(run("lo-hom", { R: "0.5", M0: "1" }), "visibility")).toBeCloseTo(1, 14);
    expect(out(run("lo-hom", { R: "0.3", M0: "0.9" }), "visibility")).toBeCloseTo((2 * 0.21 * 0.9) / 0.58, 14);
  });
});

describe("Mach–Zehnder", () => {
  test("unbalanced splitters against numpy", () => {
    const m = machZehnder(0.3, 0.6, (40 * Math.PI) / 180, 0);
    expect(Math.abs(m.p[0] - 0.11604689809680944)).toBeLessThan(1e-14);
    expect(Math.abs(m.vis[0] - 0.9760845356801586)).toBeLessThan(1e-14);
    expect(Math.abs(m.vis[1] - 0.831479419283098)).toBeLessThan(1e-14);
  });
  test("input port 1 is the mirror: P(port 0) = cos²(φ/2) for 50:50", () => {
    const o = run("lo-mach-zehnder", { input: "1", phi: "60" });
    expect(out(o, "p0")).toBeCloseTo(0.75, 14);
  });
  test("phase in radians with π; classical power converted", () => {
    const o = run("lo-mach-zehnder", { phi: "pi/3", power: "2 W" });
    expect(out(o, "p0")).toBeCloseTo(0.25, 14);
    expect(out(o, "P0out")).toBeCloseTo(500, 9);
    expect(o.text).toMatch(/Input power: 2 W = 2000 mW/);
  });
  test("the beam splitter matrix is unitary and follows the stated convention", () => {
    const B = beamSplitter(0.3);
    expect(isUnitary(B, 1e-14)).toBe(true);
    expect(B[0][1].im).toBeCloseTo(Math.sqrt(0.3), 15);
    expect(B[0][0].re).toBeCloseTo(Math.sqrt(0.7), 15);
  });
});

describe("dual rail and the CZ gates", () => {
  test("cited success probabilities and their detected-photon counts are pinned", () => {
    const post = LO_GATES.find((g) => g.key === "post")!;
    const klm = LO_GATES.find((g) => g.key === "klm")!;
    expect(post.p0).toBe(1 / 9);
    expect(post.k).toBe(2);
    expect(post.cite).toMatch(/Hofmann & Takeuchi, Phys\. Rev\. A 66, 024308 \(2002\)/);
    expect(post.cite).toMatch(/Ralph, Langford, Bell & White, Phys\. Rev\. A 65, 062324 \(2002\)/);
    expect(klm.p0).toBe(1 / 16);
    expect(klm.k).toBe(2);
    expect(klm.cite).toMatch(/Knill, Laflamme & Milburn, Nature 409, 46 \(2001\)/);
  });
  test("η scaling and N attempts", () => {
    const post = LO_GATES[0], klm = LO_GATES[1];
    expect(gateRate(post, 0.9, 1).p).toBeCloseTo(0.09, 15);
    expect(gateRate(klm, 0.9, 1).p).toBeCloseTo(0.050625, 15);
    expect(gateRate(post, 0.5, 1).p).toBeCloseTo(1 / 36, 15);
    const g = gateRate(post, 0.9, 1000);
    expect(g.expected).toBeCloseTo(90, 9);
    expect(g.atLeastOne).toBeCloseTo(1, 12);
    expect(gateRate(post, 1, 10).atLeastOne).toBeCloseTo(1 - (8 / 9) ** 10, 14);
    const o = run("lo-dual-rail-gates", { etad: "90 %", trans: "1", N: "1000" });
    expect(out(o, "p_post")).toBeCloseTo(0.09, 14);
    expect(out(o, "n_klm")).toBeCloseTo(50.625, 9);
    expect(o.text).toMatch(/P_succ = 1\/9 × 0\.9² = 0\.09/);
    // (1 − 0.09)¹⁰⁰⁰ = 1.2×10⁻⁴¹: P(at least one) is 1 in double precision, so it is written 1 − q, never "1".
    expect(o.text).toMatch(/P\(at least one\) = 1 − \d(\.\d+)?×10⁻⁴¹/);
    expect(g.none).toBeCloseTo(Math.exp(1000 * Math.log1p(-0.09)), 50);
  });
  test("transmission multiplies into η", () => {
    expect(out(run("lo-dual-rail-gates", { etad: "0.8", trans: "0.5" }), "eta")).toBeCloseTo(0.4, 15);
  });
  test("HWP at 22.5° takes |H⟩ to |D⟩: half in each rail", () => {
    const d = dualRail([cx(1), cx(0)], [{ kind: "hwp", angleDeg: 22.5 }])!;
    expect(d.rail[0]).toBeCloseTo(0.5, 14);
    const o = run("lo-dual-rail-gates");
    expect(out(o, "p_rail0")).toBeCloseTo(0.5, 14);
    expect(o.text).toMatch(/on the rails: 1\/√2\|1,0⟩ \+ 1\/√2\|0,1⟩/);
  });
  test("typed state α|H⟩ + β|V⟩ with no plates: |α|², |β|²", () => {
    const o = run("lo-dual-rail-gates", { pol: "typed", state: "0.6|H⟩ + 0.8i|V⟩", plates: "" });
    expect(out(o, "p_rail0")).toBeCloseTo(0.36, 14);
  });
  test("QWP at 0° turns |D⟩ into |R⟩ (still half in each rail)", () => {
    const d = dualRail([cx(Math.SQRT1_2), cx(Math.SQRT1_2)], [{ kind: "qwp", angleDeg: 0 }])!;
    expect(d.out[1].im).toBeCloseTo(Math.SQRT1_2, 14);
    expect(d.rail[0]).toBeCloseTo(0.5, 14);
  });
  test("a polariser is a filter: stated, renormalised", () => {
    const o = run("lo-dual-rail-gates", { pol: "D", plates: "polariser 0" });
    expect(out(o, "p_rail0")).toBeCloseTo(1, 14);
    expect(o.text).toMatch(/passes 1\/2 = 0\.5 of the light/);
    expect(run("lo-dual-rail-gates", { pol: "V", plates: "polariser 0" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adversarial
// ---------------------------------------------------------------------------------------------------------------

describe("adversarial and degenerate inputs", () => {
  test.each([
    ["lo-mach-zehnder", { R1: "1.5" }, /above 1/],
    ["lo-mach-zehnder", { R1: "-0.1" }, /negative/],
    ["lo-mach-zehnder", { R1: "" }, /required/],
    ["lo-mach-zehnder", { R1: "0.5 m" }, /not a number/],
    ["lo-mach-zehnder", { phi: "abc" }, /Phase φ/],
    ["lo-mach-zehnder", { phi: "Infinity" }, /Phase φ/],
    ["lo-mach-zehnder", { power: "5 kg" }, /Input power/],
    ["lo-mach-zehnder", { power: "-1 mW" }, /negative/],
    ["lo-hom", { width: "0" }, /greater than zero/],
    ["lo-hom", { width: "5 kg" }, /Photon duration/],
    ["lo-hom", { width: "10 µm" }, /Photon duration/],
    ["lo-hom", { delay: "NaN" }, /Delay/],
    ["lo-hom", { delay: "1 s", width: "1 fs" }, /10⁶ photon durations/],
    ["lo-hom", { M0: "2" }, /above 1/],
    ["lo-multiphoton", { input: "" }, /Input photons/],
    ["lo-multiphoton", { input: "1, 0.5, 1" }, /whole numbers/],
    ["lo-multiphoton", { input: "1, -1, 1" }, /whole numbers/],
    ["lo-multiphoton", { input: "0, 0, 0" }, /No photons/],
    ["lo-multiphoton", { input: "1, 1, 1, 1" }, /4 modes given but the network has 3/],
    ["lo-multiphoton", { m: "13" }, /from 2 to 12/],
    ["lo-multiphoton", { m: "1" }, /from 2 to 12/],
    ["lo-multiphoton", { m: "3 modes" }, /whole number/],
    ["lo-multiphoton", { net: "dft", m: "12", input: "1,1,1,1,1,1,1,1" }, /Too many output patterns: 8 photons in 12 modes have 75,582 patterns/],
    ["lo-multiphoton", { net: "dft", m: "9", input: "1,1,1,1,1,1,1,1" }, /Too many output patterns/],
    ["lo-multiphoton", { net: "typed", U: "0.7071, 0.7071i\n0.7071i, 0.7071" }, /not unitary.*10⁻⁶/],
    ["lo-multiphoton", { net: "typed", U: "1, 0, 0\n0, 1" }, /square/],
    ["lo-multiphoton", { net: "typed", U: "1, x\n0, 1" }, /Row 1, entry 2/],
    ["lo-multiphoton", { net: "typed", U: "1, 1/0\n0, 1" }, /Row 1, entry 2/],
    ["lo-multiphoton", { net: "typed", U: "1" }, /at least 2 modes/],
    ["lo-multiphoton", { net: "chain", chain: "0.5, 1.5" }, /fraction from 0 to 1/],
    ["lo-multiphoton", { outputs: "2, 0, 0" }, /holds 2 photons, but 3 went in/],
    ["lo-multiphoton", { outputs: "1, 1" }, /has 2 modes but the network has 3/],
    ["lo-dual-rail-gates", { plates: "hwp" }, /Wave plates/],
    ["lo-dual-rail-gates", { pol: "typed", state: "|00⟩" }, /one qubit/],
    ["lo-dual-rail-gates", { pol: "typed", state: "0|H⟩" }, /zero/],
    ["lo-dual-rail-gates", { N: "0" }, /from 1 to/],
    ["lo-dual-rail-gates", { N: "1.5" }, /whole number/],
    ["lo-dual-rail-gates", { etad: "90" }, /above 1/],
    ["lo-dual-rail-gates", { etad: "0.9 W" }, /not a number/],
  ] as [string, Record<string, string>, RegExp][])("%s %j is refused by name", (id, over, re) => {
    const o = run(id, over);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
  });
  test("a nearly-unitary typed matrix (exact entries) is accepted", () => {
    const o = run("lo-multiphoton", { net: "typed", U: "1/sqrt(2), i/sqrt(2)\ni/sqrt(2), 1/sqrt(2)", input: "1, 1" });
    expect(out(o, "p_11")).toBeCloseTo(0, 14);
  });
  test("typed entries: tabs, whitespace and e^(…) forms", () => {
    const a = readComplexMatrix("1/sqrt(2)\ti/sqrt(2)\ni/sqrt(2)\t1/sqrt(2)");
    expect("U" in a).toBe(true);
    const b = readComplexMatrix("0 1\n1 0");
    expect("U" in b && b.U[0][1].re === 1).toBe(true);
    const w = "e^(2πi/3)/sqrt(3)";
    const c = readComplexMatrix(`1/sqrt(3), 1/sqrt(3), 1/sqrt(3)\n1/sqrt(3), ${w}, e^(4πi/3)/sqrt(3)\n1/sqrt(3), e^(4πi/3)/sqrt(3), ${w}`);
    if (!("U" in c)) throw new Error(c.error);
    const o = multiphoton(c.U, [1, 1, 1]);
    if (!o.ok) throw new Error(o.error);
    expect(o.results.find((x) => x.t.join() === "1,1,1")!.p).toBeCloseTo(1 / 3, 12);
  });
  test("input patterns: '1,0', '0,1' and '1 1 1'; a short pattern is padded with a note", () => {
    expect(out(run("lo-multiphoton", { net: "bs", input: "1,0" }), "p_10")).toBeCloseTo(0.5, 14);
    expect(out(run("lo-multiphoton", { net: "bs", input: "0,1" }), "p_01")).toBeCloseTo(0.5, 14);
    expect(out(run("lo-multiphoton", { input: "1 1 1" }), "p_111")).toBeCloseTo(1 / 3, 12);
    const o = run("lo-multiphoton", { input: "2" });
    expect(o.text).toMatch(/remaining 2 are empty: \|2,0,0⟩/);
  });
  test("listed output patterns are evaluated even when the full enumeration is refused", () => {
    const o = run("lo-multiphoton", { net: "dft", m: "12", input: "1,1,1,1,1,1,1,1,0,0,0,0", outputs: "1,1,1,1,1,1,1,1,0,0,0,0\n8,0,0,0,0,0,0,0,0,0,0,0" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/2 listed output patterns/);
  });
  test("degenerate splitters: R = 0 and R = 1", () => {
    expect(out(run("lo-hom", { R: "0" }), "p11")).toBeCloseTo(1, 14);
    expect(out(run("lo-hom", { R: "1" }), "p11")).toBeCloseTo(1, 14);
    const m = run("lo-mach-zehnder", { R1: "0", R2: "0" });
    expect(out(m, "p0")).toBeCloseTo(1, 14);
    expect(out(m, "vis0")).toBe(0);
    expect(out(run("lo-dual-rail-gates", { etad: "0" }), "p_post")).toBe(0);
  });
  test("probShow: fractions with small denominators only", () => {
    expect(probShow(1 / 3)).toBe("1/3 ≈ 0.333333");
    expect(probShow(0.25)).toBe("1/4 = 0.25");
    expect(probShow(0.16)).toBe("4/25 = 0.16");
    expect(probShow(0.00024249074711318766)).toBe("2.42491×10⁻⁴");
    expect(probShow(0)).toBe("0");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------------------------

const VARIANTS: [string, Record<string, string>][] = [
  ["lo-mach-zehnder", {}],
  ["lo-mach-zehnder", { R1: "0.3", R2: "0.6", phi: "-40", power: "1 mW" }],
  ["lo-hom", {}],
  ["lo-hom", { R: "0.3", M0: "0.8", width: "2 ps", delay: "-1.5 ps" }],
  ["lo-multiphoton", {}],
  ["lo-multiphoton", { net: "dft", m: "4", input: "2, 1, 1, 0" }],
  ["lo-multiphoton", { net: "bs", input: "1, 1" }],
  ["lo-dual-rail-gates", {}],
  ["lo-dual-rail-gates", { gate: "klm", trans: "0.7", pol: "R", plates: "qwp 45\nhwp 10" }],
];

describe("the Release E contract", () => {
  test.each(VARIANTS)("%s %j: outputs, math lines that typeset, a table and a figure; display contract", (id, over) => {
    const o = run(id, over);
    expect(o.ok).not.toBe(false);
    expect(o.outputs?.length).toBeGreaterThan(0);
    expect(o.outputs!.every((x) => Number.isFinite(x.value))).toBe(true);
    const blocks = o.blocks ?? [];
    for (const b of blocks) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    expect(blocks.some((b) => b.kind === "math")).toBe(true);
    expect(blocks.some((b) => b.kind === "table")).toBe(true);
    const plots = blocks.filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThan(0);
    for (const p of plots) if (p.kind === "plot") {
      expect(p.svg).toMatch(/^<svg[\s\S]*<text[\s\S]*<\/svg>$/);
      expect(p.svg).not.toMatch(/NaN|Infinity|undefined/);
      const labels = [...p.svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]);
      for (const l of labels) {
        expect(l).not.toMatch(/\^|\d[eE][-+]?\d/);
        expect(l).not.toMatch(/(^|[\s(])-\d/);
      }
    }
    expect(o.text).not.toMatch(/NaN|Infinity|undefined|\u2014/);
    expect(o.text).not.toMatch(/\d[eE][-+]?\d/);
    // No caret anywhere in the result text (math lines carry their own syntax; the text uses the fallbacks).
    expect(o.text).not.toMatch(/\^/);
    expect(o.text).not.toMatch(/(^|[\s(=])-\d/m);
  });
  test("unit contracts and group", () => {
    const want: Record<string, string> = { "lo-mach-zehnder": "converts", "lo-hom": "converts", "lo-multiphoton": "domain", "lo-dual-rail-gates": "domain" };
    for (const c of LINEAR_OPTICS_CALCS) {
      expect(c.unitContract).toBe(want[c.id]);
      expect(c.group).toBe("Quantum optics");
    }
  });
  test("ids do not collide with the existing quantum tools", () => {
    for (const c of LINEAR_OPTICS_CALCS) expect(c.id).toMatch(/^lo-/);
  });
});
