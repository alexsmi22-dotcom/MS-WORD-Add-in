/**
 * ISO 4217 currency codes and exact money arithmetic for fin-currency (Release E5a).
 *
 * THE TABLE: every alphabetic code in ISO 4217 "List One: Current currency & funds" as published by SIX Financial
 * Information AG, the ISO 4217 maintenance agency, list dated 2026-09-17 (the Pblshd attribute of
 * https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml),
 * one row per distinct code: alphabetic code, numeric code, minor units ("N.A." where the list gives none) and the
 * list's currency name; F marks the list's fund codes (IsFund="true"). 178 codes. scripts/iso4217-oracle.py reads the
 * downloaded XML and writes fixtures/iso4217-list-one.json; the jest suite checks this table against it code by code.
 *
 * Money is held as exact fractions (cas.ts Rat): a typed decimal is exact, a cross rate is the exact quotient of two
 * typed rates, and a converted amount is rounded once, half away from zero, to the target's minor unit. That is
 * damagesInterest.ts toCents generalised from 2 decimals to the currency's own minor unit, done exactly.
 */
import { ratDiv, ratMul, ratFromNumber, type Rat } from "./cas";
import { groupThousands } from "./regTable";

export const ISO4217_SOURCE = "ISO 4217 List One (current currency & funds), as published by SIX Financial Information AG, the ISO 4217 maintenance agency";
export const ISO4217_DATE = "2026-09-17";

