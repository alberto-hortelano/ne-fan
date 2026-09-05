/** Candado de las fixtures de escena: en `data/scenes/**` solo hay Format D
 *  VIVO — el tile del mundo continuo, que es la única variante.
 *
 *  El zod (`EmittedSceneSchema`) canda la salida del MOTOR, pero las fixtures
 *  del repo no pasan por él: las cargan el selector del cliente y los guiones
 *  de QA. Sin este
 *  test, una escena de una variante retirada (la "suelta" del issue #172, el
 *  plató proscenio) podría quedarse en el árbol para siempre, viva y
 *  renderizándose, mientras el contrato dice que no existe.
 *
 *  El escaneo va en una función con el directorio por parámetro para poder
 *  probarlo EN NEGATIVO sobre un árbol sintético: un candado que no se ha
 *  visto fallar no es un candado. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";

import { EmittedSceneSchema, ExpandedSceneSchema } from "../src/contract/model-io/scene-schema.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { validateScene } from "../src/scene/scene-validate.js";

const SCENES = fileURLToPath(new URL("../data/scenes", import.meta.url));

interface Hallazgo {
  file: string;
  error: string;
}

/** Todos los .json del árbol, en orden estable. */
function escenasDe(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...escenasDe(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Audita las fixtures de `dir`: cada una debe declarar `tile` y pasar el
 *  gate estructural de Format D. Devuelve los hallazgos (vacío = ok).
 *  Las fixtures son PRE-expansión (Format D crudo), que es justo lo que el
 *  schema valida. */
export function auditarEscenas(dir: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const path of escenasDe(dir)) {
    const file = relative(dir, path);
    let scene: Record<string, unknown>;
    try {
      scene = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      hallazgos.push({ file, error: `no es JSON válido: ${(err as Error).message}` });
      continue;
    }
    if (scene.tile === undefined) {
      hallazgos.push({
        file,
        error: "escena sin `tile`: la suelta y el plató proscenio se retiraron — solo queda el mundo continuo",
      });
      continue;
    }
    const parsed = EmittedSceneSchema.safeParse(scene);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      hallazgos.push({ file, error: `${first.path.join(".") || "(raíz)"}: ${first.message}` });
    }
  }
  return hallazgos;
}

describe("fixtures de data/scenes — solo tiles", () => {
  it("todas las escenas del repo declaran su variante y pasan el gate", () => {
    const escenas = escenasDe(SCENES);
    assert.ok(escenas.length >= 2, `esperaba ≥2 fixtures, encontré ${escenas.length} (¿directorio equivocado?)`);
    assert.deepEqual(auditarEscenas(SCENES), []);
  });

  // ── El candado, en negativo ──────────────────────────────────────────────
  const arbolTemporal = (escenas: Record<string, unknown>): string => {
    const dir = mkdtempSync(join(tmpdir(), "nefan-scenes-"));
    for (const [name, scene] of Object.entries(escenas)) {
      const path = resolve(dir, name);
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, JSON.stringify(scene), "utf-8");
    }
    return dir;
  };

  const tileValido = {
    scene_id: "tile_0_0",
    scene_description: "Un campo de prueba.",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    entities: [],
  };

  const suelta = {
    scene_id: "aldea_suelta",
    scene_description: "Una aldea sin sitio en el mundo.",
    size: { cols: 4, rows: 2, meters_per_cell: 2 },
    terrain: ["gggg", "gggg"],
    entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1] }],
  };

  it("caza una escena suelta perfectamente formada (el caso del issue #172)", () => {
    const dir = arbolTemporal({ "vivo.json": tileValido, "suelta.json": suelta });
    const hallazgos = auditarEscenas(dir);
    assert.equal(hallazgos.length, 1, JSON.stringify(hallazgos));
    assert.equal(hallazgos[0].file, "suelta.json");
    assert.match(hallazgos[0].error, /tile/);
  });

  it("caza también un plató: el bloque `stage` no lo salva", () => {
    const plato = {
      ...suelta,
      scene_id: "posada_salon",
      place_id: "posada_salon",
      stage: {
        exits: [
          { id: "puerta", edge: "north", to_place_id: "cocina", zone: [1, 0, 2, 1], kind: "door", label: "Puerta" },
        ],
      },
    };
    const dir = arbolTemporal({ "vivo.json": tileValido, "plato.json": plato });
    const hallazgos = auditarEscenas(dir);
    assert.equal(hallazgos.length, 1, JSON.stringify(hallazgos));
    assert.equal(hallazgos[0].file, "plato.json");
    assert.match(hallazgos[0].error, /tile/);
  });

  it("caza también un tile que no pasa el gate estructural (subdirectorios incluidos)", () => {
    const dir = arbolTemporal({
      "vivo.json": tileValido,
      "sub/roto.json": { ...tileValido, scene_id: "tile_1_0", tile: { tx: 1, ty: 0 }, size: { cols: 4, rows: 2, meters_per_cell: 2 } },
    });
    const hallazgos = auditarEscenas(dir);
    assert.equal(hallazgos.length, 1, JSON.stringify(hallazgos));
    assert.equal(hallazgos[0].file, join("sub", "roto.json"));
    assert.match(hallazgos[0].error, /size/);
  });
});

