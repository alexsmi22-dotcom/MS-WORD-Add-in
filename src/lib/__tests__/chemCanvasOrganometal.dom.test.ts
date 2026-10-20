/**
 * @jest-environment jsdom
 */
// The page canvas's organometallic tools (docs/SCOPE-ORGANOMETALLIC.md), driven as a user drives them: a metallocene
// template placed with one click, an η-bond drawn ring-then-metal and metal-then-ring, erased, undone; the readout
// says in plain words why a metallocene has no single formula.
import { TextDecoder as NodeTextDecoder } from "util";
import { createChemCanvas, ChemCanvas } from "../../taskpane/chemCanvas";
import { writeCdxml } from "../cdxmlEdit";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

function setup() {
  document.body.innerHTML = '<div id="mount"></div>';
  const status: Array<[string, string]> = [];
  const c: ChemCanvas = createChemCanvas(document.getElementById("mount")!, { setStatus: (m, k) => void status.push([m, k ?? ""]) });
  const surface = document.querySelector<HTMLElement>(".chem-canvas-surface")!;
  const at = (x: number, y: number): { clientX: number; clientY: number } => {
    const svg = surface.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return { clientX: x - vx, clientY: y - vy };
  };
  const click = (x: number, y: number): void => {
    surface.dispatchEvent(new MouseEvent("pointerdown", { ...at(x, y), button: 0, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointerup", { ...at(x, y), bubbles: true }));
    surface.dispatchEvent(new MouseEvent("click", { ...at(x, y), bubbles: true }));
  };
  const tool = (t: string): void => document.querySelector<HTMLButtonElement>(`[data-chem-tool="${t}"]`)!.click();
  const choose = (sel: string, v: string): void => {
    const s = document.querySelector<HTMLSelectElement>(sel)!;
    s.value = v;
    s.dispatchEvent(new Event("change"));
  };
  const value = (v: string): void => {
    document.querySelector<HTMLInputElement>("[data-chem-value]")!.value = v;
  };
  const xml = (): string => writeCdxml(c.page().root);
  const nodes = (): Array<{ id: string; p: [number, number]; type: string; label: string }> =>
    c.page().objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.nodes.map((n) => ({ id: n.id, p: n.p as [number, number], type: n.nodeType, label: n.label?.runs.map((r) => r.text).join("") ?? "" })) : [])));
  const bonds = (): Array<{ id: string; b: string; e: string }> =>
    c.page().objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.bonds.map((b) => ({ id: b.id, b: b.b, e: b.e })) : [])));
  const centres = (): number => nodes().filter((n) => n.type === "MultiAttachment").length;
  const last = (): [string, string] => status[status.length - 1];
  const undo = (): void => document.querySelector<HTMLButtonElement>('[data-chem-action="undo"]')!.click();
  return { c, click, tool, choose, value, xml, nodes, bonds, centres, last, undo };
}

describe("Metallocene tool", () => {
  test("its template list is shown only with the tool; one click places Cp₂ZrCl₂ with two η-bonds; Undo takes it back", () => {
    const t = setup();
    const sel = document.querySelector<HTMLSelectElement>("[data-chem-template]")!;
    expect(sel.hidden).toBe(true);
    t.tool("metallocene");
    expect(sel.hidden).toBe(false);
    t.choose("[data-chem-template]", "metallocene-dichloride");
    t.click(200, 200);
    expect(t.centres()).toBe(2);
    expect(t.xml()).toContain('Element="40"');
    expect(t.last()[1]).toBe("success");
    t.undo();
    expect(t.centres()).toBe(0);
  });

  test("the readout says in plain words why a metallocene has no single formula", () => {
    const t = setup();
    t.tool("metallocene");
    t.click(200, 200);
    const r = t.c.chemistry();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/a metal bound to a whole ring \(an η-bond, as in a metallocene\)/);
  });

  test("every template places and renders on the page", () => {
    for (const id of ["metallocene-dichloride", "ansa-metallocene", "half-sandwich", "metallocene-borohydride", "polymer-metallocene"]) {
      const t = setup();
      t.tool("metallocene");
      t.choose("[data-chem-template]", id);
      t.click(200, 260);
      expect(t.centres()).toBeGreaterThan(0);
      expect(t.c.render(false)).not.toBeNull();
    }
  });
});

