# JurisLab — complete gap analysis, 2026-08-01 (v2.63.0)

> **STATUS**
> - **TIER 0 — all eight shipped in v2.64.0** (`edc3424`, live-verified).
> - **TIER 1.1 / 1.2 / 1.3 shipped in v2.65.0** (`cc85b36`, live-verified):
>   Word table -> every data field, CSV/TSV import, search over tools and
>   calculators.
> - **TIER 1.5 (fatigue Kf), 1.6 (substrate inhibition) and the finance half of
>   1.7c shipped in v2.66.0** (`f48d172`, live-verified).
> - **TIER 2.1 (claim-set hygiene) DECLINED by the user — do not build it.**
>
> **Still open in Tier 1:**
> - 1.4 ST.26 sequence import (`parseSequenceFile` reaches Seq Map only)
> - 1.5 remainder: `chips-power -> chips-thermal`, `pipe -> pump-npsh` handoffs
> - 1.6 remainder: `BELL_STATES` preset, `rayleighDamping` (dead AND duplicated
>   inline at vibration.ts:869), `totalLoad`, `formatSeqIdRefs`
> - 1.7 NMR DEPT / HMBC / TOCSY + non-aromatic "contributed nothing" caveats
> - 1.7b FFT windowing (leakage in every spectrum drawn) and
>   `filter.ts -> fftFilter` to retire the documented brick-wall ringing
> - 1.7c remainder: 6 `geometry3d` transform exports, `probit`
> - 1.8 general curve fitting (promote `levenbergMarquardt`), `trapz` on data,
>   PCA on the existing SVD, an indefinite-integral entry point
>
> Plus all of Tier 2 apart from 2.1.

Six parallel code sweeps (legal, life-science, stats, math/numerics, engineering,
infrastructure) plus independent verification of every load-bearing claim.
Registry counts re-derived from source, never from prose.

**Verified baseline:** 26 tools · 162 calculators (ENG 87 / STAT 21 / ANALYZE 20 /
FIN 19 / ASSAY 15) · 16 engineering disciplines · 239 test files · 137 lib modules ·
suite 7,764 · QC 12/12.

Three claims from the sweeps were **wrong and are corrected here**: the
KNOWN-DEFECTS "A — wrong numbers" tier is **empty**, not open; the bundle is
**1.19 MB gzipped** over the wire, not a 4 MB download; and geometry/topology/knots
are **reachable** (via natural-language routers), not dead code.

---

## TIER 0 — live defects: wrong, misleading, or lossy today

Ordered by consequence. These are not absences.

### 0.1 NMR silently drops ¹⁹F and ³¹P coupling, with no caveat
`nmr.ts:580` and `nmr2d.ts:164` both guard `if (mol.getAtomicNo(nb.atom) !== 6) continue;`
commented *"ignore exchangeable OH/NH coupling"*. That reasoning is right for O and N
and **wrong for F and P**, which are not exchangeable and couple strongly
(²J(H–F) ≈ 47 Hz). A fluorinated CH₂ returns a clean, confident multiplet.
Grep for any F/P caveat in the NMR path returns **zero**.

This is the only place in the chemistry half where a wrong output is **unlabelled**,
and it contradicts both the module header and the product's founding rule. The
caveat alone is a complete, shippable fix; real J values are a separate (b)-class
data question.

### 0.2 Insights reports uncorrected p-values as "significant"
`insights.ts:262` correlates every pair of numeric columns; line 317 writes
"*X* and *Y* are **significantly** correlated" from that pair's raw p. Ten pasted
columns = 45 simultaneous tests at nominal α. No correction, no causation caveat
(grep: zero). `adjustPValues` (Bonferroni/Holm/BH) already exists at `stats2.ts:380`
and is not imported here.

Same family-wise failure `tukey.ts` was built to prevent — in the surface aimed at
the least statistically expert users the product has.

