// Regression: a drafter-supplied /codon_start was written into the ST.26 XML and
// then ignored when auto-generating /translation, which always read from base 1.
// The emitted feature therefore carried codon_start=2 beside the frame-1 product.
//
// A sequence listing whose translation contradicts its own reading frame is a
// substantive defect in a filed application — caught late by WIPO Sequence at
// best, a wrong protein of record at worst.

import { translateCds, buildSt26Xml } from "../sequence";

describe("translateCds — reading frame", () => {
  // ATG GCA TGC ATG CAC  -> frame 1: M A C M H
  // from base 2: TGG CAT GCA TGC AC -> W H A C
  const CDS = "ATGGCATGCATGCAC";

  test("frame 1 is the default and unchanged", () => {
    expect(translateCds(CDS)).toBe("MACMH");
    expect(translateCds(CDS, 1)).toBe("MACMH");
  });

  test("codon_start 2 shifts the frame", () => {
    expect(translateCds(CDS, 2)).toBe("WHAC");
  });

  test("codon_start 3 shifts again", () => {
    // GGC ATG CAT GCA C -> G M H A
    expect(translateCds(CDS, 3)).toBe("GMHA");
  });

  test("the three frames are genuinely different", () => {
    const f = [1, 2, 3].map((n) => translateCds(CDS, n as 1 | 2 | 3));
    expect(new Set(f).size).toBe(3);
  });

  test("still stops at the first stop codon", () => {
    expect(translateCds("ATGTAAATG")).toBe("M");
  });
});

describe("ST.26 XML — the emitted frame matches the emitted translation", () => {
  function xmlFor(codonStart?: string): string {
    return buildSt26Xml(
      {
        applicantName: "Test Applicant",
        inventionTitle: "Test Invention",
        productionDate: "2026-07-26",
      },
      [
        {
          moltype: "DNA",
          residues: "ATGGCATGCATGCAC",
          features: [
            {
              key: "CDS",
              location: "1..15",
              qualifiers: codonStart ? [{ name: "codon_start", value: codonStart }] : [],
            },
          ],
        },
      ],
    );
  }

  test("with no /codon_start, frame 1 is emitted and used", () => {
    const xml = xmlFor();
    expect(xml).toContain("MACMH");
    expect(xml).toMatch(/codon_start/);
  });

  test("a supplied /codon_start=2 produces the frame-2 translation", () => {
    const xml = xmlFor("2");
    expect(xml).toContain("WHAC");
    // and must NOT contain the frame-1 product it used to emit
    expect(xml).not.toContain("MACMH");
  });

  test("a supplied /codon_start is not duplicated", () => {
    const xml = xmlFor("2");
    expect((xml.match(/codon_start/g) ?? []).length).toBe(1);
  });

  test("a nonsense /codon_start falls back to frame 1 rather than throwing", () => {
    const xml = xmlFor("banana");
    expect(xml).toContain("MACMH");
  });
});
