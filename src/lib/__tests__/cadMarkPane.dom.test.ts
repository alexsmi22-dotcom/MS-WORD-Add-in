/**
 * @jest-environment jsdom
 */
// Drawing on the sheet in the Drawing (CAD) pane, over its real markup: each tool, the figure a
// mark lands on, erase and undo, and the callout mode that now stays on until it is stopped.
import * as fs from "fs";
import * as path from "path";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { parseDoc, starterDoc, CadDoc } from "../cadShapes";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const DIALOG_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "caddialog", "caddialog.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

// jsdom lays nothing out: the preview's SVG is given the sheet's own size on screen (1 px = 1 sheet px).
function sizeSvg(): void {
  const svg = document.querySelector("#cad-preview svg") as SVGElement | null;
  if (!svg) return;
  const w = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function setup(initial?: CadDoc) {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string]> = [];
  const host: CadPaneHost = {
    setStatus: (m: string, k?: string) => void status.push([m, k ?? ""]),
    nextNumeral: (taken: number[]) => {
      let n = 10;
      while (taken.includes(n)) n += 2;
      return n;
    },
    insertPicture: jest.fn(async () => undefined),
    readSelectedAlt: async () => null,
  };
  const pane = initCadPane(host, initial ?? { ...starterDoc("uspto"), views: [{ kind: "front" }, { kind: "iso" }] });
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const preview = $("cad-preview");
  const doc = (): CadDoc => {
    const r = parseDoc(pane.getDoc());
    if (!r.ok) throw new Error(r.reason);
    return r.doc;
  };
  const tool = (t: string): void => document.querySelector<HTMLButtonElement>(`[data-mark-tool="${t}"]`)!.click();
  const ptr = (type: string, x: number, y: number): void => {
    sizeSvg();
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }) as unknown as PointerEvent;
    Object.defineProperty(e, "pointerId", { value: 1 });
    preview.dispatchEvent(e);
  };
  const drag = (pts: Array<[number, number]>): void => {
    ptr("pointerdown", ...pts[0]);
    for (const p of pts.slice(1)) ptr("pointermove", ...p);
    ptr("pointerup", ...pts[pts.length - 1]);
  };
  return { pane, $, preview, doc, tool, ptr, drag, status };
}

beforeAll(() => {
  Element.prototype.setPointerCapture = () => undefined;
});

