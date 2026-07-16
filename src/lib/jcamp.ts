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
//   DUP  — repeat the previous value N times. STUVWXYZs = 1..9.
//
// A reader that ignores DIF produces a plausible, completely wrong trace. So the
// DIF y-check (the last Y of a line is repeated as the first ordinate of the next)
// is verified, not skipped — it is the format's own built-in checksum and the only
// way to know the decode was right.
//
// Pure parsing — no Office.js, no network.

export type JcampKind = "ir" | "nmr" | "uvvis" | "ms" | "raman" | "unknown";

export interface JcampSpectrum {
  title: string;
  /** DATA TYPE as written in the file, e.g. "INFRARED SPECTRUM". */
  dataType: string;
  kind: JcampKind;
  xUnits: string;
  yUnits: string;
  /** Points in file order. x is in xUnits, y in yUnits, factors already applied. */
  points: { x: number; y: number }[];
  /** Everything the file declared, for provenance. */
  meta: Record<string, string>;
  caveats: string[];
}

export type JcampParse = { ok: true; spectra: JcampSpectrum[] } | { ok: false; error: string };

// --- ASDF character tables ---------------------------------------------------
const SQZ_POS = "@ABCDEFGHI"; // +0..+9
const SQZ_NEG = "abcdefghi"; //  -1..-9
const DIF_POS = "%JKLMNOPQR"; // +0..+9
const DIF_NEG = "jklmnopqr"; //  -1..-9
const DUP_CHARS = "STUVWXYZs"; //  1..9

type Token = { value: number; mode: "affn" | "dif" | "dup" };

/**
 * Tokenises one ASDF data line into numbers plus their mode.
 *
 * ASDF has no delimiters: a SQZ/DIF/DUP character BEGINS a new number and the
 * plain digits after it continue that number. So "A23" is 123, not 1 then 23.
 */
function tokenizeAsdf(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    const c = line[i];

    if (c === " " || c === "\t" || c === ",") { i++; continue; }

    // A plain number: optional sign, digits, optional decimal point.
    //
    // NO EXPONENT PARSING. It looks like an omission and is the opposite: in ASDF,
    // 'E' is the SQZ character for +5. Treating "0E0" as scientific notation
    // silently swallowed "E0" (which is the ordinate 50) and returned 0 — the whole
    // line decoded to a single point. ASDF data lines do not carry exponents; the
    // letters are the encoding.
    if (/[0-9+\-.]/.test(c)) {
      let j = i;
      if (line[j] === "+" || line[j] === "-") j++;
      while (j < n && /[0-9.]/.test(line[j])) j++;
      const v = Number(line.slice(i, j));
      if (Number.isNaN(v)) return out;
      out.push({ value: v, mode: "affn" });
      i = j;
      continue;
    }

    // SQZ / DIF / DUP: the character carries the leading digit and the sign; any
    // plain digits immediately after it extend the SAME number.
    let lead: number | null = null;
    let mode: Token["mode"] | null = null;
    let neg = false;

    if (SQZ_POS.includes(c)) { lead = SQZ_POS.indexOf(c); mode = "affn"; }
    else if (SQZ_NEG.includes(c)) { lead = SQZ_NEG.indexOf(c) + 1; mode = "affn"; neg = true; }
    else if (DIF_POS.includes(c)) { lead = DIF_POS.indexOf(c); mode = "dif"; }
    else if (DIF_NEG.includes(c)) { lead = DIF_NEG.indexOf(c) + 1; mode = "dif"; neg = true; }
    else if (DUP_CHARS.includes(c)) { lead = DUP_CHARS.indexOf(c) + 1; mode = "dup"; }
    else { i++; continue; } // unknown character: skip rather than invent a value

    let digits = String(lead);
    i++;
    while (i < n && /[0-9]/.test(line[i])) { digits += line[i]; i++; }
    const v = Number(digits) * (neg ? -1 : 1);
    out.push({ value: v, mode: mode as Token["mode"] });
  }
  return out;
}

