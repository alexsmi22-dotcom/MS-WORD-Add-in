// VFX & compositing, cameras: filmback / focal length / field of view with anamorphic squeeze, crop factor and the CG
// camera's film-fit mode; pinhole projection of a world point to pixels, the screen-space velocity and motion-blur
// length a camera move gives it, and the parallax between two depths. Pure functions; the pane glue is vfxCalcs.ts.
//
// CONVENTIONS (stated in every result by the pane glue):
//   - Right-handed, Y up; the camera looks down its local −Z with +X to the right of frame (Maya, Houdini, Nuke,
//     OpenGL). Pixel coordinates have the origin at the TOP-LEFT with v increasing downward (most image tools and
//     OpenCV); Nuke's origin is the bottom-left, and both are printed.
//   - Rotation orders are written as a DCC writes them: "XYZ" rotates about X first, then Y, then Z, each about the
//     fixed parent axes, so R = R_z·R_y·R_x for column vectors (scipy Rotation.from_euler("xyz", …), lower case).
//   - Anamorphic: a lens squeeze s widens the horizontal field: the effective (desqueezed) filmback is s·W × H.
//   - Film fit (Maya's Film Fit): "horizontal" maps the filmback width to the image width, "vertical" the height,
//     "fill" keeps the image inside the filmback and "overscan" keeps the filmback inside the image.

import { fmtSig } from "./axis";

export interface Err {
  ok: false;
  error: string;
}

export type Vec3 = [number, number, number];
export type M3 = [Vec3, Vec3, Vec3];
export const ORDERS = ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"] as const;
export type Order = (typeof ORDERS)[number];

const DEG = Math.PI / 180;
/** sin and cos of an angle in degrees, exact (0, ±1) at multiples of 90° and exact ±0.5 at ±30°/±150°/… . */
export function sinCosDeg(a: number): [number, number] {
  const r = ((a % 360) + 360) % 360;
  if (r === 0) return [0, 1];
  if (r === 90) return [1, 0];
  if (r === 180) return [0, -1];
  if (r === 270) return [-1, 0];
  const s = r === 30 || r === 150 ? 0.5 : r === 210 || r === 330 ? -0.5 : Math.sin(a * DEG);
  const c = r === 60 || r === 300 ? 0.5 : r === 120 || r === 240 ? -0.5 : Math.cos(a * DEG);
  return [s, c];
}

export function matMul(a: M3, b: M3): M3 {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return out;
}
export const matVec = (m: M3, v: Vec3): Vec3 => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
export const transpose = (m: M3): M3 => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** The elementary rotation about one axis, angle in degrees. */
export function axisMatrix(axis: "X" | "Y" | "Z", deg: number): M3 {
  const [s, c] = sinCosDeg(deg);
  if (axis === "X") return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === "Y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

/**
 * The rotation for DCC angles (rx, ry, rz in degrees, BY AXIS) applied in `order`: "XYZ" rotates X first, so
 * R = R_z·R_y·R_x.
 */
export function eulerMatrix(order: Order, angles: Vec3): M3 {
  const byAxis: Record<string, number> = { X: angles[0], Y: angles[1], Z: angles[2] };
  let m: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const ax of order) m = matMul(axisMatrix(ax as "X" | "Y" | "Z", byAxis[ax]), m);
  return m;
}

/** Gimbal lock: the MIDDLE rotation of the order at ±90° lines the first and third axes up. */
/** Within this many degrees of ±90° the middle rotation is NEAR gimbal lock: the first and third axes are almost
 *  aligned, so small orientation changes need large Euler-angle changes and interpolated curves can flip. */
export const GIMBAL_NEAR_DEG = 0.5;

export function gimbalLocked(order: Order, angles: Vec3): { locked: boolean; near: boolean; off: number; middle: string; angle: number } {
  const byAxis: Record<string, number> = { X: angles[0], Y: angles[1], Z: angles[2] };
  const middle = order[1];
  const a = byAxis[middle];
  const r = ((a % 180) + 180) % 180;
  const off = Math.abs(r - 90);
  return { locked: off < 1e-9, near: off >= 1e-9 && off <= GIMBAL_NEAR_DEG, off, middle, angle: a };
}

// ---------------------------------------------------------------------------------------------------------------
// Camera match
// ---------------------------------------------------------------------------------------------------------------

export type FitMode = "fill" | "horizontal" | "vertical" | "overscan";
export type FovAxis = "h" | "v" | "d";
/** The widest field of view taken (degrees): beyond it the figures would round to 180°. */
export const MAX_FOV = 179;

