// The Antibody tool's pane (docs/SCOPE-ANTIBODY.md): VH/VL sequences in; their CDRs, numbering, identity matrix,
// claim text and SEQ ID table out, each inserted on its own. Every number comes from lib/antibody*.ts — the pane only
// shows it and hands it to Word.

import type { CdrDefinition, Scheme } from "../lib/antibody";
import {
  analyzeAntibodies,
  annotatedHtml,
  cdrRows,
  claimText,
  DEFINITION_NAMES,
  identityRows,
  numberingRows,
  pairChains,
  pairingNotes,
  regionRows,
  seqIdRows,
  seqIds,
  type Analysis,
  type IdentityScope,
} from "../lib/antibodyReport";

export interface AntibodyPaneDeps {
  setStatus: (text: string, kind?: "success" | "error" | "") => void;
  insertTable: (rows: string[][], label: string) => Promise<void>;
  /** Resolves false when the insert did not happen (the host has already said why). */
  insertText: (text: string) => Promise<boolean>;
  insertHtml: (html: string) => Promise<void>;
}

export interface AntibodyPaneApi {
  update: () => void;
}

/** Trastuzumab's VH and VL (public INN sequences), for the Example button. */
export const ANTIBODY_EXAMPLE = [
  ">Trastuzumab VH",
  "EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS",
  ">Trastuzumab VL",
  "DIQMTQSPSSLSASVGDRVTITCRASQDVNTAVAWYQQKPGKAPKLLIYSASFLYSGVPSRFSGSRSGTDFTLTISSLQPEDFATYYCQQHYTTPPTFGQGTKVEIK",
  ">Pertuzumab VH",
  "EVQLVESGGGLVQPGGSLRLSCAASGFTFTDYTMDWVRQAPGKGLEWVADVNPNSGGSIYNQRFKGRFTLSVDRSKNTLYLQMNSLRAEDTAVYYCARNLGPSFYFDYWGQGTLVTVSS",
  ">Pertuzumab VL",
  "DIQMTQSPSSLSASVGDRVTITCKASQDVSIGVAWYQQKPGKAPKLLIYSASYRYTGVPSRFSGSGSGTDFTLTISSLQPEDFATYYCQQYYIYPYTFGQGTKVEIK",
].join("\n");

