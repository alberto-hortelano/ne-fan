/** Lo que el motor pone a mitad de partida vuelve al reanudar CON SU ROL DE
 *  SKIN, y lo que no puede volver SE DICE (QA del corte 4 de #358,
 *  `world/materializar-spawn.ts`).
 *
 *  Los guiones 48/49/66/67 afirman que las cuatro clases vuelven, con su nombre
 *  y su procedencia. Lo que ninguno mira es la OTRA salida del materializador:
 *  la petición de skin. Un NPC pacífico de runtime se pide con su `description`
 *  como prompt y con el rol que decide `npcSkinStyleRef` — el `style_ref` que
 *  eligió el motor si lo declaró, el rol por defecto de su `role` si no—, y esa
 *  decisión vive dentro del módulo movido. Si el corte hubiera perdido el
 *  `role` de la petición (o lo hubiera fijado al del rol sin mirar el
 *  `style_ref`), el juego seguiría PINTANDO a Nogala, pero con la ref de
 *  personaje equivocada, y ningún guion se enteraría.
 *
 *  Se mide por el RESUME y no en vivo a propósito: en el banco toda hoja que
 *  no sea `idle` da 500, así que tras el tabernero, el bandido y el Secuaz el
 *  cortacircuitos de sesión (`UMBRAL_APAGADO_DE_SESION` = 3, guion 51) ya está
 *  saltado cuando llega Nogala y su petición en vivo se descarta. Reanudar
 *  recarga la página y el manager de skins nace limpio: es el único momento del
 *  banco en que la petición del pacífico de runtime se puede observar.
 *
 *  Y la otra mitad: un record de runtime que el juego no sabe pintar (un
 *  `type` que no es npc|object|building) no tumba el resume ni desaparece
 *  callado — el panel de errores lo nombra UNA vez, el resto vuelve, y la línea
 *  del juego cuenta 3 y no 4. Lo filtra el core (`spawnsDeRuntime`); lo que se
 *  afirma aquí es lo que ve quien juega. Ningún otro guion llega a esa rama.
 *
 *  Y lo que el bloque 1 AFIRMA desde la PR 5 de #241 (2026-09-07): el edificio
 *  y el objeto spawneados SON SÓLIDOS. Nació aquí como `⚠ HALLAZGO` medido sin
 *  rojo —`collidesAt` saltaba TODOS los AABB de objetos en un tile con la
 *  colisión del plan aplicada (`svgApplied`), y todo tile del motor la tiene,
 *  así que el jugador veía una forja de 4×4 m y la atravesaba—; era #489, se
 *  pagó moviendo la frontera y las cajas a `nefan-core/src/simulation/
 *  obstaculos-del-jugador.ts` con el salto por OBJETO (`volume_id`) en vez de
 *  por tile, y las dos medidas pasaron a `expect`. La huella también dejó de
 *  inventarse: la deriva `huellaEnMetros` (core), así que el cofre pasó de los
 *  1,4 m escritos a mano a 1,5 (3 celdas de 0,5 m) y la forja sigue en 4×4.
 *
 *  PROBADO EN NEGATIVO (2026-09-06, sobre el árbol del corte 4):
 *   · quitando el `role` de la petición de skin del pacífico en
 *     `materializar-spawn.ts` (`characterSprites.requestSkin(npcPrompt, {})`),
 *     los bloques 2 y 3 se ponen rojos: la skin de Nogala se pide sin rol y el
 *     `style_ref` del save no llega.
 *   · quitando el `errors.push("session", err)` del resume en `main.ts`, el
 *     bloque 4 se pone rojo: la forja no vuelve y nadie lo dice.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; los spawns los manda el motor
 *  falso en los turnos 2 y 3.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  nuevaPartida,
  comenzar,
  reanudar,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";
import { esperarEnElSave, rutaDelSave } from "../lib/saves.mjs";

/** El fake es determinista por turno de diálogo: saves vírgenes y contador a 0. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
/** Lo que el motor falso declara en los turnos 2 y 3, tal cual. */
const HOSTIL = "Secuaz";
const NOGALA = { name: "Nogala", description: "posadera de manos grandes y delantal remendado" };
const COFRE = "Cofre de la posada";
const FORJA = "Forja de Robledo";
/** Un `style_ref` que no existe en ningún pack: si llega al rol de la skin es
 *  porque el materializador lo leyó del record, no porque lo derivara del rol. */
