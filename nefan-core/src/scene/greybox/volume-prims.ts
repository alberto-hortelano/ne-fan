/** Primitivas greybox 3D de los volúmenes de un TILE — lógica pura.
 *
 *  Porta el intérprete de volúmenes de labs/render/exp2_three/plan_to_scene.mjs
 *  (E2a: fidelidad 100/100 del bench) al vocabulario `GreyboxPrimitive`.
 *  Unidades: CELDAS del tile (posiciones y alturas; 1 celda = 0.5 m).
 *  pos = [u, hBase, v] con y = BASE de la pieza (contrato de greybox/common).
 *
 *  Los volúmenes se emiten TROCEADOS (cutaway por muros, muros largos a ~14
 *  celdas, árbol en tronco + copa): el troceado se conserva porque da vanos
 *  limpios en los gates y masas manejables, pero los tramos ya no son
 *  «partes» con metadatos — la función devuelve las prims en orden. */

import { PALETTE, wallColors, roofColors, darken, lighten } from "../blueprint/palette.js";
import { volumeFootprint } from "../blueprint/footprint.js";
import type {
  BuildingVolume,
  CustomPart,
  CustomVolume,
  GateVolume,
  PropVolume,
  Volume,
  WallVolume,
} from "../blueprint/volumes.js";
import type { GreyboxPrimitive } from "./common.js";

/** size de prim de una pieza custom (contrato de GreyboxPrimitive.size). */
export function customPartSize(p: CustomPart): { shape: GreyboxPrimitive["shape"]; size: number[] } {
  switch (p.shape) {
    case "box":
    case "gable":
      return { shape: p.shape, size: [...p.size!] };
    case "cylinder":
      return { shape: "cylinder", size: p.rTop !== undefined ? [p.rBottom!, p.h!, p.rTop] : [p.rBottom!, p.h!] };
    case "cone":
      return { shape: "cone", size: [p.r!, p.h!, p.seg ?? 12] };
    case "sphere":
      return { shape: "sphere", size: p.seg !== undefined ? [p.r!, p.seg] : [p.r!] };
  }
}

/** Matriz M = R·S de una pieza (R = Rx·Ry·Rz, el orden del renderer:
 *  v' = Rx(Ry(Rz(v))); S = diag(scale)). */
function partMatrix(p: CustomPart, totalRotY: number): number[][] {
  const [sxc, syc, szc] = p.scale ?? [1, 1, 1];
  const cx = Math.cos(p.rotX ?? 0), sx = Math.sin(p.rotX ?? 0);
  const cy = Math.cos(totalRotY), sy = Math.sin(totalRotY);
  const cz = Math.cos(p.rotZ ?? 0), sz = Math.sin(p.rotZ ?? 0);
  // Ry·Rz
  const a = [
    [cy * cz, -cy * sz, sy],
    [sz, cz, 0],
    [-sy * cz, sy * sz, cy],
  ];
  // R = Rx·(Ry·Rz)
  const r = [
    a[0],
    [cx * a[1][0] - sx * a[2][0], cx * a[1][1] - sx * a[2][1], cx * a[1][2] - sx * a[2][2]],
    [sx * a[1][0] + cx * a[2][0], sx * a[1][1] + cx * a[2][1], sx * a[1][2] + cx * a[2][2]],
  ];
  return r.map((row) => [row[0] * sxc, row[1] * syc, row[2] * szc]);
}

/** AABB EXACTO de una pieza tras scale y rotación, relativo a su origen (la
 *  base sin rotar). Cilindro/cono = casco de sus dos círculos transformados
 *  (invariante bajo yaw — una rueda no engorda al girar el conjunto); esfera
 *  = elipsoide; box/gable = esquinas. `totalRotY` = angle del conjunto +
 *  rotY de la pieza. */
