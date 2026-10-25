/**
 * The panel reader for Release E4b (panel fixed and random effects, difference-in-differences): a LONG table, one
 * row per entity × period, read with the regression reader (regData.ts) so decimal commas, U+2212, ×10ⁿ and NA cells
 * read exactly as in the OLS calculator.
 *
 *  - The entity column is any text; ids are compared as trimmed text ("01" and "1" are two entities).
 *  - The time column is either whole numbers (years, period numbers) or dates and periods read by
 *    damagesInterest.readDateToken ("2024-03-31", "3/31/2024", "2024 Q1", "2024-03", "2024"), sorted by their day
 *    number. One table uses one kind of period.
 *  - Duplicate (entity, time) pairs are refused by row, checked on every row that has both an entity and a time,
 *    BEFORE rows with a missing model cell are dropped (a duplicate is a data error whether or not its row is used).
 *  - Rows with a missing entity, time or model cell are dropped (listwise deletion, said in the notes). Unbalanced
 *    panels are allowed.
 */
import { findColumn, isMissingCell, readRegCell, selectColumns, type RegDataset, type RegSpec } from "./regData";
import { readDateToken } from "./damagesInterest";
import { intText, numText } from "./regTable";

/**
 * Past this many data rows a panel is refused up front. 100,000 rows fit inside the pane's time budget; the shared
 * table reader (regData.parseRegData, dataimport.parseDelimited) spreads one argument per row into Math.max and
 * overflows the stack at about 125,000 rows, so the limit is checked on the raw text before it is parsed
 * (panelTextTooLong).
 */
export const PANEL_MAX_ROWS = 100_000;

/** A refusal when the pasted text has more data lines than a panel allows (counted before parsing), or null. */
export function panelTextTooLong(text: string): string | null {
  let lines = 0;
  let inLine = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10 || ch === 13) inLine = false;
    else if (!inLine && ch !== 32 && ch !== 9) {
      inLine = true;
      lines++;
      if (lines > PANEL_MAX_ROWS + 1) return `The table has more than ${intText(PANEL_MAX_ROWS)} rows; a panel is limited to ${intText(PANEL_MAX_ROWS)} rows.`;
    }
  }
  return null;
}

const q = (s: string): string => `“${s}”`;

export interface PanelColumns {
  depName: string;
  y: Float64Array;
  /** Regressor columns (no constant), in the order of the model. */
  X: Float64Array[];
  names: string[];
  n: number;
  /** Entity code of each row (0…N−1, in order of first appearance). */
  entity: Int32Array;
  entityNames: string[];
  N: number;
  /** Time code of each row (0…T−1, in time order). */
  time: Int32Array;
  /** Display label of each period, in time order (the cell text as first seen). */
  timeLabels: string[];
  T: number;
  entityName: string;
  timeName: string;
  /** A named cluster column (codes 0…G−1), when one was asked for. */
  cluster?: { codes: Int32Array; G: number; name: string };
  /** 1-based data-row numbers of the rows used. */
  rowNumbers: number[];
  notes: string[];
  /** Adoption dates read from the treatment column over ALL rows (before listwise deletion), when asked for. */
  adoption?: RawAdoption;
}

/**
 * The treatment column read over every row that has an entity, a time and a treatment cell, before rows with a missing
 * outcome or control are dropped: a unit's adoption period is the first period its treatment is 1, whichever rows the
 * regression keeps. Periods are ranked among the periods of those rows.
 */
export interface RawAdoption {
  /** Raw rank of each panel period (time code → rank). */
  timeRank: Int32Array;
  /** Label of each raw rank. */
  rankLabels: string[];
  /** Raw rank of each panel entity's first treated period, −1 when never treated. */
  firstRank: Int32Array;
  /** 1 when the entity has an untreated row (treatment 0) before its adoption period. */
  hasPre: Uint8Array;
  /** Treated entities whose adoption an NA treatment cell may hide: the first such row (1-based), per entity. */
  hidden: { entity: number; row: number }[];
  /** A refusal found in a row the regression does not use (a treatment that switches off, or a value not 0/1). */
  error?: string;
}

export type PanelResult = { ok: true; panel: PanelColumns } | { ok: false; reason: string };

export interface PanelOptions {
  spec: RegSpec;
  entity: string;
  time: string;
  /** A cluster column other than the entity, by name. */
  cluster?: string;
  /** The treatment column (0/1), by name: its adoption dates are read over all rows (PanelColumns.adoption). */
  treatment?: string;
}

const INT_TIME = /^[-−]?\d{1,9}$/;

