// The Engineering docs must keep up with the Engineering code.
//
// WHY THIS EXISTS. Three releases of engineering work shipped while the landing
// page, the tool page and the README still described the previous tool. The
// existing doc-rot guards all passed throughout, because they check TOOL-level
// facts — 26 tools, every tool named, counts matching — and nothing at that level
// had changed. The two things that actually went stale were a level below:
//
//   1. A 37th Engineering CALCULATOR shipped while the manual still said
//      "Vibration (3)". A per-discipline count is structured data on both sides,
//      so this is checkable exactly rather than by matching prose.
//   2. New SYNTAX shipped — `k=`, `settle=`, and fractions — while no
//      user-facing page mentioned any of it. No count changed, so a count guard
//      could never have caught it. Syntax is API: it does not churn when someone
//      rewrites a paragraph, which makes it a fair thing to pin.
//
// Both lists are DERIVED FROM SOURCE rather than written out here. A hardcoded
// list is how `unbounded.adversarial.test.ts` ended up covering none of the
// exports added after it was written, and repeating that mistake in the test
// built to prevent it would be a poor joke.
//
// Deliberately NOT checked: prose. A test asserting that some page contains the
// words "modal superposition" fails the first time someone improves a sentence,
// and a guard people delete is worse than no guard at all.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const PANE = read("src/taskpane/taskpane.ts");
const BEAM = read("src/lib/beam.ts");
const MANUAL = read("landing/manual.html");
const TOOLPAGE = read("landing/tool.html");
const EXAMPLES = read("src/lib/examples.ts");

/** The Engineering registry, sliced out of the pane source. */
function engCalcSource(): string {
  const start = PANE.indexOf("const ENG_CALCS");
  if (start < 0) throw new Error("ENG_CALCS not found in taskpane.ts");
  const end = PANE.indexOf("\n];", start);
  if (end < 0) throw new Error("end of ENG_CALCS not found");
  return PANE.slice(start, end);
}

/** How many calculators each discipline actually ships. */
function groupSizes(): Map<string, number> {
  const src = engCalcSource();
  const sizes = new Map<string, number>();
  for (const m of src.matchAll(/group: "([^"]+)"/g)) {
    sizes.set(m[1], (sizes.get(m[1]) ?? 0) + 1);
  }
  if (sizes.size === 0) throw new Error("no groups found — the registry changed shape");
  return sizes;
}

/** Counts a page declares, e.g. `<b>Vibration (4)</b>`. HTML-entity aware. */
function declaredCounts(html: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of html.matchAll(/<b>([A-Za-z][A-Za-z\s&;a-z]*?)\s*\((\d+)\)/g)) {
    const name = m[1].replace(/&amp;/g, "&").trim();
    out.set(name, parseInt(m[2], 10));
  }
  return out;
}

