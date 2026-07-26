// mathParse.ts had no dedicated suite. It is not untested — latex.test.ts,
// mathHtml.test.ts and palettes.test.ts all drive it — but they drive the happy
// path, because they exist to check what the emitters produce from valid input.
//
// This suite covers the other half of the contract, the half the module header
// states explicitly: "Anything it can't parse throws, so callers can fall back
// to plain formatting." That promise is what taskpane.ts:1672 relies on. A
// parser that throws a TypeError from an undefined lookup instead of a written
// message still "throws", and the fallback still happens, so nothing visibly
// breaks — the user just gets a stack-trace fragment where a sentence should be.
// Nothing else in the suite would catch that.

import { parseMathAst, Node } from "../mathParse";

/** Depth-first search for the first node of a given kind. */
function find(n: Node, kind: Node["k"]): Node | null {
  if (n.k === kind) return n;
  const kids: Node[] = [];
  const any = n as unknown as Record<string, unknown>;
  for (const key of ["items", "rows"]) {
    const v = any[key];
    if (Array.isArray(v)) for (const e of v) Array.isArray(e) ? kids.push(...e) : kids.push(e as Node);
  }
  for (const key of ["num", "den", "base", "sup", "sub", "radicand", "degree", "inner", "body", "arg"]) {
    if (any[key]) kids.push(any[key] as Node);
  }
  for (const k of kids) {
    const hit = find(k, kind);
    if (hit) return hit;
  }
  return null;
}

describe("mathParse — the shapes each construct produces", () => {
  test("a/b is a fraction", () => {
    const n = parseMathAst("a/b");
    expect(find(n, "frac")).not.toBeNull();
  });

  test("x^2 and x_1 are superscript and subscript", () => {
    expect(find(parseMathAst("x^2"), "sup")).not.toBeNull();
    expect(find(parseMathAst("x_1"), "sub")).not.toBeNull();
  });

  test("x_1^2 collapses to a single subsup, not nested sub and sup", () => {
    // Word's OMML has a dedicated subsup element; emitting sub-of-sup instead
    // renders the indices stacked wrongly.
    const n = parseMathAst("x_1^2");
    expect(find(n, "subsup")).not.toBeNull();
  });

  test("sqrt(x) is a radical", () => {
    expect(find(parseMathAst("sqrt(x)"), "rad")).not.toBeNull();
  });

  test("sum(i=1, n, i) is an n-ary with limits", () => {
    const nary = find(parseMathAst("sum(i=1, n, i)"), "nary");
    expect(nary).not.toBeNull();
  });

  test("lim(x->0, e) is a limit", () => {
    expect(find(parseMathAst("lim(x->0, e)"), "lim")).not.toBeNull();
  });

  test("matrix(a,b; c,d) keeps its 2x2 shape", () => {
    const m = find(parseMathAst("matrix(a,b; c,d)"), "matrix") as Extract<Node, { k: "matrix" }>;
    expect(m).not.toBeNull();
    expect(m.rows.length).toBe(2);
    expect(m.rows[0].length).toBe(2);
  });

  test("cases(x, if x>0; -x, otherwise) is a cases block", () => {
    const c = find(parseMathAst("cases(x, if x>0; -x, otherwise)"), "cases") as Extract<Node, { k: "cases" }>;
    expect(c).not.toBeNull();
    expect(c.rows.length).toBe(2);
  });

  test("a known function is marked known and an invented one is not", () => {
    // The flag drives upright vs italic. Getting it backwards is a typesetting
    // error a reviewer notices and the author cannot explain.
    const known = find(parseMathAst("sin(x)"), "func") as Extract<Node, { k: "func" }>;
    expect(known.known).toBe(true);
    const made = find(parseMathAst("frobnicate(x)"), "func") as Extract<Node, { k: "func" }> | null;
    if (made) expect(made.known).toBe(false);
  });
});

describe("mathParse — failure is a sentence, not a stack trace", () => {
  // Each of these must throw an Error whose message is human-readable. The
  // assertion is deliberately about the *message*, not merely that it threw:
  // a TypeError from reading a property of undefined also throws, and would
  // reach the user as "Cannot read properties of undefined (reading 't')".
  const malformed: [string, string][] = [
    ["", "empty input"],
    ["   ", "whitespace only"],
    ["a/", "fraction with no denominator"],
    ["sqrt(", "unclosed function call"],
    ["(a+b", "unbalanced parenthesis"],
    ["a)", "stray closing parenthesis"],
    ["x^", "superscript with nothing after it"],
    ["x_", "subscript with nothing after it"],
    ["matrix(a,b; c)", "ragged matrix rows"],
    ["{", "lone brace"],
    ["}", "lone closing brace"],
    ["^2", "superscript with no base"],
  ];

  for (const [input, why] of malformed) {
    test(`rejects ${why} with a readable message`, () => {
      let caught: unknown = null;
      try {
        parseMathAst(input);
      } catch (e) {
        caught = e;
      }
      expect({ input, threw: caught !== null }).toEqual({ input, threw: true });
      const err = caught as Error;
      expect(err).toBeInstanceOf(Error);
      // Not a runtime type error leaking internals to the pane.
      expect(err.constructor.name).toBe("Error");
      expect(typeof err.message).toBe("string");
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.message).not.toMatch(/undefined|null|\[object|NaN/i);
    });
  }

  test("a long junk string terminates rather than hanging", () => {
    const junk = "((((((((((".repeat(40);
    const started = Date.now();
    expect(() => parseMathAst(junk)).toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("deeply nested but valid input still parses", () => {
    // The mirror of the test above: the guard against runaway input must not
    // reject legitimate nesting.
    expect(() => parseMathAst("sqrt(sqrt(sqrt(sqrt(x))))")).not.toThrow();
  });
});
