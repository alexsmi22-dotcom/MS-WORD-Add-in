/**
 * @jest-environment jsdom
 */
// The usability round's independent review — every finding pinned to the reviewer's repro.
import * as fs from "fs";
import * as path from "path";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { parseDoc } from "../cadShapes";
import { placeTyped, parseTyped } from "../sketchInput";
import { startEdit, click, EditState } from "../sketchEdit";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

function setup(extra: Partial<CadPaneHost> = {}) {
  document.body.innerHTML = SECTION;
  const host: CadPaneHost = { setStatus: jest.fn(), nextNumeral: () => 10, insertPicture: jest.fn(async () => undefined), ...extra };
  const pane = initCadPane(host);
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const ev = (type: string, x: number, y: number, init: MouseEventInit = {}, s = 8 / 3, ox = 190, oy = 160): void => {
    $("cad-sketch-canvas").dispatchEvent(new MouseEvent(type, { clientX: ox + x * s, clientY: oy - y * s, bubbles: true, ...init }));
  };
  const key = (k: string, init: KeyboardEventInit = {}): void => {
    (document.activeElement ?? $("cad-sketch")).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
  };
  const open = (): void => {
    $<HTMLSelectElement>("cad-shape").value = "sketch";
    $<HTMLButtonElement>("cad-add").click();
    $("cad-sketch").focus();
  };
  const sketchOf = () => {
    $<HTMLButtonElement>("cad-sketch-done").click();
    const d = parseDoc(pane.getDoc());
    if (!d.ok) throw new Error(d.reason);
    return d.doc.parts.find((p) => p.shape === "sketch")!.sketch!;
  };
  return { pane, host, $, ev, key, open, sketchOf };
}
const ok = (r: { ok: boolean; state: EditState; reason?: string }): EditState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe("blockers", () => {
  it("B1: Select and Trim act on the exact click — a line between grid points is still hit", () => {
    const t = setup();
    t.open();
    t.$<HTMLInputElement>("cad-sketch-grid").checked = false;
    t.key("l");
    t.ev("pointerdown", 0, 0);
    t.ev("pointerdown", 22, 9);
    t.key("Escape");
    t.$<HTMLInputElement>("cad-sketch-grid").checked = true;
    t.key("s");
    t.ev("pointerdown", 11, 4.5); // on the line; the 5 mm grid point (10, 5) is off it
    t.ev("pointerup", 11, 4.5);
    t.$<HTMLButtonElement>("cad-sketch-delete").click();
    expect(t.$("cad-sketch-msg").textContent).not.toBe("select something to delete");
    expect(t.$("cad-sketch-status").textContent).toMatch(/^Draw lines/);
  });
  it("B2: a typed size past 1 000 000 mm is refused by name; a shape that would reach past the sketch's range too", () => {
    expect(parseTyped("2000000", "length", "W")).toBe("W must be at most 1 000 000 mm");
    expect(parseTyped("0.0000001", "length", "W")).toBe("W must be at least 0.000001 mm");
    const r = placeTyped({ ...startEdit(), tool: "rectangle" }, [999999, 20], { x: 10, y: 0 }, 1);
    expect(r).toMatchObject({ ok: false, reason: "the shape would reach beyond ±1 000 000 mm — a sketch is drawn within that" });
  });
  it("B3: a typed 1.5° is a 1.5° line from the clicked point (no automatic horizontal)", () => {
    const st = ok(placeTyped({ ...startEdit(), tool: "line" }, [50, 1.5], { x: 0, y: 0 }, 1));
    const pts = st.sketch.points;
    expect(pts.find((p) => p.x === 0 && p.y === 0)).toBeDefined();
    const end = pts.find((p) => p.x !== 0)!;
    expect(Math.atan2(end.y, end.x) * (180 / Math.PI)).toBeCloseTo(1.5, 9);
    expect(st.sketch.constraints.some((c) => c.kind === "horizontal")).toBe(false);
    // A typed 90° does get its vertical relation.
    const v = ok(placeTyped({ ...startEdit(), tool: "line" }, [10, 90], { x: 0, y: 0 }, 1));
    expect(v.sketch.constraints.some((c) => c.kind === "vertical")).toBe(true);
  });
});

