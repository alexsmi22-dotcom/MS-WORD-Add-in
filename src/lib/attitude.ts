// Attitude kinematics (Release E, gap #7): quaternion ↔ rotation matrix ↔ Euler angles in all 12 sequences (6
// Tait–Bryan, 6 proper Euler; intrinsic or extrinsic) ↔ axis–angle, composition and slerp. Pure functions, radians
// inside, no formatting.
//
// CONVENTIONS (stated in every result by the pane glue, kalmanCalcs.ts):
//   - Quaternions are stored SCALAR-LAST, q = (x, y, z, w), and multiplied by the HAMILTON product (i² = j² = k² =
//     ijk = −1). q and −q are the same rotation; results are shown with w ≥ 0 (canonical()).
//   - Rotations are ACTIVE and right-handed: R rotates a vector, v_ref = R·v_body, so the columns of R are the body
//     axes written in reference coordinates. The passive direction-cosine matrix (reference → body) is Rᵀ.
//   - Intrinsic "ZYX" (a, b, c): rotate a about Z, then b about the NEW y, then c about the newest x:
//     R = R_z(a)·R_y(b)·R_x(c). Extrinsic "xyz" (a, b, c) rotates about the FIXED x, y, z in that order:
//     R = R_z(c)·R_y(b)·R_x(a). So extrinsic abc with angles (α, β, γ) is intrinsic CBA with (γ, β, α): ONE code path.
//   - Composition A ⊗ B: B applied in A's body frame (intrinsic), equivalently B first and then A in the reference
//     frame (R = R_A·R_B).
//
// These agree with robotics.ts:dhForward, whose roll/pitch/yaw are the intrinsic ZYX angles of the same R
// (yaw = atan2(R₂₁, R₁₁), pitch = atan2(−R₃₁, …), roll = atan2(R₃₂, R₃₃)) and whose gimbal-lock test is
// 1 − |R₃₁| < 10⁻⁹; kalmanCases.test.ts proves the two agree on a DH chain. Where dhForward REFUSES a triple at gimbal
// lock, this module reports one with a stated convention (the third angle, in the order written, set to 0 — the
// convention of scipy.spatial.transform.Rotation.as_euler), as the attitude brief asks.
//
// Euler extraction: Bernardes & Viollet (2022), "Quaternion to Euler angles conversion: a direct, general and
// computationally efficient method", PLoS ONE 17(11): e0276302 — the method scipy uses — so one formula serves all
// 12 sequences. Matrix → quaternion: Shepperd (1978), the largest-pivot branch.

export type Quat = [number, number, number, number];
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
export type Frame = "intrinsic" | "extrinsic";

/** The 12 Euler sequences, written upper-case (the intrinsic form; the extrinsic form is the same letters). */
export const TAIT_BRYAN = ["ZYX", "XYZ", "XZY", "YXZ", "YZX", "ZXY"] as const;
export const PROPER_EULER = ["ZXZ", "ZYZ", "XYX", "XZX", "YXY", "YZY"] as const;
export const SEQUENCES: readonly string[] = [...TAIT_BRYAN, ...PROPER_EULER];
export type Sequence = string;

/** Orthogonality / determinant tolerance for a typed rotation matrix (the brief's 1×10⁻⁶). */
export const ROTATION_TOL = 1e-6;
/** Gimbal-lock tolerance: 1 − |cos β| < 10⁻⁹, dhForward's test on |R₃₁| (β is measured from the singular pose). */
export const GIMBAL_TOL = 1e-9;

const AXIS_INDEX: Record<string, number> = { X: 0, Y: 1, Z: 2 };

export function isSequence(s: string): boolean {
  return SEQUENCES.includes(s);
}
export function isProper(seq: Sequence): boolean {
  return seq[0] === seq[2];
}

