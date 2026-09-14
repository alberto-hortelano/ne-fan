/** LO QUE EL MOTOR DECLARA, medido en las DOS mitades del criterio del jugador
 *  (#532): la que esta PR cierra —lo declarado manda EN VIVO— y la que se queda
 *  para la PR 2 —lo declarado al REANUDAR la partida—.
 *
 *  POR QUÉ NO LO CUBREN EL 91 NI EL 118. El 91 mide los DEFECTOS (lo que el
 *  motor pone sin declarar nada) en vivo y tras reanudar. El 118 mide lo
 *  DECLARADO, pero solo en vivo, y lo dice en su cabecera: del resume no afirma
 *  nada. Ninguno de los dos pone las dos clases de spawn en la MISMA partida,
 *  que es lo único que contesta la pregunta del coordinador: «¿ningún spawn
 *  deja de ser sólido por omitir un campo?» se contesta con las combinaciones,
 *  no con una.
 *
 *  LA MATRIZ, y por qué son cuatro y no una:
 *    · `object` SIN declarar   → 1,5 m y FRENA   (el cofre del turno 3)
 *    · `building` SIN declarar → 4 m y FRENA     (la forja del turno 3)
 *    · `object` CON footprint  → 3 m y FRENA     (el carro, [6,6])
 *    · `item` CON footprint    → 1 m y SE PISA   (la bolsa, [2,2])
 *   Lo que NO se puede pedir a este bench y por eso no está: un `item` SIN
 *   footprint (el motor falso no lo emite) y el `footprint` en un `npc` (lo
 *   rechaza el contrato antes de llegar aquí, y eso lo miden el zod y su espejo
 *   Python en `test/entity-vocabulary.test.ts`).
 *
 *  LO QUE HOY SE MIDE Y NO SE AFIRMA, con su motivo. El resume de esta PR está
 *  incompleto a propósito: `CLASES_QUE_VUELVEN` (`session/mundo-persistido.ts`)
 *  no tiene `item` y la huella se re-deriva del `type` del record ignorando el
 *  `footprint` que SÍ está en el save. Así que las tres líneas `[PR 2]` van con
 *  `ctx.log` y no con `ctx.expect`: un rojo a propósito se aprende a ignorar
 *  (regla T10), y lo que aquí hace falta es el NÚMERO, no el color. **Con la
 *  PR 2 esas líneas pasan a `ctx.expect`** y este guion se convierte en su
 *  candado — está escrito para que sea un cambio de verbo.
 *
 *  Lo que SÍ se afirma del resume, porque es cierto hoy y tiene que seguir
 *  siéndolo: que lo que no vuelve SE DICE en el registro del jugador con su
 *  nombre (fail-loud), y que lo que no declaró nada vuelve exactamente igual.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; los spawns del turno 3 los pone el
 *  motor falso y los declarados salen de sus dos marcas. `aisla` deja saves y
 *  motor falso vírgenes (este guion depende del turno del falso, como el 91).
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { comenzar, nuevaPartida, reanudar } from "../lib/sesion.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";
import { esperarEnElSave } from "../lib/saves.mjs";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
/** Lo que el motor falso pone en su turno 3 SIN declarar nada. */
const COFRE = "Cofre de la posada";
const FORJA = "Forja de Robledo";
const NOGALA = "Nogala";
/** Las marcas del texto libre y lo que el motor declara con ellas. */
const MARCA_BOLSA = "LO QUE DECLARA EL MOTOR: BOLSA";
const MARCA_CARRO = "LO QUE DECLARA EL MOTOR: CARRO";
const BOLSA = { nombre: "Bolsa de monedas", kind: "item", footprint: [2, 2] };
const CARRO = { nombre: "Carro de heno", kind: "object", footprint: [6, 6] };
/** Radio del cuerpo del jugador (`PLAYER_RADIUS_M`, core). */
const RADIO = 0.4;
/** Tolerancia de la pared medida por sondas: el paso del barrido (5 cm) y un pelo. */
const PASO_DEL_BARRIDO_M = 0.06;

/** El tamaño que declara core: del `footprint` en CELDAS si el motor lo
 *  declaró, del defecto de su clase si no. DOS argumentos, que es el contrato
 *  desde #532. */
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

