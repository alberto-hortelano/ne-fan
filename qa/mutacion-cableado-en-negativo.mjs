#!/usr/bin/env node
/** ¿Se puede poner ROJO el CABLEADO del ciclo de mutación?
 *
 *  Vecino de `qa/mutacion-candados-en-negativo.mjs`, y complementario: aquél
 *  rompe `scripts/mutacion-huella.ts` —el fichero puro— y mira si la batería se
 *  entera. Éste rompe lo que la batería NO puede mirar: `scripts/mutacion.ts`,
 *  `scripts/mutate.ts` y `.github/workflows/mutation.yml`.
 *
 *  POR QUÉ EXISTE. PR-A (#381 + #420) declaró su propia carencia: «el invariante
 *  "`repartir` ancla en `corrida.desde` y NO en el tag" no lo defiende ningún
 *  test, porque ningún test importa `scripts/mutacion.ts`». QA midió cuánto más
 *  estaba en esa situación y salieron SIETE reversiones que no ponen rojo nada:
 *  el ancla del reparto, la contradicción del rango vacío, el fail-loud de
 *  `leerCorrida`, el cálculo del sello, el ancla que escribe `manifiesto`, la
 *  admisión de `--pedidos ""` y el paso entero del workflow. Es decir: los dos
 *  issues que la PR cierra se pueden deshacer, en la herramienta que se usa, sin
 *  que `npm run verify` se inmute. La regla de la casa es candado, no prosa.
 *
 *  Cómo funciona: cada invariante se ejerce contra la HERRAMIENTA REAL —el verbo
 *  de verdad, sobre un `reports/mutation/` de ensayo— en las dos direcciones:
 *  primero se comprueba que hace lo que dice, y después se deshace el cambio en
 *  el fuente y se exige que el observable CAMBIE. Un invariante cuyo rojo no se
 *  ve es prosa, y aquí se cuenta como fallo.
 *
 *  NO mide mutación: no lanza Stryker, ni `npm run mutate`, ni
 *  `npm run mutacion -- local`, ni `traer` (que llamaría a `gh`). No abre
 *  puertos, no arranca el juego y no gasta un crédito.
 *
 *    node qa/mutacion-cableado-en-negativo.mjs
 *    node qa/mutacion-cableado-en-negativo.mjs ancla    # solo los que casen
 *
 *  PR-E (la corrida partida en lotes) añade cuatro más, por el mismo motivo: el
 *  plan que sube ANTES de medir, el fail-loud de la fusión sin plan, el
 *  cronómetro de `mutate.ts` y el `fail-fast: false` de la matriz. Todo eso vive
 *  en scripts y en YAML, o sea donde ningún test llega.
 *
 *  Verde = todos los invariantes del cableado se pueden ver rotos.
 *  Rojo  = hay una pieza del ciclo que se puede deshacer sin que se note.
 *
 *  QUÉ TOCA Y CÓMO LO DEVUELVE. Escribe en el árbol de trabajo: aparta
 *  `nefan-core/reports/mutation/` (que es material descargado, no versionado),
 *  y modifica temporalmente `scripts/mutacion.ts`, `scripts/mutate.ts`, el
 *  workflow y `data/contract/mutacion-huella.json` —que `repartir` reescribe por
 *  diseño—.
 *  Todo vuelve en el `finally` y se verifica byte a byte al terminar; si algo no
 *  volvió, sale con 2 y lo dice.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");
const MUT = join(CORE, "scripts", "mutacion.ts");
/** `mutate.ts` entra con PR-E: es quien cronometra cada módulo, y ese número es
 *  lo único que hace posible repartir la corrida por el reloj. */
const MUTATE = join(CORE, "scripts", "mutate.ts");
const YML = join(raiz, ".github", "workflows", "mutation.yml");
const HUELLA = join(CORE, "data", "contract", "mutacion-huella.json");
const PLAN = join(CORE, "data", "contract", "mutation-targets.json");
const INFORMES = join(CORE, "reports", "mutation");
const APARTADO = join(CORE, "reports", "mutation.qa-cableado");
const CORRIDA = join(INFORMES, "corrida.json");

const git = (args) => execFileSync("git", args, { cwd: raiz, encoding: "utf8" }).trim();

