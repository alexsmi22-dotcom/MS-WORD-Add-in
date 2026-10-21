# Antibody (VH/VL numbering, CDRs, identity, claims) — scope

Gap item 3 of the 2026-10-21 "five gaps" directive. Antibody patents define their binders by CDRs, and a CDR means
nothing without its definition: the same VH has a 5-residue Kabat CDR-H1 and an 8-residue IMGT CDR1. JurisLab numbers
the user's own sequences and writes the tables and claim text an antibody application needs. **Nothing is predicted.**

## What it does

- **Reads** one or many chains: FASTA (`>name` lines) or blocks separated by blank lines; spaces, digits and lower case
  ignored; anything not one of the 20 amino-acid letters refused by name. A signal peptide before framework 1 and a
  constant region after framework 4 are trimmed and said.
- **Classifies** each chain: heavy (VH, or a VHH alone), κ light or λ light (from the J-region motif …EIK / …TVL, then
  framework 1).
- **Numbers** every residue by **Kabat**, **Chothia** and **IMGT**.
- **CDRs** by the **Kabat**, **Chothia**, **IMGT** and **AbM** definitions.
- **Tables**: CDRs of every chain; each chain's frameworks and CDRs with their positions; the full numbering;
  a **% identity** matrix (V domain, frameworks or CDRs).
- **Claim text**: the six-CDR claim naming the definition, the VH/VL claim and an "at least N% identical" claim, with
  SEQ ID NOs from a chosen start (optionally the CDR residues written out); a single-domain claim for a lone VHH.
- **SEQ ID table** (CDRs then VH/VL per antibody) and the **sequences with their CDRs marked** (bold, underlined,
  fixed-width, groups of ten).

## Method (lib/antibody.ts)

A variable domain's conserved landmarks fix every region: the first cysteine (Kabat L23 / H22, IMGT 23), the
tryptophan opening framework 2 (L35 / H36, IMGT 41, followed by WYQ / WVRQ-type motifs), the second cysteine
(L88 / H92, IMGT 104, after Y-Y/F) and the J motif F/W-G-x-G (L98 / H103, IMGT 118). Between landmarks each region is
numbered by its length:

| Region | Kabat | Chothia | IMGT |
| --- | --- | --- | --- |
| CDR-L1 | 24–34, insertions 27A… | insertions 30A… | 27–38 |
| CDR-L2 | 50–56 (52A…) | same | 56–65 |
| CDR-L3 | 89–97, insertions 95A… | same | 105–117 |
| CDR-H1 | 31–35, insertions 35A… | 26–32, insertions 31A… | 27–38 |
| CDR-H2 | 50–65, insertions 52A… | 52–56 | 56–65 |
| FR3 heavy | 66–94 with 82A–C | same | 66–104 (no 73) |
| CDR-H3 | 95–102, insertions 100A… | same | 105–117 |

IMGT CDRs fill from both ends toward the centre (27, 38, 28, 37 …), insertions alternating at the central pair
(33.1/32.1, 61.1/60.1, 112.1/111.1). λ chains and VH have no IMGT position 10 (λ has no Kabat L10). AbM: H26–H35B,
H50–H58, light as Kabat.

**Checked against an independent tool.** AntPack 0.3.8.6.3 (GPL; run locally, its output kept as a fixture, not its
code) numbered 23 public therapeutic V domains (trastuzumab, pertuzumab, adalimumab, rituximab, bevacizumab, cetuximab,
nivolumab, pembrolizumab, omalizumab, avelumab, durvalumab, belimumab, caplacizumab; κ, λ and VHH) and 138 variants
with CDRs lengthened (up to H3 22, L1 21) or shortened. Kabat and IMGT agree residue for residue on all 23 real chains
and on 134 of the 138 variants; the 4 others are deletions that shorten an L1 or L2 below natural lengths, where the
tools place the gap by sequence similarity — the CDR residues still agree, and the engine notes the convention.
Chothia CDRs agree with the tool's Martin numbering on all.

**Identity** is computed on the IMGT alignment: identical residues ÷ positions occupied in either chain (a gap counts
as a difference). Heavy is never compared with light.

## Pairing and SEQ ID NOs

- Chains pair by name: the role word (VH, VL, HC, LC, heavy, light, kappa, lambda, κ, λ, or a final H/L/K) is taken
  out and the rest must match, case aside — "X VH (clone 3)" pairs with "X VL (clone 3)", never with "(clone 4)". Pairs
  where both names carry a role word are made first. Only two unnamed chains pair without names. A lone heavy chain is a
  single-domain antibody only with the VHH hallmarks (two or more of F/Y37, E/Q44, R/C45, F/G/L47).
- The claims take their SEQ ID NOs from the table itself (antibody and role), never by matching descriptions. WIPO ST.26
  keeps sequences under four residues out of a listing, so such a CDR has no number and the claim writes it out.

## Known differences from AntPack

- IGLV5 λ chains: the two extra framework-3 residues are labelled Kabat L65A–B where AntPack uses L66A–B (three labels
  differ; the CDRs and the IMGT numbering agree). IGLV11-55 (R-V-S-G in framework 3) is not recognised, and its two extra
  residues are read into CDR-L2. Kabat insertions past 26 (very long H3s) are labelled 100AA, 100AB … where AntPack
  writes 100AA, 100BB ….

## Out of scope (stated)

- Germline assignment (closest human V/J genes) and humanness scores: they need a germline database (IMGT/V-QUEST).
- Constant-region (EU) numbering, T-cell receptors, bispecific formats beyond two domains in one sequence (an scFv,
  VH–linker–VL or VL–linker–VH, is read as two domains).
- Structure modelling, paratope prediction, developability.

## Tests

src/lib/__tests__/antibody.test.ts: the 161-sequence oracle, the published trastuzumab CDRs under all four
definitions, trimming, refusals, the reports and claim text.
