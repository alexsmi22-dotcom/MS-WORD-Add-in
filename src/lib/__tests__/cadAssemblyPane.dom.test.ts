/**
 * @jest-environment jsdom
 */
// The table release in the Drawing (CAD) pane, over its real markup: Mate faces (mode, mutual exclusion,
// Esc), the Exploded view (ticking it explodes the parts; Auto explode; per-part distances) and detail
// views (a click on a figure takes one; its list edits and removes it). Both pages carry the controls.
import * as fs from "fs";
import * as path from "path";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { defaultParams, parseDoc, CadDoc, CadPart } from "../cadShapes";
import type { Vec3 } from "../cadModel";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const DIALOG_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "caddialog", "caddialog.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

const box = (id: string, w: number, d: number, h: number, t: Vec3): CadPart => ({ id, name: id, shape: "box", params: { ...defaultParams("box"), w, d, h }, placement: { translate: t, rotateDeg: [0, 0, 0] } });
const TABLE = (): CadDoc => ({
  v: 1,
  parts: [box("top", 100, 60, 4, [0, 0, 70]), box("leg1", 5, 5, 70, [0, 0, 0]), box("leg2", 5, 5, 70, [95, 0, 0]), box("leg3", 5, 5, 70, [95, 55, 0]), box("leg4", 5, 5, 70, [0, 55, 0])],
  callouts: [],
  standard: "uspto",
  views: [{ kind: "front" }, { kind: "iso" }],
});

function sizeSvg(): void {
  const svg = document.querySelector("#cad-preview svg") as SVGElement | null;
  if (!svg) return;
  const w = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function setup(initial: CadDoc = TABLE()) {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string]> = [];
  const host: CadPaneHost = {
    setStatus: (m: string, k?: string) => void status.push([m, k ?? ""]),
    nextNumeral: () => 10,
    insertPicture: jest.fn(async () => undefined),
    readSelectedAlt: async () => null,
  };
  const pane = initCadPane(host, initial);
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const doc = (): CadDoc => {
    const r = parseDoc(pane.getDoc());
    if (!r.ok) throw new Error(r.reason);
    return r.doc;
  };
  const last = (): [string, string] => status[status.length - 1];
  return { pane, $, doc, status, last };
}
beforeAll(() => {
  Element.prototype.setPointerCapture = () => undefined;
});

describe("the controls are on both pages", () => {
  test.each(["cad-mate", "cad-mate-undo", "cad-explode-auto", "cad-detail", "cad-detail-factor", "cad-details", 'value="exploded"'])("%s", (id) => {
    expect(PANE_HTML).toContain(id);
    expect(DIALOG_HTML).toContain(id);
  });
});

describe("Mate faces", () => {
  test("stays on until Stop or Esc, and switches the callout mode off (and back the other way)", () => {
    const t = setup();
    const mate = t.$<HTMLButtonElement>("cad-mate"), callout = t.$<HTMLButtonElement>("cad-callout");
    mate.click();
    expect([mate.textContent, mate.getAttribute("aria-pressed")]).toEqual(["Stop mating", "true"]);
    expect(t.last()[0]).toMatch(/^Mate: click a flat face of the part to MOVE/);
    callout.click();
    expect(mate.getAttribute("aria-pressed")).toBe("false");
    expect(callout.getAttribute("aria-pressed")).toBe("true");
    mate.click();
    expect(callout.getAttribute("aria-pressed")).toBe("false");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(mate.getAttribute("aria-pressed")).toBe("false");
    expect(t.$<HTMLButtonElement>("cad-mate-undo").disabled).toBe(true);
  });
});

