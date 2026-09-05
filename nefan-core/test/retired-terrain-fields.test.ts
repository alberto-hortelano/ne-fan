/** Los DOS campos con los que el terreno se declaraba por chars están retirados
 *  (#335), y las dos poblaciones de escena los RECHAZAN nombrándolos: la
 *  emitida, porque el motor puede copiar un ejemplo viejo; la cargada, porque
 *  un save o snapshot anterior los trae dentro y sin rechazo volverían al
 *  motor por `serializeForLlm`. Desde #400 los dos schemas son `.strict()`:
 *  el rebote es el de la clave desconocida y lo que aquí se comprueba es que
 *  el MOTIVO siga siendo el del campo retirado (con qué se sustituye), no el
 *  genérico. El nombre del campo se escribe aquí como literal porque el caso
 *  negativo lo exige — por eso este fichero está exceptuado de
 *  `campos-retirados-no-vuelven`, y solo él. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EmittedSceneSchema, EntitySchema, ExpandedSceneSchema } from "../src/contract/model-io/scene-schema.js";
import { RETIRED_TERRAIN_FIELDS, mensajeDeClaveRetirada } from "../src/contract/model-io/retired-terrain-fields.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { forestTile } from "./fixtures/tiles.js";
import { escenaExpandidaDePrueba } from "./helpers.js";

const emitida = (over: Record<string, unknown>) =>
  forestTile({ scene_description: "Bosque con senda.", ...over });
const cargada = (over: Record<string, unknown>) => ({
  ...expandScenePrimitives(forestTile({ scene_description: "Bosque con senda." })),
  ...over,
});

/** El issue que rebota un campo retirado, o null si el schema no lo rebotó.
 *  Con `.strict()` es el de claves desconocidas, que nombra el campo en
 *  `keys` (no en `path`). */
function issueDe(schema: typeof EmittedSceneSchema | typeof ExpandedSceneSchema, scene: Record<string, unknown>, campo: string) {
  const r = schema.safeParse(scene);
  if (r.success) return null;
  return r.error.issues.find((i) => i.code === "unrecognized_keys" && i.keys.includes(campo)) ?? null;
}

