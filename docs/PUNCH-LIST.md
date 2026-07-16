# JurisLab — Punch List

From the full-product audit, 2026-07-15 (v1.65.2). Ordered by **risk to the
user**, not by effort.

The organising principle: **a plausible wrong number is the worst thing this
product can produce.** It is worse than a crash (which announces itself), worse
than a missing feature (which the user routes around), and worse than an ugly
figure. Everything in P0 is that class of defect. The arginine pKa bug —
net charge +2.00 against a true +1.0, shipped and live — is the proof that this
class is real here, not theoretical.

Status key: `[ ]` open · `[x]` done · `[~]` partially done

---

## P0 — Correctness: wrong answers that can ship

### [x] 1. Verify the compound dictionary against an external source — DONE v1.66.0
**Risk was HIGH. Same class as the arginine bug — and it found the same class of bug.**

All 359 names checked against PubChem by parsing BOTH structures through the same
OCL canonicalizer and comparing ID codes (exact on connectivity — a formula check
alone passes a wrong isomer, since 1-propanol and 2-propanol are both C3H8O). All
101 formulas checked offline against OCL's own derivation.

**Found and fixed — three real defects, all live at the time:**
- `alpha-tocopherol` / `vitamin e` — **wrong molecule.** Two aromatic methyls, but
  alpha is the 5,7,8-TRImethyl vitamer. We shipped beta/gamma-tocopherol:
  C28H48O2 / MW 416.69 against a true C29H50O2 / MW 430.71. A silent 14 Da error
  in Mass Spec, NMR and properties.
- `epsom salt` — anhydrous MgSO4 (MW 120.37), byte-identical to the
  `magnesium sulfate` entry. Epsom salt IS the heptahydrate (MW 246.47).
- `glucose` and `galactose` had **identical SMILES.** Without stereo, C4 epimers
  collapse to the same graph. Two different sugars, one structure.

**Also fixed:** 31 entries carried no stereochemistry, including `naproxen` (the
drug is the (S) enantiomer; (R) is hepatotoxic) and `oleic acid` (no Z — making it
indistinguishable from elaidic acid, a trans fat). arginine and histidine were the
last two caught: their tautomer difference routed them past the stereo sweep, so
two L-amino acids were being drawn achiral.

**The counter-example that matters:** PubChem's record titled "Folate"
(CID 135405876) is the **(2R)** D-glutamate form. Natural folic acid is (2S) —
which JurisLab already had right. Auto-correcting to match PubChem would have
INTRODUCED a bug. Every remaining difference (tautomers, `iron oxide` vs FeO2,
ionic CaO, furanose ribose) is a reviewed, documented exception — not a silenced
failure.

Now gated permanently by `compoundsVsPubChem.test.ts`, which runs offline against
a cached fixture and was verified to FAIL when the tocopherol bug is reintroduced.

### [ ] 1b. Follow-on: the fixture pins PubChem as of 2026-07-15
Re-run `node scripts/verify-compounds-pubchem.mjs --refresh` periodically. New
dictionary entries fail the coverage test until they have a fixture record, which
is the intended behaviour — an unverified name is exactly what this ended.


### [x] 2. Wire `validate:compounds` into CI — DONE v1.66.0
Added as an explicit gate in `scripts/qc.ps1` ("Compound dictionary"). The stronger
structural check against PubChem lives in the jest suite, so it runs on every
`npm test` and every `npm run qc` without a network call.

### [x] 3. Sweep for other "plausible wrong number" sites — DONE v1.71.0
**The shape survived in two places, and both were live.**

#### `carbonylKind` — "ketone" was a dumping ground
Everything the branches above failed to recognise fell through `return "ketone"`
and was handed a ketone's 1715 cm⁻¹ IR band and 205 ppm ¹³C shift:

| input | reported | reality |
|---|---|---|
| `O=C=O` **carbon dioxide** | ketone, 1715 cm⁻¹ | **2349 cm⁻¹** (off by 634), ¹³C ~125 (off by 80) |
| `CN=C=O` isocyanate | ketone, 1715 | ~2270 cm⁻¹ |
| `CC(=O)SC` thioester | ketone, 1715 | ~1690 — **outside** the ketone range [1705,1725] |
| `O=C=C=C=O` carbon suboxide | ketone ×2 | — |
| acyl silane, selenoester | ketone | — |

