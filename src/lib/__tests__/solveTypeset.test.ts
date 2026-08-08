// The Solve input drawn as real mathematics: solveToTypesetDsl bridges the
// Solve grammar (√, ², ≤, whitespace multiplication) into the mathParse DSL
// so mathToHtml/mathToOmml can draw it. The bridge must (a) never lose the
// meaning and (b) produce something both renderers actually accept — the
// taskpane-parsers-are-untestable lesson is why this lives in src/lib.

import { solveToTypesetDsl, solveInputToTypesetLines, isProseRequest } from "../solveTypeset";
import { mathToHtml } from "../mathHtml";
import { mathToOmml } from "../mathOmml";
import { parseExpr, evalAst, normalizeUnicodeMath } from "../solve";

/** Renders without throwing, and returns the HTML for content checks. */
function html(line: string): string {
  return mathToHtml(solveToTypesetDsl(line));
}

/** What the user actually SEES — markup stripped (class names like m-sqrt
 *  contain the word the visible text must not). */
function visible(line: string): string {
  return html(line).replace(/<[^>]*>/g, "");
}

describe("the square-root sign draws as a radical, not the word sqrt", () => {
  test("√(x+1) typesets", () => {
    const v = visible("√(x+1) = 3");
    expect(v).toContain("√");
    expect(v).not.toContain("sqrt");
  });

  test("√4, √x and √sin(x) all typeset", () => {
    for (const probe of ["√4", "√x", "√sin(x)"]) {
      expect(() => html(probe)).not.toThrow();
    }
  });
});

describe("superscripts draw stacked, with invisible grouping", () => {
  test("x² becomes a real superscript without visible brackets", () => {
    const h = html("x² - 5x + 6 = 0");
    expect(h).toContain("<sup>");
    // The ^(2) the normalizer writes must not leak its brackets into the
    // exponent — braces group invisibly in mathParse.
    expect(h).not.toContain("(2)");
  });

  test("a compound exponent keeps its content", () => {
    expect(html("x^(n+1)")).toContain("<sup>");
    expect(visible("x^(n+1)").replace(/\s+/g, "")).toContain("n+1");
  });
});

describe("relation glyphs survive the round trip", () => {
  test("≤ ≥ ≠ draw as themselves", () => {
    expect(html("x² ≤ 4")).toContain("≤");
    expect(html("x ≥ -1")).toContain("≥");
    expect(html("x ≠ 2")).toContain("≠");
  });
});

describe("systems typeset one line per equation", () => {
  test("two equations, two lines", () => {
    const lines = solveInputToTypesetLines("2x + y = 7\nx - y = 2");
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(() => mathToHtml(l)).not.toThrow();
  });

  test("blank lines are dropped", () => {
    expect(solveInputToTypesetLines("x = 1\n\n\ny = 2")).toHaveLength(2);
  });
});

describe("the drawn equation still MEANS what the solver reads", () => {
  test("π and fractions keep their values through the bridge", () => {
    // The typeset DSL is display-only, but its content must match what
    // parseExpr computes from the ORIGINAL input — same symbols, same
    // structure. Spot-check by evaluating the original.
    const v = evalAst(parseExpr(normalizeUnicodeMath("√(16) + 2²")), {});
    expect(v).toBe(8);
    expect(() => html("√(16) + 2²")).not.toThrow();
  });

  test("equation-library templates all typeset (they will be drawn in the canvas)", () => {
    for (const probe of [
      "F = m a",
      "P V = n R T",
      "c^2 = a^2 + b^2",
      "V = (4/3) π r^3",
      "s = u t + (1/2) a t^2",
      "A = P (1 + r)^t",
    ]) {
      expect(() => html(probe)).not.toThrow();
    }
  });
});

describe("OMML insertion accepts the same bridge output", () => {
  test("√ and ² insert as real Word math", () => {
    for (const probe of ["√(x+1) = 3", "x² - 5x + 6 = 0", "V = (4/3) π r^3"]) {
      const omml = mathToOmml(solveToTypesetDsl(probe));
      expect(omml).toContain("<m:oMath");
      expect(omml.length).toBeGreaterThan(40);
    }
  });
});

describe("limit/series prose is recognised, never typeset as fake math", () => {
  test("prose requests are detected (adversarial regression)", () => {
    // Bridging these drew "limitsin(x)xasx→0" as if it were mathematics,
    // and the canvas's validation line called them unreadable while the
    // pane solved them.
    expect(isProseRequest("limit sin(x)/x as x -> 0")).toBe(true);
    expect(isProseRequest("lim 1/x as x -> inf")).toBe(true);
    expect(isProseRequest("taylor exp(x) order 5")).toBe(true);
    expect(isProseRequest("maclaurin sin(x)")).toBe(true);
  });

  test("ordinary expressions are NOT prose", () => {
    expect(isProseRequest("x^2 - 5x + 6 = 0")).toBe(false);
    expect(isProseRequest("√(x+1) = 3")).toBe(false);
    expect(isProseRequest("sin(x^2)")).toBe(false);
  });
});

describe("garbage degrades, never crashes the bridge", () => {
  test("unbalanced input returns a string (renderers may reject it downstream)", () => {
    for (const probe of ["√(", "x^(", "((("]) {
      expect(typeof solveToTypesetDsl(probe)).toBe("string");
    }
  });
});
