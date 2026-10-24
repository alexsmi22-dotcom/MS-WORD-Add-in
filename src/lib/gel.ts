// Agarose gel figure — the ladders, where a band sits, and what co-migrates.
//
// WHAT THIS IS, AND WHAT IT IS NOT
// This is a SCHEMATIC gel. Nothing here models electrophoresis: no field
// strength, no agarose percentage, no buffer, no run time. What it does is
// place a fragment BETWEEN THE LADDER'S OWN BANDS, which is exactly what a
// person does by eye at the bench, and says so in the caption. A figure that
// looked like a photograph of a real gel while being computed from nothing
// would be the worst outcome in this product, so the drawing is deliberately a
// diagram: straight lanes, uniform band height, labelled ladder.
//
// THE LADDERS ARE FETCHED DATA, NOT MEMORY. Every band list below was read off
// the manufacturer's own product page or manual on the date recorded with it,
// and the band sizes and masses are pinned byte-for-byte in
// __tests__/cloningCases.test.ts. A ladder nobody can check is worse than no
// ladder: "my 3 kb band ran where your figure says 2 kb" is the failure this
// avoids. A user-typed custom ladder always exists for everything else.
//
// MIGRATION MODEL (stated in the output, every time)
//   * The ladder's own bands are placed proportional to log10(size) between its
//     largest and smallest band — the semi-log behaviour of agarose over its
//     useful range, as a schematic.
//   * Any other fragment is placed by PIECEWISE-LINEAR interpolation in
//     log10(size) between the two ladder bands that bracket it. (Linear, not
//     cubic: a spline through unevenly spaced ladder bands can overshoot and
//     put a band on the wrong side of a ladder band it should sit between.)
//   * A fragment larger than the largest ladder band, or smaller than the
//     smallest, is drawn AT THE EDGE of the ladder's range with a named note.
//     It is not extrapolated: outside the ladder the relation is not even
//     monotone in practice (compression at the top of the gel), so a position
//     there would be invented.
//
// Pure data + pure arithmetic. No DOM, no Office.

import { cleanDna } from "./dna";
import { findSites, ENZYMES } from "./enzymes";
import { digest, gelBands } from "./digest";

/** A band of a ladder, exactly as the manufacturer prints it. */
export interface LadderBand {
  /**
   * The size(s) the manufacturer prints for this band. More than one means the
   * manufacturer prints a doublet (NEB's "500/517"), which runs as ONE band.
   */
  sizes: number[];
  /** The label the manufacturer prints ("500/517", "10,002"). */
  label: string;
  /** Approximate mass per band at the stated load, ng, or null when not published. */
  massNg: number | null;
  /** The manufacturer's reference ("brighter") bands. */
  reference?: boolean;
}

export interface Ladder {
  id: string;
  /** Short name for a figure label. */
  name: string;
  /** Manufacturer, product name and catalogue number. */
  product: string;
  /** The page or document the band list was read from. */
  source: string;
  /** ISO date the source was fetched. */
  fetched: string;
  /** The load the published masses assume, or null for a custom ladder. */
  load: string | null;
  /** Largest first, as the manufacturer's table is ordered. */
  bands: LadderBand[];
  /** The manufacturer's own gel recommendation, verbatim in substance. */
  gelNote: string;
}

/**
 * NEB 1 kb DNA Ladder (#N3232).
 * Source: https://www.neb.com/en-us/products/n3232-1-kb-dna-ladder — "Properties
 * & Usage / Bases" table (fragment, mass ng, bp), fetched 2026-10-22.
 * The page states: 10 bands, 0.5–10.0 kb, the 3.0 kb fragment has increased
 * intensity as a reference band, masses assume a 0.5 µg load, and bands 10a/10b
 * are 517 and 500 bp. Recommended gel 0.8–1.2 %, optimum 1 %.
 */
