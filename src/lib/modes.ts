// The single source of truth for the task pane's tools.
//
// This list used to be duplicated three times — a `Mode` union in taskpane.ts, an
// `ExampleMode` union in examples.ts, and a hand-written `MODES` array in
// examples.test.ts — all of which had to be edited together. They drifted:
// "spectra" was added to the pane in v1.54.0 but never to the other two, so the
// Examples & syntax panel was silently empty for that tool, and the test that
// claimed to check "every mode has help content" iterated its own stale copy and
// passed vacuously.
//
// Deriving the type from one const array means TypeScript now enforces the thing
// a hand-written list cannot: any Record keyed by ExampleMode fails to compile
// until the new tool has an entry.
//
// Pure data — no Office.js — so lib tests can import it.

/** Every tool in the pane, including the Home page. Order is not significant. */
export const ALL_MODES = [
  "home",
  "chemical",
  "math",
  "units",
  "plot",
  "ppt",
  "finance",
  "assay",
  "massspec",
  "spectra",
  "peptide",
  "stats",
  "analyze",
  "build",
  "code",
  "sequence",
  "botanical",
  "numerals",
  "dna",
  "reaction",
  "audit",
  "refs",
  "citations",
] as const;

/** A tool the pane can show. */
export type Mode = (typeof ALL_MODES)[number];

/**
 * Every mode that has an entry in the Examples & syntax panel — i.e. all of them
 * except Home, which hides the panel because the tool cards are the content.
 */
export type ExampleMode = Exclude<Mode, "home">;

/** The modes that need help content, derived rather than re-listed. */
export const EXAMPLE_MODES: ExampleMode[] = ALL_MODES.filter((m): m is ExampleMode => m !== "home");
