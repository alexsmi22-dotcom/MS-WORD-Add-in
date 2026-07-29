// An insert may not fail silently, and nothing it awaits may hang forever.
//
// WHY THIS EXISTS
// Reported from real use: figures missing from an inserted report, and NOTHING
// in the status area — no error, no success, no way to tell whether the click
// had registered. Two defects combine to produce exactly that, and neither was
// visible to any test:
//
//   1. insertResultBlocks guarded re-entry with a bare `return`. That is the
//      only path through it that produces no content AND no message.
//   2. svgToPngBase64 settled only from onload/onerror. A host that fires
//      neither leaves the promise pending forever, awaited by an insert holding
//      the SHARED insertTextBusy flag — which then never clears, disabling every
//      insert in the product with silence as the only symptom.
//
// The pairing is what makes it undiagnosable: the hang sticks the flag, and the
// silent return hides the consequence. So both are pinned here.
//
// Source scans — taskpane.ts imports Office.js at module scope and cannot be
// loaded in jest — written to fail loudly if what they scan for disappears.

import * as fs from "fs";
import * as path from "path";

const PANE = fs
  .readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8")
  .replace(/\r\n/g, "\n");

/** Source with whole-line comments removed, so prose never satisfies a scan. */
const CODE = PANE.split("\n")
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

describe("the scan is not vacuous", () => {
  test("the busy flag and the rasteriser both still exist", () => {
    expect(CODE).toContain("insertTextBusy");
    expect(CODE).toContain("function svgToPngBase64(");
  });

  test("more than one insert path shares the busy flag", () => {
    // The blast radius is the reason this matters: a stuck flag is not one
    // broken button. If this ever drops to a single site the suite is
    // over-claiming and should be rewritten, not silently weakened.
    const sets = CODE.split("insertTextBusy = true").length - 1;
    expect(sets).toBeGreaterThanOrEqual(3);
  });
});

describe("no insert path refuses silently", () => {
  test("every busy-flag guard reports to the user", () => {
    // Find each `if (insertTextBusy)` and require a setStatus before its close.
    const offenders: string[] = [];
    const re = /if \(insertTextBusy\)([\s\S]{0,200})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(CODE)) !== null) {
      const tail = m[1];
      const block = tail.slice(0, tail.indexOf("}") + 1);
      if (!block.includes("setStatus")) {
        offenders.push(block.replace(/\s+/g, " ").slice(0, 60));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the guard is never a bare return", () => {
    // The precise shape of the bug, pinned so a refactor cannot reintroduce it.
    expect(CODE).not.toMatch(/if \(insertTextBusy\)\s*return;/);
  });

  test("the flag is always released in a finally", () => {
    // A throw that skips the release turns one failed insert into a permanently
    // dead button — the same silence by a different route.
    const releases = CODE.split("insertTextBusy = false").length - 1;
    const claims = CODE.split("insertTextBusy = true").length - 1;
    expect(releases).toBeGreaterThanOrEqual(claims);
    expect(CODE).toContain("} finally {");
  });
});

describe("rasterising a figure cannot hang forever", () => {
  const body = (() => {
    const i = CODE.indexOf("function svgToPngBase64(");
    expect(i).toBeGreaterThan(-1);
    return CODE.slice(i, CODE.indexOf("\n}", i));
  })();

  test("there is a timeout, not just onload and onerror", () => {
    expect(body).toContain("setTimeout(");
    expect(body).toMatch(/onload/);
    expect(body).toMatch(/onerror/);
  });

  test("the timeout rejects rather than resolving with nothing", () => {
    // Resolving with "" would hand Word an empty picture payload and turn a
    // diagnosable failure into a mystery, which is the whole problem here.
    const timer = body.slice(body.indexOf("setTimeout("));
    expect(timer.slice(0, 200)).toContain("reject(");
  });

  test("the timer is cleared on the success path", () => {
    // Otherwise a slow-but-successful rasterisation rejects a promise that has
    // already resolved, and every large figure reports a spurious failure.
    expect(body).toContain("clearTimeout(");
  });

  test("the promise cannot settle twice", () => {
    // resolve/reject after settlement is a silent no-op, so a double-settle bug
    // is invisible at runtime; pin the guard instead.
    expect(body).toMatch(/\bsettled\b/);
    expect(body).toMatch(/if \(settled\) return;/);
  });

  test("every settle route goes through the single guard", () => {
    // If a handler calls resolve/reject directly, it bypasses clearTimeout and
    // the timer fires later against an already-settled promise.
    expect(body).toContain("img.onload = () => {");
    expect(body).toContain("done(");
    const onerror = body.slice(body.indexOf("img.onerror"));
    expect(onerror.slice(0, 120)).toContain("done(");
  });
});

describe("a successful insert says what it put in the document", () => {
  test("the success message reports the figure count", () => {
    // "Inserted." is true of a report that arrived without its diagram. Naming
    // the count makes the pane's belief checkable against the page.
    expect(CODE).toContain("figureCount");
    expect(CODE).toMatch(/figure\$\{figureCount === 1 \? "" : "s"\}/);
  });

  test("the count comes from what was actually rasterised", () => {
    // Counting the plot BLOCKS would report figures the pane never managed to
    // render, which is the opposite of the point.
    expect(CODE).toContain("Object.keys(images).length");
  });
});
