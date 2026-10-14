/**
 * The ONE linear-programming word-problem template: products × resources.
 *
 *   "A company makes chairs and tables. Each chair needs 2 hours of labor and
 *    1 unit of wood and earns $30; each table needs 3 hours and 2 units and
 *    earns $50. There are 120 hours and 70 units available. How many of each
 *    maximize profit?"
 *
 * The template reads the product list, one "each <product> needs … and earns …"
 * clause per product, one availability sentence, and the question. It PRINTS
 * the LP it built and hands it to lp.ts. Anything the template did not consume
 * ("at least 10 chairs", "demand", "setup cost") is a condition the model
 * would silently ignore, so the sentence is refused NAMING that clause — the
 * combinatorics `findUnmodelledCondition` pattern. Transportation, assignment,
 * diet and blending prose are refused by name with the typed-LP form shown.
 */
import { tryLp } from "./lp";
import type { VerbResult } from "./algebraTools";

/** Prose that looks like a products × resources problem, or a named LP family. */
export const LP_WORDS_RE =
  /\b(?:makes?|produces?|manufactures?|builds?|sells?|bakes?|assembles?|offers?)\b[\s\S]*\b(?:each|every|per)\b[\s\S]*\b(?:maximi[sz]e|maximum|most\s+profit|how\s+many\s+of\s+each|greatest\s+profit)\b|\b(?:transportation|transport|shipping|assignment|diet|blending|blend|mixing|nutrition)\s+(?:problem|model|question)\b/i;

const refuse = (title: string, why: string, extra: string[] = []): VerbResult => ({ title, lines: [], caveats: [why, ...extra] });
const TITLE = "Linear program from prose";

const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100" };
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi");

const UNIT_WORDS = "hours?|hrs?|units?|kg|kilograms?|kilos?|pounds?|lbs?|litres?|liters?|minutes?|mins?|metres?|meters?|m|feet|foot|ft|grams?|g|board[- ]feet|square\\s+(?:feet|metres|meters)|sq\\s+ft|tons?|tonnes?|gallons?|pieces?|sheets?|boards?|bags?|barrels?|ounces?|oz|days?|weeks?|machine[- ]hours?|labou?r[- ]hours?|person[- ]hours?|man[- ]hours?|worker[- ]hours?";

interface Need {
  qty: string;
  unit: string | null;
  resource: string | null;
}

const singular = (w: string): string => w.replace(/ies$/, "y").replace(/(ch|sh|x|s)es$/, "$1").replace(/s$/, "");
/** Every plausible singular of a plural noun, as a regex alternation: pies → pie|py|pies. */
const singularAlt = (w: string): string => {
  const c = new Set<string>([w]);
  if (/ies$/.test(w)) c.add(w.replace(/ies$/, "y"));
  if (/ves$/.test(w)) {
    c.add(w.replace(/ves$/, "f"));
    c.add(w.replace(/ves$/, "fe"));
  }
  if (/(ch|sh|x|s)es$/.test(w)) c.add(w.replace(/es$/, ""));
  if (/es$/.test(w)) c.add(w.replace(/s$/, ""));
  if (/s$/.test(w)) c.add(w.replace(/s$/, ""));
  return [...c].sort((a, b) => b.length - a.length).join("|");
};
const normUnit = (u: string | null): string | null => {
  if (!u) return null;
  const s = u.toLowerCase().replace(/\s+/g, " ").replace(/-/g, " ");
  return singular(s.replace(/^(hrs?)$/, "hour").replace(/^(mins?)$/, "minute").replace(/^lbs?$/, "pound").replace(/^(kilos?|kg)$/, "kilogram"));
};
const normRes = (r: string | null): string | null => (r ? singular(r.toLowerCase().trim().replace(/^(?:the|of)\s+/, "")) : null);