const ISO4217_TEXT = `AED|784|2|UAE Dirham
AFN|971|2|Afghani
ALL|008|2|Lek
AMD|051|2|Armenian Dram
AOA|973|2|Kwanza
ARS|032|2|Argentine Peso
AUD|036|2|Australian Dollar
AWG|533|2|Aruban Florin
AZN|944|2|Azerbaijan Manat
BAM|977|2|Convertible Mark
BBD|052|2|Barbados Dollar
BDT|050|2|Taka
BHD|048|3|Bahraini Dinar
BIF|108|0|Burundi Franc
BMD|060|2|Bermudian Dollar
BND|096|2|Brunei Dollar
BOB|068|2|Boliviano
BOV|984|2|Mvdol|F
BRL|986|2|Brazilian Real
BSD|044|2|Bahamian Dollar
BTN|064|2|Ngultrum
BWP|072|2|Pula
BYN|933|2|Belarusian Ruble
BZD|084|2|Belize Dollar
CAD|124|2|Canadian Dollar
CDF|976|2|Congolese Franc
CHE|947|2|WIR Euro|F
CHF|756|2|Swiss Franc
CHW|948|2|WIR Franc|F
CLF|990|4|Unidad de Fomento|F
CLP|152|0|Chilean Peso
CNY|156|2|Yuan Renminbi
COP|170|2|Colombian Peso
COU|970|2|Unidad de Valor Real|F
CRC|188|2|Costa Rican Colon
CUP|192|2|Cuban Peso
CVE|132|2|Cabo Verde Escudo
CZK|203|2|Czech Koruna
DJF|262|0|Djibouti Franc
DKK|208|2|Danish Krone
DOP|214|2|Dominican Peso
DZD|012|2|Algerian Dinar
EGP|818|2|Egyptian Pound
ERN|232|2|Nakfa
ETB|230|2|Ethiopian Birr
EUR|978|2|Euro
FJD|242|2|Fiji Dollar
FKP|238|2|Falkland Islands Pound
GBP|826|2|Pound Sterling
GEL|981|2|Lari
GHS|936|2|Ghana Cedi
GIP|292|2|Gibraltar Pound
GMD|270|2|Dalasi
GNF|324|0|Guinean Franc
GTQ|320|2|Quetzal
GYD|328|2|Guyana Dollar
HKD|344|2|Hong Kong Dollar
HNL|340|2|Lempira
HTG|332|2|Gourde
HUF|348|2|Forint
IDR|360|2|Rupiah
ILS|376|2|New Israeli Sheqel
INR|356|2|Indian Rupee
IQD|368|3|Iraqi Dinar
IRR|364|2|Iranian Rial
ISK|352|0|Iceland Krona
JMD|388|2|Jamaican Dollar
JOD|400|3|Jordanian Dinar
JPY|392|0|Yen
KES|404|2|Kenyan Shilling
KGS|417|2|Som
KHR|116|2|Riel
KMF|174|0|Comorian Franc
KPW|408|2|North Korean Won
KRW|410|0|Won
KWD|414|3|Kuwaiti Dinar
KYD|136|2|Cayman Islands Dollar
KZT|398|2|Tenge
LAK|418|2|Lao Kip
LBP|422|2|Lebanese Pound
LKR|144|2|Sri Lanka Rupee
LRD|430|2|Liberian Dollar
LSL|426|2|Loti
LYD|434|3|Libyan Dinar
MAD|504|2|Moroccan Dirham
MDL|498|2|Moldovan Leu
MGA|969|2|Malagasy Ariary
MKD|807|2|Denar
MMK|104|2|Kyat
MNT|496|2|Tugrik
MOP|446|2|Pataca
MRU|929|2|Ouguiya
MUR|480|2|Mauritius Rupee
MVR|462|2|Rufiyaa
MWK|454|2|Malawi Kwacha
MXN|484|2|Mexican Peso
MXV|979|2|Mexican Unidad de Inversion (UDI)|F
MYR|458|2|Malaysian Ringgit
MZN|943|2|Mozambique Metical
NAD|516|2|Namibia Dollar
NGN|566|2|Naira
NIO|558|2|Cordoba Oro
NOK|578|2|Norwegian Krone
NPR|524|2|Nepalese Rupee
NZD|554|2|New Zealand Dollar
OMR|512|3|Rial Omani
PAB|590|2|Balboa
PEN|604|2|Sol
PGK|598|2|Kina
PHP|608|2|Philippine Peso
PKR|586|2|Pakistan Rupee
PLN|985|2|Zloty
PYG|600|0|Guarani
QAR|634|2|Qatari Rial
RON|946|2|Romanian Leu
RSD|941|2|Serbian Dinar
RUB|643|2|Russian Ruble
RWF|646|0|Rwanda Franc
SAR|682|2|Saudi Riyal
SBD|090|2|Solomon Islands Dollar
SCR|690|2|Seychelles Rupee
SDG|938|2|Sudanese Pound
SEK|752|2|Swedish Krona
SGD|702|2|Singapore Dollar
SHP|654|2|Saint Helena Pound
SLE|925|2|Leone
SOS|706|2|Somali Shilling
SRD|968|2|Surinam Dollar
SSP|728|2|South Sudanese Pound
STN|930|2|Dobra
SVC|222|2|El Salvador Colon
SYP|760|2|Syrian Pound
SZL|748|2|Lilangeni
THB|764|2|Baht
TJS|972|2|Somoni
TMT|934|2|Turkmenistan New Manat
TND|788|3|Tunisian Dinar
TOP|776|2|Pa’anga
TRY|949|2|Turkish Lira
TTD|780|2|Trinidad and Tobago Dollar
TWD|901|2|New Taiwan Dollar
TZS|834|2|Tanzanian Shilling
UAH|980|2|Hryvnia
UGX|800|0|Uganda Shilling
USD|840|2|US Dollar
USN|997|2|US Dollar (Next day)|F
UYI|940|0|Uruguay Peso en Unidades Indexadas (UI)|F
UYU|858|2|Peso Uruguayo
UYW|927|4|Unidad Previsional|F
UZS|860|2|Uzbekistan Sum
VED|926|2|Bolívar Soberano
VES|928|2|Bolívar Soberano
VND|704|0|Dong
VUV|548|0|Vatu
WST|882|2|Tala
XAD|396|2|Arab Accounting Dinar|F
XAF|950|0|CFA Franc BEAC
XAG|961|N.A.|Silver
XAU|959|N.A.|Gold
XBA|955|N.A.|Bond Markets Unit European Composite Unit (EURCO)
XBB|956|N.A.|Bond Markets Unit European Monetary Unit (E.M.U.-6)
XBC|957|N.A.|Bond Markets Unit European Unit of Account 9 (E.U.A.-9)
XBD|958|N.A.|Bond Markets Unit European Unit of Account 17 (E.U.A.-17)
XCD|951|2|East Caribbean Dollar
XCG|532|2|Caribbean Guilder
XDR|960|N.A.|SDR (Special Drawing Right)
XOF|952|0|CFA Franc BCEAO
XPD|964|N.A.|Palladium
XPF|953|0|CFP Franc
XPT|962|N.A.|Platinum
XSU|994|N.A.|Sucre
XTS|963|N.A.|Codes specifically reserved for testing purposes
XUA|965|N.A.|ADB Unit of Account
XXX|999|N.A.|The codes assigned for transactions where no currency is involved
YER|886|2|Yemeni Rial
ZAR|710|2|Rand
ZMW|967|2|Zambian Kwacha
ZWG|924|2|Zimbabwe Gold`;

