/** LA ESPERA POR FOTOGRAMAS DEL BANCO TIENE UN SOLO DUEÑO (#606).
 *
 *  El invariante NO es «no leas `fps().frames`»: es que **el molde de esperar N
 *  fotogramas no vuelva a copiarse**. Estaba escrito a mano dieciséis veces, con
 *  dos nombres (`esperarFrames`, `frames`, `esperarUnosFrames`), cuatro
 *  redacciones y dos cortafuegos distintos (10 s y 20 s) que nadie eligió, y
 *  nueve de esas copias leían su línea base con `fps()?.frames ?? 0` — así que
 *  con el hook ausente un instante la espera se cumplía con la PRIMERA muestra.
 *  Nueve esperas que podían salir verdes sin haber esperado nada.
 *
 *  Este candado va en DOS niveles, y la razón de que sean dos está medida:
 *
 *  ── NIVEL DURO, sin exenciones ────────────────────────────────────────────
 *  Ningún fichero salvo `qa/lib/fotogramas.mjs` puede DEFINIR un helper de
 *  espera por fotogramas: una función cuyo trabajo entero sea leer el contador y
 *  esperar a que suba. Es el molde que se copiaba, y entra a CERO ocupantes.
 *
 *  Por qué el detector mira la FORMA y no el nombre: el censo con el que se
 *  abrió esta tanda buscaba `esperarFrames` y `frames` y decía **quince**. Eran
 *  **dieciséis**: el guion 34 tenía la misma función llamada
 *  `esperarUnosFrames`, con el mismo `?? 0` en la base. Un candado por nombre
 *  habría nacido verde con una copia delante.
 *
 *  ── NIVEL CENSO, con contrato ─────────────────────────────────────────────
 *  Toda espera cuyo PREDICADO lea un contador de fotogramas sale del helper o
 *  está en `data/contract/esperas-por-fotogramas.json` con su motivo. Existe
 *  porque el nivel duro, solo, deja escribible la copia INLINE — y eso es
 *  exactamente cómo se escribió la copia que el censo no vio. Las seis
 *  exenciones de hoy no son deuda: tres tienen el contador como SUJETO (afirmar
 *  que el renderer sigue pintando), una necesita un cortafuegos mayor que el
 *  unificado, una es una espera CONDUCIDA en segundos de mundo con otro dueño, y
 *  una está fuera de alcance con issue vivo (#659).
 *
 *  ── LO QUE NO CUBRE, dicho aquí y no en prosa suelta ──────────────────────
 *  Las LECTURAS de `fps().frames` que no son el predicado de una espera
 *  (`qa/fixtures-sin-bridge.mjs`, `qa/presupuesto-de-volumenes.mjs`,
 *  `qa/captura-de-fixture.mjs`, `qa/guiones/34`, `qa/guiones/79`): ahí el
 *  contador se lee y se afirma, no se espera por él. `fixtures-sin-bridge` es el
 *  caso claro — su sujeto ES ese contador—, y migrarlo borraría su medida.
 *
 *  Probado en negativo el 2026-09-17: restaurando a mano cada una de las CUATRO
 *  redacciones que había (las de los guiones 16, 44, 37 y 34) el nivel duro se
 *  pone rojo, y con una espera inline nueva sin apuntar se pone rojo el censo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRATO = join(repoRoot, "nefan-core", "data", "contract", "esperas-por-fotogramas.json");
/** El ÚNICO fichero al que le está permitido definir esta espera. */
const DUENO = "qa/lib/fotogramas.mjs";

const ContratoSchema = z.object({
  _comment: z.string(),
  exentos: z
    .array(
      z.object({
        fichero: z.string(),
        linea_orientativa: z.number(),
        desc: z.string(),
        porque: z.string().min(80),
      }),
    )
    .min(1),
});

/** Los verbos de espera del banco. Los tres, no solo `waitFor`: `holdUntil` y
 *  `expectEspera` también llevan predicado, y un candado que mirase uno solo
 *  dejaría los otros dos abiertos. */
const VERBOS = /(^|\.)(waitFor|expectEspera|holdUntil)$/;

