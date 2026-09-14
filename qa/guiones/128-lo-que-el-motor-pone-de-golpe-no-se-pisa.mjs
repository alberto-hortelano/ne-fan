/** CUATRO COSAS EN EL MISMO TURNO Y NINGUNA SE PISA CON OTRA (#524).
 *
 *  EL PROBLEMA, medido por el crítico y no deducido: el bridge separaba lo que
 *  el motor manda en un mismo turno **1,8 m fijos**, sin mirar el TAMAÑO de lo
 *  que separaba. Con las cajas sólidas (#489) eso daba, con el radio de jugador
 *  de 0,4 m:
 *
 *   · dos `object` (1,5 m de lado) → **0,3 m** entre caras: un pasillo que
 *     existe y no se puede cruzar;
 *   · dos `building` (4 m) → **se solapan**: dos cajas sólidas en el mismo
 *     suelo (0,4 m las de los dos lados, 2,2 m las vecinas);
 *   · un `npc` del mismo turno → **DENTRO** de la caja del edificio.
 *
 *  Y el error crece con lo que el motor declare: un carro de `[6,6]` mide 3 m
 *  y un granero de `[20,14]`, diez.
 *
 *  LO QUE ESTE GUION NO USA, porque el propio issue lo dice y no se sostiene:
 *  «el jugador queda encajonado». No queda — `aabbBloquea` tiene «salir sí,
 *  entrar no», así que a quien aparezca dentro de una caja no se le atrapa. Lo
 *  demostrable es el SOLAPE, y es lo que se mide.
 *
 *  CÓMO SE MIDE, y por qué en este orden:
 *   1. **la geometría, sobre todos los pares** — con las posiciones y los
 *      `sizeXZ` que llegan al cliente, el hueco entre las caras de dos cosas
 *      cualesquiera del turno es al menos el cuerpo del jugador. Es
 *      determinista: no depende de dónde caiga el turno respecto al plan del
 *      tile. Y se dice, al lado, lo que habría dado el reparto viejo sobre
 *      ESTAS MISMAS cuatro cosas, que es la cifra del issue.
 *   2. **el suelo, con sondas** — el punto medio entre dos vecinos sigue libre
 *      después del spawn. La foto del suelo de ANTES (la técnica del 118) es
 *      lo que separa «aquí no se pasa por las cajas nuevas» de «aquí ya había
 *      un muro de la taberna».
 *   3. **la travesía** — que ese pasillo se CRUZA: sondeando a lo largo de la
 *      perpendicular, punto a punto, todo lo que no estuviera ya sólido antes
 *      del turno sigue libre. Se sondea y no se anda a propósito: el jugador
 *      está pegado al tabernero y el turno cae al otro lado de la taberna, así
 *      que un paseo hasta allí mediría ese muro y no el reparto (medido: el
 *      guion salía ⊘ por su propio guardia). Que el MOTOR DE MOVIMIENTO
 *      respete las cajas de un spawn ya lo andan el 91 y el 118; lo que aquí
 *      no mide nadie más es la geometría del reparto.
 *
 *  UN SOLO ELEMENTO NO DISTINGUE UNA REGLA DE SU CONTRARIA (el reparto viejo y
 *  el nuevo dan lo mismo para el primero), así que el motor falso pone CUATRO
 *  de tamaños distintos y con el edificio de por medio.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, `renderMode: vector`.
 *  Los cuatro los pone la marca del texto libre; `aisla` deja saves y motor
 *  vírgenes.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { comenzar, nuevaPartida } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
/** La marca que pide el turno entero (`labs/narrative/fake-ai-server.ts`). */
const MARCA_MANDO = "LO QUE DECLARA EL MOTOR";
const MARCA_TURNO = "LO QUE DECLARA EL MOTOR: TURNO";
/** Lo que pone esa marca, tal cual viaja por el wire. */
const TURNO = [
  { nombre: "Forja del camino", kind: "building", footprint: null },
  { nombre: "Carro de heno", kind: "object", footprint: [6, 6] },
  { nombre: "Nogala", kind: "npc", footprint: null },
  { nombre: "Bolsa de monedas", kind: "item", footprint: [2, 2] },
];
/** Radio del cuerpo del jugador (`PLAYER_RADIUS_M`, core). Escrito a mano: es
 *  el oráculo, y un oráculo leído del código bajo prueba no se pone rojo. */
