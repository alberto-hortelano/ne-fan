/** La materialización de un `spawn_entity` del motor narrativo EN LA ESCENA
 *  VIVA, sin recargar: la puerta única por la que entran al cliente las tres
 *  clases que el motor pone a mitad de partida (npc —hostil o pacífico—,
 *  objeto, edificio).
 *
 *  Tiene DOS llamantes y los dos pasan por aquí a propósito: el evento
 *  `react_to_player` del motor (acaba de pasar) y el resume (`spawnsDeRuntime`,
 *  el mundo se rehidrata desde el save). Con un segundo constructor para el
 *  resume, el primer campo nuevo se pondría en uno y se olvidaría en el otro.
 *
 *  Lo que DECIDE no está aquí: la posición ya viene resuelta en metros mundo
 *  por el bridge (`consequence-handler.ts:resolvePositionHint`, relativa al
 *  jugador), el bloque `combat` del hostil lo derivó el core
 *  (`combatForHostileRole`) y quién vuelve al reanudar lo filtra
 *  `spawnsDeRuntime`. Aquí se construye la `Entity`, se pide su skin y, si es
 *  un enemigo, se da de alta en el sim del bridge —que es lo que lo convierte
 *  en algo a lo que se puede pegar— y se repintan las barras del HUD. */

import type { Vec3 } from "@nefan-core/src/types.js";
import { KIND_DEFAULT_HEIGHT } from "@nefan-core/src/scene/scene-normalize.js";
import { npcSkinStyleRef } from "@nefan-core/src/games/style-categories.js";
import type { SpawnDeRuntime } from "@nefan-core/src/session/mundo-persistido.js";
import { enemigoDesdeCombat } from "../scene/enemigo.js";
import type { CharacterSpriteManager } from "../renderer/character-sprites.js";
import type { GameClient } from "../net/game-client.js";
import type { MundoDelCliente } from "./mundo-del-cliente.js";

export interface DepsDeMaterializarSpawn {
  /** El mundo del cliente: las tres altas y el turno de color del enemigo. */
  mundo: Pick<MundoDelCliente, "anadirNpc" | "anadirEnemigo" | "anadirObjeto" | "siguienteColorDeEnemigo">;
  /** Solo para pedir el skin IA del personaje recién puesto. */
  characterSprites: Pick<CharacterSpriteManager, "requestSkin">;
  /** El cliente de juego se construye ASYNC en el bootstrap, así que se
   *  pregunta por él en cada spawn en vez de capturarlo. */
  gameClient(): GameClient | null;
  /** Barras de vida del HUD: DOM, y por eso se queda fuera. */
  rebuildEnemyBars(): void;
  /** La línea del juego: «⚔ ataca» / «✨ aparece» en vivo, «↩ sigue ahí» al
   *  reanudar. */
  log(msg: string): void;
}

export interface MaterializadorDeSpawn {
  materializar(
    /** La forma del effect `spawn_entity` sin su `eventId`: la misma que come
     *  el resume (`spawnsDeRuntime`). `name` es el rótulo, siempre;
     *  `description` la procedencia, si la hay (#397). */
    effect: SpawnDeRuntime,
    /** `rehidratado: true` cuando esto NO acaba de pasar: el mundo se está
     *  rehidratando desde el save. Lo único que cambia es lo que se le CUENTA
     *  al jugador — «⚔ Secuaz ataca» y «✨ Nogala aparece» son mentira al
     *  reanudar: nadie ha atacado ni aparecido, ha vuelto a su partida
     *  (QA 2026-08-31, H-8). */
    opts?: { rehidratado?: boolean },
  ): void;
}

