// Mechanical vibration — single- and multi-degree-of-freedom systems.
//
// THREE RESULTS IN THIS SUBJECT ARE COUNTER-INTUITIVE ENOUGH THAT GETTING THEM
// WRONG IS THE NORMAL OUTCOME, and this module is built around stating them:
//
//   1. RESONANCE IS NOT AT r = 1. The peak of the magnification curve for a
//      damped system is at r = sqrt(1 - 2*zeta^2), always BELOW the natural
//      frequency, and for zeta >= 1/sqrt(2) = 0.707 THERE IS NO PEAK AT ALL —
//      the response falls monotonically from the static deflection and the
//      system cannot be resonated by any forcing frequency. Quoting "resonance
//      at omega = omega_n" is the undamped special case taught first and then
//      never unlearned.
//
//   2. VIBRATION ISOLATION ONLY WORKS ABOVE r = sqrt(2). Transmissibility is
//      exactly 1 at r = sqrt(2) FOR EVERY DAMPING RATIO, and above 1 below it.
//      So a mount that is not soft enough does not isolate a little — it
//      AMPLIFIES, and the machine transmits more force to the floor than if it
//      were bolted down. This is the single most common practical error in the
//      subject, and it is a design failure that looks like a design.
//
//   3. DAMPING HELPS BELOW sqrt(2) AND HURTS ABOVE IT. More damping lowers the
//      resonant peak, which is why you want it while passing through resonance
//      on run-up — and it RAISES transmissibility in the isolation region,
//      because the damper provides a path for force that the spring alone did
//      not. "More damping is safer" is false in exactly the region isolators
//      are designed to work in.
//
// THE MULTI-DEGREE-OF-FREEDOM PROBLEM IS SOLVED AS A SYMMETRIC GENERALISED
// EIGENPROBLEM, K*phi = omega^2 * M*phi, and the symmetry is preserved on
// purpose. The lazy route is to form M^-1*K and hand it to a general eigenvalue
// routine; that matrix is NOT symmetric even though the problem is, so it
// discards the guarantee that the eigenvalues are real and can return complex
// natural frequencies for a perfectly ordinary structure. Instead M is factored
// as L*L^T and the problem transformed to L^-1*K*L^-T, which IS symmetric, and
// solved by the Jacobi routine in linalg.ts.
//
// A pleasant consequence: the Cholesky factorisation FAILS exactly when the
// mass matrix is not positive definite, and a mass matrix that is not positive
// definite is not a physical structure — it describes a degree of freedom with
// zero or negative inertia. So the numerical failure and the modelling error
// are the same event, and it is reported as the modelling error.
//
// FORCED RESPONSE OF A MULTI-DEGREE-OF-FREEDOM SYSTEM IS NOT A SECOND SOLVER.
// Because the mode shapes come back MASS-NORMALISED, phi^T*M*phi = I and
// phi^T*K*phi = diag(omega_n^2), so in modal coordinates the coupled system is
// exactly n INDEPENDENT single-degree-of-freedom oscillators — each one solved
// by the same arithmetic `forcedResponse` already uses. `modalForcedResponse`
// is therefore the SDOF path run n times and summed, which is also why the
// three counter-intuitive results above carry over mode by mode.
//
// THE ASSUMPTION THAT BUYS THAT, AND IT IS THE ONE PEOPLE SKIP: the undamped
// modes diagonalise M and K by construction, but they diagonalise the DAMPING
// matrix only when it is proportional to M, to K, or to a combination of the
// two (Rayleigh). A single discrete damper bolted between two floors — the
// everyday real case — does NOT satisfy this. The modes then fail to decouple,
// the true modes are complex, and the degrees of freedom stop reaching their
// peaks at the same instant. So this module takes MODAL DAMPING RATIOS as an
// input rather than accepting a damping matrix it would have to silently assume
// something about: the assumption becomes something the caller states, and it is
// repeated in the notes because a violation of it produces an answer that still
// looks completely reasonable.
//
// UNITS are the caller's, used consistently: mass in kg with stiffness in N/m
// gives rad/s.

import { Matrix, eigenSymmetric } from "./linalg";

export interface VibError {
  ok: false;
  error: string;
}

/** A pane recomputes on every keystroke. */
const MAX_DOF = 12;
const MAX_POINTS = 2000;

// ---------------------------------------------------------------------------
// Single degree of freedom
// ---------------------------------------------------------------------------

export type DampingKind = "undamped" | "underdamped" | "critically damped" | "overdamped";

export interface SdofProperties {
  ok: true;
  /** Undamped natural frequency, rad/s. */
  wn: number;
  /** Undamped natural frequency, Hz. */
  fn: number;
  /** Critical damping coefficient, 2*sqrt(k*m). */
  cc: number;
  zeta: number;
  /** Damped natural frequency, rad/s; zero unless underdamped. */
  wd: number;
  /** Damped natural frequency, Hz. */
  fd: number;
  kind: DampingKind;
  /** Static deflection under the weight of the mass, for a vertical spring. */
  staticDeflection: number;
  notes: string[];
}

