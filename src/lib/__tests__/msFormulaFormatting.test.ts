// MS fragmentation formulas must carry real sub/superscripts.
//
// Reported from the pane twice: the spectrum insert went through insertText,
// which cannot carry formatting at all, so every formula landed flat — "C9H6O3"
// where the rest of the product renders C₉H₆O₃. parseChemical/segmentsToHtml is
// the formatter Chemical mode already uses.
import { parseChemical } from "../chemParser";
import { segmentsToHtml } from "../segments";
import { predictFragments } from "../fragment";

const html = (f: string) => segmentsToHtml(parseChemical(f));

describe("chemical formulas render with real subscripts", () => {
  test("the canonical case: H2O", () => {
    expect(html("H2O")).toBe("H<sub>2</sub>O");
  });

  test("every aspirin fragment formula gets subscripted digits", () => {
    const r = predictFragments("aspirin")!;
    expect(html(r.formula)).toBe("C<sub>9</sub>H<sub>8</sub>O<sub>4</sub>");

    const water = r.fragments.find((f) => f.neutralLoss === "H2O")!;
    expect(html(water.formula)).toBe("C<sub>9</sub>H<sub>6</sub>O<sub>3</sub>");
    expect(html(water.neutralLoss)).toBe("H<sub>2</sub>O");

    const co2 = r.fragments.find((f) => f.neutralLoss === "CO2")!;
    expect(html(co2.neutralLoss)).toBe("CO<sub>2</sub>");
  });

  test("a single-atom count stays bare — C1 is not a formula anyone writes", () => {
    expect(html("CHO2")).toBe("CHO<sub>2</sub>");
    expect(html("C2H3O")).toBe("C<sub>2</sub>H<sub>3</sub>O");
  });

  test("every fragment of every probe compound formats without leaving a raw digit", () => {
    for (const name of ["aspirin", "caffeine", "paracetamol", "toluene"]) {
      const r = predictFragments(name);
      if (!r) continue;
      for (const f of r.fragments) {
        const out = html(f.formula);
        // No digit may survive outside a <sub>/<sup>.
        const stripped = out.replace(/<sub>\d+<\/sub>/g, "").replace(/<sup>[^<]*<\/sup>/g, "");
        expect({ formula: f.formula, stripped }).toEqual({ formula: f.formula, stripped: stripped.replace(/\d/g, "") });
      }
    }
  });

  test("the radical dot is kept outside the formula parse", () => {
    // "•CH3" is not a formula; the bullet must not be handed to parseChemical.
    const m = /^([•·]?)(.*)$/.exec("•CH3")!;
    expect(m[1]).toBe("•");
    expect(html(m[2])).toBe("CH<sub>3</sub>");
  });
});
