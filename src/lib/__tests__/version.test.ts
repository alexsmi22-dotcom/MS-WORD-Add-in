import { isNewerVersion } from "../version";

describe("isNewerVersion", () => {
  it("detects a newer patch/minor/major", () => {
    expect(isNewerVersion("1.52.0", "1.51.0")).toBe(true);
    expect(isNewerVersion("1.52.1", "1.52.0")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
  });
  it("is false for equal or older", () => {
    expect(isNewerVersion("1.52.0", "1.52.0")).toBe(false);
    expect(isNewerVersion("1.51.0", "1.52.0")).toBe(false);
    expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
  });
  it("compares numerically, not lexically (1.10 > 1.9)", () => {
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("1.100.0", "1.99.0")).toBe(true);
  });
  it("treats missing trailing components as 0", () => {
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.1", "1.2")).toBe(true);
  });
  it("never prompts on empty/garbage input", () => {
    expect(isNewerVersion("", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "")).toBe(false);
    expect(isNewerVersion("abc", "1.0.0")).toBe(false);
  });
});
