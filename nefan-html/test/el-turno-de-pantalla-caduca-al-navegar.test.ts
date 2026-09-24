/** LA REGLA DEL TURNO DEL TÍTULO, fuera del navegador (#731, tanda BB).
 *
 *  Los guiones 198, 199 y 200 la miden en el juego real para las pantallas por
 *  las que el jugador puede salir mientras esperan. Esto sujeta la regla misma,
 *  y es lo único que cubre las dos esperas por las que el jugador NO puede
 *  salir hoy: «Crear mundo» (tras `createGame`) y «Generar las refs que
 *  faltan» (tras `/styles/{id}/complete`) apagan su «Volver» mientras esperan.
 *  Esas dos navegaciones hacen la misma pregunta, y el día que alguien les
 *  devuelva el botón, lo que hace falta es que la regla siga siendo esta. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { crearTurnoDePantalla } from "../src/ui/turno-de-pantalla.js";

type Pantalla = "home" | "selector" | "editor" | "crear-mundo" | "subir-estilo";

describe("el turno de pantalla del título", () => {
  it("la pantalla pedida sigue delante hasta que se navega a otra", () => {
    const t = crearTurnoDePantalla<Pantalla>("home");
    const selector = t.pedir("selector");
    assert.equal(selector(), true);
    t.pedir("home");
    assert.equal(selector(), false, "tras «Volver», el pintado tardío del selector está caducado");
  });

  it("volver a pedir la MISMA pantalla también caduca el trabajo en vuelo de la anterior visita", () => {
    const t = crearTurnoDePantalla<Pantalla>("home");
    const primera = t.pedir("crear-mundo");
    const segunda = t.pedir("crear-mundo");
    assert.equal(primera(), false);
    assert.equal(segunda(), true);
  });

  it("un repintado se ata al turno de la pantalla pedida y NO abre turno", () => {
    const t = crearTurnoDePantalla<Pantalla>("home");
    const navegacion = t.pedir("selector");
    const refresco = t.laQueHayDelante("selector");
    assert.ok(refresco, "con el selector pedido, el refresco tiene turno");
    assert.equal(refresco(), true);
    assert.equal(navegacion(), true, "repintar no deja caducada la navegación que lo pidió");
    t.pedir("subir-estilo");
    assert.equal(refresco(), false, "salir del selector caduca su refresco en vuelo");
  });

  it("sin la pantalla pedida, el repintado no tiene turno (aunque la vieja siga en el DOM)", () => {
    const t = crearTurnoDePantalla<Pantalla>("home");
    t.pedir("selector");
    t.pedir("editor"); // «Continuar»: el editor espera al censo con el selector aún pintado
    assert.equal(t.laQueHayDelante("selector"), null);
  });

  it("la pantalla inicial está pedida sin haber navegado", () => {
    const t = crearTurnoDePantalla<Pantalla>("home");
    const home = t.laQueHayDelante("home");
    assert.ok(home);
    assert.equal(home(), true);
  });
});
