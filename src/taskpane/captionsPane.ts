/**
 * Captions & cross-references with Word's own fields (docs/SCOPE-CAPTIONS.md): the Word-fields half of the Captions
 * section, and the field-numbered equation numbers the Math tool asks for. The plain-text half (counters in the
 * document's settings, typed numbers) stays in taskpane.ts as it was.
 *
 * What JurisLab numbered is remembered in the document's settings (bookmark, label, text) so the cross-reference list
 * can offer it; the NUMBER offered is always the bookmark's current text in the document — Word's own — never a count
 * kept here.
 */
import type { Host } from "../host/host";
import {
  captionOoxml,
  crossRefChoices,
  crossRefOoxml,
  equationNumberRuns,
  nextNumber,
  parseCaptionRegistry,
  refBookmarkName,
  tableOfFiguresOoxml,
  type CaptionEntry,
  type CaptionLabel,
} from "../lib/captionFields";

export const CAPTIONS_SETTING = "formula-inserter.captionFields";
/** The numbering this document uses (fields / text), so a plain-text document stays plain text (release A review). */
export const CAPTIONS_MODE_SETTING = "formula-inserter.captionMode";
/** The plain-text half's counters (taskpane.ts REFS_SETTING): a document that has them numbers in plain text. */
const PLAIN_COUNTERS_SETTING = "formula-inserter.refs";

export interface CaptionsPaneHost {
  docHost: Pick<Host, "getSetting" | "setSetting" | "saveSettings" | "insertParagraphOoxmlAfter" | "insertAtSelection" | "updateBodyFields" | "readBookmarkTexts" | "heading1Numbering">;
  setStatus(text: string, kind?: "error" | "success" | ""): void;
}

export interface CaptionsPane {
  /** Word-fields mode on? (else the plain-text half in taskpane.ts handles captions and references). */
  fieldsMode(): boolean;
  /** Insert a caption with Word fields; the status says what happened. */
  insertCaption(label: CaptionLabel, text: string): Promise<void>;
  /** The runs for a field-numbered equation number, registered for cross-references (null: refused, status said why). */
  equationNumber(source: string, chapter: boolean): Promise<string | null>;
  /** After an equation went in: Word recomputes the numbers; what to add to the status (the F9 advice where Word cannot). */
  afterEquation(): Promise<string>;
  /** Re-read the list of things to refer to. */
  refresh(): Promise<void>;
}

const LABEL_OF: Record<string, CaptionLabel> = { figure: "Figure", table: "Table", scheme: "Scheme" };

