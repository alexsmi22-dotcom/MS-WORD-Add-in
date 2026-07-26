# JurisLab — Full Product Evaluation

**Audited 2026-07-26 against v1.88.0.** Six parallel audits covering the chemistry,
life-science, numerical and legal suites, the task pane, and the engineering
infrastructure. Every claim below was checked against the source; the highest-severity
findings were then re-verified independently, by executing the actual regexes and by
walking the import graph, before being written down.

**Method note.** This project has repeatedly been burned by claims of *absence* that
turned out false — a feature existed under another name, or was reached through another
module. So every "missing" item here records what was searched for, and anything not
confirmed is written as "not found (searched: …)" rather than "missing". One audit claim
was rejected on exactly these grounds: `ppt.ts` appears unreachable to a static import
walk but is reached through a dynamic `import()` at `taskpane.ts:2538`.

**Items struck through have since been fixed.** The original finding is left in
place rather than deleted, so the record shows what was wrong and when it closed.

Effort: **S** = hours · **M** = days · **L** = weeks.

---

## The ten that matter most

| # | Finding | Area | Effort |
|---|---|---|---|
| 1 | Pasting FASTA into Align/DNA — which the pane explicitly invites — folds the **header letters into the sequence** and flips DNA to protein scoring | Life science | S |
| 2 | ~~Landing pages promise the OPSIN lookup "asks every time". It asks **once per session**.~~ **FIXED v1.92.0** — consent is now per name | Truthfulness | S |
| 3 | ~~GitHub Pages deploys on every push with **no quality gate**~~ **FIXED v1.92.0** — deploy now needs a gate job | Infrastructure | S |
| 4 | Four finished, tested modules plus nine assay functions are **dead code** a user cannot reach | Product | S |
| 5 | A user-supplied `/codon_start` is written to the ST.26 XML but **ignored** when generating `/translation` | Life science | S |
| 6 | ~~The two headless gates report **PASS when they silently skip**~~ **FIXED v1.92.0** — skip exits 2, qc reports SKIPPED | Infrastructure | S |
| 7 | Caption detection is `\n`-anchored; Word's text is `\r`-delimited, so the check always reports clean | Legal | S |
| 8 | Numeral gap detection invents dozens of phantom "skipped" numerals on any 100-series spec | Legal | S |
| 9 | 14 insert paths **overwrite the user's selection** | Pane | S |
| 10 | Restriction cut coordinates are wrong on the reverse strand — every Golden Gate enzyme | Life science | S |

**All ten are S.** This product's problem is not that the hard things are missing — the
hard things are built, and built well. It is that finished work is unreachable, correct
work is ungated, and a handful of small defects sit in the highest-traffic paths.

---

## P0 — Wrong today, and cheap to fix

### 1. ~~The privacy claim on the public site is false~~ — **FIXED in v1.92.0** ✔ *verified directly*
The OPSIN consent gate sets `opsinConsentedThisSession = true` on first approval and
every later lookup in that pane session goes straight through. The code comment says so
plainly: *"once consented, subsequent lookups go straight through"* (`taskpane.ts:3028`).

Two published pages state the opposite, in the exact language a confidentiality-sensitive
reader relies on:
- `landing/legal.html:74` — "The one optional online lookup **asks every time**…"
- `landing/science.html:113` — "…an optional IUPAC name lookup — **asks every time**…"

A patent attorney who consents once for `benzene`, then types a real client compound and
clicks the same button, sends it with no prompt. The consent dialog's own warning —
"Don't do this for confidential compound names" — never appears again that session.

**Fix:** either prompt every time (matching the copy), or change the copy *and* show a
visible, revocable "online lookup enabled this session" state in the pane. Given the
positioning, prompting every time is the honest default.
**Evidence:** `taskpane.ts:274, 832, 3028-3040`; `landing/legal.html:74`; `landing/science.html:113`.

### 2. ~~Production deploys with no quality gate~~ — **FIXED in v1.92.0** ✔ *verified directly*
`pages.yml` triggers on push to `main` and runs only `npm ci && npm run build` before
publishing `dist/`. `ci.yml` runs five gates in a **separate, concurrent** job, and
nothing consumes its result — no `needs:`, no `workflow_run`. A commit that fails
`npm test`, `validate:compounds` or manifest validation still reaches production, because
webpack fails only on type errors.

The live `/manifest.xml` and `version.json` — the user update trigger — ship regardless.
**Fix:** gate the upload step on the CI job.
**Evidence:** `.github/workflows/pages.yml:7-9, 33-34`; `.github/workflows/ci.yml:17-27`.

### 3. Three finished modules are dead code — **S** ✔ *verified directly*
Walking the import graph from both pane entry points: **74 library modules, 70
reachable.** These three have zero references anywhere outside their own tests:

| Module | Lines | Has tests | What the user loses |
|---|---|---|---|
| `tukey.ts` | 273 | yes | ANOVA has **no post-hoc test** — the exact 40%-false-positive failure the module's own header warns about |
| `fftfilter.ts` | 182 | yes | The FFT tool shows a spectrum it cannot filter |
| `jcamp.ts` | 318 | yes | Every Spectra caveat says "verify against an acquired spectrum" — the reader for one exists, unwired |

Wiring all three is hours, not days, and is almost certainly the best value-per-effort in
the product. This also warrants a permanent gate: a test that every `src/lib/*.ts` is
reachable from an entry point, with an explicit allowlist for dynamic imports.
**Evidence:** `grep -rn "tukey\|fftfilter\|jcamp" src/taskpane/` → nothing; no non-test importer.

