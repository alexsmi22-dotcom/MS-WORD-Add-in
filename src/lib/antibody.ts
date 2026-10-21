// Antibody variable domains (gap item 3, docs/SCOPE-ANTIBODY.md): a VH, VL (κ or λ) or VHH sequence in; its numbering
// by Kabat, Chothia and IMGT, its CDRs by the Kabat, Chothia, IMGT and AbM definitions, and the claim and table text out.
//
// How: a variable domain carries conserved landmarks that fix every region — the first cysteine (Kabat L23/H22,
// IMGT 23), the tryptophan that opens framework 2 (Kabat L35/H36, IMGT 41), the second cysteine (Kabat L88/H92,
// IMGT 104) and the J-region motif F/W-G-x-G that opens framework 4 (Kabat L98/H103, IMGT 118). Between landmarks each
// region is numbered by its own length, with the insertion and deletion positions each scheme defines (Kabat L27A…,
// H35A…, H52A…, H82A–C, L95A…, H100A…; Chothia moves the L1 insertions to L30 and the H1 insertions to H31; IMGT fills
// each CDR from both ends toward its centre and inserts at 32/33, 60/61 and 111/112). The rules were measured against
// an independent numbering tool (AntPack, GPL; the test fixture holds its output for 161 sequences, not its code).
//
// Pure: no Office.js.

export type Scheme = "kabat" | "chothia" | "imgt";
export type CdrDefinition = "kabat" | "chothia" | "imgt" | "abm";
export type ChainKind = "H" | "K" | "L";

export const CHAIN_NAMES: Record<ChainKind, string> = { H: "heavy (VH)", K: "light, κ (VL)", L: "light, λ (VL)" };

export interface Region {
  name: "FR1" | "CDR1" | "FR2" | "CDR2" | "FR3" | "CDR3" | "FR4";
  start: number; // index into the domain sequence, inclusive
  end: number; // exclusive
  seq: string;
}

export interface ChainResult {
  ok: true;
  /** The variable domain as numbered (signal peptide and constant region trimmed). */
  domain: string;
  /** Where the domain starts in the sequence given. */
  offset: number;
  chain: ChainKind;
  /** Per residue of `domain`: its position label in each scheme ("52A", IMGT "111.1"); "" when a residue is not numbered. */
  numbering: Record<Scheme, string[]>;
  /** The three CDRs under each definition. */
  cdrs: Record<CdrDefinition, { cdr1: Region; cdr2: Region; cdr3: Region }>;
  /** Frameworks and CDRs in order, under each definition. */
  regions: Record<CdrDefinition, Region[]>;
  notes: string[];
}
export type ChainError = { ok: false; errors: string[]; notes: string[] };

const AA = /^[ACDEFGHIKLMNPQRSTVWY]+$/;

/** A sequence as pasted: FASTA header lines dropped, spaces, digits and line breaks ignored, letters upper-cased. */
export function cleanSequence(text: string): { seq: string; errors: string[] } {
  const body = text
    .split(/\r\n|\r|\n/)
    .filter((l) => !l.trim().startsWith(">"))
    .join("")
    .replace(/[\s\d.\-]/g, "")
    .toUpperCase();
  const errors: string[] = [];
  // A stop at the end of a translation is fine; one inside the sequence means it is not one protein chain.
  const stops = body.replace(/\*+$/, "");
  if (stops.includes("*")) errors.push("A stop (“*”) inside the sequence — paste one protein chain, translated through to its end.");
  const seq = stops.replace(/\*/g, "");
  const bad = [...new Set(seq.replace(/[ACDEFGHIKLMNPQRSTVWY]/g, ""))];
  if (bad.length) errors.push(`Not amino-acid letters: ${bad.map((c) => `“${c}”`).join(", ")} — a protein sequence in one-letter code.`);
  return { seq, errors };
}

