# JurisLab — gap analysis, 2026-08-05 (v2.89.0)

> ## STATUS — the whole of Tier 0 and Tier 1 was fixed on 2026-08-05
>
> **All 31 Tier-0 defects below are closed**, together with Tier 1. Suite at the
> end: **281 files · 9,332 tests · 0 failures**, `tsc --noEmit` clean, and **all 13
> QC gates pass** including the browser ones. Each fix carries a named regression
> test holding its reproduction; nothing was patched without one.
>
> **Verified by execution, not by reading**, for the ones that mattered most:
> a real GenBank record now reaches the filed ST.26 XML as `Homo sapiens` (0.3);
> ¹H NMR ticks read `4, 3.5, 3 …` instead of `-4, -3.5, -3` (0.4); a pole-crossing
> integral produces no math block at all rather than `= NaN` (0.5); sodium
> chloride returns no IR band plus an explicit refusal caveat (0.11); retinol
> recovered its 334 nm while riboflavin and caffeine stopped claiming to be
> benzene (0.13).
>
> **Four independent adversarial passes ran over the diff** — none by the agents
> that wrote it — and they found **19 further defects, including 8 introduced by
> the fixes themselves**. All were repaired. The last round alone caught: a
> Unicode fold that routed *around* a deliberate ambiguity refusal (`1/2π`
> answered where `1/2pi` refuses); an exact root displayed rounded while still
> flagged `exact: true`; a bond priced at a confident 1139.82 for a **negative**
> maturity, because the only quantity checked was the product `years × freq` and
> two negatives cancelled; and a summary sentence that could hijack the Brief
> Description section and report a correctly-described figure as missing.
>
> Two are worth recording because they are the shape this project keeps meeting:
> - `primerTm`'s first fix was *worse than the defect*: skipping a degenerate
>   nearest-neighbour step under-read Tm by 9 °C where the old deletion bug
>   under-read by 1.8 °C. Replaced by enumerating the degenerate pool exactly and
>   reporting a real member's Tm as a range.
> - the first residual-normality fix was rejected **after measuring it**: the
>   obvious per-group standardisation fires on 100 % of normal data at three
>   groups of three. The shipped version transforms residuals through the exact
>   Beta distribution of a studentized residual; false positives fall from
>   61–100 % to ~8 %.
>
> **Found while fixing, not in the list below** (all closed): the Inhibition (Ki)
> and annuity calculators had been permanently un-insertable because a stray em
> dash collides with the pane's "not computable" sentinel; `bondPrice` never
> returned for a non-finite maturity; `buildDiagramSvg` emitted a **23 MB** SVG
> for a large pasted table; `bondYTM` broke on fractional maturities as a
> *consequence* of another fix and was restored.
>
> **Still open, deliberately** — see "Remaining" at the end of this header:
> 0.29 (the TOA multi-flush, citations-adjacent), the 22 figure-layout defects the
> new gate now records and enforces, and every Tier 2 item, which are features
> rather than defects.

**Scope: everything except the Engineering bench and legal Citations.** That is the
math/CAS core, chemistry, spectroscopy, molecular biology, statistics and Analyze,
plots/figures/units/display, Finance, the formula library, and the Word document
workflow. `citations.ts` and `toa.ts` were not swept as features; the one TOA
finding appears because it is a *document-write safety* defect, not a
citation-formatting one.

Seven parallel source sweeps, then an independent verification pass over every
load-bearing claim. Findings were produced by **running the shipped code** — quoted
outputs are measured, not reasoned. Counts are re-derived from source, never from
prose.

**Coverage honesty.** Every Tier-0 defect below was re-verified against the source by
hand, and the ones that could be executed were executed. Two sweep claims were
**wrong** and are corrected rather than published: one reported the global error
handler as missing (it exists, `taskpane.ts:952-953`, and is tested), and one
mis-described the mechanism of the `NaN` insert. Four in-scope modes — **`ppt`,
`build`, `code` and `botanical`** — produced no findings, and I cannot claim they were
examined as closely as the rest: they were covered only incidentally by the
figures/display and infrastructure sweeps, not targeted. Treat them as *unexamined*,
not as *clean*. `refs` and `numerals` were examined only through the audit path
(1.11).

---

## Verified baseline

| | |
|---|---|
| Version / HEAD | v2.89.0 · `2807e02` |
| Tools | **26** (`ALL_MODES`, less `home`) |
| Calculators | **214** — ENG 130 · FIN 24 · ANALYZE 23 · STAT 21 · ASSAY 16 |
| Engineering disciplines | 20 |
| Lib modules | **151** |
| Test files | **266** · ~8,957 tests · suite **green** |
| Dead exports (ratchet) | **10**, at BASELINE — honest, re-derived independently |

### The number that frames this document

Against the v2.63.0 baseline in the previous analysis:

| Registry | v2.63.0 | v2.89.0 | change |
|---|---|---|---|
| Engineering | 87 | 130 | **+43** |
| Finance | 19 | 24 | +5 |
| Analyze | 20 | 23 | +3 |
| Assay | 15 | 16 | +1 |
| **Statistics** | 21 | **21** | **+0** |

Twenty-six releases went almost entirely into Engineering — the figure campaign that
ended at 130/130. That was the right call and it is finished. The consequence is
that **the surface this document covers has had very little attention for a month**,
and what follows is what accumulated in it.

**The single most important structural finding is 1.1: the Engineering figure
campaign's gates are Engineering-only.** Nothing outside Engineering is counted by
the 130/130 ratchet, and `figure-layout-run.ts` imports four modules — none of them
`tablechart`, `heatmap`, `candlestick` or `spectraChart`. Defects 0.1 and 0.4 below
are what grew in that unwatched half.

---

## TIER 0 — live defects: wrong, misleading or lossy today

Ordered by consequence, by the house rule: a **frozen Word** outranks everything;
then **wrong content reaching the document**; then a wrong number on screen; then a
lost caveat. Every item was reproduced.

### Frozen Word — the product's stated worst failure mode

#### 0.1 Two unbounded tick loops build a 510 MB SVG synchronously in the pane

`tablechart.ts:524` and `candlestick.ts:271` step an axis loop by `step` with an
**absolute** `1e-9` slack and **no count cap**. This is the exact bug `plot.ts:506-522`
documents at length — *"500,007 tick labels and a 128 MB SVG… In a task pane that is
not a bad-looking chart, it is a frozen Word"* — and which `plot.ts` fixed with
`TICK_CAP = 200` and a **relative** `TICK_EPS`. The other two axis renderers were
never fixed.

Measured, `buildChartPreviewSvg(chart, "column")` on a 3-row table:

| data magnitude | `<text>` elements | SVG bytes |
|---|---|---|
| 1e-10 | 30 | 6.9 KB |
| 1e-12 | 2,010 | 483 KB |
| 1e-13 | 20,010 | 4.9 MB |
| **1e-15** | **2,000,011** | **510 MB** |

Candlestick at 1e-15: 2,000,014 texts / 458 MB.

**Consequence:** paste a table of femtosecond pulse widths, femtofarad capacitances
or femtojoule energies into Word and click *Read selected table* →
`updatePptPreview()` (`taskpane.ts:3313`) builds a half-gigabyte string and assigns
it to `innerHTML` on the UI thread. The product deliberately ships `fs`, `fF` and
`fJ` units (`units.ts:133,244,214`) for exactly these magnitudes.
**Fix: ~4 lines each** — port `TICK_CAP`/`TICK_EPS` from `plot.ts`.

#### 0.2 Align has no size bound — one ordinary paste freezes Word

`taskpane.ts:3864` calls `align()` with no length check, the textareas
(`taskpane.html:899`, `:902`) carry no `maxlength`, and `align.ts` allocates six
`(n+1)×(m+1)` arrays with no clamp anywhere. Measured:

| input | time | heap |
|---|---|---|
| 1 kb × 1 kb | 0.4 s | 100 MB |
| 3 kb × 3 kb | 2.2 s | 659 MB |
| 5 kb × 5 kb | **8.3 s** | **1.81 GB** |

