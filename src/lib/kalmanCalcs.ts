// Pane glue for the Kalman-filter and attitude calculators (Release E, gap #7): the steady-state Kalman filter of a
// linear time-invariant model, the filter run on a pasted measurement series (group "Aviation & avionics"), and
// attitude conversions — quaternion ↔ rotation matrix ↔ Euler angles (all 12 sequences, intrinsic or extrinsic) ↔
// axis–angle, composition and slerp (group "Robotics & kinematics"). Kept OUT of taskpane.ts so the exact objects the
// pane registers can be tested; the integrator spreads KALMAN_CALCS into ENG_CALCS.
//
// No number is computed here: kalman.ts and attitude.ts own them all (and linalg.ts owns every matrix routine). This
// file reads the fields, words the result under the display contract (U+2212 minus, ×10ⁿ, no em dash, NaN or
// Infinity) and draws.
//
// UNIT CONTRACTS. The two Kalman tools are "same-units": F, H, Q, R, P carry the units of the user's own state vector
// (position in m and velocity in m/s give Q entries in m², m²/s and m²/s²), so there is no single unit per field to
// convert to; any consistent unit system works, and a unit typed after a number is refused by name. The attitude tool
// is "converts": every angle goes through the unit layer (30°, 0.5 rad, 1800 arcmin); quaternion and matrix entries
// are pure numbers.

import type { EngCalcDef } from "./engCalc";
import { engReport } from "./engReport";
import type { AnalyzeOutput, AnalyzeBlock, EngOutput } from "./analyzeBlocks";
import { parseMeasured } from "./units";
import { fmtSig, MINUS } from "./axis";
import { trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import { combineSvgs } from "./plot";
import { parseMatrix, identity, type Matrix } from "./linalg";
import { chiSquareDist } from "./probdist";
import {
  constantVelocityModel,
  randomWalkModel,
  steadyState,
  riccatiHistory,
  runFilter,
  validateModel,
  MAX_STATES,
  MAX_MEAS,
  MAX_SAMPLES,
  type KalmanModel,
} from "./kalman";
import {
  SEQUENCES,
  TAIT_BRYAN,
  isProper,
  quatNormalize,
  canonical,
  quatMul,
  eulerToQuat,
  quatToMatrix,
  matrixToQuat,
  quatToEuler,
  axisAngleToQuat,
  quatToAxisAngle,
  slerp,
  angleBetween,
  type Quat,
  type Frame,
} from "./attitude";
import { kalmanConvergenceSvg, kalmanRunSvg, kalmanInnovationSvg, attitudeTriadSvg } from "./kalmanCharts";

// Written as `const GROUP = "…"` exactly: engineeringSpreadContract.test.ts resolves a group constant by that form.
const AVIONICS_GROUP = "Aviation & avionics" as const;
const ROBOTICS_GROUP = "Robotics & kinematics" as const;
type Group = typeof AVIONICS_GROUP | typeof ROBOTICS_GROUP;

// ------------------------------------------------------------------ helpers

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")).replace(/[“”]/g, '"'), ok: false });

/** Significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁶, U+2212; −0 is 0. */
function num(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return "not finite";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return (v < 0 ? MINUS : "") + String(Number(a.toPrecision(sig)));
  return fmtSig(v, sig).replace(/(\.\d*?)0+×/, "$1×").replace(/\.×/, "×");
}

/** An angle in degrees: 6 significant figures, a float-noise zero shown as 0. */
function deg(v: number): string {
  return Math.abs(v) < 1e-9 ? "0°" : `${num(v, 6)}°`;
}

/** A quaternion / matrix component: 6 significant figures, float noise below 10⁻¹² shown as 0. */
function comp(v: number): string {
  return Math.abs(v) < 1e-12 ? "0" : num(v, 6);
}

const finish = (lines: Parameters<typeof engReport>[0], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput => {
  const out = engReport(
    lines.map((l) => (typeof l === "string" ? trueMinus(l) : "math" in l ? { math: l.math, fallback: trueMinus(l.fallback) } : l)),
    extra,
  );
  return { ...out, outputs };
};

const plot = (svg: string, w: number, h: number, caption: string, alt: string): AnalyzeBlock => ({ kind: "plot", svg, caption, alt, w, h });

/** A plain number with no unit (the Kalman tools work in the user's own consistent units). */
function pureNumber(raw: string | undefined, label: string, errors: string[]): number {
  const t = (raw ?? "").trim().replace(/[−–]/g, "-");
  if (!t) {
    errors.push(`${label}: this field is required.`);
    return NaN;
  }
  const v = Number(t);
  if (!Number.isFinite(v) || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) {
    errors.push(
      /^[-+]?(\d+\.?\d*|\.\d+)\s*\S/.test(t)
        ? `${label}: "${raw?.trim()}" has a unit; this tool works in your own consistent units, so type the plain number.`
        : `${label}: "${raw?.trim()}" is not a number.`,
    );
    return NaN;
  }
  return v;
}

/** A matrix field through linalg.parseMatrix (the Analyze tools' reader): rows on lines or `;`, entries by space/comma. */
function matrixField(raw: string | undefined, name: string, errors: string[]): Matrix | null {
  const t = (raw ?? "").replace(/[−–]/g, "-");
  if (!t.trim()) {
    errors.push(`${name}: enter the matrix, one row per line.`);
    return null;
  }
  const p = parseMatrix(t);
  if (!p.ok) {
    errors.push(`${name}: ${p.error}`);
    return null;
  }
  return p.matrix;
}

/** A short list of numbers (a vector), read by RULE N (dataBlock.readDataBlock) as one row or one column. */
function vectorField(raw: string, what: string, need: number): number[] | string {
  const b = readDataBlock(raw, what, { maxRows: 16 });
  if (!b.ok) return b.error;
  const flat = b.rows.length === 1 ? b.rows[0] : b.rows.every((r) => r.length === 1) ? b.rows.map((r) => r[0]) : null;
  if (!flat) return `${what}: give ${need} numbers on one line (or one per line).`;
  if (flat.length !== need || flat.some((v) => v === null)) return `${what}: needs exactly ${need} number${need === 1 ? "" : "s"}; ${flat.filter((v) => v !== null).length} given.`;
  return flat as number[];
}

const sub = (i: number): string => String(i).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]);

