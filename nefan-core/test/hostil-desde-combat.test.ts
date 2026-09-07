/** El único criterio de «qué es un enemigo utilizable» (PR 6 de #241).
 *
 *  Cada caso de la tabla escribe a mano el motivo esperado: el motivo NO es
 *  decoración, es lo que ve el jugador en el registro del cliente y lo que el
 *  bridge escribe en su log al rechazar el frame, y comprobar solo `ok:false`
 *  dejaría vivo el mutante que cambia un rechazo por otro. El último bloque es
 *  el que da sentido a la PR: la puerta del cliente (`parseHostileCombat`) y la
 *  del bridge (`ClientMessageSchema`) contestan lo MISMO al mismo bloque. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseHostileCombat } from "../src/combat/hostil-desde-combat.js";
import { combatForHostileRole } from "../src/combat/hostiles.js";
import { ClientMessageSchema } from "../src/protocol/message-schema.js";

/** La personalidad que emite el core hoy, que es la ÚNICA que existe en
 *  producción: `combatForHostileRole` → `buildPersonality`. */
const PERSONALIDAD_REAL = combatForHostileRole("hostile")!.personality;

const combatCon = (p: unknown): Record<string, unknown> => ({
  health: 60,
  max_health: 60,
  weapon_id: "unarmed",
  personality: p,
});

describe("parseHostileCombat · lo que el core deriva pasa", () => {
  it("el bloque de combatForHostileRole entra ENTERO: ni se rechaza ni se le cae un campo", () => {
    const derivado = combatForHostileRole("hostile")!;
    const r = parseHostileCombat(derivado);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    // Contra el derivado y no contra números escritos aquí: el balance lo mide
    // `test/hostiles.test.ts`; lo que este test afirma es que el parser deja
    // pasar el bloque real sin tocarlo, `aggro_radius` incluido — el campo que
    // NINGUNO de los dos criterios de antes comprobaba y que el zod del bridge
    // ni siquiera modelaba.
    assert.deepEqual(r.hostil, derivado);
  });

  it("un herido que vuelve de un save (health < max_health) pasa, y la barra conserva su denominador", () => {
    const derivado = combatForHostileRole("hostile")!;
    const r = parseHostileCombat({ ...derivado, health: 12 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.hostil.health, 12);
    assert.equal(r.hostil.max_health, derivado.max_health);
    assert.notEqual(r.hostil.health, r.hostil.max_health);
  });

  it("conserva los campos que no comprueba (un plugin puede añadir los suyos)", () => {
    const r = parseHostileCombat(combatCon({ ...PERSONALIDAD_REAL, rencor: "por la deuda" }));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.hostil.personality as unknown as Record<string, unknown>).rencor, "por la deuda");
  });
});

describe("parseHostileCombat · cada rechazo con su motivo", () => {
  const casos: Array<[string, unknown, string]> = [
    ["no es un objeto", "bandido", "su bloque `combat` no es un objeto"],
    ["es null", null, "su bloque `combat` no es un objeto"],
    ["es una lista", [], "su bloque `combat` no es un objeto"],
    [
      "health ausente",
      { max_health: 60, weapon_id: "unarmed", personality: PERSONALIDAD_REAL },
      "combat.health inválido (undefined)",
    ],
    ["health NaN", { ...combatCon(PERSONALIDAD_REAL), health: NaN }, "combat.health inválido (null)"],
    ["health 0", { ...combatCon(PERSONALIDAD_REAL), health: 0 }, "combat.health inválido (0)"],
    ["health negativa", { ...combatCon(PERSONALIDAD_REAL), health: -3 }, "combat.health inválido (-3)"],
    [
      "health de texto",
      { ...combatCon(PERSONALIDAD_REAL), health: "60" },
      'combat.health inválido ("60")',
    ],
    [
      "max_health ausente (save previo a #326)",
      { health: 60, weapon_id: "unarmed", personality: PERSONALIDAD_REAL },
      "combat.max_health inválido (undefined)",
    ],
    [
      "max_health 0",
      { ...combatCon(PERSONALIDAD_REAL), max_health: 0 },
      "combat.max_health inválido (0)",
    ],
    [
      "weapon_id ausente",
      { health: 60, max_health: 60, personality: PERSONALIDAD_REAL },
      "combat.weapon_id inválido (undefined)",
    ],
    [
      "weapon_id vacío",
      { ...combatCon(PERSONALIDAD_REAL), weapon_id: "" },
      'combat.weapon_id inválido ("")',
    ],
    [
      "weapon_id numérico",
      { ...combatCon(PERSONALIDAD_REAL), weapon_id: 3 },
      "combat.weapon_id inválido (3)",
    ],
    ["personality ausente", { health: 60, max_health: 60, weapon_id: "unarmed" }, "combat.personality ausente"],
    ["personality null", combatCon(null), "combat.personality ausente"],
    ["personality lista", combatCon([]), "combat.personality ausente"],
  ];
  for (const [nombre, entrada, motivo] of casos) {
    it(nombre, () => {
      const r = parseHostileCombat(entrada);
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.error, motivo);
    });
  }

  it("el orden del rechazo es health → max_health → weapon_id → personality (un bloque roto entero nombra lo primero)", () => {
    const r = parseHostileCombat({ health: 0, max_health: 0, weapon_id: "", personality: null });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, "combat.health inválido (0)");
  });
});

