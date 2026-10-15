// The Citations ▸ Bibliography panel's decisions, kept out of taskpane.ts so they can be
// tested (docs/SCOPE-CITATIONS-2026-10.md §C2–§C4; taskpane.ts cannot be imported under jest).
//
// PURE: no Office.js. The pane reads Word (content controls, document settings), hands plain
// values to these functions, and writes back what they return. Every decision that could drop
// something silently lives here, where a test can see it:
//   - which importer a paste or a file goes to (BibTeX, RIS, CSL-JSON, or bare DOIs);
//   - every importer refusal, with its line number, and every merge outcome (added, identical,
//     renamed, refused), by name;
//   - which styles are offered (only the shipped ones) and the one-line note for the others;
//   - a record type the chosen style does not claim is REFUSED BY NAME, never formatted in
//     another style;
//   - the update plan: which controls get which text, the bibliography block, and every
//     problem list from renumberPlan under its own name.
//
// DOIs are recognised and normalised only. Nothing is fetched (DOI_OFFLINE_NOTE).

import type { BibRecord, BibStyle, BibType, CiteItem, Formatted, StyleId } from "./bibRecord";
import { parseBibtex } from "./bibtex";
import { parseRis } from "./ris";
import { parseCslJson, richTextToPlain, stripBom } from "./cslJson";
import { DOI_OFFLINE_NOTE, findDois, normalizeDoi } from "./doi";
import { STYLE_INFO, STYLE_RULES, formatReference, getStyle, referenceWarnings } from "./bibStyles";
import {
  addMarker, emptyStore, markersFromControls, mergeRecords, parseCiteTag, parseStore, setMarkerItems,
  type BibStoreData, type MarkerOccurrence, type MergeResult,
} from "./bibStore";
import { renumberPlan, type RenumberPlan } from "./bibliography";
import { bibliographyOoxml, decodeEntities } from "./bibOoxml";

// ======================================================================== import

export type BibFormat = "bibtex" | "ris" | "csl-json" | "doi";

const FORMAT_NAME: Record<BibFormat, string> = { bibtex: "BibTeX", ris: "RIS", "csl-json": "CSL-JSON", doi: "DOI" };

/**
 * Which importer a paste or a file goes to. The file extension wins when it is one of ours;
 * otherwise the content decides. Null: none of the four (the caller says so; nothing is guessed).
 */
/** The refusal for a PubMed "Citation manager" export (.nbib, MEDLINE tags "PMID- …"). */
export const MEDLINE_REFUSAL =
  "This is a PubMed MEDLINE (.nbib) file — not supported yet; export RIS from PubMed instead.";

/** True for MEDLINE/.nbib text: a "PMID- " tag line, or the .nbib extension. */
export function isMedline(text: string, fileName?: string): boolean {
  return /\.nbib$/i.test(fileName ?? "") || /^PMID- ?\d/m.test(stripBom(text ?? ""));
}

