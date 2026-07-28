// Composition comparison for chemical formula strings.
//
// CommonJS on purpose: ts-jest compiles a dynamic import() down to require(),
// which cannot load an ES module, so a .mjs version could not be unit tested at
// all. Node ESM imports named exports from CommonJS fine, so the verifier still
// gets `import { sameComposition } from "./formula-compare.cjs"`.
//
// Lives in its own module for ONE reason: verify-compounds-pubchem.mjs is a
// top-level script that runs the whole verification the moment it is imported,
// so nothing inside it can be unit tested. These two functions are the
// load-bearing logic of that check — they decide whether a compound is reported
// as a wrong molecule — and they were shipped untested.

/**
 * A formula string parsed into element -> count, or null if it is not a formula.
 *
 * WHY IT IS NOT A STRING COMPARE. Formulas used to be compared as text, so
 * "NH3" against OpenChemLib's Hill-ordered "H3N" read as a mismatch, and heme's
 * "C34H32N4O4Fe" against "C34H32FeN4O4" was reported as a WRONG MOLECULE. Those
 * are the same composition written in a different order, and they accounted for
 * 32 of the 46 entries the check once asked a human to review — for which the
 * true answer was zero problems.
 *
 * Charge suffixes ("-2", "+") are stripped: they are not composition, and
 * whether a salt is drawn ionically or covalently is a depiction choice.
 */
function parseFormula(f) {
  if (f === null || f === undefined) return null;
  const cleaned = String(f).replace(/[+-]\d*$/, "").trim();
  if (!cleaned || !/^[A-Za-z0-9]+$/.test(cleaned)) return null;
  // A formula cannot begin with a digit or a lowercase letter — "2H" and "cO"
  // are not formulas, and accepting them would let junk compare equal.
  if (!/^[A-Z]/.test(cleaned)) return null;
  const counts = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[0] === "") break;
    consumed += m[0].length;
    if (m[2]) {
      // A count long enough to lose precision as a double stops being a number
      // and starts being a way to make two DIFFERENT formulas compare equal:
      // 300 digits parses to 1.11e299, and a different 300-digit count parses to
      // the same thing. No real formula approaches this — the largest known
      // molecules are six digits of carbon — so anything beyond a sane bound is
      // not a formula. Found by an adversarial probe, not by a real input.
      if (m[2].length > 9) return null;
      counts[m[1]] = (counts[m[1]] ?? 0) + parseInt(m[2], 10);
    } else {
      counts[m[1]] = (counts[m[1]] ?? 0) + 1;
    }
  }
  // Anything the element pattern could not account for means this is not a
  // formula, and guessing at it would be worse than saying so.
  return consumed === cleaned.length ? counts : null;
}

/**
 * True when two formula strings describe the same composition, whatever their
 * order. Returns FALSE when either side is unparseable — an unknown is not a
 * match, because treating "could not read this" as agreement is how a check
 * goes quiet.
 */
function sameComposition(a, b) {
  const pa = parseFormula(a);
  const pb = parseFormula(b);
  if (!pa || !pb) return false;
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  for (const k of keys) if ((pa[k] ?? 0) !== (pb[k] ?? 0)) return false;
  return true;
}

module.exports = { parseFormula, sameComposition };
