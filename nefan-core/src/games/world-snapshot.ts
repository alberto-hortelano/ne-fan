/** Snapshot de mundo pre-generado — el contenido de la génesis de un juego
 *  (world map + escenas Format D expandidas + escena de entrada) persistido
 *  como artefacto de primera clase en `data/games/{id}/world/tile.json`.
 *
 *  "tile" es la FORMA del contenido (el plano continuo de 64 m), no el
 *  nombre de una vista: no hay eje de vistas que elegir, y el fichero se
 *  llama así porque eso es lo que hay dentro. El contenido es 100%
 *  independiente del ESTILO visual: su clave de invalidación es
 *  `world_doc_hash` (editar world.md lo deja stale). Los assets de imagen
 *  por estilo se registran aparte (`world/styles/`).
 *
 *  Lo escriben el bootstrap vivo (pasivamente, al terminar), el job
 *  `generate_game` (anillo 3×3 + places clave), la entrada regenerada en el
 *  mapa del fichero (#578) y la cura (#577); lo consume `start_session`
 *  replayéandolo por la ruta normal (recordSceneLoaded + broadcastScene).
 *  Sustituye al viejo InitialSceneCache dev-only. */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { createHash } from "node:crypto";

import { SAFE_ID, loadWorldDoc } from "./loader.js";
import { ExpandedSceneSchema } from "../contract/model-io/scene-schema.js";
import { validateScene } from "../scene/scene-validate.js";
import { WorldMapSchema } from "../contracts/world-map-schema.js";
import type { WorldMap } from "../world-map/types.js";
import { caminoDeArranque, type CargaDelFichero } from "../world-map/entrada-del-fichero.js";

/** v2: muere el eje de vistas — el snapshot ya no declara `branch` (había
 *  una sola rama viva y su valor era siempre "tile"). */
export const WORLD_SNAPSHOT_SCHEMA_VERSION = 2;

/** Envoltorio validado por zod. Las escenas pasan aquí el gate ESTRUCTURAL
 *  (`ExpandedSceneSchema .strict()`); el de JUGABILIDAD (`validateScene`) lo
 *  aplica `loadWorldSnapshot` escena a escena, porque «ya se validó al
 *  generarse» no vale: el validador se endurece y el snapshot no se entera.
 *
 *  El `world_map` pasa por `WorldMapSchema` (#578): forma de cada lugar y
 *  enlace, el rect de cada anchor dentro del tile y la integridad referencial
 *  del mapa. Aquí decía que lo re-validaba `WorldMapManager.fromSerialized` al
 *  restaurarlo, y era falso: `fromSerialized` solo lo envuelve, y el campo era
 *  `z.record(unknown)`. Un rect absurdo en el fichero entraba sin juicio. */
export const WorldSnapshotSchema = z
  .object({
    schema_version: z.literal(WORLD_SNAPSHOT_SCHEMA_VERSION),
    game_id: z.string().regex(SAFE_ID),
    /** sha256 del world.md con el que se generó — distinto = stale. */
    world_doc_hash: z.string().min(1),
    generated_at: z.string().min(1),
    world_map: WorldMapSchema,
    /** sceneId → escena Format D EXPANDIDA. Hasta #237 el valor era
     *  `z.record(z.string(), z.unknown())`: la frontera entre las dos
     *  poblaciones existía en el dato (`__expanded`) y estaba VACÍA en el
     *  tipo, así que un snapshot con escenas a medio expandir pasaba el gate
     *  y reventaba después, al pintar. `ExpandedSceneSchema` es el único
     *  schema que describe esta población — el otro (`EmittedSceneSchema`)
     *  describe la contraria y rechaza toda escena expandida por diseño. */
    scenes: z.record(z.string(), ExpandedSceneSchema),
    entry_scene_id: z.string().min(1),
  })
  .strict()
  .superRefine((snap, ctx) => {
    if (!(snap.entry_scene_id in snap.scenes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `entry_scene_id "${snap.entry_scene_id}" no está en scenes`,
      });
    }
  });

export interface WorldSnapshot {
  schema_version: number;
  game_id: string;
  world_doc_hash: string;
  generated_at: string;
  world_map: WorldMap;
  scenes: Record<string, Record<string, unknown>>;
  entry_scene_id: string;
}