const NEB_1KB: Ladder = {
  id: "neb-1kb",
  name: "NEB 1 kb (N3232)",
  product: "New England Biolabs 1 kb DNA Ladder, NEB #N3232",
  source: "www.neb.com/en-us/products/n3232-1-kb-dna-ladder",
  fetched: "2026-10-22",
  load: "0.5 µg per lane",
  gelNote: "NEB recommends 0.8–1.2 % agarose, optimum separation on 1 %.",
  bands: [
    { sizes: [10002], label: "10,002", massNg: 42 },
    { sizes: [8001], label: "8,001", massNg: 42 },
    { sizes: [6001], label: "6,001", massNg: 50 },
    { sizes: [5001], label: "5,001", massNg: 42 },
    { sizes: [4001], label: "4,001", massNg: 33 },
    { sizes: [3001], label: "3,001", massNg: 125, reference: true },
    { sizes: [2000], label: "2,000", massNg: 48 },
    { sizes: [1500], label: "1,500", massNg: 36 },
    { sizes: [1000], label: "1,000", massNg: 42 },
    { sizes: [517], label: "517", massNg: 21 },
    { sizes: [500], label: "500", massNg: 21 },
  ],
};

/**
 * NEB 100 bp DNA Ladder (#N3231).
 * Source: https://www.neb.com/en-us/products/n3231-100-bp-dna-ladder — "Properties
 * & Usage / Bases" table, fetched 2026-10-22. The page states: 12 bands,
 * 100–1,517 bp, the 500 and 1,000 bp bands have increased intensity as reference
 * points, masses assume a 0.5 µg load, and band 8 is printed "500/517".
 * Recommended gel 1.2–3 %, optimum 2 %.
 */
const NEB_100BP: Ladder = {
  id: "neb-100bp",
  name: "NEB 100 bp (N3231)",
  product: "New England Biolabs 100 bp DNA Ladder, NEB #N3231",
  source: "www.neb.com/en-us/products/n3231-100-bp-dna-ladder",
  fetched: "2026-10-22",
  load: "0.5 µg per lane",
  gelNote: "NEB recommends 1.2–3 % agarose, optimum separation on 2 %.",
  bands: [
    { sizes: [1517], label: "1,517", massNg: 45 },
    { sizes: [1200], label: "1,200", massNg: 35 },
    { sizes: [1000], label: "1,000", massNg: 95, reference: true },
    { sizes: [900], label: "900", massNg: 27 },
    { sizes: [800], label: "800", massNg: 24 },
    { sizes: [700], label: "700", massNg: 21 },
    { sizes: [600], label: "600", massNg: 18 },
    { sizes: [517, 500], label: "500/517", massNg: 97, reference: true },
    { sizes: [400], label: "400", massNg: 38 },
    { sizes: [300], label: "300", massNg: 29 },
    { sizes: [200], label: "200", massNg: 25 },
    { sizes: [100], label: "100", massNg: 48 },
  ],
};

/**
 * NEB 1 kb Plus DNA Ladder (#N3200), previously named the 2-Log DNA Ladder.
 * Source: https://www.neb.com/en-us/products/n3200-1-kb-plus-dna-ladder —
 * "Properties & Usage / Bases" table, fetched 2026-10-22. The page states:
 * 19 bands, 100 bp – 10 kb, the 0.5, 1.0 and 3.0 kb bands have increased
 * intensity as reference points, masses assume a 1.0 µg load, and band 15 is
 * printed "500/517". Recommended gel 1–1.4 %, optimum 1.2 %.
 */
const NEB_1KB_PLUS: Ladder = {
  id: "neb-1kb-plus",
  name: "NEB 1 kb Plus (N3200)",
  product: "New England Biolabs 1 kb Plus DNA Ladder, NEB #N3200",
  source: "www.neb.com/en-us/products/n3200-1-kb-plus-dna-ladder",
  fetched: "2026-10-22",
  load: "1 µg per lane",
  gelNote: "NEB recommends 1–1.4 % agarose, optimum separation on 1.2 %.",
  bands: [
    { sizes: [10002], label: "10,002", massNg: 40 },
    { sizes: [8001], label: "8,001", massNg: 40 },
    { sizes: [6001], label: "6,001", massNg: 48 },
    { sizes: [5001], label: "5,001", massNg: 40 },
    { sizes: [4001], label: "4,001", massNg: 32 },
    { sizes: [3001], label: "3,001", massNg: 120, reference: true },
    { sizes: [2017], label: "2,017", massNg: 40 },
    { sizes: [1517], label: "1,517", massNg: 57 },
    { sizes: [1200], label: "1,200", massNg: 45 },
    { sizes: [1000], label: "1,000", massNg: 122, reference: true },
    { sizes: [900], label: "900", massNg: 34 },
    { sizes: [800], label: "800", massNg: 31 },
    { sizes: [700], label: "700", massNg: 27 },
    { sizes: [600], label: "600", massNg: 23 },
    { sizes: [517, 500], label: "500/517", massNg: 124, reference: true },
    { sizes: [400], label: "400", massNg: 49 },
    { sizes: [300], label: "300", massNg: 37 },
    { sizes: [200], label: "200", massNg: 32 },
    { sizes: [100], label: "100", massNg: 61 },
  ],
};

