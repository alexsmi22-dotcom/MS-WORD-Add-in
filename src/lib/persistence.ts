// Persistent homology of a point cloud — GEOMETRY-TOPOLOGY-DESIGN Release T2.
//
// This is the entry in the topology plan that earns its place for a working
// scientist, because its input is a PASTED TABLE OF POINTS — the same gesture
// as Stats and Analyze — and its output answers a question no summary
// statistic can: does this data have a HOLE in it? A ring of measurements and
// a filled blob have the same mean, the same covariance and very similar
// correlations; they differ in H₁, and that difference is what a barcode shows.
//
// HOW IT WORKS. Build the Vietoris–Rips filtration: every simplex enters at
// the scale equal to the largest pairwise distance among its vertices. Sort by
// that scale, build the boundary matrix over 𝔽₂, and reduce it left to right.
// A column that reduces to zero CREATES a homology class; a column that does
// not KILLS the class its lowest remaining entry created. The pair of scales
// is that feature's lifetime, and a feature that survives across a long range
// of scales is a real one rather than sampling noise.
//
// HONEST LIMITS, all reported in the result rather than buried here:
//   * the Rips complex grows combinatorially — C(n, k+1) simplices in
//     dimension k — so the point count, the dimension and the total simplex
//     count are ALL capped, and any cap that actually bites is REPORTED. The
//     project rule is no silent truncation.
//   * coefficients are 𝔽₂, so this sees holes but not orientation or torsion.
//   * the Rips complex is a proxy for the shape the points were sampled from,
//     not the shape itself; the metric is named because it determines the
//     answer.
//   * a bar is evidence of a feature at that scale, not proof of one.

export interface PersistencePair {
  dimension: number;
  birth: number;
  /** Infinity for a class that never dies within the computed range. */
  death: number;
  /** death − birth; Infinity for an essential class. */
  persistence: number;
}

export interface PersistenceResult {
  points: number;
  dimensions: number;
  /** Simplices actually built, by dimension. */
  cells: number[];
  maxScale: number;
  pairs: PersistencePair[];
  /** The most persistent finite bar per dimension — the headline features. */
  notable: PersistencePair[];
  /** Betti numbers at a chosen scale, if one was requested. */
  bettiAt?: { scale: number; betti: number[] };
  steps: string[];
  caveats: string[];
  /** Set when a cap changed what was computed. Never silent. */
  capped?: string;
}

export interface PersistenceOptions {
  /** Highest homology dimension to compute (H_0 … H_maxDim). */
  maxDim?: number;
  /** Largest scale to grow to; default is the data's own diameter. */
  maxScale?: number;
  /** Report Betti numbers at this scale as well as the full barcode. */
  bettiAt?: number;
}

/** Caps. Generous enough for real data, small enough to stay interactive. */
const MAX_POINTS = 150;
const MAX_SIMPLICES = 60000;
const MAX_DIM = 2;

/** Euclidean distance in any dimension. */
export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

interface Simplex {
  verts: number[];
  dim: number;
  birth: number;
}

/**
 * Enumerates the Rips complex up to `maxDim` and `maxScale`.
 * Returns null when the cap would be exceeded, so the caller can report it
 * rather than silently returning a partial answer.
 */
function ripsComplex(
  dist: number[][], n: number, maxDim: number, maxScale: number
): { simplices: Simplex[]; truncated: boolean; completedDim: number } {
  const simplices: Simplex[] = [];
  for (let i = 0; i < n; i++) simplices.push({ verts: [i], dim: 0, birth: 0 });

  // Edges within the scale.
  const edges: Simplex[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist[i][j] <= maxScale) edges.push({ verts: [i, j], dim: 1, birth: dist[i][j] });
    }
  }
  simplices.push(...edges);
  if (simplices.length > MAX_SIMPLICES) return { simplices, truncated: true, completedDim: 0 };

  // Higher simplices: a set of vertices forms one iff every pair is an edge,
  // and it enters at the largest of those pairwise distances.
  let previous: Simplex[] = edges;
  for (let d = 2; d <= maxDim; d++) {
    const next: Simplex[] = [];
    for (const s of previous) {
      const last = s.verts[s.verts.length - 1];
      for (let v = last + 1; v < n; v++) {
        let birth = s.birth;
        let ok = true;
        for (const u of s.verts) {
          const duv = dist[u][v];
          if (duv > maxScale) { ok = false; break; }
          if (duv > birth) birth = duv;
        }
        if (ok) next.push({ verts: [...s.verts, v], dim: d, birth });
      }
      if (simplices.length + next.length > MAX_SIMPLICES) {
        return { simplices, truncated: true, completedDim: d - 1 };
      }
    }
    simplices.push(...next);
    previous = next;
    if (!next.length) break;
  }
  return { simplices, truncated: false, completedDim: maxDim };
}

