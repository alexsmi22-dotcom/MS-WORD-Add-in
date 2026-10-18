/**
 * @jest-environment jsdom
 */
// Open ChemDraw file… over the pane's real markup: refusals by name, the page drawn, a click that
// picks a structure with its brackets, labels and charges, and the insert at ChemDraw's size.
import * as fs from "fs";
import * as path from "path";
import { TextDecoder as NodeTextDecoder } from "util";
import { initChemdrawPane, openChemdrawFile, chemdrawFit, ChemdrawHost } from "../../taskpane/chemdrawPane";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const BUILD = /<section id="build-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

// A polymer with a bracket on one bond (the bracket names that bond and its inner atom), its "n"
// beside it, a ⊕ representing an atom's charge, and a second structure far away.
const CDXML = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML CreationProgram="Test" BondLength="30" LineWidth="1" BoldWidth="4" HashSpacing="2.7" MarginWidth="2" BondSpacing="12" LabelSize="10" CaptionSize="12">
<fonttable><font id="3" name="Arial"/></fonttable>
<page id="1" BoundingBox="0 0 540 720">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="130 100"/><n id="13" p="160 100" Charge="1"/><b id="14" B="11" E="12"/><b id="15" B="12" E="13"/></fragment>
<graphic id="20" BoundingBox="115 90 115 110" GraphicType="Bracket" BracketType="Square"/>
<bracketedgroup id="21" BracketedObjectIDs="12"><bracketattachment id="22" GraphicID="20"><crossingbond id="23" BondID="14" InnerAtomID="12"/></bracketattachment></bracketedgroup>
<t id="24" p="117 118"><s font="3" size="10">n</s></t>
<graphic id="25" BoundingBox="160 88 152 88" GraphicType="Symbol" SymbolType="CirclePlus"><represent attribute="Charge" object="13"/></graphic>
<fragment id="30"><n id="31" p="400 600"/><n id="32" p="430 600"/><b id="33" B="31" E="32"/></fragment>
</page></CDXML>`;
const bytes = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "utf8"));

describe("opening a file", () => {
  test("a CDXML document opens", () => {
    const r = openChemdrawFile("figure.cdxml", bytes(CDXML));
    expect(r.ok && r.doc.objects.length).toBe(5);
  });
  test.each([
    ["figure.cdx", bytes("not a chemdraw file at all, just text"), "figure.cdx: it is not a ChemDraw CDX file (it does not start with VjCD0100)"],
    ["cut.cdx", bytes("VjCD0100\u0004\u0003\u0002\u0001"), "cut.cdx: it is not a ChemDraw CDX file (it does not start with VjCD0100)"],
    ["figure.mol", bytes("x"), "figure.mol: this opens ChemDraw files (.cdx and .cdxml)"],
    ["broken.cdxml", bytes("<CDXML><page>"), "broken.cdxml: it is not well-formed XML (line 1: <page> (line 1) is never closed)"],
    ["empty.cdxml", bytes('<CDXML><page id="1"/></CDXML>'), "empty.cdxml: the page has nothing drawn on it"],
  ])("%s is refused by name", (name, b, why) => {
    expect(openChemdrawFile(name, b)).toEqual({ ok: false, reason: why });
  });
  test("a binary ChemDraw file opens by its first bytes, whatever it is called (a USPTO drawing)", () => {
    const cdx = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "US12128110-C00013.cdx")));
    const r = openChemdrawFile("renamed.cdxml", cdx);
    expect(r.ok && r.doc.program).toBe("ChemDraw 12.0.2.1039");
    expect(openChemdrawFile("drawing.cdx", cdx).ok).toBe(true);
  });
});

describe("fitting a drawing on the page", () => {
  test("a structure goes in at ChemDraw's size; a wide one is fitted; one too large to read is refused", () => {
    expect(chemdrawFit(200, 100)).toEqual({ ok: true, k: 1, note: "It is inserted at ChemDraw's size." });
    expect(chemdrawFit(936, 100)).toEqual({ ok: true, k: 0.5, note: "It is inserted at 50 % to fit the page." });
    expect(chemdrawFit(1066, 8144)).toEqual({
      ok: false,
      reason: "that is 14.8 × 113.1 in — on a page it would be drawn at 8 %, too small to read. Select fewer structures (click one, Shift+click to add)",
    });
  });
});

describe("the pane", () => {
  function setup() {
    document.body.innerHTML = BUILD;
    const status: Array<[string, string]> = [];
    const inserted: Array<{ svg: string; w: number; h: number; alt: string }> = [];
    const host: ChemdrawHost = {
      setStatus: (m, k) => void status.push([m, k ?? ""]),
      insertPicture: async (svg, w, h, alt) => void inserted.push({ svg, w, h, alt }),
    };
    initChemdrawPane(host);
    const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
    // Open the file through the real input (FileReader + one timer tick).
    const open = async (): Promise<void> => {
      const input = $<HTMLInputElement>("chemdraw-file");
      const file = new File([CDXML], "figure.cdxml");
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 30));
    };
    /** A click at document point (x, y): the page SVG is laid out 1 px = 1 pt from its viewBox origin. */
    const clickAt = (x: number, y: number, shift = false): void => {
      const svg = $("chemdraw-preview").querySelector("svg")!;
      const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      $("chemdraw-preview").dispatchEvent(new MouseEvent("click", { clientX: x - vx, clientY: y - vy, shiftKey: shift, bubbles: true }));
    };
    const selectedBoxes = (): number => $("chemdraw-preview").querySelectorAll("#chemdraw-sel rect").length;
    return { status, inserted, $, open, clickAt, selectedBoxes };
  }

  test("the file opens on the page, as ChemDraw draws it, with a summary", async () => {
    const t = setup();
    await t.open();
    expect(t.$("chemdraw-panel").hidden).toBe(false);
    expect(t.$("chemdraw-preview").querySelector("svg")).not.toBeNull();
    expect(t.$("chemdraw-info").textContent).toBe("figure.cdxml: 2 structures and 3 other objects (made by Test).");
    expect(t.$<HTMLButtonElement>("chemdraw-insert").disabled).toBe(true);
  });

  test("a click on the polymer picks it with its bracket, its n and its ⊕ — not the far structure", async () => {
    const t = setup();
    await t.open();
    t.clickAt(140, 100);
    expect(t.selectedBoxes()).toBe(4);
    t.clickAt(115, 118, true); // Shift+click the n: it leaves the selection
    expect(t.selectedBoxes()).toBe(3);
    t.clickAt(300, 300); // empty paper clears it
    expect(t.selectedBoxes()).toBe(0);
  });

  test("Insert selected puts it in at ChemDraw's size, its alt text naming the file", async () => {
    const t = setup();
    await t.open();
    t.clickAt(140, 100);
    t.$<HTMLButtonElement>("chemdraw-insert").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.inserted).toHaveLength(1);
    expect(t.inserted[0].alt).toBe("ChemDraw drawing from figure.cdxml (4 objects).");
    expect(t.inserted[0].svg).toContain(">n</tspan>");
    expect(t.inserted[0].svg).not.toContain('x1="400"'); // the far structure stays out
    expect(t.status[t.status.length - 1]).toEqual(["Inserted 4 objects from figure.cdxml. It is inserted at ChemDraw's size.", "success"]);
  });

  test("a refused file leaves the panel closed and says why", async () => {
    const t = setup();
    const input = t.$<HTMLInputElement>("chemdraw-file");
    Object.defineProperty(input, "files", { value: [new File(["VjCD0100"], "x.cdx")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 30));
    expect(t.$("chemdraw-panel").hidden).toBe(true);
    expect(t.status[t.status.length - 1][1]).toBe("error");
  });
});

describe("editing on the page", () => {
  // A propane with a ChemDraw-computed name under it.
  const NAMED = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML CreationProgram="Test" BondLength="30" LineWidth="1" LabelSize="10" LabelFont="3" LabelFace="96" CaptionSize="12">
<fonttable><font id="3" name="Arial"/></fonttable>
<page id="1" BoundingBox="0 0 540 720">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="126 115"/><n id="13" p="152 100"/><b id="14" B="11" E="12"/><b id="15" B="12" E="13"/></fragment>
<t id="30" p="100 150" BoundingBox="100 140 150 153"><s font="3" size="12">propane</s></t>
<chemicalproperty id="31" ChemicalPropertyDisplayID="30" ChemicalPropertyType="1" BasisObjects="10"/>
</page></CDXML>`;
  function setup2() {
    document.body.innerHTML = BUILD;
    const status: Array<[string, string]> = [];
    const inserted: string[] = [];
    const saved: Array<{ name: string; text: Promise<string> }> = [];
    initChemdrawPane({
      setStatus: (m, k) => void status.push([m, k ?? ""]),
      insertPicture: async (svg) => void inserted.push(svg),
      downloadFile: (blob, name) =>
        void saved.push({
          name,
          text: new Promise<string>((res) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result));
            r.readAsText(blob);
          }),
        }),
    });
    const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
    const open = async (): Promise<void> => {
      const input = $<HTMLInputElement>("chemdraw-file");
      Object.defineProperty(input, "files", { value: [new File([NAMED], "propane.cdxml")], configurable: true });
      input.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 30));
    };
    const clickAt = (x: number, y: number): void => {
      const svg = $("chemdraw-preview").querySelector("svg")!;
      const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      $("chemdraw-preview").dispatchEvent(new MouseEvent("click", { clientX: x - vx, clientY: y - vy, bubbles: true }));
    };
    const tool = (t: string): void => document.querySelector<HTMLButtonElement>(`[data-cdx-tool="${t}"]`)!.click();
    const page = (): string => $("chemdraw-preview").innerHTML;
    return { status, inserted, saved, $, open, clickAt, tool, page };
  }

  test("Atom: N on the middle carbon shows NH; the name ChemDraw computed is outlined as out of date", async () => {
    const t = setup2();
    await t.open();
    t.tool("atom");
    t.$<HTMLInputElement>("chemdraw-value").value = "N";
    t.clickAt(126, 115);
    expect(t.page()).toContain(">NH</tspan>");
    expect(t.page()).toContain('id="chemdraw-stale"');
    expect(t.$("chemdraw-info").textContent).toContain("1 name ChemDraw computed is outlined in orange");
  });

  test("Inserting a structure with an out-of-date name says the name, by its words", async () => {
    const t = setup2();
    await t.open();
    t.tool("bond");
    t.clickAt(113, 107.5); // bond 11–12: single → double
    t.tool("select");
    t.clickAt(126, 110); // the structure, with its name beside it
    t.$<HTMLButtonElement>("chemdraw-insert").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.inserted).toHaveLength(1);
    expect(t.status[t.status.length - 1][0]).toMatch(/Check “propane”: ChemDraw computed that name before the structure changed\.$/);
  });

  test("Erase, Undo, Redo; Save writes a file ChemDraw opens, with the edit and nothing else lost", async () => {
    const t = setup2();
    await t.open();
    t.tool("erase");
    t.clickAt(152, 100); // the end atom
    expect(t.page()).not.toContain('x2="152"');
    t.$<HTMLButtonElement>("chemdraw-undo").click();
    expect(t.$<HTMLButtonElement>("chemdraw-redo").disabled).toBe(false);
    t.$<HTMLButtonElement>("chemdraw-redo").click();
    t.$<HTMLButtonElement>("chemdraw-save").click();
    expect(t.saved[0].name).toBe("propane (edited).cdxml");
    const text = await t.saved[0].text;
    expect(text).toMatch(/^<\?xml version="1.0" encoding="UTF-8" \?>/);
    expect(text).not.toContain('<n id="13"');
    expect(text).toContain('<chemicalproperty id="31"'); // its basis (the structure) is still there
  });

  test("a click that misses an atom says so; Atom with no label asks for one", async () => {
    const t = setup2();
    await t.open();
    t.tool("atom");
    t.clickAt(300, 300);
    expect(t.status[t.status.length - 1]).toEqual(["Click on an atom (a corner or end of the structure, or a label).", "error"]);
    t.clickAt(126, 115);
    expect(t.status[t.status.length - 1]).toEqual(["Type an element or label in the box first (N, O, Cl, R1, X …), then click the atom.", "error"]);
  });
});

