/** EL CABLE ENTRE `pedirYEsperarTile` Y `qa/lib/tile-episodio.mjs` (QA de #677/#687).
 *
 *  La tanda V dejó las cuatro decisiones de la espera de un tile en el módulo
 *  puro —`MS_DEL_TILE`, `sondaDeTile`, `exigeLecturaDeTile`, `laExpiracionAborta`—
 *  y cada una tiene su test en `nefan-core/test/tile-episodio.test.ts`. Lo que
 *  NINGÚN test de core mira es si `pedirYEsperarTile` (`qa/lib/sesion.mjs`,
 *  exento del banco medido) las USA, y dónde: la lección de #639 y #659 es que
 *  la mitad medida no sujeta a la otra. Las cuatro se pueden descablear en
 *  verde, y solo se notaría en una corrida de navegador de 90 s con el bridge
 *  saboteado (H-4 medido por QA: 98 s), que no corre en ningún job:
 *   · H-5: si el preflight `exigeLecturaDeTile(...)` se mueve DETRÁS de
 *     `ctx.absorbe(...)` —o se borra—, un hook sin `tiles` vuelve a costar 90 s
 *     y a salir del veredicto; el test de core del validador sigue verde.
 *   · H-3: si la sonda del `ctx.waitFor` vuelve a ser una función inline, hay
 *     otra vez DOS precedencias; el test de equivalencia solo mira la exportada.
 *   · H-4: si el `if (laExpiracionAborta(v)) throw` desaparece, el 127 vuelve a
 *     pagar 7 × 90 s; el test de `laExpiracionAborta` sigue verde (es una
 *     función pura que nadie llama).
 *   · H-5 (b): un `hook.tiles ?? []` de vuelta en el helper degrada en silencio
 *     lo que el módulo fail-loudea.
 *  Lee el ÁRBOL de `sesion.mjs` (no el texto: «agotó MS_DEL_TILE» va dentro de
 *  un template) y afirma esas cuatro cosas más la procedencia: los tres nombres
 *  vienen IMPORTADOS de `./tile-episodio.mjs`, no de una copia local.
 *
 *  PROBADO EN NEGATIVO al nacer (2026-09-20), un sabotaje por vez sobre
 *  `sesion.mjs`: mover el preflight debajo del `absorbe` → rojo el aserto 2;
 *  sonda inline → rojo el 3; quitar el `if`/`throw` → rojo el 4; `hook.tiles ?? []`
 *  → rojo el 5. Cada uno solo el suyo.
 *
 *  LO QUE NO MIRA: que las funciones cableadas hagan lo correcto (eso es el test
 *  de core), ni que el `throw` llegue a abortar el guion en la corrida (eso lo
 *  decide `qa/run.mjs`, y lo midió QA en navegador), ni el orden dentro del
 *  `evaluate` de la marca de agua. Cero créditos: no abre el juego.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "solo lee el árbol de qa/lib/sesion.mjs; no arranca partida ni habla con el motor";
export const sinNavegador = "lee el árbol de qa/lib/sesion.mjs; no abre página";

const DIR = dirname(fileURLToPath(import.meta.url));
const CORE = join(DIR, "..", "..", "nefan-core");
const SESION = join(DIR, "..", "lib", "sesion.mjs");
const MODULO = "./tile-episodio.mjs";
const HELPER = "pedirYEsperarTile";

export default async function (ctx) {
  if (!existsSync(join(CORE, "node_modules", "typescript"))) {
    ctx.sinMedir("no encuentro `typescript` en nefan-core/node_modules y este guion lee el ÁRBOL de sesion.mjs. Corre `npm ci` en nefan-core.");
  }
  const ts = createRequire(join(CORE, "package.json"))("typescript");
  const src = ts.createSourceFile("sesion.mjs", readFileSync(SESION, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const linea = (n) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
  const recorrer = (n, f) => {
    f(n);
    n.forEachChild((h) => recorrer(h, f));
  };
  /** Nombre de la función llamada: `f(...)` → `f`, `ctx.f(...)` → `f`. */
  const callee = (n) =>
    ts.isCallExpression(n)
      ? ts.isIdentifier(n.expression)
        ? n.expression.text
        : ts.isPropertyAccessExpression(n.expression)
          ? n.expression.name.text
          : null
      : null;

  // 1 · Procedencia: los tres nombres vienen del módulo puro, no de una copia.
  const importados = new Set();
  recorrer(src, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === MODULO) {
      const named = n.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) for (const e of named.elements) importados.add(e.name.text);
    }
  });
  const faltan = ["sondaDeTile", "exigeLecturaDeTile", "laExpiracionAborta", "MS_DEL_TILE"].filter((x) => !importados.has(x));
  ctx.expect(
    `1. sesion.mjs IMPORTA de ${MODULO} la sonda, el validador, la decisión de aborto y el cortafuegos`,
    faltan.length === 0,
    faltan.length ? `faltan: ${faltan.join(", ")}` : `importa ${[...importados].join(", ")}`,
  );

  let helper = null;
  recorrer(src, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === HELPER) helper = n;
  });
  ctx.expect(`sesion.mjs declara \`${HELPER}\` (si no, este guion no mide nada)`, helper !== null);
  if (!helper) return;

  // Las llamadas del cuerpo, en orden de aparición (por posición en el fuente).
  const llamadas = [];
  recorrer(helper.body, (n) => {
    const c = callee(n);
    if (c) llamadas.push({ nombre: c, nodo: n, pos: n.getStart(src) });
  });
  const primera = (nombre) => llamadas.find((l) => l.nombre === nombre) ?? null;
  const preflight = primera("exigeLecturaDeTile");
  const absorbe = primera("absorbe");
  const expect = llamadas.find((l) => l.nombre === "expect" && ts.isPropertyAccessExpression(l.nodo.expression)) ?? null;

  // 2 · H-5: el preflight va ANTES de abrir la espera.
  ctx.expect(
    "2. H-5: `exigeLecturaDeTile(...)` se llama ANTES de `ctx.absorbe(...)`, o sea antes de abrir la espera de 90 s",
    preflight !== null && absorbe !== null && preflight.pos < absorbe.pos,
    `preflight en línea ${preflight ? linea(preflight.nodo) : "—"} · absorbe en línea ${absorbe ? linea(absorbe.nodo) : "—"}`,
  );

  // 3 · H-3: la sonda del waitFor es el identificador importado, no una inline.
  const waitFor = llamadas.find((l) => l.nombre === "waitFor" && absorbe && l.pos > absorbe.pos) ?? null;
  const sonda = waitFor?.nodo.arguments[1] ?? null;
  ctx.expect(
    "3. H-3: la sonda del `ctx.waitFor` de la espera es el identificador `sondaDeTile` (una sola precedencia, la del veredicto)",
    sonda !== null && ts.isIdentifier(sonda) && sonda.text === "sondaDeTile",
    sonda ? `sonda = ${sonda.getText(src).split("\n")[0].slice(0, 80)} (línea ${linea(sonda)})` : "no hay ctx.waitFor tras el absorbe",
  );

  // 4 · H-4: tras el ✘, un `if (laExpiracionAborta(…)) { throw … }`.
  let aborto = null;
  recorrer(helper.body, (n) => {
    if (aborto || !ts.isIfStatement(n) || callee(n.expression) !== "laExpiracionAborta") return;
    let lanza = false;
    recorrer(n.thenStatement, (h) => {
      if (ts.isThrowStatement(h)) lanza = true;
    });
    if (lanza) aborto = n;
  });
  ctx.expect(
    "4. H-4: existe `if (laExpiracionAborta(…))` que LANZA, y va DESPUÉS del `ctx.expect` que deja el ✘",
    aborto !== null && expect !== null && aborto.getStart(src) > expect.pos,
    `aborto en línea ${aborto ? linea(aborto) : "—"} · ctx.expect en línea ${expect ? linea(expect.nodo) : "—"}`,
  );

  // 5 · H-5 (b): ningún `<algo>.tiles ?? …` en todo sesion.mjs.
  const degradados = [];
  recorrer(src, (n) => {
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      ts.isPropertyAccessExpression(n.left) &&
      n.left.name.text === "tiles"
    ) {
      degradados.push(`línea ${linea(n)}: ${n.getText(src)}`);
    }
  });
  ctx.expect(
    "5. H-5: ningún `hook.tiles ?? …` en sesion.mjs — un hook sin `tiles` LANZA, no se disfraza de vacío",
    degradados.length === 0,
    degradados.join(" · ") || "ninguno",
  );
}
