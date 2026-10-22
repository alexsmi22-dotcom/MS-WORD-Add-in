// Jones calculus: a fully polarised beam through polarisers, wave plates,
// general retarders and rotators.
//
// CONVENTIONS, stated once (they are printed in the tool's hint and output):
//   - Time dependence exp(−iωt), the same as thinFilm.ts: the field is
//     Re{(Ex, Ey)·exp(i(kz − ωt))}.
//   - x is horizontal (0°), angles are measured from x toward y, the beam
//     travels along +z, and the ellipse is drawn as seen LOOKING INTO THE BEAM
//     (the beam coming toward the viewer, x to the right, y up).
//   - HANDEDNESS IS THE IEEE / RIGHT-HAND-RULE CONVENTION: right-handed when the
//     field rotates the way the fingers of the right hand curl with the thumb
//     along the direction of travel, i.e. COUNTER-clockwise as seen looking
//     into the beam. The older optics convention (Born & Wolf) names the same
//     wave LEFT-handed. Under exp(−iωt), (1, i)/√2 is right-handed here.
//   - Stokes: S0 = |Ex|² + |Ey|², S1 = |Ex|² − |Ey|², S2 = 2 Re(Ex*·Ey),
//     S3 = 2 Im(Ex*·Ey); S3 > 0 is right-handed in the convention above.
//   - A retarder's FAST axis is at the given angle; the slow component gains
//     the phase exp(+iδ) relative to it (the slow wave lags under exp(−iωt)).
//     Global phases are dropped: only relative phases are physical here.

import { type Cx, cx, abs2 } from "./thinFilm";

export type JonesVec = [Cx, Cx];
type Mat = [[Cx, Cx], [Cx, Cx]];

const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im);
const mul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const conjMul = (a: Cx, b: Cx): Cx => cx(a.re * b.re + a.im * b.im, a.re * b.im - a.im * b.re); // a*·b
const expi = (t: number): Cx => cx(Math.cos(t), Math.sin(t));
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

function apply(m: Mat, v: JonesVec): JonesVec {
  return [add(mul(m[0][0], v[0]), mul(m[0][1], v[1])), add(mul(m[1][0], v[0]), mul(m[1][1], v[1]))];
}

/** A linear retarder: fast axis at θ, retardance δ (rad), as R(−θ)·diag(1, e^{iδ})·R(θ). */
function retarderMatrix(thetaRad: number, deltaRad: number): Mat {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  const e = expi(deltaRad);
  // [[c² + s²e, cs(1 − e)], [cs(1 − e), s² + c²e]]
  const omE = cx(1 - e.re, -e.im);
  return [
    [add(cx(c * c), mul(cx(s * s), e)), mul(cx(c * s), omE)],
    [mul(cx(c * s), omE), add(cx(s * s), mul(cx(c * c), e))],
  ];
}

function polariserMatrix(thetaRad: number): Mat {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  return [
    [cx(c * c), cx(c * s)],
    [cx(c * s), cx(s * s)],
  ];
}

function rotatorMatrix(rhoRad: number): Mat {
  const c = Math.cos(rhoRad);
  const s = Math.sin(rhoRad);
  return [
    [cx(c), cx(-s)],
    [cx(s), cx(c)],
  ];
}

export type JonesElement =
  | { kind: "polariser"; angleDeg: number }
  | { kind: "hwp"; angleDeg: number }
  | { kind: "qwp"; angleDeg: number }
  | { kind: "retarder"; angleDeg: number; deltaDeg: number }
  | { kind: "rotator"; angleDeg: number };

export function elementMatrix(e: JonesElement): Mat {
  switch (e.kind) {
    case "polariser":
      return polariserMatrix(rad(e.angleDeg));
    case "hwp":
      return retarderMatrix(rad(e.angleDeg), Math.PI);
    case "qwp":
      return retarderMatrix(rad(e.angleDeg), Math.PI / 2);
    case "retarder":
      return retarderMatrix(rad(e.angleDeg), rad(e.deltaDeg));
    case "rotator":
      return rotatorMatrix(rad(e.angleDeg));
  }
}

export function describeElement(e: JonesElement): string {
  const a = `${fmtAngle(e.angleDeg)}°`;
  switch (e.kind) {
    case "polariser":
      return `linear polariser, axis ${a}`;
    case "hwp":
      return `half-wave plate, fast axis ${a}`;
    case "qwp":
      return `quarter-wave plate, fast axis ${a}`;
    case "retarder":
      return `retarder δ = ${fmtAngle(e.deltaDeg)}°, fast axis ${a}`;
    case "rotator":
      return `rotator by ${a}`;
  }
}

