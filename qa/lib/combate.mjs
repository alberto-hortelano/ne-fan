/** Los dos gestos de combate que todo guion de pelea repite: acercarse andando
 *  y pegar hasta bajar la vida.
 *
 *  POR QUÉ VIVEN AQUÍ. `acercarse` estaba copiado en CINCO guiones (41, 42,
 *  48, 49, 50) y `herirHasta` en TRES (42, 48, 49) — y no por descuido: cada
 *  guion nuevo se escribió copiando al anterior. Ahí nacieron 14 de los 27
 *  casos vivos del censo de #261, así que arreglar las cinco copias y dejar el
 *  molde suelto era garantizar la sexta.
 *
 *  Y hay un motivo que no es solo higiene: el UMBRAL. La copia de 41 esperaba
 *  a ponerse a 1,6 m y el aserto de su sitio de llamada admitía 2,6 — una
 *  banda garantizada de «la espera expira y el guion sale verde igual», que es
 *  la familia de defecto más cara del banco. Aquí hay UN umbral y UN
 *  predicado: el que esperan los tramos es el que afirma el último, en el
 *  mismo instante en que lo sondea. No queda holgura porque no queda hueco.
 *  Y se afirma siempre, así que quien llama ya no puede olvidarse de mirarlo
 *  (42 no lo miraba).
 *
 *  Ambos caminan por el camino del jugador —yaw + tecla de avance—, nunca
 *  `setPlayerPos`: teletransportarse sería fabricar el escenario que el guion
 *  viene a medir.
 *
 *  Y LOS DOS PRESUPUESTAN EN SEGUNDOS DE MUNDO, no de pared (#545). Andar y
 *  pegar son las dos cosas del banco que dependen del `delta` del game loop, y
 *  ese delta está topado en 0,1 s por frame: bajo carga el jugador avanza menos
 *  metros por segundo de RELOJ aunque su velocidad no haya cambiado, así que un
 *  cortafuegos de «4.000 ms» dejaba de ser un cortafuegos y pasaba a ser la
 *  condición de parada — que es exactamente lo que #545 vino a arreglar. Con
 *  `{sim: 4}` se esperan cuatro segundos de MUNDO, los tarde la máquina lo que
 *  tarde, y si el mundo no llega a correrlos la espera declara ⊘ en vez de
 *  afirmar que el jugador no llegó (ver `qa/lib/sonda.mjs`).
 *
 *  **Ni un umbral, ni un aserto, ni un canal han cambiado con ese paso**: los
 *  metros son los mismos, el predicado es el mismo y la vida se sigue leyendo
 *  del HUD. Lo único que cambia es CON QUÉ RELOJ se espera.
 */

import { esperaExpiradaEn } from "./esperas.mjs";

/** Las opciones que este helper entiende, o LANZA.
 *
 *  Existe por el hallazgo H-3 de QA, y es la clase de defecto más barata de
 *  cometer que hay aquí: cuando `herirHasta` pasó de `maxMs` (milisegundos de
 *  pared) a `sim` (segundos de mundo), **tres sitios de llamada se quedaron
 *  escribiendo `maxMs`** y JavaScript se los tragó — una clave desconocida en
 *  un objeto de opciones se desestructura en silencio y el helper usa su
 *  defecto. El del guion 49 pedía `maxMs: 120_000` y se quedó con `sim: 60`:
 *  medio presupuesto, sin que nadie lo escribiera, y su resultado gobierna un
 *  `ctx.sinMedir` que degrada la corrida entera a exit 2.
 *
 *  El arreglo no es corregir los tres —eso ya está hecho— sino que el estado
 *  malo deje de ser expresable: escribir una opción que no existe para. Y dice
 *  cuáles hay, porque el que se equivoca está mirando el sitio de llamada, no
 *  este fichero. */
function soloEstasOpciones(quien, opciones, conocidas) {
  const desconocidas = Object.keys(opciones).filter((k) => !conocidas.includes(k));
  if (desconocidas.length) {
    throw new Error(
      `${quien}: opción(es) que no existen: ${desconocidas.map((k) => `\`${k}\``).join(", ")}. ` +
        `Las que hay son ${conocidas.map((k) => `\`${k}\``).join(", ")}. ` +
        `Ojo con \`maxMs\`: murió con #545 y su sustituto es \`sim\`, que son SEGUNDOS DE MUNDO, no ` +
        `milisegundos de pared — escribirlo en silencio dejaba el presupuesto en el defecto.`,
    );
  }
}

