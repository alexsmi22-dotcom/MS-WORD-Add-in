// The pop-out drawing window: the same OpenChemLib canvas editor the pane
// hosts, at dialog size. Opened by the pane via Office's dialog API with the
// current molecule in the `mol` query parameter (idcode [+ coordinates] — the
// encoding that round-trips Markush flags and query features); "Use this
// drawing" hands the result back through messageParent in the same form.

import { CanvasEditor, Molecule } from "openchemlib/full";
import { rgroupLabels } from "../lib/builder";

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function showError(msg: string): void {
  const el = byId<HTMLElement>("error");
  el.textContent = msg;
  el.style.display = "block";
}

Office.onReady(() => {
  let editor: CanvasEditor;
  try {
    editor = new CanvasEditor(byId<HTMLElement>("editor"), { initialMode: "molecule" });
  } catch (error) {
    showError(`The drawing canvas could not start here: ${(error as Error).message}`);
    return;
  }

  const params = new URLSearchParams(window.location.search);

  // The pane refuses to carry an oversized structure in the URL; say so
  // rather than presenting a blank canvas as a fresh start ("Use this
  // drawing" REPLACES the pane's molecule).
  if (params.get("tooLarge")) {
    showError(
      "The structure in the pane was too large to carry into this window, so this canvas starts blank — “Use this drawing” will REPLACE the pane's drawing.",
    );
  }

  // Seed with the pane's molecule, if one was passed.
  const seed = params.get("mol");
  if (seed) {
    try {
      const [idcode, coordinates] = seed.split(/\s+/);
      const mol = coordinates ? Molecule.fromIDCode(idcode, coordinates) : Molecule.fromIDCode(idcode);
      if (mol.getAllAtoms() > 0) editor.setMolecule(mol);
    } catch {
      // A bad seed just means starting from a blank canvas.
    }
  }

  const info = byId<HTMLElement>("info");
  // Same display contract as the pane: an R-group makes the structure a genus
  // whatever the fragment flag says — never show a formula counting R at mass 0.
  function updateInfo(): void {
    const mol = editor.getMolecule();
    if (mol.getAllAtoms() === 0) {
      info.textContent = "";
      return;
    }
    try {
      if (mol.isFragment() || rgroupLabels(mol).length > 0) {
        info.textContent = "generic structure";
      } else {
        info.textContent = mol.getMolecularFormula().formula;
      }
    } catch {
      info.textContent = "";
    }
  }
  updateInfo();
  editor.setOnChangeListener((event) => {
    if (event.type === "molecule") updateInfo();
  });

  byId<HTMLButtonElement>("use-btn").addEventListener("click", () => {
    const mol = editor.getMolecule();
    if (mol.getAllAtoms() === 0) {
      showError("Nothing drawn yet — draw a structure, or Cancel.");
      return;
    }
    const enc = mol.getIDCodeAndCoordinates();
    Office.context.ui.messageParent(JSON.stringify({ mol: `${enc.idCode} ${enc.coordinates}` }));
  });

  byId<HTMLButtonElement>("cancel-btn").addEventListener("click", () => {
    Office.context.ui.messageParent(JSON.stringify({ cancel: true }));
  });
});
