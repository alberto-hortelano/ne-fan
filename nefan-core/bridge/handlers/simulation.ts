/** Handlers del hot loop: input, load_room, respawn y add_combatants. */

import { createCombatant } from "../../src/combat/combatant.js";
import { combatRegistry } from "../../src/combat/registry.js";
import {
  avisoDeCriba,
  cribarHostiles,
  type CribaDeHostiles,
} from "../../src/combat/criba-de-hostiles.js";
import { activateByPosition } from "./tile.js";
import { guardarOAvisar } from "../guardar.js";
import { vaciarPluginsActivos } from "../plugins-activos.js";
import {
  getEnemyStates,
  getNpcStates,
  npcLabel,
  type BridgeContext,
  type ClientSocket,
} from "../context.js";
import type { NpcBehaviorEvent } from "../../src/simulation/npc-behavior.js";
import type {
  InputMessage,
  AddCombatantsMessage,
  LoadRoomMessage,
  RespawnMessage,
  StateUpdateMessage,
  SinDuenoDelSim,
} from "../../src/protocol/messages.js";

/** El arma y el máximo de vida del jugador, que son del STORE: el bridge se
 *  los da al sim al sembrar al combatiente y desde #504 los pone además en
 *  cada `state_update`, porque el cliente los necesita para pintar la barra de
 *  vida y el aro del telegraph y hasta entonces se los inventaba con dos
 *  literales suyos que no podían cambiar nunca.
 *
 *  El HP VIVO no entra aquí a propósito: lo lee cada emisor del sim con su
 *  propia caída (0 en el hot loop, 100 en los one-shot), y colapsarlas sería
 *  cambiar de conducta de tapadillo. El `|| 100` del máximo es el que ya tenía
 *  `handleLoadRoom`: `state.player` lo pueden parchear los plugins
 *  (`plugins/dispatcher.ts`, root "player") y un máximo a 0 dejaría al cliente
 *  dividiendo por cero la barra de vida. */
function estadoDelJugador(ctx: BridgeContext): { playerMaxHp: number; playerWeaponId: string } {
  return {
    playerMaxHp: ctx.store.state.player.max_hp || 100,
    playerWeaponId: ctx.store.state.player.weapon_id,
  };
}

/** EL DESENLACE de un lote con algún enemigo que no sirve (#529), y es UNO
 *  para las dos puertas del cliente (`add_combatants` y `load_room`).
 *
 *  Quién NO sirve lo dice `cribarHostiles`, sobre el criterio único de core
 *  (`parseHostileCombat`); aquí solo se decide dónde va el motivo, que es lo
 *  que ninguna función pura puede hacer: el diagnóstico técnico al log del
 *  bridge —una línea por enemigo, con su id y su motivo verbatim, que es lo
 *  que el guion 90 compara contra el registro del cliente— y el aviso para
 *  quien juega al socket que mandó el frame, UNICAST y con el sello que pone
 *  el transporte.
 *
 *  `kind:"combatientes"` y no `protocolo`: esto NO es un frame ilegible, es un
 *  lote del que entró una parte, y su rótulo (`status-rotulo.ts`) va a la
 *  línea de mensajes y no al modal. Antes del 2026-09-14 el criterio vivía en
 *  el intake y el frame entero moría con el peor de sus enemigos.
 *
 *  Es el `null` del aviso el que decide si se avisa, y no un `length === 0`
 *  escrito aquí: un segundo sitio donde preguntar «¿hay descartes?» es un
 *  segundo sitio donde equivocarse. */
function avisarDeLosDescartados(
  criba: CribaDeHostiles,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  const aviso = avisoDeCriba(criba);
  if (aviso === null) return;
  for (const d of criba.descartes) {
    console.warn(`Bridge: enemigo "${d.id}" descartado: ${d.motivo}`);
  }
  ctx.enviarNarrativo(ws, {
    type: "narrative_status",
    phase: "error",
    kind: "combatientes",
    ...aviso,
  });
}