/** A matrix as a table block: an index column and one column per matrix column. */
function matrixTable(label: string, m: Matrix, rowNames: string[], colNames: string[]): AnalyzeBlock {
  return { kind: "table", label, rows: [["", ...colNames], ...m.map((r, i) => [rowNames[i], ...r.map((v) => num(v, 6))])] };
}

// ------------------------------------------------------------------ Kalman: the model

const MODEL_OPTIONS = [
  { value: "cv", label: "Constant-velocity tracker (position measured)" },
  { value: "rw", label: "Scalar random walk" },
  { value: "matrix", label: "Matrices F, H, Q, R (typed below)" },
];

interface ModelRead {
  model: KalmanModel;
  states: string[];
  measured: string[];
  desc: string;
  extraLines: string[];
}

function readModel(r: (k: string) => string, errors: string[]): ModelRead | null {
  const kind = r("model") || "cv";
  if (kind === "cv" || kind === "rw") {
    const q = pureNumber(r("q"), kind === "cv" ? "q (white-acceleration PSD)" : "q (process variance per step)", errors);
    const rr = pureNumber(r("r"), "r (measurement variance)", errors);
    const dt = kind === "cv" ? pureNumber(r("dt"), "Δt", errors) : NaN;
    if (errors.length) return null;
    if (kind === "cv" && !(dt > 0)) errors.push("Δt: must be positive.");
    if (!(q >= 0)) errors.push("q: a noise intensity cannot be negative.");
    if (!(rr > 0)) errors.push("r: the measurement variance must be positive (an exact measurement has no Kalman gain to compute).");
    if (errors.length) return null;
    if (kind === "rw")
      return {
        model: randomWalkModel(q, rr),
        states: ["x"],
        measured: ["x"],
        desc: `scalar random walk (Q = ${num(q, 6)}, R = ${num(rr, 6)})`,
        extraLines: ["Model: xₖ₊₁ = xₖ + wₖ, zₖ = xₖ + vₖ; F = H = 1."],
      };
    return {
      model: constantVelocityModel(dt, q, rr),
      states: ["position", "velocity"],
      measured: ["position"],
      desc: `constant-velocity tracker (Δt = ${num(dt, 6)}, q = ${num(q, 6)}, r = ${num(rr, 6)})`,
      extraLines: [
        "Model: state [position, velocity], F = [[1, Δt], [0, 1]], H = [1, 0]; white-acceleration noise of PSD q gives Q = q·[[Δt³/3, Δt²/2], [Δt²/2, Δt]] (Bar-Shalom, Li & Kirubarajan 2001, §6.2.2).",
      ],
    };
  }
  if (kind !== "matrix") {
    errors.push(`Unknown model "${kind}".`);
    return null;
  }
  const F = matrixField(r("F"), "F", errors);
  const Hm = matrixField(r("H"), "H", errors);
  const Q = matrixField(r("Q"), "Q", errors);
  const R = matrixField(r("R"), "R", errors);
  if (!F || !Hm || !Q || !R) return null;
  const model = { F, H: Hm, Q, R };
  const bad = validateModel(model);
  if (bad) {
    errors.push(bad);
    return null;
  }
  const n = F.length, m = Hm.length;
  return {
    model,
    states: Array.from({ length: n }, (_, i) => `x${sub(i + 1)}`),
    measured: Array.from({ length: m }, (_, i) => `z${sub(i + 1)}`),
    desc: `${n}-state model with ${m} measurement${m === 1 ? "" : "s"} (F, H, Q, R as typed)`,
    extraLines: [],
  };
}

const MODEL_FIELDS = [
  { key: "model", label: "Model", default: "cv", kind: "select" as const, options: MODEL_OPTIONS },
  { key: "dt", label: "Δt, time step (constant-velocity tracker)", default: "0.1", kind: "text" as const },
  { key: "q", label: "q: process noise (tracker: white-acceleration PSD; random walk: variance per step Q)", default: "1", kind: "text" as const },
  { key: "r", label: "r: measurement noise variance R (both presets)", default: "0.25", kind: "text" as const },
  { key: "F", label: "F, state transition (Matrices model; one row per line)", default: "1 0.1\n0 1", kind: "block" as const, rows: 3 },
  { key: "H", label: "H, measurement matrix (Matrices model)", default: "1 0", kind: "block" as const, rows: 2 },
  { key: "Q", label: "Q, process noise covariance (Matrices model)", default: "0.000333333 0.005\n0.005 0.1", kind: "block" as const, rows: 3 },
  { key: "R", label: "R, measurement noise covariance (Matrices model)", default: "0.25", kind: "block" as const, rows: 2 },
];

const KALMAN_ASSUMPTIONS =
  "Assumes a linear time-invariant model with zero-mean white process and measurement noise, uncorrelated with each other; every covariance is in your own consistent units.";