describe("la personalidad: los tres números, la lista de ataques y los opcionales", () => {
  const TRES = "combat.personality necesita aggression, reaction_time y combat_range numéricos ";
  const casos: Array<[string, unknown, string]> = [
    [
      "sin aggression",
      { preferred_attacks: ["quick"], reaction_time: 0.5, combat_range: 4 },
      TRES + '({"reaction_time":0.5,"combat_range":4})',
    ],
    [
      "sin reaction_time",
      { aggression: 0.6, preferred_attacks: ["quick"], combat_range: 4 },
      TRES + '({"aggression":0.6,"combat_range":4})',
    ],
    [
      "sin combat_range",
      { aggression: 0.6, preferred_attacks: ["quick"], reaction_time: 0.5 },
      TRES + '({"aggression":0.6,"reaction_time":0.5})',
    ],
    [
      "aggression Infinity (número, pero no usable)",
      { aggression: Infinity, preferred_attacks: ["quick"], reaction_time: 0.5, combat_range: 4 },
      TRES + '({"aggression":null,"reaction_time":0.5,"combat_range":4})',
    ],
    [
      "reaction_time NaN",
      { aggression: 0.6, preferred_attacks: ["quick"], reaction_time: NaN, combat_range: 4 },
      TRES + '({"aggression":0.6,"reaction_time":null,"combat_range":4})',
    ],
    [
      "preferred_attacks ausente",
      { aggression: 0.6, reaction_time: 0.5, combat_range: 4 },
      "combat.personality.preferred_attacks no es una lista de ataques no vacía",
    ],
    [
      "preferred_attacks vacía",
      { aggression: 0.6, preferred_attacks: [], reaction_time: 0.5, combat_range: 4 },
      "combat.personality.preferred_attacks no es una lista de ataques no vacía",
    ],
    [
      "preferred_attacks con un número dentro",
      { aggression: 0.6, preferred_attacks: ["quick", 3], reaction_time: 0.5, combat_range: 4 },
      "combat.personality.preferred_attacks no es una lista de ataques no vacía",
    ],
    [
      "preferred_attacks que no es lista",
      { aggression: 0.6, preferred_attacks: "quick", reaction_time: 0.5, combat_range: 4 },
      "combat.personality.preferred_attacks no es una lista de ataques no vacía",
    ],
    [
      "difficulty numérica (degradaría a «medium» sin decir nada)",
      { ...PERSONALIDAD_REAL, difficulty: 5 },
      "combat.personality.difficulty inválido (5)",
    ],
    [
      "aggression_style con un objeto",
      { ...PERSONALIDAD_REAL, aggression_style: { estilo: "bruto" } },
      'combat.personality.aggression_style inválido ({"estilo":"bruto"})',
    ],
    [
      "block_chance de texto",
      { ...PERSONALIDAD_REAL, block_chance: "0.3" },
      'combat.personality.block_chance inválido ("0.3")',
    ],
    [
      "move_speed Infinity",
      { ...PERSONALIDAD_REAL, move_speed: Infinity },
      "combat.personality.move_speed inválido (null)",
    ],
    [
      "aggro_radius de texto (el tipo promete número)",
      { ...PERSONALIDAD_REAL, aggro_radius: "diez" },
      'combat.personality.aggro_radius inválido ("diez")',
    ],
    [
      "attack_cooldown_mult null",
      { ...PERSONALIDAD_REAL, attack_cooldown_mult: null },
      "combat.personality.attack_cooldown_mult inválido (null)",
    ],
    [
      "preferred_distance de texto",
      { ...PERSONALIDAD_REAL, preferred_distance: "lejos" },
      'combat.personality.preferred_distance inválido ("lejos")',
    ],
  ];
  for (const [nombre, entrada, motivo] of casos) {
    it(nombre, () => {
      const r = parseHostileCombat(combatCon(entrada));
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.error, motivo);
    });
  }

  it("un opcional AUSENTE no es un opcional roto: la personalidad mínima pasa", () => {
    const r = parseHostileCombat(
      combatCon({ aggression: 0.6, preferred_attacks: ["quick"], reaction_time: 0.5, combat_range: 4 }),
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.hostil.personality.difficulty, undefined);
    assert.equal(r.hostil.personality.aggro_radius, undefined);
  });
});

