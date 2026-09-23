/** ¿Se puede poner ROJO el candado del barrido único del banco? (#704, QA de la tanda AL)
 *
 *  POR QUÉ EXISTE. `test/un-solo-barrido-del-banco.test.ts` y su padrón
 *  `data/contract/recorridos-de-test.json` prometen que ningún fichero de
 *  `test/` recorre `qa/` de forma RECURSIVA fuera de `banco-ficheros.ts`. El
 *  detector contesta una pregunta del ÁRBOL —«¿esto recorre de forma
 *  recursiva?»— y por tanto ve las FORMAS que sabe ver. Esto mide, sobre el
 *  árbol real y en subproceso, qué formas de recorrer un directorio ponen el
 *  candado rojo y cuáles pasan en verde HOY.
 *
 *  CÓMO. Cada caso siembra un `.ts` (o `.mjs`) con nombre `zz-sabotaje-qa-704-*`
 *  bajo `nefan-core/test/` —no es `.test.ts`, así que `npm test` no lo corre,
 *  pero el candado censa TODO `.ts` de `test/`—, corre el candado y exige que
 *  se pongan rojos EXACTAMENTE los asertos nombrados y solo ésos. Dos
 *  sabotajes más reescriben el padrón. Restaura siempre y al terminar
 *  verifica que no queda ningún sembrado y que el padrón volvió byte a byte.
 *
 *  ── LOS AGUJEROS TAMBIÉN SE CANDAN (molde del 148) ─────────────────────────
 *
 *  Dos tablas de agujeros, medidas en la QA de la tanda AL (2026-09-23):
 *
 *   · **INVISIBLES DEL TODO** (cero rojos): formas de recorrer `qa/` que el
 *     detector no ve ni como recorrido ni como lectura plana. Las más
 *     probables en un test nuevo: `globSync("qa/**\/*.mjs")` (Node ≥ 22 lo
 *     trae en `node:fs`), `fs.promises.readdir(d, {recursive: true})`, el alias
 *     por asignación (`const leer = readdirSync`) y un helper `.mjs` bajo
 *     `test/` (el censo solo mira `.ts`). Ninguna está en
 *     `_lo_que_esto_NO_sujeta` del padrón.
 *   · **ROJO DE REBOTE**: recorridos recursivos que el detector NO ve como
 *     tales (la recursión por `this.x`/`obj.x`, la función expresión con
 *     nombre propio, el `let` reasignado, `flatMap(baja)` sin llamar, la clave
 *     `"recursive"` entre comillas, `true as const`, el `{recursive}`
 *     abreviado y el `...OPCIONES`). Hoy salen rojos, pero por el aserto
 *     «LÍMITE MEDIDO (4)», cuyo `deepEqual` sobre la LISTA de lectores planos
 *     cambia con cualquier fichero nuevo que lea un directorio —mientras su
 *     texto y el punto (4) del padrón dicen «uno nuevo sin declarar pasa en
 *     verde»—. Si ese aserto pasa a contar en vez de listar, estos ocho pasan
 *     en verde; si el detector aprende a verlos, suben a SABOTAJES. En los
 *     dos casos esta tabla se pone roja y lo dice.
 *
 *      node qa/run.mjs --sin-navegador 163   # solo éste, sin preset ni Chromium
 *      node qa/run.mjs --sin-navegador       # con el resto de la clase headless
 *
 *  AVISO: escribe en el árbol de trabajo (ficheros `zz-sabotaje-qa-704-*` bajo
 *  `nefan-core/test/` y el padrón). Se niega a arrancar si el padrón viene
 *  sucio o ya hay rastro de un sembrado, porque entonces no puede restaurar.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

export const sinMotor = "siembra recorridos de directorio bajo nefan-core/test/ y corre el candado del barrido único en un subproceso; no abre partida ni habla con el motor";
export const sinNavegador = "rompe el padrón de recorridos y siembra ficheros en test/ para mirar si el candado se entera; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const TEST_DIR = join(CORE, "test");
const PADRON = join(CORE, "data/contract/recorridos-de-test.json");
const TEST = "test/un-solo-barrido-del-banco.test.ts";
const PREFIJO = "zz-sabotaje-qa-704-";

/** Los asertos del candado, por su nombre EXACTO: renombrado = «patrón
 *  obsoleto», no falso verde. */
const A_TOTALIDAD = "totalidad: cada recorrido recursivo fuera del dueño está en el padrón con su cifra exacta";
const A_LEGALIZA = "el padrón no puede legalizar una copia del banco: ningún `recorre` nombra qa";
const A_LIMITE_4 = "LÍMITE MEDIDO (4): los lectores de carpeta no tienen totalidad; hoy hay estos fuera del padrón";

