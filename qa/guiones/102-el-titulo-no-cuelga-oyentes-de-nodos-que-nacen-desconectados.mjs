/** EL HUECO QUE EL 99 DECLARA, ocupado: un oyente que el TÍTULO pone sobre un
 *  nodo que todavía no está en el documento y que después se conecta FUERA de
 *  `#title-screen`.
 *
 *  Escrito por QA al validar la PR 6 de #346 («El título troceado»), la que
 *  cierra el programa: el chasis del overlay sale de `ui/title-screen.ts` a
 *  `ui/titulo/chasis.ts` y con él los cuatro oyentes de por vida que no son del
 *  bridge. El riesgo 4 del plan —la fuga de oyente que ningún test verde ve— lo
 *  vigila el guion 99, y su propia cabecera declara lo que NO ve:
 *
 *    «un oyente puesto sobre un nodo TODAVÍA DESCONECTADO (`isConnected` en
 *     false) que se conecte después fuera del título. No tiene ocupante hoy…»
 *
 *  Es exactamente lo que el chasis podría estrenar. `montarChasis` crea `root`,
 *  le cuelga `content` y `#ts-mas`, engancha el `scroll` de la columna y el
 *  click de «✕ cerrar», y SÓLO DESPUÉS hace `document.body.appendChild(root)`:
 *  dos de sus oyentes de por vida nacen sobre nodos huérfanos. Que acaben
 *  dentro de `#title-screen` es un HECHO MEDIDO, no una propiedad del lenguaje
 *  — mover el `appendChild` dos líneas, o montar un tooltip/portal en
 *  `document.body` desde una pantalla, lo rompe sin que nada chille.
 *
 *  POR QUÉ EL 99 NO PUEDE VERLO, medido y no supuesto. Su sonda clasifica en el
 *  INSTANTE DEL REGISTRO: `this.id === "title-screen"`, `this.parentElement.id
 *  === "title-screen"`, o `raiz && this.isConnected && !raiz.contains(this)`. Un
 *  nodo huérfano en ese instante falla las tres ramas —`parentElement` es
 *  `null`, `isConnected` es `false` y, durante el montaje, `raiz` ni existe—,
 *  así que el registro no se apunta y no puede crecer. Corolario que este guion
 *  AFIRMA porque la cabecera del 99 lo dice al revés («por eso la foto de
 *  referencia los incluye»): **el click de `#ts-close` no está en la foto del
 *  99**, porque se engancha antes de `root.appendChild(close)`.
 *
 *  DOS CAMBIOS DE FORMA respecto del 99, y los dos hacen falta:
 *
 *   · **Se pregunta DESPUÉS, no en el registro.** Se guarda el objetivo y se
 *     mira dónde vive cuando el DOM ya está montado. Es el mismo giro que llevó
 *     la sonda del 99 de «enumerar cinco objetos» a «¿está fuera del título y
 *     sigue vivo?», y el candado de las hojas a mirar el import RESUELTO.
 *   · **Se atribuye al MÓDULO que enganchó**, leyendo el `stack` del registro.
 *     Sin esto la afirmación es de la página entera y sale roja por lo que no
 *     es del título: medido antes de escribirla, hay **14 oyentes de botones
 *     huérfanos que viven fuera de `#title-screen`** —el HUD, el chip de
 *     gráficos, el menú de dev— y ninguno es una fuga. La pregunta no es «¿hay
 *     oyentes fuera del título?» sino «¿los pone el título?».
 *
 *  Las cuatro afirmaciones:
 *
 *   1. LA SONDA MIDE ALGO, en sus tres mitades: hay registros apuntados, hay
 *      registros ATRIBUIDOS al título, y al menos uno de ésos se hizo sobre un
 *      nodo DESCONECTADO. Sin la tercera, la rama nueva sería verde por vacía —
 *      el modo de fallo de todo candado escrito para un caso que no ocurre.
 *   2. EL CLICK DE «✕ CERRAR» nace huérfano, lo pone `ui/titulo/chasis.ts` y
 *      acaba DENTRO del título. Es el caso concreto, nombrado.
 *   3. NINGÚN oyente puesto por el título —la raíz o cualquiera de sus nueve
 *      módulos— vive hoy FUERA de `#title-screen`. Cubre a las ocho hojas, que
 *      no pueden tocar `document` ni `root` pero sí pueden crear un nodo,
 *      engancharlo y colgarlo donde no toca.
 *   4. Y NO CRECE: tras cinco idas y vueltas home ⇄ selector, sigue en cero. Una
 *      fuga es algo que crece con las visitas, y esos dos pintados son los que
 *      más nodos crean del título.
 *
 *  LO QUE NO VE, dicho para que nadie lo cuente de más: el oyente sobre un nodo
 *  que se conecta DENTRO del título y del que nadie se deshace luego (eso lo
 *  cazan el 95 y el 99 por el digest y por el conteo de hijos del chasis, y aquí
 *  sale como «dentro», que es correcto); el oyente DUPLICADO sobre el mismo nodo
 *  propio (hueco declarado del 99, sigue abierto); y `ResizeObserver`, que no
 *  pasa por `addEventListener` — el observador que el chasis pone sobre
 *  `content` no lo cuenta ninguna de las dos sondas.
 *
 *  Cero créditos: no arranca partida, no pide una imagen y no toca
 *  `#ts-gen-world` ni `#ts-apply-style`. Sólo el título contra el bridge del
 *  preset sin créditos.
 */
