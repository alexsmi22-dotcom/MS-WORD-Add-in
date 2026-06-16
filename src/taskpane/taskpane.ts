/* global Office, Word, document, HTMLInputElement */

import { Segment } from "../lib/segments";
import { parseChemical } from "../lib/chemParser";
import { parseMath } from "../lib/mathFormat";

type Mode = "chemical" | "math";

let inputEl: HTMLInputElement;
let previewEl: HTMLElement;
let statusEl: HTMLElement;
let insertBtn: HTMLButtonElement;

Office.onReady((info) => {
  if (info.host !== Office.HostType.Word) {
    return;
  }

  inputEl = document.getElementById("formula-input") as HTMLInputElement;
  previewEl = document.getElementById("preview") as HTMLElement;
  statusEl = document.getElementById("status") as HTMLElement;
  insertBtn = document.getElementById("insert-btn") as HTMLButtonElement;

  inputEl.addEventListener("input", updatePreview);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") insertFormula();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updatePlaceholder();
      updatePreview();
    });
  });
  insertBtn.addEventListener("click", insertFormula);

  updatePlaceholder();
  updatePreview();
});

function currentMode(): Mode {
  const checked = document.querySelector<HTMLInputElement>('input[name="mode"]:checked');
  return (checked?.value as Mode) ?? "chemical";
}

function parse(text: string, mode: Mode): Segment[] {
  return mode === "chemical" ? parseChemical(text) : parseMath(text);
}

function updatePlaceholder(): void {
  inputEl.placeholder =
    currentMode() === "chemical" ? "e.g. H2O, Ca(OH)2, SO4^2-" : "e.g. x^2 + y^2, a_n, sqrt(x)";
}

/** Renders the parsed segments into the live HTML preview. */
function updatePreview(): void {
  const segments = parse(inputEl.value, currentMode());
  previewEl.replaceChildren();
  for (const seg of segments) {
    let node: HTMLElement | Text;
    if (seg.type === "sub") {
      node = document.createElement("sub");
      node.textContent = seg.text;
    } else if (seg.type === "sup") {
      node = document.createElement("sup");
      node.textContent = seg.text;
    } else {
      node = document.createTextNode(seg.text);
    }
    previewEl.appendChild(node);
  }
}

function setStatus(message: string, kind: "" | "error" | "success" = ""): void {
  statusEl.textContent = message;
  statusEl.className = kind ? `status ${kind}` : "status";
}

/** Inserts the formatted formula into the Word document at the selection. */
async function insertFormula(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text) {
    setStatus("Type a formula first.", "error");
    return;
  }

  const segments = parse(text, currentMode());
  insertBtn.disabled = true;
  setStatus("Inserting…");

  try {
    await Word.run(async (context) => {
      let range: Word.Range = context.document.getSelection();
      segments.forEach((seg, index) => {
        // First segment replaces the selection (or inserts at the cursor);
        // the rest are appended after the previously inserted run so order
        // and formatting are preserved.
        const location = index === 0 ? Word.InsertLocation.replace : Word.InsertLocation.after;
        const inserted = range.insertText(seg.text, location);
        inserted.font.subscript = seg.type === "sub";
        inserted.font.superscript = seg.type === "sup";
        range = inserted;
      });
      // Place the cursor after the inserted formula so typing continues normally.
      range.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert: ${(error as Error).message}`, "error");
  } finally {
    insertBtn.disabled = false;
  }
}
