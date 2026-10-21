// The plane-frame figure, drawn to go into a document: the frame with its supports and loads and its deflected shape
// (dashed, scaled up so it can be seen, the scale stated), then the bending-moment diagram drawn on the members, each
// member's largest moment labelled. Colours are literal hex: inserted artwork never follows the pane's theme.

import type { FrameResult } from "./frame2d";
import { fmtSig } from "./axis";

/** The width, and the tallest the figure gets; a flat frame draws shorter panels (read the size from the SVG). */
export const FRAME_CHART_SIZE = { width: 460, height: 600 };
const W = FRAME_CHART_SIZE.width;
/** Each panel's title band: nothing is drawn above it. */
const BAND = 34;
const PAD = 46;
const INK = "#000000";
const MUTED = "#555555";

const f = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function frameChartSvg(r: FrameResult, units: { force: string; length: string } = { force: "kN", length: "m" }): string {
  const { nodes, members } = r.model;
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const s = Math.min((W - 2 * PAD) / Math.max(maxX - minX, span * 0.25), (280 - BAND - 2 * PAD) / Math.max(maxY - minY, span * 0.25));
  // Each panel as tall as the frame needs (room for loads, deflection and the moment diagram), within 190–280.
  const PANEL = Math.min(280, Math.max(190, BAND + 2 * PAD + (maxY - minY) * s + 0.32 * span * s));
  const H = 2 * PANEL + 20;
  const ox = (W - (maxX - minX) * s) / 2;
  // Vertically centred in the panel below its title band.
  const oy = (PANEL - BAND - (maxY - minY) * s) / 2;
  const P = (x: number, y: number, top: number): [number, number] => [ox + (x - minX) * s, top + BAND + oy + (maxY - y) * s];
  const out: string[] = [];
  const text = (x: number, y: number, t: string, anchor = "middle", size = 11, fill = INK): string =>
    `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="${fill}">${esc(t)}</text>`;
  const arrow = (x1: number, y1: number, x2: number, y2: number, color = INK): string => {
    const a = Math.atan2(y2 - y1, x2 - x1), h = 7;
    return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${color}" stroke-width="1.4"/><polygon points="${f(x2)},${f(y2)} ${f(x2 - h * Math.cos(a - 0.4))},${f(y2 - h * Math.sin(a - 0.4))} ${f(x2 - h * Math.cos(a + 0.4))},${f(y2 - h * Math.sin(a + 0.4))}" fill="${color}"/>`;
  };

  // ---- panel 1: the frame, supports, loads, deflected shape ----
  const top1 = 0;
  out.push(text(12, 18, "Frame, loads and deflected shape", "start", 12));
  const maxD = Math.max(1e-300, ...r.disp.map(([u, v]) => Math.hypot(u, v)));
  const mag = (0.12 * span) / maxD;
  for (const m of members) {
    const a = nodes[m.i], b = nodes[m.j];
    const [x1, y1] = P(a.x, a.y, top1), [x2, y2] = P(b.x, b.y, top1);
    out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${INK}" stroke-width="2.2"/>`);
    // Deflected shape: end displacements with the member's own bending (cubic Hermite in local coordinates).
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, sn = (b.y - a.y) / L;
    const [ui, vi, ti] = r.disp[m.i], [uj, vj, tj] = r.disp[m.j];
    const ul = (u: number, v: number): [number, number] => [c * u + sn * v, -sn * u + c * v];
    const [ai, bi] = ul(ui, vi), [aj, bj] = ul(uj, vj);
    const pts: string[] = [];
    for (let k = 0; k <= 20; k++) {
      const xi = k / 20;
      const h1 = 1 - 3 * xi * xi + 2 * xi ** 3, h2 = L * (xi - 2 * xi * xi + xi ** 3), h3 = 3 * xi * xi - 2 * xi ** 3, h4 = L * (-xi * xi + xi ** 3);
      const along = ai + (aj - ai) * xi;
      // A hinge's own rotation is not the node's: the member's end rotations are recovered from its end forces only
      // approximately here, so a hinged end is drawn straight (the shape is illustrative; the numbers are exact).
      const across = m.hinge[0] || m.hinge[1] ? bi + (bj - bi) * xi : h1 * bi + h2 * ti + h3 * bj + h4 * tj;
      const gx = a.x + c * (xi * L) + mag * (c * along - sn * across), gy = a.y + sn * (xi * L) + mag * (sn * along + c * across);
      const [px, py] = P(gx, gy, top1);
      pts.push(`${f(px)},${f(py)}`);
    }
    out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="5 3"/>`);
    if (m.hinge[0] || m.hinge[1]) {
      for (const [end, on] of [[0, m.hinge[0]], [1, m.hinge[1]]] as const) {
        if (!on) continue;
        const nx = end === 0 ? x1 + (x2 - x1) * 0.04 : x2 - (x2 - x1) * 0.04, ny = end === 0 ? y1 + (y2 - y1) * 0.04 : y2 - (y2 - y1) * 0.04;
        out.push(`<circle cx="${f(nx)}" cy="${f(ny)}" r="3.5" fill="#ffffff" stroke="${INK}" stroke-width="1.4"/>`);
      }
    }
  }
  for (const [ni, rs] of r.model.supports) {
    const [x, y] = P(nodes[ni].x, nodes[ni].y, top1);
    if (rs[0] && rs[1] && rs[2]) {
      // A fixed support is a wall across the member that meets it, hatched on the side away from the member.
      const m = members.find((mm) => mm.i === ni || mm.j === ni);
      let dx = 0, dy = 1;
      if (m) {
        const other = nodes[m.i === ni ? m.j : m.i];
        const [qx, qy] = P(other.x, other.y, top1);
        const l = Math.hypot(qx - x, qy - y) || 1;
        dx = (x - qx) / l;
        dy = (y - qy) / l;
      }
      const tx = -dy, ty = dx;
      out.push(`<line x1="${f(x - tx * 14)}" y1="${f(y - ty * 14)}" x2="${f(x + tx * 14)}" y2="${f(y + ty * 14)}" stroke="${INK}" stroke-width="2.4"/>`);
      for (let k = -12; k <= 12; k += 6) {
        const bx = x + tx * k, by = y + ty * k;
        out.push(`<line x1="${f(bx)}" y1="${f(by)}" x2="${f(bx + dx * 6 - tx * 5)}" y2="${f(by + dy * 6 - ty * 5)}" stroke="${INK}" stroke-width="1"/>`);
      }
    } else {
      out.push(`<polygon points="${f(x)},${f(y)} ${f(x - 9)},${f(y + 13)} ${f(x + 9)},${f(y + 13)}" fill="#ffffff" stroke="${INK}" stroke-width="1.4"/>`);
      if (!(rs[0] && rs[1])) {
        out.push(`<circle cx="${f(x - 5)}" cy="${f(y + 17)}" r="3" fill="#ffffff" stroke="${INK}"/><circle cx="${f(x + 5)}" cy="${f(y + 17)}" r="3" fill="#ffffff" stroke="${INK}"/>`);
      }
    }
  }
  for (const [ni, [Fx, Fy, M]] of r.model.nodalLoads) {
    const [x, y] = P(nodes[ni].x, nodes[ni].y, top1);
    if (Fx) out.push(arrow(x - 34 * Math.sign(Fx), y, x - 3 * Math.sign(Fx), y), text(x - 36 * Math.sign(Fx), y - 6, `${fmtSig(Math.abs(Fx), 3)} ${units.force}`, Fx > 0 ? "end" : "start", 10));
    if (Fy) out.push(arrow(x, y + 34 * Math.sign(Fy), x, y + 3 * Math.sign(Fy)), text(x + 6, y + 34 * Math.sign(Fy), `${fmtSig(Math.abs(Fy), 3)} ${units.force}`, "start", 10));
    if (M) out.push(`<path d="M${f(x + 12)} ${f(y)} A12 12 0 1 ${M > 0 ? 0 : 1} ${f(x)} ${f(y - 12)}" fill="none" stroke="${INK}" stroke-width="1.3"/>`, text(x + 16, y - 12, `${fmtSig(Math.abs(M), 3)} ${units.force}·${units.length}`, "start", 10));
  }
  for (const ld of r.model.memberLoads) {
    const m = members[ld.member];
    const a = nodes[m.i], b = nodes[m.j];
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, sn = (b.y - a.y) / L;
    const dir = Math.sign(ld.w);
    // Arrows along the member's local y, pointing the way the load acts.
    const marks = ld.kind === "udl" ? Array.from({ length: 7 }, (_, k) => (k + 0.5) / 7) : [(ld.a ?? L / 2) / L];
    for (const xi of marks) {
      const bx = a.x + c * xi * L, by = a.y + sn * xi * L;
      const [x0, y0] = P(bx, by, top1);
      const nx = -sn * dir, ny = c * dir;
      out.push(arrow(x0 - nx * 26, y0 + ny * 26, x0 - nx * 3, y0 + ny * 3));
    }
    const [mx, my] = P(a.x + c * L * 0.5, a.y + sn * L * 0.5, top1);
    out.push(text(mx - sn * 34 * -dir, my - c * 34 * -dir - 4, ld.kind === "udl" ? `${fmtSig(Math.abs(ld.w), 3)} ${units.force}/${units.length}` : `${fmtSig(Math.abs(ld.w), 3)} ${units.force}`, "middle", 10));
  }
  out.push(text(W - 12, 18, `deflected shape dashed, × ${fmtSig(mag, 2)}`, "end", 10, MUTED));

  // ---- panel 2: bending moment on the members ----
  const top2 = PANEL + 20;
  out.push(text(12, top2 + 18, `Bending moment (${units.force}·${units.length}), drawn on the tension side`, "start", 12));
  const labels: Array<{ x: number; y: number; t: string }> = [];
  const maxM = Math.max(1e-300, ...r.members.flatMap((mr) => mr.moment.map((p) => Math.abs(p[1]))));
  const ms = (0.16 * span) / maxM;
  r.members.forEach((mr, idx) => {
    const m = members[idx];
    const a = nodes[m.i], b = nodes[m.j];
    const L = mr.length, c = (b.x - a.x) / L, sn = (b.y - a.y) / L;
    const [x1, y1] = P(a.x, a.y, top2), [x2, y2] = P(b.x, b.y, top2);
    out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${INK}" stroke-width="1.6"/>`);
    // Sagging (positive) moment puts tension on the local −y face: drawn on that side.
    const poly = mr.moment.map(([x, M]) => {
      const gx = a.x + c * x + sn * M * ms, gy = a.y + sn * x - c * M * ms;
      return P(gx, gy, top2);
    });
    out.push(`<polygon points="${f(x1)},${f(y1)} ${poly.map(([px, py]) => `${f(px)},${f(py)}`).join(" ")} ${f(x2)},${f(y2)}" fill="#d9d9d9" stroke="${INK}" stroke-width="1"/>`);
    const mx = mr.maxMoment;
    if (Math.abs(mx.M) > maxM * 1e-6) {
      // Beyond the diagram's outline along its normal; one label per value and place (a knee's two members agree).
      const gx = a.x + c * mx.x + sn * mx.M * ms, gy = a.y + sn * mx.x - c * mx.M * ms;
      const [px, py] = P(gx, gy, top2);
      const nx = (sn * Math.sign(mx.M)), ny = (c * Math.sign(mx.M));
      const lx = px + nx * 14, ly = py + ny * 14 + 4;
      const label = fmtSig(Math.abs(mx.M), 4);
      if (!labels.some((q) => q.t === label && Math.hypot(q.x - lx, q.y - ly) < 60)) {
        labels.push({ x: lx, y: ly, t: label });
        out.push(text(lx, ly, label, Math.abs(nx) > 0.5 ? (nx > 0 ? "start" : "end") : "middle", 10));
      }
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${f(H)}" viewBox="0 0 ${W} ${f(H)}"><rect width="${W}" height="${f(H)}" fill="#ffffff"/>${out.join("")}</svg>`;
}
