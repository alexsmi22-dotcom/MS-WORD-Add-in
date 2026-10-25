/**
 * Release E4b: panel FE / RE / Hausman and the DiD regressions pinned to linearmodels 7.1 (scripts/econ-panel-oracle.py
 * → fixtures/econ-panel-oracle.json). Synthetic panels with fixed seeds.
 */
import * as fs from "fs";
import * as path from "path";
import { parseRegData } from "../regData";
import { readPanel } from "../panelData";
import { fitFixedEffects, fitRandomEffects, hausman, type PanelSe } from "../panel";
import { buildEventDummies } from "../did";

interface Stat {
  stat: number;
  p: number;
  df: number;
  df_denom: number;
}
interface Case {
  name: string;
  method: "fe" | "re" | "did" | "event";
  effects?: "entity" | "twoway";
  se: PanelSe;
  y: string;
  x: string[];
  entity: string;
  time: string;
  cluster: string | null;
  params: Record<string, number>;
  se_: Record<string, number>;
  p: Record<string, number>;
  df_resid: number;
  r2: number;
  r2w: number;
  r2b: number;
  r2o: number;
  f: Stat | null;
  f_pooled?: Stat | null;
  sigma2_eps?: number;
  sigma2_u?: number;
  theta_min?: number;
  theta_max?: number;
  nobs: number;
  data: string;
  leads?: number;
  lags?: number;
  treat?: string;
}
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-panel-oracle.json"), "utf8")) as {
  data: Record<string, string>;
  cases: Case[];
  hausman: Record<string, { stat?: number; df?: number; p?: number; skipped?: boolean }>;
};

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
}
function close(a: number, b: number, tol = 1e-8): void {
  if (Math.abs(b) < 1e-300) expect(Math.abs(a)).toBeLessThan(1e-12);
  else expect(rel(a, b)).toBeLessThan(tol);
}

function panelFor(c: Case, xs: string[]) {
  const d = parseRegData(fx.data[c.data]);
  if (!d.ok) throw new Error(d.reason);
  const spec = { dep: c.y, preds: xs, text: `${c.y} ~ ${xs.join(" + ")}` };
  const r = readPanel(d.data, { spec, entity: c.entity, time: c.time, cluster: c.se === "cluster-column" ? c.cluster! : undefined });
  if (!r.ok) throw new Error(r.reason);
  return r.panel;
}

function checkTerms(names: string[], coef: number[], terms: { name: string; se: number; p: number }[], c: Case): void {
  for (const [nm, v] of Object.entries(c.params)) {
    const j = names.indexOf(nm);
    expect(j).toBeGreaterThanOrEqual(0);
    close(coef[j], v, 1e-8);
    close(terms[j].se, c.se_[nm], 1e-7);
    if (c.p[nm] > 1e-12) close(terms[j].p, c.p[nm], 1e-5);
  }
}

describe("FE and DiD against linearmodels PanelOLS", () => {
  for (const c of fx.cases.filter((k) => k.method === "fe" || k.method === "did")) {
    test(c.name, () => {
      const p = panelFor(c, c.x);
      expect(p.n).toBe(c.nobs);
      const r = fitFixedEffects(p, { effects: c.effects!, se: c.se });
      expect(r.dfResid).toBe(c.df_resid);
      checkTerms(r.names, r.coef, r.model.terms, c);
      close(r.r2, c.r2, 1e-8);
      close(r.r2Within, c.r2w, 1e-8);
      close(r.r2Between, c.r2b, 1e-8);
      close(r.r2Overall, c.r2o, 1e-8);
      if (c.f && r.f) {
        close(r.f.value, c.f.stat, 1e-7);
        expect(r.f.df2).toBe(c.f.df_denom);
      }
      if (c.f_pooled && !("skipped" in r.pooledF)) {
        close(r.pooledF.value, c.f_pooled.stat, 1e-7);
        expect(r.pooledF.df1).toBe(c.f_pooled.df);
      }
    });
  }
});

describe("RE against linearmodels RandomEffects", () => {
  for (const c of fx.cases.filter((k) => k.method === "re")) {
    test(c.name, () => {
      const p = panelFor(c, c.x);
      const r = fitRandomEffects(p, { se: c.se });
      expect(r.dfResid).toBe(c.df_resid);
      close(r.sigma2e, c.sigma2_eps!, 1e-9);
      if (c.sigma2_u === 0) expect(r.sigma2u).toBe(0);
      else close(r.sigma2u, c.sigma2_u!, 1e-8);
      close(r.thetaMin, c.theta_min!, 1e-8);
      close(r.thetaMax, c.theta_max!, 1e-8);
      checkTerms(r.names, r.coef, r.model.terms, c);
      close(r.r2, c.r2, 1e-8);
      close(r.r2Within, c.r2w, 1e-8);
      close(r.r2Between, c.r2b, 1e-8);
      close(r.r2Overall, c.r2o, 1e-8);
      if (c.f && r.f) close(r.f.value, c.f.stat, 1e-7);
    });
  }
});

describe("Hausman (numpy formula on linearmodels' classical covariances)", () => {
  const pick = (prefix: string): Case => fx.cases.find((c) => c.name.startsWith(prefix) && c.se === "classical" && c.method === "re")!;
  for (const [key, prefix] of [
    ["bal", "re_bal"],
    ["reu", "re_unbal_tinv"],
    ["rez", "re_zero"],
  ] as const) {
    test(`${key}`, () => {
      const c = pick(prefix);
      const p = panelFor(c, c.x);
      const re = fitRandomEffects(p, { se: "classical" });
      const tv = re.timeVarying;
      const pf = panelFor(c, tv);
      const fe = fitFixedEffects(pf, { effects: "entity", se: "classical" });
      const h = hausman(fe, re);
      const o = fx.hausman[key];
      if (o.skipped) expect("skipped" in h).toBe(true);
      else {
        if ("skipped" in h) throw new Error(h.skipped);
        close(h.stat, o.stat!, 1e-6);
        expect(h.df).toBe(o.df);
        close(h.p, o.p!, 1e-5);
      }
    });
  }
});

describe("Event-study regressions against PanelOLS with the oracle's own relative-time dummies", () => {
  for (const c of fx.cases.filter((k) => k.method === "event")) {
    test(c.name, () => {
      const controls = c.x.filter((nm) => !nm.startsWith("rel_"));
      const base = panelFor(c, [c.treat!, ...controls]);
      const ev = buildEventDummies(base, 0, { leads: c.leads!, lags: c.lags! });
      if (!ev.ok) throw new Error(ev.reason);
      const r = fitFixedEffects(ev.panel, { effects: "twoway", se: c.se });
      expect(r.dfResid).toBe(c.df_resid);
      for (const [nm, v] of Object.entries(c.params)) {
        // rel_-3 in the oracle ↔ the period −3 dummy here.
        const m = /^rel_(-?\d+)$/.exec(nm);
        const mine = m ? ev.dummyName(Number(m[1])) : nm;
        const j = r.names.indexOf(mine);
        expect(j).toBeGreaterThanOrEqual(0);
        close(r.coef[j], v, 1e-8);
        close(r.model.terms[j].se, c.se_[nm], 1e-7);
      }
    });
  }
});
