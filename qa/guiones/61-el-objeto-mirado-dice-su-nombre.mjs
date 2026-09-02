/** El objeto que miras dice su NOMBRE — y `description` es otra cosa (#238).
 *
 *  Hasta esta tanda la world scene traía cada objeto con `description:
 *  ent.name`: la etiqueta disfrazada de descripción, y la `description` que
 *  el motor hubiera declarado se TIRABA en el wire (el contrato la invitaba en
 *  cualquier entity; el save la conservaba; el cliente no la veía nunca). La
 *  decisión escrita en el issue es «`name` es la etiqueta, `description` es la
 *  PROCEDENCIA»: el texto exacto que se dio al modelo, que viaja verbatim para
 *  poder regenerar el arte con un modelo mejor. Así que el wire pasa a llevar
 *  en `objects[]` el MISMO par que ya llevaba en `npcs[]`, y el rótulo que el
 *  jugador lee al mirar un objeto sale de `name`.
 *
 *  Lo que se mide es lo que ve quien juega, que ningún test de core puede
 *  poner rojo: el lector de core (`session/entidades-del-tile.ts`) prueba que
 *  DEVUELVE `nombre`, pero quien lo pinta es el cliente (`world/carga-de-tile.ts`
 *  → `label`, `main.ts` → `#world-labels`) y `nefan-html` no tiene tests. Tres
 *  bloques sobre `robledo_tile`, la fixture del selector «Room» (cero motor,
 *  cero créditos):
 *
 *   1 · El WIRE: el pozo llega con `name` = «pozo de la plaza» y ningún objeto
 *       de la fixture estrena `description` (hoy 0 de sus 24 entities la
 *       declaran: el wire no la inventa, ni copiando la etiqueta).
 *   2 · El CLIENTE: `__nefan.objects()` rotula el pozo con ese nombre.
 *   3 · La PANTALLA: a 3 m del pozo y mirándolo —yaw hacia él y la mirada
 *       bajada por el ratón, que a esa distancia el brocal queda por debajo del
 *       cono de puntería—, el rótulo `#world-labels [data-label-id="pozo"]`
 *       dice su nombre y la mirilla se enciende.
 *
 *  PROBADO EN NEGATIVO (2026-09-02, sobre el árbol de la tanda), devolviendo a
 *  `formatDToWorld` (`nefan-core/src/scene/scene-normalize.ts`) el emisor
 *  viejo —`description: ent.name` en vez de `name: ent.name, …textoDeclarado(
 *  "description", ent.description)`—, con el resto del árbol como está. Salida
 *  real de `node qa/run.mjs objeto-mirado`:
 *
 *    ✔ precondición: la fixture trae objetos que mirar
 *    ✘ el wire trae el pozo con `name` (la etiqueta) y sin `description` (la
 *      fixture no la declara) — {"id":"pozo","position":[-0.75,0,8.25],
 *      "scale":[0.5,1,0.5],"category":"prop","description":"pozo de la plaza",
 *      "volume_id":"derived_ent_pozo","shape":"cylinder"}
 *    ✘ ningún objeto de robledo_tile estrena `description`: 0 de sus entities
 *      la declaran y el wire no la inventa — 24 la llevan: ["casa_concejo",
 *      "capilla","herreria","posada","molino","establo"]
 *    ✘ todos los objetos del wire llevan `name`: es de donde sale el rótulo —
 *      ["casa_concejo","capilla","herreria","posada","molino","establo"]
 *    ✘ el cliente rotula el pozo con su NOMBRE — label ""
 *    ✘ ERROR: timeout esperando: mirando al pozo, su rótulo aparece en pantalla
 *      y la mirilla se enciende (último valor: null)
 *
 *  El rojo nombra el defecto: el wire vuelve a decir «description» donde toca
 *  «name» (los 24 objetos), el cliente se queda sin rótulo (`label ""`) y el
 *  jugador no ve nombre ni mirilla al mirar el pozo (`main.ts` solo rotula
 *  objetos con `label`). Con el emisor nuevo, los 24 llevan `name` y ninguno
 *  `description`: 8 de 8 asertos verdes.
 */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor. El motivo va en el valor porque hay que escribirlo, se ve en el
 *  diff y dice qué CLASE de guion es. */
export const sinMotor = "cierra el título y carga una fixture del selector; nunca arranca partida";

import { cargarFixture } from "../lib/fixtures.mjs";

/** Un prop del selector «Room» que se puede mirar (no es `building`) y que
 *  otros guiones ya conocen (16, 58): el pozo de la plaza de Robledo. */
const OBJETO = "pozo";
const NOMBRE = "pozo de la plaza";
/** Metros entre el jugador y el pozo para el bloque 3. */
const DISTANCIA_M = 3;
/** La altura del ojo (`EYE_M`, fps-gl.ts) y el centro de un prop de altura
 *  por defecto (1 m): con ellas sale el pitch al que hay que bajar la mirada
 *  para enfilar el brocal, que a 3 m queda 20° por debajo del horizonte. */
const OJO_M = 1.6;
const CENTRO_PROP_M = 0.5;
/** Grados de mirada por píxel de ratón (MOUSE_SENS_RAD_PER_PX de main.ts). */
const GRADOS_POR_PX = (0.0025 * 180) / Math.PI;