### 4. ~~The two gates that see rendered output can pass vacuously~~ — **FIXED in v1.92.0**
`render-check.js` and `check-landing-overlap.js` both `return 0` with a `SKIP:` log when
no Chromium is found, and `qc.ps1` records that as **PASS** and prints "ALL AUTOMATED QC
PASSED". These are the only two gates that see the real pane and the real laid-out page —
the two bug classes this repo keeps shipping. On any machine without Edge at a hardcoded
path they check nothing and say everything is fine.
**Fix:** exit 2 on skip; render a distinct `SKIPPED` state that is not "all passed".
**Evidence:** `scripts/render-check.js:72-75`; `scripts/check-landing-overlap.js:101-105`; `scripts/qc.ps1:42,47,80-82`.

### 5. ~~`SECURITY.md` is materially false, and cites a CI check that does not exist~~ — **FIXED in v1.92.0**
It claims "no external API calls" and that office.js is "the only network request", and
attributes this to a source scan in CI. There is no such scan. The app reaches three
destinations: `appsforoffice.microsoft.com` (every load), same-origin `version.json`
(every pane open, automatic, no consent), and `www.ebi.ac.uk/opsin` (user-triggered).
**Fix:** rewrite the data-flow section, then add a test that greps the source for network
primitives and fails on any destination outside an allowlist — which would make the claim
true rather than merely asserted.
**Evidence:** `SECURITY.md:12-17, 52-53`; `src/lib/opsin.ts:56`; `taskpane.ts:1024`.

---

## Legal & patent drafting

### 6. Caption detection never matches in a real Word document — **S** ✔ *verified by execution*
`extractCaptionNumbers` anchors on `(?:^|\n)`. Word returns paragraph marks as `\r`.
Executed against `"DRAWINGS\rFigure 1…\rFigure 2…"` the function returns `[]`; the same
text LF-delimited returns `[1,2]`; adding `\r` to the anchor returns `[1,2]`.

Two failures at once: **Refs → Check captions always reports clean**, including when
captions really are duplicated or skipped; and **Audit lists every `Fig. N` in the brief
as "referenced without a caption"** — a wall of noise the user learns to ignore. The
codebase already knows about `\r`: `toa.ts:359` splits on `/[\r\n\v]+/`.
`audit.test.ts:33-36` asserts the false positive as intended behaviour, so the suite can
never catch this.
**Evidence:** `src/lib/refs.ts:39`; consumed at `audit.ts:115`, `taskpane.ts:4229`.

### 7. Numeral gap detection fabricates skipped numerals — **S** ✔ *verified by execution*
`reconcileNumerals` infers one global step and walks min→max. A perfectly ordinary
multi-embodiment spec numbered 10, 12, 14 (FIG. 1) and 100, 102, 104 (FIG. 2) reports
**42 phantom "skipped numerals"** — 16, 18, 20 … 98. One run like that and the drafter
stops trusting the tool.
**Fix:** cluster by hundreds-band before walking, or report gaps only within a contiguous run.
**Evidence:** `src/lib/numerals.ts:107-114`; surfaced at `audit.ts:81`, `taskpane.ts:3630`.

### 8. The callout regex treats years and list markers as reference numerals — **S** ✔ *verified by execution*
`CALLOUT_RE = /\((\d+)[A-Za-z']?\)/g` has no range or context filter. On
`"a widget (10). See Alice, 573 U.S. 208 (2014). Steps: (1) first, (2) second."` it
returns `[10, 2014, 1, 2]` — three of which the audit then reports as "called out but
undefined". Combined with #7 the audit's headline number is meaningless.
**Fix:** ignore 1900–2099, and optionally anything far outside the numeral table's range.
**Evidence:** `src/lib/numerals.ts:39`; the docstring at `:42-43` names the risk and nothing filters for it.

### 9. The native TOA marks only full-form citations — **L**
`buildNativeToaHandler` marks occurrences by searching for the full core cite, so
`Alice, 573 U.S. at 216` and `Id. at 217` are never marked. A TOA listing pp. 4, 9 when
the authority is discussed on 4, 9, 11, 14, 15 is defective under most local rules — and
the table *looks* finished. This is the single thing Best Authority is bought for.
**Evidence:** `taskpane.ts:7533`; limitation acknowledged at `toa.ts:310-315`.

### 10. `passim` blanks the page slot for the most-cited authority — **S**
The TOA field is emitted with the `\p` switch, but `PAGE_LIST_RE` accepts only
roman/arabic lists, so Word's `passim` output is skipped and the formatted table shows an
empty page cell. `\p` fires at 5+ references — the leading authority in the brief.
**Evidence:** `toa.ts:678` vs `toa.ts:348`.

### 11. Bare "Rule N" fabricates FRCP entries — **S**
`BARE_RULE_RE` is enabled whenever the document mentions `Fed. R. Civ. P.` anywhere, so
"a Rule 132 declaration", "Rule 131 swear-behind" and "Local Rule 7.1" become
`Fed. R. Civ. P. 132 / 131 / 7` — citations the drafter never wrote, in a table they sign.
**Evidence:** `toa.ts:114-115, 237-239`.

### 12. No `FIG. N` caption style — **S**
`STYLE` offers only `Figure`/`Table`. The Brief Description of the Drawings in a US
application reads "FIG. 1—A perspective view…". The tool is filed under patent drafting
and cannot emit the caption form a US spec uses. The *reference* extractor already accepts
`FIG.` (`refs.ts:75`); only the caption side is narrow.
**Evidence:** `refs.ts:14-17`; dropdown at `taskpane.html:804-807`.

