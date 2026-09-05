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
  avisoDeFueraDelMundo,
  combateDeEntity,
  entidadesFueraDelMundo,
  escenaConCombateVivo,
  estadoEnElWire,
  nombreDeEntity,
  npcsFueraDelRect,
  rectsDelMundo,
  spawnsDeRuntime,
  type EstadoEnElWire,
} from "../src/session/mundo-persistido.js";
import { combatForHostileRole } from "../src/combat/hostiles.js";
import type { EntityRecord } from "../src/narrative/types.js";

/** El tipo de la escena servida, DERIVADO del módulo bajo prueba y no importado
 *  de scene-normalize: este fichero es de la batería de mutación de
 *  mundo-persistido y un import (aunque sea de tipos) lo metería en la de
 *  scene-normalize (`mutation-config.test.ts`). */
type WorldScene = ReturnType<typeof escenaConCombateVivo>;
type NpcEnElWire = WorldScene["npcs"][number];

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
function escenaConDos(): WorldScene {
  return {
    scene_id: "tile_0_0",
    scene_description: "una plaza",
    dimensions: { width: 64, depth: 64, height: 3 },
    world_rect: { minX: -32, minZ: -32, maxX: 32, maxZ: 32 },
    tile: { tx: 0, ty: 0 },
    terrain: { color: [0.18, 0.22, 0.14] },
    terrain_grid: { grid: ["g"], cols: 1, rows: 1, meters_per_cell: 0.5, origin: [-32, -32] },
    objects: [],
    npcs: [
      { id: "bandido_1", name: "Bandido", position: [3, 0, 4], combat: combatForHostileRole("hostile") },
      { id: "barkeep", name: "Tabernero", position: [-2, 0, 1], role: "merchant" },
    ],
    __player_start: null,
  };
}

/** Un npc del wire escrito corto: lo que `formatDToWorld` emite de un vecino. */
const npc = (id: string, position: [number, number, number], extra: Partial<NpcEnElWire> = {}): NpcEnElWire =>
  ({ id, name: id, position, ...extra });

/** Dónde estaba cada npc de `escenaConDos()` cuando la escena lo declaró. Se
 *  nombra para poder afirmar que la posición DECLARADA sobrevive al overlay. */
const DECLARADA = { bandido_1: [3, 0, 4], barkeep: [-2, 0, 1] } as const;

/** Estados del wire escritos corto: `[health, max_health]` = vivo así, quieto
 *  donde lo declaró la escena; `{ en: [x,y,z] }` = vivo y AHÍ (se movió);
 *  `"muerto"` / `"ilegible"` = no vuelve, y por qué.
 *
 *  El caso «vivo y quieto» pone la MISMA posición que la escena a propósito:
 *  así los tests de vida no cambian de sujeto al añadirle la posición al
 *  estado (#351), y el que sí quiere medir la mudanza la pide explícita. */
type EstadoCorto =
  | [number, number]
  | { en: [number, number, number]; combate?: [number, number] }
  | "muerto"
  | "ilegible";

const estados = (m: Record<string, EstadoCorto>) =>
  new Map<string, EstadoEnElWire>(
    Object.entries(m).map(([id, v]) => {
      if (v === "muerto") return [id, { tipo: "no_vuelve", motivo: { clase: "muerto" } }];
      if (v === "ilegible") {
        return [id, { tipo: "no_vuelve", motivo: { clase: "ilegible", detalle: "sin max_health" } }];
      }
      const quieta = (DECLARADA as Record<string, readonly number[]>)[id] ?? [0, 0, 0];
      if (Array.isArray(v)) {
        return [
          id,
          {
            tipo: "vivo",
            combate: { health: v[0], max_health: v[1] },
            posicion: [quieta[0], quieta[1], quieta[2]],
          },
        ];
      }
      return [
        id,
        {
          tipo: "vivo",
          combate: v.combate ? { health: v.combate[0], max_health: v.combate[1] } : null,
          posicion: v.en,
        },
      ];
    }),
  );

