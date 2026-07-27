// Spectral sequences (A2) and stable homotopy (A3) — the two entries the
// design brief deliberately held back, now built to exactly the scope it set.
//
// A2 — SPECTRAL SEQUENCES. The E₂ page of a Serre spectral sequence for a
// fibration F → E → B is E₂^{p,q} = H_p(B; H_q(F)), and with field or
// torsion-free coefficients that is a product of the two homologies. THAT is
// computable, and displaying it is genuinely useful.
//
// THE DIFFERENTIALS ARE NOT. d_r maps E_r^{p,q} → E_r^{p−r, q+r−1}, and which
// map it is is NOT determined by the E₂ page: two different fibrations can
// share an E₂ page and differ in d₂. Neither is the extension problem at the
// abutment — knowing the associated graded of H_n(E) does not determine H_n(E).
//
// So this module computes and shows E₂, MARKS every differential that could be
// nonzero as undetermined, and REFUSES to hand over a computed H*(E). Where the
// page is concentrated so that no differential can be nonzero — every d_r has a
// zero source or a zero target — it says the sequence COLLAPSES, and only then
// is the abutment read off, with the extension problem still flagged.
//
// A3 — STABLE HOMOTOPY GROUPS OF SPHERES. Not computable here at any scale.
// πₙˢ is known only in a finite range and that range is the product of decades
// of work. What follows is a CITED TABLE, labelled as such, with its range
// stated and its source named — held to the same standard as the NMR
// predictions, which say what they are.

export interface E2Cell {
  p: number;
  q: number;
  /** The group at this spot, e.g. "Z", "Z^2", "Z/2", "0". */
  group: string;
  /** Whether the group is nonzero. */
  nonzero: boolean;
}

export interface Differential {
  r: number;
  from: { p: number; q: number };
  to: { p: number; q: number };
  status: "undetermined" | "necessarily zero";
  reason: string;
}

export interface SpectralResult {
  fibration: string;
  base: string;
  fibre: string;
  cells: E2Cell[];
  maxP: number;
  maxQ: number;
  differentials: Differential[];
  collapses: boolean;
  /** Only populated when the sequence provably collapses. */
  abutment?: string[];
  grid: string;
  steps: string[];
  caveats: string[];
}

/** Homology of the spaces this module knows, as group names per degree. */
const KNOWN_HOMOLOGY: Record<string, { name: string; h: string[] }> = {
  point: { name: "a point", h: ["Z"] },
  "s1": { name: "S^1", h: ["Z", "Z"] },
  "s2": { name: "S^2", h: ["Z", "0", "Z"] },
  "s3": { name: "S^3", h: ["Z", "0", "0", "Z"] },
  "s4": { name: "S^4", h: ["Z", "0", "0", "0", "Z"] },
  "s5": { name: "S^5", h: ["Z", "0", "0", "0", "0", "Z"] },
  torus: { name: "T^2", h: ["Z", "Z^2", "Z"] },
  "cp1": { name: "CP^1", h: ["Z", "0", "Z"] },
  "cp2": { name: "CP^2", h: ["Z", "0", "Z", "0", "Z"] },
  "cp3": { name: "CP^3", h: ["Z", "0", "Z", "0", "Z", "0", "Z"] },
  rp2: { name: "RP^2", h: ["Z", "Z/2", "0"] },
  klein: { name: "Klein bottle", h: ["Z", "Z + Z/2", "0"] },
};

/** Tensor of two group names, for the E₂ = H_p(B) ⊗ H_q(F) entries. */
function tensor(a: string, b: string): string {
  if (a === "0" || b === "0") return "0";
  if (a === "Z") return b;
  if (b === "Z") return a;
  const rk = (s: string): number | null => {
    if (s === "Z") return 1;
    const m = /^Z\^(\d+)$/.exec(s);
    return m ? Number(m[1]) : null;
  };
  const ra = rk(a), rb = rk(b);
  if (ra !== null && rb !== null) return ra * rb === 1 ? "Z" : `Z^${ra * rb}`;
  // Anything involving torsion is left as an explicit tensor rather than guessed.
  return `(${a}) ⊗ (${b})`;
}

/**
 * The E₂ page of the Serre spectral sequence of a fibration, with every
 * differential that could be nonzero marked UNDETERMINED.
 */
