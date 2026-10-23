// Cloning design: Golden Gate, Gibson/HiFi and PCR primers.
//
// ONE Tm IN THE APP. Every melting temperature here is dna.ts `primerTm` at its
// own default conditions (50 mM Na⁺, 0.25 µM primer, SantaLucia 1998
// nearest-neighbour). There is no second Tm formula in this file and there must
// never be one: two numbers for one primer is the defect class this product
// treats as unshippable, and the conditions are quoted in the output because a
// Tm without them is not a fact about the oligo.
//
// ONE ENZYME TABLE. Recognition sites, cut offsets and Type IIS status come
// from enzymes.ts. The spacer length and the overhang length of a Golden Gate
// primer tail are COMPUTED from that table's cutTop/cutBottom, never written
// down here: a hard-coded "4 nt overhang, 1 nt spacer" is right for BsaI and
// wrong for SapI, and nothing in the output would show it.
//
// WHAT IS DELIBERATELY ABSENT
//   * No hairpin / primer-dimer thermodynamics. The only secondary-structure
//     check is an exact 3′ complementarity test (>= 4 bp), which is arithmetic
//     on the sequence rather than a free energy nobody can verify offline.
//   * No CRISPR PAM scan. It belongs with a specificity (off-target) search,
//     and a protospacer list with no specificity statement reads as a design
//     recommendation it has not earned. Omitted rather than half-done.
//   * No codon optimisation, no expression prediction, no efficiency score.

import { cleanDna, primerTm, reverseComplement, type PrimerTm } from "./dna";
import { ENZYMES, findSites, type Enzyme } from "./enzymes";

/** Longest sequence accepted anywhere in this module, bases. */
export const MAX_CLONING_SEQUENCE = 100_000;
/** Most parts / fragments in one assembly. */
export const MAX_PARTS = 20;
/** Primer annealing-length window. */
export const MIN_ANNEAL = 18;
export const MAX_ANNEAL = 30;
/** Longest Gibson overlap this tool will design. */
export const MAX_OVERLAP = 40;
/** Shortest Gibson overlap this tool will design. */
export const MIN_OVERLAP = 15;
/** How far from the target Tm a designed primer may land before it is flagged. */
export const TM_TOLERANCE = 3;

/** The conditions sentence every Tm in this module carries. */
export const TM_CONDITIONS_NOTE =
  "Every Tm is dna.ts primerTm: nearest-neighbour (SantaLucia 1998) at its defaults, 50 mM Na⁺ and 0.25 µM " +
  "primer, computed on the ANNEALING part of the primer only (a 5′ tail does not anneal in the first cycle). " +
  "Mg²⁺ is not modelled, so a high-Mg buffer runs warmer than this.";

/** NEB's published overlap guidance, fetched 2026-10-22 (cited in the output). */
export const NEB_OVERLAP_SOURCE =
  "NEB, “Optimization Tips for NEBuilder HiFi DNA Assembly and NEB Gibson Assembly” " +
  "(neb.com/en-us/tools-and-resources/usage-guidelines/optimization-tips-for-nebuilder-hifi-dna-assembly-and-neb-gibson-assembly), " +
  "fetched 2026-10-22: NEBuilder HiFi 2–3 fragments 15–20 nt overlaps, 4–6 fragments 20–30 nt; " +
  "Gibson Assembly Master Mix 2–3 fragments 15–25 nt, 4–6 fragments 20–80 nt.";

/** Golden Gate overhang-fidelity source, for the 1-base-difference warning. */
export const GG_FIDELITY_SOURCE =
  "Potapov et al., “Comprehensive Profiling of Four Base Overhang Ligation Fidelity by T4 DNA Ligase and " +
  "Application to DNA Assembly”, ACS Synth. Biol. 2018, 7(11), 2665–2674, doi:10.1021/acssynbio.8b00333.";

export interface Part {
  name: string;
  /** Cleaned bases (A/C/G/T, and IUPAC codes where the caller allows them). */
  seq: string;
}

/** A refusal: a named reason, never a guess. */
export interface CloningRefusal {
  ok: false;
  error: string;
}

// ---------------------------------------------------------------- sequence I/O

/**
 * Reads a parts block: one part per line, `name: SEQUENCE`, or FASTA.
 *
 * Every sequence goes through cleanDna, so whitespace, digits, lowercase, FASTA
 * headers and legacy ";" comments are handled by the one reader the DNA pane
 * uses, with its own messages for what it dropped.
 */
export function readParts(text: string, what: string): { parts: Part[]; notes: string[] } | CloningRefusal {
  const raw = (text ?? "").replace(/\r\n?/g, "\n");
  if (!raw.trim()) return { ok: false, error: `${what}: nothing to read.` };
  const notes: string[] = [];
  const parts: Part[] = [];

  const chunks: { name: string; body: string }[] = [];
  if (/^\s*>/.test(raw)) {
    // FASTA: a header starts a record and its name is the header's first word.
    const records = raw.split(/^>/m).filter((r) => r.trim());
    records.forEach((r, i) => {
      const nl = r.indexOf("\n");
      const header = (nl < 0 ? r : r.slice(0, nl)).trim();
      const body = nl < 0 ? "" : r.slice(nl + 1);
      chunks.push({ name: header.split(/\s+/)[0] || `part ${i + 1}`, body });
    });
  } else {
    raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line, i) => {
        const at = line.indexOf(":");
        if (at > 0 && /[A-Za-z]/.test(line.slice(0, at))) {
          chunks.push({ name: line.slice(0, at).trim(), body: line.slice(at + 1) });
        } else {
          chunks.push({ name: `part ${i + 1}`, body: line });
        }
      });
  }

  if (chunks.length > MAX_PARTS) {
    return { ok: false, error: `${what}: ${chunks.length} parts; this tool is capped at ${MAX_PARTS}.` };
  }

  for (const c of chunks) {
    const { seq, invalid, records } = cleanDna(c.body);
    if (!seq) return { ok: false, error: `${what}: “${c.name}” has no DNA bases.` };
    if (seq.length > MAX_CLONING_SEQUENCE) {
      return {
        ok: false,
        error: `${what}: “${c.name}” is ${seq.length.toLocaleString("en-US")} bases, past the ${MAX_CLONING_SEQUENCE.toLocaleString("en-US")} this tool designs against.`,
      };
    }
    if (/[^ACGT]/.test(seq)) {
      const codes = [...new Set(seq.replace(/[ACGT]/g, "").split(""))].join(", ");
      return {
        ok: false,
        error:
          `${what}: “${c.name}” contains ${codes}. A cloning design needs a defined sequence: an ambiguity code ` +
          `(or a U) has no single junction, overhang or Tm, so nothing is designed rather than one base being picked for you.`,
      };
    }
    if (invalid.length) notes.push(`“${c.name}”: ignored ${invalid.join(", ")}.`);
    if (records > 1) notes.push(`“${c.name}”: ${records} FASTA records were concatenated, which is rarely intended.`);
    parts.push({ name: c.name, seq });
  }
  const names = parts.map((p) => p.name);
  // DUPLICATE NAMES ARE REFUSED, NOT NOTED.
  //
  // This used to be a note, and the design was produced anyway. Two fragments
  // called "X" then shared one entry in the Gibson tail map, so the third
  // fragment of X, Y, X got the FIRST X's tail: a wrong oligo, printed beside a
  // second primer with the same name, in a result that otherwise looks correct.
  // Keying by index (which this file now does everywhere) fixes the collision,
  // but it cannot fix the OUTPUT: two rows both called "X reverse" are two
  // different oligos the user cannot tell apart, and a primer you cannot
  // identify is not a design. So the names must be distinct.
  const dupAt = names.findIndex((nm, i) => names.indexOf(nm) !== i);
  if (dupAt >= 0) {
    const nm = names[dupAt];
    const where = names.reduce<number[]>((a, n, i) => (n === nm ? [...a, i + 1] : a), []);
    return {
      ok: false,
      error:
        `${what}: ${where.length} of them are called “${nm}” (positions ${where.join(" and ")}). ` +
        `Every part needs its own name: the junctions, the primer list and the figure all identify parts by ` +
        `name, and two primers printed as “${nm} reverse” are two different oligos you could not tell apart.`,
    };
  }
  return { parts, notes };
}

