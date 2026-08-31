#!/usr/bin/env node
/** ¿Se pueden poner ROJOS los guiones que esta batería usa como instrumento?
 *
 *  Hermano de `qa/contrato-candados-en-negativo.mjs` y de
 *  `qa/mutacion-candados-en-negativo.mjs`, y vive fuera de `qa/guiones/` por la
 *  misma razón: `run.mjs` carga TODO `.mjs` de esa carpeta y lo conduce contra
 *  el navegador. Esto no es un guion, es lo que se ejecuta PARA COMPROBAR los
 *  guiones — y cuesta una corrida de guion por invariante, así que va bajo
 *  demanda y no en `npm run verify`.
 *
 *  POR QUÉ EXISTE. La tanda de #308/#320 cierra dos issues cuya enfermedad era
 *  «algo dice hecho sin saberlo»: un hook que decía haber cargado la fixture sin
 *  esperarla, y un control que decía «las cuatro teclas responden» midiendo un
 *  neto que se cancela solo. Dejar la demostración de esos dos arreglos en
 *  prosa —dentro de un `implementacion.md` que ni se commitea— sería repetir la
 *  enfermedad un piso más arriba. Aquí se rompe el fuente a propósito, se corre
 *  SU guion y se exige rojo; y se vuelve a demostrar cada vez que alguien lo
 *  ejecute, que es la diferencia entre una prueba y una afirmación.
 *
 *  Los dos invariantes, y por qué NO valía repetir la batería:
 *
 *  · **#308 · `loadFixture` devuelve su promesa.** Sin esto el guion 22 medía la
 *    escena ANTERIOR; y no de vez en cuando: la corrida verde del 2026-08-30
 *    imprimió «57 calcos» para las dos fixtures, o sea que midió el puerto dos
 *    veces y afirmó tres cosas sobre campo abierto. Repetir la batería no lo
 *    caza — ese día salió 6 de 6 verde en solitario mientras la sonda lo ponía
 *    rojo 2 de 4 en la misma máquina ociosa. Lo que lo caza es la COMPUERTA del
 *    bloque 3 (`qa/lib/fixtures.mjs`), que retiene el JSON en el borde de la
 *    red: con la respuesta retenida el módulo no PUEDE haber llegado.
 *    Va DOS VECES, contra el 22 y contra el 44, y no es redundancia: el
 *    destrozo rompe todas las cargas, así que el 22 se para en la PRIMERA
 *    fixture y el camino que de verdad falló —la segunda medida como la
 *    primera— solo lo ejerce el 44, cuya precondición espera en vez de afirmar.
 *
 *  · **#320 · el control del 34 mide por tecla.** Con `w a s d` medidas solo por
 *    los extremos, `w` se cancelaba con `s` y `a` con `d`: el neto era un
 *    residuo del 1-15 % y el guion pasaba VERDE con tres de las cuatro teclas
 *    muertas. Aquí se mata UNA, que es el caso difícil.
 *
 *      node qa/bateria-candados-en-negativo.mjs
 *      node qa/bateria-candados-en-negativo.mjs 320   # solo los que casen
 *
 *  Verde = los dos guiones se ponen rojos al romper lo que dicen defender, y el
 *          rojo nombra la causa.
 *  Rojo  = hay un guion que no comprueba lo que dice; el nombre lo dice.
 *
 *  AVISO: escribe en el árbol de trabajo. Se niega a arrancar si los ficheros
 *  que va a tocar ya vienen sucios, porque entonces no puede devolverlos.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

const MAIN = join(raiz, "nefan-html/src/main.ts");
const TECLADO = join(raiz, "nefan-html/src/input/keyboard-input-provider.ts");

/** [nombre, fichero, guion, [ [buscar, poner], … ], huella, codigoEsperado? ]
 *
 *  `buscar` tiene que aparecer EXACTAMENTE una vez: si el código se mueve, el
 *  candado deja de apuntar a donde cree y esto lo dice en vez de dar un falso
 *  verde. `huella` es lo que el veredicto tiene que NOMBRAR — un rojo genérico
 *  no vale: el defecto de #308 ya se manifestaba como un aserto de telegraph
 *  fallando tres pasos más abajo, que es justo lo que no se puede diagnosticar.
 *
 *  `codigoEsperado` (defecto 1, rojo) existe por el canal `⊘` de #331: hay
 *  candados cuyo desenlace correcto NO es un rojo sino un ⊘ declarado, y el
 *  runner sale con 2 ante cualquier ⊘. Un 2 que NO se esperaba sigue contando
 *  como «la corrida no midió», nunca como éxito.
 */
