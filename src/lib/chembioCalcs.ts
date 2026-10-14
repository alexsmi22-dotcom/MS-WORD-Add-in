// Pane glue for the v2.137.0 chemistry batch, kept OUT of taskpane.ts so it can
// be tested (nothing can import the pane under jest — memory: "taskpane parsers
// are untestable") and so the figure corpus draws exactly what the pane draws.
//
//   balanceReport   one BalanceResult → the lines, caveats and figure that Solve
//                   and Reaction mode (Formulas) both show and insert;
//   conservationSvg the element + charge conservation chart (paired bars, equal
//                   by construction — the picture of "it balances");
//   basisTableSvg   the "no unique balancing" refusal's independent reactions;
//   stoichCalc      the Bio/Assay "Reaction stoichiometry & yield" calculator:
//                   amount lines → stoich.ts → text + the available-vs-needed
//                   chart with the limiting reagent flagged.
//
// No chemistry is computed here: balance.ts and stoich.ts own every number.

import { BalanceOk, BalanceRefusal, BalanceResult, ratToNumber } from "./balance";
import { stoichiometry, StoichAmount, StoichOk } from "./stoich";
import { groupedBarSvg } from "./statchart";
import { PeptideReading } from "./peptide";
import { signedMass } from "./peptideMods";
import { EPSILON_280 } from "./assay";

/** The honest limit every balanced equation carries (SCOPE-CHEMBIO-BATCH §C). */
export const BALANCE_LIMIT_NOTE =
  "Mass and charge conservation only — this says nothing about whether the reaction happens, which products form, or its thermodynamics.";

export interface BalanceReport {
  ok: boolean;
  title: string;
  /** The balanced equation (typeset), or the refusal message. */
  headline: string;
  /** Supporting lines: half-reaction summary, as-written verdict, conservation rows, basis. */
  lines: string[];
  caveats: string[];
  svg: string | null;
  alt: string;
}

/** Paired left/right bars per element and for charge — equal by construction. */
export function conservationSvg(b: BalanceOk): string {
  const rows = b.conservation;
  return groupedBarSvg(
    rows.map((r) => (r.quantity === "charge" ? "charge" : r.quantity)),
    [
      { label: "left side", values: rows.map((r) => ratToNumber(r.left)) },
      { label: "right side", values: rows.map((r) => ratToNumber(r.right)) },
    ],
    { title: "Atoms and charge on each side", ylabel: "total" },
  );
}

