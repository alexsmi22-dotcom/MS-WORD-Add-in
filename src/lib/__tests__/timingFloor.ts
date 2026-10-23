// Timing ceilings that scale with the machine. A fixed millisecond ceiling fails on a slower CI runner or under a
// loaded worker (v2.189.0's first push: 510 ms against 500), so a ceiling here is a multiple of a fixed reference
// workload timed in the same process, best of three — a slower machine moves the reference and the ceiling together.

/** Best of three wall-clock runs, in ms. */
export function bestOf3(f: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    f();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

let sink = 0;
/** The reference workload: float arithmetic, Math calls and array writes (~10 ms in plain Node here). */
function reference(): void {
  const a = new Float64Array(4096);
  let s = 0;
  for (let i = 0; i < 400000; i++) {
    const x = (i % 4096) * 0.001;
    a[i & 4095] = Math.sin(x) * Math.sqrt(x + 1) + a[(i * 7) & 4095] * 0.5;
    s += a[i & 4095];
  }
  sink += s;
}

/** This machine's reference time now, in ms (best of three, after a warm-up). */
export function referenceMs(): number {
  reference();
  return Math.max(0.5, bestOf3(reference));
}
