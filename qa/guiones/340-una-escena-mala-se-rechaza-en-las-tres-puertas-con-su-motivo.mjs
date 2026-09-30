/** Una escena MALA se rechaza en las tres puertas, con su motivo (QA de #782, tanda BU).
 *
 *  Petición: que `formatDToWorld` reciba el tipo que el zod ya garantiza
 *  (`ExpandedScene`) y que desaparezca la validación a mano que lo repetía,
 *  con dos tolerancias que tapaban en silencio lo que el zod rechaza (`h` y
 *  `shape` inválidos caían al valor por defecto). Decisiones del coordinador:
 *  `cell` y `h` son FINITAS en el zod y en su espejo Python, y Python deja de
 *  descartar en silencio una `shape` inventada.
 *
 *  Lo que se mide, con escenas escritas como TEXTO JSON (el literal `1e400` es
 *  lo que un modelo puede escribir; `JSON.parse` y `json.loads` lo leen como
 *  Infinity/inf):
 *   1. la escena base la aceptan las CUATRO puertas: el pre-flight del motor
 *      (`validateContract(EmittedSceneSchema)`, que es lo que llama
 *      `validateFormatDScene` de narrative-mcp), el saneador Python
 *      (`validate_scene_response`), la puerta de lo crudo (`escenaCargable`, la
 *      del selector «Room») y la de escritura del bridge (`recordSceneLoaded`);
 *   2. `cell` 1e400, `h` 1e400, `shape` inventada y escena sin `tile` las
 *      rechazan las cuatro con SU motivo (no un TypeError, no un
 *      OverflowError): el motor recibe por qué;
 *   3. lo que la puerta ACEPTA pinta lo mismo por el camino del cliente
 *      (cruda → `escenaCargable`) que por el del bridge (`expandScenePrimitives`
 *      → gate → `formatDToWorld`), en las tres fixtures y en cinco tiles del
 *      motor falso.
 *
 *  Y los cuatro AGUJEROS que la QA midió abiertos y la vuelta del ingeniero
 *  cerró (2026-09-30). Eran verdes-si-abierto; hoy son ASERTOS:
 *   · A1 un `break` numérico en un módulo SIN medida en la huella. Se cierra en
 *     el TEST (`test/mutation-config.test.ts`, «un módulo del que la huella no
 *     trae NINGÚN fichero dice `sin medir`»), no en `leerPlan`, que es
 *     instrumento y tocarlo pide la corrida completa: `leerPlan` sigue
 *     aceptando el 0 y aquí se dice. Lo que se afirma es que el plan de hoy
 *     cumple la regla y que el candado existe con ese nombre.
 *   · A2 un entero de 401 cifras en `cell` o en `h` (texto JSON válido):
 *     Python lo rechaza con el MISMO motivo que el zod, sin OverflowError.
 *   · A3 lo registrado NO es la referencia del llamante: `gateEscenaExpandida`
 *     devuelve la salida del parseo, y mutar el objeto después no se pinta.
 *   · A4 la `shape` inventada se rechaza con UN texto en los dos procesos.
 *
 *  Probado en negativo en la QA (2026-09-30, worktree temporal sobre b2c3f4b3,
 *  un sabotaje por vez y restaurado): quitar `.finite()` de `cell` en el zod →
 *  rojo «cell_1e400: la rechaza pre / puerta / bridge» (las tres la aceptan:
 *  ya no queda ningún `throw` detrás que la cace); volver a DESCARTAR la
 *  `shape` inventada en Python → rojo en «shape_inventada: la rechaza python».
 *  Y en la vuelta (sabotajes del ingeniero): el gate devolviendo `raw` → rojo
 *  en A3; `_es_finito` sin el `try` → rojo en A2.
 *
 *  Grupo: HEADLESS (tsx + python3, sin navegador ni motor). */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "ejerce las puertas de escena en subprocesos (tsx + python3); no abre partida ni habla con el motor";
export const sinNavegador = "valida escenas escritas como texto JSON en subprocesos y compara world scenes; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");

/** Base mínima válida en las cuatro puertas: un jugador y una caja (la entity
 *  que se estropea en cada caso). */
