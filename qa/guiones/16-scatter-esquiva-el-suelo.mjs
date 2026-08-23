/** La vegetación que PLANTA EL MOTOR no cae sobre el camino ni sobre el agua.
 *
 *  Contexto (#174): `vegetation_zones` tiene dos rutas. La del grid ASCII
 *  esquivaba caminos y agua desde siempre; la del blueprint —la que produce
 *  los árboles que se VEN en primera persona y de cuyos troncos sale la
 *  colisión— perdió su exclusión al podar un campo muerto y nadie se enteró:
 *  ningún tile del repo declaraba una zona de vegetación, así que la ruta no
 *  se ejercía. Con una zona declarada, 3 de cada 56 árboles caían sobre la
 *  calzada, y cada uno estampa un disco de tronco de ≥0,9 celdas: ~1 m de
 *  camino real bloqueado por un árbol que el motor nunca puso ahí.
 *
 *  Lo que se comprueba aquí es lo que le pasa a quien juega: que el camino se
 *  puede RECORRER. El recuento de árboles es el síntoma; el tropiezo es el
 *  daño.
 *
 *  Entra por el selector Room (`robledo_tile` es la fixture que declara el
 *  pinar del camino real y el río Negro como agua de `ground`): la vía de
 *  `html-fixtures`, sin motor y sin gastar un crédito.
 *
 *  EN NEGATIVO (probado el 2026-08-23): quitar `if (onGround(u, v)) continue;`
 *  de `nefan-core/src/scene/blueprint/derive.ts` lo pone rojo — 12 de las 249
 *  muestras del eje del camino pasan a bloquear y el jugador no llega a los
 *  16 m: se queda contra un tronco.
 */

/** Espera a que el renderer EMITA frames nuevos: una captura pedida justo
 *  después de mover al jugador fotografía el frame ANTERIOR (la cámara se
 *  actualiza en el bucle, no en el setter) — así salían dos fotos idénticas
 *  desde posiciones distintas. Se espera por el contador de frames, nunca por
 *  reloj. */
async function esperarFrames(ctx, n = 3) {
  const antes = (await ctx.nefan("fps")).frames;
  await ctx.waitFor(
    `${n} frames nuevos`,
    ({ f0, n }) => (window.__nefan.fps().frames >= f0 + n ? true : null),
    10_000,
    { f0: antes, n },
  );
}

/** Sin bridge (preset `html-fixtures`) el arranque de partida falla a
 *  propósito y el jugador ve el muro de error — y tarda 5 s en salir, así que
 *  puede aparecer DESPUÉS de cargar la fixture. Se cierra por SU botón, como
 *  haría una persona (nada de display:none), justo antes de cada captura.
 *  Con bridge el muro no existe y esto no hace nada. */
