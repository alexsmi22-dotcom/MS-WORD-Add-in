// Discrete mathematics — the front door for the Solve kind "Discrete math".
//
// One kind, six engines, routed by SYNTAX rather than by a dropdown, because
// a student types "gcd 84 36" or "10 choose 3" or an edge list and should not
// have to classify it first. Each engine owns a recognisable surface form and
// answers null for anything else; the first engine to claim the input answers
// it. Where two engines could plausibly claim the same text, the order below
// is the tie-break and is pinned in discrete.test.ts.
//
// Every engine follows the house rules: exact integers (BigInt) wherever the
// mathematics is exact; every cap stated by name; refusals name what was
// refused and why; results that can be cross-checked are (a closed form is
// verified against iteration, a shortest path against brute force on small
// graphs, a minimised DFA against the original on sample strings); and what is
// displayed parses back (superscript digits are accepted on input).

export interface DiscreteResult {
  /** Eyebrow / heading. */
  title: string;
  /** Headline lines — the answer. */
  display: string[];
  /** Working, one line each. */
  steps: string[];
  /** Honest limits of what was computed. */
  caveats: string[];
  /** Optional figure (inline SVG) and its alt text, for the pane and the document. */
  svg?: string;
  alt?: string;
}

/** A recognised request that cannot be answered — the message says why. */
export class DiscreteError extends Error {}

import { tryNumberTheory } from "./numtheory";
import { tryCombinatorics } from "./combinatorics";
import { tryRecurrence } from "./recurrence";
import { tryPropLogic } from "./proplogic";
import { tryAutomata } from "./automata";
import { tryGraph } from "./graphs";

/** Superscript digits (and the superscript minus) → ^ digits, so "7¹⁰⁰ mod 13"
 *  and the displayed "3⁻¹ mod 7" read back as typed. */
export function foldSuperscripts(s: string): string {
  const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return s.replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => "^" + [...run].map((c) => (c === "⁻" ? "-" : String(SUP.indexOf(c)))).join(""));
}

export type DiscreteEngine = (input: string) => DiscreteResult | null;

/** Engine order is the tie-break. Automata and graphs are multi-line forms
 *  with a leading keyword or an edge list, so they come after the one-line
 *  engines that could never claim such input.
 *
 *  Each entry is a CLOSURE, not the function itself: every engine imports
 *  DiscreteError from this module, which makes the import graph a cycle, and
 *  under CommonJS a module loaded mid-cycle sees `undefined` for exports the
 *  other side has not yet assigned. A closure resolves the binding at call
 *  time, after every module has finished loading. */
export const ENGINES: { name: string; run: DiscreteEngine }[] = [
  { name: "number theory", run: (s) => tryNumberTheory(s) },
  { name: "combinatorics", run: (s) => tryCombinatorics(s) },
  { name: "recurrence", run: (s) => tryRecurrence(s) },
  // Automata before logic: a one-line "regex (a|b)*abb" carries the | that
  // logic reads as a strong symbol, and automata claims only keyword-led input.
  { name: "automata", run: (s) => tryAutomata(s) },
  { name: "propositional logic", run: (s) => tryPropLogic(s) },
  { name: "graph", run: (s) => tryGraph(s) },
];

/** null = empty input. Throws DiscreteError for a recognised-but-refused
 *  request, and returns a "not recognised" result (not an exception) when no
 *  engine claims the text, naming what each engine would accept. */
export function solveDiscrete(input: string): DiscreteResult | null {
  const raw = foldSuperscripts(input.replace(/\r/g, "")).trim();
  if (!raw) return null;
  for (const e of ENGINES) {
    const r = e.run(raw);
    if (r) return r;
  }
  return {
    title: "Not recognised",
    display: ["That is not one of the discrete-mathematics forms this kind reads."],
    steps: [
      "Number theory: gcd 84 36 · lcm 4 6 · 7^100 mod 13 · inverse 3 mod 7 · 3x ≡ 2 mod 7 · x ≡ 2 mod 3, x ≡ 3 mod 5 · factor 360 · is 97 prime · primes to 100 · phi 36 · divisors 36 · order of 2 mod 7 · primitive root mod 7",
      "Combinatorics: 10 choose 3 · C(10,3) · P(10,3) · 10! · multinomial 10: 3 2 5 · arrangements of MISSISSIPPI · derangements 5 · catalan 5 · bell 5 · stirling 5 2 · how many ways to choose 3 of 10",
      "Recurrences: a(n) = a(n-1) + a(n-2), a(0) = 0, a(1) = 1 · a(n) = 2a(n-1) + 3, a(0) = 1 · T(n) = 2T(n/2) + n (master theorem)",
      "Propositional logic: (p -> q) & ~q -> ~p · p | ~p · p -> q, p |= q · (p & q) == ~(~p | ~q) · dnf (p -> q) & r",
      "Automata: dfa / nfa blocks (states, alphabet, start, accept, transitions, test strings) · regex (a|b)*abb · to dfa · minimize · equivalent",
      "Graphs: an edge list, one edge per line (A-B, A->B, A-B 5), with an optional question first: shortest path A to F · mst · eulerian · bipartite · components · topological order · hamiltonian",
    ],
    caveats: [],
  };
}