export function serreE2(baseKey: string, fibreKey: string): SpectralResult | null {
  const B = KNOWN_HOMOLOGY[baseKey.toLowerCase().replace(/[\s^]/g, "")];
  const F = KNOWN_HOMOLOGY[fibreKey.toLowerCase().replace(/[\s^]/g, "")];
  if (!B || !F) return null;

  const maxP = B.h.length - 1;
  const maxQ = F.h.length - 1;
  const cells: E2Cell[] = [];
  for (let q = 0; q <= maxQ; q++) {
    for (let p = 0; p <= maxP; p++) {
      const group = tensor(B.h[p], F.h[q]);
      cells.push({ p, q, group, nonzero: group !== "0" });
    }
  }
  const cellAt = (p: number, q: number): E2Cell | undefined =>
    cells.find((c) => c.p === p && c.q === q);

  // Every differential d_r: E^{p,q} → E^{p−r, q+r−1}, for r ≥ 2.
  const differentials: Differential[] = [];
  for (const c of cells) {
    if (!c.nonzero) continue;
    for (let r = 2; r <= Math.max(maxP, maxQ) + 1; r++) {
      const tp = c.p - r, tq = c.q + r - 1;
      if (tp < 0 || tq > maxQ) continue;
      const target = cellAt(tp, tq);
      if (!target || !target.nonzero) continue;
      differentials.push({
        r,
        from: { p: c.p, q: c.q },
        to: { p: tp, q: tq },
        status: "undetermined",
        reason:
          `Both E_${r}^{${c.p},${c.q}} = ${c.group} and E_${r}^{${tp},${tq}} = ${target.group} are nonzero, so d_${r} between them MAY be nonzero. Which map it is, is not determined by the E₂ page.`,
      });
    }
  }

  const collapses = differentials.length === 0;
  const steps: string[] = [
    `Fibration ${F.name} → E → ${B.name}.`,
    `E₂^{p,q} = H_p(${B.name}; H_q(${F.name})), which is the product of the two homologies here.`,
    `The page is ${maxP + 1} columns by ${maxQ + 1} rows.`,
  ];
  const caveats: string[] = [];

  let abutment: string[] | undefined;
  if (collapses) {
    steps.push(
      "EVERY possible differential has a zero source or a zero target, so the sequence COLLAPSES at E₂ — this is a proof, not an assumption."
    );
    // Read the abutment off the anti-diagonals.
    abutment = [];
    for (let n = 0; n <= maxP + maxQ; n++) {
      const parts: string[] = [];
      for (let p = 0; p <= maxP; p++) {
        const q = n - p;
        if (q < 0 || q > maxQ) continue;
        const c = cellAt(p, q);
        if (c && c.nonzero) parts.push(c.group);
      }
      abutment.push(`H_${n}(E) has associated graded ${parts.length ? parts.join(" + ") : "0"}`);
    }
    caveats.push(
      "Even with the sequence collapsed, this is the ASSOCIATED GRADED of H_n(E), not H_n(E) itself. The EXTENSION PROBLEM remains: knowing the graded pieces does not determine the group. Z/4 and Z/2 + Z/2 have the same associated graded."
    );
  } else {
    steps.push(
      `${differentials.length} differential${differentials.length === 1 ? " is" : "s are"} possibly nonzero, and NONE of them is determined by the E₂ page.`
    );
    caveats.push(
      "THE DIFFERENTIALS ARE NOT COMPUTED, and cannot be from this page alone: two different fibrations can share an E₂ page and differ in d₂. Anything claiming to hand you H*(E) from this data would be inventing it."
    );
    caveats.push(
      "So no abutment is reported. What is shown is exactly what is known — the E₂ page, and which differentials remain open."
    );
  }
  caveats.push(
    "Coefficients are taken to be untwisted: this assumes the base is simply connected, or at least that π₁ acts trivially on the fibre's homology. Otherwise the E₂ term uses local coefficients and is a different computation."
  );

  return {
    fibration: `${F.name} → E → ${B.name}`,
    base: B.name,
    fibre: F.name,
    cells, maxP, maxQ, differentials, collapses, abutment,
    grid: renderGrid(cells, maxP, maxQ, differentials),
    steps, caveats,
  };
}

