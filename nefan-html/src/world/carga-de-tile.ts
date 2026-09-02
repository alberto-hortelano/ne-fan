/** AÑADIR UN TILE AL MUNDO DEL CLIENTE: los efectos, y solo los efectos.
 *
 *  Esto era `addTile` + `setActiveClientTile` dentro de `main.ts` (296 líneas
 *  de las 3.136 del fichero). Lo que se ha ido de aquí a `nefan-core` es lo que
 *  DECIDE: la política de qué se conserva, qué se crea y qué se retira al
 *  re-emitir un tile (`session/entidades-del-tile.ts`, con tests y suelo de
 *  mutación) y el fail-loud de las posiciones declaradas
 *  (`session/mundo-persistido.ts`). Lo que se queda aquí son los EFECTOS —
 *  instalar el tile en el renderer, derivar su colisión, dar de alta
 *  combatientes en el sim, encolar skins— y la construcción de `Entity`, que
 *  es el tipo del renderer y no tiene sitio en core.
 *
 *  ADITIVO: no toca la posición del jugador (salvo bootstrap con
 *  `__player_start` o escena legacy), no vacía las entidades de otros tiles, no
 *  resetea el sim. Re-añadir la misma clave SUSTITUYE, que es el caso que la
 *  política de re-emisión gobierna.
 *
 *  LO DECLARADO Y LO VIVO, que es lo único delicado de este fichero. Cuando un
 *  tile vuelve a declarar algo que ya está en el mundo, la entity se conserva y
 *  se le re-aplica lo que el tile declara AHORA — salvo donde eso pisaría a una
 *  fuente viva:
 *
 *   · un objeto no tiene ninguna (nadie mueve un barril, nadie le baja la
 *     vida), así que se le re-aplica TODO lo declarado, posición incluida: sin
 *     eso, un tile que cambia el nombre de su puerta enseñaría el anterior
 *     para siempre;
 *   · un personaje sí las tiene —el bridge manda su posición y su rumbo, el
 *     sim su vida, y su skin puede estar en vuelo—, así que se le re-aplica
 *     solo el NOMBRE, y únicamente si el tile lo declara. Re-aplicarle la
 *     posición lo teletransportaría a su celda de spawn (que es el bug que la
 *     política de conservar existe para no tener); re-aplicarle la descripción
 *     cambiaría la clave de caché de su skin y volvería a pagar el arte.
 */

import type { Vec3 } from "@nefan-core/src/types.js";
import { formatDToWorld } from "@nefan-core/src/scene/scene-normalize.js";
import { createTerrainCollider, type TerrainGridData } from "@nefan-core/src/scene/terrain-collision.js";
import { npcSkinStyleRef } from "@nefan-core/src/games/style-categories.js";
import { npcsFueraDelRect } from "@nefan-core/src/session/mundo-persistido.js";
import {
  npcsDeclarados,
  objetosDeclarados,
  repartoDelTile,
  type NpcDeclarado,
  type ObjetoDeclarado,
} from "@nefan-core/src/session/entidades-del-tile.js";
import type { SceneExit } from "@nefan-core/src/protocol/messages.js";

import { enemigoDesdeCombat } from "../scene/enemigo.js";
import type { FpsAtlasController } from "../scene/fps-atlas.js";
import type { CharacterSpriteManager } from "../renderer/character-sprites.js";
import type { FpsRenderer, FpsTilePlan } from "../renderer/fps-renderer.js";
import type { Entity } from "../renderer/types.js";
import type { GameClient, RoomEnemy } from "../net/game-client.js";
import type { TravelPanel } from "../ui/travel-panel.js";
import { errors } from "../ui/error-log.js";
import { applyPlanCollision } from "./collision.js";
import type { MundoDelCliente } from "./mundo-del-cliente.js";
import { tileKey, tileWorldRect, type TileClientState, type TileStore } from "./tile-store.js";

