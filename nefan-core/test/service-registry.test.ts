/** F1: los CLIENTES resuelven destino con resolveServiceUrl (SERVICES del
 *  contrato); los SERVIDORES leen su puerto de escucha de CONFIG. Este test
 *  ata las dos fuentes para que no deriven en silencio, y fija el
 *  comportamiento de resolveServiceUrl. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/config.js";
import { SERVICES, resolveServiceUrl } from "../src/contracts/common.js";

describe("registro de servicios ↔ config", () => {
  it("currentPort de cada servicio coincide con el puerto de escucha de CONFIG", () => {
    assert.equal(SERVICES["game-gateway"].currentPort, CONFIG.ports.bridge);
    assert.equal(SERVICES["world-state"].currentPort, CONFIG.ports.state_api);
    assert.equal(SERVICES["narrative-llm"].currentPort, CONFIG.ai_server.port);
    // Los servicios aún no extraídos co-viven en ai_server: mismo puerto.
    for (const name of ["gpu-worker", "asset-store", "remote-gen"] as const) {
      if (SERVICES[name].extractionPhase !== undefined) {
        assert.equal(SERVICES[name].currentPort, CONFIG.ai_server.port,
          `${name} sin extraer debe escuchar donde ai_server`);
      }
    }
  });
});

describe("resolveServiceUrl", () => {
  it("sin env → loopback con el puerto ACTUAL y esquema del protocolo", () => {
    assert.equal(resolveServiceUrl("narrative-llm"), "http://127.0.0.1:8765");
    assert.equal(resolveServiceUrl("world-state"), "http://127.0.0.1:9878");
    assert.equal(resolveServiceUrl("game-gateway"), "ws://127.0.0.1:9877");
  });

  it("override NEFAN_URL_<NAME> gana y pierde la barra final", () => {
    const env = { NEFAN_URL_ASSET_STORE: "http://10.0.0.5:8767///" };
    assert.equal(resolveServiceUrl("asset-store", env), "http://10.0.0.5:8767");
    // Un env con otros overrides no afecta a este servicio.
    assert.equal(
      resolveServiceUrl("asset-store", { NEFAN_URL_GPU_WORKER: "http://x:1" }),
      "http://127.0.0.1:8765",
    );
  });
});
