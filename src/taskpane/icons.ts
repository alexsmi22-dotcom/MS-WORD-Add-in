// One line-art icon per tool, drawn rather than borrowed.
//
// WHY THIS EXISTS
// The pane used OS emoji, which failed at the one job an icon has: THREE tools
// showed the same glyph (align, sequence and dna were all 🧬), so the mark
// identified nothing. Emoji also render from the platform's own font, so Word on
// macOS and Word on Windows drew visibly different panes, and none of it matched
// the landing page's drafting look.
//
// Replacing them with reference numerals fixed uniqueness and consistency but
// lost the point of an icon — nobody recognises "(44)" as Bio/Assay at a glance.
// These are drawn instead: unique, identical on every platform, and in the
// brand's own line-art idiom.
//
// CONTRACT
// Each value is the INNER markup of a 24x24 SVG. The wrapper supplies
// viewBox/fill/stroke, so every icon inherits one weight and the current text
// colour — an icon must never hardcode a colour or it will not follow a hover or
// a future dark theme. Stroke-only, no fills: a filled glyph at 16px turns into
// a blob, and mixing filled and outlined marks is exactly the inconsistency the
// emoji had.
//
// Keyed by Mode, so TypeScript refuses to compile a new tool that has no icon.

import type { Mode } from "../lib/modes";

