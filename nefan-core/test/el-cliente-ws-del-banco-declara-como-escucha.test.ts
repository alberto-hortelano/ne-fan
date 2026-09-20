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
 *   · sus oyentes = dentro de la función que lo envuelve, los `Identifier`
 *     `onmessage` y las llamadas `addEventListener`/`on`/`once` cuyo primer
 *     argumento es el literal `"message"`;
 *   · su modo declarado = `una-respuesta` | `todo` | `nada`, y la coherencia se
 *     MIDE: `nada` ⇔ cero oyentes. Declarar «espera» sobre un socket mudo es
 *     rojo, y declarar `nada` sobre uno que escucha también.
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
 *  en «el detector»: el constructor con alias (`const W = WebSocket`) sale
 *  cero; `una-respuesta` contra `todo` no se distingue por el árbol; un oyente
 *  colgado a un socket que se cierra en el mismo tick cuenta como oyente; dos
 *  sockets en la MISMA función comparten cuenta; y los espías de
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
import { arbolDelBanco, fuentesDelBanco, recorre } from "./helpers-del-banco.js";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const QA = join(repoRoot, "qa");
const CONTRATO = join(core, "data", "contract", "clientes-ws-del-banco.json");

const MODOS = ["una-respuesta", "todo", "nada"] as const;

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
  /** Oyentes de `message` dentro de la función que envuelve al `new`. */
  oyentes: number;
}

function esSocket(n: ts.Node): n is ts.NewExpression {
  if (!ts.isNewExpression(n)) return false;
  const e = n.expression;
  return (ts.isIdentifier(e) && e.text === "WebSocket") || (ts.isPropertyAccessExpression(e) && e.name.text === "WebSocket");
}

function esOyente(n: ts.Node): boolean {
  if (ts.isIdentifier(n) && n.text === "onmessage") return true;
  if (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    ["addEventListener", "on", "once"].includes(n.expression.name.text)
  ) {
    const a = n.arguments[0];
    return Boolean(a && ts.isStringLiteralLike(a) && a.text === "message");
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
 *  de `addEventListener`/`on`/`once`, o el identificador `onmessage`. */
export function socketsDe(fuente: string): SocketVisto[] {
  const sf = arbolDelBanco(fuente);
  const out: SocketVisto[] = [];
  recorre(sf, (n) => {
    if (!esSocket(n)) return;
    let oyentes = 0;
    recorre(ambitoDe(n), (m) => {
      if (esOyente(m)) oyentes++;
    });
    out.push({ linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, oyentes });
  });
  return out;
}

const padron: Padron = PadronSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const declarados = new Map(padron.clientes.map((c) => [c.fichero, c]));
const fuentes = fuentesDelBanco(QA).map((f) => `qa/${f}`);
const censo = new Map(fuentes.map((f) => [f, socketsDe(readFileSync(join(repoRoot, f), "utf8"))] as const));
const conSocket = fuentes.filter((f) => (censo.get(f)?.length ?? 0) > 0);

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

  it("cada socket del banco está declarado, con su cuenta EXACTA por fichero", () => {
    const mal = fuentes
      .map((f) => ({ f, hay: censo.get(f)?.length ?? 0, dice: declarados.get(f)?.sockets.length ?? 0, lineas: censo.get(f) ?? [] }))
      .filter((r) => r.hay !== r.dice);
    assert.deepEqual(
      mal.map((r) => `${r.f}: ${r.hay} en el árbol (líneas ${r.lineas.map((s) => s.linea).join(", ") || "—"}) contra ${r.dice} declarados`),
      [],
      `Un frame que no pasa el contrato del bridge vuelve por UNICAST al socket que lo mandó, y un cliente ` +
        `que no lo escucha pierde la causa de lo que le pasa después. Cada \`new WebSocket\` de qa/ entra en ` +
        `data/contract/clientes-ws-del-banco.json con su modo (\`una-respuesta\` | \`todo\` | \`nada\`) y su ` +
        `motivo — o, mejor, pasa por \`qa/lib/cable.mjs\`. Si sobra alguno, alguien borró un socket declarado: ` +
        `eso también es rojo, y a propósito.`,
    );
  });

  it("la declaración es COHERENTE con el árbol: `nada` ⇔ cero oyentes, y los otros dos ⇒ al menos uno", () => {
    const mal: string[] = [];
    for (const c of padron.clientes) {
      const vistos = censo.get(c.fichero) ?? [];
      c.sockets.forEach((s, i) => {
        const v = vistos[i];
        if (!v) return; // lo dice el aserto de la cuenta
        const mudo = v.oyentes === 0;
        if (s.escucha === "nada" && !mudo) mal.push(`${c.fichero}:${v.linea} declara \`nada\` y tiene ${v.oyentes} oyente(s)`);
        if (s.escucha !== "nada" && mudo) mal.push(`${c.fichero}:${v.linea} declara \`${s.escucha}\` y no tiene ningún oyente de "message"`);
      });
    }
    assert.deepEqual(
      mal,
      [],
      "declarar «espera» sobre un socket mudo es la forma de este padrón de mentir, y al revés un socket que " +
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
    assert.deepEqual(socketsDe(texto), [{ linea: 1, oyentes: 0 }]);
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
    assert.deepEqual(socketsDe(texto), [{ linea: 2, oyentes: 0 }]);
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

  it("NO ve el constructor con alias, y eso está escrito en el contrato en vez de descubrirse", () => {
    // Agujero (1) de `_lo_que_esto_NO_sujeta`. Si algún día esto se pone rojo
    // es que alguien lo cerró: entonces se quita el párrafo del padrón y de la
    // cabecera, porque habrán dejado de ser ciertos.
    const texto = [
      "const W = WebSocket;",
      "const ws = new W(u);",
      "const ws2 = Reflect.construct(WebSocket, [u]);",
    ].join("\n");
    assert.deepEqual(
      socketsDe(texto),
      [],
      "el detector ha aprendido a ver el alias: quita el agujero (1) de `_lo_que_esto_NO_sujeta` y de la cabecera",
    );
  });

  it("dos sockets en la MISMA función comparten la cuenta de oyentes, y eso también está escrito", () => {
    // Agujero (3), segunda mitad. Hoy no pasa en el banco; si algún día pasa,
    // el padrón lo declara y este aserto es lo que dice que el detector no lo
    // separa.
    const texto = "function f() { const a = new WebSocket(u); const b = new WebSocket(u); a.onmessage = g; }";
    assert.deepEqual(
      socketsDe(texto).map((s) => s.oyentes),
      [1, 1],
      "el detector ha aprendido a separar sockets del mismo ámbito: quita esa parte del agujero (3)",
    );
  });

  it("el barrido de fuentes ve los subdirectorios y se salta lo efímero", () => {
    const f = fuentesDelBanco(QA);
    assert.ok(
      f.some((x) => x.startsWith("guiones/")) && f.some((x) => !x.includes("/")) && f.some((x) => x.startsWith("lib/")),
      `el barrido tiene que ver los guiones, qa/lib y la raíz de qa/: ${f.length} ficheros`,
    );
    assert.deepEqual(f.filter((x) => x.startsWith(".") || x.includes("node_modules") || x.startsWith("capturas/")), []);
  });
});
