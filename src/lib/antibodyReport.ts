// The Antibody tool's reports (docs/SCOPE-ANTIBODY.md): several named chains in; the CDR table, each chain's regions
// with their numbering, a % identity matrix, claim text with SEQ ID NOs, a SEQ ID table and the sequences with their
// CDRs marked — every one from lib/antibody.ts's numbering. Pure: no Office.js.

import { CdrDefinition, ChainKind, ChainResult, cleanSequence, numberChain, Region, Scheme } from "./antibody";

export const DEFINITION_NAMES: Record<CdrDefinition, string> = { kabat: "Kabat", chothia: "Chothia", imgt: "IMGT", abm: "AbM" };
export const SCHEME_NAMES: Record<Scheme, string> = { kabat: "Kabat", chothia: "Chothia", imgt: "IMGT" };

export interface Entry {
  name: string;
  seq: string;
}
export interface NamedChain {
  name: string;
  r: ChainResult;
}

/**
 * FASTA records (">name" then the sequence — a blank line inside a record, as Word pastes leave, does not end it) or,
 * without names, blocks separated by blank lines; unnamed ones become "Sequence n". A name with no sequence is listed.
 */
export function parseEntries(text: string): { entries: Entry[]; empty: string[] } {
  const entries: Entry[] = [];
  const empty: string[] = [];
  let cur: (Entry & { named: boolean }) | null = null;
  const flush = (): void => {
    if (cur && cur.seq.replace(/\s/g, "")) entries.push({ name: cur.name, seq: cur.seq });
    else if (cur && cur.named) empty.push(cur.name);
    cur = null;
  };
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const t = raw.trim();
    if (t.startsWith(">")) {
      flush();
      cur = { name: t.slice(1).trim() || `Sequence ${entries.length + 1}`, seq: "", named: true };
    } else if (!t) {
      if (cur && cur.seq && !cur.named) flush();
    } else {
      if (!cur) cur = { name: `Sequence ${entries.length + 1}`, seq: "", named: false };
      cur.seq += t;
    }
  }
  flush();
  return { entries, empty };
}

export interface Analysis {
  chains: NamedChain[];
  errors: string[];
  notes: string[];
}

export const MAX_CHAINS = 40;

/** Notes about the residues around a domain cut out of a longer sequence: in a split they are the linker. */
const EDGE_NOTE = /before framework 1|after framework 4|starts at Kabat|ends inside framework 4/;

/** Every variable domain in one sequence (an scFv, a tandem, a bispecific), in order; null when none numbers. */
function splitDomains(seq: string): ChainResult[] {
  const r = numberChain(seq);
  if (!r.ok) return [];
  const before = seq.slice(0, r.offset), after = seq.slice(r.offset + r.domain.length);
  return [...(before.length >= 90 ? splitDomains(before) : []), r, ...(after.length >= 90 ? splitDomains(after) : [])];
}

/** A light chain that reads like a T-cell receptor β chain (CDR3 C-A-S-S…, J F-G-x-G-S-R-L-T-V). */
function looksLikeTcr(r: ChainResult): boolean {
  if (r.chain === "H") return false;
  const fr4 = r.regions.kabat[6].seq, l3 = r.cdrs.kabat.cdr3.seq;
  return /^AS[SR]/.test(l3) && /^FG.G[ST]R[LV]T[VL]/.test(fr4);
}

