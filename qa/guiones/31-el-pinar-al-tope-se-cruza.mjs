/** El bosque más cerrado que el motor puede pedir SE CRUZA andando.
 *
 *  El usuario eligió que el techo de la masa forestal lo decidiera el motor
 *  («exponerlo como dial del contrato»), con una condición que no es opinable:
 *  «un bosque en el que no se puede pasar es un bosque roto. La cota superior
 *  tiene que dejar siempre un camino — y eso es verificable, no opinable».
 *
 *  El dial vive en `nefan-core/src/scene/blueprint/vegetation.ts` y su techo
 *  (`MAX_VEG_DENSITY`) se DERIVA del tronco y del cuerpo del jugador, así que
 *  la garantía es «por construcción». Este guion es lo que ninguna derivación
 *  puede dar: la comprobación de que esa construcción sobrevive al
 *  rasterizado, al collider y al jugador andando. La colisión es un GRID —el
 *  borde de un tronco se redondea hacia fuera hasta media celda por lado—, así
 *  que un hueco analítico de 1,00 m puede quedarse en 0,50 m de celdas libres:
 *  eso fue exactamente lo que obligó a bajar el techo de 0,13 a 0,08 durante
 *  la implementación, y por eso se mide donde bloquea, no donde se calcula.
 *
 *  Se juega una PARTIDA de verdad (preset `e2e-sin-creditos`, cero créditos):
 *  el tile de bootstrap del motor falso declara su pinar justo al tope del
 *  dial (`density: 0.08`), que es el caso peor que el contrato admite. El
 *  camino que se ejerce es el completo —motor → bridge → `formatDToWorld` →
 *  cliente—, distinto del de `30-el-bosque-es-uno-solo`, que entra por el
 *  selector Room y normaliza en el propio cliente.
 *
 *  Qué se afirma:
 *   1. la partida trae un pinar declarado AL TOPE (si el bench baja la
 *      densidad, esto se pone rojo y hay que buscar otro caso peor);
 *   2. la separación entre los dos troncos más juntos deja, EN EL GRID que
 *      colisiona, hueco para el cuerpo del jugador;
 *   3. el jugador CRUZA ese hueco andando, que es la pregunta del usuario;
 *   4. y en sesión real —donde normaliza el bridge, no el cliente— ningún
 *      objeto pintado es vegetación y todos los troncos frenan.
 *
 *  EN NEGATIVO (probado el 2026-08-26, los tres sobre el juego real):
 *
 *   · engordando ×2,4 el disco de colisión del tronco en `collision.ts` SIN
 *     tocar la derivación —que es exactamente el fallo que obligó a bajar el
 *     techo de 0,13 a 0,08: el hueco analítico se lo come el rasterizado— el
 *     paso 2 se pone rojo («hueco continuo 0.00 m entre derived_veg_0_8 y
 *     derived_veg_0_22, a 2.69 m») y con él el corredor del paso 3;
 *   · con el disco a radio 0, el paso 4 canta los seis primeros troncos que
 *     dejaron de frenar (`roble_1, roble_2, pino_1, pino_2, derived_veg_0_0…`);
 *   · anulando la marca `volume_id` en `scene-normalize.ts`, la casa del
 *     leñador vuelve a llegar sin volumen que la represente y el paso 4 lo dice.
 *
 *  Lo que NO se ha conseguido poner rojo por separado es el paso 3 (andar):
 *  sondeo y movimiento comparten la MISMA función de colisión —que es la
 *  invariante de la tanda, un solo camino desde el esquema hasta la huella—,
 *  así que solo se pone rojo cuando el 2 ya lo está, más los casos de
 *  aproximación y salida que el sondeo del segmento no ve. Y por debajo no hay
 *  manera de cerrar el bosque: la separación del scatter y el techo del dial
 *  salen de la misma expresión, así que apretar una baja el otro y el zod
 *  rechaza la densidad. Se conserva porque la pregunta del usuario era
 *  «¿se pasa JUGANDO?», no «¿lo dice el sondeo?».
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

/** Necesita mundo y saves vírgenes: la partida se arranca desde cero y el
 *  tile de bootstrap tiene que venir del motor falso, no de una caché. */
export const aisla = ["mundo", "saves"];

/** Techo del dial, `MAX_VEG_DENSITY` de
 *  `nefan-core/src/scene/blueprint/vegetation.ts`. Se escribe aquí a
 *  propósito: si el techo se mueve, este guion se pone rojo y obliga a mirar
 *  si el caso peor sigue siendo el que se está probando. */
const TECHO_DEL_DIAL = 0.08;

/** Espera a que el renderer EMITA frames nuevos: una captura pedida justo
 *  después de mover al jugador fotografía el frame ANTERIOR. */