export function customPartAabb(
  p: CustomPart,
  totalRotY: number,
): { min: [number, number, number]; max: [number, number, number] } {
  const m = partMatrix(p, totalRotY);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const take = (lo: number, hi: number, i: number) => {
    min[i] = Math.min(min[i], lo);
    max[i] = Math.max(max[i], hi);
  };
  // Círculo horizontal local (centro (0,yc,0), radio r en el plano xz).
  const circle = (yc: number, r: number) => {
    for (let i = 0; i < 3; i++) {
      const c = m[i][1] * yc;
      const e = r * Math.hypot(m[i][0], m[i][2]);
      take(c - e, c + e, i);
    }
  };
  switch (p.shape) {
    case "box":
    case "gable": {
      const [w, h, d] = p.size!;
      for (const lx of [-w / 2, w / 2])
        for (const ly of [0, h])
          for (const lz of [-d / 2, d / 2])
            for (let i = 0; i < 3; i++) {
              const v = m[i][0] * lx + m[i][1] * ly + m[i][2] * lz;
              take(v, v, i);
            }
      break;
    }
    case "cylinder":
      circle(0, p.rBottom!);
      circle(p.h!, p.rTop ?? p.rBottom!);
      break;
    case "cone":
      circle(0, p.r!);
      circle(p.h!, 0);
      break;
    case "sphere":
      for (let i = 0; i < 3; i++) {
        const c = m[i][1] * p.r!;
        const e = p.r! * Math.hypot(m[i][0], m[i][1], m[i][2]);
        take(c - e, c + e, i);
      }
      break;
  }
  return { min, max };
}

/** Cota superior (celdas) de una pieza custom — la usa volume-metrics para
 *  la altura del volumen. Rotación y scale incluidos (una rueda rotX aporta
 *  2r, no h). */
export function customPartTop(p: CustomPart): number {
  const { min, max } = customPartAabb(p, p.rotY ?? 0);
  return (p.pos?.[1] ?? 0) + (max[1] - min[1]);
}

/** Prims de un volumen custom: UNA por pieza y EN EL ORDEN declarado —
 *  contrato con fps-spec (el hero por pieza casa prims↔parts por índice). */
export function customVolumePrims(v: CustomVolume): GreyboxPrimitive[] {
  const angleRad = ((v.angle ?? 0) * Math.PI) / 180;
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  return v.parts.map((p) => {
    const [ox, oy, oz] = p.pos ?? [0, 0, 0];
    const [rx, rz] = v.angle ? [ox * ca + oz * sa, -ox * sa + oz * ca] : [ox, oz];
    const { shape, size } = customPartSize(p);
    // Contrato: pos.y de la PIEZA es la base de su AABB DESPUÉS de rotar y
    // escalar ("apoyar en el suelo" = y:0 siempre, ruedas incluidas). El
    // renderer pivota en el origen local, así que se compensa aquí.
    const lift = -customPartAabb(p, angleRad + (p.rotY ?? 0)).min[1];
    const prim: GreyboxPrimitive = {
      shape,
      size,
      pos: [v.at[0] + rx, oy + lift, v.at[1] + rz],
      color: p.color ?? "#9a938a",
      cat: "prop",
      volId: `vol_${v.id}`,
    };
    const rotY = angleRad + (p.rotY ?? 0);
    if (rotY) prim.rotY = rotY;
    if (p.rotX) prim.rotX = p.rotX;
    if (p.rotZ) prim.rotZ = p.rotZ;
    if (p.scale) prim.scale = [...p.scale];
    return prim;
  });
}

/** Divide el intervalo [a,b] quitando los huecos `gaps` = [[g0,g1],...]. */
function carve(a: number, b: number, gaps: Array<[number, number]>): Array<[number, number]> {
  let spans: Array<[number, number]> = [[a, b]];
  for (const [g0, g1] of gaps) {
    const next: Array<[number, number]> = [];
    for (const [s0, s1] of spans) {
      if (g1 <= s0 || g0 >= s1) {
        next.push([s0, s1]);
        continue;
      }
      if (g0 > s0) next.push([s0, g0]);
      if (g1 < s1) next.push([g1, s1]);
    }
    spans = next;
  }
  return spans.filter(([s0, s1]) => s1 - s0 > 0.3);
}

const wall = (mat?: string, color?: string) => wallColors(mat as never, color);

