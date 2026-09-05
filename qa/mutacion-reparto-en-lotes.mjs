#!/usr/bin/env node
/** ¿Aguanta el reparto en lotes lo que dice aguantar? — guion de QA de PR-E.
 *
 *  Vecino de `qa/mutacion-candados-en-negativo.mjs` (rompe el fichero puro) y
 *  de `qa/mutacion-cableado-en-negativo.mjs` (rompe scripts y YAML). Éste es de
 *  QA y mira la corrida PARTIDA: el reparto por reloj, la fusión de N
 *  artefactos y la cadena por la que el cronómetro llega a la huella.
 *
 *  DOS GRUPOS, y la diferencia importa:
 *
 *   · **VIGENTE** — invariantes que HOY se cumplen. Están aquí como candado de
 *     regresión: si uno se pone rojo, alguien rompió algo que estaba bien.
 *   · **ABIERTO** — hallazgos de la revisión de PR-E. Cada uno se prueba EN
 *     NEGATIVO: se rompe a mano lo que el invariante dice defender y se mira si
 *     algún checker se entera. Si nadie se entera, el invariante es prosa.
 *
 *  Y LA DEUDA CONOCIDA SE DECLARA, con su número de issue. Un guion que sale
 *  rojo a propósito y se commitea así es un rojo PERMANENTE, y un rojo
 *  permanente se aprende a ignorar en dos semanas — momento en el cual deja de
 *  avisar del sexto invariante que se rompa. Es la misma patología que aflojar
 *  el guion para que salga verde, por el otro lado. El patrón de la casa ya
 *  existe (`mutacion-huella.json` congela los supervivientes conocidos y solo
 *  grita por los NUEVOS; `arch-rules.json` tiene reglas en `warn` con sus
 *  violaciones congeladas), y aquí se aplica igual. Tres estados:
 *
 *   · sin candado y SIN issue  → ROJO. Es nuevo.
 *   · sin candado y con `deuda: <issue>` → verde, y se lista como pendiente.
 *   · CON candado y con `deuda` → ROJO: la declaración miente. Alguien lo tapó,
 *     así que se quita el `deuda` y se cierra el issue. Lo mismo si el probe
 *     apunta a una línea que ya no existe: entonces no está probando nada.
 *
 *  Verde NO significa terminado: significa que lo que falta tiene dueño.
 *
 *  La comprobación en negativo es BASELINE-Y-LUEGO-ROMPE: primero se corre el
 *  checker con el árbol limpio y se guarda su resultado, y solo cuenta como
 *  «se entera» si el resultado CAMBIA al romper. Sin esa línea base, un
 *  checker que ya estuviera rojo por el entorno (un `dist/` sin compilar, por
 *  ejemplo) haría pasar por candado lo que no lo es.
 *
 *  NO mide mutación: no lanza Stryker, ni `npm run mutate`, ni
 *  `npm run mutacion -- local`, ni `traer` (que llamaría a `gh`). No abre
 *  puertos, no arranca el juego y no gasta un crédito.
 *
 *    node qa/mutacion-reparto-en-lotes.mjs
 *    node qa/mutacion-reparto-en-lotes.mjs --solo-vigentes   # sin los probes
 *
 *  QUÉ TOCA Y CÓMO LO DEVUELVE. Aparta `nefan-core/reports/` entero (material
 *  descargado, no versionado) y modifica temporalmente `scripts/mutacion.ts`,
 *  `scripts/mutacion-huella.ts`, `scripts/mutate.ts`, el workflow y
 *  `data/contract/mutation-targets.json`. Todo vuelve en el `finally` y se
 *  verifica byte a byte; si algo no volvió, sale con 2 y lo dice.
 *
 *  Verde = los vigentes se cumplen, y lo que no tiene candado tiene issue.
 *  Rojo  = se rompió un vigente, apareció un hallazgo nuevo sin declarar, o una
 *          declaración de deuda dejó de ser cierta.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, cpSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");
const MUT = join(CORE, "scripts", "mutacion.ts");
const PURO = join(CORE, "scripts", "mutacion-huella.ts");
const MUTATE = join(CORE, "scripts", "mutate.ts");
const YML = join(raiz, ".github", "workflows", "mutation.yml");
const PLAN = join(CORE, "data", "contract", "mutation-targets.json");
const HUELLA = join(CORE, "data", "contract", "mutacion-huella.json");
const REPORTS = join(CORE, "reports");
const APARTADO = join(CORE, "reports.qa-lotes");
const ENSAYO = join(REPORTS, "qa-lotes");

const soloVigentes = process.argv.includes("--solo-vigentes");

function mutacion(args, env = {}) {
  const r = spawnSync("npm", ["run", "--silent", "mutacion", "--", ...args], {
    cwd: CORE,
    encoding: "utf8",
    timeout: 300000,
    env: { ...process.env, ...env },
  });
  return { ok: r.status === 0, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ── el sandbox de artefactos ─────────────────────────────────────────────────

/** Un lote tal y como lo deja CI: sus informes + el `corrida.json` que escribe
 *  la herramienta. El manifiesto NO se fabrica a mano: el sello tiene que ser
 *  el que calcula el verbo, que es justo lo que se está probando. */
