// Colour-space gamut coverage.
//
// PROVENANCE. The chromaticity primaries below were taken MECHANICALLY from the
// colour-science project's dataset modules (repository colour-science/colour,
// files colour/models/rgb/datasets/{srgb,itur_bt_709,itur_bt_2020,dci_p3}.py,
// develop branch, fetched 2026-08-02), which cite IEC 61966-2-1 for sRGB and
// ITU-R BT.709-6 / BT.2020 for the broadcast spaces. They were extracted by a
// script and no coordinate was typed by hand. `colourspace.crosscheck.test.ts`
// validates them against facts known independently of the file — chiefly that
// sRGB and Rec.709 share primaries exactly, which is true by construction of
// the sRGB standard and would break immediately on a transcription slip.
//
// This is the same treatment the NASA polynomials in flame.ts received, and the
// condition under which bundled reference data is acceptable here at all.
//
// WHY COVERAGE IS REPORTED IN u'v' AS WELL AS xy. The CIE 1931 xy diagram is
// badly non-uniform: it devotes a huge area to greens the eye discriminates
// poorly and compresses the blues and purples. CIE 1976 u'v' is far more
// uniform, so an area in it corresponds much better to perceived colour
// difference, and it is the figure to quote.
//
// NOTE that u'v' is not simply the SMALLER number — an early draft of this file
// asserted that and the data disproved it: sRGB covers 52.9% of Rec.2020 in xy
// and 58.0% in u'v'. The direction depends on where the two triangles differ,
// because the transform stretches some regions and compresses others. What is
// true in general is only that the two metrics disagree materially, which is
// why both are reported instead of one being chosen for the reader.

export interface ColourError {
  ok: false;
  error: string;
}

/** A chromaticity coordinate. */
export interface Chromaticity {
  x: number;
  y: number;
}

export interface Gamut {
  id: string;
  label: string;
  /** Red, green, blue primaries in CIE 1931 xy. */
  primaries: [Chromaticity, Chromaticity, Chromaticity];
  /** Where the numbers came from. */
  source: string;
}

const P = (x: number, y: number): Chromaticity => ({ x, y });

/** Script-extracted; see the provenance note above. */
export const GAMUTS: Gamut[] = [
  {
    id: "srgb",
    label: "sRGB",
    primaries: [P(0.64, 0.33), P(0.3, 0.6), P(0.15, 0.06)],
    source: "IEC 61966-2-1",
  },
  {
    id: "bt709",
    label: "Rec. 709 (HDTV)",
    primaries: [P(0.64, 0.33), P(0.3, 0.6), P(0.15, 0.06)],
    source: "ITU-R BT.709-6",
  },
  {
    id: "dcip3",
    label: "DCI-P3",
    primaries: [P(0.68, 0.32), P(0.265, 0.69), P(0.15, 0.06)],
    source: "SMPTE RP 431-2 / DCI",
  },
  {
    id: "bt2020",
    label: "Rec. 2020 (UHDTV)",
    primaries: [P(0.708, 0.292), P(0.17, 0.797), P(0.131, 0.046)],
    source: "ITU-R BT.2020",
  },
];

export function gamutById(id: string): Gamut | undefined {
  return GAMUTS.find((g) => g.id === id);
}

/**
 * CIE 1931 xy to CIE 1976 u'v'.
 *
 * u' = 4x / (−2x + 12y + 3), v' = 9y / (−2x + 12y + 3). The transform exists
 * because xy is perceptually lopsided; u'v' is roughly uniform, so an area in
 * it means something closer to "how much colour difference".
 */
export function xyToUv(c: Chromaticity): Chromaticity {
  const d = -2 * c.x + 12 * c.y + 3;
  if (d === 0) return { x: 0, y: 0 };
  return { x: (4 * c.x) / d, y: (9 * c.y) / d };
}

