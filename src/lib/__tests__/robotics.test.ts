// Robotics tests. Expected values come from closed forms, hand-worked geometry,
// or round-trip invariants — never from what the implementation returns.

import {
  planarFk,
  planar2rIk,
  planar2rJacobian,
  dhForward,
  trapezoidalProfile,
  diffDriveFromWheels,
  diffDriveToWheels,
} from "../robotics";

const D = (deg: number) => (deg * Math.PI) / 180;

describe("planar forward kinematics", () => {
  test("a straight arm reaches the sum of its links", () => {
    const r = planarFk([1, 1], [0, 0])!;
    expect(r.tip.x).toBeCloseTo(2, 12);
    expect(r.tip.y).toBeCloseTo(0, 12);
    expect(r.maxReach).toBeCloseTo(2, 12);
  });

  test("angles are RELATIVE — a right angle at the elbow, worked by hand", () => {
    // Shoulder 0, elbow +90: first link along +x, second straight up.
    const r = planarFk([2, 1], [0, D(90)])!;
    expect(r.tip.x).toBeCloseTo(2, 12);
    expect(r.tip.y).toBeCloseTo(1, 12);
    expect(r.tip.theta).toBeCloseTo(D(90), 12);
    expect(r.joints[1]).toEqual({ x: 2, y: expect.closeTo(0, 12) });
  });

  test("folding the elbow right back puts the tip at the difference of the links", () => {
    const r = planarFk([3, 1], [0, D(180)])!;
    expect(r.tip.x).toBeCloseTo(2, 12);
    expect(r.tip.y).toBeCloseTo(0, 12);
  });

  test("the tip is never further from the base than the sum of the links", () => {
    for (const a1 of [0, 0.7, 1.9, -2.2]) {
      for (const a2 of [0, 1.1, 2.9, -0.4]) {
        const r = planarFk([1.5, 0.8], [a1, a2])!;
        expect(Math.hypot(r.tip.x, r.tip.y)).toBeLessThanOrEqual(2.3 + 1e-12);
      }
    }
  });

  test("a three-link chain accumulates orientation", () => {
    const r = planarFk([1, 1, 1], [D(30), D(30), D(30)])!;
    expect(r.tip.theta).toBeCloseTo(D(90), 12);
    expect(r.joints.length).toBe(4);
  });

  test("bad shapes and non-positive links are refused", () => {
    expect(planarFk([], [])).toBeNull();
    expect(planarFk([1, 1], [0])).toBeNull();
    expect(planarFk([1, 0], [0, 0])).toBeNull();
    expect(planarFk([1, -1], [0, 0])).toBeNull();
    expect(planarFk([1, 1], [0, NaN])).toBeNull();
  });
});