export function analyzeAntibodies(text: string): Analysis {
  const { entries, empty } = parseEntries(text);
  const errors: string[] = [];
  const notes: string[] = empty.map((n) => `${n}: no sequence under this name — left out.`);
  if (!entries.length) return { chains: [], errors: ["Nothing to read yet — paste a VH or VL sequence (or several, each under a >name line)."], notes };
  if (entries.length > MAX_CHAINS) return { chains: [], errors: [`${entries.length} sequences — at most ${MAX_CHAINS} at a time.`], notes };
  const chains: NamedChain[] = [];
  // Every name is unique: a repeated one gets the first free “(n)”, never one already pasted.
  const taken = new Set<string>();
  const unique = (base: string): string => {
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
    taken.add(name);
    return name;
  };
  for (const e of entries) taken.add(e.name);
  const used = new Set<string>();
  for (const e of entries) {
    const name = used.has(e.name) ? unique(e.name) : e.name;
    used.add(name);
    const cleaned = cleanSequence(e.seq);
    if (cleaned.errors.length) {
      errors.push(`${name}: ${cleaned.errors.join(" ")}`);
      continue;
    }
    const r = numberChain(e.seq);
    if (!r.ok) {
      errors.push(`${name}: ${r.errors.join(" ")}`);
      continue;
    }
    const doms = splitDomains(cleaned.seq);
    let named: NamedChain[];
    if (doms.length > 1) {
      // Two domains of different kinds are the VH and VL of one molecule; anything else is numbered in order.
      const kinds = doms.map((d) => (d.chain === "H" ? "VH" : "VL"));
      const byKind = doms.length === 2 && kinds[0] !== kinds[1];
      named = doms.map((d, i) => ({ name: unique(byKind ? `${name} ${kinds[i]}` : `${name} (${i + 1})`), r: { ...d, notes: d.notes.filter((t) => !EDGE_NOTE.test(t)) } }));
      notes.push(`${name}: ${["", "", "two", "three", "four"][doms.length] ?? doms.length} variable domains in one sequence (an scFv?) — read as ${named.map((c) => `“${c.name}”`).join(" and ")}; the linker is left out.`);
    } else named = [{ name, r }];
    for (const c of named) {
      for (const t of c.r.notes) notes.push(`${c.name}: ${t}`);
      if (looksLikeTcr(c.r)) notes.push(`${c.name}: this reads like a T-cell receptor β chain (CDR3 ${c.r.cdrs.kabat.cdr3.seq.slice(0, 4)}…, framework 4 ${c.r.regions.kabat[6].seq.slice(0, 9)}), not an antibody — the numbering and claims here are for antibodies.`);
      chains.push(c);
    }
  }
  return { chains, errors, notes };
}

const cdrPrefix = (k: ChainKind): string => (k === "H" ? "H" : "L");

/** One row per chain: name, chain, and its three CDRs (with lengths) under one definition. */
export function cdrRows(chains: NamedChain[], def: CdrDefinition): string[][] {
  const head = ["Chain", "Type", `CDR1 (${DEFINITION_NAMES[def]})`, "CDR2", "CDR3"];
  return [
    head,
    ...chains.map(({ name, r }) => {
      const c = r.cdrs[def];
      const p = cdrPrefix(r.chain);
      return [name, r.chain === "H" ? "VH" : r.chain === "K" ? "VL (κ)" : "VL (λ)", `${c.cdr1.seq} (${p}1, ${c.cdr1.seq.length})`, `${c.cdr2.seq} (${p}2, ${c.cdr2.seq.length})`, `${c.cdr3.seq} (${p}3, ${c.cdr3.seq.length})`];
    }),
  ];
}

/** A chain's frameworks and CDRs: positions in the chosen scheme, the residues, the length. */
export function regionRows(c: NamedChain, def: CdrDefinition, scheme: Scheme): string[][] {
  const labels = c.r.numbering[scheme];
  const pre = c.r.chain === "H" ? "H" : "L";
  const rows: string[][] = [["Region", `${SCHEME_NAMES[scheme]} positions`, "Sequence", "Length"]];
  for (const g of c.r.regions[def]) {
    const name = g.name.startsWith("CDR") ? `CDR-${pre}${g.name.slice(3)}` : g.name;
    const pos = g.end > g.start ? `${labels[g.start]}–${labels[g.end - 1]}` : "—";
    rows.push([name, pos, g.seq, String(g.seq.length)]);
  }
  return rows;
}

/** The numbering itself, one row per residue: scheme position, residue, region. */
export function numberingRows(c: NamedChain, def: CdrDefinition): string[][] {
  const reg = c.r.regions[def];
  const regionOf = (i: number): Region["name"] => reg.find((g) => i >= g.start && i < g.end)!.name;
  return [
    ["Residue", "Kabat", "Chothia", "IMGT", `Region (${DEFINITION_NAMES[def]})`],
    ...[...c.r.domain].map((aa, i) => [aa, c.r.numbering.kabat[i], c.r.numbering.chothia[i], c.r.numbering.imgt[i], regionOf(i)]),
  ];
}

