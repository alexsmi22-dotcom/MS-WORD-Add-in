// Fresnel coefficients at one interface and thin-film stacks by the
// characteristic (transfer) matrix method.
//
// CONVENTIONS, chosen once and used everywhere in this file (they are the
// conventions of S. J. Byrnes' `tmm` package, which the tests use as the
// independent oracle):
//
//   - Time dependence exp(−iωt): a plane wave is exp(i(kz − ωt)).
//   - Complex index N = n + ik with k ≥ 0 ABSORBING ("0.05+3.4i" is a metal).
//     A negative k would be optical gain under this convention and is refused.
//   - rp is the Born & Wolf / Hecht sign: rp = (n₂cosθ₁ − n₁cosθ₂)/(n₂cosθ₁ +
//     n₁cosθ₂), so at normal incidence rp = −rs. Reflectances never depend on
//     this; the reflected PHASE of p light does.
//   - The angle in the incident medium is real, so that medium must be lossless:
//     a power transmittance measured inside an absorbing medium is not defined.
//   - In every layer the branch of N·cosθ is the one with Im > 0 (the wave
//     decays as it travels), or Re > 0 when it is real. A naive square root gets
//     total internal reflection and frustrated TIR wrong.
//
// The interface quantities agree with optics.ts refraction() by construction:
// when both indices are real, the Brewster and critical angles and the
// normal-incidence reflectance are TAKEN from refraction(), never recomputed,
// so the app cannot give two answers to one question.

import { refraction } from "./optics";

// ------------------------------------------------------------------ complex

