/** Tanda AS (2026-09-24) — EN DESARROLLO, LO AUTOMÁTICO NO PAGA.
 *
 *  El usuario sacó del código la decisión de pagar arte: es CONFIGURACIÓN (el
 *  entorno, `NEFAN_ENTORNO` en el bridge) y en desarrollo ningún camino
 *  automático genera — se restaura lo pagado y lo que falta se queda en clay o
 *  en y_bot. La regla vive en core (`gatesDeImagen`, con su tabla y su gemelo
 *  en `nefan-core/test/gates-de-imagen.test.ts`). Lo que este fichero sujeta es
 *  la COSTURA: que los dos dueños que gastan en el cliente —el controller del
 *  atlas y el gestor de skins— lleven la decisión de core hasta el CUERPO del
 *  POST, que es lo único que el que paga (remote-gen) sabe leer.
 *
 *  ES DE AQUÍ Y NO DE `qa/` (regla del README de este banco): es una costura
 *  entre módulos del cliente que hoy solo casa por convención —el permiso que
 *  sale de core y el `resolve_only` que sale por la red—, y el `fetch`
 *  inyectado es una COSTURA, no red: se sustituye `globalThis.fetch` por un
 *  doble que apunta cada cuerpo y contesta lo que contestaría remote-gen. El
 *  flujo real desde el arranque, con el bridge diciendo el entorno y el motor
 *  falso contando pagos, es el guion 179.
 *
 *  NO MURIÓ NINGÚN GUION al nacer esto (regla 2): ninguno de `qa/` mide el
 *  cuerpo de un POST de skins con el permiso en `restaurar`, que no existía.
 *
 *  LO QUE NO MIDE:
 *  - Que `main.ts` cablee `graficos.modoDeEscenarios()` al controller y que
 *    `bridge_hello` llegue a `aplicarEntorno`. Es la raíz y el socket: lo
 *    mide el guion 179 con la red de verdad.
 *  - Que remote-gen responda `sin_arte` sin llamar a sprite-forge: eso es
 *    `ai_server/tests/test_sprite_forge_adapter.py`. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { gatesDeImagen, type Entorno } from "@nefan-core/src/session/gates-de-imagen.js";
import type { SurfaceLayout } from "@nefan-core/src/scene/greybox/surfaces.js";
import { CharacterSpriteManager } from "../src/renderer/character-sprites.js";
import { SpriteRenderer } from "../src/renderer/sprite-renderer.js";
import { FpsAtlasController } from "../src/scene/fps-atlas.js";

/** Un POST de pago tal como salió del cliente. */
interface Post {
  ruta: "/generate_surface_atlas" | "/skin_sprite_sheet";
  resolveOnly: boolean;
}

let posts: Post[] = [];
const fetchOriginal = globalThis.fetch;

/** El doble de remote-gen: apunta el cuerpo y contesta como el servidor real
 *  ante una librería VACÍA — `resolve_only` sin arte (`missing` / `sin_arte`)
 *  y, sin él, un sheet vacío o un atlas sin celdas. */
function remoteGenDeMentira(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const ruta = new URL(String(url)).pathname;
  const cuerpo = JSON.parse(String(init?.body ?? "{}")) as { resolve_only?: boolean; cells?: unknown[] };
  const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
  if (ruta === "/generate_surface_atlas") {
    posts.push({ ruta, resolveOnly: cuerpo.resolve_only === true });
    return json({ cells: {}, pages_painted: 0, cached: true, cost_usd: 0, missing: cuerpo.cells?.length ?? 0 });
  }
  if (ruta === "/skin_sprite_sheet") {
    posts.push({ ruta, resolveOnly: cuerpo.resolve_only === true });
    if (cuerpo.resolve_only === true) return json({ ok: true, sin_arte: true });
    return json({
      ok: true,
      hash: "h",
      cached: false,
      meta: { directions: 0, frame_count: 0 },
      frame_urls: [],
      generation_time_ms: 1,
    });
  }
  return Promise.resolve(new Response("ruta desconocida", { status: 404 }));
}

