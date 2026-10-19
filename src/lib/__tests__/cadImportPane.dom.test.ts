/**
 * @jest-environment jsdom
 */
// R3a in the Drawing (CAD) pane over its real markup: Import DXF… → read, units, preview,
// insert as a picture, or open as a new part's sketch (here, or in the large window).
import * as fs from "fs";
import * as path from "path";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "util";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { starterDoc } from "../cadShapes";
import { IMPORTED_ALT_PREFIX } from "../dxfImport";
import { parseSketch } from "../sketchDoc";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];
const PX = 96 / 25.4;

/** A rectangle 2 × 1 drawing units, with or without $INSUNITS. */
const rectDxf = (units?: number): string => {
  const p = (c: number, v: string | number): string => `${c}\r\n${v}\r\n`;
  const line = (x1: number, y1: number, x2: number, y2: number): string => p(0, "LINE") + p(8, "0") + p(10, x1) + p(20, y1) + p(11, x2) + p(21, y2);
  return (
    (units === undefined ? "" : p(0, "SECTION") + p(2, "HEADER") + p(9, "$INSUNITS") + p(70, units) + p(0, "ENDSEC")) +
    p(0, "SECTION") + p(2, "ENTITIES") +
    line(0, 0, 2, 0) + line(2, 0, 2, 1) + line(2, 1, 0, 1) + line(0, 1, 0, 0) +
    p(0, "ENDSEC") + p(0, "EOF")
  );
};

function setup(extra: Partial<CadPaneHost> = {}) {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string | undefined]> = [];
  const inserted: Array<{ svg: string; w: number; h: number; alt: string }> = [];
  const host: CadPaneHost = {
    setStatus: (t, k) => void status.push([t, k]),
    nextNumeral: () => 10,
    insertPicture: jest.fn(async (svg: string, w: number, h: number, alt: string) => {
      inserted.push({ svg, w, h, alt });
    }),
    readSelectedAlt: async () => null,
    ...extra,
  };
  const pane = initCadPane(host, starterDoc("iso"));
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  return { pane, host, status, inserted, $ };
}
/** Picks a file in the hidden input, as the browser does after Import DXF…, and waits for it to be read. */
async function pickFile($: <T extends HTMLElement>(id: string) => T, status: Array<[string, string | undefined]>, name: string, text: string): Promise<void> {
  const input = $<HTMLInputElement>("cad-import-file");
  const file = new File([new NodeTextEncoder().encode(text)], name);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  const before = status.length;
  input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 200; i++) {
    if (status.slice(before).some(([t]) => !t.startsWith("Reading "))) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("the file was never read");
}
const last = (status: Array<[string, string | undefined]>) => status[status.length - 1];

