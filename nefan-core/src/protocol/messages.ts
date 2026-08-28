/** Protocol messages between the frontend and nefan-core logic. */
import type { UiTheme } from "../games/ui-theme.js";

import type { Vec3, CombatEvent, EnemyPersonality } from "../types.js";
import type { Edge } from "../world-map/types.js";
import type {
  Consequence,
  ConsequenceEffect,
  SessionData,
  SessionMetadata,
} from "../narrative/types.js";

// ── Frontend → Logic ──

export interface InputMessage {
  type: "input";
  delta: number;
  inputs: {
    playerPosition: Vec3;
    playerForward: Vec3;
    playerMoving: boolean;
    attackRequested?: boolean;
    attackType?: string;
  };
}

export interface LoadRoomMessage {
  type: "load_room";
  roomId: string;
  dimensions?: { width: number; depth: number };
  enemies: {
    id: string;
    position: Vec3;
    health: number;
    weaponId: string;
    personality: EnemyPersonality;
  }[];
}

export interface RespawnMessage {
  type: "respawn";
  /** Punto de reaparición en coordenadas globales (el cliente elige un punto
   *  libre cercano en el tile actual). Ausente = legacy (0,0,4). */
  pos?: Vec3;
}

export interface PingMessage {
  type: "ping";
}

export interface ListSessionsMessage {
  type: "list_sessions";
  requestId: string;
}

export interface StartSessionMessage {
  type: "start_session";
  requestId: string;
  gameId: string;
  appearance?: { model_id: string; skin_path: string };
  /** Estilo visual elegido en el título; ausente = el por defecto del juego.
   *  Queda CONGELADO en el save al crear la sesión. */
  styleId?: string;
  /** Modo de render del mundo 2D elegido en el título: "image" (el modelo de
   *  imagen repinta cada blueprint — gasta créditos) | "vector" (el mundo se
   *  ve con los blueprints compuestos del plan del motor narrativo — gratis).
   *  Ausente = "image". Congelado en el save: mezclar tiles pintados y
   *  vectoriales rompe la continuidad visual entre vecinos. */
  renderMode?: string;
  /** Modo de imagen de PERSONAJES: "image" (skins IA por descripción) |
   *  "vector" (base y_bot). Ausente = sigue a renderMode. */
  characterMode?: string;
}

export interface ResumeSessionMessage {
  type: "resume_session";
  requestId: string;
  sessionId: string;
}

export interface DeleteSessionMessage {
  type: "delete_session";
  requestId: string;
  sessionId: string;
}

/** El jugador ha ENTRADO en la partida: ya se ha vestido Y el mundo está
 *  pintado. Con esto el bridge la establece en disco — antes no existía
 *  (#279): un arranque que falla después del `ok:true` no deja una tarjeta de
 *  partida que nadie jugó.
 *
 *  Va SIN respuesta a propósito: nadie lo espera, y contestarlo invitaría a
 *  meter un round-trip más en el arranque. No es el mensaje de «guardar la
 *  partida» resucitado (retirado en #245, con candado en
 *  `campos-retirados-no-vuelven`): aquel era una ORDEN de guardar que no
 *  mandaba nadie; este es un HECHO sobre el cliente, y qué hacer con él lo
 *  decide el bridge. */
export interface SessionEnteredMessage {
  type: "session_entered";
  /** La partida en la que ha entrado. Un id que ya no es el de la sesión
   *  activa (takeover) se descarta con aviso: el ack es de otra. */
  sessionId: string;
}

/** Cambia el modo de render de una partida, en cualquier sentido
 *  (image⇄vector). Bajar a vector no borra lo pintado: el cliente conserva
 *  las imágenes existentes y solo deja de generar nuevas. El save puede no
 *  ser la sesión activa — se parchea en disco desde el título. */
export interface SetRenderModeMessage {
  type: "set_render_mode";
  requestId: string;
  sessionId: string;
  renderMode: "image" | "vector";
  /** Qué se cambia: escenarios (render_mode) o personajes (character_mode).
   *  Ausente = "scenes" (compat). */
  facet?: "scenes" | "characters";
}

