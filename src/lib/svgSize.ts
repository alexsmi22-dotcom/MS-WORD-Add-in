/**
 * A figure's own size, read from its SVG text (moved out of taskpane.ts so it can be tested: host-adapter
 * scope §E).
 */

/** The root <svg …> tag of a figure ("" when there is none). */
function rootTag(svg: string): string {
  // Quote-aware: a ">" inside an attribute value (aria-label="a > b") does not end the tag.
  return /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(svg)?.[0] ?? "";
}

/** A number-valued attribute of a tag ("127.3pt" → 127.3), or NaN. */
function attrNumber(tag: string, name: string): number {
  const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)`).exec(tag);
  return m ? parseFloat(m[1]) : NaN;
}

/**
 * The size a figure asks for: its root tag's width and height, else its viewBox's, else the fallback.
 * Only the ROOT tag is read (it matched `\bwidth="` anywhere, so a root with no width of its own took the
 * first stroke-width="1.5" inside it — a figure inserted 1.5 px wide: host-adapter audit §E).
 */
export function readSvgDims(svg: string, fallbackW: number, fallbackH: number): { w: number; h: number } {
  const tag = rootTag(svg);
  const vb = /\sviewBox\s*=\s*["']([^"']*)["']/.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number) ?? [];
  const vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : NaN;
  const vbH = vb.length === 4 && vb[3] > 0 ? vb[3] : NaN;
  const w = attrNumber(tag, "width");
  const h = attrNumber(tag, "height");
  return { w: w > 0 ? w : vbW > 0 ? vbW : fallbackW, h: h > 0 ? h : vbH > 0 ? vbH : fallbackH };
}

/** A Stats figure's natural size: the root tag's width and height when it begins the text, else 300 × 190. */
export function svgNaturalSize(svg: string): { width: number; height: number } {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg.trim())?.[1] ?? 300);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg.trim())?.[1] ?? 190);
  return { width: w, height: h };
}
