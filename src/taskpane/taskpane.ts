/* global Office, Word, document, localStorage, HTMLInputElement, HTMLButtonElement, HTMLSelectElement, HTMLTextAreaElement, HTMLElement, Image, TextEncoder, btoa */

import { Segment, segmentsToHtml } from "../lib/segments";
import { parseChemical } from "../lib/chemParser";
import { parseMath } from "../lib/mathFormat";
import { mathToOoxml } from "../lib/mathOmml";
import { mathToHtml } from "../lib/mathHtml";
import { renderStructure, StructureResult } from "../lib/structures";
import { build, BuildFormat, BuildResult } from "../lib/builder";
import { FORMULA_LIBRARY } from "../lib/formulaLibrary";
import {
  MATH_PALETTE,
  CHEM_PALETTE,
  BUILD_TEMPLATES,
  BUILD_BONDS,
  BUILD_MARKUSH,
  PaletteGroup,
  PaletteItem,
} from "../lib/palettes";
import { NAME_TO_SMILES } from "../lib/compounds";
import {
  HistoryEntry,
  HistoryKind,
  addRecent,
  getRecents,
  getFavorites,
  isFavorite,
  toggleFavorite,
  clearHistory,
} from "../lib/history";
import { toRoman, peekFormulaNumber, nextFormulaNumber, resetFormulaNumbering } from "../lib/numbering";
import { LegendEntry, buildLegendText, buildLegendTableHtml, referencedRGroups } from "../lib/markush";

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
let numberOption: HTMLElement;
let numberCheckbox: HTMLInputElement;
let numberNext: HTMLElement;
let numberReset: HTMLButtonElement;
let structureInfo: HTMLElement;
let libraryRow: HTMLElement;
let libCategorySelect: HTMLSelectElement;
let libFormulaSelect: HTMLSelectElement;
let paletteEl: HTMLElement;
let searchInput: HTMLInputElement;
let searchResults: HTMLElement;
let historyEl: HTMLElement;
let buildTemplatesEl: HTMLElement;
let buildBondsEl: HTMLElement;
let buildMarkushEl: HTMLElement;
let formatSection: HTMLElement;
let buildSection: HTMLElement;
let buildFormatSelect: HTMLSelectElement;
let buildInput: HTMLTextAreaElement;
let buildFormulaEl: HTMLElement;
let buildSmilesEl: HTMLElement;
let buildPreviewEl: HTMLElement;
let buildRgroupsEl: HTMLElement;
let insertBuildBtn: HTMLButtonElement;

/** R-group label -> user-entered definition (e.g. "R1" -> "methyl, ethyl"). */
const rgroupValues: Record<string, string> = {};
/** How the R-group legend is inserted: an inline line or a structured table. */
let legendFormat: "line" | "table" = "line";
/** R-group labels present in the current structure (main groups, from the build). */
let mainRgroups: string[] = [];
/** Container for dynamically-added sub-generic R-group inputs (e.g. R1a), or null. */
let subGroupWrap: HTMLElement | null = null;

