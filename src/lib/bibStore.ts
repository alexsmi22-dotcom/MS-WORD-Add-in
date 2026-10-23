// The per-document reference store and the citation-marker tags (docs/SCOPE-CITATIONS-2026-10.md §C4).
//
// PURE: no Office.js. The pane reads `Office.context.document.settings.get(BIB_SETTING_KEY)`,
// hands the value to `parseStore`, and writes back what `serializeStore` returns.
//
// Storage design (additive; NO existing tag changes):
//   - each in-text marker is a content control tagged `formula-inserter:cite:<markerId>`,
//     titled "JurisLab citation"; the tag holds only a short base-36 id, never citekeys,
//     because Word caps a tag's length (reportedly 64 characters, UNVERIFIED: the integrator
//     must confirm it in Word before relying on any length);
//   - the bibliography block is tagged `formula-inserter:bibliography`;
//   - the records and each marker's CiteItem[] live in document settings under
//     `jurislab.bib.v1` = { version: 1, style, library, markers }.
//
// Old tags (`formula-inserter:citation`, `formula-inserter:toa`, `jurislab:toafield`, …) are
// never produced and never parsed as markers here.

import type { BibRecord, BibType, CiteItem, StyleId } from "./bibRecord";

export const BIB_SETTING_KEY = "jurislab.bib.v1";
export const CITE_TAG_PREFIX = "formula-inserter:cite:";
export const BIBLIOGRAPHY_TAG = "formula-inserter:bibliography";
export const CITE_CONTROL_TITLE = "JurisLab citation";
/** Word's content-control tag limit as REPORTED (§C4). Unverified; see the header. */
export const WORD_TAG_MAX = 64;
/**
 * Upper bound on the serialized store, in UTF-8 bytes. Office document settings are reportedly
 * limited to about 2 MB in total, shared with the other JurisLab settings. This number is an
 * assumption, not documented fact: the integrator must verify it in Word desktop and Word Online.
 */
export const BIB_STORE_MAX_BYTES = 1_900_000;

const MARKER_ID_MAX = WORD_TAG_MAX - CITE_TAG_PREFIX.length; // 42
const MARKER_ID_RE = /^[0-9a-z]+$/;

const BIB_TYPES: readonly BibType[] = ["article-journal", "book", "chapter", "paper-conference", "thesis",
  "report", "webpage", "dataset", "article", "patent"];
const STYLE_IDS: readonly StyleId[] = ["acs", "ieee", "vancouver", "nature", "optica", "apa7", "chicago-ad", "chicago-nb",
  "harvard-ctr", "mla9"];
const LABELS = ["page", "figure", "equation", "chapter"];

export interface BibStoreData {
  version: 1;
  style: StyleId;
  library: Record<string, BibRecord>;
  markers: Record<string, CiteItem[]>;
}

export type TagResult = { ok: true; tag: string } | { ok: false; reason: string };

// ======================================================================== tags

/** True when `id` is a legal marker id: base-36 lowercase, and the full tag fits Word's limit. */
export function isMarkerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= MARKER_ID_MAX && MARKER_ID_RE.test(id);
}

/** The content-control tag for a marker. Refuses by name anything that would exceed WORD_TAG_MAX. */
export function citeTag(markerId: string): TagResult {
  if (typeof markerId !== "string" || !MARKER_ID_RE.test(markerId)) {
    return { ok: false, reason: `Marker id "${String(markerId)}" is not a base-36 id (0–9, a–z).` };
  }
  const tag = CITE_TAG_PREFIX + markerId;
  if (tag.length > WORD_TAG_MAX) {
    return { ok: false, reason: `Marker id "${markerId}" makes the tag ${tag.length} characters long; Word allows ${WORD_TAG_MAX}.` };
  }
  return { ok: true, tag };
}

/** The marker id inside a `formula-inserter:cite:<id>` tag, or null for any other tag (old tags included). */
export function parseCiteTag(tag: string | null | undefined): string | null {
  if (typeof tag !== "string" || !tag.startsWith(CITE_TAG_PREFIX)) return null;
  const id = tag.slice(CITE_TAG_PREFIX.length);
  return isMarkerId(id) ? id : null;
}

export interface MarkerOccurrence { markerId: string; text?: string }

