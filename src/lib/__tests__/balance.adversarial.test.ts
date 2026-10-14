// Adversarial pass over balance.ts. Every oracle here is computed by the TEST
// from compositions the test itself generated — never from the engine's own
// parser — so a reader bug cannot certify itself.

import { balanceReaction, balanceAsWritten, balanceText, parseSpecies, BalanceOk, BalanceResult, CAPS, chemistryKindFor } from "../balance";

function ok(r: BalanceResult): BalanceOk {
  if (!r.ok) throw new Error(`expected a balance, got ${r.kind}: ${r.message}`);
  return r;
}

// ---- a seeded PRNG (mulberry32) so failures reproduce
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Comp = Record<string, number>;
const ELEMENTS = ["H", "C", "N", "O", "S", "Fe", "Cl", "Na", "K", "Mn", "Cu", "P"];

function formulaOf(c: Comp): string {
  return Object.entries(c)
    .map(([k, v]) => (v === 1 ? k : `${k}${v}`))
    .join("");
}

/** Float rank (the test's own, independent of the engine's BigInt rref). */
function rank(m: number[][]): number {
  const a = m.map((r) => r.slice());
  let r = 0;
  const cols = a[0]?.length ?? 0;
  for (let c = 0; c < cols && r < a.length; c++) {
    let p = -1;
    let best = 1e-9;
    for (let i = r; i < a.length; i++) if (Math.abs(a[i][c]) > best) { best = Math.abs(a[i][c]); p = i; }
    if (p < 0) continue;
    [a[r], a[p]] = [a[p], a[r]];
    for (let i = 0; i < a.length; i++) {
      if (i === r) continue;
      const f = a[i][c] / a[r][c];
      for (let j = c; j < cols; j++) a[i][j] -= f * a[r][j];
    }
    r++;
  }
  return r;
}

function matrixOf(left: Comp[], right: Comp[], charges?: number[]): number[][] {
  const all = [...left, ...right];
  const els = [...new Set(all.flatMap((c) => Object.keys(c)))];
  const rows = els.map((e) => all.map((c, j) => (c[e] ?? 0) * (j < left.length ? 1 : -1)));
  if (charges) rows.push(charges.map((q, j) => q * (j < left.length ? 1 : -1)));
  return rows;
}

function conserves(left: Comp[], right: Comp[], coefs: number[]): boolean {
  const m = matrixOf(left, right);
  return m.every((row) => row.reduce((s, x, j) => s + x * coefs[j], 0) === 0);
}

function gcdAll(v: number[]): number {
  return v.reduce((a, c) => {
    let x = Math.abs(a);
    let y = Math.abs(c);
    while (y) [x, y] = [y, x % y];
    return x;
  }, 0);
}

function shuffle<T>(a: T[], r: () => number): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function randomComp(r: () => number): Comp {
  const k = 1 + Math.floor(r() * 3);
  const els = shuffle(ELEMENTS, r).slice(0, k);
  const c: Comp = {};
  for (const e of els) c[e] = 1 + Math.floor(r() * 4);
  return c;
}

/**
 * A reaction KNOWN to balance: random reactants with random coefficients, and
 * products made by splitting the total atom pool at random. `known` is a valid
 * positive balancing the test built itself.
 */
function knownReaction(r: () => number): { left: Comp[]; right: Comp[]; known: number[] } | null {
  const nl = 1 + Math.floor(r() * 3);
  const left = Array.from({ length: nl }, () => randomComp(r));
  const lc = left.map(() => 1 + Math.floor(r() * 4));
  const pool: Comp = {};
  left.forEach((c, j) => Object.entries(c).forEach(([e, v]) => (pool[e] = (pool[e] ?? 0) + v * lc[j])));
  const nr = 1 + Math.floor(r() * 3);
  const right: Comp[] = Array.from({ length: nr }, () => ({}));
  for (const [e, t] of Object.entries(pool)) {
    let rest = t;
    for (let k = 0; k < nr - 1; k++) {
      const take = Math.floor(r() * (rest + 1));
      if (take) right[k][e] = take;
      rest -= take;
    }
    if (rest) right[nr - 1][e] = rest;
  }
  if (right.some((c) => !Object.keys(c).length)) return null;
  return { left, right, known: [...lc, ...right.map(() => 1)] };
}

