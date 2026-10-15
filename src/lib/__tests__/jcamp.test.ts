// JCAMP-DX reader — with the ASDF decode checked by hand, not by trust.
//
// WHY THIS EXISTS (punch list #17)
// JurisLab could predict a spectrum but not open a real one, so it could not
// overlay predicted against measured — which is the actual workflow. A prediction
// you cannot compare against data is a parlour trick.
//
// The risk here is specific and severe: JCAMP's ASDF compression is DIFFERENTIAL.
// A reader that treats DIF characters as absolute values produces a trace that is
// wrong from the second point onward AND STILL LOOKS LIKE A SPECTRUM. Nothing
// crashes; you just overlay your prediction against noise and draw a conclusion.
//
// So every encoding below is hand-decodable from the tables, and the expected
// numbers are worked out from the spec rather than from what this code emits:
//
//   SQZ  @ABCDEFGHI = +0..9   abcdefghi = -1..-9   (char IS the leading digit)
//   DIF  %JKLMNOPQR = +0..9   jklmnopqr = -1..-9   (value is a DIFFERENCE)
//   DUP  STUVWXYZs  =  1..9   (repeat the previous ordinate that many times TOTAL)

import { parseJcamp } from "../jcamp";

const header = (extra: string) =>
  `##TITLE=test\n##JCAMP-DX=4.24\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n${extra}`;

const pointsOf = (text: string) => {
  const r = parseJcamp(text);
  if (!r.ok) throw new Error(r.error);
  return r.spectra[0].points;
};

describe("AFFN — plain numbers, the easy case", () => {
  test("reads X and successive Y at the header's spacing", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0 100 110 120\n##END=`
    );
    expect(pointsOf(f)).toEqual([
      { x: 0, y: 100 },
      { x: 1, y: 110 },
      { x: 2, y: 120 },
    ]);
  });

  test("XFACTOR and YFACTOR are applied", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=2\n##YFACTOR=0.5\n##XYDATA=(X++(Y..Y))\n0 100 110 120\n##END=`
    );
    const p = pointsOf(f);
    expect(p[0]).toEqual({ x: 0, y: 50 });
    expect(p[2].y).toBe(60);
  });
});

describe("SQZ — the character carries the leading digit and the sign", () => {
  test("A00 A10 A20 decodes to 100, 110, 120", () => {
    // A = +1, then the literal digits "00" -> "100". This is the trap: SQZ has no
    // delimiter, so "A00" is ONE number, not three.
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0A00A10A20\n##END=`
    );
    expect(pointsOf(f).map((p) => p.y)).toEqual([100, 110, 120]);
  });

  test("lower case is negative: a00 is -100", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0a00A00\n##END=`
    );
    expect(pointsOf(f).map((p) => p.y)).toEqual([-100, 100]);
  });

  test("@ is +0 and is a real value, not an absence", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0@A00\n##END=`
    );
    expect(pointsOf(f).map((p) => p.y)).toEqual([0, 100]);
  });
});

describe("DIF — the encoding that silently corrupts a naive reader", () => {
  test("J0 J0 are DIFFERENCES of +10, not values of 10", () => {
    // 100, then +10 -> 110, then +10 -> 120.
    // A reader that treats J0 as absolute yields 100, 10, 10 — a completely
    // different spectrum that still plots fine.
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0A00J0J0\n##END=`
    );
    expect(pointsOf(f).map((p) => p.y)).toEqual([100, 110, 120]);
  });

  test("negative differences: j0 is -10", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0A00j0j0\n##END=`
    );
    expect(pointsOf(f).map((p) => p.y)).toEqual([100, 90, 80]);
  });

  test("% is a difference of ZERO — a flat run", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0A00%%\n##END=`
    );
    expect(pointsOf(f).map((p) => p.y)).toEqual([100, 100, 100]);
  });

  test("mixed SQZ and DIF on one line", () => {
    // 50, +1 -> 51, +2 -> 53, then an absolute 99.
    const f = header(
      `##FIRSTX=0\n##LASTX=3\n##NPOINTS=4\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0E0JK I9\n##END=`
    );
    // E=+5 then "0" -> 50 ; J=+1 -> 51 ; K=+2 -> 53 ; I=+9 then "9" -> 99
    expect(pointsOf(f).map((p) => p.y)).toEqual([50, 51, 53, 99]);
  });
});