const DARE_MATH = [
  { math: "P_pri = F P_pri F^T - F P_pri H^T (H P_pri H^T + R)^(-1) H P_pri F^T + Q", fallback: "P⁻ = FP⁻Fᵀ − FP⁻Hᵀ(HP⁻Hᵀ + R)⁻¹HP⁻Fᵀ + Q (steady a-priori covariance: the discrete algebraic Riccati equation)" },
  { math: "K = P_pri H^T (H P_pri H^T + R)^(-1)", fallback: "K = P⁻Hᵀ(HP⁻Hᵀ + R)⁻¹" },
  { math: "P_post = (I - K H) P_pri", fallback: "P⁺ = (I − KH)P⁻ (steady a-posteriori covariance)" },
  "In the equations the subscript pri marks the predicted (a-priori) values, written P⁻ and x̂⁻ in the tables, and post the updated (a-posteriori) ones, written P⁺ and x̂⁺.",
];

// ------------------------------------------------------------------ 1. steady state

function computeSteady(r: (k: string) => string): AnalyzeOutput {
  const errors: string[] = [];
  const mr = readModel(r, errors);
  const p0 = pureNumber(r("p0"), "P₀ scale p₀", errors);
  if (errors.length || !mr) return refuse(errors.join("\n"));
  if (!(p0 > 0)) return refuse("P₀ scale p₀: must be positive (P₀ = p₀·I is the starting covariance of the recursion drawn).");
  const ss = steadyState(mr.model);
  if (!ss.ok) return refuse(ss.error);
  const n = mr.states.length;
  const sPrior = ss.prior.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const sPost = ss.posterior.map((row, i) => Math.sqrt(Math.max(0, row[i])));

  // The recursion from P₀ = p₀·I, cut where every σ is within 0.1% of steady (at least 10 steps, at most 200).
  const P0 = identity(n).map((row) => row.map((v) => v * p0));
  const hist = riccatiHistory(mr.model, P0, 200);
  if (!hist) return refuse("The covariance recursion from P₀ stopped being finite; try a smaller p₀.");
  const sig = hist.map((P) => P.map((row, i) => Math.sqrt(Math.max(0, row[i]))));
  let kConv = sig.findIndex((row) => row.every((s, i) => Math.abs(s / sPrior[i] - 1) < 1e-3));
  const converged = kConv >= 0;
  if (!converged) kConv = 200;
  const N = Math.min(200, Math.max(10, Math.ceil(kConv * 1.25) + 2));
  const shown = sig.slice(0, N + 1);

  const lines: Parameters<typeof engReport>[0] = [];
  lines.push(`Steady-state Kalman filter, ${mr.desc}.`);
  lines.push(...mr.extraLines);
  lines.push(...DARE_MATH);
  const sigmaText = mr.states.map((s, i) => `${s} ${num(sPrior[i], 5)} before the update, ${num(sPost[i], 5)} after`).join("; ");
  lines.push(`Steady 1σ errors: ${sigmaText}.`);
  if (mr.measured.length === 1 && n <= 2) lines.push(`Kalman gain K = [${ss.K.map((row) => num(row[0], 6)).join(", ")}]${n === 1 ? "" : "ᵀ"}.`);
  lines.push(
    `Solved by the doubling algorithm in ${ss.iterations} step${ss.iterations === 1 ? "" : "s"}; the stabilising solution (spectral radius of F(I − KH) = ${num(ss.rho, 5)}, so an initial error shrinks by that factor per step).`,
  );
  lines.push(
    converged
      ? `From P₀ = ${num(p0)}·I the recursion reaches every steady σ to within 0.1% after ${kConv} step${kConv === 1 ? "" : "s"}.`
      : "From P₀ the recursion has not reached every steady σ to within 0.1% after 200 steps (the figure shows the first 200).",
  );
  lines.push(KALMAN_ASSUMPTIONS);

  const tables: AnalyzeBlock[] = [
    {
      kind: "table",
      label: "Steady 1σ errors",
      rows: [["State", "σ before update (prior)", "σ after update (posterior)"], ...mr.states.map((s, i) => [s, num(sPrior[i], 6), num(sPost[i], 6)])],
    },
    matrixTable("Steady a-priori covariance P⁻", ss.prior, mr.states, mr.states),
    matrixTable("Kalman gain K", ss.K, mr.states, mr.measured),
    matrixTable("Steady a-posteriori covariance P⁺", ss.posterior, mr.states, mr.states),
  ];
  const fig = kalmanConvergenceSvg(shown, sPrior, mr.states);
  const outputs: EngOutput[] = [];
  mr.states.forEach((s, i) => {
    outputs.push({ key: `sigmaPrior${i + 1}`, label: `Steady prior σ of ${s}`, value: sPrior[i], unit: "" });
    outputs.push({ key: `sigmaPost${i + 1}`, label: `Steady posterior σ of ${s}`, value: sPost[i], unit: "" });
  });
  ss.K.forEach((row, i) => row.forEach((v, j) => outputs.push({ key: `K${i + 1}${j + 1}`, label: `Kalman gain K${sub(i + 1)}${sub(j + 1)}`, value: v, unit: "" })));
  ss.prior.forEach((row, i) =>
    row.forEach((v, j) => {
      if (j >= i) outputs.push({ key: `Pprior${i + 1}${j + 1}`, label: `Steady prior P${sub(i + 1)}${sub(j + 1)}`, value: v, unit: "" });
    }),
  );
  return finish(
    lines,
    [
      ...tables,
      plot(
        fig.svg,
        fig.width,
        fig.height,
        `Prior 1σ of each state over the Riccati recursion from P₀ = ${num(p0)}·I, converging to its steady value (${mr.desc}).`,
        "Line chart: the prior standard deviation of each state against step number, settling onto its steady-state value.",
      ),
    ],
    outputs,
  );
}

// ------------------------------------------------------------------ 2. run on data

/** 95% range of the mean of `count` NIS values for an m-dimensional measurement: χ²(count·m) quantiles / count. */
function nisRange(count: number, m: number): [number, number] {
  const d = chiSquareDist({ value: count * m });
  return [d.quantile(0.025) / count, d.quantile(0.975) / count];
}

