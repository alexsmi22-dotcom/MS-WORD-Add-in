// Bibliography assembly (docs/SCOPE-CITATIONS-2026-10.md §C3, §D Builder 4).
//
// PURE: no Office.js. Coded against the frozen `BibStyle` interface only, so any style
// (bibStyles.ts or a test stub) plugs in. The style formats; this module decides WHICH
// references are listed, in WHAT order, with WHAT number, and with which year suffix.
//
//   numbering     numeric styles (order "citation") number by first citation in document order;
//                 a style with order "alphabetical" is listed (and, if numeric, numbered) by
//                 family name → given → year → title.
//   2020a/2020b   author-date styles only: references whose in-text marker would read the same
//                 get a, b, c… in bibliography order. The frozen record has no year-suffix field
//                 and the styles read the year from `issued`, so the suffix is applied to a CLONE
//                 whose `issued` is `{ literal: "2020a" }`. The clone feeds both the marker and the
//                 reference, so text and list agree. LIMIT: on that clone a month/day in the date
//                 is not shown. Store records are never mutated.
//   compression   the style's `marker()` compresses its own numbers (IEEE's 2025 guide forbids
//                 ranges); `compressNumbers` here is the shared rule (3+ consecutive → en-dash
//                 range) for callers and stub styles.
//   renumbering   `renumberPlan` is a pure function of (markers in document order, store, style),
//                 so running it twice gives the same texts: it is idempotent by construction.
//
// Nothing is dropped silently: a marker whose record is missing, a marker the store does not
// know, a reference the style refuses, a library entry never cited, and a store marker no longer
// in the document are each reported by name.

import type { BibName, BibRecord, BibStyle, CiteItem, Formatted } from "./bibRecord";
import type { BibStoreData, MarkerOccurrence } from "./bibStore";

export type { MarkerOccurrence } from "./bibStore";

export const EN_DASH = "–";

// ======================================================================== range compression

/** Sorted, de-duplicated runs of consecutive integers: [1,2,3,5] → [[1,3],[5,5]]. */
export function numberRuns(nums: number[]): Array<[number, number]> {
  const s = Array.from(new Set(nums.filter((n) => Number.isInteger(n)))).sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const n of s) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs;
}

export interface CompressOptions {
  /** Between items. Default ", ". */
  sep?: string;
  /** How one number is written: n => `[${n}]` for IEEE-like, default String(n). */
  wrap?: (n: number) => string;
  /** Shortest run written as a range. Default 3 (§C3: "only for 3 or more consecutive numbers"). */
  minRun?: number;
  /**
   * False: never write ranges. Pass the STYLE's rule (bibStyles STYLE_RULES[id].compressRanges);
   * IEEE (Reference Guide V 3.28.2025) is false: "[1], [2], [3], [4]". There is no global rule.
   */
  compress?: boolean;
}

/**
 * "1–3, 5"; with wrap n => `[${n}]`: "[1]–[3]", and [1, 3] stays "[1], [3]".
 * Runs of `minRun`+ consecutive numbers become an EN DASH range; shorter runs are listed.
 */
export function compressNumbers(nums: number[], opts: CompressOptions = {}): string {
  const sep = opts.sep ?? ", ";
  const wrap = opts.wrap ?? ((n: number) => String(n));
  const minRun = opts.compress === false ? Infinity : opts.minRun ?? 3;
  const parts: string[] = [];
  for (const [a, b] of numberRuns(nums)) {
    if (b - a + 1 >= minRun) parts.push(`${wrap(a)}${EN_DASH}${wrap(b)}`);
    else for (let k = a; k <= b; k++) parts.push(wrap(k));
  }
  return parts.join(sep);
}

// ======================================================================== alphabetical order