/** El verbo de verdad, con su salida y su código. */
function mutacion(args) {
  const r = spawnSync("npm", ["run", "--silent", "mutacion", "--", ...args], {
    cwd: CORE,
    encoding: "utf8",
    timeout: 300000,
  });
  return { ok: r.status === 0, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ── el escenario de ensayo ───────────────────────────────────────────────────

/** El ancla y el commit medido salen del TAG, no de `HEAD`: así el reparto
 *  anclado en `corrida.desde` ve un rango con commits y el anclado en el tag
 *  (el bug de #381, que el propio workflow provoca al adelantarlo) ve cero. Sin
 *  esa asimetría, las dos versiones darían lo mismo y el candado no distinguiría
 *  nada — que es exactamente la forma del verde que no comprueba. */
function escenario() {
  const tag = git(["rev-parse", "mutacion-ultima^{commit}"]);
  const anterior = git(["rev-parse", `${tag}~4`]);
  const plan = JSON.parse(readFileSync(PLAN, "utf8"));
  const modulo = plan.modulos.find((m) => {
    if (m.mutate.length !== 1 || m.mutate[0].startsWith("!")) return false;
    const r = spawnSync("git", ["cat-file", "-e", `${tag}:nefan-core/${m.mutate[0]}`], { cwd: raiz });
    return r.status === 0;
  });
  if (!modulo) throw new Error("ningún módulo del plan tiene un solo fichero vivo en el tag");
  return { tag, anterior, id: modulo.id, fichero: modulo.mutate[0] };
}

const E = escenario();

/** Un informe de Stryker mínimo pero real: un superviviente con su sitio. */
function siembraInforme(marca = "x") {
  rmSync(INFORMES, { recursive: true, force: true });
  mkdirSync(INFORMES, { recursive: true });
  soloInforme(marca);
}

/** Reescribe SOLO el informe del módulo, dejando el `corrida.json` que ya
 *  estuviera: es lo que hace `npm run mutacion -- local <id>` encima de una
 *  descarga, y es el caso exacto de #420. */
function soloInforme(marca = "x") {
  const informe = {
    files: {
      [E.fichero]: {
        mutants: [
          {
            id: "1",
            mutatorName: "BooleanLiteral",
            replacement: marca,
            status: "Survived",
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
          },
        ],
      },
    },
  };
  writeFileSync(join(INFORMES, `${E.id}.json`), JSON.stringify(informe));
}

/** El manifiesto lo escribe la herramienta, no este guion: si lo fabricara a
 *  mano, el sello sería el que yo digo y no el que ella calcula — y lo que se
 *  prueba es justo eso. */
function manifiesta({ desde = E.anterior, sha = E.tag, origen = "rango", run = "999900", pedidos = E.id } = {}) {
  const r = mutacion(["manifiesto", "--origen", origen, "--pedidos", pedidos, "--sha", sha, "--desde", desde, "--run", run]);
  if (!r.ok) throw new Error(`el manifiesto de ensayo no se pudo escribir:\n${r.salida}`);
  return r;
}

// ── los invariantes del cableado ─────────────────────────────────────────────

/** [nombre, preparar → observable esperado, [fichero, buscar, poner]]
 *
 *  `mira()` devuelve una cadena: lo que se compara. El invariante está candado
 *  si con el fuente ENTERO la cadena casa con `bien`, y con el fuente ROTO deja
 *  de casar. */
const INVARIANTES = [
  {
    nombre: "ancla · el reparto ancla en la corrida, no en el tag que ella misma movió (#381)",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999901" });
      return mutacion(["repartir"]).salida;
    },
    bien: (s) => new RegExp(`${E.anterior.slice(0, 7)}\\.\\.${E.tag.slice(0, 7)}`).test(s) && !/no tiene ni un commit/.test(s),
    porque: "el reparto tiene que mirar el rango del MANIFIESTO; con el tag como ancla no hay rango que mirar",
    rompe: [MUT, `commitsDelRango(plan, corrida.desde, corrida.sha)`, `commitsDelRango(plan, shaDelTag(), corrida.sha)`],
  },
  {
    nombre: "ancla · un rango VACÍO con origen `rango` es una contradicción y lanza",
    mira: () => {
      siembraInforme();
      manifiesta({ desde: E.tag, run: "999902" });
      return mutacion(["repartir"]).salida;
    },
    bien: (s) => /no tiene ni un commit/.test(s),
    porque: "CI no puede haber seleccionado módulos de un diff vacío: callarlo deja pasar una no-medida con cara de resultado",
    rompe: [MUT, `  if (corrida.origen === "rango" && rango.tipo === "vacío") {`, `  if (false && corrida.origen === "rango" && rango.tipo === "vacío") {`],
  },
  {
    nombre: "sello · el guardia mira el CONTENIDO del informe, no su nombre (#420)",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999903" });
      // Lo que deja un `npm run mutacion -- local <id>` corrido encima de la
      // descarga: el mismo nombre de fichero, otra medida dentro.
      soloInforme("el-que-dejo-el-local");
      return mutacion(["repartir"]).salida;
    },
    bien: (s) => new RegExp(`NO son los que midió la corrida[\\s\\S]*${E.id}`).test(s),
    porque: "sin sello, una medida local entra en la huella COMMITEADA con el sha, la fecha y el run de CI encima",
    rompe: [MUT, `  return createHash("sha256").update(readFileSync(ruta)).digest("hex");`, `  void ruta;\n  return "0".repeat(64);`],
  },
  {
    nombre: "sello · `corrida.json` no es un informe: sellarlo inventaría un módulo fantasma",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999904" }); // escribe corrida.json DENTRO del directorio
      manifiesta({ run: "999908" }); // y el siguiente manifiesto lo ve ahí
      return JSON.parse(readFileSync(CORRIDA, "utf8")).informes.map((i) => i.modulo).join(",");
    },
    bien: (s) => s === E.id,
    porque: "el manifiesto declararía un informe `corrida` que ningún módulo del plan tiene, y `repartir` moriría buscándolo",
    rompe: [MUT, `    .filter((f) => f.endsWith(".json") && f !== "corrida.json")`, `    .filter((f) => f.endsWith(".json"))`],
  },
  {
    nombre: "formato · un `corrida.json` sin `desde` ni `informes` se rechaza DICIENDO qué falta",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999905" });
      const c = JSON.parse(readFileSync(CORRIDA, "utf8"));
      delete c.desde;
      c.modulos_con_informe = c.informes.map((i) => i.modulo);
      delete c.informes;
      writeFileSync(CORRIDA, JSON.stringify(c, null, 2));
      return mutacion(["repartir"]).salida;
    },
    bien: (s) => /no está bien: desde \(el ancla del rango\); informes/.test(s),
    porque: "pre-producción, cero compatibilidad: leerlo «como se pueda» son las dos degradaciones que salen verdes y mienten",
    rompe: [
      MUT,
      `  if (!cadena(corrida.desde)) mal.push("desde (el ancla del rango)");`,
      `  if (false) mal.push("desde (el ancla del rango)");`,
    ],
  },
  {
    nombre: "manifiesto · guarda el ANCLA que le dan, no el sha medido",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999906" });
      return JSON.parse(readFileSync(CORRIDA, "utf8")).desde ?? "(sin desde)";
    },
    bien: (s) => s === E.anterior,
    porque: "si el manifiesto guardara el sha medido, el rango saldría vacío por construcción: el bug de #381 con otro disfraz",
    rompe: [MUT, `    desde: valor("--desde"),`, `    desde: valor("--sha"),`],
  },
  {
    nombre: "manifiesto · `--pedidos` vacío significa TODOS, y los demás flags siguen siendo estrictos",
    mira: () => {
      siembraInforme();
      const vacio = mutacion(["manifiesto", "--origen", "todos", "--pedidos", "", "--sha", E.tag, "--desde", E.anterior, "--run", "999907"]);
      const sinAncla = mutacion(["manifiesto", "--origen", "todos", "--pedidos", "", "--sha", E.tag, "--desde", "", "--run", "999907"]);
      return `pedidos-vacio:${vacio.ok} sin-ancla:${sinAncla.ok}`;
    },
    bien: (s) => s === "pedidos-vacio:true sin-ancla:false",
    porque: "el input TODOS del workflow manda `--pedidos \"\"`: rechazarlo mata el manifiesto DESPUÉS de 131 min de runner",
    rompe: [MUT, `    if (i < 0 || argv[i + 1] === undefined) throw new Error("manifiesto necesita --pedidos");`, `    if (i < 0 || !argv[i + 1]) throw new Error("manifiesto necesita --pedidos");`],
  },
  {
    nombre: "workflow · el paso de selección LEE el ancla y el del manifiesto la PASA",
    // El YAML no lo ejecuta nadie aquí, así que lo único comprobable es que las
    // tres piezas siguen escritas. Es poco, y es más que nada: la reversión del
    // paso entero no la nota hoy ninguna herramienta del repo.
    mira: () => readFileSync(YML, "utf8"),
    bien: (s) =>
      /DESDE="\$\(npm run --silent mutacion -- ancla\)"/.test(s) &&
      /echo "desde=\$DESDE" >> "\$GITHUB_OUTPUT"/.test(s) &&
      /--desde "\$DESDE"/.test(s) &&
      /DESDE: \$\{\{ steps\.seleccion\.outputs\.desde \}\}/.test(s),
    porque: "sin el ancla en el manifiesto, `repartir` no tiene de dónde sacarla y el reparto vuelve a colgar del tag",
    rompe: [YML, `          DESDE="$(npm run --silent mutacion -- ancla)"\n`, ``],
  },

  // ── PR-E · la corrida partida en lotes ─────────────────────────────────────
  {
    nombre: "lotes · el PLAN lleva TODO lo pedido, también lo que no se pudo empaquetar por reloj",
    mira: () => {
      // `apuntado` se DESCRONOMETRA aquí a propósito: el probe necesita un
      // módulo sin reloj (va a lote propio, `medido: false`) para que la rotura
      // de abajo lo tire de `modulos_pedidos`. El 04-09 lo estaba de suyo;
      // #440/#445 cronometraron los 41 y este probe pasó a «romperlo no cambia
      // el observable» sin que nadie lo viera (medido el 05-09). La huella la
      // devuelve `restauraFuentes()` después de cada `mira`.
      const huella = JSON.parse(readFileSync(HUELLA, "utf8"));
      const apuntado = JSON.parse(readFileSync(PLAN, "utf8")).modulos.find((m) => m.id === "apuntado");
      if (!apuntado) throw new Error("el plan ya no tiene el módulo `apuntado`: elige otro para el probe");
      for (const f of apuntado.mutate) delete huella.ficheros[f]?.segundos;
      writeFileSync(HUELLA, `${JSON.stringify(huella, null, 2)}\n`);
      rmSync(join(CORE, "reports", "plan-corrida.json"), { force: true });
      const r = mutacion([
        "lotes", "--ids", `${E.id} apuntado`, "--origen", "explicito",
        "--sha", E.tag, "--desde", E.anterior, "--run", "999910",
      ]);
      if (!r.ok) throw new Error(`lotes no escribió el plan:\n${r.salida}`);
      const p = JSON.parse(readFileSync(join(CORE, "reports", "plan-corrida.json"), "utf8"));
      return `${p.modulos_pedidos.join(",")} | lotes=${p.lotes.length}`;
    },
    // `apuntado` va sin reloj (sembrado arriba), así que va a lote propio; lo
    // que NO puede pasar es que se caiga de `modulos_pedidos`, porque de ahí
    // sale el veredicto de la fusión.
    bien: (s) => s.startsWith(["apuntado", E.id].sort().join(",")),
    porque: "de `modulos_pedidos` del plan sale el veredicto: un módulo que se caiga de ahí es una medida que nadie echa de menos",
    rompe: [
      MUT,
      `    modulos_pedidos: [...ids].sort(),`,
      `    modulos_pedidos: paquetes.filter((l) => l.medido).flatMap((l) => l.modulos).sort(),`,
    ],
  },
  {
    nombre: "fusión · sin el plan NO se fabrica una corrida con lo que llegó",
    mira: () => {
      const dir = join(CORE, "reports", "lotes-ensayo");
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, "informe-mutacion-1"), { recursive: true });
      return mutacion(["fusionar", "--entrada", "reports/lotes-ensayo"]).salida;
    },
    bien: (s) => /no está el plan de la corrida/.test(s) && /COMPLETA y el tag se movería mintiendo/.test(s),
    porque: "reconstruir lo pedido desde los lotes que llegaron hace que un lote muerto salga COMPLETA: el tag mentiría",
    rompe: [
      MUT,
      `  if (!existsSync(rutaPlan)) {`,
      `  if (false as boolean) {`,
    ],
  },
  {
    // H2 de QA-E. El commit de PR-E dice que «el sello es lo que hace segura la
    // fusión: `reunir` verifica cada informe contra el sha256 de SU parcial
    // antes de mezclarlo». Esa frase no la defendía nadie: el candado del sello
    // ejerce `repartir` y rompe `selloDeInforme`, no la llamada de dentro de
    // `fusionar`. Sin ella, un informe suplantado entra en la fusión, sale en
    // el artefacto único con SU sello dentro del manifiesto que la propia
    // fusión acaba de fabricar, y de ahí a la huella commiteada: #420 reabierto
    // por la puerta nueva.
    nombre: "fusión · el sello de cada lote se comprueba ANTES de mezclar (#420 por la puerta nueva)",
    mira: () => {
      const dir = join(CORE, "reports", "lotes-ensayo");
      rmSync(dir, { recursive: true, force: true });
      // Un lote completo y honesto: el manifiesto lo escribe la herramienta.
      siembraInforme();
      manifiesta({ run: "999912", pedidos: E.id });
      mkdirSync(join(dir, "plan-corrida"), { recursive: true });
      const r = mutacion([
        "lotes", "--ids", E.id, "--origen", "rango",
        "--sha", E.tag, "--desde", E.anterior, "--run", "999912",
      ]);
      if (!r.ok) throw new Error(`lotes no escribió el plan:\n${r.salida}`);
      writeFileSync(
        join(dir, "plan-corrida", "plan-corrida.json"),
        readFileSync(join(CORE, "reports", "plan-corrida.json"), "utf8"),
      );
      mkdirSync(join(dir, "informe-mutacion-1"), { recursive: true });
      writeFileSync(join(dir, "informe-mutacion-1", "corrida.json"), readFileSync(CORRIDA, "utf8"));
      // …y el informe se SUSTITUYE después de sellado, que es lo que deja un
      // `local` corrido encima del artefacto del job.
      soloInforme("suplantado");
      writeFileSync(
        join(dir, "informe-mutacion-1", `${E.id}.json`),
        readFileSync(join(INFORMES, `${E.id}.json`), "utf8"),
      );
      return mutacion(["fusionar", "--entrada", "reports/lotes-ensayo"]).salida;
    },
    bien: (s) => /NO son los que midió la corrida 999912/.test(s) && /no casa con su propio manifiesto/.test(s),
    porque: "sin ese guardia, un informe suplantado entra en el artefacto único y de ahí a la huella commiteada",
    rompe: [MUT, `    const errores = verificaDescarga(parcial, presentes);`, `    const errores: string[] = [];`],
  },
  {
    nombre: "reloj · `mutate.ts` guarda los segundos de cada módulo, y no al final",
    // El cronómetro existía y moría con el log: sacar los de dos corridas costó
    // leer dos logs de 21.000 líneas a mano. Y se escribe DESPUÉS DE CADA
    // MÓDULO porque la corrida que motivó los lotes murió en el timeout con 25
    // medidos — guardarlo al final habría perdido los 25.
    mira: () => readFileSync(MUTATE, "utf8"),
    bien: (s) => /anotaTiempo\(r\.id, Math\.round\(r\.segundos\)\);/.test(s) && /rmSync\(RUTA_TIEMPOS, \{ force: true \}\);/.test(s),
    porque: "sin el cronómetro en el manifiesto, la corrida siguiente no sabe cuánto tarda nada y TODO vuelve a lote propio",
    rompe: [
      MUTATE,
      `    anotaTiempo(r.id, Math.round(r.segundos));\n`,
      ``,
    ],
  },
  {
    nombre: "workflow · la matriz no cancela a los lotes vivos cuando uno se cae",
    // `fail-fast: false` es el equivalente exacto de que `mutate.ts` no corte en
    // el primer módulo bajo su break: sin él, un lote caído se lleva por delante
    // medidas ya hechas.
    mira: () => readFileSync(YML, "utf8"),
    bien: (s) =>
      /fail-fast: false/.test(s) &&
      /max-parallel: \d+/.test(s) &&
      // El plan sube ANTES de medir y en su propio artefacto: es lo único que
      // sobrevive a un lote que muere sin subir nada.
      /name: plan-corrida/.test(s) &&
      s.indexOf("name: plan-corrida") < s.indexOf("Medir el lote"),
    porque: "sin `fail-fast: false` un lote caído cancela a los demás; y sin el plan subido antes, la fusión no sabe qué se pidió",
    rompe: [YML, `      fail-fast: false\n`, ``],
  },
];