/** Dónde está el objetivo respecto al jugador, en metros. `lista` es la del
 *  hook (`enemies` o `npcs`): el mismo paseo sirve para pelear y para hablar. */
function dondeEsta(ctx, id, lista) {
  return ctx.page.evaluate(
    ([q, l]) => {
      const e = window.__nefan[l]().find((x) => x.id === q);
      if (!e) return null;
      const p = window.__nefan.state().pos;
      return { d: Math.hypot(e.pos.x - p.x, e.pos.z - p.z), dx: e.pos.x - p.x, dz: e.pos.z - p.z };
    },
    [id, lista],
  );
}

/** Camina hasta ponerse a `objetivo` metros del objetivo y AFIRMA que llegó,
 *  con EL MISMO predicado con el que esperó.
 *
 *  En tramos porque el otro también se mueve (nos persigue, o hace su vida):
 *  el cortafuegos de cada tramo es un cortafuegos, no la condición de parada, y
 *  que expire no dice nada porque el bucle vuelve a medir. Eso es lo que
 *  `ctx.absorbe` declara — y es legítimo porque **el último tramo no se
 *  absorbe: se afirma**.
 *
 *  Y se afirma el predicado, no una relectura de la distancia. La primera
 *  versión de esta tanda hacía lo segundo —esperar a `d ≤ 1,6` y luego afirmar
 *  `d ≤ 2,6` sobre una medida nueva— y eso es exactamente la banda de «la
 *  espera expira y el guion sale verde igual» que abrió #261, con los mismos
 *  números que la crítica llamó defecto; lo cazó QA el 2026-09-01. La holgura
 *  existía para tapar lo que el objetivo se mueve entre el último sondeo y la
 *  relectura: si en vez de releer se AFIRMA el sondeo, no hay hueco que tapar y
 *  no hace falta holgura ninguna. Un predicado, un umbral, un instante.
 *
 *  Si el objetivo ya está dentro de `objetivo` metros, el aserto se cumple en
 *  el primer sondeo y no se anda: no cuesta un tramo de más.
 *
 *  Devuelve la última medición (`{d, dx, dz}`) o `null` si el objetivo ya no
 *  está en la lista. */
export async function acercarse(ctx, id, opciones = {}) {
  soloEstasOpciones("acercarse", opciones, ["objetivo", "tramos", "tramoSim", "lista"]);
  const { objetivo = 1.6, tramos = 12, tramoSim = 4, lista = "enemies" } = opciones;
  const arg = { id, objetivo, lista };
  /** EL predicado. Lo comparten los cortafuegos y el aserto del final. */
  const aTiro = (a) => {
    const e = window.__nefan[a.lista]().find((x) => x.id === a.id);
    if (!e) return null;
    const p = window.__nefan.state().pos;
    const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
    return d <= a.objetivo ? { d } : null;
  };
  /** Encara al objetivo y dice a qué distancia está. */
  const encarar = async () => {
    const n = await dondeEsta(ctx, id, lista);
    if (n && n.d > objetivo) await ctx.nefan("setYaw", Math.atan2(n.dx, n.dz));
    return n;
  };

  // Tramos de aproximación: cortafuegos, absorbidos.
  for (let i = 0; i < tramos - 1; i++) {
    const n = await encarar();
    if (!n || n.d <= objetivo) break;
    await ctx.absorbe(
      `cortafuegos de UN tramo (${tramoSim} s de simulación) del paseo hasta ${id}: el bucle vuelve a ` +
        `medir y el ÚLTIMO tramo afirma este mismo predicado (d ≤ ${objetivo} m), que es donde vive la medida`,
      () =>
        ctx.holdUntil(
          "up",
          `el jugador se acerca a ${id} (tramo ${i + 1}, ahora ${n.d.toFixed(1)} m)`,
          aTiro,
          { sim: tramoSim },
          arg,
        ),
    );
  }

  // Y el ÚLTIMO tramo AFIRMA, con el mismo predicado y el mismo umbral.
  await encarar();
  await ctx.expectEspera(
    `el jugador LLEGA andando a ${objetivo} m de ${id} (sin teletransportarse)`,
    true,
    aTiro,
    { sim: tramoSim, arg, tecla: "up" },
  );
  return dondeEsta(ctx, id, lista);
}

