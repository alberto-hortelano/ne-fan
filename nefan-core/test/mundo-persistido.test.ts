/** Qué vuelve al reanudar, y en qué estado (#326).
 *
 *  El sujeto es la mitad PURA de la respuesta: la puerta única por
 *  `spawn_reason` y el estado de combate que se le pone encima a la escena.
 *  Lo que se afirma aquí es lo que un guion de navegador tarda dos minutos en
 *  ejercer y no puede decir con esta precisión — cuál de las dos puertas usó
 *  cada entidad, y que la otra NO la usó.
 *
 *  Los tres desenlaces que la tanda existe para impedir, y por eso hay un test
 *  por cada uno: el herido que vuelve entero, el muerto que vuelve, y el
 *  mismo enemigo entrando por las dos puertas (dos barras y un solo
 *  combatiente en el sim).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  combateDeEntity,
  escenaConCombateVivo,
  estadoEnElWire,
  nombreDeEntity,
  spawnsDeRuntime,
  type EstadoEnElWire,
} from "../src/session/mundo-persistido.js";
import { combatForHostileRole } from "../src/combat/hostiles.js";
import type { EntityRecord } from "../src/narrative/types.js";

/** Un `EntityRecord` como los que escribe el ledger. */
function rec(over: Partial<EntityRecord> & { id: string }): EntityRecord {
  return {
    type: "npc",
    scene_id: "tile_0_0",
    spawned_at: "2026-08-31T00:00:00.000Z",
    spawn_reason: "narrative_request",
    spawn_event_id: "evt_0001",
    position: [1, 0, 2],
    data: {},
    asset_refs: [],
    ...over,
  };
}

/** La world scene tal como la deja `formatDToWorld` para un tile con dos NPC:
 *  un hostil (con su bloque derivado) y un tabernero. */
function escenaConDos(): Record<string, unknown> {
  return {
    scene_id: "tile_0_0",
    npcs: [
      { id: "bandido_1", name: "Bandido", position: [3, 0, 4], combat: combatForHostileRole("hostile") },
      { id: "barkeep", name: "Tabernero", position: [-2, 0, 1], role: "merchant" },
    ],
  };
}

/** Estados del wire escritos corto: `[health, max_health]` = vivo así;
 *  `"muerto"` / `"ilegible"` = no vuelve, y por qué. */
const estados = (m: Record<string, [number, number] | "muerto" | "ilegible">) =>
  new Map<string, EstadoEnElWire>(
    Object.entries(m).map(([id, v]) => [
      id,
      v === "muerto"
        ? { tipo: "no_vuelve", motivo: { clase: "muerto" } }
        : v === "ilegible"
          ? { tipo: "no_vuelve", motivo: { clase: "ilegible", detalle: "sin max_health" } }
          : { tipo: "vivo", combate: { health: v[0], max_health: v[1] } },
    ]),
  );

describe("escenaConCombateVivo — la escena sale al wire con lo que le hiciste", () => {
  it("al HERIDO se le baja la vida y conserva su denominador", () => {
    const salida = escenaConCombateVivo(
      escenaConDos(),
      estados({ bandido_1: [12, 60] }),
    );
    const npcs = salida.npcs as Array<Record<string, unknown>>;
    const bandido = npcs.find((n) => n.id === "bandido_1")!;
    const combat = bandido.combat as Record<string, unknown>;
    assert.equal(combat.health, 12, "vuelve con la vida que le dejaste, no con la del contrato");
    assert.equal(combat.max_health, 60, "…y sobre su denominador: si no, la barra sale llena");
    // El resto del bloque sigue entero: sin arma ni personalidad el cliente lo
    // rechaza en su puerta y el enemigo desaparece del mundo.
    assert.equal(combat.weapon_id, combatForHostileRole("hostile")!.weapon_id);
    assert.ok(combat.personality, "la personalidad derivada no se pierde en el overlay");
  });

  it("al MUERTO se le quita del npcs[]: no se pinta, no se registra, no tiene barra", () => {
    const salida = escenaConCombateVivo(
      escenaConDos(),
      estados({ bandido_1: "muerto" }),
    );
    const ids = (salida.npcs as Array<Record<string, unknown>>).map((n) => n.id);
    assert.deepEqual(ids, ["barkeep"], "el muerto no vuelve; el vecino pacífico sí");
  });

  it("no toca la escena que recibe: lo persistido sigue siendo Format D crudo (#179)", () => {
    const original = escenaConDos();
    const antes = JSON.stringify(original);
    escenaConCombateVivo(original, estados({ bandido_1: [3, 60] }));
    assert.equal(JSON.stringify(original), antes, "el overlay escribió sobre el objeto de entrada");
  });

  it("un npc del que no se sabe nada pasa intacto (el que aún no ha peleado)", () => {
    const salida = escenaConCombateVivo(escenaConDos(), estados({}));
    assert.deepEqual(salida.npcs, escenaConDos().npcs);
  });

  it("al ILEGIBLE también se le quita: servirlo sin overlay lo resucitaría a 60/60", () => {
    // El peor fallback posible y el que había: un `data.combat` que no se
    // puede leer dejaba la escena SIN overlay, o sea con el bloque DERIVADO —
    // siempre entero—, así que el enemigo que el jugador había matado volvía
    // vivo y a tope, sin una línea en pantalla (QA 2026-08-31, H-2).
    const salida = escenaConCombateVivo(escenaConDos(), estados({ bandido_1: "ilegible" }));
    const ids = (salida.npcs as Array<Record<string, unknown>>).map((n) => n.id);
    assert.deepEqual(ids, ["barkeep"], "lo que no se puede leer no vuelve al mundo");
  });
});

