// KNOWN-BAD PAYLOADS FOR scripts/fuzz-exports.js.
//
// A checker that reports "all clear" for something it cannot see is worse than
// no checker, and this repo has been burnt by exactly that more than once — most
// expensively by a generic fuzzer that reported "0 hangs" for code it never
// entered. So the fuzzer refuses to report anything until it has found every
// defect in this file, and reported NOTHING for the two functions here that are
// behaving correctly.
//
// This file lives in scripts/ deliberately: everything in src/lib is swept for
// real, and a deliberate infinite loop shipped in the library would be a defect
// rather than a fixture.
//
// It is not type-checked by `npm run lint` (tsconfig covers src/**), and it is
// not a jest test. It is only ever loaded by the fuzzer.

/** HANG. A non-finite count is not a bound: this never returns. */
export function neverReturns(n: number): number {
  let total = 0;
  for (let k = 1; k <= n; k++) total += k;
  return total;
}

/** HEAP. Allocates without bound — dies against the child's --max-old-space-size. */
export function eatsTheHeap(n: number): number {
  const keep: unknown[] = [];
  // Big blocks, so this reaches the cap in well under the stall window and is
  // therefore distinguishable from a hang rather than racing it.
  for (;;) keep.push(new Array(5_000_000).fill(n));
}

/** SLOW. Returns, but far too late for a task pane. */
export function slowButReturns(n: number): number {
  const until = Date.now() + 1600;
  let spin = 0;
  while (Date.now() < until) spin += 1;
  return spin + (typeof n === "number" ? 0 : 0);
}

/** HUGE. Returns promptly, with an output no pane can render. */
export function hugeString(n: number): string {
  return "x".repeat(3_000_000) + String(n).slice(0, 0);
}

/**
 * NOT A DEFECT. Refusing hostile input is the CORRECT behaviour, and the single
 * most important self-test case: without it the fuzzer reports tens of thousands
 * of "defects" and is unusable.
 */
export function alwaysThrows(n: number): number {
  throw new Error(`refused: ${String(n)}`);
}

/** NOT A DEFECT. Returns quickly and small, whatever it is handed. */
export function returnsFine(n: number): string {
  return typeof n;
}
