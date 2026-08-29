/** La vegetación que PLANTA EL MOTOR no cae sobre el camino ni sobre el agua.
 *
 *  Contexto (#174): `vegetation_zones` tiene dos rutas. La del grid ASCII
 *  esquivaba caminos y agua desde siempre; la del blueprint —la que produce
 *  los árboles que se VEN en primera persona y de cuyos troncos sale la
 *  colisión— perdió su exclusión al podar un campo muerto y nadie se enteró:
 *  ningún tile del repo declaraba una zona de vegetación, así que la ruta no
 *  se ejercía. En el caso de referencia del issue (una zona `rest` al 0,5)
 *  caían 3 de 48 árboles sobre la calzada, y cada uno estampa un disco de
 *  tronco de ≥0,9 celdas: ~1 m de camino real bloqueado por un árbol que el
 *  motor nunca puso ahí.
 *
 *  Lo que se comprueba aquí es lo que le pasa a quien juega: que el camino se
 *  puede RECORRER. El recuento de árboles es el síntoma; el tropiezo es el
 *  daño.
 *
 *  Entra por el selector Room (`robledo_tile` es la fixture que declara el
 *  pinar del camino real y el río Negro como agua de `ground`): la vía de
 *  `html-fixtures`, sin motor y sin gastar un crédito.
 *
 *  EN NEGATIVO (re-probado el 2026-08-23 con la fixture al 0,05): quitar
 *  `if (onGround(u, v)) continue;` de
 *  `nefan-core/src/scene/blueprint/derive.ts` lo pone rojo — muestras del eje
 *  del camino pasan a bloquear y el jugador no llega a los 16 m: se queda
 *  contra un tronco. Y el paso 4 lo pone rojo por el otro lado: una exclusión
 *  que VACIARA la zona deja el camino libre y el pinar sin un solo árbol.
 */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor, así que el runner no lo gatea. El motivo va en el valor y no en
 *  un booleano porque hay que escribirlo, se ve en el diff y dice qué CLASE
 *  de guion es. */
export const sinMotor = "cierra el título y carga una fixture del selector; nunca arranca partida";

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

  // ── 4. El pinar SÍ existe, y cada árbol FRENA: aparta, no vacía ─────────
  // Un arreglo que borrase la vegetación entera también dejaría el camino
  // libre, y sería peor que el bug. Se mira sobre el plan que el juego ha
  // compuesto —los árboles que el motor no puso a mano— y se toca uno a uno:
  // cada tronco tiene que frenar al jugador. Muestrear una banda a ciegas
  // dependía de que hubiera MUCHOS árboles: bastaba bajar la densidad de la
  // fixture para que el paso se quedara sin nada que encontrar y se pusiera
  // rojo (o, con la exclusión rota, verde por casualidad).
  const pinar = await ctx.page.evaluate(
    ({ ox, oz, mpc, y }) => {
      const vols = (window.__nefan.scene?.__plan?.volumes ?? []).filter((v) => String(v.id).startsWith("derived_veg_"));
      return vols.map((v) => ({
        id: v.id,
        at: v.at,
        distanciaAlEje: Math.abs(v.at[1] - y),
        choca: window.__nefan.probeCollide(ox + v.at[0] * mpc, oz + v.at[1] * mpc),
      }));
    },
    { ox, oz, mpc: plano.mpc, y: eje.y },
  );
  ctx.log(`pinar derivado: ${pinar.length} árbol(es) · ${pinar.map((p) => p.at.join(",")).join(" · ")}`);
  ctx.expect(
    "la exclusión aparta, no vacía: el pinar sigue teniendo árboles",
    pinar.length > 0,
    `${pinar.length}`,
  );
  const blandos = pinar.filter((p) => !p.choca);
  ctx.expect(
    "cada árbol del pinar frena al jugador (es tronco, no decorado)",
    blandos.length === 0,
    JSON.stringify(blandos),
  );
  // Y ninguno en la calzada — el paso 2 lo mira por muestreo del eje; esto lo
  // dice sobre el árbol concreto, que es lo que se lee en el informe.
  const enCalzada = pinar.filter((p) => p.distanciaAlEje <= 2.5);
  ctx.expect(
    "ningún árbol del pinar está plantado dentro de la banda del camino",
    enCalzada.length === 0,
    JSON.stringify(enCalzada),
  );

  // ── 5. Lo que el motor colocó A MANO sobre un camino sigue ahí ───────────
  // La exclusión entra SOLO en el bucle de `vegetation_zones`. Si algún día se
  // aplicara también a `structures`/`entities`, el pozo que el motor puso en
  // la plaza —declarado a caballo de `camino_plaza` y `camino_herreria`—
  // desaparecería SIN QUE NADA SE PUSIERA ROJO: el camino saldría aún más
  // despejado y los pasos 2 y 3 seguirían verdes. Es la pérdida silenciosa de
  // geometría declarada, y por eso se mira aquí y no en la unidad: el jugador
  // se topa con el brocal, no con un array.
  const declarado = await ctx.page.evaluate(
    ({ mpc }) => {
      const s = window.__nefan.scene;
      const obj = (s.objects ?? []).find((o) => o.id === "pozo");
      const g = s.terrain_grid;
      const [ox, oz] = g.origin;
      // ¿De verdad está sobre un camino declarado? Si alguien mueve el pozo o
      // el camino, esta comprobación deja de significar nada — así que se
      // afirma, no se supone.
      const sobre = (s.ground ?? [])
        .filter((f) => f.kind === "path")
        .filter((f) => {
          const w = (f.w ?? 4) / 2 + 0.5;
          const u = obj ? (obj.position[0] - ox) / mpc : NaN;
          const v = obj ? (obj.position[2] - oz) / mpc : NaN;
          return f.points.some((_, i) => {
            if (i + 1 >= f.points.length) return false;
            const [ax, az] = f.points[i];
            const [bx, bz] = f.points[i + 1];
            const dx = bx - ax;
            const dz = bz - az;
            const len2 = dx * dx + dz * dz || 1e-9;
            const t = Math.min(1, Math.max(0, ((u - ax) * dx + (v - az) * dz) / len2));
            const px = ax + dx * t;
            const pz = az + dz * t;
            return (u - px) * (u - px) + (v - pz) * (v - pz) < w * w;
          });
        })
        .map((f) => f.id);
      return {
        hay: Boolean(obj),
        pos: obj ? [obj.position[0], obj.position[2]] : null,
        sobre,
        choca: obj ? window.__nefan.probeCollide(obj.position[0], obj.position[2]) : false,
      };
    },
    { mpc: plano.mpc },
  );
  ctx.log(`pozo declarado a mano: ${declarado.hay ? "presente" : "AUSENTE"} · sobre ${JSON.stringify(declarado.sobre)}`);
  ctx.expect(
    "el pozo de la plaza está declarado ENCIMA de un camino (si no, este paso no prueba nada)",
    declarado.sobre.length > 0,
    JSON.stringify(declarado),
  );
  ctx.expect("el pozo que el motor puso a mano sobre el camino sigue en la escena", declarado.hay, JSON.stringify(declarado.pos));
  ctx.expect(
    "…y sigue siendo sólido (la exclusión no se comió su volumen)",
    declarado.choca,
    JSON.stringify(declarado),
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
