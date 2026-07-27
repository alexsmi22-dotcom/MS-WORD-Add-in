// Every library module must be reachable by a user.
//
// The product evaluation found four finished, tested modules — tukey.ts,
// fftfilter.ts, jcamp.ts and (transitively) most of the inhibition maths in
// assay.ts — shipping in every bundle with nothing able to invoke them. ANOVA had
// no post-hoc test, the FFT tool could not filter, and every Spectra caveat said
// "verify against an acquired spectrum" while the reader for one sat unwired.
//
// Nothing detected that, because unreachable code compiles, passes its own tests,
// and looks finished. This walks the import graph from the real entry points and
// fails on anything nothing can reach.
//
// Two things it must get right, both learned by getting them wrong:
//   - ppt.ts is reached only through a DYNAMIC `await import()`, so a static walk
//     false-positives on it unless dynamic imports are followed.
//   - "reachable module" is weaker than "reachable export". fitInhibition lived
//     inside assay.ts, which was very much alive, and was still unreachable.
//     Module-level reachability would not have caught it; the export check below
//     is the one that would.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..", "..");
const LIB = path.join(ROOT, "src", "lib");
const ENTRIES = [
  path.join(ROOT, "src", "taskpane", "taskpane.ts"),
  path.join(ROOT, "src", "commands", "commands.ts"),
];

/**
 * Modules that are deliberately not wired yet. Each needs a reason, so that
 * adding one is a decision rather than a shrug.
 */
// Empty, and the test below keeps it that way: an entry here is a DEBT.
// jcamp lived here until v2.19.0, when the file input and measured-trace chart
// it was waiting on were built. The entry was deleted the moment it was wired,
// which is what "still unreachable" below exists to force.
const KNOWN_UNREACHABLE: { module: string; why: string }[] = [];

function listModules(): string[] {
  return fs
    .readdirSync(LIB)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.basename(f, ".ts"));
}

/** Both static `from "..."` and dynamic `import("...")` specifiers. */
function importsOf(file: string): string[] {
  let src: string;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const re of [/from\s+["']([^"']+)["']/g, /import\s*\(\s*(?:\/\*[^*]*\*\/\s*)?["']([^"']+)["']\s*\)/g]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (m[1].startsWith(".")) out.add(path.basename(m[1]));
    }
  }
  return [...out];
}

function reachableModules(): Set<string> {
  const all = new Set(listModules());
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const e of ENTRIES) queue.push(...importsOf(e));
  while (queue.length) {
    const name = queue.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    if (all.has(name)) queue.push(...importsOf(path.join(LIB, name + ".ts")));
  }
  return seen;
}

describe("library modules are reachable from the pane", () => {
  const modules = listModules();
  const reached = reachableModules();

  test("the walk actually resolves the graph (guard against a vacuous pass)", () => {
    expect(modules.length).toBeGreaterThan(50);
    // A few that must always be reachable, spread across the suites.
    for (const m of ["stats", "assay", "citations", "dna", "plot", "tukey", "fftfilter"]) {
      expect({ m, reached: reached.has(m) }).toEqual({ m, reached: true });
    }
  });

  test("ppt.ts is reached through its dynamic import, not reported dead", () => {
    // A static-only walk gets this wrong; that mistake was made once already.
    const pane = fs.readFileSync(ENTRIES[0], "utf8");
    expect(pane).toMatch(/await import\(/);
    expect(reached.has("ppt")).toBe(true);
  });

  test("no library module is unreachable except the documented ones", () => {
    const allowed = new Set(KNOWN_UNREACHABLE.map((k) => k.module));
    const dead = modules.filter((m) => !reached.has(m) && !allowed.has(m));
    expect(dead).toEqual([]);
  });

  test("every documented exception is real, and still unreachable", () => {
    // If one gets wired, this fails and the entry must be deleted — an allowlist
    // nobody prunes stops meaning anything.
    for (const k of KNOWN_UNREACHABLE) {
      expect({ m: k.module, exists: fs.existsSync(path.join(LIB, k.module + ".ts")) }).toEqual({
        m: k.module,
        exists: true,
      });
      expect({ m: k.module, stillDead: !reached.has(k.module) }).toEqual({
        m: k.module,
        stillDead: true,
      });
      expect(k.why.length).toBeGreaterThan(40);
    }
  });
});

describe("the exports the evaluation found dead are wired", () => {
  // Module-level reachability cannot see these: they live in assay.ts and
  // tukey.ts, both reachable, and were still unreachable to a user. Pinned by
  // name so re-orphaning one fails here.
  const pane = fs.readFileSync(ENTRIES[0], "utf8");

  test.each([
    ["tukeyHSD", "ANOVA post-hoc"],
    ["fftFilter", "FFT de-noising"],
    ["fitInhibition", "Ki / inhibition mode"],
    ["lineweaverBurk", "linearized kinetics"],
    ["eadieHofstee", "linearized kinetics"],
    ["bufferRatioForPh", "buffer ratio for a target pH"],
  ])("%s is called from the pane (%s)", (fn) => {
    expect(pane.includes(fn)).toBe(true);
  });
});
