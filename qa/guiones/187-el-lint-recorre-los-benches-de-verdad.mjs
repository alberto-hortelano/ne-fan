/** El lint recorre los benches DE VERDAD, en el árbol real (#744, tanda AY).
 *
 *  POR QUÉ EXISTE. El 186 demuestra el MECANISMO de `lint:labs` sobre un
 *  espejo de juguete. No mira el `labs/` real: si el glob de
 *  `eslint.labs.config.js` dejara de casar con la forma de los benches (una
 *  carpeta nueva, un ignore de más, una extensión), el 186 seguiría verde y el
 *  lint pasaría de largo. Es el análogo del 176 (A y D) para `labs/`; el 176
 *  sigue midiendo SOLO `qa/`.
 *
 *   A · la línea de `lint:labs` (desde la raíz, con `--format json`) devuelve
 *       EXACTAMENTE los `.js`/`.mjs`/`.cjs` que git ve bajo `labs/`
 *       (rastreados + no rastreados no ignorados, fuera de `node_modules`). El
 *       censo sale de `git ls-files`, no de un recorrido propio: así los `runs/`
 *       que los `.gitignore` de los benches dejan fuera no cuentan, y un fichero
 *       que ESLint mirara bajo `runs/` saldría «de más». Un lint que lintara
 *       cero en verde, o que se dejara una carpeta, sale ROJO con las dos cifras.
 *   B · y la REGLA se aplica en cada carpeta del censo: la config EFECTIVA
 *       (`--print-config`) lleva `no-unused-vars` en error con `^_` exento. En
 *       flat config un fichero que no casa con ningún `files` se procesa con
 *       CERO reglas y sale verde; estar en la lista de A no basta (la lección
 *       del 176 D en la QA de la tanda AU).
 *   C · el árbol está limpio: la pasada sale 0.
 *
 *  LO QUE NO MIDE: que un hallazgo ponga rojo (el 186), ni los `.ts` de
 *  `labs/`, que son de `typecheck:labs`.
 *
 *      node qa/run.mjs --sin-navegador 187
 *
 *  PRECONDICIÓN: `nefan-core/node_modules` (`npm ci`). Sin él sale ROJO
 *  diciéndolo, no ⊘.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** No abre partida: lanza eslint y git sobre el árbol y compara cifras. */
export const sinMotor = "corre eslint y git ls-files sobre labs/ en el árbol real y compara censos; no abre partida ni habla con el motor";
/** Ni página: el sujeto es un script de lint y lo que recorre. */
export const sinNavegador = "corre eslint en subprocesos sobre el árbol real y lee package.json; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const ESLINT = join(CORE, "node_modules", ".bin", "eslint");
const CONFIG = "nefan-core/eslint.labs.config.js";
const EXTENSIONES = [".js", ".mjs", ".cjs"];

function corre(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: RAIZ, encoding: "utf8" });
  if (r.error) throw r.error;
  return { rc: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const relativo = (abs) => abs.startsWith(`${RAIZ}/`) ? abs.slice(RAIZ.length + 1) : abs;
const diferencia = (a, b) => a.filter((x) => !b.includes(x));

export default async function (ctx) {
  // El script real no admite flags: se lanza su misma línea con `--format
  // json` desde la raíz, que es lo que hace `cd .. && eslint …`.
  const scripts = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")).scripts ?? {};
  ctx.expect(
    "`lint:labs` es la línea que este guion reproduce (config hermana sobre `labs`, desde la raíz)",
    scripts["lint:labs"] === `cd .. && eslint -c ${CONFIG} labs`,
    `lint:labs = ${JSON.stringify(scripts["lint:labs"])}`,
  );

  // ── C · limpio, y A · ni más ni menos ─────────────────────────────────────
  const eslint = corre(ESLINT, ["-c", CONFIG, "labs", "--format", "json"]);
  ctx.expect(
    "eslint con la config de los benches corre sobre `labs` desde la raíz y sale 0 (los benches están limpios)",
    eslint.rc === 0 && eslint.out.trim().startsWith("["),
    `rc=${eslint.rc}\n${(eslint.err || eslint.out).trim().split("\n").slice(-4).join("\n")}`,
  );
  const lintados = eslint.out.trim().startsWith("[") ? JSON.parse(eslint.out).map((f) => relativo(f.filePath)).sort() : [];

  const git = corre("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "labs"]);
  ctx.expect("git ls-files labs sale 0", git.rc === 0, git.err.trim());
  const benches = git.out
    .split("\n")
    .filter((l) => EXTENSIONES.some((e) => l.endsWith(e)))
    .filter((l) => !l.split("/").includes("node_modules"))
    .sort();
  const faltan = diferencia(benches, lintados);
  const sobran = diferencia(lintados, benches);
  ctx.log(`  · labs/: ${benches.length} .js/.mjs/.cjs · lintados: ${lintados.length}`);
  ctx.expect(
    "lint:labs linta EXACTAMENTE los .js/.mjs/.cjs de labs/ que ve git (ni cero, ni los de runs/, ni se deja una carpeta)",
    benches.length >= 14 && faltan.length === 0 && sobran.length === 0,
    `labs ${benches.length} · lintados ${lintados.length} · sin lint: ${faltan.slice(0, 5).join(", ") || "—"} · de más: ${sobran.slice(0, 5).join(", ") || "—"}`,
  );
  ctx.expect(
    "entre lo lintado están el motor emulado y el fichero de los 3 hallazgos del encendido",
    lintados.includes("labs/narrative/game-emulator.mjs") && lintados.includes("labs/authoring/three/escena.js"),
    lintados.filter((f) => f.endsWith("game-emulator.mjs") || f.endsWith("escena.js")).join(", "),
  );

  // ── B · la regla se aplica en cada carpeta ────────────────────────────────
  const carpetas = [...new Set(benches.map((f) => dirname(f)))].sort();
  const sinRegla = [];
  for (const carpeta of carpetas) {
    const muestra = benches.find((f) => dirname(f) === carpeta);
    const pc = corre(ESLINT, ["-c", CONFIG, "--print-config", muestra]);
    const regla = pc.rc === 0 ? JSON.parse(pc.out).rules?.["no-unused-vars"] : undefined;
    const severidad = Array.isArray(regla) ? regla[0] : regla;
    const opciones = Array.isArray(regla) ? regla[1] ?? {} : {};
    const activa = (severidad === 2 || severidad === "error") && opciones.varsIgnorePattern === "^_" && opciones.argsIgnorePattern === "^_";
    if (!activa) sinRegla.push(`${muestra} → ${JSON.stringify(regla)}`);
  }
  ctx.log(`  · carpetas de labs/: ${carpetas.join(", ")}`);
  ctx.expect(
    "en cada carpeta de labs/ la config EFECTIVA lleva `no-unused-vars` en error con `^_` exento (no solo «está en la lista»)",
    carpetas.length >= 3 && sinRegla.length === 0,
    sinRegla.join(" · ") || carpetas.join(", "),
  );
}
