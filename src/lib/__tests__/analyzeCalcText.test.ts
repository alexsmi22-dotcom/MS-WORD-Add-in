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

  /**
   * Drops the lines of any `return` whose whole expression is string literals —
   * no template interpolation, no number formatter.
   *
   * FIN_CALCS has no `ok: false` channel: its `compute` returns a bare string,
   * so a REFUSAL is just an early `return "…"`. Those refusals are supposed to
   * carry the em dash — that is what makes them non-insertable, which is the
   * correct outcome for a message that is not a result. The perpetuity
   * divergence notice ("the sum does not converge") is exactly this.
   *
   * A real RESULT always interpolates a computed value or calls a formatter, so
   * "the return contains a template interpolation or one of the finMoney /
   * finPct / finFixed / assaySig / toFixed / toLocaleString formatters" is the
   * discriminator. It is deliberately conservative: a literal line sitting
   * inside a return that DOES compute something — the annuity block's prose —
   * stays in scope, which is how the pre-existing annuity defect was caught.
   */
  /**
   * The `compute:` property's body only — the text that becomes a RESULT.
   *
   * Everything else in a calculator entry (field labels, `hint`, and above all
   * `assumes`) is either not shown as a result or is appended after the
   * insertability decision has already been made, so a sentinel there is
   * harmless and flagging it would be noise that gets the guard switched off.
   */
  function computeBody(body: string): string {
    const i = body.indexOf("compute:");
    if (i < 0) return "";
    const rest = body.slice(i);
    let depth = 0;
    let started = false;
    for (let k = 0; k < rest.length; k++) {
      const ch = rest[k];
      if ("([{".includes(ch)) {
        depth++;
        started = true;
      } else if (")]}".includes(ch)) {
        depth--;
        if (started && depth <= 0) return rest.slice(0, k + 1);
      }
    }
    return rest;
  }

  function literalOnlyReturnsRemoved(lines: string[]): string[] {
    const FORMATTER = /finMoney|finPct|finFixed|assaySig|toFixed|toLocaleString|\$\{/;
    const keep: string[] = [];
    let i = 0;
    while (i < lines.length) {
      if (!/^\s*return\b/.test(lines[i])) {
        keep.push(lines[i]);
        i++;
        continue;
      }
      // Collect the return statement: to its terminating ";" at the same nesting.
      let depth = 0;
      let j = i;
      const block: string[] = [];
      for (; j < lines.length; j++) {
        block.push(lines[j]);
        for (const ch of lines[j]) {
          if ("([{".includes(ch)) depth++;
          else if (")]}".includes(ch)) depth--;
        }
        if (depth <= 0 && lines[j].trimEnd().endsWith(";")) break;
      }
      const text = block.join("\n");
      if (FORMATTER.test(text)) keep.push(...block);
      i = j + 1;
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

  test("no Finance or Assay calculator emits an em dash into an insertable result", () => {
    // THE GUARD KEPT LAGGING THE DEFECT BY ONE REGISTRY. It was written for
    // ANALYZE_CALCS, extended to STAT_CALCS after the v2.2.0 regression, and
    // still did not cover Finance — where three successful results carried an
    // em dash and were therefore silently un-insertable: `annuity` (pre-existing,
    // every annuity calculation), plus `depr-sl` and `perpetuity`. Covering the
    // remaining two registries is the only version of this guard that closes
    // the class rather than the instance.
    const offenders: string[] = [];
    for (const reg of ["FIN_CALCS", "ASSAY_CALCS"] as const) {
      for (const e of entries(reg)) {
        // ONLY the compute body. `assumes:` is appended AFTER the insertability
        // decision (taskpane.ts computes `insertable` from `text` alone), and
        // field `label:`/`key:` strings are never part of a result — an em dash
        // in either is correct prose, not a sentinel collision.
        for (const line of literalOnlyReturnsRemoved(insertableLines(computeBody(e.body)))) {
          if (line.includes("plainDashes")) continue;
          // `return "—"` and `Value = —` are the SENTINEL itself, deliberately
          // marking a result as not computable. That is the mechanism working.
          const t = line.trim();
          if (/^return "—";?$/.test(t) || t.includes("Value = —")) continue;
          for (const pat of EM_PATTERNS) {
            if (line.includes(pat)) offenders.push(`${e.id}: ${t.slice(0, 80)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the Finance/Assay scan actually reads both registries (guard against a vacuous pass)", () => {
    // The scan above is only worth having if it finds the calculators at all.
    const fin = entries("FIN_CALCS").map((e) => e.id);
    const assay = entries("ASSAY_CALCS").map((e) => e.id);
    expect(fin).toContain("annuity");
    expect(fin).toContain("perpetuity");
    expect(fin).toContain("depr-sl");
    expect(fin.length).toBeGreaterThan(15);
    expect(assay).toContain("dose");
    expect(assay.length).toBeGreaterThan(10);
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
