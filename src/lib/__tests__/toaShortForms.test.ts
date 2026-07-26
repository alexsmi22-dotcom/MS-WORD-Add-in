// Short-form citations in the Table of Authorities.
//
// The old behaviour: only full-form cites were marked, so a brief that cites
// Alice in full once and short-form four times produced a TOA listing one page.
// The table looked finished and was defective under most local rules.
//
// The risk in fixing it is the opposite error — attributing a page to the WRONG
// authority, which is worse than omitting it. `Id.` is the dangerous case, and
// most of these tests are about it.

import { authoritiesForToa, caseShortName, toaOccurrences } from "../toa";

describe("the party name a short form uses", () => {
  test("takes the first party, minus its corporate suffix", () => {
    expect(caseShortName("Alice Corp. v. CLS Bank Int'l")).toBe("Alice");
    expect(caseShortName("Mayo Collaborative Servs. v. Prometheus Labs., Inc.")).toBe("Mayo");
  });

  test("skips a party that would not identify the case", () => {
    // Rule 10.9: "United States v. Alvarez" is Alvarez, never United States —
    // otherwise half a criminal brief's short cites are identical.
    expect(caseShortName("United States v. Alvarez")).toBe("Alvarez");
    expect(caseShortName("State v. Robinson")).toBe("Robinson");
    expect(caseShortName("Commissioner v. Banks")).toBe("Banks");
  });

  test("returns null for something with no parties", () => {
    expect(caseShortName("In re Bilski")).toBeNull();
    expect(caseShortName("35 U.S.C. § 101")).toBeNull();
  });
});

describe("finding every place an authority is cited", () => {
  const brief =
    "The Court held in Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014) that abstract " +
    "ideas are unpatentable. The two-step framework governs. Alice, 573 U.S. at 217. " +
    "Applying it here, the claims fail at step one. Alice, 573 U.S. at 221. " +
    "Id. at 223. See also Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66 (2012). " +
    "Mayo, 566 U.S. at 77. Id. at 79.";

  const marks = authoritiesForToa(brief);

  test("the brief has the two authorities we expect", () => {
    expect(marks.map((m) => m.name)).toEqual([
      "Alice Corp. v. CLS Bank Int'l",
      "Mayo Collaborative Servs. v. Prometheus Labs., Inc.",
    ]);
  });

  test("short forms are found, not just the full cite", () => {
    const occ = toaOccurrences(brief, marks);
    const alice = occ.filter((o) => marks[o.markIndex].name.startsWith("Alice"));
    // full + two "Alice, 573 U.S. at N" + one "Id. at 223"
    expect(alice).toHaveLength(4);
    expect(alice.map((o) => o.kind)).toEqual(["full", "short", "short", "id"]);
  });

  test("Id. attaches to the authority immediately before it", () => {
    const occ = toaOccurrences(brief, marks);
    const ids = occ.filter((o) => o.kind === "id");
    expect(ids).toHaveLength(2);
    // The first Id. follows an Alice short cite; the second follows a Mayo one.
    expect(marks[ids[0].markIndex].name).toContain("Alice");
    expect(marks[ids[1].markIndex].name).toContain("Mayo");
  });

  test("every occurrence is in document order", () => {
    const occ = toaOccurrences(brief, marks);
    const idx = occ.map((o) => o.index);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  test("the marked text is really present at the reported offset", () => {
    // Guards against an offset that looks right and points at the wrong place —
    // the field would be inserted into the middle of another sentence.
    const occ = toaOccurrences(brief, marks);
    for (const o of occ) {
      expect(brief.slice(o.index, o.index + o.text.length)).toBe(o.text);
    }
  });

  test("occurrences do not overlap", () => {
    const occ = toaOccurrences(brief, marks);
    for (let i = 1; i < occ.length; i++) {
      expect(occ[i].index).toBeGreaterThanOrEqual(occ[i - 1].index + occ[i - 1].text.length);
    }
  });
});

describe("Id. is never guessed at", () => {
  test("an Id. with no antecedent is dropped, not attributed", () => {
    const text = "Id. at 5. The Court in Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014) held.";
    const marks = authoritiesForToa(text);
    const occ = toaOccurrences(text, marks);
    // The leading Id. refers to something in a document we cannot see.
    expect(occ.filter((o) => o.kind === "id")).toHaveLength(0);
  });

  test("a bare Id. without a pincite still counts", () => {
    const text =
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014) is controlling. Id. The claims fail.";
    const marks = authoritiesForToa(text);
    const occ = toaOccurrences(text, marks);
    expect(occ.filter((o) => o.kind === "id")).toHaveLength(1);
  });

  test("Id. following a DIFFERENT authority follows that one", () => {
    const text =
      "See Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). " +
      "See also Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66 (2012). Id. at 71.";
    const marks = authoritiesForToa(text);
    const occ = toaOccurrences(text, marks);
    const id = occ.find((o) => o.kind === "id");
    expect(id).toBeDefined();
    expect(marks[id!.markIndex].name).toContain("Mayo");
  });
});

describe("no false positives", () => {
  test("a short cite for an authority not in the table is not invented", () => {
    const text = "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). Bilski, 561 U.S. at 601.";
    const marks = authoritiesForToa(text);
    const occ = toaOccurrences(text, marks);
    // Bilski was never cited in full here, so it is not an authority, and its
    // short form must not be attached to Alice.
    for (const o of occ) {
      expect(o.text).not.toContain("Bilski");
    }
  });

  test("a different case with the same first word is not swept in", () => {
    // "Alice, 573 U.S. at 217" must not match a cite to a different reporter.
    const text = "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). Alice, 999 F.3d at 12.";
    const marks = authoritiesForToa(text);
    const occ = toaOccurrences(text, marks);
    expect(occ.filter((o) => o.kind === "short")).toHaveLength(0);
  });

  test("an empty document yields nothing", () => {
    expect(toaOccurrences("", [])).toEqual([]);
  });
});
