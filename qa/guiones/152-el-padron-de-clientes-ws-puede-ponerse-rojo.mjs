/** ¿Se puede poner ROJO el padrón de clientes WS del banco? (#678, QA de la tanda AF)
 *
 *  POR QUÉ EXISTE. `data/contract/clientes-ws-del-banco.json` y su detector
 *  (`test/el-cliente-ws-del-banco-declara-como-escucha.test.ts`) nacieron el
 *  2026-09-18 prometiendo dos cosas: que cada `new WebSocket` de `qa/**` está
 *  declarado con cómo escucha (cuenta EXACTA en las dos direcciones), y que la
 *  coherencia «se MIDE» (`nada` ⇔ cero oyentes). El informe del ingeniero dice
 *  haber visto cinco sabotajes en rojo; esto lo vuelve a demostrar cada vez que
 *  alguien lo ejecute, sobre el ÁRBOL REAL y no sobre un texto fixture —que es
 *  lo que miden los asertos «el detector» del propio test—.
 *
 *  CÓMO. Por cada sabotaje escribe el padrón o un cliente temporal ROTOS a
 *  propósito, corre el detector en un subproceso y exige que se pongan rojos
 *  **EXACTAMENTE los asertos nombrados, y solo ésos**. Restaura siempre, y al
 *  terminar verifica byte a byte que el padrón volvió y que el cliente temporal
 *  no existe.
 *
 *  ── LOS AGUJEROS TAMBIÉN SE CANDAN (molde del 148) ─────────────────────────
 *
 *  La segunda tabla son los sabotajes que el padrón **NO caza y se sabe que no
 *  caza**, medidos en la QA de la tanda AF. Verde aquí = el agujero sigue; el
 *  día que alguien lo cierre esto se pone rojo con «ya no es un agujero» y pide
 *  subirlo a la tabla de arriba. Los tres de hoy:
 *
 *   · **el constructor RENOMBRADO** (`const W = WebSocket; new W(u)`, y su
 *     familia: `Reflect.construct`, `import { WebSocket as WS } from "ws"`):
 *     cero sockets. Está declarado como agujero (1) y medido con fixture en el
 *     test; aquí se mide sobre el árbol.
 *   · **`cable.mjs` con una espera que no espera**: `porElCable` obliga a pasar
 *     una espera y cierra él, así que ya no se puede cerrar antes de recoger
 *     —ésa era la forma que la QA midió (3 rechazos perdidos de 5) y que murió
 *     con `mandarPorElCable`/`cerrarElCable`—, pero quien le pase un
 *     `async () => {}` vuelve a perder el unicast, y el padrón no lo ve porque
 *     el `new WebSocket` es el de `cable.mjs`, declarado `todo`. Se ve en la
 *     propia llamada, que es lo que se ganó.
 *   · **el oyente en OTRA función** (`const ws = new WebSocket(u); oir(ws)`):
 *     un cliente CORRECTO sale ROJO, porque el detector ata el oyente al socket
 *     dentro de SU función. Es agujero en la dirección contraria: rojo sobre
 *     algo que sí escucha. Desde la QA el mensaje ya no MIENTE —dice «no se le
 *     cuelga ningún oyente EN SU MISMA FUNCIÓN» y manda a traerlo o a pasar por
 *     `cable.mjs`—, pero el rojo sigue estando. Se canda como «hoy sale rojo
 *     por coherencia».
 *
 *  Uno de los cuatro que nació con este guion se CERRÓ el mismo día: el oyente
 *  que no se ataba al socket (`ws.onmessage = null` pasaba por oyente, y con él
 *  se saltaba el candado entero). Está arriba, en los sabotajes.
 *
 *      node qa/run.mjs 152              # con el resto de la clase headless
 *      node qa/run.mjs --sin-navegador  # sin preset ni Chromium
 *
 *  AVISO: escribe en el árbol de trabajo (el padrón y un fichero temporal en
 *  `qa/lib/`). Se niega a arrancar si el padrón viene sucio, porque entonces no
 *  puede devolverlo. El temporal va en `qa/lib/` y no en `guiones/` para que
 *  una batería que arranque a la vez no lo tome por un guion.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

export const sinMotor = "sabotea el padrón de clientes WS y corre su detector en un subproceso; no abre partida ni habla con el motor";
export const sinNavegador = "rompe el padrón y un cliente temporal y mira si el detector se entera; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const PADRON = join(CORE, "data/contract/clientes-ws-del-banco.json");
const TEST = "test/el-cliente-ws-del-banco-declara-como-escucha.test.ts";
/** El cliente temporal. En `qa/lib/` (el detector barre todo `qa/**`) y con
 *  un nombre que ningún guion ni test busca. */
