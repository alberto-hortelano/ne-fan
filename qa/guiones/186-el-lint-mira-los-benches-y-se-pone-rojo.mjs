/** El lint mira los benches (`labs/**\/*.{js,mjs,cjs}`) y SE PUEDE PONER ROJO
 *  (#744, tanda AY).
 *
 *  POR QUÉ EXISTE. Desde #733 `npm run lint` mira el banco (`qa/`), y desde
 *  #718 ruff mira los `.py` de `labs/`; los 14 `.js`/`.mjs` de `labs/` —el
 *  motor emulado, el replay-server, los dumps de `fps`— no los miraba nadie.
 *  Al encender el lint salieron 3 hallazgos, todos en
 *  `labs/authoring/three/escena.js`.
 *
 *  La tanda AY añade `lint:labs` (`nefan-core/package.json`), que corre ESLint
 *  desde la raíz con `nefan-core/eslint.labs.config.js`, HERMANA de la del
 *  banco: `no-unused-vars` con `^_` exento. Es hermana y no un bloque de la del
 *  banco porque los candados de esa (el 176 A y la paridad de ignores con
 *  `SALTOS_DEL_BANCO`) miden SOLO `qa/`. Este guion demuestra lo que la config
 *  afirma, sobre un espejo:
 *
 *   a · un import muerto sembrado en un `.mjs` de `labs/` pone `lint:labs` en
 *       ROJO, nombrando fichero y regla; y lo mismo en un `.js` (los tres de
 *       `labs/authoring/three/` son `.js`). Si ESLint dejara de resolver el
 *       base path desde el cwd, lintaría cero ficheros en verde: lo diría esto;
 *   b · un `_x` sin usar sale 0: la exención `^_` es la del banco;
 *   c · el mismo import muerto bajo `runs/` (a cualquier profundidad) sale 0:
 *       es lo que los `.gitignore` de los benches dejan fuera;
 *   d · el mismo import muerto en un `.ts` de `labs/` sale 0: los `.ts` son de
 *       `typecheck:labs` (#309), no de esta pasada;
 *   e · `npm run lint` encadena `npm run lint:labs` (y `verify` y CI corren
 *       `lint`), y `lint:labs` lanza la config hermana sobre `labs`. Aserto
 *       sobre el TEXTO de los scripts: lo que ejecuta lo miden a-d.
 *
 *  CÓMO. Como el 175: espejo en un temporal con el `package.json` y la config
 *  REALES y `node_modules` enlazado, más un `labs/` de juguete por siembra con
 *  un fichero limpio (sin él, un `labs/` todo ignorado sale 2 y la (c) mediría
 *  otra cosa). No escribe en el árbol de trabajo.
 *
 *  LO QUE NO MIDE: que la pasada recorra el `labs/` REAL (eso es el 187), ni
 *  el lint de `qa/` (175 y 176).
 *
 *      node qa/run.mjs --sin-navegador 186
 *
 *  PRECONDICIÓN: `nefan-core/node_modules` (`npm ci`), como el 175. Sin él, la
 *  (a) sale ROJA diciendo que no hay eslint, no ⊘.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** No abre partida: monta un espejo en un temporal y corre `npm run lint:labs`. */
export const sinMotor = "monta un espejo de nefan-core/ y labs/ en un temporal y corre npm run lint:labs sobre siembras; no abre partida ni habla con el motor";
/** Ni página: el sujeto es un script de npm y una config de ESLint. */
export const sinNavegador = "corre npm run lint:labs en subprocesos sobre un espejo y lee package.json; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const CONFIG = "eslint.labs.config.js";

const MUERTO = 'import { readFileSync } from "node:fs";\nexport const a = 1;\n';
const LIMPIO = "export const limpio = 1;\n";

