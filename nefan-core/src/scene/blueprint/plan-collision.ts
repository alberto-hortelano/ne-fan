/** Colisión del PLAN declarado — definición ÚNICA compartida por los dos
 *  clientes de física para que jugador (cliente) y NPCs (bridge, vida
 *  ambiental) colisionen EXACTAMENTE igual A PIE sobre el mismo plan.
 *
 *  Antes cada lado componía las mismas fuentes por su cuenta: el cliente unía
 *  `ground`+`volumes` en UN grid (applyPlanCollision) mientras el bridge los
 *  dejaba como dos colliders OR'd. En los solapes ground/volume las dos formas
 *  difieren por la semántica "salir sí, entrar no" del TerrainCollider (un
 *  origen sólido en UNA fuente pero no en la otra cambia el bloqueo) → desync
 *  jugador↔NPC. Con esta unión canónica ambos derivan el mismo grid.
 *
 *  EN EL AIRE NO, y a propósito (tanda BY, «que pueda saltar»). El jugador
 *  saltando consulta un SEGUNDO grid, `planCollisionGridEnElAire`: el mismo
 *  cálculo sin los volúmenes saltables (`esSaltable`), así que pasa por encima
 *  de cercas, muretes y bancos. Los NPC no saltan, el A* no lo sabe y
 *  `scene-validate` sigue midiendo «se recorre ANDANDO»: el validador es una
 *  cota inferior de lo que el jugador alcanza, no su descripción. Consecuencia
 *  aceptada: saltar una cerca deja atrás a un enemigo cuerpo a cuerpo. Que
 *  nadie «arregle» la divergencia filtrando lo saltable en `sim-collision.ts`:
 *  un NPC que atraviesa una cerca andando es un bug; un jugador que la salta
 *  es el juego. */
import type { TerrainGridData } from "../terrain-collision.js";
import type { WorldRect } from "../tile.js";
import { groundCollisionGrid, type CollisionGridDims } from "./ground-collision.js";
import { volumeCollisionGrid } from "./collision.js";
import type { GroundFeature } from "./ground.js";
import type { Volume } from "./volumes.js";
import { esSaltable } from "./volume-metrics.js";

/** Une dos grids de colisión del MISMO tile (mismas dims): una celda es sólida
 *  si lo es en cualquiera de los dos. `null` = sin sólidos en esa fuente. */
export function unionCollisionGrids(
  a: TerrainGridData | null,
  b: TerrainGridData | null,
): TerrainGridData | null {
  if (!a) return b;
  if (!b) return a;
  const solidA = new Set(a.solid_chars ?? ["S"]);
  const solidB = new Set(b.solid_chars ?? ["S"]);
  const rows: string[] = [];
  for (let r = 0; r < a.rows; r++) {
    let row = "";
    for (let c = 0; c < a.cols; c++) {
      row += solidA.has(a.grid[r][c]) || solidB.has(b.grid[r][c]) ? "S" : "g";
    }
    rows.push(row);
  }
  return { ...a, grid: rows, solid_chars: ["S"] };
}

/** Grid de colisión del plan de un tile: agua∖decks del `ground` UNIDA a las
 *  huellas analíticas de los `volumes`. `null` si el plan no aporta sólidos.
 *  El agua declarada bloquea SIEMPRE (los decks la abren): es la misma agua
 *  que `scene-expand` rasteriza al grid como `GROUND_WATER_CHAR`, y las dos
 *  fuentes tienen que decir lo mismo. `dims` son las de la escena
 *  (cols/rows/mpc); sin ellas, las del tile. */
export function planCollisionGrid(
  ground: GroundFeature[] | undefined,
  volumes: Volume[] | undefined,
  rect: WorldRect,
  dims?: CollisionGridDims,
): TerrainGridData | null {
  const waterGrid = ground?.length ? groundCollisionGrid(ground, rect, dims) : null;
  const volumeGrid = volumes?.length ? volumeCollisionGrid(volumes, rect, dims) : null;
  return unionCollisionGrids(waterGrid, volumeGrid);
}

/** El grid del plan que ve el jugador EN EL AIRE: `planCollisionGrid` sin los
 *  volúmenes que se saltan. El agua del `ground` va SIEMPRE dentro (no se
 *  cruza saltando), y lo alto —casas, torres, árboles, las jambas de un gate—
 *  también. Mismo `mpc` que el grid a pie: con `dims` el de la escena, sin él
 *  el del tile. */
export function planCollisionGridEnElAire(
  ground: GroundFeature[] | undefined,
  volumes: Volume[] | undefined,
  rect: WorldRect,
  dims?: CollisionGridDims,
): TerrainGridData | null {
  const noSaltables = volumes?.filter((v) => !esSaltable(v, dims?.mpc));
  return planCollisionGrid(ground, noSaltables, rect, dims);
}

/** El grid de SOLO lo saltable: lo que `planCollisionGrid` tiene y el del aire
 *  no. Sin agua ni lo alto. Contesta «¿el cuerpo está metido en algo bajo?»
 *  (`dentroDeLoBajo`, core): quien aterriza dentro de una valla se mueve con
 *  el grid del aire hasta salir. No se deriva restando los otros dos porque en
 *  una esquina valla+muro el cuerpo solapa los dos a la vez, y ahí la resta
 *  diría «no está en lo bajo» (QA de BY, esquina). */
export function planCollisionGridDeLoBajo(
  volumes: Volume[] | undefined,
  rect: WorldRect,
  dims?: CollisionGridDims,
): TerrainGridData | null {
  const saltables = volumes?.filter((v) => esSaltable(v, dims?.mpc));
  return planCollisionGrid(undefined, saltables, rect, dims);
}