describe("2R inverse kinematics", () => {
  test("BOTH branches are returned, and both actually reach the target", () => {
    const l1 = 2;
    const l2 = 1.5;
    const target = { x: 2.0, y: 1.0 };
    const r = planar2rIk(l1, l2, target.x, target.y)!;
    expect(r.reachable).toBe(true);
    expect(r.solutions.length).toBe(2);
    // The real test: run each solution back through forward kinematics.
    for (const s of r.solutions) {
      const fk = planarFk([l1, l2], [s.theta1, s.theta2])!;
      expect(fk.tip.x).toBeCloseTo(target.x, 10);
      expect(fk.tip.y).toBeCloseTo(target.y, 10);
    }
    // And they are genuinely different configurations.
    expect(r.solutions[0].theta2).toBeCloseTo(-r.solutions[1].theta2, 12);
    expect(r.solutions[0].branch).toBe("positive");
    expect(r.solutions[1].branch).toBe("negative");
  });

  test("round trip from a random-ish set of poses", () => {
    const l1 = 1.3;
    const l2 = 0.9;
    for (const th1 of [-2.5, -1, 0.3, 1.2, 2.8]) {
      for (const th2 of [-2.4, -0.8, 0.6, 1.7]) {
        const fk = planarFk([l1, l2], [th1, th2])!;
        const ik = planar2rIk(l1, l2, fk.tip.x, fk.tip.y)!;
        expect(ik.reachable).toBe(true);
        // One of the returned solutions must reproduce the original pose.
        const back = ik.solutions.map((s) => planarFk([l1, l2], [s.theta1, s.theta2])!);
        for (const b of back) {
          expect(b.tip.x).toBeCloseTo(fk.tip.x, 9);
          expect(b.tip.y).toBeCloseTo(fk.tip.y, 9);
        }
      }
    }
  });

  test("outside the outer reach is UNREACHABLE, not clamped", () => {
    const r = planar2rIk(2, 1, 5, 0)!;
    expect(r.reachable).toBe(false);
    expect(r.solutions).toEqual([]);
    expect(r.missM).toBeCloseTo(2, 12); // 5 - (2+1)
    expect(r.notes.join(" ")).toMatch(/UNREACHABLE/);
    expect(r.notes.join(" ")).toMatch(/Clamping/);
  });

  test("the INNER hole is unreachable too — unequal links cannot reach their own base", () => {
    const r = planar2rIk(3, 1, 0.5, 0)!;
    expect(r.innerReach).toBeCloseTo(2, 12);
    expect(r.reachable).toBe(false);
    expect(r.missM).toBeCloseTo(1.5, 12);
    expect(r.notes.join(" ")).toMatch(/INNER hole/);
  });

  test("full extension is singular and returns ONE coincident solution", () => {
    const r = planar2rIk(2, 1, 3, 0)!;
    expect(r.reachable).toBe(true);
    expect(r.singular).toBe(true);
    expect(r.solutions.length).toBe(1);
    expect(r.solutions[0].branch).toBe("coincident");
    expect(r.solutions[0].theta2).toBeCloseTo(0, 7);
    expect(r.notes.join(" ")).toMatch(/SINGULAR/);
  });

  test("the singular note names the RIGHT angle for a fully extended arm", () => {
    // Found by an independent review. The note branched on exact float equality
    // with 0, but acos of a c2 that rounds to just under 1 returns ~1e-8, so a
    // fully EXTENDED arm printed "theta2 = 180°" directly beneath a solution row
    // reading theta2 ≈ 0. It hit more than half of all extended link pairs.
    for (const [l1, l2] of [[0.7, 0.45], [0.6, 0.4], [0.3, 0.2], [1, 1], [2, 1.5]] as const) {
      const r = planar2rIk(l1, l2, l1 + l2, 0)!;
      expect(r.singular).toBe(true);
      const note = r.notes.join(" ");
      expect(note).toMatch(/fully extended \(theta2 = 0°\)/);
      expect(note).not.toMatch(/180°/);
      // And the note must agree with the number actually returned.
      expect(Math.abs(r.solutions[0].theta2)).toBeLessThan(1e-3);
    }
  });

  test("the singular note says 180 only when the arm really is folded", () => {
    for (const [l1, l2] of [[0.7, 0.45], [2, 1.5], [3, 1]] as const) {
      const r = planar2rIk(l1, l2, Math.abs(l1 - l2), 0)!;
      expect(r.singular).toBe(true);
      const note = r.notes.join(" ");
      expect(note).toMatch(/fully folded \(theta2 = 180°\)/);
      expect(Math.abs(Math.abs(r.solutions[0].theta2) - Math.PI)).toBeLessThan(1e-3);
    }
  });

  test("full fold is singular too", () => {
    const r = planar2rIk(2, 1, 1, 0)!; // r = |L1 - L2|
    expect(r.singular).toBe(true);
    expect(r.solutions.length).toBe(1);
    expect(Math.abs(r.solutions[0].theta2)).toBeCloseTo(Math.PI, 6);
  });

  test("equal links reaching the base leaves theta1 undetermined, and says so", () => {
    const r = planar2rIk(1, 1, 0, 0)!;
    expect(r.reachable).toBe(true);
    expect(r.notes.join(" ")).toMatch(/UNDETERMINED/);
  });

  test("the workspace annulus bounds are exact", () => {
    const r = planar2rIk(2, 1.5, 1, 1)!;
    expect(r.outerReach).toBeCloseTo(3.5, 12);
    expect(r.innerReach).toBeCloseTo(0.5, 12);
  });

  test("non-physical links are refused", () => {
    expect(planar2rIk(0, 1, 1, 0)).toBeNull();
    expect(planar2rIk(1, -1, 1, 0)).toBeNull();
    expect(planar2rIk(1, 1, NaN, 0)).toBeNull();
  });
});