beforeEach(() => {
  posts = [];
  globalThis.fetch = remoteGenDeMentira as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Deja correr la cadena de skins y los `await` del atlas. */
async function dejarCorrer(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Un tile con UNA superficie: lo mínimo para que el atlas tenga qué pedir. */
const LAYOUT: SurfaceLayout = {
  surface_layout_version: 2,
  page_px: 1024,
  gutter_px: 24,
  inset_px: 6,
  density_m: 1,
  pages: [
    {
      cells: [
        { key: "piedra", mat: "stone", kind: "tile", baseColor: "#888888", en: "grey stone", worldW: 2, worldH: 2, count: 1 },
      ],
    },
  ],
  assign: [],
};

/** Los dos dueños del gasto, reales, con el permiso que decide CORE para una
 *  partida en Imagen IA (escenarios y personajes) en `entorno`. */
function montar(entorno: Entorno) {
  const gates = gatesDeImagen({ renderMode: "image", characterMode: "image", toggleLocalPersonajes: false, entorno });
  const atlas = new FpsAtlasController(
    { remote: "http://remote.test", assets: "http://assets.test", state: "" },
    {
      getTile: () => ({ layout: LAYOUT, sceneDescription: "una aldea" }),
      apply: () => {},
      clear: () => {},
      tilesSinAtlas: () => [],
      modoDeEscenarios: () => gates.escenarios,
      log: () => {},
    },
  );
  atlas.setStyle("estilo_de_prueba");
  const sprites = new SpriteRenderer("/sprites", "http://remote.test", "http://assets.test");
  const skins = new CharacterSpriteManager(sprites, "frontal_8");
  skins.setPermisoDeSkins(gates.personajes);
  return { atlas, skins, gates };
}

/** Todo lo AUTOMÁTICO que puede pedir arte en una partida: el tile que pisa
 *  el jugador, un vecino instalado, el set automático de un NPC al aparecer y
 *  la anim lazy de ese NPC al entrar en combate. */
async function lanzarLoAutomatico({ atlas, skins }: ReturnType<typeof montar>): Promise<void> {
  await atlas.onActiveTile("tile_0_0");
  atlas.restaurar("tile_1_0");
  skins.requestSkin("una herrera de brazos quemados");
  await dejarCorrer();
  skins.modelFor("una herrera de brazos quemados", "quick");
  await dejarCorrer();
}

describe("en desarrollo, ningún camino automático pide PAGAR (criterio 2)", () => {
  it("core baja Imagen IA a «restaurar» en las dos facetas", () => {
    const { gates } = montar("desarrollo");
    assert.deepEqual(gates, { escenarios: "restaurar", personajes: "restaurar" });
  });

  it("activo, vecino, set automático y anim lazy: TODO POST de pago lleva resolve_only", async () => {
    const m = montar("desarrollo");
    await lanzarLoAutomatico(m);
    const atlas = posts.filter((p) => p.ruta === "/generate_surface_atlas");
    const skins = posts.filter((p) => p.ruta === "/skin_sprite_sheet");
    assert.equal(atlas.length, 2, `el activo y el vecino preguntan a la librería: ${JSON.stringify(posts)}`);
    assert.ok(skins.length >= 4, `el set automático (3) y la lazy (1) preguntan: ${JSON.stringify(posts)}`);
    assert.deepEqual(posts.filter((p) => !p.resolveOnly), [], "ningún POST sin resolve_only");
  });

  it("«sin arte» no es un fallo: ni marca al personaje ni vuelve a preguntar en cada fotograma", async () => {
    const m = montar("desarrollo");
    await lanzarLoAutomatico(m);
    const [herrera] = m.skins.debugState();
    assert.equal(herrera?.failed, false, "sin_arte no puede fundir el fusible con cada NPC nuevo");
    const antes = posts.length;
    for (let i = 0; i < 5; i++) m.skins.modelFor("una herrera de brazos quemados", "quick");
    m.skins.requestSkin("una herrera de brazos quemados");
    await dejarCorrer();
    assert.equal(posts.length, antes, "lo que ya se sabe sin pagar no se vuelve a preguntar mientras siga en restaurar");
  });
});

describe("…y su gemelo: en producción sí pide pagar, que es lo que hace que lo de arriba pueda ponerse rojo", () => {
  it("el activo, el vecino y los skins salen SIN resolve_only", async () => {
    const m = montar("produccion");
    assert.deepEqual(m.gates, { escenarios: "generar", personajes: "generar" });
    await lanzarLoAutomatico(m);
    const pagan = (ruta: Post["ruta"]) => posts.filter((p) => p.ruta === ruta && !p.resolveOnly).length;
    assert.equal(pagan("/generate_surface_atlas"), 2, JSON.stringify(posts));
    assert.ok(pagan("/skin_sprite_sheet") >= 3, JSON.stringify(posts));
  });
});

describe("en desarrollo, las vías DELIBERADAS siguen pagando (criterio 3)", () => {
  it("la tecla G / el menú dev del atlas (`runFor`) pide pintar", async () => {
    const m = montar("desarrollo");
    await m.atlas.runFor("tile_0_0");
    assert.deepEqual(posts, [{ ruta: "/generate_surface_atlas", resolveOnly: false }]);
  });

  it("el `force` del menú dev de skins pide pintar ese personaje, también el que antes solo restauraba", async () => {
    const m = montar("desarrollo");
    m.skins.requestSkin("un guardia tuerto");
    await dejarCorrer();
    const antes = posts.length;
    assert.ok(posts.every((p) => p.resolveOnly), "antes de pulsar, solo preguntaba");
    m.skins.requestSkin("un guardia tuerto", { force: true });
    await dejarCorrer();
    const despues = posts.slice(antes);
    assert.ok(despues.length >= 3 && despues.every((p) => !p.resolveOnly), JSON.stringify(despues));
  });
});

/** #756, salida (b): el `force` paga el set automático y NADA MÁS. Sus anims
 *  lazy las dispara un fotograma, no el clic, así que siguen al permiso. */
describe("el forzado no abre un gasto sin techo (#756)", () => {
  /** Los POST de la anim `quick` tras forzar y llevar al personaje a ella. */
  async function forzarYAtacar(entorno: Entorno): Promise<{ auto: Post[]; lazy: Post[] }> {
    const m = montar(entorno);
    m.skins.requestSkin("un guardia tuerto", { force: true });
    await dejarCorrer();
    const auto = [...posts];
    m.skins.modelFor("un guardia tuerto", "quick");
    await dejarCorrer();
    return { auto, lazy: posts.slice(auto.length) };
  }

  it("en desarrollo, el set automático del forzado paga y su lazy solo pregunta por lo pagado", async () => {
    const { auto, lazy } = await forzarYAtacar("desarrollo");
    assert.equal(auto.length, 3, JSON.stringify(auto));
    assert.ok(auto.every((p) => !p.resolveOnly), `idle/walk/run pagan: ${JSON.stringify(auto)}`);
    assert.deepEqual(lazy, [{ ruta: "/skin_sprite_sheet", resolveOnly: true }]);
  });

  it("…y en producción la lazy genera, como la de cualquiera", async () => {
    const { lazy } = await forzarYAtacar("produccion");
    assert.deepEqual(lazy, [{ ruta: "/skin_sprite_sheet", resolveOnly: false }]);
  });
});

describe("el permiso que SUBE re-abre lo vetado (el hello de producción llega tarde)", () => {
  it("restaurar → generar: lo que no estaba pagado vuelve a ser hueco y se pide pintar", async () => {
    const m = montar("desarrollo");
    m.skins.requestSkin("una herrera de brazos quemados");
    await dejarCorrer();
    const antes = posts.length;
    m.skins.setPermisoDeSkins("generar");
    m.skins.requestSkin("una herrera de brazos quemados");
    await dejarCorrer();
    const despues = posts.slice(antes);
    assert.ok(despues.length >= 3 && despues.every((p) => !p.resolveOnly), JSON.stringify(despues));
  });
});
