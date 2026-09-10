/** LA FRONTERA QUE MOVIÓ #504 (PR 4 de #241): quién sabe con qué pega el
 *  jugador y sobre cuánta vida. Hasta hoy lo decidía el CLIENTE con dos
 *  literales (`main.ts`: `const playerMaxHp = 100`, `const playerWeaponId =
 *  "short_sword"`), así que el aro del telegraph dibujaba la espada corta
 *  pasara lo que pasara y la barra de vida dividía por 100 aunque el sim
 *  dijera otra cosa. Desde #504 los dos VIAJAN en cada `state_update` y el
 *  cliente solo los pinta.
 *
 *  LO QUE SE MIDE, y por qué hace falta un guion. El 84 ya afirma los cinco
 *  aros contra `getEffectiveParams` de core, pero con el arma FIJA con la que
 *  nace el jugador: si el cliente volviera a inventarse `short_sword` saldría
 *  igual de verde. Lo que ningún guion medía es la frontera: **si el bridge
 *  dice otra arma, ¿cambia el aro?, y si dice otro máximo, ¿cambia la barra?**
 *  Aquí el bridge dice `war_hammer` y 150, y los cinco aros pasan a ser los
 *  del martillo (espada y martillo difieren en los cinco: 1,3→1,8 · 1,7→2,5 ·
 *  1,7→2 · 1→1,4 · 1,5→1,9) y la barra de un jugador ENTERO deja de estar
 *  llena (100/150 = 66,7 %), que es justo lo que el jugador vería.
 *
 *  POR QUÉ EL ARMA ENTRA POR EL SOCKET Y NO POR EL JUEGO. `weapon_changed`
 *  (`store/reducers.ts`) sigue SIN PRODUCTOR: ningún camino del juego cambia
 *  hoy el arma del jugador —ni una consequence, ni el State API (el
 *  dispatcher de plugins solo escribe `gold/health/level/inventory` del
 *  NarrativeState), ni el save (el arma y el máximo viven en el `GameStore`
 *  del bridge, que es volátil)—, así que ejercerlo «con las manos» es
 *  imposible hasta que un plugin de equipo lo despache. Lo que sí se puede
 *  medir, y es lo que #504 movió, es que el CLIENTE siga al wire: el frame
 *  entra por el mismo `onmessage` que usa el bridge (patrón del espía del
 *  guion 35), con la forma exacta de `StateUpdateMessage`. Cuando exista el
 *  productor, este guion se reescribe para dispararlo y el aserto no cambia.
 *
 *  EL BLOQUE 1 NO ES DECORADO: antes de tocar nada afirma que el `state_update`
 *  REAL del bridge trae ya `playerMaxHp` y `playerWeaponId` vivos (100 y
 *  `short_sword`, los del `GameStore`). Sin él, los bloques 2 y 3 medirían un
 *  cliente que sigue a cualquier cosa que se le inyecte aunque el bridge no
 *  mandara el dato nunca.
 *
 *  EL BLOQUE 4 ES EL CONTROL. Volver a `short_sword`/100 y ver que los aros
 *  vuelven es lo que separa «el cliente sigue al wire» de «el cliente se quedó
 *  con el último aro que pintó».
 *
 *  PROBADO EN NEGATIVO (2026-09-07, QA de la PR 4): con
 *  `getCombatant("player")` de `net/game-client.ts` devolviendo otra vez
 *  `weaponId: "short_sword"` fijo, los cinco asertos del martillo salen rojos
 *  (aro 1.3 · core 1.8, …) y el control sigue verde; con la barra dividiendo
 *  por `100` en vez de por `result.playerMaxHp`, cae el aserto del máximo
 *  (ancho 100 % · esperado 66.6667 %).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, `charMode: "vector"` (sin skins),
 *  y ni un mensaje al motor: los frames inyectados son locales al navegador.
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** El arma con la que nace el jugador (`src/store/game-store.ts`), que es la
 *  única fuente del literal desde #504. */
