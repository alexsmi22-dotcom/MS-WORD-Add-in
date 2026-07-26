// USPTO paragraph numbering — the bracketed [0001] marks in a US specification.
//
// WHY THIS MATTERS
// Numbered paragraphs are how every US application is amended and how every
// office-action response refers to the spec ("Applicant respectfully directs the
// Examiner to paragraph [0042]"). 37 CFR 1.52(b)(6) provides for them and
// examiners rely on them. Doing it by hand across a 60-page spec, then
// RE-doing it after inserting a paragraph, is exactly the mechanical,
// unmissable-when-wrong work software should own.
//
// The design decision that matters: what NOT to number. USPTO practice numbers
// the paragraphs of the description. Numbering a heading, a claim, or the
// abstract produces a document that looks authoritative and is wrong, and the
// attorney may not notice until the examiner does.

/** Four-digit bracketed form, e.g. 42 -> "[0042]". */
export function formatParagraphNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  // Four digits is the convention and covers 9999 paragraphs; beyond that the
  // number simply grows rather than being truncated into a wrong label.
  return "[" + String(Math.floor(n)).padStart(4, "0") + "]";
}

/** Reads a leading paragraph number, or null when the text carries none. */
export function parseParagraphNumber(text: string): number | null {
  // Real documents carry [0001], [00001] and the occasional [1]; all are the
  // same mark. Anchored to the start: a bracketed number mid-sentence is a
  // citation, not a paragraph mark.
  const m = /^\s*\[(\d{1,6})\]/.exec(text);
  return m ? Number(m[1]) : null;
}

/** Text with any leading paragraph number removed. */
export function stripParagraphNumber(text: string): string {
  return text.replace(/^\s*\[\d{1,6}\]\s*/, "");
}

export interface ParagraphNumberOptions {
  /** First number to assign. USPTO specs conventionally start at 1. */
  start?: number;
  /**
   * Stop numbering at the claims. The claims are numbered as claims and must
   * never carry paragraph marks; a spec whose claims are bracketed is facially
   * defective.
   */
  stopAtClaims?: boolean;
  /** Replace existing marks rather than leaving them (i.e. renumber). */
  renumber?: boolean;
}

export interface ParagraphPlanItem {
  /** Index into the input array. */
  index: number;
  /** The number assigned, or null when this paragraph is skipped. */
  number: number | null;
  /** Why it was skipped, for the report. */
  skipped?: "empty" | "heading" | "claims" | "already-numbered";
  /** The mark to insert, or "" when nothing is inserted. */
  mark: string;
  /** An existing mark that must be removed first (renumbering). */
  removeExisting: boolean;
}

export interface ParagraphPlan {
  items: ParagraphPlanItem[];
  numbered: number;
  skippedHeadings: number;
  skippedEmpty: number;
  /** Index at which the claims began, or -1. */
  claimsAt: number;
  alreadyNumbered: number;
  /**
   * Numbers this plan would assign that ALREADY exist further down the
   * document.
   *
   * The real workflow that causes it: paragraphs are inserted into an
   * already-numbered spec, so the new ones take the next free number while the
   * old marks below keep theirs — and the document ends up with two [0002]s. An
   * office action citing a duplicated paragraph number is a genuine problem, so
   * the plan reports it and the caller offers to renumber instead.
   */
  collisions: number[];
}

/**
 * True for a line that reads as a section heading rather than a paragraph.
 *
 * Deliberately conservative: the cost of missing a heading is one stray number
 * the attorney deletes, while the cost of treating a real paragraph as a heading
 * is a gap in the sequence that makes every later cross-reference wrong. So a
 * heading must be SHORT, unpunctuated at the end, and either fully upper-case or
 * one of the standard spec headings.
 */
export function looksLikeHeading(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (/[.;:,]$/.test(t)) return false;

  const STANDARD =
    /^(cross[- ]reference|statement regarding|technical field|field of the (invention|disclosure)|background|summary|brief description of the (drawings?|figures?)|detailed description|description of the (preferred )?embodiments?|abstract|claims?|what is claimed|sequence listing|incorporation by reference)/i;
  if (STANDARD.test(t)) return true;

  // ALL CAPS (allowing digits and punctuation) with at least one letter.
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 2 && letters === letters.toUpperCase()) return true;

  return false;
}

