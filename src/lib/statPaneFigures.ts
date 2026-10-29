/**
 * Figures for the inline Statistics calculators that drew none (fully inclusive release, 2026-10-28):
 *  - econ-logit     coefficient forest (log-odds or probit index, constant not drawn) above the average-marginal-effect
 *                   forest, both with 95% intervals and a zero line;
 *  - econ-regtable  one forest panel per term, the models as its rows, 95% intervals and a zero line.
 *
 * WHY ONE PANEL PER TERM in the regression table. The terms of one model are on unrelated scales (Longley: GNP's
 * coefficient is about 0.04, YEAR's about −1,800 in the full model, the constant millions), so a shared axis would
 * squash every interval but one to a dot. The same term ACROSS models is on one scale (for linear models), and how it
 * moves as controls are added is what a side-by-side table is read for, so each term gets its own axis and the models
 * are its rows. When the table mixes linear models with logit or probit, a term's rows are on different scales too;
 * the header says so.
 *
 * Every value drawn is the engine's own (ModelTerm.coef, ciLo, ciHi, all 95%: t or z critical at 0.975); nothing is
 * recomputed. The intervals come from forestPlotSvg (statchart.ts), the shared forest builder, called as it is.
 */
import type { FittedModel, ModelTerm } from "./regModel";
import { estimatorLabel, isLinearKind } from "./regModel";
import { forestPlotSvg } from "./statchart";
import { combineSvgs } from "./plot";
import { composePanels } from "./panels";
import { currentFigCtx, stickyLayout, withCellCtx } from "./figContext";
import { oddsRatioRows } from "./logitProbit";

/** At most this many term panels in the regression-table figure (the header says how many were left out). */
export const REGTABLE_FIGURE_MAX_TERMS = 8;

const PANEL_W = 300;
const INK = "#111111";
const GREY = "#6b7280";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A name cut to fit a title line. */
function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * A one- or two-line caption strip as its own SVG, wrapped to the width at 6 px a character (an over-estimate for
 * 11 px Segoe UI), so it never runs off the canvas.
 */
