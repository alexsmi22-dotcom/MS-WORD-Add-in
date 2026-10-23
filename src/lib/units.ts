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
  // A square root of a unit (Release E: stress intensity, Pa·m^0.5) is written as a root, as every text writes it:
  // Pa·√m, ksi·√in. Only the exact 0.5 power; other decimal powers keep their exponent.
  s = s.replace(/([A-Za-zµΩÅ°]+)\^\{?0\.5\}?/g, "√$1");
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

export interface UnitDef {
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
  dm: { dim: "length", factor: 0.1 },
  µm: { dim: "length", factor: 1e-6 }, nm: { dim: "length", factor: 1e-9 },
  pm: { dim: "length", factor: 1e-12 },
  in: { dim: "length", factor: 0.0254 }, ft: { dim: "length", factor: 0.3048 },
  yd: { dim: "length", factor: 0.9144 }, mi: { dim: "length", factor: 1609.344 },
  // The nautical mile is exactly 1852 m by definition, and is the unit every
  // aviation distance is quoted in.
  nmi: { dim: "length", factor: 1852 },
  Å: { dim: "length", factor: 1e-10 },
  // Release E: thou/mil (exactly 0.001 in) and the microinch (surface finish), both exact from the inch.
  mil: { dim: "length", factor: 2.54e-5 }, µin: { dim: "length", factor: 2.54e-8 },
  // mass (base kg)
  kg: { dim: "mass", factor: 1 }, g: { dim: "mass", factor: 0.001 },
  mg: { dim: "mass", factor: 1e-6 }, µg: { dim: "mass", factor: 1e-9 },
  ng: { dim: "mass", factor: 1e-12 }, pg: { dim: "mass", factor: 1e-15 },
  lb: { dim: "mass", factor: 0.45359237 }, oz: { dim: "mass", factor: 0.028349523 },
  // Release E: the tonne (metric ton, exactly 1000 kg — "t" is its SI symbol; the tesla is capital "T" and is looked
  // up first, case-sensitively), and the slug, DERIVED as 1 lbf·s²/ft = 0.45359237 × 9.80665 / 0.3048 kg so the
  // identity holds by construction. "ton" alone is NOT a key: short, long, metric and refrigeration tons differ.
  t: { dim: "mass", factor: 1000 },
  slug: { dim: "mass", factor: (0.45359237 * 9.80665) / 0.3048 },
  // molecular mass (daltons, base kg)
  Da: { dim: "mass", factor: 1.66053906660e-27 }, kDa: { dim: "mass", factor: 1.66053906660e-24 },
  MDa: { dim: "mass", factor: 1.66053906660e-21 },
  // time (base s)
  s: { dim: "time", factor: 1 }, ms: { dim: "time", factor: 0.001 },
  µs: { dim: "time", factor: 1e-6 }, ns: { dim: "time", factor: 1e-9 }, ps: { dim: "time", factor: 1e-12 },
  // Femtoseconds and below: ultrafast pulse durations were unconvertible, which
  // made every femtosecond number a manual exponent the user had to get right.
  fs: { dim: "time", factor: 1e-15 },
  min: { dim: "time", factor: 60 },
  h: { dim: "time", factor: 3600 }, day: { dim: "time", factor: 86400 },
  // temperature (base K, affine)
  K: { dim: "temp", factor: 1, offset: 0 },
  "°C": { dim: "temp", factor: 1, offset: 273.15 },
  "°F": { dim: "temp", factor: 5 / 9, offset: (459.67 * 5) / 9 },
  // Rankine: the absolute Fahrenheit scale (0 °R = 0 K), exactly 5/9 K per degree, no offset.
  "°R": { dim: "temp", factor: 5 / 9, offset: 0 },
  // TEMPERATURE DIFFERENCES, written explicitly (Release E). A difference of 1 °C is 1 K and of 1 °F is 5/9 K — no
  // offset. Inside a compound unit (W/(m²·°C), Btu/(h·ft²·°F)) °C and °F are read this way automatically (see
  // accumulateFactors); these keys let a bare difference be typed unambiguously ("Δ°F 180" in a ΔT field).
  "Δ°C": { dim: "temp", factor: 1, offset: 0 }, "Δ°F": { dim: "temp", factor: 5 / 9, offset: 0 },
  ΔK: { dim: "temp", factor: 1, offset: 0 },
  // volume (base m^3)
  L: { dim: "volume", factor: 0.001 }, mL: { dim: "volume", factor: 1e-6 },
  µL: { dim: "volume", factor: 1e-9 }, nL: { dim: "volume", factor: 1e-12 }, "m^3": { dim: "volume", factor: 1 },
  // Femtolitre: haematology's unit (mean corpuscular volume ≈ 90 fL). It is a
  // canonical key so that "fL" is pinned to a VOLUME and can never be reused
  // for the foot-lambert, which ships as "ftL" (see the photometry block).
  fL: { dim: "volume", factor: 1e-18 },
  // Cubic decimetre / centimetre: a chemistry text writes mol/dm³ and g/cm³.
  // The ASCII spellings cm3/dm3/m3/cc are aliases (see ALIASES).
  "dm^3": { dim: "volume", factor: 1e-3 }, "cm^3": { dim: "volume", factor: 1e-6 },
  // US liquid gallon, exactly 231 in^3 = 3.785411784 L by definition. Hydro and
  // pump flow in US practice is quoted in gal/min, which composes from this.
  gal: { dim: "volume", factor: 3.785411784e-3 },
  // Release E: the oil barrel, exactly 42 US gallons (158.987294928 L), derived from the gallon.
  bbl: { dim: "volume", factor: 42 * 3.785411784e-3 },
  // Volumetric flow shorthands (decomposed to length³/time in BASE, so they interoperate with m³/s and L/min):
  // US gallons per minute and cubic feet per minute, derived from the gallon and the foot.
  gpm: { dim: "volflow", factor: 3.785411784e-3 / 60 }, cfm: { dim: "volflow", factor: Math.pow(0.3048, 3) / 60 },
  // pressure (base Pa)
  Pa: { dim: "pressure", factor: 1 }, kPa: { dim: "pressure", factor: 1000 },
  bar: { dim: "pressure", factor: 1e5 },
  // Acoustic pressures: 0 dB SPL is 20 µPa, and a quiet room is a few mPa.
  // Both are CANONICAL keys, never aliases, and there is deliberately NO
  // lowercase "mpa" alias anywhere: alias lookup falls back to a lowercased
  // key, so one would make a typed "MPa" (megapascal, 10⁹ × mPa) or "mPa"
  // land on the other. Exact-key lookup keeps the two apart by case.
  µPa: { dim: "pressure", factor: 1e-6 }, mPa: { dim: "pressure", factor: 1e-3 },
  // Decibar: the oceanographer's pressure unit (1 dbar = 10 kPa ≈ 1 m of
  // seawater). It starts with "db" but is NOT a decibel; being a key, it is
  // looked up before the decibel refusal in parseMeasured ever runs.
  dbar: { dim: "pressure", factor: 1e4 },
  // Aviation and meteorology: a millibar is exactly a hectopascal, and inHg is
  // the conventional 0 °C value used for altimeter settings.
  mbar: { dim: "pressure", factor: 100 }, inHg: { dim: "pressure", factor: 3386.389 },
  atm: { dim: "pressure", factor: 101325 },
  psi: { dim: "pressure", factor: 6894.757 },
  // The TORR is defined as exactly 1/760 of a standard atmosphere (101 325/760
  // Pa = 133.322 368… Pa). The conventional MILLIMETRE OF MERCURY is a
  // different definition — the pressure of 1 mm of mercury of density
  // 13.5951 g/cm³ under standard gravity 9.80665 m/s² = 133.322 387 415 Pa
  // exactly (NIST SP 811 lists 1.333 224 E+02) — so the two differ by about
  // 1.4 parts in 10⁷ and BOTH are kept, each by its own definition. Both are
  // DERIVED here, never retyped (the therm lesson). mmHg was 133.322, a
  // truncation 2.9 parts in 10⁶ low.
  Torr: { dim: "pressure", factor: 101325 / 760 },
  mmHg: { dim: "pressure", factor: 13595.1 * 9.80665 * 0.001 },
  MPa: { dim: "pressure", factor: 1e6 }, GPa: { dim: "pressure", factor: 1e9 },
  ksi: { dim: "pressure", factor: 6894757 }, hPa: { dim: "pressure", factor: 100 },
  // force (base N) — absent entirely until engineering needed it, which is why
  // "N/m^2" could not be recognised as a stress.
  N: { dim: "force", factor: 1 }, kN: { dim: "force", factor: 1000 },
  MN: { dim: "force", factor: 1e6 }, mN: { dim: "force", factor: 0.001 },
  lbf: { dim: "force", factor: 4.4482216152605 }, kip: { dim: "force", factor: 4448.2216152605 },
  // Release E: kilogram-force, exactly standard gravity 9.80665 N.
  kgf: { dim: "force", factor: 9.80665 },
  // speed (base m/s) — its own dimension, decomposed in BASE to length/time so it
  // converts freely with m/s and km/h written as compounds. Aviation is quoted in
  // knots and feet per minute and neither could be expressed at all before.
  "m/s": { dim: "speed", factor: 1 },
  kt: { dim: "speed", factor: 1852 / 3600 },
  mph: { dim: "speed", factor: 1609.344 / 3600 },
  fpm: { dim: "speed", factor: 0.3048 / 60 },
  // information (base bit) — atomic, like angle: a bit is a pure count and
  // folding it into 1 would let a data size convert into a bare number.
  //
  // NO LOWERCASE BIT SYMBOLS (b, kb, Mb) on purpose. Alias lookup falls back to a
  // lowercased key, so defining "kb" would make a user's "KB" resolve to KILOBIT
  // — an 8x error — which is the same trap "Nm" -> nautical mile was. Kilobits
  // are spelled out as kbit instead, and KB is an explicit alias for kB.
  //
  // The decimal/binary split is real and is kept: kB is 1000 bytes and KiB is
  // 1024, as IEC defines them. Conflating the two is where "why is my 1 TB disk
  // only 931 GB" comes from.
  bit: { dim: "information", factor: 1 },
  B: { dim: "information", factor: 8 },
  kB: { dim: "information", factor: 8e3 }, MB: { dim: "information", factor: 8e6 },
  GB: { dim: "information", factor: 8e9 }, TB: { dim: "information", factor: 8e12 },
  PB: { dim: "information", factor: 8e15 },
  KiB: { dim: "information", factor: 8 * 1024 },
  MiB: { dim: "information", factor: 8 * 1024 ** 2 },
  GiB: { dim: "information", factor: 8 * 1024 ** 3 },
  TiB: { dim: "information", factor: 8 * 1024 ** 4 },
  kbit: { dim: "information", factor: 1e3 }, Mbit: { dim: "information", factor: 1e6 },
  Gbit: { dim: "information", factor: 1e9 }, Tbit: { dim: "information", factor: 1e12 },
  // Data RATES in the shorthand every codec, router and streaming spec uses.
  // These are CANONICAL KEYS on purpose, never aliases: alias lookup falls back
  // to a lowercased key, so an alias "mbps" would capture a typed "MBps" —
  // megaBYTES per second — as megabits, an 8× error (the KB/kb trap above).
  // As exact keys, "Mbps" and "MBps" are distinct strings and cannot meet.
  // The byte forms are keys too, so MBps converts to 8 Mbit/s rather than
  // being unknown. "Kbps" (capital K, an everyday spelling) is an explicit
  // alias for kbps; "KBps" is one for kBps, matching KB → kB.
  // dim "datarate" decomposes to information/time in BASE, so all of these
  // convert with the compounds Mbit/s, kB/s and GB/h.
  bps: { dim: "datarate", factor: 1 },
  kbps: { dim: "datarate", factor: 1e3 }, Mbps: { dim: "datarate", factor: 1e6 },
  Gbps: { dim: "datarate", factor: 1e9 }, Tbps: { dim: "datarate", factor: 1e12 },
  kBps: { dim: "datarate", factor: 8e3 }, MBps: { dim: "datarate", factor: 8e6 },
  GBps: { dim: "datarate", factor: 8e9 },
  // angular velocity (base rad/s). Motor and wheel speeds are quoted in rpm.
  rpm: { dim: "angularvelocity", factor: (2 * Math.PI) / 60 },
  "rad/s": { dim: "angularvelocity", factor: 1 },
  // energy (base J)
  J: { dim: "energy", factor: 1 }, kJ: { dim: "energy", factor: 1000 },
  cal: { dim: "energy", factor: 4.184 }, kcal: { dim: "energy", factor: 4184 },
  eV: { dim: "energy", factor: 1.602176634e-19 }, Wh: { dim: "energy", factor: 3600 },
  // Release E: millielectronvolt (quantum wells, phonons, spin splittings). Canonical, so it never meets MeV.
  meV: { dim: "energy", factor: 1.602176634e-22 },
  // Grid and utility energy is quoted in kilowatt-hours and their multiples, and
  // fuel energy in BTU. None existed, so an electricity bill or a heating value
  // could not be expressed at all. BTU is the IT ("International Table") BTU,
  // exactly 1055.05585262 J by definition — the one gas utilities and HVAC
  // ratings use. The therm is exactly 100,000 BTU(IT), likewise definitional.
  kWh: { dim: "energy", factor: 3.6e6 }, MWh: { dim: "energy", factor: 3.6e9 },
  GWh: { dim: "energy", factor: 3.6e12 },
  BTU: { dim: "energy", factor: 1055.05585262 },
  // DERIVED, not retyped: the first draft hand-typed this constant and
  // transposed two digits — caught only because a probe asserted
  // therm/BTU = 100000 exactly. Same lesson as thermo.ts's gas table:
  // derive the dependent constant so the identity holds by construction.
  therm: { dim: "energy", factor: 100000 * 1055.05585262 },
  // Sub-joule pulse energies. A laser spec sheet is written in mJ and µJ, and
  // neither existed, so every pulse energy had to be typed as an exponent.
  mJ: { dim: "energy", factor: 1e-3 }, µJ: { dim: "energy", factor: 1e-6 },
  nJ: { dim: "energy", factor: 1e-9 }, pJ: { dim: "energy", factor: 1e-12 },
  fJ: { dim: "energy", factor: 1e-15 }, MJ: { dim: "energy", factor: 1e6 },
  keV: { dim: "energy", factor: 1.602176634e-16 }, MeV: { dim: "energy", factor: 1.602176634e-13 },
  // amount of substance (base mol)
  mol: { dim: "amount", factor: 1 }, mmol: { dim: "amount", factor: 0.001 },
  µmol: { dim: "amount", factor: 1e-6 }, nmol: { dim: "amount", factor: 1e-9 },
  // angle (base rad)
  rad: { dim: "angle", factor: 1 }, "°": { dim: "angle", factor: Math.PI / 180 },
  mrad: { dim: "angle", factor: 1e-3 },
  // Release E: microradians (beam pointing, divergence) and arc-minutes/-seconds (optics, astronomy, surveying).
  µrad: { dim: "angle", factor: 1e-6 },
  arcmin: { dim: "angle", factor: Math.PI / 10800 }, arcsec: { dim: "angle", factor: Math.PI / 648000 },
  // frequency (base Hz)
  Hz: { dim: "frequency", factor: 1 }, kHz: { dim: "frequency", factor: 1e3 },
  // Release E: millihertz (laser linewidths at the Schawlow–Townes limit; slow modulation). Canonical, so "mHz" is
  // never lower-cased into MHz by the alias fallback.
  mHz: { dim: "frequency", factor: 1e-3 },
  MHz: { dim: "frequency", factor: 1e6 }, GHz: { dim: "frequency", factor: 1e9 }, THz: { dim: "frequency", factor: 1e12 },
  // electric current (base A)
  A: { dim: "current", factor: 1 }, mA: { dim: "current", factor: 1e-3 },
  µA: { dim: "current", factor: 1e-6 }, nA: { dim: "current", factor: 1e-9 }, kA: { dim: "current", factor: 1e3 },
  // voltage (base V)
  V: { dim: "voltage", factor: 1 }, mV: { dim: "voltage", factor: 1e-3 },
  µV: { dim: "voltage", factor: 1e-6 }, kV: { dim: "voltage", factor: 1e3 }, MV: { dim: "voltage", factor: 1e6 },
  // power (base W)
  W: { dim: "power", factor: 1 }, mW: { dim: "power", factor: 1e-3 }, µW: { dim: "power", factor: 1e-6 },
  // Acoustic power: sound power level is referenced to 1 pW.
  nW: { dim: "power", factor: 1e-9 }, pW: { dim: "power", factor: 1e-12 },
  kW: { dim: "power", factor: 1e3 }, MW: { dim: "power", factor: 1e6 }, GW: { dim: "power", factor: 1e9 },
  hp: { dim: "power", factor: 745.699872 },
  // Release E: the ton of refrigeration, 12 000 BTU(IT)/h by definition — derived from the BTU constant above, not
  // retyped (3516.8528… W).
  TR: { dim: "power", factor: (12000 * 1055.05585262) / 3600 },
  // resistance (base Ω)
  Ω: { dim: "resistance", factor: 1 }, mΩ: { dim: "resistance", factor: 1e-3 },
  kΩ: { dim: "resistance", factor: 1e3 }, MΩ: { dim: "resistance", factor: 1e6 },
  // capacitance (base F)
  F: { dim: "capacitance", factor: 1 }, mF: { dim: "capacitance", factor: 1e-3 },
  µF: { dim: "capacitance", factor: 1e-6 }, nF: { dim: "capacitance", factor: 1e-9 }, pF: { dim: "capacitance", factor: 1e-12 },
  // On-chip capacitances are quoted in femtofarads. Without this, every
  // interconnect figure had to be typed as an exponent — and the engineering
  // audit caught it as a tool that silently inserted nothing.
  fF: { dim: "capacitance", factor: 1e-15 },
  // charge (base C)
  C: { dim: "charge", factor: 1 }, mC: { dim: "charge", factor: 1e-3 },
  µC: { dim: "charge", factor: 1e-6 }, nC: { dim: "charge", factor: 1e-9 },
  // Battery capacity is quoted in amp-hours (spec sheets: mAh for cells, Ah for
  // packs). Charge decomposes to current·time in BASE, so Ah interoperates with
  // the compound "A*h" and with coulombs.
  Ah: { dim: "charge", factor: 3600 }, mAh: { dim: "charge", factor: 3.6 },
  // inductance (base H)
  H: { dim: "inductance", factor: 1 }, mH: { dim: "inductance", factor: 1e-3 }, µH: { dim: "inductance", factor: 1e-6 },
  // conductance (base S)
  S: { dim: "conductance", factor: 1 }, mS: { dim: "conductance", factor: 1e-3 }, µS: { dim: "conductance", factor: 1e-6 },
  // magnetic flux density (base T)
  T: { dim: "bfield", factor: 1 }, mT: { dim: "bfield", factor: 1e-3 }, µT: { dim: "bfield", factor: 1e-6 },
  G: { dim: "bfield", factor: 1e-4 },
  // Release E: magnetic field strength H (base A/m; decomposes to current/length so "A/m" composes). The oersted is
  // the CGS unit, 1000/(4π) A/m exactly.
  Oe: { dim: "hfield", factor: 1000 / (4 * Math.PI) },
  // molarity (base mol/m³ — the SI base, because "molarity" DECOMPOSES to
  // amount·length⁻³ in BASE below, and the compound path multiplies these
  // factors against mol and m³). 1 M = 1 mol/L = 1 mol/dm³ = 1000 mol/m³.
  // These were once quoted relative to M (factor 1), which the single-unit
  // path did not notice (it only uses ratios) but the compound path did:
  // convert(0.08, "mol/L", "M") returned 80, a 1000× error in every molarity
  // written as mol/L, mmol/mL or mol/dm³.
  M: { dim: "molarity", factor: 1000 }, mM: { dim: "molarity", factor: 1 },
  µM: { dim: "molarity", factor: 1e-3 }, nM: { dim: "molarity", factor: 1e-6 }, pM: { dim: "molarity", factor: 1e-9 },
  // --- photometry (luminous intensity is the 7th SI base unit) --------------
  //
  // LUMINOUS INTENSITY AND LUMINOUS FLUX ARE KEPT SEPARATE ON PURPOSE, and this
  // is the decision that matters in this block. In strict SI a lumen is a
  // candela-steradian and the steradian is dimensionless, so the two could be
  // made to share a signature and interconvert one-for-one. They must not.
  // Going from a candela to a lumen means integrating over the solid angle the
  // source actually emits into — a torch and a bare lamp of the same candela
  // rating differ enormously in lumens — so a free conversion would return a
  // confident number for a question the units alone cannot answer. Same
  // reasoning as `angle`, which is kept atomic so a radian cannot silently
  // become a bare number.
  //
  // What DOES work, because these are genuine derived quantities:
  //   nit  = cd/m^2  (luminance — what HDR brightness is quoted in)
  //   lx   = lm/m^2  (illuminance — ambient light on a surface)
  cd: { dim: "luminousintensity", factor: 1 },
  mcd: { dim: "luminousintensity", factor: 1e-3 },
  kcd: { dim: "luminousintensity", factor: 1e3 },
  lm: { dim: "luminousflux", factor: 1 },
  klm: { dim: "luminousflux", factor: 1e3 },
  lx: { dim: "illuminance", factor: 1 },
  klx: { dim: "illuminance", factor: 1e3 },
  nit: { dim: "luminance", factor: 1 },
  // US customary photometry, DERIVED from the exact foot (0.3048 m, 1959) and
  // never retyped (the therm lesson below):
  //   foot-candle  fc  = 1 lm/ft²        = 10.763910416709722 lx
  //   foot-lambert ftL = (1/π) cd/ft²    =  3.4262590996353905 cd/m²
  // The foot-lambert is spelled "ftL" and NEVER "fL": fL is the femtolitre
  // (a haematology volume, defined above), and a cinema luminance read as a
  // red-cell volume would be a confident nonsense. "fc" (cutoff frequency) and
  // "fL" (lower band edge) are ALSO everyday symbols, and "3 fc" after a
  // number is exactly where a symbol can be misread as a unit. unitSolve
  // therefore treats these short keys as AMBIGUOUS: a known that uses one
  // while the same name is a variable in the system is not read as a unit,
  // and any reading as a unit is disclosed by name (see unitSolve.ts).
  fc: { dim: "illuminance", factor: 1 / (0.3048 * 0.3048) },
  ftL: { dim: "luminance", factor: 1 / (Math.PI * 0.3048 * 0.3048) },
  // Frame rate. Dimensionally a per-second count, so it converts with Hz — which
  // is exactly what you want when checking a 60 fps source against a 60 Hz
  // panel. NOTE the collision this deliberately accepts: an aviation reader
  // might expect "fps" to mean feet per second. Feet per second is already
  // expressible as the compound "ft/s", the codebase already writes climb rates
  // as fpm, and in video "fps" is universal — so this reading wins, and
  // ft/s stays available and unambiguous.
  fps: { dim: "frequency", factor: 1 },

