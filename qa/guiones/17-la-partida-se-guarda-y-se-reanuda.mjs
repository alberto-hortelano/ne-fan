/** Lo que el motor escribe por el State API sigue ahí después de REANUDAR.
 *
 *  El State API es el cable por el que el motor narrativo (Claude, vía las
 *  tools MCP `map_*`, `inventory_*`, `npc_*`, `plugin_register`) muta la
 *  partida. Ninguna de esas escrituras se persiste sola: el handler devuelve
 *  un `RouteResult` con `mutated: true`, el borde del State API ve el flag y
 *  llama a `onMutation`, y el bridge escribe `saves/{id}/state.json`
 *  (`ws-server.ts` → `narrative.save()`).
 *
 *  Ese flag es lo único que separa «la partida se guarda» de «la partida no
 *  se guarda», y perderlo NO CAMBIA NINGUNA RESPUESTA: el status sigue siendo
 *  200, el body es idéntico y en caliente todo se lee bien, porque la
 *  NarrativeState viva en memoria ya tiene el cambio. El fallo aparece ENTERO
 *  y solo al reanudar, cuando el bridge relee del disco lo que nunca se
 *  escribió: el jugador vuelve a su partida y el lugar al que llegó, el
 *  objeto que le dieron y el sistema de juego que el motor creó no están.
 *
 *  Por eso este guion no se conforma con leer de vuelta lo que acaba de
 *  escribir. Hace lo único que lo distingue:
 *   1. partida nueva por el camino del jugador (título → mundo → Comenzar);
 *   2. el motor escribe por el State API, ejerciendo DIEZ de las doce rutas
 *      que marcan `mutated` (las dos que faltan y por qué, al final);
 *   3. **nada más toca el save**: no se anda, no se viaja, no se dialoga —
 *      cualquiera de esas cosas guarda por su cuenta y taparía el agujero;
 *   4. se recarga la página y se reanuda desde el título, con el botón
 *      «Reanudar» de la tarjeta del save, que es como reanuda quien juega;
 *   5. y se comprueba que TODO sigue ahí, por el mismo cable del motor.
 *
 *  Probado en negativo (#225), cinco veces, una por ruta: con `upsertPlace`,
 *  `arriveNpc`, `addInventoryItem` o `registerPlugin` devolviendo `ok()` en vez
 *  de `mutated()` —un carácter— el guion se pone rojo en la línea que nombra
 *  esa ruta, y con `getMap` devolviendo `mutated()` se pone rojo en el aserto
 *  de las lecturas. Ningún otro guion de qa/ se entera de ninguno de los cinco.
 *
 *  Y una lección del negativo que cambió el diseño del guion: con
 *  `upsertPlace` roto, el lugar SEGUÍA estando tras reanudar — se lo llevó de
 *  paso la siguiente mutación que sí guardó. Comprobar solo «el dato sobrevive
 *  al resume» habría aprobado un flag perdido. Por eso el save se mide después
 *  de CADA escritura, no una vez al final.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { nuevaPartida, comenzar, esperarListaDeSaves, esperarTituloListo } from "../lib/sesion.mjs";
import { rutaDelSave } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

/** Puede disparar GENERACIÓN (escena del motor, página de atlas o skin): el
 *  runner ejerce el guardarraíl de cero créditos antes de lanzarlo y, contra
 *  un backend que no declare ser falso, este guion no corre (#295). Lo señaló
 *  el contador de rutas de pago del motor falso, no una lectura del código:
 *  `gasta` es «PUEDE gastar», no «gastó esta vez». */
export const gasta = true;

const GAME_ID = "alta_fantasia";
/** El State API del bridge. Sale de la fuente única de puertos, no de un
 *  literal: dos corridas a la vez no comparten stack. */
const API = URLS.state_api;

/** Llamada al State API tal cual la hace narrative-mcp. */
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { __raw: text };
  }
  return { status: res.status, body: json };
}

