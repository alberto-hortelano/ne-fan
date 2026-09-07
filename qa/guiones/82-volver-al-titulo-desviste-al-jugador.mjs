/** Volver al título DESVISTE al jugador: la partida siguiente no re-pide su skin.
 *
 *  Escrito por QA del corte 5 de #358 (2026-09-06). Al salir de `main.ts`, el
 *  prompt del skin del jugador dejó de ser un `let` que `resetWorld` ponía a
 *  `""` desde fuera y pasó a ser `aspecto.desvestir()` en
 *  `renderer/aspecto-del-jugador.ts`. El comentario que lo acompaña dice para
 *  qué existe: «dejarlo puesto hace que volver al título re-pida su skin IA
 *  (imagen de pago) por un mundo que ya no existe». Ningún guion lo medía.
 *
 *  POR QUÉ NO BASTA RECARGAR. La pasada de ojos del ingeniero comprobó
 *  «partida A con prompt → recargar → partida B sin prompt» y B no pidió
 *  nada del jugador; pero recargar tira el módulo entero, así que ese camino
 *  sale verde CON y SIN `desvestir()`. El único camino del jugador de vuelta
 *  al título dentro de la misma página es el muro del mundo vacío (#189), y
 *  ese es el que recorre este guion: la técnica del guion 20 (un bridge
 *  propio sin motor, elegido con `?bridge=`; los skins siguen yendo al motor
 *  falso del runner por `?ai=`).
 *
 *  DÓNDE SE VE. `session.leave()` aplica las facetas neutras, y con los modos
 *  en `""` los personajes caen al toggle local (OFF por defecto). Al ENTRAR la
 *  partida siguiente, `aplicar` (`ui/modos-de-graficos.ts`) ve OFF→ON y
 *  re-pide todos los skins leyendo `aspecto.skinPrompt()` ANTES de que la
 *  partida nueva vista al jugador (el sink `mundo` corre primero, por eso
 *  `desvestir()` ya ha pasado). Sin `desvestir()`, ahí sale un POST a
 *  `/skin_sprite_sheet` con el prompt de la partida anterior: una imagen de
 *  pago por un mundo que ya no existe. Eso es lo que se cuenta en el cable.
 *
 *  PROBADO EN NEGATIVO (2026-09-06): con `aspecto.desvestir();` quitado de
 *  `resetWorld` (`main.ts`), los dos asertos de la partida B se ponen ROJOS
 *  con dos POST del prompt de A (`idle` y `walk`, sin rol) al entrar B, y el
 *  libro de B vuelve a tener al jugador de A; las dos precondiciones siguen
 *  verdes.
 *
 *  Cero créditos: el bridge propio no llega a llamar a ningún servicio y los
 *  skins los sirve el motor falso del runner.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { esperarPuertoArriba, esperarPuertoLibre, puertoOcupado, puertosLibres } from "../lib/puertos.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
/** El prompt del jugador de la partida A. Distintivo: ningún NPC del motor
 *  falso lo lleva, así que cualquier POST con él es del jugador. */
const PROMPT_A = "caballero con armadura roja y capa gris (QA-82)";
const [PUERTO_WS, PUERTO_STATE] = await puertosLibres(2);
const MOTOR_MUERTO = "http://127.0.0.1:9";

/** Disco propio SIN snapshots de mundo (con ellos el arranque no llamaría al
 *  motor y la partida arrancaría igual: no habría mundo vacío que medir). */
function prepararDisco() {
  const dir = mkdtempSync(join(tmpdir(), "qa82-"));
  mkdirSync(join(dir, "saves"), { recursive: true });
  cpSync(join(RAIZ, "nefan-core", "data", "games"), join(dir, "games"), { recursive: true });
  const plugins = join(RAIZ, "nefan-core", "data", "plugins");
  if (existsSync(plugins)) cpSync(plugins, join(dir, "plugins"), { recursive: true });
  for (const juego of readdirSync(join(dir, "games"))) {
    const world = join(dir, "games", juego, "world");
    if (!existsSync(world)) continue;
    for (const f of readdirSync(world)) {
      if (f.endsWith(".json")) rmSync(join(world, f), { force: true });
    }
  }
  return dir;
}

