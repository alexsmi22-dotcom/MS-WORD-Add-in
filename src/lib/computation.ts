// Computation and information theory — parallel speedup, Shannon entropy and
// channel capacity, collision probability, floating-point precision, and
// empirical runtime scaling.
//
// EVERY BOUND HERE IS A THEOREM, not a fitted constant, and each is derived from
// its own statement rather than typed as a decimal. What goes wrong in this
// domain is that the LAWS ARE EASY TO STATE AND EASY TO APPLY TO THE WRONG
// QUESTION, so each function says what question it answers:
//
//   - Amdahl and Gustafson do NOT disagree; they answer different questions.
//     Amdahl holds the PROBLEM fixed and asks how much faster it finishes.
//     Gustafson holds the TIME fixed and asks how much more work gets done. Their
//     parallel fractions are fractions of different things, so quoting one p in
//     the other's formula is meaningless rather than merely inaccurate.
//   - A collision probability is not "n²/2d" — that is an expectation, and it
//     exceeds 1 long before a collision is certain.
//   - Machine epsilon is the spacing at 1.0, not an absolute error bound: the
//     spacing at 10^6 is a million times larger, which is the whole reason
//     catastrophic cancellation is a thing.
//   - An asymptotic complexity class predicts a RATIO, never an absolute time.

// ---------------------------------------------------------------------------
// Parallel speedup
// ---------------------------------------------------------------------------

export interface SpeedupResult {
  /** Amdahl speedup at this processor count: fixed problem size. */
  amdahl: number;
  /** Gustafson speedup: fixed time, problem scales with the machine. */
  gustafson: number;
  /** Amdahl's ceiling as processors go to infinity, 1/(1-p). */
  amdahlCeiling: number;
  /** Amdahl speedup divided by the processor count. */
  efficiency: number;
  /** Processor count at which Amdahl efficiency falls to 50%. */
  halfEfficiencyN: number;
  /** Karp-Flatt experimentally determined serial fraction, when a measured speedup is given. */
  karpFlatt: number | null;
  notes: string[];
}

/**
 * Parallel speedup by both laws, because reporting one alone answers half the
 * question.
 *
 *   Amdahl:    S = 1 / ((1-p) + p/N)          -> ceiling 1/(1-p)
 *   Gustafson: S = (1-p) + p*N                -> unbounded, linear in N
 *
 * THE TWO p's ARE FRACTIONS OF DIFFERENT THINGS. Amdahl's p is the parallel
 * fraction of the SERIAL runtime; Gustafson's is the parallel fraction of the
 * PARALLEL runtime, on a problem that has been scaled up to fill the machine.
 * They coincide only when N = 1. Using a measured single-core profile as
 * Gustafson's p overstates the scaled speedup, and the note says so.
 */
