// Reported from real use: "bio/assay shows a plot box but nothing shows up".
//
// `.structure-preview` carries a 120px min-height, a border and a FIXED white
// paper background (it previews black-on-white artwork, so it deliberately does
// not follow the theme). An empty one is therefore not invisible — it is a
// framed blank panel. Eleven of the sixteen Bio/Assay calculators never return
// a plot, and clearing innerHTML left that panel on screen under every one of
// them.
//
// Source-scanned, because taskpane.ts cannot be imported (Office.js at module
// scope). Anti-vacuity checks included so it cannot pass while reading nothing.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const pane = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.css"), "utf8");

function assaySlice(): string {
  const start = pane.indexOf("function updateAssayPreview");
  expect(start).toBeGreaterThan(-1);
  const end = pane.indexOf("\n}\n", pane.indexOf("assayInsertBtn.disabled = !insertable"));
  expect(end).toBeGreaterThan(start);
  return pane.slice(start, end);
}

describe("the empty preview panel is a real box, which is why it must be hidden", () => {
  it("the shared class really does draw a bordered, min-height panel", () => {
    const block = css.slice(css.indexOf(".structure-preview {"), css.indexOf("}", css.indexOf(".structure-preview {")));
    expect(block).toMatch(/min-height:\s*\d+px/);
    expect(block).toMatch(/border:/);
  });

  it("Bio/Assay uses that class", () => {
    expect(html).toMatch(/id="assay-preview" class="structure-preview"/);
  });

  it("most Bio/Assay calculators genuinely have no plot — the reason this matters", () => {
    const start = pane.indexOf("const ASSAY_CALCS");
    const body = pane.slice(start, pane.indexOf("\n];", start));
    const ids = [...body.matchAll(/^\s+id: "([a-z0-9-]+)"/gm)].length;
    const plots = [...body.matchAll(/plot: \{/g)].length;
    expect(ids).toBeGreaterThan(12);
    expect(plots).toBeLessThan(ids / 2);
  });
});

describe("every path that produces no plot hides the panel", () => {
  const body = assaySlice();

  it("the no-plot branch hides it and the plot branch shows it", () => {
    expect(body).toMatch(/assayPreview\.style\.display = "none"/);
    expect(body).toMatch(/assayPreview\.style\.display = ""/);
  });

  it("hiding happens at least twice — the incomplete-form path counts too", () => {
    const hides = body.match(/assayPreview\.style\.display = "none"/g) ?? [];
    expect(hides.length).toBeGreaterThanOrEqual(2);
  });

  it("the Insert plot button is hidden alongside it, not merely disabled", () => {
    expect(body).toMatch(/assayInsertPlotBtn\.hidden = true/);
    expect(body).toMatch(/assayInsertPlotBtn\.hidden = false/);
  });

  it("clearing innerHTML alone is never the whole story", () => {
    // Each place that blanks the panel must also hide it.
    const clears = (body.match(/assayPreview\.innerHTML = ""/g) ?? []).length;
    const hides = (body.match(/assayPreview\.style\.display = "none"/g) ?? []).length;
    expect(hides).toBeGreaterThanOrEqual(clears);
  });
});
