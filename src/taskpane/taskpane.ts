/* global Office, Word, document, HTMLInputElement, HTMLButtonElement, HTMLSelectElement, HTMLTextAreaElement, HTMLElement, Image, TextEncoder, btoa */

import { Segment, segmentsToHtml } from "../lib/segments";
import { parseChemical } from "../lib/chemParser";
import { parseMath } from "../lib/mathFormat";
import { mathToOoxml } from "../lib/mathOmml";
import { mathToHtml } from "../lib/mathHtml";
import { renderStructure } from "../lib/structures";
import { build, BuildFormat } from "../lib/builder";
import { FORMULA_LIBRARY } from "../lib/formulaLibrary";
import { MATH_PALETTE, CHEM_PALETTE, PaletteGroup } from "../lib/palettes";

type Mode = "chemical" | "math" | "build";

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
let libraryRow: HTMLElement;
let libCategorySelect: HTMLSelectElement;
let libFormulaSelect: HTMLSelectElement;
let paletteEl: HTMLElement;
let formatSection: HTMLElement;
let buildSection: HTMLElement;
let buildFormatSelect: HTMLSelectElement;
let buildInput: HTMLTextAreaElement;
let buildFormulaEl: HTMLElement;
let buildSmilesEl: HTMLElement;
let buildPreviewEl: HTMLElement;
let insertBuildBtn: HTMLButtonElement;

/** The SVG currently shown in the structure preview, or null when none. */
let currentStructureSvg: string | null = null;
/** The SVG currently shown in the Build preview, or null when none. */
let currentBuildSvg: string | null = null;

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
  libraryRow = document.getElementById("library-row") as HTMLElement;
  libCategorySelect = document.getElementById("lib-category") as HTMLSelectElement;
  libFormulaSelect = document.getElementById("lib-formula") as HTMLSelectElement;
  paletteEl = document.getElementById("palette") as HTMLElement;
  formatSection = document.getElementById("format-section") as HTMLElement;
  buildSection = document.getElementById("build-section") as HTMLElement;
  buildFormatSelect = document.getElementById("build-format") as HTMLSelectElement;
  buildInput = document.getElementById("build-input") as HTMLTextAreaElement;
  buildFormulaEl = document.getElementById("build-formula") as HTMLElement;
  buildSmilesEl = document.getElementById("build-smiles") as HTMLElement;
  buildPreviewEl = document.getElementById("build-preview") as HTMLElement;
  insertBuildBtn = document.getElementById("insert-build-btn") as HTMLButtonElement;

  inputEl.addEventListener("input", onInputChanged);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") insertFormula();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updatePlaceholder();
      renderPalette();
      onInputChanged();
    });
  });
  insertBtn.addEventListener("click", insertFormula);
  insertStructureBtn.addEventListener("click", insertStructure);
  buildInput.addEventListener("input", updateBuildPreview);
  buildFormatSelect.addEventListener("change", updateBuildPreview);
  insertBuildBtn.addEventListener("click", insertBuild);

  populateLibraryCategories();
  libCategorySelect.addEventListener("change", populateLibraryFormulas);
  libFormulaSelect.addEventListener("change", onLibraryFormulaChosen);

  renderPalette();
  updatePlaceholder();
  onInputChanged();
});

/** Renders the palette buttons for the current mode (math vs chemical). */
function renderPalette(): void {
  const mode = currentMode();
  const groups: PaletteGroup[] = mode === "math" ? MATH_PALETTE : mode === "chemical" ? CHEM_PALETTE : [];
  paletteEl.replaceChildren();
  for (const group of groups) {
    const wrap = document.createElement("div");
    wrap.className = "palette-group";
    const label = document.createElement("span");
    label.className = "palette-group-label";
    label.textContent = group.name;
    wrap.appendChild(label);
    for (const item of group.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-btn";
      btn.textContent = item.label;
      if (item.title) btn.title = item.title;
      // Keep focus/selection in the input so the snippet lands at the caret.
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => insertAtCursor(item.snippet, item.caret));
      wrap.appendChild(btn);
    }
    paletteEl.appendChild(wrap);
  }
}

/** Inserts a snippet at the input's caret and positions the cursor within it. */
function insertAtCursor(snippet: string, caret?: number): void {
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  inputEl.value = inputEl.value.slice(0, start) + snippet + inputEl.value.slice(end);
  const pos = start + (caret ?? snippet.length);
  inputEl.focus();
  inputEl.setSelectionRange(pos, pos);
  onInputChanged();
}

/** Fills the category dropdown and the formulas for the first category. */
function populateLibraryCategories(): void {
  libCategorySelect.replaceChildren();
  FORMULA_LIBRARY.forEach((cat, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = cat.name;
    libCategorySelect.appendChild(opt);
  });
  populateLibraryFormulas();
}

