/* global document, window, Office, HTMLElement, HTMLButtonElement */
/**
 * The large Drawing (CAD) canvas: the pane's CAD editor at working size, in a
 * dialog window. It is the SAME controller (taskpane/cadPane.ts) over the same
 * element ids, so every rule — refusals, callouts, sheets — is the tested one.
 *
 * The model arrives in the URL (?doc=…) or, when too long for a URL, after
 * this page says it is ready (?wait=1 → messageParent {ready}; the pane
 * answers with messageChild). A dialog cannot touch the document, so:
 *   - "Use this drawing" → messageParent {doc}               (replaces the pane's model)
 *   - "Insert drawing"   → messageParent {doc, insert: true} (the pane inserts it)
 *   - "Cancel"           → messageParent {cancel: true}
 */
import { initCadPane, CadPaneApi } from "../taskpane/cadPane";
import { parseDoc, nextFreeNumeral } from "../lib/cadShapes";
import { parseSketch } from "../lib/sketchDoc";
import type { Sketch } from "../lib/sketch";

// Delivery marker for the offline gate (scripts/check-offline.js): proves this
// bundle was served and executed with the network cut. Module scope on purpose —
// Office.onReady reports no host in a plain browser and never gets this far.
declare const __APP_VERSION__: string;
document.documentElement.dataset.jurislabVersion = __APP_VERSION__;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function showError(text: string): void {
  const e = byId<HTMLElement>("cad-error");
  e.textContent = text;
  e.style.display = "block";
}

Office.onReady(() => {
  const params = new URLSearchParams(window.location.search);
  const base = Number(params.get("n0"));
  /** Opened to sketch: "new", or the id of the part whose sketch to edit. */
  const sketchParam = params.get("sketch");
  const statusEl = byId<HTMLElement>("cad-status");
  const useBtn = byId<HTMLButtonElement>("cad-use");
  const cancelBtn = byId<HTMLButtonElement>("cad-cancel");
  const insertBtn = byId<HTMLButtonElement>("cad-insert");
  const send = (o: object): void => Office.context.ui.messageParent(JSON.stringify(o));
  let pane: CadPaneApi | null = null;

  cancelBtn.addEventListener("click", () => send({ cancel: true }));
  useBtn.disabled = true;
  useBtn.addEventListener("click", () => {
    if (!pane) return;
    if (pane.isSketching()) {
      statusEl.textContent = "Finish the sketch first (Done or Cancel) — the drawing does not include it yet.";
      statusEl.className = "build-readout warn";
      return;
    }
    send({ doc: pane.getDoc() });
  });

  /** Starts the editor on the pane's model — never on a blank one ("Use" would replace the pane's drawing). */
  const start = (json: string | null, seed?: Sketch): void => {
    if (pane) return;
    const r = json ? parseDoc(json) : null;
    if (!r || !r.ok) {
      showError(
        `The drawing could not be carried into this window${r && !r.ok ? ` (${r.reason})` : ""}. Close it with Cancel; the drawing in the pane is unchanged.`,
      );
      insertBtn.disabled = true;
      return;
    }
    pane = initCadPane(
      {
        setStatus: (text, kind) => {
          statusEl.textContent = text;
          statusEl.className = kind === "error" ? "build-readout warn" : "build-readout";
        },
        nextNumeral: (taken) => nextFreeNumeral(base, taken),
        // The pane does the insert: hand it the model, with the instruction.
        insertPicture: async () => {
          if (pane) send({ doc: pane.getDoc(), insert: true });
        },
        // Opened to sketch: Done takes the drawing back to the pane, Cancel closes the window.
        sketchClosed: (kept) => {
          if (!sketchParam || !pane) return;
          send(kept ? { doc: pane.getDoc() } : { cancel: true });
        },
      },
      r.doc,
    );
    pane.show();
    if (sketchParam) pane.startSketch(sketchParam === "new" ? null : sketchParam, sketchParam === "new" ? seed : undefined);
    useBtn.disabled = false;
  };

  if (params.get("wait")) {
    Office.context.ui.addHandlerAsync(
      Office.EventType.DialogParentMessageReceived,
      (arg: { message?: string }) => {
        const msg = typeof arg.message === "string" ? arg.message : null;
        if (!params.get("seed") || msg === null) return start(msg);
        // {doc, seed}: the model, and a new sketch's starting geometry (an imported DXF), read field by field.
        let w: { doc?: unknown; seed?: unknown } = {};
        try {
          w = JSON.parse(msg);
        } catch {
          /* refused below */
        }
        let sk: ReturnType<typeof parseSketch> = { ok: false, reason: "missing" };
        try {
          sk = parseSketch(typeof w.seed === "string" ? JSON.parse(w.seed) : null);
        } catch {
          /* refused below */
        }
        if (!sk.ok) {
          showError(`The imported sketch could not be carried into this window (${sk.reason}). Close it with Cancel; the drawing in the pane is unchanged.`);
          insertBtn.disabled = true;
          return;
        }
        start(typeof w.doc === "string" ? w.doc : null, sk.sketch);
      },
      (res) => {
        if (res.status === Office.AsyncResultStatus.Succeeded) send({ ready: true });
        else showError("This version of Word cannot hand a drawing this large to a window. Close it with Cancel; the drawing in the pane is unchanged.");
      },
    );
  } else {
    start(params.get("doc"));
  }
});