describe("placeTemplate (the Organometallic row under Build ▸ Draw)", () => {
  test("placed beside what is drawn, clear of it; a polymer's brackets move with its structure (walkthrough: they stayed behind)", () => {
    const t = setup();
    t.c.placeTemplate!("ansa-metallocene");
    const firstRight = Math.max(...t.nodes().map((n) => n.p[0]));
    t.c.placeTemplate!("polymer-metallocene");
    const second = t.nodes().filter((n) => n.p[0] > firstRight);
    expect(second.length).toBeGreaterThan(10);
    // Nothing of the second sits inside the first: every atom placed second lies right of the first's rightmost
    // atom (review: the earlier count check passed whatever overlapped).
    const firstIds = new Set(t.nodes().filter((n) => n.p[0] <= firstRight).map((n) => n.id));
    expect(firstIds.size + second.length).toBe(t.nodes().length);
    expect(Math.min(...second.map((n) => n.p[0]))).toBeGreaterThan(firstRight + 10);
    const xs = second.map((n) => n.p[0]);
    const brackets = [...t.xml().matchAll(/GraphicType="Bracket"/g)].length;
    expect(brackets).toBe(2);
    for (const m of t.xml().matchAll(/<graphic [^>]*BoundingBox="([^"]+)"[^>]*GraphicType="Bracket"/g)) {
      const bx = Number(m[1].split(" ")[0]);
      expect(bx).toBeGreaterThan(Math.min(...xs) - 1);
      expect(bx).toBeLessThan(Math.max(...xs) + 1);
    }
    expect(t.last()[1]).toBe("success");
  });
});

