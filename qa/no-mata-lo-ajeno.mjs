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
 *   3. un proceso con DOS puertos del catálogo (el bridge y la State API son
 *      uno solo) no se convierte en un ajeno de mentira. Hasta hoy sí: el
 *      bucle resolvía dueño y mataba en la MISMA pasada, así que al llegar a
 *      :state_api el proceso ya había muerto por el `kill_port` de :bridge, no
 *      se podía demostrar nada y salía «AJENO, no se toca». Consecuencia: TODO
 *      teardown imprimía «Para llevarte también lo ajeno: --parar-todo», que es
 *      el arma que «no le cerreis sus servers» prohíbe, recomendada por un
 *      fantasma.
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
import { PUERTOS_BASE, PUERTOS, PUERTOS_TODOS } from "./lib/stack.mjs";
import { puertoOcupado, esperarPuertoLibre } from "./lib/puertos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const fallos = [];
const ok = (t) => console.log(`  ✔ ${t}`);
const mal = (t, d) => {
  console.log(`  ✘ ${t}${d ? ` — ${d}` : ""}`);
  fallos.push(t);
};

/** Un señuelo: un servidor TCP mudo a la escucha en `puertos` (uno o varios),
 *  con el cwd que se le pida. El cwd es TODO el experimento — es lo que
 *  `start.sh` mira (`/proc/<pid>/cwd`) para decidir si un proceso es de este
 *  worktree o de otra persona.
 *
 *  Admite VARIOS puertos en un solo proceso porque así es el stack de verdad:
 *  el bridge y la State API son un proceso con dos puertos
 *  (`track_started $! "$PORT_BRIDGE" "$PORT_STATE"`), y ese es el caso que
 *  rompía el informe de `--parar`.
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
  const puertos = Array.isArray(puerto) ? puerto : [puerto];
  const guion =
    `const net=require("node:net");let n=0;const ps=${JSON.stringify(puertos)};` +
    `for(const p of ps)net.createServer(s=>s.on("error",()=>{}))` +
    `.listen(p,"0.0.0.0",()=>{if(++n===ps.length)console.log("LISTO")});`;
  const p = spawn(process.execPath, ["-e", guion], { cwd, stdio: ["ignore", "pipe", "ignore"] });
  let muerto = false;
  p.on("exit", () => { muerto = true; });
  return new Promise((res, rej) => {
    const t = setTimeout(
      () => rej(new Error(`el señuelo ${etiqueta} no llegó a escuchar en :${puertos.join(" :")}`)),
      10_000,
    );
    p.stdout.on("data", () => {
      clearTimeout(t);
      console.log(`  · señuelo ${etiqueta} en :${puertos.join(" :")} (pid ${p.pid}, cwd ${cwd})`);
      res({ pid: p.pid, puertos, proc: p, vivo: () => !muerto });
    });
  });
}

/** Retira un señuelo NUESTRO. Se llama siempre, también si el guion revienta:
 *  dejar un proceso colgado en un puerto del catálogo es exactamente el estorbo
 *  que este guion viene a medir. */
