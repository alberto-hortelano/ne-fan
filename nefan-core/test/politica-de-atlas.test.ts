/** La política del atlas, escrita desde sus incidentes: pedir dos veces la
 *  misma clave era pagar dos veces ($0.15×2, 2026-08-14); no re-disparar —o
 *  descartar la clave distinta— era el tile del jugador en clay al reanudar
 *  (#390); y el token global hacía que la corrida de un tile tirase la de
 *  otro (#729: el arte del menú dev, pagado y en clay). Cada test nombra el
 *  mutante que mata. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PoliticaDeAtlas, lineaDeBalance } from "../src/scene/politica-de-atlas.js";

describe("PoliticaDeAtlas · pedir/terminar: la misma clave no se paga dos veces", () => {
  it("la primera petición de una clave arranca; la segunda, con la primera en curso, se encola", () => {
    const p = new PoliticaDeAtlas();
    assert.equal(p.pedir("tile_0_0"), "arranca");
    assert.equal(p.pedir("tile_0_0"), "encolado", "el segundo trigger antes del primer await no puede arrancar otro ciclo");
  });

  it("al terminar una clave con un trigger solapado se pide UN re-disparo, y solo uno", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("tile_0_0");
    p.pedir("tile_0_0");
    p.pedir("tile_0_0"); // tres solapados, un solo re-disparo (Set, no contador)
    assert.equal(p.terminar("tile_0_0"), "activo");
    // El re-disparo vuelve a pedir la clave: ahora arranca limpio…
    assert.equal(p.pedir("tile_0_0"), "arranca", "tras terminar, la clave vuelve a estar libre");
    // …y como nadie más la pidió mientras, al terminar no hay nada que re-disparar.
    assert.equal(p.terminar("tile_0_0"), "nada");
  });

  it("terminar una clave sin trigger solapado no re-dispara nada", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("tile_0_0");
    assert.equal(p.terminar("tile_0_0"), "nada");
  });

  it("una clave DISTINTA con otra en curso arranca: ni se encola ni se descarta (#390)", () => {
    // El `if (this.inFlight) return;` de antes de #390 descartaba aquí el tile
    // del jugador. Un mutante que devuelva "encolado" para la clave distinta
    // la dejaría esperando a un `terminar` que no es el suyo.
    const p = new PoliticaDeAtlas();
    assert.equal(p.pedir("tile_0_0"), "arranca");
    assert.equal(p.pedir("tile_1_0"), "arranca");
    // Y la deduplicación es POR CLAVE: terminar la primera no libera ni
    // re-dispara la segunda.
    assert.equal(p.terminar("tile_0_0"), "nada");
    assert.equal(p.pedir("tile_1_0"), "encolado", "tile_1_0 sigue en curso: su segundo trigger se encola");
    assert.equal(p.terminar("tile_1_0"), "activo");
  });

  it("el trigger encolado de una clave no se cuela en el terminar de otra", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("a");
    p.pedir("b");
    p.pedir("b"); // b tiene un solapado
    assert.equal(p.terminar("a"), "nada", "a no tenía solapado: el de b no es suyo");
    assert.equal(p.terminar("b"), "activo");
  });
});

const MANUAL = { pinta: true, origen: "manual" } as const;
const ACTIVO = { pinta: false, origen: "activo" } as const;

/** El token de una corrida que TIENE que arrancar: "encolada" aquí es el bug. */
function arranca(p: PoliticaDeAtlas, key: string, o: { pinta: boolean; origen: "activo" | "manual" }): number {
  const t = p.nuevoRun(key, o);
  assert.notEqual(t, "encolada", `la corrida de ${key} tenía que arrancar`);
  return t as number;
}