/** The structure currently shown in the Chemical structure preview, or null. */
let currentStructure: StructureResult | null = null;
/** The molecule currently shown in the Build preview, or null. */
let currentBuild: BuildResult | null = null;

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
  numberOption = document.getElementById("number-option") as HTMLElement;
  numberCheckbox = document.getElementById("number-checkbox") as HTMLInputElement;
  numberNext = document.getElementById("number-next") as HTMLElement;
  numberReset = document.getElementById("number-reset") as HTMLButtonElement;
  structureInfo = document.getElementById("structure-info") as HTMLElement;
  libraryRow = document.getElementById("library-row") as HTMLElement;
  libCategorySelect = document.getElementById("lib-category") as HTMLSelectElement;
  libFormulaSelect = document.getElementById("lib-formula") as HTMLSelectElement;
  paletteEl = document.getElementById("palette") as HTMLElement;
  searchInput = document.getElementById("search") as HTMLInputElement;
  searchResults = document.getElementById("search-results") as HTMLElement;
  historyEl = document.getElementById("history") as HTMLElement;
  buildTemplatesEl = document.getElementById("build-templates") as HTMLElement;
  buildBondsEl = document.getElementById("build-bonds") as HTMLElement;
  buildMarkushEl = document.getElementById("build-markush") as HTMLElement;
  formatSection = document.getElementById("format-section") as HTMLElement;
  buildSection = document.getElementById("build-section") as HTMLElement;
  buildFormatSelect = document.getElementById("build-format") as HTMLSelectElement;
  buildInput = document.getElementById("build-input") as HTMLTextAreaElement;
  buildFormulaEl = document.getElementById("build-formula") as HTMLElement;
  buildSmilesEl = document.getElementById("build-smiles") as HTMLElement;
  buildPreviewEl = document.getElementById("build-preview") as HTMLElement;
  buildRgroupsEl = document.getElementById("build-rgroups") as HTMLElement;
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
  numberCheckbox.addEventListener("change", updateNumberLabel);
  numberReset.addEventListener("click", () => {
    resetFormulaNumbering();
    updateNumberLabel();
  });
  buildInput.addEventListener("input", updateBuildPreview);
  buildFormatSelect.addEventListener("change", updateBuildPreview);
  insertBuildBtn.addEventListener("click", insertBuild);

  populateLibraryCategories();
  libCategorySelect.addEventListener("change", populateLibraryFormulas);
  libFormulaSelect.addEventListener("change", onLibraryFormulaChosen);

  buildSearchIndex();
  searchInput.addEventListener("input", updateSearchResults);
  searchInput.addEventListener("focus", updateSearchResults);
  searchInput.addEventListener("blur", () => window.setTimeout(closeSearch, 150));

  renderBuildTemplates();
  renderBuildButtons(buildBondsEl, BUILD_BONDS);
  renderBuildButtons(buildMarkushEl, BUILD_MARKUSH);

  renderPalette();
  renderHistory();
  updateNumberLabel();
  updatePlaceholder();
  onInputChanged();
});

/** Shows the next equation number "(I)" next to the numbering checkbox. */
function updateNumberLabel(): void {
  numberNext.textContent = numberCheckbox.checked ? `(${toRoman(peekFormulaNumber())})` : "";
}

/** Switches mode programmatically (e.g. from search or history) and refreshes UI. */
function setMode(mode: Mode): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  updatePlaceholder();
  renderPalette();
  onInputChanged();
}

// ---------------------------------------------------------------------------
// Search (formulas + compounds)
// ---------------------------------------------------------------------------

interface SearchEntry {
  type: "formula" | "compound";
  label: string;
  sub: string;
  value: string;
  mode: Mode;
}

let searchIndex: SearchEntry[] = [];

function buildSearchIndex(): void {
  const entries: SearchEntry[] = [];
  for (const cat of FORMULA_LIBRARY) {
    for (const f of cat.formulas) {
      entries.push({ type: "formula", label: f.label, sub: cat.name, value: f.expr, mode: "math" });
    }
  }
  for (const name of Object.keys(NAME_TO_SMILES)) {
    entries.push({ type: "compound", label: name, sub: "compound", value: name, mode: "chemical" });
  }
  searchIndex = entries;
}

function updateSearchResults(): void {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    closeSearch();
    return;
  }
  const scored = searchIndex
    .map((e) => ({ e, score: matchScore(e.label.toLowerCase(), q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  searchResults.replaceChildren();
  if (scored.length === 0) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "No matches.";
    searchResults.appendChild(empty);
  } else {
    for (const { e } of scored) {
      const item = document.createElement("div");
      item.className = "search-item";
      item.setAttribute("role", "option");
      const text = document.createElement("span");
      text.textContent = e.label;
      const badge = document.createElement("span");
      badge.className = `search-item-type ${e.type === "compound" ? "compound" : ""}`.trim();
      badge.textContent = e.type === "compound" ? "compound" : e.sub;
      item.append(text, badge);
      item.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); // keep blur from firing before click
        applySearchEntry(e);
      });
      searchResults.appendChild(item);
    }
  }
  searchResults.classList.add("open");
}

/** Substring match scoring: prefix matches rank highest, then earlier matches. */
function matchScore(haystack: string, needle: string): number {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return 0;
  if (idx === 0) return 100 - haystack.length * 0.01;
  return 50 - idx;
}

function applySearchEntry(entry: SearchEntry): void {
  setMode(entry.mode);
  inputEl.value = entry.value;
  onInputChanged();
  searchInput.value = "";
  closeSearch();
  inputEl.focus();
}

function closeSearch(): void {
  searchResults.classList.remove("open");
  searchResults.replaceChildren();
}

