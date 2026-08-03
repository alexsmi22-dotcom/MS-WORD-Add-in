/* eslint-disable no-undef */
// Do the figures we insert actually READ?
//
// The unit suite checks that an SVG is well formed, carries no NaN and follows
// no theme. None of that catches the thing a reader sees first: a tick label
// sitting on top of an axis title, a legend entry crossed by the curve it
// labels, or a data line drawn straight through a number. Those are layout
// facts, and they are measurable rather than matters of taste.
//
//   node scripts/figure-layout-audit.js
//
// Exit 0 = clean, 1 = findings.
//
// HOW IT MEASURES. Every <text> gets a bounding box from its x, y, font-size,
// text-anchor and character count, using a conservative average advance width
// for a sans-serif face. Then:
//
//   - any two boxes that overlap by more than a hair are a COLLISION;
//   - any <line> or <polyline> segment that crosses a box is a STRIKETHROUGH;
//   - any box extending past the canvas is CLIPPED.
//
// The character-width estimate is approximate, which is why the overlap
// threshold is a few square pixels rather than zero — a shared pixel of
// antialiasing is not a defect, and a label sitting squarely on another one is.

const path = require("path");

// Average advance of a sans-serif glyph as a fraction of the font size.
//
// DELIBERATELY AN OVER-ESTIMATE. A real sans digit runs about 0.556 em, and the
// first value here was 0.52 — which made every box ~7% narrow. For a collision
// detector "conservative" has to mean over-estimating the boxes, or the check
// quietly misses the marginal overlaps that are exactly the ones in dispute.
const ADVANCE = 0.58;
// Cap height plus a little, again as a fraction of the font size.
const LINE = 0.78;

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Every <text> in an SVG, as a box plus its content. */
function textBoxes(svg) {
  const out = [];
  const groupSize = /<g[^>]*font-size="([\d.]+)"/.exec(svg);
  const inherited = groupSize ? Number(groupSize[1]) : 10;
  const re = /<text\s([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const attrs = m[1];
    const raw = decodeEntities(m[2].replace(/<[^>]*>/g, ""));
    const at = (name) => {
      const a = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
      return a ? a[1] : null;
    };
    const x = Number(at("x"));
    const y = Number(at("y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const fs = Number(at("font-size")) || inherited;
    const anchor = at("text-anchor") || "start";
    const w = raw.length * fs * ADVANCE;
    const h = fs * LINE;
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    // A rotated label occupies a different rectangle; treat it as its own
    // narrow vertical strip rather than pretending it is horizontal.
    const rotated = /rotate\(-?90/.test(attrs);
    out.push({
      text: raw,
      rotated,
      x0: rotated ? x - h / 2 : x0,
      x1: rotated ? x + h / 2 : x0 + w,
      // SVG y is the BASELINE, so the box runs upwards from it.
      y0: rotated ? y - w / 2 : y - h * 0.8,
      y1: rotated ? y + w / 2 : y + h * 0.2,
      fs,
    });
  }
  return out;
}

/**
 * Every straight segment drawn, from <line> and <polyline>, WITH ITS POSITION
 * in the document.
 *
 * The position matters because SVG paints in document order. A line that would
 * cross a label is not visible through an OPAQUE rectangle drawn after it —
 * which is exactly how a legend is supposed to work — and an instrument that
 * cannot tell those apart reports phantom defects and hides real ones.
 */
function segments(svg) {
  const out = [];
  let m;
  const lineRe = /<line\s([^>]*)\/>/g;
  while ((m = lineRe.exec(svg))) {
    const a = m[1];
    const n = (k) => {
      const r = new RegExp(`\\b${k}="([^"]*)"`).exec(a);
      return r ? Number(r[1]) : NaN;
    };
    const [x1, y1, x2, y2] = [n("x1"), n("y1"), n("x2"), n("y2")];
    if ([x1, y1, x2, y2].every(Number.isFinite)) out.push({ x1, y1, x2, y2, at: m.index });
  }
  const polyRe = /<polyline\s[^>]*points="([^"]*)"/g;
  while ((m = polyRe.exec(svg))) {
    const pts = m[1]
      .trim()
      .split(/\s+/)
      .map((p) => p.split(",").map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite));
    for (let i = 1; i < pts.length; i++) {
      out.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], at: m.index });
    }
  }
  // AND <path>, WHICH IS EVERY DATA CURVE buildPlotSvg DRAWS.
  //
  // Leaving it out was not a small gap: it made the instrument blind to
  // precisely the element it was built to police. A line crossing a legend
  // entry was reported when the line was a gridline and missed when it was the
  // curve the entry names. Only the M/L subset appears in these figures, and
  // anything richer is deliberately ignored rather than half-parsed.
  const pathRe = /<path\s[^>]*\bd="([^"]*)"/g;
  while ((m = pathRe.exec(svg))) {
    const d = m[1];
    if (/[^MLmlZz0-9.,\-+eE\s]/.test(d)) continue; // curves and arcs: not handled, not guessed at
    const pts = [];
    const cmdRe = /([MLml])\s*(-?[\d.]+(?:[eE][-+]?\d+)?)[,\s]+(-?[\d.]+(?:[eE][-+]?\d+)?)/g;
    let c;
    let cx = 0;
    let cy = 0;
    while ((c = cmdRe.exec(d))) {
      const rel = c[1] === "l" || c[1] === "m";
      const x = Number(c[2]);
      const y = Number(c[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) { pts.length = 0; break; }
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      pts.push([cx, cy, c[1].toUpperCase() === "M"]);
    }
    for (let i = 1; i < pts.length; i++) {
      // A move-to lifts the pen; only draw-to segments are strokes.
      if (pts[i][2]) continue;
      out.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], at: m.index });
    }
  }
  return out;
}

