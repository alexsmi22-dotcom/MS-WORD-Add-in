// Source-scanning gate for v2.65.0's two wiring changes: the search box must
// index tools and calculators, and every data-bearing field must offer a way to
// fill it from the document or a file.
//
// taskpane.ts cannot be imported (Office.js at module scope), so this reads it
// as text — the same technique engineeringRouting.test.ts uses, with the same
// anti-vacuity checks so it cannot pass while scanning nothing.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const pane = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.html"), "utf8");

/** Slices a registry literal out of the pane source. */
function registrySlice(name: string): string {
  const start = pane.indexOf(`const ${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = pane.indexOf("\n];", start);
  expect(end).toBeGreaterThan(start);
  return pane.slice(start, end);
}

function idsIn(name: string): string[] {
  return [...registrySlice(name).matchAll(/^\s+id: "([a-z0-9-]+)"/gm)].map((m) => m[1]);
}

describe("the search index cannot pass vacuously", () => {
  it("finds all five registries with plausible sizes", () => {
    const sizes = {
      ENG_CALCS: idsIn("ENG_CALCS").length,
      STAT_CALCS: idsIn("STAT_CALCS").length,
      ANALYZE_CALCS: idsIn("ANALYZE_CALCS").length,
      FIN_CALCS: idsIn("FIN_CALCS").length,
      ASSAY_CALCS: idsIn("ASSAY_CALCS").length,
    };
    expect(sizes.ENG_CALCS).toBeGreaterThan(80);
    expect(sizes.STAT_CALCS).toBeGreaterThan(15);
    expect(sizes.ANALYZE_CALCS).toBeGreaterThan(15);
    expect(sizes.FIN_CALCS).toBeGreaterThan(15);
    expect(sizes.ASSAY_CALCS).toBeGreaterThan(10);
  });
});

describe("search indexes tools and calculators, not just formulas", () => {
  it("every calculator registry is fed into the index", () => {
    const start = pane.indexOf("function calcRegistries()");
    expect(start).toBeGreaterThan(-1);
    const body = pane.slice(start, pane.indexOf("}", pane.indexOf("];", start)));
    for (const reg of ["ENG_CALCS", "STAT_CALCS", "ANALYZE_CALCS", "FIN_CALCS", "ASSAY_CALCS"]) {
      expect(body).toContain(reg);
    }
  });

  it("buildSearchIndex pushes tool and calculator entries", () => {
    const start = pane.indexOf("function buildSearchIndex()");
    const body = pane.slice(start, pane.indexOf("\n}", start));
    expect(body).toMatch(/type: "tool"/);
    expect(body).toMatch(/type: "calculator"/);
    expect(body).toMatch(/HOME_GROUPS/);
    expect(body).toMatch(/calcRegistries\(\)/);
    // The originals must survive — this was an addition, not a replacement.
    expect(body).toMatch(/type: "formula"/);
    expect(body).toMatch(/type: "compound"/);
  });

  it("a calculator hit routes THROUGH the select, not around it", () => {
    const start = pane.indexOf("function applySearchEntry");
    const body = pane.slice(start, pane.indexOf("\n}", start));
    expect(body).toMatch(/calcSelectFor\(entry\.mode\)/);
    expect(body).toMatch(/dispatchEvent\(new Event\("change"\)\)/);
  });

  it("every mode that owns a registry has a select mapped for it", () => {
    const start = pane.indexOf("function calcSelectFor");
    const body = pane.slice(start, pane.indexOf("\n}", start));
    for (const m of ["engineering", "stats", "analyze", "finance", "assay"]) {
      expect(body).toContain(`case "${m}":`);
    }
  });

  it("the placeholder no longer advertises only formulas and compounds", () => {
    expect(html).toMatch(/placeholder="Search tools, calculators/);
  });
});

describe("data-bearing fields offer a document and a file source", () => {
  it("the kinds that get the bar are the data kinds, and only those", () => {
    const m = /const DATA_FIELD_KINDS = new Set\(\[([^\]]+)\]\)/.exec(pane);
    expect(m).not.toBeNull();
    const kinds = [...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort();
    expect(kinds).toEqual(["block", "list", "matrix"]);
  });

  it("renderCalcFields attaches the bar for those kinds", () => {
    const start = pane.indexOf("function renderCalcFields");
    const body = pane.slice(start, pane.indexOf("\n}", pane.indexOf("onChange();", start)));
    expect(body).toMatch(/DATA_FIELD_KINDS\.has\(f\.kind\)/);
    expect(body).toMatch(/buildDataSourceBar\(/);
  });

  it("the bar reads the document through the SHARED table reader", () => {
    const start = pane.indexOf("function buildDataSourceBar");
    const body = pane.slice(start, pane.indexOf("\n}\n", start + 200));
    expect(body).toMatch(/readTableUnderCursor\(\)/);
    expect(body).toMatch(/parseDelimited\(/);
    expect(body).toMatch(/gridToFieldText\(/);
  });

  it("Table -> Chart uses the same reader rather than a second copy", () => {
    const start = pane.indexOf("async function loadSelectedTable");
    const body = pane.slice(start, pane.indexOf("\n}\n", start));
    expect(body).toMatch(/readTableUnderCursor\(\)/);
    // The old inline Word.run must be gone from this function — one reader.
    expect(body).not.toMatch(/parentTableOrNullObject/);
  });

  it("the file input is size-guarded, like the other file readers", () => {
    const start = pane.indexOf("function buildDataSourceBar");
    const body = pane.slice(start, pane.indexOf("\n}\n", start + 200));
    expect(body).toMatch(/8 \* 1024 \* 1024/);
  });

  it("the CSV accept list covers what a spreadsheet exports", () => {
    const start = pane.indexOf("function buildDataSourceBar");
    const body = pane.slice(start, pane.indexOf("\n}\n", start + 200));
    expect(body).toMatch(/\.csv/);
    expect(body).toMatch(/\.tsv/);
  });
});
