/** La DESVIACIÓN que sostiene la PR 3 de #346: «Crear mundo» salió del título
 *  a `ui/titulo/crear-mundo.ts` y su navegación de vuelta dejó de ser una
 *  llamada a un método (`await this.renderWorldSelect(created.gameId)`) para
 *  ser un callback (`await deps.ir({ a: "selector", preselect: created.gameId })`).
 *
 *  El plan §4 escribió ese callback como `ir(destino): void` con un `paso()`
 *  dentro. El ingeniero se desvió a `Promise<void>` con un argumento medido:
 *  ese `await` está DENTRO del `try` de `crearElMundo()`, así que con la firma
 *  `void` el repintado se vuelve fire-and-forget y **un fallo del repintado
 *  deja de aterrizar en el `catch`** que pinta «No se pudo crear el mundo: …»
 *  y devuelve los dos botones. El jugador que hoy ve un motivo y puede volver
 *  a intentarlo se quedaría mirando «Mundo creado: …» con «Crear mundo» y
 *  «← Volver» apagados para siempre: su mundo SÍ existe, pero la pantalla no
 *  se lo dice y no tiene salida (el registro de errores, donde iría a parar el
 *  rechazo por `paso()`, está tapado por CSS mientras el título está delante,
 *  #246/#306).
 *
 *  Ningún guion medía nada de esto. El 92 mide el borrador que se RECHAZA
 *  (bloques E y F: nunca se llega a crear), el 94 pasa por la pantalla a mirar
 *  su CSS, y el resto del título no la toca. El camino de ÉXITO de «Crear
 *  mundo» —el que crea un mundo de verdad y encadena el selector— no lo
 *  conducía nadie.
 *
 *  Aquí se conduce entero, y con el fallo provocado SIN estado sintético:
 *
 *   **A · la pantalla, antes de nada.** «Crear mundo» con los dos botones
 *   pulsables y sin motivo escrito. Sin esto, «los botones vuelven» de B
 *   podría estar midiendo unos botones que nunca se apagaron.
 *
 *   **B · el fallo del repintado aterriza en el catch.** El `data/games` de
 *   ESTA corrida se deja en `-wx` (escribible y atravesable, NO listable):
 *   `create_game` sigue pudiendo escribir el mundo nuevo y `list_games`
 *   revienta al leer el directorio. Es el estado que el bridge ya sabe
 *   contestar —`games_dir_unreadable: …`, `bridge/handlers/session.ts`— y le
 *   pasa a cualquiera con un `data/games` que se quedó sin permisos o en un
 *   disco que se desmontó. Lo que tiene que ocurrir: el mundo se CREA (queda
 *   en disco), la pantalla dice «No se pudo crear el mundo: …» con el motivo
 *   del bridge dentro, los DOS botones vuelven, y seguimos en «Crear mundo»
 *   (el selector no se pintó). Con `ir` de tipo `void` los tres últimos se
 *   caen a la vez.
 *
 *   **C · el camino bueno, y el `preselect`.** Con los permisos devueltos, el
 *   mismo botón crea otro mundo y ESTA VEZ el selector se pinta con el mundo
 *   recién creado SELECCIONADO — que es lo que significa el
 *   `preselect: created.gameId` del encadenado, y lo único que distingue
 *   `ir({a:"selector", preselect})` de `ir({a:"selector"})`.
 *
 *   **D · las hojas no dejan nada colgado.** El riesgo 4 del plan de #346: una
 *   fuga de listener no la ve ningún test verde, y la señal medible sin API de
 *   listeners es que el CHASIS siga siendo uno solo después de entrar y salir
 *   de las pantallas cinco veces —`#title-screen-responsive`, `#ts-mas` y
 *   `#ts-close` uno cada uno, y `#title-screen` con sus tres hijos—. Las dos
 *   hojas de esta PR solo enganchan a nodos que ellas mismas crean dentro de
 *   `content`, que `innerHTML` destruye al repintar; si alguna se atara al
 *   chasis, al `document` o a la `window`, este bloque no lo vería, pero un
 *   chasis duplicado o un hijo de más sí. Va aquí porque son las dos pantallas
 *   que esta PR movió; las PR 4, 5 y 6 tendrán que volver a medirlo con las
 *   suyas.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el mundo lo desarrolla el
 *  fake-ai-server (`/develop_world` → «Mundo del Bench»); la pre-generación se
 *  DESMARCA a propósito — no aporta a lo que se mide y encolaría trabajo del
 *  bridge que sobrevive al guion.
 */
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { esperarTituloListo } from "../lib/sesion.mjs";

