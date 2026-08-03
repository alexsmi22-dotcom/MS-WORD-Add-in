// Cross-section properties — area, second moment of area, section modulus,
// radius of gyration, and the first moment Q that shear stress needs.
//
// Every rectangular-family shape is decomposed into SIGNED RECTANGLES and run
// through one routine: area, centroid, parallel-axis I, then Q by clipping each
// rectangle to the region above the neutral axis. A box is an outer rectangle
// plus a negative inner one; an I-beam is three positive ones. Writing a
// separate closed-form per shape is how a transcription error gets in, and
// there is no way to notice it — I = bh^3/12 - b'h'^3/12 is right for a box and
// silently wrong the moment the inner void stops being concentric.
//
// NON-SYMMETRIC SECTIONS REPORT BOTH SECTION MODULI. A tee has its centroid
// near the flange, so the tension fibre and the compression fibre are at
// different distances and S_top != S_bot. Quoting one number for "the" section
// modulus of a tee is a standard student error that under-predicts stress on
// the far fibre — often by a factor of two or more.
//
// Units: whatever the caller supplies, consistently. Lengths in mm give I in
// mm^4 and S in mm^3; lengths in inches give in^4 and in^3. Nothing here
// converts, and the caller is responsible for saying which.

export type SectionSpec =
  | { kind: "rect"; b: number; h: number }
  | { kind: "circle"; d: number }
  /** Circular hollow section: outer diameter and wall thickness. */
  | { kind: "pipe"; d: number; t: number }
  /** Rectangular hollow section: outer width, outer depth, wall thickness. */
  | { kind: "box"; b: number; h: number; t: number }
  /** Doubly-symmetric I: flange width, flange thickness, TOTAL depth, web thickness. */
  | { kind: "ibeam"; bf: number; tf: number; d: number; tw: number }
  /** Tee: flange width, flange thickness, TOTAL depth, web thickness. */
  | { kind: "tee"; bf: number; tf: number; d: number; tw: number };

export interface SectionProps {
  name: string;
  /** Cross-sectional area. */
  A: number;
  /** Second moment of area about the horizontal centroidal axis. */
  I: number;
  /** Height of the centroid above the bottom fibre. */
  yBar: number;
  /** Distance from the neutral axis to the extreme top / bottom fibre. */
  cTop: number;
  cBot: number;
  /** Section moduli I/c. Equal for a doubly-symmetric section. */
  sTop: number;
  sBot: number;
  /** Radius of gyration sqrt(I/A) about the horizontal (bending) axis. */
  r: number;
  /**
   * Second moment about the VERTICAL centroidal axis.
   *
   * NOT NECESSARILY THE MINOR ONE — that was the first draft's mistake, and it
   * is false for any section wider than it is deep. A 200 x 50 plate on edge
   * has Iy well ABOVE I. Which axis is weaker is a fact about the dimensions,
   * not about which letter the axis got, so `Imin` exists separately and is the
   * one a buckling check needs.
   *
   * Every shape here has an axis of symmetry, so the horizontal and vertical
   * pair really are the principal axes and the smaller of the two really is the
   * minimum over all directions.
   *
   * Exact for all six shapes: every strip decomposition is symmetric about the
   * vertical centreline, so each strip's own centroid sits on that axis and the
   * parallel-axis terms all vanish.
   */
  Iy: number;
  /** Radius of gyration about the vertical axis, sqrt(Iy/A). */
  ry: number;
  /**
   * The smaller of I and Iy — THE ONE A COLUMN CHECK NEEDS.
   *
   * A column bends about whichever axis is weakest, and for an I-beam that is
   * emphatically not the axis it was designed to bend about: the section can
   * have a bending I an order of magnitude above its weak one. Quoting the
   * bending value to a buckling check overstates the critical load by that
   * whole factor, and the answer looks entirely reasonable.
   */
  Imin: number;
  /** Which axis `Imin` is about, so a report can say so rather than assume. */
  minorAxis: "horizontal" | "vertical" | "equal";
  /** First moment of the area above the neutral axis — the Q in tau = VQ/(It). */
  Q: number;
  /** Width of the section AT the neutral axis — the t in tau = VQ/(It). */
  tNA: number;
  symmetric: boolean;
  notes: string[];
}

/** A signed rectangle: width `b`, height `h`, centred at height `yc` above the datum. */
interface Strip {
  b: number;
  h: number;
  yc: number;
  sign: 1 | -1;
}

const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x) && x > 0);

/**
 * Computes the properties, then GUARDS them. The guard is applied here rather
 * than at each shape branch so that circle and pipe cannot be forgotten - the
 * first attempt wrapped only the four rectangular call sites and left exactly
 * those two unprotected.
 */
export function sectionProperties(spec: SectionSpec): SectionProps | { error: string } {
  const p = sectionPropertiesRaw(spec);
  return 'error' in p ? p : guardProps(p);
}

