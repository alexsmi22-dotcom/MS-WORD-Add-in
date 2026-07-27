#!/usr/bin/env node
/**
 * Bump the release version.
 *
 *   node scripts/bump-version.js 2.21.0
 *
 * WHY THIS EXISTS. Releases were bumped by hand with a blanket "replace the old
 * version string with the new one" across whole documents. That is correct for
 * the handful of places that name the CURRENT release, and wrong for every
 * sentence that records WHEN something shipped — so each release quietly dragged
 * the previous release's tags forward with it. Two entries in TEST-SCRIPT.md had
 * walked several versions before anyone noticed: "Spectral sequences and stable
 * homotopy" (really v2.17.0) and "Nothing freezes Word" (really v2.18.0).
 *
 * So this touches an explicit, closed list of sites and nothing else. A line
 * like "- [ ] **Knots (v2.12.0).**" is history and is never rewritten.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error("Usage: node scripts/bump-version.js <major.minor.patch>");
  process.exit(1);
}

const pkgPath = path.join(ROOT, "package.json");
const current = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
if (current === next) {
  console.error(`package.json is already at ${next}.`);
  process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CUR = esc(current);

/**
 * Each entry names ONE place that legitimately carries the current version.
 * `find` must match exactly once; anything else means the file changed shape and
 * the bump stops rather than guessing.
 */
const SITES = [
  { file: "package.json", find: new RegExp(`("version"\\s*:\\s*")${CUR}(")`), to: `$1${next}$2` },
  { file: "manifest.xml", find: new RegExp(`(<Version>)${CUR}\\.0(</Version>)`), to: `$1${next}.0$2` },
  { file: "manifest.prod.xml", find: new RegExp(`(<Version>)${CUR}\\.0(</Version>)`), to: `$1${next}.0$2` },
  { file: "README.md", find: new RegExp(`(\\*\\*Status:\\*\\* v)${CUR}`), to: `$1${next}` },
  { file: "ROADMAP.md", find: new RegExp(`(Current release: \\*\\*v)${CUR}(\\*\\*)`), to: `$1${next}$2` },
  { file: "docs/TEST-SCRIPT.md", find: new RegExp(`(# JurisLab — Manual Test Script \\(v)${CUR}(\\))`), to: `$1${next}$2` },
];

const problems = [];
const planned = [];

for (const site of SITES) {
  const p = path.join(ROOT, site.file);
  if (!fs.existsSync(p)) {
    problems.push(`${site.file}: file not found`);
    continue;
  }
  const body = fs.readFileSync(p, "utf8");
  const hits = body.match(new RegExp(site.find.source, "g"));
  if (!hits) {
    problems.push(`${site.file}: no site matched — expected one carrying v${current}`);
  } else if (hits.length > 1) {
    problems.push(`${site.file}: ${hits.length} sites matched, expected exactly 1`);
  } else {
    planned.push({ p, file: site.file, body, next: body.replace(site.find, site.to) });
  }
}

if (problems.length) {
  console.error("Refusing to bump — the documents are not in the expected shape:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}

for (const c of planned) {
  fs.writeFileSync(c.p, c.next);
  console.log(`  ${c.file}`);
}
console.log(`\nBumped ${current} -> ${next} across ${planned.length} sites.`);
console.log("Historical version tags were NOT touched — that is the point of this script.");
console.log("\nNext: regenerate the install packs, then run npm run qc.");