/** Opciones de carga de escena. `tomaElMundo` es la diferencia entre «esta es
 *  una escena de PRUEBA y a partir de ahora el mundo es mío» (el selector
 *  «Room») y «este tile se AÑADE al mundo que ya tienes» (la partida). Viaja
 *  hasta el bridge como `load_room` — ver `bridge/world-claim.ts`. */
export interface OpcionesDeCarga {
  tomaElMundo?: boolean;
}

export interface DepsDeCargaDeTile {
  mundo: MundoDelCliente;
  tileStore: TileStore;
  fpsRenderer: FpsRenderer;
  fpsAtlas: FpsAtlasController;
  characterSprites: CharacterSpriteManager;
  travelPanel: TravelPanel;
  /** La posición del jugador, que este módulo MUEVE en el bootstrap y en las
   *  escenas legacy. Es un `const` mutado in situ en `main.ts`, así que cruza
   *  el módulo por referencia. */
  playerPos: Vec3;
  /** Hay partida (no una fixture del selector «Room»). */
  session: { readonly active: boolean };
  /** La entrada del jugador en la partida (#279): este módulo declara la mitad
   *  «el mundo ya está pintado». */
  entrada: { mundoPintado(): void };
  /** El cliente de juego se construye ASYNC en el bootstrap, así que se
   *  pregunta por él en cada carga en vez de capturarlo. */
  gameClient(): GameClient | null;
  /** Barras de vida del HUD: DOM, y por eso se queda fuera. */
  rebuildEnemyBars(): void;
  log(msg: string): void;
}

/** Los campos de una `Entity` de objeto que DECLARA el tile. Es UNA función y
 *  la usan los dos caminos —crear y re-aplicar— a propósito: con dos, el
 *  primer campo nuevo se pondría en el constructor y se olvidaría en la
 *  re-emisión, que es exactamente la clase de olvido que #379 persigue. */
function declaradoDeObjeto(
  d: ObjetoDeclarado,
  tipoDeVolumen: ReadonlyMap<string, string>,
): Pick<Entity, "pos" | "radius" | "color" | "label" | "category" | "sizeXZ" | "sizeY" | "shape" | "volumeType"> {
  return {
    pos: { ...d.pos },
    radius: 5,
    color: d.categoria === "item" ? "#aa8" : "#666",
    label: d.nombre,
    category: d.categoria,
    sizeXZ: d.sizeXZ,
    sizeY: d.sizeY,
    shape: d.shape,
    // Tipo del volumen que ya la pinta en el greybox (`volume_id` de la world
    // scene). Presente = no se dibuja billboard encima; `building` además no se
    // puede mirar (su centro no es un punto al que apuntar).
    volumeType: d.volumeId === undefined ? undefined : tipoDeVolumen.get(d.volumeId),
  };
}

/** Lo que se le re-aplica a un PERSONAJE conservado: su nombre, y solo si el
 *  tile lo declara. `null` = el tile no dice cómo se llama, así que no hay
 *  nada que re-aplicar y se conserva el rótulo que tuviera — que para un
 *  hostil sin nombre propio es su descripción, y sobrescribirlo con el id sería
 *  la regresión de #323 (`narr_npc_1788038791_0` flotando en el HUD). */
function declaradoDePersonaje(d: NpcDeclarado): Pick<Entity, "label" | "name"> | null {
  return d.nombre === undefined ? null : { label: d.nombre, name: d.nombre };
}

export interface CargaDeTile {
  /** Añade un tile/escena al mundo del cliente. */
  addTile(rawData: Record<string, unknown>, opts?: OpcionesDeCarga): Promise<void>;
  /** Apunta la «escena activa» del cliente (imagen IA, exits, TravelPanel) al
   *  tile bajo el jugador. */
  activarTile(key: string): void;
}

