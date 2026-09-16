/** El RÓTULO que lee quien juega cuando el motor falla (#180).
 *
 *  Lo que se comprueba aquí NO es que las cadenas sean bonitas, es la
 *  DECISIÓN: qué fallo tapa la pantalla y cuál se queda en la línea de
 *  mensajes, y cuál de los titulares corresponde a cada situación. Esa
 *  decisión vivía en dos `if` de `main.ts` con el rótulo escrito a mano al
 *  lado, y no había forma de probarla sin navegador.
 *
 *  La otra mitad del fichero que este era hasta el 2026-09-04 —el CUERPO en
 *  cristiano de cada fallo— está en `status-motivo.test.ts`. No comparten ni un
 *  helper: `fallo` y `CUERPO_DE_VIAJE` son de aquí y de nadie más. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { botonesDelMuro, rotuloDeStatus } from "../src/protocol/status-rotulo.js";
import type { SalidaDelOverlay } from "../src/protocol/status-rotulo.js";
import type { NarrativeStatusDeSesion } from "../src/protocol/messages.js";

/** TODOS los kinds, DERIVADOS DEL TIPO y no de una lista copiada a mano.
 *
 *  Era exactamente eso —tres listas de nueve literales escritas a mano en este
 *  fichero— y por eso entra aquí: `combatientes` (#529) es el primer kind cuyo
 *  destino NO es el overlay, y con las listas de antes se habría añadido sin
 *  que ninguna de las tres lo mirara. Verde sin comprobar nada.
 *
 *  El `Record` sobre la unión hace que `tsc` exija una fila por kind: uno
 *  nuevo no compila hasta que alguien decide si tapa la pantalla o no, que es
 *  la misma garantía que el `never` del `switch` de producción.
 *
 *  El destino de la tabla es el del jugador ESPERANDO (`overlayAbierto`), que
 *  es el contexto en el que cada kind enseña lo suyo; `tile` tiene además su
 *  caso de segundo plano, que va al log y se mide aparte. */
const DESTINO_POR_KIND: Record<NarrativeStatusDeSesion["kind"], "overlay" | "log"> = {
  tile: "overlay",
  scene: "overlay",
  consequences: "overlay",
  restore: "overlay",
  takeover: "overlay",
  save: "overlay",
  plugin: "overlay",
  action: "overlay",
  protocolo: "overlay",
  combatientes: "log",
};
const TODOS_LOS_KINDS = Object.keys(DESTINO_POR_KIND) as NarrativeStatusDeSesion["kind"][];
const KINDS_DE_OVERLAY = TODOS_LOS_KINDS.filter((k) => DESTINO_POR_KIND[k] === "overlay");

/** Lo que el bridge manda en el ARRANQUE del mundo: motivo traducido y SIN
 *  nombre de destino, porque en el arranque no se viaja a ningún sitio.
 *
 *  Este fixture decía «No se pudo llegar a Robledo. …» para todos los casos,
 *  incluido el del mundo vacío — y ese cuerpo ahí no llegaba nunca: hasta
 *  2026-08-24 `tile.ts` solo traducía si el fallo traía `destino`, así que en
 *  el arranque el jugador leía «Error: No se pudo generar la escena. fetch
 *  failed». El test heredaba la premisa falsa y por eso el hueco no se vio
 *  (QA §3.3). Los casos de VIAJE traen ahora su cuerpo con el destino puesto,
 *  explícitamente, porque son los únicos donde el bridge lo escribe. */
const fallo = (
  // Sin `phase`: la fija el helper (es un FALLO), y desde #405 el tipo ata la
  // fase al kind — un `extra` que pudiera traer `phase` des-correlacionaría
  // las dos mitades y el literal dejaría de ser un `NarrativeStatusDeSesion`.
  extra: Partial<Omit<NarrativeStatusDeSesion, "sessionId" | "phase">> = {},
): NarrativeStatusDeSesion => ({
  type: "narrative_status",
  sessionId: "partida_de_prueba",
  phase: "error",
  kind: "tile",
  message: "El motor narrativo no responde; inténtalo de nuevo en un momento.",
  ...extra,
});