  // --- the student-pack families (SI Brochure 9th ed.; NIST SP 811) ---------
  //
  // VISCOSITY. Dynamic: the poise, 1 P = 0.1 Pa·s exactly (so 1 cP = 1 mPa·s);
  // kinematic: the stokes, 1 St = 10⁻⁴ m²/s (so 1 cSt = 1 mm²/s). The two are
  // DIFFERENT quantities — kinematic = dynamic / density — and their
  // signatures differ, so cP → cSt is refused (with a by-name message below).
  P: { dim: "dynviscosity", factor: 0.1 }, cP: { dim: "dynviscosity", factor: 1e-3 },
  St: { dim: "kinviscosity", factor: 1e-4 }, cSt: { dim: "kinviscosity", factor: 1e-6 },
  // RADIOACTIVITY. The becquerel is one decay per second, but the SI Brochure
  // reserves it for activity and the hertz for periodic phenomena: s⁻¹ in both
  // cases, and NOT interchangeable. "activity" is therefore ATOMIC — Bq never
  // converts to Hz, fps or 1/s (the candela/lumen precedent). The curie is
  // exactly 3.7 × 10¹⁰ Bq.
  Bq: { dim: "activity", factor: 1 }, kBq: { dim: "activity", factor: 1e3 },
  MBq: { dim: "activity", factor: 1e6 }, GBq: { dim: "activity", factor: 1e9 }, TBq: { dim: "activity", factor: 1e12 },
  Ci: { dim: "activity", factor: 3.7e10 }, mCi: { dim: "activity", factor: 3.7e7 },
  µCi: { dim: "activity", factor: 3.7e4 }, nCi: { dim: "activity", factor: 37 }, pCi: { dim: "activity", factor: 3.7e-2 },
  // ABSORBED DOSE vs EQUIVALENT DOSE. The gray and the sievert are both J/kg,
  // and they are DIFFERENT QUANTITIES: a sievert is a gray weighted by the
  // radiation (w_R) and, for effective dose, the tissue (w_T). No unit factor
  // turns one into the other, so both are ATOMIC dims — mGy/h can never
  // silently become µSv/h through the compound path. The price, said in the
  // refusal: Gy ↔ J/kg does not convert either. The rad is 1 cGy and the rem
  // 1 cSv exactly (NIST SP 811). The dose rad is spelled "rd" — NIST SP 811's
  // own symbol for it where the radian could be confused — because "rad" is
  // the RADIAN here, and a typed "rad" → Gy is refused by name.
  Gy: { dim: "absorbeddose", factor: 1 }, mGy: { dim: "absorbeddose", factor: 1e-3 },
  µGy: { dim: "absorbeddose", factor: 1e-6 }, cGy: { dim: "absorbeddose", factor: 1e-2 },
  nGy: { dim: "absorbeddose", factor: 1e-9 }, kGy: { dim: "absorbeddose", factor: 1e3 }, MGy: { dim: "absorbeddose", factor: 1e6 },
  rd: { dim: "absorbeddose", factor: 1e-2 },
  Sv: { dim: "equivalentdose", factor: 1 }, mSv: { dim: "equivalentdose", factor: 1e-3 },
  µSv: { dim: "equivalentdose", factor: 1e-6 }, cSv: { dim: "equivalentdose", factor: 1e-2 },
  nSv: { dim: "equivalentdose", factor: 1e-9 }, kSv: { dim: "equivalentdose", factor: 1e3 },
  rem: { dim: "equivalentdose", factor: 1e-2 }, mrem: { dim: "equivalentdose", factor: 1e-5 },
  // CATALYTIC ACTIVITY: the katal is mol/s (decomposed, so kat ↔ mol/s and
  // µmol/min all convert); the enzyme unit U is exactly 1 µmol/min = 10⁻⁶/60 kat.
  kat: { dim: "catalytic", factor: 1 }, µkat: { dim: "catalytic", factor: 1e-6 }, nkat: { dim: "catalytic", factor: 1e-9 },
  U: { dim: "catalytic", factor: 1e-6 / 60 }, mU: { dim: "catalytic", factor: 1e-9 / 60 },
  // MAGNETIC FLUX: the weber, V·s (decomposed, so Wb/m² is the tesla); the
  // maxwell is exactly 10⁻⁸ Wb.
  Wb: { dim: "magflux", factor: 1 }, mWb: { dim: "magflux", factor: 1e-3 }, µWb: { dim: "magflux", factor: 1e-6 },
  Mx: { dim: "magflux", factor: 1e-8 },
  // SOLID ANGLE: the steradian is rad² (decomposed), so a square degree is
  // exactly (π/180)² sr. It stays apart from the lumen: cd·sr is not lm here,
  // for the reason given in the photometry block.
  sr: { dim: "solidangle", factor: 1 },
  // WEEK and the JULIAN YEAR — the only year this converts: 365.25 days of
  // 86 400 s exactly (the IAU's year, the one in the light-year). A bare
  // "year" is refused by name (calendar 365 d, Gregorian 365.2425 d and
  // tropical ≈ 365.2422 d all differ).
  week: { dim: "time", factor: 604800 },
  julianyear: { dim: "time", factor: 365.25 * 86400 },