const TMP = join(RAIZ, "qa/lib/zz-sabotaje-qa-678-cliente-temporal.mjs");
const TMP_REL = relative(RAIZ, TMP).split("\\").join("/");

/** Los asertos del detector, por su nombre EXACTO: renombrado = «patrón
 *  obsoleto», no falso verde. */
const A_CUENTA = "cada socket del banco está declarado, con su cuenta EXACTA por fichero";
const A_COHERENCIA = "la declaración es COHERENTE con el árbol: `nada` ⇔ cero oyentes, y los otros dos ⇒ al menos uno";
const A_COMPLEMENTO = "el complemento, DERIVADO: ningún socket del banco es hoy un dispara-y-olvida";

/** La forma vieja del 60 y el 63: abre, manda y cierra en el mismo tick. */
const FORMA_VIEJA = (extra = "") =>
  [
    "export async function pedir(ctx) {",
    "  return ctx.page.evaluate(() => new Promise((res, rej) => {",
    '    const url = window.__nefan.servicios()["game-gateway"];',
    "    const ws = new WebSocket(url);",
    `    ${extra}`,
    "    ws.onerror = () => rej(new Error('x'));",
    '    ws.onopen = () => { ws.send(JSON.stringify({ type: "request_tile", tx: 1, ty: 0, reason: "prefetch" })); setTimeout(() => { ws.close(); res(true); }, 0); };',
    "  }));",
    "}",
    "",
  ].join("\n");

const MOTIVO = (que) =>
  `Sabotaje del guion 152: ${que}; el motivo tiene que pasar el suelo de doce palabras distintas del padrón para que el rojo sea el del aserto que se mide.`;

const declara = (padron, fichero, escucha, que) => {
  padron.clientes.push({ fichero, sockets: [{ escucha, porque: MOTIVO(que) }] });
};

/** [nombre, prepara(padron) → escribe TMP si toca, asertos que DEBEN ponerse rojos (y solo ésos)] */
const SABOTAJES = [
  [
    "un cliente nuevo con la forma vieja, SIN declarar",
    (p) => writeFileSync(TMP, FORMA_VIEJA()),
    [A_CUENTA, A_COMPLEMENTO],
  ],
  [
    "el mismo, declarado `una-respuesta` (declarar «espera» sobre un socket mudo)",
    (p) => {
      writeFileSync(TMP, FORMA_VIEJA());
      declara(p, TMP_REL, "una-respuesta", "un socket mudo declarado como si esperase una respuesta tipada");
    },
    [A_COHERENCIA, A_COMPLEMENTO],
  ],
  [
    "el mismo, declarado `nada` con motivo (hay que FIRMAR el complemento)",
    (p) => {
      writeFileSync(TMP, FORMA_VIEJA());
      declara(p, TMP_REL, "nada", "un dispara y olvida declarado sin haber subido la cifra del complemento");
    },
    [A_COMPLEMENTO],
  ],
  [
    "se borra la entrada de `qa/lib/cable.mjs`",
    (p) => {
      p.clientes = p.clientes.filter((c) => c.fichero !== "qa/lib/cable.mjs");
    },
    [A_CUENTA],
  ],
  [
    "se declara un socket DE MÁS en `qa/lib/saves.mjs`",
    (p) => {
      const c = p.clientes.find((x) => x.fichero === "qa/lib/saves.mjs");
      c.sockets.push({ escucha: "una-respuesta", porque: MOTIVO("una segunda declaración inventada para un socket que saves.mjs no abre") });
    },
    [A_CUENTA],
  ],
  [
    "la forma vieja + `ws.onmessage = null`, declarada `una-respuesta` (el oyente que no escucha)",
    (p) => {
      writeFileSync(TMP, FORMA_VIEJA("ws.onmessage = null;"));
      declara(p, TMP_REL, "una-respuesta", "la forma vieja con un onmessage puesto a null que no escucha nada y antes pasaba por oyente");
    },
    [A_COHERENCIA, A_COMPLEMENTO],
  ],
];