/** A ##KEY= label, normalised: JCAMP ignores case, spaces, dashes and slashes. */
function normKey(k: string): string {
  return k.toUpperCase().replace(/[\s\-/_]/g, "");
}

function kindOf(dataType: string, xUnits: string): JcampKind {
  const d = dataType.toUpperCase();
  if (d.includes("INFRARED")) return "ir";
  if (d.includes("NMR")) return "nmr";
  if (d.includes("UV") || d.includes("VISIBLE")) return "uvvis";
  if (d.includes("MASS")) return "ms";
  if (d.includes("RAMAN")) return "raman";
  // Fall back on the x axis when DATA TYPE is missing or vendor-specific.
  const x = xUnits.toUpperCase();
  if (x.includes("1/CM") || x.includes("CM-1")) return "ir";
  if (x.includes("PPM")) return "nmr";
  if (x.includes("NANOMETER") || x.includes("NM")) return "uvvis";
  if (x.includes("M/Z")) return "ms";
  return "unknown";
}

/**
 * Parses a JCAMP-DX file. Handles XYDATA (X++(Y..Y)) with AFFN/PAC/SQZ/DIF/DUP,
 * XYPOINTS, and PEAK TABLES. Multi-spectrum files (##NTUPLES / LINK blocks) are
 * split on ##TITLE.
 */
export function parseJcamp(text: string): JcampParse {
  if (!text || !/##\s*TITLE\s*=/i.test(text)) {
    return { ok: false, error: "Not a JCAMP-DX file — no ##TITLE= record found." };
  }
  const lines = text.split(/\r?\n/);

  // Split into blocks at each ##TITLE=, so a LINK file with several spectra works.
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const raw of lines) {
    if (/^\s*##\s*TITLE\s*=/i.test(raw)) { cur = [raw]; blocks.push(cur); continue; }
    if (cur) cur.push(raw);
  }

  const spectra: JcampSpectrum[] = [];
  for (const block of blocks) {
    const s = parseBlock(block);
    if (s && s.points.length) spectra.push(s);
  }
  if (!spectra.length) return { ok: false, error: "No readable data points found in the file." };
  return { ok: true, spectra };
}