const BASE = {
  scene_id: "tile_0_0",
  scene_description: "una escena de prueba",
  tile: { tx: 0, ty: 0 },
  biome: "grass",
  entities: [
    { id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1] },
    { id: "caja", kind: "prop", name: "Caja", cell: [4, 4], footprint: [1, 1] },
  ],
};
const CIFRAS_401 = "1" + "0".repeat(400);
/** Cada caso es TEXTO: `__X__` se sustituye por el literal crudo. */
function texto(mod, literal) {
  const o = structuredClone(BASE);
  mod(o);
  const t = JSON.stringify(o);
  return literal === undefined ? t : t.replace('"__X__"', literal);
}
const CASOS = {
  base: [texto(() => {}), null],
  cell_1e400: [texto((o) => { o.entities[1].cell = ["__X__", 4]; }, "1e400"), /`cell` son dos números FINITOS/],
  h_1e400: [texto((o) => { o.entities[1].h = "__X__"; }, "1e400"), /`h` es la altura en metros y debe ser un número FINITO/],
  shape_inventada: [texto((o) => { o.entities[1].shape = "pyramid"; }), /pyramid/],
  sin_tile: [texto((o) => { delete o.tile; }), /una escena necesita `tile`/],
};
const AGUJERO_A2 = {
  cell_401_cifras: texto((o) => { o.entities[1].cell = ["__X__", 4]; }, CIFRAS_401),
  h_401_cifras: texto((o) => { o.entities[1].h = "__X__"; }, CIFRAS_401),
};

const TS = `
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmittedSceneSchema } from ${JSON.stringify(join(CORE, "src/contract/model-io/scene-schema.ts"))};
import { validateContract } from ${JSON.stringify(join(CORE, "src/contract/model-io/validate.ts"))};
import { escenaCargable } from ${JSON.stringify(join(CORE, "src/scene/escena-cargable.ts"))};
import { expandScenePrimitives } from ${JSON.stringify(join(CORE, "src/scene/scene-expand.ts"))};
import { formatDToWorld } from ${JSON.stringify(join(CORE, "src/scene/scene-normalize.ts"))};
import { NarrativeState } from ${JSON.stringify(join(CORE, "src/narrative/narrative-state.ts"))};
import { MemorySessionStorage } from ${JSON.stringify(join(CORE, "src/narrative/session-storage.ts"))};
import { bootstrapTile, entradaEnMundoExistente, makeTile } from ${JSON.stringify(join(RAIZ, "labs/narrative/fake-scenes.ts"))};
import { leerPlan, RUTA_PLAN, RUTA_HUELLA, SIN_MEDIR } from ${JSON.stringify(join(CORE, "scripts/mutation-plan.ts"))};
const [casosPath, outPath] = process.argv.slice(2);
const { casos } = JSON.parse(readFileSync(casosPath, "utf8"));
const h = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
const msg = (e) => (e instanceof Error ? e.constructor.name + ": " + e.message : String(e));
const registrar = (escena) => new NarrativeState(new MemorySessionStorage()).recordSceneLoaded("tile_0_0", escena);

const puertas = {};
for (const [n, t] of Object.entries(casos)) {
  const pre = validateContract(EmittedSceneSchema, JSON.parse(t));
  let puerta = "ok";
  try { escenaCargable(JSON.parse(t)); } catch (e) { puerta = msg(e); }
  let bridge = "ok";
  try { registrar(expandScenePrimitives(JSON.parse(t))); } catch (e) { bridge = msg(e); }
  puertas[n] = { pre: pre.ok ? "ok" : pre.error, puerta, bridge };
}

// Camino del cliente (cruda → puerta) contra camino del bridge (expandir → gate de escritura).
const FX = ${JSON.stringify(join(CORE, "data/scenes"))};
const entradas = readdirSync(FX).filter((f) => f.endsWith(".json")).map((f) => ["fixture " + f, JSON.parse(readFileSync(join(FX, f), "utf8"))]);
const vecino = { tile: [0, 0], scene_id: "tile_0_0", description: "d", biome: "grass", crossings: [{ type: "river", at: 40, width: 4 }, { type: "path", at: 80 }] };
entradas.push(["falso bootstrapTile", bootstrapTile()]);
entradas.push(["falso entradaEnMundoExistente", entradaEnMundoExistente({ tx: 0, ty: 0, neighbors: { north: vecino } })]);
entradas.push(["falso makeTile sin vecinos", makeTile({ tx: 1, ty: 0, neighbors: {} })]);
entradas.push(["falso makeTile con río", makeTile({ tx: 0, ty: 1, neighbors: { north: vecino } })]);
entradas.push(["falso makeTile con lugar", makeTile({ tx: -1, ty: 2, neighbors: {}, place: { id: "forja", kind: "building", name: "La forja", description: "una forja" } })]);
const equivalencia = entradas.map(([n, raw]) => {
  try {
    const cli = formatDToWorld(escenaCargable(structuredClone(raw)));
    const bri = formatDToWorld(registrar(expandScenePrimitives(structuredClone(raw))));
    return { n, cli: h(cli), bri: h(bri), objetos: cli.objects.length, npcs: cli.npcs.length, cruda: raw.__expanded !== true };
  } catch (e) { return { n, error: msg(e) }; }
});

// A1: break 0 en un módulo sin medida en la huella.
const plan = JSON.parse(readFileSync(RUTA_PLAN, "utf8"));
const huella = JSON.parse(readFileSync(join(${JSON.stringify(CORE)}, RUTA_HUELLA), "utf8"));
const molde = plan.modulos.find((m) => m.id === "escena-cargable") ?? plan.modulos[0];
const fantasma = { ...molde, id: "qa-340-sin-medida", mutate: ["src/qa-340/no-existe.ts"], break: 0 };
// La regla sobre el plan REAL: un suelo numérico exige algún fichero medido.
const sinMedida = JSON.parse(readFileSync(RUTA_PLAN, "utf8")).modulos
  .filter((m) => m.break !== SIN_MEDIR && m.mutate.filter((f) => !f.startsWith("!")).every((f) => {
    if (!f.includes("*")) return huella.ficheros[f] === undefined;
    const pre = f.slice(0, f.indexOf("*"));
    return !Object.keys(huella.ficheros).some((k) => k.startsWith(pre));
  }))
  .map((m) => m.id);
plan.modulos.push(fantasma);
const dir = mkdtempSync(join(tmpdir(), "nefan-qa-340-plan-"));
writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
let a1;
try { const p = leerPlan(join(dir, "plan.json")); const m = p.modulos.find((x) => x.id === fantasma.id); a1 = { acepta: true, break: m.break, enHuella: huella.ficheros[fantasma.mutate[0]] !== undefined, sinMedir: SIN_MEDIR }; }
catch (e) { a1 = { acepta: false, error: msg(e) }; }
a1.sinMedida = sinMedida;
a1.candado = readFileSync(join(${JSON.stringify(CORE)}, "test/mutation-config.test.ts"), "utf8").includes("un módulo del que la huella no trae NINGÚN fichero dice \`sin medir\`");

// A3: la misma referencia del gate.
const original = expandScenePrimitives(JSON.parse(casos.base));
const ns = new NarrativeState(new MemorySessionStorage());
const reg = ns.recordSceneLoaded("tile_0_0", original);
original.entities.find((e) => e.id === "caja").shape = "pyramid";
let a3;
try {
  const w = formatDToWorld(ns.scenes_loaded["tile_0_0"].scene_data);
  a3 = { mismaRef: reg === original, pinta: w.objects.find((o) => o.id === "caja")?.shape ?? null };
} catch (e) { a3 = { mismaRef: reg === original, error: msg(e) }; }

rmSync(dir, { recursive: true, force: true });
writeFileSync(outPath, JSON.stringify({ puertas, equivalencia, a1, a3 }));
`;