export const aisla = ["saves"];

/** Un borrador que pasa `validarBorrador` (≥ 20 caracteres útiles) en las dos
 *  puntas: lo que se mide aquí es lo que pasa DESPUÉS de crear, así que el
 *  borrador tiene que ser válido sin discusión. */
const BORRADOR =
  "Un archipiélago de islas voladoras ancladas por cadenas gigantes, con clanes de pastores de nubes.";

/** Los mundos de usuario que hay en el `data/games` de la corrida. El bridge
 *  los escribe con prefijo `user_` (`handleCreateGame`), y son los únicos que
 *  este guion crea. */
function mundosDeUsuario(games) {
  return readdirSync(games).filter((d) => d.startsWith("user_")).sort();
}

/** Lo que la pantalla de «Crear mundo» enseña ahora mismo: el motivo escrito y
 *  si los dos botones se pueden pulsar. */
function estadoDeLaPantalla(page) {
  return page.evaluate(() => {
    const st = document.getElementById("ts-create-status");
    const crear = document.getElementById("ts-create");
    const volver = document.getElementById("ts-back");
    return {
      enCrearMundo: Boolean(document.getElementById("ts-draft")),
      enSelector: Boolean(document.querySelector("[data-game-id]")),
      motivo: st ? st.textContent.trim() : null,
      crearPulsable: crear ? !crear.disabled : null,
      volverPulsable: volver ? !volver.disabled : null,
    };
  });
}