// ---------------------------------------------------------------------------
// Build templates (common structures)
// ---------------------------------------------------------------------------

function renderBuildTemplates(): void {
  buildTemplatesEl.replaceChildren();
  for (const tpl of BUILD_TEMPLATES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-btn";
    btn.textContent = tpl.label;
    if (tpl.title) btn.title = tpl.title;
    btn.addEventListener("click", () => {
      buildInput.value = tpl.snippet;
      updateBuildPreview();
      buildInput.focus();
    });
    buildTemplatesEl.appendChild(btn);
  }
}

/** Renders a row of Build buttons; clicking inserts its snippet at the cursor. */
function renderBuildButtons(el: HTMLElement, items: PaletteItem[]): void {
  el.replaceChildren();
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-btn";
    btn.textContent = item.label;
    if (item.title) btn.title = item.title;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => insertBuildSnippet(item.snippet));
    el.appendChild(btn);
  }
}

/** Inserts a snippet at the cursor in the Build input. */
function insertBuildSnippet(snippet: string): void {
  const start = buildInput.selectionStart ?? buildInput.value.length;
  const end = buildInput.selectionEnd ?? buildInput.value.length;
  buildInput.value = buildInput.value.slice(0, start) + snippet + buildInput.value.slice(end);
  const pos = start + snippet.length;
  buildInput.focus();
  buildInput.setSelectionRange(pos, pos);
  updateBuildPreview();
}

// ---------------------------------------------------------------------------
// Recents & favorites
// ---------------------------------------------------------------------------

function renderHistory(): void {
  historyEl.replaceChildren();
  const favorites = getFavorites();
  const recents = getRecents();
  if (favorites.length) historyEl.appendChild(historyGroup("★ Saved", favorites, true));
  if (recents.length) historyEl.appendChild(historyGroup("Recent", recents, false));
  if (favorites.length || recents.length) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "linklike";
    clear.style.marginLeft = "0";
    clear.textContent = "Clear recents & favorites";
    clear.title = "Remove all stored history from this machine";
    clear.addEventListener("click", () => {
      clearHistory();
      renderHistory();
    });
    historyEl.appendChild(clear);
  }
}

function historyGroup(title: string, entries: HistoryEntry[], favorited: boolean): HTMLElement {
  const wrap = document.createElement("div");
  const label = document.createElement("div");
  label.className = "history-group-label";
  label.textContent = title;
  wrap.appendChild(label);

  const row = document.createElement("div");
  row.className = "history-row";
  for (const entry of entries) {
    const chip = document.createElement("span");
    chip.className = "chip";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "chip-load";
    loadBtn.textContent = entry.label;
    loadBtn.title = `Load: ${entry.value}`;
    loadBtn.addEventListener("click", () => loadHistoryEntry(entry));

    const star = document.createElement("button");
    star.type = "button";
    star.className = "chip-star";
    star.textContent = favorited || isFavorite(entry) ? "★" : "☆";
    star.title = "Toggle favorite";
    star.addEventListener("click", () => {
      toggleFavorite(entry);
      renderHistory();
    });

    chip.append(loadBtn, star);
    row.appendChild(chip);
  }
  wrap.appendChild(row);
  return wrap;
}

function loadHistoryEntry(entry: HistoryEntry): void {
  setMode(entry.kind);
  if (entry.kind === "build") {
    buildInput.value = entry.value;
    updateBuildPreview();
    buildInput.focus();
  } else {
    inputEl.value = entry.value;
    onInputChanged();
    inputEl.focus();
  }
}

/** Records an insert in recents and refreshes the history UI. */
function recordInsert(kind: HistoryKind, value: string, label: string): void {
  addRecent({ kind, value, label });
  renderHistory();
}

/** Renders the palette buttons for the current mode (math vs chemical). */
/** Whether a palette group is expanded — remembered per mode/group; the first two
 *  groups default to open so common symbols are visible without a click. */
function paletteGroupOpen(mode: string, name: string, index: number): boolean {
  try {
    const v = localStorage.getItem(`formula-inserter.palette.${mode}.${name}`);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* localStorage best-effort */
  }
  return index < 2;
}

function setPaletteGroupOpen(mode: string, name: string, open: boolean): void {
  try {
    localStorage.setItem(`formula-inserter.palette.${mode}.${name}`, open ? "1" : "0");
  } catch {
    /* localStorage best-effort */
  }
}

