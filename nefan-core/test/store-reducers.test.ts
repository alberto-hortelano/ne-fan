/** Cada evento del reducer escribe LO SUYO, y solo lo suyo.
 *
 *  `applyReducer` es el único camino de escritura del runtime volátil
 *  (posición, cámara, HP, combate, arma, meta): todo lo que el bridge cambia
 *  del estado vivo pasa por aquí. Y hasta esta tanda casi nada lo asserteaba —
 *  la mutación medía 19 % sobre `reducers.ts`: los tests PASABAN por cada
 *  `case` (a través del sim y de la proyección de estado) sin que ningún
 *  aserto se enterase de que el `case` cambiaba de nombre, de que un `??`
 *  pasaba a `&&` o de que un `if` se invertía.
 *
 *  Se descubrió al borrar el estado muerto de sala (#175): al irse
 *  `room_changed`/`room_visited` —diez mutantes bien matados— el módulo cayó
 *  POR DEBAJO de su break sin que el código que quedaba hubiera empeorado. La
 *  respuesta no es bajar el break: es que estos `case` nunca tuvieron dueño.
 *
 *  Dos formas de comprobar cada uno, porque matan cosas distintas:
 *    · con el campo en el payload  → el `case` hace su trabajo,
 *    · sin el campo               → NO pisa lo que había (el `??`, no un `&&`).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GameStore } from "../src/store/game-store.js";
import type { EnemyState } from "../src/types.js";

function enemigo(id: string, over: Partial<EnemyState> = {}): EnemyState {
  return {
    id,
    pos: [0, 0, 0],
    hp: 100,
    max_hp: 100,
    weapon_id: "short_sword",
    combat_state: "idle",
    alive: true,
    ...over,
  };
}

/** Store con dos enemigos proyectados: lo mínimo para distinguir "cambia el
 *  que toca" de "cambian todos" y de "no cambia ninguno". */
function conEnemigos(): GameStore {
  const store = new GameStore();
  store.dispatch("enemies_projected", { enemies: [enemigo("skel_1"), enemigo("skel_2")] });
  return store;
}

const enemigoDe = (store: GameStore, id: string): EnemyState =>
  store.state.enemies.find((e) => e.id === id)!;

describe("applyReducer — el jugador", () => {
  it("camera_rotated escribe yaw y pitch; sin el campo, conserva el que había", () => {
    const store = new GameStore();
    store.dispatch("camera_rotated", { yaw: 1.5, pitch: -0.25 });
    assert.equal(store.state.player.camera_yaw, 1.5);
    assert.equal(store.state.player.camera_pitch, -0.25);

    // Girar solo en horizontal no debe enderezar la mirada (ni al revés): el
    // cliente manda los dos por separado según el eje que se haya movido.
    store.dispatch("camera_rotated", { yaw: 2 });
    assert.equal(store.state.player.camera_yaw, 2);
    assert.equal(store.state.player.camera_pitch, -0.25, "el pitch no se toca sin pitch");

    store.dispatch("camera_rotated", { pitch: 0.5 });
    assert.equal(store.state.player.camera_yaw, 2, "el yaw no se toca sin yaw");
    assert.equal(store.state.player.camera_pitch, 0.5);
  });

  it("camera_rotated admite el 0 (mirar al frente NO es 'no mandes nada')", () => {
    // El caso que separa `!== undefined` de un truthy: 0 es un ángulo válido,
    // y con la comprobación equivocada el jugador no podría volver al frente.
    const store = new GameStore();
    store.dispatch("camera_rotated", { yaw: 1, pitch: 1 });
    store.dispatch("camera_rotated", { yaw: 0, pitch: 0 });
    assert.equal(store.state.player.camera_yaw, 0);
    assert.equal(store.state.player.camera_pitch, 0);
  });

  it("player_damaged y player_healed fijan el HP nuevo; sin él, no lo tocan", () => {
    const store = new GameStore();
    store.dispatch("player_damaged", { new_hp: 62 });
    assert.equal(store.state.player.hp, 62);
    store.dispatch("player_healed", { new_hp: 88 });
    assert.equal(store.state.player.hp, 88);

    // Un evento sin `new_hp` es un evento mal formado: conservar el HP es la
    // degradación buena. Con `&&` en vez de `??`, el jugador quedaría a
    // `undefined` de vida.
    store.dispatch("player_damaged", {});
    assert.equal(store.state.player.hp, 88);
    store.dispatch("player_healed", {});
    assert.equal(store.state.player.hp, 88);
  });

  it("player_died deja 0 de vida y el estado de combate en 'dead'", () => {
    const store = new GameStore();
    store.dispatch("player_damaged", { new_hp: 5 });
    store.dispatch("player_died", {});
    assert.equal(store.state.player.hp, 0);
    assert.equal(store.state.player.combat_state, "dead");
  });

  it("player_respawned restaura vida y postura, y mueve si le dan posición", () => {
    const store = new GameStore();
    store.dispatch("player_died", {});
    store.dispatch("player_respawned", { hp: 40, pos: [3, 0, -7] });
    assert.equal(store.state.player.hp, 40);
    assert.equal(store.state.player.combat_state, "idle", "revivir sale del estado 'dead'");
    assert.deepEqual(store.state.player.pos, [3, 0, -7]);
  });

  it("player_respawned sin hp devuelve el MÁXIMO, y sin pos no teletransporta", () => {
    const store = new GameStore();
    store.dispatch("player_moved", { pos: [9, 0, 9] });
    store.dispatch("player_damaged", { new_hp: 1 });
    store.dispatch("player_respawned", {});
    assert.equal(store.state.player.hp, store.state.player.max_hp);
    assert.deepEqual(store.state.player.pos, [9, 0, 9], "sin pos se respawnea donde estaba");
  });

  it("weapon_changed cambia el arma; sin id, conserva la que llevaba", () => {
    const store = new GameStore();
    const inicial = store.state.player.weapon_id;
    store.dispatch("weapon_changed", { weapon_id: "war_hammer" });
    assert.equal(store.state.player.weapon_id, "war_hammer");
    store.dispatch("weapon_changed", {});
    assert.equal(store.state.player.weapon_id, "war_hammer", `y nunca vuelve a ${inicial}`);
  });

  it("meta_update copia CADA clave del payload, sin tocar el resto del estado", () => {
    const store = new GameStore();
    store.dispatch("meta_update", { fps: 59, elapsed_ms: 1234 });
    assert.equal(store.state.meta.fps, 59);
    assert.equal(store.state.meta.elapsed_ms, 1234);
    assert.equal(store.state.meta.recording, false, "lo que no viene en el payload no cambia");
    store.dispatch("meta_update", { recording: true });
    assert.equal(store.state.meta.recording, true);
    assert.equal(store.state.meta.fps, 59);
  });
});

