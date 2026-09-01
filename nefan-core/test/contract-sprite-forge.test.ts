/** El candado del contrato ne-fan ↔ sprite-forge (R15, 2026-09-01).
 *
 *  Este wire tuvo CUATRO copias (espejo TS, fake del bench, doble de tests
 *  Python, servicio real) y cero puntos de comparación: el espejo llegó a
 *  declarar obligatorio un `generated_at` que el sheet vestido nunca llevó, y
 *  nadie podía enterarse. Ahora sprite-forge emite fixtures canónicas de sus
 *  respuestas REALES (su `npm run fixtures-contrato`, sin Chrome, sin FBX con
 *  licencia y sin gastar un céntimo), van commiteadas aquí con su procedencia,
 *  y este test valida los zod del espejo contra ellas — sin el repo hermano
 *  clonado y sin red. Si una fixture falta, esto se pone ROJO: un skip
 *  silencioso sería un verde que no comprueba nada.
 *
 *  Regenerar (con el repo hermano al lado):
 *    cd ../sprite-forge && npm run fixtures-contrato -- \
 *      --out <ne-fan>/nefan-core/data/contract/fixtures/sprite-forge
 *
 *  PROBADO EN NEGATIVO (2026-09-01): reponiendo `generated_at` como
 *  obligatorio en el schema, «el meta del sheet vestido cumple el espejo» se
 *  pone rojo con la clave señalada; revertido.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  AUTO_SKIN_ANIMS,
  SpriteCatalogAnimationSchema,
  SpriteCatalogSchema,
  SpriteSheetMetaSchema,
  skinImageCalls,
} from "../src/contracts/sprite-forge.js";

const DIR = fileURLToPath(new URL("../data/contract/fixtures/sprite-forge", import.meta.url));
/** Lanza si la fixture no está: fixtures ausentes = rojo, nunca skip. */
const leer = (nombre: string): unknown =>
  JSON.parse(readFileSync(join(DIR, `${nombre}.json`), "utf8"));

const catalogo = leer("catalog") as Record<string, unknown>;
const sheets = leer("sheets") as { sheets: Array<Record<string, unknown>> };
const skins = leer("skins") as {
  base_key: string;
  meta: Record<string, unknown> & { skin: Record<string, unknown> };
  frames: string[][];
  cost_usd: number;
};
const procedencia = leer("procedencia") as Record<string, unknown>;

describe("contrato sprite-forge · fixtures canónicas del servicio", () => {
  it("la procedencia dice de qué versión salieron y cómo se regeneran", () => {
    assert.equal(procedencia.service, "sprite-forge");
    assert.match(String(procedencia.version), /^\d+\.\d+\.\d+$/);
    assert.match(String(procedencia.comando), /fixtures-contrato/);
  });

  it("el catálogo real cumple el espejo (lo que ne-fan lee existe y tipa)", () => {
    const r = SpriteCatalogSchema.safeParse(catalogo);
    assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2));
  });

  it("el coste por personaje sale del catálogo: 1 hero + calls_per_anim de idle/walk/run", () => {
    const r = SpriteCatalogSchema.parse(catalogo);
    const porId = new Map(r.animations.map((a) => [a.id, a]));
    for (const anim of AUTO_SKIN_ANIMS) {
      assert.equal(typeof porId.get(anim)?.calls_per_anim, "number", `falta el coste de "${anim}"`);
    }
    // El «1 + 8 + 4 + 4» que el cliente llevaba copiado a mano, ahora leído.
    assert.deepEqual(skinImageCalls(r), { ok: true, calls: 17 });
  });

  it("una anim que no se puede costear viaja con su causa, y el schema rechaza el null mudo", () => {
    const r = SpriteCatalogSchema.parse(catalogo);
    const rota = r.animations.find((a) => a.calls_per_anim === null);
    assert.ok(rota, "la fixture incluye el caso «no se puede costear»");
    assert.equal(typeof rota.skin_plan_error, "string");
    // El estado malo es inexpresable: un catálogo con null sin motivo no parsea.
    const mudo = SpriteCatalogAnimationSchema.safeParse({
      id: "x", keyframes: null, play_fps: null, calls_per_anim: null,
    });
    assert.equal(mudo.success, false);
  });

  it("un coste ausente del catálogo se declara no disponible, nunca se inventa", () => {
    const r = SpriteCatalogSchema.parse(catalogo);
    const sinWalk = {
      ...r,
      animations: r.animations.map((a) =>
        a.id === "walk"
          ? { ...a, keyframes: null, play_fps: null, calls_per_anim: null, skin_plan_error: "perfil roto" }
          : a,
      ),
    };
    const info = skinImageCalls(sinWalk);
    assert.equal(info.ok, false);
    assert.match(info.ok ? "" : info.reason, /perfil roto/);
    const faltaAnim = skinImageCalls({ ...r, animations: r.animations.filter((a) => a.id !== "run") });
    assert.equal(faltaAnim.ok, false);
  });

  it("el meta de una hoja BASE cumple el espejo: con generated_at, sin bloque skin", () => {
    const meta = sheets.sheets[0].meta as Record<string, unknown>;
    const r = SpriteSheetMetaSchema.safeParse(meta);
    assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2));
    assert.equal(typeof meta.generated_at, "string");
    assert.ok(!("skin" in meta));
    assert.match(String(sheets.sheets[0].base_key), /^[0-9a-f]{16}$/);
  });

  it("el meta del sheet VESTIDO cumple el espejo: sin generated_at, con el plan pagado en skin", () => {
    const r = SpriteSheetMetaSchema.safeParse(skins.meta);
    assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2));
    // La mentira de R1, fijada al revés: el wire vestido NUNCA llevó generated_at.
    assert.ok(!("generated_at" in skins.meta));
    for (const campo of ["prompt", "ai_model", "api", "keyframe_indices", "batches", "background", "cost_usd"]) {
      assert.ok(campo in skins.meta.skin, `el bloque skin del servicio lleva "${campo}"`);
    }
    // base_key NO la pone el servicio: la inyecta remote-gen al guardar.
    assert.ok(!("base_key" in skins.meta.skin));
  });

  it("el wire que ve el cliente (meta + base_key inyectada por remote-gen) también tipa", () => {
    // remote_generation.py hace meta.setdefault("skin", {})["base_key"] = base_key
    // antes de escribir meta.json y de contestar: esta es la forma que llega a
    // /skin_sprite_sheet, y el espejo tiene que aceptarla con base_key presente.
    const wire = { ...skins.meta, skin: { ...skins.meta.skin, base_key: skins.base_key } };
    const r = SpriteSheetMetaSchema.safeParse(wire);
    assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2));
  });

  it("los frames del sheet vestido cuadran con su meta (directions × frame_count)", () => {
    const meta = SpriteSheetMetaSchema.parse(skins.meta);
    assert.equal(skins.frames.length, meta.directions);
    for (const fila of skins.frames) assert.equal(fila.length, meta.frame_count);
    assert.equal(typeof skins.cost_usd, "number");
  });
});