describe("escenaConCombateVivo — la escena sale al wire con lo que le hiciste", () => {
  it("al HERIDO se le baja la vida y conserva su denominador", () => {
    const salida = escenaConCombateVivo(
      escenaConDos(),
      estados({ bandido_1: [12, 60] }),
    );
    const bandido = salida.npcs.find((n) => n.id === "bandido_1")!;
    const combat = bandido.combat!;
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
    assert.deepEqual(salida.npcs.map((n) => n.id), ["barkeep"], "el muerto no vuelve; el vecino pacífico sí");
  });

  it("no toca la escena que recibe: lo persistido sigue siendo Format D crudo (#179)", () => {
    const original = escenaConDos();
    const antes = JSON.stringify(original);
    escenaConCombateVivo(original, estados({ bandido_1: { en: [30, 0, 12], combate: [3, 60] } }));
    assert.equal(JSON.stringify(original), antes, "el overlay escribió sobre el objeto de entrada");
  });

  it("un npc del que no se sabe nada pasa intacto (el que no está en el ledger)", () => {
    const salida = escenaConCombateVivo(escenaConDos(), estados({}));
    assert.deepEqual(salida.npcs, escenaConDos().npcs);
  });

  // ── #351 · la posición sale por la misma puerta que la vida ──────────────

  it("al que SE MOVIÓ se le pone donde estaba, no en su celda de spawn", () => {
    // El defecto entero de #351: la posición se guardaba
    // (`narrative-state.ts`) y no se servía, así que el bandido al que
    // perseguiste media plaza reaparecía en la casilla del Format D.
    const salida = escenaConCombateVivo(
      escenaConDos(),
      estados({ bandido_1: { en: [12.25, 0, 0.75], combate: [12, 60] } }),
    );
    const bandido = salida.npcs.find((n) => n.id === "bandido_1")!;
    assert.deepEqual(bandido.position, [12.25, 0, 0.75]);
    assert.equal(bandido.combat!.health, 12, "y con su vida, las dos cosas");
  });

  it("el PACÍFICO que paseó también vuelve donde estaba: moverse no es de los que pelean", () => {
    // El sujeto que el issue no nombraba y la crítica midió:
    // `npc-behavior.ts` mueve el record de CUALQUIER NPC ambiental, y hasta
    // hoy uno sin bloque `combat` no tenía estado y salía intacto.
    const salida = escenaConCombateVivo(escenaConDos(), estados({ barkeep: { en: [-9, 0, 7] } }));
    const barkeep = salida.npcs.find((n) => n.id === "barkeep")!;
    assert.deepEqual(barkeep.position, [-9, 0, 7]);
    assert.equal(barkeep.combat, undefined, "y sin inventarle un bloque de combate que no tiene");
  });

  it("la posición DECLARADA se guarda aparte: es lo que sigue midiendo el fail-loud", () => {
    // Sin esto, poner la viva en `position` deja al candado de conversión
    // celda→metro sin nada que mirar. No se marca «no mires esto»: se aparta
    // la declarada para poder seguir mirándola.
    const salida = escenaConCombateVivo(
      escenaConDos(),
      estados({ bandido_1: { en: [99, 0, 99], combate: [12, 60] }, barkeep: { en: [-9, 0, 7] } }),
    );
    assert.deepEqual(salida.npcs.find((n) => n.id === "bandido_1")!.position_declared, DECLARADA.bandido_1);
    assert.deepEqual(salida.npcs.find((n) => n.id === "barkeep")!.position_declared, DECLARADA.barkeep);
  });

  it("al ILEGIBLE también se le quita: servirlo sin overlay lo resucitaría a 60/60", () => {
    // El peor fallback posible y el que había: un `data.combat` que no se
    // puede leer dejaba la escena SIN overlay, o sea con el bloque DERIVADO —
    // siempre entero—, así que el enemigo que el jugador había matado volvía
    // vivo y a tope, sin una línea en pantalla (QA 2026-08-31, H-2).
    const salida = escenaConCombateVivo(escenaConDos(), estados({ bandido_1: "ilegible" }));
    assert.deepEqual(salida.npcs.map((n) => n.id), ["barkeep"], "lo que no se puede leer no vuelve al mundo");
  });
});

