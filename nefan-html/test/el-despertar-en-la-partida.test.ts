/** EL DESPERTAR EN EL CLIENTE, fuera del game loop (#613, tanda BN).
 *
 *  Dos costuras que vivían dentro de `main.ts` —en `gameLoop` y en el manejador
 *  de `narrative_status`— y que salieron de allí para poder probarlas (y para
 *  no sumarles ramas a dos funciones que el CRAP del cliente congela):
 *   · `aplicarElDespertar`: el frame del despertar mueve al jugador al punto y
 *     le pone la mirada;
 *   · `atenderStatusDelDespertar`: qué hace la partida con un status de kind
 *     `despertar` —el velo decide si cuenta; un error cierra la espera del
 *     viaje, quita un «Viajando...» y va a la línea de mensajes—. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aplicarElDespertar } from "../src/net/frame-del-bridge.js";
import { accionDelCaido, atenderStatusDelDespertar } from "../src/ui/velo-del-despertar.js";

describe("aplicarElDespertar", () => {
  it("con despertar: mueve al punto y pone la mirada", () => {
    const pos = { x: 5, z: 5 };
    const yaws: number[] = [];
    assert.equal(aplicarElDespertar({ reaparicion: { x: 1, y: 0, z: -2 }, miradaAlDespertar: 0.5 }, pos, (y) => yaws.push(y)), true);
    assert.deepEqual(pos, { x: 1, z: -2 });
    assert.deepEqual(yaws, [0.5]);
  });
  it("sin mirada: mueve y no toca la mirada; sin despertar: no toca nada", () => {
    const pos = { x: 5, z: 5 };
    const yaws: number[] = [];
    aplicarElDespertar({ reaparicion: { x: 1, y: 0, z: -2 } }, pos, (y) => yaws.push(y));
    assert.equal(yaws.length, 0);
    assert.equal(aplicarElDespertar({}, pos, (y) => yaws.push(y)), false);
    assert.deepEqual(pos, { x: 1, z: -2 });
  });
});

describe("atenderStatusDelDespertar", () => {
  const conDeps = () => {
    const hecho: string[] = [];
    const vistos: unknown[] = [];
    return {
      hecho,
      vistos,
      deps: {
        velo: { alStatus: (s: unknown) => void vistos.push(s) },
        cerrarViaje: (m: string) => void hecho.push(`viaje: ${m}`),
        quitarMuroDeEspera: () => void hecho.push("muro"),
        pintarFallo: () => void hecho.push("pintar"),
      },
    };
  };
  it("«decidiendo»: solo el velo", () => {
    const { hecho, vistos, deps } = conDeps();
    atenderStatusDelDespertar({ phase: "generating", message: "…" }, deps);
    assert.equal(vistos.length, 1);
    assert.deepEqual(hecho, []);
  });
  it("un error (o un rechazo): el velo lo ve, se cierra el viaje con el motivo, se quita el muro y se pinta", () => {
    const { hecho, vistos, deps } = conDeps();
    atenderStatusDelDespertar({ phase: "error", message: "Estás caído: no puedes viajar.", rechazo: true }, deps);
    assert.equal(vistos.length, 1);
    assert.deepEqual(hecho, ["viaje: Estás caído: no puedes viajar.", "muro", "pintar"]);
    const otro = conDeps();
    atenderStatusDelDespertar({ phase: "error" }, otro.deps);
    assert.equal(otro.hecho[0], "viaje: sin mensaje");
  });
});

describe("accionDelCaido", () => {
  it("R solo si el motor falló (reintentar) o sin motor (reaparecer); decidiendo o vivo, nada", () => {
    const r = () => {};
    assert.equal(accionDelCaido({ de: "fallo", motivo: "x" }, r)[0]?.label, "reintentar");
    assert.equal(accionDelCaido({ de: "sin_motor" }, r)[0]?.label, "reaparecer");
    assert.deepEqual(accionDelCaido({ de: "decidiendo" }, r), []);
    assert.deepEqual(accionDelCaido({ de: "vivo" }, r), []);
  });
});