function fmtAngle(x: number): string {
  // Ten significant figures, so 89.99999° is echoed as typed and never as 90°.
  const v = Math.abs(x) < 1e-12 ? 0 : Number(x.toPrecision(10));
  return String(v).replace(/^-/, "−");
}

export interface Stokes {
  S0: number;
  S1: number;
  S2: number;
  S3: number;
}

export interface Ellipse {
  /** Azimuth of the major axis, degrees in (−90, 90]. */
  azimuthDeg: number;
  /** Ellipticity angle χ, degrees in [−45, 45]; > 0 right-handed (IEEE). */
  ellipticityDeg: number;
  /** Minor/major axis ratio, 0 (linear) to 1 (circular). */
  axialRatio: number;
  handedness: "right" | "left" | "linear";
  /** "linear", "circular" or "elliptical". */
  shape: "linear" | "circular" | "elliptical";
}

/** Stokes parameters of a Jones vector (residuals below 1e-12·S0 snapped to 0). */
export function stokes(v: JonesVec): Stokes {
  const S0 = abs2(v[0]) + abs2(v[1]);
  const x = conjMul(v[0], v[1]);
  const snap = (q: number): number => (Math.abs(q) <= 1e-12 * Math.max(S0, Number.MIN_VALUE) ? 0 : q);
  return { S0, S1: snap(abs2(v[0]) - abs2(v[1])), S2: snap(2 * x.re), S3: snap(2 * x.im) };
}

/**
 * The intensity (of a normalised input) below which the light is reported as extinguished: a genuine
 * rounding level. Exactly crossed polarisers leave cos(90°)² ≈ 3.7×10⁻³³ (the residue of cos 90° in double
 * precision), while polarisers 5×10⁻⁵° off crossed pass a REAL 7.6×10⁻¹³, which must
 * still be reported with its state.
 */
export const DARK = 1e-28;

/** The polarisation ellipse; null when no light is present (S0 ≤ `dark`, 0 by default). */
export function ellipse(v: JonesVec, dark = 0): Ellipse | null {
  const st = stokes(v);
  if (!(st.S0 > dark)) return null;
  const s3 = Math.max(-1, Math.min(1, st.S3 / st.S0));
  const chi = 0.5 * Math.asin(s3);
  let psi = st.S1 === 0 && st.S2 === 0 ? 0 : 0.5 * Math.atan2(st.S2, st.S1);
  if (psi <= -Math.PI / 2 + 1e-12) psi += Math.PI;
  const tol = 1e-9;
  const ar = Math.abs(Math.tan(chi));
  const handedness = Math.abs(s3) < tol ? "linear" : s3 > 0 ? "right" : "left";
  const shape = Math.abs(s3) < tol ? "linear" : Math.abs(Math.abs(s3) - 1) < tol ? "circular" : "elliptical";
  const snapDeg = (d: number): number => (Math.abs(d) < 1e-9 ? 0 : d);
  return {
    azimuthDeg: snapDeg(deg(psi)),
    ellipticityDeg: snapDeg(deg(chi)),
    axialRatio: ar < tol ? 0 : Math.min(1, ar),
    handedness,
    shape,
  };
}

export interface JonesStep {
  element: JonesElement;
  out: JonesVec;
  /** Intensity after this element, as a fraction of the input intensity. */
  intensity: number;
}

export interface JonesResult {
  input: JonesVec;
  output: JonesVec;
  steps: JonesStep[];
  /** Output intensity / input intensity. */
  transmitted: number;
}

export const MAX_ELEMENTS = 100;

