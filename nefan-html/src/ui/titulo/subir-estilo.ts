/** SUBIR ESTILO: el jugador trae sus propias imágenes de referencia y, si al
 *  pack le faltan refs mínimas, se generan con IA previa confirmación del
 *  coste. Segunda hoja del troceo de #346, junto al panel de coste.
 *
 *  Qué NO decide esta pantalla, y es lo que la deja siendo presentación: si una
 *  subida vale lo dice `validarSubidaDeEstilo` de core (PR 7 de #241), que es
 *  lo MISMO que comprueba ai_server leyendo su snapshot; y qué carpetas existen
 *  lo dice `STYLE_REF_FOLDERS`, también de core. De aquí es únicamente cómo se
 *  le llama a cada carpeta en el desplegable y en qué orden se ofrecen.
 *
 *  Volver al selector es el callback `ir(destino)` y no una llamada: el candado
 *  `las-hojas-del-titulo-no-se-atan-entre-si` no deja que una hoja del título
 *  importe a otra, y quien enruta es la raíz. */
import type {
  StyleCompleteResponse,
  StyleUploadResponse,
} from "@nefan-core/src/contracts/remote-gen.js";
import { validarSubidaDeEstilo } from "@nefan-core/src/contracts/style-upload.js";
import {
  SUGGESTED_THEME_TAGS,
  type StyleRefFolder,
} from "@nefan-core/src/games/style-refs.js";
import { paso } from "../async-ui.js";
import { errors } from "../error-log.js";
import {
  AI_SERVER_HTTP,
  BTN_PRIMARY_CSS,
  BTN_SECONDARY_CSS,
  INPUT_CSS,
  SELECT_CSS,
  type DestinoDelTitulo,
  escapeHtml,
} from "./atomos.js";

/** Cómo se le llama a cada carpeta del pack en el desplegable de la subida, y
 *  en qué orden se ofrecen (lo primero que sube un jugador es una cara: eso sí
 *  es de aquí, es presentación). Las carpetas NO se declaran aquí: son las
 *  claves de `StyleRefFolder` (`STYLE_REF_FOLDERS` en core, PR 7 de #241), así
 *  que una carpeta nueva allí no compila hasta que se le ponga rótulo, y una
 *  inventada tampoco.
 *
 *  EL RÓTULO CORTO Y LA EXPLICACIÓN APARTE (#548): la fila es
 *  `auto 1fr auto` y el `<select>` va a `width:auto`, así que su opción más
 *  larga decidía el ancho de la fila entera —«Lámina de materiales (rejilla de
 *  muestras planas)», 48 caracteres— y dejaba a la DESCRIPCIÓN, que es el campo
 *  donde va el texto más largo de la pantalla, con lo que sobraba. Los rótulos
 *  se quedan en el nombre del rol y lo que explicaba el paréntesis va al
 *  `title` de cada opción, que es donde se lee cuando hace falta. Los `value`
 *  no cambian: son los ids del rol y es lo que viaja al servidor (y lo que
 *  afirma el guion 12). */
const ROTULO_DE_CARPETA: Record<StyleRefFolder, string> = {
  faces: "Cara del mundo",
  surfaces: "Lámina de materiales",
  characters: "Personaje",
};
const AYUDA_DE_CARPETA: Record<StyleRefFolder, string> = {
  faces: "Una cara del mundo: fachada, portón, muro…",
  surfaces: "La lámina de materiales: una rejilla de muestras planas (un pack lleva exactamente una)",
  characters: "Un model sheet de personaje",
};