function readSeries(raw: string, m: number): { rows: (number | null)[][]; notes: string[] } | string {
  const b = readDataBlock(raw, "Measurements", { maxRows: MAX_SAMPLES, singleColumn: m === 1 });
  if (!b.ok) return b.error;
  if (m === 1 && b.rows.length === 1 && b.rows[0].length > 1) {
    if (b.rows[0].length > MAX_SAMPLES) return `Measurements: ${b.rows[0].length} values; this tool takes at most ${MAX_SAMPLES}.`;
    return { rows: b.rows[0].map((v) => [v]), notes: b.notes };
  }
  for (let i = 0; i < b.rows.length; i++) {
    if (b.rows[i].length !== m)
      return `Measurements: line ${b.lines[i]} has ${b.rows[i].length} value${b.rows[i].length === 1 ? "" : "s"}, but the model measures ${m} quantit${m === 1 ? "y" : "ies"} (the rows of H). Paste one column per measured quantity, without a time column.`;
  }
  return { rows: b.rows, notes: b.notes };
}

function computeRun(r: (k: string) => string): AnalyzeOutput {
  const errors: string[] = [];
  const mr = readModel(r, errors);
  const p0 = pureNumber(r("p0"), "P₀ scale p₀", errors);
  if (errors.length || !mr) return refuse(errors.join("\n"));
  if (!(p0 > 0)) return refuse("P₀ scale p₀: must be positive (P₀ = p₀·I).");
  const n = mr.states.length, m = mr.measured.length;
  const x0raw = (r("x0") ?? "").trim();
  let x0: number[] = new Array(n).fill(0);
  if (x0raw) {
    const v = vectorField(x0raw, "Initial estimate x₀", n);
    if (typeof v === "string") return refuse(v);
    x0 = v;
  }
  const series = readSeries(r("data") ?? "", m);
  if (typeof series === "string") return refuse(series);
  const P0 = identity(n).map((row) => row.map((v) => v * p0));
  const run = runFilter(mr.model, x0, P0, series.rows);
  if (!run.ok) return refuse(run.error);
  const N = run.steps.length;
  const last = run.steps[N - 1];
  const [lo, hi] = nisRange(run.updates, m);
  const verdict =
    run.meanNis > hi
      ? "ABOVE the range: the innovations are larger than the model expects, so the filter is overconfident (Q or R too small, or the model is wrong)."
      : run.meanNis < lo
        ? "BELOW the range: the innovations are smaller than the model expects, so the filter is underconfident (Q or R too large)."
        : "inside the range: the innovations are consistent with the stated Q and R.";
  const missing = N - run.updates;

  const lines: Parameters<typeof engReport>[0] = [];
  lines.push(`Kalman filter run over ${N} sample${N === 1 ? "" : "s"}, ${mr.desc}.`);
  lines.push(...mr.extraLines);
  lines.push(
    { math: "hat(x)_post = hat(x)_pri + K (z - H hat(x)_pri)", fallback: "x̂⁺ = x̂⁻ + K(z − Hx̂⁻)" },
    { math: "K = P_pri H^T (H P_pri H^T + R)^(-1)", fallback: "K = P⁻Hᵀ(HP⁻Hᵀ + R)⁻¹" },
    { math: "hat(x)_pri = F hat(x)_post", fallback: "x̂⁻ = Fx̂⁺ (predict to the next step)" },
    { math: "P_pri = F P_post F^T + Q", fallback: "P⁻ = FP⁺Fᵀ + Q (predict to the next step)" },
    "In the equations the subscript pri marks the predicted (a-priori) values, written P⁻ and x̂⁻ in the tables, and post the updated (a-posteriori) ones, written P⁺ and x̂⁺.",
  );
  lines.push(`Start: x₀ = (${x0.map((v) => num(v, 6)).join(", ")}) and P₀ = ${num(p0)}·I, taken as the prior at the first measurement.`);
  lines.push(`Final estimate: ${mr.states.map((s, i) => `${s} ${num(last.x[i], 6)} ± ${num(Math.sqrt(Math.max(0, last.pDiag[i])), 4)} (1σ)`).join("; ")}.`);
  lines.push(
    `NIS consistency: the mean normalised innovation squared is ${num(run.meanNis, 4)} over ${run.updates} update${run.updates === 1 ? "" : "s"}; a consistent filter gives about ${m} (the measurement dimension), and the 95% range for this mean is ${num(lo, 3)}–${num(hi, 3)} (χ² with ${run.updates * m} degrees of freedom, divided by ${run.updates}). The mean is ${verdict}`,
  );
  if (missing) lines.push(`${missing} row${missing === 1 ? " has" : "s have"} a missing value: predict only (no update) at ${missing === 1 ? "that step" : "those steps"}.`);
  lines.push(...series.notes);
  lines.push(KALMAN_ASSUMPTIONS);

  const blocks: AnalyzeBlock[] = [];
  blocks.push({
    kind: "table",
    label: "Final estimate",
    rows: [["State", "Estimate", "1σ"], ...mr.states.map((s, i) => [s, num(last.x[i], 6), num(Math.sqrt(Math.max(0, last.pDiag[i])), 6)])],
  });
  // The step table, when it stays readable: at most 200 rows and 8 columns (σ columns dropped first).
  let cols = 1 + m + 2 * n;
  const withSigma = cols <= 8;
  if (!withSigma) cols = 1 + m + n;
  if (N <= 200 && cols <= 8) {
    const header = ["Step", ...mr.measured.map((z) => `Measured ${z}`), ...mr.states.map((s) => `Estimate ${s}`), ...(withSigma ? mr.states.map((s) => `1σ ${s}`) : [])];
    const rows = run.steps.map((st, k) => [
      String(k + 1),
      ...series.rows[k].map((v) => (v === null ? "missing" : num(v, 6))),
      ...st.x.map((v) => num(v, 6)),
      ...(withSigma ? st.pDiag.map((v) => num(Math.sqrt(Math.max(0, v)), 4)) : []),
    ]);
    blocks.push({ kind: "table", label: "Filtered estimate at each step (after the update)", rows: [header, ...rows] });
  } else {
    lines.push(N > 200 ? "The step-by-step table is left out above 200 samples; the figure shows every step." : "The step-by-step table is left out for this many states and measurements; the figure shows every step.");
  }
  const runPanels = mr.measured.map((z, j) =>
    kalmanRunSvg(
      run.steps.map((st, k) => ({ k: k + 1, z: series.rows[k][j], est: st.hx[j], sd: Math.sqrt(Math.max(0, st.hVar[j])) })),
      z === "position" ? "Position" : z,
    ),
  );
  const innovPanels = mr.measured.map((z, j) =>
    kalmanInnovationSvg(
      run.steps.flatMap((st, k) => (st.nu && st.sDiag ? [{ k: k + 1, nu: st.nu[j], sd: Math.sqrt(Math.max(0, st.sDiag[j])) }] : [])),
      z,
    ),
  );
  // One figure per measured quantity (stacked panels would repeat one tick column, and each channel has its own unit).
  const ch = (j: number): string => (m === 1 ? "" : ` (${mr.measured[j]})`);
  runPanels.forEach((svg, j) => {
    const f = sized(svg);
    blocks.push(plot(f.svg, f.width, f.height, `Measurements, the filtered estimate and its ±2σ band${ch(j)}, ${mr.desc}.`, "Measured points with the filtered estimate as a line and a ±2σ band around it, against step number."));
  });
  innovPanels.forEach((svg, j) => {
    const f = sized(svg);
    blocks.push(plot(f.svg, f.width, f.height, `Innovation sequence z − Hx̂⁻ at each update${ch(j)}, with ±2√S, the band about 95% of innovations fall inside when the filter is consistent.`, "Innovation points against step number between two ±2√S lines."));
  });
  const outputs: EngOutput[] = [];
  mr.states.forEach((s, i) => {
    outputs.push({ key: `final${i + 1}`, label: `Final estimate of ${s}`, value: last.x[i], unit: "" });
    outputs.push({ key: `finalSigma${i + 1}`, label: `Final 1σ of ${s}`, value: Math.sqrt(Math.max(0, last.pDiag[i])), unit: "" });
  });
  outputs.push({ key: "meanNis", label: "Mean NIS", value: run.meanNis, unit: "" });
  outputs.push({ key: "nisLow", label: "Mean NIS 95% range, low", value: lo, unit: "" });
  outputs.push({ key: "nisHigh", label: "Mean NIS 95% range, high", value: hi, unit: "" });
  outputs.push({ key: "updates", label: "Updates", value: run.updates, unit: "" });
  return finish(lines, blocks, outputs);
}

