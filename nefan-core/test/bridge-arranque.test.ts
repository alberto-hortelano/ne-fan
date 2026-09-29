/** El bridge ARRANCA de verdad (`bridge/arranque.ts`, #769): los dos
 *  servidores en puertos 0, un socket real que recibe su `bridge_hello`, el
 *  State API contestando y `cerrar()` soltando los dos puertos. Hasta #769 esto
 *  era código de nivel de módulo en `ws-server.ts` y no lo podía cargar ningún
 *  test sin levantar el bridge en los puertos del catálogo.
 *
 *  ROJO, NO COLGADO (QA de #769, H1). Este fichero abre servidores y sockets de
 *  verdad, así que una regresión del arranque —el oyente de `connection` que se
 *  pierde, un `cerrar()` que se deja un servidor— no puede traducirse en un
 *  proceso que no termina: en CI eso era un runner colgado horas en vez de un
 *  rojo. Por eso cada espera tiene PLAZO con motivo, cada test su `timeout`, y
 *  el `afterEach` suelta lo que `cerrar()` se haya dejado —después de que el
 *  aserto lo haya visto—, para que el proceso salga y el rojo se lea. */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { Server } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { arrancarBridge, type BridgeArrancado, type ConfigDelBridge } from "../bridge/arranque.js";
import { DATA_DIR, FIXTURE_GAMES, FIXTURE_STYLES } from "./helpers.js";

/** Lo que puede tardar un arranque en local sin que nada vaya mal: medido en
 *  ~40 ms; el plazo es de segundos para que una máquina cargada no dé rojo. */
const PLAZO_MS = 5_000;
/** Por test: tres plazos y el cierre. Un test que pase de esto está colgado. */
const TIMEOUT_TEST = { timeout: 20_000 };

function config(savesDir: string, over: Partial<ConfigDelBridge> = {}): ConfigDelBridge {
  return {
    port: 0,
    statePort: 0,
    entorno: "produccion",
    dataDir: DATA_DIR,
    gamesDir: FIXTURE_GAMES,
    stylesDir: FIXTURE_STYLES,
    savesDir,
    // Nadie escucha aquí: arrancar no habla con el motor.
    aiServerUrl: "http://127.0.0.1:9",
    ...over,
  };
}

/** El primer frame que recibe un cliente WS real, CON PLAZO: sin oyente de
 *  `connection` el socket abre y no oye nada nunca, y esperarlo sin plazo era
 *  colgar el test. El socket se termina pase lo que pase. */
function primerFrame(url: string): Promise<unknown> {
  return new Promise((ok, falla) => {
    const ws = new WebSocket(url);
    const plazo = setTimeout(() => {
      const abrio = ws.readyState === WebSocket.OPEN;
      ws.terminate();
      falla(
        new Error(
          `en ${PLAZO_MS} ms no llegó ningún frame a ${url} (el socket ${abrio ? "SÍ abrió" : "no abrió"}): ` +
            "¿se perdió el oyente de `connection` de arranque.ts?",
        ),
      );
    }, PLAZO_MS);
    ws.once("message", (raw) => {
      clearTimeout(plazo);
      ws.terminate();
      ok(JSON.parse(String(raw)));
    });
    ws.once("error", (err) => {
      clearTimeout(plazo);
      falla(err);
    });
  });
}

/** Reintenta `primerFrame` hasta que el gateway acepte: para el socket que
 *  llega mientras el bridge aún está arrancando. */
async function primerFrameEnCuantoAcepte(url: string): Promise<unknown> {
  const hasta = Date.now() + PLAZO_MS;
  for (;;) {
    try {
      return await primerFrame(url);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ECONNREFUSED" || Date.now() > hasta) throw err;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

/** ¿Se puede escuchar en este puerto? Es la prueba de que `cerrar()` lo soltó. */
function libre(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = createServer();
    s.once("error", () => ok(false));
    s.listen(port, "127.0.0.1", () => s.close(() => ok(true)));
  });
}

/** Un puerto que el sistema acaba de dar y ya no usa nadie. */
function puertoLibre(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => ok(port));
    });
  });
}

/** Los bridges que arranca cada test: el `afterEach` suelta lo que siga vivo. */
const vivos: BridgeArrancado[] = [];
afterEach(() => {
  for (const b of vivos.splice(0)) {
    for (const ws of b.servidores.ws.clients) ws.terminate();
    b.servidores.ws.close();
    if (b.servidores.stateApi.listening) {
      b.servidores.stateApi.closeAllConnections();
      b.servidores.stateApi.close();
    }
  }
});

