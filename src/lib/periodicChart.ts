// Drawings of atomic structure, every one of them COMPUTED from the element's
// electron count rather than looked up.
//
// That is what makes this part of the periodic-table feature buildable without a data
// source: a Bohr diagram is the shell occupancy drawn as rings, an orbital diagram is
// the aufbau filling drawn as boxes, and the table layout is period and group drawn as
// a grid. All three fall out of periodic.ts, which generates them from the aufbau rule.
//
// The measured properties — melting points, density, spectral lines, and the rest —
// are NOT here and are reported as absent, because they need a citation rather than a
// recollection. The one place that distinction gets subtle is the electron
// configuration itself: about twenty elements are measured to differ from the aufbau
// prediction, so every drawing that shows a configuration says it is predicted.

import {
  atomicNumber,
  symbolFor,
  atomicWeight,
  electronConfiguration,
  configurationString,
  nobleGasConfiguration,
  shellOccupancy,
  placement,
  isNobleGas,
  ELEMENT_COUNT,
  ELEMENT_SYMBOLS,
  SHELL_LETTERS,
  ABSENT_PROPERTIES,
  Subshell,
} from "./periodic";
import { INK } from "./chartPalette";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SUBSHELL_LETTER = ["s", "p", "d", "f"] as const;

/** The caveat that must accompany any configuration this tool computes. */
export const AUFBAU_CAVEAT =
  "This configuration is PREDICTED by the aufbau principle, not measured. About twenty " +
  "elements — chromium and copper are the textbook pair — have an experimentally " +
  "determined configuration that differs, and those measurements are not carried by this " +
  "tool. For the great majority of elements the prediction is correct, and it is what the " +
  "principle gives.";

// ---------------------------------------------------------------------------
// Bohr model
// ---------------------------------------------------------------------------

/**
 * The Bohr model: concentric shells with their electrons.
 *
 * Worth saying what this is: the Bohr model is a TEACHING MODEL, superseded as physics
 * by the orbital picture. It gets the shell counts right and the shapes wrong, and
 * drawing it without saying so would present a 1913 model as current. The note below
 * the figure says it.
 */
export function buildBohrSvg(z: number, W = 320, H = 320): { svg: string; notes: string[] } | null {
  const shells = shellOccupancy(z);
  const sym = symbolFor(z);
  if (!shells || !sym) return null;

  const cx = W / 2;
  const cy = H / 2;
  const maxR = Math.min(W, H) / 2 - 16;
  const nucleusR = 13;
  const step = shells.length > 0 ? (maxR - nucleusR - 6) / shells.length : 0;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${INK.surface}"/>`);

  shells.forEach((count, i) => {
    const r = nucleusR + 6 + step * (i + 1);
    p.push(
      `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${INK.gridline}" stroke-width="1"/>`,
    );
    // Electrons spaced evenly around the ring. Starting at -90° puts the first at the
    // top, which is where a reader expects to begin counting.
    for (let k = 0; k < count; k++) {
      const a = (-90 + (360 * k) / count) * (Math.PI / 180);
      const ex = cx + r * Math.cos(a);
      const ey = cy + r * Math.sin(a);
      p.push(`<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3" fill="${INK.primary}"/>`);
    }
    // The shell letter and its count, on the left where the ring meets the axis.
    p.push(
      `<text x="${(cx - r - 2).toFixed(1)}" y="${(cy - 3).toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial, sans-serif" font-size="9" fill="${INK.muted}">` +
        `${SHELL_LETTERS[i] ?? `n=${i + 1}`}:${count}</text>`,
    );
  });

  p.push(`<circle cx="${cx}" cy="${cy}" r="${nucleusR}" fill="${INK.surface}" stroke="${INK.primary}" stroke-width="1.5"/>`);
  p.push(
    `<text x="${cx}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" ` +
      `font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="${INK.primary}">${esc(sym)}</text>`,
  );
  p.push(
    `<text x="8" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${INK.secondary}">` +
      `Z = ${z} · ${shells.join("-")}</text>`,
  );
  p.push("</svg>");

  return {
    svg: p.join(""),
    notes: [
      "The Bohr model is a TEACHING MODEL from 1913, not current physics: it gets the number of " +
        "electrons in each shell right and their shape and position wrong. Electrons do not orbit " +
        "the nucleus in rings; the orbital diagram is the better picture of where they are.",
      AUFBAU_CAVEAT,
    ],
  };
}

// ---------------------------------------------------------------------------
// Orbital box diagram
// ---------------------------------------------------------------------------

/**
 * The orbital filling diagram — one box per orbital, arrows for electrons.
 *
 * HUND'S RULE IS APPLIED, and it is the whole reason this diagram is worth drawing
 * rather than just writing "2p4": within a subshell every orbital takes one electron
 * before any takes a second, so 2p4 is up-down, up, up and not up-down, up-down. That
 * is the fact the picture carries and the written configuration does not.
 */
