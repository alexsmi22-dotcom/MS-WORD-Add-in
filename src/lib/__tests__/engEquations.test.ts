// Release E gap #14: every governing equation the Engineering pane shows parses into a real Word equation AND typesets
// as its fallback reads. "Parses" alone is not enough: the math parser silently reads `V_in` as V∈, `Nu` as ν,
// `DeltaT` as one italic word and `2pif` as a word, all of which parse. So the letters, digits and Greek of the parsed
// tree, in order, must equal those of the fallback (NFKC folds ₗ→l, ²→2, µ→μ).
import * as fs from "fs";
import * as path from "path";
import { ENG_EQUATIONS, engEq } from "../engEquations";
import { parseMathAst, type Node } from "../mathParse";
import { mathToOmml } from "../mathOmml";

function leaves(n: Node, out: string[] = []): string[] {
  switch (n.k) {
    case "text": out.push(n.v); break;
    case "row": n.items.forEach((x) => leaves(x, out)); break;
    case "frac": leaves(n.num, out); leaves(n.den, out); break;
    case "sup": leaves(n.base, out); leaves(n.sup, out); break;
    case "sub": leaves(n.base, out); leaves(n.sub, out); break;
    case "subsup": leaves(n.base, out); leaves(n.sub, out); leaves(n.sup, out); break;
    case "rad": if (n.degree) leaves(n.degree, out); leaves(n.radicand, out); break;
    case "delim": leaves(n.inner, out); break;
    case "nary": out.push(n.chr); leaves(n.sub, out); leaves(n.sup, out); leaves(n.body, out); break;
    case "func": out.push(n.name); leaves(n.arg, out); break;
    case "lim": out.push("lim"); leaves(n.sub, out); leaves(n.body, out); break;
    case "acc": leaves(n.base, out); break;
    case "matrix": n.rows.forEach((r) => r.forEach((c) => leaves(c, out))); break;
    case "cases": n.rows.forEach((r) => r.forEach((c) => leaves(c, out))); break;
    case "stack": n.rows.forEach((c) => leaves(c, out)); break;
  }
  return out;
}

// ᐟ is the superscript slash the fallbacks use in exponents (Rₕ²ᐟ³); it is punctuation here, not a letter.
const letters = (s: string): string => s.normalize("NFKC").replace(/ᐟ/g, "").replace(/[^\p{L}\p{N}]/gu, "");

/** Functions named on purpose: L(s), G(s), C(s), T(s), H(s), R(t), and C(n, i) for the binomial coefficient. */
const TRANSFER_FUNCTIONS = new Set(["L", "G", "C", "T", "H", "R"]);

const ALL = Object.entries(ENG_EQUATIONS).flatMap(([k, list]) => list.map((e, i) => [`${k} #${i + 1}`, e] as const));

describe("every governing equation", () => {
  test("the table is not empty", () => {
    expect(ALL.length).toBeGreaterThan(0);
  });
  test.each(ALL)("%s parses and typesets as its fallback reads", (_k, e) => {
    expect(() => mathToOmml(e.math)).not.toThrow();
    expect(letters(leaves(parseMathAst(e.math)).join(""))).toBe(letters(e.fallback));
  });
  test.each(ALL)("%s has no accidental function application (a symbol before a bracket)", (_k, e) => {
    const unknown: string[] = [];
    const walk = (n: Node): void => {
      if (n.k === "func" && !n.known && !TRANSFER_FUNCTIONS.has(n.name)) unknown.push(n.name);
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.flat().forEach((c) => c && typeof c === "object" && "k" in c && walk(c as Node));
        else if (v && typeof v === "object" && "k" in v) walk(v as Node);
      }
    };
    walk(parseMathAst(e.math));
    expect(unknown).toEqual([]);
    // A subscript followed by a bracket swallows it: `C_min (T − T)` is C sub "min(T − T)".
    const inScripts: string[] = [];
    const scan = (n: Node, inScript: boolean): void => {
      if (n.k === "func" && inScript) inScripts.push(n.name);
      if (n.k === "sub") { scan(n.base, inScript); scan(n.sub, true); return; }
      if (n.k === "sup") { scan(n.base, inScript); scan(n.sup, true); return; }
      if (n.k === "subsup") { scan(n.base, inScript); scan(n.sub, true); scan(n.sup, true); return; }
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.flat().forEach((c) => c && typeof c === "object" && "k" in c && scan(c as Node, inScript));
        else if (v && typeof v === "object" && "k" in v) scan(v as Node, inScript);
      }
    };
    scan(parseMathAst(e.math), false);
    expect(inScripts).toEqual([]);
  });
  test.each(ALL)("%s fallback keeps the display contract", (_k, e) => {
    expect(e.fallback).not.toMatch(/[\^_*]|\d[eE][+-]?\d|NaN|Infinity|undefined|—/);
    // A minus in the fallback is the true minus.
    expect(e.fallback).not.toMatch(/(^|[\s(=])-(?=[\w(√])/);
    // No symbol glyphs the parser invents from words (∈ ∞ → ° etc.) in the TYPESET tree either.
    expect(leaves(parseMathAst(e.math)).join("")).not.toMatch(/[∈∉→∧∨¬ℝℤℕℚℂ∪∩]/);
    // A script takes ONE token: `S_e0` is S sub e, times 0. Mixed scripts need braces: S_{e0}.
    expect(e.math).not.toMatch(/[_^][A-Za-z]+[0-9]|[_^][0-9]+[A-Za-z]/);
    // A Greek name directly before "(" parses as a FUNCTION called "pi" and typesets the Latin word.
    expect(e.math).not.toMatch(/\b(alpha|beta|gamma|delta|Delta|epsilon|eta|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|omega|Omega)\(/);
  });
});

describe("every engEq key the pane uses exists", () => {
  const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
  const keys = [...pane.matchAll(/\bengEq\("([^"]+)"\)/g)].map((m) => m[1]);
  test("the pane calls engEq only with literal keys", () => {
    expect(pane).not.toMatch(/\bengEq\((?!")/);
  });
  test.each([...new Set(keys)].map((k) => [k]))("%s", (k) => {
    expect(ENG_EQUATIONS[k]?.length ?? 0).toBeGreaterThan(0);
    expect(engEq(k).length).toBe(ENG_EQUATIONS[k].length);
  });
  test("every table entry is used by the pane", () => {
    expect(Object.keys(ENG_EQUATIONS).filter((k) => !keys.includes(k))).toEqual([]);
  });
});
