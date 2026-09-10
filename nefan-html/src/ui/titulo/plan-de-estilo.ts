/** El PANEL de coste de «Aplicar estilo», segunda hoja del troceo de #346.
 *
 *  Es la única pantalla del título que no reescribe `content`: se pinta DENTRO
 *  del hueco `#ts-style-plan` que el selector de mundos le deja abierto en su
 *  panel de generación, y por eso su colaborador es el `hueco` y no `content`.
 *  Vive aparte igual: es la pantalla que decide un GASTO —enseña el importe,
 *  deja elegir bloques y confirma— y el selector que la aloja tiene 300 líneas
 *  propias.
 *
 *  La corrida de pago no está aquí: la ejecuta `StyleApplyController`
 *  (`ui/style-apply.ts`), que NO se mueve a esta carpeta. Tiene issue propio
 *  (#513: sacar del navegador un batch que cobra) y, si viviera aquí, esta hoja
 *  no podría importarlo — el candado `las-hojas-del-titulo-no-se-atan-entre-si`
 *  solo deja que dos módulos de `ui/titulo/` se toquen por `atomos.ts`.
 *
 *  Y por ese mismo candado, volver al selector no es una llamada sino el
 *  callback `ir(destino)`: quien enruta es la raíz. */
import { paso } from "../async-ui.js";
import { errors } from "../error-log.js";
import type { StyleApplyController, StyleApplyPlan } from "../style-apply.js";
import {
  BTN_PRIMARY_CSS,
  BTN_SECONDARY_CSS,
  type DestinoDelTitulo,
  escapeHtml,
} from "./atomos.js";

export interface DepsDePlanDeEstilo {
  /** El hueco donde se pinta el panel, que abre el selector de mundos
   *  (`#ts-style-plan`). No es `content`: esta pantalla se monta DENTRO de
   *  otra, y cancelar es vaciar el hueco, no repintar el título. */
  hueco: HTMLElement;
  /** Quien calcula el plan y quien luego gasta. Se recibe ya construido —lo
   *  es el título, una sola vez— porque `debugState()` lo consulta el bench
   *  (`window.__nefan.estilo()`) por la misma instancia. */
  styleApply: StyleApplyController;
  /** A dónde va el título cuando esta pantalla termina. Devuelve la promesa de
   *  la pantalla destino SIN tragársela: aquí se `await`ea dentro del `try` que
   *  pinta el fallo en `#ts-style-progress`, así que un enrutador que la
   *  descartara mandaría ese fallo al registro y dejaría la pantalla muda. */
  ir(destino: DestinoDelTitulo): Promise<void>;
}

/** Panel de aplicación de estilo: plan con coste (SIN gastar) → checkboxes
 *  por bloque → confirmación con el importe → batch con progreso. Patrón
 *  upload→coste→complete de los estilos de usuario. */
