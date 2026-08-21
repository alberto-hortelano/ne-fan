/** Golden del atlas de superficies fps — la red bajo el trapecio.
 *
 *  Se retiran las vistas oblicua y proscenio (~12.000 líneas en trece PRs) y
 *  la fps sobrevive sola. El riesgo que no se ve al mirar la pantalla es que
 *  el desmontaje mueva de sitio una prim, redondee distinto o toque una
 *  descripción: el juego arranca, se ve IGUAL, y cada tile vuelve a pagar sus
 *  superficies con el arte ya comprado inalcanzable. Este fichero congela dos
 *  digests como literales para que ese cambio no pueda pasar callado.
 *
 *  ── Los dos digests NO valen lo mismo ────────────────────────────────────
 *  · `layout` — sha256 del JSON canónico del layout
 *    (`canonicalSurfaceLayoutJson(buildLayout(primsM))`). Keyea el ENSAMBLADO
 *    local del atlas (`localStorage` `fps_atlas:<key>`, ver
 *    `nefan-html/src/scene/fps-atlas.ts`) y el volcado de páginas de debug.
 *    Rotarlo cuesta UNA petición `resolve_only` que resuelve todo a $0: las
 *    imágenes siguen en la librería del servidor, que las reencuentra por SU
 *    clave. Es el digest INFORMATIVO.
 *  · `cells` — sha256 de la identidad de cada celda, `[desc, mat, kind,
 *    hints, ref]`, que es exactamente lo que el servidor hashea para decidir
 *    si una superficie ya está pagada:
 *    `hash_key(cell.desc, surface_cell_context(mat, kind, hints, ai_model,
 *    style_key, style_sheet_hash, cell_ref_hash))`
 *    (`ai_server/routers/remote_generation.py:254-279`). Es la MISMA tupla
 *    que ya usa `nefan-html/src/ui/style-apply.ts:186` para deduplicar el
 *    batch de estilo: una sola definición de identidad en el repo. Ni el
 *    `layout_key` ni el orden de las prims entran ahí. Es el digest FAIL-LOUD:
 *    si rota, se repaga arte.
 *
 *  Los campos que el servidor añade al contexto (`ai_model` según `kind`,
 *  `style_key`, `style_sheet_hash`, `cell_ref_hash`) salen de su config y del
 *  style pack, no de este árbol, y son invariantes a esta operación. De la
 *  ref se congela el ID porque es lo que produce este repo; el servidor mete
 *  el hash del CONTENIDO de su imagen (renombrar el fichero no repaga,
 *  cambiar el id sí).
 *
 *  Si un digest rota: NO actualices el literal para poner el test verde. Mira
 *  cuál de los dos es y lee arriba lo que significa. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFpsTileSpec } from "../src/scene/blueprint/fps-spec.js";
import { parseGround } from "../src/scene/blueprint/ground.js";
import { parseVolumes } from "../src/scene/blueprint/volumes.js";
import {
  buildLayout,
  canonicalSurfaceLayoutJson,
  type SurfaceCell,
  type SurfaceLayout,
} from "../src/scene/greybox/surfaces.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLANS = join(HERE, "fixtures", "fps-plans");

/** Semilla del scatter y de los rasgos de suelo: entra en el layout, así que
 *  es parte de la ENTRADA congelada. */
const SEED = "golden";

interface PlanFixture {
  biome?: string;
  scene_description?: string;
  ground?: unknown;
  volumes: unknown;
  scatter_generators?: unknown;
  scatter_zones?: unknown;
}

function readPlan(name: string): PlanFixture {
  return JSON.parse(readFileSync(join(PLANS, `${name}.json`), "utf-8")) as PlanFixture;
}

/** Plan de tile → layout del atlas, por el camino REAL del cliente
 *  (`ui/style-apply.ts` y `renderer/fps-renderer.ts` hacen esto mismo). */
function layoutOf(plan: PlanFixture, sceneDescription = plan.scene_description): SurfaceLayout {
  const volumes = parseVolumes(plan.volumes);
  assert.ok(volumes.ok, volumes.ok ? "" : `volumes de la fixture: ${volumes.error}`);
  const ground = parseGround(plan.ground ?? []);
  assert.ok(ground.ok, ground.ok ? "" : `ground de la fixture: ${ground.error}`);
  const { primsM } = buildFpsTileSpec(
    {
      ground: ground.features,
      volumes: volumes.volumes,
      biome: plan.biome,
      scene_description: sceneDescription,
      scatter_generators: plan.scatter_generators,
      scatter_zones: plan.scatter_zones,
    },
    SEED,
  );
  return buildLayout(primsM);
}

function cellsOf(layout: SurfaceLayout): SurfaceCell[] {
  return layout.pages.flatMap((p) => p.cells);
}

/** Identidad de CACHÉ de cada celda, ordenada: el orden de las prims no la
 *  toca (el servidor resuelve celda a celda), y así un reordenamiento —que es
 *  gratis— no se disfraza de repago. */