describe("PoliticaDeAtlas · la vigencia es de la CLAVE: una corrida no tira la de otro tile (#729)", () => {
  it("(1) una manual de X en vuelo cuando se activa Y: las DOS siguen vigentes", () => {
    // El menú dev genera el vecino X; el jugador cruza a Y. Con el token global
    // de antes, la corrida de Y desechaba la de X: X pagado, con keep-list, y
    // en clay.
    const p = new PoliticaDeAtlas();
    const tx = arranca(p, "X", MANUAL);
    assert.equal(p.pedir("Y"), "arranca", "el activo nuevo no espera a la manual de otro tile");
    const ty = arranca(p, "Y", ACTIVO);
    assert.equal(p.vigente("X", tx), true, "la manual de X sigue mandando: aplica a SU tile");
    assert.equal(p.vigente("Y", ty), true);
  });

  it("(2) una manual de X lanzada durante la fase memoria/mapping del activo Y: ídem", () => {
    // La inversa, que el issue no nombraba: el ciclo de Y está en curso (aún
    // sin corrida) cuando se pulsa «Generar» en X, y luego Y lanza la suya.
    const p = new PoliticaDeAtlas();
    assert.equal(p.pedir("Y"), "arranca");
    const tx = arranca(p, "X", MANUAL);
    const ty = arranca(p, "Y", ACTIVO);
    assert.equal(p.vigente("X", tx), true, "la corrida del activo no supera a la de otra clave");
    assert.equal(p.vigente("Y", ty), true);
  });

  it("la G sobre Y con la manual de X en vuelo tampoco la tira", () => {
    const p = new PoliticaDeAtlas();
    const tx = arranca(p, "X", MANUAL);
    arranca(p, "Y", MANUAL);
    assert.equal(p.vigente("X", tx), true);
  });

  it("(4) el activo nuevo nunca espera ni se descarta: pedir arranca y su corrida tiene token", () => {
    const p = new PoliticaDeAtlas();
    arranca(p, "X", ACTIVO);
    assert.equal(p.pedir("Y"), "arranca");
    assert.equal(typeof p.nuevoRun("Y", ACTIVO), "number", "una corrida de otra clave nunca la ocupa");
  });

  it("cada corrida recibe un token nuevo, y un token de otra clave o inventado no manda", () => {
    const p = new PoliticaDeAtlas();
    const t1 = arranca(p, "a", MANUAL);
    const t2 = arranca(p, "b", MANUAL);
    assert.notEqual(t1, t2);
    assert.equal(p.vigente("a", t2), false, "el token de b no manda sobre a");
    assert.equal(p.vigente("a", 999), false);
    assert.equal(p.vigente("c", t1), false, "una clave sin corrida no tiene nada vigente");
  });
});

