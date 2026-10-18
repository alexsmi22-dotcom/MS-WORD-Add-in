/**
 * The CAD canvas's live preview and picking (docs/SCOPE-CAD-CANVAS.md, R1b).
 *
 * While the user drags to orbit (as in the 3D molecule view), the canvas paints
 * flat-shaded faces through a per-pixel depth buffer — painting whole triangles
 * back to front showed a pin THROUGH the plate it passes into, because one tall
 * wall triangle cannot be both behind and in front. Cheap enough for every
 * pointer move at canvas size. When
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

/** One filled face: canvas-space corners, their camera depths (larger = nearer), a grey level, its body. */
export interface ShadeOp {
  pts: [number, number, number, number, number, number];
  z: [number, number, number];
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
      z: [c[2], c[5], c[8]],
      depth: (c[2] + c[5] + c[8]) / 3,
      grey: Math.round(150 + 95 * lambert),
      body: mesh.triBody[t / 3],
    });
  }
  ops.sort((a, b) => a.depth - b.depth);
  return ops;
}

/**
 * The shaded picture as RGBA pixels, `pxScale` device pixels per canvas unit:
 * each pixel takes the NEAREST face covering its centre (a depth buffer), so
 * parts that pass through each other, and a part's own recesses, shade right.
 * `selected` bodies are tinted blue so the user sees what an edit will change.
 */
export function shadeRaster(ops: ShadeOp[], w: number, h: number, pxScale = 1, selected: ReadonlySet<number> = new Set()): { data: Uint8ClampedArray; width: number; height: number } {
  const W = Math.max(1, Math.round(w * pxScale)), H = Math.max(1, Math.round(h * pxScale));
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const depth = new Float32Array(W * H).fill(-Infinity);
  for (const o of ops) {
    const x0 = o.pts[0] * pxScale, y0 = o.pts[1] * pxScale;
    const x1 = o.pts[2] * pxScale, y1 = o.pts[3] * pxScale;
    const x2 = o.pts[4] * pxScale, y2 = o.pts[5] * pxScale;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) continue;
    const g = o.grey;
    const [r, gg, b] = selected.has(o.body) ? [Math.round(g * 0.62), Math.round(g * 0.78), g] : [g, g, g];
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    // A hair of overlap so shared edges leave no seam.
    const eps = -1e-3;
    const inv = 1 / area;
    // The weights are linear across the page: step them along each row.
    const d0 = (y1 - y2) * inv, d1 = (y2 - y0) * inv;
    const [z0, z1, z2] = o.z;
    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      const cx0 = minX + 0.5;
      let l0 = ((x1 - cx0) * (y2 - cy) - (x2 - cx0) * (y1 - cy)) * inv;
      let l1 = ((x2 - cx0) * (y0 - cy) - (x0 - cx0) * (y2 - cy)) * inv;
      for (let px = minX; px <= maxX; px++, l0 += d0, l1 += d1) {
        const l2 = 1 - l0 - l1;
        if (l0 < eps || l1 < eps || l2 < eps) continue;
        const z = l0 * z0 + l1 * z1 + l2 * z2;
        const k = py * W + px;
        if (z <= depth[k]) continue;
        depth[k] = z;
        data[4 * k] = r;
        data[4 * k + 1] = gg;
        data[4 * k + 2] = b;
      }
    }
  }
  return { data, width: W, height: H };
}

/**
 * Paints the preview at the canvas's device resolution (`dpr` device pixels per
 * CSS pixel). `fast` (while dragging) shades at most ~350,000 pixels and scales
 * the picture up, so a large window stays smooth; the drag's end repaints sharp.
 */
export function paintPreview(
  ctx: CanvasRenderingContext2D,
  ops: ShadeOp[],
  w: number,
  h: number,
  selected: ReadonlySet<number> = new Set(),
  dpr = 1,
  fast = false,
): void {
  const scale = fast ? Math.min(dpr, Math.sqrt(350_000 / Math.max(1, w * h))) : dpr;
  const img = shadeRaster(ops, w, h, scale, selected);
  const out = ctx.createImageData(img.width, img.height);
  out.data.set(img.data);
  if (scale === dpr) {
    ctx.putImageData(out, 0, 0); // device pixels: unaffected by the context's transform
    return;
  }
  const tmp = ctx.canvas.ownerDocument.createElement("canvas");
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext("2d")?.putImageData(out, 0, 0);
  ctx.drawImage(tmp, 0, 0, w, h); // through the context's transform: CSS pixels
}

/** What a click hit: the body and the WORLD point on its surface. */
export interface Pick {
  body: number;
  point: Vec3;
  /** The triangle under the cursor (cadMate reads its face). */
  tri: number;
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
      tri: t / 3,
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
