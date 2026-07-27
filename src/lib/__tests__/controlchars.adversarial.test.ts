// A guard against a silent, invisible class of damage.
//
// /\balexander\b/ shipped in v2.16.0 with the two backslash-b sequences
// replaced by literal BACKSPACE characters (0x08). It looks correct in an
// editor, tsc accepts it, eslint accepts it, and the regex can never match —
// so the Alexander polynomial was unreachable and every question about it was
// quietly answered with the Jones polynomial instead.
//
// The cause was a shell eating the backslashes on the way into the file. That
// will happen again; this test makes it loud when it does. Any of these
// characters appearing raw in source is, in practice, always an escape that
// did not survive: \a \b \v \f \e.
//
// Word's own control characters are the one legitimate use — Office.js returns
// 0x07 as a table cell terminator — so test FIXTURES may contain 0x07. Nothing
// else may contain anything.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..");

const NAMES: Record<number, string> = {
  0: "NUL",
  7: "BELL (an eaten \\a — or a deliberate Word cell terminator)",
  8: "BACKSPACE (an eaten \\b — a word-boundary regex that can never match)",
  11: "VERTICAL TAB (an eaten \\v)",
  12: "FORM FEED (an eaten \\f)",
  27: "ESCAPE (an eaten \\e)",
};

const sources = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|\.git|dist|coverage/.test(e.name)) continue;
      sources(f, out);
    } else if (/\.(ts|tsx|js)$/.test(e.name)) {
      out.push(f);
    }
  }
  return out;
};

const scan = (file: string, allowed: number[]) => {
  const s = fs.readFileSync(file, "utf8");
  const found: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!(c in NAMES) || allowed.includes(c)) continue;
    const line = s.slice(0, i).split("\n").length;
    found.push(`${path.relative(ROOT, file)}:${line} — ${NAMES[c]}`);
  }
  return found;
};

describe("no source file contains a control character an escape should have produced", () => {
  const files = sources(ROOT);

  it("finds source files to check at all", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("implementation files are completely clean", () => {
    const impl = files.filter((f) => !/__tests__/.test(f));
    const bad = impl.flatMap((f) => scan(f, []));
    expect(bad.join("\n")).toBe("");
  });

  it("test files are clean apart from deliberate Word cell terminators", () => {
    const tests = files.filter((f) => /__tests__/.test(f));
    // 0x07 is what Office.js actually hands back at a table cell boundary, so a
    // fixture that exercises the stripping of it has to contain the real thing.
    const bad = tests.flatMap((f) => scan(f, [7]));
    expect(bad.join("\n")).toBe("");
  });

  it("the specific regex that broke is intact and matches", () => {
    // Guard the fix directly, so nobody reintroduces it by hand.
    const src = fs.readFileSync(path.join(ROOT, "lib", "homology.ts"), "utf8");
    expect(src).toContain("/alexander/.test(lower)");
    expect(/alexander/.test("alexander trefoil")).toBe(true);
  });
});
