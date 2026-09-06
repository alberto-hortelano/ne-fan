/** Las fixtures del selector «Room»: las escenas Format D de `data/scenes/`
 *  que el cliente carga en LOCAL, sin bridge (preset `html-fixtures`).
 *
 *  Es la ÚNICA normalización del cliente (`addTileRaw` → `formatDToWorld`):
 *  sin bridge no hay wire que la haga, y las fixtures son JSON que ya está en
 *  el navegador y que ningún cable ha tocado. La puerta está NOMBRADA en
 *  `arch-rules.json` (`solo-el-bridge-normaliza-la-escena`): una segunda
 *  llamada en este fichero, o una en cualquier otro del cliente, salta.
 *
 *  Este módulo tiene el desplegable (`#room-selector`), el glob de fixtures y
 *  las dos piezas de estado que el `<select>` no sabe guardar; `main.ts` le da
 *  la carga de tile, el vaciado del mundo y la línea del juego. */

import { formatDToWorld } from "@nefan-core/src/scene/scene-normalize.js";
import { etiquetaDeFixture, motivoDeFixtureParaElJugador } from "@nefan-core/src/protocol/status-motivo.js";
import { paso } from "../ui/async-ui.js";
import type { CargaDeTile, OpcionesDeCarga } from "./carga-de-tile.js";

// Glob import all open-world scene JSONs (lazy) — Vite feature.
// El concepto sala se ha retirado del cliente HTML: estas fixtures son tiles
// del plano continuo, la única variante de Format D que queda.
const sceneModules: Record<string, () => Promise<{ default: Record<string, unknown> }>> =
  (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<{ default: Record<string, unknown> }>> })
    .glob("@nefan-core/data/scenes/*.json");

export interface DepsDeFixturesDelSelector {
  /** La carga de un tile ya servido (`world/carga-de-tile.ts`): la fixture
   *  entra por ella como un tile cualquiera, con las salidas vacías. */
  addTile: CargaDeTile["addTile"];
  /** Vacía el mundo del cliente antes de TOMARLO con una fixture. */
  resetWorld(): void;
  /** La línea del juego, para decirle a quien juega que una fixture no cargó. */
  log(msg: string): void;
}

export interface FixturesDelSelector {
  /** Rellena el desplegable con las fixtures del glob, etiquetadas por core. */
  poblar(): void;
  /** Format D crudo → escena servida sin salidas → `addTile`. Es también el
   *  hook `window.__nefan.addTileRaw` del banco. */
  addTileRaw(raw: Record<string, unknown>, opts?: OpcionesDeCarga): Promise<void>;
  /** Vacía el mundo y lo TOMA con una escena Format D cruda. */
  loadSceneData(raw: Record<string, unknown>, opts?: OpcionesDeCarga): Promise<void>;
  /** Conduce el `<select>` real por nombre parcial y DEVUELVE la carga. */
  cargarFixture(name: string): Promise<void>;
}

