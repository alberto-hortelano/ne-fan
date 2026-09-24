/** El intérprete de Python se decide en DOS sitios y tienen que decir lo mismo (#717).
 *
 *  `ai_server/lint.sh` (bash, el lint de `verify` y de CI) y `qa/lib/python.mjs`
 *  (JS, los guiones del banco que arrancan `ai_server/`) resuelven el
 *  intérprete con la misma regla: `NEFAN_PYTHON` → `.venv` del árbol → `.venv`
 *  del checkout principal (git-common-dir) → `python3` del PATH. Hasta #717 la
 *  copia JS no tenía el tercer paso —un guion Python no arrancaba desde un
 *  worktree de tanda sin `NEFAN_PYTHON` a mano— y aceptaba `NEFAN_PYTHON` solo
 *  como ruta, mientras bash aceptaba también un nombre del PATH. Dos copias de
 *  una regla divergen; el trato de la casa es el de `port-offset-paridad`: una
 *  tabla, y la comen las dos.
 *
 *  Lo que se compara es el VEREDICTO (qué intérprete, o fallo), no el mensaje.
 *  Todo es de mentira y hermético: un repo con un worktree real en un
 *  temporal, `.venv` que son scripts vacíos ejecutables, y un PATH que solo
 *  lleva lo que bash necesita (`git`, `dirname`) más, si el caso lo pide, un
 *  `python3` falso. Los DOS lados corren con ese entorno, `git` incluido:
 *  `python.mjs` lanza su `git` con el `env` que resuelve, así que el PATH
 *  real de la máquina no decide ningún veredicto.
 *
 *  FUERA, a propósito: `start.sh` (solo mira el `.venv` del árbol) arranca
 *  servicios, no es el banco.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const { ENV_PYTHON, interpretePython } = (await import(join(repoRoot, "qa", "lib", "python.mjs"))) as {
  ENV_PYTHON: string;
  interpretePython: (repoRoot: string, env?: Record<string, string | undefined>) => string;
};

/** Dónde vive cada pieza del escenario. `principal` es un repo; `wt`, un
 *  worktree suyo (como `ne-fan-tanda-*`); `suelto`, un directorio fuera de git
 *  (la copia temporal del guion 162). */
type Escena = {
  principal: string;
  wt: string;
  suelto: string;
  herr: string;
  herrSinGit: string;
  py: string;
  rara: string;
};

type Veredicto = "propio" | "principal" | "python3" | "var" | "FALLO";

type Caso = {
  nota: string;
  raiz: "wt" | "suelto";
  venvPropio: boolean;
  venvPrincipal: boolean;
  python3EnPath: boolean;
  /** El PATH sin `git`: los dos lados lo lanzan con el entorno del caso. */
  sinGit?: boolean;
  /** Sin la clave, la variable no está; con ella, su valor (función de la escena). */
  variable?: (e: Escena) => string;
  espera: Veredicto;
};

const TABLA: ReadonlyArray<Caso> = [
  { nota: ".venv propio", raiz: "wt", venvPropio: true, venvPrincipal: false, python3EnPath: true, espera: "propio" },
  {
    nota: "worktree sin .venv propio: el del checkout principal (#717)",
    raiz: "wt",
    venvPropio: false,
    venvPrincipal: true,
    python3EnPath: true,
    espera: "principal",
  },
  { nota: "los dos .venv: gana el propio", raiz: "wt", venvPropio: true, venvPrincipal: true, python3EnPath: true, espera: "propio" },
  { nota: "ningún .venv: python3 del PATH", raiz: "wt", venvPropio: false, venvPrincipal: false, python3EnPath: true, espera: "python3" },
  { nota: "ninguno de nada: fallo", raiz: "wt", venvPropio: false, venvPrincipal: false, python3EnPath: false, espera: "FALLO" },
  {
    nota: "fuera de git (la copia del guion 162): python3, sin mirar el principal",
    raiz: "suelto",
    venvPropio: false,
    venvPrincipal: true,
    python3EnPath: true,
    espera: "python3",
  },
  {
    nota: "fuera de git y sin python3: fallo, aunque el principal tenga .venv",
    raiz: "suelto",
    venvPropio: false,
    venvPrincipal: true,
    python3EnPath: false,
    espera: "FALLO",
  },
  {
    nota: "sin git en el PATH: no se busca el principal, cae a python3 (el `|| true` de lint.sh)",
    raiz: "wt",
    venvPropio: false,
    venvPrincipal: true,
    python3EnPath: true,
    sinGit: true,
    espera: "python3",
  },
  { nota: "variable vacía", raiz: "wt", venvPropio: true, venvPrincipal: true, python3EnPath: true, variable: () => "", espera: "FALLO" },
  { nota: "variable en blanco", raiz: "wt", venvPropio: true, venvPrincipal: true, python3EnPath: true, variable: () => "   ", espera: "FALLO" },
  {
    nota: "variable = ruta ejecutable: gana a los dos .venv",
    raiz: "wt",
    venvPropio: true,
    venvPrincipal: true,
    python3EnPath: true,
    variable: (e) => join(e.py, "mipython"),
    espera: "var",
  },
  {
    nota: "variable = ruta que no existe",
    raiz: "wt",
    venvPropio: true,
    venvPrincipal: false,
    python3EnPath: true,
    variable: (e) => join(e.py, "no-existe"),
    espera: "FALLO",
  },
  {
    nota: "variable = ruta que existe pero no es ejecutable",
    raiz: "wt",
    venvPropio: true,
    venvPrincipal: false,
    python3EnPath: true,
    variable: (e) => e.rara,
    espera: "FALLO",
  },
  {
    nota: "variable = nombre del PATH (bash lo aceptaba y JS lanzaba)",
    raiz: "wt",
    venvPropio: true,
    venvPrincipal: false,
    python3EnPath: true,
    variable: () => "python3",
    espera: "var",
  },
  {
    nota: "variable = nombre que no está en el PATH",
    raiz: "wt",
    venvPropio: true,
    venvPrincipal: false,
    python3EnPath: false,
    variable: () => "python3",
    espera: "FALLO",
  },
];