/** Hamilton product a ⊗ b, scalar-last. */
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatConj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** The norm, and the unit quaternion; an error for a zero or non-finite quaternion. */
export function quatNormalize(q: readonly number[]): { ok: true; q: Quat; norm: number } | { ok: false; error: string } {
  if (q.length !== 4 || q.some((v) => !Number.isFinite(v))) return { ok: false, error: "A quaternion needs four finite numbers." };
  // Scaled norm, so a quaternion typed in huge or tiny units neither overflows nor underflows.
  const s = Math.max(...q.map(Math.abs));
  if (!(s > 0)) return { ok: false, error: "The zero quaternion is not a rotation (its norm is 0)." };
  const n = s * Math.hypot(q[0] / s, q[1] / s, q[2] / s, q[3] / s);
  return { ok: true, q: [q[0] / n, q[1] / n, q[2] / n, q[3] / n], norm: n };
}

/** The representative with w ≥ 0 (and, when w = 0, the first non-zero vector component positive). −0 is 0. */
export function canonical(q: Quat): Quat {
  let flip = q[3] < 0;
  if (q[3] === 0) {
    const first = q.slice(0, 3).find((v) => v !== 0) ?? 0;
    flip = first < 0;
  }
  const out = (flip ? q.map((v) => -v) : q.slice()) as Quat;
  return out.map((v) => (v === 0 ? 0 : v)) as Quat;
}

/** The rotation by `angle` (rad) about the unit axis `axis` (0 = x, 1 = y, 2 = z). */
function elementary(axis: number, angle: number): Quat {
  const q: Quat = [0, 0, 0, Math.cos(angle / 2)];
  q[axis] = Math.sin(angle / 2);
  return q;
}

/** Euler angles (rad, in the order written) → unit quaternion. */
export function eulerToQuat(seq: Sequence, angles: readonly [number, number, number], frame: Frame): Quat {
  // Extrinsic abc (α, β, γ) is intrinsic CBA (γ, β, α).
  const s = frame === "intrinsic" ? seq : seq.split("").reverse().join("");
  const a = frame === "intrinsic" ? angles : [angles[2], angles[1], angles[0]];
  let q = elementary(AXIS_INDEX[s[0]], a[0]);
  q = quatMul(q, elementary(AXIS_INDEX[s[1]], a[1]));
  q = quatMul(q, elementary(AXIS_INDEX[s[2]], a[2]));
  return q;
}

/** Unit quaternion → rotation matrix (active: v_ref = R·v_body). */
export function quatToMatrix(q: Quat): Mat3 {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

export interface RotationCheck {
  /** max |RᵀR − I| entry. */
  orthoError: number;
  det: number;
}

export function rotationCheck(m: readonly (readonly number[])[]): RotationCheck {
  let err = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += m[k][i] * m[k][j];
      err = Math.max(err, Math.abs(s - (i === j ? 1 : 0)));
    }
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  return { orthoError: err, det };
}

/**
 * Rotation matrix → unit quaternion, after checking it IS a rotation: 3×3, finite, orthogonal and det = +1 within
 * ROTATION_TOL. A reflection (det ≈ −1) is refused by name.
 */
export function matrixToQuat(m: readonly (readonly number[])[]): { ok: true; q: Quat; check: RotationCheck } | { ok: false; error: string } {
  if (m.length !== 3 || m.some((r) => r.length !== 3)) return { ok: false, error: "A rotation matrix is 3 × 3 (three rows of three numbers)." };
  if (m.some((r) => r.some((v) => !Number.isFinite(v)))) return { ok: false, error: "The rotation matrix has a non-finite entry." };
  const check = rotationCheck(m);
  if (check.det < 0 && Math.abs(check.det + 1) <= 0.01)
    return { ok: false, error: `This matrix is a reflection, not a rotation: its determinant is ${detText(check.det)} (a rotation has +1). A left-handed axis set or one flipped axis gives this.` };
  if (check.orthoError > ROTATION_TOL || Math.abs(check.det - 1) > ROTATION_TOL)
    return {
      ok: false,
      error:
        `This matrix is not a rotation: the largest entry of RᵀR − I is ${detText(check.orthoError)} and det R = ${detText(check.det)}; a rotation matrix is orthogonal with determinant +1 to within 1×10⁻⁶. ` +
        "If it was copied from a rounded table, give each entry to at least 7 significant figures.",
    };
  // Shepperd: the largest of w², x², y², z² as the pivot.
  const t = m[0][0] + m[1][1] + m[2][2];
  const cand = [t, m[0][0], m[1][1], m[2][2]];
  const k = cand.indexOf(Math.max(...cand));
  let q: Quat;
  if (k === 0) {
    const s = 2 * Math.sqrt(1 + t);
    q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
  } else if (k === 1) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
    q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
  } else if (k === 2) {
    const s = 2 * Math.sqrt(1 - m[0][0] + m[1][1] - m[2][2]);
    q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
  } else {
    const s = 2 * Math.sqrt(1 - m[0][0] - m[1][1] + m[2][2]);
    q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
  }
  const n = quatNormalize(q);
  if (!n.ok) return { ok: false, error: n.error };
  return { ok: true, q: canonical(n.q), check };
}

