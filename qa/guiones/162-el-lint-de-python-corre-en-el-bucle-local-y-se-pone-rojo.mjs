/** El lint de Python está en el bucle local y SE PUEDE PONER ROJO (#709, QA de
 *  la tanda AK).
 *
 *  POR QUÉ EXISTE. `ruff check ai_server` corría SOLO en el job `ai-server`
 *  de CI: un `E741` pasó tres vueltas de verificación local con el job en
 *  rojo (#709). La tanda AK lo mete en `npm run verify` a través de UN script,
 *  `ai_server/lint.sh`, que corren los dos lados. Este guion vuelve a
 *  demostrar, cada vez que se ejecuta, las cuatro cosas que el informe de la
 *  tanda afirma una sola vez:
 *
 *   1 · `verify` EMPIEZA por `lint:py`, `npm test` NO lo lleva (el job
 *       `nefan-core` de CI no tiene Python), y ruff + compileall no viven en
 *       ninguna otra línea ejecutable de `ci.yml` ni de `package.json`: UNA
 *       definición, no dos listas de rutas que diverjan (C3).
 *   2 · La versión de ruff está FIJADA en `ai_server/requirements-dev.txt`, CI
 *       instala ese fichero, la receta del `.venv` de `start.sh` lo cita, y la
 *       ruff que `lint.sh` acaba usando es la del pin (C2).
 *   3 · Con un `E741` sembrado en `ai_server/` el script sale ≠ 0 nombrándolo;
 *       con un `SyntaxError` en `labs/` que solo ve el compilador, también
 *       (compileall); y desde #718
 *       (tanda AU) ruff mira también `labs/`, con SUS reglas (`labs/ruff.toml`,
 *       `E4,E7,E9,F`): un `E741` o un `F841` en `labs/` lo ponen rojo, y un
 *       aviso de `pyupgrade` —que `ai_server/` sí tiene y `labs/` a propósito
 *       no— sale 0. Hasta la tanda AU esta siembra afirmaba lo contrario («un
 *       E741 en `labs/` sale 0»), porque ruff no se ampliaba a `labs/`.
 *   4 · Sin ruff, con una ruff de otra versión, con `NEFAN_PYTHON` inválida,
 *       sin pin o sin intérprete, `lint.sh` FALLA EN VOZ ALTA con la orden
 *       exacta de instalación. Y NUNCA sale 0 sin haber corrido ruff: un
 *       intérprete que dice tener la versión del pin pero cuyo `-m ruff check`
 *       revienta pone el script en rojo (C2, «nunca se salta en silencio»).
 *
 *  CÓMO. No escribe en el árbol de trabajo: copia `ai_server/` y `labs/` a un
 *  directorio temporal por cada siembra y lanza `bash <copia>/ai_server/lint.sh`
 *  allí. La copia no tiene `.venv` ni `.git`, así que el script no podría
 *  encontrar ruff por su cuenta: se le pasa `NEFAN_PYTHON` con el intérprete
 *  que el propio `lint.sh` eligió al correr en el árbol real (lo dice en su
 *  última línea), que es además la prueba de la rama explícita del
 *  resolvedor. Los fallos en voz alta se provocan con intérpretes FALSOS
 *  (scripts que contestan a `-m ruff --version` lo que se les manda), no con
 *  el `python3` de la máquina: en un portátil con la ruff del pin instalada
 *  a nivel de sistema ese caso saldría verde por accidente.
 *
 *  LO QUE NO MIDE, dicho para que nadie lo cite de más: no corre
 *  `npm run verify` entero (60 s, y escribiría en el árbol); afirma que
 *  `verify` EMPIEZA por `lint:py` y que `lint:py` es `lint.sh`, y de ahí que
 *  el rojo de `lint.sh` sea el rojo de `verify`. Tampoco prueba la rama del
 *  `.venv` del checkout principal vía `git-common-dir` (necesita un worktree
 *  real): esa, y el resto de la resolución del intérprete, la mide
 *  `nefan-core/test/python-interprete-paridad.test.ts` contra `qa/lib/python.mjs`
 *  con `lint.sh --interprete` (#717).
 *
 *      node qa/run.mjs --sin-navegador 162
 *
 *  PRECONDICIÓN: el árbol tiene un intérprete con la ruff del pin alcanzable
 *  (el `.venv` del checkout, el del principal desde un worktree, o
 *  `NEFAN_PYTHON`). Si no lo hay, el primer aserto sale ROJO diciendo cómo
 *  instalarla — que es exactamente el comportamiento que #709 pide de
 *  `lint.sh`, y por eso aquí tampoco es un ⊘. En el job `candados-headless`
 *  eso significa que el job instala `ai_server/requirements-dev.txt`.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** No abre partida: copia dos carpetas y lanza un bash. */