/**
 * The cite markers among a document's content controls, in the order given (Word returns
 * `body.contentControls` in document order). Every other control is ignored.
 */
export function markersFromControls(controls: ReadonlyArray<{ tag?: string | null; text?: string | null }>): MarkerOccurrence[] {
  const out: MarkerOccurrence[] = [];
  for (const c of controls) {
    const id = parseCiteTag(c?.tag);
    if (id === null) continue;
    out.push(typeof c.text === "string" ? { markerId: id, text: c.text } : { markerId: id });
  }
  return out;
}

/**
 * The next unused marker id: one more than the largest id the store has ever held. Markers
 * are never pruned from the store (an undo in Word can restore a deleted control), so an id
 * is never reused.
 */
export function nextMarkerId(store: BibStoreData): string {
  // Compared as base-36 STRINGS (length, then digit order: "0"–"9" < "a"–"z" in char codes),
  // never through Number, which loses precision past 2^53 and once handed out an existing id.
  let max = "0";
  for (const k of Object.keys(store.markers)) {
    if (!isMarkerId(k)) continue;
    const t = k.replace(/^0+(?=.)/, "");
    if (t.length > max.length || (t.length === max.length && t > max)) max = t;
  }
  let next = incrementBase36(max);
  while (Object.prototype.hasOwnProperty.call(store.markers, next)) next = incrementBase36(next);
  return next;
}

function incrementBase36(s: string): string {
  const DIG = "0123456789abcdefghijklmnopqrstuvwxyz";
  const d = s.split("");
  let i = d.length - 1;
  while (i >= 0) {
    const v = DIG.indexOf(d[i]);
    if (v < 35) { d[i] = DIG[v + 1]; return d.join(""); }
    d[i] = "0";
    i--;
  }
  return `1${d.join("")}`;
}

// ======================================================================== store construction

export function emptyStore(style: StyleId): BibStoreData {
  return { version: 1, style, library: {}, markers: {} };
}

export type AddMarkerResult =
  | { ok: true; store: BibStoreData; markerId: string; tag: string }
  | { ok: false; reason: string };

/** Register a new marker citing `items`. Every id must already be in the library. Never mutates. */
export function addMarker(store: BibStoreData, items: CiteItem[]): AddMarkerResult {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: "A citation needs at least one reference." };
  const absent = items.filter((i) => !i || typeof i.id !== "string" || !Object.prototype.hasOwnProperty.call(store.library, i.id));
  if (absent.length) {
    const names = absent.map((i) => `"${String(i?.id)}"`).join(", ");
    return { ok: false, reason: `Not in the reference library: ${names}. Import ${absent.length === 1 ? "it" : "them"} first.` };
  }
  const markerId = nextMarkerId(store);
  const t = citeTag(markerId);
  if (!t.ok) return t;
  return {
    ok: true,
    store: { ...store, markers: { ...store.markers, [markerId]: items.map((i) => ({ ...i })) } },
    markerId,
    tag: t.tag,
  };
}

/** Replace a marker's items (edit a citation). Unknown marker or unknown record → refused by name. */
export function setMarkerItems(store: BibStoreData, markerId: string, items: CiteItem[]): { ok: true; store: BibStoreData } | { ok: false; reason: string } {
  if (!Object.prototype.hasOwnProperty.call(store.markers, markerId)) return { ok: false, reason: `No citation marker "${markerId}" in this document's store.` };
  if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: "A citation needs at least one reference." };
  const absent = items.filter((i) => !Object.prototype.hasOwnProperty.call(store.library, i.id));
  if (absent.length) return { ok: false, reason: `Not in the reference library: ${absent.map((i) => `"${i.id}"`).join(", ")}.` };
  return { ok: true, store: { ...store, markers: { ...store.markers, [markerId]: items.map((i) => ({ ...i })) } } };
}

export interface MergeResult {
  store: BibStoreData;
  added: string[];
  /** Same id, same content: nothing to do. */
  identical: string[];
  /** Same id, different content: the INCOMING record was stored under a new id. Never overwritten. */
  renamed: Array<{ from: string; to: string }>;
  refused: Array<{ id: string; reason: string }>;
}

