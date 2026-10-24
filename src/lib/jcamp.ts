// JCAMP-DX reader — opens a REAL measured spectrum so it can be overlaid on a
// predicted one. That overlay is the actual workflow: a prediction you cannot
// compare against data is a parlour trick.
//
// JCAMP-DX (IUPAC) is the format every FTIR, NMR and UV-Vis instrument exports.
// The file is a list of labelled data records (##KEY=value) followed by the points.
//
// THE HARD PART is ASDF compression, and it is where a naive reader silently
// corrupts data rather than failing:
//
//   SQZ  — a digit with its sign folded into the character. @ABCDEFGHI = +0..9,
//          abcdefghi = -1..-9. No delimiter needed, so "A2B3" is 12, 23.
//   DIF  — the value is a DIFFERENCE from the previous Y. %JKLMNOPQR = +0..9,
//          jklmnopqr = -1..-9. Read as absolute, every point after the first is
//          wrong, and the spectrum still LOOKS like a spectrum.
//   DUP  — repeat the previous TOKEN N times. STUVWXYZs = 1..9. After a DIF the
//          token is a DIFFERENCE, so a DUP keeps stepping (the DIFDUP form every
//          instrument uses for a flat baseline): "1 AJT" is 1, 2, 3 — not 1, 2, 2.
//
// A reader that ignores DIF produces a plausible, completely wrong trace. So the
// DIF y-check (the last Y of a line is repeated as the first ordinate of the next)
// is ENFORCED: it is the format's own built-in checksum and the only way to know
// the decode was right. A block that fails it is marked `corrupt` — it is still
// returned (so the viewer can say what went wrong) but it must never be overlaid
// or inserted. The y-check value also OCCUPIES its line's first abscissa, so the
// next ordinate sits one ΔX further along.
//
// v2.138.0 — what changed, each against an independent decoder (Python `jcamp`
// 1.3.2) over a 31-file corpus (y-check failures 253 → 0):
//   * DUP after DIF repeats the difference (1,083 of 1,976 points were wrong on
//     a real file, by up to 2.4 % of full scale);
//   * x no longer slips one sample after each y-check line;
//   * AFFN with exponents (JCAMP 5.01) is read when the block's declared NPOINTS
//     settles it, and REFUSED by name when it does not ("E" is also SQZ +5);
//   * peak tables read the DECLARED tuple — (XYW..XYW) is triples, not pairs;
//   * NTUPLES 1D NMR spectra return the real page; FID / nD / GC-MS NTUPLES are
//     refused by name. A one-point "spectrum" is never returned;
//   * `$$` comments are stripped from header values; `.OBSERVE NUCLEUS` and an
//     Hz axis make the kind NMR; a default block is chosen (a full trace beats a
//     4-point peak table) and the reason is stated.
//
// Pure parsing — no Office.js, no network.

export type JcampKind = "ir" | "nmr" | "uvvis" | "ms" | "raman" | "unknown";

/** The extra columns of a (XYW..) / (XYM..) / (XYA) peak table, parallel to `points`. */
export interface JcampPeakExtra {
  /** Peak width, in x units (factors applied). */
  w?: number;
  /** Multiplicity code as written (S, D, T, Q, M …). */
  m?: string;
  /** Assignment text as written. */
  a?: string;
}

export interface JcampSpectrum {
  title: string;
  /** DATA TYPE as written in the file, e.g. "INFRARED SPECTRUM". */
  dataType: string;
  kind: JcampKind;
  xUnits: string;
  yUnits: string;
  /** Points in file order. x is in xUnits, y in yUnits, factors already applied. */
  points: { x: number; y: number }[];
  /** Everything the file declared, for provenance (`$$` comments stripped). */
  meta: Record<string, string>;
  caveats: string[];
  /** "trace" for XYDATA / XYPOINTS / an NTUPLES page; "peaks" for a PEAK TABLE. */
  form?: "trace" | "peaks";
  /** 1-based position of this block in the file (LINK files hold several). */
  block?: number;
  /** NMR nucleus from `.OBSERVE NUCLEUS`, e.g. "1H", "13C", "19F". */
  nucleus?: string;
  /**
   * True when the file's own checks failed (DIF y-check, declared point count,
   * an unreadable character). The block is returned so the viewer can say what is
   * wrong, but it is NOT offered for overlay or insert.
   */
  corrupt?: boolean;
  /** One line saying why the block is corrupt, naming the first failing line. */
  corruptReason?: string;
  /** The W / M / A columns of a peak table, parallel to `points`. */
  peakExtras?: JcampPeakExtra[];
  /** For an NTUPLES block: which page was read and which were present but unused. */
  ntuples?: { type: string; usedPage: string; unusedPages: string[] };
}

/** A block the reader recognised and refused, by name. */
export interface JcampRefusal {
  block: number;
  title: string;
  reason: string;
}

export type JcampParse =
  | {
      ok: true;
      spectra: JcampSpectrum[];
      /** Blocks that were recognised and refused (FID, nD, ambiguous E-lines …). */
      refused: JcampRefusal[];
      /** Index into `spectra` of the block to show by default. */
      defaultIndex: number;
      /** Why that block, when the file holds more than one. */
      defaultReason: string;
    }
  | { ok: false; error: string };

/** Hard caps, set before any work: unbounded decode freezes Word. */
export const JCAMP_MAX_POINTS = 1 << 20;
export const JCAMP_MAX_PAGES = 8;

// --- ASDF character tables ---------------------------------------------------
const SQZ_POS = "@ABCDEFGHI"; // +0..+9
const SQZ_NEG = "abcdefghi"; //  -1..-9
const DIF_POS = "%JKLMNOPQR"; // +0..+9
const DIF_NEG = "jklmnopqr"; //  -1..-9
const DUP_CHARS = "STUVWXYZs"; //  1..9

type Token = { value: number; mode: "affn" | "dif" | "dup" };

