// Robot kinematics — planar chains, inverse kinematics with every branch named,
// the Jacobian and its singularities, Denavit-Hartenberg forward kinematics,
// motion profiles, and differential-drive kinematics.
//
// THE THINGS THAT GO WRONG HERE ARE NOT ARITHMETIC, THEY ARE MULTIPLICITY AND
// DOMAIN, and each is handled by NAMING the case rather than returning one number:
//
//   - Inverse kinematics has TWO solutions for a 2R arm, not one. Returning
//     whichever the arccos happened to give, with no statement of which branch it
//     is, is a wrong answer half the time — and the two are not interchangeable on
//     a real machine, because moving between them requires passing through a
//     singularity.
//   - A target outside the reachable annulus has NO solution. Clamping it to the
//     workspace edge produces a pose that looks plausible and does not reach the
//     point asked for.
//   - At full extension and full fold the two solutions COINCIDE and the Jacobian
//     loses rank: the arm cannot move radially at all, and any inverse-Jacobian
//     controller divides by (almost) zero there. That is reported as a singularity
//     rather than as a merely-unusual answer.
//   - Euler angles are undefined at gimbal lock; roll and yaw stop being separable
//     and only their sum is determined. Reporting an arbitrary split as if it were
//     the orientation is the same class of lie.

export interface Pose2 {
  x: number;
  y: number;
  /** Orientation of the last link, radians, measured from +x. */
  theta: number;
}

export interface PlanarFkResult {
  tip: Pose2;
  /** Position of every joint, starting at the base (0,0). */
  joints: Array<{ x: number; y: number }>;
  /** Sum of the link lengths — the furthest the tip can ever be from the base. */
  maxReach: number;
  notes: string[];
}

/**
 * Forward kinematics of a planar serial chain of revolute joints.
 *
 * Angles are RELATIVE to the previous link (the usual joint-space convention),
 * so the absolute orientation of link i is the running sum. Passing absolute
 * angles instead gives a wrong pose with no error, so which is expected is stated
 * here and in the pane.
 */
export function planarFk(links: number[], angles: number[]): PlanarFkResult | null {
  if (!Array.isArray(links) || !Array.isArray(angles)) return null;
  if (links.length === 0 || links.length !== angles.length) return null;
  if (!links.every((l) => Number.isFinite(l) && l > 0)) return null;
  if (!angles.every((a) => Number.isFinite(a))) return null;

  const joints: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  let theta = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < links.length; i++) {
    theta += angles[i];
    x += links[i] * Math.cos(theta);
    y += links[i] * Math.sin(theta);
    joints.push({ x, y });
  }

  return {
    tip: { x, y, theta },
    joints,
    maxReach: links.reduce((a, b) => a + b, 0),
    notes: [
      "Joint angles are RELATIVE to the previous link, so the absolute orientation of each link " +
        "is the running sum. Feeding absolute angles into this gives a wrong pose and no error.",
    ],
  };
}

export interface Ik2rSolution {
  /** Shoulder angle, radians. */
  theta1: number;
  /** Elbow angle, radians. Its SIGN is what distinguishes the two branches. */
  theta2: number;
  /** "positive" when theta2 > 0, "negative" when theta2 < 0. */
  branch: "positive" | "negative" | "coincident";
}

export interface Ik2rResult {
  reachable: boolean;
  solutions: Ik2rSolution[];
  /** Distance from the base to the target. */
  radius: number;
  /** Inner and outer radius of the reachable annulus. */
  innerReach: number;
  outerReach: number;
  /** How far outside the workspace the target is; 0 when reachable. */
  missM: number;
  singular: boolean;
  notes: string[];
}

/**
 * Inverse kinematics of a planar 2R arm.
 *
 * BOTH SOLUTIONS ARE RETURNED, always, and the branch is named by the SIGN OF
 * THETA2 rather than by "elbow up" or "elbow down" — those labels flip meaning
 * with the base-frame convention and are therefore not a specification. On a real
 * machine the two branches are separated by a singularity, so a controller cannot
 * cross between them without passing through a configuration where it loses a
 * degree of freedom.
 *
 * The workspace is an ANNULUS: |L1 - L2| <= r <= L1 + L2. Both bounds matter — an
 * arm with unequal links cannot reach its own base either.
 */
