/** EL CANDADO DE «UN NÚMERO, UN GUION» PUEDE PONERSE ROJO, Y SE SABE DÓNDE NO (#680, #683).
 *
 *  `nefan-core/test/un-numero-un-guion.test.ts` nació el 2026-09-18 con dos
 *  totalidades —prefijo numérico único en `qa/guiones/*.mjs`, nada ejecutable
 *  bajo `docs/agents/**`— y su informe decía haberlas visto rojas con los dos
 *  126, con un `7-zz.mjs` y con un `zz.mjs` en `docs/agents/`. Eso es una
 *  afirmación en un informe que se lee una vez. Esto es la misma prueba, en
 *  negativo y repetible: se siembra cada defecto en el árbol de trabajo, se
 *  corre el candado en un subproceso y se exige que se ponga rojo
 *  **EXACTAMENTE el aserto nombrado y solo ése**, y que el mensaje NOMBRE al
 *  fichero sembrado (un rojo que no dice cuál es obliga a buscar a mano).
 *
 *  Escrito por la QA de la tanda U, que es la tanda que decidió #683: el
 *  material ejecutable de una QA es un guion de `qa/guiones/` con
 *  `sinNavegador`, molde del 148. Este guion es el primero que nace bajo esa
 *  regla, y por eso también es su ejemplo.
 *
 *  ── LOS AGUJEROS TAMBIÉN SE CANDAN ──────────────────────────────────────
 *  La segunda mitad es la tabla de lo que el candado NO caza y se sabe que no
 *  caza, medido en la QA de la tanda U (2026-09-18): cada agujero se siembra
 *  igual y se exige que el candado siga VERDE. El día que alguien cierre uno,
 *  esta tabla se pone roja con «YA NO ES UN AGUJERO» y hay que subirlo a
 *  `SABOTAJES`. Es la memoria ejecutable de lo que la cabecera del test
 *  declara en prosa —y de lo que no declara: el symlink no está en su lista.
 *
 *  LO QUE NO MIRA: si el candado es el correcto (que dos ramas paralelas lo
 *  pasan en verde hasta fusionar es una propiedad del test que ningún negativo
 *  local puede medir), ni que cada guion tenga fila en `qa/README.md`.
 *
 *  Cero créditos: no abre partida ni página. Siembra ficheros VACÍOS con
 *  nombres que ningún guion real lleva (`zz-`), los borra en `finally` y en
 *  SIGINT/SIGTERM, y se NIEGA a arrancar si alguno ya estaba: no puede
 *  distinguir su basura de la de otro. */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

/** El guardarraíl de gasto: esto no abre partida — siembra ficheros vacíos y
 *  corre `node --test` en un subproceso. */
export const sinMotor = "siembra ficheros vacíos en qa/guiones/ y docs/agents/ y corre un test de core en un subproceso; no abre partida ni habla con el motor";
/** Ni página (#655): el candado que se prueba lee el disco. */
export const sinNavegador = "siembra defectos de nombre de fichero y mira si el test de core se entera; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const TEST = "test/un-numero-un-guion.test.ts";
const GUIONES = join(RAIZ, "qa", "guiones");
const DOCS_AGENTS = join(RAIZ, "docs", "agents");
/** Carpeta propia bajo docs/agents/: el candado mira el árbol de trabajo y
 *  todo lo que se siembre ahí tiene que poder borrarse de un golpe. */
const CARPETA_SEMBRADA = join(DOCS_AGENTS, "zz-siembra-del-guion-151");

/** Los cuatro asertos del candado, por su nombre EXACTO: renombrar uno tiene
 *  que salir como «renombrado», no como «nadie se entera». */
const A_SUJETO = "hay guiones: la totalidad tiene sujeto";
const A_PREFIJO = "todo guion lleva prefijo numérico";
const A_UNICO = "ningún número lo comparten dos guiones (07 y 7 son el mismo)";
const A_PROSA = "todo fichero de docs/agents/** es prosa";

/** Los guiones que hay HOY, para sembrar contra números reales y no contra
 *  una constante que envejece (el 126 de records puede renumerarse mañana). */
