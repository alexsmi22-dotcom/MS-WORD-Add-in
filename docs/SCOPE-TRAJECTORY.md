# Scope — Trajectory suite

Proposed as a **nineteenth Engineering discipline**. Scoped 2026-08-02 against
v2.76.0 (101 calculators / 18 disciplines). Nothing built yet.

---

## 1. Verdict

**Greenfield, and unusually cheap to build.** A survey found nothing: the only
matches for "orbit", "trajectory", "ballistic" or "intercept" in `src/lib` are
false positives — electron *orbitals* in `periodicChart.ts`, ODE *trajectories*
in `ode.ts`, and regression *intercept* in `stats.ts`.

**No units release is needed**, which is the difference from audio/video. Probed
with `convert()` before scoping, per the standing rule: `km/s`, `kt`, `nmi`,
`deg→rad`, `m/s²`, **`m/s³` (jerk)** and **`N·s ≡ kg·m/s` (impulse)** all already
resolve. Building can start on the calculators directly.

**It serves the client base squarely** — avionics, aviation, robotics and
aerospace are four of the domains already built out, and this is the physics
that connects them.

---

## 2. What it builds on

This is the strongest reuse case since the audio bench, and one piece of it is
decisive:

| Existing | Reused for |
|---|---|
| **`ode.ts` — RK45 + stiff, with TERMINAL EVENTS** | drag trajectories, stopping exactly at ground impact |
| `aero.ts` — ISA atmosphere, density vs altitude | drag that varies with height |
| `robotics.ts` — `trapezoidalProfile` | extend to jerk-limited S-curve |
| `plot.ts` — plotting, log axes | every trajectory figure |
| `fluids.ts` — `G`, drag concepts | consistency of g across the product |
| `solve.ts` — root finding | launch angle for a required range |

**The terminal-event support in `ode.ts` is what makes this tractable.** It was
built in v1.57.0 and carries a hard-won fix: a terminal event is only known
*after* the crossing step, so an overshoot used to carry the trajectory
underground. Ground impact is exactly that event, and the fix is already in.

---

## 3. Proposed calculators

Built around the counter-intuitive results, as the vibration and audio benches
were.

### A. Ballistic / projectile (4)
1. **Vacuum projectile** — range, apex, flight time, from speed and angle, with
   unequal launch/landing heights. *Counter-intuitive:* **45° is only optimal
   when launch and landing heights are equal.** Throwing from a height, the
   best angle is below 45°, and the usual textbook answer is a special case.
2. **Projectile with drag** — numerical, via `ode.ts` with a ground-impact
   terminal event and ISA density from `aero.ts`. *Counter-intuitive:* **drag is
   not a correction, it is the dominant term.** A rifle bullet's vacuum range is
   several times its real range, and the optimum angle drops well below 45°.
3. **Launch angle for a target** — solve the inverse problem; report **both**
   solutions (high and low trajectory) or refuse when the target is out of
   reach. Same doctrine as the 2R arm returning both IK branches.
4. **Impact and energy** — terminal velocity, impact energy and momentum.

### B. Orbital (5)
5. **Circular orbit** — velocity, period, altitude relationships. *Counter-
   intuitive:* a **lower** orbit is a **faster** one.
6. **Elliptical orbit / Kepler elements** — semi-major axis, eccentricity,
   apoapsis/periapsis, vis-viva. *Counter-intuitive:* period depends **only** on
   semi-major axis, not on eccentricity — a wildly elliptical orbit and a circle
   of the same *a* take exactly the same time.
7. **Hohmann transfer** — the two burns, total Δv, transfer time. *Counter-
   intuitive, and the best result in the subject:* **to catch something ahead of
   you in the same orbit, you must slow down** — dropping to a lower orbit makes
   you faster in angle.
8. **Rocket equation (Tsiolkovsky)** — Δv from mass ratio and Isp, staging.
   *Counter-intuitive:* Δv is **exponential** in mass ratio, so the last
   increment costs by far the most propellant.
9. **Escape velocity & sphere of influence.** *Counter-intuitive:* escape speed
   is **independent of launch direction** (ignoring the body itself).

### C. Motion profiles (2)
10. **Jerk-limited (S-curve) profile** — extends the existing trapezoidal one.
    *Counter-intuitive:* the S-curve is **slower** for the same limits, and that
    is the point — a trapezoidal profile's instantaneous acceleration step
    excites structural modes, which is why precision machines pay the time.
11. **Multi-axis coordination** — synchronising axes so they arrive together.

### D. Navigation (2)
12. **Great-circle distance & bearing** — haversine, initial and final bearing.
    *Counter-intuitive:* the **initial bearing is not the final bearing**, and
    the shortest path does not look straight on a Mercator projection.
13. **Wind triangle** — heading, track, groundspeed, drift. Fills a named gap
    from the aviation build.

**13 calculators**, taking Engineering to **114 across 19 disciplines**.

---

## 4. Data policy

Almost nothing is blocked, which is why this is cheap:

- **g and the standard atmosphere already exist** (`fluids.G`, `aero.atmosphere`)
  and must be reused rather than redefined, so the trajectory suite and the
  aviation bench cannot disagree about the air.
- **Gravitational parameters (μ) for Earth, Moon, Mars, Sun** are definitional
  constants of the same class as the ST 2084 coefficients — but they are
  *measured*, not defined, so they get the `flame.ts` treatment: fetched from a
  citable source, script-extracted, cross-checked (e.g. μ_Earth reproduces the
  known geostationary radius and the ISS period). Not typed from memory.
- **Drag coefficients and ballistic coefficients are USER INPUTS.** Cd depends
  on shape, Mach and Reynolds number; a built-in table would be wrong for every
  projectile except the one it was measured on. Same refusal as absorption
  coefficients and Thiele-Small parameters.

---

## 5. What I would not build

- **Full 6-DOF flight simulation** — needs an aerodynamic model per airframe.
- **Guidance laws (proportional navigation, intercept solutions)** — dual-use
  and outside what a document-authoring tool should compute.
- **N-body propagation and perturbations** (J2, drag decay) — real orbit
  determination needs ephemerides and a propagator, which is a different product.
  Two-body is honest and is what a specification actually quotes.
- **Re-entry heating** — needs material and ablation data.

---

## 6. Sequencing

1. **v2.77.0 — ballistic** (A, 4 calcs). Self-contained, reuses `ode.ts` events
   and the ISA immediately, and proves the drag path.
2. **v2.78.0 — orbital** (B, 5 calcs), including the μ fetch-and-cross-check.
3. **v2.79.0 — profiles & navigation** (C + D, 4 calcs), extending
   `trapezoidalProfile` and closing the aviation wind-triangle gap.

Each release: oracle tests against closed forms (vacuum range = v²sin2θ/g,
geostationary radius, Hohmann Δv for a known transfer), a separate adversarial
pass, and a `TEST-SCRIPT.md` section.