export function buildOrbitalSvg(z: number, W = 460, H?: number): { svg: string; notes: string[] } | null {
  const cfg = electronConfiguration(z);
  const sym = symbolFor(z);
  if (!cfg || !sym) return null;

  const BOX = 17;
  const GAP = 3;
  const ROW = 26;
  const LEFT = 44;
  // THE FIGURE GROWS TO FIT, rather than cropping. A fixed height silently dropped the
  // outer subshells of the heavy elements — gold and oganesson came out the same size,
  // with oganesson's 7p simply missing and nothing saying so. A diagram that is cut off
  // without a word is indistinguishable from a complete one.
  const height = H ?? 36 + cfg.length * ROW;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">`);
  p.push(`<rect width="${W}" height="${height}" fill="${INK.surface}"/>`);
  p.push(
    `<text x="8" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="600" ` +
      `fill="${INK.primary}">${esc(sym)} — orbital filling (Z = ${z})</text>`,
  );

  let y = 28;
  let drawn = 0;
  for (const s of cfg) {
    // Only reachable when a caller forces a height too small; the default cannot crop.
    if (y + ROW > height - 8) break;
    drawn++;
    const orbitals = 2 * s.l + 1;
    p.push(
      `<text x="8" y="${(y + BOX - 4).toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" ` +
        `font-size="10" fill="${INK.secondary}">${s.n}${SUBSHELL_LETTER[s.l]}</text>`,
    );
    // HUND'S RULE: singly occupy every orbital before pairing any.
    const singles = Math.min(s.electrons, orbitals);
    const pairs = Math.max(0, s.electrons - orbitals);
    for (let o = 0; o < orbitals; o++) {
      const x = LEFT + o * (BOX + GAP);
      p.push(
        `<rect x="${x}" y="${y}" width="${BOX}" height="${BOX}" fill="none" ` +
          `stroke="${INK.baseline}" stroke-width="1"/>`,
      );
      const up = o < singles;
      const down = o < pairs;
      if (up) {
        p.push(
          `<line x1="${x + 5}" y1="${y + BOX - 3}" x2="${x + 5}" y2="${y + 3}" stroke="${INK.primary}" ` +
            `stroke-width="1.2"/><path d="M${x + 5} ${y + 3} l-2.2 3.4 l4.4 0 z" fill="${INK.primary}"/>`,
        );
      }
      if (down) {
        p.push(
          `<line x1="${x + BOX - 5}" y1="${y + 3}" x2="${x + BOX - 5}" y2="${y + BOX - 3}" ` +
            `stroke="${INK.primary}" stroke-width="1.2"/>` +
            `<path d="M${x + BOX - 5} ${y + BOX - 3} l-2.2 -3.4 l4.4 0 z" fill="${INK.primary}"/>`,
        );
      }
    }
    p.push(
      `<text x="${(LEFT + orbitals * (BOX + GAP) + 6).toFixed(1)}" y="${(y + BOX - 4).toFixed(1)}" ` +
        `font-family="Segoe UI, Arial, sans-serif" font-size="9.5" fill="${INK.muted}">` +
        `${s.electrons}/${s.capacity}</text>`,
    );
    y += ROW;
  }
  p.push("</svg>");

  const notes: string[] = [];
  if (drawn < cfg.length) {
    notes.push(
      `Only ${drawn} of this element's ${cfg.length} subshells fit in the height requested, so the ` +
        "diagram is INCOMPLETE. Ask for a taller figure — the default grows to fit.",
    );
  }
  return {
    svg: p.join(""),
    notes: [
      ...notes,
      "Hund's rule is applied: within a subshell each orbital takes one electron before any takes " +
        "a second, so 2p⁴ is drawn as a pair and two singles rather than as two pairs. That is the " +
        "fact this picture carries which the written configuration does not.",
      AUFBAU_CAVEAT,
    ],
  };
}

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------

/**
 * The periodic table as a grid, laid out from each element's computed period and
 * group, with the f-block series beneath.
 *
 * The f series sits outside the numbered groups deliberately: whether lanthanum or
 * lutetium belongs in group 3 is a genuinely open question of convention that IUPAC has
 * not closed, so taking a side would present one convention as fact.
 */
