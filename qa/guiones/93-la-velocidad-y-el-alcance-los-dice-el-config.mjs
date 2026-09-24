/** LA FRONTERA QUE MOVIÓ LA PR 8 de #241: a qué velocidad anda el jugador y
 *  hasta dónde llega su `E` ya no son dos `const` del `main.ts` del cliente —
 *  son dos campos del `player` de `nefan-core/data/combat_config.json`, y el
 *  cliente los ejecuta. Escrito por QA al validar esa PR.
 *
 *  POR QUÉ NO BASTA MEDIR LOS NÚMEROS DE HOY. Que el jugador ande a 4,18 m/s y
 *  hable hasta a 2,5 m sale igual de verde con el multiplicador escrito a mano
 *  en el cliente (`ARCADE_SPEED_SCALE = 2.2`, `INTERACT_RANGE_M = 2.5`, que es
 *  como estaba) que con los dos leídos del config: los valores coinciden. Lo
 *  que separa una cosa de la otra es CAMBIAR EL CONFIG y ver si el juego se
 *  entera. Así que el config se SIRVE distinto —`page.route` sobre el módulo
 *  que Vite entrega al cliente (`/@fs/…/combat_config.json?import`), sin tocar
 *  el fichero del árbol— y se mide el juego con él:
 *
 *   · **bloque 1**, sin tocar nada: andando son `walk_speed × speed_scale` y
 *     esprintando `sprint_speed × speed_scale`, los del fichero de verdad. Es
 *     la línea base con la que se compara todo lo demás; sin ella, «cambia en
 *     proporción» podría estar cambiando desde cualquier sitio.
 *   · **bloque 2**, con `speed_scale × 1,5` servido: las DOS velocidades se
 *     multiplican por 1,5. Si el multiplicador volviera al cliente, el juego
 *     seguiría andando a 4,18 y este bloque sería el que lo dijera.
 *   · **bloque 3**, con `interact_range_m` servido a 1,2 m: el borde de la `E`
 *     se MUEVE — a 1,15 m se ofrece hablar y a 1,25 m ya no, y a 2,4 m (que con
 *     el config de verdad ofrece) deja de ofrecerse. El alcance no está escrito
 *     en el cliente: viene del config.
 *
 *  **La velocidad se mide contra el RELOJ DE SIM** (`Δpos / Δsim`, tanda W,
 *  #679), no contra el de pared. Hasta esa tarde el denominador era el `t` del
 *  `rAF`, que es pared, y como el loop topa su delta en 0,1 s este guion salía
 *  rojo bajo carga con el juego perfectamente correcto: medido a ×40, las doce
 *  velocidades de tres corridas a 0,15-0,42 de lo esperado. El detalle, en
 *  `medirVelocidad`.
 *
 *  Y **bloque 5** (#539): servido un `speed_scale` IMPOSIBLE (−1: el jugador
 *  andaría hacia atrás), el cliente no arranca —no puede: sin esos números no
 *  hay partida— pero DICE POR QUÉ. Hasta esa tanda `loadConfig` solo miraba el
 *  TIPO, así que el −1 cargaba sin una queja; y con el config mutilado de
 *  verdad la página se quedaba NEGRA con el motivo únicamente en la consola del
 *  navegador. Se afirma lo que ve quien juega: el muro con el campo, el valor,
 *  el fichero y qué pasaría, la entrada en el registro de errores, y que el
 *  cliente de verdad NO arrancó (`window.__nefan` ausente) — sin eso, «lo dice»
 *  podría estar diciéndolo encima de un juego que funciona. Y el control:
 *  quitada la intercepción, el título vuelve.
 *
 *  Y **bloque 4**: al morir y pulsar `R`, el jugador vuelve EXACTAMENTE donde
 *  cayó y ese punto se puede pisar (`puntoDeReaparicion`). Se afirma
 *  «exactamente donde cayó» y no solo «en un sitio libre» porque es lo único
 *  que separa la regla de hoy de cualquier otra: teletransportarle a cualquier
 *  hueco transitable del tile saldría igual de verde, y el jugador aparecería a
 *  treinta metros de donde le mataron sin que nada se pusiera rojo.
 *
 *  Y el bloque 4 AFIRMA además POR QUÉ esa regla no puede preguntar por
 *  sólidos: `CollisionSystem.collidesAt(x, z)` no es una consulta de punto sino
 *  «¿puedo MOVERME de donde estoy a (x,z)?» (`world/collision.ts`, `desde =
 *  getPlayerPos()`), así que la MISMA huella es sólida vista desde fuera y deja
 *  de serlo con el jugador encima. De ahí que #538 (2026-09-16) borrara la rama
 *  que colgaba de esa pregunta: ningún llamante podía alcanzarla. Hasta esa
 *  tanda este guion lo medía y lo REGISTRABA sin ponerlo rojo, y un bloque que
 *  solo loguea no es un candado; hoy se afirma la asimetría
 *  (`desdeLejos === true && desdeSiMismo === false`) y se pone rojo también si
 *  en la partida no hay ningún objeto sólido con el que medirla. Esas DOS
 *  sondas son las únicas del bloque que siguen siendo de MOVIMIENTO a
 *  propósito, y están declaradas en `data/contract/sondas-de-movimiento.json`:
 *  su SUJETO es la asimetría, así que migrar cualquiera de las dos volvería el
 *  aserto tautológico. Lo que sí se migró (#662) es el aserto hermano —«el
 *  punto en el que reaparece se puede PISAR»—, que preguntaba lo mismo con un
 *  mirador a mano (teletransportar 6 m, sondear, devolver) y hoy pregunta por
 *  `probePoint`, que no tiene origen que aparcar. Si algún día la asimetría
 *  desaparece, lo que toca es volver a decidir la reaparición, no tocar este
 *  aserto.
 *
 *  PROBADO EN NEGATIVO (2026-09-07) por QA, un sabotaje por vez y restaurado
 *  byte a byte después (`diff -q`):
 *   · **la frontera del config, en `nefan-html/src/main.ts`**: el multiplicador
 *     y el alcance escritos otra vez a mano (`(sprint ? 3.8 : 1.9) * 2.2` y
 *     `maxDistanceM: 2.5`), que es exactamente como estaba antes de la PR →
 *     **CUATRO rojos**: andando midió 4,1800 donde el config servido pedía
 *     6,27, esprintando 8,3600 donde pedía 12,54, y el borde de la `E` se quedó
 *     en el 2,5 del cliente (ofrece a 1,25 m y a 2,4 m con el config servido a
 *     1,2). Es el rojo que hace de este guion un candado y no una foto.
 *
 *  Y LOS TRES DEL BLOQUE 4, re-probados el 2026-09-16 al convertirlo en aserto
 *  (#538), uno por vez y restaurando byte a byte (`diff -q`):
 *   · **`nefan-core/src/simulation/reaparicion.ts`, los ejes cruzados**
 *     (`{ x: pos.z, …, z: pos.x }`) → rojo «vuelve EXACTAMENTE donde cayó»:
 *     cayó en (11,443, 0,338) y volvió a (0,338, 11,443), a 15,705 m de allí.
 *   · **`nefan-html/src/dev/nefan-hook.ts`, `probeCollide` preguntando desde
 *     6 m** — o sea la consulta de PUNTO que le falta al cliente, simulada
 *     sobre la de movimiento → rojo el aserto de la asimetría, y SOLO ese:
 *     «casa del leñador» desde fuera = true · desde sí mismo = true.
 *   · **el filtro de objetos de este mismo bloque vaciado** → rojo «hay un
 *     objeto sólido con el que medir» (objetos con huella: 0). Es la mitad que
 *     el bloque no tenía cuando solo logueaba: sin objeto no hay medida, y sin
 *     medida un verde no significa nada.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, `aisla` con saves y
 *  falso vírgenes. No pinta nada: `charMode: "vector"`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** El NPC que el tile de bootstrap del motor falso pone siempre. */
