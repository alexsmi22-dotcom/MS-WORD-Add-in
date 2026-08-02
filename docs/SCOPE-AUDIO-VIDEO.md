# Scope — Audio & video engineering bench

> **STATUS: BUILT.** Units v2.73.0, Audio & acoustics v2.74.0 (7 calcs),
> Video & display v2.75.0 (6 calcs). Engineering is now **100 calculators
> across 18 disciplines**, all live-verified.
>
> **Colour gamut coverage SHIPPED in v2.76.0** on primaries fetched from the
> colour-science datasets, script-extracted and cross-checked (sRGB and Rec.709
> came back identical, as the standard requires). **This scope is complete:
> Engineering is 101 calculators across 18 disciplines.**

Proposed as a **seventeenth Engineering discipline**, on the same
computable-versus-data-blocked test the Energy & power suite passed. Scoped
2026-08-02 against v2.72.0. Nothing here is built yet.

---

## 1. Why it fits, and what it is not

**It is an engineering bench**, not media handling and not codec licensing.
Word's own audio/video support is weak and inserting media does not fit
"compute real numbers into a document"; SEP/FRAND and essentiality analysis are
legal work adjacent to the declined claim-set item. What is proposed is the
arithmetic an engineer writing a specification actually needs: sampling,
quantisation, acoustics, bitrate budgets, colour and display, and quality
metrics.

**The domain is almost entirely computable from first principles.** Verified by
survey: the repo currently has **nothing** for sampling/Nyquist, dB SPL, codecs,
bitrate, colour spaces or acoustics. There is no overlap to work around.

**It serves the stated client base.** Audio/video sits directly on optics
(displays, projection), chips (encode/decode budgets, memory bandwidth) and AI
(inference on video streams) — three of the four domains already built out.

---

## 2. What it builds on rather than duplicates

The foundations are unusually good, which is most of the argument for doing this
one next:

| Existing | Reused for |
|---|---|
| `fft.ts` — windowed spectra, peak-picking (v2.67.0) | audio spectra, spectrogram |
| `fftfilter.ts` — band filtering with ringing caveats | audio filtering |
| `filter.ts` — Butterworth/Chebyshev, emits a `TransferFunction` | crossover and anti-alias design |
| `control.ts` — Bode, poles, margins | filter response analysis |
| `computation.ts` — Shannon entropy, channel capacity, information units | codec rate/limit reasoning |
| `biomed.ts` `samplingCheck` — aliasing | generalise out of the biomedical mode |
| `plot.ts` — log axes already exist | frequency response, all charts |
| `units.ts` — Hz, bit/s, B/s, Pa all verified working | throughout |

**`samplingCheck` is the precedent to follow and the first thing to generalise.**
It is a genuine aliasing check fenced inside Biomedical, exactly the "engine with
one door" pattern the tier-1 work has been unpicking.

---

## 3. Proposed calculators

Written around the results that are **counter-intuitive**, which is the shape
that worked for the vibration module: for a teaching-adjacent tool the value is
in what the user would otherwise get wrong.

### Shared / sampling (4)
1. **Sampling & aliasing** — Nyquist, alias frequency of a given tone, required
   anti-alias corner. *The counter-intuitive part:* an aliased component is
   **indistinguishable** from a real one after the fact — aliasing is the one
   error in the chain that cannot be undone later, which is why the filter goes
   before the converter and not after.
2. **Quantisation & dynamic range** — SNR = 6.02n + 1.76 dB, dither, noise
   floor. *Counter-intuitive:* each bit buys about 6 dB, so 16-bit's ~98 dB is
   not "CD quality is enough" but a specific, checkable headroom budget.
3. **dB conversions** — power vs amplitude (10 log vs 20 log), dBFS, dBu/dBV,
   dB SPL. *Counter-intuitive:* the 10-versus-20 confusion silently doubles or
   halves every figure, and `computation.ts` already had to say this about SNR.
4. **Data rate & storage** — uncompressed rate, file size, transfer time.
   Units already convert.

### Audio (5)
5. **Acoustics: RT60 & room modes** — Sabine/Eyring reverberation, axial mode
   frequencies, Schroeder frequency. *Counter-intuitive:* Sabine over-predicts
   in a dead room; Eyring is the correction, and both need absorption
   coefficients the **user supplies** (see §5).
6. **SPL & inverse square** — level at distance, summing incoherent sources,
   A-weighting. *Counter-intuitive:* two identical sources give **+3 dB**, not
   +6; ten give +10.
7. **Speaker & enclosure** — Thiele-Small basics, port tuning, baffle step.
   Parameters are datasheet inputs.
8. **Crossover design** — order, slope, phase at crossover. Composes with
   `filter.ts` directly.
9. **Wavelength, delay & comb filtering** — path-length difference to notch
   frequency. *Counter-intuitive:* a 1 ms delay notches at 500 Hz and every odd
   multiple; this is why a stray reflection sounds like an EQ change.

### Video (5)
10. **Bitrate budget** — w × h × fps × bpp ÷ compression, with chroma
    subsampling (4:4:4 / 4:2:2 / 4:2:0). *Counter-intuitive:* 4:2:0 is a **50%**
    data reduction, not 25%, because it subsamples both axes.
11. **Resolution, aspect & pixel maths** — pixel count, PPI, viewing distance
    for angular resolution. *Counter-intuitive:* beyond a certain
    distance-to-height ratio, added resolution is invisible — the eye, not the
    panel, is the limit.
