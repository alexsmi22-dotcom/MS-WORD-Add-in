# JurisLab — Open Items

_Compiled 2026-07-27 at **v2.22.0**, verified against the source rather than against
the older lists' checkboxes._

This supersedes the status marks in [PUNCH-LIST.md](PUNCH-LIST.md) (written
2026-07-15 at v1.65.2) and [PUNCH-LIST-ADDITIONS.md](PUNCH-LIST-ADDITIONS.md).
Both had drifted: Kaplan–Meier survival and USPTO paragraph numbering were still
marked open having shipped in v2.3.0 and v1.99.0, and the double-size figure bug
was marked open having been fixed. Those files are kept for their reasoning and
their history; **this file is the current status.**

Every item below was checked against the tree at `33f69c3`. Where an item is
_gone_, it is not listed. Ordering follows the house rule: **risk to the user
first, effort last.**

Status key: `[ ]` open · `[~]` partial

---

## P0 — Trust. Things that could let a wrong answer or a broken build reach a user.

_Item 1 was downgraded on 2026-07-27 after the user corrected it. **The leading
real risks in this tier are now 2 (the unvalidated `.dna` reader) and 3
(`molgraph.ts`)** — both are the plausible-wrong-answer class._

### [~] 1. The in-Word passes happen, but nothing records that they did
**Corrected 2026-07-27 (user): the manual passes ARE being run.** The original
finding here — "never run" — was wrong. It was inferred from the artifact rather
than asked about: `docs/TEST-SCRIPT.md` has 0 of 190 checkboxes ticked and a blank
sign-off block, and that was read as evidence of absence.

So the gap is not verification, it is **the absence of a record**. That still costs
something real, and this project has paid it before:

- From the repo's point of view a pass that leaves no trace is indistinguishable
  from one that never happened, so every future audit re-flags it — this one did.
  The same shape as `manifestVersion.test.ts`, which skipped every path on CI and
  passed having verified nothing.
- There is nowhere to record **which build** was exercised, so a regression found
  in Word cannot be tied to a release, and a section that started failing cannot be
  distinguished from one that was never reached this time.

Cheapest fix that keeps its value: tick the sections actually covered and fill the
sign-off (tester, date, build) at release time — the file is already structured
for it. It does not need to be all 190 every release.

**The one substantive question left open:** whether those passes exercise the
**production** manifest or the dev build. `npm start` sideloads a manifest pointing
at `https://localhost:3000`, which looks perfect while the dev server runs — and on
2026-07-15 the installed manifest on the Windows box was found silently pointing
there. If the passes are done from an installed `install/*.zip` pack, this is
already closed and the runbook's caveat should be struck. Worth confirming once,
then recording the answer rather than re-deriving it.