describe("PoliticaDeAtlas · (3) la MISMA clave no lanza dos corridas: no se paga dos veces", () => {
  it("una segunda corrida de la misma clave en vuelo se ENCOLA, también la manual: no arranca", () => {
    const p = new PoliticaDeAtlas();
    const t = arranca(p, "X", MANUAL);
    assert.equal(p.nuevoRun("X", MANUAL), "encolada", "dos G seguidas pagarían dos veces la misma página");
    assert.equal(p.vigente("X", t), true, "la segunda no supera a la primera");
  });

  it("H-2 · la manual con la clave ocupada no se DESCARTA: sale UNA vez al quedar libre", () => {
    // Antes se rechazaba y el desarrollador tenía que mirar el registro y
    // repetir; en `main` la G superaba a la corrida y pintaba (QA AX, H-2).
    const p = new PoliticaDeAtlas();
    const t = arranca(p, "X", ACTIVO); // el activo pregunta a la librería
    assert.equal(p.nuevoRun("X", MANUAL), "encolada");
    assert.equal(p.nuevoRun("X", MANUAL), "encolada"); // dos G: UNA petición
    assert.equal(p.finDeRun("X", t), "manual");
    arranca(p, "X", MANUAL);
  });

  it("H-2 · con el ciclo del activo en curso, la manual encolada espera a su terminar", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("X");
    const t = arranca(p, "X", ACTIVO);
    p.nuevoRun("X", MANUAL);
    assert.equal(p.finDeRun("X", t), "nada", "el ciclo sigue: la clave no está libre");
    assert.equal(p.terminar("X"), "manual");
    assert.equal(p.terminar("X"), "nada", "y solo una vez");
  });

  it("H-2 · la manual gana a la del activo encolada a la vez: pintar incluye mirar lo que hay", () => {
    const p = new PoliticaDeAtlas();
    const t = arranca(p, "X", MANUAL);
    p.pedir("X"); // activo encolado
    p.nuevoRun("X", MANUAL); // manual encolada
    assert.equal(p.finDeRun("X", t), "manual");
    assert.equal(p.pedir("X"), "arranca");
    assert.equal(p.terminar("X"), "nada", "la del activo se consumió con la manual");
  });

  it("el activo que se activa con la manual de su clave en vuelo se encola y se re-dispara UNA vez al acabar ella", () => {
    const p = new PoliticaDeAtlas();
    const t = arranca(p, "X", MANUAL);
    assert.equal(p.pedir("X"), "encolado", "no arranca otro ciclo que pagaría otra vez");
    assert.equal(p.pedir("X"), "encolado");
    assert.equal(p.finDeRun("X", t), "activo");
    assert.equal(p.pedir("X"), "arranca", "la clave quedó libre");
    assert.equal(p.terminar("X"), "nada", "el re-disparo ya se consumió");
  });

  it("con el ciclo del activo en curso, la manual que arranca lo deja «ocupada»: terminar no re-dispara hasta que acaba la corrida", () => {
    // El ciclo de X está en la fase memoria/mapping; se pulsa «Generar» en X;
    // el ciclo llega a su corrida y la encuentra ocupada.
    const p = new PoliticaDeAtlas();
    assert.equal(p.pedir("X"), "arranca");
    const t = arranca(p, "X", MANUAL);
    assert.equal(p.nuevoRun("X", ACTIVO), "encolada");
    assert.equal(p.terminar("X"), "nada", "la clave no está libre: la corrida manual sigue");
    assert.equal(p.finDeRun("X", t), "activo", "y al acabar la corrida, el activo vuelve a mirar");
    assert.equal(p.pedir("X"), "arranca");
  });

  it("el trigger solapado del ciclo espera al terminar aunque la corrida del ciclo acabe antes", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("X");
    const t = arranca(p, "X", ACTIVO);
    p.pedir("X"); // solapado
    assert.equal(p.finDeRun("X", t), "nada", "el ciclo sigue: el re-disparo es de su terminar");
    assert.equal(p.terminar("X"), "activo");
  });

  it("al acabar, la clave admite otra corrida", () => {
    const p = new PoliticaDeAtlas();
    const t = arranca(p, "X", MANUAL);
    p.finDeRun("X", t);
    assert.equal(p.vigente("X", t), false, "terminada, ya no manda");
    arranca(p, "X", MANUAL);
  });
});

