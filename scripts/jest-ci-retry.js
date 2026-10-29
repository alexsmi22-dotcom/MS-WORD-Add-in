/* eslint-disable no-undef */
// On GitHub's shared runner (CI=true) a calculation runs about three times slower than on a desktop, and a wall-clock
// bound missed by a few percent has held back four deploys (v2.199.0 three times; v2.206.0 by 1,645 ms against 1,500
// and 314 against 300; the v2.207.0 landing update by 373 against 300). There are some 270 such bounds, written in a
// dozen shapes (ms(), time(), Date.now() - t0, performance.now()), so rather than wrap each in timeBudget's budget(),
// CI retries a failed test twice: a load-induced miss passes on a retry, a real failure fails all three times. The
// local QC run (no CI) gets no retries, so it keeps every strict bound.
if (process.env.CI) jest.retryTimes(2, { logErrorsBeforeRetry: true });
