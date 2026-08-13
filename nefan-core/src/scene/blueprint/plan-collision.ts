/** Colisión del PLAN declarado — definición ÚNICA compartida por los dos
 *  clientes de física para que jugador (cliente 2D) y NPCs (bridge, vida
 *  ambiental) colisionen EXACTAMENTE igual sobre el mismo plan.
 *
 *  Antes cada lado componía las mismas fuentes por su cuenta: el cliente unía
 *  `ground`+`volumes` en UN grid (applyPlanCollision) mientras el bridge los
 *  dejaba como dos colliders OR'd. En los solapes ground/volume las dos formas
 *  difieren por la semántica "salir sí, entrar no" del TerrainCollider (un
 *  origen sólido en UNA fuente pero no en la otra cambia el bloqueo) → desync
 *  jugador↔NPC. Con esta unión canónica ambos derivan el mismo grid. */
import type { TerrainGridData } from "../terrain-collision.js";
import type { WorldRect } from "../tile.js";
import { groundCollisionGrid, type CollisionGridDims } from "./ground-collision.js";
import { volumeCollisionGrid } from "./collision.js";
import type { GroundFeature } from "./ground.js";
import type { Volume } from "./volumes.js";

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

/** Grid de colisión del plan de un tile/plató: agua∖decks del `ground` UNIDA a
 *  las huellas analíticas de los `volumes`. `dims` para platós con cols/rows/mpc
 *  propios; sin él, las del tile continuo. `null` si el plan no aporta sólidos. */
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
