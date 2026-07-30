// GENERATED FILE — do not edit by hand.
//
// Written by scripts/fetch-element-data.mjs from PubChem's periodic table:
//   https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON
// Cached at docs/pubchem-periodictable.json; re-run with --refresh to update.
//
// WHY IT IS FETCHED RATHER THAN TYPED. 118 names, 118 configurations and 118 sets of
// oxidation states cannot come from recollection — the rule here is that all data must
// be real, and the precedent is the refusal to build in steam tables because a table
// reconstructed from memory is unverifiable.
//
// CROSS-CHECKED, because PubChem is a real source and not an infallible one — this
// repo has already been bitten by trusting it on stereochemistry. The generator
// refuses to write this file unless all 118 symbols match the already-verified
// PERIODIC table in order, which is what licenses attaching these names to them.
//
// DELIBERATELY NOT TAKEN: the atomic weights. PubChem differs from the held IUPAC
// values for lithium — which IUPAC gives as an interval — and for seven elements with
// no stable isotope, where sources choose different reference isotopes. Those are
// convention differences rather than errors, and switching would change numbers this
// product already computes with. chemValidate's PERIODIC remains the source for mass.
//
// The configurations keep PubChem's own "(predicted)" and "(calculated)" annotations.
// For the superheavy elements even PubChem has no measurement, and stripping that
// would manufacture certainty.

export interface ElementFacts {
  /** IUPAC name, from PubChem. */
  name: string;
  /** Measured ground-state configuration, with PubChem's own caveats kept. */
  config: string;
  /** Common oxidation states, semicolon-separated as PubChem gives them. */
  oxidation: string | null;
  /** Pauling electronegativity. */
  electronegativity: number | null;
  /** First ionisation energy, eV. */
  ionisationEnergy: number | null;
  electronAffinity: number | null;
  /** Van der Waals radius, pm. */
  atomicRadius: number | null;
  /** Phase at standard conditions. */
  standardState: string | null;
}

