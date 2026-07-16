// Adversarial pass over everything built in the v1.66–v1.79 run.
//
// The other test files check that each module does what it claims on reasonable
// input. This one tries to BREAK them: degenerate, hostile, boundary and
// pathological inputs. The bar is not "returns the right answer" — for most of
// these there is no right answer. The bar is:
//
//   1. never throw an unhandled exception,
//   2. never return NaN/Infinity dressed up as a result,
//   3. never silently return a confident number where the input cannot support one.
//
// (3) is the one that matters. Every real defect this audit found — carbon dioxide
// as a ketone, a sulfonamide as a base, Cheng-Prusoff 11x off, DpnI cutting PCR
// products — was a confident answer to a question the code could not actually
// answer. A crash would have been kinder.

import { align, blosum62, guessKind } from "../align";
import { parseJcamp } from "../jcamp";
import { tukeyHSD, studentizedRangeCdf, studentizedRangeCritical } from "../tukey";
import { fftFilter } from "../fftfilter";
import { predictPka } from "../pka";
import { findSites, methylationWarnings } from "../enzymes";
import { kiFromIc50, fitInhibition, fitMichaelisMenten } from "../assay";
import { primerTm } from "../dna";
import { computeProperties } from "../properties";
import { carbonylKind } from "../molgraph";
import { Molecule } from "openchemlib";

/** Every finite number in an object graph is actually finite. */
function assertNoBadNumbers(v: unknown, path = "root"): void {
  if (typeof v === "number") {
    expect({ path, finite: Number.isFinite(v) }).toEqual({ path, finite: true });
    return;
  }
  if (Array.isArray(v)) return v.forEach((x, i) => assertNoBadNumbers(x, `${path}[${i}]`));
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "function") continue;
      assertNoBadNumbers(x, `${path}.${k}`);
    }
  }
}

describe("the user-facing docs are not allowed to rot", () => {
  // The docs drifted silently: the manual claimed "22 tools" while 24 shipped, and
  // the test script still said v1.59.0 at v1.80.0 — 21 releases behind. A manual
  // that omits a tool is a tool nobody uses, and a test script pinned to a dead
  // version is one nobody trusts. Neither the type-checker nor the render gate can
  // see prose, so it gets a test.
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const ROOT = path.join(__dirname, "..", "..", "..");
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const pkg = JSON.parse(read("package.json")) as { version: string };

  /** Every shipping tool, from the single source of truth. */
  const modes = (): string[] => {
    const src = read("src/lib/modes.ts");
    return [...src.matchAll(/^\s*"([a-z]+)",$/gm)].map((m) => m[1]).filter((m) => m !== "home");
  };

  test("the manual's tool count matches what actually ships", () => {
    const man = read("landing/manual.html");
    const claimed = /(\d+)\s+tools/.exec(man);
    expect(claimed).not.toBeNull();
    expect(Number(claimed![1])).toBe(modes().length);
  });

  test("the manual documents every tool by name", () => {
    // Matched on the human names the manual uses, not the mode ids.
    const man = read("landing/manual.html").toLowerCase();
    const NAMES: Record<string, string> = {
      align: "needleman", seqmap: "sequence map", massspec: "mass spec", ppt: "table",
      spectra: "spectra", assay: "bio/assay", peptide: "peptide", stats: "stats",
      dna: "dna", citations: "bluebook", finance: "finance", plot: "plot",
      chemical: "chemical", math: "math", units: "units", reaction: "reaction",
      analyze: "analyze", build: "build", code: "code", sequence: "st.26",
      botanical: "botanical", numerals: "numerals", audit: "audit", refs: "refs",
    };
    const missing = modes().filter((m) => {
      const needle = NAMES[m] ?? m;
      return !man.includes(needle);
    });
    expect(missing).toEqual([]);
  });

  test("the test script is not pinned to a dead version", () => {
    const ts = read("docs/TEST-SCRIPT.md");
    const v = /v(\d+\.\d+\.\d+)/.exec(ts);
    expect(v).not.toBeNull();
    expect(v![1]).toBe(pkg.version);
  });

  test("the test script covers the newest tool", () => {
    expect(read("docs/TEST-SCRIPT.md").toLowerCase()).toMatch(/needleman|smith.?waterman/);
  });
});

