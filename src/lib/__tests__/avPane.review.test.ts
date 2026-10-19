// Independent adversarial review of the v2.140.0 audio / video / light PANE
// INTEGRATION: the 17 new Engineering calculators, the changed audio-reverb,
// video-resolution and video-bitrate, src/lib/avFigures.ts, and the
// ENG_LEVEL_UNIT_NOTE / ENG_DB_UNIT_NOTE notes. The engines had their own review
// (av.review.test.ts); this file is about what the pane SHOWS.
//
// HOW THE PANE IS EXERCISED. taskpane.ts cannot be imported under jest (Office.js
// at module scope), so the registry entries are sliced out of the pane source,
// transpiled with the TypeScript compiler and run against the real src/lib
// modules. The helpers the entries call (engNum, engUnits, avDb, avPlot,
// avNumbers and the unit notes) are sliced from the pane too, and the ones that
// moved to src/lib (readSvgDims, plainDashes) come from there, so the numbers,
// lines and figure sizes below are the pane's own.
// engReport is replaced by a stub that keeps the lines (em dashes made plain,
// as the real one does) and the figure blocks.
//
// Convention (house rule):
//   - plain `it`      → a real defect (wrong answer or misleading). It FAILS today
//                       and passes once fixed.
//   - `it.failing`    → cosmetic, or a refusal where an answer exists. It passes
//                       today because the assertion fails; flip it to `it` when fixed.
//   - plain passing `it` in the last block → confirmed-correct probes.
//
// THE HARNESS SELF-CHECK COMES FIRST. `it.failing` also passes on a THROW, so a
// broken harness would turn every cosmetic test green for the wrong reason. The
// self-check runs every input used below and requires a real result object.

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import * as audio from "../audio";
import * as loudness from "../loudness";
import * as video from "../video";
import * as timecode from "../timecode";
import * as photometry from "../photometry";
import * as colourspace from "../colourspace";
import * as avFigures from "../avFigures";
import * as units from "../units";
import * as numberList from "../numberList";
import * as mechchart from "../mechchart";
import * as plot from "../plot";
import * as svgSize from "../svgSize";
import * as engReportLib from "../engReport";

/* eslint-disable @typescript-eslint/no-explicit-any */

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");

const IDS = [
  "audio-levels",
  "audio-levelmath",
  "audio-dither",
  "audio-filesize",
  "audio-loudness",
  "audio-speaker",
  "audio-absorption",
  "audio-crossover",
  "audio-damping",
  "video-timecode",
  "video-framerate",
  "video-aspect",
  "video-transfer",
  "video-interface",
  "light-photometry",
  "light-exposure",
  "light-colourtemp",
  "audio-reverb",
  "video-resolution",
  "video-bitrate",
];

function slice(startMarker: string, endMarker: string): string {
  const s = PANE.indexOf(startMarker);
  if (s < 0) throw new Error(`pane helper not found: ${startMarker}`);
  const e = PANE.indexOf(endMarker, s);
  if (e < 0) throw new Error(`end of pane helper not found: ${startMarker}`);
  return PANE.slice(s, e + endMarker.length);
}

function entry(id: string): string {
  const at = PANE.indexOf(`\n    id: "${id}",`);
  if (at < 0) throw new Error(`registry entry not found: ${id}`);
  const s = PANE.lastIndexOf("\n  {\n", at);
  const e = PANE.indexOf("\n  },\n", at);
  return PANE.slice(s + 1, e + 4);
}

