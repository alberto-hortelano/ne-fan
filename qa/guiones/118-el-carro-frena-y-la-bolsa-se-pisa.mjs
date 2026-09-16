/** LO QUE EL MOTOR DECLARA decide el tamaño y la solidez de lo que pone (#532),
 *  medido en el MISMO SITIO: en el punto donde el jugador andaba libre, una
 *  bolsa de monedas sigue dejándole pasar y un carro le para en seco.
 *
 *  EL PROBLEMA QUE CIERRA, en una frase: hasta esta tanda el motor solo podía
 *  decir QUÉ pone, así que todo `object` salía con la misma caja de 1,5 m y una
 *  «bolsa de monedas» era un muro que no se podía atravesar. Ahora declara
 *  `entity_kind: "item"` —la clase que NO frena— y `footprint` en celdas, que
 *  solo afina el tamaño.
 *
 *  QUÉ MIDE ESTE Y NO LOS DEMÁS. El 91 mide la caja de un spawn que NO declara
 *  nada: los DEFECTOS por clase (building 8×8 celdas, object 3×3), y que la
 *  pared está donde core la pone. Aquí se mide lo contrario: que lo DECLARADO
 *  gana al defecto (el carro de [6,6] mide 3 m y no 1,5) y que hay una clase
 *  que se pisa. Ninguno vale por el otro — con el 91 solo, un `footprint`
 *  ignorado en cualquiera de los sitios por los que pasa saldría VERDE, porque
 *  el defecto sigue siendo el defecto.
 *
 *  SE MIDE EL DELTA DEL SUELO, no «¿bloquea?», y el motivo está MEDIDO: el
 *  bench deja al jugador pegado a la taberna y el bridge deja lo que el motor
 *  pone 5 m al NORTE de él —su `playerForward` es fijo en
 *  `bridge/handlers/dialogue.ts`, mire el jugador donde mire—, así que los
 *  spawns caen entre los muros del plan del tile. Preguntando «¿bloquea el
 *  centro de la bolsa?», el muro de la taberna y la caja de un `item` se ven
 *  EXACTAMENTE IGUAL: en la primera corrida de este guion la bolsa salió
 *  «sólida» sin que ningún objeto la tapara. Así que antes de cada petición se
 *  fotografía el suelo (`fotoDelSuelo`, rejilla de 25 cm) y cada afirmación se
 *  hace sobre lo que CAMBIÓ. Lo que caiga sobre un muro que ya estaba se
 *  declara SIN MEDIR, que es lo honesto.
 *
 *  Y SE PIDEN POR SEPARADO, una entidad por marca, porque el reparto de un
 *  turno separa 1,8 m fijos sin mirar el tamaño (#524, la PR 3 de esta tanda) y
 *  la caja del carro de 3 m se come esa separación entera: puestos a la vez, el
 *  jugador no podría llegar a pisar la bolsa y el guion estaría midiendo el
 *  defecto de #524 creyendo medir el de #532. Pedidos uno detrás de otro sin
 *  moverse, los dos caen en el MISMO punto, que es la comparación más limpia
 *  que hay: misma coordenada, mismo suelo, y la única variable es lo que el
 *  motor declaró.
 *
 *  Dos formas de preguntar, y las dos hacen falta:
 *   · **con sondas** (`probeCollide`, la misma función que gobierna el paso del
 *     jugador), que es determinista y no depende de que se pueda llegar: el
 *     punto sigue libre con la bolsa encima, y con el carro bloquea hasta donde
 *     dice su huella declarada (media huella + radio).
 *   · **andando**, que es como se juega: el jugador se planta ENCIMA de la
 *     bolsa, y luego empuja contra el carro y se para PEGADO a su cara.
 *
 *  LO QUE NO AFIRMA, y se dice: nada del RESUME. Que el carro vuelva midiendo
 *  3 m y que un `item` vuelva siquiera es la PR 2 de esta tanda (`item` no está
 *  en `CLASES_QUE_VUELVEN` y la huella se re-deriva del `type` ignorando lo
 *  declarado): medirlo aquí sería pedirle a esta PR algo que no trae.
 *
 *  Cero créditos: preset `e2e-sin-creditos`. Los spawns los pone el motor falso
 *  cuando el jugador le escribe la MARCA en el texto libre — marca y no número
 *  de turno, porque los turnos son un recurso compartido entre guiones.
 *  `aisla` deja saves y motor falso vírgenes.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { comenzar, nuevaPartida } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
/** Las marcas que disparan cada spawn en `labs/narrative/fake-ai-server.ts`. */
const MARCA_MANDO = "LO QUE DECLARA EL MOTOR";
const MARCA_BOLSA = "LO QUE DECLARA EL MOTOR: BOLSA";
const MARCA_CARRO = "LO QUE DECLARA EL MOTOR: CARRO";
/** Lo que el motor falso declara con ellas, tal cual viaja por el wire. */
const CARRO = { nombre: "Carro de heno", kind: "object", footprint: [6, 6] };
const BOLSA = { nombre: "Bolsa de monedas", kind: "item", footprint: [2, 2] };
/** Radio del cuerpo del jugador (`PLAYER_RADIUS_M`, core). */
const RADIO = 0.4;
/** Metros por celda del tile (`TILE_MPC`). Escrito A MANO y no importado de
 *  core, igual que `RADIO`: es el ORÁCULO de este guion, y un oráculo que se
 *  lee del código bajo prueba no puede ponerse rojo cuando ese código cambia
 *  (QA de la PR 1, H-3). Si el tile cambiara de escala, esto sale rojo — y ese
 *  rojo es correcto: querría decir que hay que volver a mirar la medida. */
