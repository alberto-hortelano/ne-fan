/** Scene format normalization — engine-agnostic, shared by every client.
 *
 *  The narrative engine emits scenes in "Map Format D": a tile (`biome` +
 *  declarative `ground`/`volumes`, from which the engine synthesises the
 *  `size`/`terrain` cell grid used for collision and seams) plus `entities`
 *  placed by `cell`/`footprint`. Renderers, however, want world
 *  coordinates in metres (`dimensions` + `objects[]`/`npcs[]` with
 *  `position`/`scale`). `formatDToWorld` is the single place that bridges the two
 *  so the logic does not live inside a specific client (CLAUDE.md: "lógica en
 *  nefan-core, clientes que solo pintan").
 *
 *  The input is TYPED (#782): `ExpandedScene`, the population its zod gate
 *  guarantees. Validation lives at the gate (`recordSceneLoaded` in the
 *  bridge, `escenaCargable` for a raw fixture), where the error still reaches
 *  whoever wrote the scene — not here, where it used to be repeated by hand
 *  and, for `h` and `shape`, silently tolerated. */

import { composeTilePlan, type TilePlan } from "./tile-plan.js";
import { tileWorldRect, TILE_MPC, type TileCoord, type WorldRect } from "./tile.js";
import type { TerrainGridData } from "./terrain-collision.js";
import { combatForHostileRole, type HostileCombat } from "../combat/hostiles.js";
import type { ExpandedScene } from "../contract/model-io/scene-schema.js";

/** Un objeto, edificio, prop, item o decor de la world scene: en METROS y con
 *  la BASE en `position[1]`. `name` es la etiqueta (lo que el jugador lee) y
 *  `description`, si el motor la declaró, la procedencia del arte (#238).
 *  `volume_id` dice qué volumen del plan ya lo pinta (sin él, billboard). */
export interface ObjetoEnElWire {
  id: string;
  position: [number, number, number];
  scale: [number, number, number];
  /** `tree` se pinta como `prop`: la categoría es de RENDER, no el kind. */
  category: "building" | "prop" | "item" | "decor";
  name: string;
  description?: string;
  volume_id?: string;
  shape?: "box" | "cylinder" | "sphere" | "cone";
}

/** Un personaje de la world scene. `combat` solo si el motor lo declaró
 *  `role:"hostile"` (lo deriva el core: `combatForHostileRole`); `role`,
 *  `style_ref` y `description` tal cual los declaró el motor.
 *  `position_declared` NO lo escribe `formatDToWorld`: lo pone el wire
 *  (`escenaConCombateVivo`) cuando sustituye `position` por la VIVA del save,
 *  y es lo que sigue midiendo el fail-loud de conversión celda→metro
 *  (`npcsFueraDelRect`). */
export interface NpcEnElWire {
  id: string;
  name: string;
  position: [number, number, number];
  combat?: HostileCombat;
  role?: string;
  style_ref?: string;
  description?: string;
  position_declared?: [number, number, number];
}

/** El contrato de RENDER: lo que devuelve `formatDToWorld`, lo que el bridge
 *  sirve (con las salidas encima: `EscenaServida`, protocol/messages.ts) y lo
 *  que el cliente pinta. CERRADA: ni índice ni `Record` — escribir mal un
 *  miembro no compila (candado de tipo al final del fichero). Hasta #378 era
 *  `Record<string, unknown>` y cada consumidor la abría con `as`.
 *
 *  Los miembros opcionales lo son porque el MOTOR los declara o no
 *  (`ground`, `volumes`, `vegetation_zones`, `scatter_*`, `biome`,
 *  `place_id`) o porque el plan puede no componerse (`__plan`, con sus
 *  avisos). `tile` y `world_rect` no lo son: toda escena vive en un tile del
 *  plano (#405). Los declarados
 *  viajan TAL CUAL (provenance, con el tipo del contrato de escena): lo que se
 *  pinta y colisiona es `__plan`, ya compuesto. */
