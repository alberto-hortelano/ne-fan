/** El ÁREA del ataque tal como la dibuja el telegraph.
 *
 *  Por qué existe (issue #184): el renderer llevaba su propia copia de la
 *  fórmula del daño para pintar el parche del suelo. Dos copias de la misma
 *  verdad divergen sin que nada falle — el parche seguiría pintando bonito
 *  mientras miente sobre dónde llega el golpe. Ahora hay una sola fórmula, en
 *  core, y esto la afirma contra `resolveAttack` punto por punto.
 *
 *  Y sobre todo: afirma que el BORDE existe como dato. La calidad no sirve
 *  para dibujarlo (vale 0 en toda la frontera Y en todo el exterior), y por eso
 *  el jugador no veía hasta dónde llegaba el ataque. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attackAreaMargin,
  attackAreaQuality,
  attackAreaReach,
  attackFlashQuality,
  type AttackAreaParams,
} from "../src/combat/attack-area.js";
import { FRONT_COS, resolveAttack } from "../src/combat/combat-resolver.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Los cinco tipos reales del juego, del config que el jugador usa. */
function tiposDeAtaque(): [string, AttackAreaParams][] {
  const cfg = JSON.parse(readFileSync(join(HERE, "../data/combat_config.json"), "utf8"));
  const tipos = Object.entries(cfg.attack_types) as [string, AttackAreaParams][];
  assert.ok(tipos.length >= 5, "el config trae los cinco tipos de ataque");
  return tipos;
}

/** Rejilla fina del plano del ataque, con holgura fuera del área. */
function* rejilla(p: AttackAreaParams): Generator<[number, number]> {
  const uMax = p.optimal_distance + p.distance_tolerance + 0.6;
  const sMax = p.area_radius + 0.6;
  for (let iu = 0; iu <= 60; iu++) {
    for (let is = 0; is <= 60; is++) {
      yield [(uMax * iu) / 60, sMax * ((2 * is) / 60 - 1)];
    }
  }
}