const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/**
 * Tokenises one ASDF data line into numbers plus their mode.
 *
 * ASDF has no delimiters: a SQZ/DIF/DUP character BEGINS a new number and the
 * plain digits after it continue that number. So "A23" is 123, not 1 then 23.
 *
 * NO EXPONENT PARSING HERE. In ASDF, 'E' is the SQZ character for +5 and 'e'
 * for −5: treating "0E0" as scientific notation silently swallowed "E0" (the
 * ordinate 50). E-notation AFFN (JCAMP 5.01) is handled one level up, by
 * decoding a block BOTH ways and letting its declared NPOINTS decide.
 *
 * `bad` collects characters that are no part of ASDF; the caller treats any as a
 * decode failure rather than skipping them into a plausible trace.
 */
function tokenizeAsdf(line: string, bad: string[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    const c = line[i];

    if (c === " " || c === "\t" || c === ",") { i++; continue; }

    // A plain number (AFFN, or PAC where +/− is the delimiter).
    if (isDigit(c) || c === "+" || c === "-" || c === ".") {
      let j = i;
      if (line[j] === "+" || line[j] === "-") j++;
      while (j < n && (isDigit(line[j]) || line[j] === ".")) j++;
      const v = Number(line.slice(i, j));
      if (Number.isNaN(v) || j === i) {
        if (!bad.length) bad.push(line.slice(i, Math.max(j, i + 1)));
        return out;
      }
      out.push({ value: v, mode: "affn" });
      i = j;
      continue;
    }

    // SQZ / DIF / DUP: the character carries the leading digit and the sign; any
    // plain digits immediately after it extend the SAME number.
    let lead: number;
    let mode: Token["mode"];
    let neg = false;

    if (SQZ_POS.includes(c)) { lead = SQZ_POS.indexOf(c); mode = "affn"; }
    else if (SQZ_NEG.includes(c)) { lead = SQZ_NEG.indexOf(c) + 1; mode = "affn"; neg = true; }
    else if (DIF_POS.includes(c)) { lead = DIF_POS.indexOf(c); mode = "dif"; }
    else if (DIF_NEG.includes(c)) { lead = DIF_NEG.indexOf(c) + 1; mode = "dif"; neg = true; }
    else if (DUP_CHARS.includes(c)) { lead = DUP_CHARS.indexOf(c) + 1; mode = "dup"; }
    else {
      // Not ASDF. Skipping it would invent a trace from what is left, so the
      // line stops here and the block is flagged corrupt by the caller — which
      // also bounds a 16 MB line of junk to one character of work.
      bad.push(c);
      return out;
    }

    let digits = String(lead);
    i++;
    while (i < n && isDigit(line[i])) { digits += line[i]; i++; }
    const v = Number(digits) * (neg ? -1 : 1);
    out.push({ value: v, mode });
  }
  return out;
}

/** An AFFN token with an exponent, as JCAMP 5.01 allows: 1.0E+00, .5e-3. */
const EXP_TOKEN = /^[+-]?(\d+\.?\d*|\.\d+)[eE][+-]?\d+$/;
const PLAIN_TOKEN = /^[+-]?(\d+\.?\d*|\.\d+)$/;
/** Any DIF or DUP character: a block containing one is ASDF, never E-notation. */
const DIF_DUP_ANY = /[%J-Rj-rS-Zs]/;

/**
 * True when every token on the line is a plain number or an exponent number,
 * and at least one has an exponent — the only lines that can be read two ways.
 */
function isExponentCandidate(line: string): boolean {
  if (line.indexOf("E") < 0 && line.indexOf("e") < 0) return false;
  const toks = line.split(/[\s,]+/).filter(Boolean);
  if (!toks.length) return false;
  let any = false;
  for (const t of toks) {
    if (EXP_TOKEN.test(t)) any = true;
    else if (!PLAIN_TOKEN.test(t)) return false;
  }
  return any;
}

/** A ##KEY= label, normalised: JCAMP ignores case, spaces, dashes, slashes and underscores. */
function normKey(k: string): string {
  return k.toUpperCase().replace(/[\s\-/_]/g, "");
}

/** `.OBSERVE NUCLEUS` → "1H", "13C" … (the file writes "^13C"). */
function nucleusOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /\^?\s*(\d+)\s*([A-Za-z]{1,2})/.exec(raw);
  if (!m) return undefined;
  const sym = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  return `${m[1]}${sym}`;
}

function kindOf(dataType: string, xUnits: string, nucleus: string | undefined): JcampKind {
  const d = dataType.toUpperCase();
  if (d.includes("INFRARED")) return "ir";
  if (d.includes("NMR")) return "nmr";
  if (d.includes("UV") || d.includes("VISIBLE") || d.includes("ULTRAVIOLET")) return "uvvis";
  if (d.includes("MASS")) return "ms";
  if (d.includes("RAMAN")) return "raman";
  if (/\bFT-?IR\b/.test(d)) return "ir";
  // A file that names its observed nucleus is NMR.
  if (nucleus) return "nmr";
  // A declared technique this reader has no kind for (ION MOBILITY …) is not
  // guessed from its x axis.
  if (d.includes("MOBILITY")) return "unknown";
  // Fall back on the x axis when DATA TYPE is missing or vendor-specific.
  const x = xUnits.toUpperCase().trim();
  if (x.includes("1/CM") || x.includes("CM-1") || x.includes("CM^-1")) return "ir";
  if (x.includes("PPM")) return "nmr";
  // An Hz abscissa is an NMR frequency axis (1HQuinine.jdx has no DATA TYPE).
  if (x === "HZ" || x === "HERTZ") return "nmr";
  if (x.includes("NANOMETER") || /\bNM\b/.test(x)) return "uvvis";
  if (x.includes("M/Z")) return "ms";
  return "unknown";
}