const METROS_POR_CELDA = 0.5;
/** Cuánto puede meterse el jugador en una caja al pararse: nada, salvo el error
 *  de leer la posición entre frames. Por debajo de −0,02 está DENTRO. */
const DENTRO_M = -0.02;
/** Tolerancia de la pared MEDIDA por sondas: el paso del barrido (5 cm) y un pelo. */
const PASO_DEL_BARRIDO_M = 0.06;
/** Lado de la rejilla con la que se fotografía el suelo antes de cada spawn. */
const PASO_DE_LA_REJILLA_M = 0.25;
/** Media anchura (x) y fondo (−z) de esa foto, en metros: cubre de sobra los
 *  5 m a los que el bridge deja lo que el motor pone. */
const FOTO_X_M = 8;
const FOTO_Z_M = 12;
/** A qué distancia deja el bridge lo que el motor pone con `near_player`: 5 m
 *  hacia el NORTE (posición + forward × 5, con el forward fijo a (0,0,−1) en
 *  `bridge/handlers/dialogue.ts`). El guion lo usa SOLO para elegir desde dónde
 *  hablar; lo que mide después es dónde cayó de verdad. */
const HUECO_DEL_SPAWN_M = 5;

/** El tamaño que declara core para un spawn, del `footprint` en CELDAS que
 *  mandó el motor. Los dos argumentos son el contrato desde #532: con uno solo
 *  esto mediría el defecto de la clase y daría por bueno un carro pintado de
 *  1,5 m. `⊘` con su motivo si no hay `dist` con que comparar. */
async function huellaDeCore() {
  try {
    const { huellaEnMetros } = await import(
      path.join(RAIZ, "nefan-core", "dist", "src", "scene", "scene-normalize.js")
    );
    return (kind, footprintCeldas = null) => huellaEnMetros(kind, footprintCeldas);
  } catch (err) {
    return { error: String(err) };
  }
}

const posicion = (ctx) => ctx.page.evaluate(() => ({ ...window.__nefan.state().pos }));
const vidaDelHud = (ctx) =>
  ctx.page.evaluate(() => Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"));

/** Levanta al jugador si el hostil de la escena inicial lo ha matado, y lo dice.
 *
 *  No es un apaño: es lo que hace quien juega cuando le matan, y el 91 lo hace
 *  por lo mismo. Aquí entra por las CAPTURAS (QA de la PR 1, H-10: las dos del
 *  118 enseñaban «YOU DIED» y un bosque, con la bolsa y el carro fuera de
 *  cuadro), y de paso por el paseo: un cadáver no anda, y ese rojo diría otra
 *  cosa de la que este guion mide. La R es one-shot y el bucle solo la aplica
 *  con el jugador ya muerto PARA EL SIM, así que se repulsa en cada muestra. */
async function revivirSiHaceFalta(ctx) {
  if ((await vidaDelHud(ctx)) > 0) return false;
  const vivo = await ctx.absorbe(
    "cortafuegos del respawn: si no revive, los asertos de andar de abajo lo dirán en rojo — un cadáver no anda",
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
  ctx.log(
    vivo
      ? `el bench mató al jugador: reaparecido (R) con ${vivo.hp} de vida para seguir midiendo`
      : "el bench mató al jugador y la R no lo levantó: los asertos de andar lo dirán en rojo",
  );
  return true;
}

/** El panel de diálogo TERMINADO de pintar: con el typewriter corriendo, la
 *  primera `T` solo completa el texto (`dialogue-panel.ts`) y no abre la caja
 *  — medido con un timeout la primera vez que se escribió este guion. */
const panelPintado = (ctx) =>
  ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      const texto = document.getElementById("dialogue-text")?.textContent ?? "";
      return d.visible && botones > 0 && texto === d.text ? { botones } : null;
    },
    60_000,
  );

