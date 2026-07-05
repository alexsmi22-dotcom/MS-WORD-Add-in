// Units & quantities engine: typeset physical quantities correctly (SI symbols,
// thin space between value and unit, superscript exponents, ·, µ, Ω, °, ±,
// scientific notation), convert between compatible units, and round to significant
// figures. Used across every experimental STEM field.
//
// Pure string/number logic — no Office.js — fully unit-testable. The HTML output
// is the same string used for the live preview and for Word.Range.insertHtml(),
// preserving the WYSIWYG invariant.

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺",
};

/** Unicode-superscripts a signed integer string (e.g. "-2" → "⁻²"). */
export function toSuperscript(s: string): string {
  return s.replace(/[-+0-9]/g, (c) => SUP[c] ?? c);
}

// Multi-char unit tokens → proper symbol (checked before single prefixes).
const UNIT_TOKENS: Array<[RegExp, string]> = [
  [/\bdeg\s*C\b/g, "°C"],
  [/\bdeg\s*F\b/g, "°F"],
  [/\bdeg\b/g, "°"],
  [/\bohms?\b/g, "Ω"],
  [/\bangstrom\b/gi, "Å"],
  // Spelled-out micro-units → µ-symbol (mapped to the short SI symbol).
  [/\bmicrograms?\b/g, "µg"],
  [/\bmicroli(?:ter|tre)s?\b/g, "µL"],
  [/\bmicrom(?:eter|etre)s?\b/g, "µm"],
  [/\bmicrons?\b/g, "µm"],
  [/\bmicroseconds?\b/g, "µs"],
  [/\bmicromolar\b/g, "µM"],
  [/\bmicromoles?\b/g, "µmol"],
  // micro-prefixed common units written with a leading ASCII "u".
  [/\bu(g|L|m|s|mol|M|N|F|A|V|W|Hz|Pa|J)\b/g, "µ$1"],
];

/**
 * Typesets a unit expression: superscript exponents (`m/s^2` → `m/s²`), `*` and
 * inter-symbol spaces → middle dot, and symbol fixes (`ohm`→Ω, `degC`→°C, `um`→µm).
 * Returns an HTML string (exponents as Unicode superscripts, so it is also valid
 * as plain text).
 */
export function formatUnit(expr: string): string {
  let s = expr.trim();
  for (const [re, sym] of UNIT_TOKENS) s = s.replace(re, sym);
  // Exponents: ^n or ^{n} (optionally signed) → superscript.
  s = s.replace(/\^\{?([-+]?\d+)\}?/g, (_m, n: string) => toSuperscript(n.replace(/^\+/, "")));
  // Collapse whitespace around a division slash so "m / s" stays "m/s".
  s = s.replace(/\s*\/\s*/g, "/");
  // Explicit multiplication and remaining spaces between unit factors → middle dot.
  s = s.replace(/\s*\*\s*/g, "·").replace(/\s+/g, "·");
  return s;
}

export interface ParsedQuantity {
  value: string;
  uncertainty?: string;
  exponent?: string;
  unit: string;
}

// value, optional ± uncertainty, optional ×10^exp, then the unit (the rest).
const QTY_RE =
  /^\s*([-+]?\d*\.?\d+)\s*(?:(?:±|\+-|\+\/-)\s*(\d*\.?\d+))?\s*(?:[eE]\s*([-+]?\d+)|(?:×|x|\*)\s*10\^?\{?([-+]?\d+)\}?)?\s*(.*)$/;

/** Splits "5.0 +- 0.2 kg" / "1.2e3 m/s" into value, uncertainty, exponent, unit. */
export function parseQuantity(input: string): ParsedQuantity | null {
  const m = QTY_RE.exec(input);
  if (!m) return null;
  return {
    value: m[1],
    uncertainty: m[2],
    exponent: m[3] ?? m[4],
    unit: (m[5] ?? "").trim(),
  };
}

const THIN = "&#8201;"; // thin space between value and unit

/**
 * Typesets a full quantity as HTML: value (with optional ± uncertainty and ×10ⁿ
 * scientific notation), a thin space, then the formatted unit.
 * e.g. "5.0 +- 0.2 kg" → "5.0 ± 0.2 kg"; "1.2e-3 mol/L" → "1.2 × 10⁻³ mol/L".
 */
export function formatQuantityHtml(input: string): string {
  const q = parseQuantity(input);
  if (!q) return "";
  let num = q.value;
  if (q.uncertainty) num += ` ± ${q.uncertainty}`;
  if (q.exponent) num += ` × 10${toSuperscript(q.exponent)}`;
  const unit = q.unit ? `${THIN}${formatUnit(q.unit)}` : "";
  return num + unit;
}

