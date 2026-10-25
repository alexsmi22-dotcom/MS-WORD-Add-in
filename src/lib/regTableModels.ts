/**
 * The publication regression table's model lines (v2.200.0): a line may name its estimator, so OLS, 2SLS, panel fixed
 * and random effects, difference-in-differences, quantile regression, logit and probit can sit side by side.
 *
 *   TOTEMP ~ GNP + POP                                        OLS (no prefix), the table's standard errors
 *   iv: lwage ~ exper | endog = educ | instruments = dist + sibs
 *   fe: invest ~ sales + capital | entity = firm | time = year | effects = twoway
 *   re: invest ~ sales + capital | entity = firm | time = year
 *   did: employment ~ controls | entity = county | time = year | treat = policy
 *   q 0.5: wage ~ educ + exper                                quantile regression at τ = 0.5
 *   logit: pass ~ hours                                       (also probit)
 *
 * Each line is fitted by the calculator that owns that estimator (ivCalcs, panelCalcs, robustCalcs, logitProbit),
 * through the same field reader its own calculator uses, so a model in the table is the model that calculator prints.
 * Every estimator except OLS takes its own default standard errors unless the line says `se = …`.
 */
import type { FittedModel } from "./regModel";
import { parseSpec, selectColumns, type RegDataset } from "./regData";
import { iv2slsModel } from "./ivCalcs";
import { panelFeModel, panelReModel, panelDidModel } from "./panelCalcs";
import { qregModels } from "./robustCalcs";
import { fitLogit, fitProbit, LogitProbitRefusal } from "./logitProbit";

export type LineKind = "ols" | "iv" | "fe" | "re" | "did" | "quantile" | "logit" | "probit";

export interface ModelLine {
  kind: LineKind;
  /** "y ~ x1 + x2" as typed after the prefix. */
  spec: string;
  /** Lower-cased option keys → values as typed. */
  opts: Map<string, string>;
  /** τ for a quantile line. */
  tau?: number;
  /** The line as typed, for messages. */
  text: string;
}

/** The options each estimator's line accepts (beyond the model itself). */
const ALLOWED: Record<LineKind, string[]> = {
  ols: [],
  iv: ["endog", "instruments", "se", "cluster", "small"],
  fe: ["entity", "time", "effects", "se", "cluster"],
  re: ["entity", "time", "se", "cluster"],
  did: ["entity", "time", "treat", "se"],
  quantile: ["se"],
  logit: ["se"],
  probit: ["se"],
};
const REQUIRED: Record<LineKind, string[]> = {
  ols: [],
  iv: ["endog", "instruments"],
  fe: ["entity", "time"],
  re: ["entity", "time"],
  did: ["entity", "time", "treat"],
  quantile: [],
  logit: [],
  probit: [],
};

const q = (s: string): string => `“${s}”`;

/** Reads one model line, or why not. A line without a prefix is OLS (and may not carry options). */
export function parseModelLine(line: string): ModelLine | { error: string } {
  const text = line.trim();
  const m = /^(ols|iv|2sls|fe|re|did|logit|probit|q(?:reg)?\s*(?:τ\s*=\s*)?([0-9]*[.,]?[0-9]+))\s*:\s*/i.exec(text);
  let kind: LineKind = "ols";
  let tau: number | undefined;
  let rest = text;
  if (m) {
    const tag = m[1].toLowerCase();
    rest = text.slice(m[0].length);
    if (m[2] !== undefined) {
      kind = "quantile";
      tau = Number(m[2].replace(",", "."));
      if (!(tau > 0 && tau < 1)) return { error: `The quantile in ${q(text)} must be between 0 and 1 (such as “q 0.5:”).` };
    } else kind = tag === "2sls" ? "iv" : (tag as LineKind);
  }
  // A plain (OLS) line takes no options, so a "|" in it belongs to a column name ("y ~ x|1"), unless what follows it
  // reads as an option ("| se = hc1"), which is refused below with the reason.
  if (kind === "ols" && !/\|\s*[A-Za-z_]+\s*=/.test(rest)) return { kind, spec: rest, opts: new Map(), text };
  const parts = rest.split("|").map((s) => s.trim());
  const spec = parts[0];
  const opts = new Map<string, string>();
  for (const p of parts.slice(1)) {
    if (!p) return { error: `${q(text)} has an empty option (two | in a row?).` };
    const eq = p.indexOf("=");
    if (eq < 0) return { error: `Write each option as “name = value”: ${q(p)} in ${q(text)}.` };
    const key = p.slice(0, eq).trim().toLowerCase();
    const value = p.slice(eq + 1).trim();
    if (!ALLOWED[kind].includes(key)) {
      const ok = ALLOWED[kind];
      return {
        error: ok.length
          ? `${q(key)} is not an option of a ${kindName(kind)} line; its options are ${ok.map(q).join(", ")}.`
          : `An OLS line takes no options (${q(p)}); the table's own standard-error fields apply to it. Start the line with an estimator (iv:, fe:, re:, did:, q 0.5:, logit:, probit:) to use options.`,
      };
    }
    if (opts.has(key)) return { error: `${q(key)} is given twice in ${q(text)}.` };
    if (!value) return { error: `${q(key)} has no value in ${q(text)}; give one or leave the option out.` };
    opts.set(key, value);
  }
  // "cluster = firm" means clustered standard errors: it sets the type, or contradicts one that is not clustered.
  if (opts.has("cluster")) {
    const want = kind === "iv" ? "cluster" : "cluster-column";
    const se = opts.get("se");
    if (se === undefined) opts.set("se", want);
    else if (se !== want) return { error: `${q(text)} names a cluster column but asks for ${q(se)} standard errors; use ${q(`se = ${want}`)} (or leave se out).` };
  }
  for (const k of REQUIRED[kind]) {
    if (!(opts.get(k) ?? "").trim()) return { error: `A ${kindName(kind)} line needs ${q(`${k} = …`)}: ${q(text)}.` };
  }
  return { kind, spec, opts, tau, text };
}

