// CIP descriptors (docs/SCOPE-CIP.md), offline fixtures of our own. The release gate against the CIP Validation Suite
// is scripts/cip-suite.js (the suite is never in the repo). Absolute labels here come from PubChem's isomeric SMILES
// ((R)-butan-2-ol CID 84682, L-alanine); the rest are relations that hold whatever the convention: an enantiomer flips
// every label, a meso compound is (R,S), a pseudo-asymmetric centre and an allene are refused by name.
import { Molecule } from "openchemlib/full";
import { cipDescriptors, type CipCentre } from "../cip";

const of = (smiles: string): CipCentre[] => cipDescriptors(Molecule.fromSmiles(smiles)).centres;
const labels = (smiles: string): string[] => of(smiles).map((c) => c.label ?? `refused: ${c.reason}`);
/** The enantiomer, written by swapping every @ and @@ (and / with \ is not needed: E/Z is not chirality). */
const mirror = (smiles: string): string => smiles.replace(/@@|@/g, (m) => (m === "@@" ? "@" : "@@"));

describe("R/S", () => {
  it("(R)-butan-2-ol and (S)-butan-2-ol (PubChem CID 84682 / 6568)", () => {
    expect(labels("CC[C@@H](C)O")).toEqual(["R"]);
    expect(labels("CC[C@H](C)O")).toEqual(["S"]);
  });

  it("L-alanine is (S)", () => {
    expect(labels("C[C@@H](C(=O)O)N")).toEqual(["S"]);
  });

  it("an explicit hydrogen written first: the same (R) centre, at the caller's atom number", () => {
    const c = of("[H][C@](C)(O)CC");
    expect(c.map((x) => x.label)).toEqual(["R"]);
    expect(c[0].atom).toBe(1);
  });

  it("every label flips in the enantiomer", () => {
    for (const s of ["CC[C@@H](C)O", "C[C@@H](C(=O)O)N", "C[S@@](=O)c1ccccc1", "C[C@@H](O)[C@@H](C)O", "N[C@@H](Cc1ccccc1)C(=O)O"]) {
      const a = labels(s), b = labels(mirror(s));
      expect(a.length).toBeGreaterThan(0);
      expect(b).toEqual(a.map((l) => (l === "R" ? "S" : l === "S" ? "R" : l)));
    }
  });

  it("a sulfoxide's lone pair is the fourth ligand (lowest): the S centre has a label", () => {
    expect(labels("C[S@@](=O)c1ccccc1")).toHaveLength(1);
    expect(["R", "S"]).toContain(labels("C[S@@](=O)c1ccccc1")[0]);
  });

  it("meso-butane-2,3-diol is (R,S); the chiral diastereomer is (R,R) or (S,S)", () => {
    expect(labels("C[C@@H](O)[C@H](C)O").sort()).toEqual(["R", "S"]);
    const chiral = labels("C[C@@H](O)[C@@H](C)O");
    expect(new Set(chiral).size).toBe(1);
  });

  it("the pseudo-asymmetric C3 of meso-2,3,4-trihydroxyglutaric acid is refused by name (never R/S)", () => {
    // Whichever writing gives C2/C4 opposite configurations, C3 is stereogenic and must be refused.
    const forms = ["OC(=O)[C@H](O)[C@H](O)[C@H](O)C(=O)O", "OC(=O)[C@H](O)[C@@H](O)[C@H](O)C(=O)O", "OC(=O)[C@H](O)[C@H](O)[C@@H](O)C(=O)O", "OC(=O)[C@H](O)[C@@H](O)[C@@H](O)C(=O)O"];
    let sawMeso = false;
    for (const s of forms) {
      const c = of(s);
      const ends = c.filter((x) => x.atom === 3 || x.atom === 7);
      const mid = c.find((x) => x.atom === 5);
      if (ends.length === 2 && ends[0].label && ends[1].label && ends[0].label !== ends[1].label) {
        sawMeso = true;
        if (mid) {
          expect(mid.label).toBeNull();
          expect(mid.reason).toMatch(/pseudo-asymmetric|constitutionally the same|rules 3–5/);
        }
      }
    }
    expect(sawMeso).toBe(true);
  });

  it("a centre drawn without a wedge is unspecified, said so", () => {
    const c = cipDescriptors(Molecule.fromMolfile(BUTANOL_NO_WEDGE)).centres;
    if (c.length) {
      expect(c[0].label).toBeNull();
      expect(c[0].reason).toMatch(/unspecified/);
    }
  });
});

describe("E/Z", () => {
  it("(E)- and (Z)-but-2-ene", () => {
    expect(labels("C/C=C/C")).toEqual(["E"]);
    expect(labels(String.raw`C/C=C\C`)).toEqual(["Z"]);
  });

  it("an oxime: OH against the lone pair on N", () => {
    expect(labels("C/C=N/O")).toEqual(["E"]);
    expect(labels(String.raw`C/C=N\O`)).toEqual(["Z"]);
  });

  it("no E/Z for a double bond in a small ring (cyclohexene)", () => {
    expect(of("C1CC=CCC1")).toEqual([]);
  });

  it("a double bond drawn without geometry is unspecified", () => {
    const c = of("CC=CC");
    for (const x of c) expect(x.label).toBeNull();
  });
});