describe("estadoEnElWire — la precedencia sim → ledger, y lo que no se puede leer", () => {
  /** Un combatiente del sim escrito corto. */
  const enElSim = (health: number, x = 0, z = 0) => ({
    health,
    maxHealth: 60,
    position: { x, y: 0, z },
  });

  it("el SIM manda: el ledger va un save por detrás y la vida del HUD saltaría", () => {
    const r = estadoEnElWire(
      rec({ id: "x", data: { combat: { health: 60, max_health: 60 } } }),
      enElSim(11, 8, 3),
    );
    assert.deepEqual(r, {
      tipo: "vivo",
      combate: { health: 11, max_health: 60 },
      posicion: [8, 0, 3],
    });
  });

  it("…y manda también para la POSICIÓN: una vida fresca con una coordenada rancia sería peor", () => {
    // Dos hechos sobre la misma entity con reglas de frescura distintas es
    // cómo se acaba con el enemigo pintado donde estaba hace un minuto y la
    // barra de hace un segundo. El record dice [1,0,2] (el fixture) y el sim
    // dice otra cosa: manda el sim, igual que con la vida.
    const r = estadoEnElWire(rec({ id: "x", position: [1, 0, 2] }), enElSim(40, -5.5, 12.25));
    assert.equal(r.tipo, "vivo");
    if (r.tipo === "vivo") assert.deepEqual(r.posicion, [-5.5, 0, 12.25]);
  });

  it("sin combatiente en el sim manda el ledger (al reanudar solo está el jugador)", () => {
    const r = estadoEnElWire(
      rec({ id: "x", position: [4, 0, 6], data: { combat: { health: 9, max_health: 60 } } }),
      undefined,
    );
    assert.deepEqual(r, {
      tipo: "vivo",
      combate: { health: 9, max_health: 60 },
      posicion: [4, 0, 6],
    });
  });

  it("un muerto no vuelve, lo diga el sim o lo diga el save", () => {
    const porElSim = estadoEnElWire(rec({ id: "x" }), enElSim(0));
    assert.deepEqual(porElSim, { tipo: "no_vuelve", motivo: { clase: "muerto" } });
    const porElSave = estadoEnElWire(
      rec({ id: "x", data: { combat: { health: 0, max_health: 60 } } }),
      undefined,
    );
    assert.deepEqual(porElSave, { tipo: "no_vuelve", motivo: { clase: "muerto" } });
  });

  it("un bloque ILEGIBLE no es «sin datos»: tampoco vuelve, y dice por qué", () => {
    const r = estadoEnElWire(rec({ id: "x", data: { combat: { health: 30 } } }), undefined);
    assert.equal(r.tipo, "no_vuelve");
    if (r.tipo === "no_vuelve") {
      assert.equal(r.motivo.clase, "ilegible");
      if (r.motivo.clase === "ilegible") assert.match(r.motivo.detalle, /max_health/);
    }
  });

  it("quien no pelea SÍ tiene estado: sin combate, pero con su posición (#351)", () => {
    // Devolvía `null`, y ese `null` era el bug: sin estado no había nada que
    // ponerle a la escena, así que el tabernero que había paseado media plaza
    // reaparecía en su celda de spawn al reanudar.
    const r = estadoEnElWire(
      rec({ id: "barkeep", position: [-9, 0, 7], data: { name: "Tabernero" } }),
      undefined,
    );
    assert.deepEqual(r, { tipo: "vivo", combate: null, posicion: [-9, 0, 7] });
  });

  it("la posición que devuelve es una COPIA: mutarla no reescribe el ledger", () => {
    // Sale hacia el wire y de ahí a un objeto nuevo; si fuera la misma
    // referencia, cualquier consumidor podría mover al personaje en el save
    // sin pasar por `save()`.
    const r0 = rec({ id: "x", position: [1, 0, 2] });
    const r = estadoEnElWire(r0, undefined);
    if (r.tipo === "vivo") r.posicion[0] = 999;
    assert.deepEqual(r0.position, [1, 0, 2]);
  });
});

/** #351 · el fail-loud de conversión celda→metro, mudado del cliente a core.
 *
 *  Aquí vive el criterio 2b de la tanda, y su mitad importante es la SEGUNDA:
 *  el candado no se debilita para conseguir que el que se movió no encienda un
 *  rojo falso. Un NPC *declarado* fuera de su rect se sigue reportando, y da
 *  igual que la escena traiga además su posición viva. */
