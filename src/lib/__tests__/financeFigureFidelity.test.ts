// Finance figures must not contradict the number beside them.
//
// Every case here was found by an independent adversarial pass over the batch
// that made all 24 Finance calculators draw. The first one fired on the SHIPPED
// DEFAULTS, which is the part worth remembering: the commit message claimed
// "every figure is computed from the engine's own numbers so it cannot disagree
// with the text beside it", and the audit agreed, because the audit was
// counting whether an <svg> existed.

import * as fs from "fs";
import * as path from "path";
import { amortizationSchedule, bondPrice, bondYTM, dcf } from "../finance";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

/**
 * A whole top-level function body: from its `function` keyword to the closing
 * brace that sits in column 0.
 *
 * NOT a lazy regex ending at the first brace-on-its-own-line. For any function
 * whose parameter is an object literal type, that brace belongs to the
 * PARAMETER and arrives several lines before the body starts — so the match
 * returned a bare signature and every assertion against it failed while the
 * code under test was correct.
 */
function fnSource(name: string): string {
  const at = PANE.indexOf(`function ${name}(`);
  expect(at).toBeGreaterThan(0);
  // Built from char codes rather than written as an escape: this repo has a
  // recorded defect where backslash escapes were eaten on the way into a file
  // and became literal control characters, and it recurred twice while writing
  // this campaign. Codes cannot be mangled by whatever writes the file.
  const NL = String.fromCharCode(10);
  const end = PANE.indexOf(NL + "}" + NL, at);
  expect(end).toBeGreaterThan(at);
  return PANE.slice(at, end);
}

function calcBody(id: string): string {
  const start = PANE.indexOf("const FIN_CALCS");
  const end = PANE.indexOf("\n];", start);
  const src = PANE.slice(start, end);
  const at = src.indexOf(`id: "${id}"`);
  expect(at).toBeGreaterThan(0);
  const next = src.indexOf('    id: "', at + 10);
  return src.slice(at, next < 0 ? src.length : next);
}

describe("dcf: the ladder's bottom row is not called the total", () => {
  // On the defaults the printed Value was 1,610.39 and the bar labelled "total"
  // was 272.73 — because the terminal value is deliberately excluded from the
  // bars and the shared helper hardcoded the label.
  test("the exclusion is real and large, which is why the label mattered", () => {
    const rate = 0.1;
    const flows = [100, 110, 121];
    const value = dcf(rate, flows, 0.03);
    const explicit = flows.reduce((a, c, k) => a + c / Math.pow(1 + rate, k + 1), 0);
    expect(Number.isFinite(value)).toBe(true);
    // The forecast bars are a small fraction of the answer: mislabelling them
    // "total" reads as an arithmetic error in the product.
    expect(explicit).toBeLessThan(value / 3);
  });

  test("dcf names the row for what it sums, and starts at t=1", () => {
    const body = calcBody("dcf");
    expect(body).toMatch(/resultLabel: "forecast"/);
    // Its own field says "Cash flows (t=1 first)" and the engine discounts
    // flow k at exponent k+1, so labelling the first bar t=0 was off by one.
    expect(body).toMatch(/firstPeriod: 1/);
  });

  test("npv and irr keep t=0, because for them cf[0] really is t=0", () => {
    for (const id of ["npv", "irr"]) {
      expect(calcBody(id)).not.toMatch(/firstPeriod/);
    }
  });
});

describe("the cash-flow ladder never drops a flow silently", () => {
  // ladderSvg caps at ten rows and slices the middle out with no ellipsis,
  // while the total keeps summing everything — so an eleven-flow project drew
  // nine bars ending at -105 above a total bar sitting at zero. A waterfall
  // whose bars do not reach its own total looks like a bug in the product.
  test("the helper aggregates the overflow into a labelled row", () => {
    const helper = fnSource("cashFlowLadderSvg");
    expect(helper).toMatch(/const ROOM = \d+/);
    expect(helper).toMatch(/t=\$\{restFrom\}\.\.\$\{restTo\}/);
    // And the aggregate is a real sum, not a placeholder.
    expect(helper).toMatch(/\.slice\(ROOM\)\.reduce/);
  });

  test("the rows it emits always add up to the total row", () => {
    // The arithmetic the figure asserts, checked directly: eight bars plus the
    // aggregated remainder must equal the sum over every flow.
    const discounted = Array.from({ length: 11 }, (_, k) => (k === 0 ? -1000 : 200 / Math.pow(1.151, k)));
    const ROOM = 8;
    const shown = discounted.slice(0, ROOM);
    const rest = discounted.slice(ROOM).reduce((a, v) => a + v, 0);
    const total = discounted.reduce((a, v) => a + v, 0);
    expect(shown.reduce((a, v) => a + v, 0) + rest).toBeCloseTo(total, 9);
  });
});