const INVARIANTES = [
  [
    "#308 · `loadFixture` vuelve a ser fire-and-forget (dice «hecho» sin esperar la fixture)",
    MAIN,
    "22-telegraph",
    [
      [
        "      const carga = ultimaCargaDeFixture;\n",
        "      const carga = Promise.resolve();\n      void ultimaCargaDeFixture;\n",
      ],
    ],
    /se pidió la fixture|no había llegado|se quedó en/i,
  ],
  // El MISMO destrozo, contra el guion que sí ejerce el camino original de #308.
  // Lo pidió QA el 2026-08-30 y tiene razón: con `loadFixture` roto para TODAS
  // las cargas, el 22 muere en su bloque 1 —la PRIMERA fixture— y la segunda,
  // que es donde vivía el bug, no se llega a pedir. O sea que este script
  // demostraba que el 22 caza *una* regresión del hook, no que cace LA de #308;
  // y el día que alguien deje el 22 con una sola fixture seguiría verde sin
  // avisar. El guion 44 sí lo ejerce: su precondición espera (no afirma) a
  // propósito, así que la primera carga sobrevive al destrozo y lo que se pone
  // rojo es el INSTANTE de la segunda.
  [
    "#308 · el mismo destrozo contra el guion que ejerce la SEGUNDA carga (el camino original)",
    MAIN,
    "44-la-carga",
    [
      [
        "      const carga = ultimaCargaDeFixture;\n",
        "      const carga = Promise.resolve();\n      void ultimaCargaDeFixture;\n",
      ],
    ],
    // Anclada al ✘: «sigue PENDIENTE» es parte de la descripción del aserto y
    // se imprime también en verde. Una huella que casa en las dos direcciones
    // no distingue nada, que es el defecto que este script persigue.
    /✘[^\n]*sigue PENDIENTE/,
  ],
  // ¿La migración de #332 COMPRÓ algo? El mismo destrozo del hook, contra un
  // guion migrado en esta pasada (el 01, que antes esperaba por su cuenta con
  // `status().scene` — una espera que este destrozo NO pone roja, porque
  // acaba cumpliéndose sola). Con `cargarFixture` la afirmación corre detrás
  // de la promesa rota y el rojo NOMBRA la escena que había.
  [
    "#308 · el mismo destrozo contra un guion MIGRADO en esta pasada (#332: la migración compra algo)",
    MAIN,
    "01-arranque",
    [
      [
        "      const carga = ultimaCargaDeFixture;\n",
        "      const carga = Promise.resolve();\n      void ultimaCargaDeFixture;\n",
      ],
    ],
    /se pidió la fixture|se quedó en/i,
  ],
  // El canal ⊘ de #331, probado por sus DOS caras contra el guion 34 — el
  // usuario natural del verbo (su precondición es que el selector ofrezca la
  // fixture donde están medidos sus márgenes).
  //
  // Cara 1: precondición rota → el guion DECLARA y sale ⊘ con su motivo (el
  // runner degrada la corrida a exit 2, que es el precedente de `:954-957`:
  // «esta corrida NO es un veredicto del juego»). Hasta #331 esto solo podía
  // salir rojo (mintiendo sobre QUÉ está roto) o verde.
  [
    "#331 · precondición rota → el guion declara ⊘ con su motivo, no un rojo que miente",
    join(raiz, "qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs"),
    "34-con-el-titulo",
    [['const FIXTURE = "puerto_tile";\n', 'const FIXTURE = "puerto_tile_inexistente";\n']],
    /declarado por el guion.*puerto_tile_inexistente/,
    2,
  ],
  // Cara 2: un guion que YA empujó fallos NO puede reconvertirse a ⊘ — un ⊘
  // es una declaración, no una amnistía. El cebo se inyecta ANTES de la
  // precondición rota: el runner tiene que vetar la reconversión y dejar el
  // guion en ROJO (exit 1, el defecto de `codigoEsperado`).
  [
    "#331 · con fallos ya empujados, sinMedir NO reconvierte: el rojo se queda",
    join(raiz, "qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs"),
    "34-con-el-titulo",
    [
      ['const FIXTURE = "puerto_tile";\n', 'const FIXTURE = "puerto_tile_inexistente";\n'],
      [
        "  const opcion = await ctx.page.evaluate((f) => {\n",
        '  ctx.expect("cebo inyectado por la batería de candados (debe vetar la reconversión)", false);\n' +
          "  const opcion = await ctx.page.evaluate((f) => {\n",
      ],
    ],
    /no puede reconvertirse|amnistía/,
  ],
  [
    "#320 · muere UNA sola tecla de movimiento (`a`) en el proveedor de teclado",
    TECLADO,
    "34-con-el-titulo",
    [
      ['        case "a": this.state.left = true; break;\n', ""],
      ['        case "a": this.state.left = false; break;\n', ""],
    ],
    /NO RESPONDEN: «a»/,
  ],
];

