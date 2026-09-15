/** EL JUGADOR ENTRA EN UN EDIFICIO ANDANDO HACIA SU ESQUINA — reproducción sin navegador.
 *
 *  ## De dónde sale
 *
 *  Del QA de la PR-3 de #545 (el reproductor bajo carga). Bajo carga sintética,
 *  el guion 91 se pone rojo con el jugador **dentro** de la caja de la forja
 *  (`parada (9.48, -12.05) · a 0.66 m del centro · le sobra -1.74 m al borde`,
 *  2026-09-15), y la pregunta era si eso es el reproductor exagerando o algo
 *  que le puede pasar a quien juega. Esto lo contesta sin abrir un navegador:
 *  **no hace falta carga ninguna**, y tampoco hace falta un frame largo.
 *
 *  ## El mecanismo, en una frase
 *
 *  `pasoDelJugador` (`src/simulation/paso-del-jugador.ts`) prueba los dos ejes
 *  POR SEPARADO —`solido(x+dx, z)` y `solido(x, z+dz)`— así que acercándose a
 *  una caja por su ESQUINA, cada eje suelto sigue fuera de la caja mientras la
 *  suma de los dos ya está dentro: ninguno de los dos sondeos ve nada y el paso
 *  entero se aplica. Y una vez dentro, `aabbBloquea` deja pasar TODO
 *  (`yaDentro` → no bloquea, la regla «salir sí, entrar no» de #489), así que
 *  el jugador cruza el edificio entero.
 *
 *  ## Lo que esto NO es
 *
 *  **No es un túnel por delta grande.** Con `walk × speed_scale` y el tope de
 *  0,1 s del `gameLoop` (`nefan-html/src/main.ts:566`), el paso máximo es de
 *  0,42 m contra una banda sólida de 4,8 m: atravesarla en un frame pediría un
 *  delta de 1,15 s, y el tope existe justo para que eso no ocurra. Lo que la
 *  carga cambia no es si se puede entrar, es **cuántos rumbos entran**: la
 *  ventana angular crece con el paso, y el tope la deja de crecer por debajo de
 *  10 fps. Por eso el defecto se ve también a 60 fps, y por eso no se arregla
 *  «poniendo más fps».
 *
 *  ## Contrato de salida (es una REPRODUCCIÓN, no un candado)
 *
 *    0  se reprodujo: hay rumbos por los que el jugador entra, y el control
 *       (los rumbos que apuntan a una CARA) sigue frenándolo como debe
 *    1  ya no se reproduce —alguien lo arregló, y entonces este fichero se
 *       BORRA— o el control dejó de frenar, que sería medir otra cosa
 *
 *  ## Probado en negativo, y se puede volver a probar
 *
 *    QA_FIX_SIMULADO=1 node qa/la-esquina-de-la-caja-se-corta.mjs
 *      comprueba el destino COMBINADO además de los dos ejes sueltos, que es
 *      el arreglo natural → **ventana 0,00° en los cinco relojes, exit 1**.
 *      Es la prueba de que esto puede decir «ya no se reproduce».
 *    QA_SIN_CAJA=1 node qa/la-esquina-de-la-caja-se-corta.mjs
 *      nada frena → **el CONTROL se pone rojo, exit 1**. Es la prueba de que
 *      la tabla de arriba no saldría igual de alarmante sin medir nada.
 *
 *  Lo que NO arregla el defecto, medido aquí: **inflar el radio** por el tamaño
 *  del paso. La esquina es simétrica, así que la ventana se mueve con la pared
 *  y sigue habiendo rumbos que entran; el arreglo tiene que mirar el destino
 *  combinado, no dar más margen.
 *
 *  Sin navegador, sin stack y sin créditos: son `nefan-core/dist` y aritmética.
 *  Fuera del job `candados-headless` y fuera de la batería: mientras el defecto
 *  viva, esto sale 0, y un candado que solo puede salir verde no es un candado.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { aabbBloquea } from "../nefan-core/dist/src/simulation/obstaculos-del-jugador.js";
import { pasoDelJugador, velocidadDelJugador } from "../nefan-core/dist/src/simulation/paso-del-jugador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** La velocidad sale del config del juego, no de un literal: si alguien la
 *  cambia, esta medida le sigue en vez de envejecer en silencio. */
const cfg = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/combat_config.json"), "utf8"));
const VELOCIDAD = velocidadDelJugador(cfg.player, false);

/** El tope del `delta` del `gameLoop`, leído del fuente del cliente por la
 *  misma razón que lo ancla `test/carga-sintetica.test.ts`: es el número que
 *  decide cuánto puede medir un paso. */
const MAIN = readFileSync(path.join(RAIZ, "nefan-html/src/main.ts"), "utf8");
const TOPE = Number(/Math\.min\(\(now - lastTime\) \/ 1000, ([\d.]+)\)/.exec(MAIN)?.[1]);
if (!Number.isFinite(TOPE)) {
  console.error("✖ no se encontró el tope del delta en nefan-html/src/main.ts: sin él no se sabe cuánto mide un paso");
  process.exit(1);
}

/** La forja del guion 91: lo que el motor spawnea como `building`, 4×4 m. */
const RADIO = 0.4;
const CAJA = {
  id: "forja",
  pos: { x: 0, y: 0, z: 0 },
  sizeXZ: { x: 4, z: 4 },
  category: "building",
  dueno: { de: "runtime" },
};
const MEDIA = CAJA.sizeXZ.x / 2 + RADIO;
const PLAN = { planAplicadoEn: () => true };

