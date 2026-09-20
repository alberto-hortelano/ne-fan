/** #492 — Cada dueño cuenta su propio arte pendiente.
 *
 *  Hasta esta tanda el inventario del menú dev lo hacía `listFakeItems` en
 *  `main.ts`, cruzando SIETE colaboradores (renderer, tiles, atlas, mundo,
 *  aspecto, sprites y skins) porque ningún dueño sabía contar lo suyo. Ahora lo
 *  cuentan `FpsAtlasController.pendientes()` y `CharacterSpriteManager.pendientes()`,
 *  y la raíz solo concatena los dos arrays.
 *
 *  EL CRITERIO DE LA TANDA ES «LA MISMA LISTA», así que lo que aquí se fija son
 *  los OBSERVABLES que producía la función de la raíz: el orden, el dedup, los
 *  tres rótulos de un skin, la etiqueta literal de un tile, de dónde sale la
 *  miniatura, y que el botón de cada fila pide ESA pieza. Los literales se
 *  copiaron del `main.ts` que se retira (`git show a25d8c2f:nefan-html/src/main.ts`
 *  `:798-840`); pinearlos es el punto, no una tautología sobre la implementación
 *  nueva: si alguien reescribe un rótulo, la lista deja de ser la de antes.
 *
 *  ES DE AQUÍ Y NO DE `qa/` (regla del README de este banco): las dos funciones
 *  son derivación pura de datos a estructura — ni DOM, ni WebGL, ni red, ni
 *  reloj. Lo que sí necesita navegador —que el menú PINTE esa lista, que el
 *  doble click gaste y que la lista sea idéntica con el juego arrancado en
 *  maqueta, en imagen y con un skin fallido— es el guion 152, y no se solapa
 *  con esto: aquí no se monta ni un nodo.
 *
 *  NO MURIÓ NINGÚN GUION al nacer estos asertos (regla 2 del README): ninguno
 *  conducía `#dev-menu` — el grep en `qa/` daba 0 antes del 152.
 *
 *  LO QUE NO MIDE, dicho para que nadie lo cuente de más:
 *
 *  - Que la RAÍZ siga llamando a los dos `pendientes()` con los prompts vivos
 *    del jugador y del mundo. El thunk de `main.ts` no se toca desde aquí; eso
 *    lo mide el bloque 1 del guion 152, que es el que ve la lista de verdad.
 *  - Que `tilesSinAtlas()` reste bien lo texturado. Aquí entra como stub porque
 *    la respuesta la tiene el GL; el bloque 2 del guion 152 lo comprueba con
 *    el atlas puesto.
 *  - El orden ENTRE los dos kinds (atlas antes que skins). Es del thunk de la
 *    raíz, no de ningún dueño.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONFIG } from "@nefan-core/src/config.js";
import { BASE_MODEL, CharacterSpriteManager } from "../src/renderer/character-sprites.js";
import type { SpriteRenderer } from "../src/renderer/sprite-renderer.js";
import { FpsAtlasController, type FpsAtlasDeps } from "../src/scene/fps-atlas.js";

/** Deja correr la cadena de generación de skins (`chain`), que son varios
 *  `await` encadenados. Un macrotask vacía todos los microtasks pendientes; se
 *  repite porque cada eslabón encadena el siguiente. */
