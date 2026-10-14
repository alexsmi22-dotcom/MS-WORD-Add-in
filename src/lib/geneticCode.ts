// The NCBI genetic codes ("translation tables"), for DNA-mode translation, the
// ORF finder and the ST.26 CDS /translation.
//
// DATA PROVENANCE. Every ncbieaa / sncbieaa string below is copied VERBATIM from
// NCBI `gc.prt` **version 4.6** (ftp.ncbi.nih.gov/entrez/misc/data/gc.prt,
// downloaded 2026-10-14, sha256 2aecbdd09ecc5e0d233c105090a593737298ef93d88f6bc0c1bef26df6051a04),
// and was checked codon by codon against Biopython 1.88 `Bio.Data.CodonTable`
// (27 tables, 0 mismatches). Nothing here is hand-typed as a codon map: the maps
// are DERIVED from the strings at load, so a single wrong codon cannot hide in a
// 64-entry object literal. The adversarial test compares every cell against an
// independent per-codon copy built from Biopython's data.
//
// String order is NCBI's: base 1, base 2, base 3 each running T C A G, so index
// 16·b1 + 4·b2 + b3.
//   ncbieaa  — the amino acid each codon is READ as ("*" = always a stop).
//   sncbieaa — "M" marks an initiation codon; "*" marks a codon that can stop.
//              Where sncbieaa says "*" but ncbieaa gives a residue (tables 27,
//              28 and 31 only) the codon is BOTH stop and sense, depending on
//              context. We translate it as the residue (as NCBI and Biopython
//              do) and SAY so; the ORF finder refuses those tables.
//
// Pure data + lookup — no imports — so dna.ts and sequence.ts can both use it
// without a cycle. Degenerate-codon resolution lives in dna.ts `resolveCodon`.

export const GC_PRT_VERSION = "4.6";
export const GC_PRT_SHA256 = "2aecbdd09ecc5e0d233c105090a593737298ef93d88f6bc0c1bef26df6051a04";

const BASES = "TCAG";

export interface GeneticCode {
  /** NCBI id (the /transl_table value). */
  readonly id: number;
  /** The gc.prt name, line breaks collapsed (table 4's name spans two lines there). */
  readonly name: string;
  /** Every gc.prt `name` line, including the "SGCn" alias where one exists. */
  readonly names: readonly string[];
  /** 64 chars, gc.prt verbatim. */
  readonly ncbieaa: string;
  /** 64 chars, gc.prt verbatim. */
  readonly sncbieaa: string;
  /** Codon (DNA, uppercase) → one-letter residue or "*". Derived from ncbieaa. */
  readonly codons: Readonly<Record<string, string>>;
  /** Initiation codons (sncbieaa "M"), in NCBI order. */
  readonly starts: readonly string[];
  /** Codons that are always stops (ncbieaa "*"), in NCBI order. */
  readonly stops: readonly string[];
  /** Codons that are stop OR sense by context (sncbieaa "*", ncbieaa a residue). */
  readonly contextStops: readonly string[];
}

