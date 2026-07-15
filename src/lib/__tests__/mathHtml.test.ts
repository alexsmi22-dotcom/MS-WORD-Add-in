// Preview fidelity: mathHtml.ts vs mathOmml.ts.
//
// mathHtml.ts had NO tests, despite its own header stating the contract:
// "This mirrors the OMML emitter (mathOmml.ts) so the preview reflects what gets
// inserted." mathOmml.ts has a full suite plus a FORMULA_LIBRARY sweep; the
// preview emitter had none. That asymmetry is the dangerous one — if the two
// drift, the preview LIES about what will land in the document, and the user
// only finds out after inserting.
//
// Both emitters walk the same AST (both import parseMathAst), so they can only
// diverge in the emitters. The fidelity proof used here is: each emitter must
// faithfully render every leaf of the AST, in order. If both are faithful to the
// AST, they are faithful to each other.
//
// One divergence is REAL and intentional: for an n-ary (Σ, ∫), the HTML stacks
// the upper limit above the lower, so it emits sup before sub; the OMML emits
// sub before sup because that is the XML order Word expects. Same rendering,
// different source order. The walker below is parameterised on that rather than
// pretending it does not exist.

import { mathToHtml } from "../mathHtml";
import { mathToOmml } from "../mathOmml";
import { parseMathAst, Node } from "../mathParse";
import { FORMULA_LIBRARY } from "../formulaLibrary";

/**
 * Every piece of literal text the AST should render, in the order the given
 * emitter walks it. This is the content the user must see either way.
 */
function astLeaves(node: Node, order: "omml" | "html"): string[] {
  const go = (n: Node): string[] => astLeaves(n, order);
  switch (node.k) {
    case "text":
      return [node.v];
    case "row":
      return node.items.flatMap(go);
    case "frac":
      return [...go(node.num), ...go(node.den)];
    case "sup":
      return [...go(node.base), ...go(node.sup)];
    case "sub":
      return [...go(node.base), ...go(node.sub)];
    case "subsup":
      return [...go(node.base), ...go(node.sub), ...go(node.sup)];
    case "rad":
      return [...(node.degree ? go(node.degree) : []), ...go(node.radicand)];
    case "delim":
      return go(node.inner);
    case "nary":
      // The one intentional difference — see the header.
      return order === "omml"
        ? [...go(node.sub), ...go(node.sup), ...go(node.body)]
        : [...go(node.sup), ...go(node.sub), ...go(node.body)];
    case "func":
      return [node.name, ...go(node.arg)];
    case "lim":
      return ["lim", ...go(node.sub), ...go(node.body)];
    case "acc":
      return go(node.base);
    case "matrix":
      return node.rows.flatMap((r) => r.flatMap(go));
    case "cases":
      return node.rows.flatMap((r) => [...go(r[0]), ...(r[1] ? go(r[1]) : [])]);
    case "stack":
      return node.rows.flatMap(go);
  }
}

/** The text inside every <m:t> run of an OMML body, in document order. */
function ommlTexts(omml: string): string[] {
  const out: string[] = [];
  const re = /<m:t[^>]*>([\s\S]*?)<\/m:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(omml)) !== null) out.push(decode(m[1]));
  return out;
}

/** Visible text of an HTML fragment: tags stripped, entities decoded. */
function htmlText(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ""));
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&minus;/g, "−")
    .replace(/&amp;/g, "&");
}

/** True if `parts` appear inside `text` in order (extra characters allowed). */
function isOrderedSubsequence(text: string, parts: string[]): boolean {
  let i = 0;
  for (const p of parts) {
    if (!p.length) continue;
    const at = text.indexOf(p, i);
    if (at < 0) return false;
    i = at + p.length;
  }
  return true;
}

/** Expressions covering every node kind the AST can produce. */
const CORPUS: [string, string][] = [
  ["plain text", "x + y"],
  ["fraction", "(a+b)/(c+d)"],
  ["superscript", "x^2"],
  ["subscript", "a_n"],
  ["sub and sup", "x_i^2"],
  ["square root", "sqrt(x+1)"],
  ["n-th root", "root(3, x)"],
  ["delimiters", "(a+b)"],
  ["n-ary sum", "sum(i=1, n, i^2)"],
  ["n-ary integral", "int(a, b, f)"],
  ["function", "sin(x)"],
  ["limit", "lim(x->0, sin(x)/x)"],
  ["accent", "bar(x)"],
  ["matrix", "matrix(a,b; c,d)"],
  ["pmatrix", "pmatrix(1,2; 3,4)"],
  ["cases", "cases(x, x>0; -x, x<=0)"],
  ["stack", "align(a = b; c = d)"],
  ["quadratic", "(-b +- sqrt(b^2-4 a c))/(2 a)"],
  ["nested", "sqrt((x^2+y^2)/(a_1+b_2))"],
];

describe("the preview renders every leaf the AST has", () => {
  test.each(CORPUS)("%s", (_name, expr) => {
    const leaves = astLeaves(parseMathAst(expr), "html");
    const text = htmlText(mathToHtml(expr));
    expect(isOrderedSubsequence(text, leaves)).toBe(true);
  });
});

