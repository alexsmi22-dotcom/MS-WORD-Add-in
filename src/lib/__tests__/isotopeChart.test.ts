import { isotopeChartSvg, isotopePeakList, ISOTOPE_CHART_SIZE } from "../isotopeChart";
import { resolveMassSpec, MassSpecResult } from "../massspec";

function spec(input: string): MassSpecResult {
  const r = resolveMassSpec(input, "auto");
  if (r.kind !== "ok") throw new Error(input);
  return r.result;
}

describe("isotope-pattern stick chart", () => {
  it("draws ferrocene with M marked and M−2 labelled", () => {
    const s = spec("C10H10Fe");
    const svg = isotopeChartSvg(s)!;
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("Isotope pattern — C₁₀H₁₀Fe");
    expect(svg).toContain(">M (monoisotopic)<");
    // Legend labels fit (plot.ts truncates an overlong one with "…").
    expect(svg).not.toMatch(/>[^<]*…<\/text>/);
    // No stick sits on the plot frame: the baseline pads the x range.
    const frame = /<rect x="(\d+(?:\.\d+)?)" y="\d+" width="(\d+(?:\.\d+)?)"[^>]*fill="none"/.exec(svg)!;
    const left = Number(frame[1]);
    const right = left + Number(frame[2]);
    for (const m of svg.matchAll(/<path d="M(\d+(?:\.\d+)?),[\d.]+ L(\d+(?:\.\d+)?),[\d.]+" fill="none" stroke="#(?:2563eb|dc2626)"/g)) {
      expect(Number(m[1])).toBeGreaterThan(left + 1);
      expect(Number(m[1])).toBeLessThan(right - 1);
    }
    expect(svg).toContain("isotopologue peaks");
    expect(svg).toContain("#dc2626");
    expect(svg).toContain("M−2 184.0179");
    expect(svg).toContain("m/z");
    // No ASCII hyphen-minus label like "M-2".
    expect(svg).not.toMatch(/M-\d/);
  });

  it("no peak entry is split across note lines", () => {
    for (const f of ["C10H10Fe", "SnCl4", "C254H377N65O75S6", "Cl2H6N2Pt"]) {
      const s = spec(f);
      const svg = isotopeChartSvg(s)!;
      const lines = [...svg.matchAll(/<text x="8" y="[\d.]+"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
      const shown = s.pattern.filter((p) => lines.some((l) => l.includes(p.label + " ")));
      for (const p of shown) {
        const entry = `${p.label} ${p.mass.toFixed(4)} (`;
        expect({ f, entry, whole: lines.some((l) => l.includes(entry)) }).toEqual({ f, entry, whole: true });
      }
    }
  });

  it("the peak list matches the pattern, in order", () => {
    const s = spec("Cl2H6N2Pt");
    const list = isotopePeakList(s.pattern);
    expect(list.split(" · ")).toHaveLength(s.pattern.length);
    expect(list).toContain("M+1 299.9534 (100.0 %)");
  });

  it("states what is cut", () => {
    const s = spec("C254H377N65O75S6");
    expect(isotopeChartSvg(s)!).toContain("further peaks below 0.1");
  });

  it("a single-peak pattern still draws; an empty one is null", () => {
    expect(isotopeChartSvg(spec("Pa"))).toMatch(/^<svg/);
    expect(isotopeChartSvg({ formula: "C", pattern: [] })).toBeNull();
  });

  it("declares its size from the canvas plot.ts built", () => {
    const svg = isotopeChartSvg(spec("FeCl3"))!;
    const w = Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)![1]);
    expect(w).toBeGreaterThanOrEqual(ISOTOPE_CHART_SIZE.width);
  });

  it("a very long formula is truncated in the title, never run off the canvas", () => {
    const s = spec("C254H377N65O75S6");
    const svg = isotopeChartSvg({ ...s, formula: s.formula + "Fe".repeat(30) })!;
    expect(svg).toContain("…");
  });
});