function cellIdentities(layout: SurfaceLayout): string[] {
  return cellsOf(layout)
    .map((c) => JSON.stringify([c.en, c.mat, c.kind, c.hints ?? [], c.ref ?? ""]))
    .sort();
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const digests = (layout: SurfaceLayout): { layout: string; cells: string } => ({
  layout: sha256(canonicalSurfaceLayoutJson(layout)),
  cells: sha256(JSON.stringify(cellIdentities(layout))),
});

/** Qué hacer cuando salta, escrito para quien lo vea rojo dentro de tres PRs
 *  sin nada de este contexto en la cabeza. */
function diagnostico(cual: "layout" | "cells", plan: string, layout: SurfaceLayout): string {
  const cabecera =
    cual === "cells"
      ? [
          `El digest de CELDAS del plan "${plan}" ha rotado. Esto CUESTA DINERO:`,
          "cada tile del juego vuelve a pagar sus superficies y el arte ya",
          "comprado queda inalcanzable en la librería. Ha cambiado alguna",
          "`desc`, `mat`, `kind`, `hints` o `ref` — mira greybox/surfaces.ts",
          "(classify / MAT_INFO / SHAPE_GROUPS) y blueprint/{ground,volume}-prims.ts.",
        ]
      : [
          `El digest de LAYOUT del plan "${plan}" ha rotado, pero el de celdas NO.`,
          "Es barato: se pierde el ensamblado en localStorage y el juego lo",
          "rehace con UNA petición resolve_only que resuelve todo a $0. Se ha",
          "movido/reordenado/redondeado una prim, o ha cambiado el packing.",
          "Si el cambio es deliberado, actualiza el literal y dilo en la PR.",
        ];
  const filas = cellsOf(layout).map(
    (c) => `    ${c.kind.padEnd(6)} ${c.mat.padEnd(14)} ref=${(c.ref ?? "-").padEnd(16)} ${JSON.stringify(c.en)}`,
  );
  return ["", ...cabecera, `  celdas actuales (${filas.length}):`, ...filas, ""].join("\n");
}

/** Literales MEDIDOS sobre la implementación viva el 2026-08-21, antes de la
 *  primera borrada. No se tocan sin decir por qué en la descripción de la PR. */
const GOLDEN: Record<string, { layout: string; cells: string; celdas: number }> = {
  // El plan más rico que produjo una sesión real: cutaway, muralla con
  // adarve, arco, torre, tapias, árboles, props de interior. Vivía en
  // labs/render/fixtures/medieval/plan.json.
  medieval: {
    layout: "fde255e2e8ebdd0ade135485ebfd4aa527e2d75096ceddb703b1109228429823",
    cells: "2979a5f148baee60898e50598a9fad22e531e01c9893bc834bd3e1a216a8237d",
    celdas: 15,
  },
  // Autorado para el golden: recorre los ejes que la fixture medieval no
  // tiene — agua, decks, caminos y áreas por material, prism, volumen custom
  // con piezas descritas, surface_desc por cara y por rol, surface_ref (de
  // volumen, por cara y de pieza) y un bloque de scatter (que NO debe aportar
  // ni una celda: las prims de scatter son `decor` → clay, coste 0).
  varied: {
    layout: "d140cab0957db1bef8225ec3170613fe055945bbb457a2377816e2cef3215065",
    cells: "23e82540af3acff1d8cbcbcc71863be07ab3f8d6711c6289c148a135d5b983a4",
    celdas: 26,
  },
};

describe("golden del atlas fps: el arte pagado sigue siendo alcanzable", () => {
  for (const plan of Object.keys(GOLDEN)) {
    const esperado = GOLDEN[plan];

    it(`${plan}: la identidad de caché de las celdas no ha rotado`, () => {
      const layout = layoutOf(readPlan(plan));
      const real = digests(layout);
      assert.equal(cellsOf(layout).length, esperado.celdas, diagnostico("cells", plan, layout));
      assert.equal(real.cells, esperado.cells, diagnostico("cells", plan, layout));
    });

    it(`${plan}: el layout_key no ha rotado (informativo, $0 si rota solo este)`, () => {
      const layout = layoutOf(readPlan(plan));
      assert.equal(sha256(canonicalSurfaceLayoutJson(layout)), esperado.layout, diagnostico("layout", plan, layout));
    });
  }

  it("la hora del día no toca el atlas: de noche salen los mismos digests", () => {
    // `scene_description` alimenta fps-ambience (luces, cielo, niebla) y NADA
    // más. Si algún día se filtrase a las prims —una ventana encendida, un
    // farol que emite geometría— el mismo tile pagaría DOS juegos de
    // superficies, uno de día y otro de noche, sin que nadie lo notase.
    const plan = readPlan("varied");
    const noche = layoutOf(plan, "Noche cerrada sobre el vado de los Alisos: la posada enciende sus faroles.");
    assert.equal(digests(noche).cells, GOLDEN.varied.cells, diagnostico("cells", "varied (noche)", noche));
    assert.equal(digests(noche).layout, GOLDEN.varied.layout, diagnostico("layout", "varied (noche)", noche));
  });

  it("el golden tiene sujeto: las fixtures ejercen de verdad el atlas", () => {
    // Un golden sobre un plan vacío pasaría siempre. Estas dos aserciones
    // son la prueba de vida de las fixtures.
    const medieval = cellsOf(layoutOf(readPlan("medieval")));
    const varied = cellsOf(layoutOf(readPlan("varied")));
    assert.ok(
      medieval.some((c) => c.kind === "tile") && medieval.some((c) => c.kind === "unique"),
      "la fixture medieval debe dar celdas tileables Y únicas",
    );
    assert.ok(
      varied.filter((c) => c.heroOf !== undefined).length >= 5,
      "la fixture varied debe dar celdas hero (surface_desc por cara/rol/pieza)",
    );
    assert.ok(varied.some((c) => c.ref !== undefined), "la fixture varied debe llevar surface_ref");
    assert.ok(varied.some((c) => c.mat === "water"), "la fixture varied debe llevar agua");
  });
});
