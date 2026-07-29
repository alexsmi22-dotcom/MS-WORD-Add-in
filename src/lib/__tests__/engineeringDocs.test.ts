// The Engineering docs must keep up with the Engineering code.
//
// WHY THIS EXISTS. Three releases of engineering work shipped while the landing
// page, the tool page and the README still described the previous tool. The
// older doc-rot guards all passed throughout, because they check TOOL-level
// facts — 26 tools, every tool named — and nothing at that level had changed.
//
// WHY IT LOOKS LIKE THIS. The first version of this file was defeated SIX ways
// by an independent review, and every hole is worth naming because each is a
// general trap:
//
//   - Its count regex required the number to sit immediately before the word, so
//     "19 financial calculators" and "<b>19</b><span>Finance calculators</span>"
//     were invisible — and invisible SILENTLY, because an unparsed number was
//     skipped rather than reported as unattributed.
//   - `declaredCounts` used a Map keyed by name, so last-write-won: a stale count
//     ABOVE a correct one was overwritten and never judged. That is the realistic
//     shape of doc rot.
//   - Its "advertises a discipline that does not exist" check filtered on a
//     HARDCODED list of discipline words — precisely the anti-pattern the file's
//     own comment claimed to avoid.
//   - Its documentation haystack included the whole of `taskpane.ts`, so a
//     *code comment* satisfied a *documentation* check; and its keyword check
//     matched "point" and "moment" against "operating point" and "bending
//     moment" elsewhere in that source.
//   - Half the fraction assertion inspected `beam.ts`'s own source, so it could
//     not fail for a documentation reason at all.
//
// The rules that follow, and that this version holds to:
//   1. Documentation is prose written for a reader. Source files are NOT
//      documentation and are not searched.
//   2. EVERY occurrence is judged, never just the last one.
//   3. A quantity that cannot be attributed is a FAILURE, not a skip.
//   4. Nothing is hardcoded that can be derived from source.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const PANE = read("src/taskpane/taskpane.ts");

/** The registries the pane actually ships, found rather than listed. */
function registries(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of PANE.matchAll(/^const ([A-Z][A-Z_]*_CALCS)\b/gm)) {
    const name = m[1];
    const i = PANE.indexOf(`const ${name}`);
    const j = PANE.indexOf("\n];", i);
    out[name] = [...PANE.slice(i, j).matchAll(/\bid: "[a-z0-9-]+"/g)].length;
  }
  return out;
}

/** Engineering disciplines and their sizes, from the ENG_CALCS `group` fields. */
function engGroups(): Map<string, number> {
  const i = PANE.indexOf("const ENG_CALCS");
  const j = PANE.indexOf("\n];", i);
  const out = new Map<string, number>();
  for (const m of PANE.slice(i, j).matchAll(/group: "([^"]+)"/g)) {
    out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  }
  return out;
}

/** Prose pages only. Source files are not documentation. */
const PAGES = [
  "landing/index.html",
  "landing/manual.html",
  "landing/science.html",
  "landing/tool.html",
  "README.md",
  "FEATURES.md",
];

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&mdash;/g, "-");

