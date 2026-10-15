# Scope — Audio & video, round two: levels, loudness, timecode, transfer functions, photometry and exposure

_Written 2026-10-14 against the v2.137.0 tree (HEAD `48995d9`, clean). Planned as **v2.140.0**. Line numbers are from that tree and will drift, so each one comes with its function or key name._

_This brief **sits beside** `docs/SCOPE-AUDIO-VIDEO.md` and does not replace it. That file is the record of what v2.73.0–v2.76.0 scoped and built, and it is kept unedited as history. Where the two disagree, this one is current._

_**Sources.** A read-only audit of:_
- _the engines `audio.ts`, `video.ts`, `colourspace.ts`, `biomed.ts` (`samplingCheck`), `units.ts` and `unitSolve.ts`;_
- _the 14 shipped calculators in `ENG_CALCS` (taskpane 12284; `audio-sampling` 23796 … `video-gamut` 24841);_
- _the ratchets `scripts/engineering-audit.js` (+ driver), `scripts/pane-audit.js` and `scripts/check-figures.js`;_
- _the existing tests `audio.test.ts`, `video.test.ts`, `photometricUnits.test.ts` and `colourspace.crosscheck.test.ts`._

_I probed about 260 calls from scratchpad Node scripts loaded through `scripts/ts-require.js`. Solve was driven through the `sym/chain.js` mirror of `updateSolve`. **Nothing in the tree was created or modified** apart from this file._

_**Oracles,** run this session under `python -I` in the scratchpad venv on Python 3.14:_
- _numpy 2.5.4, scipy 1.18.1 (`signal.freqz`, `freqs`, `butter`);_
- _colour-science 0.4.7 (transfer functions, CIE D-series, McCamy);_
- _timecode 1.5.1;_
- _pyloudnorm 0.2.0._

_Every row in §D is labelled by oracle class (§D0). A value re-typed from the same formula is **not** called independent._

_Wrong answers come first. §D is the exit test._

---

## 0. What changed since the original brief

| Original brief said | True today |
|---|---|
| "Proposed as a seventeenth discipline … Nothing here is built yet" (body); "100/101 calculators across 18 disciplines" (status note) | Built v2.73–v2.76. **Engineering is 130 calculators in 20 groups** (`ENG_GROUP_ORDER`, taskpane 11992): Audio & acoustics 7, Video & display 7. The "20th discipline" premise of this round is stale. This is a **deepening round** on two existing groups plus one new group (§B). |
| Photometric family missing; `lm → W` must stay refused | **Shipped v2.73.0** (units.ts 272–295, BASE 428–429): `cd`, `mcd`, `kcd`, `lm`, `klm`, `lx`, `klx`, `nit`, `fps`. `lm↔W`, `cd↔lm` and `nit↔lx` are refused and pinned in `photometricUnits.test.ts`. Still missing: footcandle, foot-lambert, `µPa`, `pW`, `nW`, data-rate shorthands, the case variants, reciprocal units, and fractions such as `1/125 s` (§A, §C0). |
| Units probe "done" | Re-probed today, through `parseMeasured`, because that is the path that produces `NOTHING_INSERTED`. **13 of 57 candidate default strings fail** (§C0). |
| 16 calculators proposed | **14 shipped.** Never built: speaker & enclosure (Thiele–Small), crossover design and SSIM. All three are reconsidered in §A. |
| "Every calculator draws" (v2.89.0) | Still true: the 14 draw (TEST-SCRIPT §0av). `FIGURE_BASELINE = 130` (engineering-audit.js 313) **equals** today's tool count, so it must be raised to exactly 130 + N in the same commit that adds N tools. A forgotten raise lets a non-drawing tool through silently. |
| units.ts last touched v2.73.0 | **v2.137.0 changed it.** It added `dm`, `dm^3`, `cm^3`, and a molarity fix: `M` is now factor 1000 with `mM` = 1 (units.ts 270), because mol/L had read as 1000 M. Relevance here: `M` is molarity, so `M K^-1` (spaced) parses as molarity per kelvin, never as mega-per-kelvin. Mired must not be written that way (§E4). |
| `samplingCheck` should be generalised out of Biomedical | Done differently: `audio-sampling` imports it under an alias (taskpane 578). There is one implementation with two doors. `biomed.ts` stays read-only for everyone. |

---

## A. What exists, what is missing

**Stand on (all `src/lib/`, each read):**
- **`audio.ts`.** `quantisation` (71), `toDb`/`fromDb` (147/170), `splAtDistance` (203), `sumIncoherent` (253), `reverbTime` (309; Sabine, Eyring, Schroeder, critical distance), `roomModes` (390) and `combFilter` (481). Constants `SPEED_OF_SOUND_20C = 343` and `P_REF_SPL = 20e-6`.
- **`video.ts`.** `bitsPerPixel`/`bitrate` (46/66; 4:4:4, 4:2:2, 4:2:0), `resolution` (159), PQ `pqToNits`/`nitsToPq` (222/231, with the ST 2084 constants exact as rationals), `hdrRange` (261), `psnr` (327), `streamBuffer` (385) and `latencyBudget` (466).
- **`colourspace.ts`.** Four gamuts (sRGB, BT.709, DCI-P3, BT.2020), script-extracted from colour-science with provenance. Coverage is reported in both xy and u′v′. Ids are `srgb`, `bt709`, `dcip3`, `bt2020`.
- **`biomed.ts` `samplingCheck`** (453).
- **`filter.ts`** (Butterworth/Chebyshev → `TransferFunction`) and **`control.ts`** (Bode). Both are read-only inputs for the crossover figure.
- **`units.ts`.** `convert` (552), `parseMeasured` (588), `lookup` (370; exact key → ALIASES → lowercased ALIASES only).
- **`unitSolve.ts`.** Units-aware Solve. Photometric quantities already flow through it: `E = Phi/A`, Phi = 800 lm, A = 10 ft² gives 861.1 lm/m².
- **Pane machinery.** `engUnits` (bare number = SI, assumed; a fitting unit is converted and reported; a wrong quantity is refused), `engReport` (25970), `buildPlotSvg`, and bar charts.

### A1. Probe results, ranked WRONG > SILENT > RIGHT > MISSING

*WRONG — a confident statement that is false (1):*

1. **`bitrate()` note, video.ts 123:** "No compression applied — this is the raw rate, which is what a capture interface must carry."
   - A serial digital interface carries the **full raster including blanking**, not the active pixels.
   - 1080p60 4:2:2 10-bit is 1920×1080×60×20 = **2.488 Gbit/s** active. SMPTE ST 274's total raster is 2200×1125, so the link is **2.970 Gbit/s** (3G-SDI, SMPTE ST 424). That is +19.4%.
   - Sizing a link or a recorder from this number under-provisions it. Fix in §B C-fixes.

*SILENT — right number, wrong or missing framing (7):*

2. **`resolution()` reports the storage aspect as "the" aspect** (video.ts 172).
   - 720×480 → "3:2". DV/DVD NTSC is *displayed* 4:3 or 16:9 through a pixel aspect of 8:9 or 10:11.
   - 1366×768 → "683:384" (the marketing name is 16:9; true 1.7786).
   - Nothing mentions pixel aspect.
3. **Critical distance hard-wires Q = 1** (audio.ts 331–333). The code comment says "omnidirectional". The pane line `Critical distance 0.9842 m` (taskpane 24175) does not. A loudspeaker (Q ≈ 2–10) has Dc √Q larger: ×1.41 at Q = 2.
4. **`latencyBudget` frame quantisation has no tolerance** (video.ts 476, 484).
   - A stage list summing to exactly k frames in floating point is billed k + 1 frames. Examples: one stage of 15 × (1000/23.976) ms, or four stages 0.1/0.2/0.3/0.4 × 41.67 ms at 24 Hz. That is 238 of 3,800 single-stage cases and 29 of 360 four-stage cases.
   - `frames` can print 6.999999999999999.
   - Typed decimals at 25/50/100 Hz are unaffected, so this is reachable mainly with computed stage values. Fix: snap within 1e-9 relative, and make `frames` an integer.
5. **Quantisation SNR uses the rounded constants** (audio.ts 81): `6.02*bits + 1.76`. 16-bit shows 98.08 dB; the exact 20·log₁₀2·n + 10·log₁₀1.5 is **98.09**; 24-bit shows 146.24 against **146.26**. This is precision, not a headline. It is pinned by audio.test.ts 20–32 (§C: the tests change, never loosen).
6. **`unitSolve` does not name photometric results.** `E = Phi/A` → "lm/m²", not lx. `L = I/A` → "cd/m²", not nit (unitSolve.ts 69, `NAMED`). It also emits `1/s` (`R = bits·fs·ch` → "1/s"), which `convert()` cannot parse back (`1/s → Hz` null, while `s^-1 → Hz` = 1). **That breaks the display contract** (memory: whatever is displayed must parse back).
7. **Input friction in fields that already ship.**
   - `29.97 FPS`, `30 Fps`, `48 KHz`, `48 khz`, `1000 NIT`, `5 Mbps`, `320 kbps` and `320 Kbps` are all refused with "is not a unit this recognises".
   - `lookup` lowercases only into ALIASES (units.ts 374), so a canonical UNITS key never matches case-insensitively.
   - `1000 Nits`, `500 LUX` and `800 Lumens` work, because those keys are aliases.