const ARMA_DE_ARRANQUE = "short_sword";
/** La que dice el bridge en los bloques 2 y 3. Es del `combat_config.json`
 *  real y difiere de la de arranque en los CINCO ataques. */
const ARMA_NUEVA = "war_hammer";
const MAXIMO_NUEVO = 150;

/** La referencia de core: `getEffectiveParams` por arma, o `null` si
 *  `nefan-core/dist` no está construido. */
async function referenciaDeCore() {
  try {
    const { getEffectiveParams, loadConfig } = await import(
      path.join(RAIZ, "nefan-core", "dist", "src", "combat", "combat-data.js")
    );
    const config = loadConfig(
      JSON.parse(readFileSync(path.join(RAIZ, "nefan-core", "data", "combat_config.json"), "utf8")),
    );
    return (tipo, arma) => getEffectiveParams(tipo, config.attack_types, config.weapons[arma]);
  } catch (err) {
    return { error: String(err) };
  }
}

/** Espía del wire: se queda con los `state_update` que manda el bridge y, si
 *  se le pide, REESCRIBE el arma y el máximo del jugador antes de entregarlos
 *  por el mismo `onmessage` que el cliente tiene puesto. No toca ni una línea
 *  de producción: el seam es el que ya existe (`bridge-client.ts` asigna
 *  `this.ws.onmessage`). Hay que instalarlo ANTES de que cargue la app. */
async function instalarElEspiaDelWire(ctx) {
  await ctx.page.addInitScript(() => {
    const Original = window.WebSocket;
    window.__qaWire = { ultimoOriginal: null, vistos: 0, reescritos: 0, reescribir: null };
    const Envuelto = function (...args) {
      const sock = new Original(...args);
      let real = null;
      Object.defineProperty(sock, "onmessage", {
        get: () => real,
        set: (fn) => {
          real = fn;
        },
        configurable: true,
      });
      sock.addEventListener("message", (ev) => {
        if (!real) return;
        let msg = null;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          real(ev);
          return;
        }
        if (msg?.type !== "state_update") {
          real(ev);
          return;
        }
        const w = window.__qaWire;
        w.vistos++;
        w.ultimoOriginal = {
          playerHp: msg.playerHp,
          playerMaxHp: msg.playerMaxHp,
          playerWeaponId: msg.playerWeaponId,
          tieneMaximo: Object.prototype.hasOwnProperty.call(msg, "playerMaxHp"),
          tieneArma: Object.prototype.hasOwnProperty.call(msg, "playerWeaponId"),
        };
        if (!w.reescribir) {
          real(ev);
          return;
        }
        msg.playerWeaponId = w.reescribir.arma;
        msg.playerMaxHp = w.reescribir.maximo;
        w.reescritos++;
        real({ data: JSON.stringify(msg) });
      });
      return sock;
    };
    Envuelto.prototype = Original.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Envuelto[k] = Original[k];
    window.WebSocket = Envuelto;
  });
}

/** Lo que dice el bridge que el jugador lleva, tal cual salió del socket. */
const delWire = async (ctx) => ctx.page.evaluate(() => window.__qaWire.ultimoOriginal);

/** La barra de vida del HUD: el ancho que pinta `main.ts` (hp / máximo), el
 *  número —que es el hp a secas— y su DENOMINADOR (#527).
 *
 *  Son dos nodos y no uno a propósito: `#player-hp-text` sigue siendo UN número
 *  (es lo que leen este guion y `qa/lib/combate.mjs` para saber si el jugador
 *  vive) y `#player-hp-max` lleva el « / máximo» que el jugador lee. Con un
 *  máximo distinto de 100 el HUD decía «100» con la barra a dos tercios. */
