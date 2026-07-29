// The update path must actually be able to DELIVER the update.
//
// WHY THIS EXISTS
// v2.31.5 was built, tested, pushed, and verified live on the host — and the
// user's pane still showed the previous build. Nothing was wrong with the
// release. GitHub Pages serves taskpane.html with `Cache-Control: max-age=600`,
// so for ten minutes the host answers from its own cache without asking the
// server, and `window.location.reload()` re-serves that cached copy. The cached
// HTML names the previous hashed bundle, so the pane reloaded into the exact
// build it was already running.
//
// The banner was therefore honest and useless at the same time: it correctly
// announced "update available" and its button could not deliver one. That is
// worse than no banner, because it converts a stale install into a user who has
// been told the problem is handled.
//
// These are source scans — taskpane.ts pulls in Office.js at module scope and
// cannot be imported — so they pin the SHAPE of the fix. They are deliberately
// written to fail loudly if the code they scan for disappears, so they cannot
// pass by finding nothing.

import * as fs from "fs";
import * as path from "path";

const PANE = fs
  .readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8")
  .replace(/\r\n/g, "\n");

/**
 * The body of a named function, from its declaration to the first line-start
 * `}`, with whole-line comments removed.
 *
 * The comments have to go. These functions are commented with the bug they
 * exist to prevent, so the prose explaining why `location.reload()` is wrong
 * contains the literal string `location.reload()` — and a scan that reads it
 * fails the very code that fixed the problem. Stripping only full-line comments
 * keeps this honest: it cannot mangle a URL like `https://…` inside a string,
 * which a naive "cut at //" would.
 */
function functionBody(name: string): string {
  const i = PANE.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found in taskpane.ts`);
  const end = PANE.indexOf("\n}", i);
  if (end < 0) throw new Error(`end of ${name} not found`);
  return PANE.slice(i, end)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("the scan is not vacuous", () => {
  test("both functions this suite depends on still exist", () => {
    expect(() => functionBody("checkForUpdate")).not.toThrow();
    expect(() => functionBody("showUpdateBanner")).not.toThrow();
  });

  test("the pane still checks a cache-busted version.json", () => {
    // If this ever stops being cache-busted, the check itself goes stale and
    // every test below is guarding a path that never runs.
    const body = functionBody("checkForUpdate");
    expect(body).toContain("version.json?t=");
    expect(body).toContain('cache: "no-store"');
  });
});

describe("reloading for an update cannot be served from cache", () => {
  test("the banner button does not use location.reload()", () => {
    // The precise bug. location.reload() revalidates at best and re-serves the
    // cached response at worst; within max-age it does not ask the server at
    // all.
    expect(functionBody("showUpdateBanner")).not.toContain("location.reload()");
  });

  test("the banner button navigates to a URL carrying the new version", () => {
    const body = functionBody("showUpdateBanner");
    expect(body).toContain('searchParams.set("v", newVersion)');
    expect(body).toContain("window.location.replace(");
  });

  test("the auto-heal also busts the cache rather than reloading", () => {
    const body = functionBody("checkForUpdate");
    expect(body).toContain('searchParams.set("v", data.version)');
    expect(body).toContain("window.location.replace(");
    expect(body).not.toContain("location.reload()");
  });

  test("the cache-buster is the version, not a timestamp", () => {
    // A timestamp would bust the cache on EVERY reload, permanently defeating
    // caching for a file that is otherwise fine to cache. The version busts it
    // exactly once per release, which is the whole requirement.
    const banner = functionBody("showUpdateBanner");
    expect(banner).not.toMatch(/searchParams\.set\("v",\s*(Date\.now|String\(Date)/);
  });
});

describe("the auto-reload cannot loop inside a task pane", () => {
  // The failure this guards is not theoretical and it is not recoverable by the
  // user: if version.json advertises a release the deployed bundle does not
  // contain (a half-finished deploy, a CDN mid-propagation), an unguarded
  // auto-reload sees the same mismatch every time and spins forever inside a
  // pane with no address bar and no stop button.
  const body = functionBody("checkForUpdate");

  test("the attempt is recorded before the navigation, not after", () => {
    const write = body.indexOf("sessionStorage.setItem");
    const nav = body.indexOf("window.location.replace(");
    expect(write).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(-1);
    // Recording after navigating would never execute — the navigation ends the
    // page — so the flag would never be set and every load would reload again.
    expect(write).toBeLessThan(nav);
  });

  test("the flag is keyed to the version being reloaded into", () => {
    // A boolean would suppress the auto-heal for every LATER release in the
    // same session. Keying it to the version means a genuinely new release
    // still heals itself.
    expect(body).toContain("getItem(UPDATE_RELOAD_KEY) === data.version");
    expect(body).toContain("setItem(UPDATE_RELOAD_KEY, data.version)");
  });

  test("a storage failure disables the auto-reload rather than the guard", () => {
    // Fail SAFE. If sessionStorage throws (private mode, a host that denies
    // storage), there is nothing to break a loop with, so the auto-reload must
    // be the thing that gets skipped — never the guard.
    const guard = body.slice(body.indexOf("let alreadyTried"));
    const catchAt = guard.indexOf("} catch {");
    expect(catchAt).toBeGreaterThan(-1);
    const catchBlock = guard.slice(catchAt, guard.indexOf("}", guard.indexOf("alreadyTried = true", catchAt)));
    expect(catchBlock).toContain("alreadyTried = true");
  });

  test("it still falls back to the banner when it has already tried", () => {
    // Otherwise a pane that cannot self-heal goes silent about a real update.
    expect(body).toContain("showUpdateBanner(data.version)");
    const nav = body.indexOf("window.location.replace(");
    expect(body.indexOf("showUpdateBanner(data.version)")).toBeGreaterThan(nav);
  });

  test("the guarded branch returns so the banner is not also shown", () => {
    const nav = body.indexOf("window.location.replace(");
    const after = body.slice(nav, nav + 200);
    expect(after).toContain("return;");
  });
});