export interface WorldScene {
  scene_id: string;
  scene_description: string;
  dimensions: { width: number; depth: number; height: number };
  world_rect: WorldRect;
  tile: TileCoord;
  /** Color de suelo de reserva cuando no hay atlas. */
  terrain: { color: [number, number, number] };
  /** El grid crudo, para la COLISIÓN de terreno (no para pintar). */
  terrain_grid: TerrainGridData;
  ground?: ExpandedScene["ground"];
  volumes?: ExpandedScene["volumes"];
  vegetation_zones?: ExpandedScene["vegetation_zones"];
  scatter_generators?: ExpandedScene["scatter_generators"];
  scatter_zones?: ExpandedScene["scatter_zones"];
  biome?: string;
  /** El lugar del world map que esta escena realiza (lo estampa el bridge). */
  place_id?: string;
  objects: ObjetoEnElWire[];
  npcs: NpcEnElWire[];
  /** Dónde aparece el jugador; `null` si la escena no declara entity player. */
  __player_start: { x: number; z: number } | null;
  /** El plan COMPUESTO (declarado + derivado), resuelto UNA vez aquí. */
  __plan?: TilePlan;
  __plan_warnings?: string[];
}

/** Una entity de la escena cargable, con el tipo que su gate garantiza. */
type EntityDeEscena = ExpandedScene["entities"][number];

/** Los kinds que se pintan como OBJETO (ni el jugador ni un NPC). */
type KindDeObjeto = Exclude<EntityDeEscena["kind"], "npc" | "player">;

/** `{[clave]: valor}` si el motor lo declaró; si no, `{}` (la clave no viaja).
 *  Es la regla única de «lo declarado que viaja tal cual» para los campos de
 *  texto opcionales. El vacío ya no llega: el zod exige texto no vacío en los
 *  tres (`role`, `style_ref`, `description`), y hasta #782 aquí se repetía esa
 *  comprobación con un `typeof` porque la entrada no tenía tipo. */
function textoDeclarado(clave: string, valor: string | undefined): Record<string, string> {
  return valor === undefined ? {} : { [clave]: valor };
}

/** Altura por defecto (METROS) cuando la entity no declara `h`. Alineada con
 *  los defaults de los volumes del blueprint (building wall_h 5 celdas =
 *  2.5 m, prop h 2 celdas = 1 m). Clave = kind (un tree emite category
 *  "prop" pero su altura sale de aquí). Compartida por ambos clientes vía
 *  formatDToWorld; el 2D la usa además para los spawns narrativos. */
export const KIND_DEFAULT_HEIGHT: Readonly<Record<KindDeObjeto, number>> = {
  building: 2.5,
  tree: 4,
  prop: 1,
  item: 0.5,
  decor: 0.5,
};

/** Techo duro de altura por entity (metros) — un `h` disparatado del LLM se
 *  recorta en vez de tumbar la escena. */
const MAX_ENTITY_HEIGHT_M = 20;

/** Huella EN CELDAS de lo que el motor spawnea a mitad de partida, por clase
 *  del effect `spawn_entity` (`npc | object | building | item`). Es el DEFECTO,
 *  no el tamaño: desde #532 la consequence puede declarar su `footprint` (en
 *  celdas, igual que una entity del tile) y entonces manda el declarado. Sin
 *  él se aplica el de la clase, y se aplica AQUÍ, en celdas, para que pase por
 *  la MISMA aritmética que la huella de una entity del tile (`huellaEnMetros`)
 *  y no por dos metros escritos a mano en otro proceso.
 *
 *  De dónde salen los números: `building` 8×8 celdas y `object` 3×3 son lo que
 *  el cliente venía inventando en `world/materializar-spawn.ts` (#489)
 *  traducido a celdas — los 4×4 m de siempre y 1,5×1,5 m, tres celdas enteras
 *  en vez de los 1,4 m que no eran múltiplo de nada. `npc` no está porque un
 *  personaje no es un AABB: colisiona por su radio, no por huella. */
