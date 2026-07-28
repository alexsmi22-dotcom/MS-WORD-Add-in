// Planar truss analysis by the method of joints, solved exactly.
//
// HOW THIS STAYS EXACT DESPITE THE GEOMETRY BEING IRRATIONAL. The obvious
// formulation carries each member's axial force F and resolves it with the
// direction cosines dx/L and dy/L. That immediately leaves the rationals: a
// member from (0,0) to (4,3) is fine, but one from (0,0) to (2,3) has
// L = sqrt(13) and every coefficient in the matrix becomes irrational, so the
// whole solve would round and a student checking 2/3 kN against a textbook
// would see 0.6666666666666666.
//
// The fix is to change the unknown. Instead of solving for the axial force F,
// solve for the FORCE PER UNIT LENGTH
//
//     f = F / L
//
// whose components along the member are then exactly f·dx and f·dy — RATIONAL
// whenever the joint coordinates are, with no square root anywhere in the
// matrix. The entire equilibrium system is therefore exact, and the only
// irrational step in the whole analysis is the very last one, F = f·L, done
// once per member at the point of reporting. Reactions never touch it at all
// and come out exactly. This is the same discipline as beam.ts and circuit.ts:
// keep the exact part exact, and put the single unavoidable floating-point step
// where the reader can see it happen.
//
// A pleasant consequence is that ZERO-FORCE MEMBERS ARE DETECTED EXACTLY.
// f = 0 exactly iff F = 0, and an exact zero is a fact rather than a value
// below a tolerance that some other truss would have straddled.
//
// WHAT IT REFUSES, AND WHY EACH IS A REAL ERROR RATHER THAN A HARD PROBLEM:
//   - Too few members or reactions (m + r < 2j) is a MECHANISM. It does not
//     have a wrong answer, it has no answer: the structure moves.
//   - Too many (m + r > 2j) is statically INDETERMINATE. The method of joints
//     genuinely cannot solve it — the forces depend on member stiffnesses,
//     which a statics model does not have. Returning one of the infinitely many
//     equilibrium solutions would look like an answer and be arbitrary.
//   - The right count with a singular matrix is a CRITICAL FORM: three parallel
//     or three concurrent reactions, or an internal mechanism paid for by a
//     redundant member elsewhere. The count says determinate and the structure
//     still collapses. This is the case worth naming loudest, because member
//     counting is exactly what a student is taught to trust.
//
// SIGN CONVENTIONS:
//   x is to the right, y is UP.
//   Loads are TRUE VECTOR COMPONENTS, so a downward load is NEGATIVE. This
//     differs from beam.ts, where every load is gravity and downward-positive
//     is what a student reads off the figure; here loads have two components
//     and a vector convention is the only one that stays coherent.
//   Member force is POSITIVE IN TENSION, negative in compression — universal in
//     truss work and the convention every textbook answer is quoted in.

import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratInt, ratIsZero, ratNeg, ratToNumber, ratFromNumber } from "./cas";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface Joint {
  name: string;
  x: Rat;
  y: Rat;
}

export interface Member {
  /** Joint names. */
  a: string;
  b: string;
}

/**
 * A support. "pin" restrains both directions; "roller" restrains one.
 * A roller's restrained direction is normal to the surface it rolls on: the
 * default rolls horizontally and so reacts VERTICALLY.
 */
export interface TrussSupport {
  joint: string;
  kind: "pin" | "roller" | "roller-h";
}

export interface JointLoad {
  joint: string;
  fx: Rat;
  fy: Rat;
}

export interface TrussInput {
  joints: Joint[];
  members: Member[];
  supports: TrussSupport[];
  loads: JointLoad[];
}

export interface MemberForce {
  a: string;
  b: string;
  /** Length — irrational in general, so a number. */
  length: number;
  /** Exact force per unit length. */
  perLength: Rat;
  /** Axial force, positive in tension. */
  force: number;
  /** Exact axial force when the length is rational (a Pythagorean member). */
  exact: Rat | null;
  state: "tension" | "compression" | "zero";
}

export interface ReactionForce {
  joint: string;
  /** "x" or "y". */
  dir: "x" | "y";
  value: number;
  exact: Rat;
}