const TABERNERO = "barkeep";
/** Cuánto se multiplica `speed_scale` en el bloque 2. Ni 1 (no distinguiría
 *  «no cambia») ni 2 (que se confunde con sumar consigo mismo). */
const FACTOR = 1.5;
/** Alcance servido en el bloque 3: lejos del 2,5 real y dentro de lo que un
 *  jugador podría querer, para que el borde se vea moverse de verdad. */
const ALCANCE_CORTO_M = 1.2;
/** Tolerancia RELATIVA de la velocidad medida. Decía aquí que el error venía de
 *  que «el primer frame arrastra el delta de uno que empezó antes»; ese
 *  artefacto era del denominador de PARED y murió con él en la tanda W.
 *
 *  **Medido tras la cura: error 0,000 % en las DOCE velocidades de tres corridas
 *  quietas** (y en las de la corrida de control a ×1 del reproductor). No es
 *  suerte ni redondeo afortunado, y por eso se dice en vez de dejarlo en «es
 *  pequeño»: el camino es `Σ velocidad × Δᵢ` sobre los mismos frames cuyos `Δᵢ`
 *  suma el denominador, así que `camino / Δsim` devuelve la velocidad
 *  configurada al flotante. El error no es que sea bajo: es que no hay de dónde
 *  saque uno.
 *
 *  Así que el 3 % NO es un presupuesto de error, y conviene no leerlo así: es
 *  SEPARACIÓN DE SEÑAL, y lo era ya antes. Lo que el bloque 2 mueve es un 50 %
 *  (×1,5) y lo que movería el multiplicador de vuelta en el cliente, un 33 %; el
 *  3 % está quince veces por debajo de esa señal y no roza ningún ruido medido.
 *  Apretarlo no compraría nada —no hay defecto que quepa entre 0 % y 3 % y no
 *  quepa entre 0 % y 0,1 %— y arriesgaría un rojo intermitente el día que el
 *  camino deje de ser una recta. Queda donde está, con su número delante: el de
 *  cada corrida sale en el `ctx.log` de la velocidad. */