const STYLE_REF_DEL_SAVE = "qa81_ref_posadera";
const TIPO_DESCONOCIDO = "dragon";
/** Media huella del edificio spawneado más el radio del jugador. Las huellas
 *  las deriva `huellaEnMetros` de su footprint por defecto en CELDAS: building
 *  8×8 y object 3×3, a 0,5 m la celda → 4×4 m y 1,5×1,5 m. */
const SEMI_FORJA_M = 4 / 2 + 0.4;
const SEMI_COFRE_M = 1.5 / 2 + 0.4;

/** El libro de skins: qué se ha pedido y con qué rol (solo lectura). */
const skins = (ctx) => ctx.page.evaluate(() => window.__nefan.skins.map((s) => ({ prompt: s.prompt, role: s.role })));

/** Las entradas del panel de errores tal cual las lee quien juega (sin la cabecera). */
const panelDeErrores = (ctx) =>
  ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div"))
      .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => !/^Errores \(\d+\)$/.test(t) && t !== "— sin errores —"),
  );

const lineasDelJuego = (ctx) =>
  ctx.page.evaluate(() => Array.from(document.getElementById("combat-log").children).map((c) => c.textContent));

const mundo = (ctx) =>
  ctx.page.evaluate(() => ({
    enemigos: window.__nefan.enemies().map((e) => ({ id: e.id, label: e.label })),
    npcs: window.__nefan.npcs().map((n) => ({ id: n.id, label: n.label, skinPrompt: n.skinPrompt })),
    objetos: window.__nefan.objects().map((o) => ({ id: o.id, label: o.label, category: o.category, pos: o.pos })),
  }));

/** Al título limpio (reload) con la lista de saves puesta. */
async function alTitulo(ctx) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
}

/** Reanuda y espera a que Nogala esté en escena (la puerta del resume ya corrió). */
async function reanudarHastaNogala(ctx, sessionId) {
  const ok = await reanudar(ctx, sessionId);
  if (!ok) return false;
  await ctx.waitFor(
    "el mundo vuelve con Nogala tras reanudar",
    (n) => window.__nefan.npcs().find((x) => x.label === n) ?? null,
    60_000,
    NOGALA.name,
  );
  // El registro y el panel se escriben en el mismo tick que los spawns; una
  // vuelta más de bucle para leerlos asentados.
  await ctx.waitFor(
    "la línea «El mundo vuelve con…» está escrita",
    () => Array.from(document.getElementById("combat-log").children).some((c) => c.textContent.includes("El mundo vuelve con")) || null,
    10_000,
  );
  return true;
}