// --- Conversion --------------------------------------------------------------

interface UnitDef {
  dim: string;
  /** Multiply a value in this unit by `factor` to get the SI base value. */
  factor: number;
  /** Affine offset (temperatures): base = value*factor + offset. */
  offset?: number;
}

// Canonical units keyed by symbol; aliases are resolved in `lookup`.
const UNITS: Record<string, UnitDef> = {
  // length (base m)
  m: { dim: "length", factor: 1 }, km: { dim: "length", factor: 1000 },
  cm: { dim: "length", factor: 0.01 }, mm: { dim: "length", factor: 0.001 },
  µm: { dim: "length", factor: 1e-6 }, nm: { dim: "length", factor: 1e-9 },
  pm: { dim: "length", factor: 1e-12 },
  in: { dim: "length", factor: 0.0254 }, ft: { dim: "length", factor: 0.3048 },
  yd: { dim: "length", factor: 0.9144 }, mi: { dim: "length", factor: 1609.344 },
  Å: { dim: "length", factor: 1e-10 },
  // mass (base kg)
  kg: { dim: "mass", factor: 1 }, g: { dim: "mass", factor: 0.001 },
  mg: { dim: "mass", factor: 1e-6 }, µg: { dim: "mass", factor: 1e-9 },
  ng: { dim: "mass", factor: 1e-12 }, pg: { dim: "mass", factor: 1e-15 },
  lb: { dim: "mass", factor: 0.45359237 }, oz: { dim: "mass", factor: 0.028349523 },
  // molecular mass (daltons, base kg)
  Da: { dim: "mass", factor: 1.66053906660e-27 }, kDa: { dim: "mass", factor: 1.66053906660e-24 },
  MDa: { dim: "mass", factor: 1.66053906660e-21 },
  // time (base s)
  s: { dim: "time", factor: 1 }, ms: { dim: "time", factor: 0.001 },
  µs: { dim: "time", factor: 1e-6 }, ns: { dim: "time", factor: 1e-9 }, ps: { dim: "time", factor: 1e-12 },
  min: { dim: "time", factor: 60 },
  h: { dim: "time", factor: 3600 }, day: { dim: "time", factor: 86400 },
  // temperature (base K, affine)
  K: { dim: "temp", factor: 1, offset: 0 },
  "°C": { dim: "temp", factor: 1, offset: 273.15 },
  "°F": { dim: "temp", factor: 5 / 9, offset: (459.67 * 5) / 9 },
  // volume (base m^3)
  L: { dim: "volume", factor: 0.001 }, mL: { dim: "volume", factor: 1e-6 },
  µL: { dim: "volume", factor: 1e-9 }, nL: { dim: "volume", factor: 1e-12 }, "m^3": { dim: "volume", factor: 1 },
  // pressure (base Pa)
  Pa: { dim: "pressure", factor: 1 }, kPa: { dim: "pressure", factor: 1000 },
  bar: { dim: "pressure", factor: 1e5 }, atm: { dim: "pressure", factor: 101325 },
  psi: { dim: "pressure", factor: 6894.757 }, mmHg: { dim: "pressure", factor: 133.322 },
  // energy (base J)
  J: { dim: "energy", factor: 1 }, kJ: { dim: "energy", factor: 1000 },
  cal: { dim: "energy", factor: 4.184 }, kcal: { dim: "energy", factor: 4184 },
  eV: { dim: "energy", factor: 1.602176634e-19 }, Wh: { dim: "energy", factor: 3600 },
  // amount of substance (base mol)
  mol: { dim: "amount", factor: 1 }, mmol: { dim: "amount", factor: 0.001 },
  µmol: { dim: "amount", factor: 1e-6 }, nmol: { dim: "amount", factor: 1e-9 },
  // angle (base rad)
  rad: { dim: "angle", factor: 1 }, "°": { dim: "angle", factor: Math.PI / 180 },
  mrad: { dim: "angle", factor: 1e-3 },
  // frequency (base Hz)
  Hz: { dim: "frequency", factor: 1 }, kHz: { dim: "frequency", factor: 1e3 },
  MHz: { dim: "frequency", factor: 1e6 }, GHz: { dim: "frequency", factor: 1e9 }, THz: { dim: "frequency", factor: 1e12 },
  // electric current (base A)
  A: { dim: "current", factor: 1 }, mA: { dim: "current", factor: 1e-3 },
  µA: { dim: "current", factor: 1e-6 }, nA: { dim: "current", factor: 1e-9 }, kA: { dim: "current", factor: 1e3 },
  // voltage (base V)
  V: { dim: "voltage", factor: 1 }, mV: { dim: "voltage", factor: 1e-3 },
  µV: { dim: "voltage", factor: 1e-6 }, kV: { dim: "voltage", factor: 1e3 }, MV: { dim: "voltage", factor: 1e6 },
  // power (base W)
  W: { dim: "power", factor: 1 }, mW: { dim: "power", factor: 1e-3 }, µW: { dim: "power", factor: 1e-6 },
  kW: { dim: "power", factor: 1e3 }, MW: { dim: "power", factor: 1e6 }, GW: { dim: "power", factor: 1e9 },
  hp: { dim: "power", factor: 745.699872 },
  // resistance (base Ω)
  Ω: { dim: "resistance", factor: 1 }, mΩ: { dim: "resistance", factor: 1e-3 },
  kΩ: { dim: "resistance", factor: 1e3 }, MΩ: { dim: "resistance", factor: 1e6 },
  // capacitance (base F)
  F: { dim: "capacitance", factor: 1 }, mF: { dim: "capacitance", factor: 1e-3 },
  µF: { dim: "capacitance", factor: 1e-6 }, nF: { dim: "capacitance", factor: 1e-9 }, pF: { dim: "capacitance", factor: 1e-12 },
  // charge (base C)
  C: { dim: "charge", factor: 1 }, mC: { dim: "charge", factor: 1e-3 },
  µC: { dim: "charge", factor: 1e-6 }, nC: { dim: "charge", factor: 1e-9 },
  // inductance (base H)
  H: { dim: "inductance", factor: 1 }, mH: { dim: "inductance", factor: 1e-3 }, µH: { dim: "inductance", factor: 1e-6 },
  // conductance (base S)
  S: { dim: "conductance", factor: 1 }, mS: { dim: "conductance", factor: 1e-3 }, µS: { dim: "conductance", factor: 1e-6 },
  // magnetic flux density (base T)
  T: { dim: "bfield", factor: 1 }, mT: { dim: "bfield", factor: 1e-3 }, µT: { dim: "bfield", factor: 1e-6 },
  G: { dim: "bfield", factor: 1e-4 },
  // molarity (base M = mol/L)
  M: { dim: "molarity", factor: 1 }, mM: { dim: "molarity", factor: 1e-3 },
  µM: { dim: "molarity", factor: 1e-6 }, nM: { dim: "molarity", factor: 1e-9 }, pM: { dim: "molarity", factor: 1e-12 },
  // dimensionless fraction (base = ratio)
  "%": { dim: "fraction", factor: 0.01 }, ppm: { dim: "fraction", factor: 1e-6 },
  ppb: { dim: "fraction", factor: 1e-9 }, ppt: { dim: "fraction", factor: 1e-12 },
};