export interface DialogueChoiceMessage {
  type: "dialogue_choice";
  requestId?: string;
  eventId: string;
  choiceIndex: number;
  freeText?: string;
  speaker: string;
  /** Id de la entidad que dijo la línea a la que se responde (lo devuelve el
   *  cliente tal cual lo recibió en el efecto): mantiene la conversación
   *  anclada al mismo NPC cuando hay homónimos. */
  speakerId?: string;
  chosenText: string;
}

/** Crear un mundo de usuario: el borrador (textarea o archivo .md/.txt) se
 *  desarrolla con el motor narrativo contra la plantilla y el bridge escribe
 *  data/games/user_{slug}/. Respuesta: game_created. */
export interface CreateGameMessage {
  type: "create_game";
  requestId: string;
  draftText: string;
}

export interface ListGamesMessage {
  type: "list_games";
  requestId: string;
}

/** Pre-generación del mundo de un juego desde el título: el bridge crea una
 *  sesión EFÍMERA, corre el bootstrap + anillo 3×3 + places clave con el
 *  motor narrativo y persiste el snapshot en
 *  data/games/{id}/world/tile.json. Respuesta game_generated al ENCOLAR; el
 *  progreso y el final viajan por narrative_status kind "game_gen". */
export interface GenerateGameMessage {
  type: "generate_game";
  requestId: string;
  gameId: string;
}

/** The player walked into a world-map place. The bridge realizes the place's
 *  low-level scene on demand (lazy realize): if it already has a scene it is
 *  re-broadcast, otherwise the narrative engine generates one. */
export interface PlayerEnteredPlaceMessage {
  type: "player_entered_place";
  placeId: string;
}

/** Petición de un tile del plano continuo. `prefetch` = el jugador se acerca
 *  al borde (generar en segundo plano, sin activar); `blocking` = está pegado
 *  al borde esperando. Si el tile ya existe, el bridge lo re-difunde al
 *  instante sin LLM (re-render al volver). */
export interface RequestTileMessage {
  type: "request_tile";
  tx: number;
  ty: number;
  reason: "prefetch" | "blocking";
  /** Borde del tile ACTUAL por el que se acerca/espera el jugador (para el
   *  velo direccional y el `entry` del motor). */
  edge?: Edge;
}

/** Alta ADITIVA de combatientes en el sim (enemigos de un tile nuevo). No
 *  resetea nada: los combatientes de otros tiles siguen vivos. */
export interface AddCombatantsMessage {
  type: "add_combatants";
  enemies: {
    id: string;
    position: Vec3;
    health: number;
    weaponId: string;
    personality: EnemyPersonality;
  }[];
}

/** Salida que el bridge adjunta a toda escena difundida (enrichSceneWithExits,
 *  derivada de los links del world map). El cliente la usa para el TravelPanel
 *  y para la transición continua al cruzar un borde. */
export interface SceneExit {
  place_id: string;
  name: string;
  link_kind: string;
  travel_hours?: number;
  description?: string;
  /** Lado de ESTA escena donde está la salida; ausente si no se pudo resolver. */
  edge?: Edge;
}

/** The player walked up to an entity (NPC) and pressed the interact key. The
 *  bridge reports it to the narrative engine, which replies with consequences
 *  (typically a show_dialogue effect). */
export interface InteractEntityMessage {
  type: "interact_entity";
  entityId: string;
  entityName: string;
}

export type ClientMessage =
  | InputMessage
  | LoadRoomMessage
  | RespawnMessage
  | PingMessage
  | ListSessionsMessage
  | StartSessionMessage
  | ResumeSessionMessage
  | DeleteSessionMessage
  | SessionEnteredMessage
  | SetRenderModeMessage
  | DialogueChoiceMessage
  | CreateGameMessage
  | ListGamesMessage
  | GenerateGameMessage
  | GetWorldSnapshotMessage
  | RecordStyleApplicationMessage
  | PlayerEnteredPlaceMessage
  | RequestTileMessage
  | AddCombatantsMessage
  | InteractEntityMessage;

// ── Logic → Frontend ──

