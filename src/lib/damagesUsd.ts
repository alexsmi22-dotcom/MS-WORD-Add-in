/**
 * US-dollar amounts for the damages calculators (v2.201.0): the patent damages, interest and lost-earnings tools
 * work in US dollars (35 U.S.C. § 284, 28 U.S.C. § 1961), so every money amount they print carries "$". Finance's
 * finMoney and damagesInterest's moneyCents stay bare: the other Finance calculators are currency-neutral.
 */
import { ISO4217 } from "./currency";

/**
 * "$1,234.50" from grouped money text, with the minus before the sign ("−$1,234.50"). The non-finite sentinel "—"
 * is returned as it is, so the insert gates that look for it still see it.
 */
export function usd(amount: string): string {
  if (amount === "—") return amount;
  return amount.startsWith("−") ? `−$${amount.slice(1)}` : `$${amount}`;
}

/**
 * A US-dollar cell as typed, its dollar marking removed: "$1,000", "US$1,000", "USD$1,000", "U.S.$1,000",
 * "USD 1,000", "1,000 USD", "−$5", "$−5", "+$5" → the bare number text for the product's cell reader. Anything else is
 * returned trimmed and unchanged.
 */
export function stripUsd(raw: string): string {
  let t = raw.trim();
  let sign = "";
  const s0 = /^([+−–-])\s*/.exec(t);
  if (s0) {
    sign = s0[1] === "+" ? "" : s0[1];
    t = t.slice(s0[0].length);
  }
  const pre = /^(?:U\.?S\.?\s?\$|USD\s?\$|USD(?=[\s+−–-]|\d)|\$)\s*/i.exec(t);
  if (pre) t = t.slice(pre[0].length);
  else {
    const post = /\s*USD$/i.exec(t);
    if (post && /\d/.test(t.slice(0, post.index))) t = t.slice(0, post.index);
  }
  return sign + t;
}

/**
 * ISO 4217 codes that are also everyday capitalised words or names ("ALL PERIODS", "TOP SELLER", "AMD"), or damages
 * and licensing abbreviations (MDL multidistrict litigation, SSP standalone selling price, IRR internal rate of return,
 * SHP shipped, SVC service) for currencies a US damages table does not hold, and the two codes that name no currency
 * (XXX is also the usual redaction in a public expert report): never read as a currency.
 */
const CODE_WORDS = new Set([
  "ALL", "AMD", "BOB", "CUP", "GEL", "MAD", "MOP", "PEN", "SOS", "TOP", "TRY",
  "MDL", "SSP", "IRR", "SHP", "SVC",
  "XXX", "XTS",
]);

/** RMB (renminbi) and NTD (New Taiwan dollar) are how those currencies are usually written, though not ISO codes. */
const COMMON_CODES = new Set(["RMB", "NTD"]);

function isForeignCode(c: string): boolean {
  return c !== "USD" && !CODE_WORDS.has(c) && (ISO4217.has(c) || COMMON_CODES.has(c));
}

/** A code with an optional scale suffix: "EUR", "EURm", "EURmm", "EURk", "EURbn". */
const CODE = "([A-Z]{3})(?:mm|m|k|bn)?";

/**
 * Where a code names the currency of an amount. A code elsewhere is a word in a label ("per MDL order", "SSP",
 * "CAD SOFTWARE") and is not read as a currency.
 */
const CODE_POSITIONS: RegExp[] = [
  // Beside a number: "EUR 1,000", "EUR1,000", "1,000 CAD", "1000CAD", "1,000,000<tab>CAD".
  new RegExp(`(?<!\\p{L})${CODE}\\s?(?=[−–+-]?\\d)`, "gu"),
  new RegExp(`\\d\\s?${CODE}(?!\\p{L})`, "gu"),
  // Alone in brackets: "Revenue (EUR)", "[EURm]".
  new RegExp(`[(\\[]\\s*${CODE}\\s*[)\\]]`, "gu"),
  // After "in": "amounts in EUR".
  new RegExp(`(?<!\\p{L})in\\s+${CODE}(?!\\p{L})`, "giu"),
];

/** Currency names written out (pounds is left out: it is also a weight). */
const CURRENCY_WORDS = /(?<!\p{L})(euros?|yen|yuan|renminbi|sterling|rupees?|pesos?|francs?)(?!\p{L})/iu;

/** Dollars with a country prefix, in any case: C$, CA$, Can$, A$, AU$, Aus$, HK$, R$, MX$, Mex$, NT$, NZ$, S$, SG$. */
const PREFIXED_DOLLAR = /(?<!\p{L})(c|ca|can|a|au|aus|hk|r|mx|mex|nt|nz|s|sg)\$/iu;

/** What a pasted damages field names as its currency when that is not the US dollar, or undefined. */
function foreignCurrency(text: string): string | undefined {
  // A sign: €, £, ¥, ₹, ¢ … (full-width ＄ and small ﹩ are Unicode currency signs too, and are not "$").
  const sign = /[^\P{Sc}$]/u.exec(text);
  if (sign) return sign[0];
  const pd = PREFIXED_DOLLAR.exec(text);
  if (pd) return pd[0];
  const w = CURRENCY_WORDS.exec(text);
  if (w) return w[0];
  for (const re of CODE_POSITIONS) {
    for (const m of text.matchAll(re)) if (isForeignCode(m[1])) return m[0].replace(/^[\d\s(\[]+|[\s)\]]+$/g, "").replace(/^in\s+/i, "");
  }
  for (const line of text.split(/\r\n?|\n/)) {
    // A whole cell of a tab, semicolon or bar table: "Date<tab>Amount<tab>EUR".
    for (const cell of line.split(/[\t;|]/)) {
      const m = new RegExp(`^\\s*${CODE}\\s*$`, "u").exec(cell);
      if (m && isForeignCode(m[1])) return cell.trim();
    }
    // The last word of a line with no digits (a column-title line): "Year Revenue EUR".
    if (!/\d/.test(line)) {
      const m = new RegExp(`(?<!\\p{L})${CODE}\\s*$`, "u").exec(line);
      if (m && isForeignCode(m[1])) return m[0].trim();
    }
  }
  return undefined;
}

/**
 * A pasted damages field that names a currency other than the US dollar — a sign (€, £, ¥, ₹ …), a prefixed dollar
 * (C$, A$, HK$ …), a currency word (euros, yen …) or a code where a currency goes (EUR 1,000, Revenue (EUR), a CAD
 * column) — is refused by name. Before v2.201.0 the tables dropped such signs and skipped such titles silently; with
 * "$" now printed on every amount, €1,000,000 would have come out as $1,000,000.00.
 */
export function foreignCurrencyRefusal(text: string, what: string): string | undefined {
  const c = foreignCurrency(text);
  if (!c) return undefined;
  if (c === "¢") return `${what} contains “¢”: the damages calculators work in US dollars; type amounts in dollars as plain numbers (50¢ is 0.50).`;
  if (c === "＄" || c === "﹩") return `${what} contains “${c}”: the damages calculators work in US dollars; type amounts as plain numbers, or with the ordinary $ sign.`;
  return (
    `${what} names “${c}”, which is not the US dollar: the damages calculators work in US dollars and print every amount with $. ` +
    `Convert the amounts to US dollars first (Finance ▸ “Currency conversion with your rates”) and type them here as plain numbers (1,341.85).`
  );
}