/** El panel de diálogo TERMINADO de pintar. No se exige que haya OPCIONES: la
 *  respuesta a un texto libre viene sin ellas (lo midió el 118 al cerrarla con
 *  `advanceDialogue`), y este guion escribe dos textos libres seguidos. */
const panelPintado = (ctx) =>
  ctx.waitFor(
    "el typewriter termina de pintar la línea del motor",
    () => {
      const d = window.__nefan.dialogue();
      const texto = document.getElementById("dialogue-text")?.textContent ?? "";
      // Las OPCIONES, además del texto: `finishTypewriter` para el timer y
      // pinta las choices en la misma línea (`dialogue-panel.ts`), así que los
      // botones son la señal de que el typewriter acabó DEL TODO. Con el texto
      // solo queda una ventana de un tick en la que `_typewriterTimer` sigue
      // vivo y la `T` se la come para completar la línea en vez de abrir la
      // caja: esa carrera puso rojo este guion al integrarlo (timeout en «T
      // abre la caja de texto libre»), y es la misma que el 118 evita así.
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      return d.visible && d.text && texto === d.text && botones > 0 ? { texto, botones } : null;
    },
    60_000,
  );

/** Dónde acaba la caja de `obj`: desde su centro hacia los cuatro ejes, a qué
 *  distancia deja de bloquear. La MISMA sonda del 91 y del 118. */