export function initAntibodyPane(deps: AntibodyPaneDeps): AntibodyPaneApi {
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const input = el<HTMLTextAreaElement>("ab-input");
  const exampleBtn = el<HTMLButtonElement>("ab-example");
  const def = el<HTMLSelectElement>("ab-def");
  const scheme = el<HTMLSelectElement>("ab-scheme");
  const scope = el<HTMLSelectElement>("ab-scope");
  const seqStart = el<HTMLInputElement>("ab-seqid");
  const spell = el<HTMLInputElement>("ab-spell");
  const cdrTable = el<HTMLTableElement>("ab-cdrs");
  const idTable = el<HTMLTableElement>("ab-identity");
  const claimOut = el<HTMLElement>("ab-claims");
  const notesEl = el<HTMLElement>("ab-notes");
  // One constant per button (the host-trace gate finds insert buttons by "name = el<…>(\"id\")" and a listener naming
  // its insert handler).
  const cdrsBtn = el<HTMLButtonElement>("ab-insert-cdrs");
  const regionsBtn = el<HTMLButtonElement>("ab-insert-regions");
  const numberingBtn = el<HTMLButtonElement>("ab-insert-numbering");
  const identityBtn = el<HTMLButtonElement>("ab-insert-identity");
  const annotatedBtn = el<HTMLButtonElement>("ab-insert-annotated");
  const claimsBtn = el<HTMLButtonElement>("ab-insert-claims");
  const seqidsBtn = el<HTMLButtonElement>("ab-insert-seqids");
  const btns = { cdrs: cdrsBtn, regions: regionsBtn, numbering: numberingBtn, identity: identityBtn, annotated: annotatedBtn, claims: claimsBtn, seqids: seqidsBtn };

  let current: Analysis | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;

  const fill = (t: HTMLTableElement, rows: string[][]): void => {
    t.replaceChildren();
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      for (const c of r) {
        const cell = document.createElement(i === 0 ? "th" : "td");
        cell.textContent = c;
        tr.appendChild(cell);
      }
      t.appendChild(tr);
    });
  };
  const showNotes = (errors: string[], notes: string[]): void => {
    notesEl.replaceChildren();
    for (const [list, cls] of [[errors, "scheme-error"], [notes, "scheme-warn"]] as const) {
      for (const t of list) {
        const li = document.createElement("li");
        li.className = cls;
        li.textContent = t;
        notesEl.appendChild(li);
      }
    }
  };
  const d = (): CdrDefinition => def.value as CdrDefinition;
  // The first SEQ ID NO: a whole number from 1; anything else is said, and the claims wait for a real one.
  const start = (): number | null => {
    const t = seqStart.value.trim();
    const v = Number(t);
    return /^\d+$/.test(t) && v >= 1 && v < 1000000 ? v : null;
  };
  const START_ERROR = "First SEQ ID NO: a whole number from 1 to 999999.";
  const claims = (): string[] => {
    const s = start();
    return current && s !== null ? claimText(pairChains(current.chains), { def: d(), start: s, spellOut: spell.checked }) : [];
  };
  // Identity compares chains of one kind: it needs two heavy or two light chains.
  const comparable = (): boolean => {
    const h = current ? current.chains.filter((c) => c.r.chain === "H").length : 0;
    return h >= 2 || (current ? current.chains.length - h : 0) >= 2;
  };
  const setButtons = (): void => {
    const has = !!current && current.chains.length > 0;
    for (const b of Object.values(btns)) b.disabled = busy || !has;
    if (has) btns.identity.disabled = busy || !comparable();
    if (has && start() === null) btns.claims.disabled = btns.seqids.disabled = true;
  };

  const update = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    current = null;
    if (!input.value.trim()) {
      cdrTable.replaceChildren();
      idTable.replaceChildren();
      claimOut.textContent = "";
      notesEl.replaceChildren();
      setButtons();
      return;
    }
    const a = analyzeAntibodies(input.value);
    current = a.chains.length ? a : null;
    showNotes(a.errors, a.notes);
    if (!current) {
      cdrTable.replaceChildren();
      idTable.replaceChildren();
      claimOut.textContent = "";
      setButtons();
      return;
    }
    showNotes(start() === null ? [...a.errors, START_ERROR] : a.errors, [...a.notes, ...pairingNotes(pairChains(a.chains))]);
    fill(cdrTable, cdrRows(a.chains, d()));
    if (comparable()) fill(idTable, identityRows(a.chains, scope.value as IdentityScope, d()));
    else idTable.replaceChildren();
    claimOut.textContent = claims().join("\n\n");
    setButtons();
  };
  const soon = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, 200);
  };
  input.addEventListener("input", soon);
  seqStart.addEventListener("input", soon);
  for (const c of [def, scheme, scope, spell]) c.addEventListener("change", update);
  exampleBtn.addEventListener("click", () => {
    input.value = ANTIBODY_EXAMPLE;
    update();
  });

  const run = (what: () => Promise<string | null>) => async (): Promise<void> => {
    update();
    if (!current || busy) return;
    busy = true;
    setButtons();
    try {
      const said = await what();
      if (said) deps.setStatus(said, "success");
    } catch (e) {
      deps.setStatus(`Could not insert: ${(e as Error).message}`, "error");
    } finally {
      busy = false;
      setButtons();
    }
  };
  const defName = (): string => DEFINITION_NAMES[d()];
  const insertCdrTable = async (): Promise<string> => {
    await deps.insertTable(cdrRows(current!.chains, d()), `CDRs (${defName()})`);
    return `CDR table (${defName()}) inserted.`;
  };
  const insertRegionTables = async (): Promise<string> => {
    for (const c of current!.chains) await deps.insertTable(regionRows(c, d(), scheme.value as Scheme), `${c.name}: frameworks and CDRs (${defName()})`);
    return `Region table${current!.chains.length === 1 ? "" : "s"} inserted.`;
  };
  const insertNumberingTables = async (): Promise<string> => {
    for (const c of current!.chains) await deps.insertTable(numberingRows(c, d()), `${c.name}: numbering`);
    return `Numbering table${current!.chains.length === 1 ? "" : "s"} inserted.`;
  };
  const insertIdentityTable = async (): Promise<string> => {
    const sc = scope.value as IdentityScope;
    const what = sc === "v" ? "V domain" : sc === "fr" ? "frameworks" : `CDRs, ${defName()}`;
    await deps.insertTable(identityRows(current!.chains, sc, d()), `% identity (${what}; aligned by IMGT position)`);
    return "Identity table inserted.";
  };
  const insertAnnotated = async (): Promise<string> => {
    await deps.insertHtml(annotatedHtml(current!.chains, d()));
    return "Sequences inserted with their CDRs marked.";
  };
  const insertClaims = async (): Promise<string | null> => {
    return (await deps.insertText(claims().join("\n\n"))) ? "Claim text inserted — review it before filing." : null;
  };
  const insertSeqIdTable = async (): Promise<string> => {
    await deps.insertTable(seqIdRows(seqIds(pairChains(current!.chains), d(), start()!)), "Sequences");
    return "SEQ ID table inserted.";
  };
  cdrsBtn.addEventListener("click", run(insertCdrTable));
  regionsBtn.addEventListener("click", run(insertRegionTables));
  numberingBtn.addEventListener("click", run(insertNumberingTables));
  identityBtn.addEventListener("click", run(insertIdentityTable));
  annotatedBtn.addEventListener("click", run(insertAnnotated));
  claimsBtn.addEventListener("click", run(insertClaims));
  seqidsBtn.addEventListener("click", run(insertSeqIdTable));
  update();
  return { update };
}
