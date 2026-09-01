/** UN solo contexto WebGL en la pestaña — el criterio central de "solo la
 *  vista 3D".
 *
 *  No se comprueba con `grep`: se cuenta en RUNTIME. La sonda envuelve
 *  `HTMLCanvasElement.prototype.getContext` ANTES de que cargue la app
 *  (addInitScript + reload) y anota cada canvas que obtiene un contexto
 *  webgl/webgl2. Un mismo canvas devuelve siempre el mismo contexto, así que
 *  se cuentan CANVAS, no llamadas.
 *
 *  Probado en NEGATIVO: sobre el árbol anterior a esta PR (4764f91, con el
 *  renderer oblicuo vivo) la misma sonda contaba **2** — `#fps-canvas` y el
 *  singleton offscreen del clay (un canvas sin id fuera del DOM), con
 *  `["game", "fps-canvas"]` en la página. Una sonda que solo supiera decir
 *  "1" no demostraría nada.
 *
 *  Por qué un guion permanente y no una medida de un solo uso: la regla de
 *  fronteras `three-solo-en-fps-gl` sujeta el lado de los IMPORTS, pero no
 *  impide que fps-gl abra un segundo renderer, ni que alguien monte un
 *  WebGLRenderer desde una dependencia. Esto sí.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

export default async function (ctx) {
  await ctx.page.addInitScript(() => {
    window.__ctxProbe = [];
    window.__ctxCanvases = [];
    const anota = (canvas, type) => {
      if (canvas.__probeSeen) return;
      canvas.__probeSeen = true;
      window.__ctxProbe.push({ id: canvas.id || "(sin id)", type: String(type) });
      window.__ctxCanvases.push(canvas);
    };
    const envolver = (proto, nombre) => {
      if (!proto) return;
      const orig = proto.getContext;
      proto.getContext = function (type, ...rest) {
        const res = orig.call(this, type, ...rest);
        if (res && /webgl/i.test(String(type))) anota(this, `${nombre}:${type}`);
        return res;
      };
    };
    envolver(HTMLCanvasElement.prototype, "canvas");
    envolver(typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas.prototype : null, "offscreen");
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));

  // Partida REAL desde el título, no una fixture: el mundo entero (tile,
  // atlas, sprites) tiene que estar en pie para que un segundo contexto, si
  // lo hubiera, ya se hubiese abierto.
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  // Esperar a que el mundo 3D esté montado: three entra por import dinámico y
  // contar antes de que llegue daría 0 en cualquier árbol.
  await ctx.waitFor(
    "hay al menos un contexto WebGL (el del mundo)",
    () => (window.__ctxProbe.length > 0 ? window.__ctxProbe : null),
    60_000,
  );
  // Y andar un poco: cubre cualquier creación perezosa de contexto (en el
  // árbol viejo el clay del tile se componía al añadirlo, así que el segundo
  // ya estaba ahí antes de moverse).
  //
  // OJO A LA TECLA. Esto llevaba desde el 21-ago (94b8522) escrito
  // `holdUntil("el jugador se mueve", "el jugador se mueve", …)`: la firma es
  // `(key, desc, …)`, así que `press()` escribía `state["el jugador se
  // mueve"]` y NUNCA `state.up`. La condición era imposible, quemaba los 15 s
  // enteros en cada corrida, no cubría nada — y salía verde, porque nadie
  // miraba la expiración. Es el caso más puro de #261 en el árbol: un sleep
  // con mejores modales. Ahora la espera se AFIRMA: si el jugador no anda, el
  // guion lo dice en vez de fingir que lo comprobó.
  await ctx.expectEspera(
    "el jugador anda al menos 1 m (para ejercer cualquier creación perezosa de contexto)",
    true,
    (inicio) => {
      const p = window.__nefan.state().pos;
      return Math.hypot(p.x - inicio.x, p.z - inicio.z) > 1 ? p : null;
    },
    { ms: 15_000, arg: (await ctx.nefan("state")).pos, tecla: "up" },
  );

  const contextos = await ctx.page.evaluate(() =>
    window.__ctxProbe.map((c, i) => ({
      ...c,
      enElDom: document.contains(window.__ctxCanvases[i]),
    })),
  );
  const canvasEnDom = await ctx.page.evaluate(() =>
    [...document.querySelectorAll("canvas")].map((c) => c.id || "(sin id)"),
  );
  ctx.log(`contextos WebGL: ${contextos.length} → ${JSON.stringify(contextos)}`);
  ctx.log(`canvas en el DOM: ${JSON.stringify(canvasEnDom)}`);
  ctx.expect(
    "la pestaña abre EXACTAMENTE un contexto WebGL",
    contextos.length === 1,
    JSON.stringify(contextos),
  );
  await ctx.shot("un-solo-contexto");
}
