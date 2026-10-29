// Independent review of the colour section, 2026-10-29 (findings-colour.md: 6 MAJOR, 11 MINOR). One regression per
// finding, on the reviewer's own repro, run through the calculators the pane registers.
import * as fs from "fs";
import * as path from "path";
import { COLOUR_CALCS } from "../colourCalcs";
import { illuminant1nm, whitePoint } from "../colourScience";
import type { AnalyzeOutput } from "../analyzeBlocks";

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = COLOUR_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const firstLine = (o: AnalyzeOutput): string => o.text.split("\n")[0];
const out = (o: AnalyzeOutput, key: string): number => {
  const e = (o.outputs ?? []).find((x) => x.key === key);
  if (!e) throw new Error(`no output ${key}`);
  return e.value;
};
const plots = (o: AnalyzeOutput): string[] => (o.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { svg: string }).svg);
const captions = (o: AnalyzeOutput): string[] => (o.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { caption: string }).caption);
const ok = (o: AnalyzeOutput): void => expect({ ok: o.ok, text: o.ok === false ? o.text : "" }).toEqual({ ok: undefined, text: "" });
const refused = (o: AnalyzeOutput, re: RegExp): void => {
  expect(o.ok).toBe(false);
  expect(o.text).toMatch(re);
  expect(o.text.replace(/"[^"\n]*"/g, '""')).not.toMatch(/\d[eE][+-]?\d|NaN|Infinity/);
};
const frameOf = (svg: string): { w: number; h: number } => {
  const m = /<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)" fill="none" stroke="#888"/.exec(svg);
  if (!m) throw new Error("no plot frame");
  return { w: Number(m[1]), h: Number(m[2]) };
};
const SPECTRAL_DEFAULT = COLOUR_CALCS.find((c) => c.id === "colour-spectral")!.fields.find((f) => f.key === "data")!.default;

describe("MAJOR 1: the hue word follows the sample's direction of travel", () => {
  test("86° to 93° (std 80, 2.8, 40; sample 80, −2.1, 40.2) reads toward green, as Δa* says greener", () => {
    const o = run("colour-difference", { std: "80, 2.8, 40", smp: "80, -2.1, 40.2" });
    expect(firstLine(o)).toMatch(/shifted toward green/);
    expect(firstLine(o)).not.toMatch(/toward yellow/);
    expect(o.text).toMatch(/greener \(Δa\* −4\.90\)/);
  });
  test("a turn of more than 90° gets no hue word", () => {
    expect(firstLine(run("colour-difference", { std: "50, 20, 5", smp: "50, -20, 5", tol: "" }))).not.toMatch(/toward/);
  });
  test("the default still reads toward yellow (28° to 31°)", () => {
    expect(firstLine(run("colour-difference"))).toMatch(/shifted toward yellow/);
  });
});

describe("MAJOR 2: the a*b* plane is drawn at equal scales", () => {
  test("std 40, 10, −60 and sample 41, 12, −57: a square frame over a window symmetric about the origin", () => {
    const svg = plots(run("colour-difference", { std: "40, 10, -60", smp: "41, 12, -57" }))[0];
    const f = frameOf(svg);
    expect(Math.abs(f.w - f.h)).toBeLessThan(1.5);
    const ticks = [...svg.matchAll(/>(−?\d+)<\/text>/g)].map((m) => Number(m[1].replace("−", "-")));
    expect(Math.min(...ticks)).toBe(-Math.max(...ticks));
  });
  test("the close-up is square too", () => {
    const f = frameOf(plots(run("colour-difference", { std: "40, 10, -60", smp: "41, 12, -57", tol: "1" }))[1]);
    expect(Math.abs(f.w - f.h)).toBeLessThan(1.5);
  });
});

describe("MAJOR 3 and MINOR 11: no broken contour at large ΔE, and fast", () => {
  test("tolerance 100: no region drawn, the figure and caption say why, under 300 ms", () => {
    const t0 = Date.now();
    const o = run("colour-difference", { tol: "100" });
    expect(Date.now() - t0).toBeLessThan(300);
    expect(plots(o)[1]).not.toMatch(/ΔE₀₀ = 100\.00/);
    expect(plots(o)[1]).toMatch(/No region drawn/);
    expect(captions(o)[1]).toMatch(/no region drawn/);
  });
  test("tolerance 50 around a neutral standard: no partial ring", () => {
    expect(plots(run("colour-difference", { std: "50, 0, 0", tol: "50" }))[1]).not.toMatch(/ΔE₀₀ = 50\.00/);
  });
  test("an ordinary tolerance still draws its closed region", () => {
    expect(plots(run("colour-difference"))[1]).toMatch(/ΔE₀₀ = 2\.00/);
  });
});