export interface IsoCurrency {
  code: string;
  numeric: string;
  /** Minor units (decimal places), or null where the list gives "N.A.". */
  minor: number | null;
  name: string;
  fund: boolean;
}

export const ISO4217: ReadonlyMap<string, IsoCurrency> = new Map(
  ISO4217_TEXT.split("\n").map((line): [string, IsoCurrency] => {
    const [code, numeric, minor, name, fund] = line.split("|");
    return [code, { code, numeric, minor: minor === "N.A." ? null : Number(minor), name, fund: fund === "F" }];
  }),
);

/** Codes in the list that name no currency: they cannot be converted. */
export const NOT_A_CURRENCY: Record<string, string> = {
  XXX: "the ISO 4217 code for transactions where no currency is involved",
  XTS: "the ISO 4217 code reserved for testing",
};

export const CURRENCY_SYMBOL_SOURCE = "Unicode CLDR 48, international English (en-001)";

/**
 * The symbol CLDR 48 gives each code in en-001, CLDR's English for readers anywhere: it tells the dollars and yen apart
 * (US$, CA$, A$, JP¥, CN¥) where en-US writes plain $ and ¥. Only codes whose symbol is not the code itself are listed;
 * every other code is printed as its code. scripts/cldr-currency-symbols.mjs writes fixtures/cldr-currency-symbols.json
 * from CLDR's published currencies.json, and the jest suite checks this table against it code by code.
 */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  AUD: "A$",
  BRL: "R$",
  CAD: "CA$",
  CNY: "CN¥",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
  ILS: "₪",
  INR: "₹",
  JPY: "JP¥",
  KRW: "₩",
  MXN: "MX$",
  NZD: "NZ$",
  PHP: "₱",
  TWD: "NT$",
  USD: "US$",
  VND: "₫",
  XAF: "FCFA",
  XCD: "EC$",
  XCG: "Cg.",
  // CLDR writes a narrow no-break space (U+202F) inside "F CFA".
  XOF: "F" + String.fromCharCode(0x202f) + "CFA",
  XPF: "CFPF",
};

const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);

/**
 * An amount with its currency: "€1,234.50 (EUR)", "−US$12.00 (USD)", "FCFA 1,000 (XAF)"; a code with no symbol is
 * written once, "CHF 1,234.50". `amount` is grouped text with a true minus. The symbol touches the number when it
 * ends in a currency sign ($, ¥, €, ₹…) and is kept off it by a no-break space when it ends in a letter or a point;
 * spaces inside the symbol and before the bracketed code are no-break too, so Word never splits an amount across lines.
 * CLDR's narrow no-break space (XOF) is printed as an ordinary no-break space: not every Word font has U+202F.
 */
