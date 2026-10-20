import { parseReaction } from "../reactions";

describe("parseReaction", () => {
  it("parses stages and conditions", () => {
    const r = parseReaction("CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux");
    expect(r.stages).toEqual([["CCO", "CC(=O)O"], ["CC(=O)OCC"]]);
    expect(r.over).toBe("H2SO4");
    expect(r.under).toBe("reflux");
  });

  it("accepts -> and → arrows and omitted conditions", () => {
    expect(parseReaction("A -> B").stages).toEqual([["A"], ["B"]]);
    expect(parseReaction("A → B").stages).toEqual([["A"], ["B"]]);
    expect(parseReaction("A -> B").over).toBe("");
  });

  it("supports multi-step schemes (no dropped segments)", () => {
    expect(parseReaction("A -> B -> C").stages).toEqual([["A"], ["B"], ["C"]]);
  });

  it("does not split charged SMILES on the + inside brackets", () => {
    const r = parseReaction("C[N+](C)(C)C + [Cl-] >> X");
    expect(r.stages).toEqual([["C[N+](C)(C)C", "[Cl-]"], ["X"]]);
  });

  it("records arrow types (forward / reversible / retro)", () => {
    expect(parseReaction("A >> B").arrows).toEqual(["forward"]);
    expect(parseReaction("A <=> B").arrows).toEqual(["reversible"]);
    expect(parseReaction("A ⇌ B").arrows).toEqual(["reversible"]);
    expect(parseReaction("A <- B").arrows).toEqual(["retro"]);
    expect(parseReaction("A -> B <=> C").stages).toEqual([["A"], ["B"], ["C"]]);
    expect(parseReaction("A -> B <=> C").arrows).toEqual(["forward", "reversible"]);
  });
});

