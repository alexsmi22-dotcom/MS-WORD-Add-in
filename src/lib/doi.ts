// Pasted DOIs, offline (docs/SCOPE-CITATIONS-2026-10.md §C2).
//
// JurisLab is offline (precaching service worker), so this module RECOGNISES and
// NORMALISES a DOI and nothing more. It makes no network request of any kind and
// imports nothing that does; networkSurface.test.ts polices that, and doi.test.ts
// stubs every network primitive and asserts none is touched. The DOI fills one field;
// the user supplies the rest by pasting BibTeX or RIS.
//
// Accepted paste forms: "10.…", "doi:10.…", "doi: 10.…", "DOI 10.…", "info:doi/10.…",
// "https://doi.org/10.…", "http://dx.doi.org/10.…", "doi.org/10.…", percent-encoded
// URLs. Recognition follows Crossref's recommended pattern 10.\d{4,9}/… (registrant
// codes with sub-divisions, 10.1000.10/…, are allowed too), then trailing sentence
// punctuation is trimmed. A closing ) or ] is trimmed only when unbalanced, so
// 10.1016/S0027-9684(15)31340-7 keeps its parenthesis and "(see 10.1000/x)" loses one.

/** The UI line for the DOI box (§C2): say plainly that nothing is looked up. */
export const DOI_OFFLINE_NOTE =
  "JurisLab works offline, so it can't look a DOI up. Paste the reference's BibTeX or RIS from the publisher page to fill everything.";

/** Crossref's recommended pattern (case-insensitive), anchored at a DOI start. */
export const CROSSREF_DOI_PATTERN = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

export type DoiResult = { doi: string; url: string } | { error: string };

const PREFIX_RE = /^(?:(?:https?:\/\/)?(?:www\.)?(?:dx\.)?doi\.org\/|info:doi\/|doi\s*:\s*|doi\s+)/i;
const DOI_START_RE = /^10\.\d{4,9}(?:\.\d+)*\/\S+$/;

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** Remove trailing sentence punctuation, and closing brackets that have no opener. */
export function trimDoiTail(doi: string): string {
  let d = doi;
  for (;;) {
    const last = d[d.length - 1];
    if (last === undefined) return d;
    if (".,;:!?'\"’”»".includes(last)) {
      d = d.slice(0, -1);
      continue;
    }
    if (last === ")" && count(d, ")") > count(d, "(")) {
      d = d.slice(0, -1);
      continue;
    }
    if (last === "]" && count(d, "]") > count(d, "[")) {
      d = d.slice(0, -1);
      continue;
    }
    if (last === ">" && count(d, ">") > count(d, "<")) {
      d = d.slice(0, -1);
      continue;
    }
    return d;
  }
}

/** The resolver URL for a bare DOI. */
export function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}

/**
 * Normalise one pasted DOI. Returns the bare DOI ("10.…") and its https://doi.org/ URL,
 * or a reason it is not a DOI. Never contacts anything.
 */
export function normalizeDoi(input: string): DoiResult {
  let s = (input ?? "").normalize("NFC").trim();
  // Surrounding angle brackets or quotes from e-mail and prose.
  s = s.replace(/^[<"'“‘(\[]+/, () => "").trim();
  s = s.replace(PREFIX_RE, () => "").trim();
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // Leave it as typed; the pattern check below decides.
    }
  }
  s = trimDoiTail(s);
  if (!DOI_START_RE.test(s)) {
    const shown = (input ?? "").trim().slice(0, 80);
    if (/^10\.\d{1,3}\//.test(s) || /^10\.\d{10,}\//.test(s)) {
      return { error: `“${shown}” is not a DOI: the prefix after “10.” must have 4–9 digits.` };
    }
    if (/^10\.\d{4,9}\/?$/.test(s)) {
      return { error: `“${shown}” is not a DOI: it has a prefix but no suffix after the slash.` };
    }
    return { error: `“${shown}” is not a DOI: a DOI starts with “10.”, 4–9 digits and a slash (10.1086/720277).` };
  }
  return { doi: s, url: doiUrl(s) };
}

/** Every DOI in free text (Crossref pattern), normalised and de-duplicated, in order. */
export function findDois(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(CROSSREF_DOI_PATTERN.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? "")) !== null) {
    const d = trimDoiTail(m[0]);
    if (DOI_START_RE.test(d) && !out.some((x) => x.toLowerCase() === d.toLowerCase())) out.push(d);
  }
  return out;
}