/** EL MOTIVO QUE LEE EL JUGADOR CUANDO EL SERVIDOR RECHAZA (#536).
 *
 *  ai_server contesta 422 con `{"detail": "…"}`, y ese `detail` es el MISMO
 *  texto que comprueba `validarSubidaDeEstilo` antes de subir (los dos salen
 *  del snapshot de core). Hasta el 2026-09-10 el título pintaba el envoltorio:
 *  «Subida fallida: HTTP 422: {"detail":"Id duplicado: torre."}» — jerga del
 *  transporte y JSON crudo delante de una frase que ya estaba escrita para él.
 *
 *  Si el cuerpo no es ese JSON (un 500 con una traza, un proxy por medio) no se
 *  inventa un motivo: al jugador se le dice que el servidor rechazó sin decir
 *  por qué, con el código para que sirva de algo, y el CRUDO se va al registro
 *  —que es donde se busca después— en vez de a la pantalla. Un servidor que
 *  contesta algo que no es su contrato es un hecho que alguien tiene que poder
 *  ver, y no es el jugador quien lo va a arreglar. */
async function motivoDelRechazo(res: Response, que: string): Promise<Error> {
  const cuerpo = await res.text();
  let detail: unknown;
  try {
    detail = (JSON.parse(cuerpo) as { detail?: unknown }).detail;
  } catch (err) {
    errors.push(
      "title",
      `el ai_server contestó al ${que} algo que no es JSON (HTTP ${res.status}): ${cuerpo.slice(0, 200)}`,
      err,
    );
  }
  if (typeof detail === "string" && detail.length > 0) return new Error(detail);
  return new Error(
    `El servidor del juego rechazó la petición y no dijo por qué (HTTP ${res.status}).`,
  );
}

export interface DepsDeSubirEstilo {
  /** La columna del título, que esta pantalla reescribe entera. */
  content: HTMLElement;
  /** A dónde va el título cuando esta pantalla termina. Devuelve la promesa de
   *  la pantalla destino SIN tragársela: dos de las tres vueltas al selector se
   *  `await`ean dentro del `try` que pinta el fallo en `#ts-style-status`, y la
   *  tercera (el botón «Volver») la pasa por `paso()` con su propio motivo. */
  ir(destino: DestinoDelTitulo): Promise<void>;
}

/** Subir un estilo propio: nombre + al menos una imagen por categoría; las
 *  categorías que falten se generan con IA usando las subidas como
 *  referencia — PREVIA confirmación explícita del coste. */