export const FOOTPRINT_POR_DEFECTO: Record<string, readonly [number, number]> = {
  building: [8, 8],
  object: [3, 3],
  // `item` entra con #532, y su celda es la misma que su altura por defecto:
  // 1×1 celda = 0,5 m, el número de `KIND_DEFAULT_HEIGHT.item`. Lo que hace
  // que se pueda PISAR no es este tamaño sino su categoría (`aabbBloquea` solo
  // frena `building`/`prop`); esto solo dice cuánto abulta lo que se ve.
  item: [1, 1],
};

/** La huella colisionable de algo del mundo, EN METROS (XZ), desde su huella en
 *  CELDAS. Es la conversión que hacía `formatDToWorld` en línea para las
 *  entities del tile (`[w * mpc, h, h * mpc]`) y que el cliente NO hacía para
 *  los spawns de runtime: los inventaba en metros, con dos literales, y así el
 *  mismo cofre medía una cosa puesto por la escena y otra puesto por el motor
 *  (#489).
 *
 *  `footprintCells` es la del contrato cuando la hay (entity de escena); sin
 *  ella se aplica la del kind (`FOOTPRINT_POR_DEFECTO`, spawn de runtime), y un
 *  kind sin defecto es fail-loud: nadie inventa un tamaño en silencio. La
 *  ALTURA no entra — la colisión es solo XZ (CLAUDE.md), y quien pinte volumen
 *  la pide aparte a `KIND_DEFAULT_HEIGHT`. */
export function huellaEnMetros(
  kind: string,
  footprintCells?: readonly [number, number] | null,
  mpc: number = TILE_MPC,
): { x: number; z: number } {
  const celdas = footprintCells ?? FOOTPRINT_POR_DEFECTO[kind];
  if (!celdas) {
    throw new Error(
      `huellaEnMetros: "${kind}" no declara footprint y no tiene huella por defecto ` +
        `(hay para ${Object.keys(FOOTPRINT_POR_DEFECTO).join(" | ")})`,
    );
  }
  return { x: celdas[0] * mpc, z: celdas[1] * mpc };
}

/** Chars del grid que bloquean el paso: solo "w", el agua que rasteriza
 *  `expandScenePrimitives` desde `ground` (el puente "b" es transitable). Los
 *  MUROS no son chars del grid: son volúmenes del plan, y su solidez sale de
 *  `planCollisionGrid` (#407 retiró el char de muro, que nadie producía).
 *  ÚNICA fuente de solidez del terreno — nadie la declara por escena: la fija
 *  el engine. Si algún día hace falta un vado, irá como propiedad del rasgo
 *  `water` de `ground`, no como excepción sobre un char. */
export const DEFAULT_SOLID_CHARS: readonly string[] = ["w"];

/** Convierte una escena CARGABLE a coordenadas de mundo. Solo convierte: la
 *  entrada ya es `ExpandedScene` (#782), así que lo que el zod garantiza —kinds,
 *  celdas finitas, huellas enteras, nombres, `shape` y `h` válidas, el `tile`—
 *  no se vuelve a comprobar aquí. Hasta #782 la entrada era un `Record` y esta
 *  función expandía por dentro las fixtures crudas y revalidaba a mano cada
 *  entity con un rasero más laxo que el zod: una `shape` inventada o una `h`
 *  negativa caían al defecto EN SILENCIO. Quien tiene una escena cruda la pasa
 *  antes por `escenaCargable` (scene/escena-cargable.ts); el bridge ya la tiene
 *  tipada desde `recordSceneLoaded`. */
