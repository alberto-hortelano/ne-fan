#!/usr/bin/env node
/** EL STATE API NO MUTA SIN PARTIDA, Y PERSISTIR MAL SE DICE (#453, T13 PR-A).
 *
 *  Hasta #453, `POST /entity/player/inventory` con el bridge arriba y SIN
 *  sesión contestaba 200: el handler escribía en el `NarrativeState` vacío y
 *  `save()` lanzaba después, en `onMutation`, donde el servidor lo tragaba con
 *  un `warn` que el motor no lee. Los tests unitarios de la PR ejercen el
 *  despacho en memoria y un servidor propio; este guion recorre el cable de
 *  verdad —bridge REAL (`ws-server.ts`) con su State API, el motor falso detrás
 *  y un disco efímero— por el camino que sigue el motor narrativo (HTTP) y el
 *  cliente (WebSocket), y afirma los TRES códigos con su estado exacto:
 *
 *   1 · SIN PARTIDA. Cada endpoint de `WorldStateApi` (leído de `dist/`, no
 *       copiado aquí) que declara `mutates` rebota con **409** `ok:false` y un
 *       texto que dice que no se aplicó nada; ninguno de los que NO lo declaran
 *       (lecturas, `/scene/validate`, `/narrative_progress`) contesta 409. El
 *       body no se lee: un JSON roto a una mutadora sigue siendo 409, no 500.
 *       El inventario sigue vacío y el log del bridge no dice `onMutation failed`.
 *   2 · PROVISIONAL (#279). `start_session` por WebSocket, como el título,
 *       SIN el `session_entered` del jugador: la mutación entra con **200** y
 *       vive en memoria, y en disco no hay save —`save()` contesta
 *       `escrito:false` sin lanzar; ese es su diseño, no un fallo—.
 *   3 · EN DISCO. Con `session_entered` la partida existe en disco y la
 *       siguiente mutación cae en `state.json` (con lo acumulado en la ventana
 *       provisional: la primera escritura serializa el estado ENTERO).
 *   4 · PERSISTIR FALLA. Con el directorio del save sin permiso de escritura,
 *       la mutación es **500** «aplicado en memoria pero NO guardado: …» y ES
 *       VERDAD: el ítem está en `GET /entity/player/inventory` y NO en
 *       `state.json`. Al recuperar el disco, la siguiente mutación arrastra el
 *       ítem huérfano al save. El bridge lo dice por consola con método y URL.
 *   5 · EL SAVE SE BORRÓ. `delete_session` de la partida activa deja el bridge
 *       sin sesión: la misma mutadora vuelve a ser 409.
 *
 *  EN NEGATIVO (probado el 2026-09-05 al escribirlo): con la guardia
 *  `sinSesionParaMutar` anulada en `bridge/state-http/dispatch.ts`, rojo en el
 *  bloque 1 (las 12 mutadoras entran hasta el handler y contestan 400/404 por el body, el JSON roto es 500) y
 *  en el 5; con el `catch` de `onMutation` devuelto a `warn` + 200 en
 *  `bridge/state-http-server.ts`, rojo en el bloque 4. Las dos restauradas.
 *
 *  CERO CRÉDITOS: el bridge habla con `labs/narrative/fake-ai-server.ts`; no
 *  hay proveedor al que llamar. No se levanta asset-store ni cliente.
 *
 *  VECINOS: los puertos del bridge y la State API salen de `lib/stack.mjs`
 *  (`NEFAN_PORT_OFFSET` se honra); el del motor falso lo elige el kernel. Con un
 *  puerto ocupado el guion se NIEGA y dice quién lo tiene; nunca mata a nadie.
 *  Sus dos hijos se matan por PID, también con Ctrl+C (SIGINT/SIGTERM → misma
 *  limpieza que el `finally`, salida 130/143), y el permiso del directorio del
 *  save se restaura antes de borrar el disco efímero.
 *
 *  GRUPO: headless (no abre navegador). Candidato al job `candados-headless`
 *  de `ci.yml`, como sus hermanos `el-npc-cruza-…` y `el-ledger-…`. Medido en
 *  local el 2026-09-05 (Ryzen 7 5800X): 2,4 s en verde, 2,3 s en rojo.
 *
 *  Uso:  node qa/el-state-api-no-muta-sin-partida.mjs
 *
 *  Salida: 0 todo verde · 1 alguna comprobación en rojo · 2 no llegó a medir.
 */
import { spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUERTOS, offsetActual } from "./lib/stack.mjs";
import { duenyosDeLosPuertos, esperarPuertoArriba, puertoOcupado, puertosLibres } from "./lib/puertos.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(RAIZ, "nefan-core");
const FAKE = join(RAIZ, "labs", "narrative", "fake-ai-server.ts");
const BRIDGE = join(CORE, "bridge", "ws-server.ts");
const CONTRATO = join(CORE, "dist", "src", "contracts", "world-state.js");
/** Las rutas del contrato que el router declara SIN handler (PLANNED): se
 *  leen del mismo `dist`, no se copian aquí — una lista aparte se quedaría
 *  vieja el día que una de ellas se implemente. */
const RUTAS = join(CORE, "dist", "bridge", "state-http", "routes.js");
const GAME = "alta_fantasia";
const GAMES_ORIGEN = join(CORE, "data", "games");
const PLUGINS_ORIGEN = join(CORE, "data", "plugins");
/** Cortafuegos de la espera de la escena. Medido: ~2 s con el motor falso. */
const ESCENA_MAX_MS = 90_000;

const fallos = [];
const expect = (desc, cond, detalle = "") => {
  console.log(`  ${cond ? "✔" : "✘"} ${desc}${cond || !detalle ? "" : ` — ${detalle}`}`);
  if (!cond) fallos.push(desc);
};

class SinMedir extends Error {}

const hijos = [];
let tmp = null;
let dirDelSave = null;
let limpiando = null;

function arrancar(nombre, cmd, args, opts) {
  const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  const hijo = { nombre, p, log: "", muerto: null };
  const acumula = (chunk) => {
    hijo.log += chunk.toString("utf8");
    if (hijo.log.length > 200_000) hijo.log = hijo.log.slice(-100_000);
  };
  p.stdout.on("data", acumula);
  p.stderr.on("data", acumula);
  p.on("exit", (code, signal) => {
    hijo.muerto = `salió (code=${code} signal=${signal})`;
  });
  hijos.push(hijo);
  return hijo;
}

async function matar(hijo) {
  if (!hijo || hijo.muerto) return;
  const fin = new Promise((r) => hijo.p.once("exit", r));
  hijo.p.kill("SIGTERM");
  const paciencia = new Promise((r) => setTimeout(() => r("sigue"), 5_000));
  if ((await Promise.race([fin, paciencia])) === "sigue") {
    hijo.p.kill("SIGKILL");
    await fin;
  }
}

/** UNA limpieza para el `finally` y para las señales. El permiso del save se
 *  restaura ANTES de borrar: un `rm -rf` sobre un directorio 0555 falla. */
function limpiar() {
  if (!limpiando) {
    limpiando = (async () => {
      for (const h of [...hijos].reverse()) await matar(h);
      if (dirDelSave && existsSync(dirDelSave)) {
        try {
          chmodSync(dirDelSave, 0o755);
        } catch {
          // sin permiso ni para eso: el rmSync de abajo lo dirá con force
        }
      }
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    })();
  }
  return limpiando;
}

for (const [señal, codigo] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(señal, async () => {
    console.log(`\n⊘ INTERRUMPIDO (${señal}) — matando a los hijos por PID y borrando el disco efímero`);
    await limpiar();
    process.exit(codigo);
  });
}

