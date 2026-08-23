/** Los personajes siguen ahí después de tirar el motor que los renderizaba.
 *
 *  Es el criterio que justificó toda la tanda de la retirada del cliente Godot
 *  (2026-08-22): el renderizador de hojas de sprites se portó a three.js
 *  (`tools/render-sprite-sheets/`) ANTES de borrar nada, precisamente para que
 *  el juego no se quedara sin gente. Un `npm test` verde no dice nada de esto:
 *  las hojas son 28 MB fuera de git, las carga el cliente por HTTP y el fallo
 *  se ve en pantalla, no en el compilador.
 *
 *  Lo que afirma, en el orden en que se rompería:
 *
 *  1. Las 10 hojas del set base de `y_bot` están servidas y completas — no
 *     "existe el directorio": `meta.json` con más de un frame y el ÚLTIMO PNG
 *     que ese meta promete, que es el que falta cuando un render se corta a
 *     medias (le pasó al port: 43 frames en vez de 44).
 *  2. En una partida REAL (desde el título, no una fixture) hay gente y se
 *     mueve sola.
 *  3. El jugador se mueve.
 *
 *  Modo de personajes "vector" (base y_bot) a propósito: no depende de que el
 *  backend de skins tenga sheets para el modelo del bench, y no encola ni una
 *  petición de generación. Cero créditos.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

/** Las 10 del set base — `BASE_ANIMS` en renderer/character-sprites.ts, que es
 *  fail-loud: si falta una, el cliente no arranca los personajes. */
const ANIMS_BASE = [
  "idle", "walk", "run",
  "quick", "heavy", "medium", "defensive", "precise",
  "hit_react", "death",
];

export default async function (ctx) {
  // --- 1. Las hojas que produce tools/render-sprite-sheets, servidas ---
  const hojas = await ctx.page.evaluate(async (anims) => {
    const out = [];
    for (const anim of anims) {
      const base = `/sprites/y_bot/${anim}/frontal_8`;
      try {
        const r = await fetch(`${base}/meta.json`);
        if (!r.ok) { out.push({ anim, error: `meta.json HTTP ${r.status}` }); continue; }
        const m = await r.json();
        const ultimo = `${base}/dir_0_frame_${String(m.frame_count - 1).padStart(3, "0")}.png`;
        const png = await fetch(ultimo, { method: "GET" });
        // OJO: el 200 NO basta. El dev server de Vite responde al fichero que
        // no existe con el index.html de la SPA (200 text/html), así que un
        // `r.ok` desnudo da verde sobre una hoja a la que le faltan frames —
        // medido: escondiendo un PNG, este guion seguía en verde. La prueba es
        // que lo servido sea una IMAGEN.
        const tipo = png.headers.get("content-type") ?? "";
        out.push({
          anim,
          frames: m.frame_count,
          dirs: m.directions,
          lado: m.frame_width,
          ultimoOk: png.ok && tipo.startsWith("image/"),
          tipo,
          ultimo,
        });
      } catch (e) {
        out.push({ anim, error: String(e) });
      }
    }
    return out;
  }, ANIMS_BASE);

  const rotas = hojas.filter((h) => h.error || !h.ultimoOk || !(h.frames > 1) || h.dirs !== 8);
  ctx.log(`hojas y_bot: ${hojas.map((h) => `${h.anim}=${h.error ?? h.frames}`).join(" ")}`);
  ctx.expect(
    "las 10 hojas del set base de y_bot están servidas, con >1 frame y sus 8 direcciones",
    rotas.length === 0,
    JSON.stringify(rotas),
  );
  ctx.expect(
    "el último frame que promete cada meta.json existe de verdad (un render cortado no se ve hasta que se ve)",
    hojas.every((h) => h.ultimoOk),
    JSON.stringify(hojas.filter((h) => !h.ultimoOk).map((h) => h.ultimo)),
  );

  // --- 2. Partida real desde el título, con la base y_bot (sin IA) ---
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  const estado = await ctx.waitFor(
    "la partida tiene gente",
    () => {
      const s = window.__nefan.status();
      return s.npcs > 0 ? { ...s, npcs: window.__nefan.npcs() } : null;
    },
    60_000,
  );
  ctx.log(`NPCs: ${estado.npcs.map((n) => `${n.id}(${n.label})`).join(", ")}`);
  ctx.expect("hay al menos un NPC en la escena de la sesión", estado.npcs.length > 0);

  const mundo = await ctx.nefan("fps");
  // `billboards` a secas cuenta TAMBIÉN el decorado (updateObject comparte el
  // mapa con updateEntity), así que «hay al menos tantos billboards como NPCs»
  // lo cumple cualquier escena con cajas y CERO personajes montados — el fallo
  // exacto que este aserto existe para cazar. Se cuenta lo que se afirma.
  ctx.expect(
    "cada NPC de la escena tiene su billboard de PERSONAJE montado en el mundo 3D",
    mundo.billboardsPersonaje >= estado.npcs.length,
    `billboardsPersonaje=${mundo.billboardsPersonaje} npcs=${estado.npcs.length} (billboards totales, decorado incluido: ${mundo.billboards})`,
  );

  // --- El NPC se mueve SOLO (el sim del bridge lo conduce) ---
  const partida = estado.npcs.map((n) => ({ id: n.id, x: n.pos.x, z: n.pos.z }));
  const movido = await ctx
    .waitFor(
      "algún NPC se desplaza por su cuenta",
      (inicio) => {
        const ahora = window.__nefan.npcs();
        for (const a of inicio) {
          const b = ahora.find((n) => n.id === a.id);
          if (!b) continue;
          const d = Math.hypot(b.pos.x - a.x, b.pos.z - a.z);
          if (d > 0.5) return { id: a.id, d };
        }
        return null;
      },
      30_000,
      partida,
    )
    .catch((err) => {
      ctx.expect("algún NPC se mueve solo (vida ambiental viva)", false, err.message);
      return null;
    });
  if (movido) {
    ctx.expect(`el NPC ${movido.id} se desplazó solo`, movido.d > 0.5, `${movido.d.toFixed(2)} m`);
  }
  await ctx.shot("npc-en-partida");

  // --- 3. El jugador se mueve (rAF vivo y control en manos del jugador) ---
  const antes = (await ctx.nefan("state")).pos;
  const despues = await ctx
    .holdUntil(
      "up",
      "el jugador avanza al mantener 'up'",
      (inicio) => {
        const p = window.__nefan.state().pos;
        return Math.hypot(p.x - inicio.x, p.z - inicio.z) > 1 ? p : null;
      },
      15_000,
      antes,
    )
    .catch((err) => {
      ctx.expect("el jugador se mueve", false, err.message);
      return null;
    });
  if (despues) {
    const d = Math.hypot(despues.x - antes.x, despues.z - antes.z);
    ctx.expect("el jugador se desplazó >1 m", d > 1, `${d.toFixed(2)} m`);
  }
  await ctx.shot("jugador-tras-andar");
}
