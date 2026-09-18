/** Totalidad de las consultas de MOVIMIENTO del banco (#662, tanda P,
 *  2026-09-18): toda aparición de `probeCollide` en `qa/` está declarada con su
 *  motivo, o el test se pone rojo.
 *
 *  ## Qué sujeta
 *
 *  `window.__nefan.probeCollide` es `CollisionSystem.collidesAt`, y es la
 *  pregunta «¿me frena ir DE DONDE ESTOY a ahí?». Sus tres fuentes son «salir
 *  sí, entrar no», así que contesta `false` por donde el jugador ya está —
 *  `qa/README.md` lo tiene medido como afirmación universal: 99.932 de 99.932
 *  puntos, también en el centro macizo de un edificio. Describir el mundo con
 *  ella es #644; y un aserto que la pregunta sobre el punto donde acaba de
 *  aparcarse al jugador (`setPlayerPos(p)` → `probeCollide(p)`) **no puede
 *  ponerse rojo**. Desde #644 el hook publica `probePoint` (`ocupadoEn`), que
 *  es la misma pregunta sin origen.
 *
 *  ## Por qué el detector lee el ÁRBOL y no el texto
 *
 *  Lo que había era el bloque 1 del guion 145: un `match(/__nefan\.probeCollide/g)`
 *  sobre CINCO ficheros listados a mano. Contaba UNA grafía de las tres que
 *  llegan a la misma función, y la casa se ha comido el mismo fallo dos veces
 *  seguidas (#606 con `esperarUnosFrames`, y este issue existe porque volvió a
 *  pasar). Las tres vivas el día que se escribió esto:
 *
 *   · `window.__nefan.probeCollide(x, z)` — la directa;
 *   · `const pc = window.__nefan.probeCollide` → `pc(...)` ×N — el ALIAS, que
 *     un censo por grafía cuenta como UN sitio aunque alimente seis llamadas
 *     (el guion 81 escondía exactamente seis detrás de un `pc`);
 *   · `ctx.nefan("probeCollide", x, z)` → `qa/lib/sonda.mjs` despacha por
 *     `hook[p](...)` — el STRING, que no ve ni el censo ni el 145.
 *
 *  Y la cuarta, `const { probeCollide } = window.__nefan`, nacería verde con
 *  cualquier detector por grafía. La clave no es enumerar formas: en la práctica
 *  no se llama a esa función sin escribir su nombre, porque el seam publica por
 *  nombre y `sonda.mjs` despacha por string. Así que se cuentan los NODOS cuyo
 *  texto es exactamente `probeCollide` —`Identifier` (propiedad, alias,
 *  desestructuración) y `StringLiteralLike` (el string de `sonda.mjs` y el
 *  template sin sustitución)—, sobre TODO `qa/**` y no sobre una lista. Los
 *  comentarios no son nodos, así que la prosa se excluye sola: no hace falta la
 *  heurística del acento grave que usaba el 145, y una expresión regular que
 *  NOMBRE la sonda (`qa/la-consulta-de-punto-no-tiene-origen.mjs` tiene una) no
 *  cuenta, porque un `RegularExpressionLiteral` tampoco la llama.
 *
 *  ## QUÉ NO SUJETA, dicho aquí y no descubierto por el siguiente
 *
 *  «En la práctica» no es «nunca», y la versión anterior de este párrafo decía
 *  que **no hay forma** de llamarla sin escribir su nombre. Lo tumbó la QA de
 *  esta PR con dos contraejemplos que pasan en VERDE:
 *  `window.__nefan["probe" + "Collide"](x, z)` y un template CON sustitución.
 *  No se cierran a propósito —nadie escribe eso sin querer, y evaluar
 *  expresiones convertiría el detector en medio intérprete—, pero se escriben.
 *
 *  Y hay una SEGUNDA PUERTA a la misma `collidesAt` que no pasa por este nombre
 *  en absoluto: `state().blocked` del hook, que son cuatro `collidesAt` a 0,5 m
 *  del jugador. Hoy la lee un solo guion, el 144, y la lee BIEN (pregunta por
 *  los rumbos vivos del jugador, que es movimiento de verdad). El día que
 *  alguien la use para describir el mundo, este candado no se entera.
 *
 *  Lo mismo, con su medida, en `_lo_que_esto_NO_sujeta` del padrón.
 *
 *  Mismo patrón de totalidad que `banco-medido.json`, `mutation-targets.json` y
 *  `candados-headless.json`, y mismo precedente de detector que
 *  `qa-lib-tiene-quien-lo-mire.test.ts` (#454): el verde falso se tapa parseando.
 *
 *  ## Las dos direcciones
 *
 *  La cuenta del padrón es EXACTA, no un tope. Añadir una sonda sin declararla
 *  es rojo, y **borrar una declarada también** — que es lo que el 145 estrenó
 *  con la sonda legítima del 119 y lo que impide que alguien «arregle» una que
 *  el issue pide no tocar.
 *
 *  Corre en `npm test`, o sea en CADA PR. El bloque 1 del 145 vivía en la
 *  batería de navegador, que el CI no corre. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const QA = join(repoRoot, "qa");
const CONTRATO = join(core, "data", "contract", "sondas-de-movimiento.json");

/** La sonda de MOVIMIENTO, tal y como la publica `nefan-html/src/dev/nefan-hook.ts`. */
const SONDA = "probeCollide";
/** Su hermana sin origen (#644). Sirve para el aserto del complemento. */
const SONDA_DE_PUNTO = "probePoint";