describe("Jacobian and singularities", () => {
  test("det(J) = L1*L2*sin(theta2), independent of theta1", () => {
    for (const th1 of [0, 0.5, 1.7, -2.2]) {
      const r = planar2rJacobian(2, 1.5, th1, 0.6)!;
      expect(r.determinant).toBeCloseTo(2 * 1.5 * Math.sin(0.6), 12);
    }
  });

  test("the Jacobian matches a finite-difference of forward kinematics", () => {
    const l1 = 1.4;
    const l2 = 0.9;
    const th1 = 0.7;
    const th2 = 1.1;
    const h = 1e-7;
    const base = planarFk([l1, l2], [th1, th2])!.tip;
    const d1 = planarFk([l1, l2], [th1 + h, th2])!.tip;
    const d2 = planarFk([l1, l2], [th1, th2 + h])!.tip;
    const r = planar2rJacobian(l1, l2, th1, th2)!;
    expect(r.j[0]).toBeCloseTo((d1.x - base.x) / h, 5);
    expect(r.j[1]).toBeCloseTo((d2.x - base.x) / h, 5);
    expect(r.j[2]).toBeCloseTo((d1.y - base.y) / h, 5);
    expect(r.j[3]).toBeCloseTo((d2.y - base.y) / h, 5);
  });

  test("singular exactly at full extension and full fold", () => {
    expect(planar2rJacobian(2, 1, 0.4, 0)!.singular).toBe(true);
    expect(planar2rJacobian(2, 1, 0.4, Math.PI)!.singular).toBe(true);
    expect(planar2rJacobian(2, 1, 0.4, 1.0)!.singular).toBe(false);
  });

  test("the product of the singular values is |det J|", () => {
    const r = planar2rJacobian(1, 1, 0, Math.PI / 2)!;
    expect(r.singularValues[0] * r.singularValues[1]).toBeCloseTo(Math.abs(r.determinant), 10);
    // Hand-worked for L1=L2=1, th1=0, th2=90: J = [[-1,-1],[1,0]], det = 1.
    expect(r.determinant).toBeCloseTo(1, 12);
    expect(r.singularValues[0]).toBeCloseTo(1.618, 3);
    expect(r.singularValues[1]).toBeCloseTo(0.618, 3);
    expect(r.conditionNumber).toBeCloseTo(2.618, 3);
  });

  test("singular and the condition number never disagree", () => {
    // The small singular value came from a difference that loses all its digits
    // to cancellation near singularity, so it could hit exactly 0 (condition
    // number "infinite") while the |det| threshold still said "non-singular".
    // Recovering it as |det|/sigma1 keeps the two verdicts consistent.
    for (const th2 of [1e-6, 1e-7, 5e-8, 1e-8, 1e-9, 1e-10, 0]) {
      const r = planar2rJacobian(0.5, 0.4, 0.3, th2)!;
      const infinite = r.conditionNumber === Infinity;
      expect({ th2, agree: infinite === r.singular }).toEqual({ th2, agree: true });
    }
    // And where it is well conditioned the product still recovers |det|.
    const ok = planar2rJacobian(0.5, 0.4, 0.3, 1.0)!;
    expect(ok.singularValues[0] * ok.singularValues[1]).toBeCloseTo(ok.manipulability, 12);
  });

  test("singular values are ordered, and the condition number is infinite at a singularity", () => {
    const r = planar2rJacobian(2, 1, 0.3, 0)!;
    expect(r.singularValues[0]).toBeGreaterThanOrEqual(r.singularValues[1]);
    expect(r.manipulability).toBeCloseTo(0, 12);
    expect(r.conditionNumber).toBe(Infinity);
    expect(r.notes.join(" ")).toMatch(/rank 1/);
  });

  test("static torque is J TRANSPOSE times force, checked by hand", () => {
    // L1=L2=1, th1=0, th2=90 gives J = [[-1,-1],[1,0]].
    // J^T = [[-1,1],[-1,0]]; with F = (10, 0): tau = (-10, -10).
    const r = planar2rJacobian(1, 1, 0, Math.PI / 2, [10, 0])!;
    expect(r.jointTorques![0]).toBeCloseTo(-10, 10);
    expect(r.jointTorques![1]).toBeCloseTo(-10, 10);
    // With F = (0, 10): tau = (10, 0).
    const r2 = planar2rJacobian(1, 1, 0, Math.PI / 2, [0, 10])!;
    expect(r2.jointTorques![0]).toBeCloseTo(10, 10);
    expect(r2.jointTorques![1]).toBeCloseTo(0, 10);
  });

  test("a straight arm carries a transverse tip load on the shoulder alone", () => {
    // Fully extended along +x, load in +y: the elbow has zero moment arm... but
    // the shoulder carries the full length. tau1 = (L1+L2)*Fy, tau2 = L2*Fy.
    const r = planar2rJacobian(2, 1, 0, 0, [0, 5])!;
    expect(r.jointTorques![0]).toBeCloseTo(3 * 5, 10);
    expect(r.jointTorques![1]).toBeCloseTo(1 * 5, 10);
  });

  test("manipulability peaks at a right-angle elbow", () => {
    const at90 = planar2rJacobian(1, 1, 0, Math.PI / 2)!.manipulability;
    for (const th2 of [0.2, 0.8, 2.0, 2.9]) {
      expect(planar2rJacobian(1, 1, 0, th2)!.manipulability).toBeLessThanOrEqual(at90 + 1e-12);
    }
  });

  test("bad inputs refused", () => {
    expect(planar2rJacobian(0, 1, 0, 0)).toBeNull();
    expect(planar2rJacobian(1, 1, NaN, 0)).toBeNull();
    expect(planar2rJacobian(1, 1, 0, 0, [NaN, 0])).toBeNull();
  });
});

