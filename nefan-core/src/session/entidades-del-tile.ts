/** QUÉ HACE UN TILE CON LO QUE YA HAY EN EL MUNDO CUANDO SE VUELVE A EMITIR.
 *
 *  Un tile no se emite una vez: se re-emite al volver a él, al reanudar la
 *  partida y cada vez que el bridge lo re-difunde desde caché. La pregunta de
 *  este módulo es siempre la misma —**¿qué pasa con lo que ya estaba?**— y
 *  hasta hoy tenía DOS respuestas dentro de la misma función del cliente
 *  (#379):
 *
 *   · a los NPCs y enemigos con id ya presente se les CONSERVABA la entity
 *     (recrearlos los teletransportaría a su celda de spawn y perderían el
 *     skin en vuelo), y
 *   · a los objetos y edificios se les EMPUJABA siempre, con una purga encima
 *     que los quitaba antes: el efecto neto era recrear la entity entera.
 *
 *  Los dos razonamientos no pueden ser ambos correctos sobre el mismo bloque.
 *  Recrear solo era inofensivo mientras el objeto no tuviera ningún estado
 *  vivo — que es una coincidencia, no un invariante, y se rompe en silencio el
 *  día que lo tenga. Y sostener esa asimetría costaba un filtro extra
 *  (`!ids.has(o.id)`) cuyo único trabajo era tapar el duplicado que ella misma
 *  causaba.
 *
 *  LA POLÍTICA ELEGIDA ES CONSERVAR, Y ES UNA SOLA PARA LAS TRES CLASES:
 *
 *   · lo que este tile declara y YA ESTÁ en el mundo → se **conserva** la
 *     entity, pasa a ser de este tile (pudo llegar paseando del vecino, o
 *     haberlo puesto el motor a mitad de partida) y se le re-aplican los
 *     campos que el tile DECLARA;
 *   · lo que este tile declara y no está → se **crea**;
 *   · lo que es de ESTE tile y el tile ya no declara → se **retira**. De otro
 *     dueño no se retira nada: la pregunta al purgar es «¿de quién era esto?»
 *     y no «¿dónde ha acabado?» (#350).
 *
 *  QUÉ ES «DECLARADO» Y QUÉ ES «VIVO», que es la otra mitad de la respuesta y
 *  aquí se escribe una vez. Declarado es lo que sale de este módulo: el
 *  identificador, dónde lo pone el tile, cómo se llama, de qué tamaño y forma
 *  es. Vivo es lo que tiene una FUENTE distinta del tile —la posición y el
 *  rumbo que mueve el bridge, la vida que resuelve el sim, el skin que está en
 *  vuelo— y por eso el llamante re-aplica lo declarado sobre lo que conserva
 *  SALVO donde pisaría a una de esas fuentes. Un objeto no tiene ninguna, así
 *  que su posición es declarada y se le re-aplica; un NPC sí las tiene, así
 *  que la suya no. No son dos políticas: es la misma regla leída sobre dos
 *  clases que no tienen las mismas fuentes vivas.
 *
 *  Módulo PURO (perímetro `core-puro-sin-node`): entra lo que hay y lo que el
 *  tile dice, sale un reparto. Lo consume el cliente en el navegador, que es
 *  exactamente por qué no puede tocar `node:*` — y por qué vive aquí y no en
 *  `nefan-html`, donde no hay ni tests ni mutación que puedan ponerse rojos
 *  (#241/#357). Es vecino de `mundo-persistido.ts` por la misma razón por la
 *  que se mudó ahí `npcsFueraDelRect`: son las dos mitades de «qué vuelve al
 *  mundo».
 */

/** DE QUIÉN ES UNA ENTITY, que es lo mismo que decir quién puede borrarla.
 *
 *  Dos procedencias y ninguna colapsable: lo que DECLARA un tile (y por tanto
 *  desaparece cuando ese tile deja de declararlo) y lo que puso el motor
 *  narrativo a mitad de partida (`spawn_entity`), que no pertenece al scene
 *  data de nadie.
 *
 *  Es una unión discriminada y OBLIGATORIA, y ahí está el arreglo de #350.
 *  Antes esto era `tileKey?: string`, y entonces «es de runtime» y «se me
 *  olvidó ponerlo» eran el mismo `undefined`. De esa confusión salió el bug:
 *  `materializeSpawn` no escribía `tileKey` en ninguna de sus tres clases, así
 *  que la purga de NPCs (por identidad) dejaba vivo al spawn de runtime… y la
 *  de objetos, que era por GEOMETRÍA (`!inRect`), se llevaba por delante el
 *  cofre y la forja en cuanto el tile se volvía a difundir. Con `dueno`
 *  obligatorio, el estado malo no se puede escribir: `tsc` exige los sitios
 *  que construyen una `Entity`.
 *
 *  VIVE EN CORE Y NO EN `renderer/types.ts`, que es de donde viene (#379): de
 *  quién es una entity gobierna la PURGA, no cómo se dibuja. Estaba en el
 *  contrato del renderer solo porque `Entity` estaba allí. */
