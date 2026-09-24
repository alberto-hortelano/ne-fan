/** El lint mira el banco (`qa/**\/*.mjs`) y SE PUEDE PONER ROJO (#733, tanda AU).
 *
 *  POR QUÉ EXISTE. `npm run lint` era `eslint src bridge services test
 *  scripts`: `qa/` no lo miraba nadie, y un import muerto vivió en
 *  `qa/bajo-carga.mjs` hasta que alguien lo vio a ojo (#711). Al encender el
 *  lint salieron 18 hallazgos en 13 ficheros; entre ellos helpers que un guion
 *  copió de otro y nunca llamó, que es justo donde se esconde un aserto que se
 *  prometió y no se hace (la familia de #356).
 *
 *  La tanda AU añade `lint:qa` (`nefan-core/package.json`), que corre ESLint
 *  desde la raíz con `nefan-core/eslint.qa.config.js`: UNA regla,
 *  `no-unused-vars` con `^_` exento. Este guion demuestra, cada vez que se
 *  ejecuta, lo que esa config afirma:
 *
 *   a · un import muerto sembrado en un guion pone `lint:qa` en ROJO,
 *       nombrando el fichero y la regla. Si ESLint dejara de resolver el base
 *       path desde el cwd (la config lanzada con `-c` desde la raíz), lintaría
 *       cero ficheros en verde: es esta siembra la que lo diría;
 *   b · un `_x` sin usar sale 0: la exención `^_` es la misma que la del paquete;
 *   c · un global sin declarar (`window`, `process`) sale 0: `no-undef` sigue
 *       APAGADO a propósito — con `recommended` el banco daba 3254 hallazgos
 *       de globals del navegador y de Node, que son ruido;
 *   d · el mismo import muerto dentro de `.tmp/` o de `capturas/`, a cualquier
 *       profundidad, sale 0: el lint salta lo que salta el barrido del banco
 *       (`SALTOS_DEL_BANCO`). La paridad de las DOS listas la canda
 *       `nefan-core/test/el-lint-del-banco-salta-lo-que-el-banco-salta.test.ts`;
 *       esto mide que ESLint aplica esos ignores como se espera;
 *   e · `npm run lint` encadena `npm run lint:qa`, y de ahí que `verify` y CI
 *       (que corren `npm run lint`) lo hereden. Es un aserto sobre el TEXTO del
 *       script: lo que ejecuta `lint:qa` lo miden a-d.
 *
 *  CÓMO. No escribe en el árbol de trabajo: monta un espejo en un temporal
 *  —`nefan-core/` con el `package.json` y la config REALES copiados y
 *  `node_modules` como enlace al del árbol, más un `qa/` de juguete por
 *  siembra— y corre allí `npm run lint:qa`, el script de verdad. Cada siembra
 *  lleva además un fichero limpio: sin él, un `qa/` con todo ignorado haría
 *  que ESLint saliera 2 («all files are ignored») y la (d) mediría otra cosa.
 *
 *  LO QUE NO MIDE: `labs/**\/*.{js,mjs}` (14 ficheros) no los mira ningún
 *  eslint; y en `qa/` no corren `no-useless-assignment` (38 casos el
 *  2026-09-24) ni `preserve-caught-error` (3). Están en el backlog.
 *
 *      node qa/run.mjs --sin-navegador 175
 *
 *  PRECONDICIÓN: `nefan-core/node_modules` instalado (`npm ci`), que el job
 *  `candados-headless` ya hace. Sin él, la (a) sale ROJA diciendo que no hay
 *  eslint, no ⊘.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** No abre partida: monta un espejo en un temporal y corre `npm run lint:qa`. */
export const sinMotor = "monta un espejo de nefan-core/ y qa/ en un temporal y corre npm run lint:qa sobre siembras; no abre partida ni habla con el motor";
/** Ni página: el sujeto es un script de npm y una config de ESLint. */
export const sinNavegador = "corre npm run lint:qa en subprocesos sobre un espejo y lee package.json; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const CONFIG = "eslint.qa.config.js";

/** El mismo import muerto en todas las siembras que lo necesitan. */
const MUERTO = 'import { readFileSync } from "node:fs";\nexport const a = 1;\n';
const LIMPIO = "export const limpio = 1;\n";

