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
  descartados: { n: number; status: number; total: number; medido: boolean };
  expiro: boolean;
  ms: number | null;
};

const mod = (await import(join(repoRoot, "qa", "lib", "tile-episodio.mjs"))) as {
  LLEGADO: string;
  FALLO: string;
  RECHAZADO: string;
  DESCARTADO: string;
  CALLADO: string;
  MS_DEL_TILE: number;
  veredictoDeTile: (entrada?: unknown) => Veredicto;
  fraseDeTile: (v: unknown) => string;
  sondaDeTile: (k: string) => unknown;
  exigeLecturaDeTile: (lectura?: unknown) => void;
  laExpiracionAborta: (v: unknown) => boolean;
};
const {
  LLEGADO,
  FALLO,
  RECHAZADO,
  DESCARTADO,
  CALLADO,
  MS_DEL_TILE,
  veredictoDeTile,
  fraseDeTile,
  sondaDeTile,
  exigeLecturaDeTile,
  laExpiracionAborta,
} = mod;

/** La OTRA mitad del cable de #609: quien decide si un rojo bajo carga se puede
 *  llamar una expiración de presupuesto. Se importa para afirmar que encajan. */
const carga = (await import(join(repoRoot, "qa", "lib", "carga.mjs"))) as {
  firmaDePresupuesto: (fallos: unknown[]) => boolean;
};

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

  it("CALLADO con episodio: el cliente lo tiene apuntado y no hay constancia de más", () => {
    const v = veredictoDeTile({
      key: "tile_1_0",
      tiles: ["tile_0_0"],
      episodios: [ep("tile_1_0", { requested: 4321 })],
      rechazos: [],
    });
    assert.equal(v.estado, CALLADO);
    assert.match(fraseDeTile(v), /lo tiene apuntado como pedido y sigue sin llegada y sin error/);
  });

  it("CALLADO sin episodio: el cliente nunca supo de este tile, y eso tiene su propio texto", () => {
    // Es el caso por defecto del 120 y el 127: la petición sale por un socket
    // del guion, así que el cliente NO apunta el `pedido` — sin este texto, un
    // libro vacío parecería un fallo de instrumentación.
    const v = veredictoDeTile({ key: "tile_-1_-1", tiles: ["tile_0_0"], episodios: [], rechazos: [] });
    assert.equal(v.estado, CALLADO);
    assert.equal(v.episodio, null);
    assert.match(fraseDeTile(v), /el cliente nunca supo de él/);
    assert.match(fraseDeTile(v), /la petición va por un socket del guion/);
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
      () =>
        fraseDeTile({
          estado: "inventado",
          tiles: [],
          libro: [],
          rechazos: [],
          descartados: { n: 0, status: 0, total: 0, medido: true },
          expiro: false,
          ms: null,
        }),
      /estado desconocido/,
    );
  });
});

describe("veredictoDeTile · el cliente que TIRA lo que el bridge dijo (#312, QA H-1b)", () => {
  // Sin esta rama, un status con sello de otra partida —la familia #673/#659—
  // salía como «callado» y el ✘ acusaba al bridge de no haber hablado cuando
  // quien no escuchaba era el cliente.
  it("un descarte en la ventana es DESCARTADO, no callado", () => {
    const v = veredictoDeTile({
      key: "tile_1_0",
      tiles: ["tile_0_0"],
      episodios: [],
      rechazos: [],
      descartados: { n: 0, status: 3 },
    });
    assert.equal(v.estado, DESCARTADO);
    assert.match(fraseDeTile(v), /el bridge SÍ habló y el CLIENTE lo TIRÓ/);
    // Y dice hasta dónde llega lo medido: son contadores de sesión, no un libro
    // por key. Sin esta frase el veredicto afirmaría más de lo que sabe.
    assert.match(fraseDeTile(v), /CONTADORES de sesión, no un libro por key/);
  });

  it("FALLO gana a DESCARTADO: el episodio es de ESTA key y el contador solo de la ventana", () => {
    const v = veredictoDeTile({
      key: "tile_1_0",
      tiles: [],
      episodios: [ep("tile_1_0", { error: "el motor lo rechazó" })],
      rechazos: [],
      descartados: { n: 1, status: 1 },
    });
    assert.equal(v.estado, FALLO);
  });

  it("un delta de 0 no es evidencia de nada, y uno negativo tampoco", () => {
    const cero = veredictoDeTile({ key: "t", tiles: [], descartados: { n: 0, status: 0 } });
    assert.equal(cero.estado, CALLADO);
    // Negativo = alguien reseteó el cliente a mitad. Se lee como cero, NUNCA
    // como evidencia al revés.
    const neg = veredictoDeTile({ key: "t", tiles: [], descartados: { n: -4, status: -1 } });
    assert.equal(neg.estado, CALLADO);
    assert.equal(neg.descartados.total, 0);
  });

  it("sin medir los descartes se DICE, y no se colapsa con «hubo cero»", () => {
    const sin = veredictoDeTile({ key: "t", tiles: [] });
    assert.equal(sin.descartados.medido, false);
    assert.match(fraseDeTile(sin), /descartes en la ventana=sin medir/);
    const con = veredictoDeTile({ key: "t", tiles: [], descartados: { n: 0, status: 0 } });
    assert.equal(con.descartados.medido, true);
    assert.match(fraseDeTile(con), /descartes en la ventana=0\+0/);
  });
});

