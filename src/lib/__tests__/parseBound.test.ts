// A definite integral's limit read as an expression (solve.ts, moved out of taskpane.ts unchanged).
import { parseBound } from "../solve";

describe("parseBound", () => {
  it("reads numbers and constant expressions", () => {
    expect(parseBound("0")).toBe(0);
    expect(parseBound("-2.5")).toBe(-2.5);
    expect(parseBound("pi")).toBeCloseTo(Math.PI, 12);
    expect(parseBound("pi/2")).toBeCloseTo(Math.PI / 2, 12);
    expect(parseBound("2*pi")).toBeCloseTo(2 * Math.PI, 12);
  });

  it("is NaN for text that does not parse or names a variable", () => {
    expect(parseBound("")).toBeNaN();
    expect(parseBound("pi/")).toBeNaN();
    expect(parseBound("x")).toBeNaN();
  });

  it("does not refuse a non-finite value itself: the Solve pane checks Number.isFinite after it", () => {
    expect(parseBound("1/0")).toBe(Infinity);
  });
});