export function formatDToWorld(escena: ExpandedScene): WorldScene {
  const { cols, rows, meters_per_cell: mpc } = escena.size;
  // Rect mundial de la escena — ÚNICA fuente del origen, y sale del tile:
  // toda escena vive en su rect global del plano continuo (#405).
  const tileCoord: TileCoord = { tx: escena.tile.tx, ty: escena.tile.ty };
  const worldRect = tileWorldRect(tileCoord.tx, tileCoord.ty);

  // El PLAN del tile, compuesto UNA vez y resuelto en el wire: de él salen la
  // geometría 3D, la colisión del jugador y la de los NPCs. Quien lo consume
  // lo LEE — nadie vuelve a derivar (ver src/scene/tile-plan.ts).
  const { plan, representedBy, warnings } = composeTilePlan(escena);

  const objects: ObjetoEnElWire[] = [];
  const npcs: NpcEnElWire[] = [];
  let playerStart: { x: number; z: number } | null = null;

  for (const ent of escena.entities) {
    const [c, r] = ent.cell;
    const [w, h] = ent.footprint;
    // Centro del footprint en coordenadas mundo GLOBALES (esquina NW del
    // rect + offset de celda).
    const x = worldRect.minX + (c + w / 2) * mpc;
    const z = worldRect.minZ + (r + h / 2) * mpc;

    if (ent.kind === "player") {
      playerStart = { x, z };
      continue;
    }
    if (ent.kind === "npc") {
      const { role, style_ref: styleRef, description } = ent;
      // Hostilidad → combate, DERIVADO aquí. El motor declara `role:"hostile"`
      // y el core pone los números (`combatForHostileRole`): así la escena
      // inicial y el spawn en runtime producen el MISMO bloque, y el cliente
      // —que solo pinta— no decide nada sobre el balance. Sin esto, un NPC
      // hostil llegaba como cualquier aldeano y no había con quién pelear.
      const combat = combatForHostileRole(role);
      npcs.push({
        id: ent.id,
        name: ent.name,
        position: [x, 0, z],
        ...(combat ? { combat } : {}),
        // Rol del mundo (guard/merchant/…) y ref de personaje elegida por el
        // motor (style_ref, catálogo world.style_refs.characters): el cliente
        // deriva de ellos la ref del skin (npcSkinStyleRef) — deben viajar o
        // el skin en partida y el del batch de estilo divergen de clave.
        ...textoDeclarado("role", role),
        ...textoDeclarado("style_ref", styleRef),
        ...textoDeclarado("description", description),
      });
      continue;
    }
    // building / prop / tree / item / decor. Altura en metros: la declarada
    // (el zod ya exige que sea finita y positiva), con el techo duro; sin
    // ella, la del kind.
    const entH = ent.h !== undefined ? Math.min(ent.h, MAX_ENTITY_HEIGHT_M) : KIND_DEFAULT_HEIGHT[ent.kind];
    // La huella en metros sale de la MISMA función que la de un spawn de
    // runtime: un cofre de 3 celdas mide 1,5 m lo ponga la escena o lo ponga el
    // motor a mitad de partida (#489).
    const huella = huellaEnMetros(ent.kind, ent.footprint, mpc);
    // Forma: la declarada; si no hay, los árboles son redondos por defecto.
    const shape = ent.shape ?? (ent.kind === "tree" ? "cylinder" : undefined);
    objects.push({
      id: ent.id,
      position: [x, 0, z],
      scale: [huella.x, entH, huella.z],
      // tree se pinta como prop. decor conserva su categoría — puramente
      // estético, sin colisión ni interacción (el cliente solo bloquea
      // building/prop).
      category: ent.kind === "tree" ? "prop" : ent.kind,
      // El mismo par que lleva un NPC: `name` es la ETIQUETA (lo que el
      // jugador lee al mirarlo) y `description`, solo si el motor la declaró,
      // la PROCEDENCIA. Hasta #238 aquí se escribía `description: ent.name` y
      // la declarada se tiraba en silencio —el contrato la invitaba en
      // cualquier entity y el wire la perdía para todo lo que no fuera NPC.
      name: ent.name,
      ...textoDeclarado("description", ent.description),
      // Qué volumen del plan REPRESENTA a esta entity. Con él, el cliente la
      // pinta UNA vez (como volumen del greybox, que además colisiona) en vez
      // de dibujar encima un billboard que se atraviesa. Ausente = no está en
      // el plan (spawn dinámico, item): se pinta como billboard.
      ...(representedBy[ent.id] ? { volume_id: representedBy[ent.id] } : {}),
      ...(shape ? { shape } : {}),
    });
  }

  return {
    scene_id: escena.scene_id,
    scene_description: escena.scene_description,
    dimensions: { width: cols * mpc, depth: rows * mpc, height: 3 },
    // Coordenadas del plano continuo: rect mundial del tile y sus coords de
    // grid. El cliente ancla capas/colisión aquí.
    world_rect: worldRect,
    tile: tileCoord,
    terrain: { color: [0.18, 0.22, 0.14] },
    // El grid de terreno crudo (río/camino/puente/piedra…): el cliente lo
    // consume para la COLISIÓN de terreno (createTerrainCollider), no para
    // pintar — el suelo se pinta desde `ground`. `terrain: { color }` sigue
    // siendo el fallback de color cuando esto no está.
    terrain_grid: {
      grid: escena.terrain,
      cols,
      rows,
      meters_per_cell: mpc,
      // Esquina NW del grid en coordenadas mundo (plano continuo).
      origin: [worldRect.minX, worldRect.minZ] as [number, number],
      // Chars que bloquean movimiento (el agua; los muros son volúmenes del
      // plan). Los consume `createTerrainCollider`; el bridge (sim-collision)
      // lee los mismos.
      solid_chars: [...DEFAULT_SOLID_CHARS],
    },
    // Plan del tile DECLARADO (rasgos de suelo + volúmenes tipados), tal cual
    // lo mandó el motor: es provenance, no la fuente de render. Lo que se
    // pinta y lo que colisiona es `__plan`, que además trae lo derivado.
    ground: escena.ground,
    volumes: escena.volumes,
    // La vegetación de masa DECLARADA (la plantada está en `__plan`): viaja
    // como provenance, y es lo que el banco lee para saber qué pidió el motor.
    vegetation_zones: escena.vegetation_zones,
    // Scatter declarativo (vista fps): passthrough — lo valida el gate de
    // escena (`parseScatter`, fail-loud con ruta).
    scatter_generators: escena.scatter_generators,
    scatter_zones: escena.scatter_zones,
    biome: escena.biome,
    // El lugar que realiza (lo estampa el bridge sobre el crudo): hasta #378
    // el cliente lo sacaba del Format D ENTERO, que viajaba dentro de la world
    // scene (el 44 % de los bytes de un tile) para leer esta clave.
    ...(escena.place_id !== undefined ? { place_id: escena.place_id } : {}),
    objects,
    npcs,
    // Metadatos para el cliente — el renderer los ignora.
    __player_start: playerStart,
    // El plan COMPUESTO (declarado + derivado del esquema). Viaja resuelto a
    // propósito: si cada consumidor lo derivara por su cuenta, divergirían en
    // los argumentos y el bosque del cliente no sería el del bridge.
    __plan: plan ?? undefined,
    __plan_warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// CANDADO DE TIPO (#378): `WorldScene` es una interfaz cerrada, así que un
// miembro mal escrito no compila. Si esta línea deja de dar error, alguien le
// ha puesto un índice o la ha vuelto a abrir — `npm run build` se pone rojo.
// @ts-expect-error — `position_declred` no es un miembro del npc: eso es lo que se prueba
type _CandadoDeTipoDelNpc = NpcEnElWire["position_declred"];
// @ts-expect-error — ni `scene_descrption` de la escena: un índice `[k: string]` lo dejaría compilar
type _CandadoDeTipoDeLaEscena = WorldScene["scene_descrption"];
