/** Las TRECE exenciones del guardarraíl de gasto siguen siendo verdad (#295).
 *
 *  El guardarraíl invertido gatea por defecto y lo que se declara es la
 *  excepción: `export const sinMotor = "<motivo>"` para el guion que no le
 *  pide nada al motor. Eso deja el descuido del lado barato —olvidarse es un
 *  ⊘, no una factura—, pero abre un residuo que el propio ingeniero declaró
 *  (§7.6 de su informe): **las exenciones son una lista escrita, y las listas
 *  envejecen**. Un guion exento al que alguien le añada una partida deja de
 *  ser exento, y hoy eso solo lo caza el contador de rutas de pago del motor
 *  falso — que vive EN EL MOTOR FALSO, o sea que contra el backend que cobra
 *  no existe, y que además solo mira los guiones que esa corrida ejecuta.
 *
 *  Esto lo cierra por el otro lado, que es el que no depende de ningún
 *  backend: si un guion se declara `sinMotor`, no puede llevar dentro lo que
 *  HACE GENERAR al motor. Se mide leyendo los ficheros —TODOS los de
 *  `qa/guiones/`, no los de esta corrida—, así que sale rojo aunque nadie
 *  ejecute al mentiroso y aunque la batería corra contra un stack que no
 *  publica contadores.
 *
 *  Lo que se prohíbe a un guion exento, y por qué esas tres cosas:
 *   · `comenzar()`  — pulsa «Comenzar»: el bridge pide el tile de bootstrap al
 *     motor, que es la llamada cara del arranque.
 *   · `regenerarMundo()` — la pre-generación entera del mundo.
 *   · pulsar a mano los dos botones del título que arrancan la partida
 *     (un `click` de Playwright sobre `#ts-start` o `#ts-continue`) — el mismo
 *     acto sin el helper, que
 *     es como se esquivaría una regla que solo mirase los imports. Con una
 *     excepción declarada, y no por nombre: el guion que se trae SU PROPIO
 *     motor (`NEFAN_AI_SERVER` suyo + `?bridge=`) no puede gastar en el motor
 *     compartido — es el 20, que apunta a un puerto muerto a propósito.
 *  `nuevaPartida()` NO entra: abre el selector y elige mundo y estilo, y ahí
 *  todavía no se ha generado nada.
 *
 *  Y de paso, dos comprobaciones que el runner solo hace sobre lo que ejecuta:
 *  que el motivo de cada exención sea una FRASE (no un `true`, no una cadena
 *  vacía) y que no vuelva la marca directa `export const gasta`, retirada al
 *  invertir el guardarraíl — en pre-producción una vía vieja no convive con la
 *  nueva.
 *
 *  LO QUE NO CAZA, dicho para que nadie lo cite como garantía: un guion exento
 *  que dispare generación por otro camino (un `fetch` a pelo contra el motor,
 *  un `evaluate` que llame a la API del juego). Para eso está el contador del
 *  motor falso, que es la otra mitad y solo funciona con el fake delante. Las
 *  dos juntas siguen sin cubrir «guion exento + backend real + camino raro»:
 *  ese residuo se cierra borrando la excepción, no vigilándola.
 *
 *  Probado en negativo: con un guion de pega que declara `sinMotor`, importa
 *  `comenzar` y pulsa `#ts-start`, los dos asertos del bloque 2 se ponen rojos
 *  nombrándolo; con `sinMotor = true`, el del bloque 1; con `export const
 *  gasta`, el del 3. Las cuatro salidas están en el qa.md de la tanda
 *  2026-08-29-el-banco-no-puede-mentir.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** La EXCEPCIÓN del guardarraíl (#295): este guion no abre el juego siquiera
 *  — solo lee los ficheros de sus vecinos. */
export const sinMotor = "solo lee los ficheros de qa/guiones/; no arranca partida ni habla con el motor";

const DIR = dirname(fileURLToPath(import.meta.url));

/** Los helpers de `qa/lib/sesion.mjs` que HACEN GENERAR al motor. */
const HELPERS_CAROS = ["comenzar", "regenerarMundo"];
/** El mismo acto sin helper: PULSAR los dos botones del título que arrancan
 *  partida. Se busca el click y no la cadena, para no cazar la mención en un
 *  comentario ni en esta misma línea. */