8. **`pqToNits(1.2)` = 74,604 nits.** That is above PQ's own 10,000-nit ceiling, with no guard (video.ts 222). **No pane path feeds it user input**: the HDR tool calls it only at fixed codes 0.25–1 (taskpane 24571). This is engine hardening, not a user-facing defect.

*RIGHT (keep and pin) (16):*
- 4:2:0 = 50% (`bitsPerPixel` 1.5 planes).
- PQ constants exact; `nitsToPq(100)` = 0.508078 and `nitsToPq(1000)` = 0.751827 (colour-science agrees to 1e-12).
- `toDb(2,"field")` = 6.0206, with both conventions shown.
- `splAtDistance(100,1,4)` → 87.959 dB, 0.5000 Pa.
- `sumIncoherent([80,80,74])` = 83.524, and [90,90] = 93.010.
- Sabine 0.6708 s and Eyring 0.6013 s (V 200, S 240, ᾱ 0.2); Schroeder 115.8 Hz.
- Room modes: 34.3 Hz (1,0,0) for 5 m.
- Comb: 500/1500/2500 Hz for 1 ms.
- `samplingCheck(44100,20000,·,30000)` folds to 14100; fs = 2·fmax is refused as inadequate (strict Nyquist).
- PSNR: 28.13 dB (8-bit) and 40.20 dB (10-bit) at MSE 100.
- Stream startup 13.33 s.
- Gamut coverage: P3 ⊇ sRGB (coverage 1.0).
- Photometric refusals: `lm→W`, `cd→lm`, `nit→lx`, `1 lm` in a W field → "not compatible".
- `fs` as a unitSolve symbol is not femtoseconds (`N = fs*t`, fs = 48 kHz → 96,000); femtoseconds still work in a value (`t = 2 fs`).
- `cd/ft^2 → nit` = 10.7639 and `lm/ft^2 → lx` = 10.7639.
- Decimal and binary sizes: 128 GB = 119.21 GiB, and Gbit/s → GB/h = 450.

*MISSING:* see the audit table A2. It also includes Solve's **"convert X to Y"**, which goes nowhere for any unit (`convert 48 kHz to Hz` → "more than one unknown (convert, kHz, to, Hz)"). That is cross-cutting, recorded here, and **out of this split** (Units mode converts; Solve does not).

### A2. Audit — ~40 calculations an audio/video engineer reaches for

Rank = what this round does: **T1** must ship, **T2** ships if time allows (cuttable without disturbing the split), **—** refused by name or out of scope. "Today" is measured, not recalled.

| # | Calculation | Today | Rank | Where (§B) |
|---|---|---|---|---|
| 1 | dB ↔ ratio, power vs field | ✓ `audio-decibel` | keep | — |
| 2 | dBu / dBV / dBm(600 Ω) ↔ volts; +4 dBu vs −10 dBV gap (11.78 dB) | ✗ | **T1** | `audio-levels` |
| 3 | dBFS ↔ analogue at an alignment level (EBU R68 −18 dBFS = 0 dBu; SMPTE RP 155 −20 dBFS = +4 dBu) | ✗ | **T1** | `audio-levels` |
| 4 | dB SPL ↔ Pa; mic sensitivity mV/Pa ↔ dBV/Pa | dB SPL→Pa inside `audio-spl` only; no inverse; no mic | **T1** | `audio-levels` |
| 5 | Sound power level (re 1 pW) | ✗ (`pW` not even a unit) | **T1** | `audio-levels` |
| 6 | Sum of incoherent sources | ✓ inside `audio-spl` | keep | — |
| 7 | Background-noise subtraction (refuse when ΔL < 3 dB) | ✗ | **T1** | `audio-levelmath` |
| 8 | Energy average / Leq of levels and durations | ✗ | **T1** | `audio-levelmath` |
| 9 | Coherent sum with phase | ✗ (only stated in a note) | **T1** | `audio-levelmath` |
| 10 | A / C weighting at a frequency; octave-band levels → dB(A) | ✗ | **T1** | `audio-levelmath` |
| 11 | Inverse square, point source | ✓ `audio-spl` | keep | — |
| 12 | Line source (−3 dB per doubling) | ✗ | T2 | `audio-levelmath` (source-type field) |
| 13 | RT60 Sabine/Eyring from one ᾱ | ✓ `audio-reverb` | keep | — |
| 14 | RT60 per surface (Σ Sα), Millington–Sette, air absorption 4mV, absorption needed for a target RT60 | ✗ | T2 | `audio-absorption` |
| 15 | Critical distance with directivity Q | Q = 1 hard-wired, undisclosed (A1-3) | **T1 fix** | `audio-reverb` gains a Q field |
| 16 | Room modes, Schroeder frequency | ✓ | keep | — |
| 17 | Comb / delay | ✓ | keep | — |
| 18 | Speed of sound at a temperature; wavelength and period | c fixed at 343 (an input on two tools) | T2 | `audio-levels` side panel |
| 19 | Nyquist and aliasing | ✓ `audio-sampling` | keep | — |
| 20 | Quantisation SNR | ✓ (rounded constants, A1-5) | fix | `audio-quantisation` |
| 21 | Dither penalty (RPDF −3.01 dB, TPDF −4.77 dB) and oversampling gain (10·log₁₀ OSR) | ✗ ("dither" is only a word in a note) | **T1** | `audio-dither` |
| 22 | Noise-shaping gain | ✗ | **—** refused by name: it depends on the shaping filter | — |
| 23 | PCM bit rate and file size; WAV 4 GiB ceiling (RIFF uint32) → RF64 | 1-minute size only, inside `audio-quantisation` | **T1** | `audio-filesize` |
| 24 | Compressed audio size from kbit/s | ✗ (`kbps` refused) | **T1** | `audio-filesize` |
| 25 | Loudness normalisation gain (measured LUFS → target), true-peak headroom after gain | ✗ | **T1** | `audio-loudness` |
| 26 | Steady-sine loudness through the BS.1770 K-filter; channel weights (Ls/Rs 1.41, LFE excluded) | ✗ | **T1** | `audio-loudness` |
| 27 | Integrated loudness from a typed list of 400 ms block loudnesses (gates −70 LUFS absolute, −10 LU relative) | ✗ | T2 | `audio-loudness` (list mode) |
| 28 | Integrated loudness / LRA / true peak **of a programme from one typed number** (peak, RMS or dBFS) | ✗ | **—** refused by name: these need the waveform | — |
| 29 | Speaker SPL from sensitivity, power and distance; power for a target SPL; 1 W vs 2.83 V basis; n boxes | ✗ (original item 7, never built) | **T1** | `audio-speaker` |
| 30 | Thiele–Small box alignment | ✗ | **—** this round: datasheet-driven; scope it separately if asked | — |
| 31 | Passive crossover 1st/2nd order (Butterworth, Linkwitz–Riley) component values; summed response | ✗ (original item 8, never built) | T2 | `audio-crossover` |
| 32 | Cable resistance, damping factor, insertion loss; AWG ↔ mm² | ✗ | T2 | `audio-damping` |
| 33 | SMPTE timecode ↔ frames, drop-frame validity, duration between two TCs, NDF drift | ✗ (no `timecode` anywhere) | **T1** | `video-timecode` |
| 34 | 1000/1001 rates, 3:2 pulldown, PAL 4% speed-up and pitch, audio samples per frame, shutter angle ↔ shutter time | ✗ | **T1** | `video-framerate` |
| 35 | Storage aspect × pixel aspect = display aspect; letterbox/pillarbox; safe areas | storage aspect only (A1-2) | **T1** | `video-aspect` |
| 36 | Uncompressed video rate, chroma subsampling | ✓ `video-bitrate` (WRONG note, A1-1) | fix | — |
| 37 | Interface rate incl. blanking (SDI), recording time on a card, GB per hour | ✗ | T2 | `video-interface` |
| 38 | OETF/EOTF: BT.709, BT.1886, sRGB, PQ, HLG; narrow-range code values | PQ only, inside `video-hdr` | **T1** | `video-transfer` |
| 39 | Gamut coverage | ✓ `video-gamut` | keep | — |
| 40 | Illuminance from a point source (inverse square + cosine); lux ↔ fc; nit ↔ fL; lumens of a uniform cone beam; screen luminance from lumens and gain | units only; no calculator; fc/fL not units | **T1** | `light-photometry` |
| 41 | EV from N and t; ISO shift; f-stop exact vs nominal; incident/reflected meter constants; hyperfocal, DoF, angle of view | ✗ | **T1** | `light-exposure` |
| 42 | Colour temperature: K ↔ mired, mired shift; CIE daylight xy from CCT; CCT from xy (McCamy, approximate) | ✗ | T2 | `light-colourtemp` |
| 43 | Planckian locus xy, CRI/TM-30 | ✗ | **—** data-blocked on the CIE CMF tables (fetch + crosscheck first, as colourspace.ts did) | — |
| 44 | SSIM, VMAF, psychoacoustic masking | ✗ | **—** SSIM needs images; VMAF and masking are trained models (original §8 stands) | — |
| 45 | `lm ↔ W`, `cd ↔ lm` without a beam, `nit ↔ lx` | refused | keep refused | — |

