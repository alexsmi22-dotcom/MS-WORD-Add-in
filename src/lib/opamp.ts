// Operational amplifier circuits — gains, impedances, and the real limits that
// the ideal model hides.
//
// THE IDEAL OP-AMP IS A TEACHING FICTION AND THE INTERESTING PART IS WHERE IT
// BREAKS. Infinite gain, infinite input impedance, zero output impedance and
// infinite bandwidth give the familiar closed-form gains in one line each, and
// those gains are right — but every one of the four assumptions fails in a way
// that decides whether a circuit works:
//
//   GAIN-BANDWIDTH IS CONSTANT, so bandwidth is the price of gain. A part with
//   a 1 MHz gain-bandwidth product configured for a gain of 100 has 10 kHz of
//   bandwidth, not 1 MHz. This is the single most common surprise in op-amp
//   design: the circuit is correct, the simulation of the ideal model is
//   correct, and the built circuit rolls off two decades earlier than expected.
//
//   SLEW RATE IS A SEPARATE, LARGER-SIGNAL LIMIT, and it is not the same thing
//   as bandwidth. A circuit can be comfortably inside its small-signal
//   bandwidth and still be slew limited on a big output swing, which turns a
//   sine wave into a triangle. The full-power bandwidth — the frequency above
//   which a full-scale sine cannot be produced at all — is computed here,
//   because it is usually far below the small-signal bandwidth and is what
//   actually limits a power stage.
//
//   AN IDEAL INTEGRATOR SATURATES. With no DC feedback path, the input offset
//   voltage and bias current are integrated for ever and the output ends at a
//   rail, usually within seconds. Every working integrator has a resistor
//   across the capacitor to bound the DC gain, which is why the "ideal
//   integrator" transfer function 1/(sRC) never appears in a real schematic.
//
// UNITS are SI: ohms, farads, volts, hertz, and volts per microsecond for slew
// rate because that is how every datasheet prints it.

export interface OpampError {
  ok: false;
  error: string;
}

export type OpampConfig =
  | "inverting"
  | "non-inverting"
  | "buffer"
  | "summing"
  | "difference"
  | "integrator"
  | "differentiator";

export interface OpampInput {
  config: OpampConfig;
  /** Input resistor, ohms. Several for the summing configuration. */
  rin: number[];
  /** Feedback resistor, ohms. */
  rf: number;
  /** Feedback or input capacitor, farads, for integrator and differentiator. */
  c?: number;
  /** Gain-bandwidth product, Hz. 0 to skip the bandwidth analysis. */
  gbw?: number;
  /** Slew rate, V/us. 0 to skip. */
  slewRate?: number;
  /** Peak output swing of interest, V. */
  vout?: number;
  /** Supply rails, V, for the saturation check. 0 to skip. */
  vsupply?: number;
}

export interface OpampResult {
  ok: true;
  config: OpampConfig;
  /** Closed-loop gain. Negative for inverting configurations. */
  gain: number;
  /** Gain magnitude, which is what sets the bandwidth. */
  noiseGain: number;
  /** Input resistance seen by the source, ohms; Infinity for a high-Z input. */
  inputResistance: number;
  /** Small-signal closed-loop bandwidth, Hz; null without a GBW. */
  bandwidth: number | null;
  /** Full-power bandwidth, Hz; null without a slew rate and output swing. */
  fullPowerBandwidth: number | null;
  /** Corner frequency of an integrator or differentiator, Hz. */
  cornerFrequency: number | null;
  /** Per-input gains for the summing configuration. */
  inputGains: number[];
  notes: string[];
}

function finite(name: string, v: number): string | null {
  if (!Number.isFinite(v)) return `The ${name} must be a finite number.`;
  return null;
}

/**
 * Analyses a standard op-amp configuration.
 *
 * THE NOISE GAIN, NOT THE SIGNAL GAIN, SETS THE BANDWIDTH. An inverting
 * amplifier with a signal gain of -1 has a noise gain of 2, so its bandwidth is
 * GBW/2 and not GBW. Getting this wrong makes an inverting unity-gain stage
 * look twice as fast as it is, and the distinction only exists because the
 * feedback network divides the output the same way regardless of which input
 * the signal entered by.
 */
