/** #578 · Un mundo pre-generado cuya ENTRADA ya no pasa el validador se
 *  regenera DENTRO de su propio mapa, con una llamada al motor y sin sembrar.
 *
 *  Hasta #578 la entrada rota degradaba al bootstrap vivo: el motor sembraba
 *  un mapa NUEVO y generaba la entrada sin vecinos, y el write conservaba el
 *  anillo del fichero junto a ese mapa. Con el motor falso los ids sembrados
 *  coincidían con los del fichero y no se veía; con uno real, los ocho tiles
 *  del anillo quedaban apuntando a lugares que el mapa nuevo no tenía y su
 *  panel «Salidas» salía vacío. El bloque E5 del guion 127 medía eso con un
 *  aserto que acabó tautológico, y se mudó aquí en positivo y en negativo.
 *
 *  Cómo se hace visible con el motor falso (0 créditos): se pre-genera el
 *  mundo de verdad y en el FICHERO se renombra el lugar de partida
 *  (`taberna_bench_place` → `taberna_del_fichero`, en el mapa, los enlaces y
 *  las escenas) y se ata el anillo a él. El bootstrap que siembra volvería a
 *  crear `taberna_bench_place` —es lo que siembra el motor falso—, así que si
 *  alguien vuelve a encolarlo, el mapa escrito cambia y el anillo cuelga.
 *
 *   A · POSITIVO. Entrada rota + anillo atado a `taberna_del_fichero`:
 *       - exactamente UNA petición `/generate_scene`, y es la del tile (0,0)
 *         de ENTRADA, SIN `bootstrap_world_map` y con los cuatro vecinos;
 *       - el mapa escrito tiene los MISMOS lugares que el fichero y ninguna
 *         escena apunta a un lugar que no esté;
 *       - el jugador pasa de la entrada a un tile del anillo y el panel
 *         «Salidas» de ese tile NO está vacío (ofrece el molino), sin gastar.
 *   B · NEGATIVO. Un fichero que se contradice —el anillo apunta a un lugar
 *       que su propio mapa no tiene—: el muro del arranque lo dice sin ids
 *       internos (el motivo técnico va al log del bridge), CERO
 *       peticiones al motor y el fichero queda byte a byte como estaba. Nunca
 *       se vuelve en silencio a sembrar un mapa.
 *
 *  El cruce de la entrada al anillo: `pedirYEsperarTile` (lo que hace la
 *  frontera al acercarse al borde) y `setPlayerPos` dentro del tile (mismo
 *  cruce de borde que andar 60 m: el bucle del juego activa el tile bajo el
 *  jugador; patrón del guion 65).
 *
 *  PROBADO EN NEGATIVO el 2026-09-24 (tanda BE): con `session.ts` encolando
 *  `runBootstrapTile` en vez de `runEntradaEnElMapaDelFichero` —la conducta
 *  de antes de #578— el bloque A sale rojo; la salida está en el
 *  `implementacion.md` de la tanda. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { URLS } from "../lib/stack.mjs";
import { comenzar, nuevaPartida, pedirYEsperarTile, recargarAlTitulo, regenerarMundo } from "../lib/sesion.mjs";
import { botonesDeSalida } from "../lib/viaje.mjs";

export const aisla = ["mundo", "fake-ai", "saves"];

const GAME = "alta_fantasia";
const LUGAR_VIEJO = "taberna_bench_place";
const LUGAR_DEL_FICHERO = "taberna_del_fichero";
/** El tile del anillo al que cruza el jugador, y un punto dentro de él. */
const VECINO = { id: "tile_1_0", x: 64, z: 0 };

/** Lo que dice el motor falso de su trabajo: cuántas escenas y cuál fue la
 *  última que le pidieron. */
