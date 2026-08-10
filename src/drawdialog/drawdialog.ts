// The pop-out drawing window: the OpenChemLib canvas editor at dialog size,
// plus a 3D MODEL tab — a real MMFF94s-minimised conformer of the drawn
// molecule (see src/lib/mol3d.ts), rotatable by drag, zoomable by wheel, in
// ball-and-stick / stick / space-filling styles.
//
// Opened by the pane via Office's dialog API with the current molecule in the
// `mol` query parameter (idcode [+ coordinates] — the encoding that
// round-trips Markush flags and query features). Two ways back:
//   - "Use this drawing"  → messageParent {mol}   (replaces the pane molecule)
//   - "Insert 3D picture" → messageParent {mol3d} (idcode + the view the user
//     set); the PANE regenerates the same conformer from the idcode (fixed
//     seed — same coordinates, guaranteed) and inserts the print-resolution
//     figure. The message stays small and the idcode stays the single source
//     of truth.

import { CanvasEditor, Molecule } from "openchemlib/full";
import { rgroupLabels, cleanedCopy } from "../lib/builder";
import {
  generate3d, isMol3dError, Mol3dModel, Mol3dView, Mol3dStyle,
  defaultMol3dView, rotateView, projectScene, paintOps,
} from "../lib/mol3d";

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function showError(msg: string): void {
  const el = byId<HTMLElement>("error");
  el.textContent = msg;
  el.style.display = "block";
}

