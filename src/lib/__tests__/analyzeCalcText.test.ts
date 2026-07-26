// A calculator must not lose its Insert button to a punctuation mark.
//
// formatNum() renders Infinity/NaN as an em dash (linalg.ts:73), and the Analyze
// reader blocks insertion when the result text contains one — a whole-text scan.
// That is a good guard against a NaN reaching the document and a bad guard
// against prose: an em dash used as ordinary punctuation anywhere in a
// calculator's output silently disables Insert AND suppresses the rich preview,
// so plots vanish and the reader falls back to plain text.
//
// Found by wiring the FFT filter, whose own prose and whose module caveats both
// used em dashes. Nothing failed; the plot simply did not appear.

import * as fs from "fs";
import * as path from "path";

const PANE = fs.readFileSync(
  path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"),
  "utf8",
);

const EM_DASH = "—";
/** How the em dash is written in the source: the literal, or the \u escape. */
const EM_PATTERNS = [EM_DASH, "\\u2014"];

function arraySource(name: string): string {
  const start = PANE.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`${name} not found in taskpane.ts`);
  const end = PANE.indexOf("\n];", start);
  if (end < 0) throw new Error(`end of ${name} not found`);
  return PANE.slice(start, end);
}

/** Entries of a calculator registry, sliced at each `id: "..."`. */
function entries(name: string): { id: string; body: string }[] {
  const src = arraySource(name);
  const out: { id: string; body: string }[] = [];
  const re = /\bid: "([a-z0-9-]+)",/g;
  const hits: { id: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) hits.push({ id: m[1], at: m.index });
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].at : src.length;
    out.push({ id: hits[i].id, body: src.slice(hits[i].at, end) });
  }
  return out;
}

describe("the em-dash sentinel hazard is contained", () => {
  test("the guard still works the way this test assumes", () => {
    // If the reader stops scanning text for the sentinel, this test is obsolete
    // rather than wrong — so pin the line it is defending against.
    expect(PANE).toContain('!out.text.includes("');
    expect(PANE).toContain("HAZARD, learned the hard way");
  });

  test("formatNum still uses the em dash as its non-finite sentinel", () => {
    const linalg = fs.readFileSync(path.join(__dirname, "..", "linalg.ts"), "utf8");
    expect(linalg).toContain("if (!Number.isFinite(x)) return");
    expect(linalg).toContain(EM_DASH);
  });

  /**
   * Lines that can reach an INSERTABLE result. Excluded, because none of them
   * can:
   *   - comments
   *   - `hint:` and `label:` — pane chrome, never part of out.text
   *   - anything returning `ok: false` — already blocked from insertion, so the
   *     sentinel scan is moot there (the ODE solver's "this system looks stiff"
   *     message is one of these, and is fine as written)
   */
  function insertableLines(body: string): string[] {
    const lines = body.split("\n");
    const keep: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
      if (/^(hint|label):/.test(t)) continue;
      if (t.includes("ok: false")) continue;
      // A line whose em dash is the ARGUMENT to a replace() is removing the
      // sentinel, not emitting it.
      if (/replace\(\s*\/\\u2014/.test(t)) continue;
      // A multi-line error return puts `ok: false` on a LATER line than its
      // text, so a per-line test misses it — the ODE solver's "never reached
      // zero over t ∈ […]" message is exactly that shape and is fine as written.
      let isErrorReturn = false;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const u = lines[j].trim();
        if (u.includes("ok: false")) { isErrorReturn = true; break; }
        if (u === "};" || u === "}," || u.startsWith("return ")) break;
      }
      if (isErrorReturn) continue;
      keep.push(lines[i]);
    }
    return keep;
  }

  test("no Analyze calculator emits an em dash into an insertable result", () => {
    const offenders: string[] = [];
    for (const e of entries("ANALYZE_CALCS")) {
      for (const line of insertableLines(e.body)) {
        for (const pat of EM_PATTERNS) {
          if (line.includes(pat)) {
            offenders.push(`${e.id}: ${line.trim().slice(0, 80)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no Stats calculator emits an em dash into an insertable result", () => {
    // This guard covered ANALYZE_CALCS only, which is why the v2.2.0 regression
    // caveats shipped with em dashes and silently disabled "Insert result" on a
    // perfectly valid fit. A documented trap that has caught someone should be
    // an enforced one.
    const offenders: string[] = [];
    for (const e of entries("STAT_CALCS")) {
      for (const line of insertableLines(e.body)) {
        // A line that CALLS plainDashes is removing the sentinel, not emitting it.
        if (line.includes("plainDashes")) continue;
        for (const pat of EM_PATTERNS) {
          if (line.includes(pat)) offenders.push(`${e.id}: ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the Stats scan actually reads the registry (guard against a vacuous pass)", () => {
    const ids = entries("STAT_CALCS").map((e) => e.id);
    expect(ids).toContain("multiregress");
    expect(ids).toContain("dunnett");
    expect(ids).toContain("descriptive");
    expect(ids.length).toBeGreaterThanOrEqual(15);
  });

  test("the filter is not so broad that it excludes everything", () => {
    // If insertableLines() ever returned nothing, the test above would pass
    // while checking no code at all.
    const fftf = entries("ANALYZE_CALCS").find((e) => e.id === "fftfilter")!;
    const kept = insertableLines(fftf.body);
    expect(kept.length).toBeGreaterThan(20);
    expect(kept.join("\n")).toContain("kind: \"line\"");
  });

  test("the scan actually reads the registries (guard against a vacuous pass)", () => {
    const ids = entries("ANALYZE_CALCS").map((e) => e.id);
    expect(ids).toContain("fft");
    expect(ids).toContain("fftfilter");
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  test("a caveat carrying an em dash is normalised before it reaches the text", () => {
    // fftfilter.ts's caveats contain ten em dashes. They are the reason the
    // module is trustworthy, so they are kept — with the dash swapped, not the
    // wording.
    const fftfilter = fs.readFileSync(path.join(__dirname, "..", "fftfilter.ts"), "utf8");
    expect(fftfilter.includes(EM_DASH)).toBe(true);
    const entry = entries("ANALYZE_CALCS").find((e) => e.id === "fftfilter");
    expect(entry).toBeDefined();
    expect(entry!.body).toContain("res.caveats");
    expect(entry!.body).toMatch(/replace\(\/\\u2014\/g/);
  });
});
