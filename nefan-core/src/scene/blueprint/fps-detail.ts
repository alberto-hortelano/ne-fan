/** Detalle de la vista FPS — post-proceso fps-ONLY del greybox del tile.
 *
 *  A ras de suelo las primitivas del builder compartido leen como cubos
 *  (playtest 2026-08-16): este módulo las enriquece SIN tocar el builder
 *  (su spec canónico es el layout_key del arte pagado de la vista oblicua;
 *  mismo criterio que el stagger de fps-spec). Todo determinista: SeededRng
 *  sembrado por `seedKey:volId`. Unidades: CELDAS (se ejecuta antes del
 *  escalado a metros de fps-spec).
 *
 *  Qué hace por kind:
 *  - tree: `species` conífera → cono (como hoy); frondosa/default → tronco +
 *    2-3 ESFERAS solapadas (lección v8 del plató: el cono lee como abeto).
 *  - bush: esferas achatadas en vez de cono.
 *  - rock: 2-3 esferas facetadas (pocos segmentos) hundidas y escaladas no
 *    uniformes + mat `rock_stone` (antes: cono con textura de tablones).
 *  - fountain: mat `stone_wall` en pilón/pilar (antes: duelas de barril).
 *  - tower: tejado cónico si no es almenada.
 *  - gate: arco escalonado (corbeles) bajo el dintel.
 *  - building: ventanas por planta en las fachadas (evitando puertas) +
 *    chimenea sembrada ~2/3 en tejados inclinados. */

import { seededRng, uniform, type SeededRng } from "../../rng.js";
import { darken, roofColors } from "./palette.js";
import type { Volume } from "./volumes.js";
import type { SurfacePrim } from "../greybox/surfaces.js";

/** Especies que se quedan con la copa cónica clásica. */
const CONIFER_RE = /pin|abet|con[ií]fer|cipr|fir|spruce|cedro|cedar|tejo|yew/i;

const WINDOW_COLOR = "#232b33";
const WINDOW_MAT = { side: "window_glass", top: false as const, bottom: false as const };

interface Ctx {
  rng: SeededRng;
  vol: Volume;
}

function sphere(
  r: number,
  seg: number,
  pos: [number, number, number],
  color: string,
  base: Pick<SurfacePrim, "cat" | "volId">,
  extra: Partial<SurfacePrim> = {},
): SurfacePrim {
  return { shape: "sphere", size: [r, seg], pos, color, cat: base.cat, volId: base.volId, ...extra };
}

/** Copa de frondosa: 2-3 esferas solapadas con jitter — sustituye al cono. */
function deciduousCanopy(p: SurfacePrim, ctx: Ctx): SurfacePrim[] {
  const s = p.size[0] / 3.2; // el builder emite cone [3.2s, 5.2s, 10]
  const baseY = p.pos[1];
  const rng = ctx.rng;
  const out: SurfacePrim[] = [
    sphere(2.3 * s, 12, [p.pos[0], baseY - 0.4 * s, p.pos[2]], p.color, p, {
      scale: [1, uniform(rng, 0.8, 0.95), 1],
    }),
  ];
  const n = 1 + (rng.next() < 0.65 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = uniform(rng, 0, Math.PI * 2);
    const off = uniform(rng, 1.0, 1.6) * s;
    out.push(
      sphere(
        uniform(rng, 1.2, 1.7) * s,
        10,
        [p.pos[0] + Math.cos(a) * off, baseY + uniform(rng, 0.2, 1.2) * s, p.pos[2] + Math.sin(a) * off],
        p.color,
        p,
        { scale: [1, uniform(rng, 0.75, 0.9), 1] },
      ),
    );
  }
  return out;
}

/** Color de madera curada de las cercas (clay; la imagen lo viste después). */
const FENCE_WOOD = "#6a5038";

/** Valla de estacas a partir del slab de un tramo de wall bajo: postes
 *  cilíndricos cada ~2.5 celdas y dos travesaños. Conserva pos/rotY del
 *  tramo (la colisión no cambia — sigue siendo la del trazo declarado). */