const TOL_REL = 0.03;
/** Margen del borde de la `E`: se prueba medio decímetro a cada lado. */
const MARGEN_M = 0.05;

/** Cuánto MUNDO dura la ventana de medida, en segundos de simulación, y cuántas
 *  muestras se tiran por cada extremo.
 *
 *  **La ventana se cuenta en SIM, no en frames, y esto no es simetría bonita:
 *  es la segunda mitad de la cura de #679, y se pagó con un rojo.** Con la
 *  ventana en 40 frames, lo que dura en MUNDO depende de la carga: quieta son
 *  ~1,15 s (frames de ~38 ms) y a ×40 son **exactamente 2,900 s**, porque todos
 *  los frames topan en `0,1 s` y 29 intervalos × 0,1 = 2,9. O sea que la
 *  distancia recorrida se multiplica por 2,5 justo cuando la máquina va peor.
 *  Medido: a ×40, `sprint × 1,5` pedía 12,54 m/s × 2,9 s = **36,37 m** de
 *  corredor recto y `rumboLibre` solo sondea 30 — el jugador se quedaba sin
 *  sitio a los 26,06 m y la velocidad salía a 0,72 de lo esperado, **rojo en 3
 *  de 3 corridas y con los mismos 26,06 m clavados en las tres**: no es ruido,
 *  es geometría. Las otras tres velocidades salían a 0,000 % de error en esas
 *  mismas corridas, que es lo que dice que el denominador ya estaba bien y lo
 *  que quedaba era la ventana.
 *
 *  Con 1,2 s de mundo la ventana dura lo mismo cargada que quieta y la peor
 *  distancia es 12,54 × 1,2 = **15,05 m**, la mitad del corredor sondeado. El
 *  aserto de «el trayecto cupo en el campo libre» sigue vigilándolo: no se
 *  sustituye un candado por una cuenta.
 *
 *  1,2 s se elige para NO cambiar lo que se medía en una máquina tranquila
 *  (~1,15 s), no por otra razón. El recorte de 5 por extremo es el de siempre. */
const SIM_DE_MEDIDA_S = 1.2;
const RECORTE = 5;
/** Cortafuegos de la ventana: sin él, un mundo que no simula deja el `rAF`
 *  girando para siempre. Con él, se sale y `medirVelocidad` decide — un Δsim de
 *  cero LANZA. 600 frames son ~10 s de pared a 60 fps y no se rozan en ninguna
 *  corrida medida (82 quieta, 22 a ×40). */
const FRAMES_TOPE = 600;

/** Los cuatro números del jugador, leídos del fichero de verdad. Si el config
 *  no los trae, `loadConfig` ya no deja arrancar el juego — aquí se leen crudos
 *  a propósito: el guion tiene que poder decir CON QUÉ comparaba. */
function configDelArbol() {
  const j = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core", "data", "combat_config.json"), "utf8"));
  return j.player;
}

/** Sirve el `combat_config.json` del CLIENTE con otros números, sin tocar el
 *  fichero del árbol (el bridge sigue leyendo el de disco: la velocidad y el
 *  alcance son del cliente). Devuelve un contador de sustituciones para que el
 *  guion pueda AFIRMAR que la intercepción hizo algo — sin eso, un cambio de
 *  formato del módulo de Vite dejaría el bloque midiendo el config de siempre
 *  y saldría verde por el motivo equivocado. */
async function servirConfigCon(ctx, cambios) {
  const cuenta = { sustituciones: 0, respuestas: 0 };
  await ctx.page.route("**/combat_config.json*", async (route) => {
    const r = await route.fetch();
    let cuerpo = await r.text();
    for (const [campo, valor] of Object.entries(cambios)) {
      const re = new RegExp(`"${campo}"\\s*:\\s*-?[0-9.]+`, "g");
      const antes = cuerpo;
      cuerpo = cuerpo.replace(re, () => {
        cuenta.sustituciones++;
        return `"${campo}":${valor}`;
      });
      if (cuerpo === antes) cuenta[`falta_${campo}`] = true;
    }
    cuenta.respuestas++;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8" },
      body: cuerpo,
    });
  });
  return cuenta;
}

/** Rumbo con al menos `metros` de campo libre por delante (`probeCollide` cada
 *  25 cm). Sin esto la medida es una carrera contra un muro: esprintando, seis
 *  segundos de tecla llegan al borde del tile y la velocidad media sale un 50 %
 *  baja — pasó midiendo esta misma PR. */
