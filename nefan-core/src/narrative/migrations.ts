/** Migraciones de schema del save (SessionData v1→v4).
 *
 *  Extraídas de NarrativeState para que la clase quede como estado puro:
 *  aquí vive el conocimiento de los formatos viejos. Cada migración recibe el
 *  NarrativeState ya hidratado con los campos del save y lo transforma in
 *  place (loadSession las orquesta según data.schema_version). */
import { WorldMapManager } from "../world-map/world-map.js";
import type { WorldMap } from "../world-map/types.js";
import { TILE_CELLS, TILE_MPC, tileKey } from "../scene/tile.js";
import { expandScenePrimitives } from "../scene/scene-expand.js";
import type { SessionData } from "./types.js";
import type { NarrativeState } from "./narrative-state.js";

/** Migración v3→v4: envuelve la escena ACTIVA (Format D expandido, centrada
 *  en el origen) como tile (0,0): el grid viejo se re-muestrea como
 *  terrain_patch centrado (escala mpc/0.5), las entities se re-celdan con el
 *  mismo offset, y los EntityRecord de esa escena pasan a posición global.
 *  Las demás escenas quedan legacy (TravelPanel). */
export function migrateActiveSceneToTile(state: NarrativeState): void {
  const oldId = state.world.active_scene_id;
  const rec = oldId ? state.scenes_loaded[oldId] : undefined;
  if (!rec || rec.scene_data.tile !== undefined) return;
  const old = rec.scene_data;
  const size = old.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
  const oldGrid = old.terrain;
  if (!size || typeof size.cols !== "number" || typeof size.rows !== "number" || !Array.isArray(oldGrid)) {
    console.warn(`NarrativeState: escena activa "${oldId}" no es Format D — se deja como legacy`);
    return;
  }
  const cols = size.cols;
  const rows = size.rows;
  const mpc = size.meters_per_cell ?? 2;
  const scale = Math.round(mpc / TILE_MPC); // 0.5→1, 1→2, 2→4
  if (scale < 1 || cols * scale > TILE_CELLS || rows * scale > TILE_CELLS) {
    console.warn(`NarrativeState: escena activa "${oldId}" no cabe en un tile — se deja como legacy`);
    return;
  }
  const colOff = Math.floor((TILE_CELLS - cols * scale) / 2);
  const rowOff = Math.floor((TILE_CELLS - rows * scale) / 2);

  // Grid viejo re-muestreado (cada celda vieja → scale×scale celdas nuevas).
  const patchRows: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = typeof oldGrid[r] === "string" ? (oldGrid[r] as string) : "g".repeat(cols);
    let expanded = "";
    for (let c = 0; c < cols; c++) expanded += (row[c] ?? "g").repeat(scale);
    for (let k = 0; k < scale; k++) patchRows.push(expanded);
  }

  const entities = Array.isArray(old.entities)
    ? (old.entities as Record<string, unknown>[]).map((e) => {
        const cell = e.cell as [number, number] | undefined;
        const fp = (e.footprint as [number, number] | undefined) ?? [1, 1];
        if (!Array.isArray(cell)) return { ...e };
        return {
          ...e,
          cell: [colOff + cell[0] * scale, rowOff + cell[1] * scale],
          footprint: [Math.max(1, (fp[0] ?? 1) * scale), Math.max(1, (fp[1] ?? 1) * scale)],
        };
      })
    : [];

  const tileScene = expandScenePrimitives({
    tile: { tx: 0, ty: 0 },
    scene_id: tileKey(0, 0),
    scene_description: old.scene_description ?? old.room_description ?? "",
    biome: "grass",
    terrain_patches: [{ at: [colOff, rowOff], rows: patchRows }],
    terrain_legend: old.terrain_legend ?? {},
    entities,
    ambient_event: old.ambient_event ?? "",
    place_id: old.place_id,
  });

  delete state.scenes_loaded[oldId];
  // Los spawns dinámicos de la escena vieja (react_to_player…) migran de
  // escena y a posición global (celda vieja → mundo, que con el tile (0,0)
  // centrado es la misma posición física de siempre). Los scene_init se
  // RETIRAN: el re-registro de abajo los recrea con posición global desde
  // las celdas re-muestreadas (registerSceneNpcs preserva records vivos,
  // así que la migración debe soltarlos explícitamente — un save v3 no
  // tiene role/directive que perder).
  const halfW = (cols * mpc) / 2;
  const halfD = (rows * mpc) / 2;
  state.entities = state.entities.filter((e) => {
    if (e.scene_id !== oldId) return true;
    if (e.spawn_reason === "scene_init") return false;
    e.scene_id = tileKey(0, 0);
    const [c, , r] = e.position;
    e.position = [(c + 0.5) * mpc - halfW, 0, (r + 0.5) * mpc - halfD];
    return true;
  });
  // Re-registro completo bajo la clave de tile (recalcula NPCs en global).
  state.recordSceneLoaded(tileKey(0, 0), tileScene, rec.asset_refs);
  // El place que apuntaba a la escena vieja pasa a apuntar al tile.
  for (const place of Object.values(state.worldMap.map.places)) {
    if (place.realized_scene_id === oldId) place.realized_scene_id = tileKey(0, 0);
  }
  console.log(`NarrativeState: save v3 migrado — escena "${oldId}" → ${tileKey(0, 0)}`);
}

/** Build a minimal WorldMap from a pre-v2 SessionData. Each loaded scene
 * becomes an "interior" place under the root, and the active scene becomes
 * the active place. */
export function migrateWorldMapFromV1(data: SessionData): WorldMap {
  const map = WorldMapManager.createEmpty(data.world?.name || "Mundo");
  const mgr = new WorldMapManager(map);
  const scenes = data.scenes_loaded ?? {};
  for (const sceneId of Object.keys(scenes)) {
    mgr.upsertPlace({
      id: sceneId,
      kind: "interior",
      parent_id: map.root_id,
      name: sceneId,
      realized_scene_id: sceneId,
      visited: true,
    });
  }
  const active = data.world?.active_scene_id;
  if (active && map.places[active]) {
    map.active_place_id = active;
  }
  return map;
}