describe("MAJOR 4: the adaptation spread is the largest pairwise disagreement", () => {
  test("defaults: within ΔE₀₀ 1.16 (von Kries against CAT02), not 1.10", () => {
    const o = run("colour-adapt");
    expect(firstLine(o)).toMatch(/agree to within ΔE₀₀ 1\.16\./);
    expect(out(o, "spread")).toBeGreaterThan(1.155);
  });
});

describe("MAJOR 5: white points are the CIE 15 / ASTM E308 whites", () => {
  test("D65 2° is 95.047, 100, 108.883; D65 10° is 94.811, 100, 107.304 (to 10⁻³)", () => {
    const w2 = whitePoint("D65", "2");
    expect(Math.abs(w2[0] - 95.047)).toBeLessThan(5e-4);
    expect(Math.abs(w2[2] - 108.883)).toBeLessThan(5e-4);
    const w10 = whitePoint("D65", "10");
    expect(Math.abs(w10[0] - 94.811)).toBeLessThan(1e-3);
    expect(Math.abs(w10[2] - 107.304)).toBeLessThan(1e-3);
  });
  test("the conversion prints that white and says where it comes from", () => {
    expect(run("colour-convert").text).toMatch(/XYZ \(95\.047, 100, 108\.883\).*perfect diffuser/);
  });
});

describe("MAJOR 6: batch QC reads common pastes", () => {
  test("a header row is skipped and said so", () => {
    const o = run("colour-batch", { data: "Name\tL*\ta*\tb*\nB1\t45.3\t51.6\t28.4" });
    ok(o);
    expect(out(o, "n")).toBe(1);
    expect(o.text).toMatch(/read as a header and skipped/);
  });
  test("numeric sample IDs are names", () => {
    const o = run("colour-batch", { data: "101 45.3 51.6 28.4\n102 44.8 52.4 27.7" });
    ok(o);
    expect(out(o, "n")).toBe(2);
    expect(o.text).toMatch(/\n101\s+\+0\.30/);
  });
  test("five numbers in a row are still refused, and a short row is not taken for a header", () => {
    refused(run("colour-batch", { data: "1 2 45.3 51.6 28.4" }), /more than four numbers/);
    refused(run("colour-batch", { data: "B1 45, 52" }), /three numbers/);
  });
});

describe("MINOR 1: the near-threshold WCAG sentence cites its own threshold", () => {
  const find = (t: number): number[] | null => {
    const L = (v: number): number => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    for (let g = 0; g < 256; g++) {
      for (const bg of [255, 0]) {
        const r = (Math.max(L(g), L(bg)) + 0.05) / (Math.min(L(g), L(bg)) + 0.05);
        if (Math.abs(r - t) < 0.01) return [g, bg];
      }
    }
    return null;
  };
  test.each([[3], [7]])("near %s:1", (t) => {
    const p = find(t);
    expect(p).not.toBeNull();
    const o = run("colour-contrast", { fg: `${p![0]}, ${p![0]}, ${p![0]}`, bg: `${p![1]}, ${p![1]}, ${p![1]}` });
    expect(o.text).toMatch(new RegExp(`within 0\\.01 of the ${t}:1 threshold`));
    expect(o.text).not.toMatch(/4\.5:1 regardless/);
  });
});

describe("MINOR 2: kL:kC:kH bounded to 0.1–10", () => {
  test.each([["1000:1000:1000"], ["1e-30:1:1"], ["0.0001:0.0001:0.0001"]])("%s is refused", (k) => {
    refused(run("colour-difference", { k }), /outside 0\.1 to 10/);
  });
  test("batch with k 10⁶ is refused too", () => refused(run("colour-batch", { k: "1000000:1000000:1000000" }), /outside 0\.1 to 10/));
});

describe("MINOR 3: no e-notation in a refusal", () => {
  test('"1e308, 1, 2" is refused with ×10ⁿ', () => {
    const o = run("colour-difference", { std: "1e308, 1, 2" });
    expect(o.ok).toBe(false);
    expect(o.text).not.toMatch(/\d[eE][+-]?\d/);
    expect(o.text).toMatch(/×10³⁰⁸/);
  });
});

describe("MINOR 4: no dominant wavelength at zero purity", () => {
  test("#808080 under D50/10° is achromatic, not 604 nm, and has no hue", () => {
    const o = run("colour-convert", { from: "hex", val: "#808080", ill: "D50", obs: "10" });
    expect(o.text).not.toMatch(/Dominant wavelength \d+ nm/);
    expect(o.text).toMatch(/Achromatic/);
    expect(firstLine(o)).toMatch(/no hue \(neutral\)/);
  });
  test("a near-white spectrum reports no dominant wavelength", () => {
    const flat = Array.from({ length: 36 }, (_, i) => `${380 + 10 * i} 0.800`).join("\n");
    const o = run("colour-spectral", { data: flat });
    expect(o.text).not.toMatch(/dominant wavelength \d+ nm/i);
    expect((o.outputs ?? []).some((x) => x.key === "domwl")).toBe(false);
  });
});

