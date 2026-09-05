/** `qa/lib/python.mjs`: qué intérprete de Python arranca un guion del banco.
 *
 *  Mismo precedente que `veredictos.test.ts` y `presets-clasifica.test.ts`: el
 *  test importa el banco (dirección test → banco). Nació con el módulo (T11,
 *  PR-2) para que la totalidad de `qa/lib` que mide PR-3 lo encuentre con
 *  dueño desde el primer día, y porque el orden de resolución —variable
 *  explícita, `.venv` del checkout, sistema— es justo lo que un worktree
 *  desprendido necesita que no cambie en silencio.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const mod = (await import(join(repoRoot, "qa", "lib", "python.mjs"))) as {
  ENV_PYTHON: string;
  interpretePython: (repoRoot: string, env?: Record<string, string | undefined>) => string;
};
const { ENV_PYTHON, interpretePython } = mod;

function conRaiz(fn: (raiz: string) => void, opts: { conVenv: boolean }): void {
  const raiz = mkdtempSync(join(tmpdir(), "qa-lib-python-"));
  try {
    if (opts.conVenv) {
      mkdirSync(join(raiz, ".venv", "bin"), { recursive: true });
      writeFileSync(join(raiz, ".venv", "bin", "python"), "");
    }
    fn(raiz);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

describe("qa/lib/python.mjs: el intérprete de los guiones Python", () => {
  it("sin variable y con .venv en la raíz, es el del .venv", () => {
    conRaiz((raiz) => {
      assert.equal(interpretePython(raiz, {}), join(raiz, ".venv", "bin", "python"));
    }, { conVenv: true });
  });

  it("sin variable y sin .venv, cae al python3 del sistema", () => {
    conRaiz((raiz) => {
      assert.equal(interpretePython(raiz, {}), "python3");
    }, { conVenv: false });
  });

  it("la variable explícita gana al .venv, si apunta a algo que existe", () => {
    conRaiz((raiz) => {
      const otro = join(raiz, "otro-python");
      writeFileSync(otro, "");
      assert.equal(interpretePython(raiz, { [ENV_PYTHON]: otro }), otro);
    }, { conVenv: true });
  });

  it("la variable en blanco o apuntando a nada LANZA en vez de degradar", () => {
    conRaiz((raiz) => {
      assert.throws(() => interpretePython(raiz, { [ENV_PYTHON]: "" }), /en blanco/);
      assert.throws(() => interpretePython(raiz, { [ENV_PYTHON]: "   " }), /en blanco/);
      assert.throws(() => interpretePython(raiz, { [ENV_PYTHON]: join(raiz, "no-existe") }), /no existe/);
    }, { conVenv: true });
  });
});
