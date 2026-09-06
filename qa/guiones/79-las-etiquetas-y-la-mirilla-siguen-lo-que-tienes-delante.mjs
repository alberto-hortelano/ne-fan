/** Lo que el jugador lee sobre las cabezas y lo que enciende la mirilla,
 *  medido por ESTADO del DOM, en todos los estados que el corte 2 de #358
 *  movió a `ui/etiquetas-del-mundo.ts` (escrito por QA al validar ese corte).
 *
 *  Los guiones 10 y 61 ya afirman el caso feliz (el NPC mirado, el pozo
 *  mirado); este cubre la FRONTERA de la conducta, que es donde un movimiento
 *  de código deja de ser un movimiento sin que nadie lo vea:
 *
 *   0. Con el TÍTULO delante y sin escena, ni un rótulo ni mirilla encendida
 *      (el bucle ya corre y `actualizar()` tiene que aguantar un mundo vacío).
 *   1. En partida (motor falso, tile_0_0): el NPC y el ENEMIGO reciben rótulo
 *      por su nombre —el 42 lleva desde el 08-29 logueando como hallazgo que
 *      «el enemigo no recibe rótulo»; aquí se afirma lo que hace el juego de
 *      hoy—; el rótulo de un personaje aparece a ≤ 18 m y NO a más de 18 m; la
 *      mirilla se enciende al enfilar a un personaje y ese rótulo, y solo ese,
 *      lleva `data-focus`; con la mirada al cielo la mirilla se apaga y el
 *      rótulo por distancia se queda; un EDIFICIO no enciende la mirilla ni se
 *      rotula; con la CONVERSACIÓN delante se retiran todos y la mirilla se
 *      apaga, y al cerrarla vuelven.
 *   2. Adversarial, por la puerta de fixtures del bench (`loadSceneRaw`, la
 *      misma que usa el selector «Room»; el motor falso no declara estas
 *      formas): un tile sin personajes ni objetos deja el DOM limpio; un
 *      objeto con un nombre de 100 caracteres se recorta a 42 con «…»; un NPC
 *      declarado SIN nombre se rotula por su id (`n.name ?? n.label ?? n.id`)
 *      o se dice por qué no está.
 *
 *  Nunca lee píxeles: los rótulos son `#world-labels [data-label-id]` y la
 *  mirilla `#reticle[data-target]`, lo mismo que miran el 10 y el 61. Las
 *  esperas son por estado (el frame que sincroniza las etiquetas va DESPUÉS de
 *  `render()`, así que tras mover al jugador hay que esperar a que el bucle
 *  pase, no leer en el acto).
 *
 *  PROBADO EN NEGATIVO (2026-09-06, sobre `5fe0ec1b`): con
 *  `LABEL_RANGE_M = 18` cambiado a 30 en `ui/etiquetas-del-mundo.ts`, el
 *  aserto «a más de 18 m NO hay rótulo» se pone rojo; con el filtro
 *  `o.volumeType !== "building"` quitado, el edificio enciende la mirilla y
 *  el aserto del bloque «edificio» se pone rojo; con el `if (dialogoAbierto())`
 *  anulado, los rótulos siguen puestos con la conversación delante y se pone
 *  rojo. Cero créditos: motor falso.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

export const aisla = ["fake-ai"];

const NPC = "barkeep";
const NPC_NOMBRE = "Tabernero corpulento";
const ENEMIGO = "bandido_1";
const ENEMIGO_NOMBRE = "Bandido de camino";
const EDIFICIO = "casa_lenador";
/** Alcance del rótulo de un personaje (`LABEL_RANGE_M`, ui/etiquetas-del-mundo.ts). */
const ALCANCE_M = 18;
/** Recorte del rótulo (`LABEL_MAX_CHARS`). */
const MAX_CHARS = 42;
/** Alcance de la tecla E (`INTERACT_RANGE_M`, main.ts): a un paso. */
const A_UN_PASO = 1.2;
/** Altura del ojo (`EYE_M`, fps-gl.ts) y centro de un prop de altura por defecto. */
const OJO_M = 1.6;
const CENTRO_PROP_M = 0.5;
/** Grados de mirada por píxel de ratón (MOUSE_SENS_RAD_PER_PX de main.ts). */
const GRADOS_POR_PX = (0.0025 * 180) / Math.PI;

