// Audio engineering — quantisation, decibels, acoustics, and the loudspeaker
// arithmetic that sits between a datasheet and a room.
//
// WHAT IS NOT HERE, AND WHY. There is no absorption-coefficient table, no
// Thiele-Small parameter library and no psychoacoustic masking model. The first
// two are measured properties of a material and a driver — they belong on the
// datasheet the user is reading, and a table typed from recollection would be
// unverifiable in the third digit, which is the steam-table refusal in
// thermo.ts applied again. Masking models are large fitted datasets, not
// formulas, and cannot honestly be reimplemented from a description.
//
// THE DECIBEL IS THE TRAP THIS MODULE EXISTS TO DEFUSE. Every quantity here is
// logarithmic, and the single most common error in the whole subject is using
// 20·log₁₀ where 10·log₁₀ belongs or the reverse. The rule is not a convention
// to memorise: 10·log₁₀ applies to POWER-like quantities (watts, intensity,
// energy) and 20·log₁₀ to FIELD-like ones (volts, pressure, amplitude), because
// power goes as the square of a field. Getting it wrong doubles or halves every
// figure downstream, and the wrong answer looks entirely plausible.

import { designFilter } from "./filter";
import { readNumberList, decimalCommaNote } from "./numberList";
import { linearAxis, decadeLabel, fmtValue, MINUS } from "./axis";

export interface AudioError {
  ok: false;
  error: string;
}

/** Speed of sound in air at 20 °C, m/s. Varies ~0.6 m/s per °C — see notes. */
export const SPEED_OF_SOUND_20C = 343;

/** Reference sound pressure for dB SPL, Pa (20 µPa, the nominal hearing threshold). */
export const P_REF_SPL = 20e-6;

/** 20·log₁₀(2): the dB worth of one bit (the "6.02" of the rule of thumb), exact. */
export const DB_PER_BIT = 20 * Math.log10(2);

/** 10·log₁₀(3/2): full-scale sine against uniform quantisation error (the "1.76"), exact. */
export const SINE_QUANT_DB = 10 * Math.log10(1.5);

function finitePositive(pairs: [string, number][]): AudioError | null {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  return null;
}

// --- Quantisation ------------------------------------------------------------

export interface QuantisationResult {
  ok: true;
  bits: number;
  /** Theoretical SNR of an ideal quantiser, dB: 20·log₁₀(2)·n + 10·log₁₀(3/2) (≈ 6.02n + 1.76). */
  snrDb: number;
  /** Number of representable levels. */
  levels: number;
  /** Least significant bit as a fraction of full scale. */
  lsbFraction: number;
  /** LSB in volts, when a full-scale voltage is given. */
  lsbVolts: number | null;
  /** Uncompressed rate for the given channels and sample rate, bit/s. */
  bitRate: number | null;
  notes: string[];
}

/**
 * Quantisation SNR and dynamic range.
 *
 * SNR = 6.02n + 1.76 dB, and the two terms mean different things. The 6.02 per
 * bit is 20·log₁₀(2) — each bit halves the quantisation step, and the step is a
 * voltage, so it is the field form. The 1.76 dB is 10·log₁₀(3/2), which comes
 * from comparing a full-scale SINE's power to the power of a uniformly
 * distributed quantisation error. It is not a fudge factor and it is not
 * optional: quoting 6.02n alone understates every converter by 1.76 dB.
 *
 * THE FIGURE ASSUMES A FULL-SCALE SIGNAL. A recording peaking 12 dB below full
 * scale has 12 dB less SNR than the number here, which is why headroom is not
 * free and why 24-bit exists for tracking rather than for delivery.
 */
export function quantisation(
  bits: number,
  fullScaleVolts?: number,
  sampleRateHz?: number,
  channels?: number,
): QuantisationResult | AudioError {
  if (!Number.isFinite(bits) || bits < 1 || bits > 64 || !Number.isInteger(bits)) {
    return { ok: false, error: "Bit depth must be a whole number from 1 to 64." };
  }
  const levels = Math.pow(2, bits);
  // EXACT constants, not the rounded 6.02/1.76 rule of thumb: the rounded form
  // reads 98.08 dB at 16 bits against the true 98.09, and 146.24 against
  // 146.26 at 24 bits (brief A1-5).
  const snrDb = DB_PER_BIT * bits + SINE_QUANT_DB;
  const lsbFraction = 1 / levels;

  let lsbVolts: number | null = null;
  if (fullScaleVolts !== undefined) {
    const bad = finitePositive([["full-scale voltage", fullScaleVolts]]);
    if (bad) return bad;
    lsbVolts = fullScaleVolts / levels;
  }

  let bitRate: number | null = null;
  const notes: string[] = [
    "SNR = 20·log₁₀(2)·n + 10·log₁₀(3/2) dB, computed with the exact constants. The familiar " +
      "6.02n + 1.76 is the same rule ROUNDED (it reads 98.08 dB at 16 bits against the exact " +
      "98.09). The 6.02 per bit is 20·log₁₀(2) — a bit halves the quantisation step, which is " +
      "a voltage. The 1.76 dB is 10·log₁₀(3/2), from a full-scale sine's power against " +
      "uniformly distributed quantisation error; dropping it understates every converter.",
    "This assumes a FULL-SCALE signal. Recording 12 dB below full scale gives 12 dB less SNR " +
      "than the figure above, which is the whole reason 24-bit is used for tracking rather " +
      "than for delivery.",
    "An ideal quantiser is assumed: no dither, no converter noise, perfect linearity. A real " +
      "converter's datasheet SNR is always lower, and the gap is the part worth asking about.",
  ];
  if (sampleRateHz !== undefined || channels !== undefined) {
    const ch = channels ?? 2;
    const fs = sampleRateHz ?? 44100;
    const bad = finitePositive([["sample rate", fs], ["channel count", ch]]);
    if (bad) return bad;
    if (!Number.isInteger(ch) || ch > 128) {
      return { ok: false, error: "Channel count must be a whole number, at most 128." };
    }
    bitRate = bits * fs * ch;
  }
  if (bits >= 24) {
    notes.push(
      "At 24 bits the theoretical floor is below the self-noise of any analogue front end and " +
        "below the noise of the room itself, so the extra bits buy headroom for editing rather " +
        "than audible resolution at playback.",
    );
  }
  return { ok: true, bits, snrDb, levels, lsbFraction, lsbVolts, bitRate, notes };
}

// --- Decibels ----------------------------------------------------------------

export type DbQuantity = "power" | "field";

export interface DbResult {
  ok: true;
  /** The ratio expressed in dB. */
  db: number;
  /** The linear ratio the dB value represents. */
  ratio: number;
  quantity: DbQuantity;
  /** The same ratio read the OTHER way, to make the error visible. */
  dbIfOtherConvention: number;
  notes: string[];
}

/**
 * Converts a linear ratio to decibels, or back, on the stated basis.
 *
 * BOTH READINGS ARE REPORTED, always. The 10-versus-20 confusion is the single
 * commonest error in audio arithmetic, and a tool that silently picks one has
 * no way of telling the user they picked wrong. Showing what the same number
 * would be under the other convention makes the mistake visible instead.
 */
export function toDb(ratio: number, quantity: DbQuantity): DbResult | AudioError {
  const bad = finitePositive([["ratio", ratio]]);
  if (bad) return bad;
  const factor = quantity === "power" ? 10 : 20;
  const other = quantity === "power" ? 20 : 10;
  return {
    ok: true,
    db: factor * Math.log10(ratio),
    ratio,
    quantity,
    dbIfOtherConvention: other * Math.log10(ratio),
    notes: [
      quantity === "power"
        ? "POWER basis (10·log₁₀): watts, intensity, energy. Doubling the power is +3.01 dB."
        : "FIELD basis (20·log₁₀): volts, sound pressure, amplitude. Doubling the voltage is " +
          "+6.02 dB, because power goes as the square of a field.",
      "The other convention would give the value shown beside it. If that is the number you " +
        "expected, the basis is wrong rather than the arithmetic.",
    ],
  };
}

/** Converts a dB value back to a linear ratio on the stated basis. */
export function fromDb(db: number, quantity: DbQuantity): DbResult | AudioError {
  if (!Number.isFinite(db)) return { ok: false, error: "The dB value must be a finite number." };
  const factor = quantity === "power" ? 10 : 20;
  const ratio = Math.pow(10, db / factor);
  const r = toDb(ratio, quantity);
  return r;
}

export interface SplResult {
  ok: true;
  /** Level at the reference distance, dB SPL. */
  levelDb: number;
  /** Level at the target distance, dB SPL. */
  atDistanceDb: number;
  /** Change from moving between the two distances, dB. */
  changeDb: number;
  /** Sound pressure at the target distance, Pa. */
  pressurePa: number;
  notes: string[];
}

/**
 * Sound pressure level at a distance, by the inverse-square law.
 *
 * SIX DECIBELS PER DOUBLING OF DISTANCE, not three. Intensity falls as 1/r²
 * (a power quantity, 10·log₁₀ → −6.02 dB per doubling), and pressure falls as
 * 1/r (a field quantity, 20·log₁₀ → the same −6.02 dB). The two agree, which is
 * the useful check that the conventions have been applied consistently.
 *
 * FREE FIELD ONLY. Indoors, past the critical distance the reverberant field
 * dominates and the level stops falling with distance altogether — which is why
 * this calculation over-predicts the benefit of stepping back in a real room.
 */
export function splAtDistance(
  levelDb: number,
  refDistance: number,
  targetDistance: number,
): SplResult | AudioError {
  if (!Number.isFinite(levelDb)) return { ok: false, error: "The level must be a finite number of dB." };
  const bad = finitePositive([
    ["reference distance", refDistance],
    ["target distance", targetDistance],
  ]);
  if (bad) return bad;
  const changeDb = -20 * Math.log10(targetDistance / refDistance);
  const atDistanceDb = levelDb + changeDb;
  const pressurePa = P_REF_SPL * Math.pow(10, atDistanceDb / 20);
  return {
    ok: true,
    levelDb,
    atDistanceDb,
    changeDb,
    pressurePa,
    notes: [
      "Inverse square, free field: −6.02 dB per doubling of distance. Intensity falls as 1/r² " +
        "and pressure as 1/r, and because one is a power quantity and the other a field " +
        "quantity the two give the same decibel figure — a useful consistency check.",
      "FREE FIELD ONLY. Indoors, beyond the critical distance the reverberant field dominates " +
        "and the level stops falling, so this over-predicts how much quieter it gets by " +
        "stepping back.",
      `Reference: 0 dB SPL is ${fmtNum(P_REF_SPL * 1e6)} µPa, the nominal threshold of hearing.`,
    ],
  };
}

export interface SourceSumResult {
  ok: true;
  /** Combined level of incoherent sources, dB. */
  totalDb: number;
  /** Increase over the loudest single source, dB. */
  aboveLoudestDb: number;
  notes: string[];
}

/**
 * Sums INCOHERENT sources (the usual case: separate machines, separate voices).
 *
 * TWO IDENTICAL SOURCES GIVE +3 dB, NOT +6. Incoherent sources add in POWER, so
 * doubling the number is 10·log₁₀(2) = 3.01 dB. The +6 dB figure is for
 * COHERENT addition — the same signal in phase, as from a split feed — and
 * using it here is the classic overestimate. Ten identical machines are +10 dB,
 * not +60.
 */
export function sumIncoherent(levelsDb: number[]): SourceSumResult | AudioError {
  if (!levelsDb.length) return { ok: false, error: "Give at least one level." };
  if (levelsDb.some((l) => !Number.isFinite(l))) {
    return { ok: false, error: "Every level must be a finite number of dB." };
  }
  if (levelsDb.length > 1000) return { ok: false, error: "That is more sources than this models." };
  const total = 10 * Math.log10(levelsDb.reduce((s, l) => s + Math.pow(10, l / 10), 0));
  const loudest = Math.max(...levelsDb);
  return {
    ok: true,
    totalDb: total,
    aboveLoudestDb: total - loudest,
    notes: [
      "Incoherent sources add in POWER: two identical sources are +3.01 dB, ten are +10 dB. " +
        "The +6 dB figure applies to COHERENT addition (the same signal in phase) and using it " +
        "here overstates the result badly.",
      "A source 10 dB below another contributes about 0.4 dB to the total — which is why the " +
        "loudest item dominates and quieting anything else first is usually wasted effort.",
    ],
  };
}

// --- Room acoustics ----------------------------------------------------------

export interface ReverbResult {
  ok: true;
  /** Sabine reverberation time, s. */
  sabineS: number;
  /** Eyring reverberation time, s — the correction for absorbent rooms. */
  eyringS: number;
  /** Average absorption coefficient across the surfaces. */
  averageAbsorption: number;
  /** Total absorption, m² sabins. */
  totalAbsorption: number;
  /** Schroeder frequency: above it the room is statistical, below it modal. */
  schroederHz: number;
  /** Critical distance in this room for the stated directivity Q, m (0.057·√(QV/T) form). */
  criticalDistance: number;
  /** The same from first principles, √(Q·A/16π) with A = S·ᾱ, m. 0.057 rounds √(0.161/16π) = 0.0566. */
  criticalDistanceExact: number;
  /** Directivity factor Q used for the critical distance (1 = omnidirectional). */
  directivityQ: number;
  notes: string[];
}

/**
 * Reverberation time from room volume, surface area and absorption.
 *
 * SABINE OVER-PREDICTS IN AN ABSORBENT ROOM, and that is not a rounding
 * difference. Sabine's formula never reaches zero however absorbent the
 * surfaces are — set every surface to a perfect absorber and it still returns a
 * finite reverberation time, which is physically impossible. Eyring's form
 * fixes exactly that by using −ln(1−ᾱ) in place of ᾱ, and the two agree closely
 * only while ᾱ is small (below about 0.2). Both are reported so the divergence
 * is visible rather than hidden behind a choice made for the user.
 *
 * ABSORPTION COEFFICIENTS ARE AN INPUT. They vary by material, by mounting and
 * strongly by frequency band, so a single built-in table would be wrong in most
 * rooms and unverifiable in all of them.
 */