describe("applyReducer — el combate distingue al jugador de los enemigos", () => {
  it("attack_started del JUGADOR fija su postura y el tipo de ataque", () => {
    const store = conEnemigos();
    store.dispatch("attack_started", { attacker_id: "player", type: "heavy" });
    assert.equal(store.state.player.combat_state, "winding_up");
    assert.equal(store.state.player.attack_type, "heavy");
    assert.equal(enemigoDe(store, "skel_1").combat_state, "idle", "no arranca el ataque de nadie más");
  });

  it("attack_started de un ENEMIGO no toca al jugador, y solo mueve a ese enemigo", () => {
    const store = conEnemigos();
    store.dispatch("attack_started", { attacker_id: "skel_2", type: "quick" });
    assert.equal(enemigoDe(store, "skel_2").combat_state, "winding_up");
    assert.equal(enemigoDe(store, "skel_1").combat_state, "idle");
    assert.equal(store.state.player.combat_state, "idle", "el jugador no se pone a atacar solo");
    assert.equal(store.state.player.attack_type, "", "ni hereda el tipo de ataque ajeno");
  });

  it("attack_landed aplica el HP al objetivo que toca, jugador o enemigo", () => {
    const store = conEnemigos();
    store.dispatch("attack_landed", { target_id: "player", new_hp: 71 });
    assert.equal(store.state.player.hp, 71);
    assert.equal(enemigoDe(store, "skel_1").hp, 100, "el golpe al jugador no daña a los enemigos");

    store.dispatch("attack_landed", { target_id: "skel_1", new_hp: 45 });
    assert.equal(enemigoDe(store, "skel_1").hp, 45);
    assert.equal(enemigoDe(store, "skel_2").hp, 100, "ni al de al lado");
    assert.equal(store.state.player.hp, 71, "ni al jugador");
  });

  it("enemy_damaged baja el HP de ESE enemigo", () => {
    const store = conEnemigos();
    store.dispatch("enemy_damaged", { enemy_id: "skel_2", new_hp: 30 });
    assert.equal(enemigoDe(store, "skel_2").hp, 30);
    assert.equal(enemigoDe(store, "skel_1").hp, 100);
  });

  it("enemy_died lo marca muerto Y a cero: sin las dos cosas queda un zombi", () => {
    const store = conEnemigos();
    store.dispatch("enemy_damaged", { enemy_id: "skel_1", new_hp: 3 });
    store.dispatch("enemy_died", { enemy_id: "skel_1" });
    assert.equal(enemigoDe(store, "skel_1").alive, false);
    assert.equal(enemigoDe(store, "skel_1").hp, 0);
    assert.equal(enemigoDe(store, "skel_2").alive, true, "el otro sigue vivo");
  });

  it("combat_state_changed cambia la postura del jugador o la del enemigo, nunca las dos", () => {
    const store = conEnemigos();
    store.dispatch("combat_state_changed", { entity_id: "player", state: "recovering" });
    assert.equal(store.state.player.combat_state, "recovering");
    assert.equal(enemigoDe(store, "skel_1").combat_state, "idle");

    store.dispatch("combat_state_changed", { entity_id: "skel_1", state: "stunned" });
    assert.equal(enemigoDe(store, "skel_1").combat_state, "stunned");
    assert.equal(store.state.player.combat_state, "recovering");
  });

  it("un enemigo que no está en la lista no crea uno ni pisa al primero", () => {
    // `updateEnemy` busca por id y NO hace nada si no lo encuentra: un evento
    // de un enemigo de otro tile llega tarde y no debe matar al que sí está.
    const store = conEnemigos();
    store.dispatch("enemy_died", { enemy_id: "fantasma" });
    assert.equal(store.state.enemies.length, 2);
    assert.deepEqual(store.state.enemies.map((e) => e.alive), [true, true]);
    assert.deepEqual(store.state.enemies.map((e) => e.hp), [100, 100]);
  });

  it("un evento desconocido no altera nada del estado", () => {
    // El `switch` no tiene `default`: lo que no reconoce, lo ignora. Es lo que
    // permite que el bridge emita eventos que este store no proyecta.
    const store = conEnemigos();
    const antes = JSON.stringify(store.snapshot());
    store.dispatch("evento_que_no_existe", { hp: 0, new_hp: 0, enemy_id: "skel_1" });
    assert.equal(JSON.stringify(store.snapshot()), antes);
  });
});
