# Compound tables from the register (v2.174.0)

Gap item 4. A medicinal-chemistry patent's Examples end with a table of the compounds made: number, structure, name,
formula, mass, and the chemist's own data (IC50, yield). JurisLab already numbers compounds as schemes are inserted
(the document's compound register, v2.167.0); this builds that table from the register in one insert.

## Where it lives

Reaction ▸ **Compounds in this document** (the register panel). The table belongs to the compounds the document has
numbered, so it sits beside the list of them rather than in a tool of its own.

## What goes in

- **Columns** (checkboxes): Structure, Name, Formula, MW (on by default); Exact mass, [M + H]⁺, SMILES.
- **Compounds**: all, or a selection — ranges of plain numbers (`1–5`), labels by name (`2a`, `S3`), primes
  normalised (`3'` = `3′`). An unknown label is named and nothing is inserted.
- **Your own columns**: comma-separated headings (`IC50 (nM), Yield (%)`), left empty to fill in Word.
- **Caption**: optional, above the table, as patent tables carry it.

## What comes out

One native, editable Word table, rows in compound-number order (`1, 2, 2a, 3, 10`), the number first.

| Column | Source |
| --- | --- |
| Structure | the stored structure drawn as the schemes draw it (ACS 1996 document settings, lib/cdxmlRender), rasterised at 300 dpi, at most 115 × 90 pt per cell — a smaller drawing keeps its ACS size |
| Name | the curated dictionary first (in the case chemists write it: o-xylene, ATP; a structure with R/S stereocentres takes the namer's descriptor-bearing name, so enantiomers are named alike), then the offline systematic namer (lib/iupacName) with its CIP descriptors; "—" where neither has a name, and a note says which and why |
| Formula | the register's Hill formula, typeset (C₉H₈O₄, C₄H₁₂N⁺) |
| MW | OpenChemLib relative weight, 2 decimals |
| Exact mass, [M + H]⁺ | lib/massspec on the parsed structure (monoisotopic); an ion's exact mass is its m/z (electron mass counted) and it has no [M + H]⁺; a salt or mixture has neither ("—", with a note — give the free base's by hand) |
| SMILES | the register's isomeric SMILES |

Every name the namer produced carries the status-line reminder to verify it before filing.

## Honest limits

- The table holds what the register holds: a compound drawn but never numbered is not in it.
- Names: the namer's subset (see lib/iupacName.ts); outside it the cell is "—", never a guess.
- Characterization data (NMR, HRMS) are not pulled into the table; the Characterization tool writes those paragraphs.
