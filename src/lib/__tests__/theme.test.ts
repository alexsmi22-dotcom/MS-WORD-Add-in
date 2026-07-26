// Theme resolution.
//
// The ordering is the design: an explicit choice beats Word, Word beats the OS.
// The failure that matters is a pane that ignores Word's Black theme because the
// desktop happens to be light.

import { luminanceOf, hostTheme, resolveTheme, isThemePref } from "../theme";

describe("reading a colour Office gave us", () => {
  test("plain 6-digit hex", () => {
    expect(luminanceOf("#ffffff")).toBeCloseTo(1, 5);
    expect(luminanceOf("#000000")).toBeCloseTo(0, 5);
  });

  test("accepts the forms Office actually emits", () => {
    // 8-digit #AARRGGBB has been observed on Windows, and some builds drop the #.
    expect(luminanceOf("#ffffffff")).toBeCloseTo(1, 5);
    expect(luminanceOf("ffffff")).toBeCloseTo(1, 5);
    expect(luminanceOf("#fff")).toBeCloseTo(1, 5);
  });

  test("returns null for anything it cannot parse, rather than guessing", () => {
    // A bad parse silently becomes a wrong theme, so this must fail loudly.
    for (const bad of ["", "not a colour", "#12", "rgb(0,0,0)", null, undefined, 42 as never]) {
      expect(luminanceOf(bad as string)).toBeNull();
    }
  });

  test("weights green as human vision does", () => {
    // A naive channel average would call pure green mid-grey.
    expect(luminanceOf("#00ff00")!).toBeGreaterThan(luminanceOf("#0000ff")!);
    expect(luminanceOf("#00ff00")!).toBeGreaterThan(luminanceOf("#ff0000")!);
  });
});

describe("what Word's theme implies", () => {
  test("Word's white body is a light theme", () => {
    expect(hostTheme({ bodyBackgroundColor: "#ffffff" })).toBe("light");
  });

  test("Word's Black theme is dark", () => {
    expect(hostTheme({ bodyBackgroundColor: "#000000" })).toBe("dark");
    expect(hostTheme({ bodyBackgroundColor: "#1f1f1f" })).toBe("dark");
  });

  test("Word's Dark Gray theme is dark, not light", () => {
    // ~#666666 sits near the middle; a cut at exactly mid-grey would call the
    // Dark Gray theme "light" and leave the pane white inside a dark Word.
    expect(hostTheme({ bodyBackgroundColor: "#666666" })).toBe("dark");
    expect(hostTheme({ bodyBackgroundColor: "#535353" })).toBe("dark");
  });

  test("Word's Colorful theme (light body) stays light", () => {
    expect(hostTheme({ bodyBackgroundColor: "#f3f2f1" })).toBe("light");
  });

  test("silence is null, not a default", () => {
    expect(hostTheme(null)).toBeNull();
    expect(hostTheme(undefined)).toBeNull();
    expect(hostTheme({})).toBeNull();
    expect(hostTheme({ bodyBackgroundColor: "garbage" })).toBeNull();
  });
});

describe("resolution order", () => {
  test("an explicit choice beats everything", () => {
    expect(
      resolveTheme({ pref: "light", host: "dark", osPrefersDark: true }),
    ).toEqual({ theme: "light", attribute: "light" });
    expect(
      resolveTheme({ pref: "dark", host: "light", osPrefersDark: false }),
    ).toEqual({ theme: "dark", attribute: "dark" });
  });

  test("on auto, WORD beats the OS", () => {
    // The case that matters: Word in Black on a light desktop.
    expect(
      resolveTheme({ pref: "auto", host: "dark", osPrefersDark: false }),
    ).toEqual({ theme: "dark", attribute: "dark" });
    // ...and the reverse, Word light on a dark desktop.
    expect(
      resolveTheme({ pref: "auto", host: "light", osPrefersDark: true }),
    ).toEqual({ theme: "light", attribute: "light" });
  });

  test("with no host signal, the OS decides and nothing is pinned", () => {
    // attribute null = write no data-theme, so the CSS media query stays live
    // and an OS theme change needs no listener.
    expect(resolveTheme({ pref: "auto", host: null, osPrefersDark: true })).toEqual({
      theme: "dark",
      attribute: null,
    });
    expect(resolveTheme({ pref: "auto", host: null, osPrefersDark: false })).toEqual({
      theme: "light",
      attribute: null,
    });
  });
});

describe("the stored preference", () => {
  test("accepts only the three values", () => {
    expect(isThemePref("auto")).toBe(true);
    expect(isThemePref("light")).toBe(true);
    expect(isThemePref("dark")).toBe(true);
    for (const bad of ["", "Dark", "system", null, undefined, 1, {}]) {
      expect(isThemePref(bad)).toBe(false);
    }
  });
});
