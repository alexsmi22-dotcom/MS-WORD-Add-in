/**
 * The CAD canvas's live preview and picking (docs/SCOPE-CAD-CANVAS.md, R1b).
 *
 * While the user drags to orbit (as in the 3D molecule view), the canvas paints
 * flat-shaded faces back to front — cheap enough for every pointer move. When
 * the drag ends, the exact hidden-line drawing (cadLines.ts) is laid over it,
 * and THAT drawing, not this shading, is what gets inserted.
 *
 * Picking answers "which body, and which point on its surface, is under the
 * cursor?" — the nearest triangle covering the pixel — so a click can select a
 * body to edit or anchor a reference numeral to a real surface point.
 */
import type { Mesh, Vec3 } from "./cadModel";
import type { CadView } from "./cadLines";

/** Camera → canvas pixels: uniform scale, origin, page y downward. */
export interface Fit {
  scale: number;
  ox: number;
  oy: number;
}

/** A fit that frames the whole mesh in a w×h canvas for this view (margin in px). */
export function fitView(mesh: Mesh, view: CadView, w: number, h: number, margin = 24, zoom = 1): Fit {
  const R = view.rot;
  const P = mesh.positions;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = R[0] * P[i] + R[1] * P[i + 1] + R[2] * P[i + 2];
    const y = R[3] * P[i] + R[4] * P[i + 1] + R[5] * P[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { scale: 1, ox: w / 2, oy: h / 2 };
  const sw = maxX - minX || 1, sh = maxY - minY || 1;
  const scale = Math.min((w - 2 * margin) / sw, (h - 2 * margin) / sh) * Math.max(0.1, Math.min(10, zoom));
  return { scale, ox: w / 2 - ((minX + maxX) / 2) * scale, oy: h / 2 + ((minY + maxY) / 2) * scale };
}

/** One filled face for the painter: canvas-space corners, a grey level, its body. */
export interface ShadeOp {
  pts: [number, number, number, number, number, number];
  depth: number;
  grey: number;
  body: number;
}

/**
 * Front-facing triangles, Lambert-shaded from a light over the viewer's
 * shoulder, sorted far → near. A selected body is tinted by the caller.
 */
export function previewOps(mesh: Mesh, view: CadView, fit: Fit): ShadeOp[] {
  const R = view.rot;
  const P = mesh.positions;
  const T = mesh.triangles;
  // Light in camera space: up-left and toward the eye.
  const L = norm3([-0.35, 0.55, 0.76]);
  const ops: ShadeOp[] = [];
  for (let t = 0; t < T.length; t += 3) {
    const c: number[] = [];
    for (let k = 0; k < 3; k++) {
      const i = 3 * T[t + k];
      const x = P[i], y = P[i + 1], z = P[i + 2];
      c.push(R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z);
    }
    // Geometric face normal in camera space (the tessellator winds faces outward).
    const ux = c[3] - c[0], uy = c[4] - c[1], uz = c[5] - c[2];
    const vx = c[6] - c[0], vy = c[7] - c[1], vz = c[8] - c[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl === 0) continue;
    nx /= nl; ny /= nl; nz /= nl;
    if (nz <= 0) continue; // facing away
    const lambert = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    ops.push({
      pts: [
        fit.ox + c[0] * fit.scale, fit.oy - c[1] * fit.scale,
        fit.ox + c[3] * fit.scale, fit.oy - c[4] * fit.scale,
        fit.ox + c[6] * fit.scale, fit.oy - c[7] * fit.scale,
      ],
      depth: (c[2] + c[5] + c[8]) / 3,
      grey: Math.round(150 + 95 * lambert),
      body: mesh.triBody[t / 3],
    });
  }
  ops.sort((a, b) => a.depth - b.depth);
  return ops;
}

/** Paints the preview. `selected` bodies are tinted blue so the user sees what an edit will change. */
export function paintPreview(ctx: CanvasRenderingContext2D, ops: ShadeOp[], w: number, h: number, selected: ReadonlySet<number> = new Set()): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  for (const o of ops) {
    const g = o.grey;
    ctx.fillStyle = selected.has(o.body) ? `rgb(${Math.round(g * 0.62)},${Math.round(g * 0.78)},${g})` : `rgb(${g},${g},${g})`;
    ctx.strokeStyle = ctx.fillStyle; // hairline seams between triangles disappear
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(o.pts[0], o.pts[1]);
    ctx.lineTo(o.pts[2], o.pts[3]);
    ctx.lineTo(o.pts[4], o.pts[5]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** What a click hit: the body and the WORLD point on its surface. */
export interface Pick {
  body: number;
  point: Vec3;
}

/** The nearest front-facing surface under canvas pixel (px, py), or null over empty space. */
export function pickAt(mesh: Mesh, view: CadView, fit: Fit, px: number, py: number): Pick | null {
  const R = view.rot;
  const P = mesh.positions;
  const T = mesh.triangles;
  // Back to camera units.
  const x = (px - fit.ox) / fit.scale;
  const y = (fit.oy - py) / fit.scale;
  let best: Pick | null = null;
  let bestZ = -Infinity;
  for (let t = 0; t < T.length; t += 3) {
    const w: Vec3[] = [];
    const c: Vec3[] = [];
    for (let k = 0; k < 3; k++) {
      const i = 3 * T[t + k];
      const p: Vec3 = [P[i], P[i + 1], P[i + 2]];
      w.push(p);
      c.push([R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]]);
    }
    const det = (c[1][1] - c[2][1]) * (c[0][0] - c[2][0]) + (c[2][0] - c[1][0]) * (c[0][1] - c[2][1]);
    if (Math.abs(det) < 1e-18) continue;
    const l1 = ((c[1][1] - c[2][1]) * (x - c[2][0]) + (c[2][0] - c[1][0]) * (y - c[2][1])) / det;
    const l2 = ((c[2][1] - c[0][1]) * (x - c[2][0]) + (c[0][0] - c[2][0]) * (y - c[2][1])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = l1 * c[0][2] + l2 * c[1][2] + l3 * c[2][2];
    if (z <= bestZ) continue;
    bestZ = z;
    best = {
      body: mesh.triBody[t / 3],
      point: [l1 * w[0][0] + l2 * w[1][0] + l3 * w[2][0], l1 * w[0][1] + l2 * w[1][1] + l3 * w[2][1], l1 * w[0][2] + l2 * w[1][2] + l3 * w[2][2]],
    };
  }
  return best;
}

function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * One drag step of the orbit, as in the 3D molecule view: horizontal motion
 * turns the model about the screen's vertical axis, vertical motion about its
 * horizontal axis. Re-orthonormalised (Gram–Schmidt) so rounding never shears
 * the drawing after a long drag.
 */
export function orbit(view: CadView, dxPx: number, dyPx: number, degPerPx = 0.5): CadView {
  const a = (dxPx * degPerPx * Math.PI) / 180;
  const b = (dyPx * degPerPx * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // Camera-space rotations: yaw about camera Y, pitch about camera X.
  const yaw = [ca, 0, sa, 0, 1, 0, -sa, 0, ca];
  const pitch = [1, 0, 0, 0, cb, -sb, 0, sb, cb];
  const m = mulRot(pitch, mulRot(yaw, view.rot));
  // Gram–Schmidt on the rows.
  const r0 = norm3([m[0], m[1], m[2]]);
  let r1: Vec3 = [m[3], m[4], m[5]];
  const d = r1[0] * r0[0] + r1[1] * r0[1] + r1[2] * r0[2];
  r1 = norm3([r1[0] - d * r0[0], r1[1] - d * r0[1], r1[2] - d * r0[2]]);
  const r2: Vec3 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
  return { name: "orbit", rot: [...r0, ...r1, ...r2] };
}

function mulRot(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