const FS = 'import { readdirSync } from "node:fs"; import { join } from "node:path";';
/** La copia con `flatMap` que #704 retiró de tres tests. */
const FLATMAP_VIEJO = `${FS}
export const banco = (dir = "qa"): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? banco(join(dir, e.name)) : [e.name]);
`;

/** [nombre, fichero sembrado (o null), contenido, prepara(padron) (o null), asertos que DEBEN ponerse rojos (y solo ésos)] */
const SABOTAJES = [
  ["la copia con flatMap que había en tres tests, SIN declarar", "flatmap.ts", FLATMAP_VIEJO, null, [A_TOTALIDAD]],
  [
    "`fs.readdirSync(…, {recursive: true})` con el import por defecto",
    "default-import.ts",
    'import fs from "node:fs"; export const a = fs.readdirSync("qa", { recursive: true });\n',
    null,
    [A_TOTALIDAD],
  ],
  [
    "`{ withFileTypes: true, recursive: true }` (el orden de las claves no importa)",
    "with-file-types.ts",
    'import { readdirSync } from "node:fs"; export const a = readdirSync("qa", { withFileTypes: true, recursive: true });\n',
    null,
    [A_TOTALIDAD],
  ],
  [
    "una función declarada que se llama a sí misma pasando un callback",
    "callback.ts",
    `${FS}
export function baja(d: string, cb: (f: string) => void): void { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? baja(join(d, e.name), cb) : cb(e.name); }
`,
    null,
    [A_TOTALIDAD],
  ],
  [
    "la llamada opcional `readdirSync?.(…, {recursive: true})`",
    "optional-call.ts",
    'import { readdirSync } from "node:fs"; export const a = readdirSync?.("qa", { recursive: true });\n',
    null,
    [A_TOTALIDAD],
  ],
  [
    "la copia con flatMap DECLARADA en el padrón con `recorre: \"qa\"` (legalizar una copia del banco)",
    "flatmap.ts",
    FLATMAP_VIEJO,
    (p) => p.recorridos.push({ fichero: `${PREFIJO}flatmap.ts`, sitios: 1, recorre: "qa", porque: "sabotaje del guion 163: una copia del banco con permiso" }),
    [A_LEGALIZA],
  ],
  [
    "una entrada de `recorridos` que ya no existe (caducada)",
    null,
    "",
    (p) => p.recorridos.push({ fichero: "no-existe.test.ts", sitios: 1, recorre: "data/scenes", porque: "sabotaje del guion 163: entrada caducada" }),
    [A_TOTALIDAD],
  ],
  [
    "la cifra de `sitios` de `afectado.test.ts` que no casa",
    null,
    "",
    (p) => {
      p.recorridos.find((r) => r.fichero === "afectado.test.ts").sitios = 2;
    },
    [A_TOTALIDAD],
  ],
  [
    "se borra un lector de carpeta declarado (`un-numero-un-guion`): rojo, pero por el LÍMITE (4), no por totalidad",
    null,
    "",
    (p) => {
      p.lectores_de_carpeta_de_qa = p.lectores_de_carpeta_de_qa.filter((l) => l.fichero !== "un-numero-un-guion.test.ts");
    },
    [A_LIMITE_4],
  ],
];

const RECURSIVO = (cuerpo) => `${FS}\n${cuerpo}\n`;
/** [nombre, fichero, contenido]. Cero rojos hoy. */
const INVISIBLES = [
  ["el alias por ASIGNACIÓN (`const leer = readdirSync; leer(…, {recursive: true})`)", "alias-asignacion.ts", RECURSIVO('const leer = readdirSync; export const a = leer("qa", { recursive: true });')],
  ["`globSync(\"qa/**/*.mjs\")` de `node:fs`", "globsync.ts", 'import { globSync } from "node:fs"; export const a = globSync("qa/**/*.mjs");\n'],
  ["`import { promises } from \"node:fs\"; promises.readdir(…, {recursive: true})`", "promises-named.ts", 'import { promises } from "node:fs"; export const a = promises.readdir("qa", { recursive: true });\n'],
  ["`fs.promises.readdir(…, {recursive: true})`", "fs-promises.ts", 'import fs from "node:fs"; export const a = fs.promises.readdir("qa", { recursive: true });\n'],
  [
    "`opendirSync` recursivo (otro lector de `node:fs`)",
    "opendirsync.ts",
    'import { opendirSync } from "node:fs"; import { join } from "node:path";\nexport function baja(d: string): string[] { const out: string[] = []; const dir = opendirSync(d); let e; while ((e = dir.readSync())) { if (e.isDirectory()) out.push(...baja(join(d, e.name))); else out.push(e.name); } dir.closeSync(); return out; }\n',
  ],
  [
    "`createRequire` + `require(\"node:fs\")`",
    "create-require.ts",
    'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const { readdirSync } = require("node:fs"); export const a = readdirSync("qa", { recursive: true });\n',
  ],
  ["`execSync(\"find qa -name *.mjs\")`", "child-process.ts", 'import { execSync } from "node:child_process"; export const a = execSync("find qa -name *.mjs").toString().split("\\n");\n'],
  ["el destructurado de un espacio de nombres (`import * as fs; const { readdirSync } = fs`)", "destructura-espacio.ts", 'import * as fs from "node:fs"; const { readdirSync } = fs; export const a = readdirSync("qa", { recursive: true });\n'],
  ["un helper `.mjs` bajo `test/` con la copia flatMap (el censo solo mira `.ts`)", "helper.mjs", FLATMAP_VIEJO.replace(": string[]", "")],
];

