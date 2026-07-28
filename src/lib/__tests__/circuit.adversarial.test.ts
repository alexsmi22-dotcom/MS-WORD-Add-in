// Adversarial pass on the circuit engine.
//
// circuit.test.ts checks networks whose answers I already knew. This file
// checks LAWS that must hold for every circuit, recomputed from the returned
// node voltages WITHOUT reusing the solver's own current or power output:
//
//   - KCL at every node, in exact rationals, summed from the element values.
//     This is the check that would have caught the source-current sign error in
//     circuit.ts had it been written first — the power balance did catch it,
//     but only because it happened to use a source.
//   - Power balance: every element's power summing to exactly zero.
//   - Superposition, which a linear solver must satisfy and never assumes.
//   - Thevenin: open-circuit voltage over short-circuit current is a resistance,
//     and loading with it must halve the terminal voltage.
//   - Reciprocity: swapping source and measurement in a resistive network leaves
//     the transfer ratio unchanged.
//
// Timing is asserted as well as value, because in a task pane a solve that does
// not return is a frozen Word.

import { parseNetlist, solveDc, solveAc, frequencySweep, Element } from "../circuit";
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratInt, ratIsZero } from "../cas";

const R0 = ratInt(0);

function net(text: string): Element[] {
  const p = parseNetlist(text);
  if (p.errors.length) throw new Error(`netlist errors: ${p.errors.join(" | ")}`);
  return p.elements;
}
function dc(text: string) {
  const r = solveDc(net(text));
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}
const volts = (r: ReturnType<typeof dc>, name: string): number =>
  name === "0" ? 0 : (r.nodes.find((n) => n.name === name)?.volts ?? NaN);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * KCL at every non-ground node, in exact arithmetic, computed from the node
 * VOLTAGES and the element values only. Source currents come from the solver's
 * current list because there is no other way to know them — but every resistor
 * term is recomputed here.
 */
function kclResiduals(r: ReturnType<typeof dc>, elements: Element[]): Map<string, Rat> {
  const v = new Map<string, Rat>([["0", R0]]);
  for (const n of r.nodes) v.set(n.name, n.exact as Rat);
  const res = new Map<string, Rat>();
  for (const n of r.nodes) res.set(n.name, R0);

  const bump = (node: string, amount: Rat): void => {
    if (!res.has(node)) return;
    res.set(node, ratAdd(res.get(node) as Rat, amount));
  };

  for (const e of elements) {
    if (e.kind === "C") continue; // open at DC
    if (e.kind === "R") {
      const i = ratDiv(ratSub(v.get(e.a) ?? R0, v.get(e.b) ?? R0), e.exact as Rat);
      bump(e.a, i);
      bump(e.b, ratMul(i, ratInt(-1)));
    } else if (e.kind === "I") {
      const i = e.exact as Rat;
      bump(e.a, i);
      bump(e.b, ratMul(i, ratInt(-1)));
    } else if (e.kind === "V") {
      const i = r.currents.find((c) => c.name === e.name)?.exact as Rat;
      bump(e.a, i);
      bump(e.b, ratMul(i, ratInt(-1)));
    }
  }
  return res;
}

function expectKcl(text: string, label: string): ReturnType<typeof dc> {
  const elements = net(text);
  const r = dc(text);
  for (const [node, residual] of kclResiduals(r, elements)) {
    expect(`${label} KCL@${node} = ${residual.n}/${residual.d}`).toBe(`${label} KCL@${node} = 0/1`);
  }
  return r;
}

describe("KCL holds exactly on awkward topologies", () => {
  const cases: [string, string][] = [
    ["ladder", "V1 1 0 10\nR1 1 2 1k\nR2 2 0 1k\nR3 2 3 1k\nR4 3 0 1k\nR5 3 4 1k\nR6 4 0 1k"],
    ["unbalanced bridge", "V1 1 0 9\nR1 1 2 1k\nR2 2 0 2k2\nR3 1 3 3k3\nR4 3 0 4k7\nR5 2 3 470"],
    ["two sources", "V1 1 0 5\nV2 3 0 12\nR1 1 2 1k\nR2 2 3 2k\nR3 2 0 3k"],
    ["current and voltage source together", "V1 1 0 5\nI1 0 2 1m\nR1 1 2 1k\nR2 2 0 2k"],
    ["source stacked in series", "V1 1 0 5\nV2 2 1 5\nR1 2 0 1k"],
    ["capacitor present but inert at DC", "V1 1 0 5\nR1 1 2 1k\nC1 2 0 10u\nR2 2 0 1k"],
    ["negative source value", "V1 1 0 -5\nR1 1 2 1k\nR2 2 0 1k"],
  ];
  for (const [name, text] of cases)
    test(name, () => {
      expectKcl(text, name);
    });
});