const box = (
  w: number,
  h: number,
  d: number,
  cx: number,
  yBase: number,
  cz: number,
  color: string,
  cat: GreyboxPrimitive["cat"],
  extra: Partial<GreyboxPrimitive> = {},
): GreyboxPrimitive => ({ shape: "box", size: [w, h, d], pos: [cx, yBase, cz], color, cat, ...extra });

/** Edificio: cutaway (suelo + muros altos N/O + bajos S/E, con los vanos
 *  de sus `doors` tallados) o cuerpo cerrado con tejado y puertas pintadas. */
function buildingPrims(v: BuildingVolume): GreyboxPrimitive[] {
    const [u0, v0, w, d] = v.rect;
    const wallH = v.wall_h ?? 5;
    const wc = wall(v.walls?.material, v.walls?.color);
    const cx = u0 + w / 2;
    const cz = v0 + d / 2;
    if (v.cutaway) {
      // Muros traseros (N y O) altos; frontales (S y E) bajos; suelo de
      // madera. Cada muro talla los huecos de sus `doors`.
      const t = 1.2;
      const lowH = 1.6;
      const doorGaps = (edge: "n" | "s" | "e" | "w", base: number): Array<[number, number]> =>
        (v.doors ?? [])
          .filter((dr) => dr.edge === edge)
          .map((dr) => [base + dr.at, base + dr.at + (dr.w ?? 4)] as [number, number]);
      const strips = (
        edge: "n" | "s" | "e" | "w",
        isX: boolean,
        at: number,
        lo: number,
        hi: number,
        hgt: number,
        tone: string,
      ): GreyboxPrimitive[] =>
        carve(lo, hi, doorGaps(edge, isX ? u0 : v0)).map(([s0, s1]) =>
          isX
            ? box(s1 - s0, hgt, t, (s0 + s1) / 2, 0, at, tone, "building", { volId: `vol_${v.id}` })
            : box(t, hgt, s1 - s0, at, 0, (s0 + s1) / 2, tone, "building", { volId: `vol_${v.id}` }),
        );
      const shade = darken(wc.lit, 0.14);
      const floorPrim = box(w, 0.1, d, cx, 0.02, cz, darken(PALETTE.woodTop, 0.05), "building", {
        volId: `vol_${v.id}`,
        noShadow: true,
      });
      // Orden de pintado: suelo, muros altos (N, O), muros bajos (S, E).
      return [
        floorPrim,
        ...strips("n", true, v0 + t / 2, u0, u0 + w, wallH, wc.lit),
        ...strips("w", false, u0 + t / 2, v0, v0 + d, wallH, shade),
        ...strips("s", true, v0 + d - t / 2, u0, u0 + w, lowH, wc.lit),
        ...strips("e", false, u0 + w - t / 2, v0, v0 + d, lowH, shade),
      ];
    }
    // Edificio con techo: cuerpo + tejado + puertas pintadas. Con `angle`
    // todo se emite en marco LOCAL rotado alrededor del centro (rotY); la
    // huella declarada la calcula aparte volumeFootprint sobre el AABB
    // rotado.
    const angleRad = ((v.angle ?? 0) * Math.PI) / 180;
    const caA = Math.cos(angleRad);
    const saA = Math.sin(angleRad);
    const rotOff = (dx: number, dz: number): [number, number] =>
      v.angle ? [dx * caA + dz * saA, -dx * saA + dz * caA] : [dx, dz];
    const rotYOr = (extra = 0): number | undefined =>
      angleRad + extra === 0 ? undefined : angleRad + extra;
    const prims: GreyboxPrimitive[] = [
      box(w, wallH, d, cx, 0, cz, wc.lit, "building", { volId: `vol_${v.id}`, rotY: rotYOr() }),
    ];
    const roofKind = v.roof?.kind ?? "gable";
    const rc = roofColors(v.roof?.material, v.roof?.color);
    if (roofKind === "flat") {
      prims.push(
        box(w + 0.8, 0.4, d + 0.8, cx, wallH, cz, rc.lit, "building", {
          volId: `vol_${v.id}`,
          rotY: rotYOr(),
        }),
      );
    } else if (roofKind !== "none") {
      const axis = v.roof?.axis ?? (w >= d ? "x" : "y");
      const rise = Math.min(w, d) * 0.45;
      prims.push({
        shape: "gable",
        // gable: cumbrera a lo largo de d ANTES de rotY (contrato common).
        size: axis === "x" ? [d + 1.2, rise, w + 1.2] : [w + 1.2, rise, d + 1.2],
        pos: [cx, wallH, cz],
        rotY: angleRad + (axis === "x" ? Math.PI / 2 : 0),
        color: rc.lit,
        cat: "building",
        volId: `vol_${v.id}`,
      });
    }
    for (const door of v.doors ?? []) {
      const dw = door.w ?? 3;
      const alongX = door.edge === "n" || door.edge === "s";
      const at = door.at ?? 0;
      // Offset LOCAL de la puerta respecto al centro; rotado si hay angle.
      const [ldx, ldz] =
        door.edge === "s" ? [u0 + at + dw / 2 - cx, d / 2]
        : door.edge === "n" ? [u0 + at + dw / 2 - cx, -d / 2]
        : door.edge === "e" ? [w / 2, v0 + at + dw / 2 - cz]
        : [-w / 2, v0 + at + dw / 2 - cz];
      const [rdx, rdz] = rotOff(ldx, ldz);
      prims.push({
        shape: "box",
        size: alongX ? [dw, 3, 0.3] : [0.3, 3, dw],
        pos: [cx + rdx, 0, cz + rdz],
        rotY: rotYOr(),
        color: "#2a2018",
        cat: "building",
        volId: `vol_${v.id}`,
      });
    }
    return prims;
}