/**
 * Thermo Scientific GeneRuler 1 kb DNA Ladder (SM0311/SM0312).
 * Source: Thermo Fisher user guide Pub. No. MAN0013004 Rev. D.00,
 * https://documents.thermofisher.com/TFS-Assets/LSG/manuals/MAN0013004_GeneRuler_1kb_DNALadder_250ug_UG.pdf
 * fetched 2026-10-22. The manual states, verbatim: "The ladder is composed of
 * fourteen chromatography-purified individual DNA fragments (in base pairs):
 * 10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 750, 500,
 * 250. It contains three reference bands (6000, 3000 and 1000 bp) for easy
 * orientation." No per-band mass is published, so none is claimed here.
 */
const GENERULER_1KB: Ladder = {
  id: "generuler-1kb",
  name: "GeneRuler 1 kb (SM0311)",
  product: "Thermo Scientific GeneRuler 1 kb DNA Ladder, SM0311/SM0312",
  source:
    "Thermo Fisher user guide MAN0013004 Rev. D.00 (documents.thermofisher.com/TFS-Assets/LSG/manuals/MAN0013004_GeneRuler_1kb_DNALadder_250ug_UG.pdf)",
  fetched: "2026-10-22",
  load: null,
  gelNote:
    "The manual gives no per-band mass, so no band mass is quoted; load 0.2 µL (0.1 µg) of ladder per 1 mm of lane.",
  bands: [
    { sizes: [10000], label: "10,000", massNg: null },
    { sizes: [8000], label: "8,000", massNg: null },
    { sizes: [6000], label: "6,000", massNg: null, reference: true },
    { sizes: [5000], label: "5,000", massNg: null },
    { sizes: [4000], label: "4,000", massNg: null },
    { sizes: [3500], label: "3,500", massNg: null },
    { sizes: [3000], label: "3,000", massNg: null, reference: true },
    { sizes: [2500], label: "2,500", massNg: null },
    { sizes: [2000], label: "2,000", massNg: null },
    { sizes: [1500], label: "1,500", massNg: null },
    { sizes: [1000], label: "1,000", massNg: null, reference: true },
    { sizes: [750], label: "750", massNg: null },
    { sizes: [500], label: "500", massNg: null },
    { sizes: [250], label: "250", massNg: null },
  ],
};

/** Every ladder whose band list was read from a manufacturer source. */
export const LADDERS: Ladder[] = [NEB_1KB, NEB_100BP, NEB_1KB_PLUS, GENERULER_1KB];

export function ladderById(id: string): Ladder | undefined {
  return LADDERS.find((l) => l.id === id);
}

/** The most sizes a custom ladder may carry (a ladder, not a dataset). */
export const MAX_LADDER_BANDS = 40;
/** The most sample lanes beside the ladder. */
export const MAX_SAMPLE_LANES = 14;
/** The most bands one sample lane may carry. */
export const MAX_LANE_BANDS = 40;
/** Longest sequence accepted for a digest lane, bases. */
export const MAX_GEL_SEQUENCE = 100_000;

