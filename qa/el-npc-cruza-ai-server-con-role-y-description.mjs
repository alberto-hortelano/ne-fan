#!/usr/bin/env node
/** EL NPC CRUZA ai_server CON `role` Y `description` (T11 PR-2: #235).
 *
 *  La junta donde vivió #173 es `validate_scene_response` (`ai_server/
 *  narrative_schemas.py`): una allow-list que copia campo a campo lo que el
 *  modelo declaró de cada entity, y que durante semanas dejó caer `role` y
 *  `description` sin que nadie lo viera —todo NPC llegaba al cliente como un
 *  aldeano anónimo—. Ninguna corrida del banco la atravesaba: el preset
 *  `e2e-sin-creditos` apunta el bridge al `fake-ai-server`, que devuelve la
 *  escena SIN pasar por el proceso Python, así que la única red que sujetaba
 *  esa allow-list eran tests unitarios que llaman a la función en memoria.
 *
 *  Este guion recorre el tramo de verdad, por HTTP y sin un céntimo:
 *
 *      bridge (`ws-server.ts` real) --HTTP--> ai_server (`main.py` REAL, SDK
 *      anthropic REAL, `validate_scene_response` REAL) --HTTP--> el MODELO,
 *      que es lo ÚNICO sustituido: `labs/narrative/fake-anthropic.ts` detrás
 *      de `ANTHROPIC_BASE_URL`, contestando un `tool_use generate_scene` con
 *      el tile de bootstrap del motor falso.
 *
 *  Lo que se afirma:
 *   1 · EL ai_server ES EL REAL: su `/health` dice `fake:false` y su consola,
 *       «canal MCP desactivado» (`NEFAN_LLM_MCP_URL=off`, la palanca de #235).
 *       Sin ese `off`, un ai_server de banco en esta máquina se ENGANCHARÍA al
 *       terminal de Claude Code de otro agente y le mandaría la petición.
 *   2 · `start_session` por WebSocket llega a `scene_loaded` y en `npcs[]` del
 *       wire viene `barkeep` con `role:"merchant"` y su `description` VERBATIM
 *       —la misma cadena que el stub sirvió, leída del stub, no escrita aquí—,
 *       y `bandido_1` con `role:"hostile"` y el `combat` que el core deriva.
 *   3 · EL BANCO NO PUEDE MENTIR: el stub recibió EXACTAMENTE una llamada, con
 *       la clave FALSA (`banco-sin-creditos`) y pidiendo `generate_scene`. Si
 *       la escena hubiera salido de un snapshot, o el ai_server hubiera hablado
 *       con otro modelo, el contador lo dice. El SDK solo conoce la URL del
 *       stub, así que ninguna petición puede salir hacia el proveedor real.
 *   4 · EL ÁRBOL NO SE ENSUCIA: el snapshot del mundo que escribe el bridge cae
 *       en el disco efímero de este guion y `data/games/alta_fantasia/world/`
 *       del checkout queda como estaba. Así nacieron los 4 tiles basura que se
 *       borraron el 2026-09-05: alguien corrió un preset sobre el árbol real.
 *   5 · EL ai_server SE APAGA LIMPIO: SIGTERM por PID → uvicorn dice
 *       «Application shutdown complete.» y muere por la señal que se le mandó
 *       (la re-lanza a propósito tras el apagado; nunca sale con 0). Un
 *       `lifespan` que revienta al apagar dice «shutdown failed» y nadie lo
 *       leía, porque ningún guion miraba cómo mueren sus hijos (hallazgo 5 de
 *       `qa-2.md`).
 *
 *  EN NEGATIVO (probado el 2026-09-05 al escribirlo): comentando en
 *  `narrative_schemas.py` la copia `clean_ent["role"] = ent["role"]`, rojo
 *  nombrando a `barkeep` sin `role`; comentando la de `description`, rojo por
 *  `description`. Las dos restauradas. Con el `lifespan` de `main.py` cerrando
 *  un `deps.remote_gen` que no existe, rojo en el apagado («shutdown failed»). Y un
 *  `kill -INT` al guion a mitad de corrida deja `ps` y `/tmp/qa-npc-cruza-*`
 *  vacíos: la limpieza es la misma para el `finally` y para las señales.
 *
 *  Lo que NO hace: no toca el guion 40 (`el-mismo-tile-…`), que mide la
 *  asimetría zod ↔ Python sobre payloads en memoria y la documenta como
 *  deliberada; no compara salidas saneadas por igualdad. Aquí la aserción es de
 *  CAMPO: dos campos sobreviven al viaje.
 *
 *  CERO CRÉDITOS: la clave de API es falsa y la URL base es el stub. No hay
 *  proveedor al que llamar. El asset-store no se levanta (best-effort en el
 *  arranque de ai_server y en la librería de assets: se le apunta a un puerto
 *  que nadie escucha, y el guion afirma que el ai_server arranca igual).
 *
 *  VECINOS: los puertos del bridge y la State API salen de `lib/stack.mjs`
 *  (`NEFAN_PORT_OFFSET` se honra); los del stub, ai_server y el asset-store
 *  muerto los elige el kernel. Con un puerto ocupado el guion se NIEGA y dice
 *  quién lo tiene; nunca mata a nadie. Sus tres hijos se matan por PID, también
 *  con Ctrl+C: SIGINT/SIGTERM corren la misma limpieza que el `finally` (hijos
 *  por PID + disco efímero) y salen con 130/143. Sin manejador, Node muere sin
 *  pasar por ningún `finally`, y quedaban dos huérfanos escuchando — uno de
 *  ellos un ai_server con `ANTHROPIC_API_KEY` en el entorno.
 *
 *  Vive FUERA de `qa/guiones/` como sus hermanos `el-ledger-…` y
 *  `el-selector-…`: no toca la página y en la batería pagaría un Chromium por
 *  nada. Es headless a propósito: corre en CI (job `candados-headless`).
 *
 *  Uso:  node qa/el-npc-cruza-ai-server-con-role-y-description.mjs
 *
 *  Salida: 0 todo verde · 1 alguna comprobación en rojo · 2 no llegó a medir.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUERTOS, offsetActual } from "./lib/stack.mjs";
import { interpretePython } from "./lib/python.mjs";
import {
  duenyosDeLosPuertos,
  esperarPuertoArriba,
  esperarPuertoLibre,
  puertoOcupado,
  puertosLibres,
} from "./lib/puertos.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(RAIZ, "nefan-core");
const STUB = join(RAIZ, "labs", "narrative", "fake-anthropic.ts");
const AI_SERVER = join(RAIZ, "ai_server", "main.py");
const BRIDGE = join(CORE, "bridge", "ws-server.ts");
const GAME = "alta_fantasia";
const GAMES_ORIGEN = join(CORE, "data", "games");
const PLUGINS_ORIGEN = join(CORE, "data", "plugins");
const WORLD_DEL_CHECKOUT = join(GAMES_ORIGEN, GAME, "world");
const CLAVE_FALSA = "banco-sin-creditos";
/** Cortafuegos de la espera de la escena. No es la condición de parada —eso es
 *  el `scene_loaded` o un `narrative_status: error`—, es lo que impide que un
 *  bridge mudo cuelgue el CI. Medido: el viaje entero tarda ~2 s. */
