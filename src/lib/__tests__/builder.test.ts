import { build, buildFromAtomBondList } from "../builder";

describe("builder — concrete molecules", () => {
  it("builds CO2 with double bonds", () => {
    const r = build("atoms: C O O\nbonds: 1=2 1=3", "auto");
    expect(r.formula).toBe("CO2");
    expect(r.generic).toBe(false);
    expect(r.idcode).toBeTruthy();
  });

  it("builds ethanol and fills implicit hydrogens", () => {
    const r = build("atoms: C C O\nbonds: 1-2 2-3", "auto");
    expect(r.formula).toBe("C2H6O");
    expect(r.mw).toBeCloseTo(46.07, 1);
  });

  it("applies a charge", () => {
    const r = build("atoms: N+", "auto");
    expect(r.formula).toBe("H4N");
  });

  it("parses a molfile (round-trip via build)", () => {
    const r = build("atoms: C C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto");
    expect(r.formula).toBe("C6H6");
  });
});

describe("builder — generic / Markush", () => {
  it("marks an atom list as generic", () => {
    const r = build("atoms: [C,N] C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto");
    expect(r.generic).toBe(true);
    expect(r.formula).toBe("generic structure");
  });

  it("treats an undefined (~) bond as generic", () => {
    const r = build("atoms: C C\nbonds: 1~2", "auto");
    expect(r.generic).toBe(true);
  });

  it("expands the halogen shorthand X to a generic atom list", () => {
    const r = build("atoms: C X\nbonds: 1-2", "auto");
    expect(r.generic).toBe(true);
  });
});

describe("builder — query features (Markush genus constraints)", () => {
  it("treats an atom query feature as generic and still builds", () => {
    const r = build("atoms: C{ar,nosub} C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto");
    expect(r.generic).toBe(true);
    expect(r.idcode).toBeTruthy();
  });

  it("accepts ring-size constraints (e.g. r5 / r6)", () => {
    expect(() => build("atoms: C{r6} C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto")).not.toThrow();
    expect(build("atoms: C{r5} C C C C\nbonds: 1-2 2-3 3-4 4-5 5-1", "auto").generic).toBe(true);
  });

  it("accepts query features on a query atom list and on R-groups", () => {
    expect(() => build("atoms: [C,N]{ar} C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto")).not.toThrow();
    expect(() => build("atoms: R1{sub} C\nbonds: 1-2", "auto")).not.toThrow();
  });

  it("accepts a bond query feature (ring / chain / ar)", () => {
    const r = build("atoms: C C\nbonds: 1-2{ring}", "auto");
    expect(r.generic).toBe(true);
  });

  it("rejects an unknown query feature with a clear error", () => {
    expect(() => build("atoms: C{bogus} C\nbonds: 1-2", "auto")).toThrow(/query feature/i);
  });

  it("rejects a second/stray query block instead of silently dropping it", () => {
    expect(() => build("atoms: C{ar}{bogus} C\nbonds: 1-2", "auto")).toThrow();
  });

  it("accepts multiple features in one block", () => {
    expect(() => build("atoms: C{ar,nosub,r6} C\nbonds: 1-2", "auto")).not.toThrow();
  });

  it("does not treat a charge-only atom as a query feature", () => {
    expect(build("atoms: N+", "auto").generic).toBe(false);
  });
});

describe("builder — stereo & extended Markush", () => {
  it("accepts a wedge bond without becoming generic", () => {
    const r = build("atoms: C F Cl Br\nbonds: 1-2 1>3 1-4", "auto");
    expect(r.generic).toBe(false);
    expect(r.formula).toBe("CHBrClF");
  });

  it("accepts a hash bond", () => {
    expect(() => build("atoms: C F Cl Br\nbonds: 1-2 1<3 1-4", "auto")).not.toThrow();
  });

  it("treats R1 as an R-group (generic) and reports it", () => {
    const r = build("atoms: R1 C C O\nbonds: 1-2 2-3 3-4", "auto");
    expect(r.generic).toBe(true);
    expect(r.rgroups).toEqual(["R1"]);
  });

  it("reports multiple distinct R-groups sorted", () => {
    const r = build("atoms: R2 C R1 O\nbonds: 1-2 2-3 3-4", "auto");
    expect(r.rgroups).toEqual(["R1", "R2"]);
  });

  it("reports no R-groups for a concrete molecule", () => {
    expect(build("atoms: C C O\nbonds: 1-2 2-3", "auto").rgroups).toEqual([]);
  });

  it("treats A (any atom) and Q (heteroatom) as generic", () => {
    expect(build("atoms: A C\nbonds: 1-2", "auto").generic).toBe(true);
    expect(build("atoms: Q C\nbonds: 1-2", "auto").generic).toBe(true);
  });

  it("does not mistake R-prefixed elements (Ru, Rb) for an R-group", () => {
    expect(build("atoms: Ru", "auto").generic).toBe(false);
    expect(build("atoms: Rb", "auto").generic).toBe(false);
  });
});

describe("builder — errors", () => {
  it("rejects an unknown element", () => {
    expect(() => buildFromAtomBondList("atoms: C Zz\nbonds: 1-2")).toThrow(/Unknown element/);
  });
  it("rejects an out-of-range bond", () => {
    expect(() => buildFromAtomBondList("atoms: C O\nbonds: 1=9")).toThrow(/outside/);
  });
  it("rejects a malformed bond", () => {
    expect(() => buildFromAtomBondList("atoms: C O\nbonds: 1*2")).toThrow(/Could not parse bond/);
  });
});
