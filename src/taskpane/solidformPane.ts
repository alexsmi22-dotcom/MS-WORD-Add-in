// The Solid form tool's pane (docs/SCOPE-SOLID-FORM.md): XRPD, DSC or TGA data in; the figure, the table and the
// claim or Example sentence out, each inserted on its own. Every number comes from lib/solidformAnalyze.ts — the pane
// only shows it and hands it to Word.

import { analyzeSolid, solidExample, SolidKind, SolidResult } from "../lib/solidformAnalyze";
import type { WavelengthId } from "../lib/solidform";
import { tableRowsNote } from "../lib/tablefigure";

export interface SolidformPaneDeps {
  setStatus: (text: string, kind?: "success" | "error" | "") => void;
  /** The pane's styled figure insert; resolves to the words for the status line ("as PNG at 300 dpi …"). */
  insertFigure: (o: { svg: string; render: (w: number) => string; alt: string; chartKind: string }) => Promise<string>;
  /** Resolves false when the insert did not happen (the host has already said why). */
  insertText: (text: string) => Promise<boolean>;
  /** Resolves to the row count Word reports for the table (null/void when it cannot say). */
  insertTable: (rows: string[][], label: string) => Promise<number | null | void>;
}

export interface SolidformPaneApi {
  update: () => void;
  /** The figure on show, for the multi-panel tray; null when there is none. */
  currentFigure: () => { svg: string; render: (w: number) => string; source: string } | null;
}

const HELP: Record<SolidKind, string> = {
  xrpd: "Paste the diffractometer's export (two columns: 2θ and counts) to pick the peaks, or type a peak list: 2θ per line, optionally with an intensity (6.8 1800).",
  dsc: "Paste two columns: temperature (°C) and heat flow. Onsets are read by the tangent method; say which way endotherms point.",
  tga: "Paste two columns: temperature (°C) and weight (% or mg). Steps are read from the rate of loss; losses are % of the starting weight.",
};

const NAMES: Record<SolidKind, string> = { xrpd: "XRPD pattern", dsc: "DSC thermogram", tga: "TGA thermogram" };

