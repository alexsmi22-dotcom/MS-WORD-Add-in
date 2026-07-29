// Every CSS variable the pane uses must actually be defined.
//
// WHY THIS EXISTS
// The Engineering panels shipped with `background: var(--hover, #f3f4f6)`.
// `--hover` is defined nowhere in this stylesheet, so the fallback was used
// unconditionally — a hardcoded light grey. In Word's dark theme that put
// near-white text (`--ink`) on a near-white background, and the selected tool
// became unreadable on hover. Reported from real use.
//
// The failure mode is the one this whole codebase keeps meeting: CSS does not
// error on an undefined variable. With a fallback it silently uses a constant
// that ignores the theme; without one the declaration is dropped and the element
// simply has no background. Both look fine in whichever theme the author had
// open, and wrong in the other.
//
// The same scan found `var(--bg)` used twice with no fallback and no
// definition — a pre-existing bug in two chip styles, fixed alongside.

import * as fs from "fs";
import * as path from "path";

const CSS = fs.readFileSync(
  path.join(__dirname, "..", "..", "taskpane", "taskpane.css"),
  "utf8",
);

/** Every custom property this stylesheet defines, anywhere (any theme block). */
function defined(): Set<string> {
  return new Set([...CSS.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1].toLowerCase()));
}

/** Every custom property this stylesheet reads. */
function used(): string[] {
  return [...CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1].toLowerCase());
}

describe("the scan is not vacuous", () => {
  test("the stylesheet was found and defines variables", () => {
    expect(CSS.length).toBeGreaterThan(1000);
    expect(defined().size).toBeGreaterThan(10);
  });

  test("it finds variable usages too", () => {
    expect(used().length).toBeGreaterThan(10);
  });

  test("the check would catch an undefined variable", () => {
    // Negative control: the predicate must actually trip. A gate nobody has
    // watched fail is not evidence.
    const d = new Set(["--real"]);
    const u = ["--real", "--phantom"];
    expect(u.filter((x) => !d.has(x))).toEqual(["--phantom"]);
  });
});

describe("no CSS variable is used without being defined", () => {
  test("every var(--x) resolves to a real declaration", () => {
    const d = defined();
    const missing = [...new Set(used().filter((u) => !d.has(u)))];
    // Named explicitly so the failure says WHICH variable, not just a count.
    expect(missing).toEqual([]);
  });

  test("no hardcoded fallback smuggles a fixed colour past the theme", () => {
    // `var(--x, #fff)` is how the hover bug hid: the fallback looks like
    // defensive coding and is actually a theme-blind constant. A fallback is
    // only honest when the variable exists and may legitimately be unset.
    const d = defined();
    const offenders = [...CSS.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,\s*([^)]+)\)/gi)]
      .filter((m) => !d.has(m[1].toLowerCase()))
      .map((m) => `${m[1]} -> ${m[2].trim()}`);
    expect(offenders).toEqual([]);
  });
});
