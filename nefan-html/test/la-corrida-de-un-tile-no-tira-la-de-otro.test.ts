/** Tanda AX (#729) — LA CORRIDA DE UN TILE NO TIRA LA DE OTRO.
 *
 *  Hasta esta tanda el controller del atlas compartía UN token entre todas las
 *  corridas: «Generar y aplicar» del menú dev sobre el vecino X, y el jugador
 *  que cruza a Y (o pulsa G sobre Y) mientras X pinta, dejaba X PAGADO, con su
 *  keep-list, y en clay. La regla nueva —la vigencia es de la clave— vive en
 *  core (`PoliticaDeAtlas`, con su batería en
 *  `nefan-core/test/politica-de-atlas.test.ts`). Lo que este fichero sujeta es
 *  la COSTURA: que el controller le pase a core la clave de cada corrida y
 *  aplique lo que core deja aplicar, y que la manual rechazada lo DIGA.
 *
 *  ES DE AQUÍ Y NO DE `qa/` por la misma excepción escrita que
 *  `en-desarrollo-lo-automatico-no-paga.test.ts`: `fetch` e `Image` son dobles
 *  inyectados (una costura, no red). El flujo real con el menú dev y el motor
 *  falso es el guion 182.
 *
 *  LO QUE NO MIDE: el re-añadido real del tile por el cable (el bridge
 *  re-difunde, `carga-de-tile.ts` reinstala): eso es el A3 del guion 60. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { SurfaceLayout } from "@nefan-core/src/scene/greybox/surfaces.js";
import { FpsAtlasController } from "../src/scene/fps-atlas.js";

const fetchOriginal = globalThis.fetch;
const g = globalThis as unknown as Record<string, unknown>;
const imageOriginal = g.Image;
const storageOriginal = g.localStorage;

/** Los POST del atlas, por escena (cada tile del test lleva la suya). */
let posts: string[] = [];
/** Escenas cuya respuesta se RETIENE hasta que el test la suelte: así la
 *  ventana del issue se construye, no se espera a que ocurra. */
let retenidas = new Map<string, () => void>();
let retener = new Set<string>();

function remoteGenDeMentira(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const cuerpo = JSON.parse(String(init?.body ?? "{}")) as { scene_description: string; cells: { key: string }[] };
  const escena = cuerpo.scene_description;
  posts.push(escena);
  const respuesta = () =>
    new Response(
      JSON.stringify({
        cells: Object.fromEntries(cuerpo.cells.map((c) => [c.key, { hash: `h-${escena}`, url: `/blob/${escena}.png` }])),
        pages_painted: 1,
        cached: false,
        cost_usd: 0,
        missing: 0,
      }),
      { status: 200 },
    );
  if (!String(url).endsWith("/generate_surface_atlas")) return Promise.resolve(new Response("?", { status: 404 }));
  if (!retener.has(escena)) return Promise.resolve(respuesta());
  return new Promise((resolve) => retenidas.set(escena, () => resolve(respuesta())));
}