/** [nombre, prepara(padron), asertos rojos que se ESPERAN hoy ([] = pasa verde), quién SÍ lo caza] */
const AGUJEROS = [
  [
    "el constructor RENOMBRADO (`const W = WebSocket; new W(u)`) no es un socket para el padrón",
    () => writeFileSync(TMP, "export function abre(u) { const W = WebSocket; const ws = new W(u); ws.send('x'); ws.close(); }\n"),
    [],
    "nadie por árbol; declarado como agujero (1) de `_lo_que_esto_NO_sujeta` y medido con fixture en el test, junto a `Reflect.construct` y al import renombrado",
  ],
  [
    "`cable.mjs` con una espera que NO espera: el padrón no ve el mal uso, aunque ya se lee en la llamada",
    () =>
      writeFileSync(
        TMP,
        [
          'import { porElCable } from "./cable.mjs";',
          "export async function malUso(ctx) {",
          '  const { rechazos } = await porElCable(ctx, { type: "request_tile", tx: 1, ty: 0, reason: "prefetch" }, async () => {});',
          "  return rechazos;",
          "}",
          "",
        ].join("\n"),
      ),
    [],
    "nadie: el `new WebSocket` es el de `cable.mjs`, declarado `todo`; lo que SÍ murió es poder cerrar antes de recoger (ya no se exporta `cerrarElCable`)",
  ],
  [
    "un cliente CORRECTO con el oyente en OTRA función sale ROJO (el detector ata el oyente a la función del socket)",
    (p) => {
      writeFileSync(
        TMP,
        [
          "const oir = (ws, rec) => { ws.onmessage = (ev) => rec.push(ev.data); };",
          "export function pide(u) { const rec = []; const ws = new WebSocket(u); oir(ws, rec); ws.onopen = () => ws.send('x'); return rec; }",
          "",
        ].join("\n"),
      );
      declara(p, TMP_REL, "una-respuesta", "un cliente correcto cuyo oyente lo cuelga un helper de al lado y que el detector toma por mudo");
    },
    [A_COHERENCIA, A_COMPLEMENTO],
    "sale ROJO sobre un cliente que sí escucha; el mensaje ya no miente (dice «EN SU MISMA FUNCIÓN» y a dónde ir), pero el rojo sigue",
  ],
];

/** Corre el detector y devuelve los asertos ROJOS (sin duplicados: el
 *  reporter los imprime en su sitio y en el resumen). Solo las líneas
 *  INDENTADAS: un `describe` con un hijo rojo también sale con ✖, sin sangría,
 *  y no es un aserto. */
