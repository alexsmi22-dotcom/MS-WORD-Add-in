// Pane glue for the three thin-film / polarisation calculators in the
// Engineering "Optics & photonics" group: Fresnel s/p at one interface, a
// thin-film stack by the characteristic matrix, and Jones calculus. Kept OUT of
// taskpane.ts so the exact objects the pane registers can be tested (nothing
// can import the pane under jest), as assayQuantCalcs.ts and welchCalcs.ts are.
//
// No physics is computed here: thinFilm.ts and jones.ts own it, and the
// Brewster / critical angles and normal-incidence reflectance come from
// optics.ts refraction() through thinFilm.ts, so the Refraction tool and these
// tools cannot disagree. This file adds wording (display contract: U+2212
// minus, ×10⁻ⁿ, subscripts, no carets, no e-notation, no em dash in an ok
// result) and the figures.

import type { EngUnitContract } from "./engCalc";
import type { AnalyzeBlock, AnalyzeOutput } from "./analyzeBlocks";
import { engReport } from "./engReport";
import { buildPlotSvg, type Point, type Series } from "./plot";
import { qNum } from "./assayQuant";
import { fieldNumber } from "./numberList";
import { fresnel, fresnelAt, readIndex, readLayers, stackRTA, carg, cabs, cx, type Cx, type Pol, type Layer } from "./thinFilm";
import {
  propagate,
  ellipse,
  DARK,
  stokes,
  readElements,
  describeElement,
  linearState,
  RIGHT_CIRCULAR,
  LEFT_CIRCULAR,
  type JonesVec,
  type Ellipse,
} from "./jones";
import { polarisationEllipseSvg, ELLIPSE_FIG_H } from "./filmCharts";

/** The pane's AnalyzeField, structurally (taskpane.ts does not export it). */
export interface FilmField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  rows?: number;
  options?: { value: string; label: string }[];
}
/** The pane's EngCalc, structurally; the group is the literal the pane's EngGroup union holds. */
export interface FilmCalc {
  id: string;
  name: string;
  group: "Optics & photonics";
  hint: string;
  fields: FilmField[];
  /** The unit contract this tool keeps (engCalc.ts EngUnitContract). */
  unitContract: EngUnitContract;
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

// ------------------------------------------------------------- formatting

const MINUS = "−";
const snap0 = (x: number, tol = 1e-12): number => (Math.abs(x) < tol ? 0 : x);
/** A number to `sig` significant figures, display-contract clean (qNum: ×10⁻ⁿ, U+2212). */
const num = (x: number, sig = 4): string => qNum(snap0(x), sig);
/** A percentage: "4.26 %", with tiny values in ×10⁻ⁿ. */
const pct = (x: number, sig = 4): string => `${qNum(snap0(x * 100, 1e-10), sig)} %`;
const degText = (x: number, sig = 5): string => `${num(x, sig)}°`;
function cxText(z: Cx, sig = 4): string {
  const scaleRef = Math.max(Math.abs(z.re), Math.abs(z.im));
  const re = snap0(z.re, 1e-12 * Math.max(1, scaleRef));
  const im = snap0(z.im, 1e-12 * Math.max(1, scaleRef));
  if (im === 0) return num(re, sig);
  const imAbs = qNum(Math.abs(im), sig);
  if (re === 0) return `${im < 0 ? MINUS : ""}${imAbs}i`;
  return `${num(re, sig)} ${im < 0 ? MINUS : "+"} ${imAbs}i`;
}
const indexText = (n: Cx): string => cxText(n, 6);
/** A phase in degrees in (−180, 180], snapped. */
function phaseText(z: Cx): string {
  if (cabs(z) < 1e-14) return "none (zero amplitude)";
  let d = (carg(z) * 180) / Math.PI;
  if (d <= -180 + 1e-9) d += 360;
  return degText(snap0(d, 1e-9), 5);
}

/** The intrinsic size the builder drew at (plot.ts widens its canvas for a legend). */
function svgSize(svg: string, w: number, h: number): { w: number; h: number } {
  const m = /^<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w, h };
}
function plotBlock(svg: string, w: number, h: number, caption: string, alt: string): AnalyzeBlock {
  const s = svgSize(svg, w, h);
  return { kind: "plot", svg, caption, alt, w: s.w, h: s.h };
}
const refuse = (text: string): AnalyzeOutput => ({ text, ok: false });

