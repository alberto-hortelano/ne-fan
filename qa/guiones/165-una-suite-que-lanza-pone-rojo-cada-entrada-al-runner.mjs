/** UNA SUITE QUE LANZA PONE ROJO EL RUNNER, POR TODAS SUS FORMAS (#697).
 *
 *  El hecho: `node --test` anterior a v24.15.0 salía con 0 cuando una suite
 *  fallaba por sí misma —la suite desaparecía del resumen (`ℹ tests 0 · fail
 *  0`) y el build quedaba verde—. Desde v24.15.0 Node sale con 1 él solo
 *  (bisección con binarios oficiales: 24.11.1 y 24.14.1 salen 0; 24.15.0 y
 *  26.10.0 salen 1), y `nefan-core` declara `engines: >=24.15`. El test hermano
 *  (`nefan-core/test/una-suite-que-falla-pone-rojo.test.ts`) canda `npm test` y
 *  `npm run coverage` con UNA forma del fallo (un `JSON.parse` síncrono). Esto
 *  la canda por FORMAS: seis maneras de que una suite falle por sí misma, que
 *  el Node viejo dejaba MUDAS —`throw` síncrono, `describe` async que rechaza,
 *  `throw` de un STRING (no un Error), un `describe` anidado que lanza dentro de
 *  uno verde, un hook `after` que lanza y un `describe` sin ningún `it`—. Cada
 *  una corre por la línea REAL de `scripts.test` (la de `package.json`, con el
 *  glob sustituido) y tiene que salir ≠ 0 y NOMBRADA con `✖`. Controles: una
 *  suite verde sale 0; un `before` que lanza (que Node contaba ya antes) sale
 *  ≠ 0.
 *
 *  Corrido con un Node < 24.15 en el PATH, las seis formas salen ROJAS: es el
 *  mismo candado del suelo de `engines` que el test hermano, por formas.
 *
 *  LO QUE NO MIRA: `scripts.coverage` por formas (el test hermano la cubre con
 *  una y cuesta un proceso instrumentado por forma); ni a quien decide por el
 *  RESUMEN en vez de por el código de salida: Node cuenta la suite en `status`
 *  pero no en `ℹ fail` (sale `ℹ fail 0` también en v26). Que todo lector del
 *  resumen decida también por el código de salida lo sujeta el padrón de
 *  `nefan-core/test/quien-lee-el-resumen-del-runner.test.ts`.
 *
 *  Cero créditos: no abre partida ni página. Escribe sus fixtures en un
 *  temporal del sistema (nunca en el árbol), lo borra en `finally`, y no toca
 *  ningún fichero del repo. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** El guardarraíl de gasto: corre `node --test` sobre fixtures de un temporal;
 *  ni partida ni motor. */
export const sinMotor = "corre node --test sobre fixtures temporales; no abre partida ni habla con el motor";
/** Ni página (#655): el runner de tests y el disco. */
export const sinNavegador = "mide el código de salida de node --test; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const GLOB = "test/*.test.ts";

/** Cada forma: nombre de fichero, nombre de la suite (lo que `spec` tiene que
 *  imprimir tras `✖`) y el cuerpo. */
const FORMAS = [
  ["throw-sincrono", "throw síncrono en el cuerpo", `describe("throw síncrono en el cuerpo", () => { JSON.parse("{roto"); it("no llega", () => {}); });`],
  ["async-rechaza", "describe async que rechaza", `describe("describe async que rechaza", async () => { await Promise.resolve(); throw new Error("async roto"); });`],
  ["throw-string", "throw de un string", `describe("throw de un string", () => { throw "cadena"; });`],
  ["anidado", "hijo que lanza", `describe("padre verde", () => { it("verde del padre", () => {}); describe("hijo que lanza", () => { JSON.parse("{roto"); it("no llega", () => {}); }); });`],
  ["after-lanza", "after que lanza", `describe("after que lanza", () => { after(() => { throw new Error("after roto"); }); it("verde", () => {}); });`],
  ["sin-it", "describe sin ningún it que lanza", `describe("describe sin ningún it que lanza", () => { throw new Error("sin hijos"); });`],
];
const CONTROL_ROJO = ["before-lanza", "before que lanza", `describe("before que lanza", () => { before(() => { JSON.parse("{roto"); }); it("no corre", () => {}); });`];
const CONTROL_VERDE = ["verde", "verde", `describe("verde", () => { it("pasa", () => {}); });`];

const scripts = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")).scripts;

/** La línea REAL de `scripts.test` con el glob sustituido por la fixture, como
 *  la correría npm (`sh -c`), a concurrencia 1 y sin `NODE_TEST_CONTEXT`: si
 *  este guion corriera desde dentro de un `node --test`, el hijo se portaría
 *  como hijo y no pasaría por los reporters de su línea. */
function corre(linea, fixture) {
  const env = { ...process.env, NEFAN_TEST_CONCURRENCY: "1" };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync("sh", ["-c", linea.replace(GLOB, fixture)], { cwd: CORE, encoding: "utf8", env, timeout: 120000 });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = /^ℹ fail (\d+)$/m.exec(salida);
  return { status: r.status, fallos: m ? Number(m[1]) : -1, salida };
}

export default async function (ctx) {
  const version = spawnSync("node", ["--version"], { encoding: "utf8" }).stdout?.trim() ?? "¿?";
  ctx.log(`  · Node ${version}`);
  ctx.expect(
    "scripts.test de nefan-core nombra el glob una vez",
    typeof scripts.test === "string" && scripts.test.split(GLOB).length === 2,
    `scripts.test = ${JSON.stringify(scripts.test)}`,
  );

  const dir = mkdtempSync(join(tmpdir(), "nefan-165-"));
  try {
    const cabecera = `import { describe, it, before, after } from "node:test";\n`;
    const ruta = ([fichero, , cuerpo]) => {
      const p = join(dir, `${fichero}.mjs`);
      writeFileSync(p, cabecera + cuerpo + "\n");
      return p;
    };

    const verde = corre(scripts.test, ruta(CONTROL_VERDE));
    ctx.expect(
      "control: una suite verde sale 0 por la línea de npm test y nada sale con ✖",
      verde.status === 0 && verde.fallos === 0 && !verde.salida.includes("✖"),
      `EXIT ${verde.status} · fail ${verde.fallos}\n${verde.salida.slice(-600)}`,
    );

    const control = corre(scripts.test, ruta(CONTROL_ROJO));
    ctx.expect(
      "control: un `before` que lanza sale ≠ 0 (Node lo contaba ya antes de v24.15)",
      control.status !== 0,
      `EXIT ${control.status} · fail ${control.fallos}`,
    );

    for (const forma of FORMAS) {
      const [, suite] = forma;
      const r = corre(scripts.test, ruta(forma));
      ctx.expect(
        `forma «${suite}»: por la línea de npm test sale ≠ 0 y se nombra`,
        r.status !== 0 && r.salida.includes(`✖ ${suite}`),
        `Node ${version} · EXIT ${r.status} · fail ${r.fallos}\n${r.salida.slice(-600)}`,
      );
      ctx.log(`  · «${suite}»: EXIT ${r.status} (ℹ fail ${r.fallos})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
