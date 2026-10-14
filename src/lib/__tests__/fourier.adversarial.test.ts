/** The independent adversarial pass over fourier.ts, pinned. */
import { parseExpr, evalAst, format } from "../solve";
import { parseFourierRequest, fourierSeries, tryFourierSeries } from "../fourier";

const series = (q: string) => {
  const req = parseFourierRequest(q);
  if (req === null || "error" in req) throw new Error("request: " + (req === null ? "null" : req.error));
  const r = fourierSeries(req);
  if ("refusal" in r) throw new Error("refused: " + r.refusal);
  return r;
};
const num = (e: ReturnType<typeof parseExpr>) => evalAst(e, {});

describe("4. (0, 2π) and friends are periods", () => {
  it("t on (0, 2pi): a_0/2 = π, b_n = −2/n", () => {
    const r = series("fourier series t on (0, 2pi)");
    expect(num(r.a0) / 2).toBeCloseTo(Math.PI, 12);
    for (let n = 1; n <= 4; n++) expect(evalAst(r.bn!, { n })).toBeCloseTo(-2 / n, 12);
    expect(format(r.a0)).toMatch(/pi/);
  });
  it("t^2 on (0, 2*pi) and exp(t) on (0, 2pi) compute and verify", () => {
    expect(series("fourier series t^2 on (0, 2*pi)").verified).toBe(true);
    expect(series("fourier series exp(t) on (0, 2pi)").verified).toBe(true);
  });
  it("1 on (0, pi) is its own constant", () => {
    const r = series("fourier series 1 on (0, pi)");
    expect(num(r.a0) / 2).toBe(1);
  });
  it("sin(t) on (0, pi) — a half period — is refused by name, not misread", () => {
    expect(tryFourierSeries("fourier series sin(t) on (0, pi)")!.caveats[0]).toMatch(/multiple of the fundamental|whole period/);
  });
});

describe("9. exact display: exp pieces keep e, π coefficients are read", () => {
  it("exp(t) on (-1, 1): a_0/2 = (e − 1/e)/2 symbolically, no 1.1752", () => {
    const r = series("fourier series exp(t) on (-1, 1)");
    expect(format(r.a0)).toMatch(/exp\(/);
    expect(format(r.a0)).not.toMatch(/1\.17|2\.35/);
    expect(num(r.a0) / 2).toBeCloseTo(Math.sinh(1), 12);
  });
  it("pi*t on (-pi, pi): b_n = 2π(−1)^{n+1}/n", () => {
    const r = series("fourier series pi*t on (-pi, pi)");
    for (let n = 1; n <= 3; n++) expect(evalAst(r.bn!, { n })).toBeCloseTo((2 * Math.PI * (n % 2 ? 1 : -1)) / n, 10);
    expect(format(r.bn!)).toMatch(/pi/);
  });
  it("t/pi and a constant pi piece are read", () => {
    expect(series("fourier series t/pi on (-pi, pi)").verified).toBe(true);
    const r = series("fourier series t on (-pi, 0); pi on (0, pi)");
    expect(r.verified).toBe(true);
    // a0/2 = (1/2π)(∫_{-π}^0 t dt + ∫_0^π π dt) = (−π²/2 + π²)/(2π) = π/4
    expect(num(r.a0) / 2).toBeCloseTo(Math.PI / 4, 10);
  });
  it("the partial sum string is tidy: no 1*t, no (0)/2", () => {
    const v = tryFourierSeries("fourier series t on (-pi, pi)")!;
    const S5 = v.lines.find((l) => /^S_5/.test(l.text))!.text;
    expect(S5).not.toMatch(/\b1\*t\b|\(0\)\/2/);
    expect(() => parseExpr(S5.replace(/^S_5\(t\) = /, ""))).not.toThrow();
  });
});