export function planar2rIk(l1: number, l2: number, x: number, y: number): Ik2rResult | null {
  if (![l1, l2, x, y].every(Number.isFinite)) return null;
  if (l1 <= 0 || l2 <= 0) return null;

  const radius = Math.hypot(x, y);
  const outerReach = l1 + l2;
  const innerReach = Math.abs(l1 - l2);
  const notes: string[] = [];
  const TOL = 1e-9;

  if (radius > outerReach + TOL || radius < innerReach - TOL) {
    const missM = radius > outerReach ? radius - outerReach : innerReach - radius;
    notes.push(
      `UNREACHABLE. The workspace is the annulus ${innerReach.toPrecision(6)} to ` +
        `${outerReach.toPrecision(6)} from the base, and the target is at ` +
        `${radius.toPrecision(6)} — outside it by ${missM.toPrecision(6)}. No joint angles put ` +
        "the tip there, so none are reported. Clamping to the nearest reachable point would " +
        "return a pose that does not reach the point you asked for.",
    );
    if (radius < innerReach) {
      notes.push(
        "The target is inside the INNER hole of the annulus. An arm whose links differ in " +
          "length cannot reach points near its own base, however it folds.",
      );
    }
    return { reachable: false, solutions: [], radius, innerReach, outerReach, missM, singular: false, notes };
  }

  // cos(theta2) from the law of cosines, clamped only against floating-point
  // overshoot at the exact boundary — never to force an unreachable target in.
  let c2 = (radius * radius - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  if (c2 > 1) c2 = 1;
  if (c2 < -1) c2 = -1;
  const t2 = Math.acos(c2);

  const singular = Math.abs(Math.sin(t2)) < 1e-7;
  const mk = (sign: 1 | -1): Ik2rSolution => {
    const theta2 = sign * t2;
    const theta1 = Math.atan2(y, x) - Math.atan2(l2 * Math.sin(theta2), l1 + l2 * Math.cos(theta2));
    return { theta1, theta2, branch: singular ? "coincident" : sign > 0 ? "positive" : "negative" };
  };

  const solutions = singular ? [mk(1)] : [mk(1), mk(-1)];

  if (singular) {
    const kind = Math.abs(radius - outerReach) < 1e-6 ? "fully extended" : "fully folded";
    notes.push(
      `SINGULAR: the arm is ${kind} (theta2 = ${(t2 * 180) / Math.PI === 0 ? "0" : "180"}°), so the ` +
        "two branches COINCIDE and there is only one solution. Here the arm cannot move radially " +
        "at all — the Jacobian has lost rank — and an inverse-Jacobian controller divides by " +
        "nearly zero, so commanded joint rates blow up near this pose.",
    );
  } else {
    notes.push(
      "TWO solutions, always. They are named by the SIGN of theta2 rather than 'elbow up/down', " +
        "because those labels flip with the base-frame convention. The two are separated by a " +
        "singularity: a real arm cannot move from one to the other without passing through full " +
        "extension or full fold.",
    );
  }

  if (radius < 1e-12 && Math.abs(l1 - l2) < 1e-12) {
    notes.push(
      "The target is the base itself with equal links, so the arm is folded exactly back on " +
        "itself and theta1 is UNDETERMINED: every shoulder angle works. One value is shown, but " +
        "it is arbitrary.",
    );
  }

  return { reachable: true, solutions, radius, innerReach, outerReach, missM: 0, singular, notes };
}

export interface JacobianResult {
  /** Row-major 2x2: [dx/dth1, dx/dth2, dy/dth1, dy/dth2]. */
  j: [number, number, number, number];
  determinant: number;
  /** sqrt(det(J*J^T)) — equals |det J| for a square Jacobian. */
  manipulability: number;
  /** Singular values, largest first. */
  singularValues: [number, number];
  /** sigma_max / sigma_min; Infinity exactly at a singularity. */
  conditionNumber: number;
  singular: boolean;
  /** Joint torques that resist a unit tip force, if one was given: tau = J^T F. */
  jointTorques: [number, number] | null;
  notes: string[];
}

/**
 * The 2R Jacobian, its singular values and the static torque map.
 *
 * det(J) = L1*L2*sin(theta2) — it depends ONLY on the elbow angle, which is why
 * the singularities are exactly full extension and full fold and why the shoulder
 * angle cannot help. Manipulability is sqrt(det(J J^T)), equal to |det J| here.
 *
 * The static relation is tau = J^T * F, NOT J * F: the transpose maps a tip force
 * to the joint torques that hold against it. Using J itself gives numbers of the
 * right magnitude and the wrong meaning.
 */
export function planar2rJacobian(
  l1: number,
  l2: number,
  theta1: number,
  theta2: number,
  tipForce?: [number, number],
): JacobianResult | null {
  if (![l1, l2, theta1, theta2].every(Number.isFinite)) return null;
  if (l1 <= 0 || l2 <= 0) return null;

  const s1 = Math.sin(theta1);
  const c1 = Math.cos(theta1);
  const s12 = Math.sin(theta1 + theta2);
  const c12 = Math.cos(theta1 + theta2);

  const a = -l1 * s1 - l2 * s12;
  const b = -l2 * s12;
  const c = l1 * c1 + l2 * c12;
  const d = l2 * c12;

  const determinant = a * d - b * c;
  const manipulability = Math.abs(determinant);

  // Singular values of a 2x2, in closed form rather than by iteration.
  const S = a * a + b * b + c * c + d * d;
  const disc = Math.max(0, S * S - 4 * determinant * determinant);
  const root = Math.sqrt(disc);
  const s1sq = (S + root) / 2;
  const s2sq = Math.max(0, (S - root) / 2);
  const sigma1 = Math.sqrt(s1sq);
  const sigma2 = Math.sqrt(s2sq);

  const singular = manipulability < 1e-9 * l1 * l2;
  const conditionNumber = sigma2 === 0 ? Infinity : sigma1 / sigma2;

  const notes: string[] = [
    "det(J) = L1·L2·sin(θ₂) — it depends ONLY on the elbow angle, which is why the singularities " +
      "are exactly full extension (θ₂ = 0) and full fold (θ₂ = ±180°) and why no shoulder angle " +
      "can rescue them.",
  ];
  if (singular) {
    notes.push(
      "SINGULAR: the Jacobian has rank 1 here. The tip can still move along one direction but " +
        "not at all along the other, and the joint rates an inverse-Jacobian controller asks for " +
        "diverge. The condition number is infinite, not merely large.",
    );
  } else if (conditionNumber > 10) {
    notes.push(
      `Condition number ${conditionNumber.toPrecision(4)}: the arm is far stiffer in one ` +
        "direction than the other, so a small tip motion in the weak direction needs large joint " +
        "motion. Near-singular is a practical problem long before exactly singular.",
    );
  }

  let jointTorques: [number, number] | null = null;
  if (tipForce !== undefined) {
    if (!Array.isArray(tipForce) || tipForce.length !== 2 || !tipForce.every(Number.isFinite)) return null;
    // tau = J^T F.
    jointTorques = [a * tipForce[0] + c * tipForce[1], b * tipForce[0] + d * tipForce[1]];
    notes.push(
      "Joint torques are J TRANSPOSE times the tip force, which is the map from a force at the " +
        "tip to the torques that hold against it. Using J itself would give numbers of the right " +
        "size and the wrong meaning.",
    );
  }

  return {
    j: [a, b, c, d],
    determinant,
    manipulability,
    singularValues: [sigma1, sigma2],
    conditionNumber,
    singular,
    jointTorques,
    notes,
  };
}

export interface DhRow {
  /** Joint angle about z, radians. */
  theta: number;
  /** Offset along z, metres. */
  d: number;
  /** Link length along x, metres. */
  a: number;
  /** Link twist about x, radians. */
  alpha: number;
}

export interface DhResult {
  /** Tip position, metres. */
  position: [number, number, number];
  /** Row-major 3x3 rotation matrix of the tip frame. */
  rotation: number[];
  /** Roll, pitch, yaw in radians (ZYX convention), null at gimbal lock. */
  rpy: [number, number, number] | null;
  gimbalLock: boolean;
  notes: string[];
}

/**
 * Forward kinematics of a serial chain from standard Denavit-Hartenberg rows.
 *
 * Uses the STANDARD (Denavit-Hartenberg 1955) convention,
 *   T = Rot_z(theta) * Trans_z(d) * Trans_x(a) * Rot_x(alpha),
 * not the "modified"/Craig convention, which orders the same four factors
 * differently and gives a DIFFERENT pose for the same table. A DH table is
 * meaningless without saying which convention it is in, so this says.
 */
export function dhForward(rows: DhRow[]): DhResult | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  for (const r of rows) {
    if (![r.theta, r.d, r.a, r.alpha].every(Number.isFinite)) return null;
  }

  // 4x4 accumulated as row-major 16.
  let T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const mul = (A: number[], B: number[]): number[] => {
    const O = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += A[i * 4 + k] * B[k * 4 + j];
        O[i * 4 + j] = s;
      }
    }
    return O;
  };

  for (const r of rows) {
    const ct = Math.cos(r.theta);
    const st = Math.sin(r.theta);
    const ca = Math.cos(r.alpha);
    const sa = Math.sin(r.alpha);
    const A = [
      ct, -st * ca, st * sa, r.a * ct,
      st, ct * ca, -ct * sa, r.a * st,
      0, sa, ca, r.d,
      0, 0, 0, 1,
    ];
    T = mul(T, A);
  }

  const rotation = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]];
  const position: [number, number, number] = [T[3], T[7], T[11]];

  // ZYX Euler angles. |R31| = 1 is gimbal lock: pitch is +-90 degrees, and roll
  // and yaw stop being separable — only their sum (or difference) is determined.
  const r31 = rotation[6];
  const notes: string[] = [
    "STANDARD Denavit-Hartenberg convention (Rot_z · Trans_z · Trans_x · Rot_x). The " +
      "'modified' or Craig convention orders the same four factors differently and gives a " +
      "DIFFERENT pose from the same table, so a DH table without its convention is ambiguous.",
  ];
  let rpy: [number, number, number] | null = null;
  const gimbalLock = Math.abs(Math.abs(r31) - 1) < 1e-9;
  if (gimbalLock) {
    notes.push(
      "GIMBAL LOCK: the pitch is ±90°, where roll and yaw are no longer separable — only their " +
        "sum is determined, and any split between them is arbitrary. No roll/pitch/yaw triple is " +
        "reported, because every one that fits would be a guess. The rotation matrix above is " +
        "exact and unambiguous.",
    );
  } else {
    const pitch = Math.atan2(-r31, Math.hypot(rotation[0], rotation[3]));
    const yaw = Math.atan2(rotation[3], rotation[0]);
    const roll = Math.atan2(rotation[7], rotation[8]);
    rpy = [roll, pitch, yaw];
  }

  return { position, rotation, rpy, gimbalLock, notes };
}