export function worldSnapshotPath(gamesDir: string, gameId: string): string {
  if (!SAFE_ID.test(gameId)) {
    throw new Error(`worldSnapshotPath: unsafe gameId "${gameId}"`);
  }
  return join(gamesDir, gameId, "world", "tile.json");
}

/** El fichero, leído y pasado por el gate ESTRUCTURAL, sin juzgar ni la
 *  vigencia ni la jugabilidad. Lo comparten las puertas que SIRVEN
 *  (`juzgarSnapshot`, debajo de `loadWorldSnapshot` y `cargarParaArrancar`) y
 *  la que CONSERVA (`escenasQueSobreviven`), porque el gate es el mismo y lo
 *  que cambia es qué hace cada una con el «no»: las primeras lo devuelven
 *  (y quien lo recibe lanza o degrada REPORTÁNDOLO) y la segunda avisa y
 *  conserva `{}`. Con la
 *  lectura duplicada, endurecer el zod en una dejaba a la otra tragando lo que
 *  la primera rechaza.
 *
 *  Se devuelve `raw`, lo que había EN DISCO, y NO `parsed.data`: el zod es la
 *  PUERTA, no un transformador. Devolver la salida del parseo reescribía el
 *  snapshot en silencio por dos caminos independientes, los dos medidos:
 *    · una `description` de `"  tabernero  "` volvía sin espacios (lo cazó QA);
 *    · un sub-objeto en modo por defecto —`size`, `tile`— PODA sus claves
 *      desconocidas, y eso no lo arregla quitar ningún `.trim()`.
 *  Arreglar solo el primero habría dejado el segundo abierto, así que la regla
 *  va donde vale para los dos: quien valida no se queda con el resultado. Es
 *  lo que hace `validateContract` en todo el resto de la casa. */
type SnapshotEnDisco =
  | { ok: true; snapshot: WorldSnapshot }
  | { ok: false; ausente: true }
  | { ok: false; ausente: false; motivo: string };

function leerSnapshotDeDisco(path: string): SnapshotEnDisco {
  if (!existsSync(path)) return { ok: false, ausente: true };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    return { ok: false, ausente: false, motivo: `world snapshot malformado (${path}): ${(err as Error).message}` };
  }
  const parsed = WorldSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      ausente: false,
      motivo: `world snapshot inválido (${path}): ${parsed.error.message.slice(0, 500)}`,
    };
  }
  return { ok: true, snapshot: raw as WorldSnapshot };
}

/** Carga el snapshot del juego. Ausente → null. Malformado, de otra versión
 *  de schema o con la escena de ENTRADA injugable → throw (fail-loud). Quien
 *  ARRANCA una partida no pasa por aquí sino por `cargarParaArrancar`, que
 *  distingue esos casos en vez de lanzar: una entrada injugable ya no degrada
 *  al bootstrap vivo, se regenera dentro del mapa del fichero (#578).
 *  world_doc_hash distinto del esperado → null + warn (world.md editado:
 *  stale esperable, nunca servir mundo viejo en silencio).
 *
 *  Una escena del ANILLO injugable NO tumba el snapshot: se CRIBA del `scenes`
 *  devuelto con un warn que nombra fichero, escena y motivo (#451). Lo que
 *  cambia respecto de #302 es la GRANULARIDAD del rechazo, no que se deje de
 *  validar: lo que se sirve sigue pasando `validateScene` entero. El tile
 *  cribado no existe para la sesión, así que `request_tile` lo vuelve a pedir
 *  al motor cuando el jugador llegue — «solo se vuelve a pedir el malo».
 *
 *  Y se lo vuelve a pedir en CADA PARTIDA NUEVA mientras nadie lo cure: la
 *  carga no reescribe el fichero (una lectura que escribe sería un segundo
 *  escritor del snapshot). Medido (QA de #451, H-3): `[1,1,1]` llamadas en
 *  tres partidas seguidas; REANUDAR sí es gratis, porque el tile regenerado
 *  vive en el save.
 *
 *  CURARLO SE PIDE DESDE EL TÍTULO (#577, `bridge/handlers/game-repair.ts`):
 *  el botón «Completar el mundo» aparece justo cuando este recuento dice que
 *  faltan escenas, y encarga al motor SOLO las cribadas en una sesión efímera
 *  y sin historia. No se cura al CARGAR, y la razón es de este fichero: aquí
 *  no existe todavía ningún tile bueno con el que curar —el único que hay es
 *  el roto—, así que escribir en esta puerta solo podría BORRAR la escena
 *  cribada: cero llamadas ahorradas y el chip del título pasando de «8 de 9
 *  escenas» a «✓ generado» 8/8, perdiendo el único aviso que tiene el
 *  jugador. */