/** Full-frame (36 × 24 mm) diagonal, the reference for crop factor. */
export const FF_DIAG = Math.hypot(36, 24);

export interface CameraInput {
  /** Filmback (sensor area recorded), mm. */
  W: number;
  H: number;
  squeeze: number;
  /** Focal length mm, or null when a FOV is given. */
  f: number | null;
  /** A field of view in degrees on an axis, used when f is null. */
  fov: number | null;
  fovAxis: FovAxis;
  /** Image resolution as recorded (pixels). */
  resW: number;
  resH: number;
  fit: FitMode;
}

export interface CameraResult {
  ok: true;
  f: number;
  /** Effective (desqueezed) filmback width s·W. */
  We: number;
  hFov: number;
  vFov: number;
  dFov: number;
  diag: number;
  crop: number;
  /** Diagonal-equivalent full-frame focal length. */
  fEqDiag: number;
  /** Horizontal-equivalent full-frame focal length (36 mm width). */
  fEqH: number;
  /** Filmback (desqueezed) and image aspect ratios. */
  filmAspect: number;
  imageAspect: number;
  /** The image and filmback aspects agree within 0.1 %. */
  aspectMatch: boolean;
  /** The fit the mode resolves to, and the render's field of view. */
  resolvedFit: "horizontal" | "vertical";
  renderH: number;
  renderV: number;
  /** The image's gate on the (desqueezed) filmback, mm; larger than the filmback where the image overscans it. */
  gateW: number;
  gateH: number;
  /** Fraction of the image the filmback (the plate) covers, horizontally and vertically (≤ 1). */
  coverH: number;
  coverV: number;
}

const fov = (dim: number, f: number): number => (2 * Math.atan(dim / (2 * f))) / DEG;

export function cameraMatch(inp: CameraInput): CameraResult | Err {
  const { W, H, squeeze: s, resW, resH } = inp;
  if (!(W > 0) || !(H > 0)) return { ok: false, error: "Filmback: the width and height must be greater than zero." };
  if (W > 1000 || H > 1000) return { ok: false, error: "Filmback: above 1000 mm is not a camera sensor or film gate; check the unit." };
  if (!(s >= 1 && s <= 4)) return { ok: false, error: `Anamorphic squeeze: ${s}× is outside 1× (spherical) to 4×.` };
  if (!(resW > 0) || !(resH > 0) || !Number.isInteger(resW) || !Number.isInteger(resH)) return { ok: false, error: "Resolution: give whole pixel counts greater than zero." };
  const We = s * W;
  const diag = Math.hypot(We, H);
  let f: number;
  if (inp.f !== null) {
    if (!(inp.f > 0) || !Number.isFinite(inp.f)) return { ok: false, error: "Focal length: must be greater than zero." };
    f = inp.f;
  } else {
    const a = inp.fov;
    if (a === null || !Number.isFinite(a)) return { ok: false, error: "Give a focal length or a field of view." };
    if (!(a > 0 && a <= MAX_FOV)) return { ok: false, error: `Field of view: ${fmtSig(a, 10).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "")}° is outside (0°, ${MAX_FOV}°]. A pinhole camera's field of view is below 180°, and past ${MAX_FOV}° the focal length tends to zero and the result would print as 180°; a fisheye lens needs its own projection model.` };
    const dim = inp.fovAxis === "h" ? We : inp.fovAxis === "v" ? H : diag;
    f = dim / (2 * Math.tan((a * DEG) / 2));
  }
  const hFov = fov(We, f);
  const vFov = fov(H, f);
  const dFov = fov(diag, f);
  if (dFov > MAX_FOV) return { ok: false, error: `Focal length: ${fmtSig(f, 4)} mm on this filmback gives a ${fmtSig(dFov, 6)}° diagonal field of view, past the ${MAX_FOV}° a pinhole model can state (it would print as 180°); a lens this wide is a fisheye and needs its own projection model.` };
  const filmAspect = We / H;
  const imageAspect = (resW * s) / resH;
  let resolvedFit: "horizontal" | "vertical";
  if (inp.fit === "horizontal" || inp.fit === "vertical") resolvedFit = inp.fit;
  else if (inp.fit === "fill") resolvedFit = imageAspect >= filmAspect ? "horizontal" : "vertical";
  else resolvedFit = imageAspect >= filmAspect ? "vertical" : "horizontal";
  // Aspects within 0.1 % are the same frame (a published sensor size is rounded to 0.01 mm): the gate is the filmback.
  const aspectMatch = Math.abs(imageAspect / filmAspect - 1) < 1e-3;
  const gateW = aspectMatch || resolvedFit === "horizontal" ? We : H * imageAspect;
  const gateH = aspectMatch || resolvedFit === "vertical" ? H : We / imageAspect;
  const renderH = fov(gateW, f);
  const renderV = fov(gateH, f);
  const crop = FF_DIAG / Math.hypot(W, H);
  return {
    ok: true,
    f,
    We,
    hFov,
    vFov,
    dFov,
    diag,
    crop,
    fEqDiag: f * (FF_DIAG / diag),
    fEqH: f * (36 / We),
    filmAspect,
    imageAspect,
    aspectMatch,
    resolvedFit,
    renderH,
    renderV,
    gateW,
    gateH,
    coverH: Math.min(1, We / gateW),
    coverV: Math.min(1, H / gateH),
  };
}

