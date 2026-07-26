# JurisLab — Product Roadmap

_Last updated: 2026-07-26 · Current release: **v1.90.0** (production)_

> The release number above is gated by `phase6.adversarial.test.ts` against
> `package.json`. If they disagree, the suite fails — this file drifted five
> versions once and nothing caught it.

This is the forward-looking plan. For what already ships, see [FEATURES.md](FEATURES.md);
for the historical build log, see [CHANGELOG.md](CHANGELOG.md).

---

## Vision

JurisLab turns what a technical author types into correctly formatted, computed, and
publication-ready content — inserted directly into Word, entirely on the user's machine.

Two north stars guide the roadmap:

1. **The unicorn for STEM writers + patent attorneys** — one add-in that spans chemistry,
   life science, math, and legal drafting.
2. **A no-code, in-Word analytical workbench that competes with MATLAB** — _for data
   analysis and reporting_, the everyday work most people actually open MATLAB to do.

### How we compete with MATLAB (the winnable framing)

We do **not** reimplement MATLAB the programming environment (its language, REPL, IDE,
Simulink, or general toolboxes). We compete on the wedge MATLAB is worst at:

| MATLAB | JurisLab |
|---|---|
| Expensive license | Free / bundled |
| Requires scripting | No code — paste data, get results |
| Output lives outside your document | Results & figures land in Word, formatted |

**Honest limit (state it plainly in marketing):** JurisLab competes with MATLAB for
data analysis, fitting, statistics, and reporting — not for general scientific
programming. Building a Kalman filter or a Simulink model still needs MATLAB. Analyzing
an assay, a survey, or an instrument dump and writing it up does not.

### Non-negotiable constraints (every item below inherits these)

- **Fully offline / client-side.** No document content leaves the machine. The single
  existing exception is the strictly opt-in OPSIN name lookup.
- **All data must be real.** Every number is computed from the user's input or a
  verified source — never invented.
- **Honest about accuracy.** Predicted/estimated outputs (spectra, cLogP, pKa) say so.

---

## Where we are (v1.90.0)

The analytical **quantitation** engine is genuinely strong and honest about its limits:

- **Mass Spec** — exact monoisotopic/average mass, isotope patterns, adduct m/z.
- **Bio/Assay** — Levenberg–Marquardt curve fitting with covariance-based standard
  errors; Michaelis–Menten, Hill, dose–response (IC50/EC50/4PL), binding (Kd).
- **Stats** — t-tests (Welch/Student/paired), one-way ANOVA, regression with p-values,
  uncertainty propagation (real incomplete-beta distribution math).
- **Physicochemical** — cLogP, logS, tPSA, HBD/HBA, Lipinski/Veber.
- **DNA/protein, Units, Plot** — ORF/Tm/translation; sig-figs & conversions; offline charts.
- Plus the full legal/patent drafting suite (Citations, TOA/TOC, Sequence, Numerals…).

**That gap is now closed.** The three things this section used to list as missing —
analytical spectroscopy prediction, thin general-purpose stats, and no core numerical
primitives — all shipped: Spectra (v1.54.0), the expanded stats suite, and the
linear-algebra/ODE/FFT core (v1.51.0–v1.52.0). Since then: the molecular-biology
suite (Sequence Map, plasmid maps, SnapGene import, restriction digestion, Align,
primer Tm), **Solve** (v1.84.0), NMR J-coupling and 2D COSY/HSQC (v1.83.0), and a
reliability pass (v1.87.0) that made polynomial roots complete, integration exactly
symbolic where possible, and pKa compound-specific via Hammett.

---

## Roadmap

Priority order reflects **leverage per unit effort** toward the MATLAB north star.
Nothing here is scheduled yet; sequence is a recommendation to confirm on build.

### Phase 1 — Foundations & the everyday win  _(highest leverage)_ ✅ COMPLETE (v1.49.0–v1.50.0)

Delivered as the new **Analyze** mode (`src/lib/linalg.ts`, `src/lib/insights.ts`,
`src/lib/matrixExpr.ts`):