describe("the inserted OMML renders every leaf the AST has", () => {
  test.each(CORPUS)("%s", (_name, expr) => {
    const leaves = astLeaves(parseMathAst(expr), "omml");
    expect(ommlTexts(mathToOmml(expr))).toEqual(leaves);
  });
});

describe("preview and insert agree — the contract in mathHtml.ts's header", () => {
  test.each(CORPUS)("%s: both show the same content", (_name, expr) => {
    // Same multiset of literal content either way. This is the assertion that
    // would fail if one emitter silently dropped a node's contents.
    const fromOmml = [...ommlTexts(mathToOmml(expr))].sort();
    const fromAst = [...astLeaves(parseMathAst(expr), "omml")].sort();
    expect(fromOmml).toEqual(fromAst);

    const text = htmlText(mathToHtml(expr));
    for (const leaf of fromAst) {
      if (!leaf.trim()) continue;
      expect(text).toContain(leaf);
    }
  });

  test("every FORMULA_LIBRARY entry previews AND inserts, with matching content", () => {
    // mathOmml.test.ts already sweeps the library through the OMML emitter. The
    // preview emitter never had that sweep — so a library formula could render
    // wrong in the pane and nothing would notice.
    let checked = 0;
    for (const cat of FORMULA_LIBRARY) {
      for (const f of cat.formulas) {
        const ast = parseMathAst(f.expr);
        const leaves = astLeaves(ast, "omml").filter((l) => l.trim());
        const omml = ommlTexts(mathToOmml(f.expr)).filter((l) => l.trim());
        expect(omml.sort()).toEqual([...leaves].sort());

        const text = htmlText(mathToHtml(f.expr));
        for (const leaf of leaves) {
          if (!text.includes(leaf)) {
            throw new Error(`"${cat.name} / ${f.label}" previews without "${leaf}" — preview would not match the insert.`);
          }
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("preview robustness — it must never blank or throw", () => {
  test("empty input renders empty", () => {
    expect(mathToHtml("")).toBe("");
    expect(mathToHtml("   ")).toBe("");
  });

  test("partial input falls back instead of throwing (you type left to right)", () => {
    // Mid-typing states must still preview. The OMML emitter throws on these —
    // that asymmetry is intentional: insertEquation catches it and falls back to
    // formatted text, telling the user it did so.
    for (const partial of ["sqrt(", "(a+b)/", "x^", "sum(i=1,", "matrix(a,b;", "\\frac{"]) {
      expect(() => mathToHtml(partial)).not.toThrow();
      expect(typeof mathToHtml(partial)).toBe("string");
    }
  });

  test("garbage never throws", () => {
    for (const junk of ["))((", "!!!", "^^^", "///", "💥", "-".repeat(200)]) {
      expect(() => mathToHtml(junk)).not.toThrow();
    }
  });

  test("HTML-special characters in input are escaped, not injected", () => {
    // The preview is written with innerHTML, so an unescaped < would break the
    // pane's markup.
    const html = mathToHtml("a < b > c & d");
    expect(html).not.toMatch(/<(?!\/?(span|sub|sup)\b)[a-z]/i);
    expect(htmlText(html)).toContain("<");
    expect(htmlText(html)).toContain("&");
  });

  test("a script-like input cannot inject a tag", () => {
    const html = mathToHtml("<script>alert(1)</script>");
    expect(html.toLowerCase()).not.toContain("<script");
  });
});

describe("structure is actually rendered, not flattened to text", () => {
  test("a fraction produces fraction markup, not a slash", () => {
    const html = mathToHtml("(a)/(b)");
    expect(html).toContain("m-frac");
    expect(html).toContain("m-frac-n");
    expect(html).toContain("m-frac-d");
  });

  test("a root produces a radical sign", () => {
    expect(mathToHtml("sqrt(x)")).toContain("m-sqrt");
  });

  test("an n-ary produces its operator and both limits", () => {
    const html = mathToHtml("sum(i=1, n, i)");
    expect(html).toContain("m-nary");
    expect(html).toContain("∑");
    expect(html).toContain("m-over");
    expect(html).toContain("m-under");
  });

  test("superscripts and subscripts use real sup/sub elements", () => {
    expect(mathToHtml("x^2")).toContain("<sup>");
    expect(mathToHtml("a_n")).toContain("<sub>");
    const both = mathToHtml("x_i^2");
    expect(both).toContain("<sub>");
    expect(both).toContain("<sup>");
  });

  test("a matrix produces a grid with the right column count", () => {
    const html = mathToHtml("matrix(a,b,c; d,e,f)");
    expect(html).toContain("m-matrix");
    expect(html).toContain("repeat(3,auto)");
  });

  test("cases produces a brace and both columns", () => {
    const html = mathToHtml("cases(x, x>0; -x, x<=0)");
    expect(html).toContain("m-cases");
    expect(html).toContain("m-case-val");
    expect(html).toContain("m-case-cond");
  });

  test("operators are marked so they get spacing (the preview's whole point)", () => {
    expect(mathToHtml("a + b")).toContain("m-op");
  });
});
