/** Las reglas de andar del jugador, que hasta hoy no las miraba nadie.
 *
 *  Vivían dentro del `gameLoop` del cliente, donde no hay harness (#241): la
 *  diagonal renormalizada, el marco relativo al facing, el deslizamiento por
 *  ejes y la regla «salir sí, entrar no» se sostenían solo en que nadie las
 *  tocara. Los asertos de aquí son los que un jugador notaría rotos: correr más
 *  en diagonal, pegarse a las paredes en vez de deslizar, y quedarse atrapado
 *  para siempre dentro de una huella. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  intencionDeTeclas,
  pasoDelJugador,
  velocidadDelJugador,
} from "../src/simulation/paso-del-jugador.js";

/** Mirando a −Z, que es como arranca el juego. */
const NORTE = { x: 0, z: -1 };
const LIBRE = (): boolean => false;
const ORIGEN = { x: 0, z: 0 };

/** Un paso de un segundo a 1 m/s: el delta sale en metros redondos. */
function paso(
  intencion: { adelante: number; derecha: number },
  solido: (x: number, z: number) => boolean = LIBRE,
  forward = NORTE,
  desde = ORIGEN,
): { dx: number; dz: number } {
  return pasoDelJugador({ desde, forward, intencion, velocidad: 1, delta: 1, solido });
}

describe("intencionDeTeclas", () => {
  it("W adelante, S atrás, D a la derecha, A a la izquierda", () => {
    const t = (up = false, down = false, left = false, right = false) =>
      intencionDeTeclas({ up, down, left, right });
    assert.deepEqual(t(true), { adelante: 1, derecha: 0 });
    assert.deepEqual(t(false, true), { adelante: -1, derecha: 0 });
    assert.deepEqual(t(false, false, false, true), { adelante: 0, derecha: 1 });
    assert.deepEqual(t(false, false, true), { adelante: 0, derecha: -1 });
  });

  it("las teclas opuestas a la vez se anulan, no se pelean", () => {
    assert.deepEqual(intencionDeTeclas({ up: true, down: true, left: true, right: true }), {
      adelante: 0,
      derecha: 0,
    });
  });
});

describe("pasoDelJugador · el marco es el del personaje", () => {
  it("W avanza hacia donde se mira", () => {
    assert.deepEqual(paso({ adelante: 1, derecha: 0 }), { dx: 0, dz: -1 });
  });

  it("S camina DE ESPALDAS sin girar", () => {
    assert.deepEqual(paso({ adelante: -1, derecha: 0 }), { dx: 0, dz: 1 });
  });

  it("D es strafe a la derecha del personaje, no del mundo", () => {
    // Mirando al norte (−Z), la derecha del personaje es +X.
    const d = paso({ adelante: 0, derecha: 1 });
    assert.equal(Math.round(d.dx * 1e9) / 1e9, 1);
    assert.equal(Math.round(d.dz * 1e9) / 1e9, 0);
  });

  it("girado 90°, las MISMAS teclas van a otro sitio", () => {
    // Mirando al este (+X): W tiene que llevar a +X.
    const d = paso({ adelante: 1, derecha: 0 }, LIBRE, { x: 1, z: 0 });
    assert.deepEqual(d, { dx: 1, dz: 0 });
  });

  it("quieto es quieto: sin teclas no hay delta", () => {
    assert.deepEqual(paso({ adelante: 0, derecha: 0 }), { dx: 0, dz: 0 });
  });
});

describe("pasoDelJugador · la diagonal no corre más", () => {
  it("W+D recorre lo mismo que W a secas", () => {
    const recto = paso({ adelante: 1, derecha: 0 });
    const diagonal = paso({ adelante: 1, derecha: 1 });
    const largo = (d: { dx: number; dz: number }) => Math.hypot(d.dx, d.dz);
    assert.ok(Math.abs(largo(diagonal) - largo(recto)) < 1e-9, `${largo(diagonal)} ≠ ${largo(recto)}`);
  });

  it("y va a 45°, no a un eje", () => {
    const d = paso({ adelante: 1, derecha: 1 });
    assert.ok(Math.abs(Math.abs(d.dx) - Math.abs(d.dz)) < 1e-9);
  });

  it("el delta escala con la velocidad y con el tiempo del frame", () => {
    const d = pasoDelJugador({
      desde: ORIGEN,
      forward: NORTE,
      intencion: { adelante: 1, derecha: 0 },
      velocidad: 6,
      delta: 0.5,
      solido: LIBRE,
    });
    assert.deepEqual(d, { dx: 0, dz: -3 });
  });
});

