/** El lint recorre el banco y los benches DE VERDAD, en el árbol real (#733,
 *  #718; QA de la tanda AU).
 *
 *  POR QUÉ EXISTE. El 175 demuestra el MECANISMO de `lint:qa` sobre un espejo
 *  de juguete, y el 162 el de `lint.sh` sobre una COPIA de `labs/`. Ninguno
 *  mira el árbol real: si el glob de `eslint.qa.config.js` dejara de casar con
 *  la forma del banco (`files: ["qa/**\/*.mjs"]` frente a una carpeta nueva, un
 *  ignore de más, una extensión que cambia), o si `labs/` ganara un
 *  `pyproject.toml` que ruff prefiriera a `labs/ruff.toml`, los dos guiones
 *  seguirían verdes y el lint pasaría de largo por el banco de verdad. Aquí se
 *  cuenta en el árbol que está.
 *
 *   A · `lint:qa` (el script REAL, lanzado desde `nefan-core/` como lo lanza
 *       `npm run lint`) devuelve en `--format json` EXACTAMENTE tantos ficheros
 *       como `.mjs` hay bajo `qa/` fuera de los saltos del banco
 *       (`node_modules`, `.tmp`, `capturas`, por NOMBRE y a cualquier
 *       profundidad, que es `SALTOS_DEL_BANCO`). El censo sale de `git ls-files`
 *       (rastreados + no rastreados no ignorados), no de un recorrido propio de
 *       carpetas. Un lint que lintara cero en verde, o que se dejara `qa/lib/`,
 *       sale ROJO con las dos cifras.
 *   B · `verify` encadena `npm run lint` (y el 175 canda que `lint` encadena
 *       `lint:qa`): es el eslabón que faltaba para decir «el rojo de `lint:qa` es
 *       el rojo de `verify`».
 *   D · en CADA carpeta del banco (las del censo) la config EFECTIVA que ESLint
 *       resuelve (`--print-config`) lleva `no-unused-vars` en error con `^_`
 *       exento. Estar en la lista de A no basta: en flat config un fichero que
 *       no casa con ningún `files` se procesa con CERO reglas y sale verde, y
 *       el 175 siembra solo en `qa/guiones/` — con `files` estrechado a esa
 *       carpeta seguía verde mientras `qa/lib/` y `qa/bajo-carga.mjs` (el
 *       fichero de #733) se quedaban sin regla (medido en la QA de la tanda).
 *   C · ruff recorre `labs/` en el ÁRBOL REAL: `ruff check --show-files labs`,
 *       con el intérprete que eligió `lint.sh`, lista `labs/fps/gen.py` (donde
 *       vivía el `F841` de #718) y todos los `.py` rastreados de `labs/`; y la
 *       config que ruff resuelve para ese fichero es `labs/ruff.toml` (la
 *       decisión de #718: SUS reglas, no las de `ai_server/`).
 *
 *  LO QUE NO MIDE: que un hallazgo ponga rojo (eso es el 175 y el 162), ni
 *  `labs/**\/*.{js,mjs}`, que no los mira ningún eslint (backlog de #733).
 *
 *      node qa/run.mjs --sin-navegador 176
 *
 *  PRECONDICIÓN: `nefan-core/node_modules` (`npm ci`) y un intérprete con la
 *  ruff del pin alcanzable (las mismas que el 175 y el 162; en CI, el job
 *  `candados-headless`). Sin ellas sale ROJO diciéndolo, no ⊘.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** No abre partida: lanza eslint, git y ruff sobre el árbol y compara cifras. */
export const sinMotor = "corre eslint, git ls-files y ruff --show-files sobre el árbol real y compara censos; no abre partida ni habla con el motor";
/** Ni página: el sujeto son dos scripts de lint y lo que recorren. */
export const sinNavegador = "corre eslint y ruff en subprocesos sobre el árbol real y lee package.json; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
/** Los saltos del banco, por NOMBRE (`SALTOS_DEL_BANCO`, `test/banco-ficheros.ts`). */
const SALTOS = ["node_modules", ".tmp", "capturas"];
/** La última línea de `lint.sh` cuando todo va bien: versión e intérprete. */
const OK_RE = /^lint\.sh: ruff (\S+) \+ compileall OK \((.+)\)$/mu;