describe("η-bond tool", () => {
  /** A Cp ring and a Zr atom placed on the page, not yet bound. */
  function ringAndZr() {
    const t = setup();
    t.tool("ring");
    t.choose("[data-chem-ring]", "cyclopentadienyl");
    t.click(150, 100);
    t.tool("atom");
    t.value("Zr");
    t.click(150, 170);
    const zr = t.nodes().find((n) => n.label === "Zr")!;
    const ringAtoms = t.nodes().filter((n) => n.label === "");
    const b = t.bonds().find((x) => ringAtoms.some((a) => a.id === x.b))!;
    const pa = ringAtoms.find((a) => a.id === b.b)!.p, pb = ringAtoms.find((a) => a.id === b.e)!.p;
    return { t, zr, bondMid: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] as [number, number] };
  }

  test("ring, then metal: an η⁵-bond, said so", () => {
    const { t, zr, bondMid } = ringAndZr();
    t.tool("hapto");
    t.click(...bondMid);
    expect(t.last()[0]).toMatch(/Ring of 5 chosen — now click the metal/);
    t.click(...zr.p);
    expect(t.centres()).toBe(1);
    expect(t.last()).toEqual([expect.stringMatching(/η⁵-bond drawn/), "success"]);
  });

  test("a click anywhere inside the ring chooses it (aiming at an edge missed in a walkthrough)", () => {
    const { t, zr } = ringAndZr();
    const ring = t.nodes().filter((n) => n.label === "");
    const cx = ring.reduce((s, n) => s + n.p[0], 0) / ring.length, cy = ring.reduce((s, n) => s + n.p[1], 0) / ring.length;
    t.tool("hapto");
    t.click(cx, cy);
    expect(t.last()[0]).toMatch(/Ring of 5 chosen/);
    t.click(...zr.p);
    expect(t.centres()).toBe(1);
  });

  test("metal, then ring: the same", () => {
    const { t, zr, bondMid } = ringAndZr();
    t.tool("hapto");
    t.click(...zr.p);
    expect(t.last()[0]).toMatch(/Metal chosen — now click the ring/);
    t.click(...bondMid);
    expect(t.centres()).toBe(1);
  });

  test("empty paper or an unlabelled chain atom is answered, not ignored; switching tools forgets the first click", () => {
    const { t, zr, bondMid } = ringAndZr();
    t.tool("hapto");
    t.click(400, 400);
    expect(t.last()).toEqual([expect.stringMatching(/Click inside a ring/), "error"]);
    t.click(...bondMid);
    // A stray click after choosing the ring keeps it (walkthrough): the metal still completes the bond.
    t.click(400, 400);
    expect(t.last()).toEqual([expect.stringMatching(/Ring of 5 still chosen/), "error"]);
    t.click(...zr.p);
    expect(t.centres()).toBe(1);
    t.undo();
    t.click(...bondMid);
    t.tool("select");
    t.tool("hapto");
    t.click(...zr.p);
    expect(t.last()[0]).toMatch(/Metal chosen/);
    expect(t.centres()).toBe(0);
  });

  test("Erase on the η-bond line removes it and its centre; the ring and the metal stay", () => {
    const { t, zr, bondMid } = ringAndZr();
    t.tool("hapto");
    t.click(...bondMid);
    t.click(...zr.p);
    const centre = t.nodes().find((n) => n.type === "MultiAttachment")!;
    const mid: [number, number] = [(centre.p[0] + zr.p[0]) / 2, (centre.p[1] + zr.p[1]) / 2];
    t.tool("erase");
    t.click(...mid);
    expect(t.centres()).toBe(0);
    expect(t.nodes().filter((n) => n.label === "Zr")).toHaveLength(1);
    expect(t.nodes()).toHaveLength(6);
  });

  test("a click inside the ring (where the centre sits) never labels the centre", () => {
    const { t, zr, bondMid } = ringAndZr();
    t.tool("hapto");
    t.click(...bondMid);
    t.click(...zr.p);
    const centre = t.nodes().find((n) => n.type === "MultiAttachment")!;
    t.tool("atom");
    t.value("N");
    const count = t.nodes().length;
    t.click(...centre.p);
    expect(t.nodes().find((n) => n.id === centre.id)!.type).toBe("MultiAttachment");
    // Nor is a new atom stacked on it (review: the count went 10 → 11).
    expect(t.nodes()).toHaveLength(count);
    expect(t.last()).toEqual([expect.stringMatching(/centre of an η-bond/), "error"]);
  });

  test("round 2: a bond drag from the centre is refused (no atom on top of it); a click at a bound ring's centre still picks the ring", () => {
    const { t, zr, bondMid } = ringAndZr();
    t.tool("hapto");
    t.click(...bondMid);
    t.click(...zr.p);
    const centre = t.nodes().find((n) => n.type === "MultiAttachment")!;
    const count = t.nodes().length;
    t.tool("bond");
    const surface = document.querySelector<HTMLElement>(".chem-canvas-surface")!;
    const svg = surface.querySelector("svg")!;
    const [vx, vy] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const ev = (type: string, x: number, y: number): void => void surface.dispatchEvent(new MouseEvent(type, { clientX: x - vx, clientY: y - vy, button: 0, buttons: 1, bubbles: true }));
    ev("pointerdown", ...centre.p);
    ev("pointermove", centre.p[0] - 20, centre.p[1]);
    ev("pointermove", centre.p[0] - 40, centre.p[1]);
    ev("pointerup", centre.p[0] - 40, centre.p[1]);
    ev("click", centre.p[0] - 40, centre.p[1]);
    expect(t.nodes()).toHaveLength(count);
    // The η tool at the centre itself (on the η line): the ring is chosen (it is already bound, so the metal says so).
    t.tool("hapto");
    t.click(...centre.p);
    expect(t.last()[0]).toMatch(/Ring of 5 chosen/);
  });

  test("review: Undo after choosing a ring forgets the choice (a stale pick bound a ring the user never chose)", () => {
    const { t, zr, bondMid } = ringAndZr();
    t.tool("hapto");
    t.click(...bondMid);
    expect(t.last()[0]).toMatch(/Ring of 5 chosen/);
    // Undo and Redo: the Zr is back where it was, but the drawing changed twice — the click starts a new choice.
    t.undo();
    document.querySelector<HTMLButtonElement>('[data-chem-action="redo"]')!.click();
    expect(t.nodes().some((n) => n.label === "Zr")).toBe(true);
    t.click(...zr.p);
    expect(t.centres()).toBe(0);
    expect(t.last()[0]).toMatch(/Metal chosen/);
  });
});
