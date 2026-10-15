// INDEPENDENT adversarial review of v2.139.0 (numerics + topology): DAE index
// reduction, KO, cobordism, persistence over 𝔽p, and their routing.
//
// Convention:
//   * plain `it`     — a WRONG answer or a false claim. It FAILS today; it
//                      passes once the defect is fixed.
//   * `it.failing`   — a refusal where the answer is known, a display-contract
//                      miss (the tool's own output does not read back), or a
//                      cosmetic defect. It PASSES today (the assertion inside
//                      fails); when it is fixed jest reports it, and the pin
//                      becomes a plain `it`.
//
// Oracles: Bott periodicity (π_n(KO) = KO^{-n}(pt) = ℤ, ℤ/2, ℤ/2, 0, ℤ, 0, 0, 0
// by n mod 8; π_n(KU) = ℤ for n even, 0 for n odd — Bott 1959, and the tool's
// own KO_POINT row); the closed form z = 1/y of the DAE below; T¹ = S¹,
// ℂP¹ ≅ S², ℍP¹ ≅ S⁴ (so Bott settles KO there); S⁰ × S⁰ is four points.
//
// What the review checked and found NOTHING wrong with is listed at the end.

import { solveTopology } from "../homology";
import { parseManifold } from "../cobordism";
import { parseDaeSystem } from "../daeParse";
import { solveDaeAuto, DaeAutoOptions, DaeAutoResult } from "../daeIndex";
import { foldPastedMath } from "../pasteMath";

/** The pane's Solve → topology path: fold, then solveTopology (taskpane updateSolve). */
const pane = (raw: string) => {
  const f = foldPastedMath(raw.trim(), {
    geometry: false, ode: false, lp: false, stackedFractions: false, bareStackedPairs: false, extractFromProse: false,
    // Mirrors the pane (v2.138.0 integrator): the topology kind folds with
    // topology: true, which keeps 𝔑/𝔽 (pinned in numericsTopologyRouting.test.ts).
    topology: true,
  });
  return solveTopology(f.text.trim());
};
const shown = (q: string): string => {
  const r = solveTopology(q) as any;
  if (!r) return "NULL";
  if (r.kind === "homology") return `homology:${r.groups.join(",")}`;
  if (r.kind === "persistence") return `persistence:${r.cloud.length} points`;
  return `${r.title} :: ${r.display.join(" | ")}`;
};

function dae(eqs: string, init: string, t0: number, t1: number, opts: DaeAutoOptions = {}): DaeAutoResult {
  const p = parseDaeSystem(eqs, init);
  if (!p.ok) throw new Error("parse: " + p.error);
  const o = solveDaeAuto(p.system, t0, t1, opts);
  if (!o.ok) throw new Error("refused: " + o.error);
  return o.result;
}

// ---------------------------------------------------------------------------
// WRONG 1 — homotopy of the K-theory spectra is answered with the stable stems
// of the SPHERE. The stem branch (/pi_?\d|homotopy|stable/) runs before the KO
// branch, so π₃(KO) comes back as π₃ˢ = ℤ/24. Bott: π₃(KO) = KO⁻³(pt) = 0.
// ---------------------------------------------------------------------------
describe("WRONG: π_n(KO) / π_n(KU) are not the stable stems π_nˢ", () => {
  const CASES: [string, string, string][] = [
    // query, the stem value printed today, the true group (Bott)
    ["pi_3(KO)", "ℤ/24", "0"],
    ["π₃(KO)", "ℤ/24", "0"],
    ["pi_3 of KO", "ℤ/24", "0"],
    ["pi_4(KO)", "π₄ˢ = 0", "ℤ"],
    ["pi_7(KO)", "ℤ/240", "0"],
    ["pi_8(KO)", "ℤ/2 ⊕ ℤ/2", "ℤ"],
    ["pi_2(KU)", "ℤ/2", "ℤ"],
    ["pi_3 of k-theory", "ℤ/24", "0"],
  ];
  for (const [q, stem, truth] of CASES) {
    it(`"${q}" is not answered as the sphere's stable stem (${stem}); Bott gives ${truth}`, () => {
      const out = shown(q);
      expect(out).not.toBe("NULL"); // "stop answering" is not the fix
      expect(out).not.toMatch(/Stable homotopy group/);
      expect(out).not.toContain(stem);
      if (truth === "ℤ") expect(out).toMatch(/= ℤ(?![\/⊕²\d])/);
    });
  }
});