/** El suelo ANTES de que el motor ponga nada, punto a punto (ver la cabecera). */
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

/** ¿Estaba libre ese punto ANTES? `null` = cae fuera de la foto, que no es lo
 *  mismo que «sí» y por eso no se colapsa con él. */
function eraLibre(foto, x, z) {
  const col = Math.round((x - foto.origen.x + FOTO_X_M) / PASO_DE_LA_REJILLA_M);
  const fila = Math.round((foto.origen.z - z) / PASO_DE_LA_REJILLA_M);
  if (!Number.isFinite(col) || !Number.isFinite(fila)) return null;
  const f = foto.celdas[fila];
  if (!f || col < 0 || col >= f.length) return null;
  return f[col] === 0;
}

/** ¿Estaba libre ANTES todo el camino recto de `a` a `b`? Lo que contesta es si
 *  el paseo que viene mide la caja del spawn o el muro de la taberna. */
function caminoLibreAntes(foto, a, b) {
  // `n` nunca 0: con el destino bajo los pies, `i / n` sería NaN y la consulta
  // caería fuera de la rejilla (lo cazó una corrida entera de este guion).
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / PASO_DE_LA_REJILLA_M));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (eraLibre(foto, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) !== true) return false;
  }
  return true;
}

/** ¿Bloquea AHORA ese punto, y qué hay encima? */
const sondear = (ctx, punto) =>
  ctx.page.evaluate((p) => ({ bloquea: window.__nefan.probeCollide(p.x, p.z) }), punto);

/** Dónde acaba la caja de `obj`: desde su centro hacia los cuatro ejes, a qué
 *  distancia deja de bloquear. */
async function paredMedida(ctx, obj) {
  return ctx.page.evaluate((e) => {
    const pc = window.__nefan.probeCollide;
    const paso = 0.05;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => {
      let d = 0;
      for (; d <= 8; d = Number((d + paso).toFixed(2))) {
        if (!pc(e.pos.x + dx * d, e.pos.z + dz * d)) break;
      }
      return d;
    });
  }, obj);
}

/** Camina en línea recta hacia `destino` hasta que el jugador DEJA DE
 *  ACERCARSE, y devuelve dónde se quedó. Como quien juega: yaw + tecla, nunca
 *  `setPlayerPos`.
 *
 *  La parada es «la DISTANCIA al destino no baja», y no «el jugador no se
 *  mueve», que es lo que se escribió primero y medía otra cosa: al chocar con
 *  una caja el motor de movimiento DESLIZA por su cara, así que el jugador
 *  seguía andando de lado hasta el borde del tile y la parada acababa a 25 m
 *  del carro, con «no entra en su caja» en verde sin haber tocado nada
 *  (medido el 2026-09-14 en la primera corrida de este guion).
 *
 *  Es ESTADO y no reloj: el predicado corre en la página, se acuerda de la
 *  última distancia en `window.__qa118` y se cumple cuando lleva tres muestras
 *  sin acercarse 2 cm. El cortafuegos se ABSORBE y la parada se lee después. */
async function empujarContra(ctx, destino) {
  await ctx.page.evaluate(() => { window.__qa118 = null; });
  const p = await posicion(ctx);
  await ctx.nefan("setYaw", Math.atan2(destino.x - p.x, destino.z - p.z));
  await ctx.absorbe(
    "cortafuegos del empujón: la parada se AFIRMA justo debajo con la posición leída al soltar",
    () =>
      ctx.holdUntil(
        "up",
        "el jugador deja de acercarse (tres muestras seguidas sin ganar 2 cm)",
        (d) => {
          const p2 = window.__nefan.state().pos;
          const dist = Math.hypot(p2.x - d.x, p2.z - d.z);
          const antes = window.__qa118;
          const gana = antes ? antes.dist - dist > 0.02 : true;
          const veces = gana ? 0 : (antes?.veces ?? 0) + 1;
          const arranco = (antes?.arranco ?? false) || gana === true;
          window.__qa118 = { dist, veces, arranco };
          return veces >= 3 ? { x: p2.x, z: p2.z, arranco, dist } : null;
        },
        { sim: 20 },
        destino,
      ),
  );
  return ctx.page.evaluate(() => {
    const p2 = window.__nefan.state().pos;
    return { x: p2.x, z: p2.z, arranco: window.__qa118?.arranco ?? false };
  });
}