/** The independent reactions of a "no unique balancing" refusal, as a table figure. */
export function basisTableSvg(r: BalanceRefusal): string | null {
  if (!r.basis || !r.basis.length) return null;
  // NOT the generic table figure: it wraps a long cell into a narrow column
  // and then TRUNCATES it ("… MnSO₄ + 5 O₂ …") — the layout gate caught it,
  // and a figure that drops species from an equation is a wrong figure. One
  // equation per line, the canvas sized from the longest one.
  const shown = r.basis.slice(0, 12);
  const lines = shown.map((x, i) => `${i + 1}.  ${x.equation}`);
  const title = `${r.basis.length} independent reactions — any positive combination balances`;
  const charW = 7.2;
  const longest = Math.max(title.length * 6.6, ...lines.map((l) => l.length * charW));
  const W = Math.ceil(Math.max(280, longest + 32));
  const H = 40 + lines.length * 24 + 10;
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<text x="${W / 2}" y="20" text-anchor="middle" font-family="Segoe UI, Arial" font-size="12" fill="#222">${esc(title)}</text>`,
    `<line x1="12" y1="30" x2="${W - 12}" y2="30" stroke="#c4c4c4" stroke-width="1"/>`,
  ];
  lines.forEach((l, i) => {
    parts.push(`<text x="16" y="${52 + i * 24}" font-family="Segoe UI, Arial" font-size="13" fill="#222">${esc(l)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}

/** One BalanceResult → what Solve and Reaction mode show and insert. */
export function balanceReport(r: BalanceResult): BalanceReport {
  if (!r.ok) {
    const lines: string[] = [];
    if (r.basis && r.basis.length) {
      r.basis.forEach((x, i) => lines.push(`${i + 1}. ${x.equation}`));
      if (r.basisNote) lines.push(r.basisNote);
    }
    if (r.asWritten && r.asWritten.message) lines.push(r.asWritten.message);
    const svg = r.kind === "not-unique" ? basisTableSvg(r) : null;
    return {
      ok: false,
      title: r.kind === "not-unique" ? "No unique balancing" : "Cannot balance",
      headline: r.message,
      lines,
      caveats: [],
      svg,
      alt: svg ? `Independent reactions: ${(r.basis ?? []).map((x) => x.equation).join("; ")}` : "",
    };
  }
  const lines: string[] = [];
  if (r.halfReaction) lines.push(r.halfReaction.summary);
  if (r.asWritten && r.asWritten.message) lines.push(r.asWritten.message);
  for (const c of r.conservation) {
    const name = c.quantity === "charge" ? "Charge" : c.quantity;
    lines.push(`${name}: ${c.leftText} on the left, ${c.rightText} on the right ${c.ok ? "✓" : "✗"}`);
  }
  return {
    ok: true,
    title: r.halfReaction ? "Balanced half-reaction" : "Balanced equation",
    headline: r.equation,
    lines,
    caveats: [...r.notes, BALANCE_LIMIT_NOTE],
    svg: conservationSvg(r),
    alt: `Balanced: ${r.equation}. Atoms and charge are equal on both sides.`,
  };
}

// ------------------------------------------------------------ stoichiometry

/** The two "STP" definitions, both named (a silent choice is wrong for half the textbooks). */
export const GAS_CONDITION_OPTIONS: { value: "IUPAC-STP" | "STP-1atm"; label: string }[] = [
  { value: "IUPAC-STP", label: "IUPAC STP — 273.15 K, 100 kPa (Vₘ = 22.711 L/mol)" },
  { value: "STP-1atm", label: "Older STP — 273.15 K, 1 atm (Vₘ = 22.414 L/mol)" },
];

/**
 * Reads one amount line: `species: amount[, density 1.082 g/mL][, molarity 0.1 M][, gas]`.
 * The species is everything before the first ":" (formulas may carry charges
 * and parentheses, never a colon).
 */
export function parseStoichLine(line: string): StoichAmount | { error: string } {
  const at = line.indexOf(":");
  if (at < 0) return { error: `“${line.trim()}” — write each amount as species: amount, e.g. H2: 10.0 g.` };
  const species = line.slice(0, at).trim();
  if (!species) return { error: `“${line.trim()}” names no species before the colon.` };
  const parts = line
    .slice(at + 1)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { error: `${species}: give an amount after the colon (g, mol, mL, L …).` };
  const out: StoichAmount = { species, amount: parts[0] };
  for (const p of parts.slice(1)) {
    const m = /^(density|ρ|rho|molarity|conc(?:entration)?|c)\s*=?\s*(.+)$/i.exec(p);
    if (/^gas$/i.test(p) || /^\(g\)$/i.test(p)) out.phase = "gas";
    else if (m && /^(density|ρ|rho)$/i.test(m[1])) out.density = m[2].trim();
    else if (m) out.molarity = m[2].trim();
    else return { error: `${species}: “${p}” is not understood — use “density 1.082 g/mL”, “molarity 0.100 M” or “gas”.` };
  }
  return out;
}

/** Amount lines (newline- or “;”-separated) → the engine's amounts. */
export function parseStoichAmounts(text: string): StoichAmount[] | { error: string } {
  const lines = text
    .split(/[;\n]/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { error: "Give at least one reactant amount, e.g. H2: 10.0 g." };
  if (lines.length > 20) return { error: "At most 20 amount lines." };
  const out: StoichAmount[] = [];
  for (const l of lines) {
    const a = parseStoichLine(l);
    if ("error" in a) return a;
    out.push(a);
  }
  return out;
}

/** Moles available vs needed at the limiting extent, one pair per reactant; the limiting one flagged. */
export function stoichChartSvg(r: StoichOk): string {
  // groupedBarSvg cuts a category label at 10 characters, so "(limiting)"
  // after the species was cut to "O₂ (limiti" — caught by the routing test.
  // The limiting reagent is NAMED in the title and starred on its bar when
  // the star fits.
  const limiting = r.chart.filter((c) => c.limiting).map((c) => c.species);
  return groupedBarSvg(
    r.chart.map((c) => (c.limiting && c.species.length <= 8 ? `${c.species} ★` : c.species)),
    [
      { label: "available", values: r.chart.map((c) => c.available) },
      { label: "needed", values: r.chart.map((c) => c.needed) },
    ],
    { title: `Moles available vs needed — limiting: ${limiting.join(", ")} ★`, ylabel: "mol" },
  );
}

export interface StoichOutput {
  text: string;
  ok: boolean;
  svg?: string;
  caveats?: string[];
}

/** The whole "Reaction stoichiometry & yield" calculator, field text in. */
export function stoichCalc(reaction: string, amountsText: string, actualText: string, gas: string): StoichOutput {
  if (!reaction.trim()) return { text: "Enter a reaction, e.g. 2 H2 + O2 -> 2 H2O.", ok: false };
  const amounts = parseStoichAmounts(amountsText);
  if ("error" in amounts) return { text: amounts.error, ok: false };
  let actual: StoichAmount | undefined;
  if (actualText.trim()) {
    const a = parseStoichLine(actualText);
    if ("error" in a) return { text: `Actual yield: ${a.error}`, ok: false };
    actual = a;
  }
  const g = gas === "STP-1atm" ? "STP-1atm" : "IUPAC-STP";
  const r = stoichiometry({ reaction, amounts, gas: g, actual });
  if (!r.ok) return { text: r.message, ok: false };
  // A percent-yield caveat (above 100 %) is already inside its line.
  return { text: r.lines.join("\n"), ok: true, svg: r.chart.length ? stoichChartSvg(r) : undefined, caveats: [...r.notes] };
}

// ------------------------------------------------------------------ peptides

/**
 * The structure-drawing cap for Peptide mode, in HEAVY atoms (non-hydrogen),
 * set BEFORE any drawing. OpenChemLib's 2D coordinate generation grows
 * steeply and is noisy. Measured on this machine, warm:
 *   node:  168 heavy atoms (20 aa) ≈ 80 ms, 250 ≈ 170 ms, 335 (40 aa) ≈ 340 ms;
 *          cold runs of 500 atoms took 8 s and 1,000 atoms 26 s;
 *   jest:  151 ≈ 250 ms, 201 ≈ 370 ms, 251 ≈ 520 ms, 297 ≈ 800 ms
 *          (the first draw of a session ≈ 2.9 s — warm-up).
 * A 200-residue SMILES took 12.5 s — a frozen Word. The preview redraws on
 * every keystroke and Word's WebView is slower than either, so the cap sits
 * at ~0.5 s measured here (≈ 30 residues of an average composition). The
 * masses are always shown; only the DRAWING is refused, by name. Pinned
 * (time and order) in chembioRouting.test.ts.
 */
export const PEPTIDE_DRAW_MAX_HEAVY_ATOMS = 250;

/** Non-hydrogen atoms of the reading's composition — no OCL work. */
export function peptideHeavyAtoms(r: PeptideReading): number {
  let n = 0;
  for (const [el, c] of Object.entries(r.composition)) if (el !== "H") n += c;
  return n;
}

/** Why the structure is not drawn (the engine's refusal, or the size cap), or null to draw it. */
export function peptideDrawRefusal(r: PeptideReading): string | null {
  if (!r.smiles) return r.structureRefusal ?? "The structure cannot be drawn for this reading.";
  const heavy = peptideHeavyAtoms(r);
  if (heavy > PEPTIDE_DRAW_MAX_HEAVY_ATOMS) {
    return (
      `Structure not drawn: ${heavy} heavy atoms is above the ${PEPTIDE_DRAW_MAX_HEAVY_ATOMS}-atom drawing limit ` +
      `(2D layout time grows steeply with size and would freeze Word). The formula and masses above are exact.`
    );
  }
  return null;
}

/** The ε₂₈₀ for the cysteine state the NOTATION states: exact cystine count when disulfides are given. */
export function peptideEpsilon280(r: PeptideReading): number {
  let w = 0;
  let y = 0;
  for (const ch of r.sequence) {
    if (ch === "W") w++;
    else if (ch === "Y") y++;
  }
  return EPSILON_280.tryptophan * w + EPSILON_280.tyrosine * y + EPSILON_280.cystine * r.cystinePairs;
}

/** The lines Peptide mode shows and the insert alt text carries — all from the reading, never OCL's mw. */
export function peptideSummaryLines(r: PeptideReading): string[] {
  const lines: string[] = [];
  lines.push(`${r.length} residue${r.length === 1 ? "" : "s"} · ${r.formulaTypeset}`);
  lines.push(`Monoisotopic mass ${r.monoisotopic.toFixed(4)} Da · average mass ${r.average.toFixed(3)} Da`);
  lines.push(`N-terminus: ${r.nTerminus} · C-terminus: ${r.cTerminus}`);
  for (const m of r.modifications) {
    const sites = [...new Set(m.sites)];
    const where = sites.length ? ` at ${sites.join(", ")}` : "";
    const acc = m.accession ? ` (${m.accession})` : "";
    lines.push(
      `${m.name}${acc}${where}: ${m.deltaComposition}, ${signedMass(m.deltaMono, 6)} mono / ${signedMass(m.deltaAvg, 4)} avg` +
        (m.count > 1 ? ` each (×${m.count})` : ""),
    );
  }
  if (r.disulfideCount) {
    lines.push(
      r.disulfidePairingKnown
        ? `Disulfides: ${r.disulfides.map(([a, b]) => `C${a}–C${b}`).join(", ")}`
        : `Disulfides: ${r.disulfideCount} (pairing not given)`,
    );
  }
  const eps = peptideEpsilon280(r);
  if (eps > 0) {
    lines.push(
      `ε₂₈₀ = ${eps.toLocaleString("en-US")} M⁻¹cm⁻¹ (${r.cystinePairs ? `${r.cystinePairs} cystine${r.cystinePairs === 1 ? "" : "s"} as written` : "no cystines"})`,
    );
  }
  return lines;
}
