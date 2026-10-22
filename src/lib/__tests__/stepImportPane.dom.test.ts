/**
 * @jest-environment jsdom
 */
// STEP import in the Drawing (CAD) pane over its real markup (docs/SCOPE-STEP-IMPORT.md), the REAL reader behind the
// pane's worker loader (in a child process — fixtures/occtRun.js), on STEP files written by fixtures/stepFixture.ts.
import * as fs from "fs";
import * as path from "path";
import { TextDecoder as NodeTextDecoder } from "util";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { starterDoc, type CadDoc } from "../cadShapes";
import { stepFile, type FixtureSolid } from "./fixtures/stepFixture";

jest.mock("../../taskpane/stepEngine", () => {
  const RUN = require("path").join(__dirname, "fixtures", "occtRun.js");
  return {
    STEP_ENGINE_DIR: "engines/occt-0.0.23/",
    readStepFile: async (format: string, bytes: Uint8Array) => {
      // A test may hold the reader, as a slow file would.
      const hold = (globalThis as { __holdStep?: Promise<void> }).__holdStep;
      if (hold) await hold;
      const out = require("child_process").execFileSync(process.execPath, [RUN], {
        input: JSON.stringify({ format, base64: Buffer.from(bytes).toString("base64") }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      return { ok: true, result: JSON.parse(out) };
    },
  };
});

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

function setup(init: typeof initCadPane = initCadPane) {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string | undefined]> = [];
  const host: CadPaneHost = { setStatus: (t, k) => void status.push([t, k]), nextNumeral: () => 10, insertPicture: jest.fn(async () => undefined), readSelectedAlt: async () => null };
  const pane = init(host, starterDoc("asme"));
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  return { pane, status, $ };
}
async function pick($: <T extends HTMLElement>(id: string) => T, status: Array<[string, string | undefined]>, name: string, text: string): Promise<void> {
  const input = $<HTMLInputElement>("cad-import-file");
  Object.defineProperty(input, "files", { value: [new File([text], name)], configurable: true });
  const before = status.length;
  input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 1500; i++) {
    if (status.slice(before).some(([t]) => !t.startsWith("Reading "))) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the file was never read");
}
async function until(f: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
}
const last = (status: Array<[string, string | undefined]>) => status[status.length - 1];
const partNames = () => [...document.querySelectorAll("#cad-parts .cad-part-name")].map((b) => b.textContent);

const RIG: FixtureSolid[] = [
  { name: "plate", kind: "box", at: [0, 0, 0], size: [60, 40, 5] },
  { name: "pin", kind: "cylinder", at: [15, 20, 5], r: 4, h: 20 },
  { name: "pin", kind: "cylinder", at: [45, 20, 5], r: 4, h: 20 },
];

describe("Import … STEP: an assembly becomes parts", () => {
  it("read: the panel names the bodies, says the units are the file's, and asks for no units", async () => {
    const { $, status } = setup();
    await pick($, status, "rig.step", stepFile(RIG));
    expect(last(status)).toEqual(["rig.step read: 3 parts. Check the panel below, then Add 3 parts.", ""]);
    expect($("cad-import-panel").hidden).toBe(false);
    expect($("cad-import-units-row").hidden).toBe(true);
    expect($("cad-import-crease-row").hidden).toBe(true);
    expect($("cad-import-tangent-row").hidden).toBe(false);
    expect($("cad-import-info").textContent).toMatch(/^rig\.step: 3 solid bodies \(plate, pin ×2\), [\d,]+ facets, in millimetres as the file says\./);
    expect($<HTMLButtonElement>("cad-import-part").textContent).toBe("Add 3 parts");
    expect($<HTMLButtonElement>("cad-import-part").disabled).toBe(false);
  }, 30000);

  it("Add 3 parts: listed by name, in their places in the assembly; the saved model carries only the file's record", async () => {
    const { $, status, pane } = setup();
    for (const b of [...document.querySelectorAll<HTMLButtonElement>("#cad-parts .num-remove-btn")]) b.click();
    await pick($, status, "rig.step", stepFile(RIG));
    $<HTMLButtonElement>("cad-import-part").click();
    expect(last(status)).toEqual(["rig.step added: 3 parts, in their places in the assembly. Move or turn each under the parts list.", "success"]);
    expect(partNames()).toEqual(["plate — Imported STEP", "pin 1 — Imported STEP", "pin 2 — Imported STEP"]);
    const doc = JSON.parse(pane.getDoc()) as CadDoc;
    const t = doc.parts.map((p) => p.placement.translate.map((v) => +v.toFixed(3)));
    // The pins stand on the plate 30 mm apart, as in the file (moved as one).
    expect(t[1][2] - t[0][2]).toBeCloseTo(5, 6);
    expect(t[2][0] - t[1][0]).toBeCloseTo(30, 3);
    expect(t[1][0] - t[0][0]).toBeCloseTo(11, 3);
    expect(doc.parts.map((p) => p.mesh?.body)).toEqual([0, 1, 2]);
    expect(pane.getDoc()).not.toMatch(/corners|positions|triangles/);
    await until(() => !$<HTMLButtonElement>("cad-insert").disabled);
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(false);
    expect($("cad-preview").querySelector("svg")).not.toBeNull();
  }, 30000);

  it("re-opened without its file: importing it again puts every part back", async () => {
    const first = setup();
    await pick(first.$, first.status, "rig.step", stepFile(RIG));
    first.$<HTMLButtonElement>("cad-import-part").click();
    const json = first.pane.getDoc();

    let fresh: typeof initCadPane = initCadPane;
    jest.isolateModules(() => {
      fresh = (require("../../taskpane/cadPane") as typeof import("../../taskpane/cadPane")).initCadPane;
    });
    const { $, status, pane } = setup(fresh);
    expect(pane.load(json)).toBeNull();
    expect($("cad-msg").textContent).toMatch(/its file rig\.step is not open — import rig\.step again \(Import DXF \/ STL \/ OBJ \/ STEP…\) to put it back/);
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(true);
    await pick($, status, "rig.step", stepFile(RIG));
    expect(last(status)).toEqual(["rig.step put back into plate, pin 1, pin 2.", "success"]);
    expect($("cad-import-panel").hidden).toBe(true);
    await until(() => !$<HTMLButtonElement>("cad-insert").disabled);
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(false);
  }, 30000);

  it("the part's editor offers tangent edges, not units or an edge angle", async () => {
    const { $, status } = setup();
    await pick($, status, "block.step", stepFile([{ name: "block", kind: "box", at: [0, 0, 0], size: [10, 20, 30] }], "inch"));
    expect($<HTMLButtonElement>("cad-import-part").textContent).toBe("Add as a part");
    $<HTMLButtonElement>("cad-import-part").click();
    const editor = $("cad-editor");
    expect(editor.textContent).toContain("From block.step: 12 facets, 254 × 508 × 762 mm.");
    expect(editor.textContent).toContain("Draw tangent edges");
    expect(editor.querySelector('select[aria-label^="Units of"]')).toBeNull();
    expect(editor.textContent).not.toContain("Edge angle");
  }, 30000);

  it("one reader at a time: a pick while a STEP file is still being read is refused by name; the read then lands", async () => {
    const { $, status } = setup();
    let release!: () => void;
    (globalThis as { __holdStep?: Promise<void> }).__holdStep = new Promise<void>((r) => (release = r));
    const input = $<HTMLInputElement>("cad-import-file");
    Object.defineProperty(input, "files", { value: [new File([stepFile(RIG)], "rig.step")], configurable: true });
    input.dispatchEvent(new Event("change"));
    // At once, before the file has even loaded (second review: the guard was set only after): a second STEP waits.
    Object.defineProperty(input, "files", { value: [new File([stepFile(RIG)], "again.step")], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(last(status)).toEqual(["Still reading rig.step — pick the next file when it is done.", "error"]);
    Object.defineProperty(input, "files", { value: [new File([stepFile(RIG)], "rig.step")], configurable: true });
    await until(() => status.some(([t]) => t.startsWith("Reading rig.step")));
    await new Promise((r) => setTimeout(r, 50));
    expect(status.map(([t]) => t)).toContain("Reading rig.step… (starting the STEP and IGES reader — the first time ever, it is also downloaded: 3 MB)");
    Object.defineProperty(input, "files", { value: [new File(["solid x\nendsolid x\n"], "other.stl")], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(last(status)).toEqual(["Still reading rig.step — pick the next file when it is done.", "error"]);
    delete (globalThis as { __holdStep?: Promise<void> }).__holdStep;
    release();
    await until(() => /rig\.step read/.test(last(status)[0]));
    expect(last(status)[0]).toBe("rig.step read: 3 parts. Check the panel below, then Add 3 parts.");
    // Later reads in the session say only "Reading…".
    await pick($, status, "rig.step", stepFile(RIG));
    expect(status.some(([t]) => t === "Reading rig.step…")).toBe(true);
  }, 30000);

  it("a file the reader cannot read is refused by name, and the panel stays closed", async () => {
    const { $, status } = setup();
    await pick($, status, "junk.stp", "this is not a STEP file");
    expect(last(status)[1]).toBe("error");
    expect(last(status)[0]).toMatch(/^junk\.stp: /);
    expect($("cad-import-panel").hidden).toBe(true);
  }, 30000);
});
