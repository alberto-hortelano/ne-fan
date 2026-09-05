/** Qué intérprete de Python usa un guion del banco que arranca código de `ai_server/`.
 *
 *  Existe porque el bloque de cinco líneas que lo decidía estaba copiado en dos
 *  guiones (`el-ledger-…` y `el-npc-cruza-…`) y las dos copias llevaban
 *  commiteada la ruta del `.venv` de UNA máquina concreta como segundo
 *  candidato (hallazgo 4 de `qa-2.md`, T11). Una ruta personal en el repo
 *  funciona hasta que el siguiente clon la lee.
 *
 *  Orden, y por qué:
 *   1 · `NEFAN_PYTHON`, si está: la forma explícita de decir «este». Es lo que
 *       necesita un worktree desprendido, que no tiene `.venv` propio y quiere
 *       el del checkout principal sin que nadie escriba esa ruta en el repo.
 *   2 · `<raíz>/.venv/bin/python`, si existe: el checkout normal.
 *   3 · `python3`: el sistema (CI, donde `setup-python` lo deja con las deps).
 *
 *  No comprueba que el intérprete tenga las dependencias: eso lo afirma cada
 *  guion con su propio `import` de prueba, porque cada uno necesita unas.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ENV_PYTHON = "NEFAN_PYTHON";

/** El intérprete para un guion cuya raíz de repo es `repoRoot`. Fail-loud en la
 *  variable: puesta y en blanco NO es «sin variable», y un valor que no existe
 *  en disco se dice en vez de degradar al `.venv` (que sería usar otro Python
 *  que el que alguien acaba de pedir). */
export function interpretePython(repoRoot, env = process.env) {
  if (ENV_PYTHON in env) {
    const explicito = env[ENV_PYTHON] ?? "";
    if (!explicito.trim()) {
      throw new Error(`${ENV_PYTHON} está puesta pero en blanco: quítala o apunta a un intérprete`);
    }
    if (!existsSync(explicito)) {
      throw new Error(`${ENV_PYTHON}=${JSON.stringify(explicito)} no existe en disco`);
    }
    return explicito;
  }
  const venv = join(repoRoot, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}
