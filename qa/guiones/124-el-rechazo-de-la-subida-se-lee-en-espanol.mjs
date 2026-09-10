/** Los motivos de rechazo de la subida de un pack se leen en español.
 *
 *  #536, las tres mitades. Subir un estilo propio es la pantalla por la que un
 *  jugador mete su arte en el juego, y lo que lee cuando se lo rechazan era:
 *
 *   1. **un máximo redactado como mínimo** — con trece imágenes, «Sube al menos
 *      una imagen (máximo 12)»: la orden que ya había cumplido, con el número
 *      que la contradice entre paréntesis;
 *   2. **el envoltorio del 422** — «Subida fallida: HTTP 422:
 *      {"detail":"Id duplicado: torre."}», o sea JSON crudo y jerga del
 *      transporte delante de una frase que ya estaba escrita para él;
 *   3. **frases en minúscula** por arrancar con el hueco `{ref}`.
 *
 *  QUÉ SE MIDE AQUÍ Y QUÉ NO. La REDACCIÓN de cada motivo la canda un test de
 *  core que los recorre uno a uno (`test/style-upload.test.ts`: mayúscula
 *  inicial, frase completa, y ninguno mezclando «al menos» con «máximo»); eso no
 *  necesita navegador y sería un verde caro repetirlo aquí. Lo que solo se puede
 *  ver en el juego real es que ESA frase llega hasta la pantalla, por los DOS
 *  caminos que tiene:
 *
 *   **A · el rechazo LOCAL** (el zod de core, antes de subir nada). Se ejerce
 *   con el desplegable de etiquetas, que no necesita ficheros: nueve etiquetas
 *   dan el motivo del MÁXIMO y ninguna el del MÍNIMO, que es el par que #536
 *   separó. Se afirma además la negativa —el motivo del máximo no dice «al
 *   menos» y el del mínimo no dice «máximo»—, porque sin ella cambiar la frase
 *   por otra igual de confusa seguiría en verde.
 *
 *   **B · el rechazo del SERVIDOR**. `ai_server` contesta 422 con
 *   `{"detail": "<el mismo motivo>"}`. Se inyecta esa respuesta EN EL BORDE
 *   (`page.route` sobre la ruta de subida) porque el motor falso del preset no
 *   sirve `/styles/upload`, y se afirma que el título pinta el `detail` y NADA
 *   más: ni «HTTP 422», ni una llave, ni comillas de JSON.
 *
 *  EN NEGATIVO (probado al escribirlo, cada sonda revertida — ver el informe):
 *  devolviendo el motivo único de `tags` («Elige al menos una etiqueta temática
 *  (máximo 8).») se pone rojo A; devolviendo el `throw new Error(\`HTTP
 *  ${res.status}: …\`)` de `subir-estilo.ts` se pone rojo B.
 *
 *  Cero créditos: no se sube ni una imagen de verdad y la respuesta la escribe
 *  el propio guion.
 */
export const sinMotor =
  "solo ejerce la pantalla de «Subir estilo» con rechazos: el local (zod de core) y uno inyectado " +
  "en el borde; no sube ninguna imagen ni le pide nada al motor";

import { recargarAlTitulo } from "../lib/sesion.mjs";

export const aisla = ["saves"];

/** Lo que dice el hueco de estado de la pantalla de subida. */
const estadoDeLaSubida = () =>
  (document.getElementById("ts-style-status")?.textContent ?? "").trim();

/** Rellena el formulario y pulsa «Subir», y espera a que la pantalla conteste. */
async function subir(ctx, { nombre, etiquetas }) {
  await ctx.page.fill("#ts-style-name", nombre);
  await ctx.page.fill("#ts-style-tags-free", etiquetas);
  const antes = await ctx.page.evaluate(estadoDeLaSubida);
  await ctx.page.click("#ts-upload");
  return ctx.waitFor(
    "la pantalla de subida contesta",
    ([previo]) => {
      const t = (document.getElementById("ts-style-status")?.textContent ?? "").trim();
      return t && t !== previo ? t : null;
    },
    20_000,
    [antes],
  );
}

/** Abre «Subir estilo» desde el título. */
async function abrirLaSubida(ctx) {
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click("#ts-upload-style");
  await ctx.page.waitForSelector("#ts-style-name", { timeout: 15_000 });
}