export interface TrussResult {
  ok: true;
  members: MemberForce[];
  reactions: ReactionForce[];
  /** j, m, r and the m + r = 2j check. */
  counts: { joints: number; members: number; reactions: number; equations: number };
  determinacy: string;
  /** Members carrying exactly zero force. */
  zeroForce: string[];
  maxTension: { member: string; force: number } | null;
  maxCompression: { member: string; force: number } | null;
  warnings: string[];
}

export interface TrussError {
  ok: false;
  error: string;
}

// A pane recomputes on every keystroke, and Gauss-Jordan over BigInt rationals
// is cubic in the unknown count with coefficients that can grow as they go. The
// caps keep the worst case comfortably interactive; they are far above any
// truss a person types by hand.
const MAX_JOINTS = 60;
const MAX_MEMBERS = 150;

// ---------------------------------------------------------------------------
// Exact linear solve
// ---------------------------------------------------------------------------

/**
 * Gauss-Jordan over exact rationals for a square system. Returns null when the
 * matrix is singular, which for a truss is a real structural statement (see the
 * header) and must be reported rather than regularised.
 */
function solveExact(A: Rat[][], b: Rat[]): Rat[] | null {
  const n = b.length;
  if (A.length !== n) return null;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = -1;
    for (let r = col; r < n; r++) {
      if (!ratIsZero(m[r][col])) {
        pivot = r;
        break;
      }
    }
    if (pivot < 0) return null;
    if (pivot !== col) {
      const t = m[pivot];
      m[pivot] = m[col];
      m[col] = t;
    }
    const p = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] = ratDiv(m[col][j], p);
    for (let r = 0; r < n; r++) {
      if (r === col || ratIsZero(m[r][col])) continue;
      const f = m[r][col];
      for (let j = col; j <= n; j++) m[r][j] = ratSub(m[r][j], ratMul(f, m[col][j]));
    }
  }
  return m.map((row) => row[n]);
}