export type IdentityScope = "v" | "fr" | "cdr";

/**
 * Percent identity between two chains, aligned by IMGT position (the scheme built for comparing domains): identical
 * residues ÷ positions occupied in either chain, so a gap counts as a difference. Scope: the whole V domain, the
 * frameworks only, or the CDRs only (under `def`).
 */
export function identity(a: NamedChain, b: NamedChain, scope: IdentityScope, def: CdrDefinition): number {
  const map = (c: NamedChain): Map<string, string> => {
    const m = new Map<string, string>();
    const reg = c.r.regions[def];
    [...c.r.domain].forEach((aa, i) => {
      const g = reg.find((x) => i >= x.start && i < x.end)!.name;
      const inCdr = g.startsWith("CDR");
      if (scope === "v" || (scope === "cdr") === inCdr) m.set(c.r.numbering.imgt[i], aa);
    });
    return m;
  };
  const ma = map(a), mb = map(b);
  const keys = new Set([...ma.keys(), ...mb.keys()]);
  if (!keys.size) return NaN;
  let same = 0;
  for (const k of keys) if (ma.get(k) !== undefined && ma.get(k) === mb.get(k)) same++;
  return (100 * same) / keys.size;
}

/** The matrix for chains of one kind (heavy with heavy, light with light); a heavy–light pair is not compared. */
export function identityRows(chains: NamedChain[], scope: IdentityScope, def: CdrDefinition): string[][] {
  const rows: string[][] = [["", ...chains.map((c) => c.name)]];
  for (const a of chains) {
    rows.push([
      a.name,
      ...chains.map((b) => {
        if (a === b) return "100";
        if ((a.r.chain === "H") !== (b.r.chain === "H")) return "—";
        const v = identity(a, b, scope, def);
        return Number.isFinite(v) ? v.toFixed(1) : "—";
      }),
    ]);
  }
  return rows;
}

export interface Antibody {
  name: string;
  vh: NamedChain | null;
  vl: NamedChain | null;
  /** A lone heavy domain with the camelid VHH hallmarks (Kabat 37, 44, 45, 47): a single-domain antibody. */
  vhh: boolean;
}

/** The name a chain shares with its partner: "Trastuzumab VH" → "Trastuzumab". */
/** A role word as its own token: VH, VL, HC, LC, heavy (chain), light (chain), kappa, lambda, κ, λ (VH1 too). */
const ROLE_TOKEN = /(^|[\s_.\-(])((?:VH|VL|VK|HC|LC|heavy(?:[\s_\-]chain)?|light(?:[\s_\-]chain)?|kappa|lambda|κ|λ)\d*(?:[\s_\-]+(?:kappa|lambda|κ|λ))?)(?=$|[\s_.\-)])/gi;

/**
 * The name with its role word taken out: "X VH (clone 3)" → "X (clone 3)", "Ab1_VL" → "Ab1", "X(VH)" → "X". Everything
 * else stays, so "(clone 3)" and "(clone 4)" never pair, while "(humanized)" on both chains does.
 */
function stem(name: string): string {
  const s = name.trim();
  const hits = [...s.matchAll(ROLE_TOKEN)];
  let out: string;
  if (hits.length) {
    const h = hits[hits.length - 1];
    const at = h.index! + h[1].length;
    out = s.slice(0, at) + s.slice(at + h[2].length);
  } else {
    // A lone H, L or K at the very end ("Fab H", "Ab 12 L").
    const m = /[\s_.\-](H|L|K)$/i.exec(s);
    if (!m) return name;
    out = s.slice(0, m.index);
  }
  out = out.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/^[\s_.\-]+|[\s_.\-]+$/g, "").trim();
  return out || name;
}

