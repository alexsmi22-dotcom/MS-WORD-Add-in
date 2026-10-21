// Plane frames: closed-form beam results, two portal frames against an independent FEM package (anastruct 1.6,
// run locally; its numbers kept here, not its code), hinges, a mechanism refused, the input language.
import { analyzeFrame, parseFrame, type FrameResult } from "../frame2d";

const run = (text: string): FrameResult => {
  const p = parseFrame(text);
  if (!p.model) throw new Error(p.errors.join(" | "));
  const r = analyzeFrame(p.model);
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r;
};
const close = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));
const E = 200e6, A = 0.01, I = 1e-4, EI = E * I;

describe("closed forms", () => {
  test("cantilever with a tip load: δ = PL³/3EI, θ = PL²/2EI, fixed-end moment PL", () => {
    const r = run(`node A 0,0\nnode B 3,0\nE=${E} A=${A} I=${I}\nmember 1 A-B\nsupport A fixed\nload B Fy=-10`);
    close(r.disp[1][1], (-10 * 27) / (3 * EI));
    close(r.disp[1][2], (-10 * 9) / (2 * EI));
    close(r.reactions.get(0)![1], 10);
    close(r.reactions.get(0)![2], 30);
    close(r.members[0].maxMoment.M, -30);
  });
  test("fixed–fixed beam under a UDL: end moments wL²/12, midspan wL²/24, δ = wL⁴/384EI", () => {
    const r = run(`node A 0,0\nnode M 3,0\nnode B 6,0\nE=${E} A=${A} I=${I}\nmember 1 A-M\nmember 2 M-B\nsupport A fixed\nsupport B fixed\nudl 1 -4\nudl 2 -4`);
    close(r.reactions.get(0)![2], (4 * 36) / 12);
    close(r.disp[1][1], (-4 * 6 ** 4) / (384 * EI));
    const mid = r.members[0].moment[r.members[0].moment.length - 1][1];
    close(mid, (4 * 36) / 24);
  });
  test("simply supported beam under a UDL: wL²/8 at midspan, 5wL⁴/384EI", () => {
    const r = run(`node A 0,0\nnode M 4,0\nnode B 8,0\nE=${E} A=${A} I=${I}\nmember 1 A-M\nmember 2 M-B\nsupport A pin\nsupport B roller\nudl 1 -2\nudl 2 -2`);
    close(r.members[0].moment[r.members[0].moment.length - 1][1], (2 * 64) / 8);
    close(r.disp[1][1], (-5 * 2 * 8 ** 4) / (384 * EI));
    close(r.reactions.get(0)![1], 8);
    close(r.reactions.get(2)![1], 8);
  });
  test("a point load on a member: propped cantilever, fixed-end moment 3PL/16", () => {
    const r = run(`node A 0,0\nnode B 4,0\nE=${E} A=${A} I=${I}\nmember 1 A-B\nsupport A fixed\nsupport B roller\npoint 1 -16 at 2`);
    close(r.reactions.get(0)![2], (3 * 16 * 4) / 16);
    close(r.reactions.get(1)![1], (5 * 16) / 16);
  });
  test("an inclined member: axial load only stretches it (N = P, δ along the axis = PL/EA)", () => {
    const r = run(`node A 0,0\nnode B 3,4\nE=${E} A=${A} I=${I}\nmember 1 A-B\nsupport A fixed\nload B Fx=6 Fy=8`);
    close(r.members[0].axial, 10);
    const along = (r.disp[1][0] * 3 + r.disp[1][1] * 4) / 5;
    close(along, (10 * 5) / (E * A));
  });
});

