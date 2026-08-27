/** El NPC llega ENTERO hasta la clave de caché de su skin, y por las dos vías.
 *
 *  El skin de cada personaje se paga por (prompt, style_id, style_role, anim,
 *  angle). Esa tupla la derivan DOS sitios distintos del cliente a partir del
 *  mismo NPC de la world scene:
 *
 *    · en partida        — `main.ts` (requestSkin → sprite-renderer)
 *    · desde el título   — `ui/style-apply.ts` ("Aplicar estilo", batch)
 *
 *  Si divergen en un solo campo, el mismo personaje se genera y se COBRA dos
 *  veces. Y para que ninguna de las dos pueda acertar, los campos del NPC
 *  (`description`, `role`, `style_ref`) tienen que sobrevivir a
 *  `formatDToWorld`. Este guion comprueba las dos cosas en el juego real.
 *
 *  Dispara generación de skins: se niega a correr si el backend de IA no es el
 *  fake del preset 5 (contra un stack real esto cuesta dinero).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stackSinCreditos, nuevaPartida, comenzar, regenerarMundo, esperarRegistro } from "../lib/sesion.mjs";

/** Precondición DECLARADA (qa/run.mjs la ejecuta antes de lanzar el guion):
 *   · `mundo`   — el batch de estilo lee el snapshot del mundo y deriva de él
 *                 el roster de personajes; heredar el que dejó otro guion es
 *                 heredar SU roster. Aquí se borra y este guion genera el suyo.
 *   · `fake-ai` — el motor falso cachea las páginas de atlas ya "pintadas" en
 *                 memoria de proceso; con la caché caliente de un guion
 *                 anterior el plan anuncia menos de lo que anunciaría en frío,
 *                 y este guion compara lo anunciado con lo emitido. */
export const aisla = ["mundo", "fake-ai"];

const GAME_ID = "alta_fantasia";
const FIXTURE = "robledo_tile";
const FIXTURE_EN_DISCO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "nefan-core", "data", "scenes", `${FIXTURE}.json`,
);

/** Clave de caché tal y como viaja en el cuerpo de /skin_sprite_sheet, con las
 *  claves ordenadas para poder comparar dos peticiones como texto. */
const clave = (b) =>
  JSON.stringify(Object.fromEntries(Object.entries(b).sort(([a], [c]) => a.localeCompare(c))));

/** La misma clave SIN la animación: es la identidad del personaje vestido. Las
 *  dos vías piden distinto número de anims (la partida bajo demanda, el batch
 *  las tres de golpe), pero si esta parte no coincide, el servidor genera y
 *  cobra dos veces al mismo personaje. */
const claveDePersonaje = (b) => clave({ model: b.model, angle: b.angle, prompt: b.prompt, style_id: b.style_id, style_role: b.style_role });

