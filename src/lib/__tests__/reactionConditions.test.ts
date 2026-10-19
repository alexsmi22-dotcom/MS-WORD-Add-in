// Reaction conditions typeset as chemists write them (reactions.ts typesetConditions).
import { typesetConditions } from "../reactions";

describe("typesetConditions", () => {
  it.each([
    ["H2SO4", "H₂SO₄"],
    ["CH2Cl2", "CH₂Cl₂"],
    ["Et3N, DMAP", "Et₃N, DMAP"],
    ["Pd(PPh3)4, K2CO3", "Pd(PPh₃)₄, K₂CO₃"],
    ["Boc2O, NaBH4", "Boc₂O, NaBH₄"],
    ["LiAlH4, THF", "LiAlH₄, THF"],
  ])("%s → %s", (raw, out) => {
    expect(typesetConditions(raw)).toBe(out);
  });

  it.each([
    "reflux",
    "0 °C → rt, 2 h",
    "1,4-dioxane, 80 °C",
    "10 mol% Pd/C, H2 (1 atm)".replace("H2", "XYZ"),
    "DMF",
    "n-BuLi, −78 °C",
    "Step 2",
  ])("left as typed: %s", (raw) => {
    expect(typesetConditions(raw)).toBe(raw);
  });

  it("a capitalised word that is not a formula is not touched (Route2B)", () => {
    expect(typesetConditions("Route2B")).toBe("Route2B");
  });

  it("hydrogen and mixed conditions", () => {
    expect(typesetConditions("H2 (1 atm), Pd/C")).toBe("H₂ (1 atm), Pd/C");
  });
});
