/**
 * The brand mark is drawn in three places and they drifted apart.
 *
 * assets/logo.svg feeds the ribbon/add-in icons; src/taskpane/taskpane.html
 * draws the pane header inline (deliberately, because Word caches ribbon icons
 * by URL); landing/index.html draws the header mark on the website. On
 * 2026-07-29 the user reported that "the logo on JurisLab is correct but the
 * add-in logo is still old" — and it was: the site had moved to a flat base and
 * a CYAN ring while the icon still had a trapezoid plinth, pan hangers and an
 * all-white ring. Nothing compared them, so the divergence was invisible in
 * every diff and every gate.
 *
 * The first two share a 128 viewBox and must be geometrically IDENTICAL. The
 * landing mark is drawn at 24 for a small dark header, so it is checked on the
 * things that actually define the mark rather than on coordinates: the accent
 * colour, and the flat base (a plinth path would mean it had drifted back).
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..", "..");

/**
 * Comments are prose ABOUT the drawing, not the drawing. logo.svg's header
 * explains why the old bright plate was abandoned and therefore names the very
 * colour this file forbids — checking the raw text failed on its own rationale.
 */
const stripComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, "");

const logoSvg = stripComments(readFileSync(join(ROOT, "assets", "logo.svg"), "utf8"));
const paneHtml = readFileSync(join(ROOT, "src", "taskpane", "taskpane.html"), "utf8");
const landingHtml = readFileSync(join(ROOT, "landing", "index.html"), "utf8");

/** The accent that makes this the JurisLab mark rather than a generic scale. */
const RING = "#38BDF8";

/** Pull the pane's brand <svg> out of the page. */
function paneMark(): string {
  const m = /<svg class="brand-mark"[\s\S]*?<\/svg>/.exec(stripComments(paneHtml));
  if (!m) throw new Error("Could not find the brand-mark svg in taskpane.html — update this parser, do not delete the test.");
  return m[0];
}

/** Pull the landing header's brand <svg> out of the page. */
function landingMark(): string {
  const m = /<a class="brand"[\s\S]*?<\/svg>/.exec(landingHtml);
  if (!m) throw new Error("Could not find the brand svg in landing/index.html — update this parser, do not delete the test.");
  return m[0];
}

/**
 * Every drawn shape, normalised to a comparable form. Attribute ORDER and
 * whitespace differ freely between the two files and are not differences in the
 * drawing, so they are stripped; numbers are compared as numbers.
 */
function shapes(svg: string): string[] {
  const out: string[] = [];
  for (const m of svg.matchAll(/<(circle|rect|polygon|polyline|path)\b([^>]*?)\/?>/g)) {
    const tag = m[1];
    const attrs = m[2];
    const keep: string[] = [];
    for (const a of attrs.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      const name = a[1];
      if (name === "fill" && a[2].startsWith("url(")) continue; // gradient id names differ
      if (["class", "role", "aria-label", "id"].includes(name)) continue;
      const value = a[2]
        .trim()
        .replace(/\s+/g, " ")
        .replace(/(\d+\.\d*?)0+\b/g, "$1")   // 8.450 -> 8.45
        .replace(/\.(?=\D|$)/g, "");          // 8. -> 8
      keep.push(`${name}=${value}`);
    }
    keep.sort();
    out.push(`${tag}[${keep.join(",")}]`);
  }
  return out;
}

/** The plate is the rounded background square, not part of the mark itself. */
const isPlate = (s: string): boolean => s.includes("width=122") || s.includes("width=128");

describe("the JurisLab brand mark", () => {
  test("the pane draws exactly the same mark as assets/logo.svg", () => {
    const fromLogo = shapes(logoSvg).filter((s) => !isPlate(s));
    const fromPane = shapes(paneMark()).filter((s) => !isPlate(s));

    expect(fromLogo.length).toBeGreaterThan(4);
    // Compared as sorted sets: the two files may list the shapes in either order
    // without that being a difference in what is drawn.
    expect([...fromPane].sort()).toEqual([...fromLogo].sort());
  });

  test("the plate is the dark navy the cyan ring can survive, in both", () => {
    // A bright #0EA5E9 plate is what made the accent invisible and is the state
    // this mark was rescued from — it must not come back silently.
    for (const [name, src] of [["logo.svg", logoSvg], ["taskpane.html", paneMark()]] as const) {
      expect(src).toContain("#0C4A6E");
      expect(src).toContain("#062231");
      expect(src.includes("#0EA5E9")).toBe(false);
      expect(name).toBeTruthy();
    }
  });

  test("all three drawings use the cyan ring", () => {
    expect(logoSvg).toContain(RING);
    expect(paneMark()).toContain(RING);
    expect(landingMark()).toContain(RING);
  });

  test("the ring is the cyan element and the sigma is white, everywhere", () => {
    for (const src of [logoSvg, paneMark(), landingMark()]) {
      const polygon = /<polygon[^>]*>/.exec(src);
      const polyline = /<polyline[^>]*>/.exec(src);
      expect(polygon).not.toBeNull();
      expect(polyline).not.toBeNull();
      // The hexagon (benzene ring) carries the accent; the summation does not.
      expect(polygon![0]).toContain(RING);
      expect(polyline![0]).not.toContain(RING);
    }
  });

  test("the base is a flat bar, not the old trapezoid plinth", () => {
    // The plinth was `path d="M52 98 h24 l9 10 h-42 z"`. Any <path> in these
    // marks means it has come back.
    for (const src of [logoSvg, paneMark(), landingMark()]) {
      expect(/<path\b/.test(src)).toBe(false);
    }
  });
});