/** Stable JSON (sorted keys) for content comparison. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Add imported records to the library. Existing markers point at existing ids, so an existing
 * record is NEVER overwritten: a different record under a taken id (two imports, or a
 * duplicate inside one import) is stored as `<id>-2`, `<id>-3`, … and reported.
 */
export function mergeRecords(store: BibStoreData, records: BibRecord[]): MergeResult {
  const library: Record<string, BibRecord> = { ...store.library };
  const res: MergeResult = { store, added: [], identical: [], renamed: [], refused: [] };
  for (const r of records) {
    const bad = recordProblem(r);
    if (bad) {
      res.refused.push({ id: String((r as { id?: unknown })?.id ?? "?"), reason: bad });
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(library, r.id)) {
      library[r.id] = { ...r };
      res.added.push(r.id);
      continue;
    }
    if (stable(library[r.id]) === stable(r)) {
      res.identical.push(r.id);
      continue;
    }
    // A renamed duplicate that is identical to an earlier rename is not added twice.
    let k = 2;
    let to = `${r.id}-${k}`;
    let dup = false;
    while (Object.prototype.hasOwnProperty.call(library, to)) {
      if (stable({ ...library[to], id: r.id }) === stable(r)) { dup = true; break; }
      to = `${r.id}-${++k}`;
    }
    if (dup) { res.identical.push(to); continue; }
    library[to] = { ...r, id: to };
    res.renamed.push({ from: r.id, to });
  }
  res.store = { ...store, library };
  return res;
}

// ======================================================================== validation

const STRING_FIELDS = ["title", "container-title", "container-title-short", "volume", "issue", "page",
  "article-number", "DOI", "URL", "publisher", "publisher-place", "edition", "number", "authority", "genre"];

function nameProblem(n: unknown): string | null {
  if (!n || typeof n !== "object" || Array.isArray(n)) return "a name is not an object";
  for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
    if (v !== undefined && typeof v !== "string") return `name field "${k}" is not text`;
  }
  return null;
}

function dateProblem(d: unknown, field: string): string | null {
  if (d === undefined) return null;
  if (!d || typeof d !== "object") return `"${field}" is not a date`;
  const dd = d as Record<string, unknown>;
  if (dd.literal !== undefined && typeof dd.literal !== "string") return `"${field}.literal" is not text`;
  const dp = dd["date-parts"];
  if (dp !== undefined) {
    if (!Array.isArray(dp)) return `"${field}.date-parts" is not a list`;
    for (const p of dp) {
      if (!Array.isArray(p) || p.length === 0 || p.some((x) => x !== undefined && x !== null && typeof x !== "number")) {
        return `"${field}.date-parts" holds a non-numeric date`;
      }
    }
  }
  return null;
}

/** Why a value is not a usable BibRecord, or null. */
export function recordProblem(r: unknown): string | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "not a record object";
  const rec = r as Record<string, unknown>;
  if (typeof rec.id !== "string" || !rec.id.trim()) return "the record has no id";
  if (typeof rec.type !== "string" || !BIB_TYPES.includes(rec.type as BibType)) {
    return `record "${rec.id}" has an unsupported type "${String(rec.type)}"`;
  }
  for (const f of STRING_FIELDS) {
    if (rec[f] !== undefined && typeof rec[f] !== "string") return `record "${rec.id}": "${f}" is not text`;
  }
  for (const f of ["author", "editor"]) {
    if (rec[f] === undefined) continue;
    if (!Array.isArray(rec[f])) return `record "${rec.id}": "${f}" is not a list of names`;
    for (const n of rec[f] as unknown[]) {
      const p = nameProblem(n);
      if (p) return `record "${rec.id}": ${p}`;
    }
  }
  for (const f of ["issued", "accessed"]) {
    const p = dateProblem(rec[f], f);
    if (p) return `record "${rec.id}": ${p}`;
  }
  return null;
}

