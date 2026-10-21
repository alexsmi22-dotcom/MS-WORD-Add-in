/**
 * @jest-environment jsdom
 */
// The compound table block over its real markup (inside Reaction's register panel): the summary follows the register
// and the options, Insert hands Word one table with a picture per structure, and an empty register keeps Insert off.
import * as fs from "fs";
import * as path from "path";
import { Molecule } from "openchemlib/full";
import { initCompoundTablePane, fitCell, CELL_MAX_W, CELL_MAX_H } from "../../taskpane/compoundTablePane";
import type { CompoundRegister, RegisteredCompound } from "../compoundRegister";
import type { PictureTableInsert } from "../../host/host";
import { formulaText } from "../scheme";

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const BLOCK = /<div class="ct-block">[\s\S]*?<button id="ct-insert"[^>]*>[^<]*<\/button>\s*<\/div>/.exec(PANE_HTML)![0];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const entry = (label: string, smiles: string): RegisteredCompound => {
  const m = Molecule.fromSmiles(smiles);
  m.inventCoordinates();
  return { label, idcode: m.getIDCode(), smiles: m.toIsomericSmiles(), formula: formulaText(m), text: smiles };
};

function setup(reg: CompoundRegister) {
  document.body.innerHTML = BLOCK;
  const inserts: PictureTableInsert[] = [];
  const rasters: Array<{ w: number; h: number }> = [];
  const status: string[] = [];
  const api = initCompoundTablePane({
    setStatus: (t) => void status.push(t),
    loadRegister: () => reg,
    rasterize: async (_svg, w, h) => {
      rasters.push({ w, h });
      return "iVBORw0KGgo=";
    },
    insertPictureTable: async (o) => void inserts.push(o),
  });
  return { api, inserts, rasters, status };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("Compound table block", () => {
  it("sits inside Reaction's register panel", () => {
    const reg = /<details id="reaction-register"[\s\S]*?<\/details>/.exec(PANE_HTML)![0];
    expect(reg).toContain('id="ct-insert"');
  });

  it("an empty register: Insert off, and the note says how it fills", () => {
    setup({ entries: [] });
    expect(($("ct-insert") as HTMLButtonElement).disabled).toBe(true);
    expect($("ct-notes").textContent).not.toBe("");
  });

  it("the summary follows the register, the columns and the selection", () => {
    const reg: CompoundRegister = { entries: [entry("2", "CCO"), entry("1", "CC(=O)Oc1ccccc1C(=O)O")] };
    setup(reg);
    expect($("ct-summary").textContent).toMatch(/^2 compounds \(1, 2\)/);
    expect(($("ct-insert") as HTMLButtonElement).disabled).toBe(false);
    ($("ct-select") as HTMLInputElement).value = "2";
    $("ct-select").dispatchEvent(new Event("input"));
    expect($("ct-summary").textContent).toMatch(/^1 compound \(2\)/);
    ($("ct-select") as HTMLInputElement).value = "9";
    $("ct-select").dispatchEvent(new Event("input"));
    expect($("ct-notes").querySelector(".scheme-error")).not.toBeNull();
    expect(($("ct-insert") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Insert: one table, the header, a picture per structure at 300 dpi, the user's columns and caption", async () => {
    const reg: CompoundRegister = { entries: [entry("1", "CC(=O)Oc1ccccc1C(=O)O"), entry("2", "CCO")] };
    const { inserts, rasters, status } = setup(reg);
    ($("ct-extra") as HTMLInputElement).value = "IC50 (nM), Yield (%)";
    $("ct-extra").dispatchEvent(new Event("input"));
    ($("ct-caption") as HTMLInputElement).value = "Table 1. Compounds";
    $("ct-insert").click();
    for (let i = 0; i < 200 && !inserts.length; i++) await settle();
    expect(inserts).toHaveLength(1);
    const t = inserts[0];
    expect(t.label).toBe("Table 1. Compounds");
    expect(t.rows[0]).toEqual(["Compound", "Structure", "Name", "Formula", "MW (g/mol)", "IC50 (nM)", "Yield (%)"]);
    expect(t.rows).toHaveLength(3);
    const pic = t.rows[1][1] as { base64: string; widthPt: number; heightPt: number; alt: string };
    expect(pic.alt).toBe("Structure of compound 1");
    expect(pic.widthPt).toBeLessThanOrEqual(CELL_MAX_W);
    expect(pic.heightPt).toBeLessThanOrEqual(CELL_MAX_H);
    expect(rasters[0].w).toBe(Math.round((pic.widthPt * 300) / 72));
    expect(t.rows[2][2]).toBe("ethanol");
    expect(status.at(-1)).toMatch(/^Compound table inserted: 2 compounds\. Names come from the offline namer/);
    // The namer loads its dictionary on first use.
  }, 30000);

  it("fitCell keeps a small drawing's size and scales a large one into the cell, proportions kept", () => {
    expect(fitCell(60, 40)).toEqual({ w: 60, h: 40 });
    const big = fitCell(230, 90);
    expect(big.w).toBe(115);
    expect(big.h).toBe(45);
  });
});
