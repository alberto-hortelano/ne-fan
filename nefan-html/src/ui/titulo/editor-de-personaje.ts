/** «Crear personaje»: el último paso antes de empezar — modelo base y skin —
 *  y el que RESUELVE la elección del jugador.
 *
 *  Tercer corte de #346. Es una HOJA del título (candado
 *  `las-hojas-del-titulo-no-se-atan-entre-si`): pinta dentro del hueco que le
 *  dan, vuelve al selector por `ir(destino)` y no conoce a ninguna otra
 *  pantalla.
 *
 *  LA PROMESA NO ES SUYA. `show()` la arma en la raíz y la raíz la resuelve;
 *  aquí solo se llama a `elegir(accion)`, que es esa resolución vista desde
 *  fuera. Importa quién la tiene: el `?.` del lado de la raíz es lo que hace
 *  que pulsar «Comenzar» antes de que `show()` haya armado la promesa sea un
 *  no-op y no un fallo, y esa ventana la cerró #181 moviendo el armado ANTES
 *  del primer pintado. Una hoja con la promesa dentro no podría decir eso.
 */
import { CONFIG } from "@nefan-core/src/config.js";
import {
  modelosCompletos,
  type SpriteCensusResponse,
} from "@nefan-core/src/contracts/sprite-census.js";
import type { GameInfo } from "../../net/narrative-client.js";
import { paso } from "../async-ui.js";
import { errors } from "../error-log.js";
import {
  BTN_PRIMARY_CSS,
  BTN_SECONDARY_CSS,
  INPUT_CSS,
  SELECT_CSS,
  type DestinoDelTitulo,
  type TitleAction,
  escapeAttr,
  escapeHtml,
} from "./atomos.js";

export interface DepsDeEditorDePersonaje {
  /** El hueco del título donde se pinta. */
  content: HTMLDivElement;
  /** Resuelve la elección del jugador. La promesa vive en la raíz (ver la
   *  cabecera): esto es su `resolve` visto desde aquí. */
  elegir(accion: TitleAction): void;
  /** La vuelta al selector. */
  ir(destino: DestinoDelTitulo): Promise<void>;
}

/** Lo que el jugador ya eligió en el selector y esta pantalla solo transporta:
 *  se pinta el título del mundo y lo demás viaja tal cual dentro de la acción
 *  `new_game`. Los dos modos son `"image" | "vector"` y no `Modo`: el `""` de
 *  core significa «sin decidir», y aquí ya está decidido. */
export interface EleccionDeMundo {
  game: GameInfo;
  styleId: string;
  renderMode: "image" | "vector";
  characterMode: "image" | "vector";
}

