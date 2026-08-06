# Deep-dive findings still OPEN — 2026-08-05, at v2.92.0

Four independent adversarial passes plus both fuzzers swept the v2.90.0 work
(the 2026-08-05 gap analysis and the chart campaign). Most findings were fixed
and shipped in v2.90.1–v2.92.0. **This file is the remainder** — every one
verified by execution by the reviewer that found it, and none of them fixed.

Recorded because the alternative is rediscovering them. Nothing here is
speculative; each has a concrete reproduction.

Status at the time of writing: suite 289 files / 9,455 tests, 14/14 QC gates,
v2.92.0 live. **Figures were verified in real Word by the user at 2.90.1**
(`TEST-SCRIPT.md` §0ay). Solve is under test by the user.

---

## A. Figures that mislead (numbers correct, picture not)

Ranked. None produces a wrong number; each hides or distorts the answer.

1. **`multcomp` / `eigen` / `svd` — a linear axis destroys a decade-spanning
   quantity.** Measured on `p = 1e-8, 1e-5, 0.001, 0.02, 0.4`: six of ten bars
   render at exactly the 1px floor while one is 188px. The chart's stated
   purpose is to show "how far each p moved". Same for singular values
   (14.0, 1.0e-4, 7.1e-6 → 242px, 0.8px, 0.8px), where the decay IS the answer.
   `groupedBarSvg` and `hBarSvg` have no log option; adding one is the fix.
   **Note the honest constraint:** symmetric eigenvalues can be negative, so a
   log axis is invalid there — that one may have to stay linear and say so.

2. **`efficiency` — the comparison bar is invisible on DEFAULT inputs.**
   kcat/Km = 1500 against a hard-coded 1e9 diffusion limit renders 0.8px vs
   208px, so two enzymes three orders apart look identical. Also: the title
   asserts `M^-1 s^-1` while no field carries units.

3. **`survival` — the curve stops at the last EVENT, short of the follow-up the
   table reports.** On the shipped default the curve ends at t = 18 while the
   table lists risk sets at t = 20 and 24. No censoring marks are drawn at all,
   so six censored subjects are indistinguishable from none.

4. **`insights` — a constant numeric column vanishes from the correlation
   matrix with no note.** `x,y,k` where k is constant: the text summarises k as
   numeric, the figure is 2×2. Axis order is strongest-pair-first, not column
   order.

5. **`logrank` — a group with no events draws a legend entry and no curve.**
   `kaplanMeier` returns a one-point curve; the legend still names it.

6. **`beer` / `na260` — a negative reading sits off its own calibration line.**
   The sweep is `0 … |x|·1.6`, always positive; a blanked-spectrophotometer
   reading of A = −0.65 puts "your reading" in the third quadrant while "the
   law" is drawn in the first.

7. Smaller: `twosample` box labels read "group 1 / group 2" against fields
   labelled "Group A / Group B"; `trapz` plots y and the running integral on one
   axis labelled "y"; `hh` with `acid = 0` prints the sentinel but does not set
   `ok: false`, so an unmarked buffer curve still renders.

## B. Gates that buy false confidence

The instrument is only as good as its ability to fail. These were proven weak
by mutation testing — a mutant was built, and the gate stayed green.

1. **The per-registry ratchet counts PRESENCE, not drawing.**
   `pane-audit.js` filters on `preview\[fig=[1-9]`, which is `countRoots`.
   `blankFiguresNow()` exists and is computed in the DEFAULT pass but is never
   consulted by the ratchet. Wire it in.

2. **`threw()`, `badNumbers()`'s Infinity/undefined branches, and
   `hasControlChar()`'s C1 branch have no negative control.** Six separate
   mutants — including reverting `threw` to the exact historical bug — all leave
   `SELFTEST ok`. The `isBlankFigure` and `countRoots` controls, by contrast,
   caught 4 of 4.

3. **Source-scan assertions check token PRESENCE, not effect.** Green over: the
   ladder's overflow aggregate always summing to zero; the wilcoxon zero-filter
   deleted with the literal surviving in a comment; the stats chart-button line
   moved into a comment (`toContain` is satisfied by a comment); a Solve branch
   wrapped in `if (false)`.

4. **`analyzeSvgFieldIsDead`'s negative control asserts the gate's blind spot.**
   Its regex misses `return { text: "t", svg: chart };` inline, and the test at
   the bottom asserts `.toBe(false)` for that form — enshrining the miss.

5. **`financeFigureFidelity` "the rows always add up" is a tautology** — it
   never calls `cashFlowLadderSvg`, it re-implements the sum in the test body.

6. **`assumptionNotesInsertable`'s call-site scan is a 2-line window** matching
   any `.map(plainDashes)`, so an unlaundered call with an unrelated
   `.map(plainDashes)` on the next line passes.

7. **The stats chart-button invariant is not enforced end to end.**
   `insertStatsChart`'s `finally` re-sets `statsInsertChartBtn.disabled` from
   `currentStatsSvg` alone, without `insertable`. The `toContain` guard cannot
   see a second assignment.

8. **`CORPUS_FLOOR` is a count, so a figure can be REPLACED with no gate
   noticing** — delete one and push `<svg><text>x</text></svg>` and it stays
   green at 139. Only the 22 allowance-named figures are pinned by name.

9. **`solveAndUvvisDraw` reintroduces the fixed-window bug it documents fixing**
   — `PANE.slice(at, at + 4000)` over-runs `solveFunctionSvg` (3,039 chars) by
   961 characters into `updateSolve`.

10. **`audit:pane` is not on the `pages.yml` publish path** (only inside
    `qc.ps1`), and it has no dist-freshness assertion — run standalone it audits
    whatever `dist/` happens to hold.

## C. What the pane audit structurally cannot see

Worth stating plainly rather than rediscovering. It drives DEFAULT inputs, plus
a one-at-a-time `<select>` sweep, an all-blank pass and an all-`"abc"` pass.
Invisible by construction:

- any defect needing a non-default numeric or text value, or two non-default
  options together;
- data-shape branches — n < 2, one row, all-equal, constant, negative,
  fractional, huge. **Every finding in `financeFigureFidelity` is in this
  class**, found by hand;
- wrong numbers (nothing compares against a reference), wrong units, wrong
  scale, a figure contradicting its own text;
- wrong picture BYTES — the mock ignores the base64, so `pics === figures` holds
  even if every picture were blank;
- alt-text content, figure dimensions, blank panels inside a combined figure;
- renamed or duplicated calculators (a count, not a name list);
- everything outside the four registries: Engineering, Solve, Spectra, Chemical,
  Citations, TOC, Sequence Map, Align;
- whether Word honours any of it. Only `TEST-SCRIPT.md` can answer that.

## D. Manual pass still outstanding

`docs/TEST-SCRIPT.md` §0ay-2, §0ay-3 and §0ay-4 — figure-versus-text fidelity,
what must stay un-insertable, and the shared insert path (whose contract changed
across ten modes). §0ay-1 passed at 2.90.1.

## E. Known limits, not defects

- Solve's `sin(x) = 0.5` reports several hundred roots from a wide numeric scan
  — correct, useless. Wants a bounded window.
- Word-problem recognisers are deliberately narrow; an unknown phrasing gets an
  honest refusal. Widening is cheap now the structure exists.