export interface ProfileResult {
  /** "trapezoidal" when the cruise speed is reached, otherwise "triangular". */
  shape: "trapezoidal" | "triangular";
  totalTimeS: number;
  accelTimeS: number;
  cruiseTimeS: number;
  /** Highest speed actually reached — below vmax for a short move. */
  peakSpeed: number;
  /** Distance covered in each phase. */
  accelDistance: number;
  cruiseDistance: number;
  notes: string[];
}

/**
 * A trapezoidal velocity profile, falling back to triangular automatically.
 *
 * THE SHORT-MOVE CASE IS THE ONE THAT GOES WRONG. If the move is too short to
 * reach vmax, there is no cruise phase and the peak speed is sqrt(a*d), NOT vmax.
 * Computing the duration as d/vmax + vmax/a regardless returns a time the machine
 * cannot achieve, and it is wrong in the direction that matters: it promises the
 * move is faster than it is.
 */
export function trapezoidalProfile(distance: number, vmax: number, amax: number): ProfileResult | null {
  if (![distance, vmax, amax].every(Number.isFinite)) return null;
  if (distance < 0 || vmax <= 0 || amax <= 0) return null;

  if (distance === 0) {
    return {
      shape: "triangular",
      totalTimeS: 0,
      accelTimeS: 0,
      cruiseTimeS: 0,
      peakSpeed: 0,
      accelDistance: 0,
      cruiseDistance: 0,
      notes: ["Zero distance: the move takes no time because there is no move."],
    };
  }

  // Distance consumed accelerating to vmax and decelerating back.
  const accelDistanceFull = (vmax * vmax) / (2 * amax);
  const notes: string[] = [];

  if (2 * accelDistanceFull <= distance) {
    const accelTimeS = vmax / amax;
    const cruiseDistance = distance - 2 * accelDistanceFull;
    const cruiseTimeS = cruiseDistance / vmax;
    notes.push(
      "Trapezoidal: the move is long enough to reach the commanded speed, so there is a cruise " +
        "phase at vmax.",
    );
    return {
      shape: "trapezoidal",
      totalTimeS: 2 * accelTimeS + cruiseTimeS,
      accelTimeS,
      cruiseTimeS,
      peakSpeed: vmax,
      accelDistance: accelDistanceFull,
      cruiseDistance,
      notes,
    };
  }

  // Triangular: accelerate to the midpoint, then decelerate.
  const peakSpeed = Math.sqrt(amax * distance);
  const accelTimeS = peakSpeed / amax;
  notes.push(
    `TRIANGULAR: the move is too short to reach ${vmax} — it peaks at ` +
      `${peakSpeed.toPrecision(6)} and there is NO cruise phase. Computing the time as ` +
      "d/vmax + vmax/a here would promise a move the machine cannot make.",
  );
  return {
    shape: "triangular",
    totalTimeS: 2 * accelTimeS,
    accelTimeS,
    cruiseTimeS: 0,
    peakSpeed,
    accelDistance: distance / 2,
    cruiseDistance: 0,
    notes,
  };
}

