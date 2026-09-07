/** La elección de estilo (PR 7 de #241): qué estilos se le ofrecen a un mundo
 *  y cuál viene puesto. Manda el BRIDGE —el `style_id` del mundo si existe, si
 *  no el primero compatible, si no el primero—, y el desplegable ofrece los
 *  compatibles MÁS el preseleccionado cuando no está entre ellos.
 *
 *  Cada caso escribe a mano la lista ofrecida Y el preseleccionado: son dos
 *  respuestas distintas y un mutante puede romper una sin tocar la otra (girar
 *  el orden de las dos caídas cambia el default y deja la lista igual; quitar
 *  el `|| o === elegido` del filtro deja el default fuera de la lista, que es
 *  un `<select>` con un `value` que no existe). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { eleccionDeEstilo } from "../src/session/eleccion-de-estilo.js";

interface Estilo {
  style_id: string;
  tags?: readonly string[];
}

const MEDIEVAL: Estilo = { style_id: "medievo_crudo", tags: ["medieval", "historico"] };
const FANTASIA: Estilo = { style_id: "acuarela_luminosa", tags: ["fantasia", "medieval"] };
const NEON: Estilo = { style_id: "acero_neon", tags: ["futurista", "espacial"] };
const TODOS = [MEDIEVAL, FANTASIA, NEON];

const ids = (r: ReturnType<typeof eleccionDeEstilo<Estilo>>): string[] =>
  r.ofrecidos.map((o) => o.estilo.style_id);

describe("eleccionDeEstilo", () => {
  it("el estilo del mundo, cuando existe y casa por tema: preseleccionado y marcado", () => {
    const r = eleccionDeEstilo(TODOS, { style_id: "acuarela_luminosa", tags: ["fantasia", "medieval"] });
    assert.deepEqual(ids(r), ["medievo_crudo", "acuarela_luminosa"]);
    assert.equal(r.porDefecto, "acuarela_luminosa");
    const suyo = r.ofrecidos.find((o) => o.estilo.style_id === "acuarela_luminosa");
    assert.deepEqual({ ...suyo }, { estilo: FANTASIA, compatible: true, delMundo: true });
    // Y el otro compatible no se marca de nada.
    assert.deepEqual(
      { ...r.ofrecidos[0] },
      { estilo: MEDIEVAL, compatible: true, delMundo: false },
    );
  });

  it("el estilo del mundo que NO casa por tema se OFRECE igual, marcado, y sigue puesto", () => {
    // La conducta declarada de la PR 7 (recomendación (a) de plan.md §9): antes
    // el título ni lo ofrecía y preseleccionaba otro, mientras el bridge sí lo
    // respetaba — el mundo arrancaba con un estilo distinto del que declara.
    const r = eleccionDeEstilo(TODOS, { style_id: "acero_neon", tags: ["medieval"] });
    assert.deepEqual(ids(r), ["medievo_crudo", "acuarela_luminosa", "acero_neon"]);
    assert.equal(r.porDefecto, "acero_neon");
    assert.deepEqual(
      { ...r.ofrecidos[2] },
      { estilo: NEON, compatible: false, delMundo: true },
    );
  });

  it("el estilo del mundo que NO EXISTE cae al primero compatible", () => {
    const r = eleccionDeEstilo(TODOS, { style_id: "un_pack_borrado", tags: ["fantasia"] });
    assert.deepEqual(ids(r), ["acuarela_luminosa"]);
    assert.equal(r.porDefecto, "acuarela_luminosa");
    assert.equal(r.ofrecidos.every((o) => !o.delMundo), true);
  });

  it("un mundo SIN style_id (recién salido de develop_world) cae al primero compatible", () => {
    const r = eleccionDeEstilo(TODOS, { tags: ["futurista"] });
    assert.deepEqual(ids(r), ["acero_neon"]);
    assert.equal(r.porDefecto, "acero_neon");
  });

  it("sin NINGÚN compatible y sin estilo del mundo, el primero de la lista, ofrecido como «otro tema»", () => {
    const r = eleccionDeEstilo(TODOS, { tags: ["submarino"] });
    assert.deepEqual(ids(r), ["medievo_crudo"]);
    assert.equal(r.porDefecto, "medievo_crudo");
    assert.deepEqual(
      { ...r.ofrecidos[0] },
      { estilo: MEDIEVAL, compatible: false, delMundo: false },
    );
  });

  it("un mundo sin tags es compatible con todo y se queda con el suyo", () => {
    const r = eleccionDeEstilo(TODOS, { style_id: "acero_neon" });
    assert.deepEqual(ids(r), ["medievo_crudo", "acuarela_luminosa", "acero_neon"]);
    assert.equal(r.porDefecto, "acero_neon");
    assert.equal(r.ofrecidos.every((o) => o.compatible), true);
  });

  it("sin un solo estilo instalado: nada que ofrecer y nada puesto", () => {
    const r = eleccionDeEstilo([], { style_id: "acero_neon", tags: ["futurista"] });
    assert.deepEqual(r.ofrecidos, []);
    assert.equal(r.porDefecto, null);
  });

  it("INVARIANTE: `porDefecto` es null si y solo si no hay ofrecidos, y si no, está DENTRO", () => {
    // Lo que el llamante no tiene que volver a comprobar: el `<select>` nunca
    // se queda con un `value` que no es ninguna de sus opciones.
    const mundos = [
      { style_id: "acero_neon", tags: ["medieval"] },
      { style_id: "no_existe", tags: ["submarino"] },
      { tags: ["fantasia"] },
      {},
      { style_id: "medievo_crudo", tags: [] },
    ];
    for (const listas of [TODOS, [NEON], []]) {
      for (const mundo of mundos) {
        const r = eleccionDeEstilo(listas, mundo);
        assert.equal(
          r.porDefecto === null,
          r.ofrecidos.length === 0,
          `${JSON.stringify(mundo)} sobre ${listas.length} estilos`,
        );
        if (r.porDefecto !== null) assert.ok(ids(r).includes(r.porDefecto));
      }
    }
  });

  it("devuelve los MISMOS objetos que entran (el título pinta `name` y `description`)", () => {
    const conNombre = [{ style_id: "acero_neon", tags: ["futurista"], name: "Acero y neón" }];
    const r = eleccionDeEstilo(conNombre, { style_id: "acero_neon" });
    assert.equal(r.ofrecidos[0].estilo.name, "Acero y neón");
    assert.equal(r.ofrecidos[0].estilo, conNombre[0]);
  });

  it("no toca la lista que le dan", () => {
    const original = [...TODOS];
    eleccionDeEstilo(TODOS, { style_id: "acero_neon", tags: ["medieval"] });
    assert.deepEqual(TODOS, original);
  });
});