const RADIO = 0.4;
/** El ancho del jugador, que es lo que tiene que caber entre dos caras. */
const CUERPO_M = 2 * RADIO;
/** La separación fija que había antes de #524, para poder decir la cifra. */
const SEPARACION_VIEJA_M = 1.8;
/** Rejilla de la foto del suelo (misma técnica y mismos números que el 118). */
const PASO_DE_LA_REJILLA_M = 0.25;
const FOTO_X_M = 12;
const FOTO_Z_M = 12;
/** A qué distancia deja el bridge lo que el motor pone con `near_player`. */
const HUECO_DEL_SPAWN_M = 5;

const posicion = (ctx) => ctx.page.evaluate(() => ({ ...window.__nefan.state().pos }));
const vidaDelHud = (ctx) =>
  ctx.page.evaluate(() => Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"));

/** El panel de diálogo TERMINADO de pintar: con el typewriter corriendo, la `T`
 *  solo completa el texto y no abre la caja (`dialogue-panel.ts`). */
const panelPintado = (ctx) =>
  ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      const texto = document.getElementById("dialogue-text")?.textContent ?? "";
      return d.visible && d.text && texto === d.text && botones > 0 ? { botones } : null;
    },
    60_000,
  );

/** Media anchura de cada cosa, EN METROS, SIN preguntarle a core: la aritmética
 *  del contrato escrita aquí (celdas × 0,5, o el radio del cuerpo para un
 *  personaje) para que el oráculo de este guion no sea el código que mide. */
function mediaAnchura(e) {
  if (e.kind === "npc") return 0.5; // RADIO_SIMULADO_POR_KIND.npc
  const celdas = e.footprint ?? { building: [8, 8], object: [3, 3], item: [1, 1] }[e.kind];
  return (Math.max(celdas[0], celdas[1]) * 0.5) / 2;
}

/** Levanta al jugador si el hostil de la escena inicial lo mató: un cadáver no
 *  anda, y las capturas con «YOU DIED» no enseñan lo que dicen enseñar. */
async function revivirSiHaceFalta(ctx) {
  if ((await vidaDelHud(ctx)) > 0) return;
  const vivo = await ctx.absorbe(
    "cortafuegos del respawn: si no revive, el aserto de andar de abajo lo dirá en rojo",
    () =>
      ctx.waitFor(
        "el jugador vuelve a la vida tras pulsar R",
        () => {
          const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "0");
          if (hp > 0) return { hp };
          window.__nefan.inputDriver.queueRespawn();
          return null;
        },
        15_000,
      ),
  );
  ctx.log(vivo ? `el bench mató al jugador: reaparecido con ${vivo.hp} de vida` : "la R no lo levantó");
}

/** El suelo ANTES de que el motor ponga nada (la técnica del 118: `probeCollide`
 *  no es un mapa del suelo sino «¿puedo moverme de donde estoy a ahí?», así que
 *  lo que se compara es el DELTA). */
async function fotoDelSuelo(ctx) {
  const origen = await posicion(ctx);
  const celdas = await ctx.page.evaluate(
    ({ o, paso, ax, az }) => {
      const pc = window.__nefan.probeCollide;
      const filas = [];
      for (let z = 0; z >= -az; z -= paso) {
        const fila = [];
        for (let x = -ax; x <= ax; x += paso) fila.push(pc(o.x + x, o.z + z) ? 1 : 0);
        filas.push(fila);
      }
      return filas;
    },
    { o: origen, paso: PASO_DE_LA_REJILLA_M, ax: FOTO_X_M, az: FOTO_Z_M },
  );
  return { origen, celdas };
}

function eraLibre(foto, x, z) {
  const col = Math.round((x - foto.origen.x + FOTO_X_M) / PASO_DE_LA_REJILLA_M);
  const fila = Math.round((foto.origen.z - z) / PASO_DE_LA_REJILLA_M);
  if (!Number.isFinite(col) || !Number.isFinite(fila)) return null;
  const f = foto.celdas[fila];
  if (!f || col < 0 || col >= f.length) return null;
  return f[col] === 0;
}

function caminoLibreAntes(foto, a, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / PASO_DE_LA_REJILLA_M));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (eraLibre(foto, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) !== true) return false;
  }
  return true;
}

const sondear = (ctx, p) =>
  ctx.page.evaluate((q) => window.__nefan.probeCollide(q.x, q.z), p);

/** Habla con el tabernero y pide el turno con la marca. Antes toma el mando del
 *  motor falso (la marca a secas), que si no sus spawns por turno caen encima
 *  de lo que este guion mide — ver `motorConducidoPorMarcas` en el fake. */
