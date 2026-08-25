#!/usr/bin/env node
/** ¿Se pueden poner ROJOS los candados de la mutación con dueño?
 *
 *  Vive fuera de `qa/guiones/` a propósito, y no por comodidad: `qa/run.mjs`
 *  carga TODO `.mjs` de esa carpeta y lo conduce contra un navegador con el
 *  preset `e2e-sin-creditos` levantado. Lo que aquí se verifica no tiene UI —
 *  no hay nada que un jugador pueda mirar—, así que un fichero en `guiones/`
 *  levantaría el stack entero para no pulsar una tecla. El precedente es
 *  `qa/fixtures-sin-bridge.mjs`: candado ejecutable, stack propio, fuera del
 *  runner.
 *
 *  POR QUÉ EXISTE. La tanda del 2026-08-25 («la mutación se pide, se autoriza y
 *  vuelve con dueño») es casi toda candados nuevos, y su propia tesis está
 *  escrita en la cabecera de `scripts/mutacion-huella.ts`: la decisión se
 *  extrae a una función pura para que un test la pueda ejercer con datos
 *  sintéticos, porque un test que preguntara a git «pasaría en verde sin
 *  comprobar nada». Bien. Pero eso hay que DEMOSTRARLO rompiendo cada
 *  invariante a mano y mirando que el test se entera — y un test que se mira
 *  una vez y se cree para siempre es exactamente el verde que esta casa ya ha
 *  pagado dos veces.
 *
 *  Cómo funciona: por cada invariante, escribe el fuente ROTO a propósito,
 *  corre `test/mutacion-huella.test.ts` y exige que FALLE. Restaura siempre,
 *  y al terminar verifica byte a byte que el fichero volvió a estar como
 *  estaba. Es barato: la batería son ~0,7 s y va de uno en uno, así que no
 *  satura la máquina de nadie — que es, literalmente, de lo que va la tanda.
 *
 *  NO mide mutación: no lanza Stryker, no llama a `npm run mutate` ni a
 *  `npm run mutacion -- local`. Rompe y lee, que es más barato y más
 *  concluyente.
 *
 *    node qa/mutacion-candados-en-negativo.mjs
 *    node qa/mutacion-candados-en-negativo.mjs delta   # solo los que casen
 *
 *  Verde = todos los invariantes listados se ponen rojos al romperlos, y los
 *  puntos de decisión que la tanda estrenó tienen quien los ejerza.
 *  Rojo = hay un candado que no comprueba lo que dice comprobar.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");
const SRC = join(CORE, "scripts", "mutacion-huella.ts");
const HUELLA = join(CORE, "data", "contract", "mutacion-huella.json");
const BATERIA = "test/mutacion-huella.test.ts";

/** [nombre, fichero, buscar (null = reemplazar el fichero entero), poner]
 *
 *  Cada entrada es un invariante que el equipo declaró por escrito. Romperlo
 *  tiene que poner la batería roja; si no, el invariante es prosa. */
