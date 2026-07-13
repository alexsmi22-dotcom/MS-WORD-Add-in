import { opsinUrl, parseOpsinResponse, OPSIN_ENDPOINT } from "../opsin";

describe("opsinUrl", () => {
  it("path-encodes names with spaces and parentheses", () => {
    expect(opsinUrl("caffeine")).toBe(`${OPSIN_ENDPOINT}/caffeine.json`);
    expect(opsinUrl("2-amino-3-(1H-indol-3-yl)propanoic acid")).toBe(
      `${OPSIN_ENDPOINT}/2-amino-3-(1H-indol-3-yl)propanoic%20acid.json`
    );
  });
  it("trims surrounding whitespace", () => {
    expect(opsinUrl("  benzene  ")).toBe(`${OPSIN_ENDPOINT}/benzene.json`);
  });
});

describe("parseOpsinResponse", () => {
  it("extracts SMILES / InChI / InChIKey on success", () => {
    const out = parseOpsinResponse({
      status: "SUCCESS",
      message: "",
      smiles: "N1(C)C(=O)N(C)C=2N=CN(C)C2C1=O",
      stdinchi: "InChI=1S/C8H10N4O2/...",
      stdinchikey: "RYYVLZVUVIJVGH-UHFFFAOYSA-N",
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.smiles).toBe("N1(C)C(=O)N(C)C=2N=CN(C)C2C1=O");
      expect(out.result.inchikey).toBe("RYYVLZVUVIJVGH-UHFFFAOYSA-N");
    }
  });

  it("reports OPSIN's message on a FAILURE status", () => {
    const out = parseOpsinResponse({ status: "FAILURE", message: "xyz was uninterpretable", smiles: undefined });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("uninterpretable");
  });

  it("fails safely on a malformed or empty response", () => {
    expect(parseOpsinResponse(null).ok).toBe(false);
    expect(parseOpsinResponse({ status: "SUCCESS" }).ok).toBe(false); // no smiles
    expect(parseOpsinResponse({}).ok).toBe(false);
  });
});
