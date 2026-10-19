/**
 * @jest-environment jsdom
 */
// The large chemistry canvas page (src/drawdialog) over its real markup, with a stand-in for Office's dialog
// API: the whole page travels both ways — brackets, arrows, captions and group labels included — in the URL
// when short, by the ready / message handshake when not; a structure's idcode rides along only when the page
// is exactly one readable set of structures (Reaction mode's "Draw a component").
import * as fs from "fs";
import * as path from "path";
import { TextDecoder as NodeTextDecoder } from "util";
import { readCdxml } from "../cdxml";
import { writeCdxml } from "../cdxmlEdit";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "drawdialog", "drawdialog.html"), "utf8");
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)![1];

type Sent = Record<string, unknown>;

async function open(search: string): Promise<{ sent: Sent[]; parentSays: (m: string) => void }> {
  jest.resetModules();
  document.body.innerHTML = BODY;
  window.history.replaceState(null, "", `/drawdialog.html${search}`);
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
  await import("../../drawdialog/drawdialog");
  return { sent, parentSays: (m) => handler?.({ message: m }) };
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const page = (inner: string): string =>
  `<CDXML BondLength="30" LabelSize="10" LabelFont="3"><fonttable><font id="3" name="Arial"/></fonttable><page id="1">${inner}</page></CDXML>`;
const ethane = '<fragment id="10"><n id="1" p="40 40"/><n id="2" p="70 40"/><b id="3" B="1" E="2"/></fragment>';
const caption = '<t id="20" p="40 80"><s font="3" size="10" face="0">Scheme 1</s></t>';
const arrow = '<arrow id="30" Head3D="110 40 0" Tail3D="80 40 0" ArrowheadHead="Full" ArrowheadType="Solid"/>';
const ome = '<fragment id="40"><n id="41" p="40 120"/><n id="42" p="70 120" NodeType="Unspecified"><t p="70 120"><s font="3" size="10">OMe</s></t></n><b id="43" B="41" E="42"/></fragment>';
const seedOf = (inner: string, frag = false): string => JSON.stringify({ page: page(inner), frag });
const textsOf = (p: string): string[] => {
  const r = readCdxml(p);
  if (!r.ok) throw new Error(r.reason);
  return r.doc.objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "text" ? [it.v.runs.map((q) => q.text).join("")] : [])));
};

describe("the large chemistry canvas carries the whole page", () => {
  it("a page with a caption, an arrow and a group label opens whole and goes back whole (nothing refused, nothing dropped)", async () => {
    const { sent } = await open(`?seed=${encodeURIComponent(seedOf(ethane + caption + arrow + ome))}`);
    $<HTMLButtonElement>("use-btn").click();
    expect(sent.length).toBe(1);
    const back = sent[0] as { page: string; frag: boolean; mol?: string };
    expect(textsOf(back.page)).toContain("Scheme 1");
    expect(back.page).toContain("OMe");
    expect(back.page).toMatch(/<arrow /);
    expect(back.frag).toBe(false);
    expect(back.mol).toBeUndefined(); // not one structure: no idcode for Reaction mode
  });

  it("a page of structures only sends the structure's idcode beside it", async () => {
    const { sent } = await open(`?seed=${encodeURIComponent(seedOf(ethane))}`);
    $<HTMLButtonElement>("use-btn").click();
    const back = sent[0] as { page: string; mol?: string };
    expect(back.mol).toMatch(/^\S+ \S+$/);
    expect(back.page).toContain('id="10"'); // the page's own ids travel (stale-name tracking in the pane)
  });

  it("a page too long for a URL: says ready, then opens on what the pane sends; the Markush flag travels", async () => {
    const { sent, parentSays } = await open("?wait=1");
    expect(sent).toEqual([{ ready: true }]);
    parentSays(seedOf(ethane + caption, true));
    $<HTMLButtonElement>("use-btn").click();
    const back = sent[1] as { page: string; frag: boolean };
    expect(textsOf(back.page)).toEqual(["Scheme 1"]);
    expect(back.frag).toBe(true);
  });

  it("an unreadable seed says so and starts blank, warning that Use would replace the pane's drawing", async () => {
    await open(`?seed=${encodeURIComponent(JSON.stringify({ page: "<not cdxml" }))}`);
    expect(document.body.textContent).toMatch(/could not be read here/);
    expect(document.body.textContent).toMatch(/REPLACE the pane's drawing/);
  });

  it("Use on a blank page says there is nothing to bring back; Cancel sends a cancel", async () => {
    const { sent } = await open("");
    $<HTMLButtonElement>("use-btn").click();
    expect(sent).toEqual([]);
    expect(document.body.textContent).toMatch(/Nothing drawn yet/);
    $<HTMLButtonElement>("cancel-btn").click();
    expect(sent).toEqual([{ cancel: true }]);
  });

  it("the seed the pane builds round-trips through writeCdxml unchanged", () => {
    const r = readCdxml(page(ethane + caption));
    if (!r.ok) throw new Error(r.reason);
    const again = readCdxml(writeCdxml(r.doc.root));
    expect(again.ok && textsOf(writeCdxml(again.doc.root))).toEqual(["Scheme 1"]);
  });
});

describe("the pane takes the page back as one edit", () => {
  it("replacePage: the new page shows; one Undo returns to the page as it was before the large canvas", async () => {
    const { createChemCanvas } = await import("../../taskpane/chemCanvas");
    document.body.innerHTML = '<div id="m"></div>';
    const c = createChemCanvas(document.getElementById("m")!, { setStatus: () => undefined });
    const first = readCdxml(page(ethane));
    const second = readCdxml(page(ethane + caption));
    if (!first.ok || !second.ok) throw new Error("fixture");
    c.loadPage(first.doc);
    expect(c.replacePage(second.doc)).toBe(true);
    expect(c.hasDrawing()).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-chem-action="undo"]')!.click();
    expect(c.hasDrawing()).toBe(false);
    expect(c.page().objects.length).toBe(1);
  });
});
