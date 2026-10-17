/**
 * @jest-environment jsdom
 */
// The large Drawing (CAD) canvas page (src/caddialog) over its real markup, with
// a stand-in for Office's dialog API: what it sends the pane, the ready/model
// handshake for a model too long for a URL, and that it never starts blank.
import * as fs from "fs";
import * as path from "path";
import { serializeDoc, starterDoc, parseDoc } from "../cadShapes";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "caddialog", "caddialog.html"), "utf8");
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)![1];

type Sent = Record<string, unknown>;

async function open(search: string): Promise<{ sent: Sent[]; parentSays: (m: string) => void }> {
  jest.resetModules();
  document.body.innerHTML = BODY;
  window.history.replaceState(null, "", `/caddialog.html${search}`);
  const sent: Sent[] = [];
  let handler = null as ((arg: { message?: string }) => void) | null;
  (globalThis as Record<string, unknown>).__APP_VERSION__ = "test";
  (globalThis as Record<string, unknown>).Office = {
    onReady: (cb: () => void) => cb(),
    EventType: { DialogParentMessageReceived: "parent" },
    AsyncResultStatus: { Succeeded: "succeeded" },
    context: {
      ui: {
        messageParent: (m: string) => sent.push(JSON.parse(m)),
        addHandlerAsync: (_t: string, h: (arg: { message?: string }) => void, done: (r: { status: string }) => void) => {
          handler = h;
          done({ status: "succeeded" });
        },
      },
    },
  };
  await import("../../caddialog/caddialog");
  return { sent, parentSays: (m) => handler?.({ message: m }) };
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const json = serializeDoc({ ...starterDoc("iso"), hidden: "show" });

describe("the large canvas page", () => {
  it("opens on the model from the URL; Use sends it back; Cancel sends a cancel", async () => {
    const { sent } = await open(`?n0=10&doc=${encodeURIComponent(json)}`);
    expect($<HTMLSelectElement>("cad-standard").value).toBe("iso");
    expect($<HTMLSelectElement>("cad-hidden").value).toBe("show");
    $<HTMLButtonElement>("cad-use").click();
    $<HTMLButtonElement>("cad-cancel").click();
    expect(sent[0]).toEqual({ doc: json });
    expect(sent[1]).toEqual({ cancel: true });
  });

  it("Insert hands the model to the pane with the instruction (the dialog cannot reach the document)", async () => {
    const { sent } = await open(`?n0=10&doc=${encodeURIComponent(json)}`);
    $<HTMLButtonElement>("cad-insert").click();
    await Promise.resolve();
    expect(sent).toEqual([{ doc: json, insert: true }]);
  });

  it("a model too long for a URL: says ready, then starts on what the pane sends", async () => {
    const { sent, parentSays } = await open(`?n0=10&wait=1`);
    expect(sent).toEqual([{ ready: true }]);
    expect($<HTMLButtonElement>("cad-use").disabled).toBe(true); // nothing to use yet
    parentSays(json);
    expect($<HTMLSelectElement>("cad-standard").value).toBe("iso");
    $<HTMLButtonElement>("cad-use").click();
    expect(parseDoc(String(sent[1].doc))).toEqual(parseDoc(json));
  });

  it("no model, or a damaged one: says so and never offers a blank drawing to Use", async () => {
    for (const q of ["?n0=10", `?n0=10&doc=${encodeURIComponent("{bad")}`]) {
      const { sent } = await open(q);
      expect($<HTMLElement>("cad-error").style.display).toBe("block");
      expect($<HTMLElement>("cad-error").textContent).toContain("the drawing in the pane is unchanged");
      expect($<HTMLButtonElement>("cad-use").disabled).toBe(true);
      $<HTMLButtonElement>("cad-use").click();
      expect(sent).toEqual([]);
    }
  });
});

describe("the large canvas keeps the sheet's views (third review)", () => {
  it("a model with only a FRONT view and a custom angle comes back with exactly those", async () => {
    const c = Math.SQRT1_2;
    const rot = [1, 0, 0, 0, c, -c, 0, c, c]; // 45° about X
    const model = serializeDoc({ ...starterDoc("asme"), views: [{ kind: "front" }, { kind: "orbit", rot, name: "VIEW" }] });
    const { sent } = await open(`?n0=10&doc=${encodeURIComponent(model)}`);
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>("#cad-views input[type=checkbox]")).filter((b) => b.checked).map((b) => b.value);
    expect(boxes).toEqual(["front", "orbit"]);
    $<HTMLButtonElement>("cad-use").click();
    const back = parseDoc(String(sent[0].doc));
    if (!back.ok) throw new Error(back.reason);
    expect(back.doc.views.map((v) => v.kind)).toEqual(["front", "orbit"]);
    const o = back.doc.views[1];
    expect(o.kind === "orbit" && o.rot).toEqual(rot);
  });
});
