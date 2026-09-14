/** DE LEJOS SE DISTINGUE A QUIÉN PUEDES PEGAR (#484, punto 1).
 *
 *  Hasta esta tanda el HUD nombraba al hostil en rojo pero su rótulo de mundo
 *  era la MISMA caja crema que la del tabernero: mirando la calle no había
 *  forma de saber cuál de los dos bultos te iba a atacar sin acercarte. El dato
 *  ya llegaba al cliente —`MundoDelCliente` guarda `npcs` y `enemigos` aparte—
 *  y se tiraba al aplanar la lista para rotular.
 *
 *  LO QUE SE AFIRMA, y por qué así:
 *
 *   1. El bandido lleva `data-peligro="true"` y el tabernero no. Es el estado,
 *      no la pintura: sin él, lo de abajo mide el CSS de un atributo que nadie
 *      escribe.
 *   2. El COLOR COMPUTADO del nombre del bandido es el del token `--nf-danger`
 *      —el del pack, resuelto en la página, no un `#c04a4a` escrito aquí— y el
 *      del tabernero NO lo es. Un aserto contra un literal saldría rojo el día
 *      que un style pack traiga su propio rojo, que es justo lo que el token
 *      existe para permitir.
 *   3. **ENFILANDO AL BANDIDO EL ROJO SIGUE**, y este es el aserto que paga el
 *      guion: hasta hoy `[data-focus="true"]` pisaba el `color`, así que el
 *      peligro desaparecía justo al apuntarle — cuando más falta hace. El foco
 *      se expresa con el BORDE (el acento de la mirilla) y no sustituyendo el
 *      color: son dos preguntas distintas (quién ES / a quién APUNTAS) y se
 *      pintan con dos propiedades que no se pisan.
 *   4. Y el control por el otro lado: enfilar al TABERNERO le da el mismo borde
 *      de acento sin volverlo rojo. Sin esto, «rojo al apuntar» y «rojo por
 *      hostil» serían el mismo verde.
 *
 *  NO lee píxeles: `getComputedStyle` es estado del DOM, igual que
 *  `data-focus`. El token se resuelve con una sonda dentro de `#world-labels`
 *  —los `--nf-*` viven en `#game-ui`, no en `:root` (ui/theme.ts)— para que el
 *  oráculo sea el tema VIGENTE y no una copia.
 *
 *  PROBADO EN NEGATIVO (2026-09-14): quitando de `game-ui.css` la regla
 *  `[data-peligro="true"]`, los asertos 2 y 3 se ponen rojos; devolviéndole a
 *  `[data-focus="true"]` su `color: var(--nf-accent)`, el 3 se pone rojo y el 1
 *  sigue verde — que es exactamente la regresión que este guion existe para
 *  cazar. Cero créditos: motor falso.
 */

import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

export const aisla = ["fake-ai"];

const NPC = "barkeep";
const NPC_NOMBRE = "Tabernero corpulento";
const ENEMIGO = "bandido_1";
const ENEMIGO_NOMBRE = "Bandido de camino";

/** Lo que el jugador ve de un rótulo: su estado y su color YA RESUELTO, más el
 *  color al que resuelven ahora mismo los tokens del tema. Todo en una sola
 *  evaluación para que no puedan describir dos instantes distintos. */
function fotoDeColores(ids) {
  const host = document.getElementById("world-labels");
  const sonda = document.createElement("span");
  sonda.style.position = "absolute";
  sonda.style.visibility = "hidden";
  host.appendChild(sonda);
  const token = (nombre) => {
    sonda.style.color = `var(${nombre})`;
    return getComputedStyle(sonda).color;
  };
  const tokens = { danger: token("--nf-danger"), accent: token("--nf-accent"), inkDim: token("--nf-ink-dim") };
  sonda.remove();
  const lee = (id) => {
    const el = document.querySelector(`#world-labels [data-label-id="${id}"]`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      texto: el.textContent,
      peligro: el.dataset.peligro,
      focus: el.dataset.focus,
      color: cs.color,
      borde: cs.borderTopColor,
    };
  };
  return { tokens, npc: lee(ids.npc), enemigo: lee(ids.enemigo), mirilla: document.getElementById("reticle")?.dataset.target ?? null };
}

/** Se planta a `metros` de un cuerpo y gira hasta que la mirilla lo enfila de
 *  verdad (los personajes se mueven —el tabernero pasea, el bandido carga—, así
 *  que la mirada se recalcula en cada intento, como haría una persona). */
