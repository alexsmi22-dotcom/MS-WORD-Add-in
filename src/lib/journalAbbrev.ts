// Journal (container) titles for the citation styles (docs/SCOPE-CITATIONS-2026-10.md §E
// "Journal abbreviations").
//
// RULE: an abbreviation is used only when the SOURCE supplied it (container-title-short).
// Nothing here invents an ISO-4 / CASSI / NLM abbreviation, and no abbreviation list is
// bundled (licence questions: CASSI and the ISSN LTWA terms are unchecked). When a style
// wants an abbreviation and the record has none, the full title is printed and a warning
// is returned so the pane can tell the user.
//
// Removing the periods from an abbreviation the source gave ("N. Engl. J. Med." →
// "N Engl J Med", the NLM form) is a typographic change, not an invention. Adding periods
// is NOT done, because which tokens are abbreviations cannot be known ("Science" is a word).

import type { BibRecord } from "./bibRecord";
import { richPlain } from "./bibCase";

export type JournalForm =
  | "full" // the full title as given (ACS 2026 quick guide prints full journal names)
  | "abbrev" // the source's abbreviation as given (IEEE, Nature)
  | "abbrev-nlm"; // the source's abbreviation without periods (NLM / Vancouver)

export interface JournalTitle {
  /** Rich text (may carry <i>, Unicode) to print. Empty when the record has no container. */
  text: string;
  /** Set when an abbreviation was wanted but the record has none. */
  warning?: string;
}

/** Strip abbreviation periods for NLM ("J. Am. Chem. Soc." → "J Am Chem Soc"). */
export function nlmStripPeriods(abbrev: string): string {
  return abbrev
    .replace(/\.(?=\s|$)/g, "")
    .replace(/\.(?=[A-Z])/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function journalTitle(rec: BibRecord, form: JournalForm): JournalTitle {
  const full = rec["container-title"]?.trim() ?? "";
  const short = rec["container-title-short"]?.trim() ?? "";
  if (form === "full") return { text: full || short };
  if (short) return { text: form === "abbrev-nlm" ? nlmStripPeriods(short) : short };
  if (!full) return { text: "" };
  // One-word titles are never abbreviated (IEEE guide: "Science and Nature"; NLM "Science").
  if (/^\S+$/.test(richPlain(full))) return { text: full };
  return {
    text: full,
    warning: `No abbreviation for "${richPlain(full)}" in the source; the full title is printed. `
      + "Add the abbreviation (container-title-short) to print the abbreviated form.",
  };
}