### [ ] 1b. "Works offline" is a promise nothing in the build guarantees
**Raised 2026-07-27, when the user made offline operation the product's stated core
value** ("in grad school you can't always connect to the internet… an all-in-one
tool that works inside Word so the user does not have to leave").

The application logic is genuinely offline-clean. `checkForUpdate()`
(`taskpane.ts:1143`) is wrapped in try/catch and documented offline-first, so a
failed version fetch never nags; the only other runtime network call is OPSIN,
which is strictly opt-in per session. Nothing computes over the network.

**The delivery is the problem.** `SourceLocation` in both manifests is a remote
`https://…/taskpane.html`, so Word fetches the pane from GitHub Pages on every
open, and **there is no service worker, precache or offline manifest anywhere in
the repo** (a sweep for `serviceWorker`, `workbox`, `cache.addAll` and
`manifest.json` returns nothing). Offline operation therefore depends entirely on
the WebView's ordinary HTTP cache still holding the bundle — which is evictable,
is per-profile, and is invalidated for the main bundle on every release, since
webpack emits a hashed filename that has to be fetched at least once.

`install/README.md` already tells users "First open needs an internet connection…
After that it works offline." That promise currently rests on incidental caching.

**The failure mode is exactly the scenario that motivated the decision:** a student
with no connection opens Word, the cache has been evicted or a new release was only
partly fetched, and the pane fails to load — at the precise moment the product's
main claim is being tested.

**Shape of the fix, with its real tension.** A service worker precaching
`taskpane.html`, the hashed bundle and the assets, served cache-first, is the
standard answer. The tension is that **push-is-deploy depends on fetching from the
network**, so cache-first changes update semantics. The existing update banner is
already the right shape for that: serve from cache instantly, check `version.json`
in the background, offer a reload. **Spike it before committing** — service-worker
support is solid in WebView2 on Windows and has been more variable in the Mac
WebKit host, and the user is on a Mac.

**Then gate it**, in this project's own idiom: load the built pane with the network
disabled and assert it renders. An unenforced promise drifts, and this one is now
the value proposition.

### [ ] 2. The SnapGene `.dna` reader has never seen a real file
`src/lib/seqdna.ts` (header, lines 4–17) still says it plainly: written from a
third-party reverse-engineering write-up, tested only against synthetic files
built to that same write-up. **No real `.dna` file was available to validate
against.** A misparsed plasmid is exactly the plausible-wrong-answer class this
product treats as its worst failure. Needs one real file from a user.

### [ ] 3. `molgraph.ts` — 14 exports, still 0 direct tests
No `molgraph.test.ts` exists. It is exercised only transitively by
`carbonylCatchAll`, `substituentCatchAll` and `phase6.adversarial`. This matters
more than a bare coverage number suggests: molgraph is the **shared exact
structure-detection layer sitting behind all four spectra predictors** (NMR, IR,
UV-Vis, MS fragmentation), so a defect there is silently wrong in four tools at
once.

### [~] 4. Modules with no dedicated suite — but the list needed triage first
**"Has no file named after it" is a proxy for coverage, not coverage.** Working
through the seven, they are not one problem:

- **`fft.ts` — DONE.** Was genuinely dark: exercised only as a helper inside
  `fftfilter.test.ts`, so its own exports went unchecked. Now has `fft.test.ts`,
  13 tests built on identities rather than recorded outputs — Parseval, round-trip
  inversion, linearity, conjugate symmetry. A wrong twiddle factor or
  normalisation fails those and does not produce an obviously wrong-looking
  spectrum.
- **`optimize.ts`, `matrixExpr.ts` — still genuinely open.** Real logic, no
  direct tests.
- **`ir.ts`, `uvvis.ts`, `fragment.ts` — not dark.** All three are exercised hard
  by `phase4.adversarial.test.ts`, which found six real bugs in them, plus the
  carbonyl and substituent catch-alls. A dedicated file would add something, but
  these are not uncovered and should not be ranked with the two above.
- **`modes.ts` — STRUCK. It should not have its own suite.** It is a literal
  array plus two derived exports, with no logic in it. A test would assert that
  a literal contains what it literally contains, which is the exact failure this
  repo already learned from: the README counted "23 tools" over its own 23-row
  table while 25 shipped. **Counting a claim against itself proves nothing.**
  What actually matters about modes is cross-file, and is already enforced —
  mostly by the TYPE SYSTEM, which is stronger than a test:
  `TOOL_ICONS: Record<Exclude<Mode, "home">, string>` makes a missing icon a
  compile error, `MODE_EXAMPLES: Record<ExampleMode, string>` does the same for
  help content, `scripts/tool-count.js` derives the count from `ALL_MODES`, the
  render check asserts every mode renders its own section, the id-wiring audit
  covers the controls, and `phase6.adversarial` compares every published count
  against the mode list. `modes.ts` is among the best-covered files in the repo.

`ode.ts` and `mathParse.ts` from the original list are still open;
`formulaLibrary.ts` and `structures.ts` have since gained suites under different
names.

### [ ] 5. The PubChem fixture pins the world as of 2026-07-15
`src/lib/__tests__/fixtures/pubchem-names.json` has not been refreshed in 12
days. The 359-name coverage gate is real and enforced (`compoundsVsPubChem.test.ts`
requires `missing = []`), so this is recurring maintenance rather than a defect —
but it is the mechanism by which a dictionary error would be caught, and it ages.

### [ ] 6. A comment in `linalg.ts` misstates the product's own capability
`linalg.ts:246` says general non-symmetric eigenvalues "can be complex and are
intentionally out of scope." That was true when `eigenSymmetric` was written and
is **false today** — `eigenvaluesGeneral` (Francis double-shift QR, complex pairs
included) ships 200 lines below at line 455. The comment is correct about
`eigenSymmetric`'s own null return and wrong about the product. It caused a
verification agent to report a shipped feature as missing during this very audit,
which is the cost: a stale comment is misinformation with a long half-life.

---

## P1 — Capability gaps that are genuinely buildable

Each of these is a scoped build, not a research problem. The hard limits — the
ones no amount of engineering closes — are listed separately at the bottom and
deliberately **not** on this list.

### Symbolic math (the CAS "later" list, §3 of `docs/CAS-DESIGN.md`)
- `[ ]` **Symbolic ODEs** and **units-aware solving** — the last two never-started
  items from the CAS brief. Systems, inequalities, limits and series all shipped
  (v2.13–2.15).
- `[ ]` **Exact cubic and quartic roots** (Cardano / Ferrari). `solve.ts` stops at
  the quadratic and hands degree 3–4 to Durand–Kerner, so a user gets `1.259921…`
  where `∛2` is available. Degree ≥5 is genuinely hard (Abel–Ruffini) and stays
  numeric.
- `[ ]` **Cyclic integration by parts** (∫eˣ sin x — needs the solve-for-the-integral
  trick) and **trig-identity integrals** (∫sin²x — needs power reduction; canonical
  form will never prove sin²+cos²=1 on its own). Both currently refused, honestly.
- `[ ]` **Partial fractions with irreducible factors of degree ≥3** — falls back to
  numeric quadrature rather than risk a wrong closed form (`casint.ts:178`).
- `[ ]` **Multivariate polynomial GCD** — `cas.ts:42` does univariate only, so
  multi-variable fractions stay unreduced.
- `[ ]` **Radius of convergence** for Taylor series (`analysis.ts:385`) — the series
  is truncated and never claims to represent the function globally.

### Statistics
- `[ ]` **Cox proportional-hazards regression.** `survival.ts` has Kaplan–Meier,
  log-rank and a Peto HR, but no multi-covariate model — the single biggest
  remaining stats gap for a life-science audience.
- `[ ]` **Exact permutation p-values** for Mann–Whitney and Wilcoxon. `stats2.ts`
  uses the normal approximation only, which is the wrong tool at small n — exactly
  where these tests are usually reached for.
- `[ ]` **Parametric repeated-measures ANOVA.** Paired t, Wilcoxon signed-rank and
  Friedman all ship; the parametric within-subjects case does not.

### Numerics
- `[ ]` **DAE index reduction.** `dae.ts` solves semi-explicit index-1 only and
  refuses higher index outright (a Cartesian pendulum is index 3). The refusal is
  correct and names the reformulation that works — but differentiating the
  constraint and stabilising is a buildable path.

### Spectroscopy
- `[~]` **JCAMP overlay onto a predicted spectrum.** The reader shipped and is
  reachable (v2.19.0), but it draws a **standalone** chart. `jcamp.ts`'s own header
  still names the overlay as the goal, and every Spectra caveat says "verify
  against an acquired spectrum" — which is the comparison this would make possible.
- `[ ]` **Isotope table covers 15 elements.** Untabulated elements (Mg, Fe…) are
  dropped from the pattern *shape*; monoisotopic mass and adducts stay exact.
- `[ ]` **Geminal coupling in diastereotopic CH₂** is not modelled (`nmr2d.ts:277`).
- `[ ]` **Cross-conjugated enones** fall outside the Woodward–Fieser rule set; only
  one enone per structure is scored.

### Topology
- `[ ]` **Real K-theory (KO, 8-periodic)** — only complex K-theory is computed.
- `[ ]` **Oriented cobordism** — only unoriented, via Stiefel–Whitney numbers.
- `[ ]` **Persistent homology beyond 𝔽₂** — over 𝔽₂ only, so it cannot tell a Klein
  bottle from a torus, which is precisely the distinction the rest of the topology
  suite handles correctly.

### Chemistry and molecular biology
- `[ ]` **Alternate codon tables.** `dna.ts` has one `CODON_TABLE` (the standard
  code) and `TranslateOptions` has no selector — no mitochondrial or bacterial code.
- `[ ]` **Reaction balancing and stoichiometry.** `reactions.ts` parses and draws
  schemes; nothing balances an equation or computes limiting reagent or yield.
- `[ ]` **Peptide disulfides, cyclic peptides, modified residues** — `peptide.ts`
  handles none, and its header states stereochemistry is deliberately unspecified.

---

## P2 — Product surface, figures and reach

### [ ] 7. The sketcher cluster — still entirely unstarted
Items 6, 7 and 9 of the additions list are one blocked chain: **zero footprint for
Ketcher or any sketcher anywhere in the repo** (no `vendor/`, no iframe, no hits).
Until the offline spike proves it works in a task pane, wiring it into the
chemistry tools and CDXML import cannot start. The additions list rated this "the
single biggest unlock" and that judgement has not been revisited.

### [~] 8. Structure round-trip from alt text — write-only today
`provenanceAltText()` (`taskpane.ts:3248`) already writes label, formula, MW,
SMILES and idcode at every insertion site. **Nothing ever reads it back.** The
additions list called this "the sleeper," and it is: the hard half is already
shipped and in every document users have made, so an "edit this structure"
affordance is mostly a read path.

### [ ] 9. Every figure is raster
All inserts go through `svgToPngBase64`; there are zero uses of the `asvg` blip
extension. Journals ask for vector.

### [~] 10. Figure controls journals require
Log axes with minor ticks and grouped/stacked layouts shipped. Still missing:
**typed error bars** (a generic `err` field with no SD / SEM / CI distinction —
and which one it is changes the reader's interpretation), significance brackets
and asterisks, serif typography, and explicit axis limits and tick intervals.

### [ ] 11. Multi-panel figure assembly
No composition mechanism; `figLabel` captions a single chart. No A/B/C sub-panels.

### [~] 12. Accessibility has never had a dedicated pass
ARIA attributes grew from 59 to 68 and labels from 56 to 63 — organic drift, not a
pass. Still **zero `alt=` attributes in the pane HTML**, no `role="dialog"`, no
focus trap or `tabindex` management, and no a11y test file. There is a WCAG
contrast gate (`themeContrast.test.ts`) and it is good; it is also the only a11y
gate that exists.

### [~] 13. ST.26 has no local validation
The XML and DOCTYPE are generated correctly, but there is no DTD validation — the
status message tells the user to "Validate in WIPO Sequence before filing."

### [ ] 14. Install packs still carry the old brand in their filenames
`install/formula-inserter-windows.zip` and `-mac.zip`, the download links at
`landing/manual.html:91-92`, `scripts/package.ps1` (lines 33–35, 83–84, which
generate the names), and `DISTRIBUTION.md`. Everything else is clean — page
titles, the manifest and the zip *contents* all say JurisLab, and `README.md:1`
says "formerly Formula Inserter" deliberately. The internal
`formula-inserter:*` content-control prefixes must **not** be renamed: they
identify content in documents users have already saved.

### [ ] 15. Ribbon icons should have versioned filenames
Word caches the add-in icon by URL, so the v1.98.0 redesign did not appear for the
user until the Wef cache was cleared by hand. The pane now draws its logo as
inline SVG, which sidesteps it there — the **ribbon** icon is still exposed.
Versioned filenames fix it permanently but change the manifest, so it needs a pack
reinstall and should ride along with the next manifest change.

### ~~16. Word on the web~~ — DECLINED 2026-07-27
**Decided by the user, with a reason that should be kept:** offline operation is
the product's core value ("in grad school you can't always connect to the
internet"), and multiple users have said the all-in-one, never-leave-Word,
works-anywhere shape is what makes JurisLab good. A web add-in requires
connectivity by definition, so supporting it would contradict the thing people
value most about the product.

`ARCHITECTURE.md:53` already states desktop-only as a design position; it is now a
product decision rather than an untested assumption, and should say so. This also
makes item 17 (Excel) moot for the same reason it was blocked on this one, and
raises item 1b above from cosmetic to load-bearing.

### [ ] 17. Excel as a second host
Both manifests declare `<Host Name="Document"/>` only; zero Excel references in
`src/`. Large, and it should follow a decision on 16.

### [ ] 18. BibTeX / RIS import with numbered bibliographies
Zero footprint. Citations today are Bluebook legal only.

---

## Decisions needed before anything gets built

- **Online AI for free-form word problems.** Deferred by design and **blocked on an
  infrastructure choice, not on effort**: a distributed client-side add-in cannot
  call an LLM without either the user's own API key entered in the pane or a
  backend proxy, and baking a key into the Pages bundle would expose it. The
  precedent is the OPSIN online exception (per-session consent). Pick a provider
  and a key story first.
- **Build order generally.** The standing authorization on file covers only the old
  life-science roadmap items #4–6, all of which shipped. Nothing on this list is
  pre-authorised.

---

## Hard limits — state them, do not schedule them

These are on no roadmap and should stay off. They are mathematically or
physically closed, and the product's honesty about them is load-bearing.

- The **word problem for group presentations** is undecidable (Novikov–Boone), so
  π₁ is presented and abelianised, never simplified or identified.
- **Homeomorphism in dimension ≥ 4** is undecidable (Markov). Invariants may prove
  two spaces differ, never that they are the same.
- **Stable homotopy groups of spheres** past the cited table (n = 0–19) are decades
  of unfinished research. Never extrapolate from 0, ℤ/2, ℤ/2, ℤ/24.
- The **Jones polynomial is not a complete invariant**, and whether it detects the
  unknot is an open problem. A match is evidence, never proof.
- **Spectral-sequence differentials** are not determined by the E₂ page: S¹ → E → S²
  gives the Hopf fibration and the trivial bundle the same E₂ and they differ only
  in d₂. This is why every differential is marked undetermined.
- **Quintic and higher roots** have no general radical formula (Abel–Ruffini).
- **BVP existence and uniqueness** cannot be settled from the numerics — one
  candidate is reported and the ambiguity is stated.
- **J-coupling from geometry** needs a 3D conformational search; values are typical
  literature figures and the topology is exact.
- The **IR fingerprint region** below ~1500 cm⁻¹ needs QM/DFT and is not predicted.
- **Fragment ion intensities** depend on ionisation energy and instrument; the
  ranking is rule-based and says so.
- **OPSIN name lookup** is the one feature that leaves the machine — there is no
  offline browser build. Strictly opt-in, per session.

## Explicitly declined

- **Structure → IUPAC name.** `structures.ts:40` already documents this as
  deliberately not a name generator. The additions list predicted it would conclude
  "no"; it has. Move it out of P6 rather than leaving it to look like backlog.
- **Microsoft AppSource / Marketplace.** `README.md:91` and
  `packaging/CENTRALIZED-DEPLOY.md:416` now state AppSource is intentionally not
  used. This is a reversal of additions item 16, not unfinished work, and the item
  should move to "explicitly not building."
- **Localisation.** English only, as the additions list anticipated.