/** Muro poligonal troceado a ~14 celdas, con los vanos de los `gates` que
 *  lo cruzan tallados (el visual debe casar con clearGatePassage). */
function wallPrims(v: WallVolume, gates: GateVolume[]): GreyboxPrimitive[] {
    const width = v.width ?? 3;
    const h = v.h ?? 5;
    const wc = wall("stone");
    const out: GreyboxPrimitive[] = [];
    const pts = v.points as [number, number][];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const dirU = (x2 - x1) / (len || 1);
      const dirV = (z2 - z1) / (len || 1);
      // Vanos de los gates que caen sobre este segmento.
      const gateGaps: Array<[number, number]> = [];
      for (const g of gates) {
        const t = (g.at[0] - x1) * dirU + (g.at[1] - z1) * dirV;
        if (t < -2 || t > len + 2) continue;
        const px = x1 + dirU * t;
        const pz = z1 + dirV * t;
        if (Math.hypot(g.at[0] - px, g.at[1] - pz) > width / 2 + 2) continue;
        const gw = g.w ?? 8;
        gateGaps.push([t - gw / 2, t + gw / 2]);
      }
      // Tramos de ~14 celdas. Los extremos ganan media anchura de tapa
      // (continuidad entre tramos) pero CLAMPADA al span tallado — el vano
      // de un gate queda limpio.
      const chunks: Array<[number, number]> = [];
      for (const [s0, s1] of carve(0, len, gateGaps)) {
        const n = Math.max(1, Math.ceil((s1 - s0) / 14));
        for (let c = 0; c < n; c++) {
          const t0 = s0 + ((s1 - s0) * c) / n;
          const t1 = s0 + ((s1 - s0) * (c + 1)) / n;
          chunks.push([Math.max(s0, t0 - width / 2), Math.min(s1, t1 + width / 2)]);
        }
      }
      for (const [t0, t1] of chunks) {
        const ax = x1 + dirU * t0;
        const az = z1 + dirV * t0;
        const bx = x1 + dirU * t1;
        const bz = z1 + dirV * t1;
        const clen = t1 - t0;
        const prims: GreyboxPrimitive[] = [
          {
            shape: "box",
            size: [clen, h, width],
            pos: [(ax + bx) / 2, 0, (az + bz) / 2],
            rotY: -Math.atan2(bz - az, bx - ax),
            color: wc.lit,
            cat: "wall",
            volId: `vol_${v.id}`,
          },
        ];
        if (v.crenellated) {
          for (let o = width / 2; o < clen; o += 2.4) {
            const f = o / clen;
            prims.push(
              box(1, 1, width + 0.4, ax + (bx - ax) * f, h, az + (bz - az) * f, PALETTE.merlon, "wall", {
                volId: `vol_${v.id}`,
              }),
            );
          }
        }
        out.push(...prims);
      }
    }
    return out;
}

