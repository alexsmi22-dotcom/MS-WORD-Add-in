/**
 * @jest-environment jsdom
 */
// The Solid form pane over its real markup: Example fills the box for each kind, the preview, table and sentence come
// from the engine, the options reach it, and each Insert hands over what the pane shows.
import * as fs from "fs";
import * as path from "path";
import { initSolidformPane } from "../../taskpane/solidformPane";

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="solidform-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setup() {
  document.body.innerHTML = SECTION;
  const figures: Array<{ svg: string; alt: string; chartKind: string; wide: string }> = [];
  const texts: string[] = [];
  const tables: Array<{ rows: string[][]; label: string }> = [];
  const status: string[] = [];
  const api = initSolidformPane({
    setStatus: (t) => void status.push(t),
    insertFigure: async (o) => {
      figures.push({ svg: o.svg, alt: o.alt, chartKind: o.chartKind, wide: o.render(600) });
      return "as PNG";
    },
    insertText: async (t) => {
      texts.push(t);
      return true;
    },
    insertTable: async (rows, label) => void tables.push({ rows, label }),
  });
  return { api, figures, texts, tables, status };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const choose = (id: string, v: string) => {
  ($(id) as HTMLSelectElement).value = v;
  $(id).dispatchEvent(new Event("change"));
};

