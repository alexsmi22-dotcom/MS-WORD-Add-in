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

export interface AudioError {
  ok: false;
  error: string;
}

/** Speed of sound in air at 20 °C, m/s. Varies ~0.6 m/s per °C — see notes. */
export const SPEED_OF_SOUND_20C = 343;

/** Reference sound pressure for dB SPL, Pa (20 µPa, the nominal hearing threshold). */
export const P_REF_SPL = 20e-6;

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
  /** Theoretical SNR of an ideal quantiser, dB: 6.02n + 1.76. */
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
  const snrDb = 6.02 * bits + 1.76;
  const lsbFraction = 1 / levels;

  let lsbVolts: number | null = null;
  if (fullScaleVolts !== undefined) {
    const bad = finitePositive([["full-scale voltage", fullScaleVolts]]);
    if (bad) return bad;
    lsbVolts = fullScaleVolts / levels;
  }

  let bitRate: number | null = null;
  const notes: string[] = [
    "SNR = 6.02n + 1.76 dB. The 6.02 per bit is 20·log₁₀(2) — a bit halves the quantisation " +
      "step, which is a voltage. The 1.76 dB is 10·log₁₀(3/2), from a full-scale sine's power " +
      "against uniformly distributed quantisation error; dropping it understates every " +
      "converter.",
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
      `Reference: 0 dB SPL is ${P_REF_SPL * 1e6} µPa, the nominal threshold of hearing.`,
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
  /** Critical distance in this room, m. */
  criticalDistance: number;
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
): ReverbResult | AudioError {
  const bad = finitePositive([
    ["room volume", volumeM3],
    ["total surface area", surfaceAreaM2],
  ]);
  if (bad) return bad;
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
  // Critical distance where direct and reverberant fields are equal, for an
  // omnidirectional source: 0.057·sqrt(V/RT60).
  const criticalDistance = 0.057 * Math.sqrt(volumeM3 / sabineS);

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
      `Speed of sound taken as ${speedOfSound} m/s (dry air, about 20 °C). It rises roughly ` +
        "0.6 m/s per °C, which shifts every frequency here by about 0.2% per degree.",
    ],
  };
}
