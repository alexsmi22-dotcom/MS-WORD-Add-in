import { parseMath } from "../mathFormat";

/** Joins the normal-text runs so we can assert the symbol normalization. */
const text = (input: string): string =>
  parseMath(input)
    .map((s) => s.text)
    .join("");

describe("parseMath symbol normalization", () => {
  test("Greek letters by name", () => {
    expect(text("alpha + beta = gamma")).toBe("α + β = γ");
    expect(text("Delta E")).toBe("Δ E");
    expect(text("lambda, mu, omega")).toBe("λ, μ, ω");
  });

  test("leaves variables that merely contain a Greek name alone", () => {
    expect(text("beta1 + xmu")).toBe("beta1 + xmu");
  });

  test("named operators", () => {
    expect(text("sum + int + prod")).toBe("∑ + ∫ + ∏");
    expect(text("partial x + nabla y")).toBe("∂ x + ∇ y");
    expect(text("2 times 3")).toBe("2 × 3");
  });

  test("arrows and relations (longer combos win)", () => {
    expect(text("a <=> b")).toBe("a ⇔ b");
    expect(text("x <-> y")).toBe("x ↔ y");
    expect(text("p => q")).toBe("p ⇒ q");
    expect(text("a <= b")).toBe("a ≤ b");
    expect(text("a approx b")).toBe("a ≈ b");
    expect(text("x -+ y")).toBe("x ∓ y");
  });

  test("back-compatible symbols still work", () => {
    expect(text("pi")).toBe("π");
    expect(text("a*b")).toBe("a·b");
    expect(text("x != y")).toBe("x ≠ y");
    expect(text("5 +- 1")).toBe("5 ± 1");
  });

  test("still parses sub/superscripts", () => {
    const segs = parseMath("x^2 + a_n");
    expect(segs.find((s) => s.type === "sup" && s.text === "2")).toBeTruthy();
    expect(segs.find((s) => s.type === "sub" && s.text === "n")).toBeTruthy();
  });
});