const paredMedida = (ctx, obj) =>
  ctx.page.evaluate((e) => {
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

/** Le escribe al motor una marca con la conversación ABIERTA y espera a que lo
 *  que pide aparezca en el mundo. */
async function pedirAlMotor(ctx, marca, etiqueta) {
  await panelPintado(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    `T abre la caja de texto libre (${etiqueta})`,
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  await ctx.page.keyboard.type(marca);
  await ctx.page.keyboard.press("Enter");
  return ctx.waitFor(
    `el motor pone «${etiqueta}»`,
    (n) => window.__nefan.objects().find((x) => x.label === n) ?? null,
    90_000,
    etiqueta,
  );
}

/** Cierra el panel desde donde esté y espera a que se vaya. */
async function cerrarElPanel(ctx) {
  await panelPintado(ctx);
  await ctx.nefan("advanceDialogue");
  await ctx.absorbe(
    "cortafuegos del cierre del panel: lo que este guion mide después son sondas de colisión y paseos, " +
      "que no dependen de que el panel esté cerrado (el aserto de cada uno está en su bloque)",
    () => ctx.waitFor("el panel se cierra", () => (window.__nefan.dialogueVisible ? null : true), 15_000),
  );
}

/** Levanta al jugador si el bench lo mató. La R es del jugador y se repite
 *  hasta que el sim la aplica; espera por ESTADO, no por reloj. */
async function revivirSiHaceFalta(ctx) {
  const vivo = await ctx.absorbe(
    "cortafuegos del respawn: lo que este guion afirma son sondas de colisión y tamaños, que no dependen " +
      "de que el jugador esté en pie; esto solo evita que las capturas salgan con el muro de muerte",
    () =>
      ctx.waitFor(
        "el jugador está en pie (se pulsa R si hace falta)",
        () => {
          const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "0");
          if (hp > 0) return { hp };
          window.__nefan.inputDriver.queueRespawn();
          return null;
        },
        15_000,
      ),
  );
  ctx.log(vivo ? `el jugador está en pie (${vivo.hp} HP)` : "el jugador sigue caído: las capturas saldrán con el muro de muerte");
}

/** Se planta a `d` metros al SUR de `obj` y lo mira, SOLO para la captura. Es
 *  el teletransporte del banco (`setPlayerPos`, que existe justo para capturas
 *  deterministas): todo lo que este guion AFIRMA se mide con sondas o andando.
 *
 *  Y se ESPERA a que la cámara esté donde se la mandó antes de disparar: la
 *  primera versión hacía `setPlayerPos` + `shot` seguidos y salían DOS FOTOS
 *  IDÉNTICAS desde el sitio anterior — la posición la escribe el hook y la
 *  cámara la lee el rAF siguiente. */
async function mirarDesdeElSur(ctx, obj, d) {
  const destino = { x: obj.pos.x, z: obj.pos.z + d };
  await ctx.nefan("setPlayerPos", destino.x, destino.z);
  // Mirando al norte: dx = 0, dz = −d ⇒ atan2(0, −d) = π.
  await ctx.nefan("setYaw", Math.PI);
  const puesta = await ctx.absorbe(
    "cortafuegos del encuadre de una CAPTURA: si la cámara no llega, la foto sale desde otro sitio y se " +
      "dice en el registro; ninguna afirmación de este guion depende de ella",
    () =>
      ctx.waitFor(
        `la cámara llega al mirador (${destino.x.toFixed(1)}, ${destino.z.toFixed(1)})`,
        (dst) => {
          const p = window.__nefan.state().pos;
          return Math.hypot(p.x - dst.x, p.z - dst.z) < 0.6 ? { x: p.x, z: p.z } : null;
        },
        5_000,
        destino,
      ),
  );
  if (!puesta) ctx.log(`la cámara NO se quedó en el mirador de ${obj.label}: la captura sale desde donde estuviera`);
  // Dos rAF: el primero aplica la posición, el segundo pinta con ella.
  await ctx.page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
  );
}

/** Los dos asertos deterministas de una caja: mide lo que core dice para su
 *  clase y su declaración, y es de RUNTIME (que es lo que hace que su caja sea
 *  lo único que puede decidir si frena). */
function afirmaElTamano(ctx, huella, etiqueta, obj, kind, footprint, cuando) {
  const dice = huella(kind, footprint);
  const deDonde = footprint
    ? `los [${footprint}] celdas que DECLARÓ el motor`
    : `el defecto de su \`${kind}\`, que NO cambia por omitir el campo`;
  ctx.expect(
    `${cuando}, ${etiqueta} mide ${dice.x}×${dice.z} m — ${deDonde}`,
    obj.sizeXZ?.x === dice.x && obj.sizeXZ?.z === dice.z,
    `${JSON.stringify(obj.sizeXZ)} vs core ${JSON.stringify(dice)}`,
  );
  ctx.expect(
    `${cuando}, ${etiqueta} es de RUNTIME: su caja es lo único que puede decidir si frena`,
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

  // ── 0 · Partida y los tres spawns que NO declaran nada (turno 3) ─────────
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);
  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  const hostil = await ctx.waitFor(
    "el motor materializa al hostil (turno 2)",
    () => window.__nefan.enemies().find((e) => e.label === "Secuaz") ?? null,
    90_000,
  );
  await ctx.nefan("chooseDialogue", 0);
  const trio = await ctx.waitFor(
    "el motor pone la forja, el cofre y a Nogala SIN declarar tamaño (turno 3)",
    (n) => {
      const o = window.__nefan.objects();
      const forja = o.find((x) => x.label === n.f);
      const cofre = o.find((x) => x.label === n.c);
      const nogala = window.__nefan.npcs().find((x) => x.label === n.p);
      return forja && cofre && nogala ? { forja, cofre, nogala } : null;
    },
    90_000,
    { f: FORJA, c: COFRE, p: NOGALA },
  );

  // ── 1 · LA MITAD QUE NO SE TOCA: omitir el campo no cambia nada ──────────
  afirmaElTamano(ctx, huella, "el cofre", trio.cofre, "object", null, "en vivo");
  afirmaElTamano(ctx, huella, "la forja", trio.forja, "building", null, "en vivo");
  const solidez = await ctx.page.evaluate(
    (ids) => {
      const pc = window.__nefan.probeCollide;
      const o = window.__nefan.objects();
      const box = (id) => {
        const e = o.find((x) => x.id === id);
        const d = e.sizeXZ.x / 2 + 0.4 - 0.1;
        return {
          categoria: e.category,
          centro: pc(e.pos.x, e.pos.z),
          bordes: [pc(e.pos.x + d, e.pos.z), pc(e.pos.x - d, e.pos.z), pc(e.pos.x, e.pos.z + d), pc(e.pos.x, e.pos.z - d)],
        };
      };
      return { cofre: box(ids.c), forja: box(ids.f) };
    },
    { c: trio.cofre.id, f: trio.forja.id },
  );
  ctx.expect(
    "un `object` que no declara NADA sigue siendo sólido en su centro y sus cuatro bordes (el cofre)",
    solidez.cofre.categoria === "prop" && solidez.cofre.centro && solidez.cofre.bordes.every(Boolean),
    JSON.stringify(solidez.cofre),
  );
  ctx.expect(
    "y un `building` que no declara NADA, también (la forja)",
    solidez.forja.categoria === "building" && solidez.forja.centro && solidez.forja.bordes.every(Boolean),
    JSON.stringify(solidez.forja),
  );
  const nogalaEnListas = await ctx.page.evaluate((n) => ({
    enNpcs: window.__nefan.npcs().some((x) => x.label === n),
    enObjetos: window.__nefan.objects().some((o) => o.label === n),
  }), NOGALA);
  ctx.expect(
    "y el `npc` del mismo turno no es una caja: entra como personaje y no como objeto",
    nogalaEnListas.enNpcs && !nogalaEnListas.enObjetos,
    JSON.stringify(nogalaEnListas),
  );

  // El hostil del turno 2 antes de andar, como haría quien juega: si no, los
  // paseos de abajo son una carrera contra su daño (lo midió el 91).
  await cerrarElPanel(ctx);
  const pelea = await herirHasta(ctx, hostil.id, 0, { maxMs: 45_000 });
  ctx.log(`el hostil del turno 2 (${hostil.label}): ${JSON.stringify(pelea)}`);
  await revivirSiHaceFalta(ctx);

  // ── 2 · LO DECLARADO, en la MISMA partida ───────────────────────────────
  // Se piden por separado y ANDANDO entre medias: los dos caen 5 m al norte de
  // donde esté el jugador (`near_player` + `playerForward` fijo), así que
  // pedidos sin moverse caerían uno DENTRO del otro y no habría dos cajas que
  // comparar. El paseo a la bolsa es además el criterio del jugador: se pisa.
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero vuelve a contestar", () => window.__nefan.dialogueVisible || null, 60_000);
  const bolsa = await pedirAlMotor(ctx, MARCA_BOLSA, BOLSA.nombre);
  afirmaElTamano(ctx, huella, "la bolsa", bolsa, BOLSA.kind, BOLSA.footprint, "en vivo");
  ctx.expect(
    "la bolsa entra como `item`, la categoría que la colisión del jugador NO mira",
    bolsa.category === "item",
    `category=${bolsa.category}`,
  );
  await cerrarElPanel(ctx);
  // ¿Se puede llegar ANDANDO? El bridge deja lo que el motor pone 5 m al norte
  // del jugador (`playerForward` fijo) y ahí puede haber un muro del plan del
  // tile o una caja de otro turno. Un `item` NO bloquea, así que si la recta
  // hasta ella bloquea en algún punto, lo que hay en medio no es la bolsa:
  // medir el paseo diría que un `item` frena cuando lo que frena es otra cosa.
  // (Medido: una de cada tres corridas de este guion, con el cofre del turno 4
  // en medio.) Es un motivo para declarar, no un rojo.
  const caminoALaBolsa = await ctx.page.evaluate((b) => {
    const pc = window.__nefan.probeCollide;
    const p = window.__nefan.state().pos;
    const n = Math.max(1, Math.ceil(Math.hypot(b.pos.x - p.x, b.pos.z - p.z) / 0.25));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (pc(p.x + (b.pos.x - p.x) * t, p.z + (b.pos.z - p.z) * t)) return { libre: false, en: t };
    }
    return { libre: true, en: 1 };
  }, bolsa);
  if (!caminoALaBolsa.libre) {
    ctx.sinMedirBloque(
      `entre el jugador y la bolsa hay algo sólido que NO es ella (a ${(caminoALaBolsa.en * 100).toFixed(0)} % del ` +
        "camino): el bench deja el spawn 5 m al norte, y ahí caen el muro de la taberna y las cajas de los " +
        "turnos anteriores. Andar hasta allí mediría ese muro, no la bolsa — lo que un `item` no frena lo " +
        "afirman las sondas de arriba",
    );
  } else {
    const encima = await acercarse(ctx, bolsa.id, { objetivo: bolsa.sizeXZ.x / 2 + RADIO - 0.1, lista: "objects" });
    ctx.expect(
      "el jugador ANDA hasta ponerse ENCIMA de la bolsa (si frenara, su pared estaría justo ahí)",
      encima !== null && encima.d <= bolsa.sizeXZ.x / 2 + RADIO - 0.1,
      JSON.stringify(encima),
    );
  }

  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta otra vez", () => window.__nefan.dialogueVisible || null, 60_000);
  const carro = await pedirAlMotor(ctx, MARCA_CARRO, CARRO.nombre);
  afirmaElTamano(ctx, huella, "el carro", carro, CARRO.kind, CARRO.footprint, "en vivo");
  ctx.expect(
    "el carro entra como `prop`, una de las dos categorías que frenan",
    carro.category === "prop",
    `category=${carro.category}`,
  );
  ctx.expect(
    `y en la MISMA partida el carro DECLARADO (${carro.sizeXZ.x} m) y el cofre SIN declarar (${trio.cofre.sizeXZ.x} m) miden distinto`,
    carro.sizeXZ.x > trio.cofre.sizeXZ.x,
    `carro ${JSON.stringify(carro.sizeXZ)} · cofre ${JSON.stringify(trio.cofre.sizeXZ)}`,
  );
  await cerrarElPanel(ctx);
  await revivirSiHaceFalta(ctx);

  // ── 3 · LA FOTO DE LAS CUATRO ESCALAS EN UN GREYBOX ─────────────────────
  ctx.log(
    "las cuatro cajas de esta partida, en metros de lado: " +
      `bolsa ${bolsa.sizeXZ.x} (item [2,2]) · cofre ${trio.cofre.sizeXZ.x} (object sin declarar) · ` +
      `carro ${carro.sizeXZ.x} (object [6,6]) · forja ${trio.forja.sizeXZ.x} (building sin declarar)`,
  );
  await mirarDesdeElSur(ctx, bolsa, 5);
  await ctx.shot("la-bolsa-de-1x1-a-cinco-metros");
  // A los MISMOS 9 m desde los que se le retrata tras reanudar: el par de fotos
  // solo compara tamaños si la cámara está en el mismo sitio las dos veces.
  await mirarDesdeElSur(ctx, carro, 9);
  await ctx.shot("el-carro-de-3x3-a-nueve-metros");
  // Y los dos en el MISMO encuadre, que es la pregunta de dirección de arte:
  // ¿se leen como una bolsa y un carro, o como dos cajas grises?
  const enMedio = {
    label: "la bolsa y el carro",
    pos: { x: (bolsa.pos.x + carro.pos.x) / 2, z: Math.max(bolsa.pos.z, carro.pos.z) },
  };
  await mirarDesdeElSur(ctx, enMedio, 9);
  await ctx.shot("la-bolsa-y-el-carro-en-el-mismo-encuadre");

  // ── 4 · TRAS REANUDAR: qué vuelve, de qué tamaño, y qué se le dice ──────
  const paredAntes = await paredMedida(ctx, carro);
  const teoricaAntes = carro.sizeXZ.x / 2 + RADIO;
  ctx.expect(
    `antes de reanudar, la pared del carro está a ${teoricaAntes} m de su centro (media huella DECLARADA + radio)`,
    Math.abs(Math.min(...paredAntes) - teoricaAntes) <= PASO_DEL_BARRIDO_M,
    `pared [+x,−x,+z,−z] = ${JSON.stringify(paredAntes)}`,
  );
  const enDisco = await esperarEnElSave(
    partida.sessionId,
    (s) => {
      const runtime = (s.entities ?? []).filter((e) => e.spawn_reason === "narrative_request");
      const conFootprint = runtime.filter((e) => Array.isArray(e.data?.footprint));
      return runtime.length >= 5 && conFootprint.length >= 2
        ? { runtime: runtime.length, conFootprint: conFootprint.length }
        : null;
    },
    30_000,
  );
  ctx.expect(
    "el save guarda los cinco spawns de runtime, y el `footprint` declarado VIAJA en el ledger (`data`)",
    Boolean(enDisco),
    `en disco: ${JSON.stringify(enDisco)}`,
  );

  const vuelta = await reanudar(ctx, partida.sessionId);
  ctx.expect("la partida vuelve", Boolean(vuelta), JSON.stringify(vuelta));
  const trasResume = await ctx.waitFor(
    "lo que NO declaró nada vuelve del save (cofre y forja)",
    (n) => {
      const o = window.__nefan.objects();
      const cofre = o.find((x) => x.label === n.c);
      const forja = o.find((x) => x.label === n.f);
      return cofre && forja ? { cofre, forja } : null;
    },
    90_000,
    { c: COFRE, f: FORJA },
  );
  afirmaElTamano(ctx, huella, "el cofre", trasResume.cofre, "object", null, "tras reanudar");
  afirmaElTamano(ctx, huella, "la forja", trasResume.forja, "building", null, "tras reanudar");

  // El muro del resume, si lo hay: se LEE (es lo que el jugador ve al volver) y
  // se cierra por su botón, como haría él. No se oculta con CSS — lo que tape
  // la pantalla es un hallazgo, no un paso de la receta.
  const muro = await ctx.page.evaluate(() => {
    const el = document.getElementById("narrative-loader");
    if (!el?.classList.contains("visible")) return null;
    return {
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
    };
  });
  if (muro) {
    ctx.log(`al reanudar, el jugador se encuentra este muro: ${JSON.stringify(muro)}`);
    await ctx.page.click("#narrative-loader-dismiss");
    await ctx.absorbe(
      "cortafuegos del cierre del muro: si no se va, la captura sale con él y se ve en la foto",
      () =>
        ctx.waitFor(
          "el muro del resume se cierra por su botón",
          () => (document.getElementById("narrative-loader")?.classList.contains("visible") ? null : true),
          10_000,
        ),
    );
  }

  const despues = await ctx.page.evaluate((n) => {
    const o = window.__nefan.objects();
    const carro = o.find((x) => x.label === n.ca) ?? null;
    return {
      carro: carro
        ? { id: carro.id, pos: { ...carro.pos }, sizeXZ: { ...carro.sizeXZ }, category: carro.category }
        : null,
      bolsa: o.some((x) => x.label === n.bo),
      registro: document.getElementById("error-log")?.textContent ?? "",
    };
  }, { ca: CARRO.nombre, bo: BOLSA.nombre });

  // LO QUE SÍ SE AFIRMA HOY: lo que no vuelve, se DICE, y con su nombre.
  ctx.expect(
    "lo que el motor puso y el resume no sabe devolver SE DICE en el registro del jugador, con su nombre",
    despues.registro.includes(BOLSA.nombre) && despues.registro.includes("no vuelve al mundo"),
    `registro: ${JSON.stringify(despues.registro.slice(0, 500))}`,
  );

  // LAS MEDIDAS DE LA PR 2 — `ctx.log` hasta que exista (ver la cabecera).
  ctx.log(
    `[PR 2] la bolsa (un \`item\`) ${despues.bolsa ? "VUELVE" : "NO vuelve"} al mundo tras reanudar ` +
      "— `CLASES_QUE_VUELVEN` no tiene `item`. Con la PR 2 esta línea es un `ctx.expect`",
  );
  if (despues.carro === null) {
    ctx.log("[PR 2] el carro tampoco volvió: no hay tamaño que comparar");
  } else {
    const declarado = huella(CARRO.kind, CARRO.footprint);
    const porDefecto = huella(CARRO.kind);
    ctx.log(
      `[PR 2] el carro vuelve midiendo ${despues.carro.sizeXZ.x}×${despues.carro.sizeXZ.z} m; el motor había ` +
        `declarado ${declarado.x}×${declarado.z} m y el defecto de su clase es ${porDefecto.x} m. Con la PR 2 ` +
        "esta línea es un `ctx.expect` de que vuelve con lo DECLARADO",
    );
    const paredDespues = await paredMedida(ctx, despues.carro);
    ctx.log(
      `[PR 2] y su pared pasa de ${Math.min(...paredAntes).toFixed(2)} m a ${Math.min(...paredDespues).toFixed(2)} m ` +
        `del centro: el jugador gana ${(Math.min(...paredAntes) - Math.min(...paredDespues)).toFixed(2)} m por ` +
        "cada lado de donde antes estaba el carro",
    );
    await mirarDesdeElSur(ctx, despues.carro, 9);
    await ctx.shot("el-mismo-carro-tras-reanudar");
  }
}
