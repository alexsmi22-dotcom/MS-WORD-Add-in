// Pasted DOIs, offline (docs/SCOPE-CITATIONS-2026-10.md §C2). Recognition follows
// Crossref's recommended pattern /^10.\d{4,9}/[-._;()/:A-Z0-9]+$/i (Crossref blog,
// "DOIs and matching regular expressions", 2015); the DOIs below are real ones from
// the fixtures and the §C6 oracles.

import * as fs from "fs";
import * as path from "path";
import { CROSSREF_DOI_PATTERN, DOI_OFFLINE_NOTE, doiUrl, findDois, normalizeDoi, trimDoiTail } from "../doi";

describe("the three paste forms (plus the variants people actually paste)", () => {
  test.each([
    ["10.1086/720277", "10.1086/720277"],
    ["doi:10.1086/720277", "10.1086/720277"],
    ["DOI: 10.1086/720277", "10.1086/720277"],
    ["doi: 10.3109/07434618.2014.906498", "10.3109/07434618.2014.906498"],
    ["DOI 10.1086/720277", "10.1086/720277"],
    ["https://doi.org/10.1086/720277", "10.1086/720277"],
    ["http://doi.org/10.1086/720277", "10.1086/720277"],
    ["doi.org/10.1086/720277", "10.1086/720277"],
    ["https://www.doi.org/10.1086/720277", "10.1086/720277"],
    ["http://dx.doi.org/10.1016/j.actamat.2016.09.028", "10.1016/j.actamat.2016.09.028"],
    ["https://dx.doi.org/10.1038/s41586-020-2012-7", "10.1038/s41586-020-2012-7"],
    ["info:doi/10.1086/720277", "10.1086/720277"],
    ["https://doi.org/10.1086%2F720277", "10.1086/720277"],
    ["  <https://doi.org/10.1086/720277>  ", "10.1086/720277"],
  ])("%s", (input, doi) => {
    expect(normalizeDoi(input)).toEqual({ doi, url: `https://doi.org/${doi}` });
  });
});

describe("trailing punctuation", () => {
  test.each([
    ["10.1086/720277.", "10.1086/720277"],
    ["https://doi.org/10.1086/720277.", "10.1086/720277"],
    ["10.1086/720277,", "10.1086/720277"],
    ["10.1086/720277;", "10.1086/720277"],
    ["“10.1086/720277”", "10.1086/720277"],
    ["(doi:10.1086/720277)", "10.1086/720277"],
    ["10.1086/720277).", "10.1086/720277"],
    // A legitimate closing parenthesis is balanced and is kept.
    ["10.1016/S0027-9684(15)31340-7", "10.1016/S0027-9684(15)31340-7"],
    ["10.1016/S0140-6736(20)30183-5.", "10.1016/S0140-6736(20)30183-5"],
    ["(10.1016/S0140-6736(20)30183-5)", "10.1016/S0140-6736(20)30183-5"],
    // Wiley SICI DOIs contain < > and survive.
    ["10.1002/(SICI)1097-4636(199812)43:4<345::AID-JBM1>3.0.CO;2-H", "10.1002/(SICI)1097-4636(199812)43:4<345::AID-JBM1>3.0.CO;2-H"],
  ])("%s", (input, doi) => {
    const r = normalizeDoi(input);
    expect(r).toEqual({ doi, url: doiUrl(doi) });
  });
  test("trimDoiTail on its own", () => {
    expect(trimDoiTail("10.1000/abc).")).toBe("10.1000/abc");
    expect(trimDoiTail("10.1000/a(b)")).toBe("10.1000/a(b)");
  });
});

describe("prefix validation", () => {
  test.each([
    ["11.1086/720277", /is not a DOI: a DOI starts with “10\.”/],
    ["10.108/720277", /4–9 digits/],
    ["10.1234567890/x", /4–9 digits/],
    ["10.1086/", /no suffix/],
    ["10.1086", /no suffix/],
    ["https://example.com/10.1086/720277", /is not a DOI/],
    ["10.1086/720277 and more words", /is not a DOI/],
    ["", /is not a DOI/],
  ])("%s → refused", (input, reason) => {
    const r = normalizeDoi(input);
    expect("error" in r && r.error).toMatch(reason);
  });
  test("registrant sub-divisions (10.1000.10/…) are DOIs", () => {
    expect(normalizeDoi("10.1000.10/123456")).toEqual({ doi: "10.1000.10/123456", url: "https://doi.org/10.1000.10/123456" });
  });
  test("case is kept as typed (DOIs are case-insensitive; the resolver does not care)", () => {
    expect(normalizeDoi("10.1037/H0100165")).toMatchObject({ doi: "10.1037/H0100165" });
  });
});

describe("findDois in free text", () => {
  test("Crossref pattern, trailing punctuation trimmed, de-duplicated case-insensitively", () => {
    const text = "See doi:10.1086/720277. Also https://doi.org/10.1086/720277, and (10.1016/S0140-6736(20)30183-5).";
    expect(findDois(text)).toEqual(["10.1086/720277", "10.1016/S0140-6736(20)30183-5"]);
    expect(CROSSREF_DOI_PATTERN.test("10.1038/s41586-020-2012-7")).toBe(true);
  });
});

describe("offline: no network, and the UI says so", () => {
  test("the UI line from §C2 is exported verbatim", () => {
    expect(DOI_OFFLINE_NOTE).toBe(
      "JurisLab works offline, so it can't look a DOI up. Paste the reference's BibTeX or RIS from the publisher page to fill everything.",
    );
  });

  test("no network primitive is touched while normalising every form", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket };
    const fetchSpy = jest.fn(() => {
      throw new Error("network");
    });
    const xhrSpy = jest.fn(() => {
      throw new Error("network");
    });
    const wsSpy = jest.fn(() => {
      throw new Error("network");
    });
    g.fetch = fetchSpy;
    g.XMLHttpRequest = xhrSpy;
    g.WebSocket = wsSpy;
    try {
      for (const s of ["10.1086/720277", "doi:10.1086/720277", "https://doi.org/10.1086/720277", "http://dx.doi.org/10.1086/720277", "nonsense"]) {
        normalizeDoi(s);
        findDois(s);
      }
    } finally {
      g.fetch = saved.fetch;
      g.XMLHttpRequest = saved.XMLHttpRequest;
      g.WebSocket = saved.WebSocket;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
  });

  test("the importer sources contain no network primitive and import nothing that could", () => {
    const LIB = path.join(__dirname, "..");
    for (const f of ["doi.ts", "bibtex.ts", "ris.ts", "cslJson.ts", "bibNames.ts", "latexUnicode.ts"]) {
      const src = fs.readFileSync(path.join(LIB, f), "utf8");
      // Dynamic import is written import(…); "import (docs/…)" in a comment is prose.
      expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|\bimport\(|\brequire\(/);
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const imp of imports) {
        expect(["./bibRecord", "./doi", "./cslJson", "./bibNames", "./latexUnicode"]).toContain(imp);
      }
    }
  });
});