describe("random reactions: classification agrees with an independent rank; scrambles reproduce", () => {
  const r = rng(20261014);
  let uniqueSeen = 0;
  let multiSeen = 0;
  for (let trial = 0; trial < 300; trial++) {
    const made = trial % 3 === 0 ? null : knownReaction(r);
    const nl = made ? made.left.length : 1 + Math.floor(r() * 3);
    const nr = made ? made.right.length : 1 + Math.floor(r() * 3);
    const left = made ? made.left : Array.from({ length: nl }, () => randomComp(r));
    const right = made ? made.right : Array.from({ length: nr }, () => randomComp(r));
    // same composition twice (Mn4C4 vs C4Mn4) is its own test ("duplicate"/"both-sides")
    const keys = [...left, ...right].map((c) => Object.keys(c).sort().map((k) => `${k}${c[k]}`).join(""));
    if (new Set(keys).size !== keys.length) continue;
    const eq = `${left.map(formulaOf).join(" + ")} -> ${right.map(formulaOf).join(" + ")}`;
    const res = balanceReaction(eq);
    const nullity = nl + nr - rank(matrixOf(left, right));
    if (res.ok) uniqueSeen++;
    if (!res.ok && res.kind === "not-unique") multiSeen++;
    test(`#${trial} ${eq} (nullity ${nullity})`, () => {
      if (made) {
        // the test's own balancing exists, so the engine must not say "impossible"
        expect(conserves(left, right, made.known)).toBe(true);
        expect(nullity).toBeGreaterThanOrEqual(1);
        if (res.ok) {
          const g = gcdAll(made.known);
          expect(res.coefficients).toEqual(made.known.map((c) => c / g));
        } else {
          // a fully positive balancing exists, so no species can be "takes no part"
          expect(res.kind).toBe("not-unique");
          expect(nullity).toBeGreaterThanOrEqual(2);
        }
      }
      if (nullity === 0) {
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.kind).toBe("impossible");
        return;
      }
      if (res.ok) {
        // independent conservation, positivity and primitivity
        expect(conserves(left, right, res.coefficients)).toBe(true);
        expect(res.coefficients.every((c) => c > 0)).toBe(true);
        expect(gcdAll(res.coefficients)).toBe(1);
        // scramble: shuffle both sides AND swap them; must reproduce up to a positive multiple
        const idx = shuffle([...Array(nl + nr).keys()], r);
        const li = idx.filter((j) => j >= nl); // old right becomes left
        const ri = idx.filter((j) => j < nl);
        const all = [...left, ...right];
        const eq2 = `${li.map((j) => formulaOf(all[j])).join(" + ")} -> ${ri.map((j) => formulaOf(all[j])).join(" + ")}`;
        const res2 = ok(balanceReaction(eq2));
        const back = new Array(nl + nr).fill(0);
        [...li, ...ri].forEach((j, k) => (back[j] = res2.coefficients[k]));
        const ratio = back[0] / res.coefficients[0];
        back.forEach((c, j) => expect(c).toBeCloseTo(ratio * res.coefficients[j], 9));
        expect(ratio).toBeGreaterThan(0);
      } else {
        expect(["zero", "wrong-side", "not-unique", "impossible"]).toContain(res.kind);
        if (res.kind === "not-unique") {
          expect(nullity).toBeGreaterThanOrEqual(2);
          for (const b of res.basis ?? []) {
            expect(conserves(left, right, b.coefficients)).toBe(true);
            expect(b.coefficients.every((c) => c >= 0)).toBe(true);
          }
        }
      }
    });
  }
  test("the generator produced both unique and non-unique cases", () => {
    expect(uniqueSeen).toBeGreaterThan(20);
    expect(multiSeen).toBeGreaterThan(5);
  });
});

