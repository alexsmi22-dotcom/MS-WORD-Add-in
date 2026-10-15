// v2.138.0 integration pins: the pane reaches the numerics + topology engines
// the way the engines' own suites assume, and the live DAE bug cannot return.
//
// WHY A ROUTING FILE. A green engine suite says nothing about whether the pane
// can REACH that engine (three Solve features once shipped unreachable while
// fully tested). taskpane.ts cannot be imported under jest (Office.js), so each
// pin has two halves: a SOURCE pin that the pane makes exactly this call, and a
// BEHAVIOURAL test of that same call with the same arguments.

import * as fs from "fs";
import * as path from "path";
import { parseDaeSystem } from "../daeParse";
import { solveDaeAuto } from "../daeIndex";
import { solveTopology, BUILTIN_NAMES } from "../homology";
import { persistentHomology, barcodeSvg } from "../persistence";
import { typesetGroup, parseGroup, sub } from "../kReal";
import { SOLVE_TOPOLOGY } from "../palettes";
import { foldPastedMath } from "../pasteMath";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");

/** The Analyze DAE entry, from its id to the end of the registry. */
function daeBlock(): string {
  const at = PANE.indexOf('id: "dae",');
  expect(at).toBeGreaterThan(0);
  const end = PANE.indexOf("\n];", at);
  return PANE.slice(at, end);
}

/** The Solve topology branch, from its test to the next kind. */
function topologyBranch(): string {
  const at = PANE.indexOf('if (kind === "topology") {\n      let h;');
  expect(at).toBeGreaterThan(0);
  const end = PANE.indexOf('if (kind === "lambda") {', at);
  expect(end).toBeGreaterThan(at);
  return PANE.slice(at, end);
}

/** The pane's DAE compute path, call for call: the same concatenation and the same options. */
function paneDae(fields: { eqs: string; cons: string; y0: string; z0: string; t0: number; t1: number; steps: number }) {
  const p = parseDaeSystem(fields.eqs + "\n" + fields.cons, fields.y0, fields.z0);
  if (!p.ok) throw new Error(p.error);
  const out = solveDaeAuto(p.system, fields.t0, fields.t1, { points: fields.steps });
  if (!out.ok) throw new Error(out.error);
  return out.result;
}

const PENDULUM = {
  eqs: "x' = u\ny' = v\nu' = -lam*x\nv' = -lam*y - 9.81",
  cons: "x^2 + y^2 - 1",
  y0: "x = 1, y = 0, u = 0, v = 0",
  z0: "",
  t0: 0,
  t1: 10,
  steps: 500,
};