export async function pintarEditorDePersonaje(
  deps: DepsDeEditorDePersonaje,
  eleccion: EleccionDeMundo,
): Promise<void> {
  const { game, styleId, renderMode, characterMode } = eleccion;
  const spritesOn = CONFIG.graphics.character_sprites;
  const skinOn = CONFIG.graphics.ai_skin;

  // El desplegable NO es una lista que alguien recuerda actualizar (#216:
  // prometía 7 modelos de los que 6 no tenían hojas): se deriva del censo
  // vivo del dev server (`/sprites/index.json`) filtrado por
  // `modelosCompletos` — ofrecer un modelo es consecuencia de tener su set
  // completo cargable. Los tres estados hablan; ninguno calla.
  let modelBlock: string;
  if (!spritesOn) {
    modelBlock = `<div style="margin-bottom:14px;color:#666;font-size:11px;font-style:italic">
         Modelo Mixamo deshabilitado (activa <code>graphics.character_sprites</code> en config.ts para usarlo).
       </div>`;
  } else {
    let modelos: string[] = [];
    let fallo = "";
    try {
      const res = await fetch("/sprites/index.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const censo = (await res.json()) as SpriteCensusResponse;
      // Guard de forma (QA H3): un JSON válido que no es un censo caía en
      // el catch con la jerga del TypeError («Cannot read properties of
      // undefined…») pintada en la nota. El motivo que ve el jugador tiene
      // que estar en su idioma; el objeto crudo va al error-log de abajo.
      if (!Array.isArray(censo?.models) || !Array.isArray(censo?.required?.anims)) {
        throw new Error("la respuesta no es un censo de modelos");
      }
      modelos = modelosCompletos(censo);
    } catch (err) {
      // Criterio 6 de #216: la derivación falla CON canal. El error-log
      // está oculto por CSS mientras el título está delante (#246/#306),
      // así que además de registrarlo se dice en la pantalla donde ocurre.
      fallo = err instanceof Error ? err.message : String(err);
      errors.push(
        "title",
        `no se pudo leer el censo de modelos de personaje (${fallo}) — se usará la base y_bot`,
        err,
      );
    }
    const NOTA_CSS = "margin-bottom:14px;color:#a86;font-size:11px";
    if (fallo) {
      modelBlock = `<div id="ts-model-nota" data-motivo="fallo" style="${NOTA_CSS}">
           No se pudo leer el censo de modelos (${escapeHtml(fallo)}) — se usará la base y_bot.
         </div>`;
    } else if (modelos.length === 0) {
      // El clon limpio. Se puede Comenzar igual: el arranque fail-louda con
      // FALLO_HOJAS_BASE y su remedio (camino medido por el guion 27).
      modelBlock = `<div id="ts-model-nota" data-motivo="vacio" style="${NOTA_CSS}">
           Ningún modelo con hojas completas en disco — genéralas con sprite-forge
           (receta en <code>docs/assets-de-personaje.md</code>).
         </div>`;
    } else {
      // En modo personajes "image" el desplegable SE QUEDA (criterio 5):
      // el skin IA se genera siempre sobre y_bot, pero el modelo elegido es
      // la base de RESPALDO que se ve mientras el skin no llega o si falla
      // (modelFor, character-sprites.ts) — una elección viva, y se anota.
      const notaImage =
        characterMode === "image"
          ? `<div id="ts-model-nota" data-motivo="image" style="margin-top:4px;color:#887;font-size:11px">
               El skin IA se genera sobre y_bot; este modelo es el que ves mientras el skin no llega o si falla.
             </div>`
          : "";
      modelBlock = `<label style="display:block;margin-bottom:14px">
         <div style="font-size:12px;color:#999;margin-bottom:4px">Modelo base (con hojas completas en disco)</div>
         <select id="ts-model" style="${SELECT_CSS}">
           ${modelos.map((id) => `<option value="${escapeAttr(id)}">${escapeHtml(nombreDeModelo(id))}</option>`).join("")}
         </select>
         ${notaImage}
       </label>`;
    }
  }

  const skinBlock = skinOn
    ? `<label style="display:block;margin-bottom:18px">
         <div style="font-size:12px;color:#999;margin-bottom:4px">Skin AI (prompt opcional)</div>
         <input id="ts-skin" type="text" placeholder="ej: caballero con armadura roja"
                style="${INPUT_CSS}">
       </label>`
    : `<div style="margin-bottom:18px;color:#666;font-size:11px;font-style:italic">
         Skin AI deshabilitada (activa <code>graphics.ai_skin</code> en config.ts para usarla).
       </div>`;

  deps.content.style.maxWidth = "720px";
  deps.content.innerHTML = `
    <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Crear personaje</h1>
    <p style="margin-bottom:18px;color:#888;font-size:12px">Mundo: <span style="color:#bdf">${escapeHtml(game.title)}</span></p>
    ${modelBlock}
    ${skinBlock}
    <div style="display:flex;gap:12px">
      <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
      <button id="ts-start" style="${BTN_PRIMARY_CSS}">Comenzar</button>
    </div>
  `;
  const back = deps.content.querySelector("#ts-back") as HTMLButtonElement;
  const start = deps.content.querySelector("#ts-start") as HTMLButtonElement;
  const modelSel = deps.content.querySelector("#ts-model") as HTMLSelectElement | null;
  const skinInput = deps.content.querySelector("#ts-skin") as HTMLInputElement | null;

  back.addEventListener("click", () =>
    paso(deps.ir({ a: "selector" }), "title", "volver al selector de mundos"),
  );
  start.addEventListener("click", () => {
    deps.elegir({
      kind: "new_game",
      gameId: game.game_id,
      styleId,
      renderMode,
      characterMode,
      appearance: {
        model_id: modelSel ? modelSel.value : "",
        skin_path: skinInput ? skinInput.value.trim() : "",
      },
    });
  });
}

/** Nombre legible de un modelo del censo, derivado del id (`y_bot` → «Y bot»):
 *  pintar es del cliente, y una tabla id→nombre sería otra lista a mano — la
 *  enfermedad que #216 mató. */
function nombreDeModelo(id: string): string {
  const conEspacios = id.replace(/_/g, " ");
  return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
}