/** El cuerpo de un VIAJE fallido: el destino como prefijo del motivo. Es lo
 *  que compone `runTileGeneration` cuando `opts.destino` existe. */
const CUERPO_DE_VIAJE =
  "No se pudo llegar a Robledo. El motor narrativo no responde; inténtalo de nuevo en un momento.";
describe("rótulo de un fallo del motor", () => {
  it("tile con el mundo todavía vacío: la partida no llegó a empezar", () => {
    const r = rotuloDeStatus(fallo({ tile: { tx: 0, ty: 0 } }), {
      mundoVacio: true,
      overlayAbierto: true,
    });
    assert.equal(r.destino, "overlay");
    assert.equal(r.titulo, "La partida no pudo empezar");
    // El cuerpo del arranque: traducido y sin destino que nombrar.
    assert.equal(r.detalle, "El motor narrativo no responde; inténtalo de nuevo en un momento.");
  });

  it("tile con overlay abierto: el jugador está esperando un viaje, el error va al overlay", () => {
    const r = rotuloDeStatus(fallo({ tile: { tx: 2, ty: 0 }, message: CUERPO_DE_VIAJE }), {
      mundoVacio: false,
      overlayAbierto: true,
    });
    assert.equal(r.destino, "overlay");
    assert.deepEqual(
      { titulo: r.titulo, detalle: r.detalle },
      { titulo: "No se pudo llegar", detalle: CUERPO_DE_VIAJE },
    );
  });

  it("tile de frontera en segundo plano: al log, NO tapa la pantalla", () => {
    // Es el caso que distingue esta función de «pintar el error siempre»: la
    // frontera se genera sola mientras el jugador camina, y su feedback es el
    // velo del borde. Un overlay modal aquí interrumpe una partida en curso
    // por algo que el jugador ni pidió.
    const r = rotuloDeStatus(fallo({ tile: { tx: 1, ty: 0 }, message: "Error: fetch failed" }), {
      mundoVacio: false,
      overlayAbierto: false,
    });
    assert.equal(r.destino, "log");
    assert.equal(r.detalle, "Error: fetch failed");
  });

  it("combatientes: a la línea de mensajes, NUNCA al modal, mire como mire la pantalla", () => {
    // #529. Es el otro caso —con el tile de fondo— en el que tapar la pantalla
    // sería interrumpir una partida que va bien: el mundo está pintado, los
    // enemigos buenos del lote acaban de entrar y lo que falta es uno. Hasta
    // el 2026-09-14 este hecho salía por `protocolo`, o sea «Fallo interno del
    // juego» a pantalla completa, y además con el frame entero descartado.
    //
    // Se prueban los CUATRO contextos y no uno: el destino de este kind no
    // depende de la pantalla, y un `if (ctx.mundoVacio)` colado aquí —como el
    // que sí tiene `tile`— lo devolvería al overlay justo en el arranque.
    for (const mundoVacio of [true, false]) {
      for (const overlayAbierto of [true, false]) {
        const r = rotuloDeStatus(
          fallo({ kind: "combatientes", message: "Enemigos que no entraron al mundo (1 de 3): «roto_2» (x)" }),
          { mundoVacio, overlayAbierto },
        );
        assert.equal(r.destino, "log", `${mundoVacio}/${overlayAbierto}: ${JSON.stringify(r)}`);
        assert.equal(r.detalle, "Enemigos que no entraron al mundo (1 de 3): «roto_2» (x)");
      }
    }
  });

  it("escena de un VIAJE (trae placeId): no se pudo llegar", () => {
    const r = rotuloDeStatus(
      fallo({ kind: "scene", placeId: "ermita_del_vado", message: "No se pudo viajar a Ermita del vado. El motor narrativo no responde; inténtalo de nuevo en un momento." }),
      { mundoVacio: false, overlayAbierto: true },
    );
    assert.equal(r.destino, "overlay");
    assert.equal(r.titulo, "No se pudo llegar");
  });

  it("escena SIN place: no se pudo preparar el lugar", () => {
    const r = rotuloDeStatus(fallo({ kind: "scene", placeId: undefined }), {
      mundoVacio: false,
      overlayAbierto: true,
    });
    assert.equal(r.destino, "overlay");
    assert.equal(r.titulo, "No se pudo preparar el lugar");
  });

  it("una escena sin place no depende del contexto de pintado: siempre al overlay", () => {
    // El contraste con el tile de frontera: una escena que el motor preparaba
    // se pidió desde el juego, así que su fallo se enseña aunque no haya
    // overlay abierto. Sin esto, `overlayAbierto` podría estar decidiendo por
    // todos los kinds y el test de arriba no lo notaría.
    const r = rotuloDeStatus(fallo({ kind: "scene" }), {
      mundoVacio: false,
      overlayAbierto: false,
    });
    assert.equal(r.destino, "overlay");
  });

  it("consequences: la reacción narrativa rechazada conserva su rótulo", () => {
    const r = rotuloDeStatus(fallo({ kind: "consequences", message: undefined }), {
      mundoVacio: false,
      overlayAbierto: false,
    });
    assert.deepEqual(r, {
      destino: "overlay",
      titulo: "El motor narrativo rechazó la respuesta",
      detalle: "El motor narrativo rechazó la reacción.",
      salida: "cerrar",
    });
  });

  it("sin `message` cada kind trae su propio cuerpo, no un «algo falló» genérico", () => {
    const cuerpo = (kind: NarrativeStatusDeSesion["kind"]): string =>
      rotuloDeStatus(fallo({ kind, message: undefined }), {
        mundoVacio: true,
        overlayAbierto: true,
      }).detalle;
    assert.equal(cuerpo("tile"), "Algo falló generando el tile.");
    assert.equal(cuerpo("scene"), "Algo falló en el motor narrativo.");
    assert.equal(cuerpo("consequences"), "El motor narrativo rechazó la reacción.");
    assert.equal(cuerpo("restore"), "Algo de tu partida guardada no se pudo devolver al mundo.");
    assert.equal(cuerpo("takeover"), "Esta partida se está jugando desde otro sitio.");
    assert.equal(cuerpo("save"), "No se pudo escribir la partida guardada.");
    assert.equal(cuerpo("plugin"), "Un sistema del juego no pudo completar el turno.");
    assert.equal(cuerpo("action"), "El juego no pudo completar esa acción.");
    assert.equal(cuerpo("protocolo"), "El juego mandó un mensaje que el servidor no pudo leer.");
    assert.equal(cuerpo("combatientes"), "Alguno de los enemigos de ese lote no pudo entrar al mundo.");
    // Y el conjunto es TOTAL: si mañana entra un kind más, esta línea cae con
    // su nombre en vez de dejarlo sin cuerpo comprobado.
    assert.equal(TODOS_LOS_KINDS.length, 10, JSON.stringify(TODOS_LOS_KINDS));
    assert.equal(new Set(TODOS_LOS_KINDS.map(cuerpo)).size, 10, "dos kinds comparten cuerpo por defecto");
  });

  it("un `message` vacío NO se sustituye por el de por defecto", () => {
    // `??` y `||` se confunden en este sitio exacto y la diferencia es
    // observable: con `||`, un mensaje vacío del bridge se cambiaría por el
    // texto genérico y el jugador leería una causa inventada.
    assert.equal(rotuloDeStatus(fallo({ message: "" }), { mundoVacio: true, overlayAbierto: true }).detalle, "");
  });

  it("rotular algo que NO es un fallo es un error de quien llama (fail-loud)", () => {
    for (const phase of ["generating", "progress", "ready"] as const) {
      // Con `kind: "tile"` las tres fases son expresables (el `ready` solo lo es
      // para `tile` y `plugin` desde #405), así que el literal es un status
      // legítimo y lo que se prueba es el fail-loud del rotulador, no el tipo.
      const noEsFallo: NarrativeStatusDeSesion = {
        type: "narrative_status",
        sessionId: "partida_de_prueba",
        phase,
        kind: "tile",
      };
      assert.throws(
        () => rotuloDeStatus(noEsFallo, { mundoVacio: true, overlayAbierto: true }),
        /solo rotula fallos/,
        `phase "${phase}" debería rechazarse`,
      );
    }
  });
});