export function crearCargaDeTile(deps: DepsDeCargaDeTile): CargaDeTile {
  const { mundo, tileStore, fpsRenderer, fpsAtlas, characterSprites, travelPanel, playerPos } = deps;

  function activarTile(key: string): void {
    const entry = tileStore.entries.get(key);
    if (!entry) return;
    const salidas = (entry.scene.exits ?? []) as SceneExit[];
    mundo.activarTile(key, entry.scene, salidas);
    fpsRenderer.setActiveTile(key);
    // Reinstala el atlas de caché o, con generación auto, lo pinta (el
    // controller degrada a clay con error visible si algo falla).
    void fpsAtlas.onActiveTile(key).catch((err: unknown) =>
      errors.push("scene", `el atlas fps de ${key} no arrancó al activar el tile`, err),
    );
    travelPanel.setExits(salidas);
  }

  /** Los cuerpos: la política de re-emisión aplicada a las tres clases. */
  function poblar(
    key: string,
    data: Record<string, unknown>,
    planInfo: FpsTilePlan | null,
  ): RoomEnemy[] {
    // Qué tipo de volumen representa a cada objeto del plan: de aquí sale si
    // el greybox ya lo pinta (y entonces no lleva billboard encima).
    const tipoDeVolumen = new Map((planInfo?.volumes ?? []).map((v) => [v.id, v.type]));

    const objetos = objetosDeclarados(data.objects);
    for (const aviso of objetos.errores) errors.push("scene", `${key}: ${aviso}`);
    const repartoObjetos = repartoDelTile(mundo.objetos, objetos.declaradas, key);
    for (const { id, declarado } of repartoObjetos.conservar) {
      const entity = mundo.objeto(id);
      if (!entity) continue;
      // Pasa a ser de ESTE tile (pudo ponerlo el motor a mitad de partida) y
      // trae lo que el tile declara ahora.
      entity.dueno = { de: "tile", key };
      Object.assign(entity, declaradoDeObjeto(declarado, tipoDeVolumen));
    }
    for (const declarado of repartoObjetos.crear) {
      mundo.anadirObjeto({
        id: declarado.id,
        alive: true,
        // Lo declara ESTE tile: se va el día que deje de declararlo, y solo por
        // eso (#350).
        dueno: { de: "tile", key },
        ...declaradoDeObjeto(declarado, tipoDeVolumen),
      });
    }

    const npcs = npcsDeclarados(data.npcs);
    for (const aviso of npcs.errores) errors.push("scene", `${key}: ${aviso}`);
    const repartoNpcs = repartoDelTile(mundo.personajes, npcs.declaradas, key);
    for (const { id, declarado } of repartoNpcs.conservar) {
      const entity = mundo.personaje(id);
      if (!entity) continue;
      entity.dueno = { de: "tile", key };
      const nombre = declaradoDePersonaje(declarado);
      if (nombre) Object.assign(entity, nombre);
    }

    const enemies: RoomEnemy[] = [];
    for (const declarado of repartoNpcs.crear) {
      // VÍA (a) al combate: el motor declaró `role:"hostile"` y el core derivó
      // el bloque (`formatDToWorld` → `combatForHostileRole`). El cliente no
      // decide quién pelea ni con cuánta vida: solo lo pinta y se lo dice al
      // sim, que es quien resuelve el daño.
      if (declarado.combat !== undefined) {
        const nuevo = enemigoDesdeCombat({
          id: declarado.id,
          pos: { ...declarado.pos },
          combat: declarado.combat,
          descripcion: declarado.descripcion,
          styleRef: declarado.styleRef,
          nombre: declarado.nombre,
          indiceColor: mundo.siguienteColorDeEnemigo(),
          dueno: { de: "tile", key },
        });
        if (nuevo) {
          enemies.push(nuevo.combatiente);
          mundo.anadirEnemigo(nuevo.entidad);
          characterSprites.requestSkin(nuevo.entidad.skinPrompt ?? declarado.id, {
            role: nuevo.entidad.styleRole,
          });
        }
        continue;
      }
      // El prompt del skin es la DESCRIPCIÓN del motor: con el id se pintaría
      // "aldeano_3". Ref de personaje: la elegida por el motor (style_ref) o el
      // default por rol (conserva las claves de caché de skins previas).
      const prompt = declarado.descripcion ?? declarado.nombre ?? declarado.id;
      const styleRole = npcSkinStyleRef({ style_ref: declarado.styleRef, role: declarado.role });
      const rotulo = declarado.nombre ?? declarado.id;
      mundo.anadirNpc({
        id: declarado.id,
        pos: { ...declarado.pos },
        forward: { x: 0, y: 0, z: -1 },
        radius: 7,
        color: "#68c",
        label: rotulo,
        name: rotulo,
        alive: true,
        category: "creature",
        skinPrompt: prompt,
        styleRole,
        dueno: { de: "tile", key },
      });
      characterSprites.requestSkin(prompt, { role: styleRole });
    }

    mundo.retirar([...repartoObjetos.retirar, ...repartoNpcs.retirar]);
    return enemies;
  }

  async function addTile(
    rawData: Record<string, unknown>,
    opts: OpcionesDeCarga = {},
  ): Promise<void> {
    const data = formatDToWorld(rawData);
    const tile = data.tile as { tx: number; ty: number } | undefined;
    const isGridTile = Number.isInteger(tile?.tx) && Number.isInteger(tile?.ty);
    const key = isGridTile ? tileKey(tile!.tx, tile!.ty) : String(data.scene_id ?? "scene");
    const firstTile = tileStore.entries.size === 0;

    // Rect mundial del tile (los tiles de grid lo derivan de la geometría core;
    // las escenas legacy vienen centradas).
    const wr = data.world_rect as { minX: number; minZ: number; maxX: number; maxZ: number } | undefined;
    const dims = data.dimensions as { width: number; depth: number } | undefined;
    const rect = isGridTile
      ? tileWorldRect(tile!.tx, tile!.ty)
      : wr ?? {
          minX: -(dims?.width ?? 20) / 2,
          minZ: -(dims?.depth ?? 20) / 2,
          maxX: (dims?.width ?? 20) / 2,
          maxZ: (dims?.depth ?? 20) / 2,
        };

    // Colisión de terreno POR TILE (origin global desde terrain_grid.origin).
    let collider: TileClientState["collider"] = null;
    try {
      collider = createTerrainCollider(data.terrain_grid as TerrainGridData | undefined);
    } catch (err) {
      errors.push("scene", `terrain_grid inconsistente en ${key}; colisión de terreno desactivada`, err);
    }
    // Plan del tile: viene RESUELTO en la world scene (`__plan`, compuesto por
    // core en la normalización — ver src/scene/tile-plan.ts). El cliente no
    // deriva nada: si lo hiciera habría dos composiciones del mismo tile y
    // divergirían por los argumentos, que es como divergen estas cosas.
    const planInfo = (data.__plan as FpsTilePlan | undefined) ?? null;
    for (const aviso of (data.__plan_warnings as string[] | undefined) ?? []) {
      errors.push("scene", `plan de ${key}: ${aviso}`);
    }

    const prevEntry = tileStore.entries.get(key);
    const { sceneChanged } = tileStore.add({
      key,
      tx: isGridTile ? tile!.tx : undefined,
      ty: isGridTile ? tile!.ty : undefined,
      rect,
      scene: data as Record<string, unknown>,
      collider,
      // La colisión base del plan se deriva justo debajo (o se restaura si la
      // escena no cambió).
      svgCollider: null,
      svgApplied: false,
    });
    // Mundo 3D: spec fps del tile + layout de superficies (la clave del atlas).
    // ANTES de activarlo abajo: el atlas de superficies pide el layout al
    // renderer, y un tile sin instalar se quedaría en clay sin pedir nada.
    if (isGridTile && planInfo) {
      fpsRenderer.installTile(key, planInfo, rect);
      // Si ESTE ya es el tile activo, `activarTile` no volverá a correr (solo
      // se dispara al cambiar de tile): lanzar el atlas aquí.
      if (key === mundo.tileActivo) {
        void fpsAtlas.onActiveTile(key).catch((err: unknown) =>
          errors.push("scene", `el atlas fps de ${key} no arrancó al instalar el tile`, err),
        );
      }
    }
    // Colisión base del plan: restaurar si la escena no cambió; derivar
    // (analítica, síncrona) si es nueva o cambió. Agua∖decks del ground +
    // huellas de volumes — espacio de mundo.
    if (prevEntry?.svgApplied && !sceneChanged) {
      tileStore.setSvgCollider(key, prevEntry.svgCollider);
    } else if (planInfo) {
      applyPlanCollision(key, { ground: planInfo.ground, volumes: planInfo.volumes }, rect, tileStore);
    }
    // Posición de entrada — SOLO escenas legacy o el bootstrap (primer tile con
    // spawn explícito). En el resto de tiles el jugador entra andando.
    const playerStart = data.__player_start as { x: number; z: number } | null | undefined;
    if (!isGridTile) {
      playerPos.x = playerStart ? playerStart.x : 0;
      playerPos.z = playerStart ? playerStart.z : 2;
    } else if (firstTile && playerStart) {
      playerPos.x = playerStart.x;
      playerPos.z = playerStart.z;
    }

    const enemies = poblar(key, data, planInfo);

    // Fail-loud del contrato de posiciones globales: un NPC de un tile de grid
    // DECLARADO fuera de su rect delata una conversión celda→mundo rota. La
    // decisión —cuál de las dos coordenadas de un npc es la conversión— vive en
    // core, junto a quien escribe la otra (#241/#357); aquí solo se pinta el
    // resultado en el panel del jugador.
    if (isGridTile) {
      for (const fuera of npcsFueraDelRect(data.npcs, rect)) {
        errors.push(
          "scene",
          `entidad "${fuera.id}" de ${key} fuera de su rect: (${fuera.x.toFixed(1)}, ${fuera.z.toFixed(1)})`,
        );
      }
    }

    deps.rebuildEnemyBars();

    // Activación visual del primer tile / escena legacy (el resto de tiles se
    // activa por POSICIÓN en el bucle al pisarlos); y refresco del puntero
    // cuando el que vuelve es el tile activo (resume / re-broadcast).
    if (firstTile || !isGridTile || key === mundo.tileActivo) {
      activarTile(key);
    }

    // Sim: los tiles de la PARTIDA añaden combatientes de forma ADITIVA (sin
    // reset), porque el mundo es un plano continuo. Tomar el mundo —el selector
    // «Room», o una escena legacy suelta— manda `load_room`, que además le dice
    // al bridge que lo que va a andar por aquí no es el jugador de la partida.
    const cliente = deps.gameClient();
    if (cliente) {
      if (opts.tomaElMundo || !isGridTile) cliente.loadRoom(data, key, enemies);
      else cliente.addEnemies(enemies);
    }

    // El mundo de la PARTIDA está pintado: media entrada (#279). Cuelga de que
    // el tile se AÑADA y no de `installTile`, que solo corre con un plan no
    // vacío: un tile legal pero pelado dejaría una partida que no se escribe
    // nunca. El atlas de imagen tampoco entra —es fire-and-forget— así que
    // «pintado» sigue siendo honesto con remote-gen caído. Las fixtures del
    // selector «Room» quedan fuera por las dos guardas: no son la partida de
    // nadie.
    if (deps.session.active && isGridTile && !opts.tomaElMundo) deps.entrada.mundoPintado();

    deps.log("Scene loaded: " + key);
  }

  return { addTile, activarTile };
}