/** Thousands separators for messages: 16384 → "16,384". */
const fmtInt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** A true minus for display. */
const fmtNum = (v: number): string => {
  const s = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(7)));
  return s.replace(/^-/, "−");
};
const clip = (s: string, n = 48): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Parses a JCAMP-DX file. Handles XYDATA (X++(Y..Y)) with AFFN/PAC/SQZ/DIF/DUP,
 * XYPOINTS, PEAK TABLES with their declared tuple, LINK files (split on ##TITLE)
 * and 1D NMR NTUPLES (the real page).
 */
export function parseJcamp(text: string): JcampParse {
  if (!text || !/##\s*TITLE\s*=/i.test(text)) {
    return { ok: false, error: "Not a JCAMP-DX file — no ##TITLE= record found." };
  }
  const lines = text.split(/\r?\n|\r/);

  // Split into blocks at each ##TITLE=, so a LINK file with several spectra works.
  const blocks: { start: number; lines: string[] }[] = [];
  let cur: { start: number; lines: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*##\s*TITLE\s*=/i.test(raw)) {
      cur = { start: i, lines: [raw] };
      blocks.push(cur);
      continue;
    }
    if (cur) cur.lines.push(raw);
  }

  const spectra: JcampSpectrum[] = [];
  const refused: JcampRefusal[] = [];
  // ONE numbering for every block the user is told about: the n-th DATA block
  // in the file, counting refused blocks and spectra alike, but not a LINK
  // parent or an empty block (nothing is said about those). The picker, the
  // default-block reason and the refusal warnings all use it, so "block 2"
  // names one block on one screen.
  let ordinal = 0;
  blocks.forEach((b) => {
    const r = parseBlock(b.lines, b.start);
    if (!r) return;
    if ("refusal" in r) {
      refused.push({ block: ++ordinal, title: r.title, reason: r.refusal });
      return;
    }
    if (!r.points.length) return;
    r.block = ++ordinal;
    spectra.push(r);
  });
  if (!spectra.length) {
    if (refused.length) {
      return { ok: false, error: refused.map((f) => `${f.title ? `"${clip(f.title)}": ` : ""}${f.reason}`).join(" ") };
    }
    return { ok: false, error: "No readable data points found in the file." };
  }
  const choice = chooseDefaultBlock(spectra);
  return { ok: true, spectra, refused, defaultIndex: choice.index, defaultReason: choice.reason };
}

const SUPPORTED_KINDS: JcampKind[] = ["ir", "nmr", "uvvis", "ms", "raman"];

/**
 * The block to show by default: the first block of a supported kind with at
 * least 32 points that passed its own checks. A full trace beats a peak table —
 * ethanol_nmr.jdx (ACD) puts a 4-point PPM peak table first and the 16,384-point
 * spectrum second, and drawing the peak table as a line was the old behaviour.
 */
export function chooseDefaultBlock(spectra: JcampSpectrum[]): { index: number; reason: string } {
  if (!spectra.length) return { index: -1, reason: "" };
  const describe = (s: JcampSpectrum): string =>
    `block ${s.block ?? spectra.indexOf(s) + 1} ("${clip(s.title, 40)}", ${s.kind === "unknown" ? s.dataType || "unknown kind" : s.kind.toUpperCase()}, ${fmtInt(s.points.length)} points)`;
  let idx = spectra.findIndex((s) => !s.corrupt && SUPPORTED_KINDS.includes(s.kind) && s.points.length >= 32);
  if (idx < 0) idx = spectra.findIndex((s) => !s.corrupt && SUPPORTED_KINDS.includes(s.kind));
  if (idx < 0) idx = spectra.findIndex((s) => !s.corrupt);
  if (idx < 0) idx = 0;
  if (spectra.length === 1) return { index: idx, reason: "" };
  const chosen = spectra[idx];
  const skipped = spectra.slice(0, idx);
  const why = skipped.length
    ? ` Earlier ${skipped.length === 1 ? "block" : "blocks"} — ${skipped.map(describe).join("; ")} — ${
        skipped.every((s) => s.corrupt) ? "failed the file's own checks" : "held fewer points (a peak table or a stub), so the full trace is shown instead"
      }.`
    : "";
  return {
    index: idx,
    reason: `This file holds ${spectra.length} blocks; showing ${describe(chosen)}.${why}`,
  };
}

type BlockResult = JcampSpectrum | { refusal: string; title: string } | null;

/** Header records up to the first data record: `$$` comments stripped, keys normalised. */
function readHeaderValue(raw: string): string {
  return raw.replace(/\$\$.*$/, "").trim();
}

