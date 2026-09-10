#!/usr/bin/env node
/** LOS DOS GATES DE ESCENA REBOTAN UNA CLAVE RETIRADA CON EL MISMO TEXTO.
 *
 *  Una escena del motor pasa por DOS validadores: el pre-flight zod de
 *  narrative-mcp (`EmittedSceneSchema`) y el saneador Python de ai_server
 *  (`validate_scene_response`). Cuando trae una clave RETIRADA —el anclaje de
 *  lugar declarado en la escena, el char ASCII de la entity, el decor pegado al
 *  muro…—, los dos tienen que decirle al motor lo mismo palabra por palabra: el
 *  mismo tile no puede recibir dos textos según por dónde entre.
 *
 *  ESCRITO POR QA (T13, 2026-09-05) Y NACIÓ ROJO, con **cinco divergencias**
 *  medidas sobre `main` con los 2.476 tests de nefan-core y los de ai_server en
 *  verde: DOS de las claves de entity, puestas en la RAÍZ, las rebotaba el zod
 *  con su motivo de retirada y Python con el genérico («EXACTAMENTE estos
 *  campos»), y en la ENTITY el rótulo difería (`la entity "p"` contra
 *  `entity 'p'`). Viaja en el cuerpo de #466 porque un guion que nace rojo no
 *  se commitea (regla de T10);
 *  entra aquí verde, con la causa arreglada: los motivos y el rótulo son UNA
 *  fuente (`nefan-core/src/contract/model-io/retired-terrain-fields.ts`) que
 *  `scripts/dump-campos-retirados.ts` vuelca a `data/contract/campos-retirados.json`,
 *  y `ai_server/campos_retirados.py` LEE en vez de copiar.
 *
 *  Lo que se comprueba, con una escena mínima válida más la clave:
 *   1. el conjunto de claves retiradas es el MISMO en los dos registros — el
 *      del zod sale del fuente TS, el de Python del snapshot, así que un
 *      snapshot rancio se ve aquí además de en `contract-campos-retirados.test.ts`;
 *   2. para cada una, el primer issue del zod y la excepción de Python son
 *      idénticos, y ninguno es el genérico;
 *   3. ídem para las claves retiradas de entity;
 *   4. la escena sin la clave la ACEPTAN los dos (si no, el rebote no dice nada).
 *
 *  NINGÚN NOMBRE DE CAMPO RETIRADO SE ESCRIBE AQUÍ, y no es estilo: los dos
 *  lados los recorren de su registro, así que una retirada nueva entra sola en
 *  la medida — y este fichero no necesita exención en `campos-retirados-no-vuelven`
 *  (cuyos roots incluyen los .mjs de `qa/`), que le dejaría ciego a los treinta
 *  términos del patrón, no solo a los de aquí.
 *
 *  Probado en negativo (2026-09-10), un sabotaje por vez y restaurado byte a
 *  byte: (a) una palabra cambiada en un motivo de `retired-terrain-fields.ts`
 *  SIN regenerar el snapshot → rojo nombrando la clave y los dos textos;
 *  (b) el rótulo de la entity escrito a mano otra vez en `narrative_schemas.py`
 *  (`f"entity '{eid}'"`) → dos rojos, uno por clave de entity.
 *
 *  Grupo: HEADLESS (sin navegador; tsx + python3 con las deps de ai_server).
 *  Dado de alta en el job `candados-headless` de `.github/workflows/ci.yml`.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(RAIZ, "nefan-core");
const PYTHON = process.env.PYTHON ?? "python3";

/** Escena mínima VÁLIDA en los dos gates (la misma que `base_scene()` del
 *  test Python). Cada caso añade una clave encima. */
const BASE = {
  scene_id: "tile_0_0",
  scene_description: "una escena de prueba",
  tile: { tx: 0, ty: 0 },
  biome: "grass",
  entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1] }],
};

