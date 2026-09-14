/** EL DESENLACE de un lote con un enemigo que no sirve (#529).
 *
 *  El criterio —qué bloque `combat` vale— no es sujeto de este fichero: lo mide
 *  `test/hostil-desde-combat.test.ts`, incluida la tabla que compara las dos
 *  puertas. Aquí se afirma lo OTRO, que es lo que #529 cambia: que el lote no
 *  es indivisible. Y el caso que manda el criterio de aceptación no es «un
 *  enemigo malo», es **uno malo entre dos buenos**: un lote de un elemento no
 *  distingue «se cae solo él» de «se cae el lote», que son exactamente las dos
 *  conductas que aquí se separan.
 *
 *  Lo que el bridge hace con el resultado (log, aviso al jugador, alta en el
 *  sim) vive en `test/bridge-enemigo-invalido.test.ts`: este módulo es puro y
 *  no escribe en ningún canal. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { avisoDeCriba, cribarHostiles, type HostilDelCable } from "../src/combat/criba-de-hostiles.js";
import { combatForHostileRole } from "../src/combat/hostiles.js";
import type { EnemyPersonality } from "../src/types.js";

/** El bloque que emite el core hoy, que es el único que existe en producción
 *  (`combatForHostileRole` → `buildPersonality`). Escribirlo a mano aquí sería
 *  medir un número de balance en vez del desenlace. */
const DERIVADO = combatForHostileRole("hostile")!;

const bueno = (id: string, over: Partial<HostilDelCable> = {}): HostilDelCable => ({
  id,
  position: { x: 1, y: 0, z: 2 },
  health: DERIVADO.health,
  maxHealth: DERIVADO.max_health,
  weaponId: DERIVADO.weapon_id,
  personality: DERIVADO.personality as unknown as EnemyPersonality,
  ...over,
});

const MOTIVO_ATAQUES = "combat.personality.preferred_attacks no es una lista de ataques no vacía";
const MOTIVO_MUERTO = "combat.health inválido (0)";

/** El malo del criterio de aceptación: tipo correcto, valor imposible. Es uno
 *  de los seis casos que el borde ACEPTABA antes de la PR 6 de #241. */
const sinAtaques = (id: string): HostilDelCable =>
  bueno(id, { personality: { ...DERIVADO.personality, preferred_attacks: [] } as unknown as EnemyPersonality });

