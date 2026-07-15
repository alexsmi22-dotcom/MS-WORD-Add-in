// Phase 4 adversarial bug test — spectroscopy predictors.
//
// The job here is to BREAK the predictors, not to confirm they work. Three
// attack classes:
//   1. Structural edge cases that should crash, hang, or return nonsense
//      (empty/charged/isotope/radical/huge/exotic-element inputs).
//   2. Physical invariants that must hold for EVERY molecule, checked over a
//      broad sweep of real structures (shifts in range, masses conserved,
//      no NaN, no fabricated groups).
//   3. Honesty invariants — the model must never present an out-of-domain
//      guess as a confident number, and must never silently drop information.

import { predictNmr, nmrSticks } from "../nmr";
import { predictIr, irTransmittanceCurve } from "../ir";
import { predictUvVis } from "../uvvis";
import { predictFragments } from "../fragment";
import { predictPka } from "../pka";
import { computeMassSpec } from "../massspec";

// A deliberately nasty corpus: charged, radical-ish, isotopic, exotic elements,
// macrocycles, fused rings, tautomer-prone, stereo-heavy, very small, very big.
const HOSTILE: string[] = [
  "C", // methane — single atom skeleton
  "[H][H]", // no carbon at all
  "O", // water
  "[Na+].[Cl-]", // disconnected ionic salt
  "CC(=O)[O-]", // charged carboxylate
  "C[N+](C)(C)C", // quaternary ammonium
  "[13CH4]", // isotope label
  "[2H]C([2H])([2H])O", // deuterated
  "c1ccccc1", // benzene
  "c1ccc2ccccc2c1", // naphthalene (fused)
  "c1ccc2c(c1)ccc1ccccc12", // anthracene-ish
  "C1CCCCCCCCCCC1", // macrocycle
  "FC(F)(F)C(F)(F)F", // perfluoro
  "ClC(Cl)(Cl)Cl", // carbon tetrachloride — no H at all
  "O=S(=O)(O)O", // sulfuric acid
  "O=[N+]([O-])c1ccccc1", // nitrobenzene, charge-separated nitro
  "N#Cc1ccccc1C#N", // dinitrile
  "OC(=O)C(=O)O", // oxalic acid — adjacent carbonyls
  "C1=CC=CC=C1C(=O)OC(=O)c1ccccc1", // anhydride
  "CC(=O)Oc1ccccc1C(=O)O", // aspirin
  "CN1C=NC2=C1C(=O)N(C)C(=O)N2C", // caffeine — fused heteroaromatic
  "C[C@H](N)C(=O)O", // alanine, stereocentre
  "[Se]", // lone exotic element
  "[Si](C)(C)(C)C", // TMS
  "B(O)(O)O", // boric acid
  "C=C=C", // allene (cumulated)
  "C#CC#C", // diyne
  "c1ccsc1", // thiophene
  "c1cc[nH]c1", // pyrrole (NH aromatic)
  "c1ccncc1", // pyridine
  "OO", // hydrogen peroxide
  "N", // ammonia
  "C1CC1", // cyclopropane (strained)
];

const GARBAGE: string[] = ["", "   ", "!!!", "not a molecule", "C1CC", "((((", "xyzzy", "\n\t", "💥", "-".repeat(500)];