/**
 * Sensor presets, each from the manufacturer's published data (active image area, mm). Only what could be checked is
 * here: other cameras are typed in.
 */
export interface SensorPreset {
  id: string;
  label: string;
  W: number;
  H: number;
  source: string;
}

const MINI_LF = "ARRI, ALEXA Mini LF technical data sheet (Sensor Active Image Area)";
const ALEXA35 = "ARRI, ALEXA 35 recording formats (Dimensions)";

export const SENSOR_PRESETS: SensorPreset[] = [
  { id: "ff", label: "Full frame 36 × 24 mm (the 135 format)", W: 36, H: 24, source: "the 135 still-film format, 36 × 24 mm, the crop-factor reference" },
  { id: "lf-og", label: "ARRI ALEXA Mini LF, LF Open Gate 4.5K (36.70 × 25.54 mm)", W: 36.7, H: 25.54, source: MINI_LF },
  { id: "lf-239", label: "ARRI ALEXA Mini LF, LF 2.39:1 4.5K (36.70 × 15.31 mm)", W: 36.7, H: 15.31, source: MINI_LF },
  { id: "lf-uhd", label: "ARRI ALEXA Mini LF, LF 16:9 UHD 3.8K (31.68 × 17.82 mm)", W: 31.68, H: 17.82, source: MINI_LF },
  { id: "lf-s35-32", label: "ARRI ALEXA Mini LF, S35 3:2 3.4K (28.25 × 18.17 mm)", W: 28.25, H: 18.17, source: MINI_LF },
  { id: "lf-s35-43", label: "ARRI ALEXA Mini LF, S35 4:3 2.8K (23.76 × 17.82 mm)", W: 23.76, H: 17.82, source: MINI_LF },
  { id: "lf-s35-hd", label: "ARRI ALEXA Mini LF, S35 16:9 HD (23.76 × 13.37 mm)", W: 23.76, H: 13.37, source: MINI_LF },
  { id: "a35-og", label: "ARRI ALEXA 35, 4.6K 3:2 Open Gate (27.99 × 19.22 mm)", W: 27.99, H: 19.22, source: ALEXA35 },
  { id: "a35-169", label: "ARRI ALEXA 35, 4.6K 16:9 (27.99 × 15.75 mm)", W: 27.99, H: 15.75, source: ALEXA35 },
  { id: "a35-4k", label: "ARRI ALEXA 35, 4K 16:9 (24.88 × 14.00 mm)", W: 24.88, H: 14.0, source: ALEXA35 },
  { id: "a35-65", label: "ARRI ALEXA 35, 3.3K 6:5 anamorphic (20.22 × 16.95 mm)", W: 20.22, H: 16.95, source: ALEXA35 },
];

// ---------------------------------------------------------------------------------------------------------------
// Projection and parallax
// ---------------------------------------------------------------------------------------------------------------

export interface ProjectionInput {
  cam: Vec3;
  rot: Vec3;
  order: Order;
  f: number;
  /** Filmback, mm. */
  W: number;
  H: number;
  resW: number;
  resH: number;
  point: Vec3;
  /** Camera translation per frame, world units. */
  move: Vec3;
  /** Two depths (world units along the view axis) for parallax. */
  near: number;
  far: number;
  shutter: number;
  frames: number;
}

export interface Projected {
  /** Camera-space position. */
  pc: Vec3;
  depth: number;
  /** Film-plane position, mm from centre (x right, y up). */
  xf: number;
  yf: number;
  /** Pixels, origin top-left (v down), and Nuke's bottom-left v. */
  u: number;
  v: number;
  vNuke: number;
  inFrame: boolean;
}