async function rumboLibre(ctx, metros = 30) {
  return ctx.page.evaluate((m) => {
    const p = window.__nefan.state().pos;
    const pc = window.__nefan.probeCollide;
    let mejor = { yaw: 0, libre: -1 };
    for (let i = 0; i < 72; i++) {
      const yaw = (i * Math.PI * 2) / 72;
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      let libre = 0;
      for (let d = 0.25; d <= m; d += 0.25) {
        if (pc(p.x + dx * d, p.z + dz * d)) break;
        libre = d;
      }
      if (libre > mejor.libre) mejor = { yaw, libre };
    }
    return mejor;
  }, metros);
}

/** METROS POR SEGUNDO medidos en el juego: se encara un rumbo libre, se mantiene
 *  la tecla hasta que el MUNDO ha avanzado `SIM_DE_MEDIDA_S`, se recortan cinco
 *  muestras por extremo y la velocidad es el camino interior partido por EL
 *  TIEMPO QUE EL MUNDO SIMULÓ, no por el que marcó el reloj. Las dos mitades
 *  —ventana y denominador— van en la misma escala a propósito; por qué la
 *  ventana también, en el docblock de `SIM_DE_MEDIDA_S`.
 *
 *  **EL DENOMINADOR ES EL RELOJ DE SIM** (#679, tanda W), y hasta esa tarde no
 *  lo era: este sitio era deuda VIVA de #545 y su propio docblock lo declaraba.
 *  El muestreador vive en el `rAF` de la página y el `t` que `rAF` entrega ES un
 *  timestamp de PARED, mientras que el numerador —el camino recorrido— es de
 *  SIMULACIÓN. El `gameLoop` del cliente avanza el mundo con
 *  `delta = min(Δpared, 0,1 s)` (`nefan-html/src/main.ts`), así que en cuanto un
 *  frame pasa de 100 ms las dos mitades dejan de estar en la misma escala y la
 *  velocidad medida sale BAJA sin que el juego haya cambiado nada.
 *
 *  Medido el día de la cura, en esta misma máquina, con
 *  `node qa/bajo-carga.mjs 93 --factor 40 --repeticiones 3`: **rojo en 3 de 3**
 *  corridas frenadas, razón sim/pared 0,130 / 0,176 / 0,148 y las doce
 *  velocidades a **0,15-0,42** de lo esperado. Y el numerador ni se inmutaba
 *  —12,12 m andando en las tres corridas, clavado— que es la firma del defecto:
 *  lo que se hinchaba era el denominador.
 *
 *  Ahora `sim` sale de `window.__nefan.reloj()` LEÍDO EN EL MISMO callback que
 *  `pos`, y la medida es exacta, no aproximada: `pasoDelJugador` y
 *  `gameClient.tick(relojDeSim.avanza(delta))` (`main.ts`) reciben el MISMO
 *  `delta` en el mismo frame, y el `rAF` de este muestreador se registra después
 *  del que encola el loop, así que cada muestra ve `pos` y `sim` post-tick del
 *  mismo frame. El `rAF` sigue siendo el muestreador —es el latido de la página,
 *  y es lo que reparte las muestras por frames distintos—; lo que se retiró es
 *  su `t`, que ya no se lee en ningún sitio.
 *
 *  **Δsim = 0 LANZA** en vez de devolver `Infinity`. El reloj de sim solo cuenta
 *  lo que el mundo SIMULA y está gateado por el título
 *  (`nefan-html/src/world/reloj-de-sim.ts`), así que un cero aquí no es una
 *  velocidad mala: es que no hubo mundo durante la medida —el título delante, o
 *  el driver sin efecto— y eso hay que leerlo, no dividirlo. Un `Infinity` daría
 *  rojo igual, pero rojo MUDO, que es la clase de rojo que el 131 vino a hacer
 *  legible. */