function fencePrims(p: SurfacePrim): SurfacePrim[] {
  const [len, h] = p.size;
  const rotY = p.rotY ?? 0;
  const dirX = Math.cos(rotY);
  const dirZ = -Math.sin(rotY);
  const base = { cat: p.cat, volId: p.volId };
  const out: SurfacePrim[] = [];
  const nPosts = Math.max(2, Math.round(len / 2.5) + 1);
  for (let i = 0; i < nPosts; i++) {
    const t = -len / 2 + (len * i) / (nPosts - 1);
    out.push({
      shape: "cylinder",
      size: [0.14, h],
      pos: [p.pos[0] + dirX * t, 0, p.pos[2] + dirZ * t],
      color: FENCE_WOOD,
      mat: "wood_beam",
      ...base,
    });
  }
  for (const railY of [h * 0.45, h - 0.25]) {
    out.push({
      shape: "box",
      size: [len, 0.16, 0.1],
      pos: [p.pos[0], railY, p.pos[2]],
      rotY: p.rotY,
      color: FENCE_WOOD,
      mat: "wood_beam",
      ...base,
    });
  }
  return out;
}

function bushSpheres(p: SurfacePrim, ctx: Ctx): SurfacePrim[] {
  const s = p.size[0] / 1.3; // el builder emite cone [1.3s, 1.9s, 8]
  const rng = ctx.rng;
  const out: SurfacePrim[] = [
    sphere(1.15 * s, 9, [p.pos[0], p.pos[1] - 0.15 * s, p.pos[2]], p.color, p, {
      scale: [1, uniform(rng, 0.55, 0.7), 1],
      rotY: uniform(rng, 0, Math.PI * 2),
    }),
  ];
  if (rng.next() < 0.6) {
    const a = uniform(rng, 0, Math.PI * 2);
    out.push(
      sphere(0.75 * s, 8, [p.pos[0] + Math.cos(a) * 0.8 * s, p.pos[1] - 0.1 * s, p.pos[2] + Math.sin(a) * 0.8 * s], p.color, p, {
        scale: [1, uniform(rng, 0.55, 0.7), 1],
      }),
    );
  }
  return out;
}

function rockSpheres(p: SurfacePrim, ctx: Ctx): SurfacePrim[] {
  const s = p.size[0] / 2.1; // el builder emite cone [2.1s, 1.6s, 5]
  const rng = ctx.rng;
  const n = 2 + (rng.next() < 0.5 ? 1 : 0);
  const out: SurfacePrim[] = [];
  for (let i = 0; i < n; i++) {
    const main = i === 0;
    const r = (main ? uniform(rng, 1.2, 1.5) : uniform(rng, 0.6, 1.0)) * s;
    const a = uniform(rng, 0, Math.PI * 2);
    const off = main ? 0 : uniform(rng, 0.7, 1.2) * s;
    out.push(
      sphere(
        r,
        6,
        [p.pos[0] + Math.cos(a) * off, p.pos[1] - r * uniform(rng, 0.35, 0.55), p.pos[2] + Math.sin(a) * off],
        p.color,
        p,
        {
          scale: [uniform(rng, 1.1, 1.4), uniform(rng, 0.5, 0.7), uniform(rng, 0.85, 1.1)],
          rotY: uniform(rng, 0, Math.PI * 2),
          mat: "rock_stone",
        },
      ),
    );
  }
  return out;
}

/** Ventanas de un building: cajitas finas sobre cada fachada, evitando los
 *  vanos de las puertas. Frame LOCAL (pre-angle) rotado como en el builder. */