export function loadWorldSnapshot(
  gamesDir: string,
  gameId: string,
  expectedWorldDocHash: string,
): WorldSnapshot | null {
  return cargarConDetalle(gamesDir, gameId, expectedWorldDocHash).snapshot;
}

/** El fichero leído, fechado y juzgado escena a escena, SIN decidir todavía
 *  qué hacer con el «no». Lo comparten las dos puertas que sirven —
 *  `cargarConDetalle`, que lanza, y `cargarParaArrancar`, que distingue—
 *  para que el validador de la entrada y la criba del anillo sean UN código. */
type Juzgado =
  | { kind: "sin-fichero" }
  | { kind: "ilegible"; motivo: string }
  | { kind: "stale" }
  | {
      kind: "juzgado";
      snapshot: WorldSnapshot;
      servibles: Record<string, Record<string, unknown>>;
      cribadas: string[];
      /** Por qué la ENTRADA no pasa el validador de hoy; `null` si pasa. */
      entradaInjugable: string | null;
    };

function juzgarSnapshot(gamesDir: string, gameId: string, expectedWorldDocHash: string): Juzgado {
  const path = worldSnapshotPath(gamesDir, gameId);
  const leido = leerSnapshotDeDisco(path);
  if (!leido.ok) {
    if (leido.ausente) return { kind: "sin-fichero" };
    // Malformado o de otro schema: el mensaje dice qué hacer.
    return { kind: "ilegible", motivo: `${leido.motivo} — bórralo o regenera el mundo desde el título` };
  }
  const snapshot = leido.snapshot;
  if (snapshot.world_doc_hash !== expectedWorldDocHash) {
    console.warn(
      `world snapshot stale para "${gameId}": world.md cambió desde la ` +
        `generación — se ignora (regenera el mundo desde el título)`,
    );
    return { kind: "stale" };
  }
  // Lo que se carga pasa por el validador de JUGABILIDAD o no se sirve (#302).
  // El zod de arriba dice que la escena está bien FORMADA; esto dice que se
  // puede recorrer con un cuerpo. Va DESPUÉS del hash para no pagar el
  // flood-fill por un snapshot que ya es stale, y va aquí —la única puerta de
  // carga— y no en el replay del bridge, para que el chip del título y
  // `start_session` digan lo mismo con un solo código. `scene-validate.ts` se
  // endureció cinco veces entre el 22-08 y el 04-09: un snapshot generado bajo
  // el validador viejo seguía replayéandose `ready` con un NPC que hoy no cabe.
  // Sin contexto de costuras (`required_crossings: []`, sin `entry`), los
  // tiles del anillo salen con aviso `no-verificado` y NO se rechazan por
  // alcanzabilidad; lo que sí se juzga siempre es el cuerpo de cada NPC
  // (`checkNpcBodies`, #289) y el spawn del jugador en la escena de entrada.
  //
  // La ENTRADA y el ANILLO no pagan lo mismo, y esa es toda la diferencia de
  // #451: sin entrada no hay partida que servir (desde #578 se regenera SOLO
  // ella, dentro del mapa de este fichero), pero un vecino malo solo cuesta
  // el tile que el jugador todavía no ha pisado. Tirar las otras ocho escenas
  // buenas por él obligaba a regenerar el mundo ENTERO con el motor real, y
  // eso pasaba con cada endurecimiento del validador.
  const servibles: Record<string, Record<string, unknown>> = {};
  const cribadas: string[] = [];
  let entradaInjugable: string | null = null;
  for (const [id, scene] of Object.entries(snapshot.scenes)) {
    const esLaEntrada = id === snapshot.entry_scene_id;
    const check = validateScene(scene, {
      required_crossings: [],
      bootstrap: esLaEntrada,
    });
    if (check.ok) {
      servibles[id] = scene;
      continue;
    }
    if (esLaEntrada) {
      entradaInjugable =
        `world snapshot injugable (${path}): la escena "${id}" no pasa el validador de hoy: ` +
        `${check.errors.join(" · ")} — regenera el mundo desde el título`;
      continue;
    }
    cribadas.push(id);
    // UNA LÍNEA POR ESCENA, y no un resumen por carga, aunque se repita: la
    // puerta se atraviesa dos veces por partida (el chip del título y
    // `start_session`), así que con 8 malas salen 16 líneas cada vez que
    // alguien abre el título (QA de #451, H-4). Es ruido y se acepta: lo
    // accionable es el MOTIVO de cada escena —qué NPC, en qué celda—, que es
    // justo lo que un resumen pierde, y el aserto E1 del guion 127 fija el
    // número de hoy para que se entere quien lo empeore.
    console.warn(
      `world snapshot (${path}): la escena "${id}" no pasa el validador de hoy ` +
        `y se CRIBA (el resto del mundo se sirve igual): ${check.errors.join(" · ")} ` +
        `— el motor la regenerará cuando el jugador llegue a ese tile`,
    );
  }
  return { kind: "juzgado", snapshot, servibles, cribadas, entradaInjugable };
}