export function crearFixturesDelSelector(deps: DepsDeFixturesDelSelector): FixturesDelSelector {
  const { addTile, resetWorld, log } = deps;
  const sceneSelector = document.getElementById("room-selector") as HTMLSelectElement;

  /** La carga que lanzó el ÚLTIMO `change` del selector «Room», para que quien
   *  lo dispara pueda esperarla.
   *
   *  Existe por #308, y el defecto es el mismo que este cliente ya corrigió en
   *  `debugState`: una superficie de observación que dice «hecho» sin saberlo.
   *  `loadFixture` ponía el `value`, despachaba `change` y devolvía `undefined`;
   *  el import perezoso del JSON resolvía después, así que sus llamantes seguían
   *  midiendo la escena ANTERIOR. `dispatchEvent` es SÍNCRONO —el manejador ha
   *  corrido entero antes de que vuelva—, así que aquí ya está la promesa puesta
   *  cuando el hook la recoge.
   *
   *  Solo la escribe el manejador del `change`, y solo la lee `cargarFixture`
   *  inmediatamente después de dispararlo: no es un estado que sobreviva a nada,
   *  es el valor de retorno que el evento del DOM no sabe devolver. */
  let ultimaCargaDeFixture: Promise<void> | undefined;

  /** La fixture que el desplegable está enseñando DE VERDAD (vacío = ninguna: el
   *  mundo viene del bridge, o aún no se ha elegido). El `<select>` se actualiza
   *  solo al elegir, así que sin esto no hay a dónde volver cuando la carga
   *  falla. */
  let fixtureCargada = "";

  function poblar(): void {
    // Scene fixtures (cargados localmente, sin bridge).
    // La etiqueta sale de core (`etiquetaDeFixture`) y de NINGÚN sitio más: la
    // opción que se pinta y el mensaje de «no cargó» tienen que nombrar lo
    // mismo, y cuando eran dos derivaciones decían cosas distintas (#269).
    const scenes = Object.keys(sceneModules).map((path) => ({
      // La clave que entrega el glob de Vite, medida en el navegador:
      // "../nefan-core/data/scenes/robledo_tile.json" (relativa, no el alias).
      key: path,
      label: etiquetaDeFixture(path),
    }));
    if (scenes.length > 0) {
      const sceneGroup = document.createElement("optgroup");
      sceneGroup.label = "Scene";
      for (const entry of scenes.sort((a, b) => a.label.localeCompare(b.label))) {
        const opt = document.createElement("option");
        opt.value = entry.key;
        opt.textContent = entry.label;
        sceneGroup.appendChild(opt);
      }
      sceneSelector.appendChild(sceneGroup);
    }
  }

  /** La puerta: un tile como cualquier otro, sin salidas (sin bridge no las
   *  hay); la partida usa `addTile` con la escena ya servida. */
  function addTileRaw(raw: Record<string, unknown>, opts?: OpcionesDeCarga): Promise<void> {
    return addTile({ ...formatDToWorld(raw), exits: [] }, opts);
  }

  async function loadSceneData(rawData: Record<string, unknown>, opts: OpcionesDeCarga = {}): Promise<void> {
    resetWorld();
    await addTileRaw(rawData, opts);
  }

  /** Carga una fixture del selector «Room». RECHAZA si el módulo no llega, y de
   *  eso depende el `alFallar` de `paso()` para devolver el desplegable a la
   *  fixture que sí se está viendo (#269). */
  async function loadSceneFile(globKey: string): Promise<void> {
    const mod = await sceneModules[globKey]();
    // El selector «Room» TOMA EL MUNDO: lo que se carga es una escena de prueba,
    // no la partida de nadie. El bridge necesita oírlo para dejar de escuchar al
    // sim con el save de la partida que hubiera detrás (QA 2026-08-25: sin esto,
    // asomarse a una fixture escribía las coordenadas del muñeco en el
    // `state.json` y «Reanudar» te dejaba ahí).
    await loadSceneData(mod.default, { tomaElMundo: true });
  }

  /** Carga una fixture del selector «Room» por nombre parcial, CONDUCIENDO el
   *  `<select>` real, y devuelve la carga. Fail-loud si no existe: un guion que
   *  «no encuentra» la escena y sigue en verde no vale nada.
   *
   *  La promesa es la mitad que faltaba (#308). Sin ella el hook decía «hecho» en
   *  cuanto despachaba el evento, y sus llamantes medían la escena ANTERIOR: el
   *  guion 22 llegó a publicar «suelo de robledo: 57 calcos» —que es el número
   *  del PUERTO— en una corrida VERDE. Con la promesa devuelta el estado malo
   *  deja de ser expresable: los llamantes ya hacen `await`, así que no pueden
   *  medir antes de que la escena esté puesta.
   *
   *  Y RECHAZA si la fixture no llega, que es el mismo canal fail-loud que vigila
   *  `qa/guiones/24-…`: el `catch` de `paso()` es para lo que ve quien juega
   *  (registro de errores, línea del juego, desplegable devuelto a su sitio), no
   *  para tragarse el fallo de vuelta a quien lo pidió.
   *
   *  Vive aquí y no en `dev/nefan-hook.ts` porque `sceneSelector` y
   *  `ultimaCargaDeFixture` son de este módulo: el hook la llama, no la
   *  implementa. */
  function cargarFixture(name: string): Promise<void> {
    const option = [...sceneSelector.options].find((o) => o.value.includes(name));
    if (!option) {
      throw new Error(
        `fixture "${name}" no está en el selector; hay: ${[...sceneSelector.options]
          .map((o) => o.label)
          .join(", ")}`,
      );
    }
    ultimaCargaDeFixture = undefined;
    sceneSelector.value = option.value;
    sceneSelector.dispatchEvent(new Event("change"));
    const carga = ultimaCargaDeFixture;
    // LANZA en vez de devolver `undefined`: devolver «nada» aquí sería
    // exactamente el defecto que este cambio cierra, y lo devolvería mudo. Solo
    // puede pasar si el manejador del `change` deja de lanzar la carga (hoy solo
    // con `value` vacío, que este camino no puede producir).
    if (carga === undefined) {
      throw new Error(
        `fixture "${name}": el <select> aceptó el valor pero su manejador de "change" no lanzó ` +
          `ninguna carga, así que no hay nada que esperar y la escena no va a cambiar`,
      );
    }
    return carga;
  }

  sceneSelector.addEventListener("change", () => {
    const value = sceneSelector.value;
    if (!value) return;
    // Sin canal, un módulo de fixture que no carga dejaba el selector en un
    // no-op MUDO (el modo de fallo de #181): la escena no cambiaba, el rechazo
    // se perdía y quien conduce el preset `html-fixtures` no se enteraba de
    // nada. Ahora el fallo llega al registro de errores y a la línea del juego.
    //
    // Y el desplegable VUELVE. Decir «no cargó» y dejar la etiqueta apuntando a
    // la fixture que no cargó es cambiar el fallo mudo por uno que miente: la
    // pantalla diría dos cosas distintas sobre qué escena se está viendo, y el
    // mensaje se va del log en ocho líneas mientras la etiqueta se queda.
    const anterior = fixtureCargada;
    fixtureCargada = value;
    // Lo que lee quien juega nombra LA ETIQUETA que eligió (`zorder_test`), no
    // la clave del glob (`../nefan-core/data/scenes/zorder_test.json`), que es
    // lo que se leía en los dos canales hasta #269. El crudo —la URL, el stack—
    // sigue entero en el `detail` de la entrada del error-log, que es su sitio.
    const motivo = motivoDeFixtureParaElJugador(etiquetaDeFixture(value));
    // La MISMA promesa va a `paso()` (que le pone el canal de error para quien
    // juega) y a `ultimaCargaDeFixture` (que se la devuelve a quien disparó el
    // evento). No se duplica la cadena: `paso` deriva su propio `.catch`, así que
    // el rechazo sigue vivo en `carga` para el que la espere.
    const carga = loadSceneFile(value);
    ultimaCargaDeFixture = carga;
    paso(carga, "scene", motivo, () => {
      log(`⚠ ${motivo}`);
      // Salvo que mientras tanto se haya elegido otra: revertir por encima de una
      // elección posterior sería mentir en la otra dirección.
      if (sceneSelector.value !== value) return;
      fixtureCargada = anterior;
      sceneSelector.value = anterior;
    });
  });

  return { poblar, addTileRaw, loadSceneData, cargarFixture };
}