const AQUI = dirname(fileURLToPath(import.meta.url));
const ROBLEDO = join(AQUI, "..", "..", "nefan-core", "data", "scenes", "robledo_tile.json");

/** Lo que el jugador tiene delante AHORA: rótulos colocados y mirilla. */
function foto() {
  const labels = Array.from(document.querySelectorAll("#world-labels [data-label-id]")).map((n) => ({
    id: n.dataset.labelId,
    texto: n.textContent,
    focus: n.dataset.focus === "true",
  }));
  return {
    labels,
    ids: labels.map((l) => l.id),
    mirilla: document.getElementById("reticle")?.dataset.target ?? null,
    frames: window.__nefan.fps()?.frames ?? 0,
  };
}

/** Espera a que el bucle pinte `n` fotogramas más: las etiquetas se
 *  sincronizan DESPUÉS de render(), así que tras mover al jugador hay que dejar
 *  pasar el frame. */
async function frames(ctx, n) {
  const desde = await ctx.page.evaluate(() => window.__nefan.fps()?.frames ?? 0);
  return ctx.waitFor(
    `pasan ${n} fotograma(s)`,
    (m) => {
      const f = window.__nefan.fps()?.frames ?? 0;
      return f >= m.desde + m.n ? { f } : null;
    },
    20_000,
    { desde, n },
  );
}

/** Mueve el RATÓN hasta que la mirada llega al ángulo pedido (calcado del 61). */
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

/** Teletransporta al jugador, lo encara hacia `hacia` (si se da) y devuelve
 *  la foto del DOM tras dejar pasar dos frames, con la distancia REAL a la que
 *  quedó (la colisión «salir sí, entrar no» puede moverlo un poco). */
async function plantarse(ctx, x, z, hacia = null) {
  await ctx.nefan("setPlayerPos", x, z);
  if (hacia) await ctx.nefan("setYaw", Math.atan2(hacia.x - x, hacia.z - z));
  await frames(ctx, 2);
  return ctx.page.evaluate((h) => {
    const p = window.__nefan.state().pos;
    const f = (() => {
      const labels = Array.from(document.querySelectorAll("#world-labels [data-label-id]")).map((n) => ({
        id: n.dataset.labelId,
        texto: n.textContent,
        focus: n.dataset.focus === "true",
      }));
      return {
        labels,
        ids: labels.map((l) => l.id),
        mirilla: document.getElementById("reticle")?.dataset.target ?? null,
      };
    })();
    return { ...f, pos: { x: p.x, z: p.z }, dist: h ? Math.hypot(h.x - p.x, h.z - p.z) : null };
  }, hacia);
}