describe("estadoEnElWire — la precedencia sim → ledger, y lo que no se puede leer", () => {
  it("el SIM manda: el ledger va un save por detrás y la vida del HUD saltaría", () => {
    const r = estadoEnElWire(
      rec({ id: "x", data: { combat: { health: 60, max_health: 60 } } }),
      { health: 11, maxHealth: 60 },
    );
    assert.deepEqual(r, { tipo: "vivo", combate: { health: 11, max_health: 60 } });
  });

  it("sin combatiente en el sim manda el ledger (al reanudar solo está el jugador)", () => {
    const r = estadoEnElWire(rec({ id: "x", data: { combat: { health: 9, max_health: 60 } } }), undefined);
    assert.deepEqual(r, { tipo: "vivo", combate: { health: 9, max_health: 60 } });
  });

  it("un muerto no vuelve, lo diga el sim o lo diga el save", () => {
    const porElSim = estadoEnElWire(rec({ id: "x" }), { health: 0, maxHealth: 60 });
    assert.deepEqual(porElSim, { tipo: "no_vuelve", motivo: { clase: "muerto" } });
    const porElSave = estadoEnElWire(
      rec({ id: "x", data: { combat: { health: 0, max_health: 60 } } }),
      undefined,
    );
    assert.deepEqual(porElSave, { tipo: "no_vuelve", motivo: { clase: "muerto" } });
  });

  it("un bloque ILEGIBLE no es «sin datos»: tampoco vuelve, y dice por qué", () => {
    const r = estadoEnElWire(rec({ id: "x", data: { combat: { health: 30 } } }), undefined);
    assert.equal(r?.tipo, "no_vuelve");
    if (r?.tipo === "no_vuelve") {
      assert.equal(r.motivo.clase, "ilegible");
      if (r.motivo.clase === "ilegible") assert.match(r.motivo.detalle, /max_health/);
    }
  });

  it("quien no pelea no tiene estado: null, y su npc pasa intacto por la escena", () => {
    assert.equal(estadoEnElWire(rec({ id: "barkeep", data: { name: "Tabernero" } }), undefined), null);
  });
});

describe("nombreDeEntity — lo que el jugador conoce, no el id del motor", () => {
  it("el nombre si lo tiene", () => {
    assert.equal(nombreDeEntity(rec({ id: "narr_npc_178_0", data: { name: "Nogala" } })), "Nogala");
  });
  it("y el id si no, que es lo que hay (no una excusa para callar)", () => {
    assert.equal(nombreDeEntity(rec({ id: "narr_npc_178_0" })), "narr_npc_178_0");
  });
});