export interface ProjectionResult {
  ok: true;
  R: M3;
  /** Pixels per mm on the film (horizontal fit). */
  k: number;
  /** The vertical extent the horizontal fit implies differs from the filmback height. */
  gateMismatch: number;
  p0: Projected;
  p1: Projected;
  du: number;
  dv: number;
  speed: number;
  blur: number;
  /** Lateral camera move per frame along the camera's right axis, and toward the view (dolly) component. */
  lateral: number;
  dolly: number;
  shiftNear: number;
  shiftFar: number;
  parallax: number;
  parallaxShot: number;
  hFov: number;
}

function project(R: M3, cam: Vec3, p: Vec3, f: number, k: number, resW: number, resH: number): Projected | Err {
  const pc = matVec(transpose(R), sub(p, cam));
  const depth = -pc[2];
  if (!(depth > 1e-12)) return { ok: false, error: `The point is ${depth === 0 ? "level with" : "behind"} the camera (depth ${fmtSig(depth, 4)} along the view axis), so it has no image: the camera looks down its local −Z.` };
  const xf = (f * pc[0]) / depth;
  const yf = (f * pc[1]) / depth;
  const u = resW / 2 + xf * k;
  const v = resH / 2 - yf * k;
  return { pc, depth, xf, yf, u, v, vNuke: resH - v, inFrame: u >= 0 && u <= resW && v >= 0 && v <= resH };
}

export function projection(inp: ProjectionInput): ProjectionResult | Err {
  const all = [...inp.cam, ...inp.rot, ...inp.point, ...inp.move, inp.f, inp.W, inp.H, inp.resW, inp.resH, inp.near, inp.far, inp.shutter, inp.frames];
  if (!all.every(Number.isFinite)) return { ok: false, error: "Every value must be a finite number." };
  if (!(inp.f > 0)) return { ok: false, error: "Focal length: must be greater than zero." };
  if (!(inp.W > 0) || !(inp.H > 0)) return { ok: false, error: "Filmback: the width and height must be greater than zero." };
  if (!(inp.resW > 0) || !(inp.resH > 0) || !Number.isInteger(inp.resW) || !Number.isInteger(inp.resH)) return { ok: false, error: "Resolution: give whole pixel counts greater than zero." };
  if (!(inp.near > 0) || !(inp.far > 0)) return { ok: false, error: "Parallax depths: both must be greater than zero (in front of the camera)." };
  if (!(inp.shutter > 0 && inp.shutter <= 360)) return { ok: false, error: `Shutter angle: ${inp.shutter}° is outside (0°, 360°].` };
  if (!(inp.frames >= 1) || !Number.isInteger(inp.frames)) return { ok: false, error: "Frames in the move: give a whole number of at least 1." };
  const R = eulerMatrix(inp.order, inp.rot);
  const k = inp.resW / inp.W;
  const p0 = project(R, inp.cam, inp.point, inp.f, k, inp.resW, inp.resH);
  if ("error" in p0) return p0;
  const p1 = project(R, add(inp.cam, inp.move), inp.point, inp.f, k, inp.resW, inp.resH);
  if ("error" in p1) return { ok: false, error: `After one frame of the camera move: ${p1.error}` };
  const du = p1.u - p0.u;
  const dv = p1.v - p0.v;
  const speed = Math.hypot(du, dv);
  const right: Vec3 = [R[0][0], R[1][0], R[2][0]];
  const fwd: Vec3 = [-R[0][2], -R[1][2], -R[2][2]];
  const lateral = dot(inp.move, right);
  const dolly = dot(inp.move, fwd);
  // A point straight ahead at depth d shifts by f·b/d on the film when the camera moves b to the right (it moves left).
  const shiftNear = (-inp.f * lateral * k) / inp.near;
  const shiftFar = (-inp.f * lateral * k) / inp.far;
  return {
    ok: true,
    R,
    k,
    gateMismatch: inp.resH / k / inp.H,
    p0,
    p1,
    du,
    dv,
    speed,
    blur: (speed * inp.shutter) / 360,
    lateral,
    dolly,
    shiftNear,
    shiftFar,
    parallax: Math.abs(shiftNear - shiftFar),
    parallaxShot: Math.abs(shiftNear - shiftFar) * inp.frames,
    hFov: fov(inp.W, inp.f),
  };
}
