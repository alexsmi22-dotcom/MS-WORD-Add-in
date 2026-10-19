// A figure's size from its SVG: only the root tag counts (svgSize.ts).
import { readSvgDims, svgNaturalSize } from "../svgSize";

describe("readSvgDims", () => {
  it("reads the root's width and height (units ignored, as before)", () => {
    expect(readSvgDims('<svg xmlns="http://www.w3.org/2000/svg" width="127.3pt" height="97.5pt"><line stroke-width="0.6"/></svg>', 300, 230)).toEqual({ w: 127.3, h: 97.5 });
    expect(readSvgDims('<svg width="640" height="400"></svg>', 1, 1)).toEqual({ w: 640, h: 400 });
  });

  it("never takes a stroke-width inside a root that has no width (it inserted the figure 1.5 px wide)", () => {
    const svg = '<svg viewBox="0 0 480 320"><path stroke-width="1.5" d="M0 0"/><rect width="20" height="10"/></svg>';
    expect(readSvgDims(svg, 300, 230)).toEqual({ w: 480, h: 320 });
    // A stroke-width on the root itself is not its width either.
    expect(readSvgDims('<svg stroke-width="2" viewBox="0 0 50 40"></svg>', 300, 230)).toEqual({ w: 50, h: 40 });
  });

  it("falls back to the viewBox, then to the caller's size", () => {
    expect(readSvgDims('<svg viewBox="10 20 200,100"></svg>', 1, 1)).toEqual({ w: 200, h: 100 });
    expect(readSvgDims("<svg><g/></svg>", 300, 230)).toEqual({ w: 300, h: 230 });
    expect(readSvgDims("", 300, 230)).toEqual({ w: 300, h: 230 });
    expect(readSvgDims('<svg width="0" height="0" viewBox="0 0 0 0"></svg>', 300, 230)).toEqual({ w: 300, h: 230 });
  });

  it("reads past an XML prolog and comments to the root", () => {
    expect(readSvgDims('<?xml version="1.0"?><!-- figure --><svg width="12" height="34"></svg>', 1, 1)).toEqual({ w: 12, h: 34 });
  });
});

describe("svgNaturalSize (moved unchanged)", () => {
  it("reads a root that begins the text, else 300 × 190", () => {
    expect(svgNaturalSize('<svg width="520" height="340"></svg>')).toEqual({ width: 520, height: 340 });
    expect(svgNaturalSize("<g/>")).toEqual({ width: 300, height: 190 });
  });
});

describe("readSvgDims, a quoted > in the root tag (v2.160.0 review)", () => {
  it("does not end the tag", () => {
    expect(readSvgDims('<svg aria-label="a > b" width="300" height="200"></svg>', 1, 1)).toEqual({ w: 300, h: 200 });
  });
});