describe("spawnsDeRuntime — UNA puerta por entidad, y la decide el spawn_reason", () => {
  const mundo: EntityRecord[] = [
    // El de la ESCENA: vuelve por la escena, nunca por aquí.
    rec({ id: "bandido_1", spawn_reason: "scene_init", data: { name: "Bandido", role: "hostile" } }),
    // Los cuatro de RUNTIME: la clase entera.
    rec({
      id: "secuaz_1",
      data: {
        name: "Secuaz",
        description: "secuaz enjuto de capucha parda",
        role: "hostile",
        combat: { ...combatForHostileRole("hostile")!, health: 21 },
      },
    }),
    rec({ id: "nogala", data: { name: "Nogala", description: "posadera de manos grandes", role: "merchant" } }),
    rec({ id: "cofre_1", type: "object", data: { name: "Cofre", description: "cofre de roble" } }),
    rec({ id: "forja_1", type: "building", data: { name: "Forja", description: "forja de piedra ennegrecida" } }),
    // Y el que ya no vuelve.
    rec({
      id: "maton_1",
      data: { name: "Matón", combat: { ...combatForHostileRole("hostile")!, health: 0 } },
    }),
  ];

  it("vuelven las cuatro clases de runtime, y el hostil con su vida viva", () => {
    const { spawns, errores } = spawnsDeRuntime(mundo);
    assert.deepEqual(errores, [], "nada roto que reportar");
    assert.deepEqual(
      spawns.map((s) => s.entityId).sort(),
      ["cofre_1", "forja_1", "nogala", "secuaz_1"],
    );
    const secuaz = spawns.find((s) => s.entityId === "secuaz_1")!;
    assert.equal(secuaz.entityKind, "npc");
    assert.equal(secuaz.name, "Secuaz");
    assert.equal(
      secuaz.description,
      "secuaz enjuto de capucha parda",
      "la DESCRIPCIÓN, que es el prompt del skin: con el nombre se pintaría otra cosa",
    );
    assert.deepEqual(secuaz.position, [1, 0, 2]);
    assert.equal((secuaz.data.combat as Record<string, unknown>).health, 21, "vuelve herido");
    assert.equal((spawns.find((s) => s.entityId === "cofre_1")!).entityKind, "object");
    assert.equal((spawns.find((s) => s.entityId === "forja_1")!).entityKind, "building");
  });

  it("NO devuelve lo que declara una escena: sería la segunda puerta al mismo enemigo", () => {
    const { spawns } = spawnsDeRuntime(mundo);
    assert.equal(
      spawns.some((s) => s.entityId === "bandido_1"),
      false,
      "bandido_1 volvería por la escena Y por aquí: dos barras y un solo combatiente en el sim",
    );
  });

  it("NO devuelve al muerto, y no lo cuenta como error (que no vuelva es lo pedido)", () => {
    const { spawns, errores } = spawnsDeRuntime(mundo);
    assert.equal(spawns.some((s) => s.entityId === "maton_1"), false);
    assert.deepEqual(errores, []);
  });

  it("un bloque de combate roto NO se materializa y se DICE, con el id y el campo", () => {
    const { spawns, errores } = spawnsDeRuntime([
      rec({ id: "roto_1", data: { name: "Sombra", combat: { health: 30 } } }),
    ]);
    assert.deepEqual(spawns, [], "un enemigo a medias entra en el sim y ya no se puede matar");
    assert.equal(errores.length, 1);
    assert.match(errores[0], /roto_1/);
    assert.match(errores[0], /max_health/);
  });

  it("un tipo de entity que el cliente no sabe pintar se reporta en vez de caerse callado", () => {
    const { spawns, errores } = spawnsDeRuntime([rec({ id: "raro_1", type: "vehicle" })]);
    assert.deepEqual(spawns, []);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /raro_1/);
    assert.match(errores[0], /vehicle/);
  });
});

describe("combateDeEntity — tres desenlaces, ninguno colapsable", () => {
  it("sin bloque no es un error: la mayoría de las entities no pelean", () => {
    assert.deepEqual(combateDeEntity(rec({ id: "barril" })), { tipo: "ninguno" });
  });

  it("con bloque entero devuelve los dos números", () => {
    const r = combateDeEntity(rec({ id: "x", data: { combat: { health: 7, max_health: 60 } } }));
    assert.deepEqual(r, { tipo: "combate", combate: { health: 7, max_health: 60 } });
  });

  it("un muerto es un combate LEÍDO, no un bloque roto (0 es un valor, no un fallo)", () => {
    const r = combateDeEntity(rec({ id: "x", data: { combat: { health: 0, max_health: 60 } } }));
    assert.deepEqual(r, { tipo: "combate", combate: { health: 0, max_health: 60 } });
  });

  it("un denominador de 0 sí está roto: la barra dividiría por cero", () => {
    const r = combateDeEntity(rec({ id: "x", data: { combat: { health: 10, max_health: 0 } } }));
    assert.equal(r.tipo, "roto");
  });

  it("y un combat que no es un objeto se nombra con su entity", () => {
    const r = combateDeEntity(rec({ id: "raro", data: { combat: "sí" } }));
    assert.equal(r.tipo, "roto");
    if (r.tipo === "roto") assert.match(r.motivo, /raro/);
  });
});