### 13. No USPTO paragraph numbering — **M**
Not found (searched `0001`, `\[00`, `paragraph number`, `paraNumber`, `pgNum` across
`src/**`). Numbered paragraphs are how every US spec is amended and how every office-action
response cites it. Deterministic, unmissable when wrong, and not a competitive claim
against anyone — the cheapest legal-side win available.

### 14. Other gaps worth a line each
- **No U.S. Constitution citation type**, and Word's Constitutional Provisions category (7) and Treatises (5) are unused — `citations.ts:223-443`, `toa.ts:548-564`. **M**
- **Rules and unpublished WL/LEXIS decisions can be *detected* by the TOA but not *inserted*** from the Citations form — asymmetric coverage teaches the user to trust something that isn't there. **M**
- **No Bluebook subsequent history** (`cert. denied`, `aff'd`, `rev'd`) — citing a reversed case with no `rev'd` is the classic embarrassment. **S–M**
- **Reporter table gaps** (`N.W.3d`, `S.E.3d`, `N.Y.S.2d`, `B.R.`, `Cal. Rptr.`) plus curly-apostrophe brittleness in `F. App'x` — produces both false "not a recognized reporter" warnings on correct cites *and* silent TOA misses. **S**
- **Findings are dead text** — no way to jump from an issue to its place in the document, though `body.search().select()` is already used elsewhere in the file. **M**
- **Numerals must be typed from scratch** — no bootstrap from an existing spec, which is the realistic entry point. **M**

---

## Numerical & mathematical

### 15. `log()` means different things in different tools — **S** ✔ *verified directly*
Three independent expression evaluators disagree on the same token:
`plot.ts:21` `log: Math.log` (natural) · `stats.ts:288` `log: Math.log10` ·
`solve.ts:42` `log: Math.log10`. So `log(100)` is 2 in Stats and Solve, 4.605 in Plot.
`mod` differs too — true modulo in `stats.ts:321`, JS `%` in `plot.ts:29`. A user who
types one formula in Uncertainty propagation and the same formula in Plot gets two
different curves, silently.
**Fix:** one shared table; the honest choice is to reject bare `log` and require `ln` or `log10`.

### 16. Insights reports uncorrected p-values from an all-pairs sweep — **S**
`analyzeData` correlates every numeric column against every other, then calls anything
with p < 0.05 "significantly correlated" in plain English inserted into the user's
document. Ten columns is 45 tests and ~90% chance of a false positive. `adjustPValues()`
already exists in `stats2.ts:297` and is never called from `insights.ts`.
**Evidence:** `insights.ts:261-267, 311, 313-319`.

### 17. Stats silently discards non-numeric input and changes n — **S** ✔ *verified directly*
`statList` splits on `/[\s,]+/` then drops anything that isn't a number. `N/A`, `ND`,
`<0.01` and a pasted header row all vanish; and because it splits on commas, a European
decimal `5,1` or a thousands separator `1,234` becomes **two** observations. The two-sample
output prints `t(df)` but never n, so the loss is invisible.
**Fix:** count rejected tokens and surface "3 non-numeric entries ignored".
**Evidence:** `taskpane.ts:4849-4855`, output at `:4949`.

### 18. Trend detection misaligns x when rows are missing — **S**
`insights.ts:273-279` compacts out blank rows then renumbers 1..n, so blanks at rows 3 and
7 regress every later point against the wrong x. `alignedPairs()` two functions away
(`:218-231`) does this correctly for correlations. Slope, R² and p are all wrong, and the
result is inserted as a finding.

### 19. No logarithmic axes anywhere — **M**
Plot, the FFT spectrum, ODE plots and Table→Chart are linear-only (`plot.ts:245-266`,
`niceStep` at `:194`; not found — searched `logScale`, `semilog`, `loglog`, `logAxis`).
Dose–response is *defined* on log₁₀[concentration]: `assay.ts` will fit an EC50 and there
is no way to draw the sigmoid it came from. This is the largest single gap versus Prism.

### 20. Chi-square runs with no validity check — **S**
No warning when an expected cell is < 5, no continuity correction for 2×2, no Fisher's
exact fallback (not found — searched `fisher`, `hypergeometric`). Expected counts *are*
computed at `stats2.ts:209` and used only for the sum. A statistical method applied where
its assumptions fail, silently, is precisely what the product's own honesty rule forbids.

### 21. Solve answers a solvable question with a false statement — **S**
The UI calls `solveEquation(text)` with no variable argument, so anything with more than
one unknown returns `method: "unsolved"` — and the message ternary has no branch for it,
falling through to the literal **"No real roots found."** `F = m*a` solved for `a` is the
commonest engineering ask, and the tool says something untrue.
**Evidence:** `taskpane.ts:6569, 6574`; `solve.ts:666-674`.

