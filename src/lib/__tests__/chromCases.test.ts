// FIXED CASE TABLE for the HPLC/GC peak table (Release C gap #7). Every row is cumulative: a later fix round keeps
// each outcome. Convention: USP ⟨621⟩ / Ph. Eur. 2.2.46 harmonized, half-height widths (chromatography.ts).
//
// ORACLE (closed form, by hand and checked with numpy in the statvenv):
//   python -I -c "import numpy as np; print(5.54*(5.00/0.100)**2, 1.18*(5.5-5.0)/(0.10+0.12), 0.30/(2*0.12),
//                 (3-1)/1, (4-1)/1, 3/2, 100/400*100, 300/400*100)"
//   → 13850.0 2.6818181818181817 1.25 2.0 3.0 1.5 25.0 75.0
//   adversarial rows: 5.54*(12.5/0.21)**2 = 19628.7 (rounded 19 629); 1.18*(12.9-12.5)/(0.21+0.23) = 1.0727;
//   tiny widths 5.54*(1/1e-4)**2 = 5.54e8 → "554 000 000"; 1.18*0.004/(0.002+0.002) = 1.18.

import { CHROM_CALCS } from "../chromCalcs";
import { readPeakTable, analyzePeaks, drawPlan, N_HALF_HEIGHT, RS_HALF_HEIGHT } from "../chromatography";

/** Plate numbers are grouped with THIN SPACES (U+2009); the expectations below are written with ordinary spaces. */
const thin = (s: string): string => s.split(String.fromCharCode(0x2009)).join(" ");
const calc = CHROM_CALCS.find((c) => c.id === "chem-peak-table")!;
const run = (data: string, tm = "", unit = "min") => {
  const f: Record<string, string> = { data, tm, unit };
  return calc.compute((k) => f[k] ?? "");
};
const peaksOf = (data: string, tM: number | null = null) => {
  const t = readPeakTable(data);
  if (!t.ok) throw new Error(t.error);
  const a = analyzePeaks(t.rows, tM);
  if (!a.ok) throw new Error(a.error);
  return a;
};
const refusalOf = (data: string, tM: number | null = null): string => {
  const t = readPeakTable(data);
  if (!t.ok) return t.error;
  const a = analyzePeaks(t.rows, tM);
  return a.ok ? "" : a.error;
};

