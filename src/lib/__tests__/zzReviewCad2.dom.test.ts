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

const log = (...a: unknown[]): void => console.log(JSON.stringify(a));
test("D1 one-height parts + tick Exploded: explode fields shown?", () => {
  const d = TABLE();
  d.parts = d.parts.slice(1);
  const t = setup(d);
  const bx = t.$("cad-views").querySelector<HTMLInputElement>("input[value=exploded]")!;
  bx.checked = true;
  t.$("cad-views").dispatchEvent(new Event("change", { bubbles: true }));
  const fields = Array.from(document.querySelectorAll("#cad-editor .cad-field span")).map((s) => s.textContent);
  log("D1 fields", fields.filter((f) => /Explode/.test(f ?? "")), "msg", t.$("cad-msg").textContent, t.doc().explode);
});
test("D2 zeroing the only explode distance", () => {
  const t = setup();
  const bx = t.$("cad-views").querySelector<HTMLInputElement>("input[value=exploded]")!;
  bx.checked = true;
  t.$("cad-views").dispatchEvent(new Event("change", { bubbles: true }));
  const inputs = Array.from(document.querySelectorAll<HTMLLabelElement>("#cad-editor .cad-field")).filter((l) => l.querySelector("span")!.textContent === "Explode Z");
  const inp = inputs[0].querySelector("input")!;
  inp.value = "0";
  inp.dispatchEvent(new Event("input"));
  log("D2 explode after zero", t.doc().explode, "same input still in DOM", document.body.contains(inp));
});
test("D3 marks of a removed detail come back on the next detail A", () => {
  const d = { ...TABLE(), views: [{ kind: "front" as const }, { kind: "detail" as const, letter: "A", of: "front" as const, at: [2.5, 70] as [number, number], r: 8, factor: 2 }], marks: [{ kind: "text" as const, view: "detail:A", at: [0, 60] as [number, number], text: "JOINT" }] };
  const t = setup(d);
  t.$("cad-details").querySelector<HTMLButtonElement>("button")!.click();
  log("D3 after remove marks", t.doc().marks, t.$("cad-msg").textContent);
});