export async function handleInput(
  msg: InputMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  // Escribe en el sim quien TIENE EL MUNDO (`bridge/world-claim.ts`).
  if (!ctx.world.canDrive(ws)) return;
  // Sim aún sin sembrar (title screen, o bridge recién reiniciado antes del
  // resume): responder aquí con playerHp 0 haría que el cliente matara al
  // player. Sin combatiente no hay nada que simular ni reportar.
  if (!ctx.sim.getCombatant("player")) return;
  const result = ctx.sim.tick(msg.delta, msg.inputs);

  const playerPos = msg.inputs.playerPosition;
  // Mantén store.player.pos al día: los position hints de los spawns
  // narrativos (dialogue.ts) y fireMapTriggers se resuelven contra él.
  ctx.store.dispatch("player_moved", { pos: [playerPos.x, playerPos.y, playerPos.z] });
  // Mundo continuo: el tile/place activos se deciden por POSICIÓN (gateado
  // por cambio de celda dentro de activateByPosition).
  if (ctx.world.kind === "session") await activateByPosition(ctx, playerPos.x, playerPos.z);

  // Transiciones de la vida ambiental → log para el LLM + cierre del transit
  // del NpcDirector. Son eventos one-shot del FSM (no per-tick), así que el
  // volumen es bajo; el save llega con el siguiente save normal.
  for (const ev of result.npcEvents) applyNpcEvent(ctx, ev);

  // UNA MUERTE TIENE QUE LLEGAR AL DISCO. Hasta #326 `enemy_died` solo tocaba
  // el store volátil y `handleInput` no guardaba nunca: matar a un enemigo y
  // cerrar el juego lo devolvía vivo y entero (medido jugando en el QA de
  // #323). El save vuelca la vida viva de los combatientes, así que basta con
  // provocarlo — y se provoca UNA vez por tick con muertes, no una por muerte.
  //
  // Fail-loud del bridge (`guardarOAvisar`, que también gatea por «esta
  // partida escucha al sim»): si el guardado falla, el muerto resucitará al
  // reanudar y el jugador tiene que enterarse AHORA, no entonces. `save` y no
  // `consequences` (#352): lo que peligra es el save, no el motor.
  const muertes = result.events.filter(
    (e) => e.type === "died" && e.combatantId !== "player",
  );
  if (muertes.length > 0) {
    await guardarOAvisar(
      ctx,
      "la muerte de un enemigo",
      "El enemigo al que acabas de matar podría seguir vivo si reanudas la partida.",
    );
  }

  ctx.enviarEstado(ws, {
    type: "state_update",
    events: result.events,
    playerHp: ctx.sim.getCombatant("player")?.health ?? 0,
    ...estadoDelJugador(ctx),
    enemies: getEnemyStates(ctx),
    npcs: getNpcStates(ctx),
  });
}

function applyNpcEvent(ctx: BridgeContext, ev: NpcBehaviorEvent): void {
  const who = npcLabel(ctx, ev.npcId);
  switch (ev.type) {
    case "npc_reached_place": {
      // Si el NPC estaba in_transit hacia ese place (npc_move_to_place), la
      // llegada física la declara el sim — no hace falta esperar al LLM.
      const info = ctx.npcDirector.getNpcPlace(ev.npcId);
      if (info?.in_transit && info.in_transit.to === ev.placeId) {
        const res = ctx.npcDirector.arriveNpc(ev.npcId);
        if (!res.ok) console.warn(`Bridge: arriveNpc(${ev.npcId}) falló: ${res.error}`);
      }
      const placeName = ev.placeId
        ? ctx.narrative.worldMap.get(ev.placeId)?.name ?? ev.placeId
        : "su destino";
      ctx.narrative.appendAmbient(`${who} llegó a ${placeName}`);
      return;
    }
    case "npc_reached_npc":
      ctx.narrative.appendAmbient(`${who} fue a ver a ${npcLabel(ctx, ev.targetId ?? "")}`);
      return;
    case "npc_fled_combat":
      ctx.narrative.appendAmbient(`${who} huyó de una pelea cercana`);
      return;
    case "npc_intervened":
      ctx.narrative.appendAmbient(`${who} intervino en una pelea cercana`);
      return;
    case "npc_resumed":
      ctx.narrative.appendAmbient(`${who} retomó su rutina al calmarse la pelea`);
      return;
  }
}

