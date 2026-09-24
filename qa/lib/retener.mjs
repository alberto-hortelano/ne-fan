/** RETENER UNA RESPUESTA y soltarla cuando el guion quiere (#731, tanda BB).
 *
 *  Lo que se mide con esto es la CARRERA de un pintado tardío del título: una
 *  pantalla que espera a la red (`listGames`, `deleteSession`, `setRenderMode`,
 *  el censo `/sprites/index.json`) y escribe DESPUÉS, cuando el jugador puede
 *  haberse ido ya. Para que el orden malo —destino pintado → respuesta que
 *  llega— se dé SIEMPRE y no por suerte, la respuesta se retiene en la página
 *  hasta que el destino está pintado. Es lo que hace un bridge cargado, que es
 *  cuando la ventana dura de verdad (hasta el timeout de la petición).
 *
 *  Y el aserto NO espera un plazo: `soltarYVerResuelto` espera a haber VISTO
 *  cada petición contestada y entregada al cliente —la continuación del
 *  pintado corre en los microtasks de esa entrega— y dos rAF para que lo que
 *  haya escrito esté pintado.
 *
 *  Lo usan los guiones 198 y 199. El socket y el `fetch` siguen siendo los de
 *  verdad: aquí solo se interpone QUIÉN ENTREGA y CUÁNDO.
 */

/** Init script: instrumenta los sockets y el `fetch` de la página ANTES de
 *  que cargue nada. Va como función autocontenida (`addInitScript` la
 *  serializa), así que no puede cerrar sobre nada de este módulo.
 *
 *  Deja en `window.__qaRet`:
 *   · `sockets`     — los WebSocket abiertos, para entregarles una trama;
 *   · `pedidas`     — `list_games`, `delete_session`… enviadas, por tipo;
 *   · `entregadas`  — respuestas entregadas al cliente, por tipo;
 *   · `retener`     — tipos de respuesta que se retienen ahora;
 *   · `retenidas`   — entregas pendientes de soltar;
 *   · `fetchRetener`/`fetchRetenidos` — lo mismo para `fetch`, por subcadena
 *     de la URL; y `leidos[sub]` cuenta los cuerpos JSON ya leídos por el
 *     cliente, que es lo que dice que su `await` ya ha vuelto;
 *   · `relojRetener`/`relojRetenidos` — los `setTimeout` de esos milisegundos
 *     exactos no se programan: esperan a que el guion los suelte. Es para la
 *     pausa que una pantalla mete entre un comprobante y su vuelta automática
 *     (`plan-de-estilo.ts`), que de otro modo solo se puede esperar por plazo. */
export function instrumentarRetenciones() {
  const r = {
    sockets: [],
    pedidas: {},
    entregadas: {},
    retener: new Set(),
    retenidas: [],
    fetchRetener: new Set(),
    fetchRetenidos: [],
    leidos: {},
    relojRetener: new Set(),
    relojRetenidos: [],
    relojSoltados: 0,
  };
  window.__qaRet = r;
  const suma = (o, k) => {
    o[k] = (o[k] ?? 0) + 1;
  };
  const tipoDe = (datos) => {
    try {
      return JSON.parse(typeof datos === "string" ? datos : "")?.type ?? null;
    } catch {
      return null; // una trama ilegible la juzga el cliente, no esta sonda
    }
  };

  const Original = window.WebSocket;
  const proto = Object.getOwnPropertyDescriptor(Original.prototype, "onmessage");
  const Envuelto = function (...args) {
    const sock = new Original(...args);
    const enviar = sock.send.bind(sock);
    sock.send = (datos) => {
      const t = tipoDe(datos);
      if (t) suma(r.pedidas, t);
      return enviar(datos);
    };
    Object.defineProperty(sock, "onmessage", {
      configurable: true,
      get: () => proto.get.call(sock),
      set: (fn) => {
        if (typeof fn !== "function") return proto.set.call(sock, fn);
        proto.set.call(sock, function (ev) {
          const t = tipoDe(ev.data);
          const entregar = () => {
            if (t) suma(r.entregadas, t);
            return fn.call(sock, ev);
          };
          if (t && r.retener.has(t)) r.retenidas.push(entregar);
          else return entregar();
        });
      },
    });
    r.sockets.push(sock);
    return sock;
  };
  Envuelto.prototype = Original.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Envuelto[k] = Original[k];
  window.WebSocket = Envuelto;

  const setTimeoutOriginal = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => {
    if (typeof fn !== "function" || !r.relojRetener.has(ms)) return setTimeoutOriginal(fn, ms, ...args);
    r.relojRetenidos.push(() => {
      r.relojSoltados++;
      fn(...args);
    });
    return 0; // nadie cancela esta pausa; si alguien lo hiciera, el guion lo vería colgado
  };

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (entrada, init) => {
    const url = typeof entrada === "string" ? entrada : (entrada?.url ?? String(entrada));
    const sub = [...r.fetchRetener].find((s) => url.includes(s));
    const marcar = (res) => {
      const clave = [...Object.keys(r.leidos), ...r.fetchRetener].find((s) => url.includes(s));
      if (!clave) return res;
      const json = res.json.bind(res);
      res.json = () =>
        json().then((v) => {
          suma(r.leidos, clave);
          return v;
        });
      return res;
    };
    if (sub === undefined) return fetchOriginal(entrada, init).then(marcar);
    return new Promise((soltar) => r.fetchRetenidos.push(soltar)).then(() =>
      fetchOriginal(entrada, init).then(marcar),
    );
  };
}

