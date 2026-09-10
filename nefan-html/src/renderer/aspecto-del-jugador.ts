/** El aspecto del jugador: su modelo base, su skin IA y las hojas base sin
 *  las que ningún personaje tiene cuerpo.
 *
 *  Con `CONFIG.graphics.character_sprites` apagado el jugador se dibuja como
 *  un círculo y el modelo se queda en null: ese es el contrato. Encendido, la
 *  base es y_bot (obligatoria, fail-loud: si falta una hoja la sesión no
 *  arranca), un modelo con el set COMPLETO en disco la sustituye, y el skin IA
 *  —la vía canónica de personalización— se encola en background y sustituye a
 *  la base anim a anim conforme llega.
 *
 *  El estado vive aquí y se LEE por métodos: el bucle pregunta cada frame por
 *  el modelo, el prompt y si las hojas base están, y `resetWorld` desviste al
 *  jugador con un verbo en vez de escribir su prompt desde fuera. Lo que
 *  DECIDE la clave de caché de un skin y qué ref de estilo lleva un NPC es de
 *  core (`npcSkinStyleRef`); aquí solo se pide. */

import { CONFIG } from "@nefan-core/src/config.js";
import { motivoDeSesionParaElJugador } from "@nefan-core/src/protocol/status-motivo.js";
import { AVISO_PERSONAJES, errors } from "../ui/error-log.js";
import { BASE_ANIMS, BASE_MODEL, type CharacterSpriteManager } from "./character-sprites.js";
import type { SpriteRenderer } from "./sprite-renderer.js";
import type { AnimacionDeEntidades } from "./animacion-de-entidades.js";

export interface DepsDeAspectoDelJugador {
  /** El gestor de skins: precarga la base, rearma el cortacircuitos al
   *  empezar una sesión y encola el skin del jugador (si el toggle lo deja). */
  characterSprites: Pick<
    CharacterSpriteManager,
    "preloadBase" | "rearmarCortacircuitos" | "skinsAllowed" | "requestSkin"
  >;
  /** Solo para comprobar que un modelo alternativo tiene el set completo. */
  spriteRenderer: Pick<SpriteRenderer, "loadAnimation">;
  /** La máquina de estados del cuerpo del jugador: arranca en reposo al vestirlo. */
  animacion: Pick<AnimacionDeEntidades, "jugadorEnReposo">;
  /** El ángulo de cámara único del juego: la clave con la que se piden las hojas. */
  worldAngle: string;
  /** La línea del juego: la base a la que cae un modelo sin hojas y el skin encolado. */
  log(msg: string): void;
}

export interface AspectoDelJugador {
  /** Resuelve la base visual del jugador y encola su skin IA.
   *
   *  - `character_sprites === false` → no hace nada (el renderer dibuja un
   *    círculo). Con `skinPrompt` no vacío LANZA: se pidió algo que la config
   *    no permite.
   *  - `character_sprites === true` → espera a las hojas base (rechaza si
   *    falta una), rearma el cortacircuitos de skins (#236), elige la base y,
   *    si hay prompt y el toggle lo deja, encola el skin. Con
   *    `graphics.ai_skin === false` y prompt no vacío LANZA. */
  vestir(modelId: string, skinPrompt: string): Promise<void>;
  /** Olvida el skin del jugador: es del mundo que se va. Dejarlo puesto hace
   *  que volver al título re-pida su skin IA (imagen de pago) por un mundo que
   *  ya no existe. El modelo base se queda: vestir la partida siguiente lo
   *  vuelve a decidir. */
  desvestir(): void;
  /** La base que se dibuja este frame, o null si va en círculo. */
  modelo(): string | null;
  /** El prompt del skin IA del jugador; vacío si no tiene. */
  skinPrompt(): string;
  /** true cuando el set base y_bot está cargado: el bucle solo puebla
   *  `entity.sprite` a partir de ese momento (antes, círculos). */
  hojasBaseListas(): boolean;
}

