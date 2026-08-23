/** El panel «Salidas» lleva a un lugar que todavía no existe.
 *
 *  Contexto (agosto 2026, issue #172): Format D se quedó con DOS variantes,
 *  tile y plató. La tercera —la escena "suelta"— se retiró, y con ella la
 *  forma en que el panel de salidas realizaba un destino en un mundo de
 *  tiles. Ahora un destino sin escena se ANCLA a un tile libre del plano
 *  (rayo hacia el borde del link, saltando lo ya generado) y ese tile se
 *  genera como cualquier otro, con el place en el contexto del motor. El
 *  jugador aparece dentro.
 *
 *  Lo que este guion protege, andando y no leyendo JSON:
 *   1. el botón de la salida existe y el destino NO estaba realizado — y eso
 *      se AFIRMA, no se supone: el bridge tiene dos ramas para «Salidas» y
 *      por la cacheada pasan en verde todos los demás asertos de este guion
 *      (llega un tile, es otro, el jugador cae dentro y en suelo libre). Sin
 *      mirar la rama, este guion pasaría sin ejercer la generación que dice
 *      probar. Se mira con lo que el bridge DECLARA: `viaje.encolado` (la
 *      rama cacheada ni llega a tocar la cola) y `tileEpisodios[].source`;
 *   2. clicarlo trae un TILE nuevo (scene_id `tile_x_y`), no una escena suelta;
 *   3. el jugador acaba DENTRO del rect de ese tile, en suelo libre;
 *   4. el tile ES el lugar (el motor recibió `generate_tile.place`);
 *   5. desde allí, el panel ofrece la vuelta.
 *
 *  Por qué regenera el mundo primero: el world map de la partida (places y
 *  links) viaja en el snapshot pre-generado de `data/games/{id}/world/`, y un
 *  snapshot escrito antes de que el motor de bench sembrara el destino no lo
 *  tiene. Regenerar es el botón del propio título ("Regenerar mundo"), cuesta
 *  cero con el fake-ai-server, y de paso comprueba que en un mundo de tiles la
 *  pre-generación es el anillo 3×3 y NADA más (el fake responde 422 a
 *  cualquier realize_place, así que un realize colado pondría esto en rojo).
 *
 *  Cero créditos: preset 5, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar, regenerarMundo, esperarRegistro } from "../lib/sesion.mjs";

const GAME_ID = "alta_fantasia";

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await comenzar(ctx);

  // ── 1. Hay una salida, y su destino NO está realizado ───────────────────
  const salidas = await ctx.nefan("exits");
  ctx.log(`salidas del tile de entrada: ${JSON.stringify(salidas)}`);
  ctx.expect("el panel «Salidas» ofrece al menos un destino", salidas.length > 0, JSON.stringify(salidas));
  if (!salidas.length) return;
  const destino = salidas[0];

  const botones = await ctx.page.$$eval("#travel-panel button.travel-exit", (bs) =>
    bs.map((b) => b.textContent ?? ""),
  );
  ctx.expect("el destino tiene su botón en el panel", botones.length > 0, JSON.stringify(botones));
  ctx.expect(
    `el botón nombra el destino (${destino.name})`,
    botones.some((t) => t.includes(destino.name)),
    JSON.stringify(botones),
  );

  const antes = await ctx.page.evaluate(() => ({
    scene_id: window.__nefan.scene.scene_id,
    rect: window.__nefan.scene.world_rect,
    pos: window.__nefan.state().pos,
    tiles: window.__nefan.tiles,
  }));
  ctx.log(`tile de partida ${antes.scene_id} · tiles conocidos: ${antes.tiles.length}`);
  await ctx.shot("antes-de-viajar");

  // ── 2. Clicar la salida trae un TILE nuevo ──────────────────────────────
  await ctx.page.click("#travel-panel button.travel-exit");
  // El destino NO estaba realizado ⇒ el viaje pasa por la COLA del bridge y el
  // acuse lo dice. Por la rama cacheada no habría acuse ninguno.
  const acuse = await esperarRegistro(
    ctx,
    "el bridge acusa el viaje (el lugar no estaba realizado: hay que generarlo)",
    "viaje",
    () => (window.__nefan.viaje?.encolado ? window.__nefan.viaje : null),
    60_000,
  ).catch(() => null);
  ctx.expect(
    "el destino NO estaba realizado: el viaje entra en la cola de generación",
    acuse?.encolado === "queued" || acuse?.encolado === "promoted",
    `encolado=${JSON.stringify(acuse?.encolado)} — sin acuse, el bridge está re-difundiendo una escena que ya tenía`,
  );
  const llegada = await ctx
    .waitFor(
      "el destino llega y el jugador aparece en él",
      (previo) => {
        const s = window.__nefan.scene;
        if (!s || s.scene_id === previo) return null;
        const p = window.__nefan.state().pos;
        const r = s.world_rect;
        // El scene_init llega ANTES que el ready con el spawn: no dar por
        // buena la llegada hasta que el jugador esté DENTRO del rect nuevo.
        if (!r || p.x < r.minX || p.x >= r.maxX || p.z < r.minZ || p.z >= r.maxZ) return null;
        return {
          scene_id: s.scene_id,
          description: s.scene_description ?? "",
          rect: r,
          pos: p,
          objetos: (s.objects ?? []).length,
          npcs: (s.npcs ?? []).length,
          exits: (s.exits ?? []).map((e) => e.place_id),
        };
      },
      240_000,
      antes.scene_id,
    )
    .catch((err) => {
      ctx.expect("clicar la salida lleva al jugador al destino", false, err.message);
      return null;
    });
  if (!llegada) {
    await ctx.shot("viaje-fallido");
    return;
  }
  ctx.log(`llegada: ${llegada.scene_id} · ${llegada.description}`);

  // ── 3. Es un tile del plano continuo, no una escena suelta ──────────────
  ctx.expect(
    "el destino llega como TILE del plano continuo",
    /^tile_-?\d+_-?\d+$/.test(llegada.scene_id),
    llegada.scene_id,
  );
  ctx.expect("y es un tile NUEVO, no el de partida", llegada.scene_id !== antes.scene_id, llegada.scene_id);
  // «Nuevo» para el cliente no es «generado»: un tile del mundo pre-generado
  // también llega nuevo. Quien decide es el BRIDGE, que declara el origen.
  const epDestino = await esperarRegistro(
    ctx,
    `el cliente registra de dónde salió ${llegada.scene_id}`,
    "tileEpisodios",
    (k) => window.__nefan.tileEpisodios.find((e) => e.key === k && e.source !== null) ?? null,
    30_000,
    llegada.scene_id,
  ).catch(() => null);
  ctx.log(`episodio del destino: ${JSON.stringify(epDestino)}`);
  ctx.expect(
    "y lo acaba de GENERAR el motor (no es un HIT de caché ni del mundo pre-generado)",
    epDestino?.source === "engine",
    `source=${epDestino?.source}`,
  );
  const lado = llegada.rect.maxX - llegada.rect.minX;
  ctx.expect(
    "con el tamaño de un tile (el mismo que el de partida)",
    lado === antes.rect.maxX - antes.rect.minX,
    `${lado} m vs ${antes.rect.maxX - antes.rect.minX} m`,
  );

  // ── 4. El jugador está DENTRO y en suelo libre ──────────────────────────
  ctx.expect(
    "el jugador aparece dentro del tile del destino",
    llegada.pos.x >= llegada.rect.minX && llegada.pos.x < llegada.rect.maxX &&
      llegada.pos.z >= llegada.rect.minZ && llegada.pos.z < llegada.rect.maxZ,
    `${JSON.stringify(llegada.pos)} en ${JSON.stringify(llegada.rect)}`,
  );
  ctx.expect(
    "y no dentro del tile de partida",
    !(llegada.pos.x >= antes.rect.minX && llegada.pos.x < antes.rect.maxX &&
      llegada.pos.z >= antes.rect.minZ && llegada.pos.z < antes.rect.maxZ),
    `${JSON.stringify(llegada.pos)} vs ${JSON.stringify(antes.rect)}`,
  );
  ctx.expect(
    "el punto de aparición no es sólido (no aparece incrustado)",
    (await ctx.nefan("probeCollide", llegada.pos.x, llegada.pos.z)) === false,
    JSON.stringify(llegada.pos),
  );

  // ── 5. El tile ES el lugar: el motor recibió generate_tile.place ────────
  ctx.expect(
    `la descripción del tile nombra el lugar (${destino.name})`,
    llegada.description.includes(destino.name),
    llegada.description,
  );
  ctx.expect("el lugar trae construcción, no campo vacío", llegada.objetos > 0, `${llegada.objetos} objetos`);

  // ── 6. Desde allí se puede volver ───────────────────────────────────────
  const vuelta = await ctx.nefan("exits");
  ctx.log(`salidas desde el destino: ${JSON.stringify(vuelta.map((e) => e.place_id))}`);
  ctx.expect(
    "el panel ofrece la vuelta al lugar de partida",
    vuelta.length > 0,
    JSON.stringify(llegada.exits),
  );
  await ctx.shot("destino-anclado");
}
