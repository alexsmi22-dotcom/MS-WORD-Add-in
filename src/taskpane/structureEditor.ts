/**
 * The structure editor: OpenChemLib's own CanvasEditor — the ChemDraw-like editor JurisLab shipped before v2.156 —
 * behind the same interface as the page canvas (chemCanvas.ts), so the pane needs no second code path.
 *
 * WHY IT IS BACK (user, live demo 2026-10-19): the page canvas that replaced it let a click anywhere add a bond, did
 * not correct the drawing as it went, and opened a ChemDraw file so small it could not be edited. "In the original
 * editor, it behaved a lot like ChemDraw and would self correct." Drawing and editing structures happen here again;
 * the page canvas stays for what a molecule cannot hold (a ChemDraw page's brackets, arrows and captions).
 *
 * HOW: the editor owns the molecule. Everything the pane reads off a drawing — the page to insert (at ChemDraw's size),
 * its smallest lettering for the USPTO size, Save as .cdxml — comes from a page canvas kept hidden as the page model,
 * given the editor's molecule on every change: one renderer and one insert path for both editors.
 */
import { CanvasEditor, Molecule } from "openchemlib/full";
import type { CdxDoc } from "../lib/cdxml";
import { pageToMolecule } from "../lib/cdxmlMol";
import { createChemCanvas, type CanvasChange, type ChemCanvas, type ChemCanvasHost } from "./chemCanvas";

/** The structure editor, and the element it lives in (the pane shows or hides it). */
export interface StructureEditor extends ChemCanvas {
  /** The editor's own element (OpenChemLib draws its toolbar and page inside). */
  element: HTMLElement;
  /** Why the drawing has no ChemDraw page (the page writer refused it), or "" — the pane says it, never "nothing drawn". */
  refusal(): string;
}

/**
 * The atoms the user selected, as a molecule of their own (null when none are selected): "Insert selected".
 * OpenChemLib marks selection on the molecule's atoms.
 */
function selectedPart(mol: Molecule): Molecule | null {
  const n = mol.getAllAtoms();
  let any = false;
  for (let i = 0; i < n; i++) if (mol.isSelectedAtom(i)) any = true;
  if (!any) return null;
  const part = mol.getCompactCopy();
  // Delete the unselected atoms, last first (indices shift down as atoms go).
  for (let i = n - 1; i >= 0; i--) if (!mol.isSelectedAtom(i)) part.deleteAtom(i);
  part.ensureHelperArrays(Molecule.cHelperNeighbours);
  return part.getAllAtoms() ? part : null;
}

/** True when the molecule's atoms are not all on one point (a drawing worth keeping). */
function spread(mol: Molecule): boolean {
  for (let i = 1; i < mol.getAllAtoms(); i++) {
    if (mol.getAtomX(i) !== mol.getAtomX(0) || mol.getAtomY(i) !== mol.getAtomY(0)) return true;
  }
  return false;
}

