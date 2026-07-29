// Array minimum and maximum by REDUCTION, not by spread.
//
// `Math.min(...xs)` passes every element as a separate function argument. Past
// roughly 125,000 arguments V8 throws `RangeError: Maximum call stack size
// exceeded` — not on a pathological input, but on an ordinary paste. Every
// textarea in this add-in that takes a column of numbers is uncapped, and a
// spreadsheet column of 130,000 rows is a normal thing for someone to paste.
//
// The failure is invisible in testing because it is a CLIFF, not a curve:
// 100,000 values work perfectly and 130,000 throw, so a test written with a
// "large" input of ten thousand certifies the bug. It had already been fixed
// once in stats.ts's describe(); this module exists so the fix is one import
// rather than a discovery each time.
//
// Semantics match Math.min/Math.max exactly, including the identities
// min() = +Infinity and max() = -Infinity for an empty array, the propagation of
// NaN, and the treatment of signed zero. `extra` covers `Math.max(...xs, 0)`.
//
// Signed zero is not pedantry here. `v < m` is false for -0 < 0, so a naive
// reduction returns +0 where Math.min returns -0, and the plot renderer divides
// by an axis span: 1/+0 is +Infinity and 1/-0 is -Infinity. A drop-in
// replacement that is subtly not a drop-in replacement is worse than the bug it
// fixes, so the two zero cases are handled explicitly. The test for this file
// caught the omission on the first run.

export function minOf(xs: ArrayLike<number>, ...extra: number[]): number {
  let m = Infinity;
  const take = (v: number): boolean => v < m || (v === 0 && m === 0 && Object.is(v, -0));
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (Number.isNaN(v)) return NaN;
    if (take(v)) m = v;
  }
  for (const v of extra) {
    if (Number.isNaN(v)) return NaN;
    if (take(v)) m = v;
  }
  return m;
}

export function maxOf(xs: ArrayLike<number>, ...extra: number[]): number {
  let m = -Infinity;
  const take = (v: number): boolean => v > m || (v === 0 && m === 0 && Object.is(m, -0));
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (Number.isNaN(v)) return NaN;
    if (take(v)) m = v;
  }
  for (const v of extra) {
    if (Number.isNaN(v)) return NaN;
    if (take(v)) m = v;
  }
  return m;
}
