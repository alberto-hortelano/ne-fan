/** Apply narrative consequences to NarrativeState and emit renderer-agnostic
 * effects. Canonical implementation — the client materializes the resulting
 * effects (narrative_spawn/narrative_dialogue/...). */
import type { NarrativeState } from "./narrative-state.js";
import { resolveSpeaker } from "./speaker-resolve.js";
import type { Consequence, ConsequenceEffect, Vec3Like } from "./types.js";
import { toTuple } from "./types.js";
import { combatForHostileRole } from "../combat/hostiles.js";

export type { ConsequenceEffect };

export interface DispatchOptions {
  /** Player position used as the anchor for "near_player" position hints. */
  playerPosition?: Vec3Like;
  /** Player forward vector for hint resolution. */
  playerForward?: Vec3Like;
  /** Optional entity-id generator for testability. Default: timestamp-based. */
  generateEntityId?: (kind: string) => string;
  /** Entidad con la que el jugador está interactuando en ESTE turno: cuando
   *  hay tres "Guardia" en la escena, desambigua cuál habla. */
  speakerHintId?: string;
}

export interface DispatchResult {
  effects: ConsequenceEffect[];
  injectedDialogue: boolean;
  /** Eventos `plugin_event` recolectados (no aplicados): el bridge los pasa
   *  al dispatcher de plugins después de las consequences core (§7.4). */
  pluginEvents: Array<{ pluginId: string; type: string; payload: Record<string, unknown> }>;
}

export function dispatchConsequences(
  state: NarrativeState,
  eventId: string,
  consequences: Consequence[],
  opts: DispatchOptions = {},
): DispatchResult {
  const result: DispatchResult = { effects: [], injectedDialogue: false, pluginEvents: [] };
  // Contador local: varias spawn_entity del mismo turno (p. ej. "aparecen tres
  // guardias") caían en el mismo segundo con el generador por defecto y
  // recibían el MISMO id → entidades duplicadas y NPCs colapsados en el sim.
  let spawnOrdinal = 0;
  let spawnsDelTurno = 0;
  // …y el mismo turno también las colocaba a TODAS en el mismo punto, que es
  // el otro medio choque: `near_player` es «jugador + forward × 5» y no sabe
  // cuántas van. Medido jugando (QA 2026-08-31, H-5): un cofre y una forja
  // salieron con la coordenada EXACTA, así que al reanudar el jugador se
  // encontraba la cara pegada a una caja de 4×4×2,5 m con el cofre invisible
  // dentro. Este contador sí cuenta SIEMPRE — el de arriba solo se incrementa
  // cuando no hay generador de ids inyectado, y por eso no vale para esto.

  if (consequences.length === 0) {
    result.effects.push({ kind: "ambient_message", message: "💭 El mundo sigue su curso..." });
    return result;
  }

  for (const c of consequences) {
    if (!c || typeof c !== "object") continue;
    switch (c.type) {
      case "dialogue": {
        if (!c.text) break;
        // Identidad del hablante para el cliente (retrato del panel): el
        // modelo emite un nombre, el registro sabe a qué entidad pertenece.
        const who = resolveSpeaker(
          state.entities,
          state.world.active_scene_id,
          c.speaker || "",
          opts.speakerHintId,
        );
        result.effects.push({
          kind: "show_dialogue",
          speaker: c.speaker || "?",
          text: c.text,
          choices: (c.choices as (string | { text: string })[]) ?? [],
          ...(who
            ? {
                speakerId: who.id,
                speakerSkinPrompt: who.skinPrompt,
                ...(who.styleRef ? { speakerStyleRef: who.styleRef } : {}),
              }
            : {}),
        });
        result.injectedDialogue = true;
        break;
      }
      case "story_update": {
        if (c.delta) {
          state.appendStory(c.delta);
          result.effects.push({ kind: "story_delta", delta: c.delta });
        }
        break;
      }
      case "spawn_entity": {
        // Sin defaults mudos (#397): `entity_kind` y `name` los exige el
        // contrato (zod y espejo Python) antes de llegar aquí, y `description`
        // es OPCIONAL de verdad — si el motor no la declaró, el effect va sin
        // ella y el cliente pinta con `name`. Aquí vivía un `?? "an entity"`
        // que nadie escribió y que el jugador acababa viendo como prompt del
        // skin.
        const kind = c.entity_kind;
        const hint = c.position_hint ?? "near_player";
        const pos = resolvePositionHint(hint, opts.playerPosition, opts.playerForward, spawnsDelTurno++);
        const entityId =
          opts.generateEntityId?.(kind) ??
          `narr_${kind}_${Math.floor(Date.now() / 1000)}_${spawnOrdinal++}`;
        const sceneId = state.world.active_scene_id;
        // La SEGUNDA vía a un enemigo, y converge con la primera en
        // `combatForHostileRole`: un `spawn_entity` con `kind:"npc"` y
        // `role:"hostile"` sale con el MISMO bloque `combat` que emite
        // `formatDToWorld` para la escena inicial. Lo que sigue siendo
        // distinto es solo el transporte (effect en vuelo vs world scene),
        // que ya lo era.
        //
        // El bloque va al `data` del EntityRecord además de al effect porque
        // el ledger es lo que LEE EL MOTOR (`serializeForLlm`, `entity_get`):
        // sin él, el modelo ve un NPC y no sabe que puso algo hostil.
        //
        // Lo que NO hace, dicho aquí para que nadie lo lea de más: NO devuelve
        // el enemigo al reanudar. Un spawn de runtime no está en el Format D
        // de ninguna escena, y el cliente materializa enemigos desde `npcs[]`
        // de la escena que recibe, así que hoy desaparece entero en el resume.
        // Escribirlo aquí es la mitad que hace falta para arreglarlo, no el
        // arreglo — ese va aparte.
        const combat = kind === "npc" ? combatForHostileRole(c.role) : undefined;
        const data: Record<string, unknown> = combat
          ? { ...(c as Record<string, unknown>), combat }
          : (c as Record<string, unknown>);
        const finalId = state.recordEntitySpawned(
          entityId, kind, sceneId, pos, data, "narrative_request", eventId,
        );
        result.effects.push({
          kind: "spawn_entity",
          entityId: finalId,
          entityKind: kind,
          name: c.name,
          ...(c.description !== undefined ? { description: c.description } : {}),
          position: pos,
          data,
          eventId,
        });
        break;
      }
      case "schedule_event": {
        // Persiste en la agenda: reaparece en cada contexto LLM hasta que el
        // motor lo dispare y resuelva (tool scheduled_event_resolve).
        const description = c.description ?? "";
        const trigger = typeof c.trigger === "string" ? c.trigger : undefined;
        const schedId = state.addScheduledEvent(description, trigger, eventId);
        result.effects.push({
          kind: "schedule_event",
          id: schedId,
          description,
          trigger,
        });
        break;
      }
      case "plugin_event": {
        // Sólo recolecta; el tick de plugins (nivel 3) lo resuelve después.
        // recordNarrativeConsequence lo deja auditado en dialogue_history.
        result.pluginEvents.push({
          pluginId: c.plugin_id,
          type: c.event_type,
          payload: c.payload ?? {},
        });
        break;
      }
    }
    state.recordNarrativeConsequence(eventId, c);
  }

  return result;
}