function sectionPropertiesRaw(spec: SectionSpec): SectionProps | { error: string } {
  switch (spec.kind) {
    case "rect": {
      if (!finite(spec.b, spec.h)) return { error: "Width and depth must both be positive." };
      return fromStrips("Rectangle", [{ b: spec.b, h: spec.h, yc: spec.h / 2, sign: 1 }], spec.h);
    }
    case "box": {
      const { b, h, t } = spec;
      if (!finite(b, h, t)) return { error: "Width, depth and wall thickness must all be positive." };
      // No em dash: the pane prints one for a non-finite number and blocks
      // Insert on finding one anywhere in a result, so an em dash used as
      // punctuation is indistinguishable from a broken value. The pipe message
      // below was fixed for this; this one was missed, and the column tool now
      // surfaces it too.
      if (2 * t >= b || 2 * t >= h)
        return { error: "Wall thickness is too large; the walls meet in the middle. Use a solid rectangle." };
      return fromStrips(
        "Rectangular hollow section",
        [
          { b, h, yc: h / 2, sign: 1 },
          { b: b - 2 * t, h: h - 2 * t, yc: h / 2, sign: -1 },
        ],
        h,
      );
    }
    case "ibeam": {
      const { bf, tf, d, tw } = spec;
      if (!finite(bf, tf, d, tw)) return { error: "All four I-beam dimensions must be positive." };
      if (2 * tf >= d) return { error: "Flanges are thicker than the section is deep." };
      if (tw > bf) return { error: "The web is wider than the flange." };
      return fromStrips(
        "I-beam",
        [
          { b: bf, h: tf, yc: tf / 2, sign: 1 },
          { b: tw, h: d - 2 * tf, yc: d / 2, sign: 1 },
          { b: bf, h: tf, yc: d - tf / 2, sign: 1 },
        ],
        d,
      );
    }
    case "tee": {
      const { bf, tf, d, tw } = spec;
      if (!finite(bf, tf, d, tw)) return { error: "All four tee dimensions must be positive." };
      if (tf >= d) return { error: "The flange is thicker than the section is deep." };
      if (tw > bf) return { error: "The web is wider than the flange." };
      return fromStrips(
        "Tee",
        [
          { b: tw, h: d - tf, yc: (d - tf) / 2, sign: 1 },
          { b: bf, h: tf, yc: d - tf / 2, sign: 1 },
        ],
        d,
      );
    }
    case "circle": {
      const { d } = spec;
      if (!finite(d)) return { error: "Diameter must be positive." };
      const A = (Math.PI * d * d) / 4;
      const I = (Math.PI * d ** 4) / 64;
      const c = d / 2;
      return {
        name: "Solid circle",
        A,
        I,
        yBar: c,
        cTop: c,
        cBot: c,
        sTop: I / c,
        sBot: I / c,
        r: Math.sqrt(I / A),
        // Axisymmetric, so every centroidal axis is the same and there is no
        // weak one. That is precisely why a round column has no preferred
        // buckling direction while an I-beam emphatically does.
        Iy: I,
        ry: Math.sqrt(I / A),
        Imin: I,
        minorAxis: "equal" as const,
        Q: d ** 3 / 12,
        tNA: d,
        symmetric: true,
        notes: [],
      };
    }
    case "pipe": {
      const { d, t } = spec;
      if (!finite(d, t)) return { error: "Diameter and wall thickness must both be positive." };
      // No em dash in this string, deliberately: the pane prints "—" for a
      // non-finite number and blocks Insert on finding one anywhere in the
      // result, so an em dash used as punctuation is indistinguishable from a
      // broken value. Found by the audit's select-option sweep.
      if (2 * t >= d) return { error: "Wall thickness is too large; this is a solid bar. Use a solid circle." };
      const di = d - 2 * t;
      const A = (Math.PI * (d * d - di * di)) / 4;
      const I = (Math.PI * (d ** 4 - di ** 4)) / 64;
      const c = d / 2;
      return {
        name: "Circular hollow section",
        A,
        I,
        yBar: c,
        cTop: c,
        cBot: c,
        sTop: I / c,
        sBot: I / c,
        r: Math.sqrt(I / A),
        Iy: I,
        ry: Math.sqrt(I / A),
        Imin: I,
        minorAxis: "equal" as const,
        Q: (d ** 3 - di ** 3) / 12,
        tNA: 2 * t,
        symmetric: true,
        notes: [],
      };
    }
  }
}

/**
 * A section whose computed properties are not finite and positive is not a
 * section. Dimensions around 1e-300 pass the "positive and finite" check on the
 * INPUTS and still underflow I to exactly zero, after which sigma = M/S divides
 * by zero and the stress comes back as Infinity. Downstream that printed as
 * "not finite", which is honest but useless; refusing here says which quantity
 * collapsed. Found by a scratch probe, not by the oracle tests.
 */