function captionSvg(text: string, width: number): string {
  const perLine = Math.max(20, Math.floor((width - 16) / 6));
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > perLine && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  const h = 10 + lines.length * 15;
  const body = lines
    .map(
      (l, i) =>
        `<text x="${width / 2}" y="${18 + i * 15}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="11" fill="${i === 0 ? INK : GREY}">${esc(l)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}"><rect width="${width}" height="${h}" fill="#ffffff"/>${body}</svg>`;
}

function row(label: string, t: ModelTerm): { label: string; estimate: number; low: number; high: number } {
  return { label, estimate: t.coef, low: t.ciLo, high: t.ciHi };
}

/**
 * econ-logit: the coefficients (constant not drawn: it sits on the intercept's own scale and would set the axis)
 * and, below, the average marginal effects on P(y = 1), which ARE on one scale and are what the reading quotes.
 */
export function logitCoefFigureSvg(model: FittedModel): string {
  const title = model.kind === "probit" ? "Probit" : "Logit";
  const terms = model.terms.filter((t) => t.name !== "Constant");
  const shown = terms.length ? terms : model.terms;
  const build = (): string[] => {
  const parts = [
    forestPlotSvg(
      shown.map((t) => row(t.name, t)),
      {
        title: `${title} coefficients, 95% CI${terms.length && terms.length < model.terms.length ? " (constant not drawn)" : ""}`,
        xlabel: model.kind === "probit" ? "coefficient (probit index)" : "coefficient (log-odds)",
        zero: 0,
      },
    ),
  ];
  // Logit: the odds ratios on a log axis with the no-effect line at 1 (user decision 2026-10-28), the table's own rows.
  const ors = oddsRatioRows(model);
  if (ors) {
    parts.push(
      forestPlotSvg(
        ors.map((r) => ({ label: r.name, estimate: r.or, low: r.lo, high: r.hi })),
        { title: "Odds ratios, 95% CI (log scale)", xlabel: `odds ratio for ${clip(model.depName, 18)} = 1`, zero: 1, log: true },
      ),
    );
  }
  const me = model.marginalEffects ?? [];
  if (me.length) {
    parts.push(
      forestPlotSvg(
        me.map((t) => row(t.name, t)),
        { title: `Average marginal effects, 95% CI`, xlabel: `change in P(${clip(model.depName, 18)} = 1)`, zero: 0 },
      ),
    );
  }
  return parts;
  };
  return stackOrPair(build);
}

/**
 * The panels one above the other; under a figure-style re-render (lib/figContext.ts) whose stack would print taller
 * than the style allows, two to a row with each panel DRAWN at the half width (withCellCtx), so its text keeps its
 * size rather than being scaled down with the panel.
 */
function stackOrPair(build: () => string[]): string {
  const parts = build();
  const fctx = currentFigCtx();
  const maxMm = fctx?.style?.maxHeightMm ?? null;
  if (!fctx || maxMm === null || fctx.widthMm === undefined || parts.length < 2) return combineSvgs(parts).svg;
  const cols = stickyLayout("statPaneStack", () => {
    const one = composePanels(parts, { cols: 1 });
    return (one.height / one.width) * (fctx.widthMm as number) <= maxMm * 0.98 ? 1 : 2;
  });
  if (cols === 1) return composePanels(parts, { cols: 1 }).svg;
  return composePanels(withCellCtx(2, 8, build), { cols: 2, gap: 8 }).svg;
}

/**
 * econ-regtable: one panel per term (constant not drawn unless it is the only term), the models that include the
 * term as its rows, labelled "(1)" as in the table header (with the estimator once the table mixes them).
 */
export function regTableFigureSvg(models: FittedModel[]): string {
  if (!models.length) return "";
  const mixed = models.some((m) => m.kind !== "ols");
  const order: string[] = [];
  for (const m of models) for (const t of m.terms) if (!order.includes(t.name) && t.name !== "Constant") order.push(t.name);
  if (!order.length && models.some((m) => m.terms.some((t) => t.name === "Constant"))) order.push("Constant");
  if (!order.length) return "";
  const shown = order.slice(0, REGTABLE_FIGURE_MAX_TERMS);
  const build = (): string[] =>
    shown.map((name) => {
      const rows = models.flatMap((m, i) => {
        const t = m.terms.find((x) => x.name === name);
        return t ? [row(mixed ? `(${i + 1}) ${estimatorLabel(m)}` : `(${i + 1})`, t)] : [];
      });
      return forestPlotSvg(rows, { title: clip(name, 40), xlabel: "coefficient", zero: 0, w: PANEL_W });
    });
  let panels = build();
  // Two to a row; under a figure-style re-render (lib/figContext.ts) one per row when the stack still fits the style's
  // height at its printed width (two to a row halves the text, and a USPTO or thesis column cannot afford that).
  const fctx = currentFigCtx();
  const maxMm = fctx?.style?.maxHeightMm ?? null;
  const cols =
    panels.length < 2
      ? 1
      : fctx && maxMm !== null && fctx.widthMm !== undefined
        ? stickyLayout("regTableGrid", () => {
            const one = composePanels(panels, { cols: 1 });
            return (one.height / one.width) * (fctx.widthMm as number) <= maxMm * 0.98 ? 1 : 2;
          })
        : 2;
  // Two to a row under a re-render: each panel drawn at the half width (withCellCtx), so its text keeps its size.
  if (fctx && cols === 2) panels = withCellCtx(2, 8, build);
  const grid = composePanels(panels, { cols });
  // Quantile coefficients are in the response's units like OLS; logit and probit coefficients are not.
  const scales = models.some((m) => !isLinearKind(m.kind) && m.kind !== "quantile")
    ? "logit and probit rows are on their own scale"
    : "";
  const second = [
    order.length > shown.length ? `first ${shown.length} of ${order.length} terms` : "",
    order[0] !== "Constant" && models.some((m) => m.terms.some((t) => t.name === "Constant")) ? "constant not drawn" : "",
    scales,
  ].filter(Boolean);
  const caption = "Coefficients by model with 95% CI, one panel per term (each on its own axis)" + (second.length ? `. ${capitalize(second.join("; "))}.` : ".");
  const head = captionSvg(caption, grid.width);
  // Under a re-render the caption stays above the grid (combineSvgs could set a tall pair side by side).
  return fctx ? composePanels([head, grid.svg], { cols: 1, gap: 4 }).svg : combineSvgs([head, grid.svg], 4).svg;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