- **Linear-algebra core** ✅ — `solve` A·x=b, `inverse`, `determinant`, `rank`, `trace`,
  `transpose`, `multiply`, symmetric-matrix eigenvalues/eigenvectors (Jacobi), **general
  (non-symmetric) eigenvalues incl. complex pairs (Francis double-shift QR)**, **QR**
  (Householder), **SVD** (one-sided Jacobi), and a **matrix-expression evaluator**
  (`A*inv(B)+2*C'`). Partial pivoting throughout; singular/complex cases handled honestly.
- **Raw data → insights engine** ✅ — paste a table; per-column summaries,
  outlier (Tukey 1.5×IQR) / missing-data flags, correlation matrix (Pearson r + p-value,
  Spearman rho), trend/slope detection over row order, and plain-language insights
  inserted into Word. Built on `stats.ts`.

### Phase 2 — Numerical breadth  _(makes the MATLAB claim land)_ ✅ COMPLETE (v1.51.0)

Added as Analyze tools (`src/lib/ode.ts`, `src/lib/optimize.ts`, `src/lib/fft.ts`):

- **ODE solvers (RK45)** ✅ — adaptive Dormand–Prince for `y' = f(t, y)` and systems;
  sampled table + trajectory plot.
- **General optimization** ✅ — Nelder–Mead simplex minimization of a typed objective.
- **FFT / signal processing** ✅ — radix-2 Cooley–Tukey, amplitude spectrum + dominant
  frequencies + chart. Filtering ✅ added (low/high/band-pass in the frequency domain,
  with a caveat about the artefacts a naive brick-wall filter introduces).

### Phase 3 — Fill the thin spots ✅ COMPLETE (v1.52.0)

- **Stats breadth** ✅ (`src/lib/stats2.ts`) — Mann–Whitney U, Wilcoxon signed-rank,
  chi-square (goodness-of-fit + independence), two-way ANOVA, multiple-comparison
  correction (Bonferroni, Holm, Benjamini–Hochberg/FDR). Tukey HSD ✅ added (studentized-range
  distribution; ANOVA without a post-hoc test inflates the family-wise error rate).
- **pKa estimation from structure** ✅ (`src/lib/pka.ts`) — deterministic functional-group
  detection (OCL atom graph; ester/amide/nitrile correctly excluded) reporting typical
  literature pKa per ionizable group + net charge at pH 7.4, labeled as a group estimate.

### Phase 4 — Spectroscopy prediction ✅ COMPLETE (v1.54.0, Spectra mode)  _(most differentiating, most work)_

- **1H / 13C NMR** ✅ predicted spectra (additivity — Grant–Paul + aromatic increments, offline, honest caveat).
- **IR** ✅ predicted spectra (group frequencies + Lorentzian transmittance trace).
- **UV-Vis** ✅ predicted spectra (Woodward–Fieser).
- **MS fragmentation** ✅ (EI: α-cleavage, benzylic/tropylium, McLafferty, gated neutral losses).
- **J-coupling and 2D** ✅ SHIPPED in v1.83.0 — coupling constants and multiplet names
  (dd, td…) from the bond graph, plus COSY (¹H–¹H) and HSQC (¹H–¹³C) maps.
- **Also shipped, unplanned here:** a **JCAMP-DX reader** to open a real measured spectrum.

### Ongoing / low priority — Chemical coverage

- Curated named-compound additions on request (e.g. **heilonine** — a real *Fritillaria*
  alkaloid absent from OPSIN/PubChem/CACTUS by name; would need a verified literature
  structure). Coverage gap, not a bug.
- Optional trivial-name resolver (PubChem fallback) — a *second* network exception;
  weigh against the privacy stance, and note it wouldn't have solved heilonine anyway.

---

## Status & what's next

**Phases 1–4 are all COMPLETE** (linear-algebra/FFT/ODE core, optimization, insights
engine, expanded stats, pKa, and the full Spectra suite). Since then the build has added
a **molecular-biology suite** — Sequence Map, circular plasmid maps, SnapGene `.dna`
import, restriction-enzyme digestion (Type IIS, both-strand), pairwise Align, and
nearest-neighbour primer Tm — and a sustained **correctness-hardening sweep** (punch-list
audits fixing real numerical/biological bugs the unit tests missed).

**Genuinely open candidates:** deeper BVP/PDE/DAE
support on the ODE side (out of scope today — state honestly). Confirm priority before building.
