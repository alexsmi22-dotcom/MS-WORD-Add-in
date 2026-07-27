# Geometry and algebraic topology in Solve — design and build order

_Written 2026-07-27, at v2.6.0, immediately after CAS Release 2 shipped. Same
purpose as `docs/CAS-DESIGN.md`: so the next session starts at the first line of
code instead of re-deriving what is already settled._

**Decision (user, 2026-07-27):** the next thing to go into Solve is **geometry,
basic through expert, and algebraic topology.**

---

## 0. The honest framing, first

Most of geometry is straightforwardly computable and belongs in a tool like
this. **Algebraic topology is not uniformly computable**, and the difference has
to be designed in from the start rather than discovered later.

What is genuinely computable, exactly, on a laptop:

- simplicial **homology over ℤ**, including torsion, via Smith Normal Form;
- **Betti numbers** and **Euler characteristic**;
- **persistent homology** of a point cloud (this is real data analysis);
- **knot polynomials** (Alexander, Jones) from a diagram, at small crossing number.

What is **not** computable in general, and must never be claimed:

- **The word problem for groups is undecidable** (Novikov–Boone). So π₁ can be
  *presented*, never simplified to a normal form, and "is this group trivial?"
  cannot be answered in general.
- **The homeomorphism problem is undecidable** for manifolds of dimension ≥ 4
  (Markov). The tool must never say "these two spaces are the same".
- Homotopy equivalence is likewise undecidable in general.

This is exactly the class of trap the product has been avoiding everywhere else:
a confident answer with an authoritative derivation attached, where the honest
output is "this cannot be decided". The homology path is safe because it is
linear algebra over ℤ; the π₁ path is dangerous and is deliberately scoped to
*presentation + abelianisation* only.

---

## 1. Geometry — scope, tier by tier

All of it deterministic, offline, and **exact wherever the CAS can carry it**
(the Release-1 rational core plus `sqrt` atoms mean areas like `6√3` and
`25π/4` stay exact instead of collapsing to 10.392 and 19.635).

### Tier 1 — mensuration and triangles
- Area / perimeter / surface area / volume for the standard shapes, exact.
- **Triangle solving**: SSS, SAS, ASA, AAS, and **SSA**. SSA is the honesty
  case: it yields **two triangles, one, or none**, and a solver that silently
  returns the acute solution is wrong half the time. Report every solution, and
  say when the configuration is impossible.
- Law of sines / cosines, Heron's formula, circumradius/inradius.
- Circle: arc length, sector and segment area, chord, tangent length, the
  inscribed-angle relations.

### Tier 2 — analytic (coordinate) geometry
- Points and lines: distance, midpoint, slope, line through two points,
  parallel/perpendicular, angle between, point–line distance, intersection.
- Circle from three points (and the degenerate collinear case, reported).
- **Conic classification** — the tier's centrepiece. Given a general
  `A x² + B xy + C y² + D x + E y + F = 0`, classify by the invariants
  (δ = B²−4AC, and the 3×3 determinant for degeneracy), **rotate** to kill the
  xy term, **translate** to the centre, and report the canonical form together
  with centre, vertices, foci, axes, eccentricity, directrices and asymptotes.
  Degenerate cases (point, line pair, empty) are named, not forced into an
  ellipse. Tedious by hand, completely mechanical, exact over the rationals.
- **Triangle centres**: centroid, circumcentre, incentre, orthocentre — plus the
  **Euler line**, which gives a free self-check: centroid, circumcentre and
  orthocentre must be collinear, and the tool can verify its own output.
- Polygons: **shoelace** area, centroid, convexity, point-in-polygon (winding
  number, which unlike ray casting is unambiguous on the boundary), and
  **convex hull** (Andrew monotone chain).

### Tier 3 — vectors, lines and planes in 3D
- Dot, cross, scalar triple product; norms, angles, projections, rejections.
- Plane from three points; point–plane distance; line–plane intersection;
  **distance between skew lines**; angle between planes.
- Volume of a tetrahedron / parallelepiped by determinant (sign = orientation).
- Sphere through four points.

### Tier 4 — transformations
- 2D and 3D rotation, reflection, scaling, shear as matrices; composition;
  homogeneous coordinates for translation.
- Determinant as the area/volume scale factor, and its sign as orientation.
- Reuses `linalg.ts` rather than growing a second matrix implementation.

---

## 2. Algebraic topology — scope

### T1 — simplicial homology over ℤ (the core)
Input is a **simplicial complex**, given either as a list of maximal simplices
(`[0,1,2] [1,2,3] …`) or chosen from a built-in library.

