// The Characterization tool's pane: the chemist's measured data in, journal text out, with
// the checks beside it. All the reading, formatting and checking is lib/characterization.ts;
// this file only moves values between the form and that module, and inserts the SAME html the
// preview shows (as Word runs, via bibOoxml.inlineParagraphsOoxml).

import {
  CHAR_SOURCE,
  CharCompound,
  CharMessage,
  CharStyle,
  ION_TYPES,
  SOLVENTS,
  checkNmr,
  eaLine,
  exchangeableProtons,
  formatNmr,
  hrmsLine,
  htmlText,
  molarMass,
  parseNmr,
  physicalLines,
  protonCount,
  resolveCompound,
} from "../lib/characterization";
import { inlineParagraphsOoxml } from "../lib/bibOoxml";

export interface CharzPaneDeps {
  setStatus: (text: string, kind?: "success" | "error" | "") => void;
  /** Inserts an OOXML package after the selection; true when it reached the document. */
  insertOoxml: (ooxml: string, label: string) => Promise<boolean>;
  /** The structure drawn in Build, as SMILES — null when there is none (or it is generic). */
  buildSmiles: () => string | null;
  /** The document's compound register: what the Compound field reads ("compound 3" → its structure), and a note. */
  compoundInput?: (text: string, readsOtherwise: boolean) => { input: string; note: string | null; label: string | null };
}