/** [nombre, fichero, contenido]. Hoy rojos SOLO por `A_LIMITE_4`. */
const DE_REBOTE = [
  ["la recursión por `this.baja(…)` en un método de clase", "clase-this.ts", RECURSIVO("export class W { baja(d: string): string[] { return readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? this.baja(join(d, e.name)) : [e.name]); } }")],
  ["la recursión por `w.baja(…)` en un método de objeto", "metodo-objeto.ts", RECURSIVO("export const w = { baja(d: string): string[] { return readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? w.baja(join(d, e.name)) : [e.name]); } };")],
  ["el `let` reasignado (`let baja; baja = (d) => … baja(…)`)", "let-reasignada.ts", RECURSIVO("let baja: (d: string) => string[]; baja = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? baja(join(d, e.name)) : [e.name]); export { baja };")],
  ["la función expresión con NOMBRE PROPIO (`const w = function baja(d) { … baja(…) }`)", "function-expression.ts", RECURSIVO("export const w = function baja(d: string): string[] { return readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? baja(join(d, e.name)) : [e.name]); };")],
  ["la referencia sin llamar (`.flatMap(baja)`)", "referencia.ts", RECURSIVO("export const baja = (d: string): string[] => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(d, e.name)).flatMap(baja);")],
  ["la clave entre comillas (`{ \"recursive\": true }`)", "clave-string.ts", RECURSIVO('export const a = readdirSync("qa", { "recursive": true });')],
  ["`true as const` y el `{ recursive }` abreviado", "as-const.ts", RECURSIVO('const recursive = true; export const a = readdirSync("qa", { recursive: true as const }); export const b = readdirSync("qa", { recursive });')],
  ["las opciones por `...OPCIONES`", "spread.ts", RECURSIVO('const OPCIONES = { recursive: true }; export const a = readdirSync("qa", { ...OPCIONES, withFileTypes: true });')],
];

/** Corre el candado y devuelve los asertos ROJOS (solo las líneas INDENTADAS:
 *  un `describe` con un hijo rojo también sale con ✖ y no es un aserto). El
 *  nombre se corta en la DURACIÓN final `(N.NNNms)`, no en el primer `(`
 *  seguido de dígito: «LÍMITE MEDIDO (4): …» lleva uno dentro. */
function corre() {
  const r = spawnSync("npx", ["tsx", "--test", TEST], { cwd: CORE, encoding: "utf8" });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const rojos = [...new Set([...salida.matchAll(/^ {2,}✖ (.+) \([\d.]+ms\)$/gmu)].map((m) => m[1]))];
  const total = Number(/^ℹ tests (\d+)$/mu.exec(salida)?.[1] ?? -1);
  return { rojos, total, salida };
}

const mismoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const sembrados = () => readdirSync(TEST_DIR).filter((f) => f.startsWith(PREFIJO));
const siembra = (fichero, contenido) => writeFileSync(join(TEST_DIR, PREFIJO + fichero), contenido);