12. **Colour space & gamut** — sRGB/Rec.709/Rec.2020 primaries, coverage as an
    area ratio, gamma vs PQ transfer. Chromaticity coordinates are published
    standard values (see §5).
13. **HDR & luminance** — nits, contrast ratio, PQ curve. Needs the photometric
    units in §4.
14. **Quality metrics** — PSNR from MSE, SSIM structure. *Counter-intuitive:*
    PSNR is only comparable **within** one content item at one resolution;
    comparing PSNR across clips is the standard misuse.

### Streaming (2)
15. **Bandwidth & buffering** — startup delay, buffer occupancy, GOP length vs
    seek latency.
16. **Latency budget** — capture → encode → network → decode → display, with
    frame-time quantisation. *Counter-intuitive:* display refresh quantises the
    total, so shaving 5 ms off encode can change nothing at all.

**16 calculators**, which would make Engineering 103 across 17 disciplines.

---

## 4. Units — the pre-wiring probe (done)

Per the runbook rule, probed with `convert()` **before** scoping, because a
missing unit in a default value produces no output and no test failure.

**Already work, verified:** `kHz→Hz`, `Mbit/s→bit/s`, `MB/s→Mbit/s` (= 8),
`GB→Mbit` (= 8000), `ms→s`, `Pa`, `W/m²`, `min→s`.

**Missing — the whole photometric family:** `cd/m²` (nit), `lm`, `lx`, `cd`.
This is **luminous intensity, the 7th SI base unit**, and it needs a new `BASE`
dimension entry rather than just a `UNITS` row. HDR brightness is universally
quoted in nits, so items 12–13 depend on it.

**One of those gaps must STAY a gap, deliberately.** `lm → W` currently returns
nothing, and that is correct: photometric and radiometric quantities are related
by the **wavelength-dependent luminosity function**, not a constant, so 1 W of
555 nm green is 683 lm while 1 W of deep red is a fraction of that. Making them
interconvert would be a plausible wrong answer of exactly the kind this codebase
refuses elsewhere. The right treatment is to keep the dimensions separate and
say why.

Also needed: `fps` (frames/s) — decide whether it is a real dimension or, like
`rpm`, a named unit decomposing to `1/time`. **Watch the alias-collision trap:**
lowercase fallback means a `cd` alias could collide, and `lx`/`lux` need
checking against existing keys.

---

## 5. Data-blocked — take as input, do not tabulate

The steam-table / property-table doctrine applies to three things:

- **Absorption coefficients** for RT60. They vary by material, mounting and
  frequency band; a table typed from recollection would be unverifiable. Take
  per-band coefficients as user input, as `thermo.ts` does with enthalpies.
- **Thiele-Small parameters** — measured per driver, on the datasheet.
- **Codec efficiency factors** — "H.265 is ~50% of H.264" is content- and
  encoder-dependent marketing, not a constant. Take a compression ratio as
  input and say it is an assumption.

**Borderline, and the one worth a deliberate decision:** colour-space
**primaries and white points** (sRGB, Rec.709, Rec.2020, DCI-P3). Unlike
absorption coefficients these are *exact published constants* in ITU and IEC
standards — fixed by definition, not measured. That puts them in the same class
as the NASA polynomials in `flame.ts`: acceptable **if** fetched from a citable
source, extracted by script, and cross-checked in a committed test against
independent landmarks. Not acceptable typed from memory.

---

## 6. Composition opportunities

The pattern that has repeatedly found real bugs (filter → control caught a
latent root-finding defect):

- **`filter.ts` → crossover design** — the analogue designer already emits what
  the analysis tools consume.
- **`fft.ts` → audio spectrum / spectrogram** — windowing landed in v2.67.0.
- **`samplingCheck` (biomed) → the shared sampling tool** — generalise, then
  have Biomedical call the general one, so there is a single implementation.
- **`computation.ts` channel capacity → streaming bandwidth** — the Shannon
  limit is the ceiling a bitrate budget sits under.
- **Optics → display** — étendue and projector brightness connect directly to
  the existing photonics bench.

---

## 7. Sequencing

One discipline per release, as with the four client domains, because that
cadence is what made the optics build reviewable:

1. **v2.73.0 — units first.** Photometric dimension + `cd/m²`, `lm`, `lx`,
   `cd`, `fps`, with collision guards and the `lm→W` refusal test. Nothing else.
   This is the step that silently breaks a whole domain if skipped.
2. **v2.74.0 — shared + audio** (items 1–9), reusing `fft`/`filter`, and
   generalising `samplingCheck` out of Biomedical.
3. **v2.75.0 — video + streaming** (items 10–16), including the colour-primaries
   decision from §5.

Each release: oracle tests against published figures (Nyquist, 6.02n + 1.76,
4:2:0 = 50%, +3 dB for two sources), a **separate adversarial pass**, and the
Word pass section in `TEST-SCRIPT.md`.

---

## 8. What I would not build

- **Actual codec implementations** — encoding/decoding video in a Word pane is
  not a document-authoring capability.
- **Perceptual models beyond SSIM** — VMAF and friends are trained models, not
  formulas; they cannot be honestly reimplemented from a description.
- **Psychoacoustic masking models** — same reason; the published curves are
  large fitted datasets.
- **Media insertion into Word.**