/** Which chain a name says it is ("X VL" → light), or null when it does not say. */
function namedRole(name: string): "H" | "L" | null {
  const hits = [...name.matchAll(ROLE_TOKEN)];
  if (!hits.length) return null;
  return /^(VH|HC|heavy)/i.test(hits[hits.length - 1][2]) ? "H" : "L";
}

/**
 * The VHH hallmarks: framework 2 reads F/Y-37, E/Q-44, R/C-45, F/G/L-47 where a conventional VH, which pairs with a VL,
 * has V-37, G-44, L-45, W-47. Two or more mark a single-domain antibody.
 */
function isVhh(c: NamedChain): boolean {
  if (c.r.chain !== "H") return false;
  const at = (p: string): string => c.r.domain[c.r.numbering.kabat.indexOf(p)] ?? "";
  return [/[FY]/.test(at("37")), /[EQ]/.test(at("44")), /[RC]/.test(at("45")), /[FGL]/.test(at("47"))].filter(Boolean).length >= 2;
}

/**
 * Chains paired by name — "X VH" with "X VL", "X heavy" with "X light", the two halves of an scFv — whatever order they
 * were pasted in. With no names at all, one VH and one VL pasted alone are the two chains of one antibody. Anything
 * else stands on its own and pairingNotes says so.
 */
export function pairChains(chains: NamedChain[]): Antibody[] {
  const out: Antibody[] = [];
  const used = new Set<NamedChain>();
  const heavy = chains.filter((c) => c.r.chain === "H"), light = chains.filter((c) => c.r.chain !== "H");
  const unnamed = (c: NamedChain): boolean => /^Sequence \d+$/.test(c.name);
  const solo = heavy.length === 1 && light.length === 1 && chains.length === 2 && chains.every(unnamed);
  const key = (c: NamedChain): string => stem(c.name).toLowerCase();
  // A pair needs a shared name and a role word on at least one of the two ("Fab" + "Fab H" pair; "Fab" + "Fab" do not).
  const pairs = (a: NamedChain, b: NamedChain): boolean => solo || (key(a) === key(b) && (stem(a.name) !== a.name || stem(b.name) !== b.name));
  const names = new Set<string>();
  const uniqueName = (base: string): string => {
    let n = base;
    for (let i = 2; names.has(n); i++) n = `${base} (${i})`;
    names.add(n);
    return n;
  };
  // Pairs where both names carry a role word ("X VH" + "X VL") are made first, so a bare "X" (a VHH, say) never takes
  // a VL that has its own "X VH"; then pairs where only one does.
  const mateOf = new Map<NamedChain, NamedChain>();
  const roleWord = (c: NamedChain): boolean => stem(c.name) !== c.name;
  for (const strict of [true, false]) {
    for (const c of chains) {
      if (mateOf.has(c) || (strict && !roleWord(c))) continue;
      const pool = c.r.chain === "H" ? light : heavy;
      const m = pool.find((x) => x !== c && !mateOf.has(x) && (!strict || roleWord(x)) && pairs(c, x));
      if (m) mateOf.set(c, m).set(m, c);
    }
  }
  for (const c of chains) {
    if (used.has(c)) continue;
    const mate = mateOf.get(c) ?? null;
    used.add(c);
    if (mate) used.add(mate);
    const vh = c.r.chain === "H" ? c : mate, vl = c.r.chain === "H" ? mate : c;
    // The antibody's name is the shared stem ("X"), or a lone chain's own stem; two antibodies never share one.
    const base = vh && vl ? (key(vh) === key(vl) ? stem(vh.name) : `${vh.name} / ${vl.name}`) : stem(c.name);
    out.push({ name: uniqueName(base), vh, vl, vhh: !!vh && !vl && isVhh(vh) });
  }
  return out;
}

/** What the pairing did that the user should know: chains claimed on their own, names that say the other chain. */
export function pairingNotes(abs: Antibody[]): string[] {
  const notes: string[] = [];
  for (const ab of abs) {
    if (ab.vh && !ab.vl && !ab.vhh) notes.push(`${ab.vh.name}: a VH with no VL of the same name — claimed on its own. Name the pair alike (“X VH”, “X VL”) to claim them together.`);
    if (ab.vl && !ab.vh) notes.push(`${ab.vl.name}: a VL with no VH of the same name — claimed on its own.`);
    for (const [c, k] of [[ab.vh, "H"], [ab.vl, "L"]] as const) {
      if (c && namedRole(c.name) && namedRole(c.name) !== k) notes.push(`${c.name}: named as a ${k === "H" ? "light" : "heavy"} chain, but it reads as a ${k === "H" ? "heavy" : "light"} chain — check the name.`);
    }
  }
  return notes;
}