function parseBlock(lines: string[], fileStart: number): BlockResult {
  const meta: Record<string, string> = {};
  let dataStart = -1;
  let dataKey = "";

  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*##\s*([^=]+)=(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = normKey(m[1]);
    const val = readHeaderValue(m[2]);
    if (key === "XYDATA" || key === "XYPOINTS" || key === "PEAKTABLE" || key === "DATATABLE" || key === "NTUPLES") {
      dataKey = key;
      meta[key] = val;
      dataStart = i + 1;
      break;
    }
    meta[key] = val;
  }
  if (dataStart < 0) return null;

  const title = meta["TITLE"] || "(untitled)";
  if (dataKey === "NTUPLES") return parseNtuples(lines, dataStart, fileStart, meta, title);

  const num = (k: string, dflt: number): number => {
    const v = Number(meta[k]);
    return meta[k] !== undefined && meta[k] !== "" && Number.isFinite(v) ? v : dflt;
  };
  const xFactor = num("XFACTOR", 1);
  const yFactor = num("YFACTOR", 1);
  const firstX = num("FIRSTX", NaN);
  const lastX = num("LASTX", NaN);
  const nPoints = num("NPOINTS", NaN);

  // Collect the data lines (stop at ##END= or the next record).
  const data: DataLine[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*##/.test(l)) break;
    const t = l.replace(/\$\$.*$/, ""); // strip trailing comments
    if (t.trim()) data.push({ text: t, lineNo: fileStart + i + 1 });
  }

  const nucleus = nucleusOf(meta[".OBSERVENUCLEUS"]);
  const dataType = meta["DATATYPE"] ?? "";
  const xUnits = meta["XUNITS"] ?? "";
  const yUnits = meta["YUNITS"] ?? "";
  const declared = meta[dataKey] ?? "";

  const caveats: string[] = [];
  let points: { x: number; y: number }[] = [];
  let peakExtras: JcampPeakExtra[] | undefined;
  let form: "trace" | "peaks" = dataKey === "PEAKTABLE" ? "peaks" : "trace";
  let corruptReason: string | undefined;

  const xyForm = /X\s*\+\+\s*\(\s*([A-Z])\s*\.\.\s*\1\s*\)/i.exec(declared);
  if ((dataKey === "XYDATA" || dataKey === "DATATABLE") && xyForm) {
    const dec = decodeXyData(data, { xFactor, yFactor, firstX, lastX, nPoints });
    if ("refusal" in dec) return { refusal: dec.refusal, title };
    points = dec.points;
    caveats.push(...dec.caveats);
    corruptReason = dec.corruptReason;
  } else {
    const tuple = parseTupleForm(declared);
    if (!tuple) {
      return {
        refusal: `The ${dataKey === "PEAKTABLE" ? "peak table" : dataKey === "XYPOINTS" ? "XYPOINTS record" : "data table"} declares "${clip(declared, 30)}", a form this reader does not read (supported: (X++(Y..Y)), (XY..XY), (XYW..XYW), (XYM..XYM), (XYA)).`,
        title,
      };
    }
    const r = readTuples(data, tuple, xFactor, yFactor);
    if ("refusal" in r) return { refusal: r.refusal, title };
    points = r.points;
    if (tuple !== "XY") peakExtras = r.extras;
    if (dataKey === "XYPOINTS") form = "trace";
    if (Number.isFinite(nPoints) && points.length !== nPoints) {
      caveats.push(
        `The file declares ${nPoints} points but ${points.length} decoded. ` +
          "The compression may not have been read correctly — treat this trace with suspicion."
      );
      corruptReason = corruptReason ?? `the file declares ${fmtInt(nPoints)} points but ${fmtInt(points.length)} were read`;
    }
  }

  // A one-point trace is not a spectrum. (A one-line peak table can be.)
  if (form === "trace" && points.length === 1) {
    return { refusal: "Only one data point was decoded — that is not a spectrum, and it is not shown as one.", title };
  }

  return finish({
    title,
    dataType,
    kind: kindOf(dataType, xUnits, nucleus),
    xUnits,
    yUnits,
    points,
    meta,
    caveats,
    form,
    nucleus,
    corruptReason,
    peakExtras,
  });
}

function finish(s: {
  title: string;
  dataType: string;
  kind: JcampKind;
  xUnits: string;
  yUnits: string;
  points: { x: number; y: number }[];
  meta: Record<string, string>;
  caveats: string[];
  form: "trace" | "peaks";
  nucleus?: string;
  corruptReason?: string;
  peakExtras?: JcampPeakExtra[];
  ntuples?: JcampSpectrum["ntuples"];
}): JcampSpectrum {
  const caveats = s.caveats.slice();
  caveats.push(
    "Read from the file as written. JCAMP-DX carries no guarantee that the instrument's " +
      "baseline, phasing or referencing were correct — this is the vendor's data, not a validation of it."
  );
  if (s.yUnits.toUpperCase().includes("TRANSMITTANCE")) {
    caveats.push("Y is TRANSMITTANCE: peaks point DOWN. A predicted absorbance spectrum overlaid on this will look inverted unless one is converted.");
  }
  const out: JcampSpectrum = {
    title: s.title,
    dataType: s.dataType,
    kind: s.kind,
    xUnits: s.xUnits,
    yUnits: s.yUnits,
    points: s.points,
    meta: s.meta,
    caveats,
    form: s.form,
  };
  if (s.nucleus) out.nucleus = s.nucleus;
  if (s.peakExtras) out.peakExtras = s.peakExtras;
  if (s.ntuples) out.ntuples = s.ntuples;
  if (s.corruptReason) {
    out.corrupt = true;
    out.corruptReason = s.corruptReason;
    caveats.unshift("This block failed the file's own checks (details below). It is not offered for overlay or insert.");
  }
  return out;
}

// --- XYDATA (X++(Y..Y)) --------------------------------------------------------

interface DataLine {
  text: string;
  /** 1-based line number in the whole file, for messages. */
  lineNo: number;
}

interface XyParams {
  xFactor: number;
  yFactor: number;
  firstX: number;
  lastX: number;
  nPoints: number;
}

type XyDecode =
  | { points: { x: number; y: number }[]; caveats: string[]; corruptReason?: string }
  | { refusal: string };

/**
 * Decodes an (X++(Y..Y)) table. When the block carries E-notation lines and no
 * DIF/DUP character, it is decoded both ways (exponent AFFN and pure ASDF); the
 * declared NPOINTS picks the reading, and when it cannot, the block is refused.
 */
