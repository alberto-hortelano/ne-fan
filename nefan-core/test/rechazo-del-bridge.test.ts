/** `qa/lib/rechazo-del-bridge.mjs` (#739): qué es «el bridge rechazó», escrito
 *  una vez para los tres clientes WS del banco.
 *
 *  La misma tabla de casos corre DOS veces: contra `leerFrame` importada, que
 *  es lo que usa Node (`bridge-desde-node.mjs`), y contra la función
 *  RECONSTRUIDA desde `FUENTE_DE_LEER_FRAME`, que es lo que corre en la página
 *  (`cable.mjs`, `pedirYEsperarTile`). La segunda es la que importa: si alguien
 *  le añade a `leerFrame` un helper del módulo, la importada sigue verde y la
 *  reconstruida lanza `ReferenceError`, que es lo que haría la página al primer
 *  frame — sin navegador que lo viera. La dirección del import es test → banco
 *  (`el-banco-no-entra-en-produccion`). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Lectura = { frame: unknown; rechazo: { kind: string | null; message: string } | null };
type Leer = (data: unknown) => Lectura;

const mod = (await import(join(repoRoot, "qa", "lib", "rechazo-del-bridge.mjs"))) as {
  leerFrame: Leer;
  FUENTE_DE_LEER_FRAME: string;
};

/** Como la reconstruye la página: `new Function` sin nada del módulo a mano. */
const reconstruida = new Function(`return (${mod.FUENTE_DE_LEER_FRAME})`)() as Leer;

const LECTORAS: [string, Leer][] = [
  ["importada (Node)", mod.leerFrame],
  ["reconstruida desde su fuente (la página)", reconstruida],
];

for (const [quien, leer] of LECTORAS) {
  describe(`leerFrame, ${quien}`, () => {
    it("un `narrative_status/error` es rechazo, con su `kind` y su mensaje, y el frame viaja", () => {
      const f = { type: "narrative_status", phase: "error", kind: "protocolo", message: "no reconoce" };
      assert.deepEqual(leer(JSON.stringify(f)), { frame: f, rechazo: { kind: "protocolo", message: "no reconoce" } });
    });

    it("un error de CUALQUIER `kind` es rechazo: qué rechazos paran lo decide quien lee, no esto", () => {
      for (const kind of ["tile", "scene", "otro"]) {
        const r = leer(JSON.stringify({ type: "narrative_status", phase: "error", kind, message: "m" }));
        assert.deepEqual(r.rechazo, { kind, message: "m" });
      }
    });

    it("un error sin kind ni message no se pierde: `kind` null y «sin mensaje»", () => {
      assert.deepEqual(leer(JSON.stringify({ type: "narrative_status", phase: "error" })).rechazo, {
        kind: null,
        message: "sin mensaje",
      });
    });

    it("lo ilegible es rechazo `ilegible`, con el error y los primeros 200 bytes, y sin frame", () => {
      const basura = `{ roto ${"x".repeat(400)}`;
      const r = leer(basura);
      assert.equal(r.frame, null);
      assert.equal(r.rechazo?.kind, "ilegible");
      assert.match(r.rechazo?.message ?? "", /SyntaxError/);
      assert.ok(r.rechazo?.message.includes(basura.slice(0, 200)));
      assert.ok(!r.rechazo?.message.includes(basura.slice(0, 201)), "copió más de 200 bytes");
    });

    it("lo que no es string se lee como su texto y, si no es JSON, es ilegible (no lanza)", () => {
      assert.equal(leer({ no: "soy texto" }).rechazo?.kind, "ilegible");
      assert.equal(leer(undefined).rechazo?.kind, "ilegible");
      assert.deepEqual(leer(Buffer.from('{"type":"x"}')), { frame: { type: "x" }, rechazo: null });
    });

    it("lo demás NO es rechazo: otra fase, otro tipo, `null` o un escalar", () => {
      const casos = [
        { type: "narrative_status", phase: "ready", kind: "tile" },
        { type: "sessions_listed", sessions: [] },
        { type: "narrative_event", phase: "error" },
        null,
        3,
        "narrative_status",
      ];
      for (const f of casos) assert.deepEqual(leer(JSON.stringify(f)), { frame: f, rechazo: null }, JSON.stringify(f));
    });
  });
}

describe("la fuente que viaja a la página", () => {
  it("es la de `leerFrame`, y reconstruida da lo mismo que importada", () => {
    assert.equal(mod.FUENTE_DE_LEER_FRAME, mod.leerFrame.toString());
    assert.match(mod.FUENTE_DE_LEER_FRAME, /^function leerFrame\(data\)/);
  });

  it("una fuente que tira de un helper del módulo revienta al reconstruirla y leer: el candado de lo autocontenido, en negativo", () => {
    // Lo que pasaría si `leerFrame` llamase a algo de fuera de su cuerpo: la
    // página no lo tiene. Esta forma sale verde en Node y roja aquí.
    const conHelper = "function leerFrame(data) { return ayudante(data); }";
    const rota = new Function(`return (${conHelper})`)() as Leer;
    assert.throws(() => rota("{}"), ReferenceError);
  });
});