describe("2-D null spaces refuse by name", () => {
  test.each([
    ["C + O2 -> CO + CO2", 2],
    ["H2 + O2 -> H2O + H2O2", 2],
    ["Cu + HNO3 -> Cu(NO3)2 + NO + NO2 + H2O", 2],
    ["KMnO4 + H2O2 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O", 2],
    ["P + O2 -> P4O6 + P4O10", 2],
  ])("%s", (eq, rays) => {
    const r = balanceReaction(eq);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not-unique");
    expect(r.basis).toHaveLength(rays);
    expect(r.message).toMatch(/no single set of coefficients is THE answer/);
    for (const b of r.basis!) expect(ok(balanceAsWritten(b.equation)).coefficients).toEqual(b.coefficients.filter((c) => c > 0));
  });
  test("a non-unique reaction with the user's correct coefficients still refuses THE answer, saying it balances as written", () => {
    const r = balanceReaction("3 C + 2 O2 -> 2 CO + CO2");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not-unique");
    expect(r.asWritten?.balanced).toBe(true);
  });
});

describe("as written", () => {
  test("wrong typed coefficients: NOT balanced, names the element and both totals", () => {
    const r = ok(balanceReaction("4 Fe + 3 O2 -> Fe2O3"));
    expect(r.asWritten).toEqual({ balanced: false, message: "As written it is NOT balanced: Fe is 4 on the left and 2 on the right. The balanced equation is below." });
    expect(r.coefficients).toEqual([4, 3, 2]);
  });
  test("a non-primitive balance is said, and the smallest given", () => {
    const r = ok(balanceReaction("4 H2 + 2 O2 -> 4 H2O"));
    expect(r.coefficients).toEqual([2, 1, 2]);
    expect(r.asWritten?.message).toBe("As written it is balanced. The smallest whole-number coefficients are 2, 1, 2.");
  });
  test("charge failing as written is named as charge", () => {
    const r = ok(balanceReaction("Al + Cu^2+ -> Al^3+ + Cu"));
    expect(r.asWritten).toBeNull();
    const w = ok(balanceReaction("Al + 1 Cu^2+ -> Al^3+ + Cu"));
    expect(w.asWritten?.message).toMatch(/^As written it is NOT balanced: charge is \+2 on the left and \+3 on the right/);
  });
});

describe("refusals by name", () => {
  test("a species on both sides", () => {
    const r = balanceReaction("Na + H2O -> NaOH + H2 + H2O");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("both-sides");
      expect(r.message).toMatch(/^H₂O appears on both sides/);
    }
  });
  test("a phase change is NOT the same species", () => {
    expect(ok(balanceReaction("H2O(l) -> H2O(g)")).coefficients).toEqual([1, 1]);
  });
  test("an element on one side only", () => {
    const r = balanceReaction("Na + H2O -> H2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Na appears only on the left — no coefficients can conserve it.");
  });
  test("charge on one side only (needs electrons)", () => {
    const r = balanceReaction("Fe -> Fe^2+");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^Charge appears only on the right/);
    expect(ok(balanceReaction("Fe -> Fe^2+ + e-")).coefficients).toEqual([1, 1, 2]);
  });
  test("a species forced to the other side", () => {
    const r = balanceReaction("Na -> NaCl + Cl2");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("wrong-side");
      expect(r.message).toBe("This balances only with Cl₂ on the other side of the arrow.");
    }
  });
  test.each([
    ["H2 +O2 -> H2O", /Put spaces around/],
    ["H2+ O2 -> H2O", /Put spaces around/],
    ["Fe + O2 -> Fe2O3 -> X", /More than one reaction arrow/],
    ["Fe + O2", /No reaction arrow/],
    [" -> H2O", /left side of the arrow is empty/],
    ["MnO4--> MnO2", /is the first “-” a charge/],
    ["H2 + + O2 -> H2O", /Put spaces around|empty species/],
    ["Xx + O2 -> XxO", /“Xx” is not an element symbol/],
    ["Fe(OH -> Fe", /unclosed/],
    ["CuSO4·0H2O -> CuSO4", /coefficient of 0/],
    ["CuSO4· -> CuSO4", /empty hydrate part/],
    ["CuSO4.5.H2O -> CuSO4 + H2O", /ambiguous/],
    ["0 H2 + O2 -> H2O", /coefficient 0/],
    ["H0 -> H2", /subscript 0/],
  ])("%s", (eq, re) => {
    const r = balanceReaction(eq);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(re);
  });
});