**carbon dioxide is in compounds.json** under both "carbon dioxide" and the formula
"CO2", so this was reachable by typing CO2 into Spectra. Thioesters cover every
acyl-CoA in metabolism.

Fixed: `thioester` and `isocyanate` added as real classes with their own IR/¹³C
entries, and **the catch-all is gone** — a carbonyl that cannot be positively named
returns null and gets NO band. A wrong band is worse than no band: an absent
prediction is visible, a confident wrong one is not.

#### `classifySubstituent` — the "other" fallback was the SAFE half
"other" gets no increment and is skipped, so it contributes zero. The real damage
was groups that never reached "other" because an earlier branch claimed them:

| substituent | classified as | electronic reality |
|---|---|---|
| benzenesulfonic acid | **SR** (thioether) | −SO₃H **withdraws**, −SR **donates** |
| benzenesulfonamide | **SR** | same — opposite sign |
| nitrosobenzene | **NR2** (dialkylamine) | −N=O **withdraws**, −NR₂ **donates** |
| phenyl azide | **NR2** | azide withdraws |

Not near misses — **wrong-sign** increments, so the predicted shift moved the wrong
way along the axis. Cause: any S without an H returned "SR"; any N that was not
NO₂/amide/NH₂ returned "NR2". Both now demand positive evidence (no oxygens on S;
no oxygen, no multiple bond, carbon-only partners on N) and return "other" otherwise.

And the silent half is now visible: an unrecognised substituent contributed **zero**
to the shift with no warning — predicted as if the group were not on the ring.
`aromaticCaveats` now names the ignored attachment atoms and says the shift is
"predicted as if they were absent".

Both pinned by `carbonylCatchAll.test.ts` (24) and `substituentCatchAll.test.ts`
(25), each asserting the real classes still work so the conservative fallback did
not gut ordinary chemistry.

**Still open from this item:** `tableclassify.ts` heuristic shape detection with a
default — not yet audited.

---

## P1 — Honesty: uncaveated predictions

The product's whole credibility argument is *"it tells you when it doesn't
know."* That argument is only as strong as its weakest screen. A med-chemist who
sees a carefully-caveated NMR prediction next to a bare cLogP will trust **both**
less. The newer modules are scrupulous (nmr.ts: 8 caveats, states ±2–4 ppm); the
older ones have none. **The inconsistency is the problem, not the absence.**

### [x] 4. `properties.ts` — bare cLogP/logS — DONE v1.68.0
The header called them "OpenChemLib's validated models" and returned every number
bare. A reader hears "validated" as "these are right".

**The error figures shipped are MEASURED, not folklore.** `propertiesAccuracy.test.ts`
pins OpenChemLib against tabulated experimental values:

| | n | MAE | RMSE | worst | bias |
|---|---|---|---|---|---|
| cLogP | 20 | 0.33 | **0.42** | 0.97 (ibuprofen) | −0.15 |
| logS | 10 | 0.53 | **0.72** | 1.52 (anthracene) | +0.05 |

So the caveat says RMSE 0.42, not the "±0.5–1.0" rule of thumb this list quoted —
for this set OCL BEATS the folklore, and saying what was observed is better than
repeating what is usually said. The test fails if the claim or the model drifts, so
the number cannot quietly become a lie.

Caveats are tailored to the molecule, not boilerplate: a strongly aromatic input is
told the measured negative bias means its true cLogP is likely HIGHER; a non-organic
is told it is outside every model's training space and that clearing Lipinski's
ceilings "is not a pass". Rendered in the pane via the same `specCaveats` block
Spectra uses — including on the out-of-domain early-return path, which needed them
most and would otherwise have skipped them.

Surveyed and deliberately NOT changed: `pka.ts`. Its caveat already renders
("a group estimate, not a compound-specific pKa") and is carried into the inserted
text. A grep of caveat mentions per lib file suggested otherwise; it was counting
the wrong file.

