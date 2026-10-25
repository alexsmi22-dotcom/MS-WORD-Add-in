/**
 * Difference-in-differences (Release E4b): the treatment column, the classic 2×2 table of group means, and the
 * relative-time dummies of a DiD event study. The regressions themselves are two-way fixed effects (panel.ts
 * fitFixedEffects with entity and time effects), pinned to linearmodels PanelOLS with the same dummies.
 *
 *  - Treatment is 0/1 per row ("treated in this period") and must be ABSORBING: once an entity is treated it stays
 *    treated. A unit whose treatment switches off again is refused by entity.
 *  - Staggered adoption (treated entities starting in different periods) is detected and warned about: TWFE weights
 *    can be negative under heterogeneous effects (Goodman-Bacon 2021; Sun & Abraham 2021; de Chaisemartin &
 *    D'Haultfœuille 2020), so the TWFE estimate is not robust to it.
 *  - Event study: relative period = rank of the row's period − rank of the entity's first treated period, among the
 *    periods present in the data (ranks, not calendar distance), binned at the window ends (≤ −leads and ≥ +lags),
 *    period −1 omitted as the reference, never-treated entities 0 in every dummy (the controls). When the panel was
 *    read with its treatment column (readPanel's `treatment`), the adoption period and the ranks come from every row
 *    with a treatment cell, before rows with a missing outcome or control are dropped, so an NA outcome in a unit's
 *    adoption row does not shift its relative periods; an NA treatment cell that hides an adoption is refused.
 */
import type { PanelColumns } from "./panelData";
import { numText } from "./regTable";

const q = (s: string): string => `“${s}”`;
const MINUS = "−";

export interface TreatmentInfo {
  /** Rank (time code) of each entity's first treated period, −1 when never treated. */
  first: Int32Array;
  /** Entities treated at some point / never. */
  nTreated: number;
  nNever: number;
  /** Distinct first-treated periods (time codes), sorted. */
  cohorts: number[];
  staggered: boolean;
  /** Entities treated in their first observed row (no pre-period of their own). */
  alwaysTreated: number;
  /**
   * Adoption dating for the event study and the description: from the treatment column over ALL rows when the panel
   * carries it (PanelColumns.adoption: rows with a missing outcome do not move a unit's adoption period), else from
   * the rows used. Periods are ranks.
   */
  event: EventDating;
}

export interface EventDating {
  /** Rank of each entity's adoption period, −1 when never treated. */
  firstRank: Int32Array;
  /** Rank of each panel period (time code). */
  timeRank: Int32Array;
  /** Labels of the distinct adoption periods, in time order. */
  cohortLabels: string[];
  nTreated: number;
  nNever: number;
  /** Treated entities with no untreated row before adoption. */
  noPre: number;
  /** Treated entities whose adoption an NA treatment cell may hide. */
  hidden: { entity: number; row: number }[];
  /** True when dated from every row of the treatment column, not only the rows used. */
  raw: boolean;
}

/** Reads the treatment column (regressor j of the panel): 0/1, absorbing. */
export function analyseTreatment(p: PanelColumns, j: number): { ok: true; info: TreatmentInfo } | { ok: false; reason: string } {
  const d = p.X[j];
  const name = p.names[j];
  for (let i = 0; i < p.n; i++) {
    if (d[i] !== 0 && d[i] !== 1) {
      return { ok: false, reason: `The treatment column ${q(name)} must be 0 or 1 in every row (row ${p.rowNumbers[i]} holds ${numText(d[i])}).` };
    }
  }
  // Rows of each entity in time order.
  const order = Array.from({ length: p.n }, (_, i) => i).sort((a, b) => p.entity[a] - p.entity[b] || p.time[a] - p.time[b]);
  const first = new Int32Array(p.N).fill(-1);
  const firstRow = new Int32Array(p.N).fill(-1);
  let alwaysTreated = 0;
  for (let a = 0; a < order.length; a++) {
    const i = order[a];
    const e = p.entity[i];
    const isFirstRow = firstRow[e] < 0;
    if (isFirstRow) firstRow[e] = i;
    if (d[i] === 1) {
      if (first[e] < 0) {
        first[e] = p.time[i];
        if (isFirstRow) alwaysTreated++;
      }
    } else if (first[e] >= 0) {
      return {
        ok: false,
        reason:
          `Entity ${q(p.entityNames[e])} is treated in ${q(p.timeLabels[first[e]])} but untreated again in ${q(p.timeLabels[p.time[i]])} ` +
          "(row " + p.rowNumbers[i] + "). Difference-in-differences here needs an absorbing treatment: once treated, always treated.",
      };
    }
  }
  let nTreated = 0;
  const cohorts = new Set<number>();
  for (let e = 0; e < p.N; e++) {
    if (first[e] >= 0) {
      nTreated++;
      cohorts.add(first[e]);
    }
  }
  const sorted = [...cohorts].sort((a, b) => a - b);
  let event: EventDating;
  const a = p.adoption;
  if (a) {
    if (a.error) return { ok: false, reason: a.error };
    let nt = 0;
    let noPre = 0;
    const ranks = new Set<number>();
    for (let e = 0; e < p.N; e++) {
      if (a.firstRank[e] < 0) continue;
      nt++;
      ranks.add(a.firstRank[e]);
      if (!a.hasPre[e]) noPre++;
    }
    event = {
      firstRank: a.firstRank,
      timeRank: a.timeRank,
      cohortLabels: [...ranks].sort((x, y) => x - y).map((r) => a.rankLabels[r]),
      nTreated: nt,
      nNever: p.N - nt,
      noPre,
      hidden: a.hidden,
      raw: true,
    };
  } else {
    event = {
      firstRank: first,
      timeRank: Int32Array.from({ length: p.T }, (_, t) => t),
      cohortLabels: sorted.map((c) => p.timeLabels[c]),
      nTreated,
      nNever: p.N - nTreated,
      noPre: alwaysTreated,
      hidden: [],
      raw: false,
    };
  }
  return {
    ok: true,
    info: { first, nTreated, nNever: p.N - nTreated, cohorts: sorted, staggered: sorted.length > 1, alwaysTreated, event },
  };
}