describe("chromatography fixed case table", () => {
  test("constants are the compendial ones", () => {
    expect(N_HALF_HEIGHT).toBe(5.54);
    expect(RS_HALF_HEIGHT).toBe(1.18);
  });

  test("1: one peak tR 5.00, W0.5 0.100 → N = 13 850", () => {
    const a = peaksOf("RT\tW0.5\n5.00\t0.100");
    expect(a.peaks[0].N).toBeCloseTo(13850, 6);
    const out = run("RT\tW0.5\n5.00\t0.100");
    expect(out.ok).not.toBe(false);
    expect(thin(out.text)).toContain("13 850");
  });

  test("2: two peaks 5.0/5.5, W0.5 0.10/0.12 → Rs = 2.68", () => {
    const a = peaksOf("RT\tW0.5\n5.0\t0.10\n5.5\t0.12");
    expect(a.peaks[0].Rs).toBeCloseTo(2.6818181818, 8);
    expect(a.peaks[1].Rs).toBeNull();
    expect(run("RT\tW0.5\n5.0\t0.10\n5.5\t0.12").text).toMatch(/\t2\.68\t/);
  });

  test("3: W0.05 0.30, f 0.12 → T = 1.25", () => {
    const a = peaksOf("RT\tW0.05\tf\n5.0\t0.30\t0.12");
    expect(a.peaks[0].T).toBeCloseTo(1.25, 12);
    expect(run("RT\tW0.05\tf\n5.0\t0.30\t0.12").text).toMatch(/\t1\.25$/m);
  });

  test("4: tM 1.0, tR 3.0 and 4.0 → k 2.0 and 3.0, α = 1.50", () => {
    const a = peaksOf("RT\n3.0\n4.0", 1.0);
    expect(a.peaks.map((p) => p.k)).toEqual([2, 3]);
    expect(a.peaks[0].alpha).toBeCloseTo(1.5, 12);
    const out = run("RT\n3.0\n4.0", "1.0");
    expect(out.text).toMatch(/\t2\.00\t/);
    expect(out.text).toMatch(/\t3\.00\t/);
    expect(out.text).toMatch(/\t1\.50\t/);
  });

  test("5: areas 100, 300 → 25.0 %, 75.0 %", () => {
    const a = peaksOf("RT\tArea\n2\t100\n3\t300");
    expect(a.peaks.map((p) => p.areaPct)).toEqual([25, 75]);
    const out = run("RT\tArea\n2\t100\n3\t300");
    expect(out.text).toContain("25.0 %");
    expect(out.text).toContain("75.0 %");
  });

  test("6: no tM → k/α omitted with a named note, result still ok", () => {
    const out = run("RT\tW0.5\n5.0\t0.10\n5.5\t0.12");
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("Retention factor k and separation factor α not computed: no dead time tM given.");
    const a = peaksOf("RT\tW0.5\n5.0\t0.10\n5.5\t0.12");
    expect(a.peaks.every((p) => p.k === null && p.alpha === null)).toBe(true);
  });

  test("7: duplicate tR → named refusal", () => {
    const out = run("Peak\tRT\tW0.5\nA\t5.0\t0.1\nB\t5.0\t0.1");
    expect(out.ok).toBe(false);
    // Round 3 (RULE I) wording; round 1 read "A (line 2) and B (line 3)".
    expect(out.text).toContain("peak 1 (A, line 2) and peak 2 (B, line 3) have the same retention time 5");
  });

  test("8: width 0 or −0.1 → named refusal naming the peak", () => {
    for (const w of ["0", "-0.1", "−0.1"]) {
      const out = run(`Peak\tRT\tW0.5\nCaffeine\t5.0\t${w}`);
      expect(out.ok).toBe(false);
      // Round 3 (RULE I) wording; round 1 read "Caffeine (line 2) has …".
      expect(out.text).toMatch(/peak 1 \(Caffeine, line 2\) has a W₀\.₅ of (0|−0\.1); a W₀\.₅ must be greater than zero/);
    }
    expect(run("Peak\tRT\tArea\nX\t5.0\t0").text).toMatch(/peak 1 \(X, line 2\) has an area of 0; an area must be greater than zero/);
  });

  test("9: '0,10' and '5.0' in one block → dataBlock mixed-marks refusal", () => {
    const out = run("RT\tW0.5\n5.0\t0,10");
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/mixes 5\.0 and 0,10; use one decimal mark/);
  });

  test("10: header 'Peak RT Area W0.5' in any column order is read by name", () => {
    const orders = [
      ["Peak", "RT", "Area", "W0.5"],
      ["W0.5", "Area", "Peak", "RT"],
      ["Area", "RT", "W0.5", "Peak"],
    ];
    const vals: Record<string, string[]> = { Peak: ["Alpha", "Beta"], RT: ["5.0", "5.5"], Area: ["100", "300"], "W0.5": ["0.10", "0.12"] };
    for (const o of orders) {
      const text = [o.join("\t"), ...[0, 1].map((i) => o.map((h) => vals[h][i]).join("\t"))].join("\n");
      const a = peaksOf(text);
      expect(a.peaks.map((p) => p.label)).toEqual(["Alpha", "Beta"]);
      expect(a.peaks[0].Rs).toBeCloseTo(2.6818181818, 8);
      expect(a.peaks.map((p) => p.areaPct)).toEqual([25, 75]);
    }
  });

  test("11: unsorted rows → sorted, note says so", () => {
    const a = peaksOf("Peak\tRT\tW0.5\nLate\t5.5\t0.12\nEarly\t5.0\t0.10");
    expect(a.sorted).toBe(true);
    expect(a.peaks.map((p) => p.label)).toEqual(["Early", "Late"]);
    expect(a.peaks[0].Rs).toBeCloseTo(2.6818181818, 8);
    expect(run("Peak\tRT\tW0.5\nLate\t5.5\t0.12\nEarly\t5.0\t0.10").text).toContain("were sorted by tR");
  });

  test("12: 201 peaks → cap refusal; 200 is accepted", () => {
    const tbl = (n: number) => "RT\tW0.5\n" + Array.from({ length: n }, (_, i) => `${(1 + i * 0.1).toFixed(1)}\t0.02`).join("\n");
    const out = run(tbl(201));
    expect(out.ok).toBe(false);
    expect(out.text).toContain("201 peaks; at most 200 peaks per table");
    expect(run(tbl(200)).ok).not.toBe(false);
  });
});