describe("área del ataque: calidad y margen al borde", () => {
  it("dentro del área (margen < 0) ⟺ el golpe hace daño (calidad > 0)", () => {
    for (const [id, p] of tiposDeAtaque()) {
      for (const [u, s] of rejilla(p)) {
        const m = attackAreaMargin(p, u, s);
        // La franja de ±1 mm alrededor de la frontera se salta: ahí las dos
        // expresiones son la misma con distinto redondeo, y afirmar sobre el
        // último bit del float no dice nada del juego.
        const q = attackAreaQuality(p, u, s);
        // Fuera del área la calidad es CERO, nunca negativa: un factor sin su
        // corte devuelve números por debajo de cero y el "no llega" se
        // convertiría en curación.
        assert.ok(q >= 0 && q <= 1, `${id} en (u=${u}, s=${s}): calidad fuera de 0..1 (${q})`);
        if (Math.abs(m) < 1e-3) continue;
        assert.equal(
          m < 0,
          q > 0,
          `${id} en (u=${u.toFixed(3)}, s=${s.toFixed(3)}): margen ${m} vs calidad ${q}`,
        );
      }
    }
  });

  it("la calidad es la MISMA que resuelve el daño (paridad con resolveAttack)", () => {
    // El plano (u, s) es RELATIVO al atacante: `u` sobre su forward y `s` a su
    // derecha. Se comprueba en dos marcos —el trivial y uno girado y lejos del
    // origen— porque con el atacante en (0,0) mirando a +z media aritmética
    // del resolver se cancela y la paridad saldría verde con la fórmula
    // referida al ORIGEN DEL MUNDO, que es un juego distinto.
    const marcos = [
      { pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: 1 }, nombre: "origen mirando al sur" },
      { pos: { x: 7.5, y: 0, z: -3.25 }, fwd: { x: 0.6, y: 0, z: -0.8 }, nombre: "desplazado y girado" },
    ];
    for (const { pos, fwd, nombre } of marcos) {
      // Derecha = forward girado 90°, el mismo marco que usa el renderer.
      const rx = -fwd.z;
      const rz = fwd.x;
      for (const [id, p] of tiposDeAtaque()) {
        for (const [u, s] of rejilla(p)) {
          const esperado = attackAreaQuality(p, u, s);
          const real = resolveAttack(
            pos,
            fwd,
            { x: pos.x + fwd.x * u + rx * s, y: 0, z: pos.z + fwd.z * u + rz * s },
            "idle",
            { ...p, base_damage: 1, damage_reduction: 0, wind_up_time: 0 },
            {},
            id,
          );
          assert.ok(
            Math.abs(real - esperado) < 1e-9,
            `${id} (${nombre}) en (u=${u.toFixed(3)}, s=${s.toFixed(3)}): telegraph ${esperado} vs daño ${real}`,
          );
        }
      }
    }
  });

  it("justo EN la frontera del cono no se golpea (el borde es exclusivo)", () => {
    // El punto se construye para que la distancia al borde del cono sea CERO
    // exacta en coma flotante: |s|·cos − u·sen = 0 con u = 1 y s = sen/cos.
    // Sin este caso, un borde inclusivo (`>` donde va `>=`) pasa inadvertido:
    // ninguna rejilla cae justo encima de una recta irracional.
    const sen = Math.sqrt(1 - FRONT_COS * FRONT_COS);
    const sBorde = sen / FRONT_COS;
    // El punto tiene que caer donde el CONO es el límite que corta: si lo hace
    // el radio lateral, el margen ya no vale cero y no se estaría probando el
    // arco. `heavy` (radio 2,5) tiene sitio de sobra a un metro de avance; el
    // segundo juego de params lo tiene aún más, para que la prueba no dependa
    // de que nadie retoque el config del ataque fuerte.
    const casos: [string, AttackAreaParams][] = [
      ["heavy", tiposDeAtaque().find(([id]) => id === "heavy")![1]],
      ["arco holgado", { optimal_distance: 2, distance_tolerance: 1.5, area_radius: 6 }],
    ];
    for (const [id, p] of casos) {
      const u = 1;
      const s = u * sBorde;
      assert.ok(Math.abs(s) < p.area_radius, `${id}: el caso no aísla el cono (manda el radio lateral)`);
      assert.equal(attackAreaMargin(p, u, s), 0, `${id}: el punto no está EN la frontera del cono`);
      assert.equal(attackAreaQuality(p, u, s), 0, `${id}: en la frontera del cono no se golpea`);
      // Y un pelo dentro sí, para que "cero" no sea cero por otro motivo.
      assert.ok(attackAreaQuality(p, u, s * 0.9) > 0, `${id}: un pelo dentro del arco SÍ se golpea`);
      // También en el otro lado: el arco es simétrico.
      assert.equal(attackAreaQuality(p, u, -s), 0, `${id}: la frontera del otro lado del arco`);
    }
  });

  it("los TRES límites tienen borde: el radial, el lateral y el arco del cono", () => {
    // Con `heavy` (óptimo 2, tolerancia 1,5, radio 2,5) los tres cortan de
    // verdad: no es un caso de laboratorio, es el ataque fuerte del juego.
    const heavy = tiposDeAtaque().find(([id]) => id === "heavy")![1];
    const cero = (u: number, s: number) => Math.abs(attackAreaMargin(heavy, u, s)) < 5e-3;

    // 1. radial LEJOS, sobre el forward: el alcance máximo del golpe.
    const { cerca, lejos } = attackAreaReach(heavy);
    assert.ok(cero(lejos, 0), `borde lejano en u=${lejos}`);
    assert.ok(attackAreaMargin(heavy, lejos - 0.1, 0) < 0, "justo dentro del borde lejano");
    assert.ok(attackAreaMargin(heavy, lejos + 0.1, 0) > 0, "justo fuera del borde lejano");
    // 2. radial CERCA: pegado al atacante tampoco se llega.
    assert.ok(cero(cerca, 0), `borde cercano en u=${cerca}`);
    assert.ok(attackAreaMargin(heavy, cerca - 0.1, 0) > 0, "demasiado cerca = fuera");
    // 3. lateral: |s| = radio, a la distancia óptima.
    assert.ok(cero(heavy.optimal_distance, heavy.area_radius), "borde lateral");
    // 4. cono: la recta a ±60°. En u = 0,5 el cono admite |s| < 0,87 — muy por
    // debajo de los 2,5 m de radio, así que ahí manda el arco y no la banda.
    const sCono = (0.5 * Math.sqrt(1 - FRONT_COS * FRONT_COS)) / FRONT_COS;
    assert.ok(sCono < heavy.area_radius, "en u=0,5 el cono corta antes que el radio");
    assert.ok(cero(0.5, sCono), `borde del cono en (0.5, ${sCono})`);
    assert.ok(attackAreaMargin(heavy, 0.5, sCono + 0.3) > 0, "fuera del arco");
  });

  it("el margen crece con la distancia al área: distingue el filo de lejísimos", () => {
    // Es LA razón de que exista `attackAreaMargin`. La calidad vale 0 en el
    // borde y 0 a diez metros: con ella no se puede dibujar un contorno.
    const heavy = tiposDeAtaque().find(([id]) => id === "heavy")![1];
    const { lejos } = attackAreaReach(heavy);
    assert.equal(attackAreaQuality(heavy, lejos + 0.05, 0), 0);
    assert.equal(attackAreaQuality(heavy, lejos + 10, 0), 0);
    const filo = attackAreaMargin(heavy, lejos + 0.05, 0);
    const lejisimos = attackAreaMargin(heavy, lejos + 10, 0);
    assert.ok(filo > 0 && filo < 0.1, `al filo el margen es pequeño (${filo})`);
    assert.ok(lejisimos > filo + 5, `lejísimos el margen es grande (${lejisimos})`);
  });

  it("a la espalda del atacante no hay área, ni siquiera a la distancia óptima", () => {
    for (const [id, p] of tiposDeAtaque()) {
      const u = -p.optimal_distance;
      assert.equal(attackAreaQuality(p, u, 0), 0, `${id} a la espalda`);
      assert.ok(attackAreaMargin(p, u, 0) > 0, `${id} a la espalda queda FUERA`);
    }
  });

  it("el alcance son los dos bordes sobre el forward, y nunca empieza detrás del jugador", () => {
    for (const [id, p] of tiposDeAtaque()) {
      const { cerca, lejos } = attackAreaReach(p);
      assert.ok(cerca >= 0, `${id}: el borde cercano no puede quedar a la espalda`);
      assert.ok(lejos > cerca, `${id}: el alcance tiene fondo`);
      assert.equal(lejos, p.optimal_distance + p.distance_tolerance, `${id}: borde lejano`);
      assert.equal(
        cerca,
        Math.max(0, p.optimal_distance - p.distance_tolerance),
        `${id}: borde cercano`,
      );
      // Y son los bordes DE VERDAD, no dos números que casan con la fórmula:
      // sobre el forward, el margen al área es cero en los dos.
      assert.ok(Math.abs(attackAreaMargin(p, lejos, 0)) < 1e-9, `${id}: el borde lejano está en el filo`);
      if (cerca > 0) {
        assert.ok(Math.abs(attackAreaMargin(p, cerca, 0)) < 1e-9, `${id}: el borde cercano está en el filo`);
      }
    }
    // Un ataque con tolerancia mayor que el óptimo llega hasta los pies.
    assert.equal(attackAreaReach({ optimal_distance: 1, distance_tolerance: 3, area_radius: 1 }).cerca, 0);
  });
});

