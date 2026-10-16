// Journal and patent figure style presets, physical units, and a MEASURING checker.
//
// Scope: docs/SCOPE-JOURNAL-FIGURES-2026-10.md, C.2 (presets), C.7 (USPTO), D row
// "Builder 2". Every number below carries its source in a comment, and each source is
// one of exactly four kinds:
//
//   OFFICIAL  fetched from the publisher / the eCFR on 2026-10-14 and quoted.
//   SECONDARY the official page refused us (HTTP 403 behind a bot wall on 2026-10-14,
//             re-tried after the brief's audit), so the value comes from a mirror or
//             third-party summary. The preset's NAME says "from secondary source" so the
//             user is told, not just the code reader.
//   MEASURED  read on this machine from the font files themselves (OS/2 table).
//   PRODUCT   our own default where the guide is silent. Labelled as such; it is a
//             choice, not a requirement anyone published.
//
// Three premises of the original hit list are contradicted by the guides and are NOT
// built to: "serif" (Nature, ACS and Cell want sans; serif lives in the Thesis preset),
// "8-9 pt" (Nature caps ALL non-panel text at 7 pt), and Nature's "170 mm max height"
// from the brief's table (the official artwork PDF says the full page depth is 247 mm).
//
// UNITS. 1in = 96px = 72pt = 25.4mm. Source: CSS Values and Units Level 4, section 6.2
// "Absolute lengths" (https://www.w3.org/TR/css-values-4/#absolute-lengths): "1in is
// equal to 2.54cm = 96px", "1pt = 1/72th of 1in". Word sizes pictures in points and
// converts SVG px at the same 96/in, so a builder that draws at mmToPx(width) and is
// inserted at that px size is printed at exactly `width` mm.
//
// THE CHECKER IS NOT A FIXER. checkSvgAgainstPreset() measures every <text>/<tspan> run
// at a stated physical width and reports what violates the preset. It never rewrites a
// font size: enlarging text in place creates collisions that only the geometry gate
// (scripts/check-figures.js) can see, and that gate is the integrator's. Builders must
// render AT the preset (canvasPx / fontPx below); the checker proves they did.

// ---------------------------------------------------------------------------
// Physical units (CSS Values 4, section 6.2; see header)
// ---------------------------------------------------------------------------

/** CSS px per inch. CSS Values 4 section 6.2: "1in = 96px". */
export const PX_PER_INCH = 96;
/** mm per inch: the international inch, exactly 25.4 mm (CSS Values 4: "1in = 2.54cm"). */
export const MM_PER_INCH = 25.4;
/** pt per inch. CSS Values 4 section 6.2: "1pt = 1/72th of 1in". */
export const PT_PER_INCH = 72;

export function mmToPx(mm: number): number {
  return (mm * PX_PER_INCH) / MM_PER_INCH;
}
export function pxToMm(px: number): number {
  return (px * MM_PER_INCH) / PX_PER_INCH;
}
export function ptToPx(pt: number): number {
  return (pt * PX_PER_INCH) / PT_PER_INCH;
}
export function pxToPt(px: number): number {
  return (px * PT_PER_INCH) / PX_PER_INCH;
}
export function ptToMm(pt: number): number {
  return (pt * MM_PER_INCH) / PT_PER_INCH;
}
export function mmToPt(mm: number): number {
  return (mm * PT_PER_INCH) / MM_PER_INCH;
}

// ---------------------------------------------------------------------------
// Offline font stacks
// ---------------------------------------------------------------------------
// No web fonts: the product precaches everything (v2.127.0 offline delivery), an SVG
// rasterised through <img> cannot fetch fonts, and on the vector route Word resolves the
// family from the system. Arial and Times New Roman ship with Windows and macOS;
// Helvetica and Times ship with macOS (brief A.4). Names with spaces use SINGLE quotes so
// the stack can sit inside a double-quoted font-family="..." attribute.

/** Nature: "All text should be in a sans-serif typeface, preferably Helvetica or Arial." */
export const FONT_STACK_SANS = "Arial, Helvetica, sans-serif";
/** Thesis body face. Times New Roman (Windows, macOS), Times (macOS). */
export const FONT_STACK_SERIF = "'Times New Roman', Times, serif";
/** Nature: "Amino acid sequences should be presented in one-letter code in Courier." */
export const FONT_STACK_MONO = "'Courier New', Courier, monospace";

/**
 * Cap height as a fraction of the em, MEASURED from the OS/2 table (sCapHeight /
 * head.unitsPerEm) of the font files in C:\Windows\Fonts on 2026-10-14:
 *   arial.ttf 1467/2048 = 0.7163, arialbd.ttf 1466/2048 = 0.7158,
 *   times.ttf 1356/2048 = 0.6621, timesbd.ttf 1356/2048 = 0.6621,
 *   georgia.ttf 1419/2048 = 0.6929, cour.ttf 1170/2048 = 0.5713.
 * Helvetica (macOS only, not on this machine): CapHeight 718/1000 in Adobe's Core 14
 * Helvetica.afm. A stack is rated by its WORST named member: the renderer may pick any.
 */
export const CAP_HEIGHT_EM: Readonly<Record<string, number>> = {
  arial: 1466 / 2048,
  helvetica: 718 / 1000,
  "times new roman": 1356 / 2048,
  times: 1356 / 2048,
  georgia: 1419 / 2048,
  "courier new": 1170 / 2048,
  // segoeui.ttf / segoeuib.ttf 1434/2048 = 0.7002 (measured, same date). Used by ~25 corpus figures.
  "segoe ui": 1434 / 2048,
  // Generic families. ASSUMPTION, not fetched or tested: Chromium/Edge WebView2 default
  // sans-serif to Arial and serif to Times New Roman on Windows, WebKit to Helvetica and
  // Times on macOS, and Word resolves a CSS generic the same way on the vector route.
  // Worst of each pair:
  "sans-serif": Math.min(1466 / 2048, 718 / 1000),
  serif: 1356 / 2048,
};

/**
 * x-height (height of a lowercase "x") as a fraction of the em, MEASURED from the OS/2
 * table (sxHeight / head.unitsPerEm) of the font files in C:\Windows\Fonts on
 * 2026-10-15 (v2.143.0 integrator; the cap heights above were re-read in the same pass
 * and agree to the unit):
 *   arial.ttf / arialbd.ttf 1062/2048 = 0.5186, times.ttf 916/2048 = 0.4473,
 *   timesbd.ttf 935/2048 = 0.4565, georgia.ttf 986/2048 = 0.4814,
 *   cour.ttf 866/2048 = 0.4229, segoeui.ttf / segoeuib.ttf 1024/2048 = 0.5000.
 * Helvetica: XHeight 523/1000 in Adobe's Core 14 Helvetica.afm.
 *
 * WHY IT IS NEEDED. 37 CFR 1.84(p)(3) measures "letters", and a lowercase letter is
 * only x-height tall: "Control" at a size whose CAPITALS clear 3.2 mm has an "o" of
 * 2.3 mm. Measuring every run by cap height passed it.
 */
export const X_HEIGHT_EM: Readonly<Record<string, number>> = {
  arial: 1062 / 2048,
  helvetica: 523 / 1000,
  "times new roman": 916 / 2048,
  times: 916 / 2048,
  georgia: 986 / 2048,
  "courier new": 866 / 2048,
  "segoe ui": 1024 / 2048,
  "sans-serif": Math.min(1062 / 2048, 523 / 1000),
  serif: 916 / 2048,
};

