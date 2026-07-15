// Matrix-expression evaluator — lets an author combine named matrices with the
// linear-algebra core in one line, MATLAB-style: `A*inv(B) + 2*C'`, `det(A)`,
// `(A - B)^T`. Pure; builds on linalg.ts. Values are either a matrix or a
// scalar, and every operation is dimension-checked so mistakes surface as a
// clear message rather than a wrong number.

import {
  Matrix,
  parseMatrix,
  multiply,
  transpose,
  inverse,
  determinant,
  trace,
  rank,
  rows,
  cols,
} from "./linalg";

export type MatrixValue = { kind: "matrix"; m: Matrix } | { kind: "scalar"; s: number };

export type EvalOutcome = { ok: true; value: MatrixValue } | { ok: false; error: string };

/**
 * Parses named matrix definitions, one per line: `Name = 1 2; 3 4` (rows are
 * separated by `;`, entries by spaces or commas). Returns the environment or the
 * first error encountered.
 */
export function parseDefinitions(text: string): { ok: true; env: Record<string, Matrix> } | { ok: false; error: string } {
  const env: Record<string, Matrix> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq < 0) return { ok: false, error: `"${line}" is not a definition (expected Name = values).` };
    const name = line.slice(0, eq).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return { ok: false, error: `"${name}" is not a valid matrix name.` };
    const parsed = parseMatrix(line.slice(eq + 1));
    if (!parsed.ok) return { ok: false, error: `${name}: ${parsed.error}` };
    env[name] = parsed.matrix;
  }
  return { ok: true, env };
}

// --- tokenizer ---------------------------------------------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "("; }
  | { t: ")"; };

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[0-9.eE+\-]/.test(src[j])) {
        // allow exponent sign only right after e/E
        if ((src[j] === "+" || src[j] === "-") && !/[eE]/.test(src[j - 1])) break;
        j++;
      }
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`Bad number "${src.slice(i, j)}".`);
      toks.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: "name", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "(") {
      toks.push({ t: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      toks.push({ t: ")" });
      i++;
      continue;
    }
    if ("+-*/'^,".includes(ch)) {
      toks.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}".`);
  }
  return toks;
}

// --- recursive-descent parser + evaluator -----------------------------------

const FUNCS = new Set(["inv", "det", "trace", "transpose", "t", "rank"]);

function asMatrix(v: MatrixValue, ctx: string): Matrix {
  if (v.kind !== "matrix") throw new Error(`${ctx} needs a matrix, got a scalar.`);
  return v.m;
}

function add(a: MatrixValue, b: MatrixValue, sign: number): MatrixValue {
  if (a.kind === "scalar" && b.kind === "scalar") return { kind: "scalar", s: a.s + sign * b.s };
  if (a.kind === "matrix" && b.kind === "matrix") {
    if (rows(a.m) !== rows(b.m) || cols(a.m) !== cols(b.m))
      throw new Error(`Can't add/subtract ${rows(a.m)}×${cols(a.m)} and ${rows(b.m)}×${cols(b.m)} — dimensions differ.`);
    return { kind: "matrix", m: a.m.map((row, i) => row.map((x, j) => x + sign * b.m[i][j])) };
  }
  throw new Error("Can't add/subtract a matrix and a scalar.");
}

function mul(a: MatrixValue, b: MatrixValue): MatrixValue {
  if (a.kind === "scalar" && b.kind === "scalar") return { kind: "scalar", s: a.s * b.s };
  if (a.kind === "scalar" && b.kind === "matrix") return { kind: "matrix", m: b.m.map((r) => r.map((x) => a.s * x)) };
  if (a.kind === "matrix" && b.kind === "scalar") return { kind: "matrix", m: a.m.map((r) => r.map((x) => b.s * x)) };
  const am = (a as { kind: "matrix"; m: Matrix }).m;
  const bm = (b as { kind: "matrix"; m: Matrix }).m;
  const p = multiply(am, bm);
  if (!p) throw new Error(`Can't multiply ${rows(am)}×${cols(am)} by ${rows(bm)}×${cols(bm)} — inner dimensions differ.`);
  return { kind: "matrix", m: p };
}