/** A single panel with its declared size (the plotter's composer passes one panel through and reads its size). */
const sized = (svg: string): { svg: string; width: number; height: number } => combineSvgs([svg]);

/**
 * 40 positions of a target simulated from the default model itself (constant velocity, Δt = 0.1, q = 1, r = 0.25,
 * start [1, 2]; numpy default_rng(9), rounded to 0.01), so the default run is a consistent filter (mean NIS ≈ 1.05).
 * The oracle is in kalmanCases.test.ts.
 */
const DEFAULT_SERIES =
  "0.60, 1.53, 1.62, 1.18, 1.76, 2.14, 1.99, 2.62, 2.75, 2.63, 3.66, 3.37, 3.88, 3.91, 4.22, 4.42, 4.13, 5.24, 4.68, 4.75, 5.56, 6.74, 5.24, 6.12, 5.14, 6.15, 6.09, 5.71, 6.19, 6.44, 6.68, 7.44, 6.68, 8.70, 7.82, 9.17, 8.32, 9.92, 10.13, 8.75";

// ------------------------------------------------------------------ 3. attitude

const SEQ_OPTIONS = SEQUENCES.map((s) => ({ value: s, label: `${s} ${(TAIT_BRYAN as readonly string[]).includes(s) ? "(Tait–Bryan)" : "(proper Euler)"}${s === "ZYX" ? ": yaw, pitch, roll" : ""}` }));
const FORM_OPTIONS = [
  { value: "euler", label: "Euler angles" },
  { value: "quat", label: "Quaternion" },
  { value: "matrix", label: "Rotation matrix" },
  { value: "axis", label: "Axis and angle" },
];

interface RotRead {
  q: Quat;
  text: string;
}