describe("DAE: the pane calls the by-name parser and the index-reducing solver", () => {
  it("source: one parseDaeSystem over both fields, then solveDaeAuto; the old positional path is gone", () => {
    const b = daeBlock();
    expect(b).toContain('parseDaeSystem(r("eqs") + "\\n" + r("cons"), r("y0"), r("z0"))');
    expect(b).toContain("solveDaeAuto(p.system, tr[0], tr[1], { points:");
    expect(b).toContain("res.names");
    expect(b).toContain("res.states[n]");
    expect(b).not.toMatch(/\bsolveDae\(/);
    expect(b).not.toMatch(/\bparseAssignments\(/);
    expect(b).not.toContain("Give at least one initial");
    expect(b).not.toMatch(/name: "[^"]*index 1/);
    // projectedInit is already inside res.steps; printing it again would duplicate it.
    expect(b).not.toContain("projectedInit");
    // The second field is optional guesses now, and says so.
    expect(b).toMatch(/Initial guesses for algebraic variables \(optional\)/);
  });

  // A SHORT run for the identity pins: daeIndex.ts has a wall-clock backstop
  // (TIME_BACKSTOP_MS), and under full-suite load a 10 s / 500-point pendulum
  // was stopped at t = 4.76 in one run and not the other — a load artefact, not
  // the order bug. Both runs must COMPLETE before "identical" means anything.
  const SHORT = { ...PENDULUM, t1: 2, steps: 100 };

  it("LIVE BUG: reordered initial values give the IDENTICAL table through the pane's call", () => {
    const a = paneDae(SHORT);
    const b = paneDae({ ...SHORT, y0: "v = 0, u = 0, y = 0, x = 1" });
    expect([a.completed, b.completed]).toEqual([true, true]);
    expect(b.names).toEqual(a.names);
    expect(b.t).toEqual(a.t);
    for (const n of a.names) expect(b.states[n]).toEqual(a.states[n]);
    // The index-1 shape the bug was first seen in: x' = u; u' = -x - z; 0 = z.
    const c = paneDae({ eqs: "x' = u\nu' = -x - z", cons: "z", y0: "x = 1, u = 0", z0: "", t0: 0, t1: 1, steps: 100 });
    const d = paneDae({ eqs: "x' = u\nu' = -x - z", cons: "z", y0: "u = 0, x = 1", z0: "", t0: 0, t1: 1, steps: 100 });
    const k = c.t.length - 1;
    expect(d.states.x[k]).toBe(c.states.x[k]);
    expect(c.states.x[k]).toBeCloseTo(Math.cos(1), 8);
  });

  it("λ typed for lam gives the identical table, and the rewrite is said", () => {
    const a = paneDae(SHORT);
    const b = paneDae({ ...SHORT, eqs: "x' = u\ny' = v\nu' = -λ*x\nv' = -λ*y - 9.81" });
    expect([a.completed, b.completed]).toEqual([true, true]);
    for (const n of a.names) expect(b.states[n]).toEqual(a.states[n]);
    expect(b.steps.join("\n")).toMatch(/λ \/ lambda was read as the variable lam/);
  });

  it("the pendulum as typed: index 3, SciPy values at t = 10 within 1e-5, drift printed", () => {
    const r = paneDae(PENDULUM);
    // First, so a wall-clock-backstop stop under load names its own cause.
    expect(r.completed).toBe(true);
    expect(r.index).toBe(3);
    const k = r.t.length - 1;
    expect(r.t[k]).toBe(10);
    // SciPy DOP853 at rtol 1e-13 on the angle ODE (scope §D1).
    expect(Math.abs(r.states.x[k] - 0.2750874626)).toBeLessThan(1e-5);
    expect(Math.abs(r.states.y[k] - -0.9614192051)).toBeLessThan(1e-5);
    expect(Math.abs(r.states.lam[k] - 28.2945672061)).toBeLessThan(1e-5);
    const all = r.steps.join("\n");
    expect(all).toMatch(/u·x \+ v·y = 0/);
    expect(all).toMatch(/drift before projection/);
    expect(all).not.toMatch(/by construction/);
  });

  it("today's default example is a twin across the engine change: y(2) = e⁻²", () => {
    const r = paneDae({ eqs: "y' = -z", cons: "z - y", y0: "y = 1", z0: "z = 1", t0: 0, t1: 2, steps: 500 });
    expect(r.index).toBe(1);
    expect(r.states.y[r.t.length - 1]).toBeCloseTo(Math.exp(-2), 8);
  });

  it("refusals reach the pane by name, never a crash", () => {
    const p = parseDaeSystem("x' = 1 - z\ny' = z\nx + y - t", "x = 0, y = 0", "");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const out = solveDaeAuto(p.system, 0, 1, { points: 100 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/numerically singular.*loses z by cancellation/);
    const none = parseDaeSystem("y' = -y\n", "y = 1", "");
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatch(/use the ODE solver/);
  });
});

describe("persistence: the pane honours every header the engine reads", () => {
  const RING = Array.from({ length: 12 }, (_, k) => `${Math.cos((2 * Math.PI * k) / 12).toFixed(4)} ${Math.sin((2 * Math.PI * k) / 12).toFixed(4)}`).join("\n");

  it("source: p, maxScale, maxDim and compare are all passed; ignored, torsion and censoring are printed", () => {
    const b = topologyBranch();
    expect(b).toContain("persistentHomology(h.cloud, { maxDim: h.maxDim, maxScale: h.maxScale, p: h.p, compare: h.compare })");
    expect(b).not.toContain("persistentHomology(h.cloud, { maxDim: 1 })");
    expect(b).toContain("barcodeSvg(pr, 460, 300, { compare: h.compare })");
    expect(b).toMatch(/for \(const ig of h\.ignored\)/);
    expect(b).toMatch(/for \(const r of h\.read\)/);
    expect(b).toMatch(/for \(const t of pr\.torsion\)/);
    expect(b).toMatch(/pr\.censored > 0/);
  });

  it("source: the Solve figure is inserted at the size READ FROM THE SVG, never a nominal one", () => {
    const at = PANE.indexOf("const svg = currentSolveSvg;");
    expect(at).toBeGreaterThan(0);
    expect(PANE.slice(at, at + 200)).toMatch(/readSvgDims\(svg, 460, 300\)/);
  });

  it("`compare` reaches the engine and draws two stacked panels, 460 × 600", () => {
    const h = solveTopology("compare\nnot a header\n" + RING);
    expect(h && h.kind).toBe("persistence");
    if (!h || h.kind !== "persistence") return;
    expect(h.compare).toBe(true);
    expect(h.ignored).toEqual(["not a header"]);
    const pr = persistentHomology(h.cloud, { maxDim: h.maxDim, maxScale: h.maxScale, p: h.p, compare: h.compare });
    expect(pr.comparison).toBeDefined();
    const svg = barcodeSvg(pr, 460, 300, { compare: h.compare });
    expect(svg).toMatch(/^<svg[^>]*width="460" height="600"/);
  });

  it("`over F3` sets the field; `mod 4` is refused by name through the advanced branch", () => {
    const h = solveTopology("over F3\n" + RING);
    expect(h && h.kind === "persistence" && h.p).toBe(3);
    const bad = solveTopology("mod 4\n" + RING);
    expect(bad && bad.kind).toBe("advanced");
    if (bad && bad.kind === "advanced") expect(bad.display.join(" ")).toMatch(/not a field/);
  });
});

describe("topology: §D inputs route to the advanced branch the pane already renders", () => {
  it("source: the advanced branch prints title, display, steps and caveats", () => {
    const b = topologyBranch();
    expect(b).toMatch(/if \(h\.kind === "advanced"\) \{[\s\S]*?for \(const line of h\.display\)[\s\S]*?for \(const s of h\.steps\)[\s\S]*?finish\(h\.caveats\)/);
  });

  const CASES: [string, RegExp][] = [
    ["KO of S^1", /K̃O⁰\(S¹\) = ℤ\/2/],
    ["real k-theory of s^1", /K̃O⁰\(S¹\) = ℤ\/2/],
    ["KO(S^1)", /K̃O⁰\(S¹\) = ℤ\/2/],
    ["KO of S^1000001", /= ℤ\/2/],
    ["KO-theory of a point", /KO⁰\(pt\) = ℤ/],
    ["KO of RP^9", /ℤ\/32/],
    ["KO^1(RP^3)", /Atiyah–Hirzebruch/],
    ["KO of CP^2", /Sanderson/],
    ["KO of s^1 x s^1", /Künneth/],
    ["k-theory of s^1 x s^2", /K⁰\(S¹ × S²\) = ℤ²/],
    ["k-theory of RP^5", /ℤ\/4/],
    ["k-theory of s^65", /K̃⁰\(S⁶⁵\) = 0/],
    ["does rp^2 # rp^2 bound", /BOUNDS/],
    ["does the klein bottle bound", /BOUNDS/],
    ["does rp^2 x rp^2 bound", /does NOT bound/],
    ["signature of CP^2 # CP^2bar", /σ = 0/],
    ["pontryagin numbers of CP^2 x CP^2", /p₁² = 18/],
    ["signature of K3", /σ = [−-]16/],
    ["oriented cobordism group dimension 5", /ℤ\/2/],
    ["Omega^SO_8", /ℤ ⊕ ℤ/],
    ["does RP^2 # CP^2 bound", /equal dimensions/],
    ["homology of klein bottle over z/3", /Betti numbers over 𝔽₃: 1, 1, 0/],
    ["homology of projective plane mod 2", /Betti numbers over 𝔽₂: 1, 1, 1/],
  ];
  it.each(CASES)("%s", (input, expected) => {
    const h = solveTopology(input);
    expect(h && h.kind).toBe("advanced");
    if (!h || h.kind !== "advanced") return;
    expect([h.title, ...h.display].join("\n")).toMatch(expected);
  });
});

describe("the Topology palette: every template is answered", () => {
  it("source: the pane shows SOLVE_TOPOLOGY for the topology kind", () => {
    expect(PANE).toMatch(/kind === "topology" \? SOLVE_TOPOLOGY/);
  });
  const all = SOLVE_TOPOLOGY.flatMap((g) => g.items.map((i) => ({ group: g.name, ...i })));
  it.each(all.map((i) => [`${i.group} / ${i.label}`, i.snippet, i.group] as const))("%s", (_name, snippet, group) => {
    const h = solveTopology(snippet);
    expect(h).not.toBeNull();
    if (!h) return;
    expect(h.kind).toBe(group === "Persistence" ? "persistence" : group === "Homology" && !/ over | mod /.test(snippet) ? "homology" : "advanced");
    if (h.kind === "advanced") expect(h.title).not.toMatch(/not computed/);
  });
});

describe("the paste fold keeps the topology reader's notation (𝔑₅, Ω₅ˢᴼ, 𝔽₃)", () => {
  // The pane folds pasted math before routing; 𝔑 (fraktur N) used to become N,
  // so the engine's own printed "𝔑₅" read back as NOTHING.
  const paneFold = (raw: string) =>
    foldPastedMath(raw.trim(), {
      geometry: false, ode: false, lp: false, stackedFractions: false, bareStackedPairs: false, extractFromProse: false,
      topology: true,
    }).text;

  it("source: the pane passes topology: kind === \"topology\" to the fold", () => {
    expect(PANE).toMatch(/foldPastedMath\(solveInput\.value\.trim\(\), \{[\s\S]{0,1500}?topology: kind === "topology",/);
  });

  it.each([
    ["𝔑₅", /𝔑₅ = ℤ\/2/],
    ["𝔑_5", /𝔑₅ = ℤ\/2/],
    ["Ω₅ˢᴼ", /Ω₅ˢᴼ = ℤ\/2/],
    ["Ω₈ˢᴼ", /Ω₈ˢᴼ = ℤ ⊕ ℤ/],
    ["homology of klein bottle over 𝔽₃", /Betti numbers over 𝔽₃: 1, 1, 0/],
    ["does ℝP² # ℝP² bound", /BOUNDS/],
    ["KO(ℝP⁹)", /ℤ\/32/],
    ["KO of 𝑆¹", /K̃O⁰\(S¹\) = ℤ\/2/], // math-italic from a paper still folds
  ])("%s survives the pane's fold and routes", (raw, expected) => {
    const folded = paneFold(raw);
    const h = solveTopology(folded);
    expect(h && h.kind).toBe("advanced");
    if (h && h.kind === "advanced") expect([h.title, ...h.display].join("\n")).toMatch(expected);
  });

  it("the engine's printed 𝔑ₙ / Ωₙˢᴼ symbols read back through the fold to the same group", () => {
    for (const q of ["unoriented cobordism group dimension 5", "oriented cobordism group dimension 5"]) {
      const h = solveTopology(q);
      expect(h && h.kind).toBe("advanced");
      if (!h || h.kind !== "advanced") continue;
      const symbol = h.display[0].split(" = ")[0];
      const back = solveTopology(paneFold(symbol));
      expect(back && back.kind === "advanced" && back.display[0]).toBe(h.display[0]);
    }
  });

  it("no false equation-side notes in the topology kind (Ω is a group, ℝ is not 'a number set' here)", () => {
    const f = foldPastedMath("Ω₅ˢᴼ and ℝP²", { topology: true });
    expect(f.text).toBe("Ω₅ˢᴼ and ℝP²");
    expect(f.notes).toEqual([]);
  });
});

describe("display is a contract: the pane's homology lines are typeset, and read back", () => {
  it("source: no ASCII H_k line and no raw group string in the topology branch", () => {
    const b = topologyBranch();
    expect(b).not.toContain("`H_${k} = ${h.groups[k]}`");
    expect(b).not.toMatch(/H_\$\{/);
    expect(b).toContain("`H${subDigits(k)} = ${typesetGroup(h.groups[k])}`");
  });

  it.each([...BUILTIN_NAMES])("%s: every displayed Hₖ is ℤ-typeset and parses back to the engine's group", (name) => {
    const h = solveTopology(name);
    if (!h || h.kind !== "homology") return;
    for (let k = 0; k <= h.dimension; k++) {
      const line = `H${sub(k)} = ${typesetGroup(h.groups[k])}`;
      expect(line).not.toMatch(/\bZ\b|H_|\s\+\s|\^/);
      expect(parseGroup(typesetGroup(h.groups[k]))).toEqual(parseGroup(h.groups[k]));
    }
  });

  it("the Klein bottle reads H₁ = ℤ ⊕ ℤ/2", () => {
    const h = solveTopology("klein bottle");
    expect(h && h.kind).toBe("homology");
    if (h && h.kind === "homology") expect(`H${sub(1)} = ${typesetGroup(h.groups[1])}`).toBe("H₁ = ℤ ⊕ ℤ/2");
  });
});