/** El candado de la FRONTERA entre las dos poblaciones (#237), y es de ida y
 *  vuelta a propósito: comprobar solo un lado deja pasar el error que costó el
 *  reencuadre — un schema que describe lo que el modelo EMITE apuntado a lo
 *  que el juego CARGA, que rechazaría TODOS los snapshots y apagaría el
 *  arranque.
 *
 *  Va sobre las 3 fixtures COMMITEADAS de `data/scenes/`, nunca sobre los
 *  snapshots de `data/games/<juego>/world/`: esos están en `.gitignore` (ver
 *  el comentario de abajo), así que un test sobre ellos sería verde vacío en
 *  CI. Los snapshots se comprueban donde se CARGAN —`loadWorldSnapshot`, con
 *  artefacto sintético en `world-snapshot.test.ts`—, no recorriendo el disco. */
describe("la frontera entre lo que el motor emite y lo que el juego carga", () => {
  it("cruda ⇒ EmittedSceneSchema; expandida ⇒ ExpandedSceneSchema (las 3 fixtures)", () => {
    const escenas = escenasDe(SCENES);
    assert.ok(escenas.length >= 3, `esperaba ≥3 fixtures, encontré ${escenas.length}`);
    const fallos: string[] = [];
    for (const path of escenas) {
      const file = relative(SCENES, path);
      const cruda = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;

      // Ida: la fixture es lo que el motor EMITE, y la población contraria la
      // rechaza (si no, las dos no están separadas y el schema no dice nada).
      const emitida = EmittedSceneSchema.safeParse(cruda);
      if (!emitida.success) fallos.push(`${file}: cruda NO pasa EmittedSceneSchema — ${emitida.error.issues[0].message}`);
      if (ExpandedSceneSchema.safeParse(cruda).success) {
        fallos.push(`${file}: una escena CRUDA satisface ExpandedSceneSchema — la frontera no distingue nada`);
      }

      // Vuelta: expandida por la función de producción, satisface la otra.
      const expandida = expandScenePrimitives(cruda);
      const exp = ExpandedSceneSchema.safeParse(expandida);
      if (!exp.success) {
        const i = exp.error.issues[0];
        fallos.push(`${file}: expandida NO pasa ExpandedSceneSchema — ${i.path.join(".") || "(raíz)"}: ${i.message}`);
      }
      // …y deja de ser lo que el modelo emite: un tile expandido lleva `size`
      // y grid `terrain`, que es justo lo que el gate del modelo rechaza.
      if (EmittedSceneSchema.safeParse(expandida).success) {
        fallos.push(`${file}: una escena EXPANDIDA sigue pasando EmittedSceneSchema — la frontera se movió`);
      }
    }
    assert.deepEqual(fallos, []);
  });
});

/** BIEN FORMADA no es JUGABLE. `auditarEscenas` pasa el gate estructural
 *  (zod); esto pasa el validador de jugabilidad completo, que es lo que
 *  contesta la pregunta que le importa a quien juega: ¿se puede recorrer
 *  esto CON UN CUERPO? (#289)
 *
 *  Nació con #289 y encontró trabajo el primer día: `zorder_test` tenía un
 *  NPC dentro del muro sur de la cabaña, y la clase de fallo llevaba semanas
 *  leyéndose como ambiente (#262/#284).
 *
 *  SOLO las fixtures de `data/scenes/`, que van commiteadas. Los snapshots de
 *  mundo (`data/games/<juego>/world/tile.json`) NO se versionan —`.gitignore`
 *  los deja fuera por regenerables desde el título—, así que un `it` que los
 *  recorriera sería verde vacío en CI y en cualquier clon limpio: el
 *  `readdirSync` no encuentra ninguno y el aserto compara dos listas vacías.
 *  Un test que no puede ponerse rojo es peor que ninguno. Lo que SÍ se canda,
 *  y en los dos sitios donde de verdad se para la clase, es que el bridge
 *  rechace un tile así al generarlo —antes de que llegue a save o snapshot—
 *  (`bridge-tile.test.ts`, «un tile con un NPC que no cabe donde nace») y que
 *  la puerta de carga rechace el snapshot que lo traiga igual, generado bajo
 *  un validador más laxo (`world-snapshot.test.ts`, #302). */
describe("las fixtures de data/scenes son jugables, no solo bien formadas", () => {
  it("las 3 del selector «Room» se pueden recorrer con el cuerpo mayor", () => {
    const escenas = escenasDe(SCENES);
    assert.ok(escenas.length >= 3, `esperaba ≥3 fixtures, encontré ${escenas.length}`);
    const injugables = escenas.flatMap((path) => {
      const scene = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      const entities = Array.isArray(scene.entities) ? (scene.entities as Record<string, unknown>[]) : [];
      const r = validateScene(scene, {
        required_crossings: [],
        bootstrap: entities.some((e) => e?.kind === "player"),
      });
      return r.ok ? [] : [`${relative(SCENES, path)}: ${r.errors.join(" · ")}`];
    });
    assert.deepEqual(injugables, []);
  });
});