describe("pasoDelJugador · lo sólido", () => {
  it("deslizar por la pared: el eje que choca se queda a cero y el otro pasa", () => {
    // Un muro en todo el norte: yendo en diagonal NE, X pasa y Z no.
    const muroAlNorte = (_x: number, z: number): boolean => z < -0.5;
    const d = paso({ adelante: 1, derecha: 1 }, muroAlNorte);
    assert.equal(d.dz, 0, "la componente que entra en el muro se anula");
    assert.ok(d.dx > 0, "y la que va paralela a él sigue");
  });

  it("de frente contra el muro no se avanza", () => {
    const muroAlNorte = (_x: number, z: number): boolean => z < -0.5;
    assert.deepEqual(paso({ adelante: 1, derecha: 0 }, muroAlNorte), { dx: 0, dz: 0 });
  });

  it("SALIR SÍ, ENTRAR NO: desde dentro de una huella sólida se permite todo", () => {
    // El caso del save antiguo dentro de un volumen que hoy bloquea, y el del
    // teletransporte del bench. Sin esta regla el jugador no vuelve a moverse.
    //
    // EN DIAGONAL A PROPÓSITO, y no de frente: con un solo eje en juego, medio
    // candado se puede quitar sin que este aserto se entere. Se probó en
    // negativo el 2026-09-01 —quitando `atrapado ||` SOLO del eje X— y la
    // versión anterior de este test, que iba recta al norte, salió VERDE con la
    // mitad de la regla borrada.
    const todoSolido = (): boolean => true;
    const d = paso({ adelante: 1, derecha: 1 }, todoSolido);
    assert.ok(d.dx > 0, "el eje X sale del sólido");
    assert.ok(d.dz < 0, "y el eje Z también");
  });

  it("los ejes se prueban por SEPARADO desde el origen, no en cadena", () => {
    // Si se probara el punto ya desplazado en X, una esquina cóncava daría
    // «bloqueado» en los dos ejes y el jugador se pegaría a ella.
    const visitas: [number, number][] = [];
    paso({ adelante: 1, derecha: 1 }, (x, z) => {
      visitas.push([x, z]);
      return false;
    });
    const [origen, ejeX, ejeZ] = visitas;
    assert.deepEqual(origen, [0, 0]);
    assert.equal(ejeZ[0], 0, "la prueba del eje Z sale del origen, no del X ya movido");
    assert.equal(ejeX[1], 0, "y la del eje X, igual");
  });
});

describe("pasoDelJugador · fail-loud", () => {
  it("un forward nulo es una llamada mal construida, no «no se mueve»", () => {
    assert.throws(
      () => paso({ adelante: 1, derecha: 0 }, LIBRE, { x: 0, z: 0 }),
      /forward nulo/,
    );
  });

  it("pero sin intención no se mira siquiera el forward: quieto es quieto", () => {
    assert.deepEqual(paso({ adelante: 0, derecha: 0 }, LIBRE, { x: 0, z: 0 }), { dx: 0, dz: 0 });
  });
});

/** Los dos ejes NO están cubiertos por igual, y hasta la mutación no se veía:
 *  todos los asertos de arriba que varían velocidad, frame o pared caminan
 *  hacia −Z, donde `dx` vale 0 pase lo que pase. Con el numerador a cero da lo
 *  mismo multiplicar que dividir, así que la aritmética de `dx` y su prueba
 *  contra lo sólido salían verdes rotas. Estos dos asertos son los mismos de
 *  antes MIRANDO AL NORTE PERO ANDANDO DE LADO, que es donde `dx` manda. */