async function retirar(s) {
  if (!s || !s.vivo()) return;
  s.proc.kill();
  for (const puerto of s.puertos) await esperarPuertoLibre(puerto, { maxMs: 5_000 });
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
/** El entorno no permitió afirmar algo (hay procesos de otro worktree en los
 *  diez bloques que `--parar` mira). Sale con 2: ni verde ni rojo. */
let sinVeredicto = false;

async function main() {
  // ── Preflight ────────────────────────────────────────────────────────────
  // Este guion EJECUTA `./start.sh --parar`, que se lleva lo que sea de este
  // worktree. Si hay un stack arriba no se puede saber si es tuyo, así que no
  // se toca nada y se sale con 2 (no es un veredicto del código).
  // Se mira el bloque que ESTE proceso usa (base + NEFAN_PORT_OFFSET), no el
  // bloque 0 a secas: con offset 0 —el caso normal— es exactamente lo mismo,
  // y con offset ≠ 0 mirar el 0 era mirar el stack de OTRO agente, que este
  // guion ni toca ni puede tocar (`--parar` distingue por $PROJECT_DIR). Los
  // señuelos van a este bloque: si está ocupado, no hay experimento.
  const sucios = [];
  for (const clave of Object.keys(PUERTOS_BASE)) {
    const p = PUERTOS_TODOS[clave];
    if (await puertoOcupado(p)) sucios.push(`${clave} (:${p})`);
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

  // ── 3. Un proceso con DOS puertos no se convierte en un ajeno de mentira ─
  // El señuelo imita al bridge, que es un proceso con :bridge y :state_api
  // (`track_started $! "$PORT_BRIDGE" "$PORT_STATE"`). Para que el informe se
  // pueda leer entero no puede quedar NADA ajeno de los casos anteriores.
  await retirar(ajeno);

  const doble = await señuelo([PUERTOS.bridge, PUERTOS.state_api], repoRoot, "PROPIO×2");
  arrancados.push(doble);

  const parar2 = spawnSync("./start.sh", ["--parar"], { cwd: repoRoot, encoding: "utf8", timeout: 120_000 });
  const informe = `${parar2.stdout ?? ""}${parar2.stderr ?? ""}`;
  const lineas = informe.split("\n");
  const mios = [PUERTOS.bridge, PUERTOS.state_api];
  const ajenas = lineas.filter((l) => /AJENO/.test(l));
  const forasteras = ajenas.filter((l) => !mios.some((p) => l.includes(`:${p}`)));

  // Lo primero, o los tres asertos de abajo los pasaría un `cmd_stop` que no
  // hiciera NADA: el señuelo tiene que estar muerto y sus dos puertos libres.
  const murió = await esperarMuerte(doble);
  const libres = (await esperarPuertoLibre(PUERTOS.bridge, { maxMs: 10_000 }))
    && (await esperarPuertoLibre(PUERTOS.state_api, { maxMs: 10_000 }));
  if (murió && libres) ok("`--parar` se lleva el proceso de dos puertos y suelta los dos");
  else mal("`--parar` se lleva el proceso de dos puertos", `muerto=${murió} puertos_libres=${libres}`);

  // El aserto HERMÉTICO, el que es el bug: un puerto MÍO clasificado como
  // ajeno. Se puede afirmar aunque en la máquina haya stacks de otros
  // worktrees, porque solo mira las líneas que citan mis dos puertos.
  const miasAjenas = ajenas.filter((l) => mios.some((p) => l.includes(`:${p}`)));
  if (miasAjenas.length === 0) ok("ningún puerto del señuelo PROPIO sale como AJENO (antes :state_api salía siempre)");
  else mal("ningún puerto propio sale como AJENO", miasAjenas.map((l) => l.trim()).join(" / ").slice(0, 200));

  if (forasteras.length) {
    // No es un veredicto del código: hay algo de OTRO worktree en los diez
    // bloques que `--parar` mira, y con eso delante el aviso de `--parar-todo`
    // es CORRECTO. Rojo aquí sería rojo por el entorno, que es peor que no
    // contestar.
    console.log(`  ⚠ sin veredicto sobre el aviso de --parar-todo: hay ocupantes de otro worktree — ${forasteras.map((l) => l.trim()).join(" / ").slice(0, 160)}`);
    sinVeredicto = true;
  } else if (!/Para llevarte también lo ajeno/.test(informe)) {
    ok("…y el teardown NO recomienda `--parar-todo` por un fantasma");
  } else {
    mal("no se recomienda --parar-todo sin ajenos", "el aviso salía en TODO teardown");
  }

  // Al matar, `fuser` escupía los pids a stdout y ensuciaba el informe. Se
  // afirma «ninguna línea EMPIEZA por un dígito» y no «ninguna línea es solo
  // dígitos» porque `fuser` no cierra con salto: medido, el pid se pega
  // delante de la línea siguiente (`89419    ⏭  :9978 …`), así que el aserto
  // «solo dígitos» habría salido verde con el informe partido delante. Ninguna
  // línea legítima empieza por número. Se mira siempre: no depende de ajenos.
  const conPids = lineas.filter((l) => /^\s*\d/.test(l));
  if (conPids.length === 0) ok("el informe no se parte con la salida de `fuser` (ninguna línea empieza por pids)");
  else mal("el informe no se parte con la salida de fuser", `líneas con pids: ${conPids.map((l) => l.trim().slice(0, 60)).join(" / ")}`);

  // Un proceso, una línea: los puertos que comparten pids se agrupan. Es lo
  // que hace visible que la propiedad se resolvió ANTES de matar nada.
  const juntos = lineas.filter((l) => l.includes(`:${PUERTOS.bridge}`) && l.includes(`:${PUERTOS.state_api}`));
  if (juntos.length === 1) ok("los dos puertos del mismo proceso salen en UNA línea");
  else mal("los puertos del mismo proceso se agrupan", `líneas que citan los dos: ${juntos.length}`);
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
if (fallos.length === 0 && sinVeredicto) {
  console.log("⚠ pero el entorno no dejó comprobarlo todo: sale con 2, no con 0.");
  process.exit(2);
}
process.exit(fallos.length === 0 ? 0 : 1);
