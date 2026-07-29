// Round-three regressions, all found by an independent review of round-two's
// FIXES. Three rounds, three sets of defects in the previous round's repairs.
//
// The one worth reading twice is the NaN band. v2.37.1 added a test asserting
// the SVG contains no NaN — at `settle=1e400`, where EVERYTHING overflows and
// the panel bails cleanly. The identical assertion failed at 1e299, 1e300 and
// 1e305, including at the repo's own standard test EI. A green test certifying a
// band it does not sample is the same shape as the qToNumber band that the same
// release's commit message was written about.

import { analyzeBeam, BeamInput, BeamResult, Support, Load } from "../beam";
import { beamDiagramSvg } from "../beamChart";
import { Rat, ratInt, ratDiv, parseRatLiteral } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
const X = (s: string): Rat => parseRatLiteral(s) as Rat;
const LOADS: Load[] = [{ kind: "udl", a: R(0), b: R(8), w: R(5) }];

function svgFor(supports: Support[], ei: Rat | null): string {
  const input: BeamInput = { length: R(8), supports, loads: LOADS, ei };
  const r = analyzeBeam(input);
  if (!r.ok) throw new Error(r.error);
  return beamDiagramSvg({
    result: r as BeamResult,
    supports,
    loads: LOADS,
    forceUnit: "kN",
    momentUnit: "kN·m",
    lengthUnit: "m",
  });
}

describe("the NaN band the previous test stepped over", () => {
  // 1e400 was the only magnitude sampled before, and it passes for the wrong
  // reason: everything overflows, so the panel bails. These are the ones where
  // SOME samples survive and the derived SCALE is what overflows.
  test.each(["1e295", "1e299", "1e300", "1e305", "1e308", "1e400"])(
    "settle=%s emits no NaN or Infinity into the document",
    (v) => {
      for (const ei of ["2.4e5", "2.1e11"]) {
        const svg = svgFor(
          [
            { kind: "fixed", x: R(0) },
            { kind: "roller", x: R(8), settle: X(v) },
          ],
          X(ei),
        );
        expect({ v, ei, bad: /NaN|Infinity|undefined/.test(svg) }).toEqual({ v, ei, bad: false });
      }
    },
  );

  test("a panel that cannot be drawn says so rather than drawing a dot", () => {
    // Two SURVIVING samples that are coincident at x = L used to satisfy a
    // `length < 2` guard and draw `M 404 142 L 404 142`.
    const svg = svgFor(
      [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8), settle: X("1e300") },
      ],
      X("2.1e11"),
    );
    expect(svg).toMatch(/not finite at this scale|out of range at this scale/);
    // and no degenerate single-point path
    expect(svg).not.toMatch(/M (\d+\.\d) (\d+\.\d) L \1 \2"/);
  });

  test("ordinary beams still draw a real curve", () => {
    const svg = svgFor([{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }], null);
    expect(svg).not.toMatch(/not finite|out of range/);
    expect((svg.match(/ L /g) || []).length).toBeGreaterThan(50);
  });
});

describe("the settlement label never leaves the viewBox", () => {
  const W = 420;

  test.each(["0.01", "-0.0125", "1e-9", "-1.2345e-5", "1.23e300", "-1.23e300", "123456.789"])(
    "settle=%s stays inside at every support position",
    (v) => {
      // Sweeps the band the previous test skipped: it sampled x in {0,1,4,7,8}
      // and the overflow happens between 7.3 and 7.6.
      for (let i = 0; i <= 40; i++) {
        const pos = (8 * i) / 40;
        if (pos === 0) continue;
        const supports: Support[] = [
          { kind: "fixed", x: R(0) },
          { kind: "roller", x: ratDiv(ratInt(BigInt(i)), ratInt(5n)), settle: X(v) },
        ];
        const svg = svgFor(supports, X("2.4e5"));
        const head = svg.slice(0, svg.indexOf("<path") >= 0 ? svg.indexOf("<path") : svg.length);
        const m = /<text x="([\d.-]+)" y="[\d.-]+" text-anchor="(start|end)" font-size="7\.5"[^>]*>([^<]*)</.exec(head);
        if (!m) continue;
        const lx = parseFloat(m[1]);
        const wEst = m[3].length * 4.3 + 6;
        const left = m[2] === "end" ? lx - wEst : lx;
        const right = m[2] === "end" ? lx : lx + wEst;
        expect({ v, pos, inside: left >= 0 && right <= W }).toEqual({ v, pos, inside: true });
      }
    },
  );
});

