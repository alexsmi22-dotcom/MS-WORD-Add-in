# Patent diagrams — scope (gap item 1, v2.171.0)

A new **Diagrams** tool: the line figures almost every utility patent carries, drawn from short text in USPTO style
(37 CFR 1.84): black lines on white, lettering at least 1/8 in (3.2 mm) high, reference numerals with lead lines,
"FIG. n" labels. Inserted as a picture at its natural size, so the lettering keeps its height.

## Kinds and their text

| Kind | Lines | Example |
|---|---|---|
| Block diagram | `104 Physiological sensor` (a box with its numeral), `104 -> 112` (an arrow), `104 -- 112` (a line), `100 System` as the figure's own numeral | FIG. 1 of US 12,766,288 |
| Flowchart | `405 Detect a parameter` (a step), `? 410 Hypnogogic state?` (a decision), `start` / `end` terminals; steps follow in order, `410 yes -> 415`, `410 no -> 405` | FIG. 4, FIG. 13 |
| State diagram | `[*] -> Idle`, `Idle -> Active : start`, `Active -> Idle : timeout` | controllers, protocols |
| Sequence diagram | `participant 102 Client`, `102 -> 104 : request`, `104 --> 102 : response` (dashed = reply) | software, networking |
| Timing diagram | `CLK: clock 8`, `DATA: 0 1 1 x 0 z 1 0` (levels per period; x unknown, z high impedance), `EN: 0 1 1 1 0 0 0 0` | chips |
| Schematic | `R1 resistor 0,0 2,0 10k`, `C1 capacitor 2,0 2,-2`, `wire 0,0 0,-2`, `GND ground 2,-2` (grid coordinates; symbols: resistor, capacitor, inductor, diode, led, battery, vsource, isource, switch, ground, npn, pnp, nmos, pmos, opamp) | circuits |

## Style

- **Lettering:** 14 pt Arial (the USPTO style's own size, cap height 3.5 mm). Boxes grow to fit wrapped text.
- **Numerals:** two styles.
  - *Underlined in the box* ("Control Circuit 112", as FIG. 1 does).
  - *Outside with a curved lead line* (FIG. 2A style).
- **Figure numeral:** a figure numeral (100) with an arrow pointing at the figure.
- **Label:** "FIG. n" under the figure.
- **Width:** at most 17.0 cm (the sheet's usable width). A figure that cannot fit at full lettering size is said, never
  shrunk below 1/8 in.

## Layout

- **Block, flowchart and state diagrams:** a layered layout.
  - Layers come from the longest path, with cycles broken at back edges.
  - Order within a layer is set by barycentre sweeps.
  - Edges are orthogonal: down between layers, around the side for back edges.
- **Sequence diagrams:** a column per participant, a row per message.
- **Timing diagrams:** a row per signal, with a shared time grid.
- **Schematics:** placed on the grid exactly as written.

## Checks (refuse by name, never draw wrong)

- An arrow to an undefined box.
- A numeral used twice.
- A decision without two exits.
- A timing signal with no levels, or more than 64 periods (any token other than 0, 1, x or z is a bus value, drawn labelled).
- An unknown symbol.
- A wire or component that touches nothing (warning).
- A figure too wide for the sheet at 1/8 in lettering (warning, with the width).

## Tests

- **Parsing:** each kind, with its errors.
- **Layout invariants:** no box overlaps another; every arrow starts and ends on a box border; text stays inside its
  box; numerals are unique; lettering is at least the USPTO minimum.
- **Pane:** a DOM test.
- **Host trace:** a seed for Insert.
- **Review:** an independent review.
