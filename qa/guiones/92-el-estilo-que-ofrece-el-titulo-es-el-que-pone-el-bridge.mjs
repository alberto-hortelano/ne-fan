/** La FRONTERA que movió la PR 7 de #241: el título dejó de tener criterio
 *  propio sobre QUÉ ESTILO se le ofrece a un mundo y sobre CUÁNDO un borrador
 *  vale una génesis. Las dos reglas viven hoy en core
 *  (`session/eleccion-de-estilo.ts`, `protocol/borrador-de-mundo.ts`) y las
 *  llaman las dos puntas.
 *
 *  Hasta esta PR eran DOS criterios y se sabía: el desplegable de estilo del
 *  título (hoy `ui/titulo/selector-de-mundo.ts`, PR 5 de #346)
 *  EXIGÍA compatibilidad temática al estilo que declara el mundo —si no
 *  casaba ni lo ofrecía, ponía otro y con cero compatibles bloqueaba
 *  «Continuar»— mientras `bridge/handlers/session.ts:194-196` respetaba el
 *  `style_id` del mundo casara o no. Un mundo podía arrancar con un estilo
 *  distinto del que dice su `game.json` sin que nadie lo dijera. Manda el
 *  BRIDGE (decisión del usuario, 2026-09-07), y el desplegable ofrece además
 *  el preseleccionado cuando no está entre los compatibles, marcado como de
 *  otro tema (recomendación (a) de `plan.md` §9).
 *
 *  Lo que ningún guion medía y aquí se mide:
 *
 *   **A · el estilo del mundo es el que viene puesto.** Con los mundos que
 *   trae el juego, cada uno preselecciona EL SUYO (el de su `game.json`) y su
 *   opción lo dice: «(del mundo)». Es la mitad barata, y sin ella las demás
 *   medirían un desplegable cualquiera.
 *
 *   **B · el estilo del mundo que NO casa por tema sigue mandando.** Es el
 *   caso que cambió, y ningún mundo de `data/games` lo produce hoy: se fabrica
 *   uno en el DISCO EFÍMERO de la corrida (el mismo `data/games` que ve el
 *   jugador — no hay estado sintético en el cable) con un pack de otro tema
 *   como `style_id`. El desplegable lo ofrece marcado «(del mundo · otro
 *   tema)», lo trae PUESTO, «Continuar» no se bloquea, y la partida arranca
 *   DE VERDAD con ese estilo (`sesion().styleId`), que es lo que dice el
 *   bridge. Con el criterio viejo del título, ese mundo arrancaba con otro.
 *
 *   **C · el mundo cuyo pack ya no está cae al primero compatible.** El otro
 *   brazo de la regla, y el único por el que se llega a él de verdad: un mundo
 *   SIN `style_id` no puede existir en disco (`GameMetaSchema` lo exige y
 *   `listGames` lo descarta — medido escribiéndolo), así que el caso del
 *   jugador es el pack borrado o renombrado. Se afirma sin volver a escribir
 *   la regla: lo puesto es la PRIMERA opción del desplegable y ninguna lleva
 *   marca — que es lo que significa «el primero compatible» cuando lo ofrecido
 *   son los compatibles en orden. Y la partida arranca igual: perder un pack
 *   no deja el mundo sin jugar.
 *
 *   **D · el invariante que hace inexpresable el estado malo**, comprobado en
 *   los tres casos: el `value` del `<select>` es SIEMPRE uno de sus
 *   `<option>`. Un `select` con un `value` que no es ninguna de sus opciones
 *   es exactamente lo que devuelve el mutante que el módulo nombra en su
 *   `porque` (quitar el `|| o === elegido` del filtro), y el jugador lo vería
 *   como un desplegable en blanco que arranca con un estilo que no eligió.
 *
 *   **E · el borrador corto se rechaza con EL MISMO TEXTO en las dos puntas.**
 *   El título con 19 caracteres y el bridge con los mismos 19 por el cable
 *   (`create_game`, socket del juego) tienen que decir la MISMA frase: dos
 *   redacciones son dos criterios que hoy coinciden por casualidad, y hasta
 *   esta PR ni siquiera coincidían (el bridge devolvía `draft_too_short: …`
 *   y el título lo pintaba tal cual). Y los espacios no cuentan: 18 útiles
 *   entre espacios se rechazan igual, que es el recorte que ahora va dentro.
 *
 *   **F · el borrador demasiado largo ya no viaja.** 64.001 caracteres se
 *   rechazan EN EL TÍTULO y no sale ni un `create_game` por el socket (se
 *   cuentan en la página, envolviendo `WebSocket.send` antes de cargar, molde
 *   del 85). Antes el título solo miraba el mínimo y un `.md` de 200 kB se
 *   mandaba entero para que lo rechazara la otra punta.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { esperarTituloListo } from "../lib/sesion.mjs";

export const aisla = ["saves"];

/** Los mundos que se fabrican en el disco efímero, y se borran al terminar.
 *  `fab_otro_tema` clona un mundo medieval y le pone un pack futurista;
 *  `fab_pack_borrado` clona el mismo y le pone un pack que no existe. */