function citeItemProblem(i: unknown): string | null {
  if (!i || typeof i !== "object" || Array.isArray(i)) return "a cited item is not an object";
  const it = i as Record<string, unknown>;
  if (typeof it.id !== "string" || !it.id) return "a cited item has no id";
  for (const f of ["locator", "prefix", "suffix"]) {
    if (it[f] !== undefined && typeof it[f] !== "string") return `cited item "${it.id}": "${f}" is not text`;
  }
  if (it.label !== undefined && !LABELS.includes(it.label as string)) return `cited item "${it.id}": unknown label "${String(it.label)}"`;
  if (it.suppressAuthor !== undefined && typeof it.suppressAuthor !== "boolean") return `cited item "${it.id}": suppressAuthor is not true/false`;
  return null;
}

// ======================================================================== (de)serialisation

function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

export type SerializeResult = { ok: true; json: string; bytes: number } | { ok: false; reason: string };

/** The JSON string to store under BIB_SETTING_KEY. Refuses an invalid or oversized store by name. */
export function serializeStore(store: BibStoreData): SerializeResult {
  const problems = storeProblems(store);
  if (problems.length) return { ok: false, reason: `The reference store is not valid: ${problems.slice(0, 5).join("; ")}.` };
  const json = JSON.stringify({ version: 1, style: store.style, library: store.library, markers: store.markers });
  const bytes = utf8Bytes(json);
  if (bytes > BIB_STORE_MAX_BYTES) {
    return {
      ok: false,
      reason: `The reference library is ${bytes.toLocaleString("en-US")} bytes; a document can hold about `
        + `${BIB_STORE_MAX_BYTES.toLocaleString("en-US")}. Remove references you no longer cite.`,
    };
  }
  return { ok: true, json, bytes };
}

function storeProblems(s: unknown): string[] {
  const out: string[] = [];
  if (!s || typeof s !== "object" || Array.isArray(s)) return ["not an object"];
  const st = s as Record<string, unknown>;
  if (typeof st.style !== "string" || !STYLE_IDS.includes(st.style as StyleId)) out.push(`unknown style "${String(st.style)}"`);
  const lib = st.library;
  if (!lib || typeof lib !== "object" || Array.isArray(lib)) out.push("the library is not an object");
  else {
    for (const [k, r] of Object.entries(lib as Record<string, unknown>)) {
      const p = recordProblem(r);
      if (p) out.push(p);
      else if ((r as BibRecord).id !== k) out.push(`library key "${k}" holds record "${(r as BibRecord).id}"`);
    }
  }
  const mk = st.markers;
  if (!mk || typeof mk !== "object" || Array.isArray(mk)) out.push("the markers are not an object");
  else {
    for (const [k, items] of Object.entries(mk as Record<string, unknown>)) {
      if (!isMarkerId(k)) { out.push(`marker id "${k}" is not a base-36 id that fits a Word tag`); continue; }
      if (!Array.isArray(items)) { out.push(`marker "${k}" is not a list`); continue; }
      for (const it of items) {
        const p = citeItemProblem(it);
        if (p) { out.push(`marker "${k}": ${p}`); break; }
      }
    }
  }
  return out;
}

export type ParseResult = { ok: true; store: BibStoreData | null } | { ok: false; reason: string };

/**
 * Read what document settings returned. `null`/`undefined`/"" → no store yet (`store: null`).
 * A JSON string or an already-parsed object are both accepted. A newer version, bad JSON or a
 * malformed store is REFUSED by name; the caller must then not overwrite the setting.
 */
export function parseStore(raw: unknown): ParseResult {
  if (raw === null || raw === undefined || raw === "") return { ok: true, store: null };
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch (e) {
      return { ok: false, reason: `The document's reference library (${BIB_SETTING_KEY}) is not valid JSON: ${(e as Error).message}` };
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, reason: `The document's reference library (${BIB_SETTING_KEY}) is not an object.` };
  const ver = (v as Record<string, unknown>).version;
  if (ver !== 1) {
    if (typeof ver === "number" && ver > 1) {
      return { ok: false, reason: `This document's reference library is version ${ver}, made by a newer JurisLab. Update JurisLab before editing its citations.` };
    }
    return { ok: false, reason: `The document's reference library has an unknown version "${String(ver)}".` };
  }
  const problems = storeProblems(v);
  if (problems.length) return { ok: false, reason: `The document's reference library is damaged: ${problems.slice(0, 5).join("; ")}.` };
  const st = v as BibStoreData;
  return { ok: true, store: { version: 1, style: st.style, library: st.library, markers: st.markers } };
}
