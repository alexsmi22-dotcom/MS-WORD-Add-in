// A figure made of several plots must be ONE svg document.
//
// Reported from the pane as "Could not insert chart: Could not rasterize the
// structure image." regressionFigures returned `resid + qq` — two sibling <svg>
// roots. That renders fine as innerHTML, so the preview looked right, but it is
// not a valid SVG document and rasterising it for Word failed outright. The
// regression diagnostics could therefore never be inserted at all.
import { buildPlotSvg, combineSvgs } from "../plot";

const plot = (title: string) =>
  buildPlotSvg([{ type: "scatter", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#000" }], {
    width: 300,
    height: 190,
    title,
  });

describe("combineSvgs", () => {
  test("produces exactly ONE root svg element", () => {
    const out = combineSvgs([plot("a"), plot("b"), plot("c")]).svg;
    expect(out.startsWith("<svg")).toBe(true);
    expect(out.endsWith("</svg>")).toBe(true);
    // The defect: counting roots. Concatenation gave three. The first fix nested
    // the three as child <svg>s (four "<svg" in all); since the journal-figures
    // work (panels.composePanels) each child is a translate <g>, because the
    // layout audit follows translate groups and not nested viewports. So the
    // document now has exactly ONE svg element.
    expect(out.split("<svg").length - 1).toBe(1);
    expect(out.split("</svg>").length - 1).toBe(1);
    expect(out.split('<g transform="translate(').length - 1).toBe(3);
    // And nothing may follow the closing tag of the root.
    expect(out.indexOf("</svg>") + "</svg>".length).toBeLessThanOrEqual(out.length);
  });

  test("the concatenated form it replaces is NOT a single document", () => {
    const bad = plot("a") + plot("b");
    // Two roots at depth 0 — this is what failed to rasterise.
    expect(bad.match(/^<svg/g)?.length).toBe(1);
    expect(bad.split("<svg").length - 1).toBe(2);
    expect(/^<svg[\s\S]*<\/svg>$/.test(bad)).toBe(true); // looks fine by a naive check
    // The real discriminator: after the FIRST root closes there is more content.
    const firstClose = bad.indexOf("</svg>") + "</svg>".length;
    expect(bad.slice(firstClose).trim().length).toBeGreaterThan(0);
    // The combined form has nothing after its root closes.
    const good = combineSvgs([plot("a"), plot("b")]).svg;
    const goodClose = good.lastIndexOf("</svg>") + "</svg>".length;
    expect(good.slice(goodClose).trim()).toBe("");
  });

  test("dimensions stack: height is the sum plus the gaps", () => {
    const r = combineSvgs([plot("a"), plot("b")], 8);
    expect(r.width).toBe(300);
    expect(r.height).toBe(190 * 2 + 8);
    expect(r.svg).toContain(`height="${190 * 2 + 8}"`);
  });

  test("each child is offset so they do not overlap", () => {
    const out = combineSvgs([plot("a"), plot("b")], 8).svg;
    // Offsets are now translate groups (were x/y on nested <svg> tags).
    expect(out).toContain('<g transform="translate(0,0)"');
    expect(out).toContain('<g transform="translate(0,198)"');
  });

  test("a single figure passes through untouched", () => {
    const one = plot("solo");
    const r = combineSvgs([one]);
    expect(r.svg).toBe(one);
    expect(r.width).toBe(300);
    expect(r.height).toBe(190);
  });

  test("empty input is empty, not a broken wrapper", () => {
    expect(combineSvgs([]).svg).toBe("");
    expect(combineSvgs(["", "  "]).svg).toBe("");
  });

  test("the root declares the SVG namespace, which a raster needs", () => {
    expect(combineSvgs([plot("a"), plot("b")]).svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  test("two plots' clipPath ids no longer collide in one document", () => {
    // The SAME markup twice: identical clip ids before namespacing. A y limit
    // that clips data is what makes buildPlotSvg emit a clipPath.
    const same = buildPlotSvg([{ type: "scatter", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#000" }], {
      width: 300,
      height: 190,
      yLimits: { max: 0.5 },
    });
    expect(same).toMatch(/\sid="/);
    const out = combineSvgs([same, same]).svg;
    const ids = Array.from(out.matchAll(/\sid="([^"]+)"/g), (m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // Every url(#…) reference resolves to an id in the document.
    for (const m of out.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(m[1]);
  });
});