  // dimensionless fraction (base = ratio)
  "%": { dim: "fraction", factor: 0.01 }, ppm: { dim: "fraction", factor: 1e-6 },
  ppb: { dim: "fraction", factor: 1e-9 }, ppt: { dim: "fraction", factor: 1e-12 },
};

const ALIASES: Record<string, string> = {
  meter: "m", metre: "m", meters: "m", micron: "µm", um: "µm", micrometer: "µm",
  gram: "g", grams: "g", ug: "µg", microgram: "µg", kilogram: "kg", pound: "lb", pounds: "lb",
  sec: "s", secs: "s", second: "s", seconds: "s", us: "µs", minute: "min", minutes: "min",
  hr: "h", hour: "h", hours: "h", days: "day",
  // NO "nm" OR "kn" ALIAS HERE, deliberately. Alias lookup falls back to a
  // lowercased key, so `nm -> nmi` never fires for "nm" (UNITS wins, nanometre)
  // and its ONLY live effect was that "Nm" — newton-metre — silently became 1852
  // metres. "KN" likewise became knots rather than kilonewtons. Write nmi and kt.
  // KB is overwhelmingly meant as kilobyte, so it is pinned explicitly rather
  // than left to the lowercase fallback.
  KB: "kB", byte: "B", bytes: "B", bits: "bit",
  kilobyte: "kB", megabyte: "MB", gigabyte: "GB", terabyte: "TB",
  knot: "kt", knots: "kt", kts: "kt",
  nauticalmile: "nmi", nauticalmiles: "nmi",
  millibar: "mbar", millibars: "mbar",
  // ASCII micro forms, matching the existing ug/us/um convention. A laser spec
  // sheet is typed as "uJ" far more often than "µJ".
  uJ: "µJ", microjoule: "µJ", microjoules: "µJ", joule: "J", joules: "J",
  // Energy/battery/flow spellings. "Btu" is how ASHRAE and fuel specs case it;
  // the lowercase fallback catches "btu". "mah" is pinned because the lowercase
  // fallback of a user's "MAH" or "mAh" typo must not miss — and note "mah" can
  // NOT be left to fall back to "Ah" via any path, it is its own alias.
  kilowatthour: "kWh", kilowatthours: "kWh", Btu: "BTU", therms: "therm",
  // NO "mwh" ALIAS, deliberately: alias lookup falls back to a lowercased key,
  // so it would make a typed "mWh" — MILLIwatt-hour, a real unit on coin-cell
  // spec sheets — resolve to MEGAwatt-hours, a 10^9 error. Same trap as
  // "Nm" -> nmi. kWh/GWh have no milli-sibling ambiguity, so those are safe.
  kwh: "kWh", gwh: "GWh",
  mah: "mAh", ah: "Ah", gallon: "gal", gallons: "gal",
  femtosecond: "fs", femtoseconds: "fs",
  nanojoule: "nJ", nanojoules: "nJ", millijoule: "mJ", millijoules: "mJ",
  degC: "°C", celsius: "°C", "°c": "°C", degF: "°F", fahrenheit: "°F", "°f": "°F", kelvin: "K",
  // Release E. Rankine and explicit temperature differences ("delta" spellings for keyboards without Δ).
  degR: "°R", rankine: "°R", "°r": "°R", deltaC: "Δ°C", deltaF: "Δ°F", deltaK: "ΔK", "Δ°c": "Δ°C", "Δ°f": "Δ°F",
  // Release E. Tonne, pound-mass, thou, microinch, microradian, arc units, barrel, kilogram-force, oersted,
  // refrigeration ton. NO "ton"/"tons" alias (four different tons) and NO lowercase "kp".
  tonne: "t", tonnes: "t", lbm: "lb", thou: "mil", mils: "mil", uin: "µin", microinch: "µin", microinches: "µin",
  urad: "µrad", microradian: "µrad", microradians: "µrad", arcminute: "arcmin", arcminutes: "arcmin",
  arcsecond: "arcsec", arcseconds: "arcsec", barrel: "bbl", barrels: "bbl", slugs: "slug",
  oersted: "Oe", oersteds: "Oe", RT: "TR",
  litre: "L", liter: "L", l: "L", ml: "mL", ul: "µL", microliter: "µL",
  cm3: "cm^3", cc: "cm^3", dm3: "dm^3", m3: "m^3",
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
  // Photometric spellings. NO lowercase "cd" alias is needed (cd is already the
  // canonical symbol), and note candela/lumen/lux spelled out are safe because
  // none of them lowercases onto an existing key.
  candela: "cd", candelas: "cd", lumen: "lm", lumens: "lm",
  lux: "lx", nits: "nit", luxes: "lx",
  fram: "fps", framespersecond: "fps",
  // US photometric spellings. "footcandle" is the FOOT-CANDLE (illuminance,
  // fc) and "footlambert" the FOOT-LAMBERT (luminance, ftL) — two different
  // quantities that must not be crossed. No "fl"/"fL" spelling anywhere: fL is
  // the femtolitre.
  footcandle: "fc", footcandles: "fc", "foot-candle": "fc", "foot-candles": "fc",
  // "FC" as IES lighting schedules write it. Exact-case alias only: no farad-
  // coulomb or femtocoulomb key exists, and the lowercase "fc" is the
  // canonical key itself, so nothing folds onto it by accident.
  FC: "fc",
  decibar: "dbar", decibars: "dbar",
  footlambert: "ftL", footlamberts: "ftL", "foot-lambert": "ftL", "foot-lamberts": "ftL",
  // Case friction in fields that shipped refusing it ("29.97 FPS", "48 KHz",
  // "1000 NIT"). These are EXPLICIT aliases, not a case-insensitive lookup:
  // making lookup ignore case on UNITS would merge mS/MS, mW/MW and mPa/MPa.
  // "khz" and "hz" are safe lowercase keys (no millihertz sibling can lower
  // onto them), and there is deliberately NO "mhz": it would turn a typed
  // "mHz" (millihertz) or "MHz" into the other, 10⁹ apart.
  // The lowercase SELF-aliases fps/nit make every case spelling fold home
  // (UNITS is checked first, so they never shadow anything); nothing else in
  // the tables lowercases to either.
  FPS: "fps", Fps: "fps", fps: "fps", KHz: "kHz", khz: "kHz", hz: "Hz", NIT: "nit", Nit: "nit", nit: "nit",
  // Data-rate case variants: explicit, capital-K only. Never a lowercase
  // "mbps"/"kbps"-style ALIAS (kbps itself is a canonical key), see UNITS.
  Kbps: "kbps", KBps: "kBps",
  // Acoustic units, spelled out and in ASCII micro form (uPa, as uJ above).
  uPa: "µPa", micropascal: "µPa", micropascals: "µPa", millipascal: "mPa",
  picowatt: "pW", picowatts: "pW", nanowatt: "nW", nanowatts: "nW",
  femtolitre: "fL", femtoliter: "fL", femtolitres: "fL", femtoliters: "fL",
  // Student-pack spellings. "torr" lowercase is safe: no milli-sibling exists.
  // NO lowercase alias for any prefixed dose or activity key (mgy, msv, mbq…):
  // the lowercase fallback would make MGy/mGy or MBq/mBq collide.
  // No "cps" for the centipoise: it is also counts per second.
  torr: "Torr", poise: "P", centipoise: "cP", stokes: "St", centistokes: "cSt",
  becquerel: "Bq", becquerels: "Bq", curie: "Ci", curies: "Ci",
  gray: "Gy", grays: "Gy", sievert: "Sv", sieverts: "Sv",
  katal: "kat", katals: "kat", weber: "Wb", webers: "Wb", maxwell: "Mx", maxwells: "Mx",
  steradian: "sr", steradians: "sr",
  weeks: "week", wk: "week", wks: "week",
  "julian year": "julianyear", "julian years": "julianyear", "julian-year": "julianyear", "julian-years": "julianyear", julianyears: "julianyear",
};