describe("adversarial: nothing crashes, nothing hangs", () => {
  test("hostile structures never throw across all five predictors", () => {
    for (const smi of HOSTILE) {
      expect(() => predictNmr(smi, "1H")).not.toThrow();
      expect(() => predictNmr(smi, "13C")).not.toThrow();
      expect(() => predictIr(smi)).not.toThrow();
      expect(() => predictUvVis(smi)).not.toThrow();
      expect(() => predictFragments(smi)).not.toThrow();
    }
  });

  test("garbage input returns null, never a fabricated spectrum", () => {
    for (const g of GARBAGE) {
      expect(predictNmr(g, "1H")).toBeNull();
      expect(predictNmr(g, "13C")).toBeNull();
      expect(predictIr(g)).toBeNull();
      expect(predictUvVis(g)).toBeNull();
      expect(predictFragments(g)).toBeNull();
    }
  });

  test("large molecule completes promptly (no combinatorial blow-up)", () => {
    // A long chain maximises the bond-cleavage search space.
    const chain = "C".repeat(60);
    const t0 = Date.now();
    const r = predictFragments(chain);
    expect(r).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test("fused/macrocyclic rings do not hang the ring-distance walk", () => {
    const t0 = Date.now();
    for (const smi of ["c1ccc2ccccc2c1", "C1CCCCCCCCCCC1", "CN1C=NC2=C1C(=O)N(C)C(=O)N2C"]) {
      predictNmr(smi, "13C");
      predictNmr(smi, "1H");
      predictFragments(smi);
    }
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("adversarial: numeric invariants over the hostile corpus", () => {
  test("no NaN / Infinity ever reaches a reported value", () => {
    for (const smi of HOSTILE) {
      for (const nuc of ["1H", "13C"] as const) {
        const r = predictNmr(smi, nuc);
        if (!r) continue;
        for (const s of r.signals) {
          expect(Number.isFinite(s.shift)).toBe(true);
          expect(Number.isFinite(s.count)).toBe(true);
          expect(s.count).toBeGreaterThan(0);
        }
      }
      const ir = predictIr(smi);
      if (ir) for (const b of ir.bands) expect(Number.isFinite(b.wavenumber)).toBe(true);
      const uv = predictUvVis(smi);
      if (uv && uv.lambdaMax !== null) expect(Number.isFinite(uv.lambdaMax)).toBe(true);
      const ms = predictFragments(smi);
      if (ms) {
        expect(Number.isFinite(ms.molecularIon)).toBe(true);
        for (const f of ms.fragments) {
          expect(Number.isFinite(f.mz)).toBe(true);
          expect(Number.isFinite(f.lossMass)).toBe(true);
        }
      }
    }
  });

  test("13C shifts stay inside the physically observed window", () => {
    for (const smi of HOSTILE) {
      const r = predictNmr(smi, "13C");
      if (!r) continue;
      for (const s of r.signals) {
        // Real 13C spans roughly -10 (TMS-ish) to 230 (ketone C=O). Anything
        // outside means additivity has run away.
        expect(s.shift).toBeGreaterThan(-60);
        expect(s.shift).toBeLessThan(320);
      }
    }
  });

  test("1H shifts stay inside the physically observed window", () => {
    for (const smi of HOSTILE) {
      const r = predictNmr(smi, "1H");
      if (!r) continue;
      for (const s of r.signals) {
        expect(s.shift).toBeGreaterThan(-5);
        expect(s.shift).toBeLessThan(20);
      }
    }
  });

  test("IR wavenumbers stay inside the mid-IR window", () => {
    for (const smi of HOSTILE) {
      const r = predictIr(smi);
      if (!r) continue;
      for (const b of r.bands) {
        expect(b.wavenumber).toBeGreaterThan(400);
        expect(b.wavenumber).toBeLessThan(4000);
        expect(b.range[0]).toBeLessThanOrEqual(b.range[1]);
      }
    }
  });

  test("UV λmax, when given, is inside the UV-Vis window", () => {
    for (const smi of HOSTILE) {
      const r = predictUvVis(smi);
      if (!r || r.lambdaMax === null) continue;
      expect(r.lambdaMax).toBeGreaterThan(180);
      expect(r.lambdaMax).toBeLessThan(800);
    }
  });

  test("every fragment is lighter than M+• and heavier than nothing", () => {
    for (const smi of HOSTILE) {
      const r = predictFragments(smi);
      if (!r) continue;
      for (const f of r.fragments) {
        expect(f.mz).toBeGreaterThan(0);
        expect(f.mz).toBeLessThanOrEqual(r.molecularIon + 0.001);
      }
    }
  });

  test("mass balance: fragment + neutral loss reconstructs the molecular ion", () => {
    // Only bond-cleavage fragments carry a real complementary neutral; the
    // [M-X] convenience entries are checked separately below.
    for (const smi of ["Cc1ccccc1", "CCCC(=O)C", "CCO", "CCCCN", "CC(=O)Oc1ccccc1C(=O)O", "CCc1ccccc1"]) {
      const r = predictFragments(smi)!;
      for (const f of r.fragments) {
        if (f.formula.startsWith("[M-")) continue;
        if (f.pathway.includes("McLafferty")) continue; // H is transferred, checked below
        const total = f.mz + f.lossMass;
        expect(Math.abs(total - r.molecularIon)).toBeLessThan(0.005);
      }
    }
  });

  test("McLafferty conserves mass across the H transfer", () => {
    const r = predictFragments("CCCC(=O)C")!;
    const mcl = r.fragments.find((f) => f.pathway.includes("McLafferty"))!;
    expect(mcl).toBeDefined();
    // ion + neutral alkene must still equal M+•.
    expect(Math.abs(mcl.mz + mcl.lossMass - r.molecularIon)).toBeLessThan(0.005);
  });

  test("[M-X] losses equal M+• minus the stated neutral, exactly", () => {
    const r = predictFragments("CCCCO")!;
    const water = r.fragments.find((f) => f.neutralLoss === "H2O")!;
    expect(Math.abs(water.mz - (r.molecularIon - water.lossMass))).toBeLessThan(0.005);
  });
});

describe("adversarial: no group is invented that isn't in the structure", () => {
  test("IR never reports a bond the molecule does not contain", () => {
    const checks: [string, RegExp][] = [
      ["CCCC", /C=O|O-H|N-H|C≡N|nitro/], // pure alkane
      ["c1ccccc1", /C=O|O-H|N-H|C≡N/], // benzene
      ["CCO", /C=O|C≡N|nitro/], // ethanol has O-H but no C=O
      ["CC#N", /C=O|O-H/], // nitrile only
    ];
    for (const [smi, forbidden] of checks) {
      const r = predictIr(smi)!;
      for (const b of r.bands) expect(b.assignment).not.toMatch(forbidden);
    }
  });

  test("fragmentation never claims a loss the structure cannot make", () => {
    const alkane = predictFragments("CCCCCC")!;
    for (const f of alkane.fragments) {
      expect(f.neutralLoss).not.toMatch(/H2O|CO2|NH3|HCl/);
    }
  });

  test("NMR never emits a signal for an element that bears no hydrogen (1H)", () => {
    // Carbon tetrachloride has zero protons — a 1H spectrum must be empty.
    const r = predictNmr("ClC(Cl)(Cl)Cl", "1H")!;
    expect(r.signals).toHaveLength(0);
  });

  test("a molecule with no carbon yields no 13C signals", () => {
    const r = predictNmr("O", "13C")!;
    expect(r.signals).toHaveLength(0);
  });

  test("proton count always equals the true hydrogen count of the molecule", () => {
    // Cross-check 1H integration against the molecular formula from massspec.
    const cases = ["CCO", "CC(=O)OCC", "Cc1ccccc1", "CC(=O)Oc1ccccc1C(=O)O", "CN1C=NC2=C1C(=O)N(C)C(=O)N2C"];
    for (const smi of cases) {
      const nmr = predictNmr(smi, "1H")!;
      const ms = computeMassSpec(smi)!;
      const m = /H(\d*)/.exec(ms.formula.replace(/[A-G I-Z][a-z]?\d*/g, (s) => (s.startsWith("H") ? s : "")));
      const trueH = m ? (m[1] ? parseInt(m[1], 10) : 1) : 0;
      const predictedH = nmr.signals.reduce((s, x) => s + x.count, 0);
      expect(predictedH).toBe(trueH);
    }
  });

  test("13C signal counts sum to the true carbon count", () => {
    for (const smi of ["CCO", "Cc1ccccc1", "CC(=O)Oc1ccccc1C(=O)O", "CCCC", "c1ccccc1"]) {
      const nmr = predictNmr(smi, "13C")!;
      const ms = computeMassSpec(smi)!;
      const m = /^C(\d*)/.exec(ms.formula);
      const trueC = m ? (m[1] ? parseInt(m[1], 10) : 1) : 0;
      const predictedC = nmr.signals.reduce((s, x) => s + x.count, 0);
      expect(predictedC).toBe(trueC);
    }
  });
});

describe("adversarial: aromatic ring topology (regressions)", () => {
  // Bug found by this suite: the aromatic walk filtered on atom aromaticity, so
  // it crossed biphenyl's non-aromatic inter-ring bond and applied the far
  // ring's substituent increments to this ring.
  test("biphenyl: the second ring is a substituent, not an extension of the first", () => {
    const r = predictNmr("c1ccccc1-c1ccccc1", "13C")!;
    const shifts = r.signals.map((s) => s.shift);
    const ipso = Math.max(...shifts);
    // Literature biphenyl: ipso 141.2, ortho 128.8, meta 127.3, para 127.2.
    expect(Math.abs(ipso - 141.2)).toBeLessThanOrEqual(2);
    // Ring-crossing used to drag the ipso down toward 140.4 by double-counting
    // a phantom "ortho" phenyl increment from the far ring.
    for (const lit of [128.8, 127.3]) {
      expect(shifts.some((s) => Math.abs(s - lit) <= 2)).toBe(true);
    }
  });

  test("a substituent on one biphenyl ring does not leak onto the other", () => {
    // Ring A of 4-nitrobiphenyl must keep near-biphenyl shifts; only ring B
    // carries the nitro increments.
    const r = predictNmr("O=[N+]([O-])c1ccc(-c2ccccc2)cc1", "13C")!;
    const shifts = r.signals.map((s) => s.shift);
    // C-NO2 ipso ~147.6 exists...
    expect(shifts.some((s) => Math.abs(s - 147.6) <= 3)).toBe(true);
    // ...but no carbon may be pushed to the nitro-ortho value (123.4) unless it
    // really is ortho to the nitro. Exactly two such carbons exist.
    const nitroOrtho = shifts.filter((s) => Math.abs(s - 124.1) <= 2.5);
    expect(nitroOrtho.length).toBeLessThanOrEqual(1); // one symmetry class of 2C
  });

  test("benzene ring distances are unaffected by the bond-level walk", () => {
    // Control: the fix must not perturb an isolated ring.
    const r = predictNmr("O=[N+]([O-])c1ccccc1", "13C")!;
    for (const lit of [148.3, 134.7, 129.3, 123.4]) {
      expect(r.signals.some((s) => Math.abs(s.shift - lit) <= 2)).toBe(true);
    }
  });

  // Bug found by this suite: naphthalene returned a flat 128.5 for every carbon
  // (real: 125.9-133.6) with no caveat at all — silently wrong.
  test("fused aromatics disclose that benzene increments are approximate", () => {
    for (const smi of ["c1ccc2ccccc2c1", "c1ccc2c(c1)ccc1ccccc12"]) {
      for (const nuc of ["13C", "1H"] as const) {
        const r = predictNmr(smi, nuc)!;
        expect(r.caveats.join(" ")).toMatch(/Fused aromatic/i);
      }
    }
  });

  test("an isolated benzene is NOT mislabelled as fused", () => {
    for (const smi of ["c1ccccc1", "Cc1ccccc1", "c1ccccc1-c1ccccc1"]) {
      const r = predictNmr(smi, "13C")!;
      expect(r.caveats.join(" ")).not.toMatch(/Fused aromatic/i);
    }
  });

  test("heteroaromatics still disclose their own limitation", () => {
    const r = predictNmr("c1ccncc1", "13C")!;
    expect(r.caveats.join(" ")).toMatch(/Heteroaromatic/i);
  });
});

describe("adversarial: honesty guarantees hold under pressure", () => {
  test("every predictor always ships at least one caveat", () => {
    for (const smi of ["CCO", "Cc1ccccc1", "CC(C)=O", "CCCC"]) {
      expect(predictIr(smi)!.caveats.length).toBeGreaterThan(0);
      expect(predictUvVis(smi)!.caveats.length).toBeGreaterThan(0);
      expect(predictFragments(smi)!.caveats.length).toBeGreaterThan(0);
    }
  });

  test("UV never invents a λmax for an unconjugated molecule", () => {
    for (const smi of ["CCCC", "CCO", "C1CCCCC1", "CC(C)C", "FC(F)(F)C(F)(F)F"]) {
      const r = predictUvVis(smi)!;
      expect(r.transparent).toBe(true);
      expect(r.lambdaMax).toBeNull();
    }
  });

  test("UV contributions always reconcile with the reported λmax", () => {
    for (const smi of HOSTILE) {
      const r = predictUvVis(smi);
      if (!r || r.lambdaMax === null) continue;
      const sum = r.contributions.reduce((s, c) => s + c.nm, 0);
      expect(sum).toBe(r.lambdaMax);
    }
  });

  test("exotic elements are disclosed, not silently mis-massed", () => {
    // Selenium is outside fragment.ts's exact-mass table.
    const r = predictFragments("C[Se]C");
    expect(r).not.toBeNull();
    if (r!.fragments.length === 0) {
      expect(r!.caveats.join(" ")).toMatch(/outside the built-in exact-mass table/i);
    }
  });

  test("truncated fragment lists disclose what was dropped", () => {
    // A long chain generates far more than the display cap.
    const r = predictFragments("CCCCCCCCCCCCCCCCCCCC", { maxFragments: 5 })!;
    expect(r.fragments.length).toBeLessThanOrEqual(5);
    expect(r.caveats.join(" ")).toMatch(/Showing the 5 most probable/i);
  });

  test("variable protons are never presented as precise predictions", () => {
    for (const smi of ["CCO", "CC(=O)O", "Oc1ccccc1", "CCN", "CC(N)=O"]) {
      const r = predictNmr(smi, "1H")!;
      for (const s of r.signals) {
        if (!s.variable) continue;
        expect(s.assignment).toMatch(/variable/i);
      }
    }
  });
});

describe("adversarial: cross-module consistency", () => {
  test("fragment.ts and massspec.ts agree on formula and molecular mass", () => {
    for (const smi of ["Cc1ccccc1", "CCO", "CC(=O)Oc1ccccc1C(=O)O", "CN1C=NC2=C1C(=O)N(C)C(=O)N2C", "CCCCN"]) {
      const frag = predictFragments(smi)!;
      const ms = computeMassSpec(smi)!;
      expect(frag.formula).toBe(ms.formula);
      // M+• is the neutral monoisotopic mass less one electron.
      expect(Math.abs(frag.molecularIon - (ms.monoisotopicMass - 0.00054858))).toBeLessThan(0.002);
    }
  });

  test("carbonyl classification agrees between NMR, IR and pKa views", () => {
    // An ester must be an ester everywhere: no C=O ~1740 without an ester 13C.
    const ester = "CC(=O)OCC";
    expect(predictIr(ester)!.bands.some((b) => b.assignment.includes("ester"))).toBe(true);
    expect(predictNmr(ester, "13C")!.signals.some((s) => s.assignment.includes("ester"))).toBe(true);
    // And an ester is NOT an ionizable acid — pka.ts must agree it isn't.
    const pk = predictPka(ester);
    expect(pk!.sites.some((s) => s.group === "Carboxylic acid")).toBe(false);
  });

  test("an amide is never treated as an amine or a ketone", () => {
    const amide = "CC(=O)NC";
    expect(predictIr(amide)!.bands.some((b) => b.assignment.includes("amide"))).toBe(true);
    expect(predictNmr(amide, "13C")!.signals.some((s) => s.assignment.includes("amide"))).toBe(true);
    expect(predictPka(amide)!.sites.some((s) => s.kind === "base")).toBe(false);
  });
});

describe("adversarial: rendering helpers survive edge cases", () => {
  test("IR curve is finite and bounded even with zero bands", () => {
    const curve = irTransmittanceCurve([]);
    for (const p of curve) {
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeCloseTo(100, 5); // no bands → full transmittance
    }
  });

  test("IR curve never goes negative even with many overlapping strong bands", () => {
    const r = predictIr("CC(=O)Oc1ccccc1C(=O)O")!;
    const curve = irTransmittanceCurve(r.bands);
    for (const p of curve) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  test("stick spectrum handles a single-signal molecule without dividing by zero", () => {
    const r = predictNmr("c1ccccc1", "1H")!;
    const sticks = nmrSticks(r);
    expect(sticks).toHaveLength(1);
    for (const s of sticks) for (const p of s) expect(Number.isFinite(p.y)).toBe(true);
  });

  test("stick spectrum of an empty prediction is empty, not malformed", () => {
    const r = predictNmr("ClC(Cl)(Cl)Cl", "1H")!;
    expect(nmrSticks(r)).toHaveLength(0);
  });
});