describe("los campos de terreno retirados se rechazan por nombre", () => {
  it("la lista es la de la decisión: leyenda y parches, y nada más", () => {
    assert.deepEqual([...RETIRED_TERRAIN_FIELDS], ["terrain_legend", "terrain_patches"]);
  });

  it("las dos escenas base pasan sin ellos (si no, lo de abajo no probaría nada)", () => {
    assert.equal(EmittedSceneSchema.safeParse(emitida({})).success, true);
    assert.equal(ExpandedSceneSchema.safeParse(cargada({})).success, true);
  });

  it("EmittedSceneSchema rebota `terrain_legend` nombrándolo y con el modelo vigente en el mensaje", () => {
    const issue = issueDe(EmittedSceneSchema, emitida({ terrain_legend: { w: "agua" } }), "terrain_legend");
    assert.ok(issue, "el gate tiene que rebotar la leyenda");
    assert.match(issue.message, /`terrain_legend` está retirado/);
    assert.match(issue.message, /`biome` \+ `ground`\/`volumes`/);
    assert.match(issue.message, /el agua bloquea; los muros son `volumes`/);
  });

  it("EmittedSceneSchema rebota `terrain_patches` aunque venga vacío (con `in`, no por valor)", () => {
    const issue = issueDe(EmittedSceneSchema, emitida({ terrain_patches: [] }), "terrain_patches");
    assert.ok(issue, "un array vacío también es el campo retirado");
    assert.match(issue.message, /`terrain_patches` está retirado/);
  });

  it("ExpandedSceneSchema (lo que el juego CARGA) rebota los dos y dice qué hacer con el save", () => {
    for (const campo of RETIRED_TERRAIN_FIELDS) {
      const issue = issueDe(ExpandedSceneSchema, cargada({ [campo]: {} }), campo);
      assert.ok(issue, `${campo} tiene que rebotarse también al cargar`);
      assert.match(issue.message, /save o snapshot, bórralo o regenéralo/);
    }
  });

  // El camino REAL por el que vuelve: un save de antes de la retirada. Los
  // once saves locales del 2026-09-02 la llevan dentro; en pre-producción se
  // archivan, y este test fija lo que ve quien intente reanudar uno: un
  // rechazo que nombra el save, la escena, el campo y qué hacer — nunca una
  // carga muda que devolvería la leyenda al motor por `serializeForLlm`.
  it("un save anterior a la retirada NO carga: rejects nombrando el campo retirado y qué hacer con él", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("toledo_1200");
    s1.recordSceneLoaded("s1", escenaExpandidaDePrueba("s1"));
    await s1.establecer();
    const data = (await storage.read(id))!;
    data.scenes_loaded["s1"].scene_data.terrain_legend = { w: "agua del río" };
    await storage.write(id, data);
    const s2 = new NarrativeState(storage);
    await assert.rejects(
      () => s2.loadSession(id),
      (err: Error) => {
        assert.match(err.message, new RegExp(`"${id}"`), "nombra el save");
        assert.match(err.message, /"s1"/, "nombra la escena");
        assert.match(err.message, /campo `terrain_legend`/, "nombra el campo");
        assert.match(err.message, /bórralo o regenéralo/, "dice qué hacer");
        return true;
      },
    );
    assert.equal(s2.session_id, "", "el throw llega ANTES de mutar la sesión");
  });

  // ── Los tres de #399/#400, con el mismo patrón (QA de PR-A, hallazgo 2) ──
  it("`ambient_event` en la raíz vuelve con su motivo, en las dos poblaciones", () => {
    for (const [schema, escena] of [[EmittedSceneSchema, emitida({ ambient_event: "viento" })], [ExpandedSceneSchema, cargada({ ambient_event: "" })]] as const) {
      const issue = issueDe(schema, escena, "ambient_event");
      assert.ok(issue, "se rebota");
      assert.match(issue.message, /`ambient_event` está retirado/);
      assert.match(issue.message, /`scene_description`/);
      assert.match(issue.message, /bórralo o regenéralo/);
      assert.doesNotMatch(issue.message, /EXACTAMENTE estos campos/, "no es el genérico del motor");
    }
  });

  it("`place_anchors` en la raíz (#408) vuelve con el canal que lo sustituye, en las dos poblaciones", () => {
    // La forma BUENA de antes también se rebota: no es la forma lo que murió,
    // es el campo. El sustituto va en el mensaje porque el motor del banco es
    // justo quien lo copiaría de una escena anterior a la retirada.
    const casos = [
      [EmittedSceneSchema, emitida({ place_anchors: [{ place_id: "taberna", rect: [52, 48, 24, 16] }] })],
      [ExpandedSceneSchema, cargada({ place_anchors: [] })],
    ] as const;
    for (const [schema, escena] of casos) {
      const issue = issueDe(schema, escena, "place_anchors");
      assert.ok(issue, "se rebota");
      assert.match(issue.message, /`place_anchors` está retirado/);
      assert.match(issue.message, /`map_upsert_place\.anchor \{tx, ty, rect\}`/);
      assert.match(issue.message, /bórralo o regenéralo/);
      assert.doesNotMatch(issue.message, /EXACTAMENTE estos campos/, "no es el genérico del motor");
    }
  });

  it("`glyph` y `attach` en una entity vuelven con su motivo, no con el consejo para el motor", () => {
    const entity = (extra: Record<string, unknown>) =>
      EntitySchema.safeParse({ id: "antorcha", kind: "decor", name: "antorcha", cell: [1, 1], footprint: [1, 1], ...extra });
    const conGlifo = entity({ glyph: "i" });
    assert.equal(conGlifo.success, false);
    if (conGlifo.success) return;
    assert.match(conGlifo.error.issues[0].message, /la entity "antorcha" trae `glyph` está retirado/);
    assert.match(conGlifo.error.issues[0].message, /bórralo o regenéralo/);
    const pegada = entity({ attach: "wall" });
    assert.equal(pegada.success, false);
    if (pegada.success) return;
    assert.match(pegada.error.issues[0].message, /`attach` está retirado: el decor ya no se pega a un muro/);
    // Y una retirada junto a una inventada: cada una con lo suyo, en un issue.
    const mixta = entity({ glyph: "i", hp: 3 });
    assert.equal(mixta.success, false);
    if (mixta.success) return;
    assert.match(mixta.error.issues[0].message, /`glyph` está retirado/);
    assert.match(mixta.error.issues[0].message, /trae la clave `hp`, que no existe/);
  });

  it("el registro sabe exactamente qué está retirado y no inventa motivos", () => {
    for (const campo of [...RETIRED_TERRAIN_FIELDS, "ambient_event", "glyph", "attach", "place_anchors"]) {
      assert.match(mensajeDeClaveRetirada(campo) ?? "", new RegExp(`^\\x60${campo}\\x60 está retirado: `), campo);
    }
    assert.equal(mensajeDeClaveRetirada("nota_del_motor"), null);
    assert.equal(mensajeDeClaveRetirada("place_id"), null, "vivo, no retirado");
  });

  it("y los dos a la vez se nombran los dos en el PRIMER issue (que es el único que ve el motor)", () => {
    const r = EmittedSceneSchema.safeParse(emitida({ terrain_legend: {}, terrain_patches: [] }));
    assert.equal(r.success, false);
    if (r.success) return;
    const primero = r.error.issues[0];
    assert.match(primero.message, /`terrain_legend` está retirado/);
    assert.match(primero.message, /`terrain_patches` está retirado/);
  });
});