function enfilar(ctx, id, metros) {
  return ctx.waitFor(
    `la mirilla enfila a «${id}» desde ${metros} m`,
    (a) => {
      const cuerpo = [...window.__nefan.npcs(), ...window.__nefan.enemies()].find((x) => x.id === a.id);
      if (!cuerpo) return null;
      const p = window.__nefan.state().pos;
      const d = Math.hypot(cuerpo.pos.x - p.x, cuerpo.pos.z - p.z);
      if (d > a.metros + 0.5) {
        window.__nefan.setPlayerPos(cuerpo.pos.x, cuerpo.pos.z + a.metros);
        return null;
      }
      window.__nefan.setYaw(Math.atan2(cuerpo.pos.x - p.x, cuerpo.pos.z - p.z));
      const el = document.querySelector(`#world-labels [data-label-id="${a.id}"]`);
      if (el?.dataset.focus !== "true") return null;
      return { id: a.id, d };
    },
    20_000,
    { id, metros },
  );
}

export default async function (ctx) {
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "image" });
  await comenzar(ctx);

  const ids = { npc: NPC, enemigo: ENEMIGO };
  const cuerpos = await ctx.waitFor(
    "el tile de partida trae al tabernero (NPC) y al bandido (enemigo declarado hostil)",
    (a) => {
      const n = window.__nefan.npcs().find((x) => x.id === a.npc);
      const e = window.__nefan.enemies().find((x) => x.id === a.enemigo);
      return n && e ? { npc: n.pos, enemigo: e.pos } : null;
    },
    60_000,
    ids,
  );
  ctx.log(`tabernero en ${JSON.stringify(cuerpos.npc)} · bandido en ${JSON.stringify(cuerpos.enemigo)}`);

  // ── 1 · Los dos a la vista, de lejos y sin apuntar a ninguno ─────────────
  // El jugador se planta en la PERPENDICULAR a la línea que une a los dos, a
  // 12 m del punto medio: los ve a los dos a la misma distancia y bien
  // separados en pantalla (~21° de ángulo, frente a los 13° con los que la
  // partida arranca, donde sus dos cajas se rozan). Y 12 m está FUERA del radio
  // de enganche del hostil (10 m): la foto es «los dos a la vista», no «el
  // bandido encima».
  const desdeLejos = await ctx.waitFor(
    "el jugador los ve a los dos de lejos, y los dos llevan rótulo",
    (a) => {
      const n = window.__nefan.npcs().find((x) => x.id === a.npc);
      const e = window.__nefan.enemies().find((x) => x.id === a.enemigo);
      if (!n || !e) return null;
      const medio = { x: (n.pos.x + e.pos.x) / 2, z: (n.pos.z + e.pos.z) / 2 };
      const d = Math.hypot(e.pos.x - n.pos.x, e.pos.z - n.pos.z);
      // Perpendicular hacia el SUR, que es el lado por el que llega el jugador.
      const perp = { x: -(e.pos.z - n.pos.z) / d, z: (e.pos.x - n.pos.x) / d };
      const lado = perp.z >= 0 ? 1 : -1;
      const destino = { x: medio.x + lado * perp.x * a.lejos, z: medio.z + lado * perp.z * a.lejos };
      const p = window.__nefan.state().pos;
      if (Math.hypot(destino.x - p.x, destino.z - p.z) > 0.6) {
        window.__nefan.setPlayerPos(destino.x, destino.z);
        return null;
      }
      window.__nefan.setYaw(Math.atan2(medio.x - p.x, medio.z - p.z));
      const hay = (id) => document.querySelector(`#world-labels [data-label-id="${id}"]`) !== null;
      if (!hay(a.npc) || !hay(a.enemigo)) return null;
      return {
        pos: { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 },
        dNpc: Math.hypot(n.pos.x - p.x, n.pos.z - p.z),
        dEnemigo: Math.hypot(e.pos.x - p.x, e.pos.z - p.z),
      };
    },
    30_000,
    { ...ids, lejos: 12 },
  );
  ctx.log(`de lejos: ${JSON.stringify(desdeLejos)}`);
  ctx.expect(
    "precondición: los dos personajes están rotulados a la vez, y a más de 10 m (sin enganche)",
    desdeLejos.dNpc > 10 && desdeLejos.dEnemigo > 10,
    JSON.stringify(desdeLejos),
  );

  const enReposo = await ctx.page.evaluate(fotoDeColores, ids);
  ctx.log(`tokens del tema: ${JSON.stringify(enReposo.tokens)}`);
  ctx.log(`en reposo · tabernero: ${JSON.stringify(enReposo.npc)} · bandido: ${JSON.stringify(enReposo.enemigo)}`);
  ctx.expect(
    `precondición: los rótulos son los de «${NPC_NOMBRE}» y «${ENEMIGO_NOMBRE}»`,
    enReposo.npc?.texto === NPC_NOMBRE && enReposo.enemigo?.texto === ENEMIGO_NOMBRE,
    JSON.stringify({ npc: enReposo.npc?.texto, enemigo: enReposo.enemigo?.texto }),
  );
  ctx.expect(
    "el HOSTIL está declarado como peligro en su rótulo y el vecino no",
    enReposo.enemigo?.peligro === "true" && enReposo.npc?.peligro === "false",
    JSON.stringify({ enemigo: enReposo.enemigo?.peligro, npc: enReposo.npc?.peligro }),
  );
  ctx.expect(
    `el nombre del hostil se pinta con el rojo de peligro del PACK (--nf-danger = ${enReposo.tokens.danger})`,
    enReposo.enemigo?.color === enReposo.tokens.danger,
    `color=${enReposo.enemigo?.color}`,
  );
  ctx.expect(
    "…y el del vecino NO: sigue con la tinta apagada de un nombre cualquiera",
    enReposo.npc?.color !== enReposo.tokens.danger && enReposo.npc?.color === enReposo.tokens.inkDim,
    `color=${enReposo.npc?.color} · ink-dim=${enReposo.tokens.inkDim}`,
  );
  await ctx.shot("hostil-y-vecino-de-lejos");

  // ── 2 · Apuntando al bandido: el rojo SIGUE, y el foco va al borde ───────
  // A 5 m, dentro del alcance de puntería (12 m) — y sí, ahí el bandido carga:
  // por eso la mirada se recalcula en cada intento.
  const alBandido = await enfilar(ctx, ENEMIGO, 5);
  ctx.log(`enfilando al bandido a ${alBandido.d.toFixed(1)} m`);
  const enfilandoAlHostil = await ctx.page.evaluate(fotoDeColores, ids);
  ctx.log(`enfilando al bandido: ${JSON.stringify(enfilandoAlHostil.enemigo)} · mirilla=${enfilandoAlHostil.mirilla}`);
  ctx.expect(
    "precondición: la mirilla está encendida y el foco es del bandido",
    enfilandoAlHostil.mirilla === "true" && enfilandoAlHostil.enemigo?.focus === "true",
    JSON.stringify({ mirilla: enfilandoAlHostil.mirilla, focus: enfilandoAlHostil.enemigo?.focus }),
  );
  ctx.expect(
    "APUNTÁNDOLE, el nombre del hostil SIGUE en el rojo de peligro (antes el foco se lo comía)",
    enfilandoAlHostil.enemigo?.color === enfilandoAlHostil.tokens.danger,
    `color=${enfilandoAlHostil.enemigo?.color} · danger=${enfilandoAlHostil.tokens.danger}`,
  );
  ctx.expect(
    "…y lo que dice «le estás apuntando» es el BORDE, con el acento de la mirilla",
    enfilandoAlHostil.enemigo?.borde === enfilandoAlHostil.tokens.accent,
    `borde=${enfilandoAlHostil.enemigo?.borde} · accent=${enfilandoAlHostil.tokens.accent}`,
  );
  await ctx.shot("bandido-enfilado-sigue-rojo");

  // ── 3 · Control por el otro lado: el vecino enfilado NO se vuelve rojo ───
  await enfilar(ctx, NPC, 3);
  const enfilandoAlVecino = await ctx.page.evaluate(fotoDeColores, ids);
  ctx.log(`enfilando al tabernero: ${JSON.stringify(enfilandoAlVecino.npc)}`);
  ctx.expect(
    "precondición: el foco es del tabernero",
    enfilandoAlVecino.npc?.focus === "true",
    JSON.stringify(enfilandoAlVecino.npc),
  );
  ctx.expect(
    "CONTROL: apuntar a un vecino le da el borde de acento pero NO el rojo de peligro",
    enfilandoAlVecino.npc?.borde === enfilandoAlVecino.tokens.accent &&
      enfilandoAlVecino.npc?.color !== enfilandoAlVecino.tokens.danger,
    JSON.stringify({ borde: enfilandoAlVecino.npc?.borde, color: enfilandoAlVecino.npc?.color }),
  );
  await ctx.shot("tabernero-enfilado-sin-rojo");
}