describe("every discipline's calculator count is the real one", () => {
  const sizes = groupSizes();

  test("the registry is found and has the expected shape", () => {
    // A guard that cannot find what it checks passes vacuously; fail loudly.
    expect(sizes.size).toBeGreaterThanOrEqual(8);
    const total = [...sizes.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });

  for (const page of ["landing/manual.html", "landing/tool.html"]) {
    const html = page.includes("manual") ? MANUAL : TOOLPAGE;
    const declared = declaredCounts(html);

    test(`${page} declares a count for every discipline`, () => {
      const missing = [...sizes.keys()].filter((g) => !declared.has(g));
      expect({ page, missing }).toEqual({ page, missing: [] });
    });

    test(`${page}'s counts match what ships`, () => {
      const wrong: string[] = [];
      for (const [group, n] of sizes) {
        const d = declared.get(group);
        if (d !== undefined && d !== n) wrong.push(`${group}: page says ${d}, ships ${n}`);
      }
      expect({ page, wrong }).toEqual({ page, wrong: [] });
    });

    test(`${page} declares no discipline that does not exist`, () => {
      // Only judges names that look like Engineering disciplines, so the other
      // sections of these pages are left alone.
      const stale = [...declared.keys()].filter(
        (name) => !sizes.has(name) && /solids|fatigue|fluids|thermal|electronics|control|vibration|biomedical|pharmacokinetics/i.test(name),
      );
      expect({ page, stale }).toEqual({ page, stale: [] });
    });
  }

  test("every calculator total on every page matches the registry it describes", () => {
    // Generalised past Engineering on purpose. The first version of this test
    // only knew about ENG_CALCS and flagged Finance's counts as wrong; chasing
    // that down showed README.md and FEATURES.md had been claiming Finance
    // shipped 18 calculators when it ships 19. A guard that covers one registry
    // finds bugs in the others by accident and then has to be taught to ignore
    // them, which is the wrong lesson to encode.
    const registries: Record<string, number> = {};
    for (const name of ["FIN_CALCS", "STAT_CALCS", "ANALYZE_CALCS", "ENG_CALCS", "ASSAY_CALCS"]) {
      const i = PANE.indexOf(`const ${name}`);
      expect({ name, found: i >= 0 }).toEqual({ name, found: true });
      const j = PANE.indexOf("\n];", i);
      registries[name] = [...PANE.slice(i, j).matchAll(/\bid: "[a-z0-9-]+"/g)].length;
      expect(registries[name]).toBeGreaterThan(0);
    }

    // Which registry a claim is about, judged from the words around it.
    const OWNER: [RegExp, string][] = [
      [/engineering|disciplin/i, "ENG_CALCS"],
      [/finance|amortization|TVM|Black/i, "FIN_CALCS"],
      [/statistic|stats/i, "STAT_CALCS"],
      [/analy[sz]e|workbench/i, "ANALYZE_CALCS"],
      [/assay|bio\b|curve/i, "ASSAY_CALCS"],
    ];
    const WORDS: Record<string, number> = {
      fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
      "twenty-one": 21, "thirty-six": 36, "thirty-seven": 37, "thirty-eight": 38,
    };

    const pages = [
      "landing/index.html", "landing/manual.html", "landing/science.html",
      "landing/tool.html", "README.md", "FEATURES.md",
    ];
    const wrong: string[] = [];
    const unattributed: string[] = [];
    for (const p of pages) {
      const text = read(p);
      for (const m of text.matchAll(/([A-Za-z-]+|\d+)\s+calculators/g)) {
        const raw = m[1].toLowerCase();
        const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : WORDS[raw];
        if (n === undefined) continue; // "the calculators", "these calculators"
        const from = Math.max(0, m.index! - 260);
        const ctx = text.slice(from, m.index! + 160);
        const owner = OWNER.find(([re]) => re.test(ctx));
        if (!owner) {
          unattributed.push(`${p}: "${m[0]}"`);
          continue;
        }
        if (registries[owner[1]] !== n) {
          wrong.push(`${p}: "${m[0]}" but ${owner[1]} ships ${registries[owner[1]]}`);
        }
      }
    }
    expect({ wrong, unattributed }).toEqual({ wrong: [], unattributed: [] });
  });
});

// ---------------------------------------------------------------------------
// Syntax must be documented somewhere a user can find it
// ---------------------------------------------------------------------------

describe("every beam syntax the parser accepts is documented", () => {
  /**
   * The CANONICAL support option names, read out of parseSupports itself.
   *
   * Taken from the `opts.set("x", ...)` targets rather than from the `name ===`
   * comparisons, because the latter also yields the aliases (`spring`,
   * `stiffness`, `settlement`). An alias is a convenience for someone who
   * already knows the option exists; requiring every one to be advertised would
   * clutter the docs to no benefit. What must be documented is the name a user
   * has to be told about in order to use the feature at all.
   */
  function optionNames(): string[] {
    const out = new Set<string>();
    for (const m of BEAM.matchAll(/opts\.set\("([a-z]+)"/g)) out.add(m[1]);
    return [...out];
  }

  /** The leading keyword alternations of the support and load patterns. */
  function keywordGroups(): string[][] {
    const out: string[][] = [];
    for (const m of BEAM.matchAll(/\((?:\?:)?((?:[a-z]+\|){1,}[a-z]+)\)/g)) {
      out.push(m[1].split("|"));
    }
    return out;
  }

  // Anywhere a user could reasonably find it: the in-pane examples, the pane's
  // own hint text, or either web page.
  const DOCS = [EXAMPLES, PANE, MANUAL, TOOLPAGE].join("\n");

  test("the extractors found something — this guard cannot pass vacuously", () => {
    expect(optionNames().length).toBeGreaterThanOrEqual(2);
    expect(keywordGroups().length).toBeGreaterThanOrEqual(3);
  });

  test("every support option is written down somewhere, with its equals sign", () => {
    const undocumented = optionNames().filter((n) => !DOCS.includes(`${n}=`));
    expect(undocumented).toEqual([]);
  });

  test("every support kind and load keyword appears in the docs", () => {
    // The FIRST alternative of each group is the canonical spelling; aliases are
    // conveniences and are not required to be advertised.
    const undocumented: string[] = [];
    for (const group of keywordGroups()) {
      const canonical = group[0];
      if (canonical.length < 2) continue; // single letters are aliases, not names
      if (!new RegExp(`\\b${canonical}\\b`, "i").test(DOCS)) undocumented.push(canonical);
    }
    expect(undocumented).toEqual([]);
  });

  test("the fraction form is documented, since the fields accept it", () => {
    // parseRatLiteral takes `a/b` and, as of v2.37.0, so does every beam field.
    const acceptsFractions = /\\\/|\\s\*\\\//.test(BEAM) || BEAM.includes("(?:\\s*\\/\\s*[+-]?\\d+)?");
    expect(acceptsFractions).toBe(true);
    expect(/8\/3|fraction/i.test(DOCS)).toBe(true);
  });
});