/**
 * Standard persistence reduction over 𝔽₂.
 *
 * Columns are processed in filtration order. A column is repeatedly reduced by
 * whichever earlier column shares its lowest nonzero row, until it is either
 * empty (this simplex CREATES a class) or its low is unclaimed (this simplex
 * KILLS the class that its low created). That is the whole algorithm; the
 * subtlety is only in the ordering, which must break ties by dimension so a
 * face never follows the simplex it bounds.
 */
function reduce(simplices: Simplex[]): PersistencePair[] {
  const n = simplices.length;
  const index = new Map<string, number>();
  simplices.forEach((s, i) => index.set(s.verts.join(","), i));

  // Boundary columns as sets of row indices.
  const cols: Set<number>[] = simplices.map((s) => {
    const col = new Set<number>();
    if (s.dim === 0) return col;
    for (let k = 0; k < s.verts.length; k++) {
      const face = s.verts.filter((_, m) => m !== k);
      const fi = index.get(face.join(","));
      if (fi !== undefined) col.add(fi);
    }
    return col;
  });

  const lowOf = (c: Set<number>): number => {
    let mx = -1;
    for (const v of c) if (v > mx) mx = v;
    return mx;
  };

  const pairedBy = new Map<number, number>(); // low row -> the column that claimed it
  const pairs: PersistencePair[] = [];
  const isKiller = new Array<boolean>(n).fill(false);

  for (let j = 0; j < n; j++) {
    let low = lowOf(cols[j]);
    while (low >= 0 && pairedBy.has(low)) {
      const j2 = pairedBy.get(low)!;
      // Symmetric difference: addition over 𝔽₂.
      for (const v of cols[j2]) {
        if (cols[j].has(v)) cols[j].delete(v);
        else cols[j].add(v);
      }
      low = lowOf(cols[j]);
    }
    if (low >= 0) {
      pairedBy.set(low, j);
      isKiller[j] = true;
      const birth = simplices[low].birth;
      const death = simplices[j].birth;
      // A zero-length bar is an artefact of simultaneous entry, not a feature.
      if (death > birth) {
        pairs.push({
          dimension: simplices[low].dim,
          birth, death, persistence: death - birth,
        });
      }
    }
  }

  // Anything that created a class and was never killed is essential.
  // `pairedBy` is keyed BY the low row, so "was j claimed as someone's low?" is
  // a direct has() — an earlier version rebuilt the key list on every iteration,
  // which is O(n²) and would have crawled at the 60,000-simplex cap.
  for (let j = 0; j < n; j++) {
    if (isKiller[j] || cols[j].size > 0) continue;
    if (!pairedBy.has(j)) {
      pairs.push({
        dimension: simplices[j].dim,
        birth: simplices[j].birth,
        death: Infinity,
        persistence: Infinity,
      });
    }
  }
  return pairs;
}

/**
 * Persistent homology of a point cloud.
 * Throws only on structurally unusable input; every soft limit is reported.
 */
