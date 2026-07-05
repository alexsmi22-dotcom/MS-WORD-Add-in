# JurisLab — User Guide

Open the task pane from the **Home** tab → **Insert Formula**. Put your cursor
where you want content, then use one of the three modes.

> **Drafting aid only — verify every structure and formula before filing.**
> Everything runs on your machine; nothing you type is sent anywhere.

## Search (top box)

Type a name to find any built-in formula or compound — `quadratic`, `std dev`,
`benzene`, `aspirin` — and click a result. It switches to the right mode and
loads it, ready to insert.

## Chemical mode

Type a formula; it formats subscripts/superscripts automatically:

| You type | You get |
| -------- | ------- |
| `H2O` | H₂O |
| `Ca(OH)2` | Ca(OH)₂ |
| `SO4^2-` | SO₄²⁻ |
| `Na+` | Na⁺ |
| `CH3-CH2-OH` (use the `–` button) | CH₃–CH₂–OH |

- **Insert formatted text** drops it at the cursor.
- The **2D structure** box (below) shows a structure for known names/formulas or
  any SMILES, with its **formula, MW, and SMILES**. **Insert 2D structure** adds
  the image; its alt-text stores the SMILES + OCL-ID for provenance.
- **Stereochemistry:** enter an **isomeric SMILES** (e.g. L-alanine
  `C[C@@H](N)C(=O)O`, or E/Z with `/` and `\`) — it's drawn with wedge/hash bonds.
- The **palette** inserts parentheses, charges, lone pair, and common groups.

## Math mode

Type linear math or use the **palette** (fraction, root, Σ, ∫, Greek, etc.) and
the **Formula library** (Statistics / Geometry / Algebra / Trigonometry /
Calculus).

| You type | Renders |
| -------- | ------- |
| `a/b` | stacked fraction |
| `x^2`, `a_n` | super/subscript |
| `sqrt(x)`, `root(3, x)` | roots |
| `sum(i=1, n, x_i)`, `int(a, b, f(x))` | Σ / ∫ with limits |
| `sin(x)^2 + cos(x)^2 = 1` | functions |

- **Insert as a native Word equation** (default) creates a real Word equation.
- **Number this equation** appends a right-aligned **(I)**, **(II)**, …; use
  **reset** to restart at (I).

## Build mode

Make a 2D structure from a description and insert it as an image.

- **Common structures** buttons load a ready-made benzene, cyclohexane, etc.
- **Atom/bond list:**
  ```
  atoms: C C O
  bonds: 1-2 2-3
  ```
  Bond buttons insert `-` single, `=` double, `#` triple, `~` undefined,
  `>` wedge (up), `<` hash (down).
- **Generic (Markush) structures** (buttons in the "Markush / query atoms" row):
  `[C,N]` variable atom · `X` halogen · `A` any atom · `Q` any heteroatom ·
  `R1` R-group attachment · `~` any-bond. Example — the genus over benzene and
  pyridine:
  ```
  atoms: [C,N] C C C C C
  bonds: 1=2 2-3 3=4 4-5 5=6 6-1
  ```
  Example — a para-substituted ring with an R-group and a halogen:
  ```
  atoms: C C C C C C R1 X
  bonds: 1=2 2-3 3=4 4-5 5=6 6-1 1-7 4-8
  ```
- **R-group definitions:** when the structure has R-groups, a definition box
  appears (e.g. `R1 =`). Fill them in and the insert adds a **"where R1 = …"**
  legend line under the structure.
- **Molfile:** paste an MDL molfile to import it.

The Build preview shows the **formula, MW, and SMILES**; the inserted image's
alt-text carries the SMILES + OCL-ID.

## Recents & favorites

Recent inserts appear as chips; click to reload. Star (★) to save a favorite.
**Clear recents & favorites** wipes them from this machine.
