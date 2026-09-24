/** CURA del mundo pre-generado de un juego (repair_game_world): pedirle al
 *  motor SOLO las escenas que la puerta de carga criba hoy y dejarlas en
 *  `data/games/{id}/world/tile.json` (#577).
 *
 *  EL PROBLEMA, medido. Desde #451 una escena del ANILLO que no pasa el
 *  validador se CRIBA al cargar el snapshot en vez de tumbar el mundo entero.
 *  Pero la carga no reescribe el fichero, así que el tile cribado se le vuelve
 *  a pedir al motor EN CADA PARTIDA NUEVA — con motor real, créditos, una y
 *  otra vez, por un fichero que nadie arregla. El único remedio que había
 *  («↻ Regenerar mundo») cuesta nueve llamadas Y repaga el arte aplicado.
 *
 *  POR QUÉ SE CURA DESDE EL TÍTULO Y NO AL CARGAR (la decisión de #577). En el
 *  momento de la carga NO EXISTE ningún tile bueno con el que curar: el único
 *  que hay es el roto. Escribir ahí solo podría BORRAR la escena cribada —
 *  cero llamadas ahorradas y el chip pasando de «8 de 9 escenas» a
 *  «✓ generado» 8/8, perdiendo el único aviso que tiene el jugador. El único
 *  instante en que existe un tile bueno es DESPUÉS de `generateTileScene`, y
 *  este job es el que lo provoca sin que haya partida de por medio.
 *
 *  SESIÓN EFÍMERA Y SIN HISTORIA: la cura corre como la génesis
 *  (`sesion-efimera.ts`), así que el tile nuevo se genera con `story_so_far`
 *  vacío — igual que sus ocho hermanos de la pre-generación, y no improvisado
 *  dentro de la partida de alguien. */
import { createHash } from "node:crypto";

import { loadGameMeta, loadWorldDoc } from "../../src/games/loader.js";
import {
  cargarConDetalle,
  escenasQueSobreviven,
} from "../../src/games/world-snapshot.js";
import type { WorldMap } from "../../src/world-map/types.js";
import type { RepairGameWorldMessage } from "../../src/protocol/messages.js";

import {
  generationBusyKey,
  restaurarMundoServible,
  writeSessionSnapshot,
  type BridgeContext,
  type ClientSocket,
} from "../context.js";
import type { SceneGenOutcome } from "../scene-gen-queue.js";
import { conSesionEfimeraDeJuego } from "../sesion-efimera.js";
import { generateTileScene } from "./tile.js";

/** Una escena cribada con SU coordenada de tile, leída del fichero y no del
 *  id: `scene_id` es un rótulo y `tile` es la verdad geométrica que fija el
 *  bridge al generar. Un snapshot cuya escena cribada no traiga `tile` no se
 *  puede curar, y eso se DICE en vez de inventar un (0,0). */
interface Cribada {
  sceneId: string;
  tx: number;
  ty: number;
}

/** Qué hay que curar en este juego, o el motivo por el que no se puede.
 *
 *  PENDIENTE (anotado en #578, sin issue propio): `loQueHayQueCurar` es una
 *  DECISIÓN pura que vive en el bridge y lee el disco dos veces
 *  (`cargarConDetalle` + `escenasQueSobreviven`). Su sitio es junto a
 *  `caminoDeArranque` (`src/world-map/entrada-del-fichero.ts`), partiendo de
 *  una sola lectura como `cargarParaArrancar`. No se movió con #578 porque
 *  la cura no regenera la entrada y el cambio no hacía falta para arreglarlo. */
export type PlanDeCura =
  | {
      ok: true;
      entrySceneId: string;
      worldMap: WorldMap;
      /** Lo que la puerta de carga SÍ sirve hoy: el vecindario con el que el
       *  motor tiene que casar las costuras de lo que se cura. */
      servibles: Record<string, Record<string, unknown>>;
      cribadas: Cribada[];
    }
  | { ok: false; error: string };

