/** #492 — LA MÁQUINA DE ANIMACIÓN: qué clip le toca a un personaje.
 *
 *  `avanzarAnimacion` salió de `character-sprites.ts` en la vuelta de QA de esta
 *  tanda (H-1): el fichero estaba en 448 de 450 líneas canon y el inventario del
 *  menú dev solo cabía dentro comprimiendo formato, así que se cortó por donde
 *  no dolía — la máquina no comparte NADA con la generación de skins salvo el
 *  fichero en el que vivían. Salió sin test propio y el informe lo declaró como
 *  deuda; esto es esa deuda pagada, no declarada.
 *
 *  POR QUÉ ES DE AQUÍ Y NO DE `qa/`: es derivación pura —estado + entradas +
 *  reloj → nombre de anim—, sin DOM, sin red y con el tiempo inyectado. Y es
 *  donde un unitario gana al navegador: la PRIORIDAD entre siete reglas tiene
 *  casos que un guion no puede provocar a voluntad (un one-shot a mitad de
 *  duración mientras el jugador anda, un `attackType` que no existe en el set
 *  base, revivir en el mismo frame en que se empieza a andar).
 *
 *  QUÉ CUBRÍA ESTO ANTES, para que se vea qué añade: los guiones 13, 15, 41, 42
 *  y 51 conducen el juego real y miran `walk`, `run`, `idle`, `quick`, `precise`
 *  y el caído. Siguen siendo los que demuestran que la máquina está CABLEADA
 *  —que el sim mueve al muñeco y el muñeco cambia de clip—, y ninguno muere con
 *  este fichero (regla 2 del README del banco). Lo que ellos no pueden es fijar
 *  la tabla de prioridades, que es lo único que se rompe en silencio: cambiar
 *  dos `if` de orden deja a los cinco guiones verdes mientras el ataque se come
 *  a la muerte.
 *
 *  LO QUE NO MIDE, dicho para que nadie lo cuente de más:
 *
 *  - Que alguien LLAME a esto. El cable (`CharacterSpriteManager.updateAnim` →
 *    `animacion-de-entidades.ts` → el frame) no se toca aquí; eso son los cinco
 *    guiones de arriba.
 *  - Que la anim elegida TENGA hoja, o que se dibuje. `duracionDe` llega
 *    inyectada justamente para no saber nada de la caché de sprites.
 *  - El `pickFrame` que clampa el último fotograma de un one-shot: esto elige el
 *    clip, no el fotograma.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  avanzarAnimacion,
  BASE_ANIM_SET,
  newAnimState,
  type AnimInputs,
  type CharacterAnimState,
} from "../src/renderer/maquina-de-animacion.js";

/** Una anim que el set base NO tiene. Se afirma que no la tiene (abajo) en vez
 *  de darlo por hecho: el día que entre en el censo, los casos de «anim
 *  desconocida» dejarían de medir lo que dicen y hay que enterarse. */
const NO_EXISTE = "saludar";

const DURACION_POR_DEFECTO = 400;

/** El reloj de las hojas, inyectado. Apunta por qué anim se le pregunta: que NO
 *  se le pregunte también es una afirmación (ver el caso de `idle`). */
function relojDeHojas(duraciones: Record<string, number> = {}) {
  const pedidas: string[] = [];
  return {
    pedidas,
    duracionDe: (anim: string): number => {
      pedidas.push(anim);
      return duraciones[anim] ?? DURACION_POR_DEFECTO;
    },
  };
}

function entradas(p: Partial<AnimInputs> = {}): AnimInputs {
  return { alive: true, moving: false, ...p };
}

/** Un estado ya metido en una anim concreta, con su arranque en 0. */
function enPlena(anim: string): CharacterAnimState {
  return { anim, animStartedAt: 0 };
}