export function createStructureEditor(mount: HTMLElement, host: ChemCanvasHost): StructureEditor {
  mount.replaceChildren();
  // Hidden (the 3D tab, the Text tab, another tool), the editor's page is 0 × 0 and OpenChemLib fits the drawing to it
  // (a repaint it defers): every atom moved to one point, so the drawing came back blank and "Use this drawing" carried
  // collapsed coordinates (user: 2D → 3D → 2D, blank canvas). So the drawing is kept as the editor goes hidden, and
  // while hidden everything that reads it reads the kept copy. Shown again, the kept coordinates go back into the
  // editor's own molecule (getMolecule() is live) before OpenChemLib repaints at the real size — this observer is
  // created before the editor's own, and observers run in creation order. No undo step is spent, and none stores the
  // collapsed drawing: OpenChemLib's setMolecule / clearAll store the molecule as it is as the one undo state, so the
  // real coordinates go back in first (review: a 3D-tab edit, then Ctrl+Z, brought the blank drawing back).
  let wasHidden = !mount.clientWidth || !mount.clientHeight;
  /** While hidden: the drawing as it was when the editor went hidden, or the structure given while hidden. */
  let kept: Molecule | null = null;
  /** The kept drawing's coordinates and elements in the editor's atom order (its helper arrays put hydrogens last). */
  let keptAtoms: { xy: Float64Array; z: Int32Array } | null = null;
  let givenWhileHidden = false;
  /** The drawing as it stands — while hidden, a copy of the kept drawing (the editor's own may be collapsed). */
  const current = (): Molecule => (kept ? kept.getCompactCopy() : editor.getMolecule());
  const keepFrom = (mol: Molecule): void => {
    kept = null;
    keptAtoms = null;
    if (!mol.getAllAtoms() || !spread(mol)) return;
    kept = mol.getCompactCopy();
    const order = mol.getCompactCopy();
    order.ensureHelperArrays(Molecule.cHelperNeighbours);
    const n = order.getAllAtoms();
    keptAtoms = { xy: new Float64Array(2 * n), z: new Int32Array(n) };
    for (let i = 0; i < n; i++) {
      keptAtoms.xy[2 * i] = order.getAtomX(i);
      keptAtoms.xy[2 * i + 1] = order.getAtomY(i);
      keptAtoms.z[i] = order.getAtomicNo(i);
    }
  };
  /** The kept coordinates back into the editor's own molecule; false when its atoms are not the same atoms. */
  const writeBack = (): boolean => {
    const k = keptAtoms;
    if (!k) return false;
    const mol = editor.getMolecule();
    mol.ensureHelperArrays(Molecule.cHelperNeighbours);
    if (k.z.length !== mol.getAllAtoms()) return false;
    for (let i = 0; i < k.z.length; i++) if (mol.getAtomicNo(i) !== k.z[i]) return false;
    for (let i = 0; i < k.z.length; i++) {
      mol.setAtomX(i, k.xy[2 * i]);
      mol.setAtomY(i, k.xy[2 * i + 1]);
    }
    return true;
  };
  // Shown again after being hidden (another tool, the page canvas, the Text tab), a structure GIVEN while hidden is
  // fitted to the page: Edit in Draw switched tools and loaded ibuprofen in one step, and the editor showed an empty
  // page under a correct formula (walkthrough 2026-10-19). The refit is moleculeChanged(), which lays the molecule out
  // for the page without storing an undo state — a setMolecule refit made Ctrl+Z forget the last edit (review).
  const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    const hidden = !mount.clientWidth || !mount.clientHeight;
    if (hidden && !wasHidden) keepFrom(editor.getMolecule());
    if (!hidden && wasHidden) {
      const back = kept;
      // Its atoms changed under it (never seen): the kept drawing goes back whole — correct, at one undo step.
      if (back && !writeBack()) editor.setMolecule(back);
      // A frame later, after the editor has resized its own page (the change event is not a user edit).
      if (givenWhileHidden) requestAnimationFrame(() => editor.moleculeChanged());
      kept = null;
      keptAtoms = null;
      givenWhileHidden = false;
    }
    wasHidden = hidden;
  }) : null;
  watcher?.observe(mount);
  const editor = new CanvasEditor(mount, { initialMode: "molecule" });
  /** A structure into the editor. Given while hidden, it is fitted to a 0 × 0 page: it is kept as given until it is
   *  shown and laid out for the page. */
  const give = (mol: Molecule): void => {
    if (wasHidden) writeBack();
    editor.setMolecule(mol);
    if (wasHidden) {
      givenWhileHidden = true;
      keepFrom(mol);
    }
  };
  // The page model: a page canvas nobody sees, holding the editor's molecule as a ChemDraw page.
  const hidden = document.createElement("div");
  hidden.hidden = true;
  hidden.setAttribute("aria-hidden", "true");
  document.body.appendChild(hidden);
  // What the page writer refuses (a query the editor can draw and ChemDraw has no attribute for) is reported here.
  let refused = "";
  const model = createChemCanvas(hidden, { setStatus: (m, k) => void (k === "error" && (refused = m)), downloadFile: host.downloadFile });
  let name = "";
  /** The model is brought up to date only when something reads it (a click does not pay for a page it never uses). */
  let stale = true;
  /**
   * The model given this molecule — emptied FIRST: a molecule the page writer refuses left the model on the previous
   * drawing, and that older picture was what inserted (review). Refused, the model stays empty and the pane draws the
   * structure with OpenChemLib's own picture instead. True when the model holds it.
   */
  const put = (mol: Molecule): boolean => {
    refused = "";
    model.clearAll();
    model.setFragment(mol.isFragment());
    if (!mol.getAllAtoms()) return true;
    model.setMolecule(mol.getCompactCopy());
    if (!model.page().objects.length) {
      refused ||= "the page writer cannot hold this structure";
      return false;
    }
    return true;
  };
  const sync = (): void => {
    if (!stale) return;
    stale = false;
    put(current());
    if (name) model.setName(name);
  };
  let onChange: ((e: CanvasChange) => void) | null = null;
  editor.setOnChangeListener((event) => {
    if (event.type !== "molecule") return;
    stale = true;
    onChange?.({ isUserEvent: event.isUserEvent });
  });
  /** The page model drawn for just the selection, then back to the whole drawing. */
  const withSelection = <T>(read: (m: ChemCanvas) => T): T | null => {
    const part = selectedPart(current());
    if (!part) return null;
    try {
      // Refused, nothing of the model is read (it would be the whole drawing, or an older one).
      return put(part) ? read(model) : null;
    } finally {
      stale = true;
      sync();
    }
  };

  return {
    element: mount,
    refusal: () => {
      sync();
      return refused;
    },
    getMolecule: () => current(),
    chemistry: (selectionOnly) => {
      if (selectionOnly) {
        const part = selectedPart(current());
        return part ? { ok: true, mol: part, notes: [] } : { ok: false, reason: "nothing is selected" };
      }
      return { ok: true, mol: current(), notes: [] };
    },
    setMolecule: (mol) => {
      give(mol);
      stale = true;
    },
    clearAll: () => {
      // The undo state stored is the real drawing (Reset is one Ctrl+Z away), not a collapsed one.
      if (wasHidden) writeBack();
      editor.clearAll();
      kept = null;
      keptAtoms = null;
      givenWhileHidden = false;
      stale = true;
    },
    moleculeChanged: () => {
      editor.moleculeChanged();
      stale = true;
    },
    setOnChangeListener: (cb) => void (onChange = cb),
    setFragment: (on) => {
      editor.getMolecule().setFragment(on);
      kept?.setFragment(on);
      stale = true;
    },
    isFragment: () => editor.getMolecule().isFragment(),
    page: () => {
      sync();
      return model.page();
    },
    loadPage: (doc: CdxDoc) => {
      // A page's structures as one molecule (the pane routes pages that cannot be one to the page canvas).
      const r = pageToMolecule(doc);
      if (!r.ok) return host.setStatus(`This page cannot open in the structure editor: ${r.reason}.`, "error");
      give(r.value.mol);
      stale = true;
    },
    replacePage: (doc: CdxDoc) => {
      const r = pageToMolecule(doc);
      if (!r.ok) return false;
      give(r.value.mol);
      stale = true;
      return true;
    },
    clean: () => {
      const mol = current();
      if (!mol.getAllAtoms()) {
        host.setStatus("Nothing to clean — the canvas is empty.", "error");
        return false;
      }
      // Fresh machine coordinates (OpenChemLib's CoordinateInventor rebuilds wedges from the recorded parities, so
      // drawn stereo survives); setMolecule stores an undo state — the hand layout is one Ctrl+Z away.
      const copy = mol.getCompactCopy();
      copy.inventCoordinates();
      give(copy);
      stale = true;
      return true;
    },
    // Only structures: the editor holds a molecule, nothing else.
    hasDrawing: () => false,
    render: (selectionOnly) => {
      if (selectionOnly) return withSelection((m) => m.render(false));
      sync();
      // Refused by the page writer: no page picture (the pane draws OpenChemLib's own).
      return refused ? null : model.render(false);
    },
    selection: () => (selectedPart(editor.getMolecule()) ? new Set(["selection"]) : new Set()),
    // The editor has its own toolbar.
    setTool: () => {},
    staleNames: () => [],
    setName: (n) => {
      name = n;
      model.setName(n);
    },
    wasSaved: () => false,
    smallestTextPt: (selectionOnly) => {
      if (selectionOnly) return withSelection((m) => m.smallestTextPt(false));
      sync();
      return refused ? null : model.smallestTextPt(false);
    },
  };
}