function siembraLote(n, modulos, { sha = "SHA-DE-ENSAYO", desde = "ANCLA-DE-ENSAYO", run = "424242", origen = "rango" } = {}) {
  const dir = join(ENSAYO, `informe-mutacion-${n}`);
  mkdirSync(dir, { recursive: true });
  const informes = [];
  for (const m of modulos) {
    const cuerpo = JSON.stringify({ files: { [`src/${m}.ts`]: { mutants: [] } } });
    writeFileSync(join(dir, `${m}.json`), cuerpo);
    informes.push({ modulo: m, sha256: createHash("sha256").update(cuerpo).digest("hex"), segundos: 7 });
  }
  writeFileSync(
    join(dir, "corrida.json"),
    JSON.stringify({ sha, desde, run_id: run, origen, modulos_pedidos: [...modulos].sort(), informes, fecha: "2026-09-04T00:00:00Z" }, null, 2),
  );
  return dir;
}

function siembraPlan(lotes, pedidos, { sha = "SHA-DE-ENSAYO", desde = "ANCLA-DE-ENSAYO", run = "424242", origen = "rango" } = {}) {
  const dir = join(ENSAYO, "plan-corrida");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plan-corrida.json"),
    JSON.stringify(
      {
        sha, desde, run_id: run, origen,
        modulos_pedidos: [...pedidos].sort(),
        lotes: lotes.map((m, i) => ({ lote: i + 1, modulos: m, segundos: 10, medido: true, margen: 1790 })),
      },
      null, 2,
    ),
  );
}

function fusiona() {
  const gho = join(ENSAYO, "gho.txt");
  writeFileSync(gho, "");
  const r = mutacion(["fusionar", "--entrada", "reports/qa-lotes"], { GITHUB_OUTPUT: gho });
  return { ...r, salidas: readFileSync(gho, "utf8") };
}

const limpiaEnsayo = () => rmSync(ENSAYO, { recursive: true, force: true });

// ── grupo VIGENTE ────────────────────────────────────────────────────────────