describe("DUP — repeat the previous ordinate", () => {
  test("T repeats the previous value to 2 occurrences total", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0A00TA50\n##END=`
    );
    // 100, 100 (T=2 total), then 150.
    expect(pointsOf(f).map((p) => p.y)).toEqual([100, 100, 150]);
  });

  test("a long flat baseline compresses to DIF-zero plus DUP", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=4\n##NPOINTS=5\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0@V\n##END=`
    );
    // @ = 0, V = 4 occurrences total.
    expect(pointsOf(f).map((p) => p.y)).toEqual([0, 0, 0, 0]);
  });

  test("X still advances across a DUP run", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0A00U\n##END=`
    );
    // Repeated Y, but the abscissa must keep stepping — otherwise every repeat
    // stacks at one x and the trace collapses.
    expect(pointsOf(f).map((p) => p.x)).toEqual([0, 1, 2]);
  });
});

describe("the format's own checksum is verified, not skipped", () => {
  test("a correct DIF y-check does not duplicate the point", () => {
    // In DIF mode the last Y of a line is repeated as the FIRST ordinate of the
    // next. It is a check value, not a new point — counting it shifts every
    // subsequent x by one.
    const f = header(
      `##FIRSTX=0\n##LASTX=3\n##NPOINTS=4\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n` +
        `0A00J0\n2A10J0\n##END=`
    );
    const p = pointsOf(f);
    // Line 1: 100, 110. Line 2 restates 110 (check) then +10 -> 120.
    expect(p.map((q) => q.y)).toEqual([100, 110, 120]);
    expect(p.map((q) => q.x)).toEqual([0, 1, 2]);
  });

  test("a FAILING y-check is reported rather than silently accepted", () => {
    // The file claims the next line starts at 999, but the decode says 110. That
    // means the decode went wrong — and the trace would still look like a
    // spectrum. It must say so.
    const f = header(
      `##FIRSTX=0\n##LASTX=3\n##NPOINTS=4\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n` +
        `0A00J0\n2I99J0\n##END=`
    );
    const r = parseJcamp(f);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spectra[0].caveats.join(" ")).toMatch(/y-check failed/);
  });

  test("a point-count mismatch is reported", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=99\n##NPOINTS=100\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0 1 2 3\n##END=`
    );
    const r = parseJcamp(f);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spectra[0].caveats.join(" ")).toMatch(/declares 100 points but 3 decoded/);
  });
});

describe("headers, units and kind detection", () => {
  test("DATA TYPE drives the kind", () => {
    const r = parseJcamp(header(`##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spectra[0].kind).toBe("ir");
      expect(r.spectra[0].xUnits).toBe("1/CM");
      expect(r.spectra[0].title).toBe("test");
    }
  });

  test("kind falls back to the X axis when DATA TYPE is absent", () => {
    const f = `##TITLE=x\n##XUNITS=PPM\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`;
    const r = parseJcamp(f);
    if (r.ok) expect(r.spectra[0].kind).toBe("nmr");
  });

  test("label keys are matched ignoring case, spaces and dashes", () => {
    // JCAMP says ##DATA TYPE, ##DATATYPE and ##Data-Type are the same label.
    for (const k of ["##DATA TYPE=INFRARED SPECTRUM", "##DATATYPE=INFRARED SPECTRUM", "##Data-Type=INFRARED SPECTRUM"]) {
      const f = `##TITLE=x\n${k}\n##XUNITS=1/CM\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`;
      const r = parseJcamp(f);
      if (r.ok) expect(r.spectra[0].kind).toBe("ir");
    }
  });

  test("transmittance is flagged — peaks point DOWN", () => {
    const f = `##TITLE=x\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=1/CM\n##YUNITS=TRANSMITTANCE\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`;
    const r = parseJcamp(f);
    // Overlaying a predicted ABSORBANCE spectrum on a transmittance trace without
    // noticing is a real and easy mistake.
    if (r.ok) expect(r.spectra[0].caveats.join(" ")).toMatch(/peaks point DOWN/);
  });

  test("$$ comments are stripped from data lines", () => {
    const f = header(
      `##FIRSTX=0\n##LASTX=2\n##NPOINTS=3\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n0 100 110 120 $$ ignore me\n##END=`
    );
    expect(pointsOf(f).map((p) => p.y)).toEqual([100, 110, 120]);
  });
});

describe("XYPOINTS and PEAK TABLE", () => {
  test("explicit x,y pairs are read", () => {
    const f = `##TITLE=p\n##DATA TYPE=MASS SPECTRUM\n##XUNITS=M/Z\n##YUNITS=RELATIVE ABUNDANCE\n##XFACTOR=1\n##YFACTOR=1\n##PEAK TABLE=(XY..XY)\n50,100 51,20\n77,999\n##END=`;
    const r = parseJcamp(f);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spectra[0].kind).toBe("ms");
      expect(r.spectra[0].points).toEqual([
        { x: 50, y: 100 },
        { x: 51, y: 20 },
        { x: 77, y: 999 },
      ]);
    }
  });
});

