/** ¿Se puede poner ROJO el banco de tests del cliente? (#663, QA de la tanda R)
 *
 *  POR QUÉ EXISTE. `nefan-html/test/` nació el 2026-09-17 (#636) y creció el
 *  18 (#663), y en ninguna de las dos tandas quedó nada que volviera a
 *  demostrar que sus asertos PUEDEN ponerse rojos. Todas las demás familias de
 *  candados de esta casa tienen su hermano en negativo —`contrato-`,
 *  `mutacion-`, `esperas-`, `bateria-`—, y la lección que los tres pagaron
 *  está escrita en la cabecera del primero: *un candado que se instala ya
 *  verde no cierra nada*. El informe del ingeniero de #663 dice haber visto
 *  cuatro sabotajes en rojo antes de cerrar; esto lo vuelve a demostrar, y lo
 *  vuelve a demostrar cada vez que alguien lo ejecute — que es la diferencia
 *  entre una prueba y una afirmación. El banco de #555 (los dos asertos de
 *  arriba del mismo fichero) nunca tuvo ni la afirmación: aquí entra también.
 *
 *  CÓMO. Por cada invariante escribe el fuente ROTO a propósito, corre
 *  `npm test` en `nefan-html` y exige que se ponga rojo **EXACTAMENTE el
 *  aserto nombrado, y solo ése**. Esa precisión es el punto: un sabotaje que
 *  tumba tres asertos a la vez no demuestra que el suyo mide lo que dice,
 *  demuestra que el banco entero se cayó. Restaura siempre, y al terminar
 *  verifica byte a byte que los cuatro ficheros volvieron a estar como
 *  estaban.
 *
 *  ── LOS AGUJEROS TAMBIÉN SE CANDAN ──────────────────────────────────────
 *
 *  La segunda mitad del fichero es la que no tiene hermano en la casa: una
 *  tabla de sabotajes que el banco **NO caza y se sabe que no caza**, cada uno
 *  con quién SÍ lo caza, medido. Un agujero declarado en prosa envejece en
 *  silencio; declarado aquí, el día que alguien lo cierre este guion se pone
 *  rojo con «ya no es un agujero» y le pide que lo suba a la tabla de arriba.
 *  Es el trinquete en la dirección que falta: los candados vigilan que no se
 *  pierda cobertura, esto vigila que no se pierda la MEMORIA de lo que no se
 *  cubre.
 *
 *  Los tres agujeros de hoy salen de la QA de #663 y están medidos allí:
 *
 *   · **renombrado COORDINADO** del id o de la clase (las dos puntas a la vez).
 *     El banco no tiene foto que mantener en el bloque de #663 —al contrario
 *     que en el de #555, donde `LOS_SEIS` es el trinquete—, así que pasa
 *     verde. Deja huérfano un TERCER lector que nadie ata: `home.ts` lee
 *     `#ts-sessions` con su propio literal (:120) y `marcarTarjetaFallida`
 *     lee `.ts-save` con el suyo (:372).
 *   · **la privada del chasis deja de usar `MARCA_DEL_HOME`**: el propio test
 *     lo dice en su «LO QUE NO MIDE».
 *
 *  Ninguno de los tres es una regresión de #663 —antes del corte los mismos
 *  literales estaban igual de sueltos, a 16 líneas unos de otros dentro de
 *  `home.ts`— y los tres los caza hoy la batería de navegador, que es por lo
 *  que no muere ningún guion (regla 2 de `nefan-html/test/README.md`). Lo que
 *  este guion añade es que dejen de estar cazados SOLO por una batería que el
 *  CI no corre.
 *
 *      node qa/run.mjs 148              # con el resto de la clase headless
 *      node qa/run.mjs --sin-navegador  # los cuatro, sin preset ni Chromium
 *
 *  AVISO: escribe en el árbol de trabajo. Se niega a arrancar si los ficheros
 *  que va a tocar ya vienen sucios, porque entonces no puede devolverlos.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

/** El guardarraíl de gasto: esto no abre partida — reescribe cuatro ficheros y
 *  corre `node --test` en un subproceso. */
export const sinMotor = "sabotea el fuente del cliente y corre su banco de tests en un subproceso; no abre partida ni habla con el motor";
/** Ni página (#655): el banco del cliente corre en Node sin DOM, que es
 *  justamente su premisa (`nefan-html/test/README.md`). */
export const sinNavegador = "rompe el fuente del cliente y mira si su banco de tests se entera; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HTML = join(RAIZ, "nefan-html");

const HOME = join(HTML, "src/ui/titulo/home.ts");
const CHASIS = join(HTML, "src/ui/titulo/chasis.ts");
const TARJETA = join(HTML, "src/ui/tarjeta-de-partida.ts");
const SELECTOR = join(HTML, "src/ui/titulo/selector-de-mundo.ts");
const FICHEROS = [HOME, CHASIS, TARJETA, SELECTOR];

