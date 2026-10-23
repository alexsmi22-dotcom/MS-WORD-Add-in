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
  for (const p of all) {
    if (p.seq.length < overhangLength + MIN_ANNEAL) {
      return {
        ok: false,
        error: `“${p.name}” is ${p.seq.length} nt: too short to carry a ${overhangLength} nt fusion site and an annealing region of at least ${MIN_ANNEAL} nt.`,
      };
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

  // 2. THE FUSION SITES.
  const overhangs: Overhang[] = all.map((p) => ({ part: p.name, seq: p.seq.slice(0, overhangLength) }));

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
  {
    const product = all.map((p) => p.seq).join("");
    // Where each part starts in the product, 1-based, for naming the junction.
    const starts: number[] = [];
    let at = 1;
    for (const p of all) {
      starts.push(at);
      at += p.seq.length;
    }
    const inProduct = findSites(product, { only: [enzyme.name], circular: true });
    if (inProduct.length) {
      const h = inProduct[0];
      // The junction a hit spans: the part it starts in, and the next one, with
      // the wrap named as such.
      let idx = 0;
      for (let i = 0; i < starts.length; i++) if (h.position >= starts[i]) idx = i;
      const endOfPart = starts[idx] + all[idx].seq.length - 1;
      const spansWrap = h.position + enzyme.site.length - 1 > product.length;
      const nextIdx = spansWrap ? 0 : (idx + 1) % all.length;
      const junction = spansWrap
        ? `the junction that closes the circle, ${all[all.length - 1].name} → ${all[0].name}`
        : h.position + enzyme.site.length - 1 > endOfPart
          ? `the ${all[idx].name} → ${all[nextIdx].name} junction`
          : `${all[idx].name}`;
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
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const next = overhangs[(i + 1) % all.length];
    const fwdAnneal = chooseAnneal((len) => p.seq.slice(0, len), targetTm);
    if ("ok" in fwdAnneal) return fwdAnneal;
    const revAnneal = chooseAnneal((len) => reverseComplement(p.seq.slice(p.seq.length - len)), targetTm);
    if ("ok" in revAnneal) return revAnneal;

    const fwdTail = enzyme.site + spacer;
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

  const productLength = all.reduce((s, p) => s + p.seq.length, 0);
  notes.push(
    `Fusion sites are the first ${overhangLength} bases of each part, so every junction's bases belong to one part ` +
      `and the assembled product is the parts joined end to end: ${all.map((p) => `${p.name} ${p.seq.length}`).join(" + ")} = ${productLength} bp.`,
  );
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
    partLengths: all.map((p) => p.seq.length),
    order: all.map((p) => p.name),
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
