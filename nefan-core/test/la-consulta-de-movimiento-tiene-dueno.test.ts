/** Totalidad de las consultas de MOVIMIENTO del banco (#662, tanda P,
 *  2026-09-18; #686, tanda X): toda consulta de `probeCollide` en `qa/` está
 *  declarada con su motivo, o el test se pone rojo.
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
 *   · `const pc = window.__nefan.probeCollide` → `pc(...)` ×N — el ALIAS;
 *   · `ctx.nefan("probeCollide", x, z)` → `qa/lib/sonda.mjs` despacha por
 *     `hook[p](...)` — el STRING, que no ve ni el censo ni el 145.
 *
 *  Y la cuarta, `const { probeCollide } = window.__nefan`, nacería verde con
 *  cualquier detector por grafía. La clave no es enumerar formas: en la práctica
 *  no se llama a esa función sin escribir su nombre, porque el seam publica por
 *  nombre y `sonda.mjs` despacha por string. Los comentarios no son nodos del
 *  árbol, así que la prosa se excluye sola: no hace falta la heurística del
 *  acento grave que usaba el 145, y una expresión regular que NOMBRE la sonda
 *  (`qa/la-consulta-de-punto-no-tiene-origen.mjs` tiene una) no cuenta, porque
 *  un `RegularExpressionLiteral` tampoco la llama.
 *
 *  ## Por qué cuenta SITIOS DE USO y no nodos con el nombre (#686)
 *
 *  La primera versión contaba los NODOS cuyo texto es `probeCollide`. Con eso
 *  el alias es UN nodo aunque alimente N llamadas: QA añadió siete `pc(i, i)` al
 *  guion 119 y el padrón siguió verde con «1». Es la forma exacta del defecto
 *  que #662 vino a cerrar, y los tres ficheros legítimos que quedan (93, 119,
 *  133) son justo los que tienen alias — «copio el `pc` de la línea de arriba»
 *  era el gesto más probable y el único que no se veía.
 *
 *  Ahora se cuentan los sitios de uso, resueltos sintácticamente DENTRO del
 *  fichero y con el mismo `createSourceFile`, sin type-checker ni flujo:
 *  primero se recogen los alias por punto fijo —`const x = ….probeCollide`,
 *  `const x = …["probeCollide"]`, `const x = "probeCollide"` (el string que
 *  luego viaja a `ctx.nefan(x, …)`), `const x = <otro alias>`, el parámetro
 *  con valor por defecto `function f(x = ….probeCollide)`, y las
 *  desestructuraciones `{probeCollide}` / `{probeCollide: x}`— y después cuenta
 *  1 cada `Identifier`/`StringLiteralLike` con el texto exacto y cada
 *  `Identifier` que es un alias; la DECLARACIÓN del alias cuenta 0, porque
 *  declarar no consulta nada (un alias sin uso vale 0). Los nueve ficheros del
 *  padrón dieron la MISMA cifra con los dos detectores sin tocar un guion —cada
 *  alias vivo tiene exactamente un sitio de llamada—, y el experimento de QA
 *  sobre el 119 pasa de 1 a 8. Vive abajo como negativo permanente, anclado al
 *  fichero real.
 *
 *  ## QUÉ NO SUJETA, dicho aquí y no descubierto por el siguiente
 *
 *  «En la práctica» no es «nunca», y la versión anterior de este párrafo decía
 *  que **no hay forma** de llamarla sin escribir su nombre. Lo tumbó la QA de
 *  #662 con dos contraejemplos que pasan en VERDE:
 *  `window.__nefan["probe" + "Collide"](x, z)` y un template CON sustitución.
 *  No se cierran a propósito —nadie escribe eso sin querer, y evaluar
 *  expresiones convertiría el detector en medio intérprete—, pero se escriben.
 *
 *  Y los límites del detector de sitios de uso, cada uno con su `it` que MIDE
 *  la cifra (rojo si alguien lo cierra sin quitar el párrafo): el alias pasado
 *  como VALOR (`rumbos.map(pc)`, o `f(pc)` con `(q) => q(a, b)` dentro: un
 *  parámetro SIN inicializador no liga nada) cuenta 1 referencia y no las
 *  llamadas que `map` o `f` hagan por dentro —es el límite honesto de «sitio
 *  de uso»—; el CRUCE DE
 *  FICHERO (`export const S = "probeCollide"` en `qa/lib/` e `import {S}` en un
 *  guion) cuenta 0 en el guion, porque resolver imports es otro detector y hoy
 *  no tiene sujeto (`grep probeCollide qa/lib/` = 0 fuera del `hook[p]`); y el
 *  SOMBREADO (`const pc = () => 0` en otra función del mismo fichero)
 *  SOBRECUENTA, porque no hay ámbitos: dirección segura, es un rojo que alguien
 *  mira, nunca un verde que tapa.
 *
 *  Hay una SEGUNDA PUERTA a la misma `collidesAt` que no pasa por este nombre
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
 *  Que el banco sea `.mjs` y solo `.mjs` —y por tanto que barrer `qa/**\/*.mjs`
 *  sea barrer TODO lo ejecutable— lo canda ese mismo test (#686).
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
            /** Ruta relativa a la raíz del repo, como la escribe `git`. `.mjs`
             *  porque el banco es `.mjs` y solo `.mjs`, y eso tiene candado. */
            fichero: z.string().regex(/^qa\/[\w./-]+\.mjs$/, "una declaración nombra un `qa/**/*.mjs`"),
            /** SITIOS DE USO que alcanzan a la sonda, no nombres escritos
             *  (#686). EXACTA, no un tope: por eso también es rojo que sobren. */
            consultas: z.number().int().min(1),
            /** Obligatorio: una sonda de movimiento sin motivo es #644 esperando. */
            porque: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type Padron = z.infer<typeof PadronSchema>;

