# CIP stereodescriptors: R/S and E/Z (scope)

Organic-chemistry arc, item 1 (user directive 2026-10-19: "everything possible" for organic chemists). Patent claims
name stereoisomers by CIP descriptors; a wrong (R)/(S) in a claim is worse than none. So: **refuse by name, never
guess**, and a release gate of **zero wrong labels** against an outside oracle.

## Measured baseline: OpenChemLib's own CIP (do not ship as is)

Scored against the CIP Validation Suite (Hanson et al., J. Chem. Inf. Model. 2018, 58, 1755; 300 structures, 290
labelled; no licence stated — fetched at gate time, never vendored), exact case, element-checked indices:

| Input | right | wrong | missing | extra |
|---|---|---|---|---|
| compounds.smi | 890 | 117 | 245 | 5 |
| compounds_2d.sdf (wedges) | 889 | 129 | 234 | 5 |

Wrong labels concentrate where OpenChemLib cannot answer at all (lowercase r/s pseudo-asymmetry, M/P axial/helical
reported as R/S on an allene's centre) and in the hard sequence rules (like/unlike, deep ties).

## Design

1. **Own ranking engine** (src/lib/cip.ts): the hierarchical digraph of IUPAC 2013 P-92 — duplicate atoms for ring
   closures and multiple bonds, rule 1a (atomic number), rule 1b (root distance of duplicates), rule 2 (mass number);
   explored breadth-first, sphere by sphere. Lone pairs are phantom atoms of lowest priority (sulfoxides, phosphines,
   sp³ N with a lone pair is not a stereocentre unless locked).
2. **Undecided is an answer**: when branches still tie after full exploration, the centre is "undecided — needs CIP
   rules 3–5" (pseudo-asymmetric r/s, like/unlike, some meso). A **work budget** caps exploration (cage and fused
   systems blow up); exceeded → "too complex to decide here". Never an unbounded loop (it would freeze Word).
3. **Shown only when two independent answers agree**: JurisLab's engine and OpenChemLib's. Disagreement → refused,
   with the reason. Axial and helical chirality (allenes, biaryls, helicenes) refused by name until M/P is built.
   No E/Z for double bonds in rings of fewer than 8 atoms.
4. **Geometry from what is drawn**: parities from the drawn wedges / 2D layout through OCL's parity perception;
   a centre drawn without a wedge (or with a wedge whose narrow end is at the far atom) is "unspecified", said so; a degenerate drawing (neighbours on top of each other or in one direction) is refused.

## Display (one source of truth)

- The readout under the canvas: "(2R,3S) — 2 stereocentres; C5: undecided (needs CIP rule 4)".
- Optional labels on the inserted picture (off by default), drawn by JurisLab — never OpenChemLib's own CIP letters
  (suppressCIPParity stays on everywhere; check the structure editor draws none).
- Never written into the molecule (no custom atom labels: they would travel into idcode, picture and alt text).
- rac / rel from the AND / OR stereo groups already stored: "rac-(2R,3S)", "rel-(2R,3S)".

## Shipped in v2.164.0 / later

- v2.164.0: the engine, the gate, the readouts (Build ▸ Draw and Text "Stereo" line; the Chemical name line with
  descriptors). Gate result: compounds.smi 835 right / 0 wrong / 0 extra; compounds_2d.sdf 834 / 0 / 0.
- Later: labels on the inserted picture (JurisLab-drawn, off by default); M/P for allenes and biaryls; rules 3–5
  (r/s, like/unlike); locants for ring names (the subset namer gives chain locants only).

## Gate and tests

- scripts/cip-suite.js: fetches the suite, scores the shipped function from SMILES and SDF, **fails on any wrong or
  extra label**, prints coverage. Run at every release touching it; result recorded in the CHANGELOG (QC is offline).
- Jest fixtures our own: 2-butanol (R, S), L-alanine (S), a sulfoxide, an oxime (E/Z), (E)/(Z)-but-2-ene, meso-tartaric
  acid (R,S), 2,3,4-trihydroxyglutaric acid C3 (must refuse: pseudo-asymmetric), an allene (refuse), a cyclohexene
  (no E/Z), a cage (budget refusal, time-bounded).
