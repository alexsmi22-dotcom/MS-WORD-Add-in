// Botanical / plant-patent helpers: typeset a scientific name with the correct
// italics (genus, species, and infraspecific epithets italic; rank connectors,
// authors, hybrid markers, and cultivar names roman) and build a varietal
// "characteristics" table. Output is HTML for Word.Range.insertHtml().
//
// Pure string logic — no Office.js — so it is fully unit-testable. Nomenclature
// follows the ICN/ICNCP conventions a drafter expects; it is a drafting aid.

// Rank connectors below species — roman, with the following epithet italic.
const RANK_CONNECTORS = new Set([
  "subsp.", "ssp.", "var.", "subvar.", "f.", "forma", "subf.",
  "nothosubsp.", "nothovar.", "convar.", "sect.", "ser.",
]);
// Unranked / qualifier markers — roman, and the rest of the name stays roman.
const UNRANKED = new Set(["sp.", "spp.", "spec.", "aff.", "cf.", "gen."]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isEpithet(t: string): boolean {
  return /^\p{Ll}[\p{Ll}-]*$/u.test(t);
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function isQuoted(t: string): boolean {
  return /^['"‘“]/.test(t);
}

/** Normalizes a cultivar epithet to straight single quotes. */
function normalizeCultivar(t: string): string {
  return "'" + t.replace(/^['"‘“]+|['"’”]+$/g, "") + "'";
}

/** Splits a name on whitespace, keeping a quoted cultivar (e.g. 'Peace') together. */
function tokenizeName(s: string): string[] {
  return s.match(/['"‘“][^'"’”]*['"’”]|\S+/g) ?? [];
}

interface NamePart {
  text: string;
  italic: boolean;
}

/** Classifies a scientific name into italic/roman parts (see module header). */
export function parseBotanicalName(input: string): NamePart[] {
  const tokens = tokenizeName(input.trim());
  if (!tokens.length) return [];
  const parts: NamePart[] = [];

  // Leading hybrid marker (genus hybrid), standalone "×"/"x" or attached "×Genus".
  let start = 0;
  if (tokens[0] === "×" || tokens[0].toLowerCase() === "x") {
    parts.push({ text: "×", italic: false });
    start = 1;
  } else if (tokens[0].startsWith("×") && tokens[0].length > 1) {
    parts.push({ text: "×", italic: false });
    tokens[0] = tokens[0].slice(1);
  }

  // A lone hybrid marker (or nothing left after it) has no genus to format.
  if (start >= tokens.length || !tokens[start]) return parts;
  parts.push({ text: capitalize(tokens[start]), italic: true }); // genus

  let epithetNext = false; // the next token is an italic epithet
  let speciesDone = false;
  let roman = false; // once authors/cultivar/sp. seen, the rest is roman

  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i];
    const low = t.toLowerCase();

    if (roman) {
      parts.push({ text: t, italic: false });
    } else if (isQuoted(t)) {
      parts.push({ text: normalizeCultivar(t), italic: false }); // cultivar
      roman = true;
    } else if (low === "cv.") {
      parts.push({ text: t, italic: false });
      roman = true;
    } else if (RANK_CONNECTORS.has(low)) {
      parts.push({ text: t, italic: false });
      epithetNext = true;
    } else if (UNRANKED.has(low)) {
      parts.push({ text: t, italic: false });
      roman = true;
    } else if (t === "×" || low === "x") {
      parts.push({ text: "×", italic: false }); // nothospecies hybrid marker
      epithetNext = true;
    } else if (epithetNext) {
      parts.push({ text: t, italic: true });
      epithetNext = false;
      speciesDone = true;
    } else if (!speciesDone && isEpithet(t)) {
      parts.push({ text: t, italic: true }); // species epithet
      speciesDone = true;
    } else {
      parts.push({ text: t, italic: false }); // author citation etc.
      roman = true;
    }
  }
  return parts;
}

/** Formats a scientific name as HTML with correct italics for Word. */
export function formatBotanicalNameHtml(input: string): string {
  const parts = parseBotanicalName(input);
  return parts
    .map((p) => (p.italic ? `<i>${escapeHtml(p.text)}</i>` : escapeHtml(p.text)))
    .join(" ");
}

/**
 * Builds a varietal "characteristics" table from "Label: value" lines (one per
 * row) — common in plant-patent botanical descriptions. Returns "" if empty.
 */
export function formatTraitTableHtml(input: string): string {
  const rows = input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      return {
        label: idx >= 0 ? line.slice(0, idx).trim() : line,
        value: idx >= 0 ? line.slice(idx + 1).trim() : "",
      };
    });
  if (!rows.length) return "";
  const cells = rows
    .map(
      (r) =>
        `<tr><td style="border:1px solid #cccccc;padding:3px 8px;font-weight:bold;vertical-align:top;">` +
        `${escapeHtml(r.label)}</td>` +
        `<td style="border:1px solid #cccccc;padding:3px 8px;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return (
    '<table style="border-collapse:collapse;border:1px solid #cccccc;' +
    'font-family:Calibri,\'Segoe UI\',sans-serif;font-size:10pt;">' +
    cells +
    "</table>"
  );
}
