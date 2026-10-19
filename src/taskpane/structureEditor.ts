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

export function createStructureEditor(mount: HTMLElement, host: ChemCanvasHost): StructureEditor {
  mount.replaceChildren();
  const editor = new CanvasEditor(mount, { initialMode: "molecule" });
  // The page model: a page canvas nobody sees, holding the editor's molecule as a ChemDraw page.
  const hidden = document.createElement("div");
  hidden.hidden = true;
  hidden.setAttribute("aria-hidden", "true");
  document.body.appendChild(hidden);
  const model = createChemCanvas(hidden, { setStatus: () => {}, downloadFile: host.downloadFile });
  let name = "";
  let fragment = false;
  /** The model is brought up to date only when something reads it (a click does not pay for a page it never uses). */
  let stale = true;
  const sync = (): void => {
    if (!stale) return;
    stale = false;
    const mol = editor.getMolecule();
    model.setFragment(mol.isFragment());
    if (mol.getAllAtoms()) model.setMolecule(mol.getCompactCopy());
    else model.clearAll();
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
    const part = selectedPart(editor.getMolecule());
    if (!part) return null;
    model.setMolecule(part);
    try {
      return read(model);
    } finally {
      stale = true;
      sync();
    }
  };

  return {
    element: mount,
    getMolecule: () => editor.getMolecule(),
    chemistry: (selectionOnly) => {
      if (selectionOnly) {
        const part = selectedPart(editor.getMolecule());
        return part ? { ok: true, mol: part, notes: [] } : { ok: false, reason: "nothing is selected" };
      }
      return { ok: true, mol: editor.getMolecule(), notes: [] };
    },
    setMolecule: (mol) => {
      editor.setMolecule(mol);
      stale = true;
    },
    clearAll: () => {
      editor.clearAll();
      stale = true;
    },
    moleculeChanged: () => {
      editor.moleculeChanged();
      stale = true;
    },
    setOnChangeListener: (cb) => void (onChange = cb),
    setFragment: (on) => {
      fragment = on;
      editor.getMolecule().setFragment(on);
    },
    isFragment: () => editor.getMolecule().isFragment() || fragment,
    page: () => {
      sync();
      return model.page();
    },
    loadPage: (doc: CdxDoc) => {
      // A page's structures as one molecule (the pane routes pages that cannot be one to the page canvas).
      const r = pageToMolecule(doc);
      if (!r.ok) return host.setStatus(`This page cannot open in the structure editor: ${r.reason}.`, "error");
      editor.setMolecule(r.value.mol);
      stale = true;
    },
    replacePage: (doc: CdxDoc) => {
      const r = pageToMolecule(doc);
      if (!r.ok) return false;
      editor.setMolecule(r.value.mol);
      stale = true;
      return true;
    },
    clean: () => {
      const mol = editor.getMolecule();
      if (!mol.getAllAtoms()) {
        host.setStatus("Nothing to clean — the canvas is empty.", "error");
        return false;
      }
      // Fresh machine coordinates (OpenChemLib's CoordinateInventor rebuilds wedges from the recorded parities, so
      // drawn stereo survives); setMolecule stores an undo state — the hand layout is one Ctrl+Z away.
      const copy = mol.getCompactCopy();
      copy.inventCoordinates();
      editor.setMolecule(copy);
      stale = true;
      return true;
    },
    // Only structures: the editor holds a molecule, nothing else.
    hasDrawing: () => false,
    render: (selectionOnly) => {
      if (selectionOnly) return withSelection((m) => m.render(false));
      sync();
      return model.render(false);
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
      return model.smallestTextPt(false);
    },
  };
}