1. Generate all faces; count cells per dimension.
2. Build the boundary matrices ∂ₖ over **ℤ** (entries −1/0/+1 from the standard
   alternating face map).
3. **Smith Normal Form** of each ∂ₖ over ℤ.
4. Read off `Hₖ = ℤ^βₖ ⊕ (torsion from the elementary divisors)`.

Report βₖ, the torsion coefficients, and the Euler characteristic **computed two
independent ways** — the alternating sum of cell counts, and the alternating sum
of Betti numbers. They must agree; that is a genuine internal check, in the same
spirit as the CAS differentiating its antiderivatives back, and it is cheap.

Built-in complexes worth shipping, because they are the ones people check
against: point, interval, S¹, S², Sⁿ (boundary of a simplex), **torus T²**,
**Klein bottle**, **ℝP²**, **Möbius band**, disk, annulus, wedge sums.

The Klein bottle and ℝP² are the reason **ℤ, not ℚ**: their H₁ carries ℤ/2
torsion which vanishes over a field. Anything computing Betti numbers over ℚ
alone and calling it "the homology" is throwing that away silently. It is also
the sharpest test case available — if the code says H₁(ℝP²) = ℤ/2, the Smith
Normal Form is almost certainly right.

### T2 — persistent homology (the one that earns its place for a scientist)
This is the entry that connects topology to the product's actual north star,
because its input is **a pasted table of points** — the same gesture as Stats
and Analyze.

- Build a **Vietoris–Rips** filtration over a distance threshold range.
- Reduce the boundary matrix over 𝔽₂ (standard persistence algorithm).
- Output **persistence pairs** (birth, death, dimension), a **barcode** and a
  **persistence diagram** as inserted figures, plus the table.

Honest limits, stated in-pane: the Rips complex grows combinatorially, so the
maximum dimension and point count are **capped and the cap is reported** (the
project rule is no silent truncation); coefficients are 𝔽₂; the result depends
on the metric, which is named.

### T3 — knot polynomials (optional, high value per effort)
- **Alexander polynomial** from a PD code / braid word, via the Alexander matrix
  (a determinant over ℤ[t,t⁻¹] — exact).
- **Jones polynomial** via the Kauffman bracket. Exponential in crossings, so it
  is capped and says so.
- Both are genuine invariants; neither is complete, and the output must say that
  two knots sharing a polynomial are **not** thereby proved equivalent.

### T4 — fundamental group (scoped hard, on purpose)
- Present π₁ from a 2-complex (edge-path group) or a knot diagram (Wirtinger).
- **Abelianise** to get H₁, which *is* computable, and report that as the
  reliable part.
- State plainly that simplification of the presentation is undecidable in
  general, so the tool reports a presentation and does not claim to identify the
  group. No "this is ℤ/3" unless it came from abelianisation.

---

## 3. Build order

**Release G1 — geometry Tiers 1–2.** Mensuration, triangle solving (with the
full SSA case), analytic geometry, conic classification. Highest value per unit
effort and entirely exact; verifiable against closed-form answers.

**Release G2 — geometry Tiers 3–4.** Vectors, planes, skew lines,
transformations. Mostly `linalg.ts` glue.

**Release T1 — simplicial homology over ℤ.** Smith Normal Form is the only real
algorithmic content; the built-in complexes give an exact, non-negotiable test
oracle (β of a torus is 1,2,1; H₁(ℝP²) = ℤ/2).

**Release T2 — persistent homology.** Needs T1's boundary-matrix machinery.

**Later, unordered:** knot polynomials, π₁ presentations, homology with
arbitrary field coefficients, Mayer–Vietoris helpers, cell complexes beyond
simplicial.

> **STATUS (v2.11.0): tier A1 SHIPPED** — cellular homology, characteristic
> classes and unoriented cobordism are live in `src/lib/topology2.ts`. A2
> (spectral sequences) and A3 (stable homotopy) are NOT built, and are now
> answered with a statement of what is and is not computable rather than
> silently missing. G1, G2, T1 and T2 all shipped earlier the same day.

### Release A — ADVANCED algebraic topology (user, 2026-07-27)

Scoped for a future round: **cellular homology, spectral sequences, stable
homotopy theory; generalised cohomology theories, characteristic classes,
cobordism.**

That list spans three very different computability regimes, and the whole value
of writing it down now is to keep them apart — building it as though it were one
uniform capability is how a tool ends up asserting things nobody can compute.

