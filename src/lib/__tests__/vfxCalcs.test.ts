// VFX & compositing (v2.206.0): the eleven calculators and their engines, against independent oracles
// (scripts/vfx-oracle.py → fixtures/vfx-oracle.json: colour-science 0.4.7 for the log curves and the Y′CbCr matrices,
// scipy Rotation for rotation orders, numpy for TRS about a pivot and the pinhole projection, scipy PchipInterpolator /
// CubicHermiteSpline for the retime curves, the Fresnel equations written out) and against values derived by hand
// (audio cadence, retime counts, field of view, Froude scaling, impulses). Every calculator is then run through the
// pane's own wrap (guardEngResult + tidyResultSubscripts) on its defaults and under adversarial input.
import * as fs from "fs";
import * as path from "path";
import { VFX_CALCS } from "../vfxCalcs";
import { audioCadence, curveIntegral, curveSlope, curveValue, frameRange, makeCurve, readRate, retime, syncOffset } from "../vfxTime";
import { cameraMatch, eulerMatrix, gimbalLocked, projection, SENSOR_PRESETS, type Order } from "../vfxCamera";
import { fresnelExact, schlick, shading, transform } from "../vfxGeometry";
import { chromaKey, composite, logConvert, logCurve, porterDuff, srgbDecode, srgbEncode, toYCbCr, type RGBA } from "../vfxColour";
import { cfl, drop, froudeScale, impact } from "../vfxSim";
import { guardEngResult } from "../finiteResult";
import { tidyResultSubscripts, tidySubscripts } from "../subscriptText";
import { cbcrSvg } from "../vfxFigures";
import { parseMathAst, type Node } from "../mathParse";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const O = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "vfx-oracle.json"), "utf8"));

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = VFX_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  // Exactly what the pane does to every ENG_CALCS entry.
  return tidyResultSubscripts(guardEngResult(c.compute((k) => vals[k] ?? "")));
}
const okText = (o: AnalyzeOutput): string => {
  expect(o.ok).not.toBe(false);
  return o.text;
};
const refused = (o: AnalyzeOutput, re?: RegExp): void => {
  expect(o.ok).toBe(false);
  expect(o.text).not.toMatch(/NaN|Infinity|undefined|—/);
  if (re) expect(o.text).toMatch(re);
};
const close = (a: number, b: number, tol = 1e-9): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};

// ---------------------------------------------------------------------------------------------------------------