describe("review findings, pinned", () => {
  it("a [3]cumulene's cis/trans is refused by name (OpenChemLib reports none: it was silently dropped)", () => {
    const c = of("C[C@@H](O)C/C=C=C=C/C");
    expect(c.find((x) => x.kind === "atom")?.label).toBe("R");
    const cum = c.find((x) => x.kind === "bond");
    expect(cum?.label).toBeNull();
    expect(cum?.reason).toMatch(/cumulene/);
    expect(of("C/C=C=C=C/C").map((x) => x.reason)).toEqual([expect.stringMatching(/cumulene/)]);
    // Symmetric ends (CH2= / =C(CH3)2) have no cis/trans: nothing to refuse.
    expect(of("C=C=C=C")).toEqual([]);
  });

  it("E/Z in a ring of 8 or more is given ((E)-cyclooctene) — it was always refused as a tie", () => {
    expect(labels("C1CCC/C=C/CC1")).toEqual(["E"]);
    expect(labels(String.raw`C1CCC/C=C\CC1`)).toEqual(["Z"]);
  });

  it("a degenerate drawing (two neighbours at one point) is refused, not read", () => {
    const c = cipDescriptors(Molecule.fromMolfile(BUTANOL_DEGENERATE)).centres;
    expect(c).toHaveLength(1);
    expect(c[0].label).toBeNull();
    expect(c[0].reason).toMatch(/degenerate/);
  });

  it("a sulfoximine's S is an ordinary centre (it was refused as an allene); a sulfinate is given (S=O no longer duplicated)", () => {
    for (const s of ["C[S@](=O)(=N)c1ccccc1", "Cc1ccc(cc1)[S@](=O)OC"]) {
      const c = of(s);
      expect(c[0].reason ?? "").not.toMatch(/allene/);
      if (c[0].label) expect(labels(mirror(s))[0]).toBe(c[0].label === "R" ? "S" : "R");
    }
    expect(of("Cc1ccc(cc1)[S@](=O)OC")[0].label).not.toBeNull();
  });

  it("a lone-pair centre is marked as such (the readout adds a caveat for typed SMILES)", () => {
    expect(of("C[S@@](=O)c1ccccc1")[0].lonePair).toBe(true);
    expect(of("CC[C@@H](C)O")[0].lonePair).toBeUndefined();
  });
});

describe("refused by name", () => {
  it("an allene: axial chirality, M/P not given yet", () => {
    const c = of("CC=[C@]=CC");
    expect(c).toHaveLength(1);
    expect(c[0].label).toBeNull();
    expect(c[0].reason).toMatch(/axial chirality/);
  });

  it("past the work budget: too complex, refused — quickly, never an endless search", () => {
    // The limit in node visits: a budget of one cannot rank even butan-2-ol — refused, not guessed.
    const r = cipDescriptors(Molecule.fromSmiles("CC[C@@H](C)O"), 1);
    expect(r.centres).toEqual([expect.objectContaining({ label: null, reason: expect.stringMatching(/too complex/) })]);
    // A cage on the centre at the real budget: answered (or refused by name) within a moment.
    const t0 = Date.now();
    const cage = cipDescriptors(Molecule.fromSmiles("C[C@H](O)C12C3C4C1C5C2C3C45"));
    expect(Date.now() - t0).toBeLessThan(2000);
    for (const c of cage.centres) if (!c.label) expect(c.reason).toBeTruthy();
  });

  it("a structure read from an idcode alone (no layout) keeps its E/Z and R/S", () => {
    for (const s of ["C/C=C/C", String.raw`C/C=C\C`, "CC[C@@H](C)O"]) {
      const want = labels(s);
      const bare = Molecule.fromIDCode(Molecule.fromSmiles(s).getIDCode());
      expect(cipDescriptors(bare).centres.map((c) => c.label)).toEqual(want);
    }
  });

  it("the molecule passed in is not changed", () => {
    const m = Molecule.fromSmiles("CC[C@@H](C)O");
    const before = m.getIDCodeAndCoordinates();
    cipDescriptors(m);
    expect(m.getIDCodeAndCoordinates()).toEqual(before);
  });
});

// Butan-2-ol with O and C3 drawn at the same point, wedged to O: a degenerate drawing.
const BUTANOL_DEGENERATE = `
  JurisLab

  5  4  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.8660    0.5000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.7321    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.5981    0.5000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.7321    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  1  0
  3  4  1  0
  2  5  1  1
M  END
`;

// (2R/S)-butan-2-ol drawn with no wedge: a stereocentre of unknown configuration.
const BUTANOL_NO_WEDGE = `
  JurisLab

  5  4  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.8660    0.5000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.7321    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.5981    0.5000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.8660    1.5000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  1  0
  3  4  1  0
  2  5  1  0
M  END
`;