const INVARIANTES = [
  // ── el delta y sus TRES estados ──
  ["delta · sin-base se colapsa a NUEVO", SRC,
    `      base: "sin base",\n      nuevos: [],`,
    `      base: "sin base",\n      nuevos: [...ahora.vivos],`],
  ["delta · sin-base se colapsa a YA ESTABA", SRC,
    `      nuevos: [],\n      yaEstaban: [],`,
    `      nuevos: [],\n      yaEstaban: [...ahora.vivos],`],
  ["delta · sin-base se etiqueta como CON BASE", SRC,
    `      base: "sin base",`, `      base: "con base",`],
  // El caso que el plan marcó como el caro: si el delta fuera una resta, una
  // corrida con un superviviente nuevo encima de uno resuelto diría "sin
  // cambios" teniendo el hallazgo dentro.
  ["delta · EL CASO CARO: un nuevo que cae donde estaba uno viejo, descontado en silencio", SRC,
    `    nuevos: ahora.vivos.filter((h) => !antes.has(h)),`,
    `    nuevos: ahora.vivos.length > antes.size ? ahora.vivos.filter((h) => !antes.has(h)) : [],`],
  ["delta · los resueltos se callan", SRC,
    `    resueltos: base.vivos.filter((h) => !despues.has(h)),`, `    resueltos: [],`],
  // ── atribución honesta ──
  ["atribución · con dos candidatas se nombra solo la primera", SRC,
    `veredicto: "varios", etiqueta: nombres.join(" o ") }`,
    `veredicto: "varios", etiqueta: nombres[0] }`],
  ["atribución · sin dueño se descarta en silencio", SRC,
    `veredicto: "sin dueño", etiqueta: "sin dueño en el rango" }`,
    `veredicto: "sin dueño", etiqueta: "" }`],
  ["atribución · prDelAsunto coge la PRIMERA referencia en vez de la última", SRC,
    `  const ultimo = todos[todos.length - 1];`, `  const ultimo = todos[0];`],
  // ── el histórico ──
  ["huella · fusiona pierde lo que la corrida no midió", SRC,
    `  const ficheros: Record<string, MedidaDeFichero> = { ...base.ficheros };`,
    `  const ficheros: Record<string, MedidaDeFichero> = {};`],
  ["huella · el fichero commiteado se queda mudo", HUELLA, null, `{"ficheros":{}}`],
  ["huella · el hash se trunca a 32 bits", SRC,
    `  return h.toString(16).padStart(16, "0");`,
    `  return (h & 0xffffffffn).toString(16).padStart(16, "0");`],
  // ── el tope de la medida local ──
  ["tope · rechaza uno de más (off-by-one)", SRC, `  if (coste > tope) {`, `  if (coste >= tope) {`],
  ["tope · sin medida previa SE AUTORIZA", SRC,
    `  if (coste === undefined) {`, `  if (false as boolean) {`],
  // ── quién puede mover el tag ──
  ["tag · una lista explícita mueve el tag", SRC,
    `      completa: true,\n      mueveTag: false,`, `      completa: true,\n      mueveTag: true,`],
  ["tag · una corrida truncada mueve el tag", SRC,
    `  const faltan = c.modulos_pedidos.filter((id) => !c.modulos_con_informe.includes(id));`,
    `  const faltan: string[] = [];`],
  // ── la descarga, por los dos lados ──
  ["descarga · un informe que SOBRA se ignora", SRC,
    `  const sobran = presentes.filter((id) => !c.modulos_con_informe.includes(id));`,
    `  const sobran: string[] = [];`],
  ["descarga · un informe que FALTA se ignora", SRC,
    `  const faltan = c.modulos_pedidos.filter((id) => !presentes.includes(id));`,
    `  const faltan: string[] = [];`],
  // ── qué cuenta como vivo ──
  ["vivos · el total deja de contar a los supervivientes", SRC,
    `  return { vivos: [...vivos].sort(), total: vivos.length + detectados };`,
    `  return { vivos: [...vivos].sort(), total: detectados };`],
  // ── los avisos dejaron de contradecir la política ──
  ["avisos · vuelven a mandar `npm run mutate`", SRC,
    "    ? `npm run mutacion -- local ${id}  (${permiso.coste} mutantes)`",
    "    ? `npm run mutate -- ${id}  (${permiso.coste} mutantes)`"],
  ["avisos · una fecha ilegible cuenta como FRESCA", SRC,
    `    if (Number.isNaN(t)) {\n      nunca.push(m.id);\n      continue;\n    }`,
    `    if (Number.isNaN(t)) {\n      continue;\n    }`],
  ["avisos · el de frescura se calla siempre", SRC,
    `  if (desactualizados.length === 0) return undefined;`, `  if (true) return undefined;`],
  ["avisos · la anotación 'sin base' miente", SRC,
    `  if (!base) return "sin base de comparación — nadie lo había medido antes";`,
    `  if (!base) return "ya estaban";`],
  // ── las dos decisiones que la tanda estrenó ──
  // Estaban en SIN_BATERIA porque vivían dentro de `scripts/mutacion.ts` y
  // `scripts/mutate.ts`, que ningún test puede importar (el segundo lanzaba una
  // corrida al cargarse). Ahora la REGLA vive en `mutacion-huella.ts`, pura, así
  // que se puede romper y mirar como las otras veinte — que es estrictamente
  // más fuerte que comprobar que alguien la nombra.
  ["muro · acepta CUALQUIER valor de NEFAN_MUTATE_AUTORIZADO, no solo `si`", SRC,
    `  if (autorizado === "si") return { ok: true };`,
    `  if (autorizado !== undefined) return { ok: true };`],
  ["repartir · 'a medio repartir' se colapsa a 'pendiente' (reescribiría la mitad ya repartida)", SRC,
    `  if (repartidos === 0) return { tipo: "pendiente" };`,
    `  if (repartidos < ficheros.length) return { tipo: "pendiente" };`],
  ["repartir · 'a medio repartir' se colapsa a 'ya repartida' (la otra mitad sin dueño para siempre)", SRC,
    `  return { tipo: "a medio repartir", repartidos, total: ficheros.length };`,
    `  return { tipo: "ya repartida" };`],
  ["repartir · el guardia del comentario deja de mirar (los dos comentarios de #273)", SRC,
    `export function yaComentada(cuerpos: readonly string[], runId: string): boolean {\n  const marca = marcaDeCorrida(runId);`,
    `export function yaComentada(cuerpos: readonly string[], runId: string): boolean {\n  if (cuerpos.length >= 0) return false;\n  const marca = marcaDeCorrida(runId);`],

];

