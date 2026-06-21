import { parseReaction, composeReactionScheme, Rendered } from "../reactions";

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
});

describe("composeReactionScheme", () => {
  const r: Rendered = { svg: '<svg id="r1"></svg>', width: 40, height: 40 };
  const r2: Rendered = { svg: '<svg id="r2"></svg>', width: 40, height: 40 };
  const p: Rendered = { svg: '<svg id="p1"></svg>', width: 40, height: 40 };

  it("embeds components, a plus separator, an arrow, and conditions", () => {
    const svg = composeReactionScheme([[r, r2], [p]], { over: "cat", under: "heat" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('id="r1"');
    expect(svg).toContain('id="r2"');
    expect(svg).toContain('id="p1"');
    expect(svg).toContain(">+<"); // plus between the two reactants
    expect(svg).toContain("<line");
    expect(svg).toContain("<polygon");
    expect(svg).toContain("cat");
    expect(svg).toContain("heat");
  });

  it("draws an arrow between each stage of a multi-step scheme", () => {
    const svg = composeReactionScheme([[r], [r2], [p]]);
    // 3 stages → 2 arrows → 2 arrowhead polygons.
    expect((svg.match(/<polygon/g) || []).length).toBe(2);
  });

  it("escapes condition text", () => {
    const svg = composeReactionScheme([[r], [p]], { over: "<x>" });
    expect(svg).toContain("&lt;x&gt;");
  });
});
