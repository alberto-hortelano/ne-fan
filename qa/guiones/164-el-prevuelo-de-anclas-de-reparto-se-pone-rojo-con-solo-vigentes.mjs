/** El pre-vuelo de ANCLAS de `mutacion-reparto-en-lotes.mjs` se pone ROJO con
 *  `--solo-vigentes`, que es como lo corre CI (#700, QA de la tanda AM).
 *
 *  POR QUÉ EXISTE. #700 tenía dos mitades. La primera —que el `buscar` de los
 *  guiones en negativo exija `veces === 1`— la mide `qa/lib/anclas.mjs` con
 *  `nefan-core/test/las-anclas-de-los-candados.test.ts`, y ahí un test de
 *  función basta. La segunda es un CABLE, y un test de función no la ve: que
 *  `reparto` cuente las anclas de sus nueve `rompe` ANTES de los vigentes y
 *  FUERA del `if (!soloVigentes)`, porque CI lo corre con `--solo-vigentes`
 *  (`.github/workflows/ci.yml`) y ese modo no llega nunca al bucle de
 *  `ABIERTOS`. Si alguien mueve el pre-vuelo dentro del `if`, o deja de sumar
 *  `anclasRotas` al veredicto, `npm test` sigue verde, el guion sigue verde en
 *  CI, y el ancla podrida se descubre el día que alguien pague la corrida
 *  completa de ~11 min — que es exactamente la enfermedad que #700 vino a curar.
 *
 *  CÓMO. Corre `reparto --solo-vigentes` cuatro veces: limpio (verde, «los N
 *  patrones aparecen una vez cada uno»), y con las TRES formas del issue —
 *  duplicado en un fichero que `cableado` rompe (forma 1), duplicado en uno que
 *  `cableado` no rompe (forma 2) y patrón ausente— exigiendo cada vez exit 1,
 *  «PROBE OBSOLETO» nombrando al probe y a su fichero con «aparece N veces», la
 *  cuenta «Probes con el patrón obsoleto : 1 de N», el motivo en el veredicto,
 *  y NINGÚN «SIN CANDADO»: el hallazgo inventado de la forma 1 (`fusionar`
 *  acusado de haberse quedado sin candado, #420 «reabierto») era el síntoma
 *  medido en la QA de #605 y es lo que no tiene que volver.
 *
 *  Los duplicados se ponen en un COMENTARIO DE BLOQUE al final del fichero, no
 *  como segunda línea de código: duplicar un `const` no compila, y entonces
 *  los vigentes que ejecutan la herramienta se ponen rojos POR OTRA COSA
 *  (medido: «6 de 11» al duplicar la línea tal cual) y el rojo del pre-vuelo
 *  deja de estar solo. Para el pre-vuelo un patrón en un comentario es tan
 *  duplicado como uno en código —cuenta texto—, que es justo lo que hay que
 *  demostrar: que se ve ANTES de que nada se ejecute.
 *
 *  Toma el turno «rompe-fuentes» y `reparto` lo HEREDA por `NEFAN_QA_TURNO`
 *  (`qa/lib/turno-exclusivo.mjs`): entre escribir el sabotaje y arrancar el
 *  subproceso no hay ventana en que otra corrida pueda fotografiar el fichero
 *  roto y «restaurarlo» como si fuera el original.
 *
 *      node qa/run.mjs 164              # con el resto de la clase headless
 *      node qa/run.mjs --sin-navegador  # todos los que no abren Chromium
 *
 *  AVISO: escribe en el árbol de trabajo. Se niega a arrancar si los tres
 *  ficheros que va a tocar vienen sucios, porque entonces no puede devolverlos.
 *  Cuesta ~30 s: cuatro arranques de `reparto --solo-vigentes` (3-10 s cada uno).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

/** El guardarraíl de gasto: reescribe tres ficheros y corre un guion headless
 *  en un subproceso; no abre partida ni habla con el motor. */
export const sinMotor = "sabotea fuentes de nefan-core y corre `mutacion-reparto-en-lotes.mjs --solo-vigentes` en un subproceso; no abre partida ni habla con el motor";
/** Ni página: el sujeto es la salida y el exit de otro guion de `qa/`. */
export const sinNavegador = "corre un guion headless de qa/ en un subproceso y afirma sobre su exit y su salida; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const GUION = join(RAIZ, "qa", "mutacion-reparto-en-lotes.mjs");
const YML = join(RAIZ, ".github", "workflows", "ci.yml");

