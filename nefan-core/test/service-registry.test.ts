/** F1: los CLIENTES resuelven destino con resolveServiceUrl (SERVICES del
 *  contrato); los SERVIDORES leen su puerto de escucha de CONFIG. Este test
 *  ata las dos fuentes para que no deriven en silencio, y fija el
 *  comportamiento de resolveServiceUrl. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CONFIG } from "../src/config.js";
import { SERVICES, resolveServiceUrl, portOf, portOffset } from "../src/contracts/common.js";

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

describe("NEFAN_PORT_OFFSET — un bloque de puertos por stack", () => {
  it("sin variable (o vacía) el bloque es EXACTAMENTE el de siempre", () => {
    // Es la promesa de «nada de esto rompe el uso de una sola persona»: quien
    // no sabe que esto existe tiene que ver los mismos números de ayer.
    for (const env of [{}, { NEFAN_PORT_OFFSET: "" }, { NEFAN_PORT_OFFSET: undefined }]) {
      assert.equal(portOffset(env), 0);
      assert.equal(portOf("game-gateway", env), SERVICES["game-gateway"].currentPort);
      assert.equal(resolveServiceUrl("game-gateway", env), "ws://127.0.0.1:9877");
    }
  });

  it("con offset, TODOS los servicios se mueven el mismo salto", () => {
    const env = { NEFAN_PORT_OFFSET: "100" };
    assert.equal(resolveServiceUrl("game-gateway", env), "ws://127.0.0.1:9977");
    assert.equal(resolveServiceUrl("world-state", env), "http://127.0.0.1:9978");
    assert.equal(resolveServiceUrl("narrative-llm", env), "http://127.0.0.1:8865");
    assert.equal(resolveServiceUrl("asset-store", env), "http://127.0.0.1:8867");
    assert.equal(resolveServiceUrl("remote-gen", env), "http://127.0.0.1:8868");
  });

  it("un override de URL sigue ganando: el offset no lo toca", () => {
    // El `?ai=` del bench trae la URL COMPLETA del motor falso; sumarle el
    // offset la rompería.
    const env = { NEFAN_PORT_OFFSET: "100", NEFAN_URL_NARRATIVE_LLM: "http://127.0.0.1:18865" };
    assert.equal(resolveServiceUrl("narrative-llm", env), "http://127.0.0.1:18865");
  });

  it("un offset que no es un entero en rango LANZA, no colapsa a 0", () => {
    // Colapsar a 0 sería arrancar encima del stack del vecino justo cuando el
    // usuario creía haberlo separado: el fallo silencioso más caro de todos.
    for (const raw of ["cien", "NaN", "1.5", "-1", "40001", "0x10", " "]) {
      assert.throws(
        () => portOffset({ NEFAN_PORT_OFFSET: raw }),
        /NEFAN_PORT_OFFSET inválido/,
        `"${raw}" debería rechazarse`,
      );
    }
  });
});