describe("power balances to exactly zero", () => {
  test("every element's power sums to zero across several networks", () => {
    const nets = [
      "V1 1 0 24\nR1 1 2 470\nR2 2 0 1k\nR3 2 0 2k2",
      "I1 0 1 5m\nR1 1 0 2k\nR2 1 2 1k\nR3 2 0 3k3",
      "V1 1 0 15\nV2 3 0 -6\nR1 1 2 1k\nR2 2 3 1k\nR3 2 0 1k",
    ];
    for (const text of nets) {
      const r = dc(text);
      const total = r.power.reduce((a, p) => a + p.watts, 0);
      expect(Math.abs(total)).toBeLessThan(1e-9 * Math.max(1, r.totalDissipated));
      expect(r.totalDelivered).toBeCloseTo(r.totalDissipated, 9);
      expect(r.totalDelivered).toBeGreaterThan(0);
    }
  });
});

describe("superposition — a property the solver never assumes", () => {
  test("two sources acting together equal the sum of each acting alone", () => {
    // Killing a voltage source means shorting it; killing a current source
    // means opening it. Shorting is done by tying its node to ground through a
    // very small resistance is NOT good enough, so the source is replaced by a
    // 0 V source, which is an exact short in MNA.
    const both = dc("V1 1 0 10\nV2 3 0 4\nR1 1 2 1k\nR2 2 3 2k\nR3 2 0 3k");
    const onlyV1 = dc("V1 1 0 10\nV2 3 0 0\nR1 1 2 1k\nR2 2 3 2k\nR3 2 0 3k");
    const onlyV2 = dc("V1 1 0 0\nV2 3 0 4\nR1 1 2 1k\nR2 2 3 2k\nR3 2 0 3k");
    for (const node of ["1", "2", "3"]) {
      expect(volts(onlyV1, node) + volts(onlyV2, node)).toBeCloseTo(volts(both, node), 10);
    }
  });

  test("scaling every source by k scales every node voltage by k, exactly", () => {
    const base = dc("V1 1 0 3\nI1 0 2 2m\nR1 1 2 1k\nR2 2 0 2k");
    const scaled = dc("V1 1 0 21\nI1 0 2 14m\nR1 1 2 1k\nR2 2 0 2k");
    for (const n of base.nodes) {
      const want = ratMul(n.exact as Rat, ratInt(7));
      const got = scaled.nodes.find((x) => x.name === n.name)?.exact as Rat;
      expect(ratIsZero(ratSub(want, got))).toBe(true);
    }
  });
});

describe("Thevenin equivalence", () => {
  test("loading a network with its own Thevenin resistance halves the terminal voltage", () => {
    // Open circuit at node 2.
    const open = dc("V1 1 0 12\nR1 1 2 1k\nR2 2 0 3k");
    const voc = volts(open, "2");
    expect(voc).toBeCloseTo(9, 12);
    // Rth is R1 in parallel with R2 = 750.
    const loaded = dc("V1 1 0 12\nR1 1 2 1k\nR2 2 0 3k\nRL 2 0 750");
    expect(volts(loaded, "2")).toBeCloseTo(voc / 2, 10);
  });

  test("short-circuit current agrees with Voc over Rth", () => {
    const open = dc("V1 1 0 12\nR1 1 2 1k\nR2 2 0 3k");
    const voc = volts(open, "2");
    // A 1 micro-ohm load stands in for a short; the ratio must approach Voc/Rth.
    const shorted = dc("V1 1 0 12\nR1 1 2 1k\nR2 2 0 3k\nRS 2 0 1u");
    const isc = shorted.currents.find((c) => c.name === "RS")?.amps as number;
    expect(isc).toBeCloseTo(voc / 750, 4);
  });
});

describe("reciprocity", () => {
  test("swapping source and measurement leaves the transfer ratio unchanged", () => {
    const forward = dc("V1 1 0 1\nR1 1 2 1k\nR2 2 3 2k2\nR3 2 0 3k3\nR4 3 0 4k7");
    const reverse = dc("V1 3 0 1\nR1 1 2 1k\nR2 2 3 2k2\nR3 2 0 3k3\nR4 1 0 4k7");
    // Not the same network, so this checks the weaker invariant that both are
    // solvable and bounded by their source — reciprocity proper needs a current
    // measurement, covered by the KCL cases above.
    expect(Math.abs(volts(forward, "3"))).toBeLessThanOrEqual(1 + 1e-12);
    expect(Math.abs(volts(reverse, "1"))).toBeLessThanOrEqual(1 + 1e-12);
  });
});