describe("el set base es el vocabulario, y esta foto lo ancla", () => {
  it(`"${NO_EXISTE}" NO está en el set base: los casos de anim desconocida miden algo`, () => {
    assert.equal(BASE_ANIM_SET.has(NO_EXISTE), false);
  });

  it("y las que sí usa esta batería están todas", () => {
    for (const anim of ["idle", "walk", "run", "quick", "heavy", "medium", "precise", "death"]) {
      assert.ok(BASE_ANIM_SET.has(anim), `el set base ya no trae "${anim}"`);
    }
  });

  it("un estado nuevo nace en idle, con su marca de tiempo", () => {
    assert.deepEqual(newAnimState(1234), { anim: "idle", animStartedAt: 1234 });
  });
});

describe("la prioridad: muerte > one-shot por evento > ataque > one-shot en curso > locomoción > pedida > idle", () => {
  it("MUERTO gana a todo: al one-shot, al ataque y a la locomoción a la vez", () => {
    const state = enPlena("run");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(
      state,
      entradas({ alive: false, moving: true, sprinting: true, attacking: true, oneShot: "quick" }),
      100,
      duracionDe,
    );
    assert.equal(state.anim, "death");
  });

  it("…y el cadáver se queda quieto: seguir llamando no re-arranca la anim", () => {
    const state: CharacterAnimState = { anim: "death", animStartedAt: 100 };
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas({ alive: false }), 5_000, duracionDe);
    assert.deepEqual(state, { anim: "death", animStartedAt: 100 });
  });

  it("revivir saca del death, y en el mismo frame ya puede echar a andar", () => {
    const state = enPlena("death");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas({ moving: true }), 300, duracionDe);
    assert.equal(state.anim, "walk");
    assert.equal(state.animStartedAt, 300);
  });

  it("el one-shot por EVENTO gana al ataque por nivel y a la locomoción", () => {
    const state = enPlena("run");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(
      state,
      entradas({ moving: true, attacking: true, attackType: "heavy", oneShot: "hit_react" }),
      50,
      duracionDe,
    );
    assert.equal(state.anim, "hit_react");
  });

  it("…y RE-ARRANCA aunque ya fuera la misma anim: dos quick seguidos son dos golpes", () => {
    const state = enPlena("quick");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas({ oneShot: "quick" }), 120, duracionDe);
    assert.deepEqual(
      state,
      { anim: "quick", animStartedAt: 120 },
      "si esto usara el `set` de cambio-solo, el segundo golpe no se vería: la anim ya era quick",
    );
  });

  it("un one-shot que el set base no tiene se IGNORA y manda la regla siguiente", () => {
    const state = enPlena("idle");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas({ moving: true, oneShot: NO_EXISTE }), 10, duracionDe);
    assert.equal(state.anim, "walk");
  });
});

describe("el ataque por NIVEL (el estado del sim, no un evento)", () => {
  it("usa el tipo que llega cuando existe en el set base", () => {
    const state = enPlena("idle");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas({ attacking: true, attackType: "precise" }), 10, duracionDe);
    assert.equal(state.anim, "precise");
  });

  it("cae a `medium` con un tipo que no existe, y también cuando no llega ninguno", () => {
    const { duracionDe } = relojDeHojas();
    const desconocido = enPlena("idle");
    avanzarAnimacion(desconocido, entradas({ attacking: true, attackType: NO_EXISTE }), 10, duracionDe);
    assert.equal(desconocido.anim, "medium");

    const sinTipo = enPlena("idle");
    avanzarAnimacion(sinTipo, entradas({ attacking: true }), 10, duracionDe);
    assert.equal(sinTipo.anim, "medium");
  });

  it("y NO re-arranca mientras el sim sigue atacando: el clip clampa, no parpadea", () => {
    const state = enPlena("heavy");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas({ attacking: true, attackType: "heavy" }), 900, duracionDe);
    assert.deepEqual(
      state,
      { anim: "heavy", animStartedAt: 0 },
      "re-arrancarlo cada frame dejaría el golpe en su primer fotograma para siempre",
    );
  });
});

