#!/usr/bin/env node
/** `--parar` CLASIFICA LOS NUEVE PUERTOS, NO DOS (QA de T9 PR-4: #393).
 *
 *  `qa/no-mata-lo-ajeno.mjs` ya afirma lo esencial —arrancar no mata al
 *  ocupante, `--parar` deja lo ajeno y se lleva lo propio, y el par
 *  bridge+State API no se convierte en un ajeno de mentira—. Esto añade lo que
 *  allí no se mide, y que es donde el arreglo puede torcerse sin que nadie se
 *  entere:
 *
 *   1 · **Los NUEVE puertos del catálogo a la vez**, no dos. El arreglo de #393
 *       es un cambio de ORDEN (foto de dueños → barrido) y un agrupado por
 *       conjunto de pids: con dos puertos y un proceso hay un solo grupo, así
 *       que el agrupado se prueba en su caso más fácil. Aquí hay CUATRO
 *       procesos propios, tres de ellos con dos puertos, más uno ajeno con dos.
 *   2 · **Las tres vías por las que un proceso se demuestra de este árbol**
 *       (`worktree_de_pids`): cwd en la raíz, cwd en un SUBdirectorio, y cwd
 *       fuera con la ruta del proyecto en los ARGUMENTOS — que es como se
 *       reconoce a sprite-forge desde la PR #373. El guion existente solo
 *       ejercita la primera.
 *   3 · **El aviso de `--parar-todo`, SIEMPRE evaluable.** `no-mata-lo-ajeno`
 *       se abstiene (sale con 2) cuando hay procesos de otro worktree, que en
 *       esta máquina es el estado normal: el aserto que codifica el daño del
 *       issue casi nunca se evalúa. Aquí se afirma la forma que no depende del
 *       entorno: **el aviso sale si y solo si el propio informe imprimió al
 *       menos una línea AJENO**. Un `saltados` encendido por un fantasma —el
 *       bug de #393— rompe esa equivalencia en cuanto la línea que lo encendió
 *       no exista, y un aviso que salga sin ajenos también.
 *
 *  Y una SONDA, que se dice pero no puntúa (hallazgo H5 de `qa-2.md`): la foto
 *  de dueños se toma antes de matar, pero se mata **por PUERTO** y no por los
 *  pids de la foto (`kill_port`, que es `fuser` con su bandera de matar sobre
 *  `<puerto>/tcp`), así que un proceso AJENO que tome un puerto del
 *  catálogo mientras dura el barrido muere igual, y el informe lo apunta como
 *  propio citando la línea de comandos del ocupante ANTERIOR. La ventana pasó
 *  de ~0 (antes se resolvía y se mataba puerto a puerto) a la duración de la
 *  segunda pasada.
 *
 *  Todos los señuelos son NUESTROS: los arranca este guion y los retira por SU
 *  pid. **Nunca se mata por puerto ni por nombre**, y el único `--parar` que se
 *  ejecuta es el de este worktree.
 *
 *  EN NEGATIVO (probado el 2026-09-04 al escribirlo, con `start.sh` de
 *  `fe0b245`, el commit anterior al arreglo): caen «ningún puerto propio sale
 *  AJENO» (los segundos puertos de los tres pares salen de otro), «los puertos
 *  del mismo proceso salen en una línea» y «el informe no se parte».
 *
 *  CERO CRÉDITOS: no arranca ningún servicio del stack; los señuelos son
 *  servidores TCP mudos.
 *
 *  Vive FUERA de `qa/guiones/` por lo mismo que `no-mata-lo-ajeno.mjs`:
 *  **ejecuta `./start.sh --parar`**, y dentro de la batería se llevaría por
 *  delante el stack que la batería está midiendo.
 *
 *  Uso:  node qa/parar-clasifica-los-nueve-puertos.mjs
 *        NEFAN_PORT_OFFSET=300 node qa/parar-clasifica-los-nueve-puertos.mjs
 *
 *  Salida: 0 todo verde · 1 alguna comprobación en rojo · 2 no llegó a medir.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUERTOS_BASE, PUERTOS_TODOS } from "./lib/stack.mjs";
import { puertoOcupado, esperarPuertoLibre } from "./lib/puertos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

/** Los nueve del catálogo que `cmd_stop` barre (`ALL_PORTS` en `start.sh`).
 *  `game_emulator` no está ahí y por eso tampoco aquí: afirmar sobre un puerto
 *  que el comando no mira sería un rojo inventado. */
const CLAVES = ["bridge", "state_api", "narrative_ws", "ai_server", "html", "asset_store", "remote_gen", "sprite_forge", "fake_ai"];
const P = Object.fromEntries(CLAVES.map((k) => [k, PUERTOS_TODOS[k]]));