/** Indexed by atomic number minus one. */
export const ELEMENT_FACTS: readonly ElementFacts[] = [
  { name: "Hydrogen", config: "1s1", oxidation: "+1, -1", electronegativity: 2.2, ionisationEnergy: 13.598, electronAffinity: 0.754, atomicRadius: 120, standardState: "Gas" },
  { name: "Helium", config: "1s2", oxidation: "0", electronegativity: null, ionisationEnergy: 24.587, electronAffinity: null, atomicRadius: 140, standardState: "Gas" },
  { name: "Lithium", config: "[He]2s1", oxidation: "+1", electronegativity: 0.98, ionisationEnergy: 5.392, electronAffinity: 0.618, atomicRadius: 182, standardState: "Solid" },
  { name: "Beryllium", config: "[He]2s2", oxidation: "+2", electronegativity: 1.57, ionisationEnergy: 9.323, electronAffinity: null, atomicRadius: 153, standardState: "Solid" },
  { name: "Boron", config: "[He]2s2 2p1", oxidation: "+3", electronegativity: 2.04, ionisationEnergy: 8.298, electronAffinity: 0.277, atomicRadius: 192, standardState: "Solid" },
  { name: "Carbon", config: "[He]2s2 2p2", oxidation: "+4, +2, -4", electronegativity: 2.55, ionisationEnergy: 11.260, electronAffinity: 1.263, atomicRadius: 170, standardState: "Solid" },
  { name: "Nitrogen", config: "[He] 2s2 2p3", oxidation: "+5, +4, +3, +2, +1, -1, -2, -3", electronegativity: 3.04, ionisationEnergy: 14.534, electronAffinity: null, atomicRadius: 155, standardState: "Gas" },
  { name: "Oxygen", config: "[He]2s2 2p4", oxidation: "-2", electronegativity: 3.44, ionisationEnergy: 13.618, electronAffinity: 1.461, atomicRadius: 152, standardState: "Gas" },
  { name: "Fluorine", config: "[He]2s2 2p5", oxidation: "-1", electronegativity: 3.98, ionisationEnergy: 17.423, electronAffinity: 3.339, atomicRadius: 135, standardState: "Gas" },
  { name: "Neon", config: "[He]2s2 2p6", oxidation: "0", electronegativity: null, ionisationEnergy: 21.565, electronAffinity: null, atomicRadius: 154, standardState: "Gas" },
  { name: "Sodium", config: "[Ne]3s1", oxidation: "+1", electronegativity: 0.93, ionisationEnergy: 5.139, electronAffinity: 0.548, atomicRadius: 227, standardState: "Solid" },
  { name: "Magnesium", config: "[Ne]3s2", oxidation: "+2", electronegativity: 1.31, ionisationEnergy: 7.646, electronAffinity: null, atomicRadius: 173, standardState: "Solid" },
  { name: "Aluminum", config: "[Ne]3s2 3p1", oxidation: "+3", electronegativity: 1.61, ionisationEnergy: 5.986, electronAffinity: 0.441, atomicRadius: 184, standardState: "Solid" },
  { name: "Silicon", config: "[Ne]3s2 3p2", oxidation: "+4, +2, -4", electronegativity: 1.9, ionisationEnergy: 8.152, electronAffinity: 1.385, atomicRadius: 210, standardState: "Solid" },
  { name: "Phosphorus", config: "[Ne]3s2 3p3", oxidation: "+5, +3, -3", electronegativity: 2.19, ionisationEnergy: 10.487, electronAffinity: 0.746, atomicRadius: 180, standardState: "Solid" },
  { name: "Sulfur", config: "[Ne]3s2 3p4", oxidation: "+6, +4, -2", electronegativity: 2.58, ionisationEnergy: 10.360, electronAffinity: 2.077, atomicRadius: 180, standardState: "Solid" },
  { name: "Chlorine", config: "[Ne]3s2 3p5", oxidation: "+7, +5, +1, -1", electronegativity: 3.16, ionisationEnergy: 12.968, electronAffinity: 3.617, atomicRadius: 175, standardState: "Gas" },
  { name: "Argon", config: "[Ne]3s2 3p6", oxidation: "0", electronegativity: null, ionisationEnergy: 15.760, electronAffinity: null, atomicRadius: 188, standardState: "Gas" },
  { name: "Potassium", config: "[Ar]4s1", oxidation: "+1", electronegativity: 0.82, ionisationEnergy: 4.341, electronAffinity: 0.501, atomicRadius: 275, standardState: "Solid" },
  { name: "Calcium", config: "[Ar]4s2", oxidation: "+2", electronegativity: 1, ionisationEnergy: 6.113, electronAffinity: null, atomicRadius: 231, standardState: "Solid" },
  { name: "Scandium", config: "[Ar]4s2 3d1", oxidation: "+3", electronegativity: 1.36, ionisationEnergy: 6.561, electronAffinity: 0.188, atomicRadius: 211, standardState: "Solid" },
  { name: "Titanium", config: "[Ar]4s2 3d2", oxidation: "+4, +3, +2", electronegativity: 1.54, ionisationEnergy: 6.828, electronAffinity: 0.079, atomicRadius: 187, standardState: "Solid" },
  { name: "Vanadium", config: "[Ar]4s2 3d3", oxidation: "+5, +4, +3, +2", electronegativity: 1.63, ionisationEnergy: 6.746, electronAffinity: 0.525, atomicRadius: 179, standardState: "Solid" },
  { name: "Chromium", config: "[Ar]3d5 4s1", oxidation: "+6, +3, +2", electronegativity: 1.66, ionisationEnergy: 6.767, electronAffinity: 0.666, atomicRadius: 189, standardState: "Solid" },
  { name: "Manganese", config: "[Ar]4s2 3d5", oxidation: "+7, +4, +3, +2", electronegativity: 1.55, ionisationEnergy: 7.434, electronAffinity: null, atomicRadius: 197, standardState: "Solid" },
  { name: "Iron", config: "[Ar]4s2 3d6", oxidation: "+3, +2", electronegativity: 1.83, ionisationEnergy: 7.902, electronAffinity: 0.163, atomicRadius: 194, standardState: "Solid" },
  { name: "Cobalt", config: "[Ar]4s2 3d7", oxidation: "+3, +2", electronegativity: 1.88, ionisationEnergy: 7.881, electronAffinity: 0.661, atomicRadius: 192, standardState: "Solid" },
  { name: "Nickel", config: "[Ar]4s2 3d8", oxidation: "+3, +2", electronegativity: 1.91, ionisationEnergy: 7.640, electronAffinity: 1.156, atomicRadius: 163, standardState: "Solid" },
  { name: "Copper", config: "[Ar]4s1 3d10", oxidation: "+2, +1", electronegativity: 1.9, ionisationEnergy: 7.726, electronAffinity: 1.228, atomicRadius: 140, standardState: "Solid" },
  { name: "Zinc", config: "[Ar]4s2 3d10", oxidation: "+2", electronegativity: 1.65, ionisationEnergy: 9.394, electronAffinity: null, atomicRadius: 139, standardState: "Solid" },
  { name: "Gallium", config: "[Ar]4s2 3d10 4p1", oxidation: "+3", electronegativity: 1.81, ionisationEnergy: 5.999, electronAffinity: 0.3, atomicRadius: 187, standardState: "Solid" },
  { name: "Germanium", config: "[Ar]4s2 3d10 4p2", oxidation: "+4, +2", electronegativity: 2.01, ionisationEnergy: 7.900, electronAffinity: 1.35, atomicRadius: 211, standardState: "Solid" },
  { name: "Arsenic", config: "[Ar]4s2 3d10 4p3", oxidation: "+5, +3, -3", electronegativity: 2.18, ionisationEnergy: 9.815, electronAffinity: 0.81, atomicRadius: 185, standardState: "Solid" },
  { name: "Selenium", config: "[Ar]4s2 3d10 4p4", oxidation: "+6, +4, -2", electronegativity: 2.55, ionisationEnergy: 9.752, electronAffinity: 2.021, atomicRadius: 190, standardState: "Solid" },
  { name: "Bromine", config: "[Ar]4s2 3d10 4p5", oxidation: "+5, +1, -1", electronegativity: 2.96, ionisationEnergy: 11.814, electronAffinity: 3.365, atomicRadius: 183, standardState: "Liquid" },
  { name: "Krypton", config: "[Ar]4s2 3d10 4p6", oxidation: "0", electronegativity: 3, ionisationEnergy: 14.000, electronAffinity: null, atomicRadius: 202, standardState: "Gas" },
  { name: "Rubidium", config: "[Kr]5s1", oxidation: "+1", electronegativity: 0.82, ionisationEnergy: 4.177, electronAffinity: 0.468, atomicRadius: 303, standardState: "Solid" },
  { name: "Strontium", config: "[Kr]5s2", oxidation: "+2", electronegativity: 0.95, ionisationEnergy: 5.695, electronAffinity: null, atomicRadius: 249, standardState: "Solid" },
  { name: "Yttrium", config: "[Kr]5s2 4d1", oxidation: "+3", electronegativity: 1.22, ionisationEnergy: 6.217, electronAffinity: 0.307, atomicRadius: 219, standardState: "Solid" },
  { name: "Zirconium", config: "[Kr]5s2 4d2", oxidation: "+4", electronegativity: 1.33, ionisationEnergy: 6.634, electronAffinity: 0.426, atomicRadius: 186, standardState: "Solid" },
  { name: "Niobium", config: "[Kr]5s1 4d4", oxidation: "+5, +3", electronegativity: 1.6, ionisationEnergy: 6.759, electronAffinity: 0.893, atomicRadius: 207, standardState: "Solid" },
  { name: "Molybdenum", config: "[Kr]5s1 4d5", oxidation: "+6", electronegativity: 2.16, ionisationEnergy: 7.092, electronAffinity: 0.746, atomicRadius: 209, standardState: "Solid" },
  { name: "Technetium", config: "[Kr]5s2 4d5", oxidation: "+7, +6, +4", electronegativity: 1.9, ionisationEnergy: 7.28, electronAffinity: 0.55, atomicRadius: 209, standardState: "Solid" },
  { name: "Ruthenium", config: "[Kr]5s1 4d7", oxidation: "+3", electronegativity: 2.2, ionisationEnergy: 7.361, electronAffinity: 1.05, atomicRadius: 207, standardState: "Solid" },
  { name: "Rhodium", config: "[Kr]5s1 4d8", oxidation: "+3", electronegativity: 2.28, ionisationEnergy: 7.459, electronAffinity: 1.137, atomicRadius: 195, standardState: "Solid" },
  { name: "Palladium", config: "[Kr]4d10", oxidation: "+3, +2", electronegativity: 2.2, ionisationEnergy: 8.337, electronAffinity: 0.557, atomicRadius: 202, standardState: "Solid" },
  { name: "Silver", config: "[Kr]5s1 4d10", oxidation: "+1", electronegativity: 1.93, ionisationEnergy: 7.576, electronAffinity: 1.302, atomicRadius: 172, standardState: "Solid" },
  { name: "Cadmium", config: "[Kr]5s2 4d10", oxidation: "+2", electronegativity: 1.69, ionisationEnergy: 8.994, electronAffinity: null, atomicRadius: 158, standardState: "Solid" },
  { name: "Indium", config: "[Kr]5s2 4d10 5p1", oxidation: "+3", electronegativity: 1.78, ionisationEnergy: 5.786, electronAffinity: 0.3, atomicRadius: 193, standardState: "Solid" },
  { name: "Tin", config: "[Kr]5s2 4d10 5p2", oxidation: "+4, +2", electronegativity: 1.96, ionisationEnergy: 7.344, electronAffinity: 1.2, atomicRadius: 217, standardState: "Solid" },
  { name: "Antimony", config: "[Kr]5s2 4d10 5p3", oxidation: "+5, +3, -3", electronegativity: 2.05, ionisationEnergy: 8.64, electronAffinity: 1.07, atomicRadius: 206, standardState: "Solid" },
  { name: "Tellurium", config: "[Kr]5s2 4d10 5p4", oxidation: "+6, +4, -2", electronegativity: 2.1, ionisationEnergy: 9.010, electronAffinity: 1.971, atomicRadius: 206, standardState: "Solid" },
  { name: "Iodine", config: "[Kr]5s2 4d10 5p5", oxidation: "+7, +5, +1, -1", electronegativity: 2.66, ionisationEnergy: 10.451, electronAffinity: 3.059, atomicRadius: 198, standardState: "Solid" },
  { name: "Xenon", config: "[Kr]5s2 4d10 5p6", oxidation: "0", electronegativity: 2.6, ionisationEnergy: 12.130, electronAffinity: null, atomicRadius: 216, standardState: "Gas" },
  { name: "Cesium", config: "[Xe]6s1", oxidation: "+1", electronegativity: 0.79, ionisationEnergy: 3.894, electronAffinity: 0.472, atomicRadius: 343, standardState: "Solid" },
  { name: "Barium", config: "[Xe]6s2", oxidation: "+2", electronegativity: 0.89, ionisationEnergy: 5.212, electronAffinity: null, atomicRadius: 268, standardState: "Solid" },
  { name: "Lanthanum", config: "[Xe]6s2 5d1", oxidation: "+3", electronegativity: 1.1, ionisationEnergy: 5.577, electronAffinity: 0.5, atomicRadius: 240, standardState: "Solid" },
  { name: "Cerium", config: "[Xe]6s2 4f1 5d1", oxidation: "+4, +3", electronegativity: 1.12, ionisationEnergy: 5.539, electronAffinity: 0.5, atomicRadius: 235, standardState: "Solid" },
  { name: "Praseodymium", config: "[Xe]6s2 4f3", oxidation: "+3", electronegativity: 1.13, ionisationEnergy: 5.464, electronAffinity: null, atomicRadius: 239, standardState: "Solid" },
  { name: "Neodymium", config: "[Xe]6s2 4f4", oxidation: "+3", electronegativity: 1.14, ionisationEnergy: 5.525, electronAffinity: null, atomicRadius: 229, standardState: "Solid" },
  { name: "Promethium", config: "[Xe]6s2 4f5", oxidation: "+3", electronegativity: null, ionisationEnergy: 5.55, electronAffinity: null, atomicRadius: 236, standardState: "Solid" },
  { name: "Samarium", config: "[Xe]6s2 4f6", oxidation: "+3, +2", electronegativity: 1.17, ionisationEnergy: 5.644, electronAffinity: null, atomicRadius: 229, standardState: "Solid" },
  { name: "Europium", config: "[Xe]6s2 4f7", oxidation: "+3, +2", electronegativity: null, ionisationEnergy: 5.670, electronAffinity: null, atomicRadius: 233, standardState: "Solid" },
  { name: "Gadolinium", config: "[Xe]6s2 4f7 5d1", oxidation: "+3", electronegativity: 1.2, ionisationEnergy: 6.150, electronAffinity: null, atomicRadius: 237, standardState: "Solid" },
  { name: "Terbium", config: "[Xe]6s2 4f9", oxidation: "+3", electronegativity: null, ionisationEnergy: 5.864, electronAffinity: null, atomicRadius: 221, standardState: "Solid" },
  { name: "Dysprosium", config: "[Xe]6s2 4f10", oxidation: "+3", electronegativity: 1.22, ionisationEnergy: 5.939, electronAffinity: null, atomicRadius: 229, standardState: "Solid" },
  { name: "Holmium", config: "[Xe]6s2 4f11", oxidation: "+3", electronegativity: 1.23, ionisationEnergy: 6.022, electronAffinity: null, atomicRadius: 216, standardState: "Solid" },
  { name: "Erbium", config: "[Xe]6s2 4f12", oxidation: "+3", electronegativity: 1.24, ionisationEnergy: 6.108, electronAffinity: null, atomicRadius: 235, standardState: "Solid" },
  { name: "Thulium", config: "[Xe]6s2 4f13", oxidation: "+3", electronegativity: 1.25, ionisationEnergy: 6.184, electronAffinity: null, atomicRadius: 227, standardState: "Solid" },
  { name: "Ytterbium", config: "[Xe]6s2 4f14", oxidation: "+3, +2", electronegativity: null, ionisationEnergy: 6.254, electronAffinity: null, atomicRadius: 242, standardState: "Solid" },
  { name: "Lutetium", config: "[Xe]6s2 4f14 5d1", oxidation: "+3", electronegativity: 1.27, ionisationEnergy: 5.426, electronAffinity: null, atomicRadius: 221, standardState: "Solid" },
  { name: "Hafnium", config: "[Xe]6s2 4f14 5d2", oxidation: "+4", electronegativity: 1.3, ionisationEnergy: 6.825, electronAffinity: null, atomicRadius: 212, standardState: "Solid" },
  { name: "Tantalum", config: "[Xe]6s2 4f14 5d3", oxidation: "+5", electronegativity: 1.5, ionisationEnergy: 7.89, electronAffinity: 0.322, atomicRadius: 217, standardState: "Solid" },
  { name: "Tungsten", config: "[Xe]6s2 4f14 5d4", oxidation: "+6", electronegativity: 2.36, ionisationEnergy: 7.98, electronAffinity: 0.815, atomicRadius: 210, standardState: "Solid" },
  { name: "Rhenium", config: "[Xe]6s2 4f14 5d5", oxidation: "+7, +6, +4", electronegativity: 1.9, ionisationEnergy: 7.88, electronAffinity: 0.15, atomicRadius: 217, standardState: "Solid" },
  { name: "Osmium", config: "[Xe]6s2 4f14 5d6", oxidation: "+4, +3", electronegativity: 2.2, ionisationEnergy: 8.7, electronAffinity: 1.1, atomicRadius: 216, standardState: "Solid" },
  { name: "Iridium", config: "[Xe]6s2 4f14 5d7", oxidation: "+4, +3", electronegativity: 2.2, ionisationEnergy: 9.1, electronAffinity: 1.565, atomicRadius: 202, standardState: "Solid" },
  { name: "Platinum", config: "[Xe]6s1 4f14 5d9", oxidation: "+4, +2", electronegativity: 2.28, ionisationEnergy: 9, electronAffinity: 2.128, atomicRadius: 209, standardState: "Solid" },
  { name: "Gold", config: "[Xe]6s1 4f14 5d10", oxidation: "+3, +1", electronegativity: 2.54, ionisationEnergy: 9.226, electronAffinity: 2.309, atomicRadius: 166, standardState: "Solid" },
  { name: "Mercury", config: "[Xe]6s2 4f14 5d10", oxidation: "+2, +1", electronegativity: 2, ionisationEnergy: 10.438, electronAffinity: null, atomicRadius: 209, standardState: "Liquid" },
  { name: "Thallium", config: "[Xe]6s2 4f14 5d10 6p1", oxidation: "+3, +1", electronegativity: 1.62, ionisationEnergy: 6.108, electronAffinity: 0.2, atomicRadius: 196, standardState: "Solid" },
  { name: "Lead", config: "[Xe]6s2 4f14 5d10 6p2", oxidation: "+4, +2", electronegativity: 2.33, ionisationEnergy: 7.417, electronAffinity: 0.36, atomicRadius: 202, standardState: "Solid" },
  { name: "Bismuth", config: "[Xe]6s2 4f14 5d10 6p3", oxidation: "+5, +3", electronegativity: 2.02, ionisationEnergy: 7.289, electronAffinity: 0.946, atomicRadius: 207, standardState: "Solid" },
  { name: "Polonium", config: "[Xe]6s2 4f14 5d10 6p4", oxidation: "+4, +2", electronegativity: 2, ionisationEnergy: 8.417, electronAffinity: 1.9, atomicRadius: 197, standardState: "Solid" },
  { name: "Astatine", config: "[Xe]6s2 4f14 5d10 6p5", oxidation: "7, 5, 3, 1, -1", electronegativity: 2.2, ionisationEnergy: 9.5, electronAffinity: 2.8, atomicRadius: 202, standardState: "Solid" },
  { name: "Radon", config: "[Xe]6s2 4f14 5d10 6p6", oxidation: "0", electronegativity: null, ionisationEnergy: 10.745, electronAffinity: null, atomicRadius: 220, standardState: "Gas" },
  { name: "Francium", config: "[Rn]7s1", oxidation: "+1", electronegativity: 0.7, ionisationEnergy: 3.9, electronAffinity: 0.47, atomicRadius: 348, standardState: "Solid" },
  { name: "Radium", config: "[Rn]7s2", oxidation: "+2", electronegativity: 0.9, ionisationEnergy: 5.279, electronAffinity: null, atomicRadius: 283, standardState: "Solid" },
  { name: "Actinium", config: "[Rn]7s2 6d1", oxidation: "+3", electronegativity: 1.1, ionisationEnergy: 5.17, electronAffinity: null, atomicRadius: 260, standardState: "Solid" },
  { name: "Thorium", config: "[Rn]7s2 6d2", oxidation: "+4", electronegativity: 1.3, ionisationEnergy: 6.08, electronAffinity: null, atomicRadius: 237, standardState: "Solid" },
  { name: "Protactinium", config: "[Rn]7s2 5f2 6d1", oxidation: "+5, +4", electronegativity: 1.5, ionisationEnergy: 5.89, electronAffinity: null, atomicRadius: 243, standardState: "Solid" },
  { name: "Uranium", config: "[Rn]7s2 5f3 6d1", oxidation: "+6, +5, +4, +3", electronegativity: 1.38, ionisationEnergy: 6.194, electronAffinity: null, atomicRadius: 240, standardState: "Solid" },
  { name: "Neptunium", config: "[Rn]7s2 5f4 6d1", oxidation: "+6, +5, +4, +3", electronegativity: 1.36, ionisationEnergy: 6.266, electronAffinity: null, atomicRadius: 221, standardState: "Solid" },
  { name: "Plutonium", config: "[Rn]7s2 5f6", oxidation: "+6, +5, +4, +3", electronegativity: 1.28, ionisationEnergy: 6.06, electronAffinity: null, atomicRadius: 243, standardState: "Solid" },
  { name: "Americium", config: "[Rn]7s2 5f7", oxidation: "+6, +5, +4, +3", electronegativity: 1.3, ionisationEnergy: 5.993, electronAffinity: null, atomicRadius: 244, standardState: "Solid" },
  { name: "Curium", config: "[Rn]7s2 5f7 6d1", oxidation: "+3", electronegativity: 1.3, ionisationEnergy: 6.02, electronAffinity: null, atomicRadius: 245, standardState: "Solid" },
  { name: "Berkelium", config: "[Rn]7s2 5f9", oxidation: "+4, +3", electronegativity: 1.3, ionisationEnergy: 6.23, electronAffinity: null, atomicRadius: 244, standardState: "Solid" },
  { name: "Californium", config: "[Rn]7s2 5f10", oxidation: "+3", electronegativity: 1.3, ionisationEnergy: 6.30, electronAffinity: null, atomicRadius: 245, standardState: "Solid" },
  { name: "Einsteinium", config: "[Rn]7s2 5f11", oxidation: "+3", electronegativity: 1.3, ionisationEnergy: 6.42, electronAffinity: null, atomicRadius: 245, standardState: "Solid" },
  { name: "Fermium", config: "[Rn] 5f12 7s2", oxidation: "+3", electronegativity: 1.3, ionisationEnergy: 6.50, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Mendelevium", config: "[Rn]7s2 5f13", oxidation: "+3, +2", electronegativity: 1.3, ionisationEnergy: 6.58, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Nobelium", config: "[Rn]7s2 5f14", oxidation: "+3, +2", electronegativity: 1.3, ionisationEnergy: 6.65, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Lawrencium", config: "[Rn]7s2 5f14 6d1", oxidation: "+3", electronegativity: 1.3, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Rutherfordium", config: "[Rn]7s2 5f14 6d2", oxidation: "+4", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Dubnium", config: "[Rn]7s2 5f14 6d3", oxidation: "5, 4, 3", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Seaborgium", config: "[Rn]7s2 5f14 6d4", oxidation: "6, 5, 4, 3, 0", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Bohrium", config: "[Rn]7s2 5f14 6d5", oxidation: "7, 5, 4, 3", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Hassium", config: "[Rn]7s2 5f14 6d6", oxidation: "8, 6, 5, 4, 3, 2", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Meitnerium", config: "[Rn]7s2 5f14 6d7 (calculated)", oxidation: "9, 8, 6, 4, 3, 1", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Solid" },
  { name: "Darmstadtium", config: "[Rn]7s2 5f14 6d8 (predicted)", oxidation: "8, 6, 4, 2, 0", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Solid" },
  { name: "Roentgenium", config: "[Rn]7s2 5f14 6d9 (predicted)", oxidation: "5, 3, 1, -1", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Solid" },
  { name: "Copernicium", config: "[Rn]7s2 5f14 6d10 (predicted)", oxidation: "2, 1, 0", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Solid" },
  { name: "Nihonium", config: "[Rn]5f14 6d10 7s2 7p1 (predicted)", oxidation: null, electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Solid" },
  { name: "Flerovium", config: "[Rn]7s2 7p2 5f14 6d10 (predicted)", oxidation: "6, 4,2, 1, 0", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Solid" },
  { name: "Moscovium", config: "[Rn]7s2 7p3 5f14 6d10 (predicted)", oxidation: "3, 1", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Solid" },
  { name: "Livermorium", config: "[Rn]7s2 7p4 5f14 6d10 (predicted)", oxidation: "+4, +2, -2", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Solid" },
  { name: "Tennessine", config: "[Rn]7s2 7p5 5f14 6d10 (predicted)", oxidation: "+5, +3, +1, -1", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Solid" },
  { name: "Oganesson", config: "[Rn]7s2 7p6 5f14 6d10 (predicted)", oxidation: "+6, +4, +2, +1, 0, -1", electronegativity: null, ionisationEnergy: null, electronAffinity: null, atomicRadius: null, standardState: "Expected to be a Gas" },
];