/** Empieza a retener las respuestas de estos `tipos` y las `fetch` cuya URL
 *  contenga alguna de `urls`. */
export function retener(ctx, { tipos = [], urls = [], relojes = [] } = {}) {
  return ctx.page.evaluate(
    ({ tipos, urls, relojes }) => {
      const r = window.__qaRet;
      if (!r) throw new Error("retener: falta `instrumentarRetenciones` como init script");
      for (const t of tipos) r.retener.add(t);
      for (const ms of relojes) r.relojRetener.add(ms);
      for (const u of urls) {
        r.fetchRetener.add(u);
        r.leidos[u] = r.leidos[u] ?? 0;
      }
    },
    { tipos, urls, relojes },
  );
}

/** Lo que el guion necesita leer en la página: pedidas y entregadas por tipo,
 *  cuántas hay retenidas y los JSON leídos por URL. */
export function contadores(ctx) {
  return ctx.page.evaluate(() => {
    const r = window.__qaRet;
    return {
      pedidas: { ...r.pedidas },
      entregadas: { ...r.entregadas },
      retenidas: r.retenidas.length + r.fetchRetenidos.length,
      relojesRetenidos: r.relojRetenidos.length,
      leidos: { ...r.leidos },
    };
  });
}

/** Suelta todo lo retenido y espera a haber VISTO resuelto lo que se pide:
 *   · `pares`: `[pedida, respuesta]` — cada `pedida` enviada tiene su
 *     `respuesta` entregada al cliente;
 *   · `urls`: `{sub: n}` — el cliente ha leído al menos `n` cuerpos JSON de
 *     esa URL.
 *  Los relojes retenidos se disparan aquí también, DESPUÉS de las respuestas.
 *  Luego dos rAF, para que lo que el pintado tardío haya escrito, si escribió,
 *  esté en pantalla. Devuelve los contadores con los que se cumplió. */
export async function soltarYVerResuelto(ctx, { pares = [], urls = {} } = {}) {
  await ctx.page.evaluate(() => {
    const r = window.__qaRet;
    r.retener.clear();
    r.fetchRetener.clear();
    r.relojRetener.clear();
    for (const entregar of r.retenidas.splice(0)) entregar();
    for (const soltar of r.fetchRetenidos.splice(0)) soltar();
    for (const disparar of r.relojRetenidos.splice(0)) disparar();
  });
  const cuenta = await ctx.waitFor(
    "lo retenido está contestado y entregado al cliente (el pintado tardío se ha resuelto)",
    ({ pares, urls }) => {
      const r = window.__qaRet;
      if (r.retenidas.length + r.fetchRetenidos.length + r.relojRetenidos.length > 0) return null;
      for (const [p, e] of pares) {
        if ((r.pedidas[p] ?? 0) === 0 || (r.entregadas[e] ?? 0) < r.pedidas[p]) return null;
      }
      for (const [u, n] of Object.entries(urls)) if ((r.leidos[u] ?? 0) < n) return null;
      return { pedidas: { ...r.pedidas }, entregadas: { ...r.entregadas }, leidos: { ...r.leidos } };
    },
    30_000,
    { pares, urls },
  );
  await ctx.page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))),
  );
  return cuenta;
}

/** Qué pantalla del título hay delante, por la marca que solo pinta cada una. */
export function pantallaDelTitulo(ctx) {
  return ctx.page.evaluate(() => {
    const hay = (id) => document.getElementById(id) !== null;
    if (hay("ts-gen")) return "selector";
    if (hay("ts-new")) return "home";
    if (hay("ts-start")) return "editor";
    if (hay("ts-upload-rows")) return "subir-estilo";
    return "ninguna";
  });
}
