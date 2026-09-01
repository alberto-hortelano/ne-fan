#!/usr/bin/env node
/** ¿Puede el LIBRO DE ESPERAS (#261) seguir declarando verde algo que no midió?
 *
 *  Hermano de `qa/bateria-candados-en-negativo.mjs`, `qa/contrato-…` y
 *  `qa/mutacion-…`, y vive fuera de `qa/guiones/` por la misma razón: `run.mjs`
 *  carga TODO `.mjs` de esa carpeta, y estos guiones están escritos para salir
 *  ROJOS. Cuesta una corrida de guiones, así que va bajo demanda.
 *
 *  POR QUÉ EXISTE, y por qué no bastaba con la entrada `#261` de
 *  `bateria-candados-en-negativo.mjs`. Esa entrada prueba UNA boca: que el
 *  `.catch(() => null)` sobre una espera ya no sale verde. Pero el candado se
 *  apoya en una afirmación más fuerte, escrita en `qa/lib/esperas.mjs`: que una
 *  expiración se resuelve de tres formas «y no hay una cuarta». Una afirmación
 *  así no la demuestra un ejemplo — hay que ir a buscarle la cuarta boca. Esto
 *  es esa búsqueda, ejecutable: las formas de tragarse una espera que a alguien
 *  se le pueden ocurrir (`try/catch` a pelo, un `finally` que devuelve, un
 *  `Promise.all`, un `absorbe` que envuelve más de lo que dice) y los caminos
 *  por los que un bloque sin medir SIGUE saliendo verde hoy.
 *
 *  DOS CLASES DE ENTRADA, y la diferencia importa:
 *
 *  · `candado`  — tiene que salir ROJO (o ⊘). Si sale verde, el candado de
 *    #261 ha dejado de sujetar esa forma y hay una regresión.
 *  · `hallazgo` — HOY sale verde, y eso es un agujero conocido que QA reportó
 *    el 2026-09-01 (ver `docs/agents/2026-09-01-el-timeout-que-decide/qa.md`).
 *    Si algún día sale rojo, el agujero se cerró: la entrada no es un fallo,
 *    es un aviso de que hay que reclasificarla a `candado`. Un agujero que solo
 *    vive en un informe se pudre; aquí se vuelve a medir cada vez.
 *
 *  Y funcionó a la primera: de los cuatro agujeros que QA encontró el
 *  2026-09-01, TRES se cerraron ese mismo día y este script los cazó cambiados
 *  de estado (`🔵 CAMBIÓ`, exit 1) antes de que nadie tocara el informe —
 *  la cuarta boca (`cerrado-espera-que-aterriza-tarde`, más su hermana
 *  `en-vuelo-tras-el-drenaje`), la sonda rota bajo un negativo
 *  (`cerrado-sonda-rota-en-negativo`) y el motivo de relleno
 *  (`cerrado-motivo-de-relleno`). Las claves conservan el fragmento por el que
 *  las cita `qa.md`, para que sus comandos de reproducción sigan valiendo.
 *  Sigue abierto UNO, declarado: `hallazgo-espera-fuera-del-libro`.
 *
 *      node qa/esperas-candados-en-negativo.mjs
 *      node qa/esperas-candados-en-negativo.mjs finally   # solo los que casen
 *
 *  Verde = el candado sujeta lo que dice sujetar y los agujeros conocidos
 *          siguen siendo exactamente esos, ni uno más.
 *  Rojo  = o una forma de tragarse una espera volvió a salir verde, o un
 *          agujero conocido cambió de estado sin que nadie actualizara esto.
 *
 *  AVISO: escribe guiones temporales en `qa/guiones/` y los borra al terminar
 *  (también si algo falla). Se niega a arrancar si encuentra restos de una
 *  corrida anterior, porque entonces no sabría cuáles son suyos.
 */
import { writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUIONES = join(raiz, "qa", "guiones");
/** Prefijo de los ficheros temporales. Largo y feo a propósito: es lo que se
 *  busca para detectar restos, y no puede colisionar con un guion de verdad. */
const PREFIJO = "zzz-espera-en-negativo-";

const SIN_MOTOR =
  'export const sinMotor = "sonda del libro de esperas (#261): no le pide nada al motor";\n';

/** [clave, clase, veredictoEsperado, quéDemuestra, cuerpo, huella?]
 *
 *  `veredictoEsperado` es el icono del resumen de `run.mjs`: ✔ verde · ✘ rojo ·
 *  ⊘ sin medir. `huella` (opcional) es lo que el veredicto tiene que NOMBRAR:
 *  un rojo genérico no vale, igual que en la batería hermana — el rojo que no
 *  se puede diagnosticar cuesta la misma investigación que uno de verdad. */
const CASOS = [
  [
    "try-catch-a-pelo",
    "candado",
    "✘",
    "un `try/catch` a pelo sobre una espera: la boca más obvia que no está en la lista de tres",
    `  try {
    await ctx.waitFor("condición imposible tragada por un try/catch a pelo", () => null, 600);
  } catch {
    /* me la trago */
  }
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
    /expiró.*nadie la observó/,
  ],
  [
    "finally-que-devuelve",
    "candado",
    "✘",
    "un `finally` que devuelve: se traga la excepción sin escribir un solo `catch`",
    `  const v = await (async () => {
    try {
      return await ctx.waitFor("condición imposible tragada por un finally que devuelve", () => null, 600);
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      return null;
    }
  })();
  ctx.expect("el guion sigue vivo y afirma algo trivial", v === null);`,
    /expiró.*nadie la observó/,
  ],
  [
    "promise-all-dos-esperas",
    "candado",
    "✘",
    "dos esperas en un `Promise.all`: la que pierde la carrera también tiene que contarse",
    `  await Promise.all([
    ctx.waitFor("imposible A dentro de Promise.all", () => null, 600),
    ctx.waitFor("imposible B dentro de Promise.all", () => null, 600),
  ]).catch(() => null);
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
    // LAS DOS, y sin margen: la hermana que pierde la carrera sigue en vuelo
    // cuando el guion vuelve, y es el drenaje del runner el que la deja
    // posarse. Hasta el 2026-09-01 este caso necesitaba un `waitForSelector`
    // de 2 s para que el candado viera la segunda; ahora no.
    /imposible A dentro de Promise\.all[\s\S]*imposible B dentro de Promise\.all|imposible B dentro de Promise\.all[\s\S]*imposible A dentro de Promise\.all/,
  ],
  [
    "absorbe-no-absorbe-de-mas",
    "candado",
    "✘",
    "un `absorbe` que envuelve DOS esperas solo consume la que sale por su boca, no el bloque entero",
    `  await ctx.absorbe(
    "el motivo habla de la SEGUNDA espera; la primera se traga dentro del bloque",
    async () => {
      try {
        await ctx.waitFor("primera imposible, tragada DENTRO del absorbe", () => null, 500);
      } catch {
        /* tragada */
      }
      await ctx.waitFor("segunda imposible, la que el motivo dice cubrir", () => null, 500);
    },
  );
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
    /primera imposible, tragada DENTRO del absorbe/,
  ],
  [
    "control-absorbe-legitimo",
    "candado",
    "✔",
    "CONTROL: un `absorbe` de una sola espera SÍ sale verde — un candado que pusiera todo rojo no candaría nada",
    `  await ctx.absorbe(
    "cortafuegos de un tramo; la medida vive en el aserto de abajo",
    () => ctx.waitFor("imposible absorbida correctamente", () => null, 600),
  );
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
  ],
  [
    "control-expect-espera-negativa",
    "candado",
    "✔",
    "CONTROL: el negativo deliberado (`debeOcurrir:false`) sigue siendo legal y verde",
    `  await ctx.expectEspera(
    "el jugador atraviesa un muro que no existe",
    false,
    () => null,
    { ms: 600, aserto: "el jugador NO atraviesa nada" },
  );`,
  ],
  [
    "control-catch-que-mata-sigue-matando",
    "candado",
    "✘",
    "CONTROL: los 55 `.catch(() => null)` que el plan deja fuera (su null lo mata el aserto de abajo) siguen matando, y ahora suman la línea del libro",
    `  const v = await ctx.waitFor("imposible que el aserto de abajo exige", () => null, 600).catch(() => null);
  ctx.expect("el aserto de siempre exige el valor degradado y no lo tiene", Boolean(v));`,
    // Las DOS líneas, y en este orden: el aserto de siempre durante el guion, y
    // la del libro al cerrar. Es el «fallo doble» que §8 del plan acepta.
    /✘ el aserto de siempre exige el valor degradado[\s\S]*✘ la espera «imposible que el aserto de abajo exige»/,
  ],
  [
    // Era `hallazgo` el 2026-09-01 y se cerró ese mismo día: antes de leer el
    // libro, el runner deja POSARSE a las esperas que el guion no esperó
    // (`DRENAJE_DE_ESPERAS_MS` en qa/run.mjs). Se conserva la clave para que
    // los comandos de reproducción de `qa.md` (`… mjs aterriza`) sigan valiendo.
    "cerrado-espera-que-aterriza-tarde",
    "candado",
    "✘",
    "LA CUARTA BOCA (cerrada): una espera que no se espera (fire-and-forget) se posa antes del veredicto y se cuenta",
    `  void ctx.waitFor("expiración que aterriza después del veredicto", () => null, 600).catch(() => null);
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
    /expiró.*nadie la observó/,
  ],
  [
    // La otra mitad del arreglo: la que NO se posa dentro del margen. Con
    // 240 s de cortafuegos el drenaje no la espera —no puede—, y entonces la
    // que cuenta es ella misma: nadie la esperó, así que no decidió nada.
    "en-vuelo-tras-el-drenaje",
    "candado",
    "✘",
    "una espera suelta que ni siquiera se posa en el margen del drenaje es un fallo por sí misma",
    `  void ctx.waitFor("espera suelta con un cortafuegos larguísimo", () => null, 240_000).catch(() => null);
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
    /SEGUÍA EN VUELO/,
  ],
  [
    // Cerrado el 2026-09-01: `waitFor` cuenta los sondeos y los que rompió la
    // página, y `expectEspera` se niega a AFIRMAR un negativo que no llegó a
    // mirar ni una vez. Clave conservada: `… mjs sonda-rota` sigue valiendo.
    "cerrado-sonda-rota-en-negativo",
    "candado",
    "✘",
    "familia D con la SONDA ROTA (cerrado): «no ocurrió» y «no llegué a mirar» ya no son lo mismo",
    `  await ctx.expectEspera(
    "el jugador atraviesa el muro (con la sonda rota a propósito)",
    false,
    () => {
      throw new Error("la sonda está rota: window.__nefan.noExiste");
    },
    { ms: 900, aserto: "el jugador NO atraviesa la huella del edificio" },
  );`,
    /NO SE MIDIÓ: la sonda no llegó a evaluarse/,
  ],
  [
    "hallazgo-espera-fuera-del-libro",
    "hallazgo",
    "✔",
    "una espera que no es `ctx.waitFor` (page.waitForSelector, esperarPartidaEnDisco) no entra en el libro",
    `  await ctx.page.waitForSelector("#esto-no-existe-jamas", { timeout: 800 }).catch(() => null);
  const { esperarPartidaEnDisco } = await import("../lib/saves.mjs");
  await esperarPartidaEnDisco(ctx, "sesion-que-no-existe-jamas", 800).catch(() => null);
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
  ],
  [
    // Cerrado el 2026-09-01 con una criba deliberadamente modesta
    // (`quejaDelMotivo`): no distingue una frase honesta de una elaborada —eso
    // lo hace la revisión del diff— pero sí rechaza el GESTO REFLEJO, que es lo
    // que QA midió pasando. Clave conservada: `… mjs motivo-de-relleno`.
    "cerrado-motivo-de-relleno",
    "candado",
    "✘",
    "la criba de `absorbe` rechaza el gesto reflejo: «x» y un nombre de fichero ya no pasan (riesgo §8 del plan)",
    `  await ctx.absorbe("x", () => ctx.waitFor("imposible con motivo de relleno", () => null, 500));
  await ctx.absorbe("41-el-jugador-puede-pelear.mjs", () =>
    ctx.waitFor("imposible con motivo que nombra un fichero", () => null, 500),
  );
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
    /absorbe exige el MOTIVO/,
  ],
  [
    "bloque-declarado-degrada-a-circulo",
    "candado",
    "⊘",
    "un `sinMedirBloque` sobre OTRA cosa convierte el rojo de la espera tragada en ⊘ (exit 2, no verde)",
    `  try {
    await ctx.waitFor("condición imposible tragada, ajena al bloque declarado", () => null, 600);
  } catch {
    /* tragada */
  }
  ctx.sinMedirBloque("otro bloque cualquiera, que no tiene nada que ver con la espera de arriba");
  ctx.expect("el guion sigue vivo y afirma algo trivial", true);`,
    // La huella NO es opcional aquí: el ⊘ lo produce `sinMedirBloque` por su
    // cuenta, así que sin exigir la línea del libro esta entrada seguiría
    // «pasando» con el candado desactivado — un verde que no comprueba nada.
    // Lo que se verifica es que la pendiente SE IMPRIME como detalle del ⊘.
    /⊘ la espera «condición imposible tragada, ajena al bloque declarado»/,
  ],
];

const filtro = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const casa = (clave, que) =>
  filtro.length === 0 || filtro.some((f) => `${clave} ${que}`.toLowerCase().includes(f.toLowerCase()));

const elegidos = CASOS.filter(([clave, , , que]) => casa(clave, que));
if (elegidos.length === 0) {
  console.error("No hay casos que casen con:", filtro.join(", "));
  process.exit(2);
}

// Restos de una corrida anterior: si los hubiera, no sabríamos cuáles son
// nuestros y borraríamos trabajo ajeno.
const restos = readdirSync(GUIONES).filter((f) => f.startsWith(PREFIJO));
if (restos.length) {
  console.error(`✖ hay restos de una corrida anterior en qa/guiones/: ${restos.join(", ")}`);
  console.error("  bórralos a mano y vuelve a lanzar: este script no borra lo que no ha escrito él.");
  process.exit(2);
}

const escritos = [];
const limpia = () => {
  for (const f of escritos) if (existsSync(f)) rmSync(f);
};

let salida = "";
try {
  for (const [clave, , , que, cuerpo] of elegidos) {
    const f = join(GUIONES, `${PREFIJO}${clave}.mjs`);
    writeFileSync(
      f,
      `/** SONDA TEMPORAL de qa/esperas-candados-en-negativo.mjs — ${que} */\n` +
        SIN_MOTOR +
        `export default async function (ctx) {\n${cuerpo}\n}\n`,
    );
    escritos.push(f);
  }
  const r = spawnSync("node", [join(raiz, "qa/run.mjs"), PREFIJO], {
    cwd: raiz,
    encoding: "utf8",
    timeout: 900_000,
  });
  salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
} finally {
  limpia();
}

// Los ficheros tienen que haber desaparecido: esto escribe en el árbol de otro.
const sobran = readdirSync(GUIONES).filter((f) => f.startsWith(PREFIJO));
if (sobran.length) {
  console.error(`\n✖ NO SE LIMPIARON ${sobran.join(", ")} — bórralos antes de seguir`);
  process.exit(2);
}

/** El veredicto de cada guion, leído del resumen final de `run.mjs`. */
const veredictos = new Map(
  [...salida.matchAll(/^([✔✘⊘]) (\S+)/gm)].map((m) => [m[2], m[1]]),
);

const fallidos = [];
const cambiados = [];
console.log();
for (const [clave, clase, esperado, que, , huella] of elegidos) {
  const nombre = `${PREFIJO}${clave}`;
  const visto = veredictos.get(nombre);
  const nombra = !huella || huella.test(salida);
  const ok = visto === esperado && nombra;
  let etiqueta;
  if (ok && clase === "candado") etiqueta = esperado === "✔" ? "🟢 control" : `🔴 ${esperado}      `;
  else if (ok) etiqueta = "⚠️  agujero";
  else if (clase === "hallazgo") etiqueta = "🔵 CAMBIÓ ";
  else etiqueta = "🟢 VERDE  ";
  console.log(`${etiqueta}  ${clave} — ${que}`);
  if (!ok) {
    if (visto === undefined) console.log(`     ⚠️  el guion no aparece en el resumen de run.mjs`);
    else if (visto !== esperado) console.log(`     ⚠️  salió «${visto}» y se esperaba «${esperado}»`);
    else console.log(`     ⚠️  salió «${visto}» pero NO nombra la causa (${huella})`);
    (clase === "hallazgo" ? cambiados : fallidos).push(clave);
  }
}

console.log(`\n${"─".repeat(70)}`);
console.log(`Casos probados                : ${elegidos.length}`);
console.log(`Candados que sujetan          : ${elegidos.filter(([c, k]) => k === "candado" && !fallidos.includes(c)).length}`);
console.log(`Candados que NO sujetan       : ${fallidos.length}`);
for (const f of fallidos) console.log(`   🟢 ${f}`);
console.log(`Agujeros conocidos, sin cambio: ${elegidos.filter(([c, k]) => k === "hallazgo" && !cambiados.includes(c)).length}`);
console.log(`Agujeros que CAMBIARON        : ${cambiados.length}`);
for (const c of cambiados) console.log(`   🔵 ${c} — se cerró (o cambió de forma): reclasifícalo a «candado»`);

if (fallidos.length) {
  console.error("\n✖ hay una forma de tragarse una espera que vuelve a acabar en verde");
  process.exit(1);
}
if (cambiados.length) {
  console.error("\n✖ un agujero conocido cambió de estado: actualiza este fichero y el informe de QA");
  process.exit(1);
}
console.log("\n✔ el libro de esperas sujeta lo que dice sujetar, y sus agujeros son los declarados");
