/**
 * @jest-environment jsdom
 */
// R3b in the Drawing (CAD) pane over its real markup: Import DXF / STL… → an STL is read, its units
// chosen (it has none), and added as a part of the model; the drawing names the file, and a drawing
// re-opened without it says which file to import, and takes back only the same bytes.
import * as fs from "fs";
import * as path from "path";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "util";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { starterDoc } from "../cadShapes";
import { hasStl } from "../cadMeshStore";
import { stlHash } from "../stl";

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

function setup(extra: Partial<CadPaneHost> = {}, init: typeof initCadPane = initCadPane) {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string | undefined]> = [];
  const host: CadPaneHost = {
    setStatus: (t, k) => void status.push([t, k]),
    nextNumeral: () => 10,
    insertPicture: jest.fn(async () => undefined),
    readSelectedAlt: async () => null,
    ...extra,
  };
  const pane = init(host, starterDoc("asme"));
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  return { pane, host, status, $ };
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
const last = (status: Array<[string, string | undefined]>) => status[status.length - 1];
function chooseUnits($: <T extends HTMLElement>(id: string) => T, mm: string): void {
  const u = $<HTMLSelectElement>("cad-import-units");
  u.value = mm;
  u.dispatchEvent(new Event("change"));
}

describe("Import DXF / STL… — an STL becomes a part", () => {
  it("the button says all three, and the picker offers .stl and .obj", () => {
    const { $ } = setup();
    expect($("cad-import").textContent).toBe("Import DXF / STL / OBJ…");
    expect($<HTMLInputElement>("cad-import-file").accept.split(",")).toEqual(expect.arrayContaining([".stl", ".obj"]));
  });

  it("read: no units are assumed — Add as a part waits for them; the drawing's buttons are hidden", async () => {
    const { $, status } = setup();
    await pick($, status, "block.stl", blockStl(40, 30, 20));
    expect(last(status)).toEqual(["block.stl read. An STL file does not say its units: choose them below, then Add as a part.", ""]);
    expect($("cad-import-panel").hidden).toBe(false);
    expect($<HTMLSelectElement>("cad-import-units").value).toBe("");
    expect($<HTMLButtonElement>("cad-import-part").hidden).toBe(false);
    expect($<HTMLButtonElement>("cad-import-part").disabled).toBe(true);
    expect($<HTMLButtonElement>("cad-import-insert").hidden).toBe(true);
    expect($<HTMLButtonElement>("cad-import-sketch").hidden).toBe(true);
    expect($("cad-import-crease-row").hidden).toBe(false);
    expect($("cad-import-info").textContent).toBe("block.stl: 12 facets (binary STL). An STL file does not say its units: choose them.");
    chooseUnits($, "1");
    expect($("cad-import-info").textContent).toBe("block.stl: 12 facets (binary STL). 12 edges drawn at 30°.");
    expect($<HTMLButtonElement>("cad-import-part").disabled).toBe(false);
  });

  it("Add as a part: listed, drawn on the sheet, insertable — and the saved model carries only the file's record", async () => {
    const { $, status, pane } = setup();
    await pick($, status, "block.stl", blockStl(40, 30, 20));
    chooseUnits($, "25.4");
    $<HTMLButtonElement>("cad-import-part").click();
    expect(last(status)[0]).toMatch(/^block\.stl added as block\. Move or turn it/);
    expect($("cad-import-panel").hidden).toBe(true);
    expect($("cad-parts").textContent).toContain("block — Imported STL");
    expect($("cad-editor").textContent).toContain("From block.stl: 12 facets, 1016 × 762 × 508 mm.");
    expect($("cad-preview").querySelector("svg")).not.toBeNull();
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(false);
    const json = pane.getDoc();
    expect(json).not.toMatch(/positions|cornerNormals/);
    const part = JSON.parse(json).parts.find((p: { shape: string }) => p.shape === "mesh");
    expect(part.mesh).toEqual({ file: "block.stl", hash: expect.stringMatching(/^[0-9a-f]{16}-684$/), facets: 12, mmPerUnit: 25.4, creaseDeg: 30, size: [1016, 762, 508] });
  });

  it("the part's units can be changed after: it is rebuilt at the new size", async () => {
    const { $, status, pane } = setup();
    await pick($, status, "block.stl", blockStl(40, 30, 20));
    chooseUnits($, "1");
    $<HTMLButtonElement>("cad-import-part").click();
    const sel = $("cad-editor").querySelector<HTMLSelectElement>("select[aria-label='Units of the STL file']")!;
    sel.value = "10";
    sel.dispatchEvent(new Event("change"));
    const part = JSON.parse(pane.getDoc()).parts.find((p: { shape: string }) => p.shape === "mesh");
    expect(part.mesh.mmPerUnit).toBe(10);
    expect(part.mesh.size).toEqual([400, 300, 200]);
    expect($("cad-editor").textContent).toContain("400 × 300 × 200 mm");
  });

  it("re-opened without its file: the drawing says which file to import; only the same bytes put it back", async () => {
    const first = setup();
    await pick(first.$, first.status, "block.stl", blockStl(40, 30, 20));
    chooseUnits(first.$, "1");
    first.$<HTMLButtonElement>("cad-import-part").click();
    const json = first.pane.getDoc();

    // A later session: the pane (and the store of imported files) loaded afresh.
    let fresh: typeof initCadPane = initCadPane;
    jest.isolateModules(() => {
      fresh = (require("../../taskpane/cadPane") as typeof import("../../taskpane/cadPane")).initCadPane;
    });
    const { $, status, pane } = setup({}, fresh);
    expect(pane.load(json)).toBeNull();
    expect($("cad-msg").textContent).toBe("block: its file block.stl is not open — import block.stl again (Import DXF / STL / OBJ…) to put it back");
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(true);
    [...$("cad-parts").querySelectorAll<HTMLButtonElement>(".cad-part-name")].find((b) => b.textContent === "block — Imported STL")!.click();
    expect($("cad-editor").textContent).toContain("The file is not open — import block.stl again to put it back.");

    // Another file (different bytes, same name): not taken as the part's — it opens to be added.
    await pick($, status, "block.stl", blockStl(40, 30, 21));
    expect(last(status)[0]).toMatch(/^block\.stl read\./);
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(true);
    $<HTMLButtonElement>("cad-import-close").click();

    await pick($, status, "renamed.stl", blockStl(40, 30, 20));
    expect(last(status)).toEqual(["renamed.stl put back into block.", "success"]);
    expect($("cad-import-panel").hidden).toBe(true);
    expect($("cad-preview").querySelector("svg")).not.toBeNull();
    expect($<HTMLButtonElement>("cad-insert").disabled).toBe(false);
  });

  it("review 6: the same file imported again (its part present) opens to add a second copy, not 'put back'", async () => {
    const { $, status, pane } = setup();
    await pick($, status, "bolt.stl", blockStl(10, 10, 40));
    chooseUnits($, "1");
    $<HTMLButtonElement>("cad-import-part").click();
    await pick($, status, "bolt.stl", blockStl(10, 10, 40));
    expect(last(status)[0]).toMatch(/^bolt\.stl read\./);
    expect($("cad-import-panel").hidden).toBe(false);
    chooseUnits($, "1");
    $<HTMLButtonElement>("cad-import-part").click();
    expect(JSON.parse(pane.getDoc()).parts.filter((p: { shape: string }) => p.shape === "mesh")).toHaveLength(2);
  });

  it("review 2: typing an edge angle builds once typing pauses; Add waits for it", async () => {
    const { $, status } = setup();
    await pick($, status, "block.stl", blockStl(40, 30, 20));
    chooseUnits($, "1");
    const c = $<HTMLInputElement>("cad-import-crease");
    for (const v of ["4", "45"]) {
      c.value = v;
      c.dispatchEvent(new Event("input"));
    }
    expect($<HTMLButtonElement>("cad-import-part").disabled).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect($("cad-import-info").textContent).toBe("block.stl: 12 facets (binary STL). 12 edges drawn at 45°.");
    expect($<HTMLButtonElement>("cad-import-part").disabled).toBe(false);
  });

  it("review 3-6: the pane keeps the file its part names, and forgets files only looked at beyond the last two", async () => {
    const { $, status } = setup();
    const used = blockStl(31, 30, 20);
    await pick($, status, "used.stl", used);
    chooseUnits($, "1");
    $<HTMLButtonElement>("cad-import-part").click();
    const looked = [32, 33, 34, 35].map((w) => blockStl(w, 30, 20));
    for (const [i, b] of looked.entries()) {
      await pick($, status, `look${i}.stl`, b);
      $<HTMLButtonElement>("cad-import-close").click();
    }
    expect(hasStl(stlHash(used))).toBe(true);
    expect(looked.map((b) => hasStl(stlHash(b)))).toEqual([false, false, true, true]);
  });

  it("the large canvas refuses a drawing with an imported part by name (its facets stay in the pane)", async () => {
    const openLarge = jest.fn(async () => null);
    const { $, status } = setup({ openLarge });
    await pick($, status, "block.stl", blockStl(40, 30, 20));
    chooseUnits($, "1");
    $<HTMLButtonElement>("cad-import-part").click();
    $<HTMLButtonElement>("cad-popout").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(openLarge).not.toHaveBeenCalled();
    expect(last(status)).toEqual(["The large canvas cannot open a drawing with an imported STL part yet (block) — work on it here in the pane.", "error"]);
  });

  it("an unreadable STL is refused by name; a STEP file names the route through STL", async () => {
    const { $, status } = setup();
    await pick($, status, "junk.stl", new Uint8Array([1, 2, 3]));
    expect(last(status)[1]).toBe("error");
    expect(last(status)[0]).toMatch(/^junk\.stl: /);
    expect($("cad-import-panel").hidden).toBe(true);
    await pick($, status, "part.step", new NodeTextEncoder().encode("ISO-10303-21;"));
    expect(last(status)).toEqual(["part.step: STEP parts are not imported yet — save the part as STL (in Solid Edge, Save As → STL) and import that, or save a draft as DXF", "error"]);
  });

  it("an edge angle that draws too many edges is named in the panel, and Add stays off", async () => {
    const { $, status } = setup();
    await pick($, status, "block.stl", blockStl(40, 30, 20));
    chooseUnits($, "1");
    const c = $<HTMLInputElement>("cad-import-crease");
    c.value = "0";
    c.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 300));
    expect($("cad-import-info").textContent).toBe("block.stl: 12 facets (binary STL). The edge angle must be between 0° and 180°.");
    expect($<HTMLButtonElement>("cad-import-part").disabled).toBe(true);
  });
});

