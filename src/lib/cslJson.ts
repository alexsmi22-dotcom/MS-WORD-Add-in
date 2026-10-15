// CSL-JSON import, and the record conventions shared by every importer
// (docs/SCOPE-CITATIONS-2026-10.md §C2, §D).
//
// CSL-JSON IS the internal record format (bibRecord.ts), so import validates and
// passes it through: only the fields of the frozen BibRecord are kept, every value
// is type-checked, and anything that cannot be represented is refused by line with
// the reason. Zotero and Mendeley export this format, and so does doi.org content
// negotiation that a user can run themselves.
//
// Conventions every importer applies (so the styles and the bibliography builder can
// rely on them):
//   - Strings are NFC-normalised (é typed as e + U+0301 equals the precomposed é).
//   - title / container-title are CSL rich text: the allow-listed tags <i> <b> <sub>
//     <sup> <span class="nocase"> are markup; every other character, including "&"
//     and "p < 0.05", is literal text (citeproc-js convention). Zotero's small-caps
//     span is unwrapped to its text.
//   - page ranges use an en dash: "1818-1859", "867 -- 889", "270—273" → "1818–1859".
//     A single alphanumeric page (e0318239) is never touched.
//   - DOI is bare ("10.…"); a DOI that does not normalise refuses the record by name.
//   - Types outside BibType are refused by name, never coerced silently.

import type { BibDate, BibName, BibRecord, BibType, ImportResult } from "./bibRecord";
import { normalizeDoi } from "./doi";

export const BIB_TYPES: ReadonlyArray<BibType> = [
  "article-journal", "book", "chapter", "paper-conference", "thesis", "report",
  "webpage", "dataset", "article", "patent",
];

/**
 * Drop a leading byte-order mark. Written with a char code, never a literal: invisible
 * characters in source are the shell-eaten-backslash failure class in another form.
 */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Largest input any importer accepts (characters). */
export const MAX_IMPORT_CHARS = 5_000_000;

const SMALL_CAPS_RE = /<span style="font-variant:\s*small-caps;?">((?:(?!<span)[\s\S])*?)<\/span>/g;

/** Normalise a rich-text title: NFC, small-caps spans unwrapped, whitespace collapsed. */
export function normalizeRichText(s: string): string {
  let out = s.normalize("NFC");
  for (let k = 0; k < 20; k++) {
    const next = out.replace(SMALL_CAPS_RE, (_m, inner: string) => inner);
    if (next === out) break;
    out = next;
  }
  return out.replace(/[ \t\r\n]+/g, () => " ").trim();
}

/** Text without the allow-listed markup (for comparisons and plain rendering). */
export function richTextToPlain(s: string): string {
  return s.replace(/<\/?(?:i|b|sub|sup|span(?: class="nocase")?)>/g, () => "");
}

const PAGE_TOKEN = "(?:[A-Za-z]{0,3}\\d+[A-Za-z]{0,3}|[ivxlcdmIVXLCDM]+)";
const PAGE_RANGE_RE = new RegExp(`^(${PAGE_TOKEN})\\s*(?:-{1,3}|[‐‑‒–—−])\\s*(${PAGE_TOKEN})$`);

/** Page ranges to an en dash; anything that is not a clean range is kept as written. */
export function normalizePage(raw: string): string {
  const s = raw.normalize("NFC").replace(/\s+/g, () => " ").trim();
  return s
    .split(/\s*,\s*/)
    .map((part) => {
      const m = PAGE_RANGE_RE.exec(part);
      return m ? `${m[1]}–${m[2]}` : part;
    })
    .join(", ");
}

/** Strict ISO-ish date: YYYY, YYYY-MM, YYYY-MM-DD (also with / separators). */
export function parseIsoDate(raw: string): BibDate | undefined {
  const s = raw.trim();
  const m = /^(-?\d{1,4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?(?:[T ].*)?$/.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  if (!Number.isInteger(y) || y === 0) return undefined;
  const parts: [number, number?, number?] = [y];
  if (m[2] !== undefined) {
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) {
      parts.push(mo);
      if (m[3] !== undefined) {
        const d = Number(m[3]);
        if (d >= 1 && d <= 31) parts.push(d);
      }
    }
  }
  return { "date-parts": [parts] };
}

/** NFC every string in a record (names and dates included). */
export function nfcRecord(r: BibRecord): BibRecord {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "string") out[k] = v.normalize("NFC");
    else if (Array.isArray(v) && (k === "author" || k === "editor")) {
      out[k] = (v as BibName[]).map((n) => {
        const nn: Record<string, string> = {};
        for (const [nk, nv] of Object.entries(n)) if (typeof nv === "string") nn[nk] = nv.normalize("NFC");
        return nn;
      });
    } else if (v && typeof v === "object" && "literal" in (v as BibDate) && typeof (v as BibDate).literal === "string") {
      out[k] = { ...(v as BibDate), literal: (v as BibDate).literal!.normalize("NFC") };
    } else out[k] = v;
  }
  return out as unknown as BibRecord;
}

/** offset → 1-based line number, by binary search over the newline positions. */
export function lineIndex(src: string): (offset: number) => number {
  const nl: number[] = [];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) nl.push(i);
  return (offset: number): number => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