export async function pintarPlanDeEstilo(
  deps: DepsDePlanDeEstilo,
  gameId: string,
  styleId: string,
): Promise<void> {
  const { hueco, styleApply, ir } = deps;
  hueco.innerHTML = `<div style="font-size:12px;color:#da6;margin-top:6px">Calculando el coste (sin gastar)…</div>`;
  let plan: StyleApplyPlan;
  try {
    plan = await styleApply.plan(gameId, styleId);
  } catch (err) {
    hueco.innerHTML = `<div style="font-size:12px;color:#a44;margin-top:6px">${escapeHtml((err as Error).message)}</div>`;
    return;
  }
  const blocksHtml = plan.blocks
    .map(
      (b, i) => `
        <label style="display:block;font-size:12px;color:#bbb;margin-bottom:3px">
          <input type="checkbox" data-block-idx="${i}" ${b.selected ? "checked" : ""} ${b.missing === 0 ? "disabled" : ""}>
          ${escapeHtml(b.label)} — ${b.missing === 0 ? "en caché ($0)" : b.estCostUsd === null ? "coste no disponible" : `${b.exact ? "" : "~"}$${b.estCostUsd.toFixed(2)}`}
        </label>`,
    )
    .join("");
  const notesHtml = plan.notes
    .map((n) => `<div style="color:#886;font-size:11px;margin-top:2px">· ${escapeHtml(n)}</div>`)
    .join("");
  hueco.innerHTML = `
    <div style="margin-top:8px;padding:8px 10px;border:1px solid #333;border-radius:4px;background:#101016">
      ${blocksHtml}
      ${notesHtml}
      <div id="ts-style-total" style="font-size:12px;color:#dcb;margin:8px 0 6px"></div>
      <div style="display:flex;gap:8px">
        <button id="ts-style-run" style="${BTN_PRIMARY_CSS};font-size:12px;padding:6px 14px"></button>
        <button id="ts-style-cancel" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px">Cancelar</button>
      </div>
      <div id="ts-style-progress" style="font-size:12px;margin-top:6px;color:#da6"></div>
    </div>`;
  const totalEl = hueco.querySelector("#ts-style-total") as HTMLElement;
  const runBtn = hueco.querySelector("#ts-style-run") as HTMLButtonElement;
  const cancelBtn = hueco.querySelector("#ts-style-cancel") as HTMLButtonElement;
  const progressEl = hueco.querySelector("#ts-style-progress") as HTMLElement;
  const refreshTotal = (): void => {
    const activos = plan.blocks.filter((b) => b.selected && b.missing > 0);
    const total = activos.reduce((acc, b) => acc + (b.estCostUsd ?? 0), 0);
    // Un bloque sin precio (el catálogo no pudo costearlo) no desaparece del
    // total en silencio: el total lleva un «+ ?» y la causa está en las notas.
    const sinPrecio = activos.some((b) => b.estCostUsd === null);
    const anything = activos.length > 0;
    const cifra = `~$${total.toFixed(2)}${sinPrecio ? " + ?" : ""}`;
    totalEl.textContent = anything
      ? `Coste estimado: ${cifra}${sinPrecio ? " — hay bloques con coste no disponible" : ""} (los skins y páginas ya en caché no se repagan)`
      : "Nada seleccionado que genere coste.";
    runBtn.textContent = anything ? `Aplicar estilo (${cifra})` : "Registrar (sin coste)";
    // EL BOTÓN QUE GASTA NO SE VE IGUAL QUE EL QUE NO GASTA (#548). Era UN solo
    // primario ámbar para los dos, así que la única diferencia entre pulsar y
    // pagar y pulsar y no pagar estaba en leer su texto. El que cuesta dinero
    // se queda con el primario —es la acción principal de esta pantalla— y el
    // que no cuesta baja a secundario, que es lo que hace el resto del título
    // con lo que no compromete nada.
    runBtn.style.cssText = `${anything ? BTN_PRIMARY_CSS : BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px`;
  };
  for (const cb of hueco.querySelectorAll<HTMLInputElement>("input[data-block-idx]")) {
    cb.addEventListener("change", () => {
      plan.blocks[Number(cb.dataset.blockIdx)].selected = cb.checked;
      refreshTotal();
    });
  }
  refreshTotal();
  cancelBtn.addEventListener("click", () => {
    hueco.innerHTML = "";
  });
  /** EL GASTO Y LA NAVEGACIÓN NO COMPARTEN `try` (#548).
   *
   *  Hasta el 2026-09-10 los dos iban dentro del mismo, así que un fallo al
   *  volver al selector —una pantalla que no se puede pintar, el bridge que se
   *  cae en ese segundo— entraba por el `catch` de un gasto que YA HABÍA
   *  OCURRIDO: borraba el «Estilo aplicado ($2.50)» y volvía a encender
   *  «Aplicar estilo (~$2.50)». Nada en pantalla decía que eso ya estaba pagado
   *  hace diez segundos, y el botón invitaba a pagarlo otra vez.
   *
   *  El corte va en la línea del pago: lo de ARRIBA puede fallar y rearmar el
   *  botón (no se gastó nada); lo de ABAJO no rearma nada nunca, porque el
   *  dinero ya salió. Que el segundo cobro además no ocurriría —el servidor es
   *  idempotente por caché, verificado en la crítica de #513— no arregla esto:
   *  lo que el jugador ve es una pantalla que le pide pagar dos veces, y esa
   *  pantalla es la única del juego donde acepta gastar dinero real. */
  const aplicarElEstilo = async (): Promise<void> => {
    runBtn.disabled = true;
    cancelBtn.disabled = true;
    let result: Awaited<ReturnType<StyleApplyController["run"]>>;
    try {
      result = await styleApply.run(plan, (msg) => {
        progressEl.textContent = msg;
      });
    } catch (err) {
      progressEl.innerHTML = `<span style="color:#a44">${escapeHtml((err as Error).message)}</span>`;
      runBtn.disabled = false;
      cancelBtn.disabled = false;
      return;
    }
    // ── A PARTIR DE AQUÍ YA SE PAGÓ ────────────────────────────────────────
    const failNote = result.failures.length
      ? ` · <span style="color:#a44">${result.failures.length} fallos (ver registro)</span>`
      : "";
    const comprobante =
      `<span style="color:#4a4">Estilo aplicado: ${result.cellsPainted} celdas y ` +
      `${result.skinsPainted} skins nuevos ($${result.costUsd.toFixed(2)})${failNote}</span>`;
    progressEl.innerHTML = comprobante;
    await new Promise((r) => setTimeout(r, 1200));
    try {
      await ir({ a: "selector", preselect: gameId });
    } catch (err) {
      // El comprobante SE QUEDA y el botón que cobra NO vuelve: lo que ha
      // fallado es la navegación, no el estilo. Se le dice al jugador qué pasó
      // y qué hacer, sin borrarle la prueba de lo que ya pagó.
      errors.push("title", "volver al selector tras aplicar el estilo", err);
      progressEl.innerHTML =
        comprobante +
        `<div style="color:#a44;margin-top:4px">El estilo YA está aplicado y no hay que ` +
        `volver a pagarlo; lo que falló es volver al selector de mundos. Recarga la página ` +
        `para seguir.</div>`;
    }
  };
  runBtn.addEventListener("click", () =>
    paso(aplicarElEstilo(), "title", "aplicar el estilo al mundo pre-generado"),
  );
}