describe("the registries are found — this file cannot pass vacuously", () => {
  test("every *_CALCS registry is located and non-empty", () => {
    const r = registries();
    expect(Object.keys(r).length).toBeGreaterThanOrEqual(5);
    for (const [name, n] of Object.entries(r)) expect({ name, ok: n > 0 }).toEqual({ name, ok: true });
  });

  test("the Engineering groups are found", () => {
    expect(engGroups().size).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Per-discipline counts — EVERY occurrence, not the last
// ---------------------------------------------------------------------------

describe("every discipline count on every page is the real one", () => {
  const groups = engGroups();

  /** All `Name (n)` claims on a page, as a LIST so duplicates are all kept. */
  function claims(html: string): { name: string; n: number }[] {
    const out: { name: string; n: number }[] = [];
    for (const m of html.matchAll(/<b>([^<]{3,40}?)\s*\((\d+)\)/g)) {
      out.push({ name: decodeEntities(m[1]).replace(/[:.]$/, "").trim(), n: parseInt(m[2], 10) });
    }
    return out;
  }

  for (const page of ["landing/manual.html", "landing/tool.html"]) {
    const html = read(page);

    test(`${page}: every claim naming a real discipline states its real size`, () => {
      const wrong = claims(html)
        .filter((c) => groups.has(c.name))
        .filter((c) => c.n !== groups.get(c.name))
        .map((c) => `${c.name} says ${c.n}, ships ${groups.get(c.name)}`);
      expect({ page, wrong }).toEqual({ page, wrong: [] });
    });

    test(`${page}: every discipline is claimed at least once`, () => {
      const named = new Set(claims(html).map((c) => c.name));
      const missing = [...groups.keys()].filter((g) => !named.has(g));
      expect({ page, missing }).toEqual({ page, missing: [] });
    });

    test(`${page}: no claim advertises a discipline that does not ship`, () => {
      // Derived, not hardcoded. Any claim shaped like a discipline-list entry —
      // a plain capitalised phrase followed by a count — must name a real group.
      const bogus = claims(html)
        .filter((c) => !groups.has(c.name))
        .filter((c) => /^[A-Z][A-Za-z&\s]{2,30}$/.test(c.name))
        .map((c) => `${c.name} (${c.n})`);
      expect({ page, bogus }).toEqual({ page, bogus: [] });
    });
  }
});

// ---------------------------------------------------------------------------
// Totals — every quantity near the word, attributed or failed
// ---------------------------------------------------------------------------

describe("every calculator total is attributable and correct", () => {
  const WORDS: Record<string, number> = {
    twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, "twenty-one": 21, "twenty-two": 22,
    "thirty-five": 35, "thirty-six": 36, "thirty-seven": 37, "thirty-eight": 38, "thirty-nine": 39,
  };

  const OWNER: [RegExp, string][] = [
    [/engineering|disciplin/i, "ENG_CALCS"],
    [/financ|amortization|\bTVM\b|black\W*scholes|\bbond/i, "FIN_CALCS"],
    [/statistic|\bstats\b/i, "STAT_CALCS"],
    [/analy[sz]e|workbench|matrix math/i, "ANALYZE_CALCS"],
    [/assay|\bbio\b|dose\W*response|curve fit/i, "ASSAY_CALCS"],
  ];

  test("every 'N calculators' claim names a real registry and its real size", () => {
    const reg = registries();
    const wrong: string[] = [];
    const unattributed: string[] = [];

    for (const p of PAGES) {
      const text = read(p);
      for (const m of text.matchAll(/calculators?\b/gi)) {
        // The quantity must be a STANDALONE TOKEN just before the noun, with
        // only markup and at most two adjectives in between. Tags are stripped
        // first so "<b>19</b><span>Finance calculators" reads as "19 Finance
        // calculators", which is the phrasing that defeated the first version —
        // but scanning backwards for "the nearest digit anywhere" is too greedy
        // the other way, and picked the 3 out of "</h3>", the 4 out of "4PL"
        // and the 50 out of "IC50". Neither extreme is right; this is the
        // middle, and it is why the window is anchored at its end.
        const before = decodeEntities(text.slice(Math.max(0, m.index! - 90), m.index!))
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ");
        // The delimiter is "anything that is not alphanumeric", not a list of
        // punctuation: the first attempt listed a few characters and missed
        // `tagline:"19 financial calculators` because a double quote was not on
        // the list. It still excludes a digit glued to letters, so "IC50" and
        // "4PL" cannot be read as quantities.
        const q = /(?:^|[^A-Za-z0-9])([A-Za-z]+(?:-[A-Za-z]+)?|\d+)\s+(?:[A-Za-z]+\s+){0,2}$/.exec(before);
        let n: number | undefined;
        if (q) {
          const t = q[1].toLowerCase();
          if (/^\d+$/.test(t)) n = parseInt(t, 10);
          else if (WORDS[t] !== undefined) n = WORDS[t];
        }
        if (n === undefined) continue; // "the calculators", "lab calculators"

        const ctx = decodeEntities(text.slice(Math.max(0, m.index! - 300), m.index! + 120));
        const owner = OWNER.find(([re]) => re.test(ctx));
        const snippet = `${before.slice(-42).replace(/\s+/g, " ")}${m[0]}`;
        if (!owner) unattributed.push(`${p}: "...${snippet}"`);
        else if (reg[owner[1]] !== n)
          wrong.push(`${p}: "...${snippet}" -> ${owner[1]} ships ${reg[owner[1]]}, page says ${n}`);
      }
    }
    // An unattributable quantity FAILS. Silently skipping one is exactly how the
    // first version let a wrong Finance number through.
    expect({ wrong, unattributed }).toEqual({ wrong: [], unattributed: [] });
  });
});

// ---------------------------------------------------------------------------
// Syntax must be documented in PROSE, not merely present in source
// ---------------------------------------------------------------------------

describe("every beam support option is documented for a reader", () => {
  const BEAM = read("src/lib/beam.ts");

  /**
   * Canonical option names, from the `opts.set("x", …)` targets in parseSupports.
   * Aliases are excluded deliberately: an alias only helps someone who already
   * knows the option exists.
   */
  function optionNames(): string[] {
    return [...new Set([...BEAM.matchAll(/opts\.set\("([a-z]+)"/g)].map((m) => m[1]))];
  }

  // The in-pane help and the two web pages. NOT taskpane.ts — its source is
  // code, and letting code satisfy a documentation check is how the first
  // version passed while `k=` and `settle=` were genuinely undocumented.
  const PROSE = [read("src/lib/examples.ts"), read("landing/manual.html"), read("landing/tool.html")].join("\n");

  test("the extractor found the options", () => {
    expect(optionNames().length).toBeGreaterThanOrEqual(2);
  });

  test("each option appears with its equals sign in user-facing prose", () => {
    const undocumented = optionNames().filter((n) => !PROSE.includes(`${n}=`));
    expect(undocumented).toEqual([]);
  });

  test("the beam calculator's own hint mentions them, since that is read first", () => {
    // Scoped to the beam entry's hint, not the whole pane source.
    const i = PANE.indexOf('id: "beam"');
    expect(i).toBeGreaterThan(0);
    const hint = PANE.slice(i, PANE.indexOf("fields:", i));
    const missing = optionNames().filter((n) => !hint.includes(`${n}=`));
    expect(missing).toEqual([]);
  });

  test("the fraction form is documented where a reader will find it", () => {
    // Prose only. The earlier version also inspected beam.ts's own source, which
    // cannot fail for a documentation reason and was structurally vacuous.
    expect(/\b\d+\/\d+\b/.test(PROSE)).toBe(true);
    expect(/fraction/i.test(PROSE)).toBe(true);
  });
});