describe("Import DXF… in the pane", () => {
  it("the button opens the file picker; the picker offers DXF and names the files it will refuse", () => {
    const { $ } = setup();
    const input = $<HTMLInputElement>("cad-import-file");
    const click = jest.fn();
    input.click = click;
    $<HTMLButtonElement>("cad-import").click();
    expect(click).toHaveBeenCalled();
    expect(input.accept.split(",")).toEqual(expect.arrayContaining([".dxf", ".par", ".dft", ".dwg", ".stp"]));
  });
  it("a Solid Edge part is refused by name with the route; nothing opens", async () => {
    const { $, status } = setup();
    await pickFile($, status, "bracket.par", "not readable");
    expect(last(status)).toEqual([expect.stringMatching(/^bracket\.par: a Solid Edge part \(\.par\) can only be read by Solid Edge — in Solid Edge, use Save As → STL/), "error"]);
    expect($<HTMLElement>("cad-import-panel").hidden).toBe(true);
  });
  it("no units in the file: the user must choose them before Insert; then it inserts at true size with alt text that says what it is", async () => {
    const { pane, $, status, inserted } = setup();
    const before = pane.getDoc();
    await pickFile($, status, "plate.dxf", rectDxf());
    expect($<HTMLElement>("cad-import-panel").hidden).toBe(false);
    expect(last(status)[0]).toBe("plate.dxf read. The file does not say its units: choose them below.");
    const units = $<HTMLSelectElement>("cad-import-units");
    expect(units.value).toBe("");
    expect($<HTMLButtonElement>("cad-import-insert").disabled).toBe(true);
    expect($<HTMLButtonElement>("cad-import-sketch").disabled).toBe(true);
    expect($<HTMLElement>("cad-import-info").textContent).toContain("The file does not say its units (it has no $INSUNITS) — choose them before it is sized.");
    units.value = "25.4";
    units.dispatchEvent(new Event("change"));
    expect($<HTMLButtonElement>("cad-import-insert").disabled).toBe(false);
    expect($<HTMLElement>("cad-import-preview").querySelector("img")).not.toBeNull();
    expect($<HTMLElement>("cad-import-info").textContent).toContain("It is inserted at its true size (54.8 × 29.4 mm).");
    $<HTMLButtonElement>("cad-import-insert").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(inserted).toHaveLength(1);
    expect(inserted[0].w).toBeCloseTo(54.8 * PX, 6);
    expect(inserted[0].alt.startsWith(IMPORTED_ALT_PREFIX + "plate.dxf")).toBe(true);
    expect(last(status)).toEqual(["Imported drawing inserted — plate.dxf. It is inserted at its true size (54.8 × 29.4 mm). It is a picture of the file: import it again to change it.", "success"]);
    // The drawing being built is untouched.
    expect(pane.getDoc()).toBe(before);
  });
  it("units the file states are chosen for it", async () => {
    const { $, status } = setup();
    await pickFile($, status, "plate.dxf", rectDxf(4));
    const units = $<HTMLSelectElement>("cad-import-units");
    expect(units.value).toBe("1");
    expect(units.selectedOptions[0].textContent).toBe("millimetres (as the file says)");
    expect($<HTMLButtonElement>("cad-import-insert").disabled).toBe(false);
  });
  it("Edit as a sketch (no large window): the outline opens in the sketch editor, and Done adds it as a part", async () => {
    const { pane, $, status } = setup();
    const parts0 = JSON.parse(pane.getDoc()).parts.length;
    await pickFile($, status, "plate.dxf", rectDxf(4));
    $<HTMLButtonElement>("cad-import-sketch").click();
    expect(pane.isSketching()).toBe(true);
    expect($<HTMLElement>("cad-sketch").hidden).toBe(false);
    expect(last(status)[0]).toBe("plate.dxf opened as a sketch. Done makes it a part.");
    $<HTMLButtonElement>("cad-sketch-done").click();
    const parts = JSON.parse(pane.getDoc()).parts;
    expect(parts).toHaveLength(parts0 + 1);
    const sk = parts[parts.length - 1].sketch;
    expect(sk.points.map((p: { x: number; y: number }) => [p.x, p.y]).sort()).toEqual([[0, 0], [0, 1], [2, 0], [2, 1]]);
  });
  it("Edit as a sketch with the large window: the sketch rides beside the model, not inside it", async () => {
    const openLarge = jest.fn(async () => null);
    const { $, status } = setup({ openLarge, largeAvailable: () => true });
    await pickFile($, status, "plate.dxf", rectDxf(4));
    $<HTMLButtonElement>("cad-import-sketch").click();
    expect(openLarge).toHaveBeenCalledTimes(1);
    const [docJson, opts] = openLarge.mock.calls[0] as unknown as [string, { sketch: string; seed: string }];
    expect(opts.sketch).toBe("new");
    expect(parseSketch(JSON.parse(opts.seed)).ok).toBe(true);
    expect(docJson).not.toContain("seed");
  });
  it("an outline that does not close opens anyway, and the status says where it is open", async () => {
    const { $, status } = setup();
    const open = rectDxf(4).replace("10\r\n0\r\n20\r\n1\r\n11\r\n0\r\n21\r\n0\r\n", "10\r\n0\r\n20\r\n1\r\n11\r\n0\r\n21\r\n0.25\r\n");
    expect(open).not.toBe(rectDxf(4));
    await pickFile($, status, "gap.dxf", open);
    $<HTMLButtonElement>("cad-import-sketch").click();
    expect(last(status)).toEqual(["gap.dxf opened as a sketch — 2 ends meet no other line or arc (largest gap 0.25 mm) — the outline must be closed before Done can make a solid. Done makes it a part.", "error"]);
  });
  it("Edit drawing at cursor on an imported picture names it (not 'not made by the Drawing tool')", async () => {
    const { $, status } = setup({ readSelectedAlt: async () => `${IMPORTED_ALT_PREFIX}plate.dxf (54 × 34 mm at true size). A picture of the file: import the file again to change it.` });
    $<HTMLButtonElement>("cad-open").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(last(status)).toEqual([expect.stringMatching(/^That picture is an imported DXF drawing — a picture of the file, with no model to open\. Import the file again/), "error"]);
  });
  it("one insert at a time: the drawing's Insert waits for an imported insert still running", async () => {
    let release!: () => void;
    const { $, status, host } = setup();
    (host.insertPicture as jest.Mock).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await pickFile($, status, "plate.dxf", rectDxf(4));
    $<HTMLButtonElement>("cad-import-insert").click();
    await new Promise((r) => setTimeout(r, 0));
    $<HTMLButtonElement>("cad-insert").disabled = false; // even if a stale state left it enabled
    $<HTMLButtonElement>("cad-insert").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(host.insertPicture).toHaveBeenCalledTimes(1);
    expect(last(status)).toEqual(["Another insert is still running; press Insert again when it finishes.", "error"]);
    release();
  });
  it("review 10: during an imported insert, Close and Import are off, a picked file is refused, and the status names the file inserted", async () => {
    let release!: () => void;
    const { $, status, host } = setup();
    (host.insertPicture as jest.Mock).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await pickFile($, status, "plate.dxf", rectDxf(4));
    $<HTMLButtonElement>("cad-import-insert").click();
    await new Promise((r) => setTimeout(r, 0));
    expect($<HTMLButtonElement>("cad-import-close").disabled).toBe(true);
    expect($<HTMLButtonElement>("cad-import").disabled).toBe(true);
    $<HTMLButtonElement>("cad-import-close").click(); // ignored
    await pickFile($, status, "other.dxf", rectDxf(4));
    expect(last(status)).toEqual(["An insert is still running; import the file when it finishes.", "error"]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(last(status)[0]).toMatch(/^Imported drawing inserted — plate.dxf./);
    expect($<HTMLButtonElement>("cad-import-close").disabled).toBe(false);
    expect($<HTMLElement>("cad-import-panel").hidden).toBe(false);
  });
  it("review 11: Edit as a sketch while the large window is open keeps its refusal", async () => {
    const openLarge = jest.fn(() => new Promise<null>(() => undefined)); // never closes
    const { $, status } = setup({ openLarge, largeAvailable: () => true });
    await pickFile($, status, "plate.dxf", rectDxf(4));
    $<HTMLButtonElement>("cad-import-sketch").click();
    $<HTMLButtonElement>("cad-import-sketch").click();
    expect(openLarge).toHaveBeenCalledTimes(1);
    expect(last(status)).toEqual(["The drawing is open in the large canvas — sketch there, or close it first.", "error"]);
  });
  it("the large window failing opens the imported sketch here", async () => {
    const openLarge = jest.fn(async () => "failed" as const);
    const { pane, $, status } = setup({ openLarge, largeAvailable: () => true });
    await pickFile($, status, "plate.dxf", rectDxf(4));
    $<HTMLButtonElement>("cad-import-sketch").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(pane.isSketching()).toBe(true);
  });
  it("an unsound starting sketch is refused by name, never opened", () => {
    const { pane, status } = setup();
    pane.startSketch(null, { points: [{ id: "a", x: NaN, y: 0 }], entities: [], constraints: [] });
    expect(pane.isSketching()).toBe(false);
    expect(last(status)).toEqual([expect.stringMatching(/^The imported sketch cannot be opened: the sketch is damaged/), "error"]);
  });
  it("Close import hides the panel", async () => {
    const { $, status } = setup();
    await pickFile($, status, "plate.dxf", rectDxf(4));
    $<HTMLButtonElement>("cad-import-close").click();
    expect($<HTMLElement>("cad-import-panel").hidden).toBe(true);
  });
});