/** Los cinco asertos del banco, por su nombre EXACTO. Se escriben aquí para
 *  que un aserto renombrado salga como «patrón obsoleto» en vez de como un
 *  falso verde: si el nombre cambia y esta lista no, el sabotaje diría que
 *  nadie se entera cuando lo que pasa es que este guion mira el nombre viejo. */
const A_SESSIONS = "el chasis busca el home por un id que el home PINTA";
const A_CLASE = "y cuenta las partidas por una clase que la tarjeta PINTA";
const A_COLAPSO = "y fuera del home NO cuenta lo mismo (#553)";
const A_CSS_SEIS = "el chasis estiliza EXACTAMENTE estos seis ids del selector";
const A_PINTA_SEIS = "y los seis los pinta el selector de mundo";

/** [nombre, fichero, aserto que DEBE ponerse rojo, [buscar, poner]]
 *
 *  `buscar` tiene que aparecer exactamente una vez: si el código se mueve, el
 *  sabotaje deja de apuntar a donde cree y esto lo DICE en vez de dar un falso
 *  verde — el mismo guardia que usa `qa/contrato-candados-en-negativo.mjs`. */
const SABOTAJES = [
  // ── #663 · la séptima pareja: la costura entre el CHASIS y el HOME ───────
  [
    "el home pinta otro id y el chasis lo sigue buscando donde estaba",
    HOME, A_SESSIONS,
    ['<div id="ts-sessions" style="margin-bottom:24px">', '<div id="ts-partidas" style="margin-bottom:24px">'],
  ],
  [
    "el chasis busca una marca del home que el home no pinta",
    CHASIS, A_SESSIONS,
    ['export const MARCA_DEL_HOME = "#ts-sessions";', 'export const MARCA_DEL_HOME = "#ts-nada";'],
  ],
  [
    "la tarjeta pinta otra clase y la banda sigue contando la de antes",
    TARJETA, A_CLASE,
    ['<div class="ts-save" style=', '<div class="ts-partida" style='],
  ],
  [
    "la banda cuenta lo mismo dentro y fuera del home (repone #553)",
    CHASIS, A_COLAPSO,
    ["return enElHome ? FILA_DE_PARTIDA : CONTROLES;", "return FILA_DE_PARTIDA;"],
  ],

  // ── #555 · las seis parejas del chasis y el selector, sin hermano hasta hoy
  [
    "el chasis deja de estilizar uno de los seis (la foto de #555 se queda coja)",
    CHASIS, A_CSS_SEIS,
    ["          #title-screen #ts-worlds { max-height: 38vh !important; }\n", ""],
  ],
  [
    "el selector renombra un id que el chasis estiliza",
    SELECTOR, A_PINTA_SEIS,
    ['<div id="ts-worlds" style=', '<div id="ts-mundos" style='],
  ],
];

/** Los AGUJEROS: sabotajes que el banco NO caza, y que se sabe que no caza.
 *
 *  [nombre, fichero, [buscar, poner]…, quién SÍ lo caza (medido)]
 *
 *  Verde aquí = el agujero sigue donde estaba. Rojo = alguien lo cerró, y hay
 *  que subirlo a `SABOTAJES` con el aserto que ahora lo pilla. */
const AGUJEROS = [
  [
    "renombrado COORDINADO del id: las dos puntas cambian y `home.ts:120` se queda huérfano",
    [
      [HOME, '<div id="ts-sessions" style="margin-bottom:24px">', '<div id="ts-partidas" style="margin-bottom:24px">'],
      [CHASIS, 'export const MARCA_DEL_HOME = "#ts-sessions";', 'export const MARCA_DEL_HOME = "#ts-partidas";'],
    ],
    "lo cazan 5 de los 6 guiones del título (medido en la QA de #663: `sessionsEl` queda null y revienta la lista)",
  ],
  [
    "renombrado COORDINADO de la clase: `marcarTarjetaFallida` (home.ts:372) se queda huérfano",
    [
      [TARJETA, '<div class="ts-save" style=', '<div class="ts-guardada" style='],
      [CHASIS, 'const FILA_DE_PARTIDA = ".ts-save";', 'const FILA_DE_PARTIDA = ".ts-guardada";'],
    ],
    "lo cazan los guiones 52 y 98 (la tarjeta que falló deja de distinguirse de sus vecinas)",
  ],
  [
    "la privada del chasis deja de usar `MARCA_DEL_HOME` y reteclea el literal",
    [[CHASIS, "content.querySelector(MARCA_DEL_HOME)", 'content.querySelector("#ts-nada")']],
    "lo cazan los guiones 33 y 122 (la banda cuenta CONTROLES en el home)",
  ],
];

/** Corre el banco y devuelve los nombres de los asertos ROJOS, sin duplicados.
 *
 *  `node --test` imprime el fallo dos veces —en su sitio y en el resumen
 *  «failing tests»—, así que un `Set` no es cosmética: sin él, un solo aserto
 *  rojo contaría como dos y la exigencia de «solo ése» sería inalcanzable. */