async function medirVelocidad(ctx, { sprint }) {
  const r = await rumboLibre(ctx);
  await ctx.nefan("setYaw", r.yaw);
  if (sprint) await ctx.nefan("inputDriver.press", "sprint");
  await ctx.nefan("inputDriver.press", "up");
  const muestras = await ctx.page.evaluate(
    (a) =>
      new Promise((res) => {
        const out = [];
        // Lo que tiene que durar `a.sim` es la ventana INTERIOR, la que se va a
        // medir: presupuestar sobre el total y recortar después dejaría la
        // medida más corta de lo pedido justo en las corridas lentas.
        const interior = () =>
          out.length > 2 * a.recorte ? out[out.length - 1 - a.recorte][0] - out[a.recorte][0] : 0;
        // `sim` y `pos` en el MISMO callback. Leerlos en dos sitios distintos
        // —o uno de ellos antes del bucle— volvería a mezclar dos relojes, que
        // es exactamente el defecto que esto cura.
        const tick = () => {
          const p = window.__nefan.state().pos;
          const reloj = window.__nefan.reloj();
          out.push([reloj.sim, p.x, p.z]);
          if (interior() >= a.sim || out.length >= a.tope) res(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { sim: SIM_DE_MEDIDA_S, recorte: RECORTE, tope: FRAMES_TOPE },
  );
  await ctx.nefan("inputDriver.releaseAll");
  const m = muestras.slice(RECORTE, -RECORTE);
  let camino = 0;
  for (let i = 1; i < m.length; i++) camino += Math.hypot(m[i][1] - m[i - 1][1], m[i][2] - m[i - 1][2]);
  const segSim = m.length > 1 ? m[m.length - 1][0] - m[0][0] : 0;
  if (!(segSim > 0)) {
    throw new Error(
      `el mundo no simuló durante la medida (Δsim = ${segSim} s en ${m.length} muestras interiores de ` +
        `${muestras.length}, con ${camino.toFixed(3)} m de camino): el reloj de sim solo cuenta lo que el ` +
        `mundo simula, así que esto es el título delante o el driver sin efecto, no una velocidad lenta. ` +
        `Se para aquí en vez de dividir por cero y afirmar sobre un Infinity.`,
    );
  }
  return { vel: camino / segSim, camino, segSim, libre: r.libre };
}

/** El aserto de UNA velocidad medida, escrito una vez en vez de cuatro.
 *
 *  La cuenta es la de siempre —`|medido − esperado| < esperado × TOL_REL`— y el
 *  texto del ✔/✘ también; lo que cambió en la tanda W es de dónde sale `medido`.
 *  Estas cuatro llamadas pasaron una mañana (#609) por un verbo que DECLARABA la
 *  tasa: pedía la cantidad y sus segundos de PARED por separado, para que el
 *  reproductor bajo carga reconociera el rojo de este guion sin leerle el texto
 *  al aserto. Con el denominador ya en segundos de SIM no hay tasa de pared que
 *  declarar —entregarle `segSim` como si fuera pared sería mentir justo en el
 *  tipo que #609 construyó para no mentir—, así que vuelven a `ctx.expect` y el
 *  verbo se retiró con su rama del clasificador. Sus nombres están candados en
 *  `campos-retirados-no-vuelven`; la historia, en la crítica de la tanda W.
 *
 *  El `ctx.log` no es adorno: el ✔ no imprime el `detalle`, y sin él el ERROR
 *  RELATIVO medido —el número del que cuelga `TOL_REL`— no se podría leer en una
 *  corrida verde, que es justo la corrida en la que hay que mirarlo. */
function afirmaVelocidad(ctx, desc, m, teorico) {
  const error = Math.abs(m.vel - teorico) / teorico;
  ctx.log(
    `velocidad: ${m.vel.toFixed(4)} m/s contra ${teorico.toFixed(4)} esperados — error ` +
      `${(error * 100).toFixed(3)} % (${m.camino.toFixed(2)} m / ${m.segSim.toFixed(3)} s de SIM)`,
  );
  ctx.expect(
    desc,
    error < TOL_REL,
    `medido ${m.vel.toFixed(4)} m/s (${m.camino.toFixed(2)} m / ${m.segSim.toFixed(2)} s de sim, ${m.libre} m libres)`,
  );
}

/** ¿Ofrece el HUD hablar con el tabernero desde EXACTAMENTE `d` metros? El NPC
 *  pasea (vida ambiental, `state_update` a 60 Hz), así que el plantado se
 *  repite hasta que la distancia LEÍDA es la pedida; si no se consigue, se dice
 *  en vez de ensuciar el borde con una muestra de otra distancia. */
async function ofreceHablarA(ctx, d) {
  for (let intento = 0; intento < 120; intento++) {
    const puesto = await ctx.page.evaluate(
      (a) => {
        const n = window.__nefan.npcs().find((x) => x.id === a.id);
        if (!n) return false;
        window.__nefan.setPlayerPos(n.pos.x + a.d, n.pos.z);
        return true;
      },
      { id: TABERNERO, d },
    );
    if (!puesto) return { error: "el tabernero no está en el mundo" };
    const est = await ctx.page.evaluate(
      (a) =>
        new Promise((res) =>
          requestAnimationFrame(() => {
            const n = window.__nefan.npcs().find((x) => x.id === a.id);
            const p = window.__nefan.state().pos;
            res({
              dist: n ? Math.hypot(p.x - n.pos.x, p.z - n.pos.z) : NaN,
              acciones: window.__nefan.ui.actions().prompt.map((b) => b.label ?? b.id ?? String(b)),
            });
          }),
        ),
      { id: TABERNERO },
    );
    if (Math.abs(est.dist - d) < 0.005) {
      return { dist: est.dist, ofrece: est.acciones.some((l) => /hablar/i.test(l)), acciones: est.acciones };
    }
  }
  return { error: `el tabernero se movía: no se pudo fijar la distancia ${d} m` };
}

/** Mide la escalera del borde de la `E` a los dos lados de `alcance`. */
async function bordeDeLaE(ctx, alcance) {
  const dentro = await ofreceHablarA(ctx, Number((alcance - MARGEN_M).toFixed(3)));
  const fuera = await ofreceHablarA(ctx, Number((alcance + MARGEN_M).toFixed(3)));
  return { dentro, fuera };
}

/** MATA AL JUGADOR COMO MUERE DE VERDAD —el hostil que el motor suelta en el
 *  turno 2 le pega hasta tumbarle— y le devuelve a la vida con la R, que es la
 *  puerta del jugador. Nada de forzar la vida por el sim: lo que se mide es el
 *  camino que recorre quien juega.
 *
 *  La R es one-shot y el bucle solo la aplica con el jugador ya muerto PARA EL
 *  SIM (el HUD puede ir un tick por delante), así que se vuelve a pulsar en
 *  cada muestra. Todo por ESTADO: la vida del HUD, nunca un reloj. */
async function morirYVolver(ctx) {
  const hostil = await ctx.waitFor(
    "el motor suelta un hostil con el que morir",
    () => window.__nefan.enemies().find((e) => e.alive !== false) ?? null,
    90_000,
  );
  ctx.log(`hostil: ${hostil.label ?? hostil.id} (${hostil.hp}/${hostil.maxHp})`);
  await acercarse(ctx, hostil.id, { objetivo: 1.2 });
  // Y se le deja pegar: el jugador se queda encarado y quieto, que es como se
  // muere en este bench. Sin atacar de vuelta, para no matarle antes a él.
  const muerto = await ctx.waitFor(
    "el hostil mata al jugador",
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      const p = window.__nefan.state().pos;
      if (e && p) window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      return hp === 0 ? { hp, pos: { ...p } } : null;
    },
    120_000,
    hostil.id,
  );
  const cayoEn = muerto.pos;
  const vuelto = await ctx.waitFor(
    "el jugador vuelve a la vida tras pulsar R",
    () => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "0");
      if (hp > 0) return { hp, pos: { ...window.__nefan.state().pos } };
      window.__nefan.inputDriver.queueRespawn();
      return null;
    },
    20_000,
  );
  return { cayoEn, muerto: muerto.hp, ...vuelto };
}

export default async function (ctx) {
  const delArbol = configDelArbol();
  ctx.log(`config del árbol: ${JSON.stringify(delArbol)}`);

  // ── 1 · La velocidad del juego ES la del config ──────────────────────────
  await nuevaPartida(ctx, { charMode: "vector", renderMode: "image" });
  await comenzar(ctx);
  const base = {
    andar: await medirVelocidad(ctx, { sprint: false }),
    sprint: await medirVelocidad(ctx, { sprint: true }),
  };
  const teoricoAndar = delArbol.walk_speed * delArbol.speed_scale;
  const teoricoSprint = delArbol.sprint_speed * delArbol.speed_scale;
  afirmaVelocidad(
    ctx,
    `andando, el jugador va a walk_speed × speed_scale = ${teoricoAndar.toFixed(2)} m/s`,
    base.andar,
    teoricoAndar,
  );
  afirmaVelocidad(
    ctx,
    `esprintando, sprint_speed × speed_scale = ${teoricoSprint.toFixed(2)} m/s`,
    base.sprint,
    teoricoSprint,
  );

  // ── 2 · Con OTRO speed_scale servido, el juego cambia en proporción ──────
  const escala = Number((delArbol.speed_scale * FACTOR).toFixed(4));
  const cuenta = await servirConfigCon(ctx, { speed_scale: escala });
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { charMode: "vector", renderMode: "image" });
  await comenzar(ctx);
  ctx.expect(
    `el config que recibe el cliente se sirvió con speed_scale = ${escala} (si no, lo de abajo no mide nada)`,
    cuenta.sustituciones > 0 && !cuenta.falta_speed_scale,
    JSON.stringify(cuenta),
  );
  const conEscala = {
    andar: await medirVelocidad(ctx, { sprint: false }),
    sprint: await medirVelocidad(ctx, { sprint: true }),
  };
  for (const [que, m, teorico] of [
    ["andando", conEscala.andar, teoricoAndar * FACTOR],
    ["esprintando", conEscala.sprint, teoricoSprint * FACTOR],
  ]) {
    ctx.expect(
      `${que}, el trayecto medido cupo en el campo libre (si no, lo que se mide es un muro)`,
      m.camino < m.libre,
      `recorrió ${m.camino.toFixed(2)} m con ${m.libre} m libres por delante`,
    );
    afirmaVelocidad(
      ctx,
      `con speed_scale × ${FACTOR} en el config, ${que} son ${teorico.toFixed(2)} m/s — la velocidad NO está escrita en el cliente`,
      m,
      teorico,
    );
  }

  // ── 3 · El alcance de la E también sale del config ───────────────────────
  const cuenta3 = await servirConfigCon(ctx, { interact_range_m: ALCANCE_CORTO_M });
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { charMode: "vector", renderMode: "image" });
  await comenzar(ctx);
  ctx.expect(
    `el config que recibe el cliente se sirvió con interact_range_m = ${ALCANCE_CORTO_M}`,
    cuenta3.sustituciones > 0 && !cuenta3.falta_interact_range_m,
    JSON.stringify(cuenta3),
  );
  const borde = await bordeDeLaE(ctx, ALCANCE_CORTO_M);
  ctx.expect(
    `con interact_range_m = ${ALCANCE_CORTO_M} m se ofrece hablar a ${(ALCANCE_CORTO_M - MARGEN_M).toFixed(2)} m`,
    borde.dentro.ofrece === true,
    JSON.stringify(borde.dentro),
  );
  ctx.expect(
    `…y a ${(ALCANCE_CORTO_M + MARGEN_M).toFixed(2)} m ya no`,
    borde.fuera.ofrece === false && !borde.fuera.error,
    JSON.stringify(borde.fuera),
  );
  const aDosCuarenta = await ofreceHablarA(ctx, 2.4);
  ctx.expect(
    "a 2,4 m —que con el config de verdad SÍ ofrece— ya no se ofrece: el 2,5 no vive en el cliente",
    aDosCuarenta.ofrece === false && !aDosCuarenta.error,
    JSON.stringify(aDosCuarenta),
  );
  await ctx.page.unroute("**/combat_config.json*");

  // ── 4 · Reaparecer devuelve a un punto que se puede pisar ────────────────
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { charMode: "vector", renderMode: "image" });
  await comenzar(ctx);
  const alcanceReal = configDelArbol().interact_range_m;
  const bordeReal = await bordeDeLaE(ctx, alcanceReal);
  ctx.expect(
    `sin interceptar, el borde vuelve a ser el del fichero (${alcanceReal} m): ofrece a ${(alcanceReal - MARGEN_M).toFixed(2)} y no a ${(alcanceReal + MARGEN_M).toFixed(2)}`,
    bordeReal.dentro.ofrece === true && bordeReal.fuera.ofrece === false,
    JSON.stringify(bordeReal),
  );

  const r = await morirYVolver(ctx);
  ctx.expect("el jugador estaba MUERTO antes de la R (si no, no hay reaparición que medir)", r.muerto === 0, `vida ${r.muerto}`);
  ctx.expect(
    "reaparece con la vida llena",
    r.hp > 0,
    `hp ${r.hp}`,
  );
  const dist = Math.hypot(r.pos.x - r.cayoEn.x, r.pos.z - r.cayoEn.z);
  ctx.expect(
    "vuelve EXACTAMENTE donde cayó",
    dist < 0.01,
    `cayó en (${r.cayoEn.x.toFixed(3)}, ${r.cayoEn.z.toFixed(3)}) · volvió a (${r.pos.x.toFixed(3)}, ${r.pos.z.toFixed(3)}) · ${dist.toFixed(3)} m`,
  );
  // La solidez del punto se pregunta por PUNTO (#662). Aquí había un mirador a
  // mano —teletransportar al jugador 6 m en diagonal, sondear con
  // `probeCollide` y devolverlo— porque una consulta de MOVIMIENTO con el
  // jugador encima siempre diría «libre» y el aserto no valdría nada.
  // `probePoint` no tiene origen: el protocolo sobra y el aserto mide lo mismo.
  const solido = await ctx.nefan("probePoint", r.pos.x, r.pos.z);
  ctx.expect(
    "el punto en el que reaparece se puede PISAR (por PUNTO, no desde encima)",
    solido === false,
    `probePoint(${r.pos.x.toFixed(2)}, ${r.pos.z.toFixed(2)}) = ${solido}`,
  );
  await ctx.shot("reaparecido");

  // POR QUÉ la reaparición no puede preguntar por sólidos, AFIRMADO y no solo
  // registrado: con el jugador metido a la fuerza dentro de una huella sólida,
  // su propia posición le sigue pareciendo libre. `collidesAt` es una consulta
  // de MOVIMIENTO, no de punto, y por eso #538 borró la rama que colgaba de
  // ella: nadie podía alcanzarla desde el juego.
  const dentroDeUnSolido = await ctx.page.evaluate(() => {
    const objs = window.__nefan.objects().filter((o) => o.sizeXZ);
    const antes = { ...window.__nefan.state().pos };
    for (const o of objs) {
      window.__nefan.setPlayerPos(antes.x, antes.z);
      const desdeLejos = window.__nefan.probeCollide(o.pos.x, o.pos.z);
      if (!desdeLejos) continue;
      window.__nefan.setPlayerPos(o.pos.x, o.pos.z);
      const desdeSiMismo = window.__nefan.probeCollide(o.pos.x, o.pos.z);
      window.__nefan.setPlayerPos(antes.x, antes.z);
      return { objeto: o.label, desdeLejos, desdeSiMismo, candidatos: objs.length };
    }
    return { objeto: null, candidatos: objs.length };
  });
  // Sin objeto no hay medida, y sin medida este aserto no puede ponerse rojo:
  // se declara ROJO en vez de verde silencioso.
  ctx.expect(
    "hay un objeto sólido con el que medir la consulta de reaparición",
    dentroDeUnSolido.objeto !== null,
    `objetos con huella en la partida: ${dentroDeUnSolido.candidatos}`,
  );
  ctx.expect(
    "`collidesAt` NO es una consulta de punto: la misma huella es sólida desde fuera y no con el jugador encima " +
      "— por eso la reaparición no puede preguntar por sólidos (#538)",
    dentroDeUnSolido.desdeLejos === true && dentroDeUnSolido.desdeSiMismo === false,
    `«${dentroDeUnSolido.objeto}» desde fuera = ${dentroDeUnSolido.desdeLejos} · desde sí mismo = ${dentroDeUnSolido.desdeSiMismo}`,
  );

  // ── 5 · Un config IMPOSIBLE no deja al jugador delante de una negra ──────
  // `speed_scale: -1` pasa el tipo y no pasa el rango: el jugador andaría hacia
  // atrás. Antes de #539 cargaba sin una queja; y un config mutilado tiraba la
  // evaluación de la raíz antes de que existiera un solo pintor de avisos.
  // Y el cliente MUERE al hacerlo, que es media medida: sin esos números no
  // hay partida, y seguir con un default escondido sería la mentira que #241
  // cerró. La excepción no capturada es LA MEDIDA, no un defecto — se declara
  // con su motivo, y si no ocurriera este guion saldría rojo por no haberla
  // provocado.
  ctx.excepcionEsperada(
    /CombatData: combat_config\.json: player\.speed_scale/,
    "el bloque 5 sirve un `speed_scale` imposible a propósito: el cliente aborta su arranque —eso es " +
      "lo que se está midiendo— y el motivo llega al muro y al registro antes de morir",
  );
  const cuenta5 = await servirConfigCon(ctx, { speed_scale: -1 });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  const muro = await ctx.waitFor(
    "5 · con un `speed_scale` imposible, el jugador tiene un muro delante y no una pantalla negra",
    () => {
      const el = document.getElementById("narrative-loader");
      if (!el || !el.classList.contains("visible")) return null;
      return {
        error: el.classList.contains("error"),
        titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
        detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
        registro: document.getElementById("error-log")?.textContent ?? "",
        arrancado: Boolean(window.__nefan),
      };
    },
    30_000,
  );
  ctx.expect(
    `5 · el config que recibe el cliente se sirvió con speed_scale = -1 (si no, esto no mide nada)`,
    cuenta5.sustituciones > 0 && !cuenta5.falta_speed_scale,
    JSON.stringify(cuenta5),
  );
  ctx.log(`5 · muro: ${JSON.stringify({ ...muro, registro: muro.registro.slice(0, 160) })}`);
  ctx.expect("5 · el muro es de ERROR, no el de espera del motor", muro.error === true, JSON.stringify(muro));
  ctx.expect(
    "5 · el detalle dice el CAMPO, el VALOR, el FICHERO y qué pasaría — todo lo que hace falta para arreglarlo",
    muro.detalle.includes("player.speed_scale") &&
      muro.detalle.includes("vale -1") &&
      muro.detalle.includes("combat_config.json") &&
      muro.detalle.includes("mayor que 0"),
    muro.detalle,
  );
  ctx.expect(
    "5 · …y el mismo motivo queda en el registro de errores (los dos canales de la casa, una sola verdad)",
    muro.registro.includes("player.speed_scale"),
    muro.registro.slice(0, 300),
  );
  ctx.expect(
    "5 · el cliente NO arrancó: sin esos números no hay partida, y eso es lo que el muro está contando",
    muro.arrancado === false,
    `window.__nefan ${muro.arrancado ? "existe" : "ausente"}`,
  );
  await ctx.shot("93-el-config-imposible-dice-por-que");

  // Control: quitada la intercepción, el juego vuelve a arrancar. Sin esto, el
  // bloque 5 sería igual de verde con el cliente roto por cualquier otra cosa.
  await ctx.page.unroute("**/combat_config.json*");
  await recargarAlTitulo(ctx);
  ctx.expect(
    "5 · control: con el config de verdad el título vuelve y no hay muro puesto",
    await ctx.page.evaluate(
      () => Boolean(window.__nefan) && !document.getElementById("narrative-loader")?.classList.contains("visible"),
    ),
    "el control es lo que separa «el muro lo puso el config» de «el cliente está roto»",
  );
}
