/**
 * fix2-plat: the platform review's confirmed defects, pinned.
 *
 * 1. Carbons at 180° labelled (IUPAC 2008 GR-2.1): CO₂ drew as "O══O", allene as one long double bond.
 * 4. A caption / table label is kept with what follows (<w:keepNext/>); a caption under a figure keeps the figure.
 * 5. Inserted text typeset: Solve's polynomial step and quadratic coefficients, fragment labels, JCAMP table cells.
 * 6. "CS2" in a reaction scheme read as SMILES with an unclosed ring; formulas are read as Structure mode reads them.
 * (2 and 3 are pane/host paths: src/host/__tests__/hostLayer.test.ts, and verified in Word via COM.)
 */
import { Molecule } from "openchemlib/full";
import { readCdxml } from "../cdxml";
import { blankPageCdxml } from "../cdxmlEdit";
import { moleculeToPage } from "../cdxmlMol";
import { linearCarbons } from "../linearCarbons";
import { parseScheme, buildScheme } from "../scheme";
import { resolveStructure } from "../structures";
import { solveEquation, polyDisplay } from "../solve";
import { predictFragments } from "../fragment";
import { traceCell, traceColumn } from "../jcamp";
import { buildResultOoxml, keepWithNext } from "../resultOoxml";
import type { XNode } from "../xmlLite";

/** The labels moleculeToPage writes, per atom, in atom order ("" for a bare vertex). */
function pageLabels(smiles: string): string[] {
  const mol = Molecule.fromSmiles(smiles);
  mol.inventCoordinates();
  const start = readCdxml(blankPageCdxml());
  if (!start.ok) throw new Error("blank page");
  const placed = moleculeToPage(start.doc, mol, [0, 0]);
  if (!placed.ok) throw new Error(placed.reason);
  const page = start.doc.root.children.find((c) => c.name === "page")!;
  const frag = page.children.find((c) => c.attrs.id === placed.fragmentId)!;
  const text = (n: XNode): string =>
    n.children.find((c) => c.name === "t")?.children.filter((c) => c.name === "s").map((c) => c.text).join("").replace(/\n/g, "") ?? "";
  return frag.children.filter((c) => c.name === "n").map(text);
}

/** Atom positions after placement (to check a fully linear molecule is laid level). */
function pageYs(smiles: string): number[] {
  const mol = Molecule.fromSmiles(smiles);
  mol.inventCoordinates();
  const start = readCdxml(blankPageCdxml());
  if (!start.ok) throw new Error("blank page");
  const placed = moleculeToPage(start.doc, mol, [0, 0]);
  if (!placed.ok) throw new Error(placed.reason);
  const page = start.doc.root.children.find((c) => c.name === "page")!;
  const frag = page.children.find((c) => c.attrs.id === placed.fragmentId)!;
  return frag.children.filter((c) => c.name === "n").map((n) => Number(n.attrs.p.split(" ")[1]));
}