export function currencyAmount(amount: string, code: string): string {
  const neg = amount.startsWith("−");
  const abs = neg ? amount.slice(1) : amount;
  const sym = CURRENCY_SYMBOLS[code];
  if (!sym) return `${neg ? "−" : ""}${code}${NBSP}${abs}`;
  const glued = /\p{Sc}$/u.test(sym);
  return `${neg ? "−" : ""}${sym.split(" ").join(NBSP).split(NNBSP).join(NBSP)}${glued ? "" : NBSP}${abs}${NBSP}(${code})`;
}

/** |r| rounded half away from zero to `d` decimals, as an integer count of 10^−d units (sign kept). */
export function roundUnits(r: Rat, d: number): bigint {
  const scale = 10n ** BigInt(d);
  const neg = r.n < 0n;
  const num = (neg ? -r.n : r.n) * scale;
  let q = num / r.d;
  const rem = num - q * r.d;
  if (2n * rem >= r.d) q += 1n;
  return neg && q !== 0n ? -q : q;
}

/** Units of 10^−d as grouped text with exactly d decimals and a true minus ("−1,234.500"). */
export function unitsText(u: bigint, d: number): string {
  const neg = u < 0n;
  const a = (neg ? -u : u).toString().padStart(d + 1, "0");
  const int = a.slice(0, a.length - d);
  const frac = d > 0 ? "." + a.slice(a.length - d) : "";
  return (neg ? "−" : "") + groupThousands(int) + frac;
}

/** Decimal places of a terminating fraction (its denominator is 2^a·5^b), or null when it does not terminate. */
export function terminatingDecimals(r: Rat): number | null {
  let d = r.d;
  let k2 = 0;
  let k5 = 0;
  while (d % 2n === 0n) { d /= 2n; k2++; }
  while (d % 5n === 0n) { d /= 5n; k5++; }
  return d === 1n ? Math.max(k2, k5) : null;
}

/** A terminating fraction printed exactly, at least `minDp` decimals ("1,250.00"). */
export function exactText(r: Rat, minDp: number): string {
  const dp = Math.max(minDp, terminatingDecimals(r) ?? 12);
  return unitsText(roundUnits(r, dp), dp);
}

/**
 * Up to `sig` significant digits, half away from zero, trailing zeros dropped, never e-notation
 * (1/0.92 → "1.08696", 0.000676 stays "0.000676").
 */
export function sigText(r: Rat, sig = 6): string {
  if (r.n === 0n) return "0";
  const a = r.n < 0n ? -r.n : r.n;
  // e = floor(log10 |r|), found from digit counts and corrected by one comparison.
  let e = a.toString().length - r.d.toString().length;
  const ten = (k: number): bigint => 10n ** BigInt(Math.abs(k));
  const ge = (k: number): boolean => (k >= 0 ? a >= r.d * ten(k) : a * ten(k) >= r.d);
  if (!ge(e)) e--;
  else if (ge(e + 1)) e++;
  if (e >= sig - 1) {
    // Integer part longer than `sig` digits: round it to `sig` significant digits (123,456,789 → 123,457,000).
    const k = e - (sig - 1);
    const p = 10n ** BigInt(k);
    const u = roundUnits({ n: r.n, d: r.d * p }, 0) * p;
    return unitsText(u, 0);
  }
  const dp = sig - 1 - e;
  const t = unitsText(roundUnits(r, dp), dp);
  return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
}

export function cross(rateFrom: Rat, rateTo: Rat): Rat {
  return ratDiv(rateTo, rateFrom);
}

export function convert(amount: Rat, rateFrom: Rat, rateTo: Rat): Rat {
  return ratMul(amount, ratDiv(rateTo, rateFrom));
}

/** The exact fraction of a finite double's shortest decimal text (throws nothing: undefined when not finite). */
export function ratOf(v: number): Rat | undefined {
  if (!Number.isFinite(v)) return undefined;
  try {
    return ratFromNumber(v);
  } catch {
    return undefined;
  }
}