const FABRICADOS = {
  fab_otro_tema: { title: "QA · mundo de tema cruzado", style_id: "acero_neon" },
  fab_pack_borrado: { title: "QA · mundo cuyo pack ya no está", style_id: "pack_que_el_jugador_borro" },
};
const MOLDE = "alta_fantasia";

/** El texto que tiene que salir por las dos puntas. Se escribe aquí a mano a
 *  propósito: si se importara de `MOTIVOS_DE_BORRADOR` el guion no podría
 *  distinguir «las dos puntas dicen lo mismo» de «las dos leen la misma
 *  constante que yo», y lo que el jugador lee es un texto, no una constante. */
const MOTIVO_CORTO =
  "El borrador es demasiado corto — describe el mundo con al menos unas frases (mínimo 20 caracteres).";
const MOTIVO_LARGO = "El borrador es demasiado largo — máximo 64.000 caracteres.";

/** Fabrica los mundos en el `data/games` de ESTA corrida. Devuelve el
 *  directorio para poder borrarlos después. */
function fabricarMundos(tmp) {
  const games = join(tmp, "games");
  const molde = JSON.parse(readFileSync(join(games, MOLDE, "game.json"), "utf8"));
  for (const [id, parche] of Object.entries(FABRICADOS)) {
    const dir = join(games, id);
    mkdirSync(dir, { recursive: true });
    const meta = { ...molde, game_id: id, title: parche.title };
    meta.style_id = parche.style_id;
    writeFileSync(join(dir, "game.json"), JSON.stringify(meta, null, 2), "utf8");
    // `world.md` es obligatorio para que `loadGameMeta` no descarte el mundo.
    writeFileSync(join(dir, "world.md"), readFileSync(join(games, MOLDE, "world.md"), "utf8"), "utf8");
  }
  return games;
}

/** Lo que enseña el desplegable de estilos con el mundo `gameId` elegido. */
async function desplegable(page, gameId) {
  await page.click(`[data-game-id="${gameId}"]`);
  return page.evaluate(() => {
    const sel = document.getElementById("ts-style");
    const btn = document.getElementById("ts-continue");
    return {
      opciones: [...sel.options].map((o) => ({ id: o.value, texto: o.textContent })),
      puesto: sel.value,
      continuar: btn ? !btn.disabled : null,
    };
  });
}

