/**
 * @jest-environment jsdom
 */
// A problem the canvas reports while a change is made ("The page could not be drawn …") is kept: the change
// notice says so (keepStatus), and the pane does not clear the status over it (it used to, at once).
import { TextDecoder as NodeTextDecoder } from "util";
import { createChemCanvas, CanvasChange } from "../../taskpane/chemCanvas";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

let failing = false;
jest.mock("../cdxmlRender", () => {
  const actual = jest.requireActual("../cdxmlRender");
  return {
    ...actual,
    renderCdx: (...args: unknown[]) => {
      if (failing) throw new Error("renderer test failure");
      return actual.renderCdx(...args);
    },
  };
});

function setup() {
  document.body.innerHTML = '<div id="mount"></div>';
  const status: Array<[string, string]> = [];
  const changes: CanvasChange[] = [];
  const c = createChemCanvas(document.getElementById("mount")!, { setStatus: (m, k) => void status.push([m, k ?? ""]) });
  c.setOnChangeListener((e) => void changes.push(e));
  const surface = document.querySelector<HTMLElement>(".chem-canvas-surface")!;
  const click = (x: number, y: number): void => {
    const svg = surface.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const at = { clientX: x - vx, clientY: y - vy };
    surface.dispatchEvent(new MouseEvent("pointerdown", { ...at, button: 0, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointerup", { ...at, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("click", { ...at, bubbles: true }));
  };
  return { c, status, changes, click };
}

describe("a problem reported during a change is kept", () => {
  test("a page that could not be drawn: the notice says keepStatus, and the next good edit does not", () => {
    const t = setup();
    failing = true;
    t.click(60, 60); // a bond on empty paper; the page cannot be drawn
    failing = false;
    expect(t.status.some(([m, k]) => m.startsWith("The page could not be drawn") && k === "error")).toBe(true);
    expect(t.changes.at(-1)).toEqual({ isUserEvent: true, keepStatus: true });
    t.click(140, 140); // another bond, drawn fine
    expect(t.changes.at(-1)).toEqual({ isUserEvent: true });
  });

  test("an ordinary edit keeps nothing", () => {
    const t = setup();
    t.click(60, 60);
    expect(t.changes.at(-1)).toEqual({ isUserEvent: true });
  });
});