### 0.3 The pane undersells its largest tool by 58%
Home card: *"36 calculators: beams, stress, fluids, thermal, circuits, control,
vibration, PK"* — actual **87 across 16 disciplines**. `FEATURES.md` is correct;
the product is the stale one. Also `taskpane.html:751` "instead of a 36-item
dropdown", `qc.ps1:80`, `prefs.ts:12` ("all 22 tools").

### 0.4 Finance is invisible to science users
`taskpane.ts:1510` — `{ mode: "finance", audience: ["legal"] }`. Anyone on the
"science" filter chip never sees TVM, DCF, bonds, options or Greeks. Almost
certainly a mis-tag.

### 0.5 No global error handler anywhere
Zero `window.onerror`, zero `unhandledrejection`, no error boundary. In an Office
taskpane an unhandled rejection renders **nothing** — the user sees a pane that
stopped, with no message and no way to report it. No telemetry either. ~15 lines
into the existing status region is the highest value-per-line change in the repo.

### 0.6 The Table of Authorities path can half-apply
`taskpane.ts:16706` issues **7** `context.sync()` calls in a delete-then-reinsert
shape, syncing once per authority inside the loop. A mid-way Word failure leaves the
old TA marks deleted and only some new ones written; undo is per-batch, so recovery
is N undos and nothing says so.

### 0.7 Align silently concatenates a multi-record FASTA
`countFastaRecords` (`align.ts:142`) exists, is tested, and its docstring says
*">1 means the caller should warn"* — no caller exists. DNA mode warns
(`taskpane.ts:4291`) and Seq Map warns (`:15838`); **Align does not**, and aligns
the concatenation.

### 0.8 science.html overclaims the sequence map
`landing/science.html:79` sells *"Restriction sites from 122 enzymes, with the
Dam/Dcm methylation warnings"* on the **map**. Both exist — in **DNA mode**.
`seqmap.ts`/`seqmapcirc.ts` have no enzyme awareness. A reader buys the
SnapGene-defining feature and gets a feature map.

### 0.9 Stale self-referential claims
- `toa.ts:5` still refuses page numbers the product now ships (F9 round-trip).
- ROADMAP header "Where we are (v1.96.0)" against a v2.63.0 build.
- Landing "New" badges: five tiles against a lede promising "the last few
  releases" — Chips is eight releases back. Same trap as v2.52.0.
- USPTO paragraph numbering is shipped, has full UI + engine + tests, and is
  **undocumented** in README/FEATURES/CHANGELOG — a marketing defect, not a code one.

---

## TIER 1 — high leverage, small effort

### 1.1 Your document is not a data source (the in-Word wedge, unbuilt)
`loadSelectedTable()` reads the Word table under the cursor into `currentTableRows`
(`taskpane.ts:763`) — and **nothing in Stats or Analyze ever reads it**. Verified:
every reference is inside the Table→Chart flow.

So a user whose data is already in the document they are writing must select, copy,
and paste it into a pane textarea. The Analyze *insights* hint literally says
"Paste a data table". The reader, cleaner and parser all exist and are tested.

**This is the single highest-value item in the analysis.** It converts "paste your
data" into "your document *is* the data source" — the one thing MATLAB structurally
cannot do.

### 1.2 No CSV/TSV import
Two file inputs exist in the entire product (JCAMP, sequence files). `analyzeData`
already sniffs tab/comma/space delimiters, so this is ~40 lines cloning the JCAMP
handler.