const barraDeVida = async (ctx) =>
  ctx.page.evaluate(() => ({
    ancho: document.getElementById("player-hp").style.width,
    texto: document.getElementById("player-hp-text").textContent,
    maximo: document.getElementById("player-hp-max")?.textContent ?? null,
    // Lo que se LEE de un vistazo, los dos nodos juntos y sin espacios de más.
    leido: (document.getElementById("player-hp").parentElement.parentElement.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  }));

/** Ataca con cada ataque del catálogo y devuelve la distancia óptima del aro
 *  que se pintó, leída del episodio del telegraph (sobrevive al episodio, a
 *  diferencia de la foto `telegraph`). Se ataca al aire a propósito: el aro se
 *  dibuja con objetivo o sin él. */
async function arosDeLosCinco(ctx, catalogo) {
  const aros = [];
  for (let i = 0; i < catalogo.length; i++) {
    const tipo = catalogo[i];
    await ctx.page.keyboard.press(String(i + 1));
    const antes = (await ctx.nefan("fps")).telegraphEpisode?.episode ?? 0;
    await ctx.page.mouse.down();
    await ctx.page.mouse.up();
    const { ultimo: ep } = await ctx.expectEspera(
      `LMB con «${tipo}» abre y cierra un episodio del telegraph`,
      true,
      (n) => {
        const ep = window.__nefan.fps().telegraphEpisode;
        return ep && ep.episode > n && ep.ended ? ep : null;
      },
      { ms: 10_000, arg: antes },
    );
    aros.push({ tipo, optima: ep?.optimalDistance ?? null });
  }
  return aros;
}

/** Foto del aro VIVO: el episodio del telegraph sobrevive al ataque, pero el
 *  dibujo no, así que una captura de después enseña el HUD y ningún aro. Se
 *  ataca con `heavy` —el wind-up más largo con las dos armas (1,19 s / 1,68 s),
 *  así que da tiempo a la foto sin sincronizar con nada— y se captura mientras
 *  el aro está en pantalla. El aserto no es la foto: es que el aro se VE
 *  mientras dura el wind-up, con su alcance leído del renderer. */
async function fotoDelAro(ctx, catalogo, etiqueta) {
  const i = catalogo.indexOf("heavy");
  await ctx.page.keyboard.press(String(i + 1));
  await ctx.page.mouse.down();
  await ctx.page.mouse.up();
  const { ultimo: vivo } = await ctx.expectEspera(
    `el aro de «heavy» se VE mientras dura el wind-up (${etiqueta})`,
    true,
    () => {
      const t = window.__nefan.fps().telegraph;
      return t ? { alcance: t.alcance, modo: t.mode ?? null } : null;
    },
    { ms: 5_000 },
  );
  await ctx.shot(`aro-vivo-${etiqueta}`);
  ctx.log(`aro «heavy» ${etiqueta}: alcance ${JSON.stringify(vivo?.alcance)}`);
  // El episodio se abre en el flanco null→aro (`setAttackTelegraph`): si este
  // ataque sigue vivo, el SIGUIENTE no abre episodio nuevo y su espera expira
  // midiendo un reloj en vez del aro. Se cierra antes de devolver.
  await ctx.expectEspera(
    `el ataque de la foto termina antes de seguir (${etiqueta})`,
    true,
    () => (window.__nefan.fps().telegraph === null ? true : null),
    { ms: 10_000 },
  );
  return vivo;
}

export default async function (ctx) {
  const core = await referenciaDeCore();
  if (typeof core !== "function") {
    ctx.sinMedir(`sin \`nefan-core/dist\` no hay referencia del aro (cd nefan-core && npm run build): ${core.error}`);
  }

  // ── 0 · Teclado real y espía del wire, los dos ANTES de la app ───────────
  await instalarElEspiaDelWire(ctx);
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input"); // como el 84: las teclas 1..N son del proveedor de teclado
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca con el espía del wire puesto", () =>
    Boolean(window.__nefan && window.__qaWire),
  );
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  const st = await ctx.nefan("state");
  const catalogo = st.attackCatalog;
  ctx.expect("la partida trae el catálogo estándar (5 ataques)", catalogo.length === 5, catalogo.join(","));

  // ── 1 · El dato VIAJA: lo que manda el bridge, sin tocarlo ───────────────
  const { ultimo: wire } = await ctx.expectEspera(
    "el `state_update` del bridge trae el arma y el máximo del jugador (#504)",
    true,
    () => {
      const u = window.__qaWire.ultimoOriginal;
      return u && u.tieneArma && u.tieneMaximo ? u : null;
    },
    { ms: 20_000 },
  );
  ctx.log(`wire: playerHp=${wire?.playerHp} playerMaxHp=${wire?.playerMaxHp} playerWeaponId=${JSON.stringify(wire?.playerWeaponId)}`);
  ctx.expect(
    `el arma que viaja es la del store del bridge (${ARMA_DE_ARRANQUE}) y el máximo es un número > 0`,
    wire?.playerWeaponId === ARMA_DE_ARRANQUE && typeof wire?.playerMaxHp === "number" && wire.playerMaxHp > 0,
    JSON.stringify(wire),
  );

  // El ratón capturado: sin pointer lock el LMB no ataca, solo captura.
  await ctx.page.click("#fps-canvas", { position: { x: 400, y: 300 } });
  await ctx.expectEspera(
    "el click en el mundo captura el ratón (sin él, el LMB no ataca)",
    true,
    () => (window.__nefan.puedeAtacar().ok ? true : null),
    { ms: 10_000 },
  );

  // ── 2 · Con el arma de arranque: aro de espada y barra llena ─────────────
  const conEspada = await arosDeLosCinco(ctx, catalogo);
  const malosEspada = conEspada.filter((a) => Math.abs(a.optima - core(a.tipo, ARMA_DE_ARRANQUE).optimal_distance) >= 1e-6);
  ctx.expect(
    `los cinco aros son los que core calcula para ${ARMA_DE_ARRANQUE}`,
    malosEspada.length === 0,
    conEspada.map((a) => `${a.tipo} ${a.optima}/${core(a.tipo, ARMA_DE_ARRANQUE).optimal_distance}`).join(" · "),
  );
  const vidaEntera = await barraDeVida(ctx);
  ctx.expect(
    "el jugador entero: la barra está llena y el número es su vida",
    vidaEntera.ancho === "100%" && Number(vidaEntera.texto) === Math.ceil(wire.playerHp),
    JSON.stringify(vidaEntera),
  );
  ctx.expect(
    `…y lleva su DENOMINADOR, el máximo que dice el bridge (#527): «/ ${Math.ceil(wire.playerMaxHp)}»`,
    vidaEntera.maximo === ` / ${Math.ceil(wire.playerMaxHp)}`,
    JSON.stringify(vidaEntera),
  );
  const aroEspada = await fotoDelAro(ctx, catalogo, "espada");
  await ctx.shot("aro-y-barra-con-el-arma-de-arranque");

  // ── 3 · El bridge dice OTRA arma y OTRO máximo ───────────────────────────
  await ctx.page.evaluate(
    ([arma, maximo]) => {
      window.__qaWire.reescritos = 0;
      window.__qaWire.reescribir = { arma, maximo };
    },
    [ARMA_NUEVA, MAXIMO_NUEVO],
  );
  await ctx.expectEspera(
    `el cliente recibe frames con ${ARMA_NUEVA} y máximo ${MAXIMO_NUEVO}`,
    true,
    () => (window.__qaWire.reescritos > 0 ? true : null),
    { ms: 10_000 },
  );

  const conMartillo = await arosDeLosCinco(ctx, catalogo);
  const malosMartillo = conMartillo.filter((a) => Math.abs(a.optima - core(a.tipo, ARMA_NUEVA).optimal_distance) >= 1e-6);
  ctx.expect(
    `el aro SIGUE al arma del wire: los cinco son los de ${ARMA_NUEVA}`,
    malosMartillo.length === 0,
    conMartillo.map((a) => `${a.tipo} ${a.optima}/${core(a.tipo, ARMA_NUEVA).optimal_distance}`).join(" · "),
  );
  ctx.expect(
    "y ninguno de los cinco coincide con el de la espada (si coincidieran, el arma podría estar ignorándose)",
    conMartillo.every((a, i) => Math.abs(a.optima - conEspada[i].optima) > 1e-6),
    conMartillo.map((a, i) => `${a.tipo} ${conEspada[i].optima}→${a.optima}`).join(" · "),
  );

  const vidaSobreOtroMaximo = await barraDeVida(ctx);
  const hpVivo = Number(vidaSobreOtroMaximo.texto);
  const anchoEsperado = `${Math.max(0, (hpVivo / MAXIMO_NUEVO) * 100)}%`;
  ctx.expect(
    `la barra divide por el máximo que viaja (${MAXIMO_NUEVO}): un jugador entero deja de estar lleno`,
    vidaSobreOtroMaximo.ancho !== "100%" &&
      Math.abs(parseFloat(vidaSobreOtroMaximo.ancho) - (hpVivo / MAXIMO_NUEVO) * 100) < 0.5,
    `ancho ${vidaSobreOtroMaximo.ancho} · esperado ≈ ${anchoEsperado} (hp ${hpVivo})`,
  );
  ctx.expect(
    "y el NÚMERO sigue siendo la vida, no el porcentaje",
    Number.isFinite(hpVivo) && hpVivo > 0,
    JSON.stringify(vidaSobreOtroMaximo),
  );
  // EL PUNTO DE #527. Con la barra a dos tercios y el número diciendo «100», lo
  // que el jugador leía no decía nada: 100 ¿de cuánto? El denominador es lo que
  // desambigua, y tiene que seguir al wire igual que la barra.
  ctx.expect(
    `el HUD enseña «vida / máximo» con el máximo que viaja: «${hpVivo} / ${MAXIMO_NUEVO}»`,
    vidaSobreOtroMaximo.maximo === ` / ${MAXIMO_NUEVO}` &&
      vidaSobreOtroMaximo.leido.endsWith(`${hpVivo} / ${MAXIMO_NUEVO}`),
    JSON.stringify(vidaSobreOtroMaximo),
  );
  await ctx.shot("vida-sobre-otro-maximo");
  const aroMartillo = await fotoDelAro(ctx, catalogo, "martillo");
  ctx.expect(
    "el ALCANCE dibujado también cambia con el arma (el aro se ve más lejos con el martillo)",
    Boolean(aroEspada && aroMartillo) && aroMartillo.alcance.lejos > aroEspada.alcance.lejos,
    `espada ${JSON.stringify(aroEspada?.alcance)} · martillo ${JSON.stringify(aroMartillo?.alcance)}`,
  );
  await ctx.shot("aro-y-barra-con-el-arma-que-dice-el-bridge");

  // ── 4 · Control: el bridge vuelve a su arma y el cliente vuelve con él ───
  await ctx.page.evaluate(() => {
    window.__qaWire.reescritos = 0;
    window.__qaWire.reescribir = null;
  });
  await ctx.expectEspera(
    "vuelven a llegar frames sin reescribir",
    true,
    () => (window.__qaWire.ultimoOriginal ? true : null),
    { ms: 10_000 },
  );
  const deVuelta = await arosDeLosCinco(ctx, catalogo);
  ctx.expect(
    "al volver el arma del bridge, los cinco aros vuelven con ella (el cliente no se queda con el último)",
    deVuelta.every((a) => Math.abs(a.optima - core(a.tipo, ARMA_DE_ARRANQUE).optimal_distance) < 1e-6),
    deVuelta.map((a) => `${a.tipo} ${a.optima}`).join(" · "),
  );
  const vidaDeVuelta = await barraDeVida(ctx);
  ctx.expect(
    "y la barra vuelve a llenarse con el máximo del bridge",
    vidaDeVuelta.ancho === "100%",
    JSON.stringify(vidaDeVuelta),
  );
  ctx.expect(
    `y el denominador vuelve con ella («/ ${Math.ceil(wire.playerMaxHp)}»): no se queda con el último que pintó`,
    vidaDeVuelta.maximo === ` / ${Math.ceil(wire.playerMaxHp)}`,
    JSON.stringify(vidaDeVuelta),
  );
}
