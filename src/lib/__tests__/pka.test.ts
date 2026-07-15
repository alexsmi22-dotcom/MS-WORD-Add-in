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