Synchronous on the UI thread, and bound to `input` (`taskpane.ts:1402`), so every
keystroke re-runs it. `landing/science.html:78` invites exactly this ("Compare your
clone to the reference"), and 1–5 kb is an ordinary CDS or plasmid. The house rule
is already written two modules away — `serialDilution` grew an internal bound with
the comment *"in a task pane that is a frozen Word, not an error message"*.
**Fix: ~10 lines** — cap n·m and debounce.

### Wrong content reaching the user's document

#### 0.3 Every GenBank-imported sequence is filed as "synthetic construct"

The worst finding in this audit, because its output is a **statement of record in a
filed patent application**.

`taskpane.ts:2858` reads the organism out of the GenBank `source` feature:

```ts
organism: rec.features.find((f) => f.type === "source")?.qualifiers?.organism ?? "",
```

But `seqio.ts:204` is `const SKIP_FEATURES = new Set(["source"])`, applied at `:314`.
**The `source` feature can never be in `rec.features`.** `SeqRecord` has no organism
field, and the `SOURCE`/`ORGANISM` lines are never parsed. The comment directly
above the lookup — *"GenBank carries an organism in its source feature"* — is true of
GenBank and false of this reader. The chain completes at `sequence.ts:126`:
`const org = organism.trim() || "synthetic construct"`.

**Consequence:** an attorney imports 40 real GenBank records and files an ST.26
listing declaring all 40 as *synthetic construct*. Silent, and WIPO Sequence will not
reject it, because the value is legal. **Fix: ~10 lines.**

#### 0.4 Every predicted spectrum draws a NEGATIVE axis

`spectraChart.ts` negates x (and y on 2-D maps) so δ increases leftward — at `:28`
(NMR), `:58` (IR), `:112` (COSY), `:137` (HSQC), `:205` (JCAMP), `:231` (HMBC), `:252`
(TOCSY). But `buildPlotSvg` has no tick-label transform: `plot.ts:659` and `:680`
label `fmtTick(snapNearZero(t, step))` on the **raw plotted value**.

Reproduced directly (`nmrChartSvg(predictNmr("ethanol", "1H"))`):

```
X TICK LABELS: ["-4","-3.5","-3","-2.5","-2","-1.5","-1",
                "Predicted 1H NMR (estimate)","δ (ppm) — increases leftward", …]
```

IR of aspirin gives `["-4000","-3500", … ,"-500"]` cm⁻¹; COSY gives negative values
on **both** axes.

**Consequence:** every 1-D and 2-D NMR, IR and measured-JCAMP figure inserted into a
document shows negative chemical shifts and negative wavenumbers. δ = −3.5 ppm is a
real (upfield-of-TMS) value, so this does not read as a rendering bug — it is a wrong
figure that looks plausible. `currentSpectrumSvg = buildSpectrumSvg()`
(`taskpane.ts:23608`) with no post-processing, so pane and document are identical.

**Why nothing caught it:** `spectraChart.test.ts` asserts well-formedness, absence of
`NaN`, and the *label text* ("increases leftward") — never a tick value. That is the
same shape of assertion 1.1 describes.
**Fix: ~20 lines** — add `xTickLabel?`/`yTickLabel?` to `PlotOptions` and pass
`v => fmtTick(-v)` from the seven builders.

#### 0.5 A refused integral inserts `= NaN` into the document

`taskpane.ts:24416-24418` correctly branches on `Number.isFinite(r.value)` and shows
the honest refusal in the pane. `:24422` then does **not**:

```ts
sayMath(`int(${lo}, ${hi}, ${text}) = ${r.value.toPrecision(8).replace(/\.?0+$/, "")}`, val);
```

`sayMath` pushes a **math block** into `blocks[]`, which is what `insertDerivation`
writes into Word.

Verified by execution: `integrate("1/((x-1)^2)", 0, 2)` returns
`method: "does not exist on this interval"` with `value` that is `typeof number` and
`Number.isNaN` **true**; `mathToOmml("int(0, 2, 1/((x-1)^2)) = NaN")` returns 734
bytes containing `NaN` **without throwing**, so no fallback fires. Same for `1/x`
over [−1,1], `tan(x)` over [0,3], `ln(x)` over [0,1], `x^(-3)` over [−1,1] and five
others tested.

**Consequence:** the pane reads *"no value: the integrand is undefined somewhere in
this interval"*, and the document receives a typeset `∫₀² 1/(x−1)² dx = NaN`. The
repo's own "preview is not insert" lesson, and it populates the KNOWN-DEFECTS **A
tier**, which currently reads *"Empty."*
**Fix: ~3 lines** — build the math string from the same finite branch.

> **Methodological note, worth keeping.** The first probe of this reported
> `"value": null` and the finding was nearly dismissed as a mis-diagnosis —
> `JSON.stringify(NaN)` is the string `"null"`. `typeof` and `Number.isNaN` are the
> only reliable predicates here. This is the "a harness reports itself first" trap in
> a new costume.

#### 0.6 `NaN` passes Finance's insertion gate and lands in the document

`finMoney` guards non-finite values (`taskpane.ts:5648-5651` → `"—"`). **`finPct` does
not** (`:5652-5654`), and neither do the raw `.toFixed()` calls. The gate at `:6350`
blocks only on those two strings:

```ts
const insertable = !!text && !text.includes("—") && !text.includes("no solution");
```

Measured through the pane's own formatters:

| calculator | input | result text | `insertable` |
|---|---|---|---|
| `returns` | returns `2, 2, 2, 2`, ppy 12, rf 0.1 | `Annualized vol 0.00%` / `Sharpe ratio **NaN**` | **true** |
| `returns` | a single return `5` | `Annualized vol **NaN%**` | **true** |
| `ear` | nominal 12%, compounds/year `0` | `Effective annual rate = **NaN%**` | **true** |

`sharpeRatio` returns `NaN` by design when `stdev === 0` (`finance.ts:444`) — and a
constant return series is an ordinary paste (a fixed-coupon or money-market series).
The user clicks Insert and the document receives the literal string `Sharpe ratio
NaN`. Same family as 0.5, reached by a different route.
**Fix: small** — guard `finPct`, and add `NaN` to the gate.

#### 0.7 The Greeks disclosure tells the user to divide an already-per-day theta by 365 again

`taskpane.ts:5926` displays `Theta ${finMoney(g.theta / 365)} per day`. The `assumes`
string carried into the same block **and into the document** (`:5931-5933`) says:

> "Theta is per YEAR here; trading desks usually quote it per day (**divide by 365**)."

Measured, `blackScholesGreeks("call", 100, 100, 1, 0.05, 0.20)`: raw theta
−6.4140/year, displayed `Theta -0.02 per day`. A user following the note in their own
document divides again and reports a theta **365× too small**. The note was written
against an earlier per-year display and never updated.

Second defect on the same line: `finMoney`'s fixed 2 dp is the wrong precision here.
True −0.017573 → displayed **−0.02**, a **13.8% error**, while gamma one line above
correctly uses `toFixed(5)`. **Fix: small.**

#### 0.8 The perpetuity sensitivity sentence states a number that is not what it says it is

`taskpane.ts:6063-6065` prints *"one point of growth moves the value to …"* while
`Math.min(g + 0.01, rate - 0.0001)` silently substitutes a different growth rate.
Measured at payment 1000, discount 8%, growth 7.5%:

```
growing perpetuity                                  =    200,000.00
sentence: "one point of growth moves the value to"  = 10,000,000.00
actual g used = 0.0799  →  0.49 points, not 1.00
```

A 50× overstatement presented as a sensitivity fact, and inserted into the document.
The clamp needs to change the sentence, not just the number. **Fix: small.**

#### 0.9 The document audit false-alarms on every SEQ ID NO in a fresh session

`taskpane.ts:5141` supplies `listingCount: readSequenceEntries().length`, read live
from DOM sequence cards. **Nothing persists those cards** — the only `localStorage`
use in the entire pane is palette open/closed state (`taskpane.ts:2164-2175`).
`audit.ts:94` runs the section when `refs.length > 0` even with `listingCount === 0`,
and `seqid.ts:97` then flags every reference.

Reproduced on a correct specification citing SEQ ID NO: 1 and NOs: 2–40:

> Sequences (SEQ ID NO) — 1 issue:
> `SEQ ID NO out of range (listing has 0): 1, 2, 3, … 40`

in the red error block, with `report.ok = false`.

**Consequence:** this is the break in the patent chain. The attorney generates the
listing, reopens Word the next day, clicks "Check this application" on a correct
document, and all 40 references are flagged. False alarms at that volume train the
user to ignore the audit — including the numeral and figure sections that are right.
(`seqid.ts:100` also claims "listingCount comes from a parsed listing"; it comes from
DOM cards.) **Fix: 2 lines** for the honest version.

### Wrong numbers on screen

#### 0.10 The statistical assumption checker tests the wrong distribution — and gets *more* wrong as the real effect gets *larger*

`diagnostics.ts:227` pools every group into one vector and tests that:

```ts
const pooled = groups.reduce<number[]>((acc, g) => acc.concat(g), []);
const norm = normalityTest(pooled);
```

t-tests and ANOVA assume normality of the **within-group residuals**, not of the
pooled marginal. Two normal groups with different means are *bimodal* when
concatenated — so the check fires **because there is an effect**:

| n per group | normality p, A | p, B | **pooled p** | what the pane says |
|---|---|---|---|---|
| 25 | 0.975 | 0.975 | **2.1e-5** | ⚠ not normally distributed… *Consider the Mann-Whitney U test instead.* |
| 40 | 0.973 | 0.973 | **3.3e-10** | same |
| 40, **zero** separation | 0.973 | 0.973 | 0.841 | no warning |

The tell is in the same function: the variance check at `:246` correctly passes
`groups` and tests them **per group**. Only normality was pooled. This note prints
under every two-sample t-test (`taskpane.ts:6573`), every paired t-test (`:6595`),
and is the entire output of "Check test assumptions" (`:6912`). The paired branch is
worse — it pools the two conditions' raw scores when the assumption is about the
**differences**.

**Consequence:** a student pastes two clean groups with a large real difference, gets
a valid Welch t-test, and is told to throw it away for a less powerful rank test.
The stronger the result, the louder the product says it is invalid.
**Fix: 2 lines.**

#### 0.11 IR assigns C–halogen bands from the element alone, so sodium chloride gets a "C–Cl stretch"

`ir.ts:261-264` keys purely on atomic number, with no check that the halogen is
bonded to carbon:

```ts
if (z === 17) add({ wavenumber: 700, …, assignment: "C-Cl stretch" });
```

Measured: **`sodium chloride`** — in the dictionary as *sodium chloride*, *salt*,
*table salt* — returns exactly one predicted band: `700 cm⁻¹, "C-Cl stretch",
strong`. `hydrochloric acid` gives the same; `F[P-](F)(F)(F)(F)F` gives a "C-F
stretch". None contains a covalent carbon–halogen bond. Contradicts `FEATURES.md:44`
("Structure recognition is exact"). **Fix: 4 lines.**

#### 0.12 NMR invents a shift for every carbonyl-like carbon it cannot name, with no caveat

`molgraph.carbonylKind` returns `null` for cumulenes and unnamed acyl environments
*deliberately*, so callers "simply predict nothing for it" (`molgraph.ts:86-97`).
`ir.ts:183-197` obeys. `nmr.ts:342-363` tests `if (kind)` and then **falls through**
to the generic sp2 branch, returning a confident `δ 160.0, "sp2 C (C=N / C=S)"`.

| input | shipped | reality | caveats |
|---|---|---|---|
| `carbon dioxide` (dictionary) | δ 160.0 "sp2 C (C=N / C=S)" | ≈125 | **none** |
| `carbon disulfide` (dictionary) | δ 160.0, same label | ≈193 | none |
| `O=C(Cl)Cl` phosgene | δ 160.0, same label | ≈142 | none |
| `C=C=O` ketene (¹H) | δ 5.25 "=CH (alkene)" | ≈2.5 | none |

Separately, `nmr.ts:332-338` assumes any triple bond not to nitrogen is an alkyne, so
**`carbon monoxide`** (dictionary, `[C-]#[O+]`) returns **δ 84 "C≡C (alkyne)"** against
a real ≈184.

**Why it survived:** `molgraph.test.ts` asserts the ten *named* carbonyl kinds and
that benzene/ethanol have none — but **never asserts the `null` return**, the exact
behaviour the module's 20-line comment exists to defend.
**Fix: ~15 lines** plus 4 assertions.

#### 0.13 UV-Vis applies Woodward–Fieser far outside its domain while claiming ±5 nm — and three shipped surfaces claim it refuses to

`uvvis.ts:13-14` states that extended, cross-conjugated and aromatic-fused
chromophores "are flagged as out-of-domain instead of being given a false λmax".
**No such test exists.** The diene branch adds +30 nm per extra double bond without
limit (`:250-253`); the aromatic branch returns a flat 254 nm (`:296-309`).
`uvvis.ts` never imports `isFusedAromatic`, which `nmr.ts` already uses.

| input | shipped | real |
|---|---|---|
| `beta-carotene` | **534 nm**, "conjugated diene", caveat *"typically ±5 nm within their domain"* | ≈450 |
| `lycopene` | 524 nm | ≈470 |
| `anthracene` | **254 nm**, "benzene ring (B-band)" | ≈375 |
| `naphthalene` | 254 nm | ≈275/312 |

Repeated in `FEATURES.md:48` and `landing/science.html:111`. **Fix: small.**

#### 0.14 `primerTm` deletes IUPAC ambiguity codes and fabricates a stacking step

`dna.ts:362` does `.replace(/[^ACGTU]/g, "")` — it **removes** degenerate bases rather
than skipping them, joining the two flanks into a nearest-neighbour step that does
not exist in the oligo. `cleanDna` passes R/Y/N through, and the pane feeds its
output straight in (`taskpane.ts:4658`). Measured on `ACGTRYACGTACGTACGTAC`:

- reported length **18**, not 20;
- Tm 50.62 °C, **bit-identical** to the same oligo with R and Y physically deleted;
- one N in a 20-mer: 52.09 °C against 57.07 °C — 5 °C low;
- a fully degenerate 20-mer returns `length 0`, `tm 0`.

The `unknown` counter at `dna.ts:394` **can never be non-zero**, so the caveat at
`:428` — *"non-ACGT base and were skipped — the Tm is an underestimate"* — is
unreachable dead code describing behaviour that cannot occur. Degenerate primers are
routine, and `landing/science.html:80` headlines this exact tool. **Fix: ~15 lines.**

#### 0.15 Numeric limits print 8 significant digits against a 1e-4 acceptance tolerance

`analysis.ts:155` accepts convergence at `spread <= 1e-4 * (1 + |last|)` and returns
**the last sample**. On the numeric branch `exact` is never set (`:309-313`), so the
pane falls to `trimNum`, which is `toPrecision(8)` (`taskpane.ts:24153`).

Verified: `limit((1+1/x)^x, x→∞)` displays **`= 2.7185235`**. The true value is
*e* = 2.7182818 — wrong from the 5th significant figure, shown with eight. The
caveat present ("evidence, not a derivation") speaks to provenance, not precision.
A student checking against the textbook sees a mismatch and cannot tell which is
wrong. **Fix: ~2 lines.**

### Display-is-a-contract breaches

Rule: correct typesetting in **all** output including errors, and whatever is
displayed must parse back. Two modules already implement it —
`units.ts:520-534 normalizeUnitText` and `massspec.ts:83-92` both accept
superscript/subscript input, each with a comment saying that refusing what you
display is a trap. These four surfaces do not.

#### 0.16 Chemical mode prints `H2O`, and then refuses `H₂O` as input

`chemValidate.ts:207-221 hillFormula()` emits ASCII, and `taskpane.ts:2556` prints it
raw: `✓ Valid — ${v.hill}, M = …`. Meanwhile `chemValidate.ts:59` uses ASCII-only
`isDigit`, so `:144` pushes `Unexpected character "₂"`.

Both halves of the rule are breached in the flagship chemistry tool: the happy-path
readout displays the exact string the rule forbids, and the cross-mode round trip
fails — Engineering combustion renders `CH₄` via `energy.ts:752 formatFormula`, and
pasting that into Chemical yields `⚠ Unexpected character "₄"` with no MW.
**Fix: tiny** — `formatFormula(v.hill)` at 2556 (already imported at `:473`), plus
reuse massspec's `SUB_DIGITS` in `parseSegment`.

#### 0.17 Mass Spec shows ASCII formulas on screen and subscripted ones in the document

`taskpane.ts:23230`, `:23576-23580` render formulas via `textContent`; the insert path
for the same data uses `formulaHtml()` (`:23760-23766`). The pane shows `C7H8`, `CH3`;
the document gets `C₇H₈`, `CH₃`. Preview ≠ insert, and the pane half breaches the
rule. **Fix: tiny** — the rows already have `formulaHtml`.

#### 0.18 The unit-converter refusal prints `m/s^2`

`taskpane.ts:5264` interpolates the raw typed strings into *"Can't convert
${from} → ${to} (unknown or incompatible units)."* The rule explicitly covers error
messages and names `m^3` as forbidden. Second problem in the same line: it conflates
*unknown* with *incompatible*, while `units.ts:588-593 parseMeasured` already
distinguishes them with far better text — which is **unreachable** from the Units
pane. **Fix: tiny.**

#### 0.19 HMBC and TOCSY charts are typeset in ASCII while COSY and HSQC beside them are not

`spectraChart.ts:237-239` and `:260-262` emit `"Predicted 1H-13C HMBC"`, `"d 1H (ppm)
- increases leftward"`, `"3J (C,H)"` — δ rendered as a Latin *d*, superscripts as
inline digits — against `:122-124` (`"Predicted ¹H–¹H COSY"`, `"δ (ppm)"`) and
`:138-141` (`"¹J(C,H)"`). **Fix: trivial** string edits.

### Caveats computed and then dropped

#### 0.20 Five places where the honesty exists and the routing loses it

- **¹H coupling.** `taskpane.ts:23423` renders `predictCoupling`'s J values; `:23589`
  shows only `cur.nmr.caveats`. Measured, **`cinnamaldehyde`**: the pane shows
  `δ 6.60 (1H, d (12.0))` while the three coupling caveats — including *"cis ~6-12,
  trans ~12-18; a nominal value is shown"* — appear nowhere. Trans-cinnamaldehyde is
  ≈16 Hz. **~4 lines.**
- **Isotope pattern.** `taskpane.ts:23265` shows "Pattern excludes Mg…" on screen;
  `massSpecAsText` (`:23300-23313`) omits it. Measured, **`chlorophyll a`**: the
  inserted table is computed as if the magnesium were not there. **1 line.**
- **Heat-map and candlestick notes are discarded.** `tablechart.ts:383-388` returns
  `r.svg` and drops `r.notes`; `:393` drops `buildHeatmapSvg(...).notes`. Lost
  messages include *"N rows could not be drawn because the high is not the largest of
  its four values… a data error rather than a market event"* and *"N cells are not
  numeric and are left blank; they are NOT counted as zero"*. Rows vanish from a
  chart with no notice. Sharper: the *same entry point* surfaces warnings for
  `tablefigure` and `tablediagram` (`taskpane.ts:3282,3286`) — only the two chart
  renderers are swallowed. **~15 lines.**
- **The log-axis drop warning never reaches the figure.** `taskpane.ts:5492-5501`
  computes *"⚠ N points not plotted: a logarithmic x axis cannot show zero or
  negative values"* into a `<div>` beside the SVG; `currentPlotSvg = svg` at `:5513`.
  Exactly the titration-with-zero-control case `plot.ts:239-249` names, and
  `tablechart.ts:349` already established the opposite principle ("*the message goes
  into the picture so it survives being inserted*"). **small.**
- **sp3 ¹H** has no unknown-substituent tracking, unlike ¹³C (`nmr.ts:454-467`).
  **~8 lines.**

#### 0.21 The two most-used pharmacology fits ship with zero caveats

`assay.ts:112` states the contract — *"The UI must show them."* Four of six LM fits
honour it. **`dose` (IC50/EC50) at `taskpane.ts:25010` and `binding` (Kd) at `:25036`
return no `caveats` key at all**, and the renderer is gated on `out.caveats?.length`.
Dropped for exactly the two most-used tools: *"standard error above 25% of the
estimate"*, *"R² is a poor guide for a nonlinear fit"*, *"this is a LOCAL
optimiser"*. Both are also the only fits adding no model-specific caveat —
`fitMichaelisMenten` catches the identical "plateau never reached" failure via
`kineticsCaveats`. **Fix: 2 lines**, plus ~20 for the range check.

### Analyze's data path

#### 0.22 Trends are uncorrected and fire on pure noise

The correlation half of `insights.ts` was corrected for multiplicity last cycle and
congratulates itself in a 12-line comment (`:46-59`). **The trend half beside it was
not.** Measured, 8 columns × 30 rows of pure noise, in one report:

```
• V8 shows a significant increasing trend over the rows (…p = 0.022).
• 28 pairs were tested at once, so the p-values are corrected (Benjamini-Hochberg)…
  0 survive correction.
```

Plus: **the x-axis is renumbered** (`:304-306` drops blanks *then* sets `xs = i+1`, so
a true slope of 10/row is reported as **13/row**, labelled "per row"), and
**independence is never tested or caveated** — there is no autocorrelation code
anywhere in `src/lib`. The shipped default example (`taskpane.ts:7862`,
`dose,response`) reports the experimenter's own dose ladder as a significant trend.
**Fix: ~12 lines.**

#### 0.23 The correlations table prints uncorrected p-values two inches above the prose saying they were corrected

`insights.ts:440` renders each pair with `pStr(c.p)`, never `c.pAdjusted` — and the
table is the part a reader copies into a paper. **Fix: 1 line.**

#### 0.24 The paste path uses a second, quote-blind parser — and the pane points users at it

`dataimport.ts:18-27` is correct, and its header explains that a quoted cell
containing the delimiter "is the common case rather than an edge case" because
"Excel writes such files by default", and that a naive split "silently shifts every
column… producing a table that looks plausible and is wrong". `insights.ts:102-106`
**is** that naive split. "Open CSV…" routes to the safe one; the field hint *"Paste a
data table"* (`taskpane.ts:7857`) routes to the broken one. Measured:

```
dataimport.parseDelimited:  [["sample","conc"],["Smith, John","5"], …]   ← correct
insights.parseTable:        headers ["C1","C2","C3"], 4 rows             ← wrong
Data analysis — 4 rows × 3 columns        (it is 3 rows × 2 columns)
  • C3 shows a significant increasing trend over the rows (…p < 0.001)
```

Column shift, header consumed as data, fabricated p < 0.001. `:112` also requires
*every* row-1 cell to be non-numeric to treat it as a header, so `Time,1,2,3` counts
its own header as an observation. **Fix: ~10 lines** — delegate to `parseDelimited`.

#### 0.25 Non-numeric cells vanish and "missing" stays 0

`insights.ts:156-172` counts `missing` as blanks only. Measured:
`summarizeColumn("conc", ["1","2","3","4","ND"])` → `{n:4, missing:0, mean:2.5}`. The
censored values every real lab dataset carries — `ND`, `<LOD`, `BQL` — are exactly the
extreme observations. **Fix: ~6 lines.**

#### 0.26 `proteinProperties` silently drops unknown residues

`dna.ts:532` skips any residue not in `RESIDUE_MASS` with no `invalid` list — unlike
`cleanDna`, `cleanResidues` and `parseSequence`. Measured: `MKVLSPADKTNVKAAWXXXX`
(20 residues) returns `{length: 16, mw: 1759.1}`, byte-identical to the sequence with
the X's removed. `resolveCodon` emits `X` for any unresolvable degenerate codon.
**Fix: ~8 lines.**

### Document-write safety

#### 0.27 Three catch blocks tell the user the document is untouched at the moment it is half-modified

`applyParagraphNumbers` queues one `insertText` per paragraph and flushes at
`taskpane.ts:5576`. Its catch (`:5581`) says:

> "Could not number the document. **Nothing was changed** — press Ctrl+Z if anything
> looks off, and try again."

Both halves cannot be true, and the second is actively harmful: if nothing was
changed, Ctrl+Z undoes **the user's own previous edit**. Same shape in
`crashReport.ts crashAdvice()` (unconditional, rendered by the global crash banner)
and at `taskpane.ts:25716`, which prints Word's raw exception after having already
committed TA-field **deletions** in a separate flush. **Fix: small.**

#### 0.28 The pane promises single-step undo while committing in two or more flushes

`tagInserted()` (`:25999-26009`) wraps inserted content in a hidden content control
**after its own `context.sync()`** — a second commit — across **24 call sites**.
`insertEditableWordTable` (`:3439`) makes three commits for one button. All **7** undo
strings say *"Ctrl/⌘+Z undoes it"*, singular. **Fix: small** for the wording.

#### 0.29 The TOA path half-applies, and is worse than previously documented

`buildNativeToaHandler` (`taskpane.ts:25607`) is unchanged. The prior analysis called
it "7 `context.sync()` calls"; the sync at **`:25675` is inside the `for (const
[needle, owners] of byText)` loop**, so the real count is O(distinct citation
strings) — a 40-authority brief flushes ~45 times, with stale TA fields deleted and
committed at `:25637-25638` before any new mark is written. *(Included as a
write-safety defect; Citations was out of scope.)* **Fix: medium.**

#### 0.30 Three `Math.max(...array)` spreads over user data

The hazard `minmax.ts` exists to prevent — "a CLIFF, not a curve: 100,000 values work
perfectly and 130,000 throw": `pca.ts:224-225` (measured: `trapz` on 200,000 points
throws `RangeError`), `taskpane.ts:7062`, `:7744-7745`. All three fields accept "Open
CSV…", whose ceiling is 8 MB. The global error handler catches it, so the user gets
the crash banner rather than a dead pane; the panel's work is still lost.
**Fix: 5 lines** — `minOf`/`maxOf` are already imported into `insights.ts`.

#### 0.31 Smaller, same classes

- **A single displayed root mixes two minus characters and does not re-parse.**
  `solve.ts:729-730` emits U+2212 for the sign and ASCII `-` from `fmtNum`, so
  `x^3-2=0` displays `-0.629960525 − 1.091123636i`; feeding that back to the
  product's own parser throws `Unexpected character "−"`. **1 line.**
- **Two complex formatters, two conventions.** `solve.ts:725-731` displays `0 + 1i`
  where `linalg.formatComplex` correctly gives `i`. Both ship in the same pane.
  **~5 lines.**
- **A live false capability claim in the pane.** `taskpane.ts:7570` still says
  *"Non-symmetric matrices are out of scope"* — fifteen lines above `id:
  "eigen-general"` at `:7585`, which computes them. This is the claim OPEN-ITEMS 6
  raised; it was fixed in `linalg.ts` and left in the pane, where users read it.
  **1 line.**
- **`featureWarnings` ignores `/codon_start`** (`sequence.ts:217` vs `:151-159`), so a
  correct CDS `1..61` with `/codon_start=2` draws "not a multiple of 3", and a
  genuinely broken frame draws nothing. **1 line.**
- **Self-declared non-compliant sequences are still emitted and counted.**
  `taskpane.ts:2976` warns `only 3 residues (ST.26 lists ≥ 4)` and `buildSt26Xml`
  emits it anyway, numbered, counted in `SequenceTotalQuantity`, and counted into the
  `listingCount` the audit reconciles against. **~5 lines.**
- **`reactions.arrowWarning` is computed, tested, and never read.** `A ->> B` draws as
  though the arrow were fine — the outcome the comment was written to prevent.
  **3 lines.**
- **Bond maturity is silently rounded to a whole coupon period.** `finance.ts:132`
  and `:313` do `Math.round(years * freq)`. Measured (face 1000, coupon 5%, YTM 6%,
  semiannual): 10.25, 10.4 and 10.5 years all return **922.92**. Three maturities,
  one price, and the `assumes` for `bond` discloses clean-vs-dirty and a flat curve
  but says nothing about this; `bondrisk` discloses neither. **small.**
- **IRR reports "no solution" above ~1000% and never says that is the bound.**
  `finance.ts:66-67` searches `[-0.99, 10]`. Measured: `irr([-1, 20])` → null against
  a true IRR of 1900%. The `assumes` says *"no rate in the searched range"* — true,
  but the range is stated nowhere the user can see, so a venture-style 20× return
  reads as "this cash flow has no IRR". Opaque rather than false. **small.**
- **Straight-line depreciation with a fractional life prints a false statement.**
  `taskpane.ts:5992-6008` divides by `life` but iterates `Math.floor(life)`, then says
  *"the book value reaches salvage in the final year."* Measured (cost 10,000,
  salvage 1,000, life 7.5): year 7 book value **1,600**, i.e. 600 above salvage.
  Ranked last — integer lives are the norm. **small.**

---

## TIER 1 — high leverage, small effort

### 1.1 The figure gates are Engineering-only, and so is the fuzz that found seven frozen-Word bugs

This is the structural finding behind 0.1 and 0.4, and the highest value-per-hour
item in the document.

**The figure ratchet does not see this half of the product.**
`scripts/engineering-audit.js:313` sets `FIGURE_BASELINE = 130` over inserts produced
by `engineering-audit-driver.js:37`, which does `sel.value = "engineering"` and
iterates `#engineering-calc` only. `scripts/figure-layout-run.ts:20-33` imports
**only** `mechchart`, `plot`, `reliability`, `colourspace` — `tablechart`, `heatmap`,
`candlestick`, `spectraChart`, `beamChart`, `periodicChart`, `tablefigure`,
`tablediagram` and `grid` are not in the corpus. What would catch a Spectra, Stats,
Analyze or Table→Chart figure regression: **essentially nothing**. The per-module
suites assert well-formedness and absence of `NaN` — which is exactly how an NMR axis
reading −4 ppm survived 8,957 tests and 11 QC gates.

**The blank-page guard is mode-general but input-blind.** `render-check.js:155-170`
drives every option in `#mode-select` and fails if a mode does not render its own
section — a real guard, and it covers the non-Engineering panes. But deep,
input-driven checks exist for only four surfaces (seqmap, spectra, analyze/ODE,
chemical preview). **Plot, Table→Chart, Stats, Assay, Periodic, Units, Math, Build
and Code have no input-driven assertion at all**, so a section that renders its
controls and then throws — or builds a 510 MB SVG — on first input passes every gate.

**The whole-library fuzz is gone.** `unbounded.adversarial.test.ts` was added at
v2.18.0 (`8042ce0`, 2026-07-27); its header describes "a whole-library fuzz — every
exported function in all **97** lib modules… with a heap cap and a 30 s timeout",
and it found seven functions that never return. There are now **151 modules**
(verified by `git ls-tree` at that commit against the tree today): **54 modules, 56%
growth, never swept** — `pca`, `curvefit`, `dataimport`, `heatmap`, `candlestick`,
`insights`, the spectra predictors, all of it. The fuzzer itself **is not in the
repo**: no script, no npm entry. What survives is a hardcoded list of ~11 functions,
precisely the failure the reachability ratchet's own comment warns about.

Worth stating precisely, because it bounds the claim: that fuzzer drove **hostile
scalars** (`Infinity`, `NaN`, `1e308`). It would not have found 0.2 (Align) or 0.1
(tick loops), whose inputs are not hostile but merely **large** or **small**. A
second instrument — *valid but extreme* inputs against every function taking an array
or a magnitude — is equally cheap and is the one that catches the O(n·m) and
tick-count classes.

**And one gate cannot run at all offline:** `qc.ps1:98` invokes the figure-layout
gate as `npx ts-node …`, and `ts-node` is neither in `devDependencies`
(`package.json:31-49`) nor installed. Offline it cannot run; online it
network-installs on every QC run. For a product whose stated core value is offline
operation, that is a gate that will be skipped.

**And the dead-export ratchet has a structural blind spot**, found by walking a
concrete case. `finance.xnpv` (dated NPV) is exported and tested
(`finance.test.ts:163`), has **zero** occurrences in `taskpane.ts`, and is in no
`FIN_CALCS` entry — so a user with dated cash flows can get a *rate* (`xirr`) but not
a *present value* at a chosen discount rate, the more common question. The ratchet
does not list it, and cannot: it counts name occurrences across all of `src/`, and
`xirr` calls `xnpv` at `finance.ts:290`, so `uses.length === 2` and it reads as live.

**Any export consumed only by its own module is invisible to the ratchet**, however
unreachable it is to a user. The ratchet is honest about what it measures; what it
measures is "is this name mentioned twice", which is not "can a user run this". The
complementary scan — exports named neither in the pane nor in any *other* lib module —
returns ~144 names, mostly genuine internal helpers. That list needs triage, not
dismissal: `xnpv` is sitting in it.

**Do:** add the eight missing chart modules to `figure-layout-run.ts`; add a
tick-value assertion to `spectraChart.test.ts`; extend the driver past Engineering;
commit the fuzzer and re-run it over all 151 modules; triage the 144-name
internal-only list for user-facing capability; move `ts-node` into `devDependencies`.

### 1.2 Two `describeAssumptions` consumers are missing — but wiring them now would spread 0.10

ANOVA (`taskpane.ts:6958-6967`), Tukey (`:6995`) and Kruskal-Wallis never call it;
only `twosample`, `paired` and the standalone calculator do. Tukey's own caveat
(`tukey.ts:290`) tells the user to go run a different calculator by hand.
**~6 lines each — after 0.10**, or the bug propagates to three more surfaces.

### 1.3 Shipped but invisible — four capabilities with zero discoverability

Each is invocable, so none is strictly unreachable; but the keyword that opens it
appears **nowhere** in `taskpane.ts`, `taskpane.html` or `examples.ts` (zero grep
hits). All are hint-text edits, minutes each.

- **Alexander polynomial and complex K-theory** — `homology.ts:720` routes
  `/alexander/`, `:497` routes `/k[- ]?theory/`; both verified working. The topology
  hint advertises nine other things and neither of these. This is the module the
  repo's history records as having once shipped literally unreachable.
- **The 3-D linear-transform toolkit** — `"rotate 90 z then scale 2 (1,0,0)"` works.
  The dead-export ratchet was lowered 17→10 on the strength of it being "surfaced" in
  v2.78.0; the geometry hint contains no `rotate`, `reflect` or `scale`.
- **Inequalities** — `x^3 - x >= 0` → `[-1, 0] ∪ [1, ∞)` works. Neither the equation
  hint nor the Solve examples mention that the box accepts `<`, `>`, `≤`, `≥`.
- **Indefinite integrals** — the v2.78.0 entry point is "leave both limit boxes
  blank", while the dropdown reads **"Definite integral"**, the hint describes only
  limits, and the two fields carry placeholders `0` and `1` that read as defaults.

### 1.4 Effect size is mandated for t-tests and absent for ANOVA

`oneWayAnova` returns only `{f, dfBetween, dfWithin, p}` (`stats.ts:256-281`) and
`taskpane.ts:6966` prints F alone. The product *mandates* Cohen's d for t-tests
(`stats.ts:212-216`) and then reports a significant ANOVA with no magnitude at all.
No η², ω², ε², Cramér's V or CI on d anywhere. **~25 lines** for η²/ω².

### 1.5 Chi-square has no minimum-expected-count check and no exact alternative

`stats2.ts:236-284`; grep for `expected count`, `Cochran`, `Yates`, `Fisher` returns
zero. Measured, a 2×2 with all expected counts 4.5–5.5 — `[[1,9],[8,2]]` — gives
`χ² = 9.899, p = 0.00165`; Fisher's exact two-sided is **0.0055**. Anti-conservative
by 3.3×, widening as counts fall — i.e. in exactly the small pilot experiment that
gets typed into a pane. **~20 lines** for warning + Yates.

### 1.6 GenBank feature tables are dropped on import

`addSequenceCard(prefill)` (`taskpane.ts:2712`) accepts only `{residues, organism,
molType}`. `parseSequenceFile` fully parses CDS/gene/mRNA locations, `join()`,
`complement()` and qualifiers — and `importSequenceFiles` (`:2851-2861`) throws it all
away. The attorney with 40 sequences imports them in one click, then hand-keys every
CDS location, `/gene` and `/product`. The header comment at `:2705-2711` describes
that attorney as a solved problem; only the residue half is solved. **~40 lines.**

### 1.7 Parser accessibility — four cheap input fixes

- **`sec`, `csc`, `cot` are not in the parser** (`solve.ts:57-63`) — yet `solve.ts:2099`
  writes *"a pole of tan/cot/sec/csc"*. `integrate("sec(x)^2", 0, 3)` returns null, so
  the pane blames the user's input format for a function its own diagnostics imply it
  supports. `floor`/`ceil`/`round`, factorial and `gamma` are also absent. **~6 lines.**
- **Unicode operators and constants are rejected** — `π`, `2π`, `√4`, `2 × 3`, `2 ÷ 3`,
  `∞` all fail while `pi` works (`normalizeUnicodeMath` handles super/subscripts
  only). A student typing `π` from Word's Symbol dialog gets "Could not parse".
  **~5 lines.**
- **Bracketed matrix input is rejected everywhere in Analyze** — `[1 2; 3 4]` (MATLAB)
  and `[[1,2],[3,4]]` (numpy) both fail with `"[1" is not a number.` Against the
  "compete with MATLAB" north star, the first thing a MATLAB user pastes fails with
  an error that reads like a data problem. **~3 lines.**
- **ODE input rejects Leibniz notation** — `dy/dt = -2*y` is refused (honestly, naming
  the accepted form), and that is how every textbook writes it. **~10 lines.**

### 1.8 Eleven library formulas typeset a spurious parenthesised exponent

`parseBase` on `(` builds a delimiter node that **keeps the brackets**
(`mathParse.ts:348-351`, `:530`); the braced form does not. Measured:

```
"e^(-x)"     → HTML "e(-x)"    OMML sup contains  <m:d>…-x…</m:d>
"e^{-x}"     → HTML "e-x"      OMML sup contains  no <m:d>
"a^(m + n)"  → "a(m+n)"        "a^{m + n}" → "am+n"
```

The app's own help teaches the braced idiom (`examples.ts:252`) and the Finance
categories use it — but **11 entries in Mathematics / Physics / ML use the paren
form** (`formulaLibrary.ts:34, 60, 81, 97, 105, 106, 168, 169, 183, 190, 201`). Pick
*Computer science / ML → Sigmoid* and Word shows σ(x) = 1/(1 + e^((−x))). Same for
*Power rule*, *Normal distribution (PDF)*, *Sinh*/*Cosh*, *Binomial theorem*. It is
unambiguous and it round-trips, so this is a typesetting-consistency defect rather
than a display-contract violation — but the library is the product's original core
feature and it is inconsistent with itself.

Fold in the authoring path: the math palette's superscript item is
`{ label: "xⁿ", snippet: "^", caret: 1 }` (`palettes.ts:26`) and there is **no braced
snippet anywhere in `palettes.ts`**, so a user who clicks it and types `n-1` gets
`x^n − 1`. **Fix: 11 string edits plus one palette snippet.**

### 1.9 Molar extinction coefficient from sequence

`proteinConcFromA280` (`assay.ts:922`) demands ε from the user while
`proteinProperties` already computes MW/pI/GRAVY from the same string. Gill & von
Hippel (5500·W + 1490·Y + 125·C) needs only data already in hand. **~15 lines.**

### 1.10 Cheap honesty fixes with no new capability

- **IR is silent about groups it cannot assign**, unlike NMR — azide (≈2100 cm⁻¹),
  isothiocyanate, N=N, all *above* the documented <1500 cm⁻¹ refusal, produce no band
  and no note. **~20 lines.**
- **Reaction coefficient stripping** — `2 H2 + O2 -> 2 H2O`, how a chemist actually
  writes it, fails: `fromSmiles("2 H2O")` yields 0 atoms. **~10 lines.**
- **U (Sec) / O (Pyl) parity** — `sequence.ts:68` accepts them, `dna.ts:485` carries
  their masses, `peptide.ts` rejects both and truncates a selenoprotein. **~10 lines.**
- **`nmr2d.ts:274` blames the input** — "the configuration is not specified" — even when
  the user *did* specify it (`C/C=C/C(=O)O` still yields J = 12.0). **1 line.**
- **The Serre convention trap** — `homology.ts:464` reads the two named spaces as
  **base then fibre**, so `S1 -> E -> S2` computes the reverse fibration. It echoes
  what it used, so the user *can* see the swap, but only by reading the title.
  **1 line** for an arrow-aware guard.
- **`units.ts:356` `fram: "fps"`** — almost certainly meant `frame`; as written it maps
  a non-word and `frame` resolves to nothing.
- **`pka.ts:440`** contains a stray CJK character mid-comment.

### 1.11 What the document audit does not check

`auditDocument` is reachable (imported `taskpane.ts:334`, called from `runAudit` at
`:5138`) and has four sections (`audit.ts:76-127`): reference numerals, SEQ ID NO,
figure-number continuity, figure/table caption cross-references. Three verified
absences, none of them claim-set hygiene:

- **The audit sees only `body.text`.** A grep for `footnote|getHeader|endnote` across
  `taskpane.ts` returns **one** hit, and it is a UI string. All six `body.load("text")`
  sites read the main story only, so figure callouts in text boxes, and anything in
  headers, footers or footnotes, are silently unaudited — and the tool reports
  "✓ No issues" over a document it only partly read. **medium.**
- **The inverse numeral check does not exist.** `reconcileNumerals`
  (`numerals.ts:131-147`) builds `elementsByNumeral` and flags *one numeral → two
  element names*. There is no `numeralsByElement`, so **"housing (12)" in one place
  and "housing (14)" in another passes clean** — the more common real drafting defect.
  This is numeral hygiene, not claim hygiene, so it is outside the declined item.
  `normalize()` (`:99`) already provides the key. **~15 lines**, mirroring the existing
  collision loop.
- **Figure continuity is checked against the prose, never against a figure list.**
  `audit.ts:102-112` derives figure numbers from `FIG. N` references and reports
  interior gaps. Nothing checks the **Brief Description of the Drawings**, so a spec
  referring to FIG. 1–6 with a brief description covering 1–5 passes. The section
  heuristics in `paragraphs.ts` (`looksLikeHeading`, `:94`) already locate the heading.
  **small.**

### 1.12 Deploy gate omissions

`.github/workflows/pages.yml` runs **four** checks: `lint`, `test`,
`validate:compounds`, manifest validate. (`npm run build` is in the `deploy` job,
*after* the gate.) Browser-dependent gates are legitimately excluded — but
`check-tool-pages.js`, `figure-layout-run.ts` and the id-wiring audit need neither
browser nor network. `check-tool-pages.js` is the gate written *because* a tool page
shipped broken for ten releases, and it still does not guard the publish path.
**Three lines of YAML.**

---

## TIER 2 — strategic builds

### 2.1 Offline delivery is backed by nothing, and two shipped pages now disagree about it

Sweeps for `serviceWorker`, `workbox`, `cache.addAll`, `caches.open` across `src/`,
`scripts/`, `webpack.config.js` and both manifests return **zero**. Sharper than
OPEN-ITEMS 1b states: `webpack.config.js:38` sets `[name].[contenthash].js`
**deliberately, to defeat caching**, so the bundle URL changes on **every release** —
offline operation breaks not only on cache eviction but on the first offline open
after any deploy the user has not yet fetched.

`landing/students.html:100` is already honest — *"a guaranteed-offline install is
still on the to-do list… The computing is offline today; the delivery is not yet."*
`install/README.md:19`, `:70` and `landing/manual.html:87` still promise it flatly.
**Copying the students.html wording into the other two is minutes**, and should
happen regardless of whether the service worker is ever built. The worker itself is
spike-first: Mac WebKit host, and push-is-deploy depends on fetching from the network.

### 2.2 The two chart systems are still divergent, and neither is a superset

- **Plot mode** (`taskpane.html:578-620`): free function/data plotting, log₁₀ on
  either axis, typed error bars, legend — but **only line and scatter**, no chart-kind
  selector.
- **Table→Chart** (`:637-659`): 12 kinds (column/bar/line/area/scatter/3
  stacked/pie/doughnut/heatmap/candlestick) — but **no log axis, no error bars, no
  explicit limits**, and `buildAxisSvg` always forces the value axis through zero
  (`tablechart.ts:499-500`).

So a Word table of dose-response data cannot be drawn log-x, and a Plot-mode dataset
cannot be drawn as a bar chart with error bars.

Still absent for journal submission, all verified: **explicit axis limits and tick
intervals** anywhere (`PlotOptions` has no `xlim`/`ylim`/`xtick`; limits are always
data-derived with 6% padding); **significance brackets and asterisks** (zero
footprint — the product ships Tukey, Dunnett and t-tests but cannot annotate the
comparison); **serif typography** (`font-family="sans-serif"` hardcoded in all 10 text
emitters); **multi-panel labels** — `combineSvgs` (`plot.ts:360`) exists and is used
twice, so OPEN-ITEMS 11 should be *reworded* rather than closed: vertical stacking
works, A/B/C sub-panel labels and grid arrangement do not; and **vector output** —
all 15 insert paths go through `svgToPngBase64`, zero `asvg`.

Unreachable options that already ship: **diverging heat-map scale, midpoint and
`hideValues`** (`heatmap.ts:44-53`; `tablechart.ts:393` passes only `{grey}`, so a
correlation matrix — the canonical diverging case — gets a sequential ramp with no way
to change it) and **`CandlestickOptions.redIsUp`**, whose own comment says the legend
"is the point of having the option".

### 2.3 Units — the missing families

Verified absent from `UNITS`/`ALIASES`: dynamic viscosity (`P`, `cP` — `Pa·s`
composes but `cP` does not resolve), `Torr` (only `mmHg`), radioactivity (`Bq`, `Ci`),
absorbed and equivalent dose (`Gy`, `Sv`), magnetic flux (`Wb`), catalytic activity
(`kat`, and enzyme `U` / `U/mg` — the product has a whole Assay mode), Rankine (`°R`),
`week`/`year` (Engineering computes over `lifetimeYears`), `cc`/`cm³`, `amu`/`u` for
`Da`, steradian `sr`.

**The photometric invariant holds:** `lm → W` is refused (different `dim`, no shared
`BASE` decomposition — `units.ts:281,232`), as are `cd → lm` and `rpm → Hz`.

### 2.4 Statistics — the gaps a student or reviewer will hit

Verified absent (zero hits): power analysis and sample size (the non-central t, F and
χ² distributions do not exist), Fisher's exact, McNemar, logistic regression,
bootstrap/permutation CIs, Games-Howell, parametric repeated-measures ANOVA, Cox
proportional hazards, autocorrelation/ARIMA/decomposition. Exact permutation p-values
remain normal-approximation only — the continuity correction keeps it respectable
(n=4,4 at U=0 gives 0.0304 vs exact 0.0286), so it is a gap rather than a defect, but
the pane accepts n=2 per group where no exact result can reach 0.05.

Games-Howell deserves its own line: `diagnostics.ts:8-9` and `dunnett.ts:6` both
describe its absence as the defect that motivated them, and `tukey.test.ts:236` now
asserts the name is *not* mentioned. The tool detects unequal variances, names Tukey
as invalid there, and offers only a rank-based fallback. Dunnett's quadrature is the
model to copy. **~200 lines.**

### 2.5 The Word table is a data source for only 10 of 21 stats calculators

GAP §1.1 is **closed**: `buildDataSourceBar` (`taskpane.ts:6243`) wires "Use table at
cursor" and "Open CSV…" into every `block`/`list`/`matrix` field. But
`DATA_FIELD_KINDS` (`:6227-6233`) excludes the `groups` kind, reasoning that "a group
definition takes syntax, not a grid".

That reason is factually false for `chiind`, `multiregress` and `twoway`, whose
"groups" fields are plain rectangular grids. Counting those, **11 of 21 stats
calculators cannot be fed from a Word table** — ANOVA, Tukey, Dunnett, Kruskal-Wallis,
Friedman, survival, log-rank and assumptions among them. That is the product's own
stated wedge, half-built.

### 2.6 Math and numerics — verified still absent

Re-verified by grep and by reading `optimize.ts`, whose only export is `nelderMead`:
interpolation and splines of user data (the 16 `interpolat` hits are colour ramps,
water-property tables and ODE prose), linear programming and constrained
optimization, sparse matrices, clustering, contour and 3-D surface plots,
bootstrap/Monte Carlo, box and violin plots, trendline overlay, dual axis.

One is cheap and self-documented: `taskpane.ts:8385` draws PDE solutions as "a few
horizontal slices" with the comment *"a contour plot is not available here, and
slices are honest about being slices."* **`heatmap.ts` ships**, and `buildHeatmapSvg`
is reachable only through Table→Chart (`tablechart.ts:393`). A 2-D scalar field is a
matrix; rendering the PDE field as a heat map reuses a module that already ships —
as does a correlation matrix in Analyze.

Still correctly open from OPEN-ITEMS P1, all labelled honestly in the code: exact
cubic/quartic radicals (Cardano/Ferrari), symbolic ODEs, units-aware solving, cyclic
integration by parts, multivariate polynomial GCD, DAE index reduction.

### 2.7 Molecular biology — the real builds

Multiple sequence alignment (pairwise only, so a variant against a panel of
homologues is N runs with no consensus or identity matrix); peptide disulfides,
cyclic peptides and modified residues. **Alternate codon tables** are listed here in
OPEN-ITEMS but are really Tier 1: `dna.ts:88` has one `CODON_TABLE` and
`TranslateOptions` has no selector, so a mitochondrial ORF is mistranslated at every
TGA — **~60 lines** of table data plus a selector.

### 2.8 The SnapGene `.dna` reader is still unvalidated — and the risk is nameable

`seqdna.ts:4-18` still says so verbatim, and `src/lib/__tests__/fixtures/` contains
exactly one file, `pubchem-names.json` — **no `.dna` file, and no real GenBank file
either**. The synthetic fixtures were built to the same third-party write-up the
reader was written from, so they test the packet walking but cannot test the
write-up's claims.

Concretely rather than as a generic warning: `seqdna.ts:127-132` pushes the
`<Segment range="a-b">` numbers straight into `FeatureSegment`, which `seqio.ts:14`
declares 1-based inclusive, with no offset applied anywhere. Those agree **only if**
the write-up's convention is right. If it is off by one, every feature on every
imported plasmid is off by one base — on a map that looks entirely plausible. Same for
the circularity bit (`:215`). **One real `.dna` file from a user settles both in ten
minutes**, and `landing/science.html:79` currently sells `.dna` as a peer of GenBank
and FASTA while the module calls it "not the supported path".

### 2.9 Accessibility, budgets, and the pane's testability

| Predicate | Count |
|---|---|
| `aria-*` attributes in `taskpane.html` | 74 |
| `aria-live` regions | 54 |
| `<label … for=` | 55 |
| `role="dialog"` | **0** |
| `tabindex` / `tabIndex` | **1** |
| a11y test files | **1** (`themeContrast.test.ts`, colour tokens only) |

Authoring for screen readers is genuinely good; there is no keyboard or focus story
at all. Separately, `webpack.config.js:48-50` sets `performance: { hints: false }` —
the only size budget in the repo is explicitly disabled — and there are **31** `input`
handlers, **2** `setTimeout` calls and **zero** occurrences of `debounce`, with two
"per keystroke" defects already in KNOWN-DEFECTS. 0.1 and 0.2 are the third and
fourth.

And the pane is now **1.12 MB behind one test file**: `src/lib/__tests__/` has 265
files; `src/taskpane/__tests__/` has one (`homeSections.test.ts`), and it reads
`taskpane.html`, not the TypeScript. 21 test files reference `taskpane.ts` — **all**
via `fs.readFileSync` source-string assertions; **zero import it**. The prior doc's
"759 KB behind one test file" is stale in the wrong direction: the file grew 51%.
Source-text assertions catch the absence of a string; they cannot execute a parser,
and 9 parser-shaped functions live there today — including `readSvgDims` and
`readTableUnderCursor`, both load-bearing. The standing remedy is right: move parsers
to `src/lib` before writing them.

---

## Verified closed, or verified fine — do not re-flag

- **Insert-path figure sizing is correct across the non-Engineering surface.** All 15
  `insertInlinePictureFromBase64` call sites size from the actual SVG — Table→Chart
  (`:3345`), Plot (`:5604`), Stats diagnostics (`:7398`), Spectra (`:23849`), JCAMP
  (`:24001`), Assay (`:25362`), structures, periodic table, gallery. The v2.82.1
  intrinsic-size fix did reach this half. Two ad-hoc readers are fragile rather than
  wrong (`:5087` reaction scheme, `:24745` sequence map: both require adjacent integer
  `width`/`height` and would silently fall back to nominal if a builder emitted a
  decimal); `readSvgDims` is also unanchored, which holds today but is not guaranteed.
- **The global error handler exists**, at `taskpane.ts:952-953`, installed at module
  scope *before* `Office.onReady`, asserted by `tier0Defects.test.ts:181-196`.
- **The dead-export ratchet is honest** at 10, re-derived independently.
- **`probit` is reachable** via `qqPoints` (`taskpane.ts:6497`) — the earlier
  correction still holds.
- **`tablediagram` and `mathOmml.buildMathOoxml` are reachable** (via `buildDiagramSvg`
  at `taskpane.ts:339` and `mathToOoxml` at `mathOmml.ts:142`) — both look dead to a
  name-based scan and are not.
- **Align's multi-record FASTA concatenation is fixed** (`align.ts:189-205`).
- **¹⁹F/³¹P coupling is named and caveated** (`nmr.ts:628-696`) — the old Tier-0 hole is
  closed and verified reaching the UI.
- **`molgraph.ts` has direct tests** (~25). The residual is narrower — see 0.12.
- **Typed error bars ship** (`ErrorBarKind`, SD/SEM/CI95/range/custom, `plot.ts:220-228`,
  declared in the figure at `:745-749`). OPEN-ITEMS 10 is stale on this point — but see
  the stale claim below about the *default*.
- **Finance's sign convention is internally consistent.** The TVM family (`fv`, `pv`,
  `compound`, `loan`, `annuity`, `gann`, `perpetuity`) is magnitude-based with every
  field labelled by role; the discounted-flow family (`npv`, `irr`, `dcf`, `xirr`)
  takes signed flows labelled *"Cash flows (t=0 first)"*. **No pair of calculators
  gives the same labelled input opposite meanings.** It differs from Excel's PV/PMT
  signing, which is a documentation matter, not a defect — though the convention is
  written down nowhere, in source or in the pane, and one header paragraph would fix
  that.
- **Finance's numerical edge cases are handled.** `loanPayment` special-cases rate 0
  (`finance.ts:32`); `annuityPV`/`annuityFV` guard rate 0 (`:37-46`); negative rates
  compute correctly (measured: `loanPayment(200000, −0.01/12, 360) = 476.15`). The one
  hole is EAR with m = 0, which is 0.6.
- **American exercise, dividends and constant vol are disclosed** in both the price and
  the Greeks (`taskpane.ts:5754-5758`, `:5930-5933`), shown under the result and
  carried into the document. `financeDisclosure.test.ts` proves the underlying claims.
  **No American option is silently priced with a European formula.** (The theta
  sentence inside that disclosure is still wrong — 0.7.)
- **Finance is audience-untagged on purpose**, with the past mis-tagging recorded
  in-source at `taskpane.ts:1686-1691`; science users see it, and it is in the search
  index via `calcRegistries()` (`:1890`).
- **The formula library's counts are accurate and every entry parses.** Measured: **19
  categories / 143 formulas**, matching `docs/PUNCH-LIST.md:264`. Sweeping all 143
  through `parseMathAst`, `mathToHtml` and `mathToOmml` threw zero times, and no DSL
  function name leaks as literal text (`braket`, `expval`, `infinity`, `hbar` all
  render). All 19 categories are assigned across `LIBRARY_GROUPS`, so the ungrouped
  safety net at `taskpane.ts:2249-2255` is dormant.

---

## Stale claims — code and copy that contradict the shipped product

- **`plot.ts:208-216`** says every journal requires the error-bar choice to be stated,
  "so the figure states it rather than leaving it to a caption nobody writes" — but
  the **default does not**. `taskpane.html:611` defaults `plot-errbars` to `""`,
  `plot.ts:697` draws bars whenever `p.err` exists, and `:555` gates the declaration on
  `options.errorBars` being set. Out of the box: undeclared error bars in a journal
  figure, the precise thing the comment claims cannot happen.
- **`mathFormat.ts:14-16`** calls stacked fractions, radicals and matrices "a planned
  enhancement" — `mathOmml.ts:19-77` ships all of them.
- **`heatmap.ts:315-317`** — `void niceStep;` "keeps the dependency honest"; the colour
  bar only labels min/max.
- **`examples.ts:404`** promises `circle r=3` → area **9π**; the pane renders
  `area = 9*pi ≈ 28.274334` (typeset π appears only in the inserted OMML).
- **`peptide.ts:139`** — "for a reference/legend in the UI"; no UI consumes it.
- **`dna.ts:428`** describes a skip that cannot occur (0.14).
- **`taskpane.ts:2856`** — "GenBank carries an organism in its source feature" (0.3).
- **`seqdna.ts`** vs **`landing/science.html:79`** — "not the supported path" sold as a
  peer of GenBank and FASTA.
- **`uvvis.ts:13-14`**, **`FEATURES.md:48`**, **`landing/science.html:111`** — the
  out-of-domain refusal that does not exist (0.13).
- **`FEATURES.md:44`** "Structure recognition is exact" (0.11).
- **`taskpane.ts:7570`** "Non-symmetric matrices are out of scope" (0.31).
- **Stale "36 calculators" copy** survives at `taskpane.html:755`, `qc.ps1:81` and
  `scripts/engineering-audit-driver.js:3`; `prefs.ts:13` still says "all 22 tools"
  against 26. The pane tile itself was fixed and is now guarded
  (`tier0Defects.test.ts:172`).

---

## Deliberate refusals — confirmed, do not propose work against these

**Chemistry / spectra:** IR fingerprint region <1500 cm⁻¹ (`ir.ts:12`); aromatic
out-of-plane C–H bends (`ir.ts:292`); fragment ion intensities are a ranking, never an
abundance (`fragment.ts:11`); ring fragmentation needs two cleavages
(`fragment.ts:499`); masses omitted for elements outside the exact-mass table
(`fragment.ts:217`); structure → IUPAC name (`structures.ts:72`); J from geometry needs
a 3-D conformational search (`nmr2d.ts:22`); geminal coupling in diastereotopic CH₂
(`nmr2d.ts:28`); cross-conjugated enones — one scored, stated (`uvvis.ts:157`); ε and
n→π* intensities (`uvvis.ts:16`); fused/heteroaromatic increments approximate
(`nmr.ts:287`); OH/NH/SH as nominal ranges (`nmr.ts:608`); pKa are group averages with
Hammett corrections (`pka.ts:1`); cLogP/logS carry measured RMSE (`properties.ts:78`);
periodic measured properties reported absent with a reason (`periodic.ts:23`); OPSIN is
the one online feature, per-name consent (`taskpane.ts:3993`).

**Molecular biology:** ST.26 DTD validation deferred to WIPO (`sequence.ts:6`);
peptide stereochemistry unspecified rather than guessed (`peptide.ts:5`); FASTA carries
no topology, so none is invented (`seqio.ts:78`); remote-accession locations skipped
rather than mis-placed (`seqio.ts:150`); unreadable locations dropped rather than placed
at a made-up coordinate (`seqio.ts:315`, `seqdna.ts:134`); circular-origin-crossing
features excluded and counted on the figure (`seqmap.ts:269`); Sequence Map shows the
first record and says so (`taskpane.ts:24691`); SnapGene directionality other than 2
read as forward, the safe direction (`seqdna.ts:103`); degenerate codons resolve only
when every expansion agrees (`dna.ts:110`); enzyme table restricted to defined sites
(`enzymes.ts:397`); NCA reports `percentExtrapolated` and warns above 20% (`pk.ts:520`);
primer Tm states its salt assumptions and says nothing about specificity (`dna.ts:411`).

**Statistics:** χ² goodness of fit refuses mismatched totals (`stats2.ts:236`); rank
functions refuse non-finite input (`stats2.ts:134`, `nonparametric.ts:18`); two-way
ANOVA refuses unbalanced designs (`stats2.ts:303`); log-rank refuses 1/2 event coding
rather than inverting it (`survival.ts:220`); k>2 log-rank uses the Pearson
approximation and says so (`survival.ts:296`); Peto HR is explicitly not Cox
(`survival.ts:330`); D'Agostino-Pearson refuses below n=20 (`diagnostics.ts:86`);
rank-deficient designs return `null` (`regression.ts:273`); Tukey warns on zero
within-group variance (`tukey.ts:297`); curve fit surfaces defaulted starting values,
non-convergence and SE > estimate, and states R² is descriptive only (`curvefit.ts:15`);
PCA notes sign arbitrariness and n<3p (`pca.ts:9`); BH over Bonferroni for exploratory
scanning, argued (`insights.ts:46`); Dunn post-hoc withheld unless the omnibus is
significant (`taskpane.ts:6839`).

**Math / topology:** partial fractions refuse irreducible factors of degree ≥3
(`casint.ts:178`); multivariate polynomial GCD not attempted (`cas.ts:41`); Taylor
radius of convergence not computed (`analysis.ts:431`); no exact radicals above the
quadratic (`solve.ts:1089`); cyclic integration by parts and trig-identity integrals
refused, and the message distinguishes "no elementary antiderivative" from "I couldn't
find one" (`taskpane.ts:24371`); removable singularities and quadrature (`solve.ts:2175`);
DAE index ≥2 refused, naming the reformulation (`dae.ts:172`); BVP existence/uniqueness
not settled from numerics (`bvp.ts:342`); inequalities one-variable polynomial/rational
only, refused explicitly rather than falling through (`taskpane.ts:24218`); Jones is not
a complete invariant (`knots.ts:303`); π₁ presented and abelianised, never identified —
Novikov–Boone (`knots.ts:401`, `topology2.ts:479`); homeomorphism undecidable in
dimension ≥4 — Markov (`topology2.ts:486`); complex K-theory only, no real KO
(`alexander.ts:294`); unoriented cobordism only (`topology2.ts:435`); every Serre
differential marked UNDETERMINED (`homology.ts:483`); `wordproblem.ts` returns null
rather than guessing.

**Figures / units:** candela ↔ lumen never interconvert (`units.ts:264`); angle stays
atomic, so a radian never becomes a bare number (`units.ts:409`); no lowercase bit
symbols (`units.ts:171`); no `nm`/`kn`/`mwh` aliases — the Nm and mWh traps
(`units.ts:305`); nested division `a/(b/c)` refused rather than guessed (`units.ts:479`);
trailing zeros in a bare integer are not significant figures (`units.ts:601`); `fps`
means frames per second (`units.ts:286`); a log axis discards non-positive points and
the caller MUST report it (`plot.ts:239`); no volume on a second y-axis
(`candlestick.ts:23`); exact OHLC column matching, positional fallback only when the
invariants verify (`candlestick.ts:64`); no rainbow ramp (`heatmap.ts:9`); non-numeric
cells never counted as zero (`heatmap.ts:101`); greyscale diverging cannot show which
side of the midpoint, and says so (`heatmap.ts:24`); lowercase `m` is not a million
multiplier (`tablechart.ts:99`); `(75.0%)` is +75 (`tablechart.ts:74`); min/max bucket
decimation, never stride sampling (`spectraChart.ts:148`); béziers not half-parsed
(`figure-layout-audit.js:126`).

**Finance:** multiple IRRs — lowest root returned, ambiguity declared as inherent
(`finance.ts:55-62`), premise proven in `financeDisclosure.test.ts`; bond **clean**
price, no accrued interest (`taskpane.ts:5772`); YTM assumes settlement on a coupon
date, flat curve, no default (`:5871`); XIRR uses a 365-day year and ignores 30/360
and ACT/360 (`:5852`); duration and convexity apply to parallel shifts only, not to
callable bonds (`:5895`); implied vol absorbs model error for American and
dividend-paying options (`:5959`); Gordon terminal value is a scenario, not a
valuation (`:5835`); amortisation and declining balance bounded at
`MAX_AMORT_PERIODS = 12000` with the freeze-the-pane reason recorded
(`finance.ts:229-241`). `formulaLibraryMath.test.ts` numerically verifies only the ~40
checkable identities and lists the rest under `UNVERIFIED` rather than implying
coverage. *(One real omission: declining-balance depreciation has no `assumes` at all
— it is neither MACRS nor a switch-to-straight-line convention, both of which a US
filer will assume they are getting. Small fix, and the one place where the missing
sentence changes what the number means.)*

**Document workflow:** bare numerals not matched — they collide with dates and
quantities (`numerals.ts:11`); headings, claims and the abstract never
paragraph-numbered (`paragraphs.ts:11`); no telemetry ever, including crash reports
(`crashReport.ts:15`); caption/reference checks advisory (`refs.ts:7`); settings
localStorage-only (`prefs.ts:1`).

**Product decisions, closed — not backlog:** claim-set hygiene (declined by the user
2026-08-01); Word on the web and Excel (declined 2026-07-27 — offline operation is the
product value); Microsoft AppSource (`README.md:91`); localisation; structure → IUPAC
name.

---

## Corrections to the existing documents

| Doc item | Status at v2.89.0 |
|---|---|
| GAP §0.5 "no global error handler anywhere" | **WRONG — closed** (`taskpane.ts:952-953`, tested). |
| GAP §1.1 "nothing in Stats or Analyze ever reads the Word table" | **WRONG — closed** (`buildDataSourceBar`). Half-built though — see 2.5. |
| GAP §0.2 "Insights reports uncorrected p-values" | **HALF closed.** Correlations corrected; trends were not (0.22), and the table still prints raw p (0.23). |
| GAP §2.6 lists "limits and Taylor series" as absent | **WRONG.** Both ship and are routed (`taskpane.ts:24321`, `:24339`); verified `(1-cos x)/x² → 1/2` exact. OPEN-ITEMS already said so — the newer doc regressed. |
| GAP §2.7 "deploy gate runs 5 of 12 QC gates" | **WRONG count — it runs 4.** |
| GAP §1.7c `probit` correction | **Still correct.** |
| OPEN-ITEMS §3 "molgraph.ts — 0 direct tests" | **WRONG** — ~25 direct tests. Real residual is 0.12. |
| OPEN-ITEMS §4 "`optimize.ts`, `matrixExpr.ts`, `ode.ts`, `mathParse.ts` have no direct tests" | **WRONG, all four** — `optimize.test.ts` (14), `matrixExpr.test.ts` (18), `ode.test.ts` (16), `mathParse.test.ts` (12) all exist. |
| OPEN-ITEMS §6 `linalg.ts` stale eigen comment | **Half-fixed** — corrected in `linalg.ts`, still live in the pane at `taskpane.ts:7570` (0.31). |
| OPEN-ITEMS §10 "typed error bars" missing | **WRONG — shipped.** But the *default* still draws undeclared bars (stale claim above). |
| OPEN-ITEMS §11 "no composition mechanism" | **PARTIALLY WRONG** — `combineSvgs` composes; reword to "no A/B/C labels, no grid". |
| OPEN-ITEMS §13 "ST.26 has no local validation" | **Now wrong as written** — min-length and CDS-frame advisories ship; only DTD validation is absent. |
| OPEN-ITEMS §1 in-Word pass provenance | **RESOLVED**; the doc still reads as open. |
| OPEN-ITEMS §1b "works offline is guaranteed by nothing" | **Accurate, and sharper** — see 2.1. |
| OPEN-ITEMS §9 "every figure is raster" · §12 accessibility | **Still accurate.** |
| OPEN-ITEMS — Align multi-record FASTA | **Fixed.** |
| OPEN-ITEMS — FASTA/GenBank importer | **Shipped** (`taskpane.ts:2823`) and has no entry. |
| KNOWN-DEFECTS "the A tier is empty" | **No longer true.** 0.3–0.8 and 0.11–0.15 are wrong values presented as correct; 0.5, 0.6, 0.7 and 0.8 reach the document. |

---

## Recommended order

**Now — one-line and few-line fixes with disproportionate consequence.**
0.3 GenBank organism (a false statement of record) · 0.5 and 0.6 the two `NaN`
inserts · 0.4 spectra axes · 0.7 the theta contradiction · 0.8 the perpetuity
sentence · 0.9 sequence-audit false alarm · 0.10 assumption checker (2 lines) ·
0.23 correlations table (1 line) · 0.20 the dropped caveats · 0.11 IR halogens
(4 lines) · 0.16–0.19 the display-contract breaches (all tiny) · 0.27 the three catch
blocks · 0.30 the three spreads · 2.1's copy fix · 1.12 the deploy gate.

**Next — stop the bleeding structurally.** 1.1 in full: extend the figure corpus and
the ratchet past Engineering, add a tick-value assertion to `spectraChart.test.ts`,
commit and re-run the fuzzer over all 151 modules, then build the *valid-but-extreme*
sweep that catches 0.1 and 0.2 · 0.1 tick caps · 0.2 Align bound + debounce.

**Then — the remaining wrong numbers.** 0.12 NMR carbonyl null + the 4 missing
assertions · 0.13 UV-Vis out-of-domain gate · 0.14 primerTm · 0.15 limit precision ·
0.21 dose/binding caveats · 0.31's bond-maturity and IRR-range disclosures.

**Then — Analyze's data path, one coherent piece of work.** 0.24 delegate to
`parseDelimited` · 0.25 count dropped cells · 0.22 correct the trends · 2.5 the
remaining 11 stats calculators.

**Cheap and visible, any time.** 1.3 the four invisible capabilities (hint text,
minutes each) · 1.8 the eleven library exponents and the palette snippet · 1.7 the
parser input fixes · the `xnpv` calculator in 1.1.

**Strategic, pick by audience.** Effect sizes, Fisher's exact and Games-Howell (1.4,
1.5, 2.4) for the student audience · GenBank features on import (1.6), alternate codon
tables and one real `.dna` file (2.8) for the biotech patent audience · the offline
service worker (2.1) if the students' promise is to be kept · log axes and error bars
in Table→Chart (2.2) and the contour/heat-map reuse (2.6) as the cheapest visible wins
in the figures and math halves.

---

## Remaining after the 2026-08-05 fix pass

Tier 0 and Tier 1 are closed. Recorded here so the next audit does not re-derive
what was deliberately left.

- **0.29 — the TOA multi-flush.** Unfixed. It is a real half-apply risk, but it is
  the Citations feature, which this audit deliberately did not scope, and the fix
  is a restructure rather than a guard.
- **22 figure-layout defects.** The new `check:figures` gate covers 13 chart
  modules (was 4) and 135 figures, and it FOUND these: legend truncation that cuts
  to a character count without measuring the available width, a JCAMP instrument
  title that is never measured, beam value labels drawn on the curve, Bohr shell
  labels 1.7 px off the canvas from uranium up, unclamped circular-map feature
  labels, and a persistence ε-axis drawn through its own tick. Each is recorded
  with its cause, and the gate now fails on any change to them.
- **TOA is quadratic in unbroken-token length.** A realistic 99k-character brief
  returns in 2–4 ms; `"A".repeat(40000)` takes 1.6 s. The trigger is a long run of
  non-whitespace (a base64 blob, a pasted sequence), not document size — which
  makes it much weaker than the raw measurement suggests.
- **Heteroaromatic λmax is refused, not predicted.** Furan, pyridine, caffeine and
  riboflavin no longer claim benzene's 254 nm. Predicting their real values is a
  data question this product forbids, so the refusal *is* the correct outcome.
- **`fuzz:extreme` findings beyond `tablediagram`** are mostly multi-argument
  shape abuse — the fuzzer fills every parameter with the same value. The
  single-argument list is worth a pass of its own.
- **All of Tier 2.** Those are features, not defects, and none was in scope.
- **Wall-clock assertions flake under heavy parallel load.** `homology.adversarial`,
  `energy.adversarial` and `passiveAndParsers` each went red once during this work
  and passed in isolation immediately after, with no diff to the module under
  test. They assert on `Date.now()` deltas — the right property (a function that
  hangs does not return a wrong answer, it does not return), with thresholds
  already 100–500× the real cost. The reds only appeared while six agents were
  saturating the CPU, a condition CI and normal use do not have: the last four
  full-suite runs were green at 9,321 / 9,328 / 9,331 / 9,332 tests.
  **Deliberately not loosened** — raising a budget to chase load this repo
  created would weaken a genuine guard. The durable fix is to assert on an
  operation COUNT rather than elapsed time, which one agent already did for its
  own IRR bound; doing that for the remaining timing assertions is a small,
  worthwhile piece of work and is recorded here rather than done in haste.

### Raised late, and it should outrank most of Tier 2: only Engineering draws

Found on 2026-08-05 while closing the above, and **re-verified from source because
the first report of it was wrong in a load-bearing way.** The corrected count:

| Mode | Calculators | Return a figure | Can insert it |
|---|---|---|---|
| Engineering | 130 | **130** | yes, ratcheted at 130 |
| Statistics | 21 | **3** | **yes** — `insertStatsChart()` behind its own button |
| Analyze | 23 | **0** | n/a |
| Finance | 24 | **0** | structurally impossible |

The original report claimed Stats figures "never reach the document", citing the
`StatOutput.svg` comment that said *"Display only: `text` remains what gets
inserted"*. **That comment was stale** — an "Insert chart" button shipped after
it was written — and it is now corrected in place. A wrong comment produced a
wrong audit finding, which is the same failure this document catalogues eleven
times over.

What survives, and is real: **Analyze draws nothing at all (0 of 23) and Finance
cannot** — `FinCalc.compute` returns a bare `string`, so there is no channel to
carry a figure without changing the type. Meanwhile `landing/index.html:956` and
`:1053` promise *"Results come back as editable tables and charts"* and *"editable
Word tables and charts, not flat images"* for exactly these modes. That is an
overclaim on a shipped page.

This is **wiring, not new capability**: `EngCalc.compute` already returns the same
`AnalyzeOutput` type Analyze uses, and thirteen chart modules ship. Three pieces —
give `FinCalc.compute` a figure channel, populate `svg` in Analyze/Stats
calculators, and extend the figure ratchet past Engineering
(`engineering-audit-driver.js:37` hardcodes `sel.value = "engineering"`) or it
rots the way this did. It is a multi-release campaign in `taskpane.ts` and is
**not started**; it is recorded here as the top-ranked item of the next cycle,
above the remaining Tier 2 work.
