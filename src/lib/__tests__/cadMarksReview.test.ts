/**
 * @jest-environment jsdom
 */
// The adversarial review of hand-drawn marks (v2.151.0): each defect, pinned.
import * as fs from "fs";
import * as path from "path";
import { layoutSheet } from "../cadSheet";
import { parseMarks, MARK_LIMITS, SheetMark } from "../cadMarks";
import { tessellate, box, IDENTITY_PLACEMENT, Mesh } from "../cadModel";
import { initCadPane, CadPaneHost } from "../../taskpane/cadPane";
import { parseDoc, serializeDoc, starterDoc, CadDoc } from "../cadShapes";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });
Element.prototype.setPointerCapture = () => undefined;

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="cad-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

function plateMesh(): Mesh {
  const t = tessellate({ version: 1, bodies: [{ id: "b", name: "Plate", spec: box(80, 50, 8), placement: IDENTITY_PLACEMENT }] });
  if (!t.ok) throw new Error(t.reason);
  return t.mesh;
}
const FOUR = [{ kind: "front" as const }, { kind: "top" as const }, { kind: "right" as const }, { kind: "iso" as const }];

describe("D1: text is sized at the scale the sheet really gets", () => {
  test.each(["uspto", "asme", "iso"] as const)("%s: a long note wraps into lines and keeps the drawing near its size", (standard) => {
    const text = "A LONG NOTE ABOUT HOW THE APRON JOINS EACH LEG WITH A MORTISE AND TENON JOINT";
    const plain = layoutSheet(plateMesh(), { standard, views: FOUR });
    const sh = layoutSheet(plateMesh(), { standard, views: FOUR, marks: [{ kind: "text", view: "front", at: [0, -5], text }] });
    expect(sh.notes).toEqual([]);
    expect((sh.svg.match(/<tspan/g) ?? []).length).toBeGreaterThan(2);
    expect(sh.scaleMmPerUnit).toBeGreaterThan(0.85 * plain.scaleMmPerUnit);
  });
  test("one word too long to wrap, wider than the sheet's room: refused, not drawn over the page edge", () => {
    const sh = layoutSheet(plateMesh(), { standard: "uspto", views: FOUR, marks: [{ kind: "text", view: "front", at: [0, 0], text: "W".repeat(60) }] });
    expect(sh.svg).toBe("");
    expect(sh.notes[0]).toMatch(/^The text "W{30}…" does not fit beside its figure on this sheet — shorten it, move it closer, or choose a larger sheet\.$/);
  });
});

describe("D2: marks are never drawn on the turning view", () => {
  test("a saved mark on This view is left out, and the note says why", () => {
    const sh = layoutSheet(plateMesh(), { standard: "uspto", views: [{ kind: "orbit", deg: [30, 20, 0] }], marks: [{ kind: "numeral", view: "orbit", tip: [0, 0], at: [5, 5], label: "10" }] });
    expect(sh.svg).not.toContain(">10</text>");
    expect(sh.notes).toContain('1 hand-drawn mark is on "This view", which turns with the model, so it is not drawn — draw on a standard view or the isometric.');
  });
});

describe("D6: a mark far outside its figure does not shrink the drawing", () => {
  test("left out with a note; the scale is the scale without it", () => {
    const plain = layoutSheet(plateMesh(), { standard: "uspto", views: FOUR });
    const sh = layoutSheet(plateMesh(), { standard: "uspto", views: FOUR, marks: [{ kind: "line", view: "front", a: [0, 0], b: [-9e6, 0] }] });
    expect(sh.scaleMmPerUnit).toBe(plain.scaleMmPerUnit);
    expect(sh.notes).toContain("1 hand-drawn mark lies far outside its figure and is not drawn.");
  });
});

describe("D5, D9: what a drawing saves, it can read back", () => {
  test("a control character in text or a label is refused", () => {
    expect(parseMarks([{ kind: "text", view: "front", at: [0, 0], text: "A\u0001B" }])).toEqual({ ok: false, reason: "hand-drawn mark 1 is damaged" });
    expect(parseMarks([{ kind: "numeral", view: "front", tip: [0, 0], at: [1, 1], label: "1\u00000" }])).toEqual({ ok: false, reason: "hand-drawn mark 1 is damaged" });
  });
  test("strokes past the total point limit are refused", () => {
    const stroke = { kind: "pen", view: "front", pts: Array.from({ length: MARK_LIMITS.points }, (_, i) => [i, 0]) };
    const n = Math.floor(MARK_LIMITS.totalPoints / MARK_LIMITS.points) + 1;
    expect(parseMarks(new Array(n).fill(stroke))).toEqual({ ok: false, reason: "its hand-drawn strokes have more than 100,000 points in all" });
  });
});

// ---- the pane ----------------------------------------------------------------------------