**Count:** 12 new T1 calculators, plus fixes to shipped ones (a Q field, exact quantisation constants, the bitrate note and aspect relabel); 5 new T2 calculators. With all of them, Engineering goes 130 → **147** (Audio & acoustics 7 → 16, Video & display 7 → 12, new group **Light & camera** 3). The T1-only floor is 130 + 12 new = **142**. `FIGURE_BASELINE` follows whichever ships.

Why a new group: subject matter. Exposure, depth of field and photometry are not "Video & display"; they serve stills, lighting and display work alike. Size is not the reason: Audio at 16 sits beside Energy & power at 17. The heading goes after "Video & display" in `ENG_GROUP_ORDER`. Only the integrator touches it.

---

## B. Inputs, outputs, figures — per calculator

Conventions for every new tool:
- Fields read through `engUnits` (`req`/`opt`/`optNull`).
- Every default string is in the §C0 probe table and **must** parse there before it is wired.
- Every tool draws from its shipped defaults.
- Every output obeys the display contract: dB SPL, m², µPa, cd/m², never m^2.
- A **decibel is never a unit** (§E1). Fields take a bare number and a select names the reference.

### B1. Audio — engine owner B (`audio.ts`, new `loudness.ts`)

**`audio-levels` — "Levels & references (dBu, dBV, dBFS, SPL)"** · `levelConvert(value, from, to, opts)`
- **Inputs:**
  - value (default `4`);
  - from-reference select: dBu, dBV, dBm (600 Ω), V rms, dBFS, dB SPL, Pa, dB SWL, W, mV/Pa, dBV/Pa;
  - to-reference select;
  - alignment select for dBFS: EBU R68 −18 dBFS = 0 dBu, SMPTE RP 155 −20 dBFS = +4 dBu, or custom (two fields);
  - dBFS convention select: **sine-referenced (AES17, a full-scale sine = 0 dBFS RMS)** vs peak. It is stated in the output, never guessed;
  - temperature for c/λ (T2 panel, default `20 °C`).
- **Outputs:** the value in every reference; the dB gap between consumer and pro level; for SPL, Pa and µPa; for mic sensitivity, both forms.
- **Figure:** a vertical "level ladder". The reference scales are drawn side by side on one dB axis (dBu, dBV, dBFS at the chosen alignment, volts on a log scale), with the entered value as a horizontal line across all of them. This is the picture every console manual prints.
- **Refusals:**
  - dBFS ↔ analogue with no alignment ("dBFS is relative to the converter, not to a voltage; choose an alignment");
  - dB SPL ↔ dBu ("a microphone sensitivity connects them; give one");
  - a negative or zero linear value.

**`audio-levelmath` — "Level arithmetic & weighting"** · `levelSum`, `levelSubtract`, `levelAverage`, `coherentSum`, `weighting(f, "A"|"C"|"Z")`, `bandsToWeighted`
- **Inputs:**
  - operation select: sum, subtract background, energy average (with optional durations), coherent with phase, weight bands;
  - levels list (default `80, 80, 74`);
  - background (default `80`, used by subtract);
  - phase in ° (coherent);
  - band frequencies and levels for weighting (default octave `63, 125, 250, 500, 1k, 2k, 4k, 8k` at `80` each).
  - T2: source type point/line for the distance falloff.
- **Formulas:** IEC 61672-1:2013 Annex E closed form, with A₁₀₀₀ = −2.000 dB and C₁₀₀₀ = −0.062 dB as **computed normalisations**, not typed constants. Weighting is evaluated at the **exact base-10 band frequency** 1000·10^(n/10), not the nominal label (31.5 Hz is really 31.62 Hz). Table 3 is defined that way, and nominal frequencies miss it by 0.1 dB (§D1).
- **Refusals:**
  - Subtraction with ΔL < 3 dB: "the background is within 3 dB of the total; the result is not determinable to better than the measurement". This is the practice in ISO 3744 §8.2; cite it only after checking the clause.
  - ΔL ≤ 0 → "background ≥ total".
- **Figure:** a stacked bar of each contribution's share of the power (sum/average), or the weighting curve on a log-f axis with the band levels before and after weighting (weight mode).

**`audio-reverb` (existing) — gains a field.** Directivity Q (default `1`). Dc = 0.057·√(QV/T). The output says "Q = 1 is an omnidirectional source" whenever Q = 1.

**`audio-absorption` (T2) — "Room absorption budget"** · `absorptionBudget(V, surfaces[], m, targetT?)`
- **Inputs:** V (default `200 m³`); a surfaces text area of `area, α` per line (default `60, 0.02 / 60, 0.6 / 120, 0.1`); air attenuation m in m⁻¹ (default blank = 0; **an input**, see §C honest limits); target RT60 (optional).
- **Outputs:** Sabine, Eyring and Millington–Sette; added absorption needed for the target; which surface dominates.
- **Figure:** a horizontal bar of absorption (m² sabins) per surface, with the target's required total as a line.

**`audio-quantisation` (existing) — precision fix only.** Compute 20·log₁₀2·n + 10·log₁₀1.5. The text keeps "6.02n + 1.76" as the rule of thumb and says it rounds.

**`audio-dither` — "Dither, oversampling & noise floor"** · `ditherBudget(bits, dither, osr, levelDbfs)`
- **Inputs:** bits (`16`); dither select: none, RPDF, TPDF; oversampling ratio (`1`); signal level re full scale in dB (`0`).
- **Outputs:** ideal SNR, the dither penalty (RPDF 10·log₁₀2, TPDF 10·log₁₀3), the oversampling gain 10·log₁₀ OSR, the in-band SNR at the stated level, and the noise floor in dBFS.
- **Refused by name:** "noise shaping moves noise in frequency; its gain depends on the shaping filter and is not computable from these inputs".
- **Figure:** a waterfall: ideal → after dither → after the signal backs off → after oversampling, one bar each.

**`audio-filesize` — "Audio data rate & file size"** · `audioSize({fs, bits, ch} | {kbps}, duration | size)`
- **Inputs:** mode select PCM/compressed; fs (`48 kHz`); bits (`24`); channels (`2`); compressed rate (`320 kbit/s` until §C0 lands `kbps`); duration (`1 h`) **or** size (blank).
- **Outputs:**
  - rate in bit/s, B/s and MB/min;
  - size in decimal **and** binary units;
  - for PCM, the WAV ceiling: RIFF sizes are uint32 (Microsoft RIFF spec), so data ≤ 2³² − 1 − 36 bytes, which is 4.14 h at 48 kHz/24/2. Past that it says "RF64 / BW64 (EBU Tech 3306 / ITU-R BS.2088)".
- **Figure:** size against duration for this format, with the 4 GiB WAV ceiling as a horizontal line and the entered duration marked.

**`audio-loudness` — "Loudness (LUFS) normalisation"** · in new `loudness.ts`: `kWeightGainDb(f)`, `sineLoudness(amplitudeDbfs, f, channels[])`, `normaliseGain(measured, target, truePeak?)`, T2 `gatedIntegrated(blocks[])`
- **Inputs:**
  - mode select: normalise, steady sine, gated blocks (T2);
  - measured integrated loudness (`-16.3`);
  - target (`-23`), with a select offering EBU R128 −23 LUFS and ATSC A/85 −24 LKFS. **Streaming-platform targets are NOT tabulated**: they are policy, not standards. A custom value is always allowed;
  - measured true peak in dBTP (optional);
  - max true peak (`-1`, EBU R128);
  - sine: amplitude in dBFS (`0`), frequency (`997 Hz`), channel set (L only / L+R / 5.1).
- **Outputs:**
  - gain in dB;
  - the resulting true peak, and **whether a limiter is required** ("+3.2 dB of gain would put the true peak at +1.4 dBTP, over the −1 dBTP ceiling");
  - sine loudness: −3.01 LUFS for 997 Hz at 0 dBFS in one front channel; 0.00 for two.
- **The K-filter** is the two published 48 kHz biquads (BS.1770-4 Tables 1 and 2), evaluated as |H(e^{jω})| exactly. For other sample rates the steady-sine mode is **refused by name** ("BS.1770 publishes 48 kHz coefficients; other rates need a re-derived filter this tool does not do"). The normalise mode is rate-free.
- **Refused by name,** whatever the phrasing: "integrated loudness / LRA / true peak of a programme from a peak, RMS or dBFS reading". The text: "loudness is gated over the whole programme waveform; a single level reading cannot give it".
- **Figure:** the K-weighting magnitude (log f, 20 Hz–20 kHz), with the sine's frequency marked (sine mode). Normalise mode draws a bar pair of before/after loudness and true peak against the target and ceiling lines.