describe("arrancar el bridge (#769)", () => {
  it("escucha en los dos puertos, saluda con el entorno, el State API contesta y cerrar() los suelta", TIMEOUT_TEST, async () => {
    const saves = mkdtempSync(join(tmpdir(), "nefan-arranque-"));
    const bridge = await arrancarBridge(config(saves));
    vivos.push(bridge);
    try {
      assert.ok(bridge.puertoWs > 0 && bridge.puertoStateApi > 0, "con puerto 0 devuelve los REALES");
      assert.deepEqual(await primerFrame(`ws://127.0.0.1:${bridge.puertoWs}`), {
        type: "bridge_hello",
        entorno: "produccion",
      });

      const health = await fetch(`http://127.0.0.1:${bridge.puertoStateApi}/health`, {
        signal: AbortSignal.timeout(PLAZO_MS),
      });
      assert.equal(health.status, 200);
      const body = (await health.json()) as Record<string, unknown>;
      assert.equal(body.gateway_url, `ws://127.0.0.1:${bridge.puertoWs}`, "el State API publica el gateway REAL");
      assert.equal(bridge.ctx.persistWorldSnapshots, true, "el bridge de verdad escribe snapshots");
    } finally {
      await bridge.cerrar();
      rmSync(saves, { recursive: true, force: true });
    }
    assert.equal(bridge.servidores.stateApi.listening, false, "cerrar() dejó el State API escuchando");
    assert.equal(await libre(bridge.puertoWs), true, "el gateway WS quedó libre");
    assert.equal(await libre(bridge.puertoStateApi), true, "el State API quedó libre");
  });

  it("el socket que llega ANTES de que el State API escuche también oye su bridge_hello (QA #769, H3)", TIMEOUT_TEST, async () => {
    const saves = mkdtempSync(join(tmpdir(), "nefan-arranque-"));
    const gateway = await puertoLibre();
    const statePort = await puertoLibre();
    // El State API tarda: se retrasa SU `listen` (y solo el suyo), que es el
    // hueco entre «el gateway ya acepta» y «arrancarBridge ha resuelto».
    const listenOriginal = Server.prototype.listen;
    let soltar!: () => void;
    const retenido = new Promise<void>((r) => (soltar = r));
    Server.prototype.listen = function (this: Server, ...args: unknown[]) {
      if (args[0] === statePort) {
        void retenido.then(() => listenOriginal.apply(this, args as Parameters<Server["listen"]>));
        return this;
      }
      return listenOriginal.apply(this, args as Parameters<Server["listen"]>);
    } as Server["listen"];
    const arrancando = arrancarBridge(config(saves, { port: gateway, statePort }));
    let frame: unknown;
    try {
      frame = await primerFrameEnCuantoAcepte(`ws://127.0.0.1:${gateway}`);
    } finally {
      // Pase lo que pase con el frame, el bridge termina de arrancar y queda
      // en `vivos`: si no, un rojo aquí dejaba el proceso colgado.
      soltar();
      Server.prototype.listen = listenOriginal;
      vivos.push(await arrancando);
      rmSync(saves, { recursive: true, force: true });
    }
    assert.deepEqual(frame, { type: "bridge_hello", entorno: "produccion" });
  });

  it("un puerto ocupado RECHAZA con el puerto en el motivo, y no deja medio bridge escuchando", TIMEOUT_TEST, async () => {
    const saves = mkdtempSync(join(tmpdir(), "nefan-arranque-"));
    const okupa = createServer();
    await new Promise<void>((ok) => okupa.listen(0, "127.0.0.1", ok));
    const ocupado = (okupa.address() as AddressInfo).port;
    // El gateway en un puerto CONOCIDO, para poder mirar después que se soltó:
    // con puerto 0 el rechazo no dice dónde había quedado escuchando.
    const gateway = await puertoLibre();
    try {
      await assert.rejects(
        arrancarBridge(config(saves, { port: gateway, statePort: ocupado })),
        new RegExp(`State API.*:${ocupado}`),
      );
      assert.equal(await libre(gateway), true, "el gateway WS que ya escuchaba se cerró con el rechazo");
    } finally {
      await new Promise<void>((ok) => okupa.close(() => ok()));
      rmSync(saves, { recursive: true, force: true });
    }
  });
});
