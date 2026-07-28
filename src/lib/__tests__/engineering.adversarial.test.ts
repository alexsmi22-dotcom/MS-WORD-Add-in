// Adversarial pass over the Engineering engines.
//
// This is deliberately a SEPARATE file from the oracle tests, because the two
// ask different questions. The oracle tests ask "is the physics right for the
// inputs a student types". This file assumes an actively hostile input and asks
// two things the oracle tests structurally cannot:
//
//   1. DOES IT TERMINATE. Every one of these engines runs inside a Word task
//      pane, recomputing on each keystroke. A function that does not return is
//      not an error message — it is a frozen Word with the user's document
//      inside it, and no stack trace. Number.isFinite() on an input is NOT a
//      bound on a loop; that lesson cost seven functions in this codebase.
//   2. DOES IT REFUSE RATHER THAN LIE. An engine that returns NaN, Infinity, or
//      a confident number for a physically impossible input is worse than one
//      that throws, because the number reaches the document.
//
// Every case here is one an unlucky user reaches by accident: a pasted value in
// the wrong unit, a stray minus sign, a spreadsheet cell in scientific
// notation, an empty field.

import { analyzeStress, analyzeTorsion, analyzeColumn, transformPlane } from "../stress";
import { analyzeTruss, parseTruss } from "../truss";
import { analyzePipe, colebrook, waterProperties } from "../fluids";
import { analyzeWall, analyzeExchanger } from "../heat";

/** Runs `fn` and fails if it takes longer than `ms` — the freeze check. */
function within<T>(ms: number, fn: () => T): T {
  const t0 = Date.now();
  const out = fn();
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error(`took ${dt} ms, budget was ${ms} ms`);
  return out;
}

/** Every number a result exposes must be finite, or the engine must have refused. */
function allFinite(o: unknown, path = "result"): string[] {
  const bad: string[] = [];
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) bad.push(`${p} = ${v}`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === "bigint") continue;
        walk(x, `${p}.${k}`);
      }
    }
  };
  walk(o, path);
  return bad;
}

const HOSTILE = [NaN, Infinity, -Infinity];
/** Values that are finite but absurd — the ones that overflow intermediates. */
const EXTREME = [1e-300, 1e-30, 1e30, 1e150, 1e300, Number.MAX_VALUE, Number.MIN_VALUE];