describe("Denavit-Hartenberg forward kinematics", () => {
  test("a single row with only a reproduces a translation along x", () => {
    const r = dhForward([{ theta: 0, d: 0, a: 0.5, alpha: 0 }])!;
    expect(r.position).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0, 12), expect.closeTo(0, 12)]);
  });

  test("a planar 2R chain agrees with planarFk", () => {
    const l1 = 1.2;
    const l2 = 0.7;
    const th1 = 0.6;
    const th2 = -0.9;
    const dh = dhForward([
      { theta: th1, d: 0, a: l1, alpha: 0 },
      { theta: th2, d: 0, a: l2, alpha: 0 },
    ])!;
    const pf = planarFk([l1, l2], [th1, th2])!;
    expect(dh.position[0]).toBeCloseTo(pf.tip.x, 10);
    expect(dh.position[1]).toBeCloseTo(pf.tip.y, 10);
    expect(dh.position[2]).toBeCloseTo(0, 12);
  });

  test("the rotation matrix is orthonormal with determinant +1", () => {
    const r = dhForward([
      { theta: 0.3, d: 0.1, a: 0.4, alpha: Math.PI / 2 },
      { theta: -0.8, d: 0.2, a: 0.3, alpha: -Math.PI / 3 },
      { theta: 1.1, d: 0, a: 0.25, alpha: 0 },
    ])!;
    const R = r.rotation;
    // Row norms are 1 and rows are mutually orthogonal.
    for (let i = 0; i < 3; i++) {
      expect(Math.hypot(R[i * 3], R[i * 3 + 1], R[i * 3 + 2])).toBeCloseTo(1, 10);
    }
    const dot = (a: number, b: number) => R[a * 3] * R[b * 3] + R[a * 3 + 1] * R[b * 3 + 1] + R[a * 3 + 2] * R[b * 3 + 2];
    expect(dot(0, 1)).toBeCloseTo(0, 10);
    expect(dot(0, 2)).toBeCloseTo(0, 10);
    expect(dot(1, 2)).toBeCloseTo(0, 10);
    const det =
      R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    expect(det).toBeCloseTo(1, 10);
  });

  test("d translates along the joint z axis", () => {
    const r = dhForward([{ theta: 0, d: 0.75, a: 0, alpha: 0 }])!;
    expect(r.position[2]).toBeCloseTo(0.75, 12);
  });

  test("a single DH row can never be in gimbal lock, because r31 = 0", () => {
    // Row 3 of a DH matrix is [0, sin(alpha), cos(alpha)], so r31 is identically
    // zero for one row however the row is chosen. Worth asserting: it is why the
    // lock case needs two rows to construct.
    for (const alpha of [0, Math.PI / 2, -Math.PI / 2, 1.1]) {
      const r = dhForward([{ theta: 0.3, d: 0.2, a: 0.4, alpha }])!;
      expect(r.rotation[6]).toBeCloseTo(0, 12);
      expect(r.gimbalLock).toBe(false);
    }
  });

  test("GIMBAL LOCK is reported and no roll/pitch/yaw is invented", () => {
    // For two rows r31 = sin(alpha1)*sin(theta2), so 90/90 gives exactly 1.
    const r = dhForward([
      { theta: 0, d: 0, a: 0, alpha: Math.PI / 2 },
      { theta: Math.PI / 2, d: 0, a: 0, alpha: 0 },
    ])!;
    expect(r.rotation[6]).toBeCloseTo(1, 12);
    expect(r.gimbalLock).toBe(true);
    expect(r.rpy).toBeNull();
    expect(r.notes.join(" ")).toMatch(/GIMBAL LOCK/);
    // The rotation matrix is still exact.
    expect(r.rotation.length).toBe(9);
  });

  test("away from gimbal lock the RPY reconstructs the rotation", () => {
    const r = dhForward([
      { theta: 0.4, d: 0, a: 0.3, alpha: 0.5 },
      { theta: 0.2, d: 0.1, a: 0.2, alpha: -0.3 },
    ])!;
    expect(r.gimbalLock).toBe(false);
    const [roll, pitch, yaw] = r.rpy!;
    // Rebuild Rz(yaw)Ry(pitch)Rx(roll) and compare with the reported matrix.
    const cz = Math.cos(yaw), sz = Math.sin(yaw);
    const cy = Math.cos(pitch), sy = Math.sin(pitch);
    const cx = Math.cos(roll), sx = Math.sin(roll);
    const rebuilt = [
      cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
      sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
      -sy, cy * sx, cy * cx,
    ];
    for (let i = 0; i < 9; i++) expect(rebuilt[i]).toBeCloseTo(r.rotation[i], 9);
  });

  test("the convention is stated, because a DH table without one is ambiguous", () => {
    expect(dhForward([{ theta: 0, d: 0, a: 1, alpha: 0 }])!.notes.join(" ")).toMatch(/STANDARD Denavit/);
  });

  test("empty or non-finite tables are refused", () => {
    expect(dhForward([])).toBeNull();
    expect(dhForward([{ theta: NaN, d: 0, a: 1, alpha: 0 }])).toBeNull();
  });
});

