/**
 * The host layer (docs/SCOPE-HOST-ADAPTER.md): its transactions, run against a
 * recording Word mock, and the ratchet that moves document code out of the pane.
 *
 * THE CHOREOGRAPHY TESTS PIN WHAT WAS MOVED. Each transaction left taskpane.ts
 * as an exact move: same calls, same order, same batch. The host-trace gate
 * (scripts/host-trace.js) proves that end to end through the real bundle; these
 * pin each transaction on its own, where a future edit to one method is
 * caught without a browser.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

// ---- a recording Word -------------------------------------------------------
//
// Every object is a Proxy: method calls and property sets are logged in order,
// with call results named #1, #2… in call order and property objects named by
// path. Values a read should return come from `reads`.

let log: string[];
let reads: Record<string, unknown>;
let next: number;
let throwOn: RegExp | null;

function obj(name: string): unknown {
  const store: Record<string, unknown> = {};
  return new Proxy(function () {} as object, {
    get(_t, k) {
      if (k === "__name") return name;
      if (k === "then" || typeof k === "symbol") return undefined;
      if (k in store) return store[k as string];
      const key = `${name}.${String(k)}`;
      if (key in reads) return reads[key];
      if (k === "sync") return () => { log.push(`${name}.sync()`); return Promise.resolve(); };
      if (k === "items") return (store.items = []); // an empty collection, as in an empty document
      return (store[k as string] = method(name, String(k)));
    },
    set(_t, k, v) {
      log.push(`set ${name}.${String(k)} = ${JSON.stringify(v)}`);
      store[k as string] = v;
      return true;
    },
  });
}

function method(parent: string, k: string): unknown {
  const p = `${parent}.${k}`;
  let asObj: unknown = null;
  const ensure = (): Record<string, unknown> => (asObj ??= obj(p)) as Record<string, unknown>;
  return new Proxy(function () {} as object, {
    apply(_t, _this, args: unknown[]) {
      const id = `#${next++}`;
      const shown = args.map((a) => (a && typeof a === "object" && "__name" in (a as object) ? (a as { __name: string }).__name : JSON.stringify(a)));
      log.push(`${id} = ${p}(${shown.join(", ")})`);
      if (throwOn && throwOn.test(p)) throw new Error(`mock refuses ${k}`);
      if (k === "load") return ensure();
      const r = reads[`${p}()`];
      return r !== undefined ? r : obj(id);
    },
    get(_t, k2) {
      if (k2 === "__name") return p;
      return ensure()[k2 as string];
    },
    set(_t, k2, v) {
      ensure()[k2 as string] = v;
      return true;
    },
  });
}

beforeEach(() => {
  log = [];
  reads = {};
  next = 1;
  throwOn = null;
  (globalThis as unknown as { Word: unknown }).Word = {
    run: async (cb: (c: unknown) => Promise<void>) => {
      log.push("RUN {");
      await cb(obj("ctx"));
      log.push("}");
    },
    InsertLocation: { replace: "Replace", after: "After", before: "Before", end: "End", start: "Start" },
    SelectionMode: { end: "End", start: "Start", select: "Select" },
    ContentControlAppearance: { hidden: "Hidden" },
    BuiltInStyleName: { heading2: "Heading2", caption: "Caption" },
  };
});

// Imported after the mock exists only in the sense that every Word read in the
// host happens at CALL time — nothing reads Word at module load (wordLocation).
import { wordHost } from "../word";
import { isMultiBlockOoxml } from "../wordShared";

describe("insertAtSelection: one batch, the caret where each site put it, the tag after the content syncs", () => {
  it("HTML replacing the selection, caret at the end of what was inserted", async () => {
    await wordHost.insertAtSelection({ kind: "html", content: "<b>x</b>", at: "replace", select: "inserted" });
    expect(log).toEqual([
      "RUN {",
      "#1 = ctx.document.getSelection()",
      '#2 = #1.insertHtml("<b>x</b>", "Replace")',
      '#3 = #2.select("End")',
      "ctx.sync()",
      "}",
    ]);
  });

  it("text AFTER the selection with the caret on the SELECTION range (insertPlainText), no tag", async () => {
    await wordHost.insertAtSelection({ kind: "text", content: "t", at: "after", select: "selection" });
    expect(log).toEqual(["RUN {", "#1 = ctx.document.getSelection()", '#2 = #1.insertText("t", "After")', '#3 = #1.select("End")', "ctx.sync()", "}"]);
  });

  it("OOXML with no caret move, then the hidden tagged control in a SECOND sync (two undo steps, as the status says)", async () => {
    await wordHost.insertAtSelection({ kind: "ooxml", content: "<pkg/>", at: "replace", select: null, tag: "formula-inserter:equation" });
    expect(log).toEqual([
      "RUN {",
      "#1 = ctx.document.getSelection()",
      '#2 = #1.insertOoxml("<pkg/>", "Replace")',
      "ctx.sync()",
      "#3 = #2.insertContentControl()",
      'set #3.tag = "formula-inserter:equation"',
      'set #3.title = "JurisLab"',
      'set #3.appearance = "Hidden"',
      "ctx.sync()",
      "}",
    ]);
  });

  it("a host without content controls keeps the content and does not fail the insert", async () => {
    throwOn = /insertContentControl$/;
    await expect(
      wordHost.insertAtSelection({ kind: "html", content: "h", at: "replace", select: "inserted", tag: "formula-inserter:citation" }),
    ).resolves.toBeUndefined();
    expect(log.filter((l) => l.startsWith("set "))).toEqual([]);
  });

  it("a refused insert REJECTS, so the pane's catch reports it (never a silent success)", async () => {
    throwOn = /insertHtml$/;
    await expect(wordHost.insertAtSelection({ kind: "html", content: "h", at: "replace", select: "inserted" })).rejects.toThrow(/refuses/);
  });
});

describe("the two paragraph transactions", () => {
  it("numeral list: heading then an empty paragraph, both BEFORE the selection; the table range is tagged", async () => {
    await wordHost.insertHeadedBlockBefore({ heading: "List", html: "<table/>", tag: "formula-inserter:numeral-list" });
    expect(log.slice(0, 7)).toEqual([
      "RUN {",
      "#1 = ctx.document.getSelection()",
      '#2 = #1.insertParagraph("List", "Before")',
      'set #2.styleBuiltIn = "Heading2"',
      '#3 = #1.insertParagraph("", "Before")',
      "#4 = #3.getRange()",
      '#5 = #4.insertHtml("<table/>", "Replace")',
    ]);
    expect(log).toContain("#6 = #5.insertContentControl()");
  });

  it("caption: Caption style, caret at the paragraph end, the PARAGRAPH range tagged", async () => {
    await wordHost.insertCaptionParagraph({ text: "Figure 1", tag: "formula-inserter:caption:figure" });
    expect(log.slice(0, 7)).toEqual([
      "RUN {",
      "#1 = ctx.document.getSelection()",
      '#2 = #1.insertParagraph("Figure 1", "After")',
      'set #2.styleBuiltIn = "Caption"',
      "#3 = #2.getRange()",
      '#4 = #3.select("End")',
      "ctx.sync()",
    ]);
    expect(log).toContain("#5 = #2.getRange()");
    expect(log).toContain("#6 = #5.insertContentControl()");
  });
});

describe("reads", () => {
  it("body text: one load, one sync", async () => {
    reads["ctx.document.body.text"] = "See Brown.";
    await expect(wordHost.readBodyText()).resolves.toBe("See Brown.");
    expect(log).toEqual(["RUN {", '#1 = ctx.document.body.load("text")', "ctx.sync()", "}"]);
  });

  it("paragraph texts, in order", async () => {
    reads["ctx.document.body.paragraphs.items"] = [{ text: "a" }, { text: "b" }];
    await expect(wordHost.readParagraphTexts()).resolves.toEqual(["a", "b"]);
  });

  it("a COLLAPSED cursor in a table: no tables in the range, so the parent table is read", async () => {
    reads["#1.tables.items"] = [];
    reads["#1.parentTableOrNullObject.isNullObject"] = false;
    reads["#1.parentTableOrNullObject.values"] = [["x", "y"], ["1", "2"]];
    await expect(wordHost.readTableUnderCursor()).resolves.toEqual({ values: [["x", "y"], ["1", "2"]] });
  });

  it("a DRAGGED selection: the range's own first table wins, and its values are loaded before the second sync", async () => {
    const table = obj("T0") as Record<string, unknown>;
    reads["#1.tables.items"] = [table];
    reads["#1.parentTableOrNullObject.isNullObject"] = false; // must NOT be preferred
    reads["T0.values"] = [["a"], ["1"]];
    await expect(wordHost.readTableUnderCursor()).resolves.toEqual({ values: [["a"], ["1"]] });
    const loadAt = log.indexOf('#4 = T0.load("values")');
    const syncs = log.map((l, i) => (l === "ctx.sync()" ? i : -1)).filter((i) => i >= 0);
    expect(loadAt).toBeGreaterThan(syncs[0]);
    expect(loadAt).toBeLessThan(syncs[1]);
    expect(log.some((l) => l.includes("parentTableOrNullObject.load(\"values\")"))).toBe(false);
  });

  it("no table anywhere: null, and the second sync never happens", async () => {
    reads["#1.tables.items"] = [];
    reads["#1.parentTableOrNullObject.isNullObject"] = true;
    await expect(wordHost.readTableUnderCursor()).resolves.toBeNull();
    expect(log.filter((l) => l === "ctx.sync()")).toHaveLength(1);
  });
});

describe("pictures (v2.145.0)", () => {
  it("one picture: insert after, width then height in POINTS, alt, caret on the selection, sync, then the tag", async () => {
    await wordHost.insertPictureAtSelection({ base64: "B64", widthPt: 120, heightPt: 90, alt: "a", selectAfter: true, tag: "formula-inserter:peptide" });
    expect(log.slice(0, 9)).toEqual([
      "RUN {",
      "#1 = ctx.document.getSelection()",
      '#2 = #1.insertInlinePictureFromBase64("B64", "After")',
      "set #2.width = 120",
      "set #2.height = 90",
      'set #2.altTextDescription = "a"',
      '#3 = #1.select("End")',
      "ctx.sync()",
      "#4 = #2.getRange()",
    ]);
  });

  it("no caret move and no tag when the site asked for neither (Solve's figure, the balance chart)", async () => {
    await wordHost.insertPictureAtSelection({ base64: "B", widthPt: 1, heightPt: 2, alt: "x", selectAfter: false });
    expect(log.some((l) => l.includes(".select("))).toBe(false);
    expect(log.some((l) => l.includes("getRange"))).toBe(false);
  });

  it("replace (v2.154.0): the first selected in-line picture replaced in place, then sized, alt, sync, tagged; true", async () => {
    reads["#1.inlinePictures.items"] = [obj("pic")];
    await expect(wordHost.replaceSelectedPicture({ base64: "B64", widthPt: 120, heightPt: 90, alt: "a", selectAfter: false, tag: "formula-inserter:chemdraw" })).resolves.toBe(true);
    expect(log.slice(0, 12)).toEqual([
      "RUN {",
      "#1 = ctx.document.getSelection()",
      '#2 = #1.inlinePictures.load("items")',
      "ctx.sync()",
      '#3 = pic.insertInlinePictureFromBase64("B64", "Replace")',
      "set #3.width = 120",
      "set #3.height = 90",
      'set #3.altTextDescription = "a"',
      "ctx.sync()",
      '#4 = #3.parentContentControlOrNullObject.load("tag")',
      "ctx.sync()",
      "#5 = #3.getRange()",
    ]);
  });

  it("replace inside JurisLab's own content control (a picture it inserted): no second, nested control", async () => {
    reads["#1.inlinePictures.items"] = [obj("pic")];
    reads["#3.parentContentControlOrNullObject.isNullObject"] = false;
    reads["#3.parentContentControlOrNullObject.tag"] = "formula-inserter:chemdraw";
    await wordHost.replaceSelectedPicture({ base64: "B64", widthPt: 1, heightPt: 1, alt: "a", selectAfter: false, tag: "formula-inserter:chemdraw" });
    expect(log.some((l) => l.includes("insertContentControl"))).toBe(false);
  });

  it("replace with no picture selected: false, and nothing is written", async () => {
    await expect(wordHost.replaceSelectedPicture({ base64: "B", widthPt: 1, heightPt: 2, alt: "x", selectAfter: false })).resolves.toBe(false);
    expect(log.some((l) => l.includes("insertInlinePicture") || l.startsWith("set "))).toBe(false);
  });

  it("result layout: each picture paragraph chains from RangeLocation.END, text from .after, and Word's count is returned", async () => {
    let n = 0;
    reads["ctx.document.body.inlinePictures.items"] = { get length() { return n; } };
    (globalThis as unknown as { Word: Record<string, unknown> }).Word.RangeLocation = { end: "End", after: "After", start: "Start" };
    // The count Word reports grows by one per picture call.
    const count = log.push.bind(log);
    log.push = (...a: string[]): number => {
      for (const l of a) if (l.includes("insertInlinePictureFromBase64")) n++;
      return count(...a);
    };
    const kept = await wordHost.insertResultLayout([
      { kind: "paragraph", text: "Line" },
      { kind: "picture", caption: "Fig 1", base64: "P1", widthPt: 10, heightPt: 20, alt: "one" },
      { kind: "picture", caption: "Fig 2", base64: "P2", widthPt: 10, heightPt: 20, alt: "two" },
    ]);
    expect(kept).toBe(2);
    const getRanges = log.filter((l) => l.includes(".getRange("));
    expect(getRanges).toEqual([
      '#3 = #2.getRange("End")', // the selection's end — the first anchor
      '#5 = #4.getRange("After")', // after a TEXT paragraph
      '#8 = #6.getRange("End")', // after a PICTURE paragraph
      '#11 = #9.getRange("End")',
    ]);
    // No sync between the first content call and the closing selection.
    const first = log.findIndex((l) => l.includes("insertParagraph"));
    const sel = log.findIndex((l) => l.includes('.select("End")'));
    expect(log.slice(first, sel)).not.toContain("ctx.sync()");
  });

  it("a figure's caption tail goes under the picture with the cursor after it, inside the same batch", async () => {
    (globalThis as unknown as { Word: Record<string, unknown> }).Word.RangeLocation = { end: "End", after: "After" };
    await wordHost.insertFigurePng({ base64: "P", widthPt: 5, heightPt: 6, alt: "f", tag: "formula-inserter:stats-chart", tail: { kind: "caption", text: "Legend" } });
    const runs = log.filter((l) => l === "RUN {").length;
    expect(runs).toBe(1);
    const i = log.findIndex((l) => l.includes('insertParagraph("Legend", "After")'));
    const tagAt = log.findIndex((l) => l.includes("set #") && l.includes(".tag ="));
    expect(tagAt).toBeGreaterThan(-1); // the tag is there at all…
    expect(i).toBeGreaterThan(tagAt); // …and the caption comes after it
    expect(log[log.length - 2]).toBe("ctx.sync()"); // insertFigure's closing sync
  });

  const withRange = (): void => {
    (globalThis as unknown as { Word: Record<string, unknown> }).Word.RangeLocation = { end: "End", after: "After", start: "Start" };
    (globalThis as unknown as { Word: Record<string, unknown> }).Word.Alignment = { right: "Right", centered: "Centered" };
    (globalThis as unknown as { Word: Record<string, unknown> }).Word.BuiltInStyleName = { normal: "Normal", heading2: "Heading2", caption: "Caption" };
  };

  it.each([
    ["table", { kind: "table" as const, html: "<table/>" }, ['#4 = #3.insertParagraph("", "After")', "#5 = #4.getRange()", '#6 = #5.insertHtml("<table/>", "Replace")']],
    ["line", { kind: "line" as const, text: "R1 = Me" }, ['#4 = #3.insertParagraph("R1 = Me", "After")', "#5 = #4.getRange()", '#6 = #5.select("End")']],
    ["none", null, ['#4 = #3.select("End")']],
  ])("the structure legend (%s) follows the picture's END, and the picture is tagged after the sync", async (_n, legend, expected) => {
    withRange();
    await wordHost.insertPictureWithLegend({ base64: "S", widthPt: 1, heightPt: 2, alt: "a", legend, tag: "formula-inserter:structure" });
    expect(log).toContain('#3 = #2.getRange("End")');
    for (const e of expected) expect(log).toContain(e);
    const sync = log.indexOf("ctx.sync()");
    expect(log.indexOf(expected[expected.length - 1])).toBeLessThan(sync);
    expect(log.slice(sync).some((l) => l.endsWith(".insertContentControl()"))).toBe(true);
  });

  it("the gallery chains each paragraph from the previous one's END, then selects once and syncs once", async () => {
    withRange();
    await wordHost.insertPictureParagraphs([
      { text: "R1 = ", base64: "A", widthPt: 1, heightPt: 1, alt: "a" },
      { text: "R2 = ", base64: "B", widthPt: 2, heightPt: 2, alt: "b" },
    ]);
    expect(log.filter((l) => l.includes(".getRange(")).every((l) => l.endsWith('.getRange("End")'))).toBe(true);
    expect(log.filter((l) => l === "ctx.sync()")).toHaveLength(1);
    expect(log).toContain('#5 = #4.insertParagraph("R2 = ", "After")'); // anchored on the first paragraph's END (#4)
  });

  it("an editable table with a label: centred Normal caption after the table, then the list clean-up", async () => {
    withRange();
    reads["#3.getCell()"] = undefined;
    await wordHost.insertEditableTable({ rows: [["x", "y"], ["1", "2"]], label: "FIG. 1" });
    const cap = log.findIndex((l) => l.includes('insertParagraph("FIG. 1", "After")'));
    expect(cap).toBeGreaterThan(log.findIndex((l) => l.includes(".insertTable(")));
    expect(log).toContain(`set #${log[cap].split(" ")[0].slice(1)}.alignment = "Centered"`);
    expect(log.some((l) => l.includes('.load("items")'))).toBe(true); // clearTableListFormatting ran
  });

  // v2.193.0 (xcutFixes2193): the editable table has its own grid (every row) and continues ONLY from supported points.
  const tableId = (): string => log.find((l) => l.includes(".insertTable("))!.split(" ")[0];

  it("an editable table: EVERY row (121, not the figure's 40), the label made by the TABLE, no .after anchor, Word's row count returned", async () => {
    withRange();
    const rows = [["Residue", "IMGT"], ...Array.from({ length: 120 }, (_, i) => ["A", String(i + 1)])];
    reads["#2.rowCount"] = 121; // the table (#2) as Word reports it
    const got = await wordHost.insertEditableTable({ rows, label: "VH: numbering" });
    expect(got).toBe(121);
    const t = tableId();
    expect(t).toBe("#2");
    expect(log.find((l) => l.includes(".insertTable("))).toMatch(/insertTable\(121, 2, "After", /);
    const cap = log.find((l) => l.endsWith(`= ${t}.insertParagraph("VH: numbering", "After")`))!;
    expect(cap).toBeDefined();
    const capId = cap.split(" ")[0];
    expect(log).toContain(`set ${capId}.alignment = "Centered"`);
    expect(log.some((l) => l.includes('getRange("After")'))).toBe(false);
    const end = log.find((l) => l.endsWith(`= ${capId}.getRange("End")`))!;
    expect(log.some((l) => l.endsWith(`= ${end.split(" ")[0]}.select("End")`))).toBe(true);
    // no band shading: only the header row is shaded
    expect(log.filter((l) => l.includes(".shadingColor =")).length).toBe(2);
  });

  it("an editable table without a label still puts the caret on a paragraph the TABLE made", async () => {
    withRange();
    await wordHost.insertEditableTable({ rows: [["x", "y"], ["1", "2"]], label: "" });
    expect(log.some((l) => l.endsWith(`= ${tableId()}.insertParagraph("", "After")`))).toBe(true);
    expect(log.some((l) => l.includes('getRange("After")'))).toBe(false);
  });

  it("Table → Chart's data table: a fresh paragraph at the picture's END inserts the table; the caret goes on the table's own paragraph", async () => {
    withRange();
    await wordHost.insertFigurePng({
      base64: "P",
      widthPt: 1,
      heightPt: 1,
      alt: "chart",
      tail: { kind: "tableChart", rows: () => [["a", "b"], ...Array.from({ length: 60 }, (_, i) => [String(i), "2"])], tag: "formula-inserter:tablechart" },
    });
    expect(log.some((l) => l.includes('getRange("After")'))).toBe(false);
    const ins = log.find((l) => l.includes(".insertTable("))!;
    expect(ins).toMatch(/insertTable\(61, 2, "After", /);
    const paraId = ins.split(" = ")[1].split(".")[0];
    expect(log.some((l) => l.startsWith(`${paraId} = `) && l.includes('.insertParagraph("", "After")'))).toBe(true);
    expect(log.some((l) => l.includes(`${tableId()}.insertParagraph("", "After")`))).toBe(true);
  });

  it("the PNG figure path returns how many pictures Word KEPT (0 = accepted and discarded)", async () => {
    withRange();
    reads["ctx.document.body.inlinePictures.items"] = [];
    await expect(wordHost.insertFigurePng({ base64: "P", widthPt: 1, heightPt: 1, alt: "f" })).resolves.toBe(0);
    let n = 0;
    reads["ctx.document.body.inlinePictures.items"] = { get length() { return n; } };
    const count = log.push.bind(log);
    log.push = (...a: string[]): number => {
      for (const l of a) if (l.includes("insertInlinePictureFromBase64")) n++;
      return count(...a);
    };
    await expect(wordHost.insertFigurePng({ base64: "P", widthPt: 1, heightPt: 1, alt: "f" })).resolves.toBe(1);
  });

  it("a picture table: the caption above, then the grid, each picture in its own cell (centred, sized, with alt text)", async () => {
    withRange();
    reads["#3.getCell()"] = undefined;
    await wordHost.insertPictureTable({
      rows: [["Compound", "Structure"], ["1", { base64: "AAAA", widthPt: 72, heightPt: 54, alt: "Compound 1" }]],
      label: "Table 1",
    });
    const pic = log.findIndex((l) => l.includes('insertInlinePictureFromBase64(') && l.includes('"Start"'));
    expect(pic).toBeGreaterThan(log.findIndex((l) => l.includes(".insertTable(")));
    const id = log[pic].split(" ")[0].slice(1);
    expect(log).toContain(`set #${id}.width = 72`);
    expect(log).toContain(`set #${id}.height = 54`);
    expect(log).toContain(`set #${id}.altTextDescription = "Compound 1"`);
    const cap = log.findIndex((l) => l.includes('insertParagraph("Table 1", "After")'));
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(cap).toBeLessThan(log.findIndex((l) => l.includes(".insertTable(")));
  });

  it("Table → Chart reads its rows INSIDE the batch, after the picture has synced (not when the insert began)", async () => {
    withRange();
    let readAt = -1;
    await wordHost.insertFigurePng({
      base64: "P",
      widthPt: 1,
      heightPt: 1,
      alt: "chart",
      tail: { kind: "tableChart", rows: () => { readAt = log.length; return [["a", "b"], ["1", "2"]]; }, tag: "formula-inserter:tablechart" },
    });
    expect(readAt).toBeGreaterThan(log.indexOf("ctx.sync()")); // after the picture's own sync
    expect(log.some((l) => l.includes(".insertTable("))).toBe(true);
  });

  describe("the vector route", () => {
    let svgResult: { status: string; error?: { message: string } };
    beforeEach(() => {
      withRange();
      svgResult = { status: "succeeded" };
      (globalThis as unknown as { Office: unknown }).Office = {
        CoercionType: { XmlSvg: "XmlSvg" },
        AsyncResultStatus: { Succeeded: "succeeded" },
        context: {
          requirements: { isSetSupported: () => false },
          document: {
            setSelectedDataAsync: (_s: string, _o: unknown, cb: (r: unknown) => void) => {
              log.push("OFFICE setSelectedDataAsync");
              cb(svgResult);
            },
          },
        },
      };
    });

    it("Word refusing the SVG returns a fallback reason and inserts nothing more", async () => {
      svgResult = { status: "failed", error: { message: "nope" } };
      const r = await wordHost.insertFigureVector({ svg: "<svg/>", widthPt: 1, heightPt: 1, alt: "v" });
      expect(r).toEqual({ fallback: "Word refused the vector picture (nope)", format: null });
      expect(log.filter((l) => l === "RUN {")).toHaveLength(1); // only the "before" listing
    });

    it("Word saying yes but no new picture can be found THROWS — never a PNG on top of a picture somewhere", async () => {
      reads["ctx.document.body.inlinePictures.items"] = []; // nothing new appeared
      await expect(wordHost.insertFigureVector({ svg: "<svg/>", widthPt: 1, heightPt: 1, alt: "v" })).rejects.toThrow(
        /Word reported the vector picture inserted, but/,
      );
    });
  });
});

describe("document-wide edits (v2.146.0)", () => {
  const withWord = (): void => {
    const W = (globalThis as unknown as { Word: Record<string, unknown> }).Word;
    W.RangeLocation = { end: "End", after: "After", start: "Start" };
    W.InsertLocation = { replace: "Replace", after: "After", before: "Before", end: "End", start: "Start" };
  };

  it("paragraph marks: one read, one insertText per marked paragraph (replace when renumbering), one closing sync", async () => {
    withWord();
    reads["ctx.document.body.paragraphs.items"] = [obj("P0"), obj("P1"), obj("P2")];
    reads["P1.text"] = "[0007] Old text";
    await wordHost.applyParagraphMarks([
      { index: 0, mark: "[0001]", removeExisting: false },
      { index: 1, mark: "[0002]", removeExisting: true },
      { index: 2, mark: "", removeExisting: false }, // skipped: no mark
    ]);
    expect(log).toEqual([
      "RUN {",
      '#1 = ctx.document.body.paragraphs.load("items/text")',
      "ctx.sync()",
      '#2 = P0.insertText("[0001] ", "Start")',
      '#3 = P1.insertText("[0002] Old text", "Replace")',
      "ctx.sync()",
      "}",
    ]);
  });

  it("Id.: when the pane's decision is null (no antecedent), NOTHING is written", async () => {
    withWord();
    reads["#3.text"] = "No authority here.";
    let seen = "";
    const inserted = await wordHost.replaceSelectionFromTextBefore((t) => { seen = t; return null; });
    expect(inserted).toBe(false);
    expect(seen).toBe("No authority here.");
    expect(log.some((l) => l.includes("insertHtml"))).toBe(false);
  });

  it("Id.: the decision runs between the read and the write, in ONE batch, and the insert is tagged", async () => {
    withWord();
    const inserted = await wordHost.replaceSelectionFromTextBefore(() => ({ html: "<i>Id.</i>", tag: "formula-inserter:citation" }));
    expect(inserted).toBe(true);
    expect(log.filter((l) => l === "RUN {")).toHaveLength(1);
    const read = log.findIndex((l) => l.includes('.load("text")'));
    const write = log.findIndex((l) => l.includes('insertHtml("<i>Id.</i>", "Replace")'));
    expect(write).toBeGreaterThan(read);
    expect(log.slice(write).some((l) => l.endsWith(".insertContentControl()"))).toBe(true);
  });

  it("field clean-up deletes only the matching fields and reports 0 (no second sync) when there are none", async () => {
    withWord();
    reads["ctx.document.body.fields.items"] = [obj("F0"), obj("F1")];
    reads["F0.code"] = ' TA \\l "Brown" \\c 1 ';
    reads["F1.code"] = " DATE ";
    await expect(wordHost.deleteBodyFields("citationMarks")).resolves.toBe(1);
    expect(log).toContain("#2 = F0.delete()");
    expect(log.some((l) => l.includes("F1.delete"))).toBe(false);
    log = [];
    next = 1;
    reads["F0.code"] = " DATE ";
    await expect(wordHost.deleteBodyFields("citationMarks")).resolves.toBe(0);
    expect(log.filter((l) => l === "ctx.sync()")).toHaveLength(1);
  });

  it("Insert citation: a plan refusal comes back BEFORE anything is inserted", async () => {
    withWord();
    const r = await wordHost.insertBibCitation({
      isNote: false,
      plan: (tag) => ({ ok: false, lines: [`refused (cursor tag ${tag})`] }),
      update: () => ({ rewriteAll: false, bibliography: "if-present" }),
    });
    expect(r).toEqual({ refused: ["refused (cursor tag null)"] }); // the empty document's cursor is in no control
    expect(log.some((l) => /insert(Text|Footnote|ContentControl)/.test(l))).toBe(false);
  });
});

describe("Office outside Word.run (v2.146.0)", () => {
  let saved: Array<unknown[]>;
  let dialogCb: ((r: unknown) => void) | null;
  let handlers: Record<string, (a?: unknown) => void>;
  beforeEach(() => {
    saved = [];
    dialogCb = null;
    handlers = {};
    (globalThis as unknown as { Office: unknown }).Office = {
      AsyncResultStatus: { Succeeded: "succeeded" },
      EventType: { DialogMessageReceived: "msg", DialogEventReceived: "evt" },
      context: {
        requirements: { isSetSupported: (_s: string, v: string) => v === "1.3" },
        ui: { displayDialogAsync: (_u: string, _o: unknown, cb: (r: unknown) => void) => { dialogCb = cb; } },
        document: {
          settings: {
            get: (k: string) => `value of ${k}`,
            set: (...a: unknown[]) => saved.push(["set", ...a]),
            saveAsync: (...a: unknown[]) => {
              saved.push(["save", a.length]);
              if (typeof a[0] === "function") (a[0] as (r: unknown) => void)({ status: "failed", error: { message: "disk" } });
            },
          },
        },
      },
    };
  });

  it("settings pass straight through; a save without a callback is fire-and-forget, as before", () => {
    expect(wordHost.getSetting("k")).toBe("value of k");
    wordHost.setSetting("k", "v");
    wordHost.saveSettings();
    expect(saved).toEqual([["set", "k", "v"], ["save", 0]]);
  });

  it("a failed save reports Office's own error to the pane", () => {
    let got: unknown = null;
    wordHost.saveSettings((r) => { got = r; });
    expect(got).toEqual({ succeeded: false, error: { message: "disk" } });
  });

  it("WordApi probe: the host's answer, and OPTIMISTIC (true) when the probe throws", () => {
    expect(wordHost.wordApiSupported("1.3")).toBe(true);
    expect(wordHost.wordApiSupported("1.5")).toBe(false);
    (globalThis as unknown as { Office: { context: { requirements: unknown } } }).Office.context.requirements = {
      isSetSupported: () => { throw new Error("no"); },
    };
    expect(wordHost.wordApiSupported("1.5")).toBe(true);
  });

  it("dialogs: failure hands back Office's error; messages carry the dialog; closing is its own event", () => {
    const got: string[] = [];
    wordHost.openDialog("x.html", { height: 1, width: 1 }, {
      failed: (e) => got.push(`failed:${e?.message}`),
      message: (arg, d) => { got.push(`msg:${(arg as { message: string }).message}`); d.close(); },
      closed: (code) => got.push(code === undefined ? "closed" : `closed:${code}`),
    });
    dialogCb!({ status: "failed", error: { message: "blocked" } });
    const dialog = { close: () => got.push("close()"), addEventHandler: (t: string, h: (a?: unknown) => void) => { handlers[t] = h; } };
    dialogCb!({ status: "succeeded", value: dialog });
    handlers.msg({ message: "hi" });
    handlers.evt();
    handlers.evt({ error: 12002 }); // the page failed to load: the code reaches the pane
    expect(got).toEqual(["failed:blocked", "msg:hi", "close()", "closed", "closed:12002"]);
  });
});

// ---- the ratchet ---------------------------------------------------------------

const ROOT = path.join(__dirname, "..", "..", "..");
const PANE = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");

describe("the end state: the pane holds no document code", () => {
  // The ratchet reached its target in v2.146.0 (docs/SCOPE-HOST-ADAPTER.md):
  //   v2.144.0  52 -> 29 Word.run (inserts at the selection, document reads)
  //   v2.145.0  29 -> 10 (pictures and figures, the vector route)
  //   v2.146.0  10 -> 0  (TOA, TOC, citations, numbering; settings, dialogs)
  // From here it is a WALL, not a count: in the pane's CODE (comments
  // stripped) there is no Word API at all, and Office appears only as the boot
  // handshake. Prose that mentions Word ("discarded by Word.") is not code.
  // Comments removed by TypeScript itself, not by a regex: a string such as
  // "…/*, OR/|/+…" opened a fake block comment for the regex stripper and
  // silently deleted the real code after it (independent review, v2.146.0).
  const code = ts.transpileModule(PANE, {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;

  it("the stripped pane is still the pane (self-check: known code from start, middle and end survives)", () => {
    for (const piece of ["Office.onReady((info) =>", "docHost.insertAtSelection(", "docHost.buildNativeToa()", "docHost.updateBibliography(store"]) {
      expect({ piece, present: code.includes(piece) }).toEqual({ piece, present: true });
    }
    expect(code.length).toBeGreaterThan(PANE.length * 0.4);
  });

  // The word boundary is built with new RegExp from a doubled backslash: a
  // literal backslash-b written through a shell once landed in this file as a
  // 0x08 control character, and the scan could never match anything.
  const B = String.fromCharCode(92) + "b";
  const wordRun = new RegExp(B + "Word\\.run\\(", "g");
  const wordApi = new RegExp(B + "Word\\.[A-Za-z_]+", "g");
  const officeApi = new RegExp(B + "Office\\.[A-Za-z_]+", "g");

  it("no Word.run, and no Word.* API, anywhere in taskpane.ts", () => {
    expect(code.match(wordRun) ?? []).toEqual([]);
    expect(code.match(wordApi) ?? []).toEqual([]);
  });
  it("Office only for the boot handshake: Office.onReady and Office.HostType", () => {
    const uses = [...new Set(code.match(officeApi) ?? [])].sort();
    expect(uses).toEqual(["Office.HostType", "Office.onReady"]);
  });
  it("the wall can fail: the same scans find Word and Office calls in the host", () => {
    const host = fs.readFileSync(path.join(ROOT, "src", "host", "wordInsert.ts"), "utf8");
    expect(host.match(wordRun)?.length).toBeGreaterThan(0);
    expect(host.match(wordApi)?.length).toBeGreaterThan(0);
    const office = fs.readFileSync(path.join(ROOT, "src", "host", "officeHost.ts"), "utf8");
    expect(office.match(officeApi)?.length).toBeGreaterThan(0);
  });
});

// fix2-plat item 3: a multi-paragraph package at the cursor goes in a paragraph of its own. Verified in real Word via
// COM (scratchpad com/cur.ps1): end of a Heading 1, mid body paragraph, list item, empty paragraph, table cell.
describe("a block of its own never joins the cursor's paragraph (fix2-plat)", () => {
  const MULTI = "<pkg><w:body><w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p></w:body></pkg>";
  const ONE = "<pkg><w:body><w:p><m:oMath/></w:p></w:body></pkg>";
  const setup = (para: { text: string; style?: string; list?: boolean }): void => {
    const W = (globalThis as unknown as { Word: Record<string, unknown> }).Word;
    W.RangeLocation = { end: "End", after: "After", start: "Start" };
    W.BuiltInStyleName = { normal: "Normal", heading2: "Heading2", caption: "Caption" };
    reads["#2.text"] = para.text;
    reads["#2.styleBuiltIn"] = para.style ?? "Normal";
    reads["#2.isListItem"] = !!para.list;
  };

  it("isMultiBlockOoxml: two paragraphs or any table is a block; one paragraph (an inline equation) is not", () => {
    expect(isMultiBlockOoxml(MULTI)).toBe(true);
    expect(isMultiBlockOoxml(ONE)).toBe(false);
    expect(isMultiBlockOoxml("<w:body><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body>")).toBe(true);
    expect(isMultiBlockOoxml("<w:body><w:p/><w:p/></w:body>")).toBe(true);
  });

  it("at the end of a Heading 1: a NEW Normal paragraph after it, the package in at its start", async () => {
    setup({ text: "Heading One", style: "Heading1" });
    await wordHost.insertAtSelection({ kind: "ooxml", content: MULTI, at: "after", select: "selection" });
    expect(log).toEqual([
      "RUN {",
      "#1 = ctx.document.getSelection()",
      "#2 = #1.paragraphs.getLast()",
      '#3 = #2.load("text,isListItem,styleBuiltIn")',
      "ctx.sync()",
      '#4 = #2.insertParagraph("", "After")',
      'set #4.styleBuiltIn = "Normal"',
      '#5 = #4.getRange("Start")',
      `#6 = #5.insertOoxml(${JSON.stringify(MULTI)}, "After")`,
      '#7 = #1.select("End")',
      "ctx.sync()",
      "}",
    ]);
  });

  it("in a list item: the new paragraph is taken out of the list", async () => {
    setup({ text: "Item one", style: "ListParagraph", list: true });
    await wordHost.insertAtSelection({ kind: "ooxml", content: MULTI, at: "after", select: "selection" });
    expect(log).toContain("#5 = #4.detachFromList()");
    expect(log).toContain('set #4.styleBuiltIn = "Normal"');
  });

  it("in an empty plain paragraph: inserted where the cursor is, no new paragraph (no blank line)", async () => {
    setup({ text: "" });
    await wordHost.insertAtSelection({ kind: "ooxml", content: MULTI, at: "after", select: "selection" });
    expect(log.some((l) => l.includes("insertParagraph"))).toBe(false);
    expect(log).toContain('#4 = #1.getRange("End")');
    expect(log.some((l) => l.includes("styleBuiltIn ="))).toBe(false);
  });

  it("in an empty Heading paragraph: that paragraph is made Normal, the package goes in there", async () => {
    setup({ text: " ", style: "Heading1" });
    await wordHost.insertAtSelection({ kind: "ooxml", content: MULTI, at: "after", select: "selection" });
    expect(log).toContain('set #2.styleBuiltIn = "Normal"');
    expect(log.some((l) => l.includes("insertParagraph"))).toBe(false);
  });

  it("a ONE-paragraph package (an equation typed mid-sentence) stays inline: no paragraph read at all", async () => {
    setup({ text: "Heading One", style: "Heading1" });
    await wordHost.insertAtSelection({ kind: "ooxml", content: ONE, at: "after", select: "selection" });
    expect(log).toEqual(["RUN {", "#1 = ctx.document.getSelection()", `#2 = #1.insertOoxml(${JSON.stringify(ONE)}, "After")`, '#3 = #1.select("End")', "ctx.sync()", "}"]);
  });

  it("ownParagraph (the Characterization text): one paragraph, still its own", async () => {
    setup({ text: "Heading One", style: "Heading1" });
    await wordHost.insertAtSelection({ kind: "ooxml", content: ONE, at: "after", select: "selection", ownParagraph: true });
    expect(log).toContain('#4 = #2.insertParagraph("", "After")');
  });

  it("a REPLACE of a real selection still replaces what the user selected", async () => {
    setup({ text: "Heading One", style: "Heading1" });
    reads["#1.isEmpty"] = false;
    await wordHost.insertAtSelection({ kind: "ooxml", content: MULTI, at: "replace", select: null });
    expect(log.some((l) => l.includes("insertParagraph"))).toBe(false);
    expect(log).toContain(`#3 = #1.insertOoxml(${JSON.stringify(MULTI)}, "Replace")`);
  });

  it("insertResultLayout: the package goes in the new paragraph, the rest chains as before", async () => {
    setup({ text: "Heading One", style: "Heading1" });
    // #1 inlinePictures.load … the selection is #2 here: re-key the paragraph reads.
    reads["#4.text"] = "Heading One";
    reads["#4.styleBuiltIn"] = "Heading1";
    reads["#4.isListItem"] = false;
    await wordHost.insertResultLayout([{ kind: "ooxml", ooxml: MULTI }]);
    const ins = log.filter((l) => /insertParagraph|insertOoxml|getRange\("Start"\)/.test(l));
    expect(ins).toEqual(['#6 = #4.insertParagraph("", "After")', '#7 = #6.getRange("Start")', `#8 = #7.insertOoxml(${JSON.stringify(MULTI)}, "After")`]);
  });
});

describe("the host layer obeys the pane's source rules", () => {
  const hostDir = path.join(ROOT, "src", "host");
  const files = fs.readdirSync(hostDir).filter((f) => f.endsWith(".ts"));
  it.each(files)("%s carries no regex lookbehind (a SyntaxError blanks the pane on old WebKit)", (f) => {
    expect(fs.readFileSync(path.join(hostDir, f), "utf8")).not.toMatch(/\(\?<[=!]/);
  });
  it.each(files)("%s is LF-only (source-reading tests and the QC tree assume it)", (f) => {
    expect(fs.readFileSync(path.join(hostDir, f), "utf8")).not.toContain("\r");
  });
  it("host.ts, the interface, names no Office.js type: the pane must not need one to call it", () => {
    const code = fs
      .readFileSync(path.join(hostDir, "host.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(Word|Office)\./);
  });
});