/** Lo mismo que `loadWorldSnapshot` MÁS el recuento de la criba, en la misma
 *  pasada (#451, hallazgo H-2 de QA).
 *
 *  Existe porque el recuento se sabe aquí dentro y en ningún otro sitio: el
 *  snapshot que sale ya viene cribado, así que quien lo recibe no puede decir
 *  cuántas escenas traía el fichero. Y volver a leerlo desde fuera para
 *  contarlas pagaría un segundo `validateScene` de todo el mundo cada vez que
 *  alguien abre el título.
 *
 *  `loadWorldSnapshot` se queda como la puerta de SIEMPRE —misma firma, mismo
 *  contrato— para que su otro llamante (el batch de estilo) no tenga que
 *  enterarse de nada. */
export function cargarConDetalle(
  gamesDir: string,
  gameId: string,
  expectedWorldDocHash: string,
): { snapshot: WorldSnapshot | null; servibles: number; total: number; cribadas: string[] } {
  const vacio = { snapshot: null, servibles: 0, total: 0, cribadas: [] as string[] };
  const juzgado = juzgarSnapshot(gamesDir, gameId, expectedWorldDocHash);
  if (juzgado.kind === "sin-fichero" || juzgado.kind === "stale") return vacio;
  if (juzgado.kind === "ilegible") throw new Error(juzgado.motivo);
  if (juzgado.entradaInjugable !== null) throw new Error(juzgado.entradaInjugable);
  const { snapshot, servibles, cribadas } = juzgado;
  // El world_map ya pasó `WorldMapSchema` en el gate estructural.
  //
  // Sin nada cribado se devuelve el MISMO objeto: el caso normal no paga ni
  // una copia, y «lo que sale de la puerta es byte a byte lo que hay en
  // disco» sigue siendo literal. Con criba, el envoltorio es nuevo pero las
  // escenas viajan POR REFERENCIA — el zod sigue siendo la puerta, no un
  // transformador. Y la carga NO reescribe el fichero: una lectura que
  // escribe sería un segundo escritor del snapshot, y el único es el bridge.
  const total = Object.keys(snapshot.scenes).length;
  const contado = { servibles: total - cribadas.length, total, cribadas };
  if (cribadas.length === 0) return { snapshot, ...contado };
  return { snapshot: { ...snapshot, scenes: servibles }, ...contado };
}

/** La puerta de `start_session` (#578): lo mismo que `cargarConDetalle`, pero
 *  sin LANZAR en los dos casos en los que el arranque tiene algo que hacer
 *  además de quejarse — el fichero ilegible (siembra, diciéndolo) y la
 *  ENTRADA injugable, que trae el mapa y el anillo servible del fichero para
 *  regenerar solo la entrada dentro de ellos. Qué camino se toma lo decide
 *  `caminoDeArranque` (`world-map/entrada-del-fichero.ts`), que es pura. */