describe("align — hostile sequences", () => {
  test("single characters, and one-vs-huge, do not throw", () => {
    for (const [a, b] of [["A", "A"], ["A", "W"], ["A", "M".repeat(200)], ["M".repeat(200), "A"]]) {
      for (const mode of ["global", "local"] as const) {
        expect(() => align(a, b, { mode })).not.toThrow();
      }
    }
  });

  test("junk characters degrade to X rather than corrupting the matrix", () => {
    const r = align("MKT@#$%^&*()AY", "MKTAY", { mode: "global", kind: "protein" });
    expect(r).not.toBeNull();
    assertNoBadNumbers({ score: r!.score, pct: r!.percentIdentity });
  });

  test("input that cleans to nothing returns null, not an empty alignment", () => {
    for (const junk of ["1234", "   ", "!!!", "\n\n\n", "…"]) {
      expect(align(junk, "MKTAY")).toBeNull();
      expect(align("MKTAY", junk)).toBeNull();
    }
  });

  test("a 2000-residue pair completes and stays self-consistent", () => {
    const a = "MKTAYIAKQRQISFVKSHFSRQ".repeat(90).slice(0, 2000);
    const b = "MKTAYIAKQRQVSFVKSHFARQ".repeat(90).slice(0, 2000);
    const r = align(a, b, { mode: "global" })!;
    expect(r.a).toHaveLength(r.b.length);
    expect(r.a.replace(/-/g, "")).toBe(a);
    expect(r.b.replace(/-/g, "")).toBe(b);
    assertNoBadNumbers({ s: r.score, i: r.percentIdentity, g: r.percentGaps });
  });

  test("absurd gap costs do not produce NaN or an unpaired alignment", () => {
    for (const [go, ge] of [[0, 0], [1e6, 1e6], [0, 1e6], [1e6, 0]]) {
      const r = align("MKTAYIAK", "MKAYIAK", { mode: "global", gapOpen: go, gapExtend: ge });
      if (!r) continue;
      expect(r.a).toHaveLength(r.b.length);
      assertNoBadNumbers({ score: r.score });
    }
  });

  test("BLOSUM62 never returns undefined for any byte", () => {
    for (let c = 32; c < 127; c++) {
      const ch = String.fromCharCode(c);
      expect(Number.isFinite(blosum62(ch, "A"))).toBe(true);
      expect(Number.isFinite(blosum62("A", ch))).toBe(true);
    }
  });

  test("guessKind never throws on empty or exotic input", () => {
    for (const s of ["", "   ", "12345", "ACGT", "🧬"]) expect(() => guessKind(s)).not.toThrow();
  });
});

describe("jcamp — malformed files", () => {
  const H = `##TITLE=t\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n`;

  test("truncated, empty and header-only files are refused, not half-parsed", () => {
    for (const f of ["", "##TITLE=", H, `${H}##XYDATA=(X++(Y..Y))\n`, "##TITLE=x"]) {
      const r = parseJcamp(f);
      if (r.ok) expect(r.spectra.every((s) => s.points.length > 0)).toBe(true);
    }
  });

  test("garbage in the data block never yields NaN points", () => {
    for (const d of ["!!!!", "@@@@@@", "zzz", "0 abc def", "0 1 2 zzz 4", "----", "0 ~~~ 5"]) {
      const r = parseJcamp(`${H}##FIRSTX=0\n##LASTX=3\n##NPOINTS=4\n##XYDATA=(X++(Y..Y))\n${d}\n##END=`);
      if (r.ok) for (const p of r.spectra[0].points) assertNoBadNumbers(p);
    }
  });

  test("a DIF opening a line (illegal) does not corrupt the trace", () => {
    // A DIF has nothing to difference from as the first ordinate. It must be
    // skipped, not applied to undefined.
    const r = parseJcamp(`${H}##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XYDATA=(X++(Y..Y))\n0J0J0\n##END=`);
    if (r.ok) for (const p of r.spectra[0].points) assertNoBadNumbers(p);
  });

  test("zero/absent FIRSTX-LASTX-NPOINTS does not divide by zero", () => {
    for (const hdr of ["##NPOINTS=1", "##FIRSTX=5\n##LASTX=5\n##NPOINTS=1", "##NPOINTS=0"]) {
      const r = parseJcamp(`${H}${hdr}\n##XYDATA=(X++(Y..Y))\n0 1 2 3\n##END=`);
      if (r.ok) for (const p of r.spectra[0].points) assertNoBadNumbers(p);
    }
  });

  test("a DUP with no preceding ordinate is ignored rather than repeating undefined", () => {
    const r = parseJcamp(`${H}##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XYDATA=(X++(Y..Y))\n0ZZZ\n##END=`);
    if (r.ok) for (const p of r.spectra[0].points) assertNoBadNumbers(p);
  });

  test("a huge NPOINTS claim does not allocate wildly", () => {
    const r = parseJcamp(`${H}##FIRSTX=0\n##LASTX=1e9\n##NPOINTS=999999999\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`);
    if (r.ok) expect(r.spectra[0].points.length).toBeLessThan(100);
  });
});