export const sinMotor = "copia ai_server/ y labs/ a un temporal y corre ai_server/lint.sh sobre siembras; no abre partida ni habla con el motor";
/** Ni página (#655): el sujeto es un script de shell y dos ficheros de configuración. */
export const sinNavegador = "corre ai_server/lint.sh en subprocesos y lee package.json, ci.yml y start.sh; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINT = "ai_server/lint.sh";
const REQ_DEV = "ai_server/requirements-dev.txt";
const PIN_RE = /^ruff==(\S+)\s*$/mu;
/** La última línea de `lint.sh` cuando todo va bien: versión e intérprete. */
const OK_RE = /^lint\.sh: ruff (\S+) \+ compileall OK \((.+)\)$/mu;

/** Corre `bash <lint>` con el entorno dado. `NEFAN_PYTHON` solo entra si se
 *  pide: `env.NEFAN_PYTHON === undefined` la QUITA, porque «puesta y vacía»
 *  es uno de los casos que se miden. */
function lint(raiz, env = {}) {
  const entorno = { ...process.env };
  delete entorno.NEFAN_PYTHON;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) entorno[k] = v;
  const r = spawnSync("bash", [join(raiz, LINT)], { cwd: raiz, encoding: "utf8", env: entorno });
  if (r.error) throw r.error;
  return { rc: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Una copia de `ai_server/` y `labs/` en un temporal, sin `.venv` ni `.git`. */
function copia(temporal, nombre) {
  const dir = join(temporal, nombre);
  for (const carpeta of ["ai_server", "labs"]) {
    cpSync(join(RAIZ, carpeta), join(dir, carpeta), {
      recursive: true,
      filter: (src) => !/(^|\/)(__pycache__|\.ruff_cache|node_modules)(\/|$)/u.test(src),
    });
  }
  return dir;
}

/** Un intérprete FALSO: contesta a `-m ruff --version` con `version` (o sale 1
 *  si es null) y a cualquier otra cosa con `rcResto`. */
function interpreteFalso(temporal, nombre, version, rcResto = 0) {
  const ruta = join(temporal, nombre);
  const respuesta = version === null ? "exit 1" : `echo "ruff ${version}"; exit 0`;
  writeFileSync(
    ruta,
    `#!/usr/bin/env bash\nif [ "\${1:-}" = -m ] && [ "\${2:-}" = ruff ] && [ "\${3:-}" = --version ]; then ${respuesta}; fi\necho "FALSO: $*"; exit ${rcResto}\n`,
  );
  chmodSync(ruta, 0o755);
  return ruta;
}

/** Las líneas ejecutables de un yml/json: fuera comentarios de `#`. */
const sinComentarios = (txt) => txt.split("\n").filter((l) => !/^\s*#/u.test(l)).join("\n");

export default async function (ctx) {
  // ── 1 · UNA definición: verify → lint:py → lint.sh; CI → lint.sh ──────────
  const pkg = JSON.parse(readFileSync(join(RAIZ, "nefan-core", "package.json"), "utf8"));
  const scripts = pkg.scripts ?? {};
  ctx.expect(
    "`lint:py` de nefan-core es `bash ../ai_server/lint.sh`",
    scripts["lint:py"] === "bash ../ai_server/lint.sh",
    `lint:py = ${JSON.stringify(scripts["lint:py"])}`,
  );
  ctx.expect(
    "`verify` EMPIEZA por `npm run lint:py` (lo más barato falla primero, y siempre, sin condicionarlo al diff)",
    typeof scripts.verify === "string" && scripts.verify.startsWith("npm run lint:py && "),
    `verify = ${JSON.stringify(scripts.verify)}`,
  );
  ctx.expect(
    "`npm test` NO corre el lint de Python (el job nefan-core de CI no tiene Python)",
    typeof scripts.test === "string" && !/lint:py|lint\.sh|ruff|compileall/u.test(scripts.test),
    `test = ${JSON.stringify(scripts.test)}`,
  );
  const ci = sinComentarios(readFileSync(join(RAIZ, ".github", "workflows", "ci.yml"), "utf8"));
  const invocaciones = ci.match(/^\s*- run: bash ai_server\/lint\.sh\s*$/gmu) ?? [];
  ctx.expect(
    "ci.yml lanza `bash ai_server/lint.sh` exactamente una vez (el job ai-server)",
    invocaciones.length === 1,
    `${invocaciones.length} invocaciones`,
  );
  const sueltos = ci.split("\n").filter((l) => /ruff check|compileall/u.test(l));
  ctx.expect(
    "ci.yml no corre `ruff check` ni `compileall` fuera del script: no hay segunda lista de rutas",
    sueltos.length === 0,
    `líneas ejecutables sueltas: ${sueltos.join(" | ")}`,
  );

  // ── 2 · La versión FIJADA, y los dos lados la instalan ─────────────────────
  const reqDev = readFileSync(join(RAIZ, REQ_DEV), "utf8");
  const pin = PIN_RE.exec(reqDev)?.[1] ?? "";
  ctx.expect("requirements-dev.txt fija UNA versión de ruff (ruff==X.Y.Z)", /^\d+\.\d+\.\d+$/u.test(pin), `pin = ${JSON.stringify(pin)}`);
  ctx.expect(
    "CI instala ruff desde ese mismo fichero (`pip install -r ai_server/requirements-dev.txt`)",
    /^\s*- run: pip install -r ai_server\/requirements-dev\.txt\b/mu.test(ci),
    "no hay `pip install -r ai_server/requirements-dev.txt` en ci.yml",
  );
  const startSh = readFileSync(join(RAIZ, "start.sh"), "utf8");
  ctx.expect(
    "la receta del .venv que da start.sh cita requirements-dev.txt (ruff entra en la receta escrita)",
    /pip install -r ai_server\/requirements\.txt -r ai_server\/requirements-dev\.txt/u.test(startSh),
    "start.sh no cita requirements-dev.txt en su remedio de «Python venv missing»",
  );

  // ── El positivo en el árbol REAL: de aquí sale el intérprete de las siembras
  const real = lint(RAIZ);
  const okReal = OK_RE.exec(real.out);
  ctx.expect(
    "lint.sh sale 0 en el árbol y dice la ruff y el intérprete que usó",
    real.rc === 0 && okReal !== null,
    `rc=${real.rc}\n${real.out.trim().split("\n").slice(-4).join("\n")}`,
  );
  const py = okReal?.[2] ?? null;
  ctx.expect(
    "la ruff que corrió es la del pin (lo que instala CI)",
    okReal !== null && okReal[1] === pin,
    `corrió ${okReal?.[1] ?? "?"}, pin ${pin}`,
  );
  ctx.log(`  · intérprete que eligió lint.sh en el árbol: ${py ?? "(ninguno)"}`);

  const temporal = mkdtempSync(join(tmpdir(), "guion-162-"));
  try {
    // ── 3 · Las siembras: lo que tiene que salir rojo, y lo que no ──────────
    // Cada siembra corre sobre su copia con NEFAN_PYTHON = el intérprete real.
    // Sin él (py === null) estas afirmaciones salen ROJAS con ese motivo, no
    // se saltan: es el mismo «nunca en silencio» que se le exige a lint.sh.
    const siembras = [
      {
        nombre: "un E741 sembrado en ai_server/ pone lint.sh en ROJO nombrándolo (era lo que pasaba tres vueltas)",
        fichero: "ai_server/tests/test_sembrado_por_el_guion_162.py",
        texto: "def sembrado_por_el_guion_162():\n    l = 1\n",
        espera: (r) => r.rc !== 0 && /E741/u.test(r.out),
        detalle: (r) => `rc=${r.rc}, ${/E741/u.test(r.out) ? "nombra E741" : "NO nombra E741"}`,
      },
      {
        // Un error que SOLO ve compileall. Hasta #718 la siembra era `def (:`,
        // pero desde que ruff mira labs/ ese lo caza ruff primero (`invalid-
        // syntax`) y el script sale antes de llegar a compileall: la siembra
        // seguía roja sin medir ya si compileall corre. Una codificación que no
        // existe la deja pasar ruff 0.15 (medido: rc 0) y la rechaza el
        // compilador.
        nombre: "un SyntaxError que ruff no ve (codificación inexistente) sembrado en labs/ pone lint.sh en ROJO (compileall)",
        fichero: "labs/sembrado_por_el_guion_162.py",
        texto: "# -*- coding: noexiste -*-\nx = 1\n",
        espera: (r) => r.rc !== 0 && /SyntaxError: unknown encoding/u.test(r.out),
        detalle: (r) => `rc=${r.rc}, ${/SyntaxError: unknown encoding/u.test(r.out) ? "nombra el SyntaxError de compileall" : "NO nombra el SyntaxError de compileall"}`,
      },
      {
        nombre: "un E741 sembrado en labs/ pone lint.sh en ROJO nombrándolo: ruff mira labs/ (#718)",
        fichero: "labs/sembrado_por_el_guion_162.py",
        texto: "def sembrado_por_el_guion_162():\n    l = 1\n",
        espera: (r) => r.rc !== 0 && /E741/u.test(r.out),
        detalle: (r) => `rc=${r.rc}, ${/E741/u.test(r.out) ? "nombra E741" : "NO nombra E741: ruff no miró labs/"}`,
      },
      {
        nombre: "un F841 (variable asignada y nunca usada) sembrado en labs/ pone lint.sh en ROJO nombrándolo",
        fichero: "labs/sembrado_por_el_guion_162.py",
        texto: "def sembrado_por_el_guion_162():\n    muerta = 1\n",
        espera: (r) => r.rc !== 0 && /F841/u.test(r.out),
        detalle: (r) => `rc=${r.rc}, ${/F841/u.test(r.out) ? "nombra F841" : "NO nombra F841: ruff no miró labs/"}`,
      },
      {
        // El control de la DECISIÓN de labs/ruff.toml: labs/ no hereda las
        // reglas de ai_server/ (UP cambia con cada ruff, y un bench que se
        // retoma cada pocos meses nacería rojo). Con `extend` al pyproject de
        // ai_server/ esta siembra sale ROJA con UP032.
        nombre: "un aviso de pyupgrade (UP032) sembrado en labs/ sale 0: labs/ tiene sus reglas, no las de ai_server/",
        fichero: "labs/sembrado_por_el_guion_162.py",
        texto: 'print("{}".format(1))\n',
        espera: (r) => r.rc === 0 && !/UP032/u.test(r.out),
        detalle: (r) => `rc=${r.rc}, ${/UP032/u.test(r.out) ? "labs/ recibió UP032 (¿hereda de ai_server/?)" : "sin UP032"}`,
      },
    ];
    for (const [i, s] of siembras.entries()) {
      if (py === null) {
        ctx.expect(s.nombre, false, "no hay intérprete con la ruff del pin: mira el positivo de arriba");
        continue;
      }
      // Un directorio por siembra: `labs/fps/sprites` es un enlace simbólico
      // commiteado a arte generado que un worktree no tiene, y copiar DOS
      // veces sobre el mismo destino hace `stat` del enlace colgante y revienta.
      const dir = copia(temporal, `siembra-${i + 1}`);
      writeFileSync(join(dir, s.fichero), s.texto);
      const r = lint(dir, { NEFAN_PYTHON: py });
      ctx.expect(s.nombre, s.espera(r), s.detalle(r));
    }

    // ── 4 · Falla en voz alta, y nunca sale 0 sin haber corrido ruff ────────
    const limpia = copia(temporal, "limpia");
    // La orden va con la ruta ABSOLUTA del árbol que se lintó: relativa a la
    // raíz daba «No such file» copiada desde nefan-core/ (hallazgo de QA).
    const ordenExacta = `-m pip install -r "${join(limpia, "ai_server", "requirements-dev.txt")}"`;
    const ORDEN = { test: (/** @type {string} */ out) => out.includes(ordenExacta) };
    const fallos = [
      {
        nombre: "sin ruff en el intérprete → rc≠0 con la orden exacta de instalación",
        env: { NEFAN_PYTHON: interpreteFalso(temporal, "py-sin-ruff", null) },
        espera: (r) => r.rc !== 0 && /no está instalado/u.test(r.out) && ORDEN.test(r.out),
      },
      {
        nombre: "ruff de OTRA versión que el pin → rc≠0 diciendo las dos y la orden",
        env: { NEFAN_PYTHON: interpreteFalso(temporal, "py-otra-ruff", "0.0.1") },
        espera: (r) => r.rc !== 0 && /0\.0\.1/u.test(r.out) && r.out.includes(pin) && ORDEN.test(r.out),
      },
      {
        nombre: "un intérprete que DICE tener la ruff del pin pero cuyo `-m ruff check` revienta → rc≠0 (el que se comprueba es el que se ejecuta)",
        env: { NEFAN_PYTHON: interpreteFalso(temporal, "py-miente", pin, 3) },
        espera: (r) => r.rc !== 0 && !OK_RE.test(r.out),
      },
      {
        nombre: "NEFAN_PYTHON puesta y VACÍA → rc≠0 (no es «sin variable»)",
        env: { NEFAN_PYTHON: "" },
        espera: (r) => r.rc !== 0 && /NEFAN_PYTHON/u.test(r.out),
      },
      {
        nombre: "NEFAN_PYTHON a una ruta que no existe → rc≠0 nombrándola",
        env: { NEFAN_PYTHON: join(temporal, "no", "existe") },
        espera: (r) => r.rc !== 0 && /no es un ejecutable/u.test(r.out),
      },
    ];
    for (const f of fallos) {
      const r = lint(limpia, f.env);
      ctx.expect(f.nombre, f.espera(r), `rc=${r.rc}\n${r.out.trim().split("\n").slice(-3).join("\n")}`);
    }

    // Sin pin en requirements-dev.txt no hay contra qué comparar: rojo, no
    // «la que haya».
    const sinPin = copia(temporal, "sin-pin");
    writeFileSync(join(sinPin, REQ_DEV), readFileSync(join(sinPin, REQ_DEV), "utf8").replace(PIN_RE, "# (sin pin)"));
    const rPin = lint(sinPin, { NEFAN_PYTHON: py ?? interpreteFalso(temporal, "py-cualquiera", "9.9.9") });
    ctx.expect(
      "requirements-dev.txt SIN pin → rc≠0 (no compara contra «la que haya»)",
      rPin.rc !== 0 && /no fija la versión/u.test(rPin.out),
      `rc=${rPin.rc}\n${rPin.out.trim().split("\n").slice(-2).join("\n")}`,
    );

    // Sin NEFAN_PYTHON, sin .venv (la copia no tiene) y sin python3 en el PATH:
    // rojo con la receta del venv. El PATH restringido lleva SOLO lo que el
    // script necesita para llegar a esa línea (dirname, sed, awk, git), y bash
    // se lanza por su ruta absoluta porque el hijo resuelve con el PATH nuevo.
    const binSinPy = join(temporal, "bin-sin-python");
    mkdirSync(binSinPy);
    const herramientas = spawnSync("bash", ["-c", "command -v bash dirname sed awk git"], { encoding: "utf8" });
    const rutas = (herramientas.stdout ?? "").trim().split("\n");
    ctx.expect("la máquina tiene bash, dirname, sed, awk y git (lo que lint.sh necesita antes de buscar Python)", rutas.length === 5, rutas.join(", "));
    for (const ruta of rutas.slice(1)) symlinkSync(ruta, join(binSinPy, basename(ruta)));
    const r = spawnSync(rutas[0], [join(limpia, LINT)], {
      cwd: limpia,
      encoding: "utf8",
      env: { PATH: binSinPy, HOME: process.env.HOME ?? "" },
    });
    const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    ctx.expect(
      "sin NEFAN_PYTHON, sin .venv y sin python3 en el PATH → rc≠0 con la receta para crear el venv",
      (r.status ?? -1) !== 0 && /no hay intérprete de Python/u.test(salida) && /requirements-dev\.txt/u.test(salida),
      `rc=${r.status}\n${salida.trim().split("\n").slice(-2).join("\n")}`,
    );
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}