**`audio-speaker` — "Loudspeaker sensitivity & amplifier power"** · `speakerSpl({sens, basis, z, power, distance, n, coherent, crest})`
- **Inputs:** sensitivity (`88`); basis select `dB @ 1 W/1 m` | `dB @ 2.83 V/1 m`; nominal impedance (`8 Ω`); power (`100 W`); distance (`4 m`); number of boxes (`1`); coherent select (n boxes: +10·log₁₀n incoherent / +20·log₁₀n coherent, the upper bound); programme crest factor (`12` dB); target SPL (optional).
- **Outputs:** continuous and peak SPL at the distance; power needed for the target; and the 2.83 V trap: "at 4 Ω, 2.83 V is 2.00 W, so a 2.83 V rating reads 3.01 dB higher than the 1 W rating of the same speaker".
- **Figure:** SPL against distance (log axis) for the rated power and for the peak (crest), with the target and listener distance marked.

**`audio-crossover` (T2) — "Passive crossover (1st/2nd order)"** · `passiveCrossover(fc, R, type)`
- **Inputs:** fc (`2.5 kHz`); driver nominal impedance (`8 Ω`); type select: 1st order, Butterworth 2nd, Linkwitz–Riley 2nd.
- **Outputs:** C (µF) and L (mH) for each section; the polarity the tweeter needs for a flat sum (LR2: inverted; BW2: inverted gives +3 dB at fc, in phase gives a null).
- **Figure:** LP, HP and summed magnitude on a log-f axis, drawn by composing **`filter.ts`** transfer functions (read-only). This is the composition that previously caught a latent root-finding bug.
- **Honest limit (in the output):** "values assume a resistive load equal to the nominal impedance; a real driver's impedance rises with frequency, so without a Zobel network the acoustic crossover will not be where these values put it".

**`audio-damping` (T2) — "Speaker cable & damping factor"** · `cableDamping({zLoad, zOut, length, area|awg, material})`
- **Inputs:** load (`8 Ω`); amplifier output impedance (`0.02 Ω`); one-way length (`10 m`); conductor area (`2.5 mm²`) or AWG; conductor fixed to annealed copper.
- **Formulas:** ρ = 1/58 Ω·mm²/m at 20 °C, **the IEC 60028 definition of 100% IACS (exact)**. AWG diameter 0.127 mm × 92^((36−n)/39) (ASTM B258, exact).
- **Outputs:** round-trip resistance, damping factor at the speaker terminals, and insertion loss in dB.
- **Figure:** damping factor against cable length for three standard areas, with the entered one marked.

### B2. Video — engine owner C (`video.ts`, new `timecode.ts`)

**`video-timecode` — "Timecode (SMPTE ST 12-1)"** · `tcToFrames(tc, rate, df)`, `framesToTc(n, rate, df)`, `tcDuration(a, b, rate, df)`, `realTimeOf(n, rate)`
- **Inputs:** rate select: 23.976, 24, 25, 29.97 DF, 29.97 NDF, 30, 50, 59.94 DF, 59.94 NDF, 60; timecode A (`00:10:00;00`); timecode B (optional) **or** a frame count.
- **Outputs:** frame number (0-based, said so), real elapsed time (exact rational: frames × 1001/30000), drift of NDF against wall clock (3.6 s per hour at 29.97), and the duration A→B in TC, frames and seconds.
- **Drop-frame rule (ST 12-1):** at 29.97 DF, frame numbers ;00 and ;01 are skipped at the start of every minute **except minutes divisible by 10**. At 59.94 DF, ;00–;03 are skipped.
- **Refusals by name:**
  - **a label that does not exist** (`00:01:00;00` at 29.97 DF: "frames ;00 and ;01 of minute 1 are dropped; the next label after 00:00:59;29 is 00:01:00;02");
  - `;` separator at a non-DF rate;
  - DF at 23.976/24/25/30 ("drop-frame is defined only for the 1000/1001 rates of 30 and 60 frames");
  - frame field ≥ the nominal rate.
- **All arithmetic in integers.** Real time is a rational, never a float accumulation.
- **Figure:** the TC-vs-wall-clock drift line for NDF and DF across 0–60 min, with the sawtooth of DF corrections visible at a 10-minute zoom and the entered TC marked.

**`video-framerate` — "Frame rates, pulldown & shutter"** · `rateFacts(rate)`, `pulldown(from, to)`, `shutter(angle|time, fps)`
- **Inputs:** source rate (`23.976`), target rate (`29.97`), shutter angle (`180°`) or shutter time, and the audio sample rate (`48 kHz`).
- **Rates are exact rationals.** `23.976` and `29.97` typed are **snapped to 24000/1001 and 30000/1001, and the snap is reported**. A truly decimal 29.97 is about 1 ppm **below** 30000/1001, so frames ÷ 29.97 runs about **3.6 ms per hour long**. That is small, but it is not zero, and it breaks exact frame identities. Do not confuse it with the NDF drift of 108 frames (3.6 s) per hour, which is a labelling effect.
- **Outputs:**
  - samples per frame (2002 at 23.976; **1601.6 at 29.97, so a 5-frame sequence sums to 8008**; 800.8 at 59.94 → 4004 per 5);
  - pulldown cadence (24 → 30 as 2:3: 4 film frames to 10 fields to 5 video frames, with the 0.1% slow-down);
  - the PAL speed-up (24 → 25 = +4.17%, +0.707 semitones = 70.7 cents; 100 min runs 96 min);
  - shutter time = angle / (360 × fps) (180° at 24 → 1/48 s).
- **Figure:** a cadence strip: source frames as blocks over target frames/fields, coloured by source frame, for one full cycle.

**`video-aspect` — "Aspect, pixel aspect & framing"** · `aspect({w, h, par|dar}, frameIn?)`
- **Inputs:** width (`720`), height (`480`), and either the pixel aspect (`10:11`) or the intended display aspect (`4:3`); optional delivery frame (`1920×1080`) and content aspect (`2.39`) for letterboxing.
- **Outputs:**
  - SAR, PAR, DAR as reduced ratios and decimals. **Both NTSC conventions are named**: 8:9 from the 720-wide raster, 10:11 from the BT.601 704-active-pixel basis. PAL: 16:15 / 12:11;
  - the nearest common name ("1366×768 ≈ 16:9, true 1.7786");
  - letterbox active height and bars (2.39 in 1080 → 803.35 lines, so 804 if even-rounded and bars of 138);
  - pillarbox (4:3 in 1920×1080 → 1440 wide, 240 per side);
  - safe areas (SMPTE ST 2046-1: action 93%, graphics/title 90%).
- **Figure:** the frame to scale, with active picture, bars, and action/title-safe rectangles.
- The existing `resolution()` relabels `aspectLabel` as **storage** aspect and gains the nearest-common-name line (C-fix).

**`video-transfer` — "Transfer functions & code values"** · `oetf709`, `eotf1886(V, Lw, Lb)`, `eotfSrgb`, `pq` (existing), `hlgOetf`/`hlgOetfInv` (BT.2100), `codeValue(E', bits, range)`
- **Inputs:** curve select; direction select (signal → light / light → signal); value (`0.5`); for BT.1886, white Lw (`100 nit`) and black Lb (`0`); bit depth (`10`); range select narrow/full.
- **Formulas:**
  - **BT.709** piecewise: 4.5L below 0.018, 1.099L^0.45 − 0.099 above. The constants as published are the oracle (§D4).
  - **BT.1886:** a = (Lw^(1/γ) − Lb^(1/γ))^γ, b = Lb^(1/γ)/(Lw^(1/γ) − Lb^(1/γ)), γ = 2.4.
  - **sRGB** (IEC 61966-2-1): 0.04045 / 12.92 / 2.4 / 0.055.
  - **HLG:** a = 0.17883277, b = 1 − 4a, c = 0.5 − a·ln(4a).
  - **Narrow range:** D = round((219E′ + 16)·2^(n−8)) for luma; chroma (224E′ + 128)·2^(n−8).
- **The one-line trap it states:** BT.709 is an **OETF** (camera); the display EOTF is BT.1886. Inverting the 709 OETF to get display light is the commonest error, and the two do not round-trip (the system gamma is ≈ 1.2).
- **Figure:** the selected curve normalised 0–1 against signal, with the entered point marked and the 709/1886/sRGB curves faint behind it for comparison. For PQ/HLG, a log-luminance axis.

**`video-bitrate` (existing) — C-fix to the note.** The new note: "No compression applied — this is the active-picture rate. A serial interface (SDI) also carries blanking: 1080p at 60 is 2.970 Gbit/s on the link against 2.488 Gbit/s here."

**`video-interface` (T2) — "Interface bandwidth & recording time"** · `rasterRate(totalW, totalH, fps, bitsPerSample)`, `recordTime(rate, capacity)`
- **Inputs:** active w×h (`1920×1080`); total raster (`2200×1125`, the SMPTE ST 274 default with the standard cited in the hint; an **input**, since CTA-861 timings are a table and not tabulated); rate (`60`); 4:2:2 10-bit (20 bits/px); media capacity (`128 GB`); stream rate (`100 Mbit/s`).
- **Outputs:** link rate, blanking overhead, nearest SDI class (1.485/1.485⁄1.001, 2.97, 5.94, 11.88 Gbit/s), GB per hour, and recording time in h:m:s on decimal and binary capacity.
- **Figure:** a bar of active vs blanking vs the SDI class capacity.

### B3. Light & camera (new group) — engine owner D (new `photometry.ts`, `colourspace.ts` for colour temperature)