export interface StateUpdateMessage {
  type: "state_update";
  events: CombatEvent[];
  playerHp: number;
  enemies: {
    id: string;
    hp: number;
    state: string;
    alive: boolean;
    pos?: { x: number; y: number; z: number };
    forward?: { x: number; y: number; z: number };
    attackType?: string;
  }[];
  /** Vida ambiental: NPCs conducidos por el NpcBehaviorSystem del sim.
   *  Ausente si la sesión no tiene behavior system (clientes viejos ignoran
   *  el campo). El cliente actualiza pos/forward de sus entidades por id; su
   *  tracker de movimiento dispara la anim walk/run solo. */
  npcs?: {
    id: string;
    pos: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
    moving: boolean;
    /** true → anim run (huida); false → walk. */
    run: boolean;
    /** Animación one-shot pedida (p. ej. "quick" como amenaza del guardia). */
    anim?: string;
    /** Modo del FSM (idle/wander/goto/visit/flee/intervene/react) — trazas. */
    state: string;
  }[];
}

export interface PongMessage {
  type: "pong";
}

export interface SessionsListedMessage {
  type: "sessions_listed";
  requestId: string;
  sessions: SessionMetadata[];
}

export interface SessionStartedMessage {
  type: "session_started";
  requestId: string;
  ok: boolean;
  sessionId?: string;
  gameId?: string;
  isResume?: boolean;
  state?: SessionData;
  scene?: Record<string, unknown>;
  /** Tema de la UI de juego del estilo de la sesión, RECALCULADO del
   *  style.json vigente en start Y en resume (misma política que
   *  world.style_refs: retocar la paleta de un pack se ve al reanudar).
   *  NO se persiste en el save ni entra en `world`: `serializeForLlm` manda
   *  `world` entero al modelo en cada turno, y una paleta ahí sería coste y
   *  ruido puros. Ausente = tema base. */
  uiTheme?: UiTheme;
  error?: string;
}

export interface NarrativeEventMessage {
  type: "narrative_event";
  /** EL SELLO: de qué partida es este evento. Lo estampa un solo escritor
   *  (`broadcastNarrative`) con la sesión que el bridge tiene activa AL
   *  EMITIR, y por eso es requerido y no opcional — un evento sin sello no es
   *  expresable. `""` = sin partida (el bridge difundiendo desde el título, o
   *  una pre-generación de mundo) y es un valor legítimo, no un hueco.
   *
   *  Existe porque el broadcast va a TODOS los suscriptores y hasta #282 no
   *  decía de quién era: el cliente que acababa de abandonar una partida
   *  instalaba igual el tile que esa partida había pedido, y el intento
   *  siguiente heredaba su mundo. «De quién es» no era expresable. */
  sessionId: string;
  eventId: string;
  consequences: Consequence[];
  effects: ConsequenceEffect[];
}

/** Lifecycle hint for long-running narrative work so clients can show a loader.
 *  Phase: "generating" (LLM dispatched, awaiting), "ready" (scene applied),
 *  "error" (LLM call failed — surfaced verbatim, no silent placeholder). */
