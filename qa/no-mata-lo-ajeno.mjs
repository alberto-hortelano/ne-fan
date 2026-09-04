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
 *   4. un proceso AJENO que toma un puerto del catálogo **durante** el barrido
 *      no se lleva el tiro. La foto de dueños del caso 3 abrió esa ventana si
 *      además se mata por PUERTO: el recién llegado muere con la clasificación
 *      del ocupante anterior. Se mata por PID.
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

  // Un exit 1 NO basta, y salió caro: en un worktree recién creado no hay
  // `node_modules`, el preflight sale con 1 antes de mirar puerto ninguno, y
  // este aserto lo daba por bueno — verde por un motivo que no tiene nada que
  // ver con lo que mide. Así que se exige exit 1 **por el puerto**, y un
  // preflight caído se dice como lo que es: entorno, no veredicto.
  if (/Preflight failed/.test(salida)) {
    console.log("  ⚠ sin veredicto: el preflight del launcher falló (faltan dependencias del worktree)");
    console.log(`    ${salida.split("\n").filter((l) => /—|Preflight/.test(l)).slice(0, 4).join(" / ").slice(0, 200)}`);
    sinVeredicto = true;
  } else if (r.status === 1 && /ocupado/.test(salida)) {
    ok("el launcher se niega a arrancar sobre un puerto ajeno (exit 1 POR EL PUERTO)");
  } else {
    mal("el launcher se niega a arrancar sobre un puerto ajeno", r.status === null ? "no terminó: arrancó encima y se quedó sirviendo" : `salió con ${r.status}`);
  }

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

  // El aviso, en su forma SIEMPRE EVALUABLE: sale si y solo si el informe
  // imprimió al menos una línea AJENO. La forma anterior («no aparece el
  // aviso») dependía de que no hubiera nadie más en la máquina, así que se
  // marcaba «sin veredicto» casi siempre — y en la corrida en negativo tampoco
  // se evaluaba, que es lo peor que le puede pasar a un aserto (H6 de QA). Con
  // esta y con la hermética de arriba el fantasma queda cazado igual: el aviso
  // solo puede encenderse por un AJENO, y ningún puerto mío puede serlo.
  const hayAviso = /Para llevarte también lo ajeno/.test(informe);
  if (hayAviso === (ajenas.length > 0)) {
    ok(`el aviso de \`--parar-todo\` sale si y solo si hay ajenos (aquí: ${ajenas.length} ajeno(s), aviso ${hayAviso ? "sí" : "no"})`);
  } else {
    mal("el aviso de --parar-todo va atado a que haya ajenos",
        `ajenos=${ajenas.length} aviso=${hayAviso} — antes salía en TODO teardown por el fantasma de :state_api`);
  }
  if (forasteras.length) {
    console.log(`    (nota: los ${forasteras.length} ajeno(s) son de otro worktree, así que el aviso es correcto aquí)`);
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

  await tiroTardio();
}

/** ── 4. Un ajeno que llega DURANTE el barrido no se lleva el tiro ──────────
 *
 *  La regresión que introdujo la foto de dueños, y la encontró QA: la foto se
 *  toma antes de barrer, pero si además se MATA POR PUERTO, un proceso que tome
 *  ese puerto entre la foto y su turno muere con la clasificación del ocupante
 *  anterior. La ventana pasó de ~0 a la pasada entera. Y el disparador es el
 *  escenario normal: `start.sh` se niega a arrancar sobre un puerto ocupado, así
 *  que quien espera a que se libere un bloque arranca justo ahí.
 *
 *  El experimento: cuatro señuelos PROPIOS, uno de ellos en el último puerto del
 *  orden de barrido; se lanza `--parar`; a los 300 ms se retira el último y entra
 *  uno AJENO en su sitio. Cuando el barrido llegue a ese puerto, matando por PID
 *  no le pasa nada; matando por puerto, muere.
 *
 *  No puede dar un verde falso: si el señuelo propio del último puerto no sale
 *  en el informe, el barrido no llegó a evaluarlo y se dice «sin veredicto» en
 *  vez de cantar victoria. */
async function tiroTardio() {
  const tardio = PUERTOS.fake_ai;                 // el último de ALL_PORTS
  const lentos = [PUERTOS_TODOS.asset_store, PUERTOS_TODOS.remote_gen];

  const propios = [];
  for (const p of lentos) propios.push(await señuelo(p, repoRoot, `PROPIO :${p}`));
  const ultimo = await señuelo(tardio, repoRoot, `PROPIO :${tardio} (el del relevo)`);
  propios.push(ultimo);
  arrancados.push(...propios);

  const parar = spawn("./start.sh", ["--parar"], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  let informe = "";
  // El relevo se ata al INFORME, no a un reloj: se espera a que el barrido
  // anuncie su primera víctima. Con un `setTimeout` de 300 ms el intruso
  // llegaba ANTES de que se tomara la foto (medido: el arranque de bash tarda
  // más que eso), y entonces entraba en ella como ajeno — un experimento que no
  // medía nada. Cuando sale la primera línea `·`, la foto está hecha y quedan
  // dos procesos por matar (~1 s) antes de llegar al puerto del relevo.
  let primeraVictima;
  const barriendo = new Promise((res) => { primeraVictima = res; });
  const recoge = (d) => {
    informe += d;
    if (/^\s*·\s+:/m.test(informe)) primeraVictima(true);
  };
  parar.stdout.on("data", recoge);
  parar.stderr.on("data", recoge);
  const terminado = new Promise((res) => parar.on("close", res));

  const arrancó = await Promise.race([barriendo, new Promise((r) => setTimeout(() => r(false), 15_000))]);
  if (!arrancó) {
    await terminado;
    console.log("  ⚠ sin veredicto sobre el tiro tardío: el barrido no llegó a matar a nadie");
    sinVeredicto = true;
    return;
  }
  await retirar(ultimo);
  const intruso = await señuelo(tardio, "/tmp", `AJENO TARDÍO :${tardio}`);
  arrancados.push(intruso);

  await terminado;

  if (!new RegExp(`^\\s*·[^\\n]*:${tardio}\\b`, "m").test(informe)) {
    console.log(`  ⚠ sin veredicto sobre el tiro tardío: el barrido no llegó a evaluar :${tardio} como propio`);
    sinVeredicto = true;
  } else if (!(await esperarMuerte(intruso, 1_000))) {
    ok("un AJENO que toma un puerto DURANTE el barrido sobrevive (se mata por PID, no por puerto)");
  } else {
    mal("un ajeno que llega durante el barrido sobrevive",
        "lo mató: `--parar` está matando por PUERTO y se lleva a quien no clasificó");
  }
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
