/**
 * Word-native captions, equation numbers, cross-references and a table of figures (docs/SCOPE-CAPTIONS.md): the
 * numbers are Word's own fields, so they renumber when a figure is added, moved or deleted and a cross-reference
 * follows its target — what Insert ▸ Caption and Insert ▸ Cross-reference write, not static text.
 *
 * - A caption is a paragraph in the Caption style: "Figure ", a SEQ field, ". " and the text. The number (and the
 *   chapter number before it, when asked) sits inside a hidden bookmark (_Ref…, as Word names its own), the target
 *   of every cross-reference to it.
 * - An equation number is "(" SEQ Equation ")" at the right tab stop of the equation's paragraph, bookmarked alike.
 * - A cross-reference is the label written out ("Fig. ", "Table ", "Eq. (") and a REF field to the bookmark (\h: a
 *   link to the target), so "Fig. 3" becomes "Fig. 4" when a figure is inserted before it and the fields update.
 * - A table of figures is a TOC field over the captions with that label (\c "Figure").
 *
 * Pure string building — no Office.js. A field's displayed number is written as the number it will have when Word
 * updates it (the caller counts); Word recomputes it on update (F9, print, or the pane's Update numbers).
 */
import { flatOpcPackage } from "./mathOmml";

export type CaptionLabel = "Figure" | "Table" | "Scheme" | "Equation";

/** The labels a caption can carry (Word's Insert Caption labels, plus Scheme for chemistry). */
export const CAPTION_LABELS: CaptionLabel[] = ["Figure", "Table", "Scheme"];

/** How a cross-reference writes each label. */
export const XREF_TEXT: Record<CaptionLabel, { before: string; after: string }> = {
  Figure: { before: "Fig. ", after: "" },
  Table: { before: "Table ", after: "" },
  Scheme: { before: "Scheme ", after: "" },
  Equation: { before: "Eq. (", after: ")" },
};

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const run = (text: string, rPr = ""): string => `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
/** A simple field showing `shown` until Word updates it. */
const field = (instr: string, shown: string, rPr = ""): string =>
  `<w:fldSimple w:instr="${esc(` ${instr} `)}">${run(shown, rPr)}</w:fldSimple>`;

/**
 * A bookmark name in Word's own form for cross-reference targets: "_Ref" and digits (a leading underscore hides it
 * from the Bookmark dialog). `seed` makes it unique; Word allows 40 characters.
 */
export function refBookmarkName(seed: number): string {
  const n = Math.abs(Math.floor(seed)) % 1_000_000_000;
  return `_Ref${String(n).padStart(9, "0")}`;
}

/** Is this a bookmark name refBookmarkName writes? (A saved registry entry is read field by field.) */
export function isRefBookmarkName(s: unknown): s is string {
  return typeof s === "string" && /^_Ref\d{9}$/.test(s);
}

export interface NumberSpec {
  label: CaptionLabel;
  /** The number to show until Word updates the field (the next in the document, as the caller counts). */
  shown: number;
  /** Chapter numbering ("2.3"): the number of the nearest Heading 1 before it, then the SEQ restarted at each Heading 1. */
  chapter?: { shown: number };
  bookmark: string;
}

/**
 * The number as fields inside its bookmark: SEQ (and STYLEREF for the chapter). Separator "." (Figure 2.3), the
 * convention most theses and journals use.
 */
export function numberRuns(n: NumberSpec, rPr = ""): string {
  if (!(Number.isInteger(n.shown) && n.shown >= 1)) throw new Error("a caption number is a whole number from 1");
  if (!isRefBookmarkName(n.bookmark)) throw new Error("a cross-reference target needs a _Ref bookmark name");
  const seq = n.chapter
    ? field(`SEQ ${n.label} \\* ARABIC \\s 1`, String(n.shown), rPr)
    : field(`SEQ ${n.label} \\* ARABIC`, String(n.shown), rPr);
  const chapter = n.chapter ? field("STYLEREF 1 \\s", String(n.chapter.shown), rPr) + run(".", rPr) : "";
  // The bookmark id from its own digits: unique among JurisLab's targets, so two in one document never share one.
  const id = String(Number(n.bookmark.slice(4)) % 2_000_000_000);
  return `<w:bookmarkStart w:id="${id}" w:name="${n.bookmark}"/>${chapter}${seq}<w:bookmarkEnd w:id="${id}"/>`;
}

/** A caption paragraph (Caption style): "Figure 3. A widget" with Word's fields — as an insertable package. */
export function captionOoxml(n: NumberSpec, text: string): string {
  if (n.label === "Equation") throw new Error("an equation is numbered beside the equation, not with a caption");
  const t = text.trim();
  const body =
    `<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr>` +
    run(`${n.label} `) +
    numberRuns(n) +
    (t ? run(`. ${t}`) : "") +
    `</w:p>`;
  return flatOpcPackage(`<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}"><w:body>${body}</w:body></w:document>`);
}