const ESCENA_MAX_MS = 90_000;

/** El intérprete: `NEFAN_PYTHON` si está, el `.venv` del checkout si existe,
 *  el `python3` del sistema si no (CI). Un worktree desprendido, que no tiene
 *  `.venv`, lo dice con la variable en vez de tener una ruta ajena en el repo. */
const PY = interpretePython(RAIZ);

const fallos = [];
const expect = (desc, cond, detalle = "") => {
  console.log(`  ${cond ? "✔" : "✘"} ${desc}${cond || !detalle ? "" : ` — ${detalle}`}`);
  if (!cond) fallos.push(desc);
};

class SinMedir extends Error {}

/** Un hijo con su log capturado, para enseñarlo si algo sale rojo y para
 *  afirmar sobre lo que dijo por consola. */
function arrancar(nombre, cmd, args, opts) {
  const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  const hijo = { nombre, p, log: "", muerto: null, salida: null };
  const acumula = (chunk) => {
    hijo.log += chunk.toString("utf8");
    if (hijo.log.length > 200_000) hijo.log = hijo.log.slice(-100_000);
  };
  p.stdout.on("data", acumula);
  p.stderr.on("data", acumula);
  p.on("exit", (code, signal) => {
    hijo.salida = { code, signal };
    hijo.muerto = `salió (code=${code} signal=${signal})`;
  });
  hijos.push(hijo);
  return hijo;
}