function decodeXyData(data: DataLine[], p: XyParams): XyDecode {
  if (Number.isFinite(p.nPoints) && p.nPoints > JCAMP_MAX_POINTS) {
    return { refusal: `The file declares ${fmtInt(p.nPoints)} points; this reader stops at ${fmtInt(JCAMP_MAX_POINTS)} per block.` };
  }
  const anyDifDup = data.some((d) => DIF_DUP_ANY.test(d.text));
  const candidates = anyDifDup ? [] : data.filter((d) => isExponentCandidate(d.text));
  if (!candidates.length) return decodeSpaced(data, p, false);

  const asExp = decodeSpaced(data, p, true);
  const asAsdf = decodeSpaced(data, p, false);
  const same =
    !("refusal" in asExp) &&
    !("refusal" in asAsdf) &&
    asExp.points.length === asAsdf.points.length &&
    asExp.points.every((q, i) => q.x === asAsdf.points[i].x && q.y === asAsdf.points[i].y);
  if (same) return asAsdf;
  const fits = (r: XyDecode): boolean => !("refusal" in r) && Number.isFinite(p.nPoints) && r.points.length === p.nPoints;
  const expFits = fits(asExp);
  const asdfFits = fits(asAsdf);
  const where = `line ${candidates[0].lineNo}: "${clip(candidates[0].text.trim(), 40)}"`;
  if (expFits && !asdfFits && !("refusal" in asExp)) {
    return {
      ...asExp,
      caveats: [
        `${candidates.length} data ${candidates.length === 1 ? "line carries" : "lines carry"} exponents (JCAMP 5.01 AFFN, first at ${where}); read as exponents because that reading gives the declared ${fmtInt(p.nPoints)} points.`,
        ...asExp.caveats,
      ],
    };
  }
  if (asdfFits && !expFits) return asAsdf;
  return {
    refusal:
      `Ambiguous "E" at ${where}: it is either an exponent (JCAMP 5.01 AFFN) or the ASDF character SQZ +5, and the declared NPOINTS ` +
      `${Number.isFinite(p.nPoints) ? `(${fmtInt(p.nPoints)}) fits ${expFits ? "both readings" : "neither reading"}` : "is missing"}, so neither reading is trusted.`,
  };
}

/**
 * NPOINTS missing but FIRSTX and LASTX given: ΔX is (LASTX − FIRSTX)/(N − 1)
 * over the N ordinates actually decoded, and each line's own X is then checked
 * against it (the X-check marks the block corrupt when they disagree). Without
 * this every ordinate of a line stacked on the line's X — "1,1,1,1,5,5,5,5" —
 * under a caveat claiming the spacing came from the data lines.
 */
function decodeSpaced(data: DataLine[], p: XyParams, exponents: boolean): XyDecode {
  if (Number.isFinite(p.nPoints) || !Number.isFinite(p.firstX) || !Number.isFinite(p.lastX)) {
    return decodeOnce(data, p, exponents);
  }
  const count = decodeOnce(data, p, exponents, false);
  if ("refusal" in count || count.points.length < 2) return decodeOnce(data, p, exponents);
  const n = count.points.length;
  const r = decodeOnce(data, { ...p, nPoints: n }, exponents);
  if ("refusal" in r) return r;
  return {
    ...r,
    caveats: [
      `NPOINTS is missing: ΔX was derived from FIRSTX, LASTX and the ${fmtInt(n)} ordinates decoded, and each line's own X was checked against it.`,
      ...r.caveats,
    ],
  };
}

