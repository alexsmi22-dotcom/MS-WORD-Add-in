// Which theme the pane should draw itself in.
//
// Three signals, and the order between them is the whole design:
//
//   1. An explicit choice by the user (Light / Dark) — always wins.
//   2. WORD's theme, when the host tells us — because the pane lives inside
//      Word, not on the desktop. A user running Word in Black theme on a light
//      OS should get a dark pane; matching the desktop instead would leave a
//      white slab bolted to a black application.
//   3. The OS `prefers-color-scheme`, when Word says nothing.
//
// Pure and host-free so it can be tested: the Office object is passed in rather
// than reached for.

export type ThemePref = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

/** True when `v` is one of the stored preference values. */
export function isThemePref(v: unknown): v is ThemePref {
  return v === "auto" || v === "light" || v === "dark";
}

/**
 * Relative luminance of a colour, 0 (black) to 1 (white), or null if unparseable.
 *
 * Office reports theme colours as hex strings, but not uniformly: Windows has
 * been observed returning 8-digit `#AARRGGBB` as well as `#RRGGBB`, and some
 * builds omit the `#`. Anything unrecognised returns null so the caller can fall
 * through to the next signal rather than guessing a theme from a bad parse.
 */
export function luminanceOf(color: string | null | undefined): number | null {
  if (typeof color !== "string") return null;
  let hex = color.trim().replace(/^#/, "");
  if (hex.length === 8) hex = hex.slice(2); // drop the leading alpha
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  // sRGB relative luminance (WCAG). The green weighting matters: #008000 is a
  // "dark" green by eye but only a naive average would call it light.
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/** What Word's own theme implies, or null when the host does not say. */
export function hostTheme(officeTheme: { bodyBackgroundColor?: string } | null | undefined): Theme | null {
  const lum = luminanceOf(officeTheme?.bodyBackgroundColor);
  if (lum === null) return null;
  // Word's "Dark Gray" body background sits around #666, so the cut is placed
  // above mid-grey rather than at it: Dark Gray is a dark theme.
  return lum < 0.45 ? "dark" : "light";
}

export interface ThemeSignals {
  /** The user's stored preference. */
  pref: ThemePref;
  /** Word's theme, if the host reported one. */
  host: Theme | null;
  /** Whether the OS asks for dark. */
  osPrefersDark: boolean;
}

/**
 * The theme to draw, and whether it should be pinned with an attribute.
 *
 * `attribute: null` means "write no data-theme and let the CSS media query
 * decide" — which keeps the pane live to an OS theme change with no listener,
 * and is only used when nothing more specific is known.
 */
export function resolveTheme(signals: ThemeSignals): { theme: Theme; attribute: Theme | null } {
  if (signals.pref === "light" || signals.pref === "dark") {
    return { theme: signals.pref, attribute: signals.pref };
  }
  if (signals.host) return { theme: signals.host, attribute: signals.host };
  return { theme: signals.osPrefersDark ? "dark" : "light", attribute: null };
}
