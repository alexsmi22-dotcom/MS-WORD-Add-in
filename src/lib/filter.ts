// Analogue filter design — Butterworth and Chebyshev, from a specification to a
// transfer function.
//
// THE OUTPUT IS A TRANSFER FUNCTION, WHICH IS THE POINT. Filter design and
// control analysis are the same mathematics with different vocabulary, so this
// module produces exactly what control.ts consumes: the designed filter can be
// handed straight to the Bode and step-response tools rather than being a
// dead-end table of coefficients. That is why there is no plotting here.
//
// THE ORDER IS COMPUTED FROM THE SPECIFICATION, NOT GUESSED. Given a passband
// edge and ripple and a stopband edge and attenuation, the minimum order that
// meets both is a closed form, and it is then ROUNDED UP — a fractional order
// does not exist, and rounding down silently fails the specification the user
// just typed.
//
// THE TRADE NOBODY STATES: BUTTERWORTH IS MAXIMALLY FLAT AND THEREFORE THE
// SLOWEST TO ROLL OFF. For the same order, Chebyshev falls away far faster and
// pays for it with ripple in the passband; for the same specification,
// Chebyshev needs a lower order and therefore fewer components. Neither is
// better — the choice is whether passband flatness or transition sharpness
// matters more — and both are reported so the reader can see the size of the
// difference rather than take a default.
//
// EVERY FILTER'S PHASE IS THE PART THAT BITES. A higher order gives a sharper
// magnitude response and MORE phase shift and group-delay distortion, which
// wrecks pulse shapes even when the magnitude response looks ideal. A
// filter chosen purely on its magnitude plot is chosen on half the information,
// and Chebyshev is markedly worse than Butterworth here.
//
// COEFFICIENTS ARE IRRATIONAL. Butterworth poles sit on a circle at angles that
// are rational multiples of pi, so the polynomial coefficients involve cosines
// and are irrational for every order above 2. They are returned as doubles, and
// the conversion to the exact-rational TransferFunction that control.ts wants
// is the nearest double — which is honest, because the filter itself is not a
// rational object.

import { Rat, ratFromNumber } from "./cas";
import { TransferFunction } from "./control";

export interface FilterError {
  ok: false;
  error: string;
}

export type FilterFamily = "butterworth" | "chebyshev";
export type FilterKind = "lowpass" | "highpass";

export interface FilterSpec {
  family: FilterFamily;
  kind: FilterKind;
  /** Passband edge, rad/s. */
  wp: number;
  /** Stopband edge, rad/s. */
  ws: number;
  /** Maximum passband ripple/attenuation, dB. */
  ap: number;
  /** Minimum stopband attenuation, dB. */
  as: number;
  /** Force this order instead of computing the minimum. 0 to compute. */
  forceOrder?: number;
}

export interface FilterResult {
  ok: true;
  family: FilterFamily;
  kind: FilterKind;
  order: number;
  /** The exact (fractional) order the specification implies, before rounding up. */
  exactOrder: number;
  /** Numerator and denominator in s, HIGHEST power first, matching control.ts. */
  num: number[];
  den: number[];
  /** Poles of the designed filter. */
  poles: { re: number; im: number }[];
  /** Actual attenuation achieved at the stopband edge, dB. */
  stopbandAttenuation: number;
  /** Passband ripple, dB — zero for Butterworth by construction. */
  passbandRipple: number;
  /** The order the OTHER family would have needed, for comparison. */
  alternativeOrder: number;
  notes: string[];
}