/** El invariante D, comprobado donde se mire. */
function afirmarInvariante(ctx, caso, d) {
  ctx.expect(
    `D · ${caso}: lo puesto está entre lo ofrecido`,
    d.opciones.some((o) => o.id === d.puesto),
    `puesto "${d.puesto}" · opciones ${d.opciones.map((o) => o.id).join(", ") || "(ninguna)"}`,
  );
}

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp || !existsSync(join(tmp, "games"))) {
    ctx.sinMedir(
      "sin disco efímero (QA_RUN_TMP) no hay `data/games` de esta corrida donde fabricar el mundo de " +
        "tema cruzado, y escribir en el del checkout le cambiaría los mundos al usuario",
    );
  }
  const games = fabricarMundos(tmp);

  try {
    // El contador de `create_game` del bloque F: envuelve el socket ANTES de
    // que la página cargue, para no perderse ninguno.
    await ctx.page.addInitScript(() => {
      window.__qa92 = { create_game: 0 };
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        try {
          if (typeof data === "string" && JSON.parse(data).type === "create_game") window.__qa92.create_game++;
        } catch {
          /* un frame que no es JSON no es un create_game */
        }
        return send.call(this, data);
      };
    });
    await ctx.page.reload({ waitUntil: "domcontentloaded" });
    await esperarTituloListo(ctx);
    await ctx.page.click("#ts-new");
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });

    const mundos = await ctx.page.$$eval("[data-game-id]", (els) => els.map((e) => e.dataset.gameId));
    for (const id of Object.keys(FABRICADOS)) {
      if (!mundos.includes(id)) {
        ctx.sinMedir(`el título no ofrece el mundo fabricado "${id}"; hay: ${mundos.join(", ")}`);
      }
    }
    ctx.log(`mundos en el selector: ${mundos.join(", ")}`);

    // ── A · el estilo del mundo es el que viene puesto ────────────────────
    const reales = mundos.filter((m) => !(m in FABRICADOS) && !m.startsWith("user_"));
    for (const id of reales) {
      const declarado = JSON.parse(readFileSync(join(games, id, "game.json"), "utf8")).style_id;
      const d = await desplegable(ctx.page, id);
      ctx.expect(
        `A · ${id}: viene puesto el estilo que declara su game.json`,
        d.puesto === declarado,
        `puesto "${d.puesto}" · game.json "${declarado}"`,
      );
      const suya = d.opciones.find((o) => o.id === declarado);
      ctx.expect(
        `A · ${id}: su opción dice que es la del mundo`,
        Boolean(suya) && suya.texto.includes("(del mundo)"),
        suya ? `«${suya.texto}»` : "su estilo ni siquiera se ofrece",
      );
      ctx.expect(`A · ${id}: «Continuar» habilitado`, d.continuar === true, `continuar=${d.continuar}`);
      afirmarInvariante(ctx, id, d);
    }

    // ── B · el estilo de otro tema sigue mandando ─────────────────────────
    const cruzado = await desplegable(ctx.page, "fab_otro_tema");
    const marcada = cruzado.opciones.find((o) => o.id === FABRICADOS.fab_otro_tema.style_id);
    ctx.expect(
      "B · el estilo de otro tema que declara el mundo SE OFRECE",
      Boolean(marcada),
      `opciones: ${cruzado.opciones.map((o) => o.id).join(", ")}`,
    );
    ctx.expect(
      "B · y se ofrece MARCADO como del mundo y de otro tema",
      Boolean(marcada) && marcada.texto.includes("(del mundo · otro tema)"),
      marcada ? `«${marcada.texto}»` : "no está",
    );
    ctx.expect(
      "B · y es el que viene PUESTO (manda el bridge, no la compatibilidad)",
      cruzado.puesto === FABRICADOS.fab_otro_tema.style_id,
      `puesto "${cruzado.puesto}"`,
    );
    ctx.expect(
      "B · los compatibles siguen ofreciéndose con él",
      cruzado.opciones.length > 1,
      `${cruzado.opciones.length} opción(es)`,
    );
    ctx.expect("B · «Continuar» no se bloquea", cruzado.continuar === true, `continuar=${cruzado.continuar}`);
    afirmarInvariante(ctx, "fab_otro_tema", cruzado);
    await ctx.shot("desplegable-tema-cruzado");

    // …y la partida arranca DE VERDAD con ese estilo.
    await ctx.page.click(`#ts-charmode [data-charmode="vector"]`);
    await ctx.page.click("#ts-continue");
    await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
    await ctx.page.click("#ts-start");
    const enMarcha = await ctx.waitFor(
      "la partida del mundo de tema cruzado está en marcha",
      () => {
        const st = window.__nefan.status();
        if (st.title || !st.scene) return null;
        const s = window.__nefan.sesion();
        return s.sessionId ? { sessionId: s.sessionId, styleId: s.styleId } : null;
      },
      180_000,
    );
    ctx.expect(
      "B · la partida corre con el estilo que declara el mundo, no con otro compatible",
      enMarcha.styleId === FABRICADOS.fab_otro_tema.style_id,
      `sesion().styleId = "${enMarcha.styleId}"`,
    );
    ctx.log(`partida ${enMarcha.sessionId} · estilo ${enMarcha.styleId}`);

    // …Y EL JUGADOR SE ENTERA (#537). La política —el estilo del mundo manda
    // aunque no case— no se revisa aquí; lo que se afirma es su CONSECUENCIA
    // visible. Hasta el 2026-09-10 este hecho existía solo en el `console.warn`
    // del bridge: la marca «(del mundo · otro tema)» del desplegable
    // desaparecía al entrar y ya no había forma de saber por qué el arte no
    // pega con el mundo. Ahora el bridge lo manda en la respuesta del arranque
    // y el cliente lo apunta en el REGISTRO y lo dice en la LÍNEA DEL JUEGO.
    const dicho = await ctx.waitFor(
      "el registro del jugador recoge el aviso del estilo de otro tema",
      () => {
        const reg = document.getElementById("error-log")?.textContent ?? "";
        const linea = document.getElementById("combat-log")?.textContent ?? "";
        return /otro tema/i.test(reg) ? { reg: reg.trim(), linea: linea.trim() } : null;
      },
      30_000,
    );
    ctx.log(`registro: ${dicho.reg.slice(-260)}`);
    const estiloCruzado = dicho.reg.slice(dicho.reg.indexOf("Esta partida usa"));
    ctx.expect(
      "B · el aviso nombra el estilo y el mundo, y dice qué se puede hacer (#537)",
      /un estilo de otro tema/.test(estiloCruzado) &&
        estiloCruzado.includes(FABRICADOS.fab_otro_tema.title) &&
        /selector de mundos/.test(estiloCruzado),
      estiloCruzado.slice(0, 260) || "(el registro no lo dice)",
    );
    ctx.expect(
      "B · …sin la causa cruda: las listas de tags se quedan en el servidor",
      !/tags:|style_id|acero_neon/.test(estiloCruzado),
      estiloCruzado.slice(0, 260),
    );
    ctx.expect(
      "B · …UNA sola vez, no una por turno",
      (dicho.reg.match(/un estilo de otro tema/g) ?? []).length === 1,
      `${(dicho.reg.match(/un estilo de otro tema/g) ?? []).length} apariciones en el registro`,
    );
    // NO se afirma la línea del juego, y se dice por qué: el registro de la
    // partida conserva ocho líneas y este aviso llega antes que las cinco del
    // arranque, así que sale por abajo antes de que nadie lo lea. Medido aquí
    // mismo al escribir el guion; por eso el cliente lo manda al registro y no
    // a esa línea.
    ctx.log(`línea del juego (no se afirma, ver arriba): ${dicho.linea.slice(0, 120)}`);
    await ctx.shot("aviso-de-estilo-de-otro-tema");

    // ── C · el mundo sin `style_id` cae al primero compatible ─────────────
    await ctx.page.reload({ waitUntil: "domcontentloaded" });
    await esperarTituloListo(ctx);
    await ctx.page.click("#ts-new");
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
    const caido = await desplegable(ctx.page, "fab_pack_borrado");
    ctx.expect(
      "C · con el pack del mundo borrado viene puesta la PRIMERA opción",
      caido.opciones.length > 0 && caido.puesto === caido.opciones[0].id,
      `puesto "${caido.puesto}" · primera "${caido.opciones[0]?.id}"`,
    );
    ctx.expect(
      "C · y ninguna opción se marca (el pack que declara ya no está)",
      caido.opciones.every((o) => !/\((?:del mundo|otro tema)/.test(o.texto)),
      caido.opciones.map((o) => o.texto).join(" | "),
    );
    afirmarInvariante(ctx, "fab_pack_borrado", caido);

    // ── E/F · el borrador, mismo texto en las dos puntas ──────────────────
    await ctx.page.click("#ts-create-world");
    await ctx.page.waitForSelector("#ts-draft", { timeout: 15_000 });
    const enElTitulo = async (texto) => {
      await ctx.page.fill("#ts-draft", texto);
      await ctx.page.click("#ts-create");
      return ctx.waitFor(
        "el título contesta al borrador",
        () => document.getElementById("ts-create-status")?.textContent?.trim() || null,
        10_000,
      );
    };
    const corto = await enElTitulo("A".repeat(19));
    ctx.expect("E · el título rechaza 19 caracteres con su motivo", corto === MOTIVO_CORTO, `«${corto}»`);
    const conEspacios = await enElTitulo(`   ${"A".repeat(18)}   `);
    ctx.expect(
      "E · los espacios no cuentan: 18 útiles entre espacios se rechazan igual",
      conEspacios === MOTIVO_CORTO,
      `«${conEspacios}»`,
    );
    await ctx.shot("borrador-corto");

    const largo = await enElTitulo("A".repeat(64_001));
    ctx.expect("F · el título rechaza 64.001 caracteres con su motivo", largo === MOTIVO_LARGO, `«${largo}»`);
    const enviados = await ctx.page.evaluate(() => window.__qa92.create_game);
    ctx.expect(
      "F · y ninguno de los tres borradores malos viajó por el cable",
      enviados === 0,
      `${enviados} create_game enviados`,
    );

    // El BRIDGE, con los mismos 19 caracteres, por el socket del juego.
    const delBridge = await ctx.page.evaluate(
      () =>
        new Promise((res, rej) => {
          const ws = new WebSocket(window.__nefan.servicios()["game-gateway"]);
          let contestado = false;
          ws.onerror = () => rej(new Error("no se pudo abrir el socket del juego"));
          ws.onclose = () => {
            if (!contestado) rej(new Error("el bridge cerró sin contestar a create_game"));
          };
          ws.onopen = () =>
            ws.send(JSON.stringify({ type: "create_game", requestId: "qa-92", draftText: "A".repeat(19) }));
          ws.onmessage = (ev) => {
            const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
            if (m.type !== "game_created") return;
            contestado = true;
            ws.close();
            res(m);
          };
        }),
    );
    ctx.expect(
      "E · el bridge rechaza los mismos 19 caracteres",
      delBridge.ok === false,
      JSON.stringify(delBridge).slice(0, 160),
    );
    ctx.expect(
      "E · y con EL MISMO TEXTO que enseña el título",
      delBridge.error === corto,
      `bridge «${delBridge.error}» · título «${corto}»`,
    );
  } finally {
    for (const id of Object.keys(FABRICADOS)) rmSync(join(games, id), { recursive: true, force: true });
  }
}