/** gc.prt 4.6, verbatim. [id, names, ncbieaa, sncbieaa]. */
const RAW: ReadonlyArray<readonly [number, readonly string[], string, string]> = [
  [1, ["Standard", "SGC0"],
    "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "---M------**--*----M---------------M----------------------------"],
  [2, ["Vertebrate Mitochondrial", "SGC1"],
    "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG",
    "----------**--------------------MMMM----------**---M------------"],
  [3, ["Yeast Mitochondrial", "SGC2"],
    "FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "----------**----------------------MM---------------M------------"],
  [4, ["Mold Mitochondrial; Protozoan Mitochondrial; Coelenterate Mitochondrial; Mycoplasma; Spiroplasma", "SGC3"],
    "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "--MM------**-------M------------MMMM---------------M------------"],
  [5, ["Invertebrate Mitochondrial", "SGC4"],
    "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSSSVVVVAAAADDEEGGGG",
    "---M------**--------------------MMMM---------------M------------"],
  [6, ["Ciliate Nuclear; Dasycladacean Nuclear; Hexamita Nuclear", "SGC5"],
    "FFLLSSSSYYQQCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "--------------*--------------------M----------------------------"],
  [9, ["Echinoderm Mitochondrial; Flatworm Mitochondrial", "SGC8"],
    "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG",
    "----------**-----------------------M---------------M------------"],
  [10, ["Euplotid Nuclear", "SGC9"],
    "FFLLSSSSYY**CCCWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "----------**-----------------------M----------------------------"],
  [11, ["Bacterial, Archaeal and Plant Plastid"],
    "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "---M------**--*----M------------MMMM---------------M------------"],
  [12, ["Alternative Yeast Nuclear"],
    "FFLLSSSSYY**CC*WLLLSPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "----------**--*----M---------------M----------------------------"],
  [13, ["Ascidian Mitochondrial"],
    "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSGGVVVVAAAADDEEGGGG",
    "---M------**----------------------MM---------------M------------"],
  [14, ["Alternative Flatworm Mitochondrial"],
    "FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG",
    "-----------*-----------------------M----------------------------"],
  [15, ["Blepharisma Macronuclear"],
    "FFLLSSSSYY*QCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "----------*---*--------------------M----------------------------"],
  [16, ["Chlorophycean Mitochondrial"],
    "FFLLSSSSYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "----------*---*--------------------M----------------------------"],
  [21, ["Trematode Mitochondrial"],
    "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNNKSSSSVVVVAAAADDEEGGGG",
    "----------**-----------------------M---------------M------------"],
  [22, ["Scenedesmus obliquus Mitochondrial"],
    "FFLLSS*SYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "------*---*---*--------------------M----------------------------"],
  [23, ["Thraustochytrium Mitochondrial"],
    "FF*LSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "--*-------**--*-----------------M--M---------------M------------"],
  [24, ["Rhabdopleuridae Mitochondrial"],
    "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG",
    "---M------**-------M---------------M---------------M------------"],
  [25, ["Candidate Division SR1 and Gracilibacteria"],
    "FFLLSSSSYY**CCGWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "---M------**-----------------------M---------------M------------"],
  [26, ["Pachysolen tannophilus Nuclear"],
    "FFLLSSSSYY**CC*WLLLAPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "----------**--*----M---------------M----------------------------"],
  [27, ["Karyorelict Nuclear"],
    "FFLLSSSSYYQQCCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "--------------*--------------------M----------------------------"],
  [28, ["Condylostoma Nuclear"],
    "FFLLSSSSYYQQCCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "----------**--*--------------------M----------------------------"],
  [29, ["Mesodinium Nuclear"],
    "FFLLSSSSYYYYCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "--------------*--------------------M----------------------------"],
  [30, ["Peritrich Nuclear"],
    "FFLLSSSSYYEECC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "--------------*--------------------M----------------------------"],
  [31, ["Blastocrithidia Nuclear"],
    "FFLLSSSSYYEECCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "----------**-----------------------M----------------------------"],
  [32, ["Balanophoraceae Plastid"],
    "FFLLSSSSYY*WCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "---M------*---*----M------------MMMM---------------M------------"],
  [33, ["Cephalodiscidae Mitochondrial"],
    "FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG",
    "---M-------*-------M---------------M---------------M------------"],
];

/** The codon at NCBI index i (0..63). */
export function ncbiCodonAt(i: number): string {
  return BASES[(i >> 4) & 3] + BASES[(i >> 2) & 3] + BASES[i & 3];
}

function build(id: number, names: readonly string[], ncbieaa: string, sncbieaa: string): GeneticCode {
  if (ncbieaa.length !== 64 || sncbieaa.length !== 64) {
    throw new Error(`gc.prt data for table ${id} is not 64 codons long`);
  }
  const codons: Record<string, string> = {};
  const starts: string[] = [];
  const stops: string[] = [];
  const contextStops: string[] = [];
  for (let i = 0; i < 64; i++) {
    const codon = ncbiCodonAt(i);
    const aa = ncbieaa[i];
    const s = sncbieaa[i];
    codons[codon] = aa;
    if (s === "M") starts.push(codon);
    if (aa === "*") stops.push(codon);
    else if (s === "*") contextStops.push(codon);
  }
  return Object.freeze({
    id,
    name: names[0],
    names: Object.freeze(names.slice()),
    ncbieaa,
    sncbieaa,
    codons: Object.freeze(codons),
    starts: Object.freeze(starts),
    stops: Object.freeze(stops),
    contextStops: Object.freeze(contextStops),
  });
}

/** All 27 NCBI genetic codes, in id order. */
export const GENETIC_CODES: readonly GeneticCode[] = Object.freeze(RAW.map(([id, names, a, s]) => build(id, names, a, s)));

const BY_ID = new Map<number, GeneticCode>(GENETIC_CODES.map((c) => [c.id, c]));

/** The ids gc.prt 4.6 defines: 1–6, 9–16, 21–33. */
export const GENETIC_CODE_IDS: readonly number[] = Object.freeze(GENETIC_CODES.map((c) => c.id));

/** A named refusal: an id or name that is not an NCBI genetic code. */
export class GeneticCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneticCodeError";
  }
}

const RANGE_TEXT = "NCBI gc.prt 4.6 defines tables 1–6, 9–16 and 21–33";

/** Why an id is not a table, in words — the retired ids quote gc.prt. */
function unknownIdMessage(id: number): string {
  if (id === 7) {
    return "NCBI genetic code 7 no longer exists — gc.prt: \"Kinetoplast code now merged in code id 4\". " +
      "Use table 4 (Mold, Protozoan and Coelenterate Mitochondrial; Mycoplasma; Spiroplasma).";
  }
  if (id === 8) {
    return "NCBI genetic code 8 no longer exists — gc.prt: \"all plant chloroplast differences due to RNA edit\", " +
      "merged into code id 1. Use table 1 (Standard), or table 11 for plastid genes.";
  }
  return `There is no NCBI genetic code ${id}: ${RANGE_TEXT}.`;
}

/** The table with this NCBI id. Throws a GeneticCodeError naming the problem otherwise. */
export function geneticCodeById(id: number): GeneticCode {
  const code = Number.isInteger(id) ? BY_ID.get(id) : undefined;
  if (!code) {
    if (!Number.isInteger(id)) throw new GeneticCodeError(`"${id}" is not an NCBI genetic-code number: ${RANGE_TEXT}.`);
    throw new GeneticCodeError(unknownIdMessage(id));
  }
  return code;
}

// --- Look-up by number or name ------------------------------------------------

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bmito\b/g, "mitochondrial")
    .replace(/\bmt\b/g, "mitochondrial")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Common names → id. Each is unambiguous by the usage it names; a name that could
 * mean several tables is NOT here and is refused with the candidates listed.
 */
const ALIASES: ReadonlyArray<readonly [string, number]> = [
  ["standard", 1], ["universal", 1], ["standard code", 1],
  ["vertebrate mitochondrial", 2], ["mammalian mitochondrial", 2], ["human mitochondrial", 2],
  ["yeast mitochondrial", 3],
  ["mold mitochondrial", 4], ["protozoan mitochondrial", 4], ["coelenterate mitochondrial", 4],
  ["mycoplasma", 4], ["spiroplasma", 4], ["kinetoplast", 4],
  ["invertebrate mitochondrial", 5],
  ["ciliate", 6], ["ciliate nuclear", 6], ["dasycladacean nuclear", 6], ["hexamita nuclear", 6],
  ["echinoderm mitochondrial", 9], ["flatworm mitochondrial", 9],
  ["euplotid nuclear", 10], ["euplotid", 10],
  ["bacterial", 11], ["bacteria", 11], ["archaeal", 11], ["archaea", 11], ["prokaryotic", 11],
  ["plastid", 11], ["plant plastid", 11], ["chloroplast", 11], ["bacterial archaeal and plant plastid", 11],
  ["alternative yeast nuclear", 12],
  ["ascidian mitochondrial", 13],
  ["alternative flatworm mitochondrial", 14],
  ["blepharisma macronuclear", 15], ["blepharisma", 15],
  ["chlorophycean mitochondrial", 16],
  ["trematode mitochondrial", 21],
  ["scenedesmus obliquus mitochondrial", 22], ["scenedesmus mitochondrial", 22],
  ["thraustochytrium mitochondrial", 23],
  ["rhabdopleuridae mitochondrial", 24], ["pterobranchia mitochondrial", 24],
  ["candidate division sr1 and gracilibacteria", 25], ["sr1", 25], ["gracilibacteria", 25],
  ["pachysolen tannophilus nuclear", 26], ["pachysolen", 26],
  ["karyorelict nuclear", 27], ["condylostoma nuclear", 28], ["mesodinium nuclear", 29],
  ["peritrich nuclear", 30], ["blastocrithidia nuclear", 31],
  ["balanophoraceae plastid", 32], ["cephalodiscidae mitochondrial", 33],
];

const NAME_INDEX = new Map<string, number>();
for (const c of GENETIC_CODES) {
  for (const n of c.names) {
    NAME_INDEX.set(norm(n), c.id);
    // Each ";"-separated part of a combined gc.prt name ("Echinoderm Mitochondrial;
    // Flatworm Mitochondrial") names the same table on its own.
    for (const part of n.split(";")) NAME_INDEX.set(norm(part), c.id);
  }
}
for (const [alias, id] of ALIASES) NAME_INDEX.set(norm(alias), id);

/** Bare words that name a FAMILY of tables, not one — refused with the candidates. */
const AMBIGUOUS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["mitochondrial", [2, 3, 4, 5, 9, 13, 14, 16, 21, 22, 23, 24, 33]],
  ["yeast", [3, 12, 26]],
  ["flatworm", [9, 14]],
  ["alternative", [12, 14]],
  ["macronuclear", [6, 10, 15]],
  ["plant", [11, 32]],
  ["nuclear", [1, 6, 10, 12, 26, 27, 28, 29, 30, 31]],
];

export type GeneticCodeLookup = { ok: true; code: GeneticCode } | { ok: false; message: string };

/**
 * Finds a table by number or name: 11, "11", "table 11", "NCBI table 11",
 * "transl_table=11", "Bacterial", "bacterial, archaeal and plant plastid",
 * "vertebrate mito", "SGC1", "Mycoplasma". Never guesses: an unknown or
 * ambiguous selector comes back as a named refusal.
 */
export function findGeneticCode(selector: number | string): GeneticCodeLookup {
  if (typeof selector === "number") {
    try {
      return { ok: true, code: geneticCodeById(selector) };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
  const raw = String(selector ?? "").trim();
  if (!raw) return { ok: false, message: `No genetic code given: ${RANGE_TEXT}.` };
  if (raw.length > 200) return { ok: false, message: "That genetic-code name is too long to be one." };
  const n = norm(raw);
  // A number, possibly behind "table", "NCBI", "genetic code", "transl_table=".
  // Matched on the RAW text: normalising first would turn "table -1" into "table 1".
  const numeric = /^(?:ncbi\s+)?(?:genetic\s+code|code|table|transl_table|translation\s+table)?\s*(?:#|no\.?|=|:)?\s*([0-9]+)$/i.exec(raw);
  if (numeric) {
    const id = parseInt(numeric[1], 10);
    return findGeneticCode(id);
  }
  // A number with junk beside it ("table 2.5", "table -1") is not a table.
  if (/\d/.test(raw) && !NAME_INDEX.has(n)) {
    return { ok: false, message: `"${raw}" is not an NCBI genetic-code number: ${RANGE_TEXT}.` };
  }
  const stripped = n.replace(/^(?:ncbi )?(?:genetic code |code |table |translation table )?/, "").replace(/ (?:code|table|genetic code)$/, "");
  for (const key of [n, stripped]) {
    const id = NAME_INDEX.get(key);
    if (id !== undefined) return { ok: true, code: BY_ID.get(id)! };
  }
  for (const [word, ids] of AMBIGUOUS) {
    if (stripped === word) {
      const list = ids.map((i) => `${i} (${BY_ID.get(i)!.name})`).join("; ");
      return { ok: false, message: `"${raw}" names more than one NCBI genetic code — choose one: ${list}.` };
    }
  }
  return { ok: false, message: `"${raw}" is not the name of an NCBI genetic code: ${RANGE_TEXT}. Give the table number, or a name such as "Vertebrate Mitochondrial" or "Bacterial".` };
}

/** Like findGeneticCode but throws the named refusal as a GeneticCodeError. */
export function geneticCode(selector: number | string): GeneticCode {
  const r = findGeneticCode(selector);
  if (!r.ok) throw new GeneticCodeError(r.message);
  return r.code;
}

// --- Words for the output -------------------------------------------------------

/** "NCBI table 2 (Vertebrate Mitochondrial)" — the display form; never "transl_table=2". */
export function geneticCodeLabel(code: GeneticCode | number): string {
  const c = typeof code === "number" ? geneticCodeById(code) : code;
  return `NCBI table ${c.id} (${c.name})`;
}

/** True for the tables whose stop codons are context-dependent (27, 28, 31 in gc.prt 4.6). */
export function hasContextStops(code: GeneticCode | number): boolean {
  const c = typeof code === "number" ? geneticCodeById(code) : code;
  return c.contextStops.length > 0;
}

/**
 * The sentence that must accompany a translation under a table with context
 * stops: "Table 28: TAA/TAG/TGA are read as Q/Q/W; they can also terminate,
 * depending on context — stops are not called." Empty for every other table.
 */
export function contextStopNote(code: GeneticCode | number): string {
  const c = typeof code === "number" ? geneticCodeById(code) : code;
  if (!c.contextStops.length) return "";
  const codons = c.contextStops.join("/");
  const aas = c.contextStops.map((k) => c.codons[k]).join("/");
  const verb = c.contextStops.length === 1 ? "is" : "are";
  const pron = c.contextStops.length === 1 ? "it" : "they";
  return `Table ${c.id}: ${codons} ${verb} read as ${aas}; ${pron} can also terminate, depending on context — stops are not called.`;
}

/** The codons where this table differs from table 1, as "AGA→*" style strings. */
export function differencesFromStandard(code: GeneticCode | number): string[] {
  const c = typeof code === "number" ? geneticCodeById(code) : code;
  const std = BY_ID.get(1)!;
  const out: string[] = [];
  for (let i = 0; i < 64; i++) {
    const k = ncbiCodonAt(i);
    if (c.codons[k] !== std.codons[k]) out.push(`${k}→${c.codons[k]}`);
  }
  return out;
}

/** The honest limits, for a UI note. */
export const GENETIC_CODE_LIMITS =
  "NCBI gc.prt 4.6 tables only. Selenocysteine (UGA→U) and pyrrolysine (UAG→O) recoding need a SECIS element or " +
  "other context and cannot be expressed as a table; RNA editing is not modelled; context-dependent stops " +
  "(tables 27, 28, 31) are not called.";