export function buildPeriodicTableSvg(highlight?: string): { svg: string; notes: string[] } {
  const CELL = 30;
  const GAP = 2;
  const LEFT = 16;
  const TOP = 30;
  const F_TOP = TOP + 7 * (CELL + GAP) + 18;

  const W = LEFT * 2 + 18 * (CELL + GAP);
  const H = F_TOP + 2 * (CELL + GAP) + 30;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${INK.surface}"/>`);
  p.push(
    `<text x="${LEFT}" y="18" font-family="Segoe UI, Arial, sans-serif" font-size="12" ` +
      `font-weight="600" fill="${INK.primary}">Periodic table — ${ELEMENT_COUNT} elements</text>`,
  );

  // The f series is drawn in atomic-number order in its two rows.
  const fRow: Record<number, number> = { 6: 0, 7: 1 };
  const fSeen: Record<number, number> = { 0: 0, 1: 0 };

  for (let z = 1; z <= ELEMENT_COUNT; z++) {
    const pl = placement(z);
    const sym = symbolFor(z);
    if (!pl || !sym) continue;

    let x: number;
    let y: number;
    if (pl.fSeries) {
      const row = fRow[pl.period] ?? 0;
      const col = fSeen[row]++;
      x = LEFT + (col + 2) * (CELL + GAP);
      y = F_TOP + row * (CELL + GAP);
    } else {
      x = LEFT + ((pl.group as number) - 1) * (CELL + GAP);
      y = TOP + (pl.period - 1) * (CELL + GAP);
    }

    const on = highlight !== undefined && highlight === sym;
    p.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${on ? "#cde2fb" : INK.surface}" ` +
        `stroke="${on ? "#2a78d6" : INK.baseline}" stroke-width="${on ? 1.8 : 1}"/>`,
    );
    p.push(
      `<text x="${x + 2}" y="${y + 9}" font-family="Segoe UI, Arial, sans-serif" font-size="6.5" ` +
        `fill="${INK.muted}">${z}</text>`,
    );
    p.push(
      `<text x="${x + CELL / 2}" y="${y + 22}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial, sans-serif" font-size="11" fill="${INK.primary}">${esc(sym)}</text>`,
    );
  }

  // Group numbers along the top, period numbers down the side.
  for (let g = 1; g <= 18; g++) {
    p.push(
      `<text x="${(LEFT + (g - 1) * (CELL + GAP) + CELL / 2).toFixed(1)}" y="${TOP - 4}" ` +
        `text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="8" ` +
        `fill="${INK.muted}">${g}</text>`,
    );
  }
  for (let per = 1; per <= 7; per++) {
    p.push(
      `<text x="${LEFT - 5}" y="${(TOP + (per - 1) * (CELL + GAP) + CELL / 2 + 3).toFixed(1)}" ` +
        `text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="8" fill="${INK.muted}">${per}</text>`,
    );
  }
  p.push(
    `<text x="${LEFT}" y="${(F_TOP - 5).toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" ` +
      `font-size="8" fill="${INK.muted}">f-block series (lanthanides, actinides)</text>`,
  );
  p.push("</svg>");

  return {
    svg: p.join(""),
    notes: [
      "The f-block series is drawn beneath the table and outside the numbered groups. Whether " +
        "lanthanum or lutetium belongs in group 3 — and correspondingly actinium or lawrencium — " +
        "is an open question of convention that IUPAC has not settled, so this table does not take " +
        "a side by assigning one of them.",
    ],
  };
}

// ---------------------------------------------------------------------------
// The element report
// ---------------------------------------------------------------------------

/** Everything this tool can honestly say about one element. */
export function elementReport(symbolOrZ: string | number): { lines: string[]; notes: string[] } | null {
  const z = typeof symbolOrZ === "number" ? symbolOrZ : atomicNumber(symbolOrZ.trim());
  if (z === null) return null;
  const sym = symbolFor(z);
  const pl = placement(z);
  const shells = shellOccupancy(z);
  if (!sym || !pl || !shells) return null;

  const lines: string[] = [];
  lines.push(`${sym} — atomic number ${z}`);
  const w = atomicWeight(z);
  lines.push(`Standard atomic weight: ${w ?? "—"}`);
  lines.push(
    `Position: period ${pl.period}, ` +
      (pl.group === null ? "f-block series (outside the numbered groups)" : `group ${pl.group}`) +
      `, ${pl.block}-block`,
  );
  if (isNobleGas(z)) lines.push("Noble gas — its outermost p subshell is full (helium's 1s shell).");
  lines.push("");
  lines.push(`Electron configuration (predicted): ${configurationString(z)}`);
  lines.push(`Abbreviated: ${nobleGasConfiguration(z)}`);
  lines.push(
    `Electrons per shell: ${shells
      .map((c, i) => `${SHELL_LETTERS[i] ?? `n=${i + 1}`} ${c}`)
      .join(", ")}`,
  );
  lines.push(`Valence electrons in the outermost shell: ${shells[shells.length - 1]}`);
  lines.push("");
  lines.push("NOT CARRIED BY THIS TOOL:");
  for (const a of ABSENT_PROPERTIES) lines.push(`  • ${a.name} — ${a.why}`);

  return {
    lines,
    notes: [
      AUFBAU_CAVEAT,
      "Everything above is either held and verified (the symbol, atomic number and standard " +
        "atomic weight) or computed from the aufbau rule (the configuration, shells, block, group " +
        "and period). No measured property has been filled in from memory, which is why the list " +
        "of what is absent is part of the report rather than a footnote.",
    ],
  };
}

/** Symbols, for a picker. */
export const ALL_SYMBOLS: readonly string[] = ELEMENT_SYMBOLS;

export type { Subshell };