export interface Cx {
  re: number;
  im: number;
}
export const cx = (re: number, im = 0): Cx => ({ re, im });
const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im);
const sub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im);
const mul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a: Cx, s: number): Cx => cx(a.re * s, a.im * s);
const conj = (a: Cx): Cx => cx(a.re, -a.im);
export const abs2 = (a: Cx): number => a.re * a.re + a.im * a.im;
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im);
export const carg = (a: Cx): number => Math.atan2(a.im, a.re);
function div(a: Cx, b: Cx): Cx {
  // Smith's algorithm: no overflow for large |b|.
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re;
    const d = b.re + b.im * r;
    return cx((a.re + a.im * r) / d, (a.im - a.re * r) / d);
  }
  const r = b.re / b.im;
  const d = b.re * r + b.im;
  return cx((a.re * r + a.im) / d, (a.im * r - a.re) / d);
}
function csqrt(a: Cx): Cx {
  const m = cabs(a);
  if (m === 0) return cx(0, 0);
  const re = Math.sqrt((m + a.re) / 2);
  const im = Math.sqrt(Math.max(0, (m - a.re) / 2));
  return cx(re, a.im < 0 ? -im : im);
}
function ccos(z: Cx): Cx {
  return cx(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
}
function csin(z: Cx): Cx {
  return cx(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
}
const I = cx(0, 1);

/** N·cosθ in a medium of index N for the in-plane invariant n₀·sinθ₀ = beta, on the decaying branch. */
function normalComponent(N: Cx, beta: number): Cx {
  let u = csqrt(sub(mul(N, N), cx(beta * beta)));
  const tol = 100 * Number.EPSILON * Math.max(1, cabs(u));
  if (Math.abs(u.im) > tol) {
    if (u.im < 0) u = scale(u, -1);
  } else if (u.re < 0) {
    u = scale(u, -1);
  }
  return u;
}

// ------------------------------------------------------------- index input

/** A complex refractive index read from "1.38", "0.05+3.4i", "0.05 + 3.4 i", "0.05+i3.4" (i or j). */
export type IndexRead = { ok: true; n: Cx } | { ok: false; reason: string };

const NUM = String.raw`(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const INDEX_RE = new RegExp(String.raw`^\+?(${NUM})(?:([+-])(?:(${NUM})?[ij]|[ij](${NUM})))?$`);

export function readIndex(text: string, what: string): IndexRead {
  const t = (text ?? "").replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (!t) return { ok: false, reason: `${what} is empty: type an index such as 1.52, or n+ki such as 0.05+3.4i.` };
  const m = INDEX_RE.exec(t);
  if (!m) {
    return {
      ok: false,
      reason: `${what} "${text.trim()}" is not an index. Type a number (1.52) or n+ki (0.05+3.4i); k must not be negative.`,
    };
  }
  const n = Number(m[1]);
  let k = 0;
  if (m[2]) {
    const kText = m[3] ?? m[4];
    k = kText === undefined ? 1 : Number(kText);
    if (m[2] === "-") k = -k;
  }
  if (!Number.isFinite(n) || !Number.isFinite(k)) return { ok: false, reason: `${what} is not a finite number.` };
  if (k < 0) {
    return {
      ok: false,
      reason:
        `${what} has a negative extinction coefficient k. This tool uses N = n + ik with k ≥ 0 for an absorbing ` +
        "medium (time dependence exp(−iωt)); a negative k would be optical gain. Type it as n+ki.",
    };
  }
  if (!(n > 0)) return { ok: false, reason: `${what} must have a positive real part n.` };
  if (n > 1000 || k > 1000) return { ok: false, reason: `${what} is outside 0–1000; check for a typing slip.` };
  return { ok: true, n: cx(n, k === 0 ? 0 : k) };
}

// ------------------------------------------------------------------ Fresnel

export interface FresnelPoint {
  rs: Cx;
  rp: Cx;
  ts: Cx;
  tp: Cx;
  Rs: number;
  Rp: number;
  Ts: number;
  Tp: number;
  /** cosθ in the second medium (complex under TIR or absorption). */
  cosT: Cx;
}

/** Fresnel amplitude and power coefficients from a real n1 into N2 at θ (degrees, 0 ≤ θ < 90). */
export function fresnelAt(n1: number, N2: Cx, thetaDeg: number): FresnelPoint | null {
  if (![n1, N2.re, N2.im, thetaDeg].every(Number.isFinite)) return null;
  if (!(n1 > 0) || !(N2.re > 0) || N2.im < 0) return null;
  if (thetaDeg < 0 || thetaDeg >= 90) return null;
  const th = (thetaDeg * Math.PI) / 180;
  const cosI = Math.cos(th);
  const beta = n1 * Math.sin(th);
  const u1 = cx(n1 * cosI);
  const u2 = normalComponent(N2, beta);
  const cosT = div(u2, N2);
  const N2sq = mul(N2, N2);
  const rs = div(sub(u1, u2), add(u1, u2));
  const tsC = div(scale(u1, 2), add(u1, u2));
  const pNum = sub(scale(N2sq, cosI), scale(u2, n1));
  const pDen = add(scale(N2sq, cosI), scale(u2, n1));
  const rp = div(pNum, pDen);
  const tp = div(scale(N2, 2 * n1 * cosI), pDen);
  const Rs = abs2(rs);
  const Rp = abs2(rp);
  // Power transmittance: Re(N₂cosθ₂)/Re(n₁cosθ₁)·|ts|², and for p
  // Re(N₂·conj(cosθ₂))/Re(n₁cosθ₁)·|tp|² (tmm's T_from_t). Zero under TIR.
  const Ts = cosI > 0 ? (u2.re / (n1 * cosI)) * abs2(tsC) : 0;
  const Tp = cosI > 0 ? (mul(N2, conj(cosT)).re / (n1 * cosI)) * abs2(tp) : 0;
  return { rs, rp, ts: tsC, tp, Rs, Rp, Ts: Math.max(0, Ts), Tp: Math.max(0, Tp), cosT };
}

export interface FresnelResult extends FresnelPoint {
  thetaDeg: number;
  /** Refraction angle in degrees when it is real (lossless second medium, no TIR). */
  thetaTDeg: number | null;
  tir: boolean;
  absorbing: boolean;
  /** Brewster angle (real indices, from refraction()) or the pseudo-Brewster minimum of Rp (absorbing). */
  brewsterDeg: number;
  brewsterIsPseudo: boolean;
  /** Rp at that angle (0 to rounding for real indices). */
  rpAtBrewster: number;
  criticalDeg: number | null;
  reflectanceNormal: number;
  notes: string[];
}

/** Golden-section minimum of Rp on [a, b], a fixed 80 iterations. */
function minimiseRp(n1: number, N2: Cx, a: number, b: number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  const f = (t: number): number => fresnelAt(n1, N2, t)?.Rp ?? Infinity;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < 80; i++) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = f(x2);
    }
  }
  return (a + b) / 2;
}

/** The single-interface result, with the special angles. */
export function fresnel(n1: number, N2: Cx, thetaDeg: number): FresnelResult | null {
  const p = fresnelAt(n1, N2, thetaDeg);
  if (!p) return null;
  const notes: string[] = [];
  const absorbing = N2.im > 0;
  let brewsterDeg: number;
  let criticalDeg: number | null = null;
  let reflectanceNormal: number;
  let tir = false;
  let thetaTDeg: number | null = null;
  if (!absorbing) {
    const ref = refraction(n1, N2.re, thetaDeg);
    if (!ref) return null;
    brewsterDeg = ref.brewsterDeg;
    criticalDeg = ref.criticalDeg;
    reflectanceNormal = ref.reflectanceNormal;
    tir = ref.tir;
    thetaTDeg = ref.thetaTDeg;
    if (tir) {
      notes.push(
        "Beyond the critical angle there is no transmitted ray: Rs = Rp = 1 and the field in the second medium is " +
          "evanescent, so ts and tp are amplitudes of a wave that carries no power (Ts = Tp = 0).",
      );
    }
    if (n1 === N2.re) notes.push("The two indices are equal, so there is no interface and nothing is reflected.");
  } else {
    // No exact zero of Rp for an absorbing medium: the minimum is the pseudo-Brewster angle.
    let best = 0;
    let bestR = Infinity;
    for (let i = 0; i <= 1798; i++) {
      const t = i * 0.05;
      const r = fresnelAt(n1, N2, t)?.Rp ?? Infinity;
      if (r < bestR) {
        bestR = r;
        best = t;
      }
    }
    brewsterDeg = minimiseRp(n1, N2, Math.max(0, best - 0.05), Math.min(89.9999, best + 0.05));
    reflectanceNormal = fresnelAt(n1, N2, 0)?.Rs ?? NaN;
    notes.push(
      "The second medium absorbs (k > 0), so Rp never reaches zero: the angle reported is the pseudo-Brewster " +
        "angle, where Rp is smallest. There is no critical angle and no total internal reflection into an " +
        "absorbing medium; T is the power that crosses the interface, and it is then absorbed.",
    );
  }
  const rpB = fresnelAt(n1, N2, brewsterDeg)?.Rp ?? NaN;
  return {
    ...p,
    thetaDeg,
    thetaTDeg,
    tir,
    absorbing,
    brewsterDeg,
    brewsterIsPseudo: absorbing,
    rpAtBrewster: rpB,
    criticalDeg,
    reflectanceNormal,
    notes,
  };
}

// --------------------------------------------------------------- the stack

export interface Layer {
  label: string;
  n: Cx;
  /** Physical thickness, nm (resolved: a QW layer carries its thickness here). */
  dNm: number;
  /** "QW" / "HW" when the thickness was given as an optical thickness at the design wavelength. */
  wave: "" | "QW" | "HW";
}

export type Pol = "s" | "p" | "avg";

export interface StackRTA {
  R: number;
  T: number;
  A: number;
}

/** True when any layer was treated as opaque (its phase thickness capped). */
interface StackOut extends StackRTA {
  capped: boolean;
}

/** Im δ is capped here, as tmm does, so an opaque layer cannot overflow cosh/sinh (e⁻⁷⁰ is far below any measurable T). */
const MAX_IM_DELTA = 35;

/**
 * R, T, A of ambient n0 | layers (first = nearest the ambient) | substrate Ns at λ (nm), angle θ0 (deg), one
 * polarisation. The characteristic matrix in the exp(−iωt) convention:
 *   M_j = [[cos δ, −i sin δ/η], [−i η sin δ, cos δ]],  δ = 2π u_j d_j/λ,  u = N cosθ,
 *   η_s = u, η_p = N²/u (tilted admittances),  [B; C] = Π M_j [1; η_sub],
 *   r = (η₀B − C)/(η₀B + C),  T = 4 η₀ Re(η_sub)/|η₀B + C|².
 */
function stackOnePol(n0: number, layers: Layer[], Ns: Cx, lambdaNm: number, thetaDeg: number, pol: "s" | "p"): StackOut {
  const th = (thetaDeg * Math.PI) / 180;
  const beta = n0 * Math.sin(th);
  const adm = (N: Cx, u: Cx): Cx => (pol === "s" ? u : div(mul(N, N), u));
  const u0 = cx(n0 * Math.cos(th));
  const eta0 = adm(cx(n0), u0);
  const uS = normalComponent(Ns, beta);
  const etaS = adm(Ns, uS);
  // Multiply from the substrate up: [B; C] starts as [1; η_sub].
  let B = cx(1);
  let C = etaS;
  let capped = false;
  for (let j = layers.length - 1; j >= 0; j--) {
    const L = layers[j];
    const u = normalComponent(L.n, beta);
    const eta = adm(L.n, u);
    let delta = scale(u, (2 * Math.PI * L.dNm) / lambdaNm);
    if (delta.im > MAX_IM_DELTA) {
      delta = cx(delta.re, MAX_IM_DELTA);
      capped = true;
    }
    const c = ccos(delta);
    const s = csin(delta);
    const mI = mul(I, s); // i sin δ
    const nB = sub(mul(c, B), div(mul(mI, C), eta));
    const nC = sub(mul(c, C), mul(mul(mI, eta), B));
    B = nB;
    C = nC;
  }
  const den = add(mul(eta0, B), C);
  const r = div(sub(mul(eta0, B), C), den);
  const R = abs2(r);
  const T = (4 * eta0.re * etaS.re) / abs2(den);
  return { R, T: Math.max(0, T), A: 1 - R - Math.max(0, T), capped };
}

export interface StackResult extends StackRTA {
  Rs: number;
  Rp: number;
  Ts: number;
  Tp: number;
  capped: boolean;
}

/** R, T, A for the chosen polarisation ("avg" = unpolarised: the mean of s and p). */
export function stackRTA(n0: number, layers: Layer[], Ns: Cx, lambdaNm: number, thetaDeg: number, pol: Pol): StackResult | null {
  if (![n0, Ns.re, Ns.im, lambdaNm, thetaDeg].every(Number.isFinite)) return null;
  if (!(n0 > 0) || !(Ns.re > 0) || Ns.im < 0 || !(lambdaNm > 0) || thetaDeg < 0 || thetaDeg >= 90) return null;
  for (const L of layers) {
    if (![L.n.re, L.n.im, L.dNm].every(Number.isFinite) || !(L.n.re > 0) || L.n.im < 0 || !(L.dNm >= 0)) return null;
  }
  const s = stackOnePol(n0, layers, Ns, lambdaNm, thetaDeg, "s");
  const p = stackOnePol(n0, layers, Ns, lambdaNm, thetaDeg, "p");
  const pick = pol === "s" ? s : pol === "p" ? p : { R: (s.R + p.R) / 2, T: (s.T + p.T) / 2, A: (s.A + p.A) / 2 };
  const snap = (x: number): number => (Math.abs(x) < 1e-13 ? 0 : x);
  return {
    R: pick.R,
    T: pick.T,
    A: snap(pick.A),
    Rs: s.R,
    Rp: p.R,
    Ts: s.T,
    Tp: p.T,
    capped: s.capped || p.capped,
  };
}

// ------------------------------------------------------------ layer parser

export type LayersRead = { ok: true; layers: Layer[]; notes: string[] } | { ok: false; reason: string };

export const MAX_LAYERS = 400;
const MAX_REPEAT = 200;

const WAVE_RE = /(?:^|\s)(QW|HW)\s*$/i;
const THICK_RE = new RegExp(String.raw`(?:^|\s)(${NUM})\s*([A-Za-zµμ]+)?\s*$`, "i");
const INDEX_TAIL_RE = new RegExp(
  String.raw`(?:^|\s)(\+?${NUM}(?:\s*[+\-−–]\s*(?:(?:${NUM})?\s*[ij]|[ij]\s*${NUM}))?)\s*$`,
  "i",
);

/**
 * The layer list: one layer per line, nearest the ambient medium FIRST, as "label n thickness".
 * The label is optional and is a NAME ONLY ("MgF2", "H"); n is the user's index ("1.38", "0.05+3.4i");
 * the thickness is in nm ("99.6", "99.6 nm", "0.0996 µm") or "QW"/"HW" (a quarter/half wave of optical
 * thickness at the design wavelength, at NORMAL incidence: d = λ₀/(4·Re n)). "repeat N" … "end" repeats
 * the lines between; "#" starts a comment.
 */
export function readLayers(text: string, designNm: number): LayersRead {
  const raw = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const notes: string[] = [];
  type Frame = { count: number; layers: Layer[]; line: number };
  const stack: Frame[] = [{ count: 1, layers: [], line: 0 }];
  let total = 0;
  for (let li = 0; li < raw.length; li++) {
    const line = raw[li].replace(/#.*$/, "").trim();
    const where = `Line ${li + 1}`;
    if (!line) continue;
    const rep = /^repeat\s+(\S+)$/i.exec(line);
    if (rep) {
      const n = Number(rep[1]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_REPEAT) {
        return { ok: false, reason: `${where}: "repeat" needs a whole number from 1 to ${MAX_REPEAT}.` };
      }
      if (stack.length > 4) return { ok: false, reason: `${where}: repeats are nested more than four deep.` };
      stack.push({ count: n, layers: [], line: li + 1 });
      continue;
    }
    if (/^end$/i.test(line)) {
      if (stack.length < 2) return { ok: false, reason: `${where}: "end" without a "repeat" before it.` };
      const fr = stack.pop() as Frame;
      const top = stack[stack.length - 1];
      if (fr.layers.length === 0) return { ok: false, reason: `Line ${fr.line}: the repeat has no layers in it.` };
      total += fr.layers.length * (fr.count - 1);
      if (total > MAX_LAYERS) return { ok: false, reason: `The stack has more than ${MAX_LAYERS} layers after the repeats.` };
      for (let k = 0; k < fr.count; k++) top.layers.push(...fr.layers);
      continue;
    }
    // QW / HW is tested first: "1.38 QW" would otherwise read as a thickness of 1.38 in a unit "QW".
    const wm = WAVE_RE.exec(line);
    const tm = wm ? null : THICK_RE.exec(line);
    if (!wm && !tm) {
      return { ok: false, reason: `${where} "${line}": the last item must be a thickness in nm, or QW / HW.` };
    }
    let rest = line.slice(0, (wm ?? tm)?.index ?? 0).trim();
    const im = INDEX_TAIL_RE.exec(rest);
    if (!im) {
      return { ok: false, reason: `${where} "${line}": each layer needs an index and a thickness, e.g. "MgF2 1.38 99.6 nm" or "1.38 QW".` };
    }
    const idx = readIndex(im[1], `${where} index`);
    if (!idx.ok) return { ok: false, reason: idx.reason };
    rest = rest.slice(0, im.index).trim();
    let dNm = NaN;
    let wave: Layer["wave"] = "";
    if (wm) {
      wave = wm[1].toUpperCase() as "QW" | "HW";
      dNm = (wave === "QW" ? 0.25 : 0.5) * (designNm / idx.n.re);
    } else if (tm) {
      const v = Number(tm[1]);
      const unit = (tm[2] ?? "nm").toLowerCase();
      const factor = unit === "nm" ? 1 : unit === "µm" || unit === "μm" || unit === "um" ? 1000 : NaN;
      if (Number.isNaN(factor)) {
        return { ok: false, reason: `${where}: the unit "${tm[2]}" is not recognised. Thicknesses are in nm or µm (or QW / HW).` };
      }
      dNm = v * factor;
    }
    if (!Number.isFinite(dNm) || !(dNm > 0)) return { ok: false, reason: `${where}: a thickness must be positive.` };
    if (dNm > 1e7) return { ok: false, reason: `${where}: a thickness above 10 mm is outside this tool (coherent films only).` };
    total += 1;
    if (total > MAX_LAYERS) return { ok: false, reason: `The stack has more than ${MAX_LAYERS} layers.` };
    stack[stack.length - 1].layers.push({ label: rest, n: idx.n, dNm, wave });
  }
  if (stack.length > 1) return { ok: false, reason: `Line ${stack[stack.length - 1].line}: a "repeat" has no matching "end".` };
  return { ok: true, layers: stack[0].layers, notes };
}