describe("it refuses rather than inventing", () => {
  test("a non-JCAMP file is rejected with a reason", () => {
    const r = parseJcamp("hello world");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no ##TITLE/);
  });

  test("empty input is rejected", () => {
    expect(parseJcamp("").ok).toBe(false);
  });

  test("a header with no data is rejected, not returned empty", () => {
    const r = parseJcamp(`##TITLE=x\n##XUNITS=1/CM\n##END=`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No readable data/);
  });

  test("every spectrum carries the provenance caveat", () => {
    const r = parseJcamp(header(`##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`));
    if (r.ok) expect(r.spectra[0].caveats.join(" ")).toMatch(/vendor's data, not a validation of it/);
  });
});

describe("multi-spectrum LINK files", () => {
  test("each ##TITLE starts a new spectrum", () => {
    const one = `##TITLE=first\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=1/CM\n##XFACTOR=1\n##YFACTOR=1\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`;
    const two = `##TITLE=second\n##DATA TYPE=RAMAN SPECTRUM\n##XUNITS=1/CM\n##XFACTOR=1\n##YFACTOR=1\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 3 4\n##END=`;
    const r = parseJcamp(`${one}\n${two}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spectra).toHaveLength(2);
      expect(r.spectra.map((s) => s.title)).toEqual(["first", "second"]);
      expect(r.spectra[1].kind).toBe("raman");
    }
  });
});

// ---------------------------------------------------------------------------
// v2.138.0 — the reader fixes in docs/SCOPE-SPECTROSCOPY-BATCH.md §B1. Every
// expectation below is worked from the JCAMP-DX spec tables by hand; the real-
// file versions (against an independent Python decoder) are in jcampCorpus.test.ts.
// ---------------------------------------------------------------------------

const xy = (extra: string, data: string) =>
  header(`${extra}\n##XFACTOR=1\n##YFACTOR=1\n##XYDATA=(X++(Y..Y))\n${data}\n##END=`);
const spec0 = (text: string) => {
  const r = parseJcamp(text);
  if (!r.ok) throw new Error(r.error);
  return r.spectra[0];
};

describe("DIFDUP — a DUP after a DIF repeats the DIFFERENCE", () => {
  test("synthetic `1 AJT` decodes to 1, 2, 3 (it used to give 1, 2, 2)", () => {
    // A = SQZ 1; J = DIF +1 -> 2; T = DUP 2: the token J occurs twice in total,
    // so the difference +1 is applied once more -> 3.
    const s = spec0(xy("##FIRSTX=1\n##LASTX=3\n##NPOINTS=3", "1 AJT"));
    expect(s.points.map((p) => p.y)).toEqual([1, 2, 3]);
    expect(s.points.map((p) => p.x)).toEqual([1, 2, 3]);
    expect(s.corrupt).toBeFalsy();
  });

  test("a long DIF run compressed with DUP keeps stepping: A00 N V -> 100 105 110 115 120", () => {
    // N = DIF +5 (a DIF character followed by digits extends the number: N0 would be +50).
    const s = spec0(xy("##FIRSTX=0\n##LASTX=4\n##NPOINTS=5", "0A00NV"));
    expect(s.points.map((p) => p.y)).toEqual([100, 105, 110, 115, 120]);
  });

  test("a DUP after a negative DIF steps down: A00 k U -> 100 98 96 94", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=3\n##NPOINTS=4", "0A00kU"));
    expect(s.points.map((p) => p.y)).toEqual([100, 98, 96, 94]);
  });

  test("a multi-digit DIF before a DUP: A00 J5 T -> 100 115 130", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0A00J5T"));
    expect(s.points.map((p) => p.y)).toEqual([100, 115, 130]);
  });

  test("a DUP after the DIF-zero character % is a flat run (the baseline case)", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=4\n##NPOINTS=5", "0A00%V"));
    expect(s.points.map((p) => p.y)).toEqual([100, 100, 100, 100, 100]);
  });

  test("a DUP after SQZ still repeats the VALUE (unchanged)", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0A00U"));
    expect(s.points.map((p) => p.y)).toEqual([100, 100, 100]);
  });

  test("the DIFDUP decode passes the next line's y-check (the old decode failed it)", () => {
    // Line 1: 100, 105, 110, 115, 120. Line 2 restates 120 (B20), then +5 -> 125.
    const s = spec0(xy("##FIRSTX=0\n##LASTX=5\n##NPOINTS=6", "0A00NV\n4A20N"));
    expect(s.points.map((p) => p.y)).toEqual([100, 105, 110, 115, 120, 125]);
    expect(s.corrupt).toBeFalsy();
    expect(s.caveats.join(" ")).not.toMatch(/y-check failed/);
  });
});

describe("abscissae always advance (review: NPOINTS missing stacked x as 1,1,1,1,5,5,5,5)", () => {
  test("FIRSTX/LASTX without NPOINTS: ΔX from the decoded count, x = 1…8, and said", () => {
    const s = spec0(header("##FIRSTX=1\n##LASTX=8\n##XYDATA=(X++(Y..Y))\n1 10 20 30 40\n5 50 60 70 80\n##END="));
    expect(s.points.map((p) => p.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.corrupt).toBeFalsy();
    expect(s.caveats.join(" ")).toMatch(/NPOINTS is missing: ΔX was derived from FIRSTX, LASTX and the 8 ordinates decoded/);
  });

  test("…and a line X that disagrees with that spacing marks the block corrupt", () => {
    const s = spec0(header("##FIRSTX=1\n##LASTX=8\n##XYDATA=(X++(Y..Y))\n1 10 20 30 40\n8 50 60 70 80\n##END="));
    expect(s.corrupt).toBe(true);
    expect(s.corruptReason).toMatch(/X-check failed/);
  });

  test("no spacing at all and several ordinates per line: refused, not stacked", () => {
    const r = parseJcamp(header("##XYDATA=(X++(Y..Y))\n1 10 20 30 40\n5 50 60 70 80\n##END="));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/abscissae do not advance/);
  });

  test("FIRSTX = LASTX (ΔX = 0) is refused", () => {
    const r = parseJcamp(xy("##FIRSTX=5\n##LASTX=5\n##NPOINTS=3", "5 1 2 3"));
    expect(r.ok).toBe(false);
  });
});

describe("PAC — the sign is the delimiter", () => {
  test("`0+100-20+5` is 100, −20, 5 (absolute values, not differences)", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0+100-20+5"));
    expect(s.points.map((p) => p.y)).toEqual([100, -20, 5]);
    expect(s.points.map((p) => p.x)).toEqual([0, 1, 2]);
    expect(s.corrupt).toBeFalsy();
  });

  test("PAC mixed with DUP: `0+7T-3` is 7, 7, −3", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0+7T-3"));
    expect(s.points.map((p) => p.y)).toEqual([7, 7, -3]);
  });
});