### [x] 5. `finance.ts` — zero disclosures — DONE v1.69.0
The source was never dishonest: `blackScholes()` is documented as "European option
(no dividends)" right in the file. **But a source comment is not a disclosure.**
The words "European" and "dividend" appeared NOWHERE the user could see them — not
the pane, not the HTML, not the landing pages. Someone pricing an American put got
a number that is simply too low, with nothing on screen to say so.

`FinCalc.assumes` is a new disclosure channel, rendered under the result AND
carried into the inserted text (a number that reaches the document without its
assumptions is the same defect one step further downstream). Eight calculators now
disclose: Black–Scholes, Greeks, implied vol, bond price, YTM, duration/convexity,
IRR, XIRR, DCF.

`financeDisclosure.test.ts` asserts the BEHAVIOUR each warning describes, so the
text stays true instead of becoming decoration:
- put–call parity holds → this really is the European model
- a deep ITM European put prices **more than $5 BELOW** immediate exercise — the
  concrete harm, and the number looks perfectly reasonable
- `blackScholes.length === 6` → there is no dividend input at all
- `[-100, 500, -500]` genuinely has **two** IRRs and `irr()` silently returns one
- duration understates a 200bp move (convexity), as the warning says

Not changed: `normCdf`. An early draft of the test demanded 9 decimals and
"failed" at 0.4999999995 — off by 5e-10, i.e. 200x BETTER than the ~1e-7 its
docstring promises. Testing a spec the code never claimed only manufactures false
alarms. The test now asserts the documented tolerance.

### [x] 6. `assay.ts` — 0 caveats — DONE v1.70.0
**The measured finding is the whole story.** Fit Michaelis–Menten to data whose
highest [S] is 8x BELOW Km, with 5% noise (true Vmax 100, Km 50):

| max[S]/Km | Vmax | R² |
|---|---|---|
| 10 (good design) | 97.8 **± 1.4** | 0.9986 |
| 0.12 (hopeless) | 107.4 **± 41.8** | **0.9986** |