/** `Image` del navegador: carga en el siguiente tick. */
class ImagenDeMentira {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  set src(_: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

beforeEach(() => {
  posts = [];
  retenidas = new Map();
  retener = new Set();
  globalThis.fetch = remoteGenDeMentira as typeof fetch;
  g.Image = ImagenDeMentira;
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  g.Image = imageOriginal;
  g.localStorage = storageOriginal;
});

/** Una corrida que tenía que volver SIN esperar (rechazada u encolada). Si se
 *  queda colgada de una respuesta retenida es que arrancó otra corrida de la
 *  misma clave, y eso se dice en rojo en vez de colgar la batería. */
async function vuelveSinEsperar(p: Promise<void>, que: string): Promise<void> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${que} se quedó esperando: arrancó otra corrida de la misma clave`)), 1000);
  });
  try {
    await Promise.race([p, tope]);
  } finally {
    clearTimeout(t);
  }
}

async function dejarCorrer(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Un layout de UNA superficie; la descripción lo hace distinto por tile. */
function layout(desc: string): SurfaceLayout {
  return {
    surface_layout_version: 2,
    page_px: 1024,
    gutter_px: 24,
    inset_px: 6,
    density_m: 1,
    pages: [
      { cells: [{ key: "piedra", mat: "stone", kind: "tile", baseColor: "#888888", en: desc, worldW: 2, worldH: 2, count: 1 }] },
    ],
    assign: [],
  };
}

/** El controller real con un renderer que apunta qué tile recibió textura.
 *  Cada tile lleva su escena (`escena-X`) para distinguir sus POST. */
function montar(modo: "generar" | "restaurar" = "restaurar", topeDeCorridaMs?: number) {
  const aplicados: string[] = [];
  const logs: string[] = [];
  const tiles = new Map<string, SurfaceLayout>([
    ["X", layout("musgo")],
    ["Y", layout("losa")],
  ]);
  const atlas = new FpsAtlasController(
    { remote: "http://remote.test", assets: "http://assets.test", state: "" },
    {
      getTile: (key) => {
        const l = tiles.get(key);
        return l ? { layout: l, sceneDescription: `escena-${key}` } : null;
      },
      apply: (key) => void aplicados.push(key),
      clear: () => {},
      tilesSinAtlas: () => [],
      modoDeEscenarios: () => modo,
      log: (m) => void logs.push(m),
      ...(topeDeCorridaMs === undefined ? {} : { topeDeCorridaMs }),
    },
  );
  atlas.setStyle("estilo_de_prueba");
  return { atlas, aplicados, logs, tiles };
}

describe("#729 · la corrida manual de X sobrevive a lo que pase en Y", () => {
  it("(1) manual de X retenida + se activa Y: X y Y acaban con su arte aplicado", async () => {
    const { atlas, aplicados } = montar();
    retener.add("escena-X");
    const manual = atlas.runFor("X"); // menú dev / G sobre el vecino
    await dejarCorrer();
    await atlas.onActiveTile("Y"); // el jugador cruza a Y
    assert.deepEqual(aplicados, ["Y"]);
    retenidas.get("escena-X")!();
    await manual;
    assert.deepEqual(aplicados.sort(), ["X", "Y"], "con el token global de antes, X salía en clay");
  });

  it("(1b) la G sobre Y con la manual de X retenida tampoco la tira", async () => {
    const { atlas, aplicados } = montar();
    retener.add("escena-X");
    const manual = atlas.runFor("X");
    await dejarCorrer();
    await atlas.runFor("Y");
    retenidas.get("escena-X")!();
    await manual;
    assert.deepEqual(aplicados.sort(), ["X", "Y"]);
  });

  it("(3) dos G seguidas sobre la misma clave: un solo POST, la segunda lo DICE y no paga otra vez", async () => {
    const { atlas, logs } = montar();
    retener.add("escena-X");
    const primera = atlas.runFor("X");
    await dejarCorrer();
    await vuelveSinEsperar(atlas.runFor("X"), "la segunda G");
    assert.ok(
      logs.some((l) => l.includes("ya hay una corrida en vuelo")),
      `la segunda G no puede irse muda: ${JSON.stringify(logs)}`,
    );
    retenidas.get("escena-X")!();
    await primera;
    await dejarCorrer();
    assert.deepEqual(posts, ["escena-X"], "la encolada encuentra el atlas completo en memoria: no vuelve a pedir");
  });

  it("H-2 · la G durante la corrida resolve_only del propio activo se ENCOLA y pinta al acabar", async () => {
    // Antes se descartaba: el tile seguía en clay y había que repetir la G.
    const cuerpos: boolean[] = [];
    const base = globalThis.fetch;
    // La librería está VACÍA: la pregunta del activo vuelve sin celdas (el
    // tile se queda en clay), que es cuando la G importa.
    globalThis.fetch = ((u: string | URL | Request, init?: RequestInit) => {
      const soloPregunta = JSON.parse(String(init?.body ?? "{}")).resolve_only === true;
      cuerpos.push(soloPregunta);
      if (!soloPregunta) return base(u, init);
      return base(u, init).then(
        () => new Response(JSON.stringify({ cells: {}, pages_painted: 0, cached: true, cost_usd: 0, missing: 1 })),
      );
    }) as typeof fetch;
    const { atlas, aplicados } = montar("restaurar");
    retener.add("escena-Y");
    const activo = atlas.onActiveTile("Y");
    await dejarCorrer();
    await vuelveSinEsperar(atlas.runFor("Y"), "la G sobre el activo");
    assert.deepEqual(cuerpos, [true], "mientras la del activo sigue retenida, ningún POST más");
    retener.delete("escena-Y");
    retenidas.get("escena-Y")!();
    await activo;
    await dejarCorrer();
    assert.deepEqual(cuerpos, [true, false], "al acabar, la G pide PINTAR");
    assert.ok(aplicados.includes("Y"));
  });

  it("H-2 · una corrida colgada se suelta al tope, lo dice y deja pasar la siguiente", async () => {
    const { atlas, logs } = montar("generar", 50);
    retener.add("escena-X");
    await atlas.runFor("X"); // nunca contesta: el tope la suelta
    assert.equal(atlas.running, false, "la clave no queda bloqueada hasta recargar");
    retener.delete("escena-X");
    await atlas.runFor("X");
    assert.equal(posts.length, 2, "la siguiente G sí sale");
    assert.ok(!logs.some((l) => l.includes("ya hay una corrida")), JSON.stringify(logs));
  });

  it("el activo que llega con la manual de su clave en vuelo se re-dispara al acabar ella, desde la memoria ($0)", async () => {
    // El riesgo del plan: un bucle de re-disparos. El re-disparo tiene que
    // caer en la caché de memoria y no volver a pedir nada.
    const { atlas, aplicados } = montar("generar");
    retener.add("escena-X");
    const manual = atlas.runFor("X");
    await dejarCorrer();
    await vuelveSinEsperar(atlas.onActiveTile("X"), "el activo de X"); // encolado: no arranca otro ciclo
    assert.deepEqual(posts, ["escena-X"]);
    retenidas.get("escena-X")!();
    await manual;
    await dejarCorrer();
    assert.deepEqual(aplicados, ["X", "X"], "la manual aplica y el re-disparo reinstala de memoria");
    assert.deepEqual(posts, ["escena-X"], "el re-disparo no vuelve a pagar");
    assert.equal(atlas.running, false);
  });

  it("una corrida no aplica sobre su tile REINSTALADO con otra escena", async () => {
    // Sin el corte global, la vigencia de la clave no basta: el tile pudo
    // reinstalarse con otra escena mientras la corrida volaba.
    const { atlas, aplicados, tiles } = montar();
    retener.add("escena-X");
    const manual = atlas.runFor("X");
    await dejarCorrer();
    tiles.set("X", layout("arena")); // OTRA escena en la misma clave
    retenidas.get("escena-X")!();
    await manual;
    assert.deepEqual(aplicados, []);
  });

  it("…pero sí sobre la MISMA escena re-difundida (otro objeto, mismo contenido): no se pide otra vez", async () => {
    // El bridge re-difunde un tile que ya existe (`request_tile`, source
    // cache) y el cliente lo reinstala: el layout es otro objeto con el mismo
    // contenido. Tirar la corrida aquí era un segundo POST de las mismas
    // celdas (guion 60, A3).
    const { atlas, aplicados, tiles } = montar();
    retener.add("escena-X");
    const manual = atlas.runFor("X");
    await dejarCorrer();
    tiles.set("X", layout("musgo"));
    retenidas.get("escena-X")!();
    await manual;
    assert.deepEqual(aplicados, ["X"]);
    assert.deepEqual(posts, ["escena-X"]);
  });

  it("clavesPintando sale de core y NOMBRA el tile: la resolve_only del activo no cuenta; la manual, sí (H-3)", async () => {
    const { atlas } = montar("restaurar");
    retener.add("escena-X");
    retener.add("escena-Y");
    const activo = atlas.onActiveTile("Y");
    await dejarCorrer();
    assert.deepEqual(atlas.clavesPintando, [], "el activo solo restaura");
    assert.equal(atlas.running, true);
    const manual = atlas.runFor("X");
    await dejarCorrer();
    assert.deepEqual(atlas.clavesPintando, ["X"], "el vecino, no «el activo»");
    retenidas.get("escena-X")!();
    await manual;
    assert.deepEqual(atlas.clavesPintando, [], "queda solo la que restaura");
    retenidas.get("escena-Y")!();
    await activo;
    assert.equal(atlas.running, false);
  });
});
