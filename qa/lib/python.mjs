/** Qué intérprete de Python usa un guion del banco que arranca código de `ai_server/`.
 *
 *  Existe porque el bloque de cinco líneas que lo decidía estaba copiado en dos
 *  guiones (`el-ledger-…` y `el-npc-cruza-…`) y las dos copias llevaban
 *  commiteada la ruta del `.venv` de UNA máquina concreta como segundo
 *  candidato (hallazgo 4 de `qa-2.md`, T11). Una ruta personal en el repo
 *  funciona hasta que el siguiente clon la lee.
 *
 *  Orden, y por qué:
 *   1 · `NEFAN_PYTHON`, si está: la forma explícita de decir «este». Vale una
 *       ruta ejecutable o un nombre del PATH (`python3.12`), igual que en
 *       `ai_server/lint.sh`.
 *   2 · `<raíz>/.venv/bin/python`, si es ejecutable: el checkout normal.
 *   3 · `<padre de git-common-dir>/.venv/bin/python`: el `.venv` del checkout
 *       principal cuando esto es un worktree de tanda, que no tiene `.venv`
 *       propio (#717). Sin ninguna ruta de máquina escrita aquí.
 *   4 · `python3` del PATH: el sistema (CI, donde `setup-python` lo deja con las
 *       deps). Si tampoco está, lanza en vez de devolver un nombre que no
 *       arrancará.
 *
 *  ES LA MISMA REGLA que `ai_server/lint.sh`, y no por prosa: los dos comen la
 *  misma tabla de casos en `nefan-core/test/python-interprete-paridad.test.ts`
 *  (`lint.sh --interprete` es el lado bash). La tercera copia, `start.sh`, que
 *  solo mira el `.venv` del árbol, está FUERA de esa paridad a propósito:
 *  arranca servicios, no es el banco.
 *
 *  No comprueba que el intérprete tenga las dependencias: eso lo afirma cada
 *  guion con su propio `import` de prueba, porque cada uno necesita unas.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export const ENV_PYTHON = "NEFAN_PYTHON";

/** `[ -x ruta ]` de bash. */
function ejecutable(ruta) {
  try {
    accessSync(ruta, constants.X_OK);
    return true;
  } catch (e) {
    // Solo «no está o no se puede ejecutar» es un no; cualquier otra cosa es
    // una avería que no se colapsa con él.
    if (e.code === "ENOENT" || e.code === "EACCES" || e.code === "ENOTDIR") return false;
    throw new Error(`no se pudo mirar si ${ruta} es ejecutable`, { cause: e });
  }
}

/** `command -v nombre` de bash, para un nombre sin `/`: el primer ejecutable
 *  con ese nombre en el PATH dado. */
function enElPath(nombre, path) {
  if (nombre.includes("/")) return false;
  return (path ?? "").split(delimiter).some((dir) => dir !== "" && ejecutable(join(dir, nombre)));
}

/** El `.venv` del checkout principal, o `null` si `repoRoot` no está en un
 *  repo de git (la copia temporal del guion 162, por ejemplo) o no hay `git`
 *  en el PATH. Igual que el
 *  `git … || true` de `lint.sh`: «no es un repo» no es un error aquí. */
function venvDelPrincipal(repoRoot, env) {
  // Con el MISMO entorno que se está resolviendo, PATH incluido: igual que el
  // `git` de `lint.sh`, que corre con el entorno del script. Así el test de
  // paridad controla a qué `git` llegan los dos lados.
  const r = spawnSync("git", ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
    env,
  });
  // Sin `git` en el PATH no hay checkout principal que buscar: lo mismo que el
  // `2>/dev/null || true` de `lint.sh`, y está en la tabla de paridad. Cualquier
  // otra avería al lanzarlo sí se dice.
  if (r.error?.code === "ENOENT") return null;
  if (r.error) throw new Error("no se pudo lanzar git para buscar el checkout principal", { cause: r.error });
  const comun = r.status === 0 ? r.stdout.trim() : "";
  return comun ? join(dirname(comun), ".venv", "bin", "python") : null;
}

/** El intérprete para un guion cuya raíz de repo es `repoRoot`. Fail-loud en la
 *  variable: puesta y en blanco NO es «sin variable», y un valor que no es un
 *  ejecutable se dice en vez de degradar al `.venv` (que sería usar otro Python
 *  que el que alguien acaba de pedir). */
export function interpretePython(repoRoot, env = process.env) {
  if (ENV_PYTHON in env) {
    const explicito = env[ENV_PYTHON] ?? "";
    if (!explicito.trim()) {
      throw new Error(`${ENV_PYTHON} está puesta pero en blanco: quítala o apunta a un intérprete`);
    }
    if (!ejecutable(explicito) && !enElPath(explicito, env.PATH)) {
      throw new Error(`${ENV_PYTHON}=${JSON.stringify(explicito)} no es un ejecutable ni un nombre del PATH`);
    }
    return explicito;
  }
  const venv = join(repoRoot, ".venv", "bin", "python");
  if (ejecutable(venv)) return venv;
  const principal = venvDelPrincipal(repoRoot, env);
  if (principal !== null && ejecutable(principal)) return principal;
  if (enElPath("python3", env.PATH)) return "python3";
  throw new Error(
    `no hay intérprete de Python: ni .venv en ${repoRoot}, ni en el checkout principal, ni python3 en el PATH ` +
      `(o pon ${ENV_PYTHON})`,
  );
}