/** Metros que le SOBRAN al jugador hasta la caja inflada de `obj` (negativo =
 *  está dentro). */
function sobraDelBorde(p, obj) {
  return Math.max(
    Math.abs(p.x - obj.pos.x) - (obj.sizeXZ.x / 2 + RADIO),
    Math.abs(p.z - obj.pos.z) - (obj.sizeXZ.z / 2 + RADIO),
  );
}

/** A cuánto llega la `E` del jugador (`interact_range_m`, combat_config). Se
 *  deja margen: aquí solo se usa para no alejarse tanto del tabernero que deje
 *  de poder hablarle. */
const ALCANCE_DE_LA_E_M = 2.3;
/** Cuánto se deja el jugador buscar un sitio desde el que lo que pida el motor
 *  no caiga dentro de la taberna. */
const RADIOS_DE_BUSQUEDA_M = [0, 1, 2, 3];

/** DÓNDE TIENE QUE PONERSE EL JUGADOR para que lo que pida el motor caiga en
 *  suelo y no dentro de un muro.
 *
 *  Lo que el bridge hace con `near_player` es dejar el spawn 5 m al NORTE del
 *  jugador (su `playerForward` es fijo), y el tabernero del bench vive pegado a
 *  la taberna: desde donde se le habla de frente, esos 5 m caen DENTRO del
 *  edificio y no hay nada que medir. Así que el jugador se busca el sitio con
 *  la foto del suelo —el hueco existe, es el corredor de al lado— sin dejar de
 *  estar a tiro de su `E`. Devuelve el punto o `null` si no hay ninguno, que es
 *  un motivo para declarar y no para un rojo. */
function sitioDesdeElQueCabe(foto, jugador, npc, huecoM, radioMax = Infinity) {
  const candidatos = [];
  for (const r of RADIOS_DE_BUSQUEDA_M.filter((r) => r <= radioMax)) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      candidatos.push({ x: jugador.x + Math.cos(a) * r, z: jugador.z + Math.sin(a) * r });
    }
  }
  for (const c of candidatos) {
    if (Math.hypot(c.x - npc.pos.x, c.z - npc.pos.z) > ALCANCE_DE_LA_E_M) continue;
    // El sitio en sí, el punto donde caerá lo que pida, y el camino hasta él.
    if (eraLibre(foto, c.x, c.z) !== true) continue;
    if (eraLibre(foto, c.x, c.z - huecoM) !== true) continue;
    if (!caminoLibreAntes(foto, jugador, c)) continue;
    // Y un pelo alrededor del punto del spawn, para que quepa su caja y el
    // cuerpo del jugador al llegar.
    // Ancho: el jugador llega andando con 35 cm de tolerancia y el spawn cae
    // 5 m al norte de donde ACABE, no de donde se apuntó.
    const margen = [-1.5, -1, -0.5, 0.5, 1, 1.5];
    if (margen.some((d) => eraLibre(foto, c.x + d, c.z - huecoM) !== true)) continue;
    return c;
  }
  return null;
}

/** Anda hasta `destino` (como quien juega) y se para al llegar. */
async function irA(ctx, destino, etiqueta) {
  const p = await posicion(ctx);
  if (Math.hypot(destino.x - p.x, destino.z - p.z) < 0.2) return;
  await ctx.nefan("setYaw", Math.atan2(destino.x - p.x, destino.z - p.z));
  await ctx.absorbe(
    `cortafuegos del paseo hasta ${etiqueta}: lo que se AFIRMA después es que el motor puso su spawn en suelo`,
    () =>
      ctx.holdUntil(
        "up",
        `el jugador llega a ${etiqueta}`,
        (d) => {
          const p2 = window.__nefan.state().pos;
          return Math.hypot(p2.x - d.x, p2.z - d.z) < 0.35 ? { ok: true } : null;
        },
        { sim: 15 },
        destino,
      ),
  );
}

/** Habla con el tabernero DESDE DONDE ESTÁ el jugador y deja el panel pintado
 *  y listo para la `T`. No se acerca: quien llama acaba de elegir el sitio y
 *  moverse otra vez lo perdería (lo cazó una corrida de este guion, con el
 *  carro cayendo dentro de la taberna después de haber elegido un hueco). */
async function abrirLaConversacion(ctx) {
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible || null, 60_000);
  await panelPintado(ctx);
}

