/**
 * @jest-environment jsdom
 */
// USER REPORT (2026-10-19): in the large canvas, 2D → 3D → 2D left the structure editor blank. Hidden, the editor's
// page is 0 × 0 and OpenChemLib fits the drawing to it — every atom moved to one point (measured in Chrome: benzene's
// six atoms all at 0,0), so the drawing came back empty and "Use this drawing" carried collapsed coordinates.
// OpenChemLib's CanvasEditor cannot run in jsdom (constructable stylesheets): a stand-in collapses its molecule as the
// real one does, on a ResizeObserver created in its constructor; observers run in creation order, as in a browser.
import { TextDecoder as NodeTextDecoder } from "util";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

type Mol = import("openchemlib/full").Molecule;
const stand = { setMoleculeCalls: 0, refits: 0, editor: null as null | { mol: Mol; collapse(): void; undo(): void } };

// As OpenChemLib 8.21 (dist/openchemlib-full.pretty.js): setMolecule keeps the caller's molecule as its live one and
// stores the molecule it replaces as the ONE undo state (storeState), as clearAll does; undo puts that state back
// without laying it out again; a repaint on a 0 × 0 page (deferred) fits the drawing to it — every atom on one point —
// and its helper arrays move explicit hydrogens to the end; moleculeChanged lays the molecule out, storing nothing.
jest.mock("openchemlib/full", () => {
  const actual = jest.requireActual("openchemlib/full");
  class StandInEditor {
    mol = new actual.Molecule(0, 0);
    undoState: Mol | null = null;
    constructor(el: HTMLElement) {
      stand.editor = this;
      new ResizeObserver(() => {
        if (!el.clientWidth) pending.push(() => this.collapse());
      }).observe(el);
    }
    collapse() {
      this.mol.ensureHelperArrays(31);
      for (let i = 0; i < this.mol.getAllAtoms(); i++) {
        this.mol.setAtomX(i, 0);
        this.mol.setAtomY(i, 0);
      }
    }
    getMolecule() {
      return this.mol;
    }
    setMolecule(m: Mol) {
      stand.setMoleculeCalls++;
      this.undoState = this.mol.getCompactCopy();
      this.mol = m;
      if (!width) pending.push(() => this.collapse());
    }
    undo() {
      if (this.undoState) this.mol = this.undoState;
    }
    setOnChangeListener() {}
    moleculeChanged() {
      stand.refits++;
    }
    clearAll() {
      this.undoState = this.mol.getCompactCopy();
      this.mol = new actual.Molecule(0, 0);
    }
  }
  return { ...actual, CanvasEditor: StandInEditor };
});
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });

// The mount's size, and ResizeObservers delivered in creation order.
let width = 400;
const pending: Array<() => void> = [];
const observers: Array<{ cb: () => void; el: Element | null }> = [];
(globalThis as Record<string, unknown>).ResizeObserver = class {
  entry: { cb: () => void; el: Element | null };
  constructor(cb: () => void) {
    this.entry = { cb, el: null };
    observers.push(this.entry);
  }
  observe(el: Element) {
    this.entry.el = el;
  }
  disconnect() {}
};
const resize = (w: number): void => {
  width = w;
  for (const o of observers) o.cb();
};
const frames: Array<() => void> = [];
(globalThis as Record<string, unknown>).requestAnimationFrame = (f: () => void) => frames.push(f);
const runFrames = (): void => {
  while (frames.length) frames.shift()!();
};

import { Molecule } from "openchemlib/full";
import { createStructureEditor } from "../structureEditor";

function make() {
  observers.length = 0;
  pending.length = 0;
  frames.length = 0;
  width = 400;
  stand.setMoleculeCalls = 0;
  stand.refits = 0;
  const mount = document.createElement("div");
  Object.defineProperty(mount, "clientWidth", { get: () => width });
  Object.defineProperty(mount, "clientHeight", { get: () => (width ? 300 : 0) });
  document.body.appendChild(mount);
  return createStructureEditor(mount, { setStatus: () => {} });
}

const xy = (m: Mol): string =>
  Array.from({ length: m.getAllAtoms() }, (_, i) => `${m.getAtomX(i).toFixed(2)},${m.getAtomY(i).toFixed(2)}`).join(" ");
const spread = (m: Mol): boolean => new Set(xy(m).split(" ")).size === m.getAllAtoms();

