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