**R² is IDENTICAL.** A user reading "R² = 0.999, great fit" gets a Vmax that is
±39%. Below saturation, MM collapses to v ≈ (Vmax/Km)·[S] — every (Vmax, Km) pair
with the same ratio fits equally well, so the two are not separately identifiable
and the fit picks between them on noise alone. Only Vmax/Km survives (recovered to
2.8% vs Vmax's 7.4%).

`FitResult.caveats` now names it with the user's own numbers, plus: no-convergence
in capitals, degrees of freedom, any parameter whose SE exceeds 25% of itself,
"least squares cannot tell you the model is wrong", "R² is a poor guide for a
nonlinear fit", and "this is a LOCAL optimiser". Rendered in the pane under the
result.

### [x] 9. `assay.ts` tests fit noise-free data — DONE v1.70.0
Folded into #6, because #9 is exactly WHY #6 was invisible. With exact data the
fitter recovers Vmax=100.00 ± 0.00, R²=1.000000 **from the hopeless design** — the
pre-existing tests would never have found this. `assayFitQuality.test.ts` uses a
seeded LCG for reproducible noise and pins the table above, that R² cannot separate
the two designs, that the SE ratio exceeds 10x, and that Hill does not invent
cooperativity (n = 1.0 ± 0.15) from MM data.

**Not done as specified:** the punch list asked for "one real Michaelis–Menten
dataset with known published Km/Vmax". Offline I cannot verify a citation, and
fabricating a "published" dataset would be precisely the sin this audit exists to
catch. Simulated-with-noise recovery tests the same property honestly. Add a real
dataset when a source is at hand.

### [x] 7. `citations.ts` — coverage unstated — DONE v1.70.0
Correction to the audit: this was NOT "0 real caveats". The pane already carried a
visible "Drafting aid — verify against the current Bluebook and court rules". The
:7 line the audit counted was the source header; the HTML disclosed it. What was
genuinely missing was WHICH SUBSET of T10 is implemented.

The pane now states: 50 U.S. states only, with the Rule 10.2.1(f) named-party
exception; territories, D.C. by full name, and foreign jurisdictions are left
unabbreviated and must be checked by hand; an unrecognised jurisdiction passes
through unchanged rather than being guessed at.

`citationsCoverage.test.ts` makes that claim true — Guam, Puerto Rico, Virgin
Islands, Northern Mariana Islands, Ontario and New South Wales all survive verbatim.
A silently INVENTED abbreviation would be worse than a long-form one, because the
drafter could not see it was wrong.

Two things the tests corrected in me, not the code:
- "Smith v. California" keeps "California" — the state IS the party, so Rule
  10.2.1(f) forbids abbreviating it. My first test called that a failure. It is the
  exception working.
- "American Samoa" -> "Am. Samoa", because T6 abbreviates the organizational word
  "American" before T10 is consulted. Correct as far as it goes, but real T10 gives
  "Am. Sam." — a partial form, now pinned so it is a known fact, not a surprise.

Severity, honestly: unlike finance this is not a wrong-number risk. An unrecognised
jurisdiction is left long-form, which a drafter can see.

---

## P2 — Test quality: where the next arginine hides

The arginine bug survived because `pka.test.ts` tested **detection** but never
asserted a **value**. Look for that same shape elsewhere.

### [x] 8. `formulaLibrary` — formulas asserted only to *parse* — DONE v1.67.0
`mathOmml.test.ts` swept every entry through the emitter and asserted only
`.not.toThrow()` — it could not tell `(-b + sqrt(b^2 - 4ac))/(2a)` from `.../(2c)`.

`formulaLibraryMath.test.ts` now translates each shipped `expr` into JavaScript and
**evaluates both sides at random points**. It reads the shipped string rather than a
hand-copy of what the formula ought to say, so it cannot rubber-stamp a typo.

**Result: all 143 formulas are mathematically correct.** No defect found — a real
outcome, not a skipped check. 42 are verified numerically (identities, plus
Black–Scholes against Hull's textbook figure S=42/K=40/r=.10/σ=.20/t=.5 → 4.76, and
the Normal PDF by integrating it to 1). The remaining ~100 are definitions
(`E = m c^2`, `V = I R`) that no arithmetic can verify; they are enumerated in an
`UNVERIFIED` list, and a test fails if any NEW formula is neither verified nor
listed. Silence is not an option.

Proven to fail: sabotaging the real library six ways — quadratic `2a`→`2c`, law of
cosines sign flip, Normal PDF `sqrt(2 pi)`→`sqrt(pi)`, Heron `(s-c)`→`(s+c)`,
`n(n+1)`→`n(n-1)`, and Black–Scholes d₁ `+σ²/2`→`-σ²/2` — is caught every time.

Three formulas are *incomplete* rather than wrong, stated as textbooks state them:
geometric series omits |r| < 1, `Γ(n) = (n-1)!` holds only for positive integers,
and ζ(s) needs Re(s) > 1. Candidates for the P1 caveat sweep, not defects.

**Process note.** The first version of this checker reported 12 failures. All 12
were bugs in the CHECKER, not the library: `s(s-a)` parsed as a function call;
generated loop code shredded by later regex passes; `ln(`→`Math.log(` re-matched
into `Math.LOG(`; and `sum(i=1, n, i) = ...` split on the `=` **inside the sum**,
comparing nonsense. Worst of all, its own corruption probe used C = pi/2 — where
`cos(C) = 0`, so the `2ab·cos(C)` term vanishes and the planted sign-flip bug went
undetected. **A verifier that cannot fail is worse than no verifier**, because it
manufactures confidence. Sabotage-test every gate before trusting it.

### [ ] 10. `molgraph.ts` — 14 exports, **0 direct tests**
Exercised transitively by four predictors, so coverage is real — but a failure
surfaces as a confusing four-module failure rather than a pinpointed one. This is
a diagnosability cost, not a safety gap. Lower priority than it looks.

### [ ] 11. Thin coverage relative to size
- `tablediagram.ts` — 636 LOC / 26 tests
- `plot.ts` — 324 LOC / 13 tests (thinnest of the math modules)
- `ppt.ts` — 308 LOC / 7 tests

---

## P3 — Capability gaps

### [x] 12. Sequence alignment — DONE v1.72.0
Shipped as the **Align** mode (25th tool). Needleman–Wunsch (global) and
Smith–Waterman (local) with **affine gaps** via Gotoh's three-matrix formulation,
at EMBOSS needle/water defaults (BLOSUM62, gap open 10 / extend 0.5; DNA +5/−4).

**Affine, not linear, deliberately.** A linear penalty charges per gap position, so
it scatters short gaps instead of opening one long one — an alignment no biologist
would accept. Pinned: a 10-base deletion comes back as ONE gap run, not ten.

**How it is verified.** Two layers, because self-consistency is not correctness:
1. `align.test.ts` re-derives each reported score from the traceback the DP emitted.
   Catches a broken traceback — the classic failure — but NOT a wrong recurrence.
2. `alignBruteForce.test.ts` computes the true optimum by **exhaustively enumerating
   every possible alignment** of short sequences with an independently written
   scorer, and demands Gotoh match it. A subtly wrong gap rule is perfectly
   self-consistent and still wrong; brute force is the only offline check that
   cannot be fooled. The enumerator is itself checked (Delannoy D(2,2)=13, no
   gap/gap columns, originals recoverable).

**BLOSUM62 is transcribed data**, so it is checked rather than trusted:
symmetry (a transcription slip almost always breaks it), the published diagonal
(W=11 highest, C=9), the [-4,11] range, conservative pairs positive, dissimilar
pairs negative.

**Inserted as MONOSPACE.** An alignment is a column-wise claim — the ruler's '|'
must sit above the residue it refers to — and Word's default proportional font
silently breaks that while still looking like an alignment. That is a wrong figure,
not an ugly one, so insertion goes through insertHtml with an explicit monospace
family rather than insertText.

Caveats ship with it: global vs local failure modes, the scoring parameters, that
"optimal" means highest-scoring under THESE costs and not biologically correct, and
the **twilight zone** warning below ~25% identity where unrelated proteins still
align convincingly.

A bug found in the writing, worth recording: the scorer treated U as T so RNA could
align to DNA, but `percentIdentity` compared raw characters — so AUGCGUACGU vs
ATGCGTACGT aligned perfectly and reported **70% identity**. The score and its own
statistic disagreed. Both now use one equivalence.

### [x] 13. `pka.ts` — missing group classes — DONE v1.73.0
**They were not missing. Four of the five were MISCLASSIFIED** — the arginine bug's
shape again, and the audit understated it. Measured before the fix:

| input | reported | net @ 7.4 | truth |
|---|---|---|---|
| **benzenesulfonamide** | "Aliphatic amine" pKa 10.6 | **+1.00** | acidic ~10 → **~0** |
| **5-phenyltetrazole** | 3× "Aromatic N (pyridine)" 5.2 | **+0.02** | acidic 4.9 → **−1** |
| **barbituric acid** | no sites | **0.00** | acidic 4.0 → **−1** |
| methylphosphonic acid | 2× pKa 2.0 | **−2.00** | 2.4 & 8.0 → **−1.2** |
| benzohydroxamic acid | no sites | 0.00 | acidic ~9 |

**Sulfonamide is the serious one.** A sulfonyl makes its nitrogen ACIDIC; calling
it a base put the net charge a full unit out IN THE WRONG DIRECTION, on a group in
a large share of marketed drugs. Tetrazole (losartan, valsartan, candesartan) was
a full unit out the other way.

Added: tetrazole 4.9 · sulfonamide N-H 10.0 · hydroxamic acid 9.0 · barbiturate
(C5-H 4.0 when C5 bears H; N-H 7.6 when 5,5-disubstituted) · phosphonic acid
2.4/8.0 vs phosphate monoester 1.5/6.3. **Phosphorus is now handled as a whole
group** because successive pKa values differ by ~5-6 units — pushing one site per
-OH at a single pKa is what produced −2.00.

Verified end to end on real drugs: phenobarbital −0.39, vorinostat (SAHA)
hydroxamic acid, sulfamethoxazole's sulfonamide acidic + aniline basic. Controls
(acetic acid −1, ethylamine +1, arginine +1, phenol ~0) unchanged.

**A bug found in the writing:** phenobarbital reported NO site. The ring walk
accepted any size-6 ring atom, so it leaked from C5 into the pendant **phenyl**,
collected 12 atoms, and the `size === 6` check rejected the whole molecule. Walking
only RING BONDS fixes it — the bond joining two rings is not itself a ring bond.
Pinned.

### [x] 14. Enzyme methylation sensitivity (Dam/Dcm) — DONE v1.74.0
The audit called the MspI/HpaII pair "pointless" without a flag. True — but **the
GATC trio was worse than pointless, it was wrong**, and the failure costs a week:

| enzyme | table said | reality |
|---|---|---|
| **MboI** (GATC) | plain isoschizomer, full digest | **BLOCKED by Dam** — on plasmid DNA from any ordinary dam+ strain it cuts **nothing** |
| **Sau3AI** (GATC) | identical to MboI | **ignores Dam** — which is the whole reason to choose it |
| **DpnI** (GATC) | plain GATC cutter | cuts **ONLY** Dam-methylated DNA |

**DpnI is exactly backwards.** Its purpose is site-directed mutagenesis: destroy the
methylated parental plasmid, keep the unmethylated PCR product. The table predicted
it digests a PCR product. Neither failure announces itself — you get an undigested
gel.

Added `Enzyme.methylation` with four effects: `blocked`, `blocked-in-context`,
`required`, `insensitive`. Annotated 12 enzymes: the GATC trio, MspI/HpaII (the
pair now differs), BclI (TGATCA always contains GATC → unconditional), SmaI, and
the context-dependent set (ClaI, XbaI, TaqI, NruI, StuI).

**`blocked-in-context` is checked against the DNA, not asserted from the enzyme.**
ClaI is only Dam-blocked when the flanking bases complete a GATC across its edge
(…**G**ATCGAT…). Warning on every ClaI site would be noise the user learns to
ignore — which is worse than silence, because it devalues the real warnings.
Handles circular sequences, where a methylase site can span the origin.

The data is self-checked: a `blocked` (unconditional) Dam claim must have GATC
inside its own site, a `blocked` CpG claim must contain CG, only DpnI may
`require`, and no enzyme may be both blocked by and requiring the same methylase.

Rendered under the digest table in the pane.

**Still open from this item:** star activity and buffer compatibility.

### [x] 15. `assay.ts` — only one Ki path — DONE v1.75.0
**The single path was worse than thin — it was a wrong-answer generator.**
Cheng–Prusoff is the COMPETITIVE relationship, Ki = IC50/(1 + [S]/Km), and
`chengPrusoff()` applied it unconditionally under a docstring promising "the true
inhibition constant Ki". A non-competitive inhibitor has Ki = IC50, [S] absent:

| [S]/Km | chengPrusoff | true Ki | error |
|---|---|---|---|
| 1 | 50.0 | 100 | **2× too low** |
| 10 | 9.09 | 100 | **11× too low** |
| 100 | 0.99 | 100 | **101× too low** |

A Ki 11× too low makes a compound look **11× more potent than it is** — a
decision-changing error in a screening cascade, from a number that looks fine.

Added: `kiFromIc50(ic50, s, km, mode)` — competitive, uncompetitive,
non-competitive, and **mixed which returns NaN rather than guess** (two constants,
one IC50 → not identifiable). Velocity models `competitiveV`, `uncompetitiveV`,
`noncompetitiveV`, `mixedV`, `substrateInhibitionV`, plus `fitInhibition` over an
[S]×[I] grid. The pane's Ki calculator now has a **mode selector**.

Verified by identity, not just by fitting: every model collapses to Michaelis–Menten
at [I]=0; mixed with Ki=Ki′ IS pure non-competitive; competitive is out-competed at
saturating [S] while uncompetitive is not; non-competitive lowers Vmax by exactly
(1 + [I]/Ki) with Km untouched.

**Two findings worth keeping:**
- Fitting substrate-inhibited data with plain Michaelis–Menten **fails silently** —
  it converges, reports `converged: true`, and returns a Vmax ~30% low, because MM
  has no descending limb to represent the data with.
- Fitting competitive data as **non-competitive also converges**, with a perfectly
  plausible Ki. Only comparing RMSE across modes reveals it. That is why every fit
  now says "the MODE is YOUR claim, not the data's".

**Still open:** tight-binding inhibitors (Morrison's equation) — disclosed in the
caveats rather than silently mis-fitted.

### [~] 16. `dna.ts` — primer Tm — DONE v1.76.0; codon tables still open

**Primer Tm: DONE.** The old method used the Wallace rule below 14 nt and
64.9 + 41(GC−16.4)/N above it. Both see only LENGTH and GC COUNT, so they are blind
to sequence ORDER — and duplex stability IS stacking between adjacent bases. Measured
against nearest-neighbour on 20-mers:

| primer | old | NN | error |
|---|---|---|---|
| `GCGCGCGCGCGCGCGCGCGC` | 72.3 | 79.2 | **−6.9** |
| `ATATATATATATATATATAT` | 31.3 | 26.3 | **+4.9** |
| `TTTTTTTTTTAAAAAAAAAA` | 31.3 | 37.2 | **−5.9** |

**The last two are the whole argument**: same length, same 0% GC, so the old formula
returns the SAME 31.3 °C for both. They really differ by **11 °C**. A Tm that wrong
is a failed PCR or a smear of non-specific product, and the number looked ordinary.

Replaced with SantaLucia (1998) unified nearest-neighbour, salt- and
concentration-corrected (ΔS′ = ΔS + 0.368·(N−1)·ln[Na⁺]; CT/4 for
non-self-complementary, CT/1 when self-complementary). Defaults 50 mM Na⁺ / 0.25 µM,
**both shown in the pane** — a Tm without its conditions is not a fact about the
oligo, and differing supplier defaults are why two people "get different Tm" for the
same primer.

Below 8 nt it falls back to Wallace and **says which model it used**, rather than
applying NN where its initiation terms dominate.

NN_PARAMS is transcribed data (BLOSUM62 class), so it is checked structurally: a
duplex and its reverse complement must melt identically — a slip in any of the 16
keys breaks that. Plus: CG most stable, ΔH and ΔS negative, Tm monotonic in salt,
primer concentration, length and GC.

A legacy test asserted the OLD formula's 51.78 for `ATGCATGCATGCATGCATGC`. It now
asserts **57.68**, hand-verified from the published parameters rather than re-pinned
to whatever the new code emitted.

**Still open:** alternative codon tables (mitochondrial etc.). Lower risk — an
unusual translation is visible as a wrong protein, unlike a Tm that silently fails
a PCR.

### [~] 17. Spectra import (JCAMP-DX) — READER DONE v1.77.0; overlay UI still open
`jcamp.ts` reads real instrument files: XYDATA (X++(Y..Y)) with AFFN/PAC/SQZ/DIF/DUP,
XYPOINTS, PEAK TABLE, multi-spectrum LINK files, XFACTOR/YFACTOR, and kind detection
from DATA TYPE with an X-axis fallback.

**Why ASDF is the whole job.** JCAMP's compression is DIFFERENTIAL. A reader that
treats DIF characters as absolute produces a trace that is wrong from the second
point on **and still looks exactly like a spectrum** — nothing crashes, you just
overlay your prediction against noise and draw a conclusion. So the format's own
checksum (the DIF y-check: each line restates the previous line's last ordinate) is
**verified and reported**, not skipped, and a NPOINTS mismatch is surfaced too.

**Two bugs my own first draft had — both would have shipped a plausible wrong
spectrum:**
1. The tokenizer parsed `0E0` as **scientific notation**. In ASDF, `E` is the SQZ
   character for +5 — so "E0" is the ordinate 50. The whole line collapsed to one
   point. Exponent parsing has no place in an ASDF line; the letters ARE the encoding.
2. **DIF never advanced x.** The `x += deltaX` lived only in the AFFN branch, so
   every differential point stacked at the line's starting abscissa. The trace
   collapsed onto a handful of x values — and still plotted.

Both found by hand-decoding test fixtures from the published tables rather than
pinning whatever the code emitted. 26 tests.

Transmittance is flagged (peaks point DOWN) because overlaying a predicted
absorbance spectrum on a transmittance trace is an easy and invisible mistake.

**Still open:** wiring the reader into the Spectra pane so a measured trace can be
overlaid on a predicted one. The reader is the hard half; the overlay is plumbing.

### [~] 18. Deferred from earlier phases — TUKEY DONE v1.78.0
- **[x] Tukey HSD** — `tukey.ts`. This was a CORRECTNESS gap, not a convenience:
  a significant ANOVA says only "these groups are not all equal", never WHICH. With
  no post-hoc test the user runs repeated t-tests, and 5 groups is 10 pairs — at
  alpha 0.05 per test the chance of **at least one spurious result is 40%**. Tukey
  holds the family-wise rate at alpha.

  The studentized range has no closed form; it is computed by nested quadrature
  (P(Q≤q) = ∫f_df(s)·W_k(q·s)ds over the range-of-k-normals CDF).

  **Verified against a THEOREM, not a table.** A transcribed q table would be the
  same failure mode as BLOSUM62 / the compound dictionary / the NN parameters. So
  instead: **q(α, 2, df) = √2 · t(α/2, df)** — exact for two groups — checked against
  the t distribution already in stats.ts, across df and α. A quadrature bug cannot
  satisfy that at every df by luck.

  That check then paid for itself twice: the first implementation took **10.5
  SECONDS per critical value** (the pane would have frozen). Because the identity
  gave a real accuracy signal, the grid could be cut hard — 25× faster (416 ms, then
  0 ms memoised) with the identity still holding to **1e-5**. Optimising without a
  real check is how you silently degrade a number.

  Caveats warn against the common mistake of Bonferroni-on-top (the p values are
  already family-wise), name the assumption Tukey is NOT robust to (unequal
  variances → Games-Howell), and point at Dunnett when only control comparisons
  were wanted.

- **[ ] FFT filtering** — `fft.ts` has fft/ifft/spectrum/dominantFrequencies but no
  lowpass/highpass/bandpass. Still open.
- **[ ] Exact permutation tests** for small-n rank tests. Still open; the normal
  approximation is disclosed.

### [ ] 19. Smaller gaps
- IUPAC **name generation** (structure→name works only via the 359-name dictionary)
- Reaction **balancing** / stoichiometry (Reaction mode draws, cannot balance)
- `peptide.ts` — no stereochemistry (documented rationale), no modified residues,
  no disulfides, no cyclic peptides
- `massspec.ts` — 15 isotope elements: covers organics, excludes most metals
- `toa.ts` — page numbers omitted (disclosed; native TA/TOA fields are the escape
  hatch)

---

## P4 — Verification debt

### [ ] 20. The `.dna` reader is unverified against a real file
Written from a public reverse-engineering write-up; its tests build synthetic
files **to that same write-up**, which is circular. It fails cleanly by design
and points at GenBank. **Needs one real `.dna` file** to move from "probably
works" to "verified".

### [ ] 21. The in-Word manual pass
**Five tools have shipped since anyone opened the pane in Word** (Sequence Map,
circular maps, `.dna` import, the enzyme display, the audience filter). The
headless render check covers *wiring* — it cannot see layout, styling, insertion,
undo, or document scanning.

`docs/TEST-SCRIPT.md` is current and covers all 23 tools with exact expected
values. ~30 minutes. **This is the highest-value unautomated check available.**

---

## Recommended order

1. **#1 + #2** — compound verification. Highest risk of a live wrong answer, and
   the same class as the bug the audit just found.
2. **#21** — the in-Word pass. Cheapest way to catch what five blind releases may
   have broken.
3. **#4–#7** — the caveat sweep. Half a day, and it protects the credibility
   argument the whole product rests on.
4. **#3 + #8** — hunt the remaining "plausible wrong number" sites.
5. **#12** — alignment. The biggest capability gap, and the one that most
   strengthens the science pitch.

Everything below that is genuine improvement rather than defect repair.