const VIGENTES = [
  {
    nombre: "reparto · dos corridas del mismo plan dan EL MISMO reparto",
    porque: "sin eso no se pueden comparar dos corridas ni revisar el plan en la PR",
    mira: () => {
      const a = mutacion(["lotes", "--todos"]).salida;
      const b = mutacion(["lotes", "--todos"]).salida;
      const c = mutacion(["lotes", "--ids", "hostiles apuntado blueprint-derive"]).salida;
      const d = mutacion(["lotes", "--ids", "blueprint-derive apuntado hostiles"]).salida;
      return a === b && c === d;
    },
  },
  {
    nombre: "reparto · ningún lote de VARIOS módulos pasa de `tope_lote`",
    porque: "el lote que se sale del reloj se lleva por delante todo lo que lleva dentro",
    mira: () => {
      const { lotes, tope } = planDeHoy();
      return lotes.every((l) => l.modulos.length === 1 || !l.medido || l.segundos <= tope);
    },
  },
  {
    nombre: "reparto · cada módulo pedido está en EXACTAMENTE un lote",
    porque: "un módulo que se cae del reparto no lo mide nadie y nadie lo echa de menos",
    mira: () => {
      const { lotes, pedidos } = planDeHoy();
      const puestos = lotes.flatMap((l) => l.modulos);
      return puestos.length === new Set(puestos).size && [...puestos].sort().join() === [...pedidos].sort().join();
    },
  },
  {
    nombre: "reparto · lo que nadie cronometró va SOLO, uno por lote",
    porque: "la regla de `permisoLocal`: un coste desconocido no se supone barato",
    // LA POBLACIÓN SE SIEMBRA. La primera versión miraba el plan REAL y exigía
    // «más de un módulo sin reloj» —eran 17 el 04-09—; #440 y #445 cronometraron
    // los 41 y el invariante se quedó sin sujeto: rojo en `main` del 04 al 05-09
    // sin que nadie lo supiera, por PRECONDICIÓN y no por el planificador
    // (`empaqueta` seguía bien, y `mutacion-huella.test.ts` lo prueba con datos
    // sintéticos). Aquí se descronometran DOS módulos en una copia de la huella
    // —uno solo no distingue «van solos» de «van juntos»— y se afirma que van
    // cada uno a su lote, y solo ellos. La huella vuelve en el `finally`.
    mira: () => {
      const original = readFileSync(HUELLA, "utf8");
      const huella = JSON.parse(original);
      const plan = JSON.parse(readFileSync(PLAN, "utf8"));
      // Módulos de ficheros PLANOS (sin glob ni exclusión), todos con reloj: a
      // esos se les puede quitar el reloj borrando `segundos` fila a fila.
      const planos = (m) => m.mutate.every((f) => !f.startsWith("!") && !f.includes("*"));
      const conReloj = plan.modulos.filter(
        (m) => planos(m) && m.mutate.every((f) => typeof huella.ficheros[f]?.segundos === "number"),
      );
      if (conReloj.length < 2) throw new Error("hacen falta dos módulos cronometrados para sembrar la población");
      const sembrados = conReloj.slice(0, 2).map((m) => m.id);
      for (const m of conReloj.slice(0, 2)) for (const f of m.mutate) delete huella.ficheros[f].segundos;
      writeFileSync(HUELLA, `${JSON.stringify(huella, null, 2)}\n`);
      try {
        const { lotes } = planDeHoy();
        const sin = lotes.filter((l) => !l.medido);
        const ids = sin.flatMap((l) => l.modulos).sort();
        return (
          sin.length === 2 &&
          sin.every((l) => l.modulos.length === 1) &&
          ids.join() === [...sembrados].sort().join()
        );
      } finally {
        writeFileSync(HUELLA, original);
      }
    },
  },
  {
    nombre: "presupuesto · `tope_lote` cabe en el `timeout-minutes` del job que lo ejecuta",
    porque:
      "son dos números en dos ficheros que solo se sostienen juntos: subir el tope sin subir el " +
      "timeout mata a mitad de camino justo a los lotes más llenos",
    mira: () => {
      const tope = JSON.parse(readFileSync(PLAN, "utf8")).tope_lote;
      const yml = readFileSync(YML, "utf8");
      const medir = yml.slice(yml.indexOf("\n  medir:"), yml.indexOf("\n  reunir:"));
      const m = /timeout-minutes:\s*(\d+)/.exec(medir);
      return m !== null && tope <= Number(m[1]) * 60;
    },
  },
  {
    nombre: "fusión · UN LOTE MUERTO deja la corrida INCOMPLETA y el tag QUIETO",
    porque: "es todo el diseño de PR-E: `modulos_pedidos` sale del plan, no de los lotes que llegaron",
    mira: () => {
      limpiaEnsayo();
      siembraLote(1, ["hostiles"]);
      siembraPlan([["hostiles"], ["apuntado"]], ["hostiles", "apuntado"]);
      const r = fusiona();
      return !r.ok && /INCOMPLETA/.test(r.salida) && /SIN NOTICIAS/.test(r.salida) && /mueve_tag=false/.test(r.salidas);
    },
  },
  {
    nombre: "fusión · SIN EL PLAN no se fabrica una corrida con lo que llegó",
    porque: "reconstruir lo pedido desde los lotes vivos es exactamente lo que haría mentir al tag",
    mira: () => {
      limpiaEnsayo();
      siembraLote(1, ["hostiles"]);
      const r = fusiona();
      return !r.ok && /no está el plan de la corrida/.test(r.salida);
    },
  },
  {
    nombre: "fusión · un informe TOCADO dentro de un lote se rechaza (el sello de #420)",
    porque: "juntar N artefactos no puede reabrir el agujero que cerró la PR anterior",
    mira: () => {
      limpiaEnsayo();
      const dir = siembraLote(1, ["hostiles"]);
      writeFileSync(join(dir, "hostiles.json"), '{"files":{"otra":"medida"}}');
      siembraPlan([["hostiles"]], ["hostiles"]);
      const r = fusiona();
      return !r.ok && /no casa con su propio manifiesto/.test(r.salida);
    },
  },
  {
    nombre: "siembra · el reloj sembrado a mano dice DE DÓNDE sale",
    porque: "un número sin procedencia es el defecto que esta casa lleva pagando dos veces",
    mira: () => {
      const h = JSON.parse(readFileSync(HUELLA, "utf8"));
      const con = Object.values(h.ficheros).filter((f) => typeof f.segundos === "number");
      const unSoloSha = new Set(con.map((f) => f.sha)).size === 1;
      const c = h._comment ?? "";
      return (
        con.length > 0 &&
        unSoloSha &&
        /33866958770/.test(c) && // la corrida
        /e67ae4d/.test(c) && // el sha medido
        /2026-09-04/.test(c) && // la fecha
        /log/.test(c) // y que salió del log porque el campo no existía
      );
    },
  },
];