/** Gatehouse: jambas + dintel que cruza el muro anfitrión + almenas. El
 *  vano queda libre — lo talla el muro. */
function gatePrims(v: GateVolume): GreyboxPrimitive[] {
    // Gatehouse: jambas robustas + dintel de madera oscura que cruza el
    // muro anfitrión + almenas. El vano queda libre (el muro lo talla).
    const w = v.w ?? 8;
    const h = v.h ?? 8;
    // Jamba de 3 celdas: el borde exterior queda EXACTAMENTE en w/2 + 3 —
    // la huella declarada de volumeFootprint (el bbox proyectado la cubre).
    const jambW = 3;
    const [gx, gz] = v.at;
    const wc = wall("stone");
    const alongX = v.orient === "x"; // el muro corre a lo largo de col
    const jamb = (off: number): GreyboxPrimitive =>
      alongX
        ? box(jambW, h, 5, gx + off, 0, gz, wc.lit, "wall", { volId: `vol_${v.id}` })
        : box(5, h, jambW, gx, 0, gz + off, wc.lit, "wall", { volId: `vol_${v.id}` });
    const prims: GreyboxPrimitive[] = [
      jamb(-(w / 2 + jambW / 2)),
      jamb(w / 2 + jambW / 2),
      alongX
        ? box(w + 2 * jambW, 1.8, 6.5, gx, h - 0.9, gz, "#6b4a2c", "wall", { volId: `vol_${v.id}` })
        : box(6.5, 1.8, w + 2 * jambW, gx, h - 0.9, gz, "#6b4a2c", "wall", { volId: `vol_${v.id}` }),
    ];
    for (const off of [-(w / 2 + jambW / 2), w / 2 + jambW / 2]) {
      for (const oo of [-1.8, 0, 1.8]) {
        prims.push(
          alongX
            ? box(1.1, 1.1, 1.1, gx + off, h + 0.55, gz + oo, PALETTE.merlon, "wall", { volId: `vol_${v.id}` })
            : box(1.1, 1.1, 1.1, gx + oo, h + 0.55, gz + off, PALETTE.merlon, "wall", { volId: `vol_${v.id}` }),
        );
      }
    }
    return prims;
}

/** Prop: un bloque o cilindro suelto, centrado en su AABB (rotado si trae
 *  `angle`). */
function propPrims(v: PropVolume): GreyboxPrimitive[] {
    const h = v.h ?? 2;
    const color = v.color ?? PALETTE.woodTop;
    // Con `angle` (solo rect): geometría con las dimensiones REALES del
    // rect + rotY, centrada en el AABB rotado (volumeFootprint).
    const fp: [number, number, number, number] = volumeFootprint(v).cells;
    const cx = (fp[0] + fp[2]) / 2;
    const cz = (fp[1] + fp[3]) / 2;
    const w = v.rect && v.angle ? v.rect[2] : fp[2] - fp[0];
    const d = v.rect && v.angle ? v.rect[3] : fp[3] - fp[1];
    const propRotY = v.angle ? (v.angle * Math.PI) / 180 : undefined;
    const prims: GreyboxPrimitive[] =
      v.shape === "cylinder"
        ? [
            { shape: "cylinder", size: [Math.min(w, d) / 2, h], pos: [cx, 0, cz], color, cat: "prop", volId: `vol_${v.id}` },
            { shape: "cylinder", size: [Math.min(w, d) / 2, 0.06], pos: [cx, h, cz], color: lighten(color, 0.15), cat: "prop", volId: `vol_${v.id}`, noShadow: true },
          ]
        : [box(w, h, d, cx, 0, cz, color, "prop", { volId: `vol_${v.id}`, rotY: propRotY })];
    return prims;
}

/** Prims greybox de un volumen, en orden de pintado. `gates` talla los vanos
 *  en los muros que los cruzan (el visual debe coincidir con
 *  clearGatePassage de la colisión). */
