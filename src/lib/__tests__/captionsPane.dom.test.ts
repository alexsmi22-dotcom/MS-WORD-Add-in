/**
 * @jest-environment jsdom
 */
// The Captions section's Word-fields half (src/taskpane/captionsPane.ts) over its real markup, with a fake document
// host: what goes into Word, what is remembered, and what is said when Word cannot (WordApi 1.4 / 1.5 missing).
import * as fs from "fs";
import * as path from "path";
import { initCaptionsPane, CAPTIONS_SETTING, CAPTIONS_MODE_SETTING, type CaptionsPaneHost } from "../../taskpane/captionsPane";

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="refs-section">[\s\S]*?<\/section>/.exec(HTML)![0];

function setup(o: { bookmarks?: "ok" | "unsupported"; update?: "updated" | "unsupported" | "failed"; settings?: Record<string, unknown> } = {}) {
  document.body.innerHTML = `<p id="status"></p>${SECTION}`;
  const settings = new Map<string, unknown>(Object.entries(o.settings ?? {}));
  const captionFlags: boolean[] = [];
  const inserted: string[] = [];
  const atSelection: string[] = [];
  let updates = 0;
  /** What each bookmark holds in the "document": set when a caption with that bookmark goes in. */
  const doc = new Map<string, string>();
  const status: Array<[string, string | undefined]> = [];
  const docHost: CaptionsPaneHost["docHost"] = {
    getSetting: (k) => (settings.get(k) as string) ?? null,
    setSetting: (k, v) => void settings.set(k, v),
    saveSettings: () => undefined,
    insertParagraphOoxmlAfter: async ({ ooxml, caption }) => {
      inserted.push(ooxml);
      captionFlags.push(!!caption);
      const bm = /w:name="(_Ref\d{9})"/.exec(ooxml)?.[1];
      const shown = /SEQ \w+ [^"]*"><w:r><w:t xml:space="preserve">(\d+)</.exec(ooxml)?.[1];
      if (bm && shown) doc.set(bm, shown);
    },
    insertAtSelection: async (s) => void atSelection.push(String((s as { content?: string }).content)),
    updateBodyFields: async () => {
      updates++;
      return o.update ?? "updated";
    },
    readBookmarkTexts: async (names) => (o.bookmarks === "unsupported" ? null : Object.fromEntries(names.map((n) => [n, doc.get(n) ?? null]))),
  };
  const pane = initCaptionsPane({ docHost, setStatus: (t, k) => void status.push([t, k]) });
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  return { pane, settings, inserted, captionFlags, atSelection, status, doc, $, updates: () => updates };
}
const last = (s: Array<[string, string | undefined]>) => s[s.length - 1];

describe("Captions with Word fields", () => {
  test("Word fields is the default: the cross-reference list shows, the typed-number row hides, the hint says Word numbers them", () => {
    const { $ } = setup();
    expect($<HTMLSelectElement>("ref-mode").value).toBe("fields");
    expect($("ref-xref-fields").hidden).toBe(false);
    expect($("ref-xref-text").hidden).toBe(true);
    expect($("ref-next").textContent).toBe("numbered by Word");
    expect($<HTMLSelectElement>("ref-xref-target").disabled).toBe(true);
  });
  test("a caption goes in with SEQ in a _Ref bookmark, is remembered, numbers update, and it can then be referred to", async () => {
    const t = setup();
    await t.pane.insertCaption("Figure", "Housing");
    expect(t.inserted).toHaveLength(1);
    expect(t.inserted[0]).toContain("SEQ Figure");
    expect(t.updates()).toBe(1);
    expect(last(t.status)[1]).toBe("success");
    const reg = JSON.parse(String(t.settings.get(CAPTIONS_SETTING)));
    expect(reg).toEqual([{ bookmark: expect.stringMatching(/^_Ref\d{9}$/), label: "Figure", text: "Housing" }]);
    await t.pane.insertCaption("Figure", "Gear");
    // The second shows 2 until Word updates it.
    expect(t.inserted[1]).toMatch(/SEQ Figure \\\* ARABIC "><w:r><w:t xml:space="preserve">2</);
    await t.pane.refresh();
    const opts = [...t.$<HTMLSelectElement>("ref-xref-target").options].map((o) => o.textContent);
    expect(opts).toEqual(["Figure 1 — Housing", "Figure 2 — Gear"]);
    t.$<HTMLSelectElement>("ref-xref-target").selectedIndex = 1;
    t.$<HTMLButtonElement>("ref-insert-xref-field").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.atSelection[0]).toMatch(/Fig\. .*REF _Ref\d{9} \\h /);
    expect(last(t.status)[0]).toMatch(/^Inserted Fig\. 2 — a Word cross-reference/);
  });
  test("a caption whose bookmark is gone (cut to be pasted, or deleted) is not offered — but kept, and offered again when it comes back", async () => {
    const t = setup();
    await t.pane.insertCaption("Table", "Data");
    const bm = JSON.parse(String(t.settings.get(CAPTIONS_SETTING)))[0].bookmark;
    t.doc.delete(bm);
    await t.pane.refresh();
    expect(JSON.parse(String(t.settings.get(CAPTIONS_SETTING)))).toHaveLength(1);
    expect(t.$<HTMLSelectElement>("ref-xref-target").options[0].textContent).toBe("Nothing numbered with Word fields yet");
    t.doc.set(bm, "1");
    await t.pane.refresh();
    expect(t.$<HTMLSelectElement>("ref-xref-target").options[0].textContent).toBe("Table 1 — Data");
  });
  test("a caption is inserted in the Caption style; a table of figures is not; saved text is trimmed and bounded", async () => {
    const t = setup();
    await t.pane.insertCaption("Figure", "   " + "x".repeat(300) + "  ");
    t.$<HTMLButtonElement>("ref-insert-tof").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.captionFlags).toEqual([true, false]);
    expect(JSON.parse(String(t.settings.get(CAPTIONS_SETTING)))[0].text).toBe("x".repeat(200));
  });
  test("the numbering is remembered per document; a document already numbered in plain text opens in Plain text", () => {
    const t = setup();
    t.$<HTMLSelectElement>("ref-mode").value = "text";
    t.$<HTMLSelectElement>("ref-mode").dispatchEvent(new Event("change"));
    expect(t.settings.get(CAPTIONS_MODE_SETTING)).toBe("text");
    expect(setup({ settings: { [CAPTIONS_MODE_SETTING]: "text" } }).$<HTMLSelectElement>("ref-mode").value).toBe("text");
    expect(setup({ settings: { "formula-inserter.refs": '{"figure":3}' } }).$<HTMLSelectElement>("ref-mode").value).toBe("text");
    expect(setup({ settings: { "formula-inserter.refs": '{"figure":3}', [CAPTIONS_MODE_SETTING]: "fields" } }).$<HTMLSelectElement>("ref-mode").value).toBe("fields");
  });
  test("the first field caption records the mode, so later plain counters cannot flip the document to Plain text on reopen", async () => {
    const t = setup();
    expect(t.settings.get(CAPTIONS_MODE_SETTING)).toBeUndefined();
    await t.pane.insertCaption("Figure", "Housing");
    expect(t.settings.get(CAPTIONS_MODE_SETTING)).toBe("fields");
    t.settings.set("formula-inserter.refs", '{"figure":1}');
    expect(setup({ settings: Object.fromEntries(t.settings) }).$<HTMLSelectElement>("ref-mode").value).toBe("fields");
  });
  test("a Word that refuses the update: the caption still goes in, and the status says so with the F9 advice (not overwritten by success)", async () => {
    const t = setup({ update: "failed" });
    await t.pane.insertCaption("Figure", "Housing");
    expect(t.inserted).toHaveLength(1);
    expect(last(t.status)[0]).toMatch(/^Figure caption inserted\. Word did not update the fields — select all .* F9 to renumber\.$/);
    expect(last(t.status)[1]).not.toBe("success");
    t.$<HTMLButtonElement>("ref-update").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(last(t.status)).toEqual([expect.stringMatching(/^Word did not update the fields/), "error"]);
    expect(await t.pane.afterEquation()).toMatch(/^ Word did not update the fields/);
    expect(await setup().pane.afterEquation()).toBe("");
  });
  test("chapter numbers: STYLEREF in the caption when the box is ticked", async () => {
    const t = setup();
    t.$<HTMLInputElement>("ref-chapter").checked = true;
    await t.pane.insertCaption("Figure", "x");
    expect(t.inserted[0]).toContain("STYLEREF 1 \\s");
    expect(last(t.status)[0]).toContain("(by chapter)");
  });
  test("an equation number is registered as an Equation and offered as Eq. (n)", async () => {
    const t = setup();
    const runs = await t.pane.equationNumber("E = mc^2", false);
    expect(runs).toContain("SEQ Equation");
    const bm = /w:name="(_Ref\d{9})"/.exec(runs!)![1];
    t.doc.set(bm, "1");
    await t.pane.refresh();
    expect(t.$<HTMLSelectElement>("ref-xref-target").options[0].textContent).toBe("Eq. (1) — E = mc^2");
  });
  test("a table of figures goes in and the fields update", async () => {
    const t = setup();
    t.$<HTMLSelectElement>("ref-tof-label").value = "Scheme";
    t.$<HTMLButtonElement>("ref-insert-tof").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.inserted[0]).toContain('TOC \\h \\z \\c &quot;Scheme&quot;');
    expect(last(t.status)).toEqual([expect.stringMatching(/^Table of schemes inserted/), "success"]);
  });
  test("Word without Field.updateResult: Update numbers says to press F9; without bookmarks: says to use Plain text or Word's own dialog", async () => {
    const t = setup({ update: "unsupported" });
    t.$<HTMLButtonElement>("ref-update").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(last(t.status)).toEqual([expect.stringMatching(/press F9 to renumber/), "error"]);
    const u = setup({ bookmarks: "unsupported" });
    u.settings.set(CAPTIONS_SETTING, JSON.stringify([{ bookmark: "_Ref000000001", label: "Figure", text: "" }]));
    await u.pane.refresh();
    expect(last(u.status)).toEqual([expect.stringMatching(/cannot read bookmarks .* Plain text numbering, or Word's own Insert ▸ Cross-reference/), "error"]);
  });
  test("Plain text mode: the typed-number row shows, the field controls are off", () => {
    const { $ } = setup();
    $<HTMLSelectElement>("ref-mode").value = "text";
    $<HTMLSelectElement>("ref-mode").dispatchEvent(new Event("change"));
    expect($("ref-xref-text").hidden).toBe(false);
    expect($("ref-xref-fields").hidden).toBe(true);
    expect($<HTMLButtonElement>("ref-update").disabled).toBe(true);
    expect($<HTMLButtonElement>("ref-insert-tof").disabled).toBe(true);
  });
});