/** The cell of each view, read from the SVG's own layout (the view titles sit under their cells). */
function cellCentre(kind: string): [number, number] {
  // The iso view is FIG. 1 (top row), the front view FIG. 2 (bottom row) on the patent sheet.
  const texts = Array.from(document.querySelectorAll("#cad-preview text")).filter((t) => /^FIG\./.test(t.textContent ?? ""));
  const pos = texts.map((t) => ({ x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")) }));
  pos.sort((a, b) => a.y - b.y);
  const p = kind === "iso" ? pos[0] : pos[pos.length - 1];
  return [p.x, p.y - 30];
}

describe("drawing on the sheet", () => {
  it("both pages carry the same drawing tools", () => {
    for (const t of ["pen", "line", "arrow", "numeral", "text", "erase"]) {
      expect(PANE_HTML).toContain(`data-mark-tool="${t}"`);
      expect(DIALOG_HTML).toContain(`data-mark-tool="${t}"`);
    }
  });

  it("the pencil keeps a stroke as drawn, on the figure it started on", () => {
    const t = setup();
    t.tool("pen");
    const [x, y] = cellCentre("front");
    t.drag([[x, y], [x + 10, y + 3], [x + 20, y - 4], [x + 30, y + 6]]);
    const m = t.doc().marks!;
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe("pen");
    expect(m[0].view).toBe("front");
    if (m[0].kind === "pen") expect(m[0].pts).toHaveLength(4);
    expect(t.preview.innerHTML).toContain('<g data-layer="markup">');
  });

  it("an arrow points at where the drag ended; a click alone is not an arrow", () => {
    const t = setup();
    t.tool("arrow");
    const [x, y] = cellCentre("iso");
    t.ptr("pointerdown", x, y);
    t.ptr("pointerup", x + 1, y);
    expect(t.doc().marks).toBeUndefined();
    expect(t.status[t.status.length - 1]).toEqual(["Drag from the tail of the arrow to the point it shows.", "error"]);
    t.drag([[x - 40, y - 30], [x, y]]);
    const m = t.doc().marks![0];
    expect(m.kind === "line" && m.arrow).toBe(true);
    expect(m.view).toBe("iso");
  });

  it("numerals: a click puts the next numeral beside the point; a drag puts it where the drag ends", () => {
    const t = setup();
    t.tool("numeral");
    const [x, y] = cellCentre("front");
    t.ptr("pointerdown", x, y);
    t.ptr("pointerup", x, y);
    t.drag([[x + 5, y], [x + 60, y - 20]]);
    const m = t.doc().marks!;
    expect(m.map((q) => (q.kind === "numeral" ? q.label : ""))).toEqual(["10", "12"]);
    expect(t.status[t.status.length - 1]).toEqual(["Numeral 12 placed. Drag or click again for the next; Esc stops.", "success"]);
  });

  it("text needs words first, then goes where it is clicked", () => {
    const t = setup();
    t.tool("text");
    expect(t.$<HTMLInputElement>("cad-mark-text").hidden).toBe(false);
    const [x, y] = cellCentre("front");
    t.ptr("pointerdown", x, y);
    expect(t.status[t.status.length - 1]).toEqual(["Type the text in the box first, then click where it goes.", "error"]);
    t.$<HTMLInputElement>("cad-mark-text").value = "TABLE TOP";
    t.ptr("pointerdown", x, y);
    expect(t.doc().marks).toEqual([expect.objectContaining({ kind: "text", view: "front", text: "TABLE TOP" })]);
    expect(t.preview.innerHTML).toContain(">TABLE TOP</tspan></text>");
  });

  it("erase removes the mark clicked; undo puts it back, and takes back a drawn one", () => {
    const t = setup();
    t.tool("line");
    const [x, y] = cellCentre("front");
    t.drag([[x - 20, y], [x + 20, y]]);
    expect(t.doc().marks).toHaveLength(1);
    t.tool("erase");
    t.ptr("pointerdown", x + 60, y + 60);
    expect(t.status[t.status.length - 1][1]).toBe("error");
    expect(t.doc().marks).toHaveLength(1);
    // The line was laid out again: find it on the sheet and click on it.
    const path0 = t.preview.querySelector('[data-layer="markup"] path')!.getAttribute("d")!;
    const [mx, my] = /M([\d.]+) ([\d.]+)/.exec(path0)!.slice(1).map(Number);
    t.ptr("pointerdown", mx + 2, my);
    expect(t.doc().marks).toBeUndefined();
    const undo = t.$<HTMLButtonElement>("cad-mark-undo");
    expect(undo.disabled).toBe(false);
    undo.click();
    expect(t.doc().marks).toHaveLength(1);
    undo.click();
    expect(t.doc().marks).toBeUndefined();
    expect(undo.disabled).toBe(true);
  });

  it("Esc puts the tool down", () => {
    const t = setup();
    t.tool("pen");
    expect(t.preview.classList.contains("cad-marking")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(t.preview.classList.contains("cad-marking")).toBe(false);
    const [x, y] = cellCentre("front");
    t.drag([[x, y], [x + 30, y]]);
    expect(t.doc().marks).toBeUndefined();
  });
});

describe("placing callouts stays on until it is stopped", () => {
  it("the button says so, Esc ends it, and a drawing tool takes over from it", () => {
    const t = setup();
    const btn = t.$<HTMLButtonElement>("cad-callout");
    btn.click();
    expect(btn.textContent).toBe("Stop placing callouts");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(btn.textContent).toBe("Add callout");
    btn.click();
    t.tool("pen");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("drawing with no parts", () => {
  it("removing the last part asks for a part or a blank figure; ticking Blank figure gives a sheet to draw on", () => {
    const t = setup({ ...starterDoc("uspto"), parts: [], views: [{ kind: "front" }] });
    expect(t.$("cad-msg").textContent).toBe("Add a part to start a drawing, or tick Blank figure (under Views on the sheet) to draw freehand.");
    const blank = document.querySelector<HTMLInputElement>('input[value="blank"]')!;
    blank.checked = true;
    blank.dispatchEvent(new Event("change", { bubbles: true }));
    expect(t.preview.querySelector("svg")).not.toBeNull();
    t.tool("pen");
    const [x, y] = cellCentre("iso"); // the only figure: FIG. 1
    t.drag([[x, y], [x + 20, y + 5], [x + 40, y - 5]]);
    expect(t.doc().marks).toEqual([expect.objectContaining({ kind: "pen", view: "blank" })]);
    expect(t.$<HTMLButtonElement>("cad-insert").disabled).toBe(false);
  });
});