function detText(v: number): string {
  // Local plain formatting for refusal text (no e-notation, U+2212).
  if (v === 0) return "0";
  const a = Math.abs(v);
  const s = a >= 1e-3 && a < 1e6 ? String(Number(a.toPrecision(4))) : (() => {
    const [mant, ex] = a.toExponential(2).split("e");
    const sup = String(Number(ex)).replace(/-/g, "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]);
    return `${Number(mant)}×10${sup}`;
  })();
  return (v < 0 ? "−" : "") + s;
}

/** Wraps an angle to (−π, π]. */
export function wrapPi(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

export interface EulerResult {
  /** rad, in the order written. Tait–Bryan middle in [−π/2, π/2]; proper middle in [0, π]; others in (−π, π]. */
  angles: [number, number, number];
  /** At gimbal lock only the sum (or difference) of the first and third angles is determined. */
  gimbalLock: boolean;
  /** Which combination is determined at lock: "sum" or "difference" of first and third. */
  determined?: "sum" | "difference";
}

/**
 * Unit quaternion → Euler angles for any of the 12 sequences, intrinsic or extrinsic (Bernardes & Viollet 2022).
 * At gimbal lock the THIRD angle (in the order written) is set to 0 and the first carries the determined combination.
 */
export function quatToEuler(qIn: Quat, seq: Sequence, frame: Frame): EulerResult {
  const extrinsic = frame === "extrinsic";
  // The method is written for extrinsic sequences; an intrinsic sequence is the reversed extrinsic one.
  const s = extrinsic ? seq : seq.split("").reverse().join("");
  const i = AXIS_INDEX[s[0]];
  const j = AXIS_INDEX[s[1]];
  let k = AXIS_INDEX[s[2]];
  const symmetric = i === k;
  if (symmetric) k = 3 - i - j;
  const sign = ((i - j) * (j - k) * (k - i)) / 2;
  const q = qIn;
  let a: number, b: number, c: number, d: number;
  if (symmetric) {
    a = q[3];
    b = q[i];
    c = q[j];
    d = q[k] * sign;
  } else {
    a = q[3] - q[j];
    b = q[i] + q[k] * sign;
    c = q[j] + q[3];
    d = q[k] * sign - q[i];
  }
  const ang: [number, number, number] = [0, 2 * Math.atan2(Math.hypot(c, d), Math.hypot(a, b)), 0];
  // dhForward's test, written for the middle angle measured from the singular pose: 1 − |cos β| < 10⁻⁹.
  const cosB = Math.cos(ang[1]);
  const lock = 1 - Math.abs(cosB) < GIMBAL_TOL;
  const halfSum = Math.atan2(b, a);
  const halfDiff = Math.atan2(d, c);
  if (!lock) {
    ang[0] = halfSum - halfDiff;
    ang[2] = halfSum + halfDiff;
  } else {
    const nearZero = cosB > 0;
    // The user-facing third angle is 0: for an extrinsic sequence that is ang[2]; an intrinsic one is reversed below,
    // so its user-facing third angle is ang[0].
    if (extrinsic) {
      ang[2] = 0;
      ang[0] = nearZero ? 2 * halfSum : -2 * halfDiff;
    } else {
      ang[0] = 0;
      ang[2] = nearZero ? 2 * halfSum : 2 * halfDiff;
    }
  }
  if (!symmetric) {
    ang[2] *= sign;
    ang[1] -= Math.PI / 2;
  }
  // || 0 turns a −0 (wrapPi(−0), 0 × −1) into 0: a zero angle has no sign.
  const out: [number, number, number] = [wrapPi(ang[0]) || 0, ang[1] || 0, wrapPi(ang[2]) || 0];
  if (!extrinsic) out.reverse();
  // Which of (first + third) and (first − third) is determined, tested directly on the rotation (no sign table).
  const determined = lock ? combinationAtLock(seq, frame, out) : undefined;
  return { angles: out, gimbalLock: lock, ...(determined ? { determined } : {}) };
}

/**
 * At a locked pose, which of (first + third) and (first − third) is determined: perturb the first and third angles
 * by +δ each, and see whether the rotation changes (a determined sum changes; a determined difference does not).
 */
function combinationAtLock(seq: Sequence, frame: Frame, ang: [number, number, number]): "sum" | "difference" {
  const base = eulerToQuat(seq, ang, frame);
  const moved = eulerToQuat(seq, [ang[0] + 0.1, ang[1], ang[2] + 0.1], frame);
  const dot = Math.abs(base[0] * moved[0] + base[1] * moved[1] + base[2] * moved[2] + base[3] * moved[3]);
  return dot > 1 - 1e-12 ? "difference" : "sum";
}

/** Axis–angle → unit quaternion; the axis is normalised (its length reported), a zero axis refused. */
export function axisAngleToQuat(axis: readonly number[], angle: number): { ok: true; q: Quat; axisNorm: number } | { ok: false; error: string } {
  if (axis.length !== 3 || axis.some((v) => !Number.isFinite(v))) return { ok: false, error: "The axis needs three finite numbers (x, y, z)." };
  if (!Number.isFinite(angle)) return { ok: false, error: "The angle is not finite." };
  const s = Math.max(...axis.map(Math.abs));
  if (!(s > 0)) return { ok: false, error: "The zero vector has no direction, so it is not a rotation axis." };
  const n = s * Math.hypot(axis[0] / s, axis[1] / s, axis[2] / s);
  const u = axis.map((v) => v / n);
  const h = Math.sin(angle / 2);
  return { ok: true, q: [u[0] * h, u[1] * h, u[2] * h, Math.cos(angle / 2)], axisNorm: n };
}

/** Unit quaternion → axis–angle with the angle in [0, π]; the axis is null for the identity (no unique axis). */
export function quatToAxisAngle(qIn: Quat): { axis: [number, number, number] | null; angle: number } {
  const q = canonical(qIn);
  const v = Math.hypot(q[0], q[1], q[2]);
  const angle = 2 * Math.atan2(v, q[3]);
  if (v < 1e-15) return { axis: null, angle: 0 };
  return { axis: [q[0] / v, q[1] / v, q[2] / v], angle };
}

/**
 * Spherical linear interpolation from a to b at t ∈ [0, 1], along the SHORTER arc (b is negated when a·b < 0, since
 * q and −q are the same rotation). Nearly equal orientations fall back to normalised linear interpolation.
 */
export function slerp(a: Quat, bIn: Quat, t: number): Quat {
  let b = bIn;
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (dot < 0) {
    b = b.map((v) => -v) as Quat;
    dot = -dot;
  }
  if (dot > 1 - 1e-12) {
    const l = a.map((v, i) => v + t * (b[i] - v));
    const n = quatNormalize(l);
    return n.ok ? n.q : a;
  }
  const theta = Math.acos(Math.min(1, dot));
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return a.map((v, i) => wa * v + wb * b[i]) as Quat;
}

/** The angle (rad, in [0, π]) of the rotation taking a to b. */
export function angleBetween(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}