const HINT_OFFSETS: Record<string, [number, number, number]> = {
  distant_north: [0, 0, -50],
  distant_south: [0, 0, 50],
  distant_east: [50, 0, 0],
  distant_west: [-50, 0, 0],
};

/** Separación lateral entre dos cosas que aparecen en el MISMO turno. 1,8 m:
 *  más que el ancho de la huella de un NPC (0,5 m) y que el de un objeto
 *  (1,4 m), y menos que el de un edificio (4 m) — un edificio y lo que sea que
 *  venga con él siguen quedando cerca, pero ya no dentro. */
const SEPARACION_M = 1.8;

/** Dónde aparece lo que el motor manda. `ordinal` es el puesto que ocupa
 *  dentro de SU turno: el primero cae donde siempre y los siguientes se
 *  reparten a los lados, alternando (+1, −1, +2, −2…). Sin eso, «aparecen tres
 *  guardias» son tres personajes en la misma coordenada. */
function resolvePositionHint(
  hint: string,
  playerPos: Vec3Like = [0, 0, 0],
  playerForward: Vec3Like = [0, 0, -1],
  ordinal = 0,
): [number, number, number] {
  const base = toTuple(playerPos);
  const fwd = toTuple(playerForward);
  // Perpendicular al forward en el plano: el reparto va a izquierda y derecha
  // de lo que el jugador está mirando, no hacia él ni al fondo.
  const paso = ordinal === 0 ? 0 : Math.ceil(ordinal / 2) * (ordinal % 2 === 1 ? 1 : -1);
  const lat = paso * SEPARACION_M;
  const sep: [number, number, number] = [fwd[2] * lat, 0, -fwd[0] * lat];
  if (hint === "near_player") {
    return [base[0] + fwd[0] * 5 + sep[0], base[1] + fwd[1] * 5, base[2] + fwd[2] * 5 + sep[2]];
  }
  const off = HINT_OFFSETS[hint];
  if (off) {
    return [base[0] + off[0] + sep[0], base[1] + off[1], base[2] + off[2] + sep[2]];
  }
  return [
    base[0] + fwd[0] * 10 + sep[0],
    base[1] + fwd[1] * 10,
    base[2] + fwd[2] * 10 + sep[2],
  ];
}
