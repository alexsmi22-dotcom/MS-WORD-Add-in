// Linear Kalman filter (Release E, gap #7): the steady-state filter of a time-invariant model (discrete algebraic
// Riccati equation), the covariance recursion that converges to it, and the filter run on a measured series with its
// innovation and NIS consistency check. Pure functions over linalg.ts matrices; no formatting.
//
// MODEL (the textbook discrete form, e.g. Bar-Shalom, Li & Kirubarajan, "Estimation with Applications to Tracking
// and Navigation", 2001, ch. 5):
//   x_{k+1} = F x_k + w_k,  w ~ N(0, Q)        z_k = H x_k + v_k,  v ~ N(0, R)
// Update:   S = H P⁻ Hᵀ + R,  K = P⁻ Hᵀ S⁻¹,  x⁺ = x⁻ + K(z − H x⁻),  P⁺ = (I − KH) P⁻ (I − KH)ᵀ + K R Kᵀ (Joseph form)
// Predict:  x⁻ = F x⁺,  P⁻ = F P⁺ Fᵀ + Q
// Steady state: P⁻ solves P = F P Fᵀ − F P Hᵀ (H P Hᵀ + R)⁻¹ H P Fᵀ + Q (the filter DARE), found by the
// structure-preserving doubling algorithm (Chu, Fan, Lin & Wang, "Structure-preserving algorithms for periodic
// discrete-time algebraic Riccati equations", Int. J. Control 77 (2004); the SDA of Lin & Xu, SIAM J. Matrix Anal.
// Appl. 28 (2006)), which converges quadratically. A result is accepted ONLY when (1) every iterate stayed finite,
// (2) the DARE residual is small against ‖P‖, and (3) the closed-loop error matrix F(I − KH) has spectral radius
// below 1 (the stabilising solution). Anything else is a named refusal.
//
// Magnitudes: the DARE is homogeneous in (Q, R, P) — scaling Q and R by c scales P by c and leaves K unchanged — so
// the solve runs on Q/c, R/c with c = the largest entry of Q and R, and linalg's absolute pivot tolerance never sees
// a covariance typed in tiny or huge units.

import { Matrix, multiply, inverse, transpose, identity, eigenSymmetric, eigenvaluesGeneral } from "./linalg";

export interface KalmanModel {
  F: Matrix;
  H: Matrix;
  Q: Matrix;
  R: Matrix;
}

export const MAX_STATES = 6;
export const MAX_MEAS = 4;
/** Doubling iterations: quadratic convergence needs ~10–30; 60 is a hard cap. */
export const SDA_MAX_ITER = 60;
/** Longest measured series the data run accepts. */
export const MAX_SAMPLES = 2000;
/** Longest covariance recursion drawn. */
export const MAX_RECURSION = 500;

type Fail = { ok: false; error: string };

// ------------------------------------------------------------------ small matrix helpers (over linalg)

const mul = (a: Matrix, b: Matrix): Matrix => multiply(a, b) as Matrix;
const add = (a: Matrix, b: Matrix): Matrix => a.map((r, i) => r.map((v, j) => v + b[i][j]));
const sub = (a: Matrix, b: Matrix): Matrix => a.map((r, i) => r.map((v, j) => v - b[i][j]));
const scale = (a: Matrix, s: number): Matrix => a.map((r) => r.map((v) => v * s));
const maxAbs = (a: Matrix): number => a.reduce((m, r) => r.reduce((mm, v) => Math.max(mm, Math.abs(v)), m), 0);
const symmetrize = (a: Matrix): Matrix => a.map((r, i) => r.map((v, j) => (v + a[j][i]) / 2));
const allFinite = (a: Matrix): boolean => a.every((r) => r.every((v) => Number.isFinite(v)));

/** linalg.inverse after scaling by the largest entry (its pivot tolerance is absolute). */
export function invScaled(a: Matrix): Matrix | null {
  const s = maxAbs(a);
  if (!(s > 0) || !Number.isFinite(s)) return null;
  const inv = inverse(scale(a, 1 / s));
  return inv ? scale(inv, 1 / s) : null;
}

// ------------------------------------------------------------------ presets

/** Scalar random walk: x_{k+1} = x_k + w (variance q per step), z = x + v (variance r). */
export function randomWalkModel(q: number, r: number): KalmanModel {
  return { F: [[1]], H: [[1]], Q: [[q]], R: [[r]] };
}

/**
 * Constant-velocity tracker, state [position, velocity], white-acceleration PSD q (continuous white-noise
 * acceleration model, Bar-Shalom et al. §6.2.2): Q = q·[[Δt³/3, Δt²/2], [Δt²/2, Δt]]; position measured, variance r.
 */
