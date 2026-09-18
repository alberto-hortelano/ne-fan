/** El juicio de un tile pedido por el cable (#656): `qa/lib/tile-episodio.mjs`.
 *
 *  El sujeto es la parte PURA de la espera que el 120 y el 127 tenían copiada
 *  y que, al expirar, no decía nada. Está aquí y no en `qa/` por el mismo
 *  motivo que `esperas-de-qa.test.ts`: **el CI no corre la batería de navegador
 *  de `qa/`**, así que un módulo que solo ejerciera el runner local no lo
 *  comprobaría nadie hasta la siguiente corrida a mano. Y es además lo que
 *  `data/contract/banco-medido.json` exige a cambio de eximir a
 *  `qa/lib/sesion.mjs`: «la parte pura que tenga se extrae a un módulo propio y
 *  se mide». La dirección del import es test → banco
 *  (`el-banco-no-entra-en-produccion`, arch-rules.json).
 *
 *  Lo que NO se prueba aquí, dicho para que nadie lo dé por cubierto: que el
 *  socket quede abierto, que el bridge conteste por unicast y que el predicado
 *  pare en los tres desenlaces es conducir un navegador y un bridge, y vive en
 *  los guiones 120 y 127 con sus pruebas en negativo declaradas en su cabecera.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Episodio = {
  key: string;
  requested: number | null;
  arrived: number | null;
  source: "engine" | "cache" | "snapshot" | null;
  error: string | null;
};
type Veredicto = {
  estado: string;
  key: string;
  motivo: string | null;
  episodio: Episodio | null;
  libro: Episodio[];
  rechazos: unknown[];
  tiles: string[];
};

const mod = (await import(join(repoRoot, "qa", "lib", "tile-episodio.mjs"))) as {
  LLEGADO: string;
  FALLO: string;
  RECHAZADO: string;
  CALLADO: string;
  veredictoDeTile: (entrada?: unknown) => Veredicto;
  fraseDeTile: (v: unknown) => string;
};
const { LLEGADO, FALLO, RECHAZADO, CALLADO, veredictoDeTile, fraseDeTile } = mod;

const ep = (key: string, extra: Partial<Episodio> = {}): Episodio => ({
  key,
  requested: 1200,
  arrived: null,
  source: null,
  error: null,
  ...extra,
});

describe("veredictoDeTile · los cuatro desenlaces de un request_tile", () => {
  it("LLEGADO: el tile está en el mundo del cliente", () => {
    const v = veredictoDeTile({
      key: "tile_0_1",
      tiles: ["tile_0_0", "tile_0_1"],
      episodios: [ep("tile_0_1", { arrived: 1800, source: "engine" })],
      rechazos: [],
    });
    assert.equal(v.estado, LLEGADO);
    assert.equal(v.motivo, null);
    assert.match(fraseDeTile(v), /llegó \(fuente: engine\)/);
  });

  it("LLEGADO gana a todo lo demás: si acabó en el mundo, llegó", () => {
    // El caso real: el bridge difundió un error, el cliente reintentó y el tile
    // acabó llegando. Un veredicto que mirara el error primero pondría ROJO un
    // guion cuyo mundo está completo.
    const v = veredictoDeTile({
      key: "tile_1_0",
      tiles: ["tile_1_0"],
      episodios: [ep("tile_1_0", { arrived: 9000, source: "cache", error: "Error: la cola lo abandonó" })],
      rechazos: [{ kind: "protocolo", message: "basura anterior" }],
    });
    assert.equal(v.estado, LLEGADO);
  });

  it("FALLO: el bridge difundió un error para ESE tile, y el motivo es el suyo", () => {
    const v = veredictoDeTile({
      key: "tile_-1_-1",
      tiles: ["tile_0_0"],
      episodios: [
        ep("tile_0_0", { arrived: 10, source: "snapshot" }),
        ep("tile_-1_-1", { error: "fake-ai: TILE_MODE=error — el motor rechazó el tile" }),
      ],
      rechazos: [],
    });
    assert.equal(v.estado, FALLO);
    assert.equal(v.motivo, "fake-ai: TILE_MODE=error — el motor rechazó el tile");
    const frase = fraseDeTile(v);
    assert.match(frase, /el BRIDGE dijo que este tile FALLÓ/);
    assert.match(frase, /TILE_MODE=error/);
  });

  it("FALLO mira el episodio de SU key, no el de cualquiera", () => {
    const v = veredictoDeTile({
      key: "tile_2_2",
      tiles: [],
      episodios: [ep("tile_9_9", { error: "el vecino de al lado explotó" })],
      rechazos: [],
    });
    assert.equal(v.estado, CALLADO);
    assert.equal(v.episodio, null);
  });

  it("RECHAZADO: el bridge contestó por unicast al socket del guion", () => {
    const v = veredictoDeTile({
      key: "tile_0_1",
      tiles: [],
      episodios: [],
      rechazos: [{ kind: "protocolo", message: "El juego mandó un mensaje que el servidor no reconoce." }],
    });
    assert.equal(v.estado, RECHAZADO);
    assert.equal(v.motivo, "[protocolo] El juego mandó un mensaje que el servidor no reconoce.");
    assert.match(fraseDeTile(v), /RECHAZÓ el frame por unicast/);
  });

  it("RECHAZADO gana a FALLO: un frame rechazado no llegó a pedir nada", () => {
    // El error del libro sería de un intento ANTERIOR, y nombrarlo mandaría a
    // quien investiga al sitio equivocado. Este orden es el que decide.
    const v = veredictoDeTile({
      key: "tile_0_1",
      tiles: [],
      episodios: [ep("tile_0_1", { error: "Error: de la vez anterior" })],
      rechazos: [{ kind: "protocolo", message: "no reconoce el frame" }],
    });
    assert.equal(v.estado, RECHAZADO);
    assert.match(String(v.motivo), /no reconoce el frame/);
  });

  it("RECHAZADO serializa entero lo que no sea un mensaje del bridge", () => {
    const v = veredictoDeTile({ key: "tile_0_1", tiles: [], episodios: [], rechazos: ["basura cruda"] });
    assert.equal(v.estado, RECHAZADO);
    assert.equal(v.motivo, '"basura cruda"');
  });

  it("CALLADO con episodio: el cliente lo tiene apuntado y el bridge no dijo nada", () => {
    const v = veredictoDeTile({
      key: "tile_1_0",
      tiles: ["tile_0_0"],
      episodios: [ep("tile_1_0", { requested: 4321 })],
      rechazos: [],
    });
    assert.equal(v.estado, CALLADO);
    assert.match(fraseDeTile(v), /el bridge NO DIJO NADA de este tile/);
  });

  it("CALLADO sin episodio: el cliente nunca supo de este tile, y eso tiene su propio texto", () => {
    // Es el caso por defecto del 120 y el 127: la petición sale por un socket
    // del guion, así que el cliente NO apunta el `pedido` — sin este texto, un
    // libro vacío parecería un fallo de instrumentación.
    const v = veredictoDeTile({ key: "tile_-1_-1", tiles: ["tile_0_0"], episodios: [], rechazos: [] });
    assert.equal(v.estado, CALLADO);
    assert.equal(v.episodio, null);
    assert.match(fraseDeTile(v), /el cliente nunca supo de este tile/);
    assert.match(fraseDeTile(v), /la petición va por un socket del\s+guion/);
  });
});

describe("veredictoDeTile · el libro entero viaja al rojo", () => {
  it("la frase arrastra tiles, episodios y rechazos, que es lo que se lee al investigar", () => {
    const frase = fraseDeTile(
      veredictoDeTile({
        key: "tile_-1_-1",
        tiles: ["tile_0_0", "tile_1_0"],
        episodios: [ep("tile_1_0", { arrived: 2200, source: "engine" })],
        rechazos: [{ kind: "protocolo", message: "x" }],
      }),
    );
    assert.match(frase, /tiles en el mundo=\[tile_0_0, tile_1_0\]/);
    assert.match(frase, /tile_1_0\{pedido:1200 llegó:2200 de:engine\}/);
    assert.match(frase, /rechazos=\[\{"kind":"protocolo","message":"x"\}\]/);
  });

  it("y con el libro vacío lo dice en vez de imprimir nada", () => {
    const frase = fraseDeTile(veredictoDeTile({ key: "tile_5_5", tiles: [], episodios: [], rechazos: [] }));
    assert.match(frase, /episodios=\(vacío\)/);
  });
});

describe("veredictoDeTile · fail-loud de la lectura", () => {
  // Un `__nefan.tiles` que desaparezca en un refactor del cliente tiene que
  // poner ROJO al guion con su nombre. Si se colara como «callado» —que es un
  // veredicto sobre el BRIDGE— el banco estaría acusando al inocente; y si se
  // colara como «llegado», sería un verde sobre nada.
  it("sin `tiles` array, LANZA nombrando el registro que falta", () => {
    assert.throws(
      () => veredictoDeTile({ key: "tile_0_1", tiles: undefined, episodios: [], rechazos: [] }),
      /__nefan\.tiles/,
    );
    assert.throws(() => veredictoDeTile({ key: "tile_0_1", tiles: "tile_0_1" }), /tiene que ser un array/);
  });

  it("sin key, LANZA", () => {
    assert.throws(() => veredictoDeTile({ key: "", tiles: [] }), /la key del tile/);
    assert.throws(() => veredictoDeTile({ tiles: [] }), /la key del tile/);
    assert.throws(() => veredictoDeTile(), /la key del tile/);
  });

  it("con rechazos que no son un array, LANZA", () => {
    assert.throws(
      () => veredictoDeTile({ key: "tile_0_1", tiles: [], episodios: [], rechazos: "no" }),
      /rechazos.*array/s,
    );
  });

  it("un `episodios` ilegible no inventa episodio: el libro queda vacío", () => {
    // Asimetría deliberada: `tiles` decide el veredicto bueno y por eso es
    // fail-loud; el libro solo AÑADE detalle, así que su ausencia degrada a
    // «callado sin episodio», que es verdad.
    const v = veredictoDeTile({ key: "tile_0_1", tiles: [], episodios: null, rechazos: [] });
    assert.equal(v.estado, CALLADO);
    assert.deepEqual(v.libro, []);
  });

  it("fraseDeTile con un estado que no existe LANZA, en vez de devolver texto vacío", () => {
    assert.throws(
      () => fraseDeTile({ estado: "inventado", tiles: [], libro: [], rechazos: [] }),
      /estado desconocido/,
    );
  });
});
