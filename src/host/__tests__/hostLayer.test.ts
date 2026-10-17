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

// ---- the ratchet ---------------------------------------------------------------

const ROOT = path.join(__dirname, "..", "..", "..");
const PANE = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");
const count = (re: RegExp): number => (PANE.match(re) || []).length;

describe("the ratchet: document code only ever LEAVES the pane", () => {
  // A COUNT, not a list of names, like every other ratchet in this repo: a list
  // stops covering whatever is written after it. LOWER these as sites move —
  // the target is zero Word.run and the boot handshake for Office.
  // v2.144.0: 52 -> 29 Word.run (Kinds 1 and 2 moved to src/host).
  const WORD_RUN_MAX = 29;
  const WORD_REF_MAX = 153;
  const OFFICE_REF_MAX = 43;

  it(`taskpane.ts has at most ${WORD_RUN_MAX} Word.run batches`, () => {
    expect(count(/\bWord\.run\(/g)).toBeLessThanOrEqual(WORD_RUN_MAX);
  });
  it(`taskpane.ts names Word. at most ${WORD_REF_MAX} times and Office. at most ${OFFICE_REF_MAX}`, () => {
    expect(count(/\bWord\./g)).toBeLessThanOrEqual(WORD_REF_MAX);
    expect(count(/\bOffice\./g)).toBeLessThanOrEqual(OFFICE_REF_MAX);
  });
  it("the ratchet is TIGHT — a count that drops must be lowered here in the same change", () => {
    // Otherwise the slack lets a site move back into the pane unnoticed.
    expect(count(/\bWord\.run\(/g)).toBe(WORD_RUN_MAX);
    expect(count(/\bWord\./g)).toBe(WORD_REF_MAX);
    expect(count(/\bOffice\./g)).toBe(OFFICE_REF_MAX);
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