describe("PoliticaDeAtlas · enVuelo, pintando y cambio de mundo", () => {
  it("enVuelo se enciende con una corrida y se apaga cuando acaba la ÚLTIMA", () => {
    const p = new PoliticaDeAtlas();
    assert.equal(p.enVuelo, false, "sin corridas no hay nada en vuelo");
    const a = arranca(p, "a", ACTIVO);
    const b = arranca(p, "b", MANUAL);
    assert.equal(p.enVuelo, true);
    p.finDeRun("a", a);
    assert.equal(p.enVuelo, true, "la de b sigue: el panel no puede decir «listo»");
    p.finDeRun("b", b);
    assert.equal(p.enVuelo, false);
  });

  it("pintando es verdad solo con una corrida que PUEDE pintar en vuelo", () => {
    // El panel dice «GENERANDO» con esto: decirlo de una resolve_only es
    // decirle a quien eligió no gastar que está gastando (QA tanda A, H3).
    const p = new PoliticaDeAtlas();
    const r = arranca(p, "a", ACTIVO); // resolve_only
    assert.equal(p.pintando, false);
    const m = arranca(p, "b", MANUAL);
    assert.equal(p.pintando, true);
    assert.deepEqual(p.clavesPintando, ["b"], "el panel NOMBRA el tile que pinta, no «el activo» (H-3)");
    p.finDeRun("b", m);
    assert.equal(p.pintando, false, "queda la que solo restaura");
    assert.equal(p.enVuelo, true);
    p.finDeRun("a", r);
    assert.equal(p.pintando, false);
  });

  it("cambioDeMundo invalida las corridas en vuelo, y el fin de una vieja no borra la nueva de la misma clave", () => {
    // Sin el corte global, una corrida del mundo viejo aplicaría sobre el
    // `tile_0_0` del mundo nuevo.
    const p = new PoliticaDeAtlas();
    const vieja = arranca(p, "tile_0_0", MANUAL);
    p.cambioDeMundo();
    assert.equal(p.vigente("tile_0_0", vieja), false, "arte del mundo anterior: no aplica");
    assert.equal(p.enVuelo, false);
    const nueva = arranca(p, "tile_0_0", ACTIVO);
    assert.equal(p.finDeRun("tile_0_0", vieja), "nada");
    assert.equal(p.vigente("tile_0_0", nueva), true, "el finally de la vieja no se lleva a la nueva");
    assert.equal(p.enVuelo, true);
  });

  it("H-5 · cambioDeMundo vacía lo encolado: nada del mundo viejo se re-dispara en el nuevo", () => {
    const p = new PoliticaDeAtlas();
    const t = arranca(p, "tile_0_0", MANUAL);
    assert.equal(p.pedir("tile_0_0"), "encolado");
    p.nuevoRun("tile_0_0", MANUAL);
    p.cambioDeMundo();
    assert.equal(p.finDeRun("tile_0_0", t), "nada");
    assert.equal(p.pedir("tile_0_0"), "arranca");
    assert.equal(p.terminar("tile_0_0"), "nada", "el re-disparo heredado del mundo viejo no llega");
  });

  it("cambioDeMundo no suelta los ciclos del activo: siguen deduplicando hasta su terminar", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("tile_0_0");
    p.cambioDeMundo();
    assert.equal(p.pedir("tile_0_0"), "encolado");
    assert.equal(p.terminar("tile_0_0"), "activo");
  });
});

