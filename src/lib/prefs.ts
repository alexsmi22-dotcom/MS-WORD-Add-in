// Per-user preferences, persisted in localStorage (per machine/user, not per
// document — contrast numerals, which live in document settings). Best-effort:
// every access is try/catch-guarded and falls back to a default, like numbering
// and history, so the pane never breaks when storage is unavailable.

/* global localStorage */

export interface Prefs {
  /** Parenthesize reference-numeral callouts ("housing (12)" vs "housing 12"). */
  calloutParens: boolean;
  /** Default DNA translation reading frame (1..3, negative = reverse strand). */
  dnaFrame: number;
  /** Default R-group legend insertion format. */
  legendFormat: "line" | "table";
}

export const DEFAULT_PREFS: Prefs = {
  calloutParens: true,
  dnaFrame: 1,
  legendFormat: "line",
};

const KEY = "formula-inserter.prefs";

/** Loads preferences, merged over defaults (missing/invalid keys fall back). */
export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(parsed as Partial<Prefs>) };
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