### 22. Other numerical gaps
- **No effect sizes or CIs on differences** — journals now require them; `tCritical()` makes it a three-line addition (`stats.ts:146, 159-164`). **M**
- **No assumption diagnostics** — no normality, no variance-homogeneity, no residual or Q-Q plot. `tukey.ts:242` tells the user to "use Games-Howell instead", which does not exist. **M**
- **Nonparametric coverage stops at two groups** — no Kruskal–Wallis, Friedman, McNemar, Dunn; no repeated-measures ANOVA, the commonest life-science design. **M**
- **Regression is simple-linear only** — no multiple, polynomial or weighted fit; `linalg.ts` has QR but no least-squares, so the user cannot assemble it either. **M**
- **FFT applies no window function** and reports peaks to 4 s.f. without stating bin width — leakage can move the reported dominant frequency, plausibly and silently. **S**
- **Units are named categories, not base dimensions** — `J → N·m`, `W → J/s`, `Da → g/mol` all fail as "incompatible", and newton is not defined at all. **M**
- **Unit conversion drops uncertainty and hard-codes 4 s.f.** — converting 5.0 kg yields 11.02 lb, manufacturing precision, though `parseQuantity` already extracts `±`. **S**
- **Plot supports one data series**, no fitted-curve overlay, no error bars on bar charts — so the standard "mean ± SEM with points overlaid" figure cannot be produced. **M**
- **Nelder–Mead says "converged"** with no local-minimum caveat and takes no bounds. **S**
- **No survival analysis** — Kaplan–Meier, log-rank, hazard ratios (not found: searched `kaplan`, `survival`, `logrank`, `cox`). The largest named category absent for a life-science audience. **L**

---

## Chemistry

### 23. A molecular formula silently resolves to one arbitrary isomer — **S** ✔ *verified directly*
`C2H6O` → `CCO` (ethanol, not dimethyl ether). `C6H12O6` → one specific pyranose out of
~16 stereoisomers. Everything downstream — properties, pKa, NMR, MS, the inserted picture —
is then confidently about the wrong molecule.

The library already anticipated this: `renderStructure` returns
`source: "name" | "formula" | "smiles"` *specifically so the UI can say which happened*
(`structures.ts:17`). Uses of `.source` in `taskpane.ts`: **zero**.
**Fix:** when `source === "formula"`, say "interpreted C2H6O as ethanol — paste a SMILES to disambiguate". Hours of work.

### 24. ¹⁹F and ³¹P coupling is silently dropped — **S** caveat / **M** model
`nmr.ts:580` skips any neighbour that isn't carbon; the comment names OH/NH but the guard
drops every spin-½ heteronucleus. ~20–25% of drug candidates contain fluorine, where
²J(H–F) ≈ 47 Hz dominates the multiplet. A fluorinated CH₂ is reported as a clean singlet
or triplet with **no caveat** — unlike every other gap in this module, which is labelled.

### 25. The "this substituent contributed nothing" caveat fires only for aromatics — **S**
`aromaticCaveats` (`nmr.ts:244-282`) is exemplary: an untabulated group triggers an
explicit warning that the shift was computed as if the group were absent. The sp3 path
(`:404`) and the alkene branch (`:497-505`) have the identical failure mode and stay
silent, so an aliphatic sulfone, boronate or silyl just vanishes from the prediction.

### 26. NMR output carries no solvent and no field strength — **M**
`¹H NMR (400 MHz, CDCl₃) δ …` is the mandatory form in every journal SI and patent example
section. Shifts move 0.3–1.5 ppm between CDCl₃ / DMSO-d₆ / D₂O, and OH/NH move far more.
The inserted header is bare (`taskpane.ts:6372`), so the block is not citable as-is.

### 27. Other chemistry gaps
- **No equation balancer, stoichiometry or limiting-reagent/yield calculator** — day-one chemistry and the most-used non-drawing feature in ChemDraw. **M**
- **No InChI/InChIKey offline** — the universal database key; currently only available for compounds you consented to send over the internet. **M**
- **No elemental-composition finder from an accurate mass** — the routine HRMS confirmation step; `massspec.ts` is structure→mass only. **M**
- **Mass Spec has no polarity/adduct/charge-state control** and truncates at 6 isotope peaks with no caller override — a negative-mode user is shown five positive adducts, and a polyhalogenated envelope is cut where the cut looks like the whole pattern. **S–M**
- **No DEPT, no HMBC** — DEPT is nearly free, since CH/CH₂/CH₃ multiplicity is already read exactly off the graph. **S/M**
- **Peptide mode is depiction-only** — no termini, disulfides, cyclisation or non-natural residues, and it never calls the pI/GRAVY code that already exists in `dna.ts:508-540`. **S/M**
- **No logD₇.₄** despite having both cLogP and pKa in the same panel. **S**
- **No salt/counterion handling** — MW, cLogP, tPSA and Lipinski are computed over the salt with no note. **S**
- **Spectra/MS text inserts lose column alignment** — padded to columns then inserted with no font control, while `insertAlignmentText` deliberately wraps in `<pre>` for exactly this reason. **S**
- **Net charge is reported to 2 dp** from flat group pKa values, overstating precision. **S**

**Credit where due.** The chemistry suite's honesty discipline is genuinely unusual:
`specCaveats` is called unconditionally including on the out-of-domain early return, and
every predicted value is labelled at the readout, in the pane copy, in the inserted text
*and* in the image alt-text. The correctness risks above are all cases where a value is
**silently wrong**, not cases where a prediction is mislabelled as fact.

---

## Life science

*Items 41–49 were verified by executing the compiled libraries; observed output is quoted.*

### 41. FASTA headers are folded into the sequence — **S** ✔ *verified by execution*
`cleanSequence` strips punctuation and digits but keeps the header's **letters**.
`taskpane.html:715` invites exactly this: *"Paste plain sequence or FASTA; headers, line
numbers and whitespace are stripped."*

Executed with a normal NCBI header and a 21 nt sequence:

```
pasted as FASTA  -> GIREFNMHOMOSAPIENSACTINBETAACTBMRNAATGGATGATGATATCGCCGCG   guessKind: protein
sequence only    -> ATGGATGATGATATCGCCGCG                                       guessKind: dna
```