export interface TwoByTwo {
  treatedPre: number;
  treatedPost: number;
  controlPre: number;
  controlPost: number;
  did: number;
  balanced: boolean;
}

/** The four group means when the design is exactly 2 groups × 2 periods (treatment only in period 2), else null. */
export function twoByTwo(p: PanelColumns, info: TreatmentInfo): TwoByTwo | null {
  if (p.T !== 2 || info.nTreated === 0 || info.nNever === 0) return null;
  if (info.cohorts.length !== 1 || info.cohorts[0] !== 1) return null;
  const s = [0, 0, 0, 0];
  const c = [0, 0, 0, 0];
  for (let i = 0; i < p.n; i++) {
    // Group membership from the adoption dates (every row of the treatment column when the panel carries them).
    const g = info.event.firstRank[p.entity[i]] >= 0 ? 0 : 2;
    const k = g + p.time[i];
    s[k] += p.y[i];
    c[k]++;
  }
  if (c.some((x) => x === 0)) return null;
  const m = s.map((x, k) => x / c[k]);
  return {
    treatedPre: m[0],
    treatedPost: m[1],
    controlPre: m[2],
    controlPost: m[3],
    did: m[1] - m[0] - (m[3] - m[2]),
    balanced: p.n === 2 * p.N,
  };
}

/** Window limits for the event study. */
export const EVENT_MAX_WINDOW = 20;

export interface EventDummies {
  ok: true;
  /** The panel with the relative-period dummies first, then the controls (the treatment column removed). */
  panel: PanelColumns;
  /** Relative periods that have a dummy, in order (−1 excluded). */
  periods: number[];
  /** Relative periods dropped because no row falls in them. */
  empty: number[];
  dummyName: (r: number) => string;
  leads: number;
  lags: number;
}

/** "τ ≤ −4", "τ = −2", "τ = 0", "τ = +1", "τ ≥ +4". */
export function relLabel(r: number, leads: number, lags: number): string {
  const s = r > 0 ? `+${r}` : r < 0 ? `${MINUS}${-r}` : "0";
  if (r === -leads) return `τ ≤ ${s}`;
  if (r === lags) return `τ ≥ ${s}`;
  return `τ = ${s}`;
}

/** Builds the event-study design from a panel whose regressor `treatIdx` is the treatment column. */
export function buildEventDummies(
  p: PanelColumns,
  treatIdx: number,
  win: { leads: number; lags: number },
): EventDummies | { ok: false; reason: string } {
  const { leads, lags } = win;
  if (!Number.isInteger(leads) || leads < 1 || leads > EVENT_MAX_WINDOW) return { ok: false, reason: `Leads must be a whole number from 1 to ${EVENT_MAX_WINDOW} (period −1 is the reference).` };
  if (!Number.isInteger(lags) || lags < 0 || lags > EVENT_MAX_WINDOW) return { ok: false, reason: `Lags must be a whole number from 0 to ${EVENT_MAX_WINDOW}.` };
  const t = analyseTreatment(p, treatIdx);
  if (!t.ok) return t;
  const ev = t.info.event;
  if (ev.nTreated === 0) return { ok: false, reason: "No entity is ever treated, so there is no event to study." };
  if (ev.hidden.length) {
    const h = ev.hidden[0];
    const more = ev.hidden.length - 1;
    return {
      ok: false,
      reason:
        `The adoption period of entity ${q(p.entityNames[h.entity])} cannot be dated: its treatment cell is empty or NA in row ${h.row}, after its last untreated period and before its first treated one` +
        `${more ? ` (and ${more} more entit${more === 1 ? "y" : "ies"} like it)` : ""}, so its periods relative to treatment are unknown. Fill in the treatment cell.`,
    };
  }
  if (ev.nNever === 0) {
    return {
      ok: false,
      reason:
        "Every entity is treated at some point, and the event study uses never-treated entities as its controls; with none, " +
        "the relative-period effects are not identified apart from the time effects.",
    };
  }
  const rels: number[] = [];
  for (let r = -leads; r <= lags; r++) if (r !== -1) rels.push(r);
  const cols = rels.map(() => new Float64Array(p.n));
  const counts = new Array<number>(rels.length).fill(0);
  for (let i = 0; i < p.n; i++) {
    const f = ev.firstRank[p.entity[i]];
    if (f < 0) continue;
    const r = Math.min(Math.max(ev.timeRank[p.time[i]] - f, -leads), lags);
    const k = rels.indexOf(r);
    if (k >= 0) {
      cols[k][i] = 1;
      counts[k]++;
    }
  }
  const periods: number[] = [];
  const empty: number[] = [];
  const X: Float64Array[] = [];
  const names: string[] = [];
  rels.forEach((r, k) => {
    if (counts[k] === 0) empty.push(r);
    else {
      periods.push(r);
      X.push(cols[k]);
      names.push(relLabel(r, leads, lags));
    }
  });
  p.X.forEach((c, j) => {
    if (j !== treatIdx) {
      X.push(c);
      names.push(p.names[j]);
    }
  });
  return {
    ok: true,
    panel: { ...p, X, names },
    periods,
    empty,
    dummyName: (r: number) => relLabel(r, leads, lags),
    leads,
    lags,
  };
}
