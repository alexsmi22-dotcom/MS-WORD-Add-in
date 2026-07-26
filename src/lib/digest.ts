// Virtual restriction digest — fragment sizes, ends, and what a gel would show.
//
// WHY THIS EXISTS
// findSites() already computes `cutPosition` and `overhangLength` for every hit,
// and NOTHING consumed them: the tool could tell you an enzyme cuts at position
// 812 but not what you would get if you actually cut. The ROADMAP claimed
// "restriction-enzyme digestion". Planning a cloning step means asking "how many
// bands, how big, and are any of them too close to tell apart?" — which is this
// module.
//
// The two things that make a digest wrong if you get them casually right:
//
//   1. CIRCULAR topology. A plasmid with one cut yields ONE linear fragment of
//      the full length, not two. With n cuts it yields n fragments, not n+1. A
//      linear molecule with n cuts yields n+1. Getting this backwards
//      miscounts every plasmid digest, which is most of them.
//
//   2. GEL RESOLUTION. Two fragments 40 bp apart at 4 kb are one band on an
//      agarose gel. Listing them as two is a prediction the bench will not
//      reproduce, so co-migrating fragments are grouped and said to be so.

import type { EnzymeHit, OverhangKind } from "./enzymes";

export interface Fragment {
  /** 1-based inclusive start on the original sequence. */
  start: number;
  /** 1-based inclusive end. May be < start on a fragment spanning the origin. */
  end: number;
  length: number;
  /** Enzyme producing the left end, or null for the end of a linear molecule. */
  leftEnzyme: string | null;
  rightEnzyme: string | null;
  /** Overhang at each end; a linear molecule's own ends are reported blunt. */
  leftOverhang: OverhangKind;
  rightOverhang: OverhangKind;
  /** True when the fragment runs through the origin of a circular molecule. */
  spansOrigin: boolean;
}

export interface DigestResult {
  fragments: Fragment[];
  /** Fragment lengths, largest first — the order a gel shows them. */
  sizes: number[];
  /** Enzymes that had a usable cut. */
  enzymes: string[];
  /** True when nothing cut, so the molecule is returned intact. */
  uncut: boolean;
  circular: boolean;
}

/**
 * Cuts a sequence at the given hits.
 *
 * Hits whose `cutPosition` is null are ignored: that is findSites() reporting a
 * Type IIS site whose cut falls off the end of a LINEAR molecule, and inventing
 * a coordinate for it would fabricate a fragment boundary.
 */
export function digest(seqLength: number, hits: EnzymeHit[], circular = false): DigestResult {
  const cuts = hits
    .filter((h): h is EnzymeHit & { cutPosition: number } => h.cutPosition !== null)
    .map((h) => ({ at: h.cutPosition, enzyme: h.enzyme, overhang: h.overhang }))
    // Two enzymes can cut at the same coordinate; one boundary, not two.
    .filter((c, i, arr) => arr.findIndex((o) => o.at === c.at) === i)
    .sort((a, b) => a.at - b.at);

  const enzymes = [...new Set(cuts.map((c) => c.enzyme))].sort();

  if (!cuts.length || seqLength <= 0) {
    return {
      fragments: seqLength > 0
        ? [
            {
              start: 1,
              end: seqLength,
              length: seqLength,
              leftEnzyme: null,
              rightEnzyme: null,
              leftOverhang: "blunt",
              rightOverhang: "blunt",
              spansOrigin: false,
            },
          ]
        : [],
      sizes: seqLength > 0 ? [seqLength] : [],
      enzymes: [],
      uncut: true,
      circular,
    };
  }

  const fragments: Fragment[] = [];

  if (circular) {
    // n cuts in a circle give n fragments: each runs from one cut to the next,
    // and the last wraps through the origin back to the first.
    for (let i = 0; i < cuts.length; i++) {
      const from = cuts[i];
      const to = cuts[(i + 1) % cuts.length];
      const start = from.at + 1 > seqLength ? 1 : from.at + 1;
      const end = to.at;
      const spansOrigin = i === cuts.length - 1;
      const length = spansOrigin ? seqLength - from.at + to.at : to.at - from.at;
      fragments.push({
        start,
        end,
        length,
        leftEnzyme: from.enzyme,
        rightEnzyme: to.enzyme,
        leftOverhang: from.overhang,
        rightOverhang: to.overhang,
        spansOrigin,
      });
    }
    // A single cut opens the circle into one full-length linear fragment; the
    // loop above produces exactly that, with both ends from the same enzyme.
  } else {
    // n cuts in a line give n+1 fragments, including the two original ends.
    let prev = 0;
    let prevEnzyme: string | null = null;
    let prevOverhang: OverhangKind = "blunt";
    for (const c of cuts) {
      fragments.push({
        start: prev + 1,
        end: c.at,
        length: c.at - prev,
        leftEnzyme: prevEnzyme,
        rightEnzyme: c.enzyme,
        leftOverhang: prevOverhang,
        rightOverhang: c.overhang,
        spansOrigin: false,
      });
      prev = c.at;
      prevEnzyme = c.enzyme;
      prevOverhang = c.overhang;
    }
    fragments.push({
      start: prev + 1,
      end: seqLength,
      length: seqLength - prev,
      leftEnzyme: prevEnzyme,
      rightEnzyme: null,
      leftOverhang: prevOverhang,
      rightOverhang: "blunt",
      spansOrigin: false,
    });
  }

  // A cut at the very first or last base can produce a zero-length fragment;
  // it is not a band and must not be reported as one.
  const real = fragments.filter((f) => f.length > 0);

  return {
    fragments: real,
    sizes: real.map((f) => f.length).sort((a, b) => b - a),
    enzymes,
    uncut: false,
    circular,
  };
}