const PY = `
import json, sys, copy
sys.path.insert(0, sys.argv[2])
from ai_server.narrative_schemas import validate_scene_response
datos = json.load(open(sys.argv[1]))
def veredicto(t):
    try:
        validate_scene_response(json.loads(t)); return "ok"
    except Exception as e:
        return type(e).__name__ + ": " + str(e)
out = {"casos": {n: veredicto(t) for n, t in datos["casos"].items()},
       "a2": {n: veredicto(t) for n, t in datos["a2"].items()}}
print("<<<" + json.dumps(out) + ">>>")
`;

export default async function (ctx) {
  const dir = mkdtempSync(join(tmpdir(), "nefan-qa-340-"));
  try {
    const casosPath = join(dir, "casos.json");
    const outPath = join(dir, "out.json");
    const tsPath = join(dir, "mide.mts");
    const pyPath = join(dir, "py.py");
    const casos = Object.fromEntries(Object.entries(CASOS).map(([n, [t]]) => [n, t]));
    writeFileSync(casosPath, JSON.stringify({ casos, a2: AGUJERO_A2 }));
    writeFileSync(tsPath, TS);
    writeFileSync(pyPath, PY);
    const rTs = spawnSync("npx", ["tsx", tsPath, casosPath, outPath], { cwd: CORE, encoding: "utf8", timeout: 180000 });
    if (rTs.status !== 0) throw new Error(`el subproceso tsx falló (${rTs.status}):\n${(rTs.stderr ?? "").slice(0, 1500)}`);
    const r = JSON.parse(readFileSync(outPath, "utf8"));
    const rPy = spawnSync("python3", [pyPath, casosPath, RAIZ], { cwd: RAIZ, encoding: "utf8", timeout: 180000 });
    const m = /<<<([\s\S]*?)>>>/.exec(`${rPy.stdout ?? ""}`);
    if (!m) throw new Error(`python3 no devolvió nada:\n${(rPy.stderr ?? "").slice(0, 1500)}`);
    const py = JSON.parse(m[1]);

    // 1 y 2 · las cuatro puertas
    const veredictos = (n) => ({ ...r.puertas[n], python: py.casos[n] });
    const vBase = veredictos("base");
    ctx.log(`  base: ${JSON.stringify(vBase)}`);
    ctx.expect(`la escena base la aceptan las cuatro puertas`, Object.values(vBase).every((x) => x === "ok"), JSON.stringify(vBase));
    for (const [n, [, motivo]] of Object.entries(CASOS).filter(([n]) => n !== "base")) {
      const v = veredictos(n);
      ctx.log(`  ${n}: ${Object.entries(v).map(([k, x]) => `${k}=${x === "ok" ? "ok" : x.slice(0, 110)}`).join(" · ")}`);
      for (const [puerta, x] of Object.entries(v)) {
        ctx.expect(`${n}: la rechaza ${puerta}`, x !== "ok", `aceptada por ${puerta}`);
        ctx.expect(`${n}: ${puerta} dice el MOTIVO (${motivo})`, x !== "ok" && motivo.test(x), x);
        ctx.expect(`${n}: ${puerta} no revienta con un error de runtime`, !/TypeError|OverflowError|RangeError/.test(x), x);
      }
    }

    // 3 · camino del cliente ≡ camino del bridge
    const fixtures = r.equivalencia.filter((e) => e.n.startsWith("fixture "));
    ctx.expect("hay tres fixtures en data/scenes, y están CRUDAS en disco", fixtures.length === 3 && fixtures.every((e) => e.cruda), JSON.stringify(fixtures.map((e) => [e.n, e.cruda])));
    for (const e of r.equivalencia) {
      ctx.log(`  ${e.n}: ${e.error ?? `cliente ${e.cli} · bridge ${e.bri} · ${e.objetos} objetos · ${e.npcs} npcs`}`);
      ctx.expect(`${e.n}: pinta lo mismo por el camino del cliente y por el del bridge`, !e.error && e.cli === e.bri, e.error ?? `${e.cli} ≠ ${e.bri}`);
      ctx.expect(`${e.n}: tiene algo que pintar`, !e.error && e.objetos + e.npcs > 0, JSON.stringify(e));
    }

    // Los cuatro agujeros de la QA, CERRADOS en la vuelta: ahora son asertos.
    ctx.log(`  A1: ${JSON.stringify(r.a1)}`);
    ctx.expect(
      "A1 · ningún módulo del plan trae un suelo numérico sin ningún fichero medido en la huella, y el candado de mutation-config.test.ts existe",
      r.a1.sinMedida.length === 0 && r.a1.candado === true,
      JSON.stringify(r.a1),
    );
    ctx.log(`  A1 (dicho, no aserto): leerPlan ${r.a1.acepta ? "sigue aceptando" : "ya rechaza"} \`break: 0\` — el cierre vive en el test, no en el instrumento`);
    ctx.log(`  A2: ${JSON.stringify(py.a2)}`);
    for (const [n, x] of Object.entries(py.a2)) {
      const motivo = n.startsWith("cell") ? /`cell` son dos números FINITOS/ : /`h` es la altura en metros y debe ser un número FINITO/;
      ctx.expect(`A2 · ${n}: Python lo rechaza con el motivo del zod y sin OverflowError`, /^ValueError/.test(x) && motivo.test(x), x);
    }
    ctx.log(`  A3: ${JSON.stringify(r.a3)}`);
    ctx.expect(
      "A3 · lo registrado no es la referencia del llamante, y una mutación posterior NO se pinta",
      r.a3.mismaRef === false && r.a3.pinta === null && !r.a3.error,
      JSON.stringify(r.a3),
    );
    const zodShape = r.puertas.shape_inventada.pre;
    const pyShape = py.casos.shape_inventada;
    const MOTIVO_SHAPE = "`shape` 'pyramid' no es una forma; las únicas son box | cylinder | sphere | cone";
    ctx.expect(
      "A4 · la `shape` inventada se rechaza con el MISMO texto en el zod y en Python",
      zodShape.includes(MOTIVO_SHAPE) && pyShape.includes(MOTIVO_SHAPE),
      `zod: ${zodShape} · python: ${pyShape}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