export type DuenoDeEntity =
  /** Lo declara el scene data de este tile: se va cuando deje de declararlo. */
  | { de: "tile"; key: string }
  /** Lo puso el motor a mitad de partida: no es de ningún tile, y solo
   *  desaparece si el motor lo retira o el jugador lo mata. */
  | { de: "runtime" };

/** ¿Es esta entity de ESTE tile? La condición de la purga, escrita una vez. */
export function esDeEsteTile(dueno: DuenoDeEntity, key: string): boolean {
  return dueno.de === "tile" && dueno.key === key;
}

/** Lo único que el reparto necesita saber de algo que ya está en el mundo: su
 *  identidad y de quién es. Lo demás (dónde está, cuánta vida le queda, qué
 *  sprite lleva) no entra en la decisión, y por eso este módulo no lo pide. */
export interface EnElMundo {
  id: string;
  dueno: DuenoDeEntity;
}

export interface Punto {
  x: number;
  y: number;
  z: number;
}

/** Lo que un tile DECLARA de un objeto o edificio, ya leído del scene data.
 *  Todo lo de aquí lo decide el tile: al re-emitirse, todo esto se re-aplica
 *  sobre la entity conservada — un objeto no tiene ninguna fuente viva que
 *  pudiera pisarse, así que su posición también entra. */
export interface ObjetoDeclarado {
  id: string;
  pos: Punto;
  /** La ETIQUETA del motor (`name`): lo que el jugador lee al mirarlo. La
   *  `description` de la world scene no se lee aquí a propósito: es la
   *  PROCEDENCIA del arte (el texto que se dio al modelo), y el cliente, que
   *  solo pinta, no tiene nada que hacer con ella (#238). */
  nombre: string;
  /** item | prop | building | decor | terrain (default `prop`). */
  categoria: string;
  /** Huella en metros sobre el plano XZ (`scale[0]`, `scale[2]`). */
  sizeXZ?: { x: number; z: number };
  /** Alto en metros (`scale[1]`). */
  sizeY?: number;
  /** Pista de forma del volumen (cylinder, sphere…). */
  shape?: string;
  /** Volumen del plan que YA lo pinta en el greybox (`volume_id`). */
  volumeId?: string;
}

/** Lo que un tile DECLARA de un NPC. `pos` es la CELDA DE SPAWN convertida a
 *  metros: al conservar no se re-aplica, porque la posición autoritativa de un
 *  personaje la mueve el bridge y re-aplicarla lo teletransportaría. */
export interface NpcDeclarado {
  id: string;
  pos: Punto;
  nombre?: string;
  descripcion?: string;
  /** Ref de personaje elegida por el motor (`style_ref`). */
  styleRef?: string;
  /** Rol del mundo (guard, merchant…) — de él sale la ref del skin por defecto. */
  role?: string;
  /** El bloque de combate que derivó el core para un `role:"hostile"`. Su
   *  PRESENCIA es lo que distingue a un enemigo de un vecino; su contenido lo
   *  valida el cliente en su puerta (`enemigoDesdeCombat`), y duplicar aquí
   *  esa validación sería un segundo criterio de «qué es un enemigo». */
  combat?: unknown;
}

/** Lo que el tile declara, más lo que declara MAL.
 *
 *  Los errores no se tragan y no se colapsan con «no hay nada»: una
 *  declaración rota es algo que el motor puso y que el jugador no va a ver, y
 *  hay que decir cuál y por qué. El llamante los manda al canal de su capa
 *  (`errors.push("scene", …)`), igual que hace con los de `spawnsDeRuntime`. */
export interface Declaraciones<D> {
  declaradas: D[];
  errores: string[];
}

/** El reparto: qué se conserva (con lo que el tile declara de ello ahora), qué
 *  se crea y qué se retira. */
export interface RepartoDelTile<D> {
  conservar: { id: string; declarado: D }[];
  crear: D[];
  retirar: string[];
}

/** LA POLÍTICA ÚNICA DE RE-EMISIÓN. Ver la cabecera del módulo.
 *
 *  `presentes` son las entities que el mundo ya tiene de esta clase (para los
 *  personajes, NPCs y enemigos JUNTOS: un id declarado en `npcs[]` puede haber
 *  entrado como enemigo, y buscarlo en una sola de las dos listas es cómo se
 *  duplica). `key` es el tile que se está emitiendo. */
