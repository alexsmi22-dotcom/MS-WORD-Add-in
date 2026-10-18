/**
 * @jest-environment jsdom
 */
// The usability round (user test 2026-10-18: "if i want to draw a box, it's very
// challenging"): the box, Smart Dimension and the Solid Edge conventions, done
// through the pane's real markup with real events. Every action is counted.
import * as fs from "fs";
import * as path from "path";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { parseDoc } from "../cadShapes";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

function setup() {
  document.body.innerHTML = SECTION;
  const host: CadPaneHost = { setStatus: jest.fn(), nextNumeral: () => 10, insertPicture: jest.fn(async () => undefined) };
  const pane = initCadPane(host);
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  // jsdom: a 380 × 320 view, sketch (0, 0) at canvas (190, 160), 8/3 px per mm (a 5 mm grid).
  const ev = (type: string, x: number, y: number, extra: MouseEventInit = {}): void => {
    $("cad-sketch-canvas").dispatchEvent(new MouseEvent(type, { clientX: 190 + (x * 8) / 3, clientY: 160 - (y * 8) / 3, bubbles: true, ...extra }));
  };
  const key = (k: string, extra: KeyboardEventInit = {}): void => {
    (document.activeElement ?? $("cad-sketch")).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));
  };
  const panel = $("cad-sketch");
  const openSketch = (): void => {
    $<HTMLSelectElement>("cad-shape").value = "sketch";
    $<HTMLButtonElement>("cad-add").click();
  };
  const sketchOf = () => {
    $<HTMLButtonElement>("cad-sketch-done").click();
    const d = parseDoc(pane.getDoc());
    if (!d.ok) throw new Error(d.reason);
    return d.doc.parts.find((p) => p.shape === "sketch")!.sketch!;
  };
  return { pane, host, $, ev, key, panel, openSketch, sketchOf };
}
const lens = (sk: { points: Array<{ id: string; x: number; y: number }>; entities: Array<{ kind: string; a?: string; b?: string }> }): number[] =>
  sk.entities
    .filter((e) => e.kind === "line")
    .map((e) => {
      const a = sk.points.find((p) => p.id === e.a)!, b = sk.points.find((p) => p.id === e.b)!;
      return +Math.hypot(b.x - a.x, b.y - a.y).toFixed(9);
    })
    .sort((p, q) => p - q);

describe("the box, the Solid Edge way", () => {
  it("R, type 40, Tab, 20, click — five actions: a 40 × 20 rectangle with its W and H driving; one Undo takes it all back", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("r"); // 1: Rectangle
    expect(t.$("cad-sketch-in1-name").textContent).toBe("W");
    expect(t.$("cad-sketch-in2-label").hidden).toBe(false);
    t.key("4"); // 2: typing goes straight into W
    const w = t.$<HTMLInputElement>("cad-sketch-in1");
    expect(document.activeElement).toBe(w);
    w.value = "40"; // (the 0 lands in the focused box)
    t.$<HTMLInputElement>("cad-sketch-in2").value = "20"; // 3, 4: Tab, 20
    t.ev("pointerdown", 10, 5); // 5: click where it goes
    expect(w.value).toBe(""); // cleared for the next shape
    t.$<HTMLButtonElement>("cad-sketch-undo").click();
    expect(t.$("cad-sketch-status").textContent).toMatch(/^Draw lines/);
    // Again, and make it a part: exactly 40 × 20, both sizes driving.
    t.panel.focus();
    t.key("4");
    w.value = "40";
    t.$<HTMLInputElement>("cad-sketch-in2").value = "20";
    t.ev("pointerdown", 10, 5);
    const sk = t.sketchOf();
    expect(lens(sk)).toEqual([20, 20, 40, 40]);
    expect(sk.constraints.filter((c) => c.kind === "length").map((c) => (c as { value: number }).value).sort()).toEqual([20, 40]);
  });
  it("or click a corner, type W and H, press Enter", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("r");
    t.ev("pointerdown", 0, 0);
    t.$<HTMLInputElement>("cad-sketch-in1").value = "30";
    const h = t.$<HTMLInputElement>("cad-sketch-in2");
    h.value = "15";
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(lens(t.sketchOf())).toEqual([15, 15, 30, 30]);
  });
  it("a plain click-click rectangle lands on the 5 mm grid, not on 37.83", () => {
    const t = setup();
    t.openSketch();
    expect(t.$("cad-sketch-gridlabel").textContent).toBe("grid 5 mm");
    t.panel.focus();
    t.key("r");
    t.ev("pointerdown", 1.2, -0.9);
    t.ev("pointerdown", 37.83, 21.6);
    expect(lens(t.sketchOf())).toEqual([20, 20, 40, 40]);
  });
  it("a size that is not a number is refused by name, and nothing is drawn", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("r");
    t.$<HTMLInputElement>("cad-sketch-in1").value = "4o";
    t.ev("pointerdown", 0, 0);
    expect(t.$("cad-sketch-msg").textContent).toBe('W: "4o" is not a number');
    expect(t.$("cad-sketch-status").textContent).toMatch(/^Draw lines/);
  });
});