export function constantVelocityModel(dt: number, q: number, r: number): KalmanModel {
  return {
    F: [
      [1, dt],
      [0, 1],
    ],
    H: [[1, 0]],
    Q: [
      [(q * dt ** 3) / 3, (q * dt ** 2) / 2],
      [(q * dt ** 2) / 2, q * dt],
    ],
    R: [[r]],
  };
}

// ------------------------------------------------------------------ validation

/** Symmetric within a relative 10⁻⁹. */
function symmetricEnough(a: Matrix): boolean {
  const s = Math.max(1e-300, maxAbs(a));
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (Math.abs(a[i][j] - a[j][i]) > 1e-9 * s) return false;
  return true;
}

/** Eigenvalues of a symmetric matrix, ascending (scaled for linalg's absolute tolerances). */
function symEig(a: Matrix): number[] | null {
  const s = maxAbs(a);
  if (s === 0) return a.map(() => 0);
  const e = eigenSymmetric(symmetrize(scale(a, 1 / s)));
  return e ? e.values.map((v) => v * s).sort((x, y) => x - y) : null;
}

/** Checks dimensions, finiteness, symmetry, Q ⪰ 0 and R ≻ 0. Null when the model is usable. */
export function validateModel(m: KalmanModel): string | null {
  const { F, H, Q, R } = m;
  const n = F.length;
  if (!n || F.some((r) => r.length !== n)) return "F must be square (n × n, one row per line).";
  if (n > MAX_STATES) return `F has ${n} states; this tool takes at most ${MAX_STATES}.`;
  const mm = H.length;
  if (!mm || H.some((r) => r.length !== n)) return `H must have ${n} column${n === 1 ? "" : "s"} (one per state), one row per measurement.`;
  if (mm > MAX_MEAS) return `H has ${mm} measurement rows; this tool takes at most ${MAX_MEAS}.`;
  if (Q.length !== n || Q.some((r) => r.length !== n)) return `Q must be ${n} × ${n}, the size of F.`;
  if (R.length !== mm || R.some((r) => r.length !== mm)) return `R must be ${mm} × ${mm}, one row and column per measurement (the rows of H).`;
  for (const [name, a] of [["F", F], ["H", H], ["Q", Q], ["R", R]] as const) if (!allFinite(a)) return `${name} has a non-finite entry.`;
  if (!symmetricEnough(Q)) return "Q is not symmetric; a covariance matrix equals its transpose.";
  if (!symmetricEnough(R)) return "R is not symmetric; a covariance matrix equals its transpose.";
  const eq = symEig(Q);
  if (!eq) return "Q: its eigenvalues could not be computed.";
  if (eq[0] < -1e-12 * Math.max(1e-300, Math.abs(eq[eq.length - 1]))) return "Q is not positive semi-definite (it has a negative eigenvalue), so it is not a covariance.";
  const er = symEig(R);
  if (!er) return "R: its eigenvalues could not be computed.";
  if (!(er[0] > 1e-12 * Math.abs(er[er.length - 1]))) return "R must be positive definite (every measurement noisy, no exact or redundant measurement): the gain needs (HPHᵀ + R)⁻¹.";
  return null;
}

// ------------------------------------------------------------------ steady state

export interface SteadyState {
  ok: true;
  /** A-priori (predicted) steady covariance. */
  prior: Matrix;
  /** Kalman gain. */
  K: Matrix;
  /** A-posteriori (updated) steady covariance. */
  posterior: Matrix;
  /** Innovation covariance H P⁻ Hᵀ + R. */
  S: Matrix;
  iterations: number;
  /** Spectral radius of F(I − KH). */
  rho: number;
  /** Relative DARE residual. */
  residual: number;
}

/** Gain, posterior and innovation covariance for a prior P. */
export function updateFromPrior(m: KalmanModel, P: Matrix): { K: Matrix; posterior: Matrix; S: Matrix } | null {
  const Ht = transpose(m.H);
  const S = symmetrize(add(mul(mul(m.H, P), Ht), m.R));
  const Si = invScaled(S);
  if (!Si) return null;
  const K = mul(mul(P, Ht), Si);
  const IKH = sub(identity(P.length), mul(K, m.H));
  const posterior = symmetrize(add(mul(mul(IKH, P), transpose(IKH)), mul(mul(K, m.R), transpose(K))));
  return { K, posterior, S };
}