/** Inner SVG markup for each tool's icon, on a 24x24 grid. */
export const TOOL_ICONS: Record<Exclude<Mode, "home">, string> = {
  // Benzene ring — the universal mark for a structure.
  chemical: '<path d="M12 3.4 19.4 7.7v8.6L12 20.6 4.6 16.3V7.7z"/><circle cx="12" cy="12" r="3.5"/>',

  // Atoms joined by bonds: what Build assembles.
  build:
    '<circle cx="6" cy="17" r="2.3"/><circle cx="18" cy="17" r="2.3"/><circle cx="12" cy="6" r="2.3"/>' +
    '<path d="M7.7 15.4 10.5 8.3M13.5 8.3l2.8 7.1M8.3 17.6h7.4"/>',

  // Reaction arrow with the conditions written over it.
  reaction: '<path d="M3 15h15.5M15.5 11.5 19 15l-3.5 3.5"/><path d="M7 8h8"/>',

  // Stick spectrum: discrete m/z lines of differing intensity.
  massspec: '<path d="M3 20h18"/><path d="M6 20V9M9.5 20v-5M13 20V5M16.5 20v-8M20 20v-3"/>',

  // A continuous traced spectrum, as opposed to Mass Spec's discrete sticks.
  spectra: '<path d="M3 17.5c2.6 0 3.2-9.5 5.7-9.5s3.1 12 5.7 12 2.6-8 4.1-8H21"/>',

  // Sigma: summation, the most legible single mark for mathematics.
  math: '<path d="M17.5 5h-11l6.2 7-6.2 7h11"/>',

  // "x =" — an unknown being solved for.
  solve: '<path d="M4 8.5 8.8 15.5M8.8 8.5 4 15.5"/><path d="M13 10h7M13 15h7"/>',

  // A ruler: measurement and conversion.
  units: '<rect x="3" y="8" width="18" height="8" rx="1.6"/><path d="M7.5 8v3.2M12 8v4M16.5 8v3.2"/>',

  // Axes with a plotted curve.
  plot: '<path d="M4.5 4v15.5H20"/><path d="M7.5 16.5c3.2 0 3.6-8 6-8s3.2 4.5 5.2 4.5"/>',

  // A distribution over a baseline — the shape all of Stats is about.
  stats: '<path d="M3 19h18"/><path d="M4.5 19c4.2 0 3.2-11 7.5-11s3.3 11 7.5 11"/>',

  // Bracketed matrix with its elements.
  analyze:
    '<path d="M7.5 4H4.5v16h3M16.5 4h3v16h-3"/>' +
    '<circle cx="10.2" cy="9.5" r="1"/><circle cx="14" cy="9.5" r="1"/>' +
    '<circle cx="10.2" cy="15" r="1"/><circle cx="14" cy="15" r="1"/>',

  // A slide/figure frame containing a chart.
  ppt: '<rect x="3" y="4" width="18" height="14" rx="1.6"/><path d="M7.5 14.5v-3M12 14.5V8M16.5 14.5v-4.5"/><path d="M9.5 21h5"/>',

  // Currency: the money tools.
  finance:
    '<circle cx="12" cy="12" r="8.2"/>' +
    '<path d="M12 6.6v10.8M14.6 9.2h-3.9a1.9 1.9 0 000 3.8h2.6a1.9 1.9 0 010 3.8H9.4"/>',

  // A circular plasmid: the backbone ring with feature arcs annotated outside
  // it. An earlier version put a dot at the centre of a plain circle, which read
  // as a target or a record button rather than a map.
  seqmap:
    '<circle cx="12" cy="12" r="6.6"/>' +
    '<path d="M12 2.6a9.4 9.4 0 018.1 4.7"/><path d="M4.7 18.4A9.4 9.4 0 012.7 13.4"/>',

  // Two sequences stacked with match bars between them.
  align: '<path d="M4 7.5h4M10 7.5h3.5M16 7.5h4"/><path d="M4 16.5h6M12 16.5h2.5M17 16.5h3"/><path d="M6 10.5v3M13 10.5v3M18.5 10.5v3"/>',

  // A filing: the ST.26 listing document.
  sequence: '<path d="M6.5 3h7.5l4 4v14h-11.5z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6M9 18h3.5"/>',

  // The double helix, with its rungs.
  dna: '<path d="M7 3c0 4.5 10 4.5 10 9s-10 4.5-10 9"/><path d="M17 3c0 4.5-10 4.5-10 9s10 4.5 10 9"/><path d="M8.6 7h6.8M8.6 17h6.8"/>',

  // A microplate: where an assay is actually run.
  assay:
    '<rect x="3" y="6" width="18" height="12" rx="2"/>' +
    '<circle cx="8" cy="10" r="1.25"/><circle cx="12" cy="10" r="1.25"/><circle cx="16" cy="10" r="1.25"/>' +
    '<circle cx="8" cy="14" r="1.25"/><circle cx="12" cy="14" r="1.25"/><circle cx="16" cy="14" r="1.25"/>',

  // Residues linked in a chain.
  peptide: '<circle cx="5.2" cy="15" r="2.2"/><circle cx="12" cy="9" r="2.2"/><circle cx="18.8" cy="15" r="2.2"/><path d="M6.9 13.5 10.3 10.5M13.7 10.5l3.4 3"/>',

  // A leaf: plant nomenclature.
  botanical: '<path d="M20 4C10.5 4 4 9 4 15.8c0 2 .8 3.7.8 3.7s1.8-1 3.7-1C15.3 18.5 20 12.5 20 4z"/><path d="M5.2 19.5 14 10.7"/>',

  // A parenthesised numeral over a drawing edge — literally what this tool
  // manages. The first attempt was a circle on a diagonal leader line, which is
  // the universal magnifying-glass shape and collided with Search.
  numerals:
    '<path d="M8.4 5.4c-1.7 1.9-1.7 5.3 0 7.2"/><path d="M15.6 5.4c1.7 1.9 1.7 5.3 0 7.2"/>' +
    '<path d="M12 4.9v8.2"/><path d="M3.5 18.5h17"/>',

  // A bookmark: captions and the things cross-referenced to them.
  refs: '<path d="M7 3.5h10v17l-5-4.2-5 4.2z"/>',

  // Angle brackets.
  code: '<path d="M9 6.5 3.8 12 9 17.5M15 6.5 20.2 12 15 17.5"/>',

  // A clipboard being checked off, one pass over the whole document.
  audit: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9.2 4.5h5.6v2.8H9.2z"/><path d="M8.6 13.2l2.6 2.6 4.8-4.8"/>',

  // An open book: the authorities being cited.
  citations: '<path d="M3.5 5.5h5.6a2.9 2.9 0 012.9 2.9v10.6a2.9 2.9 0 00-2.9-2.9H3.5z"/><path d="M20.5 5.5h-5.6a2.9 2.9 0 00-2.9 2.9v10.6a2.9 2.9 0 012.9-2.9h5.6z"/>',
};

/**
 * Builds a tool icon element.
 *
 * The wrapper owns stroke and colour so every icon shares one weight and follows
 * `currentColor` — an icon that hardcoded its own colour would ignore hover and
 * any future theme.
 */
export function toolIcon(mode: Exclude<Mode, "home">): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  // Decoration: the adjacent label already names the tool, so a screen reader
  // announcing the icon too would just repeat itself.
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = TOOL_ICONS[mode];
  return svg;
}