/** Signed area of a polygon by the shoelace formula. */
function polygonArea(pts: Chromaticity[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Sutherland-Hodgman clip of `subject` against the convex polygon `clip`.
 *
 * Coverage is the area of the INTERSECTION of two gamut triangles over the area
 * of the reference, not the ratio of their areas. Those differ whenever one
 * gamut is not wholly inside the other, and even when it IS: DCI-P3 contains
 * sRGB entirely, so it covers 100% of it while being 126% of its area. An area
 * ratio quoted as "coverage" would claim 126% coverage of a space it merely
 * encloses — which is precisely the marketing move this reports around.
 */
function clipPolygon(subject: Chromaticity[], clip: Chromaticity[]): Chromaticity[] {
  let output = subject.slice();
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    // Positive side of the directed edge a->b.
    const side = (p: Chromaticity): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = side(cur) >= 0;
      const prevIn = side(prev) >= 0;
      if (curIn !== prevIn) {
        const t = side(prev) / (side(prev) - side(cur));
        output.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
      if (curIn) output.push(cur);
    }
  }
  return output;
}

/** Orders a triangle's vertices counter-clockwise, as the clipper expects. */
function ccw(tri: Chromaticity[]): Chromaticity[] {
  let a = 0;
  for (let i = 0; i < tri.length; i++) {
    const p = tri[i];
    const q = tri[(i + 1) % tri.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a < 0 ? [...tri].reverse() : tri;
}

export interface CoverageResult {
  ok: true;
  gamut: string;
  reference: string;
  /** Coverage of the reference, as a fraction, in CIE 1931 xy. */
  coverageXy: number;
  /** The same in CIE 1976 u'v' — the more honest figure. */
  coverageUv: number;
  /** Ratio of the two gamut AREAS in u'v' (can exceed 1). */
  areaRatioUv: number;
  /** Fraction of the gamut that falls OUTSIDE the reference, in u'v'. */
  outsideReferenceUv: number;
  notes: string[];
}

/**
 * How much of `referenceId` the gamut `gamutId` covers.
 *
 * Two numbers that are routinely confused are both reported: COVERAGE (how much
 * of the reference this gamut can actually reproduce) and AREA RATIO (how big
 * this gamut is relative to the reference). DCI-P3 is 126% of sRGB by area and
 * covers exactly 100% of it, because it encloses sRGB completely — the extra
 * area is in colours sRGB never had. Where two gamuts merely overlap, coverage
 * falls below 100% while the ratio can still exceed 1.
 */
export function gamutCoverage(gamutId: string, referenceId: string): CoverageResult | ColourError {
  const g = gamutById(gamutId);
  const ref = gamutById(referenceId);
  if (!g) return { ok: false, error: `Unknown colour space "${gamutId}".` };
  if (!ref) return { ok: false, error: `Unknown reference colour space "${referenceId}".` };

  const measure = (toUv: boolean): { coverage: number; ratio: number; outside: number } => {
    const conv = (c: Chromaticity): Chromaticity => (toUv ? xyToUv(c) : c);
    const gt = ccw(g.primaries.map(conv));
    const rt = ccw(ref.primaries.map(conv));
    const inter = clipPolygon(gt, rt);
    const interArea = inter.length >= 3 ? polygonArea(inter) : 0;
    const gArea = polygonArea(gt);
    const rArea = polygonArea(rt);
    return {
      coverage: rArea > 0 ? interArea / rArea : 0,
      ratio: rArea > 0 ? gArea / rArea : 0,
      outside: gArea > 0 ? 1 - interArea / gArea : 0,
    };
  };

  const xy = measure(false);
  const uv = measure(true);

  const notes: string[] = [
    "COVERAGE and AREA RATIO are different numbers and are both shown. Coverage is how much of " +
      "the reference this space can actually reproduce; area ratio is how big it is relative to " +
      "the reference. A display can be 130% of sRGB by area while covering only 96% of it — the " +
      "extra area is in colours sRGB never had, and the shortfall is in ones it did.",
    "Quote the u'v' figure. CIE 1931 xy is badly non-uniform — it gives a huge area to greens " +
      "the eye discriminates poorly and compresses the blues — so an xy percentage does not " +
      "correspond to perceived difference. The two metrics disagree materially, and which is " +
      "larger depends on where the gamuts differ, so both are shown rather than one chosen.",
    `Primaries: ${g.label} from ${g.source}; ${ref.label} from ${ref.source}. Taken from a ` +
      "published dataset and cross-checked in the test suite, not transcribed by hand.",
    "A gamut TRIANGLE is only part of the story: a real display also has a luminance range and " +
      "a bit depth, and a wide gamut driven by 8 bits shows banding a narrower one would not.",
  ];
  if (uv.outside > 0.001) {
    notes.push(
      `${(uv.outside * 100).toFixed(1)}% of ${g.label} falls OUTSIDE ${ref.label} — those are ` +
        "colours the reference cannot express at all, which is what a wider gamut buys.",
    );
  }
  return {
    ok: true,
    gamut: g.label,
    reference: ref.label,
    coverageXy: xy.coverage,
    coverageUv: uv.coverage,
    areaRatioUv: uv.ratio,
    outsideReferenceUv: uv.outside,
    notes,
  };
}

/** Gamut area in u'v', for ordering colour spaces by size. */
export function gamutAreaUv(gamutId: string): number | null {
  const g = gamutById(gamutId);
  if (!g) return null;
  return polygonArea(ccw(g.primaries.map(xyToUv)));
}
