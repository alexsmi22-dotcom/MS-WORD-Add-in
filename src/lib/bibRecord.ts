// Frozen contract for the citations release (docs/SCOPE-CITATIONS-2026-10.md §D).
// Field names follow CSL-JSON so a CSL processor could be added later without changing the data.
// Nobody edits this file during the release; a change needs every builder to agree.

export interface BibName { family?: string; given?: string; "non-dropping-particle"?: string;
  "dropping-particle"?: string; suffix?: string; literal?: string; }
export interface BibDate { "date-parts"?: Array<[number, number?, number?]>; literal?: string; }
export type BibType = "article-journal" | "book" | "chapter" | "paper-conference" | "thesis" | "report"
  | "webpage" | "dataset" | "article" | "patent";
export interface BibRecord { id: string; type: BibType; title?: string; "container-title"?: string;
  "container-title-short"?: string; author?: BibName[]; editor?: BibName[]; issued?: BibDate;
  volume?: string; issue?: string; page?: string; "article-number"?: string; DOI?: string; URL?: string;
  publisher?: string; "publisher-place"?: string; edition?: string; number?: string; authority?: string;
  genre?: string; accessed?: BibDate; "et-al-in-source"?: boolean; }
// Rich text in title/container-title: only <i> <b> <sub> <sup> <span class="nocase">. Unicode (H₂O) verbatim.
export interface CiteItem { id: string; locator?: string; label?: "page" | "figure" | "equation" | "chapter";
  prefix?: string; suffix?: string; suppressAuthor?: boolean; }
export interface Formatted { plain: string; html: string; }
export type StyleId = "acs" | "ieee" | "vancouver" | "nature" | "optica" | "apa7" | "chicago-ad" | "chicago-nb" | "harvard-ctr" | "mla9";
export interface BibStyle { id: StyleId; name: string; kind: "numeric" | "author-date" | "note";
  order: "citation" | "alphabetical";
  reference(r: BibRecord, n?: number): Formatted;
  marker(items: Array<{ rec: BibRecord; n?: number; item: CiteItem }>, opts?: { narrative?: boolean }): Formatted;
  note?(rec: BibRecord, item: CiteItem, first: boolean): Formatted; }
export interface ImportResult { records: BibRecord[]; refused: Array<{ line: number; reason: string }>; }
