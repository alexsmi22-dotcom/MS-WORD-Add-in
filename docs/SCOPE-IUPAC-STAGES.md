# Fuller IUPAC naming, in stages — scope

Organic-chem arc item 4. This builds on the subset namer (src/lib/iupacName.ts, v2.121.0). The rule is unchanged:
dictionary first, then a systematic name only when it is safe, and otherwise "No name: …" with the reason.
A wrong name in a patent is worse than none.

## The correctness oracle (every stage)

A name is right when it reads back to the same structure.

- `scripts/iupac-oracle.mjs` names a generated corpus of structures.
- It sends each name to OPSIN, the web service the pane already uses for name → structure, and compares the
  returned structure with the input by OpenChemLib idcode. The idcode carries stereo, so the check covers
  constitution and stereo.
- OPSIN's answers are cached in `src/lib/__tests__/fixtures/opsin-names.json`. Like the PubChem fixture, the
  jest gate runs offline from that cache.
- The gate requires zero mismatches over the whole corpus.
- A name OPSIN cannot parse is a failure. Each one is fixed or turned into a refusal by name.
- Style matters too: the house style is current IUPAC recommendations (P-2013 PIN where the namer can follow them).
  A PubChem comparison on a sample is reported, but it is not a gate. PubChem's names are Lexichem's, not PINs.

## Releases

Stage 1 ships as two releases, each with its own review rounds (advisor, 2026-10-20). **1a (v2.168.0)** covers
carbocycles only: items 1, 3, 4 and 5 below, carbocyclic part. **1b** covers the heteromonocycles (item 2),
because fixed heteroatom numbering, indicated hydrogen and tautomers are where wrong names hide.

**Retained names decided for 1a:**
- formic acid and acetic acid (substituted on carbon without a locant: chloroacetic acid, phenylacetic acid);
- formamide and acetamide (unsubstituted);
- phenol, aniline, benzoic acid, benzaldehyde, benzonitrile, benzamide.

So esters read "ethyl acetate", not "ethyl ethanoate". A lone principal group on a ring takes no locant:
cyclohexanol, cyclohexanecarboxylic acid.

## Stage 1 (v2.168.0 + 1b): the rings and groups organic patents use most

Today these are refused:

1. **Benzene principal groups, with retained parents:**
   - phenol, aniline, benzoic acid, benzaldehyde, benzonitrile, benzamide, each with prefix substituents
     (4-chlorophenol, 3-nitrobenzoic acid);
   - ketones on a benzene ring take the chain as parent: 1-phenylethan-1-one.
2. **Heteromonocycles, with retained names and fixed numbering:**
   - aromatic: pyridine, pyrimidine, pyrazine, pyridazine, furan, thiophene, 1H-pyrrole, 1H-imidazole,
     1H-pyrazole, 1,3-oxazole, 1,2-oxazole, 1,3-thiazole;
   - saturated: piperidine, piperazine, morpholine, pyrrolidine, oxolane, oxane;
   - prefix substituents, including on N (1-methylpiperidine);
   - one principal group: pyridin-2-amine, piperidin-4-one, pyridine-3-carboxylic acid, furan-2-carbaldehyde.
3. **Esters:** an alkyl or phenyl ester of any acid the namer names ("ethyl acetate", "methyl 4-nitrobenzoate",
   "ethyl pyridine-3-carboxylate").
4. **N-substituted amines and amides:** N-methyl, N,N-dimethyl, N-phenyl (N,N-dimethylaniline,
   N-ethylacetamide).
5. **Ring substituents on chains or rings:** phenyl, cycloalkyl, pyridinyl and the other stage-1 rings as
   substituents (2-phenylethan-1-ol, 4-(pyridin-2-yl)…). One level of nesting only.
6. Sulfur is allowed only inside the stage-1 rings (thiophene, thiazole).

**Out of stage 1, refused by name:**
- fused rings (naphthalene, indole, quinoline: stage 2);
- ring assemblies (biphenyl: stage 2);
- sulfonyl, sulfonamide, phosphorus;
- lactones and lactams named as such;
- more than one kind of principal group with prefixes beyond the existing set;
- carbamates, ureas, salts.

**1b shipped as v2.169.0** (the heteromonocycles of item 2, with heteroaryl substituents of item 5).

## Stage 2 — fused parents shipped as v2.170.0; ring assemblies, sulfonamides and carbamates still later

Fused parents (naphthalene, indole, quinoline, isoquinoline, benzimidazole, benzofuran, benzothiophene) with
fixed numbering; biphenyl and ring assemblies; sulfonamides and sulfones; Boc/Cbz carbamates as such.

## Stage 3 (directive 2026-10-21): the drug-like pieces still refused

Five releases, each with its own oracle corpus (including near-misses that must still refuse), hand-pinned name
FORMS taken from the 2013 recommendations' own examples (the oracle proves the structure, not the form), a PubChem
sample comparison, and independent review rounds. Order:

**3a — lactams, lactones and imides as heterocyclic ketones (P-66.1.4.1 / P-65.6.3.5).** The ring C=O beside the
ring heteroatom is named as a ketone of the saturated heterocycle, which is the 2013 form for cyclic amides and
esters: pyrrolidin-2-one, piperidin-2-one, 1-methylpyrrolidin-2-one, morpholin-3-one, oxolan-2-one, oxan-2-one,
piperazin-2-one; imides as diones: pyrrolidine-2,5-dione, piperidine-2,6-dione; cyclic anhydrides of the same
parents as their diones (oxolane-2,5-dione: the P-65.7.7 pseudoketone form — found by the review, kept and pinned). Lifts the "Lactams and lactones"
refusals in nameCore and the two "Lactones" refusals in prepare()'s ester loop (only for rings the namer names;
lactone rings it does not, such as a 4- or 8-membered ring, keep a refusal by name). Still refused: aromatic
pyridinones and oxazolones (added hydrogen), retained trivial names (γ-butyrolactone, succinimide: the dictionary's
job), a ring C=O beside a ring S (thiolactones), N-acyl lactams.

**3b — sulfonamides, sulfones, sulfonic acids.** Suffixes -sulfonic acid and -sulfonamide in their 2013 seniority
(below carboxylic acids and carboxamides respectively), N-substituted sulfonamides (prepare()'s N-cut extended to an
S(=O)₂ acyl), sulfonyl prefixes for sulfones — checked: P-65.3.2.2.2 makes "benzenesulfonyl" the preferred prefix
(phenylsulfonyl for general use) and P-65.4.1 gives "(propane-1-sulfonyl)benzene (PIN)" and "2-(methanesulfonyl)benzoic
acid (PIN)"; sulfamoyl is the preselected prefix for -SO₂NH₂ (P-66.1.1.4.2). Sulfur screens loosen to S(=O)₂ on carbon
only; thiols, thioethers, sulfoxides, sulfonate esters, sulfonyl halides and a sulfonyl on a ring N stay refused.
Shipped as v2.178.0.

**3c — carbamates.** Boc and Cbz as such: alkyl N-substituted carbamates on a chain N ("tert-butyl
N-(2-hydroxyethyl)carbamate", form to check against P-66.1.1.4.3), and on a RING N, where the 2013 form is the ring's
carboxylate ester ("tert-butyl piperidine-1-carboxylate") — to be confirmed in the recommendations before code.
Benzyl as an alcohol part (Cbz) needs classifySub to name benzyl; if it cannot be added safely, Cbz is refused by
name. Checked 2026-10-21: P-65.2.1.1's example "2-hydroxypropyl (2-aminoethyl)carbamate (PIN)" carries no N locant (so
"tert-butyl methylcarbamate"); "pyrrolidine-1-carboxylic acid (PIN)" confirms the ring-N carboxylate form; benzyl as an
ester part and the junior carbamate prefix (Boc-glycine) were not found verbatim, so both are refused by name. Shipped
as v2.179.0.

**3d — ring-on-ring and ring assemblies.** A ring parent carrying another ring system directly (4-phenylpyridine,
2-phenyl-1H-indole) lifts nameCore's "two or more separate ring systems" refusal; identical rings bonded directly
are a ring ASSEMBLY (1,1′-biphenyl, 2,2′-bipyridine — P-28), never "phenylbenzene" or "2-(pyridin-2-yl)pyridine"
(OPSIN reads those back correctly, so the oracle would not catch them: refused until named as assemblies). Primes
are ′ (U+2032) in shown and inserted names; what OPSIN accepts is checked before the oracle depends on it. As shipped (v2.180.0): ring-on-ring only — assemblies are REFUSED, because the forms of substituted assemblies
(square brackets, primed locants) were not found verbatim; seniority from P-44.1.1, P-44.2.1 (a)–(g) and P-44.4.1.1/2
read verbatim, in one ringRank shared with the N-branch choice; a snapshot gate (IUPAC_SNAPSHOT_WRITE/CHECK in
iupacOracle.test.ts) proved no existing name changed except the two Fixed entries.

**3e — partly saturated rings.** Hydro prefixes with indicated hydrogen on the fused parents: 2,3-dihydro-1H-indole,
1,2,3,4-tetrahydroquinoline, 1,2,3,4-tetrahydroisoquinoline, 2,3-dihydro-1-benzofuran (placement per P-31.1.4).
Highest risk; the oracle catches wrong hydro positions.

## Pane

No new UI. The Chemical and Build readouts show "Systematic name: … (subset namer — verify before filing)" as
now. Names cover more structures, and every name has passed the oracle.

## Tests

The oracle corpus: generated parents × substituents × positions, a few hundred structures, all named or refused
by name. Hand-pinned names for each new rule. An independent adversarial review.