/** A ladder the user typed. Its provenance is "the user", and the figure says so. */
export function customLadder(sizes: number[]): Ladder | { error: string } {
  const good = sizes.filter((s) => Number.isFinite(s) && s > 0).map((s) => Math.round(s));
  if (good.length > MAX_LADDER_BANDS) {
    return { error: `A custom ladder is capped at ${MAX_LADDER_BANDS} bands; ${good.length} were given.` };
  }
  // DISTINCT sizes, counted AFTER de-duplicating. Counting before it let
  // "1000, 1000" through as a one-band ladder: every other fragment in the gel
  // was then pinned to an edge as "off scale", which is a figure that says
  // nothing dressed up as one that says something.
  const uniq = [...new Set(good)].sort((a, b) => b - a);
  if (uniq.length < 2) {
    return {
      error:
        uniq.length === 1
          ? `A custom ladder needs at least two DIFFERENT band sizes; every size given was ${uniq[0].toLocaleString("en-US")} bp.`
          : "A custom ladder needs at least two band sizes in bp.",
    };
  }
  // A ladder spanning less than two-fold cannot place anything: a gel
  // interpolates in log10(size), so a 1 bp span would stretch one base pair
  // across the whole picture and read as a measurement.
  const fold = uniq[0] / uniq[uniq.length - 1];
  if (fold < 2) {
    return {
      error:
        `A custom ladder from ${uniq[uniq.length - 1].toLocaleString("en-US")} to ${uniq[0].toLocaleString("en-US")} bp ` +
        `spans only ${fold.toFixed(2)}-fold. A gel is read on a log scale, so a ladder narrower than two-fold would ` +
        `stretch that span across the whole figure and put every other fragment off the ends. Give a ladder that ` +
        `brackets the sizes you are running.`,
    };
  }
  return {
    id: "custom",
    name: "Custom ladder",
    product: "Custom ladder (sizes typed by the user)",
    source: "user input",
    fetched: "",
    load: null,
    gelNote: "Sizes as typed; no manufacturer data is implied.",
    bands: uniq.map((s) => ({ sizes: [s], label: s.toLocaleString("en-US"), massNg: null })),
  };
}

/** One sample lane: fragment sizes in bp. A repeated size is a second copy. */
export interface GelSampleLane {
  name: string;
  sizes: number[];
  /** Set when the sizes came from a digest, for the lane's own note. */
  note?: string;
}

export interface GelSpec {
  ladder: Ladder;
  lanes: GelSampleLane[];
  /** Agarose resolution, percent size difference; digest.ts's gelBands owns the rule. */
  resolutionPct?: number;
  style?: "dark-on-light" | "ethidium";
}

/** A band as drawn: where it sits, how bright, and whether it is honest. */
export interface PlacedBand {
  /** The sizes merged into this band, largest first. */
  sizes: number[];
  /** The size the band is labelled and positioned by (the largest in it). */
  size: number;
  /** Total mass index, Σ size × copies (arbitrary units — a relative brightness). */
  mass: number;
  /** 0 at the largest ladder band, 1 at the smallest. */
  pos: number;
  /** Relative brightness 0.25–1, clamped. */
  intensity: number;
  /** Set when the band is outside the ladder's range and drawn at the edge. */
  offScale: "above" | "below" | null;
}

export interface PlacedLane {
  name: string;
  /** True for the ladder lane. */
  isLadder: boolean;
  bands: PlacedBand[];
  notes: string[];
}

export interface GelModel {
  ladder: Ladder;
  /** The ladder lane first, then the sample lanes in the order given. */
  lanes: PlacedLane[];
  /** Largest and smallest ladder band size. */
  range: { max: number; min: number };
  resolutionPct: number;
  style: "dark-on-light" | "ethidium";
  /** Notes for the result text: off-scale bands, merged bands, the model itself. */
  notes: string[];
}

/**
 * Drawing geometry the MODEL needs, so that "two bands" in the text is always
 * "two rectangles that do not touch" in the figure. gelChart.ts imports these;
 * it never redefines them.
 */
/** Band height in the figure, px. */
export const GEL_BAND_PX = 5;
/** Distance from the highest to the lowest band CENTRE in the figure, px. */
export const GEL_RUN_PX = 276;
/** Two band centres closer than this would draw as overlapping rectangles (band height + a 1 px gap). */
export const GEL_MIN_BAND_GAP_PX = GEL_BAND_PX + 1;

/** The sentence every gel figure carries. */
export const GEL_MODEL_NOTE =
  "Schematic gel: positions are interpolated from the ladder, piecewise-linear in log10(size) between the " +
  "ladder's own bands, which are themselves spaced proportional to log10(size). Nothing here models agarose " +
  "percentage, buffer, voltage or run time.";

/** Ladder band sizes, largest first — the positions everything else interpolates between. */
function ladderSizes(l: Ladder): number[] {
  return l.bands.map((b) => Math.max(...b.sizes)).sort((a, b) => b - a);
}

/**
 * Where a size sits, 0 at the largest ladder band and 1 at the smallest.
 *
 * Exported because the figure and the text must agree to the pixel, and because
 * the FIXED CASE TABLE is written against this function: a 3,001 bp fragment on
 * the NEB 1 kb ladder must land exactly on that ladder's 3,001 band.
 */