/** El plan de la corrida de HOY, escrito por el verbo real. */
function planDeHoy() {
  const ruta = join(REPORTS, "plan-corrida.json");
  rmSync(ruta, { force: true });
  const r = mutacion(["lotes", "--todos", "--origen", "todos", "--sha", "SHA-QA", "--desde", "ANCLA-QA", "--run", "1"]);
  if (!r.ok) throw new Error(`el verbo \`lotes\` no escribió el plan:\n${r.salida}`);
  const p = JSON.parse(readFileSync(ruta, "utf8"));
  return { lotes: p.lotes, pedidos: p.modulos_pedidos, tope: JSON.parse(readFileSync(PLAN, "utf8")).tope_lote };
}

// ── grupo ABIERTO: se rompe a mano y se mira si alguien se entera ────────────

/** Los checkers que PODRÍAN enterarse. Cada uno devuelve una firma; «se entera»
 *  es que la firma CAMBIE respecto de la del árbol limpio. */
const CHECKERS = {
  bateria: () => {
    const r = spawnSync("node", ["--import", "tsx", "--test", "test/mutacion-huella.test.ts"], {
      cwd: CORE, encoding: "utf8", timeout: 300000,
    });
    return `bateria:${r.status}`;
  },
  candados: () => {
    const r = spawnSync("node", [join(raiz, "qa", "mutacion-candados-en-negativo.mjs")], {
      cwd: raiz, encoding: "utf8", timeout: 900000,
    });
    return `candados:${r.status}`;
  },
  cableado: () => {
    const r = spawnSync("node", [join(raiz, "qa", "mutacion-cableado-en-negativo.mjs")], {
      cwd: raiz, encoding: "utf8", timeout: 900000,
    });
    return `cableado:${r.status}`;
  },
};