/** The Riccati map: next prior from this prior. */
export function riccatiStep(m: KalmanModel, P: Matrix): Matrix | null {
  const u = updateFromPrior(m, P);
  if (!u) return null;
  return symmetrize(add(mul(mul(m.F, u.posterior), transpose(m.F)), m.Q));
}

export function spectralRadius(a: Matrix): number {
  let ev: ReturnType<typeof eigenvaluesGeneral>;
  try {
    ev = eigenvaluesGeneral(a);
  } catch {
    return NaN;
  }
  if (!ev) return NaN;
  return ev.reduce((r, c) => Math.max(r, Math.hypot(c.re, c.im)), 0);
}

const UNDETECTABLE =
  "No steady state: the covariance grows without bound. The pair (F, H) is not detectable — a mode of F on or outside " +
  "the unit circle (|λ| ≥ 1) is seen by no measurement, so no filter can bound its error. Measure that state (add a row " +
  "to H) or check F.";

/** Solves the filter DARE by doubling; a named refusal when there is no stabilising solution. */
export function steadyState(model: KalmanModel): SteadyState | Fail {
  const bad = validateModel(model);
  if (bad) return { ok: false, error: bad };
  const c = Math.max(maxAbs(model.Q), maxAbs(model.R));
  const m: KalmanModel = { F: model.F, H: model.H, Q: scale(model.Q, 1 / c), R: scale(model.R, 1 / c) };
  const n = m.F.length;
  const Ri = invScaled(m.R);
  if (!Ri) return { ok: false, error: "R could not be inverted." };
  // SDA for X = Aᵀ X (I + G X)⁻¹ A + Hq with A = Fᵀ, G = Hᵀ R⁻¹ H, Hq = Q (X is the prior covariance).
  let A = transpose(m.F);
  let G = symmetrize(mul(mul(transpose(m.H), Ri), m.H));
  let X = m.Q.map((r) => r.slice());
  let it = 0;
  let converged = false;
  for (; it < SDA_MAX_ITER; it++) {
    const W = add(identity(n), mul(G, X));
    const Wi = inverse(W);
    if (!Wi) return { ok: false, error: UNDETECTABLE };
    const AWi = mul(A, Wi);
    const A1 = mul(AWi, A);
    const G1 = symmetrize(add(G, mul(mul(AWi, G), transpose(A))));
    const X1 = symmetrize(add(X, mul(mul(mul(transpose(A), X), Wi), A)));
    if (!allFinite(X1) || !allFinite(A1) || !allFinite(G1) || maxAbs(X1) > 1e100) return { ok: false, error: UNDETECTABLE };
    const change = maxAbs(sub(X1, X));
    A = A1;
    G = G1;
    X = X1;
    if (change <= 1e-14 * Math.max(1, maxAbs(X))) {
      converged = true;
      it++;
      break;
    }
  }
  if (!converged) {
    // Linear growth (a marginal mode no measurement sees) does not overflow in 60 doublings; it shows as no convergence.
    return { ok: false, error: maxAbs(X) > 1e12 ? UNDETECTABLE : `The Riccati equation did not converge in ${SDA_MAX_ITER} doubling steps; no steady state is reported.` };
  }
  const P = X;
  const u = updateFromPrior(m, P);
  if (!u) return { ok: false, error: "The innovation covariance HPHᵀ + R could not be inverted." };
  const next = riccatiStep(m, P);
  const residual = next ? maxAbs(sub(next, P)) / Math.max(1e-300, maxAbs(P), maxAbs(m.Q)) : Infinity;
  if (!(residual < 1e-8)) return { ok: false, error: "The doubling iteration stopped on a matrix that does not satisfy the Riccati equation; no steady state is reported." };
  const rho = spectralRadius(mul(m.F, sub(identity(n), mul(u.K, m.H))));
  if (!(rho < 1 - 1e-9)) {
    return {
      ok: false,
      error:
        "No stabilising steady state: the Riccati equation has a solution, but the filter built on it does not forget its " +
        `initial error (spectral radius of F(I − KH) = ${!Number.isFinite(rho) ? "not computable" : rho < 1e6 ? String(Number(rho.toPrecision(6))) : "above 10⁶"}, needs < 1). ` +
        "A mode on or outside the unit circle is either unseen by H or not driven by process noise (Q = 0 on a random walk: " +
        "the variance then falls to 0 only like 1/k and the gain goes to 0). Give that mode process noise, or measure it.",
    };
  }
  return {
    ok: true,
    prior: scale(P, c),
    K: u.K,
    posterior: scale(u.posterior, c),
    S: scale(u.S, c),
    iterations: it,
    rho,
    residual,
  };
}