class Parser {
  private pos = 0;
  constructor(private toks: Token[], private env: Record<string, Matrix>) {}

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }
  private next(): Token | undefined {
    return this.toks[this.pos++];
  }

  parse(): MatrixValue {
    const v = this.parseAddSub();
    if (this.pos !== this.toks.length) throw new Error("Unexpected trailing input.");
    return v;
  }

  private parseAddSub(): MatrixValue {
    let left = this.parseMulDiv();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === "op" && (tk.v === "+" || tk.v === "-")) {
        this.next();
        const right = this.parseMulDiv();
        left = add(left, right, tk.v === "+" ? 1 : -1);
      } else break;
    }
    return left;
  }

  private parseMulDiv(): MatrixValue {
    let left = this.parseUnary();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === "op" && (tk.v === "*" || tk.v === "/")) {
        this.next();
        const right = this.parseUnary();
        if (tk.v === "/") {
          if (right.kind !== "scalar") throw new Error("Division is only by a scalar.");
          if (left.kind === "scalar") left = { kind: "scalar", s: left.s / right.s };
          else left = { kind: "matrix", m: left.m.map((r) => r.map((x) => x / right.s)) };
        } else {
          left = mul(left, right);
        }
      } else break;
    }
    return left;
  }

  private parseUnary(): MatrixValue {
    const tk = this.peek();
    if (tk && tk.t === "op" && tk.v === "-") {
      this.next();
      const v = this.parseUnary();
      return v.kind === "scalar" ? { kind: "scalar", s: -v.s } : { kind: "matrix", m: v.m.map((r) => r.map((x) => -x)) };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): MatrixValue {
    let v = this.parsePrimary();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === "op" && tk.v === "'") {
        this.next();
        v = { kind: "matrix", m: transpose(asMatrix(v, "transpose (')")) };
      } else if (tk && tk.t === "op" && tk.v === "^") {
        // support ^T as an alternate transpose spelling
        this.next();
        const nx = this.peek();
        if (nx && nx.t === "name" && nx.v.toLowerCase() === "t") {
          this.next();
          v = { kind: "matrix", m: transpose(asMatrix(v, "transpose (^T)")) };
        } else {
          throw new Error("Only ^T (transpose) is supported after ^.");
        }
      } else break;
    }
    return v;
  }

  private parsePrimary(): MatrixValue {
    const tk = this.next();
    if (!tk) throw new Error("Unexpected end of expression.");
    if (tk.t === "num") return { kind: "scalar", s: tk.v };
    if (tk.t === "(") {
      const v = this.parseAddSub();
      const close = this.next();
      if (!close || close.t !== ")") throw new Error("Missing ')'.");
      return v;
    }
    if (tk.t === "name") {
      const lname = tk.v.toLowerCase();
      if (FUNCS.has(lname) && this.peek() && this.peek()!.t === "(") {
        this.next(); // consume '('
        const arg = this.parseAddSub();
        const close = this.next();
        if (!close || close.t !== ")") throw new Error(`Missing ')' after ${tk.v}(.`);
        return this.applyFunc(lname, arg);
      }
      const m = this.env[tk.v];
      if (!m) throw new Error(`Unknown matrix "${tk.v}". Define it first (e.g. ${tk.v} = 1 2; 3 4).`);
      return { kind: "matrix", m };
    }
    throw new Error("Unexpected token.");
  }

  private applyFunc(name: string, arg: MatrixValue): MatrixValue {
    const m = asMatrix(arg, `${name}()`);
    if (name === "inv") {
      const inv = inverse(m);
      if (!inv) throw new Error("inv(): matrix is singular (determinant 0).");
      return { kind: "matrix", m: inv };
    }
    if (name === "det") {
      const d = determinant(m);
      if (d === null) throw new Error("det(): matrix must be square.");
      return { kind: "scalar", s: d };
    }
    if (name === "trace") return { kind: "scalar", s: trace(m) };
    if (name === "rank") return { kind: "scalar", s: rank(m) };
    // transpose / t
    return { kind: "matrix", m: transpose(m) };
  }
}

/** Evaluates a matrix expression against a set of named matrices. */
export function evalMatrixExpression(expr: string, env: Record<string, Matrix>): EvalOutcome {
  if (!expr.trim()) return { ok: false, error: "Enter an expression." };
  try {
    const toks = tokenize(expr);
    const value = new Parser(toks, env).parse();
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