/** Worst x-height ratio over every family in a stack, or null if any family is unknown. */
export function stackXHeightEm(stack: string): number | null {
  let worst: number | null = null;
  for (const raw of stack.split(",")) {
    const name = raw.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
    if (!name) continue;
    const r = X_HEIGHT_EM[name];
    if (r === undefined) return null;
    worst = worst === null ? r : Math.min(worst, r);
  }
  return worst;
}

/** Unicode super/subscript characters: drawn smaller than the run's font-size; height not measured. */
const SUPSUB_RE = /[\u00b2\u00b3\u00b9\u2070-\u209f]/;
/** A lowercase letter: the run's smallest letters are only x-height tall. */
const LOWER_RE = /\p{Ll}/u;

/**
 * Worst (smallest) cap-height ratio over EVERY family in a stack, or null if any family
 * in it is unknown: the renderer may pick any member, so an unknown member (say a
 * "Segoe UI Variable" listed first) makes the height unknown, not "as good as Arial".
 */
export function stackCapHeightEm(stack: string): number | null {
  let worst: number | null = null;
  for (const raw of stack.split(",")) {
    const name = raw.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
    if (!name) continue;
    const r = CAP_HEIGHT_EM[name];
    if (r === undefined) return null;
    worst = worst === null ? r : Math.min(worst, r);
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type PresetId = "nature" | "elsevier" | "acs" | "cell" | "thesis" | "uspto";

export interface PanelLetterRule {
  /** "a, b, c" vs "A, B, C". */
  letterCase: "lower" | "upper";
  weight: "bold" | "normal";
  sizePt: number;
  /** Text around the letter, e.g. "(a)" for the thesis default. */
  prefix: string;
  suffix: string;
  /** USPTO: the letter is a suffix to the view number ("FIG. 1A"), not a free label. */
  figurePrefix: boolean;
  source: string;
}

export interface FigureStylePreset {
  id: PresetId;
  /** User-facing name. Contains "from secondary source" when the guide could not be fetched. */
  name: string;
  /** One-paragraph user-facing description, including source caveats. */
  description: string;
  secondarySource: boolean;
  widthsMm: { single: number; oneAndHalf: number[]; double: number };
  /** Max printed height (mm), or null when no fetched source states one. */
  maxHeightMm: number | null;
  fontFamily: string;
  /** Point-size ladder at final printed size. min/max bound EVERY text run except panel letters. */
  sizesPt: { min: number; max: number | null; tick: number; label: number; legend: number; title: number };
  /** Minimum stroke width at print size, or null when no fetched source states one. */
  minStrokePt: number | null;
  panelLetter: PanelLetterRule;
  /** "bw" = black and white only (USPTO 1.84(a)(1)). */
  color: "any" | "bw";
  /** Whether a figure title belongs inside the artwork. */
  allowTitle: boolean;
  /** Line-art raster resolution when a raster must be supplied, or null. */
  lineArtDpi: number | null;
  /** USPTO only: minimum character (cap/numeral) height in mm, 1.84(p)(3). */
  minCharHeightMm: number | null;
  /**
   * USPTO only: the safety margin the check REQUIRES above minCharHeightMm (0.1 =
   * every character at least 10 % taller than the rule). A figure that clears the
   * rule by 0.002 mm complies on paper and fails after one printer's or one PDF
   * converter's rounding; the style refuses it rather than ship it.
   */
  charHeightMargin?: number;
  /** Table->Chart kinds this preset cannot draw faithfully, so the pane must refuse them. */
  refusedChartKinds: string[];
  /**
   * Where the numbers came from, as citations WITHOUT the "https://" scheme. They
   * are data, never addresses: the network-surface test (networkSurface.test.ts)
   * exempts URLs only on comment lines, so a URL literal here would read as code
   * that could be fetched. The full https:// form of each is in the comment above
   * the preset.
   */
  sources: string[];
}

const SECONDARY = " (from secondary source)";

/**
 * Nature. OFFICIAL: https://www.nature.com/documents/nature-final-artwork.pdf (fetched
 * and text-extracted 2026-10-14) and research-figure-guide.nature.com/figures/
 * preparing-figures-our-specifications/ (fetched 2026-10-14).
 */
const NATURE: FigureStylePreset = {
  id: "nature",
  name: "Nature",
  description:
    "Nature: 89 mm single / 183 mm double column, sans-serif (Helvetica/Arial), all text 5–7 pt, " +
    "panel letters 8 pt bold lowercase. Text must stay editable, never outlined.",
  secondarySource: false,
  widthsMm: {
    // PDF: "Nature's standard figure sizes are 89 mm (single column) and 183 mm (double column)."
    single: 89,
    // PDF: "Figures can also be 1.5 columns where necessary - 120 mm or 136 mm."
    oneAndHalf: [120, 136],
    double: 183,
  },
  // PDF: "The full depth of the page is 247 mm." (The brief's 170 mm is NOT in either source.)
  maxHeightMm: 247,
  // PDF: "All text should be in a sans-serif typeface, preferably Helvetica or Arial."
  fontFamily: FONT_STACK_SANS,
  sizesPt: {
    // PDF: "Minimum text size: 5pt." / guide: "Minimum text size: 5 pt"
    min: 5,
    // PDF: "Maximum text size for all other text: 7pt."
    max: 7,
    tick: 6, // PRODUCT: inside the official 5-7 band
    label: 7, // PRODUCT: inside the official 5-7 band
    legend: 6, // PRODUCT: inside the official 5-7 band
    title: 7, // PRODUCT: capped by the official 7 pt maximum
  },
  minStrokePt: null, // no stroke minimum in either fetched Nature source
  panelLetter: {
    letterCase: "lower",
    weight: "bold",
    // Guide: "labelled with 8-pt bold, upright (not italic) and lowercase a, b, c, etc."
    sizePt: 8,
    prefix: "",
    suffix: "",
    figurePrefix: false,
    source: "OFFICIAL research-figure-guide.nature.com: 8-pt bold, upright, lowercase a, b, c",
  },
  color: "any",
  allowTitle: true,
  // PDF: "Do not rasterize line art or text in submitted figures." (vector only)
  lineArtDpi: null,
  minCharHeightMm: null,
  refusedChartKinds: [],
  sources: [
    "www.nature.com/documents/nature-final-artwork.pdf",
    "research-figure-guide.nature.com/figures/preparing-figures-our-specifications/",
  ],
};

/**
 * Elsevier. OFFICIAL: elsevier.com/about/policies-and-standards/author/
 * artwork-and-media-instructions/artwork-sizing and .../artwork-overview (both fetched
 * 2026-10-14).
 */
const ELSEVIER: FigureStylePreset = {
  id: "elsevier",
  name: "Elsevier",
  description:
    "Elsevier: 90 mm single / 140 mm 1.5 / 190 mm double column, 7 pt text (sub- and superscripts " +
    "no smaller than 6 pt). Panel-letter style varies by journal; this preset uses a product default.",
  secondarySource: false,
  // Sizing page: "Single column" 90 mm, "1.5 column" 140 mm, "Double column (full width)" 190 mm.
  widthsMm: { single: 90, oneAndHalf: [140], double: 190 },
  maxHeightMm: null, // not stated on the fetched sizing page
  // Overview page recommends only Arial (or Helvetica), Courier, Symbol, Times (or Times New Roman).
  fontFamily: FONT_STACK_SANS,
  sizesPt: {
    // Sizing page: "a finished, printed size of 7 pt for normal text". The 6 pt floor it
    // also states is ONLY "for subscript and superscript characters"; builders write
    // those as Unicode superscripts at the run's own size, and the checker cannot tell a
    // sub/superscript run apart, so the floor applied to every run is 7.
    min: 7,
    max: null, // no maximum stated
    tick: 7, // Sizing page: 7 pt normal text

    label: 7,
    legend: 7,
    title: 8, // PRODUCT
  },
  minStrokePt: null, // not stated on either fetched Elsevier page
  panelLetter: {
    letterCase: "lower",
    weight: "bold",
    sizePt: 8, // PRODUCT (Elsevier states no panel-letter size)
    prefix: "",
    suffix: "",
    figurePrefix: false,
    source: "PRODUCT default: Elsevier leaves panel labels to each journal",
  },
  color: "any",
  allowTitle: true,
  // Overview page (TIFF export): "fill in for a graph 1000 dpi and others 500 dpi"
  lineArtDpi: 1000,
  minCharHeightMm: null,
  refusedChartKinds: [],
  sources: [
    "www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions/artwork-sizing",
    "www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions/artwork-overview",
  ],
};

/**
 * ACS. SECONDARY. pubs.acs.org/page/4authors/submission/graphics_prep.html and
 * pubs.acs.org/pb-assets/documents/Preparing_Graphics.pdf both returned HTTP 403 (bot
 * wall) on 2026-10-14; researcher-resources.acs.org links to them without the numbers; the
 * Wayback Machine holds no snapshot. Values are from a mirror of ACS "Preparing Graphics"
 * at journals.iub.edu.pk/index.php/ntp/PreparingGraphics (as summarised by search on
 * 2026-10-14; the mirror itself refused the connection) and the brief's earlier read:
 * "up to 240 points wide (3.33 in.)", double column "between 300 and 504 points"
 * (4.167-7 in), lettering "no smaller than 4.5 points in the final published size",
 * Helvetica or Arial. Max depth 9.17 in is from the brief's C.2 row (same mirror).
 */
const ACS: FigureStylePreset = {
  id: "acs",
  name: "ACS" + SECONDARY,
  description:
    "ACS journals" + SECONDARY + ": the official ACS page could not be fetched, so these numbers come " +
    "from a mirror of ACS 'Preparing Graphics'. Single column up to 3.33 in (84.7 mm), double column " +
    "4.17–7 in (up to 177.8 mm), Helvetica/Arial, lettering at least 4.5 pt. Check your journal's " +
    "current author guidelines before submitting.",
  secondarySource: true,
  widthsMm: {
    single: (240 / 72) * MM_PER_INCH, // 240 pt = 3.33 in = 84.67 mm (secondary)
    oneAndHalf: [(300 / 72) * MM_PER_INCH], // 300 pt = 4.167 in = 105.8 mm, the double-column minimum (secondary)
    double: (504 / 72) * MM_PER_INCH, // 504 pt = 7 in = 177.8 mm (secondary)
  },
  maxHeightMm: 9.17 * MM_PER_INCH, // 9.17 in = 232.9 mm (secondary, brief C.2)
  fontFamily: FONT_STACK_SANS, // "Helvetica or Arial fonts work well" (secondary)
  sizesPt: {
    min: 4.5, // "no smaller than 4.5 points in the final published format" (secondary)
    max: null,
    tick: 6, // PRODUCT
    label: 7, // PRODUCT
    legend: 6, // PRODUCT
    title: 8, // PRODUCT
  },
  minStrokePt: null,
  panelLetter: {
    letterCase: "upper",
    weight: "bold",
    sizePt: 8, // PRODUCT (no ACS panel-letter size could be read)
    prefix: "",
    suffix: "",
    figurePrefix: false,
    source: "PRODUCT default: ACS leaves panel labels to each journal",
  },
  color: "any",
  allowTitle: true,
  lineArtDpi: null, // not established from any source we could read
  minCharHeightMm: null,
  refusedChartKinds: [],
  sources: ["journals.iub.edu.pk/index.php/ntp/PreparingGraphics (mirror; official pubs.acs.org returned 403)"],
};

/**
 * Cell Press. SECONDARY. cell.com/figureguidelines, cell.com/information-for-authors/
 * figure-guidelines and the cell.com figure-guide PDF all returned HTTP 403 (bot wall) on
 * 2026-10-14; the Wayback snapshot (20231230) answered 429. Third-party summaries agree on
 * 85 mm single and 114 mm 1.5 column, Arial/Helvetica, uppercase panel letters, 1000 dpi
 * line art; they DISAGREE on full width (174 mm in most, 178 mm in one) and on text size
 * (6-8 pt vs 7-8 pt). We take 174 mm (majority, and the narrower is safe either way) and
 * 6-8 pt (the wider band, so a 6 pt tick is not flagged on a guess).
 */
const CELL: FigureStylePreset = {
  id: "cell",
  name: "Cell Press" + SECONDARY,
  description:
    "Cell Press" + SECONDARY + ": the official Cell figure guidelines could not be fetched, and the " +
    "secondary sources disagree (full width 174 vs 178 mm; text 6–8 vs 7–8 pt). This preset uses " +
    "85 / 114 / 174 mm, Arial/Helvetica, 6–8 pt, uppercase bold A, B, C. Check cell.com before submitting.",
  secondarySource: true,
  widthsMm: { single: 85, oneAndHalf: [114], double: 174 }, // secondary; 178 mm also reported
  maxHeightMm: null, // one secondary source says 230 mm; not corroborated
  fontFamily: FONT_STACK_SANS, // "Arial or Helvetica" (secondary, all sources agree)
  sizesPt: {
    min: 6, // secondary: "6-8 pt" (another source says 7-8 pt)
    max: 8, // secondary
    tick: 6, // PRODUCT, inside the secondary band
    label: 7, // PRODUCT
    legend: 7, // PRODUCT
    title: 8, // PRODUCT
  },
  minStrokePt: null,
  panelLetter: {
    letterCase: "upper",
    weight: "bold",
    sizePt: 8, // PRODUCT, at the top of the secondary 6-8 pt band
    prefix: "",
    suffix: "",
    figurePrefix: false,
    source: "SECONDARY: Cell uses uppercase panel labels A, B, C",
  },
  color: "any",
  allowTitle: true,
  lineArtDpi: 1000, // secondary: "1000 DPI for line art" at final size (all sources agree)
  minCharHeightMm: null,
  refusedChartKinds: [],
  sources: ["www.cell.com/figureguidelines (403; values from third-party summaries)"],
};

/**
 * Thesis (serif). PRODUCT preset: no publisher stands behind it, and the description says
 * so. Widths fit both common text blocks: US Letter 8.5 in less 1.5 in binding + 1 in
 * outer margin = 6 in (152.4 mm); A4 210 mm less 30 + 25 mm margins = 155 mm. 150 mm full
 * width therefore fits either; 75 mm is half. Sizes sit under a 12 pt Times body so figure
 * text reads as smaller than the prose, never as a different document.
 */
const THESIS: FigureStylePreset = {
  id: "thesis",
  name: "Thesis (serif)",
  description:
    "Thesis (serif): a product default, not a publisher's rule. Times New Roman to match a Times body, " +
    "75 mm half / 150 mm full width (fits Letter and A4 with binding margins), 8–12 pt text, bold (a), (b), (c).",
  secondarySource: false,
  widthsMm: { single: 75, oneAndHalf: [112.5], double: 150 }, // PRODUCT (see block comment)
  maxHeightMm: 220, // PRODUCT: A4 297 less 25 + 25 mm margins = 247, less room for a caption
  fontFamily: FONT_STACK_SERIF,
  sizesPt: { min: 8, max: 12, tick: 9, label: 10, legend: 9, title: 11 }, // PRODUCT
  minStrokePt: null,
  panelLetter: {
    letterCase: "lower",
    weight: "bold",
    sizePt: 11, // PRODUCT
    prefix: "(",
    suffix: ")",
    figurePrefix: false,
    source: "PRODUCT default",
  },
  color: "any",
  allowTitle: true,
  lineArtDpi: null,
  minCharHeightMm: null,
  refusedChartKinds: [],
  sources: ["product default"],
};

/**
 * Minimum character height, 37 CFR 1.84(p)(3), OFFICIAL, eCFR versioner API
 * (https://www.ecfr.gov/api/versioner/v1/full/2026-10-01/title-37.xml?part=1&section=1.84,
 * fetched 2026-10-14): "Numbers, letters, and reference characters must measure at least
 * .32 cm. (1/8 inch) in height."
 *
 * INTERPRETATION (stated, because the rule measures CHARACTERS, not font-size): we read
 * "height" as cap/numeral height, which is how a drafter measures a reference numeral.
 * font-size >= 3.2 mm / capHeightEm. For the USPTO stack the worst named member is Arial
 * Bold at 0.7158 em, giving 4.47 mm = 12.67 pt. A LOWERCASE letter (x-height 0.5186 em in
 * Arial) would need 17.5 pt to reach 3.2 mm; keep patent text to numerals and capitals.
 */
export const USPTO_MIN_CHAR_HEIGHT_MM = 3.2;
const USPTO_STACK = FONT_STACK_SANS;
/** font-size (pt) whose cap height in the USPTO stack is exactly 3.2 mm. */
export const USPTO_MIN_FONT_PT = mmToPt(USPTO_MIN_CHAR_HEIGHT_MM / (stackCapHeightEm(USPTO_STACK) as number));
/**
 * The margin the USPTO style keeps over 1.84(p)(3): 10 %. v2.143.0 measured the
 * as-drawn patent-mode Table->Chart at 170 mm clearing 3.2 mm by 0.002 mm.
 */
export const USPTO_CHAR_HEIGHT_MARGIN = 0.1;
/** 3.52 mm: the character height the USPTO style actually requires. */
export const USPTO_REQUIRED_CHAR_HEIGHT_MM = USPTO_MIN_CHAR_HEIGHT_MM * (1 + USPTO_CHAR_HEIGHT_MARGIN);
/** 13.94 pt: the font-size whose cap height in the USPTO stack is USPTO_REQUIRED_CHAR_HEIGHT_MM. */
export const USPTO_REQUIRED_FONT_PT = USPTO_MIN_FONT_PT * (1 + USPTO_CHAR_HEIGHT_MARGIN);

const USPTO: FigureStylePreset = {
  id: "uspto",
  name: "USPTO drawing (black and white)",
  description:
    "USPTO patent drawing under 37 CFR 1.84: black and white only, hatch fills instead of colour, " +
    "numbers and letters at least 0.32 cm (1/8 in) high, no title in the artwork, views labelled FIG. 1, " +
    "FIG. 1A. Not a journal preset with the colour removed.",
  secondarySource: false,
  widthsMm: {
    // 1.84(g): "a sight no greater than 17.0 cm. by 26.2 cm. on ... (DIN size A4) drawing sheets,
    // and a sight no greater than 17.6 cm. by 24.4 cm. ... on 21.6 cm. by 27.9 cm." The narrower
    // A4 sight (170 mm) fits both sheet sizes. Patent sheets have no columns, so "single"
    // is the full sight too: a caller that omits the width checks at 170 mm, not a guess.
    single: 170,
    oneAndHalf: [],
    double: 170,
  },
  // 1.84(g): min of 262 mm (A4 sight) and 244 mm (Letter sight) so the view fits either sheet.
  maxHeightMm: 244,
  fontFamily: USPTO_STACK,
  sizesPt: {
    min: USPTO_REQUIRED_FONT_PT, // 1.84(p)(3) via cap height (see interpretation above), plus the 10 % margin
    max: null,
    // PRODUCT, raised 13 -> 14 pt in v2.143.0. renderAtPreset lands a figure's
    // SMALLEST text on `tick`, so this number IS the margin over the rule. 13 pt gave
    // capitals 3.28 mm (2.6 % over 3.2 mm) and the patent-mode Table->Chart text
    // cleared by 0.002 mm, and only at exactly 170 mm. 14 pt: 3.54 mm, a 10.5 %
    // margin, which survives a printer's or a converter's rounding.
    tick: 14,
    label: 15, // PRODUCT
    legend: 14, // PRODUCT
    title: 15, // PRODUCT; titles are not drawn (allowTitle false) but FIG. labels use it
  },
  minStrokePt: null, // 1.84(l) asks for lines "heavy enough to permit adequate reproduction"; no number
  panelLetter: {
    letterCase: "upper",
    weight: "normal",
    sizePt: 14, // PRODUCT, above the 12.67 pt (p)(3) floor
    prefix: "FIG. ",
    suffix: "",
    // 1.84(u)(1) (eCFR, fetched 2026-10-14): partial views get the same number followed by a
    // capital letter, and view numbers must be preceded by "FIG.". 1.84(p)(1): reference
    // characters must not be "used in association with brackets or inverted commas".
    figurePrefix: true,
    source: "OFFICIAL 37 CFR 1.84(u)(1): view number + capital letter, preceded by FIG.",
  },
  // 1.84(a)(1): "Black and white drawings are normally required." Colour needs a petition (a)(2).
  color: "bw",
  allowTitle: false,
  lineArtDpi: null,
  minCharHeightMm: USPTO_MIN_CHAR_HEIGHT_MM,
  charHeightMargin: USPTO_CHAR_HEIGHT_MARGIN,
  // MEASURED on 2026-10-14: Table->Chart's patent mode draws these with grey fills or
  // non-black ink (nonBlackWhitePaints finds them), so under this preset they are refused,
  // not silently emitted. figureStyle.test.ts re-measures every kind both ways: a kind
  // that becomes pure black and white must be removed from this list.
  refusedChartKinds: ["heatmap", "candlestick"],
  sources: ["www.ecfr.gov/api/versioner/v1/full/2026-10-01/title-37.xml?part=1&section=1.84"],
};

export const FIGURE_PRESETS: Readonly<Record<PresetId, FigureStylePreset>> = {
  nature: NATURE,
  elsevier: ELSEVIER,
  acs: ACS,
  cell: CELL,
  thesis: THESIS,
  uspto: USPTO,
};

export const PRESET_IDS: readonly PresetId[] = ["nature", "elsevier", "acs", "cell", "thesis", "uspto"];

export function getPreset(id: string): FigureStylePreset | null {
  return (FIGURE_PRESETS as Record<string, FigureStylePreset>)[id] ?? null;
}

export type PresetWidth = "single" | "oneAndHalf" | "double";

/** Printed width in mm. "oneAndHalf" takes the first listed 1.5-column width; null if the preset has none. */
export function presetWidthMm(p: FigureStylePreset, which: PresetWidth = "single"): number | null {
  if (which === "oneAndHalf") return p.widthsMm.oneAndHalf.length ? p.widthsMm.oneAndHalf[0] : null;
  return p.widthsMm[which];
}

/** Canvas width in CSS px for a builder that draws natively at the preset's printed width. */
export function canvasPx(p: FigureStylePreset, which: PresetWidth = "single"): number | null {
  const mm = presetWidthMm(p, which);
  return mm === null ? null : mmToPx(mm);
}

export type TextRole = "tick" | "label" | "legend" | "title" | "panelLetter";

/** Font size in CSS px for a text role, for a builder drawing at canvasPx(). */
export function fontPx(p: FigureStylePreset, role: TextRole): number {
  return ptToPx(role === "panelLetter" ? p.panelLetter.sizePt : p.sizesPt[role]);
}

// ---------------------------------------------------------------------------
// Panel letters
// ---------------------------------------------------------------------------

/** Bijective base-26: 0 → a, 25 → z, 26 → aa. */
function letters(index: number): string {
  let n = Math.floor(index) + 1;
  let s = "";
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/**
 * The label for panel `index` (0-based). Nature "a", Cell "A", Thesis "(a)", USPTO
 * "FIG. 1A" (figureNumber defaults to 1). Refuses a non-finite or negative index.
 */
export function panelLabel(p: FigureStylePreset, index: number, figureNumber = 1): string {
  if (!Number.isFinite(index) || index < 0 || index > 10000) {
    throw new RangeError(`panel index must be a whole number from 0 to 10000, got ${index}`);
  }
  const r = p.panelLetter;
  let l = letters(index);
  if (r.letterCase === "upper") l = l.toUpperCase();
  if (r.figurePrefix) {
    if (!Number.isFinite(figureNumber) || figureNumber < 1) {
      throw new RangeError(`figure number must be 1 or more, got ${figureNumber}`);
    }
    return `${r.prefix}${Math.floor(figureNumber)}${l}${r.suffix}`;
  }
  return `${r.prefix}${l}${r.suffix}`;
}

/** An SVG <text> for a panel label, top-left anchored at (x, baseline y), in the preset's style. */
export function panelLetterSvg(p: FigureStylePreset, index: number, x: number, y: number, figureNumber = 1): string {
  const r = p.panelLetter;
  const size = +ptToPx(r.sizePt).toFixed(4);
  const weight = r.weight === "bold" ? ` font-weight="bold"` : "";
  return `<text x="${x}" y="${y}" font-family="${p.fontFamily}" font-size="${size}"${weight} fill="#000">${panelLabel(p, index, figureNumber)}</text>`;
}

// ---------------------------------------------------------------------------
// USPTO black-and-white fills, dashes and markers
// ---------------------------------------------------------------------------
// Extracted BY FUNCTION from tablechart.ts's patent style (PATENT_FILLS, PATENT_DASHES,
// patentDefs, markerSvg), byte-identical, so the patent preset owns them and tablechart
// imports them. Pattern ids (fi-diag ...) are unchanged: existing figures reference them.

/**
 * Fills for the patent style: solid black, white, then hatch patterns. Series
 * beyond the list cycle. Bars/slices always get a black outline so white and
 * pattern fills read as closed shapes.
 */
export const USPTO_FILLS = [
  "#000",
  "#fff",
  "url(#fi-diag)",
  "url(#fi-rdiag)",
  "url(#fi-cross)",
  "url(#fi-horiz)",
  "url(#fi-vert)",
  "url(#fi-dots)",
];

/** Dash patterns distinguishing line/area series in the patent style. */
export const USPTO_DASHES = ["", "7 3", "2.5 2.5", "9 3 2.5 3", "12 4", "5 4 1.5 4"];

/** SVG <defs> with the hatch patterns used by USPTO_FILLS. */
export function usptoPatternDefs(): string {
  const line = (rot: number): string =>
    `<pattern id="fi-${rot === 45 ? "diag" : "rdiag"}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(${rot})"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-width="1.1"/></pattern>`;
  return (
    "<defs>" +
    line(45) +
    line(-45) +
    `<pattern id="fi-cross" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-width="0.9"/><line x1="0" y1="0" x2="5" y2="0" stroke="#000" stroke-width="0.9"/></pattern>` +
    `<pattern id="fi-horiz" patternUnits="userSpaceOnUse" width="5" height="5"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="2.5" x2="5" y2="2.5" stroke="#000" stroke-width="1.1"/></pattern>` +
    `<pattern id="fi-vert" patternUnits="userSpaceOnUse" width="5" height="5"><rect width="5" height="5" fill="#fff"/><line x1="2.5" y1="0" x2="2.5" y2="5" stroke="#000" stroke-width="1.1"/></pattern>` +
    `<pattern id="fi-dots" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="#fff"/><circle cx="3" cy="3" r="1.1" fill="#000"/></pattern>` +
    "</defs>"
  );
}

/** Marker shape for patent-style line/area series i, centered on (cx, cy). */
export function usptoMarkerSvg(i: number, cx: number, cy: number): string {
  const x = cx.toFixed(1);
  const y = cy.toFixed(1);
  const r = 3;
  switch (i % 6) {
    case 0:
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="#000"/>`;
    case 1:
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#000" stroke-width="1"/>`;
    case 2:
      return `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="#000"/>`;
    case 3:
      return `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="#fff" stroke="#000" stroke-width="1"/>`;
    case 4:
      return `<path d="M${x},${(cy - r - 0.5).toFixed(1)} L${(cx + r + 0.5).toFixed(1)},${(cy + r).toFixed(1)} L${(cx - r - 0.5).toFixed(1)},${(cy + r).toFixed(1)} Z" fill="#000"/>`;
    default:
      return `<path d="M${x},${(cy - r - 0.5).toFixed(1)} L${(cx + r + 0.5).toFixed(1)},${(cy + r).toFixed(1)} L${(cx - r - 0.5).toFixed(1)},${(cy + r).toFixed(1)} Z" fill="#fff" stroke="#000" stroke-width="1"/>`;
  }
}

// ---------------------------------------------------------------------------
// Measuring rendered SVG
// ---------------------------------------------------------------------------

export interface MeasuredText {
  text: string;
  /** Resolved font-size in the element's own user units. */
  fontSizeUser: number;
  /** font-size times every ancestor transform / nested-viewport scale: size in ROOT user units. */
  fontSizeRoot: number;
  /** Printed size in pt when the root is placed `widthMm` wide. */
  pt: number;
  /** Cap height in mm for the run's resolved family (worst named member), or null. */
  capHeightMm: number | null;
  /**
   * Height of the run's SMALLEST characters in mm: x-height when it contains a
   * lowercase letter, else cap height; null when the family is unknown or the run
   * holds super/subscript characters (drawn smaller than its font-size, unmeasured).
   */
  charHeightMm: number | null;
  family: string;
  /** Resolved font-weight is bold (keyword bold/bolder or numeric >= 600). */
  bold: boolean;
}

export interface SvgTextMeasurement {
  widthMm: number;
  /** Root user-unit width (viewBox width, else width attribute). */
  rootWidthUser: number;
  texts: MeasuredText[];
  minPt: number | null;
  maxPt: number | null;
  /** Things the parser could not resolve (a <style> sheet, a relative keyword size). Never silently passed. */
  unresolved: string[];
}

interface Frame {
  tag: string;
  fontPx: number;
  family: string;
  bold: boolean;
  scale: number;
  skip: boolean;
  isText: boolean;
}

const ATTR_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(s)) !== null) out[m[1]] = m[2] !== undefined ? m[2] : (m[3] ?? "");
  return out;
}

