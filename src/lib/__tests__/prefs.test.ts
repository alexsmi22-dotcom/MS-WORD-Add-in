import { getPrefs, setPref, DEFAULT_PREFS } from "../prefs";

describe("prefs", () => {
  const realLs = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = realLs;
  });

  it("returns defaults when storage is unavailable", () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("round-trips a preference through storage", () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    setPref("calloutParens", false);
    setPref("dnaFrame", -2);
    const prefs = getPrefs();
    expect(prefs.calloutParens).toBe(false);
    expect(prefs.dnaFrame).toBe(-2);
    // Untouched keys keep their defaults.
    expect(prefs.legendFormat).toBe(DEFAULT_PREFS.legendFormat);
  });

  it("does not throw when setItem fails", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => setPref("calloutParens", true)).not.toThrow();
  });
});

describe("prefs value validation", () => {
  const realLs = (globalThis as { localStorage?: unknown }).localStorage;
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = realLs;
  });

  it("falls back to defaults for present-but-invalid stored values", () => {
    const store: Record<string, string> = {
      "formula-inserter.prefs": JSON.stringify({ calloutParens: "yes", dnaFrame: "north", legendFormat: "bogus" }),
    };
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    const p = getPrefs();
    expect(p.calloutParens).toBe(DEFAULT_PREFS.calloutParens);
    expect(p.dnaFrame).toBe(DEFAULT_PREFS.dnaFrame);
    expect(p.legendFormat).toBe(DEFAULT_PREFS.legendFormat);
  });

  it("keeps a valid non-default value", () => {
    const store: Record<string, string> = {
      "formula-inserter.prefs": JSON.stringify({ calloutParens: false, dnaFrame: -2, legendFormat: "table" }),
    };
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    const p = getPrefs();
    expect(p.calloutParens).toBe(false);
    expect(p.dnaFrame).toBe(-2);
    expect(p.legendFormat).toBe("table");
  });
});

// --- Home audience filter ---------------------------------------------------
// The pane serves two audiences that barely overlap. This preference narrows the
// Home cards so a chemist isn't reading "Bluebook Citations" as clutter. It must
// default to showing everything — nothing hidden until the user asks — and must
// survive corrupt storage like every other pref.
describe("homeFilter", () => {
  const realLs = (globalThis as { localStorage?: unknown }).localStorage;
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = realLs;
  });

  /** Installs a fake localStorage pre-seeded with `raw` (matches this suite's style). */
  function withStorage(raw?: string): Record<string, string> {
    const store: Record<string, string> = {};
    if (raw !== undefined) store["formula-inserter.prefs"] = raw;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    return store;
  }

  it("defaults to showing every tool — nothing is hidden until asked", () => {
    expect(DEFAULT_PREFS.homeFilter).toBe("all");
    withStorage();
    expect(getPrefs().homeFilter).toBe("all");
  });

  it("round-trips each audience", () => {
    withStorage();
    for (const v of ["science", "legal", "all"] as const) {
      setPref("homeFilter", v);
      expect(getPrefs().homeFilter).toBe(v);
    }
  });

  it("falls back to 'all' on a value outside the domain", () => {
    // An older/newer schema, or hand-edited storage, must not strand someone on
    // a filter the code no longer understands — they would see a half-empty Home
    // with no way to explain it.
    for (const bad of ['"chemistry"', '"ALL"', "42", "null", "true", '""']) {
      withStorage(`{"homeFilter":${bad}}`);
      expect(getPrefs().homeFilter).toBe("all");
    }
  });

  it("survives storage being unavailable", () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(getPrefs().homeFilter).toBe("all");
  });

  it("is independent of the other preferences", () => {
    withStorage();
    setPref("homeFilter", "science");
    setPref("dnaFrame", 2);
    expect(getPrefs().homeFilter).toBe("science");
    expect(getPrefs().dnaFrame).toBe(2);
    expect(getPrefs().legendFormat).toBe(DEFAULT_PREFS.legendFormat);
  });
});
