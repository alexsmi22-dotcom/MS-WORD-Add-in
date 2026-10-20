// CIP descriptors in the readouts (lib/cipText.ts): the systematic name carries them only when every stereo element
// is given and has a locant; otherwise the line says what is given and what is not, and why — never a partial prefix.
import { Molecule } from "openchemlib/full";
import { iupacName } from "../iupacName";
import { stereoText } from "../cipText";

const named = (smiles: string): { name: string; line: string | null } => {
  const m = Molecule.fromSmiles(smiles);
  const n = iupacName(m);
  const t = stereoText(m, n.locants, { reversible: n.reversible });
  return { name: `${t.prefix ?? ""}${n.name ?? `(${n.refusal})`}`, line: t.line };
};

describe("names with CIP stereodescriptors", () => {
  it("(2R)-butan-2-ol, (2E)-but-2-ene, L-alanine and L-phenylalanine as (2S)", () => {
    expect(named("CC[C@@H](C)O").name).toBe("(2R)-butan-2-ol");
    expect(named("C/C=C/C").name).toBe("(2E)-but-2-ene");
    expect(named("C[C@@H](C(=O)O)N").name).toBe("(2S)-2-aminopropanoic acid");
    expect(named("N[C@@H](Cc1ccccc1)C(=O)O").name).toBe("(2S)-2-amino-3-phenylpropanoic acid");
  });

  it("several elements, by locant: (2R,3S)-butane-2,3-diol, (2R,3E)-hex-3-en-2-ol", () => {
    expect(named("C[C@@H](O)[C@H](C)O").name).toBe("(2R,3S)-butane-2,3-diol");
    expect(named("CC/C=C/[C@@H](C)O").name).toBe("(2R,3E)-hex-3-en-2-ol");
  });

  it("a refused element keeps descriptors out of the name, and the line says why", () => {
    const r = named("OC(=O)[C@H](O)[C@H](O)[C@H](O)C(=O)O");
    expect(r.name).toBe("2,3,4-trihydroxypentanedioic acid");
    expect(r.line).toMatch(/not given at C-3: .*pseudo-asymmetric/);
    const u = named("CC=CC");
    expect(u.name).toBe("but-2-ene");
    expect(u.line).toMatch(/unspecified/);
  });

  it("no stereo element: no line, no prefix", () => {
    expect(named("CCO").line).toBeNull();
    expect(named("CCO").name).toBe("ethanol");
  });

  it("racemic (an AND group): rac-(2R)-…", () => {
    const m = Molecule.fromSmiles("CC[C@@H](C)O");
    m.ensureHelperArrays(Molecule.cHelperParities);
    const c = Array.from({ length: m.getAtoms() }, (_, i) => i).find((i) => m.getAtomParity(i) === Molecule.cAtomParity1 || m.getAtomParity(i) === Molecule.cAtomParity2)!;
    m.setAtomESR(c, Molecule.cESRTypeAnd, 0);
    const t = stereoText(m, iupacName(m).locants);
    expect(t.prefix).toBe("rac-(2R)-");
  });

  it("review: centres in separate AND groups have no drawn relation — no rac- prefix, the line says so", () => {
    const m = Molecule.fromSmiles("CC[C@@H](O)[C@@H](C)O");
    m.ensureHelperArrays(Molecule.cHelperParities);
    const cs = Array.from({ length: m.getAtoms() }, (_, i) => i).filter((i) => m.getAtomParity(i) === Molecule.cAtomParity1 || m.getAtomParity(i) === Molecule.cAtomParity2);
    expect(cs).toHaveLength(2);
    m.setAtomESR(cs[0], Molecule.cESRTypeAnd, 0);
    m.setAtomESR(cs[1], Molecule.cESRTypeAnd, 1);
    const n = iupacName(m);
    const t = stereoText(m, n.locants, { reversible: n.reversible });
    expect(t.prefix).toBeNull();
    expect(t.line).toMatch(/different stereo groups/);
    expect(t.line).toMatch(/&1/);
  });

  it("review: rac- is written with R at the lowest locant whichever enantiomer is drawn", () => {
    for (const s of ["CC[C@@H](C)O", "CC[C@H](C)O"]) {
      const m = Molecule.fromSmiles(s);
      m.ensureHelperArrays(Molecule.cHelperParities);
      const c = Array.from({ length: m.getAtoms() }, (_, i) => i).find((i) => m.getAtomParity(i) === Molecule.cAtomParity1 || m.getAtomParity(i) === Molecule.cAtomParity2)!;
      m.setAtomESR(c, Molecule.cESRTypeAnd, 0);
      const t = stereoText(m, iupacName(m).locants);
      expect(t.prefix).toBe("rac-(2R)-");
      expect(t.line).toMatch(/marked racemic/);
    }
  });

  it("review: a symmetric chain is numbered so the preferred descriptor gets the lower locant (P-31.1.4.3.4)", () => {
    // Whichever direction the namer chose, (2S,3R)- and (2R,3S)-butane-2,3-diol are the same meso compound: (2R,3S).
    expect(named("C[C@@H](O)[C@H](C)O").name).toBe("(2R,3S)-butane-2,3-diol");
    expect(named("C[C@H](O)[C@@H](C)O").name).toBe("(2R,3S)-butane-2,3-diol");
    // meso-tartaric acid (two identical OH groups: the namer once missed the symmetry) — (2R,3S) either way.
    expect(named("OC(=O)[C@@H](O)[C@@H](O)C(=O)O").name).toBe("(2R,3S)-2,3-dihydroxybutanedioic acid");
    expect(named("OC(=O)[C@H](O)[C@H](O)C(=O)O").name).toBe("(2R,3S)-2,3-dihydroxybutanedioic acid");
    // (2E,4Z)- and (2Z,4E)-hexa-2,4-diene are one compound: (2Z,4E).
    for (const s of [String.raw`C/C=C/C=C\C`, String.raw`C/C=C\C=C\C`]) {
      const m = Molecule.fromSmiles(s);
      const n = iupacName(m);
      const t = stereoText(m, n.locants, { reversible: n.reversible });
      expect(n.reversible).toBe(true);
      expect(t.prefix).toBe("(2Z,4E)-");
    }
  });

  it("review: a cumulene's cis/trans keeps the prefix out of the name (it was dropped silently)", () => {
    const r = named("C[C@@H](O)C/C=C=C=C/C");
    expect(r.name).not.toMatch(/^\(/);
    expect(r.line).toMatch(/cumulene/);
  });

  it("review: a lone-pair centre typed as SMILES gets a caveat; drawn, it does not", () => {
    const m = Molecule.fromSmiles("C[S@@](=O)c1ccccc1");
    expect(stereoText(m, undefined, { fromText: true }).line).toMatch(/lone-pair centre/);
    expect(stereoText(m).line).not.toMatch(/lone-pair centre/);
  });

  it("round 2: a symmetric chain whose numberings differ in both E/Z and R/S gets no prefix (the rule's order is not settled here)", () => {
    const r = named(String.raw`C[C@@H](O)/C=C/C=C\[C@H](C)O`);
    expect(r.name).not.toMatch(/^\(/);
    expect(r.line).toMatch(/not settled here/);
  });

  it("round 2: typed as text, E/Z in a large ring is refused (SMILES readers misread polyene macrocycles); drawn, it is given", () => {
    const smi = String.raw`C1CCC/C=C/CC1`;
    expect(stereoText(Molecule.fromSmiles(smi), undefined, { fromText: true }).line).toMatch(/large ring typed as text/);
    expect(stereoText(Molecule.fromSmiles(smi)).line).toMatch(/E/);
  });

  it("the line lists given labels in locant order", () => {
    const t = named("CC/C=C/[C@@H](C)O");
    expect(t.line).toMatch(/2R, 3E/);
  });

  it("without locants (a structure the namer does not name), each given label says where it is by what it carries", () => {
    const t = stereoText(Molecule.fromSmiles("C[C@@H](O)c1ccc2ccccc2c1"));
    expect(t.prefix).toBeNull();
    expect(t.line).toMatch(/[RS] at C\(O\)/);
  });
});
