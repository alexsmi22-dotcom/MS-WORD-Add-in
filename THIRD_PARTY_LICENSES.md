# Third-Party Licenses

This add-in ships the following runtime dependencies. All may be redistributed internally and externally; the
one LGPL component is shipped as separate, unmodified files (see below).

| Package      | Version | License      | Use |
| ------------ | ------- | ------------ | --- |
| openchemlib  | 8.x     | BSD-3-Clause | 2D structure rendering, molecule building, SMILES/IDCode |
| core-js      | 3.x     | MIT          | JavaScript polyfills |
| manifold-3d  | 3.5.4   | Apache-2.0   | Combining CAD parts (join, cut, overlap): `manifold.js` and `manifold.wasm`, shipped unmodified and loaded only when parts are combined |
| occt-import-js (Open CASCADE Technology) | 0.0.23 | LGPL-2.1 (OCCT: LGPL-2.1 with the Open CASCADE exception) | Reading STEP and IGES files in Drawing (CAD): `engines/occt-0.0.23/occt-import-js.js` and `occt-import-js.wasm`, shipped unmodified as separate files beside their licence texts, loaded at run time in a worker only when a STEP or IGES file is opened. Source: https://github.com/kovacsv/occt-import-js (and https://dev.opencascade.org) |
| Revvity ChemDraw file-format tables | 2025 | BSD-3-Clause | `src/lib/cdxTags.ts`: CDX tag, attribute and enum names, generated from github.com/Glysade/chemdraw (Revvity's open-source ChemDraw format code); its copyright and licence notice is kept at the head of that file |

Development-only dependencies (webpack, TypeScript, ts-loader, Jest, ts-jest,
office-addin-* tooling, etc.) are **not** shipped in the `dist/` bundle and do not
affect distribution licensing. Run `npx license-checker --production` to
regenerate a full list of bundled-license texts if required by policy.

Test fixtures `src/lib/__tests__/fixtures/US*.cdx` are drawings from published US patents (public documents), as used in RDKit's ChemDraw test data (BSD-3-Clause).

Test fixtures `src/lib/__tests__/fixtures/snapgene/*.dna` are SnapGene sample files from Biopython's test suite (Tests/SnapGene), distributed under the Biopython License Agreement / BSD-3-Clause (https://github.com/biopython/biopython/blob/master/LICENSE.rst). They are test data only and are not shipped in `dist/`.

Test fixtures `src/lib/__tests__/fixtures/longley.csv`, `grunfeld.csv` and `stackloss.csv` are the Longley (1967),
Grunfeld (1958) and Brownlee stack-loss datasets as bundled with statsmodels (`statsmodels.datasets`), exported by
`scripts/econ-ols-oracle.py`. Each dataset's COPYRIGHT in statsmodels reads: "This is public domain." The Longley
default typed into the econ-ols calculator is the same public-domain data. Test data only, except that default.

## License texts

Full license texts are available in each package under
`node_modules/<package>/LICENSE`. Summaries:

- **BSD-3-Clause** (OpenChemLib): permits use, modification, and redistribution
  with attribution; no endorsement using the project name.
- **MIT** (core-js): permits use, modification, and redistribution with the
  copyright and permission notice retained.
- **Apache-2.0** (manifold-3d): permits use, modification, and redistribution with
  the licence and any NOTICE retained; the files are shipped unmodified.
- **LGPL-2.1** (occt-import-js / Open CASCADE Technology): the library is used, not modified, and is shipped as its
  own files (`dist/engines/occt-0.0.23/`) loaded at run time — so it can be replaced by another build of the same
  library — with both licence texts (`license.occt-import-js.txt`, `license.occt.txt`) beside it. JurisLab's own
  code stays MIT. The library's source is available from the links in the table.

To verify current versions and licenses:

```bash
node -e "for (const d of ['openchemlib','core-js']) { const p=require(d+'/package.json'); console.log(d, p.version, p.license); }"
```
