#!/usr/bin/env node
/** ¿Se puede poner ROJO el CABLEADO del ciclo de mutación?
 *
 *  Vecino de `qa/mutacion-candados-en-negativo.mjs`, y complementario: aquél
 *  rompe `scripts/mutacion-huella.ts` —el fichero puro— y mira si la batería se
 *  entera. Éste rompe lo que la batería NO puede mirar: `scripts/mutacion.ts` y
 *  `.github/workflows/mutation.yml`.
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
 *  Verde = los siete invariantes del cableado se pueden ver rotos.
 *  Rojo  = hay una pieza del ciclo que se puede deshacer sin que se note.
 *
 *  QUÉ TOCA Y CÓMO LO DEVUELVE. Escribe en el árbol de trabajo: aparta
 *  `nefan-core/reports/mutation/` (que es material descargado, no versionado),
 *  y modifica temporalmente `scripts/mutacion.ts`, el workflow y
 *  `data/contract/mutacion-huella.json` —que `repartir` reescribe por diseño—.
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
];

// ── el bucle ─────────────────────────────────────────────────────────────────

const filtro = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const casa = (n) => filtro.length === 0 || filtro.some((f) => n.toLowerCase().includes(f.toLowerCase()));

if (existsSync(APARTADO)) {
  console.error(`✖ ya existe ${APARTADO}: una corrida anterior de este guion no terminó de restaurar.`);
  console.error(`  Míralo y devuélvelo a mano a reports/mutation/ antes de volver a correrlo.`);
  process.exit(2);
}

const fuentes = new Map([MUT, YML, HUELLA].map((f) => [f, readFileSync(f, "utf8")]));
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
