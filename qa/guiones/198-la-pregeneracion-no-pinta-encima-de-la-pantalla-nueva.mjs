/** EL REFRESCO QUE SIGUE A UNA PRE-GENERACIÓN no pinta encima de la pantalla
 *  a la que el jugador ya se ha ido (#731, #673).
 *
 *  ## El defecto
 *
 *  Cuando llega un `game_gen` terminal (`ready`/`error`) con el selector de
 *  mundos delante, el título lo vuelve a pintar para refrescar chips y botones
 *  (`title-screen.ts`, oyente de `onProgresoDeMundo`). Ese pintado espera a
 *  `listGames()` y después escribe `content.innerHTML`. Hasta esta tanda NO
 *  volvía a mirar qué pantalla había delante: si en esa ventana el jugador
 *  pulsaba «Volver», el home se pintaba y el selector lo aplastaba ~15 ms
 *  después. «Volver» se deshacía solo, y un `page.click("#ts-new")` que ya
 *  tenía el nodo daba `element was detached` (#731) o expiraba (#673).
 *
 *  ## Qué se conduce
 *
 *  Las TRES salidas del selector que pueden caer dentro de la ventana, cada una
 *  en su bloque y con el selector recién abierto:
 *   A · «← Volver»   → el home, con «Nueva partida» que responde.
 *   B · «Continuar →» → el editor de personaje.
 *   C · «🎨 Subir estilo» → la pantalla de subida.
 *
 *   D · «← Volver» con la fase `error` en vez de `ready`: el refresco que
 *      sigue a un fallo es el mismo pintado, y se conduce por su puerta.
 *
 *  En todos, el `ready` (o el `error`) se ENTREGA por el socket vivo del bridge y el botón
 *  se pulsa EN LA MISMA TAREA (un solo `evaluate`, sin `await` entre las dos
 *  cosas), que es el peor caso: el refresco ya está en vuelo cuando el jugador
 *  se va. El `ready` es el mismo mensaje que difunde el bridge (receta del
 *  guion 100): no se encola ninguna generación, que es lo que deja esto sin
 *  motor y a coste cero.
 *
 *  ## Por qué no puede salir verde por ir rápido
 *
 *  (Mecánica en `qa/lib/retener.mjs`, compartida con el 199.) La RESPUESTA a la `list_games` del refresco se RETIENE en la página (es un
 *  bridge cargado, que es el caso real en que la ventana dura hasta el timeout
 *  de la petición) hasta que la pantalla de destino está pintada. Entonces se
 *  suelta, y el aserto espera a haber VISTO que todas las `list_games` que
 *  salieron tienen su respuesta entregada al cliente —la continuación del
 *  refresco corre en los microtasks de esa entrega— antes de mirar la pantalla.
 *  O sea que el orden malo (destino pintado → refresco resuelto) se da SIEMPRE,
 *  no por suerte, y no hay ningún tiempo de espera en el aserto.
 *
 *  Y cada bloque afirma también que el refresco SALIÓ (una `list_games` más
 *  tras el `ready`): sin eso, un cambio que dejara de refrescar el selector
 *  pondría esto verde sin haber corrido la carrera.
 *
 *  Negativo medido: sin el arreglo de `title-screen.ts` los tres bloques salen
 *  rojos (ver `implementacion.md` de la tanda BB).
 *
 *  Las otras dos pantallas del título que pintaban tarde encima de la nueva
 *  —el editor tras el censo de hojas y el home tras borrar o cambiar el modo
 *  de un save— las mide el guion 199.
 */
import { esperarTituloListo, recargarAlTitulo } from "../lib/sesion.mjs";
import {
  instrumentarRetenciones,
  pantallaDelTitulo,
  retener,
  soltarYVerResuelto,
} from "../lib/retener.mjs";

export const sinMotor =
  "conduce el título y ENTREGA el fin de la pre-generación por el socket ya abierto: no encola ninguna generación ni arranca partida";

/** ENTREGA el fin de la pre-generación (`fase`) del mundo mirado y pulsa
 *  `boton` en la MISMA tarea. Devuelve cuántas `list_games` había pedidas
 *  antes y después, para que el guion afirme que el refresco salió. */