describe("chromatography adversarial rows", () => {
  test("no header: default order tR, area, W0.5, height, W0.05, f", () => {
    const a = peaksOf("12.5 100 0.21\n12.9 300 0.23");
    expect(a.peaks[0].N).toBeCloseTo(5.54 * (12.5 / 0.21) ** 2, 6);
    expect(a.peaks[0].Rs).toBeCloseTo((1.18 * 0.4) / 0.44, 10);
    expect(a.peaks.map((p) => p.areaPct)).toEqual([25, 75]);
    expect(thin(run("12.5 100 0.21\n12.9 300 0.23").text)).toContain("19 629");
  });
  test("no header, a tab-separated name column first", () => {
    const a = peaksOf("Peak 1\t12.5\t100\t0.21\nPeak 2\t12.9\t300\t0.23");
    expect(a.peaks.map((p) => p.label)).toEqual(["Peak 1", "Peak 2"]);
  });
  test("no header, space-separated names → refused (a name would split)", () => {
    expect(refusalOf("Peak 1 12.5 100 0.21\nPeak 2 12.9 300 0.23")).toMatch(/need tab-separated columns/);
    expect(refusalOf("caffeine 12.5 100 0.21")).toMatch(/need tab-separated columns/);
  });
  test("space-separated header with a field count that does not match → refused", () => {
    expect(refusalOf("Peak RT Area\nPeak 1 5.0 100")).toMatch(/line 2 has 4 values under 3 header fields/);
  });
  test("space-separated header with units would shift the columns → refused (never a W0.5 read from the area)", () => {
    expect(refusalOf("RT (min) Area W0.5\n5.0 100 0.1")).toMatch(/line 2 has 3 values under 4 header fields .* separate the columns with tabs/);
    expect(refusalOf("RT (min) W0.5 (min) Area\n5.0 0.1 100\n5.5 0.12 300")).toMatch(/3 values under 5 header fields/);
    const a = peaksOf("RT Area W0.5\n5.0 100 0.1\n5.5 300 0.12");
    expect(a.peaks[0].N).toBeCloseTo(13850, 6);
    expect(a.peaks.map((p) => p.areaPct)).toEqual([25, 75]);
    // The same header with units is fine with tabs.
    expect(peaksOf("RT (min)\tArea\tW0.5 (min)\n5.0\t100\t0.1").peaks[0].N).toBeCloseTo(13850, 6);
  });
  test("a numeric Peak column is a peak number", () => {
    const a = peaksOf("Peak RT W0.5\n1 5.0 0.1\n2 5.5 0.12");
    expect(a.peaks.map((p) => p.label)).toEqual(["peak 1", "peak 2"]);
  });
  test("ambiguous 'Width' and 'Time' headers are refused by name", () => {
    expect(refusalOf("RT\tWidth\n5\t0.1")).toMatch(/“Width” could be the baseline \(tangent\) width or the width at half height/);
    expect(refusalOf("Time\tArea\n5\t10")).toMatch(/“Time” does not say it is the retention time/);
    expect(refusalOf("RT\tWb\n5\t0.4")).toMatch(/tangent/);
  });
  test("units in headers, FWHM alias, and an unused column", () => {
    const a = peaksOf("Name\tRT (min)\tArea [mAU*s]\tFWHM (min)\tArea%\nX\t5.0\t100\t0.1\t100");
    expect(a.peaks[0].N).toBeCloseTo(13850, 6);
    const t = readPeakTable("Name\tRT (min)\tArea [mAU*s]\tFWHM (min)\tArea%\nX\t5.0\t100\t0.1\t100");
    expect(t.ok && t.notes.join(" ")).toContain("Not used: Area% (computed here)");
  });
  test("two columns for one role → refused", () => {
    expect(refusalOf("RT\ttR\n5\t5")).toMatch(/two columns are read as the retention time/);
  });
  test("no retention-time column → refused", () => {
    expect(refusalOf("Area\tHeight\n10\t5")).toMatch(/no retention-time column/);
  });
  test("tR ≤ tM refused naming the peak", () => {
    expect(refusalOf("Peak\tRT\nUracil\t1.0\nX\t3", 1.0)).toMatch(/peak 1 \(Uracil, line 2\) elutes at 1, not after the dead time tM = 1/);
    expect(run("RT\n3\n4", "5").text).toMatch(/not after the dead time/);
  });
  test("tM with a mismatched unit or junk is refused; matching unit accepted", () => {
    expect(run("RT\n3\n4", "60 s").text).toMatch(/tM is in s but the table's time unit is min/);
    expect(run("RT\n3\n4", "abc").ok).toBe(false);
    expect(run("RT\n3\n4", "1 min").ok).not.toBe(false);
    expect(run("RT\n3\n4", "0").ok).toBe(false);
  });
  test("W0.05 narrower than W0.5, and f ≥ W0.05, are refused (swapped columns)", () => {
    expect(refusalOf("RT\tW0.5\tW0.05\n5\t0.2\t0.1")).toMatch(/narrower than W₀\.₅/);
    expect(refusalOf("RT\tW0.05\tf\n5\t0.1\t0.2")).toMatch(/f \(0\.2\) is not smaller than W₀\.₀₅/);
  });
  test("a missing W0.5 for one peak omits N and Rs involving it, with a note", () => {
    const a = peaksOf("Peak\tRT\tW0.5\nA\t5.0\t0.1\nB\t5.5\t-\nC\t6.0\t0.1");
    expect(a.peaks[1].N).toBeNull();
    expect(a.peaks[0].Rs).toBeNull();
    expect(a.peaks[1].Rs).toBeNull();
    expect(a.notes.join(" ")).toContain("N and Rs not computed for peak 2 (B)");
  });
  test("a missing area omits area % for all, with a note naming the peak", () => {
    const a = peaksOf("Peak\tRT\tArea\nA\t5\t10\nB\t6\t-");
    expect(a.peaks.every((p) => p.areaPct === null)).toBe(true);
    expect(a.notes.join(" ")).toContain("no area for peak 2 (B)");
  });
  test("a missing retention time is refused by line", () => {
    expect(refusalOf("RT\tArea\n5\t10\n-\t20")).toMatch(/line 3 has no retention time/);
  });
  test("word in a numeric column → dataBlock refusal by line", () => {
    expect(refusalOf("RT\tArea\n5\t10\n6\tabc")).toMatch(/line 3/);
  });
  test("tiny and huge magnitudes stay finite and never print e-notation", () => {
    const out = run("RT\tW0.5\n1\t0.0001\n1.004\t0.0001");
    expect(out.ok).not.toBe(false);
    expect(thin(out.text)).toContain("554 000 000");
    expect(out.text).not.toMatch(/\d[eE][-+]?\d/);
    const big = run("RT\tArea\tW0.5\n100000\t1e12\t10\n200000\t3e12\t12");
    expect(big.ok).not.toBe(false);
    expect(big.text).not.toMatch(/\d[eE][-+]?\d|NaN|Infinity|undefined/);
  });
  test("decimal-comma tables read through dataBlock", () => {
    const a = peaksOf("RT;W0.5\n5,0;0,10\n5,5;0,12");
    expect(a.peaks[0].Rs).toBeCloseTo(2.6818181818, 8);
  });
  test("empty and header-only inputs are refused", () => {
    expect(run("").ok).toBe(false);
    expect(run("RT\tW0.5").text).toMatch(/only a header line/);
  });
  test("the default inputs compute, draw, and obey the display contract", () => {
    const out = calc.compute((k) => calc.fields.find((f) => f.key === k)?.default ?? "");
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("Convention: USP ⟨621⟩ / Ph. Eur. 2.2.46 (harmonized), half-height widths");
    expect(out.text).not.toMatch(/—|\^|NaN|Infinity|undefined|\d[eE][-+]?\d/);
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    expect(plots).toHaveLength(1);
    const svg = (plots[0] as { svg: string }).svg;
    expect(svg).toContain("Reconstructed from the peak table (Gaussian peaks), not the measured trace.");
    expect(svg).toContain("Time (min)");
    expect(svg).toContain(">Caffeine<");
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });
  test("drawing: heights from the table, else area/(1.0645 W0.5) for all peaks, else equal heights", () => {
    const h = drawPlan(peaksOf("RT\tHeight\tW0.5\n5\t50\t0.1\n6\t100\t0.1").peaks);
    expect(h.draw.map((d) => d.rel)).toEqual([50, 100]);
    expect(h.draw[0].sigma).toBeCloseTo(0.1 / 2.3548, 12);
    const m = drawPlan(peaksOf("RT\tArea\tHeight\tW0.5\n5\t10.645\t50\t0.1\n6\t21.29\t-\t0.1").peaks);
    expect(m.draw.map((d) => d.rel)).toEqual([50, 100]);
    expect(m.notes.join(" ")).toContain("area / (1.0645 W₀.₅)");
    const e = drawPlan(peaksOf("RT\tW0.5\n5\t0.1\n6\t0.1").peaks);
    expect(e.draw.map((d) => d.rel)).toEqual([100, 100]);
    expect(e.notes.join(" ")).toContain("same height");
  });
  test("a crowded run falls back to numbers with a key", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `Compound number ${i + 1}\t${(2 + i * 0.25).toFixed(2)}\t${100 + ((i * 37) % 200)}\t0.06`).join("\n");
    const out = run("Name\tRT\tHeight\tW0.5\n" + rows);
    expect(out.ok).not.toBe(false);
    const svg = ((out.blocks ?? []).find((b) => b.kind === "plot") as { svg: string }).svg;
    expect(svg).toContain("1 = Compound number 1");
  });
  test("timing: 200 peaks under 300 ms", () => {
    const tbl = "Peak\tRT\tArea\tHeight\tW0.5\tW0.05\tf\n" + Array.from({ length: 200 }, (_, i) => `P${i}\t${(1 + i * 0.13).toFixed(2)}\t${10 + i}\t${50 + (i % 9) * 10}\t0.05\t0.1\t0.045`).join("\n");
    const t0 = Date.now();
    const out = run(tbl);
    expect(Date.now() - t0).toBeLessThan(300);
    expect(out.ok).not.toBe(false);
  });
});

