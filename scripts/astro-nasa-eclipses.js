/* eslint-disable no-undef */
// Extracts the solar eclipses of 2001–2100 from NASA's Five Millennium Canon catalogue page (F. Espenak and
// J. Meeus, eclipse.gsfc.nasa.gov/SEcat5/SE2001-2100.html, fetched 2026-10-29) into the test fixture
// src/lib/__tests__/fixtures/nasa-solar-eclipses.json: date, time of greatest eclipse (TD), type, γ and magnitude.
// Mechanical: every row the page holds, nothing typed by hand.
//
//   node scripts/astro-nasa-eclipses.js <SE2001-2100.html>

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(process.argv[2], "utf8");
const text = html.replace(/<[^>]*>/g, "");
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const rows = [];
for (const line of text.split(/\r?\n/)) {
  // 09539  2014 Apr 29  06:04:33     69    177  148   A-  t-  -1.0000  0.9868  71S 131E   0
  const m = /^\s*\d{5}\s+(\d{4}) (\w{3}) (\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(-?\d+)\s+-?\d+\s+\d+\s+([PATH][0-9a-z+\-]*)\s+\S+\s+(-?\d\.\d{4})\s+(\d\.\d{4})/.exec(line);
  if (!m) continue;
  rows.push({
    y: Number(m[1]), m: MON[m[2]], d: Number(m[3]),
    td: Number(m[4]) + Number(m[5]) / 60 + Number(m[6]) / 3600,
    deltaT: Number(m[7]),
    type: m[8],
    gamma: Number(m[9]),
    mag: Number(m[10]),
  });
}
if (rows.length < 220 || rows.length > 230) throw new Error(`expected about 224 eclipses in 2001–2100, parsed ${rows.length}`);
const out = path.join(__dirname, "..", "src", "lib", "__tests__", "fixtures", "nasa-solar-eclipses.json");
fs.writeFileSync(out, JSON.stringify({ source: "NASA Five Millennium Canon of Solar Eclipses, SE2001-2100.html (Espenak & Meeus), fetched 2026-10-29", rows }));
console.log(`wrote ${rows.length} eclipses to ${out}`);