/** Reads the time cells of the rows that have one: a sortable key per row, or a refusal. */
function readTimes(
  data: RegDataset,
  tIdx: number,
): { ok: true; key: (number | null)[]; kind: string } | { ok: false; reason: string } {
  const cells = data.rows.map((r) => (r[tIdx] ?? "").trim());
  const present = cells.filter((c) => !isMissingCell(c));
  if (!present.length) return { ok: false, reason: `The time column ${q(data.names[tIdx])} is empty.` };
  const key: (number | null)[] = new Array(cells.length).fill(null);
  if (present.every((c) => INT_TIME.test(c))) {
    cells.forEach((c, i) => {
      if (!isMissingCell(c)) key[i] = Number(c.replace("−", "-"));
    });
    return { ok: true, key, kind: "whole numbers" };
  }
  let kind = "";
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (isMissingCell(c)) continue;
    const t = readDateToken(c, true);
    if (t && "error" in t) return { ok: false, reason: `Time column ${q(data.names[tIdx])}, row ${i + 1}: ${t.error}` };
    if (!t || t.len !== c.length) {
      return {
        ok: false,
        reason:
          `Time column ${q(data.names[tIdx])}, row ${i + 1}: ${q(c)} is neither a whole number nor a date or period ` +
          "(2024-03-31, 3/31/2024, 2024 Q1, 2024-03 or 2024).",
      };
    }
    const k = t.period === "day" ? "dates" : t.period === "year" ? "years" : t.period === "quarter" ? "quarters" : "months";
    if (kind && k !== kind) {
      return { ok: false, reason: `Time column ${q(data.names[tIdx])} mixes ${kind} and ${k} (row ${i + 1}: ${q(c)}). Use one kind of period.` };
    }
    kind = k;
    key[i] = t.from;
  }
  return { ok: true, key, kind };
}

