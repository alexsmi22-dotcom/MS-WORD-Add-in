// Artwork inserted into the document must never follow the pane theme.
//
// Dark mode themed the PANE. The figures — structures, plots, spectra, plasmid
// maps — are inserted into a Word document as black-on-white line art, because
// that is what a document and a patent figure require. If a generator ever
// reached for a CSS variable or `currentColor`, the inserted figure would
// inherit the pane's colours and a user working in dark mode would file a
// white-on-black drawing.
//
// This is a one-way constraint that is easy to violate later and invisible when
// violated, so it gets a test rather than a comment.

import * as fs from "fs";
import * as path from "path";
import { buildPlotSvg } from "../plot";

const LIB = path.join(__dirname, "..");

/** Every module that emits SVG destined for the document. */
const GENERATORS = fs
  .readdirSync(LIB)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => {
    const src = fs.readFileSync(path.join(LIB, f), "utf8");
    return src.includes("<svg") || src.includes("xmlns=");
  });

describe("inserted figures are theme-independent", () => {
  test("there are generators to check", () => {
    expect(GENERATORS.length).toBeGreaterThan(0);
  });

  test.each(GENERATORS)("%s uses no CSS variable or currentColor", (file) => {
    const src = fs.readFileSync(path.join(LIB, file), "utf8");
    // A CSS variable resolves against the PANE, not the document, so a figure
    // built with one changes colour with the theme and arrives wrong in Word.
    expect({ file, usesVar: /var\(--/.test(src) }).toEqual({ file, usesVar: false });
    expect({ file, usesCurrentColor: src.includes("currentColor") }).toEqual({
      file,
      usesCurrentColor: false,
    });
  });

  test("a rendered plot is still explicitly white-backed", () => {
    const svg = buildPlotSvg([{ type: "line", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }]);
    expect(svg).toContain('fill="#fff"');
    expect(svg).not.toContain("var(--");
    expect(svg).not.toContain("currentColor");
  });
});
