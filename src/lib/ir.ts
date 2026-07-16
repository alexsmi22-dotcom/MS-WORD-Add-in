// IR (infrared) band prediction from structure.
//
// IMPORTANT — honesty: this predicts CHARACTERISTIC GROUP FREQUENCIES, not a
// computed vibrational spectrum. There is no normal-mode analysis here (that
// needs a force field or DFT). What it does is exact functional-group detection
// on the molecular graph, mapped to the published group-frequency ranges every
// IR correlation chart carries.
//
// What that means in practice:
//   * The bands listed are the ones a chemist would assign — they are real and
//     they are where the literature puts them (±10-30 cm-1 typical).
//   * The fingerprint region (<1500 cm-1) is NOT predicted in detail. It is
//     genuinely compound-specific and no additivity scheme reproduces it.
//   * Intensities are qualitative (strong / medium / weak), as correlation
//     charts report them — not computed transition dipoles.
//
// Ranges follow the standard correlation tables (Silverstein "Spectrometric
// Identification of Organic Compounds"; Pretsch et al.).
//
// Pure functions; fully offline; no Office.js.

import { Molecule } from "openchemlib";
import {
  neighbors,
  isCarbonyl,
  carbonylKind,
  isConjugated,
  isAmideN,
  parseToMolecule,
} from "./molgraph";

export type BandIntensity = "strong" | "medium" | "weak";

export interface IrBand {
  /** Centre of the characteristic range, cm-1. */
  wavenumber: number;
  /** Published range for this vibration, cm-1. */
  range: [number, number];
  intensity: BandIntensity;
  /** e.g. "C=O stretch (ester)". */
  assignment: string;
  /** True for bands that are broad in a real spectrum (O-H, N-H, COOH). */
  broad?: boolean;
}

export interface IrResult {
  smiles: string;
  bands: IrBand[];
  caveats: string[];
}

const INTENSITY_ORDER: Record<BandIntensity, number> = { strong: 1.0, medium: 0.6, weak: 0.3 };

/**
 * C=O stretching frequency by carbonyl class. These are the single most
 * diagnostic IR bands, and the class distinctions are real: an ester really does
 * sit ~20 cm-1 above a ketone, an amide ~50 cm-1 below it.
 */
const CARBONYL_IR: Record<string, { wn: number; range: [number, number]; label: string }> = {
  ketone: { wn: 1715, range: [1705, 1725], label: "C=O stretch (ketone)" },
  aldehyde: { wn: 1725, range: [1715, 1740], label: "C=O stretch (aldehyde)" },
  acid: { wn: 1710, range: [1700, 1725], label: "C=O stretch (carboxylic acid)" },
  ester: { wn: 1740, range: [1730, 1750], label: "C=O stretch (ester)" },
  amide: { wn: 1660, range: [1630, 1690], label: "C=O stretch (amide, Amide I)" },
  acidHalide: { wn: 1800, range: [1770, 1815], label: "C=O stretch (acid halide)" },
  anhydride: { wn: 1820, range: [1800, 1830], label: "C=O stretch (anhydride, asym)" },
  carbonate: { wn: 1760, range: [1740, 1780], label: "C=O stretch (carbonate)" },
  urea: { wn: 1660, range: [1640, 1680], label: "C=O stretch (urea)" },
  carbamate: { wn: 1700, range: [1680, 1720], label: "C=O stretch (carbamate)" },
  // Thioester C=O sits BELOW a ketone: sulfur donates into the carbonyl far less
  // effectively than oxygen, so there is less double-bond character. 1690 is
  // outside the ketone band range [1705,1725] — which is why calling a thioester a
  // ketone produced a band a reader would have rejected on sight.
  thioester: { wn: 1690, range: [1675, 1710], label: "C=O stretch (thioester)" },
  // R-N=C=O is a cumulated stretch, not an acyl C=O — hundreds of wavenumbers away.
  isocyanate: { wn: 2270, range: [2240, 2285], label: "N=C=O asym. stretch (isocyanate)" },
};

/**
 * Detects IR-active functional groups and returns their characteristic bands,
 * sorted high → low wavenumber (the direction an IR spectrum is plotted).
 * Returns null if the input cannot be resolved to a structure.
 */