function styleProp(style: string | undefined, prop: string): string | undefined {
  if (!style) return undefined;
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(style);
  return m ? m[1].trim().replace(/\s*!important$/i, "") : undefined;
}

/** CSS beats the presentation attribute (SVG 2, section 6.8). */
function prop(attrs: Record<string, string>, name: string): string | undefined {
  return styleProp(attrs.style, name) ?? attrs[name];
}

/** Font-size to px given the parent's px. null = unresolvable (keyword etc.). */
function resolveFontSize(v: string, parentPx: number): number | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|q|em|%)?\s*$/i.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  switch ((m[2] ?? "px").toLowerCase()) {
    case "px":
      return n;
    case "pt":
      return ptToPx(n);
    case "pc":
      return ptToPx(n * 12);
    case "mm":
      return mmToPx(n);
    case "cm":
      return mmToPx(n * 10);
    case "q":
      return mmToPx(n / 4);
    case "in":
      return n * PX_PER_INCH;
    case "em":
      return n * parentPx;
    case "%":
      return (n / 100) * parentPx;
    default:
      return null;
  }
}

/** Vertical scale factor contributed by a transform list (what a glyph's height is multiplied by). */
function transformScale(t: string | undefined): number {
  if (!t) return 1;
  let s = 1;
  const re = /(matrix|scale|translate|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const nums = m[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (m[1] === "scale" && nums.length) s *= Math.abs(nums.length > 1 ? nums[1] : nums[0]);
    else if (m[1] === "matrix" && nums.length === 6) s *= Math.hypot(nums[2], nums[3]);
  }
  return Number.isFinite(s) ? s : 1;
}

function numAttr(v: string | undefined): number | null {
  if (v === undefined) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(px)?\s*$/.exec(v);
  return m ? parseFloat(m[1]) : null;
}

function viewBoxWidth(v: string | undefined): number | null {
  if (!v) return null;
  const p = v
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return p.length === 4 && Number.isFinite(p[2]) && p[2] > 0 ? p[2] : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;

/** Elements whose subtree is not drawn where it stands. */
const NON_RENDERED = new Set(["defs", "pattern", "clippath", "mask", "marker", "symbol", "title", "desc", "metadata", "style", "script"]);

/**
 * Measure every rendered text run in `svg`, as printed when the ROOT is placed
 * `widthMm` wide. Font-size is resolved through attributes, style="", ancestors and
 * em/% units (CSS initial 16px), and multiplied by every ancestor transform scale and
 * nested <svg> viewport scale. A text run inside <defs>/<pattern>/<title> is not drawn
 * and is skipped.
 */
export function measureSvgText(svg: string, widthMm: number): SvgTextMeasurement {
  const unresolved: string[] = [];
  const texts: MeasuredText[] = [];
  if (!(Number.isFinite(widthMm) && widthMm > 0)) throw new RangeError(`widthMm must be a positive number, got ${widthMm}`);
  const stack: Frame[] = [{ tag: "#root", fontPx: 16, family: "serif", bold: false, scale: 1, skip: false, isText: false }];
  let rootWidthUser: number | null = null;
  let mmPerUser = 0;
  let steps = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(svg)) !== null) {
    if (++steps > 2_000_000) {
      unresolved.push("document too large to measure (token cap)");
      break;
    }
    const top = stack[stack.length - 1];
    const textRun = m[6] ?? m[1];
    if (textRun !== undefined) {
      if (!top.isText || top.skip) continue;
      const text = decodeEntities(textRun).trim();
      if (!text) continue;
      const pt = pxToPt(top.fontPx * top.scale * mmToPx(mmPerUser));
      const cap = stackCapHeightEm(top.family);
      texts.push({
        text,
        fontSizeUser: top.fontPx,
        fontSizeRoot: top.fontPx * top.scale,
        pt,
        capHeightMm: cap === null ? null : ptToMm(pt) * cap,
        charHeightMm: (() => {
          if (SUPSUB_RE.test(text)) return null;
          const r = LOWER_RE.test(text) ? stackXHeightEm(top.family) : cap;
          return r === null ? null : ptToMm(pt) * r;
        })(),
        family: top.family,
        bold: top.bold,
      });
      continue;
    }
    const tagName = m[3];
    if (tagName === undefined) continue; // comment, PI, doctype
    const tag = tagName.toLowerCase();
    if (m[2] === "/") {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = parseAttrs(m[4] ?? "");
    let scale = top.scale * transformScale(attrs.transform);
    if (tag === "svg") {
      const vbW = viewBoxWidth(attrs.viewBox);
      const w = numAttr(attrs.width);
      if (rootWidthUser === null) {
        rootWidthUser = vbW ?? w;
        if (rootWidthUser === null) {
          unresolved.push("root <svg> has neither a viewBox nor a numeric width; cannot place it at a physical size");
          rootWidthUser = 1;
        }
        mmPerUser = widthMm / rootWidthUser;
      } else if (vbW !== null && w !== null) {
        scale *= w / vbW; // nested viewport maps its viewBox onto its width
      }
    }
    if (tag === "style") {
      const close = svg.indexOf("</style>", TOKEN_RE.lastIndex);
      const body = close >= 0 ? svg.slice(TOKEN_RE.lastIndex, close) : "";
      if (/font/i.test(body)) unresolved.push("a <style> sheet sets font properties; class-based sizes are not resolved");
    }
    if (attrs.style && /(?:^|;)\s*font\s*:/i.test(attrs.style)) {
      unresolved.push(`the "font:" shorthand on <${tag}> is not resolved; its size and family were not read`);
    }
    let fontPx = top.fontPx;
    const fs = prop(attrs, "font-size");
    if (fs !== undefined) {
      const r = resolveFontSize(fs, top.fontPx);
      if (r === null) unresolved.push(`font-size "${fs}" on <${tag}> cannot be resolved; parent size used`);
      else fontPx = r;
    }
    const ff = prop(attrs, "font-family");
    const family = ff !== undefined ? ff : top.family;
    const hidden = prop(attrs, "display") === "none" || prop(attrs, "visibility") === "hidden";
    const fw = prop(attrs, "font-weight");
    let bold = top.bold;
    if (fw !== undefined) {
      const v = fw.trim().toLowerCase();
      bold = v === "bold" || v === "bolder" || (/^\d+$/.test(v) && parseInt(v, 10) >= 600);
    }
    const frame: Frame = {
      tag,
      fontPx,
      family,
      bold,
      scale,
      skip: top.skip || hidden || NON_RENDERED.has(tag),
      isText: top.isText || tag === "text",
    };
    if (m[5] !== "/") stack.push(frame);
  }
  const pts = texts.map((t) => t.pt);
  return {
    widthMm,
    rootWidthUser: rootWidthUser ?? 0,
    texts,
    minPt: pts.length ? Math.min(...pts) : null,
    maxPt: pts.length ? Math.max(...pts) : null,
    unresolved,
  };
}

/** Colour values that are black or white (or no paint / a reference to checked defs). */
const BW_OK = /^(none|transparent|inherit|currentcolor|black|white|#000|#000000|#fff|#ffffff|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|url\(#[^)]+\))$/i;
const PAINT_PROPS = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"];
const OPACITY_PROPS = ["opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "flood-opacity"];

/**
 * Every paint in `svg` that is not pure black or white: colours, greys (#333, #888),
 * any opacity below 1 (black at 0.35 prints grey), gradients, and embedded <image>s.
 * Empty list = black and white only. Scans <defs>/<pattern> too: a pattern is paint.
 */
export function nonBlackWhitePaints(svg: string): string[] {
  const bad: string[] = [];
  const tagRe = /<([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(svg)) !== null) {
    const tag = m[1].toLowerCase();
    if (tag === "image" || tag === "lineargradient" || tag === "radialgradient" || tag === "foreignobject") {
      bad.push(`<${m[1]}>`);
    }
    const attrs = parseAttrs(m[2]);
    if (tag === "style") {
      const close = svg.indexOf("</style>", tagRe.lastIndex);
      const body = close >= 0 ? svg.slice(tagRe.lastIndex, close) : svg.slice(tagRe.lastIndex);
      if (/(fill|stroke|color|opacity)\s*:/i.test(body)) bad.push("a <style> sheet sets paint; class-based colours are not resolved");
    }
    for (const p of PAINT_PROPS) {
      const v = prop(attrs, p);
      if (v !== undefined && !BW_OK.test(v.trim())) bad.push(`${p}="${v}" on <${m[1]}>`);
    }
    for (const p of OPACITY_PROPS) {
      const v = prop(attrs, p);
      if (v === undefined) continue;
      const t = v.trim();
      const n = t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t);
      if (!(n >= 1)) bad.push(`${p}="${v}" on <${m[1]}>`);
    }
  }
  return bad;
}

/**
 * FIGURE TITLES ARE MARKED, NOT GUESSED. Each builder whose figures reach a preset
 * (plot, statchart, tablechart, tablefigure, tablediagram) puts this attribute on
 * the <text> that draws the figure's title. Size cannot identify a title (USPTO's
 * "FIG. 1" label uses the title size) and <title> is the non-rendered accessibility
 * element, so neither is used. A preset with allowTitle: false (USPTO, 37 CFR 1.84:
 * no title in the artwork) has the marked title removed before the figure is
 * fitted, and the check flags any that remains. (v2.143.0 review: allowTitle was
 * never read, so a titled figure went in under USPTO through the panel tray.)
 */
export const FIGURE_TITLE_ATTR = "data-figure-title";

const TITLE_TEXT_RE = /<text\b[^>]*\sdata-figure-title="[^"]*"[^>]*>[\s\S]*?<\/text>/g;

/** The text of every marked title in `svg`, in order. */
export function figureTitles(svg: string): string[] {
  const out: string[] = [];
  for (const m of svg.match(TITLE_TEXT_RE) ?? []) {
    const t = decodeEntities(m.replace(/<[^>]*>/g, "")).trim();
    if (t) out.push(t);
  }
  return out;
}

/** `svg` with every marked title element removed (the space it sat in stays blank). */
export function stripFigureTitles(svg: string): string {
  return svg.indexOf(FIGURE_TITLE_ATTR) < 0 ? svg : svg.replace(TITLE_TEXT_RE, "");
}

export interface PresetCheck {
  ok: boolean;
  preset: PresetId;
  widthMm: number;
  textCount: number;
  minPt: number | null;
  maxPt: number | null;
  /** Smallest cap height (mm) among runs whose family is known. */
  minCapHeightMm: number | null;
  /** Smallest character height (mm): x-height for runs with lowercase, cap height otherwise. */
  minCharHeightMm: number | null;
  tooSmall: MeasuredText[];
  /** Above the preset maximum. Panel letters (exact preset panel size, bold) are exempt. */
  tooLarge: MeasuredText[];
  /** Families that are not the preset's stack (reported, not failed: the vector route re-fonts). */
  foreignFamilies: string[];
  /** USPTO only: non black-and-white paints. */
  colourViolations: string[];
  /** Marked titles drawn in a figure whose preset allows none (USPTO). */
  titles: string[];
  unresolved: string[];
  /** Plain-language reasons the check failed. */
  problems: string[];
}

const EPS = 1e-6;
/**
 * Size comparisons allow 0.005 pt (0.0018 mm): below anything a printer or a reader can
 * resolve, and above the float noise of scale x size products. It never admits a figure
 * that misses by a measurable amount.
 */
const SIZE_TOL_PT = 0.005;

/**
 * A run is exempt from the preset maximum as a PANEL LETTER only if it is one: the
 * preset's panel size (within 0.05 pt), the preset's weight, and the text of a panel label
 * ("a", "B", "(c)", "aa"). Size alone is not enough: a 13 px title scaled to 8.01 pt passed
 * as a Cell panel letter before this rule existed.
 */
export function isPanelLetterRun(t: MeasuredText, preset: FigureStylePreset): boolean {
  const r = preset.panelLetter;
  return (
    Math.abs(t.pt - r.sizePt) < 0.05 &&
    t.bold === (r.weight === "bold") &&
    /^\(?[A-Za-z]{1,2}\)?$/.test(t.text)
  );
}

/**
 * Check `svg` against `preset` when printed `widthMm` wide (default: the preset's single
 * column). MEASURES the rendered text; does not change the SVG.
 * A figure with no text, or with sizes the parser could not resolve, does not pass.
 */
export function checkSvgAgainstPreset(svg: string, preset: FigureStylePreset, widthMm?: number): PresetCheck {
  const w = widthMm ?? preset.widthsMm.single;
  const meas = measureSvgText(svg, w);
  const isPanel = (t: MeasuredText): boolean => isPanelLetterRun(t, preset);
  const tooSmall = meas.texts.filter((t) => t.pt < preset.sizesPt.min - SIZE_TOL_PT);
  const max = preset.sizesPt.max;
  const tooLarge = max === null ? [] : meas.texts.filter((t) => t.pt > max + SIZE_TOL_PT && !isPanel(t));
  const caps = meas.texts.map((t) => t.capHeightMm).filter((c): c is number => c !== null);
  const minCap = caps.length ? Math.min(...caps) : null;
  const chars = meas.texts.map((t) => t.charHeightMm).filter((c): c is number => c !== null);
  const minChar = chars.length ? Math.min(...chars) : null;
  const norm = (s: string): string => s.replace(/["']/g, "").replace(/\s*,\s*/g, ",").trim().toLowerCase();
  const foreign = [...new Set(meas.texts.map((t) => t.family).filter((f) => norm(f) !== norm(preset.fontFamily)))];
  const colour = preset.color === "bw" ? nonBlackWhitePaints(svg) : [];
  const problems: string[] = [];
  if (!meas.texts.length) problems.push("no rendered text was found, so the text-size rule could not be checked");
  if (tooSmall.length) {
    problems.push(
      `${tooSmall.length} text run(s) print below ${preset.sizesPt.min.toFixed(2)} pt at ${w.toFixed(1)} mm, smallest ` +
        `${Math.min(...tooSmall.map((t) => t.pt)).toFixed(2)} pt ("${tooSmall[0].text}")`,
    );
  }
  if (tooLarge.length) {
    problems.push(`${tooLarge.length} text run(s) print above ${max} pt at ${w.toFixed(1)} mm ("${tooLarge[0].text}")`);
  }
  if (preset.minCharHeightMm !== null) {
    // Measured on the run's SMALLEST letters (x-height when it has lowercase), not
    // its capitals: 1.84(p)(3) is about every letter, and "Control" passed on cap
    // height while its lowercase stood 2.3 mm tall.
    const unknown = meas.texts.filter((t) => t.capHeightMm === null);
    if (unknown.length) problems.push(`${unknown.length} text run(s) use a font family whose character height is unknown`);
    const supsub = meas.texts.filter((t) => t.capHeightMm !== null && t.charHeightMm === null);
    if (supsub.length) {
      problems.push(`${supsub.length} text run(s) contain superscript or subscript characters ("${supsub[0].text}"), whose height is not measured`);
    }
    const rule = preset.minCharHeightMm as number;
    const margin = preset.charHeightMargin ?? 0;
    const required = rule * (1 + margin);
    const short = meas.texts.filter((t) => t.charHeightMm !== null && t.charHeightMm < required - EPS);
    if (short.length) {
      const worst = short.reduce((a, t) => ((t.charHeightMm as number) < (a.charHeightMm as number) ? t : a));
      const lower = LOWER_RE.test(worst.text);
      problems.push(
        `${short.length} text run(s) are under ${+required.toFixed(3)} mm high (37 CFR 1.84(p)(3) requires ${rule} mm` +
          (margin ? `; this style keeps a ${Math.round(margin * 100)} % margin), smallest ` : "), smallest ") +
          `${(worst.charHeightMm as number).toFixed(2)} mm ("${worst.text}"${lower ? ", measured on its lowercase letters" : ""})`,
      );
    }
  }
  if (colour.length) problems.push(`${colour.length} paint(s) are not black or white (37 CFR 1.84(a)(1)): ${colour[0]}`);
  const titles = preset.allowTitle ? [] : figureTitles(svg);
  if (titles.length) {
    problems.push(`a title is drawn in the artwork ("${titles[0]}"); ${preset.name} figures carry no title in the artwork`);
  }
  if (meas.unresolved.length) problems.push(...meas.unresolved);
  return {
    ok: problems.length === 0,
    preset: preset.id,
    widthMm: w,
    textCount: meas.texts.length,
    minPt: meas.minPt,
    maxPt: meas.maxPt,
    minCapHeightMm: minCap,
    minCharHeightMm: minChar,
    tooSmall,
    tooLarge,
    foreignFamilies: foreign,
    colourViolations: colour,
    titles,
    unresolved: meas.unresolved,
    problems,
  };
}

/**
 * The physical size `svg` prints at when placed `widthMm` wide, keeping its aspect ratio,
 * plus whether that exceeds the preset's max height. For the integrator's insert sizing.
 */
export function physicalSize(
  svg: string,
  widthMm: number,
  preset?: FigureStylePreset,
): { widthMm: number; heightMm: number; widthPx: number; heightPx: number; exceedsMaxHeight: boolean } | null {
  const open = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(svg);
  if (!open || !(Number.isFinite(widthMm) && widthMm > 0)) return null;
  const a = parseAttrs(open[1]);
  let w: number | null = null;
  let h: number | null = null;
  if (a.viewBox) {
    const p = a.viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) {
      w = p[2];
      h = p[3];
    }
  }
  if (w === null || h === null) {
    w = numAttr(a.width);
    h = numAttr(a.height);
  }
  if (!w || !h || !(w > 0) || !(h > 0)) return null;
  const heightMm = (widthMm * h) / w;
  return {
    widthMm,
    heightMm,
    widthPx: mmToPx(widthMm),
    heightPx: mmToPx(heightMm),
    exceedsMaxHeight: preset?.maxHeightMm != null && heightMm > preset.maxHeightMm + EPS,
  };
}

// ---------------------------------------------------------------------------
// Rendering a fixed-font builder AT a preset
// ---------------------------------------------------------------------------
// Most builders draw text at fixed px sizes (9-13 px) whatever their canvas. Placing a
// canvas of W user units at `widthMm` scales every glyph by s = mmToPx(widthMm) / W, so
// the canvas width is the one knob that moves ALL text sizes together without touching
// layout code. fitCanvasWidth picks W so the builder's smallest text lands on the
// preset's tick size, clamped so its largest text stays under the preset maximum.

export type CanvasFit = { ok: true; canvasWidth: number; scale: number } | { ok: false; reason: string };

/**
 * Canvas width (user units) at which text spanning `range` (root user units) prints inside
 * the preset band at `widthMm`. Refuses when the builder's own size spread is wider than
 * the band (e.g. 9-13 px is 1.44:1; Nature's 5-7 pt band is 1.4:1).
 */
export function fitCanvasWidth(preset: FigureStylePreset, widthMm: number, range: { min: number; max: number }): CanvasFit {
  if (!(range.min > 0 && range.max >= range.min && Number.isFinite(range.max))) {
    return { ok: false, reason: "the figure has no measurable text sizes" };
  }
  if (!(Number.isFinite(widthMm) && widthMm > 0)) return { ok: false, reason: "the printed width must be a positive number of mm" };
  const lo = ptToPx(preset.sizesPt.min) / range.min;
  const hi = preset.sizesPt.max === null ? Infinity : ptToPx(preset.sizesPt.max) / range.max;
  if (lo > hi * (1 + EPS)) {
    return {
      ok: false,
      reason:
        `the figure's text runs from ${range.min.toFixed(1)} to ${range.max.toFixed(1)} px (${(range.max / range.min).toFixed(2)}:1), ` +
        `wider than ${preset.name}'s ${preset.sizesPt.min}–${preset.sizesPt.max} pt band; no single scale fits both ends`,
    };
  }
  // A 0.5% guard band each side: callers round the canvas to whole units, which moves the
  // scale by up to 0.5/W (0.25% at W = 200); without the band a figure fitted exactly to
  // the limit measured 7.01 pt against Nature's 7 pt maximum.
  const g = 0.005;
  const gLo = lo * (1 + g);
  const gHi = hi * (1 - g);
  const target = ptToPx(preset.sizesPt.tick) / range.min;
  const s = gLo <= gHi ? Math.min(gHi, Math.max(gLo, target)) : (lo + hi) / 2;
  return { ok: true, canvasWidth: mmToPx(widthMm) / s, scale: s };
}

export interface PresetRender {
  ok: boolean;
  svg: string;
  canvasWidth: number;
  widthMm: number;
  check: PresetCheck;
  /** Why it is not ok, beyond check.problems (e.g. the builder ignored the width). */
  reason: string | null;
}

/**
 * Render with `render(canvasWidth)` so the result satisfies `preset` at `widthMm`:
 * render once at the preset's px width, MEASURE the text, refit, re-render, re-measure
 * (up to 6 rounds, request clamped to 120-4000 units). The returned check is measured on
 * the SVG actually returned, never computed.
 *
 * The fit targets the ROOT width the builder actually emits, which need not equal the
 * width requested: plot.ts widens its canvas for an outside legend (requested 336 →
 * drawn 375). Each round corrects the request by the measured shortfall, so a builder
 * that adds a fixed margin converges in one step.
 */
export function renderAtPreset(render: (canvasWidth: number) => string, preset: FigureStylePreset, widthMm: number): PresetRender {
  let w = Math.round(mmToPx(widthMm));
  let svg = render(w);
  let check = checkSvgAgainstPreset(svg, preset, widthMm);
  let reason: string | null = null;
  for (let round = 0; round < 6 && !check.ok; round++) {
    const meas = measureSvgText(svg, widthMm);
    if (!meas.texts.length) break;
    // Under a character-height rule (USPTO) a run's binding size is its smallest
    // LETTER, not its font-size: a lowercase run fits as if it were a capital run
    // scaled by x-height / cap height. Without this a 17 px lowercase legend
    // beside 12 px numerals was fitted on the numerals and printed 2.56 mm tall.
    const binding = (t: MeasuredText): number =>
      preset.minCharHeightMm !== null && t.charHeightMm !== null && t.capHeightMm !== null && t.capHeightMm > 0
        ? (t.fontSizeRoot * t.charHeightMm) / t.capHeightMm
        : t.fontSizeRoot;
    const sizes = meas.texts.filter((t) => !isPanelLetterRun(t, preset)).map(binding);
    const use = sizes.length ? sizes : meas.texts.map((t) => t.fontSizeRoot);
    const fit = fitCanvasWidth(preset, widthMm, { min: Math.min(...use), max: Math.max(...use) });
    if (!fit.ok) {
      reason = fit.reason;
      break;
    }
    const before = meas.rootWidthUser;
    // Hundredths, not whole units: a whole-unit round moves the scale by up to 0.25% at
    // W = 200, enough to push a band-tight figure (Cell 6-8 pt vs a 9.75-13 px builder,
    // both exactly 4:3) over one end.
    const next = Math.round(Math.min(4000, Math.max(120, w + (fit.canvasWidth - before))) * 100) / 100;
    if (next === w) break;
    w = next;
    svg = render(w);
    check = checkSvgAgainstPreset(svg, preset, widthMm);
    const after = measureSvgText(svg, widthMm).rootWidthUser;
    if (Math.abs(after - before) < 0.005) {
      reason = `the builder ignored the requested canvas width (${w}); it always draws ${after} units wide`;
      break;
    }
  }
  return { ok: check.ok && reason === null, svg, canvasWidth: w, widthMm, check, reason };
}