const esJSDoc = (n: ts.Node): boolean =>
  n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode;

/** Cuántos SITIOS DE USO alcanzan al identificador `nombre` en este fuente,
 *  resueltos sintácticamente dentro del fichero (#686).
 *
 *  (i) Se recogen los ALIAS por punto fijo: un `const x = <expr>` o un
 *  parámetro con valor por defecto `f(x = <expr>)` cuyo inicializador es
 *  `….nombre`, `[…"nombre"]`, el string `"nombre"` u OTRO alias; y los
 *  `BindingElement` `{nombre}` / `{nombre: x}`. (ii) Cuenta 1
 *  cada `Identifier`/`StringLiteralLike` con el texto EXACTO —la propiedad de
 *  `window.__nefan.x`, el `ctx.nefan("x", …)` que `qa/lib/sonda.mjs` despacha
 *  y su template sin sustitución— y cada `Identifier` que es un alias; cuenta 0
 *  la declaración entera del alias (nombre e inicializador) y su
 *  `BindingElement`, porque declarar no consulta nada. Sin ámbitos: un `pc`
 *  ajeno en otra función del mismo fichero SOBRECUENTA, a propósito.
 *
 *  NO cuenta comentarios ni JSDoc —en ficheros .js sí entran en el árbol; que
 *  no cuenten es parte del contrato de este detector—, ni un literal de
 *  expresión regular, ni un identificador que solo EMPIECE por ese nombre
 *  (`probeCollides` es otra cosa), ni una mención dentro de un string más
 *  largo, ni el nombre PARTIDO (`"probe" + "Collide"`). */