// ------------------------------------------------------------- primer helpers

/**
 * The refusal for two parts sharing a name, or null when they are all distinct.
 *
 * Every design in this file is indexed by POSITION, so a duplicate name no
 * longer gives a fragment the wrong primer tail. It is still refused: the
 * primer list, the junction names and the figure all identify a part by its
 * name, and two rows printed "X reverse" are two different oligos the user
 * cannot tell apart at the bench.
 */
function duplicateName(parts: Part[]): string | null {
  const names = parts.map((p) => p.name);
  const at = names.findIndex((nm, i) => names.indexOf(nm) !== i);
  if (at < 0) return null;
  const nm = names[at];
  const where = names.reduce<number[]>((a, n, i) => (n === nm ? [...a, i + 1] : a), []);
  return (
    `${where.length} of these sequences are called “${nm}” (positions ${where.join(" and ")}). ` +
    `Every part needs its own name: the primers and the junctions are identified by name, and two oligos ` +
    `printed as “${nm} reverse” could not be told apart.`
  );
}

/** The GC fraction of a defined sequence, percent. */
export function gcPercent(seq: string): number {
  if (!seq.length) return 0;
  let gc = 0;
  for (const ch of seq) if (ch === "G" || ch === "C") gc++;
  return (gc / seq.length) * 100;
}

/** How many of the last three bases are G or C — the 3′ GC clamp. */
export function gcClamp(seq: string): number {
  const tail = seq.slice(-3);
  let gc = 0;
  for (const ch of tail) if (ch === "G" || ch === "C") gc++;
  return gc;
}

/**
 * Exact 3′ complementarity: does the primer's own 3′ end pair with something in
 * `other` (itself, for a self-dimer)?
 *
 * Reported as the LONGEST match of 4 bp or more, counting from the 3′ end. This
 * is arithmetic on the sequence — no free energies, no hairpin model — so it is
 * either true or false and can be checked by hand. It will not catch every bad
 * primer; what it catches is the one that primes off its own 3′ end.
 */
export function threePrimeComplement(primer: string, other: string, maxK = 8): number {
  for (let k = Math.min(maxK, primer.length); k >= 4; k--) {
    const probe = reverseComplement(primer.slice(-k));
    if (other.indexOf(probe) >= 0) return k;
  }
  return 0;
}

/** A designed primer and everything the output quotes about it. */
export interface DesignedPrimer {
  name: string;
  /** The whole oligo as ordered, 5′→3′ (tail + annealing part). */
  seq: string;
  /** The 5′ tail that does not anneal to the template (empty for a plain primer). */
  tail: string;
  /** The part that anneals, and whose Tm is quoted. */
  anneal: string;
  tm: PrimerTm;
  gc: number;
  clamp: number;
  warnings: string[];
}

/**
 * Picks the annealing length whose Tm is closest to `targetTm`.
 *
 * Ties go to the SHORTER primer: it is cheaper, and a longer oligo with the same
 * Tm buys nothing. A refusal from primerTm (which cannot happen for a defined
 * sequence, but can for a caller that passes one) propagates rather than being
 * read as a Tm of 0.
 */
export function chooseAnneal(
  pick: (len: number) => string,
  targetTm: number,
  minLen = MIN_ANNEAL,
  maxLen = MAX_ANNEAL,
): { seq: string; tm: PrimerTm } | CloningRefusal {
  let best: { seq: string; tm: PrimerTm; d: number } | null = null;
  for (let len = minLen; len <= maxLen; len++) {
    const s = pick(len);
    if (s.length !== len) break;
    const tm = primerTm(s);
    if (tm.refusal) continue;
    const d = Math.abs(tm.tm - targetTm);
    if (!best || d < best.d - 1e-12) best = { seq: s, tm, d };
  }
  if (!best) {
    return {
      ok: false,
      error: `No primer of ${minLen}–${maxLen} nt could be taken from that sequence (it is too short, or no Tm could be computed for it).`,
    };
  }
  return { seq: best.seq, tm: best.tm };
}

// ------------------------------------------------------------- Golden Gate

export interface GoldenGateSpec {
  parts: Part[];
  /** Enzyme name as it appears in enzymes.ts (BsaI, BsmBI, Esp3I, BbsI, SapI…). */
  enzyme: string;
  /** Optional backbone, assembled after the last part. */
  backbone?: Part | null;
  /** Target Tm for the annealing part of each primer, °C. */
  targetTm?: number;
}

export interface Overhang {
  /** The part whose 5′ end defines this fusion site. */
  part: string;
  seq: string;
}

/**
 * A backbone read as a Golden Gate DESTINATION VECTOR.
 *
 * The standard arrangement: a plasmid carrying TWO INVERTED sites of the chosen
 * Type IIS enzyme around a dropout (lacZα, ccdB, a stuffer), each pointing away
 * from the other so that both cuts fall outside the pair. The piece that carries
 * the two recognition sites is therefore the piece that LEAVES, and the retained
 * vector body keeps one programmed overhang at each end — which is the whole
 * point: the finished plasmid contains no site of the enzyme that built it, so
 * the reaction is one-pot and irreversible.
 *
 * The geometry is read off the enzyme table (cutTop/cutBottom), on both strands,
 * with the plasmid treated as circular, so a site spanning the position the user
 * happened to paste first is found like any other.
 */