export function initCaptionsPane(host: CaptionsPaneHost): CaptionsPane {
  const el = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
  const modeSel = el<HTMLSelectElement>("ref-mode");
  const chapterBox = el<HTMLInputElement>("ref-chapter");
  const chapterRow = el<HTMLElement>("ref-chapter-row");
  const xrefFields = el<HTMLElement>("ref-xref-fields");
  const xrefText = el<HTMLElement>("ref-xref-text");
  const targetSel = el<HTMLSelectElement>("ref-xref-target");
  const refreshBtn = el<HTMLButtonElement>("ref-xref-refresh");
  const insertRefBtn = el<HTMLButtonElement>("ref-insert-xref-field");
  const updateBtn = el<HTMLButtonElement>("ref-update");
  const tofSel = el<HTMLSelectElement>("ref-tof-label");
  const tofBtn = el<HTMLButtonElement>("ref-insert-tof");
  const nextEl = el<HTMLElement>("ref-next");
  const resetBtn = el<HTMLButtonElement>("ref-reset");
  const kindSel = el<HTMLSelectElement>("ref-kind");

  let choices: Array<CaptionEntry & { number: string }> = [];
  let seq = 0;

  const fieldsMode = (): boolean => (modeSel?.value ?? "fields") === "fields";
  const registry = (): CaptionEntry[] => {
    try {
      const raw = host.docHost.getSetting(CAPTIONS_SETTING) as string | null;
      return parseCaptionRegistry(raw ? JSON.parse(raw) : []);
    } catch {
      return [];
    }
  };
  const saveRegistry = (reg: CaptionEntry[]): void => {
    try {
      host.docHost.setSetting(CAPTIONS_SETTING, JSON.stringify(reg));
      host.docHost.saveSettings();
    } catch {
      /* best-effort: the captions are in the document either way */
    }
  };
  /** A bookmark name not yet used (time and a counter: two inserted in one millisecond still differ). */
  const newBookmark = (): string => {
    const taken = new Set(registry().map((e) => e.bookmark));
    let b = "";
    do b = refBookmarkName(Date.now() * 7 + seq++ * 131 + Math.floor(Math.random() * 1000));
    while (taken.has(b));
    return b;
  };

  function showMode(): void {
    const f = fieldsMode();
    if (xrefFields) xrefFields.hidden = !f;
    if (xrefText) xrefText.hidden = f;
    if (chapterRow) chapterRow.hidden = !f;
    if (tofBtn) tofBtn.disabled = !f;
    if (tofSel) tofSel.disabled = !f;
    if (updateBtn) updateBtn.disabled = !f;
    // Word numbers field captions itself: there is no counter here to show or reset.
    if (f && nextEl) nextEl.textContent = "numbered by Word";
    if (resetBtn) resetBtn.hidden = f;
  }

  function renderTargets(): void {
    if (!targetSel) return;
    targetSel.textContent = "";
    if (!choices.length) {
      targetSel.add(new Option("Nothing numbered with Word fields yet", ""));
      targetSel.disabled = true;
      if (insertRefBtn) insertRefBtn.disabled = true;
      return;
    }
    targetSel.disabled = false;
    if (insertRefBtn) insertRefBtn.disabled = false;
    for (const c of choices) {
      const head = c.label === "Equation" ? `Eq. (${c.number})` : `${c.label} ${c.number}`;
      const t = c.text.trim();
      targetSel.add(new Option(t ? `${head} — ${t.length > 50 ? t.slice(0, 49) + "…" : t}` : head, c.bookmark));
    }
  }

  async function refresh(): Promise<void> {
    const reg = registry();
    if (!reg.length) {
      choices = [];
      renderTargets();
      return;
    }
    const current = await host.docHost.readBookmarkTexts(reg.map((e) => e.bookmark));
    if (current === null) {
      choices = [];
      renderTargets();
      host.setStatus("This version of Word cannot read bookmarks (WordApi 1.4), so the list of things to refer to is empty — use Plain text numbering, or Word's own Insert ▸ Cross-reference.", "error");
      return;
    }
    // A caption whose bookmark is missing is not offered — but kept: it may be mid-move (cut, then pasted) or deleted
    // and undone, and comes back with its bookmark (release A review: pruned, a moved figure was never offered again).
    choices = crossRefChoices(reg, current);
    renderTargets();
  }

  const F9 = "select all (Ctrl+A, or ⌘A on a Mac) and press F9 to renumber";
  /** Word recomputes the numbers. "" when it did; otherwise what to tell the user (the caller composes the status). */
  function rememberFieldsMode(): void {
    try {
      if (host.docHost.getSetting(CAPTIONS_MODE_SETTING) !== "fields") {
        host.docHost.setSetting(CAPTIONS_MODE_SETTING, "fields");
        host.docHost.saveSettings();
      }
    } catch {
      /* best-effort */
    }
  }
  async function renumber(): Promise<string> {
    rememberFieldsMode();
    let r: "updated" | "unsupported" | "failed";
    try {
      r = await host.docHost.updateBodyFields();
    } catch {
      r = "failed";
    }
    if (r === "unsupported") return `This version of Word cannot update fields from the add-in — ${F9}.`;
    if (r === "failed") return `Word did not update the fields — ${F9}.`;
    try {
      await refresh();
    } catch {
      /* the list is refreshed on the next click */
    }
    return "";
  }
  async function updateNumbers(): Promise<void> {
    const note = await renumber();
    host.setStatus(note || "Numbers updated: every caption, equation number, cross-reference, table of figures and table of contents.", note ? "error" : "success");
  }
  async function updateCrossRefList(): Promise<void> {
    try {
      await refresh();
    } catch (e) {
      host.setStatus(`Could not read the document's numbered items: ${(e as Error).message}`, "error");
    }
  }

  /**
   * Chapter numbering (STYLEREF 1 \s + SEQ … \s 1) only works when Heading 1 is list-numbered; otherwise Word prints
   * "Figure 0.1" or "Error! No text of specified style" in the user's document (fix2, seen in real Word). The reason
   * it is refused, or "" when chapter numbering can go ahead.
   */
  async function chapterRefusal(): Promise<string> {
    let state: Awaited<ReturnType<CaptionsPaneHost["docHost"]["heading1Numbering"]>>;
    try {
      state = await host.docHost.heading1Numbering();
    } catch {
      state = "unknown";
    }
    if (state === "numbered") return "";
    if (state === "none") return "Chapter numbering needs chapters: no paragraph uses the Heading 1 style. Style each chapter title Heading 1 with a numbered list (Home ▸ Multilevel List), or untick “by chapter”.";
    if (state === "unnumbered") return "Chapter numbering needs numbered chapters: the Heading 1 paragraphs carry no list numbering, so Word would print “Figure 0.1” or an error. Number them (Home ▸ Multilevel List, linked to Heading 1), or untick “by chapter”.";
    return "This version of Word cannot say whether the chapters (Heading 1) are numbered, so chapter numbering is not used — untick “by chapter”, or check the headings are numbered and try in a newer Word.";
  }

  async function insertCaption(label: CaptionLabel, text: string): Promise<void> {
    const bookmark = newBookmark();
    const chapter = !!chapterBox?.checked;
    if (chapter) {
      const why = await chapterRefusal();
      if (why) return host.setStatus(`Caption not inserted. ${why}`, "error");
    }
    let ooxml: string;
    try {
      await refresh();
      ooxml = captionOoxml({ label, shown: nextNumber(choices, label), bookmark, ...(chapter ? { chapter: { shown: 1 } } : {}) }, text);
    } catch (e) {
      return host.setStatus(`Could not insert the caption: ${(e as Error).message}`, "error");
    }
    try {
      await host.docHost.insertParagraphOoxmlAfter({ ooxml, tag: `formula-inserter:caption:${label.toLowerCase()}`, caption: true });
    } catch (e) {
      return host.setStatus(`Could not insert the caption: ${(e as Error).message}`, "error");
    }
    saveRegistry([...registry(), { bookmark, label, text: text.trim().slice(0, 200) }]);
    const note = await renumber();
    host.setStatus(note ? `${label} caption inserted. ${note}` : `${label} caption inserted with Word's numbering${chapter ? " (by chapter)" : ""} — it renumbers when Update numbers runs (or F9).`, note ? "" : "success");
  }

  async function equationNumber(source: string, chapter: boolean): Promise<string | null> {
    if (chapter) {
      const why = await chapterRefusal();
      if (why) {
        host.setStatus(`Equation not numbered by chapter. ${why}`, "error");
        return null;
      }
    }
    try {
      await refresh();
      const bookmark = newBookmark();
      const runs = equationNumberRuns({ shown: nextNumber(choices, "Equation"), bookmark, ...(chapter ? { chapter: { shown: 1 } } : {}) });
      saveRegistry([...registry(), { bookmark, label: "Equation", text: source.trim().slice(0, 200) }]);
      return runs;
    } catch (e) {
      host.setStatus(`Could not number the equation: ${(e as Error).message}`, "error");
      return null;
    }
  }

  modeSel?.addEventListener("change", () => {
    try {
      host.docHost.setSetting(CAPTIONS_MODE_SETTING, modeSel.value);
      host.docHost.saveSettings();
    } catch {
      /* best-effort */
    }
    showMode();
    if (fieldsMode()) void updateCrossRefList();
  });
  kindSel?.addEventListener("change", () => fieldsMode() && showMode());
  refreshBtn?.addEventListener("click", () => void updateCrossRefList());
  updateBtn?.addEventListener("click", () => void updateNumbers());
  insertRefBtn?.addEventListener("click", async () => {
    const c = choices.find((x) => x.bookmark === targetSel?.value);
    if (!c) return host.setStatus("Choose what to refer to (refresh list if it is missing).", "error");
    try {
      await host.docHost.insertAtSelection({ kind: "ooxml", content: crossRefOoxml(c.label, c.bookmark, c.number), at: "replace", select: "inserted", tag: "formula-inserter:xref" });
      const shown = c.label === "Equation" ? `Eq. (${c.number})` : `${c.label === "Figure" ? "Fig." : c.label} ${c.number}`;
      host.setStatus(`Inserted ${shown} — a Word cross-reference: it follows the ${c.label.toLowerCase()} when numbers change.`, "success");
    } catch (e) {
      host.setStatus(`Could not insert the reference: ${(e as Error).message}`, "error");
    }
  });
  async function insertTableOfFigures(): Promise<void> {
    const label = (tofSel?.value ?? "Figure") as CaptionLabel;
    const what = label === "Figure" ? "figures" : label === "Table" ? "tables" : "schemes";
    try {
      await host.docHost.insertParagraphOoxmlAfter({ ooxml: tableOfFiguresOoxml(label), tag: "formula-inserter:table-of-figures" });
    } catch (e) {
      return host.setStatus(`Could not insert the table: ${(e as Error).message}`, "error");
    }
    const note = await renumber();
    host.setStatus(note ? `Table of ${what} inserted. ${note}` : `Table of ${what} inserted — Update numbers (or F9 on it) refreshes it.`, note ? "" : "success");
  }
  tofBtn?.addEventListener("click", () => void insertTableOfFigures());
  // The document's numbering: as saved; a document already numbered in plain text (its counters saved) stays plain
  // text; a new one starts with Word fields.
  if (modeSel) {
    let saved: unknown = null, plain = false;
    try {
      saved = host.docHost.getSetting(CAPTIONS_MODE_SETTING);
      plain = !!host.docHost.getSetting(PLAIN_COUNTERS_SETTING);
    } catch {
      /* defaults below */
    }
    modeSel.value = saved === "fields" || saved === "text" ? saved : plain ? "text" : "fields";
  }
  showMode();
  // Word is not asked at start-up: the list says how to fill it until the first refresh (or caption) reads the document.
  if (targetSel) {
    targetSel.add(new Option("Click refresh list to see what this document numbers", ""));
    targetSel.disabled = true;
    if (insertRefBtn) insertRefBtn.disabled = true;
  }

  return {
    fieldsMode,
    insertCaption: (label, text) => insertCaption(label, text),
    equationNumber,
    afterEquation: async () => {
      const note = await renumber();
      return note ? ` ${note}` : "";
    },
    refresh,
  };
}

/** The caption label for the pane's kind select value. */
export function captionLabelOf(kind: string): CaptionLabel {
  return LABEL_OF[kind] ?? "Figure";
}
