/** La barra del hostil que te tiene ENGANCHADO cuando te vas por el panel
 *  «Salidas» a otro lugar (pasada adversarial de la QA de la tanda BW,
 *  2026-09-30, H2).
 *
 *  La regla de H2 (`barraDeEnemigoVisible`, core) enseña la barra si el
 *  enemigo está vivo y además te tiene enganchado O está a ≤ 18 m. El enganche
 *  no se suelta hasta que el jugador muere (`EnemyAI`), así que huir de la
 *  pelea por «Salidas» —un viaje de horas que el hostil no puede seguir— deja
 *  su barra en el HUD del destino, que es la foto de H2 («la barra de Brasco
 *  seguía en la Escalinata») por otro camino que el de morir.
 *
 *  LA MEDIDA (la del usuario: «solo se ve cuando ese enemigo está en combate
 *  con el jugador o cerca»): tras el viaje, a decenas de metros y en otro
 *  lugar, la barra del bandido que se quedó atrás NO se ve. Rojo HOY (medido
 *  al escribirlo): hallazgo de la QA para que el coordinador decida si
 *  «enganchado» debe caducar con el viaje o es el diseño.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";
import { viajarSiSePuede } from "../lib/viaje.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["saves", "fake-ai"];

const BANDIDO = "bandido_1";
const frames = esperaDeFotogramas("mundo");

const barra = (ctx) =>
  ctx.page.evaluate((eid) => {
    const vital = document.getElementById(`hp-text-${eid}`)?.parentElement ?? null;
    const e = window.__nefan.enemies().find((x) => x.id === eid);
    const p = window.__nefan.state().pos;
    return {
      oculta: vital ? vital.hidden : null,
      d: e ? Math.hypot(e.pos.x - p.x, e.pos.z - p.z) : null,
      hp: document.getElementById(`hp-text-${eid}`)?.textContent ?? null,
      vivo: e?.alive ?? null,
      tile: window.__nefan.currentTile,
      jugadorHp: document.getElementById("player-hp-text")?.textContent ?? null,
    };
  }, BANDIDO);

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", renderMode: "image" });
  await comenzar(ctx);
  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  // Entrar en su radio (10 m) y dejar que venga y pegue: la prueba de que te
  // tiene enganchado es que te quita vida.
  await acercarse(ctx, BANDIDO, { objetivo: 6, tramos: 14 });
  await ctx.expectEspera(
    "PREMISA: el bandido engancha y pega (la vida del jugador baja de 100)",
    true,
    () => (Number(document.getElementById("player-hp-text")?.textContent ?? "100") < 100 ? true : null),
    { sim: 20 },
  );
  const antes = await barra(ctx);
  ctx.log(`en la pelea: ${JSON.stringify(antes)}`);
  ctx.expect("CONTROL: en la pelea, la barra del bandido se ve", antes.oculta === false, JSON.stringify(antes));

  const ida = await viajarSiSePuede(ctx, "Molino del bench", "el viaje al Molino llega", "el viaje al Molino es la premisa de la medida");
  if (!ida.llegada) ctx.sinMedir(`no se pudo viajar al Molino (${ida.causa})`);
  await frames(ctx, 30);
  const despues = await barra(ctx);
  ctx.log(`en el Molino: ${JSON.stringify(despues)}`);
  await ctx.shot("molino-con-la-barra-del-bandido");
  ctx.expect(
    "tras huir por «Salidas» a otro lugar, la barra del bandido que se quedó atrás NO se ve",
    despues.oculta === true,
    JSON.stringify(despues),
  );
}
