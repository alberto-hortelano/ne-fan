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
    // Extraídos: puerto propio, atado a su entrada de CONFIG.ports. Debajo
    // hubo un bucle que decía comprobar que los servicios "sin extraer"
    // escuchan donde ai_server, y no ejecutaba NINGUNA de sus aserciones: su
    // guarda era `extractionPhase !== undefined` sobre asset-store y
    // remote-gen, que no lo declaran (`as const satisfies` en
    // src/contracts/service-registry.ts). De haberse ejecutado habría fallado,
    // comparando 8767/8768 contra CONFIG.ai_server.port (8765). Borrado
    // entero en #231a: las dos líneas de arriba ya afirman lo correcto.
  });
});

describe("resolveServiceUrl", () => {
  it("sin env → loopback con el puerto ACTUAL y esquema del protocolo", () => {
    assert.equal(resolveServiceUrl("narrative-llm"), "http://127.0.0.1:8765");
    assert.equal(resolveServiceUrl("world-state"), "http://127.0.0.1:9878");
    assert.equal(resolveServiceUrl("game-gateway"), "ws://127.0.0.1:9877");
  });

  it("override NEFAN_URL_<NAME> gana y pierde la barra final", () => {
    const env = { NEFAN_URL_ASSET_STORE: "http://10.0.0.5:18767///" };
    assert.equal(resolveServiceUrl("asset-store", env), "http://10.0.0.5:18767");
    // Un env con otros overrides no afecta a este servicio (asset-store ya
    // extraído en F2 → su puerto propio).
    assert.equal(
      resolveServiceUrl("asset-store", { NEFAN_URL_REMOTE_GEN: "http://x:1" }),
      "http://127.0.0.1:8767",
    );
  });
});
