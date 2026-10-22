// The host operations behind Word-field captions (docs/SCOPE-CAPTIONS.md), against a small Word mock: the numbering
// fields (SEQ, STYLEREF) are updated before the REF and TOC fields that read them, and no other field is touched; a
// Word without the API set says so, a Word that refuses mid-way is "failed"; a deleted bookmark reads as null.
import { readBookmarkTexts, updateBodyFields } from "../wordDocument";
import { insertParagraphOoxmlAfter } from "../wordInsert";

type Field = { code: string; updateResult: () => void };
let supported: Record<string, boolean>;
let calls: string[];
let fields: Field[];
let bookmarks: Record<string, string>;
let para: { styleBuiltIn?: string };

beforeEach(() => {
  supported = { "1.3": true, "1.4": true, "1.5": true };
  calls = [];
  bookmarks = {};
  const mk = (code: string): Field => ({ code, updateResult: () => void calls.push(`update ${code.trim().split(/\s+/)[0]}`) });
  fields = [
    mk(" REF _Ref000000001 \\h "),
    mk(" SEQ Figure \\* ARABIC "),
    mk(" DATE \\@ \"d MMMM yyyy\" "),
    mk(' TOC \\h \\z \\c "Figure" '),
    mk(" STYLEREF 1 \\s "),
    mk(' ADDIN ZOTERO_ITEM CSL_CITATION {} '),
    mk(" SEQ Equation \\* ARABIC "),
    mk(" PAGEREF _Ref000000001 \\h "),
    mk(" NOTEREF _Ref000000002 \\h "),
  ];
  const range = {
    insertOoxml: (ooxml: string, loc: string) => void calls.push(`insertOoxml ${loc} ${ooxml.length > 0}`),
    select: (m: string) => void calls.push(`select ${m}`),
    insertContentControl: () => ({ tag: "", title: "" }),
  };
  para = { getRange: () => range } as unknown as { styleBuiltIn?: string };
  const context = {
    sync: async () => undefined,
    document: {
      body: { fields: { items: fields, load: () => undefined } },
      getSelection: () => ({
        insertParagraph: (text: string, loc: string) => {
          calls.push(`insertParagraph ${JSON.stringify(text)} ${loc}`);
          return para;
        },
      }),
      getBookmarkRangeOrNullObject: (n: string) => ({ isNullObject: !(n in bookmarks), text: bookmarks[n] ?? "", load: () => undefined }),
    },
  };
  (globalThis as unknown as { Word: unknown }).Word = {
    run: async (fn: (c: typeof context) => Promise<void>) => fn(context),
    InsertLocation: { after: "After", replace: "Replace" },
    SelectionMode: { end: "End" },
    BuiltInStyleName: { caption: "Caption", normal: "Normal" },
    ContentControlAppearance: { hidden: "Hidden" },
  };
  (globalThis as unknown as { Office: unknown }).Office = { context: { requirements: { isSetSupported: (_s: string, v: string) => !!supported[v] } } };
});

test("Update numbers: SEQ and STYLEREF first, then REF, PAGEREF and TOC — never a DATE, a NOTEREF or a citation manager's ADDIN field", async () => {
  expect(await updateBodyFields()).toBe("updated");
  expect(calls).toEqual(["update SEQ", "update STYLEREF", "update SEQ", "update REF", "update TOC", "update PAGEREF"]);
});

test("a Word without Field.updateResult (WordApi 1.5) is told apart, and nothing is called", async () => {
  supported["1.5"] = false;
  expect(await updateBodyFields()).toBe("unsupported");
  expect(calls).toEqual([]);
});

test("a Word that refuses mid-way is \"failed\", not \"unsupported\" and not a throw", async () => {
  fields[1].updateResult = () => {
    throw new Error("GeneralException");
  };
  expect(await updateBodyFields()).toBe("failed");
});

test("bookmark texts: the number as Word shows it; a deleted caption's bookmark is null; no WordApi 1.4 → null for the call", async () => {
  bookmarks = { _Ref000000001: "3", _Ref000000002: "2.1" };
  expect(await readBookmarkTexts(["_Ref000000001", "_Ref000000002", "_Ref000000003"])).toEqual({ _Ref000000001: "3", _Ref000000002: "2.1", _Ref000000003: null });
  supported["1.4"] = false;
  expect(await readBookmarkTexts(["_Ref000000001"])).toBeNull();
});

test("a caption: a new paragraph after the selection's, in Word's built-in Caption style, filled (Replace), caret at its end", async () => {
  await insertParagraphOoxmlAfter({ ooxml: "<pkg/>", tag: "formula-inserter:caption:figure", caption: true });
  expect(calls).toEqual(['insertParagraph "" After', "insertOoxml Replace true", "select End"]);
  expect(para.styleBuiltIn).toBe("Caption");
});

test("a table of figures: the same choreography, in Normal (not the heading the cursor was in)", async () => {
  await insertParagraphOoxmlAfter({ ooxml: "<pkg/>", tag: "formula-inserter:table-of-figures" });
  expect(calls).toEqual(['insertParagraph "" After', "insertOoxml Replace true", "select End"]);
  expect(para.styleBuiltIn).toBe("Normal");
});
