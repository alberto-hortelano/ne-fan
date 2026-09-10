/** Cómo compone el banco la URL con la que abre la página (#476).
 *
 *  El sujeto es `qa/lib/url-del-bench.mjs`, que salió de `qa/run.mjs` al
 *  arreglar el defecto: el runner pegaba sus parámetros DETRÁS de la URL con
 *  una concatenación literal, así que `--url http://host/?offset=500` se
 *  convertía en `http://host/?offset=500/?input=scripted…`. Nadie sirve esa
 *  URL: la corrida entera salía roja y lo que enseñaba era el primer aserto de
 *  cada guion, o sea el juego. Es el mismo pecado que #494 por el otro lado —
 *  el entorno disfrazado de código— y por eso el candado no es un guion de
 *  navegador: es una cadena, y se mide como una cadena.
 *
 *  El import cruzado es la regla (#357): la dirección es test → banco
 *  (`el-banco-no-entra-en-produccion`) y todo `qa/lib/*.mjs` tiene test o
 *  exención (`test/qa-lib-tiene-quien-lo-mire.test.ts`).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const mod = (await import(join(repoRoot, "qa", "lib", "url-del-bench.mjs"))) as {
  urlDeArranque: (raw: string) => URL;
  offsetDeLaUrl: (raw: string) => number;
  urlDeLaPagina: (base: string, params: Record<string, string>) => string;
};
const { urlDeArranque, offsetDeLaUrl, urlDeLaPagina } = mod;

/** Lo que el runner le pone SIEMPRE a la página (`PARAMS_DEL_BENCH`). */
const BENCH = { input: "scripted", ai: "http://127.0.0.1:18765", raf: "timer" };

describe("la URL con la que el banco abre la página", () => {
  it("sin query en la base, sale la de siempre: los parámetros detrás de un `?`", () => {
    assert.equal(
      urlDeLaPagina("http://localhost:3000", BENCH),
      "http://localhost:3000/?input=scripted&ai=http%3A%2F%2F127.0.0.1%3A18765&raf=timer",
    );
  });

  it("EL DEFECTO DE #476: una base que YA trae query se mezcla, no se concatena", () => {
    const url = urlDeLaPagina("http://localhost:3500/?offset=500", BENCH);
    // Lo que salía antes: `…/?offset=500/?input=scripted&…` — dos `?` y el
    // segundo dentro del path.
    assert.equal(url.split("?").length - 1, 1, `dos veces «?» en la URL: ${url}`);
    const u = new URL(url);
    assert.equal(u.pathname, "/", `la query anterior se coló en el path: ${u.pathname}`);
    assert.equal(u.searchParams.get("offset"), "500", "se perdió lo que traía la URL de quien la escribió");
    assert.equal(u.searchParams.get("input"), "scripted");
  });

  it("un parámetro del banco PISA al de la URL: no son preferencias, son condiciones", () => {
    // `input=teclado` contra el banco sería una corrida sin provider scripted:
    // no es una variante, es otra cosa.
    const u = new URL(urlDeLaPagina("http://localhost:3000/?input=teclado&mio=1", BENCH));
    assert.equal(u.searchParams.get("input"), "scripted");
    assert.equal(u.searchParams.get("mio"), "1", "lo que el banco no nombra se conserva");
  });

  it("conserva el path de la base (un stack servido bajo un prefijo)", () => {
    const u = new URL(urlDeLaPagina("http://host:3000/juego/", BENCH));
    assert.equal(u.pathname, "/juego/");
  });

  it("el bloque de puertos se LEE de la URL: `?offset=500` es un stack del +500", () => {
    assert.equal(offsetDeLaUrl("http://localhost:3500/?offset=500"), 500);
    assert.equal(offsetDeLaUrl("http://localhost:3000/"), 0, "sin offset es el bloque de siempre");
    assert.equal(offsetDeLaUrl("http://localhost:3000/?offset="), 0, "vacío no es un bloque, es no decirlo");
  });

  it("un offset que no es un número se DICE, no se degrada a 0", () => {
    // Degradarlo sería apuntar el motor falso y el sondeo de puertos al bloque
    // del vecino sin que nadie lo pidiera: medir contra otro stack en silencio.
    assert.throws(() => offsetDeLaUrl("http://localhost:3000/?offset=cien"), /offset que no es un número/);
  });

  it("una `--url` que no es una URL es fail-loud, no «sin query»", () => {
    assert.throws(() => urlDeLaPagina("", BENCH), /no es una URL/);
    // El olvido que NO lanza solo: `new URL("localhost:3000")` se lee como
    // esquema `localhost:` con path `3000` — una URL válida para el parser,
    // inservible para el navegador y sin query de la que leer el bloque.
    assert.throws(() => urlDeArranque("localhost:3000"), /no es una URL http\(s\)/);
    assert.equal(urlDeArranque("http://localhost:3000/").protocol, "http:");
    assert.equal(urlDeArranque("https://localhost:3000/").protocol, "https:");
  });
});