describe("the y-check value OCCUPIES its line's first abscissa", () => {
  test("the first new ordinate after a check lands at X + ΔX, not at X", () => {
    // Line 1: x 0,1,2 -> 100,110,120. Line 2 opens at X = 2 with the check 120,
    // so +10 -> 130 belongs at x = 3. The old reader put it at x = 2 (a slip of
    // one sample after every check line).
    const s = spec0(xy("##FIRSTX=0\n##LASTX=3\n##NPOINTS=4", "0A00J0J0\n2A20J0"));
    expect(s.points.map((p) => p.y)).toEqual([100, 110, 120, 130]);
    expect(s.points.map((p) => p.x)).toEqual([0, 1, 2, 3]);
  });

  test("a final line holding only the check value adds no point", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0A00J0J0\n2A20"));
    expect(s.points.map((p) => p.y)).toEqual([100, 110, 120]);
    expect(s.corrupt).toBeFalsy();
  });
});

describe("y-checks are ENFORCED: a mismatch marks the block corrupt, by line", () => {
  const bad = xy("##FIRSTX=0\n##LASTX=5\n##NPOINTS=6", "0A00J0\n1I99J0\n2A30J0\n3E00J0");

  test("the block is returned but flagged corrupt, naming the first failing line", () => {
    const s = spec0(bad);
    expect(s.corrupt).toBe(true);
    // Line numbers count from the top of the file: the header is 11 lines, so
    // the first data line is 12 and the first failing check is line 13.
    expect(s.corruptReason).toMatch(/DIF y-check failed 3 times, first at line 13/);
    expect(s.caveats[0]).toMatch(/not offered for overlay or insert/);
  });

  test("ONE summary caveat line, not one per failure", () => {
    const s = spec0(bad);
    expect(s.caveats.filter((c) => /y-check failed/.test(c))).toHaveLength(1);
    expect(s.caveats.join(" ")).toMatch(/restates 999 but the previous line decoded to 110/);
    expect(s.caveats.join(" ")).toMatch(/"1I99J0"/);
  });

  test("a corrupt block is never the default when a clean one exists", () => {
    const clean = `##TITLE=clean\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=1/CM\n##FIRSTX=0\n##LASTX=40\n##NPOINTS=41\n##XYDATA=(X++(Y..Y))\n${Array.from({ length: 41 }, (_, i) => `${i} ${i}`).join("\n")}\n##END=`;
    const r = parseJcamp(`${bad}\n${clean}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spectra[0].corrupt).toBe(true);
      expect(r.defaultIndex).toBe(1);
      expect(r.defaultReason).toMatch(/failed the file's own checks/);
    }
  });

  test("a DUP with nothing to repeat, or a DIF opening a line, is a decode failure", () => {
    expect(spec0(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0 1 2\n2ZZ")).corrupt).toBe(true);
    // The legal counterpart: 1, 2, 3 then the check 3 and a new 4 at x = 3.
    const ok = spec0(xy("##FIRSTX=0\n##LASTX=3\n##NPOINTS=4", "0 1JJ\n2 3 4"));
    expect(ok.corrupt).toBeFalsy();
    expect(ok.points.map((p) => p.y)).toEqual([1, 2, 3, 4]);
  });

  test("an unreadable character is a decode failure, not silently skipped", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0 1 2 ~ 3"));
    expect(s.corrupt).toBe(true);
    expect(s.corruptReason).toMatch(/unreadable "~"/);
  });
});

describe("AFFN with exponents (JCAMP 5.01) vs SQZ E (+5)", () => {
  test("`1 1.0E+00 2.5E-01` is two points when NPOINTS says two (it used to be six)", () => {
    const s = spec0(xy("##FIRSTX=1\n##LASTX=2\n##NPOINTS=2", "1 1.0E+00 2.5E-01"));
    expect(s.points).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 0.25 },
    ]);
    expect(s.caveats.join(" ")).toMatch(/read as exponents because that reading gives the declared 2 points/);
  });

  test("lower-case e is an exponent too (lower-case e is SQZ −5 otherwise)", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0 4.6e-05 0 1.1e-2"));
    expect(s.points.map((p) => p.y)).toEqual([4.6e-5, 0, 0.011]);
  });

  test("when NPOINTS fits neither reading, the block is REFUSED by name", () => {
    const r = parseJcamp(xy("##FIRSTX=0\n##LASTX=9\n##NPOINTS=10", "0 1E0"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Ambiguous "E" at line \d+: "0 1E0": it is either an exponent .* or the ASDF character SQZ \+5/);
  });

  test("when NPOINTS is missing, an E-line is refused rather than guessed", () => {
    const r = parseJcamp(header(`##XYDATA=(X++(Y..Y))\n0 1E0\n##END=`));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/NPOINTS is missing/);
  });

  test("SQZ wins when NPOINTS says so: `0 1E0` is 1, 50", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=1\n##NPOINTS=2", "0 1E0"));
    expect(s.points.map((p) => p.y)).toEqual([1, 50]);
  });

  test("a block with any DIF/DUP character is ASDF throughout: `2 1E0` is 1, 50 there", () => {
    const s = spec0(xy("##FIRSTX=0\n##LASTX=3\n##NPOINTS=4", "0A00J0\n1A10\n2 1E0"));
    expect(s.points.map((p) => p.y)).toEqual([100, 110, 1, 50]);
    expect(s.corrupt).toBeFalsy();
  });
});