const ALIASES: Record<string, string> = {
  meter: "m", metre: "m", meters: "m", micron: "µm", um: "µm", micrometer: "µm",
  gram: "g", grams: "g", ug: "µg", microgram: "µg", kilogram: "kg", pound: "lb", pounds: "lb",
  sec: "s", secs: "s", second: "s", seconds: "s", us: "µs", minute: "min", minutes: "min",
  hr: "h", hour: "h", hours: "h", days: "day",
  degC: "°C", celsius: "°C", "°c": "°C", degF: "°F", fahrenheit: "°F", "°f": "°F", kelvin: "K",
  litre: "L", liter: "L", l: "L", ml: "mL", ul: "µL", microliter: "µL",
  atmosphere: "atm", deg: "°", degree: "°", degrees: "°", radian: "rad", radians: "rad",
  millimol: "mmol", millimole: "mmol", micromol: "µmol", umol: "µmol",
  nanometer: "nm", nanometre: "nm", picometer: "pm", picometre: "pm",
  nanosecond: "ns", nanoseconds: "ns", picosecond: "ps", picoseconds: "ps",
  nanogram: "ng", nanograms: "ng", picogram: "pg", picograms: "pg", nanoliter: "nL", nanolitre: "nL",
  dalton: "Da", daltons: "Da", kilodalton: "kDa", kilodaltons: "kDa", megadalton: "MDa",
  // electrical / EM spelled-out names
  hertz: "Hz", kilohertz: "kHz", megahertz: "MHz", gigahertz: "GHz",
  amp: "A", amps: "A", ampere: "A", amperes: "A", milliamp: "mA", milliamps: "mA", milliampere: "mA",
  volt: "V", volts: "V", millivolt: "mV", millivolts: "mV", kilovolt: "kV",
  watt: "W", watts: "W", milliwatt: "mW", kilowatt: "kW", megawatt: "MW", horsepower: "hp",
  ohm: "Ω", ohms: "Ω", kilohm: "kΩ", kiloohm: "kΩ", megohm: "MΩ", megaohm: "MΩ",
  farad: "F", farads: "F", microfarad: "µF", uf: "µF", nanofarad: "nF", picofarad: "pF",
  coulomb: "C", coulombs: "C", henry: "H", henries: "H", siemens: "S",
  tesla: "T", teslas: "T", gauss: "G",
  molar: "M", millimolar: "mM", micromolar: "µM", um_molar: "µM", nanomolar: "nM", picomolar: "pM",
  percent: "%", pct: "%",
};

