// A typed element (symbol, atomic number or name) resolved to its atomic number (periodic.ts, moved out of
// taskpane.ts unchanged).
import { resolveElement } from "../periodic";

describe("resolveElement", () => {
  it("reads a symbol, an atomic number and a name", () => {
    expect(resolveElement("C")).toBe(6);
    expect(resolveElement("Fe")).toBe(26);
    expect(resolveElement("26")).toBe(26);
    expect(resolveElement(" 118 ")).toBe(118);
    expect(resolveElement("iron")).toBe(26);
    expect(resolveElement("Carbon")).toBe(6);
  });

  it("symbols are case-sensitive: CO is not cobalt", () => {
    expect(resolveElement("Co")).toBe(27);
    expect(resolveElement("CO")).toBeNull();
    expect(resolveElement("fe")).toBeNull();
  });

  it("refuses what is not one of the 118 elements", () => {
    expect(resolveElement("")).toBeNull();
    expect(resolveElement("   ")).toBeNull();
    expect(resolveElement("0")).toBeNull();
    expect(resolveElement("119")).toBeNull();
    expect(resolveElement("6.0")).toBeNull();
    expect(resolveElement("Xx")).toBeNull();
  });
});
