/**
 * @jest-environment jsdom
 */
// Combining parts in the Drawing (CAD) pane over its real markup, the REAL engine behind the pane's loader (in a
// child process, as meshBoolean.test.ts runs it). Review: a re-opened drawing with a combined part could never be
// restored by importing its files again — they opened as new parts, and the failure stuck.
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { TextDecoder as NodeTextDecoder } from "util";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { starterDoc, type CadDoc, type CadPart } from "../cadShapes";

jest.mock("../../taskpane/manifoldEngine", () => {
  const RUN = require("path").join(__dirname, "fixtures", "manifoldRun.mjs");
  const run = (op: string, a: { positions: ArrayLike<number>; triangles: ArrayLike<number> }, b: typeof a) =>
    JSON.parse(
      require("child_process").execFileSync(process.execPath, [RUN], {
        input: JSON.stringify({ op, a: { positions: Array.from(a.positions), triangles: Array.from(a.triangles) }, b: { positions: Array.from(b.positions), triangles: Array.from(b.triangles) } }),
        encoding: "utf8",
      }),
    );
  return { loadManifoldEngine: async () => ({ version: "3.5.4", run }) };
});
void execFileSync;

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

/** A w × d × h block as a binary STL (12 facets, float32, zero normals). */
function blockStl(w: number, d: number, h: number): Uint8Array {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const dv = new DataView(new ArrayBuffer(84 + 50 * f.length));
  dv.setUint32(80, f.length, true);
  f.forEach((t, k) => t.forEach((i, c) => v[i].forEach((x, q) => dv.setFloat32(84 + 50 * k + 12 + 12 * c + 4 * q, x, true))));
  return new Uint8Array(dv.buffer);
}

function setup(init: typeof initCadPane = initCadPane) {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string | undefined]> = [];
  const host: CadPaneHost = { setStatus: (t, k) => void status.push([t, k]), nextNumeral: () => 10, insertPicture: jest.fn(async () => undefined), readSelectedAlt: async () => null };
  const pane = init(host, starterDoc("asme"));
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  return { pane, status, $ };
}
async function pick($: <T extends HTMLElement>(id: string) => T, status: Array<[string, string | undefined]>, name: string, bytes: Uint8Array): Promise<void> {
  const input = $<HTMLInputElement>("cad-import-file");
  Object.defineProperty(input, "files", { value: [new File([bytes as Uint8Array<ArrayBuffer>], name)], configurable: true });
  const before = status.length;
  input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 400; i++) {
    if (status.slice(before).some(([t]) => !t.startsWith("Reading "))) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("the file was never read");
}
async function until(f: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
}
const last = (status: Array<[string, string | undefined]>) => status[status.length - 1];

describe("a combined part in the pane", () => {
  it("re-opened without its files: importing each puts it back, and the combination is computed again", async () => {
    const first = setup();
    for (const [name, bytes] of [["a.stl", blockStl(20, 20, 20)], ["b.stl", blockStl(10, 10, 30)]] as const) {
      await pick(first.$, first.status, name, bytes);
      const u = first.$<HTMLSelectElement>("cad-import-units");
      u.value = "1";
      u.dispatchEvent(new Event("change"));
      first.$<HTMLButtonElement>("cad-import-part").click();
    }
    const d = JSON.parse(first.pane.getDoc()) as CadDoc;
    const [pa, pb] = d.parts.filter((p) => p.shape === "mesh");
    pa.placement.translate = [0, 0, 0];
    pb.placement.translate = [5, 5, 0];
    const c: CadPart = { id: "c1", name: "a + b", shape: "combine", params: {}, placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] }, combine: { op: "union", operands: [pa, pb], at: [0, 0, 0] } };
    const json = JSON.stringify({ ...d, parts: [c], callouts: [] });

    let fresh: typeof initCadPane = initCadPane;
    jest.isolateModules(() => {
      fresh = (require("../../taskpane/cadPane") as typeof import("../../taskpane/cadPane")).initCadPane;
    });
    const { $, status, pane } = setup(fresh);
    expect(pane.load(json)).toBeNull();
    await until(() => /is not open/.test($("cad-msg").textContent ?? ""));
    expect($("cad-msg").textContent).toMatch(/a\.stl is not open/);
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(true);

    await pick($, status, "a.stl", blockStl(20, 20, 20));
    expect(last(status)).toEqual(["a.stl put back into a + b.", "success"]);
    await until(() => /b\.stl is not open/.test($("cad-msg").textContent ?? ""));
    expect($("cad-msg").textContent).toMatch(/b\.stl is not open/);

    await pick($, status, "b.stl", blockStl(10, 10, 30));
    expect(last(status)).toEqual(["b.stl put back into a + b.", "success"]);
    await until(() => !$<HTMLButtonElement>("cad-insert").disabled);
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(false);
    expect($("cad-preview").querySelector("svg")).not.toBeNull();
    expect(pane.getDoc()).not.toMatch(/positions|triangles/);
  }, 30000);
});