describe("pasoDelJugador · el eje lateral se mide igual que el frontal", () => {
  it("el strafe también escala con la velocidad y con el tiempo del frame", () => {
    const d = pasoDelJugador({
      desde: ORIGEN,
      forward: NORTE,
      intencion: { adelante: 0, derecha: 1 },
      velocidad: 6,
      delta: 0.5,
      solido: LIBRE,
    });
    assert.deepEqual(d, { dx: 3, dz: 0 }, "6 m/s durante medio segundo son 3 m de lado");
  });

  it("la pared lateral se prueba HACIA DONDE VAS, no hacia el otro lado", () => {
    // Muro pegado a la derecha del jugador y nada más: solo el signo del
    // desplazamiento probado decide si se entra en él o se resbala.
    const muroAlEste = (x: number): boolean => x > 0.5;
    const d = paso({ adelante: 0, derecha: 1 }, muroAlEste);
    assert.equal(d.dx, 0, "ir hacia el muro se bloquea");
    const izquierda = paso({ adelante: 0, derecha: -1 }, muroAlEste);
    assert.equal(izquierda.dx, -1, "alejarse del muro no se bloquea");
  });
});

/** LOS METROS POR SEGUNDO, que hasta hoy los ponía el cliente (#241, PR 8).
 *
 *  Los tres números son del `combat_config.json` y aquí se afirman ANDANDO Y
 *  ESPRINTANDO con una escala que no es 1 ni 2: con `speed_scale: 1` el
 *  producto no se distinguiría de no multiplicar, y con 2 no se distinguiría
 *  de sumar consigo mismo. */
describe("velocidadDelJugador · el config manda y la tecla solo elige cuál", () => {
  /** Los del juego, para que un cambio en el config se vea aquí. */
  const REAL = { walk_speed: 1.9, sprint_speed: 3.8, speed_scale: 2.2 };

  it("andando son walk_speed × speed_scale, en metros por segundo", () => {
    assert.equal(velocidadDelJugador(REAL, false), 1.9 * 2.2);
    // Y el número, escrito a mano: 4,18 m/s es lo que anda el jugador hoy.
    assert.ok(Math.abs(velocidadDelJugador(REAL, false) - 4.18) < 1e-9);
  });

  it("esprintando son sprint_speed × speed_scale, y no la de andar", () => {
    assert.equal(velocidadDelJugador(REAL, true), 3.8 * 2.2);
    assert.ok(Math.abs(velocidadDelJugador(REAL, true) - 8.36) < 1e-9);
    assert.notEqual(velocidadDelJugador(REAL, true), velocidadDelJugador(REAL, false));
  });

  it("la escala MULTIPLICA: con otra distinta cambian las dos a la vez", () => {
    // Escala 3 sobre velocidades 2 y 5: si la operación fuese una división o
    // una suma, ninguno de los dos números saldría.
    const cfg = { walk_speed: 2, sprint_speed: 5, speed_scale: 3 };
    assert.equal(velocidadDelJugador(cfg, false), 6);
    assert.equal(velocidadDelJugador(cfg, true), 15);
  });

  it("con la escala a 1 el jugador anda exactamente lo que dice el config", () => {
    const cfg = { walk_speed: 1.9, sprint_speed: 3.8, speed_scale: 1 };
    assert.equal(velocidadDelJugador(cfg, false), 1.9);
    assert.equal(velocidadDelJugador(cfg, true), 3.8);
  });
});

/** LA VELOCIDAD ENTRA EN EL PASO: los metros del frame son los de la función,
 *  no los que quiera el llamante. Es la costura entre los dos, y sin este
 *  aserto `velocidadDelJugador` podría estar bien y no llegar a moverse nada. */
describe("velocidadDelJugador + pasoDelJugador · los metros andados de un frame", () => {
  const REAL = { walk_speed: 1.9, sprint_speed: 3.8, speed_scale: 2.2 };

  it("un segundo andando al norte recorre 4,18 m; esprintando, 8,36", () => {
    const frame = (sprint: boolean) =>
      pasoDelJugador({
        desde: ORIGEN,
        forward: NORTE,
        intencion: { adelante: 1, derecha: 0 },
        velocidad: velocidadDelJugador(REAL, sprint),
        delta: 1,
        solido: LIBRE,
      });
    assert.ok(Math.abs(frame(false).dz + 4.18) < 1e-9);
    assert.ok(Math.abs(frame(true).dz + 8.36) < 1e-9);
  });
});