/** Propagates a NORMALISED input through the elements in order. */
export function propagate(input: JonesVec, elements: JonesElement[]): JonesResult | null {
  if (elements.length > MAX_ELEMENTS) return null;
  // Scaled by the largest component first, so a tiny but valid amplitude (1e-200) does not underflow |E|² to 0.
  const big = Math.max(...input.map((z) => Math.max(Math.abs(z.re), Math.abs(z.im))));
  if (!(big > 0) || !Number.isFinite(big)) return null;
  const pre: JonesVec = [cx(input[0].re / big, input[0].im / big), cx(input[1].re / big, input[1].im / big)];
  const s0 = abs2(pre[0]) + abs2(pre[1]);
  const k = 1 / Math.sqrt(s0);
  const vin: JonesVec = [cx(pre[0].re * k, pre[0].im * k), cx(pre[1].re * k, pre[1].im * k)];
  let v = vin;
  const steps: JonesStep[] = [];
  for (const e of elements) {
    if (e.kind === "polariser") {
      // A polariser's output lies EXACTLY on its axis: written as axis × projection, so a near-crossed output
      // (where the projection is a cancelling difference) keeps the axis direction to full precision instead of
      // inheriting the cancellation error in each component (−45.0000100046° for an axis at 134.99999°).
      const c = Math.cos(rad(e.angleDeg));
      const sn = Math.sin(rad(e.angleDeg));
      const proj = add(mul(cx(c), v[0]), mul(cx(sn), v[1]));
      v = [mul(cx(c), proj), mul(cx(sn), proj)];
    } else {
      v = apply(elementMatrix(e), v);
    }
    // Only sub-1e-30 residue is snapped (its intensity, 1e-60, is far below DARK). A coarser snap (1e-15) zeroed the
    // REAL 1.7e-8 × 1.7e-8 component of polarisers 10⁻⁶° off crossed and printed their state as exactly 90°.
    v = v.map((z) => cx(Math.abs(z.re) < 1e-30 ? 0 : z.re, Math.abs(z.im) < 1e-30 ? 0 : z.im)) as JonesVec;
    steps.push({ element: e, out: v, intensity: abs2(v[0]) + abs2(v[1]) });
  }
  return { input: vin, output: v, steps, transmitted: abs2(v[0]) + abs2(v[1]) };
}

/** Input states. */
export function linearState(angleDeg: number): JonesVec {
  return [cx(Math.cos(rad(angleDeg))), cx(Math.sin(rad(angleDeg)))];
}
export const RIGHT_CIRCULAR: JonesVec = [cx(Math.SQRT1_2), cx(0, Math.SQRT1_2)];
export const LEFT_CIRCULAR: JonesVec = [cx(Math.SQRT1_2), cx(0, -Math.SQRT1_2)];

// --------------------------------------------------------------- parsing

export type ElementsRead = { ok: true; elements: JonesElement[] } | { ok: false; reason: string };

const ANGLE = String.raw`([+\-−]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:°|deg)?`;
const LINE_RE = new RegExp(String.raw`^([A-Za-z\-]+(?:\s+[A-Za-z\-]+)?)\s+${ANGLE}(?:\s+${ANGLE})?$`, "i");

const KINDS: Record<string, JonesElement["kind"]> = {
  polariser: "polariser",
  polarizer: "polariser",
  pol: "polariser",
  analyser: "polariser",
  analyzer: "polariser",
  hwp: "hwp",
  "half-wave": "hwp",
  "half-wave plate": "hwp",
  qwp: "qwp",
  "quarter-wave": "qwp",
  "quarter-wave plate": "qwp",
  retarder: "retarder",
  rotator: "rotator",
};

/**
 * One element per line, in the order the light meets them:
 *   polariser 30 · hwp 22.5 · qwp 45 · retarder 30 60 (fast axis 30°, δ = 60°) · rotator 15.
 * Angles in degrees; "#" starts a comment.
 */
export function readElements(text: string): ElementsRead {
  const out: JonesElement[] = [];
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, "").trim();
    if (!line) continue;
    const where = `Line ${i + 1}`;
    const m = LINE_RE.exec(line);
    const kind = m ? KINDS[m[1].toLowerCase().replace(/\s+/g, " ")] : undefined;
    if (!m || !kind) {
      return {
        ok: false,
        reason:
          `${where} "${line}" is not an element. Use: polariser 30, hwp 22.5, qwp 45, ` +
          "retarder 30 60 (fast axis, then δ), rotator 15. Angles are in degrees.",
      };
    }
    const a = Number(m[2].replace("−", "-"));
    const b = m[3] === undefined ? undefined : Number(m[3].replace("−", "-"));
    if (!Number.isFinite(a) || (b !== undefined && !Number.isFinite(b))) return { ok: false, reason: `${where}: an angle is not a number.` };
    if (Math.abs(a) > 3600 || (b !== undefined && Math.abs(b) > 3600)) return { ok: false, reason: `${where}: angles are limited to ±3600°.` };
    if (kind === "retarder") {
      if (b === undefined) return { ok: false, reason: `${where}: a retarder needs its fast-axis angle AND its retardance δ, e.g. "retarder 30 60".` };
      out.push({ kind, angleDeg: a, deltaDeg: b });
    } else {
      if (b !== undefined) return { ok: false, reason: `${where}: a ${kind === "polariser" ? "polariser" : kind === "rotator" ? "rotator" : "wave plate"} takes one angle only.` };
      out.push({ kind, angleDeg: a });
    }
    if (out.length > MAX_ELEMENTS) return { ok: false, reason: `More than ${MAX_ELEMENTS} elements.` };
  }
  return { ok: true, elements: out };
}
