import { buildFlowchartSvg, buildHierarchySvg, buildDiagramSvg, wrapText } from "../tablediagram";

const count = (svg: string, needle: string): number => svg.split(needle).length - 1;

describe("wrapText", () => {
  test("wraps on word boundaries", () => {
    expect(wrapText("receive the input signal", 12, 4)).toEqual(["receive the", "input signal"]);
  });
  test("caps lines and marks overflow", () => {
    const lines = wrapText("a b c d e f g h i j k l m n o p", 5, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
  test("hard-breaks a single overlong word", () => {
    const lines = wrapText("supercalifragilisticexpialidocious", 10, 2);
    expect(lines[0].endsWith("…")).toBe(true);
  });
});

describe("buildFlowchartSvg", () => {
  const steps = [
    ["S101", "Receive the input signal"],
    ["S102", "Filter the signal"],
    ["S103", "Signal above threshold?"],
    ["S104", "Store the result"],
  ];

  test("draws one box per step and arrows between them", () => {
    const { svg, warnings } = buildFlowchartSvg(steps);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(count(svg, 'class="fi-box"')).toBe(4);
    expect(count(svg, 'class="fi-arrow"')).toBe(3);
    expect(warnings).toEqual([]);
  });

  test("step ids become reference numerals beside the boxes", () => {
    const { svg } = buildFlowchartSvg(steps);
    for (const id of ["S101", "S102", "S103", "S104"]) expect(svg).toContain(`>${id}</text>`);
  });

  test("a step ending in ? becomes a decision diamond", () => {
    const { svg } = buildFlowchartSvg(steps);
    expect(svg).toContain('<polygon class="fi-box"');
  });

  test("start/end rows get rounded boxes", () => {
    const { svg } = buildFlowchartSvg([["Start"], ["Do work"], ["End"]]);
    expect(count(svg, 'rx="14"')).toBe(2);
    expect(count(svg, 'rx="0"')).toBe(1);
  });

  test("a header row like Step|Description is skipped with a warning", () => {
    const { svg, warnings } = buildFlowchartSvg([["Step", "Description"], ...steps]);
    expect(count(svg, 'class="fi-box"')).toBe(4);
    expect(warnings.some((w) => w.includes("header"))).toBe(true);
  });

  test("single-column tables work", () => {
    const { svg } = buildFlowchartSvg([["Mix reagents"], ["Heat to 60 °C"], ["Cool"]]);
    expect(count(svg, 'class="fi-box"')).toBe(3);
  });

  test("long step lists are capped with a warning", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`Step number ${i + 1}`]);
    const { svg, warnings } = buildFlowchartSvg(rows);
    expect(count(svg, 'class="fi-box"')).toBe(30);
    expect(warnings.some((w) => w.includes("first 30"))).toBe(true);
  });

  test("patent style contains no color", () => {
    const { svg } = buildFlowchartSvg(steps, "", { patent: true, figLabel: "FIG. 4" });
    expect(svg).toContain("FIG. 4");
    for (const c of ["#1f77b4", "#eaf2fb", "#fdf1dc", "#555"]) expect(svg).not.toContain(c);
  });

  test("title is rendered and escaped", () => {
    const { svg } = buildFlowchartSvg(steps, "Method <100>");
    expect(svg).toContain("Method &lt;100&gt;");
  });
});

describe("buildHierarchySvg", () => {
  const rows = [
    ["System 10", "Controller 20", "CPU 22"],
    ["System 10", "Controller 20", "Memory 24"],
    ["System 10", "Sensor 30", ""],
  ];

  test("merges shared path prefixes into one tree", () => {
    const { svg } = buildHierarchySvg(rows);
    // System 10, Controller 20, CPU 22, Memory 24, Sensor 30 → 5 boxes.
    expect(count(svg, 'class="fi-box"')).toBe(5);
    expect(count(svg, ">System 10</text>")).toBe(1);
  });

  test("blank cells inherit the value above (merged-cell style)", () => {
    const { svg } = buildHierarchySvg([
      ["System 10", "Controller 20"],
      ["", "Sensor 30"],
    ]);
    expect(count(svg, 'class="fi-box"')).toBe(3);
    expect(count(svg, ">System 10</text>")).toBe(1);
  });

  test("draws orthogonal connectors", () => {
    const { svg } = buildHierarchySvg(rows);
    expect(count(svg, 'class="fi-edge"')).toBeGreaterThan(3);
  });

  test("multiple roots are allowed", () => {
    const { svg } = buildHierarchySvg([
      ["Device A", "Part 1"],
      ["Device B", "Part 2"],
    ]);
    expect(count(svg, 'class="fi-box"')).toBe(4);
  });

  test("wide trees scale down to the pane width", () => {
    const wide = Array.from({ length: 8 }, (_, i) => ["Root", `Child ${i + 1}`]);
    const { svg } = buildHierarchySvg(wide);
    expect(svg).toContain('width="380"');
    expect(svg).toMatch(/viewBox="0 0 \d{3,} /);
  });

  test("patent style contains no color and shows the FIG. label", () => {
    const { svg } = buildHierarchySvg(rows, "", { patent: true, figLabel: "FIG. 1" });
    expect(svg).toContain("FIG. 1");
    for (const c of ["#1f77b4", "#eaf2fb", "#fdf1dc", "#555"]) expect(svg).not.toContain(c);
  });
});

describe("buildDiagramSvg", () => {
  test("dispatches by kind", () => {
    const rows = [["Start"], ["End"]];
    expect(buildDiagramSvg("flowchart", rows).svg).toContain('rx="14"');
    expect(buildDiagramSvg("hierarchy", [["A", "B"]], "").svg).toContain('class="fi-edge"');
  });
});