/**
 * Offsets where each element of the item array begins (string-aware, no recursion).
 * The array is the whole document, or the "items" array of the Zotero web API wrapper.
 */
function elementOffsets(src: string, wrapped: boolean): number[] {
  const offs: number[] = [];
  let i = 0;
  if (wrapped) {
    const m = /"items"\s*:\s*\[/.exec(src);
    if (!m) return [];
    i = m.index + m[0].length - 1;
  }
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === "{") return [i];
  if (src[i] !== "[") return [];
  let depth = 0;
  let inStr = false;
  let expectValue = true;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      if (depth === 1 && expectValue) {
        offs.push(i);
        expectValue = false;
      }
      inStr = true;
      continue;
    }
    if (ch === "[" || ch === "{") {
      if (depth === 1 && expectValue) {
        offs.push(i);
        expectValue = false;
      }
      depth++;
      continue;
    }
    if (ch === "]" || ch === "}") {
      depth--;
      continue;
    }
    if (depth === 1 && ch === ",") {
      expectValue = true;
      continue;
    }
    if (depth === 1 && expectValue && !/\s/.test(ch)) {
      offs.push(i);
      expectValue = false;
    }
  }
  return offs;
}

/**
 * The line of the first array element that does not parse on its own. Newer V8 error
 * messages carry no position, so the element boundaries (string-aware) locate it.
 */
function locateJsonError(text: string): number {
  const lineAt = lineIndex(text);
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("[")) return 1;
  const offs = elementOffsets(text, false);
  const lastBracket = text.lastIndexOf("]");
  for (let k = 0; k < offs.length; k++) {
    const end = k + 1 < offs.length ? offs[k + 1] : lastBracket > offs[k] ? lastBracket : text.length;
    const piece = text.slice(offs[k], end).replace(/,\s*$/, () => "");
    try {
      JSON.parse(piece);
    } catch {
      return lineAt(offs[k]);
    }
  }
  return offs.length ? lineAt(offs[offs.length - 1]) : 1;
}

const STRING_FIELDS = [
  "title", "container-title", "container-title-short", "volume", "issue", "page",
  "article-number", "DOI", "URL", "publisher", "publisher-place", "edition", "number",
  "authority", "genre",
] as const;

const TYPE_ALIASES: Record<string, BibType> = { "post-weblog": "webpage", post: "webpage", preprint: "article" };
const NAME_KEYS = ["family", "given", "non-dropping-particle", "dropping-particle", "suffix", "literal"] as const;

class ItemError extends Error {}

function textValue(field: string, v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim() === "" ? undefined : v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new ItemError(`field “${field}” must be text, not ${Array.isArray(v) ? "a list" : typeof v}`);
}

function names(field: string, v: unknown): BibName[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new ItemError(`field “${field}” must be a list of names`);
  const out: BibName[] = [];
  v.forEach((n, k) => {
    if (!n || typeof n !== "object" || Array.isArray(n)) throw new ItemError(`${field} #${k + 1} is not a name object`);
    const name: BibName = {};
    for (const key of NAME_KEYS) {
      const val = (n as Record<string, unknown>)[key];
      if (val === undefined || val === null) continue;
      if (typeof val !== "string") throw new ItemError(`${field} #${k + 1}: “${key}” must be text`);
      if (val.trim() !== "") name[key] = val.trim();
    }
    if (!name.family && !name.given && !name.literal) {
      throw new ItemError(`${field} #${k + 1} has no family, given or literal name`);
    }
    out.push(name);
  });
  return out.length ? out : undefined;
}

function datePart(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  if (v === "" || v === undefined || v === null) return undefined;
  return NaN;
}

function date(field: string, v: unknown): BibDate | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new ItemError(`field “${field}” must be a date object`);
  const o = v as Record<string, unknown>;
  const dp = o["date-parts"];
  if (dp !== undefined) {
    if (!Array.isArray(dp) || dp.length === 0 || dp.length > 2) {
      throw new ItemError(`${field}: “date-parts” must hold one date or a two-date range`);
    }
    const ranges: Array<[number, number?, number?]> = [];
    for (const one of dp) {
      if (!Array.isArray(one) || one.length > 3) throw new ItemError(`${field}: each date in “date-parts” is [year, month, day]`);
      const nums = one.map(datePart);
      if (nums.length === 0 || nums[0] === undefined) continue;
      if (nums.some((x) => Number.isNaN(x))) throw new ItemError(`${field}: “date-parts” must be numbers`);
      const [y, m, d] = nums as Array<number | undefined>;
      if (y === 0) continue;
      const parts: [number, number?, number?] = [y!];
      if (m !== undefined && m >= 1 && m <= 12) {
        parts.push(m);
        if (d !== undefined) {
          if (d < 1 || d > 31) throw new ItemError(`${field}: day ${d} is not a day of the month`);
          parts.push(d);
        }
      } else if (m !== undefined && !((m >= 13 && m <= 16) || (m >= 21 && m <= 24))) {
        // 21–24 are CSL 1.0.2 seasons, 13–16 the citeproc-js form; both keep the year only.
        throw new ItemError(`${field}: month ${m} is not a month`);
      }
      ranges.push(parts);
    }
    if (ranges.length) return { "date-parts": ranges };
  }
  if (typeof o.raw === "string" && o.raw.trim()) {
    return parseIsoDate(o.raw) ?? { literal: o.raw.trim() };
  }
  if (typeof o.literal === "string" && o.literal.trim()) return { literal: o.literal.trim() };
  return undefined;
}

