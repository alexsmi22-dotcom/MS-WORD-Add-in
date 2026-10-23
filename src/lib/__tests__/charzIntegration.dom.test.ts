/**
 * @jest-environment jsdom
 */
// The Characterization pane's "From an integration table" disclosure over the real markup: Write the ¹H list fills
// the ¹H box with the typed list the engine wrote, so the preview and Insert are the pane's existing path; the
// integration's messages show while the box still holds that text, and typing in the box breaks the link.
import * as fs from "fs";
import * as path from "path";
import { initCharzPane } from "../../taskpane/charzPane";
import { formatNmr, parseNmr } from "../characterization";

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="charz-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function setup() {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string]> = [];
  const api = initCharzPane({ setStatus: (t, k) => void status.push([t, k ?? ""]), insertOoxml: async () => true, buildSmiles: () => null });
  const set = (id: string, v: string) => {
    const e = $<HTMLInputElement>(id);
    e.value = v;
    e.dispatchEvent(new Event("input"));
  };
  const choose = (id: string, v: string) => {
    const e = $<HTMLSelectElement>(id);
    e.value = v;
    e.dispatchEvent(new Event("change"));
  };
  return { api, status, set, choose };
}

const EA_TABLE = "4.12\t2.00\tq\t7.1\n2.05\t3.02\ts\n1.26\t2.97\tt\t7.1";
const EA_TYPED = "4.12 (q, J = 7.1 Hz, 2H), 2.05 (s, 3H), 1.26 (t, J = 7.1 Hz, 3H)";

describe("Characterization pane: From an integration table", () => {
  it("has its controls; the reference row fields are enabled only for a reference row", () => {
    setup();
    for (const id of ["charz-int-table", "charz-int-ref", "charz-int-row", "charz-int-nh", "charz-int-exch", "charz-int-drop", "charz-int-fill"]) expect($(id)).not.toBeNull();
    expect($<HTMLInputElement>("charz-int-row").disabled).toBe(true);
    const { choose } = setup();
    choose("charz-int-ref", "row");
    expect($<HTMLInputElement>("charz-int-row").disabled).toBe(false);
  });

  it("an empty table adds nothing (typed behaviour unchanged)", () => {
    const { api, set } = setup();
    set("charz-h-list", EA_TYPED);
    api.update();
    expect($("charz-checks").textContent).not.toMatch(/integration/);
  });

  it("Write the ¹H list fills the ¹H box; the preview is formatNmr's line; messages show under ¹H integration", () => {
    const { api, status, set, choose } = setup();
    set("charz-compound", "ethyl acetate");
    choose("charz-solvent", "CDCl3");
    set("charz-h-freq", "400");
    set("charz-int-table", EA_TABLE);
    choose("charz-int-ref", "row");
    set("charz-int-row", "1");
    set("charz-int-nh", "2");
    $("charz-int-fill").click();
    expect($<HTMLTextAreaElement>("charz-h-list").value).toBe(EA_TYPED);
    expect(api.lines()[0]).toBe(formatNmr(parseNmr(EA_TYPED, "1H"), { style: "joc", freq: "400", solvent: "CDCl3" }));
    expect($("charz-checks").textContent).toMatch(/¹H integration: Counts scaled so that row 1 \(δ 4\.12\) is 2H/);
    expect($("charz-checks").textContent).toMatch(/±0\.15/);
    expect($("charz-checks").textContent).toMatch(/matching the formula/);
    expect(status.at(-1)).toEqual(["The ¹H list was written from the integration table (3 signals).", "success"]);
  });

  it("while linked, a new reference re-fits the box; typing in the box breaks the link", () => {
    const { set, choose } = setup();
    set("charz-compound", "formula:C4H8O2");
    set("charz-int-table", "4.12\t74.6\tq\t7.1\n2.05\t112.646\ts\n1.26\t110.781\tt\t7.1");
    choose("charz-int-ref", "formula");
    $("charz-int-fill").click();
    expect($<HTMLTextAreaElement>("charz-h-list").value).toBe(EA_TYPED);
    // The table edited: the box follows.
    set("charz-int-table", "4.12\t74.6\tq\t7.1\n2.05\t112.646\ts");
    jest.useFakeTimers();
    $<HTMLTextAreaElement>("charz-int-table").dispatchEvent(new Event("input"));
    jest.runAllTimers();
    jest.useRealTimers();
    expect($<HTMLTextAreaElement>("charz-h-list").value).toMatch(/^4\.12 \(q, J = 7\.1 Hz, 3\.2H\), 2\.05 \(s, 4\.8H\)$/);
    // The chemist edits the ¹H list by hand: the table no longer drives it, and its messages go.
    set("charz-h-list", "4.12 (q, J = 7.1 Hz, 2H)");
    choose("charz-int-ref", "as-written");
    expect($<HTMLTextAreaElement>("charz-h-list").value).toBe("4.12 (q, J = 7.1 Hz, 2H)");
    expect($("charz-checks").textContent).not.toMatch(/¹H integration/);
  });

  it("a refusal is said in the status bar and the ¹H box is left alone", () => {
    const { status, set, choose } = setup();
    set("charz-h-list", "7.26 (s, 1H)");
    set("charz-int-table", EA_TABLE);
    choose("charz-int-ref", "row");
    set("charz-int-row", "9");
    set("charz-int-nh", "2");
    $("charz-int-fill").click();
    expect($<HTMLTextAreaElement>("charz-h-list").value).toBe("7.26 (s, 1H)");
    expect(status.at(-1)).toEqual([expect.stringMatching(/Reference row 9 is not a row of the table/), "error"]);
    set("charz-int-table", "");
    $("charz-int-fill").click();
    expect(status.at(-1)?.[1]).toBe("error");
  });

  it("drop solvent peaks uses the Solvent menu", () => {
    const { set, choose } = setup();
    choose("charz-solvent", "CDCl3");
    set("charz-int-table", "7.26\t0.4\ts\n" + EA_TABLE);
    const drop = $<HTMLInputElement>("charz-int-drop");
    drop.checked = true;
    drop.dispatchEvent(new Event("change"));
    $("charz-int-fill").click();
    expect($<HTMLTextAreaElement>("charz-h-list").value).toBe("4.12 (q, J = 7.1 Hz, 2H), 2.05 (s, 3H), 1.26 (t, J = 7.1 Hz, 3H)");
    expect($("charz-checks").textContent).toMatch(/δ 7\.26 \(row 1\) left out: it is at the CDCl₃ residual/);
  });
});
