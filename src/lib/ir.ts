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
  hasCarbonNeighbour,
  isCumulatedCentre,
  isIsocyanideNitrogen,
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
 * Names groups on atom `a` that this module has NO tabulated band for.
 *
 * WHY THIS EXISTS. The fingerprint region below ~1500 cm-1 is refused on
 * purpose and said so out loud. These groups are the opposite case: they absorb
 * WELL ABOVE the fingerprint region, where a reader is entitled to expect a
 * band, and the module simply had nothing to say and said nothing — no band and
 * no note. Phenyl azide came back with only aromatic C-H and ring bands, and
 * nothing on screen distinguished "this molecule has no other IR-active group"
 * from "this model does not know that group".
 *
 * Both NMR paths already name what they ignored (nmr.ts aromaticCaveats and the
 * sp3 substituent sweep). This is the IR equivalent. It names the group; it does
 * NOT quote a wavenumber, because the reason there is no band is precisely that
 * there is no tabulated entry here to quote.
 */
function unassignedGroupsAt(mol: Molecule, a: number): string[] {
  const out: string[] = [];
  const z = mol.getAtomicNo(a);
  const nbrs = neighbors(mol, a);

  if (z === 7 && !mol.isAromaticAtom(a)) {
    const nitrogens = nbrs.filter((nb) => mol.getAtomicNo(nb.atom) === 7);
    const doubleToN = nitrogens.filter((nb) => nb.order >= 2).length;
    // Azide: -N=N=N, i.e. a nitrogen flanked by two doubly-bonded nitrogens.
    const azideCentre = doubleToN >= 2;
    if (azideCentre) out.push("azide (N₃)");
    // A cumulated nitrogen carrying ONE doubly-bonded nitrogen is a diazo group
    // or nitrous oxide: X=N⁺=N⁻ with X not nitrogen. Naming that "azo" was wrong
    // — measured on the dictionary entry "nitrous oxide" ([N-]=[N+]=O), which has
    // no N=N functional group at all, and on diazomethane.
    //
    // The "one doubly-bonded NITROGEN" requirement is what makes this a diazo
    // test rather than a cumulated-nitrogen test. A nitro group written in its
    // pentavalent form, CN(=O)=O, is a cumulated nitrogen by bond count, and
    // without the requirement this branch would announce a diazo group in
    // nitromethane — in the same result as the nitro bands at 1530 and 1350 it
    // correctly predicts. (OpenChemLib happens to normalise that input to the
    // charge-separated form, so the guard is belt-and-braces on today's parser
    // rather than the only thing standing between the user and the claim. It is
    // still the correct condition: two doubly-bonded OXYGENS are a nitro group.)
    else if (doubleToN === 1 && isCumulatedCentre(mol, a)) {
      // "X=N=N" covers the family without claiming which member: a diazo
      // compound, an azoxy written pentavalently, or nitrous oxide.
      out.push("a cumulated nitrogen, X=N=N (diazo / azoxy / N₂O type)");
    } else {
      // Azo: a genuine N=N, with neither nitrogen cumulated.
      for (const nb of nitrogens) {
        if (nb.order !== 2) continue;
        if (isCumulatedCentre(mol, nb.atom)) continue;
        out.push("azo (N=N)");
      }
    }
    if (isIsocyanideNitrogen(mol, a)) out.push("isocyanide (N≡C)");
  }

  if (z === 6 && !mol.isAromaticAtom(a)) {
    const dblN = nbrs.some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 7);
    const dblS = nbrs.some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 16);
    if (dblN && dblS) out.push("isothiocyanate (N=C=S)");
    // A C=O this module's classifier will not name — carbon dioxide, a ketene,
    // phosgene, an acyl silane. carbonylKind returns null for those on purpose,
    // and the band loop above correctly adds nothing; without this the omission
    // was invisible.
    //
    // The wording lists the refused CLASSES rather than saying "as in O=C=O",
    // which read as a claim about the structure on screen — a phosgene user was
    // being told about carbon dioxide.
    if (isCarbonyl(mol, a) && !carbonylKind(mol, a)) {
      out.push(
        "a C=O this model will not classify (one of: O=C=O, a ketene, a phosgene-type dihalide, " +
          "an acyl silane, a selenoester)"
      );
    }
    // A cumulated C=C — an allene, or a ketene's C=C. Its stretch is near
    // 1950-2150 cm-1, nowhere near the 1650 an ordinary alkene gets, so the
    // band loop skips it (see the isolated-C=C section) and it is named here.
    if (isCumulatedCentre(mol, a) && nbrs.some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 6)) {
      out.push("a cumulated C=C (allene / ketene type)");
    }
    // A cumulated C=S, as in carbon disulfide. ¹³C already names this class and
    // refuses a shift for it; IR said nothing at all, so the two modules
    // disagreed about whether the structure contained a namable group.
    if (isCumulatedCentre(mol, a) && !dblN && nbrs.some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 16)) {
      out.push("a cumulated C=S (S=C=S type)");
    }
    // Carbon monoxide. ¹³C names it and refuses a shift; IR was silent.
    if (nbrs.some((nb) => nb.order === 3 && mol.getAtomicNo(nb.atom) === 8)) {
      out.push("a C≡O (carbon monoxide)");
    }
  }

  return out;
}

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
  /** Groups found in the structure for which this module has no tabulated band. */
  const unassigned = new Set<string>();

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
      // Either end of the bond may hold the lower atom index, so read the pair
      // rather than assuming the carbon comes first: "N#Cc1ccccc1" is exactly
      // as valid a way to write benzonitrile as "c1ccccc1C#N".
      const nitrogen = z === 7 ? a : zz === 7 ? nb.atom : -1;
      const carbon = z === 6 ? a : zz === 6 ? nb.atom : -1;
      if (carbon >= 0 && nitrogen >= 0) {
        // Only a TERMINAL nitrogen makes this a nitrile; a substituted one makes
        // it an isocyanide, whose stretch is ~100 cm-1 lower and is not
        // tabulated here (unassignedGroupsAt names it instead).
        if (!isIsocyanideNitrogen(mol, nitrogen)) {
          add({ wavenumber: 2245, range: [2210, 2260], intensity: "medium", assignment: "C≡N stretch (nitrile)" });
        }
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
        // A cumulated C=C is not an alkene C=C: allene absorbs at 1957 cm-1 and
        // a ketene at 2151, against the 1650 this branch would print. Named in
        // the caveats instead (unassignedGroupsAt).
        if (isCumulatedCentre(mol, a) || isCumulatedCentre(mol, nb.atom)) continue;
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
    // A C-X stretch requires a C-X BOND. Keying on the halogen alone gave sodium
    // chloride — a dictionary entry, reachable as "salt" — a single predicted
    // band, "700 cm-1, C-Cl stretch, strong", for a compound with no carbon in
    // it. Hydrochloric acid and [PF6]- were the same story.
    if (hasCarbonNeighbour(mol, a)) {
      if (z === 9) add({ wavenumber: 1150, range: [1000, 1400], intensity: "strong", assignment: "C-F stretch" });
      if (z === 17) add({ wavenumber: 700, range: [600, 800], intensity: "strong", assignment: "C-Cl stretch" });
      if (z === 35) add({ wavenumber: 550, range: [500, 600], intensity: "strong", assignment: "C-Br stretch" });
      if (z === 53) add({ wavenumber: 500, range: [450, 550], intensity: "strong", assignment: "C-I stretch" });
    }

    // --- Groups this model has NO tabulated band for -------------------------
    // Collected, not predicted. See unassignedGroups().
    for (const g of unassignedGroupsAt(mol, a)) unassigned.add(g);
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

  if (unassigned.size) {
    caveats.add(
      `This structure contains ${[...unassigned].join(", ")} — group${unassigned.size > 1 ? "s" : ""} with ` +
        "no tabulated band in this model. They absorb ABOVE the fingerprint region, where a band would be " +
        "expected, so the list above is incomplete for this structure. Nothing is predicted for them rather " +
        "than a value being guessed."
    );
  }

  if (!bands.length) {
    // The text must fit BOTH families that land here, because it is one string
    // for both: small covalent molecules with strong mid-IR bands this model
    // does not tabulate (CO₂, SO₂, N₂O), and species that genuinely have no IR
    // spectrum at all (an ionic halide has no molecular vibration; a homonuclear
    // diatomic such as N₂ or O₂ is rigorously IR-INACTIVE). Asserting far-IR
    // lattice modes for all of them was wrong in both directions.
    caveats.add(
      "No band is predicted for this structure: it contains no functional group whose characteristic " +
        "frequency this model tabulates. That is a REFUSAL to predict, not a prediction of a featureless " +
        "spectrum — the real answer depends on the species. A small covalent molecule such as carbon " +
        "dioxide has a strong absorption that simply is not in this model's tables; an ionic salt has no " +
        "molecular vibration to show; and a homonuclear diatomic such as N₂ or O₂ is IR-inactive by " +
        "symmetry and truly has no band. This model does not distinguish those cases."
    );
  }

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