export interface DestinationVector {
  /** The backbone's name, as the user gave it. */
  name: string;
  /** The two recognition sites, 1-based in the pasted coordinates, in position order. */
  sites: { position: number; strand: 1 | -1; cut: number }[];
  /** The region removed with the dropout, 1-based inclusive, in the pasted coordinates. */
  dropout: { start: number; end: number; length: number; wraps: boolean };
  /** The retained vector body, top strand 5′→3′, beginning with its own 5′ overhang. */
  body: string;
  /** The vector body's own 5′ overhang — its first bases, which the LAST part's primer must match. */
  overhang5: string;
  /** The overhang the insert must supply at the vector's 3′ end — the dropout's first bases. */
  overhang3: string;
  /** The sentence the result leads with. */
  summary: string;
}

export interface GoldenGateOk {
  ok: true;
  enzyme: Enzyme;
  /** Bases between the recognition site and the cut, from cutTop − site length. */
  spacerLength: number;
  /** Overhang length, from cutBottom − cutTop. */
  overhangLength: number;
  /** One fusion site per part (and backbone), in assembly order. */
  overhangs: Overhang[];
  primers: DesignedPrimer[];
  /** Σ part lengths: the fusion sites are each a part's own first bases, so nothing is duplicated. */
  productLength: number;
  /** The assembled product, top strand, in `order` — the sequence the junction scan runs on. */
  productSequence: string;
  /** Set when the backbone was read as a destination vector; null for every other assembly. */
  destination: DestinationVector | null;
  /** Each part's length, in assembly order — what the diagram draws its boxes from. */
  partLengths: number[];
  /** The order the product is assembled in. */
  order: string[];
  circular: boolean;
  warnings: string[];
  notes: string[];
}

export type GoldenGateResult = GoldenGateOk | CloningRefusal;

/**
 * Reads a backbone as a destination vector, or refuses and says why.
 *
 * THE TEST, and why it is this one. On a CIRCLE there is only one topology for
 * two inverted sites: each cuts away from the other, so the two cuts divide the
 * plasmid into two arcs and BOTH recognition sites always land in the same arc.
 * That arc is the dropout — the sites leave on the piece they sit on, whichever
 * way round the user pasted the sequence — and the other arc is the vector body.
 * There is no separate "facing inward" case to detect: inward-facing is the same
 * picture read from the other side, and it is reported by the vector-body-shorter
 * -than-the-dropout warning rather than by a second rule.
 *
 * Each arc begins with its own 5′ overhang, because a cut's overhang duplex is
 * always the `overhangLength` bases immediately after the top-strand cut (true
 * for a forward and a reverse site alike — enzymes.ts already mirrors the offsets
 * for a reverse hit). So the vector body's own first bases are the overhang the
 * LAST part must present, and the dropout's own first bases are the overhang the
 * FIRST part must present, which its primer tail carries.
 *
 * Verified against Bio.Restriction: see cloningD.test.ts.
 */
export function destinationVector(seq: string, enzyme: Enzyme, name: string): DestinationVector | CloningRefusal {
  const n = seq.length;
  const overhangLength = enzyme.cutBottom - enzyme.cutTop;
  const need =
    `A destination vector needs exactly two ${enzyme.name} sites (${enzyme.site}) facing away from each other ` +
    `around the dropout, so that both cuts fall outside the pair and both recognition sites leave with the dropout`;
  const orPartOf = (count: number): string =>
    `If “${name}” is meant to be an ordinary part carried through into the product rather than a destination ` +
    `vector, domesticate ${count === 1 ? "that site" : "those sites"} instead (a silent change), or use a different ` +
    `Type IIS enzyme.`;
  if (!(overhangLength > 0)) {
    return { ok: false, error: `${enzyme.name} does not leave a 5′ overhang, so it cannot open a destination vector.` };
  }

  // The plasmid is CIRCULAR: a destination vector is digested, not amplified, so
  // a site across the position the user pasted first is a real site.
  const hits = findSites(seq, { only: [enzyme.name], circular: true });
  const where = (h: { position: number; strand: 1 | -1 }): string =>
    `${h.position} (${h.strand === 1 ? "forward" : "reverse"} strand)`;
  const list = hits.map(where).join(", ");

  if (hits.length === 1) {
    return {
      ok: false,
      error:
        `${need}; “${name}” has ONE, at ${list}. A single site cannot release a dropout: ${enzyme.name} would ` +
        `simply linearise the plasmid, leaving one end with an overhang and the other with the recognition site ` +
        `still attached. ${orPartOf(hits.length)}`,
    };
  }
  if (hits.length !== 2) {
    return {
      ok: false,
      error:
        `${need}; “${name}” has ${hits.length}${hits.length ? `, at ${list}` : ` – none at all, so there is nothing for ${enzyme.name} to open`}. ` +
        (hits.length > 2
          ? `${enzyme.name} cuts at every one of them, so the vector body itself comes apart into pieces. ${orPartOf(hits.length)}`
          : `${orPartOf(hits.length)}`),
    };
  }

  const [h1, h2] = hits;
  const c1 = h1.cutPosition;
  const c2 = h2.cutPosition;
  if (c1 == null || c2 == null) {
    return { ok: false, error: `${enzyme.name}'s cut position could not be placed in “${name}”, so no dropout can be read.` };
  }
  if (c1 === c2) {
    return {
      ok: false,
      error:
        `${need}; the two ${enzyme.name} sites in “${name}” (at ${list}) cut at the SAME position (${c1}), so there ` +
        `is no dropout between them: one of the two pieces would be empty. ${orPartOf(hits.length)}`,
    };
  }

  const L = enzyme.site.length;
  const arcLen = (from: number, to: number): number => (((to - from) % n) + n) % n || n;
  const at = (p: number): string => seq[(((p - 1) % n) + n) % n];
  const span = (start: number, len: number): string => {
    let s = "";
    for (let k = 0; k < len; k++) s += at(start + k);
    return s;
  };
  /** Does the whole recognition match starting at `p` lie inside the arc? */
  const holds = (start: number, len: number, p: number): boolean => {
    const off = (((p - start) % n) + n) % n;
    return off + L <= len;
  };

  const aStart = (c1 % n) + 1;
  const aLen = arcLen(c1, c2);
  const bStart = (c2 % n) + 1;
  const bLen = arcLen(c2, c1);
  const aHolds = hits.every((h) => holds(aStart, aLen, h.position));
  const bHolds = hits.every((h) => holds(bStart, bLen, h.position));

  if (aHolds === bHolds) {
    if (h1.strand === h2.strand) {
      return {
        ok: false,
        error:
          `${need}; the two ${enzyme.name} sites in “${name}” (at ${list}) are in the SAME orientation, so they cut ` +
          `the same way round: one site stays on the vector body and only the other leaves with the dropout. ` +
          `${enzyme.name} would then cut the finished plasmid. The two sites of a destination vector are INVERTED ` +
          `(one on each strand) so that both of them leave. ${orPartOf(hits.length)}`,
      };
    }
    return {
      ok: false,
      error:
        `${need}; the two ${enzyme.name} sites in “${name}” (at ${list}) are inverted but too close together: one of ` +
        `them straddles the other's cut, so neither piece carries both sites whole and the digest does not give a ` +
        `clean dropout. Move them apart. ${orPartOf(hits.length)}`,
    };
  }

  const dropStart = aHolds ? aStart : bStart;
  const dropLength = aHolds ? aLen : bLen;
  const vecStart = aHolds ? bStart : aStart;
  const vecLength = aHolds ? bLen : aLen;
  if (vecLength < overhangLength + 1) {
    return {
      ok: false,
      error:
        `${need}; in “${name}” the piece that would be KEPT is only ${vecLength} bp, shorter than the ` +
        `${overhangLength} nt overhang it has to carry at each end, so there is no vector body to clone into. ${orPartOf(hits.length)}`,
    };
  }

  const body = span(vecStart, vecLength);
  const overhang5 = body.slice(0, overhangLength);
  const overhang3 = span(dropStart, overhangLength);
  const dropEnd = ((dropStart - 1 + dropLength - 1) % n) + 1;
  const wraps = dropEnd < dropStart;
  const bp = (v: number): string => v.toLocaleString("en-US");
  const summary =
    `Destination vector: ${enzyme.name} sites at ${h1.position} and ${h2.position} (inverted), dropout ` +
    `${bp(dropStart)}–${bp(dropEnd)} (${bp(dropLength)} bp${wraps ? ", wrapping the start of the sequence as pasted" : ""}) ` +
    `removed, vector overhangs ${overhang5} (5′) and ${overhang3} (3′).`;

  return {
    name,
    sites: hits.map((h) => ({ position: h.position, strand: h.strand, cut: h.cutPosition as number })),
    dropout: { start: dropStart, end: dropEnd, length: dropLength, wraps },
    body,
    overhang5,
    overhang3,
    summary,
  };
}