export function migrationPos(size: number, ladder: Ladder): { pos: number; offScale: "above" | "below" | null } {
  const sizes = ladderSizes(ladder);
  const max = sizes[0];
  const min = sizes[sizes.length - 1];
  if (!(size > 0) || !Number.isFinite(size)) return { pos: 0, offScale: "above" };
  if (size >= max) return { pos: 0, offScale: size > max ? "above" : null };
  if (size <= min) return { pos: 1, offScale: size < min ? "below" : null };
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  const span = hi - lo;
  // The ladder's own bands, placed proportional to log10(size).
  const posOf = (s: number): number => (span > 0 ? (hi - Math.log10(s)) / span : 0);
  // Piecewise-linear in log10(size) between the two bracketing ladder bands.
  for (let i = 0; i < sizes.length - 1; i++) {
    const a = sizes[i];
    const b = sizes[i + 1];
    if (size <= a && size >= b) {
      const t = (Math.log10(a) - Math.log10(size)) / (Math.log10(a) - Math.log10(b));
      return { pos: posOf(a) + t * (posOf(b) - posOf(a)), offScale: null };
    }
  }
  return { pos: posOf(size), offScale: null };
}

/**
 * Merges bands whose rectangles would overlap in the figure.
 *
 * WHY THIS IS IN THE MODEL AND NOT THE DRAWING. NEB prints its 1 kb ladder's
 * last band as two rows (517 and 500 bp), 0.5 px apart at figure scale; drawn
 * as two rectangles they made a blot with a dark seam. Merging in the drawing
 * alone would leave the text saying "two bands" over a figure showing one, so
 * the merge happens here, the merged band carries every size it holds, and the
 * caller gets a note for each sample merge. Bands must already be sorted by
 * position (largest first). `pos` and `offScale` of the merged band are the
 * larger fragment's, which is the one that sets the band's position.
 */
function mergeTooClose(bands: PlacedBand[]): { bands: PlacedBand[]; merged: number[][] } {
  const out: PlacedBand[] = [];
  const wasMerged: boolean[] = [];
  for (const b of bands) {
    const last = out[out.length - 1];
    if (last && (b.pos - last.pos) * GEL_RUN_PX < GEL_MIN_BAND_GAP_PX) {
      last.sizes = [...last.sizes, ...b.sizes].sort((p, q) => q - p);
      last.mass += b.mass;
      last.offScale = last.offScale ?? b.offScale;
      wasMerged[out.length - 1] = true;
    } else {
      out.push({ ...b, sizes: [...b.sizes] });
      wasMerged.push(false);
    }
  }
  return { bands: out, merged: out.filter((_b, i) => wasMerged[i]).map((b) => b.sizes) };
}

/** How a merged ladder band is labelled: ascending, slash-joined, as NEB prints "500/517". */
export function ladderBandLabel(sizes: number[]): string {
  return [...sizes].sort((a, b) => a - b).map((s) => s.toLocaleString("en-US")).join("/");
}

/** Σ size × copies for a group of co-migrating fragments. */
function massOf(sizes: number[]): number {
  let m = 0;
  for (const s of sizes) m += s;
  return m;
}

/**
 * Builds the gel.
 *
 * Co-migration is digest.ts's gelBands — the ONE resolution rule in the app, so
 * the virtual digest's "these two would co-migrate" and this figure can never
 * disagree.
 */