describe("Smart Dimension", () => {
  it("D, click an edge (its length is offered), type 50, Enter — the edge is 50 and driving", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("r");
    t.ev("pointerdown", 0, 0);
    t.ev("pointerdown", 30, 15);
    t.key("d");
    expect(t.$("cad-sketch-prompt").textContent).toMatch(/^Smart Dimension/);
    t.ev("pointerdown", 15, 0);
    const box = t.$<HTMLInputElement>("cad-sketch-dim");
    expect(box.value).toBe("30");
    expect(document.activeElement).toBe(box);
    box.value = "50";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const sk = t.sketchOf();
    expect(sk.constraints.find((c) => c.kind === "length")).toMatchObject({ value: 50 });
    expect(lens(sk)).toEqual([15, 15, 50, 50]);
  });
  it("two lines give their angle", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("r");
    t.ev("pointerdown", 0, 0);
    t.ev("pointerdown", 30, 15);
    t.key("d");
    t.ev("pointerdown", 15, 0);
    t.ev("pointerdown", 30, 7.5);
    expect(t.$<HTMLInputElement>("cad-sketch-dim").value).toBe("90°");
  });
});

describe("Solid Edge conventions", () => {
  it("Esc ends the line chain; a second Esc goes back to Select", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("l");
    t.ev("pointerdown", 0, 0);
    t.ev("pointerdown", 20, 0);
    expect(t.$("cad-sketch-prompt").textContent).toMatch(/^Line: click the next point/);
    t.key("Escape");
    expect(t.$("cad-sketch-prompt").textContent).toBe("Line: click the first point.");
    t.key("Escape");
    expect(document.querySelector('[data-sk-tool="select"]')!.classList.contains("active")).toBe(true);
  });
  it("right-click ends the chain too (no menu)", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("l");
    t.ev("pointerdown", 0, 0);
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    t.$("cad-sketch-canvas").dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(t.$("cad-sketch-prompt").textContent).toBe("Line: click the first point.");
  });
  it("letters pick tools, but never while a box is being typed in", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("c");
    expect(document.querySelector('[data-sk-tool="circle"]')!.classList.contains("active")).toBe(true);
    expect(t.$("cad-sketch-in1-name").textContent).toBe("Ø");
    const dim = t.$<HTMLInputElement>("cad-sketch-dim");
    dim.focus();
    dim.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    expect(document.querySelector('[data-sk-tool="circle"]')!.classList.contains("active")).toBe(true);
  });
  it("Ctrl+Z undoes; G turns grid snap off", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("p");
    t.ev("pointerdown", 10, 10);
    t.key("z", { ctrlKey: true });
    expect(t.$("cad-sketch-status").textContent).toMatch(/^Draw lines/);
    t.key("g");
    expect(t.$<HTMLInputElement>("cad-sketch-grid").checked).toBe(false);
    expect(t.$("cad-sketch-gridlabel").textContent).toBe("grid off");
  });
  it("middle-drag pans: what is clicked afterwards lands where the view now shows it", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("r");
    t.ev("pointerdown", 0, 0, { button: 1 });
    t.ev("pointermove", 30, 0); // the view moves 30 mm (80 px) to the right
    t.ev("pointerup", 30, 0);
    // The canvas spots that showed (30, 0) and (60, 15) now show (0, 0) and (30, 15).
    t.ev("pointerdown", 30, 0);
    t.ev("pointerdown", 60, 15);
    const sk = t.sketchOf();
    expect(Math.min(...sk.points.map((p) => p.x))).toBe(0);
    expect(lens(sk)).toEqual([15, 15, 30, 30]);
  });
});

describe("found in the real browser", () => {
  it("Smart Dimension on an edge that already has a dimension edits it (no second, conflicting one)", () => {
    const t = setup();
    t.openSketch();
    t.panel.focus();
    t.key("r");
    t.$<HTMLInputElement>("cad-sketch-in1").value = "40";
    t.$<HTMLInputElement>("cad-sketch-in2").value = "20";
    t.ev("pointerdown", 0, 0);
    t.key("d");
    t.ev("pointerdown", 20, 0);
    const box = t.$<HTMLInputElement>("cad-sketch-dim");
    expect(box.value).toBe("40");
    box.value = "50";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(t.$("cad-sketch-msg").textContent).toBe("");
    const sk = t.sketchOf();
    expect(sk.constraints.filter((c) => c.kind === "length").map((c) => (c as { value: number }).value).sort()).toEqual([20, 50]);
    expect(lens(sk)).toEqual([20, 20, 50, 50]);
  });
});