export function cargarParaArrancar(
  gamesDir: string,
  gameId: string,
  expectedWorldDocHash: string,
): CargaDelFichero<WorldSnapshot> {
  const juzgado = juzgarSnapshot(gamesDir, gameId, expectedWorldDocHash);
  if (juzgado.kind === "sin-fichero" || juzgado.kind === "stale") return { kind: "sin-mundo" };
  if (juzgado.kind === "ilegible") return { kind: "ilegible", motivo: juzgado.motivo };
  return cargaDelJuicio(juzgado);
}

/** Un snapshot ya juzgado, en la forma que decide el arranque. */
function cargaDelJuicio(
  juzgado: Extract<Juzgado, { kind: "juzgado" }>,
): Extract<CargaDelFichero<WorldSnapshot>, { kind: "servible" | "entrada-injugable" }> {
  const { snapshot, servibles, cribadas } = juzgado;
  if (juzgado.entradaInjugable !== null) {
    return {
      kind: "entrada-injugable",
      motivo: juzgado.entradaInjugable,
      worldMap: snapshot.world_map,
      anillo: servibles,
      entradaVieja: snapshot.scenes[snapshot.entry_scene_id],
      entrySceneId: snapshot.entry_scene_id,
    };
  }
  // Misma regla de identidad que `cargarConDetalle`: sin criba, el objeto de
  // disco tal cual.
  if (cribadas.length === 0) return { kind: "servible", snapshot };
  return { kind: "servible", snapshot: { ...snapshot, scenes: servibles } };
}

/** Las escenas del snapshot en disco que un write puede CONSERVAR (#451).
 *
 *  `{}` —y el motivo por `console.warn`— si no hay fichero, si el zod lo
 *  rechaza (malformado, otro `schema_version`, escena a medio expandir) o si
 *  su `world_doc_hash` no es el de hoy: conservar contenido de otro world.md
 *  sería blanquear un snapshot stale, que es justo lo que la puerta de carga
 *  se niega a servir.
 *
 *  NO filtra por jugabilidad a propósito: eso lo juzga `loadWorldSnapshot` al
 *  servir, con el validador del día. Aquí solo se decide qué se guarda, y quien
 *  escribe no destruye dato por un juicio que es del que lee.
 *
 *  La consecuencia, que estaba sin declarar (QA de #451, H-5): cuando la cura
 *  de la ENTRADA reescribe el fichero, un tile del anillo que no pasa el
 *  validador vuelve al disco IDÉNTICO, roto. O sea que el fichero no se limpia
 *  nunca POR SÍ SOLO y el aviso de criba es permanente hasta que alguien lo
 *  encargue. Es el precio de no tirar dato del jugador desde el escritor; lo
 *  fija el aserto E3 del guion 127.
 *
 *  Y es también lo que hace que la CURA de #577 pueda escribir con
 *  `conserva-el-mundo-en-disco` sin miedo: la escena que la cura no consiga
 *  arreglar vuelve por aquí tal cual, rota, y el recuento del título sigue
 *  avisando. Con `reemplaza` habría desaparecido del fichero y el aviso con
 *  ella. */
export function escenasQueSobreviven(
  gamesDir: string,
  gameId: string,
  worldDocHash: string,
): Record<string, Record<string, unknown>> {
  const path = worldSnapshotPath(gamesDir, gameId);
  const leido = leerSnapshotDeDisco(path);
  if (!leido.ok) {
    if (!leido.ausente) console.warn(`${leido.motivo} — no se conserva nada de él`);
    return {};
  }
  const snapshot = leido.snapshot;
  if (snapshot.world_doc_hash !== worldDocHash) {
    console.warn(
      `world snapshot en disco (${path}) es de otro world.md: no se conserva ` +
        `nada de él (conservarlo sería blanquear un snapshot stale)`,
    );
    return {};
  }
  return snapshot.scenes;
}

