#!/usr/bin/env node
/** ¿Respeta el launcher los procesos que NO arrancó? (criterios 1 y 2)
 *
 *  Es el candado de la restricción permanente del usuario —«no le cerreis sus
 *  servers»— y no se puede afirmar leyendo: hay que poner un proceso ajeno en
 *  un puerto del catálogo y ver que sobrevive. Hasta el 2026-08-27 las nueve
 *  funciones `start_*` de `start.sh` hacían `port_busy && kill_port`: el preset
 *  más tonto se llevaba por delante el cliente de otro agente de la máquina.
 *
 *  Lo que se afirma, con señuelos PROPIOS que este guion arranca y retira:
 *
 *   1. arrancar con un puerto del catálogo ocupado por un proceso AJENO (cwd
 *      fuera del worktree) NO lo mata: el launcher se niega, dice quién es y
 *      sale con 1;
 *   2. `./start.sh --parar` (la tecla `k`) deja vivo lo ajeno y sí se lleva el
 *      huérfano de ESTE worktree, aunque no lo arrancara esta terminal.
 *
 *  Lo que NO se ejerce a propósito: `./start.sh --parar-todo` (la tecla `K`).
 *  Barre el catálogo entero «sea de quien sea», y en esta máquina trabajan
 *  varios proyectos a la vez —medido el 2026-08-27: un vite de `~/code/heroes`
 *  vivía en :3100, dentro del bloque +100 de ne-fan—. Un guion automático que
 *  lo dispare es exactamente lo que la tanda viene a impedir. Su mitad se
 *  comprueba a mano, con el señuelo delante.
 *
 *  Vive en `qa/` y no en `qa/guiones/` porque **ejecuta `./start.sh --parar`**:
 *  dentro de la batería se cargaría el stack que la batería está midiendo.
 *
 *  Uso:  node qa/no-mata-lo-ajeno.mjs
 *  Cero créditos: no arranca ningún backend; el único preset que toca es
 *  `html-fixtures`, y ni siquiera llega a levantarlo.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUERTOS_BASE, PUERTOS } from "./lib/stack.mjs";
import { puertoOcupado, esperarPuertoLibre } from "./lib/puertos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const fallos = [];
const ok = (t) => console.log(`  ✔ ${t}`);
const mal = (t, d) => {
  console.log(`  ✘ ${t}${d ? ` — ${d}` : ""}`);
  fallos.push(t);
};

/** Un señuelo: un servidor TCP mudo a la escucha en `puerto`, con el cwd que se
 *  le pida. El cwd es TODO el experimento — es lo que `start.sh` mira
 *  (`/proc/<pid>/cwd`) para decidir si un proceso es de este worktree o de otra
 *  persona.
 *
 *  Es un `node` y no un `nc -l` a propósito: `nc` sin `-k` deja de escuchar en
 *  cuanto alguien se conecta, y el propio sondeo del guion (`puertoOcupado`
 *  abre y cierra) se lo cargaba. El señuelo salía «vivo» sin ocupar nada y las
 *  tres afirmaciones medían un puerto libre — un rojo que no era del código.
 *
 *  Y la vida se lee del evento `exit` del hijo, NO de `process.kill(pid, 0)`:
 *  un hijo muerto y sin recoger es un zombi, y a un zombi la señal 0 le llega
 *  igual. Preguntándolo así, un señuelo que el launcher acababa de matar
 *  contestaba «sigo vivo» y el guion daba rojo sobre código correcto. */
function señuelo(puerto, cwd, etiqueta) {
  const p = spawn(
    process.execPath,
    ["-e", `require("node:net").createServer(s=>s.on("error",()=>{})).listen(${puerto},"0.0.0.0",()=>console.log("LISTO"))`],
    { cwd, stdio: ["ignore", "pipe", "ignore"] },
  );
  let muerto = false;
  p.on("exit", () => { muerto = true; });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`el señuelo ${etiqueta} no llegó a escuchar en :${puerto}`)), 10_000);
    p.stdout.on("data", () => {
      clearTimeout(t);
      console.log(`  · señuelo ${etiqueta} en :${puerto} (pid ${p.pid}, cwd ${cwd})`);
      res({ pid: p.pid, puerto, proc: p, vivo: () => !muerto });
    });
  });
}

/** Retira un señuelo NUESTRO. Se llama siempre, también si el guion revienta:
 *  dejar un proceso colgado en un puerto del catálogo es exactamente el estorbo
 *  que este guion viene a medir. */
async function retirar(s) {
  if (!s || !s.vivo()) return;
  s.proc.kill();
  await esperarPuertoLibre(s.puerto, { maxMs: 5_000 });
}

/** Espera a que un señuelo muera, o desiste. Hace falta porque el evento
 *  `exit` del hijo llega por el bucle de eventos y `spawnSync` lo bloquea
 *  entero: preguntando justo después, un señuelo ya muerto todavía contesta
 *  «vivo» y el guion daba rojo sobre código correcto (medido). */