describe("Solid form pane", () => {
  it("is in the tool list with every control the module reads, and starts with nothing to insert", () => {
    expect(PANE_HTML).toContain('<option value="solidform">Solid form</option>');
    setup();
    for (const id of ["solid-insert-fig", "solid-insert-table", "solid-insert-text"]) expect(($(id) as HTMLButtonElement).disabled).toBe(true);
    expect($("solid-help").textContent).toMatch(/2θ/);
  });
  it("XRPD Example: preview, peak table and claim sentence; each Insert hands over what is shown", async () => {
    const { figures, texts, tables } = setup();
    $("solid-example").click();
    expect($("solid-preview").innerHTML).toMatch(/^<svg/);
    expect($("solid-table").querySelectorAll("tr").length).toBe(11);
    expect($("solid-text").textContent).toMatch(/peaks at 2θ angles of about 6\.8°, 13\.6°, 17\.2°, 18\.9° and 21\.3° ± 0\.2° 2θ, measured with Cu Kα1 radiation\.$/);
    ($("solid-subject") as HTMLInputElement).value = "Crystalline Form A of compound 1";
    $("solid-subject").dispatchEvent(new Event("input"));
    $("solid-insert-text").click();
    await flush();
    expect(texts[0]).toMatch(/^Crystalline Form A of compound 1, characterized by/);
    $("solid-insert-table").click();
    await flush();
    expect(tables[0].rows[0]).toEqual(["2θ (°)", "d (Å)", "Relative intensity (%)"]);
    $("solid-insert-fig").click();
    await flush();
    expect(figures[0].chartKind).toBe("solid-xrpd");
    expect(figures[0].wide).toMatch(/width="600"/);
    expect(figures[0].alt).toMatch(/^XRPD pattern \(JurisLab\): Crystalline Form A/);
  });
  it("the options reach the engine: radiation, peaks cited, tolerance", () => {
    setup();
    ($("solid-input") as HTMLTextAreaElement).value = "20 100\n25 50\n30 80";
    choose("solid-wavelength", "MoKa1");
    choose("solid-tol", "0.1");
    ($("solid-cite") as HTMLInputElement).value = "2";
    $("solid-cite").dispatchEvent(new Event("input"));
    choose("solid-kind", "xrpd");
    expect($("solid-table").textContent).toContain("2.04");
    expect($("solid-text").textContent).toMatch(/about 20\.0° and 30\.0° ± 0\.1° 2θ, measured with Mo Kα1/);
  });
  it("DSC and TGA: the kind swaps the options and the units; the sentences read the events", () => {
    setup();
    choose("solid-kind", "dsc");
    expect($("solid-xrpd-opts").style.display).toBe("none");
    expect(($("solid-yunits") as HTMLInputElement).value).toBe("W/g");
    $("solid-example").click();
    expect($("solid-text").textContent).toMatch(/endotherm with an onset at about 18\d\.\d °C/);
    choose("solid-kind", "tga");
    expect($("solid-endo-row").style.display).toBe("none");
    // TGA is drawn in %: no units box to fill in.
    expect($("solid-units-row").style.display).toBe("none");
    $("solid-example").click();
    expect($("solid-table").querySelectorAll("tr").length).toBe(3);
  });
  it("a three-column export shows the column pickers; choosing another column re-reads the data; typed units stay", () => {
    setup();
    choose("solid-kind", "dsc");
    const rows = ["Time (min)\tTemperature (°C)\tHeat Flow (W/g)"];
    for (let T = 30; T <= 250; T += 0.5) rows.push(`${((T - 30) / 10).toFixed(2)}\t${T.toFixed(1)}\t${(-0.05 - 2.4 * Math.exp(-((T - 186) ** 2) / (2 * 1.6 ** 2))).toFixed(5)}`);
    ($("solid-input") as HTMLTextAreaElement).value = rows.join("\n");
    ($("solid-yunits") as HTMLInputElement).value = "mW";
    $("solid-yunits").dispatchEvent(new Event("input"));
    choose("solid-endo", "down");
    expect($("solid-cols-row").hidden).toBe(false);
    expect(($("solid-xcol") as HTMLSelectElement).value).toBe("1");
    expect(($("solid-ycol") as HTMLSelectElement).value).toBe("2");
    expect($("solid-text").textContent).toMatch(/endotherm with an onset at about 18\d\.\d °C/);
    expect($("solid-preview").innerHTML).toContain("Heat flow (mW)");
    // Read time as the temperature instead: the events move with it.
    choose("solid-xcol", "0");
    expect(($("solid-xcol") as HTMLSelectElement).value).toBe("0");
    expect($("solid-text").textContent).not.toMatch(/18\d\.\d °C/);
    choose("solid-kind", "tga");
    choose("solid-kind", "dsc");
    expect(($("solid-yunits") as HTMLInputElement).value).toBe("mW");
  });
  it("a column choice made on one file is not carried to a different file; the header's unit fills the box", () => {
    setup();
    choose("solid-kind", "dsc");
    const fileA = ["Time (min)\tTemperature (°C)\tHeat Flow (W/g)"];
    for (let T = 30; T <= 250; T += 0.5) fileA.push(`${((T - 30) / 10).toFixed(2)}\t${T}\t${(-0.05 - 2.4 * Math.exp(-((T - 186) ** 2) / 5.12)).toFixed(5)}`);
    ($("solid-input") as HTMLTextAreaElement).value = fileA.join("\n");
    $("solid-input").dispatchEvent(new Event("input"));
    choose("solid-endo", "down");
    choose("solid-xcol", "1");
    const fileB = ["Temperature (°C)\tHeat Flow (mW)\tTime (min)"];
    for (let T = 30; T <= 250; T += 0.5) fileB.push(`${T}\t${(-0.05 - 2.4 * Math.exp(-((T - 186) ** 2) / 5.12)).toFixed(5)}\t${((T - 30) / 10).toFixed(2)}`);
    ($("solid-input") as HTMLTextAreaElement).value = fileB.join("\n");
    choose("solid-endo", "down"); // one update, as a paste would trigger
    expect(($("solid-xcol") as HTMLSelectElement).value).toBe("0");
    expect($("solid-text").textContent).toMatch(/onset at about 18\d\.\d °C/);
    expect(($("solid-yunits") as HTMLInputElement).value).toBe("mW");
  });
  it("a refusal empties the outputs and says why", () => {
    setup();
    ($("solid-input") as HTMLTextAreaElement).value = "200";
    choose("solid-kind", "xrpd");
    expect($("solid-preview").innerHTML).toBe("");
    expect($("solid-notes").textContent).toMatch(/between 0 and 180/);
    expect(($("solid-insert-fig") as HTMLButtonElement).disabled).toBe(true);
  });
});