async function dejarCorrerLaCola(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

/* ─────────────────────────── EL ATLAS ─────────────────────────── */

/** `running` es un getter de la clase y lo mueve la política de core al salir
 *  un run de verdad (fetch incluido). Aquí se SUSTITUYE para poder afirmar de
 *  quién depende `inFlight` sin montar una corrida: es la decisión que tomó el
 *  coordinador de esta tanda (`inFlight` sigue leyendo `running` y no
 *  `pintando`, para que la lista sea idéntica), y sin este aserto nadie la
 *  sujeta. Cambiarlo a `pintando` pone rojo el caso de abajo, porque `pintando`
 *  exige además que la corrida pinte. */
class ControladorConVueloFingido extends FpsAtlasController {
  enVuelo = false;
  override get running(): boolean {
    return this.enVuelo;
  }
}

function controladorDeAtlas(tiles: string[]) {
  /** Las claves por las que alguien pidió generar. `runFor` empieza por
   *  `deps.getTile(key)` y se va si no hay tile, así que devolver `null` deja
   *  el espía sin tocar la red. */
  const pedidos: string[] = [];
  const deps: FpsAtlasDeps = {
    getTile: (key) => {
      pedidos.push(key);
      return null;
    },
    apply: () => {},
    clear: () => {},
    tilesSinAtlas: () => tiles,
    generationOn: () => false,
    log: () => {},
  };
  const ctrl = new ControladorConVueloFingido({ remote: "", assets: "", state: "" }, deps);
  return { ctrl, pedidos };
}

describe("el atlas cuenta sus tiles en clay (#492)", () => {
  it("un item por clave de tilesSinAtlas, en ESE orden y con la etiqueta de siempre", () => {
    const { ctrl } = controladorDeAtlas(["tile0_0", "tile1_0", "tile0_1"]);
    const items = ctrl.pendientes();

    assert.deepEqual(
      items.map((i) => i.id),
      ["tile0_0", "tile1_0", "tile0_1"],
      "el orden es el que da el renderer: es el que tenía la lista cuando la hacía main.ts",
    );
    assert.deepEqual(items.map((i) => i.kind), ["fps_atlas", "fps_atlas", "fps_atlas"]);
    assert.equal(items[0]?.label, "Atlas fps tile0_0 (clay — celdas ya en la librería salen gratis)");
    assert.deepEqual(
      items.map((i) => i.thumb),
      [null, null, null],
      "sin miniatura: una del canvas WebGL es otro trabajo, y así era antes",
    );
    assert.deepEqual(items.map((i) => i.disabledReason), [undefined, undefined, undefined]);
  });

  it("y sin tiles en clay no cuenta ninguno (anti-tautología)", () => {
    assert.deepEqual(controladorDeAtlas([]).ctrl.pendientes(), []);
  });

  it("inFlight sigue a `running`, no a `pintando`", () => {
    const { ctrl } = controladorDeAtlas(["tile0_0", "tile1_0"]);
    assert.deepEqual(
      ctrl.pendientes().map((i) => i.inFlight),
      [false, false],
      "en reposo ninguna fila dice «Generando…»",
    );

    ctrl.enVuelo = true;
    assert.deepEqual(
      ctrl.pendientes().map((i) => i.inFlight),
      [true, true],
      "con una corrida en vuelo las filas de atlas lo dicen — también si es `resolve_only`, " +
        "que es lo que hacía la lista de main.ts y lo que esta tanda conserva a propósito",
    );
  });

  it("el botón de una fila pide SU tile, no el primero", async () => {
    const { ctrl, pedidos } = controladorDeAtlas(["tile0_0", "tile1_0", "tile0_1"]);
    const items = ctrl.pendientes();

    await items[2]?.generar();

    assert.deepEqual(pedidos, ["tile0_1"], "cada item lleva su clave dentro del `generar()`");
  });
});

/* ─────────────────────────── LOS SKINS ─────────────────────────── */

/** Qué hace el `SpriteRenderer` falso con la siguiente hoja que le pidan.
 *  "cuelga" es el defecto: una promesa que no se resuelve nunca deja el skin
 *  «generándose» sin que nada cambie por debajo a mitad de aserto. */
type ModoDeCarga = "cuelga" | "falla" | "llega";

function gestorDeSkins(cached: { frames: CanvasImageSource[][] } | null = null) {
  const pedidas: string[] = [];
  const consultas: string[] = [];
  const estado = { modo: "cuelga" as ModoDeCarga };
  const sprites = {
    skinKey: (model: string, prompt: string) => `${model}__${prompt}`,
    getCached: (model: string, anim: string, angle: string) => {
      consultas.push(`${model}/${anim}/${angle}`);
      return cached;
    },
    loadSkinnedAnimation: (model: string, anim: string, _angle: string, prompt: string) => {
      pedidas.push(`${prompt}/${anim}`);
      if (estado.modo === "falla") return Promise.reject(new Error("meshy caído (de mentira)"));
      if (estado.modo === "llega") return Promise.resolve({ frames: [[{ decode: () => Promise.resolve() }]] });
      return new Promise(() => {});
    },
  } as unknown as SpriteRenderer;
  return { csm: new CharacterSpriteManager(sprites, "front"), pedidas, consultas, estado };
}

describe("el gestor de skins cuenta los que van sobre la base y_bot (#492)", () => {
  it("dedup, vacíos fuera, orden de entrada y el rótulo de quien no se ha pedido", () => {
    const { csm } = gestorDeSkins();

    const items = csm.pendientes(["", "herrero de delantal quemado", "monja de hábito pardo", "herrero de delantal quemado", ""]);

    assert.deepEqual(
      items.map((i) => i.id),
      ["herrero de delantal quemado", "monja de hábito pardo"],
      "el prompt vacío del jugador sin vestir no es una fila, y un prompt repetido es UNA",
    );
    assert.deepEqual(items.map((i) => i.kind), ["skin", "skin"]);
    assert.equal(items[0]?.label, "Skin: herrero de delantal quemado (base y_bot)");
    assert.deepEqual(items.map((i) => i.inFlight), [false, false]);
  });

  it("y sin prompts vivos no cuenta ninguno (anti-tautología)", () => {
    assert.deepEqual(gestorDeSkins().csm.pendientes([]), []);
    assert.deepEqual(gestorDeSkins().csm.pendientes(["", ""]), []);
  });

  it("un prompt largo se corta en 70 con puntos suspensivos", () => {
    const largo = "x".repeat(80);
    const item = gestorDeSkins().csm.pendientes([largo])[0];
    assert.equal(item?.label, `Skin: ${"x".repeat(70)}… (base y_bot)`);
  });

  it("la miniatura es el primer frame del idle de la base, y se pide UNA vez", () => {
    const marco = { tag: "el primer frame del y_bot" } as unknown as CanvasImageSource;
    const { csm, consultas } = gestorDeSkins({ frames: [[marco]] });

    const items = csm.pendientes(["herrero", "monja"]);

    assert.deepEqual(items.map((i) => i.thumb), [marco, marco]);
    assert.deepEqual(
      consultas,
      [`${BASE_MODEL}/idle/front`],
      "la hoja base es la misma para todas las filas: se consulta una vez, como hacía main.ts",
    );
  });

  it("sin hoja base en caché la miniatura es null y la fila sale igual", () => {
    const items = gestorDeSkins(null).csm.pendientes(["herrero"]);
    assert.equal(items[0]?.thumb, null);
    assert.equal(items.length, 1);
  });

  it("el que ya tiene su idle puesto DESAPARECE de la lista", async () => {
    const { csm, estado } = gestorDeSkins();
    estado.modo = "llega";

    csm.requestSkin("herrero");
    await dejarCorrerLaCola();

    assert.deepEqual(
      csm.pendientes(["herrero", "monja"]).map((i) => i.id),
      ["monja"],
      "el herrero ya no va sobre la base y_bot; la monja sigue ahí (si desaparecieran los dos, " +
        "este aserto estaría midiendo una lista vacía)",
    );
  });

  it("el que falló lo dice, y su botón lo pide con `force` (que es lo que lo revive)", async () => {
    const { csm, estado, pedidas } = gestorDeSkins();
    estado.modo = "falla";

    csm.requestSkin("herrero");
    await dejarCorrerLaCola();

    const caido = csm.pendientes(["herrero"])[0];
    assert.equal(caido?.label, "Skin: herrero (falló)");
    assert.equal(caido?.inFlight, false, "un skin caído no se está generando: su botón tiene que estar vivo");

    // Que la segunda vuelta no se caiga otra vez es lo que hace determinista el
    // aserto de abajo; lo que se mide es el `force`, no el resultado.
    estado.modo = "cuelga";
    pedidas.length = 0;
    await caido?.generar();

    assert.equal(
      csm.pendientes(["herrero"])[0]?.label,
      "Skin: herrero (generándose)",
      "sin `force`, `requestSkin` se va de vuelta ante un skin marcado failed y la fila seguiría " +
        "diciendo «falló»: el botón del menú dev sería un no-op mudo",
    );
    assert.deepEqual(
      pedidas,
      ["herrero/idle"],
      "y la petición SALE de verdad. Solo una: la cadena de generación es serial, así que `walk` " +
        "y `run` esperan detrás del `idle` que este falso deja colgado a propósito",
    );
  });

  it("con el backend de skins apagado por config la fila trae su motivo", () => {
    const antes = CONFIG.graphics.ai_skin;
    try {
      CONFIG.graphics.ai_skin = false;
      const item = gestorDeSkins().csm.pendientes(["herrero"])[0];
      assert.equal(
        item?.disabledReason,
        "Backend de skins apagado por config: activa graphics.ai_skin en nefan-core/src/config.ts",
      );
    } finally {
      CONFIG.graphics.ai_skin = antes;
    }
    assert.equal(
      gestorDeSkins().csm.pendientes(["herrero"])[0]?.disabledReason,
      undefined,
      "y con el backend encendido no hay motivo que dar (si no, el botón iría muerto siempre)",
    );
  });
});