function lookup(unit: string): UnitDef | null {
  const u = unit.trim();
  if (UNITS[u]) return UNITS[u];
  if (ALIASES[u]) return UNITS[ALIASES[u]];
  const lower = u.toLowerCase();
  if (ALIASES[lower]) return UNITS[ALIASES[lower]];
  return null;
}

/** Dimension signature (base dimension → net exponent) + combined SI factor. */
interface CompoundUnit {
  dims: Record<string, number>;
  factor: number;
}

/** Accumulates one side ("·"/"*"/space-separated factors) into dims & factor. */
function accumulateFactors(part: string, sign: 1 | -1, out: CompoundUnit): boolean {
  for (const tok of part.split(/[·*\s]+/).filter(Boolean)) {
    const m = tok.match(/^(.+?)(?:\^(-?\d+))?$/);
    if (!m) return false;
    const def = lookup(m[1]);
    // Compound units must be purely multiplicative (no affine offset like °C).
    if (!def || (def.offset !== undefined && def.offset !== 0)) return false;
    const exp = (m[2] ? parseInt(m[2], 10) : 1) * sign;
    out.dims[def.dim] = (out.dims[def.dim] ?? 0) + exp;
    out.factor *= Math.pow(def.factor, exp);
  }
  return true;
}

/**
 * Parses a compound unit like "km/h", "kg*m/s^2", "g/mol", "mol/L/s" → dimensions
 * + factor. Multiple "/" are all denominators: "a/b/c" ≡ a·b⁻¹·c⁻¹.
 */
export function parseCompoundUnit(expr: string): CompoundUnit | null {
  const parts = expr.trim().split("/");
  if (!parts[0].trim()) return null;
  for (let i = 1; i < parts.length; i++) if (!parts[i].trim()) return null; // reject empty denominator / trailing "/"
  const out: CompoundUnit = { dims: {}, factor: 1 };
  if (!accumulateFactors(parts[0], 1, out)) return null;
  for (let i = 1; i < parts.length; i++) if (!accumulateFactors(parts[i], -1, out)) return null;
  return out;
}

function sameDims(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/**
 * Converts a value between two compatible units, or null if incompatible/unknown.
 * Single units use the affine-aware path (handles °C/°F); compound units like
 * "km/h" → "m/s" are converted by matching dimension signatures.
 */
export function convert(value: number, from: string, to: string): number | null {
  const f = lookup(from);
  const t = lookup(to);
  if (f && t) {
    if (f.dim !== t.dim) return null;
    const base = value * f.factor + (f.offset ?? 0);
    return (base - (t.offset ?? 0)) / t.factor;
  }
  const cf = parseCompoundUnit(from);
  const ct = parseCompoundUnit(to);
  if (!cf || !ct || !sameDims(cf.dims, ct.dims)) return null;
  return (value * cf.factor) / ct.factor;
}

/** Rounds to `sig` significant figures (returns a number). */
export function roundSig(x: number, sig: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  sig = Math.max(1, Math.floor(sig));
  const d = Math.ceil(Math.log10(Math.abs(x)));
  const power = sig - d;
  const mag = Math.pow(10, power);
  return Math.round(x * mag) / mag;
}

/** Formats a number to `sig` significant figures as a string (trims to a sane form). */
export function formatSig(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return String(x);
  sig = Math.max(1, Math.floor(sig));
  const r = roundSig(x, sig);
  // Use exponential for very large/small magnitudes, else a plain decimal.
  if (r !== 0 && (Math.abs(r) >= 1e6 || Math.abs(r) < 1e-4)) {
    return r.toExponential(Math.max(0, sig - 1)).replace(/\.?0+e/, "e");
  }
  return String(parseFloat(r.toPrecision(sig)));
}
