/** TODO GUION QUE ARRANCA UNA PARTIDA DECLARA SU MODO DE ESCENARIOS.
 *
 *  El modo de render es la puerta del GASTO de escenarios (el atlas de
 *  superficies del tile). Hasta el 2026-09-14 ningún guion lo fijaba: los 77
 *  que pasan por `nuevaPartida` corrían en el que trajera puesto el selector, y
 *  cuando ese defecto cambió a maqueta (`MODO_AL_EMPEZAR`) todos ellos habrían
 *  pasado a medir otra cosa **en silencio** — verdes sin medir nada, que es la
 *  enfermedad que esta casa tiene fichada.
 *
 *  Para los que pasan por `nuevaPartida` eso ya no puede ocurrir: la función
 *  EXIGE `renderMode` y quien se lo deje se lleva un throw con el remedio. Este
 *  test es la otra mitad, y nace de un hallazgo de QA (H2): hay guiones que
 *  conducen el selector A MANO —su sujeto ES la pantalla— y por esa puerta el
 *  agujero seguía abierto. Eran CINCO (12, 20, 82, 92 y 96) y el informe de la
 *  PR solo nombraba dos, que es exactamente lo que pasa cuando la cuenta la
 *  lleva un párrafo en vez de un checker.
 *
 *  LA PREGUNTA ES «¿ARRANCA UNA PARTIDA?», NO «¿PASA POR EL SELECTOR?». Pulsar
 *  «Continuar» solo abre el editor de personaje y no gasta nada: el 96 hace
 *  cinco idas y vueltas por ahí sin llegar nunca a jugar, y obligarle a elegir
 *  un modo sería pedirle que declare algo que no ejerce. El gasto empieza en
 *  «Comenzar» (`#ts-start`), y ése es el umbral que se mira.
 *
 *  QUÉ CUENTA COMO DECLARAR: llamar a `nuevaPartida` (que lo exige) o pulsar
 *  `#ts-rendermode` en algún sitio del guion. Es a propósito GRUESO y de
 *  fichero: no comprueba que el click esté antes del de personajes ni que el
 *  modo sea el correcto —eso lo dice el censo de gasto de `qa/run.mjs`, que es
 *  una MEDIDA—, sino que alguien haya pensado en el modo al escribir el guion.
 *  Un candado que intentara adivinar el modo correcto leyendo el fuente sería
 *  la tercera opinión sobre una pregunta que ya se contesta midiendo.
 *
 *  Vive en `nefan-core/test/` y no en `qa/` por la misma razón que
 *  `qa-lib-tiene-quien-lo-mire`: la dirección es test → banco, y así corre en
 *  `npm test` (o sea, en CI) sin abrir un navegador. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUIONES = join(core, "..", "qa", "guiones");

/** ¿Este fuente ARRANCA una partida? Las dos formas que existen: el helper del
 *  banco (`comenzar(ctx…)`, que pulsa «Comenzar» por ti) y el click a pelo.
 *  Esperar por el selector NO cuenta —el 96 hace `waitForSelector("#ts-start")`
 *  y nunca lo pulsa—, y esa distinción es la mitad del test. */