export function writeWorldSnapshot(gamesDir: string, snapshot: WorldSnapshot): void {
  const parsed = WorldSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new Error(`writeWorldSnapshot: snapshot inválido: ${parsed.error.message.slice(0, 500)}`);
  }
  const path = worldSnapshotPath(gamesDir, snapshot.game_id);
  mkdirSync(join(gamesDir, snapshot.game_id, "world"), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
}

/** Borra el snapshot del juego (Regenerar mundo). true si existía. */
export function deleteWorldSnapshot(gamesDir: string, gameId: string): boolean {
  const path = worldSnapshotPath(gamesDir, gameId);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** Estado del contenido pre-generado de un juego, para games_listed (los
 *  chips del título). Degrada por juego: cualquier error ⇒ "stale" con
 *  warning en vez de tumbar el listado (listGames ya filtró los juegos
 *  ilegibles) — cargarlo de verdad (start_session) sigue siendo fail-loud.
 *
 *  Trae además el RECUENTO de la criba (#451, H-2). Hasta que hubo criba, un
 *  `ready` significaba «el mundo entero está ahí» y no hacía falta contar
 *  nada; desde #451 puede significar «queda 1 de 9», y el jugador no tiene
 *  ninguna otra forma de saberlo: el mundo cribado se ve exactamente igual
 *  que uno sano (lo midió QA en pantalla). No es la opción (c) —que el título
 *  DIGA EL MOTIVO del stale, que el usuario descartó—: es un número. */
export interface EstadoDelMundoGenerado {
  estado: "ready" | "stale" | "missing";
  /** Cuántas escenas del fichero puede servir HOY la puerta de carga, de
   *  cuántas hay. `null` cuando no hay fichero que contar (missing, stale, o
   *  ilegible): un 0/0 sería un recuento inventado. */
  escenas: { servibles: number; total: number } | null;
  /** `stale` porque la ENTRADA no pasa el validador de hoy y «Comenzar» la
   *  regenera dentro del mapa del fichero con una llamada (#578): el título
   *  lo dice en vez de mandar regenerar el mundo entero (QA de BE, H1). Un
   *  fichero que además se contradice no lleva la marca: Comenzar no lo
   *  arregla, y ahí sí toca regenerar. */
  entradaARegenerar?: true;
}

export function gameGenerationStatus(gamesDir: string, gameId: string): EstadoDelMundoGenerado {
  try {
    const hash = createHash("sha256")
      .update(loadWorldDoc(gamesDir, gameId), "utf-8")
      .digest("hex");
    if (!existsSync(worldSnapshotPath(gamesDir, gameId))) {
      return { estado: "missing", escenas: null };
    }
    // UNA pasada de la puerta: el recuento y la marca salen del mismo juicio
    // (dos pasadas duplicaban las líneas «se CRIBA» del log, que el guion 127
    // cuenta).
    const juzgado = juzgarSnapshot(gamesDir, gameId, hash);
    if (juzgado.kind === "ilegible") throw new Error(juzgado.motivo);
    if (juzgado.kind !== "juzgado") return { estado: "stale", escenas: null };
    const carga = cargaDelJuicio(juzgado);
    if (carga.kind === "entrada-injugable") {
      const reparable = caminoDeArranque(carga).camino === "entrada-en-el-mapa-del-fichero";
      return { estado: "stale", escenas: null, ...(reparable ? { entradaARegenerar: true as const } : {}) };
    }
    const total = Object.keys(juzgado.snapshot.scenes).length;
    const servibles = total - juzgado.cribadas.length;
    return { estado: "ready", escenas: { servibles, total } };
  } catch (err) {
    console.warn(`gameGenerationStatus("${gameId}"): ${(err as Error).message}`);
    return { estado: "stale", escenas: null };
  }
}

export function worldSnapshotStatus(
  gamesDir: string,
  gameId: string,
  worldDocHash: string,
): "ready" | "stale" | "missing" {
  try {
    const path = worldSnapshotPath(gamesDir, gameId);
    if (!existsSync(path)) return "missing";
    return loadWorldSnapshot(gamesDir, gameId, worldDocHash) ? "ready" : "stale";
  } catch (err) {
    console.warn(`worldSnapshotStatus("${gameId}"): ${(err as Error).message}`);
    return "stale";
  }
}
