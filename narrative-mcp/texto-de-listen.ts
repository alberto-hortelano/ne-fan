/** El texto que devuelve `narrative_listen`: la petición serializada más las
 *  instrucciones del kind. Módulo PURO (sin `node:*`, sin estado): recibe los
 *  prompts ya cargados y devuelve la cadena exacta que lee el motor.
 *
 *  Vive fuera de `server.ts` para que el candado de tamaño
 *  (`nefan-core/test/el-texto-de-listen-tiene-techo.test.ts`) mida ESTE texto
 *  y no una copia: hasta la tanda BZ se componía inline en el handler de la
 *  tool, y un playtest vio el resultado pasar del tope de la tool MCP (el
 *  motor tuvo que leerlo desde fichero) sin que ningún test lo supiera.
 *
 *  El JSON va COMPACTO: la indentación eran ~4,5 KB por petición de escena
 *  que el modelo no necesita para leer la estructura. */

/** Los `.md` de `nefan-core/data/contract/prompts/` que acompañan a cada kind. */
export interface PromptsDeListen {
  tile: string;
  scene: string;
  worldRules: string;
  narrativeEvent: string;
  playerDeath: string;
  developWorld: string;
}

/** Nombres de fichero de cada prompt, para que server.ts y el candado carguen
 *  los mismos. */
export const FICHEROS_DE_PROMPTS: Record<keyof PromptsDeListen, string> = {
  tile: 'tile_instructions.md',
  scene: 'scene_instructions.md',
  worldRules: 'world_rules.md',
  narrativeEvent: 'narrative_event.md',
  playerDeath: 'player_death.md',
  developWorld: 'develop_world.md',
};

/** Petición de escena (siempre tile del mundo continuo): las instrucciones de
 *  TILE van delante de la referencia estándar de escena. */
export function textoDeEscena(worldState: unknown, p: PromptsDeListen): string {
  return (
    JSON.stringify({ kind: 'scene', world_state: worldState }) +
    '\n\n' + p.tile + '\n\n' + p.scene + '\n\n' + p.worldRules
  );
}

export interface EventoNarrativo {
  kind?: unknown;
  event_id?: unknown;
  speaker?: unknown;
  chosen_text?: unknown;
  free_text?: unknown;
  context?: unknown;
}

export function textoDeEvento(msg: EventoNarrativo, p: PromptsDeListen): string {
  const payload = JSON.stringify({
    kind: 'narrative_event',
    event_kind: msg.kind,
    event_id: msg.event_id,
    speaker: msg.speaker,
    chosen_text: msg.chosen_text,
    free_text: msg.free_text,
    context: msg.context,
  });
  return `Narrative event:\n${payload}\n\n${p.narrativeEvent}\n\n${p.worldRules}`;
}

export function textoDeMuerte(msg: { event_id?: unknown; context?: unknown }, p: PromptsDeListen): string {
  const payload = JSON.stringify({ kind: 'player_death', event_id: msg.event_id, context: msg.context });
  return `The player has died:\n${payload}\n\n${p.playerDeath}\n\n${p.worldRules}`;
}

export function textoDeMundo(
  ctx: { draft_text?: string; available_styles?: unknown } | undefined,
  p: PromptsDeListen,
): string {
  const payload = JSON.stringify({
    kind: 'develop_world',
    draft_text: ctx?.draft_text ?? '',
    available_styles: ctx?.available_styles ?? [],
  });
  return `World draft to develop:\n${payload}\n\n${p.developWorld}`;
}