export function consultas(fuente: string, nombre: string): number {
  const sf = ts.createSourceFile("x.mjs", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const alias = new Set<string>();
  /** Los nodos que LIGAN un alias: se saltan enteros al contar. */
  const declaraciones = new Set<ts.Node>();
  const nombraLaSonda = (n: ts.Node): boolean =>
    (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && n.text === nombre;
  const ligaUnAlias = (init: ts.Expression): boolean =>
    (ts.isPropertyAccessExpression(init) && init.name.text === nombre) ||
    (ts.isElementAccessExpression(init) && nombraLaSonda(init.argumentExpression)) ||
    (ts.isStringLiteralLike(init) && init.text === nombre) ||
    (ts.isIdentifier(init) && alias.has(init.text));

  // (i) Punto fijo: un re-alias (`const q = pc`) solo se reconoce después de
  // que `pc` lo sea, y `pc` puede declararse más abajo en el fichero. Un
  // parámetro SIN inicializador (`(q) => q(a, b)`, con `f(pc)` en el llamador)
  // no liga nada aquí: es el alias pasado como valor, y se mide como límite.
  let cambio = true;
  while (cambio) {
    cambio = false;
    const busca = (n: ts.Node): void => {
      if (esJSDoc(n)) return;
      if (!declaraciones.has(n)) {
        // `const x = …` y `function f(x = …)` ligan igual: el valor por defecto de
        // un parámetro es un inicializador más (agujero que declaró el propio
        // ingeniero al cerrar la tanda X, cerrado antes de QA).
        if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name) && n.initializer && ligaUnAlias(n.initializer)) {
          alias.add(n.name.text);
          declaraciones.add(n);
          cambio = true;
        } else if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) {
          const propiedad = n.propertyName ?? n.name;
          if ((ts.isIdentifier(propiedad) || ts.isStringLiteral(propiedad)) && propiedad.text === nombre) {
            alias.add(n.name.text);
            declaraciones.add(n);
            cambio = true;
          }
        }
      }
      ts.forEachChild(n, busca);
    };
    busca(sf);
  }

  // (ii) Los sitios de uso.
  let n = 0;
  const cuenta = (nodo: ts.Node): void => {
    if (esJSDoc(nodo) || declaraciones.has(nodo)) return;
    if (nombraLaSonda(nodo) || (ts.isIdentifier(nodo) && alias.has(nodo.text))) n++;
    ts.forEachChild(nodo, cuenta);
  };
  cuenta(sf);
  return n;
}

/** Todos los `.mjs` del banco, en ruta relativa a la raíz del repo. Se salta
 *  `node_modules`, las capturas y los directorios efímeros de una corrida
 *  (`qa/.tmp/<run>/`), que no son fuente del banco. Que `.mjs` sea TODO lo
 *  ejecutable bajo `qa/` lo canda `qa-lib-tiene-quien-lo-mire.test.ts`. */
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
  fuentes.map((f) => [f, consultas(readFileSync(join(repoRoot, f), "utf8"), SONDA)] as const),
);
const censoDePunto = new Map(
  fuentes.map((f) => [f, consultas(readFileSync(join(repoRoot, f), "utf8"), SONDA_DE_PUNTO)] as const),
);

