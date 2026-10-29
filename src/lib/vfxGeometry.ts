// VFX & compositing, geometry: 4×4 translate/rotate/scale composition about a pivot with an explicit rotation order,
// applied to points, inverted, checked (determinant, orthogonality, gimbal lock) and converted between Y-up and Z-up;
// and surface normals and shading: normal-map decoding (8-bit, 16-bit or float; OpenGL or DirectX green), the TBN
// matrix, facing ratio, Lambert, Blinn–Phong and Phong, and Schlick's Fresnel beside the exact dielectric value.
// Pure functions; the pane glue is vfxCalcs.ts. Quaternion and axis–angle come from attitude.ts (Attitude convert,
// under Robotics & kinematics, does every Euler sequence).
//
// CONVENTIONS: column vectors, p' = M·p, M = T(t)·T(pivot)·R·S·T(−pivot) (Maya's transform with its rotate and scale
// pivots at one point and no shear or pivot translation). Row-vector applications (Maya's MMatrix, Houdini's VEX)
// store the transpose. Rotation orders as vfxCamera.ts: "XYZ" rotates X first, R = R_z·R_y·R_x.

import { matrixToQuat, quatToAxisAngle, canonical, type Quat } from "./attitude";
import { fmtSig } from "./axis";
import { add, cross, dot, eulerMatrix, gimbalLocked, matMul, matVec, norm, scale, sub, transpose, type M3, type Order, type Vec3 } from "./vfxCamera";

export interface Err {
  ok: false;
  error: string;
}

export type M4 = number[][];
export type UpConvert = "none" | "y2z" | "z2y";

export interface TransformInput {
  t: Vec3;
  r: Vec3;
  s: Vec3;
  order: Order;
  pivot: Vec3;
  points: Vec3[];
  up: UpConvert;
}

export interface TransformResult {
  ok: true;
  R: M3;
  M: M4;
  inv: M4;
  det: number;
  orthoErr: number;
  mirrored: boolean;
  quat: Quat;
  axis: Vec3 | null;
  angle: number;
  gimbal: ReturnType<typeof gimbalLocked>;
  out: Vec3[];
  /** After the up-axis conversion (when one is chosen). */
  conv: { C: M3; M: M4; points: Vec3[] } | null;
  /** M⁻¹·M − I, largest entry: the inverse checked. */
  invErr: number;
}

const to4 = (L: M3, tr: Vec3): M4 => [
  [L[0][0], L[0][1], L[0][2], tr[0]],
  [L[1][0], L[1][1], L[1][2], tr[1]],
  [L[2][0], L[2][1], L[2][2], tr[2]],
  [0, 0, 0, 1],
];
const mul4 = (a: M4, b: M4): M4 => a.map((row, i) => b[0].map((_, j) => row.reduce((s, _v, k) => s + a[i][k] * b[k][j], 0)));
export const apply4 = (m: M4, p: Vec3): Vec3 => [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3]) as Vec3;
/** Values within 10⁻¹² of a whole number are snapped (cos 90° is 6×10⁻¹⁷ in floating point; it is 0). */
const snap = (v: number): number => (Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) + 0 : v);
const snap4 = (m: M4): M4 => m.map((r) => r.map(snap));

export const UP_MATRIX: Record<Exclude<UpConvert, "none">, M3> = {
  // Y-up → Z-up: +90° about X, (x, y, z) → (x, −z, y): up (0, 1, 0) becomes (0, 0, 1), and −Z forward becomes +Y.
  y2z: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  // Z-up → Y-up: −90° about X, (x, y, z) → (x, z, −y).
  z2y: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
};