describe("the EI-dependence twin is cheap", () => {
  test("the probe does only the solve, not the sampling", () => {
    const loads: Load[] = [];
    for (let i = 0; i < 24; i++)
      loads.push({ kind: "ramp", a: R(i % 7), b: R((i % 7) + 1), w1: R(i), w2: R(i + 2) });
    const supports: Support[] = [{ kind: "fixed", x: R(0) }];
    for (let i = 1; i <= 5; i++) supports.push({ kind: "roller", x: R(i), k: X("5e4") });
    supports.push({ kind: "roller", x: R(8), settle: X("0.01") });
    const input: BeamInput = { length: R(8), supports, loads, ei: X("2.1e11") };

    analyzeBeam(input, true); // warm
    const t0 = Date.now();
    analyzeBeam(input, true);
    const probeMs = Date.now() - t0;
    const t1 = Date.now();
    const full = analyzeBeam(input, false);
    const fullMs = Date.now() - t1;

    expect(full.ok).toBe(true);
    // The twin adds one probe to a full solve. If the probe ever costs a large
    // fraction of the full result again, the short-circuit has been lost and
    // every elastic beam is paying double in a per-keystroke pane.
    expect({ probeCheaper: probeMs * 4 < fullMs || probeMs < 30 }).toEqual({ probeCheaper: true });
  });

  test("a probe result refuses to be used as an answer", () => {
    const r = analyzeBeam(
      {
        length: R(8),
        supports: [
          { kind: "fixed", x: R(0) },
          { kind: "roller", x: R(8), k: X("5e4") },
        ],
        loads: LOADS,
        ei: X("2.4e5"),
      },
      true,
    );
    if (!r.ok) throw new Error(r.error);
    // Reactions are real; everything derived from sampling is inert and throws
    // rather than returning a plausible zero.
    expect(r.reactions.length).toBe(2);
    expect(() => r.shearAt(4)).toThrow(/probe/i);
    expect(() => r.momentAt(4)).toThrow(/probe/i);
  });

  test("the probe's reactions equal the real solve's", () => {
    const input: BeamInput = {
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8), k: X("5e4") },
      ],
      loads: LOADS,
      ei: X("2.4e5"),
    };
    const a = analyzeBeam(input, true);
    const b = analyzeBeam(input, false);
    if (!a.ok || !b.ok) throw new Error("failed");
    for (let i = 0; i < 2; i++)
      expect(`${a.reactions[i].forceExact.n}/${a.reactions[i].forceExact.d}`).toBe(
        `${b.reactions[i].forceExact.n}/${b.reactions[i].forceExact.d}`,
      );
  });
});

describe("messages fit the input they are given", () => {
  test("a lone pin is not told to add a pin", () => {
    const r = analyzeBeam({ length: R(8), supports: [{ kind: "pin", x: R(0) }], loads: LOADS });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/mechanism/i);
      expect(r.error).not.toMatch(/Add a pin or a fixed support/);
    }
  });

  test("the x-axis label sits inside the declared height, descenders included", () => {
    const svg = svgFor([{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }], null);
    const h = parseFloat(/height="([\d.]+)"/.exec(svg)![1]);
    const ys = [...svg.matchAll(/<text x="[\d.-]+" y="([\d.-]+)"/g)].map((m) => parseFloat(m[1]));
    // +3 for descender depth at 9px.
    expect(Math.max(...ys) + 3).toBeLessThanOrEqual(h);
  });
});
