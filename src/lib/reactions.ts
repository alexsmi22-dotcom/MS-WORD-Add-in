// Reaction-scheme composition. Lays out already-rendered component structures
// (reactants and products) side by side with "+" separators and a reaction arrow
// carrying conditions above/below — e.g. reactant + reactant → product. The
// individual structures are rendered by the existing OpenChemLib path in the task
// pane; this module only parses the reaction DSL and composes the combined SVG.
//
// Pure string logic — no Office.js, no OpenChemLib — so it is fully unit-testable.

export interface ReactionSpec {
  /** One array of components per arrow-separated stage (≥1; e.g. A + B → C → D). */
  stages: string[][];
  /** Text above the (first) arrow (reagents/catalyst). */
  over: string;
  /** Text below the (first) arrow (conditions, e.g. temperature/time). */
  under: string;
}

/**
 * Parses the reaction DSL:
 *   "CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux"
 * Components within a stage are split on a whitespace-padded "+"; stages are split
 * on ">>", "->", or "→" (so multi-step schemes A → B → C are supported); the two
 * optional trailing ";"-separated fields are over/under the (first) arrow. Each
 * component string (SMILES or name) is rendered by the caller.
 */
export function parseReaction(input: string): ReactionSpec {
  const [rxn = "", over = "", under = ""] = input.split(";").map((s) => s.trim());
  // Split components on a whitespace-padded "+" only, so SMILES formal charges
  // (e.g. C[N+](C)(C)C, [O-]) are not shattered.
  const split = (s: string): string[] =>
    s
      .split(/\s+\+\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
  const stages = rxn
    .split(/>>|→|->/)
    .map((seg) => split(seg.trim()))
    .filter((stage) => stage.length > 0);
  return { stages, over, under };
}

export interface Rendered {
  /** A complete <svg>…</svg> string for the component. */
  svg: string;
  width: number;
  height: number;
}

export interface ReactionConditions {
  over?: string;
  under?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PLUS_W = 18;
const ARROW_W = 78;
const ARROW_PAD = 8;

/**
 * Composes reaction stages into one scheme SVG: `R1 + R2 → P → … `. Components are
 * vertically centered, "+" separates components within a stage, and an arrow joins
 * consecutive stages. The optional over/under condition text sits on the FIRST
 * arrow. Returns a single SVG.
 */
export function composeReactionScheme(stages: Rendered[][], cond: ReactionConditions = {}): string {
  const all: Rendered[] = [];
  for (const stage of stages) for (const c of stage) all.push(c);
  const maxH = all.length ? Math.max(...all.map((c) => c.height)) : 40;
  const height = Math.max(maxH, 64);
  const cy = height / 2;
  const parts: string[] = [];
  let x = 0;

  const placeComp = (c: Rendered): void => {
    const y = cy - c.height / 2;
    parts.push(`<g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)})">${c.svg}</g>`);
    x += c.width;
  };
  const placePlus = (): void => {
    parts.push(
      `<text x="${(x + PLUS_W / 2).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" ` +
        `dominant-baseline="middle" font-size="20" font-family="serif">+</text>`,
    );
    x += PLUS_W;
  };
  const placeArrow = (over?: string, under?: string): void => {
    const ax0 = x + ARROW_PAD;
    const ax1 = x + ARROW_W - ARROW_PAD;
    const acx = (ax0 + ax1) / 2;
    parts.push(`<line x1="${ax0.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${ax1.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="#000" stroke-width="1.5"/>`);
    parts.push(
      `<polygon points="${ax1.toFixed(1)},${cy.toFixed(1)} ${(ax1 - 7).toFixed(1)},${(cy - 4).toFixed(1)} ${(ax1 - 7).toFixed(1)},${(cy + 4).toFixed(1)}" fill="#000"/>`,
    );
    if (over) {
      parts.push(`<text x="${acx.toFixed(1)}" y="${(cy - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-family="sans-serif">${escapeXml(over)}</text>`);
    }
    if (under) {
      parts.push(`<text x="${acx.toFixed(1)}" y="${(cy + 15).toFixed(1)}" text-anchor="middle" font-size="11" font-family="sans-serif">${escapeXml(under)}</text>`);
    }
    x += ARROW_W;
  };

  stages.forEach((stage, si) => {
    stage.forEach((c, ci) => {
      placeComp(c);
      if (ci < stage.length - 1) placePlus();
    });
    if (si < stages.length - 1) {
      placeArrow(si === 0 ? cond.over : undefined, si === 0 ? cond.under : undefined);
    }
  });

  const width = Math.max(x, 1);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" ` +
    `viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}">${parts.join("")}</svg>`
  );
}
