// v2.143.0 adversarial-review fixes: panel clipping, id namespacing in <style>
// and entity-quoted url(), and the hyphen-minus product text the label audit's
// HYPHEN baseline of 3 used to hide.
import { composePanels, namespaceIds } from "../panels";
import { solveGeometry } from "../geometryParse";
import { geometryFigureSvg } from "../geometryChart";
import { radiusOfFunction, radiusSvg } from "../radius";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require("../../../scripts/figure-label-audit.js");

const MINUS = String.fromCharCode(0x2212);

const doc = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

describe("composePanels clips each panel to its cell", () => {
  // Panel A paints a rect far past its own right edge, into panel B's cell.
  const overrun = doc(100, 80, `<rect x="0" y="0" width="400" height="80" fill="#000"/>`);
  const plain = doc(100, 80, `<circle cx="50" cy="40" r="10"/>`);

  test("every panel group sits inside a clip-path to its own cell", () => {
    const c = composePanels([overrun, plain], { cols: 2 });
    const clips = Array.from(c.svg.matchAll(/<clipPath id="([^"]+)"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"\/><\/clipPath>/g));
    expect(clips).toHaveLength(2);
    c.panels.forEach((p, k) => {
      const [, id, x, y, w, h] = clips[k];
      expect([Number(x), Number(y), Number(w), Number(h)]).toEqual([p.x, p.y, p.w, p.h].map((v) => +v.toFixed(4)));
      // The panel's translate group is the child of a group clipped by that id.
      expect(c.svg).toContain(`<g clip-path="url(#${id})"><g transform="translate(`);
    });
  });

  test("clip ids cannot collide with a panel's own (namespaced) ids", () => {
    const sneaky = doc(100, 80, `<clipPath id="clip0"><rect width="1" height="1"/></clipPath><clipPath id="cell"><rect width="1" height="1"/></clipPath>`);
    const c = composePanels([sneaky, sneaky], { cols: 2 });
    const all = Array.from(c.svg.matchAll(/\sid="([^"]+)"/g), (m) => m[1]);
    expect(new Set(all).size).toBe(all.length);
  });

  test("under a preset (scaled panels) the clip is the drawn cell, in root units", () => {
    const c = composePanels([overrun, plain], { preset: "nature", cols: 2 });
    const r = /<clipPath id="[^"]+"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"\/>/.exec(c.svg);
    expect(r).not.toBeNull();
    expect(Number(r![3])).toBeCloseTo(c.panels[0].w, 3);
    expect(Number(r![4])).toBeCloseTo(c.panels[0].h, 3);
  });
});

describe("namespaceIds", () => {
  test("rewrites #id selectors in a <style> sheet for ids the markup defines", () => {
    const m = `<style>#hatch{stroke:#000} .a #grid line{fill:#fff}</style><pattern id="hatch"/><g id="grid"/>`;
    const out = namespaceIds(m, "p1-");
    expect(out).toContain("#p1-hatch{");
    expect(out).toContain(".a #p1-grid line");
    // Colours (not defined ids) are left alone.
    expect(out).toContain("stroke:#000");
    expect(out).toContain("fill:#fff");
  });

  test("a colour that is not a defined id is never touched, even when an id has the same letters elsewhere", () => {
    const m = `<style>.x{fill:#abc}</style><g id="abcd"/>`;
    expect(namespaceIds(m, "p0-")).toContain("fill:#abc}");
  });

  test("rewrites entity-quoted url(&quot;#id&quot;) and url(&#39;#id&#39;)", () => {
    const m = `<clipPath id="c1"/><g clip-path="url(&quot;#c1&quot;)"/><g fill="url(&#39;#c1&#39;)"/><g fill="url(&quot;#other&quot;)"/>`;
    const out = namespaceIds(m, "p2-");
    expect(out).toContain(`url(&quot;#p2-c1&quot;)`);
    expect(out).toContain(`url(&#39;#p2-c1&#39;)`);
    expect(out).toContain(`url(&quot;#other&quot;)`);
  });

  test("url(#id) inside a <style> sheet is prefixed exactly once", () => {
    const m = `<style>.a{clip-path:url(#c1)}</style><clipPath id="c1"/>`;
    const out = namespaceIds(m, "p0-");
    expect(out).toContain("url(#p0-c1)");
    expect(out).not.toContain("p0-p0-");
  });
});

describe("display contract: product figure text uses U+2212, and it parses back", () => {
  test("geometry polygon vertex labels: (−1, 3), not (-1, 3)", () => {
    const g = solveGeometry("polygon (0,0) (4,0) (5,3) (2,5) (-1,3)");
    const svg = geometryFigureSvg(g!.figure!);
    expect(svg).toContain(`(${MINUS}1, 3)`);
    expect(audit.auditLabels(svg).HYPHEN).toEqual([]);
  });

  test("a vertex typed with U+2212 (as displayed) is read, not silently dropped", () => {
    const typed = solveGeometry("polygon (0,0) (4,0) (5,3) (2,5) (-1,3)");
    const shown = solveGeometry(`polygon (0,0) (4,0) (5,3) (2,5) (${MINUS}1,3)`);
    const pts = (r: ReturnType<typeof solveGeometry>) => (r!.figure as { pts: { x: number; y: number }[] }).pts;
    expect(pts(shown)).toHaveLength(5);
    expect(pts(shown)).toEqual(pts(typed));
  });

  test("taylor disc legend: Real interval (−1, 1)", () => {
    const r = radiusOfFunction("1/(1-x)", "x", 0);
    const svg = radiusSvg(r);
    expect(svg).toContain(`Real interval (${MINUS}1, 1)`);
    expect(audit.auditLabels(svg).HYPHEN).toEqual([]);
  });
});

describe("label-audit ratchet is per figure, not per count", () => {
  test("a NEW figure with a violation fails even when another one was fixed (count unchanged)", () => {
    const base = { HYPHEN: ["fig A"], ENOTATION: [], DUPLICATE: [], DECIMALS: [] };
    const now = { HYPHEN: [["fig B", ["-1"]]], ENOTATION: [], DUPLICATE: [], DECIMALS: [] };
    const r = audit.ratchet(now, base);
    expect(r.fail).toEqual([["HYPHEN", "fig B"]]);
    expect(r.down).toEqual([["HYPHEN", "fig A"]]);
  });

  test("the HYPHEN baseline is empty: no product figure may carry a hyphen-minus", () => {
    expect(audit.BASELINE.HYPHEN).toEqual([]);
  });

  test('"-3 dB" (the corpus\'s typed series label) is an exact fixture text', () => {
    const svg = `<svg width="200" height="50"><text x="5" y="20">-3 dB</text><text x="5" y="40">-4 dB</text></svg>`;
    expect(audit.auditLabels(svg).HYPHEN).toEqual(["-4 dB"]);
  });
});
