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
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  clasifica,
  comparaObjetivos,
  comparaPerimetro,
  efectoArchRules,
  efectoObjetivos,
  instrumentoDeMedida,
  revisionesDelRango,
  seleccionar,
  type Contexto,
  type EfectoArchRules,
  type EfectoObjetivos,
} from "../scripts/afectado.js";
import {
  alcanceDe,
  coreRoot,
  directoriosQueNombra,
  enumeraDirectorios,
  leeElDato,
  leerPlan,
  nombraDirectorio,
  patronesDelPerimetro,
  REGLA_PERIMETRO,
} from "../scripts/mutation-plan.js";

interface Opciones {
  archRules?: EfectoArchRules;
  objetivos?: EfectoObjetivos;
  /** Quién LEE cualquier dato que se le pregunte. */
  lectores?: readonly string[];
  /** Qué ficheros son el instrumento de medida (derivado, en el real). */
  instrumento?: readonly string[];
}

/** Dos módulos: `alfa` muta y carga `src/scene/alfa.ts`; `beta`, `src/store/beta.ts`.
 *  `src/scene/exento.ts` está en el perímetro sin que nadie lo mute, y
 *  `src/scene/huerfano.ts` es el estado que el candado de totalidad prohíbe. */
const ctx = (o: Opciones = {}): Contexto => ({
  alcances: new Map([
    ["alfa", ["test/alfa.test.ts", "src/scene/alfa.ts", "src/types.ts", "../narrative-mcp/validators.ts"]],
    ["beta", ["test/beta.test.ts", "src/store/beta.ts", "src/types.ts", "scripts/guion-de-beta.ts"]],
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
  // Ningún dato tiene lector por defecto: quién lee qué es lo que el selector
  // DERIVA, y aquí se inyecta para poder probar las dos direcciones.
  leen: () => [...(o.lectores ?? [])],
  instrumento: (f) => (o.instrumento ?? ["scripts/mutate.ts"]).includes(f),
  archRules: () =>
    o.archRules ?? { fuerzaTodo: true, porque: "por defecto, el contexto no sabe compararlo" },
  objetivos: () =>
    o.objetivos ?? { fuerzaTodo: true, ids: [], porque: "por defecto, el contexto no sabe compararlo" },
});

const sel = (...ficheros: string[]) => seleccionar(ctx(), ficheros);

describe("selector · en qué cajón cae cada fichero", () => {
  it("distingue fuente, test, dato, tooling y lo de fuera del paquete", () => {
    assert.equal(clasifica("src/scene/tile.ts"), "fuente");
    assert.equal(clasifica("bridge/ws-server.ts"), "fuente");
    assert.equal(clasifica("services/asset-store/server.ts"), "fuente");
    assert.equal(clasifica("test/tile.test.ts"), "test");
    assert.equal(clasifica("data/scenes/robledo.json"), "dato");
    assert.equal(clasifica("data/contract/mutation-targets.json"), "tooling");
    assert.equal(clasifica("stryker.config.json"), "tooling");
    assert.equal(clasifica("../qa/run.mjs"), "ajeno");
  });

  it("un guion de `scripts/` cae como FUENTE: si es el instrumento no lo dice la carpeta", () => {
    // La carpeta no es el criterio. `scripts/` es donde vive el instrumento y
    // también donde viven guiones que son sujeto de una batería —el caso real
    // es `manifest-kinds-con-productor.ts`, en la de `asset-store-contrato`—, y
    // hasta #404 tocar cualquiera de ellos pedía los 41 módulos.
    assert.equal(clasifica("scripts/mutate.ts"), "fuente");
    assert.equal(clasifica("scripts/manifest-kinds-con-productor.ts"), "fuente");
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

  it("un .ts suelto del paquete cuenta como CÓDIGO, no como dato", () => {
    // A un `.ts` se le pregunta quién lo CARGA, no quién lo nombra en un
    // literal. Antes daba igual —"dato" forzaba la corrida completa—; desde que
    // "dato" se deriva por lectores, mandar ahí un fichero de código sería
    // hacerle la pregunta equivocada, y la permisiva.
    assert.equal(clasifica("vite.config.ts"), "fuente");
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

  it("tocar el propio instrumento fuerza la corrida completa", () => {
    disparaTodo("scripts/mutate.ts", /instrumento de medida/);
    disparaTodo("stryker.config.json", /instrumento de medida/);
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
    const s = seleccionar(ctx({ lectores: ["alfa"] }), ["data/contract/mutacion-huella.json"]);
    assert.deepEqual(s.ids, ["alfa"]);
    assert.equal(s.todos, false);
  });

  it("un solo fichero dudoso arrastra a todo el diff", () => {
    // Lo importante es que la duda NO se diluya: un diff con noventa ficheros
    // acotados y uno dudoso se mide entero.
    const s = sel("src/scene/alfa.ts", "src/scene/huerfano.ts");
    assert.equal(s.todos, true);
    assert.deepEqual(s.ids, ["alfa", "beta"]);
  });
});

/** El forzador que anulaba el selector entero (#404): CUALQUIER `.json` o `.md`
 *  del paquete pedía los 41 módulos «porque los tests lo leen en runtime». Es
 *  cierto de algunos y falso de casi todos, y la diferencia se puede DERIVAR,
 *  que es lo que hace `ctx.leen`. Las dos direcciones importan: la que acota,
 *  porque es la razón de ser del cambio, y la que no acota, porque un dato que
 *  sí alimenta una batería tiene que seguir seleccionándola. */
describe("selector · un dato lo pide QUIEN LO LEE, no el cajón donde vive", () => {
  it("un dato que ninguna batería lee no selecciona nada, y dice por qué", () => {
    // El caso literal de #404: `data/contract/client-file-size.json` lo lee un
    // único test que no es sujeto de ninguna batería, y convertía en corrida
    // completa cualquier PR de cliente.
    const s = sel("data/contract/client-file-size.json");
    assert.equal(s.todos, false, "un dato ya no fuerza la completa por estar en data/");
    assert.deepEqual(s.ids, []);
    assert.match(s.efectos[0].porque, /ninguna batería ejecuta código que lo lea/);
    assert.match(s.efectos[0].porque, /ni lo nombra ni enumera su directorio/);
  });

  it("un dato que una batería SÍ lee la selecciona a ella, y a nadie más", () => {
    const s = seleccionar(ctx({ lectores: ["beta"] }), ["data/scenes/robledo_tile.json"]);
    assert.equal(s.todos, false);
    assert.deepEqual(s.ids, ["beta"]);
    assert.match(s.efectos[0].porque, /esas baterías ejecutan código que lo lee/);
  });

  it("un dato acotado no diluye la duda del resto del diff", () => {
    const s = sel("data/contract/client-file-size.json", "src/scene/huerfano.ts");
    assert.equal(s.todos, true);
  });
});

/** `scripts/` dejó de ser instrumento por estar en `scripts/`. El instrumento
 *  se DERIVA (cierre de runtime de `mutate.ts` y `mutacion.ts`), así que
 *  trocear el instrumento en dos ficheros no deja al segundo fuera sin que
 *  nadie lo note, y un guion que además es sujeto de una batería selecciona su
 *  módulo en vez de los 41. */
describe("selector · el instrumento se deriva, no es una carpeta", () => {
  it("un guion de scripts/ que carga una batería selecciona ESE módulo", () => {
    const s = sel("scripts/guion-de-beta.ts");
    assert.equal(s.todos, false, "vivir en scripts/ no lo convierte en el instrumento");
    assert.deepEqual(s.ids, ["beta"]);
    assert.match(s.efectos[0].porque, /sus baterías lo cargan/);
  });

  it("un guion de scripts/ que no carga nadie no selecciona nada", () => {
    const s = sel("scripts/dump-config.ts");
    assert.equal(s.todos, false);
    assert.deepEqual(s.ids, []);
  });

  it("el instrumento de verdad sigue pidiendo la completa", () => {
    const s = seleccionar(ctx({ instrumento: ["scripts/dump-config.ts"] }), ["scripts/dump-config.ts"]);
    assert.equal(s.todos, true, "lo que el contexto declara instrumento no se acota");
  });

  it("y en el árbol REAL, el instrumento incluye lo que la medida carga y no lo demás", () => {
    // Derivado del grafo: si mañana `mutate.ts` se trocea, el trozo entra solo.
    const inst = instrumentoDeMedida();
    for (const f of ["scripts/mutate.ts", "scripts/mutacion.ts", "scripts/mutation-plan.ts", "scripts/afectado.ts"]) {
      assert.ok(inst.has(f), `${f} fabrica la medida y tiene que ser instrumento`);
    }
    // El testigo del lado contrario, y es el que costó los 41 módulos de #416:
    // vive en `scripts/` y es sujeto de la batería de `asset-store-contrato`.
    assert.equal(inst.has("scripts/manifest-kinds-con-productor.ts"), false);
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
    seleccionar(ctx({ archRules, lectores }), [ARCH, ...mas]);
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

/** `mutation-targets.json` es el instrumento Y el sitio donde se ESCRIBE lo que
 *  una corrida acaba de medir. Tratándolo entero, anotar la medida costaba la
 *  corrida completa siguiente (#416: los 41 módulos por subir un suelo). Se
 *  evalúa por su estructura, y el candado va en las TRES direcciones: la prosa
 *  no selecciona, un módulo tocado selecciona ese módulo, y el comando los
 *  selecciona a todos. */
describe("selector · mutation-targets.json se evalúa por ESTRUCTURA, no entero", () => {
  const OBJ = "data/contract/mutation-targets.json";
  const selObj = (objetivos: EfectoObjetivos, ...mas: string[]) =>
    seleccionar(ctx({ objetivos }), [OBJ, ...mas]);

  it("si solo cambió prosa, no selecciona nada, y dice sobre qué se apoya", () => {
    const s = selObj({ fuerzaTodo: false, ids: [], porque: "solo cambia prosa" });
    assert.equal(s.todos, false, "anotar lo medido no puede costar la corrida siguiente");
    assert.deepEqual(s.ids, []);
    assert.match(s.efectos[0].porque, /solo cambia prosa/);
  });

  it("si cambió la definición de un módulo, selecciona ESE módulo", () => {
    const s = selObj({ fuerzaTodo: false, ids: ["beta"], porque: "cambia la definición de beta" });
    assert.equal(s.todos, false);
    assert.deepEqual(s.ids, ["beta"]);
  });

  it("si cambió lo global, corrida completa y diciendo cuál", () => {
    const s = selObj({ fuerzaTodo: true, ids: [], porque: "cambia el `comando`" });
    assert.equal(s.todos, true);
    assert.match(s.efectos[0].porque, /comando/);
  });

  it("aunque no cambie nada suyo, selecciona a quien LO LEA en runtime", () => {
    const s = seleccionar(
      ctx({ objetivos: { fuerzaTodo: false, ids: [], porque: "solo cambia prosa" }, lectores: ["alfa"] }),
      [OBJ],
    );
    assert.deepEqual(s.ids, ["alfa"]);
    assert.match(s.efectos[0].porque, /lo leen en runtime/);
  });

  it("sin dos versiones que comparar, ejecuta de más y dice cuál falta", () => {
    const v = efectoObjetivos(undefined);
    assert.equal(v.fuerzaTodo, true);
    assert.match(v.porque, /no dice contra qué versión compararlo/);
  });
});

const planDe = (o: Record<string, unknown>): string =>
  JSON.stringify({ comando: "node --test", tope_local: 120, tope_lote: 1800, modulos: [], ...o });
const modulo = (o: Record<string, unknown> = {}) => ({
  id: "alfa",
  mutate: ["src/scene/alfa.ts"],
  tests: ["test/alfa.test.ts"],
  break: 90,
  porque: "el motivo escrito, que es prosa y no selecciona",
  ...o,
});

/** La comparación de verdad, sobre dos contenidos escritos a mano. Es donde se
 *  decide qué es prosa y qué es estructura, y donde un «siempre iguales» o un
 *  «siempre distintos» pasarían desapercibidos si solo se probara una
 *  dirección. */
describe("objetivos · comparar dos versiones del plan de mutación", () => {
  const compara = (a: string, b: string) =>
    comparaObjetivos({ texto: a, nombre: "antes" }, { texto: b, nombre: "después" });
  const base = planDe({ modulos: [modulo()] });

  it("cambiar el `porque` de un módulo no selecciona a nadie", () => {
    const v = compara(base, planDe({ modulos: [modulo({ porque: "MEDIDO en la corrida de hoy: 97,4 %" })] }));
    assert.equal(v.fuerzaTodo, false);
    assert.deepEqual(v.ids, []);
    assert.match(v.porque, /solo cambia prosa/);
  });

  it("cambiar los topes de coste tampoco: no tocan a un mutante", () => {
    const v = compara(base, planDe({ modulos: [modulo()], tope_local: 200, tope_lote: 900 }));
    assert.equal(v.fuerzaTodo, false);
    assert.deepEqual(v.ids, []);
  });

  it("subir un SUELO selecciona ese módulo, y solo ese", () => {
    // Es literalmente lo que hizo #416 y costó los 41.
    const v = compara(
      planDe({ modulos: [modulo(), modulo({ id: "beta", mutate: ["src/store/beta.ts"] })] }),
      planDe({ modulos: [modulo({ break: 98 }), modulo({ id: "beta", mutate: ["src/store/beta.ts"] })] }),
    );
    assert.equal(v.fuerzaTodo, false);
    assert.deepEqual(v.ids, ["alfa"]);
  });

  it("cambiar qué muta o con qué batería también selecciona ese módulo", () => {
    assert.deepEqual(compara(base, planDe({ modulos: [modulo({ mutate: ["src/scene/otro.ts"] })] })).ids, ["alfa"]);
    assert.deepEqual(compara(base, planDe({ modulos: [modulo({ tests: ["test/otro.test.ts"] })] })).ids, ["alfa"]);
  });

  it("un módulo NUEVO se selecciona a sí mismo", () => {
    const v = compara(base, planDe({ modulos: [modulo(), modulo({ id: "beta", mutate: ["src/store/beta.ts"] })] }));
    assert.equal(v.fuerzaTodo, false);
    assert.deepEqual(v.ids, ["beta"]);
  });

  it("cambiar el `comando` sí fuerza la corrida completa", () => {
    const v = compara(base, planDe({ modulos: [modulo()], comando: "node --test --otra-cosa" }));
    assert.equal(v.fuerzaTodo, true);
    assert.match(v.porque, /comando/);
  });

  it("un módulo que DESAPARECE la fuerza: ya no se le puede seleccionar", () => {
    const v = compara(planDe({ modulos: [modulo(), modulo({ id: "beta" })] }), base);
    assert.equal(v.fuerzaTodo, true);
    assert.match(v.porque, /desaparece/);
  });

  it("si una de las dos versiones no se puede leer, corrida completa diciendo cuál", () => {
    assert.match(compara(base, "{ esto no es json").porque, /en después/);
    assert.match(compara("{ tampoco", base).porque, /en antes/);
    assert.equal(compara(base, planDe({ modulos: [] })).fuerzaTodo, true);
  });
});

describe("qué cuenta como LEER un dato", () => {
  // El grafo de imports no ve una lectura de disco, así que la respuesta sale
  // de los literales de cadena. Los dos testigos son reales y opuestos: uno
  // abre el fichero, el otro solo lo nombra en un comentario para explicar qué
  // regla lo sujeta. Si alguno deja de servir, este test lo dice.
  it("abrir el fichero cuenta", () => {
    assert.equal(leeElDato("scripts/mutation-plan.ts", "data/contract/arch-rules.json"), true);
  });

  it("nombrarlo en un comentario NO cuenta", () => {
    assert.equal(leeElDato("src/plugins/migrate.ts", "data/contract/arch-rules.json"), false);
  });

  it("un fichero del alcance que ya no está en el árbol cuenta como lector", () => {
    assert.equal(leeElDato("src/scene/no-existe-este-fichero.ts", "data/contract/arch-rules.json"), true);
  });

  // La otra mitad, y la que faltaba: quien hace `readdirSync(dir)` lee lo que
  // haya dentro sin nombrarlo nunca. Sin esto, `data/scenes/puerto_tile.json`
  // salía «no lo lee nadie» —medido— con dos baterías vivas leyéndolo.
  it("ENUMERAR el directorio cuenta como leer lo que hay dentro", () => {
    // `test/scene-fixtures.test.ts` recorre `data/scenes` con `readdirSync`.
    assert.equal(leeElDato("test/scene-fixtures.test.ts", "data/scenes/puerto_tile.json"), true);
  });

  it("…pero solo para lo que cuelga de ESE directorio", () => {
    // El par negativo: enumerar `data/scenes` no es leer `data/contract/`.
    assert.equal(leeElDato("test/scene-fixtures.test.ts", "data/contract/client-file-size.json"), false);
  });

  it("nombrar el directorio SIN enumerarlo no cuenta", () => {
    // `src/scene/scene-validate.ts` no hace `readdirSync` de nada.
    assert.equal(enumeraDirectorios("src/scene/scene-validate.ts"), false);
    assert.equal(leeElDato("src/scene/scene-validate.ts", "data/scenes/puerto_tile.json"), false);
  });
});

describe("qué cuenta como NOMBRAR un directorio", () => {
  it("una ruta sí; una palabra suelta no", () => {
    assert.equal(nombraDirectorio("../data/scenes", "data/scenes"), true);
    assert.equal(nombraDirectorio("data/scenes/", "data/scenes"), true);
    assert.equal(nombraDirectorio("/home/al/x/nefan-core/data/scenes", "data/scenes"), true);
    // `"data"` a secas es un campo de JSON o una variable en siete ficheros de
    // los alcances de hoy. Ninguno enumera todavía, así que este filtro no
    // cambia una sola selección: es el guardia para el día que uno lo haga.
    assert.equal(nombraDirectorio("data", "data"), false);
    assert.equal(nombraDirectorio("../data", "data"), true);
  });

  it("nombrar un SUBdirectorio no vale por su padre", () => {
    // Quien enumera `data/contract/tools` no lee `data/contract/fixtures/**`.
    // Éste sí se paga: casando por dentro, los 83 ficheros de
    // `data/contract/fixtures/**` pasan de ninguno a tres módulos.
    assert.equal(nombraDirectorio("../data/contract/tools", "data/contract"), false);
    assert.equal(nombraDirectorio("../data/contract/tools", "data/contract/tools"), true);
  });
});

/** El candado de totalidad del agujero: ningún fichero de datos puede salir
 *  «no lo lee nadie» sin que se haya comprobado que ninguna batería enumera su
 *  directorio.
 *
 *  Se comprueba por una vía DISTINTA de la que usa el selector: `leeElDato`
 *  empareja el literal con el directorio por sufijo, y esto RESUELVE cada
 *  literal contra el disco. Si el emparejamiento dejara de ver un directorio
 *  que sí se resuelve, esto lo dice en vez de pasar en verde. */
describe("candado · quien enumera un directorio del paquete se ve, y lo que no se ve está escrito", () => {
  const plan = leerPlan();
  const alcance = new Map<string, string[]>();
  for (const m of plan.modulos) {
    for (const f of alcanceDe(m)) alcance.set(f, [...(alcance.get(f) ?? []), m.id]);
  }

  /** Los ficheros de alguna batería que enumeran directorios SIN que se pueda
   *  saber cuál: el directorio les llega por parámetro y lo nombra quien los
   *  llama. Cada uno con lo que cuesta. La lista no exime de nada — está aquí
   *  para que un enumerador NUEVO ponga esto en rojo en vez de ampliar el
   *  agujero en silencio. */
  const CIEGOS: Record<string, string> = {
    "src/narrative/session-storage.ts":
      "enumera la raíz de `saves/`, que no está versionada: ningún fichero de datos del repo cuelga de ahí",
    "src/games/style-application.ts":
      "enumera `data/games/{id}/world/styles`, que está en .gitignore: es contenido generado, no un dato del repo",
    "src/games/loader.ts":
      "enumera el gamesDir/stylesDir que le pasan. COSTE: añadir o quitar un JUEGO o un ESTILO entero se ve igual, porque trae su `game.json` o su `style.json` y esos SÍ los nombra este fichero; lo que no se vería es un fichero suelto dentro de uno ya existente",
    "src/plugins/loader.ts":
      "enumera el directorio de plugins que le pasan. COSTE: un plugin nuevo en `data/plugins/` o en `data/games/{id}/plugins/` no selecciona por sí solo a las baterías que cargan plugins de verdad (las de `state-http-*`)",
    "scripts/manifest-kinds-con-productor.ts":
      "enumera el `cacheDir` del asset-store, que está en .gitignore: no hay dato versionado debajo",
  };

  /** ¿Cuelga algún fichero de DATOS de este directorio? Un enumerador que solo
   *  nombra directorios de código no puede estar leyendo un dato del repo. */
  const guardaDatos = (dir: string): boolean =>
    readdirSync(join(coreRoot, dir), { recursive: true, withFileTypes: true }).some(
      (e) => e.isFile() && !e.name.endsWith(".ts"),
    );

  it("todo el que enumera, o nombra el directorio de datos que enumera, o está en la lista con su coste", () => {
    const ciegos: string[] = [];
    for (const [f, ids] of alcance) {
      if (!enumeraDirectorios(f)) continue;
      if (directoriosQueNombra(f).some(guardaDatos)) continue;
      ciegos.push(`${f} (en ${ids.join(", ")})`);
    }
    assert.deepEqual(
      ciegos.map((c) => c.split(" ")[0]).sort(),
      Object.keys(CIEGOS).sort(),
      "hay un enumerador cuyo directorio el selector no ve y que no está declarado: " +
        "o nombra el directorio en un literal, o escribe aquí qué se pierde",
    );
    for (const [f, porque] of Object.entries(CIEGOS)) {
      assert.ok(porque.length > 40, `${f} está exento sin decir lo que cuesta`);
    }
  });

  /** Quién selecciona ese dato, contra el plan REAL. */
  const seleccionanA = (dato: string): Set<string> =>
    new Set([...alcance].filter(([f]) => leeElDato(f, dato)).flatMap(([, ids]) => ids));

  it("TODA fixture de `data/scenes/` selecciona las dos baterías que la leen", () => {
    // El caso medido en #404: `readdirSync(data/scenes)` desde
    // `test/scene-fixtures.test.ts`, que está en la batería de `contrato-escena`
    // y de `scene-validate`. Antes de arreglarlo, `puerto_tile.json`
    // seleccionaba CERO módulos y su PR salía verde sin medir nada.
    const fixtures = readdirSync(join(coreRoot, "data", "scenes"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"));
    assert.ok(fixtures.length > 0, "sin fixtures que auditar, este candado aprobaría sin mirar");
    for (const f of fixtures) {
      const ids = seleccionanA(`data/scenes/${f.name}`);
      for (const id of ["contrato-escena", "scene-validate"]) {
        assert.ok(ids.has(id), `data/scenes/${f.name} tiene que seleccionar ${id}`);
      }
    }
  });

  it("…incluida una fixture que TODAVÍA NO EXISTE", () => {
    // La prueba de que se deriva y no se declara: el defecto de un fichero
    // nuevo es medirse, no el silencio. Si esto fuera una lista `datos: {ruta →
    // módulos}`, una fixture recién escrita no estaría en ella.
    const ids = seleccionanA("data/scenes/todavia_no_escrita.json");
    assert.ok(ids.has("contrato-escena"));
    assert.ok(ids.has("scene-validate"));
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
