/** Colisión del PLAN declarado — definición ÚNICA compartida por los dos
 *  clientes de física para que jugador (cliente) y NPCs (bridge, vida
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
import { groundCollisionGrid, GROUND_WATER_CHAR, type CollisionGridDims } from "./ground-collision.js";
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

export interface PlanCollisionOpts {
  /** Solidez RESUELTA de la leyenda del terreno de ESA escena
   *  (`resolveTerrainLegend` → `terrain_grid.solid_chars`). Es obligatoria a
   *  propósito: el agua de `ground` se rasteriza al grid como
   *  `GROUND_WATER_CHAR`, así que quien declara `{name, solid:false}` para ese
   *  char está declarando un VADO. Si el plan la bloqueara igual habría dos
   *  colisiones sobre la misma agua contradiciéndose, y ganaría la que el
   *  autor NO escribió: el jugador rebotaría contra un río que la escena abre.
   *  Sin leyenda propia, `DEFAULT_SOLID_CHARS` (el agua bloquea). */
  solidChars: readonly string[];
  /** Dims propias (cols/rows/mpc de la escena); sin ellas, las del tile. */
  dims?: CollisionGridDims;
}

/** Grid de colisión del plan de un tile: agua∖decks del `ground` UNIDA a las
 *  huellas analíticas de los `volumes`. `null` si el plan no aporta sólidos. */
export function planCollisionGrid(
  ground: GroundFeature[] | undefined,
  volumes: Volume[] | undefined,
  rect: WorldRect,
  opts: PlanCollisionOpts,
): TerrainGridData | null {
  const waterBlocks = opts.solidChars.includes(GROUND_WATER_CHAR);
  const waterGrid = waterBlocks && ground?.length ? groundCollisionGrid(ground, rect, opts.dims) : null;
  const volumeGrid = volumes?.length ? volumeCollisionGrid(volumes, rect, opts.dims) : null;
  return unionCollisionGrids(waterGrid, volumeGrid);
}
