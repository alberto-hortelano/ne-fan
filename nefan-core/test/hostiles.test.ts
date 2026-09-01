/** El combate de un hostil lo deriva el CORE, no el modelo.
 *
 *  Es la única fuente del bloque `combat`, y de ella tiran las dos vías de
 *  spawn (`formatDToWorld` y `dispatchConsequences`). Lo que se comprueba aquí
 *  es (a) que solo un rol hostil produce combate —un aldeano con `combat` lo
 *  registraría el cliente como combatiente— y (b) que el bloque llega ENTERO
 *  con lo que el sim y el cliente exigen: sin `combat_range` o sin
 *  `preferred_attacks` el enemigo se descarta en la puerta del cliente y el
 *  jugador se queda otra vez sin nadie a quien pegar.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  combatForHostileRole,
  HOSTILE_HEALTH,
  HOSTILE_WEAPON,
  HOSTILE_AGGRO_M,
} from "../src/combat/hostiles.js";
import { AMBIENT_ROLES } from "../src/simulation/npc-roles.js";

describe("combatForHostileRole — hostilidad declarada, números derivados", () => {
  it("un rol hostil trae vida, arma y personalidad completas", () => {
    const c = combatForHostileRole("hostile");
    assert.ok(c, "un `role:\"hostile\"` tiene que producir combate");
    assert.equal(c.health, HOSTILE_HEALTH);
    assert.ok(c.health > 0, "un enemigo con 0 de vida nace muerto");
    // El DENOMINADOR viaja aparte de la vida, aunque recién derivado valgan lo
    // mismo. Sin él, un herido que vuelve de un save (`escenaConCombateVivo` le
    // baja `health` y deja este) se pintaría con la barra llena y la IA lo
    // trataría como entero — el bug que #326 hace inexpresable.
    assert.equal(c.max_health, HOSTILE_HEALTH);
    assert.equal(c.health, c.max_health, "quien nace, nace entero");
    assert.equal(c.weapon_id, HOSTILE_WEAPON);
    assert.notEqual(c.weapon_id, "", "un arma vacía la rechaza el cliente en la puerta");

    // Los cuatro que el cliente exige numéricos/no vacíos (enemigo.ts) y que
    // el sim consume para mover y golpear. No se comprueba «que estén»: se
    // comprueba que son utilizables, que es lo que falla en producción.
    const p = c.personality;
    for (const k of ["aggression", "reaction_time", "combat_range", "move_speed"]) {
      assert.equal(typeof p[k], "number", `personality.${k} no es un número`);
      assert.ok(Number.isFinite(p[k] as number), `personality.${k} no es finito`);
    }
    assert.ok(Array.isArray(p.preferred_attacks) && p.preferred_attacks.length > 0);
    assert.ok(
      (p.preferred_attacks as unknown[]).every((a) => typeof a === "string" && a),
      "preferred_attacks tiene que ser una lista de ids de ataque",
    );
  });

  it("y CIERRA con el jugador: si esperase a que se le acerquen, no habría pelea", () => {
    // El único rastro de combate del repositorio (julio de 2026) es un bandido
    // quieto en hp:200. Un hostil que no busca al jugador se ve exactamente
    // igual que no tener enemigos, así que esto no es cosmético.
    const p = combatForHostileRole("hostile")!.personality;
    assert.ok((p.aggression as number) > 0, "un hostil sin agresividad no ataca");
    assert.ok(
      (p.preferred_distance as number) < (p.combat_range as number),
      `se planta a ${p.preferred_distance} m con alcance ${p.combat_range}: nunca llegaría a pegar`,
    );

    // Y los NÚMEROS, escritos a mano — la corrida de mutación del 2026-08-31
    // (`e67f53c`) dejó vivos los tres literales de esta línea porque lo de
    // arriba solo mide RELACIONES, y una relación la cumplen también los
    // valores de otro preset. Que `aggressive` degrade a `neutral` no rompe
    // `preferred_distance < combat_range` (2,5 < 4,0 sigue siendo cierto):
    // simplemente el enemigo se planta un metro más lejos y ya no cierra.
    assert.equal(
      p.preferred_distance,
      1.5,
      "el hostil es `aggressive`: se planta a 1,5 m. Con `neutral` (2,5 m) vuelve a mirar de lejos",
    );
    // El radio de aggro viaja en el override, y un override que se pierda no
    // rompe nada visible: el bloque sigue completo y el cliente lo registra
    // igual — el enemigo simplemente no se entera de que llegaste.
    assert.equal(
      p.aggro_radius,
      HOSTILE_AGGRO_M,
      "sin `aggro_radius` en el bloque, el enemigo nunca decide perseguir",
    );
    assert.ok(
      (p.aggro_radius as number) > (p.preferred_distance as number),
      "detectar tiene que pasar ANTES que pegar, o el aggro no sirve de nada",
    );
  });

  it("ningún rol ambiental produce combate, ni un rol inventado ni la ausencia", () => {
    for (const role of AMBIENT_ROLES) {
      assert.equal(combatForHostileRole(role), undefined, `el rol ${role} produjo combate`);
    }
    for (const x of [undefined, null, "", "enemy", "hostil", "Hostile", "bandido", 7, {}]) {
      assert.equal(
        combatForHostileRole(x),
        undefined,
        `${JSON.stringify(x)} produjo combate`,
      );
    }
  });

  it("dos hostiles del mismo rol salen IGUALES (el balance es reproducible)", () => {
    // Es el argumento por el que los números no los escribe el LLM: dos
    // partidas del mismo mundo tienen que dar la misma pelea.
    assert.deepEqual(combatForHostileRole("hostile"), combatForHostileRole("hostile"));
  });

  it("cada hostil lleva SU objeto: tocar uno no toca al de al lado", () => {
    // El sim guarda la personalidad por combatiente; compartir la referencia
    // haría que subirle la agresividad a un bandido se la subiera a todos.
    const a = combatForHostileRole("hostile")!;
    const b = combatForHostileRole("hostile")!;
    assert.notEqual(a.personality, b.personality);
    (a.personality as Record<string, unknown>).aggression = 99;
    assert.notEqual(b.personality.aggression, 99);
  });
});