/** Mueve el RATÓN hasta que la mirada llega al ángulo pedido (positivo =
 *  arriba). Camino del jugador —movementY bajo pointer lock—, no un setter;
 *  calcado del guion 10. */
function mirarA(ctx, grados) {
  return ctx.waitFor(
    `la mirada llega a ${grados}°`,
    ({ g, gpp }) => {
      const f = window.__nefan.fps();
      if (!f?.ready || typeof f.pitchDeg !== "number") return null;
      const falta = g - f.pitchDeg;
      if (Math.abs(falta) <= 1.5) return { pitchDeg: f.pitchDeg };
      window.__nefan.inputDriver.queueLook(0, -Math.max(-30, Math.min(30, falta)) / gpp);
      return null;
    },
    10_000,
    { g: grados, gpp: GRADOS_POR_PX },
  );
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece al arrancar", () => (document.getElementById("ts-close") ? { hay: true } : null));
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);
  await cargarFixture(ctx, "robledo_tile");

  // ── 1 · El WIRE: `name` es la etiqueta y `description` no se inventa ─────
  const wire = await ctx.page.evaluate((id) => {
    const objetos = window.__nefan.scene?.objects ?? [];
    return {
      total: objetos.length,
      pozo: objetos.find((o) => o.id === id) ?? null,
      conDescription: objetos.filter((o) => "description" in o).map((o) => o.id),
      sinName: objetos.filter((o) => typeof o.name !== "string" || o.name === "").map((o) => o.id),
    };
  }, OBJETO);
  ctx.log(`wire: ${wire.total} objetos · pozo: ${JSON.stringify(wire.pozo)}`);
  ctx.expect("precondición: la fixture trae objetos que mirar", wire.total >= 20, `${wire.total}`);
  ctx.expect(
    "el wire trae el pozo con `name` (la etiqueta) y sin `description` (la fixture no la declara)",
    wire.pozo !== null && wire.pozo.name === NOMBRE && !("description" in wire.pozo),
    JSON.stringify(wire.pozo),
  );
  ctx.expect(
    "ningún objeto de robledo_tile estrena `description`: 0 de sus entities la declaran y el wire no la inventa",
    wire.conDescription.length === 0,
    `${wire.conDescription.length} la llevan: ${JSON.stringify(wire.conDescription.slice(0, 6))}`,
  );
  ctx.expect(
    "todos los objetos del wire llevan `name`: es de donde sale el rótulo",
    wire.sinName.length === 0,
    JSON.stringify(wire.sinName.slice(0, 6)),
  );

  // ── 2 · El CLIENTE: el objeto tiene por rótulo su nombre ────────────────
  const objeto = (await ctx.nefan("objects")).find((o) => o.id === OBJETO) ?? null;
  ctx.expect(
    "el cliente rotula el pozo con su NOMBRE",
    objeto !== null && objeto.label === NOMBRE,
    `label ${JSON.stringify(objeto?.label)}`,
  );
  if (!objeto) return ctx.sinMedirBloque("sin el pozo en el cliente no hay nada que mirar");

  // ── 3 · La PANTALLA: mirándolo, el rótulo dice su nombre ────────────────
  // Al sur del pozo, mirando al norte (yaw 0 = −z, así que el pozo queda a
  // −DISTANCIA en z), y la mirada bajada hasta el centro del brocal.
  await ctx.nefan("setPlayerPos", objeto.pos.x, objeto.pos.z + DISTANCIA_M);
  await ctx.nefan("setYaw", 0);
  const pitch = -(Math.atan2(OJO_M - CENTRO_PROP_M, DISTANCIA_M) * 180) / Math.PI;
  const mirada = await mirarA(ctx, pitch);
  ctx.log(`mirada a ${mirada.pitchDeg.toFixed(1)}° (objetivo ${pitch.toFixed(1)}°)`);

  const etiqueta = await ctx.waitFor(
    "mirando al pozo, su rótulo aparece en pantalla y la mirilla se enciende",
    (id) => {
      const o = window.__nefan.objects().find((x) => x.id === id);
      if (!o) return null;
      // Se re-apunta en cada muestra: la colisión «salir sí, entrar no» puede
      // mover al jugador un poco tras el teletransporte.
      const p = window.__nefan.state().pos;
      window.__nefan.setYaw(Math.atan2(o.pos.x - p.x, o.pos.z - p.z));
      const el = document.querySelector(`#world-labels [data-label-id="${id}"]`);
      if (!el) return null;
      return { texto: el.textContent, focus: el.dataset.focus, mirilla: document.getElementById("reticle")?.dataset.target };
    },
    15_000,
    OBJETO,
  );
  ctx.log(`rótulo: "${etiqueta.texto}" (focus=${etiqueta.focus}, mirilla=${etiqueta.mirilla})`);
  ctx.expect(
    `mirando al pozo su rótulo dice el nombre («${NOMBRE}»), no otra cosa`,
    etiqueta.texto === NOMBRE,
    `"${etiqueta.texto}"`,
  );
  ctx.expect("…y la mirilla está encendida sobre él", etiqueta.mirilla === "true", `mirilla=${etiqueta.mirilla}`);
  await ctx.shot("pozo-mirado");
}
