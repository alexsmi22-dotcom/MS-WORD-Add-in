// Regenerates assets/icon-*.png from the JurisLab mark.
//
//   node scripts/make-icons.mjs
//
// The mark is a balance weighing science against mathematics: a benzene ring on
// one pan, a sigma on the other. assets/logo.svg is the source of truth for the
// large sizes.
//
// The two smallest icons are NOT downscaled from that file. At 16px a 5.4-unit
// stroke on a 128 viewBox lands at 0.67 device pixels and greys out into mush,
// so they render from redrawn variants with heavier strokes, larger pans and no
// finial. Same mark, drawn for the size it is actually seen at — this is the
// ribbon icon, and Word never shows it larger than 32.
//
// 16 goes further still: the benzene ring is filled rather than outlined,
// because a 1px-wide ring reads as a grey smudge while a solid pan still reads
// as a pan. Detail that cannot survive the raster is worse than no detail.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const COMPACT = `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0EA5E9"/>
      <stop offset="1" stop-color="#0C4A6E"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="24" fill="url(#g)"/>
  <g fill="#fff">
    <rect x="16" y="33" width="96" height="10" rx="5"/>
    <rect x="58" y="33" width="12" height="65" rx="3"/>
    <rect x="40" y="98" width="48" height="12" rx="4"/>
  </g>
  <g fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="47,68 39.5,80.99 24.5,80.99 17,68 24.5,55.01 39.5,55.01"/>
    <polyline points="110,55 82,55 96,68 82,81 110,81"/>
  </g>
</svg>`;

const TINY = `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0EA5E9"/>
      <stop offset="1" stop-color="#0C4A6E"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="22" fill="url(#g)"/>
  <g fill="#fff">
    <rect x="12" y="30" width="104" height="13" rx="6.5"/>
    <rect x="56" y="30" width="15" height="68" rx="3"/>
    <rect x="36" y="98" width="56" height="14" rx="5"/>
    <polygon points="47,70 38.5,84.72 21.5,84.72 13,70 21.5,55.28 38.5,55.28"/>
  </g>
  <g fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="112,57 82,57 97,70 82,83 112,83"/>
  </g>
</svg>`;

// size -> which drawing to rasterise from
const TARGETS = [
  [128, "full"],
  [80, "full"],
  [64, "full"],
  [32, "compact"],
  [16, "tiny"],
];

const DRAWINGS = {
  full: await readFile(join(ASSETS, "logo.svg")),
  compact: Buffer.from(COMPACT),
  tiny: Buffer.from(TINY),
};

for (const [size, variant] of TARGETS) {
  const svg = DRAWINGS[variant];
  // Rasterise at the SVG's natural density for the target size rather than
  // rendering once and downsampling, so strokes stay crisp instead of blurring.
  const png = await sharp(svg, { density: (72 * size) / 128 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(ASSETS, `icon-${size}.png`), png);
  console.log(`  icon-${size}.png  (${variant}, ${png.length} bytes)`);
}
