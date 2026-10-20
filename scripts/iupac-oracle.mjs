// Fetches OPSIN's reading of the IUPAC namer's names into the oracle's cache (src/lib/__tests__/fixtures/opsin-names.json).
// The jest gate (iupacOracle.test.ts) never touches the network: it fails on a name missing from the cache, and can
// write the missing names to a file for this script.
//
//   IUPAC_ORACLE_MISSING=missing.json npx jest iupacOracle   # lists the names the cache lacks
//   node scripts/iupac-oracle.mjs missing.json                # asks OPSIN for each, slowly, and caches the answers
//
// Only the namer's own names for generated and dictionary structures are sent — never document content. OPSIN is
// EMBL-EBI's public service (the endpoint the pane uses, src/lib/opsin.ts); requests are throttled to 2 a second.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, "..", "src/lib/__tests__/fixtures/opsin-names.json");
const ENDPOINT = "https://www.ebi.ac.uk/opsin/ws";

const list = process.argv[2];
if (!list) {
  console.error("usage: node scripts/iupac-oracle.mjs <missing-names.json>");
  process.exit(2);
}
const names = JSON.parse(fs.readFileSync(list, "utf8"));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fetched = 0, failed = 0;
for (const name of names) {
  if (name in cache) continue;
  let answer;
  for (let attempt = 0; attempt < 3 && answer === undefined; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(name)}.smi`);
      if (res.status === 200) answer = (await res.text()).trim();
      else if (res.status === 404) answer = null; // OPSIN cannot parse it: a gate failure, cached as such
      else await sleep(2000);
    } catch {
      await sleep(2000);
    }
  }
  if (answer === undefined) {
    failed++;
    continue;
  }
  cache[name] = answer;
  fetched++;
  await sleep(500);
}
const sorted = Object.fromEntries(Object.keys(cache).sort().map((k) => [k, cache[k]]));
fs.writeFileSync(CACHE, JSON.stringify(sorted, null, 1) + "\n");
console.log(`fetched ${fetched}, unreachable ${failed}, cache ${Object.keys(sorted).length}`);
if (failed) process.exit(1);
