/**
 * @jest-environment jsdom
 */
// The Drawing (CAD) controller over the pane's real markup: the Insert guards
// (reviews D1 and the second review's stale-sheet finding) and the large-canvas
// round trip. jsdom has no canvas, so painting is skipped; the sheet is real.
import * as fs from "fs";
import * as path from "path";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { serializeDoc, starterDoc, CadDoc } from "../cadShapes";

// jsdom has no canvas: the controller paints nothing when getContext gives none.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

function setup(extra: Partial<CadPaneHost> = {}, initial?: CadDoc) {
  document.body.innerHTML = SECTION;
  const inserted: Array<{ alt: string; svg: string }> = [];
  let release: () => void = () => undefined;
  const host: CadPaneHost = {
    setStatus: jest.fn(),
    nextNumeral: () => 10,
    insertPicture: jest.fn((svg: string, _w: number, _h: number, alt: string) => {
      inserted.push({ svg, alt });
      return new Promise<void>((r) => (release = r));
    }),
    readSelectedAlt: async () => null,
    ...extra,
  };
  const pane = initCadPane(host, initial);
  pane.show();
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const field = (label: string): HTMLInputElement => {
    const l = Array.from(document.querySelectorAll<HTMLElement>(".cad-field")).find((e) => e.querySelector("span")?.textContent === label);
    if (!l) throw new Error(`no field ${label}`);
    return l.querySelector("input") as HTMLInputElement;
  };
  const type = (el: HTMLInputElement | HTMLSelectElement, v: string): void => {
    el.value = v;
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input"));
  };
  return { pane, host, inserted, release: () => release(), $, field, type };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("Insert inserts only the sheet of the model as it stands", () => {
  it("a valid drawing inserts its sheet, with that model in the alt text", async () => {
    const t = setup();
    const insert = t.$<HTMLButtonElement>("cad-insert");
    expect(insert.disabled).toBe(false);
    insert.click();
    await flush();
    expect(t.inserted).toHaveLength(1);
    expect(t.inserted[0].svg).toMatch(/^<svg/);
    expect(t.inserted[0].alt).toContain(`Model: ${t.pane.getDoc()}`);
  });

  it("an invalid dimension keeps Insert off, even after the standard or views change (D1)", () => {
    const t = setup();
    t.type(t.field("Thickness (Z)"), "0");
    expect(t.$<HTMLButtonElement>("cad-insert").disabled).toBe(true);
    t.type(t.$<HTMLSelectElement>("cad-standard"), "iso");
    expect(t.$<HTMLButtonElement>("cad-insert").disabled).toBe(true);
    t.type(t.$<HTMLSelectElement>("cad-hidden"), "show");
    expect(t.$<HTMLButtonElement>("cad-insert").disabled).toBe(true);
  });

  it("an edit while an insert is in flight does not re-enable Insert on the old sheet", async () => {
    const t = setup();
    const insert = t.$<HTMLButtonElement>("cad-insert");
    insert.click();
    await flush();
    t.type(t.field("Width (X)"), "120"); // rebuild scheduled, not run
    t.release(); // the insert finishes while the rebuild is still waiting
    await flush();
    expect(insert.disabled).toBe(true);
    insert.click(); // and a click cannot insert the old sheet under the new model
    await flush();
    expect(t.inserted).toHaveLength(1);
    jest.advanceTimersByTime(200); // the rebuild runs: the new sheet is current
    expect(insert.disabled).toBe(false);
    insert.click();
    await flush();
    expect(t.inserted).toHaveLength(2);
    expect(t.inserted[1].alt).toContain('"w":120');
  });

  it("a second click during an insert does nothing", async () => {
    const t = setup();
    const insert = t.$<HTMLButtonElement>("cad-insert");
    insert.click();
    insert.disabled = false; // even if the button were somehow live
    insert.click();
    await flush();
    expect(t.inserted).toHaveLength(1);
  });

  it("renaming a part: Insert waits for the sheet to catch up, then carries the new name", async () => {
    const t = setup();
    const name = document.querySelector<HTMLInputElement>("#cad-editor > input.formula-input")!;
    t.type(name, "Base plate");
    expect(t.$<HTMLButtonElement>("cad-insert").disabled).toBe(true);
    jest.advanceTimersByTime(400);
    expect(t.$<HTMLButtonElement>("cad-insert").disabled).toBe(false);
    t.$<HTMLButtonElement>("cad-insert").click();
    await flush();
    expect(t.inserted[0].alt).toContain('"name":"Base plate"');
  });
});

describe("the large canvas round trip (pane side)", () => {
  it("Open large canvas sends the model; what comes back with Insert is loaded and inserted", async () => {
    const back: CadDoc = { ...starterDoc("iso"), hidden: "hide" };
    const openLarge = jest.fn(async () => ({ doc: serializeDoc(back), insert: true }));
    const t = setup({ openLarge });
    const pop = t.$<HTMLButtonElement>("cad-popout");
    expect(pop.hidden).toBe(false);
    pop.click();
    await flush();
    expect(openLarge).toHaveBeenCalledWith(serializeDoc(starterDoc("asme")));
    expect(t.$<HTMLSelectElement>("cad-standard").value).toBe("iso");
    expect(t.$<HTMLSelectElement>("cad-hidden").value).toBe("hide");
    expect(t.inserted).toHaveLength(1);
    expect(t.inserted[0].alt).toContain('"standard":"iso"');
  });

  it("Cancel leaves the pane's drawing untouched; a damaged return is refused by name", async () => {
    const t = setup({ openLarge: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ doc: "{oops", insert: false }) });
    const before = t.pane.getDoc();
    t.$<HTMLButtonElement>("cad-popout").click();
    await flush();
    expect(t.pane.getDoc()).toBe(before);
    t.$<HTMLButtonElement>("cad-popout").click();
    await flush();
    expect(t.pane.getDoc()).toBe(before);
    expect(t.host.setStatus).toHaveBeenCalledWith("Could not bring the drawing back: this is not a drawing this canvas saved (not JSON).", "error");
  });

  it("in the pop-out (no openLarge, no document access) those two buttons are hidden", () => {
    const t = setup({ openLarge: undefined, readSelectedAlt: undefined });
    expect(t.$<HTMLButtonElement>("cad-popout").hidden).toBe(true);
    expect(t.$<HTMLButtonElement>("cad-open").hidden).toBe(true);
  });
});