/** Un sistema de juego mínimo pero legal: `plugin_register` es la duodécima
 *  ruta mutadora y la que más caro sale perder — el motor lo crea a mitad de
 *  partida y el slice vive en el save. */
const SISTEMA = {
  version: 1,
  name: "qa_reanudar",
  description: "Cuenta las veces que el jugador cruza el vado del bench.",
  origin: { author: "narrative_engine", rationale: "hace falta un contador para el guion 17" },
  slice: {
    schema: { type: "object", properties: { cruces: { type: "number" } } },
    initial: { cruces: 0 },
  },
  reads: [],
  writes: [],
  events_consumed: [
    {
      type: "qa_cruce",
      when: { op: "has", path: "event.veces" },
      do: [{ op: "inc", path: "slice.cruces", value: "event.veces" }],
    },
  ],
  fixtures: [
    {
      before: { cruces: 0 },
      event: { type: "qa_cruce", veces: 1 },
      context: {},
      after: { cruces: 1 },
    },
  ],
};

export default async function (ctx) {
  // ── 1. Partida nueva por el camino del jugador ──────────────────────────
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await comenzar(ctx);

  const escena = await ctx.nefan("scene");
  const sceneId = escena.scene_id;
  const salud = await api("GET", "/health");
  const sessionId = salud.body?.session_id;
  ctx.expect(
    "la partida tiene sesión viva en el State API",
    salud.status === 200 && Boolean(sessionId),
    `${salud.status} ${JSON.stringify(salud.body)}`,
  );
  if (!sessionId) return;
  ctx.log(`sesión ${sessionId} · escena ${sceneId}`);

  // Un NPC de la escena para el inventario y para el director: se coge de la
  // escena que el motor acaba de servir, no de una lista escrita a mano.
  const npcId = (escena.npcs ?? [])[0]?.id;
  ctx.expect("la escena del motor trae al menos un NPC", Boolean(npcId), JSON.stringify(escena.npcs));
  if (!npcId) return;

  await ctx.shot("partida-recien-empezada");
  const posArranque = await ctx.nefan("playerPos");
  const vidaAntes = await ctx.page.evaluate(
    () => Number(document.getElementById("player-hp-text")?.textContent ?? "0"),
  );

  // ── 2. El motor escribe por el cable de las tools MCP ────────────────────
  // Cada escritura se mide contra el `state.json` DE DISCO antes y después.
  // No hay espera por reloj y no hace falta: el borde del State API hace
  // `await onMutation()` ANTES de contestar (`state-http-server.ts`), así que
  // cuando la respuesta llega el save ya está escrito o no lo estará nunca.
  //
  // Se mide una a una a propósito. Perder el `mutated` de UNA ruta no borra
  // necesariamente lo que escribió: si otra mutación posterior guarda, se lo
  // lleva de paso, y el dato sobrevive al resume por casualidad. Lo que no
  // sobrevive es la partida en la que esa ruta fue la última cosa que hizo el
  // motor antes de que el jugador cerrara — y eso solo se ve mirando el
  // fichero después de CADA escritura.
  const escrituras = [];
  const escribir = async (nombre, method, path, body) => {
    const antes = marcaDeGuardado(sessionId);
    const res = await api(method, path, body);
    const despues = marcaDeGuardado(sessionId);
    escrituras.push({ nombre, status: res.status, body: res.body, guardó: antes !== despues });
    ctx.expect(`el motor puede ${nombre}`, res.status === 200, `${res.status} ${JSON.stringify(res.body)}`);
    ctx.expect(
      `…y el bridge escribe el save al hacerlo (${path})`,
      res.status === 200 && antes !== null && antes !== despues,
      `state.json intacto: ${antes} — la partida NO se guarda y ninguna respuesta lo delata`,
    );
    return res;
  };

  await escribir("crear un lugar (map_upsert_place)", "POST", "/map/place", {
    id: "qa_vado",
    kind: "site",
    parent_id: null,
    name: "El vado de las piedras",
    description: "Un paso de agua baja entre juncos.",
  });
  await escribir("crear el lugar vecino", "POST", "/map/place", {
    id: "qa_ermita",
    kind: "site",
    parent_id: null,
    name: "Ermita del vado",
    description: "Cuatro paredes de piedra y un tejado hundido.",
  });
  await escribir("enlazar dos lugares (map_link)", "POST", "/map/link", {
    from: "qa_vado",
    to: "qa_ermita",
    kind: "path",
    travel_hours: 1,
  });
  await escribir("dejar un trigger en el mapa (map_add_trigger)", "POST", "/map/trigger", {
    place_id: "qa_vado",
    trigger: { id: "qa_trigger_vado", when: { type: "first_visit" }, consequences: [] },
  });
  await escribir("dar dos objetos (inventory_add)", "POST", `/entity/${npcId}/inventory`, {
    item: { id: "qa_amuleto", qty: 1 },
  });
  await escribir("dar el segundo objeto", "POST", `/entity/${npcId}/inventory`, {
    item: { id: "qa_cuerda", qty: 3 },
  });
  await escribir("quitar uno (inventory_remove)", "POST", `/entity/${npcId}/inventory/remove`, {
    item_id: "qa_cuerda",
  });
  await escribir("registrar las refs de la escena (scene_asset_refs)", "POST", "/scene/asset_refs", {
    scene_id: sceneId,
    refs: ["qa_hash_de_reanudar"],
  });
  await escribir("mandar de viaje a un NPC (npc_move_to_place)", "POST", `/npc/${npcId}/move_to_place`, {
    place_id: "qa_ermita",
  });
  await escribir("declararlo llegado (npc_arrive)", "POST", `/npc/${npcId}/arrive`, {});
  await escribir("fijarle una directiva (npc_set_directive)", "POST", `/npc/${npcId}/directive`, {
    directive: { type: "guard", target_place_id: "qa_ermita" },
  });
  const alta = await escribir("crear un sistema de juego (plugin_register)", "POST", "/plugins/register", {
    manifest: SISTEMA,
  });
  const pluginId = alta.body?.id;

  // Las once escrituras de arriba cubren DIEZ de las doce rutas del State API
  // que marcan `mutated`. Las dos que faltan, dichas:
  //  · POST /vocabulary escribe en data/games/, no en el save: su pérdida no
  //    se ve reanudando y necesitaría `aisla: ["mundo"]`.
  //  · POST /scheduled_event/{id}/resolve necesita un evento en la agenda, y
  //    la agenda solo la siembra el motor de verdad (no hay alta por HTTP).
  ctx.expect(
    "el motor deja escritas las once mutaciones sin un solo error",
    escrituras.every((e) => e.status === 200),
    escrituras.filter((e) => e.status !== 200).map((e) => `${e.nombre}: ${e.status}`).join(" · "),
  );
  ctx.expect(
    "las once escriben el save, una por una",
    escrituras.every((e) => e.guardó),
    escrituras.filter((e) => !e.guardó).map((e) => e.nombre).join(" · "),
  );

  // En CALIENTE todo se lee bien aunque el save no se haya escrito: la
  // NarrativeState viva ya tiene el cambio. Se comprueba igualmente, porque
  // si esto falla el fallo no es del guardado sino de la escritura.
  const enCaliente = await api("GET", "/map/place/qa_vado");
  ctx.expect(
    "en caliente el lugar existe (si no, el fallo es de la escritura, no del guardado)",
    enCaliente.status === 200 && enCaliente.body?.place?.id === "qa_vado",
    `${enCaliente.status} ${JSON.stringify(enCaliente.body).slice(0, 200)}`,
  );

  // ── 3. Nada más tocó el save ENTRE escritura y escritura ────────────────
  // Ni andar, ni viajar, ni dialogar: cualquiera de esas cosas llama a
  // `narrative.save()` por su cuenta y habría tapado un `mutated` perdido. Por
  // eso lo de arriba se mide una a una, con el fichero delante, ANTES de que
  // el jugador dé un paso.

  // ── 3b. Y ahora el jugador ANDA, que es lo que hace que el resto valga ──
  // Sin esto, el punto donde se reanuda coincide con el `__player_start` del
  // tile, y todo lo que viene después pasaría IGUAL con un arreglo que no
  // persistiera nada y se limitara a caer al arranque de la escena. Andando,
  // los dos puntos se separan y el aserto distingue una cosa de la otra.
  await ctx.nefan("setYaw", 0); // +z: calle abierta, lejos de la taberna
  // El `catch` traga el cortafuegos de holdUntil a propósito: lo que decide no
  // es si llegó a los 2 m, es la separación MEDIDA de abajo.
  await ctx
    .holdUntil(
      "up",
      "el jugador se aleja de su punto de arranque",
      (a) => {
        const p = window.__nefan.playerPos;
        const d = Math.hypot(p.x - a.x, p.z - a.z);
        // 2 m: la calle del tile del bench se acaba en una pared poco después,
        // y el listón real es el de abajo (separarse MUCHO más que la
        // tolerancia de 0,5 m con la que se compara luego).
        return d >= 2 ? { x: p.x, z: p.z, d } : null;
      },
      15_000,
      { x: posArranque.x, z: posArranque.z },
    )
    .catch(() => null);
  const posAntes = await ctx.nefan("playerPos");
  const separacion = Math.hypot(posAntes.x - posArranque.x, posAntes.z - posArranque.z);
  ctx.log(`el jugador anduvo hasta ${JSON.stringify(posAntes)} (${separacion.toFixed(1)} m)`);
  // NO CONCLUYENTE antes que verde: si no se ha movido, lo de abajo no
  // distingue «se persiste la posición» de «se cae al __player_start».
  ctx.expect(
    "el jugador se ha ALEJADO del arranque de la escena (si no, el resto no prueba nada)",
    separacion >= 1.5,
    `arranque ${JSON.stringify(posArranque)} · ahora ${JSON.stringify(posAntes)} (${separacion.toFixed(2)} m)`,
  );
  // Un guardado del motor DESPUÉS de andar: es el que tiene que llevarse la
  // posición nueva.
  await api("POST", "/map/place", {
    id: "qa_testigo_andado",
    kind: "site",
    parent_id: null,
    name: "Piedra del camino",
    description: "Fuerza un guardado con el jugador ya lejos del arranque.",
  });

  // ── 3c. Y el save de DISCO ya lleva dónde está el jugador ────────────────
  // La mitad del arreglo que se ve sin recargar nada: la posición vive en el
  // combatiente del sim y ninguno de los trece guardados del bridge la
  // copiaba al save. Se mira el fichero, no la memoria.
  const enDisco = leerSave(sessionId);
  ctx.expect(
    "el state.json de disco lleva la posición VIVA del jugador, no la de arranque",
    Array.isArray(enDisco?.player?.position) &&
      Math.abs(enDisco.player.position[0] - posAntes.x) <= 0.5 &&
      Math.abs(enDisco.player.position[2] - posAntes.z) <= 0.5,
    `save: ${JSON.stringify(enDisco?.player?.position)} · vivo: ${JSON.stringify(posAntes)} · arranque: ${JSON.stringify(posArranque)}`,
  );
  ctx.expect(
    "…y su vida, que es el otro campo que solo vivía en el sim",
    enDisco?.player?.health === vidaAntes,
    `save: ${enDisco?.player?.health} · HUD: ${vidaAntes}`,
  );

  // ── 4. Se reanuda desde el título, como quien juega ──────────────────────
  await ctx.page.goto(ctx.page.url(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras recargar", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  // La tarjeta del save la pinta `list_sessions`, que llega después del
  // primer pintado del home: lo que se espera es la LISTA, no el título.
  await esperarListaDeSaves(ctx);

  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect("el título ofrece REANUDAR la partida recién jugada", Boolean(tarjeta), sessionId);
  if (!tarjeta) return;

  // Lo que la tarjeta le promete al jugador antes de pulsar: escenas y
  // entidades salen de la metadata del save EN DISCO.
  const resumen = await ctx.page.evaluate((sid) => {
    const btn = document.querySelector(`button[data-action="resume"][data-session-id="${sid}"]`);
    return btn?.closest("div")?.parentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }, sessionId);
  ctx.log(`tarjeta del save: ${resumen.slice(0, 160)}`);
  ctx.expect(
    "la tarjeta del save promete entidades (el save de disco no está vacío)",
    /[1-9]\d* entidades/.test(resumen),
    resumen.slice(0, 160),
  );
  await ctx.shot("titulo-con-el-save");

  // NADIE DE FUERA CONDUCE LA PARTIDA. El cliente recargado late a 60 fps
  // desde el título con su posición por defecto ({0,0,2}) y el bridge sigue
  // teniendo la sesión viva. Antes de esta tanda daba igual (la posición no se
  // guardaba nunca); ahora el save lleva la del combatiente del sim, así que
  // un frame de un socket que no ha pasado por «Reanudar» corrompe la partida
  // guardada.
  //
  // Hace falta PROVOCAR un guardado para verlo, y por eso hay una escritura
  // aquí: sin ella el fichero no se reescribe mientras el jugador mira el
  // título y el aserto sería un verde incapaz de ponerse rojo (medido: con
  // los dos candados quitados, seguía en verde). El motor SÍ escribe en esa
  // ventana —una generación en vuelo, un evento de la agenda— y es justo
  // entonces cuando se llevaba la posición por delante.
  await api("POST", "/map/place", {
    id: "qa_testigo_titulo",
    kind: "site",
    parent_id: null,
    name: "Piedra del título",
    description: "Fuerza un guardado mientras el jugador mira el título.",
  });
  const antesDeReanudar = leerSave(sessionId);
  ctx.expect(
    "un guardado con el jugador en el título NO se lleva su posición",
    JSON.stringify(antesDeReanudar?.player?.position) ===
      JSON.stringify(enDisco?.player?.position),
    `${JSON.stringify(enDisco?.player?.position)} → ${JSON.stringify(antesDeReanudar?.player?.position)}`,
  );

  await tarjeta.click();
  await ctx.waitFor(
    "la escena vuelve tras reanudar",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  await ctx.shot("partida-reanudada");

  // REANUDAR TE DEJA DONDE ESTABAS (#245). Hasta hoy se empezaba en
  // (0.25, 3.25) —el `__player_start` de la escena— y se reanudaba en (0, 0),
  // que en el tile del bench cae DENTRO de la taberna: la captura
  // `03-partida-reanudada` salía a oscuras y sin cielo. La posición del
  // jugador vive en el combatiente del sim y no se copiaba al save en
  // NINGUNO de los trece guardados del bridge.
  //
  // Se mide en los DOS sitios donde tiene que estar, porque son fallos
  // distintos: en el fichero de disco (el save la lleva) y en el cliente tras
  // pulsar «Reanudar» (el cliente la usa).
  const posDespues = await ctx.nefan("playerPos");
  const arranque = (await ctx.nefan("scene")).__player_start;
  ctx.log(
    `posición: empezó en ${JSON.stringify(posAntes)} · reanudó en ${JSON.stringify(posDespues)} · ` +
      `la escena declara __player_start ${JSON.stringify(arranque)}`,
  );
  const cerca = (a, b) => Math.abs(a - b) <= 0.5;
  ctx.expect(
    "reanudar deja al jugador DONDE ESTABA, no en el origen",
    cerca(posDespues.x, posAntes.x) && cerca(posDespues.z, posAntes.z),
    `empezó en ${JSON.stringify(posAntes)} y reanudó en ${JSON.stringify(posDespues)}`,
  );
  ctx.expect(
    "…y no en (0,0), que en este tile es el interior de la taberna",
    Math.abs(posDespues.x) > 0.01 || Math.abs(posDespues.z) > 0.01,
    JSON.stringify(posDespues),
  );
  ctx.expect(
    "…ni en el `__player_start` de la escena: se PERSISTIÓ, no se cayó al arranque",
    Math.hypot(posDespues.x - (arranque?.x ?? 0), posDespues.z - (arranque?.z ?? 0)) >= 1.5,
    `reanudó en ${JSON.stringify(posDespues)} · __player_start ${JSON.stringify(arranque)}`,
  );
  // La vida se mide aquí porque el resume la resiembra en el sim y el HUD la
  // pinta; lo que este guion NO puede es bajarla (no hay quien pegue en el
  // tile del bench), así que solo caza el fallo GRUESO — que reanudar te deje
  // sin vida. Que el daño SOBREVIVA al resume lo canda el test de unidad
  // `un guardado cualquiera del bridge lleva la posición y la vida VIVAS`,
  // que sí puede herir al combatiente.
  const vidaDespues = await ctx.page.evaluate(
    () => Number(document.getElementById("player-hp-text")?.textContent ?? "0"),
  );
  ctx.expect(
    "…y con la vida que tenía",
    vidaDespues === vidaAntes,
    `${vidaAntes} → ${vidaDespues}`,
  );

  // ── 5. Todo sigue ahí, leído por el mismo cable del motor ────────────────
  const salud2 = await api("GET", "/health");
  ctx.expect(
    "el bridge reanudó ESA sesión",
    salud2.body?.session_id === sessionId,
    `${salud2.body?.session_id} ≠ ${sessionId}`,
  );

  const lugar = await api("GET", "/map/place/qa_vado");
  ctx.expect(
    "el lugar que creó el motor sobrevive al resume",
    lugar.status === 200 && lugar.body?.place?.id === "qa_vado",
    `${lugar.status} ${JSON.stringify(lugar.body).slice(0, 200)}`,
  );
  ctx.expect(
    "…y su enlace con la ermita también",
    (lugar.body?.outgoing_links ?? []).some((l) => l.to === "qa_ermita"),
    JSON.stringify(lugar.body?.outgoing_links),
  );
  ctx.expect(
    "…y el trigger que el motor dejó escrito en él",
    (lugar.body?.place?.triggers ?? []).some((t) => t.id === "qa_trigger_vado"),
    JSON.stringify(lugar.body?.place?.triggers),
  );

  const inv = await api("GET", `/entity/${npcId}/inventory`);
  const items = (inv.body?.inventory ?? []).map((i) => i.id);
  ctx.expect(
    "el objeto que el motor dio sigue en el inventario",
    items.includes("qa_amuleto"),
    JSON.stringify(inv.body),
  );
  ctx.expect("…y el que quitó sigue quitado", !items.includes("qa_cuerda"), JSON.stringify(items));

  const npc = await api("GET", `/npc/${npcId}`);
  ctx.expect(
    "el NPC sigue donde el director lo dejó llegar",
    npc.status === 200 && npc.body?.current_place_id === "qa_ermita",
    `${npc.status} ${JSON.stringify(npc.body)}`,
  );
  ctx.expect(
    "…con la directiva que le fijó el motor",
    npc.body?.directive?.type === "guard",
    JSON.stringify(npc.body?.directive),
  );

  const refs = await api("GET", "/sessions/asset_refs");
  ctx.expect(
    "las refs de escena que el motor registró siguen en la keep-list del prune",
    (refs.body?.refs ?? []).includes("qa_hash_de_reanudar"),
    JSON.stringify(refs.body).slice(0, 200),
  );

  const sistemas = await api("GET", "/plugins");
  ctx.expect(
    "el sistema de juego que el motor creó sigue vivo tras reanudar",
    (sistemas.body?.plugins ?? []).some((p) => p.name === "qa_reanudar"),
    JSON.stringify(sistemas.body).slice(0, 300),
  );
  if (pluginId) {
    const detalle = await api("GET", `/plugins/${pluginId}/inspect`);
    ctx.expect(
      "…y su slice se recuperó del save, no de cero",
      detalle.status === 200 && detalle.body?.slice?.cruces === 0,
      `${detalle.status} ${JSON.stringify(detalle.body).slice(0, 200)}`,
    );
  }

  // La otra mitad del contrato del flag: una LECTURA del motor NO puede
  // reescribir el save. Un `mutated: true` de más no rompe nada visible —
  // simplemente el bridge escribe el state.json entero cada vez que el motor
  // mira el mapa. Se mide sobre el fichero de verdad: `updated_at` lo pone
  // `narrative.save()` en cada escritura, así que si no hay escritura no
  // cambia.
  const marcaAntes = marcaDeGuardado(sessionId);
  ctx.expect(
    "el save de la sesión está en el disco del bench (si no, no hay nada que medir)",
    marcaAntes !== null,
    `no se encontró state.json de ${sessionId}`,
  );
  const lecturas = ["/map", "/entities", `/entity/${npcId}`, "/story", "/npcs/in_transit", "/plugins"];
  for (const ruta of lecturas) await api("GET", ruta);
  const marcaDespues = marcaDeGuardado(sessionId);
  ctx.expect(
    `${lecturas.length} LECTURAS seguidas del motor no reescriben el save`,
    marcaAntes !== null && marcaAntes === marcaDespues,
    `${marcaAntes} → ${marcaDespues}`,
  );

  // Y la contraria, para que el aserto de arriba no sea un verde vacío: una
  // ESCRITURA sí lo reescribe. Sin esto, un save que nadie escribe nunca
  // pasaría los dos.
  await api("POST", "/map/place", {
    id: "qa_testigo",
    kind: "site",
    parent_id: null,
    name: "Piedra testigo",
    description: "Existe para demostrar que el save se puede reescribir.",
  });
  ctx.expect(
    "…pero UNA escritura sí lo reescribe (el aserto de arriba no es un verde vacío)",
    marcaDespues !== null && marcaDeGuardado(sessionId) !== marcaDespues,
    `${marcaDespues} → ${marcaDeGuardado(sessionId)}`,
  );
}

/** El `state.json` de disco de una sesión, parseado. null si no existe. */
function leerSave(sessionId) {
  const f = rutaDelSave(sessionId);
  if (!f) return null;
  try {
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return null;
  }
}

/** Huella del save EN DISCO: hash del `state.json` entero. Se usa el
 *  contenido y no la fecha del fichero a propósito — un mtime es un reloj, y
 *  dos escrituras seguidas pueden caer en el mismo milisegundo; el contenido
 *  cambia siempre, aunque solo sea por el `updated_at` que escribe
 *  `narrative.save()`.
 *
 *  El disco del bench es el efímero del runner (`qa/.tmp/<corrida>/saves`), y
 *  este guion solo corre con stack propio porque declara `aisla: ["saves"]`:
 *  contra un stack ajeno el runner ni lo arranca. Devuelve null si no hay
 *  save, que es distinto de «no cambió». `rutaDelSave` vive en `qa/lib/saves.mjs`
 *  desde #279, donde la comparten la espera de `comenzar()` y el delta del
 *  guion 27. */
function marcaDeGuardado(sessionId) {
  const f = rutaDelSave(sessionId);
  return f ? createHash("sha1").update(readFileSync(f)).digest("hex") : null;
}