describe("against an independent solver, and by hand", () => {
  const portal = (extra: string, sup: string, area = A) =>
    run(`node A 0,0\nnode B 0,4\nnode C 6,4\nnode D 6,0\nE=${E} A=${area} I=${I}\nmember 1 A-B\nmember 2 B-C ${extra}\nmember 3 C-D\nsupport A ${sup}\nsupport D ${sup}\nload B Fx=10\nudl 2 -5`);
  // anastruct's own member-load handling needs the beam subdivided: with 64 elements it converges to these values
  // (one element differs by 3e-6); its hinge with a load on the same element is not condensed, so the hinged case is
  // checked by statics and slope-deflection instead.
  test("fixed-base portal, sway load and beam UDL: anastruct, beam in 64 elements", () => {
    const r = portal("", "fixed");
    close(r.reactions.get(0)![0], -0.8038810744235807, 1e-8);
    close(r.reactions.get(0)![1], 12.335701598543508, 1e-8);
    close(r.reactions.get(0)![2], 6.446765007591646, 1e-8);
    close(r.reactions.get(3)![0], -9.196118925571955, 1e-8);
    close(r.reactions.get(3)![1], 17.664298401475822, 1e-8);
    close(r.reactions.get(3)![2], 17.56744458384764, 1e-8);
    close(r.disp[1][0], 0.002149969430010748, 1e-8);
    close(r.disp[2][0], 0.00212238107323401, 1e-8);
    close(r.disp[1][1], -2.467140319708715e-5, 1e-8);
    close(Math.max(...r.members[1].moment.map((p) => Math.abs(p[1]))), 19.217031118440318, 1e-6);
    expect(r.residual).toBeLessThan(1e-9);
  });
  test("pinned portal with a hinge at the beam's left end: statics, and the sway by slope-deflection", () => {
    const r = portal("hinge=i", "pin");
    close(r.reactions.get(0)![1], 25 / 3, 1e-9);
    close(r.reactions.get(3)![1], 65 / 3, 1e-9);
    close(r.reactions.get(3)![0], -10, 1e-9);
    close(Math.abs(r.reactions.get(0)![0]), 0, 1e-9);
    close(Math.max(...r.members[2].moment.map((p) => Math.abs(p[1]))), 40, 1e-9);
    close(r.members[1].moment[0][1], 0, 1e-9);
    // Inextensible members: the right column (pinned base) carries the whole sway; joint C is restrained by the beam,
    // propped at its hinged end (3EI/L): M_CB = (3EI/6)θ + wL²/8 = −40 → θ = −0.00175; M_CD = (3EI/4)(θ − Δ/4) = 40.
    const rigid = portal("hinge=i", "pin", 1e6);
    close(rigid.disp[2][2], -0.00175, 1e-6);
    close(rigid.disp[2][0], (40 / 15000 + 0.00175) * 4, 1e-6);
  });
});

describe("refusals and the language", () => {
  test("a mechanism is refused by name", () => {
    const p = parseFrame(`node A 0,0\nnode B 0,4\nnode C 6,4\nnode D 6,0\nE=${E} A=${A} I=${I}\nmember 1 A-B\nmember 2 B-C hinge=both\nmember 3 C-D\nsupport A pin\nsupport D pin\nload B Fx=10`);
    const r = analyzeFrame(p.model!);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.errors.join(" ")).toMatch(/mechanism/);
  });
  test("no supports, missing E/A/I, unknown nodes, bad lines are refused by name", () => {
    expect(analyzeFrame(parseFrame(`node A 0,0\nnode B 1,0\nE=1 A=1 I=1\nmember 1 A-B`).model!).ok).toBe(false);
    expect(parseFrame(`node A 0,0\nnode B 1,0\nmember 1 A-B`).errors.join(" ")).toMatch(/no E, A or I/);
    expect(parseFrame(`node A 0,0\nE=1 A=1 I=1\nmember 1 A-Z`).errors.join(" ")).toMatch(/Z, which is not a node/);
    expect(parseFrame(`frobnicate`).errors.join(" ")).toMatch(/start a line with node/);
    expect(parseFrame(`node A 0,0\nnode B 4,0\nE=1 A=1 I=1\nmember 1 A-B\npoint 1 -5 at 9`).errors.join(" ")).toMatch(/0 ≤ at ≤ 4/);
  });
  test("a node reached only through hinges is not a false mechanism", () => {
    const r = run(`node A 0,0\nnode B 2,0\nnode C 4,0\nE=${E} A=${A} I=${I}\nmember 1 A-B hinge=j\nmember 2 B-C hinge=i\nsupport A fixed\nsupport C fixed\nload B Fy=-10`);
    close(r.reactions.get(0)![1] + r.reactions.get(2)![1], 10);
  });
});