describe("the structure editor hidden and shown again (2D → 3D → 2D)", () => {
  it("shown again, the drawing has its coordinates back — and no undo step was spent", () => {
    const ed = make();
    ed.setMolecule(Molecule.fromSmiles("CC(C)Cc1ccc(cc1)C(C)C(=O)O"));
    const before = xy(stand.editor!.mol);
    const calls = stand.setMoleculeCalls;
    resize(0);
    pending.splice(0).forEach((f) => f());
    expect(spread(stand.editor!.mol)).toBe(false); // the stand-in collapsed it, as OpenChemLib does
    resize(400);
    runFrames();
    expect(xy(stand.editor!.mol)).toBe(before);
    expect(stand.setMoleculeCalls).toBe(calls);
  });

  it("while hidden, what the window reads (the 3D model, Use this drawing) has the real coordinates", () => {
    const ed = make();
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1O"));
    const before = xy(stand.editor!.mol);
    resize(0);
    pending.splice(0).forEach((f) => f());
    expect(xy(ed.getMolecule())).toBe(before);
    const chem = ed.chemistry(false);
    expect(chem.ok && xy(chem.mol)).toBe(before);
  });

  it("twice in a row: still there", () => {
    const ed = make();
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1"));
    const before = xy(stand.editor!.mol);
    for (let k = 0; k < 2; k++) {
      resize(0);
      pending.splice(0).forEach((f) => f());
      resize(400);
      runFrames();
    }
    expect(xy(stand.editor!.mol)).toBe(before);
  });

  it("a structure given while hidden (an edit in the 3D tab) reads at its own coordinates, then is laid out when shown", () => {
    const ed = make();
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1"));
    resize(0);
    pending.splice(0).forEach((f) => f());
    const given = Molecule.fromSmiles("c1ccccc1C");
    const want = xy(given);
    ed.setMolecule(given);
    pending.splice(0).forEach((f) => f());
    expect(xy(ed.getMolecule())).toBe(want);
    const calls = stand.setMoleculeCalls;
    resize(400);
    runFrames();
    expect(stand.editor!.mol.getAllAtoms()).toBe(7);
    expect(xy(stand.editor!.mol)).toBe(want);
    // Laid out for the page by moleculeChanged (no undo state stored), not by another setMolecule.
    expect(stand.refits).toBe(1);
    expect(stand.setMoleculeCalls).toBe(calls);
  });

  it("given while hidden with an explicit H mid-molecule (the editor moves H last): every atom keeps its own place", () => {
    const ed = make();
    resize(0);
    const m = new Molecule(0, 0);
    // C at 0,0 · H at 1,0 · C at 2,0 · O at 3,0, H second: the editor's helper arrays move it to the end.
    [6, 1, 6, 8].forEach((z, i) => {
      const k = m.addAtom(z);
      m.setAtomX(k, i);
      m.setAtomY(k, i === 1 ? 1 : 0);
    });
    m.addBond(0, 1);
    m.addBond(0, 2);
    m.addBond(0, 3);
    ed.setMolecule(m);
    pending.splice(0).forEach((f) => f());
    const placeOf = (mol: Mol, z: number): string => {
      const i = Array.from({ length: mol.getAllAtoms() }, (_, k) => k).find((k) => mol.getAtomicNo(k) === z)!;
      return `${mol.getAtomX(i)},${mol.getAtomY(i)}`;
    };
    expect(placeOf(ed.getMolecule(), 1)).toBe("1,1");
    expect(placeOf(ed.getMolecule(), 8)).toBe("3,0");
    resize(400);
    runFrames();
    expect(placeOf(stand.editor!.mol, 1)).toBe("1,1");
    expect(placeOf(stand.editor!.mol, 8)).toBe("3,0");
  });

  it("the Markush (generic) toggle while hidden reaches what is read", () => {
    const ed = make();
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1"));
    resize(0);
    ed.setFragment(true);
    expect(ed.getMolecule().isFragment()).toBe(true);
  });

  it("review: an edit in the 3D tab, back to 2D, then Ctrl+Z — the drawing before the edit, at its own coordinates (never the collapsed one)", () => {
    const ed = make();
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1"));
    const before = xy(stand.editor!.mol);
    resize(0);
    pending.splice(0).forEach((f) => f());
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1C"));
    pending.splice(0).forEach((f) => f());
    resize(400);
    runFrames();
    stand.editor!.undo();
    expect(stand.editor!.mol.getAllAtoms()).toBe(6);
    expect(xy(stand.editor!.mol)).toBe(before);
  });

  it("review: Reset while hidden, then Ctrl+Z — the real drawing comes back", () => {
    const ed = make();
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1O"));
    const before = xy(stand.editor!.mol);
    resize(0);
    pending.splice(0).forEach((f) => f());
    ed.clearAll();
    resize(400);
    runFrames();
    stand.editor!.undo();
    expect(xy(stand.editor!.mol)).toBe(before);
  });

  it("review: a structure given after showing but before the next frame stays (the one given while hidden never overwrites it)", () => {
    const ed = make();
    resize(0);
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1"));
    pending.splice(0).forEach((f) => f());
    resize(400);
    ed.setMolecule(Molecule.fromSmiles("CCCCO"));
    expect(ed.getMolecule().getAllAtoms()).toBe(5);
    runFrames();
    expect(stand.editor!.mol.getAllAtoms()).toBe(5);
    expect(ed.getMolecule().getAllAtoms()).toBe(5);
  });

  it("cleared while hidden: nothing old comes back", () => {
    const ed = make();
    ed.setMolecule(Molecule.fromSmiles("c1ccccc1"));
    resize(0);
    ed.clearAll();
    resize(400);
    runFrames();
    expect(stand.editor!.mol.getAllAtoms()).toBe(0);
  });
});