const guionesVivos = readdirSync(GUIONES).filter((f) => f.endsWith(".mjs"));
const numeroDe = (f) => /^(\d+)-/.exec(f)?.[1] ?? null;
/** El 126 si sigue existiendo (es el número del issue), y si no el primero:
 *  el sabotaje tiene que repetir un número que EXISTE. */
const guionRepetible = guionesVivos.find((f) => numeroDe(f) === "126") ?? guionesVivos.find((f) => numeroDe(f) !== null);
const numeroRepetible = numeroDe(guionRepetible ?? "");

/** Cada siembra es una función que crea y devuelve las rutas que ha creado
 *  (las borra el `limpia` común, en orden inverso). */
const fichero = (ruta, contenido = "") => {
  writeFileSync(ruta, contenido);
  return [ruta];
};
const enDocs = (nombre, contenido = "") => {
  mkdirSync(CARPETA_SEMBRADA, { recursive: true });
  return [...fichero(join(CARPETA_SEMBRADA, nombre), contenido), CARPETA_SEMBRADA];
};

/** [nombre, siembra, aserto que DEBE ponerse rojo, texto que el mensaje tiene que NOMBRAR] */
const SABOTAJES = [
  [
    `un segundo guion con el ${numeroRepetible} (el choque de #680, con el número vivo)`,
    () => fichero(join(GUIONES, `${numeroRepetible}-zz-segundo-con-el-mismo-numero.mjs`)),
    A_UNICO,
    `${Number(numeroRepetible)} → [`,
  ],
  [
    `el mismo número con cero a la izquierda (0${numeroRepetible} es el ${Number(numeroRepetible)})`,
    () => fichero(join(GUIONES, `0${numeroRepetible}-zz-con-cero-delante.mjs`)),
    A_UNICO,
    `0${numeroRepetible}-zz-con-cero-delante.mjs`,
  ],
  ["un guion sin prefijo numérico", () => fichero(join(GUIONES, "zz-sin-numero.mjs")), A_PREFIJO, "zz-sin-numero.mjs"],
  [
    "un número con separador distinto (`_` en vez de `-`) no es prefijo",
    () => fichero(join(GUIONES, `${numeroRepetible}_zz-con-guion-bajo.mjs`)),
    A_PREFIJO,
    `${numeroRepetible}_zz-con-guion-bajo.mjs`,
  ],
  ["un sondeo `.mjs` dejado en docs/agents/ (el caso de #683)", () => enDocs("zz-sondeo.mjs"), A_PROSA, "zz-sondeo.mjs"],
  ["un `.py` en docs/agents/", () => enDocs("zz-sondeo.py"), A_PROSA, "zz-sondeo.py"],
  ["un `.sh` en un SUBDIRECTORIO de docs/agents/<tanda>/", () => {
    const sub = join(CARPETA_SEMBRADA, "capturas");
    mkdirSync(sub, { recursive: true });
    return [...fichero(join(sub, "zz-sondeo.sh")), sub, CARPETA_SEMBRADA];
  }, A_PROSA, "zz-sondeo.sh"],
];

/** Los AGUJEROS: defectos que el candado NO caza, y que se sabe que no caza.
 *
 *  [nombre, siembra, por qué sigue abierto / quién lo mira hoy]
 *
 *  Verde aquí = el agujero sigue donde estaba. Rojo = alguien lo cerró, y hay
 *  que subirlo a `SABOTAJES`. */