const LOTES = join(CORE, "scripts", "mutacion-lotes.ts");
const REPO = join(CORE, "scripts", "mutacion-repo.ts");
const PLAN = join(CORE, "data", "contract", "mutation-targets.json");
const FICHEROS = [LOTES, REPO, PLAN];

/** El texto que el pre-vuelo tiene que decir, por forma. Los `buscar` son los
 *  MISMOS que los `rompe` de `reparto`: si uno de ellos cambia allí y aquí no,
 *  el sabotaje de aquí deja de ser un duplicado y este guion lo dice (el limpio
 *  seguiría verde, pero la forma saldría con «no se puso rojo»). */
const SABOTAJES = [
  {
    nombre: "forma 1 · duplicado en un fichero que `cableado` rompe (mutacion-lotes.ts)",
    fichero: LOTES,
    duplica: "    const errores = verificaDescarga(parcial, presentes);",
    probe: "fusión · `fusionar` deja de verificar el SELLO de cada lote (#420 reabierto)",
    veces: 2,
  },
  {
    nombre: "forma 2 · duplicado en un fichero que `cableado` NO rompe (mutacion-repo.ts)",
    fichero: REPO,
    duplica: "  return medidos.length === 0 ? undefined : Math.max(...medidos);",
    probe: "reloj · `segundosDe` suma las filas del módulo en vez de coger el MÁXIMO",
    veces: 2,
  },
  {
    nombre: "ausente · el patrón ya no está (mutation-targets.json)",
    fichero: PLAN,
    quita: ['"tope_lote": 1800,', '"tope_lote":1800,'],
    probe: "presupuesto · `tope_lote` sube por encima del `timeout-minutes` del job",
    veces: 0,
  },
];

/** Corre `reparto --solo-vigentes` y devuelve exit, salida y segundos. */
function corre() {
  const t0 = Date.now();
  const r = spawnSync("node", [GUION, "--solo-vigentes"], { cwd: RAIZ, encoding: "utf8" });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { codigo: r.status, salida, segundos: ((Date.now() - t0) / 1000).toFixed(1) };
}