/** Las funciones declaradas en el fichero, por nombre. Existe porque el
 *  predicado de una espera puede llegar POR REFERENCIA
 *  (`ctx.waitFor(desc, pasaronLosFotogramas, …)`) en vez de escrito en línea, y
 *  un detector que solo mirase el argumento no vería el contador — lo midió el
 *  propio dueño de esta espera, que es justo quien escribe su predicado aparte.
 *  Un candado que no ve esa forma cubre menos de lo que su nombre promete. */
function funcionesDelFichero(sf: ts.SourceFile): Map<string, ts.Node> {
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

/** ¿Lee este subárbol un CONTADOR DE FOTOGRAMAS? Son los tres que existen:
 *  `fps().frames` (el del renderer, que sube en toda vuelta del loop),
 *  `reloj().frames` (el del MUNDO, que solo sube cuando el sim avanza) y
 *  `reloj().loop`. Se mira el AST y no el texto: `window.__nefan.fps()?.frames`
 *  y `window.__nefan.fps().frames` son la misma lectura escrita de dos formas, y
 *  las dos estaban en el árbol. */
function contadorDeFotogramas(n: ts.Node, sf: ts.SourceFile): string | null {
  let hallado: string | null = null;
  const visita = (x: ts.Node): void => {
    if (hallado) return;
    if (ts.isPropertyAccessExpression(x) && (x.name.text === "frames" || x.name.text === "loop")) {
      let base: ts.Node = x.expression;
      if (ts.isNonNullExpression(base)) base = base.expression;
      if (/\b(fps|reloj)\(\)$/.test(base.getText(sf).trim())) hallado = `${base.getText(sf)}.${x.name.text}`;
    }
    ts.forEachChild(x, visita);
  };
  visita(n);
  return hallado;
}

export interface EsperaDeFotogramas {
  fichero: string;
  linea: number;
  verbo: string;
  desc: string;
  contador: string;
  /** El nombre de la función-helper que la envuelve, si la función existe SOLO
   *  para esperar fotogramas. `null` = espera inline dentro de otra cosa. */
  helper: string | null;
}

/** El nombre bajo el que se declara una función, sea `function f(){}`,
 *  `const f = () => {}` o `const f = async function(){}`. */
function nombreDeLaFuncion(fn: ts.Node, sf: ts.SourceFile): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  const padre = fn.parent;
  if (padre && ts.isVariableDeclaration(padre) && ts.isIdentifier(padre.name)) return padre.name.text;
  if (padre && ts.isPropertyAssignment(padre) && ts.isIdentifier(padre.name)) return padre.name.text;
  void sf;
  return null;
}

/** ¿Es `fn` un HELPER de espera por fotogramas, o sea una función cuyo trabajo
 *  ENTERO es esperar a que el contador suba?
 *
 *  El criterio es de forma y está medido contra las cuatro redacciones que
 *  había: la función recibe el número de fotogramas por PARÁMETRO y todas las
 *  llamadas de su cuerpo son la espera misma —leer la base (`page.evaluate`,
 *  `ctx.nefan`), el verbo de espera y lo que va dentro de su predicado—. Una
 *  función que además mide, mueve al jugador o afirma algo NO es el molde: es
 *  una espera inline, y de ésas se encarga el nivel censo. */
function esHelperDeEspera(fn: ts.SignatureDeclaration, sf: ts.SourceFile, espera: ts.CallExpression): boolean {
  if (fn.parameters.length === 0) return false;
  // Alguno de sus parámetros tiene que ser el número de fotogramas: sin él, la
  // función no es un molde reutilizable sino una espera concreta.
  const params = fn.parameters.map((p) => p.name.getText(sf));
  if (!params.some((p) => /^(n|frames|nFrames|cuantos)$/.test(p))) return false;
  const cuerpo = (fn as ts.FunctionLikeDeclaration).body;
  if (!cuerpo) return false;
  // Lo que SÍ forma parte de la espera: leer la base (`page.evaluate`,
  // `ctx.nefan`), el verbo, y la lectura del contador mismo (`fps()`, `reloj()`)
  // dondequiera que caiga. Las dos últimas hacen falta y está medido: sin ellas
  // el nivel duro dejaba pasar DOS de las cuatro redacciones —las del gemelo
  // `frames(ctx, n)` y `esperarUnosFrames(ctx, n)`, que leen su base con
  // `page.evaluate(() => window.__nefan.fps()?.frames ?? 0)`— porque el `fps()`
  // de dentro contaba como «trabajo ajeno». Nueve de las dieciséis copias eran
  // de esa forma: el candado habría nacido cazando siete.
  const OTRAS = /(^|\.)(evaluate|nefan|waitFor|expectEspera|holdUntil|fps|reloj)$/;
  let ajena = false;
  const visita = (x: ts.Node): void => {
    if (ajena) return;
    // Lo que va DENTRO del verbo de espera es su predicado: no cuenta.
    if (x === espera) return;
    if (ts.isCallExpression(x) && !OTRAS.test(x.expression.getText(sf))) ajena = true;
    ts.forEachChild(x, visita);
  };
  ts.forEachChild(cuerpo, visita);
  return !ajena;
}