/** Exact integer square root of a rational, or null when it is irrational. */
function ratSqrt(q: Rat): Rat | null {
  if (q.n < 0n) return null;
  const isqrt = (v: bigint): bigint | null => {
    if (v < 0n) return null;
    if (v < 2n) return v;
    // Newton's method on BigInt. Strictly decreasing until it converges, so the
    // loop terminates; the guard is belt and braces rather than a real bound.
    let x = v;
    let y = (x + 1n) / 2n;
    let guard = 0;
    while (y < x && guard++ < 10000) {
      x = y;
      y = (x + v / x) / 2n;
    }
    return x * x === v ? x : null;
  };
  const n = isqrt(q.n);
  const d = isqrt(q.d);
  if (n === null || d === null) return null;
  return ratDiv(ratInt(n), ratInt(d));
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/** Analyses a planar truss by the method of joints. */
export function analyzeTruss(input: TrussInput): TrussResult | TrussError {
  const { joints, members, supports, loads } = input;

  if (joints.length < 2) return { ok: false, error: "A truss needs at least two joints." };
  if (joints.length > MAX_JOINTS)
    return { ok: false, error: `Too many joints (${joints.length}); the limit is ${MAX_JOINTS}.` };
  if (members.length === 0) return { ok: false, error: "A truss needs at least one member." };
  if (members.length > MAX_MEMBERS)
    return { ok: false, error: `Too many members (${members.length}); the limit is ${MAX_MEMBERS}.` };

  const index = new Map<string, number>();
  for (let i = 0; i < joints.length; i++) {
    if (index.has(joints[i].name)) return { ok: false, error: `Joint "${joints[i].name}" is defined twice.` };
    index.set(joints[i].name, i);
  }

  // Two joints at the same point make every member between them zero-length,
  // whose direction is undefined. Catching it here gives a structural message
  // rather than a division by zero three steps later.
  for (let i = 0; i < joints.length; i++) {
    for (let k = i + 1; k < joints.length; k++) {
      if (ratIsZero(ratSub(joints[i].x, joints[k].x)) && ratIsZero(ratSub(joints[i].y, joints[k].y))) {
        return {
          ok: false,
          error: `Joints "${joints[i].name}" and "${joints[k].name}" are at the same point.`,
        };
      }
    }
  }

  for (const m of members) {
    if (!index.has(m.a)) return { ok: false, error: `Member refers to unknown joint "${m.a}".` };
    if (!index.has(m.b)) return { ok: false, error: `Member refers to unknown joint "${m.b}".` };
    if (m.a === m.b) return { ok: false, error: `A member cannot join "${m.a}" to itself.` };
  }
  for (const s of supports) {
    if (!index.has(s.joint)) return { ok: false, error: `Support refers to unknown joint "${s.joint}".` };
  }
  for (const l of loads) {
    if (!index.has(l.joint)) return { ok: false, error: `Load refers to unknown joint "${l.joint}".` };
  }

  const warnings: string[] = [];

  // Duplicate members carry the same line of action, so the matrix is singular
  // by construction. Named here rather than left to the generic message.
  const seen = new Set<string>();
  for (const m of members) {
    const key = m.a < m.b ? `${m.a}|${m.b}` : `${m.b}|${m.a}`;
    if (seen.has(key)) return { ok: false, error: `Members "${m.a}-${m.b}" is listed twice.` };
    seen.add(key);
  }

  // Unknowns: one f per member, then the reaction components in order.
  const reactionSlots: { joint: string; dir: "x" | "y" }[] = [];
  for (const s of supports) {
    if (s.kind === "pin") {
      reactionSlots.push({ joint: s.joint, dir: "x" });
      reactionSlots.push({ joint: s.joint, dir: "y" });
    } else if (s.kind === "roller") {
      reactionSlots.push({ joint: s.joint, dir: "y" });
    } else {
      reactionSlots.push({ joint: s.joint, dir: "x" });
    }
  }

  const j = joints.length;
  const nm = members.length;
  const nr = reactionSlots.length;
  const equations = 2 * j;
  const unknowns = nm + nr;
  const counts = { joints: j, members: nm, reactions: nr, equations };

  if (unknowns < equations) {
    return {
      ok: false,
      error:
        `This is a MECHANISM, not a truss: ${nm} members plus ${nr} reaction components is ` +
        `${unknowns} unknowns against ${equations} equilibrium equations (2 per joint). ` +
        `It is short of ${equations - unknowns} restraint(s) and will move rather than carry load.`,
    };
  }
  if (unknowns > equations) {
    return {
      ok: false,
      error:
        `This truss is statically INDETERMINATE to degree ${unknowns - equations}: ${nm} members ` +
        `plus ${nr} reaction components is ${unknowns} unknowns against only ${equations} ` +
        "equilibrium equations. The method of joints cannot solve it — the member forces depend " +
        "on the members' relative stiffnesses (their EA), which statics alone does not know. " +
        "Remove a redundant member or release a support to make it determinate.",
    };
  }

  // Rows: 2 per joint, x then y. Columns: members then reactions.
  const A: Rat[][] = [];
  for (let i = 0; i < equations; i++) A.push(new Array(unknowns).fill(ratInt(0)));
  const rhs: Rat[] = new Array(equations).fill(ratInt(0));

  for (let mi = 0; mi < nm; mi++) {
    const m = members[mi];
    const ja = index.get(m.a) as number;
    const jb = index.get(m.b) as number;
    const dx = ratSub(joints[jb].x, joints[ja].x);
    const dy = ratSub(joints[jb].y, joints[ja].y);
    // Tension pulls each end toward the other end.
    A[2 * ja][mi] = ratAdd(A[2 * ja][mi], dx);
    A[2 * ja + 1][mi] = ratAdd(A[2 * ja + 1][mi], dy);
    A[2 * jb][mi] = ratAdd(A[2 * jb][mi], ratNeg(dx));
    A[2 * jb + 1][mi] = ratAdd(A[2 * jb + 1][mi], ratNeg(dy));
  }

  for (let ri = 0; ri < nr; ri++) {
    const slot = reactionSlots[ri];
    const jn = index.get(slot.joint) as number;
    const row = slot.dir === "x" ? 2 * jn : 2 * jn + 1;
    A[row][nm + ri] = ratAdd(A[row][nm + ri], ratInt(1));
  }

  // Applied loads move to the right-hand side: sum(internal) = -applied.
  for (const l of loads) {
    const jn = index.get(l.joint) as number;
    rhs[2 * jn] = ratSub(rhs[2 * jn], l.fx);
    rhs[2 * jn + 1] = ratSub(rhs[2 * jn + 1], l.fy);
  }

  const sol = solveExact(A, rhs);
  if (!sol) {
    return {
      ok: false,
      error:
        "The equilibrium equations are singular, so this truss is in a CRITICAL FORM: the " +
        `member count balances (${unknowns} unknowns, ${equations} equations) but the ` +
        "arrangement is still unstable. The usual causes are three reactions that are all " +
        "parallel or all concurrent through one point, a joint whose members are all collinear, " +
        "or an internal mechanism in one panel paid for by a redundant member in another. " +
        "Counting members does not catch this; the geometry has to change.",
    };
  }

  const memberForces: MemberForce[] = [];
  for (let mi = 0; mi < nm; mi++) {
    const m = members[mi];
    const ja = index.get(m.a) as number;
    const jb = index.get(m.b) as number;
    const dx = ratSub(joints[jb].x, joints[ja].x);
    const dy = ratSub(joints[jb].y, joints[ja].y);
    const l2 = ratAdd(ratMul(dx, dx), ratMul(dy, dy));
    const lenExact = ratSqrt(l2);
    const length = lenExact ? ratToNumber(lenExact) : Math.sqrt(ratToNumber(l2));
    const f = sol[mi];
    const exact = lenExact ? ratMul(f, lenExact) : null;
    const force = exact ? ratToNumber(exact) : ratToNumber(f) * length;
    memberForces.push({
      a: m.a,
      b: m.b,
      length,
      perLength: f,
      force,
      exact,
      state: ratIsZero(f) ? "zero" : force > 0 ? "tension" : "compression",
    });
  }

  const reactions: ReactionForce[] = reactionSlots.map((slot, ri) => ({
    joint: slot.joint,
    dir: slot.dir,
    value: ratToNumber(sol[nm + ri]),
    exact: sol[nm + ri],
  }));

  const zeroForce = memberForces.filter((m) => m.state === "zero").map((m) => `${m.a}-${m.b}`);

  let maxTension: { member: string; force: number } | null = null;
  let maxCompression: { member: string; force: number } | null = null;
  for (const m of memberForces) {
    if (m.force > 0 && (!maxTension || m.force > maxTension.force))
      maxTension = { member: `${m.a}-${m.b}`, force: m.force };
    if (m.force < 0 && (!maxCompression || m.force < maxCompression.force))
      maxCompression = { member: `${m.a}-${m.b}`, force: m.force };
  }

  if (maxCompression) {
    warnings.push(
      "Compression members are sized by BUCKLING, not by the compressive strength of the " +
        "material. Take the largest compression force to the column tool with the member's own " +
        "length and its weaker second moment of area.",
    );
  }
  if (zeroForce.length) {
    warnings.push(
      "A zero-force member is not a useless one: it braces its neighbours against buckling and " +
        "it carries load under a different load case. It is zero for THIS loading only.",
    );
  }

  const determinacy =
    `Statically determinate: ${nm} members + ${nr} reaction components = ` +
    `${unknowns} unknowns = 2 x ${j} joints. Solved exactly.`;

  return {
    ok: true,
    members: memberForces,
    reactions,
    counts,
    determinacy,
    zeroForce,
    maxTension,
    maxCompression,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * A decimal to an EXACT rational — 2.5 becomes 5/2, not the binary double
 * nearest 2.5. Going through ratFromNumber on a value like 0.1 would embed the
 * double's error in what is supposed to be the exact half of the engine.
 */
function parseRat(s: string): Rat | null {
  const t = s.trim();
  if (!t) return null;
  let m = /^([+-]?\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) {
    const d = BigInt(m[2]);
    if (d === 0n) return null;
    return ratDiv(ratInt(BigInt(m[1])), ratInt(d));
  }
  m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (m && (m[2] || m[3])) {
    const sign = m[1] === "-" ? -1n : 1n;
    const whole = m[2] || "0";
    const frac = m[3] || "";
    const num = BigInt(whole + frac) * sign;
    const den = 10n ** BigInt(frac.length);
    return ratDiv(ratInt(num), ratInt(den));
  }
  // Scientific notation is rational too, and is what a pasted spreadsheet gives.
  m = /^([+-]?\d*\.?\d+)[eE]([+-]?\d+)$/.exec(t);
  if (m) {
    const base = parseRat(m[1]);
    if (!base) return null;
    const exp = parseInt(m[2], 10);
    if (!Number.isFinite(exp) || Math.abs(exp) > 300) return null;
    const p = ratDiv(ratInt(10n ** BigInt(Math.abs(exp))), ratInt(1));
    return exp >= 0 ? ratMul(base, p) : ratDiv(base, p);
  }
  const n = Number(t);
  return Number.isFinite(n) ? ratFromNumber(n) : null;
}

export interface ParsedTruss {
  input: TrussInput;
  errors: string[];
}

/**
 * Parses the pane's line-per-item truss description:
 *
 *   joint A 0 0
 *   member A B
 *   support A pin
 *   load C 0 -10
 *
 * Every joint must be declared before it is used. Letting a member introduce
 * one implicitly would turn a typo in a joint name into a new joint at an
 * unknown position — a different structure that still solves, and reports a
 * confident answer to a question nobody asked.
 */
export function parseTruss(text: string): ParsedTruss {
  const joints: Joint[] = [];
  const members: Member[] = [];
  const supports: TrussSupport[] = [];
  const loads: JointLoad[] = [];
  const errors: string[] = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].split(/[#;]/)[0].trim();
    if (!raw) continue;
    const tok = raw.split(/[\s,]+/).filter(Boolean);
    const kind = tok[0].toLowerCase();
    const where = `line ${i + 1}`;

    if (kind === "joint" || kind === "node") {
      if (tok.length !== 4) {
        errors.push(`${where}: a joint needs a name and two coordinates, e.g. "joint A 0 0".`);
        continue;
      }
      const x = parseRat(tok[2]);
      const y = parseRat(tok[3]);
      if (!x || !y) {
        errors.push(`${where}: "${tok[2]} ${tok[3]}" is not a pair of numbers.`);
        continue;
      }
      joints.push({ name: tok[1], x, y });
    } else if (kind === "member" || kind === "bar") {
      if (tok.length !== 3) {
        errors.push(`${where}: a member needs two joint names, e.g. "member A B".`);
        continue;
      }
      members.push({ a: tok[1], b: tok[2] });
    } else if (kind === "support") {
      if (tok.length !== 3) {
        errors.push(`${where}: a support needs a joint and a kind, e.g. "support A pin".`);
        continue;
      }
      const k = tok[2].toLowerCase();
      if (k === "pin" || k === "pinned") supports.push({ joint: tok[1], kind: "pin" });
      else if (k === "roller") supports.push({ joint: tok[1], kind: "roller" });
      else if (k === "roller-h" || k === "rollerh") supports.push({ joint: tok[1], kind: "roller-h" });
      else errors.push(`${where}: "${tok[2]}" is not a support kind. Use pin, roller, or roller-h.`);
    } else if (kind === "load" || kind === "force") {
      if (tok.length !== 4) {
        errors.push(`${where}: a load needs a joint and two components, e.g. "load C 0 -10".`);
        continue;
      }
      const fx = parseRat(tok[2]);
      const fy = parseRat(tok[3]);
      if (!fx || !fy) {
        errors.push(`${where}: "${tok[2]} ${tok[3]}" is not a pair of numbers.`);
        continue;
      }
      loads.push({ joint: tok[1], fx, fy });
    } else {
      errors.push(`${where}: "${tok[0]}" is not joint, member, support, or load.`);
    }
  }

  if (!joints.length && !errors.length) errors.push("No joints were given.");

  return { input: { joints, members, supports, loads }, errors };
}