export function reverbTime(
  volumeM3: number,
  surfaceAreaM2: number,
  averageAbsorption: number,
  directivityQ = 1,
): ReverbResult | AudioError {
  const bad = finitePositive([
    ["room volume", volumeM3],
    ["total surface area", surfaceAreaM2],
    ["directivity factor Q", directivityQ],
  ]);
  if (bad) return bad;
  if (directivityQ > 1000) {
    return { ok: false, error: "A directivity factor Q above 1000 is beyond any real source; Q is typically 1–10 for a loudspeaker." };
  }
  if (!Number.isFinite(averageAbsorption) || averageAbsorption <= 0 || averageAbsorption >= 1) {
    return {
      ok: false,
      error:
        "The average absorption coefficient must be between 0 and 1 (exclusive). A value of 1 " +
        "means every surface is a perfect absorber, which has no reverberation to compute.",
    };
  }
  const totalAbsorption = surfaceAreaM2 * averageAbsorption;
  const sabineS = (0.161 * volumeM3) / totalAbsorption;
  const eyringS = (0.161 * volumeM3) / (-surfaceAreaM2 * Math.log(1 - averageAbsorption));
  const schroederHz = 2000 * Math.sqrt(sabineS / volumeM3);
  // Critical distance where direct and reverberant fields are equal:
  // 0.057·sqrt(Q·V/RT60). Q = 1 is an omnidirectional source; it was hard-wired
  // and undisclosed before v2.140.0 (brief A1-3), which understated Dc by √Q
  // for every loudspeaker.
  const criticalDistance = 0.057 * Math.sqrt((directivityQ * volumeM3) / sabineS);
  const criticalDistanceExact = Math.sqrt((directivityQ * totalAbsorption) / (16 * Math.PI));

  const notes: string[] = [
    "Sabine and Eyring are both shown because they diverge as the room gets more absorbent. " +
      "Sabine never reaches zero however absorbent the surfaces are, which is impossible; " +
      "Eyring's −ln(1−ᾱ) fixes that. They agree closely only below about ᾱ = 0.2.",
    "Absorption coefficients are MEASURED properties of a material and its mounting, and vary " +
      "strongly with frequency. Use the per-band figures from the manufacturer and run this " +
      "once per band; a single average hides exactly the bass problem most rooms have.",
    `Below the Schroeder frequency (${schroederHz.toFixed(0)} Hz here) the room behaves as ` +
      "discrete modes rather than a diffuse field, and reverberation time stops being the " +
      "right description at all.",
    directivityQ === 1
      ? `Critical distance ${criticalDistance.toFixed(3)} m uses directivity Q = 1, which is an ` +
        "OMNIDIRECTIONAL source. A loudspeaker is directional (Q ≈ 2–10 on axis), and its " +
        "critical distance is √Q times larger — ×1.41 at Q = 2. Enter the source's Q."
      : `Critical distance ${criticalDistance.toFixed(3)} m uses directivity Q = ${fmtNum(directivityQ)}: ` +
        `√Q = ${Math.sqrt(directivityQ).toFixed(3)} times the omnidirectional value, on the ` +
        "source's axis only. Off axis Q is smaller and so is the critical distance.",
    "Dc = 0.057·√(QV/T₆₀). The 0.057 rounds √(0.161/16π) = 0.0566; the first-principles form " +
      `√(QA/16π) gives ${criticalDistanceExact.toFixed(3)} m here.`,
  ];
  if (averageAbsorption > 0.2) {
    notes.push(
      `At ᾱ = ${averageAbsorption.toFixed(2)} the two formulas differ by ` +
        `${(((sabineS - eyringS) / eyringS) * 100).toFixed(0)}% — use Eyring.`,
    );
  }
  return {
    ok: true,
    sabineS,
    eyringS,
    averageAbsorption,
    totalAbsorption,
    schroederHz,
    criticalDistance,
    criticalDistanceExact,
    directivityQ,
    notes,
  };
}

export interface RoomMode {
  frequency: number;
  /** Mode order (nx, ny, nz). */
  order: [number, number, number];
  kind: "axial" | "tangential" | "oblique";
}

export interface RoomModeResult {
  ok: true;
  modes: RoomMode[];
  notes: string[];
}

/**
 * Room modes from the dimensions, by the rectangular-room formula.
 *
 * AXIAL MODES MATTER MOST — they involve one pair of parallel surfaces and
 * carry roughly twice the energy of tangential and four times that of oblique
 * modes, so they are the ones heard as boom or suckout. The list is labelled by
 * kind rather than merged, because treating an oblique mode as equally
 * important is how absorption ends up in the wrong place.
 *
 * A RECTANGULAR ROOM WITH RIGID WALLS is assumed. A real room with a bay
 * window, a soffit or an open doorway does not have these modes exactly, and
 * anything below the Schroeder frequency is where the error shows.
 */
export function roomModes(
  lengthM: number,
  widthM: number,
  heightM: number,
  maxFreqHz = 300,
  speedOfSound = SPEED_OF_SOUND_20C,
): RoomModeResult | AudioError {
  const bad = finitePositive([
    ["length", lengthM],
    ["width", widthM],
    ["height", heightM],
    ["speed of sound", speedOfSound],
  ]);
  if (bad) return bad;
  if (!Number.isFinite(maxFreqHz) || maxFreqHz <= 0 || maxFreqHz > 2000) {
    return { ok: false, error: "The maximum frequency must be between 0 and 2000 Hz." };
  }
  const dims = [lengthM, widthM, heightM];
  if (dims.some((d) => d > 100)) return { ok: false, error: "Those dimensions are larger than a room." };

  const modes: RoomMode[] = [];
  // Bounded explicitly: the order needed to reach maxFreq on the longest axis.
  const nMax = Math.min(12, Math.ceil((2 * maxFreqHz * Math.max(...dims)) / speedOfSound) + 1);
  for (let nx = 0; nx <= nMax; nx++) {
    for (let ny = 0; ny <= nMax; ny++) {
      for (let nz = 0; nz <= nMax; nz++) {
        if (nx === 0 && ny === 0 && nz === 0) continue;
        const f =
          (speedOfSound / 2) *
          Math.sqrt((nx / lengthM) ** 2 + (ny / widthM) ** 2 + (nz / heightM) ** 2);
        if (f > maxFreqHz) continue;
        const nonZero = [nx, ny, nz].filter((n) => n > 0).length;
        modes.push({
          frequency: f,
          order: [nx, ny, nz],
          kind: nonZero === 1 ? "axial" : nonZero === 2 ? "tangential" : "oblique",
        });
      }
    }
  }
  modes.sort((a, b) => a.frequency - b.frequency);

  const axial = modes.filter((m) => m.kind === "axial");
  const notes = [
    "Axial modes (one pair of walls) carry about twice the energy of tangential and four times " +
      "that of oblique, so they are what is actually heard as boom or suckout. They are " +
      "labelled rather than merged for that reason.",
    "A rectangular room with rigid walls is assumed. A bay window, a soffit or an open door " +
      "changes this, and the error is worst exactly where it matters — at low frequency.",
    "Evenly spaced modes are the goal; a cluster means a peak at that frequency and a gap " +
      "means a null. Room RATIOS matter more than absolute size for that reason.",
  ];
  if (axial.length >= 2) {
    const spacing = axial.slice(1).map((m, i) => m.frequency - axial[i].frequency);
    const worst = Math.min(...spacing);
    if (worst < 5) {
      notes.push(
        `Two axial modes sit within ${worst.toFixed(1)} Hz of each other — that pairing will ` +
          "read as a pronounced peak.",
      );
    }
  }
  return { ok: true, modes, notes };
}

// --- Delay and comb filtering ------------------------------------------------

export interface CombResult {
  ok: true;
  delayMs: number;
  /** Path-length difference producing that delay, m. */
  pathDifferenceM: number;
  /** First cancellation frequency, Hz. */
  firstNotchHz: number;
  /** The first few notch frequencies, Hz. */
  notches: number[];
  /** The first few reinforcement frequencies, Hz. */
  peaks: number[];
  notes: string[];
}

/**
 * Comb filtering from a delayed copy of a signal.
 *
 * THIS IS WHY A STRAY REFLECTION SOUNDS LIKE AN EQ CHANGE. A delay of t seconds
 * cancels at 1/(2t) and at every odd multiple of it, and reinforces at every
 * multiple of 1/t — a whole series of notches and peaks across the spectrum,
 * not a single dip. A 1 ms delay notches at 500 Hz, 1500 Hz, 2500 Hz and so on.
 * No amount of equalisation fixes it, because the cause is arrival time rather
 * than frequency response.
 */
export function combFilter(
  delayMs?: number,
  pathDifferenceM?: number,
  speedOfSound = SPEED_OF_SOUND_20C,
): CombResult | AudioError {
  const bad = finitePositive([["speed of sound", speedOfSound]]);
  if (bad) return bad;
  if ((delayMs === undefined) === (pathDifferenceM === undefined)) {
    return { ok: false, error: "Give either a delay in milliseconds or a path-length difference in metres." };
  }
  let ms: number;
  let path: number;
  if (delayMs !== undefined) {
    const b = finitePositive([["delay", delayMs]]);
    if (b) return b;
    ms = delayMs;
    path = (delayMs / 1000) * speedOfSound;
  } else {
    const b = finitePositive([["path difference", pathDifferenceM!]]);
    if (b) return b;
    path = pathDifferenceM!;
    ms = (path / speedOfSound) * 1000;
  }
  const t = ms / 1000;
  const first = 1 / (2 * t);
  const notches: number[] = [];
  const peaks: number[] = [];
  for (let k = 0; k < 5; k++) {
    notches.push(first * (2 * k + 1));
    peaks.push((1 / t) * (k + 1));
  }
  return {
    ok: true,
    delayMs: ms,
    pathDifferenceM: path,
    firstNotchHz: first,
    notches,
    peaks,
    notes: [
      "A delayed copy cancels at 1/(2t) and every ODD multiple, and reinforces at every " +
        "multiple of 1/t — a comb across the whole spectrum, not one dip.",
      "Equalisation cannot fix this. The cause is arrival TIME, so the cure is moving the " +
        "microphone or the surface, or absorbing the reflection.",
      `Speed of sound taken as ${fmtNum(speedOfSound)} m/s (dry air, about 20 °C). It rises roughly ` +
        "0.6 m/s per °C, which shifts every frequency here by about 0.2% per degree.",
    ],
  };
}

// =============================================================================
// v2.140.0 — levels and references, level arithmetic, frequency weighting,
// dither, file size, loudspeakers, room absorption, passive crossovers and
// speaker cable. Brief: docs/SCOPE-AUDIO-VIDEO-2026-10.md §B1.
//
// A DECIBEL IS NEVER A UNIT here. Every level is a bare number whose reference
// is NAMED by a select (dBu, dBV, dB SPL …), and every combination of levels
// goes through power or pressure — never through the dB values themselves.
// =============================================================================

const fail = (error: string): AudioError => ({ ok: false, error });

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
};

/** An integer exponent as superscript: −4 → "⁻⁴". */
export function superscript(n: number): string {
  return String(n).replace(/./g, (c) => SUPERSCRIPT[c] ?? c);
}

/**
 * A number for display in a note or a label: at most `sig` significant figures
 * with float noise removed (16.4 ft = 4.99872 m, never 4.998720000000001),
 * U+2212 for a minus, and "× 10ⁿ" outside 10⁻⁴ … 10¹². Never "1e-7".
 */
export function fmtNum(v: number, sig = 10): string {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : v < 0 ? "−∞" : "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e-4 && a < 1e12) return sign + String(Number(a.toPrecision(sig)));
  const [m, e] = a.toExponential(sig - 1).split("e");
  return `${sign}${String(Number(m))} × 10${superscript(Number(e))}`;
}

// --- Figure data. The engine describes; the integrator draws. -----------------

export interface FigurePoint {
  x: number;
  y: number;
}

export interface FigureSeries {
  label: string;
  points: FigurePoint[];
  style?: "solid" | "dashed" | "faint";
}

/** A reference line or a marked input: axis "x" is vertical at x = at, "y" horizontal at y = at. */
export interface FigureMarker {
  axis: "x" | "y";
  at: number;
  label: string;
}

export interface FigureBar {
  label: string;
  value: number;
}

/** One scale of a level ladder: tick positions are on the ladder's common axis. */
export interface LadderScale {
  name: string;
  ticks: { at: number; label: string }[];
}

export interface AudioFigure {
  kind: "line" | "bar" | "ladder";
  title: string;
  xLabel: string;
  yLabel: string;
  xLog?: boolean;
  yLog?: boolean;
  series?: FigureSeries[];
  bars?: FigureBar[];
  /** Ladder kind: the scales drawn side by side on one axis (yLabel names it). */
  ladder?: LadderScale[];
  /** The common-axis range of a ladder. */
  range?: [number, number];
  markers?: FigureMarker[];
  /** Said on the figure when a value had to be clamped to draw (a null is −∞ dB). */
  note?: string;
}

/** Points per figure curve. Fixed, so a figure costs the same whatever was typed. */
export const FIGURE_POINTS = 121;

/** Log-spaced values from lo to hi inclusive (lo, hi > 0). */
export function logSpace(lo: number, hi: number, n = FIGURE_POINTS): number[] {
  const a = Math.log10(lo);
  const b = Math.log10(hi);
  const m = Math.max(2, Math.min(n, 2000));
  return Array.from({ length: m }, (_, i) => Math.pow(10, a + ((b - a) * i) / (m - 1)));
}