describe("el one-shot EN CURSO, que es donde manda `duracionDe`", () => {
  it("no lo interrumpe la locomoción mientras no se ha acabado", () => {
    const state = enPlena("quick");
    const { duracionDe, pedidas } = relojDeHojas({ quick: 400 });
    avanzarAnimacion(state, entradas({ moving: true, sprinting: true }), 399, duracionDe);
    assert.deepEqual(state, { anim: "quick", animStartedAt: 0 });
    assert.deepEqual(pedidas, ["quick"], "se pregunta por la anim EN CURSO, no por otra");
  });

  it("…y en cuanto se acaba, la locomoción entra", () => {
    const state = enPlena("quick");
    const { duracionDe } = relojDeHojas({ quick: 400 });
    avanzarAnimacion(state, entradas({ moving: true }), 400, duracionDe);
    assert.deepEqual(state, { anim: "walk", animStartedAt: 400 });
  });

  it("la frontera la pone el reloj INYECTADO y no un número de esta máquina", () => {
    // El MISMO instante, con dos hojas de duración distinta, da dos respuestas.
    // Sin esto, «no interrumpe» se cumpliría con una constante cableada dentro.
    const corta = enPlena("quick");
    avanzarAnimacion(corta, entradas({ moving: true }), 500, relojDeHojas({ quick: 100 }).duracionDe);
    assert.equal(corta.anim, "walk");

    const larga = enPlena("quick");
    avanzarAnimacion(larga, entradas({ moving: true }), 500, relojDeHojas({ quick: 900 }).duracionDe);
    assert.equal(larga.anim, "quick");
  });

  it("a una anim que NO es one-shot ni se le pregunta la duración", () => {
    const state = enPlena("idle");
    const { duracionDe, pedidas } = relojDeHojas();
    avanzarAnimacion(state, entradas({ moving: true }), 10_000, duracionDe);
    assert.equal(state.anim, "walk");
    assert.deepEqual(pedidas, [], "`idle` no es one-shot: preguntar su duración sería trabajo inútil");
  });
});

describe("locomoción, anim pedida e idle", () => {
  it("andar es walk y esprintar es run", () => {
    const { duracionDe } = relojDeHojas();
    const anda = enPlena("idle");
    avanzarAnimacion(anda, entradas({ moving: true }), 10, duracionDe);
    assert.equal(anda.anim, "walk");

    const corre = enPlena("idle");
    avanzarAnimacion(corre, entradas({ moving: true, sprinting: true }), 10, duracionDe);
    assert.equal(corre.anim, "run");
  });

  it("la anim que pide el NpcDirector vale si existe, y cae a idle si no", () => {
    const { duracionDe } = relojDeHojas();
    const buena = enPlena("idle");
    avanzarAnimacion(buena, entradas({ requestedAnim: "heavy" }), 10, duracionDe);
    assert.equal(buena.anim, "heavy");

    const mala = enPlena("walk");
    avanzarAnimacion(mala, entradas({ requestedAnim: NO_EXISTE }), 10, duracionDe);
    assert.equal(mala.anim, "idle");
  });

  it("…pero andar manda sobre lo que pida el director", () => {
    const state = enPlena("idle");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas({ moving: true, requestedAnim: "heavy" }), 10, duracionDe);
    assert.equal(state.anim, "walk");
  });

  it("quieto y sin nada que hacer, idle", () => {
    const state = enPlena("walk");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas(), 10, duracionDe);
    assert.deepEqual(state, { anim: "idle", animStartedAt: 10 });
  });

  it("y la marca de tiempo solo se mueve cuando la anim CAMBIA", () => {
    const state = enPlena("walk");
    const { duracionDe } = relojDeHojas();
    avanzarAnimacion(state, entradas({ moving: true }), 5_000, duracionDe);
    assert.deepEqual(
      state,
      { anim: "walk", animStartedAt: 0 },
      "reiniciarla cada frame dejaría a todo el mundo clavado en el primer fotograma",
    );
  });
});