function renderPalette(): void {
  const mode = currentMode();
  const groups: PaletteGroup[] = mode === "math" ? MATH_PALETTE : mode === "chemical" ? CHEM_PALETTE : [];
  paletteEl.replaceChildren();
  groups.forEach((group, index) => {
    // Collapsible group so the palette stays clean as the symbol set grows.
    const details = document.createElement("details");
    details.className = "palette-acc";
    details.open = paletteGroupOpen(mode, group.name, index);
    details.addEventListener("toggle", () => setPaletteGroupOpen(mode, group.name, details.open));

    const summary = document.createElement("summary");
    summary.className = "palette-group-label";
    summary.textContent = group.name;
    details.appendChild(summary);

    const items = document.createElement("div");
    items.className = "palette-group";
    for (const item of group.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-btn";
      btn.textContent = item.label;
      if (item.title) btn.title = item.title;
      // Keep focus/selection in the input so the snippet lands at the caret.
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => insertAtCursor(item.snippet, item.caret));
      items.appendChild(btn);
    }
    details.appendChild(items);
    paletteEl.appendChild(details);
  });
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

/** Groups the library categories under optgroups for a scannable dropdown. */
const LIBRARY_GROUPS: Array<{ label: string; categories: string[] }> = [
  { label: "Mathematics", categories: ["Statistics", "Geometry", "Algebra", "Trigonometry", "Calculus"] },
  {
    label: "Functions",
    categories: [
      "Trig functions",
      "Hyperbolic functions",
      "Log & exponential",
      "Special functions",
      "Discrete & combinatorics",
    ],
  },
  {
    label: "Science & engineering",
    categories: [
      "Cryptography",
      "Computer science / ML",
      "Mechanical engineering",
      "Electrical engineering",
      "Physics",
      "Biology / assays",
    ],
  },
];

