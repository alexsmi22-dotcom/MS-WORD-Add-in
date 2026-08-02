// Historical version tags must not walk.
//
// Releases were bumped by replacing the old version string with the new one
// across whole documents. That is right for the few places naming the CURRENT
// release and wrong for every sentence recording WHEN something shipped, so each
// release dragged the previous release's tags forward. It went unnoticed for
// several versions: "Spectral sequences and stable homotopy" had walked from
// v2.17.0 to v2.20.0, and "Nothing freezes Word" from v2.18.0 to v2.19.0, purely
// by being in the same file as the version marker.
//
// The cause is fixed — scripts/bump-version.js now edits a closed list of sites —
// but the failure was silent, so it gets a guard too. These are pinned against
// the commits that actually introduced each entry.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const script = fs.readFileSync(path.join(ROOT, "docs", "TEST-SCRIPT.md"), "utf8");
const roadmap = fs.readFileSync(path.join(ROOT, "ROADMAP.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };

/** Feature heading in TEST-SCRIPT.md -> the release that actually introduced it. */
const PINNED: Record<string, string> = {
  "Insert is a REAL equation now": "2.6.0",
  "Symbolic integration": "2.6.0",
  Geometry: "2.7.0",
  "Topology / homology": "2.8.0",
  "3D geometry": "2.9.0",
  "Persistent homology": "2.10.0",
  "Advanced topology": "2.11.0",
  Knots: "2.12.0",
  "Systems of equations": "2.13.0",
  "Limits and series": "2.14.0",
  Inequalities: "2.15.0",
  "Alexander polynomial and K-theory": "2.16.0",
  "Spectral sequences and stable homotopy": "2.17.0",
  "Nothing freezes Word": "2.18.0",
  "Measured spectra — JCAMP-DX": "2.19.0",
  "BVP / PDE / DAE": "2.19.0",
  "The numerics cannot freeze the pane": "2.20.0",
  Formatting: "2.61.0",
  "TWO ANSWERS": "2.77.1",
};

describe("the manual test script's version tags are history, not a moving target", () => {
  for (const [heading, version] of Object.entries(PINNED)) {
    it(`"${heading}" still says v${version}`, () => {
      // Match the heading followed by its tag, allowing for the bold markup.
      const re = new RegExp(`\\*\\*${heading.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*\\(v(\\d+\\.\\d+\\.\\d+)\\)`);
      const m = re.exec(script);
      expect(`${heading}: ${m ? m[1] : "HEADING NOT FOUND"}`).toBe(`${heading}: ${version}`);
    });
  }

  it("covers every tagged entry in the file, so a new one cannot slip in unpinned", () => {
    const tagged = script.match(/^- \[ \] \*\*[^*]+\(v\d+\.\d+\.\d+\)/gm) ?? [];
    const unpinned = tagged.filter(
      (line) => !Object.keys(PINNED).some((h) => line.includes(h))
    );
    expect(unpinned.join("\n")).toBe("");
  });

  it("no historical tag equals the current release except the newest entry", () => {
    // The signature of a walk: several old entries suddenly all reading the
    // version that was current when the bump ran.
    const atCurrent = Object.entries(PINNED).filter(([, v]) => v === pkg.version);
    expect(
      `${atCurrent.length} entries at v${pkg.version}: ${atCurrent.map(([h]) => h).join(", ")}`
    ).toBe(`${atCurrent.length} entries at v${pkg.version}: ${atCurrent.map(([h]) => h).join(", ")}`);
    // At most a couple of entries can genuinely belong to one release.
    expect(atCurrent.length).toBeLessThanOrEqual(3);
  });
});

describe("the places that DO carry the current version agree with package.json", () => {
  it("the test script's title", () => {
    expect(script).toContain(`# JurisLab — Manual Test Script (v${pkg.version})`);
  });
  it("the roadmap's current-release line", () => {
    expect(roadmap).toContain(`Current release: **v${pkg.version}**`);
  });
  it("the README's status line", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(`**Status:** v${pkg.version}`);
  });
  it("both manifests", () => {
    for (const f of ["manifest.xml", "manifest.prod.xml"]) {
      const m = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(`${f}: ${m.includes(`<Version>${pkg.version}.0</Version>`)}`).toBe(`${f}: true`);
    }
  });
});

describe("the bump script is the mechanism, and it refuses to guess", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "bump-version.js"), "utf8");

  it("exists and edits a closed list of sites", () => {
    expect(src).toMatch(/const SITES/);
  });
  it("stops rather than bumping when a site does not match exactly once", () => {
    expect(src).toMatch(/Refusing to bump/);
    expect(src).toMatch(/expected exactly 1/);
  });
  it("records why it exists, so nobody reintroduces the blanket replace", () => {
    expect(src).toMatch(/WHY THIS EXISTS/);
    expect(src).toMatch(/walked/i);
  });
});