/** Un espejo con `qa/` = `ficheros` (+ el limpio), y `npm run lint:qa` en él. */
function lintEnEspejo(temporal, nombre, ficheros) {
  const dir = join(temporal, nombre);
  const core = join(dir, "nefan-core");
  mkdirSync(core, { recursive: true });
  copyFileSync(join(CORE, "package.json"), join(core, "package.json"));
  copyFileSync(join(CORE, CONFIG), join(core, CONFIG));
  symlinkSync(join(CORE, "node_modules"), join(core, "node_modules"), "dir");
  for (const [ruta, texto] of Object.entries({ "qa/limpio.mjs": LIMPIO, ...ficheros })) {
    mkdirSync(dirname(join(dir, ruta)), { recursive: true });
    writeFileSync(join(dir, ruta), texto);
  }
  const r = spawnSync("npm", ["run", "lint:qa"], { cwd: core, encoding: "utf8" });
  if (r.error) throw r.error;
  return { rc: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const cola = (r) => `rc=${r.rc}\n${r.out.trim().split("\n").slice(-6).join("\n")}`;

export default async function (ctx) {
  // ── e · `lint` encadena `lint:qa` (y verify y CI corren `lint`) ────────────
  const scripts = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")).scripts ?? {};
  ctx.expect(
    "`npm run lint` encadena `npm run lint:qa` (verify y CI corren `lint`, así que lo heredan)",
    typeof scripts.lint === "string" && /(^|&& )npm run lint:qa( |$)/u.test(scripts.lint),
    `lint = ${JSON.stringify(scripts.lint)}`,
  );
  ctx.expect(
    "`lint:qa` lanza ESLint con la config del banco sobre `qa`",
    typeof scripts["lint:qa"] === "string" && scripts["lint:qa"].includes(`-c nefan-core/${CONFIG} qa`),
    `lint:qa = ${JSON.stringify(scripts["lint:qa"])}`,
  );

  const temporal = mkdtempSync(join(tmpdir(), "guion-175-"));
  try {
    // ── a · el import muerto pone ROJO ─────────────────────────────────────
    const a = lintEnEspejo(temporal, "a", { "qa/guiones/sembrado-175.mjs": MUERTO });
    ctx.expect(
      "un import muerto sembrado en qa/guiones/ pone `lint:qa` en ROJO nombrando el fichero y la regla",
      a.rc !== 0 && /sembrado-175\.mjs/u.test(a.out) && /no-unused-vars/u.test(a.out),
      cola(a),
    );

    // ── b · `^_` exento ─────────────────────────────────────────────────────
    const b = lintEnEspejo(temporal, "b", {
      "qa/guiones/sembrado-175.mjs": "const _sinUsar = 1;\nexport const f = (_x, y) => y;\n",
    });
    ctx.expect("un `_x` sin usar (variable o argumento) sale 0: `^_` exento, como en el paquete", b.rc === 0, cola(b));

    // ── c · no-undef APAGADO ────────────────────────────────────────────────
    const c = lintEnEspejo(temporal, "c", {
      "qa/guiones/sembrado-175.mjs": "window.__qa175 = document.title;\nexport const e = process.env.HOME;\n",
    });
    ctx.expect(
      "globals del navegador y de Node sin declarar salen 0: `no-undef` (y el resto de `recommended`) sigue apagado",
      c.rc === 0,
      cola(c),
    );

    // ── d · lo que salta el barrido del banco, lo salta el lint ─────────────
    const d = lintEnEspejo(temporal, "d", {
      "qa/.tmp/run-175/sembrado-175.mjs": MUERTO,
      "qa/capturas/sembrado-175.mjs": MUERTO,
      "qa/guiones/capturas/sembrado-175.mjs": MUERTO,
      "qa/lib/.tmp/sembrado-175.mjs": MUERTO,
    });
    ctx.expect(
      "el mismo import muerto dentro de `.tmp/` o de `capturas/`, a cualquier profundidad, sale 0 (el lint salta lo que salta el banco)",
      d.rc === 0 && !/sembrado-175/u.test(d.out),
      cola(d),
    );
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}
