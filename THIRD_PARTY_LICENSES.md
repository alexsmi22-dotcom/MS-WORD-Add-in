# Third-Party Licenses

This add-in bundles the following runtime dependencies. Both are permissive and
may be redistributed internally and externally.

| Package      | Version | License      | Use |
| ------------ | ------- | ------------ | --- |
| openchemlib  | 8.x     | BSD-3-Clause | 2D structure rendering, molecule building, SMILES/IDCode |
| core-js      | 3.x     | MIT          | JavaScript polyfills |
| Revvity ChemDraw file-format tables | 2025 | BSD-3-Clause | `src/lib/cdxTags.ts`: CDX tag, attribute and enum names, generated from github.com/Glysade/chemdraw (Revvity's open-source ChemDraw format code); its copyright and licence notice is kept at the head of that file |

Development-only dependencies (webpack, TypeScript, ts-loader, Jest, ts-jest,
office-addin-* tooling, etc.) are **not** shipped in the `dist/` bundle and do not
affect distribution licensing. Run `npx license-checker --production` to
regenerate a full list of bundled-license texts if required by policy.

Test fixtures `src/lib/__tests__/fixtures/US*.cdx` are drawings from published US patents (public documents), as used in RDKit's ChemDraw test data (BSD-3-Clause).

## License texts

Full license texts are available in each package under
`node_modules/<package>/LICENSE`. Summaries:

- **BSD-3-Clause** (OpenChemLib): permits use, modification, and redistribution
  with attribution; no endorsement using the project name.
- **MIT** (core-js): permits use, modification, and redistribution with the
  copyright and permission notice retained.

To verify current versions and licenses:

```bash
node -e "for (const d of ['openchemlib','core-js']) { const p=require(d+'/package.json'); console.log(d, p.version, p.license); }"
```