export function persistentHomology(
  points: number[][], opts: PersistenceOptions = {}
): PersistenceResult {
  const n = points.length;
  const steps: string[] = [];
  const caveats: string[] = [];
  let capped: string | undefined;

  if (n < 2) {
    throw new Error("Persistent homology needs at least two points.");
  }
  let use = points;
  if (n > MAX_POINTS) {
    use = points.slice(0, MAX_POINTS);
    capped = `Only the first ${MAX_POINTS} of ${n} points were used. The Rips complex grows combinatorially, so the point count is capped — this is a reported limit, not a silent truncation.`;
  }
  const m = use.length;

  // Distance matrix.
  const dist: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  let diameter = 0;
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const d = euclidean(use[i], use[j]);
      dist[i][j] = dist[j][i] = d;
      if (d > diameter) diameter = d;
    }
  }

  const maxDim = Math.min(opts.maxDim ?? 1, MAX_DIM);
  const maxScale = opts.maxScale ?? diameter;
  // A class in H_k is CREATED by a k-simplex and KILLED by a (k+1)-simplex, so
  // the complex must be built one dimension higher than the homology asked for.
  // Build only to H_k and every H_k bar is necessarily infinite — a loop with no
  // triangles can never be filled in — which is exactly the empty barcode this
  // got wrong first time round.
  const topDim = maxDim + 1;
  steps.push(`${m} points in ${use[0].length}D; diameter ${diameter.toPrecision(6)}.`);
  steps.push(
    `Vietoris–Rips filtration up to scale ${maxScale.toPrecision(6)}, homology to H${maxDim} ` +
    `(simplices to dimension ${topDim}, since a class in H${maxDim} can only be killed by a ${topDim}-simplex).`
  );

  const { simplices, truncated, completedDim } = ripsComplex(dist, m, topDim, maxScale);
  if (truncated) {
    capped = (capped ? capped + " " : "") +
      `The complex hit the ${MAX_SIMPLICES.toLocaleString()}-simplex cap and was cut short. `;
    // A cut that lands BELOW the killing dimension is not a small omission — it
    // changes the answer qualitatively. A loop can only be filled in by a
    // triangle, so if triangles were never built, every loop looks immortal and
    // the H1 barcode is not merely incomplete, it is misleading. Say which.
    if (completedDim < topDim) {
      const unreliable: number[] = [];
      for (let d = 0; d <= maxDim; d++) if (d + 1 > completedDim) unreliable.push(d);
      if (unreliable.length) {
        capped +=
          `Simplices were only completed up to dimension ${completedDim}, so ` +
          `H${unreliable.join(", H")} ${unreliable.length > 1 ? "are" : "is"} NOT RELIABLE here: ` +
          `a class in H${unreliable[0]} can only be killed by a ${unreliable[0] + 1}-simplex, and those were not all built, ` +
          `so features will appear to live forever whether or not they really do. ` +
          `Use fewer points or a smaller maximum scale before reading anything into those bars.`;
      }
    } else {
      capped += `Bars near the largest scales may be missing. Reduce the number of points or the maximum scale for a complete answer.`;
    }
  }

  // Filtration order: by birth, then by dimension so a face precedes its coface.
  simplices.sort((a, b) => a.birth - b.birth || a.dim - b.dim || a.verts.length - b.verts.length);

  const cells: number[] = [];
  for (const s of simplices) cells[s.dim] = (cells[s.dim] ?? 0) + 1;
  for (let d = 0; d < cells.length; d++) if (cells[d] === undefined) cells[d] = 0;
  steps.push(`Simplices built: ${cells.map((c, d) => `${c} in dim ${d}`).join(", ")}.`);

  const pairs = reduce(simplices);
  pairs.sort((a, b) => a.dimension - b.dimension || b.persistence - a.persistence || a.birth - b.birth);

  // The headline: the longest FINITE bar in each dimension above 0.
  const notable: PersistencePair[] = [];
  for (let d = 0; d <= maxDim; d++) {
    const finite = pairs.filter((p) => p.dimension === d && Number.isFinite(p.persistence));
    if (finite.length) notable.push(finite.reduce((a, b) => (b.persistence > a.persistence ? b : a)));
  }

  let bettiAt: PersistenceResult["bettiAt"];
  if (typeof opts.bettiAt === "number") {
    const s = opts.bettiAt;
    const betti: number[] = new Array(maxDim + 1).fill(0);
    for (const p of pairs) {
      if (p.birth <= s && p.death > s) betti[p.dimension] = (betti[p.dimension] ?? 0) + 1;
    }
    bettiAt = { scale: s, betti };
    steps.push(`At scale ${s}: Betti numbers ${betti.join(", ")}.`);
  }

  caveats.push(
    "Coefficients are 𝔽₂, so this detects holes but not orientation or torsion — a Klein bottle and a torus are not distinguished here."
  );
  caveats.push(
    "The Vietoris–Rips complex is a PROXY for the shape the points were sampled from, not the shape itself, and the answer depends on the metric — Euclidean distance is what was used."
  );
  caveats.push(
    "A long bar is EVIDENCE of a feature at that scale, not proof of one. Short bars are usually sampling noise; the contrast between the longest bar and the rest is what carries the signal."
  );
  if (capped) caveats.push(capped);

  return {
    points: m, dimensions: use[0].length, cells, maxScale,
    pairs, notable, bettiAt, steps, caveats, capped,
  };
}