/** Reads the panel: the model's columns, the entity and time of each row, and an optional cluster column. */
export function readPanel(data: RegDataset, opts: PanelOptions): PanelResult {
  if (data.rows.length > PANEL_MAX_ROWS) {
    return { ok: false, reason: `The table has ${intText(data.rows.length)} rows; a panel is limited to ${intText(PANEL_MAX_ROWS)} rows.` };
  }
  if (!opts.entity.trim()) return { ok: false, reason: "Name the entity column (the firm, person or country of each row)." };
  if (!opts.time.trim()) return { ok: false, reason: "Name the time column (the year, quarter or date of each row)." };
  const e = findColumn(data.names, opts.entity);
  if (typeof e !== "number") return { ok: false, reason: `Entity column: ${e.error}` };
  const t = findColumn(data.names, opts.time);
  if (typeof t !== "number") return { ok: false, reason: `Time column: ${t.error}` };
  if (e === t) return { ok: false, reason: `${q(data.names[e])} cannot be both the entity and the time column.` };
  let cIdx = -1;
  if (opts.cluster !== undefined) {
    if (!opts.cluster.trim()) return { ok: false, reason: "Name the cluster column (clustered standard errors)." };
    const c = findColumn(data.names, opts.cluster);
    if (typeof c !== "number") return { ok: false, reason: `Cluster column: ${c.error}` };
    cIdx = c;
  }
  const spec = opts.spec;
  if (!spec.dep) return { ok: false, reason: "Write the model as “y ~ x1 + x2”." };
  const dep = findColumn(data.names, spec.dep);
  if (typeof dep !== "number") return { ok: false, reason: dep.error };
  if (dep === e || dep === t) return { ok: false, reason: `${q(data.names[dep])} is the ${dep === e ? "entity" : "time"} column; it cannot be the response.` };
  // "." is every other column but the entity, time and cluster columns (they are labels, not regressors).
  const preds: string[] = [];
  for (const p of spec.preds) {
    if (p === ".") {
      data.names.forEach((nm, j) => {
        if (j !== dep && j !== e && j !== t && j !== cIdx && !preds.includes(nm)) preds.push(nm);
      });
      continue;
    }
    const pj = findColumn(data.names, p);
    if (typeof pj !== "number") return { ok: false, reason: pj.error };
    if (pj === e) return { ok: false, reason: `${q(data.names[pj])} is the entity column; it cannot also be a regressor.` };
    if (pj === t) {
      return { ok: false, reason: `${q(data.names[pj])} is the time column; it cannot also be a regressor (copy it to a new column for a trend).` };
    }
    preds.push(data.names[pj]);
  }
  const times = readTimes(data, t);
  if (!times.ok) return times;
  // Duplicates, on every row with an entity and a time.
  const seen = new Map<string, number>();
  for (let i = 0; i < data.rows.length; i++) {
    const ent = (data.rows[i][e] ?? "").trim();
    const k = times.key[i];
    if (isMissingCell(ent) || k === null) continue;
    // The key is a number, so the first "|" separates it from the entity text.
    const id = `${k}|${ent}`;
    const prev = seen.get(id);
    if (prev !== undefined) {
      return {
        ok: false,
        reason:
          `Rows ${prev + 1} and ${i + 1} both hold entity ${q(ent)} at time ${q((data.rows[i][t] ?? "").trim())}. ` +
          "A panel has one row per entity and period; remove or combine the duplicate.",
      };
    }
    seen.set(id, i);
  }
  const sel = selectColumns(data, { dep: data.names[dep], preds, text: spec.text }, { cluster: data.names[e] });
  if (!sel.ok) return sel;
  const c = sel.cols;
  const notes = [...c.notes];
  // The rows selectColumns kept, less those with a missing time or cluster cell.
  const keep: number[] = [];
  let noTime = 0;
  let noCluster = 0;
  for (let r = 0; r < c.rowNumbers.length; r++) {
    const i = c.rowNumbers[r] - 1;
    if (times.key[i] === null) {
      noTime++;
      continue;
    }
    if (cIdx >= 0 && isMissingCell(data.rows[i][cIdx] ?? "")) {
      noCluster++;
      continue;
    }
    keep.push(r);
  }
  if (noTime) notes.push(`${intText(noTime)} row${noTime === 1 ? "" : "s"} with no time ${noTime === 1 ? "was" : "were"} dropped.`);
  if (noCluster) notes.push(`${intText(noCluster)} row${noCluster === 1 ? "" : "s"} with no cluster id ${noCluster === 1 ? "was" : "were"} dropped.`);
  const n = keep.length;
  if (n === 0) return { ok: false, reason: "No row has every cell the model needs." };
  const y = new Float64Array(n);
  const X = c.X.map(() => new Float64Array(n));
  const entity = new Int32Array(n);
  const time = new Int32Array(n);
  const rowNumbers: number[] = new Array(n);
  const entMap = new Map<string, number>();
  const entityNames: string[] = [];
  // Distinct time keys, sorted.
  const keys = [...new Set(keep.map((r) => times.key[c.rowNumbers[r] - 1] as number))].sort((a, b) => a - b);
  const tCode = new Map<number, number>(keys.map((k, j) => [k, j]));
  const timeLabels: string[] = new Array(keys.length).fill("");
  const cMap = new Map<string, number>();
  const cCodes = cIdx >= 0 ? new Int32Array(n) : null;
  for (let a = 0; a < n; a++) {
    const r = keep[a];
    const i = c.rowNumbers[r] - 1;
    y[a] = c.y[r];
    for (let j = 0; j < X.length; j++) X[j][a] = c.X[j][r];
    const ent = c.clusters![r].trim();
    let code = entMap.get(ent);
    if (code === undefined) {
      code = entityNames.length;
      entMap.set(ent, code);
      entityNames.push(ent);
    }
    entity[a] = code;
    const tc = tCode.get(times.key[i] as number)!;
    time[a] = tc;
    if (!timeLabels[tc]) timeLabels[tc] = (data.rows[i][t] ?? "").trim();
    rowNumbers[a] = i + 1;
    if (cCodes) {
      const cv = (data.rows[i][cIdx] ?? "").trim();
      let cc = cMap.get(cv);
      if (cc === undefined) {
        cc = cMap.size;
        cMap.set(cv, cc);
      }
      cCodes[a] = cc;
    }
  }
  if (times.kind !== "whole numbers") notes.push(`The time column holds ${times.kind}, sorted by calendar day.`);
  let adoption: RawAdoption | undefined;
  if (opts.treatment !== undefined) {
    const di = findColumn(data.names, opts.treatment);
    if (typeof di !== "number") return { ok: false, reason: `Treatment column: ${di.error}` };
    adoption = rawAdoption(data, { e, di, key: times.key, entMap, keys, tName: data.names[t], tIdx: t });
  }
  return {
    ok: true,
    panel: {
      adoption,
      depName: c.depName,
      y,
      X,
      names: c.names,
      n,
      entity,
      entityNames,
      N: entityNames.length,
      time,
      timeLabels,
      T: keys.length,
      entityName: data.names[e],
      timeName: data.names[t],
      cluster: cCodes ? { codes: cCodes, G: cMap.size, name: data.names[cIdx] } : undefined,
      rowNumbers,
      notes,
    },
  };
}

