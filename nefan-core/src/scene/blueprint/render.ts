/** Renderers por tipo de volumen del compositor de blueprints.
 *
 *  Truco central que unifica ambas perspectivas: toda cara vertical se emite
 *  como quad de vértices (u, v, h) proyectados con `proj.pt`. En topdown las
 *  caras este/oeste degeneran a área ~0 y se descartan solas; en iso las dos
 *  caras de cámara (SE/SO) salen con su paralaje correcto. El color de cada
 *  cara se elige por su normal exterior: componente +v → cara iluminada
 *  (SO/sur), +u → cara en sombra (SE). El orden del pintor lo impone
 *  `compose.ts` (profundidad de la huella); dentro de un volumen el orden es
 *  sombra → caras → tapa → detalle. */

import type { SeededRng } from "../../combat/enemy-ai.js";
import { PALETTE, type FaceColors, roofColors, wallColors } from "./palette.js";
import type { Projection } from "./projection.js";
import { ISO_SX, ISO_SY } from "./projection.js";
import type {
  BuildingVolume,
  GateVolume,
  PropVolume,
  TowerVolume,
  TreeVolume,
  Volume,
  WallVolume,
} from "./volumes.js";
import { circle, ellipse, fmt, line, path, polygon, uniform } from "./svg.js";

