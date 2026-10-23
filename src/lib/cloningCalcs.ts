// Pane glue for the Molecular cloning calculators: an agarose gel figure, a
// Golden Gate design, a Gibson / NEBuilder HiFi design and a PCR primer pair.
// Kept OUT of taskpane.ts so the exact objects the pane registers can be tested
// (nothing can import the pane under jest), the pattern of assayQuantCalcs.ts
// and titrationCalcs.ts.
//
// Each entry is shaped exactly like the pane's EngCalc ({id, name, group, hint,
// fields, compute}); the field and calculator types are declared structurally
// here because the pane does not export them.
//
// No biology is computed here. gel.ts owns the ladders and the migration model,
// cloning.ts owns the designs, dna.ts owns every Tm and reverse complement,
// enzymes.ts owns every recognition site and cut offset, digest.ts owns the
// fragment list and the co-migration rule, and dataBlock.ts reads every pasted
// number. This file reads the fields, words the result under the display
// contract (U+2212 minus, superscripts, no em dash, no e-notation, never NaN)
// and draws.

import { engReport } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput } from "./analyzeBlocks";
import { trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import { cleanDna } from "./dna";
import { ENZYMES } from "./enzymes";
import {
  LADDERS,
  GEL_MODEL_NOTE,
  MAX_SAMPLE_LANES,
  buildGel,
  customLadder,
  laneFromDigest,
  ladderById,
  sizeText,
  type GelSampleLane,
  type Ladder,
} from "./gel";
import { gelAlt, gelSize, gelSvg } from "./gelChart";
import {
  MAX_OVERLAP,
  MIN_OVERLAP,
  NEB_OVERLAP_SOURCE,
  TM_CONDITIONS_NOTE,
  gibson,
  goldenGate,
  pcrPrimers,
  readParts,
  type DesignedPrimer,
} from "./cloning";
import { gibsonSvg, goldenGateSvg, primerMapSvg } from "./cloningCharts";

/** The pane's AnalyzeField, structurally. */
export interface CloningField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  rows?: number;
  options?: { value: string; label: string }[];
}

/** The new Engineering group these calculators belong to (to be added to ENG_GROUP_ORDER). */
export const CLONING_GROUP = "Molecular cloning" as const;

/** The pane's EngCalc, structurally. */
export interface CloningCalc {
  id: string;
  name: string;
  group: typeof CLONING_GROUP;
  hint: string;
  fields: CloningField[];
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

// ------------------------------------------------------------------ helpers

const refuse = (text: string): AnalyzeOutput => ({
  text: trueMinus(text.replace(/—/g, "-")),
  ok: false,
});

const plot = (svg: string, size: { width: number; height: number }, caption: string, alt: string): AnalyzeBlock => ({
  kind: "plot",
  svg,
  caption,
  alt,
  w: size.width,
  h: size.height,
});

/** Figure width/height read back off the SVG root, for the builders that size themselves. */
function svgSize(svg: string): { width: number; height: number } {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 420);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 300);
  return { width: w, height: h };
}

/** A temperature, one decimal, U+2212 for a negative. */
const degC = (v: number): string => (Number.isFinite(v) ? `${trueMinus(v.toFixed(1))} °C` : "no Tm");

/** A whole number with thousands separators. */
const whole = (v: number): string => (Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "not a number");

/** A plain number field; NaN when blank or unreadable. */
function plainNum(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : NaN;
}

/** One primer, as the result lists it. */
function primerLine(p: DesignedPrimer): string {
  const tail = p.tail ? `${p.tail} + ` : "";
  return (
    `${p.name}: 5′-${tail}${p.anneal}-3′ · ${p.seq.length} nt total, ${p.anneal.length} nt annealing, ` +
    `${degC(p.tm.tm)}, ${p.gc.toFixed(0)} % GC, 3′ clamp ${p.clamp}/3` +
    (p.warnings.length ? ` · ${p.warnings.join(" ")}` : "")
  );
}

const LADDER_OPTIONS = [
  ...LADDERS.map((l) => ({ value: l.id, label: l.product })),
  { value: "custom", label: "Custom ladder (type the sizes)" },
];

const TYPE_IIS = ENZYMES.filter((e) => e.typeIIS);

/** Longest lane name the gel draws (in full, vertically when it does not fit across the lane). */
const MAX_LANE_NAME = 32;