function corre(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  return { rc: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Rastreados + no rastreados no ignorados, relativos a la raíz. */
function censoGit(carpeta, extension) {
  const r = corre("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", carpeta], RAIZ);
  if (r.rc !== 0) throw new Error(`git ls-files ${carpeta}: rc=${r.rc}\n${r.err}`);
  return r.out
    .split("\n")
    .filter((l) => l.endsWith(extension))
    .filter((l) => !l.split("/").some((seg) => SALTOS.includes(seg)))
    .sort();
}

const relativo = (abs) => abs.startsWith(`${RAIZ}/`) ? abs.slice(RAIZ.length + 1) : abs;
const diferencia = (a, b) => a.filter((x) => !b.includes(x));

export default async function (ctx) {
  // ── B · verify → lint ──────────────────────────────────────────────────────
  const scripts = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")).scripts ?? {};
  ctx.expect(
    "`verify` encadena `npm run lint` (y el 175 canda que `lint` encadena `lint:qa`)",
    typeof scripts.verify === "string" && /(^|&& )npm run lint( |$)/u.test(scripts.verify),
    `verify = ${JSON.stringify(scripts.verify)}`,
  );

  // ── A · lint:qa recorre el banco real, ni más ni menos ────────────────────
  // El script real (`lint:qa`) no admite flags: se lanza su misma línea con
  // `--format json`, desde la raíz, que es lo que hace `cd .. && eslint …`.
  const eslint = corre(join(CORE, "node_modules", ".bin", "eslint"), ["-c", "nefan-core/eslint.qa.config.js", "qa", "--format", "json"], RAIZ);
  ctx.expect(
    "eslint con la config del banco corre sobre `qa` desde la raíz y sale 0 (el banco está limpio)",
    eslint.rc === 0 && eslint.out.trim().startsWith("["),
    `rc=${eslint.rc}\n${(eslint.err || eslint.out).trim().split("\n").slice(-4).join("\n")}`,
  );
  const lintados = eslint.out.trim().startsWith("[") ? JSON.parse(eslint.out).map((f) => relativo(f.filePath)).sort() : [];
  const banco = censoGit("qa", ".mjs");
  const faltan = diferencia(banco, lintados);
  const sobran = diferencia(lintados, banco);
  ctx.log(`  · banco: ${banco.length} .mjs fuera de los saltos · lintados: ${lintados.length}`);
  ctx.expect(
    "lint:qa lintá EXACTAMENTE los .mjs del banco fuera de los saltos (ni cero, ni los de capturas/, ni se deja qa/lib/)",
    banco.length > 100 && faltan.length === 0 && sobran.length === 0,
    `banco ${banco.length} · lintados ${lintados.length} · sin lint: ${faltan.slice(0, 5).join(", ") || "—"} · de más: ${sobran.slice(0, 5).join(", ") || "—"}`,
  );
  ctx.expect(
    "entre lo lintado está el fichero de #733 (qa/bajo-carga.mjs) y un guion de qa/guiones/",
    lintados.includes("qa/bajo-carga.mjs") && lintados.some((f) => f.startsWith("qa/guiones/")),
    lintados.filter((f) => f === "qa/bajo-carga.mjs" || f.startsWith("qa/guiones/")).slice(0, 3).join(", "),
  );

  // ── D · y la REGLA se aplica en cada carpeta del banco ────────────────────
  // Estar en la lista no es tener la regla: en flat config, un fichero que no
  // casa con ningún `files` se procesa con CERO reglas y sale verde. Medido en
  // la QA de la tanda AU: con `files: ["qa/guiones/**/*.mjs"]` el 175 seguía
  // verde (siembra en `qa/guiones/`) y `qa/lib/` y `qa/bajo-carga.mjs` —el
  // fichero de #733— quedaban sin regla. Se pregunta a ESLint por la config
  // EFECTIVA de un fichero por carpeta, carpetas que salen del censo (una
  // nueva entra sola).
  const carpetas = [...new Set(banco.map((f) => dirname(f)))].sort();
  const sinRegla = [];
  for (const carpeta of carpetas) {
    const muestra = banco.find((f) => dirname(f) === carpeta);
    const pc = corre(join(CORE, "node_modules", ".bin", "eslint"), ["-c", "nefan-core/eslint.qa.config.js", "--print-config", muestra], RAIZ);
    const regla = pc.rc === 0 ? JSON.parse(pc.out).rules?.["no-unused-vars"] : undefined;
    const severidad = Array.isArray(regla) ? regla[0] : regla;
    const opciones = Array.isArray(regla) ? regla[1] ?? {} : {};
    const activa = (severidad === 2 || severidad === "error") && opciones.varsIgnorePattern === "^_" && opciones.argsIgnorePattern === "^_";
    if (!activa) sinRegla.push(`${muestra} → ${JSON.stringify(regla)}`);
  }
  ctx.log(`  · carpetas del banco: ${carpetas.join(", ")}`);
  ctx.expect(
    "en cada carpeta del banco la config EFECTIVA lleva `no-unused-vars` en error con `^_` exento (no solo «está en la lista»)",
    carpetas.length >= 3 && sinRegla.length === 0,
    sinRegla.join(" · ") || carpetas.join(", "),
  );

  // ── C · ruff recorre labs/ en el árbol real, con labs/ruff.toml ───────────
  const lint = corre("bash", [join(RAIZ, "ai_server", "lint.sh")], RAIZ);
  const ok = OK_RE.exec(`${lint.out}${lint.err}`);
  ctx.expect(
    "lint.sh sale 0 en el árbol y dice el intérprete que usó",
    lint.rc === 0 && ok !== null,
    `rc=${lint.rc}\n${`${lint.out}${lint.err}`.trim().split("\n").slice(-3).join("\n")}`,
  );
  const py = ok?.[2] ?? "python3";
  const files = corre(py, ["-m", "ruff", "check", "--show-files", "labs"], RAIZ);
  const vistos = files.out.split("\n").filter(Boolean).map(relativo).sort();
  const benches = censoGit("labs", ".py");
  const sinRuff = diferencia(benches, vistos);
  ctx.log(`  · labs/: ${benches.length} .py rastreados · ruff ve: ${vistos.length}`);
  ctx.expect(
    "ruff recorre TODOS los .py rastreados de labs/ en el árbol real (labs/fps/gen.py entre ellos)",
    files.rc === 0 && benches.length > 0 && sinRuff.length === 0 && vistos.includes("labs/fps/gen.py"),
    `rc=${files.rc} · sin ruff: ${sinRuff.slice(0, 5).join(", ") || "—"} · gen.py ${vistos.includes("labs/fps/gen.py") ? "visto" : "NO visto"}`,
  );
  const settings = corre(py, ["-m", "ruff", "check", "--show-settings", "labs/fps/gen.py"], RAIZ);
  const configResuelta = /Settings path: "([^"]+)"/u.exec(settings.out)?.[1] ?? "";
  ctx.expect(
    "la config que ruff resuelve para labs/fps/gen.py es labs/ruff.toml (sus reglas, no las de ai_server/)",
    relativo(configResuelta) === "labs/ruff.toml",
    `Settings path: ${configResuelta || "(no la dice)"}`,
  );
}