async function pedirElTurno(ctx) {
  await acercarse(ctx, TABERNERO, { objetivo: 2.0, lista: "npcs", tramos: 24 });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible || null, 60_000);
  await panelPintado(ctx);
  for (const marca of [MARCA_MANDO, MARCA_TURNO]) {
    const antes = await ctx.page.evaluate(() => window.__nefan.dialogue().text);
    await ctx.page.keyboard.press("t");
    await ctx.waitFor(
      `T abre la caja de texto libre (${marca === MARCA_TURNO ? "el turno" : "tomar el mando"})`,
      () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
      5_000,
    );
    await ctx.page.keyboard.type(marca);
    await ctx.page.keyboard.press("Enter");
    await ctx.waitFor(
      "el motor contesta",
      (t) => {
        const d = window.__nefan.dialogue();
        return d.visible && d.text && d.text !== t ? { t: d.text } : null;
      },
      60_000,
      antes,
    );
    await panelPintado(ctx);
  }
  const puestos = await ctx.waitFor(
    "el motor pone las CUATRO cosas del turno",
    (nombres) => {
      const o = window.__nefan.objects();
      const n = window.__nefan.npcs();
      const todos = nombres.map((nom) => o.find((x) => x.label === nom) ?? n.find((x) => x.label === nom) ?? null);
      return todos.every(Boolean)
        ? todos.map((e) => ({ id: e.id, label: e.label, pos: { ...e.pos }, sizeXZ: e.sizeXZ ? { ...e.sizeXZ } : null }))
        : null;
    },
    90_000,
    TURNO.map((e) => e.nombre),
  );
  await ctx.nefan("advanceDialogue");
  await ctx.expectEspera("la conversación se cierra", true, () => (window.__nefan.dialogueVisible ? null : true), { ms: 15_000 });
  return puestos;
}