const AGUJEROS = [
  [
    "un `.mjs` en un SUBDIRECTORIO de qa/guiones/ repitiendo un número",
    () => {
      const sub = join(GUIONES, "zz-subdirectorio");
      mkdirSync(sub);
      return [...fichero(join(sub, `${numeroRepetible}-zz-en-subdirectorio.mjs`)), sub];
    },
    "el candado enumera `qa/guiones/` sin recursión, igual que el runner (`qa/run.mjs`, `readdirSync` plano): ese guion no corre en ninguna batería, así que hoy no choca con nadie. Sin issue: hallazgo de la QA de la tanda U",
  ],
  [
    "un ejecutable SIN extensión en docs/agents/ (shebang y bit x)",
    () => {
      const rutas = enDocs("zz-sondeo", "#!/usr/bin/env node\nconsole.log(1)\n");
      chmodSync(rutas[0], 0o755);
      return rutas;
    },
    "declarado en la cabecera del test: el censo es por extensión, no por shebang ni por bit de ejecución",
  ],
  [
    "un SYMLINK `zz.mjs` en docs/agents/ que apunta a un guion real",
    () => {
      mkdirSync(CARPETA_SEMBRADA, { recursive: true });
      const enlace = join(CARPETA_SEMBRADA, "zz-enlace.mjs");
      symlinkSync(relative(CARPETA_SEMBRADA, join(GUIONES, guionRepetible)), enlace);
      return [enlace, CARPETA_SEMBRADA];
    },
    "`withFileTypes` + `isFile()` deja fuera los enlaces simbólicos, y git los commitea. NO está en la lista de la cabecera del test. Sin issue: hallazgo de la QA de la tanda U",
  ],
  [
    "extensión fuera de la lista o en MAYÚSCULAS en docs/agents/ (`.MJS`, `.bash`, `.rb`)",
    () => [
      ...enDocs("zz-sondeo.MJS"),
      ...fichero(join(CARPETA_SEMBRADA, "zz-sondeo.bash")),
      ...fichero(join(CARPETA_SEMBRADA, "zz-sondeo.rb")),
    ],
    "declarado en la cabecera del test («una extensión que no esté en la lista»); `extname` distingue mayúsculas y la lista está en minúsculas",
  ],
];

/** Todas las rutas que este guion puede llegar a crear: para negarse si ya
 *  existen y para comprobar al final que ninguna quedó. */
