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
  return /\bnuevaPartida\(\s*ctx\b/.test(fuente) || /#ts-rendermode \[data-rendermode=/.test(fuente);
}

describe("el banco declara con qué modo de gasto arranca cada partida (QA H2)", () => {
  const guiones = readdirSync(GUIONES)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => ({ nombre: f, fuente: readFileSync(join(GUIONES, f), "utf8") }));

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