/** Le escribe al motor la marca que pide UNA entidad, con el panel ya abierto,
 *  y espera a que aparezca en el mundo. */
async function pedirAlMotor(ctx, marca, etiqueta) {
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    `T abre la caja de texto libre (${etiqueta})`,
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  await ctx.page.keyboard.type(marca);
  await ctx.page.keyboard.press("Enter");
  const puesto = await ctx.waitFor(
    `el motor pone «${etiqueta}»`,
    (n) => window.__nefan.objects().find((x) => x.label === n) ?? null,
    90_000,
    etiqueta,
  );
  await ctx.nefan("advanceDialogue");
  await ctx.expectEspera(
    `la conversación se cierra (${etiqueta})`,
    true,
    () => (window.__nefan.dialogueVisible ? null : true),
    { ms: 15_000 },
  );
  return { puesto };
}

/** La primera línea que el jugador le escribe al motor: la marca A SECAS, que
 *  no pide nada pero deja el motor falso en manos de este guion (sus turnos
 *  2-4 ponen un hostil, un cofre y una forja, y el cofre cae EXACTAMENTE donde
 *  este guion va a medir). Ver `motorConducidoPorMarcas` en el fake. */
async function tomarElMandoDelMotor(ctx) {
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    "T abre la caja de texto libre (tomar el mando)",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  const antes = await ctx.page.evaluate(() => window.__nefan.dialogue().text);
  await ctx.page.keyboard.type(MARCA_MANDO);
  await ctx.page.keyboard.press("Enter");
  await ctx.waitFor(
    "el motor contesta a la primera línea (y con ella deja de poner lo suyo por turno)",
    (t) => {
      const d = window.__nefan.dialogue();
      return d.visible && d.text && d.text !== t ? { t: d.text } : null;
    },
    60_000,
    antes,
  );
  await panelPintado(ctx);
}

/** Cierra el panel de diálogo desde donde esté (con opciones en pantalla hay
 *  que elegir una; `advanceDialogue` solo cierra la línea sin opciones). */
async function cerrarLaConversacion(ctx) {
  await ctx.nefan("chooseDialogue", 1);
  await ctx.waitFor("el motor contesta a la despedida", () => window.__nefan.dialogueVisible || null, 60_000);
  await panelPintado(ctx);
  await ctx.nefan("advanceDialogue");
  await ctx.waitFor("el panel se cierra", () => (!window.__nefan.dialogue().visible ? { cerrado: true } : null), 10_000);
}

/** ¿Cabe el spawn si se pide DESDE AQUÍ? Se contesta con la foto que va a
 *  juzgar después, y no con otra: `probeCollide` pregunta «¿puedo MOVERME de
 *  donde estoy a ahí?» (`collidesAt` rasteriza el segmento desde
 *  `getPlayerPos()`), así que una foto tomada antes de abrir la conversación y
 *  un aserto hecho con otra posterior no hablan del mismo camino — medido: la
 *  búsqueda decía «libre» y el carro caía en el muro. */
function cabeElSpawn(foto) {
  const centro = { x: foto.origen.x, z: foto.origen.z - HUECO_DEL_SPAWN_M };
  // Solo el CENTRO, y no un margen alrededor: `probeCollide` no es un mapa del
  // suelo sino «¿puedo moverme de donde estoy a ahí?», así que preguntar por
  // los lados pregunta por caminos DIAGONALES que rozan la esquina del
  // edificio — con un margen de ±1,5 m no pasaba ningún sitio del bench, y lo
  // que se descartaba era el camino, no el hueco.
  return eraLibre(foto, centro.x, centro.z) === true ? centro : null;
}

/** Pide UNA entidad al motor DESDE UN SITIO EN EL QUE QUEPA, y devuelve lo que
 *  puso junto a la foto del suelo con la que se juzgó.
 *
 *  Es un bucle porque el bench deja al tabernero pegado a la taberna: lo que
 *  el bridge pone cae 5 m al NORTE del jugador (su `playerForward` es fijo),
 *  y desde la mayoría de los sitios a tiro de su `E` eso es dentro del
 *  edificio. Cada vuelta se coloca en otro punto, abre la conversación, mira
 *  el suelo desde ahí y solo pide si cabe. Si tras varias vueltas no hay
 *  ninguno, se declara SIN MEDIR: es un motivo, no un rojo. */
let mandoTomado = false;