describe("1. carbons at 180° are labelled (IUPAC 2008 GR-2.1)", () => {
  test.each([
    ["O=C=O", ["O", "C", "O"]],
    ["S=C=S", ["S", "C", "S"]],
    ["C=C=C", ["", "C", ""]],
    ["CC=C=CC", ["", "", "C", "", ""]],
    ["C=C=O", ["", "C", "O"]],
  ])("%s: the cumulated carbon is drawn (labels %j)", (smiles, labels) => {
    expect(pageLabels(smiles)).toEqual(labels);
  });

  test("acetylene: both carbons labelled with their hydrogens (HC≡CH)", () => {
    expect(pageLabels("C#C").sort()).toEqual(["CH", "HC"]);
  });

  test("hydrogen cyanide: HC≡N, never a bare ≡N", () => {
    expect(pageLabels("C#N")).toEqual(["HC", "N"]);
  });

  test.each([
    ["CC#CC", "but-2-yne"],
    ["CC#C", "propyne"],
    ["CC#N", "acetonitrile"],
    ["N#Cc1ccccc1", "benzonitrile"],
    ["c1ccccc1C#Cc1ccccc1", "diphenylacetylene"],
  ])("%s (%s): the order changes at the carbon, the triple bond's end marks it — carbons stay bare", (smiles) => {
    const labels = pageLabels(smiles);
    const mol = Molecule.fromSmiles(smiles);
    labels.forEach((l, a) => {
      if (mol.getAtomicNo(a) === 6) expect(l).toBe("");
    });
  });

  test("a fully linear molecule is laid level (OCL lays acetylene at 30°)", () => {
    for (const s of ["C#C", "C#N", "O=C=O"]) {
      const ys = pageYs(s);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
    }
  });

  test("an ordinary bent carbon is untouched (propane, ethanol)", () => {
    expect(pageLabels("CCC")).toEqual(["", "", ""]);
    expect(pageLabels("CCO").slice(0, 2)).toEqual(["", ""]);
  });

  test("linearCarbons: within 5° counts, 10° off does not", () => {
    const mol = { getAllAtoms: () => 3, getAtomicNo: (a: number) => (a === 1 ? 6 : 8), getAllConnAtomsPlusMetalBonds: (a: number) => (a === 1 ? 2 : 1), getConnAtom: (a: number, i: number) => (a === 1 ? (i === 0 ? 0 : 2) : 1), getConnBondOrder: () => 2 };
    const at = (deg: number) => (a: number): [number, number] => (a === 0 ? [-1, 0] : a === 1 ? [0, 0] : [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]);
    expect(linearCarbons(mol, at(4)).has(1)).toBe(true);
    expect(linearCarbons(mol, at(10)).has(1)).toBe(false);
  });

  test("a scheme draws CO₂ and allene with their central carbons", () => {
    const b = buildScheme(parseScheme("CO2 + C=C=C -> C#C"));
    if (!b.ok) throw new Error(b.errors.join());
    // Each compound's central C is a text label on the page.
    const labels = b.svg.match(/>C</g) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });
});

describe("6. formulas in a reaction scheme are read as Structure mode reads them", () => {
  test.each(["CS2", "CO2", "SO3"])("%s is drawn", (f) => {
    const b = buildScheme(parseScheme(`${f} -> C`));
    expect(b.ok).toBe(true);
  });

  test("CS2 resolves to carbon disulfide in Structure mode too (S=C=S)", () => {
    const r = resolveStructure("CS2");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.result.formula.replace(/[^A-Za-z0-9]/g, "")).toMatch(/CS2|CS₂/);
  });

  test("NO2 (a radical, no dictionary structure): refused as a FORMULA, as Structure mode refuses it — never as an unclosed ring", () => {
    const b = buildScheme(parseScheme("NO2 -> C"));
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.errors.join(" ")).toMatch(/is a formula/);
      expect(b.errors.join(" ")).not.toMatch(/ring bond/);
    }
    expect(resolveStructure("NO2").kind).toBe("formula");
  });
});