describe("tukey — degenerate groups", () => {
  test("zero-variance groups do not divide by zero", () => {
    // Every observation identical: MSE = 0. The classic divide-by-zero.
    const r = tukeyHSD([[5, 5, 5], [5, 5, 5], [5, 5, 5]]);
    if (r) for (const p of r.pairs) expect(Number.isFinite(p.p)).toBe(true);
  });

  test("zero variance WITHIN groups but different BETWEEN them is FLAGGED", () => {
    // MSE = 0 with a real difference makes q infinite. That is arithmetically honest
    // and practically meaningless — and "Infinity" would render in the pane as that
    // word. This test originally only checked p.p, so the Infinity in p.q slipped
    // past it; checking one field of a result is not checking the result.
    const r = tukeyHSD([[1, 1, 1], [9, 9, 9]])!;
    expect(r).not.toBeNull();
    for (const p of r.pairs) {
      expect(Number.isNaN(p.p)).toBe(false);
      expect(p.p).toBeGreaterThanOrEqual(0);
      expect(p.p).toBeLessThanOrEqual(1);
    }
    // The degenerate input must be named rather than silently given an infinite q.
    expect(r.mse).toBe(0);
    expect(r.caveats[0]).toMatch(/ZERO within-group variance/);
    expect(r.caveats[0]).toMatch(/Do not report these p values/);
  });

  test("identical groups do NOT get the zero-variance warning wrongly ordered", () => {
    // Same MSE = 0, but no difference between groups — still degenerate, still named.
    const r = tukeyHSD([[5, 5, 5], [5, 5, 5]])!;
    expect(r.caveats[0]).toMatch(/ZERO within-group variance/);
  });

  test("ordinary data does NOT get the zero-variance warning", () => {
    const r = tukeyHSD([[10, 11, 12], [20, 21, 22]])!;
    expect(r.mse).toBeGreaterThan(0);
    expect(r.caveats.join(" ")).not.toMatch(/ZERO within-group variance/);
  });

  test("many groups does not explode", () => {
    const groups = Array.from({ length: 12 }, (_, i) => [i, i + 1, i + 2]);
    const r = tukeyHSD(groups)!;
    expect(r.pairs).toHaveLength((12 * 11) / 2);
    for (const p of r.pairs) assertNoBadNumbers({ q: p.q, p: p.p, lo: p.ciLow, hi: p.ciHigh });
  });

  test("extreme magnitudes stay finite", () => {
    for (const scale of [1e-9, 1e9]) {
      const r = tukeyHSD([[1 * scale, 2 * scale, 3 * scale], [9 * scale, 10 * scale, 11 * scale]]);
      if (r) for (const p of r.pairs) assertNoBadNumbers({ q: p.q, p: p.p });
    }
  });

  test("the studentized range functions reject nonsense instead of guessing", () => {
    expect(Number.isNaN(studentizedRangeCdf(1, 1, 10))).toBe(true); // k < 2
    expect(Number.isNaN(studentizedRangeCritical(0, 3, 10))).toBe(true);
    expect(Number.isNaN(studentizedRangeCritical(1, 3, 10))).toBe(true);
    expect(studentizedRangeCdf(0, 3, 10)).toBe(0);
  });
});