/** Reads rotation A or B in the form its selector names. */
function readRotation(
  r: (k: string) => string,
  which: "A" | "B",
  frame: Frame,
  errors: string[],
  notes: string[],
  conversions: string[],
): RotRead | null {
  // An angle through the unit layer, in degrees ("30", "30°", "0.5 rad", "1800 arcmin"); written here, not in a helper,
  // so the unit-contract gate (two call levels from compute) sees the parseMeasured call.
  const angleField = (raw: string | undefined, label: string): number => {
    const t = (raw ?? "").trim().replace(/[−–]/g, "-");
    if (!t) {
      errors.push(`${label}: this field is required.`);
      return NaN;
    }
    const m = parseMeasured(t, "°");
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (m.assumed || m.unit === "°") return m.value;
    conversions.push(`${label}: ${num(m.value, 6)} ${m.unit} = ${num(m.inTarget, 6)}°`);
    return m.inTarget;
  };
  const form = which === "A" ? r("formA") || "euler" : r("formB") || "euler";
  const order = r("order") || "last";
  if (form === "euler") {
    const seq = which === "A" ? r("seqA") || "ZYX" : r("seqB") || "ZXZ";
    if (!SEQUENCES.includes(seq)) {
      errors.push(`Rotation ${which}: unknown sequence "${seq}".`);
      return null;
    }
    const ang =
      which === "A"
        ? [angleField(r("a1"), "A, first angle"), angleField(r("a2"), "A, second angle"), angleField(r("a3"), "A, third angle")]
        : [angleField(r("b1"), "B, first angle"), angleField(r("b2"), "B, second angle"), angleField(r("b3"), "B, third angle")];
    if (ang.some((v) => !Number.isFinite(v))) return null;
    const q = canonical(eulerToQuat(seq, ang.map((v) => (v * Math.PI) / 180) as [number, number, number], frame));
    const s = frame === "intrinsic" ? seq : seq.toLowerCase();
    return { q, text: `${frame} ${s} (${ang.map(deg).join(", ")})` };
  }
  if (form === "quat") {
    const raw = which === "A" ? r("quatA") : r("quatB");
    const v = vectorField(raw ?? "", `Quaternion ${which}`, 4);
    if (typeof v === "string") {
      errors.push(v);
      return null;
    }
    const xyzw = order === "first" ? [v[1], v[2], v[3], v[0]] : v;
    const nq = quatNormalize(xyzw);
    if (!nq.ok) {
      errors.push(`Quaternion ${which}: ${nq.error}`);
      return null;
    }
    if (Math.abs(nq.norm - 1) > 1e-6) notes.push(`Quaternion ${which} as typed has norm ${num(nq.norm, 8)}, not 1; it was normalised (divided by its norm) before use.`);
    return { q: canonical(nq.q), text: `the quaternion ${order === "first" ? "(w, x, y, z)" : "(x, y, z, w)"} = (${v.map(comp).join(", ")})` };
  }
  if (form === "matrix" && which === "A") {
    const t = (r("dcmA") ?? "").replace(/[−–]/g, "-");
    const p = parseMatrix(t);
    if (!p.ok) {
      errors.push(`Rotation matrix: ${p.error}`);
      return null;
    }
    const mq = matrixToQuat(p.matrix);
    if (!mq.ok) {
      errors.push(mq.error);
      return null;
    }
    return { q: mq.q, text: "the rotation matrix as typed" };
  }
  if (form === "axis" && which === "A") {
    const axis = vectorField(r("axisA") ?? "", "Rotation axis", 3);
    if (typeof axis === "string") {
      errors.push(axis);
      return null;
    }
    const th = angleField(r("angleA"), "Rotation angle");
    if (!Number.isFinite(th)) return null;
    const aq = axisAngleToQuat(axis, (th * Math.PI) / 180);
    if (!aq.ok) {
      errors.push(aq.error);
      return null;
    }
    if (Math.abs(aq.axisNorm - 1) > 1e-6) notes.push(`The axis as typed has length ${num(aq.axisNorm, 8)}; it was normalised to a unit vector.`);
    return { q: canonical(aq.q), text: `${deg(th)} about the axis (${axis.map(comp).join(", ")})` };
  }
  errors.push(`Rotation ${which}: unknown form "${form}"${which === "B" ? " (rotation B is given as Euler angles or a quaternion)" : ""}.`);
  return null;
}