async function cerrarMuroSiHay(ctx) {
  await ctx.page.evaluate(() => {
    const muro = document.getElementById("narrative-loader");
    if (muro?.classList.contains("error")) document.getElementById("narrative-loader-dismiss")?.click();
  });
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece al arrancar", () => (document.getElementById("ts-close") ? { hay: true } : null));
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  await ctx.nefan("loadFixture", "robledo_tile");
  await ctx.waitFor("la fixture carga", () => (window.__nefan.status().scene ? true : null));
  await ctx.waitFor(
    "el mundo 3D instala el tile",
    () => {
      const f = window.__nefan.fps();
      return f && f.ready && f.activeTile ? f : null;
    },
    20_000,
  );

  // ── 1. La fixture declara lo que este guion dice mirar ───────────────────
  // Sin zona de vegetación no hay nada que esquivar y el guion sería un verde
  // vacío; sin camino declarado, tampoco. Se exige que estén.
  const plano = await ctx.page.evaluate(() => {
    const s = window.__nefan.scene;
    const g = s.terrain_grid;
    return {
      scene_id: s.scene_id,
      ground: s.ground ?? [],
      zonas: (s.__format_d?.vegetation_zones ?? s.vegetation_zones ?? []).length,
      origin: g?.origin ?? null,
      mpc: g?.meters_per_cell ?? null,
    };
  });
  const camino = plano.ground.find((f) => f.kind === "path" && f.id === "camino_real");
  const aguas = plano.ground.filter((f) => f.kind === "water");
  ctx.log(`escena ${plano.scene_id} · ${plano.zonas} zona(s) de vegetación · ${aguas.length} masas de agua`);
  ctx.expect("la fixture declara una zona de vegetación (si no, no hay nada que esquivar)", plano.zonas > 0, `${plano.zonas}`);
  ctx.expect("la fixture declara el camino real como `ground`", Boolean(camino), JSON.stringify(camino ?? null));
  ctx.expect("la fixture declara el río como agua de `ground`", aguas.length > 0, `${aguas.length}`);
  if (!camino || !plano.origin) return;

  // ── 2. El eje del camino está LIBRE de punta a punta ─────────────────────
  // Muestreo cada media celda sobre la línea que declaró el motor: la
  // colisión del jugador no puede bloquear en ninguna. Incluye el tramo del
  // puente, que es deck sobre agua.
  const eje = await ctx.page.evaluate(
    ({ camino, origin, mpc }) => {
      const [ox, oz] = origin;
      const y = camino.points[0][1];
      const bloqueadas = [];
      let total = 0;
      for (let c = 2; c <= 126; c += 0.5) {
        total++;
        if (window.__nefan.probeCollide(ox + c * mpc, oz + y * mpc)) bloqueadas.push(c);
      }
      return { total, bloqueadas, y };
    },
    { camino, origin: plano.origin, mpc: plano.mpc },
  );
  ctx.log(`eje del camino (fila ${eje.y}): ${eje.bloqueadas.length}/${eje.total} muestras bloqueadas`);
  ctx.expect(
    "ninguna muestra del eje del camino real bloquea al jugador",
    eje.bloqueadas.length === 0,
    `bloquean en las celdas ${JSON.stringify(eje.bloqueadas.slice(0, 8))}`,
  );

  // ── 3. …y se nota andando, que es como se encuentra el jugador el tronco ─
  // Del extremo oeste del camino hacia el este: si un árbol derivado se
  // hubiera plantado encima, el avance se para en seco antes de la meta.
  const [ox, oz] = plano.origin;
  const zCamino = oz + eje.y * plano.mpc;
  const xSalida = ox + 6 * plano.mpc;
  const META_M = 16;
  await ctx.nefan("setPlayerPos", xSalida, zCamino);
  await ctx.nefan("setYaw", Math.PI / 2); // este
  ctx.expect("el punto de partida del camino está libre", (await ctx.nefan("probeCollide", xSalida, zCamino)) === false);

  const avance = await ctx
    .holdUntil(
      "up",
      `el jugador recorre ${META_M} m de calzada`,
      ({ x0, meta }) => {
        const p = window.__nefan.state().pos;
        return p.x - x0 >= meta ? p : null;
      },
      60_000,
      { x0: xSalida, meta: META_M },
    )
    .catch((err) => {
      ctx.expect(`el jugador recorre ${META_M} m de camino real sin tropezar`, false, err.message);
      return null;
    });
  if (avance) {
    ctx.log(`avanzó ${(avance.x - xSalida).toFixed(1)} m por la calzada`);
    ctx.expect(
      `el jugador recorre ${META_M} m de camino real sin tropezar`,
      avance.x - xSalida >= META_M,
      `${(avance.x - xSalida).toFixed(2)} m`,
    );
  }
  await cerrarMuroSiHay(ctx);
  await esperarFrames(ctx);
  await ctx.shot("camino-real-despejado");

  // ── 4. El pinar SÍ existe a los lados: la exclusión no vació la zona ─────
  // Un arreglo que borrase la vegetación entera también dejaría el camino
  // libre, y sería peor que el bug. Se mira desde el jugador: girado al
  // norte, con el pinar delante, tiene que haber suelo ocupado cerca.
  const alrededor = await ctx.page.evaluate(
    ({ ox, oz, mpc, y }) => {
      let ocupadas = 0;
      let total = 0;
      // Banda de 6 celdas a cada lado del camino, fuera de su ancho: ahí es
      // donde el pinar tiene que estar.
      for (let c = 4; c <= 46; c += 1) {
        for (const dy of [-9, -7, 7, 9]) {
          total++;
          if (window.__nefan.probeCollide(ox + c * mpc, oz + (y + dy) * mpc)) ocupadas++;
        }
      }
      return { ocupadas, total };
    },
    { ox, oz, mpc: plano.mpc, y: eje.y },
  );
  ctx.log(`arcenes del pinar: ${alrededor.ocupadas}/${alrededor.total} muestras ocupadas`);
  ctx.expect(
    "el pinar sigue plantado a los lados (la exclusión aparta, no vacía)",
    alrededor.ocupadas > 0,
    `${alrededor.ocupadas}/${alrededor.total}`,
  );

  // La otra mitad de la regla, en foto: el río Negro (agua declarada en
  // `ground` desde este arreglo, y por eso PINTADA) con el puente de tablones
  // y ni un árbol encima. Desde la orilla oeste, mirando al este.
  await ctx.nefan("setPlayerPos", ox + 74 * plano.mpc, oz + eje.y * plano.mpc);
  await ctx.nefan("setYaw", Math.PI / 2);
  await cerrarMuroSiHay(ctx);
  await esperarFrames(ctx);
  await ctx.shot("rio-y-puente-sin-arboles");
}