function readReal(text: string, what: string, test: (x: number) => boolean, rule: string): number | string {
  const v = fieldNumber(text, /\s*(?:°|deg|nm)\s*$/i);
  if (!Number.isFinite(v)) return `${what} is not a number.`;
  if (!test(v)) return `${what} ${rule}.`;
  return v;
}

const CONVENTION_NOTE =
  "Convention: time dependence exp(−iωt), N = n + ik with k ≥ 0 absorbing; rp in the Born & Wolf / Hecht sign " +
  "(rp = −rs at normal incidence), the same as the tmm package. Reflectances do not depend on the sign choice; the " +
  "phase of p light does.";

// ------------------------------------------------------------------ Fresnel

const fresnelCalc: FilmCalc = {
  id: "optics-fresnel",
  name: "Fresnel s/p reflection & transmission",
  group: "Optics & photonics",
  unitContract: "domain",
  hint:
    "Fresnel coefficients rs, rp, ts, tp, the power fractions R and T for s, p and unpolarised light, and the phase " +
    "shifts, at one uncoated interface. Indices are YOUR inputs (no index table): the incident medium is lossless, " +
    "the second may absorb, typed n+ki (k ≥ 0, e.g. 0.05+3.4i for a metal). Convention: exp(−iωt), rp = −rs at normal " +
    "incidence (Born & Wolf / Hecht).",
  fields: [
    { key: "n1", label: "Index of the incident medium n₁ (lossless)", default: "1.0", kind: "text" },
    { key: "n2", label: "Index of the second medium N₂ (n or n+ki)", default: "1.52", kind: "text" },
    { key: "th", label: "Angle of incidence from the normal, °", default: "45", kind: "text" },
  ],
  compute: (r) => {
    const n1Read = readIndex(r("n1"), "The incident index n₁");
    if (!n1Read.ok) return refuse(n1Read.reason);
    if (n1Read.n.im !== 0) {
      return refuse(
        "The incident medium must be lossless (a real n₁): reflectance and transmittance are not defined for light " +
          "arriving through an absorbing medium. Put the absorbing material second.",
      );
    }
    const n1 = n1Read.n.re;
    const n2Read = readIndex(r("n2"), "The second index N₂");
    if (!n2Read.ok) return refuse(n2Read.reason);
    const N2 = n2Read.n;
    const th = readReal(r("th"), "The angle of incidence", (x) => x >= 0 && x < 90, "must be at least 0° and below 90°");
    if (typeof th === "string") return refuse(th);
    const res = fresnel(n1, N2, th);
    if (!res) return refuse("These inputs have no Fresnel solution: check that both indices are positive.");

    const Ravg = (res.Rs + res.Rp) / 2;
    const Tavg = (res.Ts + res.Tp) / 2;
    const lines: string[] = [
      "Fresnel coefficients at one interface",
      "",
      `  n₁ = ${indexText(cx(n1))}  →  N₂ = ${indexText(N2)},  θᵢ = ${degText(th)}`,
      `  Refraction angle θₜ    ${
        res.tir ? "none: totally internally reflected" : res.thetaTDeg !== null ? degText(res.thetaTDeg) : "complex (absorbing medium)"
      }`,
      "",
      "Amplitude coefficients (complex), magnitude and phase",
      `  rs = ${cxText(res.rs)}    |rs| = ${num(cabs(res.rs))}, phase ${phaseText(res.rs)}`,
      `  rp = ${cxText(res.rp)}    |rp| = ${num(cabs(res.rp))}, phase ${phaseText(res.rp)}`,
      `  ts = ${cxText(res.ts)}    |ts| = ${num(cabs(res.ts))}, phase ${phaseText(res.ts)}`,
      `  tp = ${cxText(res.tp)}    |tp| = ${num(cabs(res.tp))}, phase ${phaseText(res.tp)}`,
      "",
      "Power fractions",
      `  Rs = ${pct(res.Rs)}    Rp = ${pct(res.Rp)}    R (unpolarised) = ${pct(Ravg)}`,
      `  Ts = ${pct(res.Ts)}    Tp = ${pct(res.Tp)}    T (unpolarised) = ${pct(Tavg)}`,
      "  T includes the n·cosθ power factor (tmm's convention): it is the fraction of POWER crossing the interface, so R + T = 1.",
      "",
      "Special angles",
      res.brewsterIsPseudo
        ? `  Pseudo-Brewster angle  ${degText(res.brewsterDeg)}  (minimum Rp = ${qNum(res.rpAtBrewster * 100, 4)} %)`
        : `  Brewster angle         ${degText(res.brewsterDeg)}  (Rp = 0 there)`,
      `  Critical angle         ${
        res.criticalDeg !== null
          ? degText(res.criticalDeg)
          : res.absorbing
            ? "none (absorbing second medium)"
            : "none: TIR needs n₁ > n₂"
      }`,
      `  R at normal incidence  ${pct(res.reflectanceNormal)}`,
      "",
    ];
    for (const n of res.notes) lines.push(`Note: ${n}`);
    lines.push(CONVENTION_NOTE);

    // Rs, Rp and the average against incidence, each point asked of the engine.
    const sPts: Point[] = [];
    const pPts: Point[] = [];
    const aPts: Point[] = [];
    for (let i = 0; i <= 359; i++) {
      const t = i * 0.25;
      const q = fresnelAt(n1, N2, t);
      if (!q) continue;
      sPts.push({ x: t, y: q.Rs * 100 });
      pPts.push({ x: t, y: q.Rp * 100 });
      aPts.push({ x: t, y: ((q.Rs + q.Rp) / 2) * 100 });
    }
    // Marker lines span the curves' own range (rounded out to 5 %), so a metal's 96–100 % is not flattened against 0.
    const allY = [...sPts, ...pPts].map((q) => q.y);
    const lo = Math.max(0, Math.floor((Math.min(...allY) - 2) / 5) * 5);
    const hi = 100;
    const series: Series[] = [
      { points: sPts, type: "line", color: "#2563eb", label: "Rs" },
      { points: pPts, type: "line", color: "#dc2626", label: "Rp" },
      { points: aPts, type: "line", color: "#6b7280", label: "R unpolarised" },
      {
        points: [
          { x: res.brewsterDeg, y: lo },
          { x: res.brewsterDeg, y: hi },
        ],
        type: "line",
        color: "#059669",
        label: `${res.brewsterIsPseudo ? "pseudo-Brewster" : "Brewster"} ${num(res.brewsterDeg, 4)}°`,
      },
    ];
    if (res.criticalDeg !== null) {
      series.push({
        points: [
          { x: res.criticalDeg, y: lo },
          { x: res.criticalDeg, y: hi },
        ],
        type: "line",
        color: "#9333ea",
        label: `critical ${num(res.criticalDeg, 4)}°`,
      });
    }
    series.push({ points: [{ x: th, y: Ravg * 100 }], type: "scatter", color: "#111111", label: "your angle (R)" });
    const svg = buildPlotSvg(series, {
      width: 380,
      height: 260,
      title: "Reflectance against angle of incidence",
      xlabel: "angle of incidence θᵢ (°)",
      ylabel: "reflectance (%)",
    });
    return engReport(lines, [
      plotBlock(
        svg,
        380,
        260,
        res.criticalDeg !== null
          ? "Rs and Rp reach 100 % at the critical angle; Rp falls to zero at the Brewster angle"
          : res.brewsterIsPseudo
            ? "Rp dips to its minimum at the pseudo-Brewster angle; it never reaches zero into an absorbing medium"
            : "Rp falls to zero at the Brewster angle; s and p meet again at normal and grazing incidence",
        "Reflectance for s, p and unpolarised light against angle of incidence with the Brewster and critical angles marked",
      ),
    ]);
  },
};