35 spurious residues, and `guessKind` flips DNA→protein so a **nucleotide pair is scored
with BLOSUM62**. On two real ACTB orthologue fragments the audit measured hand-stripped
`identity 96.5%, score 267` against FASTA-pasted `identity 86.4%, score 436`. A percent
identity ten points wrong lands in a paper or a specification with no visible symptom.

DNA mode has the same defect via `cleanDna`, and its "ignored invalid characters" line
makes it look handled: a 12 nt sequence under a header becomes 37 nt, shifting GC% from
33.3 to 30.4 and corrupting reverse complement, translation, ORFs, restriction sites and Tm.

**The fix is routing, not new code** — `seqio.parseFasta` already does this correctly and
Seq Map mode already uses it.
**Evidence:** `align.ts:120-122, 131-137`; `dna.ts:39-48`; `taskpane.ts:2891-2903, 3692, 3747, 3865`; `taskpane.html:715`.

### 42. ST.26: `/codon_start` is honoured in the XML and ignored in the translation — **S** ✔ *verified by reading*
`featureInner` skips *adding* `codon_start` when the drafter supplied one, then calls
`translateCds(region)`, which always translates from position 1. Executed on a CDS at
`1..18` with `/codon_start=2`: the feature carries `codon_start=2` beside
`translation=NGMHAC`, the frame-1 product; the correct frame-2 product is `MACMH`.

A sequence listing whose translation contradicts its own reading frame is a substantive
defect in a filed application — caught late by WIPO Sequence at best, a wrong protein of
record at worst. Related: `translateCds` truncates at the first stop with no warning, and
`featureWarnings` checks length-mod-3 but never checks for an internal stop.
**Evidence:** `sequence.ts:142-151, 172-182, 190-203`.

