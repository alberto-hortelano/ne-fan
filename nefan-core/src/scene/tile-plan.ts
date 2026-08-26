/** El PLAN del tile: el único camino desde el esquema hasta la huella
 *  colisionable.
 *
 *  Un tile llega del motor como esquema (`ground` + `volumes` declarados, más
 *  las primitivas que el engine desarrolla: `structures`, `vegetation_zones`,
 *  `entities` estáticas). De ahí sale UNA cosa —el plan— y de ella salen
 *  TODAS las demás: la geometría 3D que pinta el cliente, la colisión del
 *  jugador, la colisión de los NPCs en el bridge, las celdas del atlas de
 *  superficies y la máscara con la que el validador juzga si el tile se puede
 *  jugar.
 *
 *  Hasta esta tanda esa composición estaba copiada CUATRO veces (el cliente,
 *  el batch de estilo, la que le faltaba al bridge y la máscara del
 *  validador), sincronizadas por un comentario que decía «MISMO plan que
 *  compone la partida». No divergían en el código: divergían en los
 *  ARGUMENTOS —el seed y qué entra en la máscara—, que es la forma en que
 *  estas cosas divergen de verdad. Aquí se compone una vez, viaja resuelta en
 *  la world scene (`__plan`) y nadie más deriva nada.
 *
 *  El SEED no se pasa: se deriva del tile. Un caller que pudiera elegirlo
 *  podría componer el mismo tile con dos bosques distintos, que es exactamente
 *  el bug que esta unificación cierra.
 *
 *  Core no elige canal de error: los problemas salen en `warnings` y cada capa
 *  los reporta por el suyo (el cliente `errors.push`, el bridge `console.warn`,
 *  el validador como errores que el motor re-responde). */

import { parseGround, type GroundFeature } from "./blueprint/ground.js";
import { MAX_VOLUMES, parseVolumes, type Volume } from "./blueprint/volumes.js";
import { deriveVolumesFromSchema } from "./blueprint/derive.js";
import { parseVegetationZones, zoneAreaM2 } from "./blueprint/vegetation.js";
import type { FpsTilePlanInput } from "./blueprint/fps-spec.js";
import { tileKey } from "./tile.js";

/** El plan compuesto: lo que pinta el renderer y lo que colisiona. Es el mismo
 *  tipo que consume el builder de la vista fps — una sola definición. */
export type TilePlan = FpsTilePlanInput;

/** Presupuesto de volúmenes del plan COMPUESTO (declarados + derivados).
 *
 *  Sustituye al viejo cap de 80 volúmenes derivados de entities, que tapaba
 *  media fuga: limitaba las entities pero no la vegetación ni las structures,
 *  y `FormatDSceneSchema` no limita `entities`. El cuello no es la CPU
 *  (componer 328 árboles cuesta 4 ms) sino las DRAW CALLS: cada primitiva del
 *  greybox es un `THREE.Mesh` propio y el coste lo marca el TOTAL de
 *  volúmenes residentes, no los de un tile.
 *
 *  MEDIDO el 2026-08-26 (RTX 3060, Chrome/ANGLE-GL, 1280×720, cuatro tiles
 *  residentes — lo que tiene el jugador al cruzar una esquina — con el pump
 *  del bench sin espera, así que la cifra es 1/coste de frame):
 *
 *    vol/tile   de pie DENTRO de un tile     en la ESQUINA de los cuatro
 *      120                     >137 fps                        108,8 fps
 *      240                      137,3 fps                       48,1 fps
 *      480                       57,1 fps                       23,1 fps
 *      960                      (1 tile: 38,9 fps)              10,9 fps
 *
 *  240 es el mayor escalón que deja la postura REAL de partida muy por encima
 *  de 60 fps (137) y la peor —los cuatro tiles enteros en pantalla, que dura
 *  lo que se tarda en cruzar la esquina— en 48. En 480 las dos caen (57 y 23).
 *
 *  El escalón de margen de abajo (120) NO se toma, y el motivo es de contrato,
 *  no de gusto: `MAX_VOLUMES` deja declarar 160 volúmenes, así que un tope de
 *  120 recortaría geometría que el esquema permite pedir. El margen sale de la
 *  otra medida: entre la postura real y la peor hay 2,9× de holgura por
 *  frustum culling. Lo que queda para lo DERIVADO cuando el motor apura sus
 *  160 declarados son 80 volúmenes — casualmente, el cap viejo. */
export const MAX_TILE_VOLUMES = 240;