describe("peak tables read the DECLARED tuple", () => {
  const pk = (form: string, data: string) =>
    `##TITLE=p\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n##PEAK TABLE=${form}\n${data}\n##END=`;

  test("(XYW..XYW) `1700 80 5 1200 40 3` is two triples, not three pairs", () => {
    const s = spec0(pk("(XYW..XYW)", "1700 80 5 1200 40 3"));
    expect(s.points).toEqual([
      { x: 1700, y: 80 },
      { x: 1200, y: 40 },
    ]);
    expect(s.peakExtras).toEqual([{ w: 5 }, { w: 3 }]);
    expect(s.form).toBe("peaks");
  });

  test("comma-separated triples read the same", () => {
    const s = spec0(pk("(XYW..XYW)", "1700,80,5 1200,40,3"));
    expect(s.points.map((p) => p.x)).toEqual([1700, 1200]);
  });

  test("(XYM..XYM) keeps the multiplicity letter", () => {
    const s = spec0(pk("(XYM..XYM)", "(1.24,100,T) (3.70,66,Q)"));
    expect(s.points.map((p) => p.x)).toEqual([1.24, 3.7]);
    expect(s.peakExtras!.map((e) => e.m)).toEqual(["T", "Q"]);
  });

  test("a line that is not a whole number of tuples is refused by line", () => {
    const r = parseJcamp(pk("(XYW..XYW)", "1700 80 5 1200 40"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Line 6 of the \(XYW\.\.XYW\) table holds 5 values/);
  });

  test("an undeclared tuple form is refused by name", () => {
    const r = parseJcamp(pk("(XYZQ..XYZQ)", "1 2 3 4"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/declares "\(XYZQ\.\.XYZQ\)", a form this reader does not read/);
  });

  test("(XY..XY) with an odd count is refused, not silently dropped", () => {
    const r = parseJcamp(pk("(XY..XY)", "1700 80 1200"));
    expect(r.ok).toBe(false);
  });

  test("exponents in a peak table are read as numbers", () => {
    const s = spec0(pk("(XY..XY)", "1.7E3 8E1"));
    expect(s.points).toEqual([{ x: 1700, y: 80 }]);
  });
});

describe("NTUPLES — the real page, or a refusal by name", () => {
  const ntup = (type: string, pages: string, extra = "") =>
    [
      "##TITLE=nt",
      "##JCAMP-DX=5.00",
      `##DATA TYPE=${type}`,
      "##DATA CLASS=NTUPLES",
      "##.OBSERVE FREQUENCY=100",
      "##.OBSERVE NUCLEUS=^13C",
      extra,
      `##NTUPLES=${type}`,
      "##VAR_NAME= FREQUENCY, SPECTRUM/REAL, SPECTRUM/IMAG, PAGE NUMBER",
      "##SYMBOL= X, R, I, N",
      "##VAR_TYPE= INDEPENDENT, DEPENDENT, DEPENDENT, PAGE",
      "##VAR_FORM= AFFN, ASDF, ASDF, AFFN",
      "##VAR_DIM= 4, 4, 4, 2",
      "##UNITS= HZ, ARBITRARY UNITS, ARBITRARY UNITS,",
      "##FIRST= 300, 10, 7, 1",
      "##LAST= 0, 40, 4, 2",
      "##FACTOR= 100, 1, 1, 1",
      pages,
      `##END NTUPLES=${type}`,
      "##END=",
    ]
      .filter((l) => l !== "")
      .join("\n");
  const twoPages =
    "##PAGE=N=1\n##DATA TABLE=(X++(R..R)), XYDATA $$ real\n3 10 20 30 40\n" +
    "##PAGE=N=2\n##DATA TABLE=(X++(I..I)), XYDATA $$ imaginary\n3 7 6 5 4";

  test("a two-page 1D NMR NTUPLES returns the REAL page at the declared abscissae", () => {
    // X: index 3..0 times FACTOR 100 -> 300, 200, 100, 0 Hz; R: 10, 20, 30, 40.
    const s = spec0(ntup("NMR SPECTRUM", twoPages));
    expect(s.points).toEqual([
      { x: 300, y: 10 },
      { x: 200, y: 20 },
      { x: 100, y: 30 },
      { x: 0, y: 40 },
    ]);
    expect(s.kind).toBe("nmr");
    expect(s.nucleus).toBe("13C");
    expect(s.xUnits).toBe("HZ");
    expect(s.ntuples?.unusedPages).toEqual(["N=2 (SPECTRUM/IMAG)"]);
    expect(s.caveats.join(" ")).toMatch(/real page \(N=1\) is shown; N=2 \(SPECTRUM\/IMAG\) is present and not used/);
  });

  test("the imaginary page first in the file still yields the real page", () => {
    const swapped =
      "##PAGE=N=1\n##DATA TABLE=(X++(I..I)), XYDATA\n3 7 6 5 4\n" + "##PAGE=N=2\n##DATA TABLE=(X++(R..R)), XYDATA\n3 10 20 30 40";
    expect(spec0(ntup("NMR SPECTRUM", swapped)).points.map((p) => p.y)).toEqual([10, 20, 30, 40]);
  });

  test("NMR FID is refused by name", () => {
    const r = parseJcamp(ntup("NMR FID", twoPages));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/NMR FID — needs Fourier transform and phasing; export the processed spectrum/);
  });

  test("a GC-MS NTUPLES is refused by name", () => {
    const r = parseJcamp(ntup("MASS SPECTRUM", twoPages));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/GC-MS .* export one spectrum/);
  });

  test("an nD NMR SPECTRUM is refused by name", () => {
    const r = parseJcamp(ntup("nD NMR SPECTRUM", twoPages));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/multi-dimensional/);
  });

  test("an NTUPLES whose real page cannot be identified is refused", () => {
    const r = parseJcamp(ntup("NMR SPECTRUM", "##PAGE=N=1\n##DATA TABLE=(X++(I..I)), XYDATA\n3 7 6 5 4"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no page can be identified as the real spectrum/);
  });

  test("more than 8 pages is refused before any is decoded", () => {
    const many = Array.from({ length: 9 }, (_, i) => `##PAGE=N=${i + 1}\n##DATA TABLE=(X++(R..R)), XYDATA\n3 10 20 30 40`).join("\n");
    const r = parseJcamp(ntup("NMR SPECTRUM", many));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/More than 8 NTUPLES pages/);
  });

  test("a one-point result is never ok", () => {
    const one = "##PAGE=N=1\n##DATA TABLE=(X++(R..R)), XYDATA\n0 0";
    const r = parseJcamp(ntup("NMR SPECTRUM", one));
    expect(r.ok).toBe(false);
    const r2 = parseJcamp(xy("##FIRSTX=0\n##LASTX=0\n##NPOINTS=1", "0 0"));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/Only one data point/);
  });
});