export interface NarrativeStatusMessage {
  type: "narrative_status";
  /** El mismo sello que el evento, y por el mismo escritor.
   *
   *  Desde #312 el cliente lo REPARTE en vez de ignorarlo: `destinoDeStatus`
   *  (`src/session/session-facets.ts`) manda lo ajeno que es `phase:"error"`
   *  al registro de errores —callarlo sería el silencio que prohíbe el
   *  fail-loud de esta casa— y descarta el resto, que es lo que llegaba a
   *  teletransportar al jugador de la partida viva con su `spawn`.
   *
   *  Lo que este campo dice EXACTAMENTE, y hay que leerlo así o el filtro se
   *  entiende mal: «la sesión que el bridge tenía activa al emitir», no «la
   *  que pidió el trabajo» (ver `bridge/ws-server.ts`). Por eso la
   *  pre-generación de mundo (`kind:"game_gen"`) se reparte SIN mirarlo. */
  sessionId: string;
  /** "progress" = latido del motor narrativo mientras genera (una tool MCP
   *  llamada, un paso dado): resetea el timeout de inactividad de ai_server
   *  y alimenta el texto del loader del cliente. */
  phase: "generating" | "progress" | "ready" | "error";
  /** "game_gen" = pre-generación de mundo desde el título (generate_game):
   *  no toca velos de tile ni loaders de escena — alimenta la barra de
   *  progreso de la tarjeta del juego. */
  kind: "scene" | "consequences" | "tile" | "game_gen";
  message?: string;
  elapsedMs?: number;
  /** Tile al que se refiere el status (kind "tile") — el cliente pinta el
   *  velo/notificación direccional con esto. */
  tile?: { tx: number; ty: number };
  /** Borde del tile ACTUAL del jugador hacia el que se genera/completó. */
  edge?: Edge;
  /** Lugar del world map al que se refiere el status (viaje por «Salidas»):
   *  el cliente atribuye con él el acuse y el error al viaje que pidió, en vez
   *  de adivinar por orden de llegada. */
  placeId?: string;
  /** Cómo entró ese viaje en la cola de generación del bridge. Observacional:
   *  "duplicate" = hay un job gemelo en vuelo o en cola y este caller espera
   *  SU entrega. Va al ledger de viaje del cliente — un cuelgue con
   *  "duplicate" apunta a la cola; con "queued", al motor. */
  enqueued?: "queued" | "duplicate" | "promoted";
  /** De dónde salió la escena que acompaña a este status (`ready`):
   *  "engine" = el motor la acaba de generar y el bridge la ha rasterizado
   *  AHORA; "cache" = ya estaba en la sesión y se re-difunde sin LLM;
   *  "snapshot" = viene del mundo pre-generado del juego. Observacional: el
   *  cliente lo apunta en su episodio de tile. Sin él, una generación viva y
   *  un HIT de caché son indistinguibles desde fuera, que es justo lo que el
   *  guion 05 afirma estar probando. */
  source?: "engine" | "cache" | "snapshot";
  /** Dónde debe APARECER el jugador cuando la escena queda lista (viaje a un
   *  place anclado del plano continuo), en metros mundo. El cliente es dueño
   *  de su posición —la reporta en `sim_input`—, así que el bridge la PIDE en
   *  el `ready` en vez de escribirla. Ausente = el jugador no se mueve. */
  spawn?: { x: number; z: number };
}

export interface GamesListedMessage {
  type: "games_listed";
  requestId: string;
  /** Presente solo si el listado NO se pudo hacer (instalación rota: el
   *  directorio de juegos no existe). `games` y `styles` llegan vacíos, y el
   *  cliente RECHAZA con este motivo en vez de enseñar «no hay mundos» —que
   *  sería mentira— o de quedarse esperando los 30 s del timeout de request,
   *  que era lo que pasaba cuando el handler lanzaba y nadie contestaba. */
  error?: string;
  games: Array<{
    game_id: string;
    title: string;
    description: string;
    /** Estilo visual por defecto del juego (el jugador puede cambiarlo). */
    style_id: string;
    /** Resumen del mundo (~1.200 chars) — la tarjeta puede mostrar un extracto. */
    world_brief: string;
    /** Etiquetas temáticas del mundo ([] = sin declarar, compatible con
     *  cualquier estilo). Filtran el selector de estilos. */
    tags: string[];
    /** Estado del contenido pre-generado (data/games/{id}/world/tile.json):
     *  "ready" = snapshot vigente (arranque instantáneo), "stale" = world.md
     *  cambió desde la generación, "missing" = nunca generado. */
    generation: "ready" | "stale" | "missing";
    /** Estilos aplicados al juego (batch de assets estilizados): "ready" =
     *  vigente, "stale" = el mundo se regeneró/editó después. */
    styles_applied: Array<{ style_id: string; status: "ready" | "stale" }>;
  }>;
  /** Estilos disponibles para el selector; cover_url es relativo y se
   *  resuelve contra el servicio que sirve GET /styles/{id}/{file}
   *  (SERVICES["world-state"] hoy; asset-store tras F2). */
  styles: Array<{
    style_id: string;
    name: string;
    description: string;
    cover_url?: string;
    /** Etiquetas temáticas del estilo: el selector filtra además por
     *  compatibilidad con las del juego (styleCompatibleWithGame). */
    tags: string[];
    /** Tema de la UI de juego del estilo, ya resuelto sobre el base: el
     *  selector tiñe con él la tarjeta del estilo. */
    ui_theme: UiTheme;
  }>;
}

