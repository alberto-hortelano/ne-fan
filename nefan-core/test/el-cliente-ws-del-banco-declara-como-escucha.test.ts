/** Totalidad de los clientes WebSocket PROPIOS del banco (#678, tanda AF,
 *  2026-09-18): cada `new WebSocket(…)` bajo `qa/**` está declarado en
 *  `data/contract/clientes-ws-del-banco.json` con CÓMO ESCUCHA, o esto se pone
 *  rojo.
 *
 *  ## Qué sujeta
 *
 *  El bridge rechaza un frame que no pasa el contrato por UNICAST, al socket
 *  que lo mandó (`bridge/ws-server.ts`), y `escribir` calla si ese socket ya no
 *  está abierto. Un cliente del banco que abre, manda y cierra en el mismo tick
 *  no pierde el COLOR de su guion —el 63 declaraba ⊘ y el 60 salía ✘ igual—,
 *  pierde la CAUSA: «el tile no llegó» en vez de «el bridge rechazó el frame».
 *  Y la copia sin nombre del 60 es exactamente lo que un censo por grafía no
 *  ve (el issue la perdió; la crítica la encontró). Así que el censo es por
 *  ÁRBOL, sobre TODO `qa/**` (los `.mjs`), y la declaración es POR SOCKET:
 *
 *   · un socket = un `NewExpression` cuyo constructor se llama `WebSocket`
 *     (`Identifier` o `PropertyAccessExpression`: `new WebSocket(u)` y
 *     `new window.WebSocket(u)`);
 *   · sus oyentes = los que se cuelgan DE ESE SOCKET (por el nombre al que se
 *     liga) dentro de la función que lo envuelve: `ws.onmessage = <algo>` y
 *     `ws.addEventListener`/`on`/`once("message", <algo>)`, con `<algo>` que
 *     PUEDA escuchar —una flecha, una función o un nombre—. Las dos mitades de
 *     esa frase costaron una vuelta de QA cada una, y ninguna la vio su
 *     ingeniero. ATARLO AL SOCKET: mientras contaba el IDENTIFICADOR
 *     `onmessage` del ámbito, un `ws.onmessage = null` delante de la forma
 *     vieja saltaba el candado ENTERO y pasaba 16/16. Y QUE PUEDA ESCUCHAR,
 *     dicho en POSITIVO: al tapar `null` y `undefined` seguían pasando `= 0`,
 *     `= ''` y `ws.onmessage = ws.onmessage`, porque lo que se medía era «hay
 *     una asignación» y no «se cuelga algo que escucha». Tapar literales de uno
 *     en uno es la forma lenta de no cerrar nunca la familia;
 *   · su modo declarado = `todo` | `nada`, y la coherencia se MIDE: `nada` ⇔
 *     cero oyentes. Declarar «escucha» sobre un socket mudo es rojo, y declarar
 *     `nada` sobre uno que escucha también;
 *   · y ningún GUION abre su propio socket (#694): la espera «mando un frame y
 *     espero SU respuesta» tiene dueño en `qa/lib/cable.mjs`
 *     (`preguntarPorElCable`), que trata el rechazo del intake como desenlace.
 *     Hubo un tercer modo, `una-respuesta`, con quince ocupantes que tiraban
 *     ese rechazo por tipo y se colgaban mudos hasta el presupuesto; se retiró
 *     del zod, así que declararlo es rojo en vez de una foto a cero.
 *
 *  `nada` nace con CERO ocupantes. Existe para que un «dispara y olvida» futuro
 *  tenga que escribirse con su motivo, no para bendecir ninguno de hoy: los dos
 *  que había (60 y 63) esperaban 60 s la consecuencia de su frame por otro
 *  canal, así que «no me importa el resultado» habría sido una declaración
 *  falsa; pasan por `qa/lib/cable.mjs` y nombran el rechazo.
 *
 *  ## Qué NO sujeta, dicho aquí y medido abajo
 *
 *  Está en `_lo_que_esto_NO_sujeta` del padrón y cada agujero tiene su aserto
 *  en «el detector»: el constructor RENOMBRADO (alias, `Reflect.construct`,
 *  `import { WebSocket as WS }`) y el código dentro de un string salen cero;
 *  lo que hace el oyente de un `todo` con el rechazo no se mide; un oyente
 *  colgado a un socket que se cierra en el mismo tick cuenta como oyente; un
 *  cliente correcto cuyo oyente cuelga OTRA función sale rojo (y el mensaje lo
 *  dice así, en vez de afirmar que no escucha); una espera que no espera vuelve
 *  a perder el unicast a través de `cable.mjs`; y los espías de
 *  `window.WebSocket` y los `routeWebSocket` de Playwright no son clientes y no
 *  entran, a propósito.
 *
 *  Mismo patrón de totalidad que `sondas-de-movimiento.json` (el molde: cuenta
 *  nodos, exacta en las dos direcciones, motivo con palabras distintas) y
 *  `banco-medido.json`. Lo compartido con el molde vive en
 *  `helpers-del-banco.ts`. Corre en `npm test`, o sea en CADA PR. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { SALTOS_DEL_BANCO, fuentesDelBanco } from "./banco-ficheros.js";
import { arbolDelBanco, recorre } from "./helpers-del-banco.js";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const QA = join(repoRoot, "qa");
const CONTRATO = join(core, "data", "contract", "clientes-ws-del-banco.json");

/** Los modos que se pueden declarar. `una-respuesta` ya no está (#694): no es
 *  que tenga cero ocupantes, es que declararlo no pasa el zod. */
