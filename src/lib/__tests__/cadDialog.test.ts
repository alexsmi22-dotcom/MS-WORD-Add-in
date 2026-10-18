// The large Drawing (CAD) canvas (src/caddialog) runs the pane's own controller
// (taskpane/cadPane.ts) over its own page. Nothing can run either page in jest
// (Office.js), so these checks hold the two together at the source: the same
// element ids, the same messages both ways, and the page shipped by webpack.
import * as fs from "fs";
import * as path from "path";
import { nextFreeNumeral, parseDoc, serializeDoc, starterDoc, CadDoc } from "../cadShapes";

const SRC = path.join(__dirname, "..", "..");
const read = (...p: string[]): string => fs.readFileSync(path.join(SRC, ...p), "utf8");
// The CAD controller and the sketch editor it opens (both run on both pages).
const CONTROLLER = read("taskpane", "cadPane.ts") + read("taskpane", "sketchPane.ts");
const DIALOG_TS = read("caddialog", "caddialog.ts");
const DIALOG_HTML = read("caddialog", "caddialog.html");
const PANE_HTML = read("taskpane", "taskpane.html");
const PANE_TS = read("taskpane", "taskpane.ts");

/** Element ids the controller looks up with el<…>("id"). */
const controllerIds = [...CONTROLLER.matchAll(/el<\w+>\("([\w-]+)"\)/g)].map((m) => m[1]);
const OPTIONAL = new Set(["cad-popout"]); // the pop-out has no pop-out button (the controller allows null)
const hasId = (html: string, id: string): boolean => new RegExp(`id="${id}"`).test(html);

describe("the pop-out and the pane carry the controls the controller needs", () => {
  it("the controller's id list was read (guards the regex)", () => {
    expect(controllerIds).toEqual(expect.arrayContaining(["cad-canvas", "cad-insert", "cad-hidden", "cad-open"]));
  });
  it.each(controllerIds)("%s is on the pane page", (id) => {
    expect(hasId(PANE_HTML, id)).toBe(true);
  });
  it.each(controllerIds.filter((id) => !OPTIONAL.has(id)))("%s is on the pop-out page", (id) => {
    expect(hasId(DIALOG_HTML, id)).toBe(true);
  });
  it("the data-cad-view buttons exist on both pages", () => {
    for (const v of ["front", "top", "right", "iso"]) {
      expect(PANE_HTML).toContain(`data-cad-view="${v}"`);
      expect(DIALOG_HTML).toContain(`data-cad-view="${v}"`);
    }
  });
});

describe("the messages match both ways", () => {
  it("the pop-out sends ready / doc / doc+insert / cancel, and the pane reads exactly those", () => {
    expect(DIALOG_TS).toMatch(/send\(\{ ready: true \}\)/);
    expect(DIALOG_TS).toMatch(/send\(\{ doc: pane\.getDoc\(\) \}\)/);
    expect(DIALOG_TS).toMatch(/send\(\{ doc: pane\.getDoc\(\), insert: true \}\)/);
    expect(DIALOG_TS).toMatch(/send\(\{ cancel: true \}\)/);
    for (const key of ["data.ready", "data.doc", "data.insert", "data.cancel"]) expect(PANE_TS).toContain(key);
    // The URL parameters the pane writes are the ones the pop-out reads.
    for (const p of ["n0", "doc", "wait"]) {
      expect(PANE_TS).toMatch(new RegExp(`[?&]${p}=`));
      expect(DIALOG_TS).toContain(`params.get("${p}")`);
    }
  });
  it("the pop-out never starts blank: no model, no editor (Use would replace the pane's drawing)", () => {
    expect(DIALOG_TS).toMatch(/if \(!r \|\| !r\.ok\) \{[\s\S]*?return;/);
  });
});

describe("the page ships", () => {
  it("webpack builds it, the service worker precaches it, the offline gate opens it", () => {
    const root = path.join(SRC, "..");
    expect(fs.readFileSync(path.join(root, "webpack.config.js"), "utf8")).toMatch(/caddialog: \["\.\/src\/caddialog\/caddialog\.ts"\]/);
    expect(fs.readFileSync(path.join(root, "webpack.config.js"), "utf8")).toContain(`filename: "caddialog.html"`);
    expect(fs.readFileSync(path.join(root, "scripts", "sw-manifest.js"), "utf8")).toContain(`"caddialog.html"`);
    expect(fs.readFileSync(path.join(root, "scripts", "check-offline.js"), "utf8")).toContain(`"caddialog.html"`);
  });
});

describe("what travels with the model", () => {
  it("the hidden-line choice round-trips; a damaged one is refused", () => {
    const d: CadDoc = { ...starterDoc("asme"), hidden: "show" };
    expect(parseDoc(serializeDoc(d))).toEqual({ ok: true, doc: d });
    expect(parseDoc(JSON.stringify({ ...starterDoc("asme"), hidden: "sometimes" }))).toEqual({ ok: false, reason: "the drawing's hidden-line setting is damaged" });
  });
  it("patent numerals in the pop-out continue the document's table, skipping those on the drawing", () => {
    expect(nextFreeNumeral(10, [])).toBe(10);
    expect(nextFreeNumeral(10, [10, 12])).toBe(14); // even table: steps of 2
    expect(nextFreeNumeral(21, [21])).toBe(22); // odd: steps of 1
    expect(nextFreeNumeral(NaN, [])).toBe(10); // a damaged URL value
  });
});