function buildRegistry(): Record<string, any> {
  const helpers = [
    slice("const engNum = ", "\n};\n"),
    slice("function engUnits(", "\n}\n"),
    slice("const ENG_UNIT_NOTE =", ";\n"),
    slice("const ENG_SAME_UNIT_NOTE =", ";\n"),
    slice("const ENG_EXACT_UNIT_NOTE =", ";\n"),
    slice("const ENG_LEVEL_UNIT_NOTE =", ";\n"),
    slice("const ENG_DB_UNIT_NOTE =", ";\n"),
    slice("function avPlot(", "\n}\n"),
    slice("function avNumbers(", "\n}\n"),
    slice("function avDb(", "\n}\n"),
  ].join("\n");
  const src = `${helpers}\nreturn [\n${IDS.map(entry).join(",\n")}\n];`;
  const js = ts
    .transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, removeComments: true } })
    .outputText.replace(/^"use strict";/, "");
  const scope: Record<string, any> = {};
  for (const lib of [audio, loudness, video, timecode, photometry, colourspace, avFigures, units, numberList, mechchart, plot, svgSize, engReportLib]) {
    Object.assign(scope, lib);
  }
  // The real engReport came in with plainDashes; the stub below replaces it on purpose.
  scope.avFmt = (audio as any).fmtNum;
  scope.engReport = (lines: any[], extra: any[] = []) => ({
    lines: lines.map((l) => (typeof l === "string" ? l.replace(/—/g, "-") : l.fallback)),
    blocks: extra,
  });
  const proxy = new Proxy(scope, { has: (t, k) => k in t, get: (t, k) => (t as any)[k] });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const calcs = new Function("__s", `with (__s) { ${js} }`)(proxy) as any[];
  return Object.fromEntries(calcs.map((c) => [c.id, c]));
}

const REG = buildRegistry();

interface PaneOut {
  lines?: string[];
  blocks?: { kind: string; svg: string; caption: string; w: number; h: number }[];
  text?: string;
  ok?: boolean;
}

/** Run a pane calculator on its own defaults, with some fields overridden as a person would type them. */
function run(id: string, over: Record<string, string> = {}): PaneOut {
  const c = REG[id];
  const vals: Record<string, string> = {};
  for (const f of c.fields) vals[f.key] = f.default;
  Object.assign(vals, over);
  return c.compute((k: string) => (k in vals ? vals[k] : ""));
}

const textOf = (o: PaneOut): string => (o.lines ? o.lines.join("\n") : (o.text ?? ""));
/**
 * The tool's own result lines: everything before the shared "Units read" echo
 * (engUnits, used by ~130 tools and older than this release) and the notes.
 */
