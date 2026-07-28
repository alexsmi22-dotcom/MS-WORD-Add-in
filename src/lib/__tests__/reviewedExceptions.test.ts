// The compound verifier's reviewed-exception list must not rot.
//
// This is the adversarial half of that mechanism, and it was missing: the
// exception behaviour was proved by hand with a throwaway probe and nothing
// permanent held it. That matters more now the check is a QC gate, because an
// exception is a standing licence for one compound to disagree with PubChem.
//
// THE PROPERTY BEING PROTECTED. Each exception is pinned to the exact SMILES it
// was reviewed against, so editing that compound expires the pin and it flags
// again. A pin that no longer matches the dictionary is therefore not merely
// untidy — it is either a compound someone changed without re-reviewing, or a
// blessing for a structure that no longer exists. Both should be loud, and both
// are cheap to detect here rather than only at the next gate run.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..", "..");
const VERIFIER = path.join(ROOT, "scripts", "verify-compounds-pubchem.mjs");
const DICT = path.join(ROOT, "src", "lib", "compounds.json");

interface Exception {
  name: string;
  ours: string;
}

/** Pulls the REVIEWED entries out of the verifier source. */
function reviewedEntries(): Exception[] {
  const src = fs.readFileSync(VERIFIER, "utf8");
  const start = src.indexOf("const REVIEWED = [");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\nconst reviewedFor", start);
  expect(end).toBeGreaterThan(start);
  const block = src.slice(start, end);

  const out: Exception[] = [];
  // Each entry is `name: "...",` followed somewhere by `ours: "..."` (which may
  // be split across lines by the formatter).
  const re = /name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*ours:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out.push({ name: m[1], ours: m[2].replace(/\\\\/g, "\\") });
  }
  return out;
}

function dictionary(): Record<string, string> {
  return JSON.parse(fs.readFileSync(DICT, "utf8")).names as Record<string, string>;
}

describe("the reviewed-exception list is well formed", () => {
  test("entries were found at all — the parser must not silently match nothing", () => {
    // A regex that stops matching would make every assertion below vacuously
    // true, which is the failure mode this whole file exists to prevent.
    expect(reviewedEntries().length).toBeGreaterThanOrEqual(10);
  });

  test("no compound is excepted twice", () => {
    const names = reviewedEntries().map((e) => e.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect({ dupes }).toEqual({ dupes: [] });
  });

  test("every exception carries a substantive reason", () => {
    const src = fs.readFileSync(VERIFIER, "utf8");
    const block = src.slice(src.indexOf("const REVIEWED = ["), src.indexOf("\nconst reviewedFor"));
    const reasons = [...block.matchAll(/reason:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThanOrEqual(reviewedEntries().length);
    // "ok" or "known" is not a reason. Each must say WHY, so the next reader can
    // disagree with it.
    for (const r of reasons) expect({ reason: r, longEnough: r.length >= 40 }).toEqual({ reason: r, longEnough: true });
  });
});

describe("every exception still corresponds to the dictionary", () => {
  test("the excepted name exists", () => {
    const names = dictionary();
    for (const e of reviewedEntries()) {
      expect({ name: e.name, present: Object.prototype.hasOwnProperty.call(names, e.name) }).toEqual({
        name: e.name,
        present: true,
      });
    }
  });

  // THE LOAD-BEARING ONE. If this fails, someone edited a compound that carried
  // an exception. The exception no longer applies — which the verifier handles
  // correctly by flagging it — but the list should be corrected rather than left
  // pointing at a structure that is gone.
  test("the pinned structure still matches the dictionary exactly", () => {
    const names = dictionary();
    for (const e of reviewedEntries()) {
      expect({ name: e.name, pinMatches: names[e.name] === e.ours }).toEqual({
        name: e.name,
        pinMatches: true,
      });
    }
  });
});

describe("QC can never reach the network through this check", () => {
  test("the npm script QC runs passes --offline", () => {
    // The gate runs on every release, and this product's core promise is that
    // it works with no connection. If the flag were dropped, adding one new
    // compound would put a live PubChem fetch inside QC.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["verify:compounds"]).toContain("--offline");
  });

  test("the verifier honours the flag by refusing rather than fetching", () => {
    const src = fs.readFileSync(VERIFIER, "utf8");
    expect(src).toContain('const OFFLINE = process.argv.includes("--offline")');
    // The refusal must come BEFORE the fetch loop, or the flag is decorative.
    const guard = src.indexOf("todo.length && OFFLINE");
    const fetchLoop = src.indexOf("Fetching ${todo.length} names from PubChem");
    expect(guard).toBeGreaterThan(-1);
    expect(fetchLoop).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fetchLoop);
  });
});