export interface RenderCtx {
  proj: Projection;
  rng: SeededRng;
  out: string[];
  /** bbox acumulado (unidades de usuario del SVG) del volumen en curso. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

function track(ctx: RenderCtx, x: number, y: number, pad = 0): void {
  if (!ctx.bbox) {
    ctx.bbox = { minX: x - pad, minY: y - pad, maxX: x + pad, maxY: y + pad };
    return;
  }
  const b = ctx.bbox;
  b.minX = Math.min(b.minX, x - pad);
  b.minY = Math.min(b.minY, y - pad);
  b.maxX = Math.max(b.maxX, x + pad);
  b.maxY = Math.max(b.maxY, y + pad);
}

type UVH = [number, number, number];

/** Área con signo de un polígono en pantalla (para descartar degenerados). */
function screenArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Emite un polígono de vértices (u,v,h). Degenerado (área < 0.06) → no-op. */
export function quadUVH(ctx: RenderCtx, pts: UVH[], fill: string, extra = ""): void {
  const proj = pts.map(([u, v, h]) => ctx.proj.pt(u, v, h));
  if (Math.abs(screenArea(proj)) < 0.06) return;
  for (const [x, y] of proj) track(ctx, x, y);
  ctx.out.push(polygon(proj, fill, extra));
}

/** Cara vertical del segmento a→b, de altura h. */
function face(ctx: RenderCtx, a: [number, number], b: [number, number], h: number, fill: string): void {
  quadUVH(ctx, [[a[0], a[1], h], [b[0], b[1], h], [b[0], b[1], 0], [a[0], a[1], 0]], fill);
}

/** Cara vertical entre dos alturas (almenas: NO arrancan en el suelo). */
function faceSpan(ctx: RenderCtx, a: [number, number], b: [number, number], h0: number, h1: number, fill: string): void {
  quadUVH(ctx, [[a[0], a[1], h1], [b[0], b[1], h1], [b[0], b[1], h0], [a[0], a[1], h0]], fill);
}

/** Color de cara según su normal exterior en mundo (nu, nv). */
function faceColor(colors: FaceColors, nu: number, nv: number): string {
  return nv >= Math.abs(nu) * 0.5 ? colors.lit : colors.shade;
}

/** Elipse del plano del suelo: círculo de mundo (u,v,r) proyectado. */
function groundEllipse(ctx: RenderCtx, u: number, v: number, r: number, fill: string, extra = "", dy = 0): void {
  const [cx, cy] = ctx.proj.pt(u, v);
  const iso = ctx.proj.kind === "isometric";
  const rx = iso ? r * Math.SQRT2 * ISO_SX : r;
  const ry = iso ? r * Math.SQRT2 * ISO_SY : r;
  track(ctx, cx - rx, cy + dy - ry);
  track(ctx, cx + rx, cy + dy + ry);
  ctx.out.push(ellipse(cx, cy + dy, rx, ry, fill, extra));
}

function shadow(ctx: RenderCtx, u: number, v: number, r: number): void {
  groundEllipse(ctx, u + 0.8, v + 0.5, r, PALETTE.shadow, 'opacity="0.14"');
}

/** Cilindro: cortina de la semicircunferencia de cámara + tapa elíptica. */
function cylinder(ctx: RenderCtx, u: number, v: number, r: number, h: number, colors: FaceColors): void {
  const K = 10;
  // Semicircunferencia orientada a cámara: en topdown la sur, en iso la SE+SO.
  const a0 = ctx.proj.kind === "isometric" ? -Math.PI / 4 : 0;
  const arc: [number, number][] = [];
  for (let i = 0; i <= K; i++) {
    const a = a0 + (i / K) * Math.PI;
    arc.push([u + r * Math.cos(a), v + r * Math.sin(a)]);
  }
  for (let i = 0; i < K; i++) {
    const [au, av] = arc[i];
    const [bu, bv] = arc[i + 1];
    const nu = (au + bu) / 2 - u;
    const nv = (av + bv) / 2 - v;
    face(ctx, [au, av], [bu, bv], h, faceColor(colors, nu, nv));
  }
  const [cx, cy] = ctx.proj.pt(u, v, h);
  const iso = ctx.proj.kind === "isometric";
  const rx = iso ? r * Math.SQRT2 * ISO_SX : r;
  const ry = iso ? r * Math.SQRT2 * ISO_SY : r;
  track(ctx, cx - rx, cy - ry);
  track(ctx, cx + rx, cy + ry);
  ctx.out.push(ellipse(cx, cy, rx, ry, colors.top));
}

/** Juntas de sillería deterministas sobre una cara (líneas cortas). */
function jointLines(ctx: RenderCtx, a: [number, number], b: [number, number], h: number, joint: string, n: number): void {
  for (let i = 0; i < n; i++) {
    const t = uniform(ctx.rng, 0.08, 0.92);
    const u = a[0] + (b[0] - a[0]) * t;
    const v = a[1] + (b[1] - a[1]) * t;
    const h0 = uniform(ctx.rng, 0.2, Math.max(0.3, h - 2));
    const p1 = ctx.proj.pt(u, v, h0);
    const p2 = ctx.proj.pt(u, v, Math.min(h, h0 + 1.6));
    ctx.out.push(line(p1, p2, joint, 0.22));
  }
  const hh = h / 2;
  ctx.out.push(line(ctx.proj.pt(a[0], a[1], hh), ctx.proj.pt(b[0], b[1], hh), joint, 0.22));
}

// ---------------------------------------------------------------- árboles

export function renderTree(ctx: RenderCtx, t: TreeVolume): void {
  const s = t.s ?? 1;
  const [bx, by] = ctx.proj.pt(t.at[0], t.at[1]);
  const o = ctx.out;
  const th = 5 * s;
  groundEllipse(ctx, t.at[0] + 0.9, t.at[1] + 0.5, 2.6 * s, PALETTE.shadow, 'opacity="0.16"');
  o.push(
    path(
      `M${fmt(bx - 1.4 * s)},${fmt(by)} L${fmt(bx - 0.8 * s)},${fmt(by - 1.2 * s)} L${fmt(bx - 0.8 * s)},${fmt(by - th)} L${fmt(bx + 0.8 * s)},${fmt(by - th)} L${fmt(bx + 0.8 * s)},${fmt(by - 1.2 * s)} L${fmt(bx + 1.4 * s)},${fmt(by)} Z`,
      PALETTE.trunk,
    ),
  );
  o.push(`<rect x="${fmt(bx + 0.1 * s)}" y="${fmt(by - th)}" width="${fmt(0.7 * s)}" height="${fmt(th - 0.2 * s)}" fill="${PALETTE.trunkDark}"/>`);
  const cy = by - th - 2.6 * s;
  const blobs: [number, number, number][] = [[0, 0, 5.2], [-3.4, 1.4, 3.6], [3.4, 1.2, 3.7], [-1.8, -2.6, 3.4], [2, -2.4, 3.2]];
  for (const [dx, dy, r] of blobs) o.push(circle(bx + dx * s, cy + dy * s, r * s, PALETTE.canopy));
  o.push(
    path(
      `M${fmt(bx - 4.6 * s)},${fmt(cy + 2.2 * s)} Q${fmt(bx)},${fmt(cy + 5.4 * s)} ${fmt(bx + 4.6 * s)},${fmt(cy + 2 * s)} Q${fmt(bx)},${fmt(cy + 3.4 * s)} ${fmt(bx - 4.6 * s)},${fmt(cy + 2.2 * s)} Z`,
      PALETTE.canopyDark,
    ),
  );
  for (const [dx, dy, r] of [[-2.4, -2.2, 2.6], [0.8, -3.2, 2.2], [-0.4, -0.6, 1.8]] as const) {
    o.push(circle(bx + dx * s, cy + dy * s, r * s, PALETTE.canopyLight));
  }
  track(ctx, bx - 6.8 * s, cy - 5.8 * s);
  track(ctx, bx + 6.8 * s, by + 1);
}

export function renderBush(ctx: RenderCtx, at: [number, number], s: number): void {
  const [bx, by] = ctx.proj.pt(at[0], at[1]);
  groundEllipse(ctx, at[0] + 0.5, at[1] + 0.3, 1.9 * s, PALETTE.shadow, 'opacity="0.13"');
  for (const [dx, dy, r] of [[0, -1.2, 2.4], [-2, -0.6, 1.8], [2, -0.7, 1.8]] as const) {
    ctx.out.push(circle(bx + dx * s, by + dy * s, r * s, PALETTE.canopy));
  }
  ctx.out.push(circle(bx - 0.9 * s, by - 2 * s, 1.5 * s, PALETTE.canopyLight));
  track(ctx, bx - 3.8 * s, by - 3.6 * s);
  track(ctx, bx + 3.8 * s, by + 1);
}

export function renderRock(ctx: RenderCtx, at: [number, number], s: number): void {
  const [bx, by] = ctx.proj.pt(at[0], at[1]);
  groundEllipse(ctx, at[0] + 0.4, at[1] + 0.3, 2.2 * s, PALETTE.shadow, 'opacity="0.13"');
  groundEllipse(ctx, at[0], at[1], 2.1 * s, "#57503f", "", -0.6 * s);
  groundEllipse(ctx, at[0] - 0.5 * s, at[1] - 0.4 * s, 1.3 * s, "#6d6552", "", -1.1 * s);
  ctx.out.push(line([bx - 1.4 * s, by - 1.4 * s], [bx + 1.2 * s, by - 1.6 * s], "#7d7561", 0.3));
}

// ---------------------------------------------------------------- muros

/** Offset de una polilínea hacia su lado de cámara (+depth) por `d` celdas. */
function offsetPolyline(pts: [number, number][], d: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let nx = next[1] - prev[1];
    let ny = -(next[0] - prev[0]);
    // Normal apuntando a +depth (sur / SE-SO): en ambas proyecciones el lado
    // de cámara es el de (nu+nv) mayor.
    if (nx + ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const len = Math.hypot(nx, ny) || 1;
    out.push([pts[i][0] + (nx / len) * d, pts[i][1] + (ny / len) * d]);
  }
  return out;
}

export function renderWall(ctx: RenderCtx, w: WallVolume): void {
  const width = w.width ?? 3;
  const h = w.h ?? 7;
  const pts = w.points.map(([u, v]) => [u, v] as [number, number]);
  const cam = offsetPolyline(pts, width / 2);
  const far = offsetPolyline(pts, -width / 2);
  // sombra al pie
  quadUVH(ctx, [...cam.map(([u, v]) => [u, v, 0] as UVH), ...[...cam].reverse().map(([u, v]) => [u + 0.6, v + 1.6, 0] as UVH)], PALETTE.shadow, 'opacity="0.14"');
  // caras de cámara por segmento (color por orientación)
  for (let i = 0; i < cam.length - 1; i++) {
    const a = cam[i];
    const b = cam[i + 1];
    const nu = b[1] - a[1];
    const nv = -(b[0] - a[0]);
    const sgn = nu + nv < 0 ? -1 : 1;
    const fill = faceColor(wallColors("stone"), nu * sgn, nv * sgn);
    face(ctx, a, b, h, fill);
    jointLines(ctx, a, b, h, PALETTE.stoneJoint, Math.max(2, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5)));
  }
  // adarve (banda superior)
  quadUVH(ctx, [...far.map(([u, v]) => [u, v, h] as UVH), ...[...cam].reverse().map(([u, v]) => [u, v, h] as UVH)], PALETTE.stoneTop);
  // almenas en el borde de cámara
  if (w.crenellated !== false) {
    for (let i = 0; i < cam.length - 1; i++) {
      const a = cam[i];
      const b = cam[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.floor(len / 4.4);
      for (let k = 0; k < n; k++) {
        const t0 = (k * 4.4 + 1) / len;
        const t1 = (k * 4.4 + 3.2) / len;
        if (t1 >= 1) break;
        const p0: [number, number] = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const p1: [number, number] = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        faceSpan(ctx, p0, p1, h, h + 1.8, PALETTE.merlon);
        quadUVH(ctx, [[p0[0], p0[1] - 1.1, h + 1.8], [p1[0], p1[1] - 1.1, h + 1.8], [p1[0], p1[1], h + 1.8], [p0[0], p0[1], h + 1.8]], PALETTE.merlon);
      }
    }
  }
}

export function renderTower(ctx: RenderCtx, t: TowerVolume): void {
  const r = t.r ?? 6;
  const h = t.h ?? 11;
  const colors = wallColors("stone");
  shadow(ctx, t.at[0] + 0.6, t.at[1] + 0.6, r + 1);
  cylinder(ctx, t.at[0], t.at[1], r, h, colors);
  // coronación: anillo almenado + suelo interior
  const [cx, cy] = ctx.proj.pt(t.at[0], t.at[1], h);
  const iso = ctx.proj.kind === "isometric";
  const rx = iso ? r * Math.SQRT2 * ISO_SX : r;
  const ry = iso ? r * Math.SQRT2 * ISO_SY : r;
  ctx.out.push(ellipse(cx, cy, rx, ry, "#57524a"));
  if (t.crenellated !== false) {
    ctx.out.push(
      ellipse(cx, cy, rx * 0.9, ry * 0.9, "none", `stroke="#a5a08f" stroke-width="${fmt(Math.max(1.1, r * 0.28))}" stroke-dasharray="2.1 1.5"`),
    );
  }
  ctx.out.push(ellipse(cx, cy, rx * 0.74, ry * 0.74, PALETTE.stoneTop));
  ctx.out.push(ellipse(cx, cy, rx * 0.62, ry * 0.62, "#7d7869"));
  // saeteras en la cara de cámara
  ctx.out.push(`<rect x="${fmt(cx - rx * 0.42)}" y="${fmt(cy + (iso ? 2 : 3))}" width="0.8" height="2.4" fill="#26221c"/>`);
  ctx.out.push(`<rect x="${fmt(cx + rx * 0.28)}" y="${fmt(cy + (iso ? 2.8 : 4))}" width="0.8" height="2.4" fill="#26221c"/>`);
}

export function renderGate(ctx: RenderCtx, g: GateVolume): void {
  const w = g.w ?? 8;
  const h = g.h ?? 10;
  const [au, av] = g.at;
  const depthHalf = 2.2;
  // Huella del cuerpo: vano `w` + 3 celdas de jamba a cada lado.
  const along = w / 2 + 3;
  const r: [number, number, number, number] =
    g.orient === "x" ? [au - along, av - depthHalf, along * 2, depthHalf * 2] : [au - depthHalf, av - along, depthHalf * 2, along * 2];
  renderBoxPrism(ctx, r, h, wallColors("stone"), { roofless: true });
  // almenas del cuerpo
  const [u0, v0, rw, rd] = r;
  const camEdge: [[number, number], [number, number]] =
    g.orient === "x" ? [[u0, v0 + rd], [u0 + rw, v0 + rd]] : [[u0 + rw, v0], [u0 + rw, v0 + rd]];
  for (let k = 0; k < 4; k++) {
    const t0 = 0.08 + k * 0.24;
    const p0: [number, number] = [camEdge[0][0] + (camEdge[1][0] - camEdge[0][0]) * t0, camEdge[0][1] + (camEdge[1][1] - camEdge[0][1]) * t0];
    const p1: [number, number] = [camEdge[0][0] + (camEdge[1][0] - camEdge[0][0]) * (t0 + 0.13), camEdge[0][1] + (camEdge[1][1] - camEdge[0][1]) * (t0 + 0.13)];
    faceSpan(ctx, p0, p1, h, h + 1.6, PALETTE.merlon);
  }
  // arco: hueco oscuro en la cara de cámara, camino visible al fondo
  const [gx, gy] = ctx.proj.pt(au, av + (g.orient === "x" ? depthHalf : 0), 0);
  const [gx2] = g.orient === "y" ? ctx.proj.pt(au + depthHalf, av, 0) : [gx];
  const ax = g.orient === "x" ? gx : gx2;
  const iso = ctx.proj.kind === "isometric";
  const halfW = (g.orient === "x" ? w / 2 : w / 2) * (iso ? Math.SQRT2 * ISO_SX * 0.75 : 0.55);
  const archH = h * (iso ? 0.375 : 1) * 0.62;
  ctx.out.push(
    path(
      `M${fmt(ax - halfW)},${fmt(gy)} L${fmt(ax - halfW)},${fmt(gy - archH)} A${fmt(halfW)},${fmt(halfW * 0.8)} 0 0 1 ${fmt(ax + halfW)},${fmt(gy - archH)} L${fmt(ax + halfW)},${fmt(gy)} Z`,
      "#211d17",
    ),
  );
  ctx.out.push(`<rect x="${fmt(ax - halfW * 0.7)}" y="${fmt(gy - 1.4)}" width="${fmt(halfW * 1.4)}" height="1.4" fill="${PALETTE.dirtDark}" opacity="0.6"/>`);
  ctx.out.push(
    path(`M${fmt(ax - halfW)},${fmt(gy - archH)} A${fmt(halfW)},${fmt(halfW * 0.8)} 0 0 1 ${fmt(ax + halfW)},${fmt(gy - archH)}`, "none", `stroke="#8b8678" stroke-width="0.9"`),
  );
  if (g.banners !== false) {
    for (const s of [-1, 1]) {
      const px = ax + s * (halfW + 1.6);
      ctx.out.push(
        path(
          `M${fmt(px - 0.95)},${fmt(gy - archH - 3.4)} L${fmt(px + 0.95)},${fmt(gy - archH - 3.4)} L${fmt(px + 0.95)},${fmt(gy - archH + 0.6)} L${fmt(px)},${fmt(gy - archH - 0.3)} L${fmt(px - 0.95)},${fmt(gy - archH + 0.6)} Z`,
          "#a03028",
        ),
      );
      ctx.out.push(circle(px, gy - archH - 2.2, 0.42, "#c9a24b"));
    }
  }
}

// ---------------------------------------------------------------- edificios

interface BoxOpts {
  roofless?: boolean;
  colors?: FaceColors;
}

/** Prisma rectangular: caras de cámara + tapa. Sirve de base a edificios,
 *  cuerpo de puerta y props box. */
function renderBoxPrism(ctx: RenderCtx, r: [number, number, number, number], h: number, colors: FaceColors, opts: BoxOpts = {}): void {
  const [u0, v0, w, d] = r;
  const u1 = u0 + w;
  const v1 = v0 + d;
  quadUVH(
    ctx,
    [[u0 + 1.2, v0 + 1.2, 0], [u1 + 1.6, v0 + 1.2, 0], [u1 + 1.6, v1 + 1.6, 0], [u0 + 1.2, v1 + 1.6, 0]],
    PALETTE.shadow,
    'opacity="0.12"',
  );
  // caras de cámara: sur (+v, iluminada) y este (+u, sombra; degenera en topdown)
  face(ctx, [u0, v1], [u1, v1], h, colors.lit);
  face(ctx, [u1, v1], [u1, v0], h, colors.shade);
  quadUVH(ctx, [[u0, v0, h], [u1, v0, h], [u1, v1, h], [u0, v1, h]], colors.top);
  if (!opts.roofless) return;
  // remate superior visible (sin techo): línea de coronación
  ctx.out.push(line(ctx.proj.pt(u0, v1, h), ctx.proj.pt(u1, v1, h), "#9a958a", 0.3));
}

function doorSpansForEdge(b: BuildingVolume, edge: "n" | "s" | "e" | "w"): [number, number][] {
  const spans: [number, number][] = [];
  for (const d of b.doors ?? []) {
    if (d.edge !== edge) continue;
    const w = d.w ?? 4;
    spans.push([d.at, d.at + w]);
  }
  return spans;
}

/** Trocea el segmento [0, len] quitando los spans (puertas). */
function splitSpans(len: number, holes: [number, number][]): [number, number][] {
  const sorted = [...holes].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = 0;
  for (const [h0, h1] of sorted) {
    if (h0 > cur) out.push([cur, Math.min(h0, len)]);
    cur = Math.max(cur, h1);
  }
  if (cur < len) out.push([cur, len]);
  return out.filter(([a, b]) => b - a > 0.2);
}

/** Fase de render de un edificio cutaway: el suelo y los muros traseros se
 *  pintan a la profundidad del borde NORTE (los muebles interiores —
 *  `prop`s del plan — quedan encima), y los muros frontales bajos a la del
 *  borde SUR (tapan la base de lo que quede detrás). Los edificios con techo
 *  se pintan en una sola fase ("base"). */
export type BuildingPhase = "base" | "front";

export function renderBuilding(ctx: RenderCtx, b: BuildingVolume, phase: BuildingPhase = "base"): void {
  const [u0, v0, w, d] = b.rect;
  const u1 = u0 + w;
  const v1 = v0 + d;
  const wallH = b.wall_h ?? 5;
  const colors = wallColors(b.walls?.material ?? (b.cutaway ? "wood" : "timber"), b.walls?.color);
  const roofKind = b.cutaway ? "none" : (b.roof?.kind ?? "gable");

  if (b.cutaway) {
    if (phase === "base") {
      quadUVH(
        ctx,
        [[u0 + 1.2, v0 + 1.2, 0], [u1 + 1.8, v0 + 1.2, 0], [u1 + 1.8, v1 + 1.8, 0], [u0 + 1.2, v1 + 1.8, 0]],
        PALETTE.shadow,
        'opacity="0.12"',
      );
      // suelo interior de madera
      quadUVH(ctx, [[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]], PALETTE.woodTop);
      for (let i = 1; i < Math.floor(d / 2.2); i++) {
        const vv = v0 + i * 2.2;
        ctx.out.push(line(ctx.proj.pt(u0, vv, 0), ctx.proj.pt(u1, vv, 0), "#6a4b2b", 0.25));
      }
      // muros traseros a altura completa (cara interior visible hacia cámara)
      face(ctx, [u0, v0 + 1.2], [u1, v0 + 1.2], wallH, colors.shade);
      quadUVH(ctx, [[u0, v0, wallH], [u1, v0, wallH], [u1, v0 + 1.2, wallH], [u0, v0 + 1.2, wallH]], colors.top);
      face(ctx, [u0 + 1.2, v0 + 1.2], [u0 + 1.2, v1], wallH, colors.lit);
      quadUVH(ctx, [[u0, v0, wallH], [u0 + 1.2, v0 + 1.2, wallH], [u0 + 1.2, v1, wallH], [u0, v1, wallH]], colors.top);
      return;
    }
    // fase "front": muros bajos con huecos de puerta + escalones
    const lowH = 1.8;
    for (const [a, z] of splitSpans(w, doorSpansForEdge(b, "s"))) {
      face(ctx, [u0 + a, v1], [u0 + z, v1], lowH, colors.lit);
      quadUVH(ctx, [[u0 + a, v1 - 1.2, lowH], [u0 + z, v1 - 1.2, lowH], [u0 + z, v1, lowH], [u0 + a, v1, lowH]], colors.top);
    }
    for (const [a, z] of splitSpans(d, doorSpansForEdge(b, "e"))) {
      face(ctx, [u1, v0 + a], [u1, v0 + z], lowH, colors.shade);
      quadUVH(ctx, [[u1 - 1.2, v0 + a, lowH], [u1, v0 + a, lowH], [u1, v0 + z, lowH], [u1 - 1.2, v0 + z, lowH]], colors.top);
    }
    for (const dd of b.doors ?? []) {
      const dw = dd.w ?? 4;
      if (dd.edge === "s") quadUVH(ctx, [[u0 + dd.at, v1, 0.4], [u0 + dd.at + dw, v1, 0.4], [u0 + dd.at + dw, v1 + 1.8, 0.4], [u0 + dd.at, v1 + 1.8, 0.4]], PALETTE.cobbleDark);
      if (dd.edge === "e") quadUVH(ctx, [[u1, v0 + dd.at, 0.4], [u1 + 1.8, v0 + dd.at, 0.4], [u1 + 1.8, v0 + dd.at + dw, 0.4], [u1, v0 + dd.at + dw, 0.4]], PALETTE.cobbleDark);
    }
    return;
  }

  quadUVH(
    ctx,
    [[u0 + 1.2, v0 + 1.2, 0], [u1 + 1.8, v0 + 1.2, 0], [u1 + 1.8, v1 + 1.8, 0], [u0 + 1.2, v1 + 1.8, 0]],
    PALETTE.shadow,
    'opacity="0.12"',
  );

  // --- edificio con muros completos
  for (const [a, z] of splitSpans(w, doorSpansForEdge(b, "s"))) face(ctx, [u0 + a, v1], [u0 + z, v1], wallH, colors.lit);
  for (const [a, z] of splitSpans(d, doorSpansForEdge(b, "e"))) face(ctx, [u1, v0 + a], [u1, v0 + z], wallH, colors.shade);
  // vigas de entramado / juntas en la cara sur
  if ((b.walls?.material ?? "timber") === "timber") {
    for (let uu = u0; uu <= u1; uu += Math.max(5, w / 4)) {
      quadUVH(ctx, [[uu, v1, wallH], [uu + 0.8, v1, wallH], [uu + 0.8, v1, 0], [uu, v1, 0]], "#503c26");
    }
    quadUVH(ctx, [[u0, v1, wallH], [u1, v1, wallH], [u1, v1, wallH - 0.9], [u0, v1, wallH - 0.9]], "#503c26");
  } else {
    jointLines(ctx, [u0, v1], [u1, v1], wallH, colors.joint, Math.max(2, Math.floor(w / 5)));
  }
  // puertas (hoja oscura + escalón) y ventanas auto en cara sur
  for (const dd of b.doors ?? []) {
    const dw = dd.w ?? 4;
    if (dd.edge === "s") {
      quadUVH(ctx, [[u0 + dd.at, v1, wallH * 0.8], [u0 + dd.at + dw, v1, wallH * 0.8], [u0 + dd.at + dw, v1, 0], [u0 + dd.at, v1, 0]], "#5c4326");
      quadUVH(ctx, [[u0 + dd.at - 0.5, v1, 0.4], [u0 + dd.at + dw + 0.5, v1, 0.4], [u0 + dd.at + dw + 0.5, v1 + 1.6, 0.4], [u0 + dd.at - 0.5, v1 + 1.6, 0.4]], PALETTE.cobbleDark);
    }
    if (dd.edge === "e") {
      quadUVH(ctx, [[u1, v0 + dd.at, wallH * 0.8], [u1, v0 + dd.at + dw, wallH * 0.8], [u1, v0 + dd.at + dw, 0], [u1, v0 + dd.at, 0]], "#4a3620");
    }
  }
  const doorSpansS = doorSpansForEdge(b, "s");
  const nWin = Math.max(1, Math.floor(w / 9));
  for (let i = 0; i < nWin; i++) {
    const wu = u0 + ((i + 0.5) * w) / nWin - 1.3;
    if (doorSpansS.some(([a, z]) => wu - u0 + 2.6 > a - 1 && wu - u0 < z + 1)) continue;
    quadUVH(ctx, [[wu, v1, wallH * 0.72], [wu + 2.6, v1, wallH * 0.72], [wu + 2.6, v1, wallH * 0.3], [wu, v1, wallH * 0.3]], "#2b2620");
    quadUVH(ctx, [[wu + 0.35, v1, wallH * 0.64], [wu + 2.25, v1, wallH * 0.64], [wu + 2.25, v1, wallH * 0.38], [wu + 0.35, v1, wallH * 0.38]], PALETTE.glow, 'opacity="0.85"');
  }

  // --- techo
  const roof = roofColors(b.roof?.material, b.roof?.color);
  const ov = 1.2; // vuelo del alero
  if (roofKind === "flat") {
    quadUVH(ctx, [[u0 - ov, v0 - ov, wallH], [u1 + ov, v0 - ov, wallH], [u1 + ov, v1 + ov, wallH], [u0 - ov, v1 + ov, wallH]], roof.lit);
    return;
  }
  const rise = wallH * 0.75;
  const axis = b.roof?.axis ?? (w >= d ? "x" : "y");
  const ridgeH = wallH + rise;
  if (roofKind === "shed") {
    quadUVH(ctx, [[u0 - ov, v0 - ov, ridgeH], [u1 + ov, v0 - ov, ridgeH], [u1 + ov, v1 + ov, wallH], [u0 - ov, v1 + ov, wallH]], roof.lit);
    ctx.out.push(line(ctx.proj.pt(u0 - ov, v1 + ov, wallH), ctx.proj.pt(u1 + ov, v1 + ov, wallH), roof.line, 0.5));
    return;
  }
  // gable (hip se aproxima a gable): dos planos + hastial de cámara
  if (axis === "x") {
    const rv = (v0 + v1) / 2;
    quadUVH(ctx, [[u0 - ov, rv, ridgeH], [u1 + ov, rv, ridgeH], [u1 + ov, v0 - ov, wallH], [u0 - ov, v0 - ov, wallH]], darkenRoof(roof.lit));
    quadUVH(ctx, [[u1, v0, wallH], [u1, v1, wallH], [u1, rv, ridgeH]], colors.shade); // hastial E (degenera en topdown)
    quadUVH(ctx, [[u0 - ov, rv, ridgeH], [u1 + ov, rv, ridgeH], [u1 + ov, v1 + ov, wallH], [u0 - ov, v1 + ov, wallH]], roof.shade);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const vv = rv + (v1 + ov - rv) * t;
      const hh = ridgeH + (wallH - ridgeH) * t;
      ctx.out.push(line(ctx.proj.pt(u0 - ov, vv, hh), ctx.proj.pt(u1 + ov, vv, hh), roof.line, 0.35));
    }
    ctx.out.push(line(ctx.proj.pt(u0 - ov, rv, ridgeH), ctx.proj.pt(u1 + ov, rv, ridgeH), roof.line, 0.6));
  } else {
    const ru = (u0 + u1) / 2;
    quadUVH(ctx, [[ru, v0 - ov, ridgeH], [ru, v1 + ov, ridgeH], [u0 - ov, v1 + ov, wallH], [u0 - ov, v0 - ov, wallH]], darkenRoof(roof.lit));
    quadUVH(ctx, [[u0, v1, wallH], [u1, v1, wallH], [ru, v1, ridgeH]], colors.lit); // hastial S
    quadUVH(ctx, [[ru, v0 - ov, ridgeH], [ru, v1 + ov, ridgeH], [u1 + ov, v1 + ov, wallH], [u1 + ov, v0 - ov, wallH]], roof.shade);
    ctx.out.push(line(ctx.proj.pt(ru, v0 - ov, ridgeH), ctx.proj.pt(ru, v1 + ov, ridgeH), roof.line, 0.6));
  }
}