export function loQueHayQueCurar(
  gamesDir: string,
  gameId: string,
  worldDocHash: string,
): PlanDeCura {
  const { snapshot, cribadas } = cargarConDetalle(gamesDir, gameId, worldDocHash);
  if (!snapshot) {
    return {
      ok: false,
      error:
        `"${gameId}" no tiene mundo pre-generado que curar (no hay fichero, o es de otro ` +
        `world.md): genera el mundo desde el título`,
    };
  }
  if (cribadas.length === 0) {
    return { ok: false, error: `el mundo de "${gameId}" no tiene ninguna escena cribada: no hay nada que curar` };
  }
  // Las cribadas NO viajan en `snapshot.scenes` —ya vienen filtradas—, así que
  // sus coordenadas se leen del fichero entero, que es lo que también lee el
  // write con `conserva`.
  const enDisco = escenasQueSobreviven(gamesDir, gameId, worldDocHash);
  const objetivos: Cribada[] = cribadas.map((sceneId) => {
    const tile = enDisco[sceneId]?.tile as { tx?: unknown; ty?: unknown } | undefined;
    if (typeof tile?.tx !== "number" || typeof tile?.ty !== "number") {
      // INALCANZABLE hoy: `escenasQueSobreviven` pasa el fichero entero por
      // `WorldSnapshotSchema`, cuyo `ExpandedSceneSchema` exige `tile` con dos
      // números. Se comprueba igual porque el tipo se pierde al salir de ahí
      // (`Record<string, unknown>`) y la alternativa sería inventar un (0,0):
      // curar el tile EQUIVOCADO, que es peor que no curar. LANZA en vez de
      // devolver: el job lo convierte en `error` y no escribe nada.
      throw new Error(
        `la escena cribada "${sceneId}" de "${gameId}" no declara su tile: no se sabe qué ` +
          `pedirle al motor — regenera el mundo desde el título`,
      );
    }
    return { sceneId, tx: tile.tx, ty: tile.ty };
  });
  return {
    ok: true,
    entrySceneId: snapshot.entry_scene_id,
    worldMap: snapshot.world_map,
    servibles: snapshot.scenes,
    cribadas: objetivos,
  };
}

export async function handleRepairGameWorld(
  msg: RepairGameWorldMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const fail = (error: string): void => {
    console.error(`Bridge: repair_game_world failed: ${error}`);
    ctx.send(ws, { type: "game_world_repaired", requestId: msg.requestId, ok: false, error });
  };
  // Fail-loud ANTES de encolar, como generate_game: un game.json ilegible no
  // puede convertirse en un job que falla a mitad de la cola. Y tampoco puede
  // encolarse un trabajo VACÍO: el jugador se quedaría mirando una barra que
  // no va a moverse, y «no hay nada cribado» es una respuesta, no un fallo
  // del motor.
  let plan: PlanDeCura;
  try {
    loadGameMeta(ctx.gamesDir, msg.gameId);
    const hashDelMundo = createHash("sha256")
      .update(loadWorldDoc(ctx.gamesDir, msg.gameId), "utf-8")
      .digest("hex");
    plan = loQueHayQueCurar(ctx.gamesDir, msg.gameId, hashDelMundo);
  } catch (err) {
    return fail((err as Error).message ?? String(err));
  }
  if (!plan.ok) return fail(plan.error);

  const busyKey = generationBusyKey(ctx);
  if (busyKey) {
    console.warn(`Bridge: repair_game_world con generación en vuelo ("${busyKey}") — abandonada`);
    ctx.sceneGen.abandonAll();
  }
  // El solicitante está en el TÍTULO (sin sesión): suscribirlo o el progreso
  // kind "game_gen" nunca le llegaría.
  ctx.subscribe(ws);
  const { status: queued, delivery } = ctx.sceneGen.enqueue({
    key: `curar:${msg.gameId}`,
    blocking: false,
    run: () => runGameRepair(ctx, msg.gameId),
  });
  // Fail-loud de la ENTREGA: si un takeover abandona este job, la línea de
  // progreso de la tarjeta se queda girando para siempre (nadie más difunde
  // kind "game_gen").
  void delivery.then((res) => {
    if (res.ok) return;
    ctx.difundirDeJuego({
      type: "narrative_status",
      phase: "error",
      kind: "game_gen",
      gameId: msg.gameId,
      message: `La cura del mundo de "${msg.gameId}" no llegó a correr: ${res.error}`,
    });
  });
  ctx.send(ws, {
    type: "game_world_repaired",
    requestId: msg.requestId,
    ok: true,
    gameId: msg.gameId,
    queued,
  });
}

/** Corre DENTRO de la cola. Cuatro desenlaces, y son cuatro a propósito:
 *   · takeover ⇒ aborta SIN ESCRIBIR (el fichero queda intacto);
 *   · alguna se cura y otra no ⇒ se escribe igual, `ready` + «Fallos
 *     parciales», y la que falló vuelve ROTA al fichero — que es lo que
 *     mantiene vivo el aviso «N de M escenas» del título;
 *   · NINGUNA se cura ⇒ `error` y NO se escribe: un `generated_at` nuevo sin
 *     contenido nuevo es una mentira sobre el fichero;
 *   · la escritura falla ⇒ `error`, porque aquí la escritura ES el entregable. */
