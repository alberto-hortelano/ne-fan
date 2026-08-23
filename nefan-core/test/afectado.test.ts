/** El selector (`npm run afectado`) decide qué NO se ejecuta, y ese es el tipo
 *  de decisión que se equivoca en verde: lo que no se corre no se queja.
 *
 *  Lo que se comprueba aquí no es que acierte —eso lo sujeta la traza de
 *  imports en `mutation-config.test.ts`—, sino lo contrario: que cuando NO
 *  sabe, ejecuta de más y lo dice. Un selector callado es peor que no tener
 *  selector, porque convierte "no se ha medido" en "ha salido verde".
 *
 *  Con contexto SINTÉTICO a propósito. Contra el plan real estos casos
 *  dependerían de qué módulos haya hoy: el día que alguien mueva un fichero,
 *  el test de "un huérfano dispara la corrida completa" pasaría en verde sin
 *  ejercer un solo huérfano, que es la forma de fallo que este fichero existe
 *  para no tener. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { clasifica, seleccionar, type Contexto } from "../scripts/afectado.js";

/** Dos módulos: `alfa` muta y carga `src/scene/alfa.ts`; `beta`, `src/store/beta.ts`.
 *  `src/scene/exento.ts` está en el perímetro sin que nadie lo mute, y
 *  `src/scene/huerfano.ts` es el estado que el candado de totalidad prohíbe. */
const ctx = (): Contexto => ({
  alcances: new Map([
    ["alfa", ["test/alfa.test.ts", "src/scene/alfa.ts", "src/types.ts", "../narrative-mcp/validators.ts"]],
    ["beta", ["test/beta.test.ts", "src/store/beta.ts", "src/types.ts"]],
  ]),
  baterias: new Map([
    ["alfa", ["test/alfa.test.ts"]],
    ["beta", ["test/beta.test.ts"]],
  ]),
  perimetro: new Set([
    "src/scene/alfa.ts",
    "src/store/beta.ts",
    "src/scene/exento.ts",
    "src/scene/huerfano.ts",
  ]),
  dueño: (f) =>
    f === "src/scene/alfa.ts"
      ? { tipo: "modulo", id: "alfa" }
      : f === "src/store/beta.ts"
        ? { tipo: "modulo", id: "beta" }
        : f === "src/scene/exento.ts"
          ? { tipo: "exento", porque: "solo declara tipos" }
          : { tipo: "huerfano" },
  existe: (f) => f !== "src/scene/borrado.ts",
});

const sel = (...ficheros: string[]) => seleccionar(ctx(), ficheros);

describe("selector · en qué cajón cae cada fichero", () => {
  it("distingue fuente, test, dato, tooling y lo de fuera del paquete", () => {
    assert.equal(clasifica("src/scene/tile.ts"), "fuente");
    assert.equal(clasifica("bridge/ws-server.ts"), "fuente");
    assert.equal(clasifica("services/asset-store/server.ts"), "fuente");
    assert.equal(clasifica("test/tile.test.ts"), "test");
    assert.equal(clasifica("data/scenes/robledo.json"), "dato");
    assert.equal(clasifica("scripts/mutate.ts"), "tooling");
    assert.equal(clasifica("data/contract/mutation-targets.json"), "tooling");
    assert.equal(clasifica("stryker.config.json"), "tooling");
    assert.equal(clasifica("../qa/run.mjs"), "ajeno");
  });

  it("un .ts que no es fuente ni test cuenta como dato, no como fuente", () => {
    // `src/` no es lo mismo que "lo que se muta": un .ts suelto en la raíz del
    // paquete no lo carga ninguna batería por el grafo, pero tampoco hay razón
    // para creerse que es inocuo.
    assert.equal(clasifica("vite.config.ts"), "dato");
  });
});

describe("selector · lo que sí sabe, lo acota", () => {
  it("un fuente selecciona los módulos cuya corrida lo carga", () => {
    assert.deepEqual(sel("src/scene/alfa.ts").ids, ["alfa"]);
    assert.equal(sel("src/scene/alfa.ts").todos, false);
  });

  it("un fichero que cargan varios los selecciona a todos, sin repetirlos", () => {
    assert.deepEqual(sel("src/types.ts", "src/store/beta.ts").ids, ["alfa", "beta"]);
  });

  it("un test selecciona los módulos que lo tienen en su batería", () => {
    assert.deepEqual(sel("test/beta.test.ts").ids, ["beta"]);
  });

  it("un fichero de fuera del paquete cuenta si una batería lo importa", () => {
    // El caso real: `test/contract-fixtures.test.ts` importa
    // `../../narrative-mcp/validators.js`, fuera de nefan-core.
    assert.deepEqual(sel("../narrative-mcp/validators.ts").ids, ["alfa"]);
  });

  it("el orden de la selección es el del plan, no el del diff", () => {
    // La misma lista para el mismo cambio: si el orden dependiera del diff, dos
    // corridas del mismo trabajo escribirían informes en distinto orden y
    // comparar sería adivinar.
    assert.deepEqual(sel("src/store/beta.ts", "src/scene/alfa.ts").ids, ["alfa", "beta"]);
    assert.deepEqual(sel("src/scene/alfa.ts", "src/store/beta.ts").ids, ["alfa", "beta"]);
  });
});

