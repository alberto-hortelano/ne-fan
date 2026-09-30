/** Apply narrative consequences to NarrativeState and emit renderer-agnostic
 * effects. Canonical implementation — the client materializes the resulting
 * effects (narrative_spawn/narrative_dialogue/...). */
import type { NarrativeState } from "./narrative-state.js";
import { resolveSpeaker } from "./speaker-resolve.js";
import type { Consequence, ConsequenceEffect, Vec3Like } from "./types.js";
import { toTuple } from "./types.js";
import { combatForHostileRole } from "../combat/hostiles.js";
import {
  anclaDentroDelTile,
  HOLGURA_ENTRE_SPAWNS_M,
  mediaAnchura,
  repartirEnElTurno,
  type CuerpoDelTurno,
} from "./reparto-de-spawns.js";
import { huellaEnMetros } from "../scene/scene-normalize.js";
import { tileWorldRect, worldToTile } from "../scene/tile.js";

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
  /** Cantidades de `player_healed` recolectadas (no aplicadas): el bridge se
   *  las da al sim (`aplicarCuraciones`) antes de guardar. Sin effect para el
   *  cliente: la barra sale del `playerHp` del siguiente `state_update`. */
  curaciones: number[];
}

export function dispatchConsequences(
  state: NarrativeState,
  eventId: string,
  consequences: Consequence[],
  opts: DispatchOptions = {},
): DispatchResult {
  const result: DispatchResult = {
    effects: [],
    injectedDialogue: false,
    pluginEvents: [],
    curaciones: [],
  };
  // Contador local: varias spawn_entity del mismo turno (p. ej. "aparecen tres
  // guardias") caían en el mismo segundo con el generador por defecto y
  // recibían el MISMO id → entidades duplicadas y NPCs colapsados en el sim.
  let spawnOrdinal = 0;
  let spawnsDelTurno = 0;
  // DÓNDE VA CADA UNO, calculado ANTES de despachar: el reparto necesita ver
  // el turno entero —cada cosa se apoya en el borde de la anterior— y el
  // bucle de abajo las procesa de una en una. Es la lista de desplazamientos
  // laterales en metros, en el orden en que el motor las mandó.
  const spawns = consequences.filter(
    (c): c is Extract<Consequence, { type: "spawn_entity" }> =>
      !!c && typeof c === "object" && c.type === "spawn_entity",
  );
  const cuerpos: CuerpoDelTurno[] = spawns.map((c) => ({
    kind: c.entity_kind,
    footprint: c.footprint ?? null,
  }));
  const reparto = repartirEnElTurno(cuerpos);
  const colocacion = spawns.length > 0
    ? colocacionDelTurno(state, spawns, cuerpos, reparto, opts)
    : null;
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
        // `colocacion` existe siempre que haya un spawn en el turno: se
        // calcula arriba con la misma lista que recorre este bucle.
        const { sceneId, anclas, fwd } = colocacion!;
        const ancla = anclas.get(hint)!;
        const lat = reparto[spawnsDelTurno++] ?? 0;
        // Perpendicular al forward en el plano: el reparto va a izquierda y
        // derecha de lo que el jugador está mirando, no hacia él ni al fondo.
        const pos: [number, number, number] = [ancla[0] + fwd[2] * lat, ancla[1], ancla[2] - fwd[0] * lat];
        const entityId =
          opts.generateEntityId?.(kind) ??
          `narr_${kind}_${Math.floor(Date.now() / 1000)}_${spawnOrdinal++}`;
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
        const comun = {
          kind: "spawn_entity" as const,
          entityId: finalId,
          name: c.name,
          ...(c.description !== undefined ? { description: c.description } : {}),
          position: pos,
          data,
          eventId,
        };
        // El TAMAÑO viaja con el effect, derivado por la misma función que el
        // de una entity del tile (`huellaEnMetros`). Antes no viajaba y el
        // cliente se lo inventaba con dos literales en metros, así que la forja
        // que el motor pone medía una cosa y la que declara una escena otra
        // (#489). Un `npc` no lo lleva: colisiona por su radio.
        //
        // Y desde #532 el motor puede DECLARARLO (`footprint`, en celdas): si
        // viene, manda el declarado; si no, el defecto de la clase. La
        // conversión celdas→metros se hace aquí, en core, y por eso el cliente
        // no la porta (candado `cliente-no-convierte-celdas-a-metros`). Lo que
        // decide si frena NO es este número sino la clase: un `item` sale con
        // su tamaño y aun así se pisa.
        result.effects.push(
          kind === "npc"
            ? { ...comun, entityKind: "npc" }
            : { ...comun, entityKind: kind, sizeXZ: huellaEnMetros(kind, c.footprint ?? null) },
        );
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
      case "player_healed": {
        // Sólo recolecta, como `plugin_event`: el sim no vive aquí.
        result.curaciones.push(c.amount);
        break;
      }
    }
    state.recordNarrativeConsequence(eventId, c);
  }

  return result;
}

