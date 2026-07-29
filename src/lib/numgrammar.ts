// ONE definition of "what a typed number looks like".
//
// This exists because the same grammar was being written out by hand in each
// module that needed it, and each hand-written copy was subtly different. The
// copy in taskpane.ts's uncertainty parser was `[\d.eE+]+` — a character class,
// not a grammar — which allowed `+` but not `-`. So `a = 1e-3 ± 1e-4` failed the
// anchored match, the line was SILENTLY DISCARDED, and the user was then told
// 'Unknown variable "a"' about a variable defined two lines above on their own
// screen. The same loose class accepted `1.2.3`, which parseFloat quietly read
// as 1.2.
//
// A duplicated constant that drifts is a defect class this repo has already paid
// for more than once. Anything that needs to match a typed number imports from
// here.

/** A signed decimal with an optional exponent: `-1`, `.5`, `2.`, `1e-3`, `+1E+9`. */
export const NUM_DECIMAL = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;

/** The same, plus an optional `/ integer` tail so exact fractions can be typed. */
export const NUM_WITH_FRACTION = NUM_DECIMAL + String.raw`(?:\s*\/\s*[+-]?\d+)?`;

/** Anchored, for validating a whole field. */
export const NUM_DECIMAL_ONLY = new RegExp(`^\\s*(${NUM_DECIMAL})\\s*$`);