async function pedirDondeQuepa(ctx, marca, etiqueta) {
  for (let intento = 1; intento <= 5; intento++) {
    await acercarse(ctx, TABERNERO, { objetivo: 2.0, lista: "npcs" });
    if (intento > 1) {
      // Otro sitio: el de la vuelta anterior ya se sabe que no vale.
      const previa = await fotoDelSuelo(ctx);
      const npc = await ctx.page.evaluate((id) => window.__nefan.npcs().find((n) => n.id === id) ?? null, TABERNERO);
      const sitio = npc ? sitioDesdeElQueCabe(previa, previa.origen, npc, HUECO_DEL_SPAWN_M, 1) : null;
      if (sitio) await irA(ctx, sitio, "otro sitio desde el que el spawn pueda caber");
    }
    await abrirLaConversacion(ctx);
    // La primera línea toma el mando del motor falso: sin ella, sus turnos 2-4
    // ponen un cofre y una forja EXACTAMENTE donde este guion mide, y la
    // segunda vuelta del bucle encuentra un mundo distinto de la primera.
    if (!mandoTomado) {
      await tomarElMandoDelMotor(ctx);
      mandoTomado = true;
    }
    const foto = await fotoDelSuelo(ctx);
    const cabe = cabeElSpawn(foto);
    if (!cabe) {
      ctx.log(
        `intento ${intento}: desde (${foto.origen.x.toFixed(2)}, ${foto.origen.z.toFixed(2)}) lo que ` +
          `pida el motor caería en el muro de la taberna; se busca otro sitio`,
      );
      await cerrarLaConversacion(ctx);
      continue;
    }
    ctx.log(
      `el jugador pide «${etiqueta}» desde (${foto.origen.x.toFixed(2)}, ${foto.origen.z.toFixed(2)}) — ` +
        `ahí el suelo está libre (intento ${intento})`,
    );
    return { ...(await pedirAlMotor(ctx, marca, etiqueta, foto)), foto };
  }
  return null;
}

/** Los dos asertos del TAMAÑO: mide lo que el motor declaró (y no el defecto
 *  de su clase) y es de runtime, que es lo que hace que su caja sea lo único
 *  que puede decidir si frena. */
function afirmaElTamano(ctx, huella, etiqueta, obj, decl) {
  // EL ORÁCULO ES ESTE GUION, no la función que se está midiendo. La aritmética
  // se escribe aquí —celdas × 0,5 m— y `huellaEnMetros` entra después como
  // SEGUNDO testigo. Con el oráculo puesto solo en ella, un `huellaEnMetros`
  // que ignorara su segundo argumento dejaba este guion ENTERO en verde con la
  // bolsa midiendo la mitad de lo declarado, y la línea salía diciéndose a sí
  // misma «✔ la bolsa mide lo que el motor DECLARÓ (2×2 celdas = 0.5×0.5 m)»
  // (QA de la PR 1, H-3, sabotaje 5b).
  const esperado = { x: decl.footprint[0] * METROS_POR_CELDA, z: decl.footprint[1] * METROS_POR_CELDA };
  ctx.expect(
    `${etiqueta} mide lo que el motor DECLARÓ: ${decl.footprint.join("×")} celdas × ${METROS_POR_CELDA} m = ${esperado.x}×${esperado.z} m`,
    obj.sizeXZ?.x === esperado.x && obj.sizeXZ?.z === esperado.z,
    `${JSON.stringify(obj.sizeXZ)} vs lo declarado ${JSON.stringify(esperado)}`,
  );
  // Y la segunda ancla, la que no depende de la aritmética: lo declarado tiene
  // que salirse del DEFECTO de su clase. Si el footprint se ignorara, saldría
  // exactamente el defecto — así que esto lo caza aunque el número de arriba se
  // escribiera mal.
  const porDefecto = huella(decl.kind);
  ctx.expect(
    `…y no el defecto de su clase (un \`${decl.kind}\` sin declarar nada mide ${porDefecto.x} m)`,
    obj.sizeXZ?.x !== porDefecto.x || obj.sizeXZ?.z !== porDefecto.z,
    `${JSON.stringify(obj.sizeXZ)} vs el defecto ${JSON.stringify(porDefecto)}`,
  );
  // Tercer testigo, ya sí con la función del juego: el guion y core dicen lo
  // mismo. Si divergen, uno de los dos está mal y hay que mirarlo.
  const dice = huella(decl.kind, decl.footprint);
  ctx.expect(
    `…y core deriva ese mismo tamaño para ${etiqueta} (el guion y el juego no se han separado)`,
    dice.x === esperado.x && dice.z === esperado.z,
    `core ${JSON.stringify(dice)} vs lo declarado ${JSON.stringify(esperado)}`,
  );
  ctx.expect(
    `${etiqueta} es de RUNTIME: su caja es lo único que puede decidir si frena`,
    obj.dueno?.de === "runtime",
    `dueno=${JSON.stringify(obj.dueno)}`,
  );
}