function clearError(): void {
  byId<HTMLElement>("error").style.display = "none";
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
  // whatever the fragment flag says — never show a formula counting R at mass
  // 0. For a concrete molecule the molecular weight rides along.
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
        const f = mol.getMolecularFormula();
        const mw = Math.round(f.relativeWeight * 100) / 100;
        info.textContent = mw ? `${f.formula} · MW ${mw}` : f.formula;
      }
    } catch {
      info.textContent = "";
    }
  }
  updateInfo();
  editor.setOnChangeListener((event) => {
    if (event.type === "molecule") updateInfo();
  });

  // -------------------------------------------------------------------------
  // 3D model tab
  // -------------------------------------------------------------------------
  const tab2dBtn = byId<HTMLButtonElement>("tab-2d");
  const tab3dBtn = byId<HTMLButtonElement>("tab-3d");
  const editorEl = byId<HTMLElement>("editor");
  const wrap3d = byId<HTMLElement>("view3d-wrap");
  const canvas3d = byId<HTMLCanvasElement>("canvas3d");
  const note3d = byId<HTMLElement>("note3d");
  const styleSel = byId<HTMLSelectElement>("style3d");
  const showHBox = byId<HTMLInputElement>("show-h");
  const spinBox = byId<HTMLInputElement>("spin3d");
  const use3dBtn = byId<HTMLButtonElement>("use3d-btn");
  const useBtn = byId<HTMLButtonElement>("use-btn");
  const cleanBtn = byId<HTMLButtonElement>("clean-btn");

  let model3d: Mol3dModel | null = null;
  let model3dIdcode = "";
  let computingIdcode = ""; // a pending generation; re-entry must not duplicate it
  let view3d: Mol3dView = defaultMol3dView();
  let spinHandle = 0;

  function render3d(): void {
    if (!model3d) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas3d.clientWidth;
    const h = canvas3d.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas3d.width !== Math.round(w * dpr) || canvas3d.height !== Math.round(h * dpr)) {
      canvas3d.width = Math.round(w * dpr);
      canvas3d.height = Math.round(h * dpr);
    }
    const ctx = canvas3d.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view3d.style = styleSel.value as Mol3dStyle;
    view3d.showH = showHBox.checked;
    const ops = projectScene(model3d, view3d, w, h);
    paintOps(ctx, ops, w, h);
    // An all-hydrogen molecule with hydrogens hidden shows nothing — say so,
    // and never offer to insert a blank white rectangle.
    if (ops.length === 0) {
      note3d.textContent = "Nothing visible — every atom is a hydrogen and hydrogens are hidden.";
      use3dBtn.disabled = true;
    } else {
      note3d.textContent = model3d.caveats.join(" ");
      use3dBtn.disabled = false;
    }
  }

  /** (Re)generates the conformer when the 3D tab is shown, if the molecule
   *  changed. Generation is synchronous and can take seconds for flexible
   *  molecules — the note says so BEFORE the thread blocks. */
  function refresh3d(): void {
    const mol = editor.getMolecule();
    if (mol.getAllAtoms() === 0) {
      model3d = null;
      model3dIdcode = "";
      note3d.textContent = "Draw a molecule in the 2D editor first.";
      use3dBtn.disabled = true;
      const ctx = canvas3d.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas3d.width, canvas3d.height);
      return;
    }
    const idcode = mol.getIDCode();
    if (idcode === model3dIdcode && model3d) {
      render3d();
      return;
    }
    if (idcode === computingIdcode) return; // that exact generation is already queued
    computingIdcode = idcode;
    note3d.textContent = "Computing 3D conformer (MMFF94s)…";
    use3dBtn.disabled = true;
    // Let the note paint before the synchronous generation blocks the thread.
    window.setTimeout(() => {
      const r = generate3d(idcode);
      computingIdcode = "";
      if (isMol3dError(r)) {
        model3d = null;
        model3dIdcode = "";
        note3d.textContent = r.error;
        const ctx = canvas3d.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas3d.width, canvas3d.height);
        return;
      }
      model3d = r;
      model3dIdcode = idcode;
      view3d = { ...defaultMol3dView(), style: styleSel.value as Mol3dStyle, showH: showHBox.checked };
      note3d.textContent = r.caveats.join(" ");
      use3dBtn.disabled = false;
      render3d();
    }, 30);
  }

  function setTab(threeD: boolean): void {
    tab2dBtn.classList.toggle("active", !threeD);
    tab3dBtn.classList.toggle("active", threeD);
    tab2dBtn.setAttribute("aria-selected", String(!threeD));
    tab3dBtn.setAttribute("aria-selected", String(threeD));
    editorEl.style.display = threeD ? "none" : "block";
    wrap3d.style.display = threeD ? "flex" : "none";
    useBtn.style.display = threeD ? "none" : "inline-block";
    cleanBtn.style.display = threeD ? "none" : "inline-block";
    use3dBtn.style.display = threeD ? "inline-block" : "none";
    if (threeD) {
      refresh3d();
    } else if (spinBox.checked) {
      spinBox.checked = false;
      stopSpin();
    }
  }
  tab2dBtn.addEventListener("click", () => setTab(false));
  tab3dBtn.addEventListener("click", () => setTab(true));

  // Drag to rotate; wheel to zoom.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas3d.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas3d.setPointerCapture(e.pointerId);
  });
  canvas3d.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    view3d = rotateView(view3d, e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
    render3d();
  });
  canvas3d.addEventListener("pointerup", () => {
    dragging = false;
  });
  // A cancelled drag (touch interruption, window switch) must not leave
  // `dragging` stuck true — that would silently pause the spin loop forever.
  canvas3d.addEventListener("pointercancel", () => {
    dragging = false;
  });
  canvas3d.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view3d = { ...view3d, zoom: Math.min(5, Math.max(0.25, view3d.zoom * factor)) };
    render3d();
  }, { passive: false });

  function stopSpin(): void {
    if (spinHandle) cancelAnimationFrame(spinHandle);
    spinHandle = 0;
  }
  spinBox.addEventListener("change", () => {
    stopSpin();
    if (spinBox.checked) {
      const step = (): void => {
        if (!dragging) {
          view3d = rotateView(view3d, 1.6, 0);
          render3d();
        }
        spinHandle = requestAnimationFrame(step);
      };
      spinHandle = requestAnimationFrame(step);
    }
  });

  styleSel.addEventListener("change", render3d);
  showHBox.addEventListener("change", render3d);
  byId<HTMLButtonElement>("reset3d-btn").addEventListener("click", () => {
    view3d = { ...defaultMol3dView(), style: styleSel.value as Mol3dStyle, showH: showHBox.checked };
    render3d();
  });
  window.addEventListener("resize", render3d);

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------
  cleanBtn.addEventListener("click", () => {
    const mol = editor.getMolecule();
    if (mol.getAllAtoms() === 0) {
      showError("Nothing to clean — the canvas is empty.");
      return;
    }
    clearError();
    try {
      // setMolecule stores an undo state, so the hand-drawn layout is one
      // Ctrl+Z away if the machine layout is worse.
      editor.setMolecule(cleanedCopy(mol));
      updateInfo();
    } catch (error) {
      showError(`Could not clean the structure: ${(error as Error).message}`);
    }
  });

  useBtn.addEventListener("click", () => {
    const mol = editor.getMolecule();
    if (mol.getAllAtoms() === 0) {
      showError("Nothing drawn yet — draw a structure, or Cancel.");
      return;
    }
    const enc = mol.getIDCodeAndCoordinates();
    Office.context.ui.messageParent(JSON.stringify({ mol: `${enc.idCode} ${enc.coordinates}` }));
  });

  use3dBtn.addEventListener("click", () => {
    if (!model3d || !model3dIdcode) {
      showError("No 3D model to insert yet.");
      return;
    }
    // The idcode plus the VIEW travels — the pane regenerates the identical
    // conformer (fixed seed) and renders exactly this orientation at print
    // resolution. What you see is what inserts.
    Office.context.ui.messageParent(JSON.stringify({
      mol3d: {
        idcode: model3dIdcode,
        style: styleSel.value,
        showH: showHBox.checked,
        rot: view3d.rot,
        zoom: view3d.zoom,
      },
    }));
  });

  byId<HTMLButtonElement>("cancel-btn").addEventListener("click", () => {
    Office.context.ui.messageParent(JSON.stringify({ cancel: true }));
  });
});