function decodeOnce(data: DataLine[], p: XyParams, exponents: boolean, requireSpacing = true): XyDecode {
  const { xFactor, yFactor, firstX, lastX, nPoints } = p;
  const caveats: string[] = [];
  // deltaX comes from the header, NOT from the data.
  const deltaX =
    Number.isFinite(firstX) && Number.isFinite(lastX) && Number.isFinite(nPoints) && nPoints > 1
      ? (lastX - firstX) / (nPoints - 1)
      : NaN;
  if (!Number.isFinite(deltaX)) {
    caveats.push("FIRSTX/LASTX/NPOINTS missing or inconsistent — each line's own X was used as its abscissa, which is less reliable.");
  }
  const step = Number.isFinite(deltaX) ? deltaX : 0;
  // THE ABSCISSA OF ORDINATE i IS FIRSTX + i·ΔX. The X at the start of each line
  // is a checkpoint, not the source of truth: deriving x from it is how a y-check
  // line slipped every later x by one sample. When the header cannot give ΔX the
  // line X is used (and the caveat above says so).
  const indexed = Number.isFinite(deltaX) && Number.isFinite(firstX);
  const xAt = (i: number): number => firstX + i * deltaX;
  // The X-check: how far a line's own X sits from the abscissa its first
  // ordinate occupies. Rounding of X in XFACTOR units is allowed for.
  const xTol = indexed ? 0.5 * Math.abs(deltaX) + 0.5 * Math.abs(xFactor) : Infinity;
  let xSlips = 0;
  let xWorst = 0;
  let firstSlip = "";

  const points: { x: number; y: number }[] = [];
  // `expectedY` carries the DIF y-check across lines: when a line used DIF, the
  // next line restates that final ordinate as its first value.
  let expectedY: number | null = null;
  let checkFailures = 0;
  let firstFailure = "";
  const anomalies: string[] = [];
  let anomalyAt = "";

  const noteAnomaly = (d: DataLine, what: string): void => {
    anomalies.push(what);
    if (!anomalyAt) anomalyAt = `line ${d.lineNo}: "${clip(d.text.trim(), 40)}"`;
  };

  for (const d of data) {
    const bad: string[] = [];
    const toks: Token[] =
      exponents && isExponentCandidate(d.text)
        ? d.text.split(/[\s,]+/).filter(Boolean).map((t) => ({ value: Number(t), mode: "affn" as const }))
        : tokenizeAsdf(d.text, bad);
    if (bad.length) noteAnomaly(d, `unreadable "${bad[0]}"`);
    if (!toks.length) continue;
    if (toks[0].mode !== "affn") {
      noteAnomaly(d, "a line that does not open with its X value");
      continue;
    }
    const xRaw = toks[0].value;
    let x = xRaw * xFactor;
    let y: number | null = null;
    let emitted = 0; // abscissae OCCUPIED on this line — drives the x advance
    let lineUsedDif = false;
    // The previous Y token, for DUP: a DUP repeats the TOKEN, so after a DIF it
    // repeats the difference.
    let lastTok: Token | null = null;

    for (let t = 1; t < toks.length; t++) {
      const tk = toks[t];

      if (tk.mode === "dup") {
        if (y === null || lastTok === null || lastTok.mode === "dup") {
          noteAnomaly(d, y === null ? "a DUP with nothing to repeat" : "a DUP following a DUP");
          continue;
        }
        const extra = tk.value - 1;
        // The cap is checked BEFORE the loop: "s999999999" must not run.
        if (!Number.isFinite(extra) || extra < 0 || points.length + extra > JCAMP_MAX_POINTS) {
          return { refusal: `A DUP count of ${fmtInt(tk.value)} at line ${d.lineNo} would exceed ${fmtInt(JCAMP_MAX_POINTS)} points in one block; the file is refused rather than truncated.` };
        }
        for (let r = 0; r < extra; r++) {
          if (lastTok.mode === "dif") y = y + lastTok.value;
          if (emitted > 0) x += step;
          points.push({ x: indexed ? xAt(points.length) : x, y: y * yFactor });
          emitted++;
        }
        lastTok = tk;
        continue;
      }

      // The new ordinate: absolute for AFFN/SQZ, a delta for DIF.
      let next: number;
      if (tk.mode === "dif") {
        if (y === null) {
          noteAnomaly(d, "a DIF with nothing to difference from");
          continue;
        }
        lineUsedDif = true;
        next = y + tk.value;
      } else {
        next = tk.value;
      }

      // THE FORMAT'S OWN CHECKSUM: the first ordinate of a line that FOLLOWS a
      // DIF line restates the previous line's last ordinate. It is not a new
      // point, but it OCCUPIES this line's first abscissa — so the next ordinate
      // lands at X + ΔX. (Leaving `emitted` at 0 here slipped x by one sample
      // after every check line.)
      if (t === 1 && indexed) {
        const at = expectedY !== null ? points.length - 1 : points.length;
        const err = Math.abs(xRaw * xFactor - xAt(Math.max(0, at)));
        if (err > xTol) {
          xSlips++;
          if (err > xWorst) xWorst = err;
          if (!firstSlip) firstSlip = `line ${d.lineNo} gives X = ${fmtNum(xRaw * xFactor)} where ordinate ${fmtInt(at + 1)} sits at ${fmtNum(xAt(at))}`;
        }
      }

      if (t === 1 && expectedY !== null) {
        if (Math.abs(next - expectedY) > 1e-9 * Math.max(1, Math.abs(expectedY))) {
          checkFailures++;
          if (!firstFailure) {
            firstFailure = `first at line ${d.lineNo} (x = ${fmtNum(xRaw * xFactor)}): the file restates ${fmtNum(next)} but the previous line decoded to ${fmtNum(expectedY)} — "${clip(d.text.trim(), 40)}"`;
          }
        }
        expectedY = null;
        y = next;
        emitted = 1;
        lastTok = tk;
        continue;
      }

      if (emitted > 0) x += step;
      y = next;
      if (points.length >= JCAMP_MAX_POINTS) {
        return { refusal: `More than ${fmtInt(JCAMP_MAX_POINTS)} points in one block (line ${d.lineNo}); the file is refused rather than truncated.` };
      }
      points.push({ x: indexed ? xAt(points.length) : x, y: y * yFactor });
      emitted++;
      lastTok = tk;
    }

    // Only a DIF-encoded line hands a check value to the next one.
    expectedY = lineUsedDif ? y : null;
  }

  let corruptReason: string | undefined;
  if (checkFailures) {
    // One summary line, not one per failure: 34 lines of caveat bury the point.
    caveats.push(
      `DIF y-check failed ${checkFailures === 1 ? "once" : `${checkFailures} times`}; ${firstFailure}. ` +
        "The decode does not match the file's own checksum, so the trace is not trustworthy."
    );
    corruptReason = `DIF y-check failed ${checkFailures === 1 ? "once" : `${checkFailures} times`}, ${firstFailure.split(":")[0]}`;
  }
  if (anomalies.length) {
    caveats.push(`${anomalies.length} data ${anomalies.length === 1 ? "token" : "tokens"} could not be decoded (${anomalies[0]}, first at ${anomalyAt}).`);
    corruptReason = corruptReason ?? `${anomalies[0]} at ${anomalyAt}`;
  }
  if (Number.isFinite(nPoints) && points.length !== nPoints) {
    caveats.push(
      `The file declares ${nPoints} points but ${points.length} decoded. ` +
        "The compression may not have been read correctly — treat this trace with suspicion."
    );
    corruptReason = corruptReason ?? `the file declares ${fmtInt(nPoints)} points but ${fmtInt(points.length)} decoded`;
  }
  if (xSlips) {
    // A line X more than a sample and a half from where its ordinate sits means
    // a lost or invented ordinate — a decode failure. Less than that is a file
    // whose line X values are loose; x comes from FIRSTX + i·ΔX either way.
    const serious = xWorst > 1.5 * Math.abs(deltaX) + 0.5 * Math.abs(xFactor);
    caveats.push(
      `X-check: ${xSlips} ${xSlips === 1 ? "line's" : "lines'"} own X ${xSlips === 1 ? "does" : "do"} not match the abscissa of ${xSlips === 1 ? "its" : "their"} first ordinate (first: ${firstSlip}). ` +
        "Abscissae are taken from FIRSTX + i·ΔX."
    );
    if (serious) corruptReason = corruptReason ?? `X-check failed: ${firstSlip}`;
  }
  // The abscissae must ADVANCE. Without a usable ΔX, every ordinate after a
  // line's first had no x of its own and stacked on the line's X; FIRSTX = LASTX
  // gives ΔX = 0. Either is a trace that is not a spectrum — refused by name.
  if (requireSpacing && points.length > 1) {
    const dir = Math.sign(points[1].x - points[0].x);
    let monotonic = dir !== 0;
    for (let i = 2; monotonic && i < points.length; i++) if (Math.sign(points[i].x - points[i - 1].x) !== dir) monotonic = false;
    if (!monotonic) {
      return {
        refusal: `The abscissae do not advance (x = ${fmtNum(points[0].x)}, ${fmtNum(points[1].x)}, …): the header gives no usable spacing (FIRSTX/LASTX/NPOINTS), so the ordinates on a line have no x of their own. Refused rather than stacked.`,
      };
    }
  }
  return { points, caveats, corruptReason };
}

// --- XYPOINTS / PEAK TABLE: the declared tuple -----------------------------------

