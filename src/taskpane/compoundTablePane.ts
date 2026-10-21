// The compound table, in Reaction's "Compounds in this document" panel (docs/SCOPE-COMPOUND-TABLE.md): which columns,
// which compounds, the chemist's own columns and a caption in; one native Word table out, the structures as pictures in
// their cells. Every cell comes from lib/compoundTable.ts.

import { buildCompoundTable, CT_COLUMNS, type CtColumn } from "../lib/compoundTable";
import type { CompoundRegister } from "../lib/compoundRegister";
import type { CellPicture, PictureTableInsert } from "../host/host";

export interface CompoundTablePaneDeps {
  setStatus: (text: string, kind?: "success" | "error" | "") => void;
  loadRegister: () => CompoundRegister;
  /** The SVG rasterised to a PNG of w × h pixels (base64). */
  rasterize: (svg: string, w: number, h: number) => Promise<string>;
  insertPictureTable: (o: PictureTableInsert) => Promise<void>;
}

export interface CompoundTablePaneApi {
  update: () => void;
}

/** A structure cell is at most this size in points (about 1.6 × 1.25 in); a smaller drawing keeps its ACS size. */
export const CELL_MAX_W = 115;
export const CELL_MAX_H = 90;
/** Pictures are rasterised at 300 dpi. */
const PX_PER_PT = 300 / 72;

/** The user's column headings: split at commas outside brackets, so "IC50 (nM, HEK293)" stays one. */
export function splitHeadings(text: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export function fitCell(widthPt: number, heightPt: number): { w: number; h: number } {
  // A drawing always has a positive size; anything else gets the cell's own.
  if (!(widthPt > 0 && heightPt > 0 && Number.isFinite(widthPt) && Number.isFinite(heightPt))) return { w: CELL_MAX_W, h: CELL_MAX_H };
  const s = Math.min(1, CELL_MAX_W / widthPt, CELL_MAX_H / heightPt);
  return { w: Math.round(widthPt * s * 10) / 10, h: Math.round(heightPt * s * 10) / 10 };
}

export function initCompoundTablePane(deps: CompoundTablePaneDeps): CompoundTablePaneApi {
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const boxes = CT_COLUMNS.map((c) => ({ id: c.id, box: el<HTMLInputElement>(`ct-col-${c.id}`) }));
  const select = el<HTMLInputElement>("ct-select");
  const extra = el<HTMLInputElement>("ct-extra");
  const caption = el<HTMLInputElement>("ct-caption");
  const summary = el<HTMLElement>("ct-summary");
  const notesEl = el<HTMLElement>("ct-notes");
  const insertBtn = el<HTMLButtonElement>("ct-insert");
  let busy = false;
  // What the last Insert found (names it could not give, structures it could not draw): shown until the options change.
  let insertNotes: string[] = [];

  const options = () => ({
    columns: boxes.filter((b) => b.box.checked).map((b) => b.id as CtColumn),
    select: select.value,
    extra: splitHeadings(extra.value),
  });
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

  let lastRegister = "";
  const update = (): void => {
    const reg = deps.loadRegister();
    // A changed register (a compound added or forgotten) makes the last Insert's notes stale.
    const sig = reg.entries.map((e) => `${e.label}=${e.idcode}`).join("|");
    if (sig !== lastRegister) (insertNotes = []), (lastRegister = sig);
    // The cheap columns only, for the summary: drawing every structure on each keystroke is for Insert.
    const o = options();
    const t = buildCompoundTable(reg, { ...o, columns: o.columns.filter((c) => c !== "structure" && c !== "name") });
    if (t.errors.length) {
      summary.textContent = "";
      showNotes(t.errors, []);
      insertBtn.disabled = true;
      return;
    }
    summary.textContent = `${t.rows.length} compound${t.rows.length === 1 ? "" : "s"} (${t.rows.map((r) => r.label).join(", ")}) · columns: Compound${o.columns.length ? `, ${CT_COLUMNS.filter((c) => o.columns.includes(c.id)).map((c) => c.head).join(", ")}` : ""}${o.extra.length ? `, ${o.extra.join(", ")}` : ""}`;
    showNotes([], [...new Set([...insertNotes, ...t.notes])]);
    insertBtn.disabled = busy || !t.rows.length;
  };

  const changed = (): void => {
    insertNotes = [];
    update();
  };
  for (const b of boxes) b.box.addEventListener("change", changed);
  for (const i of [select, extra]) i.addEventListener("input", changed);

  const insertCompoundTable = async (): Promise<void> => {
    if (busy) return;
    const t = buildCompoundTable(deps.loadRegister(), options());
    if (t.errors.length) {
      showNotes(t.errors, t.notes);
      return;
    }
    busy = true;
    insertBtn.disabled = true;
    deps.setStatus(`Drawing ${t.rows.length} compound${t.rows.length === 1 ? "" : "s"}…`);
    try {
      const rows: PictureTableInsert["rows"] = [t.header];
      for (const r of t.rows) {
        const cells: Array<string | CellPicture> = [...r.cells];
        if (t.structureCol >= 0) {
          if (r.structure) {
            const size = fitCell(r.structure.widthPt, r.structure.heightPt);
            const base64 = await deps.rasterize(r.structure.svg, Math.round(size.w * PX_PER_PT), Math.round(size.h * PX_PER_PT));
            cells[t.structureCol] = { base64, widthPt: size.w, heightPt: size.h, alt: `Structure of compound ${r.label}` };
          } else cells[t.structureCol] = "—";
        }
        rows.push(cells);
      }
      await deps.insertPictureTable({ rows, label: caption.value.trim() });
      insertNotes = t.notes;
      const named = options().columns.includes("name") ? " Names come from the offline namer — verify them before filing." : "";
      deps.setStatus(`Compound table inserted: ${t.rows.length} compound${t.rows.length === 1 ? "" : "s"}.${named}`, "success");
    } catch (e) {
      deps.setStatus(`Could not insert the compound table: ${(e as Error).message}`, "error");
    } finally {
      busy = false;
      update();
    }
  };
  // The listener names its insert handler (the host-trace gate finds the insert button that way).
  insertBtn.addEventListener("click", () => void insertCompoundTable());
  update();
  return { update };
}
