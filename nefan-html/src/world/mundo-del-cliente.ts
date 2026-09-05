/** EL MUNDO QUE EL CLIENTE TIENE PINTADO, CON UN SOLO DUEÑO.
 *
 *  Los cuerpos del mundo (NPCs, enemigos, objetos), qué tile está activo, qué
 *  escena es la suya y por dónde se sale de ella vivían como seis `let` de
 *  módulo en `main.ts`, a cientos de líneas de sus consumidores y con seis
 *  escritores repartidos por el fichero. Mientras todo eso estuvo en un solo
 *  fichero de 3.136 líneas era incómodo; al trocearlo pasaba a ser peligroso,
 *  y el riesgo NO es el que suele decirse: escribir desde otro módulo una `let`
 *  importada es `TS2632` y lo caza `tsc --noEmit`. El riesgo real es
 *  DUPLICARLA en vez de moverla — dos copias que compilan limpio y mienten en
 *  silencio, cada una con la mitad de los escritores.
 *
 *  Contra eso el candado es el TIPO, no la disciplina: aquí el estado son
 *  campos `#privados` de JavaScript. No hay binding exportado que copiar, no
 *  hay nada que se pueda escribir desde fuera, y una copia huérfana que
 *  alguien deje atrás la caza `@typescript-eslint/no-unused-vars`, que ya es
 *  `error` en este paquete. La regla `el-mundo-del-cliente-tiene-un-solo-dueño`
 *  (`arch-rules.json`) cubre lo que el tipo no puede: que esos nombres no
 *  vuelvan a nacer como `let` de módulo en ningún sitio del cliente.
 *
 *  LO QUE ESTA CLASE NO HACE, dicho para que no se lea de más: no decide nada
 *  del juego. La política de qué se conserva y qué se retira al re-emitir un
 *  tile vive en `nefan-core` (`session/entidades-del-tile.ts`), que es donde
 *  hay tests y mutación; aquí solo se guardan los cuerpos y se aplica lo que
 *  esa política dice. Y las entities que devuelven los getters son
 *  `readonly Entity[]`: la LISTA es de esta clase, pero los cuerpos son
 *  mutables a propósito — el bucle les escribe cada frame la posición que
 *  manda el bridge, y copiarlos por frame sería tirar el trabajo del sim.
 */

import type { SceneExit } from "@nefan-core/src/protocol/messages.js";
import type { EscenaSinSalidas } from "@nefan-core/src/protocol/escena-servida.js";
import type { Entity } from "../renderer/types.js";

export class MundoDelCliente {
  #npcs: Entity[] = [];
  #enemigos: Entity[] = [];
  #objetos: Entity[] = [];
  #tileActivo: string | null = null;
  #escenaActiva: EscenaSinSalidas | null = null;
  #salidas: SceneExit[] = [];
  #colorDeEnemigo = 0;
  /** Ids que el bridge mueve y este cliente no tiene en escena. Es un DEFECTO
   *  y se reporta UNA vez por id: el `state_update` llega a 60 fps y sin
   *  dedupe el registro de errores sería una línea por frame. */
  #npcsSinCuerpo = new Set<string>();

  get npcs(): readonly Entity[] {
    return this.#npcs;
  }

  get enemigos(): readonly Entity[] {
    return this.#enemigos;
  }

  get objetos(): readonly Entity[] {
    return this.#objetos;
  }

  /** NPCs y enemigos JUNTOS. Es una pregunta que se hace mucho —quién tiene
   *  cuerpo de personaje— y tenerla escrita aquí evita que cada llamante
   *  recuerde que un id declarado en `npcs[]` puede haber entrado como
   *  hostil. */
  get personajes(): readonly Entity[] {
    return [...this.#npcs, ...this.#enemigos];
  }

  /** Clave del tile bajo el jugador (`null` = mundo vacío). */
  get tileActivo(): string | null {
    return this.#tileActivo;
  }

  /** La world scene del tile activo, SIN las salidas (`salidas` va aparte,
   *  #410): decide si el juego está «listo», y el hook `__nefan.scene` la
   *  vuelve a juntar con las salidas para publicar la forma del wire. */
  get escenaActiva(): EscenaSinSalidas | null {
    return this.#escenaActiva;
  }

  /** Salidas del world-map de la escena activa: la otra mitad del wire, que
   *  cambia con el mapa (`exits_changed`) sin que la escena se toque. */
  get salidas(): readonly SceneExit[] {
    return this.#salidas;
  }

  /** Vacía el mundo (arranque de sesión, resume, fixtures). Es la mitad de
   *  `resetWorld` que le toca a esta clase: lo que se va con el mundo se va
   *  AQUÍ, y quien añada un campo nuevo lo ve al lado. */
  vaciar(): void {
    this.#npcs = [];
    this.#enemigos = [];
    this.#objetos = [];
    this.#tileActivo = null;
    this.#escenaActiva = null;
    this.#salidas = [];
    this.#colorDeEnemigo = 0;
    this.#npcsSinCuerpo.clear();
  }

  /** Apunta la escena activa del cliente al tile bajo el jugador. */
  activarTile(key: string, escena: EscenaSinSalidas, salidas: SceneExit[]): void {
    this.#tileActivo = key;
    this.#escenaActiva = escena;
    this.#salidas = salidas;
  }

  anadirNpc(entity: Entity): void {
    this.#npcs.push(entity);
  }

  anadirEnemigo(entity: Entity): void {
    this.#enemigos.push(entity);
  }

  anadirObjeto(entity: Entity): void {
    this.#objetos.push(entity);
  }

  /** Saca del mundo lo que el tile que se está emitiendo ya no declara.
   *
   *  Barre las TRES listas con los mismos ids a propósito, y no es descuido: el
   *  id de una entity es único en el mundo entero —es la clave del ledger del
   *  save (`state.entities`), no un índice por lista—, así que un personaje
   *  pudo entrar como vecino o como hostil y la purga no tiene por qué saber
   *  cuál de las dos fue. Si el mismo id llegara a estar en dos listas, eso ya
   *  es el defecto, y sacarlo de las dos es la respuesta correcta. */
  retirar(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const fuera = new Set(ids);
    this.#npcs = this.#npcs.filter((e) => !fuera.has(e.id));
    this.#enemigos = this.#enemigos.filter((e) => !fuera.has(e.id));
    this.#objetos = this.#objetos.filter((e) => !fuera.has(e.id));
  }

  /** El cuerpo con ese id, sea vecino u hostil. */
  personaje(id: string): Entity | undefined {
    return this.#npcs.find((e) => e.id === id) ?? this.#enemigos.find((e) => e.id === id);
  }

  npc(id: string): Entity | undefined {
    return this.#npcs.find((e) => e.id === id);
  }

  enemigo(id: string): Entity | undefined {
    return this.#enemigos.find((e) => e.id === id);
  }

  objeto(id: string): Entity | undefined {
    return this.#objetos.find((e) => e.id === id);
  }

  /** Índice para rotar el color del rótulo entre varios enemigos en pantalla.
   *  Vuelve a cero con el mundo. */
  siguienteColorDeEnemigo(): number {
    return this.#colorDeEnemigo++;
  }

  /** `true` la PRIMERA vez que se ve este id sin cuerpo: es lo que permite
   *  reportar el defecto una vez y no sesenta veces por segundo. */
  esNuevoNpcSinCuerpo(id: string): boolean {
    if (this.#npcsSinCuerpo.has(id)) return false;
    this.#npcsSinCuerpo.add(id);
    return true;
  }
}