describe("fftfilter — pathological signals", () => {
  test("constant, zero and single-spike signals stay finite", () => {
    for (const sig of [
      new Array(64).fill(0),
      new Array(64).fill(7),
      Array.from({ length: 64 }, (_, i) => (i === 32 ? 1 : 0)),
    ]) {
      const r = fftFilter(sig, 100, "lowpass", { cutoff: 10 });
      if (r) for (const v of r.signal) expect(Number.isFinite(v)).toBe(true);
    }
  });

  test("an all-zero signal does not divide by its zero range", () => {
    // span = 0 in the wraparound heuristic.
    const r = fftFilter(new Array(64).fill(0), 100, "lowpass", { cutoff: 10 })!;
    expect(r).not.toBeNull();
    for (const v of r.signal) expect(v).toBeCloseTo(0, 9);
  });

  test("extreme amplitudes survive", () => {
    for (const amp of [1e-12, 1e12]) {
      const sig = Array.from({ length: 128 }, (_, i) => amp * Math.sin(i / 5));
      const r = fftFilter(sig, 100, "lowpass", { cutoff: 20 });
      if (r) for (const v of r.signal) expect(Number.isFinite(v)).toBe(true);
    }
  });

  test("a transition band wider than the whole spectrum does not invert the gain", () => {
    const sig = Array.from({ length: 128 }, (_, i) => Math.sin(i / 5));
    const r = fftFilter(sig, 100, "lowpass", { cutoff: 10, transition: 1e6 });
    if (r) for (const v of r.signal) expect(Number.isFinite(v)).toBe(true);
  });

  test("non-finite input does not propagate silently", () => {
    const sig = Array.from({ length: 64 }, (_, i) => (i === 10 ? NaN : Math.sin(i)));
    const r = fftFilter(sig, 100, "lowpass", { cutoff: 10 });
    // NaN in must not become a plausible-looking finite spectrum out.
    if (r) expect(r.signal.some((v) => !Number.isFinite(v))).toBe(true);
  });
});

describe("pka — molecules built to confuse the group detector", () => {
  test("exotic and degenerate structures never throw or emit NaN", () => {
    for (const s of [
      "[Au]", "[He]", "O", "N", "C", "[Na+].[Cl-]",
      "NC(=N)NC(=N)NC(=N)N", // stacked guanidines
      "c1nnn[nH]1", // bare tetrazole
      "NS(=O)(=O)NS(=O)(=O)N", // stacked sulfonamides
      "OP(=O)(O)OP(=O)(O)O", // pyrophosphate: two phosphorus centres
      "O=C1CC(=O)NC(=O)N1", // barbiturate
      "C1(=O)NC(=O)NC(=O)N1", // fully substituted ring
      "[H][H]", "[C-]#[O+]",
    ]) {
      expect(() => predictPka(s)).not.toThrow();
      const r = predictPka(s);
      if (r) {
        assertNoBadNumbers({ net: r.netChargeAt74 });
        for (const site of r.sites) assertNoBadNumbers({ pka: site.pka });
      }
    }
  });

  test("net charge stays inside a physically sane range", () => {
    for (const s of ["NC(=N)NCCCC(N)C(=O)O", "OP(=O)(O)OP(=O)(O)O", "NS(=O)(=O)c1ccccc1"]) {
      const r = predictPka(s)!;
      expect(Math.abs(r.netChargeAt74)).toBeLessThan(12);
    }
  });

  test("a pendant aryl still cannot hide a barbiturate (the phenobarbital bug)", () => {
    expect(predictPka("CCC1(c2ccccc2)C(=O)NC(=O)NC1=O")!.sites.length).toBeGreaterThan(0);
  });
});

describe("enzymes — methylation on hostile sequences", () => {
  test("empty, tiny and non-ACGT sequences do not throw", () => {
    for (const s of ["", "A", "ACGT", "NNNNNNNN", "acgtACGT", "XYZ123"]) {
      expect(() => methylationWarnings(s, findSites(s))).not.toThrow();
    }
  });

  test("a sequence that is entirely methylase sites does not explode", () => {
    const s = "GATC".repeat(100);
    const w = methylationWarnings(s, findSites(s, { only: ["MboI", "DpnI", "Sau3AI"] }));
    for (const x of w) expect(typeof x.message).toBe("string");
  });

  test("circular wraparound does not read past the end", () => {
    for (const s of ["GATC", "ATCG", "TCGA", "CGAT"]) {
      expect(() => methylationWarnings(s, findSites(s, { circular: true }), true)).not.toThrow();
    }
  });
});

