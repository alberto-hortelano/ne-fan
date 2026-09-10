/** EL config de combate del cliente, parseado UNA vez y con el fail-loud que
 *  le faltaba.
 *
 *  Hasta #539 lo cargaban dos módulos por su cuenta (`main.ts` y
 *  `ui/hud-de-combate.ts`), los dos en la evaluación de su módulo y los dos
 *  llamando a `loadConfig`, que LANZA. Un `combat_config.json` roto —y es un
 *  fichero que se edita a mano a propósito: «editable sin recompilar» es lo que
 *  promete `CLAUDE.md`— tiraba la evaluación de la raíz antes de que existiera
 *  un solo pintor de avisos: pantalla NEGRA, el motivo solo en la consola del
 *  navegador, y el launcher diciendo «bridge did not come up» sin la causa.
 *
 *  Aquí se comprueba una vez, se dice por los DOS canales de la casa —el
 *  registro de errores (`errors.push`, que es lo que se lee al depurar) y la
 *  pantalla de quien juega (`muroDeArranque`, porque el pintor normal todavía
 *  no existe)— y se vuelve a lanzar: sin estos números no hay partida, y
 *  seguir con un default escondido sería la mentira que #241 vino a cerrar.
 *
 *  El QUÉ está mal lo dice core (`motivoDeConfigInvalido`), que es donde vive
 *  el criterio y donde lo mide la mutación; aquí solo se elige el canal. */

import combatConfigJson from "@nefan-core/data/combat_config.json";
import { loadConfig, motivoDeConfigInvalido } from "@nefan-core/src/combat/combat-data.js";
import type { CombatConfig } from "@nefan-core/src/types.js";
import { errors } from "./ui/error-log.js";
import { muroDeArranque } from "./ui/muro-de-arranque.js";

/** El titular con el que un config imposible llega a quien juega. Texto de
 *  producto: dice qué está roto PARA ÉL, no dónde. El «dónde» —el campo y el
 *  fichero— va en el detalle, que es el mismo `message` del registro. */
export const AVISO_CONFIG_DE_COMBATE = "El juego no ha podido arrancar";

function cargar(): CombatConfig {
  const motivo = motivoDeConfigInvalido(combatConfigJson);
  if (motivo === null) return loadConfig(combatConfigJson);
  // El registro se engancha a su caja AQUÍ y no se espera a que lo haga
  // `main.ts`: esa línea está más abajo en la misma evaluación que estamos a
  // punto de abortar, así que confiar en ella dejaría la entrada solo en
  // memoria y en la consola. La de `main.ts` sigue donde está y es idempotente
  // (misma caja, mismo render).
  const caja = document.getElementById("error-log");
  if (caja) errors.attach(caja);
  errors.push("config", motivo, undefined, { alJugador: AVISO_CONFIG_DE_COMBATE });
  muroDeArranque(AVISO_CONFIG_DE_COMBATE, motivo);
  throw new Error(`CombatData: ${motivo}`);
}

/** El config entero (ataques, armas, matriz táctica y el bloque `player`). */
export const combatConfig: CombatConfig = cargar();

/** Los números del jugador: velocidades, escala de arcade y alcance de la `E`.
 *  Los declara `combat_config.json` y los EXIGE `loadConfig` (#241): aquí no
 *  hay ni multiplicador ni caída a un literal. */
export const playerCfg = combatConfig.player;