type TupleForm = "XY" | "XYW" | "XYM" | "XYA";

/** "(XY..XY)" → "XY", "(XYW..XYW)" → "XYW", "(XYA)" → "XYA"; anything else → null. */
function parseTupleForm(declared: string): TupleForm | null {
  const m = /^\(\s*([A-Za-z]+)\s*(?:\.\.\s*([A-Za-z]+)\s*)?\)/.exec(declared.trim());
  if (!m) return null;
  const v = m[1].toUpperCase();
  if (m[2] && m[2].toUpperCase() !== v) return null;
  return v === "XY" || v === "XYW" || v === "XYM" || v === "XYA" ? v : null;
}

function readTuples(
  data: DataLine[],
  form: TupleForm,
  xFactor: number,
  yFactor: number
): { points: { x: number; y: number }[]; extras: JcampPeakExtra[] } | { refusal: string } {
  const n = form.length;
  const points: { x: number; y: number }[] = [];
  const extras: JcampPeakExtra[] = [];
  for (const d of data) {
    const line = d.text.trim();
    let groups: string[][];
    if (line.includes("(")) {
      // Parenthesised tuples keep empty fields: (1.24, 1.00, ,<5>).
      groups = [];
      const re = /\(([^)]*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) groups.push(m[1].split(",").map((s) => s.trim()));
    } else {
      const fields = line.split(/[\s,;]+/).filter(Boolean);
      if (fields.length % n !== 0) {
        return {
          refusal: `Line ${d.lineNo} of the (${form}..${form}) table holds ${fields.length} values, not a whole number of ${n}-value tuples: "${clip(line, 40)}".`,
        };
      }
      groups = [];
      for (let k = 0; k < fields.length; k += n) groups.push(fields.slice(k, k + n));
    }
    for (const g of groups) {
      if (g.length !== n) {
        return { refusal: `Line ${d.lineNo}: a tuple holds ${g.length} values where (${form}) declares ${n}: "${clip(line, 40)}".` };
      }
      const x = Number(g[0]);
      const y = Number(g[1]);
      if (g[0] === "" || g[1] === "" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return { refusal: `Line ${d.lineNo}: "${clip(line, 40)}" has a non-numeric X or Y.` };
      }
      points.push({ x: x * xFactor, y: y * yFactor });
      const e: JcampPeakExtra = {};
      if (form === "XYW") {
        const w = Number(g[2]);
        if (g[2] === "" || !Number.isFinite(w)) return { refusal: `Line ${d.lineNo}: the width W is not a number in "${clip(line, 40)}".` };
        e.w = w * Math.abs(xFactor);
      } else if (form === "XYM") {
        if (g[2]) e.m = g[2];
      } else if (form === "XYA") {
        if (g[2]) e.a = g[2].replace(/^<|>$/g, "");
      }
      extras.push(e);
      if (points.length > JCAMP_MAX_POINTS) {
        return { refusal: `More than ${fmtInt(JCAMP_MAX_POINTS)} peaks in one block; the file is refused rather than truncated.` };
      }
    }
  }
  return { points, extras };
}

// --- NTUPLES --------------------------------------------------------------------

/**
 * A 1D NMR NTUPLES block: the variable list, then one ##PAGE= per variable
 * (real, imaginary). Only the REAL page is a spectrum; the imaginary page is
 * reported and not used. FIDs, nD spectra and GC-MS runs are refused by name:
 * reading any of them as an XY trace is how a (0, 0) "spectrum" came out.
 */
