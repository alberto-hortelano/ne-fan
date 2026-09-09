/** «Crear mundo»: el jugador escribe (o sube) un borrador y el motor
 *  narrativo lo desarrolla hasta ser un mundo más del selector.
 *
 *  Tercer corte de #346. Es una HOJA del título: pinta dentro del hueco que le
 *  dan, no conoce a ninguna otra pantalla y vuelve por `ir(destino)` — el
 *  candado `las-hojas-del-titulo-no-se-atan-entre-si` (arch-rules.json) impide
 *  que la conozca de otra forma, y `atomos.ts` es lo único de `ui/titulo/` que
 *  puede importar.
 *
 *  Aquí NO se decide nada del juego: cuándo un borrador vale una génesis es de
 *  core (`protocol/borrador-de-mundo.ts`, PR 7 de #241) y lo comprueba también
 *  el bridge antes de llamar al motor. Esta pantalla llama a esa función y
 *  pinta lo que conteste.
 */
import type { NarrativeClient } from "../../net/narrative-client.js";
import { validarBorrador } from "@nefan-core/src/protocol/borrador-de-mundo.js";
import { paso } from "../async-ui.js";
import {
  BTN_PRIMARY_CSS,
  BTN_SECONDARY_CSS,
  INPUT_CSS,
  type DestinoDelTitulo,
  escapeHtml,
} from "./atomos.js";

export interface DepsDeCrearMundo {
  /** El hueco del título donde se pinta. La hoja escribe DENTRO de él y solo
   *  engancha listeners a nodos que ella misma creó ahí: los que viven toda la
   *  partida son del chasis, y son cinco con dueño. */
  content: HTMLDivElement;
  /** El cliente del bridge: crear el juego y encolar su pre-generación. */
  narrative: NarrativeClient;
  /** La vuelta. Devuelve la promesa del repintado —no se la traga— porque el
   *  encadenado de abajo la ESPERA dentro de su `try`. */
  ir(destino: DestinoDelTitulo): Promise<void>;
}

/** Crear un mundo propio: textarea o archivo .md/.txt. El borrador se
 *  desarrolla con el motor narrativo (tarda 1-3 min) y aparece como un
 *  mundo más en el selector. */
export function pintarCrearMundo(deps: DepsDeCrearMundo): void {
  deps.content.style.maxWidth = "720px";
  deps.content.innerHTML = `
    <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Crear mundo</h1>
    <p style="margin-bottom:16px;color:#888;font-size:12px">
      Describe tu mundo (reinos, pueblos, magia, tono…) o sube un archivo .md/.txt.
      El motor narrativo lo completará y desarrollará — cuanto más des, más tuyo será el resultado.
    </p>
    <label style="display:block;margin-bottom:12px">
      <div style="font-size:12px;color:#999;margin-bottom:4px">Borrador del mundo</div>
      <textarea id="ts-draft" rows="10" placeholder="ej: Un archipiélago de islas voladoras ancladas por cadenas gigantes. Clanes de pastores de nubes..." style="${INPUT_CSS};resize:vertical;min-height:160px"></textarea>
    </label>
    <label style="display:block;margin-bottom:18px">
      <div style="font-size:12px;color:#999;margin-bottom:4px">…o sube un archivo</div>
      <input id="ts-draft-file" type="file" accept=".md,.txt,text/plain,text/markdown" style="color:#999;font-size:12px">
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:12px;color:#999">
      <input id="ts-pregen" type="checkbox" checked>
      Generar el mundo al crearlo (mapa, escenas iniciales y personajes — el motor tarda varios
      minutos en segundo plano; el estilo se aplica después con su coste a la vista)
    </label>
    <div id="ts-create-status" style="margin-bottom:14px;font-size:12px;color:#888"></div>
    <div style="display:flex;gap:12px">
      <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
      <button id="ts-create" style="${BTN_PRIMARY_CSS}">Crear mundo</button>
    </div>
  `;
  const draftEl = deps.content.querySelector("#ts-draft") as HTMLTextAreaElement;
  const fileEl = deps.content.querySelector("#ts-draft-file") as HTMLInputElement;
  const statusEl = deps.content.querySelector("#ts-create-status") as HTMLElement;
  const backBtn = deps.content.querySelector("#ts-back") as HTMLButtonElement;
  const createBtn = deps.content.querySelector("#ts-create") as HTMLButtonElement;

  fileEl.addEventListener("change", () => {
    const file = fileEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      draftEl.value = String(reader.result ?? "");
      statusEl.textContent = `Archivo cargado: ${file.name} (${draftEl.value.length} caracteres).`;
    };
    reader.onerror = () => {
      statusEl.innerHTML = `<span style="color:#a44">No se pudo leer ${escapeHtml(file.name)}.</span>`;
    };
    reader.readAsText(file);
  });

  backBtn.addEventListener("click", () =>
    paso(deps.ir({ a: "selector" }), "title", "volver al selector de mundos"),
  );
  const crearElMundo = async (): Promise<void> => {
    // El umbral y su texto son de core: el bridge comprueba lo MISMO antes de
    // llamar al motor. Aquí solo se miraba el mínimo, y el máximo lo cazaba
    // el bridge después de mandar el fichero entero por el cable.
    const comprobado = validarBorrador(draftEl.value);
    if (!comprobado.ok) {
      statusEl.innerHTML = `<span style="color:#a44">${escapeHtml(comprobado.error)}</span>`;
      return;
    }
    const draft = comprobado.borrador;
    createBtn.disabled = true;
    backBtn.disabled = true;
    statusEl.innerHTML = `<span style="color:#da6">🌍 El motor narrativo está desarrollando tu mundo (1-3 min)... no cierres esta pantalla.</span>`;
    try {
      const created = await deps.narrative.createGame(draft);
      statusEl.innerHTML = `<span style="color:#4a4">Mundo creado: ${escapeHtml(created.title)}.</span>`;
      // Encadenar la pre-generación del mundo del juego recién creado:
      // corre en el bridge en segundo plano; el selector muestra el
      // progreso (kind "game_gen") y los chips al terminar. El estilo se
      // aplica después desde el panel (necesita confirmar su coste).
      const pregen = (deps.content.querySelector("#ts-pregen") as HTMLInputElement | null)?.checked;
      if (pregen) {
        try {
          await deps.narrative.generateGame(created.gameId);
        } catch (err) {
          statusEl.innerHTML += ` <span style="color:#a44">(pre-generación no encolada: ${escapeHtml((err as Error).message)})</span>`;
        }
      }
      await deps.ir({ a: "selector", preselect: created.gameId });
    } catch (err) {
      statusEl.innerHTML = `<span style="color:#a44">No se pudo crear el mundo: ${escapeHtml((err as Error).message)}</span>`;
      createBtn.disabled = false;
      backBtn.disabled = false;
    }
  };
  createBtn.addEventListener("click", () =>
    paso(crearElMundo(), "title", "crear el mundo a partir del borrador"),
  );
}