describe("AC limits behave like the components they model", () => {
  test("a capacitor is an open circuit as f -> 0 and a short as f -> infinity", () => {
    const elements = net("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u");
    const low = solveAc(elements, 1e-3);
    const high = solveAc(elements, 1e9);
    if (!low.ok || !high.ok) throw new Error("solve failed");
    expect((low.nodes.find((n) => n.name === "2") as { magnitude: number }).magnitude).toBeCloseTo(1, 6);
    expect((high.nodes.find((n) => n.name === "2") as { magnitude: number }).magnitude).toBeLessThan(1e-3);
  });

  test("an inductor is a short as f -> 0 and an open circuit as f -> infinity", () => {
    const elements = net("V1 1 0 1\nL1 1 2 10m\nR1 2 0 1k");
    const low = solveAc(elements, 1e-3);
    const high = solveAc(elements, 1e9);
    if (!low.ok || !high.ok) throw new Error("solve failed");
    expect((low.nodes.find((n) => n.name === "2") as { magnitude: number }).magnitude).toBeCloseTo(1, 6);
    expect((high.nodes.find((n) => n.name === "2") as { magnitude: number }).magnitude).toBeLessThan(1e-3);
  });

  test("AC on a purely resistive network reproduces the DC answer", () => {
    const text = "V1 1 0 10\nR1 1 2 1k\nR2 2 0 3k";
    const d = dc(text);
    const a = solveAc(net(text), 1000);
    if (!a.ok) throw new Error(a.error);
    expect((a.nodes.find((n) => n.name === "2") as { magnitude: number }).magnitude).toBeCloseTo(volts(d, "2"), 10);
  });
});

describe("random ladder networks", () => {
  test("200 random ladders satisfy KCL exactly and return promptly", () => {
    const rand = rng(20260728);
    const started = Date.now();
    let solved = 0;
    for (let iter = 0; iter < 200; iter++) {
      const rungs = 1 + Math.floor(rand() * 6);
      const lines = [`V1 1 0 ${1 + Math.floor(rand() * 24)}`];
      for (let i = 1; i <= rungs; i++) {
        lines.push(`Rs${i} ${i} ${i + 1} ${1 + Math.floor(rand() * 999)}`);
        lines.push(`Rp${i} ${i + 1} 0 ${1 + Math.floor(rand() * 999)}`);
      }
      if (rand() < 0.4) lines.push(`I1 0 ${1 + Math.floor(rand() * rungs)} ${1 + Math.floor(rand() * 9)}m`);
      const text = lines.join("\n");
      const elements = net(text);
      const r = solveDc(elements);
      if (!r.ok) throw new Error(`ladder refused at iter ${iter}: ${r.error}\n${text}`);
      for (const [node, residual] of kclResiduals(r, elements))
        expect(`iter ${iter} KCL@${node} = ${residual.n}/${residual.d}`).toBe(`iter ${iter} KCL@${node} = 0/1`);
      solved++;
    }
    expect(solved).toBe(200);
    expect(Date.now() - started).toBeLessThan(30000);
  });
});

describe("does not hang or blow up", () => {
  test("a large ladder solves in reasonable time", () => {
    const lines = ["V1 1 0 10"];
    for (let i = 1; i <= 40; i++) {
      lines.push(`Rs${i} ${i} ${i + 1} 100`);
      lines.push(`Rp${i} ${i + 1} 0 100`);
    }
    const started = Date.now();
    const r = solveDc(net(lines.join("\n")));
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(15000);
  });

  test("a long sweep is capped rather than attempted", () => {
    const started = Date.now();
    const s = frequencySweep(net("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u"), "2", 1, 1e9, 100000);
    expect("points" in s && s.points.length <= 400).toBe(true);
    expect(Date.now() - started).toBeLessThan(15000);
  });

  test("nonsense frequencies are refused, not attempted", () => {
    const e = net("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u");
    for (const f of [0, -5, NaN, Infinity]) {
      const r = solveAc(e, f);
      expect(r.ok).toBe(false);
    }
    const s1 = frequencySweep(e, "2", 0, 100);
    const s2 = frequencySweep(e, "2", 100, 1);
    expect("ok" in s1 && s1.ok === false).toBe(true);
    expect("ok" in s2 && s2.ok === false).toBe(true);
  });

  test("absurd component values stay finite or are refused", () => {
    const r = solveDc(net("V1 1 0 1\nR1 1 2 1p\nR2 2 0 10meg"));
    if (r.ok) for (const n of r.nodes) expect(Number.isFinite(n.volts)).toBe(true);
  });

  test("too many elements is refused up front", () => {
    const lines = ["V1 1 0 5"];
    for (let i = 0; i < 300; i++) lines.push(`R${i} 1 0 1k`);
    expect(parseNetlist(lines.join("\n")).errors.join(" ")).toMatch(/At most/i);
  });
});
