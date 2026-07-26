// The install packs users actually download were checked by nothing.
//
// WHY THIS EXISTS
// install/formula-inserter-windows.zip and install/formula-inserter-mac.zip are
// committed to the repo and linked from landing/manual.html — they are the files
// a non-technical user double-clicks. manifestVersion.test.ts looked like it
// covered them, but it inspects `release/`, which is gitignored: on a CI checkout
// those paths do not exist, the test's `if (v !== null)` guard skips every one,
// and it passes having verified nothing. The only artifact a user ever touches
// was the only one with no gate on it.
//
// A stale pack is not cosmetic. The pack carries the manifest that Word
// registers, so shipping one built before a rename or a URL change hands the
// user an add-in that loads the wrong thing — and the version label is how
// anyone would ever notice.
//
// These read the zips as bytes, so they check what actually ships rather than
// the loose files a pack was supposedly built from.

import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";

const ROOT = path.join(__dirname, "..", "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  version: string;
};

/** The packs committed to the repo, i.e. the ones a user can download today. */
const PACKS = ["install/formula-inserter-windows.zip", "install/formula-inserter-mac.zip"];

/** Reads one file out of a zip as text, or null when it is absent. */
async function readFromZip(zipPath: string, name: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  // Match on basename so a pack that nests its files still resolves.
  const entry = Object.values(zip.files).find(
    (f) => !f.dir && path.posix.basename(f.name) === name,
  );
  return entry ? entry.async("string") : null;
}

describe("the downloadable install packs are not stale", () => {
  test.each(PACKS)("%s exists and is committed", (p) => {
    // Not an "if present" check. These are tracked files; an absent one means a
    // release deleted the thing the manual links to.
    expect(fs.existsSync(path.join(ROOT, p))).toBe(true);
  });

  test.each(PACKS)("%s ships a manifest matching package.json", async (p) => {
    const xml = await readFromZip(path.join(ROOT, p), "manifest.xml");
    expect(xml).not.toBeNull();
    const m = /<Version>([^<]*)<\/Version>/.exec(xml!);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(`${pkg.version}.0`);
  });

  test.each(PACKS)("%s ships the PROD manifest, not the localhost one", async (p) => {
    // manifest.xml is the dev manifest at the repo root and the prod manifest
    // inside a pack — same filename, opposite meaning. Packing the wrong one
    // yields an add-in that loads nothing outside a dev machine, and the version
    // check above would not notice because both carry the same number.
    const xml = await readFromZip(path.join(ROOT, p), "manifest.xml");
    expect(xml).not.toBeNull();
    expect(xml).not.toContain("localhost:3000");
    expect(xml).toContain("alexsmi22-dotcom.github.io");
  });

  test.each(PACKS)("%s bundles the current FEATURES.md", async (p) => {
    // The packs carry a copy of FEATURES.md. A pack rebuilt without refreshing it
    // ships a feature list describing an older release — the pack would pass a
    // version check while its documentation silently lagged.
    const packed = await readFromZip(path.join(ROOT, p), "FEATURES.md");
    if (packed === null) return; // A pack is allowed not to bundle it at all.
    const repo = fs.readFileSync(path.join(ROOT, "FEATURES.md"), "utf8");
    // Normalise line endings: the mac and windows packs are zipped on different
    // paths and the difference is not staleness.
    const norm = (t: string) => t.replace(/\r\n/g, "\n").trimEnd();
    expect(norm(packed)).toBe(norm(repo));
  });
});