describe("review D7: keys reach the ChemDraw page only when it has focus", () => {
  test("Backspace pressed elsewhere in the pane deletes nothing; on the page it deletes the selection", async () => {
    document.body.innerHTML = BUILD + '<input id="elsewhere">';
    initChemdrawPane({ setStatus: () => undefined, insertPicture: async () => undefined });
    const input = document.getElementById("chemdraw-file") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([CDXML], "figure.cdxml")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 30));
    const pv = document.getElementById("chemdraw-preview")!;
    const svg = pv.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    pv.dispatchEvent(new MouseEvent("click", { clientX: 400 - vx, clientY: 600 - vy, bubbles: true })); // the far structure
    expect(pv.querySelectorAll("#chemdraw-sel rect").length).toBe(1);
    document.getElementById("elsewhere")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(pv.innerHTML).toContain('x1="400"');
    pv.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(pv.innerHTML).not.toContain('x1="400"');
  });
});

describe("the Ring tool", () => {
  test("a click on empty paper places a benzene; on one of its bonds, a fused ring (naphthalene)", async () => {
    document.body.innerHTML = BUILD;
    initChemdrawPane({ setStatus: () => undefined, insertPicture: async () => undefined });
    const input = document.getElementById("chemdraw-file") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([CDXML], "figure.cdxml")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 30));
    const pv = document.getElementById("chemdraw-preview")!;
    const clickAt = (x: number, y: number): void => {
      const svg = pv.querySelector("svg")!;
      const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      pv.dispatchEvent(new MouseEvent("click", { clientX: x - vx, clientY: y - vy, bubbles: true }));
    };
    document.querySelector<HTMLButtonElement>('[data-cdx-tool="ring"]')!.click();
    expect((document.getElementById("chemdraw-ring") as HTMLSelectElement).disabled).toBe(false);
    clickAt(300, 400);
    const lines = (): number => pv.querySelectorAll("line").length;
    const after1 = lines();
    // A benzene: 6 bonds, 3 of them drawn as two lines (9 lines more than before).
    expect(after1).toBeGreaterThan(9);
    // Its bottom bond (between the two lowest atoms, around y = 415) gets a fused ring.
    clickAt(300, 415);
    expect(lines()).toBeGreaterThan(after1 + 5);
  });
});

