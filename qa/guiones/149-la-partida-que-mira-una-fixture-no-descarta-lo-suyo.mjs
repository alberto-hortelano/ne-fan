/** EL SELLO DEL SIM VISTO DESDE EL SOCKET DEL JUGADOR, en los dos regímenes
 *  que atraviesa UNA MISMA PÁGINA: su partida y el selector «Room» (#659).
 *
 *  Escrito por QA de la tanda O. #659 hizo que cada `state_update` diga DE
 *  QUIÉN ES EL SIM que describe y que el cliente tire el que no es suyo. El
 *  banco heredó un solo candado de navegador para eso, el bloque 5 del guion
 *  80, y ese guion es `sinMotor`: **nunca tiene sesión**, así que solo recorre
 *  dos de las tres identidades (`nadie` y `prueba`) y una sola transición
 *  (`nadie → prueba`). Lo dice su propio autor en `qa/README.md`: invirtió el
 *  ORDEN de las dos reglas de `identidadDelCliente` —la que decide que la
 *  PRUEBA manda sobre la PARTIDA— y el 80 siguió VERDE, porque con
 *  `sessionId === ""` las dos ramas dan lo mismo.
 *
 *  Eso deja sin candado de navegador justo la trampa que este diseño vino a
 *  no pisar, y que la crítica de la tanda nombró con estas palabras: *una
 *  página EN partida que abre el selector «Room» descartaría su propia
 *  respuesta*. Con el sello ingenuo (`ctx.narrative.session_id`, que en
 *  fixtures es el id RANCIO de la sesión anterior) o con las dos reglas al
 *  revés, esta página tiraría sus cuatro respuestas —`load_room`, `input`,
 *  `respawn`, `add_combatants`— y el mundo se quedaría sin nada que se mueva
 *  CON TODO LO DEMÁS EN VERDE.
 *
 *  ## Qué mide, y por qué desde el socket
 *
 *  Un contador a cero no distingue «no se tiró nada» de «no llegó nada»: es la
 *  misma lección que el propio bloque 5 del 80 aprendió en rojo. Así que aquí
 *  la mitad positiva no se deduce, se MIDE en el cable: un espía envuelve
 *  `window.WebSocket` y cuenta los `state_update` que entran por el mismo
 *  `onmessage` que usa el cliente, con el `delSim` que traen (patrón de los
 *  guiones 35 y 89; no toca una línea de producción). Los asertos van en
 *  pareja: **llegaron N con el sello S** y **la página no tiró ninguno**.
 *
 *  Las tres identidades quedan así:
 *   · `partida` — el tramo 1, que ningún guion de navegador recorría.
 *   · `prueba`  — el tramo 2, pero llegando DESDE una partida viva, que es la
 *                 transición que el 80 no puede hacer.
 *   · `nadie`   — no es de este guion: lo cubre el 80, y el par 79→80 mide
 *                 además que una página sin sesión TIRA el frame de la partida
 *                 muerta que hereda por el bridge compartido.
 *
 *  ## Cómo se pone rojo (PROBADO EN NEGATIVO, dos sabotajes, uno por vez y
 *  restaurado con `md5sum` entre ellos, 2026-09-18)
 *
 *   1. **Invertir el ORDEN de las dos reglas de `identidadDelCliente`** — el
 *      sabotaje con el que el guion 80 se queda VERDE: la página en partida que
 *      carga la fixture se cree `{de:"partida"}` mientras el sim dice
 *      `{de:"prueba"}`, y tira todas sus respuestas. ROJOS los dos asertos del
 *      bloque 2, con `0 → 14 → 28` tirados y siete «↩ estado de una escena de
 *      prueba descartado» en la línea del juego. En la MISMA corrida, el guion
 *      80 salió verde — que es la razón entera de que este guion exista.
 *   2. **Neutralizar el embudo de `net/game-client.ts`** (que el cliente
 *      compare el sello consigo mismo, o borrar el bloque entero con sus
 *      imports): ROJOS los TRES asertos del bloque 1b, con la entrada
 *      `el bridge mueve al NPC "qa149-npc-de-otra-partida"` en el registro.
 *      Antes de que existiera 1b, ese mismo sabotaje dejaba `npm test`
 *      3036/3036, `tsc` y `eslint` limpios y los guiones 79, 80 y este mismo EN VERDE:
 *      borrar el filtro del cliente —que es la mitad que pedía el issue— no lo
 *      cazaba nada del repositorio.
 *
 *  ## Lo que este guion NO ve, dicho para que nadie lo cuente de más
 *
 *  La mitad del `lastState` (el sink `estadoDelSim`, «volver al título deja de
 *  repetir el frame del sim muerto»). QA de la tanda O midió que ese síntoma no
 *  es alcanzable por ningún camino del jugador —la vuelta al título exige mundo
 *  vacío (`status-rotulo.ts`) y toda partida sin mundo tiene el sim recién
 *  sembrado (`reseedSimForSession`), así que el frame repetido es idéntico al
 *  neutro—, y está escrito en el `qa.md` de la tanda con su medida.
 *
 *  Cero créditos: modo maqueta en los dos selectores (`vector`/`vector`), y
 *  las fixtures del selector «Room» no piden nada al motor.
 */