describe("MINOR 5: imaginary colours are refused", () => {
  test("L*a*b* 10, 150, −150 is not a real colour", () => refused(run("colour-convert", { val: "10, 150, -150" }), /not a real colour/));
  test("the same in a colour difference and a batch", () => {
    refused(run("colour-difference", { smp: "10, 150, -150" }), /not a real colour/);
    refused(run("colour-batch", { data: "B1 10, 150, -150" }), /not a real colour/);
  });
  test("an out-of-gamut but real colour is still converted", () => ok(run("colour-convert", { val: "60, -90, 70" })));
});

describe("MINOR 6: common formats are read", () => {
  test('"L*=50, a*=10, b*=5" and "L* 50 a* 10 b* 5" read as 50, 10, 5', () => {
    const c = out(run("colour-difference", { std: "50, 10, 5" }), "de00");
    for (const s of ["L*=50, a*=10, b*=5", "L* 50 a* 10 b* 5"]) {
      const o = run("colour-difference", { std: s });
      ok(o);
      expect(out(o, "de00")).toBe(c);
    }
  });
  test('"rgb(119, 119, 119)" and "0xFFAA00"', () => {
    expect(firstLine(run("colour-convert", { from: "srgb", val: "rgb(119, 119, 119)" }))).toMatch(/#777777/);
    expect(firstLine(run("colour-convert", { from: "hex", val: "0xFFAA00" }))).toMatch(/#FFAA00/);
  });
  test("a spectrum written with % signs is read as percent", () => {
    const pct = SPECTRAL_DEFAULT.split("\n").map((r) => {
      const [w, v] = r.split(" ");
      return `${w} ${(Number(v) * 100).toFixed(2)}%`;
    }).join("\n");
    const o = run("colour-spectral", { data: pct });
    ok(o);
    expect(out(o, "L")).toBeCloseTo(out(run("colour-spectral"), "L"), 9);
    expect(o.text).toMatch(/% sign/);
  });
});

describe("MINOR 7: a lightness-only failure is explained", () => {
  test("a sample 4 units lighter fails; the text and the close-up say ΔL* is not in the a*b* view", () => {
    const o = run("colour-batch", { data: "B1 49, 52, 28" });
    expect(o.text).toMatch(/Failing mainly on lightness/);
    expect(plots(o)[0]).toMatch(/fail on ΔL\* alone/);
  });
});

describe("MINOR 8: chromaticity figures name their observer and the purple line", () => {
  test("10°: CIE 1964 x₁₀y₁₀, no 2° sRGB triangle, 20 nm marks", () => {
    const o = run("colour-spectral");
    expect(captions(o)[1]).toMatch(/CIE 1964 x₁₀y₁₀/);
    expect(plots(o)[1]).toMatch(/x₁₀/);
    expect(plots(o)[1]).not.toMatch(/sRGB gamut/);
    expect(plots(o)[1]).toMatch(/every 20 nm/);
  });
  test("a purple's line is labelled as ending on the purple line (2°, with the sRGB triangle)", () => {
    const purple = Array.from({ length: 36 }, (_, i) => `${380 + 10 * i} ${(380 + 10 * i < 470 || 380 + 10 * i > 620 ? 0.6 : 0.08).toFixed(3)}`).join("\n");
    const svg = plots(run("colour-spectral", { data: purple, obs: "2" }))[1];
    expect(svg).toMatch(/purple line/);
    expect(svg).toMatch(/sRGB gamut/);
  });
});

describe("MINOR 9: figure styles are not applied to Engineering figures, as for every Engineering tool", () => {
  test("the pane's figure-style modes do not include engineering", () => {
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    const m = /const FIGURE_STYLE_MODES = new Set<string>\(\[([^\]]*)\]\)/.exec(pane);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/engineering/);
  });
});

describe("MINOR 10: illuminant A is computed from its defining formula at 1 nm", () => {
  test("A at 361 nm is Planck's law exactly; its whites are E308's 109.850, 35.585 (2°) and 111.144, 35.200 (10°)", () => {
    const planck = (nm: number): number => (100 * (560 / nm) ** 5 * Math.expm1(1.435e7 / (2848 * 560))) / Math.expm1(1.435e7 / (2848 * nm));
    expect(illuminant1nm("A")[1]).toBe(planck(361));
    const w2 = whitePoint("A", "2");
    expect(Math.abs(w2[0] - 109.85)).toBeLessThan(1e-3);
    expect(Math.abs(w2[2] - 35.585)).toBeLessThan(1e-3);
    const w10 = whitePoint("A", "10");
    expect(Math.abs(w10[0] - 111.144)).toBeLessThan(1.5e-3);
    expect(Math.abs(w10[2] - 35.2)).toBeLessThan(1e-3);
  });
});
