import {
  buildFlowchartSvg,
  buildHierarchySvg,
  buildDiagramSvg,
  wrapText,
  layoutFlowchartPages,
  layoutHierarchyPages,
} from "../tablediagram";

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

  test("reference numerals auto-number steps that have no id", () => {
    const { svg } = buildFlowchartSvg([["Mix reagents"], ["Heat"], ["Cool"]], "", { numerals: true });
    for (const n of ["102", "104", "106"]) expect(svg).toContain(`>${n}</text>`);
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

  test("reference numerals number boxes in DFS order with lead lines (100, 102, 104…)", () => {
    const { svg } = buildHierarchySvg(rows, "", { numerals: true });
    expect(svg).toContain(">100</text>"); // root System 10
    expect(svg).toContain(">102</text>"); // Controller 20
    expect(svg).toContain(">104</text>"); // CPU 22
    expect(svg).toContain('class="fi-lead"'); // lead lines to the boxes
  });

  test("reference numerals are unique even on a dense tree (no collisions)", () => {
    // A subsystem with 6 parts plus a second subsystem — the old level-stride
    // scheme collided (part 6 == subsystem 2). Numbers must all be distinct.
    const dense: string[][] = [];
    for (let i = 1; i <= 6; i++) dense.push(["System", "Controller", `Part ${i}`]);
    dense.push(["System", "Sensor", "Element"]);
    const { svg } = buildHierarchySvg(dense, "", { numerals: true });
    const nums = (svg.match(/>(\d{3})<\/text>/g) || []).map((m) => m.replace(/\D/g, ""));
    expect(nums.length).toBeGreaterThan(5);
    expect(new Set(nums).size).toBe(nums.length); // all unique
  });
});

describe("pagination for PPT slides", () => {
  test("long flowcharts split into pages joined by connector circles", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`Do processing step number ${i + 1} of the method`]);
    const { pages } = layoutFlowchartPages(rows, { numerals: true });
    expect(pages.length).toBeGreaterThan(1);
    // Page 1 ends in connector "A"; page 2 starts with connector "A".
    expect(pages[0].boxes.some((b) => b.kind === "circle" && b.lines[0] === "A")).toBe(true);
    expect(pages[1].boxes.some((b) => b.kind === "circle" && b.lines[0] === "A")).toBe(true);
    // Auto reference numerals continue across pages instead of restarting.
    const page1Steps = pages[0].boxes.filter((b) => b.kind !== "circle").length;
    const firstNumeralPage2 = pages[1].texts.find((t) => /^\d+$/.test(t.text));
    expect(firstNumeralPage2?.text).toBe(String(102 + page1Steps * 2));
    // Every page fits a slide-sized canvas.
    for (const p of pages) expect(p.H).toBeLessThan(620);
  });

  test("short flowcharts stay on one page with no connectors", () => {
    const { pages } = layoutFlowchartPages([["Start"], ["Do work"], ["End"]], {});
    expect(pages).toHaveLength(1);
    expect(pages[0].boxes.every((b) => b.kind !== "circle")).toBe(true);
  });

  test("wide hierarchies split by branch with the root repeated and numbering intact", () => {
    const rows: string[][] = [];
    for (let b = 1; b <= 6; b++) {
      rows.push(["System", `Branch ${b}`, `Part ${b}a`]);
      rows.push(["System", `Branch ${b}`, `Part ${b}b`]);
    }
    const { pages } = layoutHierarchyPages(rows, { numerals: true });
    expect(pages.length).toBeGreaterThan(1);
    // The root box appears on every page.
    for (const p of pages) {
      expect(p.boxes.some((b) => b.lines.join(" ").includes("System"))).toBe(true);
    }
    // Numbering is assigned on the full tree: page 2's first branch is NOT 110.
    const page2Numerals = pages[1].texts.filter((t) => /^\d+$/.test(t.text)).map((t) => t.text);
    expect(page2Numerals).toContain("100"); // repeated root
    expect(page2Numerals).not.toContain("110"); // branch 1 lives on page 1
    expect(pages[1].texts.some((t) => t.text === "(continued)")).toBe(true);
  });

  test("narrow hierarchies stay on one page", () => {
    const { pages } = layoutHierarchyPages([["A", "B"], ["A", "C"]], {});
    expect(pages).toHaveLength(1);
  });
});

describe("buildDiagramSvg", () => {
  test("dispatches by kind", () => {
    const rows = [["Start"], ["End"]];
    expect(buildDiagramSvg("flowchart", rows).svg).toContain('rx="14"');
    expect(buildDiagramSvg("hierarchy", [["A", "B"]], "").svg).toContain('class="fi-edge"');
  });
});
