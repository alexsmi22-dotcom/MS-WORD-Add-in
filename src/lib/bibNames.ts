// Personal and corporate names for the citation importers (docs/SCOPE-CITATIONS-2026-10.md §C2, §E).
//
// BibTeX: a name list is split on top-level " and " (never inside braces), then each
// name takes one of the three BibTeX forms:
//     First von Last        Ludwig van Beethoven
//     von Last, First       van Beethoven, Ludwig      de la Fontaine, Jean
//     von Last, Jr, First   King, Jr., Martin Luther
// The von part is the run of lowercase-initial words. A braced word has no case, so
// "{van} Beethoven, L." keeps "van" in the family name: that is what the braces are
// for. A name that is ONE brace group ({World Health Organization}, {Barnes and
// Noble}) is a literal and is never split or initialised. "and others" sets the
// et-al-in-source flag; the missing names are never invented.
//
// Convention for the other builders: BibTeX's von part (and a lowercase leading
// particle in a RIS family name) becomes "non-dropping-particle". The source formats
// cannot tell a dropping particle from a non-dropping one, and citeproc-js makes the
// same choice. Nothing is ever guessed from word order: "Zhang Wei" written without a
// comma is BibTeX's First Last and stays that way.
//
// Names are parsed on the raw (brace-bearing) text first, and each part is decoded
// to Unicode afterwards, because the brace structure decides literals and particles.

import type { BibName } from "./bibRecord";
import { NBSP, latexToPlain } from "./latexUnicode";

/** Thrown for a name BibTeX itself would reject; the importer turns it into a refusal. */
export class NameError extends Error {}

/** Split on " and " at brace depth 0 (case-insensitive, any whitespace around it). */
export function splitBibtexNames(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const s = raw;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch)) {
      const m = /^\s+and\s+/i.exec(s.slice(i, i + 64));
      if (m && i > start) {
        out.push(s.slice(start, i));
        start = i + m[0].length;
        i = start - 1;
      }
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter((x) => x !== "");
}

/** Split at depth-0 commas. */
function splitCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim());
}

/** Split at depth-0 whitespace (and ~, BibTeX's tie). */
function splitWords(s: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && (/\s/.test(ch) || ch === "~")) {
      if (cur !== "") words.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur !== "") words.push(cur);
  return words;
}

const CASED_SPECIALS = new Set(["oe", "OE", "ae", "AE", "aa", "AA", "o", "O", "l", "L", "ss", "i", "j"]);

function isLowerLetter(c: string): boolean {
  return c.toLowerCase() === c && c.toUpperCase() !== c;
}
function isLetter(c: string): boolean {
  return /\p{L}/u.test(c);
}

/**
 * BibTeX's von test: is the first cased letter at brace depth 0 lowercase?
 * A {\"u}-style special character counts by the letter it accents; any other brace
 * group is skipped (it has no case), so "{van}" is not a particle.
 */