describe("header hygiene, kind and nucleus", () => {
  test("$$ comments are stripped from header values", () => {
    const s = spec0(`##TITLE=Ethanol $$ Begin of the data block\n##DATA TYPE=NMR SPECTRUM $$ x\n##XUNITS=PPM\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`);
    expect(s.title).toBe("Ethanol");
    expect(s.dataType).toBe("NMR SPECTRUM");
  });

  test(".OBSERVE NUCLEUS makes the kind NMR and names the nucleus", () => {
    const s = spec0(`##TITLE=x\n##.OBSERVE NUCLEUS= ^1H\n##XUNITS=HZ\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`);
    expect(s.kind).toBe("nmr");
    expect(s.nucleus).toBe("1H");
  });

  test("an Hz axis with no DATA TYPE is NMR (1HQuinine.jdx has neither type nor nucleus)", () => {
    const s = spec0(`##TITLE=x\n##XUNITS=\tHZ\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=\t(X++(Y..Y))\n0 1 2\n##END=`);
    expect(s.kind).toBe("nmr");
    expect(s.nucleus).toBeUndefined();
  });

  test("ION MOBILITY is not guessed into another kind", () => {
    const s = spec0(`##TITLE=x\n##DATA TYPE=ION MOBILITY SPECTRUM\n##XUNITS=MILLISECONDS\n##FIRSTX=0\n##LASTX=1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n0 1 2\n##END=`);
    expect(s.kind).toBe("unknown");
  });
});

