/** Casar el `speaker` de una línea de diálogo con la entidad que la dice.
 *
 *  El motor narrativo emite un NOMBRE, no un id — y así debe seguir: el
 *  prompt del contrato ya le exige reusar el nombre de un NPC presente
 *  (`data/contract/prompts/narrative_event.md`), obligarle además a copiar
 *  un id opaco solo añadiría un modo de fallo. La correspondencia la hace el
 *  servidor, que tiene el registro completo de entidades.
 *
 *  Con la identidad resuelta, el cliente puede enseñar al personaje mientras
 *  habla: su retrato sale del mismo prompt de skin que su sprite.
 *
 *  Módulo PURO: se testea con arrays literales. */

import type { EntityRecord } from "./types.js";

export interface ResolvedSpeaker {
  /** Id de la EntityRecord. */
  id: string;
  /** Descripción con la que se generan sus imágenes (misma identidad que usa
   *  el pipeline de sprites/hero). */
  skinPrompt: string;
  /** Ref de personaje del style pack elegida por el motor, si la declaró. */
  styleRef?: string;
}

/** Minúsculas, sin diacríticos ni puntuación: "Marta la Herrera" y
 *  "marta la herrera," son la misma persona. */
function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, "")
    .trim();
}

function describe(record: EntityRecord): ResolvedSpeaker {
  const data = record.data as { description?: unknown; name?: unknown; style_ref?: unknown };
  const desc = typeof data.description === "string" && data.description ? data.description : "";
  const name = typeof data.name === "string" && data.name ? data.name : "";
  return {
    id: record.id,
    // Mismo orden de preferencia que usa el cliente al pedir la skin de un
    // NPC: descripción, nombre, id. Si divergiera, el retrato y el sprite
    // serían dos personajes distintos.
    skinPrompt: desc || name || record.id,
    ...(typeof data.style_ref === "string" && data.style_ref ? { styleRef: data.style_ref } : {}),
  };
}

/**
 * Cascada de resolución:
 *  1. la entidad con la que el jugador está interactuando, si su nombre
 *     coincide o si la línea no trae hablante utilizable;
 *  2. nombre exacto — con dos homónimos gana el de la escena activa y, en
 *     empate, el registrado más tarde (el recién spawneado suele ser el que
 *     habla);
 *  3. nombre normalizado;
 *  4. `null`: narrador, voz en off o un nombre que el modelo se inventó. No
 *     se adivina una entidad — el cliente degrada a un retrato genérico.
 */
export function resolveSpeaker(
  entities: readonly EntityRecord[],
  activeSceneId: string,
  speaker: string,
  hintId?: string,
): ResolvedSpeaker | null {
  const npcs = entities.filter((e) => e.type === "npc");
  const hinted = hintId ? npcs.find((e) => e.id === hintId) : undefined;
  const wanted = normalize(speaker);

  if (hinted) {
    const hintedName = normalize(String((hinted.data as { name?: unknown }).name ?? ""));
    if (!wanted || wanted === "?" || hintedName === wanted) return describe(hinted);
  }
  if (!wanted) return null;

  const best = (matches: EntityRecord[]): EntityRecord | undefined => {
    if (matches.length <= 1) return matches[0];
    const here = matches.filter((e) => e.scene_id === activeSceneId);
    return (here.length ? here : matches)[(here.length ? here : matches).length - 1];
  };

  const exact = best(npcs.filter((e) => String((e.data as { name?: unknown }).name ?? "") === speaker));
  if (exact) return describe(exact);

  const loose = best(npcs.filter((e) => normalize(String((e.data as { name?: unknown }).name ?? "")) === wanted));
  return loose ? describe(loose) : null;
}
