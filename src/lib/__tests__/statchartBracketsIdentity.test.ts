// Byte-identity of boxPlotSvg / groupedBarSvg when NO brackets are drawn.
//
// The bracket hook (opts.brackets) was added to two builders whose output is in
// every statistics figure. These sha256 values were captured from the builders
// BEFORE statchart.ts was edited (2026-10-14, after Builder 1's axis migration
// landed), by printing them from this file's fixtures. A change to any of them
// means the hook leaked into the no-bracket path.
import { createHash } from "crypto";
import { boxPlotSvg, groupedBarSvg } from "../statchart";
import { bracketsFromPairwise } from "../sigBrackets";
import { twoSampleTTest } from "../stats";

// The ONE deliberate byte change since these were captured: the figure title's
// <text> carries data-figure-title="1" (v2.143.0 review, item 2 — USPTO's "no title
// in the artwork" finds the title by it). Removing exactly that attribute must give
// back the captured bytes, so the guarantee below is unchanged for everything else.
const sha = (s: string) => createHash("sha256").update(s.split(' data-figure-title="1"').join("")).digest("hex");

type Extra = Record<string, unknown>;
const FIXTURES: Array<[string, (x: Extra) => string, string]> = [
  ["box basic", (x) => boxPlotSvg([{ label: "A", values: [1, 2, 3, 4, 5] }, { label: "B", values: [2, 3, 4, 8, 9] }], { ...x }), "5699e24c738227b0da0d84783c9c9b175bff2651b6bb1b10f120489b06b15d84"],
  ["box title+ylabel", (x) => boxPlotSvg([{ label: "ctrl", values: [4.17, 5.58, 5.18] }, { label: "trt", values: [6.31, 5.12, 5.54] }], { title: "Weight", ylabel: "g", ...x }), "dcd5ffe21e933869cd9a0a3c27be02952f56fd609faf2c497da65fa7a50527a4"],
  ["box rotated", (x) => boxPlotSvg(Array.from({ length: 8 }, (_, i) => ({ label: `condition ${i + 1}`, values: [i, i + 1, i + 3, i * 2] })), { title: "Rot", ...x }), "a76e5cbb3aa516bed7ae25a404f27345f02e8ff49273944f448187e8bf597724"],
  ["box clipped 14", (x) => boxPlotSvg(Array.from({ length: 14 }, (_, i) => ({ label: `g${i}`, values: [i, i + 2, i + 5] })), { ...x }), "a10f6ff281f7237c0676287836472448f4ee602574ac0eb2621f7d7d288089de"],
  ["box negative", (x) => boxPlotSvg([{ label: "n", values: [-5, -3, -1, 0] }, { label: "p", values: [1, 2, 30] }], { ylabel: "Δ", ...x }), "3e9ed743ace5bbc6652cc5ac351d6fd1314e98a89c8638f9760f080926e89540"],
  ["box empty", (x) => boxPlotSvg([], { ...x }), "744e287484345d7ae947f32b0f3f72a3802c583c289d76c5b3230b72af9099bb"],
  ["box huge", (x) => boxPlotSvg([{ label: "x", values: [1.7e308, -1.7e308, 1, 2, 3] }], { ...x }), "b17c1b50bec5c198197912e82d005ebce53ed3db92d9c32b1282aac66478f3ed"],
  ["box sized", (x) => boxPlotSvg([{ label: "a", values: [0.001, 0.002, 0.003] }], { w: 300, h: 200, ...x }), "955e9d15853df14ebc992e77718769e860c608e9dc38a8935999be36b17e5e10"],
  ["bar basic", (x) => groupedBarSvg(["a", "b", "c"], [{ label: "Observed", values: [10, 20, 30] }, { label: "Expected", values: [15, 20, 25] }], { ...x }), "76fbff2cf9e1b2aea8adc5299524997e08b7c9ad2ede845d6423c53a1a9b2bb7"],
  ["bar title neg", (x) => groupedBarSvg(["x", "y"], [{ label: "s", values: [-4, 7] }], { title: "T", ylabel: "Y", ...x }), "4e53fc1a1db9712004cec7ac850045519676893d91e5204f093d55e17f7106c1"],
  ["bar clipped cats", (x) => groupedBarSvg(Array.from({ length: 18 }, (_, i) => `c${i}`), [{ label: "s", values: Array.from({ length: 18 }, (_, i) => i) }], { ...x }), "4a4b3f0ee59e076c237b126164063e9a176707f5cf67e4fda66028ddc8e6699c"],
  ["bar 10 series", (x) => groupedBarSvg(["a", "b"], Array.from({ length: 10 }, (_, k) => ({ label: `s${k}`, values: [k, k + 1] })), { ...x }), "3e39399e111082afcdf76d789906acd69fbbc35ebb4f5135fe91308416eee8d5"],
  ["bar empty", (x) => groupedBarSvg([], [], { ...x }), "d108968d28b303d207fe22b9d9f9dd19a1344cd14647e72de2f6ac4df513136a"],
];

describe("no brackets → byte-identical to the pre-hook builders", () => {
  test.each(FIXTURES)("%s, option absent", (_n, f, h) => {
    expect(sha(f({}))).toBe(h);
  });
  test.each(FIXTURES)("%s, brackets: undefined", (_n, f, h) => {
    expect(sha(f({ brackets: undefined }))).toBe(h);
  });
  // Every bracket hidden (ns, showNs: false): nothing is drawn, so nothing moves.
  const nsOnly = bracketsFromPairwise([{ i: 0, j: 1, kind: "t", result: twoSampleTTest([1, 2, 3, 4], [1.5, 2, 3.5, 3]) }], "none");
  test.each(FIXTURES.filter(([n]) => !/empty|huge|sized/.test(n)))("%s, all brackets hidden", (_n, f, h) => {
    expect(sha(f({ brackets: { set: nsOnly, display: { showNs: false } } }))).toBe(h);
  });
});
