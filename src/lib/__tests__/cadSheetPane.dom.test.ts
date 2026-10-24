/**
 * @jest-environment jsdom
 */
// R2b in the Drawing (CAD) pane over its real markup: choosing a sheet, the title
// block, layers, line types, the fitted insert and the true-size SVG.
import * as fs from "fs";
import * as path from "path";
import { initCadPane, CadPaneHost, modelFromAlt } from "../../taskpane/cadPane";
import { parseDoc, starterDoc, CadDoc } from "../cadShapes";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];
const PX = 96 / 25.4;

function setup(initial?: CadDoc) {
  document.body.innerHTML = SECTION;
  const inserted: Array<{ w: number; h: number; alt: string }> = [];
  const downloads: Array<{ blob: Blob; name: string }> = [];
  const host: CadPaneHost = {
    setStatus: jest.fn(),
    nextNumeral: () => 10,
    insertPicture: jest.fn(async (_svg: string, w: number, h: number, alt: string) => {
      inserted.push({ w, h, alt });
    }),
    readSelectedAlt: async () => null,
    downloadFile: jest.fn((blob: Blob, name: string) => {
      downloads.push({ blob, name });
    }),
  };
  const pane = initCadPane(host, initial ?? starterDoc("iso"));
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const pick = (id: string, v: string): void => {
    const s = $<HTMLSelectElement>(id);
    s.value = v;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const field = (id: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`#cad-titleblock input[data-field="${id}"]`)!;
  const typeField = (id: string, v: string): void => {
    const f = field(id);
    f.value = v;
    f.dispatchEvent(new Event("input", { bubbles: true }));
    jest.advanceTimersByTime(300);
  };
  const doc = (): CadDoc => {
    const r = parseDoc(pane.getDoc());
    if (!r.ok) throw new Error(r.reason);
    return r.doc;
  };
  return { pane, host, inserted, downloads, $, pick, field, typeField, doc };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("choosing a sheet", () => {
  it("ISO offers A4 to A0; A3 frames the drawing, says so, and opens the ISO 7200 title block", () => {
    const t = setup();
    const opts = Array.from(t.$<HTMLSelectElement>("cad-sheet").options).map((o) => o.value);
    expect(opts).toEqual(["", "A4", "A3", "A2", "A1", "A0"]);
    t.pick("cad-sheet", "A3");
    expect(t.$("cad-preview").innerHTML).toContain('data-layer="frame"');
    expect(t.$("cad-msg").textContent).toMatch(/on an A3 sheet \(420 × 297 mm\)\./);
    expect(t.$("cad-msg").textContent).toContain("ISO 7200 asks the title block for: Legal owner, Title, Identification number, Date of issue, Sheet, Created by, Approved by, Document type.");
    expect(t.$("cad-titleblock-wrap").hidden).toBe(false);
    expect(t.field("number").maxLength).toBe(16);
    expect(t.doc().sheet).toEqual({ size: "A3" });
  });
  it("typing a field redraws the sheet with it once typing pauses, and it travels in the model", () => {
    const t = setup();
    t.pick("cad-sheet", "A3");
    t.typeField("title", "Bracket");
    expect(t.$("cad-preview").innerHTML).toContain(">Bracket</text>");
    expect(t.doc().sheet!.title).toEqual({ title: "Bracket" });
  });
  it("a field the block cannot hold is refused by name and Insert stays off", () => {
    const t = setup(starterDoc("asme"));
    t.pick("cad-sheet", "ANSI-B");
    t.typeField("cage", "12");
    expect(t.$("cad-msg").textContent).toBe("A CAGE code is five letters or digits.");
    expect(t.$<HTMLButtonElement>("cad-insert").disabled).toBe(true);
  });
  it("switching to USPTO takes the sheet off with the 1.84(g) reason; back on ISO, the title block comes back", () => {
    const t = setup();
    t.pick("cad-sheet", "A3");
    t.typeField("owner", "Caldwell");
    t.pick("cad-standard", "uspto");
    expect(t.host.setStatus).toHaveBeenLastCalledWith("The A3 sheet was taken off: 37 CFR 1.84(g): a patent drawing sheet must not have a frame around the sight, so it has no sheet format.", "");
    expect(t.doc().sheet).toBeUndefined();
    expect(t.$<HTMLSelectElement>("cad-sheet").disabled).toBe(true);
    t.pick("cad-standard", "iso");
    t.pick("cad-sheet", "A2");
    expect(t.field("owner").value).toBe("Caldwell");
  });
  it("ANSI A offers vertical; B does not", () => {
    const t = setup(starterDoc("asme"));
    t.pick("cad-sheet", "ANSI-A");
    expect(t.$("cad-orient").hidden).toBe(false);
    t.pick("cad-orient", "portrait");
    expect(t.doc().sheet).toEqual({ size: "ANSI-A", orientation: "portrait" });
    t.pick("cad-sheet", "ANSI-B");
    expect(t.$("cad-orient").hidden).toBe(true);
  });
});

describe("layers and line types", () => {
  it("a layer switched off leaves the preview, is saved with the model, and comes back with it", () => {
    const t = setup();
    t.pick("cad-sheet", "A3");
    const frameBox = document.querySelector<HTMLInputElement>('#cad-layers input[value="frame"]')!;
    frameBox.checked = false;
    frameBox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(t.$("cad-preview").innerHTML).not.toContain('data-layer="frame"');
    expect(t.doc().layers).toEqual({ frame: false });
    const again = setup(t.doc());
    expect(document.querySelector<HTMLInputElement>('#cad-layers input[value="frame"]')!.checked).toBe(false);
    expect(again.$("cad-preview").innerHTML).not.toContain('data-layer="frame"');
  });
  it("the line types are listed with their standard designation, width and pattern", () => {
    setup();
    const text = document.getElementById("cad-linetypes")!.textContent!;
    expect(text).toContain("Hidden lines — ISO 128-20 type 02 (narrow): 0.25 mm, pattern 3 · 0.75 mm");
    expect(text).toContain("Centre lines — ISO 128-20 type 04 (narrow): 0.25 mm, pattern 6 · 0.75 · 0.13 · 0.75 mm");
    expect(text).toContain("Frame — ISO 5457 frame, 0.7 mm: 0.7 mm, continuous");
  });
});

describe("into Word, and out at true size", () => {
  it("an A3 sheet inserts fitted to the page, and the status and alt text say what the scale then means", async () => {
    const t = setup();
    t.pick("cad-sheet", "A3");
    await t.pane.insert();
    await flush();
    const ins = t.inserted[0];
    expect(ins.w / PX).toBeCloseTo(159, 1);
    expect(ins.alt).toMatch(/The A3 sheet is inserted at 38 % to fit the page; SCALE \d+:\d+ holds when it is printed on A3\. Model: /);
    expect(t.host.setStatus).toHaveBeenLastCalledWith(expect.stringMatching(/^Drawing inserted — .*The A3 sheet is inserted at 38 %/), "success");
    // Edit drawing at cursor reads the model back from that alt text.
    const back = parseDoc(modelFromAlt(ins.alt)!);
    expect(back.ok && back.doc.sheet).toEqual({ size: "A3" });
  });
  it("an unframed ASME drawing (254 mm wide) is fitted too; a patent sheet wider than the column is fitted with its lettering kept ≥ 3.2 mm", async () => {
    const t = setup(starterDoc("asme"));
    await t.pane.insert();
    await flush();
    expect(t.inserted[0].w / PX).toBeCloseTo(159, 1);
    expect(t.inserted[0].alt).toMatch(/The drawing is inserted at 63 % to fit the page; SCALE \S+ holds at full size \(254 mm wide\)\./);
    const u = setup(starterDoc("uspto"));
    await u.pane.insert();
    await flush();
    // fix2-cad: the 170 mm USPTO sight overflowed Word's 159 mm column (A4, 1-inch margins); now fitted and said.
    expect(u.inserted[0].w / PX).toBeLessThanOrEqual(159 + 0.1);
    expect(u.inserted[0].alt).toMatch(/The patent sheet is inserted at \d+ % to fit the page's text column; its lettering stays at least 3\.2 mm high/);
    expect(u.inserted[0].alt).not.toMatch(/SCALE/);
  });
  it("a title block field reading 'Model: …' does not break re-opening the drawing", async () => {
    const t = setup();
    t.pick("cad-sheet", "A3");
    t.typeField("subtitle", "Model: X");
    await t.pane.insert();
    await flush();
    const back = parseDoc(modelFromAlt(t.inserted[0].alt)!);
    expect(back.ok && back.doc.sheet?.title?.subtitle).toBe("Model: X");
  });
  it("Save sheet gives the SVG at its true printed size, named after the drawing number and sheet", async () => {
    const t = setup();
    t.pick("cad-sheet", "A3");
    t.typeField("number", "CE-1");
    t.$<HTMLButtonElement>("cad-svg").click();
    const d = t.downloads[0];
    expect(d.name).toBe("CE-1-A3.svg");
    // jsdom's Blob has no text(): read it as a browser would.
    const text = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsText(d.blob);
    });
    expect(text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="420mm" height="297mm" viewBox=/);
  });
});

describe("R2b review — the pane findings pinned", () => {
  const docWith = (std: string, sheet: unknown): string => {
    const d = JSON.parse(JSON.stringify(starterDoc(std as never)));
    d.sheet = sheet;
    return JSON.stringify(d);
  };
  it("B1: loading a model whose sheet size is __proto__ (or constructor) is refused by name, not a crash", () => {
    const t = setup();
    const before = t.pane.getDoc();
    expect(t.pane.load(docWith("iso", { size: "__proto__" }))).toBe("the drawing names a sheet size this release does not have");
    expect(t.pane.load(docWith("iso", { size: "constructor" }))).toBe("the drawing names a sheet size this release does not have");
    expect(t.pane.getDoc()).toBe(before);
  });
  it("D1: title block fields typed for one drawing never reappear in another loaded drawing", () => {
    const t = setup();
    t.pick("cad-sheet", "A3");
    t.typeField("number", "SECRET-1");
    t.pick("cad-sheet", "");
    expect(t.pane.load(JSON.stringify(starterDoc("iso")))).toBeNull();
    t.pick("cad-sheet", "A2");
    expect(t.field("number").value).toBe("");
  });
  it("D9: a model carrying a sheet its standard cannot draw is refused at load, so the pane is never stuck with it", () => {
    const t = setup();
    expect(t.pane.load(docWith("iso", { size: "ANSI-B" }))).toMatch(/^the drawing's B sheet does not suit its standard/);
    expect(t.pane.load(docWith("uspto", { size: "A3" }))).toMatch(/^the drawing's A3 sheet does not suit its standard \(37 CFR 1\.84\(g\)/);
  });
});