const ABIERTOS = [
  {
    nombre: "lotes · los módulos SIN MEDIDA se agrupan en un solo lote en vez de ir solos",
    porque:
      "el 04-09 eran 17 de 41 sin reloj y ningún test de la batería llamaba a `empaqueta` con MÁS DE UNO " +
      "sin medida, así que «va solo» y «van todos juntos» eran la misma cosa para el único caso probado — " +
      "la misma forma del verde que el propio ingeniero cazó en la mediana con dos jobs. Desde #357 lo cazan " +
      "la batería y el vigente sembrado; este probe queda como testigo de que siguen cazándolo",
    checkers: ["bateria", "candados"],
    // LA ROTURA NO TOCA NINGÚN LITERAL QUE EL GUION DE CANDADOS BUSQUE, y eso
    // es deliberado: la primera versión de este probe borraba la línea del
    // `lotes.push`, el guion se ponía rojo porque su patrón desaparecía, y eso
    // se lee igual que cazar el fallo sin serlo. Con la conducta cambiada y los
    // literales intactos, la primera versión de la batería seguía en 118/0 y el
    // guion en verde — y el reparto real metía los 17 módulos sin medir en UN
    // SOLO lote. Hoy (#357) la batería y el vigente sembrado lo ven.
    rompe: [
      PURO,
      `  for (const m of sinMedida) {\n    lotes.push({ lote: lotes.length + 1, modulos: [m.id], segundos: 0, medido: false });\n  }\n  return lotes;`,
      `  for (const m of sinMedida) {\n    lotes.push({ lote: lotes.length + 1, modulos: [m.id], segundos: 0, medido: false });\n  }\n  const juntos = lotes.filter((l) => !l.medido);\n  if (juntos.length > 1) {\n    return [...lotes.filter((l) => l.medido), { lote: juntos[0].lote, modulos: juntos.flatMap((l) => l.modulos), segundos: 0, medido: false }];\n  }\n  return lotes;`,
    ],
  },
  {
    nombre: "fusión · `fusionar` deja de verificar el SELLO de cada lote (#420 reabierto)",
    porque:
      "el commit dice que el sello «es lo que hace segura la fusión»; el candado del sello ejerce " +
      "`repartir`, no `fusionar`, así que esa frase no la defiende nadie",
    checkers: ["bateria", "cableado"],
    rompe: [MUT, `    const errores = verificaDescarga(parcial, presentes);`, `    const errores: string[] = [];`],
  },
  {
    nombre: "reloj · `manifiesto` deja de meter el cronómetro en el informe sellado",
    deuda: 436,
    porque: "es el segundo eslabón de la cadena mutate→manifiesto→repartir→huella, y solo el primero tiene candado",
    checkers: ["bateria", "cableado"],
    rompe: [MUT, `      ...(typeof tiempos[i.modulo] === "number" ? { segundos: tiempos[i.modulo] } : {}),`, ``],
  },
  {
    nombre: "reloj · `repartir` deja de llevar el cronómetro a la huella",
    deuda: 436,
    porque: "es el último eslabón: sin él la huella no gana `segundos` nunca y TODO vuelve a lote propio",
    checkers: ["bateria", "cableado"],
    rompe: [MUT, `        ...(segundos === undefined ? {} : { segundos }),`, ``],
  },
  {
    nombre: "reloj · `segundosDe` suma las filas del módulo en vez de coger el MÁXIMO",
    deuda: 436,
    // EL PEOR DE LOS CINCO, y por eso su motivo dice lo que PASA y no «falta un
    // test»: sumar en vez de coger el máximo multiplica por cuatro un módulo de
    // cuatro ficheros —`blueprint-derive` pasaría de 1.647 s a 6.588—, y con
    // eso el reparto entero cambia: dejaría de caber en ningún lote y se iría
    // solo, arrastrando a los demás a una partición que nadie pidió. Todo en
    // verde, porque el MÁXIMO solo está declarado en el tipo y en la prosa.
    porque:
      "sumar cuadruplica un módulo de cuatro ficheros (`blueprint-derive` pasaría de 1.647 s a " +
      "6.588) y el reparto entero cambia; el MÁXIMO solo está declarado en el tipo y en la prosa",
    checkers: ["bateria", "cableado"],
    rompe: [
      MUT,
      `  return medidos.length === 0 ? undefined : Math.max(...medidos);`,
      `  return medidos.length === 0 ? undefined : medidos.reduce((a, b) => a + b, 0);`,
    ],
  },
  {
    nombre: "matriz · la salida de `lotes` deja de casar con las claves que lee el YAML",
    deuda: 437,
    porque:
      "`matrix.ids` vacío hace que cada lote llame a `npm run mutate` SIN argumentos, y sin " +
      "argumentos `mutate` mide los 41 módulos: 23 jobs midiendo la corrida entera hasta el timeout",
    checkers: ["bateria", "cableado"],
    rompe: [
      MUT,
      `    const matriz = paquetes.map((l) => ({ lote: l.lote, ids: l.modulos.join(" ") }));`,
      `    const matriz = paquetes.map((l) => ({ numero: l.lote, modulos: l.modulos.join(" ") }));`,
    ],
  },
  {
    nombre: "presupuesto · `tope_lote` sube por encima del `timeout-minutes` del job",
    deuda: 437,
    porque: "un tope de 60 min con jobs de 45 mata a mitad de camino a los lotes más llenos",
    checkers: ["bateria", "cableado"],
    rompe: [PLAN, `"tope_lote": 1800,`, `"tope_lote": 3600,`],
  },
];

