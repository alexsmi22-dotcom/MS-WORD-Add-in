/* eslint-disable no-undef */
// Generates src/lib/astroData.ts: the coefficient tables of the Astronomy & lunar engines, extracted MECHANICALLY
// from machine-readable sources. No coefficient is typed by hand. Run:
//
//   node scripts/gen-astro-data.js <astronomia package dir> <Leap_Second.dat> <phys_par.html> <sat_phys.html> <sat_elem.html>
//
// Sources (fetched 2026-10-28):
//   astronomia 4.1.1 (npm; MIT, (c) 2013 Sonia Keys, 2016 commenthol), a port of Meeus, Astronomical Algorithms 2nd
//     ed.: src/moonposition.js tables 47.A and 47.B (the ELP-2000/82 truncation of chapter 47) and src/nutation.js
//     table 22.A (IAU 1980 nutation, terms below 0.0003″ dropped, chapter 22).
//   astronomia data/vsop87B<planet>.js: the VSOP87B series (Bretagnon & Francou 1988), truncated here (see VSOP_EPS).
//   IERS Leap_Second.dat (the copy in astropy-iers-data, "Updated through IERS Bulletin 72", with its expiry line).
//   JPL SSD planetary physical parameters (planets/phys_par.html), satellite physical parameters (sats/phys_par/)
//     and satellite mean elements (sats/elem/): radii, masses, GM, densities, rotation and orbit periods.
//
// The crosscheck is src/lib/__tests__/astroOracle.test.ts: positions from these tables against JPL DE421 (skyfield)
// at many dates, so a slip in any extracted row fails there.

const fs = require("fs");
const path = require("path");

const [pkgDir, leapDat, physHtml, satPhysHtml, satElemHtml] = process.argv.slice(2);
const srcDir = pkgDir && path.join(pkgDir, "src");
const dataDir = pkgDir && path.join(pkgDir, "data");
if (!pkgDir || !leapDat || !physHtml || !satPhysHtml || !satElemHtml) {
  console.error(
    "usage: node scripts/gen-astro-data.js <astronomia package dir> <Leap_Second.dat> " +
      "<planets/phys_par.html> <sats/phys_par.html> <sats/elem.html>",
  );
  process.exit(2);
}

/** Every <tr> of an HTML page as its cells' text (tags and entities dropped, whitespace collapsed). */
function tableRows(file) {
  const h = fs.readFileSync(file, "utf8");
  return [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)(?=<\/t[dh]>|<t[dh]|$)/g)].map((c) =>
      c[1].replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(),
    ),
  );
}
/** The leading number of a cell ("2440.53 [ D ] 0.04" -> 2440.53). */
function lead(cell, what) {
  const m = /^[-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?/.exec(cell);
  if (!m) throw new Error(`${what}: no number in "${cell}"`);
  return Number(m[0]);
}

/** The numeric array literal assigned in `const <name> = [` (plain numbers only), parsed as JSON. */
function arrayAfter(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) throw new Error("marker not found: " + marker);
  const open = text.indexOf("[", i + marker.length - 1);
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "[") depth++;
    else if (text[j] === "]" && --depth === 0) return JSON.parse(text.slice(open, j + 1).replace(/\s+/g, ""));
  }
  throw new Error("unbalanced array after " + marker);
}

const moon = fs.readFileSync(path.join(srcDir, "moonposition.js"), "utf8");
const ta = arrayAfter(moon, "const ta = [");
const tb = arrayAfter(moon, "const tb = [");
if (ta.length !== 60 || tb.length !== 60) throw new Error(`table 47.A/B: expected 60 rows each, got ${ta.length}/${tb.length}`);

const nut = fs.readFileSync(path.join(srcDir, "nutation.js"), "utf8");
if (!/const PROPS = 'd,m,n,f,ω,s0,s1,c0,c1'/.test(nut)) throw new Error("nutation.js column order changed");
const t22 = arrayAfter(nut, "const tab = [");
if (t22.length !== 63) throw new Error(`table 22.A: expected 63 rows, got ${t22.length}`);

