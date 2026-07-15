// Palette data tests.
//
// palettes.ts had NO tests, and it is not a formatting helper — BUILD_TEMPLATES
// encodes real chemistry as data:
//
//   { label: "Benzene", snippet: "atoms: C C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1" }
//
// A wrong bond order or atom index there is still SYNTACTICALLY VALID, so it
// would parse cleanly and silently insert a chemically incorrect structure into
// the user's document. Nothing caught that. The project mandate is that all data
// must be real, so these assert the molecule each label CLAIMS, not merely that
// the string parses.
//
// The precedent is mathOmml.test.ts, which sweeps every FORMULA_LIBRARY entry
// through the emitter; the palettes deserve the same.

import { MATH_PALETTE, CHEM_PALETTE, BUILD_TEMPLATES, BUILD_BONDS, BUILD_MARKUSH, PaletteGroup, PaletteItem } from "../palettes";
import { buildFromAtomBondList, parseAtomBondList } from "../builder";
import { parseMathAst } from "../mathParse";

const flat = (groups: PaletteGroup[]): PaletteItem[] => groups.flatMap((g) => g.items);
const ALL_ITEMS: PaletteItem[] = [...flat(MATH_PALETTE), ...flat(CHEM_PALETTE), ...BUILD_TEMPLATES, ...BUILD_BONDS, ...BUILD_MARKUSH];