/** A single unit symbol or spelled name (affine temperatures included), or null. */
export function lookup(unit: string): UnitDef | null {
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

/**
 * Named dimensions decomposed into base ones.
 *
 * WHY THIS EXISTS. Every named dimension used to be ATOMIC: "pressure" was its
 * own irreducible thing, unrelated to mass, length and time. That is fine for
 * converting bar to atm, and useless for anything derived — "N/m^2" came out as
 * {force: 1, length: -2} and could never be recognised as a pressure, so a
 * stress could not be expressed at all. Decomposing here means Pa, N/m^2 and
 * N/mm^2 all reduce to the same signature and convert between each other, and
 * the same for J vs N·m and W vs J/s.
 *
 * Anything not listed stays atomic, which is right for genuinely dimensionless
 * tags like "fraction" and for "angle" — radians are dimensionless, and folding
 * them into 1 would let an angle convert into a pure number silently.
 */
const BASE: Record<string, Record<string, number>> = {
  volume: { length: 3 },
  force: { mass: 1, length: 1, time: -2 },
  pressure: { mass: 1, length: -1, time: -2 },
  energy: { mass: 1, length: 2, time: -2 },
  power: { mass: 1, length: 2, time: -3 },
  frequency: { time: -1 },
  charge: { current: 1, time: 1 },
  voltage: { mass: 1, length: 2, time: -3, current: -1 },
  resistance: { mass: 1, length: 2, time: -3, current: -2 },
  conductance: { mass: -1, length: -2, time: 3, current: 2 },
  capacitance: { mass: -1, length: -2, time: 4, current: 2 },
  inductance: { mass: 1, length: 2, time: -2, current: -2 },
  bfield: { mass: 1, time: -2, current: -1 },
  molarity: { amount: 1, length: -3 },
  // Speed as its own dim so that kt, mph and fpm reduce to the same signature as
  // m/s and km/h and convert freely between them. Aviation is written in knots
  // and feet per minute, and neither could be expressed at all before.
  speed: { length: 1, time: -1 },
  // Angular velocity decomposes to angle/time so rpm interoperates with the
  // compound rad/s and deg/s. Angle itself stays atomic on purpose - folding
  // radians into 1 would let an angle convert silently into a bare number.
  angularvelocity: { angle: 1, time: -1 },
  // Data rate = information per time, so Mbps ≡ Mbit/s and MBps ≡ MB/s.
  datarate: { information: 1, time: -1 },
  // Photometric derived quantities. Luminous intensity and luminous flux are
  // NOT decomposed into one another — see the note in UNITS — so a luminance
  // (cd/m^2) and an illuminance (lm/m^2) have different signatures and cannot
  // silently convert, which is correct: they measure different things at
  // different ends of the light path.
  luminance: { luminousintensity: 1, length: -2 },
  illuminance: { luminousflux: 1, length: -2 },
  // Student pack. Absorbed dose, equivalent dose and activity are NOT here:
  // they stay atomic on purpose (see UNITS).
  dynviscosity: { mass: 1, length: -1, time: -1 },
  kinviscosity: { length: 2, time: -1 },
  catalytic: { amount: 1, time: -1 },
  magflux: { mass: 1, length: 2, time: -2, current: -1 },
  solidangle: { angle: 2 },
  volflow: { length: 3, time: -1 },
  hfield: { current: 1, length: -1 },
};

/** Accumulates one side ("·"/"*"/space-separated factors) into dims & factor. */
function accumulateFactors(part: string, sign: 1 | -1, out: CompoundUnit): boolean {
  for (const tok of part.split(/[·*\s]+/).filter(Boolean)) {
    // A decimal exponent ("m^0.5") is accepted because units-aware Solve
    // PRINTS one for a square root of a dimensioned quantity, and whatever is
    // displayed must parse back.
    const m = tok.match(/^(.+?)(?:\^(-?\d+(?:\.\d+)?))?$/);
    if (!m) return false;
    const looked = lookup(m[1]);
    if (!looked) return false;
    // INSIDE A COMPOUND, °C AND °F ARE TEMPERATURE DIFFERENCES (Release E). A heat transfer coefficient written
    // W/(m²·°C), or Btu/(h·ft²·°F), means "per degree of difference", where the offset has no meaning: 1 °C of
    // difference is 1 K and 1 °F is 5/9 K. These were refused outright, which pushed the usual way h and k are
    // written out of every field. Only the factor is used here; a bare "20 °C" never reaches this path (convert()
    // takes single units through lookup, affine, and parseCompoundUnit refuses a lone offset unit).
    const def: UnitDef = looked.offset ? { dim: looked.dim, factor: looked.factor } : looked;
    const exp = (m[2] ? parseFloat(m[2]) : 1) * sign;
    // A FRACTION INSIDE A COMPOUND IS A SCALE (Release E): "ppm/K", "%/°C", "ppm/V" — the way every datasheet writes an
    // expansion or drift coefficient — mean 10⁻⁶ (0.01) per unit. A LONE %, ppm stays its own atomic quantity (it is
    // never a compound, so it never reaches here alone: parseCompoundUnit is reached only for real compounds or units
    // lookup does not know).
    if (def.dim === "fraction") {
      out.factor *= Math.pow(def.factor, exp);
      continue;
    }
    const decomposed = BASE[def.dim];
    if (decomposed) {
      for (const [b, e] of Object.entries(decomposed)) out.dims[b] = (out.dims[b] ?? 0) + e * exp;
    } else {
      out.dims[def.dim] = (out.dims[def.dim] ?? 0) + exp;
    }
    out.factor *= Math.pow(def.factor, exp);
  }
  return true;
}

/**
 * Splits on "/" at PAREN DEPTH ZERO, so "W/(m^2*K)" gives ["W", "(m^2*K)"]
 * rather than breaking the group apart. Returns null on unbalanced parentheses,
 * which is a typo rather than a unit and must not be guessed at.
 */
function splitTopLevel(expr: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return null;
    }
    if (ch === "/" && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (depth !== 0) return null;
  parts.push(cur);
  return parts;
}

/**
 * Parses a compound unit like "km/h", "kg*m/s^2", "g/mol", "mol/L/s" → dimensions
 * + factor. Multiple "/" are all denominators: "a/b/c" ≡ a·b⁻¹·c⁻¹.
 *
 * A parenthesised GROUP is accepted in any position — "W/(m^2*K)",
 * "kJ/(kg*K)" — because that is how every engineering text writes a heat
 * transfer coefficient or a specific heat, and refusing it sent people to guess
 * at "W/m^2/K" instead. The two are equivalent here and both work.
 *
 * NOTE that only a FLAT group is supported: the contents of the parentheses are
 * multiplied together, so "a/(b*c)" is a·b⁻¹·c⁻¹ as expected. A nested division
 * inside a group ("a/(b/c)") is REFUSED rather than misread, because the two
 * readings differ by c² and silently picking one would be a wrong answer
 * dressed as a unit.
 */
export function parseCompoundUnit(expr: string): CompoundUnit | null {
  const parts = splitTopLevel(normalizeUnitText(expr.trim()));
  if (!parts) return null;
  if (!parts[0].trim()) return null;
  for (let i = 1; i < parts.length; i++) if (!parts[i].trim()) return null; // reject empty denominator / trailing "/"
  // A LONE °C or °F is a temperature, never a difference: it is not a compound, and taking it here would drop its
  // offset (accumulateFactors reads offset units as differences). convert() handles it affinely through lookup.
  if (parts.length === 1) {
    const lone = parts[0].trim().replace(/^\((.*)\)$/, "$1").trim();
    if (!/[·*\s^]/.test(lone) && lookup(lone)?.offset) return null;
  }

  /** Strips one wrapping paren pair; null if the part is still not flat. */
  const flatten = (part: string): string | null => {
    const t = part.trim();
    if (!t.includes("(")) return t.includes(")") ? null : t;
    if (!t.startsWith("(") || !t.endsWith(")")) return null;
    const inner = t.slice(1, -1);
    // Must be a single balanced group, with nothing nested inside it.
    if (inner.includes("(") || inner.includes(")") || inner.includes("/")) return null;
    return inner.trim() || null;
  };

  const out: CompoundUnit = { dims: {}, factor: 1 };
  for (let i = 0; i < parts.length; i++) {
    // A bare "1" numerator — "1/s", "1/K", "1/in" — is the reciprocal of
    // what follows. Units-aware Solve PRINTS "1/s", and a displayed unit that
    // the converter then refused was a display-contract break. Accepted ONLY
    // in the numerator and only with a real denominator: "1" alone, or as a
    // denominator ("m/1"), is still not a unit.
    if (i === 0 && parts.length > 1 && parts[0].trim() === "1") continue;
    const flat = flatten(parts[i]);
    if (flat === null) return null;
    if (!accumulateFactors(flat, i === 0 ? 1 : -1, out)) return null;
  }
  return out;
}

function sameDims(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

const SUPERSCRIPT_TO_ASCII: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-",
};

/**
 * Unit text written the way the PANE DISPLAYS it must also parse. Every label
 * and result line prints m², m³/s and W/(m²·K) with real superscripts — the
 * scientifically correct form — so a user who copies a unit out of a result
 * and pastes it into a field is typing exactly what we showed them. Refusing
 * "m³" while displaying "m³" would make the correct display a trap. A
 * superscript run becomes one ^exponent (⁻¹ → ^-1).
 */
function normalizeUnitText(expr: string): string {
  // Two look-alike code points every keyboard and PDF produces: the Greek
  // small mu (U+03BC) for the micro sign (U+00B5) these tables are keyed on,
  // and the OHM SIGN (U+2126) for the Greek capital omega (U+03A9). Both are
  // visually identical to what the pane prints, so refusing them would make
  // "20 μPa" pasted from a datasheet look like a missing unit.
  expr = expr.replace(/μ/g, "µ").replace(/Ω/g, "Ω");
  // "Mb/s", the commonest way a stream rate is written, is megaBITS per
  // second. Rewritten CASE-SENSITIVELY to the bit form, so "MB/s" (megabytes,
  // 8× larger) can never be captured by it, and no "b" (barn) key is involved.
  expr = expr.replace(/(^|[^A-Za-z])([kMGT])b\/s\b/g, "$1$2bit/s");
  // A root sign, as the display writes a stress intensity (MPa·√m, ksi·√in): the 0.5 power of the unit after it, so
  // whatever is displayed parses back (Release E).
  expr = expr.replace(/√\s*([A-Za-zµΩÅ°]+)/g, "$1^0.5");
  // A leading slash is a reciprocal, as a datasheet writes a coefficient: "12e-6 /K" = 12×10⁻⁶ per kelvin (Release E).
  expr = expr.replace(/^\s*\//, "1/");
  return expr.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (run) => {
    let out = "^";
    for (const ch of run) out += SUPERSCRIPT_TO_ASCII[ch] ?? "";
    return out;
  });
}

/**
 * Converts a value between two compatible units, or null if incompatible/unknown.
 * Single units use the affine-aware path (handles °C/°F); compound units like
 * "km/h" → "m/s" are converted by matching dimension signatures.
 */
export function convert(value: number, from: string, to: string): number | null {
  from = normalizeUnitText(from);
  to = normalizeUnitText(to);
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

/** A number the user typed, with the unit they typed it in, reduced to a target unit. */
export interface Measured {
  /** The number as typed. */
  value: number;
  /** The unit as typed, or the assumed one if none was given. */
  unit: string;
  /** The value converted into the caller's target unit. */
  inTarget: number;
  /** True when no unit was written and the target was assumed. */
  assumed: boolean;
}

/**
 * Reads "12 kN·m", "4.5mm", "200 GPa" or a bare "12" and converts it to
 * `targetUnit`. A bare number is ACCEPTED and flagged as assumed rather than
 * refused, because a student mid-calculation should not be forced to annotate
 * every field — but a WRONG unit is refused rather than ignored, which is the
 * whole point: entering a section in millimetres and a moment in newton-metres
 * is a factor of a billion in the stress, and it looks entirely plausible.
 */
export function parseMeasured(text: string, targetUnit: string): Measured | { error: string } {
  const t = text.trim();
  if (!t) return { error: "This field is empty." };
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/.exec(t);
  if (!m) return { error: `"${t}" does not start with a number.` };
  let value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return { error: `"${m[1]}" is not a finite number.` };
  let rest = m[2];
  // A LEADING SIMPLE FRACTION, "a/b <unit>": the way every camera and light
  // meter writes a shutter speed ("1/125 s"). The slash must be followed by a
  // plain number, so "5 1/s" is still 5 in the reciprocal unit 1/s (the unit
  // path), and "51/s" is not silently a fraction. A second slash in the
  // number ("1/2/3 s") and a zero denominator are refused by name rather than
  // guessed at: "1/2/3" has two readings, and 1/0 is not a quantity.
  const frac = /^\/\s*((?:\d+(?:\.\d*)?|\.\d+))(?![\d.eE])\s*(.*)$/.exec(rest);
  if (frac && !/[eE]/.test(m[1])) {
    const den = parseFloat(frac[1]);
    if (den === 0) return { error: `"${t}" divides by zero: a fraction needs a non-zero denominator.` };
    if (/^\//.test(frac[2].trim())) {
      return { error: `"${t}" has more than one slash in the number — write a single fraction such as 1/125.` };
    }
    value = value / den;
    rest = frac[2];
  }
  const written = rest.trim().replace(/·/g, "*");
  if (!written) return { value, unit: targetUnit, inTarget: value, assumed: true };
  // A slash GLUED to the number ("51/s") stays refused: it reads as 5 1/s or as 51 per second, and guessing is how a
  // wrong number gets in. Only a spaced slash ("12e-6 /K") is the reciprocal unit (normalizeUnitText, Release E).
  // (The number pattern swallows the space before the unit, so the gap is read off the typed text itself.)
  if (written.startsWith("/") && t.slice(m[1].length).startsWith("/")) return { error: `"${t}" is not a unit this recognises: write a space before the slash ("51 /s") for "per", or 5 1/s.` };
  // DECIBELS ARE NOT UNITS. dB, dBu, dBV, dBFS, dB SPL and the neper are
  // logarithmic level statements: converting one by a factor (94 dB SPL ≠ 94 ×
  // anything Pa, and 80 dB + 80 dB is 83 dB, not 160) would be a confident
  // wrong answer. They are refused with a pointer to the calculators that do
  // level arithmetic properly. Only the MESSAGE is special; no key exists.
  if (/^(dB|Np\b|neper)/i.test(written) && !lookup(written)) {
    return {
      error:
        `"${written}" is a logarithmic level, not a unit — decibels are not converted here. ` +
        "Use Engineering › Audio & acoustics › Levels & references for dB SPL, dBu, dBV and dBFS.",
    };
  }
  const converted = convert(value, written, targetUnit);
  if (converted === null) {
    // Refusals that need a SENTENCE, not just "incompatible": two quantities
    // that share a dimension but are not the same thing, and the one unit
    // whose length is not defined by its name.
    const named = unitRefusal(written, targetUnit);
    if (named) return { error: named };
    const known = parseCompoundUnit(written) || lookup(written);
    return {
      error: known
        ? `"${written}" is not compatible with ${targetUnit} — check which quantity this field wants.`
        : `"${written}" is not a unit this recognises.`,
    };
  }
  return { value, unit: written, inTarget: converted, assumed: false };
}

/**
 * The words a bare year is typed as (compared lowercased). None is a unit:
 * the length is not stated. The one-letter "a" (annum, but also the are) and
 * "y" are deliberately absent — lowercasing "A" would catch the ampere.
 */
const AMBIGUOUS_YEAR = new Set(["year", "years", "yr", "yrs", "annum"]);

/** The unit tokens of a unit expression ("mGy/h" → ["mGy", "h"]). */
function unitTokens(expr: string): string[] {
  return normalizeUnitText(expr)
    .split(/[·*/\s()]+/)
    .map((t) => t.replace(/\^-?\d+(?:\.\d+)?$/, ""))
    .filter(Boolean);
}

/** Which of the special families a unit expression mentions. */
function families(expr: string): Set<string> {
  const out = new Set<string>();
  for (const tok of unitTokens(expr)) {
    if (AMBIGUOUS_YEAR.has(tok.toLowerCase())) out.add("year");
    if (tok === "rad") out.add("radian");
    const def = lookup(tok);
    if (def) out.add(def.dim);
  }
  return out;
}

/**
 * A by-name refusal for a conversion that convert() refuses, or null. The
 * pane's converter shows this sentence instead of "incompatible", because in
 * each case the dimensions alone would have allowed a number — and the number
 * would be wrong (or undefined).
 */
export function unitRefusal(from: string, to: string): string | null {
  const f = families(from);
  const t = families(to);
  const both = (a: string, b: string): boolean => (f.has(a) && t.has(b)) || (f.has(b) && t.has(a));
  const has = (a: string): boolean => f.has(a) || t.has(a);
  if (has("year")) {
    const which = [...unitTokens(from), ...unitTokens(to)].find((tok) => AMBIGUOUS_YEAR.has(tok.toLowerCase()));
    return (
      `“${which}” does not say which year: a common year is 365 d, the Gregorian 365.2425 d, the Julian 365.25 d and the tropical ≈ 365.2422 d, ` +
      "and conversions differ in the fourth figure. Write “Julian year” (365.25 d exactly, the astronomer's year) or a number of days."
    );
  }
  if (both("absorbeddose", "equivalentdose")) {
    return (
      "Gy (absorbed dose) and Sv (equivalent or effective dose) are both J/kg, but they are DIFFERENT quantities: " +
      "the sievert is the gray weighted by the radiation weighting factor w_R (1 for photons, 20 for α particles) and, for effective dose, the tissue factors w_T. " +
      "No unit factor converts one into the other."
    );
  }
  if (both("radian", "absorbeddose") || both("radian", "equivalentdose")) {
    return "“rad” here is the RADIAN (an angle). The absorbed-dose rad (= 0.01 Gy exactly) is written “rd”, NIST SP 811's symbol for it where the radian could be confused.";
  }
  const dose = has("absorbeddose") ? "absorbeddose" : has("equivalentdose") ? "equivalentdose" : null;
  if (dose) {
    const cu = parseCompoundUnit(f.has(dose) ? to : from);
    if (cu && sameDims(cu.dims, { length: 2, time: -2 })) {
      return (
        `${dose === "absorbeddose" ? "Gy" : "Sv"} is kept as its own quantity (${dose === "absorbeddose" ? "absorbed" : "equivalent"} dose), not as a bare J/kg, ` +
        "so that a gray can never silently become a sievert; to read a J/kg as a dose, write it in Gy (absorbed) or Sv (equivalent)."
      );
    }
  }
  if (has("activity")) {
    const cu = parseCompoundUnit(f.has("activity") ? to : from);
    if (cu && sameDims(cu.dims, { time: -1 })) {
      return (
        "Bq (activity: random decays per second) and Hz (a periodic frequency) are both s⁻¹, and the SI reserves each for its own quantity — " +
        "an activity is not converted to a frequency or a bare s⁻¹."
      );
    }
  }
  // By SIGNATURE, so Pa·s and m²/s are caught as well as P and St.
  const sig = (u: string, d: Record<string, number>): boolean => {
    const c = parseCompoundUnit(u);
    return !!c && sameDims(c.dims, d);
  };
  const DYN = { mass: 1, length: -1, time: -1 };
  const KIN = { length: 2, time: -1 };
  if ((sig(from, DYN) && sig(to, KIN)) || (sig(from, KIN) && sig(to, DYN))) {
    return (
      "Dynamic viscosity (P, cP, Pa·s) and kinematic viscosity (St, cSt, m²/s) are different quantities: kinematic = dynamic ÷ density. " +
      "Converting needs the fluid's density (water near 20 °C: 1 cP ≈ 1 cSt only because its density is ≈ 1 g/cm³)."
    );
  }
  return null;
}

/**
 * How many significant figures the user actually wrote.
 *
 * TRAILING ZEROS IN A BARE INTEGER ARE AMBIGUOUS and are NOT counted: "1000"
 * may carry one figure or four, and there is no way to tell from the text. The
 * conservative reading is the honest one, because over-counting invents
 * precision the measurement may not have — and a lab report is marked on
 * exactly that. A student who means four writes "1000." or "1.000e3", both of
 * which are counted as four.
 *
 * Returns null when the text is not a plain number.
 */
export function significantFigures(text: string): number | null {
  const t = text.trim().replace(/^[+-]/, "");
  const m = /^(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.exec(t);
  if (!m) return null;
  const mantissa = m[1];
  const hasPoint = mantissa.includes(".");
  const digits = mantissa.replace(".", "");
  // Leading zeros are never significant: 0.0042 has two figures.
  const firstSig = digits.search(/[1-9]/);
  if (firstSig < 0) return hasPoint ? Math.max(1, digits.length - 1) : 1; // all zeros
  let significant = digits.slice(firstSig);
  if (!hasPoint) significant = significant.replace(/0+$/, "") || "0";
  return Math.max(1, significant.length);
}

/**
 * The figures a product or quotient may be quoted to: the fewest any input
 * carries. Inputs that are not plain numbers are ignored rather than treated as
 * infinitely precise. Falls back to `fallback` when nothing is countable.
 */
export function resultFigures(inputs: string[], fallback = 4): number {
  const counts = inputs.map(significantFigures).filter((n): n is number => n !== null);
  if (!counts.length) return fallback;
  return Math.min(Math.max(Math.min(...counts), 2), 6);
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
