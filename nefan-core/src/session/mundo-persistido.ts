/** EL MUNDO QUE EL JUGADOR DEJÓ: qué vuelve al reanudar y en qué estado.
 *
 *  El estado de combate de un enemigo —**existir** incluido— vivía solo en la
 *  memoria del sim, y al reanudar el mundo se resembraba desde la escena
 *  persistida: un spawn de runtime no está en ninguna escena, así que
 *  desaparecía entero; y lo que sí estaba renacía con la vida del CONTRATO
 *  (`HOSTILE_HEALTH`), no con la que le dejaste — matarlo y volver lo devolvía
 *  vivo y a 60 (#326, y el resucitado que #323 dejó sin issue).
 *
 *  Aquí vive la mitad PURA de la respuesta, y son tres funciones con un solo
 *  criterio detrás: **cada entidad tiene EXACTAMENTE UNA puerta de vuelta, y
 *  la decide el `spawn_reason` que ya está persistido**.
 *
 *   · `spawn_reason: "scene_init"` → vuelve por la ESCENA. El bridge normaliza
 *     el Format D como siempre y `escenaConCombateVivo` le baja la vida al
 *     herido y saca del `npcs[]` al muerto, sobre la copia que sale al wire.
 *   · `spawn_reason: "narrative_request"` → vuelve por el LEDGER.
 *     `spawnsDeRuntime` lo convierte en lo que come `materializeSpawn`, la
 *     puerta única que el cliente ya tenía para las tres clases (npc, objeto,
 *     edificio).
 *
 *  Nunca las dos: `spawnsDeRuntime` no devuelve jamás un `scene_init`, y el
 *  overlay de la escena solo toca lo que la escena ya nombra. Un id que
 *  entrara por las dos sería un enemigo con dos barras al que el sim conoce
 *  una vez — la señal temprana de que alguien abrió una segunda puerta.
 *
 *  POR QUÉ NO ES LA VÍA REVERTIDA (`state-projection.ts`, retirada en #323):
 *  aquella REEMPLAZABA `GameStore.enemies` en cada broadcast con una
 *  proyección del ledger, y como `getEnemyStates` itera esa lista, el primer
 *  tile nuevo borraba del `state_update` a un enemigo que seguía vivo en el
 *  sim. Aquí no se toca el store ni el sim: se escribe sobre el objeto NUEVO
 *  que devuelve `formatDToWorld`, camino del cable, y el alta sigue siendo la
 *  de siempre (cliente → `add_combatants` → `sim.addCombatant`).
 *
 *  Módulo PURO (perímetro `core-puro-sin-node`): entra un save, sale una
 *  escena o una lista. Lo importan el bridge (para el wire) y el cliente
 *  (para el resume), que es exactamente por qué no puede tocar `node:*`.
 */

import type { EntityRecord, SceneRecord } from "../narrative/types.js";
import type { NpcEnElWire, WorldScene } from "../scene/scene-normalize.js";
import { tileWorldRect } from "../scene/tile.js";

/** El runtime de un combatiente que el SAVE sí puede saber: cuánta vida le
 *  queda y sobre cuánta. Las dos, y no solo la primera: sin el denominador,
 *  un herido vuelve con la barra llena (ver `HostileCombat.max_health`). */
export interface EstadoDeCombate {
  health: number;
  max_health: number;
}

/** Qué dice el ledger del combate de una entity. Tres desenlaces DISTINTOS y
 *  ninguno colapsable con otro:
 *
 *   · `ninguno` — no es un combatiente (un aldeano, un barril, una casa). No
 *     es un error y no se reporta: la inmensa mayoría de las entities lo son.
 *   · `combate` — lo es y su bloque está entero.
 *   · `roto` — lo es y su bloque NO sirve. Se dice con el id delante y el
 *     campo que falla, porque un `null` mudo aquí es un enemigo que
 *     desaparece del mundo sin que nadie sepa por qué. */
export type CombateDelLedger =
  | { tipo: "ninguno" }
  | { tipo: "combate"; combate: EstadoDeCombate }
  | { tipo: "roto"; motivo: string };

/** El `spawn_reason` de lo que puso el MOTOR a mitad de partida
 *  (`dispatchConsequences`). El otro valor —`scene_init`— es lo que declara
 *  una escena, y ese vuelve por la escena. */
export const SPAWN_DE_RUNTIME = "narrative_request";