// ── el bucle ─────────────────────────────────────────────────────────────────

const filtro = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const casa = (n) => filtro.length === 0 || filtro.some((f) => n.toLowerCase().includes(f.toLowerCase()));

if (existsSync(APARTADO)) {
  console.error(`✖ ya existe ${APARTADO}: una corrida anterior de este guion no terminó de restaurar.`);
  console.error(`  Míralo y devuélvelo a mano a reports/mutation/ antes de volver a correrlo.`);
  process.exit(2);
}

const fuentes = new Map([MUT, MUTATE, YML, HUELLA].map((f) => [f, readFileSync(f, "utf8")]));
const restauraFuentes = () => { for (const [f, t] of fuentes) writeFileSync(f, t); };
const habiaInformes = existsSync(INFORMES);
if (habiaInformes) renameSync(INFORMES, APARTADO);

const fallidos = [];
try {
  for (const inv of INVARIANTES) {
    if (!casa(inv.nombre)) continue;

    restauraFuentes();
    const entero = inv.mira();
    restauraFuentes();
    if (!inv.bien(entero)) {
      console.log(`✖ VERDE-FALSO  ${inv.nombre}`);
      console.log(`     con el fuente ENTERO ya no se cumple. El invariante se rompió o el guion apunta a otro sitio.`);
      console.log(`     observado: ${JSON.stringify(entero).slice(0, 240)}`);
      fallidos.push(`${inv.nombre} (no se cumple ni sin romper nada)`);
      continue;
    }

    const [fichero, buscar, poner] = inv.rompe;
    const previo = fuentes.get(fichero);
    const veces = previo.split(buscar).length - 1;
    if (veces !== 1) {
      console.log(`⚠️  ${inv.nombre}`);
      console.log(`     el patrón aparece ${veces} veces: el código se movió y este candado ya no lo apunta\n`);
      fallidos.push(`${inv.nombre} (patrón obsoleto)`);
      continue;
    }
    writeFileSync(fichero, previo.replace(buscar, poner));
    const roto = inv.mira();
    restauraFuentes();

    const seEntera = !inv.bien(roto);
    if (!seEntera) fallidos.push(inv.nombre);
    console.log(`${seEntera ? "🔴 rojo " : "🟢 VERDE"}  ${inv.nombre}`);
    console.log(`     ${seEntera ? inv.porque : "⚠️  ROMPERLO NO CAMBIA EL OBSERVABLE: esto no es un candado"}`);
  }
} finally {
  restauraFuentes();
  rmSync(INFORMES, { recursive: true, force: true });
  if (habiaInformes) renameSync(APARTADO, INFORMES);
}

for (const [f, t] of fuentes) {
  if (readFileSync(f, "utf8") !== t) {
    console.error(`\n✖ NO SE RESTAURÓ ${f} — revísalo con git diff antes de seguir`);
    process.exit(2);
  }
}
if (existsSync(APARTADO) || (habiaInformes && !existsSync(INFORMES))) {
  console.error(`\n✖ los informes de ${INFORMES} no volvieron a su sitio (están en ${APARTADO})`);
  process.exit(2);
}

const probados = INVARIANTES.filter((i) => casa(i.nombre)).length;
console.log(`\n${"─".repeat(70)}`);
console.log(`Invariantes del CABLEADO probados en negativo : ${probados}`);
console.log(`Se ven rotos al romperlos                     : ${probados - fallidos.length}`);
console.log(`NO se enteran                                 : ${fallidos.length}`);
for (const f of fallidos) console.log(`   🟢 ${f}`);
console.log(
  fallidos.length === 0
    ? "\n✔ el cableado del ciclo se puede ver roto: no es prosa"
    : "\n✖ hay piezas del ciclo que se pueden deshacer sin que se note",
);
process.exit(fallidos.length === 0 ? 0 : 1);