describe("PoliticaDeAtlas · carril de restauración: los vecinos recuperan su arte sin tocar al activo (#714)", () => {
  it("una restauración encolada sale por siguienteRestauracion, vigente, y libera el turno al terminar", () => {
    const p = new PoliticaDeAtlas();
    assert.equal(p.siguienteRestauracion(), null, "sin nada encolado no hay nada que ejecutar");
    p.encolarRestauracion("tile_1_0");
    assert.equal(p.restaurando, 1);
    const r = p.siguienteRestauracion();
    assert.ok(r);
    assert.equal(r.key, "tile_1_0");
    assert.equal(p.restauracionVigente(r), true);
    assert.equal(p.restaurando, 1, "la que está en vuelo sigue contando");
    p.finDeRestauracion(r, "nada");
    assert.equal(p.restaurando, 0);
    assert.equal(p.restauracionVigente(r), false, "terminada, ya no manda");
    assert.equal(p.siguienteRestauracion(), null);
  });

  it("van de una en una y en orden de llegada", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    p.encolarRestauracion("b");
    assert.equal(p.restaurando, 2);
    const ra = p.siguienteRestauracion();
    assert.equal(ra?.key, "a", "FIFO: el orden del resume es el que se ve");
    assert.equal(p.siguienteRestauracion(), null, "con una en vuelo, la siguiente espera");
    p.finDeRestauracion(ra!, "nada");
    const rb = p.siguienteRestauracion();
    assert.equal(rb?.key, "b");
    assert.notEqual(rb, ra, "cada restauración es la suya");
  });

  it("el activo va antes: con un ciclo de activo en curso no sale ninguna restauración", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("vecino");
    p.pedir("activo");
    assert.equal(p.siguienteRestauracion(), null, "el vecino no compite con el ciclo del jugador");
    assert.equal(p.restaurando, 1, "espera, no se descarta");
    p.terminar("activo");
    assert.equal(p.siguienteRestauracion()?.key, "vecino", "el activo cedió el paso");
  });

  it("pedir la clave como activo invalida su restauración ENCOLADA", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("t");
    p.pedir("t");
    p.terminar("t");
    assert.equal(p.restaurando, 0, "la restauración de un tile que ya es activo se va");
    assert.equal(p.siguienteRestauracion(), null);
  });

  it("pedir la clave como activo invalida su restauración EN VUELO, que no aplica pero ocupa el turno hasta terminar", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("t");
    p.encolarRestauracion("otro");
    const r = p.siguienteRestauracion()!;
    assert.equal(p.pedir("t"), "arranca", "el activo arranca YA: no espera a la restauración");
    assert.equal(p.restauracionVigente(r), false, "la restauración vieja no aplica encima del activo");
    p.terminar("t");
    assert.equal(p.siguienteRestauracion(), null, "la invalidada sigue en el aire: una a la vez");
    p.finDeRestauracion(r, "nada");
    assert.equal(p.siguienteRestauracion()?.key, "otro");
  });

  it("encolar una clave con su ciclo de activo en curso no la encola", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("t");
    p.encolarRestauracion("t");
    assert.equal(p.restaurando, 0, "el ciclo del activo ya la restaura");
  });

  it("re-encolar una clave la supera: id nuevo, al final de la cola, y la vieja deja de mandar", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    p.encolarRestauracion("b");
    const ra = p.siguienteRestauracion()!;
    p.encolarRestauracion("a"); // el tile se re-añadió con la vieja en el aire
    assert.equal(p.restauracionVigente(ra), false, "lo que estaba en el aire es de la escena anterior");
    assert.equal(p.restaurando, 3, "b y la nueva de a esperan; la vieja sigue en vuelo");
    p.finDeRestauracion(ra, "nada");
    assert.equal(p.restaurando, 2, "el fin de la vieja no se lleva a la nueva");
    const rb = p.siguienteRestauracion()!;
    assert.equal(rb.key, "b", "la re-encolada va DETRÁS de b");
    p.finDeRestauracion(rb, "nada");
    const ra2 = p.siguienteRestauracion()!;
    assert.equal(ra2.key, "a");
    assert.notEqual(ra2, ra);
    assert.equal(p.restauracionVigente(ra2), true);
  });

  it("re-encolar una clave que aún no salió la mueve al final sin duplicarla", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    p.encolarRestauracion("b");
    p.encolarRestauracion("a");
    assert.equal(p.restaurando, 2, "a está una vez, no dos");
    const r1 = p.siguienteRestauracion()!;
    assert.equal(r1.key, "b");
    p.finDeRestauracion(r1, "nada");
    assert.equal(p.siguienteRestauracion()?.key, "a");
  });

  it("cambioDeMundo vacía la cola e invalida la que está en vuelo (cambio de partida)", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("tile_0_1");
    p.encolarRestauracion("tile_1_1");
    const r = p.siguienteRestauracion()!;
    p.cambioDeMundo();
    assert.equal(p.restauracionVigente(r), false, "arte de la partida anterior: no aplica");
    assert.equal(p.restaurando, 1, "solo queda la que va en el aire");
    assert.equal(p.siguienteRestauracion(), null, "sigue ocupando el turno");
    p.finDeRestauracion(r, "nada");
    assert.equal(p.restaurando, 0);
    assert.equal(p.siguienteRestauracion(), null, "la cola se vació");
  });

  it("restaurar no toca la corrida ni enVuelo del activo: sigue vigente", () => {
    // #390 por otra puerta: si restaurar un vecino superase la corrida del
    // activo, el tile del jugador se quedaría en clay al reanudar.
    const p = new PoliticaDeAtlas();
    const t = arranca(p, "activo", ACTIVO);
    p.encolarRestauracion("vecino");
    const r = p.siguienteRestauracion()!;
    p.finDeRestauracion(r, "nada");
    assert.equal(p.vigente("activo", t), true);
    assert.equal(p.enVuelo, true);
  });

  it("una corrida de una clave se lleva su restauración ENCOLADA, y con la corrida en vuelo no se encola otra", () => {
    // La G sobre un vecino que esperaba turno en el carril: la corrida ya lo
    // restaura (y pinta), la restauración de detrás no tiene nada que hacer.
    // (Con la restauración YA en vuelo, la corrida se encola: H-1, abajo.)
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("otro");
    p.encolarRestauracion("v");
    const r = p.siguienteRestauracion()!;
    assert.equal(r.key, "otro");
    const t = arranca(p, "v", MANUAL);
    assert.equal(p.restaurando, 1, "la encolada de v se fue: solo queda «otro», en vuelo");
    p.encolarRestauracion("v");
    assert.equal(p.restaurando, 1, "con la corrida de v en vuelo no se encola otra");
    p.finDeRun("v", t);
    p.encolarRestauracion("v");
    assert.equal(p.restaurando, 2, "libre la clave, vuelve a poder encolarse");
  });

  it("el fin de una restauración que no es la del turno no libera el turno", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    const ra = p.siguienteRestauracion()!;
    p.finDeRestauracion({ key: "a" }, "nada"); // misma clave, OTRA restauración
    assert.equal(p.restaurando, 1, "una restauración ajena no apaga la que corre");
    assert.equal(p.restauracionVigente(ra), true, "ni le quita la vigencia");
  });

  it("terminar dos veces la misma restauración, o sin ninguna en curso, no rompe nada", () => {
    const p = new PoliticaDeAtlas();
    p.finDeRestauracion({ key: "nadie" }, "nada");
    p.encolarRestauracion("a");
    const ra = p.siguienteRestauracion()!;
    p.finDeRestauracion(ra, "nada");
    p.finDeRestauracion(ra, "nada");
    assert.equal(p.restaurando, 0);
  });

  it("pedir la siguiente con la cola vacía no ocupa el turno", () => {
    const p = new PoliticaDeAtlas();
    assert.equal(p.siguienteRestauracion(), null);
    assert.equal(p.restaurando, 0, "un turno ocupado por nadie bloquearía la cola para siempre");
    p.encolarRestauracion("a");
    assert.equal(p.siguienteRestauracion()?.key, "a");
  });

  it("el balance de la tanda sale UNA vez, al vaciarse el carril, y cuenta cada desenlace (QA de #714, H1)", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    p.encolarRestauracion("b");
    p.encolarRestauracion("c");
    p.encolarRestauracion("d");
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "aplicado").balance, null, "con cola, todavía no");
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "sin-arte").balance, null);
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "aplicado").balance, null);
    assert.deepEqual(p.finDeRestauracion(p.siguienteRestauracion()!, "nada").balance, { aplicados: 2, pintados: 0, sinArte: 1 });
    // La tanda siguiente empieza de cero.
    p.encolarRestauracion("e");
    assert.deepEqual(p.finDeRestauracion(p.siguienteRestauracion()!, "sin-arte").balance, { aplicados: 0, pintados: 0, sinArte: 1 });
  });

  it("un vecino que PINTÓ cuenta aparte en el balance: es gasto y no se esconde entre los «$0»", () => {
    // Desde que pagar es configuración (2026-09-24), en producción con Imagen
    // IA el carril de los vecinos puede pintar. El mutante que lo cuente como
    // `aplicado` —o que no lo cuente— hace que el HUD diga «restaurados ($0)»
    // de un tile que costó dinero.
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    p.encolarRestauracion("b");
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "pintado").balance, null);
    assert.deepEqual(p.finDeRestauracion(p.siguienteRestauracion()!, "aplicado").balance, { aplicados: 1, pintados: 1, sinArte: 0 });
    // Y una tanda de solo pintados también da balance.
    p.encolarRestauracion("c");
    assert.deepEqual(p.finDeRestauracion(p.siguienteRestauracion()!, "pintado").balance, { aplicados: 0, pintados: 1, sinArte: 0 });
  });

  it("una tanda en la que no pasó nada no da balance: el HUD no dice «0 restaurados»", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "nada").balance, null);
  });

  it("con una restauración invalidada aún en vuelo, el balance espera a que termine", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    const ra = p.siguienteRestauracion()!;
    p.encolarRestauracion("a"); // supera a la que va en el aire
    assert.equal(p.finDeRestauracion(ra, "nada").balance, null, "queda la re-encolada");
    assert.deepEqual(p.finDeRestauracion(p.siguienteRestauracion()!, "aplicado").balance, { aplicados: 1, pintados: 0, sinArte: 0 });
  });
});

