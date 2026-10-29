// Scene modelling & pipeline: the production-efficiency engines. Screen-space size and level-of-detail switching
// (projected size from the vertical field of view, switch distances from each LOD's geometric error and a pixel
// tolerance, triangle density on screen), texture memory (uncompressed and block-compressed, the exact mip chain with
// whole blocks beside the ×4/3 rule) and texel density, render-farm completion (Amdahl within a node, whole frames
// across nodes, LPT scheduling for measured frame times, nodes for a deadline, cost) with frame-sequence storage and
// transfer, and pipeline throughput (the bottleneck stage and Little's law).
//
// Pure functions over SI-ish plain numbers (metres, seconds, bytes); the glue (sceneCalcs.ts) converts units and words
// the results. Amdahl is computation.ts's parallelSpeedup, not a second copy.

import { parallelSpeedup } from "./computation";

// ---------------------------------------------------------------------------------------------------------------
// Screen-space size and LOD
// ---------------------------------------------------------------------------------------------------------------

/** Focal length in pixels for a vertical field of view (radians) over `heightPx` image rows. */
export function focalPx(fovV: number, heightPx: number): number {
  return heightPx / 2 / Math.tan(fovV / 2);
}

export interface ScreenSize {
  focal: number;
  /** Projected radius in pixels, the usual small-angle form f·r/d. */
  radiusPx: number;
  /** The exact silhouette radius of a sphere at the image centre: f·tan(asin(r/d)) = f·r/√(d² − r²). */
  radiusPxExact: number;
  /** Projected area in pixels (π·radiusPx²). */
  areaPx: number;
  /** Fraction of the image height the diameter covers. */
  heightFraction: number;
}

export function screenSize(r: number, d: number, fovV: number, heightPx: number): ScreenSize {
  const f = focalPx(fovV, heightPx);
  const radiusPx = (f * r) / d;
  const radiusPxExact = (f * r) / Math.sqrt(d * d - r * r);
  return { focal: f, radiusPx, radiusPxExact, areaPx: Math.PI * radiusPx * radiusPx, heightFraction: (2 * radiusPx) / heightPx };
}

export interface LodLevel {
  name: string;
  /** Object-space geometric error (largest deviation from the full-detail surface), metres. */
  error: number;
  triangles: number;
}

export interface LodBand extends LodLevel {
  /** The distance beyond which this level's error projects to at most the pixel tolerance: f·ε/τ. */
  switchDistance: number;
  /** The distance band over which this LOD is the coarsest acceptable one: [from, to). to = ∞ for the last. */
  from: number;
  to: number | null;
}

/**
 * Switch distances: level i is acceptable once its screen-space error f·εᵢ/d is at most τ pixels, i.e. beyond
 * dᵢ = f·εᵢ/τ. Levels must be ordered finest first with errors strictly increasing.
 */
