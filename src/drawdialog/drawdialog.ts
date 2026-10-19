// The pop-out drawing window: JurisLab's chemistry canvas (chemCanvas.ts, the pane's own) at dialog size,
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

import { Molecule } from "openchemlib/full";
import { createChemCanvas, ChemCanvas } from "../taskpane/chemCanvas";
import { readCdxml } from "../lib/cdxml";
import { writeCdxml } from "../lib/cdxmlEdit";
import { rgroupLabels } from "../lib/builder";
import {
  generate3d, isMol3dError, Mol3dModel, Mol3dView, Mol3dStyle, DrawOp,
  defaultMol3dView, rotateView, projectScene, paintOps, hitTest,
} from "../lib/mol3d";
import {
  changeElement, deleteAtomIn, setBondOrderIn, deleteBondIn, attachFragment,
  addTemplate, MOL_TEMPLATES, ATTACH_GROUPS, EDIT_ELEMENTS, Mol3dEditResult,
} from "../lib/mol3dEdit";

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

// Delivery marker for the offline gate (scripts/check-offline.js): proves this
// bundle was served and executed with the network cut. Module scope on purpose —
// Office.onReady reports no host in a plain browser and never gets this far.
declare const __APP_VERSION__: string;
document.documentElement.dataset.jurislabVersion = __APP_VERSION__;