// Review round 1 (review-c1/repro R01, R02, R12 and the listed extras): every repro is a row; earlier rows unchanged.
describe("chromatography review round 1", () => {
  test("R01: the lowest-resolution pair is named by elution number (as the table numbers it), and is the real min-Rs row", () => {
    const out = run("Peak\tRT\tW0.5\n1\t6\t0.1\n2\t4\t0.1\n3\t4.3\t0.1");
    expect(out.text).toContain("Lowest resolution: Rs = 1.77 between peak 1 (ID 2) and peak 2 (ID 3).");
    const rows = out.text.split("\n").filter((l) => /^\d\t/.test(l));
    expect(rows[0]).toMatch(/^1\tID 2\t4 min\t.*\t1\.77\t/);
    expect(rows[1]).toMatch(/^2\tID 3\t4\.3 min\t.*\t10\.03\t/);
    const named = run("Peak\tRT\tW0.5\nC\t6\t0.1\nA\t4\t0.1\nB\t4.3\t0.1");
    expect(named.text).toContain("between peak 1 (A) and peak 2 (B).");
  });
  // Round 3 (RULE U) changed this row: round 1 CONVERTED min↔s header units; now a header unit must equal the
  // time-unit select, any other is refused by name, and nothing is converted.
  test("R02 (RULE U): a header unit that differs from the time-unit select is refused; a matching one is read as is", () => {
    expect(run("Peak\tRT (min)\tArea\tW0.5 (s)\nA\t5.00\t10\t6.0\nB\t5.50\t12\t6.6").text).toBe(
      "Peak table: the W0.5 column header says s but the time unit is set to min; set the time unit to s (all time columns and tM must be in one unit).",
    );
    expect(run("Peak\tRT [s]\tW0.5 [s]\nA\t300\t6\nB\t330\t6.6").text).toMatch(/the RT column header says s but the time unit is set to min; set the time unit to s/);
    expect(run("RT (s)\tW0.5 (s)\n300\t6\n330\t6.6", "", "min").ok).toBe(false);
    expect(run("RT (min)\tW0.5 (min)\n5\t0.1", "", "s").text).toMatch(/the RT column header says min but the time unit is set to s; set the time unit to min/);
    // Matching units: read as written, no conversion note.
    const same = run("RT (s)\tW0.5 (s)\n300\t6\n330\t6.6", "", "s");
    expect(thin(same.text)).toMatch(/^1\t–\t300 s\t.*\t13 850\t/m);
    expect(same.text).not.toMatch(/converted/);
    expect(run("RT (min)\tW0.5 (min)\n5\t0.1", "", "min").text).not.toMatch(/converted/);
    expect(run("RT (min)\tW0.5 (mm)\n5\t0.1").text).toMatch(/the column “W0\.5 \(mm\)” is in “mm”; retention times and widths must be in min or s/);
    // A unit on an area or height column is not a time and is left alone.
    expect(run("RT\tArea [mAU*s]\tW0.5\n5\t10\t0.1").ok).not.toBe(false);
  });
  test("R12: a CSV whose names hold spaces is refused for the real reason (columns do not line up), not 'no retention-time column'", () => {
    const out = run("Peak,RT,Area,W0.5\nPeak 1,4.00,50,0.10\nPeak 2,4.50,50,0.12");
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/the header is comma-separated, but a space in the data \(such as “Peak 1”\) makes spaces separate the columns too/);
    expect(out.text).not.toMatch(/no retention-time column/);
    // The same table without spaces in the names is read.
    expect(run("Peak,RT,Area,W0.5\nP1,4.00,50,0.10\nP2,4.50,50,0.12").ok).not.toBe(false);
  });
  // Round 3 (RULE I) changed this row's wording: an unnamed peak is "peak N (line L)", the elution number first.
  test("an unnamed peak is 'peak N (line L)', never 'the peak on line 2 (line 2)'", () => {
    const dup = run("RT\tW0.5\n4\t0.1\n4\t0.1");
    expect(dup.text).toContain("peak 1 (line 2) and peak 2 (line 3) have the same retention time 4");
    expect(dup.text).not.toMatch(/\(line \d\) \(line/);
    expect(run("RT\tW0.5\n4\t-0.1").text).toContain("peak 1 (line 2) has a W₀.₅ of −0.1");
  });
  test("ChemStation's Type column (BB, VV) is read past as text, named in a note", () => {
    const out = run("Peak\tRetTime\tType\tW0.5\tArea\n1\t4.00\tBB\t0.10\t50\n2\t4.50\tVV\t0.12\t50");
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("Not used: Type (peak type codes).");
    expect(out.text).toMatch(/\t2\.68\t/);
  });
  test("a word in a numeric column names the field and its column, not the header advice", () => {
    const out = run("Peak\tRT\tW0.5\nＡ\t４.0\t0.1");
    expect(out.ok).toBe(false);
    expect(out.text).toContain("line 2: “４.0” is not a number, in the column read as the retention time tR (“RT”)");
    expect(out.text).not.toMatch(/put a header on its own/);
    // An unused text column (Comment) is peeled and never trips the number reader.
    expect(run("RT\tComment\tW0.5\n4\tshoulder\t0.1\n5\tok\t0.1").ok).not.toBe(false);
  });
  test("large magnitudes print without trailing mantissa zeros", () => {
    const out = run("RT\tW0.5\n4000000\t0.000001");
    expect(out.text).toContain("4×10⁶ min");
    expect(out.text).not.toMatch(/4\.0+×/);
  });
});

