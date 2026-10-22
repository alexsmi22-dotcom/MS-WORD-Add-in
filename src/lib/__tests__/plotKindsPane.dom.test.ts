/**
 * @jest-environment jsdom
 */
// Plot ▸ Plot type over the pane's REAL markup (#plot-section of taskpane.html): the select
// defaults to y = f(x) with the section exactly as it was, every id the lib reads exists, each kind
// shows its own fields, and a figure comes back for the insert path.
import * as fs from "fs";
import * as path from "path";
import { initPlotKinds, applyPlotKindUi, renderPlotKind, readPlotKindInput, PLOT_KIND_TOGGLED, PLOT_KIND_INPUT_IDS, FN_LABEL, PLOT_KINDS } from "../plotKinds";

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="plot-section">[\s\S]*?<\/section>/.exec(HTML)![0];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
function setup(): { changes: () => number } {
  document.body.innerHTML = SECTION;
  let n = 0;
  initPlotKinds(document, () => void n++);
  return { changes: () => n };
}
function choose(kind: string): void {
  const sel = $<HTMLSelectElement>("plot-kind");
  sel.value = kind;
  sel.dispatchEvent(new Event("change"));
}
const visible = (id: string): boolean => {
  for (let e: HTMLElement | null = $(id); e; e = e.parentElement) if (e.hidden) return false;
  return true;
};