/** Fills the category dropdown (grouped) and the formulas for the first category. */
function populateLibraryCategories(): void {
  libCategorySelect.replaceChildren();
  const indexByName: Record<string, number> = {};
  FORMULA_LIBRARY.forEach((cat, i) => (indexByName[cat.name] = i));
  const placed: Record<string, true> = {};

  for (const grp of LIBRARY_GROUPS) {
    const og = document.createElement("optgroup");
    og.label = grp.label;
    for (const name of grp.categories) {
      const i = indexByName[name];
      if (i === undefined) continue;
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = name;
      og.appendChild(opt);
      placed[name] = true;
    }
    if (og.children.length) libCategorySelect.appendChild(og);
  }
  // Safety net: any category not assigned to a group is appended ungrouped.
  FORMULA_LIBRARY.forEach((cat, i) => {
    if (placed[cat.name]) return;
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
  numberOption.style.display = mode === "math" ? "block" : "none";
  libraryRow.style.display = mode === "math" ? "block" : "none";
  if (chemical) {
    updateStructurePreview();
  } else {
    currentStructure = null;
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
  currentStructure = null;

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

  currentStructure = result;
  structurePreviewEl.innerHTML = result.svg;
  renderStructureInfo(result.formula, result.mw, result.smiles);
  insertStructureBtn.disabled = false;
}

/** Shows formula / MW / SMILES under the structure preview (provenance at a glance). */
function renderStructureInfo(formula: string, mw: number, smiles: string): void {
  structureInfo.replaceChildren();
  const bits: string[] = [];
  if (formula) bits.push(`Formula: ${formula}`);
  if (mw) bits.push(`MW: ${mw}`);
  if (smiles) bits.push(`SMILES: ${smiles}`);
  for (const b of bits) {
    const span = document.createElement("span");
    span.textContent = b;
    structureInfo.appendChild(span);
  }
}

function showStructureHint(message: string): void {
  structurePreviewEl.replaceChildren();
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = message;
  structurePreviewEl.appendChild(hint);
  structureInfo.replaceChildren();
  insertStructureBtn.disabled = true;
}

function setStatus(message: string, kind: "" | "error" | "success" = ""): void {
  statusEl.textContent = message;
  statusEl.className = kind ? `status ${kind}` : "status";
}

/** Builds machine-readable provenance for a structure's image alt-text. */
function provenanceAltText(label: string, formula: string, mw: number, smiles: string, idcode: string): string {
  const meta: string[] = [];
  if (formula) meta.push(formula);
  if (mw) meta.push(`MW ${mw}`);
  if (smiles) meta.push(`SMILES ${smiles}`);
  if (idcode) meta.push(`OCL-ID ${idcode}`);
  return meta.length ? `${label} — ${meta.join("; ")}` : label;
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
    recordInsert(currentMode() as HistoryKind, text, text);
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
  // Reserve a number only if this expression actually parses (avoid gaps on failure).
  const numbered = numberCheckbox.checked;
  let ooxml: string;
  try {
    const label = numbered ? `(${toRoman(peekFormulaNumber())})` : undefined;
    ooxml = mathToOoxml(text, { number: label });
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
    if (numbered) {
      nextFormulaNumber(); // consume the number now that it's placed
      updateNumberLabel();
    }
    setStatus("Equation inserted.", "success");
    recordInsert("math", text, text);
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
  const structure = currentStructure;
  if (!structure) {
    setStatus("No structure to insert.", "error");
    return;
  }

  insertStructureBtn.disabled = true;
  setStatus("Inserting structure…");

  try {
    const base64 = await svgToPngBase64(structure.svg, STRUCTURE_W, STRUCTURE_H);
    const label = inputEl.value.trim();
    const alt = provenanceAltText(
      `2D structure of ${label}`,
      structure.formula,
      structure.mw,
      structure.smiles,
      structure.idcode,
    );
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = alt;
      range.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Structure inserted.", "success");
    if (label) recordInsert("chemical", label, label);
  } catch (error) {
    setStatus(`Could not insert structure: ${(error as Error).message}`, "error");
  } finally {
    insertStructureBtn.disabled = false;
  }
}

/** Builds a molecule from the Build textarea and shows its structure, formula, and SMILES. */
function updateBuildPreview(): void {
  const text = buildInput.value;
  currentBuild = null;
  insertBuildBtn.disabled = true;

  if (!text.trim()) {
    buildPreviewEl.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Enter an atom/bond list or paste a molfile to build a structure.";
    buildPreviewEl.appendChild(hint);
    buildFormulaEl.textContent = "—";
    buildSmilesEl.textContent = "—";
    renderRgroupInputs([]);
    setStatus("");
    return;
  }

  try {
    const format = buildFormatSelect.value as BuildFormat;
    const result = build(text, format, STRUCTURE_W, STRUCTURE_H);
    currentBuild = result;
    buildPreviewEl.innerHTML = result.svg;
    buildFormulaEl.textContent = result.formula + (result.mw ? ` (MW ${result.mw})` : "");
    buildSmilesEl.textContent = result.smiles || "—";
    renderRgroupInputs(result.rgroups);
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
    renderRgroupInputs([]);
  }
}

/** Builds one R-group definition row (main or nested sub-generic). */
function makeRgroupRow(label: string, isSub: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = isSub ? "rgroup-row rgroup-sub" : "rgroup-row";
  row.dataset.label = label;
  const lab = document.createElement("span");
  lab.className = "rgroup-label";
  lab.textContent = `${label} =`;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rgroup-input";
  input.placeholder = isSub
    ? "sub-group definition, e.g. halogen, hydroxy"
    : "e.g. H, C1-6 alkyl, opt sub phenyl, substituted with R1a, …";
  input.value = rgroupValues[label] || "";
  input.addEventListener("input", () => {
    rgroupValues[label] = input.value;
    syncSubGroups();
  });
  row.append(lab, input);
  return row;
}

/** Sub-generic R-group labels referenced (transitively) from the main definitions. */
function collectSubGroups(): string[] {
  const known: Record<string, true> = {};
  for (const l of mainRgroups) known[l] = true;
  const subs: string[] = [];
  let frontier = mainRgroups.slice();
  // Bounded depth guards against a definition that references itself in a cycle.
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const next: string[] = [];
    for (const label of frontier) {
      for (const ref of referencedRGroups(rgroupValues[label] || "")) {
        if (!known[ref]) {
          known[ref] = true;
          subs.push(ref);
          next.push(ref);
        }
      }
    }
    frontier = next;
  }
  return subs;
}

/** Reconciles the sub-group input rows with the labels currently referenced,
 *  adding/removing rows in place so focus and caret are preserved while typing. */
function syncSubGroups(): void {
  if (!subGroupWrap) return;
  const subs = collectSubGroups();
  // Prune stored values that are neither a current main group nor a live sub-group.
  const valid: Record<string, true> = {};
  for (const l of mainRgroups) valid[l] = true;
  for (const l of subs) valid[l] = true;
  for (const key of Object.keys(rgroupValues)) {
    if (!valid[key]) delete rgroupValues[key];
  }
  const existing: Record<string, HTMLElement> = {};
  for (const child of Array.from(subGroupWrap.children)) {
    const el = child as HTMLElement;
    if (el.dataset.label) existing[el.dataset.label] = el;
  }
  for (const label of Object.keys(existing)) {
    if (subs.indexOf(label) < 0) {
      subGroupWrap.removeChild(existing[label]);
      delete existing[label];
    }
  }
  for (const label of subs) {
    if (!existing[label]) subGroupWrap.appendChild(makeRgroupRow(label, true));
  }
}

/** Renders one definition input per R-group present in the built structure. */
function renderRgroupInputs(rgroups: string[]): void {
  buildRgroupsEl.replaceChildren();
  mainRgroups = rgroups.slice();
  subGroupWrap = null;
  if (!rgroups.length) {
    // No R-groups: drop every stored definition (sub-groups exist only via mains).
    for (const key of Object.keys(rgroupValues)) delete rgroupValues[key];
    return;
  }
  // Drop values for main R-groups no longer present (keep referenced sub-groups).
  for (const label of rgroups) {
    buildRgroupsEl.appendChild(makeRgroupRow(label, false));
  }

  subGroupWrap = document.createElement("div");
  subGroupWrap.className = "rgroup-subs";
  buildRgroupsEl.appendChild(subGroupWrap);
  syncSubGroups();

  // Legend insertion format: an inline "where R1 = …" line or a structured table.
  const fmtRow = document.createElement("div");
  fmtRow.className = "legend-format";
  const fmtLab = document.createElement("span");
  fmtLab.className = "rgroup-label";
  fmtLab.textContent = "Insert as";
  fmtRow.appendChild(fmtLab);
  for (const [value, text] of [
    ["line", "Line"],
    ["table", "Table"],
  ] as const) {
    const id = `legend-fmt-${value}`;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "legend-format";
    radio.id = id;
    radio.checked = legendFormat === value;
    radio.addEventListener("change", () => {
      if (radio.checked) legendFormat = value;
    });
    const radioLab = document.createElement("label");
    radioLab.className = "legend-format-label";
    radioLab.htmlFor = id;
    radioLab.textContent = text;
    fmtRow.append(radio, radioLab);
  }
  buildRgroupsEl.appendChild(fmtRow);
}

/** Collects the current R-group definitions (main groups first, then nested
 *  sub-groups in reference order) as raw legend entries. */
function currentLegendEntries(): LegendEntry[] {
  const labels = [...mainRgroups, ...collectSubGroups()];
  return labels.map((label) => ({ label, definition: rgroupValues[label] || "" }));
}

/** Inserts the built molecule's structure as an inline picture, plus an R-group legend if defined. */
async function insertBuild(): Promise<void> {
  const molecule = currentBuild;
  if (!molecule) {
    setStatus("Nothing built to insert.", "error");
    return;
  }

  insertBuildBtn.disabled = true;
  setStatus("Inserting structure…");

  try {
    const base64 = await svgToPngBase64(molecule.svg, STRUCTURE_W, STRUCTURE_H);
    const label = molecule.formula || "molecule";
    const alt = provenanceAltText(`2D structure (${label})`, molecule.formula, molecule.mw, molecule.smiles, molecule.idcode);
    const entries = currentLegendEntries();
    const legendLine = buildLegendText(entries);
    const legendTable = legendFormat === "table" ? buildLegendTableHtml(entries) : "";
    const hasLegend = legendFormat === "table" ? !!legendTable : !!legendLine;
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = alt;
      const tail = picture.getRange(Word.RangeLocation.end);
      if (legendFormat === "table" && legendTable) {
        const para = tail.insertParagraph("", Word.InsertLocation.after);
        para.getRange().insertHtml(legendTable, Word.InsertLocation.replace);
      } else if (legendLine) {
        tail.insertParagraph(legendLine, Word.InsertLocation.after).getRange().select(Word.SelectionMode.end);
      } else {
        tail.select(Word.SelectionMode.end);
      }
      await context.sync();
    });
    setStatus(hasLegend ? "Structure + R-group legend inserted." : "Structure inserted.", "success");
    recordInsert("build", buildInput.value, label);
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