export type SeqIdRole = "HCDR1" | "HCDR2" | "HCDR3" | "LCDR1" | "LCDR2" | "LCDR3" | "VH" | "VL";

export interface SeqIdItem {
  id: number;
  description: string;
  seq: string;
  /** Which antibody (its index in the list) and which part of it. */
  ab: number;
  role: SeqIdRole;
}

/**
 * SEQ ID NOs in order: for each antibody its CDRs (under `def`), then its VH and VL. WIPO ST.26 keeps sequences of
 * fewer than four residues out of a sequence listing, so a CDR that short gets no number (claimText writes it out).
 */
export function seqIds(abs: Antibody[], def: CdrDefinition, start = 1): SeqIdItem[] {
  const out: SeqIdItem[] = [];
  let id = start;
  abs.forEach((ab, n) => {
    for (const [c, p] of [[ab.vh, "H"], [ab.vl, "L"]] as const) {
      if (!c) continue;
      const k = c.r.cdrs[def];
      [k.cdr1, k.cdr2, k.cdr3].forEach((g, i) => {
        if (g.seq.length >= MIN_SEQ_ID) out.push({ id: id++, description: `${ab.name} ${p}CDR${i + 1} (${DEFINITION_NAMES[def]})`, seq: g.seq, ab: n, role: `${p}CDR${i + 1}` as SeqIdRole });
      });
    }
    for (const [c, p] of [[ab.vh, "VH"], [ab.vl, "VL"]] as const) if (c) out.push({ id: id++, description: `${ab.name} ${p}`, seq: c.r.domain, ab: n, role: p });
  });
  return out;
}

/** ST.26: a sequence listing holds sequences of four or more residues. */
export const MIN_SEQ_ID = 4;

export function seqIdRows(items: SeqIdItem[]): string[][] {
  return [["SEQ ID NO", "Description", "Sequence"], ...items.map((s) => [String(s.id), s.description, s.seq])];
}

export interface ClaimOptions {
  def: CdrDefinition;
  start?: number;
  /** Write each CDR's residues out beside its SEQ ID NO. */
  spellOut?: boolean;
  /** Percent identity for the variable-region dependent claim (default 90). */
  percent?: number;
}

/**
 * Claim text for each antibody: the six-CDR claim, the VH/VL claim and the identity claim. Wording follows common US
 * practice ("comprising the amino acid sequence of SEQ ID NO: n"); the CDR definition is named, since a CDR means
 * nothing without one.
 */