// ---------------------------------------------------------------------------
// WRONG 2 — "completed" straight through a singular ∂g/∂z. Index 1 is checked
// at t₀ only; when the differential part does not feed back through z, Newton
// converges on BOTH sides of the singularity and the integrator never notices.
// The run then claims completion across a pole, contradicting its own caveat
// ("a loss of rank later shows up as a Newton failure, reported with its t").
// ---------------------------------------------------------------------------
describe("WRONG: a DAE whose algebraic unknown blows up mid-run is reported as completed", () => {
  // The values ARE pointwise right (z = 1/y); the defect is the completion
  // claim through a point where no continuous solution exists. A fix may stop
  // the run (completed = false) or refuse it by name — either passes.
  const stoppedOrRefused = (eqs: string, init: string, t0: number, t1: number, opts: DaeAutoOptions = {}) => {
    const p = parseDaeSystem(eqs, init);
    if (!p.ok) throw new Error("parse: " + p.error);
    const o = solveDaeAuto(p.system, t0, t1, opts);
    return !o.ok || !o.result.completed;
  };
  it("y' = −1, 0 = y·z − 1, y(0) = 1 on [0, 2]: z = 1/y has a pole at t = 1 — the run must not claim completion", () => {
    // Today: completed = true, z(1) ≈ 2.5e12, z(2) = −1, nothing said.
    expect(stoppedOrRefused("y' = -1; 0 = y*z - 1", "y = 1", 0, 2)).toBe(true);
  });
  it("the authors' own pin 0 = (1 − 2t)·z − y stops near t = 0.5 ONLY because 200 report points put a node at 0.5 — 201 points sails through", () => {
    // Today: completed = true with z(1) = −2.
    expect(stoppedOrRefused("y' = 1; 0 = (1 - 2*t)*z - y", "y = 1", 0, 1, { points: 201 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WRONG 3 (PRE-EXISTING, identical at v2.137.0) — an explicit simplicial
// complex typed as semicolon rows is read as a POINT CLOUD; the first simplex is
// swallowed as an "ignored header" line.
// ---------------------------------------------------------------------------
describe("WRONG (pre-existing): a typed complex is answered as a point cloud", () => {
  it("\"homology of 0,1,2; 1,2,3; 0,2,3; 0,1,3\" (the hollow tetrahedron = S²) gives ℤ, 0, ℤ", () => {
    // Today: persistence of 3 points ("homology of 0,1,2" eaten as a header).
    expect(shown("homology of 0,1,2; 1,2,3; 0,2,3; 0,1,3")).toBe("homology:Z,0,Z");
  });
});

// ---------------------------------------------------------------------------
// DISPLAY CONTRACT — the tool's own output does not read back (it.failing).
// ---------------------------------------------------------------------------
describe("display contract: displayed names must parse back", () => {
  // PROMOTED (v2.139.0, Builder B): fixed — "×" may be followed by "−M".
  it("\"ℂP² × −ℂP²\" — the name printed for cp^2 x cp^2bar — re-parses (today: '\"-\" where a manifold was expected')", () => {
    const shownName = (solveTopology("signature of cp^2 x cp^2bar") as any).title as string;
    expect(shownName).toContain("ℂP² × −ℂP²");
    expect("error" in parseManifold("ℂP² × −ℂP²")).toBe(false);
  });
  // PROMOTED and REWRITTEN BY HAND (v2.139.0, Builder B): "16−ℂP²" is not
  // fixable as printed — read literally it IS 16 − ℂP² (a dimension
  // mismatch). Per the coordinator, the multiple now prints unambiguously as
  // "16·(−ℂP²)", and that printed form must read back to σ = −16.
  it("the title for 16 copies of −ℂP² prints \"16·(−ℂP²)\" and re-parses to σ = −16", () => {
    const t = (solveTopology("is k3 cobordant to 16 cp^2bar") as any).title as string;
    expect(t).toContain("16·(−ℂP²)");
    expect(t).not.toContain("16−ℂP²");
    const el = parseManifold("16·(−ℂP²)");
    if ("error" in el) throw new Error(el.error);
    expect(el.sigma).toBe(-16n);
    expect(el.dim).toBe(4);
    expect(String((solveTopology("is k3 cobordant to 16·(−ℂP²)") as any).title)).toBe(t);
  });
  // PROMOTED (v2.139.0, Builder B): N₅ / N_5 / 𝔑₅ all read as the unoriented group.
  it("\"𝔑₅\" (the unoriented group's printed name) reads back through the pane's fold (today: folded to N₅ → NULL)", () => {
    expect(pane("𝔑₅")).not.toBeNull();
    expect((solveTopology("N_5") as any).display[0]).toBe("𝔑₅ = ℤ/2");
  });
});

describe("display contract: the DAE's printed reduced system parses back", () => {
  const INIT1 = "x = 1, y = 0, u = 0, v = 0";
  const INIT2 = "x = 1, y = 0, x' = 0, y' = 0";
  const reparse = (eqs: string, init: string) => {
    const r = dae(eqs, init, 0, 0.1);
    return { reduced: r.reduced, back: parseDaeSystem(r.reduced.join("; "), init) };
  };
  it("first-order pendulum: the reduced lines re-parse", () => {
    const { back } = reparse("x' = u; y' = v; u' = -lam*x; v' = -lam*y - 9.81; 0 = x^2 + y^2 - 1", INIT1);
    expect(back.ok).toBe(true);
  });
  it("second-order pendulum: the reduced lines (\"x′ = x′\", \"x′′ = −lam·x\") re-parse (today: parseDaeSystem refuses them)", () => {
    const { back } = reparse("x'' = -lam*x; y'' = -lam*y - 9.81; 0 = x^2 + y^2 - 1", INIT2);
    expect(back.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REFUSAL WHERE THE ANSWER IS KNOWN (it.failing).
// ---------------------------------------------------------------------------
// Every pin in this block and the next was PROMOTED from it.failing to it
// (v2.139.0, Builder B) once fixed; the value checks after each original
// assertion were added by hand so a fix cannot pass by saying nothing.
describe("refusals where Bott / an identification settles the answer", () => {
  it("KO of T¹: T¹ IS S¹, K̃O⁰ = ℤ/2 (today: refused as 'a product of circles')", () => {
    expect(shown("KO of T^1")).toContain("ℤ/2");
    expect(shown("KO of T^1")).not.toMatch(/not computed/);
  });
  it("KO of ℂP¹ ≅ S²: K̃O⁰ = ℤ/2 (today: refused, pointing at Sanderson)", () => {
    expect(shown("KO of CP^1")).not.toMatch(/not computed|not built/);
    expect(shown("KO of CP^1")).toContain("K̃O⁰(ℂP¹) = ℤ/2");
  });
  it("KO of ℍP¹ ≅ S⁴: K̃O⁰ = ℤ (today: refused)", () => {
    expect(shown("KO of HP^1")).not.toMatch(/not computed/);
    expect(shown("KO of HP^1")).toContain("K̃O⁰(ℍP¹) = ℤ |");
  });
  it("KO of S⁰ × S⁰ (four points): KO⁰ = ℤ⁴ — there is no Tor term for a discrete factor (today: refused citing Tor)", () => {
    expect(shown("KO of s^0 x s^0")).not.toMatch(/not computed/);
    expect(shown("KO of s^0 x s^0")).toContain("KO⁰(S⁰ × S⁰) = ℤ⁴");
  });
  it("\"homotopy groups of KO\" / \"KO_3(pt)\" are the Bott row (today: 'Name a space')", () => {
    expect(shown("homotopy groups of KO")).not.toMatch(/Name a space/);
    expect(shown("KO_3(pt)")).not.toMatch(/Name a space/);
    expect(shown("KO_3(pt)")).toContain("π₃(KO) = 0");
    expect(shown("homotopy groups of KO")).toContain("π₄(KO) = ℤ");
  });
  it("\"KO of RP^4 via the atiyah-hirzebruch spectral sequence\" reaches KO, not the Serre table", () => {
    expect(shown("KO of RP^4 via the atiyah-hirzebruch spectral sequence")).toMatch(/ℤ\/8/);
  });
  it("\"does the sphere bound\" / \"cobordism of the 3-sphere\" (today: 'sphere is not a manifold this tool knows')", () => {
    expect(shown("does the sphere bound")).toMatch(/BOUNDS/);
    expect(shown("cobordism of the 3-sphere")).toMatch(/BOUNDS/);
  });
  it("\"pontryagin classes of cp^3\" gives the CLASS p = 1 + 4x², not a cobordism verdict (new in v2.139.0; v2.137.0 returned NULL)", () => {
    expect(shown("pontryagin classes of cp^3")).not.toMatch(/cobordism/i);
    expect(shown("pontryagin classes of cp^3")).toContain("p(TℂP³) = 1 + 4x²");
  });
});

// ---------------------------------------------------------------------------
// COSMETIC (promoted).
// ---------------------------------------------------------------------------
describe("cosmetic", () => {
  it("\"Ω₄ˢᴼ =ℤ\" is missing its space", () => {
    expect(shown("oriented cobordism of cp^2 # cp^2bar")).not.toContain("=ℤ");
  });
  it("negative numbers use the minus sign U+2212, not ASCII '-' (\"p₁ = -48\", \"+ -16·[ℂP² × ℂP²]\")", () => {
    expect(shown("oriented cobordism of k3")).not.toMatch(/= -\d/);
    expect(shown("oriented cobordism of cp^2 x k3")).not.toMatch(/\+ -\d/);
    expect(shown("oriented cobordism of k3")).toContain("p₁ = −48");
  });
  it("a point's only number is printed as \"1 = 1\"", () => {
    expect(shown("cobordism of pt")).not.toMatch(/— 1 = 1/);
  });
});

// ---------------------------------------------------------------------------
// FOUND NOTHING (for the record; no pins):
//   * DAE vs SciPy DOP853/fsolve: Cartesian pendulum (L = 1, 2; off-axis start
//     with θ̇₀ = 1), second-order form, velocity-level (index 2) form, double
//     pendulum (two multipliers), variable-length pendulum (t-dependent
//     constraint), mixed index 3 + 1, index-2/3/4/5 chains (index 6 refused),
//     20 random nonlinear index-1 systems with two algebraic unknowns — all
//     ≤ 2e-12 … 1e-10; reordered / renamed / λ / lambda identical; inconsistent
//     starts projected and SAID; undetermined z refused by name; t / e as state
//     names refused; stiff index 1 correct; fold point stops with its t; work
//     budget stops honestly (completed = false, said).
//   * Cobordism: 800 random sums / products / differences of ℝPⁿ, ℂPⁿ, Sⁿ, Tⁿ,
//     Klein, Wu, K3 against an independent Stiefel–Whitney / Pontryagin
//     computation — every number, verdict and orientability agrees; no oriented
//     "bounds" at dimension ≥ 9.
//   * KO / K: spheres (all degrees), the point, ℝPⁿ via φ(n) (Adams), complex
//     K̃⁰(ℝPⁿ), Künneth for products of spheres / ℂPⁿ, re-parse of K/KO lines.
//   * Persistence over 𝔽p (p = 2, 3, 5, 7, 11, 46 337) vs GUDHI 3.13 on 46
//     clouds (Klein, torus, ℝP², noise, grids with ties, user scales, H2):
//     identical barcodes; 𝔽₂ identical to the v2.137.0 engine at a fixed scale.
// ---------------------------------------------------------------------------
