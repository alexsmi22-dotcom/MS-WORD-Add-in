import { predictPka } from "../pka";

function groups(smiles: string): string[] {
  const r = predictPka(smiles);
  if (!r) throw new Error("no result");
  return r.sites.map((s) => s.group);
}

describe("pKa functional-group detection", () => {
  it("carboxylic acid (acetic acid)", () => {
    expect(groups("CC(=O)O")).toContain("Carboxylic acid");
  });
  it("phenol", () => {
    expect(groups("c1ccccc1O")).toContain("Phenol");
  });
  it("aliphatic amine (methylamine)", () => {
    expect(groups("CN")).toContain("Aliphatic amine");
  });
  it("aniline is distinguished from an aliphatic amine", () => {
    const g = groups("c1ccccc1N");
    expect(g).toContain("Aniline (aromatic amine)");
    expect(g).not.toContain("Aliphatic amine");
  });
  it("pyridine nitrogen is basic", () => {
    expect(groups("c1ccncc1")).toContain("Aromatic N (pyridine-type)");
  });
  it("thiol", () => {
    expect(groups("CCS")).toContain("Thiol");
  });
  it("sulfonic acid", () => {
    expect(groups("c1ccccc1S(=O)(=O)O")).toContain("Sulfonic acid");
  });
});

describe("pKa false-positive guards (the risky cases)", () => {
  it("ester is NOT detected as a carboxylic acid", () => {
    // ethyl acetate CC(=O)OCC
    expect(groups("CC(=O)OCC")).not.toContain("Carboxylic acid");
  });
  it("amide nitrogen is NOT detected as a basic amine", () => {
    // acetamide CC(=O)N
    const g = groups("CC(=O)N");
    expect(g).not.toContain("Aliphatic amine");
    expect(g).not.toContain("Aniline (aromatic amine)");
  });
  it("nitrile nitrogen is not basic", () => {
    // acetonitrile CC#N
    expect(groups("CC#N")).not.toContain("Aliphatic amine");
  });
  it("pyrrole NH is not basic", () => {
    expect(groups("c1cc[nH]c1")).not.toContain("Aromatic N (pyridine-type)");
  });
});

describe("pKa net-charge estimate at pH 7.4", () => {
  it("glycine is a zwitterion (net charge near 0)", () => {
    // NCC(=O)O — carboxylate (−) + ammonium (+)
    const r = predictPka("NCC(=O)O")!;
    const kinds = r.sites.map((s) => s.kind).sort();
    expect(kinds).toEqual(["acid", "base"]);
    expect(Math.abs(r.netChargeAt74)).toBeLessThan(0.2);
  });
  it("a carboxylic acid alone is negative at pH 7.4", () => {
    const r = predictPka("CC(=O)O")!;
    expect(r.netChargeAt74).toBeLessThan(-0.9);
  });
  it("an aliphatic amine alone is positive at pH 7.4", () => {
    const r = predictPka("CCCN")!;
    expect(r.netChargeAt74).toBeGreaterThan(0.9);
  });
  it("an alkane has no ionizable sites", () => {
    expect(predictPka("CCCC")!.sites).toHaveLength(0);
  });
});

// --- Values against literature ---------------------------------------------
// Found by audit: this suite tested DETECTION thoroughly but never asserted a
// single pKa VALUE. That let a real bug ship — arginine's guanidine was read as
// three separate "aliphatic amine" sites at 10.6, giving a net charge of +2.0 at
// pH 7.4 against a true +1.0. Detection tests alone cannot catch a group being
// silently misrouted to the wrong label.
describe("pKa values match the literature", () => {
  const site = (smiles: string, group: RegExp) => {
    const r = predictPka(smiles);
    expect(r).not.toBeNull();
    return r!.sites.find((s) => group.test(s.group));
  };

  test("arginine: guanidine, not three amines", () => {
    const r = predictPka("NC(=N)NCCCC(N)C(=O)O")!;
    const g = r.sites.filter((s) => /Guanidine/.test(s.group));
    expect(g).toHaveLength(1); // ONE group, not one per nitrogen
    expect(g[0].pka).toBeCloseTo(12.5, 1); // literature ~12.5
    // Exactly one aliphatic amine remains: the alpha-amino group.
    expect(r.sites.filter((s) => s.group === "Aliphatic amine")).toHaveLength(1);
    // The number that actually reaches the user.
    expect(r.netChargeAt74).toBeCloseTo(1.0, 1); // was 2.0 — a 100% error
  });

  test("histidine: imidazole near 6, the only side chain titrating near pH 7", () => {
    const r = predictPka("O=C(O)C(N)Cc1cnc[nH]1")!;
    const im = r.sites.find((s) => /Imidazole/.test(s.group))!;
    expect(im).toBeDefined();
    expect(im.pka).toBeCloseTo(6.0, 1); // literature ~6.0, not pyridine's 5.2
  });

  test("acetamidine is an amidine, not an amine", () => {
    expect(site("CC(=N)N", /Amidine/)!.pka).toBeCloseTo(11.6, 1);
  });

  test("lysine is still a plain aliphatic amine (the fix must not overreach)", () => {
    const r = predictPka("NCCCCC(N)C(=O)O")!;
    expect(r.sites.filter((s) => s.group === "Aliphatic amine")).toHaveLength(2);
    expect(r.sites.some((s) => /Guanidine|Amidine/.test(s.group))).toBe(false);
    expect(r.netChargeAt74).toBeCloseTo(1.0, 1);
  });

  test("pyridine is NOT read as imidazole", () => {
    const r = predictPka("c1ccncc1")!;
    expect(r.sites[0].group).toMatch(/pyridine/);
    expect(r.sites[0].pka).toBeCloseTo(5.2, 1);
  });

  test("urea is an amide, not a guanidine", () => {
    // A carbonyl between two nitrogens must not be mistaken for a guanidine
    // carbon — urea is not basic.
    const r = predictPka("NC(=O)N")!;
    expect(r.sites.some((s) => /Guanidine|Amidine/.test(s.group))).toBe(false);
  });

  test("known group values, spot-checked", () => {
    expect(site("CC(=O)O", /Carboxylic/)!.pka).toBeCloseTo(4.5, 1);
    expect(site("Oc1ccccc1", /Phenol/)!.pka).toBeCloseTo(10.0, 1);
    expect(site("CCS", /Thiol/)!.pka).toBeCloseTo(10.5, 1);
    expect(site("Nc1ccccc1", /Aniline/)!.pka).toBeCloseTo(4.6, 1);
    expect(site("CS(=O)(=O)O", /Sulfonic/)!.pka).toBeLessThan(0);
  });
});