function buildingWindows(v: Extract<Volume, { type: "building" }>, rng: SeededRng): SurfacePrim[] {
  const [u0, v0, w, d] = v.rect;
  const wallH = v.wall_h ?? 5;
  if (wallH < 3.6) return [];
  const cx = u0 + w / 2;
  const cz = v0 + d / 2;
  const angleRad = ((v.angle ?? 0) * Math.PI) / 180;
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const rotOff = (dx: number, dz: number): [number, number] =>
    v.angle ? [dx * ca + dz * sa, -dx * sa + dz * ca] : [dx, dz];
  const sills: number[] = [Math.max(1.7, wallH * 0.42)];
  if (wallH >= 9) sills.push(sills[0] + 3.6);
  const winW = 1.4;
  const winH = 1.6;
  const out: SurfacePrim[] = [];
  for (const edge of ["n", "s", "e", "w"] as const) {
    const alongX = edge === "n" || edge === "s";
    const len = alongX ? w : d;
    if (len < 4.5) continue;
    const count = Math.min(3, Math.max(1, Math.floor(len / 5)));
    const doorSpans = (v.doors ?? [])
      .filter((dr) => dr.edge === edge)
      .map((dr) => [dr.at - 1.2, dr.at + (dr.w ?? 3) + 1.2] as [number, number]);
    for (let i = 0; i < count; i++) {
      const t = ((i + 1) / (count + 1)) * len + uniform(rng, -0.5, 0.5);
      if (t < winW || t > len - winW) continue;
      if (doorSpans.some(([a, b]) => t > a && t < b)) continue;
      for (const sill of sills) {
        if (sill + winH > wallH - 0.4) continue;
        // Centro del hueco medio dentro del muro: sobresale ~0.1 celdas.
        const faceOff = (alongX ? d : w) / 2 + 0.03;
        const [ldx, ldz] = alongX
          ? [u0 + t - cx, edge === "s" ? faceOff : -faceOff]
          : [edge === "e" ? faceOff : -faceOff, v0 + t - cz];
        const [rdx, rdz] = rotOff(ldx, ldz);
        out.push({
          shape: "box",
          size: alongX ? [winW, winH, 0.26] : [0.26, winH, winW],
          pos: [cx + rdx, sill, cz + rdz],
          rotY: angleRad || undefined,
          color: WINDOW_COLOR,
          cat: "building",
          volId: `vol_${v.id}`,
          mat: WINDOW_MAT,
          noShadow: true,
        });
      }
    }
  }
  return out;
}

/** Chimenea sembrada (~2/3 de los edificios con tejado inclinado). */
function buildingChimney(v: Extract<Volume, { type: "building" }>, rng: SeededRng): SurfacePrim[] {
  const roofKind = v.roof?.kind ?? "gable";
  if (roofKind === "flat" || roofKind === "none") return [];
  if (rng.next() > 0.67) return [];
  const [u0, v0, w, d] = v.rect;
  const wallH = v.wall_h ?? 5;
  const rise = Math.min(w, d) * 0.45;
  const cx = u0 + w / 2;
  const cz = v0 + d / 2;
  const angleRad = ((v.angle ?? 0) * Math.PI) / 180;
  const axis = v.roof?.axis ?? (w >= d ? "x" : "y");
  // Sobre el caballete, desplazada a un lado a lo largo de la cumbrera.
  const along = uniform(rng, -0.28, 0.28) * (axis === "x" ? w : d);
  const [ldx, ldz] = axis === "x" ? [along, 0] : [0, along];
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const [rdx, rdz] = v.angle ? [ldx * ca + ldz * sa, -ldx * sa + ldz * ca] : [ldx, ldz];
  return [
    {
      shape: "box",
      size: [1.1, 2.6, 1.1],
      pos: [cx + rdx, wallH + rise * 0.45, cz + rdz],
      rotY: angleRad || undefined,
      color: darken("#9a948a", 0.1),
      cat: "building",
      volId: `vol_${v.id}`,
      mat: "wall_stone",
    },
  ];
}

function towerRoof(v: Extract<Volume, { type: "tower" }>): SurfacePrim[] {
  if (v.crenellated) return [];
  const r = v.r ?? 6;
  const h = v.h ?? 12;
  const rc = roofColors();
  return [
    {
      shape: "cone",
      size: [r * 1.22, r * 1.1, 12],
      pos: [v.at[0], h + 0.5, v.at[1]],
      color: rc.lit,
      cat: "wall",
      volId: `vol_${v.id}`,
      mat: "roof_tile",
    },
  ];
}