import { esperarListaDeSaves, esperarTituloListo, recargarAlTitulo } from "../lib/sesion.mjs";

export const sinMotor =
  "recorre el título (home ⇄ selector) mirando dónde acaban sus oyentes; nunca arranca partida ni encola generación";

const VISITAS = 5;

/** Envuelve `addEventListener` ANTES de que cargue nada, y guarda TRES cosas
 *  que el 99 no guarda: el objetivo (para preguntar después dónde vive), si
 *  estaba conectado al engancharlo, y de qué módulo salió la llamada.
 *
 *  La atribución sale del `stack`: el servidor de desarrollo sirve los módulos
 *  sin empaquetar, así que el primer marco con una ruta `/src/…` es el fichero
 *  que ESCRIBIÓ el `addEventListener`. Se toma el PRIMERO (el más interno) y no
 *  el conjunto de marcos: si el título llama a un vecino que engancha por su
 *  cuenta, el dueño del oyente es el vecino, no el título.
 *
 *  Se guardan referencias FUERTES a propósito: sin ellas el recolector podría
 *  llevarse un nodo huérfano y el guion contaría de menos justo en el caso que
 *  vino a medir.
 *
 *  Va como `addInitScript` porque el chasis se monta en el arranque de
 *  `main.ts`: enganchar después dejaría fuera precisamente los oyentes que hay
 *  que ver. */
function espiarObjetivos() {
  window.__oyentesDelTitulo = [];
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (tipo, fn, opts) {
    const esNodo = Boolean(this) && typeof this === "object" && this.nodeType !== undefined;
    if (this === window || esNodo) {
      const nodo = esNodo ? this : null;
      const marcos = (new Error().stack ?? "").split("\n");
      let modulo = "";
      for (const m of marcos) {
        const hit = /\/(src\/[^\s?):]+\.ts)/.exec(m);
        if (hit) {
          modulo = hit[1];
          break;
        }
      }
      window.__oyentesDelTitulo.push({
        objetivo: this,
        tipo,
        modulo,
        huerfanoAlRegistrar: Boolean(nodo) && nodo.nodeType === 1 && !nodo.isConnected,
        nombre:
          this === window
            ? "window"
            : nodo && nodo.nodeType === 9
              ? "document"
              : nodo && nodo.nodeType === 1
                ? `${nodo.tagName.toLowerCase()}${nodo.id ? `#${nodo.id}` : ""}`
                : `nodo(${nodo ? nodo.nodeType : "?"})`,
      });
    }
    return original.call(this, tipo, fn, opts);
  };
}

/** DÓNDE VIVE AHORA cada objetivo apuntado. La clasificación se hace aquí y no
 *  en el registro, que es lo que el 99 no puede hacer.
 *
 *  `muerto` no es un fallo: un oyente sobre un nodo que el repintado se llevó
 *  desaparece con él, y eso es justo lo que tiene que pasar con los handlers de
 *  cada pantalla. El fallo es `fuera`. */
function clasificarEnLaPagina() {
  const raiz = document.getElementById("title-screen");
  const donde = (o) => {
    if (o === window) return "window";
    if (o === document) return "document";
    if (o === document.documentElement) return "html";
    if (o === document.head) return "head";
    if (o === document.body) return "body";
    if (o && o.nodeType === 1) {
      if (!o.isConnected) return "muerto";
      if (raiz && (o === raiz || raiz.contains(o))) return "dentro";
      return "fuera";
    }
    return "otro";
  };
  return (window.__oyentesDelTitulo ?? []).map((e) => ({
    tipo: e.tipo,
    nombre: e.nombre,
    modulo: e.modulo,
    huerfano: e.huerfanoAlRegistrar,
    donde: donde(e.objetivo),
  }));
}

/** ¿Lo enganchó el título? La raíz (`src/ui/title-screen.ts`) o cualquiera de
 *  los nueve módulos de `src/ui/titulo/`. */
const esDelTitulo = (e) =>
  e.modulo === "src/ui/title-screen.ts" || e.modulo.startsWith("src/ui/titulo/");
/** Los que el título puso y hoy viven fuera del overlay: la clase que este
 *  guion existe para contar, y que tiene que ser SIEMPRE cero. */
const fugados = (lista) => lista.filter((e) => esDelTitulo(e) && e.donde === "fuera");
const rotulo = (e) => `${e.modulo || "?"} → ${e.nombre} · ${e.tipo} (${e.donde})`;

