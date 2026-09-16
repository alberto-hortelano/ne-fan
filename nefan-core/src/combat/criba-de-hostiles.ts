/** QUÉ PASA CON EL FRAME cuando uno de los enemigos que trae no sirve: el
 *  DESENLACE, que es otra decisión que «qué es un enemigo utilizable» (#529).
 *
 *  El criterio sigue siendo UNO y no vive aquí: `parseHostileCombat`
 *  (`hostil-desde-combat.ts`), el mismo que aplica el cliente en
 *  `enemigoDesdeCombat`. Lo que este módulo decide es qué se hace con el
 *  veredicto, y hasta el 2026-09-14 las dos puertas contestaban distinto con la
 *  misma respuesta:
 *
 *   · el CLIENTE descartaba al enemigo malo y seguía con los demás
 *     (`nefan-html/src/scene/enemigo.ts`: `errors.push`, `return null`);
 *   · el BRIDGE tiraba el FRAME ENTERO —los dos enemigos buenos que venían al
 *     lado incluidos— porque el criterio estaba dentro del `superRefine` de
 *     `EnemySpawnSchema`, y un `add_combatants` que no pasa el intake se
 *     contesta con `kind:"protocolo"`, que es un modal a pantalla completa
 *     («Fallo interno del juego») encima de la partida.
 *
 *  Un solo criterio con dos desenlaces, y mandaba el destructivo: lo midió QA
 *  en la PR 6 de #241 y lo dejó escrito como hallazgo en el guion 90 (A3-bis).
 *  Hoy el intake comprueba la FORMA del frame (que haya `id` y `position`, que
 *  es lo que hace falta para saber a quién dar de alta y dónde) y el desenlace
 *  lo decide esta criba, por enemigo.
 *
 *  Módulo PURO: sin DOM, sin `node:*`, sin zod y sin sim. No da de alta a
 *  nadie —eso es del handler, que es quien tiene el `GameSimulation`— ni
 *  escribe en ningún log: devuelve quién entra, quién no y por qué, y el
 *  llamante lo manda al canal de su capa. Vive aparte de
 *  `hostil-desde-combat.ts` por lo mismo que `status-rotulo` vive aparte de
 *  `status-motivo`: son decisiones distintas sobre el mismo hecho, no
 *  comparten ni una llamada, y el criterio ya mide 137 mutantes. */

import type { EnemyPersonality, Vec3 } from "../types.js";
import { parseHostileCombat, type HostileCombatValidado } from "./hostil-desde-combat.js";

/** Un enemigo tal y como viaja por el cable (`add_combatants` / `load_room`).
 *
 *  Los cuatro campos del bloque `combat` llevan aquí el tipo que el contrato
 *  les promete, pero el intake los deja cruzar con `z.custom` —solo declaran su
 *  tipo, no lo comprueban— así que en runtime pueden ser cualquier cosa. Por
 *  eso los juzga `parseHostileCombat`, que toma `unknown`: el tipo describe la
 *  intención del cliente, no lo que llegó. */
export interface HostilDelCable {
  id: string;
  position: Vec3;
  health: number;
  maxHealth: number;
  weaponId: string;
  personality: EnemyPersonality;
}

/** Un enemigo que SÍ entra, con su bloque ya comprobado.
 *
 *  Lleva el bloque ENTERO y no los cuatro campos sueltos a propósito: los
 *  valores que el handler debe usar son los que devuelve el parser (que
 *  reescribe los tres números de la personalidad ya comprobados), no los del
 *  cable. Con el bloque entero, dar de alta a un combatiente con el dato sin
 *  comprobar exige volver a `msg.enemies`, que se ve en el diff.
 *
 *  Y se llama `hostil`, como en el cliente (`comprobado.hostil`), no `combat`:
 *  `alta.combat.health` es LITERALMENTE el patrón que la regla
 *  `la-logica-de-juego-no-vuelve-al-cliente` prohíbe en el bridge —es como se
 *  escribe un parser— y lo delató con 14 violaciones antes de que este módulo
 *  llegara a ningún test. El nombre dice que el bloque ya pasó por la puerta. */
export interface AltaDeHostil {
  id: string;
  position: Vec3;
  hostil: HostileCombatValidado;
}

/** Un enemigo que NO entra, con el motivo del parser VERBATIM.
 *
 *  El motivo es el mismo string que el jugador lee en su registro cuando el
 *  que descarta es su cliente (guion 90, bloque B): es lo único que hace
 *  verdad «un solo criterio», así que aquí no se reescribe ni se traduce. */
export interface DescarteDeHostil {
  id: string;
  motivo: string;
}

/** Quién entra y quién no, de un frame. No es un `Result`: un frame con un
 *  enemigo malo NO es un error del frame — ése era justamente el desenlace que
 *  #529 retira. */
export interface CribaDeHostiles {
  altas: AltaDeHostil[];
  descartes: DescarteDeHostil[];
}

/** Pasa por el criterio ÚNICO a cada enemigo del frame, uno a uno.
 *
 *  El orden de `altas` es el del frame, y un frame sin enemigos da dos listas
 *  vacías (no es un caso de error: `load_room` de una fixture sin hostiles lo
 *  manda así). */
export function cribarHostiles(enemies: readonly HostilDelCable[]): CribaDeHostiles {
  const altas: AltaDeHostil[] = [];
  const descartes: DescarteDeHostil[] = [];
  for (const e of enemies) {
    // El cable lleva el bloque desmontado y en camelCase; es el MISMO bloque
    // que la escena, el effect del spawn y el save le dan al parser.
    const r = parseHostileCombat({
      health: e.health,
      max_health: e.maxHealth,
      weapon_id: e.weaponId,
      personality: e.personality,
    });
    if (!r.ok) {
      descartes.push({ id: e.id, motivo: r.error });
      continue;
    }
    altas.push({ id: e.id, position: e.position, hostil: r.hostil });
  }
  return { altas, descartes };
}

/** La línea que lee QUIEN JUEGA cuando algo del lote no entró, o `null` si
 *  entró todo.
 *
 *  `null` y no la cadena vacía: es el llamante quien decide no avisar, y con
 *  `null` esa decisión se lee en el `if` en vez de colarse como un aviso en
 *  blanco. Dice CUÁNTOS de cuántos porque es la mitad de la noticia que el
 *  jugador no puede ver: que los demás sí entraron.
 *
 *  Va a la línea de mensajes (`kind:"combatientes"` → `destino:"log"` en
 *  `status-rotulo.ts`) y no a un modal: la partida sigue, y lo que falta es un
 *  enemigo, no el mundo. */
const MOTIVO_LEGIBLE = "sus datos de combate no son válidos";

/** El mismo aviso en ambas puertas; el diagnóstico del parser queda intacto. */
export function avisoDeHostilDescartado(id: string, motivo: string): { message: string; detalleTecnico: string } {
  return {
    message: `No pudo aparecer un enemigo: ${MOTIVO_LEGIBLE}.`,
    detalleTecnico: `enemigo "${id}" descartado: ${motivo}`,
  };
}

export function avisoDeCriba(criba: CribaDeHostiles): { message: string; detalleTecnico: string } | null {
  if (criba.descartes.length === 0) return null;
  const total = criba.altas.length + criba.descartes.length;
  const lista = criba.descartes.map((d) => avisoDeHostilDescartado(d.id, d.motivo).detalleTecnico).join("; ");
  return {
    message: `Enemigos que no entraron al mundo (${criba.descartes.length} de ${total}): ${MOTIVO_LEGIBLE}. Consulta el registro de errores.`,
    detalleTecnico: lista,
  };
}
