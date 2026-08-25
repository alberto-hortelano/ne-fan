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

import {
  clasifica,
  comparaPerimetro,
  efectoArchRules,
  revisionesDelRango,
  seleccionar,
  type Contexto,
  type EfectoArchRules,
} from "../scripts/afectado.js";
import { leeElDato, patronesDelPerimetro, REGLA_PERIMETRO } from "../scripts/mutation-plan.js";

/** Dos módulos: `alfa` muta y carga `src/scene/alfa.ts`; `beta`, `src/store/beta.ts`.
 *  `src/scene/exento.ts` está en el perímetro sin que nadie lo mute, y
 *  `src/scene/huerfano.ts` es el estado que el candado de totalidad prohíbe. */
const ctx = (
  archRules: EfectoArchRules = { fuerzaTodo: true, porque: "por defecto, el contexto no sabe compararlo" },
  lectores: readonly string[] = [],
): Contexto => ({
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
  // Los dos ficheros de `data/contract/` que el selector consulta por LECTOR y
  // no por cajón: las fronteras y la huella de la última corrida.
  leen: (nombre) =>
    nombre === "arch-rules.json" || nombre === "mutacion-huella.json" ? [...lectores] : [],
  archRules: () => archRules,
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

  it("la huella de la última corrida es SALIDA, no dato ni instrumento", () => {
    // La distinción vale la corrida completa. Sin ella, `data/contract/
    // mutacion-huella.json` cae en "dato" —es un .json del paquete— y de ahí a
    // `todos: true`, con una explicación razonable que nadie leería como un
    // bug. Y sería PERMANENTE, no ocasional: la huella cambia en cada corrida y
    // la frescura de `deuda` mira el diff desde el tag, así que a partir de la
    // primera medida los 20 módulos saldrían obsoletos para siempre.
    assert.equal(clasifica("data/contract/mutacion-huella.json"), "salida");
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

  it("la huella NO fuerza la corrida completa, y dice sobre qué se apoya", () => {
    // El par negativo del test de arriba: el MISMO cajón de ficheros (un .json
    // dentro del paquete) y respuestas opuestas, porque uno lo leen los tests
    // en runtime y el otro es la salida de la medida. Si la excepción
    // desapareciera, este test se pondría rojo con `todos: true`.
    const s = sel("data/contract/mutacion-huella.json");
    assert.equal(s.todos, false);
    assert.deepEqual(s.ids, []);
    assert.match(s.efectos[0].porque, /SALIDA de la medida/);
    assert.match(s.efectos[0].porque, /no la lee ninguna batería/);
  });

  it("…pero si una batería LLEGARA a leerla, la seleccionaría sola", () => {
    // Que no sea instrumento se comprueba, no se declara: la excepción no dice
    // "esto es inocuo", dice "no lo lee nadie", y quien lo lea la fuerza igual.
    const s = seleccionar(ctx(undefined, ["alfa"]), ["data/contract/mutacion-huella.json"]);
    assert.deepEqual(s.ids, ["alfa"]);
    assert.equal(s.todos, false);
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

/** `arch-rules.json` es el único fichero del instrumento que NO se evalúa
 *  entero, y merece candado propio en las DOS direcciones: que una regla de
 *  fronteras nueva ya no pague los ~7.000 mutantes, y que tocar la regla de la
 *  que sale el perímetro los siga pagando. Lo segundo es lo que hace que lo
 *  primero se pueda creer. */
describe("selector · arch-rules.json se evalúa por REGLA, no entero", () => {
  const ARCH = "data/contract/arch-rules.json";
  const selArch = (archRules: EfectoArchRules, lectores: readonly string[] = [], ...mas: string[]) =>
    seleccionar(ctx(archRules, lectores), [ARCH, ...mas]);
  const igual: EfectoArchRules = { fuerzaTodo: false, porque: "la regla del perímetro es idéntica" };
  const cambiada: EfectoArchRules = { fuerzaTodo: true, porque: "cambia la regla del perímetro" };

  it("una regla que no es la del perímetro no selecciona nada, y dice sobre qué se apoya", () => {
    const s = selArch(igual);
    assert.equal(s.todos, false, "añadir una regla de fronteras no puede cambiar qué se muta");
    assert.deepEqual(s.ids, []);
    assert.match(s.efectos[0].porque, /la regla del perímetro es idéntica/);
    assert.match(s.efectos[0].porque, /ninguna batería de mutación ejecuta código que lo lea/);
  });

  it("tocar la regla del perímetro fuerza la corrida completa", () => {
    const s = selArch(cambiada);
    assert.equal(s.todos, true, "de esa regla sale qué ficheros se mutan");
    assert.deepEqual(s.ids, ["alfa", "beta"]);
    assert.match(s.efectos[0].porque, /cambia la regla del perímetro/);
  });

  it("aunque la regla no cambie, selecciona a quien LEA el fichero en runtime", () => {
    // Hoy sus lectores (`architecture.test.ts`, `mutation-config.test.ts`) no
    // están en la batería de ningún módulo. El día que uno lo esté, esto tiene
    // que salir solo y no depender de que alguien recuerde tocar una lista.
    const s = selArch(igual, ["beta"]);
    assert.equal(s.todos, false);
    assert.deepEqual(s.ids, ["beta"]);
    assert.match(s.efectos[0].porque, /esas baterías lo leen en runtime/);
  });

  it("descartarlo no diluye el resto del diff", () => {
    assert.deepEqual(selArch(igual, [], "src/scene/alfa.ts").ids, ["alfa"]);
  });

  it("sin dos versiones que comparar, ejecuta de más y dice cuál falta", () => {
    // `--ficheros` es una lista suelta: no dice de qué revisión viene. Suponer
    // que la regla no cambió sería exactamente la selección corta y silenciosa
    // que este selector existe para no hacer.
    const v = efectoArchRules(undefined);
    assert.equal(v.fuerzaTodo, true);
    assert.match(v.porque, new RegExp(REGLA_PERIMETRO));
    assert.match(v.porque, /no dice contra qué versión compararlo/);
  });
});

const arch = (reglas: unknown[]): string => JSON.stringify({ scan: [], rules: reglas });
const perimetral = (...files: string[]) => ({ id: REGLA_PERIMETRO, files });
const otra = { id: "qa-guiones-sin-espera-por-reloj", files: ["qa/guiones/**/*.mjs"] };

/** La comparación de verdad, sobre dos contenidos escritos a mano: es el
 *  fondo del asunto —¿puede este cambio alterar qué se muta?— y el sitio donde
 *  un «siempre iguales» pasaría desapercibido si solo se probara el camino
 *  feliz. */
describe("perímetro · comparar dos versiones del fichero de fronteras", () => {
  const compara = (a: string, b: string) =>
    comparaPerimetro({ texto: a, nombre: "antes" }, { texto: b, nombre: "después" });
  const base = arch([perimetral("nefan-core/src/store/**/*.ts")]);

  it("añadir una regla que no es la del perímetro NO fuerza la corrida completa", () => {
    const v = compara(base, arch([perimetral("nefan-core/src/store/**/*.ts"), otra]));
    assert.equal(v.fuerzaTodo, false);
    assert.match(v.porque, /idéntica antes y después/);
  });

  it("cambiar los ficheros de la regla del perímetro SÍ la fuerza", () => {
    const v = compara(base, arch([perimetral("nefan-core/src/store/**/*.ts", "nefan-core/src/combat/**/*.ts")]));
    assert.equal(v.fuerzaTodo, true);
    assert.match(v.porque, /cambia la regla/);
  });

  it("quitar un patrón del perímetro también la fuerza", () => {
    // La dirección contraria: encoger el perímetro deja de mutar ficheros, y
    // eso es tan «otro veredicto» como ampliarlo.
    const v = compara(arch([perimetral("nefan-core/src/store/**/*.ts", "nefan-core/src/combat/**/*.ts")]), base);
    assert.equal(v.fuerzaTodo, true);
  });

  it("reordenar los patrones cuenta como cambio: el lado seguro", () => {
    const v = compara(
      arch([perimetral("nefan-core/src/store/**/*.ts", "nefan-core/src/combat/**/*.ts")]),
      arch([perimetral("nefan-core/src/combat/**/*.ts", "nefan-core/src/store/**/*.ts")]),
    );
    assert.equal(v.fuerzaTodo, true);
  });

  it("si una de las dos versiones no se puede leer, corrida completa diciendo cuál", () => {
    const v = compara(base, "{ esto no es json");
    assert.equal(v.fuerzaTodo, true);
    assert.match(v.porque, /en después/);
    assert.match(compara("{ tampoco", base).porque, /en antes/);
  });
});

describe("perímetro · la proyección que se compara es la que se usa", () => {

  it("quita el prefijo del paquete, que es como habla el plan", () => {
    const p = patronesDelPerimetro(arch([perimetral("nefan-core/src/store/**/*.ts")]));
    assert.deepEqual(p, { ok: true, patrones: ["src/store/**/*.ts"] });
  });

  it("añadir otra regla deja la proyección igual", () => {
    const antes = patronesDelPerimetro(arch([perimetral("nefan-core/src/store/**/*.ts")]));
    const despues = patronesDelPerimetro(arch([perimetral("nefan-core/src/store/**/*.ts"), otra]));
    assert.deepEqual(antes, despues);
  });

  it("tocar los ficheros de la regla del perímetro sí la cambia", () => {
    const antes = patronesDelPerimetro(arch([perimetral("nefan-core/src/store/**/*.ts")]));
    const despues = patronesDelPerimetro(
      arch([perimetral("nefan-core/src/store/**/*.ts", "nefan-core/src/combat/**/*.ts")]),
    );
    assert.notDeepEqual(antes, despues);
  });

  it("un fichero ilegible o sin la regla no da una proyección vacía: da su motivo", () => {
    // Vacío se leería como "el perímetro no incluye nada", que es un candado
    // aprobando sin mirar. Tiene que ser distinguible.
    assert.equal(patronesDelPerimetro("{ esto no es json").ok, false);
    assert.equal(patronesDelPerimetro(arch([otra])).ok, false);
    assert.equal(patronesDelPerimetro(arch([{ id: REGLA_PERIMETRO, files: [] }])).ok, false);
    assert.equal(patronesDelPerimetro(JSON.stringify({ scan: [] })).ok, false);
    const p = patronesDelPerimetro(arch([otra]));
    assert.match(p.ok ? "" : p.porque, new RegExp(REGLA_PERIMETRO));
  });
});

describe("qué cuenta como LEER un dato", () => {
  // El grafo de imports no ve una lectura de disco, así que la respuesta sale
  // de los literales de cadena. Los dos testigos son reales y opuestos: uno
  // abre el fichero, el otro solo lo nombra en un comentario para explicar qué
  // regla lo sujeta. Si alguno deja de servir, este test lo dice.
  it("abrir el fichero cuenta", () => {
    assert.equal(leeElDato("scripts/mutation-plan.ts", "arch-rules.json"), true);
  });

  it("nombrarlo en un comentario NO cuenta", () => {
    assert.equal(leeElDato("src/plugins/migrate.ts", "arch-rules.json"), false);
  });

  it("un fichero del alcance que ya no está en el árbol cuenta como lector", () => {
    assert.equal(leeElDato("src/scene/no-existe-este-fichero.ts", "arch-rules.json"), true);
  });
});

describe("selector · de qué a qué compara un rango", () => {
  // Si estas dos puntas salieran cambiadas, el selector compararía otra cosa de
  // la que se le ha pedido y no habría forma de verlo en la salida.
  it("`a..b` son sus dos puntas, y `a..` termina en HEAD", () => {
    assert.deepEqual(revisionesDelRango("a1b2c3..d4e5f6"), { antes: "a1b2c3", despues: "d4e5f6" });
    assert.deepEqual(revisionesDelRango("a1b2c3.."), { antes: "a1b2c3", despues: "HEAD" });
  });

  it("una revisión a secas se compara contra el árbol de trabajo", () => {
    assert.deepEqual(revisionesDelRango("a1b2c3"), { antes: "a1b2c3", despues: null });
  });
});