export function transform(inp: TransformInput): TransformResult | Err {
  const all = [...inp.t, ...inp.r, ...inp.s, ...inp.pivot, ...inp.points.flat()];
  if (!all.every(Number.isFinite)) return { ok: false, error: "Every value must be a finite number." };
  if (inp.s.some((v) => v === 0)) return { ok: false, error: `Scale: a zero scale (${inp.s.map(String).join(", ")}) flattens the space onto a plane; the matrix has no inverse and the rotation cannot be recovered from it.` };
  const R = eulerMatrix(inp.order, inp.r);
  const S: M3 = [[inp.s[0], 0, 0], [0, inp.s[1], 0], [0, 0, inp.s[2]]];
  const L = matMul(R, S);
  const tr = add(add(inp.t, inp.pivot), scale(matVec(L, inp.pivot), -1));
  const M = snap4(to4(L, tr));
  // Inverse: x = p + S⁻¹Rᵀ(y − t − p).
  const Sinv: M3 = [[1 / inp.s[0], 0, 0], [0, 1 / inp.s[1], 0], [0, 0, 1 / inp.s[2]]];
  const Li = matMul(Sinv, transpose(R));
  const tri = sub(inp.pivot, matVec(Li, add(inp.t, inp.pivot)));
  const inv = snap4(to4(Li, tri));
  const prod = mul4(inv, M);
  let invErr = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) invErr = Math.max(invErr, Math.abs(prod[i][j] - (i === j ? 1 : 0)));
  const RtR = matMul(transpose(R), R);
  let orthoErr = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) orthoErr = Math.max(orthoErr, Math.abs(RtR[i][j] - (i === j ? 1 : 0)));
  const det = inp.s[0] * inp.s[1] * inp.s[2];
  const q = matrixToQuat(R);
  if (!q.ok) return { ok: false, error: q.error };
  const quat = canonical(q.q);
  const aa = quatToAxisAngle(quat);
  const out = inp.points.map((p) => apply4(M, p).map(snap) as Vec3);
  let conv: TransformResult["conv"] = null;
  if (inp.up !== "none") {
    const C = UP_MATRIX[inp.up];
    const C4 = to4(C, [0, 0, 0]);
    const Ci4 = to4(transpose(C), [0, 0, 0]);
    conv = { C, M: snap4(mul4(mul4(C4, M), Ci4)), points: out.map((p) => matVec(C, p).map(snap) as Vec3) };
  }
  return {
    ok: true,
    R: R.map((r) => r.map(snap)) as M3,
    M,
    inv,
    det,
    orthoErr,
    mirrored: det < 0,
    quat,
    axis: aa.axis,
    angle: (aa.angle * 180) / Math.PI,
    gimbal: gimbalLocked(inp.order, inp.r),
    out,
    conv,
    invErr,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Normals and shading
// ---------------------------------------------------------------------------------------------------------------

export type NormalEncoding = "8" | "16" | "float";
export type GreenConvention = "gl" | "dx";

export interface ShadingInput {
  texel: Vec3;
  encoding: NormalEncoding;
  green: GreenConvention;
  T: Vec3;
  B: Vec3;
  N: Vec3;
  L: Vec3;
  V: Vec3;
  shininess: number;
  /** Index of refraction (for F0 and the exact Fresnel), or null to use f0. */
  ior: number | null;
  f0: number | null;
}

export interface ShadingResult {
  ok: true;
  decoded: Vec3;
  decodedLength: number;
  nTangent: Vec3;
  /** z ≤ 0: the decoded normal points into the surface. */
  intoSurface: boolean;
  tbnOrtho: number;
  handedness: 1 | -1;
  n: Vec3;
  l: Vec3;
  v: Vec3;
  h: Vec3;
  r: Vec3;
  nDotL: number;
  nDotV: number;
  nDotH: number;
  vDotH: number;
  rDotV: number;
  lambert: number;
  blinn: number;
  phong: number;
  f0: number;
  schlickVH: number;
  schlickNV: number;
  /** The exact unpolarised dielectric Fresnel reflectance at the same angles (IOR given), else null. */
  exactVH: number | null;
  exactNV: number | null;
  /** The geometric normal N against the mapped normal n: the angle the map tilts the surface, degrees. */
  tilt: number;
}

const unit = (v: Vec3, name: string): Vec3 | Err => {
  const l = norm(v);
  if (!(l > 1e-9)) return { ok: false, error: `${name}: (${v.map(String).join(", ")}) has zero length, so it has no direction.` };
  return scale(v, 1 / l);
};

/** Exact unpolarised Fresnel reflectance of a dielectric (from n₁ = 1 into n₂ = n) at incidence cos θ. */
export function fresnelExact(n: number, cosI: number): number {
  const c = Math.min(1, Math.max(0, cosI));
  const sinT2 = (1 - c * c) / (n * n);
  if (sinT2 >= 1) return 1;
  const cosT = Math.sqrt(1 - sinT2);
  const rs = (c - n * cosT) / (c + n * cosT);
  const rp = (n * c - cosT) / (n * c + cosT);
  return (rs * rs + rp * rp) / 2;
}

export const schlick = (f0: number, cos: number): number => f0 + (1 - f0) * Math.pow(1 - Math.min(1, Math.max(0, cos)), 5);

export function shading(inp: ShadingInput): ShadingResult | Err {
  const all = [...inp.texel, ...inp.T, ...inp.B, ...inp.N, ...inp.L, ...inp.V, inp.shininess];
  if (!all.every(Number.isFinite)) return { ok: false, error: "Every value must be a finite number." };
  const max = inp.encoding === "8" ? 255 : inp.encoding === "16" ? 65535 : 1;
  for (const [i, c] of inp.texel.entries()) {
    if (c < 0 || c > max) return { ok: false, error: `Normal-map texel, ${"RGB"[i]}: ${c} is outside 0 to ${max} for ${inp.encoding === "float" ? "a float texture in [0, 1]" : `${inp.encoding}-bit`}.` };
    if (inp.encoding !== "float" && !Number.isInteger(c)) return { ok: false, error: `Normal-map texel, ${"RGB"[i]}: ${c} is not a whole ${inp.encoding}-bit code.` };
  }
  if (!(inp.shininess >= 0)) return { ok: false, error: "Shininess: the specular exponent cannot be negative." };
  const decoded = inp.texel.map((c) => (c / max) * 2 - 1) as Vec3;
  if (inp.green === "dx") decoded[1] = -decoded[1];
  const decodedLength = norm(decoded);
  // Below a few quantisation steps the direction is noise, not a normal: 6.4 steps of 2/(2ᵇ − 1), 0.05 in 8 bits.
  const minLength = inp.encoding === "float" ? 1e-3 : (6.4 * 2) / max;
  if (!(decodedLength >= minLength)) return { ok: false, error: `Normal-map texel (${inp.texel.join(", ")}) decodes to a ${decodedLength === 0 ? "zero-length" : "near-zero"} normal (length ${decodedLength === 0 ? "0" : fmtSig(decodedLength, 3)}, below ${fmtSig(minLength, 3)} for ${inp.encoding === "float" ? "a float texel" : `${inp.encoding}-bit`}), whose direction is quantisation noise, not a surface. A flat tangent-space normal is (128, 128, 255) in 8 bits.` };
  const nTangent = scale(decoded, 1 / decodedLength);
  const T = unit(inp.T, "Tangent T");
  if ("error" in T) return T;
  const B = unit(inp.B, "Bitangent B");
  if ("error" in B) return B;
  const N = unit(inp.N, "Geometric normal N");
  if ("error" in N) return N;
  const tbnOrtho = Math.max(Math.abs(dot(T, B)), Math.abs(dot(T, N)), Math.abs(dot(B, N)));
  if (tbnOrtho > 0.999) return { ok: false, error: "The tangent, bitangent and normal are (nearly) parallel: they do not span 3D space, so the TBN matrix cannot place a tangent-space normal." };
  const handedness = dot(cross(T, B), N) >= 0 ? 1 : -1;
  const nw0: Vec3 = add(add(scale(T, nTangent[0]), scale(B, nTangent[1])), scale(N, nTangent[2]));
  const n = unit(nw0, "The mapped normal");
  if ("error" in n) return n;
  const l = unit(inp.L, "Light direction L");
  if ("error" in l) return l;
  const v = unit(inp.V, "View direction V");
  if ("error" in v) return v;
  const hv = add(l, v);
  if (!(norm(hv) > 1e-9)) return { ok: false, error: "The light and view directions are exactly opposite, so the half vector L + V is zero and Blinn–Phong is undefined." };
  const h = scale(hv, 1 / norm(hv));
  const nDotL = dot(n, l);
  const nDotV = dot(n, v);
  const nDotH = dot(n, h);
  const vDotH = dot(v, h);
  const r = sub(scale(n, 2 * nDotL), l);
  const rDotV = dot(r, v);
  let f0: number;
  if (inp.ior !== null) {
    if (!(inp.ior >= 1 && inp.ior <= 5)) return { ok: false, error: `Index of refraction: ${inp.ior} is outside 1 to 5.` };
    f0 = Math.pow((inp.ior - 1) / (inp.ior + 1), 2);
  } else {
    if (inp.f0 === null || !(inp.f0 >= 0 && inp.f0 <= 1)) return { ok: false, error: "F0: give the reflectance at normal incidence (0 to 1), or an index of refraction." };
    f0 = inp.f0;
  }
  const lit = nDotL > 0;
  return {
    ok: true,
    decoded,
    decodedLength,
    nTangent,
    intoSurface: nTangent[2] <= 0,
    tbnOrtho,
    handedness,
    n,
    l,
    v,
    h,
    r,
    nDotL,
    nDotV,
    nDotH,
    vDotH,
    rDotV,
    lambert: Math.max(0, nDotL),
    blinn: lit ? Math.pow(Math.max(0, nDotH), inp.shininess) : 0,
    phong: lit ? Math.pow(Math.max(0, rDotV), inp.shininess) : 0,
    f0,
    schlickVH: schlick(f0, vDotH),
    schlickNV: schlick(f0, nDotV),
    exactVH: inp.ior !== null ? fresnelExact(inp.ior, vDotH) : null,
    exactNV: inp.ior !== null ? fresnelExact(inp.ior, nDotV) : null,
    tilt: (Math.acos(Math.max(-1, Math.min(1, dot(N, n)))) * 180) / Math.PI,
  };
}