// Review round 2 (review-c2/repro R2-01 … R2-04), under the integrator's round-3 rules U, I and R.
describe("chromatography review round 2", () => {
  test("R2-01 (RULE U): a unit on SOME time columns, disagreeing with the select, is refused (never converted)", () => {
    expect(run("Peak\tRT (s)\tW0.5\nA\t300\t6\nB\t330\t6.6", "", "min").text).toMatch(/the RT column header says s but the time unit is set to min; set the time unit to s/);
    expect(run("Peak\tRT (min)\tW0.5\nA\t5.00\t0.10\nB\t5.50\t0.11", "", "s").text).toMatch(/the RT column header says min but the time unit is set to s; set the time unit to min/);
    // Control: no units, select min.
    expect(thin(run("Peak\tRT\tW0.5\nA\t5.00\t0.10\nB\t5.50\t0.11", "", "min").text)).toMatch(/^1\tA\t5 min\t.*\t13 850\t/m);
  });
  test("R2-02 (RULE U): header in min, select s, tM 1.05 → refused (tM is always in the select's unit)", () => {
    const out = run("Peak\tRT (min)\tW0.5 (min)\nA\t5.00\t0.10\nB\t6.50\t0.12", "1.05", "s");
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/header says min but the time unit is set to s; set the time unit to min \(all time columns and tM must be in one unit\)/);
    // With the select on min the same table gives k = (5 − 1.05)/1.05 = 3.76, α = 5.19/3.76 = 1.38.
    expect(run("Peak\tRT (min)\tW0.5 (min)\nA\t5.00\t0.10\nB\t6.50\t0.12", "1.05", "min").text).toMatch(/^1\tA\t5 min\t–\t3\.76\t.*\t1\.38\t/m);
  });
  test("R2-03 (RULE I): numeric IDs are named as the table numbers them in every note and sentence", () => {
    const a = run("Peak\tRT\tW0.5\n1\t6\t0.1\n2\t4\t\n3\t4.3\t0.1\n4\t7\t0.1");
    expect(a.text).toContain("N and Rs not computed for peak 1 (ID 2): no W₀.₅");
    expect(a.text).not.toMatch(/for peak 2[^ ]/);
    const b = run("Peak\tRT\tArea\tW0.5\n1\t6\t5\t0.1\n2\t4\t\t0.1\n3\t4.3\t6\t0.1");
    expect(b.text).toContain("no area for peak 1 (ID 2)");
    expect(b.text).toContain("Lowest resolution: Rs = 1.77 between peak 1 (ID 2) and peak 2 (ID 3).");
    // A refusal before sorting uses the same form.
    expect(run("Peak\tRT\tW0.5\n1\t6\t0.1\n2\t4\t-0.1").text).toContain("peak 1 (ID 2, line 3) has a W₀.₅ of −0.1");
    // A drawing note (inside the figure) too.
    const fig = run("Peak\tRT\tHeight\tW0.5\n1\t6\t10\t0.1\n2\t4\t20\t-");
    const svg = ((fig.blocks ?? []).find((x) => x.kind === "plot") as { svg: string }).svg;
    expect(svg).toContain("Drawn as a line (no W₀.₅): peak 1 (ID 2).");
  });
  test("R2-04 (RULE R): no header, a row with fewer fields than the others is refused by line (space, tab, comma)", () => {
    expect(run("4.00 50 0.10\n4.50 0.12\n5.00 40 0.11").text).toMatch(/^Peak table: line 2 has 2 values but another line has 3\. With no header the columns are read by position/);
    expect(run("4.00\t50\t0.10\n4.50\t0.12\n5.00\t40\t0.11").text).toMatch(/line 2 has 2 values but another line has 3/);
    expect(run("4.00,50,0.10\n4.50,0.12").text).toMatch(/line 2 has 2 values but another line has 3/);
    // A trailing empty tab cell is a missing value, not a short row; a "-" placeholder is fine everywhere.
    expect(run("4.00\t50\t0.10\n4.50\t60\t\n5.00\t40\t0.11").ok).not.toBe(false);
    expect(run("4.00 50 0.10\n4.50 - 0.12\n5.00 40 0.11").ok).not.toBe(false);
    // With a header: as before (refused as a field-count mismatch).
    expect(run("RT Area W0.5\n4.00 50 0.10\n4.50 0.12\n5.00 40 0.11").text).toMatch(/line 3 has 2 values under 3 header fields/);
  });
});

describe("chromatography review round 3", () => {
  it("R3: a trailing empty tab cell on one line does not make the other lines short", () => {
    const r = CHROM_CALCS[0].compute((k) => (k === "data" ? "5.00\t10\t0.10\t\n5.50\t12\t0.11" : k === "unit" ? "min" : ""));
    expect(r.ok).not.toBe(false);
  });
});