// VSOP87B (heliocentric spherical, ecliptic and equinox of J2000), truncated: a term A·cos(B + C·τ)·τ^α (τ in
// Julian millennia) is kept when A·(a scale)·0.5^α ≥ VSOP_EPS, the scale being 1 for L and B (radians) and 1/a for R
// (au, so a term moves the direction by about A/a radians). 0.5 millennia is the half-width of the 1500–2500 core.
const VSOP_EPS = 1e-6;
const VSOP_BODIES = { mercury: 0.387, venus: 0.723, earth: 1, mars: 1.524, jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07 };
function vsop(body) {
  const text = fs.readFileSync(path.join(dataDir, `vsop87B${body}.js`), "utf8");
  const out = { L: [], B: [], R: [] };
  let coord = null;
  let alpha = -1;
  let full = 0;
  for (const line of text.split(/\r?\n/)) {
    const c = /^\s*([LBR]):\s*\{/.exec(line);
    if (c) {
      coord = c[1];
      continue;
    }
    const a = /^\s*"(\d)":\s*\[/.exec(line);
    if (a) {
      alpha = Number(a[1]);
      if (alpha !== out[coord].length) throw new Error(`${body} ${coord}: power ${alpha} out of order`);
      out[coord].push([]);
      continue;
    }
    const r = /^\s*\[([-0-9.eE+]+),\s*([-0-9.eE+]+),\s*([-0-9.eE+]+)\]/.exec(line);
    if (r) {
      full++;
      const A = Number(r[1]);
      const s = coord === "R" ? 1 / VSOP_BODIES[body] : 1;
      if (A * s * Math.pow(0.5, alpha) >= VSOP_EPS) out[coord][alpha].push(`${r[1]},${r[2]},${r[3]}`);
    }
  }
  if (out.L.length < 3 || out.B.length < 3 || out.R.length < 3 || full < 500) throw new Error(`${body}: VSOP87 parse failed (${full} terms)`);
  return out;
}
const vsopAll = Object.fromEntries(Object.keys(VSOP_BODIES).map((b) => [b, vsop(b)]));
const vsopKept = Object.values(vsopAll).reduce((n, o) => n + ["L", "B", "R"].reduce((m, k) => m + o[k].reduce((q, x) => q + x.length, 0), 0), 0);

// Leap seconds.
const leap = fs.readFileSync(leapDat, "utf8");
const exp = /File expires on\s+(\d+)\s+(\w+)\s+(\d{4})/.exec(leap);
if (!exp) throw new Error("Leap_Second.dat: no expiry line");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const expMonth = MONTHS.indexOf(exp[2]) + 1;
if (expMonth < 1) throw new Error("Leap_Second.dat: expiry month " + exp[2]);
const upd = /Updated through IERS Bulletin\s+(\d+)\s+issued in\s+(\w+)\s+(\d{4})/.exec(leap);
const leapRows = leap
  .split(/\r?\n/)
  .filter((l) => /^\s*\d+\.0\s+\d+\s+\d+\s+\d{4}\s+\d+\s*$/.test(l))
  .map((l) => l.trim().split(/\s+/).map(Number))
  .map(([mjd, , , , dat]) => [mjd, dat]);
if (leapRows.length < 28 || leapRows[0][1] !== 10) throw new Error("Leap_Second.dat rows unreadable");

// JPL SSD planetary physical parameters: planets (mass 10^24 kg) and the dwarf-planet table (mass 10^18 kg).
const physRows = tableRows(physHtml);
const PHYS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const phys = PHYS.map((name) => {
  const r = physRows.find((x) => x[0] === name && x.length === 11);
  if (!r) throw new Error("phys_par: " + name + " missing");
  const v = r.slice(1).map((c) => lead(c, name));
  const massScale = name === "Pluto" ? 1e18 : 1e24;
  // [eqRadius km, meanRadius km, mass kg, density g/cm³, rotation d, orbit y, V(1,0), albedo, g m/s², v_esc km/s]
  return [name.toLowerCase(), v[0], v[1], Number((v[2] * massScale).toPrecision(12)), v[3], v[4], v[5], v[6], v[7], v[8], v[9]];
});
// JPL SSD satellite physical parameters (GM, mean radius, density) and mean elements (a, sidereal period).
const MOONS = ["Moon", "Phobos", "Io", "Europa", "Ganymede", "Callisto", "Enceladus", "Titan", "Titania", "Triton", "Charon"];
const satPhys = tableRows(satPhysHtml);
const satElem = tableRows(satElemHtml);
const moons = MOONS.map((name) => {
  const p = satPhys.find((x) => x[1] === name && x.length >= 10);
  const e = satElem.find((x) => x[2] === name && x.length >= 14);
  if (!p || !e) throw new Error("sats: " + name + " missing");
  // [id, parent, GM km³/s², mean radius km, density g/cm³, a km, period d]
  return [name.toLowerCase(), p[0].toLowerCase(), lead(p[3], name), lead(p[6], name), lead(p[9], name), lead(e[7], name), lead(e[13], name)];
});

const row = (r) => "[" + r.map((x) => (typeof x === "string" ? JSON.stringify(x) : x)).join(", ") + "]";
const rows = (t, per = 1) => {
  const out = [];
  for (let i = 0; i < t.length; i += per) out.push("  " + t.slice(i, i + per).map(row).join(", ") + ",");
  return out.join("\n");
};

const ts = `// GENERATED by scripts/gen-astro-data.js — do not edit by hand; regenerate from the sources it names.
//
// PROVENANCE. Every coefficient below was extracted MECHANICALLY by that script; none was typed by hand.
//   - MOON_LR / MOON_B: Meeus, Astronomical Algorithms (2nd ed., 1998), tables 47.A and 47.B, the truncation of
//     Chapront's ELP-2000/82 lunar theory used in chapter 47. Taken from the machine-readable port in the astronomia
//     npm package 4.1.1 (src/moonposition.js; MIT licence, (c) 2013 Sonia Keys, (c) 2016 commenthol).
//   - NUTATION_22A: Meeus table 22.A, the IAU 1980 nutation series with terms below 0.0003″ dropped (astronomia
//     src/nutation.js, same licence).
//   - VSOP87: Bretagnon & Francou (1988) VSOP87B series for the Earth and the planets, from the machine-readable
//     copy in astronomia 4.1.1 (data/vsop87B<planet>.js, same licence), TRUNCATED by the script at the threshold
//     stated on the table (the way Meeus's Appendix III truncates it, at a level the oracle test measures).
//   - LEAP_SECONDS: IERS Leap_Second.dat (astropy-iers-data copy, Bulletin ${upd ? upd[1] : "?"}${upd ? ` of ${upd[2]} ${upd[3]}` : ""}).
//   - PLANET_PHYS / MOON_PHYS: JPL Solar System Dynamics physical-parameter and satellite-element pages (fetched
//     2026-10-28), each cell's leading number.
// The crosscheck is src/lib/__tests__/astroOracle.test.ts (positions against JPL DE421 at many dates 1900–2100): a
// slip in any row moves a position there and fails.

/** Table 47.A rows: [D, M, M′, F, Σl coefficient (10⁻⁶ deg), Σr coefficient (10⁻³ km)]. */
export const MOON_LR: ReadonlyArray<readonly number[]> = [
${rows(ta, 3)}
];

/** Table 47.B rows: [D, M, M′, F, Σb coefficient (10⁻⁶ deg)]. */
export const MOON_B: ReadonlyArray<readonly number[]> = [
${rows(tb, 4)}
];

/** Table 22.A rows: [D, M, M′, F, Ω, Δψ sin coefficient, its T rate, Δε cos coefficient, its T rate] (0.0001″). */
export const NUTATION_22A: ReadonlyArray<readonly number[]> = [
${rows(t22, 2)}
];

/**
 * VSOP87B truncated (Bretagnon & Francou 1988), heliocentric ecliptic longitude L, latitude B (rad) and radius R (au),
 * mean ecliptic and equinox of J2000. Per body and coordinate, one flat array per power α of τ (Julian millennia
 * from J2000) holding triples A, B, C of A·cos(B + C·τ). Kept: A·(1 or 1/a)·0.5^α ≥ ${VSOP_EPS} (${vsopKept} terms).
 */
export const VSOP87: Readonly<Record<string, { L: number[][]; B: number[][]; R: number[][] }>> = {
${Object.entries(vsopAll)
  .map(([b, o]) => `  ${b}: {\n${["L", "B", "R"].map((k) => `    ${k}: [\n${o[k].map((terms) => `      [${terms.join(", ")}],`).join("\n")}\n    ],`).join("\n")}\n  },`)
  .join("\n")}
};

/** TAI − UTC from the MJD at which each value starts: [MJD, seconds]. */
export const LEAP_SECONDS: ReadonlyArray<readonly [number, number]> = [
${rows(leapRows, 4)}
];
/** The leap-second table's own expiry (IERS): past it a leap second may have been announced that this table lacks. */
export const LEAP_SECONDS_EXPIRY = { year: ${exp[3]}, month: ${expMonth}, day: ${Number(exp[1])} } as const;

/**
 * JPL SSD "Planetary Physical Parameters" (ssd.jpl.nasa.gov/planets/phys_par.html, fetched 2026-10-28): [id,
 * equatorial radius km, mean radius km, mass kg, bulk density g/cm³, sidereal rotation d (negative = retrograde),
 * sidereal orbit y, V(1,0), geometric albedo, equatorial gravity m/s², escape velocity km/s].
 */
export const PLANET_PHYS: ReadonlyArray<readonly [string, number, number, number, number, number, number, number, number, number, number]> = [
${rows(phys)}
];

/**
 * JPL SSD satellite physical parameters (ssd.jpl.nasa.gov/sats/phys_par/) and mean orbital elements
 * (ssd.jpl.nasa.gov/sats/elem/), fetched 2026-10-28: [id, parent, GM km³/s², mean radius km, density g/cm³,
 * semi-major axis km, sidereal period d].
 */
export const MOON_PHYS: ReadonlyArray<readonly [string, string, number, number, number, number, number]> = [
${rows(moons)}
];
`;

const outPath = path.join(__dirname, "..", "src", "lib", "astroData.ts");
fs.writeFileSync(outPath, ts.replace(/\n/g, "\n"));
console.log(`wrote ${outPath}: 47.A ${ta.length}, 47.B ${tb.length}, 22.A ${t22.length}, VSOP87 ${vsopKept} terms, leap ${leapRows.length}, expiry ${exp[1]} ${exp[2]} ${exp[3]}`);