export function pintarSubirEstilo(deps: DepsDeSubirEstilo): void {
  const { content, ir } = deps;
  content.style.maxWidth = "720px";
  const rowHtml = (): string => `
    <div data-upload-row style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;margin-bottom:8px;padding:8px;border:1px solid #2a2a30;border-radius:6px">
      <input data-file type="file" accept="image/*" style="color:#777;font-size:11px;max-width:170px">
      <input data-desc type="text" placeholder="qué muestra (ej: catedral gótica al atardecer)" style="${INPUT_CSS}">
      <select data-folder style="${SELECT_CSS};width:auto">
        ${(Object.entries(ROTULO_DE_CARPETA) as Array<[StyleRefFolder, string]>)
          .map(([id, label]) => `<option value="${id}" title="${escapeHtml(AYUDA_DE_CARPETA[id])}">${label}</option>`)
          .join("")}
      </select>
    </div>`;
  content.innerHTML = `
    <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Subir estilo</h1>
    <p style="margin-bottom:16px;color:#888;font-size:12px">
      Sube una o más imágenes de referencia LIBRES — cada una con una descripción de lo que muestra
      (el motor narrativo la usa para elegir la referencia de cada NPC y de cada cara) y a qué sirve.
      Las refs mínimas que falten se generarán con IA a partir de las tuyas — se te pedirá confirmación con el coste.
    </p>
    <label style="display:block;margin-bottom:12px">
      <div style="font-size:12px;color:#999;margin-bottom:4px">Nombre del estilo</div>
      <input id="ts-style-name" type="text" placeholder="ej: Tinta y pergamino" style="${INPUT_CSS}">
    </label>
    <div style="margin-bottom:12px">
      <div style="font-size:12px;color:#999;margin-bottom:4px">Etiquetas temáticas (para casarlo con mundos compatibles)</div>
      <div id="ts-style-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
        ${SUGGESTED_THEME_TAGS.map((t) => `
          <button data-tag="${t}" style="${BTN_SECONDARY_CSS};font-size:11px;padding:2px 8px">${t}</button>`).join("")}
      </div>
      <input id="ts-style-tags-free" type="text" placeholder="otras etiquetas, separadas por comas" style="${INPUT_CSS}">
    </div>
    <div id="ts-upload-rows">${rowHtml()}</div>
    <button id="ts-add-row" style="${BTN_SECONDARY_CSS};font-size:11px;margin-bottom:14px">+ otra imagen</button>
    <div id="ts-style-status" style="margin-bottom:14px;font-size:12px;color:#888"></div>
    <div style="display:flex;gap:12px">
      <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
      <button id="ts-upload" style="${BTN_PRIMARY_CSS}">Subir</button>
      <button id="ts-complete" style="${BTN_PRIMARY_CSS};display:none">Generar imágenes</button>
    </div>
  `;
  const nameEl = content.querySelector("#ts-style-name") as HTMLInputElement;
  const statusEl = content.querySelector("#ts-style-status") as HTMLElement;
  const backBtn = content.querySelector("#ts-back") as HTMLButtonElement;
  const uploadBtn = content.querySelector("#ts-upload") as HTMLButtonElement;
  const completeBtn = content.querySelector("#ts-complete") as HTMLButtonElement;
  const rowsEl = content.querySelector("#ts-upload-rows") as HTMLElement;
  const tagsEl = content.querySelector("#ts-style-tags") as HTMLElement;
  const tagsFreeEl = content.querySelector("#ts-style-tags-free") as HTMLInputElement;
  const selectedTags = new Set<string>();
  let pendingStyleId = "";

  for (const btn of tagsEl.querySelectorAll<HTMLElement>("[data-tag]")) {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag!;
      if (selectedTags.has(tag)) selectedTags.delete(tag);
      else selectedTags.add(tag);
      btn.style.borderColor = selectedTags.has(tag) ? "#da6" : "#2a2a30";
      btn.style.background = selectedTags.has(tag) ? "#201c14" : "#181820";
    });
  }
  (content.querySelector("#ts-add-row") as HTMLButtonElement).addEventListener(
    "click",
    () => rowsEl.insertAdjacentHTML("beforeend", rowHtml()),
  );
  backBtn.addEventListener("click", () =>
    paso(ir({ a: "selector" }), "title", "volver al selector de mundos"),
  );

  // EL ÚNICO DE LOS SEIS QUE MORDÍA (#260): el `await` del `FileReader` iba
  // fuera del `try` (ver abajo). Arreglado en su sitio, este handler queda
  // como los otros cinco — cuerpo entero en `try/catch`, sin canal especial.
  const subirElEstilo = async (): Promise<void> => {
    const name = nameEl.value;
    const tags = [
      ...selectedTags,
      ...tagsFreeEl.value.split(",").map((t) => t.trim()).filter(Boolean),
    ];
    // EL `try` EMPIEZA AQUÍ Y NO TRES PASOS MÁS ABAJO, y ese era el bug de
    // #260: el `await` de este `FileReader` quedaba FUERA, así que un
    // fichero ilegible rechazaba sin catch — el handler era `async`, el
    // cliente no tiene `unhandledrejection`, y pulsar «Subir» no hacía nada
    // (#181 otra vez). Dentro del `try`, el mismo `catch` que ya traduce los
    // fallos de red escribe también este, sin canal aparte que mantener.
    try {
      const rows = [...rowsEl.querySelectorAll<HTMLElement>("[data-upload-row]")];
      const images: Array<{ folder: string; description: string; image_b64: string }> = [];
      /** El fichero de cada imagen, en su orden: lo único del rechazo que el
       *  servidor no puede saber, así que se le añade al motivo. */
      const ficheros: string[] = [];
      for (const row of rows) {
        const file = (row.querySelector("[data-file]") as HTMLInputElement).files?.[0];
        if (!file) continue;
        const description = (row.querySelector("[data-desc]") as HTMLInputElement).value.trim();
        const folder = (row.querySelector("[data-folder]") as HTMLSelectElement).value;
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result ?? ""));
          r.onerror = () => rej(new Error(`no se pudo leer ${file.name}`));
          r.readAsDataURL(file);
        });
        images.push({ folder, description, image_b64: b64 });
        ficheros.push(file.name);
      }
      // QUÉ SUBIDA VALE lo decide `validarSubidaDeEstilo` de core, y es lo
      // MISMO que comprueba ai_server leyendo su snapshot: el motivo que se
      // pinta es el que devolvería el 422, más el fichero cuando se sabe.
      const comprobado = validarSubidaDeEstilo({ name, tags, images });
      if (!comprobado.ok) {
        const cual = comprobado.imagen === null ? "" : ` (${ficheros[comprobado.imagen] ?? ""})`;
        statusEl.innerHTML = `<span style="color:#a44">${escapeHtml(comprobado.error + cual)}</span>`;
        return;
      }
      uploadBtn.disabled = true;
      statusEl.textContent = "Subiendo imágenes al ai_server...";
      const res = await fetch(`${AI_SERVER_HTTP}/styles/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comprobado.subida),
      });
      if (!res.ok) throw await motivoDelRechazo(res, "subir el estilo");
      const data = (await res.json()) as StyleUploadResponse;
      pendingStyleId = data.style_id;
      if (data.missing.length === 0) {
        statusEl.innerHTML = `<span style="color:#4a4">Estilo ${escapeHtml(data.style_id)} completo.</span>`;
        await ir({ a: "selector" });
        return;
      }
      statusEl.innerHTML = `<span style="color:#da6">Subidas ${data.uploaded.length}. Faltan ${data.missing.length} refs `
        + `(${data.missing.map((m) => m.id).join(", ")}). Generarlas costará ~$${data.estimated_cost_usd.toFixed(2)} en créditos.</span>`;
      uploadBtn.style.display = "none";
      completeBtn.style.display = "";
      completeBtn.textContent = `Generar ${data.missing.length} imágenes (~$${data.estimated_cost_usd.toFixed(2)})`;
    } catch (err) {
      statusEl.innerHTML = `<span style="color:#a44">Subida fallida: ${escapeHtml((err as Error).message)}</span>`;
      uploadBtn.disabled = false;
    }
  };
  uploadBtn.addEventListener("click", () =>
    paso(subirElEstilo(), "title", "subir el estilo"),
  );

  const generarLasRefsQueFaltan = async (): Promise<void> => {
    completeBtn.disabled = true;
    backBtn.disabled = true;
    statusEl.innerHTML = `<span style="color:#da6">🎨 Generando las refs que faltan (varios minutos)...</span>`;
    try {
      const res = await fetch(`${AI_SERVER_HTTP}/styles/${encodeURIComponent(pendingStyleId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) throw await motivoDelRechazo(res, "generar las refs que faltan");
      const data = (await res.json()) as StyleCompleteResponse;
      statusEl.innerHTML = `<span style="color:#4a4">Generadas ${data.generated.length} imágenes ($${data.cost_usd.toFixed(2)}).</span>`;
      await ir({ a: "selector" });
    } catch (err) {
      statusEl.innerHTML = `<span style="color:#a44">Generación fallida: ${escapeHtml((err as Error).message)}</span>`;
      completeBtn.disabled = false;
      backBtn.disabled = false;
    }
  };
  completeBtn.addEventListener("click", () =>
    paso(generarLasRefsQueFaltan(), "title", "generar las refs que faltan del estilo"),
  );
}