export function predictIr(input: string): IrResult | null {
  const parsed = parseToMolecule(input);
  if (!parsed) return null;
  const { mol, smiles } = parsed;
  const n = mol.getAllAtoms();
  const bands: IrBand[] = [];
  const caveats = new Set<string>();
  const seen = new Set<string>();

  const add = (b: IrBand) => {
    // One band per vibration type — a diester shows one ester C=O band, not two.
    if (seen.has(b.assignment)) return;
    seen.add(b.assignment);
    bands.push(b);
  };

  let hasAromatic = false;
  let hasAlkylCH = false;
  let hasAlkeneCH = false;
  let hasAromaticCH = false;
  let hasCarboxylOH = false;

  for (let a = 0; a < n; a++) {
    const z = mol.getAtomicNo(a);
    const h = mol.getAllHydrogens(a);
    const nbrs = neighbors(mol, a);

    if (mol.isAromaticAtom(a)) {
      hasAromatic = true;
      if (z === 6 && h > 0) hasAromaticCH = true;
    }

    // --- O-H ---------------------------------------------------------------
    if (z === 8 && h >= 1) {
      const c = nbrs[0];
      if (c && isCarbonyl(mol, c.atom)) {
        hasCarboxylOH = true;
      } else {
        add({
          wavenumber: 3350,
          range: [3200, 3600],
          intensity: "strong",
          assignment: "O-H stretch (alcohol/phenol, H-bonded)",
          broad: true,
        });
      }
    }

    // --- N-H ---------------------------------------------------------------
    if (z === 7 && h >= 1) {
      if (isAmideN(mol, a)) {
        add({
          wavenumber: 3300,
          range: [3150, 3400],
          intensity: "medium",
          assignment: "N-H stretch (amide)",
          broad: true,
        });
        add({
          wavenumber: 1550,
          range: [1510, 1570],
          intensity: "medium",
          assignment: "N-H bend (Amide II)",
        });
      } else {
        add({
          wavenumber: h >= 2 ? 3380 : 3320,
          range: [3300, 3500],
          intensity: "medium",
          assignment: h >= 2 ? "N-H stretch (primary amine, two bands)" : "N-H stretch (secondary amine)",
          broad: true,
        });
      }
    }

    // --- S-H ---------------------------------------------------------------
    if (z === 16 && h >= 1) {
      add({ wavenumber: 2570, range: [2550, 2600], intensity: "weak", assignment: "S-H stretch (thiol)" });
    }

    // --- C-H by hybridisation ---------------------------------------------
    if (z === 6 && h >= 1) {
      const triple = nbrs.some((nb) => nb.order === 3);
      const dbl = nbrs.some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 6);
      if (triple) {
        add({
          wavenumber: 3300,
          range: [3260, 3330],
          intensity: "strong",
          assignment: "≡C-H stretch (terminal alkyne, sharp)",
        });
      } else if (!mol.isAromaticAtom(a) && dbl) {
        hasAlkeneCH = true;
      } else if (!mol.isAromaticAtom(a)) {
        hasAlkylCH = true;
      }
    }

    // --- Carbonyl ----------------------------------------------------------
    const kind = carbonylKind(mol, a);
    if (kind) {
      const entry = CARBONYL_IR[kind];
      if (entry) {
        // Conjugation to an aryl ring or C=C lowers C=O by ~20-30 cm-1 — a real,
        // routinely-used diagnostic (acetophenone 1685 vs acetone 1715).
        const conj = isConjugated(mol, a);
        const shift = conj ? -25 : 0;
        add({
          wavenumber: entry.wn + shift,
          range: [entry.range[0] + shift, entry.range[1] + shift],
          intensity: "strong",
          assignment: entry.label + (conj ? ", conjugated" : ""),
        });
      }
      if (kind === "anhydride") {
        add({
          wavenumber: 1760,
          range: [1740, 1780],
          intensity: "strong",
          assignment: "C=O stretch (anhydride, sym)",
        });
      }
      if (kind === "aldehyde") {
        add({
          wavenumber: 2770,
          range: [2695, 2830],
          intensity: "medium",
          assignment: "C-H stretch (aldehyde, Fermi doublet ~2820/2720)",
        });
      }
      if (kind === "ester" || kind === "acid") {
        add({ wavenumber: 1250, range: [1000, 1300], intensity: "strong", assignment: "C-O stretch" });
      }
    }

    // --- Triple bonds -------------------------------------------------------
    for (const nb of nbrs) {
      if (nb.order !== 3 || nb.atom < a) continue;
      const zz = mol.getAtomicNo(nb.atom);
      if (z === 6 && zz === 7) {
        add({ wavenumber: 2245, range: [2210, 2260], intensity: "medium", assignment: "C≡N stretch (nitrile)" });
      } else if (z === 6 && zz === 6) {
        const terminal = mol.getAllHydrogens(a) > 0 || mol.getAllHydrogens(nb.atom) > 0;
        add({
          wavenumber: 2120,
          range: [2100, 2260],
          intensity: terminal ? "medium" : "weak",
          assignment: terminal ? "C≡C stretch (terminal alkyne)" : "C≡C stretch (internal alkyne, often very weak)",
        });
      }
    }

    // --- Isolated C=C -------------------------------------------------------
    if (z === 6 && !mol.isAromaticAtom(a)) {
      for (const nb of nbrs) {
        if (nb.order !== 2 || nb.atom < a) continue;
        if (mol.getAtomicNo(nb.atom) !== 6) continue;
        const conj = isConjugated(mol, a) || isConjugated(mol, nb.atom);
        add({
          wavenumber: conj ? 1625 : 1650,
          range: conj ? [1590, 1650] : [1620, 1680],
          intensity: "medium",
          assignment: conj ? "C=C stretch (conjugated alkene)" : "C=C stretch (alkene)",
        });
      }
    }

    // --- Nitro --------------------------------------------------------------
    if (z === 7) {
      const oxy = nbrs.filter((nb) => mol.getAtomicNo(nb.atom) === 8).length;
      if (oxy >= 2) {
        add({ wavenumber: 1530, range: [1500, 1560], intensity: "strong", assignment: "N=O stretch (nitro, asym)" });
        add({ wavenumber: 1350, range: [1300, 1390], intensity: "strong", assignment: "N=O stretch (nitro, sym)" });
      }
    }

    // --- C-halogen ----------------------------------------------------------
    if (z === 9) add({ wavenumber: 1150, range: [1000, 1400], intensity: "strong", assignment: "C-F stretch" });
    if (z === 17) add({ wavenumber: 700, range: [600, 800], intensity: "strong", assignment: "C-Cl stretch" });
    if (z === 35) add({ wavenumber: 550, range: [500, 600], intensity: "strong", assignment: "C-Br stretch" });
    if (z === 53) add({ wavenumber: 500, range: [450, 550], intensity: "strong", assignment: "C-I stretch" });
  }

  // Carboxylic acid O-H is a signature in its own right: enormously broad,
  // riding over the C-H region. Worth its own band rather than a generic O-H.
  if (hasCarboxylOH) {
    add({
      wavenumber: 3000,
      range: [2500, 3300],
      intensity: "strong",
      assignment: "O-H stretch (carboxylic acid, very broad)",
      broad: true,
    });
  }

  if (hasAlkylCH) {
    add({ wavenumber: 2925, range: [2850, 2960], intensity: "strong", assignment: "C-H stretch (alkyl)" });
    add({ wavenumber: 1460, range: [1440, 1480], intensity: "medium", assignment: "C-H bend (alkyl)" });
  }
  if (hasAlkeneCH) {
    add({ wavenumber: 3050, range: [3010, 3100], intensity: "medium", assignment: "=C-H stretch (alkene)" });
  }
  if (hasAromaticCH) {
    add({ wavenumber: 3050, range: [3000, 3100], intensity: "medium", assignment: "C-H stretch (aromatic)" });
  }
  if (hasAromatic) {
    add({ wavenumber: 1600, range: [1580, 1620], intensity: "medium", assignment: "C=C stretch (aromatic ring)" });
    add({ wavenumber: 1480, range: [1450, 1510], intensity: "medium", assignment: "C=C stretch (aromatic ring)" });
    caveats.add(
      "Aromatic out-of-plane C-H bends (675-900 cm-1) indicate ring substitution pattern but are not predicted here."
    );
  }

  caveats.add(
    "Group frequencies only — the fingerprint region below ~1500 cm-1 is compound-specific and is not predicted."
  );

  bands.sort((a, b) => b.wavenumber - a.wavenumber);
  return { smiles, bands, caveats: [...caveats] };
}

/**
 * Builds a simulated transmittance trace (100% = no absorption) from the
 * predicted bands, for display. Each band is a Lorentzian dip; broad bands get a
 * wider half-width. This is a VISUALISATION of the band list above — it is not
 * an independently computed spectrum, and the UI must not imply otherwise.
 */
export function irTransmittanceCurve(
  bands: IrBand[],
  opts: { from?: number; to?: number; step?: number } = {}
): { x: number; y: number }[] {
  const from = opts.from ?? 400;
  const to = opts.to ?? 4000;
  const step = opts.step ?? 4;
  const points: { x: number; y: number }[] = [];
  for (let wn = from; wn <= to; wn += step) {
    let absorb = 0;
    for (const b of bands) {
      // Half-width: broad O-H/N-H bands are genuinely hundreds of cm-1 wide.
      const hw = b.broad ? Math.max(60, (b.range[1] - b.range[0]) / 2) : 12;
      const depth = INTENSITY_ORDER[b.intensity];
      const d = (wn - b.wavenumber) / hw;
      absorb += depth / (1 + d * d);
    }
    const transmittance = 100 * Math.exp(-Math.min(absorb, 6));
    points.push({ x: wn, y: transmittance });
  }
  return points;
}