export function kindName(kind: LineKind): string {
  return { ols: "OLS", iv: "2SLS", fe: "fixed-effects", re: "random-effects", did: "difference-in-differences", quantile: "quantile", logit: "logit", probit: "probit" }[kind];
}

/**
 * Fits one non-OLS line on the table's data. `dataText` is the table as typed (each calculator reads it with the
 * product's table reader); `constant` is the table's constant choice, which IV, quantile and logit/probit honour.
 */
export function fitModelLine(line: ModelLine, dataText: string, data: RegDataset, constant: boolean): FittedModel | { error: string } {
  const o = (k: string): string => line.opts.get(k) ?? "";
  const yes = constant ? "yes" : "no";
  switch (line.kind) {
    case "iv": {
      const f: Record<string, string> = { data: dataText, spec: line.spec, endog: o("endog"), instruments: o("instruments"), constant: yes, se: o("se") || "hc0", cluster: o("cluster"), small: o("small") || "z", decimals: "3" };
      return iv2slsModel((k) => f[k] ?? "");
    }
    case "fe": {
      const f: Record<string, string> = { data: dataText, spec: line.spec, entity: o("entity"), time: o("time"), effects: o("effects") || "entity", se: o("se") || "cluster-entity", cluster: o("cluster") };
      return panelFeModel((k) => f[k] ?? "");
    }
    case "re": {
      const f: Record<string, string> = { data: dataText, spec: line.spec, entity: o("entity"), time: o("time"), se: o("se") || "cluster-entity", cluster: o("cluster") };
      return panelReModel((k) => f[k] ?? "");
    }
    case "did": {
      // "employment ~ controls": the outcome before ~, optional controls after it.
      const [lhs, rhs = ""] = line.spec.split("~");
      if (!lhs.trim()) return { error: `A difference-in-differences line starts with the outcome (“employment ~ …”): ${q(line.text)}.` };
      // Controls separated by + (as every model line) or by commas (as the DiD calculator's own field allows).
      const controls = rhs.split(/[+,]/).map((s) => s.trim()).filter(Boolean).join(" + ");
      const f: Record<string, string> = { data: dataText, outcome: lhs.trim(), entity: o("entity"), time: o("time"), treat: o("treat"), controls, se: o("se") || "cluster-entity" };
      return panelDidModel((k) => f[k] ?? "");
    }
    case "quantile": {
      const f: Record<string, string> = { data: dataText, spec: line.spec, quantiles: String(line.tau), se: o("se") || "robust", constant: yes };
      const r = qregModels((k) => f[k] ?? "");
      return "error" in r ? r : r[0];
    }
    case "logit":
    case "probit": {
      const spec = parseSpec(line.spec);
      if ("error" in spec) return spec;
      const sel = selectColumns(data, spec, {});
      if (!sel.ok) return { error: sel.reason };
      const se = o("se") || "classical";
      if (se !== "classical" && se !== "hc0") return { error: `A ${line.kind} line's standard errors are “classical” or “hc0”, not ${q(se)}.` };
      const y = Array.from(sel.cols.y);
      const X = y.map((_, i) => sel.cols.X.map((col) => col[i]));
      try {
        return (line.kind === "probit" ? fitProbit : fitLogit)(y, X, sel.cols.names, { constant, se, depName: sel.cols.depName });
      } catch (e) {
        if (e instanceof LogitProbitRefusal) return { error: e.message };
        return { error: `The ${line.kind} model could not be fitted (${(e as Error).message}).` };
      }
    }
    default:
      return { error: "An OLS line is fitted by the table itself." };
  }
}