/** #352 — el titular dice QUÉ HA PASADO, y ninguno nombra a otro culpable.
 *
 *  Hasta el 2026-09-01 `rotuloDeStatus` acababa en un `return` catch-all: todo
 *  lo que no era `tile` ni `scene` salía a pantalla completa bajo «El motor
 *  narrativo rechazó la respuesta». Como el bridge no tenía más kinds que
 *  ofrecer, SIETE emisores compartían ese titular y SEIS mentían: el aviso de
 *  «tu partida vuelve incompleta» del resume, el takeover de sesión, los dos
 *  «no se pudo guardar», el plugin que revienta su turno y el handler que
 *  revienta.
 *
 *  Un `it` por kind y con el TÍTULO LITERAL, y no un «son distintos entre sí»:
 *  este módulo está en mutación a `break: 100`, así que cada `StringLiteral`
 *  nuevo necesita un aserto que lo mate. Y con la tabla, además, borrar una
 *  rama entera para que caiga en otra se ve — que es exactamente el defecto
 *  que se está arreglando. */
describe("un titular por hecho: ningún aviso culpa a quien no ha sido", () => {
  const titulo = (kind: NarrativeStatusDeSesion["kind"]): string => {
    const r = rotuloDeStatus(fallo({ kind, message: "da igual el cuerpo" }), {
      mundoVacio: false,
      overlayAbierto: true,
    });
    assert.equal(r.destino, "overlay", `${kind} tiene que tapar la pantalla`);
    return r.destino === "overlay" ? r.titulo : "";
  };

  it("restore: la partida vuelve con menos de lo que tenía — no es cosa del motor", () => {
    // El del issue: el cuerpo («la partida guardada no dice en qué estado
    // quedó X») era exacto y estaba en idioma de jugador desde #326; encima
    // ponía que el motor narrativo había rechazado una respuesta que nadie
    // había pedido.
    assert.equal(titulo("restore"), "Tu partida vuelve incompleta");
  });

  it("takeover: otro cliente tomó la partida — la respuesta del motor es la víctima", () => {
    assert.equal(titulo("takeover"), "Esta partida ya no está al mando");
  });

  it("save: el disco, no el narrador", () => {
    assert.equal(titulo("save"), "No se pudo guardar la partida");
  });

  it("plugin: un sistema del juego, que es contenido del mundo y no el narrador", () => {
    assert.equal(titulo("plugin"), "Un sistema del juego falló");
  });

  it("action: reventó el handler de algo que el jugador pidió", () => {
    assert.equal(titulo("action"), "No se pudo completar esa acción");
  });

  it("protocolo: el juego consigo mismo, no la generación de un sitio", () => {
    // QA H-7: un frame WS que no pasa el intake salía con `kind:"scene"`, o sea
    // bajo «No se pudo preparar el lugar» — un titular que manda a mirar la
    // generación del mundo para decir que el propio juego mandó basura.
    assert.equal(titulo("protocolo"), "Fallo interno del juego");
  });

  it("consequences conserva el suyo, que por fin es cierto: ya no lo hereda nadie", () => {
    assert.equal(titulo("consequences"), "El motor narrativo rechazó la respuesta");
  });

  it("la TABLA de destinos es la de verdad: cada kind cae donde dice, no donde nos conviene", () => {
    // Sin esto, `DESTINO_POR_KIND` sería decoración: los tres bucles de este
    // fichero la usarían para decidir a quién NO mirar, y meter un kind en la
    // fila equivocada lo sacaría del examen en silencio. Aquí se confronta con
    // `rotuloDeStatus` kind a kind, con el jugador esperando.
    for (const kind of TODOS_LOS_KINDS) {
      const r = rotuloDeStatus(fallo({ kind }), { mundoVacio: false, overlayAbierto: true });
      assert.equal(r.destino, DESTINO_POR_KIND[kind], `${kind}: ${JSON.stringify(r)}`);
    }
  });

  it("SOLO el rechazo del motor nombra al motor: los otros titulares no", () => {
    // El criterio 3 de la tanda, dicho como aserto: «ningún aviso sale bajo un
    // titular que nombra a otro culpable». Sin esto, un titular nuevo escrito
    // como «El motor narrativo no pudo guardar» pasaría los `it` de arriba
    // (cada uno mira su cadena) y volvería a poner el defecto en pantalla.
    const kinds = KINDS_DE_OVERLAY;
    const culpan = kinds.filter((k) => /motor narrativo/i.test(titulo(k)));
    assert.deepEqual(culpan, ["consequences"], JSON.stringify(kinds.map((k) => [k, titulo(k)])));
  });

  it("cada kind de overlay tiene SU titular: un hecho cada uno, ningún catch-all", () => {
    // El aserto que se pone rojo si alguien devuelve el catch-all: con un
    // `return` al final, los kinds nuevos colapsarían en un solo título y este
    // conjunto tendría 4 elementos en vez de uno por kind. La cuenta sale de
    // la tabla y no de un literal: un kind nuevo de overlay entra solo.
    const kinds = KINDS_DE_OVERLAY;
    const titulos = kinds.map((k) => titulo(k));
    assert.equal(new Set(titulos).size, kinds.length, JSON.stringify(titulos));
    // Los DOS que sí pueden coincidir lo hacen por contexto y no por kind: un
    // `scene` CON `placeId` es el mismo hecho que un `tile` con el jugador
    // esperando —no poder ir donde iba—, y ahí compartir titular es correcto.
    const conDestino = rotuloDeStatus(fallo({ kind: "scene", placeId: "plaza" }), {
      mundoVacio: false,
      overlayAbierto: true,
    });
    assert.equal(conDestino.destino === "overlay" && conDestino.titulo, titulo("tile"));
  });

  it("un kind sin titular propio no compila: el `switch` lo canda, y si se rompe, LANZA", () => {
    // La red de debajo de la red. El candado fuerte es `tsc` (el `const nunca:
    // never` del final), y por eso hay que forzar el tipo para llegar aquí:
    // este aserto existe para que el fallback del catch-all no pueda volver
    // «por si acaso» — un kind desconocido tiene que reventar, no heredar el
    // titular de otro.
    assert.throws(
      () =>
        rotuloDeStatus(
          { phase: "error", kind: "inventado" as NarrativeStatusDeSesion["kind"], message: "x" },
          { mundoVacio: false, overlayAbierto: true },
        ),
      /no sabe rotular el kind "inventado"/,
    );
  });
});