export function analyzeOpamp(inp: OpampInput): OpampResult | OpampError {
  const notes: string[] = [];
  const rin = inp.rin.filter((r) => Number.isFinite(r));
  const rf = inp.rf;

  for (const [name, v] of [["feedback resistor", rf]] as [string, number][]) {
    const bad = finite(name, v);
    if (bad) return { ok: false, error: bad };
  }

  let gain: number;
  let noiseGain: number;
  let inputResistance: number;
  let cornerFrequency: number | null = null;
  const inputGains: number[] = [];

  switch (inp.config) {
    case "buffer": {
      gain = 1;
      noiseGain = 1;
      inputResistance = Infinity;
      notes.push(
        "A buffer has a gain of exactly 1 and the highest bandwidth any configuration gives, " +
          "because the noise gain is 1. Its purpose is impedance transformation: it presents an " +
          "almost infinite load to the source and drives a low impedance.",
      );
      break;
    }
    case "inverting": {
      if (!rin.length || rin[0] <= 0) return { ok: false, error: "The input resistor must be greater than zero." };
      if (rf <= 0) return { ok: false, error: "The feedback resistor must be greater than zero." };
      gain = -rf / rin[0];
      noiseGain = 1 + rf / rin[0];
      inputResistance = rin[0];
      notes.push(
        `The input resistance is just Rin (${rin[0]} ohms), because the inverting input is a VIRTUAL ` +
          "EARTH held at zero volts by the feedback. That is the price of this configuration: it " +
          "loads the source, where a non-inverting stage does not.",
      );
      notes.push(
        `The NOISE GAIN is ${noiseGain.toFixed(3)}, not ${Math.abs(gain).toFixed(3)}. Bandwidth is ` +
          "set by the noise gain, so an inverting stage is always slightly slower than a " +
          "non-inverting one of the same signal gain.",
      );
      break;
    }
    case "non-inverting": {
      if (!rin.length || rin[0] <= 0) return { ok: false, error: "The ground-leg resistor must be greater than zero." };
      if (rf < 0) return { ok: false, error: "The feedback resistor cannot be negative." };
      gain = 1 + rf / rin[0];
      noiseGain = gain;
      inputResistance = Infinity;
      notes.push(
        "The input resistance is essentially infinite — the signal goes straight to the op-amp's " +
          "own input — so this configuration does not load the source. Its gain cannot be less " +
          "than 1, which is the one thing the inverting configuration can do that this cannot.",
      );
      break;
    }
    case "summing": {
      if (!rin.length) return { ok: false, error: "Give at least one input resistor." };
      if (rin.some((r) => r <= 0)) return { ok: false, error: "Every input resistor must be greater than zero." };
      if (rf <= 0) return { ok: false, error: "The feedback resistor must be greater than zero." };
      for (const r of rin) inputGains.push(-rf / r);
      gain = inputGains[0];
      // Noise gain uses the PARALLEL combination of every input resistor, which
      // is why adding inputs costs bandwidth even when their gains are small.
      const gSum = rin.reduce((s, r) => s + 1 / r, 0);
      noiseGain = 1 + rf * gSum;
      inputResistance = rin[0];
      notes.push(
        `Each input is scaled independently by -Rf/Rin, and the inputs do not interact because the ` +
          "summing junction is a virtual earth. That independence is the entire point of the " +
          "configuration.",
      );
      notes.push(
        `The noise gain is ${noiseGain.toFixed(3)}, computed from the PARALLEL combination of all ` +
          `${rin.length} input resistors. Adding inputs costs bandwidth even when each one's signal ` +
          "gain is small — a surprise when a mixer gets more channels.",
      );
      break;
    }
    case "difference": {
      if (!rin.length || rin[0] <= 0) return { ok: false, error: "The input resistor must be greater than zero." };
      if (rf <= 0) return { ok: false, error: "The feedback resistor must be greater than zero." };
      gain = rf / rin[0];
      noiseGain = 1 + rf / rin[0];
      inputResistance = rin[0];
      notes.push(
        "This assumes the two resistor pairs are matched. COMMON-MODE REJECTION DEPENDS ENTIRELY " +
          "ON THAT MATCHING, not on the op-amp: with 1% resistors the CMRR is limited to about " +
          "46 dB however good the amplifier is. That is why instrumentation amplifiers exist as " +
          "single parts with trimmed networks.",
      );
      break;
    }
    case "integrator": {
      const c = inp.c ?? 0;
      if (!rin.length || rin[0] <= 0) return { ok: false, error: "The input resistor must be greater than zero." };
      if (!Number.isFinite(c) || c <= 0) return { ok: false, error: "The capacitor must be greater than zero." };
      const rc = rin[0] * c;
      cornerFrequency = 1 / (2 * Math.PI * rc);
      gain = -1; // frequency dependent; the corner is the meaningful number
      noiseGain = 1;
      inputResistance = rin[0];
      notes.push(
        `The transfer function is -1/(sRC) with RC = ${rc.toExponential(3)} s, so the gain is 1 at ` +
          `${cornerFrequency.toExponential(3)} Hz and falls at 20 dB per decade above it.`,
      );
      notes.push(
        "AN IDEAL INTEGRATOR SATURATES. With no DC feedback path the input offset voltage and bias " +
          "current are integrated for ever, and the output sits at a rail within seconds. Every " +
          "working integrator has a resistor across the capacitor to bound the DC gain — which " +
          "makes it a low-pass filter that integrates only above its corner. If your circuit has " +
          "no such resistor, it does not work.",
      );
      break;
    }
    case "differentiator": {
      const c = inp.c ?? 0;
      if (rf <= 0) return { ok: false, error: "The feedback resistor must be greater than zero." };
      if (!Number.isFinite(c) || c <= 0) return { ok: false, error: "The capacitor must be greater than zero." };
      const rc = rf * c;
      cornerFrequency = 1 / (2 * Math.PI * rc);
      gain = -1;
      noiseGain = 1;
      inputResistance = Infinity;
      notes.push(
        `The transfer function is -sRC with RC = ${rc.toExponential(3)} s, so the gain is 1 at ` +
          `${cornerFrequency.toExponential(3)} Hz and RISES at 20 dB per decade above it.`,
      );
      notes.push(
        "A DIFFERENTIATOR AMPLIFIES NOISE AND IS PRONE TO OSCILLATION, because its gain rises with " +
          "frequency without limit while the op-amp's own gain is falling — the two cross with " +
          "enough phase shift to be unstable. Real differentiators always add a series resistor " +
          "with the capacitor to stop the gain rising past a chosen frequency. Prefer integrating " +
          "somewhere else in the signal chain if you can.",
      );
      break;
    }
  }

  // --- Real limits -------------------------------------------------------
  let bandwidth: number | null = null;
  const gbw = inp.gbw ?? 0;
  if (Number.isFinite(gbw) && gbw > 0) {
    bandwidth = gbw / noiseGain;
    notes.push(
      `Closed-loop bandwidth = GBW / noise gain = ${gbw.toExponential(3)} / ${noiseGain.toFixed(3)} ` +
        `= ${bandwidth.toExponential(3)} Hz. Gain and bandwidth trade one for one: this is why a ` +
        "high-gain stage is often split into two lower-gain stages, which gives more total " +
        "bandwidth for the same overall gain.",
    );
  }

  let fullPowerBandwidth: number | null = null;
  const sr = inp.slewRate ?? 0;
  const vout = inp.vout ?? 0;
  if (Number.isFinite(sr) && sr > 0 && Number.isFinite(vout) && vout > 0) {
    // Slew rate in V/us; a sine of peak Vp needs 2*pi*f*Vp V/s at the zero crossing.
    fullPowerBandwidth = (sr * 1e6) / (2 * Math.PI * vout);
    notes.push(
      `Full-power bandwidth = SR / (2*pi*Vpeak) = ${fullPowerBandwidth.toExponential(3)} Hz for a ` +
        `${vout} V peak output. Above this the output cannot follow a full-scale sine at all and ` +
        "becomes a triangle wave — SLEW LIMITING, which is a large-signal effect and is NOT the " +
        "same as running out of small-signal bandwidth.",
    );
    if (bandwidth !== null && fullPowerBandwidth < bandwidth) {
      notes.push(
        `The full-power bandwidth (${fullPowerBandwidth.toExponential(2)} Hz) is BELOW the ` +
          `small-signal bandwidth (${bandwidth.toExponential(2)} Hz), so slew rate is what actually ` +
          "limits this stage at full output, not the gain-bandwidth product. Small-signal " +
          "measurements will not reveal it.",
      );
    }
  }

  const vs = inp.vsupply ?? 0;
  if (Number.isFinite(vs) && vs > 0 && Number.isFinite(vout) && vout > 0 && vout > vs) {
    notes.push(
      `The requested ${vout} V output exceeds the ${vs} V supply, so the output CLIPS. Even a ` +
        "rail-to-rail part cannot exceed its rails, and most op-amps stop a volt or two short.",
    );
  }

  return {
    ok: true,
    config: inp.config,
    gain,
    noiseGain,
    inputResistance,
    bandwidth,
    fullPowerBandwidth,
    cornerFrequency,
    inputGains,
    notes,
  };
}