export function volumePrimsForTile(v: Volume, gates: GateVolume[]): GreyboxPrimitive[] {
  switch (v.type) {
    case "building":
      return buildingPrims(v);

    case "wall":
      return wallPrims(v, gates);

    case "tower": {
      const r = v.r ?? 6;
      const h = v.h ?? 12;
      const wc = wall("stone");
      const prims: GreyboxPrimitive[] = [
        { shape: "cylinder", size: [r, h, r * 1.08], pos: [v.at[0], 0, v.at[1]], color: wc.lit, cat: "wall", volId: `vol_${v.id}` },
        { shape: "cylinder", size: [r * 1.04, 0.5], pos: [v.at[0], h, v.at[1]], color: wc.top, cat: "wall", volId: `vol_${v.id}` },
      ];
      if (v.crenellated) {
        for (let k = 0; k < 12; k++) {
          const a = (k * Math.PI) / 6;
          prims.push(
            box(1, 1, 1, v.at[0] + Math.cos(a) * (r - 0.5), h + 0.5, v.at[1] + Math.sin(a) * (r - 0.5), PALETTE.merlon, "wall", {
              volId: `vol_${v.id}`,
            }),
          );
        }
      }
      return prims;
    }
    case "gate":
      return gatePrims(v);

    case "tree": {
      const s = v.s ?? 1;
      const trunkH = 3.2 * s;
      const trunk: GreyboxPrimitive = {
        shape: "cylinder",
        size: [0.5 * s, trunkH, 0.4 * s],
        pos: [v.at[0], 0, v.at[1]],
        color: PALETTE.trunk,
        cat: "tree",
        volId: `vol_${v.id}`,
      };
      // Copa: masa cónica ancha (legible como copa en clay y desde arriba).
      const canopy: GreyboxPrimitive = {
        shape: "cone",
        size: [3.2 * s, 5.2 * s, 10],
        pos: [v.at[0], trunkH * 0.75, v.at[1]],
        color: PALETTE.canopy,
        cat: "tree",
        volId: `vol_${v.id}`,
      };
      return [trunk, canopy];
    }
    case "bush": {
      const s = v.s ?? 1;
      return [
        { shape: "cone", size: [1.3 * s, 1.9 * s, 8], pos: [v.at[0], 0, v.at[1]], color: PALETTE.canopy, cat: "tree", volId: `vol_${v.id}` },
      ];
    }
    case "rock": {
      const s = v.s ?? 1;
      // Radio 2.1·s: el MISMO de su huella declarada (volumeFootprint y
      // markDisc de la colisión) — visual y colisión coinciden.
      return [
        { shape: "cone", size: [2.1 * s, 1.6 * s, 5], pos: [v.at[0], 0, v.at[1]], color: PALETTE.stoneTop, cat: "prop", volId: `vol_${v.id}` },
      ];
    }
    case "fountain": {
      const r = v.r ?? 5;
      return [
        { shape: "cylinder", size: [r, 1.1], pos: [v.at[0], 0, v.at[1]], color: PALETTE.stoneTop, cat: "prop", volId: `vol_${v.id}` },
        { shape: "cylinder", size: [r * 0.82, 0.12], pos: [v.at[0], 1.05, v.at[1]], color: PALETTE.water, cat: "water", volId: `vol_${v.id}`, noShadow: true },
        { shape: "cylinder", size: [0.4, 2.6], pos: [v.at[0], 0, v.at[1]], color: PALETTE.stoneFace, cat: "prop", volId: `vol_${v.id}` },
      ];
    }
    case "prop":
      return propPrims(v);

    case "custom": {
      // Composición 3D libre del motor: una prim por pieza, en orden.
      return customVolumePrims(v);
    }
    case "prism": {
      // Geometría libre: contorno poligonal (celdas) extruido a `h`. El
      // repintado IA le da el aspecto; aquí solo la masa.
      const wc = wall("stone");
      return [
        {
          shape: "polygon",
          size: [v.h],
          pos: [0, 0, 0],
          points: v.points.map(([u, vv]) => [u, vv] as [number, number]),
          color: v.color ?? wc.lit,
          cat: "building",
          volId: `vol_${v.id}`,
        },
      ];
    }
  }
}