export function handleLoadRoom(
  msg: LoadRoomMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  // Con sesión narrativa activa, cambiar de escena NO cura: se preserva el
  // HP del combatiente vivo (leído antes del reset). Sin sesión (rooms de
  // test legacy) se mantiene el arranque a tope de vida.
  const livePlayer = ctx.sim.getCombatant("player");
  const { playerMaxHp, playerWeaponId } = estadoDelJugador(ctx);
  const inSession = ctx.narrative.session_id !== "" && livePlayer !== undefined;
  const playerHp = inSession ? livePlayer!.health : playerMaxHp;
  // Cargar una fixture del selector «Room» es TOMAR EL MUNDO para una escena
  // de prueba: conduce quien la cargó y la partida guardada deja de escuchar
  // al sim — lo que ande por aquí es un muñeco, no el jugador de nadie. Si el
  // mundo lo tiene OTRO socket no se toca nada: una pestaña ajena no le
  // congela la partida a quien está jugando.
  if (!ctx.world.claimForFixture(ws)) return;
  // Y por lo mismo, los sistemas del juego tampoco la miran (#368): una escena
  // de prueba no hereda los plugins de la partida que hubiera, ni los de la
  // sesión efímera de una pre-generación. Volver a la partida es un resume, y
  // el resume los re-ata desde el save.
  vaciarPluginsActivos(ctx);
  // Reset simulation for new room
  ctx.sim.reset();
  // Sin sesión (fixtures legacy), el cliente asume el catálogo ESTÁNDAR: el
  // sim debe coincidir — si conservara el sistema de la sesión anterior
  // (p.ej. basic), un ataque "quick" del cliente lanzaría en cada tick.
  if (ctx.narrative.session_id === "") {
    ctx.sim.setCombatSystem(combatRegistry.create(undefined, ctx.combatConfig));
  }
  ctx.store.dispatch("player_respawned", { hp: playerHp, pos: [0, 0, 0] });
  ctx.sim.addCombatant(
    createCombatant(
      "player",
      playerHp,
      playerWeaponId,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
    ),
  );

  // Set room bounds for AI clamping
  if (msg.dimensions) {
    ctx.sim.setRoomBounds(msg.dimensions.width, msg.dimensions.depth);
  }

  // Add enemies from room data. El lote se criba ENEMIGO A ENEMIGO (#529): el
  // que no sirve se cae solo y los demás entran, que es lo que hace el cliente
  // con el mismo criterio. Los valores que entran al sim son los del PARSER
  // (`alta.combat`), no los del cable: el parser reescribe los tres números ya
  // comprobados de la personalidad.
  const criba = cribarHostiles(msg.enemies);
  for (const alta of criba.altas) {
    const combatant = createCombatant(
      alta.id,
      alta.hostil.health,
      alta.hostil.weapon_id,
      alta.position,
      { x: 0, y: 0, z: 1 }, // Default forward
      alta.hostil.max_health,
    );
    ctx.sim.addCombatant(combatant, alta.hostil.personality);
  }

  ctx.store.dispatch("enemies_projected", {
    enemies: criba.altas.map((a) => ({
      id: a.id,
      pos: [a.position.x, a.position.y, a.position.z],
      hp: a.hostil.health,
      max_hp: a.hostil.max_health,
      weapon_id: a.hostil.weapon_id,
      combat_state: "idle",
      alive: true,
    })),
  });

  console.log(
    `Bridge: room loaded '${msg.roomId}' with ${criba.altas.length} enemies` +
      (criba.descartes.length > 0 ? ` (${criba.descartes.length} descartado(s))` : ""),
  );
  avisarDeLosDescartados(criba, ws, ctx);
  // Send state_update with the (possibly preserved) HP so the client syncs.
  // In-session, this is a scene TRANSITION, not a respawn: emitting the
  // player_respawned event would make the client run its respawn side-effects
  // (teleport to the spawn point and refill HP, clobbering a resume's restored
  // position). Legacy no-session loads keep the event.
  const roomResponse: SinDuenoDelSim<StateUpdateMessage> = {
    type: "state_update",
    events: inSession ? [] : [{ type: "player_respawned", hp: playerHp }],
    playerHp: playerHp,
    playerMaxHp,
    playerWeaponId,
    enemies: getEnemyStates(ctx),
  };
  ctx.enviarEstado(ws, roomResponse);
}

