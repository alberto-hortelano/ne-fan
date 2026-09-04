/** Un fallo con la partida YA PINTADA ofrece CERRAR, y cerrar devuelve al juego.
 *
 *  Escrito por QA-B al validar T10 (#383a). El corte de `status-labels.ts` deja
 *  el titular, el destino y la SALIDA del muro en `status-rotulo.ts` y la frase
 *  en cristiano en `status-motivo.ts`, y con eso deja **un solo sitio** donde
 *  las dos mitades vuelven a encontrarse en ejecución: `nefan-html/src/main.ts`,
 *  que llama a `rotuloDeStatus(...)` y le pasa a `setLoaderState` el titular, el
 *  detalle y la salida del mismo rótulo. Si ese trío se desparejara, no lo vería
 *  ningún test de core —cada mitad tiene el suyo y los dos seguirían verdes—:
 *  lo vería el jugador, aquí.
 *
 *  Lo que NO estaba medido antes de este guion, mirado guion a guion:
 *
 *  - el **20** mide la rama `mundoVacio`: sin mundo detrás el muro ofrece
 *    «Volver al título» y NO «Cerrar»;
 *  - el **56** mide el titular y el cuerpo de un fallo a mitad de partida, pero
 *    no mira ni un botón;
 *  - ninguno mide la OTRA rama de `SalidaDelOverlay`, que es la de todos los
 *    días: hay partida detrás, así que la salida es «Cerrar» — ni que cerrar
 *    devuelva de verdad al juego. Un muro que ofreciera «Volver al título» con
 *    el mundo pintado detrás le costaría al jugador su sesión en un click, y
 *    hoy eso sale verde.
 *
 *  Cómo se llega al estado sin trucar nada, con la técnica del guion 56: se le
 *  quita el permiso de ESCRITURA al directorio del save (`chmod 0500`), que es
 *  la única forma honesta de que `fs.writeFile` dé EACCES, y se contesta al
 *  tabernero, que es el turno que dispara `ctx.narrative.save()` en
 *  `bridge/handlers/dialogue.ts`. El permiso se devuelve SIEMPRE (`finally`).
 *
 *  PROBADO EN NEGATIVO (2026-09-04, QA-B de T10): con la salida clavada a
 *  `"volver-al-titulo"` en `status-rotulo.ts` (la línea `ctx.mundoVacio ? … : …`),
 *  los dos asertos de la salida se ponen ROJOS y el resto del guion sigue verde
 *  — el reparto exacto del defecto. El guion 20, que mide la otra rama, sigue
 *  verde con ese mismo defecto puesto: por eso hacía falta este.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { chmodSync, existsSync } from "node:fs";

import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { dirDelSave } from "../lib/saves.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const MERCADER = "barkeep";

/** El muro del loader, tal y como lo ve quien juega (mismo lector que el 20).
 *  `hidden` NO basta para decidir si un botón se ve: `nf-action` es
 *  `inline-flex` y ganaría al atributo sin la regla explícita de game-ui.css.
 *  Se mira si OCUPA SITIO. */
const leerMuro = (ctx) =>
  ctx.page.evaluate(() => {
    const l = document.getElementById("narrative-loader");
    const volver = document.getElementById("narrative-loader-back");
    const cerrar = document.getElementById("narrative-loader-dismiss");
    return {
      visible: Boolean(l?.classList.contains("visible")),
      enError: Boolean(l?.classList.contains("error")),
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
      volverVisible: Boolean(volver) && volver.offsetParent !== null,
      cerrarVisible: Boolean(cerrar) && cerrar.offsetParent !== null,
    };
  });