export function claimText(abs: Antibody[], o: ClaimOptions): string[] {
  const ids = seqIds(abs, o.def, o.start ?? 1);
  const pct = o.percent ?? 90;
  const out: string[] = [];
  let claim = 1;
  abs.forEach((ab, n) => {
    const item = (role: SeqIdRole): SeqIdItem | undefined => ids.find((s) => s.ab === n && s.role === role);
    const idOf = (role: SeqIdRole): number => item(role)!.id;
    // A CDR under four residues has no SEQ ID NO (ST.26): its residues are written out.
    const cite = (role: SeqIdRole, seq: string): string => {
      const s = item(role);
      if (!s) return `the amino acid sequence ${seq}`;
      return o.spellOut ? `the amino acid sequence ${s.seq} (SEQ ID NO: ${s.id})` : `the amino acid sequence of SEQ ID NO: ${s.id}`;
    };
    const three = (p: "H" | "L", lead: string): string => {
      const c = (p === "H" ? ab.vh : ab.vl)!.r.cdrs[o.def];
      const g = [c.cdr1, c.cdr2, c.cdr3];
      return [0, 1, 2].map((i) => `${i === 2 ? "and " : ""}${lead}${p}CDR${i + 1} comprising ${cite(`${p}CDR${i + 1}` as SeqIdRole, g[i].seq)}`).join(", ");
    };
    const defn = `wherein the CDRs are defined according to the ${DEFINITION_NAMES[o.def]} ${o.def === "abm" ? "definition" : "numbering scheme"}`;
    const first = claim;
    if (ab.vh && ab.vl) {
      out.push(`${claim++}. An isolated antibody, or antigen-binding fragment thereof, comprising a heavy chain variable region (VH) and a light chain variable region (VL), wherein the VH comprises ${three("H", "an ")}; and the VL comprises ${three("L", "an ")}; ${defn}.`);
      out.push(`${claim++}. The antibody or antigen-binding fragment of claim ${first}, wherein the VH comprises the amino acid sequence of SEQ ID NO: ${idOf("VH")} and the VL comprises the amino acid sequence of SEQ ID NO: ${idOf("VL")}.`);
      out.push(`${claim++}. The antibody or antigen-binding fragment of claim ${first}, wherein the VH comprises an amino acid sequence at least ${pct}% identical to SEQ ID NO: ${idOf("VH")} and the VL comprises an amino acid sequence at least ${pct}% identical to SEQ ID NO: ${idOf("VL")}.`);
    } else if (ab.vh && ab.vhh) {
      out.push(`${claim++}. An isolated single-domain antibody, or antigen-binding fragment thereof, comprising a variable domain that comprises ${three("H", "a ").replace(/a H(CDR\d)/g, "a $1")}; ${defn}.`);
      out.push(`${claim++}. The single-domain antibody of claim ${first}, comprising the amino acid sequence of SEQ ID NO: ${idOf("VH")}.`);
    } else if (ab.vh) {
      out.push(`${claim++}. An isolated antibody, or antigen-binding fragment thereof, comprising a heavy chain variable region (VH) that comprises ${three("H", "an ")}; ${defn}.`);
      out.push(`${claim++}. The antibody or antigen-binding fragment of claim ${first}, wherein the VH comprises the amino acid sequence of SEQ ID NO: ${idOf("VH")}.`);
    } else if (ab.vl) {
      out.push(`${claim++}. An isolated antibody, or antigen-binding fragment thereof, comprising a light chain variable region (VL) that comprises ${three("L", "an ")}; ${defn}.`);
      out.push(`${claim++}. The antibody or antigen-binding fragment of claim ${first}, wherein the VL comprises the amino acid sequence of SEQ ID NO: ${idOf("VL")}.`);
    }
  });
  return out;
}

const escHtml = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The domains in a fixed-width font, ten residues to a group, the CDRs under `def` bold and underlined. */
export function annotatedHtml(chains: NamedChain[], def: CdrDefinition): string {
  const parts: string[] = [];
  for (const { name, r } of chains) {
    const cdr = new Set<number>();
    for (const g of [r.cdrs[def].cdr1, r.cdrs[def].cdr2, r.cdrs[def].cdr3]) for (let i = g.start; i < g.end; i++) cdr.add(i);
    let html = "";
    let open = false;
    [...r.domain].forEach((aa, i) => {
      if (i > 0 && i % 10 === 0) {
        // The space between groups is never underlined.
        if (open) (html += "</u></b>"), (open = false);
        html += " ";
      }
      if (cdr.has(i) && !open) (html += "<b><u>"), (open = true);
      if (!cdr.has(i) && open) (html += "</u></b>"), (open = false);
      html += aa;
    });
    if (open) html += "</u></b>";
    parts.push(`<p style="margin:0 0 2pt 0"><b>${escHtml(name)}</b> — ${r.chain === "H" ? "VH" : r.chain === "K" ? "VL (κ)" : "VL (λ)"}, ${r.domain.length} residues</p><p style="font-family:'Courier New',monospace;margin:0 0 8pt 0">${html}</p>`);
  }
  parts.push(`<p style="margin:0"><i>CDRs (${DEFINITION_NAMES[def]}) in bold, underlined.</i></p>`);
  return parts.join("");
}
