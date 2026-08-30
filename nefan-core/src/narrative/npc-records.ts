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
  opts: {
    /** true cuando la escena se registra por PRIMERA vez (realize/generación
     *  nueva): un id ya existente en otra escena expresa intención del motor
     *  de MOVER al personaje aquí. false en re-broadcasts de escenas
     *  cacheadas (re-entrada): ahí mover teletransportaría de vuelta a
     *  personajes que se marcharon después. */
    firstRegistration?: boolean;
  } = {},
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
      // Centro del footprint. Desde el tope de #300 un NPC declara como mucho
      // 2 celdas, así que en la práctica es siempre 1×1 o 2×2; la cuenta se
      // queda genérica porque es la misma para cualquier huella.
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
      // Mismo id declarado por OTRA escena en el PRIMER registro = el
      // personaje se MUEVE aquí con todo su estado (data: inventario, role,
      // directive) y toma la posición que la escena le declara. Es el
      // contrato del prompt "reutiliza el id existente" — sin esto, el
      // record quedaba anclado a la escena vieja. Re-entrar a la MISMA
      // escena (o re-broadcast cacheado) conserva la posición viva.
      if (opts.firstRegistration && existing.scene_id !== sceneId) {
        existing.scene_id = sceneId;
        existing.position = [npc.pos[0], npc.pos[1], npc.pos[2]];
        state.markDirty();
      }
      continue;
    }
    // Telemetría de duplicados: un NPC NUEVO cuyo display name coincide
    // EXACTO con el de un record vivo suele ser el mismo personaje
    // redeclarado con otro id (visto en el playtest 2026-08-13: Nogala
    // spawneada en el tile + redeclarada en la posada). No se dedupea por
    // nombre (dos "Guardia" son legítimos) — se avisa.
    const twin = state.entities.find((e) => e.type === "npc" && e.data.name === npc.name);
    if (twin) {
      console.warn(
        `[npc-records] escena ${sceneId}: NPC nuevo "${npc.id}" comparte nombre exacto con ` +
        `"${twin.id}" (${twin.scene_id}) — ¿personaje duplicado? Declarar el MISMO id lo movería.`,
      );
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

/** Campos de un NPC de escena (Format D o legacy) que deben fluir a
 *  EntityRecord.data: `role` (peasant/guard/…) y `behavior` (overrides) para
 *  el NpcBehaviorSystem, más `description` y `style_ref` — la identidad
 *  visual con la que se generan su sprite y su retrato. Sin ellos, un
 *  hablante fuera de pantalla no tendría cara. */
function npcBehaviorExtras(e: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (typeof e.role === "string" && e.role) extra.role = e.role;
  if (typeof e.description === "string" && e.description) extra.description = e.description;
  if (typeof e.style_ref === "string" && e.style_ref) extra.style_ref = e.style_ref;
  if (e.behavior && typeof e.behavior === "object" && !Array.isArray(e.behavior)) {
    extra.behavior = e.behavior;
  }
  return extra;
}