/** Pega hasta dejar al objetivo por debajo de `objetivo` de vida en el HUD.
 *
 *  Se re-encara y se cierra la distancia atacando, como quien juega: el golpe
 *  tiene wind-up y el enemigo se mueve, así que un solo click puede fallar sin
 *  que eso signifique nada. La condición de parada es la vida DEL HUD —lo que
 *  ve el jugador—, no un reloj ni un número de intentos.
 *
 *  `sim` son SEGUNDOS DE MUNDO de cortafuegos (#545): pegar depende del `delta`
 *  del loop —wind-up, recuperación, daño por golpe—, así que contarlos en
 *  milisegundos de pared era contar el reloj equivocado.
 *
 *  Devuelve `{hud, muerto?}`, `{hud, jugadorMuerto:true}` si al que pega lo
 *  matan primero, o `null` si el cortafuegos salta. El `null` NO es un
 *  desenlace mudo: todos los sitios de llamada lo afirman (`ctx.expect`) o lo
 *  declaran (`ctx.sinMedirBloque`), que es lo que hace que la expiración se
 *  vea. Y no cubre el ⊘: si el mundo no llegó a correr los segundos pedidos,
 *  eso sube y para el guion. */
export async function herirHasta(ctx, id, objetivo, opciones = {}) {
  soloEstasOpciones("herirHasta", opciones, ["sim", "alcance"]);
  const { sim = 60, alcance = 1.6 } = opciones;
  await ctx.nefan("inputDriver.selectAttack", "quick");
  // La tecla se suelta SIEMPRE, también cuando sube un ⊘ (H-5 de QA). Antes el
  // `.catch(() => null)` garantizaba llegar al `release`; ahora el ⊘ pasa de
  // largo, y sin el `finally` el guion se iba a ⊘ con el jugador andando — la
  // captura y el diagnóstico se tomaban de un jugador en marcha. `holdUntil` ya
  // tenía el suyo; esta es la asimetría que faltaba dentro del mismo fichero.
  try {
    return await golpearHasta(ctx, id, objetivo, { sim, alcance });
  } finally {
    await ctx.nefan("inputDriver.release", "up");
  }
}

/** El bucle de golpes, sin el cuidado de soltar la tecla: eso lo hace su
 *  envoltorio, que es quien puede prometerlo pase lo que pase. */
async function golpearHasta(ctx, id, objetivo, { sim, alcance }) {
  const fin = await ctx
    .waitFor(
      `la vida de ${id} baja de ${objetivo} en el HUD`,
      (a) => {
        const e = window.__nefan.enemies().find((x) => x.id === a.id);
        const p = window.__nefan.state().pos;
        const drv = window.__nefan.inputDriver;
        if (e && p) {
          window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
          if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > a.alcance) drv.press("up");
          else drv.release("up");
          drv.queueAttack();
        }
        const el = document.getElementById(`hp-text-${a.id}`);
        if (!el) return null;
        const n = Number(el.textContent);
        if (Number.isFinite(n) && n <= a.objetivo) return { hud: n, muerto: n <= 0 };
        // El jugador muerto deja de poder pegar: se corta aquí para que el
        // rojo diga «te mataron» y no agote el cortafuegos en silencio.
        if (Number(document.getElementById("player-hp-text")?.textContent ?? 0) <= 0) {
          return { hud: n, jugadorMuerto: true };
        }
        return null;
      },
      { sim },
      { id, objetivo, alcance },
    )
    // Solo se traga la EXPIRACIÓN, que es el cortafuegos que este helper
    // declara devolver como `null` y que todos sus sitios de llamada afirman.
    // El ⊘ de «el mundo no llegó a correr los segundos pedidos» NO es un
    // desenlace de la pelea y tiene que subir hasta el runner: convertirlo aquí
    // en `null` sería volver a colapsar «no pude medir» con «no lo maté», que es
    // la mentira que cuesta una investigación entera cada vez.
    .catch((err) => {
      if (esperaExpiradaEn(err)) return null;
      throw err;
    });
  return fin;
}