export default async function (ctx) {
  const sucio = spawnSync("git", ["status", "--porcelain", "--", relative(RAIZ, PADRON)], { cwd: RAIZ, encoding: "utf8" });
  const rastro = sembrados();
  if ((sucio.stdout ?? "").trim() || rastro.length > 0) {
    ctx.expect(
      "el padrón que este guion reescribe viene limpio y no hay rastro de un sembrado anterior",
      false,
      `hay cambios sin commitear o ficheros ${PREFIJO}* en test/:\n${sucio.stdout.trim()}\n${rastro.join("\n")}\n  commitéalos o bórralos: este guion restaura al contenido del disco de ANTES de arrancar`,
    );
    return;
  }

  turnoDeCandados("padron-recorridos-de-test");
  const original = readFileSync(PADRON, "utf8");
  const restaura = () => {
    writeFileSync(PADRON, original);
    for (const f of sembrados()) unlinkSync(join(TEST_DIR, f));
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
  const aplica = (prepara) => {
    const padron = JSON.parse(original);
    prepara(padron);
    writeFileSync(PADRON, `${JSON.stringify(padron, null, 2)}\n`);
  };

  try {
    const base = corre();
    ctx.log(`  · base (nada roto): ${base.total} asertos, ${base.rojos.length} rojo(s)`);
    ctx.expect(
      "el candado viene VERDE de partida",
      base.rojos.length === 0 && base.total > 0,
      base.rojos.length ? `ya está rojo: ${base.rojos.join(" | ")}` : `no se pudo leer el conteo (${base.total})`,
    );
    if (base.rojos.length !== 0 || base.total <= 0) return;

    const nombrados = [A_TOTALIDAD, A_LEGALIZA, A_LIMITE_4];
    const ausentes = nombrados.filter((n) => !base.salida.includes(n));
    ctx.expect(
      `los ${nombrados.length} asertos que este guion nombra siguen llamándose así`,
      ausentes.length === 0,
      ausentes.length ? `renombrados o borrados: ${ausentes.join(" | ")} — actualiza este guion` : "",
    );
    if (ausentes.length !== 0) return;

    for (const [nombre, fichero, contenido, prepara, esperados] of SABOTAJES) {
      restaura();
      if (fichero) siembra(fichero, contenido);
      if (prepara) aplica(prepara);
      const { rojos, salida } = corre();
      const exacto = mismoConjunto(rojos, esperados);
      // Y cuando la totalidad se pone roja por un fichero SEMBRADO, el rojo
      // tiene que NOMBRARLO: un rojo que no dice dónde es un rojo que nadie
      // arregla. Un solo `expect` por sabotaje, con las tres causas separadas.
      const debeNombrar = Boolean(fichero) && esperados.includes(A_TOTALIDAD);
      const nombra = !debeNombrar || salida.includes(PREFIJO + fichero);
      ctx.expect(
        `sabotaje · ${nombre}${debeNombrar ? ` (y el rojo nombra a ${PREFIJO}${fichero})` : ""}`,
        exacto && nombra,
        rojos.length === 0
          ? `ROMPERLO NO CAMBIA NADA: ningún aserto se entera (esperaba «${esperados.join(" | ")}»)`
          : !exacto
            ? `esperaba EXACTAMENTE «${esperados.join(" | ")}» y se pusieron rojos: ${rojos.join(" | ")}`
            : `el rojo no dice qué fichero recorre (${PREFIJO}${fichero})`,
      );
    }

    // Los agujeros se siembran EN BLOQUE (una corrida por tabla, no una por
    // fila: cada corrida son ~2 s de tsx sobre 190 fuentes). Si el bloque no
    // sale como hoy, se repite fila a fila para nombrar la que cambió.
    const bloque = (tabla, esperadosHoy, etiqueta, consejo) => {
      restaura();
      for (const [, fichero, contenido] of tabla) siembra(fichero, contenido);
      const { rojos } = corre();
      const sigue = mismoConjunto(rojos, esperadosHoy);
      ctx.expect(
        `agujeros CONOCIDOS (${etiqueta}): las ${tabla.length} formas siguen saliendo «${esperadosHoy.join(" | ") || "verde"}»`,
        sigue,
        `salió «${rojos.join(" | ") || "verde"}» — ${consejo}`,
      );
      if (sigue) {
        for (const [nombre] of tabla) ctx.log(`      ↳ sigue abierto · ${nombre}`);
        return;
      }
      for (const [nombre, fichero, contenido] of tabla) {
        restaura();
        siembra(fichero, contenido);
        const uno = corre();
        ctx.expect(
          `agujero CONOCIDO (${etiqueta}), sigue como hoy · ${nombre}`,
          mismoConjunto(uno.rojos, esperadosHoy),
          `esperaba hoy «${esperadosHoy.join(" | ") || "verde"}» y salió «${uno.rojos.join(" | ") || "verde"}» — ${consejo}`,
        );
      }
    };
    bloque(INVISIBLES, [], "invisibles del todo", "si ahora lo caza la totalidad, súbelo a SABOTAJES y bórralo de aquí");
    bloque(
      DE_REBOTE,
      [A_LIMITE_4],
      "rojo de rebote",
      "si lo caza la TOTALIDAD, el detector ya lo ve: súbelo a SABOTAJES; si sale VERDE, el LÍMITE (4) dejó de listar y estas ocho formas ya no las para nadie",
    );
  } finally {
    restaura();
  }

  ctx.expect(
    "el padrón vuelve byte a byte como estaba y no queda ningún sembrado en test/",
    readFileSync(PADRON, "utf8") === original && sembrados().length === 0,
    `NO SE RESTAURÓ: revisa git diff ${relative(RAIZ, PADRON)} y nefan-core/test/${PREFIJO}*`,
  );
}