export function crearAspectoDelJugador(deps: DepsDeAspectoDelJugador): AspectoDelJugador {
  const { characterSprites, spriteRenderer, animacion, worldAngle, log } = deps;

  let playerModel: string | null = null;
  let playerSkinPrompt = "";
  let baseSheetsLoaded = false;

  /** Precarga del set base y_bot — obligatorio con character_sprites=true.
   *  `vestir` espera esta promise; si falta un sheet, la sesión no arranca
   *  (fail-loud) y el error queda registrado. */
  const baseSheetsReady: Promise<void> = CONFIG.graphics.character_sprites
    ? characterSprites.preloadBase().then(() => {
        baseSheetsLoaded = true;
      })
    : Promise.resolve();
  // El mensaje NOMBRA EL REMEDIO (#255): las hojas son 28 MB fuera de git, así
  // que un clon limpio llega aquí siempre y «incompleto» a secas no le dice a
  // nadie qué hacer. Ni el fallback existe — sin `y_bot` no hay a qué degradar.
  baseSheetsReady.catch((err) =>
    errors.push(
      "sprite",
      `set base ${BASE_MODEL} incompleto — personajes sin sprite. Las hojas no están en el repo: ` +
        `genéralas con sprite-forge, receta en docs/assets-de-personaje.md`,
      err,
      // Y a la PANTALLA (#306): sin hojas los personajes salen en maniquí y
      // hasta ahora nadie lo decía. Este mensaje llega DESPUÉS que los de las
      // hojas sueltas y con el mismo titular, así que es el suyo el que se lee.
      //
      // El detalle NO es el `message`: ese está escrito para quien programa y no
      // se puede cambiar (el guion 13 exige `y_bot`, «incompleto» y el documento
      // en el registro). Lo traduce el traductor de la casa, que tiene rama
      // propia para este código desde #255.
      {
        alJugador: AVISO_PERSONAJES,
        detalleAlJugador: motivoDeSesionParaElJugador(err),
      },
    ),
  );

  async function vestir(modelId: string, skinPrompt: string): Promise<void> {
    if (!CONFIG.graphics.character_sprites) {
      if (skinPrompt) {
        const msg = `appearance.skin_path="${skinPrompt}" requires graphics.character_sprites=true`;
        errors.push("config", msg);
        throw new Error(msg);
      }
      playerModel = null;
      playerSkinPrompt = "";
      return;
    }

    await baseSheetsReady;

    // Entrar o reanudar una partida rearma el cortacircuitos de skins (#236):
    // es el único momento en que se sabe que empieza una sesión, y hasta ahora
    // el cortacircuitos solo se rearmaba desde el OFF→ON del menú dev.
    //
    // `characterSprites` es un singleton de MÓDULO, así que su mapa de skins
    // sobrevive a volver al título y reanudar: sin esta línea, una partida
    // abandonada con el backend caído se llevaba el apagón a la siguiente —ya
    // con el backend arriba— y sus vecinos de siempre seguían en maniquí toda
    // la vida de la pestaña. Rearmar OLVIDA a los que fallaron (ver
    // `rearmarCortacircuitos`), no los re-pide: los que aparezcan en ESTA
    // partida los pedirá quien los spawnee, y los que no, no se pagan. Y desde
    // #520 el que se quedó a medias —anims encoladas que el apagón SALTÓ sin
    // pedirlas— también vuelve por ahí: su petición completa lo que le falte
    // del set automático en vez de salirse por «ya tiene estado».
    characterSprites.rearmarCortacircuitos();

    let base = BASE_MODEL;
    if (modelId && modelId !== BASE_MODEL) {
      try {
        // Secuencial y abortando al primer fallo: un modelo sin sheets solo
        // genera UNA entrada en el error-log (la del fetch), no diez.
        for (const anim of BASE_ANIMS) {
          await spriteRenderer.loadAnimation(modelId, anim, worldAngle);
        }
        base = modelId;
      } catch {
        log(`modelo "${modelId}" sin sheets completos — base ${BASE_MODEL}`);
      }
    }

    playerModel = base;
    playerSkinPrompt = skinPrompt;
    animacion.jugadorEnReposo(performance.now());

    if (skinPrompt && characterSprites.skinsAllowed) {
      if (!CONFIG.graphics.ai_skin) {
        const msg = `appearance.skin_path="${skinPrompt}" requires graphics.ai_skin=true`;
        errors.push("config", msg);
        throw new Error(msg);
      }
      // Generación progresiva en background: cada anim sustituye a la base
      // y_bot cuando su sheet skinneado está listo (modelFor por frame).
      characterSprites.requestSkin(skinPrompt);
      log(`skin IA encolada: ${skinPrompt.slice(0, 40)}`);
    }
  }

  return {
    vestir,
    desvestir() {
      playerSkinPrompt = "";
    },
    modelo: () => playerModel,
    skinPrompt: () => playerSkinPrompt,
    hojasBaseListas: () => baseSheetsLoaded,
  };
}