const fallos = [];
const ok = (t) => console.log(`  ✔ ${t}`);
const mal = (t, d) => {
  console.log(`  ✘ ${t}${d ? ` — ${d}` : ""}`);
  fallos.push(t);
};
const nota = (t, d) => console.log(`  ⚠ ${t}${d ? ` — ${d}` : ""}`);

/** Un servidor TCP mudo escuchando en `puertos`, con el `cwd` y los argumentos
 *  que se le pidan. Los dos son EL experimento: `worktree_de_pids` mira
 *  `/proc/<pid>/cwd` y, si no le vale, `/proc/<pid>/cmdline`.
 *
 *  Es `node` y no `nc`: `nc` sin `-k` deja de escuchar en cuanto alguien se
 *  conecta, y el propio sondeo del guion se lo cargaría. La vida se lee del
 *  evento `exit`, no de `kill(pid,0)`: a un zombi la señal 0 le llega igual. */
function señuelo(puertos, { cwd, marca = null, etiqueta }) {
  const guion =
    `const net=require("node:net");let n=0;const ps=${JSON.stringify(puertos)};` +
    `for(const p of ps)net.createServer(s=>s.on("error",()=>{}))` +
    `.listen(p,"0.0.0.0",()=>{if(++n===ps.length)console.log("LISTO")});`;
  // La marca va como argumento PELADO, sin `--`: con `node -e … --marca X`,
  // node se come el `--marca` como opción SUYA y el hijo no arranca. Lo que
  // mira `worktree_de_pids` es que la ruta del proyecto aparezca en el
  // `cmdline`, no que tenga forma de flag.
  const args = ["-e", guion, ...(marca ? [marca] : [])];
  const p = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
  let muerto = false;
  p.on("exit", () => { muerto = true; });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`el señuelo ${etiqueta} no llegó a escuchar en :${puertos.join(" :")}`)), 10_000);
    p.stdout.on("data", () => {
      clearTimeout(t);
      console.log(`  · señuelo ${etiqueta} en :${puertos.join(" :")} (pid ${p.pid}, cwd ${cwd}${marca ? `, args con ${marca}` : ""})`);
      res({ pid: p.pid, puertos, proc: p, etiqueta, vivo: () => !muerto });
    });
  });
}

const arrancados = [];
async function retirar(s) {
  if (!s || !s.vivo()) return;
  s.proc.kill();
  for (const puerto of s.puertos) await esperarPuertoLibre(puerto, { maxMs: 5_000 });
}
/** El `exit` del hijo llega por el bucle de eventos y `spawnSync` lo bloquea
 *  entero: preguntando justo después, un señuelo ya muerto contesta «vivo». */
function esperarMuerte(s, maxMs = 5_000) {
  return new Promise((res) => {
    if (!s.vivo()) return res(true);
    const t = setTimeout(() => res(!s.vivo()), maxMs);
    s.proc.once("exit", () => { clearTimeout(t); res(true); });
  });
}

const parar = () => {
  const r = spawnSync("./start.sh", ["--parar"], { cwd: repoRoot, encoding: "utf8", timeout: 180_000 });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};
/** Los puertos que cita una línea del informe. */
const puertosDe = (linea) => [...linea.matchAll(/:(\d+)/g)].map((m) => Number(m[1]));