export interface SortOptions {
  /**
   * File "van Beethoven" under V (true) or B (false). Pass the style's manual rule
   * (bibStyles STYLE_RULES[id].sortParticleFirst; APA 7: true). Default true.
   * Only the non-dropping particle moves; a dropping particle never leads the key.
   */
  sortParticleFirst?: boolean;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

const nfc = (s: string | undefined): string => (s ?? "").normalize("NFC").trim();

/** Visible text of a rich title: tags stripped, the few entities decoded. */
export function plainText(html: string | undefined): string {
  return nfc((html ?? "").replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
}

interface SortKey { names: Array<[string, string]>; year: number | null; title: string; id: string }

function creatorsOf(r: BibRecord): BibName[] {
  if (r.author && r.author.length) return r.author;
  if (r.editor && r.editor.length) return r.editor;
  return [];
}

/** A title without a leading article, for filing ("The Raven" under R). */
function fileTitle(t: string): string {
  return t.replace(/^(?:the|an|a)\s+/i, "").replace(/^["“‘'(\[]+/, "");
}

export function yearOf(r: BibRecord): number | null {
  const y = r.issued?.["date-parts"]?.[0]?.[0];
  if (typeof y === "number" && Number.isFinite(y)) return y;
  const m = /\b(\d{4})\b/.exec(r.issued?.literal ?? "");
  return m ? Number(m[1]) : null;
}

function nameSortPair(n: BibName, particleFirst: boolean): [string, string] {
  if (n.literal && n.literal.trim()) return [nfc(n.literal), ""];
  const ndp = nfc(n["non-dropping-particle"]);
  const dp = nfc(n["dropping-particle"]);
  const fam = nfc(n.family);
  const given = nfc(n.given);
  if (!fam) return [given, ""];
  const family = particleFirst && ndp ? `${ndp} ${fam}` : fam;
  const rest = [given, dp, particleFirst ? "" : ndp].filter(Boolean).join(" ");
  return [family, rest];
}

function sortKeyOf(r: BibRecord, particleFirst: boolean): SortKey {
  const title = fileTitle(plainText(r.title));
  const cs = creatorsOf(r);
  // No author or editor: the title moves into the author position (APA 9.12, CMOS).
  const names = cs.length ? cs.map((n) => nameSortPair(n, particleFirst)) : [[title, ""] as [string, string]];
  return { names, year: yearOf(r), title, id: r.id };
}

function compareKeys(a: SortKey, b: SortKey): number {
  const n = Math.min(a.names.length, b.names.length);
  for (let i = 0; i < n; i++) {
    const c = collator.compare(a.names[i][0], b.names[i][0]) || collator.compare(a.names[i][1], b.names[i][1]);
    if (c) return c;
  }
  // One author before the same author with co-authors (APA 9.46; CMOS 13.69).
  if (a.names.length !== b.names.length) return a.names.length - b.names.length;
  // Same authors: undated first, then by year (APA 9.47), then title.
  if (a.year !== b.year) {
    if (a.year === null) return -1;
    if (b.year === null) return 1;
    return a.year - b.year;
  }
  return collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Records in bibliography order for an alphabetical style. Never mutates its input. */
export function alphabeticalOrder(records: BibRecord[], opts: SortOptions = {}): BibRecord[] {
  const pf = opts.sortParticleFirst ?? true;
  return records.map((r) => ({ r, k: sortKeyOf(r, pf) })).sort((x, y) => compareKeys(x.k, y.k)).map((x) => x.r);
}

// ======================================================================== year suffixes

/** 0 → a, 25 → z, 26 → aa, 27 → ab (the CSL year-suffix sequence). */
export function suffixLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** The record as shown with a year suffix ("2020a"). See the header for the date-detail limit. */
export function withYearSuffix(r: BibRecord, suffix: string): BibRecord {
  const y = yearOf(r);
  if (y !== null) return { ...r, issued: { literal: `${y}${suffix}` } };
  // Undated or "in press": APA 9.47 writes "n.d.-a", "in press-a".
  return { ...r, issued: { literal: `${yearLabel(r)}-${suffix}` } };
}

/** The year as the in-text citation groups it: "2020", "n.d.", or a dateless literal ("in press"). */
export function yearLabel(r: BibRecord): string {
  const y = yearOf(r);
  if (y !== null) return String(y);
  const lit = nfc(r.issued?.literal);
  return lit || "n.d.";
}

/** Identity of the author list: the same people in the same order (case- and accent-insensitive). */
export function authorListKey(r: BibRecord): string {
  const cs = creatorsOf(r);
  const norm = (s: string | undefined): string => nfc(s).toLowerCase();
  if (!cs.length) return JSON.stringify(["title", norm(plainText(r.title))]);
  return JSON.stringify([...cs.map((n) => [norm(n.literal), norm(n["non-dropping-particle"]), norm(n["dropping-particle"]),
    norm(n.family), norm(n.given), norm(n.suffix)]), r["et-al-in-source"] ? "et-al" : ""]);
}

/** A number no real bibliography reaches; replaced by "?" in a missing-record marker. */
const PLACEHOLDER_N = 987654321;

/** Name as written in an in-text citation: the literal, or particle + family. */
function citeFamily(n: BibName): string {
  if (n.literal && n.literal.trim()) return nfc(n.literal);
  return [nfc(n["non-dropping-particle"]), nfc(n.family)].filter(Boolean).join(" ") || nfc(n.given);
}

/** "John Paul" → "J. P."; "Jean-Paul" → "J.-P.". */
function initialsOf(given: string): string {
  return nfc(given).split(/\s+/).filter(Boolean)
    .map((w) => w.split("-").filter(Boolean).map((p) => `${Array.from(p.replace(/\./g, ""))[0] ?? ""}.`).join("-"))
    .join(" ");
}

/**
 * Step 3b/3c of renumberPlan: make different references' in-text citations differ (APA 8.20
 * initials, APA 8.18 more names before "et al."), or report them. Only the marker record changes.
 */
function disambiguateCitations(
  ordered: BibRecord[], shown: Map<string, BibRecord>, citeRec: Map<string, BibRecord>, style: BibStyle, plan: RenumberPlan,
): void {
  const recOf = (id: string): BibRecord => citeRec.get(id) ?? shown.get(id)!;
  const probe = (id: string): string | null => {
    try {
      return style.marker([{ rec: recOf(id), item: { id } }]).plain.normalize("NFC");
    } catch {
      return null; // refused; reported when the reference is formatted
    }
  };
  const collisions = (ids: string[]): string[][] => {
    const m = new Map<string, string[]>();
    for (const id of ids) {
      const k = probe(id);
      if (k === null) continue;
      const g = m.get(k);
      if (g) g.push(id);
      else m.set(k, [id]);
    }
    return [...m.values()].filter((g) => g.length > 1);
  };
  const names = (id: string): BibName[] => creatorsOf(shown.get(id)!);

  for (const group of collisions(ordered.map((r) => r.id))) {
    // b1. Initials for first authors who share a surname but are different people (APA 8.20).
    const firstNames = new Map<string, string>(); // id → cite name with initials when needed
    for (const id of group) {
      const a = names(id)[0];
      if (!a || (a.literal && a.literal.trim())) continue;
      const clash = group.some((o) => {
        if (o === id) return false;
        const b = names(o)[0];
        return !!b && citeFamily(b).toLowerCase() === citeFamily(a).toLowerCase()
          && nfc(b.given).toLowerCase() !== nfc(a.given).toLowerCase();
      });
      if (clash && a.given) firstNames.set(id, `${initialsOf(a.given)} ${citeFamily(a)}`);
    }
    for (const [id, nm] of firstNames) {
      const r = shown.get(id)!;
      // The first author becomes a literal "J. Smith"; the style still joins co-authors its own way.
      citeRec.set(id, { ...r, author: [{ literal: nm }, ...names(id).slice(1)], editor: undefined });
    }

    // b2. Still identical: as many names as it takes, then "et al." (APA 8.18).
    for (const sub of collisions(group)) {
      const lists = new Map(sub.map((id) => [id, names(id).map((n, i) => (i === 0 && firstNames.has(id) ? firstNames.get(id)! : citeFamily(n)))]));
      for (const id of sub) {
        const mine = lists.get(id)!;
        let k = 1;
        while (k <= mine.length && sub.some((o) => o !== id && sameStart(lists.get(o)!, mine, k))) k++;
        const r = shown.get(id)!;
        const etAl = !!r["et-al-in-source"];
        // Writing every name out needs the style's own "&"/"and", which the interface cannot ask
        // for, so a list that differs only in its last name is reported (step c) instead.
        if (k < mine.length || (k === mine.length && etAl)) citeRec.set(id, { ...r, ...withCiteNames(mine, k) });
      }
    }

    // c. Report what could not be told apart.
    for (const sub of collisions(group)) {
      const text = probe(sub[0]) ?? "";
      plan.ambiguous.push({ ids: sub, text });
      plan.problems.push(`References ${sub.map((id) => `“${id}”`).join(" and ")} would all be cited as “${text}”, `
        + "and this style cannot tell them apart; check their author lists and years.");
    }
  }
}

function sameStart(a: string[], b: string[], k: number): boolean {
  if (a.length < k || b.length < k) return false;
  for (let i = 0; i < k; i++) if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
  return true;
}

/** A marker-only record whose single literal author reads "A, B, et al." (or the first k names). */
function withCiteNames(list: string[], k: number): Partial<BibRecord> {
  return { author: [{ literal: `${list.slice(0, k).join(", ")}, et al.` }], editor: undefined, "et-al-in-source": false };
}

// ======================================================================== the plan

export interface RenumberOptions extends SortOptions {}

export interface PlanEntry {
  id: string;
  /** Bibliography number (numeric styles only). */
  n?: number;
  /** "a", "b", … when disambiguated (author-date styles only). */
  yearSuffix?: string;
  /** null when the style refused this record (see `refused`). */
  formatted: Formatted | null;
}

export interface RenumberPlan {
  /** markerId → the marker's new text. A marker absent from this map must be LEFT AS IS (see the reports). */
  markerText: Record<string, Formatted>;
  /** The input occurrences, aligned by index, each with its new text or null (= leave unchanged). */
  occurrences: Array<{ markerId: string; text: Formatted | null }>;
  /** Marker ids whose new plain text differs from the `text` supplied with the occurrence. */
  changed: string[];
  /** The formatted bibliography, in order. Refused records are left out (and listed in `refused`). */
  bibliography: Formatted[];
  /** Every cited record in bibliography order, refused ones included. */
  entries: PlanEntry[];
  /** record id → number (numeric styles). */
  numbers: Record<string, number>;
  /**
   * A marker cites an id that is not in the library. Numeric styles: the marker is REWRITTEN with
   * "?" where the missing reference's number would be (e.g. "[?]", "[2], [?]", superscript "?"), so a
   * stale number can never collide with a renumbered reference; `placeholder` is that plain text.
   * Other styles: the marker is left unchanged (no number to collide) and `placeholder` is absent.
   */
  missing: Array<{ markerId: string; markerText?: string; id: string; placeholder?: string }>;
  /**
   * Author-date: different references whose in-text citation would still read the same after
   * year letters, initials (APA 8.20) and extra author names (APA 8.18). Reported, never lettered.
   */
  ambiguous: Array<{ ids: string[]; text: string }>;
  /** A cite control whose marker id the store does not know. Left unchanged. */
  unknownMarkers: Array<{ markerId: string; markerText?: string }>;
  /** Marker ids that occur more than once in the document (copy-paste clones a control's tag). */
  duplicateMarkerIds: string[];
  /** Library entries cited by no marker in the document: reported, not printed. */
  uncited: string[];
  /** Store markers whose control is no longer in the document. Kept in the store (undo can restore them). */
  staleStoreMarkers: string[];
  /** The style refused to format a record or a marker. */
  refused: Array<{ id?: string; markerId?: string; reason: string }>;
  /** Every report above, as sentences naming the item. Empty = clean. */
  problems: string[];
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function quoteMarker(markerId: string, text?: string): string {
  return text && text.trim() ? `Citation “${text.trim()}” (marker ${markerId})` : `Citation marker ${markerId}`;
}

/**
 * Plan an "Update citations & bibliography" pass.
 *
 * @param markersInDocOrder  the cite controls in document order: marker ids, or
 *                           `{ markerId, text }` (text = the control's current text, used for
 *                           `changed` and for naming the marker in reports)
 * @param store              the document's reference store
 * @param style              the BibStyle to format with (the store holds only its id)
 */
export function renumberPlan(
  markersInDocOrder: ReadonlyArray<string | MarkerOccurrence>,
  store: BibStoreData,
  style: BibStyle,
  opts: RenumberOptions = {},
): RenumberPlan {
  const occ: MarkerOccurrence[] = markersInDocOrder.map((m) => (typeof m === "string" ? { markerId: m } : m));
  const lib = store.library;
  const has = (id: string): boolean => Object.prototype.hasOwnProperty.call(lib, id);
  const hasMarker = (id: string): boolean => Object.prototype.hasOwnProperty.call(store.markers, id);

  const plan: RenumberPlan = {
    markerText: {}, occurrences: [], changed: [], bibliography: [], entries: [], numbers: {},
    missing: [], ambiguous: [], unknownMarkers: [], duplicateMarkerIds: [], uncited: [], staleStoreMarkers: [], refused: [], problems: [],
  };

  // 1. Walk the document: cited ids in first-citation order, and every reportable marker.
  const seenMarker = new Map<string, number>();
  const citedOrder: string[] = [];
  const cited = new Set<string>();
  const brokenMarkers = new Set<string>();
  const missingMarkers = new Set<string>();
  const firstText = new Map<string, string | undefined>();
  for (const o of occ) {
    if (!firstText.has(o.markerId)) firstText.set(o.markerId, o.text);
    const count = seenMarker.get(o.markerId) ?? 0;
    seenMarker.set(o.markerId, count + 1);
    if (count === 1) plan.duplicateMarkerIds.push(o.markerId);
    if (count > 0) continue;
    if (!hasMarker(o.markerId)) {
      plan.unknownMarkers.push(o.text !== undefined ? { markerId: o.markerId, markerText: o.text } : { markerId: o.markerId });
      plan.problems.push(`${quoteMarker(o.markerId, o.text)} is not in this document's reference store; it was left unchanged.`);
      continue;
    }
    const items = store.markers[o.markerId];
    if (!items.length) {
      brokenMarkers.add(o.markerId);
      plan.problems.push(`${quoteMarker(o.markerId, o.text)} cites no references; it was left unchanged.`);
      continue;
    }
    for (const it of items) {
      if (!has(it.id)) {
        brokenMarkers.add(o.markerId);
        missingMarkers.add(o.markerId);
        plan.missing.push(o.text !== undefined ? { markerId: o.markerId, markerText: o.text, id: it.id } : { markerId: o.markerId, id: it.id });
        continue;
      }
      if (!cited.has(it.id)) {
        cited.add(it.id);
        citedOrder.push(it.id);
      }
    }
  }
  for (const id of Object.keys(lib)) if (!cited.has(id)) plan.uncited.push(id);
  for (const id of Object.keys(store.markers)) if (!seenMarker.has(id)) plan.staleStoreMarkers.push(id);
  for (const id of plan.duplicateMarkerIds) {
    plan.problems.push(`Citation marker ${id} appears ${seenMarker.get(id)} times (a copied citation); every copy shows the same references.`);
  }
  if (plan.uncited.length) {
    plan.problems.push(`Not cited in the document, so not listed: ${plan.uncited.map((id) => `“${id}”`).join(", ")}.`);
  }

  // 2. Bibliography order.
  const records = citedOrder.map((id) => lib[id]);
  const ordered = style.order === "alphabetical" ? alphabeticalOrder(records, opts) : records;

  // 3. Author-date disambiguation.
  //   a. Year letters (APA 9.47): ONLY the same author list (same people, same order) in the same
  //      year, undated ("n.d.-a") and "in press-a" included.
  //   b. Different authors whose citations still read the same: the first author's initials when
  //      first authors share a surname (APA 8.20), then as many author names as it takes before
  //      "et al." (APA 8.18). These change only the in-text citation (`citeRec`), not the list.
  //   c. Anything still identical is reported by name (`ambiguous`), never lettered.
  const shown = new Map<string, BibRecord>();
  for (const r of ordered) shown.set(r.id, r);
  const citeRec = new Map<string, BibRecord>();
  const suffixOf = new Map<string, string>();
  if (style.kind === "author-date") {
    const groups = new Map<string, BibRecord[]>();
    for (const r of ordered) {
      const key = JSON.stringify([authorListKey(r), yearLabel(r)]);
      const g = groups.get(key);
      if (g) g.push(r);
      else groups.set(key, [r]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.forEach((r, i) => {
        const s = suffixLetter(i);
        suffixOf.set(r.id, s);
        shown.set(r.id, withYearSuffix(r, s));
      });
    }
    disambiguateCitations(ordered, shown, citeRec, style, plan);
  }
  const markerRec = (id: string): BibRecord => citeRec.get(id) ?? shown.get(id)!;

  // 4. Numbers and the formatted list.
  const numeric = style.kind === "numeric";
  ordered.forEach((r, i) => {
    const n = numeric ? i + 1 : undefined;
    if (n !== undefined) plan.numbers[r.id] = n;
    let formatted: Formatted | null = null;
    try {
      formatted = style.reference(shown.get(r.id)!, n);
    } catch (e) {
      plan.refused.push({ id: r.id, reason: errText(e) });
      plan.problems.push(`Reference “${r.id}” could not be formatted: ${errText(e)}`);
    }
    const entry: PlanEntry = { id: r.id, formatted };
    if (n !== undefined) entry.n = n;
    const s = suffixOf.get(r.id);
    if (s) entry.yearSuffix = s;
    plan.entries.push(entry);
    if (formatted) plan.bibliography.push(formatted);
  });

  // 5. Marker texts (once per marker id; copies share the text).
  for (const id of seenMarker.keys()) {
    if (!hasMarker(id)) continue;
    if (missingMarkers.has(id)) {
      missingMarkerText(id);
      continue;
    }
    if (brokenMarkers.has(id)) continue;
    const items: Array<{ rec: BibRecord; n?: number; item: CiteItem }> = store.markers[id].map((item) => {
      const n = plan.numbers[item.id];
      return n !== undefined ? { rec: markerRec(item.id), n, item } : { rec: markerRec(item.id), item };
    });
    try {
      plan.markerText[id] = style.marker(items);
    } catch (e) {
      plan.refused.push({ markerId: id, reason: errText(e) });
      plan.problems.push(`Citation marker ${id} could not be formatted: ${errText(e)}`);
    }
  }

  /**
   * A marker citing a reference that is gone. Numeric styles: rewrite it with "?" in place of the
   * missing number (the style's own brackets/superscript), so its stale number cannot collide
   * with a renumbered reference. Other styles: leave it (no number to collide).
   */
  function missingMarkerText(id: string): void {
    const text = firstText.get(id);
    const gone = plan.missing.filter((m) => m.markerId === id);
    let placeholder: Formatted | null = null;
    if (numeric) {
      const items = store.markers[id].map((item) => {
        const n = has(item.id) ? plan.numbers[item.id] : PLACEHOLDER_N;
        const rec: BibRecord = has(item.id) ? markerRec(item.id) : { id: item.id, type: "article-journal", title: item.id };
        return { rec, n, item };
      });
      try {
        const f = style.marker(items);
        const sentinel = String(PLACEHOLDER_N);
        placeholder = { html: f.html.split(sentinel).join("?"), plain: f.plain.split(sentinel).join("?") };
        if (!placeholder.plain.includes("?")) placeholder = null;
      } catch {
        placeholder = null;
      }
      if (!placeholder) placeholder = { html: "[?]", plain: "[?]" };
      plan.markerText[id] = placeholder;
    }
    for (const m of gone) {
      if (placeholder) m.placeholder = placeholder.plain;
      plan.problems.push(placeholder
        ? `${quoteMarker(id, text)} cites “${m.id}”, which is not in the reference library; it now reads “${placeholder.plain}” until the reference is imported again or the citation is removed.`
        : `${quoteMarker(id, text)} cites “${m.id}”, which is not in the reference library; the citation was left unchanged.`);
    }
  }

  // 6. Per-occurrence view and the change list.
  const changed = new Set<string>();
  for (const o of occ) {
    const t = Object.prototype.hasOwnProperty.call(plan.markerText, o.markerId) ? plan.markerText[o.markerId] : null;
    plan.occurrences.push({ markerId: o.markerId, text: t });
    if (t && o.text !== undefined && o.text !== t.plain && !changed.has(o.markerId)) {
      changed.add(o.markerId);
      plan.changed.push(o.markerId);
    }
  }
  return plan;
}