function itemToRecord(raw: unknown): BibRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ItemError("item is not a JSON object");
  const o = raw as Record<string, unknown>;
  const idRaw = o.id;
  if (!(typeof idRaw === "string" && idRaw.trim()) && !(typeof idRaw === "number" && Number.isFinite(idRaw))) {
    throw new ItemError("item has no “id”");
  }
  // A citation key (CSL 1.0.2 "citation-key", which Zotero writes) is the id the user
  // knows from BibTeX; the item id (Zotero's "6188419/CMK4ZNS6") is the fallback.
  const key = o["citation-key"];
  const id = typeof key === "string" && key.trim() ? key.trim() : String(idRaw).trim();
  const tRaw = o.type;
  if (typeof tRaw !== "string") throw new ItemError(`item “${id}” has no “type”`);
  const type: BibType | undefined = (BIB_TYPES as readonly string[]).includes(tRaw) ? (tRaw as BibType) : TYPE_ALIASES[tRaw];
  if (!type) throw new ItemError(`item “${id}”: CSL type “${tRaw}” is not supported (supported: ${BIB_TYPES.join(", ")})`);

  const rec: BibRecord = { id, type };
  const r = rec as unknown as Record<string, unknown>;
  for (const f of STRING_FIELDS) {
    const val = textValue(f, o[f]);
    if (val !== undefined) r[f] = val;
  }
  if (rec["container-title-short"] === undefined) {
    const abbr = textValue("journalAbbreviation", o.journalAbbreviation);
    if (abbr !== undefined) rec["container-title-short"] = abbr;
  }
  if (rec.title !== undefined) rec.title = normalizeRichText(rec.title);
  if (rec["container-title"] !== undefined) rec["container-title"] = normalizeRichText(rec["container-title"]);
  if (rec.page !== undefined) rec.page = normalizePage(rec.page);
  if (rec.DOI !== undefined) {
    const d = normalizeDoi(rec.DOI);
    if ("error" in d) throw new ItemError(`item “${id}”: ${d.error}`);
    rec.DOI = d.doi;
  }
  const au = names("author", o.author);
  if (au) rec.author = au;
  const ed = names("editor", o.editor);
  if (ed) rec.editor = ed;
  const iss = date("issued", o.issued);
  if (iss) rec.issued = iss;
  const acc = date("accessed", o.accessed);
  if (acc) rec.accessed = acc;
  const etal = o["et-al-in-source"];
  if (etal !== undefined) {
    if (typeof etal !== "boolean") throw new ItemError(`item “${id}”: “et-al-in-source” must be true or false`);
    if (etal) rec["et-al-in-source"] = true;
  }
  return nfcRecord(rec);
}

/** Import CSL-JSON: an array of items, or one item object. */
export function parseCslJson(src: string): ImportResult {
  const result: ImportResult = { records: [], refused: [] };
  const text = stripBom(src ?? "");
  if (text.length > MAX_IMPORT_CHARS) {
    result.refused.push({ line: 1, reason: `input is ${text.length.toLocaleString("en-US")} characters; the limit is ${MAX_IMPORT_CHARS.toLocaleString("en-US")}` });
    return result;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const msg = (e as Error).message;
    const pos = /position (\d+)/.exec(msg);
    const lc = /\(line (\d+)/.exec(msg);
    const line = pos ? lineIndex(text)(Number(pos[1])) : lc ? Number(lc[1]) : locateJsonError(text);
    // V8 quotes the whole input in its message; keep the reason readable.
    const short = msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
    result.refused.push({ line, reason: `not valid JSON: ${short}` });
    return result;
  }
  let items: unknown[];
  let wrapped = false;
  if (Array.isArray(data)) items = data;
  else if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    items = (data as { items: unknown[] }).items;
    wrapped = true;
  } else if (data && typeof data === "object") items = [data];
  else {
    result.refused.push({ line: 1, reason: "CSL-JSON must be an array of items or one item object" });
    return result;
  }
  const offs = elementOffsets(text, wrapped);
  const lineAt = lineIndex(text);
  const seen = new Map<string, number>();
  items.forEach((item, k) => {
    const line = offs[k] !== undefined ? lineAt(offs[k]) : 1;
    try {
      const rec = itemToRecord(item);
      const prior = seen.get(rec.id);
      if (prior !== undefined) {
        result.refused.push({ line, reason: `duplicate id “${rec.id}” (first used on line ${prior})` });
        return;
      }
      seen.set(rec.id, line);
      result.records.push(rec);
    } catch (e) {
      if (e instanceof ItemError) result.refused.push({ line, reason: e.message });
      else throw e;
    }
  });
  return result;
}