export function detectBibFormat(text: string, fileName?: string): BibFormat | null {
  // MEDLINE is neither RIS nor a bare DOI, even though it carries one ("LID - 10.… [doi]").
  if (isMedline(text, fileName)) return null;
  const ext = (fileName ?? "").toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (ext === "bib" || ext === "bibtex") return "bibtex";
  if (ext === "ris") return "ris";
  if (ext === "json") return "csl-json";
  const body = stripBom(text ?? "");
  const first = body.trimStart()[0];
  if (first === "[" || first === "{") return "csl-json";
  if (/^\s*@\s*[A-Za-z]+\s*[{(]/m.test(body)) return "bibtex";
  // "TY  - JOUR" (the spec, Zotero) and "TY - JOUR" (EndNote writes one space).
  if (/^TY {1,2}-/m.test(body)) return "ris";
  if (findDois(body).length) return "doi";
  return null;
}

export interface BibImportReport {
  format: BibFormat | null;
  records: BibRecord[];
  /** One line per importer refusal ("Line 12: …") or DOI, in input order. */
  lines: string[];
  /** Pasted DOIs, normalised. */
  dois: Array<{ doi: string; url: string }>;
  /** DOI_OFFLINE_NOTE, verbatim, whenever DOIs were pasted. */
  note?: string;
}

/** Parse a paste or a file's text. Never fetches anything. */
export function importBibText(text: string, fileName?: string): BibImportReport {
  const format = detectBibFormat(text, fileName);
  if (format === null && isMedline(text, fileName)) return { format, records: [], dois: [], lines: [MEDLINE_REFUSAL] };
  if (format === null) {
    return {
      format, records: [], dois: [],
      lines: ["Not recognised as BibTeX (@article{…}), RIS (TY  - JOUR), CSL-JSON ([{…}]) or a DOI (10.1086/720277). Nothing was imported."],
    };
  }
  if (format === "doi") {
    const dois: Array<{ doi: string; url: string }> = [];
    const lines: string[] = [];
    for (const d of findDois(text)) {
      const n = normalizeDoi(d);
      if ("error" in n) lines.push(n.error);
      else {
        dois.push(n);
        lines.push(`DOI ${n.doi} → ${n.url}`);
      }
    }
    return { format, records: [], dois, lines, note: DOI_OFFLINE_NOTE };
  }
  const res = format === "bibtex" ? parseBibtex(text) : format === "ris" ? parseRis(text) : parseCslJson(text);
  const lines = res.refused.map((r) => `Line ${r.line}: ${r.reason}`);
  return { format, records: res.records, dois: [], lines };
}

/** The import summary line ("BibTeX: 3 references read, 1 refused"). */
export function importSummary(rep: BibImportReport): string {
  if (!rep.format) return "Nothing was imported.";
  if (rep.format === "doi") return `${rep.dois.length} DOI${rep.dois.length === 1 ? "" : "s"} recognised. Nothing was looked up.`;
  const refused = rep.lines.length;
  return `${FORMAT_NAME[rep.format]}: ${rep.records.length} reference${rep.records.length === 1 ? "" : "s"} read`
    + (refused ? `, ${refused} refused (listed below with line numbers).` : ".");
}

/** Every outcome of merging an import into the library, by name. */
export function mergeReportLines(m: MergeResult): string[] {
  const out: string[] = [];
  if (m.added.length) out.push(`Added (${m.added.length}): ${m.added.join(", ")}`);
  if (m.identical.length) out.push(`Skipped as identical to the library copy (${m.identical.length}): ${m.identical.join(", ")}`);
  if (m.renamed.length) {
    out.push(`Renamed, because a different reference already uses the key (${m.renamed.length}): `
      + m.renamed.map((r) => `${r.from} → ${r.to}`).join(", "));
  }
  for (const r of m.refused) out.push(`Refused “${r.id}”: ${r.reason}`);
  if (!out.length) out.push("No references to add.");
  return out;
}

/** Merge an import into the store (wraps mergeRecords so the pane has one call). */
export function mergeImport(store: BibStoreData, records: BibRecord[]): { store: BibStoreData; lines: string[]; result: MergeResult } {
  const result = mergeRecords(store, records);
  return { store: result.store, lines: mergeReportLines(result), result };
}

/** For pasted DOIs: which are already in the library, by record id. Nothing is created. */
export function doiLibraryLines(dois: ReadonlyArray<{ doi: string }>, store: BibStoreData): string[] {
  return dois.map(({ doi }) => {
    const hits = Object.values(store.library).filter((r) => (r.DOI ?? "").toLowerCase() === doi.toLowerCase()).map((r) => r.id);
    return hits.length
      ? `${doi} is already in the library as ${hits.map((h) => `“${h}”`).join(", ")}.`
      : `${doi} is not in the library. Paste its BibTeX or RIS to add it.`;
  });
}

// ======================================================================== store

export type LoadResult = { ok: true; store: BibStoreData; fresh: boolean } | { ok: false; reason: string };

/**
 * The store from the document setting, or a fresh one. A refusal (newer version, damaged JSON)
 * means the pane must NOT write the setting; it shows the reason and disables editing.
 */
export function loadBibStore(raw: unknown, defaultStyle: StyleId = "ieee"): LoadResult {
  const p = parseStore(raw);
  if (!p.ok) return p;
  if (p.store) return { ok: true, store: p.store, fresh: false };
  return { ok: true, store: emptyStore(defaultStyle), fresh: true };
}

// ======================================================================== styles

/** The styles offered in the dropdown: only those that ship (7). */
export function offeredStyles(): Array<{ id: StyleId; name: string }> {
  return (Object.keys(STYLE_INFO) as StyleId[]).filter((id) => STYLE_INFO[id].shipped).map((id) => ({ id, name: STYLE_INFO[id].name }));
}

/** The one-line note for the styles that are not offered. */
export function notOfferedNote(): string {
  const names = (Object.keys(STYLE_INFO) as StyleId[]).filter((id) => !STYLE_INFO[id].shipped).map((id) => STYLE_INFO[id].name);
  if (!names.length) return "";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "is" : "are"} not offered: no official guide could be verified.`;
}

/**
 * The number label printed before each bibliography entry (the styles' reference() does not
 * print it). IEEE "[1]" and Vancouver "1." are the guides' forms; ACS "(1)" and Nature "1." are
 * the conventional list forms and are NOT pinned by a quoted manual example (TEST-SCRIPT §0ci).
 * Author-date and notes styles are unnumbered.
 */
export function bibLabel(id: StyleId): ((n: number) => string) | undefined {
  switch (id) {
    case "ieee": return (n) => `[${n}]`;
    case "vancouver": return (n) => `${n}.`;
    case "acs": return (n) => `(${n})`;
    case "nature": return (n) => `${n}.`;
    default: return undefined;
  }
}

/** Heading above the list. */
export function bibHeading(id: StyleId): string {
  return id === "chicago-nb" ? "Bibliography" : "References";
}

const TYPE_NAME: Record<BibType, string> = {
  "article-journal": "journal article", book: "book", chapter: "book chapter", "paper-conference": "conference paper",
  thesis: "thesis", report: "report", webpage: "web page", dataset: "dataset", article: "preprint", patent: "patent",
};

/**
 * Records whose type the style does not claim, each refused by name. Never falls back to
 * another style.
 */
export function typeRefusals(id: StyleId, records: ReadonlyArray<BibRecord>): string[] {
  const info = STYLE_INFO[id];
  if (!info) return [`Unknown style “${String(id)}”.`];
  if (!info.shipped) return [`${info.name} is not offered: ${info.reason ?? "no official guide could be verified"}`];
  const out: string[] = [];
  for (const r of records) {
    if (info.types.includes(r.type)) continue;
    const why = info.refusedTypes?.[r.type];
    out.push(`“${r.id}” is a ${TYPE_NAME[r.type] ?? r.type}; ${info.name} does not format ${TYPE_NAME[r.type] ?? r.type}s here`
      + (why ? ` (${why})` : "") + ". Choose a style that does, or leave it out. It was not formatted in another style.");
  }
  return out;
}

/** Shown under every preview: sentence case can lowercase a proper noun it cannot recognise. */
export const CASE_NOTE =
  "Titles are shown as the style prints them. Sentence case lowercases capitalised words it cannot tell are names "
  + "(Raman, Gaussian, Escherichia), so check each title before inserting; in BibTeX, protect a name with braces: {Raman}.";

export interface RecordPreview {
  id: string;
  /** The title as imported, plain text. */
  original: string;
  formatted: Formatted | null;
  refusal?: string;
  warnings: string[];
  /** True when the style changed the title's capitalisation. */
  recased: boolean;
}

/** How each record will print in the style, with its title as imported beside it. */
export function previewRecords(id: StyleId, records: ReadonlyArray<BibRecord>): RecordPreview[] {
  return records.map((r) => {
    const original = richTextToPlain(r.title ?? "");
    const res = formatReference(id, r);
    if (!res.ok) return { id: r.id, original, formatted: null, refusal: res.reason, warnings: [], recased: false };
    const plain = res.value.plain;
    const recased = !!original && !plain.includes(original) && plain.toLowerCase().includes(original.toLowerCase());
    return { id: r.id, original, formatted: res.value, warnings: referenceWarnings(id, r), recased };
  });
}

/** One line per library record for the picker: "key — Family 2020 · Title". */
export function libraryRows(store: BibStoreData): Array<{ id: string; label: string }> {
  return Object.values(store.library).map((r) => {
    const a = r.author?.[0] ?? r.editor?.[0];
    const who = a ? (a.literal ?? [a["non-dropping-particle"], a.family].filter(Boolean).join(" ")) : "";
    const y = r.issued?.["date-parts"]?.[0]?.[0] ?? r.issued?.literal ?? "";
    const t = richTextToPlain(r.title ?? "");
    const label = [r.id, [who, String(y)].filter(Boolean).join(" "), t.length > 60 ? `${t.slice(0, 59)}…` : t]
      .filter(Boolean).join(" · ");
    return { id: r.id, label };
  });
}

// ======================================================================== insert

const LABELS: ReadonlyArray<NonNullable<CiteItem["label"]>> = ["page", "figure", "equation", "chapter"];

export type InsertPlan =
  | { ok: true; kind: "new"; store: BibStoreData; markerId: string; tag: string }
  | { ok: true; kind: "edit"; store: BibStoreData; markerId: string }
  | { ok: false; reasons: string[] };

/**
 * What "Insert citation" does. With the cursor inside an existing JurisLab citation
 * (`existingTag`), the selected references are ADDED to that citation; otherwise a new marker
 * is registered (its tag comes from citeTag, which refuses anything over Word's tag limit).
 */
export function planInsert(
  store: BibStoreData,
  ids: ReadonlyArray<string>,
  opts: { locator?: string; label?: string; existingTag?: string | null } = {},
): InsertPlan {
  if (!ids.length) return { ok: false, reasons: ["Select at least one reference in the library list."] };
  const recs = ids.map((id) => store.library[id]).filter((r): r is BibRecord => !!r);
  const missing = ids.filter((id) => !store.library[id]);
  if (missing.length) return { ok: false, reasons: missing.map((id) => `“${id}” is not in the reference library.`) };
  const refusals = typeRefusals(store.style, recs);
  if (refusals.length) return { ok: false, reasons: refusals };
  const locator = (opts.locator ?? "").trim();
  if (locator && ids.length > 1) {
    return { ok: false, reasons: ["A locator (page, figure, …) belongs to one reference: select one, or insert the citations one at a time."] };
  }
  const label = LABELS.find((l) => l === opts.label) ?? "page";
  const items: CiteItem[] = ids.map((id) => (locator ? { id, locator, label } : { id }));
  const existing = parseCiteTag(opts.existingTag ?? null);
  if (existing !== null && Object.prototype.hasOwnProperty.call(store.markers, existing)) {
    const merged = [...store.markers[existing]];
    for (const it of items) if (!merged.some((m) => m.id === it.id)) merged.push(it);
    const r = setMarkerItems(store, existing, merged);
    return r.ok ? { ok: true, kind: "edit", store: r.store, markerId: existing } : { ok: false, reasons: [r.reason] };
  }
  const r = addMarker(store, items);
  return r.ok ? { ok: true, kind: "new", store: r.store, markerId: r.markerId, tag: r.tag } : { ok: false, reasons: [r.reason] };
}

// ======================================================================== marker text → runs

export interface MarkerRun { text: string; sup: boolean; sub: boolean; italic: boolean; bold: boolean }

/** A marker's html (<sup>1,2</sup> (p. 5)) as plain-text runs with formatting flags. */
export function markerRuns(html: string): MarkerRun[] {
  const out: MarkerRun[] = [];
  const st = { sup: 0, sub: 0, i: 0, b: 0 };
  const re = /<(\/?)(sup|sub|i|em|b|strong|span)\b[^>]*>|([^<]+)|(<)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? "")) !== null) {
    if (m[2]) {
      const t = m[2].toLowerCase();
      const d = m[1] ? -1 : 1;
      if (t === "sup") st.sup = Math.max(0, st.sup + d);
      else if (t === "sub") st.sub = Math.max(0, st.sub + d);
      else if (t === "i" || t === "em") st.i = Math.max(0, st.i + d);
      else if (t === "b" || t === "strong") st.b = Math.max(0, st.b + d);
      continue;
    }
    const text = decodeEntities(m[3] ?? m[4] ?? "");
    if (!text) continue;
    const run: MarkerRun = { text, sup: st.sup > 0, sub: st.sub > 0, italic: st.i > 0, bold: st.b > 0 };
    const prev = out[out.length - 1];
    if (prev && prev.sup === run.sup && prev.sub === run.sub && prev.italic === run.italic && prev.bold === run.bold) prev.text += text;
    else out.push(run);
  }
  return out;
}

// ======================================================================== update plan

export interface CiteControl { tag?: string | null; text?: string | null }

export interface CollectedCitations {
  /** The cite controls, in planning order, each with where it lives. */
  occurrences: MarkerOccurrence[];
  where: Array<{ in: "body" | "note"; index: number }>;
  /** Ordering caveats, by name. */
  notes: string[];
}

/**
 * The cite controls to plan over. `body` and each footnote's controls come in document order
 * from Word; other controls are ignored. A notes style plans the footnotes first (they are its
 * citations); any other style plans the main text first. Word cannot interleave the two lists
 * by position, so mixing them is reported, never hidden.
 */
export function collectCitations(
  body: ReadonlyArray<CiteControl>,
  notes: ReadonlyArray<CiteControl> | null,
  kind: BibStyle["kind"],
): CollectedCitations {
  const pick = (list: ReadonlyArray<CiteControl>, w: "body" | "note") => {
    const idx: Array<{ in: "body" | "note"; index: number }> = [];
    const cc: CiteControl[] = [];
    list.forEach((c, i) => {
      if (parseCiteTag(c?.tag) !== null) {
        idx.push({ in: w, index: i });
        cc.push(c);
      }
    });
    return { occ: markersFromControls(cc), idx };
  };
  const b = pick(body, "body");
  const n = pick(notes ?? [], "note");
  const res: CollectedCitations = { occurrences: [], where: [], notes: [] };
  const first = kind === "note" ? [n, b] : [b, n];
  for (const part of first) {
    res.occurrences.push(...part.occ);
    res.where.push(...part.idx);
  }
  if (notes === null) {
    res.notes.push("Footnotes were not read (this version of Word cannot read them); citations inside footnotes are not counted.");
  }
  if (b.occ.length && n.occ.length) {
    res.notes.push(kind === "note"
      ? `${b.occ.length} citation${b.occ.length === 1 ? " is" : "s are"} in the main text, not in a footnote; they are planned after the footnotes.`
      : `${n.occ.length} citation${n.occ.length === 1 ? " is" : "s are"} inside footnotes; they are numbered after the main text.`);
  }
  return res;
}

export interface Rewrite {
  /** Index into CollectedCitations.occurrences / where. */
  index: number;
  markerId: string;
  plain: string;
  runs: MarkerRun[];
}

export type UpdatePlan =
  | {
      ok: true;
      plan: RenumberPlan;
      rewrites: Rewrite[];
      ooxml: string;
      /** Every problem list, under its own name. */
      report: string[];
    }
  | { ok: false; reason: string };

function noteTexts(occ: MarkerOccurrence[], store: BibStoreData, style: BibStyle, plan: RenumberPlan): void {
  if (!style.note) return;
  const seen = new Set<string>();
  const done = new Set<string>();
  for (const o of occ) {
    if (done.has(o.markerId)) continue;
    done.add(o.markerId);
    if (!Object.prototype.hasOwnProperty.call(plan.markerText, o.markerId)) continue;
    const items = store.markers[o.markerId] ?? [];
    try {
      const parts = items.map((it) => {
        const first = !seen.has(it.id);
        seen.add(it.id);
        return style.note!(store.library[it.id], it, first).html;
      });
      // Each note ends its own sentence: "…, 1851." or, without a page, "Kwon, “Inclusion Work.”".
      // Only the joins drop a final period; the last note keeps its ending, and a period is added
      // only if it has none (never ".”.").
      const joined = parts.map((h, i) => (i < parts.length - 1 ? h.replace(/\.$/, "") : h)).join("; ");
      const html = /[.?!]["”’]?$/.test(markerRuns(joined).map((r) => r.text).join("")) ? joined : `${joined}.`;
      plan.markerText[o.markerId] = { html, plain: markerRuns(html).map((r) => r.text).join("") };
    } catch (e) {
      delete plan.markerText[o.markerId];
      const reason = e instanceof Error ? e.message : String(e);
      plan.refused.push({ markerId: o.markerId, reason });
      plan.problems.push(`Citation marker ${o.markerId} could not be formatted: ${reason}`);
    }
  }
  plan.occurrences = plan.occurrences.map((p) => ({ markerId: p.markerId, text: plan.markerText[p.markerId] ?? null }));
}

/**
 * Plan "Update numbering and bibliography". `rewriteAll` rewrites every marker even when its
 * plain text is unchanged (after a style switch, ACS → Nature differ only in formatting).
 */
export function planUpdate(collected: CollectedCitations, store: BibStoreData, opts: { rewriteAll?: boolean } = {}): UpdatePlan {
  const style = getStyle(store.style);
  if (!style) {
    const info = STYLE_INFO[store.style];
    return { ok: false, reason: `${info?.name ?? store.style} is not offered: ${info?.reason ?? "unknown style"}. Pick another style.` };
  }
  const occ = collected.occurrences;
  const plan = renumberPlan(occ, store, style, { sortParticleFirst: STYLE_RULES[store.style].sortParticleFirst ?? undefined });
  if (style.kind === "note") noteTexts(occ, store, style, plan);
  // A numeric marker citing a deleted record gets a placeholder ("[?]") so its stale number
  // cannot collide with a renumbered reference (bibliography.ts `missing[].placeholder`).
  const placeholderOf = new Map<string, string>();
  for (const m of plan.missing) if (m.placeholder) placeholderOf.set(m.markerId, m.placeholder);
  const rewrites: Rewrite[] = [];
  plan.occurrences.forEach((p, i) => {
    const ph = placeholderOf.get(p.markerId);
    const text = p.text ?? (ph !== undefined ? { plain: ph, html: ph.replace(/&/g, "&amp;").replace(/</g, "&lt;") } : null);
    if (!text) return;
    if (!opts.rewriteAll && occ[i].text === text.plain) return;
    rewrites.push({ index: i, markerId: p.markerId, plain: text.plain, runs: markerRuns(text.html) });
  });
  const ooxml = bibliographyOoxml(plan.entries, { label: bibLabel(store.style), heading: bibHeading(store.style) });
  return { ok: true, plan, rewrites, ooxml, report: [...collected.notes, ...planReportLines(plan, store)] };
}

/** Every problem list of a plan, by name. Empty lists are not printed; nothing is dropped. */
export function planReportLines(plan: RenumberPlan, store?: BibStoreData): string[] {
  const out: string[] = [];
  const marker = (m: { markerId: string; markerText?: string }) => (m.markerText ? `“${m.markerText}” (marker ${m.markerId})` : `marker ${m.markerId}`);
  if (plan.missing.length) {
    const rewritten = plan.missing.filter((m) => m.placeholder);
    out.push(`Missing from the library (${plan.missing.length}): ${plan.missing.map((m) => `${marker(m)} cites “${m.id}”`
      + (m.placeholder ? `, now shown as “${m.placeholder}” so its old number cannot point at another reference` : "")).join("; ")}.`
      + (!rewritten.length ? " Left unchanged."
        : rewritten.length === plan.missing.length ? " Re-import the reference, or delete the citation."
          : " The others were left unchanged."));
  }
  if (plan.ambiguous && plan.ambiguous.length) {
    out.push(`Ambiguous citations (${plan.ambiguous.length}), different references that still read the same: `
      + `${plan.ambiguous.map((a) => `“${a.text}” = ${a.ids.join(", ")}`).join("; ")}. Add a page or a distinguishing detail.`);
  }
  if (plan.unknownMarkers.length) {
    out.push(`Unknown citations (${plan.unknownMarkers.length}), not in this document's reference store: ${plan.unknownMarkers.map(marker).join("; ")}. Left unchanged.`);
  }
  if (plan.duplicateMarkerIds.length) {
    out.push(`Copied citations (${plan.duplicateMarkerIds.length}), the same marker more than once: ${plan.duplicateMarkerIds.join(", ")}. Every copy shows the same references.`);
  }
  if (plan.uncited.length) {
    out.push(`Not cited (${plan.uncited.length}), in the library but not in the document, so not listed: ${plan.uncited.join(", ")}.`);
  }
  if (plan.staleStoreMarkers.length) {
    out.push(`Deleted citations (${plan.staleStoreMarkers.length}), no longer in the document (kept so Undo can restore them): ${plan.staleStoreMarkers.join(", ")}.`);
  }
  if (plan.refused.length) {
    out.push(`Refused by the style (${plan.refused.length}): ${plan.refused.map((r) => `${r.id ? `“${r.id}”` : `marker ${r.markerId}`}: ${r.reason}`).join("; ")}.`);
  }
  // Any sentence renumberPlan reports that the lists above do not cover (e.g. an empty marker).
  for (const p of plan.problems) {
    if (/cites no references/.test(p)) out.push(p);
  }
  if (store && Object.keys(store.library).length === 0) out.push("The reference library is empty: import BibTeX, RIS or CSL-JSON first.");
  return out;
}