/** Un espejo con `labs/` = `ficheros` (+ el limpio), y `npm run lint:labs` en él. */
function lintEnEspejo(temporal, nombre, ficheros) {
  const dir = join(temporal, nombre);
  const core = join(dir, "nefan-core");
  mkdirSync(core, { recursive: true });
  copyFileSync(join(CORE, "package.json"), join(core, "package.json"));
  copyFileSync(join(CORE, CONFIG), join(core, CONFIG));
  symlinkSync(join(CORE, "node_modules"), join(core, "node_modules"), "dir");
  for (const [ruta, texto] of Object.entries({ "labs/limpio.mjs": LIMPIO, ...ficheros })) {
    mkdirSync(dirname(join(dir, ruta)), { recursive: true });
    writeFileSync(join(dir, ruta), texto);
  }
  const r = spawnSync("npm", ["run", "lint:labs"], { cwd: core, encoding: "utf8" });
  if (r.error) throw r.error;
  return { rc: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const cola = (r) => `rc=${r.rc}\n${r.out.trim().split("\n").slice(-6).join("\n")}`;

export default async function (ctx) {
  // ── e · `lint` encadena `lint:labs`, y `lint:labs` es la config hermana ────
  const scripts = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")).scripts ?? {};
  ctx.expect(
    "`npm run lint` encadena `npm run lint:labs` (verify y CI corren `lint`, así que lo heredan)",
    typeof scripts.lint === "string" && /(^|&& )npm run lint:labs( |$)/u.test(scripts.lint),
    `lint = ${JSON.stringify(scripts.lint)}`,
  );
  ctx.expect(
    "`lint:labs` lanza ESLint con la config de los benches sobre `labs`",
    typeof scripts["lint:labs"] === "string" && scripts["lint:labs"].includes(`-c nefan-core/${CONFIG} labs`),
    `lint:labs = ${JSON.stringify(scripts["lint:labs"])}`,
  );

  const temporal = mkdtempSync(join(tmpdir(), "guion-186-"));
  try {
    // ── a · el import muerto pone ROJO, en .mjs y en .js ───────────────────
    const a = lintEnEspejo(temporal, "a", { "labs/fps/sembrado-186.mjs": MUERTO });
    ctx.expect(
      "un import muerto sembrado en un .mjs de labs/ pone `lint:labs` en ROJO nombrando el fichero y la regla",
      a.rc !== 0 && /sembrado-186\.mjs/u.test(a.out) && /no-unused-vars/u.test(a.out),
      cola(a),
    );
    const aj = lintEnEspejo(temporal, "a-js", { "labs/authoring/three/sembrado-186.js": MUERTO });
    ctx.expect(
      "…y en un .js (la extensión de labs/authoring/three/) también, nombrando el fichero y la regla",
      aj.rc !== 0 && /sembrado-186\.js/u.test(aj.out) && /no-unused-vars/u.test(aj.out),
      cola(aj),
    );

    // ── b · `^_` exento ─────────────────────────────────────────────────────
    const b = lintEnEspejo(temporal, "b", {
      "labs/narrative/sembrado-186.mjs": "const _sinUsar = 1;\nexport const f = (_x, y) => y;\n",
    });
    ctx.expect("un `_x` sin usar (variable o argumento) sale 0: `^_` exento, como en el banco", b.rc === 0, cola(b));

    // ── c · runs/ no se mira ────────────────────────────────────────────────
    const c = lintEnEspejo(temporal, "c", {
      "labs/fps/runs/sembrado-186.mjs": MUERTO,
      "labs/authoring/runs/r1/sembrado-186.js": MUERTO,
    });
    ctx.expect(
      "el mismo import muerto bajo `runs/`, a cualquier profundidad, sale 0 (lo que los .gitignore de los benches dejan fuera)",
      c.rc === 0 && !/sembrado-186/u.test(c.out),
      cola(c),
    );

    // ── d · los .ts no son de esta pasada ───────────────────────────────────
    const d = lintEnEspejo(temporal, "d", { "labs/narrative/sembrado-186.ts": MUERTO });
    ctx.expect(
      "el mismo import muerto en un .ts de labs/ sale 0: los .ts los mira `typecheck:labs`, no esta pasada",
      d.rc === 0 && !/sembrado-186/u.test(d.out),
      cola(d),
    );
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}