/** El plan que llega a la fusión no se valida: `modulos_pedidos` puede no
 *  contener lo que los lotes dicen medir, y entonces un lote muerto sale
 *  COMPLETA. Este no es un probe —no hay línea que romper— sino la conducta
 *  que falta. */
const CONDUCTAS_ABIERTAS = [
  {
    nombre: "fusión · un PLAN incoherente (un lote fuera de `modulos_pedidos`) se acepta y MUEVE EL TAG",
    porque:
      "todo el diseño descansa en el plan, y el plan es lo ÚNICO que llega a la fusión sin sello y " +
      "sin validar: cada informe se comprueba con sha256 y el plan se lee con un `JSON.parse ... as`",
    quiere: () => {
      limpiaEnsayo();
      siembraLote(1, ["hostiles"]);
      // El lote 2 (`apuntado`) existe en el plan pero NO en `modulos_pedidos`, y muere.
      siembraPlan([["hostiles"], ["apuntado"]], ["hostiles"]);
      const r = fusiona();
      // Lo que tendría que pasar: negarse, o al menos NO declararse completa.
      return !/mueve_tag=true/.test(r.salidas);
    },
  },
  {
    nombre: "fusión · la salida se contradice: dice COMPLETA y «el tag no se mueve» a la vez",
    porque:
      "quien lee el job ve las dos frases juntas y se cree la segunda; el `mueve_tag` que sale por " +
      "`GITHUB_OUTPUT` dice lo contrario",
    quiere: () => {
      limpiaEnsayo();
      siembraLote(1, ["hostiles"]);
      siembraPlan([["hostiles"], ["apuntado"]], ["hostiles"]);
      const r = fusiona();
      return !(/COMPLETA/.test(r.salida) && /SIN NOTICIAS/.test(r.salida) && /el tag no se mueve/.test(r.salida));
    },
  },
];

// ── el bucle ─────────────────────────────────────────────────────────────────

if (existsSync(APARTADO)) {
  console.error(`Hay un ${APARTADO} de una corrida anterior que no terminó. Míralo y bórralo a mano.`);
  process.exit(2);
}

// La huella es un fichero COMMITEADO que la siembra reescribe. Si ya viene
// sucia, «restaurar» sería congelar lo sucio como original: o son cambios
// tuyos (commitéalos) o te la dejó una corrida interrumpida (`git checkout`).
// Sin esto, la segunda corrida sobre una huella a medias salía roja culpando
// al planificador (QA de #454).
const huellaSucia = spawnSync("git", ["status", "--porcelain", "--", "nefan-core/data/contract/mutacion-huella.json"],
  { cwd: raiz, encoding: "utf8" });
if ((huellaSucia.stdout ?? "").trim()) {
  console.error("✖ mutacion-huella.json trae cambios sin commitear. Si son tuyos, commitéalos; si te los dejó una");
  console.error("  corrida interrumpida de este guion o de sus vecinos, `git checkout -- nefan-core/data/contract/mutacion-huella.json`.");
  process.exit(2);
}