export function arrancaPartida(fuente: string): boolean {
  return /\bcomenzar\(\s*ctx\b/.test(fuente) || /\.click\(\s*["'`]#ts-start["'`]/.test(fuente);
}

/** ¿Declara el modo de escenarios? Por el helper que lo exige (`nuevaPartida`,
 *  con su `ctx`), o nombrando el BOTÓN con su atributo.
 *
 *  Las dos formas piden más que el nombre suelto, y no es quisquillosidad: la
 *  primera versión aceptaba `#ts-rendermode` a secas y la mención en la
 *  CABECERA del guion 12 —«hoy pulsa también `#ts-rendermode`», escrita en la
 *  misma PR— ya lo daba por declarado. Un detector que cuenta prosa es el verde
 *  que no comprueba nada, la misma trampa que QA encontró en
 *  `qa-lib-tiene-quien-lo-mire` (#454 H1). El selector CON su
 *  `[data-rendermode=` es lo que se escribe para apuntar a un botón y lo que la
 *  prosa no escribe; vale tanto el click directo como la tabla de casos del
 *  guion 106, que los guarda en datos y los pulsa en bucle. */
export function declaraElModo(fuente: string): boolean {
  return llamadasANuevaPartida(fuente).every(conRenderMode) && (todasDeclaran(fuente) || porElBoton(fuente));
}

const porElBoton = (fuente: string): boolean => /#ts-rendermode \[data-rendermode=/.test(fuente);
const todasDeclaran = (fuente: string): boolean => llamadasANuevaPartida(fuente).length > 0;
/** Con dos puntos o en forma abreviada: `{ …, renderMode }` es lo que escriben
 *  el 59 y el 60, que reciben el modo por parámetro y lo reenvían. Pedir el
 *  `:` los habría acusado de mudos teniendo el campo puesto — un falso rojo
 *  sobre los dos únicos guiones que ya lo hacían bien. */
const conRenderMode = (llamada: string): boolean => /\brenderMode\s*(?::|,|\})/.test(llamada);

/** Cada llamada a `nuevaPartida`, desde su nombre hasta el `)` que la cierra.
 *
 *  HACE FALTA MIRAR EL ARGUMENTO, Y ESTO ES LO QUE ESTE TEST NO HACÍA. La
 *  primera versión daba por declarado cualquier fichero que NOMBRARA
 *  `nuevaPartida`, razonando que la función exige `renderMode` y lanza sin él.
 *  Y lanza — pero **en el navegador**, y los guiones de navegador no los corre
 *  el CI. Resultado medido el 2026-09-14: cinco guiones (114, 115, 118, 119,
 *  126) entraron en `main` llamándola sin el campo, rojos desde el primer día,
 *  con este test en VERDE y `candados-headless` en verde. Los trajeron PR que
 *  no se tocaban entre sí: compartían el CONTRATO de `qa/lib/sesion.mjs`, y el
 *  orden de fusión decidió cuál se enteraba.
 *
 *  O sea que el candado candaba la mitad barata —que alguien pensara en el
 *  modo— y dejaba fuera la que rompe: que lo haya escrito. Contar paréntesis es
 *  feo, pero es lo que separa «lo nombra» de «se lo pasa». */
function llamadasANuevaPartida(fuente: string): string[] {
  const llamadas: string[] = [];
  for (const m of fuente.matchAll(/\bnuevaPartida\(/g)) {
    let nivel = 0;
    for (let i = m.index + m[0].length - 1; i < fuente.length; i++) {
      if (fuente[i] === "(") nivel++;
      else if (fuente[i] === ")" && --nivel === 0) {
        llamadas.push(fuente.slice(m.index, i + 1));
        break;
      }
    }
  }
  return llamadas;
}

/** Los guiones con su fuente, leídos UNA vez: los dos ejes de este fichero
 *  (el modo y el entorno) miran la misma carpeta. */
const guiones = readdirSync(GUIONES)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => ({ nombre: f, fuente: readFileSync(join(GUIONES, f), "utf8") }));

describe("el banco declara con qué modo de gasto arranca cada partida (QA H2)", () => {

  it("hay guiones y arrancan partidas: la totalidad tiene sujeto", () => {
    // El peor verde sería un detector que no lee nada, o un directorio vacío.
    assert.ok(guiones.length >= 50, `solo ${guiones.length} guiones: ¿se movió el directorio?`);
    const arrancan = guiones.filter((g) => arrancaPartida(g.fuente));
    assert.ok(arrancan.length >= 50, `solo ${arrancan.length} arrancan partida: ¿dejó de cazar?`);
  });

  it("ninguno arranca una partida sin declarar su modo de escenarios", () => {
    const mudos = guiones
      .filter((g) => arrancaPartida(g.fuente) && !declaraElModo(g.fuente))
      .map((g) => g.nombre);
    assert.deepEqual(
      mudos,
      [],
      "estos guiones arrancan una partida y no dicen en qué modo, así que heredan el defecto " +
        "de `MODO_AL_EMPEZAR` y el día que cambie medirán otra cosa sin que nadie se entere. " +
        "Arréglalo llamando a `nuevaPartida` (que lo exige) o pulsando " +
        '`#ts-rendermode [data-rendermode="…"]` ANTES del de personajes',
    );
  });

  // SABE PONERSE ROJO. Sin esto, los dos asertos de arriba se verían igual con
  // un detector que devolviera siempre `false` en `arrancaPartida` — que es la
  // forma que tendría este test de dejar de candar sin decirlo.
  it("[detector] arrancar es pulsar «Comenzar», no esperarlo", () => {
    assert.equal(arrancaPartida('await comenzar(ctx);'), true, "el helper del banco");
    assert.equal(arrancaPartida('await comenzar(ctx, 90_000);'), true, "con tope");
    assert.equal(arrancaPartida('await ctx.page.click("#ts-start");'), true, "el click a pelo");
    assert.equal(arrancaPartida("await ctx.page.click('#ts-start');"), true, "con comillas simples");
    assert.equal(
      arrancaPartida('await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });'),
      false,
      "esperar el botón no es pulsarlo: el 96 va y vuelve del editor sin jugar",
    );
  });

  it("[detector] declarar es `nuevaPartida` o el botón; ni la prosa ni el de personajes valen", () => {
    assert.equal(declaraElModo('await nuevaPartida(ctx, { renderMode: "vector" });'), true);
    assert.equal(declaraElModo('await ctx.page.click(\'#ts-rendermode [data-rendermode="image"]\');'), true);
    assert.equal(
      declaraElModo('clicks: [\'#ts-rendermode [data-rendermode="image"]\'],'),
      true,
      "la tabla de casos del 106 guarda el selector en datos y lo pulsa en bucle",
    );
    assert.equal(
      declaraElModo("await ctx.page.click(`#ts-rendermode [data-rendermode=\"${renderMode}\"]`);"),
      true,
      "el selector parametrizado (59 y 60 lo hacían así antes de pasarlo a `nuevaPartida`)",
    );
    // LA MITAD QUE FALTABA, y la que se cobró cinco guiones rojos en `main` el
    // 2026-09-14: nombrar la función no es pasarle el campo. Lanza, sí — pero
    // en el navegador, y el CI no corre guiones de navegador.
    assert.equal(
      declaraElModo('await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "image" });'),
      false,
      "llama a `nuevaPartida` SIN `renderMode`: rojo en el navegador y verde aquí hasta hoy",
    );
    assert.equal(
      declaraElModo('await nuevaPartida(ctx, { gameId: G, renderMode: "image", charMode: "image" });'),
      true,
      "con el campo puesto, que es lo que se pide",
    );
    assert.equal(
      declaraElModo(
        'await nuevaPartida(ctx, { gameId: A, renderMode: "vector" });\nawait nuevaPartida(ctx, { gameId: B });',
      ),
      false,
      "UNA llamada muda basta para romperlo: con `some` en vez de `every`, la segunda se cuela",
    );
    assert.equal(
      declaraElModo('await nuevaPartida(ctx, { gameId: G, renderMode: modoDe(caso) });'),
      true,
      "el campo puede venir de una variable: se mira que esté, no cuánto vale",
    );
    assert.equal(
      declaraElModo('await nuevaPartida(ctx, { gameId: G, charMode: "vector", renderMode });'),
      true,
      "abreviado, que es como lo escriben el 59 y el 60: exigir los dos puntos los acusaba en falso",
    );
    assert.equal(
      declaraElModo('// antes esto llamaba a nuevaPartida(ctx) y ya no'),
      false,
      "una mención en un comentario con la forma de llamada tampoco pasa: el detector no lee prosa",
    );
    // Los dos verdes vacíos que este detector tiene que saber rechazar.
    assert.equal(
      declaraElModo(" *  Hoy pulsa también `#ts-rendermode`, que es la única forma de que…"),
      false,
      "una CABECERA que habla del botón no lo pulsa — es la mención que la PR de la tanda A añadió al guion 12",
    );
    assert.equal(
      declaraElModo(" *  `nuevaPartida` espera el botón «Nueva partida», que aparece cuando…"),
      false,
      "nombrar el helper en prosa tampoco: el 39 y el 120 lo hacen y no lo llaman",
    );
    assert.equal(
      declaraElModo('await ctx.page.click(`#ts-charmode [data-charmode="vector"]`);'),
      false,
      "elegir el modo de PERSONAJES no dice nada del de escenarios — era justo el descuido de los cinco",
    );
  });
});

/** EL SEGUNDO EJE: el ENTORNO (tanda AS, 2026-09-24). El modo de escenarios
 *  dice qué QUIERE la partida; el entorno del stack dice si los caminos
 *  automáticos PUEDEN pagar (`gatesDeImagen`). Un guion que mide que se pinta
 *  necesita `produccion` —el defecto del banco— y uno que mide que en
 *  desarrollo no se paga lo declara. La declaración la lee `qa/lib/entornos.mjs`
 *  y la ejerce el runner; aquí se comprueba, en CI y sin navegador, que toda
 *  declaración del árbol vale algo que el runner entiende. */
const entornos = (await import(join(core, "..", "qa", "lib", "entornos.mjs"))) as {
  ENTORNOS: string[];
  ENTORNO_DEL_BANCO: string;
  entornoDelFuente(fuente: string): string;
  entornoDeclarado(nombre: string, valor: unknown): string;
  ordenarPorEntorno(guiones: string[], entornoDe: (g: string) => string): string[];
};
const { leerEntorno } = await import("../src/session/gates-de-imagen.js");

describe("todo guion mide contra un entorno que existe (tanda AS)", () => {
  it("los nombres del banco son los de core: los dos que `leerEntorno` acepta", () => {
    assert.deepEqual([...entornos.ENTORNOS].sort(), ["desarrollo", "produccion"]);
    for (const e of entornos.ENTORNOS) assert.equal(leerEntorno(e).ok, true, e);
    assert.equal(entornos.ENTORNO_DEL_BANCO, "produccion", "sin declarar, el banco mide lo que medía: producción");
  });

  it("cada `export const entorno` del árbol vale uno de los dos", () => {
    const malos = guiones
      .map((g) => [g.nombre, entornos.entornoDelFuente(g.fuente)] as const)
      .filter(([, e]) => !entornos.ENTORNOS.includes(e));
    assert.deepEqual(malos, []);
  });

  it("…y al menos un guion mide cada entorno: sin eso, un grupo entero podría quedarse sin nadie", () => {
    const declarados = new Set(guiones.map((g) => entornos.entornoDelFuente(g.fuente)));
    assert.deepEqual([...declarados].sort(), ["desarrollo", "produccion"]);
  });

  it("el detector lee la declaración y no la prosa; el módulo valida lo que el fichero preselecciona", () => {
    assert.equal(entornos.entornoDelFuente('export const entorno = "desarrollo";\n'), "desarrollo");
    assert.equal(entornos.entornoDelFuente(" *  hoy `export const entorno = \"desarrollo\"` no está\n"), "produccion");
    assert.equal(entornos.entornoDelFuente("export const aisla = [];\n"), "produccion");
    assert.equal(entornos.entornoDeclarado("g", undefined), "produccion");
    assert.equal(entornos.entornoDeclarado("g", "desarrollo"), "desarrollo");
    assert.throws(() => entornos.entornoDeclarado("g", "prod"), /g: .*"prod"/);
    assert.throws(() => entornos.entornoDeclarado("g", true), /g: /);
  });

  it("el runner agrupa por entorno SIN desordenar cada grupo (un reinicio de stack por grupo, no por guion)", () => {
    const de: Record<string, string> = { a: "desarrollo", b: "produccion", c: "desarrollo", d: "produccion" };
    assert.deepEqual(entornos.ordenarPorEntorno(["a", "b", "c", "d"], (g) => de[g]!), ["b", "d", "a", "c"]);
    assert.deepEqual(entornos.ordenarPorEntorno(["d", "c", "b", "a"], (g) => de[g]!), ["d", "b", "c", "a"]);
  });
});
