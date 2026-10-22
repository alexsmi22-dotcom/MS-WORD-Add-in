// Word-native captions, equation numbers, cross-references and a table of figures (docs/SCOPE-CAPTIONS.md): the
// OOXML JurisLab writes. Word itself cannot run in jest — what is pinned here is that the fields are Word's own
// (SEQ, STYLEREF, REF \h, TOC \c), the number sits in a hidden _Ref bookmark, and the registry is read with care.
// The Word check is docs/TEST-SCRIPT.md (renumbering on insert, move, delete, F9 / Update numbers).
import {
  captionOoxml,
  crossRefChoices,
  crossRefOoxml,
  equationNumberRuns,
  isRefBookmarkName,
  nextNumber,
  numberRuns,
  parseCaptionRegistry,
  refBookmarkName,
  tableOfFiguresOoxml,
} from "../captionFields";

const BM = refBookmarkName(123456789);
const docXml = (pkg: string): string => /<w:document[\s\S]*<\/w:document>/.exec(pkg)![0];

describe("captions with Word's fields", () => {
  test("a caption: Caption style, the label, a SEQ field inside a _Ref bookmark, then the text", () => {
    const d = docXml(captionOoxml({ label: "Figure", shown: 3, bookmark: BM }, "A widget & its <housing>"));
    expect(d).toMatch(/<w:pStyle w:val="Caption"\/>/);
    expect(d).toMatch(/<w:t xml:space="preserve">Figure <\/w:t>/);
    expect(d).toMatch(new RegExp(`<w:bookmarkStart w:id="\\d+" w:name="${BM}"/><w:fldSimple w:instr=" SEQ Figure \\\\\\* ARABIC "><w:r><w:t xml:space="preserve">3</w:t></w:r></w:fldSimple><w:bookmarkEnd w:id="\\d+"/>`));
    expect(d).toContain(". A widget &amp; its &lt;housing&gt;");
    // Start and end carry the same id.
    const ids = [...d.matchAll(/w:bookmark(?:Start|End) w:id="(\d+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });
  test("no caption text: the number alone; Table and Scheme labels; an equation is refused a caption", () => {
    expect(docXml(captionOoxml({ label: "Table", shown: 1, bookmark: BM }, "  "))).not.toMatch(/\. /);
    expect(docXml(captionOoxml({ label: "Scheme", shown: 2, bookmark: BM }, "x"))).toContain("SEQ Scheme \\* ARABIC");
    expect(() => captionOoxml({ label: "Equation", shown: 1, bookmark: BM }, "x")).toThrow(/beside the equation/);
  });
  test("chapter numbering: STYLEREF 1 \\s, a period, then SEQ restarted at each Heading 1 (\\s 1) — all in the bookmark", () => {
    const r = numberRuns({ label: "Figure", shown: 4, chapter: { shown: 2 }, bookmark: BM });
    expect(r).toMatch(/^<w:bookmarkStart [^>]+\/><w:fldSimple w:instr=" STYLEREF 1 \\s ">.*?<\/w:fldSimple><w:r><w:t xml:space="preserve">\.<\/w:t><\/w:r><w:fldSimple w:instr=" SEQ Figure \\\* ARABIC \\s 1 ">.*?<\/w:fldSimple><w:bookmarkEnd [^>]+\/>$/);
  });
  test("an equation number: (SEQ Equation) at the right of the equation, bookmarked for cross-references", () => {
    const r = equationNumberRuns({ shown: 5, bookmark: BM });
    expect(r).toMatch(/^<w:r><w:t xml:space="preserve">\(<\/w:t><\/w:r><w:bookmarkStart/);
    expect(r).toContain("SEQ Equation \\* ARABIC");
    expect(r).toMatch(/<w:bookmarkEnd [^>]+\/><w:r><w:t xml:space="preserve">\)<\/w:t><\/w:r>$/);
  });
  test("a cross-reference: the label written out, then REF to the bookmark with \\h (a link), the number shown", () => {
    const fig = docXml(crossRefOoxml("Figure", BM, "3"));
    expect(fig).toContain(`<w:t xml:space="preserve">Fig. </w:t>`);
    expect(fig).toContain(`<w:fldSimple w:instr=" REF ${BM} \\h "><w:r><w:t xml:space="preserve">3</w:t></w:r></w:fldSimple>`);
    const eq = docXml(crossRefOoxml("Equation", BM, "2.1"));
    expect(eq).toMatch(/Eq\. \(<\/w:t><\/w:r><w:fldSimple[^>]+>.*2\.1.*<\/w:fldSimple><w:r><w:t xml:space="preserve">\)</);
  });
  test("a table of figures: TOC \\h \\z \\c \"Figure\" (or Table, Scheme), saying how to update it", () => {
    const t = docXml(tableOfFiguresOoxml("Table"));
    expect(t).toContain('w:instr=" TOC \\h \\z \\c &quot;Table&quot; "');
    expect(t).toContain("to list the tables");
    expect(() => tableOfFiguresOoxml("Equation")).toThrow();
  });
  test("bad input is refused, never written: a non-whole number, a bookmark not in Word's _Ref form", () => {
    expect(() => numberRuns({ label: "Figure", shown: 0, bookmark: BM })).toThrow(/whole number/);
    expect(() => numberRuns({ label: "Figure", shown: 2.5, bookmark: BM })).toThrow(/whole number/);
    expect(() => numberRuns({ label: "Figure", shown: 1, bookmark: "Ref1" })).toThrow(/_Ref/);
    expect(() => crossRefOoxml("Figure", 'x" injected="1', "3")).toThrow(/_Ref/);
  });
  test("bookmark names: _Ref and nine digits, from any seed", () => {
    for (const s of [0, 1, 123456789, 9_999_999_999_999, -42]) expect(isRefBookmarkName(refBookmarkName(s))).toBe(true);
    expect(isRefBookmarkName("_Ref12")).toBe(false);
    expect(isRefBookmarkName("_Toc123456789")).toBe(false);
  });
});

describe("the cross-reference list: what the document holds now", () => {
  const A = refBookmarkName(1), B = refBookmarkName(2), C = refBookmarkName(3), D = refBookmarkName(4);
  test("the registry is read field by field: damaged entries and repeats dropped", () => {
    const reg = parseCaptionRegistry([
      { bookmark: A, label: "Figure", text: "Housing" },
      { bookmark: A, label: "Figure", text: "again" },
      { bookmark: "nope", label: "Figure", text: "" },
      { bookmark: B, label: "Picture", text: "" },
      { bookmark: C, label: "Equation", text: 42 },
      null,
      "x",
    ]);
    expect(reg).toEqual([
      { bookmark: A, label: "Figure", text: "Housing" },
      { bookmark: C, label: "Equation", text: "" },
    ]);
    expect(parseCaptionRegistry({ not: "an array" })).toEqual([]);
  });
  test("a deleted caption is not offered; the number is the bookmark's current text (Word's own); a bookmark not holding a number is not offered", () => {
    const reg = parseCaptionRegistry([
      { bookmark: A, label: "Figure", text: "Housing" },
      { bookmark: B, label: "Figure", text: "Gear" },
      { bookmark: C, label: "Equation", text: "E = mc^2" },
      { bookmark: D, label: "Table", text: "Data" },
    ]);
    const choices = crossRefChoices(reg, { [A]: "2", [B]: null, [C]: " 1.3 ", [D]: "Error! No text of specified style" });
    expect(choices.map((c) => [c.label, c.number])).toEqual([
      ["Figure", "2"],
      ["Equation", "1.3"],
    ]);
    expect(nextNumber(choices, "Figure")).toBe(2);
    expect(nextNumber(choices, "Table")).toBe(1);
  });
});