const fuentes = new Map([MUT, PURO, MUTATE, YML, PLAN, HUELLA].map((f) => [f, readFileSync(f, "utf8")]));
const restaura = () => { for (const [f, t] of fuentes) writeFileSync(f, t); };
const habiaReports = existsSync(REPORTS);
if (habiaReports) renameSync(REPORTS, APARTADO);

/** La limpieza, UNA para todos los caminos —el `finally` del flujo normal y
 *  los manejadores de SIGINT/SIGTERM— e idempotente. Sin manejador, Node muere
 *  sin pasar por ningún `finally` y dejaba la huella con relojes borrados y los
 *  fuentes mutados; el siguiente candado corría verde encima (QA de #454). */
let limpiado = false;
function limpiar() {
  if (limpiado) return;
  limpiado = true;
  restaura();
  rmSync(REPORTS, { recursive: true, force: true });
  if (habiaReports) renameSync(APARTADO, REPORTS);
}
for (const [señal, codigo] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(señal, () => {
    console.error(`\n⊘ INTERRUMPIDO (${señal}) — restaurando fuentes, huella y reports/ antes de salir`);
    limpiar();
    process.exit(codigo);
  });
}
/** Entre invariante e invariante se cede el turno al bucle de eventos: todo lo
 *  de arriba es `spawnSync`, y un manejador de señal solo puede correr cuando
 *  el código síncrono suelta. Así un Ctrl+C corta en la SIGUIENTE frontera. */
const cede = () => new Promise((r) => setImmediate(r));

let vigentesRotos = 0;
/** Hallazgo sin candado y SIN issue: es nuevo, y es rojo. */
let sinDeclarar = 0;
/** Deuda declarada que ya no existe —porque alguien la tapó, o porque el probe
 *  apunta a otro sitio—. También es rojo: una declaración que miente es peor que
 *  no tenerla, porque se sigue leyendo como cierta. */
let declaracionesFalsas = 0;
/** Deuda declarada y confirmada: se lista con su issue y NO tiñe el veredicto. */
const pendientes = [];

/** Cómo se clasifica un hallazgo, y por qué el guion no puede salir rojo por la
 *  deuda que ya tiene dueño.
 *
 *  Un guion que sale rojo A PROPÓSITO y se commitea así es un rojo permanente, y
 *  un rojo permanente se aprende a ignorar en dos semanas — momento en el cual
 *  deja de avisar del sexto invariante que se rompa. Es la misma patología que
 *  aflojar el guion para que salga verde, por el otro lado.
 *
 *  El patrón de la casa para esto ya existe: `mutacion-huella.json` congela los
 *  supervivientes conocidos y solo grita por los NUEVOS, y `arch-rules.json`
 *  tiene reglas en `warn` con sus violaciones congeladas. Aquí igual: la deuda
 *  se declara con su número de issue y sale verde; lo nuevo sale rojo. */
function clasifica(a, cazado) {
  if (cazado && a.deuda !== undefined) {
    console.log(
      `✖ DECLARACIÓN FALSA  ${a.nombre}\n` +
        `     ya tiene quien lo cace, y sigue declarado como deuda (#${a.deuda}). Quita el ` +
        `\`deuda: ${a.deuda}\` de este invariante y cierra el issue: una declaración que miente se ` +
        `sigue leyendo como cierta.`,
    );
    declaracionesFalsas += 1;
    return;
  }
  if (cazado) return true;
  if (a.deuda !== undefined) {
    console.log(`⏳ DEUDA #${a.deuda}  ${a.nombre}\n     ${a.porque}`);
    pendientes.push(`#${a.deuda}  ${a.nombre}`);
    return;
  }
  console.log(
    `✖ SIN CANDADO Y SIN ISSUE  ${a.nombre}\n     ${a.porque}\n` +
      `     Es NUEVO: o se le pone candado, o se abre issue y se declara aquí con \`deuda: <n>\`.`,
  );
  sinDeclarar += 1;
}