// ---------------------------------------------------------------------------
// Barcode figure.
//
// A dedicated builder rather than plot.ts's: a barcode is not a function plot.
// Each bar is a horizontal segment from birth to death at its own row, grouped
// by dimension, and an INFINITE bar must be drawn as running off the right edge
// with an arrow rather than being clipped to a finite value that would read as
// a death that never happened.
// ---------------------------------------------------------------------------

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function barcodeSvg(res: PersistenceResult, width = 460, height = 300): string {
  const padL = 54, padR = 26, padT = 30, padB = 40;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const bars = res.pairs.slice().sort((a, b) => a.dimension - b.dimension || a.birth - b.birth);
  if (!bars.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="#fff"/>` +
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Georgia,serif" font-size="13" fill="#5b5b66">No persistent features found.</text></svg>`;
  }
  const xMax = res.maxScale > 0 ? res.maxScale : 1;
  const x = (v: number) => padL + (Math.min(v, xMax) / xMax) * plotW;
  const rowH = Math.max(2, Math.min(12, plotH / bars.length));

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  out += `<rect width="${width}" height="${height}" fill="#fff"/>`;
  out += `<text x="${padL}" y="18" font-family="Georgia,serif" font-size="12" fill="#1b1b1f">Persistence barcode</text>`;
  // Axis.
  out += `<g stroke="#1A1A1A" stroke-width="1" fill="none"><path d="M${padL} ${padT + plotH} H${padL + plotW}"/></g>`;
  for (let k = 0; k <= 4; k++) {
    const v = (xMax * k) / 4;
    const px = x(v);
    out += `<path d="M${px} ${padT + plotH} V${padT + plotH + 5}" stroke="#1A1A1A" stroke-width="1"/>`;
    out += `<text x="${px}" y="${padT + plotH + 18}" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="#7B8C99">${Number(v.toPrecision(3))}</text>`;
  }
  out += `<text x="${padL + plotW / 2}" y="${height - 6}" text-anchor="middle" font-family="Georgia,serif" font-size="10" fill="#7B8C99">scale (ε)</text>`;

  // Bars, darker with increasing dimension so H0 and H1 are distinguishable in
  // black and white — this figure goes into patent-style documents.
  const shade = ["#9DB3C4", "#0C4A6E", "#1A1A1A"];
  bars.forEach((b, i) => {
    const y = padT + i * rowH + rowH / 2;
    const x1 = x(b.birth);
    const infinite = !Number.isFinite(b.death);
    const x2 = infinite ? padL + plotW : x(b.death);
    out += `<path d="M${x1.toFixed(1)} ${y.toFixed(1)} H${x2.toFixed(1)}" stroke="${shade[Math.min(b.dimension, 2)]}" stroke-width="${Math.max(1.2, rowH * 0.6).toFixed(1)}" stroke-linecap="butt"/>`;
    if (infinite) {
      out += `<path d="M${(x2 - 6).toFixed(1)} ${(y - 3).toFixed(1)} l6 3 l-6 3" fill="none" stroke="${shade[Math.min(b.dimension, 2)]}" stroke-width="1.2"/>`;
    }
  });

  // Legend.
  const dims = [...new Set(bars.map((b) => b.dimension))].sort();
  dims.forEach((d, i) => {
    const ly = 18 + i * 0;
    const lx = padL + plotW - 60 - i * 0;
    out += `<g transform="translate(${lx - i * 56}, ${ly})">` +
      `<path d="M0 -4 H14" stroke="${shade[Math.min(d, 2)]}" stroke-width="3"/>` +
      `<text x="18" y="0" font-family="Georgia,serif" font-size="10" fill="#1b1b1f">H${escapeXml(String(d))}</text></g>`;
  });
  out += `</svg>`;
  return out;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/** Parses pasted rows of coordinates: "1 2", "1,2,3", one point per line. */
export function parsePointCloud(text: string): number[][] | null {
  const rows: number[][] = [];
  for (const raw of text.split(/[\n;]/)) {
    const line = raw.trim();
    if (!line || /^[A-Za-z]/.test(line)) continue; // skip blank lines and headers
    const nums = (line.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || []).map(Number);
    if (nums.length >= 1 && nums.every(Number.isFinite)) rows.push(nums);
  }
  if (rows.length < 2) return null;
  // Every point must have the same dimension, or the metric is meaningless.
  const d = rows[0].length;
  if (!rows.every((r) => r.length === d)) return null;
  return rows;
}
