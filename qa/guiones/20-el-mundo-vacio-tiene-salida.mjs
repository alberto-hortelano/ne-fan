/** El fallo que responde `ok` y falla DESPUÉS: el mundo que no llega.
 *
 *  Es el hueco que el QA del 2026-08-23 dejó abierto en su §3.2 y que la ronda
 *  de corrección cerró (C5): `start_session` contesta `ok:true` ANTES de
 *  generar el tile, así que un motor que no responde durante la generación del
 *  mundo inicial NO hace rechazar a `startSession` y NO pasa por el catch del
 *  bucle del título. Antes de C5 el jugador acababa con cielo vacío, barra de
 *  vida al 100 %, cinco botones de ataque, cero tiles y ninguna forma de
 *  volver que no fuera recargar la página — literalmente la frase de #189.
 *
 *  Y es el mismo camino donde se leía «Error: No se pudo generar la escena.
 *  fetch failed» (#180): el catch de `bridge/handlers/bootstrap-tile.ts`, que
 *  NO es el ternario de `tile.ts` al que apuntaba el hallazgo.
 *
 *  ── Cómo se provoca el fallo SIN matar nada de la batería ────────────────
 *  Un SEGUNDO bridge, en un puerto libre y con su propio disco, apuntado a un
 *  ai_server que no existe (`NEFAN_AI_SERVER=http://127.0.0.1:9`). El cliente
 *  lo elige con `?bridge=`, que es un override REAL del contrato
 *  (`nefan-html/src/net/service-urls.ts`, `NEFAN_URL_GAME_GATEWAY`).
 *
 *  No es estado sintético y no es un workaround: el fallo lo produce el motor
 *  de verdad al no estar (ECONNREFUSED), recorre el bridge de verdad y llega
 *  al cliente por el `narrative_status` de siempre. Lo único que se evita es
 *  matar el fake-ai-server compartido —que dejaría sin motor a los otros 18
 *  guiones— o el `trap` de `./start.sh`, que se lleva el stack entero cuando
 *  muere un hijo.
 *
 *  La alternativa que apuntaban el QA anterior y el ingeniero —un
 *  `/dev/fail_next_scene` en el fake-ai-server— sigue siendo válida y sería
 *  más barata; esta no toca el motor falso, que es de todos.
 *
 *  Cero créditos: el bridge de prueba no llega a llamar a ningún servicio.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { esperarPuertoArriba, esperarPuertoLibre, puertoOcupado, puertosLibres } from "../lib/puertos.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
/** Puertos LIBRES pedidos al sistema, fuera del catálogo de `start.sh`: este
 *  bridge no puede suplantar al de la batería.
 *
 *  Eran dos literales (9977/9978), y con eso este guion era el único de los
 *  treinta que impedía correr DOS baterías a la vez: las dos pedían los mismos
 *  dos puertos y la segunda moría diciendo «ocupado». Se piden al kernel
 *  (bind :0), que es quien sabe cuáles están libres. */
const [PUERTO_WS, PUERTO_STATE] = await puertosLibres(2);
/** Un puerto donde NO hay nada: el motor "caído" sin matar a nadie. */
const MOTOR_MUERTO = "http://127.0.0.1:9";

/** Disco propio: los mundos del repo SIN los snapshots pre-generados. Con
 *  ellos, `start_session` replaya el snapshot y NO llama al motor («world
 *  snapshot HIT — bootstrap sin motor»): el motor estaría muerto y la partida
 *  arrancaría igual, y este guion daría verde sin probar nada. */
function prepararDisco() {
  const dir = mkdtempSync(join(tmpdir(), "qa20-"));
  mkdirSync(join(dir, "saves"), { recursive: true });
  cpSync(join(RAIZ, "nefan-core", "data", "games"), join(dir, "games"), { recursive: true });
  const plugins = join(RAIZ, "nefan-core", "data", "plugins");
  if (existsSync(plugins)) cpSync(plugins, join(dir, "plugins"), { recursive: true });
  let borrados = 0;
  for (const juego of readdirSync(join(dir, "games"))) {
    const world = join(dir, "games", juego, "world");
    if (!existsSync(world)) continue;
    for (const f of readdirSync(world)) {
      if (f.endsWith(".json")) { rmSync(join(world, f), { force: true }); borrados++; }
    }
  }
  return { dir, borrados };
}