/** Opaque rectangles, which hide anything painted before them. */
function opaqueRects(svg) {
  const out = [];
  const re = /<rect\s([^>]*)\/>/g;
  let m;
  while ((m = re.exec(svg))) {
    const a = m[1];
    const at = (k) => {
      const r = new RegExp(`\\b${k}="([^"]*)"`).exec(a);
      return r ? r[1] : null;
    };
    const opacity = at("fill-opacity");
    const fill = at("fill");
    // Anything translucent or unfilled hides nothing.
    if (opacity !== null && Number(opacity) < 0.99) continue;
    if (!fill || fill === "none") continue;
    const n = (k) => Number(at(k) ?? "0");
    const x = n("x");
    const y = n("y");
    const w = n("width");
    const h = n("height");
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
      out.push({ x0: x, y0: y, x1: x + w, y1: y + h, at: m.index });
    }
  }
  return out;
}

function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Does a segment pass through a box? Liang-Barsky clip. */
function segmentHitsBox(s, b) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, s.x1 - b.x0) &&
    clip(dx, b.x1 - s.x1) &&
    clip(-dy, s.y1 - b.y0) &&
    clip(dy, b.y1 - s.y1) &&
    t1 > t0
  );
}

/** Findings for one figure. */
function auditSvg(name, svg) {
  const found = [];
  const boxes = textBoxes(svg);
  const size = /<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(svg);
  const W = size ? Number(size[1]) : 0;
  const H = size ? Number(size[2]) : 0;

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = overlapArea(boxes[i], boxes[j]);
      // A few square pixels is antialiasing. The fraction was 0.22, which
      // allowed up to 2.2 whole characters of overlap to pass unreported at
      // every font size these figures use; 0.06 is about half a character.
      const smaller = Math.min(
        (boxes[i].x1 - boxes[i].x0) * (boxes[i].y1 - boxes[i].y0),
        (boxes[j].x1 - boxes[j].x0) * (boxes[j].y1 - boxes[j].y0),
      );
      if (a > Math.max(4, smaller * 0.06)) {
        found.push(
          `COLLISION  "${boxes[i].text.slice(0, 22)}" over "${boxes[j].text.slice(0, 22)}" (${a.toFixed(0)} px²)`,
        );
      }
    }
  }

  const segs = segments(svg);
  const rects = opaqueRects(svg);
  for (const b of boxes) {
    // Shrink the box slightly: an axis line touching the top of a tick label's
    // box is normal, a line through its middle is not.
    const inner = {
      x0: b.x0 + (b.x1 - b.x0) * 0.12,
      x1: b.x1 - (b.x1 - b.x0) * 0.12,
      y0: b.y0 + (b.y1 - b.y0) * 0.25,
      y1: b.y1 - (b.y1 - b.y0) * 0.25,
    };
    // Is this label sitting on an opaque backing? If so, only lines painted
    // AFTER that backing can still be seen crossing it.
    const backing = rects.filter(
      (r) => r.x0 <= inner.x0 && r.x1 >= inner.x1 && r.y0 <= inner.y0 && r.y1 >= inner.y1,
    );
    const coveredUntil = backing.length ? Math.max(...backing.map((r) => r.at)) : -1;
    for (const s of segs) {
      if (s.at < coveredUntil) continue;
      if (segmentHitsBox(s, inner)) {
        found.push(`STRIKETHROUGH  a line crosses "${b.text.slice(0, 26)}"`);
        break;
      }
    }
  }

  if (W && H) {
    for (const b of boxes) {
      if (b.x0 < -1 || b.x1 > W + 1 || b.y0 < -1 || b.y1 > H + 1) {
        found.push(`CLIPPED  "${b.text.slice(0, 26)}" runs outside the ${W}x${H} canvas`);
      }
    }
  }
  return { name, found, textCount: boxes.length, segCount: segs.length };
}


