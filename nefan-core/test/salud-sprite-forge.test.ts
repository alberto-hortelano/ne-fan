/** El preflight de sprite-forge (#367): los cuatro veredictos.
 *
 *  Lo que este fichero existe para impedir es el ✅ MENTIROSO. `start.sh`
 *  comprobaba la salud del servicio con `curl -sf …/catalog`, y `/catalog`
 *  responde 200 con la mitad de repintado apagada: el stack arrancaba en verde
 *  y el jugador se enteraba tres saltos después, con un mundo de maniquíes.
 *
 *  El caso «ok» se alimenta con la FIXTURE CANÓNICA del servicio real
 *  (`data/contract/fixtures/sprite-forge/catalog.json`, emitida por su `npm run
 *  fixtures-contrato`), no con un objeto escrito a mano: un veredicto que solo
 *  sabe leer catálogos inventados por su propio test no vale para nada. Los
 *  demás casos parten de esa misma fixture y le cambian UNA cosa.
 *
 *  PROBADO EN NEGATIVO (2026-09-01): devolviendo `nivel:"ok"` sin mirar
 *  `skin.enabled` —el comportamiento de antes de la tanda—, «el repintado
 *  apagado es un AVISO y cita el motivo» se pone rojo. Revertido.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { veredictoDeForge } from "../scripts/salud-sprite-forge.js";

const RAIZ = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CATALOGO = JSON.parse(
  readFileSync(join(RAIZ, "data/contract/fixtures/sprite-forge/catalog.json"), "utf8"),
) as Record<string, unknown>;

/** La fixture canónica con el bloque `skin` sustituido. */
function conSkin(skin: unknown): Record<string, unknown> {
  return { ...CATALOGO, skin };
}

describe("veredictoDeForge", () => {
  it("un catálogo REAL con el repintado disponible es ok", () => {
    const v = veredictoDeForge({ tipo: "catalogo", json: CATALOGO });
    assert.equal(v.nivel, "ok");
    // El api y el modelo van en la línea: es lo que dice CON QUÉ se va a
    // pintar, y lo que delata un despliegue apuntando a otro proveedor.
    assert.match(v.linea, /fixture/);
    assert.match(v.linea, /gpt-image-2/);
  });

  it("el repintado apagado es un AVISO y cita el motivo del servicio", () => {
    // El caso vivo de #367: `/catalog` responde 200 y todo parece bien.
    const motivo = "falta `rembg` (quita el fondo del repintado): pip install -r python/requirements.txt";
    const v = veredictoDeForge({
      tipo: "catalogo",
      json: conSkin({ enabled: false, reason: motivo }),
    });
    assert.equal(v.nivel, "aviso");
    assert.ok(
      v.linea.includes(motivo),
      `la línea tiene que traer el skin.reason del servicio, y trajo: ${v.linea}`,
    );
  });

  it("un catálogo que no cumple el contrato NO se interpreta a ojo", () => {
    // Si el repo hermano y este espejo divergen, leer `skin.enabled` es
    // adivinar: se avisa diciendo dónde falló el zod.
    const v = veredictoDeForge({
      tipo: "catalogo",
      json: conSkin({ enabled: false }), // sin `reason`: un no-puedo mudo
    });
    assert.equal(v.nivel, "aviso");
    assert.match(v.linea, /skin\.reason|reason/);
  });

  it("un catálogo de otro servicio tampoco se da por bueno", () => {
    const v = veredictoDeForge({ tipo: "catalogo", json: { service: "otra-cosa" } });
    assert.equal(v.nivel, "aviso");
    assert.match(v.linea, /NO es su catálogo/);
  });

  it("el repo sin clonar avisa y nombra el remedio", () => {
    const v = veredictoDeForge({ tipo: "sin-repo", dir: "/home/x/code/sprite-forge" });
    assert.equal(v.nivel, "aviso");
    assert.match(v.linea, /\/home\/x\/code\/sprite-forge/);
    assert.match(v.linea, /NEFAN_SPRITE_FORGE_DIR/);
  });

  it("un servicio que no contesta avisa con lo último que se supo de él", () => {
    const v = veredictoDeForge({
      tipo: "sin-respuesta",
      url: "http://127.0.0.1:1/catalog",
      segundos: 90,
      detalle: "ECONNREFUSED",
    });
    assert.equal(v.nivel, "aviso");
    assert.match(v.linea, /ECONNREFUSED/);
    assert.match(v.linea, /90 s/);
  });

  it("NINGÚN veredicto es fatal: el juego arranca siempre", () => {
    // La decisión del usuario, escrita como aserto. Si algún día alguien
    // añade un nivel «error», este test le obliga a venir aquí a discutirlo.
    const sondeos = [
      { tipo: "catalogo", json: CATALOGO },
      { tipo: "catalogo", json: conSkin({ enabled: false, reason: "sin clave" }) },
      { tipo: "catalogo", json: { nada: 1 } },
      { tipo: "sin-repo", dir: "/x" },
      { tipo: "sin-respuesta", url: "u", segundos: 1, detalle: "d" },
    ] as const;
    for (const s of sondeos) {
      const v = veredictoDeForge(s);
      assert.ok(v.nivel === "ok" || v.nivel === "aviso", `nivel inesperado: ${v.nivel}`);
      assert.ok(v.linea.length > 20, `una línea sin causa no sirve: ${v.linea}`);
    }
  });

  it("todo aviso dice qué va a ver el jugador, no solo qué falló", () => {
    // Un aviso que solo dice «skin.enabled=false» no le dice a nadie que el
    // mundo va a salir de maniquíes: la consecuencia es la mitad del mensaje.
    const avisos = [
      veredictoDeForge({ tipo: "catalogo", json: conSkin({ enabled: false, reason: "sin clave" }) }),
      veredictoDeForge({ tipo: "sin-repo", dir: "/x" }),
      veredictoDeForge({ tipo: "sin-respuesta", url: "u", segundos: 1, detalle: "d" }),
      veredictoDeForge({ tipo: "catalogo", json: { nada: 1 } }),
    ];
    for (const v of avisos) {
      assert.equal(v.nivel, "aviso");
      assert.match(v.linea, /maniquí/, `sin consecuencia para el jugador: ${v.linea}`);
    }
  });
});