function parseNtuples(lines: string[], start: number, fileStart: number, meta: Record<string, string>, title: string): BlockResult {
  const type = (meta["NTUPLES"] || "").trim();
  const T = type.toUpperCase();
  if (/FID/.test(T) || /FID/.test((meta["DATATYPE"] || "").toUpperCase())) {
    return { refusal: "NMR FID — needs Fourier transform and phasing; export the processed spectrum.", title };
  }
  if (/MASS/.test(T)) {
    return { refusal: "GC-MS / LC-MS NTUPLES — the file holds a series of scans; export one spectrum.", title };
  }
  if (/\b[2-9n]D\b/i.test(T)) {
    return { refusal: `${type} — a multi-dimensional NMR file; only 1D spectra are read.`, title };
  }
  if (!/NMR\s*SPECTRUM/.test(T)) {
    return { refusal: `NTUPLES of type "${clip(type, 30)}" — only 1D NMR SPECTRUM NTUPLES are read.`, title };
  }

  // The variable list (before the first ##PAGE=), then each page.
  const attrs: Record<string, string[]> = {};
  type Page = { label: string; table: string; meta: Record<string, string>; data: DataLine[] };
  const pages: Page[] = [];
  let page: Page | null = null;
  let inData = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    const m = /^\s*##\s*([^=]+)=(.*)$/.exec(l);
    if (m) {
      const key = normKey(m[1]);
      const val = readHeaderValue(m[2]);
      if (key === "ENDNTUPLES" || key === "END") break;
      if (key === "PAGE") {
        if (pages.length >= JCAMP_MAX_PAGES) {
          return { refusal: `More than ${JCAMP_MAX_PAGES} NTUPLES pages — refused rather than read in part.`, title };
        }
        page = { label: val, table: "", meta: {}, data: [] };
        pages.push(page);
        inData = false;
        continue;
      }
      if (page) {
        if (key === "DATATABLE") {
          page.table = val;
          inData = true;
        } else {
          page.meta[key] = val;
          inData = false;
        }
      } else {
        attrs[key] = val.split(",").map((s) => s.trim());
      }
      continue;
    }
    if (page && inData) {
      const t = l.replace(/\$\$.*$/, "");
      if (t.trim()) page.data.push({ text: t, lineNo: fileStart + i + 1 });
    }
  }

  const symbols = (attrs["SYMBOL"] || []).map((s) => s.toUpperCase());
  const names = (attrs["VARNAME"] || []).map((s) => s.toUpperCase());
  const types = (attrs["VARTYPE"] || []).map((s) => s.toUpperCase());
  const col = (k: string, i: number): string | undefined => (attrs[k] || [])[i];
  const colNum = (k: string, i: number): number => {
    const s = col(k, i);
    const v = Number(s);
    return s !== undefined && s !== "" && Number.isFinite(v) ? v : NaN;
  };

  if (types.filter((t) => t === "INDEPENDENT").length > 1) {
    return { refusal: `${type} with ${types.filter((t) => t === "INDEPENDENT").length} independent variables — a multi-dimensional file; only 1D spectra are read.`, title };
  }
  const xi = symbols.indexOf("X") >= 0 ? symbols.indexOf("X") : types.indexOf("INDEPENDENT");
  if (xi < 0) return { refusal: "NTUPLES: no independent (X) variable is declared, so the abscissa cannot be read.", title };

  // The REAL page: its DATA TABLE names a symbol whose variable is the real part.
  const pageSymbol = (p: Page): string | null => {
    const m = /X\s*\+\+\s*\(\s*([A-Z])\s*\.\.\s*\1\s*\)/i.exec(p.table);
    return m ? m[1].toUpperCase() : null;
  };
  const isReal = (p: Page): boolean => {
    const s = pageSymbol(p);
    if (!s) return false;
    const i = symbols.indexOf(s);
    return i >= 0 && (/REAL/.test(names[i] || "") || (s === "R" && !/IMAG/.test(names[i] || "")));
  };
  const realPages = pages.filter(isReal);
  if (realPages.length !== 1) {
    return {
      refusal: `NTUPLES: ${realPages.length ? `${realPages.length} pages claim to be the real part` : "no page can be identified as the real spectrum"} (${pages.length} ${pages.length === 1 ? "page" : "pages"} present); nothing is shown rather than a guess.`,
      title,
    };
  }
  const real = realPages[0];
  const yi = symbols.indexOf(pageSymbol(real)!);
  const pageNum = (k: string): number => {
    const v = Number(real.meta[k]);
    return real.meta[k] !== undefined && real.meta[k] !== "" && Number.isFinite(v) ? v : NaN;
  };
  const nPoints = Number.isFinite(pageNum("NPOINTS")) ? pageNum("NPOINTS") : colNum("VARDIM", yi);
  const firstX = colNum("FIRST", xi);
  const lastX = colNum("LAST", xi);
  const xFactor = Number.isFinite(colNum("FACTOR", xi)) ? colNum("FACTOR", xi) : 1;
  const yFactor = Number.isFinite(colNum("FACTOR", yi)) ? colNum("FACTOR", yi) : 1;

  const dec = decodeXyData(real.data, { xFactor, yFactor, firstX, lastX, nPoints });
  if ("refusal" in dec) return { refusal: dec.refusal, title };
  const caveats = dec.caveats.slice();
  let corruptReason = dec.corruptReason;

  // The header's own FIRST value for the real column is a second checksum.
  const firstY = colNum("FIRST", yi);
  if (dec.points.length && Number.isFinite(firstY)) {
    const got = dec.points[0].y;
    if (Math.abs(got - firstY) > 1e-3 * Math.max(1, Math.abs(firstY)) + Math.abs(yFactor)) {
      caveats.push(`The first decoded ordinate (${fmtNum(got)}) does not match the header's FIRST value (${fmtNum(firstY)}).`);
      corruptReason = corruptReason ?? "the first ordinate does not match the header's FIRST value";
    }
  }
  if (dec.points.length === 1) {
    return { refusal: "Only one data point was decoded from the NTUPLES real page — that is not a spectrum.", title };
  }

  const unused = pages.filter((p) => p !== real).map((p) => {
    const s = pageSymbol(p);
    const i = s ? symbols.indexOf(s) : -1;
    return `${p.label}${i >= 0 && names[i] ? ` (${names[i]})` : ""}`;
  });
  if (unused.length) {
    caveats.push(`NTUPLES: the real page (${real.label}) is shown; ${unused.join(", ")} ${unused.length === 1 ? "is" : "are"} present and not used.`);
  }

  const nucleus = nucleusOf(meta[".OBSERVENUCLEUS"]);
  const xUnits = col("UNITS", xi) || "";
  const yUnits = col("UNITS", yi) || "";
  return finish({
    title,
    dataType: meta["DATATYPE"] || type,
    kind: "nmr",
    xUnits,
    yUnits,
    points: dec.points,
    meta,
    caveats,
    form: "trace",
    nucleus,
    corruptReason,
    ntuples: { type, usedPage: `${real.label}${names[yi] ? ` (${names[yi]})` : ""}`, unusedPages: unused },
  });
}

const SUP_DIGIT: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

/**
 * One value of a measured trace as a document table cell (fix2-plat): six significant figures (an instrument's
 * ordinate carries no more; the raw doubles read 0.30000000000000004), a true minus, ×10ⁿ instead of e-notation.
 */
export function traceCell(v: number, sig = 6): string {
  if (!Number.isFinite(v)) return "";
  const s = String(Number(v.toPrecision(sig)));
  const m = /^(-?\d+(?:\.\d+)?)e([+-])(\d+)$/.exec(s);
  const t = m ? `${m[1]}×10${[...((m[2] === "-" ? "-" : "") + m[3])].map((c) => SUP_DIGIT[c]).join("")}` : s;
  return t.replace(/^-/, "−");
}

/**
 * A column of trace values as cells: six significant figures, more (up to 12) only where six would print two
 * different adjacent values the same (a fine x grid far from zero) — a table with repeated abscissae is wrong.
 */
export function traceColumn(values: readonly number[]): string[] {
  for (let sig = 6; sig <= 12; sig++) {
    const cells = values.map((v) => traceCell(v, sig));
    let merged = false;
    for (let i = 1; i < values.length && !merged; i++) merged = cells[i] === cells[i - 1] && values[i] !== values[i - 1];
    if (!merged || sig === 12) return cells;
  }
  return values.map((v) => traceCell(v, 12));
}
