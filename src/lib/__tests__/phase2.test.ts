import { nelderMead } from "../optimize";
import { fft, ifft, spectrum, dominantFrequencies, nextPow2 } from "../fft";
import { integrate } from "../ode";

describe("Nelder–Mead optimization", () => {
  it("minimizes the sphere function to the origin", () => {
    const r = nelderMead((x) => x[0] * x[0] + x[1] * x[1], [3, -4]);
    expect(r.converged).toBe(true);
    expect(r.fx).toBeLessThan(1e-8);
    expect(Math.hypot(r.x[0], r.x[1])).toBeLessThan(1e-4);
  });

  it("finds the Rosenbrock minimum at (1, 1)", () => {
    const rosen = (x: number[]) => (1 - x[0]) ** 2 + 100 * (x[1] - x[0] * x[0]) ** 2;
    const r = nelderMead(rosen, [-1.2, 1], { maxIter: 5000, tol: 1e-10 });
    expect(r.x[0]).toBeCloseTo(1, 2);
    expect(r.x[1]).toBeCloseTo(1, 2);
    expect(r.fx).toBeLessThan(1e-4);
  });

  it("finds the Beale minimum at (3, 0.5)", () => {
    const beale = (x: number[]) => {
      const [a, b] = x;
      return (1.5 - a + a * b) ** 2 + (2.25 - a + a * b * b) ** 2 + (2.625 - a + a * b * b * b) ** 2;
    };
    const r = nelderMead(beale, [1, 1], { maxIter: 5000 });
    expect(r.x[0]).toBeCloseTo(3, 1);
    expect(r.x[1]).toBeCloseTo(0.5, 1);
  });

  it("minimizes a 1-D objective", () => {
    const r = nelderMead((x) => (x[0] - 2) ** 2 + 1, [0]);
    expect(r.x[0]).toBeCloseTo(2, 4);
    expect(r.fx).toBeCloseTo(1, 6);
  });
});

describe("FFT", () => {
  it("next power of two", () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(5)).toBe(8);
    expect(nextPow2(8)).toBe(8);
  });

  it("delta impulse → flat magnitude spectrum", () => {
    const { re, im } = fft([1, 0, 0, 0]);
    for (let k = 0; k < re.length; k++) expect(Math.hypot(re[k], im[k])).toBeCloseTo(1, 9);
  });

  it("IFFT(FFT(x)) reconstructs x", () => {
    const x = [3, 1, 4, 1, 5, 9, 2, 6];
    const F = fft(x);
    const back = ifft(F.re, F.im);
    for (let i = 0; i < x.length; i++) expect(back.re[i]).toBeCloseTo(x[i], 9);
  });

  it("Parseval's theorem: energy is preserved", () => {
    const x = [1, -2, 3, -4, 5, -6, 7, -8];
    const timeEnergy = x.reduce((s, v) => s + v * v, 0);
    const { re, im } = fft(x);
    let freqEnergy = 0;
    for (let k = 0; k < re.length; k++) freqEnergy += re[k] * re[k] + im[k] * im[k];
    expect(freqEnergy / re.length).toBeCloseTo(timeEnergy, 6);
  });

  it("pure sinusoid → single spectral peak at its frequency", () => {
    const fs = 64; // Hz
    const n = 64;
    const f0 = 8; // Hz
    const signal = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f0 * i) / fs));
    const dom = dominantFrequencies(signal, fs, 1);
    expect(dom[0].freq).toBeCloseTo(f0, 6);
    expect(dom[0].magnitude).toBeCloseTo(1, 2); // amplitude ≈ 1
  });

  it("recovers a two-tone amplitude spectrum", () => {
    const fs = 128;
    const n = 128;
    const sig = Array.from({ length: n }, (_, i) => 2 * Math.cos((2 * Math.PI * 10 * i) / fs) + 0.5 * Math.cos((2 * Math.PI * 20 * i) / fs));
    const dom = dominantFrequencies(sig, fs, 2).sort((a, b) => a.freq - b.freq);
    expect(dom[0].freq).toBeCloseTo(10, 6);
    expect(dom[0].magnitude).toBeCloseTo(2, 1);
    expect(dom[1].freq).toBeCloseTo(20, 6);
    expect(dom[1].magnitude).toBeCloseTo(0.5, 1);
  });
});

describe("ODE RK45", () => {
  const lastY = (r: { y: number[][] }) => r.y[r.y.length - 1];

  it("exponential decay y' = -y → e^-t", () => {
    const r = integrate((_t, y) => [-y[0]], [1], 0, 5);
    expect(r.completed).toBe(true);
    expect(lastY(r)[0]).toBeCloseTo(Math.exp(-5), 5);
  });

  it("exponential growth y' = y → e^t", () => {
    const r = integrate((_t, y) => [y[0]], [1], 0, 2);
    expect(lastY(r)[0]).toBeCloseTo(Math.exp(2), 4);
  });

  it("harmonic oscillator (system) → cos/sin at t=π", () => {
    // y1' = y2, y2' = -y1 ; y1(0)=1, y2(0)=0 → y1=cos t, y2=-sin t
    const r = integrate((_t, y) => [y[1], -y[0]], [1, 0], 0, Math.PI);
    const yEnd = lastY(r);
    expect(yEnd[0]).toBeCloseTo(Math.cos(Math.PI), 5); // -1
    expect(yEnd[1]).toBeCloseTo(-Math.sin(Math.PI), 5); // 0
  });

  it("logistic growth matches the closed form", () => {
    // y' = y(1 - y), y0 = 0.1 → y(t) = 1/(1 + 9 e^-t)
    const r = integrate((_t, y) => [y[0] * (1 - y[0])], [0.1], 0, 6);
    const exact = 1 / (1 + 9 * Math.exp(-6));
    expect(lastY(r)[0]).toBeCloseTo(exact, 5);
  });

  it("adaptive stepper keeps error under tolerance across the trajectory", () => {
    const r = integrate((_t, y) => [-y[0]], [1], 0, 5, { rtol: 1e-8, atol: 1e-10 });
    for (let i = 0; i < r.t.length; i++) expect(r.y[i][0]).toBeCloseTo(Math.exp(-r.t[i]), 6);
  });

  it("integrates backward in time", () => {
    const r = integrate((_t, y) => [y[0]], [Math.exp(2)], 2, 0);
    expect(lastY(r)[0]).toBeCloseTo(1, 4);
  });
});
