/** Registro de los NPC declarados por una escena en NarrativeState.entities.
 *
 *  Extraído de la clase: aquí vive el parsing dual de NPCs — Format D
 *  (entities[] con kind "npc" y cell [col,row]) y escenas legacy (npcs[] con
 *  position [x,y,z]) — y la política de preservación de records vivos al
 *  re-entrar a una escena cacheada. recordSceneLoaded delega aquí. */
import { TILE_MPC, tileWorldRect } from "../scene/tile.js";
import type { NarrativeState } from "./narrative-state.js";

/** Pull the NPCs declared in a scene into `entities`, so the narrative engine
 *  sees them in its context (serializeForLlm) and can react when the player
 *  talks to one. Without this the entities list is empty and every
 *  interact_entity / dialogue choice comes back with 0 consequences. */
export function registerSceneNpcs(
  state: NarrativeState,
  sceneId: string,
  sceneData: Record<string, unknown>,
): void {
  // En tiles la posición registrada es GLOBAL (metros del plano continuo);
  // en escenas legacy se conserva el histórico (celdas locales).
  const rawTile = sceneData.tile as { tx?: number; ty?: number } | undefined;
  const rect = rawTile && Number.isInteger(rawTile.tx) && Number.isInteger(rawTile.ty)
    ? tileWorldRect(rawTile.tx!, rawTile.ty!)
    : null;
  const npcs: Array<{
    id: string; name: string; pos: [number, number, number];
    extra: Record<string, unknown>;
  }> = [];

  // Format D (open-world scenes): entities[] with kind "npc", cell [col,row].
  const fdEntities = sceneData.entities;
  if (Array.isArray(fdEntities)) {
    for (let i = 0; i < fdEntities.length; i++) {
      const ent = fdEntities[i];
      if (!ent || typeof ent !== "object") continue;
      const e = ent as Record<string, unknown>;
      if (e.kind !== "npc") continue;
      if (typeof e.id !== "string" || !e.id) {
        throw new Error(`scene ${sceneId}.entities[${i}] kind=npc missing string id`);
      }
      if (typeof e.name !== "string" || !e.name) {
        throw new Error(`scene ${sceneId}.entities[${i}] (npc ${e.id}) missing string name`);
      }
      if (!Array.isArray(e.cell) || e.cell.length < 2) {
        throw new Error(`scene ${sceneId}.entities[${i}] (npc ${e.id}) missing cell [col,row]`);
      }
      const col = e.cell[0];
      const row = e.cell[1];
      if (typeof col !== "number" || !Number.isFinite(col) ||
          typeof row !== "number" || !Number.isFinite(row)) {
        throw new Error(
          `scene ${sceneId}.entities[${i}] (npc ${e.id}) cell must be finite numbers, got [${col}, ${row}]`,
        );
      }
      // Centro del footprint (los NPC suelen ser 1×1, pero los migrados de
      // saves v3 escalan su footprint con el re-muestreo).
      const fp = Array.isArray(e.footprint) ? (e.footprint as [number, number]) : [1, 1];
      const fw = typeof fp[0] === "number" && fp[0] > 0 ? fp[0] : 1;
      const fh = typeof fp[1] === "number" && fp[1] > 0 ? fp[1] : 1;
      npcs.push({
        id: e.id,
        name: e.name,
        pos: rect
          ? [rect.minX + (col + fw / 2) * TILE_MPC, 0, rect.minZ + (row + fh / 2) * TILE_MPC]
          : [col, 0, row],
        extra: npcBehaviorExtras(e),
      });
    }
  }

  // Legacy scenes: npcs[] with {id, name, position}.
  const legacyNpcs = sceneData.npcs;
  if (Array.isArray(legacyNpcs)) {
    for (let i = 0; i < legacyNpcs.length; i++) {
      const ent = legacyNpcs[i];
      if (!ent || typeof ent !== "object") continue;
      const e = ent as Record<string, unknown>;
      if (typeof e.id !== "string" || !e.id) {
        throw new Error(`scene ${sceneId}.npcs[${i}] missing string id`);
      }
      if (typeof e.name !== "string" || !e.name) {
        throw new Error(`scene ${sceneId}.npcs[${i}] (${e.id}) missing string name`);
      }
      if (!Array.isArray(e.position) || e.position.length < 3) {
        throw new Error(`scene ${sceneId}.npcs[${i}] (${e.id}) missing position [x,y,z]`);
      }
      const [x, y, z] = e.position;
      if (typeof x !== "number" || !Number.isFinite(x) ||
          typeof y !== "number" || !Number.isFinite(y) ||
          typeof z !== "number" || !Number.isFinite(z)) {
        throw new Error(
          `scene ${sceneId}.npcs[${i}] (${e.id}) position must be finite numbers, got [${x},${y},${z}]`,
        );
      }
      npcs.push({ id: e.id, name: e.name, pos: [x, y, z], extra: npcBehaviorExtras(e) });
    }
  }

  // Re-entrar a una escena cacheada no debe duplicar sus NPCs, pero tampoco
  // RESETEARLOS: un record existente conserva posición (el behavior system
  // los mueve), role, directive y current_place_id. Solo se retiran los
  // scene_init que ya no figuran en la escena, y se crean los nuevos.
  const ids = new Set(npcs.map((n) => n.id));
  const before = state.entities.length;
  state.entities = state.entities.filter(
    (e) => !(e.scene_id === sceneId && e.spawn_reason === "scene_init" && !ids.has(e.id)),
  );
  if (state.entities.length !== before) state.markDirty();

  for (const npc of npcs) {
    const existing = state.entities.find((e) => e.id === npc.id);
    if (existing) {
      if (npc.name && existing.data.name !== npc.name) {
        existing.data.name = npc.name;
        state.markDirty();
      }
      continue;
    }
    state.recordEntitySpawned(
      npc.id,
      "npc",
      sceneId,
      { x: npc.pos[0], y: npc.pos[1], z: npc.pos[2] },
      { name: npc.name, ...npc.extra },
      "scene_init",
    );
  }
}

/** Campos de comportamiento ambiental que un NPC de escena puede declarar
 *  (Format D o legacy) y que deben fluir a EntityRecord.data para el
 *  NpcBehaviorSystem: `role` (peasant/guard/…) y `behavior` (overrides). */
function npcBehaviorExtras(e: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (typeof e.role === "string" && e.role) extra.role = e.role;
  if (e.behavior && typeof e.behavior === "object" && !Array.isArray(e.behavior)) {
    extra.behavior = e.behavior;
  }
  return extra;
}