export function lodBands(levels: LodLevel[], f: number, tolPx: number): LodBand[] {
  const out: LodBand[] = levels.map((l) => ({ ...l, switchDistance: (f * l.error) / tolPx, from: 0, to: null }));
  for (let i = 0; i < out.length; i++) {
    out[i].from = i === 0 ? 0 : out[i].switchDistance;
    out[i].to = i + 1 < out.length ? out[i + 1].switchDistance : null;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Texture memory
// ---------------------------------------------------------------------------------------------------------------

export interface TexFormat {
  id: string;
  label: string;
  /** Bits per pixel (exact; for a block format, block bits / block pixels). */
  bpp: number;
  /** Block dimensions and bytes; 1 × 1 for an uncompressed format. */
  bw: number;
  bh: number;
  blockBytes: number;
}

const astc = (w: number, h: number): TexFormat => ({ id: `astc${w}x${h}`, label: `ASTC ${w}×${h}`, bpp: 128 / (w * h), bw: w, bh: h, blockBytes: 16 });
const raw = (id: string, label: string, bytes: number): TexFormat => ({ id, label, bpp: bytes * 8, bw: 1, bh: 1, blockBytes: bytes });

/** The formats offered, uncompressed first, then BCn (8 B per 4×4 for BC1/BC4, 16 B for the rest), then ASTC (16 B blocks). */
export const TEX_FORMATS: TexFormat[] = [
  raw("r8", "R8 (1 channel × 8 bit)", 1),
  raw("rg8", "RG8 (2 × 8 bit)", 2),
  raw("rgb8", "RGB8 (3 × 8 bit, unpadded)", 3),
  raw("rgba8", "RGBA8 (4 × 8 bit)", 4),
  raw("rgba16f", "RGBA16F (4 × half float)", 8),
  raw("rgba32f", "RGBA32F (4 × float)", 16),
  { id: "bc1", label: "BC1 / DXT1 (RGB, 4 bpp)", bpp: 4, bw: 4, bh: 4, blockBytes: 8 },
  { id: "bc3", label: "BC3 / DXT5 (RGBA, 8 bpp)", bpp: 8, bw: 4, bh: 4, blockBytes: 16 },
  { id: "bc4", label: "BC4 (1 channel, 4 bpp)", bpp: 4, bw: 4, bh: 4, blockBytes: 8 },
  { id: "bc5", label: "BC5 (2 channels, 8 bpp)", bpp: 8, bw: 4, bh: 4, blockBytes: 16 },
  { id: "bc6h", label: "BC6H (HDR RGB, 8 bpp)", bpp: 8, bw: 4, bh: 4, blockBytes: 16 },
  { id: "bc7", label: "BC7 (RGBA, 8 bpp)", bpp: 8, bw: 4, bh: 4, blockBytes: 16 },
  astc(4, 4),
  astc(5, 4),
  astc(5, 5),
  astc(6, 5),
  astc(6, 6),
  astc(8, 5),
  astc(8, 6),
  astc(8, 8),
  astc(10, 5),
  astc(10, 6),
  astc(10, 8),
  astc(10, 10),
  astc(12, 10),
  astc(12, 12),
];

/** A custom uncompressed format: channels × bytes per channel. */
export function rawFormat(channels: number, bytesPerChannel: number): TexFormat {
  return raw("custom", `${channels} channel${channels === 1 ? "" : "s"} × ${bytesPerChannel} byte${bytesPerChannel === 1 ? "" : "s"}`, channels * bytesPerChannel);
}

export interface TexMemory {
  levels: number;
  /** Bytes of the top level (whole blocks). */
  base: number;
  /** Bytes of the full chain to 1 × 1, every level rounded up to whole blocks. */
  chain: number;
  /** The ×4/3 rule of thumb on the top level. */
  approx: number;
  /** Per level: [width, height, bytes]. */
  perLevel: Array<[number, number, number]>;
}

/** Texture bytes for w × h, with the full mip chain (each level ⌊/2⌋, at least 1, to 1 × 1 on the longer side). */
export function textureMemory(w: number, h: number, fmt: TexFormat, mips: boolean): TexMemory {
  const perLevel: Array<[number, number, number]> = [];
  let lw = w;
  let lh = h;
  for (;;) {
    const bytes = Math.ceil(lw / fmt.bw) * Math.ceil(lh / fmt.bh) * fmt.blockBytes;
    perLevel.push([lw, lh, bytes]);
    if (!mips || (lw === 1 && lh === 1)) break;
    lw = Math.max(1, Math.floor(lw / 2));
    lh = Math.max(1, Math.floor(lh / 2));
  }
  const base = perLevel[0][2];
  return { levels: perLevel.length, base, chain: perLevel.reduce((s, l) => s + l[2], 0), approx: (base * 4) / 3, perLevel };
}

/** Texel density (texels per metre) of a w × h texture whose UV island covers `uvFraction` of the 0–1 square, on area A m². */
export function texelDensity(w: number, h: number, uvFraction: number, area: number): number {
  return Math.sqrt((w * h * uvFraction) / area);
}

/** The square texture side needed for a target density, and the next power of two. */
export function textureSideFor(density: number, uvFraction: number, area: number): { side: number; pow2: number } {
  const side = density * Math.sqrt(area / uvFraction);
  return { side, pow2: Math.pow(2, Math.ceil(Math.log2(Math.max(1, side)))) };
}

// ---------------------------------------------------------------------------------------------------------------
// Render farm
// ---------------------------------------------------------------------------------------------------------------

export interface FarmInput {
  /** Single-core render time of each frame (s), or one value repeated `frames` times. */
  frameTimes: number[] | null;
  meanTime: number;
  frames: number;
  nodes: number;
  coresPerNode: number;
  /** Amdahl serial fraction of a frame's render, 0 to 1. */
  serial: number;
  /** Fixed per-frame overhead on a node (scene load, start-up), s. */
  overhead: number;
}

export interface FarmResult {
  /** Speed-up of one frame on a node's cores (Amdahl). */
  speedup: number;
  /** Time for one mean frame on one node, including overhead, s. */
  nodeFrameTime: number;
  /** Wall-clock completion, s. */
  wall: number;
  /** Lower bound on the completion (the longest frame, or the work spread perfectly), s. */
  lowerBound: number;
  /** Whether the completion came from LPT scheduling (measured times) or whole-frame rounds (equal times). */
  scheduler: "rounds" | "lpt";
  /** Busy node-seconds (every frame's node time). */
  busyNodeSeconds: number;
  /** Allocated node-seconds (nodes × wall). */
  allocatedNodeSeconds: number;
  /** busy / allocated. */
  utilisation: number;
  /** Fraction of a node's core-time doing useful parallel work: speed-up / cores. */
  coreEfficiency: number;
}

/** Node time of a frame of single-core time t: t·(s + (1 − s)/c) + overhead. */
function nodeTime(t: number, serial: number, cores: number, overhead: number): number {
  const sp = parallelSpeedup(1 - serial, cores);
  return t / (sp ? sp.amdahl : 1) + overhead;
}

/** Longest-processing-time-first onto `nodes` identical nodes: the makespan (a heuristic, at most 4/3 of optimal). */
export function lptMakespan(times: number[], nodes: number): number {
  const sorted = times.slice().sort((a, b) => b - a);
  if (nodes >= sorted.length) return sorted[0] ?? 0;
  // A binary heap of node loads.
  const heap = new Array<number>(nodes).fill(0);
  const down = (i: number): void => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && heap[l] < heap[m]) m = l;
      if (r < heap.length && heap[r] < heap[m]) m = r;
      if (m === i) return;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      i = m;
    }
  };
  for (const t of sorted) {
    heap[0] += t;
    down(0);
  }
  return Math.max(...heap);
}