/** Rellena el borrador, desmarca la pre-generación y pulsa «Crear mundo». */
async function crearElMundo(ctx) {
  await ctx.page.fill("#ts-draft", BORRADOR);
  await ctx.page.uncheck("#ts-pregen");
  await ctx.page.click("#ts-create");
}

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  const games = tmp ? join(tmp, "games") : null;
  if (!games || !existsSync(games)) {
    ctx.sinMedir(
      "sin disco efímero (QA_RUN_TMP) no hay un `data/games` propio de esta corrida: dejar sin " +
        "permisos de lectura el del checkout le rompería los mundos al usuario, y crear mundos " +
        "de verdad se los dejaría escritos",
    );
  }

  // ── A · la pantalla, antes de nada ──────────────────────────────────────
  await esperarTituloListo(ctx);
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click("#ts-create-world");
  await ctx.page.waitForSelector("#ts-draft", { timeout: 30_000 });

  // La pantalla LIMPIA, antes de escribir nada: es la foto que se compara
  // contra la del árbol de antes del corte (nada variable dentro).
  await ctx.shot("crear-mundo-limpia");
  const antes = await estadoDeLaPantalla(ctx.page);
  ctx.expect(
    "A · «Crear mundo» abre con los dos botones pulsables y sin motivo escrito",
    antes.crearPulsable === true && antes.volverPulsable === true && antes.motivo === "",
    JSON.stringify(antes),
  );
  const usuariosAlEmpezar = mundosDeUsuario(games);
  ctx.log(`mundos de usuario al empezar: ${usuariosAlEmpezar.join(", ") || "(ninguno)"}`);

  // ── B · el fallo del repintado aterriza en el catch ──────────────────────
  try {
    // `-wx`: se puede escribir dentro y atravesar, no LISTAR. `create_game`
    // (existsSync + mkdirSync + writeFileSync) pasa; `listGames` (readdirSync)
    // revienta con EACCES y el bridge contesta `games_dir_unreadable: …`.
    chmodSync(games, 0o300);
    let listable = true;
    try {
      readdirSync(games);
    } catch {
      listable = false;
    }
    ctx.expect(
      "B · precondición: el `data/games` de la corrida deja de ser listable (si no, no hay fallo que medir)",
      listable === false,
      `readdirSync("${games}") ${listable ? "siguió funcionando" : "falló, como se quería"}`,
    );

    await crearElMundo(ctx);
    // El umbral se escribe UNA vez: si la pantalla nunca escribe un motivo, la
    // expiración ES el fallo y lo dice aquí, no en un `catch` mudo.
    await ctx.expectEspera(
      "B · la pantalla acaba escribiendo un motivo (con `ir` de tipo void se queda en «Mundo creado»)",
      true,
      () => (document.getElementById("ts-create-status")?.textContent ?? "").includes("No se pudo"),
      { ms: 60_000 },
    );
    const roto = await estadoDeLaPantalla(ctx.page);
    ctx.log(`pantalla tras el fallo: ${JSON.stringify(roto)}`);
    await ctx.shot("crear-mundo-con-el-repintado-roto");

    chmodSync(games, 0o755);
    const creados = mundosDeUsuario(games).filter((d) => !usuariosAlEmpezar.includes(d));
    ctx.expect(
      "B · el mundo SÍ se creó (o sea: el fallo fue el repintado, no `create_game`)",
      creados.length === 1,
      `mundos nuevos: ${creados.join(", ") || "(ninguno)"}`,
    );
    ctx.expect(
      "B · la pantalla dice «No se pudo crear el mundo» con el motivo del bridge dentro",
      roto.motivo !== null &&
        roto.motivo.includes("No se pudo crear el mundo") &&
        roto.motivo.includes("games_dir_unreadable"),
      `motivo: «${roto.motivo}»`,
    );
    ctx.expect(
      "B · los DOS botones vuelven a ser pulsables",
      roto.crearPulsable === true && roto.volverPulsable === true,
      `crear=${roto.crearPulsable} volver=${roto.volverPulsable}`,
    );
    ctx.expect(
      "B · y seguimos en «Crear mundo»: el selector no llegó a pintarse",
      roto.enCrearMundo === true && roto.enSelector === false,
      JSON.stringify({ enCrearMundo: roto.enCrearMundo, enSelector: roto.enSelector }),
    );
  } finally {
    chmodSync(games, 0o755);
  }

  // ── C · el camino bueno, y el `preselect` ───────────────────────────────
  const antesDeC = mundosDeUsuario(games);
  await crearElMundo(ctx);
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 120_000 });
  const nuevo = mundosDeUsuario(games).filter((d) => !antesDeC.includes(d));
  ctx.expect(
    "C · el camino bueno crea un mundo y ACABA en el selector",
    nuevo.length === 1,
    `mundos nuevos: ${nuevo.join(", ") || "(ninguno)"}`,
  );
  const seleccionado = await ctx.page.evaluate(() =>
    [...document.querySelectorAll("[data-game-id]")]
      .filter((c) => c.style.borderColor === "rgb(221, 170, 102)")
      .map((c) => c.dataset.gameId),
  );
  ctx.expect(
    "C · el mundo recién creado viene SELECCIONADO (eso es el `preselect` del encadenado)",
    nuevo.length === 1 && seleccionado.length === 1 && seleccionado[0] === nuevo[0],
    `creado ${nuevo.join(",") || "(ninguno)"} · seleccionado ${seleccionado.join(",") || "(ninguno)"}`,
  );
  await ctx.shot("selector-con-el-mundo-recien-creado");

  // ── D · las hojas no dejan nada colgado ─────────────────────────────────
  const chasis = () =>
    ctx.page.evaluate(() => ({
      responsive: document.querySelectorAll("#title-screen-responsive").length,
      mas: document.querySelectorAll("#ts-mas").length,
      close: document.querySelectorAll("#ts-close").length,
      hijos: document.getElementById("title-screen")?.children.length ?? null,
    }));
  const alEmpezarD = await chasis();
  for (let i = 0; i < 5; i++) {
    // Ida y vuelta por «Crear mundo»…
    await ctx.page.click("#ts-create-world");
    await ctx.page.waitForSelector("#ts-draft", { timeout: 30_000 });
    await ctx.page.click("#ts-back");
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
    // …y por «Crear personaje», que es la otra hoja de esta PR.
    await ctx.page.click("#ts-continue");
    await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
    await ctx.page.click("#ts-back");
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  }
  const tras5 = await chasis();
  ctx.log(`chasis antes ${JSON.stringify(alEmpezarD)} · tras 5 idas y vueltas ${JSON.stringify(tras5)}`);
  ctx.expect(
    "D · tras 5 idas y vueltas por las DOS hojas, el chasis sigue siendo uno solo",
    tras5.responsive === 1 && tras5.mas === 1 && tras5.close === 1,
    JSON.stringify(tras5),
  );
  ctx.expect(
    "D · y `#title-screen` conserva sus tres hijos (content, #ts-mas, #ts-close)",
    tras5.hijos === 3 && alEmpezarD.hijos === 3,
    `antes ${alEmpezarD.hijos} · después ${tras5.hijos}`,
  );
}
