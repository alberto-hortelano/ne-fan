/** La mirada en primera persona: los dos ejes y sus reglas distintas.
 *
 *  Lo que estos asertos impiden es lo que se ve desde dentro de los ojos del
 *  jugador: que el mundo se dé la vuelta al mirar del todo hacia arriba (gimbal
 *  lock), que mirar al suelo le empuje contra el suelo, y que mantener una
 *  flecha pulsada le haga girar sin parar. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  Mirada,
  PASO_DE_PITCH_RAD,
  PASO_DE_YAW_RAD,
  SENSIBILIDAD_RAD_POR_PX,
  TOPE_DE_PITCH_RAD,
} from "../src/simulation/mirada.js";

const SIN_GIRO = { turnLeft: false, turnRight: false, turnUp: false, turnDown: false };
const casi = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

describe("Mirada · el arranque", () => {
  it("nace encarando −Z, que es como arranca el juego", () => {
    const m = new Mirada();
    assert.equal(m.yaw, Math.PI);
    assert.equal(m.pitch, 0);
    assert.deepEqual(m.forward, { x: 0, y: 0, z: -1 });
  });
});

describe("Mirada · el yaw es el marco del WASD", () => {
  it("el forward sale del yaw y es SIEMPRE horizontal", () => {
    const m = new Mirada();
    m.ponYaw(Math.PI / 2);
    assert.ok(casi(m.forward.x, 1) && casi(m.forward.z, 0));
    assert.equal(m.forward.y, 0);
  });

  it("mirar al suelo NO inclina el forward: caminar sigue siendo horizontal", () => {
    // El bug que esta separación impide: con el pitch dentro del marco, mirar
    // abajo y pulsar W te empujaría contra el suelo.
    const m = new Mirada();
    const antes = { ...m.forward };
    m.ponPitch(-TOPE_DE_PITCH_RAD);
    assert.deepEqual(m.forward, antes);
  });

  it("el yaw NO tiene tope: da vueltas enteras", () => {
    const m = new Mirada();
    m.ponYaw(9 * Math.PI);
    assert.equal(m.yaw, 9 * Math.PI);
  });
});

describe("Mirada · el pitch está acotado, y por eso el mundo no se da la vuelta", () => {
  it("mirando arriba del todo se queda en el tope, no lo pasa", () => {
    const m = new Mirada();
    m.ponPitch(Math.PI);
    assert.equal(m.pitch, TOPE_DE_PITCH_RAD);
  });

  it("y abajo del todo, igual", () => {
    const m = new Mirada();
    m.ponPitch(-Math.PI);
    assert.equal(m.pitch, -TOPE_DE_PITCH_RAD);
  });

  it("el tope es 85° y NO 90°: los 5° de margen son el gimbal lock", () => {
    assert.ok(TOPE_DE_PITCH_RAD < Math.PI / 2, "un tope de 90° deja el yaw sin definir");
    assert.equal(Math.round((TOPE_DE_PITCH_RAD * 180) / Math.PI), 85);
  });

  it("se publica en GRADOS para quien lo lea desde fuera", () => {
    const m = new Mirada();
    m.ponPitch(Math.PI / 4);
    assert.ok(casi(m.pitchEnGrados, 45));
  });

  it("enderezar deja la mirada al frente sin tocar hacia dónde miras", () => {
    const m = new Mirada();
    m.ponYaw(1.234);
    m.ponPitch(0.5);
    m.enderezar();
    assert.equal(m.pitch, 0);
    assert.equal(m.yaw, 1.234, "el yaw es de la partida, no del reset de mundo");
  });
});

describe("Mirada · el ratón", () => {
  it("a la derecha gira a la derecha; abajo mira abajo", () => {
    const m = new Mirada();
    const yaw0 = m.yaw;
    m.raton(100, 40);
    assert.ok(casi(m.yaw, yaw0 - 100 * SENSIBILIDAD_RAD_POR_PX));
    assert.ok(casi(m.pitch, -40 * SENSIBILIDAD_RAD_POR_PX));
  });

  it("un tirón enorme del ratón tampoco pasa del tope vertical", () => {
    const m = new Mirada();
    m.raton(0, -100000);
    assert.equal(m.pitch, TOPE_DE_PITCH_RAD);
  });

  it("sin movimiento no se toca nada", () => {
    const m = new Mirada();
    m.ponYaw(2);
    m.ponPitch(0.3);
    m.raton(0, 0);
    assert.equal(m.yaw, 2);
    assert.equal(m.pitch, 0.3);
  });

  it("el ratón y las flechas mueven el MISMO yaw, y el forward se entera", () => {
    const m = new Mirada();
    m.raton(100, 0);
    const tras = { ...m.forward };
    assert.notDeepEqual(tras, { x: 0, y: 0, z: -1 });
    assert.ok(casi(Math.hypot(m.forward.x, m.forward.z), 1), "y sigue siendo unitario");
  });
});

describe("Mirada · las flechas van por FLANCO, no por estar pulsadas", () => {
  it("una pulsación es UN paso de 45°, aunque se mantenga", () => {
    const m = new Mirada();
    const yaw0 = m.yaw;
    m.pasos({ ...SIN_GIRO, turnLeft: true });
    assert.ok(casi(m.yaw, yaw0 + PASO_DE_YAW_RAD));
    // Mantenida: tres frames más y no se mueve ni un grado.
    m.pasos({ ...SIN_GIRO, turnLeft: true });
    m.pasos({ ...SIN_GIRO, turnLeft: true });
    assert.ok(casi(m.yaw, yaw0 + PASO_DE_YAW_RAD), "mantener no repite");
  });

  it("soltar y volver a pulsar SÍ da otro paso", () => {
    const m = new Mirada();
    const yaw0 = m.yaw;
    m.pasos({ ...SIN_GIRO, turnLeft: true });
    m.pasos(SIN_GIRO);
    m.pasos({ ...SIN_GIRO, turnLeft: true });
    assert.ok(casi(m.yaw, yaw0 + 2 * PASO_DE_YAW_RAD));
  });

  it("derecha resta lo que izquierda suma", () => {
    const m = new Mirada();
    const yaw0 = m.yaw;
    m.pasos({ ...SIN_GIRO, turnRight: true });
    assert.ok(casi(m.yaw, yaw0 - PASO_DE_YAW_RAD));
  });

  it("↑/↓ son de 15°, y también por flanco", () => {
    const m = new Mirada();
    m.pasos({ ...SIN_GIRO, turnUp: true });
    assert.ok(casi(m.pitch, PASO_DE_PITCH_RAD));
    m.pasos({ ...SIN_GIRO, turnUp: true });
    assert.ok(casi(m.pitch, PASO_DE_PITCH_RAD), "mantener no repite");
    m.pasos(SIN_GIRO);
    m.pasos({ ...SIN_GIRO, turnDown: true });
    assert.ok(casi(m.pitch, 0));
  });

  it("aporrear ↑ tampoco pasa del tope", () => {
    const m = new Mirada();
    for (let i = 0; i < 40; i++) {
      m.pasos({ ...SIN_GIRO, turnUp: true });
      m.pasos(SIN_GIRO);
    }
    assert.equal(m.pitch, TOPE_DE_PITCH_RAD);
  });

  it("el paso de ←/→ es MAYOR que el de ↑/↓: el eje vertical recorre menos", () => {
    assert.ok(PASO_DE_YAW_RAD > PASO_DE_PITCH_RAD);
  });
});