describe("cribarHostiles · uno malo entre dos buenos", () => {
  it("entran los DOS buenos, el malo NO, y el motivo sale con SU id", () => {
    const { altas, descartes } = cribarHostiles([bueno("lobo_1"), sinAtaques("roto_2"), bueno("lobo_3")]);

    // Las tres cosas a la vez, que es el criterio literal: afirmar solo que el
    // malo cae no distingue «se cae él» de «se cae el lote entero».
    assert.deepEqual(altas.map((a) => a.id), ["lobo_1", "lobo_3"], "los dos buenos entran, en el orden del frame");
    assert.deepEqual(descartes, [{ id: "roto_2", motivo: MOTIVO_ATAQUES }]);
  });

  it("el alta lleva el bloque en la FORMA DEL JUEGO (`max_health`), no en la del cable (`maxHealth`)", () => {
    // ESTE ASERTO DECÍA OTRA COSA Y NO PODÍA PONERSE ROJO POR ELLA (QA H4).
    // Prometía «los valores que entran son los del PARSER, no los del cable», y
    // QA lo midió: sustituyendo `r.hostil` por los campos crudos del cable,
    // 63 de 63 tests seguían verdes. La razón es del diseño y no del test —
    // `parseHostileCombat` VALIDA, no normaliza (`numero()` exige
    // `typeof === "number"`, no convierte), así que para todo lo que pasa el
    // criterio el cable y el parser son idénticos VALOR A VALOR y no hay
    // diferencia que afirmar. Un aserto que no puede fallar por su causa es
    // peor que ninguno: se cuenta como cobertura.
    //
    // Lo que SÍ es falsable, y es la mitad que importa hoy: la FORMA. El cable
    // habla en camelCase y el resto del juego (escena, effect del spawn, save,
    // `HostileCombat`) en snake_case, así que pasar el objeto del cable tal
    // cual deja `max_health` a `undefined` y este `deepEqual` en rojo.
    const { altas } = cribarHostiles([bueno("lobo_1")]);
    assert.equal(altas.length, 1);
    assert.deepEqual(altas[0].hostil, DERIVADO);
    assert.deepEqual(altas[0].position, { x: 1, y: 0, z: 2 });

    // Y LA GARANTÍA DE VERDAD VA EN EL TIPO, no en un aserto: `AltaDeHostil` no
    // tiene los campos del cable, así que el handler NO PUEDE leer el dato sin
    // comprobar aunque quiera — `alta.maxHealth` no compila. Este
    // `@ts-expect-error` es su candado: el día que el tipo se ensanche y vuelva
    // a caber el bloque del cable, `tsc` cae con TS2578 («Unused
    // '@ts-expect-error' directive») dentro de `npm run verify`.
    // @ts-expect-error — `maxHealth` es del cable y `AltaDeHostil` solo lleva el
    // bloque ya comprobado (`hostil`), que habla en snake_case.
    const delCable: unknown = altas[0].maxHealth;
    assert.equal(delCable, undefined);

    // LO QUE ESTE TEST NO PRUEBA, dicho para que nadie lo cuente de más: que
    // usar el bloque del cable en vez del del parser cambie un valor. Hoy no lo
    // cambia. El día que el parser normalice algo (un `difficulty` que caiga a
    // su preset, un clamp), ese día habrá diferencia que medir y este es el
    // sitio.
  });

  it("dos malos entre un bueno: cada uno con SU motivo, no uno que valga por todos", () => {
    const { altas, descartes } = cribarHostiles([
      sinAtaques("roto_1"),
      bueno("lobo_2"),
      bueno("muerto_3", { health: 0 }),
    ]);
    assert.deepEqual(altas.map((a) => a.id), ["lobo_2"]);
    assert.deepEqual(descartes, [
      { id: "roto_1", motivo: MOTIVO_ATAQUES },
      { id: "muerto_3", motivo: MOTIVO_MUERTO },
    ]);
  });

  it("un lote entero bueno no descarta a nadie (sin esto, «criba» sería un verde vacío)", () => {
    const { altas, descartes } = cribarHostiles([bueno("a"), bueno("b"), bueno("c")]);
    assert.deepEqual(altas.map((a) => a.id), ["a", "b", "c"]);
    assert.deepEqual(descartes, []);
  });

  it("un lote entero malo no da ningún alta", () => {
    const { altas, descartes } = cribarHostiles([sinAtaques("a"), sinAtaques("b")]);
    assert.deepEqual(altas, []);
    assert.deepEqual(descartes.map((d) => d.id), ["a", "b"]);
  });

  it("un lote vacío son dos listas vacías, no un error (`load_room` de una fixture sin hostiles)", () => {
    assert.deepEqual(cribarHostiles([]), { altas: [], descartes: [] });
  });
});

describe("avisoDeCriba · lo que lee quien juega", () => {
  it("dice CUÁNTOS de cuántos y nombra a cada uno con su motivo", () => {
    const criba = cribarHostiles([bueno("lobo_1"), sinAtaques("roto_2"), bueno("lobo_3")]);
    assert.equal(
      avisoDeCriba(criba),
      `Enemigos que no entraron al mundo (1 de 3): «roto_2» (${MOTIVO_ATAQUES})`,
    );
  });

  it("con dos descartados los enumera separados, sin colapsarlos en el primero", () => {
    const criba = cribarHostiles([sinAtaques("roto_1"), bueno("lobo_2"), bueno("muerto_3", { health: 0 })]);
    assert.equal(
      avisoDeCriba(criba),
      `Enemigos que no entraron al mundo (2 de 3): «roto_1» (${MOTIVO_ATAQUES}); «muerto_3» (${MOTIVO_MUERTO})`,
    );
  });

  it("sin descartes NO hay aviso: `null`, y es lo que gatea al llamante", () => {
    // `null` y no la cadena vacía: si esto devolviera "" el bridge emitiría un
    // `narrative_status` de error en blanco cada vez que un tile carga bien.
    assert.equal(avisoDeCriba(cribarHostiles([bueno("a")])), null);
    assert.equal(avisoDeCriba(cribarHostiles([])), null);
  });

  it("el motivo va VERBATIM: es el mismo string que el cliente escribe en el registro", () => {
    // Lo que hace verdad «un solo criterio» es que nadie lo reescriba por el
    // camino. Un mutante que traduzca, recorte o prefije el motivo rompe la
    // igualdad que el guion 90 mide entre las dos orillas.
    const aviso = avisoDeCriba(cribarHostiles([sinAtaques("roto_1")]));
    assert.ok(aviso?.includes(MOTIVO_ATAQUES), aviso ?? "(sin aviso)");
  });
});