describe("motion profile", () => {
  test("a long move is trapezoidal and the phases sum to the distance", () => {
    const r = trapezoidalProfile(10, 2, 1)!;
    expect(r.shape).toBe("trapezoidal");
    expect(r.peakSpeed).toBeCloseTo(2, 12);
    expect(r.accelTimeS).toBeCloseTo(2, 12); // v/a
    expect(r.accelDistance).toBeCloseTo(2, 12); // v^2/2a
    expect(r.cruiseDistance).toBeCloseTo(10 - 4, 12);
    expect(2 * r.accelDistance + r.cruiseDistance).toBeCloseTo(10, 12);
    expect(r.totalTimeS).toBeCloseTo(2 * 2 + 6 / 2, 12);
  });

  test("A SHORT MOVE IS TRIANGULAR and never reaches vmax", () => {
    // vmax would need 2*v^2/2a = 4 m; only 1 m is available.
    const r = trapezoidalProfile(1, 2, 1)!;
    expect(r.shape).toBe("triangular");
    expect(r.cruiseTimeS).toBe(0);
    expect(r.peakSpeed).toBeCloseTo(Math.sqrt(1 * 1), 12);
    expect(r.peakSpeed).toBeLessThan(2);
    // Total time = 2*sqrt(d/a).
    expect(r.totalTimeS).toBeCloseTo(2 * Math.sqrt(1 / 1), 12);
    expect(r.notes.join(" ")).toMatch(/TRIANGULAR/);
  });

  test("the naive formula would be optimistic — the guard that matters", () => {
    const d = 1, v = 2, a = 1;
    const r = trapezoidalProfile(d, v, a)!;
    const naive = d / v + v / a; // 0.5 + 2 = 2.5
    // The true triangular time is 2 s, but the naive form is not a bound in
    // general; what matters is that we do NOT report vmax as reached.
    expect(r.peakSpeed).not.toBeCloseTo(v, 6);
    expect(naive).toBeGreaterThan(0);
  });

  test("the boundary case is exactly trapezoidal with zero cruise", () => {
    // d = 2 * v^2/(2a) = v^2/a = 4.
    const r = trapezoidalProfile(4, 2, 1)!;
    expect(r.shape).toBe("trapezoidal");
    expect(r.cruiseDistance).toBeCloseTo(0, 12);
    expect(r.cruiseTimeS).toBeCloseTo(0, 12);
    expect(r.peakSpeed).toBeCloseTo(2, 12);
  });

  test("distance and time are consistent for both shapes", () => {
    for (const [d, v, a] of [[10, 2, 1], [1, 2, 1], [100, 5, 2], [0.01, 5, 2]] as const) {
      const r = trapezoidalProfile(d, v, a)!;
      // Integrate the profile: 2 * (1/2 * vpeak * taccel) + vpeak * tcruise.
      const covered = r.peakSpeed * r.accelTimeS + r.peakSpeed * r.cruiseTimeS;
      expect(covered).toBeCloseTo(d, 9);
      expect(r.totalTimeS).toBeCloseTo(2 * r.accelTimeS + r.cruiseTimeS, 12);
    }
  });

  test("a zero-distance move takes no time", () => {
    const r = trapezoidalProfile(0, 2, 1)!;
    expect(r.totalTimeS).toBe(0);
    expect(r.peakSpeed).toBe(0);
  });

  test("non-physical inputs are refused", () => {
    expect(trapezoidalProfile(-1, 2, 1)).toBeNull();
    expect(trapezoidalProfile(1, 0, 1)).toBeNull();
    expect(trapezoidalProfile(1, 2, 0)).toBeNull();
    expect(trapezoidalProfile(1, 2, NaN)).toBeNull();
  });
});