const PadronSchema = z
  .object({
    _comment: z.string().min(1),
    /** Qué NO sujeta este candado. Obligatorio, y no es decorado: la primera
     *  versión de `_comment` afirmaba «ninguna grafía nueva puede nacer verde»
     *  y era falso (QA de #662). Un absoluto en la cabecera de un contrato es
     *  lo que hace que el siguiente no mire, así que los agujeros conocidos se
     *  escriben AL LADO de lo que sí se sujeta. */
    _lo_que_esto_NO_sujeta: z.string().min(1),
    declaradas: z
      .array(
        z
          .object({
            /** Ruta relativa a la raíz del repo, como la escribe `git`. */
            fichero: z.string().regex(/^qa\/[\w./-]+\.mjs$/, "una declaración nombra un `qa/**/*.mjs`"),
            /** EXACTA, no un tope: por eso también es rojo que sobren. */
            apariciones: z.number().int().min(1),
            /** Obligatorio: una sonda de movimiento sin motivo es #644 esperando. */
            porque: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type Padron = z.infer<typeof PadronSchema>;

/** Cuántas veces NOMBRA este fuente al identificador `nombre`, contando NODOS
 *  del árbol y no coincidencias de texto.
 *
 *  Cuenta `Identifier` (la propiedad de `window.__nefan.x`, el alias
 *  `const pc = …x`, la desestructuración `const {x} = …`) y `StringLiteralLike`
 *  (el `ctx.nefan("x", …)` que `qa/lib/sonda.mjs` despacha, y su template sin
 *  sustitución). NO cuenta comentarios ni JSDoc —no son nodos que visite
 *  `forEachChild`, y el guardia de abajo lo deja explícito—, ni un literal de
 *  expresión regular, ni un identificador que solo EMPIECE por ese nombre
 *  (`probeCollides` es otra cosa), ni una mención dentro de un string más
 *  largo: se exige el texto EXACTO. */
export function apariciones(fuente: string, nombre: string): number {
  let n = 0;
  const sf = ts.createSourceFile("x.mjs", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visita = (nodo: ts.Node): void => {
    // JSDoc sí entra en el árbol en ficheros .js; que no cuente es parte del
    // contrato de este detector y no un efecto colateral de `forEachChild`.
    if (nodo.kind >= ts.SyntaxKind.FirstJSDocNode && nodo.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if ((ts.isIdentifier(nodo) || ts.isStringLiteralLike(nodo)) && nodo.text === nombre) n++;
    ts.forEachChild(nodo, visita);
  };
  visita(sf);
  return n;
}

/** Todos los `.mjs` del banco, en ruta relativa a la raíz del repo. Se salta
 *  `node_modules`, las capturas y los directorios efímeros de una corrida
 *  (`qa/.tmp/<run>/`), que no son fuente del banco. */
export function fuentesDelBanco(dir: string, raiz: string = dir, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === "node_modules" || e.name === "capturas" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) fuentesDelBanco(p, raiz, out);
    else if (e.name.endsWith(".mjs")) out.push(relative(raiz, p).split(sep).join("/"));
  }
  return out;
}

const padron: Padron = PadronSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const declaradas = new Map(padron.declaradas.map((d) => [d.fichero, d]));
const fuentes = fuentesDelBanco(QA).map((f) => `qa/${f}`);
const censo = new Map(
  fuentes.map((f) => [f, apariciones(readFileSync(join(repoRoot, f), "utf8"), SONDA)] as const),
);
const censoDePunto = new Map(
  fuentes.map((f) => [f, apariciones(readFileSync(join(repoRoot, f), "utf8"), SONDA_DE_PUNTO)] as const),
);

describe(`la consulta de movimiento tiene dueño (#662): ${SONDA} en qa/`, () => {
  it("el árbol tiene sujeto: hay fuentes del banco y el detector encuentra sondas", () => {
    // Sin esto, un detector que mirase el directorio equivocado aprobaría la
    // totalidad sobre cero ficheros: el peor de los verdes.
    assert.ok(fuentes.length > 50, `solo ${fuentes.length} fuentes .mjs bajo ${QA} — ¿se movió el banco?`);
    const total = [...censo.values()].reduce((a, b) => a + b, 0);
    assert.ok(total > 0, `el detector no ve ni una aparición de ${SONDA}: o se retiró la sonda del hook, o está roto`);
  });

  it("cada aparición de probeCollide está declarada, con su cuenta EXACTA", () => {
    const mal = fuentes
      .map((f) => ({ f, hay: censo.get(f) ?? 0, dice: declaradas.get(f)?.apariciones ?? 0 }))
      .filter((r) => r.hay !== r.dice);
    assert.deepEqual(
      mal.map((r) => `${r.f}: ${r.hay} en el árbol contra ${r.dice} declaradas`),
      [],
      `La consulta de MOVIMIENTO contesta «no» por donde el jugador ya está, así que describir el mundo con ` +
        `ella es #644 y preguntarla sobre el punto donde acabas de aparcar al jugador es un aserto que no ` +
        `puede ponerse rojo. O la sonda pasa a \`${SONDA_DE_PUNTO}\`, o entra en ` +
        `data/contract/sondas-de-movimiento.json con su cuenta y su motivo. Si sobra alguna, alguien borró ` +
        `una sonda declarada: eso también es rojo, y a propósito.`,
    );
  });

  it("el complemento, DERIVADO: quien ya sondea por PUNTO no ha vuelto a la de movimiento", () => {
    // Lo que afirmaba el bloque 1 del guion 145 con una lista `MIGRADOS`
    // escrita a mano. Aquí no hay lista: «migrado» es «llama a probePoint», y
    // la regresión es «…y además tiene probeCollide sin declarar».
    const migrados = fuentes.filter((f) => (censoDePunto.get(f) ?? 0) > 0);
    assert.ok(
      migrados.length >= 10,
      `solo ${migrados.length} fuentes del banco preguntan por ${SONDA_DE_PUNTO} — el 145 cubría cinco y la ` +
        `tanda P migró treinta y siete sitios; por debajo de diez, este aserto se ha quedado sin sujeto`,
    );
    const regresados = migrados.filter((f) => (censo.get(f) ?? 0) > (declaradas.get(f)?.apariciones ?? 0));
    assert.deepEqual(
      regresados,
      [],
      `estos ficheros ya preguntaban por PUNTO y han vuelto a la consulta de MOVIMIENTO sin declararlo: es ` +
        `#644 otra vez, y desde un origen libre las dos contestan lo mismo, así que no se nota corriéndolo`,
    );
  });

  it("ninguna declaración apunta a un fichero que ya no existe", () => {
    const muertas = padron.declaradas.filter((d) => !existsSync(join(repoRoot, d.fichero)));
    assert.deepEqual(
      muertas.map((d) => d.fichero),
      [],
      "una declaración a un fichero borrado revive sola el día que alguien vuelva a crear esa ruta",
    );
  });

  it("un motivo no puede ser un encogimiento de hombros, ni el mismo copiado", () => {
    // Palabras DISTINTAS, no palabras: un relleno que repite «la sonda la sonda
    // la sonda» cuenta doce y no dice nada (lección de la tanda E). Y distinto
    // del de las demás entradas, porque copiar el de al lado es la otra forma
    // barata de cumplir el listón.
    const vistos = new Map<string, string>();
    for (const d of padron.declaradas) {
      const palabras = new Set(
        d.porque
          .toLowerCase()
          .split(/[^\p{L}\p{N}_.]+/u)
          .filter(Boolean),
      );
      assert.ok(
        palabras.size >= 12,
        `sondas-de-movimiento.json["${d.fichero}"]: "${d.porque}" tiene ${palabras.size} palabras distintas — ` +
          `di POR QUÉ el origen vivo es el sujeto de esa pregunta`,
      );
      const previo = vistos.get(d.porque);
      assert.equal(previo, undefined, `${d.fichero} repite literalmente el motivo de ${previo}`);
      vistos.set(d.porque, d.fichero);
    }
  });
});

describe("el detector de sondas de movimiento", () => {
  it("cuenta las TRES grafías vivas y la cuarta que aún no existe", () => {
    // Las tres que llegan hoy a `collidesAt` y la que nacería verde con
    // cualquier detector por grafía. El alias cuenta UNA vez —el nombre se
    // escribe una vez— y las seis llamadas que alimenta van con él.
    const texto = [
      "const a = window.__nefan.probeCollide(x, z);", // directa
      "const pc = window.__nefan.probeCollide;", // alias
      "const b = [pc(1, 2), pc(3, 4), pc(5, 6)];", // …y sus llamadas, que no lo nombran
      'const c = await ctx.nefan("probeCollide", x, z);', // string de sonda.mjs
      "const d = await ctx.nefan(`probeCollide`, x, z);", // template sin sustitución
      "const { probeCollide } = window.__nefan;", // desestructuración: la cuarta
      'const e = window.__nefan["probeCollide"](x, z);', // acceso por índice
    ].join("\n");
    assert.equal(apariciones(texto, SONDA), 6);
  });

  it("NO cuenta la prosa: ni comentario de línea, ni JSDoc, ni acento grave", () => {
    // Lo que el 145 resolvía con una heurística («va con acento grave y sin el
    // `__nefan.` delante»). Para el árbol, un comentario no es un nodo.
    const texto = [
      "// el barrido usa probeCollide cada 25 cm",
      "/** Rumbo libre por delante (`probeCollide` cada 25 cm). No lo llama. */",
      "/* probeCollide probeCollide probeCollide */",
      "const x = 1;",
    ].join("\n");
    assert.equal(apariciones(texto, SONDA), 0);
  });

  it("NO cuenta una regex que la nombra, ni un string más largo, ni otro identificador", () => {
    // Los tres vivos en el árbol: la regex de
    // `qa/la-consulta-de-punto-no-tiene-origen.mjs`, su `probeCollides` en
    // plural, y los mensajes de traza que la citan dentro de una frase.
    const texto = [
      "const m = [...HOOK.matchAll(/probeCollide[:(][^\\n]*/g)];",
      "const probeCollides = m.map((x) => x[0]);",
      'const s = "probeCollide (movimiento): " + JSON.stringify(v);',
      'const t = `${n} llamada(s) a __nefan.probeCollide contra las declaradas`;',
      "const u = /probeCollide/.test(src);",
    ].join("\n");
    assert.equal(apariciones(texto, SONDA), 0);
  });

  it("distingue la sonda de PUNTO de la de MOVIMIENTO en el mismo fichero", () => {
    // El caso real de los migrados: `pc` pasó a significar `probePoint` en unos
    // ficheros y seguía siendo `probeCollide` en otros, y es lo que dejó al 81
    // atrás sin que se notara.
    const texto = [
      "const pc = window.__nefan.probePoint;",
      "const mov = window.__nefan.probeCollide;",
      'await ctx.nefan("probePoint", x, z);',
    ].join("\n");
    assert.equal(apariciones(texto, SONDA), 1);
    assert.equal(apariciones(texto, SONDA_DE_PUNTO), 2);
  });

  it("NO ve el nombre PARTIDO, y eso está escrito en el contrato en vez de descubrirse", () => {
    // El agujero que la QA de #662 encontró en una afirmación absoluta («no hay
    // forma de llamarla sin escribir su nombre»). Las dos formas de abajo
    // llegan a `collidesAt` y este detector las cuenta como cero. NO se cierran
    // —nadie las escribe sin querer, y evaluar expresiones convertiría esto en
    // medio intérprete—, pero se MIDEN: si algún día este aserto se pone rojo
    // es que alguien cerró el agujero, y entonces hay que quitar el párrafo
    // «QUÉ NO SUJETA» de arriba y `_lo_que_esto_NO_sujeta` del padrón. Un
    // límite documentado y no medido vuelve a ser prosa que envejece sola.
    const texto = [
      'const a = window.__nefan["probe" + "Collide"](x, z);',
      'const b = await ctx.nefan(`probe${""}Collide`, x, z);',
      'const c = window.__nefan[["probe", "Collide"].join("")](x, z);',
    ].join("\n");
    assert.equal(
      apariciones(texto, SONDA),
      0,
      "el detector ha aprendido a ver el nombre partido: quita el párrafo «QUÉ NO SUJETA» y la clave " +
        "`_lo_que_esto_NO_sujeta` del padrón, porque han dejado de ser ciertos",
    );
  });

  it("el barrido de fuentes ve los subdirectorios y se salta lo efímero", () => {
    // `qa/guiones/` cuelga de `qa/`, y las corridas dejan `.tmp/<run>/`: un
    // barrido plano perdería los guiones y uno sin filtro mediría basura.
    const f = fuentesDelBanco(QA);
    assert.ok(
      f.some((x) => x.startsWith("guiones/")) && f.some((x) => !x.includes("/")),
      `el barrido tiene que ver los guiones y la raíz de qa/: ${f.length} ficheros`,
    );
    assert.deepEqual(
      f.filter((x) => x.startsWith(".") || x.includes("node_modules") || x.startsWith("capturas/")),
      [],
    );
  });
});
