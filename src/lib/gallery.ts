// Parses a "substituent gallery" — the list of drawn R-group alternatives a
// drafter wants depicted beneath a Markush genus (e.g. "R1a = c1ccccc1"). Each
// line is an optional label plus a structure input (SMILES, name, or formula);
// the taskpane renders each via structures.renderStructure() and inserts the
// drawn substituents with their labels.
//
// Pure string logic — no Office.js / no OpenChemLib — so it is unit-testable.

export interface Substituent {
  /** Optional label, e.g. "R1a" (empty if the line is just a structure). */
  label: string;
  /** Structure input: SMILES, common name, or formula. */
  input: string;
}

// A label is a simple token (R1a, Ra, X, R1') so a label-less SMILES that
// contains "=" (a double bond, e.g. "CC(=O)O") is NOT mistaken for "label=value".
const LABELLED = /^([A-Za-z][A-Za-z0-9'’]*)\s*[=:]\s*(\S.*)$/;

/** Parses gallery lines into substituents; blank lines are dropped. */
export function parseSubstituents(text: string): Substituent[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = LABELLED.exec(line);
      return m ? { label: m[1], input: m[2].trim() } : { label: "", input: line };
    });
}
