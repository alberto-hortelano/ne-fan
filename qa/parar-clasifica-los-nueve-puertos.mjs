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
 *   4 · **El AJENO de OTRO BLOQUE de puertos** (#424). La rama segura mira
 *       todos los bloques, pero `--parar-todo` solo barre el vigente: el aviso «para
 *       llevarte también lo ajeno» salía igual y prometía un barrido que sobre
 *       ese proceso no puede nada. Se planta un señuelo en un bloque libre que
 *       no sea el vigente y se exige que el informe lo enumere, lo deje vivo y
 *       diga la verdad sobre lo que ese comando alcanza.
 *   5 · **El intruso que llega A MITAD del barrido.** Era una sonda que no
 *       puntuaba (hallazgo H5 de `qa-2.md`, cuando se mataba por PUERTO con la
 *       clasificación de la foto); desde que #393 mata por PID es la garantía
 *       al revés y se afirma: el que llega después ni se entera.
 *   6 · **Un PROPIO en un bloque ALTO (≥ 1000) se ve y se para** (#684). La
 *       rama segura recomponía sus candidatos con un bucle fijo `0 100 … 900`
 *       sobre `base - PORT_OFFSET + off`, o sea que fuera cual fuera el
 *       offset miraba los bloques 0..900: un stack arrancado con
 *       `NEFAN_PORT_OFFSET` en 1000 —que la subida acepta— ni se enumeraba, y el
 *       informe decía «(nada que parar aquí)» y «✅ stack cleaned» con el
 *       stack en pie. Hoy los candidatos salen de la foto de `ss` filtrada por
 *       «catálogo × offset admisible». Se mide SIEMPRE, sea cual sea el offset
 *       con que se invoque este guion (aserto 10).
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
 *  EN NEGATIVO para #684, medido el 2026-09-20 con el `start.sh` de `a25d8c2f`
 *  (el commit anterior al arreglo) en este mismo árbol, de dos maneras:
 *
 *    · Con el bloque vigente BAJO (`NEFAN_PORT_OFFSET=900`) el rojo queda
 *      AISLADO en el aserto 10, que es lo que hay que ver: los otros 18 salen
 *      verdes y caen exactamente los tres suyos — «el propio del bloque +1000
 *      sale citado entre los que se paran — líneas «·» que lo citan: 0», «el
 *      propio del bloque alto se para de verdad — muerto=false
 *      puertos_libres=false» y «el informe no dice «nada que parar aquí»
 *      habiendo un propio arriba — lo dijo». Esa última es la frase del issue.
 *    · Con el bloque vigente ALTO (el offset de invocación en 1000), que es el caso
 *      que reportó #684, se cae el guion entero: 13 asertos rojos —los siete
 *      puertos propios sin citar, los cuatro «reconocido como propio … solo 0
 *      de N», el ajeno sin enumerar, los pares sueltos y el aviso de barrido
 *      total— y el bloque 9 revienta («el señuelo PROPIO (para alargar el
 *      barrido) no llegó a escuchar en :10877 :10878») porque los propios
 *      seguían vivos en sus puertos, que es el bug con todas sus letras.
 *
 *  Por eso el aserto 10 se mide SIEMPRE, sea cual sea el offset de invocación:
 *  planta su propio en un bloque libre ≥ 1000 aunque el vigente sea bajo.
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
 *        NEFAN_PORT_OFFSET=<n ≥ 1000> node qa/parar-clasifica-los-nueve-puertos.mjs   # bloque vigente alto (#684)
 *
 *  Salida: 0 todo verde · 1 alguna comprobación en rojo · 2 no llegó a medir.
 *          El 2 no es solo del preflight: CUALQUIER ⚠ de los tres bloques que
 *          pueden quedarse sin entorno (el 8, el 9 y el 10) lo produce. Verde
 *          significa «se midió todo y todo pasó», y nada más.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUERTOS_BASE, PUERTOS_TODOS, offsetActual, BLOQUE, OFFSET_MAX } from "./lib/stack.mjs";
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
/** El entorno no dejó MEDIR algo. No es verde ni rojo, y la diferencia importa:
 *  un ⊘ es una declaración, no una amnistía (`qa/README.md`), y degrada la
 *  corrida MÁS que un rojo porque un rojo al menos se sabe leer.
 *
 *  La bandera se enciende AQUÍ, dentro de `nota`, y no en cada sitio que se
 *  abstiene: hasta la QA de #684 los tres bloques que no podían medir (el 8 de
 *  #424, el 9 del intruso y el 10 de #684) imprimían su ⚠ y el guion salía 0
 *  con «✔ `--parar` clasifica bien…» debajo. El candado de un bug que solo se
 *  ve con la máquina medio vacía no puede depender de que el siguiente que
 *  añada una abstención se acuerde de encender nada. */
let sinVeredicto = false;
const nota = (t, d) => {
  sinVeredicto = true;
  console.log(`  ⚠ ${t}${d ? ` — ${d}` : ""}`);
};

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
  // que es donde van casi todos los señuelos. Fuera de él este guion usa DOS
  // bloques más —uno bajo para el ajeno del aserto 8, uno ≥ 1000 para el propio
  // del aserto 10—, y solo si los encuentra LIBRES: plantar un señuelo encima
  // del stack de otro agente sería el pecado que viene a medir.
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
  //     solo si el informe imprimió al menos un AJENO DEL BLOQUE VIGENTE. Así
  //     se puede afirmar con stacks de otros worktrees delante, que es el
  //     estado normal de esta máquina — y es donde el guion hermano se
  //     abstiene.
  //
  //     «del bloque vigente» es la corrección de #424 y no un matiz: la rama
  //     segura de `cmd_stop` mira TODOS los bloques admisibles, pero `--parar-todo` solo
  //     barre `ALL_PORTS`, o sea el vigente. Con el aviso saliendo ante
  //     cualquier ajeno de cualquier bloque, el consejo mandaba a ejecutar el
  //     arma más peligrosa del launcher para que no pasara nada. El señuelo del
  //     bloque de al lado (más abajo, aserto 8) es el que ejerce ese caso: el
  //     que miente. Aquí el AJENO está en el bloque vigente, así que el aviso
  //     tiene que salir.
  const aconseja = /Para llevarte también lo ajeno DEL BLOQUE VIGENTE/.test(informe);
  if (aconseja === ajenasDelInforme.length > 0) {
    ok(`el aviso de barrido total sale si y solo si hay ajenos del bloque (aviso=${aconseja}, ajenos=${ajenasDelInforme.length})`);
  } else {
    mal("el aviso de barrido total sale si y solo si hay ajenos del bloque", `aviso=${aconseja} pero ajenos=${ajenasDelInforme.length}`);
  }

  // 8 · EL CASO QUE MENTÍA (#424): un AJENO en OTRO bloque de puertos.
  //
  //     `--parar` lo VE —mira todos los bloques admisibles— y hasta ahora, al verlo,
  //     imprimía «para llevarte también lo ajeno: --parar-todo», que sobre ese
  //     proceso no puede nada. Lo que se afirma es que el informe (a) lo
  //     enumera como ajeno, (b) NO lo mata, y (c) dice la verdad sobre lo que
  //     `--parar-todo` alcanza.
  //
  //     El bloque se ELIGE libre: los demás son de quien sean y plantar un
  //     señuelo encima del stack de otro agente sería el pecado que este guion
  //     mide. Si no hay ninguno libre, este aserto se declara no medido en vez
  //     de inventarse un veredicto.
  await retirar(ajeno);
  const vigente = offsetActual();
  let otroBloque = null;
  for (let off = 0; off <= 900; off += 100) {
    if (off === vigente) continue;
    const p1 = PUERTOS_BASE.html + off;
    const p2 = PUERTOS_BASE.fake_ai + off;
    if (!(await puertoOcupado(p1)) && !(await puertoOcupado(p2))) {
      otroBloque = { off, puertos: [p1, p2] };
      break;
    }
  }
  if (!otroBloque) {
    nota("no se pudo medir el aviso con un ajeno de OTRO bloque", "ningún bloque libre entre +0 y +900");
  } else {
    const forastero = await señuelo(otroBloque.puertos, {
      cwd: "/tmp",
      etiqueta: `AJENO en el bloque +${otroBloque.off}`,
    });
    arrancados.push(forastero);
    const informe2 = parar();
    const lineas2 = informe2.split("\n");
    const ajenas2 = lineas2.filter((l) => /AJENO, no se toca/.test(l));
    const suLinea = ajenas2.filter((l) => puertosDe(l).includes(otroBloque.puertos[0]));
    if (suLinea.length === 1) ok(`el ajeno del bloque +${otroBloque.off} sale enumerado como AJENO`);
    else mal(`el ajeno del bloque +${otroBloque.off} sale enumerado`, `líneas que lo citan: ${suLinea.length}`);

    const sigueVivo = !(await esperarMuerte(forastero, 1_000)) && (await puertoOcupado(otroBloque.puertos[0]));
    if (sigueVivo) ok("…y sigue vivo: `--parar` mira todos los bloques pero solo mata lo suyo");
    else mal("el ajeno de otro bloque sigue vivo", "lo mató: es «no le cerreis sus servers» incumplido");

    // La equivalencia que arregla #424: con el ÚNICO ajeno fuera del bloque
    // vigente, el aviso de `--parar-todo` NO sale (no lo alcanzaría), y en su
    // lugar el informe dice que no lo alcanza.
    const aconseja2 = /Para llevarte también lo ajeno DEL BLOQUE VIGENTE/.test(informe2);
    const dice = /NO lo alcanza --parar-todo/.test(informe2);
    if (!aconseja2 && dice) {
      ok("el informe NO promete un barrido que no alcanza a ese proceso, y lo dice");
    } else {
      mal(
        "el informe dice la verdad sobre lo que --parar-todo alcanza",
        `aviso de barrido total=${aconseja2} · dice que no lo alcanza=${dice}`,
      );
    }
  }

  // ── 10 · UN PROPIO EN UN BLOQUE ALTO (≥ 1000) SE VE Y SE PARA (#684) ────
  //
  //     Hasta #684 la rama segura recomponía sus candidatos con un bucle fijo
  //     `0 100 … 900` sobre `base - PORT_OFFSET + off`: fuera cual fuera el
  //     offset miraba los bloques 0..900, y un stack arrancado con
  //     NEFAN_PORT_OFFSET en 1000 —que la subida acepta— ni se enumeraba: «(nada
  //     que parar aquí)» y «✅ stack cleaned» con el stack en pie. Se mide
  //     SIEMPRE, sea cual sea el offset con que se invoque este guion: el
  //     bloque vigente suele ser bajo y el defecto vivía en los altos.
  //
  //     El bloque se ELIGE libre por encima del 1000 —mismo criterio que el 8:
  //     plantar encima de otro sería el pecado que se mide— y se recorre hasta
  //     el tope que exporta `stack.mjs`, no una copia. Sin bloque libre no hay
  //     experimento, y se dice. Va aquí, pegado al 8, porque los dos son el
  //     mismo sujeto —qué bloques MIRA la rama segura— y el 9 tiene que seguir
  //     siendo el último: deja un `--parar` en vuelo y señuelos a medio morir.
  let bloqueAlto = null;
  for (let off = 1000; off <= OFFSET_MAX; off += BLOQUE) {
    if (off === vigente) continue;
    const p1 = PUERTOS_BASE.html + off;
    const p2 = PUERTOS_BASE.fake_ai + off;
    if (!(await puertoOcupado(p1)) && !(await puertoOcupado(p2))) {
      bloqueAlto = { off, puertos: [p1, p2] };
      break;
    }
  }
  if (!bloqueAlto) {
    nota("no se pudo medir el propio de un bloque ALTO (#684)", `ningún bloque libre entre +1000 y +${OFFSET_MAX}`);
  } else {
    const alto = await señuelo(bloqueAlto.puertos, { cwd: repoRoot, etiqueta: `PROPIO en el bloque +${bloqueAlto.off}` });
    arrancados.push(alto);
    const informe3 = parar();
    const lineas3 = informe3.split("\n");
    const suLinea3 = lineas3.filter((l) => /^\s*·/.test(l) && puertosDe(l).includes(bloqueAlto.puertos[0]));
    if (suLinea3.length === 1 && puertosDe(suLinea3[0]).includes(bloqueAlto.puertos[1])) {
      ok(`el propio del bloque +${bloqueAlto.off} sale citado entre los que se paran, con sus dos puertos en UNA línea`);
    } else {
      mal(`el propio del bloque +${bloqueAlto.off} sale citado entre los que se paran`, `líneas «·» que lo citan: ${suLinea3.length}`);
    }
    const comoAjeno = lineas3.filter((l) => /AJENO, no se toca/.test(l) && puertosDe(l).some((p) => bloqueAlto.puertos.includes(p)));
    if (comoAjeno.length === 0) ok("…y no sale como AJENO");
    else mal("el propio del bloque alto no sale como AJENO", comoAjeno[0].trim());
    const murioAlto = await esperarMuerte(alto);
    let sueltos = true;
    for (const p of bloqueAlto.puertos) sueltos = (await esperarPuertoLibre(p, { maxMs: 10_000 })) && sueltos;
    if (murioAlto && sueltos) ok(`…y muere y suelta :${bloqueAlto.puertos.join(" :")}`);
    else mal("el propio del bloque alto se para de verdad", `muerto=${murioAlto} puertos_libres=${sueltos}`);
    // La frase del issue, literal: no se puede decir «nada» habiendo algo.
    if (/\(nada que parar aquí\)/.test(informe3)) mal("el informe no dice «nada que parar aquí» habiendo un propio arriba", "lo dijo");
    else ok("el informe no dice «nada que parar aquí» habiendo un propio arriba");
  }

  // ── 9 · El intruso que llega A MITAD del barrido NO se come el tiro ──────
  //
  //     Nació como SONDA que no puntuaba, y confirmaba el hallazgo H5 de
  //     `qa-2.md`: se mataba por PUERTO con la clasificación de la foto, así
  //     que un ajeno que tomara un puerto del catálogo durante la 2ª pasada
  //     moría con la línea de comandos del ocupante ANTERIOR en el informe.
  //     #393 lo arregló matando por PID, y desde entonces la sonda contestaba
  //     lo contrario de lo que su prosa decía — un rastro que confunde. Hoy es
  //     un ASERTO de la garantía: el intruso sobrevive.
  //
  //     Sigue habiendo una salida sin veredicto, y es honesta: si el intruso no
  //     llega a escuchar dentro de la ventana, no hay experimento. Eso se dice
  //     y no puntúa; lo que puntúa es el intruso que SÍ entró.
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
  if (!intruso) nota("sin veredicto sobre el intruso: no llegó a escuchar dentro de la ventana");
  else if (await esperarMuerte(intruso, 3_000)) {
    mal(
      "un AJENO que toma un puerto del catálogo DURANTE el barrido sobrevive",
      "murió con la clasificación del ocupante ANTERIOR: se está matando por PUERTO y no por los pids de la foto",
    );
  } else {
    ok("un AJENO que toma un puerto del catálogo a mitad del barrido SOBREVIVE (se mata por PID)");
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
  // Un rojo manda sobre una abstención (hay defecto demostrado y eso es lo que
  // hay que arreglar); sin rojos, una abstención NO es un verde.
  code = fallos.length > 0 ? 1 : sinVeredicto ? 2 : 0;
  if (code === 2) console.log("⚠ pero el entorno no dejó comprobarlo todo: sale con 2, no con 0.");
}
process.exit(code);
