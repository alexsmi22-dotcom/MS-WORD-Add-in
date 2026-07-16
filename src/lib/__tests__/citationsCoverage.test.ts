// What Table T10 actually covers here — and that the uncovered cases fail SAFELY.
//
// WHY THIS EXISTS (punch list #7)
// The pane now promises "Table T10 abbreviation is implemented for the 50 U.S.
// states only ... an unrecognised jurisdiction passes through unchanged rather than
// being guessed at." A coverage claim that nothing checks is just a sentence. These
// tests make it true, and fail if someone adds a territory to T10 without updating
// the promise — or, far worse, makes an unknown jurisdiction get mangled.
//
// Severity, stated honestly: unlike the finance disclosures this is NOT a
// wrong-number risk. An unrecognised jurisdiction is simply left long-form, which
// the drafter can see. The point is that the user should know the boundary rather
// than assume full T10 support and never check.
//
// T10 is applied via abbreviateCaseName, which runs T6 (organizational words)
// first — so these cases are written as real case names, the way a user meets them.

import { abbreviateCaseName } from "../citations";

describe("T10 abbreviates the 50 U.S. states inside a case name", () => {
  // NOTE these are all MODIFIER uses, not bare parties. "Smith v. California"
  // deliberately keeps "California" — the state is itself the party, so Rule
  // 10.2.1(f) forbids abbreviating it. An earlier draft of this file used bare
  // parties and "failed", which was the exception working correctly and the test
  // being wrong. The named-party cases are asserted separately below.
  test.each([
    ["Smith v. California Dep't of Transp.", "Cal."],
    ["Jones v. Pennsylvania R.R.", "Pa."],
    ["Doe v. Massachusetts Mut. Life Ins. Co.", "Mass."],
    ["Roe v. New York Life Ins. Co.", "N.Y."],
    ["Ford v. North Carolina Nat'l Bank", "N.C."],
    ["Lee v. Texas Instruments Inc.", "Tex."],
    ["Ray v. Wisconsin Elec. Power Co.", "Wis."],
  ])("%s contains %s", (name, abbrev) => {
    expect(abbreviateCaseName(name)).toContain(abbrev);
  });

  test("the never-abbreviated states stay whole even as modifiers", () => {
    // T10 lists these six with no abbreviation at all, so they must survive the
    // modifier path that shortens California -> Cal.
    for (const s of ["Alaska", "Hawaii", "Idaho", "Iowa", "Ohio", "Utah"]) {
      expect(abbreviateCaseName(`Smith v. ${s} Dep't of Revenue`)).toContain(s);
    }
  });
});

describe("uncovered jurisdictions pass through UNCHANGED, never guessed at", () => {
  // The exact claim the pane makes, and the one that matters most: a silently
  // INVENTED abbreviation would be worse than a long-form one, because the drafter
  // could not tell it was wrong by looking.
  test.each([
    ["Guam", "Smith v. Guam Power Auth."],
    ["Puerto Rico", "Smith v. Puerto Rico Elec. Auth."],
    ["Virgin Islands", "Smith v. Virgin Islands Port Auth."],
    ["Northern Mariana Islands", "Smith v. Northern Mariana Islands Ret. Fund"],
    ["Ontario", "Smith v. Ontario Hydro"],
    ["New South Wales", "Smith v. New South Wales Rail"],
  ])("%s survives verbatim", (jurisdiction, caseName) => {
    expect(abbreviateCaseName(caseName)).toContain(jurisdiction);
  });

  test("American Samoa is the one partial case — T6 reaches it before T10 could", () => {
    // "American Samoa" is NOT verbatim: T6 abbreviates the ORGANIZATIONAL word
    // "American" -> "Am." regardless of jurisdiction, giving "Am. Samoa". That T6
    // step is correct Bluebook. But real T10 gives "Am. Sam.", so what ships is a
    // PARTIAL abbreviation — right as far as it goes, incomplete as a T10 form.
    // Pinned so the half-way state is a known fact rather than a surprise, and so
    // adding "Samoa" to T10 later forces this test to be revisited.
    const out = abbreviateCaseName("Smith v. American Samoa Gov't");
    expect(out).toContain("Am. Samoa");
    expect(out).not.toContain("Am. Sam."); // the full T10 form is NOT implemented
  });
});

describe("the named-party exception (Rule 10.2.1(f)) still holds", () => {
  test("a bare state as a party is NOT abbreviated", () => {
    // The whole reason applyT10Geographic exists. "California v. Smith" keeps
    // California; abbreviating a party is a Bluebook error.
    expect(abbreviateCaseName("California v. Smith")).toContain("California");
    expect(abbreviateCaseName("California v. Smith")).not.toContain("Cal.");
  });

  test("a 'State of X' government party is NOT abbreviated", () => {
    expect(abbreviateCaseName("State of California v. Smith")).toContain("State of California");
  });

  test("United States stays intact", () => {
    expect(abbreviateCaseName("United States v. Smith")).toContain("United States");
  });
});

describe("nothing is mangled on the way through", () => {
  test("empty and junk input survive", () => {
    for (const s of ["", "   ", "Zzzz", "123"]) {
      expect(abbreviateCaseName(s)).toBe(s);
    }
  });
});
