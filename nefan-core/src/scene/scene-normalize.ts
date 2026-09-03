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
 *  Fail-loud: a malformed Format D entity throws rather than being silently
 *  dropped. A payload that is NOT Format D is returned verbatim (an
 *  already-resolved world scene, e.g. a `change_scene` payload). */

import { expandScenePrimitives, hasUnexpandedPrimitives } from "./scene-expand.js";
import { composeTilePlan } from "./tile-plan.js";
import { tileWorldRect } from "./tile.js";
import { combatForHostileRole } from "../combat/hostiles.js";

/** The world-coordinate scene shape a renderer consumes. Loose by design — the
 *  renderer reads a known subset and ignores the rest (e.g. `__player_start`,
 *  `__format_d`). */
export type WorldScene = Record<string, unknown>;

type FormatDEntity = {
  id: string;
  kind: string;
  name: string;
  cell: [number, number];
  footprint: [number, number];
  /** Pista de forma para el render (box|cylinder|sphere|cone). Opcional; el
   *  cliente la usa como geometría del volumen, en vez de caer a caja. */
  shape?: string;
  /** Altura en METROS (no en celdas — el footprint sí va en celdas). Opcional;
   *  sin ella se aplica el default por kind (KIND_DEFAULT_HEIGHT). */
  h?: number;
  /** Lo que el motor declara de CUALQUIER entity además de su etiqueta:
   *  `description` es el texto exacto que se le dio al modelo —lo que la
   *  entity PARECE, no lo que el jugador lee (eso es `name`)— y viaja
   *  verbatim como PROCEDENCIA de lo que se genere a partir de ella, para
   *  poder regenerar ese arte con un modelo mejor (#238). En un NPC es
   *  además el prompt del skin IA. Los otros dos son solo de NPC: `role` es
   *  el preset de conducta (NPC_ROLES; el oficio va en el nombre y en la
   *  descripción) y `style_ref` la ref de personaje que el motor eligió del
   *  catálogo del pack. Declarados aquí porque el contrato los declara: son
   *  datos del motor, no un extra que este módulo adivine. */
  role?: string;
  description?: string;
  style_ref?: string;
};

/** `{[clave]: valor}` si `valor` es un texto NO VACÍO; si no, `{}` (la clave
 *  no viaja). Es la regla única de «lo declarado que viaja tal cual» para los
 *  campos de texto opcionales: el `typeof` no sobra pese al tipo de
 *  `FormatDEntity`, porque `ent` viene de un JSON sin validar (save, fixture a
 *  mano) y un `role: 42` propagado revienta al derivar la clave del skin; y el
 *  vacío se colapsa con la ausencia a propósito, porque `description: ""`
 *  viajando convertiría el prompt del skin (`description ?? name`) en "". */
function textoDeclarado(clave: string, valor: unknown): Record<string, string> {
  return typeof valor === "string" && valor ? { [clave]: valor } : {};
}

/** Formas válidas que el cliente entiende. `shape` inválido se ignora (cae a box). */
const VALID_SHAPES = new Set(["box", "cylinder", "sphere", "cone"]);

const VALID_KINDS = new Set(["player", "npc", "building", "prop", "tree", "item", "decor"]);

/** Altura por defecto (METROS) cuando la entity no declara `h`. Alineada con
 *  los defaults de los volumes del blueprint (building wall_h 5 celdas =
 *  2.5 m, prop h 2 celdas = 1 m). Clave = kind (un tree emite category
 *  "prop" pero su altura sale de aquí). Compartida por ambos clientes vía
 *  formatDToWorld; el 2D la usa además para los spawns narrativos. */
export const KIND_DEFAULT_HEIGHT: Record<string, number> = {
  building: 2.5,
  tree: 4,
  prop: 1,
  item: 0.5,
  decor: 0.5,
};

/** Techo duro de altura por entity (metros) — un `h` disparatado del LLM se
 *  recorta en vez de tumbar la escena. */
const MAX_ENTITY_HEIGHT_M = 20;