**`light-photometry` — "Illuminance, luminance & beams"** · `pointIlluminance(I, d, θ)`, `coneFlux(I, beamAngle)`, `screenLuminance(flux, area, gain)`, plus unit pairs lx↔fc and nit↔fL
- **Inputs:** mode select; intensity (`1000 cd`); distance (`2 m`); incidence angle (`0°`); beam full angle (`30°`); flux (`5000 lm`); screen area (`10 m²`); screen gain (`1`).
- **Outputs:**
  - E = I·cosθ/d² (250 lx; 216.5 lx at 30°);
  - flux of a **uniform** cone, Ω = 2π(1 − cos(θ/2)) (214.1 lm). **This is the honest route around the refused `cd → lm`**: the solid angle is a stated input, and "uniform intensity across the beam" is said;
  - Lambertian screen L = E·gain/π (159.2 nit) and fL (46.45);
  - the cinema reference, 48 cd/m² ≈ 14 fL (SMPTE RP 431-1).
- **Figure:** illuminance against distance (log-log, slope −2) with the cosine-reduced curve for the entered angle; or, in beam mode, the cone drawn with Ω annotated.

**`light-exposure` — "Exposure, f-stops & depth of field"** · `ev(N, t, iso)`, `meter(ev, iso, C|K)`, `stopsBetween(N1, N2)`, `dof(f, N, c, s)`, `angleOfView(sensor, f)`
- **Inputs:** f-number (`8`); shutter (`1/125 s`, see §C0: fraction parsing is a units-builder deliverable); ISO (`100`); incident constant C (`250`) / reflected K (`12.5`), **inputs with a hint** ("ISO 2720 allows a range; meters differ"); focal length (`50 mm`); CoC (`0.03 mm`, "a convention for 36×24 mm, not a standard"); subject distance (`5 m`); sensor width (`36 mm`).
- **Outputs:**
  - EV₁₀₀ = log₂(N²/t) (12.97); the EV at the stated ISO;
  - the incident illuminance for that EV (E = C·2^EV/ISO);
  - the f-number's exact value vs its marking (f/5.6 = 5.657, f/11 = 11.31), and stops between two markings using the exact values;
  - hyperfocal (10.47 m), near/far limits (3.389 m / 9.527 m), angle of view (39.6° horizontal, 46.8° diagonal).
- **Figure:** the depth-of-field band (near–far) against subject distance, with the hyperfocal asymptote and the entered distance marked.

**`light-colourtemp` (T2) — "Colour temperature & mired"** · in `colourspace.ts`: `mired(T)`, `miredShift(T1, T2)`, `daylightXy(T)` (CIE 15 D-series, defined for 4000–25000 K), `cctMcCamy(x, y)`
- **Inputs:** T₁ (`3200 K`), T₂ (`5600 K`), optional xy.
- **Outputs:**
  - mired 312.5 / 178.6 and the shift −133.9 (a "blue" correction). Gel names and ratings are **not** tabulated (manufacturer data);
  - the D-series chromaticity;
  - CCT from xy **labelled "McCamy approximation, ±2 K over 2856–6504 K, worse outside"**;
  - the counter-intuitive line: "D65 is 6504 K, not 6500 K: the c₂ constant was revised from 1.438 to 1.4388 × 10⁻² m·K after D65 was defined".
- **Mired is computed, never a unit** (§E4).
- **Figure:** the daylight locus in xy for 4000–25000 K, with the entered temperatures marked and sRGB's triangle (from `GAMUTS`) drawn faint for orientation.

---

## C. Build order, honest limits, disjoint split

### C0. Default-string probe (through `parseMeasured`, the path behind `NOTHING_INSERTED`)

Probed 2026-10-14. **FAIL rows must be fixed by builder A before E wires the default, or the default must be changed.** The integrator re-runs this table as a jest test (`avDefaults.test.ts`, owned by E) so a later units edit cannot silently break a default.

| Default string | SI target | Today |
|---|---|---|
| `44.1 kHz`, `48 kHz`, `20 kHz`, `2.5 kHz` | Hz | ok |
| `25` | fps | ok (assumed) |
| `29.97 fps` | fps | ok |
| `29.97 FPS`, `30 Fps` | fps | **FAIL** — not recognised |
| `48 KHz`, `48 khz` | Hz | **FAIL** |
| `5 Mbit/s`, `8 Mbit/s`, `100 Mbit/s` | bit/s | ok |
| `5 Mbps`, `320 kbps`, `320 Kbps` | bit/s | **FAIL** |
| `5 MB`, `128 GB` | B | ok |
| `1000 nits`, `1000 Nits` | nit | ok |
| `1000 NIT` | nit | **FAIL** |
| `500 Lux`, `500 LUX`, `800 Lumens`, `800 lm`, `1000 cd` | lx / lm / cd | ok |
| `50 fc` | lx | **FAIL** — no footcandle |
| `14 ftL` | nit | **FAIL** — no foot-lambert |
| `20 µPa` | Pa | **FAIL** — no µPa |
| `1 pW` | W | **FAIL** — no pW (nor nW) |
| `1/125 s` | s | **FAIL** — "/125 s is not a unit" |
| `0.008 s`, `10 ms`, `41.667 ms`, `60 s`, `1 h` | s | ok |
| `5 m`, `16.4 ft`, `2 m`, `10 m`, `50 mm`, `0.03 mm` | m | ok |
| `200 m³`, `240 m²`, `1 m^2`, `10 m^2`, `2.5 mm²` | m³ / m² | ok |
| `343 m/s` | m/s | ok |
| `8 Ω`, `8 ohms`, `8 Ohm`, `0.02 Ω` | Ω | ok |
| `100 W`, `2.83 V` | W / V | ok |
| `3200 K` | K | ok |
| `15°`, `30 deg` | ° | ok (14.999999999999998 — display through `engNum`) |
| `20 °C` | K | ok 293.15 (affine path) |
| `20 C` | K | **FAIL** — "C" is coulomb; refusing it is correct, so never ship it as a default |
| `320 kbit/s` | bit/s | ok |
| `997 Hz`, `180°`, `180 deg`, `36 mm` | Hz / ° / m | ok |
| `5 1/s` | Hz | **FAIL** — reciprocal numerator (A1-6) |
| `48 s^-1` | Hz | ok |

**Defaults not read by `parseMeasured`** go through a lib parser and fail the same way, inserting nothing. These are the band list (`63, 125, 250, 500, 1k, 2k, 4k, 8k`, where `1k` must parse), ratios (`10:11`, `4:3`, `2.39`), frame sizes (`1920×1080` with U+00D7 **and** `1920x1080`), timecodes (`00:10:00;00`) and the surfaces list. Each owning builder's parser test must accept its own shipped default verbatim.

**Units builder A deliverables:**
- **Add:**
  - `µPa`, `mPa` (canonical UNITS keys, never aliases; see §E2), `pW`, `nW`;
  - `fc` = lm/ft² = 10.763910416709722 lx (exact via ft = 0.3048);
  - **`ftL`** = (1/π) cd/ft² = 3.4262590996353905 nit, with aliases `footlambert`/`foot-lambert`/`footcandle`. **Never `fL`** (§E2);
  - `kbps`/`Mbps`/`Gbps` as UNITS keys with a new dim `datarate` (BASE `{information: 1, time: -1}`), so they convert with `Mbit/s`;
  - case aliases `FPS`, `Fps`, `KHz`, `khz`, `NIT`.
- **`parseMeasured`** accepts a leading simple fraction `a/b <unit>` (`1/125 s`, `1/48 s`). It must refuse `1/0` and any second slash in the numeric part.
- **Pin the fraction reader and the `1/x` numerator together**, because they edit the same parse path: `1/125 s` → 0.008 s; `5 1/s` → 5, Hz-compatible (FAILS today); `48 s^-1` still 48 Hz; `1/0 s` refused.
- **`convert`/`parseCompoundUnit`** accept a `1/x` numerator (`1/s`, `1/K`, `1/in`). This closes the display-contract break in A1-6.
- **`unitSolve` `NAMED`** gains `lx` and `nit`. It must **not** gain Hz for s⁻¹ (the existing comment at unitSolve.ts 66–68 explains why).

### C1. Order

1. **Builders in parallel:** A units, B audio, C video, D light.
   - Engines take SI numbers, so B/C/D do **not** wait for A. Only E's defaults depend on A.
   - Each engine has its own `__tests__` file and meets §D before integration.
   - Engine APIs freeze at the end of step 1.
2. **Then E integrates:** the pane, ratchets, TEST-SCRIPT and examples. `FIGURE_BASELINE` is raised to exactly 130 + N in the same commit; `CORPUS_FLOOR` (check-figures.js 84, now 205 and moved by other builders) rises by the corpus figures added.
3. **Then an INDEPENDENT adversarial pass** over the whole diff (house rule). Aim it at:
   - non-existent DF labels; 29.97 typed against 30000/1001;
   - dB typed as a unit (`94 dB` in a Pa field);
   - `MBps` vs `Mbps`; `fL` in an assay context;
   - a loudness question phrased as a single reading;
   - background within 3 dB; an LR2 sum with the wrong polarity;
   - BT.709 inverted as an EOTF; f/5.6 vs 5.657 in stop counts;
   - mired attempted as a unit;
   - every new default with case variants.