describe("third review: an insert collision is said, and a refused sheet reads as a refusal", () => {
  it("the large canvas returning with Insert while a pane insert runs: one insert, and the pane says the second did not happen", async () => {
    let backNow: (v: { doc: string; insert: boolean }) => void = () => undefined;
    const t = setup({ openLarge: () => new Promise((r) => (backNow = r)) });
    t.$<HTMLButtonElement>("cad-popout").click(); // the large canvas is open…
    await flush();
    t.$<HTMLButtonElement>("cad-insert").click(); // …and the user inserts from the pane under it
    await flush();
    backNow({ doc: serializeDoc(starterDoc("iso")), insert: true });
    await flush();
    expect(t.inserted).toHaveLength(1);
    expect(t.host.setStatus).toHaveBeenCalledWith("Another insert is still running; press Insert again when it finishes.", "error");
  });

  it("a sheet that cannot hold its callouts: the reason as a warning, no scale line, Insert off", () => {
    const d: CadDoc = {
      ...starterDoc("uspto"),
      parts: [{ id: "b", name: "Block", shape: "box", params: { w: 40, d: 30, h: 10 }, placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] } }],
      callouts: Array.from({ length: 40 }, (_, i) => ({ anchor: [40, 1 + (28 * i) / 40, 10] as [number, number, number], label: String(10 + 2 * i) })),
    };
    const t = setup({}, d);
    const msg = t.$<HTMLElement>("cad-msg");
    expect(msg.className).toContain("warn");
    expect(msg.textContent).toMatch(/^\d+ callouts beside one view do not fit on the sheet/);
    expect(t.$<HTMLButtonElement>("cad-insert").disabled).toBe(true);
  });
});

