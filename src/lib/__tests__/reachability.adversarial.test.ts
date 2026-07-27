// Can a user actually GET to this code?
//
// Two separate incidents motivated this file, and neither showed up in any
// engine's own test suite, because a unit test imports the thing it tests and
// therefore can never notice that nothing else does:
//
//   alexander.ts   fully implemented, 40 passing tests, and unreachable from
//                  the pane for a whole release because its routing regex
//                  contained a literal backspace character.
//   jcamp.ts       a complete JCAMP-DX spectrum reader, committed as "open a
//                  real spectrum (punch list #17)", with its own tests — and
//                  imported by NOTHING. No pane import, no file input that
//                  accepts .jdx. It has never been runnable by a user.
//
// A module that nothing imports is not necessarily a bug — but it is never
// what anyone intended either, so it has to be declared rather than discovered.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const LIB = path.join(ROOT, "lib");

/**
 * Modules that are deliberately not wired, with the reason. Anything here is a
 * KNOWN GAP, not an accident — and moving one out of this list (by wiring it up)
 * is the fix, not adding to the list.
 */
const KNOWN_UNWIRED: Record<string, string> = {
  jcamp:
    "Complete JCAMP-DX reader with tests, never connected to the UI. Nothing " +
    "imports it and no file input accepts .jdx/.dx, so a user cannot reach it. " +
    "Wiring it needs a file input plus a handler that renders the spectrum.",
};

const read = (p: string) => fs.readFileSync(p, "utf8");

const allFiles = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|__tests__/.test(e.name)) continue;
      allFiles(f, out);
    } else if (/\.(ts|html)$/.test(e.name)) {
      out.push(f);
    }
  }
  return out;
};

describe("every lib module is reachable from something a user can run", () => {
  const modules = fs
    .readdirSync(LIB)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.replace(/\.ts$/, ""));

  // Everything outside the test tree: the pane, the commands, and the other
  // lib modules. If none of them mention a module, nothing can run it.
  const consumers = allFiles(ROOT).filter((f) => !/__tests__/.test(f));

  const importedBy = (mod: string): string[] =>
    consumers.filter((f) => {
      if (path.basename(f) === mod + ".ts") return false;
      const src = read(f);
      return (
        new RegExp(`from ["'].*/${mod}["']`).test(src) ||
        new RegExp(`from ["']\\./${mod}["']`).test(src) ||
        new RegExp(`require\\(["'].*${mod}["']\\)`).test(src) ||
        // Lazily loaded for code splitting — ppt is pulled in this way, and a
        // dynamic import is every bit as reachable as a static one.
        new RegExp(`import\\([^)]*["'][^"']*${mod}["']\\)`).test(src)
      );
    });

  it("finds the module list", () => {
    expect(modules.length).toBeGreaterThan(50);
    expect(consumers.length).toBeGreaterThan(50);
  });

  for (const mod of modules) {
    it(`${mod} is imported by something outside its own tests`, () => {
      const users = importedBy(mod);
      const known = KNOWN_UNWIRED[mod];
      if (known) {
        // Declared gap. When someone wires it, this flips and the entry must go.
        expect(
          `${mod}: ${users.length ? "NOW WIRED — remove it from KNOWN_UNWIRED" : "unwired as declared"}`
        ).toBe(`${mod}: unwired as declared`);
        return;
      }
      expect(`${mod}: ${users.length ? "reachable" : "IMPORTED BY NOTHING"}`).toBe(`${mod}: reachable`);
    });
  }

  it("the known-gap list is documented, not just a list of names", () => {
    for (const [mod, why] of Object.entries(KNOWN_UNWIRED)) {
      expect(`${mod}: ${why.length > 60 ? "explained" : "TOO TERSE"}`).toBe(`${mod}: explained`);
    }
  });
});