describe("fraseDeTile · lo que el ✘ puede AFIRMAR (QA H-1)", () => {
  // El hallazgo entero: «y el bridge no dijo nada de él» era FALSO en tres
  // estados vivos, y el primero es el más probable de #656 — el tile que va
  // LENTO, porque el `TileLedger` solo apunta `ready` y `error` y el
  // `generating` que el bridge difunde no deja rastro que este juicio pueda ver.
  it("NO afirma que el bridge callara", () => {
    const frase = fraseDeTile(veredictoDeTile({ key: "tile_1_0", tiles: [], descartados: { n: 0, status: 0 } }));
    assert.doesNotMatch(frase, /el bridge no dijo nada/);
    assert.match(frase, /NO HAY CONSTANCIA/);
    assert.match(frase, /no es lo mismo que «el bridge calló»/);
  });

  it("y nombra los dos puntos ciegos que lo harían falso", () => {
    const frase = fraseDeTile(veredictoDeTile({ key: "tile_1_0", tiles: [], descartados: { n: 0, status: 0 } }));
    assert.match(frase, /va LENTO/, "el generating no lo apunta el TileLedger");
    assert.match(frase, /SIN campo `tile`/, "coords no enteras: el error se difunde sin tile");
  });
});

describe("EL CABLE de vuelta: `fraseDeTile` → `firmaDePresupuesto` (QA H-2)", () => {
  // `ctx.absorbe` consume la expiración, así que el texto del rojo ya no es el
  // `timeout esperando:` que escribía el runner sino éste. Sin firma, el
  // reproductor bajo carga declaraba «no atribuible a #545» una espera que se
  // había comido 90 s de presupuesto — el mismo defecto que esta PR arregló en
  // `esperarRegistro`, reintroducido por la otra punta.
  const expirado = () =>
    veredictoDeTile({
      key: "tile_-1_-1",
      tiles: ["tile_0_0"],
      episodios: [],
      rechazos: [],
      descartados: { n: 0, status: 0 },
      expiro: true,
      ms: 90_000,
    });

  it("un ✘ que EXPIRÓ lleva firma de presupuesto", () => {
    const frase = fraseDeTile(expirado());
    assert.match(frase, /la espera expiró a los 90000 ms/);
    assert.equal(
      carga.firmaDePresupuesto([frase]),
      true,
      `el reproductor bajo carga no reconoce esta expiración de 90 s: ${frase}`,
    );
  });

  it("y un ✘ que NO expiró NO la lleva: un defecto real no se disfraza de #545", () => {
    // La mentira simétrica, y es la cara que importa: el ✘ de 179 ms con el
    // motor falso en `mode:"error"` es un fallo del juego, no un presupuesto
    // agotado. Estamparle la firma lo atribuiría a #545.
    const frase = fraseDeTile(
      veredictoDeTile({
        key: "tile_1_0",
        tiles: [],
        episodios: [ep("tile_1_0", { error: "El motor narrativo no pudo construirlo" })],
        rechazos: [],
        descartados: { n: 0, status: 0 },
        expiro: false,
        ms: 90_000,
      }),
    );
    assert.match(frase, /la espera paró sola \(no expiró/);
    assert.equal(carga.firmaDePresupuesto([frase]), false);
  });

  it("control negativo del cable: el texto SIN el reloj no la lleva", () => {
    // Sin esto, el primer aserto no distinguiría «lo arreglamos» de
    // «firmaDePresupuesto casa con cualquier cosa».
    const sinReloj = "NO HAY CONSTANCIA de este tile · tiles en el mundo=[] · episodios=(vacío)";
    assert.equal(carga.firmaDePresupuesto([sinReloj]), false);
  });

  it("el presupuesto se ESCRIBE en el ✘: leyendo el rojo se sabe cuánto se esperó", () => {
    assert.match(fraseDeTile(expirado()), /90000 ms/);
    // Y sin presupuesto declarado se dice, en vez de inventar un número.
    const sinMs = veredictoDeTile({ key: "t", tiles: [], expiro: true });
    assert.match(fraseDeTile(sinMs), /EXPIRÓ \(sin presupuesto declarado\)/);
  });
});

/** LA SONDA SE EJECUTA COMO LA EJECUTA PLAYWRIGHT: serializada con `String(fn)`
 *  y evaluada en otro ámbito, donde `window` es lo único que existe. Si
 *  `sondaDeTile` arrastrara una referencia a este módulo —`LLEGADO`, un
 *  helper— aquí sería `ReferenceError`, que es exactamente lo que sería en la
 *  página: `rotos === muestras` y una expiración de 90 s disfrazada de
 *  «callado». */
const sondaSerializada = new Function("window", "k", `return (${String(sondaDeTile)})(k);`) as (
  window: unknown,
  k: string,
) => unknown;
const ventana = (l: { tiles?: unknown; episodios?: unknown; rechazos?: unknown }): unknown => ({
  __nefan: { tiles: l.tiles, tileEpisodios: l.episodios },
  __qaTileRechazos: l.rechazos,
});

describe("sondaDeTile · la mitad que PARA dice lo mismo que la que JUZGA (H-3 de #687)", () => {
  // Las cinco lecturas del veredicto. La regla: la sonda para (≠ null) EXACTAMENTE
  // cuando el veredicto no es «callado» ni «descartado» — los dos estados que
  // desde dentro de la página no se pueden ver (el descarte es un delta que se
  // mide desde node). Antes había dos precedencias escritas, y estaban
  // invertidas; ahora la sonda no tiene ninguna y esto es lo que lo sujeta.
  const lecturas: { nombre: string; l: { tiles: string[]; episodios: Episodio[]; rechazos: unknown[]; descartados?: { n: number; status: number } } }[] = [
    { nombre: "llegado", l: { tiles: ["tile_0_1"], episodios: [ep("tile_0_1", { arrived: 1, source: "engine" })], rechazos: [] } },
    { nombre: "fallo", l: { tiles: [], episodios: [ep("tile_0_1", { error: "el motor lo rechazó" })], rechazos: [] } },
    { nombre: "rechazado", l: { tiles: [], episodios: [], rechazos: [{ kind: "protocolo", message: "no" }] } },
    { nombre: "rechazado gana a fallo (misma señal para la sonda)", l: { tiles: [], episodios: [ep("tile_0_1", { error: "antes" })], rechazos: ["x"] } },
    { nombre: "descartado", l: { tiles: [], episodios: [], rechazos: [], descartados: { n: 0, status: 2 } } },
    { nombre: "callado con episodio", l: { tiles: [], episodios: [ep("tile_0_1")], rechazos: [] } },
    { nombre: "callado sin episodio", l: { tiles: ["tile_0_0"], episodios: [], rechazos: [] } },
    { nombre: "el error de OTRA key no para", l: { tiles: [], episodios: [ep("tile_9_9", { error: "ajeno" })], rechazos: [] } },
  ];

  for (const { nombre, l } of lecturas) {
    it(`${nombre}: sonda ≠ null ⇔ veredicto ∉ {callado, descartado}, y devuelve la lectura ENTERA`, () => {
      const v = veredictoDeTile({ key: "tile_0_1", ...l });
      const parada = sondaSerializada(ventana(l), "tile_0_1");
      const debeParar = v.estado !== CALLADO && v.estado !== DESCARTADO;
      assert.equal(parada !== null, debeParar, `veredicto=${v.estado} sonda=${JSON.stringify(parada)}`);
      // LA MITAD QUE FALTABA (QA H-1). La bicondicional de arriba la cumple
      // CUALQUIER precedencia —solo mira SI para, no CON QUÉ—, y una sonda
      // reescrita con la precedencia vieja (llegado > fallo > rechazado,
      // devolviendo en cada rama solo la señal ganadora) la pasaba entera:
      // 45/45 verde con DOS precedencias en el árbol, que es justo lo que el
      // criterio 3 prohíbe. Esto es lo que una sonda con precedencia no puede
      // falsear: lo devuelto es la lectura COMPLETA, con las otras dos señales
      // intactas, no la que ella haya elegido.
      if (parada !== null) {
        assert.deepEqual(
          parada,
          { tiles: l.tiles, episodio: l.episodios.find((e) => e && e.key === "tile_0_1") ?? null, rechazos: l.rechazos },
          "la sonda devuelve las TRES señales tal como están en la página; si alguna viene vacía o a null cuando la había, está eligiendo, y eso es una segunda precedencia",
        );
      }
    });
  }

  it("cuando para, devuelve la LECTURA cruda y no un veredicto: la precedencia vive en un solo sitio", () => {
    const l = { tiles: ["tile_0_1"], episodios: [ep("tile_0_1", { error: "también" })], rechazos: ["y"] };
    const parada = sondaSerializada(ventana(l), "tile_0_1") as Record<string, unknown>;
    assert.deepEqual(Object.keys(parada).sort(), ["episodio", "rechazos", "tiles"]);
    assert.equal("estado" in parada, false, "la sonda no decide: eso es de veredictoDeTile");
  });

  it("sin `tiles` LANZA en vez de devolver null: un hook roto no se disfraza de «callado» (H-5, a mitad de espera)", () => {
    // En la página esto es un sondeo ROTO que `waitFor` cuenta en `rotos`; lo
    // que no puede ser es `null`, que significaría «sigo esperando» sobre un
    // registro que no existe. Y ANTES de la espera lo dice `exigeLecturaDeTile`.
    assert.throws(() => sondaSerializada(ventana({ tiles: undefined, episodios: [], rechazos: [] }), "tile_0_1"), TypeError);
  });

  it("no arrastra ninguna referencia al módulo (si no, Playwright la rompería igual)", () => {
    const fuente = String(sondaDeTile);
    for (const nombre of ["veredictoDeTile", "LLEGADO", "FALLO", "RECHAZADO", "exigeLecturaDeTile", "MS_DEL_TILE", "textoDelRechazo"]) {
      assert.doesNotMatch(fuente, new RegExp(`\\b${nombre}\\b`), `sondaDeTile menciona ${nombre}`);
    }
  });
});

describe("exigeLecturaDeTile · el fail-loud de la lectura, aplicable ANTES de la espera (H-5 de #687)", () => {
  it("sin `tiles` array LANZA nombrando el registro, y es TypeError (absorbe no lo traga)", () => {
    assert.throws(() => exigeLecturaDeTile({ key: "tile_0_1", tiles: undefined, rechazos: [] }), (e: unknown) => {
      assert.ok(e instanceof TypeError);
      assert.match(String((e as Error).message), /__nefan\.tiles/);
      return true;
    });
  });
  it("sin key, y con rechazos que no son array, LANZA", () => {
    assert.throws(() => exigeLecturaDeTile({ key: "", tiles: [], rechazos: [] }), /la key del tile/);
    assert.throws(() => exigeLecturaDeTile({ key: "t", tiles: [], rechazos: undefined }), /rechazos.*array/s);
    assert.throws(() => exigeLecturaDeTile(), /la key del tile/);
  });
  it("con una lectura bien formada no lanza, aunque esté vacía", () => {
    assert.doesNotThrow(() => exigeLecturaDeTile({ key: "tile_0_1", tiles: [], rechazos: [] }));
  });
  it("y es el MISMO validador que usa el veredicto: lo que pasa el preflight no revienta después", () => {
    const l = { key: "tile_0_1", tiles: ["a"], rechazos: [] };
    exigeLecturaDeTile(l);
    assert.doesNotThrow(() => veredictoDeTile(l));
  });
});

describe("laExpiracionAborta · la decisión de H-4 (#687), con test", () => {
  it("verdadera SOLO cuando la espera expiró", () => {
    assert.equal(laExpiracionAborta(veredictoDeTile({ key: "t", tiles: [], expiro: true, ms: MS_DEL_TILE })), true);
  });
  it("falsa para los desenlaces hablados: fallo, rechazo y descarte dejan el ✘ y el guion sigue", () => {
    assert.equal(laExpiracionAborta(veredictoDeTile({ key: "t", tiles: [], episodios: [ep("t", { error: "x" })] })), false);
    assert.equal(laExpiracionAborta(veredictoDeTile({ key: "t", tiles: [], rechazos: ["r"] })), false);
    assert.equal(laExpiracionAborta(veredictoDeTile({ key: "t", tiles: [], descartados: { n: 1, status: 0 } })), false);
    assert.equal(laExpiracionAborta(veredictoDeTile({ key: "t", tiles: ["t"] })), false);
  });
  it("y no se deja convencer por un `expiro` que no sea el booleano", () => {
    assert.equal(laExpiracionAborta({ expiro: "sí" }), false);
    assert.equal(laExpiracionAborta({ expiro: 1 }), false);
    assert.equal(laExpiracionAborta({}), false);
  });
});

describe("MS_DEL_TILE vive aquí, y el ✘ que expira con él lleva firma de presupuesto", () => {
  it("es un entero positivo de milisegundos y la frase que lo agota la reconoce el reproductor bajo carga", () => {
    assert.ok(Number.isInteger(MS_DEL_TILE) && MS_DEL_TILE > 0);
    const frase = fraseDeTile(veredictoDeTile({ key: "t", tiles: [], expiro: true, ms: MS_DEL_TILE }));
    assert.match(frase, new RegExp(`la espera expiró a los ${MS_DEL_TILE} ms`));
    assert.equal(carga.firmaDePresupuesto([frase]), true);
  });
});