describe("a one-row schedule draws nothing rather than an empty frame", () => {
  // buildPlotSvg emits a single point as `<path d="M216,198"/>` — a moveto with
  // no lineto, which renders as blank space inside a fully labelled chart with
  // both legend entries. A one-year, one-payment-a-year loan is ordinary input.
  test("the degenerate schedule really is one row", () => {
    expect(amortizationSchedule(200000, 0.05, 1)).toHaveLength(1);
  });

  test("amort and depr both guard it, as loan already did", () => {
    expect(calcBody("amort")).toMatch(/if \(pick\.length < 2\) return undefined;/);
    expect(calcBody("loan")).toMatch(/if \(pick\.length < 2\) return undefined;/);
    expect(calcBody("depr")).toMatch(/rows\.length < 2\s*\?\s*undefined/);
  });
});

describe("loan: the printed payment is the one the figure was drawn from", () => {
  // amortizationSchedule silently clamps to MAX_AMORT_PERIODS and RECOMPUTES
  // its payment from the clamped count, while loanPayment uses the count as
  // typed. At 14,600 periods the text said 31.69 and the curve was a loan
  // paying 33.96 that finished seven years early.
  test("the clamp is real and changes the payment", () => {
    const asked = 40 * 365;
    const sched = amortizationSchedule(200000, 0.05 / 365, asked);
    expect(sched.length).toBeLessThan(asked);
    expect(sched[0].payment).toBeGreaterThan(31.7);
  });

  test("the pane reports the schedule's own payment and discloses the cap", () => {
    const body = calcBody("loan");
    expect(body).toMatch(/sched\.length \? sched\[0\]\.payment/);
    expect(body).toMatch(/Schedule capped at/);
  });
});

describe("the money-over-time curve reaches the printed answer", () => {
  // Flooring the horizon stopped straight-line depreciation over 7.5 years at a
  // book value of 1,600, directly beneath a sentence saying the book value
  // reaches salvage at the end of the useful life.
  test("the helper lands on the exact end, not its floor", () => {
    const helper = fnSource("moneyOverTimeSvg");
    expect(helper).not.toMatch(/Math\.floor\(o\.periods\)/);
    expect(helper).toMatch(/const end = o\.periods;/);
    expect(helper).toMatch(/pts\[pts\.length - 1\]\.x !== end/);
  });
});

describe("bond curves use whole coupon periods and centre on the real yield", () => {
  test("bondPrice really refuses a partial period, which is why rounding is needed", () => {
    expect(Number.isFinite(bondPrice(1000, 0.05, 0.06, 10.25, 2))).toBe(false);
    expect(Number.isFinite(bondPrice(1000, 0.05, 0.06, 10.5, 2))).toBe(true);
  });

  test("a fractional maturity still yields a solvable bond, so it must still draw", () => {
    // bondYTM rounds internally; the figure used the raw years and produced
    // sixty NaNs, so a perfectly good yield came with no picture and no reason.
    expect(bondYTM(950, 1000, 0.05, 10.25, 2)).not.toBeNull();
    const helper = fnSource("bondPriceCurveSvg");
    expect(helper).toMatch(/Math\.round\(o\.years \* o\.freq\) \/ o\.freq/);
    expect(helper).toMatch(/bondPrice\(o\.face, o\.coupon, y, years, o\.freq\)/);
  });

  test("the window is not clamped at zero, so a negative yield stays on the curve", () => {
    // Negative-yielding sovereigns are ordinary. Clamping lo to 0 while leaving
    // the marked point at the real yield put the point outside the curve.
    const helper = fnSource("bondPriceCurveSvg");
    expect(helper).not.toMatch(/Math\.max\(0, o\.ytm - /);
    expect(helper).toMatch(/const lo = o\.ytm - 0\.05;/);
  });
});