/** A figure never carries NaN or ±∞. */
function finitePoints(pts: FigurePoint[]): FigurePoint[] {
  return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Largest list any level tool accepts. Bounds time as well as memory. */
export const MAX_LIST = 10000;

function finiteAll(name: string, xs: number[]): AudioError | null {
  if (xs.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
    return fail(`Every ${name} must be a finite number.`);
  }
  return null;
}

// --- List parsers (the pane only calls these; brief E10) ----------------------

function normaliseMinus(text: string): string {
  return text.replace(/[−‒–]/g, "-");
}

/** A parsed typed list, with the note the pane must show when a decimal comma was read. */
export interface ParsedList<T> {
  ok: true;
  values: T[];
  /** "" or e.g. "1 decimal comma read as decimal (80,5 → 80.5)." — never read silently. */
  note: string;
  /** Level lists only: the reference every value is in ("dBu", "dB(A)" …), or null when none was typed. */
  reference?: string | null;
}

/** The decibel references a typed level can carry, longest spelling first. */
const LEVEL_REF_RE = /dB\s*\(\s*([ACZ])\s*\)|dB\s*SPL\b|dBFS\b|dBu\b|dBV\b|dBm\b|dB([ACZ])\b|dB\b/gi;

function levelRefLabel(m: string, w1?: string, w2?: string): string | null {
  const w = (w1 ?? w2)?.toUpperCase();
  if (w) return `dB(${w})`;
  const s = m.replace(/\s+/g, "").toLowerCase();
  if (s === "dbspl") return "dB SPL";
  if (s === "dbfs") return "dBFS";
  if (s === "dbu") return "dBu";
  if (s === "dbv") return "dBV";
  if (s === "dbm") return "dBm (600 Ω)";
  return null; // plain "dB": no reference stated
}

/** Which references can be combined: electrical levels convert; SPL is unweighted (Z). */
function levelRefClass(ref: string): string {
  if (ref === "dBu" || ref === "dBV" || ref === "dBm (600 Ω)") return "electrical";
  if (ref === "dB SPL" || ref === "dB(Z)") return "unweighted";
  return ref;
}

const toDbuFrom = (v: number, ref: string): number => (ref === "dBV" ? v - DBU_TO_DBV : v);
const fromDbuTo = (u: number, ref: string): number => (ref === "dBV" ? u + DBU_TO_DBV : u);

/**
 * Reads a list of levels in dB: "80, 80, 74", "80 80 74", "80;80;74", one per
 * line, "80 dB, 80 dB". The comma follows the product-wide rule
 * (numberList.ts readNumberList): ", " always separates; "80,5; 79,2" is
 * read as 80.5 and 79.2 and SAID in the note.
 *
 * REFERENCES ARE NEVER STRIPPED SILENTLY. One reference in the list ("80 dB(A),
 * 74 dB(A)") → every value is read in it, and the note says so. Mixed
 * ELECTRICAL references (dBu, dBV, dBm 600 Ω) are CONVERTED to the first one's
 * and the conversion is said ("0 dBu, 0 dBV" → 0 and +2.2185 dBu). Mixed
 * weightings (A, C, Z), or dBFS with an analogue level, are refused by name:
 * they are different measurements, not one quantity in two units.
 */
export function parseLevelList(text: string): ParsedList<number> | AudioError {
  if (typeof text !== "string" || !text.trim()) return fail("Give at least one level in dB.");
  if (text.length > 400000) return fail(`At most ${MAX_LIST} levels.`);
  const refs: (string | null)[] = [];
  const MARK = "¦";
  const marked = normaliseMinus(text)
    .replace(LEVEL_REF_RE, (m: string, w1?: string, w2?: string) => {
      refs.push(levelRefLabel(m, w1, w2));
      return ` ${MARK} `;
    })
    .replace(/(^|[\s,;])\+(?=[\d.])/g, "$1");
  const r = readNumberList(marked.split(MARK).join(";"));
  if (r.dropped.length) {
    return fail(`"${r.dropped[0].trim()}" is not a level in dB. Levels are numbers, e.g. 80, 80, 74.`);
  }
  if (r.values.length === 0) return fail("Give at least one level in dB.");
  if (r.values.length > MAX_LIST) return fail(`At most ${MAX_LIST} levels.`);
  const bad = finiteAll("level", r.values);
  if (bad) return bad;
  const comma = decimalCommaNote(r);
  const named = refs.filter((x): x is string => x !== null);
  const distinct = [...new Set(named)];
  if (distinct.length === 0) return { ok: true, values: r.values, note: comma, reference: null };
  if (distinct.length === 1) {
    return {
      ok: true,
      values: r.values,
      note: [`Every level is read in ${distinct[0]}${named.length < r.values.length ? " (entries without a reference take it)" : ""}.`, comma]
        .filter(Boolean)
        .join(" "),
      reference: distinct[0],
    };
  }
  // Mixed references.
  const classes = [...new Set(distinct.map(levelRefClass))];
  if (classes.length > 1) {
    const weightings = distinct.filter((d) => /^dB\([AC]\)$/.test(d) || levelRefClass(d) === "unweighted");
    if (weightings.length > 1 && classes.every((c) => c !== "electrical" && c !== "dBFS")) {
      return fail(
        `${distinct.join(" and ")} are different frequency weightings — different measurements of the sound, not ` +
          "one level in two units — and cannot be combined. Combine levels of ONE weighting, or weight band levels " +
          "with the weighting tool.",
      );
    }
    if (distinct.includes("dBFS")) {
      return fail(
        `dBFS cannot be combined with ${distinct.filter((d) => d !== "dBFS").join(" / ")}: dBFS is relative to the ` +
          "converter, and only an alignment (EBU R68, SMPTE RP 155) connects it to an analogue level. Convert first " +
          "with Levels & references.",
      );
    }
    return fail(
      `${distinct.join(" and ")} are different kinds of level (electrical, acoustic, weighted) and cannot be combined in one list.`,
    );
  }
  if (classes[0] !== "electrical") {
    // dB SPL with dB(Z): both unweighted sound pressure.
    return {
      ok: true,
      values: r.values,
      note: [`${distinct.join(" and ")} are both unweighted sound pressure levels; read together.`, comma].filter(Boolean).join(" "),
      reference: distinct[0],
    };
  }
  // Mixed electrical references: each value must carry its own, then convert.
  const segs = marked.split(MARK);
  const trailing = segs[segs.length - 1];
  const everyHasOne =
    refs.length === r.values.length &&
    refs.every((x) => x !== null) &&
    !/\d/.test(trailing) &&
    segs.slice(0, -1).every((s) => /\d/.test(s));
  if (!everyHasOne) {
    return fail(
      `This list mixes ${distinct.join(" and ")}; give EVERY level its reference (e.g. 0 dBu, 0 dBV) so each can be ` +
        "converted before they are combined.",
    );
  }
  const target = refs[0] as string;
  const conv: string[] = [];
  const values = r.values.map((v, i) => {
    const ref = refs[i] as string;
    if (ref === target || levelRefClass(ref) !== "electrical") return v;
    const out = fromDbuTo(toDbuFrom(v, ref), target);
    if (conv.length < 8) conv.push(`${fmtNum(v)} ${ref} = ${out >= 0 ? "+" : ""}${out.toFixed(4)} ${target}`);
    return out;
  });
  const dbm = distinct.includes("dBm (600 Ω)") ? " dBm is taken across 600 Ω, where it equals dBu." : "";
  return {
    ok: true,
    values,
    note: [
      `Mixed references converted to ${target} before combining (dBV = dBu − 2.2185 dB): ${conv.join("; ")}${conv.length === 8 ? " …" : ""}.${dbm}`,
      comma,
    ]
      .filter(Boolean)
      .join(" "),
    reference: target,
  };
}

/**
 * Reads a band-frequency list: "63, 125, 250, 500, 1k, 2k, 4k, 8k", with an
 * optional Hz / kHz on any entry ("1 kHz", "31.5 Hz"). "1k" is 1000 Hz. A
 * k-value is written with a point (2.5k); "2,5k" is refused as ambiguous.
 */
export function parseBandList(text: string): ParsedList<number> | AudioError {
  if (typeof text !== "string" || !text.trim()) return fail("Give at least one band frequency.");
  if (text.length > 20000) return fail("At most 200 bands.");
  const p = text
    .replace(/(\d)\s*kHz\b/gi, "$1k")
    .replace(/(\d)\s*Hz\b/gi, "$1")
    .replace(/(\d)\s+k\b/gi, "$1k");
  if (/\d,\d+k\b/i.test(p) && (/[\s;]/.test(p.trim()) || (p.match(/,/g) ?? []).length === 1)) {
    return fail('Write a kilohertz band with a point, e.g. 2.5k; "2,5k" could be one band or two.');
  }
  const expanded = p.replace(/(?<![\d.])(\d+(?:\.\d+)?)k\b/gi, (_m, n: string) => String(Number(n) * 1000));
  const r = readNumberList(expanded);
  if (r.dropped.length) {
    return fail(`"${r.dropped[0].trim()}" is not a band frequency. Write e.g. 63, 125, 1k, 2k (k = ×1000 Hz).`);
  }
  if (r.values.length === 0) return fail("Give at least one band frequency.");
  if (r.values.length > 200) return fail("At most 200 bands.");
  if (r.values.some((f) => !(f > 0))) return fail("A band frequency must be greater than zero.");
  return { ok: true, values: r.values, note: decimalCommaNote(r) };
}

/**
 * Reads a surfaces list for the absorption budget: one "area, α" pair per line
 * or separated by "/": "60, 0.02 / 60, 0.6 / 120, 0.1". Areas in m².
 */
export function parseSurfaceList(text: string): ParsedList<Surface> | AudioError {
  if (typeof text !== "string" || !text.trim()) return fail("Give at least one surface as: area, α.");
  if (text.length > 40000) return fail("At most 200 surfaces.");
  const groups = text.split(/[\/\n\r]+/).map((g) => g.trim()).filter((g) => g.length > 0);
  if (groups.length > 200) return fail("At most 200 surfaces.");
  const out: Surface[] = [];
  const notes: string[] = [];
  for (const g of groups) {
    const r = readNumberList(g.replace(/m²|m\^2|m2\b|sq\.?\s*m\b/gi, " "));
    if (r.dropped.length || r.values.length !== 2) {
      return fail(`"${g}" is not a surface. Write the area in m² and the absorption coefficient, e.g. 60, 0.02.`);
    }
    out.push({ area: r.values[0], alpha: r.values[1] });
    const n = decimalCommaNote(r);
    if (n) notes.push(`"${g}": ${n}`);
  }
  return { ok: true, values: out, note: notes.join(" ") };
}

// --- Levels and references -----------------------------------------------------

/** 0 dBu: 1 mW into 600 Ω, √0.6 V rms. */
export const V_REF_DBU = Math.sqrt(0.6);
/** 0 dB SWL: 1 pW (ISO 1683). */
export const W_REF_SWL = 1e-12;
/** dBV − dBu for the same voltage: 20·log₁₀(√0.6) = −2.2185 dB. */
export const DBU_TO_DBV = 20 * Math.log10(V_REF_DBU);
/** +4 dBu (pro) against −10 dBV (consumer): 11.7815 dB. */
export const PRO_CONSUMER_GAP_DB = 4 + DBU_TO_DBV + 10;
/** RMS of a full-scale sine against a full-scale square: 10·log₁₀2 = 3.0103 dB. */
export const SINE_PEAK_DB = 10 * Math.log10(2);

export type LevelRef =
  | "dBu"
  | "dBV"
  | "dBm600"
  | "Vrms"
  | "dBFS"
  | "dBSPL"
  | "Pa"
  | "dBSWL"
  | "W"
  | "mVPa"
  | "dBVPa";

export type LevelDomain = "voltage" | "pressure" | "power" | "sensitivity";

export const LEVEL_REFS: { id: LevelRef; label: string; linear: boolean; domain: LevelDomain }[] = [
  { id: "dBu", label: "dBu", linear: false, domain: "voltage" },
  { id: "dBV", label: "dBV", linear: false, domain: "voltage" },
  { id: "dBm600", label: "dBm (600 Ω)", linear: false, domain: "voltage" },
  { id: "Vrms", label: "V rms", linear: true, domain: "voltage" },
  { id: "dBFS", label: "dBFS", linear: false, domain: "voltage" },
  { id: "dBSPL", label: "dB SPL", linear: false, domain: "pressure" },
  { id: "Pa", label: "Pa", linear: true, domain: "pressure" },
  { id: "dBSWL", label: "dB SWL (re 1 pW)", linear: false, domain: "power" },
  { id: "W", label: "W (sound power)", linear: true, domain: "power" },
  { id: "mVPa", label: "mV/Pa", linear: true, domain: "sensitivity" },
  { id: "dBVPa", label: "dBV/Pa", linear: false, domain: "sensitivity" },
];

const REF_INFO = new Map(LEVEL_REFS.map((r) => [r.id, r]));

/**
 * dBFS alignment. EBU R68: −18 dBFS = 0 dBu (0 dBFS = +18 dBu). SMPTE RP 155:
 * −20 dBFS = +4 dBu (0 dBFS = +24 dBu). Custom: the dBFS reading that equals a
 * stated dBu.
 */
export type DbfsAlignment = "ebu-r68" | "smpte-rp155" | { dbfs: number; dbu: number };

/**
 * "sine": AES17 — a full-scale sine reads 0 dBFS (RMS). "peak": an RMS reading
 * referenced to full-scale PEAK (a square wave), on which the same sine reads
 * −3.01 dBFS.
 */
export type DbfsConvention = "sine" | "peak";

export interface LevelOptions {
  alignment?: DbfsAlignment;
  convention?: DbfsConvention;
  /** Microphone sensitivity in SI, V/Pa (10 mV/Pa = 0.01) — the only bridge from pressure to voltage. */
  micSensitivityVPerPa?: number;
}

export interface LevelResult {
  ok: true;
  from: LevelRef;
  to: LevelRef;
  input: number;
  /** The value in the `to` reference. */
  value: number;
  /** The value in every reference reachable from the input. */
  all: Partial<Record<LevelRef, number>>;
  /** 0 dBFS in dBu under the alignment, or null when no alignment applies. */
  fullScaleDbu: number | null;
  /** The +4 dBu vs −10 dBV gap, 11.7815 dB, always reported. */
  proConsumerGapDb: number;
  notes: string[];
  figure: AudioFigure;
}

function fullScaleDbuOf(a: DbfsAlignment | undefined): number | null | AudioError {
  if (a === undefined) return null;
  if (a === "ebu-r68") return 18;
  if (a === "smpte-rp155") return 24;
  if (typeof a === "object" && a !== null) {
    if (!Number.isFinite(a.dbfs) || !Number.isFinite(a.dbu)) {
      return fail("A custom alignment needs a finite dBFS reading and the dBu it equals.");
    }
    if (a.dbfs > 0) return fail("An alignment level is at or below full scale: its dBFS reading must be 0 or negative.");
    return a.dbu - a.dbfs;
  }
  return fail("Unknown alignment. Use EBU R68 (−18 dBFS = 0 dBu), SMPTE RP 155 (−20 dBFS = +4 dBu) or a custom pair.");
}

const NO_ALIGNMENT =
  "dBFS is relative to the converter, not to a voltage; choose an alignment (EBU R68: −18 dBFS = 0 dBu; " +
  "SMPTE RP 155: −20 dBFS = +4 dBu) or give a custom one.";

/**
 * Converts a level between references (brief §B1 `audio-levels`).
 *
 * Voltage references (dBu, dBV, dBm 600 Ω, V rms, and dBFS through an
 * alignment) convert among themselves; dB SPL ↔ Pa; dB SWL ↔ W; mV/Pa ↔
 * dBV/Pa. Pressure ↔ voltage only through a stated microphone sensitivity.
 * Sound POWER never converts to pressure here: that needs distance and
 * directivity. A linear value of zero or below is refused — it has no level.
 */
export function levelConvert(
  value: number,
  from: LevelRef,
  to: LevelRef,
  opts: LevelOptions = {},
): LevelResult | AudioError {
  const fi = REF_INFO.get(from);
  const ti = REF_INFO.get(to);
  if (!fi || !ti) return fail("Unknown level reference.");
  if (typeof value !== "number" || !Number.isFinite(value)) return fail("The level must be a finite number.");
  if (fi.linear && value <= 0) {
    return fail(
      `A ${fi.label} value must be greater than zero: zero has no level (it would be −∞ dB) and a ` +
        "negative amplitude is a sign convention, not a level.",
    );
  }
  const convention: DbfsConvention = opts.convention ?? "sine";
  if (convention !== "sine" && convention !== "peak") return fail("The dBFS convention is sine (AES17) or peak.");
  const fs = fullScaleDbuOf(opts.alignment);
  if (fs !== null && typeof fs === "object") return fs;
  const fullScaleDbu = fs as number | null;
  const mic = opts.micSensitivityVPerPa;
  if (mic !== undefined && (!Number.isFinite(mic) || mic <= 0)) {
    return fail("A microphone sensitivity must be greater than zero (in V/Pa: 10 mV/Pa is 0.01 V/Pa).");
  }
  if (mic !== undefined && mic > 100) {
    return fail("A microphone sensitivity above 100 V/Pa is not a microphone; check that it was given in V/Pa, not mV/Pa.");
  }

  if ((from === "dBFS" || to === "dBFS") && from !== to && fullScaleDbu === null) return fail(NO_ALIGNMENT);
  if (from === "dBFS") {
    const max = convention === "sine" ? SINE_PEAK_DB : 0;
    if (value > max + 1e-9) {
      return fail(
        `${fmtNum(value)} dBFS is above full scale. Under the ${convention === "sine" ? "AES17 sine" : "peak"}-referenced ` +
          `convention nothing reads above ${max === 0 ? "0" : "+3.01"} dBFS` +
          (convention === "sine" ? " (a full-scale square wave)." : "."),
      );
    }
  }

  // Domain bridging rules, refused BY NAME.
  const fd = fi.domain;
  const td = ti.domain;
  const linked = (d: LevelDomain): boolean => d === "voltage" || d === "pressure";
  if (fd !== td) {
    if (fd === "power" || td === "power") {
      return fail(
        "Sound POWER (dB SWL, W) and sound PRESSURE or voltage are different quantities. Converting needs the " +
          "distance and the directivity; use the loudspeaker or SPL-at-distance tools.",
      );
    }
    if (fd === "sensitivity" || td === "sensitivity") {
      return fail("A microphone sensitivity (mV/Pa, dBV/Pa) is a RATIO of volts to pascals, not a level; it converts only to its other form.");
    }
    if (linked(fd) && linked(td) && mic === undefined) {
      return fail("dB SPL and an electrical level are connected only by a microphone's sensitivity; give one (e.g. 10 mV/Pa).");
    }
  }

  // To canonical: volts rms, Pa, W or V/Pa.
  let volts: number | null = null;
  let pascals: number | null = null;
  let watts: number | null = null;
  let vPerPa: number | null = null;
  switch (from) {
    case "dBu":
    case "dBm600":
      volts = V_REF_DBU * Math.pow(10, value / 20);
      break;
    case "dBV":
      volts = Math.pow(10, value / 20);
      break;
    case "Vrms":
      volts = value;
      break;
    case "dBFS": {
      const aes = convention === "peak" ? value + SINE_PEAK_DB : value;
      volts = V_REF_DBU * Math.pow(10, ((fullScaleDbu ?? 0) + aes) / 20);
      break;
    }
    case "dBSPL":
      pascals = P_REF_SPL * Math.pow(10, value / 20);
      break;
    case "Pa":
      pascals = value;
      break;
    case "dBSWL":
      watts = W_REF_SWL * Math.pow(10, value / 10);
      break;
    case "W":
      watts = value;
      break;
    case "mVPa":
      vPerPa = value / 1000;
      break;
    case "dBVPa":
      vPerPa = Math.pow(10, value / 20);
      break;
  }
  const s = mic !== undefined ? mic : null;
  if (volts === null && pascals !== null && s !== null) volts = pascals * s;
  if (pascals === null && volts !== null && s !== null) pascals = volts / s;
  for (const v of [volts, pascals, watts, vPerPa]) {
    if (v !== null && (!Number.isFinite(v) || v <= 0)) {
      return fail("That level is outside the range a number can represent (it under- or overflows); check the value.");
    }
  }

  const all: Partial<Record<LevelRef, number>> = {};
  if (volts !== null) {
    const dbu = 20 * Math.log10(volts / V_REF_DBU);
    all.dBu = dbu;
    all.dBV = 20 * Math.log10(volts);
    all.dBm600 = dbu;
    all.Vrms = volts;
    if (fullScaleDbu !== null) {
      const aes = dbu - fullScaleDbu;
      all.dBFS = convention === "peak" ? aes - SINE_PEAK_DB : aes;
    }
  }
  if (pascals !== null) {
    all.Pa = pascals;
    all.dBSPL = 20 * Math.log10(pascals / P_REF_SPL);
  }
  if (watts !== null) {
    all.W = watts;
    all.dBSWL = 10 * Math.log10(watts / W_REF_SWL);
  }
  if (vPerPa !== null) {
    all.mVPa = vPerPa * 1000;
    all.dBVPa = 20 * Math.log10(vPerPa);
  }
  const out = all[to];
  if (out === undefined) return fail(to === "dBFS" ? NO_ALIGNMENT : "That conversion is not defined.");

  const notes: string[] = [];
  if (fd === "voltage" || (fd === "pressure" && volts !== null)) {
    notes.push(
      `0 dBu = √0.6 V = 0.7746 V rms (1 mW into 600 Ω); 0 dBV = 1 V rms. dBV = dBu − ${Math.abs(DBU_TO_DBV).toFixed(4)} dB. ` +
        `Pro +4 dBu sits ${PRO_CONSUMER_GAP_DB.toFixed(4)} dB above consumer −10 dBV.`,
      "dBm (600 Ω) equals dBu numerically ONLY because the load is 600 Ω: dBm is a power, 1 mW, and into any other " +
        "load the same voltage is a different dBm.",
    );
  }
  if (fullScaleDbu !== null && (from === "dBFS" || to === "dBFS" || fd === "voltage")) {
    notes.push(
      `Alignment: 0 dBFS = ${fullScaleDbu >= 0 ? "+" : ""}${fullScaleDbu.toFixed(3)} dBu` +
        (opts.alignment === "ebu-r68"
          ? " (EBU R68: −18 dBFS = 0 dBu)."
          : opts.alignment === "smpte-rp155"
            ? " (SMPTE RP 155: −20 dBFS = +4 dBu)."
            : " (custom alignment).") +
        " The two standards put full scale 6 dB apart (+18 vs +24 dBu); dBFS means nothing analogue without one.",
      convention === "sine"
        ? "dBFS convention: sine-referenced (AES17) — a full-scale sine reads 0 dBFS RMS. A peak-referenced RMS meter " +
          "reads the same sine 3.01 dB lower."
        : "dBFS convention: peak-referenced RMS — a full-scale sine reads −3.01 dBFS. The AES17 (sine-referenced) " +
          "reading of the same signal is 3.01 dB higher.",
    );
    if (all.dBFS !== undefined) {
      const max = convention === "sine" ? SINE_PEAK_DB : 0;
      const d = all.dBFS;
      if (d > max + 1e-9) {
        notes.unshift(
          `${d.toFixed(2)} dBFS is ABOVE full scale (nothing reads above ${convention === "sine" ? "+3.01" : "0"} dBFS ` +
            "under this convention): the converter clips at this level under this alignment.",
        );
      } else if (d > 1e-9) {
        notes.unshift(
          `${d >= 0 ? "+" : ""}${d.toFixed(2)} dBFS is above a full-scale sine (AES17 puts a full-scale sine at 0 dBFS): ` +
            "only a signal with a lower crest factor than a sine (up to a full-scale square wave, +3.01 dBFS) reads " +
            "this high; a sine at this level would not fit in the converter.",
        );
      }
    }
  }
  if (pascals !== null) {
    notes.push(
      `0 dB SPL = 20 µPa (ISO 1683). ${all.dBSPL!.toFixed(4)} dB SPL = ${pascals.toPrecision(6)} Pa = ` +
        `${(pascals * 1e6).toPrecision(6)} µPa.`,
    );
  }
  if (s !== null && (volts !== null && pascals !== null)) {
    notes.push(`Microphone: ${fmtNum(s * 1000)} mV/Pa = ${(20 * Math.log10(s)).toFixed(3)} dBV/Pa bridges pressure and voltage.`);
  }
  if (watts !== null) {
    notes.push("Sound power level is re 1 pW (ISO 1683): 10·log₁₀(W / 10⁻¹² W). It is a property of the source, not of a listening position.");
  }
  if (vPerPa !== null) {
    notes.push("Sensitivity in dBV/Pa = 20·log₁₀(sensitivity in V/Pa): 10 mV/Pa = −40 dBV/Pa.");
  }

  return {
    ok: true,
    from,
    to,
    input: value,
    value: out,
    all,
    fullScaleDbu,
    proConsumerGapDb: PRO_CONSUMER_GAP_DB,
    notes,
    figure: levelLadder(all, fd, fullScaleDbu, convention),
  };
}

function ladderRange(at: number, lo0: number, hi0: number): [number, number, number] {
  const lo = Math.min(lo0, Math.floor((at - 10) / 10) * 10);
  const hi = Math.max(hi0, Math.ceil((at + 10) / 10) * 10);
  const step = Math.max(10, Math.ceil((hi - lo) / 12 / 10) * 10);
  return [lo, hi, step];
}

/**
 * A dB scale of the ladder: label value v sits at position v + offset.
 *
 * Positions come from the shared axis engine (axis.ts) at the ladder's fixed
 * step, so the row is a bounded array and its labels share their decimals;
 * `signed` then adds the explicit "+" a dB ladder reads with (the minus is
 * already U+2212).
 */
function linearTicks(lo: number, hi: number, step: number, offset: number, fmt: (label: string) => string) {
  const row = linearAxis(lo - offset, hi - offset, { step });
  return row.values.map((v, i) => ({ at: v + offset, label: fmt(row.labels[i] + row.multiplier) }));
}

/**
 * The decades of a linear-unit companion scale (V, Pa, W…) placed by `posOf`.
 * One notation per scale: 10ⁿ throughout when the visible decades span three
 * or more (or leave 10⁻³ … 10³), plain digits otherwise — never the old switch
 * from `1000` to `10⁴` in the middle of one scale.
 */
function decadeTicks(lo: number, hi: number, posOf: (v: number) => number, unit: string) {
  const hits: { k: number; at: number }[] = [];
  for (let k = -15; k <= 15; k++) {
    const at = posOf(Math.pow(10, k));
    if (at >= lo - 1e-9 && at <= hi + 1e-9) hits.push({ k, at });
  }
  if (!hits.length) return [];
  const k0 = hits[0].k;
  const k1 = hits[hits.length - 1].k;
  const uniform = k1 - k0 >= 3 || k0 < -3 || k1 > 3;
  return hits.map(({ k, at }) => ({
    at,
    label: `${uniform ? decadeLabel(Math.pow(10, k)) : fmtValue(Math.pow(10, k))} ${unit}`,
  }));
}

/** A dB row label with its explicit sign: "+10", "−20", "0". */
const signed = (label: string): string => (/^[0.]+$/.test(label) || label.startsWith(MINUS) ? label : `+${label}`);

function levelLadder(
  all: Partial<Record<LevelRef, number>>,
  domain: LevelDomain,
  fullScaleDbu: number | null,
  convention: DbfsConvention,
): AudioFigure {
  if (domain === "voltage" || (domain === "pressure" && all.dBu !== undefined && all.dBSPL === undefined)) {
    const at = all.dBu!;
    const [lo, hi, step] = ladderRange(at, -60, 30);
    const scales: LadderScale[] = [
      { name: "dBu", ticks: linearTicks(lo, hi, step, 0, signed) },
      { name: "dBV", ticks: linearTicks(lo, hi, step, -DBU_TO_DBV, signed) },
    ];
    if (fullScaleDbu !== null) {
      const off = fullScaleDbu + (convention === "peak" ? SINE_PEAK_DB : 0);
      scales.push({
        name: convention === "peak" ? "dBFS (peak-ref.)" : "dBFS (AES17)",
        ticks: linearTicks(lo, Math.min(hi, off), step, off, signed),
      });
    }
    scales.push({ name: "V rms", ticks: decadeTicks(lo, hi, (v) => 20 * Math.log10(v / V_REF_DBU), "V") });
    return {
      kind: "ladder",
      title: "Level ladder",
      xLabel: "",
      yLabel: "dBu",
      range: [lo, hi],
      ladder: scales,
      markers: [{ axis: "y", at, label: "entered level" }],
    };
  }
  if (domain === "pressure") {
    const at = all.dBSPL!;
    const [lo, hi, step] = ladderRange(at, 0, 140);
    return {
      kind: "ladder",
      title: "Sound pressure ladder",
      xLabel: "",
      yLabel: "dB SPL",
      range: [lo, hi],
      ladder: [
        { name: "dB SPL", ticks: linearTicks(lo, hi, step, 0, signed) },
        { name: "Pa", ticks: decadeTicks(lo, hi, (p) => 20 * Math.log10(p / P_REF_SPL), "Pa") },
      ],
      markers: [{ axis: "y", at, label: "entered level" }],
    };
  }
  if (domain === "power") {
    const at = all.dBSWL!;
    const [lo, hi, step] = ladderRange(at, 40, 140);
    return {
      kind: "ladder",
      title: "Sound power ladder",
      xLabel: "",
      yLabel: "dB SWL (re 1 pW)",
      range: [lo, hi],
      ladder: [
        { name: "dB SWL", ticks: linearTicks(lo, hi, step, 0, signed) },
        { name: "W", ticks: decadeTicks(lo, hi, (w) => 10 * Math.log10(w / W_REF_SWL), "W") },
      ],
      markers: [{ axis: "y", at, label: "entered level" }],
    };
  }
  const at = all.dBVPa!;
  const [lo, hi, step] = ladderRange(at, -70, 0);
  return {
    kind: "ladder",
    title: "Microphone sensitivity ladder",
    xLabel: "",
    yLabel: "dBV/Pa",
    range: [lo, hi],
    ladder: [
      { name: "dBV/Pa", ticks: linearTicks(lo, hi, step, 0, signed) },
      { name: "mV/Pa", ticks: decadeTicks(lo, hi, (mv) => 20 * Math.log10(mv / 1000), "mV/Pa") },
    ],
    markers: [{ axis: "y", at, label: "entered sensitivity" }],
  };
}

// --- Level arithmetic -------------------------------------------------------------

/** 10·log₁₀ Σ wᵢ·10^(Lᵢ/10), computed relative to the largest level so no term overflows. */
function powerSumDb(levels: number[], weights?: number[]): number {
  const max = Math.max(...levels);
  let s = 0;
  for (let i = 0; i < levels.length; i++) s += (weights ? weights[i] : 1) * Math.pow(10, (levels[i] - max) / 10);
  return max + 10 * Math.log10(s);
}

export interface LevelSumResult {
  ok: true;
  totalDb: number;
  aboveLoudestDb: number;
  /** Each source's share of the total POWER, 0–1. */
  shares: number[];
  notes: string[];
  figure: AudioFigure;
}

/** Incoherent (power) sum of levels: 10·log₁₀ Σ 10^(L/10). 80 + 80 + 74 = 83.5241 dB. */
export function levelSum(levels: number[]): LevelSumResult | AudioError {
  if (!Array.isArray(levels) || levels.length === 0) return fail("Give at least one level.");
  if (levels.length > MAX_LIST) return fail(`At most ${MAX_LIST} levels.`);
  const bad = finiteAll("level", levels);
  if (bad) return bad;
  const total = powerSumDb(levels);
  const shares = levels.map((l) => Math.pow(10, (l - total) / 10));
  const loudest = Math.max(...levels);
  return {
    ok: true,
    totalDb: total,
    aboveLoudestDb: total - loudest,
    shares,
    notes: [
      "INCOHERENT sum — levels add by POWER: 10·log₁₀ of the sum of 10 to the power L/10. Two equal sources are +3.01 dB, never +6 " +
        "(that is the coherent, in-phase case) and never the arithmetic sum.",
      "A source 10 dB below the loudest adds about 0.4 dB: the loudest item dominates.",
    ],
    figure: {
      kind: "bar",
      title: "Share of the total power",
      xLabel: "source",
      yLabel: "share of power (%)",
      bars: levels.slice(0, 50).map((l, i) => ({ label: `${i + 1}: ${fmtNum(l, 6)} dB`, value: shares[i] * 100 })),
      note: levels.length > 50 ? `First 50 of ${levels.length} sources shown.` : undefined,
    },
  };
}

export interface LevelSubtractResult {
  ok: true;
  /** The source alone, dB. */
  sourceDb: number;
  /** Correction applied to the total, dB (negative). */
  correctionDb: number;
  deltaDb: number;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Background-noise subtraction by power: Ls = 10·log₁₀(10^(Lt/10) − 10^(Lb/10)).
 * REFUSED when the total is less than 3 dB above the background — the result
 * then rests on the difference of two nearly equal measurements and is not
 * determinable to better than the measurement (the practice in ISO 3744 and
 * related survey standards). Δ = 3 dB exactly is accepted.
 */
export function levelSubtract(totalDb: number, backgroundDb: number): LevelSubtractResult | AudioError {
  const bad = finiteAll("level", [totalDb, backgroundDb]);
  if (bad) return bad;
  const delta = totalDb - backgroundDb;
  if (delta <= 0) {
    return fail(
      `The background (${fmtNum(backgroundDb)} dB) is at or above the total (${fmtNum(totalDb)} dB): background ≥ total, so the ` +
        "source is not measurable here.",
    );
  }
  if (delta < 3 - 1e-12) {
    return fail(
      `The background is within 3 dB of the total (Δ = ${delta.toFixed(2)} dB); the result is not determinable to ` +
        "better than the measurement. Reduce the background or measure closer to the source.",
    );
  }
  const sourceDb = totalDb + 10 * Math.log10(1 - Math.pow(10, -delta / 10));
  const notes = [
    "Subtraction is by POWER: 10·log₁₀(10^(Lt/10) − 10^(Lb/10)). Subtracting the dB values (85 − 80 = 5) is meaningless.",
    `Δ = ${delta.toFixed(2)} dB between total and background; the correction is ${(sourceDb - totalDb).toFixed(3)} dB.`,
  ];
  if (delta >= 10) notes.push("At Δ ≥ 10 dB the correction is under 0.46 dB and is usually neglected.");
  else notes.push("Between 3 and 10 dB the correction is applied; below 3 dB this tool refuses.");
  return {
    ok: true,
    sourceDb,
    correctionDb: sourceDb - totalDb,
    deltaDb: delta,
    notes,
    figure: {
      kind: "bar",
      title: "Total, background and the source alone",
      xLabel: "",
      yLabel: "level (dB)",
      bars: [
        { label: "total", value: totalDb },
        { label: "background", value: backgroundDb },
        { label: "source alone", value: sourceDb },
      ],
    },
  };
}

export interface LevelAverageResult {
  ok: true;
  /** Energy average (Leq), dB. */
  leqDb: number;
  /** The arithmetic mean of the dB values, shown only to make the error visible. */
  arithmeticMeanDb: number;
  /** Each entry's share of the total energy, 0–1. */
  shares: number[];
  notes: string[];
  figure: AudioFigure;
}

/**
 * Energy average (Leq) of levels, optionally time-weighted:
 * Leq = 10·log₁₀(Σ tᵢ·10^(Lᵢ/10) / Σ tᵢ). 70, 80, 90 for equal times = 85.6820 dB.
 */
export function levelAverage(levels: number[], durations?: number[]): LevelAverageResult | AudioError {
  if (!Array.isArray(levels) || levels.length === 0) return fail("Give at least one level.");
  if (levels.length > MAX_LIST) return fail(`At most ${MAX_LIST} levels.`);
  const bad = finiteAll("level", levels);
  if (bad) return bad;
  let w: number[];
  if (durations !== undefined && durations.length > 0) {
    if (durations.length !== levels.length) {
      return fail(`Give one duration per level (${levels.length} levels, ${durations.length} durations).`);
    }
    const b2 = finiteAll("duration", durations);
    if (b2) return b2;
    if (durations.some((t) => t < 0)) return fail("A duration cannot be negative.");
    const T = durations.reduce((a, b) => a + b, 0);
    if (!(T > 0)) return fail("The durations must add up to more than zero.");
    w = durations.map((t) => t / T);
  } else {
    w = levels.map(() => 1 / levels.length);
  }
  // Only entries with weight > 0 take part (a zero duration contributes nothing).
  const used = levels.filter((_, i) => w[i] > 0);
  const usedW = w.filter((x) => x > 0);
  const leq = powerSumDb(used, usedW);
  const shares = levels.map((l, i) => (w[i] * Math.pow(10, (l - leq) / 10)));
  const mean = levels.reduce((a, b, i) => a + b * w[i], 0);
  return {
    ok: true,
    leqDb: leq,
    arithmeticMeanDb: mean,
    shares,
    notes: [
      "ENERGY average (Leq): 10·log₁₀(Σ tᵢ·10^(Lᵢ/10) / Σ tᵢ). Averaging the dB numbers " +
        `(${mean.toFixed(2)} dB here) understates it whenever the levels differ.`,
      durations ? "Weighted by the durations given." : "Equal durations assumed (none given).",
    ],
    figure: {
      kind: "bar",
      title: "Share of the energy",
      xLabel: "entry",
      yLabel: "share of energy (%)",
      bars: levels.slice(0, 50).map((l, i) => ({ label: `${i + 1}: ${fmtNum(l, 6)} dB`, value: shares[i] * 100 })),
      note: levels.length > 50 ? `First 50 of ${levels.length} entries shown.` : undefined,
    },
  };
}

/** cos and sin of an angle in degrees, exact at multiples of 90°. */
function cosSinDeg(deg: number): [number, number] {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return [1, 0];
  if (r === 90) return [0, 1];
  if (r === 180) return [-1, 0];
  if (r === 270) return [0, -1];
  const rad = (r * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

export interface CoherentSumResult {
  ok: true;
  totalDb: number;
  /** The incoherent (power) sum of the same levels, for comparison. */
  incoherentDb: number;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Coherent sum with phase — the same signal from several paths. Adds by
 * PRESSURE as phasors: 20·log₁₀|Σ 10^(Lᵢ/20)·e^{jφᵢ}|. Two 80 dB in phase =
 * 86.0206 dB; at 90° = 83.0103 dB; at 180° they cancel, which is REFUSED as a
 * level (−∞ dB) and said.
 */
export function coherentSum(levels: number[], phasesDeg: number[]): CoherentSumResult | AudioError {
  if (!Array.isArray(levels) || levels.length === 0) return fail("Give at least one level.");
  if (levels.length > MAX_LIST) return fail(`At most ${MAX_LIST} levels.`);
  if (!Array.isArray(phasesDeg) || phasesDeg.length !== levels.length) {
    return fail(`Give one phase per level (${levels.length} levels).`);
  }
  const bad = finiteAll("level", levels) ?? finiteAll("phase", phasesDeg);
  if (bad) return bad;
  if (phasesDeg.some((p) => Math.abs(p) > 1e9)) return fail("A phase must be within ±10⁹ degrees.");
  const max = Math.max(...levels);
  const amps = levels.map((l) => Math.pow(10, (l - max) / 20));
  // The fixed phasor of every source but the last, summed once: the figure
  // sweeps only the last source's phase, so it costs O(n + 181), not O(181·n).
  let fixedRe = 0;
  let fixedIm = 0;
  for (let i = 0; i < amps.length - 1; i++) {
    const [c, s] = cosSinDeg(phasesDeg[i]);
    fixedRe += amps[i] * c;
    fixedIm += amps[i] * s;
  }
  const lastAmp = amps[amps.length - 1];
  const sumAt = (lastPhase: number): number => {
    const [c, s] = cosSinDeg(lastPhase);
    return Math.hypot(fixedRe + lastAmp * c, fixedIm + lastAmp * s);
  };
  const scale = amps.reduce((a, b) => a + b, 0);
  const mag = sumAt(phasesDeg[phasesDeg.length - 1]);
  if (mag <= 1e-9 * scale) {
    return fail(
      "These pressures cancel exactly: the coherent sum is zero, which is −∞ dB and has no level. In practice any " +
        "mismatch in level or timing leaves a residue; measure it rather than compute it.",
    );
  }
  const total = max + 20 * Math.log10(mag);
  const incoherent = powerSumDb(levels);
  // The figure must reach the total printed beside it: a near-cancellation
  // (0° and 179.9° → 24.84 dB from two 80s) is a finite answer, not −∞, so the
  // floor sits below it rather than at a fixed 40 dB under the loudest.
  const floor = Math.min(max - 40, Math.floor((max + 20 * Math.log10(mag) - 6) / 10) * 10);
  const pts: FigurePoint[] = [];
  for (let k = 0; k <= 180; k++) {
    const ph = 2 * k;
    const m = sumAt(ph);
    const db = m > 0 ? max + 20 * Math.log10(m) : -Infinity;
    pts.push({ x: ph, y: Math.max(floor, db) });
  }
  return {
    ok: true,
    totalDb: total,
    incoherentDb: incoherent,
    notes: [
      "COHERENT sum — the same signal by different paths adds by PRESSURE, as phasors: " +
        "20·log₁₀|Σ 10^(L/20)·e^{jφ}|. Two equal levels give +6.02 dB in phase, +3.01 dB at 90° and cancel at 180°.",
      `The incoherent (power) sum of the same levels would be ${incoherent.toFixed(4)} dB; use that for unrelated sources.`,
    ],
    figure: {
      kind: "line",
      title: "Coherent total against the last source's phase",
      xLabel: "phase of the last source (°)",
      yLabel: "total level (dB)",
      series: [{ label: "coherent total", points: finitePoints(pts) }],
      markers: [
        { axis: "x", at: ((phasesDeg[phasesDeg.length - 1] % 360) + 360) % 360, label: "entered phase" },
        { axis: "y", at: incoherent, label: "incoherent sum" },
      ],
      note: `Drawn down to ${fmtNum(floor)} dB; a cancellation is −∞ dB and is clipped there.`,
    },
  };
}

/** Free-field distance falloff: point source −20·log₁₀(r₂/r₁) (−6.02 dB/doubling), line source −10·log₁₀ (−3.01). */
export function distanceFalloff(
  levelDb: number,
  r1: number,
  r2: number,
  source: "point" | "line",
): { ok: true; levelDb: number; changeDb: number; notes: string[] } | AudioError {
  if (!Number.isFinite(levelDb)) return fail("The level must be a finite number of dB.");
  const bad = finitePositive([
    ["reference distance", r1],
    ["target distance", r2],
  ]);
  if (bad) return bad;
  if (source !== "point" && source !== "line") return fail("The source is a point or a line.");
  const k = source === "point" ? 20 : 10;
  const change = -k * Math.log10(r2 / r1);
  return {
    ok: true,
    levelDb: levelDb + change,
    changeDb: change,
    notes: [
      source === "point"
        ? "Point source: −6.02 dB per doubling of distance (spherical spreading)."
        : "Line source (a long road, a pipe): −3.01 dB per doubling (cylindrical spreading), valid while the " +
          "distance is short against the line's length; far away a finite line behaves as a point.",
      "Free field: no ground reflection, no air absorption, no barrier.",
    ],
  };
}

// --- Frequency weighting (IEC 61672-1:2013, Annex E) ---------------------------------

/**
 * The pole frequencies from IEC 61672-1 Annex E, COMPUTED from the defining
 * quantities (fr = 1 kHz, fL = 10^1.5 Hz, fH = 10^3.9 Hz, D² = 1/2,
 * fA = 10^2.45 Hz) rather than typed as the rounded 20.6 / 107.7 / 737.9 /
 * 12194 Hz.
 */
export const IEC61672_POLES = (() => {
  const fr = 1000;
  const fL = Math.pow(10, 1.5);
  const fH = Math.pow(10, 3.9);
  const D = Math.SQRT1_2;
  const c = fL * fL * fH * fH;
  const b = (1 / (1 - D)) * (fr * fr + (fL * fL * fH * fH) / (fr * fr) - D * (fL * fL + fH * fH));
  const disc = Math.sqrt(b * b - 4 * c);
  const f1 = Math.sqrt((-b - disc) / 2);
  const f4 = Math.sqrt((-b + disc) / 2);
  const fA = Math.pow(10, 2.45);
  const f2 = ((3 - Math.sqrt(5)) / 2) * fA;
  const f3 = ((3 + Math.sqrt(5)) / 2) * fA;
  return { f1, f2, f3, f4 };
})();

function rawWeightDb(f: number, curve: "A" | "C"): number {
  const { f1, f2, f3, f4 } = IEC61672_POLES;
  const f2s = f * f;
  if (curve === "C") {
    return 20 * Math.log10((f4 * f4 * f2s) / ((f2s + f1 * f1) * (f2s + f4 * f4)));
  }
  return (
    20 *
    Math.log10((f4 * f4 * f2s * f2s) / ((f2s + f1 * f1) * Math.sqrt((f2s + f2 * f2) * (f2s + f3 * f3)) * (f2s + f4 * f4)))
  );
}

/** A₁₀₀₀ = −1.99966 dB (the standard rounds it to −2.000), computed. */
export const A1000_DB = rawWeightDb(1000, "A");
/** C₁₀₀₀ = −0.06190 dB (the standard rounds it to −0.062), computed. */
export const C1000_DB = rawWeightDb(1000, "C");

export type WeightCurve = "A" | "C" | "Z";

/** The weighting in dB at f, no validation (internal and figure use). */
export function weightingDb(f: number, curve: WeightCurve): number {
  if (curve === "Z") return 0;
  return rawWeightDb(f, curve) - (curve === "A" ? A1000_DB : C1000_DB);
}

export const WEIGHT_MIN_HZ = 1;
export const WEIGHT_MAX_HZ = 1e6;

export interface WeightingResult {
  ok: true;
  frequencyHz: number;
  curve: WeightCurve;
  db: number;
  notes: string[];
}

/**
 * A, C or Z weighting at frequency f by the IEC 61672-1:2013 Annex E closed
 * form, EVALUATED AT THE f GIVEN. The standard's Table 3 is defined at the
 * exact base-10 band frequencies 1000·10^(n/10) (31.62 Hz, not 31.5): at the
 * nominal 31.5 Hz this reads −39.52, not the table's −39.4. Use
 * `exactBandFrequency` (or `bandsToWeighted`, which snaps) to match the table.
 */
export function weighting(f: number, curve: WeightCurve): WeightingResult | AudioError {
  if (curve !== "A" && curve !== "C" && curve !== "Z") return fail("The weighting is A, C or Z.");
  if (typeof f !== "number" || !Number.isFinite(f) || f <= 0) {
    return fail("The frequency must be greater than zero: at 0 Hz the A and C weightings are −∞ dB.");
  }
  if (f < WEIGHT_MIN_HZ || f > WEIGHT_MAX_HZ) {
    return fail(
      `${fmtNum(f)} Hz is outside 1 Hz – 1 MHz. IEC 61672-1 tabulates 10 Hz – 20 kHz; this tool extrapolates the closed ` +
        "form only to 1 Hz – 1 MHz, and a weighting far outside hearing has no acoustic meaning.",
    );
  }
  const db = weightingDb(f, curve);
  const notes = [
    curve === "Z"
      ? "Z weighting is flat (0 dB) by definition."
      : `IEC 61672-1:2013 Annex E design formula, normalised so ${curve}(1 kHz) = 0 exactly by the computed ` +
        `${curve}₁₀₀₀ = ${(curve === "A" ? A1000_DB : C1000_DB).toFixed(5)} dB (the standard prints ` +
        `${curve === "A" ? "−2.000" : "−0.062"}). No Class 1/2 tolerance band is applied.`,
  ];
  const ex = exactBandFrequency(f);
  if (ex.isBand && Math.abs(ex.exactHz - f) > 1e-9 * f) {
    notes.push(
      `${fmtNum(f)} Hz looks like the nominal band label for ${ex.exactHz.toFixed(2)} Hz. The standard's table is at the ` +
        `exact frequency, where ${curve} = ${weightingDb(ex.exactHz, curve).toFixed(2)} dB.`,
    );
  }
  if (f < 10 || f > 20000) notes.push("Outside 10 Hz – 20 kHz the IEC table stops; this value is the formula extrapolated.");
  return { ok: true, frequencyHz: f, curve, db, notes };
}

/**
 * The exact base-10 band centre nearest f: 1000·10^(n/10), n = round(10·log₁₀(f/1000)).
 * `isBand` is true when f is within 3% of it — every nominal label (31.5, 63,
 * 125, 16k …) is, and adjacent third-octave centres are 26% apart.
 */
export function exactBandFrequency(f: number): { exactHz: number; index: number; isBand: boolean } {
  const n = Math.round(10 * Math.log10(f / 1000));
  const exactHz = 1000 * Math.pow(10, n / 10);
  return { exactHz, index: n, isBand: Math.abs(f / exactHz - 1) <= 0.03 };
}

export interface WeightedBand {
  typedHz: number;
  /** The frequency the weighting was evaluated at (exact base-10 centre when snapped). */
  usedHz: number;
  snapped: boolean;
  levelDb: number;
  weightDb: number;
  weightedDb: number;
}

export interface BandsWeightedResult {
  ok: true;
  curve: WeightCurve;
  bands: WeightedBand[];
  /** Weighted total, e.g. dB(A). */
  totalDb: number;
  /** Unweighted (Z) total. */
  totalZDb: number;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Band levels → a weighted total (e.g. dB(A)). Each band's weighting is taken
 * at its EXACT base-10 centre frequency (a nominal 63 is evaluated at 63.10 Hz)
 * and the snap is reported; a frequency that is not a band centre is used as
 * typed. The band level is assumed to sit at its centre frequency. Octave
 * 63 Hz–8 kHz at 80 dB each: 86.974 dB(A), 89.031 dB(Z).
 */
export function bandsToWeighted(
  freqs: number[],
  levels: number[],
  curve: WeightCurve = "A",
): BandsWeightedResult | AudioError {
  if (!Array.isArray(freqs) || !Array.isArray(levels) || freqs.length === 0) return fail("Give at least one band.");
  if (freqs.length !== levels.length) {
    return fail(`Give one level per band (${freqs.length} frequencies, ${levels.length} levels).`);
  }
  if (freqs.length > 200) return fail("At most 200 bands.");
  const bad = finiteAll("level", levels);
  if (bad) return bad;
  const bands: WeightedBand[] = [];
  for (let i = 0; i < freqs.length; i++) {
    const w0 = weighting(freqs[i], curve);
    if (!w0.ok) return w0;
    const ex = exactBandFrequency(freqs[i]);
    const usedHz = ex.isBand ? ex.exactHz : freqs[i];
    const weightDb = weightingDb(usedHz, curve);
    bands.push({
      typedHz: freqs[i],
      usedHz,
      snapped: ex.isBand && Math.abs(usedHz - freqs[i]) > 1e-9 * usedHz,
      levelDb: levels[i],
      weightDb,
      weightedDb: levels[i] + weightDb,
    });
  }
  const totalDb = powerSumDb(bands.map((b) => b.weightedDb));
  const totalZDb = powerSumDb(levels);
  const snapped = bands.filter((b) => b.snapped);
  const notes = [
    `${curve === "Z" ? "dB(Z)" : `dB(${curve})`} = 10·log₁₀ Σ 10^((Lᵢ + ${curve}ᵢ)/10). Each band's level is taken ` +
      "to sit at its centre frequency.",
    `Unweighted (Z) total: ${totalZDb.toFixed(3)} dB.`,
  ];
  if (snapped.length) {
    notes.push(
      `Evaluated at the exact base-10 centres (IEC 61672-1 / IEC 61260): ` +
        snapped
          .slice(0, 12)
          .map((b) => `${fmtNum(b.typedHz)} → ${b.usedHz.toFixed(2)} Hz`)
          .join(", ") +
        (snapped.length > 12 ? " …" : "") +
        ". The nominal labels are names; the table is defined at these frequencies.",
    );
  }
  const curvePts = logSpace(10, 20000).map((x) => ({ x, y: weightingDb(x, curve) }));
  return {
    ok: true,
    curve,
    bands,
    totalDb,
    totalZDb,
    notes,
    figure: {
      kind: "line",
      title: `${curve}-weighting and the band levels`,
      xLabel: "frequency (Hz)",
      yLabel: "level (dB)",
      xLog: true,
      series: [
        { label: "band level", points: finitePoints(bands.map((b) => ({ x: b.usedHz, y: b.levelDb }))) },
        { label: `${curve}-weighted`, points: finitePoints(bands.map((b) => ({ x: b.usedHz, y: b.weightedDb }))) },
        { label: `${curve}-weighting (dB, relative)`, points: finitePoints(curvePts), style: "faint" },
      ],
      markers: [{ axis: "y", at: totalDb, label: `total dB(${curve})` }],
    },
  };
}

// --- Dither, oversampling, noise floor --------------------------------------------------

export type DitherKind = "none" | "rpdf" | "tpdf" | "shaped";

export interface DitherResult {
  ok: true;
  bits: number;
  idealSnrDb: number;
  ditherPenaltyDb: number;
  oversamplingGainDb: number;
  /** SNR in the audio band at the stated signal level. */
  inBandSnrDb: number;
  /** The in-band noise floor re a full-scale sine (AES17), dBFS. */
  noiseFloorDbfs: number;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Dither and oversampling budget. Ideal SNR 20·log₁₀2·n + 10·log₁₀1.5; RPDF
 * dither costs 10·log₁₀2 (3.01 dB), TPDF 10·log₁₀3 (4.77 dB); oversampling by
 * OSR gains 10·log₁₀(OSR) in band. Noise shaping is REFUSED by name.
 */
export function ditherBudget(
  bits: number,
  dither: DitherKind,
  osr = 1,
  levelDbfs = 0,
): DitherResult | AudioError {
  if (dither === "shaped") {
    return fail(
      "Noise shaping moves noise in frequency; its gain depends on the shaping filter and is not computable from " +
        "these inputs.",
    );
  }
  if (dither !== "none" && dither !== "rpdf" && dither !== "tpdf") return fail("Dither is none, RPDF or TPDF.");
  if (!Number.isInteger(bits) || bits < 1 || bits > 64) return fail("Bit depth must be a whole number from 1 to 64.");
  if (!Number.isFinite(osr) || osr < 1 || osr > 1e6) {
    return fail("The oversampling ratio must be at least 1 (no oversampling) and at most 10⁶.");
  }
  if (!Number.isFinite(levelDbfs) || levelDbfs > 0 || levelDbfs < -300) {
    return fail("The signal level is in dB re full scale: 0 or below (a sine cannot exceed full scale), not under −300.");
  }
  const ideal = DB_PER_BIT * bits + SINE_QUANT_DB;
  const penalty = dither === "rpdf" ? 10 * Math.log10(2) : dither === "tpdf" ? 10 * Math.log10(3) : 0;
  const gain = 10 * Math.log10(osr);
  const afterDither = ideal - penalty;
  const afterLevel = afterDither + levelDbfs;
  const inBand = afterLevel + gain;
  return {
    ok: true,
    bits,
    idealSnrDb: ideal,
    ditherPenaltyDb: penalty,
    oversamplingGainDb: gain,
    inBandSnrDb: inBand,
    noiseFloorDbfs: -(afterDither + gain),
    notes: [
      `Ideal SNR = 20·log₁₀2·${bits} + 10·log₁₀1.5 = ${ideal.toFixed(4)} dB (≈ 6.02n + 1.76, rounded).`,
      dither === "none"
        ? "No dither: the error is correlated with the signal at low levels and becomes distortion, not noise."
        : dither === "rpdf"
          ? "RPDF dither (1 LSB peak-to-peak) doubles the noise power: −10·log₁₀2 = −3.01 dB. It decorrelates the " +
            "first moment of the error only; the noise still modulates with the signal."
          : "TPDF dither (2 LSB peak-to-peak) triples the noise power: −10·log₁₀3 = −4.77 dB. It makes the error's " +
            "mean and variance independent of the signal — the usual choice.",
      `Oversampling by ${fmtNum(osr)} spreads the same noise over ${fmtNum(osr)}× the bandwidth: +10·log₁₀(OSR) = ` +
        `${gain.toFixed(4)} dB in band (white noise, ideal decimation filter).`,
      "Noise floor is in dBFS re a full-scale sine (AES17). Noise shaping is not modelled.",
    ],
    figure: {
      kind: "bar",
      title: "SNR budget",
      xLabel: "",
      yLabel: "SNR (dB)",
      bars: [
        { label: "ideal", value: ideal },
        { label: "after dither", value: afterDither },
        { label: "at signal level", value: afterLevel },
        { label: "after oversampling", value: inBand },
      ],
    },
  };
}

// --- Data rate and file size ------------------------------------------------------------

/** RIFF chunk sizes are uint32: the data chunk of a canonical WAV can hold 2³² − 1 − 36 bytes. */
export const WAV_MAX_DATA_BYTES = 2 ** 32 - 1 - 36;

export interface AudioSizeInput {
  mode: "pcm" | "compressed";
  fs?: number;
  bits?: number;
  channels?: number;
  /** Compressed stream rate, bit/s. */
  bitRate?: number;
  durationS?: number;
  sizeBytes?: number;
}

export interface AudioSizeResult {
  ok: true;
  bitRate: number;
  bytesPerSecond: number;
  mbPerMinute: number;
  durationS: number;
  sizeBytes: number;
  sizeGB: number;
  sizeGiB: number;
  sizeMB: number;
  sizeMiB: number;
  /** PCM only: the longest a canonical WAV can hold, s. */
  wavMaxSeconds: number | null;
  /** PCM only: true when the duration overflows a canonical WAV. */
  exceedsWav: boolean;
  notes: string[];
  figure: AudioFigure;
}

const MAX_DURATION_S = 100 * 365.25 * 86400;

/**
 * PCM or compressed data rate, and size ↔ duration. PCM 48 kHz/24-bit/2 ch =
 * 2 304 000 bit/s = 1.0368 GB per hour; a canonical WAV tops out at
 * (2³² − 1 − 36)/288 000 = 14 913 s = 4.14 h (RIFF sizes are uint32), beyond
 * which RF64 / BW64 is needed.
 */
export function audioSize(input: AudioSizeInput): AudioSizeResult | AudioError {
  if (!input || (input.mode !== "pcm" && input.mode !== "compressed")) return fail("The mode is PCM or compressed.");
  let rate: number;
  let blockBytesPerSecond: number | null = null;
  const notes: string[] = [];
  if (input.mode === "pcm") {
    const { fs, bits, channels } = input;
    if (fs === undefined || bits === undefined || channels === undefined) {
      return fail("PCM needs a sample rate, a bit depth and a channel count.");
    }
    const bad = finitePositive([["sample rate", fs]]);
    if (bad) return bad;
    if (fs > 1e7) return fail("A sample rate above 10 MHz is not an audio format.");
    if (!Number.isInteger(bits) || bits < 1 || bits > 64) return fail("Bit depth must be a whole number from 1 to 64.");
    if (!Number.isInteger(channels) || channels < 1 || channels > 1024) {
      return fail("Channel count must be a whole number from 1 to 1024.");
    }
    rate = fs * bits * channels;
    blockBytesPerSecond = fs * channels * Math.ceil(bits / 8);
    notes.push(`PCM rate = fs × bits × channels = ${fmtNum(fs)} Hz × ${bits} × ${channels} = ${fmtNum(rate)} bit/s.`);
    if (bits % 8 !== 0) {
      notes.push(
        `A WAV stores ${bits}-bit samples in ${Math.ceil(bits / 8)}-byte containers (bytes per sample = ⌈bits/8⌉), ` +
          `so the sizes below are the container size: ${fmtNum(blockBytesPerSecond)} B/s, ` +
          `${(((Math.ceil(bits / 8) * 8) / bits - 1) * 100).toFixed(1)}% more than the packed ${bits}-bit rate.`,
      );
    }
  } else {
    const r = input.bitRate;
    if (r === undefined) return fail("A compressed stream needs its bit rate.");
    const bad = finitePositive([["bit rate", r]]);
    if (bad) return bad;
    if (r > 1e11) return fail("A bit rate above 100 Gbit/s is not an audio stream.");
    rate = r;
    notes.push("Compressed: the size follows the stated average bit rate; VBR files vary around it.");
  }
  const haveD = input.durationS !== undefined && input.durationS !== null;
  const haveS = input.sizeBytes !== undefined && input.sizeBytes !== null;
  if (haveD === haveS) return fail("Give either a duration or a size, not both and not neither.");
  let duration: number;
  let size: number;
  // Bytes actually stored per second: PCM in whole-byte containers, compressed at its rate.
  const storeBps = blockBytesPerSecond ?? rate / 8;
  if (haveD) {
    const bad = finitePositive([["duration", input.durationS!]]);
    if (bad) return bad;
    if (input.durationS! > MAX_DURATION_S) return fail("A duration over a century is not a recording.");
    duration = input.durationS!;
    size = storeBps * duration;
  } else {
    const bad = finitePositive([["size", input.sizeBytes!]]);
    if (bad) return bad;
    size = input.sizeBytes!;
    duration = size / storeBps;
    if (duration > MAX_DURATION_S) return fail("That size holds more than a century of audio at this rate.");
  }
  let wavMaxSeconds: number | null = null;
  let exceedsWav = false;
  if (blockBytesPerSecond !== null) {
    wavMaxSeconds = WAV_MAX_DATA_BYTES / blockBytesPerSecond;
    exceedsWav = duration > wavMaxSeconds;
    const h = wavMaxSeconds / 3600;
    notes.push(
      `WAV ceiling: RIFF chunk sizes are 32-bit unsigned (Microsoft RIFF), so the data is at most 2³² − 1 − 36 = ` +
        `${WAV_MAX_DATA_BYTES} bytes — ${wavMaxSeconds.toFixed(2)} s (${h.toFixed(4)} h) in this format.` +
        (exceedsWav
          ? " This duration EXCEEDS it: use RF64 / BW64 (EBU Tech 3306 / ITU-R BS.2088)."
          : " Past that, RF64 / BW64 (EBU Tech 3306 / ITU-R BS.2088)."),
    );
  }
  notes.push("Sizes are given in decimal (GB = 10⁹ B) AND binary (GiB = 2³⁰ B) units; a drive is sold in the first and an OS often reports the second.");
  const xMax = Math.max(duration * 2, wavMaxSeconds !== null ? wavMaxSeconds * 1.2 : 0) / 3600;
  const pts: FigurePoint[] = [];
  for (let i = 0; i <= 40; i++) {
    const hrs = (xMax * i) / 40;
    pts.push({ x: hrs, y: (storeBps * hrs * 3600) / 1e9 });
  }
  const markers: FigureMarker[] = [{ axis: "x", at: duration / 3600, label: "entered duration" }];
  if (blockBytesPerSecond !== null) markers.push({ axis: "y", at: WAV_MAX_DATA_BYTES / 1e9, label: "WAV 4 GiB ceiling" });
  return {
    ok: true,
    bitRate: rate,
    bytesPerSecond: storeBps,
    mbPerMinute: (storeBps * 60) / 1e6,
    durationS: duration,
    sizeBytes: size,
    sizeGB: size / 1e9,
    sizeGiB: size / 2 ** 30,
    sizeMB: size / 1e6,
    sizeMiB: size / 2 ** 20,
    wavMaxSeconds,
    exceedsWav,
    notes,
    figure: {
      kind: "line",
      title: "Size against duration",
      xLabel: "duration (h)",
      yLabel: "size (GB)",
      series: [{ label: "this format", points: finitePoints(pts) }],
      markers,
    },
  };
}

// --- Loudspeaker sensitivity and amplifier power ----------------------------------------

export interface SpeakerInput {
  /** Sensitivity, dB SPL at 1 m. */
  sensitivityDb: number;
  /** "1W": dB @ 1 W/1 m; "2.83V": dB @ 2.83 V/1 m. */
  basis: "1W" | "2.83V";
  impedanceOhm: number;
  /** Power into EACH box, W. */
  powerW: number;
  distanceM: number;
  boxes?: number;
  /** n boxes add coherently (+20·log₁₀n, an upper bound) or incoherently (+10·log₁₀n). */
  coherent?: boolean;
  /** Programme crest factor (peak over continuous), dB. */
  crestDb?: number;
  targetSplDb?: number | null;
}

export interface SpeakerResult {
  ok: true;
  /** Sensitivity on the 1 W/1 m basis. */
  sensitivity1W: number;
  /** Watts that 2.83 V delivers into the nominal impedance. */
  wattsAt283V: number;
  /** How much higher a 2.83 V rating reads than a 1 W rating of the same speaker, dB. */
  basisOffsetDb: number;
  boxGainDb: number;
  /** Continuous SPL at the distance, dB SPL. */
  splDb: number;
  /** Peak SPL (continuous + crest), dB SPL. */
  peakSplDb: number;
  /** Amplifier power the peaks need, W per box. */
  peakPowerW: number;
  /** Power per box for the target SPL (continuous), W; null without a target. */
  powerForTargetW: number | null;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Loudspeaker SPL at a distance: L = S₁W + 10·log₁₀P − 20·log₁₀d (+ n boxes).
 * 88 dB/1 W/1 m, 100 W, 4 m → 95.9588 dB SPL; 100 dB at 4 m needs 253.58 W.
 * The 2.83 V trap: 2.83 V into 4 Ω is 2.002 W, so a 2.83 V rating reads
 * 3.0151 dB higher than the 1 W rating of the same speaker.
 */
export function speakerSpl(input: SpeakerInput): SpeakerResult | AudioError {
  if (!input) return fail("No loudspeaker given.");
  const { sensitivityDb, basis, impedanceOhm, powerW, distanceM } = input;
  const n = input.boxes ?? 1;
  const crest = input.crestDb ?? 0;
  if (!Number.isFinite(sensitivityDb) || sensitivityDb < 40 || sensitivityDb > 150) {
    return fail("A loudspeaker sensitivity is between 40 and 150 dB SPL at 1 m.");
  }
  if (basis !== "1W" && basis !== "2.83V") return fail("The sensitivity basis is 1 W/1 m or 2.83 V/1 m.");
  const bad = finitePositive([
    ["nominal impedance", impedanceOhm],
    ["amplifier power", powerW],
    ["distance", distanceM],
  ]);
  if (bad) return bad;
  if (impedanceOhm > 1000) return fail("A nominal impedance above 1000 Ω is not a loudspeaker.");
  if (powerW > 1e6) return fail("Over a megawatt per box is not a loudspeaker drive.");
  if (distanceM > 1e4) return fail("Beyond 10 km air absorption and weather dominate; this far-field model does not apply.");
  if (!Number.isInteger(n) || n < 1 || n > 1000) return fail("The number of boxes is a whole number from 1 to 1000.");
  if (!Number.isFinite(crest) || crest < 0 || crest > 40) return fail("The crest factor is 0 to 40 dB.");
  const wattsAt283V = (2.83 * 2.83) / impedanceOhm;
  const basisOffsetDb = 10 * Math.log10(wattsAt283V);
  const s1 = basis === "2.83V" ? sensitivityDb - basisOffsetDb : sensitivityDb;
  const boxGainDb = n > 1 ? (input.coherent ? 20 : 10) * Math.log10(n) : 0;
  const atD = (d: number, p: number) => s1 + 10 * Math.log10(p) - 20 * Math.log10(d) + boxGainDb;
  const spl = atD(distanceM, powerW);
  const peak = spl + crest;
  let powerForTargetW: number | null = null;
  const t = input.targetSplDb;
  if (t !== undefined && t !== null) {
    if (!Number.isFinite(t)) return fail("The target SPL must be a finite number of dB.");
    powerForTargetW = Math.pow(10, (t - s1 + 20 * Math.log10(distanceM) - boxGainDb) / 10);
    if (!Number.isFinite(powerForTargetW)) return fail("That target is beyond any representable power.");
  }
  const notes = [
    `L = ${s1.toFixed(4)} dB (1 W/1 m) + 10·log₁₀(${fmtNum(powerW)} W) − 20·log₁₀(${fmtNum(distanceM)} m)` +
      (n > 1 ? ` + ${boxGainDb.toFixed(3)} dB for ${n} boxes` : "") +
      ` = ${spl.toFixed(4)} dB SPL.`,
    `2.83 V into ${fmtNum(impedanceOhm)} Ω is ${wattsAt283V.toFixed(5)} W, so a 2.83 V rating reads ` +
      `${basisOffsetDb >= 0 ? "+" : ""}${basisOffsetDb.toFixed(4)} dB against the 1 W rating of the same speaker` +
      (basis === "2.83V" ? " — removed here." : ".") +
      (impedanceOhm <= 4.5 ? " At 4 Ω the 2.83 V figure flatters the speaker by 3 dB." : ""),
    "Far field, on axis, free field: no power compression, no room gain, no boundary loading. Real SPL at full " +
      "power is typically a few dB lower (voice-coil heating).",
  ];
  if (n > 1) {
    notes.push(
      input.coherent
        ? "Coherent box sum (+20·log₁₀n) is an UPPER BOUND, reached only at low frequency and on the axis where every path is in phase."
        : "Incoherent box sum (+10·log₁₀n): the power-sum estimate, right on average across frequency.",
    );
  }
  if (crest > 0) {
    notes.push(
      `Peaks ${fmtNum(crest)} dB above the continuous level need ${fmtNum(crest)} dB of amplifier headroom: ` +
        `${fmtNum(powerW * Math.pow(10, crest / 10), 4)} W per box at the peaks.`,
    );
  }
  const dMax = Math.max(32, distanceM * 4);
  const ds = logSpace(Math.min(0.5, distanceM / 2), dMax, 61);
  const markers: FigureMarker[] = [{ axis: "x", at: distanceM, label: "listener" }];
  if (t !== undefined && t !== null) markers.push({ axis: "y", at: t, label: "target" });
  return {
    ok: true,
    sensitivity1W: s1,
    wattsAt283V,
    basisOffsetDb,
    boxGainDb,
    splDb: spl,
    peakSplDb: peak,
    peakPowerW: powerW * Math.pow(10, crest / 10),
    powerForTargetW,
    notes,
    figure: {
      kind: "line",
      title: "SPL against distance",
      xLabel: "distance (m)",
      yLabel: "SPL (dB SPL)",
      xLog: true,
      series: [
        { label: `continuous (${fmtNum(powerW, 6)} W)`, points: finitePoints(ds.map((d) => ({ x: d, y: atD(d, powerW) }))) },
        ...(crest > 0
          ? [{ label: `peak (+${fmtNum(crest, 6)} dB crest)`, points: finitePoints(ds.map((d) => ({ x: d, y: atD(d, powerW) + crest }))), style: "dashed" as const }]
          : []),
      ],
      markers,
    },
  };
}

/**
 * Speed of sound in dry air from the temperature in KELVIN (SI, as the pane's
 * unit reader delivers it — 20 °C arrives as 293.15 K):
 * c = 331.3·√(T/273.15) m/s ≡ 331.3·√(1 + θ/273.15) with θ in °C; 343.21 m/s at 20 °C.
 */
export function speedOfSound(
  tempK: number,
  frequencyHz?: number,
): { ok: true; speed: number; wavelengthM: number | null; periodS: number | null; notes: string[] } | AudioError {
  if (!Number.isFinite(tempK) || tempK <= 0) return fail("The temperature must be above absolute zero (0 K, −273.15 °C).");
  if (tempK < 173.15 || tempK > 473.15) return fail("This ideal-gas formula is for air between −100 and 200 °C (173.15–473.15 K).");
  const c = 331.3 * Math.sqrt(tempK / 273.15);
  let wl: number | null = null;
  let per: number | null = null;
  if (frequencyHz !== undefined) {
    const bad = finitePositive([["frequency", frequencyHz]]);
    if (bad) return bad;
    wl = c / frequencyHz;
    per = 1 / frequencyHz;
  }
  return {
    ok: true,
    speed: c,
    wavelengthM: wl,
    periodS: per,
    notes: [
      `c = 331.3·√(1 + θ/273.15) m/s with θ = ${fmtNum(tempK - 273.15, 6)} °C, dry air (ideal gas). Humidity adds up to about 0.5%.`,
      `The other audio tools use a stated constant of ${SPEED_OF_SOUND_20C} m/s; this is ${c.toFixed(2)} m/s.`,
    ],
  };
}

// --- Room absorption budget ---------------------------------------------------------------

export interface Surface {
  area: number;
  alpha: number;
}

export interface AbsorptionResult {
  ok: true;
  totalArea: number;
  /** Σ Sα, m² sabins. */
  absorption: number;
  meanAlpha: number;
  /** 4mV, m² (air absorption term). */
  airAbsorption: number;
  sabineS: number;
  eyringS: number;
  millingtonSetteS: number;
  /** Per surface: Sα. */
  perSurface: number[];
  dominantIndex: number;
  /** Sabine absorption (surfaces only) needed for the target, m² sabins; null without target. */
  requiredAbsorption: number | null;
  /** requiredAbsorption − present absorption (negative = remove), m². */
  addedAbsorption: number | null;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Per-surface reverberation budget: Sabine 0.161V/(ΣSα + 4mV), Eyring
 * 0.161V/(−S·ln(1−ᾱ) + 4mV), Millington–Sette 0.161V/(−ΣS·ln(1−α) + 4mV).
 * V 200 m³ with 60·0.02 + 60·0.6 + 120·0.1 → A = 49.2, 0.65447 / 0.58483 /
 * 0.46780 s. Air attenuation m (m⁻¹) is an INPUT; ISO 9613-1 is not tabulated.
 */
export function absorptionBudget(
  volumeM3: number,
  surfaces: Surface[],
  airM = 0,
  targetS?: number | null,
): AbsorptionResult | AudioError {
  const bad = finitePositive([["room volume", volumeM3]]);
  if (bad) return bad;
  if (volumeM3 > 1e7) return fail("A volume above 10⁷ m³ is not a room.");
  if (!Array.isArray(surfaces) || surfaces.length === 0) return fail("Give at least one surface (area, α).");
  if (surfaces.length > 200) return fail("At most 200 surfaces.");
  for (const [i, s] of surfaces.entries()) {
    if (!s || !Number.isFinite(s.area) || s.area <= 0) return fail(`Surface ${i + 1}: the area must be greater than zero.`);
    if (!Number.isFinite(s.alpha) || s.alpha < 0 || s.alpha >= 1) {
      return fail(
        `Surface ${i + 1}: the absorption coefficient must be from 0 up to (not including) 1. α = 1 is a perfect ` +
          "absorber (an open window), where Eyring and Millington–Sette are undefined (ln 0).",
      );
    }
  }
  if (!Number.isFinite(airM) || airM < 0 || airM > 1) return fail("The air attenuation m is 0 to 1 m⁻¹ (typical values are 0.001–0.03).");
  const S = surfaces.reduce((a, s) => a + s.area, 0);
  const per = surfaces.map((s) => s.area * s.alpha);
  const A = per.reduce((a, b) => a + b, 0);
  if (!(A > 0)) return fail("Every surface has α = 0: there is no absorption and the reverberation time is infinite.");
  const air = 4 * airM * volumeM3;
  const k = 0.161 * volumeM3;
  const mean = A / S;
  const sabine = k / (A + air);
  const eyring = k / (-S * Math.log(1 - mean) + air);
  const ms = k / (surfaces.reduce((a, s) => a - s.area * Math.log(1 - s.alpha), 0) + air);
  let dominantIndex = 0;
  for (let i = 1; i < per.length; i++) if (per[i] > per[dominantIndex]) dominantIndex = i;
  let required: number | null = null;
  let added: number | null = null;
  if (targetS !== undefined && targetS !== null) {
    const b2 = finitePositive([["target reverberation time", targetS]]);
    if (b2) return b2;
    required = k / targetS - air;
    added = required - A;
    if (required <= 0) {
      return fail(`Air absorption alone (4mV = ${air.toFixed(2)} m²) already gives less than ${fmtNum(targetS)} s; no surface treatment can raise it to the target.`);
    }
  }
  const notes = [
    `A = Σ Sα = ${A.toFixed(3)} m² sabins over S = ${S.toFixed(3)} m² (ᾱ = ${mean.toFixed(4)}).` +
      (air > 0 ? ` Air: 4mV = ${air.toFixed(3)} m².` : " No air absorption (m = 0)."),
    "Sabine, Eyring and Millington–Sette are all shown. Millington–Sette weights each surface by −ln(1−α), so a " +
      "highly absorbent patch dominates it; it is the one that misleads when a small area is very absorbent.",
    "Diffuse-field formulas, one frequency band per run. α is a measured, per-band input (no material table).",
    `Most absorption: surface ${dominantIndex + 1} (${per[dominantIndex].toFixed(2)} m², ` +
      `${((per[dominantIndex] / A) * 100).toFixed(1)}% of the total).`,
  ];
  if (required !== null && added !== null) {
    notes.push(
      added >= 0
        ? `For ${fmtNum(targetS!)} s (Sabine) the surfaces need A = ${required.toFixed(3)} m² sabins: add ${added.toFixed(3)} m².`
        : `For ${fmtNum(targetS!)} s (Sabine) the surfaces need only A = ${required.toFixed(3)} m²: remove ${(-added).toFixed(3)} m² of absorption.`,
    );
  }
  const markers: FigureMarker[] = [];
  if (required !== null) markers.push({ axis: "y", at: required, label: `needed for ${fmtNum(targetS!)} s` });
  return {
    ok: true,
    totalArea: S,
    absorption: A,
    meanAlpha: mean,
    airAbsorption: air,
    sabineS: sabine,
    eyringS: eyring,
    millingtonSetteS: ms,
    perSurface: per,
    dominantIndex,
    requiredAbsorption: required,
    addedAbsorption: added,
    notes,
    figure: {
      kind: "bar",
      title: "Absorption per surface",
      xLabel: "surface",
      yLabel: "absorption (m² sabins)",
      bars: [
        ...per.slice(0, 50).map((a, i) => ({ label: `${i + 1}: ${fmtNum(surfaces[i].area, 6)} m² × ${fmtNum(surfaces[i].alpha, 6)}`, value: a })),
        { label: "total", value: A },
      ],
      markers,
    },
  };
}

// --- Passive crossover (1st order, Butterworth 2nd, Linkwitz–Riley 2nd) -------------------

export type CrossoverType = "1st" | "bw2" | "lr2";

export interface CrossoverResult {
  ok: true;
  type: CrossoverType;
  fc: number;
  impedanceOhm: number;
  /** Capacitance, F (the same value in the low-pass shunt and the high-pass series position). */
  capacitanceF: number;
  /** Inductance, H. */
  inductanceH: number;
  /** "in phase" or "inverted": the tweeter polarity for the flattest sum. */
  tweeterPolarity: "in phase" | "inverted";
  /** Summed magnitude at fc, dB; null where the sum is a null (−∞ dB). */
  sumAtFcInPhaseDb: number | null;
  sumAtFcInvertedDb: number | null;
  /** Each section's magnitude at fc, dB. */
  sectionAtFcDb: number;
  notes: string[];
  figure: AudioFigure;
}

interface Cplx {
  re: number;
  im: number;
}

function polyAtJw(p: number[], w: number): Cplx {
  let re = 0;
  let im = 0;
  for (const c of p) {
    const nr = -im * w + c;
    const ni = re * w;
    re = nr;
    im = ni;
  }
  return { re, im };
}

function cdiv(a: Cplx, b: Cplx): Cplx {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

function polyMulN(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

/**
 * The LP and HP sections as s-domain polynomials (highest power first), built
 * by filter.ts's Butterworth designer (the same code the Filter tool uses) at
 * a −3.01 dB edge of ωc; LR2 is the Butterworth 1st-order section SQUARED.
 */
function crossoverSections(type: CrossoverType, wc: number): { lp: [number[], number[]]; hp: [number[], number[]] } | AudioError {
  const order = type === "bw2" ? 2 : 1;
  const ap = 10 * Math.log10(2);
  const lp = designFilter({ family: "butterworth", kind: "lowpass", wp: wc, ws: 10 * wc, ap, as: 20, forceOrder: order });
  const hp = designFilter({ family: "butterworth", kind: "highpass", wp: wc, ws: wc / 10, ap, as: 20, forceOrder: order });
  if (!lp.ok) return fail(lp.error);
  if (!hp.ok) return fail(hp.error);
  if (type === "lr2") {
    return {
      lp: [polyMulN(lp.num, lp.num), polyMulN(lp.den, lp.den)],
      hp: [polyMulN(hp.num, hp.num), polyMulN(hp.den, hp.den)],
    };
  }
  return { lp: [lp.num, lp.den], hp: [hp.num, hp.den] };
}

/**
 * The crossover's magnitude at frequency f, dB, through the same filter.ts
 * sections the figure uses: "lp", "hp", or the sum with the tweeter "in phase"
 * / "inverted". null where the response is a null (−∞ dB).
 */
export function crossoverResponseDb(
  fc: number,
  type: CrossoverType,
  f: number,
  which: "lp" | "hp" | "in phase" | "inverted",
): number | null | AudioError {
  if (!Number.isFinite(fc) || fc <= 0 || !Number.isFinite(f) || f <= 0) return fail("Frequencies must be greater than zero.");
  if (type !== "1st" && type !== "bw2" && type !== "lr2") return fail("The crossover type is 1st order, Butterworth 2nd or Linkwitz–Riley 2nd.");
  const sec = crossoverSections(type, 2 * Math.PI * fc);
  if ("ok" in sec) return sec;
  const w = 2 * Math.PI * f;
  const a = cdiv(polyAtJw(sec.lp[0], w), polyAtJw(sec.lp[1], w));
  const b = cdiv(polyAtJw(sec.hp[0], w), polyAtJw(sec.hp[1], w));
  const c = which === "lp" ? a : which === "hp" ? b : which === "in phase" ? { re: a.re + b.re, im: a.im + b.im } : { re: a.re - b.re, im: a.im - b.im };
  const m = Math.hypot(c.re, c.im);
  const scale = Math.hypot(a.re, a.im) + Math.hypot(b.re, b.im);
  return m <= 1e-9 * scale ? null : 20 * Math.log10(m);
}

export const CROSSOVER_MIN_HZ = 20;
export const CROSSOVER_MAX_HZ = 20000;

/**
 * Passive 2-way crossover component values into a RESISTIVE load equal to the
 * nominal impedance R, with ω = 2πfc:
 *   1st order:   L = R/ω,     C = 1/(ωR)
 *   Butterworth: L = √2·R/ω,  C = 1/(√2·ωR)
 *   LR2:         L = 2R/ω,    C = 1/(2ωR)
 * (LP: series L, shunt C; HP: series C, shunt L.) 2.5 kHz, 8 Ω → C 7.9577 /
 * 5.6270 / 3.9789 µF, L 0.50930 / 0.72025 / 1.01859 mH. LR4 and 3rd order
 * are refused by name this round.
 */
export function passiveCrossover(fc: number, impedanceOhm: number, type: CrossoverType | string): CrossoverResult | AudioError {
  if (type === "lr4" || type === "LR4" || type === "3rd" || type === "bw3") {
    return fail(
      "Only 1st order, Butterworth 2nd and Linkwitz–Riley 2nd are designed here. LR4 and 3rd-order networks need " +
        "more components and are not designed by this tool.",
    );
  }
  if (type !== "1st" && type !== "bw2" && type !== "lr2") return fail("The crossover type is 1st order, Butterworth 2nd or Linkwitz–Riley 2nd.");
  const bad = finitePositive([
    ["crossover frequency", fc],
    ["driver impedance", impedanceOhm],
  ]);
  if (bad) return bad;
  if (fc < CROSSOVER_MIN_HZ || fc > CROSSOVER_MAX_HZ) {
    return fail(
      `${fmtNum(fc)} Hz is outside the audio band (20 Hz – 20 kHz): a loudspeaker crossover there has no pair of drivers to ` +
        "split, and the component values would be meaningless.",
    );
  }
  if (impedanceOhm < 1 || impedanceOhm > 100) {
    return fail("A driver's nominal impedance is between 1 and 100 Ω (usually 4, 6, 8 or 16 Ω).");
  }
  const w = 2 * Math.PI * fc;
  const R = impedanceOhm;
  const kL = type === "1st" ? 1 : type === "bw2" ? Math.SQRT2 : 2;
  const L = (kL * R) / w;
  const C = 1 / (kL * w * R);
  const sec = crossoverSections(type, w);
  if ("ok" in sec) return sec;
  const H = (pair: [number[], number[]], f: number): Cplx => cdiv(polyAtJw(pair[0], 2 * Math.PI * f), polyAtJw(pair[1], 2 * Math.PI * f));
  const toDbOrNull = (m: number, scale: number): number | null => (m <= 1e-9 * scale ? null : 20 * Math.log10(m));
  const lpc = H(sec.lp, fc);
  const hpc = H(sec.hp, fc);
  const scale = Math.hypot(lpc.re, lpc.im) + Math.hypot(hpc.re, hpc.im);
  const inPhase = toDbOrNull(Math.hypot(lpc.re + hpc.re, lpc.im + hpc.im), scale);
  const inverted = toDbOrNull(Math.hypot(lpc.re - hpc.re, lpc.im - hpc.im), scale);
  const sectionAtFcDb = 20 * Math.log10(Math.hypot(lpc.re, lpc.im));
  const polarity: "in phase" | "inverted" = type === "1st" ? "in phase" : "inverted";
  const name = type === "1st" ? "1st order" : type === "bw2" ? "Butterworth 2nd order" : "Linkwitz–Riley 2nd order";
  const notes = [
    `${name} at ${fmtNum(fc)} Hz into ${fmtNum(R)} Ω: C = ${(C * 1e6).toFixed(4)} µF, L = ${(L * 1e3).toFixed(5)} mH ` +
      "(low-pass: series L, shunt C; high-pass: series C, shunt L).",
    type === "1st"
      ? "1st order: each section is −3.01 dB at fc and the in-phase sum is exactly flat (the drivers are 90° apart)."
      : type === "bw2"
        ? "Butterworth 2nd: each section −3.01 dB at fc. In phase the sum NULLS at fc; with the tweeter inverted it " +
          "is +3.01 dB at fc — a bump, not flat."
        : "Linkwitz–Riley 2nd: each section −6.02 dB at fc. With the tweeter INVERTED the sum is flat (an all-pass); " +
          "in phase it nulls at fc.",
    "Values assume a resistive load equal to the nominal impedance; a real driver's impedance rises with frequency, " +
      "so without a Zobel network the acoustic crossover will not be where these values put it. No L-pad, no " +
      "acoustic offset between the drivers.",
  ];
  if (C > 200e-6 || L > 20e-3) {
    notes.push(
      "These values are impractically large for a passive network (a non-polarised capacitor over ~200 µF, an " +
        "air-core inductor over ~20 mH has resistance that spoils the filter). Crossovers this low are usually active.",
    );
  }
  const floor = -40;
  const fs = logSpace(20, 20000);
  const series = (label: string, fn: (f: number) => Cplx, style?: "dashed" | "faint"): FigureSeries => ({
    label,
    style,
    points: finitePoints(
      fs.map((f) => {
        const c = fn(f);
        const m = Math.hypot(c.re, c.im);
        return { x: f, y: m > 0 ? Math.max(floor, 20 * Math.log10(m)) : floor };
      }),
    ),
  });
  const sgnBest = polarity === "in phase" ? 1 : -1;
  return {
    ok: true,
    type,
    fc,
    impedanceOhm: R,
    capacitanceF: C,
    inductanceH: L,
    tweeterPolarity: polarity,
    sumAtFcInPhaseDb: inPhase,
    sumAtFcInvertedDb: inverted,
    sectionAtFcDb,
    notes,
    figure: {
      kind: "line",
      title: `${name} crossover at ${fmtNum(fc, 6)} Hz`,
      xLabel: "frequency (Hz)",
      yLabel: "magnitude (dB)",
      xLog: true,
      series: [
        series("low-pass", (f) => H(sec.lp, f)),
        series("high-pass", (f) => H(sec.hp, f)),
        series(`sum, tweeter ${polarity}`, (f) => {
          const a = H(sec.lp, f);
          const b = H(sec.hp, f);
          return { re: a.re + sgnBest * b.re, im: a.im + sgnBest * b.im };
        }),
        series(
          `sum, tweeter ${polarity === "in phase" ? "inverted" : "in phase"}`,
          (f) => {
            const a = H(sec.lp, f);
            const b = H(sec.hp, f);
            return { re: a.re - sgnBest * b.re, im: a.im - sgnBest * b.im };
          },
          "dashed",
        ),
      ],
      markers: [{ axis: "x", at: fc, label: "fc" }],
      note: `Drawn down to ${fmtNum(floor)} dB; a cancellation is −∞ dB and is clipped there.`,
    },
  };
}

// --- Speaker cable and damping factor -----------------------------------------------------

/** Annealed copper at 20 °C: 1/58 Ω·mm²/m, the IEC 60028 definition of 100% IACS (exact). */
export const COPPER_RHO_OHM_MM2_PER_M = 1 / 58;

/** AWG diameter, mm: 0.127 × 92^((36 − n)/39) (ASTM B258). 0000 is n = −3. */
export function awgDiameterMm(n: number): number {
  return 0.127 * Math.pow(92, (36 - n) / 39);
}

export interface CableInput {
  loadOhm: number;
  /** Amplifier output impedance, Ω (0 allowed: an ideal source). */
  sourceOhm: number;
  /** One-way cable length, m. */
  lengthM: number;
  /** Conductor cross-section in SI, m² (2.5 mm² = 2.5 × 10⁻⁶ m², as the unit reader delivers it). */
  areaM2?: number;
  /** AWG gauge number (0000 = −3). */
  awg?: number;
}

export interface CableResult {
  ok: true;
  /** Conductor area, m². */
  areaM2: number;
  /** The same in mm², for display. */
  areaMm2: number;
  /** Round-trip conductor resistance, Ω. */
  cableOhm: number;
  /** Damping factor at the speaker terminals: Zload/(Zout + Rcable). */
  dampingFactor: number;
  /** The amplifier's own damping factor, Zload/Zout; null for Zout = 0. */
  amplifierDampingFactor: number | null;
  /** Level at the load against an IDEAL source (zero source and cable resistance), dB. */
  lossDb: number;
  /** The cable's own insertion loss (with vs without the cable, same amplifier), dB. */
  cableInsertionLossDb: number;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Speaker cable resistance and damping factor. 2 × 10 m of 2.5 mm² copper:
 * R = 0.137931 Ω; into 8 Ω from 0.02 Ω, DF = 50.655 and the level is
 * −0.1698 dB against an ideal source (−0.1485 dB of it the cable's).
 */
export function cableDamping(input: CableInput): CableResult | AudioError {
  if (!input) return fail("No cable given.");
  const { loadOhm, sourceOhm, lengthM } = input;
  const bad = finitePositive([
    ["load impedance", loadOhm],
    ["cable length", lengthM],
  ]);
  if (bad) return bad;
  if (!Number.isFinite(sourceOhm) || sourceOhm < 0) return fail("The amplifier output impedance must be zero or positive.");
  if (lengthM > 1000) return fail("A speaker run over 1 km is a distributed line, not a lumped resistance.");
  if (loadOhm > 1000 || sourceOhm > 1000) return fail("Impedances above 1000 Ω are not a loudspeaker circuit.");
  const haveA = input.areaM2 !== undefined && input.areaM2 !== null;
  const haveG = input.awg !== undefined && input.awg !== null;
  if (haveA === haveG) return fail("Give either the conductor area (e.g. 2.5 mm²) or an AWG number, not both.");
  let area: number;
  const notes: string[] = [];
  if (haveG) {
    const n = input.awg!;
    if (!Number.isInteger(n) || n < -3 || n > 40) return fail("AWG is a whole number from 0000 (−3) to 40.");
    const d = awgDiameterMm(n);
    area = (Math.PI * d * d) / 4;
    notes.push(`AWG ${n < 1 ? "0".repeat(1 - n) : n}: d = 0.127 × 92^((36 − n)/39) = ${d.toFixed(5)} mm, A = ${area.toFixed(5)} mm² (ASTM B258).`);
  } else {
    const b2 = finitePositive([["conductor area", input.areaM2!]]);
    if (b2) return b2;
    area = input.areaM2! * 1e6;
    if (area > 1000) {
      return fail(
        "A conductor over 1000 mm² is a busbar, not a speaker cable. (A bare number is read in m²: give the area " +
          "with its unit, e.g. 2.5 mm².)",
      );
    }
    if (area < 0.001) {
      return fail(`${fmtNum(area)} mm² is thinner than any wire gauge (AWG 40 is 0.005 mm²); give the area with its unit, e.g. 2.5 mm².`);
    }
  }
  const rCable = (COPPER_RHO_OHM_MM2_PER_M * 2 * lengthM) / area;
  const df = loadOhm / (sourceOhm + rCable);
  const lossDb = 20 * Math.log10(loadOhm / (loadOhm + sourceOhm + rCable));
  const cableLoss = 20 * Math.log10((loadOhm + sourceOhm) / (loadOhm + sourceOhm + rCable));
  notes.push(
    `R = ρ·2ℓ/A with ρ = 1/58 Ω·mm²/m (annealed copper at 20 °C, IEC 60028 100% IACS): ${rCable.toFixed(6)} Ω ` +
      "round trip (both conductors).",
    `Damping factor at the speaker = ${fmtNum(loadOhm)} / (${fmtNum(sourceOhm)} + ${rCable.toFixed(6)}) = ${df.toFixed(3)}. The cable, ` +
      "not the amplifier, usually sets it.",
    `Level at the speaker: ${lossDb.toFixed(4)} dB against an ideal source; the cable's own share is ` +
      `${cableLoss.toFixed(4)} dB. Resistive load at the nominal impedance; a real driver's impedance varies with frequency.`,
  );
  const lengths = logSpace(1, Math.max(50, lengthM * 2), 41);
  const areas = [1.5, 2.5, 4];
  if (!areas.some((a) => Math.abs(a - area) < 1e-9)) areas.push(area);
  return {
    ok: true,
    areaM2: area * 1e-6,
    areaMm2: area,
    cableOhm: rCable,
    dampingFactor: df,
    amplifierDampingFactor: sourceOhm > 0 ? loadOhm / sourceOhm : null,
    lossDb,
    cableInsertionLossDb: cableLoss,
    notes,
    figure: {
      kind: "line",
      title: "Damping factor against cable length",
      xLabel: "one-way length (m)",
      yLabel: "damping factor",
      xLog: true,
      yLog: true,
      series: areas.map((a) => ({
        label: `${Number(a.toPrecision(4))} mm²`,
        points: finitePoints(lengths.map((l) => ({ x: l, y: loadOhm / (sourceOhm + (COPPER_RHO_OHM_MM2_PER_M * 2 * l) / a) }))),
      })),
      markers: [{ axis: "x", at: lengthM, label: "entered length" }],
    },
  };
}