export default async function (ctx) {
  // ── 0 · La partida y los spawns del motor (turnos 2 y 3) ─────────────────
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
    `el motor materializa a «${HOSTIL}» (turno 2)`,
    (n) => window.__nefan.enemies().find((e) => e.label === n) ?? null,
    90_000,
    HOSTIL,
  );
  await ctx.nefan("chooseDialogue", 0);
  const trio = await ctx.waitFor(
    "el motor materializa a Nogala, el cofre y la forja (turno 3)",
    (n) => {
      const npc = window.__nefan.npcs().find((x) => x.label === n.p);
      const o = window.__nefan.objects();
      const cofre = o.find((x) => x.label === n.c);
      const forja = o.find((x) => x.label === n.f);
      return npc && cofre && forja ? { nogala: npc, cofre, forja } : null;
    },
    90_000,
    { p: NOGALA.name, c: COFRE, f: FORJA },
  );
  await ctx.nefan("advanceDialogue");
  await ctx.expectEspera("la conversación se cierra", true, () => (window.__nefan.dialogueVisible ? null : true), { ms: 15_000 });
  const idsVivos = { secuaz: hostil.id, nogala: trio.nogala.id, cofre: trio.cofre.id, forja: trio.forja.id };
  ctx.log(`spawns de runtime en vivo: ${JSON.stringify(idsVivos)}`);

  // ── 1 · #489: lo spawneado ES SÓLIDO, y mide lo que dice medir ──────────
  const huella = await ctx.page.evaluate(
    ({ ids, semiForja, semiCofre }) => {
      const pc = window.__nefan.probeCollide;
      const o = window.__nefan.objects();
      // Las cuatro direcciones cardinales, a `d` metros del centro.
      const cruz = (e, d) => [
        pc(e.pos.x + d, e.pos.z), pc(e.pos.x - d, e.pos.z),
        pc(e.pos.x, e.pos.z + d), pc(e.pos.x, e.pos.z - d),
      ];
      const medir = (id, s) => {
        const e = o.find((x) => x.id === id);
        return {
          sizeXZ: e.sizeXZ,
          volumeId: e.volumeId,
          centro: pc(e.pos.x, e.pos.z),
          // Justo DENTRO del borde de la caja + el radio del jugador: bloquea
          // por los cuatro lados.
          borde: cruz(e, s - 0.1),
          // Y un palmo MÁS ALLÁ: la caja tiene que acabarse por algún lado. No
          // por los cuatro: los tres spawns del turno caen a 1,8 m unos de
          // otros (`SEPARACION_M`) y la caja de 4×4 de la forja llega hasta
          // casi el cofre, así que exigir las cuatro libres sería afirmar la
          // separación del motor, no el tamaño de esta caja.
          libre: cruz(e, s + 0.25),
        };
      };
      const tile = o.find((x) => x.category === "building" && !x.id.startsWith("narr_"));
      return {
        forja: medir(ids.forja, semiForja),
        cofre: medir(ids.cofre, semiCofre),
        edificioDelTile: tile
          ? { id: tile.id, volumeId: tile.volumeId, centro: pc(tile.pos.x, tile.pos.z) }
          : null,
      };
    },
    { ids: idsVivos, semiForja: SEMI_FORJA_M, semiCofre: SEMI_COFRE_M },
  );
  ctx.log(
    `huella colisionable del spawn: forja ${JSON.stringify(huella.forja)} · ` +
      `cofre ${JSON.stringify(huella.cofre)} · edificio del tile ${JSON.stringify(huella.edificioDelTile)}`,
  );
  for (const [que, m, lado] of [["forja", huella.forja, 4], ["cofre", huella.cofre, 1.5]]) {
    // La huella VIENE de core (`huellaEnMetros`), no de dos literales del cliente.
    ctx.expect(
      `la huella del ${que} es la que deriva core (${lado}×${lado} m)`,
      m.sizeXZ?.x === lado && m.sizeXZ?.z === lado,
      JSON.stringify(m.sizeXZ),
    );
    ctx.expect(`el centro del ${que} spawneado BLOQUEA (#489)`, m.centro === true);
    ctx.expect(`y su caja entera: los cuatro bordes del ${que} bloquean`, m.borde.every((b) => b === true), JSON.stringify(m.borde));
    ctx.expect(`un palmo más allá del ${que} se pasa por algún lado (la caja no es infinita)`, m.libre.some((b) => b === false), JSON.stringify(m.libre));
  }
  // POR QUÉ el spawn choca y el edificio del tile no cambia: el criterio es
  // `volume_id`. Lo del plan es sólido por el GRID (con sus puertas); lo
  // spawneado, que no está en ningún plan, por su caja.
  ctx.expect(
    "lo spawneado NO lo representa ningún volumen del plan (por eso su caja es lo único que lo hace sólido)",
    huella.forja.volumeId === undefined && huella.cofre.volumeId === undefined,
    `forja=${huella.forja.volumeId} cofre=${huella.cofre.volumeId}`,
  );
  ctx.expect(
    "el edificio del tile SÍ lo representa un volumen del plan, y sigue bloqueando en su centro por el grid",
    Boolean(huella.edificioDelTile?.volumeId) && huella.edificioDelTile?.centro === true,
    JSON.stringify(huella.edificioDelTile),
  );
  await ctx.shot("spawns-en-vivo");

  // El save tiene a Nogala con su procedencia antes de tocar nada.
  const enDisco = await esperarEnElSave(
    partida.sessionId,
    (s) => (s.entities ?? []).find((e) => e.id === idsVivos.nogala && e.data?.name === NOGALA.name) ?? null,
    60_000,
  );
  if (!enDisco) ctx.sinMedir("el spawn de Nogala no llegó al save de disco: no hay record que rehidratar ni sabotear");
  const ruta = rutaDelSave(partida.sessionId);
  if (!ruta) ctx.sinMedir("esta corrida no tiene disco propio (stack adoptado): sin el save no hay nada que sabotear");
  await alTitulo(ctx);
  const original = readFileSync(ruta, "utf-8");

  // ── 2 · Reanudar: Nogala pide su skin con su procedencia y un rol ────────
  if (!(await reanudarHastaNogala(ctx, partida.sessionId))) {
    ctx.expect("el save intacto se reanuda", false, partida.sessionId);
    return;
  }
  const s2 = await skins(ctx);
  const nogalaSkin = s2.find((k) => k.prompt === NOGALA.description);
  ctx.log(`skins tras reanudar: ${JSON.stringify(s2)}`);
  ctx.expect(
    "al reanudar, la skin de Nogala se pide con su procedencia (`description`) como prompt",
    Boolean(nogalaSkin),
    JSON.stringify(s2),
  );
  ctx.expect(
    "…y con un rol de personaje (el de `npcSkinStyleRef` para villager), no sin rol",
    typeof nogalaSkin?.role === "string" && nogalaSkin.role.length > 0,
    JSON.stringify(nogalaSkin),
  );
  const m2 = await mundo(ctx);
  const ids2 = [...m2.enemigos, ...m2.npcs, ...m2.objetos].map((e) => e.id);
  ctx.expect(
    "las cuatro vuelven con los MISMOS ids que en vivo y sin duplicados (una sola puerta)",
    Object.values(idsVivos).every((id) => ids2.includes(id)) && new Set(ids2).size === ids2.length,
    JSON.stringify({ idsVivos, ids2 }),
  );
  ctx.expect(
    "la línea del juego cuenta 4 cosas que puso el motor",
    (await lineasDelJuego(ctx)).some((l) => l.includes("El mundo vuelve con 4 cosa(s)")),
    (await lineasDelJuego(ctx)).join(" | "),
  );
  await ctx.shot("reanudado-con-skins");

  // ── 3 · Un `style_ref` en el record llega al rol de la skin ──────────────
  await alTitulo(ctx);
  {
    const save = JSON.parse(original);
    const rec = save.entities.find((e) => e.id === idsVivos.nogala);
    rec.data.style_ref = STYLE_REF_DEL_SAVE;
    writeFileSync(ruta, JSON.stringify(save, null, 2));
  }
  if (!(await reanudarHastaNogala(ctx, partida.sessionId))) {
    ctx.expect("el save con style_ref se reanuda", false, partida.sessionId);
    writeFileSync(ruta, original);
    return;
  }
  const s3 = await skins(ctx);
  const conRef = s3.find((k) => k.prompt === NOGALA.description);
  ctx.expect(
    "el `style_ref` que eligió el motor es el rol con el que se pide la skin de Nogala",
    conRef?.role === STYLE_REF_DEL_SAVE,
    JSON.stringify(s3),
  );
  writeFileSync(ruta, original);

  // ── 4 · Un record que el juego no sabe pintar: se dice, y el resto vuelve ─
  await alTitulo(ctx);
  {
    const save = JSON.parse(original);
    const rec = save.entities.find((e) => e.id === idsVivos.forja);
    rec.type = TIPO_DESCONOCIDO;
    writeFileSync(ruta, JSON.stringify(save, null, 2));
  }
  if (!(await reanudarHastaNogala(ctx, partida.sessionId))) {
    ctx.expect("el save con un record de tipo desconocido se reanuda igual (no tumba la partida)", false, partida.sessionId);
    writeFileSync(ruta, original);
    return;
  }
  const errores = await panelDeErrores(ctx);
  const queLoDicen = errores.filter((e) => e.includes(FORJA) && e.includes(`tipo "${TIPO_DESCONOCIDO}"`));
  ctx.expect(
    "el panel de errores dice, UNA vez, que la forja no vuelve y por qué tipo",
    queLoDicen.length === 1,
    JSON.stringify(errores),
  );
  const m4 = await mundo(ctx);
  ctx.expect(
    "la forja no está y el resto (Nogala, cofre, Secuaz) sí",
    !m4.objetos.some((o) => o.id === idsVivos.forja) &&
      m4.objetos.some((o) => o.id === idsVivos.cofre) &&
      m4.npcs.some((n) => n.id === idsVivos.nogala) &&
      m4.enemigos.some((e) => e.id === idsVivos.secuaz),
    JSON.stringify(m4),
  );
  ctx.expect(
    "la línea del juego cuenta 3 y no 4",
    (await lineasDelJuego(ctx)).some((l) => l.includes("El mundo vuelve con 3 cosa(s)")),
    (await lineasDelJuego(ctx)).join(" | "),
  );
  await ctx.shot("reanudado-sin-la-forja-y-dicho");
  writeFileSync(ruta, original);
}