export function crearMaterializadorDeSpawn(deps: DepsDeMaterializarSpawn): MaterializadorDeSpawn {
  const { mundo, characterSprites, log } = deps;

  /** NPCs van a la lista de NPCs (interactuables con E); building/object a la
   *  de objetos, con `sizeXZ` para que sean sólidos (collidesAt) y tengan
   *  volumen que instalar en el renderer, que es la "geometría base" sobre la
   *  que luego se superponen imágenes IA. */
  function materializar(effect: SpawnDeRuntime, opts: { rehidratado?: boolean } = {}): void {
    const [x, y, z] = effect.position;
    const pos: Vec3 = { x, y, z };
    // El rótulo ES `name`: la descripción es la procedencia y no se rotula.
    const label = effect.name.slice(0, 40);

    if (effect.entityKind === "npc") {
      // VÍA (b) al combate: un `spawn_entity` con `role:"hostile"`. El bloque
      // `combat` lo puso el core en `dispatchConsequences` (mismo
      // `combatForHostileRole` que la escena inicial), y aquí se registra por la
      // MISMA puerta. Sin esto, el enemigo aparecería como un vecino más: se
      // pintaría y no se le podría pegar.
      if (effect.data.combat !== undefined) {
        const nuevo = enemigoDesdeCombat({
          id: effect.entityId,
          pos,
          combat: effect.data.combat,
          descripcion: effect.description,
          styleRef: typeof effect.data.style_ref === "string" ? effect.data.style_ref : undefined,
          nombre: effect.name,
          indiceColor: mundo.siguienteColorDeEnemigo(),
          // DE RUNTIME, y se escribe AQUÍ DENTRO y nunca en el llamante (#350).
          // Es la trampa concreta que este tipo cierra: con el dueño puesto
          // fuera, el rehidratado del resume volvería sin él y el bug —el spawn
          // que desaparece al re-emitir su tile— reaparecería tras resume +
          // viaje. Con `dueno` obligatorio, olvidarlo no compila.
          dueno: { de: "runtime" },
        });
        if (nuevo) {
          mundo.anadirEnemigo(nuevo.entidad);
          characterSprites.requestSkin(nuevo.entidad.skinPrompt ?? effect.entityId, {
            role: nuevo.entidad.styleRole,
          });
          // El alta en el sim es lo que lo convierte en algo a lo que se puede
          // pegar; la barra de vida, en algo que el jugador ve perder vida.
          deps.gameClient()?.addEnemies([nuevo.combatiente]);
          deps.rebuildEnemyBars();
          log(opts.rehidratado ? `↩ ${effect.name} sigue ahí` : `⚔ ${effect.name} ataca`);
        }
        return;
      }
      // El caso central del skin IA: la PROCEDENCIA (`description`) es el prompt
      // con el que se repinta la base y_bot frame a frame; sin ella, el nombre.
      // Nada se inventa aquí ni antes: lo que llega es lo que declaró el motor.
      const npcPrompt = effect.description ?? effect.name;
      const spawnStyleRole = npcSkinStyleRef({
        style_ref: typeof effect.data.style_ref === "string" ? effect.data.style_ref : undefined,
        role: typeof effect.data.role === "string" ? effect.data.role : undefined,
      });
      mundo.anadirNpc({
        id: effect.entityId,
        pos,
        forward: { x: 0, y: 0, z: -1 },
        radius: 7,
        color: "#68c",
        label,
        name: effect.name,
        alive: true,
        category: "creature",
        skinPrompt: npcPrompt,
        styleRole: spawnStyleRole,
        dueno: { de: "runtime" },
      });
      characterSprites.requestSkin(npcPrompt, { role: spawnStyleRole });
      log(opts.rehidratado ? `↩ ${effect.name} sigue ahí` : `✨ ${effect.name} aparece`);
      return;
    }

    // building / object: caja sólida colocada en la escena actual.
    const isBuilding = effect.entityKind === "building";
    mundo.anadirObjeto({
      id: effect.entityId,
      pos,
      radius: isBuilding ? 8 : 5,
      color: isBuilding ? "#5a4a38" : "#666",
      label,
      alive: true,
      category: isBuilding ? "building" : "prop",
      sizeXZ: isBuilding ? { x: 4, z: 4 } : { x: 1.4, z: 1.4 },
      // Altura coherente con la de las escenas del motor (defaults por kind).
      sizeY: KIND_DEFAULT_HEIGHT[isBuilding ? "building" : "prop"],
      // EL ARREGLO DE #350, en una línea: este cofre y esta forja no son de
      // ningún tile, así que la purga de `addTile` ya no se los lleva por caer
      // dentro de su rect. Antes desaparecían en cuanto el jugador viajaba por
      // «Salidas» y volvía, y solo reaparecían al reanudar — el mundo se curaba
      // solo, que es peor que romperse.
      dueno: { de: "runtime" },
    });
    const que = isBuilding ? "edificio" : "objeto";
    log(opts.rehidratado ? `↩ ${que}: ${label} sigue ahí` : `✨ ${que}: ${label}`);
  }

  return { materializar };
}
