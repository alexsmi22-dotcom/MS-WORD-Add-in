// HMBC and TOCSY: the two 2D experiments that were still missing.
import { predictHmbc, predictTocsy, predictHsqc, predictCosy } from "../nmr2d";

const hmbc = (s: string) => { const r = predictHmbc(s); if (!r) throw new Error("no HMBC " + s); return r; };
const tocsy = (s: string) => { const r = predictTocsy(s); if (!r) throw new Error("no TOCSY " + s); return r; };

describe("HMBC reaches carbons HSQC cannot see", () => {
  it("methyl acetate: both methyls correlate to the QUATERNARY carbonyl", () => {
    // The carbonyl carries no proton, so HSQC has no peak for it at all.
    const r = hmbc("CC(=O)OC");
    const carbonyl = r.peaks.filter((p) => p.f1 > 150);
    expect(carbonyl.length).toBeGreaterThanOrEqual(2);
    const hs = predictHsqc("CC(=O)OC")!;
    expect(hs.peaks.some((p) => p.f1 > 150)).toBe(false);
  });

  it("2-bond correlations are marked weak, 3-bond are not", () => {
    const r = hmbc("CC(=O)OC");
    expect(r.peaks.some((p) => p.weak === true)).toBe(true);
    expect(r.peaks.some((p) => !p.weak)).toBe(true);
    for (const p of r.peaks) {
      expect(p.label).toMatch(/^[23]J:/);
      expect(p.weak === true).toBe(p.label.startsWith("2J"));
    }
  });

  it("the one-bond correlation is EXCLUDED — that is HSQC's job", () => {
    // In ethanol the CH3 protons must not correlate to their own carbon here.
    const r = hmbc("CCO");
    for (const p of r.peaks) expect(p.label).not.toMatch(/^1J/);
  });

  it("correlations cross a heteroatom, which is the point", () => {
    // Methyl acetate: the OCH3 protons reach the carbonyl through the oxygen.
    const r = hmbc("CC(=O)OC");
    expect(r.peaks.some((p) => p.f2 > 3 && p.f1 > 150)).toBe(true);
  });

  it("says what it does not predict", () => {
    const j = hmbc("CCO").caveats.join(" ");
    expect(j).toMatch(/QUATERNARY/);
    expect(j).toMatch(/intensity is not predicted/i);
  });

  it("no peaks for a molecule with no carbon-bound protons", () => {
    const r = predictHmbc("O=C=O");
    if (r) expect(r.peaks).toHaveLength(0);
  });
});

describe("TOCSY groups protons into spin systems", () => {
  it("propan-1-ol: the three-carbon chain is ONE system, the OH is separate", () => {
    const r = tocsy("CCCO");
    const multi = r.spinSystems.filter((g) => g.length > 1);
    expect(multi).toHaveLength(1);
    expect(multi[0]).toHaveLength(3);
  });

  it("methyl acetate: two isolated methyls are two systems", () => {
    const r = tocsy("CC(=O)OC");
    expect(r.spinSystems.filter((g) => g.length > 1)).toHaveLength(0);
    expect(r.spinSystems.length).toBeGreaterThanOrEqual(2);
  });

  it("every pair within a system gets a cross-peak — the difference from COSY", () => {
    const r = tocsy("CCCO");
    const c = predictCosy("CCCO")!;
    const tCross = r.peaks.filter((p) => p.kind === "cross").length;
    const cCross = c.peaks.filter((p) => p.kind === "cross").length;
    // A 3-proton chain couples 1-2 and 2-3 in COSY, but TOCSY also relates 1-3.
    expect(tCross).toBeGreaterThan(cCross);
  });

  it("relayed correlations are marked weak, direct ones are not", () => {
    const r = tocsy("CCCO");
    expect(r.peaks.some((p) => p.kind === "cross" && p.weak)).toBe(true);
    expect(r.peaks.some((p) => p.kind === "cross" && !p.weak)).toBe(true);
  });

  it("the diagonal is present, once per signal in a system", () => {
    const r = tocsy("CCCO");
    const diag = r.peaks.filter((p) => p.kind === "diagonal");
    expect(diag.length).toBeGreaterThan(0);
    for (const d of diag) expect(d.f2).toBeCloseTo(d.f1, 9);
  });

  it("counts the systems in its own caveat", () => {
    const r = tocsy("CCCO");
    expect(r.caveats.join(" ")).toMatch(new RegExp(`${r.spinSystems.length} system`));
  });
});
