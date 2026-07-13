import { opsinUrl, parseOpsinResponse, resolveNameOnline, OPSIN_ENDPOINT } from "../opsin";

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

describe("resolveNameOnline", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("surfaces OPSIN's message from a 404 FAILURE body (not a service error)", async () => {
    // OPSIN answers HTTP 404 for names it can't parse; the body still carries the reason.
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status: "FAILURE", message: "xyz was uninterpretable" }),
    }) as unknown as typeof fetch;
    const out = await resolveNameOnline("xyz");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toContain("uninterpretable");
      expect(out.message).not.toContain("HTTP 404");
    }
  });

  it("resolves a 200 SUCCESS body to SMILES", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "SUCCESS", smiles: "CC" }),
    }) as unknown as typeof fetch;
    const out = await resolveNameOnline("ethane");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.smiles).toBe("CC");
  });

  it("reports a genuine service outage (5xx with no JSON body)", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error("not json");
      },
    }) as unknown as typeof fetch;
    const out = await resolveNameOnline("ethane");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("HTTP 503");
  });

  it("reports a connection failure when fetch throws", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    const out = await resolveNameOnline("ethane");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("internet connection");
  });
});