import { nuevaPartida, comenzar, esperarTituloListo, recargarAlTitulo } from "../lib/sesion.mjs";
import { cargarFixture } from "../lib/fixtures.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

/** Reloj "mundo": lo que hay que dejar correr aquí es la SIMULACIÓN, porque lo
 *  que se cuenta son los frames que el bridge contesta a cada `input` — y el
 *  `input` solo sale cuando el mundo se ticka (con el título delante no). */
const esperarMundo = esperaDeFotogramas("mundo");

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const PRIMERA = "robledo_tile";
const SEGUNDA = "zorder_test";

/** Espía del wire: cuenta los `state_update` que entran y se queda con el
 *  censo de sellos distintos que ha visto. No reescribe nada — el seam es el
 *  que ya existe (`bridge-client.ts` asigna `this.ws.onmessage`). Hay que
 *  instalarlo ANTES de que cargue la app. */
async function instalarElEspiaDelWire(ctx) {
  await ctx.page.addInitScript(() => {
    const Original = window.WebSocket;
    window.__qaSellos = { vistos: 0, sinSello: 0, censo: {}, ultimo: null };
    window.__qaSockets = [];
    const Envuelto = function (...args) {
      const sock = new Original(...args);
      window.__qaSockets.push(sock);
      let real = null;
      Object.defineProperty(sock, "onmessage", {
        get: () => real,
        set: (fn) => { real = fn; },
        configurable: true,
      });
      sock.addEventListener("message", (ev) => {
        if (!real) return;
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch { real(ev); return; }
        if (msg?.type === "state_update") {
          const w = window.__qaSellos;
          w.vistos++;
          w.ultimo = msg;
          if (!msg.delSim || typeof msg.delSim.de !== "string") w.sinSello++;
          else {
            const clave = msg.delSim.de === "partida"
              ? `partida:${msg.delSim.sessionId}`
              : msg.delSim.de;
            w.censo[clave] = (w.censo[clave] ?? 0) + 1;
          }
        }
        real(ev);
      });
      return sock;
    };
    Envuelto.prototype = Original.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Envuelto[k] = Original[k];
    window.WebSocket = Envuelto;
  });
}

/** Lo que el espía lleva contado, más lo que la página dice haber tirado y la
 *  línea del juego, que es donde se leería un descarte. */
const foto = (ctx) =>
  ctx.page.evaluate(() => ({
    ...JSON.parse(JSON.stringify(window.__qaSellos)),
    tirados: window.__nefan.estadosTirados(),
    sesion: window.__nefan.sesion().sessionId,
    escena: window.__nefan.scene?.scene_id ?? null,
    lineas: [...document.querySelectorAll("#combat-log > *")].map((e) => e.textContent ?? "").join(" | "),
    /** Cuántas líneas «↩ estado de … descartado» lleva la partida. Se cuenta y
     *  no se busca: tras el bloque 1b hay UNA a propósito, así que lo que
     *  afirman los bloques siguientes es que NO CRECE. */
    descartesDichos: [...document.querySelectorAll("#combat-log > *")]
      .filter((e) => (e.textContent ?? "").includes("↩ estado de")).length,
    registro: (document.getElementById("error-log")?.textContent ?? "").replace(/\s+/g, " "),
  }));