/** El destello de impacto: el ÚNICO trozo de esta tanda que el jugador ve y
 *  que no tenía candado (hallazgo H2 de QA). El color no adorna, informa: verde
 *  = golpe bueno, gris = no llegaste. Con la fórmula escrita a mano en el
 *  cliente, un enemigo a la espalda salía VERDE PLENO mientras el resolver no
 *  hacía ni un punto de daño; ahora la proyección al plano del ataque vive
 *  aquí y se puede afirmar sin navegador ni enemigos vivos. */
describe("calidad del destello de impacto", () => {
  /** Marco NO trivial: atacante fuera del origen y mirando en diagonal. Con el
   *  atacante en (0,0) mirando a +z, una proyección referida al origen del
   *  mundo daría los mismos números y el test no distinguiría las dos. */
  const from = { x: 7.25, z: -3.5 };
  const ang = 0.9;
  const forward = { x: Math.sin(ang), z: Math.cos(ang) };
  const enPlano = (u: number, s: number) => ({
    x: from.x + forward.x * u + forward.z * s,
    z: from.z + forward.z * u - forward.x * s,
  });

  it("a la espalda el destello es GRIS, aunque esté a la distancia óptima", () => {
    for (const [id, p] of tiposDeAtaque()) {
      const delante = attackFlashQuality(p, from, forward, [enPlano(p.optimal_distance, 0)]);
      assert.ok(delante > 0.99, `${id}: delante y en el óptimo el destello es pleno (${delante})`);
      const espalda = attackFlashQuality(p, from, forward, [enPlano(-p.optimal_distance, 0)]);
      assert.equal(espalda, 0, `${id}: a la espalda el destello NO puede teñirse`);
      // A 90° tampoco: el cono es de ±60°, y esta es la distancia a la que la
      // fórmula vieja daba color (0.15, verdoso) en vez de gris.
      const costado = attackFlashQuality(p, from, forward, [enPlano(0, p.optimal_distance)]);
      assert.equal(costado, 0, `${id}: a 90° el golpe no llega`);
    }
  });

  it("se queda con el MEJOR objetivo, y sin objetivos no hay destello", () => {
    const [, p] = tiposDeAtaque()[0];
    const lejos = enPlano(p.optimal_distance + p.distance_tolerance * 0.9, 0);
    const clavado = enPlano(p.optimal_distance, 0);
    const qLejos = attackFlashQuality(p, from, forward, [lejos]);
    assert.ok(qLejos > 0 && qLejos < 0.5, `el del filo tiñe poco (${qLejos})`);
    assert.ok(
      attackFlashQuality(p, from, forward, [lejos, clavado]) >
        attackFlashQuality(p, from, forward, [lejos]),
      "con dos objetivos manda el mejor, no el primero",
    );
    assert.equal(attackFlashQuality(p, from, forward, []), 0, "sin objetivos, gris");
  });

  it("es exactamente la calidad del área en el punto proyectado", () => {
    // Una sola fórmula: si el destello divergiera del parche, el jugador vería
    // un color que el suelo desmiente.
    const [, p] = tiposDeAtaque()[1];
    for (const [u, s] of [[1.2, 0.4], [2.0, -0.9], [0.3, 0.1], [3.4, 1.6]] as [number, number][]) {
      const destello = attackFlashQuality(p, from, forward, [enPlano(u, s)]);
      const parche = attackAreaQuality(p, u, s);
      // Ir y volver por coordenadas de mundo mueve el último bit del float; lo
      // que se afirma es que es la MISMA fórmula, no la misma redondeo.
      assert.ok(
        Math.abs(destello - parche) < 1e-12,
        `(u=${u}, s=${s}): destello ${destello} vs parche ${parche}`,
      );
    }
  });
});