const cola = (log, n = 20) => log.trim().split("\n").slice(-n).join("\n    ");
const corto = (x, n = 220) => JSON.stringify(x ?? null).slice(0, n);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una petición al State API tal y como la haría narrative-mcp. `raw` manda
 *  el body sin serializar (para el caso del JSON roto). */
async function api(base, method, path, body, { raw = false, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = raw ? body : JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { __texto: text };
  }
  return { status: res.status, body: json };
}

/** Un socket contra el bridge que manda UN mensaje y resuelve con lo recibido
 *  cuando `listo(msgs)` lo dice (o tras `quietoMs` sin condición). */
function porElCable(puerto, mensaje, { listo = null, quietoMs = 800, maxMs = ESCENA_MAX_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${puerto}`);
    const recibidos = [];
    let cerrado = false;
    const fin = (fn, v) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(cortafuegos);
      try {
        ws.close();
      } catch {
        // ya cerrado por el otro lado
      }
      fn(v);
    };
    const cortafuegos = setTimeout(
      () =>
        fin(
          reject,
          new Error(
            `el bridge no llegó a la condición en ${maxMs / 1000} s tras ${mensaje.type}; recibidos: ` +
              (recibidos.map((m) => m.type + (m.phase ? `/${m.phase}` : "")).join(", ") || "ninguno"),
          ),
        ),
      maxMs,
    );
    ws.addEventListener("error", (e) => fin(reject, new Error(`WebSocket: ${e.message ?? "error"}`)));
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify(mensaje));
      if (!listo) setTimeout(() => fin(resolvePromise, recibidos), quietoMs);
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return fin(reject, new Error(`el bridge mandó algo que no es JSON: ${String(ev.data).slice(0, 200)}`));
      }
      recibidos.push(msg);
      if (msg.type === "narrative_status" && msg.phase === "error") {
        return fin(reject, new Error(`narrative_status error — ${msg.message}`));
      }
      if (listo && listo(recibidos)) fin(resolvePromise, recibidos);
    });
  });
}

const inventarioDelSave = (ruta) => JSON.parse(readFileSync(ruta, "utf8")).player?.inventory ?? null;
const ids = (inv) => (Array.isArray(inv) ? inv.map((i) => i?.id) : inv);

async function main() {
  const t0 = Date.now();
  console.log("▶ el State API no muta sin partida, y persistir mal se dice (#453)\n");

  // ── precondiciones ────────────────────────────────────────────────────────
  if (!existsSync(join(CORE, "node_modules", "tsx"))) {
    throw new SinMedir("falta nefan-core/node_modules/tsx — corre `npm ci` en nefan-core");
  }
  if (!existsSync(CONTRATO)) {
    throw new SinMedir(`falta ${CONTRATO} — corre \`npm run build\` en nefan-core (la tabla se lee de dist, no se copia)`);
  }
  const { WorldStateApi } = await import(CONTRATO);
  const { PLANNED_ROUTES } = await import(RUTAS);
  const puertoBridge = PUERTOS.bridge;
  const puertoState = PUERTOS.state_api;
  for (const [puerto, quien] of [
    [puertoBridge, "bridge"],
    [puertoState, "State API"],
  ]) {
    if (await puertoOcupado(puerto)) {
      const dueño = duenyosDeLosPuertos().get(puerto)?.procesos?.[0];
      throw new SinMedir(
        `:${puerto} (${quien}, offset ${offsetActual()}) ya está ocupado` +
          (dueño ? ` por pid ${dueño.pid} (${dueño.comando ?? "?"}, cwd ${dueño.cwd ?? "?"})` : "") +
          ". No mato a nadie: elige otro NEFAN_PORT_OFFSET.",
      );
    }
  }
  const [puertoFake] = await puertosLibres(1);
  console.log(`  · puertos: bridge :${puertoBridge}, state :${puertoState} (offset ${offsetActual()}); motor falso :${puertoFake}\n`);

  // ── disco efímero: el árbol no se toca ────────────────────────────────────
  tmp = mkdtempSync(join(tmpdir(), "qa-sin-partida-"));
  const games = join(tmp, "games");
  const saves = join(tmp, "saves");
  mkdirSync(games);
  mkdirSync(saves);
  cpSync(join(GAMES_ORIGEN, GAME), join(games, GAME), { recursive: true });
  cpSync(PLUGINS_ORIGEN, join(tmp, "plugins"), { recursive: true });
  rmSync(join(games, GAME, "world"), { recursive: true, force: true });

  try {
    // ── el motor falso y el bridge real ───────────────────────────────────
    const fake = arrancar("fake-ai-server", process.execPath, ["--import", "tsx", FAKE], {
      cwd: CORE,
      env: { ...process.env, PORT: String(puertoFake), STATE_API: `http://127.0.0.1:${puertoState}` },
    });
    await esperarPuertoArriba(puertoFake, { quien: "fake-ai-server", siMuere: () => fake.muerto && cola(fake.log) });
    const bridge = arrancar("bridge", process.execPath, ["--import", "tsx", BRIDGE], {
      cwd: CORE,
      env: {
        ...process.env,
        NEFAN_AI_SERVER: `http://127.0.0.1:${puertoFake}`,
        NEFAN_GAMES_DIR: games,
        NEFAN_SAVES_DIR: saves,
        NEFAN_BRIDGE_PORT: String(puertoBridge),
        NEFAN_STATE_HTTP_PORT: String(puertoState),
      },
    });
    await esperarPuertoArriba(puertoBridge, { quien: "bridge", siMuere: () => bridge.muerto && cola(bridge.log) });
    await esperarPuertoArriba(puertoState, { quien: "State API", siMuere: () => bridge.muerto && cola(bridge.log) });
    const S = `http://127.0.0.1:${puertoState}`;

    const salud = await api(S, "GET", "/health");
    if (salud.status !== 200 || salud.body?.session_id !== "") {
      throw new SinMedir(`el bridge arranca con sesión o sin /health: ${corto(salud)}`);
    }

    // ── 1 · sin partida ──────────────────────────────────────────────────
    console.log("  1 · sin partida: lo declarado `mutates` rebota con 409, lo demás no");
    const rutas = Object.entries(WorldStateApi).filter(([k]) => !PLANNED_ROUTES.includes(k));
    const mutadoras = rutas.filter(([, e]) => e.mutates);
    const lectoras = rutas.filter(([, e]) => !e.mutates);
    expect("1 · el contrato declara mutadoras (si fueran 0, lo que sigue no mediría nada)", mutadoras.length >= 12, `mutates: ${mutadoras.length}`);
    const relleno = (path) => path.replace(/\{[a-z_]+\}/g, "qa");
    for (const [k, e] of mutadoras) {
      const r = await api(S, e.method, relleno(e.path), e.method === "POST" ? {} : undefined);
      expect(
        `1 · ${k} (${e.method} ${e.path}) sin partida → 409 ok:false y «No se ha aplicado nada»`,
        r.status === 409 && r.body?.ok === false && /no_session/.test(r.body?.error ?? "") && /No se ha aplicado nada/.test(r.body?.error ?? ""),
        `${r.status} ${corto(r.body)}`,
      );
    }
    for (const [k, e] of lectoras) {
      const r = await api(S, e.method, relleno(e.path), e.method === "POST" ? {} : undefined);
      expect(`1 · ${k} (${e.method} ${e.path}) sin partida NO es 409 (la regla es «mutadora», no «POST»)`, r.status !== 409, `${r.status} ${corto(r.body)}`);
    }
    const roto = await api(S, "POST", "/entity/player/inventory", "esto-no-es-json", { raw: true });
    expect("1 · un body que no es JSON a una mutadora sigue siendo 409 (el body no se lee)", roto.status === 409, `${roto.status} ${corto(roto.body)}`);
    const inv0 = await api(S, "GET", "/entity/player/inventory");
    expect("1 · el inventario sigue vacío: nada de lo anterior se aplicó", inv0.status === 200 && Array.isArray(inv0.body?.inventory) && inv0.body.inventory.length === 0, corto(inv0.body));
    expect("1 · el log del bridge no dice `onMutation failed`", !/onMutation failed/.test(bridge.log), cola(bridge.log, 5));

    // ── 2 · provisional: start_session sin el ack del jugador ────────────
    console.log("\n  2 · provisional (#279): start_session por el cable, sin session_entered");
    const arranque = await porElCable(
      puertoBridge,
      { type: "start_session", requestId: "qa-sin-partida", gameId: GAME },
      {
        listo: (msgs) =>
          msgs.some((m) => m.type === "narrative_event" && (m.effects ?? []).some((e) => e.kind === "scene_loaded")) &&
          msgs.some((m) => m.type === "narrative_status" && m.phase === "ready"),
      },
    );
    const arrancada = arranque.find((m) => m.type === "session_started");
    if (!arrancada?.ok || !arrancada.sessionId) throw new SinMedir(`session_started no llegó ok: ${corto(arrancada)}`);
    const sid = arrancada.sessionId;
    dirDelSave = join(saves, sid);
    const rutaSave = join(dirDelSave, "state.json");
    console.log(`  · partida ${sid} abierta (${Date.now() - t0} ms)`);
    expect("2 · antes del ack del jugador no hay save en disco", !existsSync(rutaSave), rutaSave);
    const mutProv = await api(S, "POST", "/entity/player/inventory", { item: { id: "qa_x" } });
    expect("2 · la mutación en provisional es 200 y entra en memoria", mutProv.status === 200 && ids(mutProv.body?.inventory)?.includes("qa_x"), `${mutProv.status} ${corto(mutProv.body)}`);
    await espera(300);
    expect("2 · …y sigue sin haber save en disco (save() → escrito:false, sin lanzar)", !existsSync(rutaSave), rutaSave);
    expect("2 · …sin 500 ni `onMutation` en el log: escrito:false no es un fallo", !/NO guardado|onMutation/.test(bridge.log), cola(bridge.log, 5));

    // ── 3 · el jugador entra: en disco ───────────────────────────────────
    console.log("\n  3 · session_entered: la partida existe en disco y la mutación cae en el save");
    await porElCable(puertoBridge, { type: "session_entered", sessionId: sid });
    for (let i = 0; i < 50 && !existsSync(rutaSave); i++) await espera(200);
    expect("3 · tras session_entered hay state.json", existsSync(rutaSave), rutaSave);
    const mutDisco = await api(S, "POST", "/entity/player/inventory", { item: { id: "qa_y" } });
    expect("3 · la mutación establecida es 200", mutDisco.status === 200 && ids(mutDisco.body?.inventory)?.includes("qa_y"), `${mutDisco.status} ${corto(mutDisco.body)}`);
    const invDisco = existsSync(rutaSave) ? ids(inventarioDelSave(rutaSave)) : null;
    expect("3 · state.json trae qa_x (de la ventana provisional) y qa_y", Array.isArray(invDisco) && invDisco.includes("qa_x") && invDisco.includes("qa_y"), corto(invDisco));

    // ── 4 · persistir falla: 500 y el estado exacto ──────────────────────
    console.log("\n  4 · el disco no deja escribir: 500 «aplicado en memoria pero NO guardado», y es verdad");
    chmodSync(dirDelSave, 0o555);
    const mut500 = await api(S, "POST", "/entity/player/inventory", { item: { id: "qa_z" } });
    expect(
      "4 · la respuesta es 500 ok:false «aplicado en memoria pero NO guardado: <motivo>»",
      mut500.status === 500 && mut500.body?.ok === false && /^aplicado en memoria pero NO guardado: .+/.test(mut500.body?.error ?? ""),
      `${mut500.status} ${corto(mut500.body)}`,
    );
    expect(
      "4 · …y le dice al motor qué hacer: «No reintentes» (un reintento duplicaría el ítem: el push no deduplica)",
      /No reintentes: la mutación ya está aplicada y la siguiente escritura que guarde la arrastrará/.test(mut500.body?.error ?? ""),
      corto(mut500.body),
    );
    const invMem = await api(S, "GET", "/entity/player/inventory");
    expect("4 · «aplicado en memoria» es cierto: qa_z está en GET /entity/player/inventory", ids(invMem.body?.inventory)?.includes("qa_z"), corto(invMem.body));
    const invTras500 = ids(inventarioDelSave(rutaSave));
    expect("4 · «NO guardado» es cierto: qa_z no está en state.json", Array.isArray(invTras500) && !invTras500.includes("qa_z"), corto(invTras500));
    expect("4 · el bridge lo dice por consola con método y URL", /StateHttpServer: POST \/entity\/player\/inventory aplicado en memoria pero NO guardado/.test(bridge.log), cola(bridge.log, 5));
    expect("4 · …y NO con el `warn` viejo", !/onMutation failed/.test(bridge.log), cola(bridge.log, 5));
    chmodSync(dirDelSave, 0o755);
    const mutW = await api(S, "POST", "/entity/player/inventory", { item: { id: "qa_w" } });
    const invFinal = ids(inventarioDelSave(rutaSave));
    expect(
      "4 · recuperado el disco, la siguiente mutación es 200 y arrastra qa_z al save",
      mutW.status === 200 && Array.isArray(invFinal) && invFinal.includes("qa_z") && invFinal.includes("qa_w"),
      `${mutW.status} save=${corto(invFinal)}`,
    );

    // ── 5 · el save se borró: sin sesión otra vez ────────────────────────
    console.log("\n  5 · delete_session de la partida activa: el bridge queda sin sesión y la mutadora vuelve a ser 409");
    const borrado = await porElCable(
      puertoBridge,
      { type: "delete_session", requestId: "qa-sin-partida-del", sessionId: sid },
      { listo: (msgs) => msgs.some((m) => m.type === "session_deleted"), maxMs: 15_000 },
    );
    expect("5 · session_deleted outcome:deleted", borrado.find((m) => m.type === "session_deleted")?.outcome === "deleted", corto(borrado.at(-1)));
    const saludFin = await api(S, "GET", "/health");
    expect("5 · /health dice session_id vacío", saludFin.body?.session_id === "" && saludFin.body?.has_session === false, corto(saludFin.body));
    const mutFin = await api(S, "POST", "/entity/player/inventory", { item: { id: "qa_v" } });
    expect("5 · la mutadora vuelve a ser 409 no_session", mutFin.status === 409 && /no_session/.test(mutFin.body?.error ?? ""), `${mutFin.status} ${corto(mutFin.body)}`);
    expect("5 · el log del bridge sigue sin `onMutation failed`", !/onMutation failed/.test(bridge.log), cola(bridge.log, 5));
  } finally {
    await limpiar();
  }

  console.log(`\n${fallos.length === 0 ? "✅" : "❌"} ${fallos.length} rojo(s) · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (fallos.length) {
    for (const f of fallos) console.log(`   ✘ ${f}`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  await limpiar();
  if (err instanceof SinMedir) {
    console.log(`\n⊘ SIN MEDIR — ${err.message}`);
    process.exit(2);
  }
  console.error(`\n⊘ SIN MEDIR — ${err.stack ?? err}`);
  for (const h of hijos) if (h.log.trim()) console.error(`\n  [${h.nombre}]\n    ${cola(h.log)}`);
  process.exit(2);
});