export function sdofProperties(m: number, k: number, c: number): SdofProperties | VibError {
  for (const [name, v] of [
    ["mass", m],
    ["stiffness", k],
    ["damping coefficient", c],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (m <= 0) return { ok: false, error: "The mass must be greater than zero." };
  if (k <= 0) return { ok: false, error: "The stiffness must be greater than zero." };
  if (c < 0) return { ok: false, error: "The damping coefficient cannot be negative." };

  const wn = Math.sqrt(k / m);
  const cc = 2 * Math.sqrt(k * m);
  const zeta = c / cc;
  const notes: string[] = [];

  let kind: DampingKind;
  if (zeta === 0) kind = "undamped";
  else if (zeta < 1) kind = "underdamped";
  else if (Math.abs(zeta - 1) < 1e-12) kind = "critically damped";
  else kind = "overdamped";

  const wd = zeta < 1 ? wn * Math.sqrt(1 - zeta * zeta) : 0;

  if (zeta > 0 && zeta < 0.05) {
    notes.push(
      `The damping ratio is ${zeta.toFixed(4)}, so the damped and undamped natural frequencies ` +
        "differ by well under a percent and are interchangeable for most purposes. That is NOT " +
        "true of the resonant amplitude, which is inversely proportional to the damping and is " +
        "therefore extremely sensitive to it.",
    );
  }
  if (kind === "overdamped") {
    notes.push(
      "Overdamped: the system returns to rest without oscillating, and SLOWER than a critically " +
        "damped one. Critical damping is the fastest non-oscillatory return, not the most damping.",
    );
  }

  return {
    ok: true,
    wn,
    fn: wn / (2 * Math.PI),
    cc,
    zeta,
    wd,
    fd: wd / (2 * Math.PI),
    kind,
    staticDeflection: (m * 9.80665) / k,
    notes,
  };
}

export interface FreeResponse {
  ok: true;
  t: number[];
  x: number[];
  /** Logarithmic decrement between successive peaks; null unless underdamped. */
  logDecrement: number | null;
  notes: string[];
}

/** Free vibration from an initial displacement and velocity. */
export function freeResponse(
  m: number,
  k: number,
  c: number,
  x0: number,
  v0: number,
  tEnd: number,
  points = 400,
): FreeResponse | VibError {
  const p = sdofProperties(m, k, c);
  if (!p.ok) return p;
  for (const [name, v] of [
    ["initial displacement", x0],
    ["initial velocity", v0],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (!Number.isFinite(tEnd) || tEnd <= 0) return { ok: false, error: "The end time must be greater than zero." };

  const n = Math.max(2, Math.min(Math.floor(points) || 400, MAX_POINTS));
  const { wn, zeta, wd } = p;
  const t: number[] = [];
  const x: number[] = [];
  const notes: string[] = [];

  // Each damping case is a DIFFERENT closed form, not one formula with a
  // tolerance. The critically damped solution is not the limit of the
  // underdamped one evaluated at zeta = 1 — that form divides by wd, which is
  // zero there.
  for (let i = 0; i < n; i++) {
    const ti = (tEnd * i) / (n - 1);
    let xi: number;
    if (p.kind === "underdamped" || p.kind === "undamped") {
      const env = Math.exp(-zeta * wn * ti);
      xi = env * (x0 * Math.cos(wd * ti) + ((v0 + zeta * wn * x0) / wd) * Math.sin(wd * ti));
    } else if (p.kind === "critically damped") {
      xi = Math.exp(-wn * ti) * (x0 + (v0 + wn * x0) * ti);
    } else {
      const root = wn * Math.sqrt(zeta * zeta - 1);
      const s1 = -zeta * wn + root;
      const s2 = -zeta * wn - root;
      const A = (v0 - s2 * x0) / (s1 - s2);
      const B = x0 - A;
      xi = A * Math.exp(s1 * ti) + B * Math.exp(s2 * ti);
    }
    t.push(ti);
    x.push(xi);
  }

  let logDec: number | null = null;
  if (p.kind === "underdamped" && zeta > 0) {
    logDec = (2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta);
    notes.push(
      `Successive peaks fall by a factor of e^${logDec.toFixed(4)} = ${Math.exp(logDec).toFixed(4)}. ` +
        "That ratio is what makes the logarithmic decrement a practical way to measure damping " +
        "from a recorded trace: it needs no force measurement and no calibration.",
    );
  }
  if (p.kind === "undamped") {
    notes.push("With no damping this oscillates for ever at the natural frequency; nothing decays.");
  }

  return { ok: true, t, x, logDecrement: logDec, notes };
}

/**
 * Damping ratio measured from two peaks n cycles apart — the standard
 * experimental route, and the reason it is here rather than only its inverse.
 *
 * The exact relation is zeta = delta / sqrt(4*pi^2 + delta^2), not the
 * light-damping approximation zeta = delta/(2*pi). The two agree to about 1% up
 * to zeta = 0.1 and diverge badly after; the exact form costs nothing.
 */
export function dampingFromDecrement(
  x1: number,
  x2: number,
  cycles = 1,
): { ok: true; delta: number; zeta: number; notes: string[] } | VibError {
  if (!Number.isFinite(x1) || !Number.isFinite(x2))
    return { ok: false, error: "Both amplitudes must be finite numbers." };
  if (x1 <= 0 || x2 <= 0) return { ok: false, error: "Both amplitudes must be greater than zero." };
  if (!Number.isFinite(cycles) || cycles < 1) return { ok: false, error: "The number of cycles must be at least one." };
  if (x2 > x1) {
    return {
      ok: false,
      error:
        "The second amplitude is LARGER than the first, so this trace is growing rather than " +
        "decaying. A free vibration that grows is not a damped system — it is being driven, or " +
        "it is unstable (self-excited, as in flutter or stick-slip).",
    };
  }
  if (x2 === x1) {
    return { ok: false, error: "The two amplitudes are equal, so this trace shows no decay and the damping is zero." };
  }

  const delta = Math.log(x1 / x2) / Math.floor(cycles);
  const zeta = delta / Math.sqrt(4 * Math.PI * Math.PI + delta * delta);
  const notes: string[] = [];
  const approx = delta / (2 * Math.PI);
  if (Math.abs(approx - zeta) / zeta > 0.01) {
    notes.push(
      `The light-damping approximation zeta = delta/2pi would give ${approx.toFixed(4)} here, ` +
        `against the exact ${zeta.toFixed(4)} — a ${((100 * (approx - zeta)) / zeta).toFixed(0)}% ` +
        "error. The exact form is used.",
    );
  }
  notes.push(
    "Measuring over several cycles rather than one reduces the effect of reading error on any " +
      "single peak, which is why the cycle count is asked for.",
  );
  return { ok: true, delta, zeta, notes };
}

// ---------------------------------------------------------------------------
// Forced vibration
// ---------------------------------------------------------------------------

export interface ForcedResponse {
  ok: true;
  /** Frequency ratio, omega / omega_n. */
  r: number;
  /** Dynamic magnification factor, amplitude / static deflection. */
  magnification: number;
  /** Steady-state amplitude. */
  amplitude: number;
  /** Phase lag behind the force, degrees. */
  phaseDeg: number;
  /** Force transmissibility to the foundation. */
  transmissibility: number;
  /** Frequency ratio at which magnification peaks; null when there is no peak. */
  peakR: number | null;
  peakMagnification: number | null;
  isolating: boolean;
  notes: string[];
}

/** Magnification factor of a damped SDOF system at frequency ratio r. */
export function magnification(r: number, zeta: number): number {
  const a = 1 - r * r;
  return 1 / Math.sqrt(a * a + 4 * zeta * zeta * r * r);
}

/** Force transmissibility at frequency ratio r. */
export function transmissibility(r: number, zeta: number): number {
  const a = 1 - r * r;
  return Math.sqrt(1 + 4 * zeta * zeta * r * r) / Math.sqrt(a * a + 4 * zeta * zeta * r * r);
}

/** Steady-state response to a harmonic force of amplitude F0 at frequency w. */
export function forcedResponse(
  m: number,
  k: number,
  c: number,
  f0: number,
  w: number,
): ForcedResponse | VibError {
  const p = sdofProperties(m, k, c);
  if (!p.ok) return p;
  if (!Number.isFinite(f0)) return { ok: false, error: "The force amplitude must be a finite number." };
  if (!Number.isFinite(w) || w < 0) return { ok: false, error: "The forcing frequency must be zero or greater." };

  const { wn, zeta } = p;
  const r = w / wn;
  const mag = magnification(r, zeta);
  const tr = transmissibility(r, zeta);
  const staticDefl = f0 / k;
  const phaseDeg = (Math.atan2(2 * zeta * r, 1 - r * r) * 180) / Math.PI;

  const notes: string[] = [];

  // THE PEAK IS NOT AT r = 1, and above zeta = 1/sqrt(2) there is no peak.
  let peakR: number | null = null;
  let peakMag: number | null = null;
  if (zeta < 1 / Math.SQRT2) {
    peakR = Math.sqrt(1 - 2 * zeta * zeta);
    peakMag = 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta));
    if (zeta > 0) {
      notes.push(
        `The magnification peaks at r = ${peakR.toFixed(4)}, BELOW the natural frequency, not at ` +
          "r = 1. r = 1 is where the peak sits only for an undamped system.",
      );
    }
  } else {
    notes.push(
      `With zeta = ${zeta.toFixed(3)} at or above 1/sqrt(2) = 0.707 there is NO resonant peak at ` +
        "all: the magnification falls monotonically from 1 as the forcing frequency rises, and no " +
        "forcing frequency can resonate this system.",
    );
  }

  const isolating = r > Math.SQRT2;
  if (!isolating && r > 0) {
    notes.push(
      `The frequency ratio is ${r.toFixed(3)}, which is BELOW sqrt(2) = 1.414, so this mount is ` +
        `AMPLIFYING rather than isolating — transmissibility is ${tr.toFixed(3)}, and more force ` +
        "reaches the foundation than if the machine were bolted down rigidly. Isolation begins only " +
        "above sqrt(2), whatever the damping.",
    );
  } else if (isolating) {
    notes.push(
      `Transmissibility is ${tr.toFixed(4)}, so ${((1 - tr) * 100).toFixed(1)}% of the force is ` +
        "isolated. In this region MORE DAMPING MAKES ISOLATION WORSE — the damper is itself a path " +
        "for force — so damping here is a compromise against what is needed to survive run-up " +
        "through resonance.",
    );
  }

  if (Math.abs(r - 1) < 0.1 && zeta < 0.1) {
    notes.push(
      "This is running very close to resonance with light damping, where the amplitude is " +
        "governed almost entirely by the damping ratio and is therefore highly uncertain — a " +
        "factor-of-two error in an estimated damping is a factor-of-two error in the amplitude.",
    );
  }

  return {
    ok: true,
    r,
    magnification: mag,
    amplitude: staticDefl * mag,
    phaseDeg,
    transmissibility: tr,
    peakR,
    peakMagnification: peakMag,
    isolating,
    notes,
  };
}

/** Magnification and transmissibility across a sweep of frequency ratios. */
export function frequencySweep(
  zeta: number,
  rMax = 4,
  points = 400,
): { r: number[]; magnification: number[]; transmissibility: number[] } {
  const n = Math.max(2, Math.min(Math.floor(points) || 400, MAX_POINTS));
  const r: number[] = [];
  const mag: number[] = [];
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    const ri = (rMax * i) / (n - 1);
    r.push(ri);
    mag.push(magnification(ri, zeta));
    tr.push(transmissibility(ri, zeta));
  }
  return { r, magnification: mag, transmissibility: tr };
}

// ---------------------------------------------------------------------------
// Multi-degree-of-freedom
// ---------------------------------------------------------------------------

export interface ModalResult {
  ok: true;
  /** Natural frequencies, ascending, rad/s. */
  frequencies: number[];
  /** The same in Hz. */
  frequenciesHz: number[];
  /** Mode shapes as columns, mass-normalised so phi^T*M*phi = I. */
  modes: Matrix;
  notes: string[];
}

/** Cholesky factor L with M = L*L^T; null when M is not positive definite. */
function cholesky(M: Matrix): Matrix | null {
  const n = M.length;
  const L: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = M[i][j];
      for (let p = 0; p < j; p++) sum -= L[i][p] * L[j][p];
      if (i === j) {
        if (!(sum > 0) || !Number.isFinite(sum)) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        if (L[j][j] === 0) return null;
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Solves L*y = b for lower-triangular L. */
function forwardSolve(L: Matrix, b: number[]): number[] {
  const n = b.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let j = 0; j < i; j++) s -= L[i][j] * y[j];
    y[i] = s / L[i][i];
  }
  return y;
}

/** Solves L^T*x = b for lower-triangular L. */
function backSolveT(L: Matrix, b: number[]): number[] {
  const n = b.length;
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= L[j][i] * x[j];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * Natural frequencies and mode shapes of an undamped multi-degree-of-freedom
 * system, K*phi = omega^2 * M*phi.
 *
 * MODE SHAPES HAVE NO ABSOLUTE SCALE — only the ratios between degrees of
 * freedom mean anything, because an eigenvector times any constant is the same
 * eigenvector. They are returned MASS-NORMALISED (phi^T*M*phi = 1), which is
 * the convention that makes the modal equations of motion come out with unit
 * masses, so a shape here should be read for its pattern of signs and relative
 * magnitudes and never for its units.
 *
 * A RIGID-BODY MODE has zero frequency and is a real feature, not an error: an
 * unrestrained structure can translate without any strain energy. It is
 * reported rather than filtered out, because a structure that has one when the
 * modeller did not expect one is missing a restraint.
 */
export function modalAnalysis(M: Matrix, K: Matrix): ModalResult | VibError {
  const n = M.length;
  if (!n) return { ok: false, error: "The mass matrix is empty." };
  if (n > MAX_DOF) return { ok: false, error: `Too many degrees of freedom (${n}); the limit is ${MAX_DOF}.` };
  if (K.length !== n) return { ok: false, error: "The mass and stiffness matrices must be the same size." };
  for (let i = 0; i < n; i++) {
    if (M[i].length !== n || K[i].length !== n)
      return { ok: false, error: "Both matrices must be square and the same size." };
    for (let j = 0; j < n; j++) {
      if (!Number.isFinite(M[i][j]) || !Number.isFinite(K[i][j]))
        return { ok: false, error: "Every entry must be a finite number." };
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const scale = 1 + Math.abs(M[i][j]) + Math.abs(M[j][i]);
      if (Math.abs(M[i][j] - M[j][i]) > 1e-9 * scale)
        return { ok: false, error: "The mass matrix must be symmetric." };
      const ks = 1 + Math.abs(K[i][j]) + Math.abs(K[j][i]);
      if (Math.abs(K[i][j] - K[j][i]) > 1e-9 * ks)
        return { ok: false, error: "The stiffness matrix must be symmetric." };
    }
  }

  const L = cholesky(M);
  if (!L) {
    return {
      ok: false,
      error:
        "The mass matrix is not positive definite, so this is not a physical structure — some " +
        "degree of freedom has zero or negative inertia. Check for a massless degree of freedom " +
        "(condense it out rather than giving it zero mass) or a sign error.",
    };
  }

  // A = L^-1 * K * L^-T, symmetric, with the same eigenvalues as M^-1*K.
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    // L^-T e_j
    cols.push(backSolveT(L, e));
  }
  const KLinvT: Matrix = Array.from({ length: n }, (_, i) => cols.map((col) => {
    let s = 0;
    for (let p = 0; p < n; p++) s += K[i][p] * col[p];
    return s;
  }));
  const A: Matrix = [];
  for (let j = 0; j < n; j++) {
    const colJ = KLinvT.map((row) => row[j]);
    const solved = forwardSolve(L, colJ);
    A.push(solved);
  }
  // A was built column-wise; transpose into row-major and symmetrise the tiny
  // asymmetry that rounding leaves, so eigenSymmetric accepts it.
  const As: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (A[j][i] + A[i][j]) / 2),
  );

  const eig = eigenSymmetric(As);
  if (!eig) return { ok: false, error: "The transformed eigenproblem could not be solved." };

  const order = eig.values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const notes: string[] = [];
  const frequencies: number[] = [];
  const modes: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  let negative = 0;
  let rigid = 0;
  const scale = Math.max(...eig.values.map(Math.abs), 1);

  // HOW SMALL IS "ZERO" FOR AN EIGENVALUE. This threshold decides whether a mode
  // is a rigid-body mode, and getting it wrong does not mislabel the mode — it
  // DELETES it, because lambda is then forced to 0 and the frequency with it.
  //
  // It was 1e-9 relative to the largest eigenvalue, which is about seven orders
  // looser than the rounding of a symmetric eigensolve (~eps = 2.2e-16). Any
  // structure whose eigenvalue spread exceeded 1e9 therefore had its LOWEST
  // GENUINE MODE zeroed and announced as a rigid-body mode. That spread is not
  // exotic: 1000 kg on a soft mount carrying a 1 g part on a stiff spring does
  // it, with a stiffness matrix that is plainly positive definite. The true
  // frequencies are 1.0 and 1e5 rad/s; the engine reported 0 and 1e5, refused
  // the static case outright as "the whole structure accelerates away", and was
  // 3x wrong at a mundane 0.5 rad/s.
  //
  // 1e-12 keeps four orders of headroom above rounding — a genuinely singular K
  // still produces an eigenvalue at ~1e-16 of the scale and is still caught —
  // while moving the cliff out by three orders. A cliff still exists, because
  // separating a real eigenvalue from zero is a finite-precision question, so
  // the note below says when the spread is close enough to matter rather than
  // pretending the threshold is exact.
  const ZERO_EIGENVALUE = 1e-12;

  order.forEach((o, col) => {
    let lambda = o.v;
    if (lambda < -ZERO_EIGENVALUE * scale) {
      negative++;
      lambda = 0;
    } else if (Math.abs(lambda) <= ZERO_EIGENVALUE * scale) {
      rigid++;
      lambda = 0;
    }
    frequencies.push(Math.sqrt(Math.max(lambda, 0)));
    // phi = L^-T * psi, then mass-normalised.
    const psi = eig.vectors.map((row) => row[o.i]);
    const phi = backSolveT(L, psi);
    let mm = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mm += phi[i] * M[i][j] * phi[j];
    const norm = mm > 0 ? Math.sqrt(mm) : 1;
    // Sign convention: make the largest-magnitude entry positive, so the same
    // structure does not report a mode and its negation on different runs.
    let biggest = 0;
    for (let i = 1; i < n; i++) if (Math.abs(phi[i]) > Math.abs(phi[biggest])) biggest = i;
    const sign = phi[biggest] < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) modes[i][col] = (sign * phi[i]) / norm;
  });

  // A spread this wide means the smallest eigenvalue is within a few orders of
  // the point where double precision cannot tell it from zero. The answer is
  // still the best available, but "the lowest natural frequency" is the number
  // to distrust, and saying so is cheaper than being quietly wrong about it.
  const nonZero = frequencies.filter((w) => w > 0);
  if (nonZero.length >= 2) {
    const spread = Math.max(...nonZero) / Math.min(...nonZero);
    if (spread > 1e5) {
      notes.push(
        `The natural frequencies span a factor of ${spread.toExponential(1)}. A stiffness ratio ` +
          "that wide pushes the LOWEST frequency towards the limit of what double precision can " +
          "separate from zero, so treat it as the least reliable number here. It usually means a " +
          "very light mass on a very stiff connection, which is often better condensed out of the " +
          "model than solved alongside the rest of it.",
      );
    }
  }

  if (rigid) {
    notes.push(
      `${rigid} mode(s) came out at zero frequency. That is a RIGID-BODY MODE — the structure can ` +
        "move without storing any strain energy — and it is a real feature of an unrestrained " +
        "model, not a numerical failure. If you expected everything to be restrained, a support is " +
        "missing.",
    );
  }
  if (negative) {
    notes.push(
      `${negative} eigenvalue(s) came out negative, which means the stiffness matrix is not ` +
        "positive semi-definite. Physically that is an unstable structure (it releases energy when " +
        "displaced); numerically it is usually a sign error in an off-diagonal coupling term. " +
        "Those frequencies are reported as zero rather than as imaginary numbers.",
    );
  }
  notes.push(
    "Mode shapes are MASS-NORMALISED (phi^T*M*phi = 1) and have no absolute scale — read the " +
      "pattern of signs and relative magnitudes, not the values. A sign change between entries " +
      "means those degrees of freedom move in opposite directions in that mode.",
  );
  notes.push(
    "These are UNDAMPED natural frequencies. Light damping shifts them by a fraction of a percent " +
      "and does not change the mode shapes appreciably; heavy or non-proportional damping does " +
      "both, and needs a complex-mode analysis this does not do.",
  );

  return {
    ok: true,
    frequencies,
    frequenciesHz: frequencies.map((w) => w / (2 * Math.PI)),
    modes,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Multi-degree-of-freedom forced response
// ---------------------------------------------------------------------------

/**
 * Modal damping ratios from a RAYLEIGH damping matrix C = alpha*M + beta*K.
 *
 * Rayleigh damping exists because it is the easiest damping matrix that the
 * undamped modes diagonalise, not because structures obey it. Its shape is
 * fixed and awkward: the alpha term damps LOW modes and the beta term damps
 * HIGH ones, so a single (alpha, beta) pair can be fitted to exactly two
 * frequencies and everything between them comes out UNDER-damped while
 * everything outside comes out over-damped. Anyone using it should see the
 * ratios it actually implies mode by mode, which is why this returns them
 * rather than hiding them inside the solve.
 */
export function rayleighDamping(alpha: number, beta: number, frequencies: number[]): number[] {
  return frequencies.map((w) => (w > 0 ? alpha / (2 * w) + (beta * w) / 2 : 0));
}

/**
 * Rayleigh damping given to `modalForcedResponse` DIRECTLY, rather than via the
 * ratios above.
 *
 * WHY THIS EXISTS, AND IT IS NOT CONVENIENCE. A damping RATIO cannot express the
 * damping on a rigid-body mode. The modal equation is
 *
 *     q'' + (2*zeta*wn) q' + wn^2 q = f
 *
 * and with C = alpha*M + beta*K the middle coefficient is exactly
 * `alpha + beta*wn^2`, which is perfectly well defined at wn = 0 — a free-free
 * structure really is damped in its rigid-body mode, by the alpha term. But
 * dividing that by 2*wn to get a ratio is a division by zero, so
 * `rayleighDamping` returns 0 there and the mode comes out UNDAMPED. That is a
 * wrong number, not a missing one: on a free-free chain at alpha = 0.6,
 * beta = 0.002 it overstated the amplitude by 56% and the phase by 50 degrees.
 *
 * Passing the pair through instead keeps the coefficient `alpha + beta*wn^2`,
 * which is correct for every mode including the rigid ones. The ratios remain
 * useful for READING OFF what a given (alpha, beta) implies mode by mode, which
 * is what `rayleighDamping` is for.
 */
export interface RayleighDamping {
  alpha: number;
  beta: number;
}

/** Damping as uniform ratio, per-mode ratios, or a Rayleigh pair. */
export type ModalDamping = number | number[] | RayleighDamping;

function isRayleigh(d: ModalDamping): d is RayleighDamping {
  return typeof d === "object" && d !== null && !Array.isArray(d);
}

/**
 * Is the generalised force on a mode zero — i.e. is the load applied at a NODE
 * of it?
 *
 * The test has to be RELATIVE, and relative to the right thing. By
 * Cauchy-Schwarz |phi^T*F| <= |phi|*|F|, so that product is the largest the
 * generalised force could possibly be and is the only scale the comparison can
 * use. An absolute tolerance makes the answer depend on the units the load was
 * typed in, and `1 + |F|` is not a fix either: it still leaves an absolute floor
 * that any sufficiently small load sits underneath, so a genuine resonance was
 * reported as a node once the load dropped below 1e-12.
 *
 * A zero load vector is nodal for every mode, which is the right answer: nothing
 * is excited because nothing is applied.
 */
function isNodal(f: number, phi: number[], force: number[]): boolean {
  const pn = Math.hypot(...phi);
  const fn = Math.hypot(...force);
  if (pn === 0 || fn === 0) return true;
  // DIVIDE, never form |phi|*|F|. Mode shapes are mass-normalised, so |phi| goes
  // like 1/sqrt(m): a light degree of freedom under a large load overflows that
  // product to Infinity, and `|f| < 1e-12 * Infinity` is true of every finite f.
  // A mode sitting exactly on an undamped resonance was then reported as a NODE
  // with amplitude 0 — the contribution said "force: 1e307" and "amplitude: 0"
  // in the same object — when the true response is unbounded. Dividing twice
  // keeps every intermediate in range and asks the identical question.
  return Math.abs(f) / pn / fn < 1e-12;
}

export interface ModalContribution {
  /** 1-based mode number, matching the modal analysis listing. */
  mode: number;
  /** Undamped natural frequency, rad/s. */
  wn: number;
  zeta: number;
  /** Frequency ratio omega / wn; Infinity for a rigid-body mode. */
  r: number;
  /** Generalised force phi^T * F. Zero means the force cannot excite this mode. */
  force: number;
  /** Peak modal coordinate |q|. */
  amplitude: number;
  /** Share of the largest physical DOF response attributable to this mode, 0..1. */
  share: number;
}

export interface ModalForcedResult {
  ok: true;
  frequencies: number[];
  frequenciesHz: number[];
  modes: Matrix;
  /**
   * Modal damping ratio for each mode, FOR REPORTING. The solve carries the
   * coefficient 2*zeta*wn instead, because a ratio cannot represent damping on a
   * rigid-body mode: under Rayleigh damping that mode's coefficient is alpha,
   * while its ratio is alpha/(2*0) and is reported here as 0. A note says so
   * whenever it happens; do NOT feed these ratios back in place of the pair.
   */
  zeta: number[];
  /** Steady-state amplitude of each physical degree of freedom. */
  amplitude: number[];
  /** Phase LAG of each degree of freedom behind the force, degrees. */
  phaseDeg: number[];
  contributions: ModalContribution[];
  /** 1-based mode contributing most to the response. */
  dominantMode: number;
  notes: string[];
}

/**
 * Steady-state response of an undamped-mode (classically damped) MDOF system to
 * a harmonic force vector F*cos(omega*t), by MODAL SUPERPOSITION.
 *
 * WHY THIS WORKS AT ALL, AND THE ASSUMPTION IT RESTS ON. The mode shapes from
 * `modalAnalysis` are mass-normalised, so phi^T*M*phi = I and phi^T*K*phi is the
 * diagonal matrix of omega_n^2. In those coordinates the coupled system becomes
 * n INDEPENDENT single-degree-of-freedom oscillators, each solved by exactly the
 * arithmetic `forcedResponse` already uses. That decoupling is why an MDOF
 * forced response is not a new solver — it is the SDOF one, n times.
 *
 * IT REQUIRES CLASSICAL (PROPORTIONAL) DAMPING. The undamped modes diagonalise
 * M and K by construction; they diagonalise the damping matrix C only if C is
 * proportional to M, to K, or to a combination of them. For an arbitrary C —
 * a single discrete damper bolted between two floors is the everyday example —
 * the modes do NOT decouple, the real mode shapes are wrong, and the true modes
 * are complex, meaning the degrees of freedom no longer reach their peaks at the
 * same instant. This function therefore takes MODAL DAMPING RATIOS rather than a
 * damping matrix: doing so makes the assumption an input the caller has to state
 * instead of a property silently assumed of a matrix they supplied. It is stated
 * again in the notes, because a wrong answer here looks entirely reasonable.
 *
 * PHASE is reported as a LAG behind the force, in the same sense as the SDOF
 * `forcedResponse`. Under classical damping the degrees of freedom can still
 * differ in phase from one another, because each mode lags by its own amount and
 * the physical response is their sum.
 */
export function modalForcedResponse(
  M: Matrix,
  K: Matrix,
  force: number[],
  omega: number,
  damping: ModalDamping,
): ModalForcedResult | VibError {
  const modal = modalAnalysis(M, K);
  if (!modal.ok) return modal;

  const n = modal.frequencies.length;
  if (force.length !== n)
    return {
      ok: false,
      error: `The force vector has ${force.length} entries but the system has ${n} degrees of freedom.`,
    };
  for (const f of force)
    if (!Number.isFinite(f)) return { ok: false, error: "Every force amplitude must be a finite number." };
  if (!Number.isFinite(omega) || omega < 0)
    return { ok: false, error: "The forcing frequency must be zero or greater." };

  const notes: string[] = [];

  // Damping is carried as the modal COEFFICIENT 2*zeta*wn, not as the ratio,
  // because the ratio cannot represent damping on a rigid-body mode (see
  // RayleighDamping). `zeta` is derived back out purely for reporting.
  const zeta: number[] = [];
  const damp: number[] = [];
  if (isRayleigh(damping)) {
    const { alpha, beta } = damping;
    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha < 0 || beta < 0)
      return { ok: false, error: "Rayleigh alpha and beta must both be finite and zero or greater." };
    let rigid = false;
    for (let i = 0; i < n; i++) {
      const wn = modal.frequencies[i];
      damp.push(alpha + beta * wn * wn);
      zeta.push(wn > 0 ? alpha / (2 * wn) + (beta * wn) / 2 : 0);
      if (wn === 0) rigid = true;
    }
    // A rigid-body mode IS damped under Rayleigh — its coefficient is alpha —
    // but a damping RATIO is alpha/(2*0) and cannot express it, so `zeta` has to
    // report 0 there. Zero is exactly the value that reads as "undamped", which
    // is the wrong impression to leave when the solve did use alpha. Feeding the
    // reported ratios back in place of the pair is a 1104% amplitude error at
    // low frequency, so this cannot go unsaid.
    if (rigid && alpha > 0) {
      notes.push(
        "The rigid-body mode is reported with zeta = 0, and that is a limitation of the RATIO, not " +
          "a statement that the mode is undamped: its modal damping coefficient is alpha itself, " +
          "and the response above was computed with it. A ratio is 2*zeta*wn and cannot represent " +
          "damping at wn = 0, which is why the alpha/beta pair is the input rather than the ratios.",
      );
    }
  } else {
    if (Array.isArray(damping) && damping.length !== n)
      return { ok: false, error: `Give one damping ratio or ${n} of them; ${damping.length} were given.` };
    for (let i = 0; i < n; i++) {
      const z = Array.isArray(damping) ? damping[i] : damping;
      if (z === undefined)
        return { ok: false, error: `A damping ratio is missing for mode ${i + 1}; give one value or ${n}.` };
      if (!Number.isFinite(z) || z < 0)
        return { ok: false, error: "Every damping ratio must be zero or greater." };
      zeta.push(z);
      damp.push(2 * z * modal.frequencies[i]);
    }
    // A ratio on a rigid-body mode is 2*zeta*0 = 0 whatever the ratio, so the
    // mode is undamped in this model. That is a real consequence of the
    // parameterisation rather than a choice, and it must not pass silently.
    if (modal.frequencies.some((w) => w === 0) && !isRayleigh(damping)) {
      notes.push(
        "This structure has a rigid-body mode, and a damping RATIO cannot describe damping on it " +
          "— 2*zeta*wn is zero whatever ratio you give, so that mode is being treated as UNDAMPED. " +
          "If the damping really is Rayleigh, pass alpha and beta instead: the modal coefficient is " +
          "alpha + beta*wn^2, which is well defined at wn = 0 and generally is NOT zero.",
      );
    }
  }

  // --- modal coordinates: q_i = f_i / (wn^2 - w^2 + 2j*zeta*wn*w) ---
  const qRe: number[] = [];
  const qIm: number[] = [];
  const contributions: ModalContribution[] = [];

  for (let i = 0; i < n; i++) {
    const wn = modal.frequencies[i];
    const phi = modal.modes.map((row) => row[i]);
    let f = 0;
    for (let j = 0; j < n; j++) f += phi[j] * force[j];

    // FORMED IN SCALED UNITS so the squares cannot overflow. Written directly,
    // `wn*wn - omega*omega` overflows at omega above ~1.34e154 — and Smith's
    // algorithm then quietly returns ZERO for it rather than NaN (t = im/re is
    // -0, d is -Infinity, so both parts are -0), which the finiteness guard
    // cannot see. That turned an explicit refusal into a silent wrong answer:
    // F = 1e300 at omega = 1e160 has the perfectly representable response 1e-20
    // and came back as amplitude 0 with a contribution reading
    // "force: 1e300, amplitude: 0" — the same self-contradiction the isNodal
    // repair was written to remove.
    //
    // Dividing through by the larger of wn and omega BEFORE squaring keeps every
    // intermediate at or below 1. The whole quotient is computed in those units
    // and rescaled once at the end.
    const mag = Math.max(wn, omega);
    const sc = mag > 0 && Number.isFinite(mag) ? mag : 1;
    const wr = wn / sc;
    const orr = omega / sc;
    const re = wr * wr - orr * orr;
    const im = (damp[i] / sc) * orr;

    // The steady state fails to exist ONLY when the denominator is exactly zero.
    // Testing `re*re + im*im === 0` instead made that judgement on a squared
    // quantity: with zeta = 1e-200 the true `im` is small but nonzero, `im*im`
    // underflowed to 0, and a mode the user HAD damped was refused with "that
    // mode has zero damping. Give a non-zero damping ratio." Asking about re and
    // im directly cannot underflow.
    if (re === 0 && im === 0) {
      // Undamped and driven exactly at this natural frequency, or a rigid-body
      // mode driven at zero frequency. Either way the steady state does not
      // exist: the amplitude grows without bound, and returning Infinity here
      // would propagate into every physical DOF as NaN.
      // Is the generalised force zero? This must be asked RELATIVE to what the
      // product phi^T*F could possibly be, which is |phi|*|F| by Cauchy-Schwarz.
      // An absolute tolerance made the answer depend on the units the load was
      // typed in: the same structure and the same load direction was called a
      // node at f0 = 1e-12 and refused as unbounded at f0 = 1e-11, and a
      // genuinely nodal load flipped between accepted and refused according to
      // which way its float residue rounded. Note that `1 + |F|` is NOT a fix —
      // it still leaves an absolute floor that a small load sits under.
      if (isNodal(f, phi, force)) {
        // The force cannot excite this mode, so it simply does not participate.
        qRe.push(0);
        qIm.push(0);
        contributions.push({ mode: i + 1, wn, zeta: zeta[i], r: wn > 0 ? omega / wn : Infinity, force: f, amplitude: 0, share: 0 });
        notes.push(
          wn === 0
            ? `Mode ${i + 1} is a RIGID-BODY mode and the load does no net work on it — the applied ` +
              "forces are self-equilibrating, so the structure does not drift. That holds for any " +
              "load whose resultant along this mode is zero, wherever it acts."
            : `Mode ${i + 1} would be driven at resonance with no damping, but the generalised force ` +
              "on it is zero — the load is applied at a NODE of that mode — so it is not excited. " +
              "That cancellation is exact here and will not survive a small change in where the load acts.",
        );
        continue;
      }
      return {
        ok: false,
        error:
          wn === 0
            ? "This structure has a rigid-body mode and the load has a steady (zero-frequency) " +
              "component along it, so there is NO steady state: the whole structure accelerates " +
              "away. Restrain it, or balance the load so it does no net work on the rigid-body mode."
            : `The forcing frequency is exactly mode ${i + 1}'s natural frequency (${wn.toFixed(6)} rad/s) ` +
              "and that mode has zero damping, so the amplitude grows without bound and there is no " +
              "steady state to report. Give a non-zero damping ratio, or move off the resonance.",
      };
    }

    // q = f / (re + j*im), by SMITH'S ALGORITHM rather than the textbook
    // (re - j*im)/(re^2 + im^2).
    //
    // The textbook form squares both parts first, so it overflows whenever
    // either exceeds about 1.3e154 even though the QUOTIENT is perfectly
    // ordinary. F = 1e300 at omega = 1e150 has the elementary answer
    // F/(m*omega^2) = 1, and it came back as Infinity/Infinity = NaN, which the
    // guard below then reported as "the response overflowed... use units that
    // keep the numbers in a physical range" — advice that cannot help, because
    // the result was representable all along. Dividing through by the larger of
    // the two first keeps every intermediate in range.
    // `re` and `im` are in units of sc^2, so the generalised force has to be
    // divided by the same thing. Written as two divisions rather than `f/(sc*sc)`
    // because sc*sc is exactly the square that overflowing was the problem.
    const fs = f / sc / sc;
    let qr: number;
    let qi: number;
    if (Math.abs(re) >= Math.abs(im)) {
      const t = im / re;
      const d = re + im * t;
      qr = fs / d;
      qi = (-fs * t) / d;
    } else {
      const t = re / im;
      const d = re * t + im;
      qr = (fs * t) / d;
      qi = -fs / d;
    }
    qRe.push(qr);
    qIm.push(qi);
    contributions.push({
      mode: i + 1,
      wn,
      zeta: zeta[i],
      r: wn > 0 ? omega / wn : Infinity,
      force: f,
      amplitude: Math.hypot(qr, qi),
      share: 0,
    });
  }

  // --- physical response x = phi * q, complex ---
  const xRe = new Array(n).fill(0);
  const xIm = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      xRe[j] += modal.modes[j][i] * qRe[i];
      xIm[j] += modal.modes[j][i] * qIm[i];
    }
  }
  const amplitude = xRe.map((re, j) => Math.hypot(re, xIm[j]));

  // A finite input can still overflow on the way through: omega = 1e200 squares
  // to 1e400, `re` becomes -Infinity, den2 becomes Infinity, and f*(-Infinity)
  // over Infinity is NaN. Every guard above passed, so without this the function
  // returns ok:true carrying NaN, and the pane prints "not finite" as though it
  // were an answer. Refuse instead, and say which quantity was out of range —
  // the arithmetic overflowed, the model did not fail.
  // `zeta` is reported, so it has to be finite too. alpha/(2*wn) with a large
  // alpha and a small-but-nonzero wn overflows while every amplitude stays
  // finite, and the pane then printed "zeta = not finite" as a success — the
  // exact symptom this guard exists to prevent, one field over.
  if (!amplitude.every(Number.isFinite) || !zeta.every(Number.isFinite)) {
    return {
      ok: false,
      error:
        `The response overflowed double precision at omega = ${omega}. The inputs are individually ` +
        "finite but their combination is not representable — omega squared, or a damping " +
        "coefficient times omega, has run past about 1e308. Use units that keep the numbers in a " +
        "physical range rather than working in raw SI at extreme scale.",
    };
  }
  // atan2(-Im, Re) is the LAG: the SDOF convention has the response trailing the
  // force, and q carries a negative imaginary part when it does.
  const phaseDeg = xRe.map((re, j) => (Math.atan2(-xIm[j], re) * 180) / Math.PI);

  // --- which mode is actually doing the work ---
  // Measured at the DOF that moves most, so "dominant" means dominant in the
  // response being reported rather than in an abstract modal norm.
  let peak = 0;
  for (let j = 1; j < n; j++) if (amplitude[j] > amplitude[peak]) peak = j;
  const perMode = contributions.map((c, i) => Math.abs(modal.modes[peak][i]) * c.amplitude);
  const total = perMode.reduce((s, v) => s + v, 0);
  contributions.forEach((c, i) => {
    c.share = total > 0 ? perMode[i] / total : 0;
  });
  let dominant = 0;
  for (let i = 1; i < n; i++) if (perMode[i] > perMode[dominant]) dominant = i;

  // --- notes: the things that are wrong by default ---
  notes.push(
    "MODAL SUPERPOSITION ASSUMES CLASSICAL DAMPING — that the undamped mode shapes diagonalise the " +
      "damping matrix too. That holds for damping proportional to M, to K, or to a combination " +
      "(Rayleigh), and it does NOT hold for a discrete damper between two degrees of freedom, which " +
      "is the common real case. When it fails the true modes are complex, the degrees of freedom no " +
      "longer peak at the same instant, and this answer is wrong in a way that still looks sensible.",
  );

  const resonant = contributions.filter((c) => c.wn > 0 && Math.abs(c.r - 1) < 0.15);
  if (resonant.length) {
    notes.push(
      `The forcing frequency is within 15% of mode ${resonant.map((c) => c.mode).join(", ")}. ` +
        "EVERY natural frequency is a resonance, not just the first — an MDOF structure has as many " +
        "as it has degrees of freedom, and a run-up passes through all of them below the operating " +
        "speed.",
    );
  }

  // Same question, same measure as the solve above — these two disagreeing is
  // how a mode gets refused as an unbounded resonance in one breath and listed
  // as unexcited in the next.
  const silent = contributions.filter((c, i) =>
    isNodal(c.force, modal.modes.map((row) => row[i]), force),
  );
  if (silent.length && silent.length < n) {
    notes.push(
      `Mode(s) ${silent.map((c) => c.mode).join(", ")} receive essentially no generalised force, so ` +
        "they do not participate however close the forcing is to them. A load applied at a NODE of a " +
        "mode cannot excite that mode — which is a real design lever, and also a reason a measured " +
        "response can miss a mode entirely if the shaker sits in the wrong place.",
    );
  }

  if (contributions[dominant].share < 0.9 && n > 1) {
    notes.push(
      `No single mode dominates: mode ${contributions[dominant].mode} contributes only ` +
        `${(contributions[dominant].share * 100).toFixed(0)}% of the largest response. Single-mode ` +
        "approximations are not safe here, and the modal contributions can partially CANCEL, so the " +
        "total is not the sum of the individual peaks.",
    );
  }

  // Keyed on the COEFFICIENT actually used, not on the reported ratio. Under
  // Rayleigh damping a rigid-body mode has ratio 0 and coefficient alpha, so
  // testing the ratio announced "the damping you did not supply" to a user who
  // had supplied it and whose answer already used it.
  if (damp.every((d) => d === 0)) {
    notes.push(
      "With zero damping this is the undamped forced response. It is finite only because the " +
        "forcing frequency does not coincide with a natural frequency; the amplitude near any of " +
        "them is governed entirely by the damping you did not supply.",
    );
  }

  return {
    ok: true,
    frequencies: modal.frequencies,
    frequenciesHz: modal.frequenciesHz,
    modes: modal.modes,
    zeta,
    amplitude,
    phaseDeg,
    contributions,
    dominantMode: contributions[dominant].mode,
    notes,
  };
}