/** Por qué alguien NO vuelve al mundo. Son dos cosas distintas y no se
 *  colapsan: al muerto lo mataste tú (es la decisión del usuario y no hay nada
 *  que decir), y el ilegible es un save que no se puede leer (hay que decirlo,
 *  y decir cuál). */
export type MotivoDeAusencia = { clase: "muerto" } | { clase: "ilegible"; detalle: string };

/** Lo que el mundo sabe de una entity del ledger al armar la escena que sale
 *  al cable: vuelve aquí y con esta vida, o no vuelve y por esto.
 *
 *  `combate: null` NO es «no sé nada de este»: es «este no pelea» — un
 *  aldeano, un barril, una casa. Hasta el 2026-09-01 ese caso se colapsaba con
 *  «no está en el ledger» devolviendo `null` entero, y por eso el tabernero
 *  que había paseado media plaza reaparecía en su celda de spawn al reanudar
 *  (#351): sin estado no había nada que poner encima de la escena. La vida y
 *  la posición son dos hechos distintos sobre la misma entity, y solo uno de
 *  los dos es exclusivo de los que pelean. */
export type EstadoEnElWire =
  | { tipo: "vivo"; combate: EstadoDeCombate | null; posicion: [number, number, number] }
  | { tipo: "no_vuelve"; motivo: MotivoDeAusencia };

/* La posición que la ESCENA declara cuando `escenaConCombateVivo` pone la viva
 * en `position` va en `NpcEnElWire.position_declared` (scene-normalize.ts):
 * desde #378 es un miembro del tipo, no una cadena compartida.
 *
 * No es un apaño de transporte: es lo que mantiene vivo el fail-loud del
 * cliente. Ese candado pregunta «¿esta coordenada es una conversión celda→metro
 * que cae fuera de su tile?», y desde #351 `position` ya no siempre lo es — un
 * NPC que se movió trae la del save. Guardar la declarada aparte es lo que
 * permite seguir midiendo la CONVERSIÓN en vez de exentar al que se movió.
 *
 * La alternativa que se descartó, y por qué: marcar «esta posición es viva, no
 * la mires». Medido, eso APAGA el candado entero — `registerSceneNpcs`
 * (`narrative/npc-records.ts`) mete en el ledger a TODO NPC de escena con la
 * misma conversión celda→metro nada más registrarla, así que a la primera
 * difusión ya estarían todos marcados y la comprobación no volvería a mirar a
 * nadie nunca. Aquí, en cambio, la conversión se sigue midiendo siempre, se
 * haya movido el personaje o no. */

/** Nombre legible de una entity para lo que lee el jugador: el que le puso el
 *  motor, o el id si no tiene (que es lo que hay, no una excusa para callar). */
export function nombreDeEntity(rec: EntityRecord): string {
  const name = rec.data.name;
  return typeof name === "string" && name ? name : rec.id;
}

/** El estado de una entity para el wire —vida y POSICIÓN—, con la precedencia
 *  SIM → LEDGER escrita UNA vez y aquí dentro, donde se puede medir.
 *
 *  El sim primero porque es el único que sabe lo que está pasando AHORA: el
 *  ledger se refresca en cada `save()`, así que en un re-broadcast de un tile
 *  cacheado a mitad de pelea iría un paso por detrás y la vida del HUD daría
 *  un salto hacia arriba al cruzar la costura. El ledger después porque es el
 *  único que sobrevive al proceso: al reanudar, el sim aún no tiene a nadie
 *  más que al jugador.
 *
 *  LA POSICIÓN SIGUE LA MISMA PRECEDENCIA, y a propósito: son dos hechos sobre
 *  la misma entity y tenerlos con reglas de frescura distintas en la misma
 *  función es cómo se acaba con una vida de hace un segundo al lado de una
 *  posición de hace un minuto. Hoy la rama del sim no cambia nada observable
 *  —el cliente CONSERVA la entity que ya tiene y solo usa esta coordenada al
 *  crearla, o sea al reanudar, cuando el sim está vacío—, y está escrita así
 *  igualmente porque el día que eso cambie la respuesta correcta ya está
 *  puesta. El NPC ambiental no pasa por el sim: su posición la mueve
 *  `npc-behavior.ts` sobre `rec.position` EN VIVO, así que el ledger ya es su
 *  fuente fresca.
 *
 *  UN BLOQUE ILEGIBLE NO ES «SIN DATOS»: el que no se puede leer se queda
 *  FUERA, igual que el muerto. Devolverlo como «no sé nada de este» dejaba la
 *  escena con el bloque DERIVADO —siempre entero, siempre a tope de vida— y
 *  entonces el enemigo que el jugador había matado volvía `alive:true, 60/60`
 *  sin una sola línea en pantalla: el peor fallback posible, porque resucita
 *  justo lo que esta tanda promete (QA 2026-08-31, H-2). Quien llama, además,
 *  tiene que DECIRLO por el canal de su capa.
 *
 *  NO devuelve `null` para el que no pelea: devuelve `vivo` con
 *  `combate: null`. Ese `null` de antes era el que dejaba al tabernero sin
 *  estado y por tanto sin posición que devolver (#351). */