/** Corbeles escalonados bajo el dintel del gate: el vano lee como arco. */
function gateCorbels(v: Extract<Volume, { type: "gate" }>): SurfacePrim[] {
  const w = v.w ?? 8;
  const h = v.h ?? 8;
  const [gx, gz] = v.at;
  const alongX = v.orient === "x";
  const out: SurfacePrim[] = [];
  for (const side of [-1, 1]) {
    for (let k = 1; k <= 2; k++) {
      const inW = 0.65 * k;
      const off = side * (w / 2 - inW / 2);
      const y = h - 0.9 - 0.75 * k;
      out.push({
        shape: "box",
        size: alongX ? [inW, 0.75, 4.6] : [4.6, 0.75, inW],
        pos: alongX ? [gx + off, y, gz] : [gx, y, gz + off],
        color: darken("#9a948a", 0.16),
        cat: "wall",
        volId: `vol_${v.id}`,
      });
    }
  }
  return out;
}

/** Enriquecimiento fps del greybox del tile. Entrada y salida en CELDAS;
 *  no muta la lista original. */
export function enrichFpsPrims(
  prims: SurfacePrim[],
  volumes: Volume[],
  seedKey: string,
): SurfacePrim[] {
  const byVolId = new Map<string, Volume>();
  for (const v of volumes) byVolId.set(`vol_${v.id}`, v);
  const rngFor = (volId: string) => seededRng(`${seedKey}:${volId}`);
  // Talla global por ÁRBOL (0.85..1.2): rompe los clones de la misma especie
  // declarados con el mismo tamaño. Mismo factor para tronco y copa.
  const sizeF = (volId: string) => 0.85 + seededRng(`${seedKey}:${volId}:size`).next() * 0.35;

  const out: SurfacePrim[] = [];
  for (const p of prims) {
    const vol = p.volId ? byVolId.get(p.volId) : undefined;
    if (!vol) {
      out.push(p);
      continue;
    }
    if (vol.type === "tree" && p.shape === "cylinder") {
      const f = sizeF(p.volId!);
      const size = [...p.size];
      size[0] *= Math.sqrt(f); // radio del tronco, más suave que la altura
      if (size.length > 1) size[1] *= f;
      if (size.length > 2) size[2] *= Math.sqrt(f);
      out.push({ ...p, size });
      continue;
    }
    if (vol.type === "tree" && p.shape === "cone") {
      const f = sizeF(p.volId!);
      const q: SurfacePrim = {
        ...p,
        size: p.size.map((s, i) => (i < 2 ? s * f : s)),
        pos: [p.pos[0], p.pos[1] * f, p.pos[2]],
      };
      if (vol.species && CONIFER_RE.test(vol.species)) out.push(q);
      else out.push(...deciduousCanopy(q, { rng: rngFor(p.volId!), vol }));
      continue;
    }
    if (
      vol.type === "wall" &&
      p.shape === "box" &&
      (vol.h ?? 5) <= 2.4 &&
      p.pos[1] === 0 &&
      !/piedr|stone|tapia|adobe/i.test(vol.label ?? "")
    ) {
      // Muro BAJO = valla/cerca: el slab macizo jamás leerá como estacas.
      // Postes + dos travesaños de madera, mismo tramo/rotY/colisión.
      out.push(...fencePrims(p));
      continue;
    }
    if (vol.type === "bush" && p.shape === "cone") {
      out.push(...bushSpheres(p, { rng: rngFor(p.volId!), vol }));
      continue;
    }
    if (vol.type === "rock" && p.shape === "cone") {
      out.push(...rockSpheres(p, { rng: rngFor(p.volId!), vol }));
      continue;
    }
    if (vol.type === "fountain" && p.shape === "cylinder" && p.cat === "prop") {
      out.push({ ...p, mat: "stone_wall" });
      continue;
    }
    out.push(p);
  }

  // Añadidos por volumen (una sola vez por volumen, no por prim).
  for (const v of volumes) {
    if (v.type === "building") {
      const rng = rngFor(`vol_${v.id}:detail`);
      out.push(...buildingWindows(v, rng), ...buildingChimney(v, rng));
    } else if (v.type === "tower") {
      out.push(...towerRoof(v));
    } else if (v.type === "gate") {
      out.push(...gateCorbels(v));
    }
  }
  return out;
}