describe(`la consulta de movimiento tiene dueño (#662): ${SONDA} en qa/`, () => {
  it("el árbol tiene sujeto: hay fuentes del banco y el detector encuentra sondas", () => {
    // Sin esto, un detector que mirase el directorio equivocado aprobaría la
    // totalidad sobre cero ficheros: el peor de los verdes.
    assert.ok(fuentes.length > 50, `solo ${fuentes.length} fuentes .mjs bajo ${QA} — ¿se movió el banco?`);
    const total = [...censo.values()].reduce((a, b) => a + b, 0);
    assert.ok(total > 0, `el detector no ve ni una consulta de ${SONDA}: o se retiró la sonda del hook, o está roto`);
  });

  it("cada consulta de probeCollide está declarada, con su cuenta EXACTA de sitios de uso", () => {
    const mal = fuentes
      .map((f) => ({ f, hay: censo.get(f) ?? 0, dice: declaradas.get(f)?.consultas ?? 0 }))
      .filter((r) => r.hay !== r.dice);
    assert.deepEqual(
      mal.map((r) => `${r.f}: ${r.hay} en el árbol contra ${r.dice} declaradas`),
      [],
      `La consulta de MOVIMIENTO contesta «no» por donde el jugador ya está, así que describir el mundo con ` +
        `ella es #644 y preguntarla sobre el punto donde acabas de aparcar al jugador es un aserto que no ` +
        `puede ponerse rojo. O la sonda pasa a \`${SONDA_DE_PUNTO}\`, o entra en ` +
        `data/contract/sondas-de-movimiento.json con su cuenta de SITIOS DE USO (las llamadas que cuelgan ` +
        `de un alias cuentan cada una, la declaración del alias no) y su motivo. Si sobra alguna, alguien ` +
        `borró una sonda declarada: eso también es rojo, y a propósito.`,
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
    const regresados = migrados.filter((f) => (censo.get(f) ?? 0) > (declaradas.get(f)?.consultas ?? 0));
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

describe("el detector de sondas de movimiento cuenta SITIOS DE USO (#686)", () => {
  // Una forma por `it`, con su cifra. Lo que se afirma es la SEMÁNTICA del
  // detector, no que el código sea el que es: la directa cuenta 1, la
  // declaración de un alias 0, y cada uso de un alias 1.
  it("la directa, el string de sonda.mjs, el template sin sustitución y el acceso por índice: 1 cada uno", () => {
    assert.equal(consultas("const a = window.__nefan.probeCollide(x, z);", SONDA), 1);
    assert.equal(consultas('const c = await ctx.nefan("probeCollide", x, z);', SONDA), 1);
    assert.equal(consultas("const d = await ctx.nefan(`probeCollide`, x, z);", SONDA), 1);
    assert.equal(consultas('const e = window.__nefan["probeCollide"](x, z);', SONDA), 1);
  });

  it("un alias SIN uso vale 0: declarar no consulta nada", () => {
    assert.equal(consultas("const pc = window.__nefan.probeCollide;", SONDA), 0);
    assert.equal(consultas('const pc = window.__nefan["probeCollide"];', SONDA), 0);
    assert.equal(consultas("const { probeCollide } = window.__nefan;", SONDA), 0);
  });

  it("un alias con tres llamadas vale 3, que es lo que el detector anterior contaba como 1", () => {
    // El agujero de #686 en su forma mínima: el guion 81 escondía seis
    // llamadas detrás de un `pc`, y QA metió siete en el 119 sin que nada se
    // pusiera rojo.
    const texto = ["const pc = window.__nefan.probeCollide;", "const b = [pc(1, 2), pc(3, 4), pc(5, 6)];"].join("\n");
    assert.equal(consultas(texto, SONDA), 3);
  });

  it("la desestructuración cuenta sus usos, también renombrada", () => {
    // La «cuarta grafía», que nacería verde con un detector por texto.
    const directa = ["const { probeCollide } = window.__nefan;", "probeCollide(1, 2);", "probeCollide(3, 4);"].join("\n");
    assert.equal(consultas(directa, SONDA), 2);
    const renombrada = ["const { probeCollide: pc } = window.__nefan;", "pc(1, 2);", "pc(3, 4);"].join("\n");
    assert.equal(consultas(renombrada, SONDA), 2);
    const conString = ['const { "probeCollide": pc } = window.__nefan;', "pc(1, 2);"].join("\n");
    assert.equal(consultas(conString, SONDA), 1);
  });

  it("el re-alias se resuelve por punto fijo, aunque el alias se declare DESPUÉS", () => {
    // `const q = pc` es una rama más del mismo mecanismo (criterio 2 de #686):
    // sin punto fijo, `q` no sería alias porque `pc` aún no lo era al visitarlo.
    const texto = ["const q = pc;", "q(1, 2);", "q(3, 4);", "const pc = window.__nefan.probeCollide;"].join("\n");
    assert.equal(consultas(texto, SONDA), 2);
  });

  it("el parámetro con VALOR POR DEFECTO es un alias más: sus usos cuentan, la firma no", () => {
    // `function f(pc = window.__nefan.probeCollide)` liga igual que un `const`
    // y con el detector de nodos era 1 para N llamadas; con el punto fijo sin
    // `Parameter` seguía siéndolo (agujero declarado por el ingeniero al
    // cerrar la tanda X y cerrado aquí, antes de QA). Cuenta también en una
    // arrow y con un re-alias como valor por defecto.
    const funcion = ["function f(pc = window.__nefan.probeCollide) { return [pc(1, 2), pc(3, 4)]; }"].join("\n");
    assert.equal(consultas(funcion, SONDA), 2);
    const arrow = ["const g = (pc = window.__nefan.probeCollide) => pc(1, 2);"].join("\n");
    assert.equal(consultas(arrow, SONDA), 1);
    const sinUso = "function h(pc = window.__nefan.probeCollide) { return 0; }";
    assert.equal(consultas(sinUso, SONDA), 0, "la firma declara, no consulta");
    const reAlias = ["const pc = window.__nefan.probeCollide;", "function k(q = pc) { return q(1, 2); }"].join("\n");
    assert.equal(consultas(reAlias, SONDA), 1, "`q = pc` en la firma es un re-alias: la firma 0, la llamada 1");
  });

  it("el string guardado en una const cuenta cada vez que viaja a ctx.nefan", () => {
    // La otra rama barata: `sonda.mjs` despacha por `hook[p]`, así que
    // `ctx.nefan(S, …)` con `S = "probeCollide"` es una consulta por sitio.
    const texto = ['const S = "probeCollide";', "await ctx.nefan(S, 1, 2);", "await ctx.nefan(S, 3, 4);"].join("\n");
    assert.equal(consultas(texto, SONDA), 2);
  });

  it("NEGATIVO PERMANENTE, sobre el 119 REAL: los siete pc(i, i) de QA suben la cuenta de 1 a 8", () => {
    // El experimento con el que QA tumbó el detector anterior (#686), anclado
    // al fichero vivo y no a una fixture: si el 119 cambia de forma, el ancla
    // deja de aparecer exactamente una vez y esto lo dice en vez de medir otra
    // cosa.
    const fichero = fuentes.find((f) => /\/119-/.test(f));
    assert.ok(fichero, "el guion 119 ya no existe: ancla el negativo a otro fichero del padrón con alias");
    const original = readFileSync(join(repoRoot, fichero), "utf8");
    const ancla = "    const pc = window.__nefan.probeCollide;\n    const p = window.__nefan.state().pos;\n";
    assert.equal(original.split(ancla).length, 2, "el ancla del 119 (alias + pos) tiene que aparecer exactamente una vez");
    assert.equal(consultas(original, SONDA), 1, "el 119 tiene UNA consulta de movimiento: la de `caminoALaBolsa`");
    const inyeccion = Array.from({ length: 7 }, (_, i) => `    pc(${i}, ${i});\n`).join("");
    const saboteado = original.replace(ancla, ancla + inyeccion);
    assert.equal(consultas(saboteado, SONDA), 8, "siete llamadas más al alias tienen que verse como siete sitios más");
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
    assert.equal(consultas(texto, SONDA), 0);
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
    assert.equal(consultas(texto, SONDA), 0);
  });

  it("distingue la sonda de PUNTO de la de MOVIMIENTO en el mismo fichero, alias incluidos", () => {
    // El caso real de los migrados: `pc` pasó a significar `probePoint` en unos
    // ficheros y seguía siendo `probeCollide` en otros, y es lo que dejó al 81
    // atrás sin que se notara. Un alias de punto no suma a movimiento.
    const texto = [
      "const pc = window.__nefan.probePoint;",
      "const mov = window.__nefan.probeCollide;",
      "pc(1, 2); pc(3, 4);",
      "mov(5, 6);",
      'await ctx.nefan("probePoint", x, z);',
    ].join("\n");
    assert.equal(consultas(texto, SONDA), 1);
    assert.equal(consultas(texto, SONDA_DE_PUNTO), 3);
  });

  it("NO ve el nombre PARTIDO, y eso está escrito en el contrato en vez de descubrirse", () => {
    // El agujero que la QA de #662 encontró en una afirmación absoluta («no hay
    // forma de llamarla sin escribir su nombre»). Las tres formas de abajo
    // llegan a `collidesAt` y este detector las cuenta como cero. NO se cierran
    // —nadie las escribe sin querer, y evaluar expresiones convertiría esto en
    // medio intérprete—, pero se MIDEN: si algún día este aserto se pone rojo
    // es que alguien cerró el agujero, y entonces hay que quitar el punto (1)
    // de `_lo_que_esto_NO_sujeta` del padrón. Un límite documentado y no
    // medido vuelve a ser prosa que envejece sola.
    const texto = [
      'const a = window.__nefan["probe" + "Collide"](x, z);',
      'const b = await ctx.nefan(`probe${""}Collide`, x, z);',
      'const c = window.__nefan[["probe", "Collide"].join("")](x, z);',
    ].join("\n");
    assert.equal(
      consultas(texto, SONDA),
      0,
      "el detector ha aprendido a ver el nombre partido: quita el punto (1) de `_lo_que_esto_NO_sujeta` " +
        "del padrón, porque ha dejado de ser cierto",
    );
  });

  it("LÍMITE MEDIDO: el alias pasado como VALOR cuenta 1 referencia, no las llamadas de dentro de map", () => {
    // Es el límite honesto de «sitio de uso»: `rumbos.map(pc)` llama a la
    // sonda una vez por rumbo y el árbol solo ve una referencia. Punto (3) del
    // padrón; si esto pasa a contar más, hay que quitarlo de allí.
    const texto = ["const pc = window.__nefan.probeCollide;", "const libres = rumbos.map(pc);"].join("\n");
    assert.equal(consultas(texto, SONDA), 1, "el detector cuenta las llamadas de dentro de `map`: retira el punto (3)");
    // La misma forma con una función propia: `f(pc)` es la referencia que se
    // cuenta, y el parámetro `q` de `f`, SIN inicializador, no liga nada. Es
    // el caso que el coordinador pidió cerrar o declarar: se declara aquí y
    // en el punto (3) del padrón, con su cifra.
    const porParametro = [
      "const pc = window.__nefan.probeCollide;",
      "const f = (q) => [q(1, 2), q(3, 4), q(5, 6)];",
      "f(pc);",
    ].join("\n");
    assert.equal(consultas(porParametro, SONDA), 1, "el detector sigue el alias al parámetro de `f`: retira el punto (3)");
  });

  it("LÍMITE MEDIDO: el cruce de fichero cuenta 0 en el guion, porque no se resuelven imports", () => {
    // La indirección por `qa/lib/` del criterio 2 de #686: sin sujeto hoy
    // (`grep probeCollide qa/lib/` = 0 fuera del `hook[p]` de `sonda.mjs`), se
    // declara y se mide en vez de cerrarse. Punto (4) del padrón.
    const enLib = 'export const S = "probeCollide";';
    const enGuion = ['import { S } from "../lib/sondas.mjs";', "await ctx.nefan(S, 1, 2);", "await ctx.nefan(S, 3, 4);"].join("\n");
    assert.equal(consultas(enLib, SONDA), 0, "la declaración del string no es una consulta");
    assert.equal(consultas(enGuion, SONDA), 0, "el detector resuelve imports: retira el punto (4) del padrón");
  });

  it("LÍMITE MEDIDO: el sombreado SOBRECUENTA, que es la dirección segura", () => {
    // Un `pc` ajeno en otra función del mismo fichero: sin ámbitos, sus dos
    // apariciones (la declaración y la llamada) suman a la del alias real.
    // Tres en vez de uno: un rojo que alguien mira, nunca un verde que tapa.
    // Punto (5) del padrón.
    const texto = [
      "function a() { const pc = window.__nefan.probeCollide; return pc(1, 2); }",
      "function b() { const pc = () => 0; return pc(3, 4); }",
    ].join("\n");
    assert.equal(consultas(texto, SONDA), 3, "el detector distingue ámbitos: retira el punto (5) del padrón");
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