export function buildGel(spec: GelSpec): GelModel | { error: string } {
  const { ladder } = spec;
  if (!ladder.bands.length) return { error: "The ladder has no bands." };
  if (spec.lanes.length > MAX_SAMPLE_LANES) {
    return { error: `This gel takes the ladder plus up to ${MAX_SAMPLE_LANES} sample lanes; ${spec.lanes.length} were given.` };
  }
  const resolutionPct = spec.resolutionPct ?? 8;
  const style = spec.style ?? "dark-on-light";
  const sizes = ladderSizes(ladder);
  const range = { max: sizes[0], min: sizes[sizes.length - 1] };
  const notes: string[] = [];

  const ladderLane: PlacedLane = {
    name: ladder.name,
    isLadder: true,
    bands: ladder.bands.map((b) => {
      const size = Math.max(...b.sizes);
      const { pos } = migrationPos(size, ladder);
      // The ladder's own brightness is the manufacturer's published mass where
      // there is one, and the reference bands are brighter because the
      // manufacturer says so — not because we decided.
      const mass = b.massNg ?? (b.reference ? 2 : 1);
      return { sizes: [...b.sizes], size, mass, pos, intensity: 1, offScale: null };
    }),
    notes: [],
  };
  // A ladder's printed doublet (NEB's "500/517") and any two ladder bands that
  // would draw overlapping become ONE band, labelled with every size it holds.
  ladderLane.bands = mergeTooClose(ladderLane.bands).bands;
  const maxLadderMass = Math.max(...ladderLane.bands.map((b) => b.mass), 1e-9);
  for (const b of ladderLane.bands) b.intensity = clampIntensity(b.mass / maxLadderMass);

  const lanes: PlacedLane[] = [ladderLane];
  let maxSampleMass = 1e-9;
  const placed: PlacedLane[] = [];

  for (const lane of spec.lanes) {
    const good = lane.sizes.filter((s) => Number.isFinite(s) && s > 0).map((s) => Math.round(s));
    const laneNotes: string[] = [];
    if (lane.note) laneNotes.push(lane.note);
    if (good.length !== lane.sizes.length) {
      laneNotes.push(`${lane.name}: ${lane.sizes.length - good.length} value(s) were not a positive size in bp and were not drawn.`);
    }
    if (good.length > MAX_LANE_BANDS) {
      return { error: `Lane "${lane.name}" has ${good.length} fragments; one lane is capped at ${MAX_LANE_BANDS}.` };
    }
    const groups = gelBands(good, resolutionPct);
    const grouped: PlacedBand[] = groups.map((g) => {
      const { pos, offScale } = migrationPos(g.size, ladder);
      return { sizes: [...g.fragments].sort((a, b) => b - a), size: g.size, mass: massOf(g.fragments), pos, intensity: 1, offScale };
    });
    for (const g of groups) {
      if (g.count > 1) {
        laneNotes.push(
          `${lane.name}: ${g.fragments.join(" and ")} bp are within ~${resolutionPct} % of each other and are drawn as ONE band (the practical resolution of agarose).`,
        );
      }
    }
    // Then anything that would still DRAW overlapping (two off-scale fragments
    // both pinned to an edge, or a wide custom ladder that squeezes 8 % into
    // less than a band height) becomes one band too, and says so.
    const tight = mergeTooClose(grouped);
    for (const m of tight.merged) {
      laneNotes.push(
        `${lane.name}: ${m.join(" and ")} bp would be drawn closer than one band height at this scale, so they are drawn as ONE band.`,
      );
    }
    const bands = tight.bands;
    for (const b of bands) if (b.mass > maxSampleMass) maxSampleMass = b.mass;
    // Off-scale notes per GROUP (before the draw merge), so every off-scale
    // fragment is named even when two of them share the edge.
    for (const b of grouped) {
      if (b.offScale === "above") {
        laneNotes.push(
          `${lane.name}: ${sizeText(b.size)} is above the largest ladder band (${sizeText(range.max)}); it is drawn at the top edge and its position is not to scale.`,
        );
      } else if (b.offScale === "below") {
        laneNotes.push(
          `${lane.name}: ${sizeText(b.size)} is below the smallest ladder band (${sizeText(range.min)}); it is drawn at the bottom edge and its position is not to scale.`,
        );
      }
    }
    placed.push({ name: lane.name, isLadder: false, bands, notes: laneNotes });
  }

  // Brightness is relative WITHIN the sample lanes: a ladder band's published
  // mass and a sample's "size x copies" are not the same quantity, and scaling
  // them against each other would imply a loading that was never stated.
  for (const l of placed) {
    for (const b of l.bands) b.intensity = clampIntensity(b.mass / maxSampleMass);
    lanes.push(l);
    notes.push(...l.notes);
  }

  notes.push(GEL_MODEL_NOTE);
  return { ladder, lanes, range, resolutionPct, style, notes };
}

/** Brightness is clamped: a 20 kb band is not 40x more visible than a 500 bp one. */
function clampIntensity(frac: number): number {
  if (!Number.isFinite(frac)) return 0.25;
  const f = Math.max(0, Math.min(1, frac));
  // Square root, so a 10-fold mass range spans a visible but not absurd
  // brightness range, and 0.25 is the floor: a band that is drawn is visible.
  return 0.25 + 0.75 * Math.sqrt(f);
}