describe("fourth review: one large canvas at a time", () => {
  it("a pane insert finishing while the large canvas is open does not re-enable its button", async () => {
    let close: (v: null) => void = () => undefined;
    const openLarge = jest.fn(() => new Promise<null>((r) => (close = r)));
    const t = setup({ openLarge });
    const pop = t.$<HTMLButtonElement>("cad-popout");
    pop.click();
    await flush();
    t.$<HTMLButtonElement>("cad-insert").click();
    await flush();
    t.release();
    await flush();
    expect(pop.disabled).toBe(true);
    pop.click();
    await flush();
    expect(openLarge).toHaveBeenCalledTimes(1);
    close(null); // the large canvas closes: the button comes back
    await flush();
    expect(pop.disabled).toBe(false);
  });
});

describe("New drawing, PowerPoint, and the sketch tools through the pane", () => {
  it("New drawing: the first click arms it, the second clears every part, and Undo clear brings them back", () => {
    const t = setup();
    const btn = t.$<HTMLButtonElement>("cad-new");
    const before = t.pane.getDoc();
    btn.click();
    expect(btn.textContent).toBe("Click again to clear everything");
    expect(t.pane.getDoc()).toBe(before);
    btn.click();
    expect(JSON.parse(t.pane.getDoc()).parts).toEqual([]);
    expect(btn.textContent).toBe("Undo clear");
    btn.click();
    expect(t.pane.getDoc()).toBe(before);
    expect(btn.textContent).toBe("New drawing");
  });

  it("an armed New drawing that is not confirmed lets go after a few seconds", () => {
    const t = setup();
    const btn = t.$<HTMLButtonElement>("cad-new");
    btn.click();
    jest.advanceTimersByTime(4500);
    expect(btn.textContent).toBe("New drawing");
    btn.click();
    expect(JSON.parse(t.pane.getDoc()).parts.length).toBeGreaterThan(0); // only armed again, not cleared
  });

  it("Export to PowerPoint hands the current sheet to the host; with no exporter (the pop-out) the button is hidden", async () => {
    const exportPpt = jest.fn(async () => undefined);
    const t = setup({ exportPpt });
    t.$<HTMLButtonElement>("cad-ppt").click();
    await flush();
    expect(exportPpt).toHaveBeenCalledTimes(1);
    const [svg, w, h, title] = (exportPpt.mock.calls[0] as unknown) as [string, number, number, string];
    expect(svg).toMatch(/^<svg/);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(title).toContain("Plate");
    const bare = setup();
    expect(bare.$<HTMLButtonElement>("cad-ppt").hidden).toBe(true);
  });

  it("a fillet from the sketch editor's buttons: two lines selected, a radius typed", () => {
    const t = setup();
    const canvas = t.$<HTMLCanvasElement>("cad-sketch-canvas");
    const tap = (x: number, y: number): void => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 190 + (x * 8) / 3, clientY: 160 - (y * 8) / 3, bubbles: true }));
    };
    t.$<HTMLSelectElement>("cad-shape").value = "sketch";
    t.$<HTMLButtonElement>("cad-add").click();
    document.querySelector<HTMLButtonElement>('[data-sk-tool="rectangle"]')!.click();
    tap(0, 0);
    tap(30, 20);
    document.querySelector<HTMLButtonElement>('[data-sk-tool="select"]')!.click();
    tap(15, 0); // bottom
    tap(30, 10); // right
    t.$<HTMLInputElement>("cad-sketch-dim").value = "R4";
    t.$<HTMLButtonElement>("cad-sketch-fillet").click();
    expect(t.$<HTMLElement>("cad-sketch-msg").textContent).toBe("Rounded with R4; the corner is kept as a construction point, so dimensions to it still hold.");
    t.$<HTMLButtonElement>("cad-sketch-done").click();
    const part = JSON.parse(t.pane.getDoc()).parts.find((p: { shape: string }) => p.shape === "sketch");
    expect(part.sketch.entities.filter((e: { kind: string }) => e.kind === "arc")).toHaveLength(1);
  });
});