export function farm(input: FarmInput): FarmResult {
  const { frames, nodes, coresPerNode: c, serial, overhead } = input;
  const sp = parallelSpeedup(1 - serial, c);
  const speedup = sp ? sp.amdahl : 1;
  const nodeTimes = input.frameTimes ? input.frameTimes.map((t) => nodeTime(t, serial, c, overhead)) : null;
  const nodeFrameTime = nodeTime(input.meanTime, serial, c, overhead);
  let wall: number;
  let busy: number;
  let lowerBound: number;
  if (nodeTimes) {
    wall = lptMakespan(nodeTimes, nodes);
    busy = nodeTimes.reduce((s, t) => s + t, 0);
    lowerBound = Math.max(Math.max(...nodeTimes), busy / nodes);
  } else {
    wall = Math.ceil(frames / nodes) * nodeFrameTime;
    busy = frames * nodeFrameTime;
    lowerBound = Math.max(nodeFrameTime, busy / nodes);
  }
  const allocated = nodes * wall;
  return {
    speedup,
    nodeFrameTime,
    wall,
    lowerBound,
    scheduler: nodeTimes ? "lpt" : "rounds",
    busyNodeSeconds: busy,
    allocatedNodeSeconds: allocated,
    utilisation: allocated > 0 ? busy / allocated : 0,
    coreEfficiency: speedup / c,
  };
}

/** The fewest nodes (1 … cap) that finish by the deadline, by a full scan (completion is not assumed monotone). */
export function nodesForDeadline(input: FarmInput, deadline: number, cap: number): number | null {
  for (let n = 1; n <= cap; n++) if (farm({ ...input, nodes: n }).wall <= deadline * (1 + 1e-12)) return n;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Frame storage
// ---------------------------------------------------------------------------------------------------------------

export type Depth = "int8" | "int10dpx" | "int12" | "int16" | "half" | "float";

/**
 * Uncompressed bytes of one frame. 10-bit DPX (packing method A, the usual one) packs three 10-bit components into
 * each 32-bit word and pads every line to a whole word: 4·⌈channels·w/3⌉ bytes per line. 12-bit is stored in 16-bit
 * words (DPX method A). Header bytes are not counted.
 */
export function frameBytes(w: number, h: number, channels: number, depth: Depth): number {
  switch (depth) {
    case "int8":
      return w * h * channels;
    case "int10dpx":
      return 4 * Math.ceil((channels * w) / 3) * h;
    case "int12":
    case "int16":
    case "half":
      return 2 * w * h * channels;
    case "float":
      return 4 * w * h * channels;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pipeline throughput
// ---------------------------------------------------------------------------------------------------------------

export interface Stage {
  name: string;
  /** Hours of work per item at this stage. */
  hoursPerItem: number;
  /** People or machines working this stage in parallel. */
  workers: number;
}

export interface PipelineResult {
  /** Items per hour each stage can complete. */
  capacity: number[];
  bottleneck: number;
  /** System throughput: the smaller of demand and the bottleneck's capacity (items/h). */
  throughput: number;
  /** Utilisation of each stage at that throughput. */
  utilisation: number[];
  /** Total touch time per item (h), the lead time with no waiting. */
  touchTime: number;
}

export function pipeline(stages: Stage[], demand: number | null): PipelineResult {
  const capacity = stages.map((s) => s.workers / s.hoursPerItem);
  let bottleneck = 0;
  capacity.forEach((c, i) => {
    if (c < capacity[bottleneck]) bottleneck = i;
  });
  const throughput = demand === null ? capacity[bottleneck] : Math.min(demand, capacity[bottleneck]);
  return {
    capacity,
    bottleneck,
    throughput,
    utilisation: capacity.map((c) => throughput / c),
    touchTime: stages.reduce((s, x) => s + x.hoursPerItem, 0),
  };
}