describe("palette hygiene (every palette, every item)", () => {
  test("there are palettes to check", () => {
    expect(ALL_ITEMS.length).toBeGreaterThan(50);
  });

  test("every item has a label and a snippet", () => {
    for (const it of ALL_ITEMS) {
      expect(typeof it.label).toBe("string");
      expect(it.label.length).toBeGreaterThan(0);
      expect(typeof it.snippet).toBe("string");
      expect(it.snippet.length).toBeGreaterThan(0);
    }
  });

  test("caret never points outside its snippet", () => {
    // An out-of-range caret misplaces the cursor on every click of that button.
    for (const it of ALL_ITEMS) {
      if (it.caret === undefined) continue;
      expect(Number.isInteger(it.caret)).toBe(true);
      expect(it.caret).toBeGreaterThanOrEqual(0);
      expect(it.caret).toBeLessThanOrEqual(it.snippet.length);
    }
  });

  test("labels are unique within each palette group", () => {
    for (const g of [...MATH_PALETTE, ...CHEM_PALETTE]) {
      const labels = g.items.map((i) => i.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe("MATH_PALETTE snippets", () => {
  // These are TEMPLATES WITH HOLES ("()/()", "sqrt()", "^"): clicking drops the
  // snippet in the box with the caret in the hole for you to type into. So they
  // deliberately do NOT parse standalone, and asserting that they do would be
  // testing a fiction. What must hold is that the template itself is well-formed.
  test("delimiters are balanced (an unbalanced template strands the input)", () => {
    for (const it of flat(MATH_PALETTE)) {
      for (const [open, close] of [
        ["(", ")"],
        ["[", "]"],
        ["{", "}"],
      ]) {
        let depth = 0;
        for (const ch of it.snippet) {
          if (ch === open) depth++;
          else if (ch === close) depth--;
          expect(depth).toBeGreaterThanOrEqual(0); // never closes before it opens
        }
        expect(depth).toBe(0);
      }
    }
  });

  test("the caret lands inside the template, not past its end", () => {
    // Where the caret goes IS the feature — it must sit in the hole the user is
    // meant to fill, which at minimum means within the snippet.
    for (const it of flat(MATH_PALETTE)) {
      if (it.caret === undefined) continue;
      expect(it.caret).toBeLessThanOrEqual(it.snippet.length);
    }
  });

  test("a filled-in template parses — spot-check the common ones", () => {
    // Proves the templates lead somewhere valid once used as intended.
    const filled: [string, string][] = [
      ["sqrt()", "sqrt(x)"],
      ["()/()", "(a)/(b)"],
      ["abs()", "abs(x)"],
      ["root(3, )", "root(3, x)"],
      ["sum(i=1, n, )", "sum(i=1, n, x)"],
    ];
    for (const [template, whole] of filled) {
      // The template really is in the palette (guards against a silent rename).
      expect(flat(MATH_PALETTE).some((i) => i.snippet === template)).toBe(true);
      expect(() => parseMathAst(whole)).not.toThrow();
    }
  });
});

describe("BUILD_TEMPLATES are the molecules they claim to be", () => {
  test("every template parses into atoms and bonds", () => {
    for (const t of BUILD_TEMPLATES) {
      expect(() => parseAtomBondList(t.snippet)).not.toThrow();
      const { atoms } = parseAtomBondList(t.snippet);
      expect(atoms.length).toBeGreaterThan(0);
    }
  });

  test("every template renders to a structure without throwing", () => {
    for (const t of BUILD_TEMPLATES) {
      const r = buildFromAtomBondList(t.snippet);
      expect(r.svg).toContain("<svg");
    }
  });

  test("bond indices are all within range (a typo here is silently valid)", () => {
    for (const t of BUILD_TEMPLATES) {
      const { atoms, bonds } = parseAtomBondList(t.snippet);
      for (const b of bonds) {
        expect(b.a).toBeGreaterThanOrEqual(1);
        expect(b.b).toBeGreaterThanOrEqual(1);
        expect(b.a).toBeLessThanOrEqual(atoms.length);
        expect(b.b).toBeLessThanOrEqual(atoms.length);
        expect(b.a).not.toBe(b.b); // no atom bonded to itself
      }
    }
  });

  // The heart of it: each named template must be the real molecule. These
  // formulas are the ground truth a chemist would check.
  const EXPECTED: [string, string][] = [
    ["Benzene", "C6H6"],
    ["Cyclohexane", "C6H12"],
    ["Cyclopentane", "C5H10"],
    ["Water", "H2O"],
    ["Ethanol", "C2H6O"],
    ["Acetic acid", "C2H4O2"],
    ["Acetone", "C3H6O"],
    ["Methylamine", "CH5N"],
  ];

  test.each(EXPECTED)("%s is really %s", (label, formula) => {
    const t = BUILD_TEMPLATES.find((x) => x.label === label);
    expect(t).toBeDefined();
    const r = buildFromAtomBondList((t as PaletteItem).snippet);
    expect(r.formula).toBe(formula);
  });

  test("Benzene is aromatic (alternating bonds), not cyclohexane", () => {
    // The difference between the two templates is bond orders alone — exactly
    // the kind of edit that would slip through a parse-only check.
    const benzene = BUILD_TEMPLATES.find((x) => x.label === "Benzene") as PaletteItem;
    const { bonds } = parseAtomBondList(benzene.snippet);
    const doubles = bonds.filter((b) => b.order === 2).length;
    expect(bonds).toHaveLength(6);
    expect(doubles).toBe(3); // Kekulé: three double bonds
  });

  test("Cyclohexane is fully saturated", () => {
    const cyc = BUILD_TEMPLATES.find((x) => x.label === "Cyclohexane") as PaletteItem;
    const { bonds } = parseAtomBondList(cyc.snippet);
    expect(bonds).toHaveLength(6);
    expect(bonds.every((b) => b.order === 1)).toBe(true);
  });

  test("Acetic acid has one C=O and one C-O (an ester/acid distinction lives here)", () => {
    const acid = BUILD_TEMPLATES.find((x) => x.label === "Acetic acid") as PaletteItem;
    const { bonds } = parseAtomBondList(acid.snippet);
    expect(bonds.filter((b) => b.order === 2)).toHaveLength(1);
    expect(bonds.filter((b) => b.order === 1)).toHaveLength(2);
  });

  test("every ring template closes its ring", () => {
    // A ring with a missing closing bond renders as a chain — visually obvious to
    // a chemist, but only after it is already in the document.
    for (const label of ["Benzene", "Cyclohexane", "Cyclopentane"]) {
      const t = BUILD_TEMPLATES.find((x) => x.label === label) as PaletteItem;
      const { atoms, bonds } = parseAtomBondList(t.snippet);
      // A closed ring has exactly as many bonds as atoms.
      expect(bonds).toHaveLength(atoms.length);
      // Every atom has exactly two ring neighbours.
      for (let i = 1; i <= atoms.length; i++) {
        const deg = bonds.filter((b) => b.a === i || b.b === i).length;
        expect(deg).toBe(2);
      }
    }
  });
});

describe("BUILD_MARKUSH / BUILD_BONDS tokens work where they are actually used", () => {
  // These are single tokens inserted into a line, not whole structures: an atom
  // token ("[C,N]", "R1") goes on the atoms line; a query block ("{ar}") attaches
  // to the atom before it. Testing them standalone would test a fiction, so put
  // each in the context the pane puts it in.
  test("every markush token parses in its real context", () => {
    for (const t of BUILD_MARKUSH) {
      const line = t.snippet.startsWith("{") ? `atoms: C${t.snippet}` : `atoms: ${t.snippet}`;
      expect(() => parseAtomBondList(line)).not.toThrow();
    }
  });

  test("markush atom tokens really do yield a generic structure", () => {
    // The point of a Markush atom is genericity — if [C,N] silently resolved to
    // plain carbon, the genus claim in a patent figure would be wrong.
    for (const snippet of ["[C,N]", "X", "A", "Q", "R1"]) {
      expect(BUILD_MARKUSH.some((t) => t.snippet === snippet)).toBe(true);
      const r = buildFromAtomBondList(`atoms: C ${snippet}\nbonds: 1-2`);
      expect(r.generic).toBe(true);
    }
  });

  test("every bond token parses between two atoms", () => {
    for (const t of BUILD_BONDS) {
      expect(() => parseAtomBondList(`atoms: C C\nbonds: 1${t.snippet}2`)).not.toThrow();
    }
  });

  test("bond tokens produce the bond order their label claims", () => {
    const orders: [string, number][] = [
      ["-", 1],
      ["=", 2],
      ["#", 3],
    ];
    for (const [snippet, order] of orders) {
      expect(BUILD_BONDS.some((t) => t.snippet === snippet)).toBe(true);
      const { bonds } = parseAtomBondList(`atoms: C C\nbonds: 1${snippet}2`);
      expect(bonds[0].order).toBe(order);
    }
  });
});