4. **§D is the exit test.** Full QC (`npm run qc`, 15 gates) before deploy.

### C2. Disjoint split — files are disjoint; `taskpane.ts` has exactly one owner

| Builder | Owns (creates or edits) | Reads only |
|---|---|---|
| **A — units** | `src/lib/units.ts` (§C0 deliverables); `src/lib/unitSolve.ts` (`NAMED` lx/nit; 1/x display round-trip); `photometricUnits.test.ts`, `units.test.ts`, `unitSolve.test.ts`; **new** `avUnits.test.ts` (the §E2 collision pins) | — |
| **B — audio** | `src/lib/audio.ts` (new `levelConvert`, `levelSum`/`Subtract`/`Average`, `coherentSum`, `weighting`, `bandsToWeighted`, `ditherBudget`, `audioSize`, `speakerSpl`, T2 `absorptionBudget`, `passiveCrossover`, `cableDamping`; fixes: Q in `reverbTime`, exact quantisation constants); **new** `src/lib/loudness.ts`; `audio.test.ts` (lines 20–32 move to exact 98.0905 / 6.0206 — update, never loosen); **new** `audioLevels.test.ts`, `loudness.test.ts`, `crossover.test.ts` | `filter.ts`, `control.ts` (crossover figure data), `biomed.ts` |
| **C — video** | `src/lib/video.ts` (`aspect`, rate facts, pulldown, shutter, transfer functions, `rasterRate`/`recordTime`; fixes: note at 123, `aspectLabel` relabel, latency epsilon + integer frames, `pqToNits` clamp); **new** `src/lib/timecode.ts`; `video.test.ts` (line 70–72 aspect pins stay; add relabel); **new** `timecode.test.ts`, `transfer.test.ts` | `colourspace.ts` |
| **D — light** | **new** `src/lib/photometry.ts` (photometry + exposure); `src/lib/colourspace.ts` (mired, `daylightXy`, `cctMcCamy` — additive, `GAMUTS` untouched); **new** `photometry.test.ts`, `colourTemp.test.ts`; `colourspace.crosscheck.test.ts` (additions only) | `units.ts` |
| **E — integrator** | `src/taskpane/taskpane.ts` (ENG_CALCS entries, `ENG_GROUP_ORDER` + "Light & camera", Q field on `audio-reverb`, relabels); `scripts/engineering-audit.js` (`FIGURE_BASELINE`); `scripts/figure-layout-run.ts`; `scripts/check-figures.js` (`CORPUS_FLOOR`); **new** `avDefaults.test.ts` (§C0 as a test); `engineeringRouting.test.ts` if it enumerates; `versionTags.adversarial.test.ts` if new disciplines are tagged; `docs/TEST-SCRIPT.md` (new §); `src/lib/examples.ts` / search entries | every engine API from A–D, frozen at step 1 |

- B owns `audio.ts`; C must not touch it.
- D owns `colourspace.ts`; C reads `GAMUTS` only.
- If C needs a figure helper that does not exist, it asks E.
- Nobody edits `biomed.ts` or `filter.ts`.
- **Coordination with briefs in flight.** v2.138.0 owns `taskpane.ts`, `check-figures.js`, `figure-layout-run.ts`, `pane-audit.js` and `TEST-SCRIPT.md`. `docs/SCOPE-NUMERICS-TOPOLOGY.md` (v2.139.0) queues its own integrator after that. E starts only after both are committed, rebases onto them, and takes `CORPUS_FLOOR` from whatever they leave. A–D touch none of those files and can start now.

### C3. Honest limits (say them in the UI)

- **Levels:**
  - dBFS is converter-relative. Analogue mapping needs an alignment, and the two standards put full scale **6 dB apart** (0 dBFS = +18 dBu under EBU R68, +24 dBu under SMPTE RP 155). Their headroom above the alignment level differs by 2 dB (18 vs 20).
  - The sine-referenced (AES17) convention is used and stated; peak-referenced meters read 3.01 dB differently for a sine.
- **Weighting:** the IEC 61672-1 design formula only, with no Class 1/2 tolerance bands. Band → dB(A) assumes the band level sits at its centre frequency.
- **Loudness:**
  - Normalisation gain and steady-sine loudness only. The K-filter is published for 48 kHz only.
  - Programme loudness, LRA and true peak need the waveform and are refused by name.
  - T2 gating works on typed block loudnesses, not audio.
- **Room acoustics:** diffuse-field formulas. Absorption coefficients and air attenuation are **user inputs**: ISO 9613-1's m(T, RH, p) is computable but deferred, and the material tables stay data-blocked (original §5 stands). There are no frequency bands inside one run (run once per band).
- **Speaker:** far-field, on-axis, no power compression, no room gain. The n-box coherent figure is an upper bound.
- **Crossover:** resistive-load values (see B1). No Zobel, no L-pad, no acoustic offsets. No LR4 this round.
- **Timecode:** ST 12-1 at the rates listed. No 119.88/120 DF, no film feet+frames, no 25 fps DF (it does not exist).
- **Aspect:** square-pixel delivery frames are assumed for letterboxing. Clean-aperture metadata is not modelled.
- **Transfer:** the formula curves only. No OOTF/system-gamma tone mapping beyond BT.1886 and HLG's stated form. No ACES.
- **Photometry:** a point source in the far field (d ≫ source size). The cone is of **uniform** intensity. A Lambertian screen; real screens have a gain profile.
- **Exposure:** a thin lens. The CoC is a convention. The meter constants C and K are manufacturer-dependent inputs.
- **Colour temperature:** McCamy is an approximation and is labelled one. Planckian xy, Duv and CRI are data-blocked on the CIE CMFs (fetch + crosscheck first).

---

## D. Acceptance audit (oracle beside every value)

### D0. Oracle classes

- **[P] Published.** A value printed in the standard or its normative table. This is the strongest.
- **[L] Independent library.** colour-science 0.4.7, scipy 1.18.1, timecode 1.5.1, pyloudnorm 0.2.0 (`filter_class="DeMan"`; see D1 note).
- **[X] Exact identity.** Exact arithmetic from a definition, e.g. ft = 0.3048 m exactly, or Fraction arithmetic.
- **[F] Formula re-typed in Python.** **Not independent of the builder's formula.** It catches transcription slips only. Every [F] row needs a [P] or [X] landmark beside it in the same test.

Tolerances: dB to 1e-3 unless [P] is printed to 0.1 dB (then to 0.05). Ratios and lengths to 1e-9 relative. Frame counts and code values exact.

### D1. Audio

