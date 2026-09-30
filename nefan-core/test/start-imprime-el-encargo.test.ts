/** `./start.sh --preset <motor>` IMPRIME EL ENCARGO DEL MOTOR (tanda BX).
 *
 *  Lo que salió jugando (2026-09-30): el usuario arrancó la demo con
 *  `./start.sh --preset play`, como recomienda CLAUDE.md, y la salida acababa
 *  en «Press Ctrl+C…» sin decir qué pegar en el terminal del motor. La pausa
 *  que lo imprime solo corría en la TUI (`TUI_NEEDS_PAUSE` se calculaba en
 *  `run_tui`), y el camino por slug se la saltaba.
 *
 *  Se pregunta al script DE VERDAD con `--seco`: el mismo `run_selection`, con
 *  cada `start_*` sustituido por un eco en su envoltorio `arrancar`. Así se
 *  puede correr con el stack de otro en los puertos por defecto: no arranca
 *  nada ni toca un puerto, y el test lo comprueba con la foto de `ss`.
 *
 *  _lo_que_esto_NO_sujeta:
 *   · el arranque de verdad: `--seco` se bifurca en `arrancar`, en el
 *     preflight de servicios y antes de `follow_logs`; un `start_*` que falle
 *     con el puerto ocupado aborta `run_selection` ANTES de imprimir el
 *     encargo, y eso aquí no se ve;
 *   · la TUI: la pausa interactiva (`pause_for_claude_code`, con su `read`)
 *     no se ejerce — sin TTY no hay nadie que pulse Enter;
 *   · con el stack del jugador arriba, la foto de `ss` mira puertos que ya
 *     están ocupados: que no cambie prueba poco ahí (un arranque real se
 *     habría negado igual). Lo que sujeta de verdad es el eco `(seco)` de
 *     cada `start_*` y que el comando vuelva en milisegundos sin `wait`;
 *   · que el texto sea BUENO para el motor: eso lo mira
 *     `el-prompt-del-motor-no-enumera-kinds.test.ts` sobre el mismo fichero. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ENCARGO = readFileSync(fileURLToPath(new URL("../data/contract/encargo-del-motor.txt", import.meta.url)), "utf8").trim();

function seco(...args: string[]): { status: number | null; out: string } {
  // NEFAN_PORT_OFFSET vacío: el bloque por defecto, el del jugador. En seco
  // no se toca, y eso es justo lo que el test demuestra.
  const env = { ...process.env };
  delete env.NEFAN_PORT_OFFSET;
  const r = spawnSync("./start.sh", args, { cwd: REPO, env, encoding: "utf8", timeout: 30_000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Los puertos del catálogo (bloque por defecto) a la escucha. Solo el
 *  catálogo: la máquina tiene otros stacks y agentes abriendo puertos en
 *  paralelo, y una foto de TODO haría el test intermitente. */
const CATALOGO = new Set(
  Object.values(
    (JSON.parse(readFileSync(fileURLToPath(new URL("../data/runtime_config.json", import.meta.url)), "utf8")) as {
      ports: Record<string, number>;
    }).ports,
  ).map(String),
);
function puertosDelCatalogoALaEscucha(): string {
  return execFileSync("ss", ["-ltnH"], { encoding: "utf8" })
    .split("\n")
    .map((l) => /:(\d+)$/.exec(l.trim().split(/\s+/)[3] ?? "")?.[1] ?? "")
    .filter((p) => CATALOGO.has(p))
    .sort()
    .join(",");
}

describe("start.sh --preset <motor> imprime el encargo", () => {
  for (const preset of ["play", "playtest-motor", "story-web-sin-imagenes"]) {
    it(`${preset} --seco: sale 0 y trae el encargo ENTERO y cómo se engancha el motor`, () => {
      const r = seco("--preset", preset, "--seco");
      assert.equal(r.status, 0, r.out);
      assert.ok(r.out.includes(ENCARGO), `falta el encargo en la salida:\n${r.out}`);
      assert.match(r.out, /se engancha solo al primer narrative_listen/);
    });
  }

  for (const preset of ["html-fixtures", "e2e-sin-creditos"]) {
    it(`${preset} --seco: sin motor en juego, NO lo imprime`, () => {
      const r = seco("--preset", preset, "--seco");
      assert.equal(r.status, 0, r.out);
      assert.ok(!r.out.includes(ENCARGO), `un preset sin motor pide pegar el encargo:\n${r.out}`);
      // Premisa: el camino se recorrió de verdad (no salió antes de arrancar).
      assert.match(r.out, /\(seco\) start_html/);
    });
  }

  it("en seco no se abre ningún puerto del catálogo (foto de ss antes y después)", () => {
    const antes = puertosDelCatalogoALaEscucha();
    const r = seco("--preset", "play", "--seco");
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\(seco\) start_bridge/, "premisa: recorrió los arranques");
    assert.equal(puertosDelCatalogoALaEscucha(), antes);
  });

  it("--seco sin --preset es un error, no un arranque", () => {
    const r = seco("--seco");
    assert.notEqual(r.status, 0);
    assert.match(r.out, /--seco solo tiene sentido con --preset/);
  });
});
