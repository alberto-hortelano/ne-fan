/** QUÉ LEE EL PREDICADO DE UNA ESPERA DEL BANCO (#611).
 *
 *  Helper compartido por los dos censos de esperas de `qa/`
 *  (`esperas-que-conducen.test.ts` y `espera-de-fotogramas-con-dueno.test.ts`).
 *  Existe porque una exención de esos contratos AFIRMA algo sobre el sujeto de
 *  la espera («se espera al bridge», «el contador es el sujeto») y hasta esta
 *  tanda nada comprobaba esa afirmación contra el código: la forma del texto
 *  del `porque` estaba agotada (QA midió 7 pass · 0 fail con una mentira
 *  elaborada, N17b). Lo que sí es decidible es **qué claves del hook
 *  (`window.__nefan.X`) lee el predicado**: si la exención dice «bridge», el
 *  predicado tiene que leer `scene`; si dice «motor», `dialogue()`; si dice
 *  «game loop», `reloj()` o `fps()`. La regla es POSITIVA («toca algo del
 *  proceso nombrado»), nunca «no toca el mundo»: la `TRAZA` del guion 133 lee
 *  `state().pos` Y `reloj()` y es honesta.
 *
 *  No es `.test.ts`: es el módulo del que tiran dos tests, como `helpers.ts`.
 *  Sin él nacían la tercera y la cuarta copia de `funcionesDelFichero` y del
 *  recorrido por `PropertyAccessExpression`, que ya estaban una vez cada uno en
 *  el test del hermano (#606) — la dispersión que #686 nombra.
 *
 *  SE LEE EL ÁRBOL, NO EL TEXTO (#454): lo que va dentro de un string no es una
 *  lectura, y `window.__nefan.fps()?.frames` y `window.__nefan.fps().frames` son
 *  la misma lectura escrita de dos maneras. */
import ts from "typescript";

/** Las funciones declaradas en el fichero, por nombre. Existe porque el
 *  predicado de una espera puede llegar POR REFERENCIA
 *  (`ctx.waitFor(desc, pasaronLosFotogramas, …)`, la `TRAZA` del 133) en vez de
 *  escrito en línea, y un detector que solo mirase el argumento no vería lo que
 *  lee — lo midió el propio dueño de la espera por fotogramas, que es justo
 *  quien escribe su predicado aparte. Movida aquí desde
 *  `espera-de-fotogramas-con-dueno.test.ts`, no copiada. */
export function funcionesDelFichero(sf: ts.SourceFile): Map<string, ts.Node> {
  const mapa = new Map<string, ts.Node>();
  const visita = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) mapa.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) {
        mapa.set(n.name.text, n.initializer);
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return mapa;
}

/** Los tres verbos de espera del banco y DÓNDE lleva cada uno su descripción,
 *  su predicado y su presupuesto. `holdUntil(tecla, desc, fn, presupuesto, arg)`
 *  es el único que no empieza por la descripción: el censo del hermano leía
 *  `arguments[0]` para todos y apuntaba `"up"` como `desc` del guion 142 sin
 *  que nada lo viera, porque su clave era solo el fichero. */
const POSICIONES = {
  holdUntil: { desc: 1, predicado: 2, presupuesto: 3 },
  expectEspera: { desc: 0, predicado: 2, presupuesto: 3 },
  waitFor: { desc: 0, predicado: 1, presupuesto: 2 },
} as const;
export type VerboDeEspera = keyof typeof POSICIONES;

/** El verbo de una llamada, si es uno de los tres de espera (`ctx.waitFor(…)`,
 *  `ctx.absorbe(…, () => ctx.holdUntil(…))`); `null` si no. */
export function verboDe(call: ts.CallExpression): VerboDeEspera | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const v = call.expression.name.text;
  return v in POSICIONES ? (v as VerboDeEspera) : null;
}

/** El texto LITERAL de la descripción de la espera, con sus comillas o sus
 *  backticks. Es la clave con la que una exención apunta a UNA espera y no
 *  ciega el fichero entero. */
export function descDe(call: ts.CallExpression, verbo: VerboDeEspera, sf: ts.SourceFile): string {
  return call.arguments[POSICIONES[verbo].desc]?.getText(sf) ?? "";
}

/** El nodo del PREDICADO de la espera: el argumento en línea, o —si es un
 *  identificador— la función del fichero a la que apunta. `null` si no hay
 *  argumento o la referencia no se resuelve dentro del fichero. */
export function predicadoDe(
  call: ts.CallExpression,
  verbo: VerboDeEspera,
  funciones: ReadonlyMap<string, ts.Node>,
): ts.Node | null {
  const a = call.arguments[POSICIONES[verbo].predicado];
  if (a === undefined) return null;
  if (ts.isIdentifier(a)) return funciones.get(a.text) ?? null;
  return a;
}