function corre() {
  const r = spawnSync("npx", ["tsx", "--test", TEST], { cwd: CORE, encoding: "utf8" });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const rojos = [...new Set([...salida.matchAll(/^ {2,}✖ (.+?) \(\d/gmu)].map((m) => m[1]))];
  const total = Number(/^ℹ tests (\d+)$/mu.exec(salida)?.[1] ?? -1);
  return { rojos, total, salida };
}

const mismoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export default async function (ctx) {
  const sucio = spawnSync("git", ["status", "--porcelain", "--", relative(RAIZ, PADRON), TMP_REL], { cwd: RAIZ, encoding: "utf8" });
  if ((sucio.stdout ?? "").trim()) {
    ctx.expect(
      "el padrón que este guion reescribe viene limpio y el temporal no existe",
      false,
      `hay cambios sin commitear:\n${sucio.stdout.trim()}\n  commitéalos o guárdalos: este guion restaura al contenido del disco de ANTES de arrancar`,
    );
    return;
  }

  turnoDeCandados("padron-clientes-ws");
  const original = readFileSync(PADRON, "utf8");
  const restaura = () => {
    writeFileSync(PADRON, original);
    if (existsSync(TMP)) unlinkSync(TMP);
  };
  for (const [señal, codigo] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.on(señal, () => {
      restaura();
      process.exit(codigo);
    });
  }

  const aplica = (prepara) => {
    const padron = JSON.parse(original);
    prepara(padron);
    writeFileSync(PADRON, `${JSON.stringify(padron, null, 2)}\n`);
  };

  try {
    const base = corre();
    ctx.log(`  · base (nada roto): ${base.total} asertos, ${base.rojos.length} rojo(s)`);
    ctx.expect(
      "el detector viene VERDE de partida",
      base.rojos.length === 0 && base.total > 0,
      base.rojos.length ? `ya está rojo: ${base.rojos.join(" | ")}` : `no se pudo leer el conteo (${base.total})`,
    );
    if (base.rojos.length !== 0 || base.total <= 0) return;

    const nombrados = [A_CUENTA, A_COHERENCIA, A_COMPLEMENTO];
    const ausentes = nombrados.filter((n) => !base.salida.includes(n));
    ctx.expect(
      `los ${nombrados.length} asertos que este guion nombra siguen llamándose así`,
      ausentes.length === 0,
      ausentes.length ? `renombrados o borrados: ${ausentes.join(" | ")} — actualiza este guion` : "",
    );
    if (ausentes.length !== 0) return;

    for (const [nombre, prepara, esperados] of SABOTAJES) {
      restaura();
      aplica(prepara);
      const { rojos } = corre();
      ctx.expect(
        `sabotaje · ${nombre}`,
        mismoConjunto(rojos, esperados),
        rojos.length === 0
          ? `ROMPERLO NO CAMBIA NADA: ningún aserto se entera (esperaba «${esperados.join(" | ")}»)`
          : `esperaba EXACTAMENTE «${esperados.join(" | ")}» y se pusieron rojos: ${rojos.join(" | ")}`,
      );
    }

    for (const [nombre, prepara, esperadosHoy, quienLoCaza] of AGUJEROS) {
      restaura();
      aplica(prepara);
      const { rojos } = corre();
      const sigue = mismoConjunto(rojos, esperadosHoy);
      ctx.expect(
        `agujero CONOCIDO, sigue abierto · ${nombre}`,
        sigue,
        esperadosHoy.length === 0
          ? `YA NO ES UN AGUJERO: ahora lo caza «${rojos.join(" | ")}» — súbelo a SABOTAJES y bórralo de aquí`
          : `cambió: esperaba hoy «${esperadosHoy.join(" | ")}» y salió «${rojos.join(" | ") || "verde"}» — si el detector ya ata el oyente al socket, súbelo`,
      );
      if (sigue) ctx.log(`      ↳ hoy ${quienLoCaza}`);
    }
  } finally {
    restaura();
  }

  ctx.expect(
    "el padrón vuelve byte a byte como estaba y el cliente temporal no existe",
    readFileSync(PADRON, "utf8") === original && !existsSync(TMP),
    `NO SE RESTAURÓ: revisa git diff ${relative(RAIZ, PADRON)} y ${TMP_REL}`,
  );
}