/** Los hijos vivos y el disco efímero, a nivel de módulo para que la limpieza
 *  pueda correr desde una señal, no solo desde el `finally` de `main`. */
const hijos = [];
let tmp = null;
let limpiando = null;

/** La limpieza, UNA sola para todos los caminos: el `finally` del flujo normal
 *  y los manejadores de SIGINT/SIGTERM. Idempotente: quien llegue segundo
 *  espera a la misma promesa. */
function limpiar() {
  if (!limpiando) {
    limpiando = (async () => {
      for (const h of [...hijos].reverse()) await matar(h);
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    })();
  }
  return limpiando;
}

// Sin esto, un Ctrl+C mata al guion SIN pasar por ningún `finally` (Node no
// rechaza la promesa en curso) y sus hijos quedan reparentados y escuchando.
for (const [señal, codigo] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(señal, async () => {
    console.log(`\n⊘ INTERRUMPIDO (${señal}) — matando a los hijos por PID y borrando el disco efímero`);
    await limpiar();
    process.exit(codigo);
  });
}

/** SIGTERM por PID y, si no se va, SIGKILL. Solo a los hijos de este guion. */
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

const cola = (log, n = 25) => log.trim().split("\n").slice(-n).join("\n    ");

async function saludable(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

/** Un valor cualquiera, recortado para el detalle de un `expect`. */
const corto = (x, n = 200) => JSON.stringify(x ?? null).slice(0, n);

/** `start_session` por el mismo socket que abriría el cliente, y la escucha
 *  hasta la escena Y su `ready` (`broadcastScene` emite primero el
 *  `narrative_event` con `scene_loaded` y detrás el `narrative_status: ready`
 *  que dice de dónde salió la escena). Devuelve todo lo recibido más la
 *  escena servida. */
function jugarElArranque(puertoBridge) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${puertoBridge}`);
    const recibidos = [];
    let escena = null;
    let cerrado = false;
    const fin = (fn, v) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(cortafuegos);
      try {
        ws.close();
      } catch {
        // ya cerrado por el otro lado: lo que importa es el veredicto
      }
      fn(v);
    };
    const cortafuegos = setTimeout(
      () =>
        fin(
          reject,
          new Error(
            `el bridge no difundió scene_loaded + ready en ${ESCENA_MAX_MS / 1000} s; ` +
              `mensajes recibidos: ${recibidos.map((m) => m.type + (m.phase ? `/${m.phase}` : "")).join(", ") || "ninguno"}`,
          ),
        ),
      ESCENA_MAX_MS,
    );
    ws.addEventListener("error", (e) => fin(reject, new Error(`WebSocket: ${e.message ?? "error"}`)));
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "start_session", requestId: "qa-npc-cruza", gameId: GAME }));
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return fin(reject, new Error(`el bridge mandó algo que no es JSON: ${String(ev.data).slice(0, 200)}`));
      }
      recibidos.push(msg);
      if (msg.type === "session_started" && msg.ok === false) {
        return fin(reject, new Error(`session_started ok:false — ${msg.error}`));
      }
      if (msg.type === "narrative_status" && msg.phase === "error") {
        return fin(reject, new Error(`narrative_status error — ${msg.message}`));
      }
      if (msg.type === "narrative_event") {
        const efecto = (msg.effects ?? []).find((e) => e.kind === "scene_loaded");
        if (efecto) escena = efecto.scene;
      }
      if (msg.type === "narrative_status" && msg.phase === "ready" && escena) {
        return fin(resolve, { recibidos, escena });
      }
    });
  });
}

async function main() {
  const t0 = Date.now();
  console.log("▶ el NPC cruza ai_server (HTTP real) con role y description\n");

  // ── precondiciones: sin ellas no se mide, y se dice ─────────────────────
  const deps = spawnSync(PY, ["-c", "import anthropic, uvicorn, fastapi, httpx, PIL, numpy"], { encoding: "utf8" });
  if (deps.status !== 0) {
    throw new SinMedir(
      `el intérprete ${PY} no trae las deps del ai_server real (anthropic, uvicorn, fastapi, httpx, pillow, numpy): ` +
        cola(deps.stderr, 3),
    );
  }
  if (!existsSync(join(CORE, "node_modules", "tsx"))) {
    throw new SinMedir("falta nefan-core/node_modules/tsx — corre `npm ci` en nefan-core");
  }
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
  const [puertoStub, puertoAi, puertoMuerto] = await puertosLibres(3);
  console.log(
    `  · puertos: bridge :${puertoBridge}, state :${puertoState} (offset ${offsetActual()}); ` +
      `stub :${puertoStub}, ai_server :${puertoAi}, asset-store MUERTO :${puertoMuerto}\n`,
  );

  // ── disco efímero: el árbol no se toca ──────────────────────────────────
  const worldAntes = existsSync(WORLD_DEL_CHECKOUT) ? readdirSync(WORLD_DEL_CHECKOUT).sort() : null;
  tmp = mkdtempSync(join(tmpdir(), "qa-npc-cruza-"));
  const games = join(tmp, "games");
  const saves = join(tmp, "saves");
  mkdirSync(games);
  mkdirSync(saves);
  cpSync(join(GAMES_ORIGEN, GAME), join(games, GAME), { recursive: true });
  cpSync(PLUGINS_ORIGEN, join(tmp, "plugins"), { recursive: true });
  // Sin snapshot: si la copia trajera un `world/`, el bridge serviría la escena
  // sin llamar a nadie y el tramo que se quiere medir no se recorrería.
  rmSync(join(games, GAME, "world"), { recursive: true, force: true });

  try {
    // ── 1 · el stub del modelo ──────────────────────────────────────────
    const stub = arrancar("fake-anthropic", process.execPath, ["--import", "tsx", STUB], {
      cwd: CORE,
      env: { ...process.env, PORT: String(puertoStub) },
    });
    await esperarPuertoArriba(puertoStub, { quien: "fake-anthropic", siMuere: () => stub.muerto && cola(stub.log) });
    const stubUrl = `http://127.0.0.1:${puertoStub}`;
    expect("el stub arranca sin haber servido nada (llamadas = 0)", (await saludable(`${stubUrl}/health`)).llamadas === 0);

    // ── 2 · el ai_server REAL, con el modelo sustituido y el MCP apagado ─
    const ai = arrancar("ai_server", PY, ["-u", AI_SERVER, "--port", String(puertoAi)], {
      cwd: RAIZ,
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: stubUrl,
        ANTHROPIC_API_KEY: CLAVE_FALSA,
        NEFAN_LLM_MCP_URL: "off",
        NEFAN_URL_ASSET_STORE: `http://127.0.0.1:${puertoMuerto}`,
      },
    });
    await esperarPuertoArriba(puertoAi, { quien: "ai_server", siMuere: () => ai.muerto && cola(ai.log) });
    const aiUrl = `http://127.0.0.1:${puertoAi}`;
    const salud = await saludable(`${aiUrl}/health`);
    expect("1 · el ai_server es el REAL: /health dice fake:false y status ready", salud.fake === false && salud.status === "ready", JSON.stringify(salud));
    expect("1 · …y arrancó con el asset-store caído (best-effort, no requisito)", /asset-store .*unavailable/.test(ai.log), cola(ai.log, 5));
    expect("1 · …con el canal MCP APAGADO por NEFAN_LLM_MCP_URL=off", /canal MCP desactivado/.test(ai.log), cola(ai.log, 5));
    expect("1 · …y la API directa como único backend", /Claude API direct mode/.test(ai.log), cola(ai.log, 5));

    // ── 3 · el bridge real, apuntado a ese ai_server y al disco efímero ──
    const bridge = arrancar("bridge", process.execPath, ["--import", "tsx", BRIDGE], {
      cwd: CORE,
      env: {
        ...process.env,
        NEFAN_AI_SERVER: aiUrl,
        NEFAN_GAMES_DIR: games,
        NEFAN_SAVES_DIR: saves,
        NEFAN_BRIDGE_PORT: String(puertoBridge),
        NEFAN_STATE_HTTP_PORT: String(puertoState),
      },
    });
    await esperarPuertoArriba(puertoBridge, { quien: "bridge", siMuere: () => bridge.muerto && cola(bridge.log) });

    // ── 4 · start_session → scene_loaded ────────────────────────────────
    const tEscena = Date.now();
    const { recibidos, escena } = await jugarElArranque(puertoBridge);
    console.log(`  · scene_loaded + ready a los ${Date.now() - tEscena} ms del start_session\n`);
    const arrancada = recibidos.find((m) => m.type === "session_started");
    expect("2 · session_started ok:true", arrancada?.ok === true, corto(arrancada));
    const ready = recibidos.find((m) => m.type === "narrative_status" && m.phase === "ready");
    expect("2 · el ready dice source:engine (no snapshot, no caché)", ready?.source === "engine", corto(ready));

    // Lo que el stub SIRVIÓ, leído del stub: es el verbatim contra el que se
    // compara el wire, no una cadena copiada a este fichero. Un 404 aquí NO es
    // «no pude medir»: es que la escena que llegó no vino por el stub (un
    // snapshot, otro modelo), y eso es ROJO con nombre.
    const rServido = await fetch(`${stubUrl}/servido`);
    expect("3 · el stub sirvió una escena: lo que llegó al wire vino por aquí", rServido.ok, `GET /servido → HTTP ${rServido.status}`);
    const servido = rServido.ok ? await rServido.json() : { api_key: null, tool_choice: null, input: { entities: [] } };
    const declarados = Object.fromEntries((servido.input?.entities ?? []).map((e) => [e.id, e]));
    const npcs = Array.isArray(escena?.npcs) ? escena.npcs : [];
    const barkeep = npcs.find((n) => n.id === "barkeep");
    const bandido = npcs.find((n) => n.id === "bandido_1");
    expect("2 · el wire trae npcs[] con barkeep y bandido_1", Boolean(barkeep && bandido), `ids: ${npcs.map((n) => n.id).join(", ") || "ninguno"}`);
    expect("2 · barkeep llega con role:\"merchant\"", barkeep?.role === "merchant", `role=${JSON.stringify(barkeep?.role)}`);
    expect(
      "2 · barkeep llega con su description VERBATIM (la que el stub sirvió)",
      typeof barkeep?.description === "string" &&
        barkeep.description.length > 0 &&
        barkeep.description === declarados.barkeep?.description,
      `wire=${JSON.stringify(barkeep?.description)} servido=${JSON.stringify(declarados.barkeep?.description)}`,
    );
    expect("2 · bandido_1 llega con role:\"hostile\"", bandido?.role === "hostile", `role=${JSON.stringify(bandido?.role)}`);
    expect(
      "2 · bandido_1 llega con description VERBATIM",
      typeof bandido?.description === "string" && bandido.description === declarados.bandido_1?.description,
      `wire=${JSON.stringify(bandido?.description)}`,
    );
    expect("2 · …y con el combat que el core deriva del role hostil", bandido?.combat !== undefined && bandido?.combat !== null, JSON.stringify(bandido?.combat));

    // ── 5 · el banco no puede mentir ────────────────────────────────────
    const health = await saludable(`${stubUrl}/health`);
    expect("3 · el stub recibió EXACTAMENTE 1 llamada", health.llamadas === 1, `llamadas=${health.llamadas}`);
    expect("3 · …con la clave FALSA (ninguna clave real viajó)", servido.api_key === CLAVE_FALSA, `x-api-key=${JSON.stringify(servido.api_key)}`);
    expect("3 · …pidiendo la tool generate_scene", servido.tool_choice?.name === "generate_scene", JSON.stringify(servido.tool_choice));
    expect("3 · el ai_server dice por consola que la escena vino por la API", /Scene via API/.test(ai.log), cola(ai.log, 5));

    // ── 6 · el árbol no se ensucia ──────────────────────────────────────
    const snapshotEfimero = join(games, GAME, "world");
    expect(
      "4 · el snapshot del mundo cayó en el disco efímero",
      existsSync(snapshotEfimero) && readdirSync(snapshotEfimero).length > 0,
      snapshotEfimero,
    );
    const worldDespues = existsSync(WORLD_DEL_CHECKOUT) ? readdirSync(WORLD_DEL_CHECKOUT).sort() : null;
    expect(
      "4 · …y data/games/alta_fantasia/world/ del checkout está como estaba",
      JSON.stringify(worldAntes) === JSON.stringify(worldDespues),
      `antes=${JSON.stringify(worldAntes)} después=${JSON.stringify(worldDespues)}`,
    );

    // ── 7 · apagado limpio del ai_server ────────────────────────────────
    // SIGTERM por PID, como haría start.sh. Lo que se mira es el LOG, no el
    // código: uvicorn captura la señal, apaga el lifespan y después la
    // RE-LANZA (`server.py`, `capture_signals`), así que un ai_server sano
    // muere por SIGTERM con `code=null` — `code === 0` sería rojo para siempre.
    // Lo que sí distingue el apagado sano del roto es «Application shutdown
    // complete.» frente a «Application shutdown failed. Exiting.»: hasta el
    // 2026-09-05 el `lifespan` de main.py cerraba un `deps.remote_gen` que no
    // existe desde que remote-gen es otro proceso, fallaba en CADA corrida, y
    // nadie lo leía porque ningún guion miraba cómo mueren sus hijos.
    await matar(ai);
    const apagado = ai.log.slice(ai.log.indexOf("Waiting for application shutdown"));
    expect(
      "5 · el ai_server se apaga limpio con SIGTERM («shutdown complete», muerto por la señal)",
      ai.salida?.signal === "SIGTERM" &&
        /Application shutdown complete\./.test(apagado) &&
        !/shutdown failed/i.test(apagado),
      `${ai.muerto} · ${cola(apagado, 4)}`,
    );
  } catch (e) {
    for (const h of hijos) {
      console.log(`\n  ── log de ${h.nombre} (cola) ──\n    ${cola(h.log)}`);
    }
    throw e;
  } finally {
    await limpiar();
    for (const puerto of [puertoBridge, puertoState, puertoAi, puertoStub]) {
      if (!(await esperarPuertoLibre(puerto))) console.log(`  ⚠ :${puerto} no se soltó tras matar a su dueño`);
    }
  }

  console.log(`\n  · ${((Date.now() - t0) / 1000).toFixed(1)} s en total`);
  if (fallos.length) {
    console.log(`ROJO — ${fallos.length} comprobación(es) fallaron.`);
    return 1;
  }
  console.log("VERDE — role y description cruzan el ai_server real por HTTP y llegan al wire.");
  return 0;
}

let code = 2;
try {
  code = await main();
} catch (e) {
  if (e instanceof SinMedir) console.log(`\n⊘ SIN MEDIR — ${e.message}`);
  else console.log(`\n⊘ SIN MEDIR — ${e?.stack ?? e}`);
}
process.exit(code);