### 43. Restriction cut coordinates are wrong on the reverse strand — **S**
Two defects in `findSites`. The reverse-strand top-strand cut is computed with `e.cutTop`
where it must use `e.cutBottom`, so reverse BsaI at position 11 reports `cutPosition 9`
when the cut is at 5 — off by the overhang, and inverted for the 3′-overhang cutters
BsgI/BpmI/MmeI. **Every Golden Gate enzyme is affected** (BsaI, BsmBI, BbsI, SapI).
Separately the modulo wrap is applied unconditionally, so on a *linear* molecule MboI at
position 1 of 24 nt reports `cutPosition 24` — an in-range coordinate for a cut that does
not exist. Latent only because nothing consumes `cutPosition` yet (#46), which is exactly
why it should be fixed before a digest feature is built on it.
**Evidence:** `enzymes.ts:457, 478, 484`; `enzymes.test.ts:205-213` checks only that reverse hits are *found*.

### 44. Origin-spanning plasmid features are drawn as spanning the whole plasmid — **M**
`buildFeature` takes min/max of the segments and flags `wraps` only when `end > seqLen`, so
the canonical `join(900..1000,1..100)` on a 1000 bp plasmid yields `start:1, end:1000`. On
the circular map that becomes a near-complete ring; on the linear map a full-width bar. An
AmpR, ori or CDS crossing the origin is routine in real vectors, and this is the figure
that goes into a paper. The two renderers also disagree — the linear map drops `wraps`
features with a footnote, the circular map passes them through unfiltered.
**Evidence:** `seqio.ts:328-343`; `seqmap.ts:208`; `seqmapcirc.ts:140-164, 240`.

### 45. `join(complement(a),complement(b))` parses as the forward strand — **S**
`parseLocation` recurses correctly through `complement`, then re-derives the strand by
testing `/^complement\(/` on the **outermost** token only. Both orderings are valid GenBank
for a reverse-strand multi-exon feature and both occur in real files; the result is an
arrow pointing the wrong way in an inserted figure. The module header calls out this exact
risk while the strand derivation bypasses the recursion that gets it right.
**Evidence:** `seqio.ts:169-175`, correct handling at `:130-132`.

### 46. Nine assay functions are dead code, and one caveat asks the user to use them — **S**
`fitInhibition`, `lineweaverBurk`, `eadieHofstee`, `hanesWoolf`, `competitiveV`,
`uncompetitiveV`, `mixedV`, `substrateInhibitionV` and `bufferRatioForPh` are exported and
unit-tested with **zero** references in `src/taskpane/`. The Cheng–Prusoff panel instructs
the user to *"Determine the mode from a Lineweaver–Burk or a full inhibition fit before
converting an IC50"* — advice the product makes impossible to follow, which is precisely
why the historical 11×-too-low Ki bug was dangerous. Adding three `ASSAY_CALCS` entries is
nearly all wiring.

**Note this is a different shape from #3:** these live inside `assay.ts`, which *is*
reachable, so a module-level reachability check will not find them. A complete gate needs
export-level reachability.
**Evidence:** `assay.ts:460-484, 641-650, 667-724`; `taskpane.ts:7009-7014`.

### 47. Dose–response and binding fits silently drop their own caveats — **S**
`mm` and `hill` return `caveats: fit.caveats`; **`dose` (IC50/EC50) and `binding` (Kd) return
none.** `assay.ts` states in the `FitResult` doc that "The UI must show them", and
`commonFitCaveats` is where non-convergence, dof ≤ 0 and >25%-relative-SE parameters get
reported. Dose–response is the most-used panel in the mode and it is the one that prints R²
with nothing beside it — exactly the failure the module was written to prevent. It also has
no plateau-adequacy check and no warning when the user pastes log₁₀ concentrations, where
`fourPL` returns `bottom` for every `x <= 0` and fits a flat line.
**Evidence:** `taskpane.ts:6929-6944, 6955-6967` vs `:6882-6896`; `assay.ts:108-117, 358-392, 496-499`.

### 48. "Primer Tm ≈ 81.8 °C" is printed for a whole gene — **S**
`primerTm(seq)` is called on the entire textarea with no length gate; a 900 nt gene shows a
nearest-neighbour Tm under a heading called "Tools". The two-state NN model is meaningless
above ~50 nt but the readout is indistinguishable from a real oligo Tm. `PrimerTmOptions.sodium`
and `.primer` exist in the library and are not exposed, so the caveat "Tm moves with BOTH —
quoting a Tm without them is meaningless" describes conditions the user cannot set.
**Evidence:** `taskpane.ts:3727-3736`; `dna.ts:274-279, 396-400`.

### 49. Align runs a six-matrix O(n·m) DP on every keystroke with no cap — **S**
Measured: 500×500 = 24 ms / 22 MB; 1500×1500 = 179 ms / 122 MB; **3000×3000 = 577 ms /
660 MB**. Inside an Office WebView with a tighter heap, pasting two plasmid-sized sequences
will hang or crash the pane — and it re-fires on every character. No length guard, no
debounce, no worker.
**Evidence:** `taskpane.ts:926-927`; `align.ts:185-192`.

### 50. Life-science capability gaps
- **No virtual digest** — fragment sizes, band list, simulated gel. `cutPosition` and `overhangLength` are computed and consumed nowhere. ROADMAP claims "restriction-enzyme digestion". Fix #43 first. **M**
- **Restriction search always assumes linear** — almost everything anyone digests is a plasmid; a missed origin-spanning site turns a "unique cutter ★" recommendation into an enzyme that cuts your vector twice. `FindOptions.circular` exists; only the pane control is absent. **S**
- **Only the standard genetic code** — no bacterial/plastid table 11, no vertebrate mitochondrial; and the ORF finder recognises only ATG starts, so a bacterial construct's real ORFs are missed. For ST.26 this means a wrong protein of record. **M**
- **No path from a sequence file into the ST.26 listing** — Seq Map parses FASTA/GenBank/SnapGene into a fully-featured record; Sequence mode has only textareas. A real filing has 20–200 sequences already in GenBank files, re-keyed by hand into a legal document. **M**
- **ST.26 feature editor is 6 keys × 3 qualifiers** with no INSDC vocabulary validation — no `variation`, `regulatory`, `misc_RNA`, `/allele`, `/function`. **M**
- **Plasmid maps show no restriction sites** — the defining feature of a SnapGene map, and `uniqueCutters()` plus the label placer already exist. **M**
- **The map type filter is implemented but not exposed** — and the circular renderer emits the caption *"N features could not be placed — filter by type to see them"*, instructing the user to use a control that does not exist. Only `records[0]` is ever drawn from a multi-record file. **S**
- **Assay fits report SE but no confidence intervals**, no replicates or weighting, no constrained fits (fix Top=100/Bottom=0 for normalised inhibition — the *default* case), no model comparison. "IC50 = 42 nM" without a CI is not reportable. **M**
- **No ε₂₈₀** — an exact arithmetic sum from the sequence, while the "Protein conc. (A280)" panel makes the user fetch it from Expasy and paste it back. **S**
- **Assay data entry is single-line comma lists**, and `loadSelectedTable()` — which reads the Word table the cursor is in — exists and is bound only to the PPT button. **S**
- **Not found** (searched): multiple sequence alignment, primer design/hairpin/self-dimer, codon usage or optimisation, back-translation, CRISPR guide design, Z′-factor plate QC, Schild/Morrison analysis, GenBank or SnapGene *export*.

**Credit where due.** The methylation logic (Dam/Dcm/CpG, blocked-in-context proven against
the actual sequence) is correct and thorough; `kiFromIc50` correctly refuses `mixed` rather
than guessing; `align.ts` uses proper Gotoh affine gaps at EMBOSS defaults and applies U≡T
equivalence consistently; the ST.26 minimum-length exclusion rule is implemented; and
`seqid.ts` reconciliation is wired — through Audit mode, not Sequence mode.

---

## Task pane — architecture, UX, robustness

### 28. 14 insert paths overwrite the user's selection — **S** ✔ *verified directly*
`insertDnaText` uses `Word.InsertLocation.replace` (`taskpane.ts:3851`). It is the shared
insert path for mass spec, spectra, compound name, properties, stats, finance, assay,
solve, analyze, cross-references and SEQ ID refs — 14 call sites. Every other insert in
the product uses `after`. A user with a word selected who clicks "Insert MS data" loses it.
It also sets no in-progress status and drops a second click silently.

### 29. 32 live keystroke handlers, one `setTimeout`, no input caps — **M** ✔ *verified directly*
Measured: 32 `input` listeners, **1** `setTimeout` in 7,951 lines (the search blur), **0**
`maxlength` attributes, and no length guard in the O(n·m) aligner. Typing one character in
the Sequence Map box re-parses the whole file; that box accepts 8 MB. This is the worst
pane-freeze risk in the product.

### 30. The pane has one `<h1>`, zero `<h2>`, and 26 unlabelled sections — **M** ✔ *verified directly*
A screen-reader user picks "Spectra" and the entire body changes with no announcement, no
focus move and nothing to navigate by. No `tabindex` anywhere; no `scrollIntoView`
anywhere; search results bind `mousedown` only — and `taskpane.css:87` defines a
`.search-item.active` style that is never applied, so keyboard navigation was intended and
never landed. Separately there are **48** simultaneous `aria-live` regions, several firing
on every keystroke, which is its own accessibility failure.

### 31. 37 status messages show the user Word's raw exception text — **M**
`GeneralException`, `RichApi.Error: 5001`, `AccessDenied`. A patent attorney reads that as
a crash rather than "the selection is inside a content control". No error-code mapping
exists (searched `debugInfo`, `OfficeExtension`, `error.code` — zero hits).

### 32. No dark mode or Office theme support — **M** ✔ *verified directly*
Zero hits for `prefers-color-scheme`, `officeTheme` or `dark` across the pane's CSS and
TypeScript. In Word's Dark Gray/Black theme and macOS Dark Mode the pane is a hard-white
rectangle. The design is already fully tokenised through six CSS variables, so most of the
work is one `@media` override.

### 33. Four near-identical calculator registries — ~1,935 lines, 24% of the file — **M**
`renderFinanceInputs`, `renderStatsInputs`, `renderAssayInputs` and `renderAnalyzeInputs`
are ~95% identical; the four `populate*Calcs` functions are byte-for-byte identical modulo
names. One `mountCalcPanel({…})` collapses this to roughly 700 lines plus four data tables,
and is the natural first step toward splitting the file.

### 34. Other pane findings
- **Init has no error boundary** — 253 `getElementById` casts with no null check; one renamed id throws mid-init, wiring the first N tools and silently leaving the rest dead. Currently no live mismatch. **S**
- **Nothing survives a pane reload** except four preferences — not even the current mode. The Sequence and Citations forms are worst hit. **M**
- **The status line is a single node after all 25 sections** — in long tools the confirmation lands below the fold, and focus never moves after an insert. **S**
- **Whole-document scans have no progress, no cancel, no size warning** — 8 of them, each freezing the pane behind one static "Scanning…". **M**
- **Section visibility is a hand-maintained 24-line list** — the exact fragility already fixed for the Home branch, which now reads sections from the DOM and is pinned by a test. **S**
- **Undo guidance appears on 2 of ~35 document-mutating operations.** **S**
- **7,951 lines of pane logic behind one 90-line test file** that never imports it. **M**

**Credit where due.** The catch/finally discipline is genuinely good: every one of the 41
`Word.run` blocks has a catch, and all 146 `disabled =` assignments were traced — no path
leaves a button permanently disabled.

---

## Infrastructure, release & documentation

### 35. The live install packs are hand-copied and ungated — **M**
`landing/manual.html:92-93` links users to `install/*.zip`, but `package.ps1` writes to
`release/` — which is gitignored — and nothing copies `release/ → install/`. The staleness
test checks only `release/…`, so on a CI checkout those paths don't exist, the loop
iterates an empty set and the test **passes vacuously**. The one directory that is
committed and linked from the marketing site is checked by nothing. (Currently in sync at
1.88.0.0, by luck rather than gate.)

### 36. README is 23 releases stale and disagrees with itself — **S**
"Status: v1.65.2" at package 1.88.0; "23 tools" in one place and "22 tools" in another
against an actual 25; "2,041 unit tests" against 3,073. The doc-rot gate exists and works —
it just covers `landing/*.html`, `TEST-SCRIPT.md` and `ROADMAP.md`, and README, FEATURES,
USER_GUIDE and DISTRIBUTION sit outside it. Widening the existing gate is cheaper than
writing a new one.

### 37. `render-check` asserts stale floors while the doc-rot test asserts exact counts — **S**
The headless gate uses `>= 22` / `>= 23` with error text saying "expected all 22", while
25 ship. Three tools could vanish and it would stay green. The two gates now disagree about
how many tools exist, and the weaker one guards the product. `ALL_MODES` is pure data,
explicitly designed to be imported for this.

### 38. Only 1 of the 5 published landing pages gets a layout check — **S**
`qc.ps1` calls `check-landing-overlap.js` with no argument, so it defaults to `index.html`.
`manual.html` (55 KB, the page the README calls "start here"), `tool.html` (25 detail
pages), `science.html` and `legal.html` get zero layout coverage. The script already
accepts `--page` and runs everything in one browser launch, so the cost is seconds.

### 39. Release is manual with no runbook, and the documented rollback does not work — **M**
Three git tags against 88+ releases. `DISTRIBUTION.md:157` tells IT that rollback means
restoring a previous release because "every release is a tagged git commit" — there is no
tag for v1.87.0 or any of the last 40. A release today is ten hand-executed steps of which
only four are gated.
**Fix:** `scripts/release.ps1` that bumps all four version sites, tags, packages and copies
into `install/`, plus a short RELEASING.md.

### 40. Other infrastructure findings
- **`npm run lint` is `tsc --noEmit`** — no ESLint or Prettier anywhere, while six files carry `eslint-disable` pragmas suppressing a linter that never runs. No check for floating promises or unused variables in a 7,951-line file. **S**
- **No dependency-security automation** — no Dependabot, no CodeQL, no scheduled scan, no `npm audit` in CI, while SECURITY.md instructs the maintainer to run it by hand. Currently clean. **S**
- **Conditional assertions in 36 of 92 suites** can pass without asserting — 32 one-line `if (…) expect(…)` guards and ~112 nested; the riskiest shape, `if (r) for (const v of …) expect(…)`, passes on both a null result and an empty array. Named examples in `phase6.adversarial.test.ts:330,345,352` and `phase5.adversarial.test.ts:365-370`. **M**
- **Adversarial coverage is 8 of 93 suites and entirely numeric** — the two largest suites in the repo, `citations.test.ts` and `toa.test.ts`, have no adversarial counterpart, so hostile citation strings are untested. Legal output is the one domain where a plausible-wrong answer gets filed with a court. **M**
- **`DISTRIBUTION.md` contradicts webpack** — it tells IT to version the hosting path because "filenames are stable", but they are content-hashed, and versioning the path breaks the same-origin `version.json` fetch and therefore the update prompt. **S**
- **`qc.ps1`'s header documents 7 gates while it runs 8**, and `Invoke-Step` can inherit the previous step's exit code if a command fails to launch. **S**
- **`package.ps1` can ship the test harness** — step 2 copies all of `dist/*` into the hosted pack, and `render-check.js` writes `harness.html` + `driver.js` there. The harness is the real pane with `Word.run` stubbed to a no-op, so it would load and silently discard every insert. CI is unaffected (clean build), local packaging is not. **S**
- **The pane is the one systematically untested layer** — all 74 lib modules have importing tests; `taskpane.ts` has none. The v1.88.0 figure-sizing bug lived exactly there and no gate could see it. **L**

---

## Cross-cutting themes

**1. Finished work that no one can reach.** This is the dominant theme of the whole audit.
Three dead modules (`tukey`, `fftfilter`, `jcamp`); nine dead exports inside the very-much
alive `assay.ts`; a `.source` flag returned specifically so the UI could disambiguate an
isomer and never read; `adjustPValues` sitting one file from the code that needs it;
`dna.ts`'s pI/GRAVY never called by Peptide mode; `FindOptions.circular`, `MapOptions.types`
and `FitOptions.weights` all implemented and never passed; `loadSelectedTable()` bound to
one button of the several that need it; `.search().select()` used once and absent from every
findings list. Two features even *instruct the user* to use a control that does not exist
(the circular map's "filter by type" caption, the Cheng–Prusoff panel's "use a
Lineweaver–Burk fit").

The recurring shape is *the capability exists and the last mile was never built*. It is the
cheapest category of improvement here by a wide margin, and it is systematically
under-harvested. A reachability gate should check **exports**, not just modules — #3 would
be caught by a module-level check, #46 would not.

**2. Gates that work, with edges just past the problem.** `manifestVersion.test.ts` and the
doc-rot block are genuinely good and have caught real drift — everything they cover is
correct, and everything just outside them is stale. Same story with the layout gate (one
page of five), `render-check` (floors, not equality), and the two headless gates that pass
when they skip. Widening existing gates beats writing new ones almost everywhere here.

**3. Three parsers with drifting semantics.** `plot.ts`, `stats.ts` and `solve.ts` each
carry their own expression evaluator; they already disagree on `log` and `mod`.
Consolidating retires a whole class of silent wrongness.

**4. The pane is the weak layer.** 7,951 lines, one namespace, 295 module-level bindings,
essentially no tests, and the two most recent user-visible defects — figure sizing and
selection overwriting — both lived there rather than in any library module.

**5. The honesty discipline is real, and it has holes in exactly three places.** Predicted
values are labelled everywhere, unconditionally, including on early returns. The failures
are not mislabelled predictions but silently wrong values (#23, #24, #25), uncorrected
statistics presented as findings (#16), and one public claim that the code contradicts
(#1). The first thing to fix is the claim, because it is the only one that is a promise
rather than a bug.

---

## Suggested order

1. **Wrong-answer block — one day.** #41 FASTA folding (route both modes through
   `seqio.parseFasta`), #42 `codon_start`, #43 reverse-strand cut coordinates. These three
   put wrong numbers into papers and filed applications *today*, and #41 contradicts a
   promise printed on screen.
2. **Truthfulness and gating block — one day.** #2 privacy copy, #3 deploy gating, #6
   skip-is-not-pass, #5 SECURITY.md. Nothing here is a feature; all of it is the product
   telling the truth about itself.
3. **Harvest the dead code — one to two days.** #4 wire `tukey`, `fftfilter`, `jcamp`, and
   the nine assay functions in #46. Roughly 1,100 lines of finished, tested capability that
   currently ships and cannot be used. Add the export-level reachability gate at the same
   time so it cannot recur.
4. **The `S` legal defects** — #7, #8, #10, #11. Each produces visibly wrong output in a
   practitioner's document, and each is small.
5. **The `S` correctness set** — #15 `log`, #17 stats input, #23 isomer ambiguity, #28
   selection overwriting, #47 missing fit caveats, #48 primer Tm gate.
6. **Gate-widening pass** — #36 README, #37 render-check floors, #38 all five landing pages,
   #35 install packs. A day, and it stops the next round of drift.
7. **Then the `M` capability work**, chosen by audience: log axes (#19) and effect sizes
   (#22) for scientists; virtual digest (#50) and circular restriction search for
   molecular biologists; USPTO paragraph numbering (#13) and TOA short forms (#9) for
   attorneys.
8. **The pane refactor (#33, #34) last**, because everything above is cheaper and because
   the calculator-registry consolidation is what makes the rest safe.

---

## A note on what this evaluation is not

It is not a verdict that the product is weak. The depth here is real and unusual: exact
symbolic differentiation, a stiff ODE solver with an auto-switching integrator, Gotoh
affine alignment at EMBOSS defaults, Hammett-corrected pKa, Francis double-shift QR
eigenvalues, a native Word TA/TOA field implementation, methylation-aware restriction
analysis, and an honesty discipline that labels every prediction unconditionally — in the
inserted text *and* the image alt-text.

Almost every finding above is a **last-mile** problem: something built correctly and then
not connected, not gated, or not told the truth about. That is a far better position to be
in than the reverse, and it is why the top ten are all hours-not-weeks.