describe("la salida del overlay: qué puede hacer el jugador con el muro", () => {
  it("sin mundo pintado el overlay ofrece VOLVER AL TÍTULO, no solo cerrarse", () => {
    // El fallo más probable de los primeros segundos: `start_session` contesta
    // ok:true antes de generar el tile, así que el motor mudo no rechaza y no
    // pasa por el catch del bucle del título. Cerrar ahí dejaba al jugador con
    // cielo vacío y sin nada que pulsar (#189, QA §3.2).
    const r = rotuloDeStatus(fallo({ tile: { tx: 0, ty: 0 } }), {
      mundoVacio: true,
      overlayAbierto: true,
    });
    assert.equal(r.destino, "overlay");
    assert.equal(r.salida, "volver-al-titulo");
  });

  it("con la partida en marcha el overlay se cierra y ya: hay mundo detrás", () => {
    const r = rotuloDeStatus(fallo({ tile: { tx: 2, ty: 0 }, message: CUERPO_DE_VIAJE }), {
      mundoVacio: false,
      overlayAbierto: true,
    });
    assert.equal(r.destino, "overlay");
    assert.equal(r.salida, "cerrar");
  });

  it("lo que decide la salida es el MUNDO VACÍO, no el kind ni el overlay", () => {
    // Sin esto, `salida` podría estar clavada al caso del tile de bootstrap y
    // un fallo de escena en el arranque —el mismo callejón— saldría con la
    // salida equivocada sin que nadie se enterara.
    for (const kind of KINDS_DE_OVERLAY) {
      for (const overlayAbierto of [true, false]) {
        const r = rotuloDeStatus(fallo({ kind, placeId: "x" }), { mundoVacio: true, overlayAbierto });
        assert.equal(r.destino, "overlay", `${kind}/${overlayAbierto}`);
        assert.equal(r.salida, "volver-al-titulo", `${kind}/${overlayAbierto}`);
      }
    }
  });
});