describe("selector · ante la duda, de MÁS, y diciéndolo", () => {
  const disparaTodo = (fichero: string, patron: RegExp): void => {
    const s = sel(fichero);
    assert.equal(s.todos, true, `${fichero} debería forzar la corrida completa`);
    assert.deepEqual(s.ids, ["alfa", "beta"]);
    const porque = s.efectos.find((e) => e.fichero === fichero)?.porque ?? "";
    assert.match(porque, patron, `${fichero} fuerza la corrida completa sin decir por qué`);
  };

  it("un fichero del perímetro sin dueño fuerza la corrida completa", () => {
    // ESTE es el caso que da sentido al candado de totalidad. Hoy sería un
    // fichero nuevo en `src/scene/` que nadie ha metido en un módulo: el
    // selector no puede saber qué lo cubre, así que no se calla.
    disparaTodo("src/scene/huerfano.ts", /perímetro puro y NINGÚN módulo/);
  });

  it("un dato del paquete fuerza la corrida completa", () => {
    // Los tests leen fixtures, prompts y configuración en runtime, y eso no
    // está en ningún grafo de imports. No hay forma de acotarlo sin adivinar.
    disparaTodo("data/scenes/robledo_tile.json", /dato del paquete/);
  });

  it("tocar el propio instrumento fuerza la corrida completa", () => {
    disparaTodo("scripts/mutation-plan.ts", /instrumento de medida/);
    disparaTodo("data/contract/mutation-targets.json", /instrumento de medida/);
  });

  it("un fuente que ya no está en el árbol fuerza la corrida completa", () => {
    // Borrar un fichero cambia a quien lo importaba, y del borrado no queda
    // grafo que consultar.
    disparaTodo("src/scene/borrado.ts", /ya no está en el árbol/);
  });

  it("un solo fichero dudoso arrastra a todo el diff", () => {
    // Lo importante es que la duda NO se diluya: un diff con noventa ficheros
    // acotados y uno dudoso se mide entero.
    const s = sel("src/scene/alfa.ts", "data/combat_config.json");
    assert.equal(s.todos, true);
    assert.deepEqual(s.ids, ["alfa", "beta"]);
  });
});

describe("selector · nunca se calla", () => {
  it("todo fichero del diff sale con una razón escrita", () => {
    const s = sel("src/scene/alfa.ts", "../docs/x.md", "src/scene/exento.ts", "test/beta.test.ts");
    assert.equal(s.efectos.length, 4);
    for (const e of s.efectos) {
      assert.ok(e.porque.length > 20, `${e.fichero} sale sin explicación: "${e.porque}"`);
    }
  });

  it("un exento sin batería que lo cargue no selecciona nada, pero enseña su motivo", () => {
    const s = sel("src/scene/exento.ts");
    assert.deepEqual(s.ids, []);
    assert.equal(s.todos, false);
    assert.match(s.efectos[0].porque, /sin_mutar: solo declara tipos/);
  });

  it("un cambio fuera de nefan-core no selecciona nada, y dice que es por eso", () => {
    const s = sel("../nefan-html/src/main.ts", "../docs/arquitectura/mapa.md");
    assert.deepEqual(s.ids, []);
    for (const e of s.efectos) assert.match(e.porque, /fuera de nefan-core/);
  });

  it("un test que no está en ninguna batería lo dice en vez de dar el ok", () => {
    const s = sel("test/suelto.test.ts");
    assert.deepEqual(s.ids, []);
    assert.match(s.efectos[0].porque, /no está en la batería de ningún módulo/);
  });

  it("el mismo fichero repetido en el diff no cuenta dos veces", () => {
    const s = sel("src/scene/alfa.ts", "src/scene/alfa.ts");
    assert.equal(s.efectos.length, 1);
    assert.deepEqual(s.ids, ["alfa"]);
  });
});