describe("the default block: a full trace beats a peak table", () => {
  test("a 4-point peak table first, a 40-point trace second -> the trace, with the reason", () => {
    const peaks = `##TITLE=Ethanol $$ peaks\n##DATA TYPE=NMR SPECTRUM\n##XUNITS=PPM\n##PEAK TABLE=(XY..XY)\n1.2, 0.5\n1.25, 1\n1.3, 0.5\n3.7, 0.7\n##END=`;
    const trace = `##TITLE=Ethanol $$ data\n##DATA TYPE=NMR SPECTRUM\n##XUNITS=HZ\n##FIRSTX=0\n##LASTX=39\n##NPOINTS=40\n##XYDATA=(X++(Y..Y))\n${Array.from({ length: 40 }, (_, i) => `${i} ${i % 7}`).join("\n")}\n##END=`;
    const r = parseJcamp(`##TITLE=link $$ link\n##DATA TYPE=LINK\n${peaks}\n${trace}\n##END=`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spectra).toHaveLength(2);
    expect(r.spectra.map((s) => s.title)).toEqual(["Ethanol", "Ethanol"]);
    expect(r.defaultIndex).toBe(1);
    expect(r.defaultReason).toMatch(/showing block 2 \("Ethanol", NMR, 40 points\)/);
    expect(r.defaultReason).toMatch(/block 1 \("Ethanol", NMR, 4 points\)/);
  });

  test("a single-block file needs no reason", () => {
    const r = parseJcamp(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0 1 2 3"));
    expect(r.ok && r.defaultIndex === 0 && r.defaultReason === "").toBe(true);
  });
});

/**
 * CPU milliseconds spent in `f` — the bound is on the WORK, so it is measured in
 * process CPU time rather than wall time, which a loaded machine stretches.
 */
const cpuMs = (f: () => void): number => {
  const c0 = process.cpuUsage();
  f();
  const u = process.cpuUsage(c0);
  return (u.user + u.system) / 1000;
};

describe("bounds — every cap is set before the work", () => {
  test("a DUP count that would pass 2^20 points is refused at once", () => {
    let r = parseJcamp("");
    expect(cpuMs(() => (r = parseJcamp(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", "0 1s99999999999"))))).toBeLessThan(500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/DUP count .* would exceed 1,048,576 points/);
  });

  test("a declared NPOINTS above 2^20 is refused before decoding", () => {
    const r = parseJcamp(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=2000000", "0 1 2"));
    expect(r.ok).toBe(false);
  });

  test("a full 2^20-point DIF-compressed block decodes inside 4 s", () => {
    // Each line: X, the SQZ value 5 (the first point, or the y-check that
    // restates the previous line's last value), then 64 DIF steps +1/−1 that end
    // back at 5. 1 + 64·16383 = 1,048,513 points, just under 2^20.
    const L = 16383;
    const n = 1 + 64 * L;
    const lines: string[] = [];
    for (let i = 0; i < L; i++) lines.push(`${64 * i}E${"Jj".repeat(32)}`);
    const text = xy(`##FIRSTX=0\n##LASTX=${n - 1}\n##NPOINTS=${n}`, lines.join("\n"));
    let r = parseJcamp("");
    expect(cpuMs(() => (r = parseJcamp(text)))).toBeLessThan(4000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spectra[0].points.length).toBe(n);
      expect(r.spectra[0].corrupt).toBeFalsy();
    }
  });

  test("16 MB of junk on one line is refused or flagged inside 4 s, without a huge allocation", () => {
    const junk = "~".repeat(16 * 1024 * 1024);
    let r = parseJcamp("");
    expect(cpuMs(() => (r = parseJcamp(xy("##FIRSTX=0\n##LASTX=2\n##NPOINTS=3", `0 ${junk}`))))).toBeLessThan(4000);
    if (r.ok) expect(r.spectra[0].corrupt).toBe(true);
  });

  test("a truncated file (cut mid-block) is flagged by its own point count", () => {
    const full = xy("##FIRSTX=0\n##LASTX=9\n##NPOINTS=10", "0A00J0J0J0J0\n4A40J0J0J0J0J0");
    expect(spec0(full).corrupt).toBeFalsy();
    const cut = full.slice(0, full.indexOf("\n4A40"));
    const s = spec0(cut);
    expect(s.points).toHaveLength(5);
    expect(s.corrupt).toBe(true);
    expect(s.corruptReason).toMatch(/declares 10 points but 5 decoded/);
  });
});