export function initSolidformPane(deps: SolidformPaneDeps): SolidformPaneApi {
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const kind = el<HTMLSelectElement>("solid-kind");
  const help = el<HTMLElement>("solid-help");
  const input = el<HTMLTextAreaElement>("solid-input");
  const exampleBtn = el<HTMLButtonElement>("solid-example");
  const xrpdOpts = el<HTMLElement>("solid-xrpd-opts");
  const thermalOpts = el<HTMLElement>("solid-thermal-opts");
  const wavelength = el<HTMLSelectElement>("solid-wavelength");
  const minRel = el<HTMLInputElement>("solid-minrel");
  const cite = el<HTMLInputElement>("solid-cite");
  const tol = el<HTMLSelectElement>("solid-tol");
  const endo = el<HTMLSelectElement>("solid-endo");
  const endoRow = el<HTMLElement>("solid-endo-row");
  const yUnits = el<HTMLInputElement>("solid-yunits");
  const unitsRow = el<HTMLElement>("solid-units-row");
  const colsRow = el<HTMLElement>("solid-cols-row");
  const xCol = el<HTMLSelectElement>("solid-xcol");
  const yCol = el<HTMLSelectElement>("solid-ycol");
  const subject = el<HTMLInputElement>("solid-subject");
  const preview = el<HTMLElement>("solid-preview");
  const table = el<HTMLTableElement>("solid-table");
  const textOut = el<HTMLElement>("solid-text");
  const notesEl = el<HTMLElement>("solid-notes");
  const figBtn = el<HTMLButtonElement>("solid-insert-fig");
  const tableBtn = el<HTMLButtonElement>("solid-insert-table");
  const textBtn = el<HTMLButtonElement>("solid-insert-text");

  let current: Extract<SolidResult, { ok: true }> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  // The units box keeps what the user typed; the column pickers keep what the user chose, until the columns change.
  let unitsEdited = false;
  let picked: { names: string; x: number; y: number } | null = null;

  const num = (v: string, d: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== "" ? n : d;
  };

  const showNotes = (errors: string[], notes: string[]): void => {
    notesEl.replaceChildren();
    for (const [list, cls] of [[errors, "scheme-error"], [notes, "scheme-warn"]] as const) {
      for (const t of list) {
        const li = document.createElement("li");
        li.className = cls;
        li.textContent = t;
        notesEl.appendChild(li);
      }
    }
  };

  const showTable = (rows: string[][]): void => {
    table.replaceChildren();
    if (rows.length < 2) return;
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      for (const c of r) {
        const cell = document.createElement(i === 0 ? "th" : "td");
        cell.textContent = c;
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    });
  };

  const setButtons = (): void => {
    figBtn.disabled = busy || !current;
    tableBtn.disabled = busy || !current || current.rows.length < 2;
    textBtn.disabled = busy || !current || !current.text;
  };

  const update = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    const k = kind.value as SolidKind;
    if (!unitsEdited) yUnits.value = "W/g";
    help.textContent = HELP[k];
    xrpdOpts.style.display = k === "xrpd" ? "" : "none";
    thermalOpts.style.display = k === "xrpd" ? "none" : "";
    endoRow.style.display = k === "dsc" ? "" : "none";
    // TGA is always drawn in % (of the starting weight when it arrives in mg): only DSC has units to name.
    unitsRow.style.display = k === "dsc" ? "" : "none";
    current = null;
    const base = {
      wavelength: wavelength.value as WavelengthId,
      minRelative: num(minRel.value, 5),
      cite: Math.round(num(cite.value, 5)),
      tolerance: num(tol.value, 0.2),
      endoDown: endo.value !== "up",
      yUnits: yUnits.value,
      // The header's unit ("Heat Flow (mW)") until the user types one.
      unitsFromHeader: !unitsEdited,
      subject: subject.value,
    };
    let r = input.value.trim() ? analyzeSolid(k, input.value, base) : null;
    // The user's column choice applies only to the file it was made on: same columns, same names.
    if (r && picked) {
      const names = r.columns ? JSON.stringify(r.columns.names) : null;
      if (names === picked.names) r = analyzeSolid(k, input.value, { ...base, xCol: picked.x, yCol: picked.y });
      else picked = null;
    }
    if (r && r.ok && r.units && !unitsEdited) yUnits.value = r.units;
    // The pickers: shown for a thermal export with more than two columns, filled from its header.
    const cols = r && k !== "xrpd" ? r.columns ?? null : null;
    if (cols) {
      const key = JSON.stringify(cols.names);
      if (picked && picked.names !== key) picked = null;
      const fill = (sel: HTMLSelectElement, at: number) => {
        sel.replaceChildren(...cols.names.map((nm, i) => Object.assign(document.createElement("option"), { value: String(i), textContent: nm })));
        sel.value = String(at);
      };
      fill(xCol, cols.x);
      fill(yCol, cols.y);
      colsRow.hidden = false;
    } else colsRow.hidden = true;
    if (!r || !r.ok) {
      preview.replaceChildren();
      table.replaceChildren();
      textOut.textContent = "";
      if (!r) {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = "Paste the data, or press Example.";
        preview.appendChild(hint);
        notesEl.replaceChildren();
      } else showNotes(r.errors, r.notes);
      setButtons();
      return;
    }
    current = r;
    // plot.ts escapes every label it draws; the numbers are the user's own.
    preview.innerHTML = r.svg;
    showTable(r.rows);
    textOut.textContent = r.text;
    showNotes([], r.notes);
    setButtons();
  };
  const soon = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, 200);
  };

  input.addEventListener("input", soon);
  yUnits.addEventListener("input", () => (unitsEdited = true));
  const pick = (): void => {
    const names = JSON.stringify([...xCol.options].map((o) => o.textContent ?? ""));
    picked = { names, x: Number(xCol.value), y: Number(yCol.value) };
    update();
  };
  xCol.addEventListener("change", pick);
  yCol.addEventListener("change", pick);
  for (const c of [minRel, cite, yUnits, subject]) c.addEventListener("input", soon);
  for (const c of [kind, wavelength, tol, endo]) c.addEventListener("change", update);
  exampleBtn.addEventListener("click", () => {
    const k = kind.value as SolidKind;
    input.value = solidExample(k);
    if (k === "dsc") endo.value = "down";
    update();
    deps.setStatus("Example loaded: synthetic data, not a real compound's.", "");
  });

  const run = async (what: () => Promise<string | null>): Promise<void> => {
    update();
    if (!current || busy) return;
    busy = true;
    setButtons();
    try {
      const said = await what();
      if (said) deps.setStatus(said, "success");
    } catch (e) {
      deps.setStatus(`Could not insert: ${(e as Error).message}`, "error");
    } finally {
      busy = false;
      setButtons();
    }
  };
  const insertFigureNow = async (): Promise<string> => {
    const c = current!;
    const k = kind.value as SolidKind;
    const how = await deps.insertFigure({ svg: c.svg, render: c.render, alt: `${NAMES[k]} (JurisLab): ${c.text || c.tableLabel}`.slice(0, 1000), chartKind: `solid-${k}` });
    return `${NAMES[k]} inserted ${how}.`;
  };
  const insertTableNow = async (): Promise<string> => {
    const c = current!;
    const got = await deps.insertTable(c.rows, c.tableLabel);
    return `${c.tableLabel} inserted (${tableRowsNote(c.rows, got)}).`;
  };
  const insertTextNow = async (): Promise<string | null> => ((await deps.insertText(current!.text)) ? "Sentence inserted." : null);
  // Each listener names its insert handler on its own line (the host-trace gate finds the insert buttons that way).
  figBtn.addEventListener("click", () => run(insertFigureNow));
  tableBtn.addEventListener("click", () => run(insertTableNow));
  textBtn.addEventListener("click", () => run(insertTextNow));
  update();
  return {
    update,
    currentFigure: () => (current ? { svg: current.svg, render: current.render, source: `Solid form (${NAMES[kind.value as SolidKind]})` } : null),
  };
}