/** Todas las esperas por fotogramas de un fichero del banco. */
export function esperasPorFotogramas(texto: string, fichero: string): EsperaDeFotogramas[] {
  const sf = ts.createSourceFile(fichero, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fuera: EsperaDeFotogramas[] = [];
  const funciones = funcionesDelFichero(sf);
  /** El contador que lee este argumento, siguiéndolo si es una REFERENCIA a una
   *  función del fichero. */
  const contadorDelArgumento = (a: ts.Node): string | null => {
    const directo = contadorDeFotogramas(a, sf);
    if (directo) return directo;
    if (ts.isIdentifier(a)) {
      const fn = funciones.get(a.text);
      if (fn) return contadorDeFotogramas(fn, sf);
    }
    return null;
  };
  /** La función que ENVUELVE a `n`, la más interior. */
  const envoltura = (n: ts.Node): ts.SignatureDeclaration | null => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)) {
        // Una arrow que sea el PREDICADO de la espera no envuelve nada: se sigue
        // subiendo hasta la función de verdad.
        if (ts.isArrowFunction(p) && p.parent && ts.isCallExpression(p.parent) && VERBOS.test(p.parent.expression.getText(sf))) {
          continue;
        }
        return p;
      }
    }
    return null;
  };
  const visita = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && VERBOS.test(n.expression.getText(sf))) {
      for (const a of n.arguments) {
        const contador = contadorDelArgumento(a);
        if (!contador) continue;
        const fn = envoltura(n);
        const helper = fn && esHelperDeEspera(fn, sf, n) ? nombreDeLaFuncion(fn, sf) : null;
        fuera.push({
          fichero,
          linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          verbo: n.expression.getText(sf),
          desc: n.arguments[0]?.getText(sf).slice(0, 90) ?? "",
          contador,
          helper,
        });
        break;
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return fuera;
}

/** TODO `qa/**.mjs`, la misma travesía que `esperas-que-conducen.test.ts`: un
 *  candado que mira media carpeta cubre media casa. */
const ficherosDelBanco = (dir = join(repoRoot, "qa")): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      return e.name === "node_modules" || e.name.startsWith(".") ? [] : ficherosDelBanco(join(dir, e.name));
    }
    return e.name.endsWith(".mjs") ? [join(dir, e.name).slice(repoRoot.length + 1)] : [];
  });