/** The adoption dates of the panel's entities from the treatment column over every row (see RawAdoption). */
function rawAdoption(
  data: RegDataset,
  c: { e: number; di: number; key: (number | null)[]; entMap: Map<string, number>; keys: number[]; tName: string; tIdx: number },
): RawAdoption {
  const N = c.entMap.size;
  // Rows with an entity, a time and a treatment cell; NA treatment cells of the panel's entities kept apart.
  const rows: { i: number; ent: number; k: number; d: number }[] = [];
  const naRows: { i: number; ent: number; k: number }[] = [];
  const rawKeys = new Set<number>();
  const label = new Map<number, string>();
  let error: string | undefined;
  for (let i = 0; i < data.rows.length; i++) {
    const entText = (data.rows[i][c.e] ?? "").trim();
    const k = c.key[i];
    if (isMissingCell(entText) || k === null) continue;
    const ent = c.entMap.get(entText) ?? -1;
    const cell = (data.rows[i][c.di] ?? "").trim();
    const v = isMissingCell(cell) ? NaN : readRegCell(cell, !!data.semicolon).value;
    if (Number.isNaN(v)) {
      if (ent >= 0) naRows.push({ i, ent, k });
      continue;
    }
    if (v !== 0 && v !== 1 && !error) {
      error = `The treatment column ${q(data.names[c.di])} must be 0 or 1 in every row (row ${i + 1} holds ${numText(v)}).`;
    }
    rawKeys.add(k);
    if (!label.has(k)) label.set(k, (data.rows[i][c.tIdx] ?? "").trim());
    if (ent >= 0) rows.push({ i, ent, k, d: v });
  }
  const sorted = [...rawKeys].sort((a, b) => a - b);
  const rankOf = new Map<number, number>(sorted.map((k, r) => [k, r]));
  // Every panel period has a treatment cell (the treatment is a model column), so it has a raw rank.
  const timeRank = Int32Array.from(c.keys, (k) => rankOf.get(k) ?? -1);
  const rankLabels = sorted.map((k) => label.get(k) ?? "");
  rows.sort((a, b) => a.ent - b.ent || a.k - b.k);
  const firstKey = new Float64Array(N).fill(NaN);
  const lastZeroKey = new Float64Array(N).fill(-Infinity);
  const hasPre = new Uint8Array(N);
  const entNames: string[] = new Array(N);
  c.entMap.forEach((code, nm) => (entNames[code] = nm));
  for (const r of rows) {
    if (r.d === 1) {
      if (Number.isNaN(firstKey[r.ent])) firstKey[r.ent] = r.k;
    } else if (r.d === 0) {
      if (Number.isNaN(firstKey[r.ent])) {
        hasPre[r.ent] = 1;
        lastZeroKey[r.ent] = r.k;
      } else if (!error) {
        error =
          `Entity ${q(entNames[r.ent])} is treated in ${q(label.get(firstKey[r.ent]) ?? "")} but untreated again in ${q(label.get(r.k) ?? "")} (row ${r.i + 1}). ` +
          "Difference-in-differences here needs an absorbing treatment: once treated, always treated.";
      }
    }
  }
  const firstRank = new Int32Array(N).fill(-1);
  for (let g = 0; g < N; g++) if (!Number.isNaN(firstKey[g])) firstRank[g] = rankOf.get(firstKey[g])!;
  // An NA treatment cell after the entity's last untreated row and before its first treated row may hide an earlier adoption.
  const hiddenAt = new Int32Array(N).fill(-1);
  for (const r of naRows) {
    const f = firstKey[r.ent];
    if (Number.isNaN(f) || !(r.k < f) || !(r.k > lastZeroKey[r.ent])) continue;
    if (hiddenAt[r.ent] < 0 || r.i < hiddenAt[r.ent]) hiddenAt[r.ent] = r.i;
  }
  const hidden: { entity: number; row: number }[] = [];
  for (let g = 0; g < N; g++) if (hiddenAt[g] >= 0) hidden.push({ entity: g, row: hiddenAt[g] + 1 });
  return { timeRank, rankLabels, firstRank, hasPre, hidden, error };
}

/** Rows per entity: min, max, and whether every entity has every period. */
export function panelShape(p: PanelColumns): { minT: number; maxT: number; balanced: boolean; counts: Int32Array } {
  const counts = new Int32Array(p.N);
  for (let i = 0; i < p.n; i++) counts[p.entity[i]]++;
  let minT = Infinity;
  let maxT = 0;
  for (const c of counts) {
    if (c < minT) minT = c;
    if (c > maxT) maxT = c;
  }
  return { minT, maxT, balanced: minT === maxT && maxT === p.T, counts };
}