describe("Plot type select", () => {
  test("every id the lib reads or toggles is in the markup, once", () => {
    for (const id of [...PLOT_KIND_TOGGLED, ...PLOT_KIND_INPUT_IDS, "plot-fn", "plot-fn-label", "plot-tmin-label", "plot-xmin", "plot-xmax", "plot-data", "plot-title", "plot-xlabel", "plot-ylabel", "plot-xscale", "plot-yscale"]) {
      expect([id, (SECTION.match(new RegExp(`\\sid="${id}"`, "g")) ?? []).length]).toEqual([id, 1]);
    }
  });
  test("the select offers each kind, and y = f(x) is the default", () => {
    setup();
    const sel = $<HTMLSelectElement>("plot-kind");
    expect([...sel.options].map((o) => o.value)).toEqual([...PLOT_KINDS]);
    expect(sel.value).toBe("fx");
  });
  test("default: the y = f(x) section as it always was — same fields shown, same label and placeholder", () => {
    setup();
    for (const id of ["plot-fn", "plot-xmin", "plot-xmax", "plot-data", "plot-xscale", "plot-yscale", "plot-errbars", "plot-title", "plot-xlabel", "plot-ylabel", "plot-insert", "plot-preview"]) {
      expect([id, visible(id)]).toEqual([id, true]);
    }
    for (const id of ["plot-fn2", "plot-tmin", "plot-ymin", "plot-levels", "plot-az", "plot-y2label", "plot-zlabel"]) expect([id, visible(id)]).toEqual([id, false]);
    expect($("plot-fn-label").textContent).toBe(FN_LABEL.fx.label);
    expect($<HTMLInputElement>("plot-fn").placeholder).toBe(FN_LABEL.fx.placeholder);
    expect($("plot-data-label").textContent).toBe("Data (x y [err] per line)");
  });
  test.each([
    ["parametric", ["plot-fn", "plot-fn2", "plot-equal", "plot-tmin", "plot-tmax", "plot-xscale"], ["plot-xmin", "plot-data", "plot-errbars", "plot-angle-unit", "plot-ymin"]],
    ["polar", ["plot-fn", "plot-tmin", "plot-tmax", "plot-angle-unit"], ["plot-fn2", "plot-xmin", "plot-data", "plot-xscale"]],
    ["dualy", ["plot-data", "plot-y2label", "plot-y2scale", "plot-xscale", "plot-yscale"], ["plot-fn", "plot-errbars", "plot-xmin"]],
    ["contour", ["plot-fn", "plot-xmin", "plot-ymin", "plot-grid", "plot-levels", "plot-filled", "plot-zlabel"], ["plot-data", "plot-xscale", "plot-az"]],
    ["surface", ["plot-fn", "plot-xmin", "plot-ymin", "plot-grid", "plot-az", "plot-el", "plot-surface-style", "plot-zlabel"], ["plot-levels", "plot-data", "plot-yscale"]],
  ])("%s shows its own fields", (kind, shown, hidden) => {
    const t = setup();
    choose(kind as string);
    for (const id of shown as string[]) expect([id, visible(id)]).toEqual([id, true]);
    for (const id of hidden as string[]) expect([id, visible(id)]).toEqual([id, false]);
    expect(t.changes()).toBe(1);
  });
  test("each kind keeps its own formula while the user switches", () => {
    setup();
    $<HTMLInputElement>("plot-fn").value = "sin(x)/x";
    choose("polar");
    expect($<HTMLInputElement>("plot-fn").value).toBe("");
    expect($("plot-fn-label").textContent).toMatch(/r\(θ\)/);
    $<HTMLInputElement>("plot-fn").value = "cos(3*theta)";
    choose("fx");
    expect($<HTMLInputElement>("plot-fn").value).toBe("sin(x)/x");
    expect($("plot-fn-label").textContent).toBe(FN_LABEL.fx.label);
    choose("polar");
    expect($<HTMLInputElement>("plot-fn").value).toBe("cos(3*theta)");
    expect($("plot-tmin-label").textContent).toBe("θ from");
  });
  test("the data box is kept per kind: x y err for y = f(x), x y₁ y₂ for two y axes", () => {
    setup();
    $<HTMLTextAreaElement>("plot-data").value = "0 1 0.1\n1 2 0.2";
    choose("dualy");
    expect($<HTMLTextAreaElement>("plot-data").value).toBe("");
    $<HTMLTextAreaElement>("plot-data").value = "0 1 10\n1 2 20";
    choose("contour"); // no data box: nothing moves
    choose("fx");
    expect($<HTMLTextAreaElement>("plot-data").value).toBe("0 1 0.1\n1 2 0.2");
    choose("dualy");
    expect($<HTMLTextAreaElement>("plot-data").value).toBe("0 1 10\n1 2 20");
  });
  test("degrees ↔ radians converts a full-turn θ range", () => {
    setup();
    choose("polar");
    const unit = $<HTMLSelectElement>("plot-angle-unit");
    unit.value = "deg";
    unit.dispatchEvent(new Event("change"));
    expect($<HTMLInputElement>("plot-tmax").value).toBe("360");
    unit.value = "rad";
    unit.dispatchEvent(new Event("change"));
    expect($<HTMLInputElement>("plot-tmax").value).toBe("2*pi");
  });
  test("new fields call the preview", () => {
    const t = setup();
    choose("contour");
    const before = t.changes();
    $<HTMLInputElement>("plot-levels").dispatchEvent(new Event("input"));
    $<HTMLInputElement>("plot-filled").dispatchEvent(new Event("change"));
    expect(t.changes()).toBe(before + 2);
  });
  test("from the fields to a figure: the defaults draw each kind once a formula is typed", () => {
    setup();
    choose("parametric");
    $<HTMLInputElement>("plot-fn").value = "cos(t)";
    $<HTMLInputElement>("plot-fn2").value = "sin(t)";
    expect(renderPlotKind(document).ok).toBe(true);
    choose("polar");
    $<HTMLInputElement>("plot-fn").value = "cos(3*θ)";
    expect(renderPlotKind(document).ok).toBe(true);
    choose("contour");
    $<HTMLInputElement>("plot-fn").value = "x^2 + y^2";
    const c = renderPlotKind(document);
    expect(c.ok).toBe(true);
    choose("surface");
    $<HTMLInputElement>("plot-fn").value = "sin(x)*cos(y)";
    expect(renderPlotKind(document).ok).toBe(true);
    choose("dualy");
    $<HTMLTextAreaElement>("plot-data").value = "0 1 2\n1 2 4\n2 3 8";
    const d = renderPlotKind(document);
    expect(d.ok).toBe(true);
    expect(readPlotKindInput(document).kind).toBe("dualy");
  });
  test("applyPlotKindUi tolerates a section without the new fields (older markup)", () => {
    document.body.innerHTML = '<input id="plot-fn" />';
    expect(applyPlotKindUi(document)).toBe("fx");
  });
});
