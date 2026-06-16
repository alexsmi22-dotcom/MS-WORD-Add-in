// Recently-used and favorited inserts, persisted in the task pane's localStorage
// so they survive across sessions. An entry records which mode it belongs to and
// the input value to restore, so clicking it reloads the formula/compound/build.

/* global localStorage */

export type HistoryKind = "chemical" | "math" | "build";

export interface HistoryEntry {
  kind: HistoryKind;
  value: string; // the input text to restore (formula, name, or build source)
  label: string; // short display label
}

const RECENTS_KEY = "formula-inserter.recents";
const FAVS_KEY = "formula-inserter.favorites";
const MAX_RECENTS = 8;

function load(key: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function save(key: string, list: HistoryEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // localStorage may be unavailable or full — history is best-effort.
  }
}

function keyOf(e: HistoryEntry): string {
  return `${e.kind}::${e.value}`;
}

export function getRecents(): HistoryEntry[] {
  return load(RECENTS_KEY);
}

export function addRecent(entry: HistoryEntry): void {
  if (!entry.value.trim()) return;
  const list = load(RECENTS_KEY).filter((e) => keyOf(e) !== keyOf(entry));
  list.unshift(entry);
  save(RECENTS_KEY, list.slice(0, MAX_RECENTS));
}

export function getFavorites(): HistoryEntry[] {
  return load(FAVS_KEY);
}

export function isFavorite(entry: HistoryEntry): boolean {
  return load(FAVS_KEY).some((e) => keyOf(e) === keyOf(entry));
}

/** Toggles favorite status; returns true if it is now a favorite. */
export function toggleFavorite(entry: HistoryEntry): boolean {
  const list = load(FAVS_KEY);
  const idx = list.findIndex((e) => keyOf(e) === keyOf(entry));
  if (idx >= 0) {
    list.splice(idx, 1);
    save(FAVS_KEY, list);
    return false;
  }
  list.unshift(entry);
  save(FAVS_KEY, list);
  return true;
}