function corre() {
  const r = spawnSync("npm", ["test"], { cwd: HTML, encoding: "utf8" });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const rojos = [...new Set([...salida.matchAll(/^✖ (.+?) \(\d/gmu)].map((m) => m[1]))];
  const total = Number(/^ℹ tests (\d+)$/mu.exec(salida)?.[1] ?? -1);
  return { rojos, total, salida };
}

export default async function (ctx) {
  // Se niega sobre un árbol sucio: restaurar al contenido de ANTES borraría lo
  // que hubiera sin commitear. Es la única forma de que escribir en el árbol
  // de otro sea seguro.
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

  // EL TURNO antes de la foto (#572): dos instancias a la vez se fotografían
  // la mutación de la otra y la «restauran» como si fuera el original.
  turnoDeCandados("banco-del-cliente");
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

  /** Aplica una lista de [fichero, buscar, poner]. Devuelve el motivo si algún
   *  patrón no aparece EXACTAMENTE una vez. */
  const aplica = (pares) => {
    const pendiente = new Map();
    for (const [f, buscar, poner] of pares) {
      const texto = pendiente.get(f) ?? original.get(f);
      const veces = texto.split(buscar).length - 1;
      if (veces !== 1) return `«${buscar.slice(0, 48)}…» aparece ${veces} veces en ${relative(RAIZ, f)}`;
      pendiente.set(f, texto.replace(buscar, poner));
    }
    for (const [f, txt] of pendiente) writeFileSync(f, txt);
    return null;
  };

  try {
    // BASE. Si el banco ya viene rojo, cualquier «rojo» de después es el rojo
    // de otra cosa — que es justo el error que este guion existe para no
    // cometer.
    const base = corre();
    ctx.log(`  · base (nada roto): ${base.total} asertos, ${base.rojos.length} rojo(s)`);
    ctx.expect(
      "el banco del cliente viene VERDE de partida",
      base.rojos.length === 0 && base.total > 0,
      base.rojos.length ? `ya está rojo: ${base.rojos.join(" | ")}` : `no se pudo leer el conteo (${base.total})`,
    );
    if (base.rojos.length !== 0 || base.total <= 0) return;

    // Que los cinco asertos que este guion nombra EXISTAN con ese nombre. Sin
    // esto, renombrar un aserto convierte cada exigencia de abajo en «nadie se
    // entera» y el guion culparía al banco de lo que es culpa suya.
    const nombrados = [...new Set([A_SESSIONS, A_CLASE, A_COLAPSO, A_CSS_SEIS, A_PINTA_SEIS])];
    const ausentes = nombrados.filter((n) => !base.salida.includes(n));
    ctx.expect(
      `los ${nombrados.length} asertos que este guion nombra siguen llamándose así`,
      ausentes.length === 0,
      ausentes.length ? `renombrados o borrados: ${ausentes.join(" | ")} — actualiza este guion` : "",
    );
    if (ausentes.length !== 0) return;

    // ── LOS SABOTAJES: cada uno rojo, y SOLO su aserto ──────────────────────
    for (const [nombre, fichero, aserto, [buscar, poner]] of SABOTAJES) {
      restaura();
      const malo = aplica([[fichero, buscar, poner]]);
      if (malo) {
        ctx.expect(`sabotaje · ${nombre}`, false, `el código se ha movido: ${malo}`);
        continue;
      }
      const { rojos } = corre();
      const soloElSuyo = rojos.length === 1 && rojos[0] === aserto;
      ctx.expect(
        `sabotaje · ${nombre}`,
        soloElSuyo,
        rojos.length === 0
          ? `ROMPERLO NO CAMBIA NADA: ningún aserto del banco se entera (esperaba «${aserto}»)`
          : `esperaba SOLO «${aserto}» y se pusieron rojos: ${rojos.join(" | ")}`,
      );
    }

    // ── LOS AGUJEROS: siguen verdes, y se dice quién los caza ────────────────
    for (const [nombre, pares, quienLoCaza] of AGUJEROS) {
      restaura();
      const malo = aplica(pares);
      if (malo) {
        ctx.expect(`agujero · ${nombre}`, false, `el código se ha movido: ${malo}`);
        continue;
      }
      const { rojos } = corre();
      ctx.expect(
        `agujero CONOCIDO, sigue abierto · ${nombre}`,
        rojos.length === 0,
        `YA NO ES UN AGUJERO: ahora lo caza «${rojos.join(" | ")}» — súbelo a SABOTAJES y bórralo de aquí`,
      );
      if (rojos.length === 0) ctx.log(`      ↳ hoy ${quienLoCaza}`);
    }
  } finally {
    restaura();
  }

  // Los ficheros tienen que haber vuelto EXACTAMENTE como estaban: esto
  // escribe en el árbol de trabajo de alguien.
  const noRestaurados = FICHEROS.filter((f) => readFileSync(f, "utf8") !== original.get(f)).map((f) => relative(RAIZ, f));
  ctx.expect(
    "los cuatro ficheros vuelven a estar byte a byte como estaban",
    noRestaurados.length === 0,
    `NO SE RESTAURÓ: ${noRestaurados.join(", ")} — revísalo con git diff antes de seguir`,
  );
}