// ---------------------------------------------------------------------------
describe("stress: hostile input never produces a confident non-number", () => {
  test("a non-finite component is refused, in every slot", () => {
    const keys = ["sx", "sy", "sz", "txy", "tyz", "tzx"] as const;
    for (const k of keys) {
      for (const v of HOSTILE) {
        const s = { sx: 1, sy: 1, sz: 1, txy: 1, tyz: 1, tzx: 1, [k]: v };
        const r = analyzeStress(s);
        expect(r.ok).toBe(false);
      }
    }
  });

  // The characteristic cubic computes I1^3, which overflows to Infinity for
  // inputs around 1e103 even though every input is perfectly finite. An engine
  // that then reports NaN principal stresses has lied about a legal question.
  test("extreme but finite magnitudes give finite principal stresses or a refusal", () => {
    for (const m of EXTREME) {
      const r = within(50, () => analyzeStress({ sx: m, sy: -m / 2, sz: 0, txy: m / 3, tyz: 0, tzx: 0 }));
      if (r.ok) {
        expect(allFinite(r)).toEqual([]);
        // Ordering must survive scaling too.
        expect(r.principal[0]).toBeGreaterThanOrEqual(r.principal[1]);
        expect(r.principal[1]).toBeGreaterThanOrEqual(r.principal[2]);
      }
    }
  });

  test("principal ordering and invariants hold over a randomised sweep", () => {
    // A fixed seed, so a failure is reproducible rather than a flake.
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    for (let i = 0; i < 2000; i++) {
      const scale = Math.pow(10, Math.floor(rnd() * 6));
      const s = {
        sx: rnd() * scale,
        sy: rnd() * scale,
        sz: rnd() * scale,
        txy: rnd() * scale,
        tyz: rnd() * scale,
        tzx: rnd() * scale,
      };
      const r = analyzeStress(s);
      if (!r.ok) throw new Error(`refused a legal state: ${JSON.stringify(s)}`);
      expect(allFinite(r)).toEqual([]);
      expect(r.principal[0]).toBeGreaterThanOrEqual(r.principal[1] - 1e-6 * scale);
      expect(r.principal[1]).toBeGreaterThanOrEqual(r.principal[2] - 1e-6 * scale);
      // The first invariant is a hard identity, whatever the state.
      const I1 = s.sx + s.sy + s.sz;
      const sum = r.principal[0] + r.principal[1] + r.principal[2];
      expect(Math.abs(sum - I1)).toBeLessThan(1e-8 * Math.max(1, Math.abs(I1)));
      // von Mises is a norm: never negative, and zero only for a hydrostatic state.
      expect(r.vonMises).toBeGreaterThanOrEqual(0);
      expect(r.tresca).toBeGreaterThanOrEqual(-1e-9 * scale);
    }
  });

  test("a hydrostatic state does not divide by zero", () => {
    for (const p of [0, 1, -1, 1e12, -1e12]) {
      const r = analyzeStress({ sx: p, sy: p, sz: p, txy: 0, tyz: 0, tzx: 0 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(allFinite(r)).toEqual([]);
        expect(Math.abs(r.vonMises)).toBeLessThan(1e-6 * Math.max(1, Math.abs(p)));
      }
    }
  });

  test("transformPlane refuses non-finite input and survives absurd angles", () => {
    for (const v of HOSTILE) {
      expect((transformPlane(v, 1, 1, 0) as { ok?: boolean }).ok).toBe(false);
      expect((transformPlane(1, 1, 1, v) as { ok?: boolean }).ok).toBe(false);
    }
    for (const deg of [1e9, -1e9, 1e15]) {
      const t = within(20, () => transformPlane(70, -25, 40, deg)) as { sxp: number; syp: number };
      expect(Number.isFinite(t.sxp)).toBe(true);
      expect(Number.isFinite(t.syp)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("torsion and columns refuse rather than overflow", () => {
  test("torsion rejects every non-finite argument", () => {
    const base = { T: 100, d: 0.05, di: 0, L: 1, G: 80e9 };
    for (const k of ["T", "d", "di", "L", "G"] as const) {
      for (const v of HOSTILE) {
        expect(analyzeTorsion({ ...base, [k]: v }).ok).toBe(false);
      }
    }
  });

  test("torsion on extreme geometry stays finite or refuses", () => {
    for (const d of EXTREME) {
      const r = within(20, () => analyzeTorsion({ T: 1000, d, di: 0, L: 1, G: 80e9 }));
      if (r.ok) expect(allFinite(r)).toEqual([]);
    }
  });

  test("a bore microscopically smaller than the shaft does not produce a negative J", () => {
    const r = analyzeTorsion({ T: 100, d: 0.05, di: 0.05 * (1 - 1e-15), L: 0, G: 0 });
    if (r.ok) {
      expect(r.J).toBeGreaterThan(0);
      expect(allFinite(r)).toEqual([]);
    }
  });

  test("columns reject every non-finite argument", () => {
    const base = { L: 3, E: 200e9, I: 1e-6, A: 2e-3, Fy: 250e6, end: "pinned" as const };
    for (const k of ["L", "E", "I", "A", "Fy"] as const) {
      for (const v of HOSTILE) {
        expect(analyzeColumn({ ...base, [k]: v }).ok).toBe(false);
      }
    }
  });

  test("extreme column stiffness stays finite or refuses", () => {
    const base = { L: 3, A: 2e-3, Fy: 250e6, end: "pinned" as const };
    for (const E of EXTREME) {
      for (const I of [1e-12, 1e6]) {
        const r = within(20, () => analyzeColumn({ ...base, E, I }));
        if (r.ok) expect(allFinite(r)).toEqual([]);
      }
    }
  });

  // The Johnson branch must never report a critical load above the squash load:
  // that is the entire reason the branch exists, and it must hold at the edges.
  test("the governing load never exceeds the squash load, over a sweep of lengths", () => {
    for (let L = 0.01; L < 20; L *= 1.2) {
      const r = analyzeColumn({ L, E: 200e9, I: 1e-6, A: 2e-3, Fy: 250e6, end: "pinned" });
      if (!r.ok) continue;
      expect(r.pCritical).toBeLessThanOrEqual((r.pSquash as number) * (1 + 1e-9));
      expect(r.pCritical).toBeGreaterThan(0);
      expect(r.pCritical).toBeLessThanOrEqual(Math.max(r.pEuler, r.pSquash as number) * (1 + 1e-9));
    }
  });
});

// ---------------------------------------------------------------------------
describe("truss: pathological structures terminate and refuse", () => {
  const J = (name: string, x: number, y: number) => `joint ${name} ${x} ${y}`;

  test("a large but legal truss solves inside the pane's budget", () => {
    // A 20-panel Pratt truss: 42 joints, 81 members, 3 reactions.
    const lines: string[] = [];
    const n = 20;
    for (let i = 0; i <= n; i++) lines.push(J(`B${i}`, i * 2, 0));
    for (let i = 0; i <= n; i++) lines.push(J(`T${i}`, i * 2, 3));
    for (let i = 0; i < n; i++) lines.push(`member B${i} B${i + 1}`);
    for (let i = 0; i < n; i++) lines.push(`member T${i} T${i + 1}`);
    for (let i = 0; i <= n; i++) lines.push(`member B${i} T${i}`);
    for (let i = 0; i < n; i++) lines.push(`member B${i} T${i + 1}`);
    lines.push("support B0 pin");
    lines.push(`support B${n} roller`);
    for (let i = 1; i < n; i++) lines.push(`load T${i} 0 -10`);
    const p = parseTruss(lines.join("\n"));
    expect(p.errors).toEqual([]);
    // Exact BigInt rationals over an 80-plus unknown system: the budget is the
    // point of the test, not the answer.
    const r = within(4000, () => analyzeTruss(p.input));
    if (r.ok) {
      expect(allFinite(r.members.map((m) => m.force))).toEqual([]);
      expect(allFinite(r.reactions.map((x) => x.value))).toEqual([]);
    }
  });

  test("the joint and member caps are enforced rather than attempted", () => {
    const many = Array.from({ length: 200 }, (_, i) => J(`J${i}`, i, 0)).join("\n");
    const p = parseTruss(many + "\nmember J0 J1");
    const r = within(2000, () => analyzeTruss(p.input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Too many joints/);
  });

  test("a fully connected graph hits the member cap instead of grinding", () => {
    const lines: string[] = [];
    const n = 40;
    for (let i = 0; i < n; i++) lines.push(J(`J${i}`, i, (i * i) % 7));
    for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) lines.push(`member J${i} J${k}`);
    const p = parseTruss(lines.join("\n"));
    const r = within(2000, () => analyzeTruss(p.input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Too many members/);
  });

  test("collinear members at a joint are caught as a critical form, not solved", () => {
    // Three joints on a line cannot carry a transverse load: the geometry is
    // singular however the member count works out.
    const p = parseTruss(
      ["joint A 0 0", "joint B 1 0", "joint C 2 0", "member A B", "member B C", "support A pin", "support C pin", "load B 0 -10"].join(
        "\n",
      ),
    );
    const r = within(500, () => analyzeTruss(p.input));
    expect(r.ok).toBe(false);
  });

  test("enormous and microscopic coordinates do not hang the exact solver", () => {
    for (const s of ["1000000000000", "0.000000000001", "1e12", "1e-12"]) {
      const p = parseTruss(
        [`joint A 0 0`, `joint B ${s} 0`, `joint C ${s} ${s}`, "member A B", "member A C", "member B C", "support A pin", "support B roller", "load C 0 -12"].join(
          "\n",
        ),
      );
      if (p.errors.length) continue;
      const r = within(2000, () => analyzeTruss(p.input));
      if (r.ok) expect(allFinite(r.reactions.map((x) => x.value))).toEqual([]);
    }
  });

  // ratSqrt runs Newton's method on BigInt. A coordinate with hundreds of digits
  // makes those integers enormous; the loop must still terminate.
  test("a coordinate with a hundred digits terminates", () => {
    const big = "9".repeat(100);
    const p = parseTruss(
      [`joint A 0 0`, `joint B ${big} 0`, `joint C 1 1`, "member A B", "member A C", "member B C", "support A pin", "support B roller", "load C 0 -12"].join(
        "\n",
      ),
    );
    if (!p.errors.length) {
      within(3000, () => analyzeTruss(p.input));
    }
  });

  test("the parser never throws, whatever it is fed", () => {
    const junk = [
      "",
      "\n\n\n",
      "joint",
      "joint A",
      "joint A 0",
      "joint A 0 0 0 0",
      "member",
      "support",
      "load",
      "joint A NaN NaN",
      "joint A Infinity 0",
      "joint A 1/0 0",
      "joint A . 0",
      "joint A -- 0",
      "member A A",
      "\u0000\u0008\u001b",
      "joint A 0 0\r\njoint B 1 1\r\n",
      "#".repeat(10000),
      "joint A 1e999 0",
      "j".repeat(100000),
    ];
    for (const t of junk) {
      const p = within(1000, () => parseTruss(t));
      expect(Array.isArray(p.errors)).toBe(true);
      // Whatever it parsed must be safe to hand to the solver.
      within(1000, () => analyzeTruss(p.input));
    }
  });

  test("a load on a joint with no members is a mechanism, not a crash", () => {
    const p = parseTruss(
      ["joint A 0 0", "joint B 1 0", "joint C 5 5", "member A B", "support A pin", "support B roller", "load C 0 -10"].join("\n"),
    );
    const r = analyzeTruss(p.input);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("pipe flow: the iteration is bounded and the regimes are honest", () => {
  // Colebrook is the only iterative solve in the Engineering section. It is the
  // one place a task pane can be frozen by an unlucky number.
  test("colebrook terminates across ten decades of Re and roughness", () => {
    within(3000, () => {
      for (let e = 1; e <= 12; e++) {
        for (let rel = 0; rel <= 0.2; rel += 0.01) {
          const f = colebrook(Math.pow(10, e), rel);
          if (f !== null) {
            expect(Number.isFinite(f)).toBe(true);
            expect(f).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  test("colebrook returns null rather than a last iterate for absurd arguments", () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(colebrook(bad, 1e-4)).toBeNull();
    }
    for (const bad of [-1, NaN, Infinity]) {
      expect(colebrook(1e5, bad)).toBeNull();
    }
  });

  test("every non-finite pipe argument is refused", () => {
    const base = { D: 0.1, L: 100, V: 2, eps: 4.5e-5, rho: 998, mu: 1e-3 };
    for (const k of ["D", "L", "eps", "rho", "mu"] as const) {
      for (const v of HOSTILE) {
        expect(analyzePipe({ ...base, [k]: v }).ok).toBe(false);
      }
    }
    // A non-finite velocity must not be silently treated as "not supplied".
    for (const v of HOSTILE) {
      const r = analyzePipe({ ...base, V: v });
      if (r.ok) expect(allFinite(r)).toEqual([]);
    }
  });

  test("extreme but legal pipes stay finite or refuse", () => {
    const base = { L: 100, eps: 4.5e-5, rho: 998, mu: 1e-3 };
    for (const D of [1e-9, 1e-3, 1, 1e3, 1e6]) {
      for (const V of [1e-9, 1e-3, 1, 1e3, 1e6]) {
        const r = within(50, () => analyzePipe({ ...base, D, V }));
        if (r.ok) {
          expect(allFinite({ ...r, f: 0 })).toEqual([]);
          expect(r.hTotal).toBeGreaterThanOrEqual(0);
          expect(r.Re).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test("regime boundaries are continuous enough not to jump an order of magnitude", () => {
    // Crossing Re = 4000 must not change the head loss by a factor of ten; if it
    // does, the transition report is hiding a discontinuity rather than a band.
    const at = (Re: number) => {
      const D = 0.1,
        rho = 998,
        mu = 1e-3;
      const V = (Re * mu) / (rho * D);
      const r = analyzePipe({ D, L: 100, V, eps: 4.5e-5, rho, mu });
      return r.ok ? r.f : NaN;
    };
    const below = at(3999);
    const above = at(4001);
    expect(Number.isFinite(below)).toBe(true);
    expect(Number.isFinite(above)).toBe(true);
    expect(Math.abs(below - above) / above).toBeLessThan(0.05);
  });

  test("water properties refuse every out-of-range and non-finite temperature", () => {
    for (const t of [...HOSTILE, -1, -1e9, 100.001, 1e9]) {
      expect(waterProperties(t)).toBeNull();
    }
    for (let t = 0; t <= 100; t += 0.5) {
      const w = waterProperties(t);
      expect(w).not.toBeNull();
      expect(allFinite(w)).toEqual([]);
      expect((w as { rho: number }).rho).toBeGreaterThan(900);
      expect((w as { mu: number }).mu).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe("heat transfer: degenerate walls and impossible exchangers", () => {
  const layer = (k: number, t: number) => ({ name: "L", k, t });

  test("every non-finite wall argument is refused", () => {
    const base = {
      geometry: "plane" as const,
      layers: [layer(1, 0.1)],
      A: 1,
      hIn: 10,
      hOut: 25,
      tIn: 20,
      tOut: 0,
    };
    for (const k of ["hIn", "hOut", "tIn", "tOut", "A"] as const) {
      for (const v of HOSTILE) {
        expect(analyzeWall({ ...base, [k]: v }).ok).toBe(false);
      }
    }
    for (const v of HOSTILE) {
      expect(analyzeWall({ ...base, layers: [layer(v, 0.1)] }).ok).toBe(false);
      expect(analyzeWall({ ...base, layers: [layer(1, v)] }).ok).toBe(false);
    }
  });

  test("a superinsulator and a superconductor both stay finite", () => {
    for (const k of [1e-12, 1e-6, 1e6, 1e12]) {
      const r = within(20, () =>
        analyzeWall({
          geometry: "plane",
          layers: [layer(k, 0.1)],
          A: 1,
          hIn: 10,
          hOut: 25,
          tIn: 20,
          tOut: 0,
        }),
      );
      if (r.ok) {
        expect(allFinite(r)).toEqual([]);
        // Interface temperatures must stay inside the two fluid temperatures.
        for (const s of r.steps) {
          expect(s.tAfter).toBeLessThanOrEqual(20 + 1e-6);
          expect(s.tAfter).toBeGreaterThanOrEqual(0 - 1e-6);
        }
      }
    }
  });

  test("both film coefficients zero does not divide by zero", () => {
    const r = analyzeWall({
      geometry: "plane",
      layers: [layer(1, 0.1)],
      A: 1,
      hIn: 0,
      hOut: 0,
      tIn: 20,
      tOut: 0,
    });
    if (r.ok) expect(allFinite(r)).toEqual([]);
  });

  test("the layer cap is enforced", () => {
    const many = Array.from({ length: 100 }, () => layer(1, 0.01));
    const r = analyzeWall({
      geometry: "plane",
      layers: many,
      A: 1,
      hIn: 10,
      hOut: 25,
      tIn: 20,
      tOut: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Too many layers/);
  });

  test("a cylinder with a hair-thin layer and a huge radius stays finite", () => {
    for (const [r1, t] of [
      [1e-9, 1e-12],
      [1e6, 1e-9],
      [1e-6, 1e6],
    ]) {
      const r = within(20, () =>
        analyzeWall({
          geometry: "cylinder",
          layers: [layer(0.04, t)],
          r1,
          L: 1,
          hIn: 10,
          hOut: 25,
          tIn: 100,
          tOut: 20,
        }),
      );
      if (r.ok) expect(allFinite(r)).toEqual([]);
    }
  });

  test("every non-finite exchanger argument is refused", () => {
    const base = {
      flow: "counter" as const,
      thIn: 150,
      thOut: 90,
      tcIn: 30,
      tcOut: 70,
      U: 500,
      A: 10,
    };
    for (const k of ["thIn", "thOut", "tcIn", "tcOut", "U"] as const) {
      for (const v of HOSTILE) {
        expect(analyzeExchanger({ ...base, [k]: v }).ok).toBe(false);
      }
    }
  });

  test("terminal differences spanning many decades keep LMTD between them", () => {
    for (let e = 0; e <= 12; e++) {
      const dt2 = Math.pow(10, -e / 2);
      const r = analyzeExchanger({
        flow: "counter",
        thIn: 1000,
        thOut: 500,
        tcIn: 500 - dt2,
        tcOut: 900,
        U: 500,
        A: 10,
      });
      if (!r.ok) continue;
      expect(Number.isFinite(r.lmtd)).toBe(true);
      expect(r.lmtd).toBeGreaterThan(0);
      expect(r.lmtd).toBeLessThanOrEqual(Math.max(r.dt1, r.dt2) * (1 + 1e-9));
      expect(r.lmtd).toBeGreaterThanOrEqual(Math.min(r.dt1, r.dt2) * (1 - 1e-9));
      expect(allFinite(r)).toEqual([]);
    }
  });

  test("second-law violations are refused for every arrangement", () => {
    for (const flow of ["counter", "parallel"] as const) {
      // Cold outlet above the hot inlet.
      expect(analyzeExchanger({ flow, thIn: 100, thOut: 90, tcIn: 30, tcOut: 150, U: 1, A: 1 }).ok).toBe(false);
      // Hot stream heating up.
      expect(analyzeExchanger({ flow, thIn: 100, thOut: 110, tcIn: 30, tcOut: 50, U: 1, A: 1 }).ok).toBe(false);
      // Cold stream cooling down.
      expect(analyzeExchanger({ flow, thIn: 100, thOut: 90, tcIn: 50, tcOut: 30, U: 1, A: 1 }).ok).toBe(false);
    }
  });

  test("an isothermal exchanger does not silently return an infinite area", () => {
    // Both streams at the same temperature: no driving force, no finite area.
    const r = analyzeExchanger({
      flow: "counter",
      thIn: 50,
      thOut: 50,
      tcIn: 50,
      tcOut: 50,
      U: 500,
      Q: 1000,
    });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The eaten-backslash lesson: source written through a shell can pick up a
// literal control character where an escape was meant, and the result compiles,
// lints clean, and can never match.
describe("no literal control characters reached the engine sources", () => {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  test.each(["stress.ts", "truss.ts", "fluids.ts", "heat.ts"])("%s is clean", (file) => {
    const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const bad = [...src].filter((c) => {
      const code = c.charCodeAt(0);
      return code < 32 && c !== "\n" && c !== "\r" && c !== "\t";
    });
    expect(bad.map((c) => c.charCodeAt(0))).toEqual([]);
  });
});