function guardProps<T extends SectionProps>(p: T): T | { error: string } {
  if (!Number.isFinite(p.A) || p.A <= 0)
    return { error: "These dimensions give a zero or non-finite area. Check the units and magnitudes." };
  if (!Number.isFinite(p.I) || p.I <= 0)
    return {
      error:
        "These dimensions underflow the second moment of area to zero, so no stress can be computed from them. " +
        "Try the same section in larger units, for example mm rather than km.",
    };
  // The minor axis gets the same guard as the major one. It is the axis a
  // column buckles about, so an underflowed Iy would hand a buckling check a
  // zero and produce a critical load of zero for a perfectly sound section.
  if (!Number.isFinite(p.Iy) || p.Iy <= 0)
    return {
      error:
        "These dimensions underflow the second moment about the vertical axis to zero. A column " +
        "buckles about whichever axis is weaker, so nothing here would be safe to use. Try " +
        "larger units.",
    };
  return p;
}

function fromStrips(name: string, strips: Strip[], depth: number): SectionProps {
  let A = 0;
  let Ay = 0;
  for (const s of strips) {
    const a = s.sign * s.b * s.h;
    A += a;
    Ay += a * s.yc;
  }
  const yBar = Ay / A;

  let I = 0;
  for (const s of strips) {
    const a = s.sign * s.b * s.h;
    I += s.sign * ((s.b * s.h ** 3) / 12) + a * (s.yc - yBar) ** 2;
  }

  // Minor axis. Every strip is centred on the vertical centreline for all four
  // strip-built shapes, so there is no parallel-axis term to add here — the
  // whole sum is the strips' own second moments about that shared axis.
  let Iy = 0;
  for (const s of strips) Iy += s.sign * ((s.h * s.b ** 3) / 12);

  // Q: first moment about the neutral axis of everything above it, by clipping
  // each strip to [yBar, top]. Exact per strip, so a void is subtracted correctly.
  let Q = 0;
  for (const s of strips) {
    const lo = Math.max(s.yc - s.h / 2, yBar);
    const hi = s.yc + s.h / 2;
    if (hi <= lo) continue;
    Q += s.sign * s.b * (((hi - yBar) ** 2 - (lo - yBar) ** 2) / 2);
  }

  // Width at the neutral axis: the web, for an I-beam.
  let tNA = 0;
  for (const s of strips) {
    const lo = s.yc - s.h / 2;
    const hi = s.yc + s.h / 2;
    if (yBar > lo && yBar < hi) tNA += s.sign * s.b;
  }

  const cBot = yBar;
  const cTop = depth - yBar;
  const symmetric = Math.abs(cTop - cBot) < 1e-12 * Math.max(cTop, cBot, 1);
  const notes: string[] = [];
  if (!symmetric)
    notes.push(
      "This section is not symmetric about its neutral axis, so the top and bottom fibres are at " +
        "different distances and have DIFFERENT section moduli. Check the stress at both — the smaller " +
        "modulus governs.",
    );
  return {
    name,
    A,
    I,
    yBar,
    cTop,
    cBot,
    sTop: I / cTop,
    sBot: I / cBot,
    r: Math.sqrt(I / A),
    Iy,
    ry: Math.sqrt(Iy / A),
    Imin: Math.min(I, Iy),
    // Which one is weaker is a fact about the dimensions, not about which
    // letter the axis got. A plate on edge is weakest about the HORIZONTAL
    // axis, and calling Iy "the minor axis" would be wrong for it.
    minorAxis:
      Math.abs(I - Iy) <= 1e-12 * Math.max(I, Iy, 1) ? "equal" : I < Iy ? "horizontal" : "vertical",
    Q,
    tNA,
    symmetric,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Stress
// ---------------------------------------------------------------------------

export interface BendingStress {
  /** Peak bending stress at the governing fibre. */
  sigma: number;
  /** Which fibre governs. */
  fibre: "top" | "bottom";
  /** Transverse shear stress at the neutral axis, tau = VQ/(It). */
  tau: number;
}

/**
 * Bending and shear stress from a moment and a shear force.
 *
 * Sign handling matters on a non-symmetric section: a sagging moment puts the
 * BOTTOM fibre in tension, and it is the fibre with the SMALLER section modulus
 * that reaches yield first, which for a tee is usually not the one a student
 * checks. Both are computed and the larger magnitude is returned.
 */
export function bendingStress(props: SectionProps, moment: number, shear = 0): BendingStress {
  const sTopStress = Math.abs(moment) / props.sTop;
  const sBotStress = Math.abs(moment) / props.sBot;
  const topGoverns = sTopStress >= sBotStress;
  return {
    sigma: topGoverns ? sTopStress : sBotStress,
    fibre: topGoverns ? "top" : "bottom",
    tau: props.tNA > 0 && props.I > 0 ? Math.abs(shear) * (props.Q / (props.I * props.tNA)) : 0,
  };
}