function parseBlock(lines: string[]): JcampSpectrum | null {
  const meta: Record<string, string> = {};
  let dataStart = -1;
  let dataKey = "";

  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*##\s*([^=]+)=(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = normKey(m[1]);
    const val = m[2].trim();
    if (key === "XYDATA" || key === "XYPOINTS" || key === "PEAKTABLE" || key === "DATATABLE") {
      dataKey = key;
      meta[key] = val;
      dataStart = i + 1;
      break;
    }
    meta[key] = val;
  }
  if (dataStart < 0) return null;

  const num = (k: string, dflt: number): number => {
    const v = Number(meta[k]);
    return Number.isFinite(v) ? v : dflt;
  };
  const xFactor = num("XFACTOR", 1);
  const yFactor = num("YFACTOR", 1);
  const firstX = num("FIRSTX", NaN);
  const lastX = num("LASTX", NaN);
  const nPoints = num("NPOINTS", NaN);
  const caveats: string[] = [];

  // Collect the data lines (stop at ##END= or the next ##RECORD=).
  const data: string[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*##/.test(l)) break;
    if (l.trim()) data.push(l.replace(/\$\$.*$/, "")); // strip trailing comments
  }

  const points: { x: number; y: number }[] = [];
  const isXYDATA = dataKey === "XYDATA" && /X\+\+/.test(meta[dataKey] ?? "");

  if (isXYDATA) {
    // (X++(Y..Y)): the first value on a line is X; the rest are successive Y at a
    // fixed deltaX. deltaX comes from the header, NOT from the data.
    const deltaX =
      Number.isFinite(firstX) && Number.isFinite(lastX) && Number.isFinite(nPoints) && nPoints > 1
        ? (lastX - firstX) / (nPoints - 1)
        : NaN;
    if (!Number.isFinite(deltaX)) {
      caveats.push("FIRSTX/LASTX/NPOINTS missing or inconsistent — X spacing was taken from the data lines instead, which is less reliable.");
    }

    // `expectedY` carries the DIF y-check across lines: when a line used DIF, the
    // next line restates that final ordinate as its first value. It is a CHECK, not
    // a data point.
    let expectedY: number | null = null;
    const step = Number.isFinite(deltaX) ? deltaX : 0;

    for (const line of data) {
      const toks = tokenizeAsdf(line);
      if (!toks.length) continue;
      const xRaw = toks[0].value;
      let x = xRaw * xFactor;
      let y: number | null = null;
      let emitted = 0; // ordinates PUSHED for this line — drives the x advance
      let lineUsedDif = false;

      for (let t = 1; t < toks.length; t++) {
        const tk = toks[t];

        if (tk.mode === "dup") {
          // Repeat the previous ordinate to `value` occurrences TOTAL, so value-1
          // extra points — each at the next x.
          if (y === null) continue;
          for (let r = 1; r < tk.value; r++) {
            x += step;
            points.push({ x, y: y * yFactor });
            emitted++;
          }
          continue;
        }

        // The new ordinate: absolute for AFFN/SQZ, a delta for DIF.
        let next: number;
        if (tk.mode === "dif") {
          if (y === null) continue; // a DIF cannot open a line
          lineUsedDif = true;
          next = y + tk.value;
        } else {
          next = tk.value;
        }

        // THE FORMAT'S OWN CHECKSUM, and the only way to know the decode was right:
        // a wrong ASDF decode still looks like a spectrum. Only the first ordinate
        // of a line that FOLLOWS a DIF line is a check value.
        if (t === 1 && expectedY !== null) {
          if (next !== expectedY) {
            caveats.push(
              `DIF y-check failed near x=${xRaw}: the file restates ${next} but the previous ` +
                `line decoded to ${expectedY}. Data from here on may be wrong.`
            );
          }
          expectedY = null;
          y = next; // adopt it and move on — it is NOT a new point
          continue;
        }

        // Every ordinate after the line's first sits one deltaX further along. This
        // advance used to live only in the AFFN branch, so DIF points all stacked at
        // the line's starting x — the trace collapsed onto a handful of abscissae
        // and still plotted.
        if (emitted > 0) x += step;
        y = next;
        points.push({ x, y: y * yFactor });
        emitted++;
      }

      // Only a DIF-encoded line hands a check value to the next one.
      expectedY = lineUsedDif ? y : null;
    }

    if (Number.isFinite(nPoints) && points.length !== nPoints) {
      caveats.push(
        `The file declares ${nPoints} points but ${points.length} decoded. ` +
          "The compression may not have been read correctly — treat this trace with suspicion."
      );
    }
  } else {
    // XYPOINTS / PEAK TABLE: explicit (x, y) pairs.
    for (const line of data) {
      const nums = line.split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v));
      for (let k = 0; k + 1 < nums.length; k += 2) {
        points.push({ x: nums[k] * xFactor, y: nums[k + 1] * yFactor });
      }
    }
  }

  const dataType = meta["DATATYPE"] ?? "";
  const xUnits = meta["XUNITS"] ?? "";
  const yUnits = meta["YUNITS"] ?? "";

  caveats.push(
    "Read from the file as written. JCAMP-DX carries no guarantee that the instrument's " +
      "baseline, phasing or referencing were correct — this is the vendor's data, not a validation of it."
  );
  if (yUnits.toUpperCase().includes("TRANSMITTANCE")) {
    caveats.push("Y is TRANSMITTANCE: peaks point DOWN. A predicted absorbance spectrum overlaid on this will look inverted unless one is converted.");
  }

  return {
    title: meta["TITLE"] ?? "(untitled)",
    dataType,
    kind: kindOf(dataType, xUnits),
    xUnits,
    yUnits,
    points,
    meta,
    caveats,
  };
}