/** Builds the mass and stiffness matrices of a chain of masses and springs. */
export function chainSystem(
  masses: number[],
  springs: number[],
  groundedEnd = true,
): { M: Matrix; K: Matrix } | VibError {
  const n = masses.length;
  if (!n) return { ok: false, error: "Give at least one mass." };
  if (n > MAX_DOF) return { ok: false, error: `Too many masses (${n}); the limit is ${MAX_DOF}.` };
  const need = groundedEnd ? n : n - 1;
  if (springs.length !== need) {
    return {
      ok: false,
      error: `A ${groundedEnd ? "grounded" : "free-free"} chain of ${n} masses needs ${need} spring(s); ${springs.length} given.`,
    };
  }
  for (const m of masses) if (!Number.isFinite(m) || m <= 0) return { ok: false, error: "Every mass must be greater than zero." };
  for (const k of springs) if (!Number.isFinite(k) || k <= 0) return { ok: false, error: "Every stiffness must be greater than zero." };

  const M: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? masses[i] : 0)));
  const K: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  // Spring i connects mass i-1 to mass i, with spring 0 to ground when grounded.
  for (let s = 0; s < springs.length; s++) {
    const k = springs[s];
    const a = groundedEnd ? s - 1 : s;
    const b = groundedEnd ? s : s + 1;
    if (a >= 0) {
      K[a][a] += k;
      K[a][b] -= k;
      K[b][a] -= k;
    }
    K[b][b] += k;
  }
  return { M, K };
}