// --------------------------------------------------------------- the stack

const POL_NAME: Record<Pol, string> = { s: "s-polarised", p: "p-polarised", avg: "unpolarised (mean of s and p)" };

const stackCalc: FilmCalc = {
  id: "optics-thin-film",
  name: "Thin-film stack: R, T, A spectrum",
  group: "Optics & photonics",
  unitContract: "domain",
  hint:
    "Reflectance, transmittance and absorptance of a multilayer coating by the characteristic matrix. One layer per " +
    "line, the one nearest the incident medium FIRST: label, index, thickness, e.g. \"MgF2 1.38 99.6 nm\" or \"1.38 QW\" " +
    "(QW / HW: a quarter / half wave at the design wavelength, at normal incidence). \"repeat 7\" … \"end\" repeats lines. " +
    "Names are labels only and indices are YOUR inputs: no index table, no dispersion (n is the same at every " +
    "wavelength), a semi-infinite substrate (its back surface is not included).",
  fields: [
    { key: "n0", label: "Incident medium index n₀ (lossless)", default: "1.0", kind: "text" },
    { key: "layers", label: "Layers, nearest the incident medium first", default: "MgF2 1.38 QW", kind: "block", rows: 6 },
    { key: "ns", label: "Substrate index (n or n+ki)", default: "1.52", kind: "text" },
    { key: "lam0", label: "Design wavelength λ₀, nm", default: "550", kind: "text" },
    { key: "lmin", label: "Spectrum from, nm", default: "400", kind: "text" },
    { key: "lmax", label: "Spectrum to, nm", default: "800", kind: "text" },
    { key: "th", label: "Angle of incidence in the incident medium, °", default: "0", kind: "text" },
    {
      key: "pol",
      label: "Polarisation",
      default: "avg",
      kind: "select",
      options: [
        { value: "avg", label: "Unpolarised (mean of s and p)" },
        { value: "s", label: "s (TE)" },
        { value: "p", label: "p (TM)" },
      ],
    },
  ],
  compute: (r) => {
    const n0Read = readIndex(r("n0"), "The incident index n₀");
    if (!n0Read.ok) return refuse(n0Read.reason);
    if (n0Read.n.im !== 0) return refuse("The incident medium must be lossless (a real n₀): R and T are not defined inside an absorbing medium.");
    const n0 = n0Read.n.re;
    const nsRead = readIndex(r("ns"), "The substrate index");
    if (!nsRead.ok) return refuse(nsRead.reason);
    const Ns = nsRead.n;
    const lam0 = readReal(r("lam0"), "The design wavelength", (x) => x > 0 && x <= 1e7, "must be above 0 and at most 10⁷ nm");
    if (typeof lam0 === "string") return refuse(lam0);
    const lmin = readReal(r("lmin"), "The spectrum start", (x) => x > 0 && x <= 1e7, "must be above 0 and at most 10⁷ nm");
    if (typeof lmin === "string") return refuse(lmin);
    const lmax = readReal(r("lmax"), "The spectrum end", (x) => x > 0 && x <= 1e7, "must be above 0 and at most 10⁷ nm");
    if (typeof lmax === "string") return refuse(lmax);
    if (!(lmax > lmin)) return refuse("The spectrum must run from a shorter to a longer wavelength (from < to).");
    const th = readReal(r("th"), "The angle of incidence", (x) => x >= 0 && x < 90, "must be at least 0° and below 90°");
    if (typeof th === "string") return refuse(th);
    const polRaw = r("pol");
    const pol: Pol = polRaw === "s" || polRaw === "p" ? polRaw : "avg";
    const lr = readLayers(r("layers"), lam0);
    if (!lr.ok) return refuse(lr.reason);
    const layers: Layer[] = lr.layers;

    const at0 = stackRTA(n0, layers, Ns, lam0, th, pol);
    const bare = stackRTA(n0, [], Ns, lam0, th, pol);
    if (!at0 || !bare) return refuse("The stack could not be evaluated: check the indices and thicknesses.");
    const layersAbsorb = layers.some((L) => L.n.im > 0);
    const subAbsorbs = Ns.im > 0;
    // With an absorbing substrate, T is the power that ENTERS the substrate (and is absorbed there), while A is
    // only what the layers absorb; both are labelled so, as the Fresnel tool explains for one interface.
    const tName = subAbsorbs ? "T into the substrate" : "T";
    const aName = subAbsorbs ? "A in the layers" : "A";

    const lines: string[] = [
      `Thin-film stack at λ₀ = ${num(lam0, 6)} nm, θ = ${degText(th)}, ${POL_NAME[pol]}`,
      "",
      `  R = ${pct(at0.R)}    ${tName} = ${pct(at0.T)}    ${aName} = ${pct(at0.A)}`,
    ];
    if (subAbsorbs) {
      lines.push(
        "  The substrate absorbs (k > 0): the light that enters it is absorbed there, so nothing is transmitted through " +
          "it; \"T into the substrate\" is that power, and A counts only the absorption in the layers.",
      );
    }
    if (pol === "avg" && th > 0) {
      lines.push(`  s: R = ${pct(at0.Rs)}, T = ${pct(at0.Ts)}    p: R = ${pct(at0.Rp)}, T = ${pct(at0.Tp)}`);
    }
    lines.push(`  Uncoated substrate at the same λ₀ and angle: R = ${pct(bare.R)}`);
    lines.push("");
    lines.push(`Layers (${layers.length}), incident medium n₀ = ${indexText(cx(n0))} first:`);
    const shown = layers.slice(0, 40);
    shown.forEach((L, i) => {
      const opt = (L.n.re * L.dNm) / lam0;
      lines.push(
        `  ${i + 1}. ${L.label ? L.label + "  " : ""}n = ${indexText(L.n)}, d = ${num(L.dNm, 5)} nm${L.wave ? ` (${L.wave})` : ""}, ` +
          `optical thickness ${num(opt, 4)} λ₀`,
      );
    });
    if (layers.length > shown.length) lines.push(`  … and ${layers.length - shown.length} more layers.`);
    lines.push(`  Substrate N = ${indexText(Ns)}`);

    // The spectrum.
    const NPTS = 301;
    const Rp: Point[] = [];
    const Tp: Point[] = [];
    const Ap: Point[] = [];
    let minR = Infinity;
    let minAt = lmin;
    let maxR = -Infinity;
    let maxAt = lmin;
    for (let i = 0; i < NPTS; i++) {
      const lam = lmin + ((lmax - lmin) * i) / (NPTS - 1);
      const q = stackRTA(n0, layers, Ns, lam, th, pol);
      if (!q) continue;
      Rp.push({ x: lam, y: q.R * 100 });
      Tp.push({ x: lam, y: q.T * 100 });
      Ap.push({ x: lam, y: q.A * 100 });
      if (q.R < minR) {
        minR = q.R;
        minAt = lam;
      }
      if (q.R > maxR) {
        maxR = q.R;
        maxAt = lam;
      }
    }
    // The extremes include the design wavelength itself, so they can never contradict the R printed above.
    if (lam0 >= lmin && lam0 <= lmax) {
      if (at0.R < minR) {
        minR = at0.R;
        minAt = lam0;
      }
      if (at0.R > maxR) {
        maxR = at0.R;
        maxAt = lam0;
      }
    }
    lines.push("");
    lines.push(`Across ${num(lmin, 6)}–${num(lmax, 6)} nm (${NPTS} points and λ₀): lowest R = ${pct(minR)} at ${num(minAt, 5)} nm, highest R = ${pct(maxR)} at ${num(maxAt, 5)} nm.`);
    // Fringe period at the short end ≈ λ²/(2·Σ n·d); a grid coarser than a third of it draws sampling noise.
    const optSum = layers.reduce((a, L) => a + L.n.re * L.dNm, 0);
    const fringe = optSum > 0 ? (lmin * lmin) / (2 * optSum) : Infinity;
    const step = (lmax - lmin) / (NPTS - 1);
    if (fringe < 3 * step && !at0.capped) {
      // The cause: a stack thick enough that even a ½λ₀–2λ₀ range at this point count (step λ₀/200) could not
      // resolve its fringes near λ₀ (Σ n·d > 33 λ₀), or a range too wide for the grid.
      const thick = optSum > (100 / 3) * lam0;
      lines.push(
        `Note: the spectrum is UNDERSAMPLED: the interference fringes are about ${num(fringe, 2)} nm apart at ${num(lmin, 5)} nm, ` +
          `but the ${NPTS} points are ${num(step, 3)} nm apart, so the curve and the lowest/highest R above are grid samples, ` +
          "not the true extremes. " +
          (thick
            ? `The stack is optically thick (Σ n·d = ${num(optSum / lam0, 3)} λ₀): narrow the range, and note that a layer this thick is usually incoherent in practice.`
            : "The range is too wide for the grid: narrow it around the region of interest."),
      );
    }
    if (layers.length === 0) lines.push("Note: no layers were given, so this is the bare substrate: the Fresnel reflectance of one interface.");
    if (at0.capped) {
      lines.push("Note: at least one layer is optically opaque (its single-pass transmission is below 10⁻³⁰); it is treated as opaque, as the tmm package does.");
    }
    lines.push(
      "Note: indices are constant across the spectrum (no dispersion), every layer is coherent, and the substrate is " +
        "semi-infinite, so a real substrate's back-surface reflection (about 4 % for glass in air) is NOT included.",
    );
    lines.push(CONVENTION_NOTE);

    const series: Series[] = [
      { points: Rp, type: "line", color: "#2563eb", label: "R" },
      { points: Tp, type: "line", color: "#059669", label: tName },
    ];
    if (layersAbsorb) series.push({ points: Ap, type: "line", color: "#d97706", label: aName });
    if (lam0 >= lmin && lam0 <= lmax) {
      const ys = series.flatMap((s) => s.points.map((q) => q.y));
      const lo = Math.max(0, Math.floor((Math.min(...ys) - 2) / 5) * 5);
      const hi = Math.min(100, Math.ceil((Math.max(...ys) + 2) / 5) * 5);
      series.push({
        points: [
          { x: lam0, y: lo },
          { x: lam0, y: hi },
        ],
        type: "line",
        color: "#9ca3af",
        label: `λ₀ = ${num(lam0, 5)} nm`,
      });
    }
    const svg = buildPlotSvg(series, {
      width: 380,
      height: 260,
      title: "Reflectance and transmittance spectrum",
      xlabel: "wavelength λ (nm)",
      ylabel: layersAbsorb ? "R, T, A (%)" : "R, T (%)",
    });
    return engReport(lines, [
      plotBlock(
        svg,
        380,
        260,
        `R and T of the stack against wavelength, ${POL_NAME[pol]}, at θ = ${num(th, 4)}°`,
        "Reflectance and transmittance of the thin-film stack against wavelength, with the design wavelength marked",
      ),
    ]);
  },
};