describe("Import … — an OBJ goes the STL's way, and is called an OBJ", () => {
  const CUBE_OBJ = ["# a 40 × 30 × 20 block, six quads", "v 0 0 0", "v 40 0 0", "v 40 30 0", "v 0 30 0", "v 0 0 20", "v 40 0 20", "v 40 30 20", "v 0 30 20", "f 1 4 3 2", "f 5 6 7 8", "f 1 2 6 5", "f 2 3 7 6", "f 3 4 8 7", "f 4 1 5 8", ""].join("\n");
  it("read: OBJ says no units either; added as a part named after the file, listed as an imported OBJ", async () => {
    const { $, status, pane } = setup();
    await pick($, status, "block.obj", new NodeTextEncoder().encode(CUBE_OBJ));
    expect(last(status)).toEqual(["block.obj read. An OBJ file does not say its units: choose them below, then Add as a part.", ""]);
    expect($("cad-import-info").textContent).toBe("block.obj: 12 facets (OBJ). An OBJ file does not say its units: choose them.");
    chooseUnits($, "1");
    expect($("cad-import-info").textContent).toBe("block.obj: 12 facets (OBJ). 12 edges drawn at 30°.");
    $<HTMLButtonElement>("cad-import-part").click();
    expect(last(status)[0]).toMatch(/^block\.obj added as block\. /);
    expect($("cad-parts").textContent).toContain("block — Imported OBJ");
    expect($("cad-editor").querySelector("select[aria-label='Units of the OBJ file']")).not.toBeNull();
    const part = JSON.parse(pane.getDoc()).parts.find((p: { shape: string }) => p.shape === "mesh");
    expect([part.mesh.file, part.mesh.facets, part.mesh.size]).toEqual(["block.obj", 12, [40, 30, 20]]);
  });
  it("a bad line is refused with its number, by the file's name", async () => {
    const { $, status } = setup();
    await pick($, status, "bad.obj", new NodeTextEncoder().encode("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n"));
    expect(last(status)).toEqual(["bad.obj: line 4: corner 9 does not exist (3 corners so far).", "error"]);
  });
});