export function parallelSpeedup(parallelFraction: number, processors: number, measuredSpeedup?: number): SpeedupResult | null {
  const p = parallelFraction;
  const n = processors;
  if (![p, n].every(Number.isFinite)) return null;
  if (p < 0 || p > 1) return null;
  if (n < 1) return null;

  const amdahl = 1 / (1 - p + p / n);
  const gustafson = 1 - p + p * n;
  const amdahlCeiling = p === 1 ? Infinity : 1 / (1 - p);

  // WHERE HALF THE MACHINE IS BEING WASTED, in closed form.
  //
  // This was a search over POWERS OF TWO for "doubling gains under 1%", which was
  // quantised to a factor of two, capped out at 2^20 (so p >= 0.99995 reported
  // Infinity), and — because the loop was guarded by p > 0 — reported "no
  // diminishing returns" for a FULLY SERIAL program, which is the one program
  // that has nothing else.
  //
  // Efficiency E = S/N = 1/(N(1-p) + p). Setting E = 1/2 gives
  // N = (2-p)/(1-p) exactly, with no loop and no quantisation. For p = 0.95 that
  // is 21 processors, which sits sensibly against the 20x ceiling; for a fully
  // serial program it is 2, which is correct — the second core is already half
  // wasted.
  const halfEfficiencyN = p === 1 ? Infinity : (2 - p) / (1 - p);

  const notes: string[] = [
    "Amdahl holds the PROBLEM fixed and asks how much sooner it finishes; Gustafson holds the " +
      "TIME fixed and asks how much more work fits. They do not contradict each other — they " +
      "answer different questions, and both are reported because quoting one alone answers half.",
    "The two parallel fractions are fractions of DIFFERENT totals: Amdahl's is of the serial " +
      "runtime, Gustafson's is of the parallel runtime on a problem scaled to fill the machine. " +
      "They coincide only at N = 1, so a single-core profile put into Gustafson overstates it.",
  ];
  if (p === 1) {
    notes.push("A perfectly parallel fraction of 1 has no ceiling — which no real program has, because at minimum the work must be distributed and collected.");
  } else if (amdahlCeiling < n) {
    notes.push(
      `The Amdahl ceiling is ${amdahlCeiling.toPrecision(4)}x, BELOW the ${n} processors given: ` +
        "past that point more cores cannot help at all, however many are added. The serial " +
        `${((1 - p) * 100).toPrecision(3)}% is what bounds it.`,
    );
  }

  let karpFlatt: number | null = null;
  if (measuredSpeedup !== undefined) {
    if (!Number.isFinite(measuredSpeedup) || measuredSpeedup <= 0) return null;
    if (n > 1) {
      karpFlatt = (1 / measuredSpeedup - 1 / n) / (1 - 1 / n);
      notes.push(
        `Karp-Flatt serial fraction from the MEASURED speedup: ${karpFlatt.toPrecision(4)}. If this ` +
          "rises as processors are added, the loss is parallel overhead rather than an inherently " +
          "serial section — that is the whole point of the metric, and a single value cannot " +
          "distinguish them.",
      );
      if (karpFlatt < 0) {
        notes.push(
          "That serial fraction is NEGATIVE, which is not physically meaningful: it means the " +
            "measured speedup exceeded what Amdahl allows for any serial fraction at all. Usually " +
            "that is superlinear speedup from cache effects — the parallel run had more total " +
            "cache — or a mis-measured baseline.",
        );
      }
    } else {
      notes.push("Karp-Flatt needs more than one processor to say anything.");
    }
  }

  return {
    amdahl,
    gustafson,
    amdahlCeiling,
    efficiency: amdahl / n,
    halfEfficiencyN,
    karpFlatt,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Entropy
// ---------------------------------------------------------------------------

export interface EntropyResult {
  /** Shannon entropy in bits per symbol. */
  entropyBits: number;
  /** log2 of the alphabet size — the most any distribution over it can carry. */
  maxEntropyBits: number;
  /** 1 - H/Hmax. */
  redundancy: number;
  /** Ideal compressed size of `count` symbols, bits. */
  idealBits: number | null;
  /** Whether the input probabilities had to be normalised. */
  normalised: boolean;
  notes: string[];
}

/**
 * Shannon entropy of a discrete distribution.
 *
 *   H = -sum p_i log2 p_i,  maximised at log2(n) by the uniform distribution.
 *
 * A ZERO PROBABILITY CONTRIBUTES ZERO, by the limit p log p -> 0, not NaN — and
 * getting that wrong poisons the whole sum. Probabilities are normalised if they
 * do not sum to 1, and the result says so rather than silently rescaling.
 */
export function shannonEntropy(weights: number[], count?: number): EntropyResult | null {
  if (!Array.isArray(weights) || weights.length === 0) return null;
  if (!weights.every((w) => Number.isFinite(w) && w >= 0)) return null;
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;

  const notes: string[] = [];
  const normalised = Math.abs(total - 1) > 1e-9;
  const p = weights.map((w) => w / total);

  let entropyBits = 0;
  for (const q of p) {
    // The p -> 0 limit of p*log2(p) is 0. Evaluating it directly gives NaN and
    // would destroy the whole sum, so a zero-probability symbol is skipped.
    if (q > 0) entropyBits -= q * Math.log2(q);
  }
  const maxEntropyBits = Math.log2(weights.length);

  if (normalised) {
    notes.push(
      `The weights summed to ${total.toPrecision(6)} rather than 1, so they were normalised. ` +
        "That is the right reading for counts or frequencies; if they were meant to be " +
        "probabilities, they do not describe a distribution.",
    );
  }
  const zeros = p.filter((q) => q === 0).length;
  if (zeros) {
    notes.push(
      `${zeros} symbol${zeros === 1 ? "" : "s"} had zero probability and contributed nothing, by ` +
        "the limit p·log p → 0. Such symbols still count towards the alphabet size, so they " +
        "lower the redundancy figure without carrying information.",
    );
  }
  notes.push(
    "Entropy is a bound on LOSSLESS compression of independent symbols drawn from this " +
      "distribution. Real data has structure between symbols, so a good compressor routinely " +
      "beats the per-symbol entropy — that is not a violation of the theorem, it is a different " +
      "model.",
  );

  let idealBits: number | null = null;
  if (count !== undefined) {
    if (!Number.isFinite(count) || count < 0) return null;
    idealBits = entropyBits * count;
  }

  return {
    entropyBits,
    maxEntropyBits,
    redundancy: maxEntropyBits > 0 ? 1 - entropyBits / maxEntropyBits : 0,
    idealBits,
    normalised,
    notes,
  };
}

/** Binary entropy in bits; h(0) = h(1) = 0 by continuity. */
export function binaryEntropyBits(p: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 1) return NaN;
  if (p === 0 || p === 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

// ---------------------------------------------------------------------------
// Channel capacity
// ---------------------------------------------------------------------------

export interface CapacityResult {
  /** Shannon-Hartley capacity, bits per second. */
  capacityBps: number;
  /** SNR as a linear power ratio. */
  snrLinear: number;
  snrDb: number;
  /** Spectral efficiency, bits per second per hertz. */
  spectralEfficiency: number;
  /** Minimum Eb/N0 for error-free coding at this efficiency, dB. */
  ebN0Db: number;
  notes: string[];
}

/**
 * Shannon-Hartley capacity, C = B log2(1 + S/N).
 *
 * SNR IS A POWER RATIO and dB is 10 log10 of it, not 20 — the 20 applies to
 * amplitude ratios, and using it halves the exponent and badly overstates the
 * capacity. The conversion is done here rather than in the unit converter,
 * because dB is a logarithmic RELATION and not a scale factor: teaching the
 * converter a nonlinear case would break its guarantee that a unit of the wrong
 * quantity is refused.
 */
export function channelCapacity(bandwidthHz: number, snrDb: number): CapacityResult | null {
  if (![bandwidthHz, snrDb].every(Number.isFinite)) return null;
  if (bandwidthHz <= 0) return null;

  const snrLinear = Math.pow(10, snrDb / 10);
  const spectralEfficiency = Math.log2(1 + snrLinear);
  const capacityBps = bandwidthHz * spectralEfficiency;
  // Minimum energy per bit for error-free transmission at this efficiency.
  const ebN0 = (Math.pow(2, spectralEfficiency) - 1) / spectralEfficiency;

  const notes: string[] = [
    "SNR in dB is 10·log₁₀ of a POWER ratio. The 20·log₁₀ form is for amplitude ratios, and " +
      "using it here would double the effective dB and badly overstate the capacity.",
    "This is an upper bound achievable only with unbounded coding delay and complexity. It says " +
      "nothing about any particular modulation, and a real link runs some way below it.",
  ];
  if (snrDb < 0) {
    notes.push(
      "A negative SNR in dB means the noise exceeds the signal. Capacity is still positive — " +
        "below-noise communication is possible, and is how spread-spectrum systems work.",
    );
  }
  notes.push(
    `As the spectral efficiency goes to zero the required Eb/N₀ approaches the Shannon limit of ` +
      `${(10 * Math.log10(Math.LN2)).toPrecision(4)} dB, below which no code of any rate can work.`,
  );

  return {
    capacityBps,
    snrLinear,
    snrDb,
    spectralEfficiency,
    ebN0Db: 10 * Math.log10(ebN0),
    notes,
  };
}

/** Binary symmetric channel capacity, 1 - h(p) bits per use. */
export function bscCapacity(errorRate: number): { capacity: number; notes: string[] } | null {
  if (!Number.isFinite(errorRate) || errorRate < 0 || errorRate > 1) return null;
  const capacity = 1 - binaryEntropyBits(errorRate);
  const notes: string[] = [];
  if (Math.abs(errorRate - 0.5) < 1e-12) {
    notes.push(
      "At an error rate of exactly one half the capacity is ZERO: the output is independent of " +
        "the input, so no code can carry anything.",
    );
  } else if (errorRate > 0.5) {
    notes.push(
      "An error rate above one half is a channel that mostly INVERTS. Its capacity is the same " +
        "as 1 − p by symmetry — flip every bit on reception and it becomes the better channel.",
    );
  }
  return { capacity, notes };
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

export interface CollisionResult {
  /** Probability that at least two of n items share a value. */
  probability: number;
  /** Expected number of colliding PAIRS. */
  expectedPairs: number;
  /** Items needed for a 50% chance of a collision. */
  fiftyPercentCount: number;
  /** Whether the exact product or the exponential approximation was used. */
  method: "exact" | "approximation";
  notes: string[];
}

/**
 * Birthday-bound collision probability for n items drawn uniformly from d values.
 *
 * THE EXPECTED NUMBER OF COLLIDING PAIRS IS NOT THE PROBABILITY OF A COLLISION.
 * n(n-1)/2d is an expectation and happily exceeds 1 while the probability is
 * still below 1; quoting it as a probability is the commonest error here, so both
 * are reported and labelled.
 *
 * The exact product is used for small n and the exponential approximation above
 * that, with a hard iteration cap: an uncapped loop over n would freeze the pane
 * for a large n, and this is a tool that runs inside a Word task pane.
 */
export function collisionProbability(items: number, space: number): CollisionResult | null {
  if (![items, space].every(Number.isFinite)) return null;
  if (items < 0 || space <= 0) return null;
  // A fractional number of items is not a collision problem: the exact product
  // walks i = 1..n-1 and would silently answer for ceil(n) while the expected
  // pairs stayed continuous, so the two reported figures described different n.
  if (!Number.isInteger(items)) return null;
  if (items <= 1) {
    return {
      probability: 0,
      expectedPairs: 0,
      fiftyPercentCount: 1.1774100225154747 * Math.sqrt(space),
      method: "exact",
      notes: ["Fewer than two items cannot collide."],
    };
  }
  if (items > space) {
    return {
      probability: 1,
      expectedPairs: (items * (items - 1)) / (2 * space),
      fiftyPercentCount: 1.1774100225154747 * Math.sqrt(space),
      method: "exact",
      notes: [
        "There are more items than distinct values, so by the pigeonhole principle a collision " +
          "is CERTAIN — probability exactly 1, not merely close to it.",
      ],
    };
  }

  const EXACT_CAP = 20000;
  let probability: number;
  let method: "exact" | "approximation";
  if (items <= EXACT_CAP) {
    // 1 - prod_{i=1}^{n-1} (1 - i/d), summed in log space via log1p for accuracy.
    let logNoCollision = 0;
    for (let i = 1; i < items; i++) logNoCollision += Math.log1p(-i / space);
    probability = -Math.expm1(logNoCollision);
    method = "exact";
  } else {
    probability = -Math.expm1((-items * (items - 1)) / (2 * space));
    method = "approximation";
  }

  const expectedPairs = (items * (items - 1)) / (2 * space);
  const notes: string[] = [
    "The EXPECTED number of colliding pairs is not the probability of a collision: it is an " +
      "expectation and exceeds 1 long before a collision is certain. Both are shown because " +
      "quoting the first as the second is the commonest error here.",
  ];
  if (method === "approximation") {
    notes.push(
      `Above ${EXACT_CAP} items the exponential approximation 1 − exp(−n(n−1)/2d) is used ` +
        "instead of the exact product, which would need one multiplication per item. It is " +
        "accurate to well under a percent whenever n is small against d, which is the regime " +
        "a hash sizing question lives in.",
    );
  }
  notes.push(
    "Uniformity is ASSUMED. A real hash with any bias collides sooner than this, and an " +
      "adversary choosing inputs is not described by this model at all — that is a preimage or " +
      "collision attack, not a birthday bound.",
  );

  return {
    probability,
    expectedPairs,
    fiftyPercentCount: 1.1774100225154747 * Math.sqrt(space),
    method,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Floating point
// ---------------------------------------------------------------------------

/**
 * Decimal digits of precision for IEEE-754 double.
 *
 * Based on the UNIT ROUNDOFF eps/2, not on eps itself. Round-to-nearest halves
 * the worst-case relative error, so the figure is log10(2^53) = 15.95 — the
 * number everyone quotes — rather than log10(2^52) = 15.65. Using the raw
 * spacing understates the precision by a third of a digit.
 */
const DOUBLE_DECIMAL_DIGITS = -Math.log10(Number.EPSILON / 2);

/**
 * Spacing between `a` and the next representable double above it, read from the
 * IEEE-754 exponent field rather than computed from a logarithm.
 *
 * Subnormals all share the minimum spacing, which is Number.MIN_VALUE.
 */
function ulpOf(a: number): number {
  if (a === 0) return Number.MIN_VALUE;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, a);
  // Bits 62-52 are the biased exponent; 0 marks a subnormal.
  const biased = ((buf.getUint32(0) >>> 20) & 0x7ff) as number;
  if (biased === 0) return Number.MIN_VALUE;
  const unbiased = biased - 1023;
  // 2^(e-52), clamped: for very small exponents the true spacing is the
  // subnormal minimum rather than an underflow to zero.
  return Math.max(Math.pow(2, unbiased - 52), Number.MIN_VALUE);
}

export interface FloatResult {
  /** Machine epsilon for IEEE-754 double: the spacing just above 1.0. */
  epsilon: number;
  /** Spacing between representable doubles at the given magnitude. */
  ulp: number;
  /** ulp / |value| — the relative resolution there. */
  relativeSpacing: number;
  /** Roughly how many decimal digits are meaningful. */
  decimalDigits: number;
  /** Relative error amplification of a - b when they nearly cancel. */
  cancellationFactor: number | null;
  /** Digits lost to that cancellation. */
  digitsLost: number | null;
  notes: string[];
}

/**
 * Floating-point resolution at a magnitude, and the cost of cancellation.
 *
 * MACHINE EPSILON IS THE SPACING AT 1.0, NOT AN ABSOLUTE ERROR BOUND. At 10^6 the
 * gap between representable doubles is a million times larger, which is exactly
 * why subtracting two nearly equal large numbers destroys precision: the answer
 * inherits the ABSOLUTE error of its inputs while being much smaller than them.
 */
export function floatPrecision(value: number, subtractFrom?: number): FloatResult | null {
  if (!Number.isFinite(value)) return null;
  const epsilon = Number.EPSILON;

  // ULP FROM THE BIT PATTERN, not from Math.log2.
  //
  // The obvious 2^(floor(log2|x|) - 52) is wrong twice over:
  //
  //   1. Math.log2 is not correctly rounded. Just below a power of two it returns
  //      the exponent EXACTLY, so floor gives e instead of e-1 and the spacing
  //      comes out 2x too large. 1023.9999999999999 reported 2.27e-13 where the
  //      real gap is 1.14e-13, and 2041 of 2045 exponents have such a band.
  //   2. Below 2^-1022 the exponent goes subnormal and Math.pow UNDERFLOWS TO
  //      ZERO, so 1e-310 reported a spacing of 0 — claiming infinite precision
  //      exactly where doubles have the least.
  //
  // Reading the exponent field directly is exact and has neither problem.
  const a = Math.abs(value);
  const ulp = ulpOf(a);
  const relativeSpacing = a === 0 ? 0 : ulp / a;

  const notes: string[] = [
    "Machine epsilon is the spacing just above 1.0, NOT an absolute error bound. The gap between " +
      "representable doubles scales with magnitude, so at 10⁶ it is a million times larger.",
  ];

  let cancellationFactor: number | null = null;
  let digitsLost: number | null = null;
  if (subtractFrom !== undefined) {
    if (!Number.isFinite(subtractFrom)) return null;
    const diff = subtractFrom - value;
    if (diff === 0) {
      notes.push("The two values are exactly equal, so the difference is exactly zero and every significant digit has cancelled.");
      cancellationFactor = Infinity;
      digitsLost = Infinity;
    } else {
      cancellationFactor = Math.max(Math.abs(subtractFrom), a) / Math.abs(diff);
      digitsLost = Math.max(0, Math.log10(cancellationFactor));
      notes.push(
        `CATASTROPHIC CANCELLATION: the difference is ${cancellationFactor.toPrecision(4)}x smaller ` +
          `than the operands, so about ${digitsLost.toFixed(1)} decimal digits of precision are ` +
          "lost. The subtraction itself is exact — the error was already in the inputs, and the " +
          "cancellation merely exposes it. Rearranging the algebra to avoid the subtraction is " +
          "the fix; more precision only postpones it.",
      );
    }
  }

  return {
    epsilon,
    ulp,
    relativeSpacing,
    decimalDigits: DOUBLE_DECIMAL_DIGITS,
    cancellationFactor,
    digitsLost,
    notes,
  };
}


// ---------------------------------------------------------------------------
// Runtime scaling
// ---------------------------------------------------------------------------

export interface ScalingResult {
  /** Empirical exponent k in t ~ n^k, from two measurements. */
  exponent: number;
  /** The named class whose exponent is closest. */
  nearestClass: string;
  /** Predicted time at the target size. */
  predicted: number | null;
  /** How many times longer than the second measurement. */
  growthFactor: number | null;
  notes: string[];
}

/**
 * The POWER-LAW classes only.
 *
 * O(log n) is deliberately absent: it is not a power law at all, and pinning it
 * to a single exponent is meaningless — genuine logarithmic data measured from
 * 10^6 to 10^9 fits k = 0.059, which the old table with log n at k = 0.15 filed
 * under "O(1), constant". Sub-linear exponents are reported as sub-linear and
 * explained, rather than forced onto a name that cannot fit them.
 */
const CLASSES: Array<{ name: string; k: number }> = [
  { name: "O(1), constant", k: 0 },
  { name: "O(n), linear", k: 1 },
  { name: "O(n log n), linearithmic", k: 1.1 },
  { name: "O(n²), quadratic", k: 2 },
  { name: "O(n³), cubic", k: 3 },
];

/**
 * The empirical scaling exponent from two measurements, and a prediction.
 *
 *   k = log(t2/t1) / log(n2/n1)
 *
 * THIS FITS A POWER LAW AND NOTHING ELSE. Two points cannot distinguish n log n
 * from n^1.1, and they cannot see an exponential at all — 2^n through two points
 * looks like a very large power. The class is reported as the NEAREST one, with
 * that limitation stated, rather than as an identification.
 */
export function runtimeScaling(n1: number, t1: number, n2: number, t2: number, targetN?: number): ScalingResult | null {
  if (![n1, t1, n2, t2].every(Number.isFinite)) return null;
  if (n1 <= 0 || n2 <= 0 || t1 <= 0 || t2 <= 0) return null;
  if (n1 === n2) return null; // no leverage: the exponent is undefined

  const exponent = Math.log(t2 / t1) / Math.log(n2 / n1);
  if (!Number.isFinite(exponent)) return null;

  let nearest = CLASSES[0];
  for (const c of CLASSES) if (Math.abs(c.k - exponent) < Math.abs(nearest.k - exponent)) nearest = c;
  // A name is only offered when the exponent is actually near one. Otherwise the
  // "nearest class" is a label the data does not support.
  //
  // The SUB-LINEAR band gets its own answer rather than being rounded to
  // "constant": genuine logarithmic growth fits k ~ 0.06 over three decades, and
  // calling that constant is exactly the misreading this is meant to prevent.
  // "Constant" therefore needs k within measurement noise of zero.
  let nearestClass: string;
  if (exponent > 0.02 && exponent < 0.85) {
    nearestClass = `sub-linear (k = ${exponent.toPrecision(3)}) — not a power-law class`;
  } else if (Math.abs(nearest.k - exponent) <= 0.15) {
    nearestClass = nearest.name;
  } else {
    nearestClass = `between named classes (k = ${exponent.toPrecision(3)})`;
  }

  const notes: string[] = [
    `Empirical exponent ${exponent.toPrecision(4)} from t ∝ n^k. TWO POINTS FIT A POWER LAW AND ` +
      "NOTHING ELSE: they cannot separate n·log n from n^1.1, and they cannot see an exponential " +
      "at all — 2ⁿ through two points looks like a very large power. The class below is the " +
      "nearest one, not an identification.",
    "An asymptotic class predicts a RATIO, never an absolute time. Constants, cache behaviour " +
      "and memory pressure dominate at the sizes most code actually runs at, and a measured " +
      "exponent below the theoretical one usually means the problem still fits in cache.",
  ];
  if (exponent > 0 && exponent < 0.85) {
    notes.push(
      "A SUB-LINEAR exponent is consistent with logarithmic growth, which is not a power law at " +
        "all and so has no single exponent — genuine log n measured over three decades fits " +
        "k ~ 0.06. It is also what a fixed overhead dominating a small workload looks like.",
    );
  }
  if (exponent < 0) {
    notes.push(
      "The exponent is NEGATIVE — the larger input ran faster. That is not a complexity class; " +
        "it is measurement noise, a warm cache, or a JIT that had not settled on the first run.",
    );
  }

  let predicted: number | null = null;
  let growthFactor: number | null = null;
  if (targetN !== undefined) {
    if (!Number.isFinite(targetN) || targetN <= 0) return null;
    predicted = t2 * Math.pow(targetN / n2, exponent);
    growthFactor = predicted / t2;
    if (targetN > n2 * 100) {
      notes.push(
        "The target is more than 100x beyond the measured range, so this is extrapolation rather " +
          "than interpolation. Whatever regime change is waiting — cache, memory, swap — is not " +
          "in the two points the exponent came from.",
      );
    }
  }

  return { exponent, nearestClass, predicted, growthFactor, notes };
}
