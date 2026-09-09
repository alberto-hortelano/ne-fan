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
  const aplicarElEstilo = async (): Promise<void> => {
    runBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      const result = await styleApply.run(plan, (msg) => {
        progressEl.textContent = msg;
      });
      const failNote = result.failures.length
        ? ` · <span style="color:#a44">${result.failures.length} fallos (ver registro)</span>`
        : "";
      progressEl.innerHTML =
        `<span style="color:#4a4">Estilo aplicado: ${result.cellsPainted} celdas y ` +
        `${result.skinsPainted} skins nuevos ($${result.costUsd.toFixed(2)})${failNote}</span>`;
      await new Promise((r) => setTimeout(r, 1200));
      await ir({ a: "selector", preselect: gameId });
    } catch (err) {
      progressEl.innerHTML = `<span style="color:#a44">${escapeHtml((err as Error).message)}</span>`;
      runBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  };
  runBtn.addEventListener("click", () =>
    paso(aplicarElEstilo(), "title", "aplicar el estilo al mundo pre-generado"),
  );
}