/**
 * Runs the audit over [name, svg] pairs and prints a report.
 *
 * The figure LIST lives in the TypeScript driver, because the builders are
 * TypeScript and this file has to stay requirable from a jest test.
 */
function runAudit(figures) {
  let bad = 0;
  console.log("Figure layout audit\n");

  // SELF-TEST FIRST. A checker that reports "all clear" for something it cannot
  // see is worse than no checker, and this repo has been burnt by exactly that
  // more than once. Each known-bad payload below MUST trip its own check, and
  // the last one must NOT trip anything - an occluded line is not a defect.
  const selfCases = [
    [
      "collision",
      '<svg width="200" height="100"><g font-size="10"><text x="50" y="50">overlapping</text>' +
        '<text x="52" y="52">overlapping</text></g></svg>',
      /COLLISION/,
    ],
    [
      "strikethrough",
      '<svg width="200" height="100"><g font-size="10"><line x1="0" y1="48" x2="200" y2="48" stroke="#000"/>' +
        '<text x="50" y="50">struck out</text></g></svg>',
      /STRIKETHROUGH/,
    ],
    [
      "strikethrough via path",
      '<svg width="200" height="100"><g font-size="10"><path d="M0,48 L200,48" stroke="#000" fill="none"/>' +
        '<text x="50" y="50">struck out by a path</text></g></svg>',
      /STRIKETHROUGH/,
    ],
    [
      "clipped",
      '<svg width="200" height="100"><g font-size="10"><text x="190" y="50">runs off the edge</text></g></svg>',
      /CLIPPED/,
    ],
    [
      "occlusion respected",
      '<svg width="200" height="100"><g font-size="10"><line x1="0" y1="48" x2="200" y2="48" stroke="#000"/>' +
        '<rect x="30" y="38" width="110" height="16" fill="#ffffff"/><text x="50" y="50">backed</text></g></svg>',
      null,
    ],
  ];
  const selfFails = [];
  for (const [name, svg, want] of selfCases) {
    const got = auditSvg(name, svg).found;
    if (want === null) {
      if (got.length) selfFails.push(name + ": expected no finding, got " + got[0]);
    } else if (!got.some((f) => want.test(f))) {
      selfFails.push(name + ": " + want + " not detected");
    }
  }
  if (selfFails.length) {
    console.log("  FLAG  self-test FAILED - the results below prove nothing");
    for (const f of selfFails) console.log("          " + f);
    return selfFails.length;
  }
  console.log("  ok    self-test: every check trips on a known-bad payload, and occlusion is respected.\n");

  for (const [name, svg] of figures) {
    const r = auditSvg(name, svg);
    if (!r.found.length) {
      console.log("  ok    " + name.padEnd(22) + r.textCount + " labels, " + r.segCount + " segments");
    } else {
      bad += r.found.length;
      console.log("  FLAG  " + name.padEnd(22) + r.found.length + " issue(s)");
      for (const f of r.found.slice(0, 8)) console.log("          " + f);
      if (r.found.length > 8) console.log("          ... and " + (r.found.length - 8) + " more");
    }
  }
  console.log(bad ? "\n" + bad + " layout issue(s)." : "\nNo layout issues.");
  return bad;
}

module.exports = { auditSvg, textBoxes, segments, runAudit };