const letters = (n: number): string => {
  let s = "";
  let k = n;
  do {
    s = String.fromCharCode(65 + (k % 26)) + s;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return s;
};

/**
 * Positions for a region of `n` residues whose numbers run base[0]…base[last], with insertions after `insertAfter`
 * (insertAfter, insertAfter+"A", "B" …) and deletions taken from `deleteOrder` first.
 */
function linear(n: number, base: number[], insertAfter: number, deleteOrder: number[]): string[] | null {
  if (n >= base.length) {
    const extra = n - base.length;
    const out: string[] = [];
    for (const b of base) {
      out.push(String(b));
      if (b === insertAfter) for (let i = 0; i < extra; i++) out.push(`${b}${letters(i)}`);
    }
    return out;
  }
  const drop = base.length - n;
  if (drop > deleteOrder.length) return null;
  const gone = new Set(deleteOrder.slice(0, drop));
  return base.filter((b) => !gone.has(b)).map(String);
}

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * IMGT CDR positions: filled alternately from each end toward the centre (27, 38, 28, 37 …), insertions beyond the
 * full length alternating at the two central positions (112.1, 111.1, 112.2 …, read in sequence as 111, 111.1 …,
 * 112.2, 112.1, 112).
 */
function imgtCdr(n: number, lo: number, hi: number, cLeft: number, cRight: number, rightFirst: boolean): string[] {
  const full = hi - lo + 1;
  if (n <= full) {
    const order: number[] = [];
    for (let i = 0; i < full; i++) order.push(i % 2 === 0 ? lo + i / 2 : hi - (i - 1) / 2);
    const keep = new Set(order.slice(0, n));
    return range(lo, hi).filter((p) => keep.has(p)).map(String);
  }
  const extra = n - full;
  // The first insertion goes on the right-centre position for CDR1 and CDR2 (33.1, 61.1), on 112 for CDR3.
  let nr = 0, nl = 0;
  for (let i = 0; i < extra; i++) {
    if ((i % 2 === 0) === rightFirst) nr++;
    else nl++;
  }
  const out: string[] = [];
  for (const p of range(lo, hi)) {
    if (p === cRight) for (let i = nr; i >= 1; i--) out.push(`${cRight}.${i}`);
    out.push(String(p));
    if (p === cLeft) for (let i = 1; i <= nl; i++) out.push(`${cLeft}.${i}`);
  }
  // cRight's insertions read before cRight itself; cLeft's after cLeft — already in that order.
  return out;
}

interface Anchors {
  cys1: number;
  trp: number;
  cys2: number;
  j: number;
  chain: ChainKind;
}

/** The J-region motif: kappa ends …EIK / …DIK, lambda …TVL. */
function lightKind(seq: string, j: number, start: number): "K" | "L" {
  const fr4 = seq.slice(j, j + 11);
  if (/^FG[A-Z]G[TSA][KQRE][LV]T[VLA]L/.test(fr4)) return "L";
  if (/^FG[A-Z]G[TSA]K[LVA][EDQ][IL][KRN]/.test(fr4)) return "K";
  const fr1 = seq.slice(start, start + 8);
  if (/^(QS[AVL]L|SY[EV]L|SS[EG]L|NFML|QA[VG][LV]|Q[TS]VV|QLVL|QPVL|LP[VE]L|SYEL)/.test(fr1)) return "L";
  return "K";
}

/**
 * Framework 4 as it reads after the J motif (Kabat H103–H113 WGQGTLVTVSS, L98–L107 FGQGTKVEIK / FGGGTKLTVL): a
 * W-G-x-G inside a long CDR-H3 is not followed by it, the real one is.
 */
const HEAVY_FR4 = /^[WR]G.G[TASRK].[VLI][TIS]V[SAP]/;
const LIGHT_FR4 = /^FG.G[TSA].[LVKR].[IVL]/;

/** Framework 4 after the J motif, position by position (for a sequence that ends inside it). */
const HEAVY_FR4_POS = [/[TASRK]/, /./, /[VLI]/, /[TIS]/, /V/, /[SAP]/];
const LIGHT_FR4_POS = [/[TSA]/, /./, /[LVKR]/, /./, /[IVL]/];

/**
 * The J motif in `tail`: the first one followed by framework 4. When none is (the sequence ends inside framework 4),
 * the motif whose following residues best match framework 4 as far as they go — a W-G-x-G inside a long CDR-H3 is
 * followed by CDR residues, the real one by framework 4 or by the end — the later one on a tie.
 */
function jMotif(tail: string, heavy: boolean): number {
  const fr4 = heavy ? HEAVY_FR4 : LIGHT_FR4;
  const pos = heavy ? HEAVY_FR4_POS : LIGHT_FR4_POS;
  let best = -1, bestScore = -1;
  for (let i = 0; i + 4 <= tail.length; i++) {
    const t = tail.slice(i);
    if (fr4.test(t)) return i;
    if (!(heavy ? /^WG.G/ : /^FG.G/).test(t)) continue;
    const after = t.slice(4, 4 + pos.length);
    const score = after.length ? [...after].filter((c, k) => pos[k].test(c)).length / after.length : 1;
    if (score >= bestScore) (best = i), (bestScore = score);
  }
  return best;
}

function findAnchors(seq: string): { a: Anchors | null; why: string } {
  let best: { a: Anchors; score: number } | null = null;
  let why = "No first cysteine with a framework-2 tryptophan after it — this does not read as an antibody variable domain.";
  for (let c1 = 0; c1 < seq.length && c1 < 60; c1++) {
    if (seq[c1] !== "C") continue;
    for (const heavy of [true, false]) {
      // Trp opening framework 2: heavy W36 ≈ Cys+14 (H1 of 5), WVRQ / WIRQ / WFRQ …; light W35 ≈ Cys+12 (L1 of 11).
      const lo = c1 + (heavy ? 12 : 9), hi = c1 + (heavy ? 22 : 25);
      for (let w = lo; w <= hi && w < seq.length; w++) {
        if (seq[w] !== "W") continue;
        const next = seq.slice(w + 1, w + 4);
        // VHHs often read W-F-R-Q or W-Y-R-Q here; the J motif (W-G-x-G heavy, F-G-x-G light) settles which chain it is.
        const motif = heavy ? /^[VIFALY][RKQ][QRKE]/.test(next) : /^[YFLVHIN][QLRKH][QRKEH]/.test(next);
        if (!motif) continue;
        // Second cysteine: heavy ≈ W+59 (H2 of 16 from W+14, then 29 residues of FR3 before it), light ≈ W+53.
        const want = heavy ? w + 59 : w + 53;
        let c2 = -1;
        for (let d = 0; d <= 12 && c2 < 0; d++) {
          for (const k of d === 0 ? [want] : [want + d, want - d]) {
            if (seq[k] === "C" && /[YFH]/.test(seq[k - 2] ?? "") && /[YFHC]/.test(seq[k - 1] ?? "")) c2 = k;
          }
        }
        if (c2 < 0) continue;
        // J motif: heavy W-G-x-G after CDR3 (Kabat H3 starts at Cys2+3; H3s run past 50 residues in cattle and some
        // human antibodies), light F-G-x-G (L3 starts at Cys2+1).
        const tail = seq.slice(c2 + (heavy ? 4 : 5), c2 + (heavy ? 90 : 22));
        const at = jMotif(tail, heavy);
        if (at < 0) {
          why = heavy
            ? "A heavy-chain start but no framework 4 (W-G-x-G, then …TVSS) after the second cysteine — check the end of the sequence."
            : "A light-chain start but no framework 4 (F-G-x-G, then …EIK or …TVL) after the second cysteine — check the end of the sequence.";
          continue;
        }
        const j = c2 + (heavy ? 4 : 5) + at;
        const chain: ChainKind = heavy ? "H" : lightKind(seq, j, Math.max(0, c1 - 22));
        // Score: how close each landmark sits to its usual place.
        const score = Math.abs(want - c2) + Math.abs(c1 - (heavy ? 21 : 22)) * 0.2 + Math.abs(w - c1 - (heavy ? 14 : 12)) * 0.3;
        if (!best || score < best.score) best = { a: { cys1: c1, trp: w, cys2: c2, j, chain }, score };
      }
    }
  }
  if (best) why = "";
  return { a: best?.a ?? null, why };
}

/** Numbers a variable domain; refusals say which landmark is missing. */
export function numberChain(text: string): ChainResult | ChainError {
  const { seq, errors } = cleanSequence(text);
  if (errors.length) return { ok: false, errors, notes: [] };
  if (seq.length < 70) return { ok: false, errors: [`${seq.length} residues — a variable domain has about 105–130. Paste the whole VH or VL.`], notes: [] };
  if (seq.length > 1500) return { ok: false, errors: ["More than 1,500 residues — paste one chain at a time."], notes: [] };
  const { a, why } = findAnchors(seq);
  if (!a) return { ok: false, errors: [why], notes: [] };
  const notes: string[] = [];
  const H = a.chain === "H";
  const lambda = a.chain === "L";
  // Some light V genes (λ IGLV6) carry two extra framework-3 residues, Kabat L65A–B / IMGT 81–82: seen by where the
  // conserved R61-F62-S/T-G sits before the cysteine (26 residues before it as a rule, 28 here).
  const fr3Extra = !H && !(seq[a.cys2 - 26] === "F" && seq[a.cys2 - 27] === "R") && seq[a.cys2 - 28] === "F" && seq[a.cys2 - 29] === "R" && /^[ST]G/.test(seq.slice(a.cys2 - 27, a.cys2 - 25)) ? 2 : 0;

  // ---- Kabat / Chothia: positions per region ----
  // FR1: numbered back from the first cysteine (Kabat L23 / H22); λ has no L10.
  const fr1Base = H ? range(1, 21) : lambda ? range(1, 22).filter((p) => p !== 10) : range(1, 22);
  const fr1Len = Math.min(a.cys1, fr1Base.length);
  const start = a.cys1 - fr1Len;
  if (start > 0) notes.push(`${start} residue${start === 1 ? "" : "s"} before framework 1 (a signal peptide?) left out of the numbering.`);
  if (a.cys1 < fr1Base.length) notes.push(`The sequence starts at Kabat ${fr1Base[fr1Base.length - a.cys1]}: framework 1 is incomplete.`);
  // Framework 4 runs to Kabat L107 / H113 (IMGT 127 / 128).
  const jLen = H ? 11 : 10;
  const fr4Len = Math.min(seq.length - a.j, jLen);
  if (seq.length - a.j > fr4Len) {
    const k = seq.length - a.j - fr4Len;
    notes.push(`${k} residue${k === 1 ? "" : "s"} after framework 4 (the constant region?) left out of the numbering.`);
  }
  const domEnd = a.j + fr4Len;
  if (fr4Len < (H ? 11 : 10)) notes.push("The sequence ends inside framework 4.");

  const kab: string[] = [], cho: string[] = [], imgt: string[] = [];
  const push = (arr: string[], labels: string[]) => arr.push(...labels);
  const fr1Labels = fr1Base.slice(fr1Base.length - fr1Len).map(String);

  const failed = (what: string): ChainError => ({ ok: false, errors: [`${what} — outside what the numbering schemes define; check the sequence.`], notes });

  if (H) {
    const h1 = a.trp - (a.cys1 + 9); // Kabat H1: Cys+9 … W−1
    const h2Start = a.trp + 14, h2End = a.cys2 - 30; // exclusive end = cys2 − 29
    const h2 = a.cys2 - 29 - h2Start;
    const h3 = a.j - (a.cys2 + 3);
    const kH1 = linear(h1, range(31, 35), 35, [35, 34, 33]);
    const cH1 = linear(h1 + 5, range(26, 35), 31, [31, 30, 32]);
    const kH2 = linear(h2, range(50, 65), 52, [52, 62, 61, 60, 53]);
    const kH3 = linear(h3, range(95, 102), 100, [100, 99, 98, 97, 96, 101]);
    if (!kH1 || !cH1 || !kH2 || !kH3 || h1 < 1 || h3 < 2) return failed(`CDR lengths H1 ${h1}, H2 ${h2}, H3 ${h3}`);
    void h2End;
    const fr3 = [...range(66, 82).map(String), "82A", "82B", "82C", ...range(83, 94).map(String)];
    // Kabat
    push(kab, fr1Labels);
    push(kab, ["22", ...range(23, 30).map(String)]);
    push(kab, kH1);
    push(kab, range(36, 49).map(String));
    push(kab, kH2);
    push(kab, fr3);
    push(kab, kH3);
    push(kab, range(103, 103 + fr4Len - 1).map(String));
    // Chothia: FR1 to H25, then H26–H35 with the insertions at H31.
    push(cho, fr1Labels);
    push(cho, ["22", ...range(23, 25).map(String)]);
    push(cho, cH1);
    push(cho, kab.slice(cho.length));
  } else {
    const l1 = a.trp - (a.cys1 + 1);
    const l2End = a.cys2 - 31 - fr3Extra; // exclusive: FR3 is L57–L88, 32 residues ending at the cysteine (+ L65A–B)
    const l2 = l2End - (a.trp + 15);
    const l3 = a.j - (a.cys2 + 1);
    const kL1 = linear(l1, range(24, 34), 27, [28, 29, 30, 31, 32]);
    const cL1 = linear(l1, range(24, 34), 30, [31, 30, 29, 32, 28]);
    const kL2 = linear(l2, range(50, 56), 52, [52, 53, 51]);
    const kL3 = linear(l3, range(89, 97), 95, [95, 94, 93, 92, 96]);
    if (!kL1 || !cL1 || !kL2 || !kL3) return failed(`CDR lengths L1 ${l1}, L2 ${l2}, L3 ${l3}`);
    // Natural L2s are seven residues and L1s at least ten: shorter ones have no agreed gap position.
    if (l2 !== 7) notes.push(`CDR-L2 has ${l2} residues (natural ones have 7): where Kabat and Chothia put its ${l2 < 7 ? "gaps" : "insertions"} is a convention, and other tools may differ.`);
    if (l1 < 10) notes.push(`CDR-L1 has ${l1} residues (natural ones have 10–17): where its gaps go is a convention, and other tools may differ.`);
    const tail = (arr: string[], l1Labels: string[]) => {
      push(arr, fr1Labels);
      push(arr, ["23"]);
      push(arr, l1Labels);
      push(arr, range(35, 49).map(String));
      push(arr, kL2);
      push(arr, [...range(57, 65).map(String), ...["65A", "65B"].slice(0, fr3Extra), ...range(66, 88).map(String)]);
      push(arr, kL3);
      push(arr, range(98, 98 + fr4Len - 1).map(String));
    };
    tail(kab, kL1);
    tail(cho, cL1);
  }

  // ---- IMGT ----
  {
    const fr1I = H || lambda ? range(1, 22).filter((p) => p !== 10) : range(1, 22);
    push(imgt, fr1I.slice(fr1I.length - fr1Len).map(String));
    push(imgt, ["23", "24", "25", "26"]);
    const c1n = a.trp - 2 - (a.cys1 + 4);
    push(imgt, imgtCdr(c1n, 27, 38, 32, 33, true));
    push(imgt, range(39, 55).map(String));
    const fr3Len = H ? 38 : 36 + fr3Extra;
    const c2End = a.cys2 - fr3Len + 1; // exclusive
    const c2n = c2End - (a.trp + 15);
    if (c2n < 1) return failed(`IMGT CDR2 of ${c2n} residues`);
    push(imgt, imgtCdr(c2n, 56, 65, 60, 61, true));
    const gaps = H ? [73] : fr3Extra ? [73] : [73, 81, 82];
    push(imgt, range(66, 104).filter((p) => !gaps.includes(p)).map(String));
    const c3n = a.j - (a.cys2 + 1);
    push(imgt, imgtCdr(c3n, 105, 117, 111, 112, true));
    push(imgt, range(118, 118 + fr4Len - 1).map(String));
  }

  const domain = seq.slice(start, domEnd);
  const n = domain.length;
  for (const [name, arr] of [["Kabat", kab], ["Chothia", cho], ["IMGT", imgt]] as const) {
    if (arr.length !== n) return failed(`The ${name} numbering covers ${arr.length} of ${n} residues`);
  }

  // ---- CDRs by definition ----
  const num = (p: string): number => parseInt(p, 10);
  const span = (labels: string[], lo: number, hi: number): [number, number] => {
    let s = -1, e = -1;
    labels.forEach((p, i) => {
      const v = num(p);
      if (v >= lo && v <= hi) {
        if (s < 0) s = i;
        e = i + 1;
      }
    });
    return [s, e];
  };
  const region = (name: Region["name"], [s, e]: [number, number]): Region => ({ name, start: s, end: e, seq: domain.slice(s, e) });
  const defs: Record<CdrDefinition, { labels: string[]; r: Array<[number, number]> }> = {
    kabat: { labels: kab, r: H ? [[31, 35], [50, 65], [95, 102]] : [[24, 34], [50, 56], [89, 97]] },
    chothia: { labels: cho, r: H ? [[26, 32], [52, 56], [95, 102]] : [[24, 34], [50, 56], [89, 97]] },
    imgt: { labels: imgt, r: [[27, 38], [56, 65], [105, 117]] },
    abm: { labels: kab, r: H ? [[26, 35], [50, 58], [95, 102]] : [[24, 34], [50, 56], [89, 97]] },
  };
  const cdrs = {} as ChainResult["cdrs"];
  const regions = {} as ChainResult["regions"];
  for (const d of ["kabat", "chothia", "imgt", "abm"] as CdrDefinition[]) {
    const { labels, r } = defs[d];
    const sp = r.map(([lo, hi]) => span(labels, lo, hi));
    for (const [s, e] of sp) if (s < 0 || e <= s) return failed(`A ${d} CDR could not be placed`);
    const [c1, c2, c3] = sp.map((x, i) => region((["CDR1", "CDR2", "CDR3"] as const)[i], x));
    cdrs[d] = { cdr1: c1, cdr2: c2, cdr3: c3 };
    regions[d] = [
      region("FR1", [0, c1.start]),
      c1,
      region("FR2", [c1.end, c2.start]),
      c2,
      region("FR3", [c2.end, c3.start]),
      c3,
      region("FR4", [c3.end, n]),
    ];
  }
  if (!AA.test(domain)) return failed("The domain has letters that are not amino acids");
  return { ok: true, domain, offset: start, chain: a.chain, numbering: { kabat: kab, chothia: cho, imgt }, cdrs, regions, notes };
}