describe("5. inserted text is typeset", () => {
  test("Solve: x^2 - 5x + 6 = 0 — the polynomial step and the coefficients", () => {
    const r = solveEquation("x^2 - 5x + 6 = 0");
    if (!r) throw new Error("no result");
    const steps = r.steps.join("\n");
    expect(steps).toContain("Polynomial form: x² − 5x + 6 = 0.");
    expect(steps).toContain("a = 1, b = −5, c = 6");
    expect(steps).not.toMatch(/\^|·x|=-|\b-\d/);
  });

  test("Solve: b = −5, c = −4 with true minus", () => {
    const r = solveEquation("x^2 - 5x - 4 = 0");
    if (!r) throw new Error("no result");
    expect(r.steps.join("\n")).toContain("b = −5, c = −4");
  });

  test.each([
    [[6, -5, 1], "x² − 5x + 6"],
    [[0, 1], "x"],
    [[-1, 0, -2], "−2x² − 1"],
    [[0.5, 0, 0, 1], "x³ + 0.5"],
    [[1e-20, 1], "x + 1×10⁻²⁰"],
  ])("polyDisplay(%j) = %s", (c, s) => {
    expect(polyDisplay(c as number[], "x")).toBe(s);
  });

  test("fragment labels: H₂O, CO₂, NH₃ typeset", () => {
    const r = predictFragments("OC(=O)CCN");
    if (!r) throw new Error("no fragments");
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/loss of (H2O|CO2|NH3)/);
    expect(text).toMatch(/loss of H₂O/);
  });

  test.each([
    [-1.93, "−1.93"],
    [0.30000000000000004, "0.3"],
    [1234.56789, "1234.57"],
    [-0.000012345678, "−0.0000123457"],
    [1.5e-9, "1.5×10⁻⁹"],
    [NaN, ""],
  ])("JCAMP cell %p → %s", (v, s) => {
    expect(traceCell(v)).toBe(s);
  });

  test("JCAMP x column: a fine grid far from zero keeps every abscissa distinct (more figures only there)", () => {
    expect(traceColumn([4000.0001, 4000.0002, 4000.0003])).toEqual(["4000.0001", "4000.0002", "4000.0003"]);
    expect(traceColumn([1.0000001, 2.0000001])).toEqual(["1", "2"]);
    expect(traceColumn([-5, -5])).toEqual(["−5", "−5"]); // equal values are not a collision
  });

  test("a tab in result text is Word's own <w:tab/>, not a raw tab in <w:t>", () => {
    const x = buildResultOoxml([{ kind: "text", content: "a\tb" }]).ooxml;
    expect(x).toContain('a</w:t><w:tab/><w:t xml:space="preserve">b');
    expect(x).not.toContain("\t");
  });

  test("Solve: an equation that reduces to a negative constant says so with a true minus", () => {
    const r = solveEquation("x - x + 3 = 5");
    if (!r) throw new Error("no result");
    expect(r.steps.join("\n")).toMatch(/Reduced to −2 = 0\./);
  });
});

describe("4. captions stay with their figures (<w:keepNext/>)", () => {
  const pic = { kind: "picture" as const, base64: "AA", widthPt: 10, heightPt: 10, alt: "a" };
  test("a caption above a figure is kept with it", () => {
    const x = buildResultOoxml([{ ...pic, caption: "Figure 1. A caption" }]).ooxml;
    expect(x).toMatch(/<w:p><w:pPr><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">Figure 1\. A caption/);
  });
  test("a table label is kept with its table; a label with no rows is not", () => {
    const x = buildResultOoxml([{ kind: "table", label: "Reactions", rows: [["a", "b"]] }]).ooxml;
    expect(x).toMatch(/<w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">Reactions/);
    expect(buildResultOoxml([{ kind: "table", label: "Empty", rows: [] }]).ooxml).not.toContain("keepNext");
  });
  test("a caption BELOW a figure: the picture paragraph is kept with the caption under it", () => {
    const x = buildResultOoxml([{ kind: "text", content: "t = 2.1" }, { ...pic, caption: "", below: "* p < 0.05" }]).ooxml;
    expect(x).toMatch(/<w:p><w:pPr><w:keepNext\/><\/w:pPr><w:r><w:drawing>/);
    expect(x.indexOf("<w:drawing>")).toBeLessThan(x.indexOf("* p &lt; 0.05"));
    // The result line itself is not forced onto the figure's page.
    expect(x).toMatch(/<w:p><w:r><w:t xml:space="preserve">t = 2\.1/);
  });
  test("keepWithNext: after pStyle (CT_PPr order), idempotent, never on a table or an empty paragraph", () => {
    expect(keepWithNext('<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/></w:pPr><w:r/></w:p>')).toBe(
      '<w:p><w:pPr><w:pStyle w:val="Caption"/><w:keepNext/><w:jc w:val="center"/></w:pPr><w:r/></w:p>',
    );
    const once = keepWithNext("<w:p><w:r/></w:p>");
    expect(keepWithNext(once)).toBe(once);
    expect(keepWithNext("<w:p/>")).toBe("<w:p/>");
    expect(keepWithNext("<w:tbl></w:tbl>")).toBe("<w:tbl></w:tbl>");
  });
});
