// The Colour & appearance calculators (colourCalcs.ts) as the pane runs them: every default computes, draws, opens
// with a plain-language reading that keeps calcReading.ts's rules, and meets the display contract; the defaults print
// the values colour-science 0.4.7 gives (scripts/colour-oracle.py checks the engine itself); and bad input is refused
// by name — non-finite numbers, impossible L*, empty and malformed blocks, unsorted, duplicate and irregular
// wavelengths, percentages typed as fractions, unknown illuminants.
import { COLOUR_CALCS } from "../colourCalcs";
import { readingProblems } from "../calcReading";
import { hasNonFinite } from "../finiteResult";
import type { AnalyzeOutput } from "../analyzeBlocks";
import { mathToOmml } from "../mathOmml";
import { mathToHtml } from "../mathHtml";

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
function contractBreaks(text: string): string[] {
  const b: string[] = [];
  if (/\^/.test(text)) b.push("caret");
  if (/\d[eE][+-]?\d/.test(text)) b.push("e-notation");
  if (/\bnot finite\b|(?<![\p{L}\p{N}])(?:NaN|Infinity|undefined)(?![\p{L}\p{N}])/u.test(text)) b.push("non-finite");
  if (/—/.test(text)) b.push("em dash");
  if (/(^|[\s(=,:])-\d/.test(text)) b.push("hyphen-minus");
  if (/−0\.0+(?!\d)/.test(text)) b.push("negative zero");
  return b;
}
const ok = (o: AnalyzeOutput): void => {
  expect({ ok: o.ok, text: o.ok === false ? o.text : "" }).toEqual({ ok: undefined, text: "" });
  expect(contractBreaks(o.text)).toEqual([]);
  expect(hasNonFinite(o)).toBe(false);
};
const refused = (o: AnalyzeOutput, re: RegExp): void => {
  expect(o.ok).toBe(false);
  expect(o.text).toMatch(re);
  // A refusal may echo the user's own input in straight quotes (the insert gate's rule: quoted spans are input).
  expect(contractBreaks(o.text.replace(/"[^"\n]*"/g, '""'))).toEqual([]);
};

describe("registry", () => {
  test("eight calculators, unique ids, one group, the domain unit contract", () => {
    expect(COLOUR_CALCS.map((c) => c.id)).toEqual([
      "colour-difference", "colour-batch", "colour-convert", "colour-spectral", "colour-metamerism", "colour-adapt", "colour-whiteness", "colour-contrast",
    ]);
    for (const c of COLOUR_CALCS) {
      expect(c.group).toBe("Colour & appearance");
      expect(c.unitContract).toBe("domain");
      expect(c.hint.length).toBeGreaterThan(80);
      for (const f of c.fields) if (f.kind === "select") expect(f.options?.some((o) => o.value === f.default)).toBe(true);
    }
  });
  test.each(COLOUR_CALCS.map((c) => [c.id]))("%s: defaults compute, draw, and open with a reading that keeps the rules", (id) => {
    const o = run(id);
    ok(o);
    const plots = (o.blocks ?? []).filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThan(0);
    for (const p of plots) {
      const svg = (p as { svg: string }).svg;
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect(readingProblems(firstLine(o))).toEqual([]);
    expect(firstLine(o)).toMatch(/\d/);
  });
});

describe("defaults print colour-science's values", () => {
  test("colour difference: ΔE₀₀ 2.15, ΔE*ab 3.48, ΔE*94 2.04 / 1.81, CMC 2.18 / 2.40; FAIL on ΔE₀₀ < 2 and the ambiguity named", () => {
    const o = run("colour-difference");
    expect(out(o, "de00")).toBeCloseTo(2.14940064051, 9);
    expect(out(o, "de76")).toBeCloseTo(3.47850542619, 9);
    expect(out(o, "de94g")).toBeCloseTo(2.0434086354, 9);
    expect(out(o, "cmc21")).toBeCloseTo(2.17524207585, 9);
    expect(o.text).toMatch(/ΔE CMC\(1:1\)\s+2\.40/);
    expect(o.text).toMatch(/ΔE\*94 textiles\s+1\.81/);
    expect(o.text).toContain("As a claim limitation: ΔE₀₀ = 2.15 (CIEDE2000, kL:kC:kH = 1:1:1; D65/10°; d/8° SCI; standard → sample).");
    expect(o.text).toContain("Tolerance ΔE₀₀ < 2: FAIL");
    expect(o.text).toMatch(/OPPOSITE verdict on ΔE\*94 \(CIE94, textiles\) \(1\.81\)/);
    expect(firstLine(o)).toBe("The sample is slightly lighter, a little duller and shifted toward yellow; the difference is clearly visible side by side (ΔE₀₀ 2.15).");
  });
  test("conversion: L*a*b* (52, 42.5, 20.1) D65/2° is XYZ 28.7410, 20.1443, 12.4788 and sRGB 197, 91, 92 = #C55B5C", () => {
    const o = run("colour-convert");
    expect(out(o, "X")).toBeCloseTo(28.74095626, 7);
    expect(o.text).toContain("28.7410, 20.1443, 12.4788");
    expect(o.text).toContain("#C55B5C");
    expect(o.text).toMatch(/inside the sRGB gamut/);
  });
  test("spectral: ColorChecker orange under D65/10° (ASTM E308) is L*a*b* 59.92, 34.30, 53.89, 587 nm at 75.4 % purity", () => {
    const o = run("colour-spectral");
    expect(out(o, "L")).toBeCloseTo(59.92459255, 7);
    expect(out(o, "a")).toBeCloseTo(34.29617007, 7);
    expect(out(o, "b")).toBeCloseTo(53.88788503, 7);
    expect(out(o, "domwl")).toBe(587);
    expect(out(o, "purity")).toBeCloseTo(0.7536025826, 8);
  });
  test("adaptation: Lab (50, 20, −30) D50 → D65 by Bradford is (50.25, 22.92, −29.82)", () => {
    const o = run("colour-adapt");
    expect(out(o, "L")).toBeCloseTo(50.25169873, 7);
    expect(out(o, "a")).toBeCloseTo(22.91594548, 7);
    expect(out(o, "b")).toBeCloseTo(-29.81581253, 7);
  });
  test("whiteness: XYZ (93, 98, 115) D65/10° gives W 124.17, T +1.93, YI −11.43", () => {
    const o = run("colour-whiteness");
    expect(out(o, "W")).toBeCloseTo(124.17430065, 7);
    expect(out(o, "T")).toBeCloseTo(1.92852288, 7);
    expect(out(o, "yiD65")).toBeCloseTo(-11.4347959184, 8);
  });
  test("contrast: #777777 on white is 4.48:1 and fails AA normal text, passes large", () => {
    const o = run("colour-contrast");
    expect(out(o, "ratio")).toBeCloseTo(4.478089453577214, 9);
    expect(firstLine(o)).toMatch(/4\.48:1: it fails WCAG AA for normal text/);
  });
  test("metamerism: the synthetic metamer matches under D65 and is metameric under A, F11 and F2", () => {
    const o = run("colour-metamerism");
    expect(out(o, "ref")).toBeLessThan(0.05);
    expect(out(o, "miA")).toBeGreaterThan(1);
    expect(firstLine(o)).toMatch(/metameric/);
  });
  test("batch: 7 of 8 pass, B5 is the worst", () => {
    const o = run("colour-batch");
    expect(out(o, "pass")).toBe(7);
    expect(firstLine(o)).toMatch(/^7 of 8 samples pass ΔE₀₀ < 2; the worst is B5/);
  });
});

describe("colour difference: hue geometry and the edge cases", () => {
  test("a neutral pair has no hue: no hue words, ΔH 0, Δhab undefined", () => {
    const o = run("colour-difference", { std: "50, 0, 0", smp: "52, 0, 0", tol: "" });
    ok(o);
    expect(firstLine(o)).toMatch(/^The sample is lighter;/);
    expect(firstLine(o)).not.toMatch(/toward/);
    expect(o.text).toMatch(/hab \(°\)\s+none \(neutral\)/);
  });
  test("identical colours: ΔE 0 everywhere, said so", () => {
    const o = run("colour-difference", { smp: "45.00, 52.00, 28.00" });
    ok(o);
    expect(firstLine(o)).toMatch(/^The standard and the sample are identical/);
    expect(out(o, "de00")).toBe(0);
  });
  test("hue wraparound across 0°/360°: Δhab is +1.9°, not −358°, and ΔH*ab is small and positive", () => {
    const o = run("colour-difference", { std: "60, 10, -0.2", smp: "60, 10, 0.13" });
    ok(o);
    expect(o.text).toMatch(/Δhab \+1\.9°/);
    expect(out(o, "dH")).toBeGreaterThan(0);
    expect(out(o, "dH")).toBeLessThan(0.4);
  });
  test("negative a* (green): moving from 170° to 175° is toward blue? no: toward green at 180°", () => {
    const o = run("colour-difference", { mode: "lch", std: "50, 30, 170", smp: "50, 30, 175" });
    ok(o);
    expect(firstLine(o)).toMatch(/shifted toward green/);
  });
  test("L*C*h input equals the L*a*b* it describes", () => {
    const a = run("colour-difference", { mode: "lch", std: "50, 10, 90", smp: "50, 10, 0" });
    const b = run("colour-difference", { std: "50, 0, 10", smp: "50, 10, 0" });
    expect(out(a, "de00")).toBeCloseTo(out(b, "de00"), 12);
  });
  test("asymmetry: swapping changes ΔE*94 and CMC, never ΔE*ab or ΔE₀₀", () => {
    const a = run("colour-difference");
    const b = run("colour-difference", { std: "46.20, 49.50, 30.10", smp: "45.00, 52.00, 28.00" });
    expect(out(a, "de00")).toBeCloseTo(out(b, "de00"), 12);
    expect(out(a, "de76")).toBeCloseTo(out(b, "de76"), 12);
    expect(Math.abs(out(a, "de94g") - out(b, "de94g"))).toBeGreaterThan(1e-3);
    expect(Math.abs(out(a, "cmc21") - out(b, "cmc21"))).toBeGreaterThan(1e-3);
  });
  test("a tolerance that ties at two decimals is called borderline and shown to four", () => {
    const o = run("colour-difference", { tol: "2.15", op: "<" });
    expect(o.text).toMatch(/Borderline/);
    expect(o.text).toMatch(/ΔE₀₀ = 2\.1494/);
  });
  test("an unstated geometry is flagged for the claim", () => {
    const o = run("colour-difference", { geom: "none" });
    expect(o.text).toMatch(/geometry is not stated/);
  });
  test("≤ and < decide differently exactly at the limit", () => {
    expect(run("colour-difference", { std: "50, 0, 0", smp: "52, 0, 0", tolf: "de76", tol: "2", op: "<" }).text).toMatch(/: FAIL/);
    expect(run("colour-difference", { std: "50, 0, 0", smp: "52, 0, 0", tolf: "de76", tol: "2", op: "≤" }).text).toMatch(/: PASS/);
  });
});

describe("refusals", () => {
  test.each([
    ["NaN", { std: "NaN, 1, 2" }, /not a list of numbers/],
    ["Infinity", { std: "1e400, 1, 2" }, /finite/],
    ["two numbers", { std: "50, 1" }, /exactly three numbers/],
    ["negative L*", { std: "-5, 1, 2" }, /below 0/],
    ["huge L*", { smp: "500, 1, 2" }, /above 110/],
    ["huge a*", { smp: "50, 900, 2" }, /outside ±200/],
    ["negative chroma", { mode: "lch", std: "50, -3, 20" }, /negative/],
    ["bad k", { k: "1:0:1" }, /three positive numbers/],
    ["bad tolerance", { tol: "-1" }, /not a positive number/],
  ])("colour difference: %s", (_n, over, re) => refused(run("colour-difference", over as Record<string, string>), re));

  const spec10 = (from: number, to: number, f: (w: number) => number = () => 0.5): string => {
    const r: string[] = [];
    for (let w = from; w <= to; w += 10) r.push(`${w} ${f(w)}`);
    return r.join("\n");
  };
  test.each([
    ["empty block", { data: "" }, /empty/],
    ["one column", { data: "380\n390" }, /exactly two numbers/],
    ["percent typed as fraction", { data: spec10(380, 730, () => 55) }, /PERCENTAGE/],
    ["too short a range", { data: spec10(450, 650) }, /at least 400–700 nm/],
    ["duplicate wavelength", { data: spec10(380, 730) + "\n730 0.5" }, /appears twice/],
    ["unsorted", { data: "380 0.5\n400 0.5\n390 0.5\n" + spec10(410, 730) }, /not in order/],
    ["irregular step", { data: spec10(380, 500) + "\n515 0.5\n" + spec10(520, 730) }, /not uniform/],
    ["negative reflectance", { data: spec10(380, 730, (w) => (w === 500 ? -0.5 : 0.5)) }, /negative beyond instrument noise/],
    ["non-whole nm", { data: spec10(380, 730).replace("380 ", "380.5 ") }, /whole nanometres|not uniform/],
    ["coarse step", { data: [380, 430, 480, 530, 580, 630, 680, 730].map((w) => `${w} 0.5`).join("\n") }, /too coarse/],
    ["black", { data: spec10(380, 730, () => 0) }, /black/],
    ["ASTM E308 with a 2 nm step", { data: Array.from({ length: 176 }, (_, i) => `${380 + 2 * i} 0.5`).join("\n") }, /1, 5, 10 or 20 nm/],
  ])("spectral: %s", (_n, over, re) => refused(run("colour-spectral", over as Record<string, string>), re));

  test("spectral: a descending block is reversed (said so) and gives the same colour", () => {
    const def = COLOUR_CALCS.find((c) => c.id === "colour-spectral")!.fields.find((f) => f.key === "data")!.default;
    const o = run("colour-spectral", { data: def.split("\n").reverse().join("\n") });
    ok(o);
    expect(o.text).toMatch(/descending wavelength order and were reversed/);
    expect(out(o, "L")).toBeCloseTo(out(run("colour-spectral"), "L"), 12);
  });
  test("spectral: percent values with the percent setting equal the fractions", () => {
    const def = COLOUR_CALCS.find((c) => c.id === "colour-spectral")!.fields.find((f) => f.key === "data")!.default;
    const pct = def.split("\n").map((l) => { const [w, v] = l.split(" "); return `${w} ${(Number(v) * 100).toFixed(2)}`; }).join("\n");
    expect(out(run("colour-spectral", { data: pct, units: "percent" }), "L")).toBeCloseTo(out(run("colour-spectral"), "L"), 9);
  });
  test("spectral: a 2 nm block computes by CIE 15 integration", () => {
    const o = run("colour-spectral", { data: Array.from({ length: 176 }, (_, i) => `${380 + 2 * i} 0.5`).join("\n"), method: "integration" });
    ok(o);
    expect(out(o, "L")).toBeCloseTo(76.06926101, 5);
  });
  test("spectral: a header line is skipped and said so", () => {
    const def = COLOUR_CALCS.find((c) => c.id === "colour-spectral")!.fields.find((f) => f.key === "data")!.default;
    const o = run("colour-spectral", { data: "nm R\n" + def });
    ok(o);
    expect(o.text).toMatch(/header and skipped/);
  });
  test.each([
    ["bad hex", { from: "hex", val: "#GG0000" }, /not a hex colour/],
    ["sRGB out of range", { from: "srgb", val: "300, 0, 0" }, /0–255/],
    ["negative XYZ", { from: "xyz", val: "-1, 2, 3" }, /negative/],
    ["black XYZ", { from: "xyz", val: "0, 0, 0" }, /black/],
    ["xy not a chromaticity", { from: "xyy", val: "0.7, 0.5, 20" }, /not a chromaticity/],
  ])("conversion: %s", (_n, over, re) => refused(run("colour-convert", over as Record<string, string>), re));
  test("conversion: an out-of-gamut colour is flagged with its clipped and unclipped values", () => {
    const o = run("colour-convert", { val: "60, -90, 70" });
    ok(o);
    expect(firstLine(o)).toMatch(/OUTSIDE the sRGB gamut/);
    expect(o.text).toMatch(/Out of gamut: the unclipped sRGB values are −/);
  });
  test("conversion: hex round-trips through L*a*b*", () => {
    const o = run("colour-convert", { from: "hex", val: "#1F5FA8" });
    ok(o);
    expect(o.text).toMatch(/in sRGB it is #1F5FA8/);
  });
  test.each([
    ["unknown illuminant", { tests: "A, Z9" }, /not one of/],
    ["test = reference", { tests: "D65" }, /reference illuminant/],
    ["no test illuminant", { tests: "" }, /at least one/],
  ])("metamerism: %s", (_n, over, re) => refused(run("colour-metamerism", over as Record<string, string>), re));
  test.each([
    ["empty batch", { data: "" }, /empty/],
    ["a row of two numbers", { data: "B1 45, 52" }, /three numbers/],
    ["no tolerance", { tol: "" }, /Tolerance/],
    ["impossible sample", { data: "B1 145, 52, 28" }, /above 110/],
  ])("batch: %s", (_n, over, re) => refused(run("colour-batch", over as Record<string, string>), re));
  test("batch: rows without names are numbered", () => {
    const o = run("colour-batch", { data: "45.1 52 28\n47 50 31" });
    ok(o);
    expect(o.text).toMatch(/#2/);
  });
  test.each([
    ["Y = 0", { val: "0, 0, 0" }, /Y must be above 0/],
    ["empty spectrum", { input: "spectrum", data: "" }, /empty/],
  ])("whiteness: %s", (_n, over, re) => refused(run("colour-whiteness", over as Record<string, string>), re));
  test("whiteness: a yellowish sample is flagged outside the CIE formula's range", () => {
    const o = run("colour-whiteness", { val: "70, 72, 60" });
    ok(o);
    expect(o.text).toMatch(/OUTSIDE the range/);
  });
  test("whiteness: illuminant C data at 2° give E313 C and D1925, and no CIE whiteness", () => {
    const o = run("colour-whiteness", { ill: "C", obs: "2" });
    ok(o);
    expect(o.text).toMatch(/D1925/);
    expect((o.outputs ?? []).some((x) => x.key === "W")).toBe(false);
  });
  test("whiteness: a spectrum gives every index", () => {
    const flat = Array.from({ length: 36 }, (_, i) => `${380 + 10 * i} ${(0.85 + 0.002 * i).toFixed(3)}`).join("\n");
    const o = run("colour-whiteness", { input: "spectrum", data: flat, obs: "2" });
    ok(o);
    for (const k of ["W", "T", "yiD65", "yiC", "yi1925"]) expect(Number.isFinite(out(o, k))).toBe(true);
  });
  test.each([
    ["bad colour", { fg: "blue" }, /neither a hex colour/],
    ["channel out of range", { fg: "256, 0, 0" }, /0 to 255/],
    ["empty", { bg: "" }, /required/],
  ])("contrast: %s", (_n, over, re) => refused(run("colour-contrast", over as Record<string, string>), re));
  test("contrast: black on white is 21:1 and passes everything; equal colours are 1:1", () => {
    expect(firstLine(run("colour-contrast", { fg: "#000", bg: "#fff" }))).toMatch(/21\.00:1: it passes every WCAG level/);
    expect(firstLine(run("colour-contrast", { fg: "#808080", bg: "128, 128, 128" }))).toMatch(/1\.00:1: it fails WCAG for text of any size/);
  });
  test("contrast: #767676 on white (4.54:1) is the lightest grey that passes AA", () => {
    expect(firstLine(run("colour-contrast", { fg: "#767676" }))).toMatch(/4\.54:1: it passes WCAG AA for all text/);
  });
  test("adaptation: the same illuminant leaves the colour unchanged", () => {
    const o = run("colour-adapt", { dst: "D50" });
    ok(o);
    expect(out(o, "L")).toBeCloseTo(50, 10);
    expect(out(o, "a")).toBeCloseTo(20, 10);
  });
});

describe("governing equations", () => {
  test.each(COLOUR_CALCS.map((c) => [c.id]))("%s: every equation parses and typesets (OMML and HTML)", (id) => {
    for (const over of [{}, { obs: "2" }] as Array<Record<string, string>>) {
      const o = run(id, over);
      const maths = (o.blocks ?? []).filter((b) => b.kind === "math") as Array<{ math: string; fallback: string }>;
      expect(maths.length).toBeGreaterThan(0);
      for (const m of maths) {
        expect(() => mathToOmml(m.math)).not.toThrow();
        expect(() => mathToHtml(m.math)).not.toThrow();
        expect(contractBreaks(m.fallback)).toEqual([]);
      }
    }
  });
});

describe("printed numbers never contradict their verdict", () => {
  test("ΔE*ab 1.99996 < 2 passes and prints 1.9999, never 2.0000", () => {
    const o = run("colour-difference", { std: "50, 0, 0", smp: "51.99996, 0, 0", tolf: "de76", tol: "2", op: "<" });
    expect(o.text).toMatch(/: PASS \(ΔE\*ab = 1\.9999\)/);
  });
  test("ΔE*ab 2.00004 ≤ 2 fails and prints 2.0001", () => {
    const o = run("colour-difference", { std: "50, 0, 0", smp: "52.00004, 0, 0", tolf: "de76", tol: "2", op: "≤" });
    expect(o.text).toMatch(/: FAIL \(ΔE\*ab = 2\.0001\)/);
  });
  test("a WCAG ratio just under 4.5 prints below 4.500 and fails AA", () => {
    // Search the 8-bit cube for a pair just under the threshold (the engine's ratio, not a hand-typed one).
    let found: [number[], number[]] | null = null;
    for (let g = 0; g < 256 && !found; g++) {
      for (let r = 0; r < 256 && !found; r += 1) {
        const fg = [r, g, 0x76];
        const L = (c: number[]): number => { const l = c.map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
        const ratio = 1.05 / (L(fg) + 0.05);
        if (ratio > 4.4995 && ratio < 4.5) found = [fg, [255, 255, 255]];
      }
    }
    expect(found).not.toBeNull();
    const [fg] = found!;
    const o = run("colour-contrast", { fg: fg.join(", "), bg: "#FFFFFF" });
    expect(firstLine(o)).toMatch(/4\.499:1: it fails WCAG AA for normal text/);
  });
});