const leerMundo = (ctx) =>
  ctx.page.evaluate(() => ({
    tiles: window.__nefan.tiles.length,
    escena: window.__nefan.status().scene,
  }));

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);

  const dir = dirDelSave(partida.sessionId);
  if (!dir || !existsSync(dir)) {
    ctx.sinMedir(
      "esta corrida no tiene disco efímero propio (stack adoptado): sin él no se puede producir " +
        "un EACCES real, y sin fallo real no hay muro que medir",
    );
    return;
  }

  // NO CONCLUYENTE ANTES QUE VERDE: la rama bajo prueba es la de «hay partida
  // detrás». Si el mundo estuviera vacío, la salida correcta sería la OTRA y
  // este guion estaría midiendo el caso del 20 con otro nombre.
  const antes = await leerMundo(ctx);
  ctx.log(`mundo antes del fallo: ${JSON.stringify(antes)}`);
  ctx.expect(
    "hay mundo pintado detrás (si no, la rama bajo prueba no es esta)",
    antes.tiles > 0 && Boolean(antes.escena),
    JSON.stringify(antes),
  );

  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    MERCADER,
  );
  await acercarse(ctx, MERCADER, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible || null, 60_000);

  // ── EL DISCO DEJA DE ADMITIR ESCRITURAS ─────────────────────────────────
  let llego = null;
  chmodSync(dir, 0o500);
  try {
    ctx.log(`save de ${partida.sessionId} en solo lectura (chmod 0500)`);
    await ctx.nefan("chooseDialogue", 0);
    llego = await ctx.expectEspera(
      "el fallo tapa la pantalla con el muro de error",
      true,
      () => {
        const el = document.getElementById("narrative-loader");
        return el?.classList.contains("visible") && el.classList.contains("error") ? true : null;
      },
      { ms: 90_000 },
    );
  } finally {
    chmodSync(dir, 0o700);
  }

  if (!llego?.ocurrio) {
    ctx.sinMedirBloque("el muro no llegó a pintarse: sin muro en pantalla no hay salida que mirar");
    return;
  }

  const muro = await leerMuro(ctx);
  ctx.log(`muro: ${JSON.stringify(muro)}`);
  await ctx.shot("muro-con-partida-detras");

  // Las dos mitades del módulo partido, en la misma pantalla y en su sitio.
  ctx.expect(
    "el muro trae TITULAR (mitad `status-rotulo`) y CUERPO (mitad `status-motivo`), y no son el mismo texto",
    muro.titulo.trim().length > 0 &&
      muro.detalle.trim().length > 0 &&
      muro.titulo.trim() !== muro.detalle.trim(),
    JSON.stringify({ titulo: muro.titulo, detalle: muro.detalle }),
  );
  ctx.expect(
    "…y el cuerpo sigue en idioma de jugador, sin el volcado de quien programa",
    !/EACCES|errno|ENOSPC|^Error:|\bat \w+ \(/.test(muro.detalle),
    muro.detalle,
  );

  // LA RAMA QUE NADIE MEDÍA: con partida detrás la salida es «Cerrar».
  ctx.expect(
    "con la partida pintada detrás el muro ofrece CERRAR",
    muro.cerrarVisible,
    JSON.stringify(muro),
  );
  ctx.expect(
    "…y NO «Volver al título», que aquí le costaría la sesión en un click",
    !muro.volverVisible,
    JSON.stringify(muro),
  );

  if (!muro.cerrarVisible) return; // sin botón no hay nada más que pulsar

  await ctx.page.click("#narrative-loader-dismiss");
  const tras = await ctx.waitFor(
    "el muro se va y el juego sigue debajo",
    () => {
      const el = document.getElementById("narrative-loader");
      if (el?.classList.contains("visible")) return null;
      return { tiles: window.__nefan.tiles.length, escena: window.__nefan.status().scene };
    },
    15_000,
  );
  ctx.log(`mundo tras cerrar: ${JSON.stringify(tras)}`);
  await ctx.shot("tras-cerrar-el-muro");
  ctx.expect(
    "cerrar devuelve al JUEGO: el mismo mundo sigue pintado detrás, no el título",
    tras.tiles === antes.tiles && tras.escena === antes.escena,
    `${JSON.stringify(antes)} → ${JSON.stringify(tras)}`,
  );

  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
