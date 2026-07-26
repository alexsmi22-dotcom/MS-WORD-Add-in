/* eslint-disable no-undef */
// How many tools ship — derived from the one list, never typed by hand.
//
// WHY THIS EXISTS
// render-check.js asserted `tiles >= 22`, `total >= 22` and `dd >= 23` while 25
// tools shipped, with the failure text still reading "expected all 22". A floor
// only catches a catastrophe: three tools could have vanished from the Home grid
// and the dropdown and the gate would have stayed green. Meanwhile the doc-rot
// test asserted EXACT equality against this same source, so the two gates
// disagreed about how many tools exist and the weaker one guarded the product.
//
// modes.ts is pure data with no Office.js imports, specifically so it can be read
// like this (see its header comment). render-check runs as plain CommonJS before
// any TypeScript build step exists, so the array is parsed out of the source
// rather than imported — the same approach phase6.adversarial.test.ts uses.

const fs = require("fs");
const path = require("path");

const MODES_TS = path.join(__dirname, "..", "src", "lib", "modes.ts");

/** Every shipping tool id, excluding "home" (a page, not a tool). */
function toolModes() {
  const src = fs.readFileSync(MODES_TS, "utf8");
  const block = /export const ALL_MODES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!block) {
    throw new Error(
      "tool-count.js could not find ALL_MODES in src/lib/modes.ts. " +
        "If that array was renamed or reformatted, update this parser — do NOT " +
        "hardcode a number here, which is the drift this file exists to stop.",
    );
  }
  const modes = [...block[1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
  if (modes.length < 2) throw new Error("ALL_MODES parsed as " + modes.length + " entries — parser is wrong");
  return modes.filter((m) => m !== "home");
}

const MODES = toolModes();

// Exported as an object, not a bare number. A `Number` wrapper could carry the
// mode list but would fail every `!==` comparison in the gates that consume it,
// which is the precise class of silent-pass this file exists to prevent.
module.exports = { count: MODES.length, modes: MODES };
