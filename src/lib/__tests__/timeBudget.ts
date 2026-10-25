/**
 * A wall-clock bound for a timing test. On GitHub's shared runner (CI=true) a calculation runs about three times
 * slower than on a desktop, and three releases' deploys were held back by bounds missed by 1 to 10 percent there
 * (v2.199.0: 1,034 ms against 1,000; 3,525 against 3,500; 6,093 against 6,000). The bound exists to catch a freeze,
 * which takes minutes, so CI gets three times the time; the local QC run keeps the strict bound.
 */
export function budget(ms: number): number {
  return process.env.CI ? ms * 3 : ms;
}