export default async function (ctx) {
  // Se niega sobre un árbol sucio: restaurar al contenido de ANTES borraría lo
  // que hubiera sin commitear.
  const sucio = spawnSync("git", ["status", "--porcelain", "--", ...FICHEROS.map((f) => relative(RAIZ, f))], {
    cwd: RAIZ,
    encoding: "utf8",
  });
  if ((sucio.stdout ?? "").trim()) {
    ctx.expect(
      "los ficheros que este guion reescribe vienen limpios",
      false,
      `hay cambios sin commitear:\n${sucio.stdout.trim()}\n  commitéalos o guárdalos: este guion restaura al contenido del disco de ANTES de arrancar`,
    );
    return;
  }

  // LA PREMISA: CI corre `reparto` con `--solo-vigentes`. Si deja de ser así,
  // lo que este guion mide sigue siendo cierto pero ya no es lo que protege.
  const yml = readFileSync(YML, "utf8");
  ctx.expect(
    "CI corre `mutacion-reparto-en-lotes.mjs --solo-vigentes` (la premisa de este guion)",
    /^\s*- run: node qa\/mutacion-reparto-en-lotes\.mjs --solo-vigentes\s*$/m.test(yml),
    "ci.yml ya no tiene ese paso tal cual: mira si el pre-vuelo sigue teniendo quien lo corra en cada PR",
  );

  // EL TURNO antes de la foto, y el subproceso lo hereda por NEFAN_QA_TURNO.
  turnoDeCandados("rompe-fuentes");
  const original = new Map(FICHEROS.map((f) => [f, readFileSync(f, "utf8")]));
  const restaura = () => {
    for (const [f, txt] of original) writeFileSync(f, txt);
  };
  for (const [señal, codigo] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.on(señal, () => {
      restaura();
      process.exit(codigo);
    });
  }

  try {
    // ── LIMPIO: verde, y el pre-vuelo DICE que contó ────────────────────────
    const limpio = corre();
    ctx.log(`  · limpio: exit ${limpio.codigo} en ${limpio.segundos} s`);
    const conteo = /^✔ los (\d+) patrones aparecen una vez cada uno$/mu.exec(limpio.salida);
    ctx.expect(
      "sobre el árbol limpio `reparto --solo-vigentes` sale 0 y el pre-vuelo cuenta los patrones",
      limpio.codigo === 0 && conteo !== null,
      limpio.codigo !== 0 ? `exit ${limpio.codigo}:\n${limpio.salida.slice(-1500)}` : "no dice «los N patrones aparecen una vez cada uno»: ¿se quitó el pre-vuelo?",
    );
    ctx.expect(
      "y el resumen trae la línea de probes obsoletos a cero",
      /^Probes con el patrón obsoleto\s*: 0 de \d+$/mu.test(limpio.salida),
      "falta «Probes con el patrón obsoleto : 0 de N» en el resumen con --solo-vigentes",
    );
    if (limpio.codigo !== 0 || conteo === null) return;
    const total = Number(conteo[1]);

    // ── LAS TRES FORMAS: rojo, con nombre, sin hallazgo inventado ───────────
    for (const s of SABOTAJES) {
      restaura();
      const texto = original.get(s.fichero);
      let roto;
      if (s.duplica !== undefined) {
        // Copia en un comentario de bloque al final: compila igual, y para el
        // recuento por texto es un duplicado.
        if (texto.split(s.duplica).length - 1 !== 1) {
          ctx.expect(`${s.nombre}: el patrón que se duplica está hoy una vez en el fichero`, false, "el «rompe» de reparto y este guion ya no apuntan al mismo sitio: actualízalo");
          continue;
        }
        roto = `${texto}\n/* copia sintética para el guion 164 (#700):\n${s.duplica}\n*/\n`;
      } else {
        const [buscar, poner] = s.quita;
        if (texto.split(buscar).length - 1 !== 1) {
          ctx.expect(`${s.nombre}: el patrón que se quita está hoy una vez en el fichero`, false, "el «rompe» de reparto y este guion ya no apuntan al mismo sitio: actualízalo");
          continue;
        }
        roto = texto.split(buscar).join(poner);
      }
      writeFileSync(s.fichero, roto);
      const r = corre();
      ctx.log(`  · ${s.nombre}: exit ${r.codigo} en ${r.segundos} s`);

      const cabecera = new RegExp(`^✖ PROBE OBSOLETO  ${s.probe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "mu");
      const detalle = new RegExp(`^\\s+${relative(RAIZ, s.fichero).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: aparece ${s.veces} veces → «`, "mu");
      ctx.expect(
        `${s.nombre} → exit 1`,
        r.codigo === 1,
        r.codigo === 0 ? `VERDE CON EL PATRÓN ${s.veces === 0 ? "AUSENTE" : "DUPLICADO"}: el pre-vuelo no se enteró\n${r.salida.slice(-1200)}` : `exit ${r.codigo}:\n${r.salida.slice(-1200)}`,
      );
      ctx.expect(
        `${s.nombre} → «PROBE OBSOLETO» nombra al probe`,
        cabecera.test(r.salida),
        `no aparece «✖ PROBE OBSOLETO  ${s.probe}»\n${r.salida.slice(0, 1200)}`,
      );
      ctx.expect(
        `${s.nombre} → dice el fichero y «aparece ${s.veces} veces»`,
        detalle.test(r.salida),
        `no aparece «${relative(RAIZ, s.fichero)}: aparece ${s.veces} veces → …»`,
      );
      ctx.expect(
        `${s.nombre} → el resumen cuenta 1 de ${total} y el veredicto da el motivo`,
        new RegExp(`^Probes con el patrón obsoleto\\s*: 1 de ${total}$`, "mu").test(r.salida) &&
          r.salida.includes("hay probes cuyo patrón no aparece una sola vez: no prueban lo que dicen"),
        "falta la línea del resumen o el motivo del veredicto",
      );
      ctx.expect(
        `${s.nombre} → NINGÚN hallazgo inventado («SIN CANDADO»)`,
        !r.salida.includes("SIN CANDADO"),
        "el guion sigue acusando a un invariante sano de haberse quedado sin candado (la forma 1 de #700, #605)",
      );
    }
  } finally {
    restaura();
  }

  const noRestaurados = FICHEROS.filter((f) => readFileSync(f, "utf8") !== original.get(f)).map((f) => relative(RAIZ, f));
  ctx.expect(
    "los tres ficheros vuelven a estar byte a byte como estaban",
    noRestaurados.length === 0,
    `NO SE RESTAURÓ: ${noRestaurados.join(", ")} — revísalo con git diff antes de seguir`,
  );
}