| Case | Expected | Class / source |
|---|---|---|
| 0 dBu | 0.7745966692 V (√0.6) | [X] definition, 1 mW in 600 Ω |
| +4 dBu | 1.2276530 V = +1.7815 dBV | [X] |
| +4 dBu − (−10 dBV) | 11.7815 dB | [X] |
| dBu → dBV offset | −2.2185 dB | [X] |
| 0 dBFS under EBU R68 / SMPTE RP 155 | +18.000 dBu / +24.000 dBu | [P] R68 (−18 dBFS = 0 dBu); RP 155 (−20 dBFS = +4 dBu) |
| −10 dBFS under R68 / RP 155; +4 dBu under each | +8.000 / +14.000 dBu; −14.000 / −20.000 dBFS | [X] given the alignment |
| 94 dB SPL | 1.0023745 Pa; 1 Pa = 93.9794 dB SPL | [X] p₀ = 20 µPa (ISO 1683) |
| 10 mV/Pa | −40.000 dBV/Pa | [X] |
| 1 W sound power | 120.000 dB SWL re 1 pW | [X] |
| A-weighting at exact band frequencies 10 / 31.62 / 63.10 / 100 / 125.9 / 251.2 / 501.2 / 1000 / 1995 / 3981 / 7943 / 10000 / 15849 / 19953 Hz | −70.4 / −39.4 / −26.2 / −19.1 / −16.1 / −8.6 / −3.2 / 0.0 / +1.2 / +1.0 / −1.1 / −2.5 / −6.6 / −9.3 dB | [P] IEC 61672-1:2013 Table 3; formula reproduces it |
| **Same at NOMINAL 31.5 / 16000 Hz** | −39.52 / −6.71: **does NOT match the table**. A test asserting −39.4 at 31.5 Hz fails, which is correct (it pins the base-10 rule) | [F] |
| C-weighting 31.62 / 63.10 / 8k / 16k | −3.0 / −0.8 / −3.0 / −8.5 dB | [P] IEC 61672-1 Table 3 |
| A₁₀₀₀ / C₁₀₀₀ normalisations | −1.99966 / −0.06190 dB (computed, not typed) | [F] + [P] "−2.000 / −0.062" |
| Octave bands 63–8k all at 80 dB → dB(A) | 86.974 (exact f); 86.987 with the table's rounded 0.1 dB weights; dB(Z) 89.031 | [F]; [X] for Z |
| Sum 80, 80, 74 | 83.5241 | [X] (also already pinned) |
| 85 total − 80 background | 83.3491 | [X] |
| 82 − 80 (Δ = 2 dB) | **refused** (Δ < 3 dB) | rule, ISO 3744 practice |
| Leq of 70, 80, 90 (equal time) | 85.6820 | [X] |
| Two coherent 80s, in phase / 90° | 86.0206 / 83.0103 | [X] |
| Dc, V 200, T 0.6708, Q = 1 / Q = 2 | 0.98420 / 1.39187 m (0.057 form); √(QA/16π) gives 1.38198 (Q = 2), so the 0.057 constant rounds 0.0566 | [F] + note |
| Per-surface 60·0.02 + 60·0.6 + 120·0.1, V 200 | A = 49.2; Sabine 0.65447; Eyring 0.58483; Millington–Sette 0.46780 s; +4mV with m = 0.0024 → 0.62989 s | [F] |
| Target 0.5 s, same room | needs A = 64.4, +16.4 m² sabins | [F] |
| 16-bit ideal / RPDF / TPDF | 98.0905 / 95.0802 / 93.3193 dB | [X] 20·log₁₀2, 10·log₁₀(3/2), 10·log₁₀2, 10·log₁₀3 |
| 24-bit ideal / TPDF | 146.2553 / 141.4841 | [X] |
| OSR 4 / 64 | +6.0206 / +18.0618 dB | [X] |
| PCM 48k/24/2 | 2,304,000 bit/s; 1.0368 GB per hour | [X] |
| CD 44.1k/16/2, 74 min | 1,411,200 bit/s; 783,216,000 B | [X] (IEC 60908 rate) |
| WAV ceiling at 48k/24/2 | (2³² − 1 − 36)/288000 = 14913.08 s = 4.1425 h | [X] RIFF uint32 sizes |
| K-weight gain at 997 Hz (BS.1770 48 kHz coefficients) | +0.6910 dB | [L] scipy `freqz` on the published biquads |
| 997 Hz sine, 0 dBFS, one front channel / two | **−3.0103 / 0.0000 LUFS** | [P] BS.1770-4 Annex 1 ("−3.01 LKFS"); [L] pyloudnorm DeMan −3.01028 / 0.00002 |
| Same at 1000 Hz | −3.0036 (not interchangeable with 997) | [L] scipy |
| 100 Hz / 10 kHz sine, one channel | −4.8348 / +0.3406 LUFS | [L] scipy; pyloudnorm default −4.873 / +0.297 (see note) |
| Normalise −16.3 → −23 | −6.7 dB | [X] |
| Speaker 88 dB/1 W, 100 W, 4 m | 95.9588 dB SPL; 253.58 W for 100 dB at 4 m | [X] |
| 2.83 V into 4 Ω / 8 Ω | 2.00223 W (+3.0151 dB) / 1.00111 W (+0.0048 dB) | [X] |
| Crossover 2.5 kHz, 8 Ω: 1st / BW2 / LR2 | C 7.9577 / 5.6270 / 3.9789 µF; L 0.50930 / 0.72025 / 1.01859 mH | [F] |
| Summed response at fc: BW2 in-phase / inverted | null / +3.010 dB | [L] scipy `butter`+`freqs` |
| LR2 in-phase / inverted; LR4 in-phase | null / 0.000 dB; 0.000 dB (each section −6.021) | [L] scipy |
| Copper ρ | 1.7241379e-8 Ω·m (1/58 Ω·mm²/m) | [P] IEC 60028 |
| 2 × 10 m of 2.5 mm², 8 Ω, Zout 0.02 Ω | R 0.137931 Ω; DF 50.655; loss −0.1698 dB | [X] |
| AWG 12 | 2.05253 mm; 3.30877 mm² | [P] ASTM B258 formula |
| c at 20 °C | 343.21 m/s (331.3·√(1 + T/273.15)); the product's 343 stays as its stated constant | [F] |

**Note — pyloudnorm's default filter is not BS.1770.** `Meter(fs)` (filter_class "K-weighting") uses a high-pass of b = [0.99504, −1.99009, 0.99504] instead of the standard's [1, −2, 1]. It reads −3.0517 for the calibration sine, **0.04 dB off the standard's own statement**. `filter_class="DeMan"` matches to 3e-5. Any test or adversarial check using pyloudnorm must pass `filter_class="DeMan"`, or it will "find" a defect that is the oracle's.

### D2. Video

| Case | Expected | Class / source |
|---|---|---|
| 29.97 DF frame 1799 / 1800 | 00:00:59;29 / **00:01:00;02** | [P] SMPTE ST 12-1 rule; [L] timecode 1.5.1 (1-based, minus 1) |
| 00:10:00;00 / 01:00:00;00 at 29.97 DF | 17982 / 107892 frames | [P] rule `(3600h+60m+s)·30+f − 2(tm − ⌊tm/10⌋)`; [L] |
| 59.94 DF 00:01:00;04 / 01:00:00;00 | 3600 / 215784 | [P] (drop 4); [L] |
| 29.97 NDF 01:00:00:00 | 108000 frames = 3603.6 s real (+3.6 s drift) | [X] 108000 × 1001/30000 |
| 29.97 DF 01:00:00;00 real time | 3599.9964 s | [X] |
| 23.976 01:00:00:00 | 86400 frames = 3603.6 s | [X] |
| **`00:01:00;00` at 29.97 DF** | **REFUSED** (label does not exist) | [P] ST 12-1. **timecode 1.5.1 silently returns 1798. The library is NOT the validity oracle** |
| `00:00:10;00` at 25 fps / DF at 23.976 | refused (`;` at a non-DF rate; DF undefined) | [P] |
| 48 kHz samples per frame at 23.976 / 24 / 25 / 29.97 / 30 / 59.94 | 2002 / 2000 / 1920 / 8008⁄5 / 1600 / 4004⁄5 | [X] Fraction(48000)/rate |
| 29.97 5-frame audio sequence | sums to 8008 (pattern 1602, 1601, 1602, 1601, 1602 per SMPTE ST 272; check the ordering against the standard before pinning it; **pin the sum unconditionally**) | [X] sum; [P] pattern |
| PAL speed-up 24 → 25 | +4.1667%; +0.70672 semitones (70.672 cents); 100 min → 96 min | [X] |
| Shutter 180° at 24 / 172.8° at 25 / 1/50 s at 25 | 1/48 s (20.833 ms) / 19.2 ms / 180° | [X] |
| 2:3 pulldown | 4 film frames → 10 fields → 5 frames | [X] |
| PAR 720×480 at 4:3 | 8:9 (720 basis) and **10:11** (BT.601 704 basis) | [X]; [P] BT.601 |
| PAR 720×576 at 4:3 | 16:15 and 12:11 | [X]; [P] |
| 2.39 in 1920×1080 | active 803.347 lines; bars 138.33 each | [X] |
| 4:3 in 1920×1080 | 1440 wide; 240 px each side | [X] |
| Safe areas at 1080 | title 1728×972; action 1785.6×1004.4 | [P] SMPTE ST 2046-1 (90% / 93%) |
| 1080p60 4:2:2 10-bit | active 2.48832 Gbit/s; raster 2200×1125 → **2.970 Gbit/s** (+19.36%) | [P] SMPTE ST 274 raster, ST 424 rate |
| 1080i59.94 | 1.4835165 Gbit/s (1.485/1.001) | [P] SMPTE ST 292-1 |
| 100 Mbit/s | 45 GB per hour; 128 GB card → 10240 s; 128 GB = 119.209 GiB | [X] |
| BT.709 OETF 0.18 / 0.01 | 0.409008 / 0.045 | [L] colour `oetf_BT709`; [P] BT.709-6 item 1.2 constants |
| BT.709 OETF⁻¹ 0.5 | 0.259589 | [L] |
| BT.1886 EOTF 0.5, Lw 100, Lb 0 / Lb 0.1 | 18.94646 / 21.60491 cd/m² | [L] `eotf_BT1886`; [P] BT.1886 Annex 1 |
| sRGB EOTF 0.5 / 0.02; inverse 0.18 | 0.2140411 / 0.0015480 (linear segment); 0.4613561 | [L] `eotf_sRGB`; [P] IEC 61966-2-1 |
| PQ inverse 100 / 203 / 1000 nit; PQ 0.5 | 0.5080784 / 0.5806889 / 0.7518271; 92.24571 nit | [L] `eotf_inverse_ST2084`; [P] ST 2084 constants (already pinned for 100/1000) |
| HLG OETF 1/12 / 0.5 / 1.0; inverse 0.75 | 0.5 / 0.8716435 / 1.0000000 (0.999999995) / 0.2649626 | [L] `oetf_BT2100_HLG`; [P] BT.2100 Table 5 (a, b, c) |
| HLG constants | a 0.17883277, b 0.28466892, c 0.559910729529562 | [P] BT.2100 |
| Narrow-range 10-bit Y′ at E′ = 0 / 0.5 / 1 | 64 / 502 / 940; 8-bit white 235; 12-bit 3760 | [P] BT.2100 Table 9 / BT.709 item 6.10 |
| Narrow-range 10-bit chroma at 0 / +0.5 | 512 / 960 | [P] |

### D3. Light & camera

