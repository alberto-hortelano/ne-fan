/** Un caído no anda ni explora, y explorar GASTA (#613, QA S2 de la tanda BN).
 *
 *  La segunda vuelta de QA leyó en el código que el caído era un fantasma que
 *  anda: el paso del jugador del cliente no miraba si estaba muerto, la cámara
 *  caminaba, la frontera seguía y un caído podía aceptar con Y un tile nuevo —
 *  y el bridge tampoco rechazaba `request_tile` de un caído, así que en
 *  producción eso PAGABA una escena. Las dos puertas, cada una con su medida:
 *
 *   1 · CLIENTE: caído, con la tecla de avanzar pulsada, la posición no se
 *       mueve (el paso y la frontera no corren: `jugadorCaido` en `main.ts`,
 *       derivado de `elJugadorEsperaDespertar` de core);
 *   2 · BRIDGE: caído, un `request_tile` de un tile que no existe —por el
 *       cable, como lo mandaría una Y— NO llega al motor: el contador de
 *       `/generate_scene` del motor falso no se mueve.
 *
 *  El motor tarda en decidir para que haya tiempo de medir con el jugador
 *  caído. `mundo` en `aisla`: con el snapshot pre-generado el bridge sirve un
 *  tile sin llamar al motor y el contador no diría nada.
 *
 *  EN NEGATIVO (tanda BN): sin `jugadorCaido` en el paso del cliente, 1 es
 *  rojo; sin `rechazarSiEstaCaido` en el `request_tile` del router, 2 es rojo.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar } from "../lib/combate.mjs";
import { porElCable } from "../lib/cable.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves", "mundo", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
/** Un tile lejos de todo lo generado: pedirlo es pagar una escena. */
const LEJOS = { tx: 7, ty: 7 };

async function escenasPedidas() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const { gasto } = await res.json();
  return gasto?.rutas?.["/generate_scene"] ?? 0;
}

export default async function (ctx) {
  await conductaDelDespertar(ctx, "tarda", 60_000);
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  await comenzar(ctx);

  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  await acercarse(ctx, BANDIDO, { objetivo: 1.2, tramos: 14 });
  const muerto = await ctx.absorbe(
    "cortafuegos de la espera a que el bandido mate al jugador: PRECONDICIÓN; si expira se declara ⊘",
    () =>
      ctx.waitFor(
        "el bandido mata al jugador",
        () => (Number(document.getElementById("player-hp-text")?.textContent ?? "NaN") === 0 ? true : null),
        { sim: 120 },
      ),
  );
  if (!muerto) ctx.sinMedir("el bandido no mató al jugador en 120 s de simulación");
  await ctx.waitFor(
    "caído, el velo dice que el mundo decide",
    () => (document.getElementById("velo-del-despertar")?.hidden === false ? true : null),
    { sim: 2 },
  );

  // ── 1 · el cliente: un caído no anda ──────────────────────────────────────
  const cayo = await ctx.nefan("state");
  await ctx.expectEspera(
    "caído y con la tecla de avanzar pulsada, el jugador se MUEVE (sería un fantasma que anda)",
    false,
    (a) => {
      const p = window.__nefan.state().pos;
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      return d > 0.05 ? { d } : null;
    },
    { sim: 2, tecla: "up", arg: cayo.pos },
  );

  // ── 2 · el bridge: un caído no explora (y explorar GASTA) ─────────────────
  const antes = await escenasPedidas();
  await porElCable(ctx, { type: "request_tile", tx: LEJOS.tx, ty: LEJOS.ty, reason: "blocking", edge: "east" }, () =>
    ctx.absorbe(
      "dejar al bridge el tiempo de llamar al motor si fuera a hacerlo; la medida es el contador, abajo",
      () => ctx.waitFor("tres segundos de mundo con el cable abierto", () => null, { sim: 3 }),
    ),
  );
  const despues = await escenasPedidas();
  ctx.expect(
    `caído, un request_tile de (${LEJOS.tx}, ${LEJOS.ty}) no llega al motor: no se paga ninguna escena`,
    despues === antes,
    `/generate_scene: ${antes} → ${despues}`,
  );
  await ctx.shot("caido-quieto");
}