### 1.3 The search box indexes no tools and no calculators
`buildSearchIndex()` covers only the formula library and compound names. All 162
calculators are reachable only by picking the right mode then scrolling the right
dropdown — and a code comment claims the opposite ("every tool stays reachable from
the dropdown and the search box"). Largest discoverability gap in the product.

### 1.4 ST.26 has no import path, though the parser ships
`parseSequenceFile` handles FASTA and GenBank and is called **only** from Seq Map.
The Sequence panel is a hand-typed "+ Add sequence" list. A biotech attorney with
40 sequences pastes them one at a time.

### 1.5 Engineering composition — three intra-module pairs, one a correctness hazard
The product already tells users to fetch numbers it computes elsewhere.
- **`fatigue-endurance` → `fatigue-safety`** — the field says σa "*already
  multiplied by Kf*", i.e. the product admits the user must hand-apply a factor
  `notchFactor` computes. Forgetting it is **non-conservative**. Highest silent-error
  risk in the bench.
- **`chips-power` → `chips-thermal`** (adjacent functions, same file); the reverse
  leg closes an electrothermal loop the header already describes.
- **`pipe` → `pump-npsh`** (same module; `waterProperties` could fill ρ and p_vap too).

Model case to copy: `aero-isa → aero-airspeed` is already composed internally, as is
`flueGas → combustion`.

### 1.6 Dead exports that are real lost capability
- **`substrateInhibitionV`** (`assay.ts:650`) — its own comment: fitting such data
  with plain Michaelis–Menten *"does not fail loudly… returns a converged fit with a
  depressed Vmax"*. Real and common (AChE, kinases at high ATP). No
  `fitSubstrateInhibition`, no `"substrate"` in `InhibitionMode`.
- **`BELL_STATES`** (`quantum.ts:301`) — four canonical states, tested; the pane makes
  users type four complex amplitudes. Cheapest UX win in the bench.
- **`rayleighDamping`** (`vibration.ts:703`) — dead, and the formula is *duplicated*
  inline at `:869`. Call it or delete it.
- **`formatSeqIdRefs`** (`seqid.ts:55`) — would insert "SEQ ID NOs: 1–3" collapsed ranges.
- **`totalLoad`** (`beam.ts:1065`) — an equilibrium check the beam report doesn't print.

### 1.7 NMR depth that needs no new data
- **DEPT** — `mol.getAllHydrogens(a)` at `nmr.ts:467` *is* the CH/CH₂/CH₃ classification. Free.
- **HMBC** — same graph walk as `predictHsqc`, 2–3 bonds.
- **TOCSY** — transitive closure over the coupling graph already built at `nmr2d.ts:229`.
- Non-aromatic "substituent contributed nothing" caveats, mirroring the exemplary
  `aromaticCaveats`.

### 1.7b Every FFT spectrum the product draws has spectral leakage
`fft.ts` zero-pads to the next power of two and applies **no window function at
all** (Hann/Hamming/Blackman: zero hits). Leakage appears in every spectrum shown.
~15 lines. Separately, `fftfilter.ts:163` documents brick-wall ringing that "looks
exactly like real structure in the data" — and `filter.ts` already returns poles
and denominator coefficients (`:74`), so applying a designed response inside
`fftFilter` retires that artifact using two modules that already ship.

### 1.7c Dead exports, second batch — one is a user-visible capability gap
- **8 finance functions** unreachable: `continuousCompound`, `annuityPV`,
  `annuityFV`, `cagr`, `nominalAnnualRate`, `growingPerpetuity`, `perpetuity`, and
  **`straightLineDepreciation`** — the pane ships declining-balance depreciation
  (`depr`) but **not straight-line, the more common method**, while the function
  exists and is tested.
- **6 `geometry3d` transform exports** (`mat3Apply`, `mat3Mul`, `scaleMatrix`,
  `reflectionMatrix`, `rotationMatrix`, `transformEffect`) — a complete, tested
  3-D linear-transform toolkit that is uninvokable. The module walk passes because
  `geometryParse.ts` imports the module.
- `regression.ts` `probit` — dead.

### 1.7d Stale comment contradicting shipped behaviour
`linalg.ts:284` still says non-symmetric eigenvalues "can be complex and are
intentionally out of scope" — `eigenvaluesGeneral` ships at `:492` and
`eigen-general` is a live registry id. One-line fix, same class as `toa.ts:5`.

### 1.8 Engines fenced inside one domain
- **`levenbergMarquardt`** (`assay.ts:197`) — a full NLLS engine reachable only through
  fixed biology models. No general "fit my model to my data" in Analyze. That is
  `fitnlm`/`lsqcurvefit`, the most-used numerical verb after plot.
- **Trapezoidal integration of data** (`pk.ts:567`) — locked to PK; no `trapz` for a
  pasted x,y pair.
- **`findRoot`** (`finance.ts:150`) — locked to IRR/YTM.
- **Indefinite integrals** — `symbolicIntegrate` is verified by differentiating back,
  but is only reachable as a by-product of a *definite* integral.
- **PCA** — `svd` already exists (`linalg.ts:393`); PCA is a scores/loadings wrapper.

---

## TIER 2 — strategic builds

### 2.1 Legal: claim-set hygiene — **DECLINED by the user, 2026-08-01. Do not build.**
Recorded so it is not re-proposed. The analysis below is kept only as a record of
what was found; it is not a backlog item.

The audit checks everything in a patent application **except the claims**. Nothing
segments a document into spec / claims / abstract. Absent: **antecedent basis**
(the highest-value 112(b) check), claim dependency validation (112(d), improper
multiple dependency, circular), claim renumbering on amendment, claim-term↔spec
support, and **37 CFR 1.121 amendment markup** — status identifiers, underline/
strikethrough, "Listing of Claims" — even though `paragraphs.ts` justifies its own
existence by amendment practice.

This is **drafting-side** work, squarely inside "Draft the application — in Word",
and it reuses the document-scanning machinery already shipped in `audit.ts`,
`numerals.ts` and `paragraphs.ts`. It must respect the existing **flag-don't-fix**
doctrine.

Also: numerals check *one numeral → two elements* but not the inverse
(*one element → two numerals*), which is the more common real defect; and neither
claims nor per-figure scoping are covered.

### 2.2 Citations are US-litigation-shaped
No **PTAB** (IPR/PGR/CBM/*Ex parte*) — the most-cited authority class for a
prosecution practice; no ITC; no foreign/PCT (`formatPatentNumber` assumes US
grouping); no subsequent history (*cert. denied*, *aff'd*, *rev'd*); no state codes.
Asymmetry worth noting: the TOA *detects* Fed. R. Civ. P. and gives it a category,
but Citations cannot *insert* one.

### 2.3 Engineering: two absent disciplines match the stated client base
- **Materials & mechanical metallurgy** — nothing at all. Their **ceramics and metals**
  clients have no bench. Note `weibullWind` already implements the distribution
  ceramics strength needs; it is only wired to wind.
- **Manufacturing & metrology** — machining, **tolerance stack-up / GD&T**, Cp/Cpk,
  additive, welding. Nothing.
- Plus: `fft.ts`/`fftfilter.ts` exist but have **no ENG_CALCS entry** — DSP as a
  bench group would serve optics, AI and avionics at once.

### 2.4 Engineering: the sharpest per-discipline holes
- **Electronics — no transient/time-domain circuit analysis** (verified zero hits).
  C and L exist only as impedances. An RLC step response is the most-used circuit
  calculation in a patent spec.
- **Control — no state-space input, no discrete/z-domain, no Nyquist, no root locus.**
  A realisation already exists internally at `control.ts:714`. For AI/robotics/avionics
  clients this is the highest-value single addition.
- **Thermal** — no fins, no lumped-capacitance transient, no radiation, no ε-NTU
  (LMTD only, so unknown outlet temperatures can't be solved).
- **Structural** — no bolted/welded connections, no plate/shell, no frame analysis.
- **Fatigue** — no fracture mechanics (K_I, critical crack size, Paris law), which is
  what aerospace clients actually claim.
- **Aviation "& avionics"** — nothing avionic: no navigation, link budget, radar range,
  GNSS DOP. The group name promises more than it delivers.
- **Computation** — nothing AI-shaped: no FLOPs/parameter/memory estimate, no roofline,
  no quantisation error.

### 2.5 Stats
No **power analysis or sample-size** calculation (and the non-central distributions
to build it don't exist). **No effect size beyond Cohen's d** — a significant ANOVA
reports F and p with no magnitude; missing η²/ω², Cramér's V, rank-biserial, and any
CI on *d* itself. **Games-Howell** still absent (the caveat naming it was removed
rather than the method built). No logistic regression, Fisher's exact, McNemar.

### 2.6 Math/numerics vs the MATLAB wedge
Confirmed shipped and strong: BVP, PDE (heat/wave/Laplace, Crank–Nicolson), DAE
index-1, SVD/QR/eigen, stiff ODE with auto-switching, exact-rational CAS with
systems and inequalities, persistent homology.

Absent: interpolation/splines (zero), constrained optimization and linear
programming (Nelder–Mead only), sparse matrices, time series (autocorrelation,
ARIMA, decomposition — zero), PCA/clustering, Monte Carlo/bootstrap/permutation,
limits and Taylor series, box/violin plots, contour and 3D surface (the PDE
solvers produce fields with **no visualization**), trendline overlay, dual axis.

Two chart systems with different kind vocabularies (`tablechart.ts` 12 kinds vs
`plot.ts` line/scatter) — error bars and log axes exist only in the latter.

### 2.7 Infrastructure
- **AppSource is unreachable**: no privacy policy, no terms, no EULA (zero
  occurrences), no manifest localization. Hard blocker if store distribution is a goal.
- **Deploy gate runs 5 of 12 QC gates**; three omissions need no browser — including
  `check-tool-pages.js`, the gate written *because* a tool page shipped broken for ten
  releases. It doesn't guard the publish path.
- **No size, latency or memory budget in any gate.** 3.90 MB parsed (1.19 MB
  transferred). 31 `input` handlers, 2 `setTimeout` — essentially no debouncing, and
  KNOWN-DEFECTS records two separate "per keystroke" defects that reached users.
- **a11y verification stops at colour tokens** — `themeContrast` checks 14 of 35 tokens
  as text; no keyboard, focus, or screen-reader test. Authoring is better than the
  verification (54 aria-live regions, 17 focus rules).
- **Testing gap is `taskpane.ts`**, not lib: 759 KB behind **one** test file. Every lib
  module is exercised.
- No roaming settings (localStorage only — deliberate, documented), hard-coded en-US
  in two number formatters, no first-run onboarding.

---

## Deliberate refusals — do not propose work against these

Quoted from the code; all verified.

- **No property tables anywhere** (steam, materials, insolation, fuel, battery,
  refractive index, element measured properties). Seven-site doctrine.
- **Indeterminate truss** — proved unsolvable exactly; float path deliberately left open.
- **Mixed-inhibition Ki from one IC50** — "one IC50 at one [S] cannot separate them".
- **Alkene J configuration**, **peptide stereochemistry**, **IUPAC name generation**,
  **ST.26 validation** (validate in the WIPO tool), **`Id.` with no antecedent**
  (dropped, not guessed), **T10 abbreviation for the 50 states only**, **bare numerals**
  (collide with dates/quantities), **not numbering headings/claims/abstract**.
- **QC's own blind spot is stated up front**; headless gates excluded from CI with
  reasoning; SKIPPED is a third state.
- **No FEA/CFD refusal exists in the repo** — those are simply absent, and may be
  treated as gaps rather than refusals.

---

## Recommended order

**Now (defects, hours each):** 0.1 NMR F/P caveat · 0.2 Insights multiplicity ·
0.3 pane count · 0.4 Finance tag · 0.5 error handler · 0.7 Align FASTA warning ·
0.8 science.html copy · 0.9 stale claims.

**Next (the wedge):** 1.1 Word table → calculators · 1.2 CSV import · 1.3 search
index. These three together change what the product *is* for data work.

**Then (cheap capability):** 1.5 fatigue Kf handoff (correctness) + the other two
composition pairs · 1.6 dead exports · 1.7 DEPT/HMBC/TOCSY · 1.8 general curve
fitting, then PCA.

**Strategic, pick by audience:** claim-set hygiene (2.1) if the patent half is the
priority; materials/manufacturing (2.3) or controls state-space/discrete (2.4) if
the engineering client base is; power analysis + effect sizes (2.5) for the
academic audience.

**Only if store distribution is a goal:** the AppSource legal set (2.7).
