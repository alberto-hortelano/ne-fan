/** La política del atlas, escrita desde sus dos incidentes: pedir dos veces la
 *  misma clave era pagar dos veces ($0.15×2, 2026-08-14), y no re-disparar
 *  —o descartar la clave distinta— era el tile del jugador en clay al reanudar
 *  (#390). Cada test nombra el mutante que mata. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PoliticaDeAtlas, modoDeCorrida } from "../src/scene/politica-de-atlas.js";

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
    assert.equal(p.terminar("tile_0_0"), "re-disparar");
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
    assert.equal(p.terminar("tile_1_0"), "re-disparar");
  });

  it("el trigger encolado de una clave no se cuela en el terminar de otra", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("a");
    p.pedir("b");
    p.pedir("b"); // b tiene un solapado
    assert.equal(p.terminar("a"), "nada", "a no tenía solapado: el de b no es suyo");
    assert.equal(p.terminar("b"), "re-disparar");
  });
});

describe("PoliticaDeAtlas · run y token: el tile nuevo supera al run en vuelo", () => {
  it("cada run recibe un token nuevo y solo el último es vigente", () => {
    const p = new PoliticaDeAtlas();
    const t1 = p.nuevoRun();
    assert.equal(p.vigente(t1), true);
    const t2 = p.nuevoRun();
    assert.notEqual(t1, t2, "dos runs no pueden compartir token: el viejo aplicaría su atlas encima del nuevo");
    assert.equal(p.vigente(t1), false, "el run superado deja de mandar");
    assert.equal(p.vigente(t2), true);
  });

  it("un token que ningún run recibió no es vigente", () => {
    // Los tokens salen SOLO de `nuevoRun`; el controller nunca pregunta por
    // uno que no le hayan dado, así que aquí no se promete nada sobre el 0
    // inicial — solo que un número inventado no manda.
    const p = new PoliticaDeAtlas();
    p.nuevoRun();
    assert.equal(p.vigente(999), false);
  });

  it("enVuelo se enciende con el run y se apaga cuando el run VIGENTE termina", () => {
    const p = new PoliticaDeAtlas();
    assert.equal(p.enVuelo, false, "sin runs no hay nada en vuelo");
    const t = p.nuevoRun();
    assert.equal(p.enVuelo, true);
    p.finDeRun(t);
    assert.equal(p.enVuelo, false);
  });

  it("el fin de un run SUPERADO no apaga el indicador del que lo superó", () => {
    // El `finally` del run viejo llega mientras el nuevo sigue descargando: si
    // apagara `enVuelo`, el panel dev diría «listo» con un POST en el aire.
    const p = new PoliticaDeAtlas();
    const viejo = p.nuevoRun();
    const nuevo = p.nuevoRun();
    p.finDeRun(viejo);
    assert.equal(p.enVuelo, true, "el run nuevo sigue en vuelo");
    p.finDeRun(nuevo);
    assert.equal(p.enVuelo, false);
  });
});

describe("modoDeCorrida · solo el tile activo puede pintar (#714)", () => {
  it("un tile que no es el activo solo restaura, TAMBIÉN con la generación encendida", () => {
    // El mutante que importa: un vecino que pinta con Imagen IA encendida es
    // gasto que la partida no pidió — ocho atlas por reanudar.
    assert.deepEqual(modoDeCorrida({ activo: false, generacion: true }), { resolveOnly: true });
    assert.deepEqual(modoDeCorrida({ activo: false, generacion: false }), { resolveOnly: true });
  });

  it("el activo pinta solo con la generación encendida", () => {
    assert.deepEqual(modoDeCorrida({ activo: true, generacion: true }), { resolveOnly: false });
    assert.deepEqual(modoDeCorrida({ activo: true, generacion: false }), { resolveOnly: true });
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

  it("olvidarRestauraciones vacía la cola e invalida la que está en vuelo (cambio de partida)", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("tile_0_1");
    p.encolarRestauracion("tile_1_1");
    const r = p.siguienteRestauracion()!;
    p.olvidarRestauraciones();
    assert.equal(p.restauracionVigente(r), false, "arte de la partida anterior: no aplica");
    assert.equal(p.restaurando, 1, "solo queda la que va en el aire");
    assert.equal(p.siguienteRestauracion(), null, "sigue ocupando el turno");
    p.finDeRestauracion(r, "nada");
    assert.equal(p.restaurando, 0);
    assert.equal(p.siguienteRestauracion(), null, "la cola se vació");
  });

  it("restaurar no toca el token ni enVuelo del activo: su corrida sigue vigente", () => {
    // #390 por otra puerta: si restaurar un vecino superase el run del activo,
    // el tile del jugador se quedaría en clay al reanudar.
    const p = new PoliticaDeAtlas();
    const t = p.nuevoRun();
    p.encolarRestauracion("vecino");
    const r = p.siguienteRestauracion()!;
    p.finDeRestauracion(r, "nada");
    assert.equal(p.vigente(t), true);
    assert.equal(p.enVuelo, true);
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
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "aplicado"), null, "con cola, todavía no");
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "sin-arte"), null);
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "aplicado"), null);
    assert.deepEqual(p.finDeRestauracion(p.siguienteRestauracion()!, "nada"), { aplicados: 2, sinArte: 1 });
    // La tanda siguiente empieza de cero.
    p.encolarRestauracion("e");
    assert.deepEqual(p.finDeRestauracion(p.siguienteRestauracion()!, "sin-arte"), { aplicados: 0, sinArte: 1 });
  });

  it("una tanda en la que no pasó nada no da balance: el HUD no dice «0 restaurados»", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    assert.equal(p.finDeRestauracion(p.siguienteRestauracion()!, "nada"), null);
  });

  it("con una restauración invalidada aún en vuelo, el balance espera a que termine", () => {
    const p = new PoliticaDeAtlas();
    p.encolarRestauracion("a");
    const ra = p.siguienteRestauracion()!;
    p.encolarRestauracion("a"); // supera a la que va en el aire
    assert.equal(p.finDeRestauracion(ra, "nada"), null, "queda la re-encolada");
    assert.deepEqual(p.finDeRestauracion(p.siguienteRestauracion()!, "aplicado"), { aplicados: 1, sinArte: 0 });
  });
});