try {
  console.log("\n══ VIGENTE · lo que hoy se cumple, y que ponerse rojo aquí significa una regresión\n");
  for (const inv of VIGENTES) {
    let ok = false;
    let fallo = "";
    try { ok = inv.mira() === true; } catch (e) { fallo = ` (${e.message.split("\n")[0]})`; }
    console.log(`${ok ? "✔" : "✖"} ${inv.nombre}${fallo}`);
    if (!ok) { console.log(`     ${inv.porque}`); vigentesRotos += 1; }
    await cede();
  }

  if (!soloVigentes) {
    console.log("\n══ ABIERTO · se rompe a mano lo que el invariante dice defender, y se mira quién se entera\n");
    const base = {};
    for (const n of new Set(ABIERTOS.flatMap((a) => a.checkers))) base[n] = CHECKERS[n]();
    console.log(`  (línea base con el árbol limpio: ${Object.values(base).join(" · ")})\n`);

    for (const a of ABIERTOS) {
      const [fichero, busca, pone] = a.rompe;
      const texto = fuentes.get(fichero);
      if (!texto.includes(busca)) {
        // El probe apunta a otro sitio, así que no prueba nada — y si además
        // llevaba `deuda`, esa declaración lleva quién sabe cuánto mintiendo.
        console.log(
          `✖ PROBE OBSOLETO  ${a.nombre}\n     el patrón ya no está en ${fichero}: no se está ` +
            `probando nada${a.deuda === undefined ? "" : `, y la deuda #${a.deuda} se declara sobre un sitio que no existe`}`,
        );
        declaracionesFalsas += 1;
        continue;
      }
      writeFileSync(fichero, texto.replace(busca, pone));
      const cambios = a.checkers.filter((n) => CHECKERS[n]() !== base[n]);
      restaura();
      if (clasifica(a, cambios.length > 0)) console.log(`✔ ${a.nombre}\n     lo caza: ${cambios.join(", ")}`);
      await cede();
    }

    console.log("\n══ ABIERTO · conducta que falta (no hay línea que romper: es lo que no se comprueba)\n");
    for (const c of CONDUCTAS_ABIERTAS) {
      let ok = false;
      try { ok = c.quiere() === true; } catch (e) { ok = false; void e; }
      if (clasifica(c, ok)) console.log(`✔ ${c.nombre}`);
      await cede();
    }
  }
} finally {
  limpiar();
  const sucios = [...fuentes].filter(([f, t]) => readFileSync(f, "utf8") !== t).map(([f]) => f);
  if (sucios.length > 0) {
    console.error(`\n!!! NO se restauró: ${sucios.join(", ")}`);
    process.exit(2);
  }
}

console.log("\n──────────────────────────────────────────────────────────────────────");
console.log(`Invariantes vigentes rotos          : ${vigentesRotos} de ${VIGENTES.length}`);
if (!soloVigentes) {
  console.log(`Hallazgos NUEVOS sin candado        : ${sinDeclarar}`);
  console.log(`Declaraciones de deuda que mienten  : ${declaracionesFalsas}`);
  console.log(`Deuda declarada, con dueño          : ${pendientes.length}`);
  for (const p of pendientes) console.log(`   ⏳ ${p}`);
}

const roto = vigentesRotos > 0 || sinDeclarar > 0 || declaracionesFalsas > 0;
if (!roto) {
  console.log(
    pendientes.length === 0
      ? "\n✔ el reparto en lotes aguanta lo que dice, y sus invariantes tienen quien los cace\n"
      : `\n✔ nada nuevo sin candado. Queda ${pendientes.length} deuda(s) declarada(s) y con issue: ` +
          `verde no significa terminado, significa que lo que falta tiene dueño.\n`,
  );
} else {
  const porque = [
    vigentesRotos > 0 ? "hay una regresión en lo que ya funcionaba" : "",
    sinDeclarar > 0 ? "hay hallazgos NUEVOS sin candado y sin issue" : "",
    declaracionesFalsas > 0 ? "hay deuda declarada que ya no es cierta" : "",
  ].filter(Boolean);
  console.log(`\n✖ ${porque.join("; ")}\n`);
  process.exitCode = 1;
}
void cpSync;
