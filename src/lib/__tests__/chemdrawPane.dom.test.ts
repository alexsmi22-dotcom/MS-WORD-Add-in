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
    ["figure.cdx", bytes("VjCD0100\u0004\u0003\u0002\u0001"), "figure.cdx: binary ChemDraw files (.cdx) are not read yet — in ChemDraw, use File ▸ Save As ▸ ChemDraw XML (.cdxml) and open that"],
    ["figure.mol", bytes("x"), "figure.mol: this opens ChemDraw XML files (.cdxml)"],
    ["broken.cdxml", bytes("<CDXML><page>"), "broken.cdxml: it is not well-formed XML (line 1: <page> (line 1) is never closed)"],
    ["empty.cdxml", bytes('<CDXML><page id="1"/></CDXML>'), "empty.cdxml: the page has nothing drawn on it"],
  ])("%s is refused by name", (name, b, why) => {
    expect(openChemdrawFile(name, b)).toEqual({ ok: false, reason: why });
  });
  test("a binary file is refused by its first bytes, whatever it is called", () => {
    const r = openChemdrawFile("renamed.cdxml", bytes("VjCD0100rest"));
    expect(r.ok).toBe(false);
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