function darkenRoof(hex: string): string {
  // plano trasero del tejado ligeramente más claro (recibe cielo)
  return hex;
}

// ---------------------------------------------------------------- resto

export function renderFountain(ctx: RenderCtx, at: [number, number], r: number): void {
  groundEllipse(ctx, at[0], at[1], r + 3, "#5a7a36");
  groundEllipse(ctx, at[0], at[1], r + 1.6, PALETTE.cobble);
  shadow(ctx, at[0] + 0.4, at[1] + 0.8, r);
  const colors = wallColors("stone");
  cylinder(ctx, at[0], at[1], r, 1.4, { ...colors, top: "#979181" });
  groundEllipse(ctx, at[0], at[1], r * 0.78, "#7d7869", "", -1.4 * heightScale(ctx));
  groundEllipse(ctx, at[0], at[1], r * 0.72, PALETTE.water, "", -1.4 * heightScale(ctx));
  cylinder(ctx, at[0], at[1], r * 0.2, 3.4, { ...colors, top: "#a09a89" });
  const [cx, cy] = ctx.proj.pt(at[0], at[1], 3.4);
  ctx.out.push(circle(cx, cy - 0.9, 0.5, "#bfe0ea"));
  ctx.out.push(circle(cx - 0.8, cy - 0.3, 0.28, "#bfe0ea", 'opacity="0.8"'));
  ctx.out.push(circle(cx + 0.8, cy - 0.35, 0.28, "#bfe0ea", 'opacity="0.8"'));
}