describe("la espera por fotogramas del banco tiene UN dueño (#606)", () => {
  const contrato = ContratoSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
  const encontradas = ficherosDelBanco().flatMap((f) =>
    esperasPorFotogramas(readFileSync(join(repoRoot, f), "utf8"), f),
  );

  it("NIVEL DURO · solo `qa/lib/fotogramas.mjs` DEFINE un helper de espera por fotogramas", () => {
    const copias = encontradas.filter((e) => e.helper !== null && e.fichero !== DUENO);
    assert.deepEqual(
      copias.map((e) => `${e.fichero}:${e.linea} · ${e.helper}(…) · ${e.contador}`),
      [],
      `Ese molde estaba copiado DIECISÉIS veces y las copias divergieron sin que nadie lo decidiera ` +
        `(dos cortafuegos, cuatro redacciones, y nueve con la línea base degradando a 0). El dueño es ` +
        `\`${DUENO}\`: importa \`esperaDeFotogramas\` y declara su reloj en una línea ` +
        `(\`const esperarFrames = esperaDeFotogramas("mundo" | "loop")\`). Este nivel NO tiene ` +
        `exenciones: si tu espera no cabe en el helper, lo que cambia es el helper.`,
    );
  });

  it("NIVEL CENSO · toda espera por fotogramas sale del dueño o está apuntada con su motivo", () => {
    const clave = (e: { fichero: string; desc: string }): string => e.fichero;
    const exentos = new Set(contrato.exentos.map(clave));
    const sinExcusa = encontradas.filter((e) => e.fichero !== DUENO && !exentos.has(clave(e)));
    assert.deepEqual(
      sinExcusa.map((e) => `${e.fichero}:${e.linea} · ${e.verbo}(${e.desc}) · ${e.contador}`),
      [],
      `Una espera por fotogramas escrita a mano es la forma en que este molde se copió dieciséis ` +
        `veces. Si de verdad no es el molde —porque el CONTADOR es su sujeto, porque necesita un ` +
        `cortafuegos mayor, o porque es una espera conducida en segundos de mundo—, apúntala en ` +
        `data/contract/esperas-por-fotogramas.json con su motivo escrito.`,
    );
  });

  it("y cada exención sigue teniendo sujeto vivo: la que sobra CADUCA y se borra", () => {
    // Una exención cuya espera ya no existe miente, y una exención que miente es
    // peor que no tenerla: nadie vuelve a mirarla.
    const conSujeto = new Set(encontradas.map((e) => e.fichero));
    const caducadas = contrato.exentos.map((e) => e.fichero).filter((f) => !conSujeto.has(f));
    assert.deepEqual(caducadas, [], "exención sin espera que eximir: bórrala del contrato");
  });

  it("el dueño existe, define la espera, y lee la base sin degradarla", () => {
    // Que el candado tenga SUJETO VIVO: si mañana alguien borra el helper, los
    // dos niveles de arriba saldrían VERDES sobre un banco sin dueño ninguno —
    // cero copias porque no queda nada que copiar. Se comprueba sobre la fuente
    // del dueño y NO con el detector, y la razón es la frontera de abajo.
    const fuente = readFileSync(join(repoRoot, DUENO), "utf8");
    assert.match(fuente, /export function esperaDeFotogramas\(reloj\)/);
    // El `?? 0` de la BASE es el defecto que traían nueve copias. Dentro del
    // sondeo, «todavía no hay hook» sí es volver a mirar, y eso se escribe
    // devolviendo `null`, nunca un cero.
    //
    // Se mira el CÓDIGO y no el fichero entero: el docblock del dueño cita el
    // defecto con su texto exacto para explicar por qué existe, y un candado
    // sobre el texto crudo se pone rojo por la explicación. Primera versión de
    // este aserto: roja, y por eso mismo.
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      codigo,
      /(fps|reloj)\(\)\??\.\w+\s*\?\?\s*0/,
      "la línea base no puede degradar a 0: con base 0 la espera se cumple con la primera muestra",
    );
  });

  it("LA FRONTERA DEL DETECTOR, medida: no ve el predicado que lee el contador por un campo DINÁMICO", () => {
    // Esto no es una excusa escrita a posteriori: es el resultado de correrlo
    // contra el árbol. El detector sigue el predicado aunque llegue por
    // referencia (`ctx.waitFor(desc, pasaronLosFotogramas, …)`), pero busca un
    // acceso `.frames`/`.loop` sobre `fps()` o `reloj()`, y el dueño lee
    // `lectura[a.campo]` tras dos alias — precisamente porque el campo es lo que
    // el guion elige. Resultado: el dueño NO sale en su propio censo.
    //
    // Qué significa y qué NO: una copia escrita como se escribieron las
    // dieciséis —campo literal— se caza, y eso está probado en negativo con las
    // CUATRO redacciones que existían. Una copia escrita con campo dinámico se
    // escaparía, y para eso está este aserto: para que el agujero esté MEDIDO y
    // con número, y no descubierto dentro de un año por un guion en verde.
    const suyas = encontradas.filter((e) => e.fichero === DUENO);
    assert.deepEqual(
      suyas.map((e) => `${e.fichero}:${e.linea}`),
      [],
      `Si el dueño EMPIEZA a salir en su propio censo, el detector ha cambiado de alcance: revisa ` +
        `que los dos niveles de arriba sigan excluyéndolo y borra esta frontera, que ya no sería cierta.`,
    );
  });
});