/** Puntos de decisión que la tanda estrenó y que NO viven en el fichero puro.
 *
 *  No se pueden romper y mirar, porque no hay batería que los mire: ningún test
 *  importa `scripts/mutacion.ts` ni `scripts/mutate.ts`. Se comprueba lo único
 *  comprobable —que alguien los nombre desde un test— y se dice en voz alta
 *  mientras no sea verdad. Los dos han costado ya un incidente cada uno:
 *  `yaRepartida` nació de dos bugs de pérdida de datos en el mismo verbo, y el
 *  muro, de una corrida completa lanzada sin querer en la máquina del usuario. */
const SIN_BATERIA = [
  // VACÍO, y esa es la buena noticia. Las dos que había —`yaRepartida` y el
  // muro— se extrajeron a `mutacion-huella.ts` (`estadoDeReparto`,
  // `yaComentada`, `muroDeMutacion`) y han pasado a la lista de arriba, donde
  // se rompen y se miran. Si alguna decisión nueva vuelve a nacer dentro de un
  // script que ningún test puede importar, se anota aquí mientras dure.

];

function corre() {
  const r = spawnSync("node", ["--import", "tsx", "--test", "--test-concurrency=1", BATERIA],
    { cwd: CORE, encoding: "utf8", timeout: 300000 });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = /^ℹ fail (\d+)$/m.exec(salida) ?? /# fail (\d+)/.exec(salida);
  return {
    fallos: m ? Number(m[1]) : -1,
    rotos: [...salida.matchAll(/✖ (.+?) \(/g)].map((x) => x[1]),
  };
}

const filtro = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const casa = (n) => filtro.length === 0 || filtro.some((f) => n.toLowerCase().includes(f.toLowerCase()));

const original = new Map([SRC, HUELLA].map((f) => [f, readFileSync(f, "utf8")]));
const restaura = () => { for (const [f, txt] of original) writeFileSync(f, txt); };

let fallidos = [];
try {
  process.stdout.write("Base (nada roto): ");
  const base = corre();
  console.log(base.fallos === 0 ? "verde ✔" : `${base.fallos} fallo(s) ✖  — la batería YA está roja, arregla eso primero`);
  if (base.fallos !== 0) { restaura(); process.exit(1); }
  console.log();

  for (const [nombre, fichero, buscar, poner] of INVARIANTES) {
    if (!casa(nombre)) continue;
    restaura();
    let texto;
    if (buscar === null) texto = poner;
    else {
      const previo = original.get(fichero);
      const veces = previo.split(buscar).length - 1;
      if (veces !== 1) {
        console.log(`⚠️  ${nombre}`);
        console.log(`     el patrón aparece ${veces} veces: el código se ha movido y este candado ya no lo apunta\n`);
        fallidos.push(`${nombre} (patrón obsoleto)`);
        continue;
      }
      texto = previo.replace(buscar, poner);
    }
    writeFileSync(fichero, texto);
    const r = corre();
    const rojo = r.fallos > 0;
    if (!rojo) fallidos.push(nombre);
    console.log(`${rojo ? "🔴 rojo " : "🟢 VERDE"}  ${nombre}`);
    if (rojo) console.log(`     lo caza: ${r.rotos.slice(0, 2).join(" | ") || "(sin nombre)"}`);
    else console.log(`     ⚠️  ROMPERLO NO CAMBIA NADA: el candado no comprueba lo que dice`);
  }
} finally {
  restaura();
}

// El fichero tiene que haber vuelto a estar EXACTAMENTE como estaba: este
// guion escribe en el árbol de trabajo de alguien.
for (const [f, txt] of original) {
  if (readFileSync(f, "utf8") !== txt) {
    console.error(`\n✖ NO SE RESTAURÓ ${f} — revísalo con git diff antes de seguir`);
    process.exit(2);
  }
}

console.log("\nPuntos de decisión sin batería que los ejerza:");
const huerfanos = [];
for (const [nombre, marca] of SIN_BATERIA) {
  const r = spawnSync("grep", ["-rl", marca, "test/"], { cwd: CORE, encoding: "utf8" });
  const cubierto = (r.stdout ?? "").trim().length > 0;
  if (!cubierto) huerfanos.push(nombre);
  console.log(`  ${cubierto ? "✔ lo nombra un test" : "✖ NINGÚN test lo nombra"}  ${nombre}`);
}

console.log(`\n${"─".repeat(70)}`);
console.log(`Invariantes probados en negativo : ${INVARIANTES.filter(([n]) => casa(n)).length}`);
console.log(`Se ponen rojos al romperlos      : ${INVARIANTES.filter(([n]) => casa(n)).length - fallidos.length}`);
console.log(`NO se enteran                    : ${fallidos.length}`);
for (const f of fallidos) console.log(`   🟢 ${f}`);
console.log(`Decisiones sin batería           : ${huerfanos.length}`);
for (const h of huerfanos) console.log(`   ✖ ${h}`);

const ok = fallidos.length === 0 && huerfanos.length === 0;
console.log(ok ? "\n✔ todos los candados comprueban lo que dicen" : "\n✖ hay candados que no comprueban nada");
process.exit(ok ? 0 : 1);