// --------------------------------------------------------------- the gel tool

/**
 * Reads the sample-lane block: one lane per line, `name: sizes`.
 *
 * The numbers go through dataBlock.ts readDataBlock — the one number reader in
 * the app, with its decimal-comma and separator rules — after the lane names
 * are stripped off. Writing another splitter here is how two tools start
 * disagreeing about what "1,500" means.
 */
function readLanes(text: string): { lanes: GelSampleLane[]; notes: string[] } | { error: string } {
  const lines = (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { lanes: [], notes: [] };
  if (lines.length > MAX_SAMPLE_LANES) {
    return { error: `${lines.length} sample lanes; this gel takes the ladder plus up to ${MAX_SAMPLE_LANES}.` };
  }
  const names: string[] = [];
  const numeric: string[] = [];
  lines.forEach((line, i) => {
    const at = line.indexOf(":");
    if (at > 0 && /[A-Za-z]/.test(line.slice(0, at))) {
      names.push(line.slice(0, at).trim());
      numeric.push(line.slice(at + 1).trim());
    } else {
      names.push(`Lane ${i + 1}`);
      numeric.push(line);
    }
  });
  // Lane names are drawn in full (never truncated), so an essay is refused by
  // name rather than drawn as a label taller than the gel.
  const long = names.find((nm) => nm.length > MAX_LANE_NAME);
  if (long) {
    return { error: `The lane name “${long}” is ${long.length} characters; lane names are drawn in full, so keep each to ${MAX_LANE_NAME} or fewer.` };
  }
  const block = readDataBlock(numeric.join("\n"), "Sample lanes");
  if (!block.ok) return { error: block.error };
  if (block.header) {
    return {
      error:
        `The first lane line has no sizes in it (“${block.header.join(" ")}”). Write each lane as ` +
        `“name: 3000, 1500, 850”.`,
    };
  }
  const notes = [...block.notes];
  const lanes: GelSampleLane[] = block.rows.map((row, i) => {
    const sizes = row.filter((v): v is number => v !== null);
    if (sizes.length !== row.length) {
      notes.push(`${names[i]}: ${row.length - sizes.length} missing value(s) in that line were not drawn.`);
    }
    return { name: names[i] ?? `Lane ${i + 1}`, sizes };
  });
  return { lanes, notes };
}

/** The chosen ladder, or a named refusal. */
function pickLadder(read: (k: string) => string): Ladder | { error: string } {
  const id = (read("ladder") || "neb-1kb").trim();
  if (id === "custom") {
    const raw = read("custom") ?? "";
    if (!raw.trim()) {
      return { error: "A custom ladder was chosen but no sizes were given. Type the band sizes in bp, e.g. 10000, 5000, 2000, 1000, 500." };
    }
    const block = readDataBlock(raw, "Custom ladder sizes", { singleColumn: true });
    if (!block.ok) return { error: block.error };
    const sizes = block.rows.flat().filter((v): v is number => v !== null);
    const made = customLadder(sizes);
    return "error" in made ? made : made;
  }
  const l = ladderById(id);
  return l ?? { error: `“${id}” is not one of this tool's ladders.` };
}

const gelCalc: CloningCalc = {
  id: "cloning-gel",
  name: "Agarose gel figure",
  group: CLONING_GROUP,
  hint:
    "Draws a schematic agarose gel: a manufacturer's ladder beside up to 14 sample lanes. A lane is a list of " +
    "fragment sizes in bp (“Digest A: 3000, 1500, 850”), and a sequence plus enzymes becomes a lane of its own " +
    "through the virtual digest. Band positions are interpolated between the ladder's own bands, so this is a " +
    "schematic, not a prediction of a real run: agarose percentage, buffer, voltage and time are not modelled, " +
    "and a supercoiled uncut plasmid does not run at its sequence length at all.",
  fields: [
    { key: "ladder", label: "Ladder", default: "neb-1kb", kind: "select", options: LADDER_OPTIONS },
    { key: "custom", label: "Custom ladder sizes (bp), one per line or comma separated", default: "", kind: "text" },
    {
      key: "lanes",
      label: "Sample lanes, one per line: name: sizes in bp",
      default: "Digest A: 3000, 1500, 850\nPCR product: 1200",
      kind: "block",
      rows: 4,
    },
    { key: "seq", label: "Sequence for a digest lane (optional)", default: "", kind: "block", rows: 3 },
    { key: "enzymes", label: "Enzymes for that sequence (blank = every enzyme that cuts)", default: "", kind: "text" },
    {
      key: "topology",
      label: "That sequence is",
      default: "circular",
      kind: "select",
      options: [
        { value: "circular", label: "circular (a plasmid)" },
        { value: "linear", label: "linear" },
      ],
    },
    {
      key: "style",
      label: "Style",
      default: "dark-on-light",
      kind: "select",
      options: [
        { value: "dark-on-light", label: "Dark bands on light lanes (line art)" },
        { value: "ethidium", label: "Light bands on a dark gel (ethidium look)" },
      ],
    },
  ],
  compute(read) {
    const ladder = pickLadder(read);
    if ("error" in ladder) return refuse(ladder.error);

    const lanesRead = readLanes(read("lanes"));
    if ("error" in lanesRead) return refuse(lanesRead.error);
    const lanes = [...lanesRead.lanes];
    const notes = [...lanesRead.notes];

    const rawSeq = (read("seq") ?? "").trim();
    if (rawSeq) {
      const enzymeNames = (read("enzymes") ?? "")
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const circular = (read("topology") || "circular") === "circular";
      const lane = laneFromDigest("Digest", rawSeq, enzymeNames, circular);
      if ("error" in lane) return refuse(lane.error);
      lanes.push(lane);
      if (circular) {
        notes.push(
          "A circular plasmid that is NOT cut runs as supercoiled DNA, which migrates nothing like its sequence " +
            "length; only the cut fragments in this figure are placed by size.",
        );
      }
    }

    if (!lanes.length) {
      return refuse(
        "Nothing to run: give at least one sample lane (“Digest A: 3000, 1500, 850”) or a sequence and its enzymes.",
      );
    }

    const style = (read("style") || "dark-on-light") === "ethidium" ? "ethidium" : "dark-on-light";
    const model = buildGel({ ladder, lanes, style });
    if ("error" in model) return refuse(model.error);

    const lines: string[] = [];
    lines.push(
      `${model.lanes.length} lanes: the ${ladder.name} ladder and ${lanes.length} sample lane${lanes.length === 1 ? "" : "s"}.`,
    );
    lines.push(
      `Ladder: ${ladder.product}. Bands ${sizeText(model.range.max)} down to ${sizeText(model.range.min)}` +
        (ladder.load ? `, masses as published for ${ladder.load}` : "") +
        `. ${ladder.fetched ? `Band list read from ${ladder.source} on ${ladder.fetched}.` : "Sizes as typed by you."}`,
    );
    if (ladder.gelNote) lines.push(ladder.gelNote);
    for (const l of model.lanes) {
      if (l.isLadder) continue;
      lines.push(
        `${l.name}: ${l.bands.length ? l.bands.map((b) => `${whole(b.size)} bp${b.sizes.length > 1 ? ` (${b.sizes.length} fragments)` : ""}${b.offScale ? ` [off scale, drawn at the ${b.offScale === "above" ? "top" : "bottom"} edge]` : ""}`).join(", ") : "no bands"}`,
      );
    }
    lines.push(
      "Band brightness is relative within the sample lanes and proportional to the square root of Σ size × copies, " +
        "clamped so that every drawn band stays visible. It is not a quantification.",
    );
    for (const n of model.notes) if (n !== GEL_MODEL_NOTE) lines.push(n);
    lines.push(GEL_MODEL_NOTE);
    for (const n of notes) lines.push(n);

    const svg = gelSvg(model);
    const figure = plot(
      svg,
      gelSize(model),
      `Schematic agarose gel against ${ladder.product}; positions interpolated from the ladder, not a photograph of a run.`,
      gelAlt(model),
    );
    return engReport(lines, [figure]);
  },
};

// ------------------------------------------------------------- Golden Gate

const goldenGateCalc: CloningCalc = {
  id: "cloning-golden-gate",
  name: "Golden Gate assembly",
  group: CLONING_GROUP,
  hint:
    "Designs a Golden Gate assembly from ordered parts: checks every part for internal sites of the chosen " +
    "Type IIS enzyme (both strands), checks the fusion sites for duplicates, palindromes and reverse-complement " +
    "pairs, and writes the primer tails. The fusion site of a part is its own first bases, so the product is the " +
    "parts joined end to end. Refuses by name rather than designing an assembly that cannot work.",
  fields: [
    {
      key: "parts",
      label: "Parts in assembly order, one per line: name: sequence (or FASTA)",
      default:
        "promoter: AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGGCTCGTATAATGTGTGGA\n" +
        "cds: GGTTCTAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGG\n" +
        "terminator: GCTTACTCGAGCAAAGGCCCAGTCTTTCGACTGAGCCTTTCGTTTTATTTGATGCCTGGCAGTTCCCTACT",
    kind: "block", rows: 5 },
    {
      key: "enzyme",
      label: "Type IIS enzyme",
      default: "BsaI",
      kind: "select",
      options: TYPE_IIS.map((e) => ({ value: e.name, label: `${e.name} (${e.site})` })),
    },
    { key: "backbone", label: "Backbone (optional), name: sequence", default: "", kind: "block", rows: 2 },
    { key: "tm", label: "Target annealing Tm (°C)", default: "60", kind: "text" },
  ],
  compute(read) {
    const parts = readParts(read("parts"), "Parts");
    if ("ok" in parts) return refuse(parts.error);
    let backbone = null as { name: string; seq: string } | null;
    const bbText = (read("backbone") ?? "").trim();
    if (bbText) {
      const bb = readParts(bbText, "Backbone");
      if ("ok" in bb) return refuse(bb.error);
      if (bb.parts.length !== 1) return refuse(`The backbone field holds ${bb.parts.length} sequences; give exactly one.`);
      // A bare sequence gets readParts' "part 1"; in this field it is the backbone, and naming it so keeps it
      // from colliding with the first unnamed part.
      backbone = bbText.includes(bb.parts[0].name) ? bb.parts[0] : { ...bb.parts[0], name: "backbone" };
    }
    const targetTm = plainNum(read("tm")) || 60;
    if (!(targetTm > 20 && targetTm < 100)) return refuse(`A target Tm of ${read("tm")} °C is not a temperature this tool will design to.`);

    const r = goldenGate({ parts: parts.parts, enzyme: read("enzyme") || "BsaI", backbone, targetTm });
    if (!r.ok) return refuse(r.error);

    const lines: string[] = [];
    lines.push(
      `${r.order.length} parts with ${r.enzyme.name} (${r.enzyme.site}): assembled product ${whole(r.productLength)} bp, ` +
        `circular, in the order ${r.order.join(" → ")}.`,
    );
    lines.push(`No internal ${r.enzyme.name} site was found in any part (both strands were searched).`);
    lines.push(
      `Fusion sites (${r.overhangLength} nt, all distinct, none palindromic, none the reverse complement of another): ` +
        r.overhangs.map((o) => `${o.seq} (5′ end of ${o.part})`).join(", "),
    );
    lines.push(`Primers (${r.primers.length}), target ${degC(targetTm)}:`);
    for (const p of r.primers) lines.push(primerLine(p));
    for (const w of r.warnings) lines.push(`Warning: ${w}`);
    for (const n of r.notes) lines.push(n);
    for (const n of parts.notes) lines.push(n);
    lines.push(TM_CONDITIONS_NOTE);
    lines.push(
      "What this does NOT check: whether a part's internal sequence is toxic or unstable, whether the backbone " +
        "carries its own sites outside the sequence you pasted, and ligation efficiency. It is a design aid.",
    );

    const svg = goldenGateSvg(r);
    return engReport(lines, [
      plot(
        svg,
        svgSize(svg),
        `Golden Gate parts in assembly order with each junction's ${r.overhangLength} nt fusion site; box widths proportional to part length.`,
        `Golden Gate assembly of ${r.order.join(", ")} with ${r.enzyme.name}; fusion sites ${r.overhangs.map((o) => o.seq).join(", ")}; product ${r.productLength} bp.`,
      ),
    ]);
  },
};

// ------------------------------------------------------------------ Gibson

const gibsonCalc: CloningCalc = {
  id: "cloning-gibson",
  name: "Gibson / HiFi assembly",
  group: CLONING_GROUP,
  hint:
    "Designs a Gibson or NEBuilder HiFi assembly from ordered fragments: one overlap per junction, either a fixed " +
    "length or the shortest overlap that melts at or above a target Tm, with the primer that carries it. Overlap " +
    "lengths are checked against NEB's published ranges. No secondary-structure score is invented.",
  fields: [
    {
      key: "frags",
      label: "Fragments in assembly order, one per line: name: sequence (or FASTA)",
      default:
        "vector: GGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGATTTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTT\n" +
        "insert: ATGAGCAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGGTCATAAATTTTCT",
      kind: "block",
      rows: 4,
    },
    {
      key: "topology",
      label: "Assemble into",
      default: "circular",
      kind: "select",
      options: [
        { value: "circular", label: "a circle (the last fragment joins the first)" },
        { value: "linear", label: "a linear product" },
      ],
    },
    {
      key: "mode",
      label: "Choose the overlap by",
      default: "length",
      kind: "select",
      options: [
        { value: "length", label: "a fixed length (NEB's guidance)" },
        { value: "tm", label: "the shortest overlap reaching a target Tm" },
      ],
    },
    { key: "overlap", label: "Overlap length (nt)", default: "20", kind: "text" },
    { key: "otm", label: "Target overlap Tm (°C), Tm mode only", default: "48", kind: "text" },
    { key: "tm", label: "Target annealing Tm (°C)", default: "60", kind: "text" },
  ],
  compute(read) {
    const frags = readParts(read("frags"), "Fragments");
    if ("ok" in frags) return refuse(frags.error);
    const mode = (read("mode") || "length") === "tm" ? "tm" : "length";
    const overlapLength = plainNum(read("overlap"));
    if (mode === "length" && !Number.isFinite(overlapLength)) {
      return refuse(`“${read("overlap")}” is not an overlap length in nt; give a whole number between ${MIN_OVERLAP} and ${MAX_OVERLAP}.`);
    }
    const targetOverlapTm = plainNum(read("otm"));
    if (mode === "tm" && !Number.isFinite(targetOverlapTm)) {
      return refuse(`“${read("otm")}” is not a target overlap Tm in °C.`);
    }
    const targetTm = plainNum(read("tm")) || 60;
    if (!(targetTm > 20 && targetTm < 100)) return refuse(`A target Tm of ${read("tm")} °C is not a temperature this tool will design to.`);

    const r = gibson({
      fragments: frags.parts,
      circular: (read("topology") || "circular") === "circular",
      mode,
      overlapLength: Number.isFinite(overlapLength) ? overlapLength : 20,
      targetOverlapTm: Number.isFinite(targetOverlapTm) ? targetOverlapTm : 48,
      targetTm,
    });
    if (!r.ok) return refuse(r.error);

    const lines: string[] = [];
    lines.push(
      `${r.order.length} fragments, ${r.junctions.length} junction${r.junctions.length === 1 ? "" : "s"}, ` +
        `${r.circular ? "circular" : "linear"} product ${whole(r.productLength)} bp, in the order ${r.order.join(" → ")}.`,
    );
    for (const j of r.junctions) {
      lines.push(
        `${j.upstream} → ${j.downstream}: ${j.length} nt overlap ${j.overlap}, ` +
          `${j.tm.refusal ? j.tm.refusal : degC(j.tm.tm)}, ${j.gc.toFixed(0)} % GC.`,
      );
    }
    lines.push(`Primers (${r.primers.length}), target ${degC(targetTm)}:`);
    for (const p of r.primers) lines.push(primerLine(p));
    for (const w of r.warnings) lines.push(`Warning: ${w}`);
    for (const n of r.notes) lines.push(n);
    for (const n of frags.notes) lines.push(n);
    lines.push(TM_CONDITIONS_NOTE);

    const svg = gibsonSvg(r);
    return engReport(lines, [
      plot(
        svg,
        svgSize(svg),
        "Gibson fragments in assembly order; the red blocks are the shared overlaps, labelled with length and Tm.",
        `Gibson assembly of ${r.order.join(", ")}; overlaps ${r.junctions.map((j) => `${j.length} nt`).join(", ")}; product ${r.productLength} bp.`,
      ),
    ]);
  },
};

// -------------------------------------------------------------- PCR primers

const pcrCalc: CloningCalc = {
  id: "cloning-pcr-primers",
  name: "PCR primer design",
  group: CLONING_GROUP,
  hint:
    "Designs a primer pair for a region of a template (1-based, inclusive). Lengths are chosen so each primer's " +
    "Tm is as close as possible to the target; the result gives Tm, GC %, the 3′ GC clamp, ΔTm between the primers " +
    "and an exact 3′ complementarity check. Specificity against the rest of your template or genome is NOT checked.",
  fields: [
    {
      key: "template",
      label: "Template sequence (FASTA or plain)",
      default:
        "ATGAGCAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGGTCATAAATTTTCT" +
        "GTGAGCGGCGAAGGCGAAGGCGATGCGACCTATGGCAAACTGACCCTGAAATTTATTTGCACCACCGGCAAACTGCCGGTGCCG" +
        "TGGCCGACCCTGGTGACCACCTTTAGCTATGGCGTGCAGTGCTTTAGCCGCTATCCGGATCATATGAAACAGCATGATTTTTTT" +
        "AAAAGCGCGATGCCGGAAGGCTATGTGCAGGAACGCACCATTTTTTTTAAAGATGATGGCAACTATAAAACCCGCGCGGAAGTG",
      kind: "block",
      rows: 5,
    },
    { key: "start", label: "Region start (1-based, inclusive)", default: "1", kind: "text" },
    { key: "end", label: "Region end (inclusive)", default: "336", kind: "text" },
    { key: "tm", label: "Target Tm (°C)", default: "60", kind: "text" },
    { key: "lmin", label: "Shortest primer (nt)", default: "18", kind: "text" },
    { key: "lmax", label: "Longest primer (nt)", default: "30", kind: "text" },
  ],
  compute(read) {
    const { seq, invalid, records } = cleanDna(read("template") ?? "");
    if (!seq) return refuse("No DNA bases were found in the template; paste the sequence to amplify from.");
    const start = plainNum(read("start"));
    const end = plainNum(read("end"));
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return refuse(`The region must be two base positions, 1-based and inclusive; "${read("start")}" to "${read("end")}" is not.`);
    }
    const targetTm = plainNum(read("tm")) || 60;
    const lmin = plainNum(read("lmin")) || 18;
    const lmax = plainNum(read("lmax")) || 30;

    const r = pcrPrimers({ template: seq, start, end, targetTm, minLen: lmin, maxLen: lmax });
    if (!r.ok) return refuse(r.error);

    const lines: string[] = [];
    lines.push(
      `Amplicon ${whole(r.region.start)}–${whole(r.region.end)} of a ${whole(seq.length)} bp template: ` +
        `${whole(r.ampliconLength)} bp.`,
    );
    lines.push(primerLine(r.forward));
    lines.push(primerLine(r.reverse));
    lines.push(
      `ΔTm between the primers ${degC(r.deltaTm).replace("°C", "°C")}, target ${degC(r.targetTm)}; ` +
        `the cooler primer is the one that sets the annealing temperature.`,
    );
    for (const w of r.warnings) lines.push(`Warning: ${w}`);
    for (const n of r.notes) lines.push(n);
    if (invalid.length) lines.push(`Ignored in the template: ${invalid.join(", ")}.`);
    if (records > 1) lines.push(`${records} FASTA records were concatenated, which is rarely intended.`);
    lines.push(TM_CONDITIONS_NOTE);
    lines.push(
      "No hairpin or dimer thermodynamics: the only secondary-structure check is exact 3′ complementarity of " +
        "4 bases or more, which is arithmetic on the sequence rather than a free energy this tool cannot verify.",
    );

    const svg = primerMapSvg(r, seq.length);
    return engReport(lines, [
      plot(
        svg,
        svgSize(svg),
        "The template with the amplified region shaded and the two primers as arrows on their own strands.",
        `PCR primers for ${r.region.start} to ${r.region.end}: forward ${r.forward.anneal}, reverse ${r.reverse.anneal}, amplicon ${r.ampliconLength} bp.`,
      ),
    ]);
  },
};

/** What the pane registers. NEB_OVERLAP_SOURCE is quoted in the Gibson result. */
export const CLONING_CALCS: CloningCalc[] = [gelCalc, goldenGateCalc, gibsonCalc, pcrCalc];

void NEB_OVERLAP_SOURCE;