function finYSalirEnLaMismaTarea(ctx, boton, fase) {
  return ctx.page.evaluate(
    ({ sel, fase }) => {
      const r = window.__qaRet;
      const vivos = r.sockets.filter(
        (s) => typeof s.onmessage === "function" && s.readyState === WebSocket.OPEN,
      );
      if (vivos.length === 0) throw new Error("ningún socket del bridge donde entregar");
      const activa = [...document.querySelectorAll("[data-game-id]")].find(
        (c) => c.style.borderColor === "rgb(221, 170, 102)",
      );
      const antes = r.pedidas.list_games ?? 0;
      vivos[vivos.length - 1].onmessage({
        data: JSON.stringify({
          type: "narrative_status",
          kind: "game_gen",
          phase: fase,
          gameId: activa?.dataset.gameId ?? "alta_fantasia",
          message: `Pre-generación terminada en «${fase}» (entregada por el guion 198)`,
        }),
      });
      const tras = r.pedidas.list_games ?? 0;
      const btn = document.querySelector(sel);
      if (!btn) throw new Error(`no hay ${sel} que pulsar`);
      btn.click();
      return { antes, tras };
    },
    { sel: boton, fase },
  );
}

async function abrirElSelector(ctx) {
  await esperarTituloListo(ctx);
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("#ts-gen", { timeout: 30_000 });
}

/** Un bloque: selector abierto → fin de pre-generación + salida en la misma
 *  tarea → destino pintado → respuesta soltada → refresco resuelto → la
 *  pantalla sigue siendo el destino. */
async function salidaDuranteElRefresco(ctx, { nombre, boton, destino, marca, fase = "ready" }) {
  await abrirElSelector(ctx);
  await retener(ctx, { tipos: ["games_listed"] });
  const { antes, tras } = await finYSalirEnLaMismaTarea(ctx, boton, fase);
  ctx.expect(
    `${nombre}: el ${fase} lanza el refresco del selector (sale una list_games más)`,
    tras === antes + 1,
    `list_games pedidas ${antes} → ${tras}`,
  );
  await ctx.page.waitForSelector(marca, { timeout: 30_000 });
  const cuenta = await soltarYVerResuelto(ctx, { pares: [["list_games", "games_listed"]] });
  const final = await pantallaDelTitulo(ctx);
  ctx.log(`${nombre}: ${JSON.stringify(cuenta)} · pantalla final ${final}`);
  await ctx.shot(`${destino}-tras-el-refresco-${fase}`);
  ctx.expect(
    `${nombre}: resuelto el refresco, la pantalla sigue siendo ${destino} y no el selector`,
    final === destino,
    `pantalla final: ${final}`,
  );
  return final;
}

/** «Nueva partida» OPERATIVO tras volver: el clic lleva al selector, que es lo
 *  que el banco hacía detrás y se le perdía. Deja el título en el home. */
async function nuevaPartidaResponde(ctx, nombre, pantalla) {
  if (pantalla !== "home") {
    ctx.expect(`${nombre}: «Nueva partida» responde y abre el selector`, false, `pantalla ${pantalla}`);
    await recargarAlTitulo(ctx);
    return;
  }
  await ctx.page.click("#ts-new", { timeout: 5_000 });
  const llega = await ctx.page
    .waitForSelector("#ts-gen", { timeout: 30_000 })
    .then(() => true, () => false);
  ctx.expect(`${nombre}: «Nueva partida» responde y abre el selector`, llega);
  await ctx.page.click("#ts-back");
}

export default async function (ctx) {
  await ctx.page.addInitScript(instrumentarRetenciones);
  await recargarAlTitulo(ctx);

  // ── A · «Volver» ────────────────────────────────────────────────────────
  const a = await salidaDuranteElRefresco(ctx, {
    nombre: "A · Volver",
    boton: "#ts-back",
    destino: "home",
    marca: "#ts-new",
  });
  await nuevaPartidaResponde(ctx, "A · Volver", a);

  // ── B · «Continuar» ─────────────────────────────────────────────────────
  const b = await salidaDuranteElRefresco(ctx, {
    nombre: "B · Continuar",
    boton: "#ts-continue",
    destino: "editor",
    marca: "#ts-start",
  });
  await recargarAlTitulo(ctx);
  ctx.log(`B terminó en ${b}; se recarga al título para el bloque C`);

  // ── C · «Subir estilo» ──────────────────────────────────────────────────
  const c = await salidaDuranteElRefresco(ctx, {
    nombre: "C · Subir estilo",
    boton: "#ts-upload-style",
    destino: "subir-estilo",
    marca: "#ts-upload-rows",
  });
  await recargarAlTitulo(ctx);
  ctx.log(`C terminó en ${c}; se recarga al título para el bloque D`);

  // ── D · «Volver» tras una pre-generación que FALLA ──────────────────────
  const d = await salidaDuranteElRefresco(ctx, {
    nombre: "D · Volver tras error",
    boton: "#ts-back",
    destino: "home",
    marca: "#ts-new",
    fase: "error",
  });
  await nuevaPartidaResponde(ctx, "D · Volver tras error", d);
}