async function motor() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters HTTP ${r.status}`);
  const c = await r.json();
  return { escenas: c?.gasto?.rutas?.["/generate_scene"] ?? 0, ultima: c?.ultimaPeticionDeEscena ?? null };
}

/** Rompe la ENTRADA como lo haría un validador que se endureció: su NPC pasa
 *  a nacer dentro de un volumen sólido (`nace-en-solido`, #289). Misma técnica
 *  que el guion 127. */
function romperLaEntrada(snap) {
  const entrada = snap.scenes[snap.entry_scene_id];
  const npc = (entrada.entities ?? []).find((e) => e.kind === "npc");
  const solido = (entrada.volumes ?? []).find(
    (v) => Array.isArray(v.rect) && v.rect.length === 4 && (v.type === "prop" || (v.type === "building" && v.cutaway !== true)),
  );
  if (!npc || !solido) return null;
  const [c0, r0, w, d] = solido.rect;
  npc.cell = [Math.floor(c0 + w / 2), Math.floor(r0 + d / 2)];
  return npc.id;
}

const lugaresDe = (snap) => Object.keys(snap.world_map?.places ?? {}).sort();
const colgandoDe = (snap) => {
  const lugares = new Set(lugaresDe(snap));
  return Object.entries(snap.scenes)
    .filter(([, s]) => typeof s.place_id === "string" && s.place_id && !lugares.has(s.place_id))
    .map(([id, s]) => `${id}→${s.place_id}`);
};

/** Título → mundo → Comenzar, SIN esperar a que haya partida: en el bloque B
 *  no la va a haber. */
async function comenzarSinEsperar(ctx) {
  await nuevaPartida(ctx, { gameId: GAME, renderMode: "vector", charMode: "vector" });
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-start");
}

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp) ctx.sinMedir("sin QA_RUN_TMP: el stack no lo arrancó este runner y no hay tile.json que editar");
  const tileJson = join(tmp, "games", GAME, "world", "tile.json");
  const leerTexto = () => readFileSync(tileJson, "utf8");
  const leer = () => JSON.parse(leerTexto());
  const escribir = (s) => writeFileSync(tileJson, JSON.stringify(s, null, 2) + "\n", "utf8");

  await regenerarMundo(ctx, GAME);
  if (!existsSync(tileJson)) ctx.sinMedir(`«Generar mundo» no dejó ${tileJson}`);
  const intacto = leer();
  const anillo = Object.keys(intacto.scenes).filter((id) => id !== intacto.entry_scene_id);
  ctx.expect("el mundo pre-generado trae la entrada y el anillo de 8", anillo.length === 8, JSON.stringify(Object.keys(intacto.scenes)));
  ctx.expect(
    `el mapa pre-generado nombra «${LUGAR_VIEJO}» (lo que se renombra para que la divergencia exista con el motor falso)`,
    lugaresDe(intacto).includes(LUGAR_VIEJO),
    JSON.stringify(lugaresDe(intacto)),
  );
  ctx.expect(`el anillo incluye ${VECINO.id}`, anillo.includes(VECINO.id), JSON.stringify(anillo));

  // ── A · POSITIVO ─────────────────────────────────────────────────────────
  {
    const fichero = JSON.parse(JSON.stringify(intacto).replaceAll(`"${LUGAR_VIEJO}"`, `"${LUGAR_DEL_FICHERO}"`));
    for (const id of anillo) fichero.scenes[id].place_id = LUGAR_DEL_FICHERO;
    const npc = romperLaEntrada(fichero);
    if (!npc) ctx.sinMedir("la entrada no se puede romper: sin NPC o sin volumen sólido");
    escribir(fichero);
    ctx.log(`A · entrada rota (${npc} dentro de un sólido); anillo atado a «${LUGAR_DEL_FICHERO}»`);

    const antes = await motor();
    await recargarAlTitulo(ctx);
    await nuevaPartida(ctx, { gameId: GAME, renderMode: "vector", charMode: "vector" });
    await comenzar(ctx);
    const tras = await motor();
    ctx.log(`A · última petición al motor: ${JSON.stringify(tras.ultima)}`);
    ctx.expect("A · la entrada rota cuesta UNA petición al motor", tras.escenas === antes.escenas + 1, `/generate_scene ${antes.escenas} → ${tras.escenas}`);
    ctx.expect(
      "A · esa petición es el tile (0,0) de ENTRADA (bootstrap) y NO pide sembrar el mapa",
      JSON.stringify(tras.ultima?.tile) === "[0,0]" && tras.ultima?.bootstrap === true && tras.ultima?.bootstrap_world_map === false,
      JSON.stringify(tras.ultima),
    );
    ctx.expect(
      "A · …y lleva el anillo como vecinos (los cuatro bordes)",
      JSON.stringify([...(tras.ultima?.vecinos ?? [])].sort()) === JSON.stringify(["east", "north", "south", "west"]),
      JSON.stringify(tras.ultima?.vecinos),
    );

    const escrito = leer();
    ctx.expect(
      "A · el mapa escrito es el del FICHERO: mismos lugares, ninguno sembrado de nuevo",
      JSON.stringify(lugaresDe(escrito)) === JSON.stringify(lugaresDe(fichero)),
      `fichero ${JSON.stringify(lugaresDe(fichero))} · escrito ${JSON.stringify(lugaresDe(escrito))}`,
    );
    ctx.expect("A · ninguna escena apunta a un lugar que el mapa no tenga", colgandoDe(escrito).length === 0, JSON.stringify(colgandoDe(escrito)));
    ctx.expect(
      "A · la entrada nueva queda atada al lugar de partida del fichero",
      escrito.scenes[escrito.entry_scene_id]?.place_id === LUGAR_DEL_FICHERO,
      String(escrito.scenes[escrito.entry_scene_id]?.place_id),
    );

    // El jugador cruza de la entrada al anillo: lo que ve es el panel. El
    // tile llega como llega al acercarse al borde (la frontera lo pide y el
    // bridge lo sirve de la sesión), y luego se pisa.
    const antesDeCruzar = (await motor()).escenas;
    await pedirYEsperarTile(ctx, VECINO.id, 1, 0);
    await ctx.page.evaluate((p) => window.__nefan.setPlayerPos(p.x, p.z), VECINO);
    await ctx.waitFor("el cliente activa el tile del anillo al pisarlo", (t) => (window.__nefan.currentTile === t ? t : null), 30_000, VECINO.id);
    const exits = await ctx.waitFor(
      "el tile del anillo trae sus salidas",
      () => {
        const e = window.__nefan.exits ?? [];
        return e.length > 0 ? e.map((x) => x.place_id) : null;
      },
      15_000,
    );
    const botones = await botonesDeSalida(ctx);
    ctx.log(`A · salidas en ${VECINO.id}: ${JSON.stringify(exits)} · botones ${JSON.stringify(botones)}`);
    ctx.expect(`A · el panel «Salidas» de ${VECINO.id} NO está vacío`, botones.length > 0, JSON.stringify(botones));
    ctx.expect("A · …y ofrece el molino del mapa del fichero", exits.includes("molino_bench_place"), JSON.stringify(exits));
    ctx.expect("A · cruzar al anillo no cuesta ninguna llamada", (await motor()).escenas === antesDeCruzar, `${antesDeCruzar} → ${(await motor()).escenas}`);
    await ctx.shot("a-salidas-en-el-anillo");
  }

  // ── B · NEGATIVO: el fichero se contradice ───────────────────────────────
  {
    const fantasma = JSON.parse(JSON.stringify(intacto));
    for (const id of anillo) fantasma.scenes[id].place_id = "lugar_que_ya_no_existe";
    romperLaEntrada(fantasma);
    escribir(fantasma);
    const textoAntes = leerTexto();
    const antes = await motor();

    await recargarAlTitulo(ctx);
    await comenzarSinEsperar(ctx);
    const muro = await ctx.waitFor(
      "el muro de error del arranque aparece",
      () => {
        const l = document.getElementById("narrative-loader");
        if (!l?.classList.contains("error")) return null;
        return {
          detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
          volver: Boolean(document.getElementById("narrative-loader-back")?.offsetParent),
        };
      },
      60_000,
    );
    ctx.log(`B · muro: ${muro.detalle}`);
    ctx.expect("B · el muro dice qué pasa y qué hacer: regenerar el mundo", /Regenera el mundo/.test(muro.detalle), muro.detalle);
    // Los ids internos no son para quien juega (QA de BE, H2): van al log.
    ctx.expect("B · …sin enseñar ids internos al jugador", !/lugar_que_ya_no_existe|tile_/.test(muro.detalle), muro.detalle);
    const log = readFileSync(join(tmp, "logs", "nefan-bridge.log"), "utf8");
    ctx.expect(
      "B · …y el motivo técnico, con el lugar que falta, está en el log del bridge",
      log.split("\n").some((l) => l.includes("no se puede arrancar") && l.includes("lugar_que_ya_no_existe")),
      "no hay línea «no se puede arrancar … lugar_que_ya_no_existe» en nefan-bridge.log",
    );
    ctx.expect("B · …y ofrece volver al título", muro.volver, JSON.stringify(muro));
    const tras = await motor();
    ctx.expect("B · CERO peticiones al motor: no se siembra nada en silencio", tras.escenas === antes.escenas, `/generate_scene ${antes.escenas} → ${tras.escenas}`);
    ctx.expect("B · el fichero queda byte a byte como estaba", leerTexto() === textoAntes, "tile.json cambió");
    await ctx.shot("b-el-fichero-que-se-contradice");
  }
}
