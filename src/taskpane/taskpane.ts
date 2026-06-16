/* global Office, Word, document, HTMLInputElement, HTMLButtonElement, HTMLElement, Image, TextEncoder, btoa */

import { Segment } from "../lib/segments";
import { parseChemical } from "../lib/chemParser";
import { parseMath } from "../lib/mathFormat";
import { mathToOoxml } from "../lib/mathOmml";
import { renderStructure } from "../lib/structures";

type Mode = "chemical" | "math";

const STRUCTURE_W = 300;
const STRUCTURE_H = 230;

let inputEl: HTMLInputElement;
let previewEl: HTMLElement;
let statusEl: HTMLElement;
let insertBtn: HTMLButtonElement;
let structureSection: HTMLElement;
let structurePreviewEl: HTMLElement;
let insertStructureBtn: HTMLButtonElement;
let ommlOption: HTMLElement;
let ommlCheckbox: HTMLInputElement;

/** The SVG currently shown in the structure preview, or null when none. */
let currentStructureSvg: string | null = null;

Office.onReady((info) => {
  if (info.host !== Office.HostType.Word) {
    return;
  }

  inputEl = document.getElementById("formula-input") as HTMLInputElement;
  previewEl = document.getElementById("preview") as HTMLElement;
  statusEl = document.getElementById("status") as HTMLElement;
  insertBtn = document.getElementById("insert-btn") as HTMLButtonElement;
  structureSection = document.getElementById("structure-section") as HTMLElement;
  structurePreviewEl = document.getElementById("structure-preview") as HTMLElement;
  insertStructureBtn = document.getElementById("insert-structure-btn") as HTMLButtonElement;
  ommlOption = document.getElementById("omml-option") as HTMLElement;
  ommlCheckbox = document.getElementById("omml-checkbox") as HTMLInputElement;

  inputEl.addEventListener("input", onInputChanged);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") insertFormula();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updatePlaceholder();
      onInputChanged();
    });
  });
  insertBtn.addEventListener("click", insertFormula);
  insertStructureBtn.addEventListener("click", insertStructure);

  updatePlaceholder();
  onInputChanged();
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
    currentMode() === "chemical" ? "e.g. H2O, Ca(OH)2, aspirin" : "e.g. x^2 + y^2, a_n, sqrt(x)";
}

/** Refreshes everything that depends on the input: text preview and mode-specific UI. */
function onInputChanged(): void {
  updateTextPreview();
  const chemical = currentMode() === "chemical";
  structureSection.style.display = chemical ? "block" : "none";
  ommlOption.style.display = chemical ? "none" : "block";
  if (chemical) {
    updateStructurePreview();
  } else {
    currentStructureSvg = null;
  }
}

/** Renders the parsed segments into the live HTML text preview. */
function updateTextPreview(): void {
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

/** Attempts to render a 2D structure for the current input and shows it (or a hint). */
function updateStructurePreview(): void {
  const text = inputEl.value.trim();
  currentStructureSvg = null;

  if (!text) {
    showStructureHint("Type a name, formula, or SMILES to see its structure.");
    return;
  }

  let result: ReturnType<typeof renderStructure> = null;
  try {
    result = renderStructure(text, STRUCTURE_W, STRUCTURE_H);
  } catch {
    result = null;
  }

  if (!result) {
    showStructureHint("No structure found. Try a common name (aspirin), a known formula (C6H6), or a SMILES string.");
    return;
  }

  currentStructureSvg = result.svg;
  structurePreviewEl.innerHTML = result.svg;
  insertStructureBtn.disabled = false;
}

function showStructureHint(message: string): void {
  structurePreviewEl.replaceChildren();
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = message;
  structurePreviewEl.appendChild(hint);
  insertStructureBtn.disabled = true;
}

function setStatus(message: string, kind: "" | "error" | "success" = ""): void {
  statusEl.textContent = message;
  statusEl.className = kind ? `status ${kind}` : "status";
}

/** Inserts the formula at the selection — as a native equation, or as formatted text. */
async function insertFormula(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text) {
    setStatus("Type a formula first.", "error");
    return;
  }

  // Math mode with the equation option checked: try OMML first, then fall back
  // to inline formatting if the expression can't be parsed into an equation.
  if (currentMode() === "math" && ommlCheckbox.checked) {
    const inserted = await insertEquation(text);
    if (inserted) return;
    setStatus("Couldn't build an equation from that — inserted as formatted text instead.", "error");
  }

  await insertFormattedText(text);
}

/** Inserts the parsed segments as Word text runs with sub/superscript formatting. */
async function insertFormattedText(text: string): Promise<void> {
  const segments = parse(text, currentMode());
  insertBtn.disabled = true;

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

/**
 * Builds OMML from the input and inserts it as a native Word equation.
 * Returns true on success, false if the expression couldn't be parsed (so the
 * caller can fall back to formatted text).
 */
async function insertEquation(text: string): Promise<boolean> {
  let ooxml: string;
  try {
    ooxml = mathToOoxml(text);
  } catch {
    return false; // parse error — caller falls back
  }

  insertBtn.disabled = true;
  setStatus("Inserting equation…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      range.insertOoxml(ooxml, Word.InsertLocation.replace);
      await context.sync();
    });
    setStatus("Equation inserted.", "success");
    return true;
  } catch (error) {
    setStatus(`Could not insert equation: ${(error as Error).message}`, "error");
    return true; // a Word/runtime error is not a parse failure; don't double-insert
  } finally {
    insertBtn.disabled = false;
  }
}

/** Rasterizes the current structure SVG to a PNG and inserts it as an inline picture. */
async function insertStructure(): Promise<void> {
  if (!currentStructureSvg) {
    setStatus("No structure to insert.", "error");
    return;
  }

  insertStructureBtn.disabled = true;
  setStatus("Inserting structure…");

  try {
    const base64 = await svgToPngBase64(currentStructureSvg, STRUCTURE_W, STRUCTURE_H);
    const label = inputEl.value.trim();
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = `2D structure of ${label}`;
      range.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Structure inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert structure: ${(error as Error).message}`, "error");
  } finally {
    insertStructureBtn.disabled = false;
  }
}

/**
 * Converts an SVG string to a base64-encoded PNG (no data-URL prefix), which is
 * the format Word's insertInlinePictureFromBase64 expects. Uses an offscreen
 * canvas with a white background so transparent SVG areas don't render black.
 */
function svgToPngBase64(svg: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const svgBase64 = btoa(String.fromCharCode(...new TextEncoder().encode(svg)));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png").split(",")[1]);
      } catch (e) {
        reject(e as Error);
      }
    };
    img.onerror = () => reject(new Error("Could not rasterize the structure image."));
    img.src = `data:image/svg+xml;base64,${svgBase64}`;
  });
}