function heightScale(ctx: RenderCtx): number {
  return ctx.proj.kind === "isometric" ? 0.375 : 1;
}

export function renderProp(ctx: RenderCtx, p: PropVolume): void {
  const h = p.h ?? 2;
  const color = p.color ?? "#7a5a34";
  const colors: FaceColors = { top: color, lit: darkenHexPct(color, 0.12), shade: darkenHexPct(color, 0.3), joint: darkenHexPct(color, 0.45) };
  if (p.rect) {
    renderBoxPrism(ctx, p.rect, h, colors, { roofless: true });
    return;
  }
  const [u, v] = p.at!;
  if (p.shape === "cylinder") {
    const r = 1.3;
    shadow(ctx, u + 0.3, v + 0.3, r + 0.4);
    cylinder(ctx, u, v, r, h, colors);
    const [cx, cy] = ctx.proj.pt(u, v, h);
    ctx.out.push(ellipse(cx, cy, ctx.proj.kind === "isometric" ? r * Math.SQRT2 * ISO_SX : r, ctx.proj.kind === "isometric" ? r * Math.SQRT2 * ISO_SY : r, "none", `stroke="${colors.joint}" stroke-width="0.25"`));
    return;
  }
  renderBoxPrism(ctx, [u - 1.4, v - 1.4, 2.8, 2.8], h, colors, { roofless: true });
}