function computeAttitude(r: (k: string) => string): AnalyzeOutput {
  const op = r("op") || "convert";
  const frame = (r("frame") || "intrinsic") as Frame;
  if (frame !== "intrinsic" && frame !== "extrinsic") return refuse(`Unknown frame "${frame}".`);
  const seq = r("seqA") || "ZYX";
  if (!SEQUENCES.includes(seq)) return refuse(`Unknown Euler sequence "${seq}".`);
  if (op !== "convert" && op !== "compose" && op !== "slerp") return refuse(`Unknown operation "${op}".`);
  const errors: string[] = [];
  const notes: string[] = [];
  const conversions: string[] = [];
  const A = readRotation(r, "A", frame, errors, notes, conversions);
  const B = op === "convert" ? null : readRotation(r, "B", frame, errors, notes, conversions);
  let t = NaN;
  if (op === "slerp") {
    const tr = (r("t") ?? "").trim();
    t = tr === "" ? NaN : Number(tr);
    if (!Number.isFinite(t) || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tr)) errors.push(`Fraction t: "${tr}" is not a plain number between 0 and 1.`);
    else if (t < 0 || t > 1) errors.push("Fraction t: must be between 0 (rotation A) and 1 (rotation B); slerp does not extrapolate.");
  }
  if (errors.length || !A || (op !== "convert" && !B)) return refuse(errors.join("\n"));

  let q: Quat;
  const lines: Parameters<typeof engReport>[0] = [];
  if (op === "convert") {
    q = A.q;
    lines.push(`Attitude of rotation A, given as ${A.text}.`);
  } else if (op === "compose") {
    q = canonical(quatMul(A.q, (B as RotRead).q));
    lines.push(`Composition C = A ⊗ B of A, given as ${A.text}, and B, given as ${(B as RotRead).text}.`);
    lines.push({ math: "q_C = q_A ⊗ q_B", fallback: "q_C = q_A ⊗ q_B (Hamilton product)" });
    lines.push("Meaning: B is applied in A's body frame (intrinsic), equivalently B first and then A in the reference frame; R_C = R_A·R_B.");
    lines.push(`q_A = (${A.q.map(comp).join(", ")}), q_B = (${(B as RotRead).q.map(comp).join(", ")}), as (x, y, z, w).`);
  } else {
    q = canonical(slerp(A.q, (B as RotRead).q, t));
    const omega = angleBetween(A.q, (B as RotRead).q);
    lines.push(`Slerp at t = ${num(t, 6)} from A, given as ${A.text}, to B, given as ${(B as RotRead).text}.`);
    lines.push({ math: "q(t) = (sin((1 - t) Ω) q_A + sin(t Ω) q_B)/sin Ω", fallback: "q(t) = [sin((1 − t)Ω)·q_A + sin(tΩ)·q_B]/sin Ω" });
    lines.push(`A and B are ${deg((omega * 180) / Math.PI)} apart (Ω = ${deg((omega * 90) / Math.PI)}, half the rotation angle); the path is the shorter arc (q_B is negated first when q_A·q_B < 0, since q and −q are the same rotation), at constant angular rate.`);
  }

  const R = quatToMatrix(q);
  const e = quatToEuler(q, seq, frame);
  const other: Frame = frame === "intrinsic" ? "extrinsic" : "intrinsic";
  const otherSeq = seq.split("").reverse().join("");
  const e2 = quatToEuler(q, otherSeq, other);
  const name = (s: string, f: Frame): string => `${f} ${f === "intrinsic" ? s : s.toLowerCase()}`;
  const ed = e.angles.map((v) => (v * 180) / Math.PI);
  const ed2 = e2.angles.map((v) => (v * 180) / Math.PI);
  const aa = quatToAxisAngle(q);
  const ypr = seq === "ZYX" && frame === "intrinsic" ? " = (yaw ψ, pitch θ, roll φ)" : "";

  lines.push(`Quaternion (x, y, z, w) = (${q.map(comp).join(", ")}).`);
  if (r("order") === "first") lines.push(`The same in scalar-first order, (w, x, y, z) = (${[q[3], q[0], q[1], q[2]].map(comp).join(", ")}).`);
  lines.push(`Euler angles, ${name(seq, frame)}${ypr}: (${ed.map(deg).join(", ")}).`);
  lines.push(`The same rotation as ${name(otherSeq, other)} (the reversed sequence about the other frame): (${ed2.map(deg).join(", ")}).`);
  const seqMath = frame === "intrinsic" ? seq.split("").map((a, i) => `R_${a}(α_${i + 1})`).join(" ") : otherSeq.split("").map((a, i) => `R_${a}(α_${3 - i})`).join(" ");
  const seqFallback = frame === "intrinsic" ? seq.split("").map((a, i) => `R_${a}(α${sub(i + 1)})`).join("·") : otherSeq.split("").map((a, i) => `R_${a}(α${sub(3 - i)})`).join("·");
  lines.push({ math: `R = ${seqMath}`, fallback: `R = ${seqFallback}, with α₁, α₂, α₃ the angles in the order written` });
  if (e.gimbalLock) {
    const proper = isProper(seq);
    lines.push(
      `GIMBAL LOCK: the middle angle is ${deg(ed[1])}${proper ? " (0° or 180° for a proper Euler sequence)" : " (±90° for a Tait–Bryan sequence)"}, where the first and third angles are no longer separable — only their ${e.determined === "sum" ? "sum" : "difference"} is determined, and any split between them is arbitrary. Convention used: the third angle is set to 0° and the first carries the whole ${e.determined === "sum" ? "sum" : "difference"} (as scipy's Rotation.as_euler does). The quaternion and the rotation matrix are exact and unambiguous.`,
    );
  }
  if (e2.gimbalLock && !e.gimbalLock) lines.push("The reversed-sequence angles are at gimbal lock: their third angle is set to 0°.");
  lines.push(aa.axis ? `Axis–angle: ${deg((aa.angle * 180) / Math.PI)} about (${aa.axis.map(comp).join(", ")}).` : "Axis–angle: the identity (0°); no axis is defined.");
  lines.push({ math: "q_w = cos(θ/2)", fallback: "q_w = cos(θ/2), the scalar part" }, { math: "q_v = u sin(θ/2)", fallback: "q_v = u·sin(θ/2), the vector part (x, y, z), for a rotation θ about the unit axis u" });
  lines.push(...notes, ...conversions.map((c) => `Converted: ${c}.`));
  lines.push(
    "Conventions: quaternions scalar-last (x, y, z, w) with the Hamilton product, shown with w ≥ 0 (q and −q are the same rotation); active, right-handed rotations, v_ref = R·v_body, so the columns of R are the body axes in reference coordinates (the passive direction-cosine matrix, reference to body, is Rᵀ). Intrinsic angles turn about the moving axes, extrinsic about the fixed ones.",
  );

  const triad = attitudeTriadSvg(R);
  const rotRows = R.map((row, i) => [`row ${i + 1}`, ...row.map(comp)]);
  const blocks: AnalyzeBlock[] = [
    { kind: "table", label: "Rotation matrix R (active; columns are the body axes)", rows: [["", "column 1", "column 2", "column 3"], ...rotRows] },
    {
      kind: "table",
      label: "Euler angles",
      rows: [
        ["Sequence", "First (°)", "Second (°)", "Third (°)"],
        [name(seq, frame), ...ed.map((v) => deg(v).replace("°", ""))],
        [name(otherSeq, other), ...ed2.map((v) => deg(v).replace("°", ""))],
      ],
    },
    plot(
      triad.svg,
      triad.width,
      triad.height,
      `Body axes of the ${op === "convert" ? "rotation" : op === "compose" ? "composed rotation C" : `slerp orientation at t = ${num(t, 4)}`} (colour) against the reference axes X, Y, Z (grey), oblique projection.`,
      "Three coloured body-axis arrows from a common origin, drawn over three grey reference-axis arrows.",
    ),
  ];
  const outputs: EngOutput[] = [
    { key: "qx", label: "Quaternion x", value: q[0], unit: "" },
    { key: "qy", label: "Quaternion y", value: q[1], unit: "" },
    { key: "qz", label: "Quaternion z", value: q[2], unit: "" },
    { key: "qw", label: "Quaternion w", value: q[3], unit: "" },
    { key: "e1", label: `First angle (${seq})`, value: ed[0], unit: "°" },
    { key: "e2", label: `Second angle (${seq})`, value: ed[1], unit: "°" },
    { key: "e3", label: `Third angle (${seq})`, value: ed[2], unit: "°" },
    { key: "angle", label: "Rotation angle", value: (aa.angle * 180) / Math.PI, unit: "°" },
  ];
  R.forEach((row, i) => row.forEach((v, j) => outputs.push({ key: `R${i + 1}${j + 1}`, label: `R${sub(i + 1)}${sub(j + 1)}`, value: v, unit: "" })));
  return finish(lines, blocks, outputs);
}