/** `distant_*` es «hacia ese lado, lejos»: 50 m desde el jugador, que en un
 *  tile de 64 m casi siempre acaba acotado por `anclaDentroDelTile` al borde
 *  de ese lado. O sea, en la práctica, «junto al borde norte/sur/este/oeste
 *  del tile»: nunca en el tile de al lado, que puede no existir (#382). */
const HINT_OFFSETS: Record<string, [number, number, number]> = {
  distant_north: [0, 0, -50],
  distant_south: [0, 0, 50],
  distant_east: [50, 0, 0],
  distant_west: [-50, 0, 0],
};

interface ColocacionDelTurno {
  /** Escena del tile donde cae el ancla: ahí se apunta la entity. */
  sceneId: string;
  /** Punto de referencia de cada hint del turno, ya dentro del tile. */
  anclas: Map<string, [number, number, number]>;
  fwd: [number, number, number];
}

/** DÓNDE CAE CADA HINT del turno, dentro del tile REALIZADO que contiene al
 *  jugador (el ancla). Es el tile activo al hablar o al cruzar un trigger, y
 *  en el despertar es el del sitio donde el jugador va a abrir los ojos —que
 *  el handler activa DESPUÉS de despachar—, no el de su muerte. Por eso la
 *  entity se apunta en la escena de ESE tile y no en `active_scene_id`: con
 *  el activo, la posición y el `scene_id` del ledger podían discrepar.
 *
 *  Un ancla fuera de todo tile realizado es fail-loud: hoy escribiría la
 *  entity en el vacío, y al reanudar saldría como «fuera del mundo». */
function colocacionDelTurno(
  state: NarrativeState,
  spawns: ReadonlyArray<Extract<Consequence, { type: "spawn_entity" }>>,
  cuerpos: readonly CuerpoDelTurno[],
  reparto: readonly number[],
  opts: DispatchOptions,
): ColocacionDelTurno {
  const base = toTuple(opts.playerPosition ?? [0, 0, 0]);
  const fwd = toTuple(opts.playerForward ?? [0, 0, -1]);
  const t = worldToTile(base[0], base[2]);
  const sceneId = state.sceneIdOfTile(t.tx, t.ty);
  if (!sceneId) {
    throw new Error(
      `dispatchConsequences: el jugador está en (${base[0]}, ${base[2]}), tile_${t.tx}_${t.ty}, ` +
        `que no está realizado: no hay suelo donde poner lo que el motor manda aparecer`,
    );
  }
  const rect = tileWorldRect(t.tx, t.ty);
  // Cada hint es un grupo: lo que cuelga del mismo ancla se mueve junto.
  const grupos = new Map<string, { ext: number; mitad: number }>();
  spawns.forEach((c, i) => {
    const hint = c.position_hint ?? "near_player";
    const g = grupos.get(hint) ?? { ext: 0, mitad: 0 };
    g.ext = Math.max(g.ext, Math.abs(reparto[i]));
    g.mitad = Math.max(g.mitad, mediaAnchura(cuerpos[i]));
    grupos.set(hint, g);
  });
  const anclas = new Map<string, [number, number, number]>();
  for (const [hint, g] of grupos) {
    const libre = anclaDelHint(hint, base, fwd);
    const dentro = anclaDentroDelTile(
      { x: libre[0], z: libre[2] },
      rect,
      { x: fwd[0], z: fwd[2] },
      g.ext,
      g.mitad + HOLGURA_ENTRE_SPAWNS_M,
    );
    anclas.set(hint, [dentro.x, libre[1], dentro.z]);
  }
  return { sceneId, anclas, fwd };
}

/** El punto de referencia de un hint, SIN el lateral del reparto y SIN acotar:
 *  `near_player` es jugador + forward × 5, `distant_*` ±50 m, y cualquier
 *  otro texto jugador + forward × 10. El lateral lo calcula
 *  `repartirEnElTurno` MIRANDO LA HUELLA de cada cosa (#524) y se suma
 *  después, sobre el ancla ya acotada: sumarlo antes de acotar llevaba dos
 *  cosas del mismo turno al mismo punto del borde. */
function anclaDelHint(
  hint: string,
  base: [number, number, number],
  fwd: [number, number, number],
): [number, number, number] {
  if (hint === "near_player") {
    return [base[0] + fwd[0] * 5, base[1] + fwd[1] * 5, base[2] + fwd[2] * 5];
  }
  const off = HINT_OFFSETS[hint];
  if (off) {
    return [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
  }
  return [base[0] + fwd[0] * 10, base[1] + fwd[1] * 10, base[2] + fwd[2] * 10];
}