function darkenHexPct(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - f));
  const g = Math.round(((n >> 8) & 255) * (1 - f));
  const b2 = Math.round((n & 255) * (1 - f));
  return `#${((r << 16) | (g << 8) | b2).toString(16).padStart(6, "0")}`;
}

/** Punto de contacto con el suelo más profundo (clave del orden del pintor)
 *  y huella en celdas [minU, minV, maxU, maxV] de un volumen. */
export function volumeFootprint(v: Volume): { depthPoint: [number, number]; cells: [number, number, number, number] } {
  switch (v.type) {
    case "building": {
      const [u0, v0, w, d] = v.rect;
      return { depthPoint: [u0 + w, v0 + d], cells: [u0, v0, u0 + w, v0 + d] };
    }
    case "prop": {
      if (v.rect) {
        const [u0, v0, w, d] = v.rect;
        return { depthPoint: [u0 + w, v0 + d], cells: [u0, v0, u0 + w, v0 + d] };
      }
      const [u, vv] = v.at!;
      return { depthPoint: [u + 1.4, vv + 1.4], cells: [u - 1.4, vv - 1.4, u + 1.4, vv + 1.4] };
    }
    case "wall": {
      let minU = Infinity;
      let minV = Infinity;
      let maxU = -Infinity;
      let maxV = -Infinity;
      for (const [u, vv] of v.points) {
        minU = Math.min(minU, u);
        minV = Math.min(minV, vv);
        maxU = Math.max(maxU, u);
        maxV = Math.max(maxV, vv);
      }
      const half = (v.width ?? 3) / 2;
      return { depthPoint: [maxU + half, maxV + half], cells: [minU - half, minV - half, maxU + half, maxV + half] };
    }
    case "tower": {
      const r = v.r ?? 6;
      return { depthPoint: [v.at[0] + r, v.at[1] + r], cells: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r] };
    }
    case "gate": {
      const w = v.w ?? 8;
      const along = w / 2 + 3;
      const dh = 2.2;
      const cells: [number, number, number, number] =
        v.orient === "x"
          ? [v.at[0] - along, v.at[1] - dh, v.at[0] + along, v.at[1] + dh]
          : [v.at[0] - dh, v.at[1] - along, v.at[0] + dh, v.at[1] + along];
      return { depthPoint: [cells[2], cells[3]], cells };
    }
    case "fountain": {
      const r = v.r ?? 5;
      return { depthPoint: [v.at[0] + r, v.at[1] + r], cells: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r] };
    }
    default: {
      const s = ("s" in v ? v.s : 1) ?? 1;
      const r = v.type === "rock" ? 2.1 * s : 1.2 * s;
      return { depthPoint: [v.at[0], v.at[1]], cells: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r] };
    }
  }
}

/** Dispatch del renderer por tipo. `phase` solo aplica a edificios cutaway
 *  (dos pasadas en profundidades distintas). */
export function renderVolume(ctx: RenderCtx, v: Volume, phase: BuildingPhase = "base"): void {
  switch (v.type) {
    case "tree":
      renderTree(ctx, v);
      break;
    case "bush":
      renderBush(ctx, v.at, v.s ?? 1);
      break;
    case "rock":
      renderRock(ctx, v.at, v.s ?? 1);
      break;
    case "building":
      renderBuilding(ctx, v, phase);
      break;
    case "wall":
      renderWall(ctx, v);
      break;
    case "tower":
      renderTower(ctx, v);
      break;
    case "gate":
      renderGate(ctx, v);
      break;
    case "fountain":
      renderFountain(ctx, v.at, v.r ?? 5);
      break;
    case "prop":
      renderProp(ctx, v);
      break;
  }
}