/**
 * Designs a Golden Gate assembly.
 *
 * THE DESIGN CONVENTION, stated because a different convention gives different
 * primers: the fusion site of a part is THE FIRST `overhangLength` BASES OF
 * THAT PART. So the forward primer of each part carries
 * `site + spacer + the part's own 5′ end`, and the reverse primer of the part
 * BEFORE it carries the reverse complement of that fusion site as a tail. Each
 * junction's four bases therefore belong to exactly one part, and the assembled
 * product is the parts concatenated — no base is added or duplicated by the
 * assembly, which is why `productLength` is a plain sum.
 */
export function goldenGate(spec: GoldenGateSpec): GoldenGateResult {
  const enzyme = ENZYMES.find((e) => e.name.toLowerCase() === (spec.enzyme ?? "").toLowerCase());
  if (!enzyme) {
    const iis = ENZYMES.filter((e) => e.typeIIS).map((e) => e.name);
    return { ok: false, error: `“${spec.enzyme}” is not in the enzyme table. Type IIS enzymes available: ${iis.join(", ")}.` };
  }
  if (!enzyme.typeIIS) {
    return {
      ok: false,
      error:
        `${enzyme.name} is not a Type IIS enzyme: it cuts inside its own recognition site, so it cannot leave a ` +
        `scarless, programmable overhang. Golden Gate needs an enzyme that cuts outside its site ` +
        `(${ENZYMES.filter((e) => e.typeIIS).map((e) => e.name).join(", ")}).`,
    };
  }
  const spacerLength = enzyme.cutTop - enzyme.site.length;
  const overhangLength = enzyme.cutBottom - enzyme.cutTop;
  if (!(spacerLength >= 0) || !(overhangLength > 0)) {
    return { ok: false, error: `${enzyme.name}'s cut offsets do not describe a 5′ overhang outside its site, so no fusion site can be designed.` };
  }

  const all: Part[] = [...spec.parts, ...(spec.backbone ? [spec.backbone] : [])];
  if (all.length < 2) return { ok: false, error: "A Golden Gate assembly needs at least two parts (or one part and a backbone)." };
  if (all.length > MAX_PARTS) return { ok: false, error: `${all.length} parts; this tool is capped at ${MAX_PARTS}.` };
  // Names must be distinct ACROSS the backbone too: the backbone is read from
  // its own field, so readParts cannot see that it is also called "vector".
  const clash = duplicateName(all);
  if (clash) return { ok: false, error: clash };

  const targetTm = spec.targetTm ?? 60;
  const warnings: string[] = [];
  const notes: string[] = [];

  // 1. INTERNAL SITES. One surviving site inside a part and the assembly eats
  //    itself; it is the first thing to check and the loudest thing to say.
  //
  //    THE BACKBONE IS THE EXCEPTION. A Golden Gate DESTINATION VECTOR is
  //    SUPPOSED to carry two sites of the enzyme, around the dropout it loses,
  //    and telling the user to "domesticate" them was advice to break the
  //    vector. So sites in the backbone field are read as a destination vector
  //    (or refused with advice that is actually right), while sites inside a
  //    PART keep the domestication refusal, which is correct there.
  const bbIndex = spec.backbone ? all.length - 1 : -1;
  let destination: DestinationVector | null = null;
  for (const [pi, p] of all.entries()) {
    if (p.seq.length < overhangLength + MIN_ANNEAL) {
      return {
        ok: false,
        error: `“${p.name}” is ${p.seq.length} nt: too short to carry a ${overhangLength} nt fusion site and an annealing region of at least ${MIN_ANNEAL} nt.`,
      };
    }
    if (pi === bbIndex) {
      // Searched BOTH ways, and the difference matters:
      //   * circular — a destination vector is a plasmid that gets digested, so
      //     a site across the paste position is real.
      //   * linear — a PLAIN backbone is a fragment whose two pasted ends BECOME
      //     the junctions with the parts, so a site spanning the paste position
      //     does not exist in the product at all (the product scan in step 3
      //     proves it). Refusing those would break designs that are correct.
      const circular = findSites(p.seq, { only: [enzyme.name], circular: true });
      if (circular.length) {
        const dv = destinationVector(p.seq, enzyme, p.name);
        if (!("ok" in dv)) {
          destination = dv;
        } else if (findSites(p.seq, { only: [enzyme.name] }).length) {
          return dv;
        }
        // else: the only site straddles the paste position, which the assembly
        // itself destroys — carry on as a plain backbone.
      }
      continue;
    }
    const hits = findSites(p.seq, { only: [enzyme.name] });
    if (hits.length) {
      const where = hits
        .map((h) => `position ${h.position} on the ${h.strand === 1 ? "forward" : "reverse"} strand`)
        .join(", ");
      return {
        ok: false,
        error:
          `“${p.name}” contains ${hits.length} internal ${enzyme.name} site (${enzyme.site}) at ${where}. ` +
          `${enzyme.name} would cut inside the part during the assembly, so this design cannot work: domesticate ` +
          `the site (a silent change) or use a different Type IIS enzyme.`,
      };
    }
  }

  // 2. THE ELEMENTS OF THE PRODUCT, and their fusion sites.
  //
  // `product` is what the element contributes to the assembled plasmid and
  // `template` is what its primers anneal to. They are the same thing for every
  // ordinary part, and differ only for a destination vector:
  //   * the vector contributes its BODY (the dropout is gone) and is not
  //     amplified at all, so it gets no primers;
  //   * the first part contributes the vector's 3′ overhang IN FRONT of itself,
  //     carried on its forward primer's tail, because that overhang belongs to
  //     the vector and is not in the part's own sequence.
  interface Element {
    name: string;
    product: string;
    template: string;
    /** Extra bases the forward primer's tail must add in front of the annealing region. */
    lead: string;
    /** False for a destination vector: it is digested, not amplified. */
    amplified: boolean;
  }
  const elems: Element[] = all.map((p) => ({ name: p.name, product: p.seq, template: p.seq, lead: "", amplified: true }));
  if (destination) {
    const vec = elems[bbIndex];
    vec.product = destination.body;
    vec.template = destination.body;
    vec.amplified = false;
    // THE FIRST PART AND THE VECTOR'S 3′ OVERHANG. Those bases belong to the
    // vector, not to the part, so they are ordered on the part's forward primer
    // — UNLESS the part already begins with them, which is how a part taken
    // from a parts library (MoClo and friends define the fusion sites) arrives.
    // Adding them unconditionally would then write the overhang twice and shift
    // the whole insert by four bases, in a result that still looked right.
    const first = elems[0];
    if (first.template.slice(0, overhangLength) !== destination.overhang3) {
      first.lead = destination.overhang3;
      first.product = destination.overhang3 + first.template;
    }
  }

  const overhangs: Overhang[] = elems.map((e) => ({ part: e.name, seq: e.product.slice(0, overhangLength) }));

  for (let i = 0; i < overhangs.length; i++) {
    const a = overhangs[i];
    if (a.seq === reverseComplement(a.seq)) {
      return {
        ok: false,
        error:
          `The fusion site of “${a.part}” is ${a.seq}, which is its own reverse complement (palindromic). ` +
          `A palindromic overhang ligates to a second copy of itself in either orientation, so the assembly ` +
          `scrambles. Shift the junction by a base or two.`,
      };
    }
    for (let j = i + 1; j < overhangs.length; j++) {
      const b = overhangs[j];
      if (a.seq === b.seq) {
        return {
          ok: false,
          error:
            `“${a.part}” and “${b.part}” have the SAME fusion site (${a.seq}), so the two junctions are ` +
            `interchangeable and the parts can assemble in the wrong order. Every overhang must be distinct.`,
        };
      }
      if (a.seq === reverseComplement(b.seq)) {
        return {
          ok: false,
          error:
            `The fusion sites of “${a.part}” (${a.seq}) and “${b.part}” (${b.seq}) are reverse complements of ` +
            `each other, so those two junctions ligate to one another and the parts can assemble inverted. ` +
            `Change one of them.`,
        };
      }
      if (hamming(a.seq, b.seq) === 1) {
        warnings.push(
          `“${a.part}” (${a.seq}) and “${b.part}” (${b.seq}) differ at only one base. T4 ligase mismatches such ` +
            `pairs measurably more often than well-separated overhangs, which lowers the fraction of correct ` +
            `assemblies. Source: ${GG_FIDELITY_SOURCE}`,
        );
      }
    }
  }

  // 3. A SITE THE ASSEMBLY ITSELF CREATES.
  //
  // Step 1 proves no part carries a site. That is not enough: the product is
  // the parts joined end to end, and a junction can SPELL a new site out of the
  // last bases of one part and the first bases of the next — including the
  // junction that closes the circle, which no linear search of the product
  // would ever see. A fuzz over 400 random designs found this in roughly one
  // assembly in forty.
  //
  // Such a plasmid is cut by the same enzyme that built it, so the design is
  // refused and the junction is named. The search is findSites on the assembled
  // product with circular: true, so BOTH STRANDS and the wrap are enzymes.ts's
  // job rather than a second matcher here.
  const product = elems.map((e) => e.product).join("");
  {
    // Where each part starts in the product, 1-based, for naming the junction.
    const starts: number[] = [];
    let at = 1;
    for (const e of elems) {
      starts.push(at);
      at += e.product.length;
    }
    const inProduct = findSites(product, { only: [enzyme.name], circular: true });
    if (inProduct.length) {
      const h = inProduct[0];
      // The junction a hit spans: the part it starts in, and the next one, with
      // the wrap named as such.
      let idx = 0;
      for (let i = 0; i < starts.length; i++) if (h.position >= starts[i]) idx = i;
      const endOfPart = starts[idx] + elems[idx].product.length - 1;
      const spansWrap = h.position + enzyme.site.length - 1 > product.length;
      const nextIdx = spansWrap ? 0 : (idx + 1) % elems.length;
      const junction = spansWrap
        ? `the junction that closes the circle, ${elems[elems.length - 1].name} → ${elems[0].name}`
        : h.position + enzyme.site.length - 1 > endOfPart
          ? `the ${elems[idx].name} → ${elems[nextIdx].name} junction`
          : `${elems[idx].name}`;
      return {
        ok: false,
        error:
          `Joining these parts SPELLS a new ${enzyme.name} site (${enzyme.site}) at position ${h.position} of the ` +
          `assembled product, on the ${h.strand === 1 ? "forward" : "reverse"} strand, across ${junction}. ` +
          `No part contains that site on its own, but the finished plasmid does, so ${enzyme.name} would cut the ` +
          `product it just assembled. Shift that junction by a base or two, or use a different Type IIS enzyme.`,
      };
    }
  }

  // 4. THE PRIMERS. The tail is the enzyme's site, the spacer, and (for a
  //    reverse primer) the NEXT part's fusion site.
  const spacer = "A".repeat(spacerLength);
  const primers: DesignedPrimer[] = [];
  for (let i = 0; i < elems.length; i++) {
    const p = elems[i];
    // A destination vector is cut out of its own plasmid, so it has no primers.
    if (!p.amplified) continue;
    const next = overhangs[(i + 1) % elems.length];
    const fwdAnneal = chooseAnneal((len) => p.template.slice(0, len), targetTm);
    if ("ok" in fwdAnneal) return fwdAnneal;
    const revAnneal = chooseAnneal((len) => reverseComplement(p.template.slice(p.template.length - len)), targetTm);
    if ("ok" in revAnneal) return revAnneal;

    // `lead` is empty for every ordinary part; for the first part of a
    // destination-vector assembly it is the overhang the VECTOR defines, which
    // is not in the part's own sequence and so has to be ordered on the primer.
    const fwdTail = enzyme.site + spacer + p.lead;
    // The downstream fusion site rides on this part's reverse primer, as the
    // reverse complement, so the cut leaves the next part's own four bases.
    const revTail = enzyme.site + spacer + reverseComplement(next.seq);
    primers.push(primerRecord(`${p.name} forward`, fwdTail, fwdAnneal.seq, fwdAnneal.tm, targetTm));
    primers.push(primerRecord(`${p.name} reverse`, revTail, revAnneal.seq, revAnneal.tm, targetTm));
  }

  // Cross-dimer check between the two primers of each part, on the annealing
  // 3′ ends (the tails are identical on every primer by construction, so a tail
  // match is not news).
  for (let i = 0; i + 1 < primers.length; i += 2) {
    const k = threePrimeComplement(primers[i].anneal, primers[i + 1].anneal);
    if (k >= 4) {
      primers[i].warnings.push(`Its 3′ ${k} bases are complementary to the paired reverse primer's annealing region, so the pair can prime off each other.`);
    }
  }

  const productLength = elems.reduce((s, e) => s + e.product.length, 0);
  notes.push(
    `Fusion sites are the first ${overhangLength} bases of each part, so every junction's bases belong to one part ` +
      `and the assembled product is the parts joined end to end: ${elems.map((e) => `${e.name} ${e.product.length}`).join(" + ")} = ${productLength} bp.`,
  );
  if (destination) {
    const d = destination;
    notes.push(
      (elems[0].lead
        ? `The ${overhangLength} nt the vector's 3′ end accepts (${d.overhang3}) are the dropout's own first bases, ` +
          `not “${elems[0].name}”'s, so they are ordered on that part's forward primer tail, which is why ` +
          `“${elems[0].name}” counts as ${elems[0].product.length} bp above and ${elems[0].template.length} bp of it ` +
          `is template. `
        : `“${elems[0].name}” already begins with ${d.overhang3}, the overhang this vector's 3′ end accepts, so it ` +
          `carries that fusion site itself and nothing was added to its forward primer. `) +
        `The vector body keeps ${d.overhang5} as its own ${overhangLength} nt 5′ overhang, and ` +
        `“${elems[elems.length - 2].name}”'s reverse primer carries its reverse complement.`,
    );
    notes.push(
      `Both ${enzyme.name} sites leave with the dropout, so the assembled plasmid carries no ${enzyme.name} site at ` +
        `all (checked on the finished product, both strands, across the closing junction). That is what lets the ` +
        `digestion and the ligation run in one pot.`,
    );
    notes.push(
      `The vector is digested, not amplified: it gets no primers. Only the ${primers.length / 2} part${primers.length === 2 ? "" : "s"} ` +
        `are amplified, and the dropout (${d.dropout.length.toLocaleString("en-US")} bp) is replaced by ` +
        `${(productLength - d.body.length).toLocaleString("en-US")} bp of insert.`,
    );
    if (d.body.length < d.dropout.length) {
      warnings.push(
        `The piece this vector KEEPS (${d.body.length.toLocaleString("en-US")} bp) is shorter than the piece it ` +
          `loses (${d.dropout.length.toLocaleString("en-US")} bp). The two recognition sites always leave on the ` +
          `fragment they sit on, so check that they are on the dropout and not on your backbone: if the origin and ` +
          `the selection marker are in the ${d.dropout.length.toLocaleString("en-US")} bp being discarded, the sites ` +
          `are the wrong way round and nothing will transform.`,
      );
    }
  }
  notes.push(
    `${enzyme.name} (${enzyme.site}) cuts ${spacerLength} nt past its site on the top strand and leaves a ` +
      `${overhangLength} nt 5′ overhang; both numbers are read from the enzyme table, not assumed.`,
  );
  notes.push(
    `The primer tails add ${enzyme.site.length + spacerLength} nt (site + spacer) to each primer, and the reverse ` +
      `primer of each part also carries the next part's ${overhangLength} nt fusion site.`,
  );
  return {
    ok: true,
    enzyme,
    spacerLength,
    overhangLength,
    overhangs,
    primers,
    productLength,
    productSequence: product,
    destination,
    partLengths: elems.map((e) => e.product.length),
    order: elems.map((e) => e.name),
    circular: true,
    warnings,
    notes,
  };
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function primerRecord(name: string, tail: string, anneal: string, tm: PrimerTm, targetTm: number): DesignedPrimer {
  const warnings: string[] = [];
  const self = threePrimeComplement(anneal, anneal);
  if (self >= 4) {
    warnings.push(`Its 3′ ${self} bases are complementary to a stretch of the primer itself, so it can fold back and prime on itself.`);
  }
  if (Math.abs(tm.tm - targetTm) > TM_TOLERANCE) {
    warnings.push(
      `Its annealing Tm is ${tm.tm.toFixed(1)} °C, more than ${TM_TOLERANCE} °C from the ${targetTm.toFixed(0)} °C target; ` +
        `no length in the ${MIN_ANNEAL}–${MAX_ANNEAL} nt window gets closer on this sequence.`,
    );
  }
  return {
    name,
    seq: tail + anneal,
    tail,
    anneal,
    tm,
    gc: gcPercent(anneal),
    clamp: gcClamp(anneal),
    warnings,
  };
}

// ------------------------------------------------------------------- Gibson

export interface GibsonSpec {
  fragments: Part[];
  /** Assemble into a circle (the last fragment joins the first). */
  circular: boolean;
  /** "length" designs a fixed overlap; "tm" grows the overlap until it melts at or above `targetOverlapTm`. */
  mode: "length" | "tm";
  /** Overlap length for "length" mode. NEB's guidance is 15–30 nt; see NEB_OVERLAP_SOURCE. */
  overlapLength?: number;
  /** Target overlap Tm for "tm" mode, °C. */
  targetOverlapTm?: number;
  /** Target Tm for the annealing part of each primer, °C. */
  targetTm?: number;
}

export interface GibsonJunction {
  /** Position of the upstream fragment in the assembly order — the key for its tail. */
  upstreamIndex: number;
  downstreamIndex: number;
  upstream: string;
  downstream: string;
  /** The shared region: the first `length` bases of the downstream fragment. */
  overlap: string;
  length: number;
  tm: PrimerTm;
  gc: number;
}

export interface GibsonOk {
  ok: true;
  junctions: GibsonJunction[];
  primers: DesignedPrimer[];
  productLength: number;
  /** Each fragment's length, in assembly order. */
  partLengths: number[];
  circular: boolean;
  order: string[];
  warnings: string[];
  notes: string[];
}

export type GibsonResult = GibsonOk | CloningRefusal;

/**
 * Designs a Gibson / NEBuilder HiFi assembly.
 *
 * THE DESIGN CONVENTION: the overlap at each junction is the first N bases of
 * the DOWNSTREAM fragment, and it is added to the UPSTREAM fragment's reverse
 * primer as a 5′ tail (as its reverse complement). One tail per junction is all
 * the homology the reaction needs, the downstream fragment's forward primer
 * stays a plain primer, and no base is duplicated — so the product length is the
 * sum of the fragment lengths.
 */
export function gibson(spec: GibsonSpec): GibsonResult {
  const frags = spec.fragments;
  if (frags.length < 2) return { ok: false, error: "A Gibson assembly needs at least two fragments." };
  if (frags.length > MAX_PARTS) return { ok: false, error: `${frags.length} fragments; this tool is capped at ${MAX_PARTS}.` };
  const clash = duplicateName(frags);
  if (clash) return { ok: false, error: clash };

  const targetTm = spec.targetTm ?? 60;
  const warnings: string[] = [];
  const notes: string[] = [];
  const junctionCount = spec.circular ? frags.length : frags.length - 1;

  const wantLen = Math.round(spec.overlapLength ?? 20);
  if (spec.mode === "length" && (!(wantLen >= MIN_OVERLAP) || wantLen > MAX_OVERLAP)) {
    return {
      ok: false,
      error: `An overlap of ${wantLen} nt is outside the ${MIN_OVERLAP}–${MAX_OVERLAP} nt this tool designs. ${NEB_OVERLAP_SOURCE}`,
    };
  }
  const targetOverlapTm = spec.targetOverlapTm ?? 48;
  if (spec.mode === "tm" && !(targetOverlapTm > 0 && targetOverlapTm < 120)) {
    return { ok: false, error: `A target overlap Tm of ${targetOverlapTm} °C is not a temperature this tool will design to.` };
  }

  for (const f of frags) {
    if (f.seq.length < MAX_OVERLAP + MIN_ANNEAL) {
      if (f.seq.length < wantLen + MIN_ANNEAL) {
        return {
          ok: false,
          error: `“${f.name}” is ${f.seq.length} nt: too short to carry a ${wantLen} nt overlap and an annealing region of at least ${MIN_ANNEAL} nt.`,
        };
      }
    }
  }

  const junctions: GibsonJunction[] = [];
  for (let j = 0; j < junctionCount; j++) {
    const up = frags[j];
    const down = frags[(j + 1) % frags.length];
    let length = wantLen;
    if (spec.mode === "tm") {
      // Grow the overlap one base at a time until it melts at or above the
      // target. Bounded by MAX_OVERLAP, and if the target is never reached the
      // longest overlap is used WITH A WARNING rather than silently.
      length = MIN_OVERLAP;
      let reached = false;
      for (let L = MIN_OVERLAP; L <= Math.min(MAX_OVERLAP, down.seq.length); L++) {
        const t = primerTm(down.seq.slice(0, L));
        length = L;
        if (!t.refusal && t.tm >= targetOverlapTm) {
          reached = true;
          break;
        }
      }
      if (!reached) {
        warnings.push(
          `The ${up.name} → ${down.name} junction does not reach ${targetOverlapTm.toFixed(0)} °C even at ${length} nt ` +
            `(the longest overlap this tool designs); it is used as is.`,
        );
      }
    }
    if (down.seq.length < length) {
      return { ok: false, error: `“${down.name}” is shorter than the ${length} nt overlap the ${up.name} junction needs.` };
    }
    const overlap = down.seq.slice(0, length);
    const tm = primerTm(overlap);
    junctions.push({
      upstreamIndex: j,
      downstreamIndex: (j + 1) % frags.length,
      upstream: up.name,
      downstream: down.name,
      overlap,
      length,
      tm,
      gc: gcPercent(overlap),
    });
  }

  // One forward and one reverse primer per fragment; the reverse primer of the
  // upstream fragment of each junction carries that junction's overlap.
  //
  // KEYED BY INDEX, NOT BY NAME. A Map keyed by name collapsed two fragments
  // called "X" into one entry, so the third fragment of X, Y, X was given the
  // FIRST X's tail — a wrong oligo in a result that looked right. Duplicate
  // names are refused upstream now, and this array makes the collision
  // impossible rather than merely unlikely.
  const tailFor: string[] = frags.map(() => "");
  for (const j of junctions) tailFor[j.upstreamIndex] = reverseComplement(j.overlap);

  const primers: DesignedPrimer[] = [];
  for (const [fi, f] of frags.entries()) {
    const fwd = chooseAnneal((len) => f.seq.slice(0, len), targetTm);
    if ("ok" in fwd) return fwd;
    const rev = chooseAnneal((len) => reverseComplement(f.seq.slice(f.seq.length - len)), targetTm);
    if ("ok" in rev) return rev;
    primers.push(primerRecord(`${f.name} forward`, "", fwd.seq, fwd.tm, targetTm));
    primers.push(primerRecord(`${f.name} reverse`, tailFor[fi], rev.seq, rev.tm, targetTm));
  }

  const productLength = frags.reduce((s, f) => s + f.seq.length, 0);
  const nf = frags.length;
  const guidance = nf <= 3 ? "15–20 nt (NEBuilder HiFi, 2–3 fragments)" : "20–30 nt (NEBuilder HiFi, 4–6 fragments)";
  const outside = junctions.filter((j) => (nf <= 3 ? j.length < 15 || j.length > 20 : j.length < 20 || j.length > 30));
  if (outside.length) {
    warnings.push(
      `${outside.length} of ${junctions.length} overlaps are outside NEB's published range of ${guidance}. ${NEB_OVERLAP_SOURCE}`,
    );
  }
  notes.push(
    `The overlap at each junction is the first N bases of the downstream fragment, carried on the upstream ` +
      `fragment's reverse primer as a 5′ tail. No base is duplicated, so the ${spec.circular ? "circular" : "linear"} ` +
      `product is ${frags.map((f) => `${f.name} ${f.seq.length}`).join(" + ")} = ${productLength} bp.`,
  );
  notes.push(`NEB's published overlap guidance for ${nf} fragments is ${guidance}. ${NEB_OVERLAP_SOURCE}`);
  if (spec.mode === "tm") {
    notes.push(
      `Overlap length was chosen as the shortest ${MIN_OVERLAP}–${MAX_OVERLAP} nt overlap whose Tm reaches ` +
        `${targetOverlapTm.toFixed(0)} °C. That target is this tool's adjustable default, NOT a number from NEB: ` +
        `NEB's own guidance is the length range above.`,
    );
  }
  notes.push(
    "No secondary-structure prediction is attempted for the overlaps: a repeat or hairpin score this tool cannot " +
      "verify offline would be a guess, so only the exact 3′ complementarity of each primer is checked.",
  );
  return {
    ok: true,
    junctions,
    primers,
    productLength,
    partLengths: frags.map((f) => f.seq.length),
    circular: spec.circular,
    order: frags.map((f) => f.name),
    warnings,
    notes,
  };
}

// --------------------------------------------------------------- PCR primers

export interface PcrSpec {
  /** Cleaned template. */
  template: string;
  /** 1-based inclusive region to amplify. */
  start: number;
  end: number;
  targetTm?: number;
  minLen?: number;
  maxLen?: number;
}

export interface PcrOk {
  ok: true;
  forward: DesignedPrimer;
  reverse: DesignedPrimer;
  ampliconLength: number;
  region: { start: number; end: number };
  deltaTm: number;
  targetTm: number;
  warnings: string[];
  notes: string[];
}

export type PcrResult = PcrOk | CloningRefusal;

/** Designs a primer pair for a region of a template. */
export function pcrPrimers(spec: PcrSpec): PcrResult {
  const t = spec.template;
  if (!t) return { ok: false, error: "No template: paste the sequence to amplify from." };
  if (t.length > MAX_CLONING_SEQUENCE) {
    return { ok: false, error: `The template is ${t.length.toLocaleString("en-US")} bases, past the ${MAX_CLONING_SEQUENCE.toLocaleString("en-US")} this tool designs against.` };
  }
  if (/[^ACGT]/.test(t)) {
    const codes = [...new Set(t.replace(/[ACGT]/g, "").split(""))].join(", ");
    return {
      ok: false,
      error: `The template contains ${codes}. A primer cannot be designed against an undefined base: its Tm and its match are both unknown there.`,
    };
  }
  const minLen = Math.round(spec.minLen ?? MIN_ANNEAL);
  const maxLen = Math.round(spec.maxLen ?? MAX_ANNEAL);
  if (!(minLen >= 8) || !(maxLen >= minLen) || maxLen > 60) {
    return { ok: false, error: `Primer length limits of ${minLen}–${maxLen} nt are not usable; use a window between 8 and 60 nt.` };
  }
  const { start, end } = spec;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return { ok: false, error: "The region start and end must be whole base positions (1-based, inclusive)." };
  }
  if (start < 1 || end > t.length || end < start) {
    return {
      ok: false,
      error:
        `The region ${start}–${end} is not inside this template, which is 1–${t.length}. ` +
        `Positions are 1-based and inclusive.`,
    };
  }
  const regionLen = end - start + 1;
  if (regionLen < 2 * minLen) {
    return {
      ok: false,
      error:
        `The region ${start}–${end} is ${regionLen} bp, shorter than two ${minLen} nt primers. The forward and ` +
        `reverse primers would overlap, which amplifies the primers rather than the template.`,
    };
  }
  const targetTm = spec.targetTm ?? 60;
  if (!(targetTm > 20 && targetTm < 100)) {
    return { ok: false, error: `A target Tm of ${targetTm} °C is not a temperature this tool will design to.` };
  }

  const fwd = chooseAnneal((len) => t.slice(start - 1, start - 1 + len), targetTm, minLen, maxLen);
  if ("ok" in fwd) return fwd;
  const rev = chooseAnneal((len) => reverseComplement(t.slice(end - len, end)), targetTm, minLen, maxLen);
  if ("ok" in rev) return rev;

  const forward = primerRecord("Forward", "", fwd.seq, fwd.tm, targetTm);
  const reverse = primerRecord("Reverse", "", rev.seq, rev.tm, targetTm);
  const warnings: string[] = [];
  const cross = threePrimeComplement(forward.anneal, reverse.anneal);
  if (cross >= 4) {
    warnings.push(`The forward primer's 3′ ${cross} bases are complementary to the reverse primer, so the pair can form a primer-dimer.`);
  }
  const crossR = threePrimeComplement(reverse.anneal, forward.anneal);
  if (crossR >= 4 && crossR !== cross) {
    warnings.push(`The reverse primer's 3′ ${crossR} bases are complementary to the forward primer, so the pair can form a primer-dimer.`);
  }
  const deltaTm = Math.abs(forward.tm.tm - reverse.tm.tm);
  if (deltaTm > TM_TOLERANCE) {
    warnings.push(
      `The two primers differ by ${deltaTm.toFixed(1)} °C in Tm (more than ${TM_TOLERANCE} °C). The cooler primer sets ` +
        `the annealing temperature, and the hotter one then binds less specifically.`,
    );
  }
  if (forward.clamp === 0) warnings.push("The forward primer has no G or C in its last three bases, so its 3′ end binds weakly.");
  if (reverse.clamp === 0) warnings.push("The reverse primer has no G or C in its last three bases, so its 3′ end binds weakly.");

  const notes: string[] = [
    `Lengths were chosen as the ${minLen}–${maxLen} nt whose Tm is closest to ${targetTm.toFixed(0)} °C (ties to the shorter primer).`,
    `The amplicon is the region as given, ${start}–${end}, which is ${regionLen} bp; the primers lie INSIDE it, so the product is exactly this region.`,
    "Specificity is not checked: this tool does not know what else is in your template or genome, and a perfect Tm " +
      "on a primer that binds in three places still fails.",
  ];
  return { ok: true, forward, reverse, ampliconLength: regionLen, region: { start, end }, deltaTm, targetTm, warnings, notes };
}