export function repartoDelTile<D extends { id: string }>(
  presentes: readonly EnElMundo[],
  declarados: readonly D[],
  key: string,
): RepartoDelTile<D> {
  const porId = new Map(declarados.map((d) => [d.id, d]));
  const conservar: { id: string; declarado: D }[] = [];
  const retirar: string[] = [];
  const yaEstaban = new Set<string>();
  for (const presente of presentes) {
    const declarado = porId.get(presente.id);
    if (declarado !== undefined) {
      conservar.push({ id: presente.id, declarado });
      yaEstaban.add(presente.id);
      continue;
    }
    if (esDeEsteTile(presente.dueno, key)) retirar.push(presente.id);
  }
  return { conservar, crear: declarados.filter((d) => !yaEstaban.has(d.id)), retirar };
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Texto NO VACÍO, o nada. El vacío se colapsa con la ausencia a propósito: un
 *  `name: ""` no es un nombre, y tratarlo como tal pinta un rótulo en blanco
 *  sobre la cabeza de alguien. */
function texto(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Los `n` primeros números FINITOS de una lista, o nada. */
function numeros(v: unknown, n: number): number[] | null {
  if (!Array.isArray(v) || v.length < n) return null;
  const cabeza = v.slice(0, n) as unknown[];
  if (!cabeza.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  return cabeza as number[];
}

function punto(v: unknown): Punto | null {
  const n = numeros(v, 3);
  return n === null ? null : { x: n[0], y: n[1], z: n[2] };
}

/** El recorrido común de las dos listas del scene data. La identidad y la
 *  posición se exigen AQUÍ y para las dos clases por igual: sin id no hay a
 *  quién conservar ni a quién retirar, y sin posición no hay dónde pintarlo.
 *
 *  Un id REPETIDO dentro del mismo tile es una declaración rota y se dice: es
 *  la forma exacta del duplicado que el filtro `!ids.has(o.id)` del cliente
 *  tapaba sin nombrarlo (#379). Entra el primero; el segundo se reporta. */
function declaraciones<D extends { id: string }>(
  raw: unknown,
  que: string,
  leer: (rec: Record<string, unknown>, id: string, pos: Punto) => D,
): Declaraciones<D> {
  const declaradas: D[] = [];
  const errores: string[] = [];
  if (raw === undefined || raw === null) return { declaradas, errores };
  if (!Array.isArray(raw)) {
    errores.push(`el tile declara sus ${que}s en algo que no es una lista`);
    return { declaradas, errores };
  }
  const vistos = new Set<string>();
  for (const [i, rec] of raw.entries()) {
    if (!esObjeto(rec)) {
      errores.push(`${que} [${i}]: la declaración no es un objeto`);
      continue;
    }
    const id = texto(rec.id);
    if (id === undefined) {
      errores.push(`${que} [${i}]: sin id, así que no hay nada que pintar ni que purgar`);
      continue;
    }
    if (vistos.has(id)) {
      errores.push(`${que} "${id}": declarado dos veces en el mismo tile; solo entra el primero`);
      continue;
    }
    const pos = punto(rec.position);
    if (pos === null) {
      errores.push(
        `${que} "${id}": position no son tres números (${JSON.stringify(rec.position)}), ` +
          `así que no hay dónde ponerlo`,
      );
      continue;
    }
    vistos.add(id);
    declaradas.push(leer(rec, id, pos));
  }
  return { declaradas, errores };
}

function leerObjeto(rec: Record<string, unknown>, id: string, pos: Punto): ObjetoDeclarado {
  const escala = numeros(rec.scale, 3);
  const shape = texto(rec.shape);
  const volumeId = texto(rec.volume_id);
  return {
    id,
    pos,
    nombre: texto(rec.name) ?? "",
    categoria: texto(rec.category) ?? "prop",
    ...(escala ? { sizeXZ: { x: escala[0], z: escala[2] }, sizeY: escala[1] } : {}),
    ...(shape ? { shape } : {}),
    ...(volumeId ? { volumeId } : {}),
  };
}

function leerNpc(rec: Record<string, unknown>, id: string, pos: Punto): NpcDeclarado {
  const nombre = texto(rec.name);
  const descripcion = texto(rec.description);
  const styleRef = texto(rec.style_ref);
  const role = texto(rec.role);
  return {
    id,
    pos,
    ...(nombre ? { nombre } : {}),
    ...(descripcion ? { descripcion } : {}),
    ...(styleRef ? { styleRef } : {}),
    ...(role ? { role } : {}),
    ...(rec.combat !== undefined ? { combat: rec.combat } : {}),
  };
}

/** Los objetos y edificios que declara la world scene de un tile. */
export function objetosDeclarados(raw: unknown): Declaraciones<ObjetoDeclarado> {
  return declaraciones(raw, "objeto", leerObjeto);
}

/** Los personajes que declara la world scene de un tile (vecinos y hostiles:
 *  los separa la presencia de `combat`, y esa puerta es del cliente). */
export function npcsDeclarados(raw: unknown): Declaraciones<NpcDeclarado> {
  return declaraciones(raw, "npc", leerNpc);
}