export interface GelBand {
  /** Size reported for the band (the largest fragment in it). */
  size: number;
  /** How many fragments co-migrate here. */
  count: number;
  /** The individual fragment lengths grouped into this band. */
  fragments: number[];
}

/**
 * Groups fragments into the bands a gel would actually show.
 *
 * Agarose resolves roughly 5-10% differences over the usual range; two
 * fragments closer than that run as one band. Reporting them separately
 * predicts a gel the user will not see, and "I counted 7 bands and you said 8"
 * is precisely the kind of quiet wrongness this product refuses to ship.
 */
export function gelBands(sizes: number[], resolutionPct = 8): GelBand[] {
  const sorted = [...sizes].sort((a, b) => b - a);
  const bands: GelBand[] = [];
  for (const s of sorted) {
    const last = bands[bands.length - 1];
    // Compared against the band's largest fragment, which is what sets its
    // position on the gel.
    if (last && (last.size - s) / last.size <= resolutionPct / 100) {
      last.count++;
      last.fragments.push(s);
    } else {
      bands.push({ size: s, count: 1, fragments: [s] });
    }
  }
  return bands;
}

/** Human-readable digest report. */
export function describeDigest(result: DigestResult, resolutionPct = 8): string {
  if (result.uncut) {
    return `No cuts — the ${result.circular ? "plasmid" : "sequence"} is not cut by the selected enzyme(s) and stays intact (${result.sizes[0] ?? 0} bp).`;
  }
  const lines: string[] = [];
  const n = result.fragments.length;
  lines.push(
    `${result.enzymes.join(" + ")} on a ${result.circular ? "circular" : "linear"} molecule: ` +
      `${n} fragment${n === 1 ? "" : "s"}`,
  );
  lines.push("Sizes (bp): " + result.sizes.join(", "));

  const bands = gelBands(result.sizes, resolutionPct);
  const merged = bands.filter((b) => b.count > 1);
  if (merged.length) {
    lines.push(
      `On a gel: ${bands.length} visible band${bands.length === 1 ? "" : "s"} — ` +
        merged
          .map((b) => `${b.fragments.join(" and ")} bp would co-migrate`)
          .join("; ") +
        ` (within ~${resolutionPct}%, the practical resolution of agarose).`,
    );
  } else {
    lines.push(`On a gel: ${bands.length} resolvable band${bands.length === 1 ? "" : "s"}.`);
  }
  if (result.circular && n === 1) {
    lines.push("A single cut in a circular molecule linearises it — one full-length band.");
  }
  return lines.join("\n");
}