async function arrancarBridgeSinMotor(ctx) {
  if (await puertoOcupado(PUERTO_WS)) {
    throw new Error(`:${PUERTO_WS} está ocupado y este guion necesita ese puerto para su bridge sin motor`);
  }
  const { dir, borrados } = prepararDisco();
  ctx.log(`disco propio: ${dir} (${borrados} snapshot(s) de mundo borrados: si quedara uno, el arranque no llamaría al motor)`);
  const proc = spawn("npx", ["tsx", "bridge/ws-server.ts"], {
    cwd: join(RAIZ, "nefan-core"),
    stdio: ["ignore", "pipe", "pipe"],
    // Grupo propio: `npx` es un envoltorio y matarlo a él deja vivo al `tsx`
    // de dentro — que es quien tiene el puerto. Medido: la segunda corrida
    // del guion moría con «:9977 está ocupado».
    detached: true,
    env: {
      ...process.env,
      NEFAN_BRIDGE_PORT: String(PUERTO_WS),
      NEFAN_STATE_HTTP_PORT: String(PUERTO_STATE),
      NEFAN_AI_SERVER: MOTOR_MUERTO,
      NEFAN_SAVES_DIR: join(dir, "saves"),
      NEFAN_GAMES_DIR: join(dir, "games"),
    },
  });
  const salida = [];
  proc.stdout.on("data", (b) => salida.push(String(b)));
  proc.stderr.on("data", (b) => salida.push(String(b)));
  // Espera por ESTADO, no por reloj (`qa/lib/puertos.mjs`): el puerto acepta,
  // o el proceso se ha muerto y lo dice con lo que haya escrito.
  await esperarPuertoArriba(PUERTO_WS, {
    maxMs: 90_000,
    quien: "el bridge sin motor",
    siMuere: () => (proc.exitCode !== null ? salida.join("").slice(-500) : null),
  });
  return { proc, dir, salida };
}

/** El muro del loader, tal y como lo ve quien juega. */
const leerMuro = (ctx) =>
  ctx.page.evaluate(() => {
    const l = document.getElementById("narrative-loader");
    const volver = document.getElementById("narrative-loader-back");
    const cerrar = document.getElementById("narrative-loader-dismiss");
    return {
      enError: Boolean(l?.classList.contains("error")),
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
      // `hidden` NO basta: `nf-action` es `inline-flex` y ganaría al atributo
      // sin la regla explícita de game-ui.css. Se mira si OCUPA sitio.
      volverVisible: Boolean(volver) && volver.offsetParent !== null,
      cerrarVisible: Boolean(cerrar) && cerrar.offsetParent !== null,
    };
  });

/** Título → mundo → personajes → Continuar → Comenzar. */
async function hastaComenzar(ctx) {
  await ctx.page.waitForSelector("#ts-new", { timeout: 30_000 });
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);
  await ctx.page.click(`#ts-charmode [data-charmode="vector"]`);
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-start");
}

const esperarMuro = (ctx) =>
  ctx.waitFor(
    "el muro de error del arranque aparece",
    () => (document.getElementById("narrative-loader")?.classList.contains("error") ? true : null),
    90_000,
  );