async function esperarFrames(ctx, n = 3) {
  const antes = (await ctx.nefan("fps")).frames;
  await ctx.waitFor(
    `${n} frames nuevos`,
    ({ f0, n }) => (window.__nefan.fps().frames >= f0 + n ? true : null),
    10_000,
    { f0: antes, n },
  );
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  // ── 1. El caso peor que el contrato admite, declarado por el motor ──────
  const zonas = await ctx.page.evaluate(() => window.__nefan.scene.__format_d?.vegetation_zones ?? []);
  ctx.log(`zonas de vegetación del tile: ${JSON.stringify(zonas)}`);
  ctx.expect(
    "el tile de la partida declara una zona de vegetación AL TOPE del dial",
    zonas.some((z) => z.density === TECHO_DEL_DIAL),
    JSON.stringify(zonas),
  );

  // ── 2. Hueco LIBRE en el grid entre los dos troncos más juntos ──────────
  // No se mide el hueco analítico (centro a centro menos radios): se mide en
  // celdas del collider, sondeando el propio juego. Es donde bloquea.
  const par = await ctx.page.evaluate(() => {
    const s = window.__nefan.scene;
    const arboles = (s.__plan?.volumes ?? []).filter((v) => v.type === "tree");
    const g = s.terrain_grid;
    const [ox, oz] = g.origin;
    const mpc = g.meters_per_cell;
    const mundo = (a) => ({ x: ox + a.at[0] * mpc, z: oz + a.at[1] * mpc });
    let mejor = null;
    for (let i = 0; i < arboles.length; i++) {
      for (let j = i + 1; j < arboles.length; j++) {
        const A = mundo(arboles[i]);
        const B = mundo(arboles[j]);
        const d = Math.hypot(A.x - B.x, A.z - B.z);
        if (!mejor || d < mejor.d) {
          mejor = { d, a: arboles[i].id, b: arboles[j].id, A, B };
        }
      }
    }
    if (!mejor) return null;
    // Barrido de 1 cm a lo largo del segmento que une los dos troncos: cuánto
    // hay LIBRE para el cuerpo del jugador entre las dos huellas sólidas.
    const ux = (mejor.B.x - mejor.A.x) / mejor.d;
    const uz = (mejor.B.z - mejor.A.z) / mejor.d;
    let libre = 0;
    let corrido = 0;
    let mejorCorrido = 0;
    for (let t = 0; t <= mejor.d; t += 0.01) {
      const x = mejor.A.x + ux * t;
      const z = mejor.A.z + uz * t;
      if (window.__nefan.probeCollide(x, z)) {
        corrido = 0;
      } else {
        corrido += 0.01;
        if (corrido > mejorCorrido) mejorCorrido = corrido;
        libre += 0.01;
      }
    }
    return { ...mejor, arboles: arboles.length, huecoContinuo: mejorCorrido, libreTotal: libre };
  });
  ctx.expect("el pinar del tile trae árboles que cruzar", Boolean(par) && par.arboles >= 10, JSON.stringify(par?.arboles));
  if (!par) return;
  ctx.log(
    `${par.arboles} árboles · los dos más juntos (${par.a} ↔ ${par.b}) a ${par.d.toFixed(2)} m · ` +
      `hueco continuo para el CUERPO del jugador entre ellos: ${par.huecoContinuo.toFixed(2)} m`,
  );
  // El sondeo ya lleva el CUERPO puesto: `probeCollide` infla el punto con el
  // radio del jugador (`PLAYER_RADIUS_M`, en `src/scene/terrain-collision.ts`,
  // que es donde vive y de donde nadie debe copiarlo), así que cualquier hueco
  // > 0 es hueco por el que el cuerpo cabe.
  //
  // OJO AL ORDEN, que no es decorativo: `probeCollide` pregunta por un
  // MOVIMIENTO desde donde está el jugador (`blocksMove`), y esa función tiene
  // semántica «salir sí, entrar no» — las celdas que el jugador ya solapa
  // salen como libres. Este sondeo va ANTES de cruzar el hueco a propósito:
  // con el jugador ya metido entre los dos troncos, las suyas dejarían de
  // contar y el hueco saldría más ancho de lo que es.
  ctx.expect(
    "entre los dos troncos más juntos cabe el cuerpo del jugador",
    par.huecoContinuo > 0,
    `hueco continuo ${par.huecoContinuo.toFixed(2)} m entre ${par.a} y ${par.b} (a ${par.d.toFixed(2)} m)`,
  );

  // ── 3. …y se cruza ANDANDO, que es la pregunta del usuario ──────────────
  // Se entra por la perpendicular al segmento que une los dos troncos: 3 m
  // antes del hueco, mirando al hueco, y se anda hasta salir 2,5 m por el otro
  // lado. La aproximación se elige libre de antemano (si el corredor recto
  // estuviera tapado por un tercer árbol, la prueba mediría otra cosa).
  const paso = await ctx.page.evaluate((par) => {
    const mx = (par.A.x + par.B.x) / 2;
    const mz = (par.A.z + par.B.z) / 2;
    const ux = (par.B.x - par.A.x) / par.d;
    const uz = (par.B.z - par.A.z) / par.d;
    // Perpendicular: las dos, se elige la que tenga el corredor libre.
    for (const [px, pz] of [[-uz, ux], [uz, -ux]]) {
      let libre = true;
      for (let t = -3; t <= 2.5; t += 0.1) {
        if (window.__nefan.probeCollide(mx + px * t, mz + pz * t)) { libre = false; break; }
      }
      if (libre) return { mx, mz, px, pz, salidaX: mx + px * -3, salidaZ: mz + pz * -3 };
    }
    return null;
  }, par);
  ctx.expect("hay un corredor recto por el hueco (sin un tercer árbol delante)", Boolean(paso), JSON.stringify(paso));
  if (!paso) return;

  await ctx.nefan("setPlayerPos", paso.salidaX, paso.salidaZ);
  await ctx.nefan("setYaw", Math.atan2(paso.px, paso.pz));
  ctx.expect(
    "el punto de partida, 3 m antes del hueco, está libre",
    (await ctx.nefan("probeCollide", paso.salidaX, paso.salidaZ)) === false,
  );
  await esperarFrames(ctx);
  await ctx.shot("antes-de-cruzar-el-hueco");

  let cruzo = true;
  await ctx
    .holdUntil(
      "up",
      "el jugador cruza el hueco entre los dos troncos más juntos",
      (a) => {
        const p = window.__nefan.state().pos;
        const avance = (p.x - a.x0) * a.px + (p.z - a.z0) * a.pz;
        return avance >= 5.5 ? { avance } : null;
      },
      15_000,
      { x0: paso.salidaX, z0: paso.salidaZ, px: paso.px, pz: paso.pz },
    )
    .catch(() => {
      cruzo = false;
    });
  const fin = (await ctx.nefan("state")).pos;
  const avance = (fin.x - paso.salidaX) * paso.px + (fin.z - paso.salidaZ) * paso.pz;
  ctx.log(`avance por la perpendicular: ${avance.toFixed(2)} m (el hueco está a 3 m)`);
  ctx.expect(
    "el jugador PASA entre los dos troncos más juntos del bosque más cerrado que el motor puede pedir",
    cruzo,
    `avanzó ${avance.toFixed(2)} m de los 5,5 pedidos (el hueco está a 3,0 m del punto de partida)`,
  );
  await esperarFrames(ctx);
  await ctx.shot("despues-de-cruzar-el-hueco");

  // ── 4. En SESIÓN real (normaliza el bridge): nada pintado es vegetación ──
  // El guion 30 mide esto por el selector Room, donde normaliza el CLIENTE.
  // Aquí la world scene viene del bridge por el cable, que es el camino de
  // partida y el que #232 cambió.
  //
  // Aserción PAREADA a propósito: el tile del bench no declara ninguna entity
  // `tree` (sus tres entities son el jugador, el tabernero y una casa), así
  // que «ningún objeto pintado es vegetación» solo puede ponerse rojo si
  // vuelve el ESTAMPADO de la ruta B —que fabricaba una entity por celda con
  // el nombre de la zona, aquí «pino»—, no si se pierde `volume_id`. Esa otra
  // mitad la cubre el guion 30, cuya fixture declara ocho árboles a mano. Lo
  // que sí se afirma aquí sobre `volume_id` es la casa: una entity `building`
  // que el plan pinta como edificio no puede llevar además su cartel.
  const inventario = await ctx.page.evaluate(() => {
    const s = window.__nefan.scene;
    const vols = s.__plan?.volumes ?? [];
    const objetos = s.objects ?? [];
    return {
      objetos: objetos.length,
      pintados: objetos
        .filter((o) => o.volume_id === undefined)
        .map((o) => ({ id: o.id, desc: String(o.name ?? ""), cat: o.category })),
      casa: objetos.find((o) => o.category === "building") ?? null,
      arboles: vols.filter((v) => v.type === "tree").map((v) => ({ id: v.id, at: v.at })),
    };
  });
  const postes = inventario.pintados.filter((o) => /pino|abeto|roble|zarza|matorral|árbol|arbol/i.test(o.desc));
  ctx.expect("la escena de la partida trae objetos que mirar", inventario.objetos > 0, `${inventario.objetos}`);
  ctx.expect(
    "en partida real ningún objeto pintado como entidad es vegetación",
    postes.length === 0,
    JSON.stringify(postes.slice(0, 6)),
  );
  ctx.log(`casa declarada como entity: ${JSON.stringify(inventario.casa)}`);
  ctx.expect(
    "la casa declarada como entity la representa su volumen del plan (no se pinta dos veces)",
    Boolean(inventario.casa) && inventario.casa.volume_id !== undefined,
    JSON.stringify(inventario.casa),
  );
  const blandos = await ctx.page.evaluate((arboles) => {
    const g = window.__nefan.scene.terrain_grid;
    const [ox, oz] = g.origin;
    const mpc = g.meters_per_cell;
    return arboles.filter((a) => !window.__nefan.probeCollide(ox + a.at[0] * mpc, oz + a.at[1] * mpc)).map((a) => a.id);
  }, inventario.arboles);
  ctx.expect(
    "en partida real todos los troncos del plan frenan",
    blandos.length === 0,
    JSON.stringify(blandos.slice(0, 6)),
  );
}