**A1 — genuinely computable, and worth building first.**
- **Cellular homology.** A CW structure has far fewer cells than a simplicial
  one (ℝP² needs 6+ simplices but 3 cells), so the boundary matrices are small.
  The cellular boundary is the matrix of **degrees** of the attaching maps; when
  the user supplies those degrees, the homology is exact integer linear algebra —
  the same Smith Normal Form as T1. This is the single biggest practical win in
  the advanced list and should lead.
- **Characteristic classes.** Stiefel–Whitney, Chern and Pontryagin classes of
  sums, tensor products and duals of bundles are **symmetric-polynomial algebra**
  via the splitting principle — Whitney sum formula, Chern character, Todd class.
  This is exact symbolic computation and fits the CAS core directly. Chern
  classes of a tensor product of line bundles, `c(E⊕F) = c(E)c(F)`, and the
  resulting Stiefel–Whitney/Chern **numbers** are all mechanical.
- **Cobordism, in low degrees.** Thom: the unoriented cobordism ring is a
  polynomial algebra over 𝔽₂, and **Stiefel–Whitney numbers are a complete
  invariant of unoriented cobordism class** — so "are these two manifolds
  cobordant?" IS decidable unorientedly and is a real, checkable computation.
  Oriented cobordism is harder and should be scoped separately.
- **K-theory of simple spaces** via Bott periodicity and the Chern character.

**A2 — computable only in pieces, and the pieces must be labelled.**
- **Spectral sequences.** The **E₂ page** of a Serre, Mayer–Vietoris or
  Atiyah–Hirzebruch spectral sequence is computable from homology input, and
  displaying that page as a grid is genuinely useful. **The differentials are
  not determined by the algebra**, and neither are the extensions at the
  abutment: two different spaces can share an E₂ page and differ in d₂. So the
  honest product is "here is E₂, here is what converges to what, and here is
  exactly which differentials remain undetermined" — never a computed H* handed
  over as though the sequence had collapsed.

**A3 — tabulated, never computed.**
- **Stable homotopy groups of spheres.** πₙˢ is known only in a finite range,
  and that range is the product of decades of work (Adams spectral sequence,
  motivic methods; the ~90-stem frontier). Nothing here can compute them. If
  they appear at all they are a **cited literature table**, labelled as such,
  with the range stated and the frontier named — the same standard the NMR
  predictions are held to.

**The rule this section exists to enforce:** general homotopy groups, homotopy
equivalence and homeomorphism are undecidable (§0). A tool that computes
cellular homology and characteristic classes exactly, shows an E₂ page with its
unknown differentials marked, and cites a table for πₙˢ is honest and genuinely
useful. One that blurs those three regimes together is the fabrication failure
this project has spent its whole history designing out.

---

## 4. Constraints and risks

- **Exactness.** Geometry answers route through the CAS so `√`, `π` and rationals
  survive; a decimal is offered alongside, never instead.
- **Smith Normal Form suffers integer coefficient explosion.** Use pivoting on
  the smallest nonzero entry, and bound the work; if the bound is hit, say so
  rather than returning a half-reduced answer.
- **Rips complexes explode.** Cap simplex count and report the cap.
- **Never claim decidability the mathematics does not have** (§0).
- **Degenerate input is the normal case, not an edge case**: collinear points for
  a circumcircle, zero-area triangles, parallel lines, empty conics, a complex
  that is not a valid simplicial complex. Each gets a named result.
- **Performance**: Solve recomputes on every keystroke. Homology of a large
  complex must not run on the live path unless asked.

## 5. Test strategy

- **Geometry**: closed-form oracles (equilateral triangle area = √3/4·s²; the
  3-4-5 right triangle; a circle through three known points). Property checks —
  the Euler line collinearity, shoelace area invariant under vertex rotation and
  sign-flipping under reversal, convex hull membership.
- **SSA**: pin all three outcomes (two triangles, one, none) explicitly.
- **Conics**: round-trip — classify, then rebuild the general equation from the
  canonical form + rotation/translation and require it to match the original up
  to scale, canonically.
- **Homology**: the built-in spaces are the oracle. β(T²) = (1,2,1),
  β(S²) = (1,0,1), H₁(ℝP²) = ℤ/2, H₁(Klein) = ℤ ⊕ ℤ/2. Plus the internal
  Euler-characteristic cross-check on every input.
- **Persistence**: a noisy circle must show exactly one long H₁ bar; a blob must
  show none. That is the property that matters, not exact bar endpoints.
- **Honesty**: assert that π₁ output never claims to identify a group, and that
  knot-polynomial output never claims two knots are equivalent.