const TODO_LO_SEMBRABLE = [CARPETA_SEMBRADA, join(GUIONES, "zz-subdirectorio")];
const hayRastro = () => {
  const rastro = TODO_LO_SEMBRABLE.filter((r) => existsSync(r) || esEnlace(r));
  const zz = readdirSync(GUIONES).filter((f) => /(^|-|_)zz-/.test(f)).map((f) => join(GUIONES, f));
  return [...rastro, ...zz].map((r) => relative(RAIZ, r));
};
function esEnlace(r) {
  try {
    return lstatSync(r).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Corre el candado y devuelve los asertos ROJOS (solo los `it`, que salen con
 *  dos espacios; el `describe` padre y el resumen «failing tests» van a
 *  columna cero y repetirían el mismo rojo), el total y la salida. */
function corre() {
  const r = spawnSync("node", ["--import", "tsx", "--test", TEST], { cwd: CORE, encoding: "utf8" });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // Codicioso hasta el `(<ms>)` FINAL de la línea: el nombre de un aserto puede
  // llevar paréntesis con dígitos dentro («(07 y 7 son el mismo)») y una
  // captura perezosa lo cortaba ahí y daba «renombrado» por un aserto intacto.
  const rojos = [...new Set([...salida.matchAll(/^ {2}✖ (.+) \(\d[\d.]*ms\)$/gmu)].map((m) => m[1]))];
  // El CÓDIGO DE SALIDA también decide (#697): un `describe` cuyo cuerpo lanza
  // sale con 1 pero no deja ningún aserto con `✖` que este regex recoja, y el
  // resumen dice `ℹ fail 0`. Sin esto, esa batería rota se leería «verde».
  if (r.status !== 0 && rojos.length === 0) rojos.push(`EXIT ${r.status} sin ningún aserto rojo nombrado (¿un describe que lanza?)`);
  // `total` solo sirve para exigir que la base tenga sujeto; no decide rojos.
  const total = Number(/^ℹ tests (\d+)$/mu.exec(salida)?.[1] ?? -1);
  return { rojos, total, salida };
}

export default async function (ctx) {
  ctx.expect(
    "hay un guion vivo con número contra el que sembrar el choque",
    guionRepetible !== undefined && numeroRepetible !== null,
    `qa/guiones/ no tiene ningún guion con prefijo numérico (${guionesVivos.length} .mjs)`,
  );
  if (!guionRepetible) return;

  const rastro = hayRastro();
  if (rastro.length) {
    ctx.expect(
      "el árbol viene sin siembras de una corrida anterior",
      false,
      `ya existen: ${rastro.join(", ")} — otra instancia está corriendo o murió sin limpiar; míralo antes de borrar nada`,
    );
    return;
  }

  // EL TURNO (#572): dos instancias a la vez se verían las siembras de la otra.
  turnoDeCandados("un-numero-un-guion");

  let sembrado = [];
  const limpia = () => {
    for (const r of [...sembrado].reverse()) {
      rmSync(r, { recursive: true, force: true });
    }
    sembrado = [];
  };
  for (const [señal, codigo] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.on(señal, () => {
      limpia();
      process.exit(codigo);
    });
  }

  try {
    // BASE: si el candado ya viene rojo, cualquier rojo de después es de otra cosa.
    const base = corre();
    ctx.log(`  · base (nada sembrado): ${base.total} asertos, ${base.rojos.length} rojo(s)`);
    ctx.expect(
      "el candado viene VERDE de partida y con sus cuatro asertos",
      base.rojos.length === 0 && base.total === 4,
      base.rojos.length ? `ya está rojo: ${base.rojos.join(" | ")}` : `esperaba 4 asertos y leí ${base.total}`,
    );
    if (base.rojos.length !== 0 || base.total !== 4) return;

    const nombrados = [A_SUJETO, A_PREFIJO, A_UNICO, A_PROSA];
    const ausentes = nombrados.filter((n) => !base.salida.includes(`✔ ${n}`));
    ctx.expect(
      "los cuatro asertos que este guion nombra siguen llamándose así",
      ausentes.length === 0,
      ausentes.length ? `renombrados o borrados: ${ausentes.join(" | ")} — actualiza este guion` : "",
    );
    if (ausentes.length !== 0) return;

    // ── LOS SABOTAJES: cada uno rojo, SOLO su aserto, y nombrando al fichero ─
    for (const [nombre, siembra, aserto, debeNombrar] of SABOTAJES) {
      limpia();
      sembrado = siembra();
      const { rojos, salida } = corre();
      const soloElSuyo = rojos.length === 1 && rojos[0] === aserto;
      ctx.expect(
        `sabotaje · ${nombre}`,
        soloElSuyo,
        rojos.length === 0
          ? `SEMBRARLO NO CAMBIA NADA: ningún aserto del candado se entera (esperaba «${aserto}»)`
          : `esperaba SOLO «${aserto}» y se pusieron rojos: ${rojos.join(" | ")}`,
      );
      if (soloElSuyo) {
        ctx.expect(
          `  …y el rojo NOMBRA lo sembrado («${debeNombrar}»)`,
          salida.includes(debeNombrar),
          `el mensaje del aserto no dice cuál es el fichero: quien lo lea tendrá que buscarlo a mano`,
        );
      }
    }

    // ── LOS AGUJEROS: siguen verdes, y se dice por qué ───────────────────────
    for (const [nombre, siembra, porQue] of AGUJEROS) {
      limpia();
      sembrado = siembra();
      const { rojos } = corre();
      ctx.expect(
        `agujero CONOCIDO, sigue abierto · ${nombre}`,
        rojos.length === 0,
        `YA NO ES UN AGUJERO: ahora lo caza «${rojos.join(" | ")}» — súbelo a SABOTAJES y bórralo de aquí`,
      );
      if (rojos.length === 0) ctx.log(`      ↳ hoy: ${porQue}`);
    }
  } finally {
    limpia();
  }

  const quedo = hayRastro();
  ctx.expect(
    "no queda ninguna siembra en el árbol",
    quedo.length === 0,
    `NO SE LIMPIÓ: ${quedo.join(", ")} — bórralo a mano y revísalo con git status`,
  );
  const despues = corre();
  ctx.expect("y el candado vuelve a estar verde", despues.rojos.length === 0, `sigue rojo: ${despues.rojos.join(" | ")}`);
}