function esperarMuerte(s, maxMs = 5_000) {
  return new Promise((res) => {
    if (!s.vivo()) return res(true);
    const t = setTimeout(() => res(!s.vivo()), maxMs);
    s.proc.once("exit", () => {
      clearTimeout(t);
      res(true);
    });
  });
}

const arrancados = [];

async function main() {
  // ── Preflight ────────────────────────────────────────────────────────────
  // Este guion EJECUTA `./start.sh --parar`, que se lleva lo que sea de este
  // worktree. Si hay un stack arriba no se puede saber si es tuyo, así que no
  // se toca nada y se sale con 2 (no es un veredicto del código).
  const sucios = [];
  for (const [clave, base] of Object.entries(PUERTOS_BASE)) {
    if (await puertoOcupado(base)) sucios.push(`${clave} (:${base})`);
  }
  if (sucios.length) {
    console.error(
      `❌ hay servicios del catálogo arriba (${sucios.join(", ")}). Este guion ejecuta\n` +
        `   ./start.sh --parar, que se lleva lo de este worktree: no se lanza a ciegas.\n` +
        `   Para tu stack y vuelve a lanzarlo.`,
    );
    process.exit(2);
  }

  console.log("▶ el launcher y los procesos que no arrancó\n");

  // ── 1. Arrancar NO mata al ocupante ajeno ───────────────────────────────
  const ajeno = await señuelo(PUERTOS.html, "/tmp", "AJENO");
  arrancados.push(ajeno);

  // `timeout` corto y con sentido: si el launcher ARRANCA se queda esperando
  // (`follow_logs`), así que agotarlo significa «arrancó encima», no «tardó».
  const r = spawnSync("./start.sh", ["--preset", "html-fixtures"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;

  if (r.status === 1) ok("el launcher se niega a arrancar sobre un puerto ajeno (exit 1)");
  else mal("el launcher se niega a arrancar sobre un puerto ajeno", r.status === null ? "no terminó: arrancó encima y se quedó sirviendo" : `salió con ${r.status}`);

  // No basta con que falle: tiene que DECIR de quién es el puerto, que es lo
  // que convierte un error en algo accionable («habla con su dueño»).
  if (/ocupado/.test(salida) && /lo tiene:/.test(salida)) ok("…y nombra al ocupante en vez de fallar a secas");
  else mal("nombra al ocupante", salida.split("\n").slice(-6).join(" / ").slice(0, 200));

  // Se pregunta por el SEÑUELO, no por «hay alguien en el puerto»: cuando el
  // launcher mataba al ocupante, quien contestaba en ese puerto un segundo después
  // era el cliente que acababa de arrancar encima — y el guion daba verde.
  if (!(await esperarMuerte(ajeno, 1_000))) ok("el proceso AJENO sigue vivo tras el intento de arranque");
  else mal("el proceso AJENO sigue vivo tras el intento de arranque", "lo mataron: es el fallo que esta tanda cierra");

  // ── 2. `--parar` (tecla k): lo ajeno se enumera, lo propio se para ──────
  // El huérfano propio es el caso REAL de la tecla: quien la pulsa casi nunca
  // ha arrancado nada en esa terminal, así que `STARTED_PORTS` está vacío y lo
  // único que puede reconocerlo es el worktree.
  const propio = await señuelo(PUERTOS.bridge, repoRoot, "PROPIO");
  arrancados.push(propio);

  const parar = spawnSync("./start.sh", ["--parar"], { cwd: repoRoot, encoding: "utf8", timeout: 120_000 });
  const salidaParar = `${parar.stdout ?? ""}${parar.stderr ?? ""}`;

  const soltó = await esperarPuertoLibre(PUERTOS.bridge, { maxMs: 10_000 });
  if ((await esperarMuerte(propio)) && soltó) ok("`--parar` SÍ se lleva el huérfano de este worktree (STARTED_PORTS vacío: lo pilla por cwd)");
  else mal("`--parar` se lleva el huérfano propio", "sigue vivo: la tecla k no sirve para su caso real");

  if (!(await esperarMuerte(ajeno, 1_000)) && (await puertoOcupado(PUERTOS.html))) ok("`--parar` NO toca el proceso ajeno");
  else mal("`--parar` NO toca el proceso ajeno", "lo mató: es «no le cerreis sus servers» incumplido");

  if (/AJENO, no se toca/.test(salidaParar)) ok("…y lo enumera diciendo por qué lo deja");
  else mal("enumera lo ajeno que deja vivo", salidaParar.split("\n").slice(0, 8).join(" / ").slice(0, 200));
}

try {
  await main();
} catch (err) {
  console.error("no-mata-lo-ajeno:", err);
  fallos.push(`ERROR: ${err.message}`);
} finally {
  // Los señuelos son NUESTROS y se retiran siempre.
  for (const s of arrancados) await retirar(s);
}

console.log(
  `\n${fallos.length === 0 ? "✔ arrancar no mata lo ajeno y `--parar` solo se lleva lo de este worktree" : `✘ ${fallos.length} fallo(s)`}`,
);
process.exit(fallos.length === 0 ? 0 : 1);