describe("the exploded view", () => {
  test("ticking Exploded lifts the top off the legs, draws the view (FIG. 3) and shows the top's explode distances", () => {
    const t = setup();
    const box = t.$("cad-views").querySelector<HTMLInputElement>("input[value=exploded]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(t.doc().explode).toEqual({ top: [0, 0, 29.6] });
    expect(t.doc().views.map((v) => v.kind)).toEqual(["front", "iso", "exploded"]);
    const labels = Array.from(document.querySelectorAll("#cad-preview text")).map((x) => x.textContent).filter((x) => /^FIG\./.test(x ?? ""));
    expect(labels.sort()).toEqual(["FIG. 1", "FIG. 2", "FIG. 3"]);
    // The top is part 1: its editor carries Explode X / Y / Z, set from the auto explode.
    const fields = Array.from(document.querySelectorAll("#cad-editor .cad-field span")).map((s) => s.textContent);
    expect(fields).toEqual(expect.arrayContaining(["Explode X", "Explode Y", "Explode Z"]));
  });
  test("Auto explode on parts at one height says what to do instead", () => {
    const d = TABLE();
    d.parts = d.parts.slice(1);
    const t = setup(d);
    t.$<HTMLButtonElement>("cad-explode-auto").click();
    expect(t.last()).toEqual(["Auto explode lifts parts that sit above others; these parts are all at one height — give a part its own explode distance under the part instead.", "error"]);
  });
});

describe("detail views", () => {
  test("Add detail view, then a click on a figure: detail A of that figure, listed, with its circle; Remove takes it away", () => {
    const t = setup({ ...TABLE(), views: [{ kind: "front" }] });
    t.$<HTMLButtonElement>("cad-detail").click();
    expect(t.$("cad-detail").getAttribute("aria-pressed")).toBe("true");
    sizeSvg();
    const click = (x: number, y: number): void => void t.$("cad-preview").dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true }));
    // The empty middle of the front view (between the legs) holds nothing: refused by name.
    const title = Array.from(document.querySelectorAll("#cad-preview text")).find((q) => /^FIG\./.test(q.textContent ?? ""))!;
    click(Number(title.getAttribute("x")), Number(title.getAttribute("y")) - 40);
    expect(t.last()[0]).toBe("Detail A's circle holds nothing of the figure, so it is not drawn: take it again on the part to enlarge.");
    // The table top's left end: the first corner of the visible outline.
    t.$<HTMLButtonElement>("cad-detail").click();
    const d = document.querySelector("#cad-preview g#visible path, #cad-preview path")!.getAttribute("d")!;
    const pts = [...d.matchAll(/([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
    sizeSvg(); // the sheet was drawn again after the refusal
    click(x0 + 2, y0 + 2);
    const det = t.doc().views.find((v) => v.kind === "detail");
    expect(det && det.kind === "detail" && [det.letter, det.of, det.factor]).toEqual(["A", "front", 2]);
    expect(t.last()[1]).toBe("success");
    expect(t.$("cad-detail").getAttribute("aria-pressed")).toBe("false");
    expect(t.$("cad-details").textContent).toContain("Detail A (of the front view)");
    const labels = Array.from(document.querySelectorAll("#cad-preview text")).map((q) => q.textContent);
    expect(labels.filter((l) => l === "FIG. 2")).toHaveLength(2); // under the detail, and beside its circle
    t.$("cad-details").querySelector<HTMLButtonElement>("button")!.click();
    expect(t.doc().views.some((v) => v.kind === "detail")).toBe(false);
  });
  test("a click outside every figure, or on a blank figure, is refused by name", () => {
    const t = setup({ ...TABLE(), views: [{ kind: "front" }] });
    t.$<HTMLButtonElement>("cad-detail").click();
    sizeSvg();
    t.$("cad-preview").dispatchEvent(new MouseEvent("pointerdown", { clientX: 1, clientY: 1, button: 0, bubbles: true }));
    expect(t.last()).toEqual(["Click on a front, top, side, isometric or exploded figure: a detail enlarges part of one of those.", "error"]);
  });
});

describe("review fixes", () => {
  const tick = (t: ReturnType<typeof setup>): void => {
    const box = t.$("cad-views").querySelector<HTMLInputElement>("input[value=exploded]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  };
  test("legs at one height: ticking Exploded shows the Explode fields at once (nothing to auto-explode)", () => {
    const d = TABLE();
    d.parts = d.parts.slice(1);
    const t = setup(d);
    tick(t);
    expect(t.doc().explode).toBeUndefined();
    const fields = Array.from(document.querySelectorAll("#cad-editor .cad-field span")).map((s) => s.textContent);
    expect(fields).toEqual(expect.arrayContaining(["Explode X", "Explode Y", "Explode Z"]));
  });
  test("setting the last explode distance to 0 keeps it 0 (no re-explode) and keeps the field being typed in", () => {
    const t = setup();
    tick(t);
    const z = Array.from(document.querySelectorAll<HTMLLabelElement>("#cad-editor .cad-field")).find((l) => l.textContent?.startsWith("Explode Z"))!.querySelector("input")!;
    z.value = "0";
    z.dispatchEvent(new Event("input"));
    expect(t.doc().explode).toBeUndefined();
    expect(document.body.contains(z)).toBe(true);
  });
  test("removing a detail removes the marks drawn on it", () => {
    const d: CadDoc = { ...TABLE(), views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 74], r: 6, factor: 2 }], marks: [{ kind: "text", view: "detail:A", at: [2.5, 74], text: "JOINT" }, { kind: "text", view: "front", at: [50, 74], text: "TOP" }] };
    const t = setup(d);
    t.$("cad-details").querySelector<HTMLButtonElement>("button")!.click();
    expect(t.doc().marks?.map((m) => m.view)).toEqual(["front"]);
  });
});