export default async function (ctx) {
  await instalarElEspiaDelWire(ctx);
  // El espía se instala con `addInitScript`, así que solo lo ve una página que
  // cargue DESPUÉS: se vuelve al título por el camino de siempre.
  await recargarAlTitulo(ctx);
  await esperarTituloListo(ctx);

  // ── 1 · Régimen PARTIDA: la página no tira ni uno de los suyos ───────────
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector", charMode: "vector" });
  const { sessionId } = await comenzar(ctx);
  // Que el mundo corra un rato: cada frame simulado manda un `input` y el
  // bridge contesta con un `state_update`, que es lo que se está contando.
  await esperarMundo(ctx, 20);
  const enPartida = await foto(ctx);
  ctx.log(
    `partida «${sessionId}»: state_update vistos ${enPartida.vistos} · censo de sellos ` +
      `${JSON.stringify(enPartida.censo)} · sin sello ${enPartida.sinSello} · tirados ${enPartida.tirados}`,
  );
  ctx.expect(
    "ocurre: el bridge contesta al tick con state_update de verdad (si no llegara ninguno, «0 tirados» no distinguiría nada)",
    enPartida.vistos > 0,
    String(enPartida.vistos),
  );
  ctx.expect(
    "todo state_update de la partida viene FIRMADO, y firmado por ESTA partida (#659)",
    enPartida.sinSello === 0 && Object.keys(enPartida.censo).join(",") === `partida:${sessionId}`,
    `sin sello ${enPartida.sinSello} · ${JSON.stringify(enPartida.censo)}`,
  );
  ctx.expect(
    "en su propia partida, la página no descarta NI UNO de sus frames",
    enPartida.tirados === 0,
    String(enPartida.tirados),
  );

  // ── 1b · Y SÍ TIRA el que no es suyo, con el jugador delante ─────────────
  // Todo lo de arriba, y el bloque 5 del guion 80, miden UNA dirección: que no
  // se descarte lo propio. Un cliente que dejara de filtrar del todo las cumple
  // TODAS —medido: con el embudo de `net/game-client.ts` borrado entero, `npm
  // test` sigue 3036/3036 y los guiones 79, 80 y este mismo salen verdes—. La otra
  // dirección necesita un frame AJENO, y en una batería de un solo bridge no se
  // puede pedir uno de verdad: se entrega por el mismo `onmessage` que usa el
  // cliente (patrón del guion 35), que es el seam que ya existe. Lleva DOS
  // cosas dentro que un frame ajeno lleva de verdad: el sello de otra partida y
  // un NPC que esta página no tiene en escena — que es literalmente la entrada
  // «el bridge mueve al NPC X» con la que se escribió #659.
  const AJENA = "qa149-otra-partida";
  const FANTASMA = "qa149-npc-de-otra-partida";
  const antesDeInyectar = await foto(ctx);
  const entrega = await ctx.page.evaluate(
    ({ ajena, fantasma }) => {
      const sock = (window.__qaSockets ?? []).find(
        (s) => typeof s.onmessage === "function" && s.readyState === WebSocket.OPEN,
      );
      if (!sock) {
        return { ok: false, motivo: `ningún socket con onmessage: ${(window.__qaSockets ?? []).length} espiados` };
      }
      const base = window.__qaSellos.ultimo;
      if (!base) return { ok: false, motivo: "el espía no vio ningún state_update del que copiar la forma" };
      // Copia FIEL de un frame real (mismos campos, mismo tipo) y solo se le
      // cambia de quién es y a quién mueve: si se fabricara a mano, el frame
      // podría caer por el fail-loud de `playerMaxHp`/`playerWeaponId` y el
      // guion mediría otra cosa.
      const frame = JSON.parse(JSON.stringify(base));
      frame.delSim = { de: "partida", sessionId: ajena };
      frame.npcs = [{ id: fantasma, pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } }];
      sock.onmessage({ data: JSON.stringify(frame) });
      return { ok: true, motivo: "" };
    },
    { ajena: AJENA, fantasma: FANTASMA },
  );
  if (!entrega.ok) ctx.sinMedir(`no se pudo entregar el frame ajeno: ${entrega.motivo}`);
  // Que el bucle corra: si el frame se hubiera aplicado, es en el frame
  // siguiente cuando `aplicarLoQueMandaElBridge` deja su entrada en el registro.
  await esperarMundo(ctx, 5);
  const trasInyectar = await foto(ctx);
  ctx.log(
    `frame AJENO entregado (sello «${AJENA}», NPC «${FANTASMA}»): tirados ` +
      `${antesDeInyectar.tirados} → ${trasInyectar.tirados} · línea «${trasInyectar.lineas.split(" | ").pop()}»`,
  );
  ctx.expect(
    "el state_update de OTRA partida se descarta: el contador sube exactamente uno",
    trasInyectar.tirados === antesDeInyectar.tirados + 1,
    `${antesDeInyectar.tirados} → ${trasInyectar.tirados}`,
  );
  ctx.expect(
    `…y se DICE de quién era: la línea del juego nombra «${AJENA}»`,
    trasInyectar.lineas.includes(`↩ estado de la partida «${AJENA}» descartado`),
    trasInyectar.lineas.slice(-200),
  );
  ctx.expect(
    "el NPC de la otra partida NO entra en este mundo (es la entrada de #659)",
    !trasInyectar.registro.includes(FANTASMA),
    trasInyectar.registro.slice(-300) || "(vacío)",
  );

  // ── 2 · Régimen PRUEBA, llegando desde una partida VIVA ──────────────────
  // El selector «Room» es el control del panel de dev que manda `load_room`, y
  // es el único camino del cliente al otro régimen de direccionamiento de este
  // canal. Si no estuviera a mano con la partida puesta, no hay transición que
  // medir y se dice en vez de inventarla.
  const selectorUsable = await ctx.page.evaluate(() => {
    const s = document.getElementById("room-selector");
    return Boolean(s) && s.offsetParent !== null && s.options.length > 1;
  });
  if (!selectorUsable) {
    ctx.sinMedirBloque(
      "con la partida puesta, el selector «Room» no está disponible: la transición partida→prueba " +
        "no se puede recorrer desde esta página y este bloque no mide nada",
    );
  } else {
    const vistosAntes = trasInyectar.vistos;
    // La BASE del contador ya no es 0: el bloque 1b le sumó, a propósito, el
    // frame ajeno. Lo que este bloque afirma es que NO CRECE más.
    const tiradosBase = trasInyectar.tirados;
    const dichosBase = trasInyectar.descartesDichos;
    await cargarFixture(ctx, PRIMERA);
    await esperarMundo(ctx, 10);
    const enPrueba = await foto(ctx);
    ctx.log(
      `con «${PRIMERA}» puesta sobre la partida: escena «${enPrueba.escena}» · vistos ` +
        `${vistosAntes} → ${enPrueba.vistos} · censo ${JSON.stringify(enPrueba.censo)} · ` +
        `tirados ${enPrueba.tirados} · sesión «${enPrueba.sesion}»`,
    );
    ctx.expect(
      `ocurre: la fixture «${PRIMERA}» se pintó y siguieron llegando state_update`,
      enPrueba.escena === PRIMERA && enPrueba.vistos > vistosAntes,
      `«${enPrueba.escena}» · ${vistosAntes} → ${enPrueba.vistos}`,
    );
    ctx.expect(
      "el sim pasa a firmar PRUEBA en cuanto la página carga la fixture (#659)",
      (enPrueba.censo.prueba ?? 0) > 0,
      JSON.stringify(enPrueba.censo),
    );
    ctx.expect(
      "…y la página EN PARTIDA reconoce como suya esa respuesta: no descarta ni una (la trampa del sello ingenuo)",
      enPrueba.tirados === tiradosBase,
      `${tiradosBase} → ${enPrueba.tirados}`,
    );
    ctx.expect(
      "la línea del juego no gana ningún descarte nuevo al cargar la fixture (el de 1b es el ajeno, a propósito)",
      enPrueba.descartesDichos === dichosBase,
      `${dichosBase} → ${enPrueba.descartesDichos} · ${enPrueba.lineas.slice(0, 200)}`,
    );

    // Una SEGUNDA fixture: el régimen de prueba se sostiene, no fue un
    // accidente del primer `load_room`.
    const vistos2 = enPrueba.vistos;
    await cargarFixture(ctx, SEGUNDA);
    await esperarMundo(ctx, 10);
    const otra = await foto(ctx);
    ctx.log(
      `con «${SEGUNDA}»: escena «${otra.escena}» · vistos ${vistos2} → ${otra.vistos} · ` +
        `censo ${JSON.stringify(otra.censo)} · tirados ${otra.tirados}`,
    );
    ctx.expect(
      `ocurre: la segunda fixture «${SEGUNDA}» se pintó y siguieron llegando state_update`,
      otra.escena === SEGUNDA && otra.vistos > vistos2,
      `«${otra.escena}» · ${vistos2} → ${otra.vistos}`,
    );
    ctx.expect(
      "el contador de descartes no crece tampoco con la segunda carga",
      otra.tirados === tiradosBase,
      `${tiradosBase} → ${otra.tirados}`,
    );
    ctx.expect(
      "y el registro del jugador no ha ganado una entrada de NPC heredado",
      !otra.registro.includes("el bridge mueve al NPC"),
      otra.registro.slice(-300) || "(vacío)",
    );
    await ctx.shot("la-partida-mirando-una-fixture");
  }
}
