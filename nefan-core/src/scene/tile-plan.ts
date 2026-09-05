/** El PLAN del tile: el único camino desde el esquema hasta la huella
 *  colisionable.
 *
 *  Un tile llega del motor como esquema (`ground` + `volumes` declarados, más
 *  las primitivas que el engine desarrolla: `vegetation_zones` y las
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
import { tileCoordDe, tileKey } from "./tile.js";

/** El plan compuesto: lo que pinta el renderer y lo que colisiona. Es el mismo
 *  tipo que consume el builder de la vista fps — una sola definición. */
export type TilePlan = FpsTilePlanInput;

/** Presupuesto de volúmenes del plan COMPUESTO (declarados + derivados).
 *
 *  Sustituye al viejo cap de 80 volúmenes derivados de entities, que tapaba
 *  media fuga: limitaba las entities pero no la vegetación, y
 *  `EmittedSceneSchema` no limita `entities`. El cuello no es la CPU
 *  (componer 328 árboles cuesta 4 ms) sino las DRAW CALLS: cada primitiva del
 *  greybox es un `THREE.Mesh` propio y lo que cuesta es el total de volúmenes
 *  que caen en el FRUSTUM, no los de un tile.
 *
 *  MEDIDO, y la medida se repite desde el árbol:
 *  `node qa/presupuesto-de-volumenes.mjs` (con `./start.sh --preset html-fixtures`
 *  levantado). RTX 3060, Chrome/ANGLE-GL, 1280×720, CUATRO tiles residentes —
 *  lo que tiene el jugador al acercarse a un vértice del plano continuo— y el
 *  pump del bench sin espera, así que la cifra es 1/coste de frame:
 *
 *    vol/tile   mirando al eje (juego)   mirando al vértice (peor caso)
 *      120                 129,5 fps                        109,0 fps
 *      160                  90,3 fps                         79,0 fps
 *      200                  68,7 fps                         61,3 fps
 *      240                  54,4 fps                          49,7 fps
 *
 *  La fila de 240 en el peor caso se midió dos veces con scripts distintos
 *  (49,7 y 48,1 fps): está por debajo del suelo, y no por poco margen de
 *  medida. OJO con la postura, que costó una tabla entera de números falsos:
 *  el peor caso es mirar HACIA el vértice desde dentro de un tile; ponerse EN
 *  el vértice deja tres de los cuatro tiles detrás de la cámara y mide ~2,5×
 *  más rápido.
 *
 *  CRITERIO: el plan de la tanda fijó «el mayor escalón que sostiene ≥50 fps
 *  con 4 tiles, un escalón por debajo por margen». El SUELO se respeta tal
 *  cual —200 da 61,3 fps con los cuatro tiles en el frustum, 240 da 49,7 y se
 *  queda fuera—; lo que no se puede aplicar es el escalón de margen, y no por
 *  gusto: el de abajo es 160, que es exactamente `MAX_VOLUMES`, así que un
 *  tope ahí recortaría geometría que el propio esquema permite declarar. El
 *  margen sale entonces de donde se puede medir: +23 % sobre el suelo en el
 *  peor caso, 68,7 fps en la postura de juego, y unos mundos reales que ni se
 *  acercan (los cuatro pre-generados del usuario componen entre 13 y 188
 *  volúmenes por tile, y el peor caso exige los CUATRO al tope a la vez).
 *
 *  Lo que deja para lo derivado cuando el motor apura sus 160 declarados son
 *  40 volúmenes; con un tile normal (13-53 declarados), 150 o más. */
export const MAX_TILE_VOLUMES = 200;

export interface TilePlanComposition {
  /** `null` = no hay nada que componer (ni suelo ni volúmenes): tile pelado. */
  plan: TilePlan | null;
  /** entityId → id del volumen que la representa. Quien pinta no la dibuja
   *  aparte; sin esto, cada árbol declarado llevaba dentro un poste que no
   *  colisionaba. */
  representedBy: Record<string, string>;
  /** Lo que hubo que ignorar o recortar, en el idioma del motor. */
  warnings: string[];
}

const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

/** Compone el plan de un TILE Format D (ya expandido). Sin `tile` LANZA
 *  (#405): Format D tiene una sola variante, el plan es suya y su seed sale de
 *  las coords — una escena sin sitio en el plano no tiene nada que componer
 *  ni ningún grid propio desde el que pintarse. */
export function composeTilePlan(raw: Record<string, unknown>): TilePlanComposition {
  const warnings: string[] = [];
  const tile = tileCoordDe(raw);
  const seed = tileKey(tile.tx, tile.ty);

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
