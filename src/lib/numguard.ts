// Guards shared by the BVP, PDE and DAE solvers.
//
// Both of these exist because the adversarial pass on v2.19.0 found the same
// two mistakes repeated across all three modules, in code that had 84 passing
// tests of its own.
//
// GRID SIZES. `Math.min(Math.floor(n), MAX)` looks like a bound and is not one:
//   * Math.floor(NaN) is NaN, Math.max(3, NaN) is NaN, and `new Array(NaN)`
//     THROWS "Invalid array length" — an uncaught exception rather than a
//     refusal.
//   * Math.min(Infinity, 400) is 400, so a nonsense input silently buys the
//     LARGEST grid the solver offers. That is backwards: garbage in should be
//     cheap, and it made `nx = Infinity` the most expensive call in the module.
//
// USER CALLBACKS. These solvers take f and g as functions because the pane
// compiles them from whatever the user typed. Such a function can throw — an
// unknown identifier reached only at certain x, a parse failure deep in an
// expression — and an exception from inside a Newton iteration escaped the
// solver entirely instead of being reported as the equation error it is.

/**
 * Reads a grid/step count safely. A non-finite or nonsense value falls back to
 * `def` rather than to the maximum, so bad input is CHEAP rather than maximal.
 */
export function gridSize(v: number | undefined, def: number, lo: number, hi: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  const n = Math.floor(v);
  if (!Number.isFinite(n) || n < lo) return lo;
  return Math.min(n, hi);
}

/** True when `v` is a finite number this solver can use as a parameter. */
export const finite = (v: number): boolean => Number.isFinite(v);

/**
 * Wraps a user-supplied callback so a throw becomes a recorded error instead of
 * an exception escaping the solver. The wrapper returns NaN on failure, which
 * every caller already treats as "not finite, stop"; `.error` carries the
 * message so the caller can say what actually went wrong.
 */
export interface Guarded<F> {
  fn: F;
  error: string | null;
}

export function guard1(f: (a: number) => number): Guarded<(a: number) => number> {
  const g: Guarded<(a: number) => number> = { fn: () => NaN, error: null };
  g.fn = (a: number) => {
    try {
      return f(a);
    } catch (e) {
      if (!g.error) g.error = (e as Error).message;
      return NaN;
    }
  };
  return g;
}

export function guard2(f: (a: number, b: number) => number): Guarded<(a: number, b: number) => number> {
  const g: Guarded<(a: number, b: number) => number> = { fn: () => NaN, error: null };
  g.fn = (a, b) => {
    try {
      return f(a, b);
    } catch (e) {
      if (!g.error) g.error = (e as Error).message;
      return NaN;
    }
  };
  return g;
}

export function guard3(
  f: (a: number, b: number, c: number) => number
): Guarded<(a: number, b: number, c: number) => number> {
  const g: Guarded<(a: number, b: number, c: number) => number> = { fn: () => NaN, error: null };
  g.fn = (a, b, c) => {
    try {
      return f(a, b, c);
    } catch (e) {
      if (!g.error) g.error = (e as Error).message;
      return NaN;
    }
  };
  return g;
}

/** Same, for the vector-valued callbacks a DAE takes. */
export function guardVec(
  f: (t: number, y: number[], z: number[]) => number[]
): Guarded<(t: number, y: number[], z: number[]) => number[]> {
  const g: Guarded<(t: number, y: number[], z: number[]) => number[]> = { fn: () => [NaN], error: null };
  g.fn = (t, y, z) => {
    try {
      return f(t, y, z);
    } catch (e) {
      if (!g.error) g.error = (e as Error).message;
      return [NaN];
    }
  };
  return g;
}

/**
 * How much work an iterative solve may do, in point-updates.
 *
 * A 400x400 grid relaxed to 1e-10 took 91 SECONDS — memory-bounded, entirely
 * unbounded in time, and in a task pane that is a frozen Word for a minute and
 * a half with no way back. The bound has to be on WORK, not on the grid alone.
 */
export const RELAX_WORK_BUDGET = 1e7;