export default async function (ctx) {
  const { proc, dir } = await arrancarBridgeSinMotor(ctx);
  try {
    // El cliente, apuntado al bridge SIN motor. El resto de parámetros del
    // runner (input scripted, rAF por timer, el fake-ai para los skins) se
    // conservan: solo cambia la pasarela.
    const url = new URL(ctx.page.url());
    url.searchParams.set("bridge", `ws://127.0.0.1:${PUERTO_WS}`);
    await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await ctx.waitFor("window.__nefan disponible", () => Boolean(window.__nefan));
    await ctx.page.waitForSelector("#ts-new", { timeout: 30_000 });
    // Marca de agua del cliente SIN partida: es contra esto contra lo que se
    // compara la vuelta al título por el camino tardío (#249).
    const antesDeEmpezar = await leerCliente(ctx);
    ctx.log(`cliente en el título: ${JSON.stringify(antesDeEmpezar)}`);

    // ── 1. El arranque falla DESPUÉS del ok:true ──────────────────────────
    await hastaComenzar(ctx);
    await esperarMuro(ctx);
    const muro = await leerMuro(ctx);
    const mundo = await ctx.page.evaluate(() => ({
      tiles: window.__nefan.tiles.length,
      escena: window.__nefan.status().scene,
    }));
    ctx.log(`TÍTULO : ${muro.titulo}`);
    ctx.log(`DETALLE: ${muro.detalle}`);
    ctx.log(`mundo  : ${mundo.tiles} tile(s) · escena=${mundo.escena}`);
    await ctx.shot("el-mundo-que-no-llego");

    // NO CONCLUYENTE antes que verde: si hubiera mundo detrás, el caso bajo
    // prueba (el callejón del mundo vacío) no sería este.
    ctx.expect(
      "el fallo deja el mundo VACÍO (si no, este guion no prueba lo suyo)",
      mundo.tiles === 0 && !mundo.escena,
      JSON.stringify(mundo),
    );
    ctx.expect(
      "el muro del ARRANQUE no le enseña la excepción del motor (#180)",
      !/fetch failed|ECONNREFUSED|socket hang up|^Error:|generar la escena/i.test(muro.detalle),
      muro.detalle,
    );
    ctx.expect(
      "…y le dice qué ha pasado en una frase que puede accionar",
      /no responde/i.test(muro.detalle) && muro.titulo === "La partida no pudo empezar",
      `${muro.titulo} · ${muro.detalle}`,
    );
    ctx.expect(
      "el muro del mundo vacío ofrece VOLVER AL TÍTULO (#189)",
      muro.volverVisible,
      "el jugador se queda con cielo vacío, cinco botones de ataque y recargar como única salida",
    );
    // #279, criterio 3: el motor no respondió y el jugador se quedó sin
    // mundo — tampoco puede quedarle una partida en la lista. Este bridge
    // tiene su PROPIO disco (`dir`), así que aquí sí se puede afirmar sobre
    // el total y no sobre un delta: cualquier cosa que aparezca ahí la ha
    // escrito este arranque.
    const savesDelBridgeSinMotor = readdirSync(join(dir, "saves"));
    ctx.log(`saves del bridge sin motor: ${JSON.stringify(savesDelBridgeSinMotor)}`);
    ctx.expect(
      "un arranque sin motor no deja partida en disco (no hay partidas vacías)",
      savesDelBridgeSinMotor.length === 0,
      JSON.stringify(savesDelBridgeSinMotor),
    );
    // Y SOLO esa. «Cerrar» al lado, con el mismo peso visual, lleva al mismo
    // callejón que la salida viene a abrir: sin mundo no hay adónde cerrar.
    // En los muros que SÍ tienen partida detrás sigue estando (es el que
    // pulsa `qa/fixtures-sin-bridge.mjs` para entrar al modo fixtures).
    ctx.expect(
      "…y NO ofrece «Cerrar», que devolvía al callejón de #189 en un click",
      !muro.cerrarVisible,
      "la salida y la trampa conviven con el mismo aspecto: media pantalla pulsará la que no es",
    );
    // Sin botón no hay nada más que probar: se para aquí en vez de dejar que
    // Playwright se coma su timeout pulsando un elemento invisible (el rojo
    // sería el mismo, pero ilegible).
    if (!muro.volverVisible) return;

    // ── 2. La salida funciona, y no es cosmética ──────────────────────────
    await ctx.page.click("#narrative-loader-back");
    const vuelta = await ctx.waitFor(
      "el título vuelve con el motivo escrito",
      () => {
        const raiz = document.getElementById("title-screen");
        const btn = document.getElementById("ts-new");
        const motivo = document.getElementById("ts-error")?.textContent?.trim() ?? "";
        if (!raiz || !btn || !motivo) return null;
        return {
          visible: getComputedStyle(raiz).display !== "none",
          motivo,
          muroVisible: Boolean(document.getElementById("narrative-loader")?.classList.contains("visible")),
          tiles: window.__nefan.tiles.length,
        };
      },
      30_000,
    );
    ctx.log(`#ts-error: ${vuelta.motivo}`);
    await ctx.shot("de-vuelta-en-el-titulo");
    ctx.expect(
      "«Volver al título» devuelve al título, con el motivo escrito y sin el muro encima",
      vuelta.visible && !vuelta.muroVisible,
      JSON.stringify(vuelta),
    );
    ctx.expect(
      "…y el motivo tampoco es jerga de motor",
      !/fetch failed|ECONNREFUSED|^Error:/i.test(vuelta.motivo),
      vuelta.motivo,
    );
    // #249 — el camino TARDÍO: `start_session` contestó ok:true, la sesión se
    // aplicó ENTERA (estilo, tema, modos, combate, libro de historia) y el
    // fallo llegó después. Es el caso que el issue daba por «no medido»:
    // volver por aquí tiene que dejar el cliente igual que volver por el
    // catch del bucle — y sin haber pagado una imagen con el estilo de una
    // partida que no arrancó.
    const trasVolver = await leerCliente(ctx);
    ctx.log(`cliente tras volver: ${JSON.stringify(trasVolver)}`);
    ctx.expect(
      "un fallo TARDÍO devuelve el cliente al estado del título, sin media sesión pegada",
      JSON.stringify(trasVolver.sesion) === JSON.stringify(antesDeEmpezar.sesion),
      `${JSON.stringify(antesDeEmpezar.sesion)} → ${JSON.stringify(trasVolver.sesion)}`,
    );
    ctx.expect(
      "…y sin pagar una imagen por la partida que no arrancó",
      trasVolver.imagenes === antesDeEmpezar.imagenes,
      `caché ${antesDeEmpezar.imagenes} → ${trasVolver.imagenes}`,
    );
    ctx.expect(
      "…con el HUD y el error-log fuera de la pantalla del título (#246)",
      trasVolver.cajas.gameUi === 0 && trasVolver.cajas.errorLog === 0,
      JSON.stringify(trasVolver.cajas),
    );

    // El mundo sigue a cero, pero eso NO se afirma aquí: en este camino el
    // mundo ya nace vacío (el fallo es el del primer tile), así que un
    // `tiles === 0` pasaría con `resetWorld()` puesto y quitado — un verde
    // incapaz de ponerse rojo. Se registra como dato y se deja de afirmar.
    ctx.log(`mundo tras la vuelta: ${vuelta.tiles} tile(s)`);

    // ── 3. El título de vuelta está VIVO ──────────────────────────────────
    // Con el motor muerto no hay partida que arrancar, así que la prueba de
    // vida es la otra mitad: que «Comenzar» vuelva a RESOLVER. Si `show()` no
    // rearmara su promesa, el segundo «Comenzar» sería un no-op mudo y no
    // habría segundo muro nunca.
    await ctx.page.evaluate(() => {
      document.getElementById("narrative-loader")?.classList.remove("error", "visible");
    });
    await hastaComenzar(ctx);
    const segundo = await esperarMuro(ctx).then(() => leerMuro(ctx)).catch(() => null);
    ctx.expect(
      "el título de vuelta está VIVO: «Comenzar» vuelve a arrancar una sesión (su promesa se rearmó)",
      Boolean(segundo?.enError),
      "el título se ve pero su «Comenzar» no resuelve a nadie: no hubo segundo intento",
    );
    ctx.expect(
      "…y el segundo fallo seguido también ofrece la salida",
      Boolean(segundo?.volverVisible),
      JSON.stringify(segundo),
    );
  } finally {
    // El GRUPO entero (ver `detached` arriba), y esperando a que el puerto se
    // suelte: si el guion volviera a correr con el `tsx` todavía vivo, se
    // caería en el arranque en vez de probar nada.
    try { process.kill(-proc.pid, "SIGTERM"); } catch { /* ya se había ido */ }
    if (!(await esperarPuertoLibre(PUERTO_WS, { maxMs: 15_000 }))) {
      ctx.log(`⚠ :${PUERTO_WS} sigue ocupado tras 15 s: la próxima corrida de este guion fallará al arrancar`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Lo que el cliente tiene APLICADO ahora mismo (mismo lector que el guion
 *  18): facetas de la sesión, contador de imágenes del panel de dev y tamaño
 *  de las cajas que el título tiene que tapar. */
function leerCliente(ctx) {
  return ctx.page.evaluate(() => {
    const area = (id) => {
      const el = document.getElementById(id);
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return Math.round(r.width * r.height);
    };
    return {
      sesion: window.__nefan.sesion(),
      imagenes: document.getElementById("ds-cache")?.textContent ?? "(sin panel)",
      cajas: { gameUi: area("game-ui"), errorLog: area("error-log"), devStatus: area("dev-status") },
    };
  });
}