export interface GameCreatedMessage {
  type: "game_created";
  requestId: string;
  ok: boolean;
  gameId?: string;
  title?: string;
  error?: string;
}

/** Lee el snapshot de mundo pre-generado de un juego más su vocabulario
 *  canónico — lo consume el batch de "aplicar estilo" del título para
 *  computar celdas de atlas y roster de skins. */
export interface GetWorldSnapshotMessage {
  type: "get_world_snapshot";
  requestId: string;
  gameId: string;
}

export interface WorldSnapshotMessage {
  type: "world_snapshot";
  requestId: string;
  ok: boolean;
  /** "ready" = snapshot devuelto; "stale"/"missing" = snapshot null (generar
   *  el mundo primero — el batch de estilo cuelga del contenido vigente). */
  status?: "ready" | "stale" | "missing";
  snapshot?: Record<string, unknown> | null;
  vocabulary?: Record<string, unknown> | null;
  error?: string;
}

/** Persiste el registro de una aplicación de estilo (el bridge es el único
 *  escritor del directorio del juego). El batch del cliente lo envía al
 *  terminar; el registro alimenta los chips del título y la regeneración. */
export interface RecordStyleApplicationMessage {
  type: "record_style_application";
  requestId: string;
  /** StyleApplicationRecord completo — validado con zod en el bridge. */
  record: Record<string, unknown>;
}

export interface StyleApplicationRecordedMessage {
  type: "style_application_recorded";
  requestId: string;
  ok: boolean;
  error?: string;
}

/** Respuesta a generate_game: llega al ENCOLAR el job (ok:false si el juego o
 *  la vista no validan). La finalización real viaja por narrative_status
 *  kind "game_gen" (phase ready|error). */
export interface GameGeneratedMessage {
  type: "game_generated";
  requestId: string;
  ok: boolean;
  gameId?: string;
  /** Resultado del encolado ("queued" | "duplicate" | "promoted"). */
  queued?: string;
  error?: string;
}

export interface SessionDeletedMessage {
  type: "session_deleted";
  requestId: string;
  ok: boolean;
}

export interface RenderModeSetMessage {
  type: "render_mode_set";
  requestId: string;
  ok: boolean;
  error?: string;
  /** Eco de lo aplicado (solo con ok:true) — evita que el cliente tenga que
   *  releer el save para saber qué quedó. */
  facet?: "scenes" | "characters";
  renderMode?: "image" | "vector";
}

/** Push a TODOS los clientes suscritos a la sesión cuando cambia el modo de
 *  render (otro cliente de la misma sesión debe reaccionar en caliente). */
export interface RenderModeChangedMessage {
  type: "render_mode_changed";
  sessionId: string;
  facet: "scenes" | "characters";
  renderMode: "image" | "vector";
}

export type ServerMessage =
  | StateUpdateMessage
  | PongMessage
  | SessionsListedMessage
  | SessionStartedMessage
  | NarrativeEventMessage
  | NarrativeStatusMessage
  | GamesListedMessage
  | GameCreatedMessage
  | GameGeneratedMessage
  | WorldSnapshotMessage
  | StyleApplicationRecordedMessage
  | SessionDeletedMessage
  | RenderModeSetMessage
  | RenderModeChangedMessage;

/** Un mensaje de difusión TAL COMO LO ESCRIBE quien lo emite: sin el sello de
 *  sesión, que pone el único escritor que hay (`broadcastNarrative`).
 *
 *  Es DISTRIBUTIVA a propósito (`T extends unknown ? … : never`): un `Omit`
 *  liso sobre la unión la colapsa en un objeto con los campos comunes y el
 *  discriminante deja de estrechar, así que los 23 literales de los emisores
 *  dejarían de comprobarse. Así siguen siendo la misma unión discriminada, un
 *  campo más corta.
 *
 *  Por qué el sello no lo escribe cada emisor: son 23 llamadas repartidas por
 *  ocho ficheros y basta olvidarse de UNA para que el cliente tire un tile
 *  bueno. Aquí el tipo obliga: quien difunda no puede poner el sello (excess
 *  property) y `broadcastNarrative` no puede no ponerlo (el campo es
 *  requerido en `ServerMessage`). */
export type SinSelloDeSesion<T> = T extends unknown ? Omit<T, "sessionId"> : never;
