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

## Pane

No new UI. The Chemical and Build readouts show "Systematic name: … (subset namer — verify before filing)" as
now. Names cover more structures, and every name has passed the oracle.

## Tests

The oracle corpus: generated parents × substituents × positions, a few hundred structures, all named or refused
by name. Hand-pinned names for each new rule. An independent adversarial review.