// ------------------------------------------------------------------ registry

export const KALMAN_CALCS: EngCalcDef<Group>[] = [
  {
    id: "kalman-steady",
    name: "Kalman filter: steady state",
    group: AVIONICS_GROUP,
    hint: `Steady-state Kalman filter of a linear model (constant-velocity tracker, random walk, or matrices F, H, Q, R up to ${MAX_STATES} states and ${MAX_MEAS} measurements): the Riccati covariance, gain and 1σ errors, with the covariance converging from P₀.`,
    unitContract: "same-units",
    fields: [...MODEL_FIELDS, { key: "p0", label: "P₀ scale p₀ (the recursion drawn starts at P₀ = p₀·I)", default: "10", kind: "text" }],
    compute: (r) => computeSteady(r),
  },
  {
    id: "kalman-run",
    name: "Kalman filter: run on data",
    group: AVIONICS_GROUP,
    hint: `Runs a Kalman filter over a pasted measurement series (up to ${MAX_SAMPLES} samples): the estimate with its ±2σ band, the innovations, and an NIS consistency check of the stated noise levels.`,
    unitContract: "same-units",
    fields: [
      ...MODEL_FIELDS,
      { key: "data", label: "Measurements (one row per step, one column per measured quantity; a missing value skips that update)", default: DEFAULT_SERIES, kind: "block", rows: 6 },
      { key: "x0", label: "Initial estimate x₀ (one number per state; blank = all zeros)", default: "", kind: "text" },
      { key: "p0", label: "Initial covariance scale p₀ (P₀ = p₀·I)", default: "10", kind: "text" },
    ],
    compute: (r) => computeRun(r),
  },
  {
    id: "attitude-convert",
    name: "Attitude: quaternion, matrix, Euler angles",
    group: ROBOTICS_GROUP,
    hint: "Converts an orientation between quaternion, rotation matrix, Euler angles (all 12 sequences, intrinsic or extrinsic) and axis–angle; composes two rotations or slerps between them; names gimbal lock.",
    unitContract: "converts",
    fields: [
      {
        key: "op",
        label: "Operation",
        default: "convert",
        kind: "select",
        options: [
          { value: "convert", label: "Convert rotation A" },
          { value: "compose", label: "Compose A ⊗ B (B in A's body frame)" },
          { value: "slerp", label: "Slerp from A to B at fraction t" },
        ],
      },
      { key: "formA", label: "Rotation A is given as", default: "euler", kind: "select", options: FORM_OPTIONS },
      { key: "seqA", label: "Euler sequence (for A's angles, and the sequence every result is reported in)", default: "ZYX", kind: "select", options: SEQ_OPTIONS },
      {
        key: "frame",
        label: "Euler angles are",
        default: "intrinsic",
        kind: "select",
        options: [
          { value: "intrinsic", label: "Intrinsic (about the moving body axes)" },
          { value: "extrinsic", label: "Extrinsic (about the fixed reference axes)" },
        ],
      },
      { key: "a1", label: "A, first angle (° unless a unit is typed)", default: "30", kind: "text" },
      { key: "a2", label: "A, second angle", default: "20", kind: "text" },
      { key: "a3", label: "A, third angle", default: "10", kind: "text" },
      {
        key: "order",
        label: "Quaternion order (as typed)",
        default: "last",
        kind: "select",
        options: [
          { value: "last", label: "Scalar-last (x, y, z, w)" },
          { value: "first", label: "Scalar-first (w, x, y, z)" },
        ],
      },
      { key: "quatA", label: "A as a quaternion (four numbers)", default: "0, 0, 0, 1", kind: "text" },
      { key: "dcmA", label: "A as a rotation matrix (3 rows of 3; columns are the body axes)", default: "1 0 0\n0 1 0\n0 0 1", kind: "block", rows: 3 },
      { key: "axisA", label: "A as an axis (x, y, z)", default: "0, 0, 1", kind: "text" },
      { key: "angleA", label: "A's angle about that axis", default: "90", kind: "text" },
      { key: "formB", label: "Rotation B (compose / slerp) is given as", default: "euler", kind: "select", options: FORM_OPTIONS.slice(0, 2) },
      { key: "seqB", label: "B's Euler sequence (same intrinsic/extrinsic choice)", default: "ZXZ", kind: "select", options: SEQ_OPTIONS },
      { key: "b1", label: "B, first angle", default: "45", kind: "text" },
      { key: "b2", label: "B, second angle", default: "30", kind: "text" },
      { key: "b3", label: "B, third angle", default: "60", kind: "text" },
      { key: "quatB", label: "B as a quaternion (four numbers)", default: "0, 0, 0.7071068, 0.7071068", kind: "text" },
      { key: "t", label: "Slerp fraction t (0 = A, 1 = B)", default: "0.5", kind: "text" },
    ],
    compute: (r) => computeAttitude(r),
  },
];