const TS = `
  const { EmittedSceneSchema } = await import("./src/contract/model-io/scene-schema.ts");
  const { CLAVES_RETIRADAS, CLAVES_RETIRADAS_SOLO_DE_RAIZ } = await import("./src/contract/model-io/retired-terrain-fields.ts");
  const BASE = ${JSON.stringify(BASE)};
  const primerIssue = (escena) => {
    const r = EmittedSceneSchema.safeParse(escena);
    return r.success ? null : r.error.issues[0].message;
  };
  const raiz = {};
  for (const k of [...CLAVES_RETIRADAS, ...CLAVES_RETIRADAS_SOLO_DE_RAIZ]) {
    raiz[k] = primerIssue({ ...BASE, [k]: { x: 1 } });
  }
  const entity = {};
  for (const k of CLAVES_RETIRADAS) {
    const e = { ...BASE.entities[0], [k]: "x" };
    entity[k] = primerIssue({ ...BASE, entities: [e] });
  }
  console.log(JSON.stringify({ raiz, entity, baseAceptada: primerIssue(BASE) === null }));
`;

const PY = `
import json, sys, copy
sys.path.insert(0, "ai_server")
from narrative_schemas import validate_scene_response
from campos_retirados import MOTIVO_DE_CLAVE_RETIRADA, MOTIVO_DE_CLAVE_DE_ENTITY_RETIRADA
BASE = json.loads(${JSON.stringify(JSON.stringify(BASE))})
def rebote(escena):
    try:
        validate_scene_response(copy.deepcopy(escena)); return None
    except ValueError as e:
        return str(e)
raiz = {}
for k in MOTIVO_DE_CLAVE_RETIRADA:
    s = copy.deepcopy(BASE); s[k] = {"x": 1}
    raiz[k] = rebote(s)
entity = {}
for k in MOTIVO_DE_CLAVE_DE_ENTITY_RETIRADA:
    s = copy.deepcopy(BASE); s["entities"][0][k] = "x"
    entity[k] = rebote(s)
print(json.dumps({"raiz": raiz, "entity": entity, "baseAceptada": rebote(BASE) is None}))
`;

function correr(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 2).join(" ")} → exit ${r.status}\n${r.stderr}`);
  }
  const lineas = r.stdout.trim().split("\n");
  return JSON.parse(lineas[lineas.length - 1]);
}

const ts = correr("node", ["--import", "tsx", "--input-type=module", "-e", TS], CORE);
const py = correr(PYTHON, ["-c", PY], RAIZ);

let fallos = 0;
const falla = (msg) => {
  fallos++;
  console.log(`🔴 ${msg}`);
};
const ok = (msg) => console.log(`✔ ${msg}`);

if (!ts.baseAceptada || !py.baseAceptada) falla(`la escena base no la aceptan los dos (zod ${ts.baseAceptada}, python ${py.baseAceptada}): el rebote no diría nada`);
else ok("la escena base la aceptan los dos gates");

for (const nivel of ["raiz", "entity"]) {
  const claveTs = Object.keys(ts[nivel]).sort();
  const clavePy = Object.keys(py[nivel]).sort();
  if (JSON.stringify(claveTs) !== JSON.stringify(clavePy)) {
    falla(`${nivel}: los dos registros no retiran las mismas claves · zod ${JSON.stringify(claveTs)} · python ${JSON.stringify(clavePy)}`);
  } else ok(`${nivel}: las mismas ${claveTs.length} claves retiradas en los dos registros (${claveTs.join(", ")})`);
  for (const k of new Set([...claveTs, ...clavePy])) {
    const a = ts[nivel][k] ?? null;
    const b = py[nivel][k] ?? null;
    if (a === null || b === null) {
      falla(`${nivel}.${k}: uno de los dos no rebota (zod ${JSON.stringify(a)} · python ${JSON.stringify(b)})`);
    } else if (a !== b) {
      falla(`${nivel}.${k}: los dos gates dicen cosas distintas\n     zod    : ${a}\n     python : ${b}`);
    } else if (/EXACTAMENTE estos campos/.test(a)) {
      falla(`${nivel}.${k}: se rebota con el genérico, no con el motivo de la retirada`);
    } else ok(`${nivel}.${k}: el mismo texto en los dos gates`);
  }
}

console.log("─".repeat(70));
if (fallos) {
  console.log(`🔴 ${fallos} divergencia(s) entre el zod y el espejo Python`);
  process.exit(1);
}
console.log("✔ los dos gates rebotan cada clave retirada con el mismo texto");