describe("Open ChemDraw picture (a ChemDraw picture in the document)", () => {
  const cdx = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "US12128110-C00013.cdx")));
  const le32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  function emfWith(data: number[]): Uint8Array {
    const header = new Array(108).fill(0);
    header.splice(0, 8, ...le32(1), ...le32(108));
    header.splice(40, 4, 0x20, 0x45, 0x4d, 0x46);
    const body = data.length % 4 ? [...data, ...new Array(4 - (data.length % 4)).fill(0)] : data;
    const comment = [...le32(70), ...le32(12 + body.length), ...le32(data.length), ...body];
    return Uint8Array.from([...header, ...comment, ...le32(14), ...le32(20), ...new Array(8).fill(0), ...le32(20)]);
  }
  const opcOf = (emf: Uint8Array): string =>
    `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/media/image1.emf" pkg:contentType="image/x-emf"><pkg:binaryData>${Buffer.from(emf).toString("base64")}</pkg:binaryData></pkg:part></pkg:package>`;
  async function run(selection: string | null) {
    document.body.innerHTML = BUILD;
    const status: Array<[string, string]> = [];
    initChemdrawPane({ setStatus: (m, k) => void status.push([m, k ?? ""]), insertPicture: async () => undefined, readSelectionOoxml: async () => selection });
    document.getElementById("chemdraw-from-doc")!.click();
    await new Promise((r) => setTimeout(r, 10));
    return status;
  }
  test("the selected picture opens as its drawing", async () => {
    const status = await run(opcOf(emfWith([0x43, 0x44, 0x49, 0x46, 0, ...cdx])));
    expect(document.getElementById("chemdraw-panel")!.hidden).toBe(false);
    expect(document.getElementById("chemdraw-preview")!.innerHTML).toContain(">Gln</tspan>");
    expect(status[status.length - 1][1]).toBe("success");
  });
  test("nothing selected, or a picture not from ChemDraw: said by name", async () => {
    expect((await run(null)).pop()).toEqual(["Select a ChemDraw picture in the document first (click it), then Open ChemDraw picture.", "error"]);
    expect((await run(opcOf(emfWith([1, 2, 3])))).pop()).toEqual([
      "The selected picture holds no ChemDraw drawing — it was not pasted from ChemDraw, or it was saved as a plain image.",
      "error",
    ]);
  });
});