export default async function (ctx) {
  // ANTES de la recarga: si no, el chasis ya está montado y sus oyentes de por
  // vida —los dos que nacen huérfanos, que son el sujeto— no se apuntan.
  await ctx.page.addInitScript(espiarObjetivos);
  await recargarAlTitulo(ctx);
  await esperarListaDeSaves(ctx);

  const clasificar = () => ctx.page.evaluate(clasificarEnLaPagina);

  const alEntrar = await clasificar();
  const delTitulo = alEntrar.filter(esDelTitulo);
  const huerfanosDelTitulo = delTitulo.filter((e) => e.huerfano);
  ctx.log(
    `registros apuntados al entrar: ${alEntrar.length} · del TÍTULO: ${delTitulo.length} · de ésos, huérfanos: ${huerfanosDelTitulo.length}`,
  );
  ctx.log(`los del título: ${delTitulo.map(rotulo).join(" | ") || "(ninguno)"}`);

  // ── 1 · La sonda mide algo, y las TRES mitades ───────────────────────────
  ctx.expect(
    "la sonda está puesta y apunta registros (sin esto, todo lo de abajo sería verde por vacío)",
    alEntrar.length > 0,
    `${alEntrar.length} registros`,
  );
  ctx.expect(
    "y sabe atribuirlos: hay registros que salen de la raíz del título o de ui/titulo/ (si no, la afirmación 3 no mediría nada)",
    delTitulo.length > 0,
    `${delTitulo.length} del título de ${alEntrar.length}`,
  );
  ctx.expect(
    "y al menos UNO del título se hizo sobre un nodo desconectado — que es la clase que el 99 no puede ver",
    huerfanosDelTitulo.length > 0,
    `${huerfanosDelTitulo.length} huérfanos del título: ${huerfanosDelTitulo.map(rotulo).join(" | ")}`,
  );

  // ── 2 · El caso concreto: «✕ cerrar» ─────────────────────────────────────
  const cerrar = alEntrar.filter((e) => e.nombre === "button#ts-close" && e.tipo === "click");
  ctx.expect(
    "el click de «✕ cerrar» nace HUÉRFANO, lo pone ui/titulo/chasis.ts y acaba DENTRO del título (por eso no está en la foto del 99)",
    cerrar.length === 1 &&
      cerrar[0].huerfano === true &&
      cerrar[0].donde === "dentro" &&
      cerrar[0].modulo === "src/ui/titulo/chasis.ts",
    JSON.stringify(cerrar),
  );

  // ── 3 · La afirmación general, al entrar ─────────────────────────────────
  const fugadosAlEntrar = fugados(alEntrar);
  ctx.expect(
    "ningún oyente puesto por el título vive FUERA de #title-screen",
    fugadosAlEntrar.length === 0,
    fugadosAlEntrar.map(rotulo).join(" | ") || "(ninguno)",
  );
  await ctx.shot("titulo-al-entrar");

  // ── 4 · Y no crece: cinco idas y vueltas home ⇄ selector ─────────────────
  for (let v = 1; v <= VISITAS; v++) {
    await ctx.page.click("#ts-new");
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
    await ctx.page.click("#ts-back");
    await esperarTituloListo(ctx);
    await esperarListaDeSaves(ctx);
  }
  const alSalir = await clasificar();
  const fugadosAlSalir = fugados(alSalir);
  const reparto = alSalir.filter(esDelTitulo).reduce((acc, e) => {
    acc[e.donde] = (acc[e.donde] ?? 0) + 1;
    return acc;
  }, {});
  ctx.log(
    `registros al salir: ${alSalir.length} · del título: ${alSalir.filter(esDelTitulo).length}` +
      ` · reparto de los del título por destino: ${JSON.stringify(reparto)}`,
  );
  ctx.expect(
    `tras ${VISITAS} idas y vueltas el título sigue sin tener un solo oyente vivo fuera de su overlay`,
    fugadosAlSalir.length === 0,
    `${fugadosAlEntrar.length} → ${fugadosAlSalir.length}: ${fugadosAlSalir.map(rotulo).join(" | ") || "(ninguno)"}`,
  );
  // El chasis sigue siendo el chasis: sin esto, un guion que se quedara sin
  // título saldría verde por no encontrar nada que clasificar.
  const chasis = await ctx.page.evaluate(() => {
    const raiz = document.getElementById("title-screen");
    return {
      hijos: raiz ? raiz.children.length : -1,
      ids: raiz ? [...raiz.children].map((c) => c.id || "(content)").join(",") : "",
    };
  });
  ctx.log(`chasis al salir: ${JSON.stringify(chasis)}`);
  ctx.expect(
    "y el título sigue montado con sus tres hijos en su orden (si no, lo de arriba no estaría midiendo el título)",
    chasis.hijos === 3 && chasis.ids === "(content),ts-mas,ts-close",
    JSON.stringify(chasis),
  );
  await ctx.shot("titulo-tras-las-vueltas");
}