/**
 * The prior covariances P⁻₀ = P₀, P⁻₁, … of the recursion (no measurements needed: P does not depend on the data),
 * `steps` + 1 matrices, steps ≤ MAX_RECURSION.
 */
export function riccatiHistory(model: KalmanModel, P0: Matrix, steps: number): Matrix[] | null {
  const N = Math.max(0, Math.min(MAX_RECURSION, Math.floor(steps)));
  const out: Matrix[] = [P0];
  let P = P0;
  for (let k = 0; k < N; k++) {
    const nx = riccatiStep(model, P);
    if (!nx || !allFinite(nx)) return null;
    out.push(nx);
    P = nx;
  }
  return out;
}

// ------------------------------------------------------------------ run on data

export interface StepRecord {
  /** Posterior state estimate. */
  x: number[];
  /** Posterior covariance diagonal. */
  pDiag: number[];
  /** Posterior estimate of each measured quantity, H x⁺, and its variance diag(H P⁺ Hᵀ). */
  hx: number[];
  hVar: number[];
  /** Innovation z − H x⁻ and its variance diag(S); null on a step with no measurement. */
  nu: number[] | null;
  sDiag: number[] | null;
  /** Normalised innovation squared νᵀ S⁻¹ ν; null without a measurement. */
  nis: number | null;
}

export interface RunResult {
  ok: true;
  steps: StepRecord[];
  /** Steps that had a measurement. */
  updates: number;
  meanNis: number;
}

/**
 * Runs the filter over a series. x0, P0 are the PRIOR at the first measurement. A row with a missing value (null) is
 * a predict-only step: the update is skipped for the whole row.
 */
export function runFilter(model: KalmanModel, x0: number[], P0: Matrix, z: (number | null)[][]): RunResult | Fail {
  const bad = validateModel(model);
  if (bad) return { ok: false, error: bad };
  const n = model.F.length;
  const mm = model.H.length;
  if (x0.length !== n || !x0.every(Number.isFinite)) return { ok: false, error: `x₀ needs ${n} finite number${n === 1 ? "" : "s"} (one per state).` };
  if (P0.length !== n || P0.some((r) => r.length !== n) || !allFinite(P0)) return { ok: false, error: `P₀ must be ${n} × ${n}.` };
  if (!z.length) return { ok: false, error: "There are no measurements to filter." };
  if (z.length > MAX_SAMPLES) return { ok: false, error: `The series has ${z.length} samples; this tool takes at most ${MAX_SAMPLES}.` };
  if (z.some((r) => r.length !== mm)) return { ok: false, error: `Each measurement row needs ${mm} value${mm === 1 ? "" : "s"} (one per row of H).` };
  const Ht = transpose(model.H);
  const Ft = transpose(model.F);
  let x: Matrix = x0.map((v) => [v]);
  let P = P0.map((r) => r.slice());
  const steps: StepRecord[] = [];
  let nisSum = 0;
  let updates = 0;
  for (let k = 0; k < z.length; k++) {
    const zk = z[k];
    let nu: number[] | null = null;
    let sDiag: number[] | null = null;
    let nis: number | null = null;
    if (zk.every((v) => v !== null && Number.isFinite(v))) {
      const u = updateFromPrior(model, P);
      if (!u) return { ok: false, error: `Step ${k + 1}: the innovation covariance could not be inverted.` };
      const hxPrior = mul(model.H, x);
      const nuM: Matrix = zk.map((v, i) => [(v as number) - hxPrior[i][0]]);
      const Si = invScaled(u.S) as Matrix;
      nis = mul(mul(transpose(nuM), Si), nuM)[0][0];
      x = add(x, mul(u.K, nuM));
      P = u.posterior;
      nu = nuM.map((r) => r[0]);
      sDiag = u.S.map((r, i) => r[i]);
      nisSum += nis;
      updates++;
    }
    const hx = mul(model.H, x).map((r) => r[0]);
    const hP = mul(mul(model.H, P), Ht);
    steps.push({ x: x.map((r) => r[0]), pDiag: P.map((r, i) => r[i]), hx, hVar: hP.map((r, i) => r[i]), nu, sDiag, nis });
    if (!allFinite(x) || !allFinite(P)) return { ok: false, error: `Step ${k + 1}: the estimate stopped being finite; check the model's scale.` };
    // Predict to the next step.
    x = mul(model.F, x);
    P = symmetrize(add(mul(mul(model.F, P), Ft), model.Q));
  }
  if (!updates) return { ok: false, error: "Every row has a missing value, so the filter never updated." };
  return { ok: true, steps, updates, meanNis: nisSum / updates };
}