/** "3,001 bp" / "10.0 kb" — the way a gel is labelled. */
/**
 * A drawn sample band in words, naming EVERY size it holds.
 *
 * Two off-scale small fragments (250 and 100 bp below a ladder that ends at
 * 500) are pinned to the same bottom edge and drawn as one band; the result
 * used to read "250 bp (2 fragments)", which hides the 100 bp fragment and
 * implies two copies of 250. Now: "below the ladder: 250 and 100 bp".
 */
export function bandText(b: Pick<PlacedBand, "sizes" | "size" | "offScale">): string {
  const fmt = (v: number): string => Math.round(v).toLocaleString("en-US");
  const distinct = [...new Set(b.sizes.map((s) => Math.round(s)))].sort((p, q) => q - p);
  const list = (xs: number[]): string =>
    xs.length <= 2 ? xs.map(fmt).join(" and ") : `${xs.slice(0, -1).map(fmt).join(", ")} and ${fmt(xs[xs.length - 1])}`;
  if (distinct.length > 1) {
    const where = b.offScale === "above" ? "above the ladder" : b.offScale === "below" ? "below the ladder" : "";
    const edge = b.offScale ? ` [drawn as one band at the ${b.offScale === "above" ? "top" : "bottom"} edge, not to scale]` : " (drawn as one band)";
    return where ? `${where}: ${list(distinct)} bp${edge}` : `${list(distinct)} bp${edge}`;
  }
  const copies = b.sizes.length > 1 ? ` (${b.sizes.length} fragments)` : "";
  const off = b.offScale ? ` [off scale, drawn at the ${b.offScale === "above" ? "top" : "bottom"} edge]` : "";
  return `${fmt(b.size)} bp${copies}${off}`;
}

export function sizeText(bp: number): string {
  if (!Number.isFinite(bp)) return "not a size";
  return bp >= 1000 ? `${(bp / 1000).toFixed(bp % 1000 === 0 ? 1 : 2)} kb` : `${Math.round(bp)} bp`;
}

/**
 * A sample lane from a sequence and a list of enzymes.
 *
 * Every number comes from findSites + digest (enzymes.ts owns the cut offsets,
 * digest.ts owns circular-vs-linear fragment counting) — this only packages
 * them as a lane.
 */
export function laneFromDigest(
  name: string,
  rawSeq: string,
  enzymeNames: string[],
  circular: boolean,
): GelSampleLane | { error: string } {
  const { seq, invalid, records } = cleanDna(rawSeq);
  if (!seq) return { error: `${name}: no DNA bases were found in that sequence.` };
  if (seq.length > MAX_GEL_SEQUENCE) {
    return { error: `${name}: ${seq.length.toLocaleString("en-US")} bases is past the ${MAX_GEL_SEQUENCE.toLocaleString("en-US")} this tool digests.` };
  }
  const known = new Map(ENZYMES.map((e) => [e.name.toLowerCase(), e.name]));
  const unknown = enzymeNames.filter((n) => !known.has(n.toLowerCase()));
  const only = enzymeNames.map((n) => known.get(n.toLowerCase())).filter((n): n is string => !!n);
  if (enzymeNames.length && !only.length) {
    return { error: `${name}: none of those enzymes are in the table (${unknown.map((u) => `"${u}"`).join(", ")}).` };
  }
  const hits = findSites(seq, { circular, ...(only.length ? { only } : {}) });
  const result = digest(seq.length, hits, circular);
  const extras: string[] = [];
  if (records > 1) extras.push(`${records} FASTA records were concatenated`);
  if (invalid.length) extras.push(`ignored ${invalid.join(", ")}`);
  if (unknown.length) extras.push(`not in the enzyme table, so not used: ${unknown.join(", ")}`);
  const what = result.uncut
    ? `not cut by ${only.length ? only.join(" + ") : "any enzyme in the table"}, so it runs as one ${circular ? "circular" : "linear"} molecule`
    : `${only.length ? only.join(" + ") : "every enzyme that cuts"} on a ${circular ? "circular" : "linear"} molecule, ${result.fragments.length} fragment(s)`;
  return {
    name,
    sizes: result.sizes,
    note: `${name}: ${what}${extras.length ? ` (${extras.join("; ")})` : ""}.`,
  };
}