export default async function (ctx) {
  const huella = await huellaDeCore();
  if (typeof huella !== "function") {
    ctx.sinMedir(
      `sin \`nefan-core/dist\` no hay con qué comparar lo que declaró el motor (cd nefan-core && npm run build): ${huella.error}`,
    );
  }

  // ── 0 · Partida y conversación con el tabernero ─────────────────────────
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  await comenzar(ctx);
  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  // ── 1 · LA BOLSA: un `item` que se pisa ─────────────────────────────────
  const bolsa = await pedirDondeQuepa(ctx, MARCA_BOLSA, BOLSA.nombre);
  if (!bolsa) {
    ctx.sinMedir(
      "no hubo ningún sitio a tiro de la `E` del tabernero desde el que lo que pide el motor caiga en " +
        "suelo libre: el bench lo deja pegado a la taberna y el spawn iría dentro del edificio. " +
        "Medir ahí sería medir el muro, no la caja del spawn",
    );
  }
  ctx.log(
    `el motor puso la bolsa: ${JSON.stringify({
      category: bolsa.puesto.category,
      sizeXZ: bolsa.puesto.sizeXZ,
      dueno: bolsa.puesto.dueno,
    })}`,
  );
  afirmaElTamano(ctx, huella, "la bolsa", bolsa.puesto, BOLSA);
  ctx.expect(
    "la bolsa entra como `item`, que es la categoría que la colisión del jugador NO mira",
    bolsa.puesto.category === "item",
    `category=${bolsa.puesto.category}`,
  );

  const bolsaEraLibre = eraLibre(bolsa.foto, bolsa.puesto.pos.x, bolsa.puesto.pos.z);
  ctx.log(`donde cayó la bolsa, el suelo de antes estaba ${bolsaEraLibre === null ? "fuera de la foto" : bolsaEraLibre ? "libre" : "SÓLIDO"}`);
  const jugadorAntesDelPaseo = await posicion(ctx);
  if (bolsaEraLibre !== true) {
    ctx.sinMedirBloque(
      "la bolsa cayó donde el PLAN del tile ya era sólido: lo que bloquea ahí no es ella, y medirlo " +
        "diría que un `item` frena cuando lo que frena es el muro que ya estaba",
    );
  } else {
    const conLaBolsa = await sondear(ctx, bolsa.puesto.pos);
    ctx.expect(
      "donde no había nada, la bolsa NO bloquea: un `item` se pisa, que es lo que pedía el criterio del jugador",
      conLaBolsa.bloquea === false,
      `${JSON.stringify(conLaBolsa)} · el mismo punto estaba libre antes del spawn`,
    );
    if (!caminoLibreAntes(bolsa.foto, jugadorAntesDelPaseo, bolsa.puesto.pos)) {
      ctx.sinMedirBloque(
        "entre el jugador y la bolsa ya había algo sólido antes del spawn (el plan del tile): no se " +
          "puede llegar andando sin que lo que se mida sea ese muro",
      );
    } else {
      // Llegar a menos de media huella + radio del centro es IMPOSIBLE si la
      // caja frenara: ahí es justo donde estaría su pared.
      await revivirSiHaceFalta(ctx);
      const objetivo = bolsa.puesto.sizeXZ.x / 2 + RADIO - 0.1;
      const cerca = await acercarse(ctx, bolsa.puesto.id, { objetivo, lista: "objects" });
      ctx.expect(
        "el jugador ANDA hasta ponerse ENCIMA de la bolsa (si frenara, su pared estaría justo ahí)",
        cerca !== null && cerca.d <= objetivo,
        JSON.stringify(cerca),
      );
      ctx.expect(
        "…y la captura de abajo enseña lo que dice enseñar: el jugador está VIVO y delante de ella",
        (await vidaDelHud(ctx)) > 0,
        `vida ${await vidaDelHud(ctx)}`,
      );
      await ctx.shot("encima-de-la-bolsa");
    }
  }

  // ── 2 · EL CARRO: un `object` de 6×6 celdas, en el mismo punto ───────────
  const carro = await pedirDondeQuepa(ctx, MARCA_CARRO, CARRO.nombre);
  if (!carro) {
    ctx.sinMedirBloque(
      "no hubo ningún sitio a tiro de la `E` del tabernero desde el que el carro cayera en suelo libre: " +
        "lo que bloquearía ahí sería el muro de la taberna y no su caja",
    );
    return;
  }
  ctx.log(
    `el motor puso el carro: ${JSON.stringify({
      category: carro.puesto.category,
      sizeXZ: carro.puesto.sizeXZ,
      dueno: carro.puesto.dueno,
    })}`,
  );
  afirmaElTamano(ctx, huella, "el carro", carro.puesto, CARRO);
  ctx.expect(
    "el carro entra como `prop`, que es una de las dos categorías que frenan",
    carro.puesto.category === "prop",
    `category=${carro.puesto.category}`,
  );
  // El número del título del issue: el carro es el DOBLE de ancho que cualquier
  // `object` de antes de #532, cuando el tamaño lo ponía el juego.
  const porDefecto = huella("object");
  ctx.expect(
    `y por eso ya no mide lo mismo que un cofre sin declarar (${porDefecto.x} m): lo que el motor dice, vale`,
    carro.puesto.sizeXZ.x > porDefecto.x,
    `carro ${JSON.stringify(carro.puesto.sizeXZ)} vs defecto ${JSON.stringify(porDefecto)}`,
  );

  const carroEraLibre = eraLibre(carro.foto, carro.puesto.pos.x, carro.puesto.pos.z);
  ctx.log(`donde cayó el carro, el suelo de antes estaba ${carroEraLibre === null ? "fuera de la foto" : carroEraLibre ? "libre" : "SÓLIDO"}`);
  const jugador = await posicion(ctx);
  if (carroEraLibre !== true) {
    ctx.sinMedirBloque(
      "el carro cayó donde el PLAN del tile ya era sólido, así que lo que bloquea ahí no es su caja: " +
        "medirlo diría que el motor declara paredes cuando lo que hay es la taberna",
    );
  } else {
    const conElCarro = await sondear(ctx, carro.puesto.pos);
    ctx.expect(
      "donde no había nada, el carro BLOQUEA: lo que el motor declara sólido, se rodea",
      conElCarro.bloquea === true,
      JSON.stringify(conElCarro),
    );
    const pared = await paredMedida(ctx, carro.puesto);
    const teorica = carro.puesto.sizeXZ.x / 2 + RADIO;
    ctx.expect(
      `la pared del carro está a ${teorica} m de su centro (media huella DECLARADA + radio), medida y no supuesta`,
      Math.abs(Math.min(...pared) - teorica) <= PASO_DEL_BARRIDO_M,
      `pared por eje [+x, −x, +z, −z] = ${JSON.stringify(pared)} · la más corta ${Math.min(...pared).toFixed(2)} vs core ${teorica}`,
    );
    if (!caminoLibreAntes(carro.foto, jugador, carro.puesto.pos)) {
      ctx.sinMedirBloque(
        "entre el jugador y el carro ya había algo sólido antes del spawn (el plan del tile), así que " +
          "una parada por el camino no diría nada de la caja del carro",
      );
    } else {
      await revivirSiHaceFalta(ctx);
      const parada = await empujarContra(ctx, carro.puesto.pos);
      const sobra = sobraDelBorde(parada, carro.puesto);
      const detalle =
        `parada (${parada.x.toFixed(2)}, ${parada.z.toFixed(2)}) · le sobra ${sobra.toFixed(2)} m al borde ` +
        `de una caja de ${carro.puesto.sizeXZ.x}×${carro.puesto.sizeXZ.z} m + radio ${RADIO}`;
      ctx.expect("el jugador ANDA hacia el carro (si no, nada de lo de abajo mide)", parada.arranco === true, detalle);
      ctx.expect("empujando contra el carro, el jugador NO entra en su caja", sobra >= DENTRO_M, detalle);
      // Y que se paró CONTRA ÉL: sin esto, un jugador parado a diez metros por
      // cualquier motivo también tendría «no entra» en verde.
      ctx.expect(
        "y se para PEGADO a él (a menos de 0,5 m de su cara), que es lo que hace de ese verde una medida",
        sobra <= 0.5,
        detalle,
      );
      ctx.log(`empujón contra el carro: ${detalle}`);
      ctx.expect(
        "…y la captura de abajo enseña lo que dice enseñar: el jugador está VIVO y pegado al carro",
        (await vidaDelHud(ctx)) > 0,
        `vida ${await vidaDelHud(ctx)}`,
      );
      await ctx.shot("contra-el-carro");
    }
  }
}