export async function runGameRepair(ctx: BridgeContext, gameId: string): Promise<SceneGenOutcome> {
  const start = Date.now();
  const status = (phase: "generating" | "progress" | "ready" | "error", message: string): void =>
    ctx.difundirDeJuego({
      type: "narrative_status",
      phase,
      kind: "game_gen",
      gameId,
      message,
      elapsedMs: Date.now() - start,
    });
  try {
    return await conSesionEfimeraDeJuego(ctx, gameId, async ({ meta, worldDocHash }) => {
      // Se vuelve a leer DENTRO del job y no se pasa lo que vio el handler: el
      // fichero pudo cambiar mientras el job esperaba en la cola, y curar
      // contra una foto vieja escribiría encima de un mundo que ya no es ése.
      const plan = loQueHayQueCurar(ctx.gamesDir, gameId, worldDocHash);
      if (!plan.ok) {
        status("error", `No se pudo curar el mundo de ${meta.title}: ${plan.error}`);
        return { delivered: true };
      }
      const total = plan.cribadas.length;
      status(
        "generating",
        `Curando el mundo de ${meta.title}: ${total} escena(s) que la carga descarta...`,
      );

      // El mundo SERVIBLE entra en la sesión efímera sin activar ni difundir —
      // el cuerpo que comparte con `replayWorldSnapshot`, del que aquí sobra el
      // broadcast: no hay ningún jugador al que enseñarle una escena. Sin
      // esto, el motor generaría los tiles cribados SIN las costuras de sus
      // vecinos y el validador los rechazaría todos.
      restaurarMundoServible(ctx, plan.worldMap, plan.servibles);

      const fallos: string[] = [];
      let curadas = 0;
      for (const [i, { sceneId, tx, ty }] of plan.cribadas.entries()) {
        status("progress", `Curando ${sceneId} (${i + 1}/${total})...`);
        try {
          const hecho = await generateTileScene(ctx, tx, ty);
          if (hecho === "exists") {
            // No debería ocurrir —las cribadas son justo las que NO se
            // registran— y por eso se DICE en vez de contarse como cura: si
            // alguien hiciera que el plan apuntara a un tile ya cargado, el
            // motor no generaría nada y el contador diría que sí.
            fallos.push(`${sceneId}: ya estaba cargado en la sesión, el motor no generó nada`);
            continue;
          }
          curadas += 1;
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          // Un takeover de sesión aborta el job entero, no solo la escena: lo
          // que venga después ya no sería de este mundo.
          if (msg.includes("la sesión activa cambió")) throw err;
          console.warn(`Bridge: cura de ${sceneId} (${tx},${ty}) falló:`, err);
          fallos.push(`${sceneId}: ${msg}`);
        }
      }

      if (curadas === 0) {
        status(
          "error",
          `No se pudo curar ninguna de las ${total} escena(s) de ${meta.title}: ` +
            `${fallos.join(" · ")}`,
        );
        return { delivered: true };
      }
      // CONSERVA y no reemplaza: lo que no se curó tiene que volver al fichero
      // TAL CUAL. Con `reemplaza` desaparecería, y el chip del título pasaría
      // de avisar «7 de 9 escenas» a decir «✓ generado» sobre un mundo al que
      // le faltan dos — el fallo que más se parece a un acierto.
      const escritura = writeSessionSnapshot(
        ctx,
        gameId,
        plan.entrySceneId,
        "conserva-el-mundo-en-disco",
      );
      if (!escritura.escrito) {
        status(
          "error",
          `Se curaron ${curadas} escena(s) de ${meta.title} pero el mundo NO se pudo guardar ` +
            `(${escritura.motivo}): el fichero sigue como estaba`,
        );
        return { delivered: true };
      }
      const partes = [
        `Mundo de ${meta.title} curado: ${curadas} de ${total} escena(s), ` +
          `${escritura.escenas} en el fichero.`,
      ];
      if (fallos.length) {
        partes.push(`Fallos parciales (se generarán en partida): ${fallos.join(" · ")}`);
      }
      status("ready", partes.join(" "));
      return { delivered: true };
    });
  } catch (err) {
    console.warn(`Bridge: repair_game_world "${gameId}" falló:`, err);
    status("error", `La cura del mundo falló: ${(err as Error).message ?? err}`);
    return { delivered: true };
  }
}