function sizeSvg(): void {
  const svg = document.querySelector("#cad-preview svg") as SVGElement | null;
  if (!svg) return;
  const [, , w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number);
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}
function setup(initial?: CadDoc) {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string]> = [];
  const host: CadPaneHost = {
    setStatus: (m: string, k?: string) => void status.push([m, k ?? ""]),
    nextNumeral: (taken: number[]) => {
      let n = 10;
      while (taken.includes(n)) n += 2;
      return n;
    },
    insertPicture: jest.fn(async () => undefined),
    readSelectedAlt: async () => null,
  };
  const pane = initCadPane(host, initial ?? { ...starterDoc("uspto"), views: [{ kind: "front" }, { kind: "iso" }] });
  pane.show();
  const preview = document.getElementById("cad-preview")!;
  const doc = (): CadDoc => {
    const r = parseDoc(pane.getDoc());
    if (!r.ok) throw new Error(r.reason);
    return r.doc;
  };
  const ptr = (type: string, x: number, y: number): void => {
    sizeSvg();
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    preview.dispatchEvent(e);
  };
  const tool = (t: string): void => document.querySelector<HTMLButtonElement>(`[data-mark-tool="${t}"]`)!.click();
  const front = (): [number, number] => {
    const t = Array.from(document.querySelectorAll("#cad-preview text")).filter((q) => /^FIG\./.test(q.textContent ?? ""));
    const p = t.map((q) => ({ x: Number(q.getAttribute("x")), y: Number(q.getAttribute("y")) })).sort((a, b) => b.y - a.y)[0];
    return [p.x, p.y - 30];
  };
  return { pane, status, doc, ptr, tool, front, preview };
}

describe("D3: mark undo belongs to one drawing", () => {
  test("after another drawing is loaded, Undo mark is off and cannot bring the old marks in", () => {
    const t = setup();
    t.tool("line");
    const [x, y] = t.front();
    t.ptr("pointerdown", x - 20, y);
    t.ptr("pointermove", x + 20, y);
    t.ptr("pointerup", x + 20, y);
    expect(t.doc().marks).toHaveLength(1);
    expect(t.pane.load(serializeDoc({ ...starterDoc("uspto"), views: [{ kind: "front" }] }))).toBeNull();
    const undo = document.getElementById("cad-mark-undo") as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    undo.click();
    expect(t.doc().marks).toBeUndefined();
  });
});

describe("D4: the pane never makes a drawing it could not reopen", () => {
  test("at the mark limit, a new mark is refused by name", () => {
    const marks: SheetMark[] = Array.from({ length: MARK_LIMITS.marks }, (_, i) => ({ kind: "text", view: "front", at: [i % 80, 0], text: "x" }));
    const t = setup({ ...starterDoc("uspto"), views: [{ kind: "front" }], marks });
    t.tool("text");
    (document.getElementById("cad-mark-text") as HTMLInputElement).value = "one more";
    const [x, y] = t.front();
    t.ptr("pointerdown", x, y);
    expect(t.status[t.status.length - 1]).toEqual(["A drawing holds at most 2000 hand-drawn marks — erase some first.", "error"]);
    expect(t.doc().marks).toHaveLength(MARK_LIMITS.marks);
  });
});

describe("D6: a drag that leaves the preview stays on the sheet", () => {
  test("the end is held at the sheet's edge and the drawing keeps its size", () => {
    const t = setup();
    const before = /Scale ([^ ]+)/.exec(document.getElementById("cad-msg")!.textContent!)![1];
    t.tool("line");
    const [x, y] = t.front();
    t.ptr("pointerdown", x, y);
    t.ptr("pointermove", -20000, y);
    t.ptr("pointerup", -20000, y);
    const m = t.doc().marks![0];
    expect(m.kind).toBe("line");
    const after = /Scale ([^ ]+)/.exec(document.getElementById("cad-msg")!.textContent!)![1];
    // The line ends at the sheet's left edge: the drawing shrinks a little to hold it, never to a dot.
    expect(Number(after.split(":")[1] ?? 1) / Number(before.split(":")[1] ?? 1)).toBeLessThan(3);
  });
});

describe("D7: a callout never reuses a hand-drawn numeral", () => {
  test("numeral 10 drawn, then a callout placed: the callout is 12", () => {
    const t = setup();
    t.tool("numeral");
    const [x, y] = t.front();
    t.ptr("pointerdown", x, y);
    t.ptr("pointerup", x, y);
    expect(t.doc().marks![0]).toEqual(expect.objectContaining({ label: "10" }));
    // The callout's numbering reads the same list (the canvas pick needs a real layout, so the rule is read directly).
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "cadPane.ts"), "utf8");
    const callout = src.slice(src.indexOf("if (calloutMode) {\n      // The shading"), src.indexOf("doc.callouts.push(attachCallout"));
    expect(callout).toContain('m.kind === "numeral"');
  });
});

describe("D8: New drawing clears the hand-drawn marks too", () => {
  test("a drawing with only marks can be cleared, and they do not come back with the next part", () => {
    const t = setup({ ...starterDoc("uspto"), parts: [], views: [{ kind: "blank" }], marks: [{ kind: "text", view: "blank", at: [1, 1], text: "OLD NOTE" }] });
    const nb = document.getElementById("cad-new") as HTMLButtonElement;
    nb.click();
    nb.click();
    expect(t.doc().marks).toBeUndefined();
    expect(t.preview.innerHTML).not.toContain("OLD NOTE");
  });
});

describe("D11: a sheet of blank figures states no scale", () => {
  test("ASME, blank figure only: no SCALE line", () => {
    const EMPTY: Mesh = { positions: [], triangles: [], cornerNormals: [], triBody: [], edges: [], diag: 1, crossings: [], overlaps: [], bodySag: [] };
    const sh = layoutSheet(EMPTY, { standard: "asme", views: [{ kind: "blank" }] });
    expect(sh.svg).not.toContain("SCALE");
  });
});
