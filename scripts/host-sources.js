/* eslint-disable no-undef */
// The source files that may talk to Word: the pane, plus the host layer it
// delegates to (src/host, docs/SCOPE-HOST-ADAPTER.md).
//
// WHY ONE HELPER. The audit harnesses derive the Word enums their stubs must
// carry from the source, because a stub missing `Word.RangeLocation.after`
// once made every tool read as broken. They read taskpane.ts alone. The moment
// a document batch moved to src/host, an enum used only there would have gone
// missing from every stub, and the audits would have reported a product-wide
// catastrophe that was really the harness. Every reader goes through here.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/** Absolute paths: taskpane.ts first, then src/host/*.ts in name order. */
function hostSourceFiles() {
  const files = [path.join(ROOT, "src", "taskpane", "taskpane.ts")];
  const hostDir = path.join(ROOT, "src", "host");
  if (fs.existsSync(hostDir)) {
    for (const f of fs.readdirSync(hostDir).sort()) {
      if (f.endsWith(".ts")) files.push(path.join(hostDir, f));
    }
  }
  return files;
}

/** Every file above, concatenated. */
function hostSourceText() {
  return hostSourceFiles()
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
}

module.exports = { hostSourceFiles, hostSourceText };