Office.onReady(() => {
  let editor: ChemCanvas;
  try {
    editor = createChemCanvas(byId<HTMLElement>("editor"), {
      // The window's one message line: refusals show; tool help stays quiet.
      setStatus: (m, k) => (k === "error" ? showError(m) : clearError()),
    });
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

  // Seed with the pane's page — structures, brackets, arrows, text, group labels, as ChemDraw keeps them —
  // from the URL (?page=), or, when too long for a URL, by message once this window says it is ready.
  const send = (o: unknown): void => Office.context.ui.messageParent(JSON.stringify(o));
  const loadSeed = (text: string | null): void => {
    if (!text) return;
    let w: { page?: unknown; frag?: unknown } = {};
    try {
      w = JSON.parse(text);
    } catch {
      /* refused below */
    }
    const r = typeof w.page === "string" ? readCdxml(w.page) : null;
    if (!r || !r.ok) {
      showError(`The pane's drawing could not be read here${r && !r.ok ? ` (${r.reason})` : ""} — this canvas starts blank, and “Use this drawing” would REPLACE the pane's drawing. Cancel to keep it.`);
      return;
    }
    editor.loadPage(r.doc);
    editor.setFragment(w.frag === true);
    updateInfo();
  };
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
  editor.setOnChangeListener(() => updateInfo());

  // The pane's drawing arrives once the readout above exists (loadSeed updates it).
  if (params.get("wait") && typeof Office.context.ui.addHandlerAsync !== "function") {
    // A host without window messaging at all: ask for the structure the older way.
    showError("This version of Word cannot hand a drawing this large to a window — this canvas starts blank, and “Use this drawing” would REPLACE the pane's drawing. Cancel to keep it.");
    send({ needMol: true });
  } else if (params.get("wait")) {
    Office.context.ui.addHandlerAsync(
      Office.EventType.DialogParentMessageReceived,
      (arg: { message?: string }) => loadSeed(typeof arg.message === "string" ? arg.message : null),
      (res) => {
        if (res.status === Office.AsyncResultStatus.Succeeded) send({ ready: true });
        else {
          // This Word cannot message a window: the pane is asked for the structure the older way (in the address).
          showError("This version of Word cannot hand a drawing this large to a window — this canvas starts blank, and “Use this drawing” would REPLACE the pane's drawing. Cancel to keep it.");
          send({ needMol: true });
        }
      },
    );
  } else if (params.get("page") !== null) loadSeed(JSON.stringify({ page: params.get("page"), frag: params.get("frag") === "1" }));
  else loadSeed(params.get("seed"));
  // An older pane's seed (a structure's idcode).
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

  const labelsBox = byId<HTMLInputElement>("labels3d");
  const editBar = byId<HTMLElement>("edit3d-bar");
  const editWhat = byId<HTMLElement>("edit3d-what");
  const elemWrap = byId<HTMLElement>("elem3d");
  const attachSel = byId<HTMLSelectElement>("attach3d");
  const bondBtns = byId<HTMLElement>("bond3d-btns");
  const delAtomBtn = byId<HTMLButtonElement>("del-atom3d");
  const tpl3dSel = byId<HTMLSelectElement>("tpl3d");
  const tpl2dSel = byId<HTMLSelectElement>("tpl2d");

  let model3d: Mol3dModel | null = null;
  let model3dIdcode = "";
  let computingIdcode = ""; // a pending generation; re-entry must not duplicate it
  let view3d: Mol3dView = defaultMol3dView();
  let spinHandle = 0;
  let lastOps: DrawOp[] = [];
  /** Selected atom or bond, as indices into fromIDCode(model3dIdcode) — the
   *  order pin ("LOAD-BEARING" test in mol3d.test.ts) guarantees these match
   *  the conformer's own indices for heavy atoms and their bonds. */
  let sel: { atom?: number; bond?: number } | null = null;

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
    view3d.showLabels = labelsBox.checked;
    const ops = projectScene(model3d, view3d, w, h);
    lastOps = ops;
    paintOps(ctx, ops, w, h);
    // Selection halo, drawn OVER the scene (never part of the insert).
    if (sel) {
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      for (const op of ops) {
        if (sel.atom !== undefined && op.kind === "sphere" && op.atom === sel.atom) {
          ctx.beginPath();
          ctx.arc(op.x, op.y, op.r + 4, 0, 2 * Math.PI);
          ctx.stroke();
        }
        if (sel.bond !== undefined && op.kind === "rod" && op.bond === sel.bond) {
          ctx.beginPath();
          ctx.moveTo(op.x1, op.y1);
          ctx.lineTo(op.x2, op.y2);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    // An all-hydrogen molecule with hydrogens hidden shows nothing — say so,
    // and never offer to insert a blank white rectangle.
    if (ops.length === 0) {
      note3d.textContent = "Nothing visible — every atom is a hydrogen and hydrogens are hidden.";
      use3dBtn.disabled = true;
    } else if (!sel) {
      note3d.textContent = model3d.caveats.join(" ");
      use3dBtn.disabled = false;
    }
  }

  /** (Re)generates the conformer when the 3D tab is shown, if the molecule
   *  changed. Generation is synchronous and can take seconds for flexible
   *  molecules — the note says so BEFORE the thread blocks. */
  function refresh3d(): void {
    const chem = editor.chemistry();
    const mol = chem.ok ? chem.mol : editor.getMolecule();
    if (mol.getAllAtoms() === 0) {
      model3d = null;
      model3dIdcode = "";
      // A page with no single structure (a reaction, a polymer, a label with no formula) says why.
      note3d.textContent = chem.ok || !editor.page().objects.length ? "Draw a molecule in the 2D editor first." : `No 3D model: ${chem.reason}.`;
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
      sel = null;
      updateEditBar();
      view3d = { ...defaultMol3dView(), style: styleSel.value as Mol3dStyle, showH: showHBox.checked, showLabels: labelsBox.checked };
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
    tpl2dSel.style.display = threeD ? "none" : "inline-block";
    use3dBtn.style.display = threeD ? "inline-block" : "none";
    if (threeD) {
      refresh3d();
    } else {
      deselect();
      if (spinBox.checked) {
        spinBox.checked = false;
        stopSpin();
      }
    }
  }
  tab2dBtn.addEventListener("click", () => setTab(false));
  tab3dBtn.addEventListener("click", () => setTab(true));

  // -----------------------------------------------------------------------
  // Building IN the 3D view: click an atom or bond to select it, then use
  // the edit bar. Edits run on Molecule.fromIDCode(model3dIdcode) — the
  // molecule whose atom order the conformer provably shares — and flow
  // through editor.setMolecule, so the 2D tab, the undo stack, and the 3D
  // regeneration stay one chain. Hydrogens are implicit in that molecule:
  // clicking one is answered, not silently ignored.
  // -----------------------------------------------------------------------
  function updateEditBar(): void {
    if (!sel || !model3d) {
      editBar.style.display = "none";
      return;
    }
    editBar.style.display = "flex";
    const isAtom = sel.atom !== undefined;
    elemWrap.style.display = isAtom ? "inline" : "none";
    attachSel.style.display = isAtom ? "inline-block" : "none";
    delAtomBtn.style.display = isAtom ? "inline-block" : "none";
    bondBtns.style.display = isAtom ? "none" : "inline";
    if (isAtom) {
      editWhat.textContent = `${model3d.atoms[sel.atom!].el} atom:`;
    } else {
      const b = model3d.bonds[sel.bond!];
      editWhat.textContent = `${model3d.atoms[b.a].el}–${model3d.atoms[b.b].el} bond:`;
    }
  }

  function deselect(): void {
    sel = null;
    updateEditBar();
    render3d();
  }

  function applyEdit(r: Mol3dEditResult): void {
    if (r.error) {
      note3d.textContent = r.error;
      return;
    }
    if (!r.mol) return;
    sel = null;
    updateEditBar();
    editor.setMolecule(r.mol); // undo state stored; 2D stays in sync
    updateInfo();
    refresh3d(); // idcode changed → regenerate the conformer
  }

  /** The molecule the 3D indices address. Null only if the idcode is stale. */
  function editBase(): Molecule | null {
    if (!model3dIdcode) return null;
    try {
      return Molecule.fromIDCode(model3dIdcode);
    } catch {
      return null;
    }
  }

  function pick(x: number, y: number): void {
    if (!model3d) return;
    const hit = hitTest(lastOps, x, y);
    if (!hit) {
      deselect();
      return;
    }
    const base = editBase();
    if (!base) return;
    if (hit.atom !== undefined && hit.atom >= base.getAllAtoms()) {
      deselect();
      note3d.textContent =
        "That is a hydrogen — hydrogens are implicit and re-derive automatically; select a heavy atom to edit.";
      return;
    }
    if (hit.bond !== undefined && hit.bond >= base.getAllBonds()) {
      deselect();
      note3d.textContent = "That bond goes to an implicit hydrogen — edit the heavy atom instead.";
      return;
    }
    sel = hit;
    updateEditBar();
    render3d();
  }

  // Drag to rotate; a CLICK (no meaningful movement) picks for editing.
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  canvas3d.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas3d.setPointerCapture(e.pointerId);
  });
  canvas3d.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    view3d = rotateView(view3d, e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
    render3d();
  });
  canvas3d.addEventListener("pointerup", (e) => {
    dragging = false;
    if (moved < 5) {
      const rect = canvas3d.getBoundingClientRect();
      pick(e.clientX - rect.left, e.clientY - rect.top);
    }
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
  labelsBox.addEventListener("change", render3d);
  byId<HTMLButtonElement>("reset3d-btn").addEventListener("click", () => {
    view3d = { ...defaultMol3dView(), style: styleSel.value as Mol3dStyle, showH: showHBox.checked, showLabels: labelsBox.checked };
    render3d();
  });
  window.addEventListener("resize", render3d);

  // ----- Edit bar wiring -----
  for (const el of EDIT_ELEMENTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "elem3d-btn";
    btn.textContent = el.symbol;
    btn.title = `Change the selected atom to ${el.symbol}`;
    btn.addEventListener("click", () => {
      const base = editBase();
      if (base && sel?.atom !== undefined) applyEdit(changeElement(base, sel.atom, el.atomicNo));
    });
    elemWrap.appendChild(btn);
  }
  const attachPlaceholder = document.createElement("option");
  attachPlaceholder.value = "";
  attachPlaceholder.textContent = "Attach group…";
  attachSel.appendChild(attachPlaceholder);
  for (const g of ATTACH_GROUPS) {
    const o = document.createElement("option");
    o.value = g.smiles;
    o.textContent = g.name;
    attachSel.appendChild(o);
  }
  attachSel.addEventListener("change", () => {
    const smiles = attachSel.value;
    attachSel.value = "";
    const base = editBase();
    if (smiles && base && sel?.atom !== undefined) applyEdit(attachFragment(base, sel.atom, smiles));
  });
  delAtomBtn.addEventListener("click", () => {
    const base = editBase();
    if (base && sel?.atom !== undefined) applyEdit(deleteAtomIn(base, sel.atom));
  });
  for (const order of [1, 2, 3] as const) {
    byId<HTMLButtonElement>(`bond3d-${order}`).addEventListener("click", () => {
      const base = editBase();
      if (base && sel?.bond !== undefined) applyEdit(setBondOrderIn(base, sel.bond, order));
    });
  }
  byId<HTMLButtonElement>("del-bond3d").addEventListener("click", () => {
    const base = editBase();
    if (base && sel?.bond !== undefined) applyEdit(deleteBondIn(base, sel.bond));
  });
  byId<HTMLButtonElement>("deselect3d").addEventListener("click", deselect);

  // ----- Template menus (both tabs; grouped) -----
  function fillTemplates(select: HTMLSelectElement, placeholder: string): void {
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    select.appendChild(ph);
    let group = "";
    let og: HTMLOptGroupElement | null = null;
    for (const t of MOL_TEMPLATES) {
      if (t.group !== group) {
        group = t.group;
        og = document.createElement("optgroup");
        og.label = t.group;
        select.appendChild(og);
      }
      const o = document.createElement("option");
      o.value = t.smiles;
      o.textContent = t.name;
      (og ?? select).appendChild(o);
    }
  }
  fillTemplates(tpl2dSel, "Insert template…");
  fillTemplates(tpl3dSel, "Add template…");
  function onTemplate(select: HTMLSelectElement): void {
    const smiles = select.value;
    select.value = "";
    if (!smiles) return;
    // A template joins the structure: what it cannot carry (brackets, arrows, text; a structure with no
    // single formula) is refused by name, never dropped.
    if (editor.hasDrawing()) {
      showError("A template joins a page of structures only — this one also has brackets, arrows or text.");
      return;
    }
    if (editor.page().objects.length && !editor.chemistry().ok) {
      const r0 = editor.chemistry();
      showError(`A template needs the structure as chemistry: ${r0.ok ? "" : r0.reason}.`);
      return;
    }
    const current = editor.getMolecule();
    const r = addTemplate(current.getAllAtoms() > 0 ? current : null, smiles);
    if (r.error) {
      showError(r.error);
      return;
    }
    clearError();
    editor.setMolecule(r.mol!);
    updateInfo();
    if (wrap3d.style.display !== "none") refresh3d();
  }
  tpl2dSel.addEventListener("change", () => onTemplate(tpl2dSel));
  tpl3dSel.addEventListener("change", () => onTemplate(tpl3dSel));

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------
  cleanBtn.addEventListener("click", () => {
    if (!editor.page().objects.length) {
      showError("Nothing to clean — the canvas is empty.");
      return;
    }
    clearError();
    try {
      // Each structure laid out again in place (one Undo step); everything else keeps its place.
      if (editor.clean()) updateInfo();
    } catch (error) {
      showError(`Could not clean the structure: ${(error as Error).message}`);
    }
  });

  useBtn.addEventListener("click", () => {
    // The page goes back whole, as ChemDraw keeps it. Beside it, the structure (its idcode) when the page is
    // exactly one readable set of structures — what Reaction mode's "Draw a component" needs.
    if (!editor.page().objects.length) {
      showError("Nothing drawn yet — draw something, or Cancel.");
      return;
    }
    const out: { page: string; frag: boolean; mol?: string } = { page: writeCdxml(editor.page().root), frag: editor.isFragment() };
    const chem = editor.chemistry();
    const groupLabel = editor.page().objects.some((o) => o.items.some((it) => it.kind === "fragment" && it.v.nodes.some((nd) => nd.nodeType === "Unspecified" || nd.nodeType === "Nickname" || nd.nodeType === "Fragment")));
    if (chem.ok && chem.mol.getAllAtoms() > 0 && !editor.hasDrawing() && !groupLabel) {
      const enc = chem.mol.getIDCodeAndCoordinates();
      out.mol = `${enc.idCode} ${enc.coordinates}`;
    }
    send(out);
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
        showLabels: labelsBox.checked,
        rot: view3d.rot,
        zoom: view3d.zoom,
      },
    }));
  });

  byId<HTMLButtonElement>("cancel-btn").addEventListener("click", () => {
    Office.context.ui.messageParent(JSON.stringify({ cancel: true }));
  });
});
