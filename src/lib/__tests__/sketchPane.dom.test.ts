/**
 * @jest-environment jsdom
 */
// The sketch editor inside the Drawing (CAD) pane, over the pane's real markup:
// a sketched part is drawn, dimensioned, made a solid on Done, inserted, re-opened.
import * as fs from "fs";
import * as path from "path";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { parseDoc } from "../cadShapes";
import { frameSketch, toCanvas } from "../sketchRender";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(extra: Partial<CadPaneHost> = {}) {
  document.body.innerHTML = SECTION;
  const inserted: string[] = [];
  const host: CadPaneHost = {
    setStatus: jest.fn(),
    nextNumeral: () => 10,
    insertPicture: jest.fn(async (_svg: string, _w: number, _h: number, alt: string) => {
      inserted.push(alt);
    }),
    ...extra,
  };
  const pane = initCadPane(host);
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = $<HTMLCanvasElement>("cad-sketch-canvas");
  // jsdom: the canvas has no size, so the editor frames a 380 × 320 view: sketch (0, 0) at canvas (190, 160), 8/3 px per unit.
  const toCanvas = (x: number, y: number): [number, number] => [190 + (x * 8) / 3, 160 - (y * 8) / 3];
  const tap = (x: number, y: number): void => {
    const [cx, cy] = toCanvas(x, y);
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: cx, clientY: cy, bubbles: true }));
  };
  const toolBtn = (t: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-sk-tool="${t}"]`)!;
  return { pane, host, inserted, $, tap, toolBtn };
}

describe("a sketched part, end to end in the pane", () => {
  it("Sketch (draw your own) opens the editor; a dimensioned rectangle made a 10-deep solid on Done; it inserts with its sketch", async () => {
    const t = setup();
    const shape = t.$<HTMLSelectElement>("cad-shape");
    shape.value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    expect(t.$<HTMLElement>("cad-sketch").hidden).toBe(false);
    expect(t.$<HTMLElement>("cad-section").classList.contains("cad-sketching")).toBe(true);

    t.toolBtn("rectangle").click();
    t.tap(0, 0);
    t.tap(30, 20);
    expect(t.$<HTMLElement>("cad-sketch-status").textContent).toMatch(/^4 degrees of freedom left/);

    // Dimension the bottom edge: select it, type 50, Dimension.
    t.toolBtn("select").click();
    t.tap(15, 0);
    t.$<HTMLInputElement>("cad-sketch-dim").value = "50";
    t.$<HTMLButtonElement>("cad-sketch-dimension").click();
    expect(t.$<HTMLElement>("cad-sketch-msg").textContent).toBe("");

    t.$<HTMLInputElement>("cad-sketch-depth").value = "10";
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    expect(t.$<HTMLElement>("cad-sketch").hidden).toBe(true);

    const doc = parseDoc(t.pane.getDoc());
    if (!doc.ok) throw new Error(doc.reason);
    const part = doc.doc.parts.find((p) => p.shape === "sketch")!;
    expect(part.op).toEqual({ kind: "extrude", depth: 10 });
    expect(part.sketch!.constraints.some((c) => c.kind === "length" && c.value === 50)).toBe(true);

    await t.pane.insert();
    await flush();
    expect(t.inserted.at(-1)).toContain('"shape":"sketch"');
  });

  it("Done on an open outline is refused by name and the editor stays open; Cancel leaves the drawing as it was", () => {
    const t = setup();
    const before = t.pane.getDoc();
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    t.toolBtn("line").click();
    t.tap(0, 0);
    t.tap(20, 0);
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    expect(t.$<HTMLElement>("cad-sketch").hidden).toBe(false);
    expect(t.$<HTMLElement>("cad-sketch-msg").textContent).toMatch(/^the outline is open at \(/);
    t.$<HTMLButtonElement>("cad-sketch-cancel").click();
    expect(t.$<HTMLElement>("cad-sketch").hidden).toBe(true);
    expect(t.pane.getDoc()).toBe(before);
  });

  it("Edit sketch re-opens a sketched part on its own sketch, and Done replaces it", () => {
    const t = setup();
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    t.toolBtn("circle").click();
    t.tap(0, 0);
    t.tap(10, 0);
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    const edit = Array.from(document.querySelectorAll<HTMLButtonElement>("#cad-editor button")).find((b) => b.textContent === "Edit sketch")!;
    expect(edit).toBeTruthy();
    const saved = parseDoc(t.pane.getDoc());
    if (!saved.ok) throw new Error(saved.reason);
    const own = saved.doc.parts.find((p) => p.shape === "sketch")!.sketch!;
    edit.click();
    expect(t.$<HTMLElement>("cad-sketch").hidden).toBe(false);
    // Re-opened, the editor frames the sketch itself: click on the circle through that view.
    const v = frameSketch(own, 380, 320);
    const circle = own.entities[0] as { r: number; c: string };
    const ctr = own.points.find((p) => p.id === circle.c)!;
    const [cx, cy] = toCanvas(v, ctr.x + circle.r, ctr.y);
    t.toolBtn("select").click();
    document.getElementById("cad-sketch-canvas")!.dispatchEvent(new MouseEvent("pointerdown", { clientX: cx, clientY: cy, bubbles: true }));
    t.$<HTMLInputElement>("cad-sketch-dim").value = "Ø30";
    t.$<HTMLButtonElement>("cad-sketch-dimension").click();
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    const doc = parseDoc(t.pane.getDoc());
    if (!doc.ok) throw new Error(doc.reason);
    const sketched = doc.doc.parts.filter((p) => p.shape === "sketch");
    expect(sketched).toHaveLength(1);
    expect(sketched[0].sketch!.entities[0]).toMatchObject({ kind: "circle", r: expect.closeTo(15, 9) });
  });
});

describe("sketcher review — the pane findings pinned", () => {
  const release = (x: number, y: number): void => {
    const cx = 190 + (x * 8) / 3, cy = 160 - (y * 8) / 3;
    document.getElementById("cad-sketch-canvas")!.dispatchEvent(new MouseEvent("pointerup", { clientX: cx, clientY: cy, bubbles: true }));
  };
  const sketchDoc = (t: ReturnType<typeof setup>) => {
    const d = parseDoc(t.pane.getDoc());
    if (!d.ok) throw new Error(d.reason);
    return d.doc;
  };
  it("B1: a click on a point (press, release, no move) SELECTS it — Fix then applies — and leaves no empty undo step", () => {
    const t = setup();
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    t.toolBtn("rectangle").click();
    t.tap(0, 0);
    t.tap(30, 20);
    t.toolBtn("select").click();
    t.tap(0, 0);
    release(0, 0);
    document.querySelector<HTMLButtonElement>('[data-sk-rel="fix"]')!.click();
    expect(t.$<HTMLElement>("cad-sketch-msg").textContent).toBe("");
    // One undo takes the Fix away, the next the rectangle: the click itself added no step.
    t.$<HTMLButtonElement>("cad-sketch-undo").click();
    t.$<HTMLButtonElement>("cad-sketch-undo").click();
    expect(t.$<HTMLElement>("cad-sketch-status").textContent).toMatch(/^Draw lines/);
  });
  it("D7: the editor reads the Sides box when it opens — a 5 set before opening draws a pentagon", () => {
    const t = setup();
    t.$<HTMLInputElement>("cad-sketch-sides").value = "5";
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    t.toolBtn("polygon").click();
    t.tap(0, 0);
    t.tap(10, 0);
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    const part = sketchDoc(t).parts.find((p) => p.shape === "sketch")!;
    expect(part.sketch!.entities.filter((e) => e.kind === "line" && !e.construction)).toHaveLength(5);
  });
  it("D5: after an earlier part is removed, Edit sketch then Done replaces the sketched part (no duplicate)", () => {
    const t = setup();
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    t.toolBtn("circle").click();
    t.tap(0, 0);
    t.tap(10, 0);
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    // Remove every part before the sketched one, so its index changes.
    for (;;) {
      const names = Array.from(document.querySelectorAll<HTMLButtonElement>(".cad-part-name"));
      if (names[0].textContent!.includes("Sketch")) break;
      (names[0].parentElement!.querySelector(".num-remove-btn") as HTMLButtonElement).click();
    }
    const before = sketchDoc(t).parts.length;
    Array.from(document.querySelectorAll<HTMLButtonElement>(".cad-part-name"))[0].click();
    Array.from(document.querySelectorAll<HTMLButtonElement>("#cad-editor button")).find((b) => b.textContent === "Edit sketch")!.click();
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    expect(sketchDoc(t).parts).toHaveLength(before);
  });
  it("D5: while a sketch is open, Insert, Add and New drawing wait — refused by name, the drawing untouched", async () => {
    const t = setup();
    const before = t.pane.getDoc();
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    expect(t.pane.isSketching()).toBe(true);
    await t.pane.insert();
    await flush();
    expect(t.inserted).toHaveLength(0);
    expect(t.host.setStatus).toHaveBeenLastCalledWith("Finish the sketch first (Done or Cancel) — the drawing does not include it yet.", "error");
    t.$<HTMLButtonElement>("cad-add").click();
    t.$<HTMLButtonElement>("cad-new").click();
    expect(t.host.setStatus).toHaveBeenLastCalledWith("Finish the sketch first (Done or Cancel).", "error");
    // Removing a part mid-sketch (what once left Done aiming at the wrong part) waits too.
    document.querySelector<HTMLButtonElement>("#cad-parts .num-remove-btn")!.click();
    expect(t.host.setStatus).toHaveBeenLastCalledWith("Finish the sketch first (Done or Cancel).", "error");
    t.$<HTMLButtonElement>("cad-sketch-cancel").click();
    expect(t.pane.isSketching()).toBe(false);
    expect(t.pane.getDoc()).toBe(before);
  });
});

describe("sketcher re-review — the pane findings pinned", () => {
  const ev = (type: string, x: number, y: number): void => {
    document.getElementById("cad-sketch-canvas")!.dispatchEvent(new MouseEvent(type, { clientX: 190 + (x * 8) / 3, clientY: 160 - (y * 8) / 3, bubbles: true }));
  };
  const rectangle = (t: ReturnType<typeof setup>): void => {
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    t.toolBtn("rectangle").click();
    t.tap(0, 0);
    t.tap(30, 20);
    t.toolBtn("select").click();
  };
  const cornerX = (t: ReturnType<typeof setup>): number => {
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    const d = parseDoc(t.pane.getDoc());
    if (!d.ok) throw new Error(d.reason);
    const sk = d.doc.parts.find((p) => p.shape === "sketch")!.sketch!;
    return Math.max(...sk.points.map((q) => q.x));
  };
  afterEach(() => jest.useRealTimers());
  it("4: a drag released before its next frame still lands where the pointer let go", () => {
    jest.useFakeTimers();
    const t = setup();
    rectangle(t);
    ev("pointerdown", 30, 20);
    ev("pointermove", 35, 20);
    jest.advanceTimersByTime(20);
    ev("pointermove", 45, 20);
    ev("pointerup", 45, 20);
    expect(cornerX(t)).toBeCloseTo(45, 6);
  });
  it("5: a quick flick moves the point and one undo takes it back; a press that wanders back adds no undo step", () => {
    jest.useFakeTimers();
    const t = setup();
    rectangle(t);
    ev("pointerdown", 30, 20);
    ev("pointermove", 40, 20);
    ev("pointerup", 40, 20);
    t.$<HTMLButtonElement>("cad-sketch-undo").click(); // the flick only: the rectangle is still there
    expect(t.$<HTMLElement>("cad-sketch-status").textContent).toMatch(/^4 degrees of freedom left/);
    ev("pointerdown", 30, 20);
    ev("pointermove", 32, 20);
    jest.advanceTimersByTime(20);
    ev("pointermove", 30, 20);
    jest.advanceTimersByTime(20);
    ev("pointerup", 30, 20);
    t.$<HTMLButtonElement>("cad-sketch-undo").click(); // straight to before the rectangle
    expect(t.$<HTMLElement>("cad-sketch-status").textContent).toMatch(/^Draw lines/);
  });
  it("3: Circular takes the angle as shown — 180° — not only a bare number", () => {
    const t = setup();
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    t.toolBtn("circle").click();
    t.tap(10, 0);
    t.tap(12, 0);
    t.toolBtn("point").click();
    t.tap(0, 0);
    t.toolBtn("select").click();
    t.tap(12, 0);
    t.tap(0, 0);
    t.$<HTMLInputElement>("cad-sketch-dim").value = "180°";
    t.$<HTMLButtonElement>("cad-sketch-circular").click();
    expect(t.$<HTMLElement>("cad-sketch-msg").textContent).not.toMatch(/^Type the pattern's total angle/);
  });
  it("6: Edit drawing at cursor and load() wait while a sketch is open", async () => {
    const readSelectedAlt = jest.fn(async () => "x");
    const t = setup({ readSelectedAlt });
    const before = t.pane.getDoc();
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    t.$<HTMLButtonElement>("cad-open").click();
    await flush();
    expect(readSelectedAlt).not.toHaveBeenCalled();
    expect(t.host.setStatus).toHaveBeenLastCalledWith("Finish the sketch first (Done or Cancel).", "error");
    expect(t.pane.load(before)).toBe("Finish the sketch first (Done or Cancel).");
  });
});