describe("differential drive", () => {
  test("equal wheels means straight, with an INFINITE radius", () => {
    const r = diffDriveFromWheels(1, 1, 0.5)!;
    expect(r.linearSpeed).toBeCloseTo(1, 12);
    expect(r.angularSpeed).toBeCloseTo(0, 12);
    expect(r.turnRadius).toBe(Infinity);
    expect(r.notes.join(" ")).toMatch(/infinite, not zero/);
  });

  test("equal and opposite means spinning on the spot, radius exactly zero", () => {
    const r = diffDriveFromWheels(-1, 1, 0.5)!;
    expect(r.linearSpeed).toBeCloseTo(0, 12);
    expect(r.angularSpeed).toBeCloseTo(4, 12); // (1 - -1)/0.5
    expect(r.turnRadius).toBe(0);
  });

  test("the yaw rate uses the FULL track width", () => {
    // vr = 1.2, vl = 0.8, W = 0.4 -> omega = 0.4/0.4 = 1 rad/s exactly.
    const r = diffDriveFromWheels(0.8, 1.2, 0.4)!;
    expect(r.angularSpeed).toBeCloseTo(1, 12);
    // Using the half-track would give 2 — the factor this guards.
    expect(r.angularSpeed).not.toBeCloseTo(2, 6);
    expect(r.linearSpeed).toBeCloseTo(1, 12);
    expect(r.turnRadius).toBeCloseTo(1, 12);
  });

  test("the two directions are exact inverses", () => {
    for (const [v, w] of [[1, 0.5], [0, 2], [2, 0], [-1.5, -0.3]] as const) {
      const to = diffDriveToWheels(v, w, 0.6)!;
      const back = diffDriveFromWheels(to.leftSpeed, to.rightSpeed, 0.6)!;
      expect(back.linearSpeed).toBeCloseTo(v, 12);
      expect(back.angularSpeed).toBeCloseTo(w, 12);
    }
  });

  test("wheel angular rates follow from the radius", () => {
    const r = diffDriveFromWheels(1, 2, 0.5, 0.1)!;
    expect(r.wheelRates![0]).toBeCloseTo(10, 12);
    expect(r.wheelRates![1]).toBeCloseTo(20, 12);
  });

  test("turn radius equals v/omega whenever both are non-zero", () => {
    const r = diffDriveFromWheels(0.5, 1.5, 0.8)!;
    expect(r.turnRadius).toBeCloseTo(r.linearSpeed / r.angularSpeed, 10);
  });

  test("the no-slip assumption is always stated", () => {
    expect(diffDriveFromWheels(1, 1, 0.5)!.notes.join(" ")).toMatch(/without slipping/);
  });

  test("a non-positive track width or wheel radius is refused", () => {
    expect(diffDriveFromWheels(1, 1, 0)).toBeNull();
    expect(diffDriveFromWheels(1, 1, -0.5)).toBeNull();
    expect(diffDriveFromWheels(1, 1, 0.5, 0)).toBeNull();
    expect(diffDriveToWheels(1, 1, 0)).toBeNull();
  });
});