/** Fills the formula dropdown for the currently selected category. */
function populateLibraryFormulas(): void {
  const cat = FORMULA_LIBRARY[Number(libCategorySelect.value)];
  libFormulaSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a formula…";
  libFormulaSelect.appendChild(placeholder);
  cat?.formulas.forEach((f, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = f.label;
    libFormulaSelect.appendChild(opt);
  });
}

/** When a library formula is picked, load its expression into the input. */
function onLibraryFormulaChosen(): void {
  const cat = FORMULA_LIBRARY[Number(libCategorySelect.value)];
  const idx = libFormulaSelect.value;
  if (!cat || idx === "") return;
  inputEl.value = cat.formulas[Number(idx)].expr;
  onInputChanged();
  inputEl.focus();
}

function currentMode(): Mode {
  const checked = document.querySelector<HTMLInputElement>('input[name="mode"]:checked');
  return (checked?.value as Mode) ?? "chemical";
}

function parse(text: string, mode: Mode): Segment[] {
  return mode === "chemical" ? parseChemical(text) : parseMath(text);
}

function updatePlaceholder(): void {
  if (currentMode() === "math") {
    inputEl.placeholder = "e.g. x^2 + y^2, a_n, sqrt(x)";
  } else {
    inputEl.placeholder = "e.g. H2O, Ca(OH)2, aspirin";
  }
}

/** Refreshes everything that depends on the input: section visibility and previews. */
function onInputChanged(): void {
  const mode = currentMode();
  const build = mode === "build";
  const chemical = mode === "chemical";

  formatSection.style.display = build ? "none" : "block";
  buildSection.style.display = build ? "block" : "none";
  paletteEl.style.display = build ? "none" : "block";

  if (build) {
    updateBuildPreview();
    return;
  }

  updateTextPreview();
  structureSection.style.display = chemical ? "block" : "none";
  ommlOption.style.display = chemical ? "none" : "block";
  libraryRow.style.display = mode === "math" ? "block" : "none";
  if (chemical) {
    updateStructurePreview();
  } else {
    currentStructureSvg = null;
  }
}

/** Renders the live HTML preview for the current input and mode. */
function updateTextPreview(): void {
  if (currentMode() === "math") {
    // Structured math renderer (fractions, roots, Σ, ∫ …) mirrors the OMML
    // that gets inserted; falls back to inline formatting on partial input.
    previewEl.innerHTML = mathToHtml(inputEl.value);
  } else {
    // Same HTML used for insertion (see insertFormattedText) so preview == insert.
    previewEl.innerHTML = segmentsToHtml(parseChemical(inputEl.value));
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

/**
 * Inserts the formula as formatted text by inserting the exact same <sub>/<sup>
 * HTML shown in the preview. Using insertHtml (rather than building runs
 * imperatively) keeps run boundaries and formatting deterministic, so the
 * inserted result always matches the preview.
 */
async function insertFormattedText(text: string): Promise<void> {
  const html = segmentsToHtml(parse(text, currentMode()));
  insertBtn.disabled = true;

  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertHtml(html, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
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

/** Builds a molecule from the Build textarea and shows its structure, formula, and SMILES. */
function updateBuildPreview(): void {
  const text = buildInput.value;
  currentBuildSvg = null;
  insertBuildBtn.disabled = true;

  if (!text.trim()) {
    buildPreviewEl.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Enter an atom/bond list or paste a molfile to build a structure.";
    buildPreviewEl.appendChild(hint);
    buildFormulaEl.textContent = "—";
    buildSmilesEl.textContent = "—";
    setStatus("");
    return;
  }

  try {
    const format = buildFormatSelect.value as BuildFormat;
    const result = build(text, format, STRUCTURE_W, STRUCTURE_H);
    currentBuildSvg = result.svg;
    buildPreviewEl.innerHTML = result.svg;
    buildFormulaEl.textContent = result.formula || "—";
    buildSmilesEl.textContent = result.smiles || "—";
    insertBuildBtn.disabled = false;
    setStatus("");
  } catch (error) {
    buildPreviewEl.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = (error as Error).message;
    buildPreviewEl.appendChild(hint);
    buildFormulaEl.textContent = "—";
    buildSmilesEl.textContent = "—";
  }
}

/** Inserts the built molecule's structure as an inline picture. */
async function insertBuild(): Promise<void> {
  if (!currentBuildSvg) {
    setStatus("Nothing built to insert.", "error");
    return;
  }

  insertBuildBtn.disabled = true;
  setStatus("Inserting structure…");

  try {
    const base64 = await svgToPngBase64(currentBuildSvg, STRUCTURE_W, STRUCTURE_H);
    const label = buildFormulaEl.textContent || "molecule";
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = `2D structure (${label})`;
      range.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Structure inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert structure: ${(error as Error).message}`, "error");
  } finally {
    insertBuildBtn.disabled = false;
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