const MODOS = ["todo", "nada"] as const;

const PadronSchema = z
  .object({
    _comment: z.string().min(1),
    /** Obligatorio y no decorado: un absoluto en la cabecera de un contrato es
     *  lo que hace que el siguiente no mire (lección del molde, QA de #662). */
    _lo_que_esto_NO_sujeta: z.string().min(1),
    clientes: z
      .array(
        z
          .object({
            /** Ruta relativa a la raíz del repo, como la escribe `git`. */
            fichero: z.string().regex(/^qa\/[\w./-]+\.mjs$/, "una declaración nombra un `qa/**/*.mjs`"),
            /** Uno por `new WebSocket`, EN ORDEN DE FUENTE. La longitud es la
             *  cuenta exacta: por eso también es rojo que sobren. */
            sockets: z
              .array(
                z
                  .object({
                    escucha: z.enum(MODOS),
                    /** Obligatorio: la decisión escrita por sitio (criterio 1 de #678). */
                    porque: z.string().min(1),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type Padron = z.infer<typeof PadronSchema>;

export interface SocketVisto {
  /** 1-based, para que el mensaje del rojo lleve a la línea. */
  linea: number;
  /** Oyentes de `message` colgados DE ESTE socket dentro de la función que lo
   *  envuelve. No «los del ámbito»: ver `esOyenteDe`. */
  oyentes: number;
  /** El identificador al que se liga el socket (`const ws = new WebSocket(…)`),
   *  o `null` si no se liga a un nombre simple. Sin nombre no se le pueden
   *  atribuir oyentes, y el rojo tiene que poder decirlo. */
  ligado: string | null;
}

/** Quita los paréntesis: `new (window.WebSocket)(u)` es el mismo constructor. */
function desenvuelve(n: ts.Node): ts.Node {
  return ts.isParenthesizedExpression(n) ? desenvuelve(n.expression) : n;
}

function esSocket(n: ts.Node): n is ts.NewExpression {
  if (!ts.isNewExpression(n)) return false;
  const e = desenvuelve(n.expression);
  if (ts.isIdentifier(e)) return e.text === "WebSocket";
  if (ts.isPropertyAccessExpression(e)) return e.name.text === "WebSocket";
  // `new window["WebSocket"](u)`: el acceso por índice con literal es la misma
  // cosa escrita de otra manera.
  if (ts.isElementAccessExpression(e)) {
    const a = e.argumentExpression;
    return Boolean(a && ts.isStringLiteralLike(a) && a.text === "WebSocket");
  }
  return false;
}

/** El nombre al que se liga el `new`, si es `const/let ws = new WebSocket(…)`. */
function nombreLigado(n: ts.NewExpression): string | null {
  const p = n.parent;
  return p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? p.name.text : null;
}

/** ¿Es `e` exactamente el identificador `nombre`? */
function esEse(e: ts.Node, nombre: string): boolean {
  const d = desenvuelve(e);
  return ts.isIdentifier(d) && d.text === nombre;
}

/** ¿Lo que se cuelga puede ESCUCHAR? Una flecha, una función o un nombre que
 *  las lleve. Nada más.
 *
 *  Se escribió dos veces, y la segunda es la buena. La primera solo descartaba
 *  `null` y `undefined` —el agujero con el que la QA saltó el candado entero,
 *  `ws.onmessage = null;` delante de la forma vieja— y la re-QA enseñó que eso
 *  no era medir «se cuelga algo que escucha» sino «hay una asignación»:
 *  `= 0`, `= ''` y `addEventListener("message", 0)` seguían pasando. Se mide en
 *  positivo, que es lo que cierra la familia entera en vez de ir tapando
 *  literales de uno en uno.
 *
 *  Un `X.onmessage` a la derecha NO entra, y con él se va `ws.onmessage =
 *  ws.onmessage`, que es la forma de parecer que se cuelga algo sin colgar
 *  nada. Si algún día hace falta `ws.onmessage = manejadores.mensaje`, se
 *  ensancha aquí y se mide, no se afloja. */
function puedeEscuchar(e: ts.Node): boolean {
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return true;
  return ts.isIdentifier(e) && e.text !== "undefined";
}

/** ¿Este nodo cuelga un oyente de `message` DEL socket `nombre`?
 *
 *  Atado al socket, no al ámbito: cuenta `nombre.onmessage = <algo>` y
 *  `nombre.addEventListener/on/once("message", <algo>)`, y solo si lo que se
 *  cuelga puede escuchar. Un `onmessage` de otro objeto —un `Worker`,
 *  un `process.on("message")`— ya no cuenta. */
function esOyenteDe(n: ts.Node, nombre: string): boolean {
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const izq = n.left;
    return (
      ts.isPropertyAccessExpression(izq) && izq.name.text === "onmessage" && esEse(izq.expression, nombre) && puedeEscuchar(n.right)
    );
  }
  if (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    ["addEventListener", "on", "once"].includes(n.expression.name.text) &&
    esEse(n.expression.expression, nombre)
  ) {
    const evento = n.arguments[0];
    const manejador = n.arguments[1];
    return Boolean(
      evento && ts.isStringLiteralLike(evento) && evento.text === "message" && manejador && puedeEscuchar(manejador),
    );
  }
  return false;
}

/** La función que envuelve al nodo, o el fichero entero si está suelto. */
function ambitoDe(n: ts.Node): ts.Node {
  let p: ts.Node = n.parent;
  while (p && !ts.isFunctionLike(p) && !ts.isSourceFile(p)) p = p.parent;
  return p;
}

/** Los sockets que ABRE este fuente, en orden, con sus oyentes. Cuenta NODOS:
 *  un `new WebSocket(` en un comentario o dentro de un string no es un socket,
 *  y un `"message"` suelto no es un oyente — solo lo es como primer argumento
 *  de `addEventListener`/`on`/`once` SOBRE ESE SOCKET, o su `onmessage`. */
export function socketsDe(fuente: string): SocketVisto[] {
  const sf = arbolDelBanco(fuente);
  const out: SocketVisto[] = [];
  recorre(sf, (n) => {
    if (!esSocket(n)) return;
    const ligado = nombreLigado(n);
    let oyentes = 0;
    if (ligado !== null) {
      recorre(ambitoDe(n), (m) => {
        if (esOyenteDe(m, ligado)) oyentes++;
      });
    }
    out.push({ linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, oyentes, ligado });
  });
  return out;
}

/** El zod se afirma en su PROPIO aserto y no al importar: si reventase aquí, un
 *  modo retirado declarado tumbaría el fichero entero y el guion 152 no podría
 *  exigir que se ponga rojo exactamente ese aserto y solo ése. Los demás
 *  asertos leen el JSON tal cual, que es lo que el árbol tiene que casar. */
const crudo: unknown = JSON.parse(readFileSync(CONTRATO, "utf8"));
const validado = PadronSchema.safeParse(crudo);
const padron = (validado.success ? validado.data : crudo) as Padron;
const declarados = new Map(padron.clientes.map((c) => [c.fichero, c]));
const fuentes = fuentesDelBanco(QA).map((f) => `qa/${f}`);
const censo = new Map(fuentes.map((f) => [f, socketsDe(readFileSync(join(repoRoot, f), "utf8"))] as const));
const conSocket = fuentes.filter((f) => (censo.get(f)?.length ?? 0) > 0);

/** Los sockets que abre un GUION, como `fichero:línea`. PURA sobre el censo, para
 *  poder probarla con uno inventado. Un guion no abre su propio socket (#694):
 *  «mando un frame y espero SU respuesta» es `preguntarPorElCable`, y
 *  «mando y espero otra consecuencia» es `porElCable`, los dos en
 *  `qa/lib/cable.mjs`. Sin este veto, el decimosexto nacería declarado `todo`
 *  con un oyente que tira el rechazo por tipo, y el padrón no lo distinguiría
 *  (agujero 2). */
export function socketsEnGuiones(c: ReadonlyMap<string, readonly SocketVisto[]>): string[] {
  return [...c].filter(([f]) => f.startsWith("qa/guiones/")).flatMap(([f, ss]) => ss.map((s) => `${f}:${s.linea}`));
}

describe("el cliente WS del banco declara cómo escucha (#678): new WebSocket en qa/", () => {
  it("el árbol tiene sujeto: hay fuentes del banco, sockets en ellas y un padrón que los nombra", () => {
    // Sin esto, un detector que mirase el directorio equivocado aprobaría la
    // totalidad sobre cero ficheros: el peor de los verdes.
    assert.ok(fuentes.length > 50, `solo ${fuentes.length} fuentes .mjs bajo ${QA} — ¿se movió el banco?`);
    const total = [...censo.values()].reduce((a, s) => a + s.length, 0);
    assert.ok(total > 0, "el detector no ve ni un `new WebSocket` en qa/: o el banco dejó de abrir sockets, o está roto");
    // El censo, impreso y no asumido: cuántos de cada modo hay HOY.
    const porModo = Object.fromEntries(MODOS.map((m) => [m, 0])) as Record<(typeof MODOS)[number], number>;
    for (const c of padron.clientes) for (const s of c.sockets) porModo[s.escucha]++;
    console.log(
      `    censo: ${total} socket(s) en ${conSocket.length} fichero(s) · declarados ${JSON.stringify(porModo)}`,
    );
  });

  it("el padrón pasa su zod: cada socket declara `todo` o `nada` con su motivo, y `una-respuesta` ya no existe", () => {
    assert.ok(
      validado.success,
      `data/contract/clientes-ws-del-banco.json no pasa su zod: ${validado.success ? "" : validado.error.message}\n` +
        `Si lo que falla es un \`escucha: "una-respuesta"\`: ese modo se retiró con #694 porque tiraba el rechazo ` +
        `del intake por tipo y colgaba el guion mudo; la espera de una respuesta es \`preguntarPorElCable\` de ` +
        `qa/lib/cable.mjs.`,
    );
  });

  it("ningún guion abre su propio socket: la espera de una respuesta pasa por `qa/lib/cable.mjs`", () => {
    assert.deepEqual(
      socketsEnGuiones(censo),
      [],
      "un `new WebSocket` en un guion es un cliente del bridge con su propia lectura del rechazo, que es lo que " +
        "#694 juntó en un sitio: usa `preguntarPorElCable` (mando y espero SU respuesta) o `porElCable` (mando y " +
        "espero otra consecuencia) de qa/lib/cable.mjs. Declararlo en el padrón no lo arregla.",
    );
  });

  it("cada socket del banco está declarado, con su cuenta EXACTA por fichero", () => {
    const mal = fuentes
      .map((f) => ({ f, hay: censo.get(f)?.length ?? 0, dice: declarados.get(f)?.sockets.length ?? 0, lineas: censo.get(f) ?? [] }))
      .filter((r) => r.hay !== r.dice);
    assert.deepEqual(
      mal.map((r) => `${r.f}: ${r.hay} en el árbol (líneas ${r.lineas.map((s) => s.linea).join(", ") || "—"}) contra ${r.dice} declarados`),
      [],
      `Un frame que no pasa el contrato del bridge vuelve por UNICAST al socket que lo mandó, y un cliente ` +
        `que no lo escucha pierde la causa de lo que le pasa después. Cada \`new WebSocket\` de qa/ entra en ` +
        `data/contract/clientes-ws-del-banco.json con su modo (\`todo\` | \`nada\`) y su ` +
        `motivo — o, mejor, pasa por \`qa/lib/cable.mjs\`. Si sobra alguno, alguien borró un socket declarado: ` +
        `eso también es rojo, y a propósito.`,
    );
  });

  it("la declaración es COHERENTE con el árbol: `nada` ⇔ cero oyentes, y `todo` ⇒ al menos uno", () => {
    const mal: string[] = [];
    for (const c of padron.clientes) {
      const vistos = censo.get(c.fichero) ?? [];
      c.sockets.forEach((s, i) => {
        const v = vistos[i];
        if (!v) return; // lo dice el aserto de la cuenta
        const mudo = v.oyentes === 0;
        if (s.escucha === "nada" && !mudo) mal.push(`${c.fichero}:${v.linea} declara \`nada\` y tiene ${v.oyentes} oyente(s)`);
        if (s.escucha !== "nada" && mudo) {
          // El porqué, y no solo el hecho: «no tiene oyente» sobre un socket
          // que sí lo tiene —colgado por un helper de al lado— es un mensaje
          // FALSO, y manda al siguiente a declarar `nada` (mentir) o a aflojar
          // el detector. Dicho así, manda a cerrar el oyente donde se abre.
          mal.push(
            v.ligado === null
              ? `${c.fichero}:${v.linea} declara \`${s.escucha}\` y el socket no se liga a ningún nombre (\`const ws = new WebSocket(…)\`), así que este detector no puede atribuirle oyentes`
              : `${c.fichero}:${v.linea} declara \`${s.escucha}\` y a \`${v.ligado}\` no se le cuelga ningún oyente de "message" EN SU MISMA FUNCIÓN (si lo cuelga un helper, tráelo aquí o pasa por \`qa/lib/cable.mjs\`)`,
          );
        }
      });
    }
    assert.deepEqual(
      mal,
      [],
      "declarar «escucha» sobre un socket mudo es la forma de este padrón de mentir, y al revés un socket que " +
        "escucha declarado `nada` esconde una espera sin presupuesto",
    );
  });

  it("ninguna declaración apunta a un fichero que ya no existe", () => {
    const muertas = padron.clientes.filter((c) => !existsSync(join(repoRoot, c.fichero)));
    assert.deepEqual(
      muertas.map((c) => c.fichero),
      [],
      "una declaración a un fichero borrado revive sola el día que alguien vuelva a crear esa ruta",
    );
  });

  it("un motivo no puede ser un encogimiento de hombros, ni el mismo copiado", () => {
    // Palabras DISTINTAS, no palabras (lección de la tanda E), y distinto del
    // de las demás entradas: copiar el de al lado es la otra forma barata.
    const vistos = new Map<string, string>();
    for (const c of padron.clientes) {
      c.sockets.forEach((s, i) => {
        const sitio = `${c.fichero}#${i + 1}`;
        const palabras = new Set(
          s.porque
            .toLowerCase()
            .split(/[^\p{L}\p{N}_.]+/u)
            .filter(Boolean),
        );
        assert.ok(
          palabras.size >= 12,
          `clientes-ws-del-banco.json[${sitio}]: "${s.porque}" tiene ${palabras.size} palabras distintas — ` +
            `di qué manda, qué espera y qué le pasa con un rechazo de intake`,
        );
        const previo = vistos.get(s.porque);
        assert.equal(previo, undefined, `${sitio} repite literalmente el motivo de ${previo}`);
        vistos.set(s.porque, sitio);
      });
    }
  });

  it("el complemento, DERIVADO: ningún socket del banco es hoy un dispara-y-olvida", () => {
    // Son DOS afirmaciones distintas, y conviene no confundirlas.
    //
    // La primera es la FOTO DE HOY con su número: `nada` no está prohibido —el
    // padrón lo ofrece— pero hay que FIRMARLO. El día que alguien declare un
    // dispara-y-olvida legítimo, sube aquí su nombre y esto vuelve a verde; no
    // se borra, porque lo que vale es que el número lo haya mirado alguien.
    const nadas = padron.clientes.flatMap((c) => c.sockets.filter((s) => s.escucha === "nada").map(() => c.fichero));
    assert.deepEqual(nadas, [], "hay un `nada` declarado: si es legítimo, sube aquí el número esperado con su motivo");
    // La segunda mira el ÁRBOL, y DESCUENTA los declarados `nada` para que su
    // mensaje sea verdad: si no lo hiciera, «o se declara `nada` con motivo»
    // sería una salida que no existe —declararlo dejaría el aserto rojo igual—
    // y el siguiente borraría el aserto en vez de declarar. Es el aviso de la
    // casa: lo que el candado DICE tiene que ser lo que comprueba.
    const mudos = conSocket.flatMap((f) =>
      (censo.get(f) ?? [])
        .map((s, i) => ({ s, modo: declarados.get(f)?.sockets[i]?.escucha }))
        .filter((v) => v.s.oyentes === 0 && v.modo !== "nada")
        .map((v) => `${f}:${v.s.linea}`),
    );
    assert.deepEqual(mudos, [], "un socket sin oyente en el árbol: o pasa por `qa/lib/cable.mjs`, o se declara `nada` con motivo");
  });
});

describe("el detector de clientes WS del banco", () => {
  it("ve el socket sin oyente (la forma vieja del 60 y el 63) como MUDO", () => {
    const texto = [
      "const ws = new WebSocket(url);",
      "ws.onerror = () => rej(new Error('x'));",
      "ws.onopen = () => { ws.send(JSON.stringify(m)); setTimeout(() => { ws.close(); res(true); }, 0); };",
    ].join("\n");
    assert.deepEqual(socketsDe(texto), [{ linea: 1, oyentes: 0, ligado: "ws" }]);
  });

  it("un `onmessage` puesto a `null` NO es un oyente: era la línea con la que se saltaba el candado", () => {
    // Lo encontró la QA de la tanda (S6): la forma vieja con `ws.onmessage =
    // null` delante, declarada `una-respuesta`, pasaba 16/16. El detector
    // contaba el IDENTIFICADOR `onmessage`, no lo que se le colgaba.
    assert.deepEqual(socketsDe("const ws = new WebSocket(u); ws.onmessage = null;").map((s) => s.oyentes), [0]);
    assert.deepEqual(socketsDe("const ws = new WebSocket(u); ws.onmessage = undefined;").map((s) => s.oyentes), [0]);
    assert.deepEqual(socketsDe('const ws = new WebSocket(u); ws.addEventListener("message", null);').map((s) => s.oyentes), [0]);
    // Y el control: con algo colgado sí cuenta.
    assert.deepEqual(socketsDe("const ws = new WebSocket(u); ws.onmessage = (ev) => f(ev);").map((s) => s.oyentes), [1]);
  });

  it("ni a un literal cualquiera: lo colgado tiene que PODER escuchar, no solo no ser `null`", () => {
    // Residuo de lo anterior, y lo cazó la re-QA (S6b–e): tapar `null` y
    // `undefined` era tapar dos literales, no medir. La regla se escribió en
    // POSITIVO —flecha, función o nombre— y con eso se va la familia entera.
    const mudos = [
      "const ws = new WebSocket(u); ws.onmessage = 0;",
      "const ws = new WebSocket(u); ws.onmessage = '';",
      "const ws = new WebSocket(u); ws.onmessage = false;",
      "const ws = new WebSocket(u); ws.onmessage = {};",
      'const ws = new WebSocket(u); ws.addEventListener("message", 0);',
      'const ws = new WebSocket(u); ws.addEventListener("message", "");',
      // Parece que cuelga algo y no cuelga nada: el mismo miembro.
      "const ws = new WebSocket(u); ws.onmessage = ws.onmessage;",
    ];
    for (const texto of mudos) {
      assert.deepEqual(socketsDe(texto).map((s) => s.oyentes), [0], `lo contó como oyente: ${texto}`);
    }
    // Los controles, que son las tres formas que sí escuchan (y las que usa el
    // banco: los veinte oyentes reales de hoy son flechas).
    const oyen = [
      "const ws = new WebSocket(u); ws.onmessage = (ev) => f(ev);",
      "const ws = new WebSocket(u); ws.onmessage = function (ev) { f(ev); };",
      "const ws = new WebSocket(u); ws.onmessage = manejador;",
      'const ws = new WebSocket(u); ws.addEventListener("message", manejador);',
      'const ws = new WebSocket(u); ws.addEventListener("message", function (ev) { f(ev); });',
    ];
    for (const texto of oyen) {
      assert.deepEqual(socketsDe(texto).map((s) => s.oyentes), [1], `no lo contó como oyente: ${texto}`);
    }
  });

  it("el oyente se ata AL SOCKET, no al ámbito: el `onmessage` de otro objeto no cuenta", () => {
    // Las tres formas que la QA midió como FALSO OYENTE (fixtures H, I y J).
    const worker = "function f() { const ws = new WebSocket(u); worker.onmessage = (e) => g(e); }";
    const proceso = 'function f() { const ws = new WebSocket(u); process.on("message", h); }';
    const otro = "function f() { const ws = new WebSocket(u); otro.onmessage = h; }";
    for (const texto of [worker, proceso, otro]) {
      assert.deepEqual(socketsDe(texto).map((s) => s.oyentes), [0], `contó un oyente ajeno en: ${texto}`);
    }
  });

  it("cuenta los TRES oyentes: `onmessage`, `addEventListener(\"message\")` y `on(\"message\")`", () => {
    const a = "function f() { const ws = new WebSocket(u); ws.onmessage = (ev) => rec.push(ev.data); }";
    const b = 'function g() { const ws = new WebSocket(u); ws.addEventListener("message", (ev) => rec.push(ev.data)); }';
    const c = 'function h() { const ws = new WebSocket(u); ws.on("message", (d) => rec.push(d)); }';
    assert.deepEqual(socketsDe(a).map((s) => s.oyentes), [1]);
    assert.deepEqual(socketsDe(b).map((s) => s.oyentes), [1]);
    assert.deepEqual(socketsDe(c).map((s) => s.oyentes), [1]);
  });

  it("un `\"message\"` suelto o en otro evento NO es un oyente", () => {
    const texto = [
      "function f() {",
      "  const ws = new WebSocket(u);",
      '  const etiqueta = "message";',
      '  ws.addEventListener("open", () => ws.send("message"));',
      '  ws.addEventListener("error", () => rej(new Error("message")));',
      "}",
    ].join("\n");
    assert.deepEqual(socketsDe(texto), [{ linea: 2, oyentes: 0, ligado: "ws" }]);
  });

  it("atribuye los oyentes AL SOCKET DE SU FUNCIÓN: dos sockets en funciones distintas no se prestan oyentes", () => {
    // El caso real de `sesion.mjs`: dos `new WebSocket` en dos funciones. Con
    // un detector por fichero, el oyente de una cubriría a la otra.
    const texto = [
      "async function a() { return page.evaluate(() => new Promise((res) => { const ws = new WebSocket(u); ws.onmessage = () => res(1); })); }",
      "async function b() { return page.evaluate(() => new Promise((res) => { const ws = new WebSocket(u); ws.onopen = () => res(2); })); }",
    ].join("\n");
    assert.deepEqual(socketsDe(texto).map((s) => s.oyentes), [1, 0]);
  });

  it("ve `new window.WebSocket(u)` igual que `new WebSocket(u)`", () => {
    assert.deepEqual(socketsDe("const ws = new window.WebSocket(u); ws.onmessage = f;").map((s) => s.oyentes), [1]);
  });

  it("NO cuenta la prosa: ni JSDoc, ni comentario, ni el string que lo nombra", () => {
    const texto = [
      "/** Abre `new WebSocket(url)` y cuelga `onmessage`. No lo hace. */",
      "// const ws = new WebSocket(url);",
      'const s = "new WebSocket(url)";',
      "const x = 1;",
    ].join("\n");
    assert.deepEqual(socketsDe(texto), []);
  });

  it("NO ve el espía del cliente ni el proxy de Playwright: no son clientes", () => {
    // Los diecisiete guiones que envuelven `window.WebSocket` y los seis
    // `routeWebSocket`. Observan o cortan el socket DEL JUEGO; el `new` que
    // abre ese socket lo escribe el cliente, no el banco.
    const texto = [
      "const Orig = window.WebSocket;",
      "window.WebSocket = class extends Orig { constructor(u) { super(u); window.__qaSockets.push(this); } };",
      "await ctx.page.routeWebSocket(gateway, (ws) => { ws.onMessage((m) => ws.send(m)); });",
    ].join("\n");
    assert.deepEqual(socketsDe(texto), []);
  });

  it("NO ve el constructor RENOMBRADO, y eso está escrito en el contrato en vez de descubrirse", () => {
    // Agujero (1) de `_lo_que_esto_NO_sujeta`, en su redacción ancha: lo que
    // no se ve no es «el alias», es CUALQUIER `new` cuyo constructor no se
    // llame `WebSocket` en el nodo. La QA añadió el import renombrado, que es
    // la forma natural de un cliente Node nuevo (`el-npc-cruza`,
    // `el-state-api`), y por eso es el que más probable es.
    const alias = "const W = WebSocket;\nconst ws = new W(u);\nws.onmessage = f;";
    const reflect = "const ws = Reflect.construct(WebSocket, [u]);";
    const importado = 'import { WebSocket as WS } from "ws";\nconst ws = new WS(u);\nws.onmessage = f;';
    for (const texto of [alias, reflect, importado]) {
      assert.deepEqual(
        socketsDe(texto),
        [],
        `el detector ha aprendido a ver esta forma: súbela a lo que SÍ ve y quítala del agujero (1)\n${texto}`,
      );
    }
  });

  it("NO ve el código dentro de un STRING que la página acaba evaluando", () => {
    // El test llama «prosa» a lo que no es nodo, y un `addScriptTag` con el
    // socket dentro de un literal abre un socket de verdad. Sigue siendo
    // agujero (1); está escrito para que nadie lo descubra de golpe.
    const texto = 'await page.addScriptTag({ content: "const ws = new WebSocket(u); ws.onmessage = f;" });';
    assert.deepEqual(socketsDe(texto), []);
  });

  it("dos sockets en la MISMA función ya NO comparten oyentes: cada uno cuenta los suyos", () => {
    // Era la segunda mitad del agujero (3) y la cerró el atar el oyente al
    // socket: `a` escucha y `b` es mudo, que es la verdad.
    const texto = "function f() { const a = new WebSocket(u); const b = new WebSocket(u); a.onmessage = g; }";
    assert.deepEqual(socketsDe(texto).map((s) => s.oyentes), [1, 0]);
  });

  it("ve el constructor entre paréntesis y por índice: `new (window.WebSocket)` y `new window[\"WebSocket\"]`", () => {
    // Dos de las formas que la QA listó bajo el agujero del alias (E y F). No
    // se declaran: se ven, que sale más barato que escribirlas en el contrato.
    assert.deepEqual(socketsDe("const ws = new (window.WebSocket)(u); ws.onmessage = f;").map((s) => s.oyentes), [1]);
    assert.deepEqual(socketsDe('const ws = new window["WebSocket"](u); ws.onmessage = f;').map((s) => s.oyentes), [1]);
  });

  it("un socket que no se liga a un nombre se ve, y se dice que no se le pueden atribuir oyentes", () => {
    // No es mudo «porque no escuche»: es que el detector no puede saberlo. El
    // rojo lo dice con esas palabras (ver el aserto de coherencia).
    assert.deepEqual(socketsDe("sockets.push(new WebSocket(u));"), [{ linea: 1, oyentes: 0, ligado: null }]);
  });

  it("el veto de guiones ve un socket en `qa/guiones/**` y solo ahí", () => {
    // Fixture y no temporal en el árbol: un `.mjs` suelto en `guiones/` lo
    // cogería como guion cualquier batería que arrancase a la vez (`run.mjs`).
    const visto = (linea: number): SocketVisto => ({ linea, oyentes: 1, ligado: "ws" });
    const censoInventado = new Map<string, SocketVisto[]>([
      ["qa/guiones/999-un-guion-con-su-socket.mjs", [visto(12), visto(40)]],
      ["qa/guiones/998-sin-socket.mjs", []],
      ["qa/lib/cable.mjs", [visto(70)]],
      ["qa/el-cliente-node.mjs", [visto(5)]],
      // Un nombre que EMPIEZA parecido y no es la carpeta.
      ["qa/guiones-viejos/x.mjs", [visto(1)]],
    ]);
    assert.deepEqual(socketsEnGuiones(censoInventado), [
      "qa/guiones/999-un-guion-con-su-socket.mjs:12",
      "qa/guiones/999-un-guion-con-su-socket.mjs:40",
    ]);
  });

  it("un oyente que TIRA el rechazo por tipo cuenta como oyente: el agujero (2), medido", () => {
    // La forma exacta de los quince `una-respuesta` de antes de #694. El árbol
    // ve que escucha; no ve que tire el `narrative_status/error`. Si algún día
    // lo ve, esto se pone rojo y hay que subirlo a lo que SÍ se mide.
    const texto = [
      "const ws = new WebSocket(u);",
      "ws.onmessage = (ev) => {",
      "  const m = JSON.parse(ev.data);",
      '  if (m.type !== "session_started") return;',
      "  res(m);",
      "};",
    ].join("\n");
    assert.deepEqual(socketsDe(texto).map((s) => s.oyentes), [1]);
  });

  it("el barrido de fuentes ve los subdirectorios y se salta lo efímero", () => {
    const f = fuentesDelBanco(QA);
    assert.ok(
      f.some((x) => x.startsWith("guiones/")) && f.some((x) => !x.includes("/")) && f.some((x) => x.startsWith("lib/")),
      `el barrido tiene que ver los guiones, qa/lib y la raíz de qa/: ${f.length} ficheros`,
    );
    // Lo que se salta lo dice `SALTOS_DEL_BANCO`, por nombre y a cualquier
    // profundidad; un directorio con punto que no esté ahí SÍ es banco (#704).
    assert.deepEqual(f.filter((x) => x.split("/").some((seg) => SALTOS_DEL_BANCO.has(seg))), []);
  });
});