describe("defects", () => {
  it("D4: typed sizes on construction geometry are dimensioned; 12.345678 is kept, not rounded to 12.3457", () => {
    const c = ok(placeTyped({ ...startEdit(), tool: "rectangle", construction: true }, [40, 20], { x: 0, y: 0 }, 1));
    expect(c.sketch.constraints.filter((k) => k.kind === "length")).toHaveLength(2);
    const r = ok(placeTyped({ ...startEdit(), tool: "rectangle" }, [12.345678, 5], { x: 0, y: 0 }, 1));
    expect(r.sketch.constraints.find((k) => k.kind === "length" && Math.abs((k as { value: number }).value - 12.345678) < 1e-12)).toBeDefined();
  });
  it("D5: Smart Dimension on two parallel edges offers the distance between them", () => {
    const t = setup();
    t.open();
    t.key("r");
    t.ev("pointerdown", 0, 0);
    t.ev("pointerdown", 30, 15);
    t.key("d");
    t.ev("pointerdown", 15, 0);
    t.ev("pointerdown", 15, 15);
    const box = t.$<HTMLInputElement>("cad-sketch-dim");
    expect(box.value).toBe("15");
    box.value = "20";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(t.$("cad-sketch-msg").textContent).toBe("");
  });
  it("D6: after Enter in the value box, Esc and the tool letters work again", () => {
    const t = setup();
    t.open();
    t.key("r");
    t.ev("pointerdown", 0, 0);
    t.ev("pointerdown", 30, 15);
    t.key("d");
    t.ev("pointerdown", 15, 0);
    const box = t.$<HTMLInputElement>("cad-sketch-dim");
    box.value = "50";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement).toBe(t.$("cad-sketch"));
    t.key("Escape");
    t.key("Escape");
    t.key("l");
    expect(document.querySelector('[data-sk-tool="line"]')!.classList.contains("active")).toBe(true);
  });
  it("D7: a pan released outside the canvas ends — a later move with no button does not pan", () => {
    const t = setup();
    t.open();
    t.key("r");
    t.ev("pointerdown", 0, 0, { button: 1 });
    t.ev("pointermove", 10, 0, { buttons: 4 });
    document.body.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    t.ev("pointermove", 20, 0, { buttons: 0 }); // back over the canvas, nothing held
    // The view moved 10 mm, not 20: the spots that showed (10, 0) and (40, 15) are now (0, 0) and (30, 15).
    t.ev("pointerdown", 10, 0);
    t.ev("pointerdown", 40, 15);
    const sk = t.sketchOf();
    expect(Math.min(...sk.points.map((p) => p.x))).toBe(0);
  });
  it("D8: a Space released elsewhere (or the window losing focus) does not leave every click panning", () => {
    const t = setup();
    t.open();
    t.key("p");
    t.key(" ");
    window.dispatchEvent(new Event("blur"));
    t.ev("pointerdown", 10, 10);
    expect(t.$("cad-sketch-status").textContent).not.toMatch(/^Draw lines/);
  });
  it("D9: Enter in the size fields after the pointer left the canvas goes toward where it last was (down-left here)", () => {
    const t = setup();
    t.open();
    t.key("r");
    t.ev("pointerdown", 0, 0);
    t.ev("pointermove", -30, -15);
    t.$("cad-sketch-canvas").dispatchEvent(new MouseEvent("pointerleave"));
    t.$<HTMLInputElement>("cad-sketch-in1").value = "30";
    const h = t.$<HTMLInputElement>("cad-sketch-in2");
    h.value = "10";
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const sk = t.sketchOf();
    expect([Math.min(...sk.points.map((p) => p.x)), Math.min(...sk.points.map((p) => p.y))]).toEqual([-30, -10]);
  });
  it("D10: a typed angle clicked from behind is said so, not silently ignored", () => {
    const s1 = ok(click({ ...startEdit(), tool: "line" }, 0, 0, 1));
    expect(placeTyped(s1, [null, 90], { x: 0, y: -20 }, 1)).toMatchObject({ ok: false, reason: "that click is behind the typed angle — click on the side it points to, or type the length" });
  });
  it("D11: if the large window fails to open, the sketch opens in the pane instead", async () => {
    const t = setup({ openLarge: jest.fn(async () => "failed" as never) });
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(t.pane.isSketching()).toBe(true);
  });
  it("D11: the large window closed without Done says the sketch was not kept", async () => {
    const t = setup({ openLarge: jest.fn(async () => null) });
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(t.host.setStatus).toHaveBeenLastCalledWith("The large window was closed without Done — the sketch was not kept.", "");
  });
});

describe("nits", () => {
  it("a distance between an edge's two ends edits the edge's length (no conflict)", () => {
    const t = setup();
    t.open();
    t.key("r");
    t.$<HTMLInputElement>("cad-sketch-in1").value = "40";
    t.$<HTMLInputElement>("cad-sketch-in2").value = "20";
    t.ev("pointerdown", 0, 0);
    t.key("d");
    t.ev("pointerdown", 0, 0);
    t.ev("pointerdown", 40, 0);
    expect(t.$<HTMLInputElement>("cad-sketch-dim").value).toBe("40");
  });
  it("typing after W is filled goes on into H", () => {
    const t = setup();
    t.open();
    t.key("r");
    t.$<HTMLInputElement>("cad-sketch-in1").value = "40";
    t.$("cad-sketch").focus();
    t.key("2");
    expect(document.activeElement).toBe(t.$("cad-sketch-in2"));
  });
  it("a sketch for a part no longer in the drawing is named, not silently a new one", () => {
    const t = setup();
    t.pane.startSketch("gone");
    expect(t.pane.isSketching()).toBe(false);
    expect(t.host.setStatus).toHaveBeenLastCalledWith("That part is no longer in the drawing — its sketch cannot be opened.", "error");
  });
});
