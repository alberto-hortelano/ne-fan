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

/** Lo que el fichero declara bajo cada nombre, y qué nombres NO deciden una
 *  sola función. */
export interface FuncionesDelFichero {
  /** nombre → TODAS las funciones declaradas con ese nombre, en orden de
   *  fuente. Antes era una sola y **la última pisaba a las anteriores**, que es
   *  el agujero H-2 de la QA de #611: un `const pred` dentro de la función de
   *  arranque y otro `const pred` al final del fichero resolvían al de abajo, o
   *  sea que la derivación leía una función DISTINTA de la que corre. */
  porNombre: Map<string, ts.Node[]>;
  /** Cuántos VÍNCULOS tiene cada nombre en el fichero, sea cual sea su valor:
   *  declaraciones de función, `const`/`let` (con inicializador o sin él),
   *  PARÁMETROS y elementos de DESTRUCTURING. No es lo mismo que `porNombre`, y
   *  la diferencia es el agujero H-7 de la re-QA: `porNombre` solo apunta lo
   *  que TIENE VALOR FUNCIÓN LEGIBLE, así que un `const pred = () => scene`
   *  arriba y un `function espera(ctx, pred)` que recibe el de verdad por
   *  PARÁMETRO daban un solo candidato —«no ambigua»— y la derivación leía la
   *  función que no corre. Un parámetro no es una declaración de función, pero
   *  sí es un nombre que ya no decide una sola cosa. */
  vinculos: Map<string, number>;
  /** Los nombres que se REASIGNAN en algún punto (`pred = () => …`). Una
   *  reasignación no es una `VariableDeclaration` y no entraba en el mapa:
   *  `let pred = leeScene; pred = leeFrontier` derivaba por la PRIMERA. */
  reasignados: Set<string>;
}

/** Las funciones declaradas en el fichero, por nombre. Existe porque el
 *  predicado de una espera puede llegar POR REFERENCIA
 *  (`ctx.waitFor(desc, pasaronLosFotogramas, …)`, la `TRAZA` del 133) en vez de
 *  escrito en línea, y un detector que solo mirase el argumento no vería lo que
 *  lee — lo midió el propio dueño de la espera por fotogramas, que es justo
 *  quien escribe su predicado aparte. Movida aquí desde
 *  `espera-de-fotogramas-con-dueno.test.ts`, no copiada.
 *
 *  NO resuelve ÁMBITOS: junta todo el fichero en un mapa plano. Lo que hace en
 *  vez de fingir que los resuelve es CONTARLAS todas y decir cuáles se
 *  reasignan, para que quien consulte pueda negarse a adivinar. */
export function funcionesDelFichero(sf: ts.SourceFile): FuncionesDelFichero {
  const porNombre = new Map<string, ts.Node[]>();
  const vinculos = new Map<string, number>();
  const reasignados = new Set<string>();
  const apunta = (nombre: string, nodo: ts.Node): void => {
    const ya = porNombre.get(nombre);
    if (ya) ya.push(nodo);
    else porNombre.set(nombre, [nodo]);
  };
  const vincula = (nombre: string): void => {
    vinculos.set(nombre, (vinculos.get(nombre) ?? 0) + 1);
  };
  const visita = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) {
      apunta(n.name.text, n);
      vincula(n.name.text);
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      vincula(n.name.text);
      if (n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
        apunta(n.name.text, n.initializer);
      }
    }
    // Los DOS vínculos que no son declaraciones y por los que se colaba Q y R:
    // el parámetro de un helper y el elemento de un destructuring.
    if (ts.isParameter(n) && ts.isIdentifier(n.name)) vincula(n.name.text);
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) vincula(n.name.text);
    // `pred = …` (y `pred ??= …`, `pred ||= …`): el nombre deja de decidir una
    // función, mire donde mire este detector.
    if (ts.isBinaryExpression(n) && ts.isIdentifier(n.left)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.QuestionQuestionEqualsToken || op === ts.SyntaxKind.BarBarEqualsToken) {
        reasignados.add(n.left.text);
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return { porNombre, vinculos, reasignados };
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

/** Lo que se sabe del PREDICADO de una espera. */
export interface PredicadoDeEspera {
  /** Los nodos que hay que mirar: el argumento, si está escrito en línea; las
   *  funciones candidatas, si llega por referencia. Vacío si no hay argumento o
   *  la referencia no se declara en este fichero (un `import` de `qa/lib`). */
  nodos: ts.Node[];
  /** El nombre, si el predicado llega por referencia. */
  referencia: string | null;
  /** …y ese nombre NO decide una sola cosa: tiene más de un VÍNCULO en el
   *  fichero (declaración, `const`/`let`, PARÁMETRO o destructuring) o se
   *  reasigna. Resolver por nombre sería adivinar, así que quien consulte se
   *  niega a derivar nada (H-2, y H-7 para los vínculos que no son
   *  declaraciones). */
  ambigua: boolean;
}

/** El PREDICADO de la espera: el argumento en línea, o —si es un
 *  identificador— la(s) función(es) del fichero a las que apunta. */
export function predicadoDe(
  call: ts.CallExpression,
  verbo: VerboDeEspera,
  funciones: FuncionesDelFichero,
): PredicadoDeEspera {
  const a = call.arguments[POSICIONES[verbo].predicado];
  if (a === undefined) return { nodos: [], referencia: null, ambigua: false };
  if (!ts.isIdentifier(a)) return { nodos: [a], referencia: null, ambigua: false };
  const candidatos = funciones.porNombre.get(a.text) ?? [];
  return {
    nodos: candidatos,
    referencia: a.text,
    // Se cuenta por VÍNCULOS, no por candidatos legibles (H-7): un parámetro o
    // un destructuring con el mismo nombre no aporta candidato pero sí quita la
    // certeza de que el `const` de arriba sea el que corre.
    ambigua: (funciones.vinculos.get(a.text) ?? 0) > 1 || candidatos.length > 1 || funciones.reasignados.has(a.text),
  };
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
 *  Y ESCANEA EL SUBÁRBOL ENTERO del nodo que se le dé, sin mirar si la lectura
 *  decide algo: un `reloj()` en la primera mitad de un `&&` cuya segunda mitad
 *  es la que manda cuenta igual, y también cuentan un parámetro por defecto, el
 *  código tras un `return` y los argumentos de un envoltorio. Es la frase «mira
 *  QUÉ se lee, no qué decide», y su lista completa vive en
 *  `_lo_que_esto_NO_sujeta` de los dos contratos, con un caso medido cada una.
 *
 *  Lo que NO ve, y está medido en los tests que lo usan: la lectura a través de
 *  un ALIAS (`const s = window.__nefan.scene` fuera del predicado y `s.scene_id`
 *  dentro; o `const n = window.__nefan; n.scene`), que es el mismo agujero de
 *  #686 en el padrón de sondas; el DESTRUCTURING (`const { scene } = window.__nefan`);
 *  el hook alcanzado por corchetes (`window["__nefan"].scene`); y la clave
 *  COMPUTADA (`window.__nefan[k]`, `window.__nefan["sc"+"ene"]`). Las cuatro van
 *  en la dirección segura —dejan una honesta sin lecturas, o sea ROJA— y por eso
 *  son fricción y no agujero; pero se dicen, porque quien las sufra tiene que
 *  poder saber por qué. */
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