export function handleRespawn(msg: RespawnMessage, ws: ClientSocket, ctx: BridgeContext): void {
  // Reaparecer MUEVE al jugador, y con el save escuchando al sim eso acaba en
  // el `state.json`: mismo dueño que el input.
  if (!ctx.world.canDrive(ws)) return;
  const events = ctx.sim.respawn(msg.pos);
  const response: SinDuenoDelSim<StateUpdateMessage> = {
    type: "state_update",
    events,
    playerHp: ctx.sim.getCombatant("player")?.health ?? 100,
    ...estadoDelJugador(ctx),
    enemies: getEnemyStates(ctx),
  };
  ctx.enviarEstado(ws, response);
  console.log("Bridge: player respawned");
}

/** Alta ADITIVA de combatientes (enemigos de un tile recién cargado en el
 *  cliente). No resetea el sim ni toca bounds: los combatientes de otros
 *  tiles siguen vivos — el mundo es un plano continuo, no una arena. Ids ya
 *  presentes se ignoran (re-entrada a un tile). */
export function handleAddCombatants(
  msg: AddCombatantsMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  // Poblar el mundo también es escribir en él: mismo dueño.
  if (!ctx.world.canDrive(ws)) return;
  const projected = [...ctx.store.state.enemies];
  let added = 0;
  // Mismo desenlace que en `load_room` y que en el cliente (#529): cada
  // enemigo responde de sí mismo, y los valores que entran al sim son los del
  // parser, no los del cable.
  const criba = cribarHostiles(msg.enemies);
  for (const alta of criba.altas) {
    if (ctx.sim.getCombatant(alta.id)) continue;
    ctx.sim.addCombatant(
      createCombatant(
        alta.id,
        alta.hostil.health,
        alta.hostil.weapon_id,
        alta.position,
        { x: 0, y: 0, z: 1 },
        alta.hostil.max_health,
      ),
      alta.hostil.personality,
    );
    // Proyección al store (getEnemyStates itera store.enemies): CONCAT, no
    // reemplazo — los enemigos de otros tiles siguen vivos.
    if (!projected.some((p) => p.id === alta.id)) {
      projected.push({
        id: alta.id,
        pos: [alta.position.x, alta.position.y, alta.position.z],
        hp: alta.hostil.health,
        max_hp: alta.hostil.max_health,
        weapon_id: alta.hostil.weapon_id,
        combat_state: "idle",
        alive: true,
      });
    }
    added++;
  }
  if (added > 0) {
    ctx.store.dispatch("enemies_projected", { enemies: projected });
    console.log(`Bridge: ${added} combatiente(s) añadidos (aditivo)`);
  }
  avisarDeLosDescartados(criba, ws, ctx);
  const response: SinDuenoDelSim<StateUpdateMessage> = {
    type: "state_update",
    events: [],
    playerHp: ctx.sim.getCombatant("player")?.health ?? 100,
    ...estadoDelJugador(ctx),
    enemies: getEnemyStates(ctx),
  };
  ctx.enviarEstado(ws, response);
}