/** Sin el `!` y sin los paréntesis: `(window.__nefan!)` es `window.__nefan`. */
const desnudo = (n: ts.Node): ts.Node => {
  let x = n;
  for (;;) {
    if (ts.isNonNullExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression;
    else return x;
  }
};

/** ¿Es este nodo el propio hook —`window.__nefan` o `__nefan` a secas—? */
const esElHook = (n: ts.Node): boolean => {
  const x = desnudo(n);
  if (ts.isIdentifier(x)) return x.text === "__nefan";
  return ts.isPropertyAccessExpression(x) && x.name.text === "__nefan";
};

/** Los nombres `X` que el subárbol lee del hook: `window.__nefan.X`,
 *  `window.__nefan.X()`, `window.__nefan?.X`, `__nefan.X` y
 *  `window.__nefan["X"]` con la clave literal. Sin repetidos, en orden de
 *  aparición. REGLA POSITIVA: no filtra nada —devuelve `state` y `playerPos`
 *  igual que `scene`—; quien decide qué lecturas valen para qué clase es el
 *  contrato.
 *
 *  Lo que NO ve, y está medido en los tests que lo usan: la lectura a través de
 *  un ALIAS (`const s = window.__nefan.scene` fuera del predicado y `s.scene_id`
 *  dentro; o `const n = window.__nefan; n.scene`), que es el mismo agujero de
 *  #686 en el padrón de sondas; y la clave COMPUTADA (`window.__nefan[k]`). */
export function lecturasDelHook(nodo: ts.Node): string[] {
  const vistas: string[] = [];
  const apunta = (nombre: string): void => {
    if (!vistas.includes(nombre)) vistas.push(nombre);
  };
  const visita = (x: ts.Node): void => {
    if (ts.isPropertyAccessExpression(x) && esElHook(x.expression)) apunta(x.name.text);
    if (ts.isElementAccessExpression(x) && esElHook(x.expression) && ts.isStringLiteralLike(x.argumentExpression)) {
      apunta(x.argumentExpression.text);
    }
    ts.forEachChild(x, visita);
  };
  visita(nodo);
  return vistas;
}

/** El presupuesto de la espera, leído del argumento que le toca al verbo:
 *  `pared` en milisegundos si es un literal numérico o un `{ms: N}` literal
 *  (`null` si falta o es una expresión: `maxMs`, `TOPE * 2`), y `conSim` si es
 *  un objeto con la clave `sim` (también en la forma abreviada `{ sim, arg }`
 *  del guion 06). */
export function presupuestoDe(call: ts.CallExpression, verbo: VerboDeEspera): { pared: number | null; conSim: boolean } {
  const p = call.arguments[POSICIONES[verbo].presupuesto];
  if (p === undefined) return { pared: null, conSim: false };
  const numero = (n: ts.Node): number | null => (ts.isNumericLiteral(n) ? Number(n.text.replace(/_/g, "")) : null);
  const literal = numero(p);
  if (literal !== null) return { pared: literal, conSim: false };
  if (!ts.isObjectLiteralExpression(p)) return { pared: null, conSim: false };
  let pared: number | null = null;
  let conSim = false;
  for (const pr of p.properties) {
    const clave = pr.name && ts.isIdentifier(pr.name) ? pr.name.text : null;
    if (clave === "sim") conSim = true;
    if (clave === "ms" && ts.isPropertyAssignment(pr)) pared = numero(pr.initializer);
  }
  return { pared, conSim };
}

/** Los nombres de las claves del hook, leídos de la FUENTE de
 *  `nefan-html/src/dev/nefan-hook.ts`: las del objeto `hook` y las del
 *  `Object.defineProperties(hook, Object.getOwnPropertyDescriptors({…}))` de
 *  DEV. Por el árbol —`PropertyAssignment`, `get x()`, método, abreviada—, no
 *  por regex: un mapa clase → lecturas que nombre una clave que el hook no
 *  tiene es un mapa que no puede derivar nada, y esto es lo que lo dice. */
export function nombresDelHook(fuenteHookTs: string): Set<string> {
  const sf = ts.createSourceFile("nefan-hook.ts", fuenteHookTs, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nombres = new Set<string>();
  const clavesDe = (o: ts.ObjectLiteralExpression): void => {
    for (const pr of o.properties) {
      const n = pr.name;
      if (n === undefined) continue;
      if (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) nombres.add(n.text);
    }
  };
  const visita = (x: ts.Node): void => {
    if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === "hook" && x.initializer) {
      if (ts.isObjectLiteralExpression(x.initializer)) clavesDe(x.initializer);
    }
    if (ts.isCallExpression(x) && x.expression.getText(sf) === "Object.defineProperties" && x.arguments[0]?.getText(sf) === "hook") {
      const descriptores = x.arguments[1];
      if (
        descriptores !== undefined &&
        ts.isCallExpression(descriptores) &&
        descriptores.expression.getText(sf) === "Object.getOwnPropertyDescriptors"
      ) {
        const o = descriptores.arguments[0];
        if (o !== undefined && ts.isObjectLiteralExpression(o)) clavesDe(o);
      }
    }
    ts.forEachChild(x, visita);
  };
  visita(sf);
  return nombres;
}