let base = "";
let e: Escena;

/** Un ejecutable vacío: `-x` y `X_OK` dicen que sí, y nadie lo va a lanzar. */
const ejecutableVacio = (ruta: string): void => {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, "#!/bin/sh\n", { mode: 0o755 });
};

const git = (cwd: string, ...args: string[]): void => {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });
};

const donde = (orden: string): string => execFileSync("bash", ["-c", `command -v ${orden}`], { encoding: "utf8" }).trim();

before(() => {
  // realpath: git contesta con la ruta real y bash con la lógica; un TMPDIR
  // con un enlace por medio las haría distintas sin que nada estuviera mal.
  base = realpathSync(mkdtempSync(join(tmpdir(), "py-paridad-")));
  e = {
    principal: join(base, "principal"),
    wt: join(base, "wt"),
    suelto: join(base, "suelto"),
    herr: join(base, "herr"),
    herrSinGit: join(base, "herr-sin-git"),
    py: join(base, "py"),
    rara: join(base, "py", "no-ejecutable"),
  };
  mkdirSync(e.principal);
  git(e.principal, "init", "-q");
  git(e.principal, "commit", "-q", "--allow-empty", "-m", "raíz");
  git(e.principal, "worktree", "add", "-q", "--detach", e.wt);
  for (const r of [e.wt, e.suelto]) {
    mkdirSync(join(r, "ai_server"), { recursive: true });
    copyFileSync(join(repoRoot, "ai_server", "lint.sh"), join(r, "ai_server", "lint.sh"));
  }
  // Lo único que `lint.sh --interprete` lanza fuera de bash.
  mkdirSync(e.herr);
  for (const orden of ["git", "dirname"]) symlinkSync(donde(orden), join(e.herr, orden));
  mkdirSync(e.herrSinGit);
  symlinkSync(donde("dirname"), join(e.herrSinGit, "dirname"));
  ejecutableVacio(join(e.py, "python3"));
  ejecutableVacio(join(e.py, "mipython"));
  writeFileSync(e.rara, "");
  chmodSync(e.rara, 0o644);
});

after(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

/** Pone y quita los dos `.venv` como pide el caso. */
function prepara(c: Caso): void {
  const venvs: Array<[string, boolean]> = [
    [join(e[c.raiz], ".venv"), c.venvPropio],
    [join(e.principal, ".venv"), c.venvPrincipal],
  ];
  for (const [dir, quiero] of venvs) {
    rmSync(dir, { recursive: true, force: true });
    if (quiero) ejecutableVacio(join(dir, "bin", "python"));
  }
}

function entorno(c: Caso): Record<string, string> {
  const herr = c.sinGit ? e.herrSinGit : e.herr;
  const env: Record<string, string> = { PATH: c.python3EnPath ? `${herr}:${e.py}` : herr, HOME: base };
  if (c.variable) env[ENV_PYTHON] = c.variable(e);
  return env;
}

/** El veredicto esperado, como ruta o nombre concreto. */
function esperado(c: Caso): string {
  switch (c.espera) {
    case "propio":
      return join(e[c.raiz], ".venv", "bin", "python");
    case "principal":
      return join(e.principal, ".venv", "bin", "python");
    case "python3":
      return "python3";
    case "var":
      return c.variable ? c.variable(e) : "(caso sin variable)";
    case "FALLO":
      return "FALLO";
  }
}

const bash = (c: Caso): string => {
  const r = spawnSync("/bin/bash", [join(e[c.raiz], "ai_server", "lint.sh"), "--interprete"], {
    env: entorno(c),
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return r.status === 0 ? r.stdout.trim() : "FALLO";
};

const js = (c: Caso): string => {
  try {
    return interpretePython(e[c.raiz], entorno(c));
  } catch {
    // El mensaje no se compara (bash no tiene por qué decir lo mismo): el
    // veredicto es «falla», y es justo lo que la tabla mide.
    return "FALLO";
  }
};

describe("el intérprete de Python: lint.sh y qa/lib/python.mjs dicen lo mismo (#717)", () => {
  it("la tabla tiene sujeto: cubre cada paso de la regla y los dos sentidos de la variable", () => {
    const veredictos = new Set(TABLA.map((c) => c.espera));
    assert.deepEqual([...veredictos].sort(), ["FALLO", "principal", "propio", "python3", "var"]);
  });

  for (const c of TABLA) {
    it(c.nota, () => {
      prepara(c);
      const quiero = esperado(c);
      assert.deepEqual({ bash: bash(c), js: js(c) }, { bash: quiero, js: quiero });
    });
  }
});