export interface TilePlanComposition {
  /** `null` = no hay nada que componer (ni suelo ni volúmenes): escena legacy
   *  o tile pelado. */
  plan: TilePlan | null;
  /** entityId → id del volumen que la representa. Quien pinta no la dibuja
   *  aparte; sin esto, cada árbol declarado llevaba dentro un poste que no
   *  colisionaba. */
  representedBy: Record<string, string>;
  /** Lo que hubo que ignorar o recortar, en el idioma del motor. */
  warnings: string[];
}

const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

/** Compone el plan de un TILE Format D (ya expandido). Una escena sin `tile`
 *  no tiene plan: Format D tiene una sola variante y el plan es suya (las
 *  fixtures legacy sin sitio en el plano se pintan desde su grid). */
export function composeTilePlan(raw: Record<string, unknown>): TilePlanComposition {
  const warnings: string[] = [];
  const tile = raw.tile as { tx?: number; ty?: number } | undefined;
  if (!tile || !Number.isInteger(tile.tx) || !Number.isInteger(tile.ty)) {
    return { plan: null, representedBy: {}, warnings };
  }
  const seed = tileKey(tile.tx!, tile.ty!);

  let ground: GroundFeature[] = [];
  if (arr(raw.ground)) {
    const parsed = parseGround(raw.ground);
    if (parsed.ok) ground = parsed.features;
    else warnings.push(`ground inválido (${parsed.error}); el tile se compone sin suelo declarado`);
  }
  let declared: Volume[] = [];
  if (arr(raw.volumes)) {
    const parsed = parseVolumes(raw.volumes);
    if (parsed.ok) declared = parsed.volumes;
    else warnings.push(`volumes inválidos (${parsed.error}); el tile se compone solo con los derivados`);
  }
  const zonas = parseVegetationZones(raw.vegetation_zones);
  if (!zonas.ok) warnings.push(`${zonas.error}; la zona no se planta`);

  const derived = deriveVolumesFromSchema(
    {
      seed,
      structures: raw.structures as never,
      vegetation_zones: zonas.ok ? zonas.zones : [],
      entities: raw.entities as never,
      ground,
    },
    declared,
  );

  // Orden del plan = orden del recorte: primero lo declarado por el motor,
  // luego lo que el esquema implica y, al final, la masa forestal. Lo que cae
  // es lo más prescindible, y se DICE (nunca un `slice()` mudo).
  const fijos = [...declared, ...derived.volumes];
  let volumes = [...fijos, ...derived.vegetation];
  if (volumes.length > MAX_TILE_VOLUMES) {
    const areaZonasM2 = (zonas.ok ? zonas.zones : []).reduce((acc, z) => acc + zoneAreaM2(z.area), 0);
    warnings.push(avisoDePresupuesto(volumes.length, fijos.length, declared.length, areaZonasM2));
    volumes = volumes.slice(0, MAX_TILE_VOLUMES);
  }

  if (ground.length === 0 && volumes.length === 0) {
    return { plan: null, representedBy: derived.representedBy, warnings };
  }
  return {
    plan: {
      ground,
      volumes,
      biome: typeof raw.biome === "string" ? raw.biome : undefined,
      scatter_generators: raw.scatter_generators,
      scatter_zones: raw.scatter_zones,
      scene_description: typeof raw.scene_description === "string" ? raw.scene_description : undefined,
    },
    representedBy: derived.representedBy,
    warnings,
  };
}

/** El aviso del recorte, con los TRES números que el motor necesita para
 *  re-responder: lo que pidió, el tope y la densidad que sí cabría. Truncar
 *  por detrás sin decirlo es lo que hacía el cap viejo. */
function avisoDePresupuesto(
  total: number,
  fijos: number,
  declarados: number,
  areaZonasM2: number,
): string {
  const base =
    `el plan del tile pide ${total} volúmenes y el tope son ${MAX_TILE_VOLUMES} ` +
    `(${declarados} declarados de ${MAX_VOLUMES} + ${fijos - declarados} derivados del esquema ` +
    `+ ${total - fijos} de vegetación de masa): se recortan ${total - MAX_TILE_VOLUMES}, la vegetación primero`;
  if (areaZonasM2 <= 0) return `${base}. Declara menos volumes o menos entities estáticas`;
  const cabe = Math.floor((Math.max(0, MAX_TILE_VOLUMES - fijos) / areaZonasM2) * 100) / 100;
  return `${base}. Baja la densidad de vegetation_zones a ${cabe} ejemplares/m² o declara menos volumes`;
}