/** The runs for an equation's number, "(3)" or "(2.3)", to put at the equation paragraph's right tab stop. */
export function equationNumberRuns(n: Omit<NumberSpec, "label">): string {
  return run("(") + numberRuns({ ...n, label: "Equation" }) + run(")");
}

/** A cross-reference: the label written out and a REF field to the target's bookmark, showing `shown` until updated. */
export function crossRefOoxml(label: CaptionLabel, bookmark: string, shown: string): string {
  if (!isRefBookmarkName(bookmark)) throw new Error("a cross-reference needs the target's _Ref bookmark name");
  const x = XREF_TEXT[label];
  const body = `<w:p>${run(x.before)}${field(`REF ${bookmark} \\h`, shown)}${x.after ? run(x.after) : ""}</w:p>`;
  return flatOpcPackage(`<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`);
}

/** A table of figures (or tables, or schemes): Word's TOC field over the captions with that label. */
export function tableOfFiguresOoxml(label: CaptionLabel): string {
  if (label === "Equation") throw new Error("a table of figures lists captions, not equations");
  const shown = `Update this field (right-click ▸ Update Field, or F9) to list the ${label === "Figure" ? "figures" : label === "Table" ? "tables" : "schemes"}.`;
  const body = `<w:p>${field(`TOC \\h \\z \\c "${label}"`, shown)}</w:p>`;
  return flatOpcPackage(`<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`);
}

/** One numbered item JurisLab inserted, as the document's settings remember it (for the cross-reference list). */
export interface CaptionEntry {
  bookmark: string;
  label: CaptionLabel;
  /** The caption's text (or the equation's source), to tell the entries apart in the list. */
  text: string;
}

/** The saved registry, read field by field (a damaged entry is dropped, never trusted). */
export function parseCaptionRegistry(raw: unknown): CaptionEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptionEntry[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { bookmark, label, text } = e as Record<string, unknown>;
    if (!isRefBookmarkName(bookmark) || seen.has(bookmark)) continue;
    if (label !== "Figure" && label !== "Table" && label !== "Scheme" && label !== "Equation") continue;
    seen.add(bookmark);
    out.push({ bookmark, label, text: typeof text === "string" ? text.slice(0, 200) : "" });
  }
  return out;
}

/**
 * The cross-reference list from the registry and what the document holds now: an entry whose bookmark is gone (its
 * caption deleted) is left out; the number shown is the bookmark's current text ("3", "2.3") — Word's own, after its
 * fields last updated.
 */
export function crossRefChoices(reg: CaptionEntry[], current: Record<string, string | null>): Array<CaptionEntry & { number: string }> {
  const out: Array<CaptionEntry & { number: string }> = [];
  for (const e of reg) {
    const t = current[e.bookmark];
    if (t === null || t === undefined) continue;
    const number = t.replace(/\s+/g, "").trim();
    if (!/^\d+(\.\d+)?$/.test(number)) continue; // the bookmark no longer holds a number: not offered
    out.push({ ...e, number });
  }
  return out;
}

/** The next number of a label as the document counts it now (the captions it holds with that label, plus one). */
export function nextNumber(choices: Array<{ label: CaptionLabel; number: string }>, label: CaptionLabel): number {
  return choices.filter((c) => c.label === label).length + 1;
}
