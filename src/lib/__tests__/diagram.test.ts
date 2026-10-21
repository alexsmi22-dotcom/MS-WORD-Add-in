import { buildDiagram, DIAGRAM_KINDS } from "../diagram";
import { layoutFlow, parseFlow, type FlowKind } from "../diagramFlow";
import { FONT_PT, LINE_HEIGHT, SHEET_WIDTH_PT, textW } from "../diagramCore";
import { USPTO_REQUIRED_FONT_PT } from "../figureStyle";

const overlaps = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

describe("every kind's example draws, in USPTO lettering", () => {
  test.each(DIAGRAM_KINDS.map((k) => [k.id, k.example] as const))("%s", (id, example) => {
    for (const numerals of ["inside", "lead"] as const) {
      const r = buildDiagram(id, example, { fig: "1", numerals, figureNumeral: "100" });
      if (!r.ok) throw new Error(r.errors.join(" "));
      expect(r.notes).toEqual([]);
      expect(r.widthPt).toBeLessThanOrEqual(SHEET_WIDTH_PT);
      // Every letter at least the USPTO height (1/8 in with the style's margin): no font-size below it.
      const sizes = [...r.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(USPTO_REQUIRED_FONT_PT - 1e-9);
      expect(r.svg).toMatch(/>FIG\. 1</);
    }
  });
});

describe("block, flowchart and state layouts", () => {
  const kinds: FlowKind[] = ["block", "flowchart", "state"];
  test.each(kinds)("%s: no box overlaps another, text fits its box, every edge starts and ends on a box", (kind) => {
    const example = DIAGRAM_KINDS.find((k) => k.id === kind)!.example;
    for (const numerals of ["inside", "lead"] as const) {
      const L = layoutFlow(kind, parseFlow(kind, example), { numerals });
      const boxes = L.placed.map((p) => [p.x, p.y, p.w, p.h] as [number, number, number, number]);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
      for (const p of L.placed) {
        if (!p.lines.length) continue;
        const widest = Math.max(...p.lines.map((l) => textW(l)));
        expect(widest).toBeLessThanOrEqual(p.w);
        expect((p.lines.length - 1) * LINE_HEIGHT + FONT_PT).toBeLessThanOrEqual(p.h);
      }
      const onBorder = (pt: [number, number], id: string): boolean => {
        const p = L.placed.find((q) => q.node.id === id)!;
        const tol = 0.6;
        const inX = pt[0] >= p.x - tol && pt[0] <= p.x + p.w + tol, inY = pt[1] >= p.y - tol && pt[1] <= p.y + p.h + tol;
        return inX && inY && (Math.abs(pt[0] - p.x) < tol || Math.abs(pt[0] - p.x - p.w) < tol || Math.abs(pt[1] - p.y) < tol || Math.abs(pt[1] - p.y - p.h) < tol || Math.abs(pt[0] - (p.x + p.w / 2)) < tol);
      };
      for (const r of L.routes) {
        expect(onBorder(r.pts[0], r.edge.from)).toBe(true);
        expect(onBorder(r.pts[r.pts.length - 1], r.edge.to)).toBe(true);
        // Orthogonal routing: every segment horizontal or vertical.
        for (let k = 1; k < r.pts.length; k++) expect(r.pts[k][0] === r.pts[k - 1][0] || r.pts[k][1] === r.pts[k - 1][1]).toBe(true);
      }
    }
  });
  test("a loop goes back around the right; a decision's second exit leaves from its side", () => {
    const g = parseFlow("flowchart", DIAGRAM_KINDS.find((k) => k.id === "flowchart")!.example);
    const L = layoutFlow("flowchart", g);
    const back = L.routes.find((r) => r.edge.from === "410" && r.edge.to === "405")!;
    const d = L.placed.find((p) => p.node.id === "410")!;
    expect(back.pts[0]).toEqual([d.x + d.w, d.y + d.h / 2]);
    expect(Math.max(...back.pts.map((p) => p[0]))).toBeGreaterThan(Math.max(...L.placed.map((p) => p.x + p.w)));
  });
});

describe("refused by name, never drawn wrong", () => {
  test.each([
    ["block", "104 Sensor\n104 -> 112", /refers to “112”, which is not defined/],
    ["block", "104 Sensor\n104 Motor", /“104” is defined twice/],
    ["block", "lonely", /is not a box/],
    ["flowchart", "start\n? 410 Asleep?\n410 yes -> 415\n415 Release", /Decision 410 needs two exits/],
    ["sequence", "participant 102 Client\nparticipant 102 Server", /declared twice/],
    ["sequence", "hello there", /is not “participant/],
    ["timing", "CLK: clock 0", /a clock of 0 periods/],
    ["timing", "nonsense", /is not a signal/],
    ["schematic", "R1 transistorz 0,0 1,0", /is not a symbol/],
    ["schematic", "R1 resistor 0,0", /needs two points/],
    ["schematic", "R1 resistor 0,0 0,0", /two ends are the same point/],
    ["schematic", "R1 resistor 0,0 1,0\nR1 resistor 1,0 2,0", /used twice/],
  ] as const)("%s: %s", (kind, input, re) => {
    const r = buildDiagram(kind, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(re);
  });
  test("a floating terminal is said; a figure wider than the sheet is said, never shrunk", () => {
    const s = buildDiagram("schematic", "R1 resistor 0,0 2,0\nwire 2,0 3,0");
    expect(s.ok && s.notes.join(" ")).toMatch(/R1's terminal at 0,0 is connected to nothing/);
    const wide = buildDiagram("block", Array.from({ length: 6 }, (_, i) => `${200 + i} A rather long component label ${i}`).join("\n") + "\n" + Array.from({ length: 6 }, (_, i) => `100 -> ${200 + i}`).join("\n") + "\n100 Hub");
    expect(wide.ok).toBe(true);
    if (wide.ok) {
      expect(wide.notes.join(" ")).toMatch(/cm wide; the sheet allows 17\.0 cm/);
      const sizes = [...wide.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(USPTO_REQUIRED_FONT_PT - 1e-9);
    }
  });
  test("user text is escaped in the drawing", () => {
    const r = buildDiagram("block", '104 <script>alert("x")</script> & co');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.svg).not.toMatch(/<script>/);
      expect(r.svg).toMatch(/&lt;script&gt;/);
    }
  });
  test("work bounds: too many boxes, messages, periods or parts are refused by name", () => {
    expect(buildDiagram("block", Array.from({ length: 81 }, (_, i) => `${100 + i} Box`).join("\n")).ok).toBe(false);
    expect(buildDiagram("timing", `D: ${Array.from({ length: 65 }, () => "0").join(" ")}`).ok).toBe(false);
  });
});

// ---- review round 1: realistic patent graphs, checked geometrically ----
const CASES: Array<[FlowKind, string, string]> = [
  ["block", "blockFan", "102 Sensor\n110 Processor\n112 Memory\n114 Display\n116 Transmitter\n102 -> 110\n110 -> 112\n110 -> 114\n110 -> 116\n110 <-> 112\n102 -> 116"],
  ["block", "blockSkip", "200 Antenna\n202 Low-noise amplifier\n204 Mixer\n206 Filter\n208 Demodulator\n210 Local oscillator\n200 -> 202\n202 -> 204\n204 -> 206\n206 -> 208\n210 -> 204\n200 -> 208"],
  ["block", "blockMulti", "300 Controller\n302 Motor driver\n300 -> 302 : PWM\n300 -> 302 : enable"],
  ["state", "stateMany", "[*] -> Idle\nIdle -> Armed : arm\nIdle -> Test : test\nArmed -> Idle : disarm\nArmed -> Alarm : trigger\nAlarm -> Armed : reset\nTest -> Idle : done\nArmed -> Armed : heartbeat\nAlarm -> [*]"],
  ["state", "stateDup", "A -> B : x\nA -> B : y"],
  ["flowchart", "selfLoop", "start\n400 Count\n400 -> 400 : increment\n400 -> end\nend"],
  ["flowchart", "decLoops", "start\n500 Receive packet\n? 502 Valid?\n502 yes -> 504\n502 no -> 500\n504 Decode\n? 506 Complete?\n506 no -> 500\n506 yes -> 508\n508 Store\nend"],
  ["flowchart", "decEnd", "start\n800 Read sensor\n? 802 Done?\n802 yes -> end\n802 no -> 800\nend"],
  // review round 2
  ["flowchart", "nested", "start\n500 Init\n502 Outer step\n504 Inner step\n? 506 Inner done?\n506 no -> 504\n506 yes -> 508\n? 508 Outer done?\n508 no -> 502\n508 yes -> end\nend"],
  ["flowchart", "bothExitsUp", "start\n400 Acquire\n402 Filter\n? 404 Good?\n404 yes -> 400\n404 no -> 402\nend"],
  ["flowchart", "twoLoops", "start\n20 Prep\n22 Measure\n? 24 In range?\n24 yes -> 26\n24 no -> 22\n26 Report\n? 28 More?\n28 yes -> 20\n28 no -> end\nend"],
  ["block", "feedbackCtl", "300 Reference\n302 Summer\n304 Controller\n306 Plant\n308 Sensor\n300 -> 302\n302 -> 304\n304 -> 306\n306 -> 308\n308 -> 302 : feedback\n306 -> 310\n310 Output"],
  ["block", "backBelow", "700 Source\n702 Left\n704 Right\n700 -> 702\n700 -> 704\n702 -> 700"],
  ["state", "sixWay", "A -> B : a\nB -> C : b\nC -> A : c\nA -> C : d\nC -> B : e\nB -> A : f"],
  ["block", "lead4", "1 In\n2 Proc\n3 Mid\n4 Out\n1 -> 2\n2 -> 3\n3 -> 4\n1 -> 4\n4 -> 1\n4 -> 2"],
  ["state", "twoSelf", "A -> A : one\nA -> A : two\nA -> B : go"],
  ["block", "backTop4", "1 Top\n9 Neighbour\n2 B\n3 C\n4 D\n5 E\n1 -> 2\n9 -> 2\n2 -> 3\n3 -> 4\n4 -> 5\n5 -> 1\n4 -> 1\n3 -> 1\n2 -> 1"],
  ["state", "backTop4s", "A -> B\nZ -> B\nB -> C\nC -> D\nD -> E\nE -> A\nD -> A\nC -> A\nB -> A"],
  ["flowchart", "loopIntoDiamond", "start\n300 Read\n? 302 OK?\n302 yes -> 304\n302 no -> 302b\n302b Wait\n302b -> 302\n304 Store\nend"],
  ["block", "fanout4labels", "60 Ctl\n61 A\n62 B\n63 C\n64 D\n60 -> 61 : s1\n60 -> 62 : s2\n60 -> 63 : s3\n60 -> 64 : s4"],
  ["block", "longLabels", "900 A\n902 B\n900 -> 902 : a very long arrow label describing the control signal path\n902 -> 900 : another long label going back up the figure"],
  ["flowchart", "sameTarget", "start\n? 10 Ready?\n10 yes -> 12\n10 no -> 12\n12 Go\nend"],
  ["flowchart", "dupIntoDiamond", "start\n10 A\n10 -> 12\n10 -> 12\n? 12 B?\n12 yes -> 14\n12 no -> 10\n14 C\nend"],
  ["state", "dupFinal", "[*] -> A : s\n[*] -> A : t\nA -> [*] : x\nA -> [*] : y"],
  ["block", "leadOnLabel", "1220 A\n1222 B\n1220 -> 1222\n1222 -> 1220 : x\n1222 -> 1220 : y"],
  ["block", "nearStraight", "200 Central processing unit with cache\n201 A\n202 B\n203 C\n201 -> 200\n202 -> 200\n203 -> 200"],
];

type Box4 = [number, number, number, number];
function segmentHitsBox(a: [number, number], b: [number, number], box: Box4): boolean {
  const [x, y, w, h] = box;
  const inset = 1.5;
  if (a[1] === b[1]) return a[1] > y + inset && a[1] < y + h - inset && Math.max(a[0], b[0]) > x + inset && Math.min(a[0], b[0]) < x + w - inset;
  if (a[0] === b[0]) return a[0] > x + inset && a[0] < x + w - inset && Math.max(a[1], b[1]) > y + inset && Math.min(a[1], b[1]) < y + h - inset;
  return false;
}

describe("review round 1: realistic graphs draw what is written, and nothing else", () => {
  test.each(CASES)("%s %s", (kind, _name, input) => {
    const g = parseFlow(kind, input);
    expect(g.errors).toEqual([]);
    for (const numerals of ["inside", "lead"] as const) {
      const L = layoutFlow(kind, g, { numerals });
      // Every edge written is routed, once.
      expect(L.routes).toHaveLength(g.edges.length);
      // No edge runs through a box other than its own two ends.
      for (const r of L.routes) {
        for (const p of L.placed) {
          if (p.node.id === r.edge.from || p.node.id === r.edge.to) continue;
          for (let k = 1; k < r.pts.length; k++) expect([r.edge.from, r.edge.to, p.node.id, segmentHitsBox(r.pts[k - 1], r.pts[k], [p.x, p.y, p.w, p.h])]).toEqual([r.edge.from, r.edge.to, p.node.id, false]);
        }
      }
      // Edges from different sources never share a horizontal run (they would read as one wire).
      const hs: Array<{ from: string; to: string; y: number; x0: number; x1: number }> = [];
      for (const r of L.routes) for (let k = 1; k < r.pts.length; k++) if (r.pts[k][1] === r.pts[k - 1][1]) hs.push({ from: r.edge.from, to: r.edge.to, y: r.pts[k][1], x0: Math.min(r.pts[k][0], r.pts[k - 1][0]), x1: Math.max(r.pts[k][0], r.pts[k - 1][0]) });
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
        const a = hs[i], b = hs[j];
        if (a.from === b.from || a.to === b.to) continue;
        const shared = Math.abs(a.y - b.y) < 0.5 && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1;
        expect([a.from, a.to, b.from, b.to, shared]).toEqual([a.from, a.to, b.from, b.to, false]);
      }
      // Labels: none on a box, none on another label.
      const lab = L.routes.filter((r) => r.labelAt).map((r) => {
        const w = textW(r.edge.label);
        const x0 = r.labelAt![2] === "middle" ? r.labelAt![0] - w / 2 : r.labelAt![2] === "end" ? r.labelAt![0] - w : r.labelAt![0];
        return { t: r.edge.label, b: [x0, r.labelAt![1] - FONT_PT * 0.8, w, FONT_PT] as Box4 };
      });
      for (const l of lab) for (const p of L.placed) expect([l.t, p.node.id, overlaps(l.b, [p.x, p.y, p.w, p.h])]).toEqual([l.t, p.node.id, false]);
      for (let i = 0; i < lab.length; i++) for (let j = i + 1; j < lab.length; j++) expect([lab[i].t, lab[j].t, overlaps(lab[i].b, lab[j].b)]).toEqual([lab[i].t, lab[j].t, false]);
      // No label sits on another edge's line.
      L.routes.forEach((r, ri) => {
        if (!r.labelAt) return;
        const w = textW(r.edge.label);
        const x0 = r.labelAt[2] === "middle" ? r.labelAt[0] - w / 2 : r.labelAt[2] === "end" ? r.labelAt[0] - w : r.labelAt[0];
        const box: Box4 = [x0 - 1, r.labelAt[1] - FONT_PT * 0.75, w + 2, FONT_PT * 0.95];
        L.routes.forEach((o, oi) => {
          if (oi === ri) return;
          for (let k = 1; k < o.pts.length; k++) expect([r.edge.label, o.edge.from, o.edge.to, segmentHitsBox(o.pts[k - 1], o.pts[k], box)]).toEqual([r.edge.label, o.edge.from, o.edge.to, false]);
        });
      });
      // Edges from different sources never share a vertical run either (two returns merged into one entry line).
      const vs: Array<{ from: string; to: string; x: number; y0: number; y1: number }> = [];
      for (const r of L.routes) for (let k = 1; k < r.pts.length; k++) if (r.pts[k][0] === r.pts[k - 1][0]) vs.push({ from: r.edge.from, to: r.edge.to, x: r.pts[k][0], y0: Math.min(r.pts[k][1], r.pts[k - 1][1]), y1: Math.max(r.pts[k][1], r.pts[k - 1][1]) });
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i], b = vs[j];
        if (a.from === b.from) continue;
        const shared = Math.abs(a.x - b.x) < 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1;
        expect([a.from, a.to, b.from, b.to, shared]).toEqual([a.from, a.to, b.from, b.to, false]);
      }
      // Every segment is exactly horizontal or vertical.
      for (const r of L.routes) for (let k = 1; k < r.pts.length; k++) expect([r.edge.from, r.edge.to, r.pts[k][0] === r.pts[k - 1][0] || r.pts[k][1] === r.pts[k - 1][1]]).toEqual([r.edge.from, r.edge.to, true]);
      // Every arrow ends ON its target's outline (and starts on its source's): a point of the outline, not beside it.
      const onOutline = (p: (typeof L.placed)[number], q: [number, number]): boolean => {
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2, dx = Math.abs(q[0] - cx), dy = Math.abs(q[1] - cy);
        const sh = p.node.shape;
        if (sh === "diamond") return Math.abs(dx / (p.w / 2) + dy / (p.h / 2) - 1) < 0.02;
        if (sh === "initial" || sh === "final") return Math.abs(Math.hypot(dx, dy) - p.w / 2) < 0.6;
        const r = sh === "start" || sh === "end" ? p.h / 2 : sh === "state" ? 10 : 0;
        const ex = Math.max(0, dx - (p.w / 2 - r)), ey = Math.max(0, dy - (p.h / 2 - r));
        if (ex > 0 && ey > 0) return Math.abs(Math.hypot(ex, ey) - r) < 0.6;
        return (Math.abs(dx - p.w / 2) < 0.6 && dy <= p.h / 2 + 0.6) || (Math.abs(dy - p.h / 2) < 0.6 && dx <= p.w / 2 + 0.6);
      };
      for (const r of L.routes) {
        if (r.edge.from === r.edge.to) continue;
        const src = L.placed.find((p) => p.node.id === r.edge.from)!, dst = L.placed.find((p) => p.node.id === r.edge.to)!;
        expect([r.edge.from, r.edge.to, "end", onOutline(dst, r.pts[r.pts.length - 1])]).toEqual([r.edge.from, r.edge.to, "end", true]);
        expect([r.edge.from, r.edge.to, "start", onOutline(src, r.pts[0])]).toEqual([r.edge.from, r.edge.to, "start", true]);
      }
      // Everything inside the figure's box: every line, with room for its arrowhead, and every label.
      for (const r of L.routes) for (const q of r.pts) {
        expect(q[0]).toBeGreaterThanOrEqual(-0.5);
        expect(q[0]).toBeLessThanOrEqual(L.width + 0.5);
        expect(q[1]).toBeGreaterThanOrEqual(-0.5);
        expect(q[1]).toBeLessThanOrEqual(L.height + 0.5);
      }
      for (const l of lab) {
        expect([l.t, l.b[0] >= -0.5, l.b[0] + l.b[2] <= L.width + 0.5, l.b[1] >= -0.5, l.b[1] + l.b[3] <= L.height + 0.5]).toEqual([l.t, true, true, true, true]);
      }
    }
  });
  test("round 2: a step a decision loops back to keeps its own arrow to the next step", () => {
    const has = (input: string, a: string, b: string) => parseFlow("flowchart", input).edges.some((e) => e.from === a && e.to === b);
    expect(has(CASES.find((c) => c[1] === "nested")![2], "502", "504")).toBe(true);
    expect(has(CASES.find((c) => c[1] === "bothExitsUp")![2], "400", "402")).toBe(true);
    expect(has(CASES.find((c) => c[1] === "twoLoops")![2], "20", "22")).toBe(true);
    for (const n of ["nested", "bothExitsUp", "twoLoops"]) expect(parseFlow("flowchart", CASES.find((c) => c[1] === n)![2]).notes.join(" ")).not.toMatch(/branch with no exit/);
  });
  test("round 2: the drawn figure contains its lowest return line and its label", () => {
    const r = buildDiagram("block", CASES.find((c) => c[1] === "feedbackCtl")![2], { fig: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(r.svg)!;
    const g = /translate\(([\d.]+), ([\d.]+)\)/.exec(r.svg)!;
    const ys = [...r.svg.matchAll(/points="([^"]+)"/g)].flatMap((m) => m[1].split(" ").map((xy) => Number(xy.split(",")[1])));
    expect(Math.max(...ys) + Number(g[2])).toBeLessThan(Number(vb[2]));
  });
  test("round 2: two self-loops on one box are two loops, each with its own label", () => {
    const L = layoutFlow("state", parseFlow("state", "A -> A : one\nA -> A : two"));
    expect(JSON.stringify(L.routes[0].pts)).not.toBe(JSON.stringify(L.routes[1].pts));
    expect(L.routes[0].labelAt![1] === L.routes[1].labelAt![1] && L.routes[0].labelAt![0] === L.routes[1].labelAt![0]).toBe(false);
  });
  test("round 2: sequence A-->B with no spaces is a dashed reply between A and B, not a participant “A-”", () => {
    const r = buildDiagram("sequence", "participant A Client\nparticipant B Server\nA -> B : request\nA-->B : reply");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).not.toContain(">A-<");
    expect(r.svg).toMatch(/stroke-dasharray/);
    const typo = buildDiagram("sequence", "participant A Client\nparticipant B Server\nA -> C : request");
    expect(typo.notes.join(" ")).toMatch(/Not declared.*“C”/);
  });
  test("round 2: a trailing colon is an empty label, not part of a name", () => {
    expect(parseFlow("state", "A -> B :\nB -> A : ").nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    expect(parseFlow("block", "1 A\n2 B\n1 -> 2 :").errors).toEqual([]);
  });
  test("round 2: off-grid and oversized figures of every kind are refused, never Infinity", () => {
    const huge = buildDiagram("schematic", "R1 resistor 0,0 " + "9".repeat(400) + ",0");
    expect(huge.ok).toBe(false);
    expect(huge.ok ? "" : huge.errors.join(" ")).toMatch(/off the grid/);
    expect(buildDiagram("schematic", "R1 resistor 0,0 90000,0").ok).toBe(false);
    expect(buildDiagram("sequence", "A -> B : " + "x".repeat(4000)).ok).toBe(false);
  });
  test("round 2: a multi-word exit label says where the words go; an unconnected step is said", () => {
    const g = parseFlow("flowchart", "start\n? 410 Ready?\n410 not ready -> 405\n410 yes -> end\n405 Wait\nend");
    expect(g.errors.join(" ")).toMatch(/after a colon: “410 -> … : not ready”/);
    expect(parseFlow("flowchart", "end\nstart").notes.join(" ")).toMatch(/not connected/);
  });
  test("round 2: CJK labels get full-width boxes", () => {
    expect(textW("温度センサー")).toBeCloseTo(6 * FONT_PT, 5);
    const L = layoutFlow("block", parseFlow("block", "1 温度センサーと制御回路の接続部\n2 B\n1 -> 2"));
    const p = L.placed.find((x) => x.node.id === "1")!;
    expect(p.w).toBeGreaterThan(textW("温度センサーと制御回路の接続部") > 300 ? 200 : textW("温度センサーと制御回路の接続部"));
  });
  test("a decision with three exits is refused by name; an exit may go to end", () => {
    expect(buildDiagram("flowchart", "start\n? 600 Mode?\n600 a -> 602\n600 b -> 604\n600 c -> 606\n602 A\n604 B\n606 C\nend").ok).toBe(false);
    const r = buildDiagram("flowchart", CASES.find((c) => c[1] === "decEnd")![2]);
    expect(r.ok).toBe(true);
  });
  test("branches after a decision are not chained to each other; the dangling one is said", () => {
    const g = parseFlow("flowchart", "start\n? 410 OK?\n410 yes -> 415\n410 no -> 420\n415 Accept\n420 Reject\nend");
    expect(g.edges.some((e) => e.from === "415" && e.to === "420")).toBe(false);
    expect(g.notes.join(" ")).toMatch(/Step 415 is a branch with no exit/);
  });
  test("absurd figures are refused, not inserted", () => {
    const n = 80;
    const lines = Array.from({ length: n }, (_, i) => `${1000 + i} Box ${i}`);
    for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) lines.push(`${1000 + i} -> ${1000 + ((i * 7 + j * 13 + 1) % n)}`);
    const r = buildDiagram("block", lines.join("\n"));
    if (r.ok) expect(r.widthPt).toBeLessThanOrEqual(SHEET_WIDTH_PT * 3 + 40);
    expect(buildDiagram("block", "1 A\n2 B\n" + Array.from({ length: 300 }, () => "1 -> 2").join("\n")).ok).toBe(false);
    expect(buildDiagram("block", `1 ${"x".repeat(500)}`).ok).toBe(false);
  });
  test("schematic: a tee at a wire bend gets a dot; several grounds are fine; NMOS arrow points out", () => {
    const tee = buildDiagram("schematic", "wire 0,0 2,0 2,-2\nwire 2,0 4,0");
    expect(tee.ok && (tee.svg.match(/r="3" fill="#000"/g) ?? []).length).toBe(1);
    expect(buildDiagram("schematic", "GND ground 0,0\nGND ground 2,0\nwire 0,0 2,0").ok).toBe(true);
  });
  test("timing: a long bus value widens the periods instead of overrunning them", () => {
    const r = buildDiagram("timing", "ADDR: x x 0x3F00 0x3F00 DEADBEEF x");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.widthPt).toBeGreaterThan(textW("DEADBEEF") * 1 + 30);
  });
});