export default async function (ctx) {
  // ── 0 · Partida y el turno entero, pedido desde donde quepa ──────────────
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  await comenzar(ctx);
  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  const antes = await fotoDelSuelo(ctx);
  const puestos = await pedirElTurno(ctx);
  ctx.log(`el motor puso: ${JSON.stringify(puestos.map((p) => ({ l: p.label, pos: p.pos, s: p.sizeXZ })))}`);

  // ── 1 · LA GEOMETRÍA, sobre todos los pares ──────────────────────────────
  // Determinista y sin depender del plan del tile: son las posiciones y los
  // tamaños que llegaron al cliente.
  let peor = { hueco: Infinity, quienes: "" };
  for (let i = 0; i < puestos.length; i++) {
    for (let j = i + 1; j < puestos.length; j++) {
      const a = puestos[i];
      const b = puestos[j];
      const centros = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      const hueco = centros - mediaAnchura(TURNO[i]) - mediaAnchura(TURNO[j]);
      if (hueco < peor.hueco) peor = { hueco, quienes: `«${a.label}» y «${b.label}»` };
      ctx.expect(
        `entre «${a.label}» y «${b.label}» cabe el jugador: ${hueco.toFixed(2)} m de hueco (hace falta ${CUERPO_M})`,
        hueco >= CUERPO_M,
        `centros a ${centros.toFixed(2)} m · medias anchuras ${mediaAnchura(TURNO[i])} y ${mediaAnchura(TURNO[j])}`,
      );
    }
  }
  // Y la cifra del issue, sobre ESTAS mismas cuatro cosas: qué habría dado el
  // reparto fijo. No es un aserto —el código viejo ya no existe— sino el dato
  // que dice cuánto valía el cambio.
  const conElViejo = TURNO.map((e, i) => {
    const paso = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
    return paso * SEPARACION_VIEJA_M;
  });
  const solapesViejos = [];
  for (let i = 0; i < TURNO.length; i++) {
    for (let j = i + 1; j < TURNO.length; j++) {
      const hueco = Math.abs(conElViejo[i] - conElViejo[j]) - mediaAnchura(TURNO[i]) - mediaAnchura(TURNO[j]);
      if (hueco < CUERPO_M) {
        solapesViejos.push(`${TURNO[i].nombre}/${TURNO[j].nombre}: ${hueco.toFixed(2)} m`);
      }
    }
  }
  ctx.log(
    `con la separación fija de ${SEPARACION_VIEJA_M} m, ${solapesViejos.length} de los 6 pares no dejaban ` +
      `pasar al jugador: ${solapesViejos.join(" · ")}`,
  );
  ctx.log(`el par más justo de ahora: ${peor.quienes}, con ${peor.hueco.toFixed(2)} m`);

  // ── 2 · EL SUELO: el pasillo entre dos vecinos sigue libre ───────────────
  const pares = [];
  for (let i = 0; i < puestos.length; i++) {
    for (let j = i + 1; j < puestos.length; j++) {
      pares.push({ a: puestos[i], b: puestos[j], i, j, d: Math.hypot(puestos[i].pos.x - puestos[j].pos.x, puestos[i].pos.z - puestos[j].pos.z) });
    }
  }
  pares.sort((p, q) => p.d - q.d);
  const vecinos = pares[0];
  // EL MEDIO DEL HUECO, no el de los centros. Con cajas de tamaños distintos no
  // son el mismo punto ni de lejos: entre un carro de 3 m y una bolsa de 1, el
  // punto medio de los centros cae justo en la CARA del carro —y ahí bloquea,
  // porque `aabbBloquea` infla cada caja por el radio del jugador—. La primera
  // versión de este guion sondeaba ese punto y salía roja midiendo el sitio
  // equivocado.
  const mitadA = mediaAnchura(TURNO[vecinos.i]);
  const huecoDelPar = vecinos.d - mitadA - mediaAnchura(TURNO[vecinos.j]);
  const t = (mitadA + huecoDelPar / 2) / vecinos.d;
  const medio = {
    x: vecinos.a.pos.x + (vecinos.b.pos.x - vecinos.a.pos.x) * t,
    z: vecinos.a.pos.z + (vecinos.b.pos.z - vecinos.a.pos.z) * t,
  };
  const eraLibreElMedio = eraLibre(antes, medio.x, medio.z);
  ctx.log(
    `el pasillo más justo es el de «${vecinos.a.label}» y «${vecinos.b.label}» (${huecoDelPar.toFixed(2)} m ` +
      `entre caras); su punto medio ` +
      `(${medio.x.toFixed(2)}, ${medio.z.toFixed(2)}) estaba ${eraLibreElMedio === null ? "fuera de la foto" : eraLibreElMedio ? "libre" : "SÓLIDO"} antes del turno`,
  );
  if (eraLibreElMedio !== true) {
    ctx.sinMedirBloque(
      "el punto medio entre los dos vecinos ya era sólido antes del turno (el plan del tile): lo que " +
        "bloquee ahí no son las cajas nuevas, y medirlo diría que el reparto falla cuando falla el sitio",
    );
  } else {
    ctx.expect(
      "el pasillo entre los dos más juntos SIGUE libre con las cuatro cajas puestas",
      (await sondear(ctx, medio)) === false,
      `punto medio (${medio.x.toFixed(2)}, ${medio.z.toFixed(2)})`,
    );

    // ── 3 · LA TRAVESÍA: el pasillo no es un punto, es un paso ─────────────
    // Perpendicular a la línea que une los dos centros y de 1,5 m a cada lado:
    // si todo lo que estaba libre antes del turno sigue libre, el jugador
    // puede cruzar por ahí. Lo que ya era sólido antes no se le cuenta a las
    // cajas nuevas — es el muro de la taberna, y se dice cuántos puntos son.
    const dir = { x: (vecinos.b.pos.x - vecinos.a.pos.x) / vecinos.d, z: (vecinos.b.pos.z - vecinos.a.pos.z) / vecinos.d };
    const perp = { x: -dir.z, z: dir.x };
    const puntos = [];
    for (let d = -1.5; d <= 1.5001; d += 0.25) {
      puntos.push({ x: medio.x + perp.x * d, z: medio.z + perp.z * d, d });
    }
    // Los dos nombres dicen lo que valen, y no es lo mismo: `libreAntes` viene
    // de la foto (true = se podía pasar) y `bloqueaAhora` de `probeCollide`
    // (true = NO se puede). Colapsarlos en un «antes/ahora» ya costó una
    // corrida en rojo con los trece puntos libres.
    const travesia = [];
    for (const q of puntos) {
      travesia.push({ d: q.d, libreAntes: eraLibre(antes, q.x, q.z), bloqueaAhora: await sondear(ctx, q) });
    }
    const rotosPorLasCajas = travesia.filter((q) => q.libreAntes === true && q.bloqueaAhora === true);
    const yaEstabanRotos = travesia.filter((q) => q.libreAntes !== true);
    ctx.log(
      `travesía del pasillo (${travesia.length} puntos a lo largo de 3 m): ${yaEstabanRotos.length} ya eran ` +
        `sólidos antes del turno · ${rotosPorLasCajas.length} los cierran las cajas nuevas`,
    );
    ctx.expect(
      "el pasillo se CRUZA: ninguna de las cajas del turno cierra un punto que antes estaba libre",
      rotosPorLasCajas.length === 0,
      JSON.stringify(travesia.map((q) => ({ d: q.d.toFixed(2), libreAntes: q.libreAntes, bloqueaAhora: q.bloqueaAhora }))),
    );
    await revivirSiHaceFalta(ctx);
    await ctx.shot("las-cuatro-cosas-del-turno");
  }
}