/** True for the line that starts the claims. */
export function looksLikeClaimsStart(text: string): boolean {
  return /^\s*(what is claimed is|we claim|i claim|the invention claimed is|claims?)\b/i.test(text.trim());
}

/**
 * Decides what each paragraph gets, without touching a document.
 *
 * Separated from insertion so the whole policy is testable and so the pane can
 * show a preview — "34 paragraphs numbered, 6 headings skipped, claims start at
 * paragraph 41" — before anything is written. A numbering pass that cannot be
 * previewed is one nobody will run twice.
 */
export function planParagraphNumbering(
  paragraphs: string[],
  options: ParagraphNumberOptions = {},
): ParagraphPlan {
  const start = Math.max(0, Math.floor(options.start ?? 1));
  const stopAtClaims = options.stopAtClaims !== false;
  const renumber = options.renumber === true;

  const items: ParagraphPlanItem[] = [];
  let next = start;
  let claimsAt = -1;
  let numbered = 0;
  let skippedHeadings = 0;
  let skippedEmpty = 0;
  let alreadyNumbered = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const raw = paragraphs[i];
    const bare = stripParagraphNumber(raw);
    const existing = parseParagraphNumber(raw);

    if (claimsAt !== -1) {
      items.push({ index: i, number: null, skipped: "claims", mark: "", removeExisting: false });
      continue;
    }
    if (stopAtClaims && looksLikeClaimsStart(bare)) {
      claimsAt = i;
      items.push({ index: i, number: null, skipped: "claims", mark: "", removeExisting: false });
      continue;
    }
    if (!bare.trim()) {
      skippedEmpty++;
      items.push({ index: i, number: null, skipped: "empty", mark: "", removeExisting: false });
      continue;
    }
    if (looksLikeHeading(bare)) {
      skippedHeadings++;
      items.push({ index: i, number: null, skipped: "heading", mark: "", removeExisting: false });
      continue;
    }
    if (existing !== null && !renumber) {
      // Leave it alone, but keep the sequence walking past it so a partially
      // numbered document does not restart or collide.
      alreadyNumbered++;
      next = Math.max(next, existing + 1);
      items.push({ index: i, number: existing, skipped: "already-numbered", mark: "", removeExisting: false });
      continue;
    }

    items.push({
      index: i,
      number: next,
      mark: formatParagraphNumber(next),
      removeExisting: existing !== null,
    });
    numbered++;
    next++;
  }

  // Any number we are about to assign that some untouched paragraph already
  // carries. Only meaningful when not renumbering, since renumbering rewrites
  // every mark and cannot collide with itself.
  const existingNumbers = new Set(
    items.filter((i) => i.skipped === "already-numbered" && i.number !== null).map((i) => i.number as number),
  );
  const collisions = renumber
    ? []
    : [...new Set(items.filter((i) => i.mark && i.number !== null && existingNumbers.has(i.number)).map((i) => i.number as number))];

  return { items, numbered, skippedHeadings, skippedEmpty, claimsAt, alreadyNumbered, collisions };
}

/** Human-readable summary of a plan, shown before anything is written. */
export function describeParagraphPlan(plan: ParagraphPlan): string {
  const bits = [`${plan.numbered} paragraph${plan.numbered === 1 ? "" : "s"} will be numbered`];
  if (plan.alreadyNumbered) bits.push(`${plan.alreadyNumbered} already numbered (left as-is)`);
  if (plan.skippedHeadings) bits.push(`${plan.skippedHeadings} heading${plan.skippedHeadings === 1 ? "" : "s"} skipped`);
  if (plan.skippedEmpty) bits.push(`${plan.skippedEmpty} empty skipped`);
  if (plan.claimsAt >= 0) bits.push("claims not numbered");
  let out = bits.join(" · ");
  if (plan.collisions.length) {
    const list = plan.collisions.slice(0, 4).map(formatParagraphNumber).join(", ");
    out +=
      `
⚠ ${plan.collisions.length} number${plan.collisions.length === 1 ? "" : "s"} ` +
      `(${list}${plan.collisions.length > 4 ? ", …" : ""}) already appear later in the document. ` +
      "Numbering now would create duplicates — renumber the whole specification instead.";
  }
  return out;
}