export default async function (ctx) {
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);

  // ── 0 · Título delante, sin escena: el bucle ya corre y no rotula nada ──
  await frames(ctx, 3);
  const enElTitulo = await ctx.page.evaluate(() => ({
    ...(() => {
      const labels = Array.from(document.querySelectorAll("#world-labels [data-label-id]"));
      return { rotulos: labels.length, mirilla: document.getElementById("reticle")?.dataset.target ?? null };
    })(),
    escena: window.__nefan.status().scene,
    frames: window.__nefan.fps()?.frames ?? 0,
  }));
  ctx.log(`en el título: ${JSON.stringify(enElTitulo)}`);
  ctx.expect("precondición: con el título delante no hay escena", enElTitulo.escena === false, JSON.stringify(enElTitulo));
  ctx.expect(
    "con el título delante y sin escena no hay ni un rótulo colocado ni mirilla encendida",
    enElTitulo.rotulos === 0 && enElTitulo.mirilla !== "true",
    JSON.stringify(enElTitulo),
  );

  // ── 1 · En partida ───────────────────────────────────────────────────────
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);
  const cuerpos = await ctx.waitFor(
    "el tile de partida trae al tabernero (NPC) y al bandido (enemigo)",
    (ids) => {
      const n = window.__nefan.npcs().find((x) => x.id === ids.npc);
      const e = window.__nefan.enemies().find((x) => x.id === ids.enemigo);
      return n && e ? { npc: n, enemigo: e } : null;
    },
    60_000,
    { npc: NPC, enemigo: ENEMIGO },
  );
  ctx.log(`tabernero en ${JSON.stringify(cuerpos.npc.pos)} · bandido en ${JSON.stringify(cuerpos.enemigo.pos)}`);

  // 1a · Ambos personajes con rótulo, por su NOMBRE, desde donde aparece el jugador.
  const alLlegar = await ctx.waitFor(
    "aparecen los rótulos de los dos personajes",
    (ids) => {
      const n = document.querySelector(`#world-labels [data-label-id="${ids.npc}"]`);
      const e = document.querySelector(`#world-labels [data-label-id="${ids.enemigo}"]`);
      if (!n || !e) return null;
      const p = window.__nefan.state().pos;
      const dn = window.__nefan.npcs().find((x) => x.id === ids.npc).pos;
      const de = window.__nefan.enemies().find((x) => x.id === ids.enemigo).pos;
      return {
        npc: { texto: n.textContent, dist: Math.hypot(dn.x - p.x, dn.z - p.z) },
        enemigo: { texto: e.textContent, dist: Math.hypot(de.x - p.x, de.z - p.z) },
      };
    },
    30_000,
    { npc: NPC, enemigo: ENEMIGO },
  );
  ctx.log(`al llegar: ${JSON.stringify(alLlegar)}`);
  ctx.expect(
    `el NPC lleva su nombre sobre la cabeza («${NPC_NOMBRE}»)`,
    alLlegar.npc.texto === NPC_NOMBRE,
    JSON.stringify(alLlegar.npc),
  );
  ctx.expect(
    `el ENEMIGO también (« ${ENEMIGO_NOMBRE}»): es a lo que apuntas, y el 42 lo tenía por hallazgo abierto`,
    alLlegar.enemigo.texto === ENEMIGO_NOMBRE,
    JSON.stringify(alLlegar.enemigo),
  );
  // La foto, mirando hacia los dos (los rótulos son DOM: fuera de cámara no se ven).
  await ctx.nefan("setYaw", Math.atan2(cuerpos.enemigo.pos.x - 0.25, cuerpos.enemigo.pos.z - 3.25));
  await frames(ctx, 2);
  await ctx.shot("npc-y-enemigo-rotulados");

  // 1b · Alcance: a más de 18 m no hay rótulo; a menos, sí.
  const npc = cuerpos.npc.pos;
  const lejos = await plantarse(ctx, npc.x - (ALCANCE_M + 1.5), npc.z, npc);
  ctx.log(`lejos: ${JSON.stringify(lejos)}`);
  ctx.expect(
    `a ${lejos.dist?.toFixed(1)} m (> ${ALCANCE_M}) el tabernero NO lleva rótulo`,
    lejos.dist > ALCANCE_M && !lejos.ids.includes(NPC),
    JSON.stringify({ dist: lejos.dist, ids: lejos.ids }),
  );
  const cerca = await plantarse(ctx, npc.x - (ALCANCE_M - 1.5), npc.z, npc);
  ctx.log(`cerca: ${JSON.stringify(cerca)}`);
  ctx.expect(
    `a ${cerca.dist?.toFixed(1)} m (< ${ALCANCE_M}) el tabernero SÍ lleva rótulo`,
    cerca.dist < ALCANCE_M && cerca.ids.includes(NPC),
    JSON.stringify({ dist: cerca.dist, ids: cerca.ids }),
  );

  // 1c · Mirilla: enfilando al tabernero a 3 m se enciende y SU rótulo es el único con foco.
  await ctx.nefan("setPlayerPos", npc.x, npc.z + 3);
  await mirarA(ctx, 0);
  const enfilado = await ctx.waitFor(
    "enfilando al tabernero la mirilla se enciende y su rótulo lleva el foco",
    (id) => {
      const n = window.__nefan.npcs().find((x) => x.id === id);
      const p = window.__nefan.state().pos;
      window.__nefan.setYaw(Math.atan2(n.pos.x - p.x, n.pos.z - p.z));
      const labels = Array.from(document.querySelectorAll("#world-labels [data-label-id]")).map((el) => ({
        id: el.dataset.labelId, focus: el.dataset.focus === "true",
      }));
      const mirilla = document.getElementById("reticle")?.dataset.target;
      const mio = labels.find((l) => l.id === id);
      if (!mio?.focus || mirilla !== "true") return null;
      return { mirilla, conFoco: labels.filter((l) => l.focus).map((l) => l.id), dist: Math.hypot(n.pos.x - p.x, n.pos.z - p.z) };
    },
    15_000,
    NPC,
  );
  ctx.log(`enfilado: ${JSON.stringify(enfilado)}`);
  ctx.expect(
    "solo el personaje enfilado lleva el foco",
    enfilado.conFoco.length === 1 && enfilado.conFoco[0] === NPC,
    JSON.stringify(enfilado.conFoco),
  );
  await ctx.shot("tabernero-enfilado");

  // 1d · Al cielo: la mirilla se apaga, el rótulo por distancia se queda.
  const arriba = await mirarA(ctx, 60);
  await frames(ctx, 2);
  const alCielo = await ctx.page.evaluate(foto);
  ctx.log(`al cielo (${arriba.pitchDeg.toFixed(0)}°): ${JSON.stringify({ ids: alCielo.ids, mirilla: alCielo.mirilla, focos: alCielo.labels.filter((l) => l.focus).map((l) => l.id) })}`);
  ctx.expect("mirando al cielo la mirilla se apaga", alCielo.mirilla === "false", `mirilla=${alCielo.mirilla}`);
  ctx.expect(
    "…y el rótulo del tabernero (por distancia) se queda, sin foco",
    alCielo.ids.includes(NPC) && !alCielo.labels.find((l) => l.id === NPC)?.focus,
    JSON.stringify(alCielo.labels),
  );
  await ctx.shot("al-cielo-sin-mirilla");
  await mirarA(ctx, 0);

  // 1e · Un edificio no es un objetivo: enfilarlo no enciende la mirilla ni lo rotula.
  const edificio = (await ctx.nefan("objects")).find((o) => o.id === EDIFICIO) ?? null;
  ctx.log(`edificio: ${JSON.stringify(edificio)}`);
  if (!edificio) {
    ctx.sinMedirBloque(`el tile de partida no trae «${EDIFICIO}»: no hay edificio que enfilar`);
  } else {
    const enfiladoEdificio = await plantarse(ctx, edificio.pos.x, edificio.pos.z + 10, edificio.pos);
    ctx.log(`enfilando el edificio a ${enfiladoEdificio.dist?.toFixed(1)} m: ${JSON.stringify({ ids: enfiladoEdificio.ids, mirilla: enfiladoEdificio.mirilla })}`);
    ctx.expect(
      "enfilar un EDIFICIO no enciende la mirilla (su centro no es un punto al que apuntar)",
      enfiladoEdificio.mirilla === "false",
      `mirilla=${enfiladoEdificio.mirilla}`,
    );
    ctx.expect("…ni lo rotula", !enfiladoEdificio.ids.includes(EDIFICIO), JSON.stringify(enfiladoEdificio.ids));
    await ctx.shot("edificio-enfilado-sin-mirilla");
  }

  // 1f · Con la conversación delante se retiran todos; al cerrarla vuelven.
  // El tabernero tiene vida ambiental y pasea: en cada muestra el jugador se
  // planta a un paso de donde esté AHORA y lo encara (la sonda se serializa a
  // la página, así que va inline en cada espera).
  const antesDeHablar = await ctx.expectEspera(
    "CONTROL: a un paso del tabernero y mirándolo, el juego ofrece hablar, tiene rótulo y la mirilla está encendida sobre él",
    true,
    (a) => {
      const n = window.__nefan.npcs().find((x) => x.id === a.id);
      const p = window.__nefan.state().pos;
      if (Math.hypot(n.pos.x - p.x, n.pos.z - p.z) > a.paso + 0.3) {
        window.__nefan.setPlayerPos(n.pos.x + a.paso, n.pos.z);
        return null;
      }
      window.__nefan.setYaw(Math.atan2(n.pos.x - p.x, n.pos.z - p.z));
      const el = document.querySelector(`#world-labels [data-label-id="${a.id}"]`);
      const f = {
        ofreceHablar: Boolean(document.querySelector('#interact-prompt [data-action="interact"]')),
        rotulo: el?.textContent ?? null,
        mirilla: document.getElementById("reticle")?.dataset.target ?? null,
        dist: Math.hypot(n.pos.x - p.x, n.pos.z - p.z),
      };
      return f.ofreceHablar && f.rotulo && f.mirilla === "true" ? f : null;
    },
    { ms: 20_000, arg: { id: NPC, paso: A_UN_PASO } },
  );
  ctx.log(`antes de hablar: ${JSON.stringify(antesDeHablar)}`);
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta y el panel de diálogo se abre", () => window.__nefan.dialogueVisible || null, 60_000);
  const hablando = await ctx.expectEspera(
    "con la conversación delante se retiran los rótulos y la mirilla (aunque el tabernero siga a un paso)",
    true,
    () => {
      const n = document.querySelectorAll("#world-labels [data-label-id]").length;
      const m = document.getElementById("reticle")?.dataset.target;
      return n === 0 && m === "false" && window.__nefan.dialogueVisible ? { rotulos: n, mirilla: m, dialogo: true } : null;
    },
    { ms: 10_000 },
  );
  ctx.log(`hablando: ${JSON.stringify(hablando)}`);
  await ctx.shot("hablando-sin-rotulos");
  await ctx.nefan("advanceDialogue");
  const trasCerrar = await ctx.expectEspera(
    "al cerrar la conversación el rótulo del tabernero vuelve con su nombre y la mirilla se enciende sobre él",
    true,
    (id) => {
      if (window.__nefan.dialogueVisible) return null;
      const n = window.__nefan.npcs().find((x) => x.id === id);
      const p = window.__nefan.state().pos;
      window.__nefan.setYaw(Math.atan2(n.pos.x - p.x, n.pos.z - p.z));
      const el = document.querySelector(`#world-labels [data-label-id="${id}"]`);
      const f = {
        rotulo: el?.textContent ?? null,
        mirilla: document.getElementById("reticle")?.dataset.target ?? null,
        dist: Math.hypot(n.pos.x - p.x, n.pos.z - p.z),
      };
      return f.rotulo === "Tabernero corpulento" && f.mirilla === "true" ? f : null;
    },
    { ms: 15_000, arg: NPC },
  );
  ctx.log(`tras cerrar: ${JSON.stringify(trasCerrar)}`);

  // ── 2 · Adversarial por la puerta de fixtures del bench ─────────────────
  // El motor falso no declara estas formas; la puerta `loadSceneRaw` es la del
  // selector «Room» (resetWorld + formatDToWorld + addTile), o sea el mismo
  // camino que una fixture. Se parte de robledo_tile para no inventar el
  // esqueleto del Format D.
  const robledo = JSON.parse(readFileSync(ROBLEDO, "utf8"));
  const esqueleto = (entities) => ({ ...robledo, scene_id: "qa79", entities });
  const jugador = { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1] };

  // 2a · Nada que rotular.
  await ctx.nefan("loadSceneRaw", esqueleto([jugador]));
  await ctx.waitFor("el tile vacío está pintado", () => (window.__nefan.scene?.scene_id === "qa79" ? true : null), 30_000);
  await frames(ctx, 3);
  const vacio = await ctx.page.evaluate(foto);
  const npcsEnElVacio = (await ctx.nefan("npcs")).length;
  ctx.log(`tile sin personajes ni objetos: ${JSON.stringify({ ids: vacio.ids, mirilla: vacio.mirilla, npcs: npcsEnElVacio })}`);
  ctx.expect(
    "un tile sin personajes ni objetos deja el DOM limpio: cero rótulos y mirilla apagada",
    vacio.ids.length === 0 && vacio.mirilla === "false",
    JSON.stringify({ ids: vacio.ids, mirilla: vacio.mirilla }),
  );

  // 2b · Un nombre de 100 caracteres y un NPC sin nombre.
  const NOMBRE_LARGO = "barril de roble reforzado con aros de hierro, lleno hasta el borde de manzanas de la cosecha del año";
  ctx.expect("precondición: el nombre largo mide 100", NOMBRE_LARGO.length === 100, String(NOMBRE_LARGO.length));
  await ctx.nefan("loadSceneRaw", esqueleto([
    jugador,
    { id: "largo", kind: "prop", name: NOMBRE_LARGO, cell: [58, 64], footprint: [1, 1], shape: "cylinder" },
  ]));
  await ctx.waitFor("el tile adversarial está pintado", () => ((window.__nefan.scene?.objects ?? []).some((o) => o.id === "largo") ? true : null), 30_000);
  const largo = (await ctx.nefan("objects")).find((o) => o.id === "largo");
  ctx.expect("precondición: el barril está en el cliente", Boolean(largo), JSON.stringify(largo));
  if (largo) {
    const pitch = -(Math.atan2(OJO_M - CENTRO_PROP_M, 3) * 180) / Math.PI;
    await ctx.nefan("setPlayerPos", largo.pos.x + 3, largo.pos.z);
    await mirarA(ctx, pitch);
    const rotulo = await ctx.waitFor(
      "mirando el barril, su rótulo aparece",
      (id) => {
        const o = window.__nefan.objects().find((x) => x.id === id);
        const p = window.__nefan.state().pos;
        window.__nefan.setYaw(Math.atan2(o.pos.x - p.x, o.pos.z - p.z));
        const el = document.querySelector(`#world-labels [data-label-id="${id}"]`);
        return el ? { texto: el.textContent, mirilla: document.getElementById("reticle")?.dataset.target } : null;
      },
      15_000,
      "largo",
    );
    ctx.log(`barril: "${rotulo.texto}" (${rotulo.texto.length} caracteres)`);
    ctx.expect(
      `un nombre de 100 caracteres se recorta a ${MAX_CHARS} y acaba en «…»`,
      rotulo.texto.length === MAX_CHARS && rotulo.texto.endsWith("…") && NOMBRE_LARGO.startsWith(rotulo.texto.slice(0, -1)),
      `"${rotulo.texto}" (${rotulo.texto.length})`,
    );
    await ctx.shot("nombre-de-100-recortado");
  }
  // 2c · Un NPC declarado SIN nombre: el `n.name ?? n.label ?? n.id` del módulo
  // es el último recurso; lo que se afirma es que el estado no llega en
  // silencio — o hay rótulo, o el core lo rechaza en voz alta nombrando la entidad.
  const sinNombre = await ctx.page.evaluate(async (raw) => {
    try {
      await window.__nefan.loadSceneRaw(raw);
      return { cargo: true, error: null, npc: window.__nefan.npcs().find((n) => n.id === "sin_nombre") ?? null };
    } catch (err) {
      return { cargo: false, error: String(err?.message ?? err), npc: null };
    }
  }, esqueleto([jugador, { id: "sin_nombre", kind: "npc", cell: [64, 58], footprint: [1, 1] }]));
  ctx.log(`NPC sin nombre: ${JSON.stringify(sinNombre)}`);
  if (sinNombre.cargo) {
    ctx.expect(
      "si el NPC sin nombre llega al cliente, lleva rótulo por su id (nunca una caja vacía)",
      Boolean(sinNombre.npc) && String(sinNombre.npc.label ?? "").trim().length > 0,
      JSON.stringify(sinNombre.npc),
    );
  } else {
    ctx.expect(
      "un NPC sin `name` no entra en silencio: el core lo rechaza nombrando la entidad",
      /sin_nombre/.test(sinNombre.error) && /name/.test(sinNombre.error),
      sinNombre.error,
    );
  }
}
