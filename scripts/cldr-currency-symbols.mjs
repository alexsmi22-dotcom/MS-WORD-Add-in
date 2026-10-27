/**
 * Currency symbols for fin-currency (v2.201.0): reads Unicode CLDR's en-001 (international English) currencies.json
 * and writes, for every ISO 4217 code in src/lib/__tests__/fixtures/iso4217-list-one.json whose CLDR symbol is not
 * the code itself, that symbol to src/lib/__tests__/fixtures/cldr-currency-symbols.json. The jest suite compares
 * CURRENCY_SYMBOLS in src/lib/currency.ts against it code by code.
 *
 * en-001 is CLDR's locale for English written for readers anywhere: it tells the dollars and yen apart (US$, CA$,
 * A$, JP¥, CN¥) where en-US writes plain $ and ¥. XXX's symbol (¤, "no currency") is left out: XXX is refused.
 *
 * Source: https://cdn.jsdelivr.net/npm/cldr-numbers-full@48.0.0/main/en-001/currencies.json (the cldr-json package
 * published by the Unicode Consortium, CLDR 48). Download it first, then:
 *
 * Run: node scripts/cldr-currency-symbols.mjs path/to/currencies.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIX = path.join(ROOT, "src", "lib", "__tests__", "fixtures");
const iso = JSON.parse(fs.readFileSync(path.join(FIX, "iso4217-list-one.json"), "utf8"));
const cldr = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const id = cldr.main["en-001"].identity;
const cur = cldr.main["en-001"].numbers.currencies;

const symbols = {};
for (const code of Object.keys(iso.codes).sort()) {
  const s = cur[code]?.symbol;
  if (s && s !== code && code !== "XXX") symbols[code] = s;
}
const out = {
  source: "Unicode CLDR 48, locale en-001, numbers/currencies symbol (cldr-numbers-full@48.0.0)",
  identity: id,
  symbols,
};
fs.writeFileSync(path.join(FIX, "cldr-currency-symbols.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`${Object.keys(symbols).length} symbols written`);