export function isVonWord(word: string): boolean {
  let i = 0;
  while (i < word.length) {
    const ch = word[i];
    if (ch === "{") {
      if (word[i + 1] === "\\") {
        // Special character: case of the control word (\oe, \ss…) or of the accented letter.
        let j = i + 2;
        let name = "";
        while (j < word.length && /[A-Za-z]/.test(word[j])) name += word[j++];
        if (CASED_SPECIALS.has(name)) return isLowerLetter(name[0]);
        while (j < word.length && word[j] !== "}") {
          if (isLetter(word[j])) return isLowerLetter(word[j]);
          j++;
        }
        return false;
      }
      // Skip the whole group.
      let depth = 0;
      while (i < word.length) {
        if (word[i] === "{") depth++;
        else if (word[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === "\\") {
      // Unbraced control sequence (\'Emile): look at the letter it applies to.
      let j = i + 1;
      if (j < word.length && !/[A-Za-z]/.test(word[j])) j++;
      else while (j < word.length && /[A-Za-z]/.test(word[j])) j++;
      i = j;
      continue;
    }
    if (isLetter(ch)) return isLowerLetter(ch);
    i++;
  }
  return false;
}

/** The whole name is one brace group: {World Health Organization}. */
function isSingleGroup(s: string): boolean {
  if (!s.startsWith("{") || !s.endsWith("}")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0 && i !== s.length - 1) return false;
    }
  }
  return depth === 0;
}

function decode(raw: string): string {
  return latexToPlain(raw).split(NBSP).join(" ").replace(/\s+/g, () => " ").trim();
}

function build(given: string[], von: string[], last: string[], jr: string): BibName {
  const name: BibName = {};
  const fam = decode(last.join(" "));
  const giv = decode(given.join(" "));
  const part = decode(von.join(" "));
  const suf = decode(jr);
  if (fam) name.family = fam;
  if (giv) name.given = giv;
  if (part) name["non-dropping-particle"] = part;
  if (suf) name.suffix = suf;
  return name;
}

/** Split "von Last" words: von runs from the first word to the last lowercase word, if the first is lowercase. */
function splitVonLast(words: string[]): { von: string[]; last: string[] } {
  if (words.length <= 1 || !isVonWord(words[0])) return { von: [], last: words };
  let end = 0;
  for (let k = 0; k < words.length - 1; k++) if (isVonWord(words[k])) end = k;
  return { von: words.slice(0, end + 1), last: words.slice(end + 1) };
}

/** One BibTeX name (already split from its list). Throws NameError for too many commas. */
export function parseBibtexName(raw: string): BibName {
  const s = raw.trim();
  if (isSingleGroup(s)) return { literal: decode(s.slice(1, -1)) };
  const parts = splitCommas(s);
  if (parts.length > 3) throw new NameError(`too many commas in the name “${decode(s)}”`);
  if (parts.length === 1) {
    const words = splitWords(parts[0]);
    if (words.length === 0) return {};
    if (words.length === 1) return build([], [], words, "");
    // First von Last.
    let vonStart = -1;
    let vonEnd = -1;
    for (let k = 0; k < words.length - 1; k++) {
      if (isVonWord(words[k])) {
        if (vonStart < 0) vonStart = k;
        vonEnd = k;
      }
    }
    if (vonStart < 0) return build(words.slice(0, -1), [], words.slice(-1), "");
    return build(words.slice(0, vonStart), words.slice(vonStart, vonEnd + 1), words.slice(vonEnd + 1), "");
  }
  const first = parts.length === 2 ? parts[1] : parts[2];
  const jr = parts.length === 3 ? parts[1] : "";
  const { von, last } = splitVonLast(splitWords(parts[0]));
  return build(splitWords(first), von, last, jr);
}

/**
 * A BibTeX author/editor field. `others` (as a whole name) sets etAl and is not a name.
 * Throws NameError when one name is malformed.
 */
export function parseBibtexNameList(raw: string): { names: BibName[]; etAl: boolean } {
  const names: BibName[] = [];
  let etAl = false;
  for (const piece of splitBibtexNames(raw)) {
    if (piece === "others") {
      etAl = true;
      continue;
    }
    const nm = parseBibtexName(piece);
    if (Object.keys(nm).length) names.push(nm);
  }
  return { names, etAl };
}

/**
 * A RIS AU/A1/A2/ED value: "Last, First" or "Last, First, Suffix" (the RIS spec form).
 * Without a comma the value is not split: one word is a family name, several words are
 * a literal ("Valentine G." in a real Zotero export stays exactly that).
 */
export function parseRisName(raw: string): BibName {
  const s = raw.normalize("NFC").replace(/\s+/g, () => " ").trim();
  if (s === "") return {};
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length === 1) return s.includes(" ") ? { literal: s } : { family: s };
  if (parts.length > 3 || parts[0] === "") return { literal: s };
  const name: BibName = {};
  const famWords = parts[0].split(" ");
  let k = 0;
  while (k < famWords.length - 1 && isLowerLetter(famWords[k][0] ?? "")) k++;
  if (k > 0) name["non-dropping-particle"] = famWords.slice(0, k).join(" ");
  name.family = famWords.slice(k).join(" ");
  if (parts[1]) name.given = parts[1];
  if (parts.length === 3 && parts[2]) name.suffix = parts[2];
  return name;
}