export default async function (ctx) {
  await recargarAlTitulo(ctx);
  await abrirLaSubida(ctx);

  // ── A1 · EL MÁXIMO, CON SU FRASE ───────────────────────────────────────
  const nueveEtiquetas = "a,b,c,d,e,f,g,h,i";
  const conNueve = await subir(ctx, { nombre: "Tinta y pergamino", etiquetas: nueveEtiquetas });
  ctx.log(`nueve etiquetas → «${conNueve}»`);
  await ctx.shot("subida-con-demasiadas-etiquetas");
  ctx.expect(
    "pasarse del MÁXIMO se dice como un máximo, no como un mínimo (#536)",
    /Demasiadas etiquetas/i.test(conNueve) && /como mucho 8/.test(conNueve),
    `«${conNueve}»`,
  );
  ctx.expect(
    "…y no le manda hacer lo que ya hizo: el motivo del máximo NO dice «al menos»",
    !/al menos/i.test(conNueve),
    `«${conNueve}»`,
  );

  // ── A2 · EL MÍNIMO, CON LA SUYA ────────────────────────────────────────
  const sinNinguna = await subir(ctx, { nombre: "Tinta y pergamino", etiquetas: "" });
  ctx.log(`sin etiquetas → «${sinNinguna}»`);
  ctx.expect(
    "y no llegar al MÍNIMO se dice como un mínimo",
    /al menos una etiqueta/i.test(sinNinguna),
    `«${sinNinguna}»`,
  );
  ctx.expect(
    "…sin el número del máximo colgando, que es lo que hacía la frase contradictoria",
    !/máximo|como mucho/i.test(sinNinguna),
    `«${sinNinguna}»`,
  );
  ctx.expect(
    "los dos motivos son DISTINTOS: un límite, una frase",
    conNueve !== sinNinguna,
    `máximo «${conNueve}» · mínimo «${sinNinguna}»`,
  );
  ctx.expect(
    "…y los dos son frases de producto: empiezan en mayúscula y terminan en punto",
    /^[A-ZÁÉÍÓÚÑ]/.test(conNueve) && conNueve.endsWith(".") &&
      /^[A-ZÁÉÍÓÚÑ]/.test(sinNinguna) && sinNinguna.endsWith("."),
    `«${conNueve}» · «${sinNinguna}»`,
  );

  // ── B · EL RECHAZO DEL SERVIDOR LLEGA COMO FRASE, NO COMO JSON ─────────
  //
  // La respuesta se escribe EN EL BORDE, con la forma exacta que devuelve
  // FastAPI (`HTTPException(status_code=422, detail=...)`) y con un motivo que
  // el zod del cliente NO puede cazar: el id duplicado se deriva de la
  // descripción y solo lo ve Python (lo dice `style-upload.ts`). Así lo que se
  // mide es el camino del servidor y no otra vez el local.
  const MOTIVO_DEL_SERVIDOR = "Id duplicado: torre.";
  await ctx.page.route("**/styles/upload", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ detail: MOTIVO_DEL_SERVIDOR }),
    }),
  );
  // Una imagen de verdad (1×1 PNG) para que el zod del cliente deje pasar el
  // cuerpo: sin fichero no se llega a hacer la petición.
  const PNG_1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await ctx.page.setInputFiles("[data-file]", {
    name: "torre.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  });
  await ctx.page.fill("[data-desc]", "una torre de piedra al atardecer");
  const delServidor = await subir(ctx, { nombre: "Tinta y pergamino", etiquetas: "medieval" });
  ctx.log(`422 del servidor → «${delServidor}»`);
  await ctx.shot("subida-rechazada-por-el-servidor");

  ctx.expect(
    "el rechazo del servidor llega COMO FRASE: el título pinta el `detail`, no el envoltorio (#536)",
    delServidor.includes(MOTIVO_DEL_SERVIDOR),
    `«${delServidor}»`,
  );
  ctx.expect(
    "…y NADA del transporte: ni el código HTTP, ni llaves, ni comillas de JSON",
    !/HTTP\s*\d{3}/.test(delServidor) && !/[{}]/.test(delServidor) && !/"detail"/.test(delServidor),
    `«${delServidor}»`,
  );
  ctx.expect(
    "…y el botón «Subir» vuelve a estar pulsable: el rechazo no deja la pantalla sin salida",
    (await ctx.page.evaluate(() => document.getElementById("ts-upload")?.disabled)) === false,
    "ts-upload sigue deshabilitado tras el rechazo",
  );
  await ctx.page.unroute("**/styles/upload");
}