/** Multiplies two polynomials given highest-power-first. */
function polyMul(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

/** Builds a monic denominator from a list of poles, pairing conjugates exactly. */
function denominatorFromPoles(poles: { re: number; im: number }[]): number[] {
  let den = [1];
  const used = new Array(poles.length).fill(false);
  for (let i = 0; i < poles.length; i++) {
    if (used[i]) continue;
    const p = poles[i];
    if (Math.abs(p.im) < 1e-12) {
      used[i] = true;
      den = polyMul(den, [1, -p.re]);
      continue;
    }
    // Find the conjugate and multiply the pair as a real quadratic, rather than
    // multiplying two complex factors and hoping the imaginary parts cancel.
    let j = -1;
    for (let k = i + 1; k < poles.length; k++) {
      if (!used[k] && Math.abs(poles[k].re - p.re) < 1e-9 && Math.abs(poles[k].im + p.im) < 1e-9) {
        j = k;
        break;
      }
    }
    used[i] = true;
    if (j >= 0) used[j] = true;
    const mag2 = p.re * p.re + p.im * p.im;
    den = polyMul(den, [1, -2 * p.re, mag2]);
  }
  return den;
}

/**
 * Designs an analogue Butterworth or Chebyshev type I filter.
 *
 * THE STOPBAND ATTENUATION ACTUALLY ACHIEVED IS REPORTED, not just the one
 * asked for. Because the order is rounded up to an integer, the delivered
 * filter almost always exceeds the specification — sometimes by a lot — and
 * knowing by how much tells the reader whether a lower order would nearly do,
 * which is worth one fewer op-amp per two orders.
 */
export function designFilter(spec: FilterSpec): FilterResult | FilterError {
  const { wp, ws, ap, as } = spec;
  for (const [name, v] of [
    ["passband edge", wp],
    ["stopband edge", ws],
    ["passband ripple", ap],
    ["stopband attenuation", as],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (wp <= 0 || ws <= 0) return { ok: false, error: "Both band edges must be greater than zero." };
  if (ap <= 0) return { ok: false, error: "The passband ripple must be greater than zero." };
  if (as <= 0) return { ok: false, error: "The stopband attenuation must be greater than zero." };
  if (as <= ap) {
    return {
      ok: false,
      error:
        "The stopband attenuation must be greater than the passband ripple — otherwise the " +
        "stopband is not attenuated relative to the passband and there is nothing to design.",
    };
  }

  const notes: string[] = [];

  // For a highpass the specification is transformed to an equivalent lowpass
  // prototype by inverting the frequency ratio; the edges swap roles.
  if (spec.kind === "lowpass" && ws <= wp) {
    return { ok: false, error: "For a low-pass filter the stopband edge must be ABOVE the passband edge." };
  }
  if (spec.kind === "highpass" && ws >= wp) {
    return { ok: false, error: "For a high-pass filter the stopband edge must be BELOW the passband edge." };
  }
  const ratio = spec.kind === "lowpass" ? ws / wp : wp / ws;

  const epsSq = Math.pow(10, ap / 10) - 1;
  const stopSq = Math.pow(10, as / 10) - 1;

  // Minimum order for each family, from the standard closed forms.
  const nButter = Math.log10(stopSq / epsSq) / (2 * Math.log10(ratio));
  const nCheb = Math.acosh(Math.sqrt(stopSq / epsSq)) / Math.acosh(ratio);

  const exactOrder = spec.family === "butterworth" ? nButter : nCheb;
  let order = Math.ceil(exactOrder - 1e-12);
  if (spec.forceOrder && Number.isFinite(spec.forceOrder) && spec.forceOrder > 0) {
    order = Math.floor(spec.forceOrder);
    if (order < exactOrder - 1e-9) {
      notes.push(
        `Order ${order} was forced, but the specification needs at least ${Math.ceil(exactOrder)}. ` +
          "This filter does NOT meet the stopband attenuation you asked for; the achieved figure " +
          "is reported below.",
      );
    }
  }
  if (order < 1) order = 1;
  if (order > 12) {
    return {
      ok: false,
      error:
        `This specification needs order ${order}, which is beyond what an analogue filter is built ` +
        "as in practice — component tolerance and op-amp limits dominate above about 8th order, " +
        "and the filter will not behave like the design. Relax the transition band, accept less " +
        "stopband attenuation, or move to a digital implementation.",
    };
  }

  // Prototype poles, on the normalised lowpass with cutoff 1 rad/s.
  const poles: { re: number; im: number }[] = [];
  let dcGain: number;
  if (spec.family === "butterworth") {
    // Poles evenly spaced on the left half of the unit circle. The cutoff is
    // scaled so the PASSBAND EDGE meets the ripple specification exactly,
    // rather than putting the -3 dB point at wp, which would miss the spec
    // whenever ap is not 3 dB.
    const scale = Math.pow(epsSq, -1 / (2 * order));
    for (let k = 0; k < order; k++) {
      const theta = (Math.PI * (2 * k + order + 1)) / (2 * order);
      poles.push({ re: scale * Math.cos(theta), im: scale * Math.sin(theta) });
    }
    dcGain = 1;
  } else {
    const eps = Math.sqrt(epsSq);
    const v0 = Math.asinh(1 / eps) / order;
    for (let k = 0; k < order; k++) {
      const theta = (Math.PI * (2 * k + 1)) / (2 * order);
      poles.push({ re: -Math.sinh(v0) * Math.sin(theta), im: Math.cosh(v0) * Math.cos(theta) });
    }
    // An even-order Chebyshev starts the passband at -ap dB rather than 0 dB.
    dcGain = order % 2 === 0 ? 1 / Math.sqrt(1 + epsSq) : 1;
  }

  // Denormalise to the real band edge.
  const wc = wp;
  const scaled = poles.map((p) => ({ re: p.re * wc, im: p.im * wc }));

  let den: number[];
  let num: number[];
  let finalPoles = scaled;
  if (spec.kind === "lowpass") {
    den = denominatorFromPoles(scaled);
    // Normalise so the DC gain is right.
    num = [den[den.length - 1] * dcGain];
  } else {
    // Highpass by the lowpass-to-highpass transform s -> wc^2/s, which maps the
    // prototype poles to wc^2/p and puts `order` zeros at the origin.
    const hp = scaled.map((p) => {
      const mag2 = p.re * p.re + p.im * p.im;
      return { re: (wc * wc * p.re) / mag2, im: (-wc * wc * p.im) / mag2 };
    });
    den = denominatorFromPoles(hp);
    num = [dcGain, ...new Array(order).fill(0)];
    finalPoles = hp;
  }

  // What the filter actually delivers at the stopband edge.
  const evalMag = (w: number): number => {
    // |H(jw)| by direct evaluation of the polynomials.
    const ev = (p: number[]): { re: number; im: number } => {
      let re = 0;
      let im = 0;
      for (const c of p) {
        const nr = re * 0 - im * w + c;
        const ni = re * w + im * 0;
        re = nr;
        im = ni;
      }
      return { re, im };
    };
    const n = ev(num);
    const d = ev(den);
    const dm = Math.hypot(d.re, d.im);
    return dm === 0 ? Infinity : Math.hypot(n.re, n.im) / dm;
  };

  const magAtStop = evalMag(ws);
  const stopbandAttenuation = magAtStop > 0 ? -20 * Math.log10(magAtStop) : Infinity;
  const passbandRipple = spec.family === "butterworth" ? 0 : ap;
  const alternativeOrder = Math.ceil((spec.family === "butterworth" ? nCheb : nButter) - 1e-12);

  if (spec.family === "butterworth") {
    notes.push(
      `Butterworth is MAXIMALLY FLAT in the passband — no ripple at all — and pays for it with the ` +
        `slowest roll-off of any classical family. A Chebyshev meeting the same specification would ` +
        `need order ${alternativeOrder} instead of ${order}, which is ${order - alternativeOrder} ` +
        "fewer pole pairs and so fewer components, at the cost of ripple in the passband.",
    );
  } else {
    notes.push(
      `Chebyshev type I trades ${ap} dB of PASSBAND RIPPLE for a much sharper transition. A ` +
        `Butterworth meeting the same specification would need order ${alternativeOrder} rather ` +
        `than ${order}. The ripple is not a defect — it is the design variable — but it is real, ` +
        "and in an audio or instrumentation passband it is audible or measurable.",
    );
    if (order % 2 === 0) {
      notes.push(
        "An EVEN-ORDER Chebyshev does not reach 0 dB at DC: it starts at the bottom of the ripple " +
          "band, so the DC gain is -" + ap.toFixed(2) + " dB. Odd orders start at 0 dB. That " +
          "asymmetry surprises people comparing a 4th-order to a 5th-order response.",
      );
    }
  }

  if (stopbandAttenuation > as + 3) {
    notes.push(
      `The delivered stopband attenuation is ${stopbandAttenuation.toFixed(1)} dB against the ` +
        `${as} dB asked for — the surplus comes from rounding the order up to an integer. If ` +
        `${as} dB is genuinely enough, the transition band could be narrowed at no extra cost.`,
    );
  }

  notes.push(
    "MAGNITUDE IS HALF THE STORY. A higher order gives a sharper cut-off AND more phase shift and " +
      "group-delay distortion, which smears pulse shapes even when the magnitude response looks " +
      "perfect. Chebyshev is markedly worse than Butterworth here. Take this transfer function to " +
      "the frequency-response tool and look at the PHASE plot before committing to it.",
  );
  notes.push(
    "Coefficients are irrational for any order above 2 — the poles sit at cosines of rational " +
      "multiples of pi — so these are doubles, not exact values.",
  );

  return {
    ok: true,
    family: spec.family,
    kind: spec.kind,
    order,
    exactOrder,
    num,
    den,
    poles: finalPoles,
    stopbandAttenuation,
    passbandRipple,
    alternativeOrder,
    notes,
  };
}

/**
 * Converts a designed filter into the exact-rational TransferFunction that
 * control.ts analyses.
 *
 * The coefficients are irrational, so this is the nearest double expressed as an
 * exact rational — not a lossless conversion, and it cannot be one. What it
 * preserves is that everything DOWNSTREAM is exact: the Routh tabulation runs
 * without further rounding on precisely the filter that was designed.
 */
export function toTransferFunction(f: FilterResult): TransferFunction {
  const conv = (xs: number[]): Rat[] => xs.map((x) => ratFromNumber(x));
  return { num: conv(f.num), den: conv(f.den) };
}