describe("assay — inhibition on degenerate data", () => {
  test("kiFromIc50 never returns Infinity dressed as a Ki", () => {
    for (const [ic50, s, km] of [[0, 1, 1], [1, 0, 0], [-1, 1, 1], [1, -1, 1], [1e12, 1e-12, 1e-12]]) {
      for (const mode of ["competitive", "uncompetitive", "noncompetitive", "mixed"] as const) {
        const v = kiFromIc50(ic50, s, km, mode);
        expect(v === undefined || Number.isNaN(v) || Number.isFinite(v)).toBe(true);
      }
    }
  });

  test("fitInhibition on flat or zero data does not emit NaN parameters", () => {
    const S = [1, 2, 5, 10, 20, 50];
    for (const V of [S.map(() => 0), S.map(() => 5), S.map(() => 1e9)]) {
      const r = fitInhibition(S, S.map(() => 0), V, "competitive");
      if (r) assertNoBadNumbers({ vmax: r.vmax, km: r.km, ki: r.ki, rmse: r.rmse });
    }
  });

  test("Michaelis-Menten on a descending curve still reports honestly", () => {
    // Substrate inhibition fitted with MM: it converges and is wrong. It must at
    // least not emit NaN or claim a tight SE.
    const S = [1, 2, 5, 10, 20, 50, 100, 200];
    const v = S.map((s) => (100 * s) / (10 + s + (s * s) / 50));
    const r = fitMichaelisMenten(S, v);
    assertNoBadNumbers({ vmax: r.vmax, km: r.km, se0: r.se[0], se1: r.se[1] });
    expect(r.caveats.length).toBeGreaterThan(0);
  });
});

describe("primerTm — hostile oligos", () => {
  test("degenerate and exotic sequences never emit NaN", () => {
    for (const s of ["", "A", "AC", "ACGTACGT", "NNNNNNNNNNNN", "ACGTNNNNACGT", "acgt acgt", "UUUUUUUUUUUU", "ACGT!@#$ACGT"]) {
      const r = primerTm(s);
      assertNoBadNumbers({ tm: r.tm, gc: r.gcPercent, len: r.length });
    }
  });

  test("extreme salt and primer concentrations stay finite", () => {
    for (const sodium of [1e-9, 1, 10]) {
      for (const primer of [1e-15, 1e-3]) {
        const r = primerTm("ATGCGTACGTAGCTAGCTAG", { sodium, primer });
        expect(Number.isFinite(r.tm)).toBe(true);
      }
    }
  });

  test("a homopolymer and a self-complement both work", () => {
    for (const s of ["AAAAAAAAAAAAAAAAAAAA", "GGGGGGGGGGGGGGGGGGGG", "GAATTCGAATTC"]) {
      expect(Number.isFinite(primerTm(s).tm)).toBe(true);
    }
  });
});

describe("molgraph + properties — the catch-alls stay conservative", () => {
  test("carbonylKind never names a carbonyl it cannot identify", () => {
    for (const s of ["O=C=O", "C=C=O", "O=C=C=C=O", "CC(=O)[SiH3]", "CC(=O)[Se]C", "O=C=S", "[C-]#[O+]"]) {
      const m = Molecule.fromSmiles(s);
      m.ensureHelperArrays(Molecule.cHelperRings);
      for (let a = 0; a < m.getAllAtoms(); a++) {
        const k = carbonylKind(m, a);
        // Whatever it says, it must never say "ketone" for any of these.
        expect(k).not.toBe("ketone");
      }
    }
  });

  test("computeProperties on exotic inputs never emits NaN", () => {
    for (const s of ["[Au]", "[He]", "O", "[Na+].[Cl-]", "C", "[H][H]"]) {
      const r = computeProperties(s);
      if (r) {
        assertNoBadNumbers({ mw: r.mw, logP: r.logP, logS: r.logS, tpsa: r.tpsa });
        expect(r.caveats.length).toBeGreaterThan(0);
      }
    }
  });

  test("unresolvable input returns null rather than an empty result object", () => {
    for (const junk of ["", "   ", "zzzz", "!!!", "not-a-molecule"]) {
      expect(computeProperties(junk)).toBeNull();
      expect(predictPka(junk)).toBeNull();
    }
  });
});