describe("Chain, Brackets, Arrow and Replace selected picture (C4)", () => {
  async function setup(replace?: (alt: string) => boolean) {
    document.body.innerHTML = BUILD;
    const status: Array<[string, string]> = [];
    const replaced: string[] = [];
    initChemdrawPane({
      setStatus: (m, k) => void status.push([m, k ?? ""]),
      insertPicture: async () => undefined,
      ...(replace ? { replacePicture: async (_svg: string, _w: number, _h: number, alt: string) => (replaced.push(alt), replace(alt)) } : {}),
    });
    const input = document.getElementById("chemdraw-file") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([CDXML], "figure.cdxml")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 30));
    const pv = document.getElementById("chemdraw-preview")!;
    const at = (x: number, y: number): { clientX: number; clientY: number } => {
      const svg = pv.querySelector("svg")!;
      const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      return { clientX: x - vx, clientY: y - vy };
    };
    /** A drag as the browser sends it: down, moves, up, then the click that follows. */
    const drag = (from: [number, number], to: [number, number]): void => {
      pv.dispatchEvent(new MouseEvent("pointerdown", { ...at(...from), button: 0, bubbles: true }));
      const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      pv.dispatchEvent(new MouseEvent("pointermove", { ...at(...mid), buttons: 1, bubbles: true }));
      expect(pv.querySelector("#chemdraw-ghost")).not.toBeNull(); // drawn live while dragging
      pv.dispatchEvent(new MouseEvent("pointermove", { ...at(...to), buttons: 1, bubbles: true }));
      pv.dispatchEvent(new MouseEvent("pointerup", { ...at(...to), bubbles: true }));
      pv.dispatchEvent(new MouseEvent("click", { ...at(...to), bubbles: true }));
    };
    const tool = (t: string): void => document.querySelector<HTMLButtonElement>(`[data-cdx-tool="${t}"]`)!.click();
    return { status, replaced, pv, drag, tool };
  }
  const last = (s: Array<[string, string]>): [string, string] => s[s.length - 1];

  test("Chain: a drag from an end atom grows a chain along it, one bond per step; the ghost goes on release", async () => {
    const t = await setup();
    t.tool("chain");
    const before = t.pv.querySelectorAll("line").length;
    t.drag([400, 600], [500, 600]);
    expect(last(t.status)).toEqual(["Chain of 4 bonds drawn.", "success"]);
    expect(t.pv.querySelectorAll("line").length).toBe(before + 4);
    expect(t.pv.querySelector("#chemdraw-ghost")).toBeNull();
    // A drag from empty paper starts a chain of its own; Undo takes it away again.
    t.drag([300, 300], [300, 360]);
    expect(t.pv.querySelectorAll("line").length).toBe(before + 6);
    (document.getElementById("chemdraw-undo") as HTMLButtonElement).click();
    expect(t.pv.querySelectorAll("line").length).toBe(before + 4);
  });

  test("Brackets: a box round one end of the far structure brackets it with n; a box round nothing is refused by name", async () => {
    const t = await setup();
    t.tool("bracket");
    expect((document.getElementById("chemdraw-value") as HTMLInputElement).disabled).toBe(false);
    t.drag([390, 590], [415, 610]);
    expect(last(t.status)).toEqual(["Brackets drawn round the repeat unit, labelled n.", "success"]);
    t.drag([250, 250], [300, 300]);
    expect(last(t.status)).toEqual(["No atom is inside the box — drag it round the repeat unit.", "error"]);
  });

  test("Arrow: reaction or equilibrium, by the list; a click with no drag says how", async () => {
    const t = await setup();
    t.tool("arrow");
    t.drag([200, 300], [300, 300]);
    expect(last(t.status)).toEqual(["Reaction arrow drawn.", "success"]);
    const sel = document.getElementById("chemdraw-arrow") as HTMLSelectElement;
    expect(sel.disabled).toBe(false);
    sel.value = "equilibrium";
    t.drag([200, 400], [300, 400]);
    expect(last(t.status)).toEqual(["Equilibrium arrow drawn.", "success"]);
    t.drag([200, 500], [201, 500]);
    expect(last(t.status)[1]).toBe("error");
  });

  test("Replace selected picture: the whole page (nothing selected) in place of the picture; no picture selected is said", async () => {
    let ok = false;
    const t = await setup(() => ok);
    const btn = document.getElementById("chemdraw-replace") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(last(t.status)).toEqual(["Select the picture to replace in the document first (click it; it must sit in line with the text), then Replace selected picture.", "error"]);
    ok = true;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.replaced[1]).toBe("ChemDraw drawing from figure.cdxml (the whole page).");
    expect(last(t.status)).toEqual(["Replaced the selected picture with the whole page from figure.cdxml. It is inserted at ChemDraw's size.", "success"]);
  });

  test("a drag ends cleanly: Escape mid-drag draws nothing; a move with no button held (a lost release) drops it", async () => {
    const t = await setup();
    t.tool("chain");
    const before = t.pv.querySelectorAll("line").length;
    t.pv.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    t.pv.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    t.pv.dispatchEvent(new MouseEvent("pointerup", { clientX: 200, clientY: 0, bubbles: true }));
    expect(t.pv.querySelectorAll("line").length).toBe(before);
    expect(t.pv.querySelector("#chemdraw-ghost")).toBeNull();
    t.tool("arrow");
    t.pv.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    t.pv.dispatchEvent(new MouseEvent("pointermove", { clientX: 100, clientY: 0, buttons: 0, bubbles: true }));
    t.pv.dispatchEvent(new MouseEvent("pointerup", { clientX: 100, clientY: 0, bubbles: true }));
    expect(t.pv.querySelectorAll("line").length).toBe(before);
  });

  test("a drag-tool release with no click after it does not swallow the next click", async () => {
    const t = await setup();
    t.tool("arrow");
    t.pv.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    t.pv.dispatchEvent(new MouseEvent("pointerup", { clientX: 0, clientY: 0, bubbles: true }));
    t.tool("select");
    const svg = t.pv.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    t.pv.dispatchEvent(new MouseEvent("pointerdown", { clientX: 415 - vx, clientY: 600 - vy, button: 0, bubbles: true }));
    t.pv.dispatchEvent(new MouseEvent("click", { clientX: 415 - vx, clientY: 600 - vy, bubbles: true }));
    expect((document.getElementById("chemdraw-insert") as HTMLButtonElement).disabled).toBe(false);
  });

  test("the box is emptied on a tool change: an Atom label never becomes a bracket label", async () => {
    const t = await setup();
    t.tool("atom");
    const v = document.getElementById("chemdraw-value") as HTMLInputElement;
    v.value = "Cl";
    t.tool("bracket");
    expect(v.value).toBe("");
    t.drag([390, 590], [415, 610]);
    expect(last(t.status)).toEqual(["Brackets drawn round the repeat unit, labelled n.", "success"]);
  });

  test("with no Word to replace in, the button stays off", async () => {
    await setup();
    expect((document.getElementById("chemdraw-replace") as HTMLButtonElement).disabled).toBe(true);
  });
});