export interface DiffDriveResult {
  /** Forward speed of the body centre. */
  linearSpeed: number;
  /** Yaw rate, rad/s. Positive is a left turn for the convention below. */
  angularSpeed: number;
  /** Radius of the instantaneous centre of curvature; Infinity when straight. */
  turnRadius: number;
  /** Left and right wheel speeds, echoed or derived. */
  leftSpeed: number;
  rightSpeed: number;
  /** Wheel angular speeds if a wheel radius was given, rad/s. */
  wheelRates: [number, number] | null;
  notes: string[];
}

/**
 * Differential-drive kinematics from the two wheel speeds.
 *
 *   v = (vr + vl)/2,  omega = (vr - vl)/W,  R = v/omega
 *
 * W IS THE TRACK WIDTH — the distance between the two wheels — and dividing by
 * the half-track instead is a clean factor of two in the yaw rate. Equal wheel
 * speeds mean an INFINITE turn radius, not a zero one; returning zero there
 * describes a robot spinning on the spot, which is the opposite motion.
 */
export function diffDriveFromWheels(
  leftSpeed: number,
  rightSpeed: number,
  trackWidth: number,
  wheelRadius?: number,
): DiffDriveResult | null {
  if (![leftSpeed, rightSpeed, trackWidth].every(Number.isFinite)) return null;
  if (trackWidth <= 0) return null;

  const linearSpeed = (rightSpeed + leftSpeed) / 2;
  const angularSpeed = (rightSpeed - leftSpeed) / trackWidth;
  const notes: string[] = [
    "W is the TRACK WIDTH, wheel to wheel. Using the half-track doubles the yaw rate, and " +
      "nothing in the answer would say so.",
  ];

  let turnRadius: number;
  if (angularSpeed === 0) {
    turnRadius = Infinity;
    notes.push(
      "Equal wheel speeds: the robot goes STRAIGHT and the turn radius is infinite, not zero. " +
        "Zero radius would describe spinning on the spot, which is the opposite motion.",
    );
  } else if (linearSpeed === 0) {
    turnRadius = 0;
    notes.push(
      "Equal and opposite wheel speeds: the robot spins on the spot, so the turn radius is " +
        "exactly zero and the centre of rotation is between the wheels.",
    );
  } else {
    turnRadius = linearSpeed / angularSpeed;
  }

  let wheelRates: [number, number] | null = null;
  if (wheelRadius !== undefined) {
    if (!Number.isFinite(wheelRadius) || wheelRadius <= 0) return null;
    wheelRates = [leftSpeed / wheelRadius, rightSpeed / wheelRadius];
  }

  notes.push(
    "Rolling without slipping, on a rigid flat floor. Wheel slip, caster drag and any " +
      "compliance are not modelled, and on a real robot they are what the odometry error is " +
      "made of.",
  );

  return { linearSpeed, angularSpeed, turnRadius, leftSpeed, rightSpeed, wheelRates, notes };
}

/** The inverse: wheel speeds that produce a commanded body velocity. */
export function diffDriveToWheels(
  linearSpeed: number,
  angularSpeed: number,
  trackWidth: number,
  wheelRadius?: number,
): DiffDriveResult | null {
  if (![linearSpeed, angularSpeed, trackWidth].every(Number.isFinite)) return null;
  if (trackWidth <= 0) return null;
  const rightSpeed = linearSpeed + (angularSpeed * trackWidth) / 2;
  const leftSpeed = linearSpeed - (angularSpeed * trackWidth) / 2;
  const r = diffDriveFromWheels(leftSpeed, rightSpeed, trackWidth, wheelRadius);
  if (!r) return null;
  r.notes.unshift("Wheel speeds derived from the commanded body velocity; the round trip is exact.");
  return r;
}
