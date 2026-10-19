// The citation register as plain text for the pane and the clipboard (toa.ts, moved out of taskpane.ts
// unchanged).
import { registerToText, CitationRegister, toaEntryKey } from "../toa";

const ALICE = "Alice Corp. v. CLS Bank Int’l, 573 U.S. 208 (2014)";
const KSR = "KSR Int’l Co. v. Teleflex Inc., 550 U.S. 398 (2007)";
const STATUTE = "35 U.S.C. § 101";

const REG: CitationRegister = {
  entries: [
    { plain: ALICE, category: "cases", heading: "Cases", count: 3 },
    { plain: KSR, category: "cases", heading: "Cases", count: 1 },
    { plain: STATUTE, category: "statutes", heading: "Statutes", count: 2 },
  ],
  authorities: 3,
  citations: 6,
  repeated: [],
};
REG.repeated = REG.entries.filter((e) => e.count > 1);

describe("registerToText", () => {
  it("lists repeats, then every authority under its heading, and asks for F9 when there are no pages", () => {
    expect(registerToText(REG, new Map())).toBe(
      [
        "Found 3 authorities in 6 citations. (build the field-based TOA and press F9, then Find again to see pages)",
        "",
        "Cited more than once (2):",
        `  ${ALICE}  ×3`,
        `  ${STATUTE}  ×2`,
        "",
        "All authorities:",
        "— Cases —",
        `  ${ALICE}  ×3`,
        `  ${KSR}  ×1`,
        "— Statutes —",
        `  ${STATUTE}  ×2`,
      ].join("\n"),
    );
  });

  it("adds a page wherever the built table has one, matched by toaEntryKey", () => {
    const pages = new Map([[toaEntryKey(ALICE), "3, 7"]]);
    const text = registerToText(REG, pages);
    expect(text.split("\n")[0]).toBe("Found 3 authorities in 6 citations.");
    expect(text).toContain(`  ${ALICE}  ×3  — p. 3, 7`);
    expect(text).toContain(`  ${KSR}  ×1\n`);
  });

  it("singular counts, and no repeats section when nothing is cited twice", () => {
    const one: CitationRegister = {
      entries: [{ plain: KSR, category: "cases", heading: "Cases", count: 1 }],
      authorities: 1,
      citations: 1,
      repeated: [],
    };
    const text = registerToText(one, new Map([["unrelated", "9"]]));
    expect(text).toBe(["Found 1 authority in 1 citation.", "", "All authorities:", "— Cases —", `  ${KSR}  ×1`].join("\n"));
  });
});