const resultLines = (o: PaneOut): string[] => {
  const ls = o.lines ?? [];
  const cut = ls.indexOf("Units read");
  return (cut < 0 ? ls : ls.slice(0, cut)).filter((l) => !/^(Note|Units):/.test(l));
};
const noteLines = (o: PaneOut): string[] => (o.lines ?? []).filter((l) => /^Note:/.test(l));
const svgDims = (svg: string): { w: number; h: number } => ({
  w: Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1]),
  h: Number(/\bheight="([\d.]+)"/.exec(svg)?.[1]),
});
/** A hyphen-minus used as a numeric sign: " -3.9", "(-1", "=-7.70". */
const HYPHEN_SIGN = /(^|[\s(=,])-\d/;

// Every input the tests below type. The self-check runs them all, so an
// `it.failing` can never pass because the harness threw.
const INPUTS: [string, Record<string, string>][] = [
  ["audio-reverb", {}],
  ["video-resolution", {}],
  ["video-interface", { bpp: "30" }],
  ["video-interface", { total: "2100×1125" }],
  ["light-exposure", { n: "8", n2: "" }],
  ["light-exposure", { n: "11", n2: "" }],
  ["light-colourtemp", {}],
  ["audio-levelmath", { levels: "−20, −20 dBFS" }],
  ["light-exposure", { n: "1.4", t: "30 s" }],
  ["light-colourtemp", { x: "0.4476", y: "0.4074" }],
  ["video-timecode", { frames: "-1" }],
  ["audio-levels", { temp: "-10 °C" }],
  ["audio-loudness", {}],
  ["audio-levels", {}],
  ["audio-loudness", { meas: "-23 LUFS" }],
  ["audio-loudness", { mode: "gated", blocks: "-20 LUFS, -22 LUFS, -23 LUFS, -24 LUFS, -75 LUFS" }],
  ["audio-loudness", { meas: "−16,3" }],
  ["light-photometry", { gain: "1,3" }],
  ["light-exposure", { n: "2,8" }],
  ["light-colourtemp", { x: "0,3127", y: "0,3290" }],
  ["video-aspect", { content: "2,39" }],
  ["video-framerate", { src: "29,97" }],
  ["video-interface", { rate: "29,97" }],
  ["video-transfer", { curve: "pq", dir: "toSignal", val: "1000 nit" }],
  ["audio-levels", { val: "1.228 V", from: "Vrms" }],
  ["audio-speaker", { sens: "88 dB" }],
  ["audio-levelmath", { op: "subtract", levels: "85", bg: "80 dB" }],
  ["light-exposure", { iso2: "ISO 400" }],
  ["light-exposure", { n: "F2.8" }],
  ["audio-damping", { awg: "4/0", area: "" }],
  ["video-framerate", { src: "48", dst: "" }],
  ["video-framerate", { src: "120", dst: "" }],
  ["light-exposure", {}],
  ["video-timecode", { tca: "00:00:59;29", tcb: "00:01:00;02" }],
  ["video-bitrate", { fps: "24000/1001" }],
  ["light-colourtemp", { x: "0.3127", y: "" }],
  ["video-interface", { stream: "400 Mb/s" }],
  ["video-timecode", {}],
  ["video-timecode", { tca: "00:01:00;00" }],
  ["video-timecode", { rate: "59.94 DF", tca: "00:10:00;00" }],
  ["video-interface", {}],
  ["video-interface", { rate: "59.94" }],
  ["audio-crossover", {}],
  ["audio-loudness", { mode: "sine" }],
  ["audio-loudness", { mode: "sine", ch: "L+R" }],
  ["audio-absorption", {}],
  ["light-photometry", {}],
  ["light-photometry", { flux: "5000 W" }],
  ["light-photometry", { i: "1000 lm" }],
  ["video-transfer", { curve: "pq", dir: "toSignal", val: "1000" }],
  ["video-transfer", {}],
  ["video-framerate", { dst: "" }],
  ["video-framerate", { src: "29.97", dst: "" }],
];

describe("harness self-check (plain it: must PASS, or every it.failing below is vacuous)", () => {
  it("slices all 20 registry entries and runs every input used in this file", () => {
    expect(Object.keys(REG).sort()).toEqual([...IDS].sort());
    for (const [id, over] of INPUTS) {
      let o: PaneOut | undefined;
      expect(() => {
        o = run(id, over);
      }).not.toThrow();
      expect(o && (Array.isArray(o.lines) || typeof o.text === "string")).toBe(true);
    }
    // One known line, so a harness that "runs" but computes nothing is caught.
    expect(textOf(run("audio-levels"))).toContain("+4.0000 dBu = −14.0000 dBFS");
    // The direct-lib precondition of an it.failing below.
    expect((audio.coherentSum([80, 80], [0, 179.9]) as any).ok).toBe(true);
  });
});

describe("v2.140.0 pane review — real defects (plain it: FAIL today)", () => {
  // FIGURE SIZED FROM THE ASKED-FOR BOX. audio-reverb (changed this release, Q
  // added) still hands Word a hard-coded w: 380, h: 250 while buildPlotSvg widened
  // the canvas for the legend: the SVG is 454×250, so the insert squashes it
  // horizontally by 16%. avPlot (readSvgDims) exists for exactly this and is not
  // used. Shown: block 380×250. Correct: the SVG's own 454×250. Owner: taskpane.ts
  // (audio-reverb compute; the literal predates v2.140.0 but the tool changed).
  it("audio-reverb inserts its figure at the SVG's own size, not 380×250", () => {
    const b = run("audio-reverb").blocks![0];
    expect({ w: b.w, h: b.h }).toEqual(svgDims(b.svg));
  });

  // Same class in video-resolution (changed this release): block 380×250, SVG
  // 496×250 on the defaults (3840×2160, 55 in) — a 23% horizontal squash.
  // Owner: taskpane.ts (video-resolution compute).
  it("video-resolution inserts its figure at the SVG's own size, not 380×250", () => {
    const b = run("video-resolution").blocks![0];
    expect({ w: b.w, h: b.h }).toEqual(svgDims(b.svg));
  });

  // SDI CLASS FROM THE WRONG RATE FAMILY. interfaceRate picks the smallest class
  // ≥ the link rate from one list that mixes the 1/1.001 clocks in. For an
  // INTEGER picture rate it can therefore name a 1/1.001 class:
  //   video-interface, rate 60, bpp 30 (4:4:4 10-bit) → "6G-SDI … 5.94/1.001 Gbit/s"
  //   video-interface, rate 60, raster 2100×1125     → "3G-SDI … 2.97/1.001 Gbit/s"
  //   interfaceRate(1920,1080,"24",2200,1125,20)     → "HD-SDI … 1.485/1.001 Gbit/s"
  // Oracle: SMPTE ST 292-1, ST 424 and ST 2081-1 define the 1/1.001 bit rates only
  // for 1/1.001 picture rates; a 60, 30 or 24 fps signal runs at 5.94, 2.97 or
  // 1.485 Gbit/s. Correct: the integer-family class (and, the mirror, a 1/1.001
  // rate gets a 1/1.001 class). Owner: video.ts (interfaceRate class selection,
  // SDI_CLASSES.find).
  it("an integer frame rate is never assigned a 1/1.001 SDI class", () => {
    expect(textOf(run("video-interface", { bpp: "30" }))).not.toMatch(/SDI class[^\n]*\/1\.001/);
    expect(textOf(run("video-interface", { total: "2100×1125" }))).not.toMatch(/SDI class[^\n]*\/1\.001/);
    const r = video.interfaceRate(1920, 1080, "24", 2200, 1125, 20);
    expect(r.ok).toBe(true);
    expect((r as any).sdiClass.name).not.toMatch(/1\.001/);
    // The mirror: a 1/1.001 rate whose link (1.48419 Gbit/s, a 2201-sample line)
    // is just above 1.485/1.001 is handed the INTEGER 1.485 Gbit/s class today.
    const f = video.interfaceRate(1920, 1080, "29.97", 2201, 1125, 20);
    expect(f.ok).toBe(true);
    expect((f as any).sdiClass === null || /1\.001/.test((f as any).sdiClass.name)).toBe(true);
  });

  // THE EXPOSURE REPORT DISAGREES WITH ITSELF. The hint says "f-numbers are powers
  // of √2, so f/5.6 is really 5.657 and f/4 → f/11 is exactly 3 stops, not 2.92",
  // and the stops line uses the exact values: "f/8 → f/11  1 stops on the exact
  // values". But the pane passes the TYPED n to exposureValue (and depthOfField),
  // so at 1/125 s the EV of f/8 is 12.966 and of f/11 is 12.047: 0.919 EV apart,
  // the "by the markings" figure the same report calls wrong. Shown: ΔEV 0.919.
  // Correct by the tool's own rule (EV = log₂(N²/t), ISO 2720, N = 2^(k/6) via
  // fNumberExact): 1.000. Owner: taskpane.ts (light-exposure passes n, not
  // fNumberExact(n).exact).
  it("light-exposure's EV moves by exactly the stops it reports between f/8 and f/11", () => {
    const ev = (o: PaneOut): number => Number(/EV of the settings\s+(\S+)/.exec(textOf(o))![1]);
    const d = ev(run("light-exposure", { n: "8", n2: "" })) - ev(run("light-exposure", { n: "11", n2: "" }));
    // Was "1 stops" when written; the singular is fixed in the same round (see
    // "one stop and one frame are singular" below), so this pins the fixed text.
    expect(textOf(run("light-exposure"))).toContain("1 stop on the exact values");
    expect(Math.abs(Math.abs(d) - 1)).toBeLessThan(0.005);
  });

  // THE DEFAULT FIGURE HIDES HALF THE ANSWER AND ITS CAPTION SAYS OTHERWISE. On
  // the defaults (3200 K → 5600 K, the tungsten-to-daylight question the tool
  // exists for) the caption reads "The CIE daylight locus in xy with the entered
  // temperatures on it", but daylightLocusFigure drops 3200 K (outside the
  // D-series' 4000–25000 K) without saying so, and the entered (x, y) = D65 point
  // is not drawn at all. Shown: one scatter point, caption plural. Correct: both
  // entered temperatures drawn (3200 K belongs on the Planckian locus, CIE 015),
  // or a caption/note that says which one is absent. Owner: taskpane.ts
  // (light-colourtemp caption) / colourspace.ts (daylightLocusFigure).
  it("light-colourtemp's default figure shows every temperature its caption says it shows", () => {
    const b = run("light-colourtemp").blocks![0];
    // Plotted points are the red circles in the pane's own SVG (the legend swatch is not a circle).
    const marked = (b.svg.match(/<circle[^>]*fill="#b91c1c"/g) ?? []).length;
    expect(/entered temperatures on it/.test(b.caption) ? marked : 2).toBe(2);
  });
});

// All twelve fixed in the v2.140.0 fix round and flipped from it.failing to it.
describe("v2.140.0 pane review — cosmetic and refusals (fixed; flipped to plain it)", () => {
  // TRUE MINUS IN RESULT LINES (display contract). The new tools print several
  // signed results with toFixed/engNum, i.e. a hyphen-minus:
  //   levelmath "−20, −20 dBFS"   → "Incoherent total    -16.9897 dBFS"
  //   light-exposure f/1.4, 30 s  → "EV of the settings  -3.936"
  //   colourtemp Illuminant A xy  → "Duv -0.0000" (also a negative zero)
  //   video-timecode frames "-1"  → "(day -1)"
  //   audio-levels temp "-10 °C"  → "Speed of sound at -10 °C"
  // Correct: U+2212 (avDb already does this). Owner: taskpane.ts.
  it("signed results in the pane's result lines use the true minus sign", () => {
    const offenders: string[] = [];
    for (const [id, over] of [
      ["audio-levelmath", { levels: "−20, −20 dBFS" }],
      ["light-exposure", { n: "1.4", t: "30 s" }],
      ["light-colourtemp", { x: "0.4476", y: "0.4074" }],
      ["video-timecode", { frames: "-1" }],
      ["audio-levels", { temp: "-10 °C" }],
    ] as [string, Record<string, string>][]) {
      for (const l of resultLines(run(id, over))) if (HYPHEN_SIGN.test(l)) offenders.push(`${id}: ${l.trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  // The engines' notes do the same on the DEFAULTS:
  //   loudness: "Gain = target − measured = −23 − (−16.3) =-6.70 dB" (and no space)
  //   audio:    "dBV = dBu -2.2185 dB" (DBU_TO_DBV.toFixed)
  //   colourspace: "A shift of -133.9 mired"
  // Owner: loudness.ts (normaliseGain), audio.ts (levelConvert), colourspace.ts (miredShift).
  it("engine notes on the defaults use the true minus sign", () => {
    const offenders: string[] = [];
    for (const id of ["audio-loudness", "audio-levels", "light-colourtemp"]) {
      for (const l of noteLines(run(id))) if (HYPHEN_SIGN.test(l)) offenders.push(`${id}: ${l}`);
    }
    expect(offenders).toEqual([]);
  });

  // The bar-chart value labels print negative loudness with a hyphen: the default
  // audio-loudness figure reads "-16.3", "-23.0", "-1.50", "-8.20" — and with NO
  // unit, because unitOf() only finds a unit in "(…)" and the yLabel is
  // "LUFS / dBTP". Owner: mechchart.ts (hBarSvg fmtVal), reached through
  // avFigures.audioFigureSvg (unitOf).
  it("negative bar values in the loudness figure carry the true minus sign", () => {
    const svg = run("audio-loudness").blocks![0].svg;
    expect(svg).not.toMatch(/>[^<]*-\d[^<]*</);
  });

  // "LUFS" REFUSED IN FIELDS LABELLED LUFS. The measured field is "Measured
  // integrated loudness, LUFS", the gated field "Block loudnesses, LUFS", and
  // ENG_LEVEL_UNIT_NOTE (printed under them) names "LUFS re digital full scale" as
  // a reference. Typing "-23 LUFS" gives "must be a number of LUFS"; typing
  // "-20 LUFS, …" in the gated field gives "\"LUFS\" is not a level in dB", which
  // the same tool's note contradicts ("1 LU = 1 dB"). Correct: −23 LUFS against
  // the −23 LUFS R128 target is a 0.00 dB gain; the gated list gives −21.989 LUFS
  // (BS.1770-4 gating, exactly what the same numbers give without the suffix).
  // Owner: taskpane.ts (audio-loudness num()) and audio.ts (parseLevelList refs).
  it("loudness fields accept a typed LUFS suffix", () => {
    expect(textOf(run("audio-loudness", { meas: "-23 LUFS" }))).toContain("Gain                0.00 dB");
    expect(textOf(run("audio-loudness", { mode: "gated", blocks: "-20 LUFS, -22 LUFS, -23 LUFS, -24 LUFS, -75 LUFS" }))).toContain(
      "−21.989 LUFS",
    );
  });

  // THE PRODUCT COMMA RULE (1,5 = 1.5) is honoured by parseLevelList, readNumberList
  // and the timecode frame count, but the new Number() fields refuse it:
  // loudness "−16,3", screen gain "1,3", f-number "2,8", chromaticity "0,3127",
  // content aspect "2,39", frame rate "29,97" (twice; the interface one even says
  // "must be a positive number up to 10000"). Owner: taskpane.ts / video.ts
  // (parseRatio) / timecode.ts (parseRate).
  it("decimal-comma input is read as a decimal in the new fields", () => {
    for (const [id, over] of [
      ["audio-loudness", { meas: "−16,3" }],
      ["light-photometry", { gain: "1,3" }],
      ["light-exposure", { n: "2,8" }],
      ["light-colourtemp", { x: "0,3127", y: "0,3290" }],
      ["video-aspect", { content: "2,39" }],
      ["video-framerate", { src: "29,97" }],
      ["video-interface", { rate: "29,97" }],
    ] as [string, Record<string, string>][]) {
      expect([id, Array.isArray(run(id, over).lines)]).toEqual([id, true]);
    }
  });

  // TYPED UNITS REFUSED IN VALUE FIELDS, while the field beside them converts:
  // video-transfer value "1000 nit" (lw beside it reads "100 nit"), audio-levels
  // "1.228 V" (label: "or V, Pa, W, mV/Pa"), speaker "88 dB", levelmath background
  // "80 dB" (the levels field beside it reads "80 dB SPL"), "ISO 400", "F2.8",
  // AWG "4/0" (the usual name of 0000). video-transfer is MISLEADING, not just
  // friction: it prints ENG_UNIT_NOTE ("write another unit … and it is converted
  // for you") directly under the value field that refuses "1000 nit".
  // Owner: taskpane.ts.
  it("value fields accept the unit or prefix a person types", () => {
    for (const [id, over] of [
      ["video-transfer", { curve: "pq", dir: "toSignal", val: "1000 nit" }],
      ["audio-levels", { val: "1.228 V", from: "Vrms" }],
      ["audio-speaker", { sens: "88 dB" }],
      ["audio-levelmath", { op: "subtract", levels: "85", bg: "80 dB" }],
      ["light-exposure", { iso2: "ISO 400" }],
      ["light-exposure", { n: "F2.8" }],
      ["audio-damping", { awg: "4/0", area: "" }],
    ] as [string, Record<string, string>][]) {
      expect([id, over, Array.isArray(run(id, over).lines)]).toEqual([id, over, true]);
    }
  });

  // "Mb/s" is the commonest way to write a stream rate and is not a unit
  // ("Mbit/s" and "Mbps" are). video-interface stream "400 Mb/s" is refused.
  // Owner: units.ts.
  it("'Mb/s' reads as megabits per second", () => {
    const m = units.parseMeasured("400 Mb/s", "bit/s");
    expect("error" in m ? NaN : m.inTarget).toBe(4e8);
    expect(Array.isArray(run("video-interface", { stream: "400 Mb/s" }).lines)).toBe(true);
  });

  // 48 AND 120 FPS REFUSED AS "NOT A TIMECODE RATE" in the frame-rate / shutter
  // tool. 180° at 48 fps (HFR cinema) is 1/96 s and 48 kHz audio is exactly 1000
  // samples per frame; nothing about the question involves timecode. rateFacts and
  // shutter go through timecode.parseRate, which only knows the eight SMPTE ST 12-1
  // rates. Owner: video.ts (rateFacts / shutter rate parsing).
  it("video-framerate answers for 48 and 120 fps instead of refusing them as timecode rates", () => {
    expect(textOf(run("video-framerate", { src: "48", dst: "" }))).toContain("1000 samples");
    expect(Array.isArray(run("video-framerate", { src: "120", dst: "" }).lines)).toBe(true);
  });

  // Plural nits on the defaults and near them: light-exposure "f/8 → f/11  1 stops
  // on the exact values"; video-timecode duration "00:00:00;01 = 1 frames".
  // Owner: taskpane.ts.
  it("one stop and one frame are singular", () => {
    expect(textOf(run("light-exposure"))).not.toMatch(/\b1 stops\b/);
    expect(textOf(run("video-timecode", { tca: "00:00:59;29", tcb: "00:01:00;02" }))).not.toMatch(/\b1 frames\b/);
  });

  // DISPLAY MUST PARSE BACK. video-bitrate fps "24000/1001" heads the result
  // "Bitrate, 1920×1080 at 23.98 fps" (engNum to 4 figures). 23.98 is not the
  // rate: the product's own parseRate reads "23.98" as 24000/1001 only with a
  // "165.8 ppm" correction note. Correct: "23.976" (or 24000/1001), as every other
  // new video tool prints. Owner: taskpane.ts (video-bitrate header).
  it("video-bitrate names 24000/1001 as 23.976, not 23.98", () => {
    const header = run("video-bitrate", { fps: "24000/1001" }).lines![0];
    expect(header).toMatch(/ at (23\.976|24000\/1001) fps$/);
  });

  // A blank y is read as 0 (Number("") === 0) and reported as a bad chromaticity
  // "(0.3127, 0)". Correct: say y is missing. Owner: taskpane.ts (light-colourtemp).
  it("a blank chromaticity y is reported as missing, not as 0", () => {
    expect(textOf(run("light-colourtemp", { x: "0.3127", y: "" }))).not.toContain("(0.3127, 0)");
  });

  // The coherent-sum figure for phases 0, 179.9° (total 24.84 dB, shown in the
  // line beside it) is clipped at 40 dB with the note "a cancellation is −∞ dB
  // and is clipped there". 24.84 dB is not a cancellation; the figure never
  // reaches the answer printed next to it. Oracle: |1 + e^{j179.9°}| =
  // 2·sin(0.05°) → 80 − 55.16 = 24.84 dB. Owner: audio.ts (coherentSum figure floor).
  it("the coherent-sum figure reaches the finite total printed beside it", () => {
    const r = audio.coherentSum([80, 80], [0, 179.9]) as any;
    expect(r.ok).toBe(true);
    const ys: number[] = r.figure.series.flatMap((s: any) => s.points.map((p: any) => p.y));
    expect(Math.min(...ys)).toBeLessThanOrEqual(r.totalDb + 0.5);
  });
});

describe("v2.140.0 pane review — confirmed correct (plain it: PASS)", () => {
  // SMPTE ST 12-1 drop-frame at 29.97: 00:10:00;00 is frame 17982 (10 × 1800 −
  // 9 × 2 dropped), real time 17982 × 1001/30000 = 599.9994 s; 00:01:00;00 does
  // not exist; at 59.94 DF 00:10:00;00 is frame 35964.
  it("drop-frame timecode across the minute and ten-minute boundaries", () => {
    const t = textOf(run("video-timecode"));
    expect(t).toContain("Frame number        17982 (0-based)");
    expect(t).toContain("(599.9994 s exactly)");
    expect(textOf(run("video-timecode", { tca: "00:01:00;00" }))).toMatch(/does not exist at 29\.97 drop-frame/);
    expect(textOf(run("video-timecode", { rate: "59.94 DF", tca: "00:10:00;00" }))).toContain("Frame number        35964");
  });

  // SMPTE ST 274 2200×1125 × 60 × 20 bit = 2.97 Gbit/s, exactly ST 424 3G-SDI;
  // at 60000/1001 it is 2.97/1.001.
  it("1080p60 4:2:2 10-bit is exactly 3G-SDI, and 59.94 is the /1.001 class", () => {
    expect(textOf(run("video-interface"))).toContain("3G-SDI, SMPTE ST 424, 2.97 Gbit/s, exactly");
    const t = textOf(run("video-interface", { rate: "59.94" }));
    expect(t).toContain("2.96703 Gbit/s");
    expect(t).toContain("2.97/1.001 Gbit/s, exactly");
  });

  // Linkwitz–Riley 2nd order: C = 1/(4π·fc·R) = 3.9789 µF, L = R/(π·fc) =
  // 1.0186 mH at 2.5 kHz, 8 Ω; each section −6.02 dB at fc.
  it("LR2 crossover component values at 2.5 kHz into 8 Ω", () => {
    const t = textOf(run("audio-crossover"));
    expect(t).toContain("Capacitor C         3.9789 µF");
    expect(t).toContain("Inductor L          1.0186 mH");
    expect(t).toContain("Each section at fc  −6.021 dB");
  });

  // ITU-R BS.1770-4: a 0 dBFS 997 Hz sine in one front channel reads −3.01 LKFS;
  // in L and R together, 0 LKFS.
  it("BS.1770 calibration sine", () => {
    expect(textOf(run("audio-loudness", { mode: "sine" }))).toContain("Loudness            −3.0103 LUFS");
    expect(textOf(run("audio-loudness", { mode: "sine", ch: "L+R" }))).toContain("Loudness            0.0000 LUFS");
  });

  // 200 m³, A = 1.2 + 36 + 12 = 49.2 m²: Sabine 0.161·V/A = 0.6545 s, Eyring
  // 0.161·V/(−S ln(1 − ᾱ)) = 0.5848 s, Millington–Sette 0.161·V/Σ(−Sᵢ ln(1 − αᵢ)) = 0.4678 s.
  it("Sabine, Eyring and Millington–Sette on the default room", () => {
    const t = textOf(run("audio-absorption"));
    expect(t).toContain("RT60, Sabine        0.65447 s");
    expect(t).toContain("RT60, Eyring        0.58483 s");
    expect(t).toContain("RT60, Millington–Sette 0.4678 s");
  });

  // ISO 2720: EV = log₂(N²/t) = log₂(64 × 125) = 12.966 for f/8 at 1/125 s; E =
  // C·2^EV/S = 20000 lx (C 250), L = K·2^EV/S = 1000 cd/m² (K 12.5); hyperfocal
  // f²/(N·c) + f = 10.467 m.
  it("exposure value, meter equations and hyperfocal distance on the defaults", () => {
    const t = textOf(run("light-exposure"));
    expect(t).toContain("EV of the settings  12.966");
    expect(t).toContain("Incident light      20000 lx");
    expect(t).toContain("Subject luminance   1000 cd/m²");
    expect(t).toContain("Hyperfocal          10.467 m");
  });

  // E = I/d² = 1000/4 = 250 lx; uniform 30° cone Φ = I·2π(1 − cos 15°) = 214.09 lm;
  // lumen ↔ watt and candela ↔ lumen stay refused by name.
  it("photometry numbers, and lm→W / cd↔lm refused by name", () => {
    const t = textOf(run("light-photometry"));
    expect(t).toContain("250 lx (23.226 fc)");
    expect(t).toContain("Φ = 214.094 lm");
    expect(run("light-photometry", { flux: "5000 W" }).text).toMatch(/"W" is not compatible with lm/);
    expect(run("light-photometry", { i: "1000 lm" }).text).toMatch(/"lm" is not compatible with cd/);
  });

  // SMPTE ST 2084: 1000 cd/m² → E′ = 0.75183, 10-bit narrow code
  // round((219E′ + 16)·4) = 723 (BT.2100 Table 9); BT.1886 at Lw 100, Lb 0:
  // 100·0.5^2.4 = 18.946 cd/m².
  it("PQ code value and BT.1886 display light", () => {
    expect(textOf(run("video-transfer", { curve: "pq", dir: "toSignal", val: "1000" }))).toContain("10-bit narrow code  723");
    expect(textOf(run("video-transfer"))).toContain("18.94646");
  });

  // Mired 10⁶/3200 = 312.5, 10⁶/5600 = 178.57, shift −133.9 (a blue, CTB-type
  // correction); D65 (0.3127, 0.3290) is CCT ≈ 6504 K (CIE 015).
  it("mired shift and D65 CCT", () => {
    const t = textOf(run("light-colourtemp"));
    expect(t).toContain("Shift               −133.9 mired (blue correction)");
    const rob = Number(/Robertson (\S+) K/.exec(t)![1]);
    expect(Math.abs(rob - 6504)).toBeLessThan(1.5);
  });

  // 48000 × 1001/24000 = 2002 samples per frame at 23.976; at 29.97 it is
  // 8008/5, carried as 3 × 1602 + 2 × 1601 over five frames (SMPTE ST 299 / AES).
  it("audio samples per frame at 23.976 and 29.97", () => {
    expect(textOf(run("video-framerate", { dst: "" }))).toContain("Audio per frame     2002 samples at 48000 Hz");
    expect(textOf(run("video-framerate", { src: "29.97", dst: "" }))).toContain("5 frames = 8008 samples (3 × 1602 + 2 × 1601)");
  });
});