export interface CharzPaneApi {
  update: () => void;
  /** The html lines the insert would put in, for tests. */
  lines: () => string[];
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function initCharzPane(deps: CharzPaneDeps): CharzPaneApi {
  const compoundIn = el<HTMLInputElement>("charz-compound");
  const fromBuild = el<HTMLButtonElement>("charz-from-build");
  const info = el<HTMLElement>("charz-compound-info");
  const style = el<HTMLSelectElement>("charz-style");
  const solvent = el<HTMLSelectElement>("charz-solvent");
  const hFreq = el<HTMLInputElement>("charz-h-freq");
  const hList = el<HTMLTextAreaElement>("charz-h-list");
  const cFreq = el<HTMLInputElement>("charz-c-freq");
  const cList = el<HTMLTextAreaElement>("charz-c-list");
  const msSource = el<HTMLSelectElement>("charz-ms-source");
  const msAnalyzer = el<HTMLSelectElement>("charz-ms-analyzer");
  const msIon = el<HTMLSelectElement>("charz-ms-ion");
  const msFound = el<HTMLInputElement>("charz-ms-found");
  const msOn = el<HTMLInputElement>("charz-ms-on");
  const state = el<HTMLInputElement>("charz-state");
  const mass = el<HTMLInputElement>("charz-mass");
  const scale = el<HTMLInputElement>("charz-scale");
  const mp = el<HTMLInputElement>("charz-mp");
  const rf = el<HTMLInputElement>("charz-rf");
  const eluent = el<HTMLInputElement>("charz-eluent");
  const ea = { C: el<HTMLInputElement>("charz-ea-c"), H: el<HTMLInputElement>("charz-ea-h"), N: el<HTMLInputElement>("charz-ea-n"), S: el<HTMLInputElement>("charz-ea-s") };
  const preview = el<HTMLElement>("charz-preview");
  const checks = el<HTMLElement>("charz-checks");
  const insertBtn = el<HTMLButtonElement>("charz-insert");
  const source = el<HTMLElement>("charz-source");

  for (const s of SOLVENTS) solvent.add(new Option(htmlText(s.html), s.key));
  for (const i of ION_TYPES) msIon.add(new Option(i.label, i.id));
  source.textContent = CHAR_SOURCE;

  let current: string[] = [];

  const update = (): void => {
    const st = style.value as CharStyle;
    const msgs: { where: string; m: CharMessage }[] = [];
    const add = (where: string, list: CharMessage[]): void => list.forEach((m) => msgs.push({ where, m }));
    const lines: string[] = [];

    // The compound.
    let c: CharCompound | null = null;
    let refused = false;
    info.textContent = "";
    if (compoundIn.value.trim()) {
      // "compound 3" (or a bare 3 that reads as nothing else) is the document's compound 3.
      let input = compoundIn.value;
      if (deps.compoundInput) {
        const pick = deps.compoundInput(input, !("refusal" in resolveCompound(input)));
        input = pick.input;
        if (pick.note) add("Compound", [{ level: "info", text: pick.note }]);
      }
      const r = resolveCompound(input);
      if ("refusal" in r) {
        refused = true;
        add("Compound", [{ level: "error", text: r.refusal }]);
      } else {
        c = r;
        const mw = molarMass(r);
        const ex = exchangeableProtons(r);
        const parts = [`${htmlText(r.formulaHtml)}`, typeof mw === "number" ? `MW ${mw.toFixed(2)} g/mol` : "", `${protonCount(r)} ¹H${ex ? ` (${ex} on O/N/S)` : ""}`];
        info.innerHTML = "";
        const f = document.createElement("span");
        f.innerHTML = r.formulaHtml;
        info.append(f, document.createTextNode(` · ${parts.slice(1).filter(Boolean).join(" · ")}`));
        if (r.note) add("Compound", [{ level: "info", text: r.note }]);
      }
    } else {
      add("Compound", [{ level: "info", text: "No compound: the lines are written, but nothing is checked against a formula and no Calcd values are given." }]);
    }

    // Physical data first, as an Example reads: yield, then mp and Rf.
    const phys = physicalLines(c, { massMg: mass.value, scaleMmol: scale.value, state: state.value, mp: mp.value, rf: rf.value, eluent: eluent.value });
    if ("refusal" in phys) add("Physical data", [{ level: "error", text: phys.refusal }]);
    else {
      lines.push(...phys.lines);
      add("Physical data", phys.messages);
    }

    const solv = solvent.value || undefined;
    for (const [nuc, box, freq, label] of [["1H", hList, hFreq, "¹H NMR"], ["13C", cList, cFreq, "¹³C NMR"]] as const) {
      if (!box.value.trim()) continue;
      const p = parseNmr(box.value, nuc);
      const o = { style: st, freq: freq.value, solvent: solv };
      if (p.peaks.length) lines.push(formatNmr(p, o));
      add(label, checkNmr(p, c, o));
    }

    if (msOn.checked) {
      if (!c) add("HRMS", [{ level: "warn", text: refused ? "The compound above was not read, so there is no Calcd." : "Name the compound to compute Calcd." }]);
      else {
        const h = hrmsLine(c, { ion: msIon.value, source: msSource.value, analyzer: msAnalyzer.value, found: msFound.value, style: st });
        if ("refusal" in h) add("HRMS", [{ level: "error", text: h.refusal }]);
        else {
          lines.push(h.html);
          add("HRMS", h.messages);
        }
      }
    }

    const eaFound = Object.fromEntries(Object.entries(ea).map(([k, el]) => [k, el.value]));
    if (Object.values(eaFound).some((v) => v.trim())) {
      if (!c) add("Elemental analysis", [{ level: "warn", text: refused ? "The compound above was not read, so there is no Calcd." : "Name the compound to compute Calcd." }]);
      else {
        const e = eaLine(c, eaFound);
        if ("refusal" in e) add("Elemental analysis", [{ level: "error", text: e.refusal }]);
        else {
          lines.push(e.html);
          add("Elemental analysis", e.messages);
        }
      }
    }

    current = lines;
    preview.replaceChildren();
    if (lines.length) {
      const p = document.createElement("p");
      p.className = "charz-text";
      // Only this module's tags and escaped user text (characterization.esc) reach innerHTML.
      p.innerHTML = lines.join(" ");
      preview.appendChild(p);
    } else {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = "Paste or type a ¹H or ¹³C list, or fill in HRMS, yield or analysis — the journal text appears here.";
      preview.appendChild(hint);
    }
    checks.replaceChildren();
    for (const { where, m } of msgs) {
      const li = document.createElement("li");
      li.className = `charz-check charz-${m.level}`;
      const tag = document.createElement("strong");
      tag.textContent = `${where}: `;
      li.append(tag, document.createTextNode(m.text));
      checks.appendChild(li);
    }
    insertBtn.disabled = !lines.length;
  };

  let timer = 0;
  const soon = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 120);
  };
  for (const el of [compoundIn, hFreq, hList, cFreq, cList, msFound, state, mass, scale, mp, rf, eluent, ...Object.values(ea)]) el.addEventListener("input", soon);
  for (const el of [style, solvent, msSource, msAnalyzer, msIon, msOn]) el.addEventListener("change", update);

  fromBuild.addEventListener("click", () => {
    const s = deps.buildSmiles();
    if (!s) {
      deps.setStatus("Nothing drawn in Build (or the drawing is generic — R groups have no formula).", "error");
      return;
    }
    compoundIn.value = `smiles:${s}`;
    update();
    deps.setStatus("The Build structure is the compound.", "success");
  });

  insertBtn.addEventListener("click", async () => {
    update();
    if (!current.length) {
      deps.setStatus("Nothing to insert yet.", "error");
      return;
    }
    const errors = checks.querySelectorAll(".charz-error").length;
    const ok = await deps.insertOoxml(inlineParagraphsOoxml([current.join(" ")]), "Characterization text");
    if (ok && errors) deps.setStatus(`Characterization text inserted — ${errors} check${errors > 1 ? "s" : ""} still flagged in the pane.`, "error");
  });

  update();
  return { update, lines: () => current.slice() };
}
