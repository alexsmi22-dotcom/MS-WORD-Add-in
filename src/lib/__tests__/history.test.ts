/**
 * @jest-environment jsdom
 */
// Recents / favorites persistence.
//
// history.ts had no tests. Nothing here reaches the document, so the risk is
// lower than the chemistry modules — but it is the only untested module with real
// failure paths (JSON.parse over corrupt storage, a full or unavailable
// localStorage), and those paths are exactly the ones that decide whether the
// pane opens or throws on startup. jsdom gives us a real localStorage, so this
// needs no new infrastructure.

import { getRecents, addRecent, getFavorites, isFavorite, toggleFavorite, clearHistory, HistoryEntry } from "../history";

const RECENTS_KEY = "formula-inserter.recents";
const FAVS_KEY = "formula-inserter.favorites";

const entry = (value: string, kind: HistoryEntry["kind"] = "chemical"): HistoryEntry => ({
  kind,
  value,
  label: value,
});

beforeEach(() => {
  localStorage.clear();
});

describe("recents", () => {
  test("start empty", () => {
    expect(getRecents()).toEqual([]);
  });

  test("a new entry lands at the front (most recent first)", () => {
    addRecent(entry("H2O"));
    addRecent(entry("CO2"));
    expect(getRecents().map((e) => e.value)).toEqual(["CO2", "H2O"]);
  });

  test("re-using an entry moves it to the front without duplicating", () => {
    addRecent(entry("H2O"));
    addRecent(entry("CO2"));
    addRecent(entry("H2O"));
    expect(getRecents().map((e) => e.value)).toEqual(["H2O", "CO2"]);
  });

  test("the same text in a different mode is a DIFFERENT entry", () => {
    // "x" as chemistry and "x" as math restore different tools — collapsing them
    // would reopen the wrong one.
    addRecent(entry("x", "chemical"));
    addRecent(entry("x", "math"));
    expect(getRecents()).toHaveLength(2);
  });

  test("the list is capped at 8", () => {
    for (let i = 0; i < 20; i++) addRecent(entry(`C${i}`));
    const r = getRecents();
    expect(r).toHaveLength(8);
    expect(r[0].value).toBe("C19"); // newest kept
    expect(r.map((e) => e.value)).not.toContain("C0"); // oldest dropped
  });

  test("blank input is not recorded", () => {
    addRecent(entry(""));
    addRecent(entry("   "));
    expect(getRecents()).toEqual([]);
  });
});

describe("favorites", () => {
  test("toggle on, then off, and report state", () => {
    const e = entry("aspirin");
    expect(isFavorite(e)).toBe(false);
    expect(toggleFavorite(e)).toBe(true);
    expect(isFavorite(e)).toBe(true);
    expect(getFavorites().map((x) => x.value)).toEqual(["aspirin"]);
    expect(toggleFavorite(e)).toBe(false);
    expect(isFavorite(e)).toBe(false);
    expect(getFavorites()).toEqual([]);
  });

  test("favorites are matched by mode as well as text", () => {
    toggleFavorite(entry("x", "chemical"));
    expect(isFavorite(entry("x", "chemical"))).toBe(true);
    expect(isFavorite(entry("x", "math"))).toBe(false);
  });

  test("favorites are not capped like recents", () => {
    for (let i = 0; i < 20; i++) toggleFavorite(entry(`C${i}`));
    expect(getFavorites()).toHaveLength(20);
  });
});

describe("clearHistory", () => {
  test("clears both lists", () => {
    addRecent(entry("H2O"));
    toggleFavorite(entry("aspirin"));
    clearHistory();
    expect(getRecents()).toEqual([]);
    expect(getFavorites()).toEqual([]);
  });
});

describe("corrupt or hostile storage never breaks the pane", () => {
  // These are the paths that decide whether the pane opens at all. A throw here
  // would surface as a dead task pane with no explanation.
  test("malformed JSON reads as empty rather than throwing", () => {
    localStorage.setItem(RECENTS_KEY, "{not json");
    localStorage.setItem(FAVS_KEY, "]]]");
    expect(() => getRecents()).not.toThrow();
    expect(getRecents()).toEqual([]);
    expect(getFavorites()).toEqual([]);
  });

  test("valid JSON of the wrong shape reads as empty", () => {
    for (const bad of ['{"a":1}', '"a string"', "42", "null", "true"]) {
      localStorage.setItem(RECENTS_KEY, bad);
      expect(getRecents()).toEqual([]);
    }
  });

  test("writing still works after corrupt data is read", () => {
    localStorage.setItem(RECENTS_KEY, "{not json");
    addRecent(entry("H2O"));
    expect(getRecents().map((e) => e.value)).toEqual(["H2O"]);
  });

  test("a failing localStorage.setItem is swallowed (history is best-effort)", () => {
    // Quota exceeded, or storage disabled by policy: recording an insert must
    // never break the insert itself.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => addRecent(entry("H2O"))).not.toThrow();
      expect(() => toggleFavorite(entry("aspirin"))).not.toThrow();
      expect(() => clearHistory()).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  test("a failing localStorage.getItem is swallowed", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("SecurityError");
    };
    try {
      expect(() => getRecents()).not.toThrow();
      expect(getRecents()).toEqual([]);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