/** Igual que en el guion 20: grupo propio para que el `tsx` de dentro de `npx`
 *  muera con el envoltorio. */
async function arrancarBridgeSinMotor(ctx) {
  if (await puertoOcupado(PUERTO_WS)) {
    throw new Error(`:${PUERTO_WS} está ocupado y este guion necesita ese puerto para su bridge sin motor`);
  }
  const dir = prepararDisco();
  const proc = spawn("npx", ["tsx", "bridge/ws-server.ts"], {
    cwd: join(RAIZ, "nefan-core"),
    stdio: ["ignore", "pipe", "pipe"],
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
  await esperarPuertoArriba(PUERTO_WS, {
    maxMs: 90_000,
    quien: "el bridge sin motor",
    siMuere: () => (proc.exitCode !== null ? salida.join("").slice(-500) : null),
  });
  ctx.log(`bridge sin motor en :${PUERTO_WS} · disco ${dir}`);
  return { proc, dir };
}

/** Título → mundo → personajes IA → Continuar → (prompt) → Comenzar. Es el
 *  formulario del jugador, tecla a tecla; el prompt va en `#ts-skin`. */
async function comenzarCon(ctx, prompt) {
  await ctx.page.waitForSelector("#ts-new", { timeout: 30_000 });
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);
  await ctx.page.click(`#ts-charmode [data-charmode="image"]`);
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  // El campo se escribe SIEMPRE (también con ""): si el título recordara el
  // prompt de la partida anterior, B lo llevaría por el formulario y este
  // guion mediría eso en vez de `desvestir()`. Se anota lo que había.
  const habia = await ctx.page.$eval("#ts-skin", (el) => el.value);
  await ctx.page.fill("#ts-skin", prompt);
  ctx.log(`#ts-skin: había ${JSON.stringify(habia)} → ${JSON.stringify(prompt)}`);
  await ctx.page.click("#ts-start");
}

const esperarMuro = (ctx) =>
  ctx.waitFor(
    "el muro del mundo vacío aparece",
    () => (document.getElementById("narrative-loader")?.classList.contains("error") ? true : null),
    90_000,
  );

export default async function (ctx) {
  const { proc, dir } = await arrancarBridgeSinMotor(ctx);
  try {
    /** Cada POST a /skin_sprite_sheet, con la FASE en la que llegó. */
    const posts = [];
    let fase = "A";
    await ctx.page.route("**/skin_sprite_sheet", async (route) => {
      let body = {};
      try {
        body = JSON.parse(route.request().postData() ?? "{}");
      } catch (err) {
        ctx.log(`cuerpo de /skin_sprite_sheet ilegible: ${String(err).slice(0, 80)}`);
      }
      posts.push({ fase, prompt: String(body.prompt ?? ""), anim: String(body.anim ?? ""), role: body.style_role ?? null });
      await route.continue();
    });

    const url = new URL(ctx.page.url());
    url.searchParams.set("bridge", `ws://127.0.0.1:${PUERTO_WS}`);
    await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await ctx.waitFor("window.__nefan disponible", () => Boolean(window.__nefan));

    // ── 1 · Partida A: el jugador se viste, y el mundo no llega ─────────────
    await comenzarCon(ctx, PROMPT_A);
    await esperarMuro(ctx);
    const sesionA = await ctx.page.evaluate(() => window.__nefan.sesion().sessionId);
    // `vestir` corre ANTES del fallo del tile (start_session contesta ok:true
    // primero): el jugador tiene su prompt en el libro, sin rol.
    const jugadorA = await ctx.waitFor(
      "el jugador de A pidió su skin (su prompt en el libro, sin rol)",
      (p) => window.__nefan.skins.find((s) => s.prompt === p && !s.role) ?? null,
      60_000,
      PROMPT_A,
    );
    ctx.log(`partida A ${sesionA} · libro: ${JSON.stringify(jugadorA)}`);
    // …y la cola de ESE skin se ha asentado: en el banco `idle` se sirve y
    // `walk` da 500, así que acaba `failed`. Se espera a que pare, porque un
    // POST rezagado de la cola de A que llegara tras «Volver al título» se
    // contaría como re-petición sin serlo.
    const asentado = await ctx.waitFor(
      "la cola del skin de A se asienta (falló en walk, o no le queda nada encolado)",
      (p) => {
        const s = window.__nefan.skins.find((x) => x.prompt === p);
        return s && (s.failed || s.queued.length === 0) ? s : null;
      },
      60_000,
      PROMPT_A,
    );
    const postsA = posts.filter((p) => p.prompt === PROMPT_A);
    ctx.log(`skin de A asentado: ${JSON.stringify(asentado)} · POST con prompt A en la fase A: ${postsA.length}`);
    await ctx.shot("partida-a-vestido-y-sin-mundo");
    ctx.expect(
      "PRECONDICIÓN — el jugador de A pidió su skin al motor falso (si no, no hay skin que desvestir)",
      postsA.length >= 1 && postsA.every((p) => p.role === null),
      JSON.stringify(postsA),
    );
    // Sin sesión, los personajes caen al toggle local: si estuviera en ON, el
    // OFF→ON que dispara la re-petición no ocurriría y este guion saldría
    // verde sin medir nada. Se afirma la precondición en vez de confiar.
    const toggleLocal = await ctx.page.evaluate(() => localStorage.getItem("nefan.aichar"));
    ctx.expect(
      "PRECONDICIÓN — el toggle local de personajes IA no está en ON (sin él, no habría OFF→ON al entrar B)",
      toggleLocal !== "1",
      `localStorage nefan.aichar=${JSON.stringify(toggleLocal)}`,
    );

    // ── 2 · «Volver al título»: el jugador se desviste con el mundo que se va ──
    fase = "vuelta";
    await ctx.page.click("#narrative-loader-back");
    await ctx.waitFor(
      "el título vuelve con el motivo escrito",
      () => {
        const btn = document.getElementById("ts-new");
        const motivo = document.getElementById("ts-error")?.textContent?.trim() ?? "";
        return btn && motivo ? motivo : null;
      },
      30_000,
    );

    // ── 3 · Partida B, sin prompt: nadie re-pide el skin de A ────────────────
    fase = "B";
    await comenzarCon(ctx, "");
    await esperarMuro(ctx);
    const sesionB = await ctx.waitFor(
      "la partida B entró (otra sesión que la de A)",
      (a) => {
        const id = window.__nefan.sesion().sessionId;
        return id && id !== a ? id : null;
      },
      30_000,
      sesionA,
    );
    // Lo que se está midiendo es la re-petición del OFF→ON de la ENTRADA de
    // B, que ya ha pasado cuando el muro de B está puesto. Se deja pasar una
    // vuelta más del libro para que cualquier POST en vuelo llegue al cable.
    await ctx.waitFor("el libro de B se lee", () => Array.isArray(window.__nefan.skins), 5_000);
    const libroB = await ctx.page.evaluate(() => window.__nefan.skins);
    const desdeLaVuelta = posts.filter((p) => p.fase !== "A");
    const rePedidos = desdeLaVuelta.filter((p) => p.prompt === PROMPT_A);
    ctx.log(`partida B ${sesionB} · POST desde «Volver al título»: ${JSON.stringify(desdeLaVuelta)}`);
    ctx.log(`libro en B: ${JSON.stringify(libroB)}`);
    await ctx.shot("partida-b-sin-el-skin-de-a");
    ctx.expect(
      "volver al título desvistió al jugador: la entrada de B no re-pide el skin de A (ningún POST con su prompt)",
      rePedidos.length === 0,
      `${rePedidos.length} POST con el prompt de A tras volver: ${JSON.stringify(rePedidos)}`,
    );
    ctx.expect(
      "…y B, sin prompt, no pide ningún skin de jugador (todo POST desde la vuelta lleva rol de NPC)",
      desdeLaVuelta.every((p) => p.role !== null),
      JSON.stringify(desdeLaVuelta.filter((p) => p.role === null)),
    );
  } finally {
    try { process.kill(-proc.pid, "SIGTERM"); } catch { /* ya se había ido */ }
    if (!(await esperarPuertoLibre(PUERTO_WS, { maxMs: 15_000 }))) {
      ctx.log(`⚠ :${PUERTO_WS} sigue ocupado tras 15 s: la próxima corrida de este guion fallará al arrancar`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