describe("un solo criterio: la puerta del cliente y la del bridge contestan lo mismo", () => {
  /** Lo que el borde WS del bridge hace con un `add_combatants` que trae ese
   *  bloque (el cable lo lleva en camelCase y desmontado; es el mismo bloque).
   *  Se mira el ISSUE de zod (mensaje y ruta) y no el string ya formateado: el
   *  formateador es de otro módulo (`contract/model-io/validate.ts`) y quien
   *  afirma su salida entera —«enemies[0]: …»— es
   *  `test/message-schema.test.ts`. */
  const porElCable = (combat: Record<string, unknown>): { mensaje: string; ruta: unknown[] } | null => {
    const r = ClientMessageSchema.safeParse({
      type: "add_combatants",
      enemies: [
        {
          id: "bandido_1",
          position: { x: 0, y: 0, z: 0 },
          health: combat.health,
          maxHealth: combat.max_health,
          weaponId: combat.weapon_id,
          personality: combat.personality,
        },
      ],
    });
    if (r.success) return null;
    const primero = r.error.issues[0];
    return { mensaje: primero.message, ruta: [...primero.path] };
  };

  const porLaPuertaDelCliente = (combat: unknown): string | null => {
    const r = parseHostileCombat(combat);
    return r.ok ? null : r.error;
  };

  const bloques: Array<[string, Record<string, unknown>]> = [
    ["el que deriva el core", combatCon(PERSONALIDAD_REAL)],
    ["con la personalidad ausente", { health: 60, max_health: 60, weapon_id: "unarmed" }],
    ["con la personalidad a null", combatCon(null)],
    [
      "con una personalidad sin combat_range",
      combatCon({ aggression: 0.5, preferred_attacks: ["quick"], reaction_time: 0.3 }),
    ],
    ["con la lista de ataques vacía", combatCon({ ...PERSONALIDAD_REAL, preferred_attacks: [] })],
    ["con aggression Infinity", combatCon({ ...PERSONALIDAD_REAL, aggression: Infinity })],
    ["con difficulty numérica", combatCon({ ...PERSONALIDAD_REAL, difficulty: 5 })],
    // Los tres escalares: hasta la PR 6 el borde los daba por buenos con solo
    // mirarles el tipo, así que un muerto o un enemigo sin arma entraban al sim.
    ["con health 0 (un muerto)", { ...combatCon(PERSONALIDAD_REAL), health: 0 }],
    ["con max_health 0", { ...combatCon(PERSONALIDAD_REAL), max_health: 0 }],
    ["con el arma vacía", { ...combatCon(PERSONALIDAD_REAL), weapon_id: "" }],
    ["herido de save (health 12)", { ...combatCon(PERSONALIDAD_REAL), health: 12 }],
  ];

  for (const [nombre, combat] of bloques) {
    it(`«${nombre}»: mismo veredicto y mismo motivo en las dos puertas`, () => {
      const cliente = porLaPuertaDelCliente(combat);
      const cable = porElCable(combat);
      if (cliente === null) {
        assert.equal(cable, null, `el cliente lo acepta y el bridge no: ${JSON.stringify(cable)}`);
        return;
      }
      assert.notEqual(cable, null, `el cliente lo rechaza («${cliente}») y el bridge lo acepta`);
      assert.equal(cable?.mensaje, cliente);
      assert.deepEqual(cable?.ruta, ["enemies", 0]);
    });
  }

  it("load_room pasa por el MISMO criterio que add_combatants (las dos vías del cliente)", () => {
    const enemigo = {
      id: "bandido_1",
      position: { x: 0, y: 0, z: 0 },
      health: 60,
      maxHealth: 60,
      weaponId: "unarmed",
      personality: { ...PERSONALIDAD_REAL, preferred_attacks: [] },
    };
    const r = ClientMessageSchema.safeParse({
      type: "load_room",
      roomId: "robledo_tile",
      enemies: [enemigo],
    });
    assert.equal(r.success, false);
    if (r.success) return;
    assert.equal(
      r.error.issues[0].message,
      "combat.personality.preferred_attacks no es una lista de ataques no vacía",
    );
    assert.deepEqual([...r.error.issues[0].path], ["enemies", 0]);
  });
});