async function main() {
  // ── Preflight ────────────────────────────────────────────────────────────
  // Se ejecuta `--parar`, que se lleva lo de este worktree: con un stack arriba
  // no se puede saber si es tuyo. Se mira el bloque VIGENTE (base + offset),
  // que es donde van los señuelos; los otros nueve bloques son de quien sean y
  // este guion ni los toca ni los afirma.
  const sucios = [];
  for (const clave of Object.keys(PUERTOS_BASE)) {
    if (await puertoOcupado(PUERTOS_TODOS[clave])) sucios.push(`${clave} (:${PUERTOS_TODOS[clave]})`);
  }
  if (sucios.length) {
    console.error(
      `❌ hay servicios del catálogo arriba en el bloque vigente (${sucios.join(", ")}).\n` +
        `   Este guion ejecuta ./start.sh --parar: no se lanza a ciegas. Para tu stack y repite.`,
    );
    return 2;
  }

  console.log("▶ `--parar` con los nueve puertos del bloque ocupados\n");

  // Cuatro procesos PROPIOS por las tres vías de `worktree_de_pids`, y uno
  // AJENO de verdad. Tres de los cinco tienen DOS puertos: el agrupado por
  // conjunto de pids se prueba con más de un grupo, que es donde se rompe.
  const propios = [];
  // Cada señuelo se apunta EN CUANTO nace, no al final de la lista: si uno de
  // los siguientes no llega a escuchar, los anteriores ya están en la lista que
  // el `finally` retira. Apuntarlos después dejaba huérfanos en el catálogo —
  // justo el estorbo que este guion viene a medir (medido al escribirlo).
  propios.push(await señuelo([P.bridge, P.state_api], { cwd: repoRoot, etiqueta: "PROPIO cwd=raíz" }));
  arrancados.push(propios[0]);
  propios.push(await señuelo([P.narrative_ws, P.ai_server], { cwd: join(repoRoot, "nefan-core"), etiqueta: "PROPIO cwd=subdirectorio" }));
  arrancados.push(propios[1]);
  propios.push(await señuelo([P.asset_store, P.remote_gen], { cwd: "/tmp", marca: join(repoRoot, "assets", "characters"), etiqueta: "PROPIO por ARGUMENTOS" }));
  arrancados.push(propios[2]);
  propios.push(await señuelo([P.sprite_forge], { cwd: repoRoot, etiqueta: "PROPIO de un solo puerto" }));
  arrancados.push(propios[3]);
  const ajeno = await señuelo([P.html, P.fake_ai], { cwd: "/tmp", etiqueta: "AJENO" });
  arrancados.push(ajeno);

  const informe = parar();
  const lineas = informe.split("\n");
  const propiasDelInforme = lineas.filter((l) => /^\s*·/.test(l));
  const ajenasDelInforme = lineas.filter((l) => /AJENO, no se toca/.test(l));
  const puertosPropios = propios.flatMap((s) => s.puertos);
  console.log("");

  // 1 · Ninguno de los SIETE puertos propios sale como ajeno, y cada uno sale
  //     en una línea de las que se paran. Es el criterio literal del usuario.
  const propiosMalClasificados = puertosPropios.filter((p) => ajenasDelInforme.some((l) => puertosDe(l).includes(p)));
  if (propiosMalClasificados.length === 0) ok(`ninguno de los ${puertosPropios.length} puertos propios sale como AJENO`);
  else mal("ningún puerto propio sale como AJENO", `salen de otro: ${propiosMalClasificados.join(", ")}`);

  const sinCitar = puertosPropios.filter((p) => !propiasDelInforme.some((l) => puertosDe(l).includes(p)));
  if (sinCitar.length === 0) ok("…y los siete salen citados en el informe, no en silencio");
  else mal("los puertos propios salen citados", `no aparecen: ${sinCitar.join(", ")}`);

  // 2 · Y se paran de verdad. Sin esto, un `cmd_stop` que no hiciera NADA
  //     pasaría todos los asertos de clasificación.
  const muertos = [];
  for (const s of propios) muertos.push(await esperarMuerte(s));
  let libres = true;
  for (const p of puertosPropios) libres = (await esperarPuertoLibre(p, { maxMs: 10_000 })) && libres;
  if (muertos.every(Boolean) && libres) ok("los cuatro procesos propios mueren y sueltan sus siete puertos");
  else mal("los procesos propios se paran", `muertos=${muertos.join(",")} puertos_libres=${libres}`);

  // 3 · Las tres vías de propiedad, una por una: si una dejara de reconocerse,
  //     el aserto agregado de arriba no diría CUÁL.
  for (const s of propios) {
    const suyas = s.puertos.filter((p) => propiasDelInforme.some((l) => puertosDe(l).includes(p)));
    if (suyas.length === s.puertos.length) ok(`  reconocido como propio: ${s.etiqueta}`);
    else mal(`reconocido como propio: ${s.etiqueta}`, `solo ${suyas.length} de ${s.puertos.length} puertos`);
  }

  // 4 · El AJENO de verdad: enumerado y VIVO. Es «no le cerreis sus servers».
  const ajenoVivo = !(await esperarMuerte(ajeno, 1_000)) && (await puertoOcupado(P.html)) && (await puertoOcupado(P.fake_ai));
  if (ajenoVivo) ok("el proceso AJENO sigue vivo y con sus dos puertos");
  else mal("el proceso AJENO sigue vivo", "lo mató: es «no le cerreis sus servers» incumplido");
  const lineaAjena = ajenasDelInforme.filter((l) => puertosDe(l).includes(P.html));
  if (lineaAjena.length === 1 && puertosDe(lineaAjena[0]).includes(P.fake_ai)) ok("…y sale enumerado, con sus dos puertos en UNA línea");
  else mal("el ajeno sale enumerado con sus dos puertos juntos", `líneas que lo citan: ${lineaAjena.length}`);

  // 5 · Un proceso, una línea. Cuatro grupos de dos puertos (tres propios y el
  //     ajeno): es lo que hace visible que la propiedad se resolvió ANTES de
  //     matar nada. Antes del arreglo, el segundo puerto de cada par salía
  //     suelto y clasificado de otro.
  const pares = [[P.bridge, P.state_api], [P.narrative_ws, P.ai_server], [P.asset_store, P.remote_gen], [P.html, P.fake_ai]];
  const malAgrupados = pares.filter(([a, b]) => lineas.filter((l) => puertosDe(l).includes(a) && puertosDe(l).includes(b)).length !== 1);
  if (malAgrupados.length === 0) ok("los cuatro pares que comparten proceso salen en UNA línea cada uno");
  else mal("los puertos del mismo proceso se agrupan", `pares sueltos: ${malAgrupados.map((p) => p.join("+")).join(" ")}`);

  // 6 · `fuser` escribe los pids en stdout SIN salto de línea y se pegaban
  //     delante de la línea siguiente. Con siete puertos que morir hay siete
  //     ocasiones de ensuciar, no una.
  const conPids = lineas.filter((l) => /^\s*\d/.test(l));
  if (conPids.length === 0) ok("el informe no se parte con la salida de `fuser` (ninguna línea empieza por pids)");
  else mal("el informe no se parte con la salida de fuser", `líneas con pids: ${conPids.map((l) => l.trim().slice(0, 60)).join(" / ")}`);

  // 7 · El aviso de `--parar-todo`, en su forma SIEMPRE evaluable: sale si y
  //     solo si el informe imprimió al menos un AJENO. Así se puede afirmar
  //     con stacks de otros worktrees delante, que es el estado normal de esta
  //     máquina — y es donde el guion hermano se abstiene.
  const aconseja = /Para llevarte también lo ajeno/.test(informe);
  if (aconseja === ajenasDelInforme.length > 0) {
    ok(`el aviso de barrido total sale si y solo si hay ajenos (aviso=${aconseja}, ajenos=${ajenasDelInforme.length})`);
  } else {
    mal("el aviso de barrido total sale si y solo si hay ajenos", `aviso=${aconseja} pero ajenos=${ajenasDelInforme.length}`);
  }

  // ── SONDA (no puntúa): matar por PUERTO con una clasificación de la foto ──
  await retirar(ajeno);
  const cebo = await señuelo([P.bridge, P.state_api], { cwd: repoRoot, etiqueta: "PROPIO (para alargar el barrido)" });
  const tardio = await señuelo([P.fake_ai], { cwd: repoRoot, etiqueta: "PROPIO en el último puerto" });
  arrancados.push(cebo, tardio);
  const enVuelo = new Promise((res) => {
    const p = spawn("./start.sh", ["--parar"], { cwd: repoRoot, stdio: "ignore" });
    p.on("exit", res);
  });
  await new Promise((r) => setTimeout(r, 1_200));
  tardio.proc.kill();
  await new Promise((r) => setTimeout(r, 150));
  let intruso = null;
  try {
    intruso = await señuelo([P.fake_ai], { cwd: "/tmp", etiqueta: "AJENO que llega a mitad del barrido" });
    arrancados.push(intruso);
  } catch {
    /* el puerto no se soltó a tiempo: la sonda no concluye, y lo dice abajo */
  }
  await enVuelo;
  if (!intruso) nota("sonda H5 no concluyente: el intruso no llegó a escuchar dentro de la ventana");
  else if (await esperarMuerte(intruso, 3_000)) {
    nota(
      "H5 CONFIRMADO: un proceso AJENO que toma un puerto del catálogo DURANTE el barrido muere igual",
      "se mata por PUERTO (`kill_port`) con la clasificación de la foto; la ventana es toda la 2ª pasada",
    );
  } else {
    nota("sonda H5: el intruso sobrevivió en esta corrida (la ventana no le alcanzó)");
  }
}

let code = 2;
try {
  code = (await main()) ?? (fallos.length ? 1 : 0);
} catch (err) {
  console.error("parar-clasifica-los-nueve-puertos:", err);
  fallos.push(`ERROR: ${err.message}`);
  code = 1;
} finally {
  for (const s of arrancados) await retirar(s);
}

if (code !== 2) {
  console.log(
    `\n${fallos.length === 0 ? "✔ `--parar` clasifica bien los nueve puertos, agrupa por proceso y no toca lo ajeno" : `✘ ${fallos.length} fallo(s)`}`,
  );
  code = fallos.length === 0 ? 0 : 1;
}
process.exit(code);
