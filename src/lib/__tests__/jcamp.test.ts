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
