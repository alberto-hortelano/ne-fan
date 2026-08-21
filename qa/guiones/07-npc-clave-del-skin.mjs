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
import { backendEsFalso, nuevaPartida, comenzar } from "../lib/sesion.mjs";

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
  ctx.expect(
    "el backend de IA es el falso del preset 5 (este guion dispara generación)",
    await backendEsFalso(ctx),
    "sin fake-ai-server este guion gastaría créditos: no se ejecuta",
  );
  if (!(await backendEsFalso(ctx))) return;

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

  // ── 1. Vía B: el batch de estilo, desde el título ────────────────────────
  const { styleId } = await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "image" });
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const plan = await ctx.page.$eval("#ts-style-plan", (e) => e.innerText);
  ctx.expect("el plan de estilo enumera los skins de personaje", /personaje/i.test(plan), plan.slice(0, 200));
  ctx.expect("el plan anuncia su coste antes de gastar", /\$/.test(plan), plan.slice(0, 200));
  await ctx.shot("plan-de-estilo");
  // Cuántos skins anuncia el plan: "(N personajes × M anims)". Se espera por
  // ESE número de peticiones, no por un tiempo de pared.
  const [, personajes, anims] = /\((\d+) personajes? × (\d+) anims?\)/.exec(plan) ?? [];
  const esperadas = Number(personajes ?? 0) * Number(anims ?? 0);
  ctx.expect("el plan dice cuántos skins va a pedir", esperadas > 0, `personajes=${personajes} anims=${anims}`);
  await ctx.page.click("#ts-style-run");
  const hayBatch = await esperarPeticiones(ctx, peticiones, esperadas || 1, 90_000);
  ctx.expect("el batch de estilo pide los skins que anunció", hayBatch, `${peticiones.length}/${esperadas} peticiones`);
  const batch = peticiones.map((p) => p.body);
  const corte = peticiones.length;

  // ── 2. Vía A: la partida ─────────────────────────────────────────────────
  await comenzar(ctx);
  await esperarPeticiones(ctx, peticiones, corte + 1, 60_000);
  const partida = peticiones.slice(corte).map((p) => p.body);
  ctx.expect("la partida pide el skin de sus NPCs", partida.length > 0, `${partida.length} peticiones`);
  if (!batch.length || !partida.length) return;

  const npcs = await ctx.page.evaluate(() => window.__nefan.scene?.npcs ?? []);
  ctx.log(`NPCs de la escena: ${JSON.stringify(npcs.map((n) => n.id))}`);
  ctx.log(`batch:   ${clave(batch[0])}`);
  ctx.log(`partida: ${clave(partida[0])}`);

  // ── 3. Las dos vías derivan la MISMA clave ───────────────────────────────
  const idsBatch = [...new Set(batch.map(claveDePersonaje))].sort();
  const idsPartida = [...new Set(partida.map(claveDePersonaje))].sort();
  ctx.expect(
    "partida y batch piden EXACTAMENTE los mismos personajes vestidos (si no, se paga dos veces)",
    JSON.stringify(idsBatch) === JSON.stringify(idsPartida),
    `batch=${JSON.stringify(idsBatch)}\n      partida=${JSON.stringify(idsPartida)}`,
  );
  for (const p of partida) {
    const gemela = batch.find((b) => b.anim === p.anim && b.prompt === p.prompt);
    if (!gemela) continue; // el batch pide las 3 anims; la partida, las que necesita
    ctx.expect(
      `la clave de caché coincide byte a byte (${p.anim})`,
      clave(gemela) === clave(p),
      `${clave(gemela)}  vs  ${clave(p)}`,
    );
  }

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

/** Espera a que haya al menos `n` peticiones capturadas. No es un sleep: la
 *  condición es el número de peticiones, y el tope solo evita colgarse. */
async function esperarPeticiones(ctx, buffer, n, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (buffer.length >= n) return true;
    await ctx.page.waitForTimeout(200);
  }
  return buffer.length >= n;
}