const CLICK_CARO = /\.click\(\s*["']#ts-(start|continue)/;

/** El valor de `export const sinMotor`, tal cual está escrito (sin importar el
 *  módulo: importar un guion tiene efectos —el 20 pide puertos al kernel en su
 *  top-level await— y esto tiene que poder leerse en frío). */
function declaracion(src) {
  const m = src.match(/^export const sinMotor\s*=\s*([\s\S]*?);\s*\n/m);
  if (!m) return null;
  const crudo = m[1].trim();
  const trozos = [...crudo.matchAll(/"([^"]*)"|'([^']*)'/g)].map((t) => t[1] ?? t[2]);
  return { crudo, esCadena: /^["']/.test(crudo), texto: trozos.join("") };
}

/** Los nombres importados de `qa/lib/sesion.mjs`. */
function importadosDeSesion(src) {
  return [...src.matchAll(/import\s*{([^}]*)}\s*from\s*"\.\.\/lib\/sesion\.mjs"/g)]
    .flatMap((m) => m[1].split(","))
    .map((s) => s.trim().split(/\s+as\s+/)[0])
    .filter(Boolean);
}

export default async function (ctx) {
  const ficheros = readdirSync(DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
  const guiones = ficheros.map((f) => ({ nombre: f.replace(/\.mjs$/, ""), src: readFileSync(join(DIR, f), "utf8") }));
  const exentos = guiones.map((g) => ({ ...g, dec: declaracion(g.src) })).filter((g) => g.dec !== null);

  ctx.log(`${guiones.length} guiones · ${exentos.length} declaran \`sinMotor\``);
  ctx.expect(
    "hay guiones exentos que revisar (si no, este guion no está midiendo nada)",
    exentos.length > 0,
    `${exentos.length} exentos de ${guiones.length}`,
  );

  // ── 1 · El motivo es una frase, en TODOS, no solo en los que se ejecuten ──
  const malDeclarados = exentos.filter((g) => !g.dec.esCadena || g.dec.texto.trim().length < 10);
  ctx.expect(
    "cada `sinMotor` es el MOTIVO escrito, no un booleano ni una cadena vacía",
    malDeclarados.length === 0,
    malDeclarados.map((g) => `${g.nombre}: ${g.dec.crudo.slice(0, 40)}`).join(" · "),
  );

  // ── 2 · Un guion exento no puede llevar dentro lo que hace gastar ────────
  const conHelper = exentos
    .map((g) => ({ g, usa: importadosDeSesion(g.src).filter((n) => HELPERS_CAROS.includes(n)) }))
    .filter((x) => x.usa.length > 0);
  ctx.expect(
    "ningún guion exento importa los helpers que arrancan generación (comenzar/regenerarMundo)",
    conHelper.length === 0,
    conHelper.map((x) => `${x.g.nombre} usa ${x.usa.join("+")}`).join(" · "),
  );

  // El mismo acto sin helper. Con UNA excepción, y no es una lista de nombres:
  // el guion que se trae SU PROPIO motor (levanta un bridge con
  // `NEFAN_AI_SERVER` suyo y manda al cliente allí con `?bridge=`) no puede
  // gastar en el motor compartido por definición — es lo que hace el 20, que
  // apunta a un puerto muerto para medir el fallo. Lo que se afirma es la
  // inclusión: si pulsas «Comenzar» estando exento, tiene que ser contra un
  // motor tuyo. Un guion nuevo que pulse sin traerse motor sale rojo.
  const aMano = exentos.filter((g) => CLICK_CARO.test(g.src));
  const sinMotorPropio = aMano.filter((g) => !/NEFAN_AI_SERVER/.test(g.src));
  ctx.expect(
    "…y el exento que pulsa «Comenzar» (#ts-start/#ts-continue) se trae SU propio motor",
    sinMotorPropio.length === 0,
    sinMotorPropio.map((g) => g.nombre).join(" · "),
  );
  for (const g of aMano) ctx.log(`  ⚑ ${g.nombre} arranca partida contra su propio motor (revisión humana)`);

  // ── 3 · La marca directa no vuelve ───────────────────────────────────────
  const conGasta = guiones.filter((g) => /^export const gasta\b/m.test(g.src));
  ctx.expect(
    "ningún guion declara `export const gasta`: esa marca murió al invertir el guardarraíl",
    conGasta.length === 0,
    conGasta.map((g) => g.nombre).join(" · "),
  );

  for (const g of exentos) ctx.log(`  ⛨ ${g.nombre}: ${g.dec.texto}`);
}