/** Corre UN guion de la batería y devuelve su veredicto y su salida.
 *
 *  Código de salida del runner: 0 verde · 1 hay rojos y todos midieron · 2 algo
 *  no llegó a medir. El 2 NO cuenta como rojo: una corrida que no midió no dice
 *  nada del juego, y contarla como éxito de este script sería el mismo pecado
 *  que viene a cerrar. */
function corre(guion) {
  const r = spawnSync("node", [join(raiz, "qa/run.mjs"), guion], {
    cwd: raiz,
    encoding: "utf8",
    timeout: 900_000,
  });
  return { codigo: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Las líneas del rojo, para poder enseñar POR QUÉ falló. */
function motivos(salida) {
  return [...salida.matchAll(/^\s+[·✘] (.+)$/gm)].map((m) => m[1].trim());
}

const filtro = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const casa = (n) => filtro.length === 0 || filtro.some((f) => n.toLowerCase().includes(f.toLowerCase()));

const FICHEROS = [...new Set(INVARIANTES.map(([, f]) => f))];

// Se niega a arrancar sobre un árbol sucio: si el fichero ya trae cambios, la
// restauración de este guion los borraría. Es la única forma de que escribir en
// el árbol de otro sea seguro.
const sucio = spawnSync("git", ["status", "--porcelain", "--", ...FICHEROS.map((f) => relative(raiz, f))], {
  cwd: raiz,
  encoding: "utf8",
});
if ((sucio.stdout ?? "").trim()) {
  console.error("✖ hay cambios sin commitear en los ficheros que este guion reescribe:");
  console.error(sucio.stdout);
  console.error("  commitéalos o guárdalos antes: este guion restaura al contenido del disco de ANTES de arrancar,");
  console.error("  y si algo lo interrumpiera a mitad, los perderías.");
  process.exit(2);
}

const original = new Map(FICHEROS.map((f) => [f, readFileSync(f, "utf8")]));
const restaura = () => {
  for (const [f, txt] of original) writeFileSync(f, txt);
};

const fallidos = [];
const obsoletos = [];
const sinMedir = [];
try {
  // Base: si un guion YA está rojo, cualquier "rojo" de después sería el rojo de
  // otra cosa — que es justo el error que este script existe para no cometer.
  const guiones = [...new Set(INVARIANTES.filter(([n]) => casa(n)).map(([, , g]) => g))];
  console.log("Base (nada roto):");
  let baseMala = false;
  for (const g of guiones) {
    const r = corre(g);
    console.log(`  ${r.codigo === 0 ? "verde ✔" : `salida ${r.codigo} ✖`}  qa/run.mjs ${g}`);
    if (r.codigo !== 0) {
      baseMala = true;
      for (const m of motivos(r.salida).slice(0, 4)) console.log(`      ${m}`);
    }
  }
  if (baseMala) {
    console.error("\n✖ un guion ya está rojo de partida — arregla eso antes de medir nada aquí");
    restaura();
    process.exit(1);
  }
  console.log();

  for (const [nombre, fichero, guion, pares, huella, codigoEsperado = 1] of INVARIANTES) {
    if (!casa(nombre)) continue;
    restaura();
    let texto = original.get(fichero);
    let malo = null;
    for (const [buscar, poner] of pares) {
      const veces = texto.split(buscar).length - 1;
      if (veces !== 1) {
        malo = `el patrón aparece ${veces} veces`;
        break;
      }
      texto = texto.replace(buscar, poner);
    }
    if (malo) {
      console.log(`⚠️  ${nombre}`);
      console.log(`     ${malo}: el código se ha movido y este candado ya no lo apunta\n`);
      obsoletos.push(nombre);
      continue;
    }
    writeFileSync(fichero, texto);
    const r = corre(guion);
    const dichos = motivos(r.salida);
    const caza = r.codigo === codigoEsperado;
    const nombra = huella.test(r.salida);
    // Un 2 que NO se esperaba no es un veredicto del guion: la corrida no
    // midió. Un 2 ESPERADO (codigoEsperado 2, el canal ⊘ de #331) sí lo es, y
    // se le exige la huella igual que a un rojo.
    if (r.codigo === 2 && codigoEsperado !== 2) sinMedir.push(nombre);
    else if (!caza || !nombra) fallidos.push(nombre);
    const etiqueta =
      caza && nombra
        ? codigoEsperado === 2
          ? "🔴 ⊘   "
          : "🔴 rojo "
        : r.codigo === 2 && codigoEsperado !== 2
          ? "⚠️  ⊘   "
          : "🟢 VERDE";
    console.log(`${etiqueta}  ${nombre}`);
    if (r.codigo === 2 && codigoEsperado !== 2) {
      console.log(`     ⚠️  la corrida NO llegó a medir (salida 2): no dice nada del guion`);
    } else if (!caza && r.codigo === 0) {
      console.log(`     ⚠️  ROMPERLO NO CAMBIA NADA: qa/run.mjs ${guion} sigue en verde`);
    } else if (!caza) {
      console.log(
        `     ⚠️  qa/run.mjs ${guion} salió ${r.codigo} y este candado espera ${codigoEsperado}`,
      );
      for (const m of dichos.slice(0, 3)) console.log(`        ${m}`);
    } else if (!nombra) {
      console.log(
        `     ⚠️  salida ${r.codigo}, pero NO nombra la causa (${huella}): un veredicto que no se puede diagnosticar`,
      );
      for (const m of dichos.slice(0, 3)) console.log(`        ${m}`);
    } else {
      console.log(`     lo caza (qa/run.mjs ${guion}): ${dichos[0] ?? "(sin nombre)"}`);
    }
  }
} finally {
  restaura();
}

// Los ficheros tienen que haber vuelto EXACTAMENTE como estaban: esto escribe en
// el árbol de trabajo de alguien.
for (const [f, txt] of original) {
  if (readFileSync(f, "utf8") !== txt) {
    console.error(`\n✖ NO SE RESTAURÓ ${f} — revísalo con git diff antes de seguir`);
    process.exit(2);
  }
}

const probados = INVARIANTES.filter(([n]) => casa(n)).length;
console.log(`\n${"─".repeat(70)}`);
console.log(`Candados probados en negativo : ${probados}`);
console.log(`Nacen rojos/⊘ y NOMBRAN la causa: ${probados - fallidos.length - obsoletos.length - sinMedir.length}`);
console.log(`No se enteran / no diagnostican: ${fallidos.length}`);
for (const f of fallidos) console.log(`   🟢 ${f}`);
console.log(`Patrón obsoleto               : ${obsoletos.length}`);
for (const o of obsoletos) console.log(`   ⚠️  ${o}`);
console.log(`Sin medir (la corrida se cayó): ${sinMedir.length}`);
for (const s of sinMedir) console.log(`   ⊘ ${s}`);

const ok = fallidos.length === 0 && obsoletos.length === 0;
if (sinMedir.length) process.exit(2);
console.log(
  ok
    ? "\n✔ los guiones probados comprueban lo que dicen comprobar"
    : "\n✖ hay un guion que no comprueba lo que dice",
);
process.exit(ok ? 0 : 1);