describe("scale", () => {
  const els20 = ["H", "Li", "Be", "B", "C", "N", "O", "F", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "K", "Ca", "Ti", "V", "Cr"];
  /** A cycle: left e1e2, e3e4…; right e2e3, e4e5…, e_n e1 — nullity 1, every element once per side. */
  function cycle(n: number, sub: (i: number) => number): { eq: string; left: Comp[]; right: Comp[] } {
    const e = els20.slice(0, n);
    const left: Comp[] = [];
    const right: Comp[] = [];
    for (let i = 0; i < n; i += 2) left.push({ [e[i]]: sub(i), [e[i + 1]]: sub(i + 1) });
    for (let i = 1; i < n; i += 2) right.push({ [e[i]]: sub(i + 7), [e[(i + 1) % n]]: sub(i + 3) });
    const f = (c: Comp) => formulaOf(c);
    return { eq: `${left.map(f).join(" + ")} -> ${right.map(f).join(" + ")}`, left, right };
  }
  test("12 species, 12 elements, unique, conserved by the test's own count", () => {
    const { eq, left, right } = cycle(12, (i) => 1 + (i % 3));
    expect(rank(matrixOf(left, right))).toBe(11);
    const r = ok(balanceReaction(eq));
    expect(r.species).toHaveLength(12);
    expect(conserves(left, right, r.coefficients)).toBe(true);
    expect(gcdAll(r.coefficients)).toBe(1);
  });
  test("20 species at the cap: exact and fast", () => {
    const { eq, left, right } = cycle(20, (i) => 1 + ((i * 7) % 5));
    const t0 = Date.now();
    const r = ok(balanceReaction(eq));
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(conserves(left, right, r.coefficients)).toBe(true);
  });
  test("21 species: refused before any work", () => {
    const sp = Array.from({ length: 21 }, (_, i) => `H${i + 2}`);
    const r = balanceReaction(`${sp.slice(0, 10).join(" + ")} -> ${sp.slice(10).join(" + ")}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("cap");
  });
  test("input over 2,000 characters: refused", () => {
    const r = balanceReaction("H2 + O2 -> H2O" + " ".repeat(CAPS.inputChars));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("cap");
  });
  test("a coefficient above 10⁶ is refused, not printed", () => {
    const r = balanceReaction("H2000001 -> H2");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("cap");
      expect(r.message).toMatch(/above 10⁶/);
    }
    // just under the cap is fine and exact
    expect(ok(balanceReaction("H999999 -> H2")).coefficients).toEqual([2, 999999]);
  });
  test("big counts beyond 2⁵³ in intermediates stay exact (BigInt)", () => {
    const r = ok(balanceReaction("C997H1994 + O2 -> CO2 + H2O"));
    // H 1994 → 997 H₂O; O: 2·997 + 997 = 2991 = 2·O₂ → double everything
    expect(r.coefficients).toEqual([2, 2991, 1994, 1994]);
  });
  test("ray search cap: a 20-species, nullity-10 reaction refuses within 4 s", () => {
    // 10 elements, 20 species: pairs (e_i)(e_i)2 on each side → large null space.
    const e = els20.slice(0, 10);
    const left = e.map((x) => `${x}2`);
    const right = e.map((x) => `${x}3`);
    const t0 = Date.now();
    const r = balanceReaction(`${left.join(" + ")} -> ${right.join(" + ")}`);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("not-unique");
      expect(r.nullity).toBe(10);
      expect(r.basisNote).toMatch(/rref basis/);
    }
  });
  test("nullity 17 (C(20,16) = 4845 zero sets × 17²) exceeds the work cap: exact rref basis, fast", () => {
    // 20 species over H, C, N (rank 3) — every ray is checked exactly.
    const left = ["CH4", "C2H6", "C3H8", "NH3", "N2H4", "HCN", "C2N2", "CH3NH2", "C2H4", "C2H2"];
    const right = ["C4H10", "C6H6", "N2", "H2", "C", "C5H12", "C2H5NH2", "C3H6", "CH2N2", "C8H18"];
    const t0 = Date.now();
    const r = balanceReaction(`${left.join(" + ")} -> ${right.join(" + ")}`);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("not-unique");
      expect(r.nullity).toBe(17);
      expect(r.basisNote).toMatch(/rref basis/);
      expect(r.basis).toHaveLength(17);
      expect(r.message).toMatch(/^This reaction has 17 independent balancings/);
    }
  });
  test("many rays are capped at 10 shown, with the total said", () => {
    // nullity 3 over 9 species → C(9,2) = 36 zero sets; the cone can have more rays than its dimension
    const r = balanceReaction("CH4 + C2H6 + C3H8 + C4H10 + C5H12 -> C + H2 + C2H2 + C6H6");
    expect(r.ok).toBe(false);
    if (!r.ok && r.kind === "not-unique") {
      expect(r.basis!.length).toBeLessThanOrEqual(10);
      expect(r.message).toMatch(new RegExp(`^This reaction has ${r.nullity} independent balancings`));
    }
  });
  test("worst case under the ray cap: C(18,5) = 8,568 zero sets, well under 1 s", () => {
    // 12 elements, 12 diatomics (rank 12) + 6 mixed species → 18 species, nullity 6.
    const e = els20.slice(0, 12);
    const mixes = [0, 2, 4, 6, 8, 10].map((i) => `${e[i]}${e[i + 1]}`);
    const di = e.map((x) => `${x}2`);
    const eq = `${mixes.join(" + ")} -> ${di.join(" + ")}`;
    const t0 = Date.now();
    const r = balanceReaction(eq);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("not-unique");
      expect(r.nullity).toBe(6);
      expect(r.basis).toHaveLength(6); // each mixed species decomposes independently
    }
  });
  test("gross-freeze bound: deep brackets, long junk, many arrows — each under 4 s", () => {
    const inputs = [
      "(".repeat(900) + "H" + ")".repeat(900) + " -> H2",
      "H".repeat(1990) + " -> H2",
      "= ".repeat(900),
      "H2 + ".repeat(300) + "O2 -> H2O",
      "Fe" + "9".repeat(400) + " -> Fe",
    ];
    for (const s of inputs) {
      const t0 = Date.now();
      balanceReaction(s);
      expect(Date.now() - t0).toBeLessThan(4000);
    }
  });
});

describe("organic combustion CxHyOz: closed form", () => {
  const cases: Array<[number, number, number]> = [];
  for (let x = 1; x <= 12; x++) for (let y = 2; y <= 2 * x + 2; y += 2) for (let z = 0; z <= 6; z++) cases.push([x, y, z]);
  test("every CxHyOz with a positive O₂ demand", () => {
    let checked = 0;
    for (const [x, y, z] of cases) {
      // CxHyOz + (x + y/4 − z/2) O2 → x CO2 + (y/2) H2O, ×4 to clear fractions
      const o2x4 = 4 * x + y - 2 * z;
      if (o2x4 <= 0) continue;
      const v = [4, o2x4, 4 * x, 2 * y];
      const g = gcdAll(v);
      const expected = v.map((c) => c / g);
      const f = `C${x === 1 ? "" : x}H${y}${z ? (z === 1 ? "O" : `O${z}`) : ""}`;
      const r = ok(balanceReaction(`${f} + O2 -> CO2 + H2O`));
      expect([f, r.coefficients]).toEqual([f, expected]);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe("display contract: every §D1 ion through formatSpecies", () => {
  test.each(["MnO4^-", "Fe^2+", "H^+", "Mn^2+", "Fe^3+", "Cr2O7^2-", "e-", "Cr^3+", "OH-", "Cu^2+", "Al^3+", "Ag+", "Cl-", "[Fe(CN)6]4-", "Hg2^2+", "NH4+", "SO4^2-"])(
    "%s",
    (s) => {
      const p = parseSpecies(s);
      if (!p.ok) throw new Error(p.error);
      const d = p.species.display;
      expect(d).not.toMatch(/[\^+\-0-9]/); // no caret, no ASCII sign, no ASCII digit
      const q = parseSpecies(d);
      if (!q.ok) throw new Error(q.error);
      expect(q.species.charge).toBe(p.species.charge);
      expect(q.species.formula).toBe(p.species.formula);
    },
  );
});

describe("display contract in refusals and notes", () => {
  const inputs = [
    "SO42- -> SO3", "CaSO4.0.5H2O -> CaSO4", "CuSO4.x -> CuSO4", "MnO4--> MnO2", "H2+O2->H2O", "Fe + O2",
    "", "H2O -> H2O2", "H2 + O2 + N2 -> H2O", "C + O2 -> CO + CO2", "Na -> NaCl + Cl2", "Fe -> Fe^2+",
    "Na + H2O -> NaOH + H2 + H2O", "4 Fe + 3 O2 -> Fe2O3", "H2 + ½O2 -> H2O", "hydrogen + oxygen -> water",
    "C7H6O3 + C4H6O3 -> C9H8O4 + C2H4O2", "H2000001 -> H2", "e2- + Fe -> Fe",
  ];
  test.each(inputs)("%s", (s) => {
    const r = balanceReaction(s);
    const texts: string[] = r.ok ? [...r.notes, r.asWritten?.message ?? "", r.equation] : [r.message, r.asWritten?.message ?? "", ...(r.basis ?? []).map((b) => b.equation)];
    for (const t of texts) {
      const stripped = t.replace(/“[^”]*”/g, "“…”"); // the user's own text is quoted, not typeset
      expect(stripped).not.toMatch(/\^/);
      expect(stripped).not.toMatch(/(?:^|[^A-Za-z])(?:[A-Z][a-z]?)+\d/); // no ASCII count after an element symbol
      expect(stripped).not.toMatch(/->/);
    }
  });
});

describe("verb routing and the medium suffix", () => {
  test("with the verb, a failing species still routes to chemistry (named refusal)", () => {
    expect(chemistryKindFor("balance x -> y")).toBe("balance");
    const r = balanceText("balance x -> y");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/“x” is not a formula/);
    expect(chemistryKindFor("balance hydrogen + oxygen -> water")).toBe("balance");
    expect(ok(balanceText("balance hydrogen + oxygen -> water")).coefficients).toEqual([2, 1, 2]);
    expect(chemistryKindFor("balance the equation Fe + O2 -> Fe2O3")).toBe("balance");
    expect(ok(balanceText("balance the equation Fe + O2 -> Fe2O3")).coefficients).toEqual([4, 3, 2]);
    expect(chemistryKindFor("balance my budget")).toBeNull();
  });
  test("a product named “… acid” is not a medium", () => {
    expect(chemistryKindFor("balance SO3 + H2O -> sulfuric acid")).toBe("balance");
    expect(ok(balanceText("balance SO3 + H2O -> sulfuric acid")).coefficients).toEqual([1, 1, 1]);
    expect(chemistryKindFor("balance CH3CHO + O2 -> acetic acid")).toBe("balance");
    expect(chemistryKindFor("MnO4- -> Mn2+ in acid")).toBe("half-reaction");
    expect(chemistryKindFor("MnO4- -> MnO2 in basic solution")).toBe("half-reaction");
    expect(ok(balanceText("MnO4- -> MnO2, basic solution")).coefficients).toEqual([1, 2, 3, 1, 4]);
  });
  test("aspirin by formula: not unique, and the all-1 equation is said to be one valid balancing", () => {
    const r = balanceReaction("C7H6O3 + C4H6O3 -> C9H8O4 + C2H4O2");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("not-unique");
      expect(r.asWritten?.message).toBe("As written (all coefficients 1) it is one valid balancing — but not the only one.");
    }
  });
});

describe("independent review fixes (exact answers)", () => {
  test("H₂O₂ → O₂ half-reaction in acid: skeleton first, electrons fixed", () => {
    const r = ok(balanceText("half-reaction H2O2 -> O2 in acid"));
    expect(r.equation).toBe("H₂O₂ → O₂ + 2 H⁺ + 2 e⁻");
    expect(r.halfReaction?.summary).toBe("Oxidation (loses 2 e⁻).");
  });
  test("MnO₄⁻ / H₂O₂ pair in acid", () => {
    const r = ok(balanceText("balance in acid: MnO4- -> Mn2+; H2O2 -> O2"));
    expect(r.equation).toBe("2 MnO₄⁻ + 6 H⁺ + 5 H₂O₂ → 2 Mn²⁺ + 8 H₂O + 5 O₂");
  });
  test("homonuclear ions: I₃⁻, H₂⁻, H₂⁺; monatomic Fe³⁺, S²⁻ unchanged; O2-/N3- refused by name", () => {
    expect(ok(balanceReaction("I2 + I- -> I3-")).equation).toBe("I₂ + I⁻ → I₃⁻");
    expect(ok(balanceReaction("H2 + e- -> H2-")).equation).toBe("H₂ + e⁻ → H₂⁻");
    const h = parseSpecies("H2+");
    expect(h.ok && h.species.display).toBe("H₂⁺");
    const s = parseSpecies("S2-");
    expect(s.ok && s.species.display).toBe("S²⁻");
    const f = parseSpecies("Fe3+");
    expect(f.ok && f.species.display).toBe("Fe³⁺");
    const o = parseSpecies("O2-");
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error).toMatch(/oxide O²⁻ or superoxide O₂⁻/);
    const n = parseSpecies("N3-");
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.error).toMatch(/nitride N³⁻ or azide N₃⁻/);
    // the caret forms are never ambiguous
    expect(parseSpecies("O^2-").ok && parseSpecies("O2^-").ok).toBe(true);
  });
  test("Cu1.8S is a nonstoichiometric refusal, never a hydrate; CuSO4.5H2O keeps its reading", () => {
    const p = parseSpecies("Cu1.8S");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(/non-integer subscript/);
    expect(parseSpecies("Fe0.95O").ok).toBe(false);
    const c = parseSpecies("CuSO4.5H2O");
    expect(c.ok && c.species.display).toBe("CuSO₄·5H₂O");
  });
  test("an explicit count of 1 is not a formula: physics stays physics", () => {
    for (const s of ["P1V1 = P2V2", "C1V1 = C2V2", "V1 + V2 = V3", "V1 = V2"]) expect(chemistryKindFor(s)).toBeNull();
    expect(chemistryKindFor("S -> B\nB -> C")).toBeNull();
    expect(chemistryKindFor("MnO4- -> Mn2+\nFe2+ -> Fe3+ in acid")).toBe("half-reaction");
  });
  test("locant names and duplicates", () => {
    const p = parseSpecies("1-butanol");
    expect(p.ok && p.species.hillDisplay).toBe("C₄H₁₀O");
    const r = ok(balanceReaction("1-butanol + O2 -> CO2 + H2O"));
    expect(r.coefficients).toEqual([1, 6, 4, 5]);
    expect(ok(balanceReaction(r.equation)).coefficients).toEqual([1, 6, 4, 5]);
    const d = balanceReaction("H2 + H2 + O2 -> H2O");
    expect(d.ok === false && d.kind).toBe("duplicate");
  });
});

describe("Solve steal surface", () => {
  test.each([
    "x + y = 5", "a + b -> c", "e = mc^2", "E = mc^2", "F = ma", "V = IR", "P = IV", "pH = 7",
    "y = 2x + 1", "I + V = R", "K = C + 273", "n -> infinity", "sum -> 0", "e -> 0",
    "H2O", "2 + 2 = 4", "C + H = CH", "B + C = BC",
  ])("%s is not chemistry", (s) => expect(chemistryKindFor(s)).toBeNull());
  test.each(["H2 + O2 -> H2O", "Na + Cl2 = NaCl", "CuSO4·5H2O -> CuSO4 + H2O", "Fe^3+ + e- -> Fe^2+"])("%s is chemistry", (s) =>
    expect(chemistryKindFor(s)).toBe("balance"),
  );
});