/** The E₂ page as a text grid, q increasing upward as it is drawn by hand. */
function renderGrid(cells: E2Cell[], maxP: number, maxQ: number, diffs: Differential[]): string {
  const at = (p: number, q: number) => cells.find((c) => c.p === p && c.q === q)?.group ?? "0";
  const width = Math.max(6, ...cells.map((c) => c.group.length + 2));
  const lines: string[] = [];
  for (let q = maxQ; q >= 0; q--) {
    let row = `q=${q} |`;
    for (let p = 0; p <= maxP; p++) {
      const marked = diffs.some((d) => d.from.p === p && d.from.q === q);
      row += ` ${(at(p, q) + (marked ? "*" : "")).padEnd(width)}`;
    }
    lines.push(row);
  }
  lines.push("      " + "-".repeat((maxP + 1) * (width + 1)));
  let footer = "      ";
  for (let p = 0; p <= maxP; p++) footer += ` ${`p=${p}`.padEnd(width)}`;
  lines.push(footer);
  if (diffs.length) lines.push("  * = an UNDETERMINED differential leaves this entry.");
  return lines.join("\n");
}

/** Spaces this module can build a spectral sequence from. */
export const SPECTRAL_SPACES = Object.keys(KNOWN_HOMOLOGY);

// ---------------------------------------------------------------------------
// A3 — stable homotopy groups of spheres: A CITED TABLE, never a computation.
// ---------------------------------------------------------------------------

/**
 * πₙˢ for n = 0…19. These are LITERATURE VALUES, not computed here and not
 * computable here. Source: Hatcher, "Algebraic Topology", and the standard
 * tables reproduced from Toda's work and the Adams spectral sequence
 * literature. Reproduced to help a reader recognise a group, never to stand in
 * for a derivation.
 */
const STABLE_STEMS: Record<number, string> = {
  0: "Z",
  1: "Z/2",
  2: "Z/2",
  3: "Z/24",
  4: "0",
  5: "0",
  6: "Z/2",
  7: "Z/240",
  8: "Z/2 + Z/2",
  9: "Z/2 + Z/2 + Z/2",
  10: "Z/6",
  11: "Z/504",
  12: "0",
  13: "Z/3",
  14: "Z/2 + Z/2",
  15: "Z/480 + Z/2",
  16: "Z/2 + Z/2",
  17: "Z/2 + Z/2 + Z/2 + Z/2",
  18: "Z/8 + Z/2",
  19: "Z/264 + Z/2",
};

export interface StableStemResult {
  n: number;
  group: string;
  steps: string[];
  caveats: string[];
}

/** Looks up πₙˢ in the cited table. Null outside the tabulated range. */
export function stableStem(n: number): StableStemResult | null {
  if (!Number.isInteger(n) || n < 0) return null;
  const group = STABLE_STEMS[n];
  if (group === undefined) {
    return {
      n,
      group: "not tabulated here",
      steps: [
        `pi_${n}^s is outside the range this tool carries (0 to ${Math.max(...Object.keys(STABLE_STEMS).map(Number))}).`,
      ],
      caveats: [
        "NOT COMPUTED AND NOT COMPUTABLE HERE. Stable homotopy groups of spheres are known only in a finite range, and that range is the product of decades of work — the Adams spectral sequence, Toda brackets, and more recently motivic methods. Nothing in this tool derives them.",
        "The values it does carry are a CITED TABLE, reproduced from the standard literature (Hatcher, Algebraic Topology; Toda). Check a source before relying on one.",
      ],
    };
  }
  return {
    n,
    group,
    steps: [
      `pi_${n}^s = ${group}.`,
      "This is a LOOKUP from a published table, not a computation performed here.",
    ],
    caveats: [
      "NOT COMPUTED. Stable homotopy groups of spheres cannot be derived by this tool at any scale; they are known only in a finite range established over decades (Adams spectral sequence, Toda brackets, motivic methods).",
      "CITED from the standard literature (Hatcher, Algebraic Topology; Toda's tables). It is reproduced to help you recognise a group, not to stand in for a derivation — check a source before relying on it.",
      "The pattern has no known closed form, and whether the groups are eventually periodic in any useful sense is open. Do not extrapolate from these values.",
    ],
  };
}

export const STABLE_RANGE = { min: 0, max: Math.max(...Object.keys(STABLE_STEMS).map(Number)) };
