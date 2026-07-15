// Semantic-version comparison for the in-pane update check. The add-in is served
// from a static host (GitHub Pages) and loads its web files at runtime; to make
// sure users pick up a new release even when the browser/WebView2 cache is
// stubborn, the pane fetches a cache-busted version.json and compares it to the
// version baked into the running bundle. Pure; unit-tested.

/** Parses "1.2.3" into numeric components; missing/non-numeric parts count as 0. */
function parts(v: string): number[] {
  return v
    .trim()
    .split(".")
    .map((x) => {
      const n = parseInt(x, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/**
 * True when `server` is a strictly newer semantic version than `current`.
 * Compares component-by-component (so 1.10.0 > 1.9.0). Empty/garbage inputs
 * return false so a failed fetch never nags the user with a bogus update prompt.
 */
export function isNewerVersion(server: string, current: string): boolean {
  if (!server || !current) return false;
  const a = parts(server);
  const b = parts(current);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
