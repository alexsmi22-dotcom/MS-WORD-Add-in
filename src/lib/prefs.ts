// Per-user preferences, persisted in localStorage (per machine/user, not per
// document — contrast numerals, which live in document settings). Best-effort:
// every access is try/catch-guarded and falls back to a default, like numbering
// and history, so the pane never breaks when storage is unavailable.

/* global localStorage */

/**
 * Which tools the Home screen shows.
 *
 * The pane spans two audiences that barely overlap — a chemist has no use for
 * Bluebook citations, and a litigator has none for mass spectrometry. Showing
 * everyone all 22 tools makes each of them read the other half as clutter and
 * conclude the tool isn't for them.
 *
 * This filters the Home CARDS only. Every tool stays reachable from the mode
 * dropdown and the search box, so nothing is ever lost — it's a lens, not a
 * licence tier. Defaults to "all": nothing is hidden until the user asks.
 */
export type HomeFilter = "all" | "science" | "legal";

export interface Prefs {
  /** Parenthesize reference-numeral callouts ("housing (12)" vs "housing 12"). */
  calloutParens: boolean;
  /** Default DNA translation reading frame (1..3, negative = reverse strand). */
  dnaFrame: number;
  /** Default R-group legend insertion format. */
  legendFormat: "line" | "table";
  /** Which audience's tools the Home screen shows. */
  homeFilter: HomeFilter;
}

export const DEFAULT_PREFS: Prefs = {
  calloutParens: true,
  dnaFrame: 1,
  legendFormat: "line",
  homeFilter: "all",
};

const KEY = "formula-inserter.prefs";

/** Loads preferences, merged over defaults (missing/invalid keys fall back). */
export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFS };
    const p = parsed as Partial<Prefs>;
    // Validate each value's type/domain; a present-but-invalid value (corrupt
    // storage, older schema) falls back to the default rather than propagating.
    return {
      calloutParens: typeof p.calloutParens === "boolean" ? p.calloutParens : DEFAULT_PREFS.calloutParens,
      dnaFrame:
        typeof p.dnaFrame === "number" && Number.isInteger(p.dnaFrame) && Math.abs(p.dnaFrame) >= 1 && Math.abs(p.dnaFrame) <= 3
          ? p.dnaFrame
          : DEFAULT_PREFS.dnaFrame,
      legendFormat: p.legendFormat === "line" || p.legendFormat === "table" ? p.legendFormat : DEFAULT_PREFS.legendFormat,
      homeFilter:
        p.homeFilter === "all" || p.homeFilter === "science" || p.homeFilter === "legal"
          ? p.homeFilter
          : DEFAULT_PREFS.homeFilter,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Persists a single preference (best-effort). Returns the updated prefs. */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Prefs {
  const prefs = getPrefs();
  prefs[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // best-effort
  }
  return prefs;
}