/** LA TABLA DE BOTONES del muro: qué puede PULSAR el jugador en cada salida.
 *
 *  Se prueba entera y por filas, no por la propiedad que a uno le apetezca
 *  («siempre hay al menos un botón» sale verde con la tabla equivocada): las
 *  tres filas, los tres botones de cada una, y el reverso —que cada botón
 *  aparece exactamente donde debe y en ningún otro sitio—, que es lo que caza
 *  un booleano volteado. Era una pareja de booleanos derivados a mano en el
 *  cliente y no se podía probar sin navegador. */
describe("botonesDelMuro", () => {
  it("con partida detrás solo se puede cerrar", () => {
    assert.deepEqual(botonesDelMuro("cerrar"), { volver: false, cerrar: true, reintentar: false });
  });

  it("sin mundo, la ÚNICA salida es el título: «Cerrar» no se pinta (#189)", () => {
    assert.deepEqual(botonesDelMuro("volver-al-titulo"), {
      volver: true,
      cerrar: false,
      reintentar: false,
    });
  });

  it("la oferta del bridge que llega tarde se puede aceptar o declinar, y no ofrece el título (#478)", () => {
    assert.deepEqual(botonesDelMuro("reintentar"), { volver: false, cerrar: true, reintentar: true });
  });

  it("cada botón sale en sus salidas y en ninguna otra", () => {
    const salidas: SalidaDelOverlay[] = ["cerrar", "volver-al-titulo", "reintentar"];
    const conElBoton = (cual: "volver" | "cerrar" | "reintentar") =>
      salidas.filter((s) => botonesDelMuro(s)[cual]);
    assert.deepEqual(conElBoton("volver"), ["volver-al-titulo"]);
    assert.deepEqual(conElBoton("cerrar"), ["cerrar", "reintentar"]);
    assert.deepEqual(conElBoton("reintentar"), ["reintentar"]);
  });

  it("ninguna salida deja el muro sin un solo botón que pulsar", () => {
    // El callejón de #189, escrito como propiedad: un muro a pantalla completa
    // sin nada que pulsar solo se sale recargando.
    for (const salida of ["cerrar", "volver-al-titulo", "reintentar"] as const) {
      const b = botonesDelMuro(salida);
      assert.ok(b.volver || b.cerrar || b.reintentar, salida);
    }
  });

  it("una salida que no existe no se rotula en silencio", () => {
    assert.throws(
      () => botonesDelMuro("inventada" as SalidaDelOverlay),
      /botonesDelMuro no sabe qué botones lleva la salida "inventada"/,
    );
  });
});

it("una reacción sin conexión no se presenta como respuesta rechazada (#481)", () => {
  const r = rotuloDeStatus(fallo({ kind: "consequences", causaReaccion: "conexion" }), {
    mundoVacio: false, overlayAbierto: true,
  });
  assert.deepEqual(r, {
    destino: "overlay", titulo: "El motor narrativo no responde",
    detalle: "El motor narrativo no responde; inténtalo de nuevo en un momento.", salida: "cerrar",
  });
});