| Case | Expected | Class / source |
|---|---|---|
| 1 fc | 10.763910416709722 lx | [X] ft = 0.3048 m (exact, 1959) |
| 1 ftL | 3.4262590996353905 cd/m² | [X] (1/π) cd/ft² |
| 14 ftL / 48 cd/m² | 47.9676 cd/m² / 14.0094 ftL | [X]; [P] SMPTE RP 431-1 48 cd/m² |
| 1000 cd at 2 m, 0° / 30° | 250 / 216.5064 lx | [X] |
| 1000 cd uniform cone, 30° full | Ω 0.21409435 sr; 214.0943 lm | [X] |
| Isotropic 1000 cd | 12566.37 lm (4π) | [X] |
| 5000 lm on 10 m², gain 1 | 159.1549 cd/m²; 46.4515 ftL | [X] Lambertian |
| EV f/8 1/125 / f/16 1/125 | 12.96578 / 14.96578 (≈ 13 / 15) | [X] |
| f/5.6, f/11 exact | 5.656854, 11.313708 | [X] √2 powers |
| Stops f/4 → f/11: nominal / exact | 2.9189 / 3.0000 | [X] |
| EV 0 at ISO 100, C 250 / K 12.5 | 2.5 lx / 0.125 cd/m² | [X] given C, K (ISO 2720 ranges) |
| 50 mm, f/8, c 0.03, s 5 m | H 10.4667 m; near 3.38937 m; far 9.52744 m | [F] textbook thin-lens. **Not independent:** cross-check against one published DoF table before pinning |
| AoV 36 mm / 50 mm; diagonal 43.27 mm | 39.5978° / 46.7930° | [X] |
| Mired 3200 / 5600 / 6500 / 2856 | 312.5 / 178.5714 / 153.8462 / 350.1401 | [X] |
| 3200 → 5600 shift | −133.9286 mired | [X] |
| CIE D xy at 6504 K | (0.31271406, 0.32911910) | [L] colour `CCT_to_xy_CIE_D`; [P] CIE 15 D65 (0.3127, 0.3290) to 4 d.p. |
| D50 at 5003 K | (0.34565305, 0.35859616) | [L]; [P] CIE 15 D50 (0.3457, 0.3585) |
| McCamy on D65 xy / illuminant A xy | 6505.08 / 2857.13 K | [L] `xy_to_CCT(method="McCamy 1992")` |

---

## E. Codebase-specific risks

**E1. A decibel is not a unit, and must never become one.**
- `dB`, `dBu`, `dBV`, `dBFS`, `dB SPL` and `Np` all return "not a unit this recognises" today (§A probe). That is correct.
- Adding any of them to `UNITS` (units.ts 108–307) would make `convert()` multiply by a factor, and dB is logarithmic: 94 dB SPL ≠ 94 × anything Pa. Two levels never add linearly (80 + 80 = 83.01, not 160).
- The refusal should **name the tool**. When `parseMeasured` sees a `dB` prefix, return "decibels are logarithmic and are not converted here; use Engineering › Audio › Levels & references". That is a units-builder edit to the message only, with no new key.
- Pin it in `avUnits.test.ts`: `convert(1, "dB", "Pa")`, `convert(1,"dBu","V")` and `parseMeasured("94 dB","Pa")` all non-numeric.

**E2. Alias collisions** (the `nm`/`Nm`/`KN` lesson, units.ts 318–321 comment).
- **`fL` = femtolitre** in haematology (MCV ≈ 90 fL). The assay suite is the obvious future consumer. Foot-lambert ships as **`ftL`** plus spelled-out aliases only. Pin: `convert(1,"fL","nit")` is null.
- **Data-rate shorthands.** `Mbps` must be a **UNITS key, not an alias**, or at least never a lowercase alias. `lookup` lowercases into ALIASES (units.ts 374), so an alias key `mbps` would capture `MBps` (megaBYTES per second) as megabits: **an 8× error**, the KB trap documented at 175–182. Pin: `convert(1,"MBps","bit/s")` is null or 8e6, **never 1e6**.
- **`S` is siemens** (units.ts 259). Samples per second must never be `S/s`/`kS/s`/`MS/s`. Today `kS/s` is "not recognised", but the day someone adds `kS` (kilosiemens) it becomes a conductance rate. Write sample rates in Hz. If a samples alias is wanted, it is `Sa/s` or `sps`, decomposing to frequency, with a pin that `kS/s → Hz` is refused.
- **`fs` is femtosecond** (units.ts 134) and is also the universal symbol for sample rate. It is safe today as a unitSolve **symbol** (A1 RIGHT). Pin `N = fs*t` with fs = 48 kHz → 96000 in `avUnits.test.ts`, so a future unitSolve tokenizer change cannot turn a sample rate into 10⁻¹⁵ s.
- **`fc` is also the cutoff-frequency symbol.** After adding the footcandle, re-probe `solveWithUnits("f = 1/(2*pi*R*C)\nR = 8 ohm\nC = 10 uF")` and any `fc = …` symbol case. A unit must never capture a symbol on the left of `=`.
- **`mPa` vs `MPa`** (MPa at 158) is 10⁹ apart. Both must be canonical UNITS keys; never add a lowercase alias such as `mpa`.
- **Case aliases** `FPS`, `KHz`, `NIT` are added as explicit ALIASES. Do **not** "fix" friction by making `lookup` case-insensitive on UNITS: that would merge `mS`/`MS`, `mW`/`MW` and `mPa`/`MPa`.

**E3. Drop-frame arithmetic.**
- DF is a **labelling** scheme. No frames are dropped from the picture, and real time is always frames × 1001/30000.
- Do the arithmetic in integers (frames) and rationals (seconds). A float `frames / 29.97` uses the wrong rate: a typed 29.97 is 1.0 ppm below 30000/1001, so elapsed time comes out about **3.6 ms per hour long**. The 108 per hour that people remember is the NDF label drift in **frames** (3.6 s), a different effect.
- Rate input is snapped to 30000/1001 and the snap is reported (B2).
- The skip rule is per minute **except multiples of 10**. Off-by-one sites: minute 0, minute 10, and the frame just before a skip (00:00:59;29 → 00:01:00;02).
- Validity must be refused, not normalised. The `timecode` library normalises `00:01:00;00` to 1798 (§D2), so the product must not be tested *against* that library for validity.

**E4. Mired (and anything reciprocal or logarithmic) is not a unit.**
- `convert()` is linear (`value*factor + offset`, units.ts 552–). mired = 10⁶/T is reciprocal, so a `mired` key with `dim: "temp"` would convert 6500 K to 6.5 mired-ish nonsense, silently.
- The same goes for EV and f-stops (log₂), and for dB (E1).
- These are calculator outputs. Pin `convert(1,"mired","K")` as null.
- Also: `M` is molarity (units.ts 270, after the v2.137.0 fix), so `M K^-1` spaced parses as mol·L⁻¹·K⁻¹. Never document mired as "MK⁻¹".

**E5. Frame quantisation in floating point** (video.ts 476, 484). `Math.ceil(total/frameMs)` with no tolerance bills an exact k-frame total as k + 1 (A1-4). Builder C snaps within 1e-9 relative and returns integer `frames`. Pin 15 × (1000/23.976) → 15 frames and the 4-stage 24 Hz case → 1 frame. The existing pin (video.test.ts 220–221, 4 frames at 60 Hz) must still hold.

**E6. The ratchets are counts, not names.**
- `FIGURE_BASELINE = 130` (engineering-audit.js 313) equals today's tool count.
- Add 17 tools without raising it, and **a tool that never draws passes**. The audit prints "RAISE" but does not fail.
- E raises it to exactly the measured count in the same commit.
- `CORPUS_FLOOR = 205` (check-figures.js 84) is being moved by other builders. Rebase onto the latest value and add only this round's corpus figures.
- `pane-audit.js` BASELINES do not cover Engineering (they cover Stats/Analyze/Assay/Finance), so it is not touched.

**E7. `ENG_GROUP_ORDER` is a closed list** (taskpane 11992). A calculator naming a group outside it is a build error. "Light & camera" must be added there by E before any D calculator is wired. B/C/D must not add their own pane entries.

**E8. Defaults that fail to parse insert NOTHING.** `engUnits` errors make `compute` return `ok: false`, so the audit records `NOTHING_INSERTED` for that tool. Every `parseMeasured` default in §B is in §C0. E's `avDefaults.test.ts` takes its strings from the new tools' `ENG_CALCS` field defaults (a source scan, as `engineeringRouting.test.ts` does), not from the hand-written table, so a default added later is covered too. Defaults read by lib parsers instead (band lists with `1k`, `10:11`, `4:3`, `1920×1080`) are pinned in the owning builder's parser test (§C0 note).

**E9. Exact display vs computed noise.** `parseMeasured("15°","°")` → 14.999999999999998 (deg→rad→deg). Any new output that echoes an input must go through `engNum`, never `String(x)`. The same holds for 1/1.001 rates (29.97002997…): display "29.97 (30000/1001)", not the float.

**E10. Taskpane parsers are untestable** (memory). The timecode parser, the `a/b` shutter-fraction reader, the band-list reader and the surface-list reader all live in `src/lib` (`timecode.ts`, `units.ts`, `audio.ts`) with their own tests. The pane only calls them.