/** Andar hacia el centro de la caja desde 6 m, reencarando cada frame — que es
 *  lo que hace el guion 91 y lo que hace quien juega. Devuelve dónde se paró. */
function caminaHacia(anguloGrados, delta) {
  const a = (anguloGrados * Math.PI) / 180;
  let pos = { x: Math.cos(a) * 6, z: Math.sin(a) * 6 };
  for (let i = 0; i < 600; i++) {
    const fx = -pos.x;
    const fz = -pos.z;
    const n = Math.hypot(fx, fz) || 1;
    const desde = pos;
    const { dx, dz } = pasoDelJugador({
      desde,
      forward: { x: fx / n, y: 0, z: fz / n },
      intencion: { adelante: 1, derecha: 0 },
      velocidad: VELOCIDAD,
      delta,
      solido: (x, z) => (process.env.QA_SIN_CAJA ? false : aabbBloquea(desde, { x, z }, RADIO, [CAJA], PLAN)),
    });
    if (dx === 0 && dz === 0) break;
    if (process.env.QA_FIX_SIMULADO && aabbBloquea(desde, { x: pos.x + dx, z: pos.z + dz }, RADIO, [CAJA], PLAN)) break;
    pos = { x: pos.x + dx, z: pos.z + dz };
    if (Math.hypot(pos.x, pos.z) < 0.05) break;
  }
  const sobra = Math.max(Math.abs(pos.x), Math.abs(pos.z)) - MEDIA;
  return { pos, dist: Math.hypot(pos.x, pos.z), sobra, dentro: sobra < 0 };
}

/** Cuántos grados del cuadrante dejan entrar, barridos de 0,05° en 0,05°. */
function ventana(delta) {
  let grados = 0;
  let primero = null;
  let ultimo = null;
  for (let ang = 0; ang < 90; ang += 0.05) {
    if (caminaHacia(ang, delta).dentro) {
      grados += 0.05;
      if (primero === null) primero = ang;
      ultimo = ang;
    }
  }
  return { grados, primero, ultimo };
}

const FPS = [
  [60, 1 / 60, "una máquina con margen"],
  [30, 1 / 30, "media"],
  [20, 0.05, "un portátil flojo"],
  [12, 1 / 12, "el peor caso antes del tope"],
  [6, TOPE, `bajo carga: el delta ya está topado en ${TOPE} s`],
];

console.log(
  `velocidad del jugador ${VELOCIDAD.toFixed(2)} m/s (combat_config.json) · caja ${CAJA.sizeXZ.x}×${CAJA.sizeXZ.z} m ` +
    `+ radio ${RADIO} → pared a ${MEDIA} m del centro\n`,
);

let entraEnAlguno = false;
let controlRoto = [];
for (const [fps, delta, quien] of FPS) {
  const paso = VELOCIDAD * delta;
  const v = ventana(delta);
  // El CONTROL: los rumbos que apuntan a una CARA tienen que frenar. Sin esto,
  // un día en que nada frenase, la tabla de arriba saldría igual de alarmante
  // sin medir nada.
  const cara = [0, 10, 20, 30, 60, 70, 80, 90].map((ang) => caminaHacia(ang, delta));
  const malos = cara.filter((r) => r.dentro).length;
  if (malos) controlRoto.push(`${fps} fps: ${malos} de ${cara.length} rumbos a una cara tampoco frenan`);
  if (v.grados > 0) entraEnAlguno = true;
  const esquina = caminaHacia(45, delta);
  console.log(
    `${String(fps).padStart(2)} fps · paso ${paso.toFixed(3)} m · ventana de ENTRADA ${v.grados.toFixed(2)}° de 90° ` +
      `${v.primero === null ? "" : `[${v.primero.toFixed(2)}°–${v.ultimo.toFixed(2)}°]`}  (${quien})`,
  );
  console.log(
    `        a 45°: parada a ${esquina.dist.toFixed(2)} m del centro · le sobra ${esquina.sobra.toFixed(2)} m al borde` +
      `${esquina.dentro ? "  ← DENTRO" : ""}`,
  );
  console.log(
    `        control (rumbos a una cara): ${cara.length - malos}/${cara.length} frenan en la pared ` +
      `(el más profundo deja ${Math.min(...cara.map((r) => r.sobra)).toFixed(2)} m)`,
  );
}

console.log("");
if (controlRoto.length) {
  console.log("✖ el CONTROL está roto: esto ya no mide la esquina, mide que no frena nada");
  for (const l of controlRoto) console.log(`  · ${l}`);
  process.exit(1);
}
if (!entraEnAlguno) {
  console.log(
    "✖ ya NO se reproduce: por ningún rumbo se entra en la caja.\n" +
      "  Si es porque alguien arregló la colisión, este fichero ha cumplido y se BORRA\n" +
      "  (con su línea de qa/README.md), que es lo que se hace con una reproducción.",
  );
  process.exit(1);
}
console.log(
  "✔ REPRODUCIDO sin navegador y sin carga: hay rumbos por los que el jugador entra en la caja,\n" +
    "  y el control dice que los rumbos a una cara sí frenan. La carga no crea el defecto:\n" +
    "  solo ensancha la ventana, y el tope del delta la deja de ensanchar por debajo de 10 fps.",
);
process.exit(0);