describe("PoliticaDeAtlas · H-1: la restauración en vuelo también ocupa su clave", () => {
  it("con la restauración de V en vuelo, V está ocupada y una corrida de V se encola (no hay segundo POST)", () => {
    // En producción con Imagen IA la restauración de un vecino PINTA; el menú
    // dev sobre ese vecino mandaba un segundo POST con el mismo layout_key.
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("V");
    assert.equal(p.ocupada("V"), false, "encolada todavía no hay nada en el aire");
    const r = p.siguienteRestauracion()!;
    assert.equal(p.ocupada("V"), true);
    assert.equal(p.ocupada("otro"), false, "solo SU clave");
    assert.equal(p.nuevoRun("V", MANUAL), "encolada");
    assert.equal(p.restauracionVigente(r), true, "encolarse no le quita la vigencia a la que corre");
    const fin = p.finDeRestauracion(r, "pintado");
    assert.equal(fin.alQuedarLibre, "manual", "la manual sale al acabar la restauración");
    assert.equal(p.ocupada("V"), false);
  });

  it("la del activo que la encuentra en vuelo se re-dispara al acabar, y una restauración ajena no suelta nada", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("V");
    const r = p.siguienteRestauracion()!;
    assert.equal(p.nuevoRun("V", ACTIVO), "encolada");
    assert.equal(p.finDeRestauracion({ key: "V" }, "nada").alQuedarLibre, "nada", "no es la del turno");
    assert.equal(p.finDeRestauracion(r, "nada").alQuedarLibre, "activo");
  });

  it("con un ciclo de activo de V en curso, el fin de la restauración no lo suelta: lo hará su terminar", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("V");
    const r = p.siguienteRestauracion()!;
    p.pedir("V");
    p.nuevoRun("V", ACTIVO);
    assert.equal(p.finDeRestauracion(r, "nada").alQuedarLibre, "nada");
    assert.equal(p.terminar("V"), "activo");
  });
});

describe("lineaDeBalance · el HUD no esconde el gasto dentro del «$0»", () => {
  it("sin pintados, la línea de siempre (restaurados y sin arte)", () => {
    assert.equal(
      lineaDeBalance({ aplicados: 8, pintados: 0, sinArte: 0 }),
      "Atlas fps: 8 vecino(s) restaurado(s) de la librería ($0), 0 sin arte (clay)",
    );
  });

  it("con pintados, van DELANTE y rotulados como gasto", () => {
    assert.equal(
      lineaDeBalance({ aplicados: 2, pintados: 3, sinArte: 1 }),
      "Atlas fps: 3 vecino(s) PINTADO(S) (gasto), 2 vecino(s) restaurado(s) de la librería ($0), 1 sin arte (clay)",
    );
  });
});
