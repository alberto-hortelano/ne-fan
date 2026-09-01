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
 */

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
  const { objetivo = 1.6, tramos = 12, tramoMs = 4_000, lista = "enemies" } = opciones;
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
      `cortafuegos de UN tramo (${tramoMs} ms) del paseo hasta ${id}: el bucle vuelve a medir y ` +
        `el ÚLTIMO tramo afirma este mismo predicado (d ≤ ${objetivo} m), que es donde vive la medida`,
      () =>
        ctx.holdUntil(
          "up",
          `el jugador se acerca a ${id} (tramo ${i + 1}, ahora ${n.d.toFixed(1)} m)`,
          aTiro,
          tramoMs,
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
    { ms: tramoMs, arg, tecla: "up" },
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
 *  Devuelve `{hud, muerto?}`, `{hud, jugadorMuerto:true}` si al que pega lo
 *  matan primero, o `null` si el cortafuegos salta. El `null` NO es un
 *  desenlace mudo: todos los sitios de llamada lo afirman (`ctx.expect`) o lo
 *  declaran (`ctx.sinMedirBloque`), que es lo que hace que la expiración se
 *  vea. */
export async function herirHasta(ctx, id, objetivo, opciones = {}) {
  const { maxMs = 60_000, alcance = 1.6 } = opciones;
  await ctx.nefan("inputDriver.selectAttack", "quick");
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
      maxMs,
      { id, objetivo, alcance },
    )
    .catch(() => null);
  await ctx.nefan("inputDriver.release", "up");
  return fin;
}