// ------------------------------------------------------------------- Jones

/** A general complex amplitude: "1", "−0.5", "0.5i", "1+i", "0.6 − 0.8i" (i or j). */
export function readComplex(text: string, what: string): { ok: true; z: Cx } | { ok: false; reason: string } {
  const t = (text ?? "").replace(/[−–]/g, "-").replace(/\s+/g, "").replace(/j/gi, "i");
  const N = String.raw`(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
  const bad = { ok: false as const, reason: `${what} "${(text ?? "").trim()}" is not a complex number. Type e.g. 1, 0.5i, 0.6+0.8i.` };
  let reV = 0;
  let imV = 0;
  let m: RegExpExecArray | null;
  if ((m = new RegExp(String.raw`^([+-]?${N})$`, "i").exec(t))) {
    reV = Number(m[1]);
  } else if ((m = new RegExp(String.raw`^([+-]?)(${N})?i$`, "i").exec(t))) {
    imV = (m[1] === "-" ? -1 : 1) * (m[2] === undefined ? 1 : Number(m[2]));
  } else if ((m = new RegExp(String.raw`^([+-]?${N})([+-])(${N})?i$`, "i").exec(t))) {
    reV = Number(m[1]);
    imV = (m[2] === "-" ? -1 : 1) * (m[3] === undefined ? 1 : Number(m[3]));
  } else {
    return bad;
  }
  if (!Number.isFinite(reV) || !Number.isFinite(imV)) return { ok: false, reason: `${what} is not finite.` };
  if (Math.abs(reV) > 1e100 || Math.abs(imV) > 1e100) return { ok: false, reason: `${what} is too large.` };
  return { ok: true, z: cx(reV, imV) };
}

/** An intensity fraction: significant figures, or "0 (below the 10⁻²⁸ rounding level)" under DARK, in every line alike. */
function intensityText(x: number, sig = 6): string {
  return x < DARK ? "0 (below the 10⁻²⁸ rounding level)" : qNum(x, sig);
}
/** An angle to 12 significant figures (float noise trimmed), so 89.999999° is never shown as 90°. */
const fineDeg = (x: number): string => `${qNum(Math.abs(x) < 1e-12 ? 0 : x, 12)}°`;

function stateText(e: Ellipse | null): string {
  if (!e) return "no light";
  // Ten figures, so a state 5×10⁻⁵° from 90° is not printed as 90°.
  if (e.shape === "linear") return `linear at ${fineDeg(e.azimuthDeg)}`;
  if (e.shape === "circular") return `${e.handedness}-handed circular`;
  return `${e.handedness}-handed elliptical, azimuth ${degText(e.azimuthDeg, 4)}, ellipticity χ = ${degText(e.ellipticityDeg, 4)}`;
}

const HAND_NOTE =
  "Handedness (IEEE, right-hand rule): right-handed means the field turns counter-clockwise as seen looking INTO the " +
  "beam (thumb along the direction of travel); the older optics convention of Born & Wolf calls the same wave left-handed. " +
  "Time dependence exp(−iωt), so (1, i)/√2 is right-handed and S₃ > 0.";

const jonesCalc: FilmCalc = {
  id: "optics-jones",
  name: "Polarisation: Jones calculus",
  group: "Optics & photonics",
  unitContract: "domain",
  hint:
    "A fully polarised beam through polarisers, wave plates, retarders and rotators, in order, one per line: " +
    "\"polariser 30\", \"hwp 22.5\", \"qwp 45\", \"retarder 30 60\" (fast axis 30°, δ = 60°), \"rotator 15\". Angles from x " +
    "toward y. Handedness is the IEEE convention: right-handed = counter-clockwise looking into the beam (Born & Wolf " +
    "name it the other way); time dependence exp(−iωt). Ideal elements; no partial polarisation.",
  fields: [
    {
      key: "input",
      label: "Input polarisation",
      default: "linear",
      kind: "select",
      options: [
        { value: "linear", label: "Linear at an angle" },
        { value: "right", label: "Right-handed circular (IEEE)" },
        { value: "left", label: "Left-handed circular (IEEE)" },
        { value: "custom", label: "Elliptical: Ex and Ey below" },
      ],
    },
    { key: "angle", label: "Linear input angle from x, °", default: "0", kind: "text" },
    { key: "ex", label: "Ex (complex, for elliptical input)", default: "1", kind: "text" },
    { key: "ey", label: "Ey (complex, for elliptical input)", default: "0.5i", kind: "text" },
    { key: "elements", label: "Elements, in the order the light meets them", default: "qwp 45", kind: "block", rows: 5 },
  ],
  compute: (r) => {
    const kind = r("input");
    let vin: JonesVec;
    let inName: string;
    if (kind === "right") {
      vin = RIGHT_CIRCULAR;
      inName = "right-handed circular";
    } else if (kind === "left") {
      vin = LEFT_CIRCULAR;
      inName = "left-handed circular";
    } else if (kind === "custom") {
      const ex = readComplex(r("ex"), "Ex");
      if (!ex.ok) return refuse(ex.reason);
      const ey = readComplex(r("ey"), "Ey");
      if (!ey.ok) return refuse(ey.reason);
      if (cabs(ex.z) === 0 && cabs(ey.z) === 0) return refuse("Ex and Ey are both zero: there is no light to follow.");
      vin = [ex.z, ey.z];
      inName = `Ex = ${cxText(ex.z)}, Ey = ${cxText(ey.z)}`;
    } else {
      const a = readReal(r("angle"), "The input angle", (x) => Math.abs(x) <= 3600, "must be within ±3600°");
      if (typeof a === "string") return refuse(a);
      vin = linearState(a);
      inName = `linear at ${degText(a, 5)}`;
    }
    const er = readElements(r("elements"));
    if (!er.ok) return refuse(er.reason);
    const res = propagate(vin, er.elements);
    if (!res) return refuse("The input state could not be normalised.");

    const eIn = ellipse(res.input);
    // Below DARK of the input intensity the light is extinguished: no state is named and no ellipse drawn.
    const eOut = ellipse(res.output, DARK);
    const sIn = stokes(res.input);
    const sOut = stokes(res.output);
    const vecText = (v: JonesVec): string => `(${cxText(v[0])}, ${cxText(v[1])})`;
    const lines: string[] = [
      "Jones calculus",
      "",
      `  Input: ${inName}, normalised Jones vector ${vecText(res.input)}`,
      `  Input state: ${stateText(eIn)}`,
      "",
    ];
    if (res.steps.length === 0) {
      lines.push("  No elements: the output is the input.");
    } else {
      lines.push("Element by element (intensity as a fraction of the input):");
      res.steps.forEach((s, i) => {
        lines.push(`  ${i + 1}. ${describeElement(s.element)}:  I = ${intensityText(s.intensity, 5)}, ${stateText(ellipse(s.out, DARK))}`);
      });
    }
    lines.push("");
    lines.push(`  Output Jones vector ${vecText(res.output)}`);
    lines.push(
      res.transmitted < DARK
        ? `  Transmitted intensity I/I₀ = ${intensityText(res.transmitted)}`
        : `  Transmitted intensity I/I₀ = ${intensityText(res.transmitted)} (${qNum(res.transmitted * 100, 5)} %)`,
    );
    if (eOut) {
      lines.push(`  Output state: ${stateText(eOut)}`);
      lines.push(
        `  Ellipse: azimuth ψ = ${eOut.shape === "circular" ? "none (a circle has no major axis)" : eOut.shape === "linear" ? fineDeg(eOut.azimuthDeg) : degText(eOut.azimuthDeg, 5)}, ellipticity χ = ${degText(eOut.ellipticityDeg, 5)}, ` +
          `axial ratio b/a = ${num(eOut.axialRatio, 4)}, ${eOut.handedness === "linear" ? "no rotation (linear)" : eOut.handedness + "-handed"}`,
      );
    } else {
      lines.push(
        res.transmitted > 0
          ? "  No light is transmitted (I/I₀ is below 10⁻²⁸, the rounding level of the calculation), so the output has no polarisation ellipse."
          : "  No light is transmitted, so the output has no polarisation ellipse.",
      );
    }
    const st = (s: typeof sIn): string => `S₀ = ${num(s.S0, 5)}, S₁ = ${num(s.S1, 5)}, S₂ = ${num(s.S2, 5)}, S₃ = ${num(s.S3, 5)}`;
    lines.push(`  Stokes, input:  ${st(sIn)}`);
    lines.push(
      res.transmitted < DARK
        ? "  Stokes, output: S₀ = S₁ = S₂ = S₃ = 0 (below the 10⁻²⁸ rounding level)"
        : `  Stokes, output: S₀ = ${qNum(sOut.S0, 5)}, S₁ = ${qNum(sOut.S1, 5)}, S₂ = ${qNum(sOut.S2, 5)}, S₃ = ${qNum(sOut.S3, 5)}  (relative to the input intensity)`,
    );

    // Malus check, when the input is linear and every element is a polariser.
    if (eIn && eIn.shape === "linear" && res.steps.length > 0 && er.elements.every((e) => e.kind === "polariser")) {
      let prev = eIn.azimuthDeg;
      let pred = 1;
      for (const e of er.elements) {
        const c = Math.cos(((e.angleDeg - prev) * Math.PI) / 180);
        pred *= c * c;
        prev = e.angleDeg;
      }
      lines.push(`  Malus's law, the product of cos²(Δθ) over the polarisers: ${intensityText(pred)} (the Jones result above is ${intensityText(res.transmitted)}).`);
    }
    lines.push("");
    lines.push(`Note: ${HAND_NOTE}`);
    lines.push(
      "Note: a retarder's fast axis is at the angle given and its slow component lags by δ; global phase is dropped. " +
        "Elements are ideal (a perfect polariser, lossless plates) and the beam is fully polarised.",
    );

    const lineFor = (e: Ellipse | null, I0: number): string[] =>
      e
        ? [stateText(e).replace(/, ellipticity.*$/, "").replace(/, azimuth.*$/, ""), `I/I₀ = ${qNum(I0, 4)}`]
        : ["no light", "I/I₀ = 0"];
    const svg = polarisationEllipseSvg([
      { title: "Input", vec: res.input, lines: lineFor(eIn, 1), colour: "#2563eb" },
      { title: "Output", vec: eOut ? res.output : [cx(0), cx(0)], lines: lineFor(eOut, res.transmitted), colour: "#b91c1c" },
    ]);
    return engReport(lines, [
      plotBlock(
        svg,
        420,
        ELLIPSE_FIG_H,
        "Polarisation ellipses of the input and output, looking into the beam; the arrow shows the sense of rotation",
        "The input and output polarisation ellipses drawn with equal axes and an arrow for the sense of rotation",
      ),
    ]);
  },
};

export const FILM_CALCS: FilmCalc[] = [fresnelCalc, stackCalc, jonesCalc];