export default async function (ctx) {
  // Una sola pregunta, guardada: el guardarraíl sale a la red (dos /health) y
  // preguntarlo dos veces era pagar el viaje dos veces para el mismo dato.
  const sinCreditos = await stackSinCreditos(ctx);
  ctx.expect(
    "cliente Y bridge declaran motor falso (`e2e-sin-creditos`)",
    sinCreditos,
    "este guion dispara generación: sin las dos declaraciones no se ejecuta",
  );
  if (!sinCreditos) return;

  const peticiones = [];
  ctx.page.on("request", (r) => {
    if (r.url().includes("/skin_sprite_sheet")) {
      try {
        peticiones.push({ t: Date.now(), body: JSON.parse(r.postData() ?? "{}") });
      } catch {
        peticiones.push({ t: Date.now(), body: { __sin_body: r.url() } });
      }
    }
  });

  // El mundo lo genera ESTE guion (el runner acaba de borrar el que hubiera):
  // el batch de estilo deriva su roster del snapshot, así que heredarlo de
  // otro guion sería comparar contra un mundo que no es el suyo.
  await regenerarMundo(ctx, GAME_ID);

  // ── 1. Vía B: el batch de estilo, desde el título ────────────────────────
  const { styleId } = await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "image" });
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const plan = await ctx.page.$eval("#ts-style-plan", (e) => e.innerText);
  ctx.expect("el plan de estilo enumera los skins de personaje", /personaje/i.test(plan), plan.slice(0, 200));
  ctx.expect("el plan anuncia su coste antes de gastar", /\$/.test(plan), plan.slice(0, 200));
  await ctx.shot("plan-de-estilo");
  // Lo que el plan ANUNCIA al jugador (y por lo que le cobra): "(N personajes
  // × M anims)".
  const [, personajes, anims] = /\((\d+) personajes? × (\d+) anims?\)/.exec(plan) ?? [];
  const anunciados = Number(personajes ?? 0) * Number(anims ?? 0);
  ctx.expect("el plan dice cuántos skins va a pedir", anunciados > 0, `personajes=${personajes} anims=${anims}`);

  await ctx.page.click("#ts-style-run");
  // Se espera a que la corrida SE DECLARE TERMINADA (lo apunta el propio
  // StyleApplyController al acabar), no a que hayan llegado N peticiones antes
  // de que se agote un tope. La diferencia importa: contra el reloj, un batch
  // que se queda corto agota los 90 s y uno que se pasa no se nota. Con el
  // registro, las dos cosas se ven al terminar.
  const corrida = await esperarRegistro(
    ctx,
    "el batch de estilo termina",
    "estilo",
    () => (window.__nefan.estilo()?.done ? window.__nefan.estilo() : null),
    180_000,
  );
  ctx.log(`corrida de estilo: ${JSON.stringify(corrida)}`);
  // Los fallos se REGISTRAN, no se afirman: contra el bench, el motor falso
  // devuelve 500 en las anims para las que no tiene hoja (es su forma de
  // ejercitar la cancelación de la cola de skins del cliente), así que exigir
  // cero fallos aquí sería afirmar sobre el fake y no sobre el juego. Lo que
  // sí se exige es que un fallo de respuesta NO cambie lo que se pidió.
  if (corrida.failures.length) ctx.log(`fallos de la corrida (esperables en bench): ${corrida.failures.length}`);
  // Lo prometido == lo emitido == lo capturado por el cable. Tres números que
  // hasta ahora nadie cuadraba: "dijo 3 y pidió 2" pasaba de largo.
  ctx.expect(
    "el batch EMITE exactamente los skins que su plan anunció (si no, el coste que se cobró no es el que se gasta)",
    corrida.issued.skins === anunciados,
    `anunciados=${anunciados} emitidos=${corrida.issued.skins}`,
  );
  ctx.expect(
    "y por el cable salieron esos mismos, ni uno más",
    peticiones.length === corrida.issued.skins,
    `capturadas=${peticiones.length} emitidas=${corrida.issued.skins}`,
  );
  const batch = peticiones.map((p) => p.body);
  const corte = peticiones.length;

  // ── 2. Vía A: la partida ─────────────────────────────────────────────────
  await comenzar(ctx);
  // Igual que arriba: se espera a que la PARTIDA declare en su libro de skins
  // qué personajes ha pedido, no a que lleguen N peticiones antes de un tope.
  const libro = await esperarRegistro(
    ctx,
    "la partida apunta en su libro los skins que pide",
    "skins",
    () => (window.__nefan.skins.length > 0 ? window.__nefan.skins : null),
    120_000,
  );
  ctx.log(`libro de skins de la partida: ${JSON.stringify(libro)}`);
  const partida = peticiones.slice(corte).map((p) => p.body);
  ctx.expect("la partida pide el skin de sus NPCs", partida.length > 0, `${partida.length} peticiones`);
  // Contenido, no cardinales: dos conjuntos distintos del mismo tamaño pasaban.
  const promptsCable = [...new Set(partida.map((p) => p.prompt))].sort();
  const promptsLibro = [...new Set(libro.map((sk) => sk.prompt))].sort();
  ctx.expect(
    "y lo que pide por el cable son los MISMOS personajes que apuntó en su libro",
    JSON.stringify(promptsCable) === JSON.stringify(promptsLibro),
    `cable=${JSON.stringify(promptsCable)} libro=${JSON.stringify(promptsLibro)}`,
  );
  if (!batch.length || !partida.length) return;

  const npcs = await ctx.page.evaluate(() => window.__nefan.scene?.npcs ?? []);
  ctx.log(`NPCs de la escena: ${JSON.stringify(npcs.map((n) => n.id))}`);
  ctx.log(`batch:   ${clave(batch[0])}`);
  ctx.log(`partida: ${clave(partida[0])}`);

  // ── 3. Las dos vías derivan la MISMA clave ───────────────────────────────
  // Antes esto era una igualdad de CONJUNTOS batch↔partida, y era frágil por
  // construcción: el batch cubre TODAS las escenas del mundo pre-generado y la
  // partida solo el tile en el que está. Cuadra mientras el mundo tenga un
  // único personaje y se pone rojo, sin que haya bug, en cuanto otra escena
  // traiga uno. Se parte en las dos afirmaciones que de verdad importan, y las
  // dos son MÁS fuertes que la igualdad:
  //   (1) todo personaje de la partida está en el batch con la clave IDÉNTICA
  //       — el doble pago, que es el sujeto del guion, intacto;
  //   (2) el batch pide tantos personajes distintos como anunció su plan —
  //       su propio contrato, que la igualdad nunca comprobó.
  const idsBatch = [...new Set(batch.map(claveDePersonaje))].sort();
  const idsPartida = [...new Set(partida.map(claveDePersonaje))].sort();
  const huerfanos = idsPartida.filter((id) => !idsBatch.includes(id));
  ctx.expect(
    "todo personaje que pide la PARTIDA lo pre-generó el batch con la misma clave (si no, se paga dos veces)",
    huerfanos.length === 0,
    `sin gemelo en el batch: ${JSON.stringify(huerfanos)}\n      batch=${JSON.stringify(idsBatch)}`,
  );
  ctx.expect(
    "el batch pide tantos personajes distintos como anunció su plan",
    idsBatch.length === Number(personajes ?? 0),
    `distintos=${idsBatch.length} anunciados=${personajes}`,
  );
  // La comparación byte a byte es EL SUJETO del guion, y vivía en un bucle con
  // `continue` que podía iterar cero veces sin que nadie lo notara: si el batch
  // y la partida desalinean el `anim`, no hay gemela que encontrar, el bucle no
  // corre y el guion pasa en verde con el doble pago vivo. (`claveDePersonaje`
  // excluye `anim` a propósito, así que el aserto de huérfanos tampoco lo ve.)
  // Se cuenta cuántas parejas se han comparado de verdad y se exige que haya.
  let comparadas = 0;
  for (const p of partida) {
    const gemela = batch.find((b) => b.anim === p.anim && b.prompt === p.prompt);
    if (!gemela) continue; // el batch pide las 3 anims; la partida, las que necesita
    comparadas++;
    ctx.expect(
      `la clave de caché coincide byte a byte (${p.anim})`,
      clave(gemela) === clave(p),
      `${clave(gemela)}  vs  ${clave(p)}`,
    );
  }
  ctx.expect(
    "y esa comparación llegó a hacerse al menos una vez (con `anim` dentro de la clave)",
    comparadas > 0,
    `0 parejas (anim, prompt) en común entre batch y partida — ` +
      `batch=${JSON.stringify([...new Set(batch.map((b) => `${b.prompt}/${b.anim}`))])} ` +
      `partida=${JSON.stringify([...new Set(partida.map((p) => `${p.prompt}/${p.anim}`))])}`,
  );

  // ── 4. …y esa clave sale de los campos del NPC ───────────────────────────
  for (const p of partida) {
    const npc = npcs.find((n) => (n.description ?? n.name ?? n.id) === p.prompt);
    ctx.expect(`el prompt "${p.prompt}" es el de un NPC de la escena`, Boolean(npc), JSON.stringify(npcs));
    if (!npc) continue;
    ctx.expect("el estilo de la sesión entra en la clave", p.style_id === styleId, `${p.style_id} vs ${styleId}`);
    ctx.expect(
      "la petición lleva rol de personaje (sin él, el server los viste a todos de plebeyo)",
      typeof p.style_role === "string" && p.style_role.length > 0,
      JSON.stringify(p.style_role),
    );
    if (npc.style_ref) {
      ctx.expect(
        "la ref elegida por el motor es la que se pide",
        p.style_role === npc.style_ref,
        `${p.style_role} vs ${npc.style_ref}`,
      );
    }
  }
  await ctx.shot("partida-con-skins");

  // ── 5. Los campos del NPC sobreviven a formatDToWorld ────────────────────
  // Se sirve la fixture con un NPC que declara lo que el motor puede declarar
  // (y otro con basura), y se lee lo que llega al cliente. Sustitución en el
  // DATO de la escena, no en el código: es lo que vería el jugador si el motor
  // lo emitiese.
  await ctx.page.route(`**/${FIXTURE}.json*`, async (route) => {
    const texto = await (await route.fetch()).text();
    const escena = JSON.parse(readFileSync(FIXTURE_EN_DISCO, "utf8"));
    const npc = escena.entities.find((e) => e.kind === "npc");
    Object.assign(npc, { role: "guard", style_ref: "capitan_de_guardia", description: "Guardia con yelmo dorado" });
    const basura = { ...npc, id: `${npc.id}_basura`, cell: [npc.cell[0] + 2, npc.cell[1]], role: 42, style_ref: "", description: "" };
    escena.entities.push(basura);
    const cuerpo = JSON.stringify(escena);
    const esModulo = !texto.trimStart().startsWith("{");
    await route.fulfill(
      esModulo
        ? { body: `export default ${cuerpo};`, contentType: "application/javascript" }
        : { body: cuerpo, contentType: "application/json" },
    );
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await ctx.nefan("closeTitle");
  await ctx.nefan("loadFixture", FIXTURE);
  const declarados = await ctx.waitFor(
    "la escena con NPCs enriquecidos carga",
    () => {
      const ns = window.__nefan.scene?.npcs ?? [];
      const declarado = ns.find((n) => n.role);
      const basura = ns.find((n) => n.id.endsWith("_basura"));
      return declarado && basura ? { declarado, basura } : null;
    },
    20_000,
  ).catch(() => null);
  ctx.expect("los NPCs enriquecidos llegan al cliente", declarados !== null);
  if (!declarados) return;
  ctx.log(`declarado: ${JSON.stringify(declarados.declarado)} · basura: ${JSON.stringify(declarados.basura)}`);
  ctx.expect("`role` declarado viaja tal cual", declarados.declarado.role === "guard", String(declarados.declarado.role));
  ctx.expect("`style_ref` declarado viaja tal cual", declarados.declarado.style_ref === "capitan_de_guardia", String(declarados.declarado.style_ref));
  ctx.expect(
    "`description` declarada viaja tal cual",
    declarados.declarado.description === "Guardia con yelmo dorado",
    String(declarados.declarado.description),
  );
  ctx.expect("un `role` que no es cadena NO viaja", !("role" in declarados.basura), JSON.stringify(declarados.basura));
  ctx.expect("un `style_ref` vacío NO viaja", !("style_ref" in declarados.basura), JSON.stringify(declarados.basura));
  ctx.expect("una `description` vacía NO viaja", !("description" in declarados.basura), JSON.stringify(declarados.basura));
}