describe("registry", () => {
  test("eleven calculators, unique ids, one group", () => {
    expect(VFX_CALCS.map((c) => c.id)).toEqual([
      "vfx-retime", "vfx-frame-range", "vfx-camera-match", "vfx-projection", "vfx-transform", "vfx-shading",
      "vfx-log", "vfx-composite", "vfx-chroma-key", "vfx-sim-scale", "vfx-collision",
    ]);
    expect(new Set(VFX_CALCS.map((c) => c.group))).toEqual(new Set(["VFX & compositing"]));
  });
  test("the pane registers the group right after Light & camera and spreads the registry", () => {
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    expect(pane).toMatch(/"Light & camera",\r?\n {2}"VFX & compositing",/);
    expect(pane).toMatch(/\.\.\.VFX_CALCS,/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------------------------------------------

describe("log curves against colour-science 0.4.7", () => {
  for (const [id, data] of Object.entries(O.log as Record<string, { encode: number[][]; decode: number[][] }>)) {
    test(`${id}: encode and decode`, () => {
      const c = logCurve(id)!;
      for (const [x, y] of data.encode) close(c.encode(x), y, 1e-12);
      for (const [y, x] of data.decode) close(c.decode(y) as number, x, 1e-12);
    });
  }
});

// The second source: numbers READ from the documents named in vfxColour.ts (2026-10-29), as those documents print them.
describe("log curves against the documents' printed values (the second source)", () => {
  const at = (id: string, x: number): number => logCurve(id)!.encode(x);
  test("ARRI Usage in VFX: LogC3 EI 800 maps 18 % grey to 0.391 (400/1023)", () => {
    expect(at("logc3", 0.18).toFixed(3)).toBe("0.391");
    expect(Math.round(at("logc3", 0.18) * 1023)).toBe(400);
  });
  test("ARRI LogC4 specification test vectors: 0.0 → 0.0929, 0.18 → 0.2784", () => {
    expect(at("logc4", 0).toFixed(4)).toBe("0.0929");
    expect(at("logc4", 0.18).toFixed(4)).toBe("0.2784");
  });
  test("RED white paper mapping table: −0.01 → 0, 0 → 0.091551, 0.18 → 0.333333, 1 → 0.493449, 184.322 → 1", () => {
    for (const [x, y] of [[-0.01, 0], [0, 0.091551], [0.18, 0.333333], [1, 0.493449], [184.322, 1]]) expect(Math.abs(at("log3g10", x) - y)).toBeLessThan(1e-6);
  });
  test("Sony technical summary: S-Log3 0 %, 18 %, 90 % at 95, 420, 598 (10-bit)", () => {
    expect(Math.round(at("slog3", 0) * 1023)).toBe(95);
    close(at("slog3", 0.18), 420 / 1023, 1e-12);
    expect(Math.round(at("slog3", 0.9) * 1023)).toBe(598);
  });
  test("Panasonic camera instructions: V-Log 0 %, 18 %, 90 % at 128, 433, 602 (10-bit)", () => {
    expect(Math.round(at("vlog", 0) * 1023)).toBe(128);
    expect(Math.round(at("vlog", 0.18) * 1023)).toBe(433);
    expect(Math.round(at("vlog", 0.9) * 1023)).toBe(602);
  });
  // ACES: the specifications print equations, not test values; their constants are the curve's own (and 18 % grey
  // follows from them, so this pins the arithmetic, not a second published number).
  test("ACEScct and ACEScc (S-2016-001, S-2014-003 constants): 18 % grey 0.4135884", () => {
    expect(Math.abs(at("acescct", 0.18) - 0.4135884)).toBeLessThan(1e-7);
    expect(Math.abs(at("acescc", 0.18) - 0.4135884)).toBeLessThan(1e-7);
  });
  test("Cineon convention (Lustre, SMPTE Journal): black 95 at linear 0, white 685 at linear 1, for any points chosen", () => {
    close(logCurve("cineon")!.encode(0) * 1023, 95, 1e-12);
    close(logCurve("cineon")!.encode(1) * 1023, 685, 1e-12);
    const c = logCurve("cineon", 64, 700)!;
    close(c.encode(0) * 1023, 64, 1e-12);
    close(c.encode(1) * 1023, 700, 1e-12);
  });
  test("Canon Log 3 is not offered (one source only)", () => {
    expect(logCurve("clog3")).toBeNull();
    expect(JSON.stringify(VFX_CALCS.find((c) => c.id === "vfx-log")!.fields)).not.toMatch(/Canon/);
  });
  test("every curve round-trips across six decades and through its toe", () => {
    for (const id of ["logc3", "logc4", "slog3", "vlog", "log3g10", "acescct", "acescc", "cineon"]) {
      const c = logCurve(id)!;
      // The published break points are rounded (V-Log decodes from 0.181 while 0.01 linear encodes to 0.18101), so a
      // value between two rounded constants comes back by the other branch: agreement to 10⁻⁶, as in colour-science.
      for (const x of [0.0001, 0.003, 0.01, 0.18, 1, 10, 100]) close(c.decode(c.encode(x)) as number, x, 1e-6);
    }
  });
});

describe("Y′CbCr against colour-science", () => {
  test.each(["601", "709"] as const)("BT.%s", (m) => {
    for (const [rgb, ycc] of O.ycbcr[m] as Array<[[number, number, number], number[]]>) {
      const r = toYCbCr(rgb, m);
      for (let i = 0; i < 3; i++) close(r[i], ycc[i], 1e-12);
    }
  });
});

describe("rotation orders against scipy Rotation (lower-case, extrinsic axes)", () => {
  test("every order and angle set: matrix and quaternion", () => {
    for (const r of O.rotations as Array<{ order: Order; angles: [number, number, number]; matrix: number[][]; quat: number[] }>) {
      const M = eulerMatrix(r.order, r.angles);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(M[i][j], r.matrix[i][j], 1e-12);
      const t = transform({ t: [0, 0, 0], r: r.angles, s: [1, 1, 1], order: r.order, pivot: [0, 0, 0], points: [], up: "none" });
      if (!t.ok) throw new Error(t.error);
      for (let i = 0; i < 4; i++) close(t.quat[i], r.quat[i], 1e-9);
    }
  });
});

describe("TRS about a pivot against numpy", () => {
  test.each((O.trs as Array<Record<string, unknown>>).map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const k = c as { t: [number, number, number]; r: [number, number, number]; s: [number, number, number]; order: Order; p: [number, number, number]; pts: Array<[number, number, number]>; M: number[][]; inv: number[][]; det: number; out: number[][] };
    const res = transform({ t: k.t, r: k.r, s: k.s, order: k.order, pivot: k.p, points: k.pts, up: "none" });
    if (!res.ok) throw new Error(res.error);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      close(res.M[i][j], k.M[i][j], 1e-12);
      close(res.inv[i][j], k.inv[i][j], 1e-12);
    }
    close(res.det, k.det, 1e-12);
    k.out.forEach((p, i) => p.forEach((v, j) => close(res.out[i][j], v, 1e-12)));
  });
});

describe("retime curves against scipy", () => {
  test.each((O.curves as Array<Record<string, number[] | number[][]>>).map((c, i) => [i, c] as const))("key set %i", (_i, c) => {
    const keys = c.keys as Array<[number, number]>;
    const xs = c.x as number[];
    const p = makeCurve(keys, "hermite");
    const e = makeCurve(keys, "ease");
    const l = makeCurve(keys, "linear");
    xs.forEach((x, i) => {
      close(curveValue(p, x), (c.pchip as number[])[i], 1e-12);
      close(curveSlope(p, x), (c.pchip_d as number[])[i], 1e-9);
      close(curveIntegral(p, keys[0][0], x), (c.pchip_int as number[])[i], 1e-12);
      close(curveValue(e, x), (c.ease as number[])[i], 1e-12);
      close(curveIntegral(e, keys[0][0], x), (c.ease_int as number[])[i], 1e-12);
      close(curveValue(l, x), (c.linear as number[])[i], 1e-12);
    });
  });
});

describe("projection against numpy", () => {
  test.each((O.projection as Array<Record<string, unknown>>).map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const k = c as { cam: [number, number, number]; rot: [number, number, number]; order: Order; f: number; W: number; H: number; resW: number; resH: number; p: [number, number, number]; pc: number[]; u: number; v: number };
    const r = projection({ cam: k.cam, rot: k.rot, order: k.order, f: k.f, W: k.W, H: k.H, resW: k.resW, resH: k.resH, point: k.p, move: [0, 0, 0], near: 1, far: 2, shutter: 180, frames: 1 });
    if (!r.ok) throw new Error(r.error);
    k.pc.forEach((v, i) => close(r.p0.pc[i], v, 1e-12));
    close(r.p0.u, k.u, 1e-12);
    close(r.p0.v, k.v, 1e-12);
  });
});

describe("Fresnel: exact and Schlick against the equations written out", () => {
  test("every IOR and angle", () => {
    for (const [n, c, exact, sch] of O.fresnel as number[][]) {
      close(fresnelExact(n, c), exact, 1e-12);
      close(schlick(((n - 1) / (n + 1)) ** 2, c), sch, 1e-12);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Hand-derived values
// ---------------------------------------------------------------------------------------------------------------

describe("time", () => {
  test("48 kHz at 29.97: 1602, 1601, 1602, 1601, 1602 (SMPTE ST 299-1), 8008 per five frames", () => {
    const r = readRate("29.97");
    if ("error" in r) throw new Error(r.error);
    const c = audioCadence(48000, r.fps);
    if ("error" in c) throw new Error(c.error);
    expect(c.sequence).toEqual([1602, 1601, 1602, 1601, 1602]);
    expect(c.cycleSamples).toBe(8008);
    close(c.perFrameValue, 1601.6, 1e-12);
  });
  test("whole-sample rates: 2000 at 24, 2002 at 23.976, 1920 at 25", () => {
    for (const [fps, n] of [["24", 2000], ["23.976", 2002], ["25", 1920]] as const) {
      const r = readRate(fps);
      if ("error" in r) throw new Error(r.error);
      const c = audioCadence(48000, r.fps);
      if ("error" in c) throw new Error(c.error);
      expect(c.sequence).toEqual([n]);
    }
  });
  test("96 kHz at 29.97 and 48 kHz at 59.94 carry 16016 and 4004 per five frames", () => {
    const r = readRate("29.97");
    const r2 = readRate("59.94");
    if ("error" in r || "error" in r2) throw new Error("rate");
    const a = audioCadence(96000, r.fps);
    const b = audioCadence(48000, r2.fps);
    if ("error" in a || "error" in b) throw new Error("cadence");
    expect(a.cycleSamples).toBe(16016);
    expect(b.cycleSamples).toBe(4004);
    expect(a.sequence.reduce((s, v) => s + v, 0)).toBe(16016);
  });
  test("sync offset: 2 frames at 29.97 / 48 kHz = 3203.2 samples = 66.7333 ms", () => {
    const r = readRate("30000/1001");
    if ("error" in r) throw new Error(r.error);
    const o = syncOffset(2, "frames", 48000, r.fps);
    if ("error" in o) throw new Error(o.error);
    close(o.samples, 3203.2, 1e-12);
    close(o.ms, (2 * 1001) / 30, 1e-12);
    expect(o.wholeSamples).toBe(false);
  });
  test("40 % of 48 frames is 120 frames: 24 on frames, 94 between, 2 past the end; shutter 180° looks like 450°", () => {
    const r = retime({ mode: "constant", interp: "linear", first: 1001, last: 1048, outFirst: 1001, speed: 40, keys: [], fps: 24, shutter: 180 });
    if (!r.ok) throw new Error(r.error);
    expect(r.nOut).toBe(120);
    expect(r.counts).toEqual({ on: 24, repeat: 0, between: 94, outside: 2 });
    close(r.frames[1].src, 1001.4, 1e-12);
    close(r.effMax as number, 450, 1e-12);
    close(r.durationOut, 5, 1e-12);
  });
  test("200 % drops every other frame; −100 % plays backwards from the last frame", () => {
    const a = retime({ mode: "constant", interp: "linear", first: 1001, last: 1048, outFirst: 1001, speed: 200, keys: [], fps: 24, shutter: 180 });
    const b = retime({ mode: "constant", interp: "linear", first: 1001, last: 1048, outFirst: 1001, speed: -100, keys: [], fps: 24, shutter: 180 });
    if (!a.ok || !b.ok) throw new Error("retime");
    expect(a.nOut).toBe(24);
    // Positions 1001, 1003 … 1047: the 24 even frames, 1048 included, are never shown.
    expect(a.dropped).toHaveLength(24);
    expect(a.dropped[a.dropped.length - 1]).toBe(1048);
    expect(b.frames[0].src).toBe(1048);
    expect(b.frames[47].src).toBe(1001);
    close(a.effMin as number, 90, 1e-12);
  });
  test("a ramp's source position is the integral of its speed, and it ends when the source is used up", () => {
    const keys: Array<[number, number]> = [[1001, 100], [1013, 25], [1060, 25], [1075, 100]];
    const r = retime({ mode: "ramp", interp: "linear", first: 1001, last: 1048, outFirst: 1001, speed: 0, keys, fps: 24, shutter: 180 });
    if (!r.ok) throw new Error(r.error);
    const c = makeCurve(keys, "linear");
    r.frames.forEach((f) => close(f.src, 1001 + curveIntegral(c, 1001, f.out) / 100, 1e-9));
    expect(r.frames[r.frames.length - 1].src).toBeLessThan(1049);
    expect(1001 + curveIntegral(c, 1001, r.frames[r.frames.length - 1].out + 1) / 100).toBeGreaterThanOrEqual(1049 - 1e-9);
  });
  test("plate range with handles and the 1001 convention", () => {
    const r = frameRange({ cutIn: 101, cutOut: 148, head: 8, tail: 8, start: 1001, pad: 4 });
    if (!r.ok) throw new Error(r.error);
    expect([r.plateFirst, r.plateLast, r.cutFirst, r.cutLast, r.total, r.offset]).toEqual([1001, 1064, 1009, 1056, 64, 908]);
  });
});

describe("camera", () => {
  test("36 × 24 mm at 50 mm: 39.598° × 26.991°, 46.793° diagonal; and back from the horizontal angle", () => {
    const c = cameraMatch({ W: 36, H: 24, squeeze: 1, f: 50, fov: null, fovAxis: "h", resW: 6000, resH: 4000, fit: "fill" });
    if (!c.ok) throw new Error(c.error);
    close(c.hFov, (2 * Math.atan(0.36) * 180) / Math.PI, 1e-12);
    expect(c.hFov.toFixed(3)).toBe("39.598");
    expect(c.vFov.toFixed(3)).toBe("26.991");
    expect(c.dFov.toFixed(3)).toBe("46.793");
    close(c.crop, 1, 1e-12);
    const back = cameraMatch({ W: 36, H: 24, squeeze: 1, f: null, fov: c.hFov, fovAxis: "h", resW: 6000, resH: 4000, fit: "fill" });
    if (!back.ok) throw new Error(back.error);
    close(back.f, 50, 1e-12);
  });
  test("a 2× anamorphic doubles the horizontal filmback; crop factor of S35 HD is 1.587", () => {
    const c = cameraMatch({ W: 20.22, H: 16.95, squeeze: 2, f: 35, fov: null, fovAxis: "h", resW: 3328, resH: 2790, fit: "fill" });
    if (!c.ok) throw new Error(c.error);
    close(c.hFov, (2 * Math.atan(40.44 / 70) * 180) / Math.PI, 1e-12);
    const s35 = SENSOR_PRESETS.find((p) => p.id === "lf-s35-hd")!;
    const d = cameraMatch({ W: s35.W, H: s35.H, squeeze: 1, f: 35, fov: null, fovAxis: "h", resW: 1920, resH: 1080, fit: "fill" });
    if (!d.ok) throw new Error(d.error);
    expect(d.crop.toFixed(3)).toBe("1.587");
  });
  test("fit modes: a 16:9 image on a 3:2 filmback fills by width and overscans by height", () => {
    const fill = cameraMatch({ W: 36, H: 24, squeeze: 1, f: 35, fov: null, fovAxis: "h", resW: 1920, resH: 1080, fit: "fill" });
    const over = cameraMatch({ W: 36, H: 24, squeeze: 1, f: 35, fov: null, fovAxis: "h", resW: 1920, resH: 1080, fit: "overscan" });
    if (!fill.ok || !over.ok) throw new Error("fit");
    expect(fill.resolvedFit).toBe("horizontal");
    close(fill.gateH, 36 / (16 / 9), 1e-12);
    expect(over.resolvedFit).toBe("vertical");
    close(over.gateW, 24 * (16 / 9), 1e-12);
    expect(over.coverH).toBeLessThan(1);
  });
  test("gimbal lock is the middle axis of the order at ±90°", () => {
    expect(gimbalLocked("XYZ", [10, 90, 20]).locked).toBe(true);
    expect(gimbalLocked("XYZ", [90, 10, 20]).locked).toBe(false);
    expect(gimbalLocked("ZXY", [-90, 0, 0]).locked).toBe(true);
    expect(gimbalLocked("XYZ", [0, -270, 0]).locked).toBe(true);
  });
  test("a point behind the camera is refused by name", () => {
    const r = projection({ cam: [0, 0, 0], rot: [0, 0, 0], order: "XYZ", f: 35, W: 36, H: 24, resW: 1920, resH: 1080, point: [0, 0, 5], move: [0, 0, 0], near: 1, far: 2, shutter: 180, frames: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/behind the camera/);
  });
  test("parallax f·b·k/d: 35 mm, 0.1 per frame sideways, depths 5 and 50", () => {
    const r = projection({ cam: [0, 0, 0], rot: [0, 0, 0], order: "XYZ", f: 35, W: 36, H: 24, resW: 3600, resH: 2400, point: [0, 0, -10], move: [0.1, 0, 0], near: 5, far: 50, shutter: 180, frames: 10 });
    if (!r.ok) throw new Error(r.error);
    close(Math.abs(r.shiftNear), (35 * 0.1 * 100) / 5, 1e-12);
    close(r.parallax, 35 * 0.1 * 100 * (1 / 5 - 1 / 50), 1e-12);
    close(r.speed, (35 * 0.1 * 100) / 10, 1e-12);
    close(r.blur, r.speed / 2, 1e-12);
  });
});

describe("geometry", () => {
  test("Y-up → Z-up sends up to up and −Z forward to +Y", () => {
    const r = transform({ t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], order: "XYZ", pivot: [0, 0, 0], points: [[0, 1, 0], [0, 0, -1]], up: "y2z" });
    if (!r.ok || !r.conv) throw new Error("conv");
    expect(r.conv.points).toEqual([[0, 0, 1], [0, 1, 0]]);
  });
  test("a negative scale mirrors (determinant < 0); a zero scale is refused", () => {
    const m = transform({ t: [0, 0, 0], r: [0, 0, 0], s: [-1, 1, 1], order: "XYZ", pivot: [0, 0, 0], points: [], up: "none" });
    if (!m.ok) throw new Error(m.error);
    expect(m.mirrored).toBe(true);
    const z = transform({ t: [0, 0, 0], r: [0, 0, 0], s: [1, 0, 1], order: "XYZ", pivot: [0, 0, 0], points: [], up: "none" });
    expect(z.ok).toBe(false);
  });
  test("90° rotations are exact (0 and ±1, no 6×10⁻¹⁷)", () => {
    const r = transform({ t: [0, 0, 0], r: [90, 0, 0], s: [1, 1, 1], order: "XYZ", pivot: [0, 0, 0], points: [[0, 1, 0]], up: "none" });
    if (!r.ok) throw new Error(r.error);
    expect(r.out[0]).toEqual([0, 0, 1]);
  });
  test("a flat 8-bit texel (128, 128, 255) decodes to (1/255, 1/255, 1), and DirectX flips green", () => {
    const base = { T: [1, 0, 0] as [number, number, number], B: [0, 0, -1] as [number, number, number], N: [0, 1, 0] as [number, number, number], L: [0, 1, 0] as [number, number, number], V: [0, 1, 0] as [number, number, number], shininess: 10, ior: 1.5, f0: null };
    const g = shading({ ...base, texel: [128, 128, 255], encoding: "8", green: "gl" });
    const x = shading({ ...base, texel: [128, 100, 255], encoding: "8", green: "dx" });
    if (!g.ok || !x.ok) throw new Error("shading");
    close(g.decoded[0], 1 / 255, 1e-12);
    close(g.decoded[2], 1, 1e-12);
    close(x.decoded[1], -((100 / 255) * 2 - 1), 1e-12);
    // Light and view straight down the normal: Lambert 1, F = F0 = 0.04.
    close(shading({ ...base, texel: [0.5, 0.5, 1], encoding: "float", green: "gl" }).ok ? (shading({ ...base, texel: [0.5, 0.5, 1], encoding: "float", green: "gl" }) as { lambert: number }).lambert : NaN, 1, 1e-12);
  });
});

describe("colour", () => {
  test("Porter–Duff identities on premultiplied values", () => {
    const A: RGBA = [0.4, 0.2, 0.1, 0.5];
    const B: RGBA = [0.1, 0.3, 0.6, 1];
    expect(porterDuff("over", A, B)).toEqual([0.4 + 0.05, 0.2 + 0.15, 0.1 + 0.3, 1]);
    expect(porterDuff("in", A, B)).toEqual(A);
    expect(porterDuff("out", A, B)).toEqual([0, 0, 0, 0]);
    expect(porterDuff("atop", A, B)[3]).toBe(1);
    expect(porterDuff("plus", A, B)[3]).toBe(1.5);
  });
  test("premultiplied treated as straight darkens (dark fringe); straight treated as premultiplied brightens (halo)", () => {
    const p = composite([0.4, 0.2, 0.1, 0.5], [0.1, 0.3, 0.6, 1], "premult", "over", "multiply");
    const s = composite([0.8, 0.4, 0.2, 0.5], [0.1, 0.3, 0.6, 1], "straight", "over", "multiply");
    if (!p.ok || !s.ok) throw new Error("composite");
    expect(p.mistake.delta.every((v) => v <= 0)).toBe(true);
    expect(s.mistake.delta.every((v) => v >= 0)).toBe(true);
    // The same pixel either way: straight (0.8, 0.4, 0.2, 0.5) is premultiplied (0.4, 0.2, 0.1, 0.5).
    for (let i = 0; i < 4; i++) close(p.result[i], s.result[i], 1e-15);
  });
  test("a 50/50 mix of 1 and 0 is 0.5 in linear light but 0.214 when mixed on sRGB values", () => {
    close(srgbDecode(0.5 * srgbEncode(1) + 0.5 * srgbEncode(0)), 0.21404114, 1e-6);
    close(srgbDecode(srgbEncode(0.37)), 0.37, 1e-12);
  });
  test("chroma key: alpha 0 inside the tolerance, ramps, 1 beyond; spill limited by average or max", () => {
    const k = chromaKey([0.1, 0.65, 0.2], [0.1, 0.65, 0.2], "709", "cbcr", 0.05, 0.1, "auto", "average");
    if (!k.ok) throw new Error(k.error);
    expect(k.alpha).toBe(0);
    const m = chromaKey([0.1, 0.65, 0.2], [0.35, 0.55, 0.3], "709", "cbcr", 0.1, 0.2, "auto", "max");
    if (!m.ok) throw new Error(m.error);
    close(m.alpha, (m.dCbCr - 0.1) / 0.2, 1e-12);
    expect(m.suppressed[1]).toBe(0.35);
    const hard = chromaKey([0.1, 0.65, 0.2], [0.35, 0.55, 0.3], "709", "cbcr", 0.1, 0, "auto", "average");
    if (!hard.ok) throw new Error(hard.error);
    expect(hard.alpha).toBe(1);
    expect(hard.suppressed[1]).toBeCloseTo(0.325, 12);
  });
  test("a log value below black decodes to a negative linear value, flagged, not refused", () => {
    const r = logConvert(logCurve("slog3")!, 0.05, "code");
    if (!r.ok) throw new Error(r.error);
    expect(r.belowBlack).toBe(true);
    expect(r.linear).toBeLessThan(0);
    expect(r.stops).toBeNull();
    const o = run("vfx-log", { kind: "code", value: "0.05" });
    expect(okText(o)).toMatch(/below Sony S-Log3's black/);
  });
});

describe("physics", () => {
  test("Froude: 1:16 at 24 fps is shot at 96 fps; Re falls by 64", () => {
    const s = froudeScale({ n: 16, fps: 24, fall: 10, U: 5, L: 2, nu: 1.004e-6, rho: 998, sigma: 0.0728 });
    if (!s.ok) throw new Error(s.error);
    close(s.shootFps, 96, 1e-12);
    close(s.Re / s.ReM, 64, 1e-12);
    close(s.fall!.tm * 4, s.fall!.t, 1e-12);
  });
  test("CFL: 5 cm voxels, 8 m/s, 24 fps, C = 1: 7 substeps", () => {
    const c = cfl(0.05, 8, 24, 1);
    if (!c.ok) throw new Error(c.error);
    expect(c.substeps).toBe(7);
    close(c.dtMax, 0.00625, 1e-12);
  });
  test("drop in centimetres: g = 980.665 cm/s², 2 m in 0.63866 s", () => {
    const d = drop(200, 0.01, 0.5);
    if (!d.ok) throw new Error(d.error);
    close(d.g, 980.665, 1e-12);
    close(d.t, Math.sqrt(400 / 980.665), 1e-12);
    close(d.bounce, 50, 1e-12);
  });
  test("equal masses, e = 1, no friction: velocities exchange and no energy is lost", () => {
    const r = impact({ m1: 2, m2: 2, u1: 3, u2: 0, vt: 0, e: 1, mu: 0 });
    if (!r.ok) throw new Error(r.error);
    close(r.v1n, 0, 1e-12);
    close(r.v2n, 3, 1e-12);
    close(r.lost, 0, 1e-12);
  });
  test("friction: sticks when μJn covers the sliding momentum, slides otherwise", () => {
    const stick = impact({ m1: 1, m2: null, u1: 10, u2: 0, vt: 2, e: 0.5, mu: 0.5 });
    const slide = impact({ m1: 1, m2: null, u1: 10, u2: 0, vt: 20, e: 0.5, mu: 0.5 });
    if (!stick.ok || !slide.ok) throw new Error("impact");
    expect(stick.sticks).toBe(true);
    close(stick.v1t, 0, 1e-12);
    expect(slide.sticks).toBe(false);
    close(slide.v1t, 20 - 0.5 * 15, 1e-12);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Every calculator, as the pane runs it
// ---------------------------------------------------------------------------------------------------------------

function leaves(n: Node, out: string[] = []): string[] {
  switch (n.k) {
    case "text": out.push(n.v); break;
    case "row": n.items.forEach((x) => leaves(x, out)); break;
    case "frac": leaves(n.num, out); leaves(n.den, out); break;
    case "sup": leaves(n.base, out); leaves(n.sup, out); break;
    case "sub": leaves(n.base, out); leaves(n.sub, out); break;
    case "subsup": leaves(n.base, out); leaves(n.sub, out); leaves(n.sup, out); break;
    case "rad": if (n.degree) leaves(n.degree, out); leaves(n.radicand, out); break;
    case "delim": leaves(n.inner, out); break;
    case "nary": out.push(n.chr); leaves(n.sub, out); leaves(n.sup, out); leaves(n.body, out); break;
    case "func": out.push(n.name); leaves(n.arg, out); break;
    default: break;
  }
  return out;
}
const letters = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "").replace(/abs|min|max|normalize|arctan|tan/g, "");

describe.each(VFX_CALCS.map((c) => [c.id] as const))("%s", (id) => {
  test("computes on its defaults, draws, and keeps the display contract", () => {
    const o = run(id);
    const text = okText(o);
    expect(text).not.toMatch(/NaN|Infinity|undefined|not finite|—/);
    expect(text).not.toMatch(/\d[eE][+-]?\d/);
    expect(text).not.toMatch(/\^/);
    expect(text).not.toMatch(/(^|[\s(=])-\d/m);
    const plots = (o.blocks ?? []).filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThanOrEqual(1);
    for (const p of plots) if (p.kind === "plot") expect(p.svg).not.toMatch(/NaN|Infinity|undefined/);
  });
  test("opens with a plain-language reading built from the numbers", () => {
    const o = run(id);
    const first = (o.blocks ?? [])[0];
    expect(first?.kind).toBe("line");
    if (first?.kind === "line") {
      expect(first.text).toMatch(/\d/);
      expect(first.text.length).toBeLessThan(520);
      expect(first.text).toMatch(/\.$/);
    }
  });
  test("every formula parses and typesets as its fallback reads", () => {
    const o = run(id);
    for (const b of o.blocks ?? []) {
      if (b.kind !== "math") continue;
      expect(() => mathToOmml(b.math)).not.toThrow();
      expect(letters(leaves(parseMathAst(b.math)).join(""))).toBe(letters(b.fallback));
    }
  });
  test("has an honest assumes note", () => {
    expect(okText(run(id))).toMatch(/Assumes:/);
  });
  test("every field emptied, or filled with rubbish, refuses by name or still computes; never NaN", () => {
    const c = VFX_CALCS.find((x) => x.id === id)!;
    for (const f of c.fields) {
      if (f.kind === "select") continue;
      for (const bad of ["", "abc", "inf", "NaN", "1e999", "-1e999"]) {
        const o = run(id, { [f.key]: bad });
        // A refusal may quote what was typed ("NaN" is not a finite number); the result itself never prints one.
        expect(o.text.replace(/"[^"]*"/g, "")).not.toMatch(/NaN|Infinity|undefined/);
        if (o.ok === false) expect(o.text.length).toBeGreaterThan(10);
      }
    }
  });
  test("every select option computes", () => {
    const c = VFX_CALCS.find((x) => x.id === id)!;
    for (const f of c.fields) {
      if (f.kind !== "select") continue;
      for (const opt of f.options ?? []) {
        // The texel default is 8-bit: the 16-bit and float encodings run with a texel in their own range.
        const texel: Record<string, string> = f.key === "enc" ? { texel: opt.value === "16" ? "46260, 35980, 59110" : opt.value === "float" ? "0.706, 0.549, 0.902" : "180, 140, 230" } : {};
        const o = run(id, { ...texel, [f.key]: opt.value });
        expect({ key: f.key, opt: opt.value, ok: o.ok !== false, text: o.ok === false ? o.text : "" }).toEqual({ key: f.key, opt: opt.value, ok: true, text: "" });
      }
    }
  });
});

describe("adversarial input, refused by name", () => {
  test("zero, negative and non-finite frame rates", () => {
    refused(run("vfx-retime", { fps: "0" }), /greater than zero/);
    refused(run("vfx-retime", { fps: "-24" }), /greater than zero/);
    refused(run("vfx-retime", { fps: "inf" }), /not a finite number|not a number/);
    refused(run("vfx-frame-range", { fps: "0" }), /greater than zero/);
  });
  test("speed 0 % is a freeze, refused; negative speed plays backwards (documented)", () => {
    refused(run("vfx-retime", { speed: "0" }), /freeze/);
    expect(okText(run("vfx-retime", { speed: "-50" }))).toMatch(/At −50 % speed/);
  });
  test("a ramp ending at 0 % never finishes the shot", () => {
    refused(run("vfx-retime", { mode: "ramp", ramp: "1001, 100\n1010, 0" }), /never reaches the end/);
  });
  test("keys out of order", () => {
    refused(run("vfx-retime", { mode: "map", map: "1001, 1001\n1001, 1010" }), /must increase/);
  });
  test("padding overflow and a negative start frame", () => {
    refused(run("vfx-frame-range", { start: "9990", pad: "4" }), /Padding overflow: the plate runs to frame 10053, which needs 5 digits/);
    refused(run("vfx-frame-range", { start: "-5" }), /negative/);
  });
  test("gimbal lock is named, not refused", () => {
    expect(okText(run("vfx-transform", { r: "10, 90, 20" }))).toMatch(/gimbal lock/);
  });
  test("a zero-length normal texel, and a zero-length light direction", () => {
    refused(run("vfx-shading", { enc: "float", texel: "0.5, 0.5, 0.5" }), /zero-length normal/);
    refused(run("vfx-shading", { L: "0, 0, 0" }), /Light direction L.*zero length/);
    refused(run("vfx-shading", { texel: "300, 128, 255" }), /outside 0 to 255/);
  });
  test("alpha outside 0 to 1", () => {
    refused(run("vfx-composite", { A: "0.5, 0.5, 0.5, 1.2" }), /alpha 1.2 is outside 0 to 1/);
    refused(run("vfx-composite", { B: "0.5, 0.5, 0.5, -0.1" }), /alpha −0.1 is outside 0 to 1/);
  });
  test("ACEScc cannot encode a negative; a code far outside the signal is refused", () => {
    refused(run("vfx-log", { curve: "acescc", value: "-0.01" }), /ACEScc/);
    refused(run("vfx-log", { kind: "code", value: "3" }), /far outside/);
  });
  test("a point behind the camera, a separating collision, a scale below 1:1", () => {
    refused(run("vfx-projection", { point: "0, 1.6, 20", rot: "0, 0, 0" }), /behind the camera/);
    refused(run("vfx-collision", { u1: "-5" }), /separating/);
    refused(run("vfx-sim-scale", { n: "0.5" }), /not a miniature/);
  });
  test("the pane's wrap keeps a file name's underscores", () => {
    expect(okText(run("vfx-frame-range", { prefix: "sh010_comp_v001" }))).toMatch(/sh010_comp_v001\.1001\.exr/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Independent review (vfx @ dc7800e): each finding's own repro, pinned.
// ---------------------------------------------------------------------------------------------------------------

const firstLine = (o: AnalyzeOutput): string => o.text.split("\n")[0];
const ntsc = (): ReturnType<typeof readRate> => readRate("29.97");

describe("review BLOCKERS", () => {
  test("1. 96 kHz at 29.97 follows SMPTE ST 299-1:2009 Table 7: 3204 on odd frames, 3202 on even (pairs)", () => {
    const r = ntsc();
    if ("error" in r) throw new Error(r.error);
    const c = audioCadence(96000, r.fps);
    if ("error" in c) throw new Error(c.error);
    expect(c.sequence).toEqual([3204, 3202, 3204, 3202, 3204]);
    expect(c.source).toBe("st299");
    expect(c.sequence.every((n) => n % 2 === 0)).toBe(true);
    const c48 = audioCadence(48000, r.fps);
    if ("error" in c48) throw new Error(c48.error);
    expect(c48.sequence).toEqual([1602, 1601, 1602, 1601, 1602]);
    expect(c48.source).toBe("st299");
    expect(okText(run("vfx-frame-range", { fps: "29.97", rate: "96000" }))).toMatch(/Table 7: odd audio frames carry 3204 samples and even frames 3202/);
  });
  test("1. a rate Table 7 does not cover (59.94) says so", () => {
    const r = readRate("59.94");
    if ("error" in r) throw new Error(r.error);
    const c = audioCadence(48000, r.fps);
    if ("error" in c) throw new Error(c.error);
    expect(c.source).toBe("rounding");
    expect(c.cycleSamples).toBe(4004);
    expect(okText(run("vfx-frame-range", { fps: "59.94" }))).toMatch(/Table 7 does not cover 48 kHz/);
  });
  test("2. speed 70, frames 0 to 9: frame 9 is shown (held past the end), not dropped", () => {
    const r = retime({ mode: "constant", interp: "linear", first: 0, last: 9, outFirst: 0, speed: 70, keys: [], fps: 24, shutter: 180 });
    if (!r.ok) throw new Error(r.error);
    expect(r.dropped).not.toContain(9);
    expect(r.droppedCount).toBe(r.dropped.length);
  });
  test("3. speed 10⁹ over frames 0 to 10⁸: the dropped count is exact, the list is capped", () => {
    const r = retime({ mode: "constant", interp: "linear", first: 0, last: 1e8, outFirst: 0, speed: 1e9, keys: [], fps: 24, shutter: 180 });
    if (!r.ok) throw new Error(r.error);
    const shown = new Set(r.frames.map((f) => Math.min(1e8, Math.max(0, Math.round(f.src))))).size;
    expect(r.droppedCount).toBe(1e8 + 1 - shown);
    expect(r.droppedCount).toBeGreaterThan(20001);
    expect(r.dropped.length).toBeLessThanOrEqual(1000);
  });
  test("4. a 1000-key ramp computes fast; 2000 keys are refused by name", () => {
    const keys: Array<[number, number]> = Array.from({ length: 1000 }, (_, i) => [i * 2, 50 + (i % 3) * 10]);
    const t0 = Date.now();
    const r = retime({ mode: "ramp", interp: "hermite", first: 0, last: 500, outFirst: 0, speed: 0, keys, fps: 24, shutter: 180 });
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
    const many: Array<[number, number]> = Array.from({ length: 2000 }, (_, i) => [i, 100]);
    const b = retime({ mode: "ramp", interp: "linear", first: 0, last: 500, outFirst: 0, speed: 0, keys: many, fps: 24, shutter: 180 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toMatch(/2000 rows is above the 1000/);
  });
  test("5. compositing reading: black × black and grey − grey read 'the same'; HDR screen gives no runaway percentage", () => {
    expect(firstLine(run("vfx-composite", { A: "0, 0, 0, 1", B: "0, 0, 0, 1", mode: "multiply" }))).toMatch(/comes out the same as the same blend/);
    expect(firstLine(run("vfx-composite", { A: "0.5, 0.5, 0.5, 1", B: "0.5, 0.5, 0.5, 1", mode: "difference" }))).toMatch(/comes out the same as the same blend/);
    const hdr = firstLine(run("vfx-composite", { A: "2, 2, 2, 1", B: "3, 3, 3, 1", mode: "screen" }));
    expect(hdr).not.toMatch(/×10|%  ?brighter|% darker/);
    expect(hdr).toMatch(/luminance/);
  });
  test("6. 33.3333333 % of 10 frames runs 30 frames, not 31", () => {
    const r = retime({ mode: "constant", interp: "linear", first: 1, last: 10, outFirst: 1, speed: 33.3333333, keys: [], fps: 24, shutter: 180 });
    if (!r.ok) throw new Error(r.error);
    expect(r.nOut).toBe(30);
  });
});

describe("review MAJORS", () => {
  test("7. a braced subscript with a space keeps its typesetting beside a file name", () => {
    expect(tidySubscripts("x_{a b} written to out_v1.exr")).toBe("x(a b) written to out_v1.exr");
    expect(tidySubscripts("x_{a b}")).toBe("x(a b)");
  });
  test("8. 89.9999° in the middle of the order is flagged as near gimbal lock", () => {
    expect(gimbalLocked("XYZ", [0, 89.9999, 0]).near).toBe(true);
    expect(okText(run("vfx-transform", { r: "0, 89.9999, 0" }))).toMatch(/Near gimbal lock/);
    expect(okText(run("vfx-transform", { r: "0, 80, 0" }))).toMatch(/Gimbal lock: none/);
  });
  test("9. the 8-bit texel 128, 128, 128 (length 0.0068) is refused as a near-zero normal", () => {
    refused(run("vfx-shading", { texel: "128, 128, 128" }), /near-zero normal \(length 0\.00679, below 0\.0502 for 8-bit\)/);
  });
  test("10. a frame rate of 1,000 is refused as ambiguous, not read as 1 fps", () => {
    refused(run("vfx-retime", { fps: "1,000" }), /ambiguous/);
    refused(run("vfx-frame-range", { fps: "1,000" }), /ambiguous/);
    refused(run("vfx-retime", { fps: "23,976" }), /ambiguous/);
    expect(okText(run("vfx-retime", { fps: "29,97" }))).toMatch(/30000\/1001/);
  });
  test("11. a 1:1 scale reads as full scale, not '1 times lower'", () => {
    const f = firstLine(run("vfx-sim-scale", { n: "1:1" }));
    expect(f).toMatch(/full scale/);
    expect(f).not.toMatch(/1 times lower/);
  });
  test("12. a ramp that both slows and speeds up reports smearing AND strobing", () => {
    const o = okText(run("vfx-retime", { mode: "ramp", ramp: "1001, 25\n1020, 25\n1030, 400\n1060, 400" }));
    expect(o).toMatch(/both ways/);
    expect(o).toMatch(/smeared/);
    expect(o).toMatch(/strobes/);
  });
});

describe("review MINORS", () => {
  test("13. refusals carry no e-notation", () => {
    for (const o of [run("vfx-retime", { speed: "1e-20" }), run("vfx-log", { value: "2000000" }), run("vfx-projection", { point: "0, 1.6, 10", rot: "0, 0, 0" })]) {
      expect(o.ok).toBe(false);
      expect(o.text).not.toMatch(/\d[eE][+-]?\d/);
    }
    expect(run("vfx-retime", { speed: "1e-20" }).text).toMatch(/the 48-frame shot/);
  });
  test("14. singular nouns: 1 unit, 1 frame, 1 sample", () => {
    expect(firstLine(run("vfx-projection", { point: "0, 1.6, 9", rot: "0, 0, 0" }))).toMatch(/1 unit in front/);
    expect(okText(run("vfx-frame-range", { cutIn: "5", cutOut: "5" }))).toMatch(/\(1 frame\)/);
    expect(firstLine(run("vfx-frame-range", { offset: "1", offUnit: "samples" }))).toMatch(/is 1 sample \(/);
  });
  test("15. −40 stops is a tiny linear value, not 0", () => {
    const f = firstLine(run("vfx-log", { kind: "stops", value: "-40" }));
    expect(f).toMatch(/^1\.6371×10⁻¹³ linear/);
  });
  test("16. a 179.9999° field of view is refused with the value typed, never printed as 180°", () => {
    const o = run("vfx-camera-match", { given: "fov", fov: "179.9999" });
    refused(o, /179\.9999°/);
    refused(run("vfx-camera-match", { preset: "custom", W: "36 mm", H: "24 mm", f: "0.00001 mm" }), /fisheye/);
  });
  test("17. collision wording with no friction and with no sliding", () => {
    expect(firstLine(run("vfx-collision", { mu: "0" }))).toMatch(/no friction \(μ = 0\) the sliding speed stays at 150/);
    expect(firstLine(run("vfx-collision", { vt: "0" }))).toMatch(/no sliding for friction to act on/);
  });
  test("18. a quoted file name keeps its underscores", () => {
    expect(tidySubscripts('"sh_01.exr"')).toBe('"sh_01.exr"');
    expect(tidySubscripts("‘sh_01.exr’ and S_a")).toBe("‘sh_01.exr’ and Sₐ");
  });
  test("19. figures: the CbCr plane is drawn to one scale, legends untruncated, one wedge for a full-frame preset", () => {
    const svg = cbcrSvg([-0.16, -0.25], [-0.1, -0.09], 0.08, 0.15);
    const ticks = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([−-]?0\.\d+)</g)].map((m) => [Number(m[1]), Number(m[2]), m[3]] as [number, number, string]);
    const xs = ticks.filter((t) => t[1] === ticks[0][1]);
    const ys = ticks.filter((t) => t[0] !== xs[0][0] || t[1] !== xs[0][1]).filter((t) => t[0] === ticks[ticks.length - 1][0]);
    const pxPerX = (xs[xs.length - 1][0] - xs[0][0]) / (Number(xs[xs.length - 1][2].replace("−", "-")) - Number(xs[0][2].replace("−", "-")));
    const pxPerY = (ys[0][1] - ys[ys.length - 1][1]) / (Number(ys[ys.length - 1][2].replace("−", "-")) - Number(ys[0][2].replace("−", "-")));
    expect(Math.abs(pxPerX / pxPerY - 1)).toBeLessThan(0.01);
    expect(svg).not.toMatch(/…</);
    const log = run("vfx-log", { curve: "cineon" });
    for (const b of log.blocks ?? []) if (b.kind === "plot") expect(b.svg).not.toMatch(/…</);
    const ff = run("vfx-camera-match", { preset: "ff" });
    for (const b of ff.blocks ?? []) if (b.kind === "plot") {
      // No grey full-frame wedge drawn over the (identical) blue one.
      expect(b.svg).not.toMatch(/<path d="M [^"]*" fill="#888888"/);
      expect(b.svg).toMatch(/<path d="M [^"]*" fill="#1f5fa8"/);
      expect(b.svg).toMatch(/as wide as full frame/);
    }
  });
  test("20. the pixel-centre convention is stated", () => {
    expect(okText(run("vfx-projection"))).toMatch(/pixel i spans \[i, i \+ 1\) and its centre is at i \+ 0\.5/);
  });
  test("21. a typed linear value below black 'encodes', it does not 'decode'", () => {
    const f = firstLine(run("vfx-log", { value: "-0.01" }));
    expect(f).toMatch(/^−0\.01 linear is below black/);
    expect(f).toMatch(/encodes it to code/);
    expect(f).not.toMatch(/decodes/);
  });
});