/** "2 hours of labor and 1 unit of wood" → [{2, hour, labor}, {1, unit, wood}]. */
function readNeeds(text: string): Need[] {
  const out: Need[] = [];
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})?\\s*(?:of\\s+)?([a-z][a-z ]*?)?(?=\\s*(?:,|;|\\band\\b|\\.|$))`, "gi");
  for (const m of text.matchAll(re)) {
    const unit = m[2] ? m[2] : null;
    let res = m[3] ? m[3].trim() : null;
    if (res && /^(?:of|and|each|per|every|the|a|an|to|available|in|stock|on\s+hand)$/i.test(res)) res = null;
    if (res && /\b(?:available|in stock|on hand|per week|per day|a week|a day|each week|each day)\b/i.test(res)) res = res.replace(/\b(?:are|is)?\s*(?:available|in stock|on hand|per week|per day|a week|a day|each week|each day)\b.*$/i, "").trim() || null;
    if (!unit && !res) continue;
    out.push({ qty: m[1], unit, resource: res });
  }
  return out;
}

// Conditions the template does not model, found in the residual after the
// consumed clauses are blanked out. Refused BY NAME.
const CONDITION_RE =
  /\b(?:at\s+least|at\s+most|no\s+more\s+than|no\s+fewer\s+than|no\s+less\s+than|not\s+more\s+than|not\s+less\s+than|minimum|maximum\s+of|up\s+to|demand|setup|set-up|fixed\s+cost|must|exactly|only|contract|contracted|discount|overtime|integer|whole\s+number|cannot|can't|limited\s+to|ratio|twice|half|percent|%|storage|warehouse|shipping|deadline|penalty|bonus|market|price\s+drops|economies)\b/i;

function clauseAround(text: string, idx: number): string {
  let s = idx;
  while (s > 0 && !/[.;,]/.test(text[s - 1])) s--;
  let e = idx;
  while (e < text.length && !/[.;,]/.test(text[e])) e++;
  return text.slice(s, e).trim();
}

export function tryLpWords(raw: string): VerbResult | null {
  let text = raw.replace(/\r/g, "").replace(/\s+/g, " ").trim();
  if (!LP_WORDS_RE.test(text)) return null;
  // A typed LP is lp.ts's business, not this template's.
  if (/^\s*(?:max(?:imi[sz]e)?|min(?:imi[sz]e)?)\b/i.test(text) && /[<>≤≥]=?/.test(text)) return null;

  // --- named families that are NOT read from prose ---
  if (/\b(?:transportation|transport|ship(?:ping|ped|s)?|warehouses?|plants?\s+to|destinations?|supplies\s+\d|supply\s+of\s+\d)\b/i.test(text) && /\b(?:supply|supplies|demand|demands|ship|shipping|warehouse|destination)\b/i.test(text)) {
    return refuse(TITLE, "Transportation problems are not read from prose — type the LP: minimize 2x11 + 3x12 + 4x21 + 1x22 subject to x11 + x12 <= 20, x21 + x22 <= 30 (the supply rows), x11 + x21 >= 25, x12 + x22 >= 25 (the demand rows), x11, x12, x21, x22 >= 0 — where xij is the amount shipped from source i to destination j.");
  }
  if (/\b(?:assign(?:ment|ed|ing)?)\b/i.test(text) && /\b(?:workers?|jobs?|tasks?|machines?|people|persons?|employees?)\b/i.test(text)) {
    return refuse(TITLE, "Assignment problems are not read from prose — type the LP: minimize 9x11 + 2x12 + 6x21 + 4x22 subject to x11 + x12 = 1, x21 + x22 = 1 (each worker one job), x11 + x21 = 1, x12 + x22 = 1 (each job one worker), x11, x12, x21, x22 >= 0 — where xij = 1 means worker i takes job j.");
  }
  if (/\b(?:diet|nutrients?|calories|vitamins?|protein|carbohydrates?|fat|minimum\s+daily|daily\s+requirement)\b/i.test(text)) {
    return refuse(TITLE, "Diet problems are not read from prose — type the LP: minimize 0.6x + 0.35y subject to 5x + 7y >= 8, 4x + 2y >= 15, x, y >= 0 — the cost per unit of each food in the objective, one ≥ row per nutrient requirement.");
  }
  if (/\b(?:blend(?:ing|ed|s)?|alloys?|mixture|mixing|octane|ore|grade)\b/i.test(text)) {
    return refuse(TITLE, "Blending problems are not read from prose — type the LP: minimize 3x + 5y subject to 0.2x + 0.5y >= 30 (the content requirement), x + y = 100 (the batch), x, y >= 0.");
  }

  // number words → digits
  text = text.replace(NUMBER_WORD_RE, (w) => NUMBER_WORDS[w.toLowerCase()]);
  text = text.replace(/\$\s*(?=\d)/g, "");
  const lower = text.toLowerCase();

  const consumed: string[] = [];
  const consume = (s: string): void => {
    consumed.push(s);
  };

  // --- products ---
  const prodM = /\b(?:makes?|produces?|manufactures?|builds?|sells?|bakes?|assembles?|offers?)\s+(?:\d+\s+)?(?:(?:kinds|types|lines|models)\s+of\s+(?:products?|items?|goods|furniture)\s*[,:]?\s*)?(?:products?\s*[,:]?\s*)?([a-z]+(?:\s*,\s*[a-z]+)*\s*,?\s+and\s+[a-z]+)/i.exec(lower);
  if (!prodM) return refuse(TITLE, "The products × resources template needs the product list: \"A company makes chairs and tables.\" (two to four products, named).");
  consume(prodM[0]);
  const products = prodM[1].split(/\s*,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
  if (products.length < 2 || products.length > 4) return refuse(TITLE, `The template reads two to four products; it read ${products.length} (${products.join(", ")}).`);
  const sing = products.map(singular);
  const varNames = ["x", "y", "z", "w"].slice(0, products.length);

  // --- each product's needs and profit ---
  const needs: Need[][] = [];
  const profits: string[] = [];
  for (let i = 0; i < products.length; i++) {
    const re = new RegExp(`\\b(?:each|every|per|a|one)\\s+(?:${singularAlt(products[i])})\\b\\s+(?:needs?|requires?|uses?|takes?|consumes?|calls\\s+for)\\s+(.+?)\\s+and\\s+(?:earns?|yields?|brings?(?:\\s+in)?|gives?|makes?|has|sells?\\s+for|contributes?|returns?|generates?)\\s+(?:a\\s+)?(?:profit\\s+(?:of\\s+)?)?(\\d+(?:\\.\\d+)?)(?:\\s+(?:in\\s+)?(?:profit|dollars|each|per\\s+unit|a\\s+unit))?`, "i");
    const m = re.exec(lower);
    if (!m) return refuse(TITLE, `No "each ${sing[i]} needs … and earns …" clause was found for ${products[i]} — the template needs one per product.`);
    sing[i] = new RegExp(`\\b(?:each|every|per|a|one)\\s+(${singularAlt(products[i])})\\b`, "i").exec(m[0])?.[1] ?? sing[i];
    consume(m[0]);
    const n = readNeeds(m[1]);
    if (!n.length) return refuse(TITLE, `Could not read the resources in “${m[1]}” for ${products[i]}: write "2 hours of labor and 1 unit of wood".`);
    needs.push(n);
    profits.push(m[2]);
  }

  // --- availability ---
  const availM = /\b(?:there\s+are|there\s+is|the\s+(?:company|firm|shop|factory|plant|workshop|bakery)\s+has|has\s+available|available\s*:?|(?:are|is)\s+available|in\s+stock|on\s+hand|supply\s+of|can\s+use\s+(?:at\s+most|up\s+to))\b/i.exec(lower);
  if (!availM) return refuse(TITLE, "No availability sentence was found: \"There are 120 hours and 70 units available.\"");
  const sentStart = lower.lastIndexOf(".", availM.index) + 1;
  const sentEndIdx = lower.indexOf(".", availM.index);
  const availSentence = lower.slice(sentStart, sentEndIdx < 0 ? undefined : sentEndIdx);
  consume(availSentence);
  const caps = readNeeds(availSentence.replace(/\b(?:there\s+are|there\s+is|available|in\s+stock|on\s+hand|has|the\s+company|the\s+firm|per\s+week|per\s+day|each\s+week|each\s+day|a\s+week|a\s+day)\b/gi, " "));
  if (!caps.length) return refuse(TITLE, `Could not read the capacities in “${availSentence.trim()}”.`);

  // --- the question ---
  const qM = /\b(?:how\s+many\s+of\s+each[^.?]*|(?:to\s+)?maximi[sz]e\s+(?:the\s+)?(?:total\s+)?(?:profit|revenue|earnings|income)[^.?]*|(?:what|which)\s+(?:production\s+)?(?:plan|mix)[^.?]*|maximum\s+profit[^.?]*)[.?]?/i.exec(lower);
  if (qM) consume(qM[0]);
  if (/\bminimi[sz]e\b/i.test(lower) && !/\bmaximi[sz]e\b/i.test(lower)) return refuse(TITLE, "This template maximises profit from products and resources; a minimisation in prose (cost, diet, blending) is typed as an LP: minimize … subject to ….");

  // --- resources: match each product's needs to the capacities ---
  const resources: { key: string; label: string; cap: string; unit: string | null }[] = [];
  const keyOf = (n: Need): string | null => normRes(n.resource) ?? normUnit(n.unit);
  caps.forEach((c, i) => {
    const key = keyOf(c) ?? `#${i}`;
    resources.push({ key, label: normRes(c.resource) ?? normUnit(c.unit) ?? `resource ${i + 1}`, cap: c.qty, unit: c.unit });
  });
  const A: string[][] = resources.map(() => varNames.map(() => "0"));
  for (let j = 0; j < products.length; j++) {
    const ns = needs[j];
    for (let k = 0; k < ns.length; k++) {
      const n = ns[k];
      let idx = -1;
      const rk = normRes(n.resource);
      const uk = normUnit(n.unit);
      if (rk) idx = resources.findIndex((r) => r.key === rk || normRes(r.label) === rk);
      // A NAMED requirement that matches no named capacity is a mismatch, not a cue to guess by unit.
      if (idx < 0 && rk && caps.some((c) => c.resource)) return refuse(TITLE, `“${n.qty}${n.unit ? " " + n.unit : ""} of ${n.resource}” for ${products[j]} names a resource that no stated capacity names (${resources.map((r) => `${r.cap}${r.unit ? " " + r.unit : ""} of ${r.label}`).join(", ")}).`);
      if (idx < 0 && uk) {
        const byUnit = resources.map((r, i) => (normUnit(r.unit) === uk ? i : -1)).filter((i) => i >= 0);
        if (byUnit.length === 1) idx = byUnit[0];
        else if (byUnit.length > 1) return refuse(TITLE, `“${n.qty} ${n.unit}” for ${products[j]} could match more than one capacity (${byUnit.map((i) => `${resources[i].cap} ${resources[i].unit}`).join(", ")}) — name the resource ("2 hours of labor").`);
      }
      if (idx < 0 && !rk && !uk) idx = k < resources.length ? k : -1;
      if (idx < 0 && ns.length === resources.length) idx = k;
      if (idx < 0) return refuse(TITLE, `“${n.qty}${n.unit ? " " + n.unit : ""}${n.resource ? " of " + n.resource : ""}” for ${products[j]} matches no stated capacity (${resources.map((r) => `${r.cap}${r.unit ? " " + r.unit : ""} of ${r.label}`).join(", ")}).`);
      if (A[idx][j] !== "0") return refuse(TITLE, `${products[j]} has two requirements for ${resources[idx].label} — the template reads one.`);
      A[idx][j] = n.qty;
      // a capacity stated only by its unit ("120 hours") takes the resource name a product clause gave it ("hours of labor")
      if (rk && !resources[idx].key.startsWith("#") && normRes(resources[idx].label) !== rk && !caps[idx].resource) resources[idx].label = rk;
    }
  }
  if (resources.some((r) => r.key.startsWith("#"))) {
    // unnamed capacity: only acceptable when every product listed needs positionally
    if (needs.some((ns) => ns.length !== resources.length)) return refuse(TITLE, "A capacity without a name or unit can only be matched by position, and the products list a different number of requirements — name the resources.");
  }

  // --- unmodelled clauses ---
  let residual = lower;
  for (const c of consumed) residual = residual.replace(c, " ");
  residual = residual.replace(/\b(?:a|an|the)\s+(?:company|firm|shop|factory|plant|workshop|bakery|manufacturer)\b/gi, " ");
  const cond = CONDITION_RE.exec(residual);
  if (cond) {
    const clause = clauseAround(residual, cond.index);
    return refuse(TITLE, `This problem has a condition (“${clause}”) that the products × resources template does not model — the plan without it would be wrong. Type the LP with that constraint written out: maximize … subject to …, ${clause.includes("at least") ? "x >= 10" : "…"}.`);
  }
  const leftoverNumber = /\d+(?:\.\d+)?/.exec(residual.replace(/\b\d+\s+(?:kinds|types|products|lines|models)\b/g, " "));
  if (leftoverNumber) {
    const clause = clauseAround(residual, leftoverNumber.index);
    return refuse(TITLE, `The number ${leftoverNumber[0]} in “${clause}” was not used by the template (products, per-unit needs, profits, capacities) — it would be silently ignored, so nothing is solved. Type the LP if that number is a constraint.`);
  }

  // --- build the LP ---
  const term = (c: string, v: string): string => (c === "1" ? v : /^\d+$/.test(c) ? `${c}${v}` : `${c}*${v}`);
  const obj = varNames.map((v, j) => term(profits[j], v)).join(" + ");
  const cons = resources.map((r, i) => `${varNames.map((v, j) => (A[i][j] === "0" ? null : term(A[i][j], v))).filter(Boolean).join(" + ")} <= ${r.cap}`);
  const lpText = `maximize ${obj} subject to ${cons.join(", ")}, ${varNames.join(", ")} >= 0`;
  const lines: VerbResult["lines"] = [];
  lines.push({ text: `Reading: ${varNames.map((v, j) => `${v} = number of ${products[j]}`).join(", ")}; profit ${varNames.map((v, j) => `${profits[j]} per ${sing[j]}`).join(", ")} (in $).` });
  resources.forEach((r, i) => lines.push({ text: `${r.label}: ${cons[i].replace("<=", "≤")}${r.unit ? ` ${r.unit}` : ""}` }));
  lines.push({ text: `LP built: ${lpText}` });
  const solved = tryLp(lpText);
  if (!solved) return refuse(TITLE, `The LP built from the prose (${lpText}) could not be solved by the LP verb.`);
  if (!solved.lines.length) return { title: TITLE, lines: [], caveats: [`The LP built from the prose was refused: ${solved.caveats.join(" ")}`, `LP built: ${lpText}`] };
  return {
    title: `${TITLE} — ${solved.title.replace(/^Linear program — /, "")}`,
    lines: [...lines, ...solved.lines],
    caveats: ["Read with the products × resources template: one ≤ row per resource, profit per unit in the objective; fractional plans are allowed unless the problem says integer.", ...solved.caveats],
    ...(solved.svg ? { svg: solved.svg, alt: solved.alt } : {}),
  };
}