export function estadoEnElWire(
  rec: EntityRecord,
  vivo: { health: number; maxHealth: number; position: { x: number; y: number; z: number } } | undefined,
): EstadoEnElWire {
  if (vivo) {
    return vivo.health <= 0
      ? { tipo: "no_vuelve", motivo: { clase: "muerto" } }
      : {
          tipo: "vivo",
          combate: { health: vivo.health, max_health: vivo.maxHealth },
          posicion: [vivo.position.x, vivo.position.y, vivo.position.z],
        };
  }
  const posicion: [number, number, number] = [rec.position[0], rec.position[1], rec.position[2]];
  const guardado = combateDeEntity(rec);
  if (guardado.tipo === "ninguno") return { tipo: "vivo", combate: null, posicion };
  if (guardado.tipo === "roto") {
    return { tipo: "no_vuelve", motivo: { clase: "ilegible", detalle: guardado.motivo } };
  }
  return guardado.combate.health <= 0
    ? { tipo: "no_vuelve", motivo: { clase: "muerto" } }
    : { tipo: "vivo", combate: guardado.combate, posicion };
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Lee el estado de combate persistido de una entity.
 *
 *  Solo mira los DOS números que el runtime escribe (`health` / `max_health`):
 *  son los únicos que el save puede saber y los únicos que hacen falta para
 *  decidir si vuelve, con cuánta vida y sobre qué denominador. El resto del
 *  bloque —arma y personalidad— lo pone el core al derivarlo y lo valida el
 *  cliente en su puerta (`enemigoDesdeCombat`); duplicar aquí esa validación
 *  sería un segundo criterio de «qué es un enemigo utilizable». */
export function combateDeEntity(rec: EntityRecord): CombateDelLedger {
  const bruto = rec.data.combat;
  if (bruto === undefined) return { tipo: "ninguno" };
  if (!esObjeto(bruto)) {
    return { tipo: "roto", motivo: `entity "${rec.id}": data.combat no es un objeto` };
  }
  const health = numero(bruto.health);
  if (health === null) {
    return {
      tipo: "roto",
      motivo: `entity "${rec.id}": combat.health no es un número (${JSON.stringify(bruto.health)})`,
    };
  }
  const maxHealth = numero(bruto.max_health);
  if (maxHealth === null || maxHealth <= 0) {
    return {
      tipo: "roto",
      motivo:
        `entity "${rec.id}": combat.max_health inválido (${JSON.stringify(bruto.max_health)}) — ` +
        `sin denominador la barra de vida miente`,
    };
  }
  return { tipo: "combate", combate: { health, max_health: maxHealth } };
}

/** La world scene tal y como sale al cable, con el mundo VIVO encima.
 *
 *  Devuelve un OBJETO NUEVO y no toca el que recibe. No es higiene: un
 *  derivado de sesión que viva dentro del `scene_data` persistido deja de ser
 *  Format D crudo y el resume lo sirve congelado (las salidas del mapa, hoy
 *  calculadas al servir, son el caso que lo enseñó: #179). Aquí lo persistido
 *  no se entera de que esto existe.
 *
 *  Tres cosas, y las tres sobre `npcs[]`:
 *   · al HERIDO se le baja la vida (y se le pone su denominador),
 *   · al que NO VUELVE se le quita de la lista — el muerto y el que el save no
 *     deja leer. Esa es toda la permanencia de la muerte vista desde el
 *     cliente: un npc que no viene en la escena no se pinta, no se registra en
 *     el sim y no tiene barra, y
 *   · al que SE MOVIÓ se le pone donde estaba (#351). El `npcs[].position` de
 *     la escena persistida es la celda de spawn del Format D: sin esto, el
 *     bandido al que perseguiste media plaza —y el tabernero que se fue a dar
 *     una vuelta— reaparecían en su casilla de salida al reanudar. La vida ya
 *     viajaba desde #326; la posición se guardaba (`narrative-state.ts`) y no
 *     se servía.
 *
 *  La posición DECLARADA no se tira: se guarda en `position_declared`, que es
 *  lo que sigue mirando el fail-loud de conversión celda→metro del cliente
 *  (`npcsFueraDelRect`). Ver el comentario de arriba para por qué no vale con
 *  «marcar» la viva. */
export function escenaConCombateVivo(
  escena: WorldScene,
  estados: ReadonlyMap<string, EstadoEnElWire>,
): WorldScene {
  const vivos: NpcEnElWire[] = [];
  for (const npc of escena.npcs) {
    const estado = estados.get(npc.id);
    if (!estado) {
      vivos.push(npc);
      continue;
    }
    // El muerto NO vuelve —es la decisión del usuario (2026-08-31) hecha
    // visible: matar tiene consecuencia y repoblar es cosa del motor— y el
    // ilegible tampoco, para no resucitarlo con el bloque derivado.
    if (estado.tipo === "no_vuelve") continue;
    const situado: NpcEnElWire = {
      ...npc,
      position: [...estado.posicion],
      position_declared: npc.position,
    };
    if (estado.combate === null || npc.combat === undefined) {
      // No pelea, o pelea pero la escena no lo declara hostil: no hay bloque
      // que sobrescribir. Se conserva tal cual — inventarle un `combat` aquí
      // sería que este módulo decidiera quién pelea, y eso lo deriva el core.
      // La POSICIÓN sí se le pone: moverse no es privilegio de los que pelean,
      // y creerlo es lo que dejó al tabernero volviendo a su celda (#351).
      vivos.push(situado);
      continue;
    }
    vivos.push({
      ...situado,
      combat: {
        ...npc.combat,
        health: estado.combate.health,
        max_health: estado.combate.max_health,
      },
    });
  }
  return { ...escena, npcs: vivos };
}

/** Un NPC de la escena cuya coordenada DECLARADA cae fuera del rect de su
 *  tile: la firma de una conversión celda→metro rota. */
export interface NpcFueraDelRect {
  id: string;
  x: number;
  z: number;
}

/** Rect de un tile en metros mundo (`tileWorldRect`). */
export interface RectDelTile {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** El fail-loud del contrato de posiciones globales: qué NPCs de esta escena
 *  están declarados fuera del rect de su propio tile.
 *
 *  VIVE AQUÍ Y NO EN EL CLIENTE, que es donde estaba hasta el 2026-09-01 como
 *  un bucle suelto dentro de `addTile`. La razón no es orden: es que esta
 *  función y `escenaConCombateVivo` toman la MISMA decisión desde los dos
 *  lados —cuál de las dos coordenadas de un npc es la conversión— y separarlas
 *  es cómo una se afloja sin que la otra se entere. Juntas, quien toque una ve
 *  la otra en la misma pantalla; y aquí hay tests y hay mutación, que en
 *  `nefan-html` no hay ninguna de las dos (#241/#357).
 *
 *  MIDE `position_declared` CUANDO ESTÁ, y `position` cuando no. O sea: mide
 *  siempre la conversión, se haya movido el personaje o no. Es la diferencia
 *  entre esto y «exentar al rehidratado», que es lo que apagaría el candado —
 *  a la primera difusión de una escena TODO npc está ya en el ledger
 *  (`registerSceneNpcs`) y no quedaría nadie a quien mirar.
 *
 *  Cubre MÁS que el bucle que sustituye y no menos: aquel solo miraba a los
 *  recién creados en el cliente (`newNpcs` + `enemies`), así que un npc ya
 *  conocido cuya declaración se hubiera roto no lo veía nadie. */
export function npcsFueraDelRect(
  npcs: readonly NpcEnElWire[],
  rect: RectDelTile,
): NpcFueraDelRect[] {
  const fuera: NpcFueraDelRect[] = [];
  for (const npc of npcs) {
    // El tipo dice «tres números», pero lo que llega es JSON de otro proceso y
    // este candado existe justo para el día en que la conversión escriba algo
    // que no lo es: se mira el valor, no la promesa.
    const declarada: readonly unknown[] = npc.position_declared ?? npc.position;
    const x = numero(declarada[0]);
    const z = numero(declarada[2]);
    // Una coordenada que no es un número finito NO es «está dentro»: es otro
    // fallo de conversión, y colapsarlo con «no hay nada que decir» es
    // exactamente el silencio que esta casa prohíbe.
    if (x === null || z === null) {
      fuera.push({ id: npc.id, x: Number.NaN, z: Number.NaN });
      continue;
    }
    if (x < rect.minX || x >= rect.maxX || z < rect.minZ || z >= rect.maxZ) {
      fuera.push({ id: npc.id, x, z });
    }
  }
  return fuera;
}

/** El rect en metros de cada tile del save. Su UNIÓN es «el mundo conocido»:
 *  `scenes_loaded` nunca se poda, así que todo sitio donde el jugador ha
 *  estado sigue aquí, y una coordenada que no cae en ninguno es una
 *  coordenada donde no hay suelo. Toda escena del save es un tile (#405). */
export function rectsDelMundo(
  scenes: Readonly<Record<string, Pick<SceneRecord, "tile">>>,
): RectDelTile[] {
  const rects: RectDelTile[] = [];
  for (const rec of Object.values(scenes)) {
    rects.push(tileWorldRect(rec.tile.tx, rec.tile.ty));
  }
  return rects;
}

/** Una entity del ledger cuya posición VIVA no cae en ningún tile del save. */
export interface FueraDelMundo {
  id: string;
  nombre: string;
  x: number;
  z: number;
}

/** El fail-loud de la posición VIVA (#382): qué entities del ledger están
 *  donde no hay mundo.
 *
 *  Es el hermano de `npcsFueraDelRect` con OTRA vara, y las dos viven juntas
 *  a propósito. Aquel mide la DECLARADA contra el rect de su propio tile
 *  (la firma de una conversión celda→metro rota); este mide la VIVA —la que
 *  desde #351 sale al cable en `position`— contra la UNIÓN de rects de todos
 *  los tiles del save. La vara es la unión y no «su tile» porque moverse es
 *  legítimo: el enemigo que te persiguió al tile vecino y el aldeano que se fue
 *  a dar una vuelta están en un sitio donde HAY mundo, y acusarlos sería el
 *  falso rojo que hace que un candado se acabe apagando. Lo que no es legítimo
 *  es la coordenada del repro del issue —`[168.25, 0, 168.25]`, `tile_3_3` en
 *  una partida de dos tiles—, que ningún proceso del juego escribe y solo
 *  trae un save corrupto: al jugador le faltaba el tabernero y el panel decía
 *  «— sin errores —».
 *
 *  Con `rects` VACÍO devuelve `[]`, y no es tragarse nada: sin tiles no hay
 *  mundo del que estar fuera (una partida sin escenas). La FORMA de
 *  `position` (tres números finitos) no se
 *  vuelve a comprobar aquí: la garantiza `loadSession` al cargar el save, que
 *  rechaza el fichero nombrando la entidad — una rama para «no es un array»
 *  sería código para un estado que el tipo ya impide. */
export function entidadesFueraDelMundo(
  entities: readonly EntityRecord[],
  rects: readonly RectDelTile[],
): FueraDelMundo[] {
  if (rects.length === 0) return [];
  const fuera: FueraDelMundo[] = [];
  for (const rec of entities) {
    const [x, , z] = rec.position;
    const enAlgunTile = rects.some(
      (r) => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ,
    );
    if (!enAlgunTile) fuera.push({ id: rec.id, nombre: nombreDeEntity(rec), x, z });
  }
  return fuera;
}

/** La frase que lee el JUGADOR cuando su partida pone a alguien donde no hay
 *  mundo: con el nombre y la coordenada, porque es lo que necesita para
 *  decidir si le importa (y para que el fallo se pueda reproducir con el
 *  save delante). En español de España —coma decimal— y sin género (una
 *  tabernera también se pierde). La escena carga igual: esto avisa, no bloquea. */
export function avisoDeFueraDelMundo(fuera: readonly FueraDelMundo[]): string {
  const num = (n: number) => n.toFixed(1).replace(".", ",");
  const coord = (f: FueraDelMundo) => `(${num(f.x)}, ${num(f.z)})`;
  if (fuera.length === 1) {
    return (
      `La partida guardada pone a ${fuera[0].nombre} en ${coord(fuera[0])}, donde no hay mundo: ` +
      `ahí no hay nada que encontrar.`
    );
  }
  const lista = fuera
    .slice(0, 3)
    .map((f) => `${f.nombre} en ${coord(f)}`)
    .join(", ");
  const resto = fuera.length > 3 ? ` y ${fuera.length - 3} más` : "";
  return (
    `La partida guardada pone a ${fuera.length} personajes donde no hay mundo ` +
    `(${lista}${resto}): ahí no hay nada que encontrar.`
  );
}

/** Lo que `materializeSpawn` come: la forma del effect `spawn_entity`, sin el
 *  `eventId` (que es del turno en el que ocurrió, y esto es un resume). */
export interface SpawnDeRuntime {
  entityId: string;
  entityKind: "npc" | "object" | "building";
  /** El rótulo: `data.name` del ledger. Un record sin él no vuelve (se dice). */
  name: string;
  /** La procedencia, si el motor la declaró. NUNCA se inventa: sin ella el
   *  cliente pinta con `name`, en vivo y al reanudar por igual (#397). */
  description?: string;
  position: [number, number, number];
  data: Record<string, unknown>;
}

const CLASES_QUE_VUELVEN = new Set(["npc", "object", "building"]);

/** Las entities que puso el MOTOR a mitad de partida, listas para volver a
 *  materializarse en el cliente.
 *
 *  Devuelve también los `errores`, y no los traga: una entity de runtime que
 *  no se puede rehidratar es algo que el jugador VIO y que al reanudar ya no
 *  está. El caller los manda a su canal (`errors.push("session", …)`).
 *
 *  Lo que NO es un error y por eso no aparece ahí: un muerto. Se salta a
 *  propósito y en silencio — que no vuelva es lo que se pidió. */
export function spawnsDeRuntime(entities: readonly EntityRecord[]): {
  spawns: SpawnDeRuntime[];
  errores: string[];
} {
  const spawns: SpawnDeRuntime[] = [];
  const errores: string[] = [];
  for (const rec of entities) {
    // La puerta única: lo de la escena vuelve por la escena. Sin este filtro
    // un `bandido_1` entraría por los DOS sitios y el jugador vería dos barras.
    if (rec.spawn_reason !== SPAWN_DE_RUNTIME) continue;
    if (!CLASES_QUE_VUELVEN.has(rec.type)) {
      errores.push(
        `«${nombreDeEntity(rec)}» no vuelve al mundo: el juego no sabe pintar nada de ` +
          `tipo "${rec.type}" (esperaba npc|object|building)`,
      );
      continue;
    }
    const combate = combateDeEntity(rec);
    if (combate.tipo === "roto") {
      // Primero lo que le pasa al MUNDO y con el nombre que el jugador conoce;
      // el campo roto va al final y entre paréntesis. Antes esto empezaba por
      // `entity "narr_npc_1788201390_0": combat.max_health inválido
      // (undefined)`, que es exacto para quien programa y no significa nada
      // para quien juega (QA 2026-08-31, H-7).
      errores.push(
        `«${nombreDeEntity(rec)}» no vuelve al mundo: la partida guardada no dice en qué ` +
          `estado quedó (${combate.motivo})`,
      );
      continue;
    }
    if (combate.tipo === "combate" && combate.combate.health <= 0) continue;
    const data = rec.data;
    const nombre = data.name;
    if (typeof nombre !== "string" || nombre.trim().length === 0) {
      // INALCANZABLE por contrato: `loadSession` rechaza el save entero si un
      // record no trae `data.name` (#397), así que este ledger no existe sin
      // nombres. Aquí vivía una rama que lo dejaba fuera «y lo decía»; QA la
      // cazó como segundo criterio (el bridge resembraba el sim igual: «anda
      // invisible»). Un lector no decide: si llega aquí, el ledger se saltó la
      // puerta y eso se rompe, no se maquilla.
      throw new Error(
        `«${rec.id}» llegó al resume sin data.name: el save tenía que haberse rechazado al cargarlo`,
      );
    }
    // La procedencia SOLO si el motor la declaró. Aquí se caía a `rec.id`, y el
    // jugador veía al mismo NPC pintado con «an entity» en vivo y con
    // `narr_npc_…` tras reanudar (guion 66).
    const descripcion =
      typeof data.description === "string" && data.description ? data.description : undefined;
    spawns.push({
      entityId: rec.id,
      entityKind: rec.type as SpawnDeRuntime["entityKind"],
      name: nombre,
      ...(descripcion !== undefined ? { description: descripcion } : {}),
      position: [rec.position[0], rec.position[1], rec.position[2]],
      data,
    });
  }
  return { spawns, errores };
}
