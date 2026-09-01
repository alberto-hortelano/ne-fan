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
 *  la familia de defecto más cara del banco. Aquí el umbral y su holgura se
 *  escriben UNA vez, en el mismo sitio que la espera, y la distancia final se
 *  AFIRMA siempre: quien llama ya no puede olvidarse de mirarla (42 no la
 *  miraba).
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

/** Camina hasta ponerse a `objetivo` metros del objetivo y AFIRMA que llegó.
 *
 *  En tramos porque el otro también se mueve (nos persigue, o hace su vida):
 *  el cortafuegos de cada tramo es un cortafuegos, no la condición de parada,
 *  y que expire no dice nada porque el bucle vuelve a medir. Eso es lo que
 *  `ctx.absorbe` declara — y es legítimo justamente porque al salir del bucle
 *  hay un aserto sobre la distancia FINAL, que es donde vive la medida.
 *
 *  Devuelve la última medición (`{d, dx, dz}`) o `null` si el objetivo ya no
 *  está en la lista. */
export async function acercarse(ctx, id, opciones = {}) {
  const {
    objetivo = 1.6,
    holgura = 1.0,
    tramos = 12,
    tramoMs = 4_000,
    lista = "enemies",
  } = opciones;
  for (let i = 0; i < tramos; i++) {
    const n = await dondeEsta(ctx, id, lista);
    if (!n || n.d <= objetivo) break;
    await ctx.nefan("setYaw", Math.atan2(n.dx, n.dz));
    await ctx.absorbe(
      `cortafuegos de UN tramo (${tramoMs} ms) del paseo hasta ${id}: el bucle vuelve a medir y ` +
        `la distancia FINAL se afirma al salir de él, que es donde vive la medida`,
      () =>
        ctx.holdUntil(
          "up",
          `el jugador se acerca a ${id} (tramo ${i + 1}, ahora ${n.d.toFixed(1)} m)`,
          (a) => {
            const e = window.__nefan[a.lista]().find((x) => x.id === a.id);
            if (!e) return null;
            const p = window.__nefan.state().pos;
            return Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= a.objetivo ? true : null;
          },
          tramoMs,
          { id, objetivo, lista },
        ),
    );
  }
  const fin = await dondeEsta(ctx, id, lista);
  ctx.expect(
    `el jugador LLEGA andando a ${(objetivo + holgura).toFixed(1)} m de ${id} (sin teletransportarse)`,
    Boolean(fin) && fin.d <= objetivo + holgura,
    `distancia final ${fin ? `${fin.d.toFixed(2)} m` : "el objetivo ya no está en la lista"}`,
  );
  return fin;
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