/** Chars del grid que bloquean el paso: "W" muro y "w" agua (el puente "b"
 *  es transitable). ÚNICA fuente de solidez del terreno — nadie la declara
 *  por escena: la fija el engine. Si algún día hace falta un vado, irá como
 *  propiedad del rasgo `water` de `ground`, no como excepción sobre un char. */
export const DEFAULT_SOLID_CHARS: readonly string[] = ["W", "w"];

/** Convert a Map Format D scene to a world-coordinate scene. If `raw` is not in
 *  Format D it is returned unchanged. */
export function formatDToWorld(raw: Record<string, unknown>): WorldScene {
  // Idempotencia: una world scene ya normalizada (lleva __format_d) pasa
  // intacta. Sin esta guarda, un tile normalizado re-entraría en la expansión
  // (conserva `tile` pero no `biome`) y lanzaría — el bridge normaliza en el
  // wire y el cliente HTML vuelve a llamar aquí para sus fixtures locales.
  if (raw.__format_d !== undefined) return raw;
  // Red de seguridad para fixtures locales: las escenas del bridge llegan ya
  // expandidas (__expanded); una escena cruda con primitivas se expande aquí.
  if (hasUnexpandedPrimitives(raw)) raw = expandScenePrimitives(raw);
  const size = raw.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
  const terrain = raw.terrain;
  const entities = raw.entities;
  const isFormatD =
    !!size && typeof size.cols === "number" && typeof size.rows === "number" &&
    Array.isArray(terrain) && terrain.every((r) => typeof r === "string") &&
    Array.isArray(entities);

  if (!isFormatD) return raw;

  const cols = size!.cols!;
  const rows = size!.rows!;
  const mpc = size!.meters_per_cell ?? 2;
  // Rect mundial de la escena — ÚNICA fuente del origen. Un tile vive en su
  // rect global del plano continuo; una escena legacy queda centrada en el
  // origen (comportamiento histórico, sin cambios).
  const tile = raw.tile as { tx?: number; ty?: number } | undefined;
  const worldRect =
    tile && Number.isInteger(tile.tx) && Number.isInteger(tile.ty)
      ? tileWorldRect(tile.tx!, tile.ty!)
      : {
          minX: -(cols * mpc) / 2,
          minZ: -(rows * mpc) / 2,
          maxX: (cols * mpc) / 2,
          maxZ: (rows * mpc) / 2,
        };

  // El PLAN del tile, compuesto UNA vez y resuelto en el wire: de él salen la
  // geometría 3D, la colisión del jugador y la de los NPCs. Quien lo consume
  // lo LEE — nadie vuelve a derivar (ver src/scene/tile-plan.ts).
  const { plan, representedBy, warnings } = composeTilePlan(raw);

  const objects: Record<string, unknown>[] = [];
  const npcs: Record<string, unknown>[] = [];
  let playerStart: { x: number; z: number } | null = null;

  for (let i = 0; i < entities.length; i++) {
    const ent = (entities as FormatDEntity[])[i];
    if (!ent) throw new Error(`scene entities[${i}] is null/undefined`);
    if (!ent.id) throw new Error(`scene entities[${i}] missing id`);
    if (!VALID_KINDS.has(ent.kind)) {
      throw new Error(`scene entities[${i}] (${ent.id}) has invalid kind="${ent.kind}"; expected one of ${[...VALID_KINDS]}`);
    }
    if (!Array.isArray(ent.cell) || ent.cell.length < 2) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing cell [col,row]`);
    }
    if (!Array.isArray(ent.footprint) || ent.footprint.length < 2) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing footprint [w,h]`);
    }
    const [c, r] = ent.cell;
    const [w, h] = ent.footprint;
    if (![c, r, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error(`scene entities[${i}] (${ent.id}) cell/footprint must be finite numbers, got cell=[${c},${r}] fp=[${w},${h}]`);
    }
    // Centro del footprint en coordenadas mundo GLOBALES (esquina NW del
    // rect + offset de celda).
    const x = worldRect.minX + (c + w / 2) * mpc;
    const z = worldRect.minZ + (r + h / 2) * mpc;

    if (ent.kind === "player") {
      playerStart = { x, z };
      continue;
    }
    if (ent.kind === "npc") {
      if (!ent.name) {
        throw new Error(`scene entities[${i}] (npc ${ent.id}) missing name`);
      }
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
    // building / prop / tree / item / decor: tree maps to prop visually.
    // decor conserva su categoría — puramente estético, sin colisión ni
    // interacción (el cliente solo bloquea building/prop).
    const category = ent.kind === "tree" ? "prop" : ent.kind;
    if (!ent.name) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing name`);
    }
    // Altura en metros: `h` de la entity si es sano (tolerante, como shape:
    // un valor inválido cae al default por kind en vez de tumbar la escena).
    const entH =
      typeof ent.h === "number" && Number.isFinite(ent.h) && ent.h > 0
        ? Math.min(ent.h, MAX_ENTITY_HEIGHT_M)
        : (KIND_DEFAULT_HEIGHT[ent.kind] ?? 1);
    const obj: Record<string, unknown> = {
      id: ent.id,
      position: [x, 0, z],
      scale: [w * mpc, entH, h * mpc],
      category,
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
    };
    // Forma: explícita si es válida; si no, los árboles son redondos por defecto.
    if (ent.shape && VALID_SHAPES.has(ent.shape)) obj.shape = ent.shape;
    else if (ent.kind === "tree") obj.shape = "cylinder";
    objects.push(obj);
  }

  return {
    scene_id: raw.scene_id,
    scene_description: raw.scene_description ?? "",
    dimensions: { width: cols * mpc, depth: rows * mpc, height: 3 },
    // Coordenadas del plano continuo: rect mundial de la escena/tile y, si es
    // un tile, sus coords de grid. El cliente ancla capas/colisión aquí.
    world_rect: worldRect,
    tile: tile && Number.isInteger(tile.tx) && Number.isInteger(tile.ty) ? { tx: tile.tx, ty: tile.ty } : undefined,
    terrain: { color: [0.18, 0.22, 0.14] },
    // El grid de terreno crudo (río/camino/puente/piedra…): el cliente lo
    // consume para la COLISIÓN de terreno (createTerrainCollider), no para
    // pintar — el suelo se pinta desde `ground`. `terrain: { color }` sigue
    // siendo el fallback de color cuando esto no está.
    terrain_grid: {
      grid: terrain as string[],
      cols,
      rows,
      meters_per_cell: mpc,
      // Esquina NW del grid en coordenadas mundo (plano continuo).
      origin: [worldRect.minX, worldRect.minZ] as [number, number],
      // Chars que bloquean movimiento (muro y agua). Los consume
      // `createTerrainCollider`; el bridge (sim-collision) lee los mismos.
      solid_chars: [...DEFAULT_SOLID_CHARS],
    },
    // Plan del tile DECLARADO (rasgos de suelo + volúmenes tipados), tal cual
    // lo mandó el motor: es provenance, no la fuente de render. Lo que se
    // pinta y lo que colisiona es `__plan`, que además trae lo derivado.
    ground: Array.isArray(raw.ground) ? raw.ground : undefined,
    volumes: Array.isArray(raw.volumes) ? raw.volumes : undefined,
    // Scatter declarativo (vista fps): passthrough crudo — lo valida el gate
    // de escena y, en render, parseScatter (fail-loud con ruta).
    scatter_generators:
      raw.scatter_generators && typeof raw.scatter_generators === "object"
        ? raw.scatter_generators
        : undefined,
    scatter_zones: Array.isArray(raw.scatter_zones) ? raw.scatter_zones : undefined,
    biome: typeof raw.biome === "string" ? raw.biome : undefined,
    objects,
    npcs,
    // Metadatos para el cliente — el renderer los ignora.
    __player_start: playerStart,
    // El plan COMPUESTO (declarado + derivado del esquema). Viaja resuelto a
    // propósito: si cada consumidor lo derivara por su cuenta, divergirían en
    // los argumentos y el bosque del cliente no sería el del bridge.
    __plan: plan ?? undefined,
    __plan_warnings: warnings.length > 0 ? warnings : undefined,
    __format_d: raw,
  };
}