describe("npcsFueraDelRect — la conversión celda→metro se sigue midiendo", () => {
  const RECT = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };

  it("un npc DECLARADO fuera de su rect se reporta, con su id y su coordenada", () => {
    const fuera = npcsFueraDelRect([npc("dentro", [4, 0, -4]), npc("roto", [96.5, 0, 12.25])], RECT);
    assert.deepEqual(fuera, [{ id: "roto", x: 96.5, z: 12.25 }]);
  });

  it("el que SE MOVIÓ fuera del rect NO enciende un rojo falso: se mide su declarada", () => {
    // El enemigo persigue al jugador y los tiles son de 64 m: a mitad de una
    // pelea está legítimamente fuera. Lo que se mide no es dónde está, es si
    // la coordenada que la escena DECLARA es una conversión rota.
    const fuera = npcsFueraDelRect(
      [npc("bandido_1", [140, 0, 200], { position_declared: [8.01, 0, 0.7] })],
      RECT,
    );
    assert.deepEqual(fuera, []);
  });

  it("…y el candado NO se debilita: con la declarada rota lo reporta AUNQUE se haya movido", () => {
    // La mitad que impide que `position_declared` se convierta en una
    // exención general. Si el checker se saltara al que trae posición viva,
    // este caso saldría verde — y a la primera difusión de cualquier escena
    // TODO npc la trae (`registerSceneNpcs` los mete a todos en el ledger),
    // así que el candado no volvería a mirar a nadie nunca.
    const fuera = npcsFueraDelRect(
      [npc("bandido_1", [4, 0, 4], { position_declared: [96.5, 0, 12.25] })],
      RECT,
    );
    assert.deepEqual(fuera, [{ id: "bandido_1", x: 96.5, z: 12.25 }]);
  });

  it("cubre a los npc YA CONOCIDOS, que es más de lo que miraba el bucle del cliente", () => {
    // En `main.ts` solo se comprobaban los recién creados (`newNpcs` +
    // `enemies`): un npc que ya existía en el cliente y cuya declaración se
    // rompiera después no lo veía nadie. Aquí se recorre `npcs[]` entero.
    const fuera = npcsFueraDelRect(
      [npc("a", [-40, 0, 0]), npc("b", [0, 0, 40]), npc("c", [0, 0, 0])],
      RECT,
    );
    assert.deepEqual(fuera.map((f) => f.id), ["a", "b"]);
  });

  it("el borde es semiabierto, igual que el `inRect` que sustituye", () => {
    // `>= min` y `< max`, para que dos tiles vecinos no se disputen la misma
    // línea. Sin esto, el npc de la costura saldría reportado por uno de los
    // dos o por ninguno.
    const fuera = npcsFueraDelRect(
      [
        { id: "min", name: "min", position: [-32, 0, -32] },
        { id: "max", name: "max", position: [32, 0, 32] },
      ],
      RECT,
    );
    assert.deepEqual(fuera.map((f) => f.id), ["max"]);
  });

  it("una coordenada que no es un número NO cuenta como «está dentro»", () => {
    // Colapsar «no sé leer esto» con «no hay nada que decir» es el silencio
    // que esta casa prohíbe, y aquí es alcanzable: una escena mal normalizada
    // trae `undefined` o un string donde iba el metro.
    // Entrada ADVERSARIAL a propósito: el tipo dice tres números, pero esto es
    // JSON de otro proceso y aquí se fuerza lo que el tipo no deja escribir.
    const rotos = [
      { id: "nan", name: "nan", position: ["x", 0, 2] },
      { id: "hueco", name: "hueco", position: [1, 0, undefined] },
    ] as unknown as NpcEnElWire[];
    const fuera = npcsFueraDelRect(rotos, RECT);
    assert.deepEqual(fuera.map((f) => f.id), ["nan", "hueco"]);
    assert.ok(Number.isNaN(fuera[0].x));
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

  it("sin `description` en el ledger, el spawn vuelve SIN ella: no se le pone el id de procedencia (#397)", () => {
    // Aquí se caía a `rec.id`: el mismo NPC se pintaba con «an entity» en vivo
    // y con `narr_npc_…` tras reanudar (guion 66). La procedencia es lo que
    // declaró el motor o nada.
    const { spawns, errores } = spawnsDeRuntime([
      rec({ id: "narr_npc_178_3", data: { name: "Mochuelo", role: "villager" } }),
    ]);
    assert.deepEqual(errores, []);
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].name, "Mochuelo");
    assert.equal("description" in spawns[0], false, JSON.stringify(spawns[0]));
  });

  it("un record sin `name` no es un caso: es un ledger que se saltó la puerta, y REVIENTA (#397)", () => {
    // La decisión vive en UN sitio, `loadSession` (narrative-state.test.ts lo
    // mide): un save con un record sin `data.name` no carga. Aquí no hay rama
    // «se deja fuera y se dice» —QA la cazó como segundo criterio frente a la
    // resiembra del sim—; si llega, es invariante roto y se lanza con el id.
    assert.throws(
      () => spawnsDeRuntime([rec({ id: "anonimo_1", data: { description: "alguien sin nombre" } })]),
      /anonimo_1.*sin data\.name/,
    );
    assert.throws(() => spawnsDeRuntime([rec({ id: "blanco_1", data: { name: "   " } })]), /blanco_1/);
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

/** La posición VIVA contra la UNIÓN de tiles del save (#382). Es el hermano
 *  de `npcsFueraDelRect` con otra vara: aquel mide la declarada contra SU
 *  tile; este la viva contra todo el mundo conocido, porque moverse al tile
 *  de al lado es legítimo y una coordenada donde no hay ningún tile no lo es. */
describe("entidadesFueraDelMundo — la viva contra la unión de tiles del save (#382)", () => {
  /** Dos tiles: (0,0) y (1,0) → x en [−32, 96), z en [−32, 32). */
  const dosTiles = rectsDelMundo({
    tile_0_0: { tile: { tx: 0, ty: 0 } },
    tile_1_0: { tile: { tx: 1, ty: 0 } },
  });

  it("los rects salen de los tiles del save (toda escena del save es un tile, #405)", () => {
    assert.deepEqual(dosTiles, [
      { minX: -32, minZ: -32, maxX: 32, maxZ: 32 },
      { minX: 32, minZ: -32, maxX: 96, maxZ: 32 },
    ]);
  });

  it("el repro del issue: [168.25, 0, 168.25] no cae en ningún tile y se nombra con su coordenada", () => {
    const fuera = entidadesFueraDelMundo(
      [rec({ id: "barkeep", spawn_reason: "scene_init", position: [168.25, 0, 168.25], data: { name: "Tabernero" } })],
      dosTiles,
    );
    assert.deepEqual(fuera, [{ id: "barkeep", nombre: "Tabernero", x: 168.25, z: 168.25 }]);
    const aviso = avisoDeFueraDelMundo(fuera);
    assert.match(aviso, /Tabernero/);
    assert.match(aviso, /168,3, 168,3/);
    assert.doesNotMatch(aviso, /no lo vas|no los vas/, "sin género");
    assert.match(aviso, /donde no hay mundo/);
  });

  it("el que se fue al tile VECINO está donde hay mundo: no es un rojo (negativo del falso positivo)", () => {
    // Fuera de su tile de origen (0,0) pero dentro de (1,0): el enemigo que te
    // persiguió, el aldeano que dio una vuelta.
    assert.deepEqual(
      entidadesFueraDelMundo([rec({ id: "bandido", scene_id: "tile_0_0", position: [66, 0, 7] })], dosTiles),
      [],
    );
  });

  it("sin tiles no hay mundo del que estar fuera: devuelve [] a propósito", () => {
    assert.deepEqual(entidadesFueraDelMundo([rec({ id: "x", position: [999, 0, 999] })], []), []);
    assert.deepEqual(entidadesFueraDelMundo([rec({ id: "x", position: [999, 0, 999] })], rectsDelMundo({})), []);
  });

  it("con varios, el aviso los cuenta y nombra hasta tres", () => {
    const fuera = entidadesFueraDelMundo(
      ["a", "b", "c", "d"].map((id) => rec({ id, position: [500, 0, 500], data: { name: id.toUpperCase() } })),
      dosTiles,
    );
    const aviso = avisoDeFueraDelMundo(fuera);
    assert.match(aviso, /4 personajes/);
    assert.match(aviso, /A en \(500,0, 500,0\), B en/);
    assert.match(aviso, /y 1 más/);
  });
});
