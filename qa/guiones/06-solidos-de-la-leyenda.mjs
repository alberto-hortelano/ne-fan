/** La leyenda del terreno decide qué se puede pisar — y el jugador lo nota.
 *
 *  `formatDToWorld` resuelve `terrain_legend` a dos cosas que el juego usa de
 *  verdad: el NOMBRE de cada char y la lista `solid_chars` que alimenta el
 *  colisionador del cliente y la colisión server-side de NPCs
 *  (`bridge/sim-collision.ts`). Los defaults (muro y agua bloquean) y la
 *  posibilidad de declarar `{name, solid:false}` para un vado son contrato,
 *  no detalle: un fallo aquí encierra al jugador o le deja andar sobre el río.
 *
 *  Se comprueba ANDANDO, no leyendo el JSON: el río de `robledo_tile` solo se
 *  cruza por su puente. Segunda mitad: la MISMA fixture servida con el agua
 *  declarada `solid:false` — el jugador debe poder vadearla por donde antes
 *  rebotaba. La sustitución se hace en la respuesta HTTP de la fixture (dato,
 *  no código): es exactamente lo que vería el jugador si el motor declarase
 *  ese vado, que el contrato de leyenda admite.
 *
 *  La fila por la que se cruza es el CENTRO del puente, no su primera fila:
 *  con la escala del tile (0,5 m/celda) el jugador mide 1,6 celdas de ancho,
 *  así que caminar por el borde del tablero le mete medio cuerpo en el agua
 *  de la fila de al lado. En la fixture vieja (2 m/celda) cualquier fila valía.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor, así que el runner no lo gatea. El motivo va en el valor y no en
 *  un booleano porque hay que escribirlo, se ve en el diff y dice qué CLASE
 *  de guion es. */
export const sinMotor = "cierra el título y carga fixtures del selector; nunca arranca partida";

const FIXTURE = "robledo_tile";
const FIXTURE_EN_DISCO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "nefan-core", "data", "scenes", `${FIXTURE}.json`,
);

/** Coloca al jugador al oeste del río en la fila `r` y le hace caminar al
 *  este. Devuelve la x final. */
async function cruzarPorLaFila(ctx, r, maxMs = 7000) {
  const punto = await ctx.page.evaluate((fila) => {
    const g = window.__nefan.scene.terrain_grid;
    const [ox, oz] = g.origin;
    const m = g.meters_per_cell;
    let min = Infinity;
    let max = -Infinity;
    for (const row of g.grid) {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "w") {
          min = Math.min(min, c);
          max = Math.max(max, c);
        }
      }
    }
    return {
      xSalida: ox + (min - 4 + 0.5) * m,
      xMeta: ox + (max + 3 + 0.5) * m,
      z: oz + (fila + 0.5) * m,
      cols: [min, max],
    };
  }, r);

  await ctx.nefan("setPlayerPos", punto.xSalida, punto.z);
  await ctx.nefan("setYaw", Math.PI / 2); // forward = +X = este
  const libre = (await ctx.nefan("probeCollide", punto.xSalida, punto.z)) === false;
  let cruzo = true;
  await ctx
    .holdUntil("up", "el jugador llega al otro lado", (m) => (window.__nefan.state().pos.x >= m ? true : null), maxMs, punto.xMeta)
    .catch(() => {
      cruzo = false;
    });
  const fin = (await ctx.nefan("state")).pos;
  return { ...punto, libre, cruzo, fin };
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await ctx.nefan("loadFixture", FIXTURE);
  await ctx.waitFor("la fixture carga", () => (window.__nefan.status().scene ? true : null));

  const leyenda = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    // Filas del puente: las que cruzan TODA la anchura del río con chars no
    // sólidos. Se camina por la de en MEDIO (el jugador tiene anchura: por el
    // borde del tablero rozaría el agua de la fila contigua). Fila de control:
    // la primera de agua maciza a partir de 6 filas más al sur del puente.
    let min = Infinity;
    let max = -Infinity;
    for (const row of g.grid) {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "w") {
          min = Math.min(min, c);
          max = Math.max(max, c);
        }
      }
    }
    const solidos = new Set(g.solid_chars ?? []);
    const filasCruzables = [];
    g.grid.forEach((row, i) => {
      for (let c = min; c <= max; c++) if (solidos.has(row[c])) return;
      filasCruzables.push(i);
    });
    const filaCruzable = filasCruzables.length ? filasCruzables[Math.floor(filasCruzables.length / 2)] : -1;
    const filaBloqueada = g.grid.findIndex(
      (row, i) => i >= filaCruzable + 6 && [...row.slice(min, max + 1)].some((ch) => solidos.has(ch)),
    );
    return {
      legend: g.legend,
      solid_chars: g.solid_chars,
      rioCols: [min, max],
      filaCruzable,
      filaBloqueada,
      charsPuente: filaCruzable >= 0 ? g.grid[filaCruzable].slice(min, max + 1) : "",
    };
  });
  ctx.log(`río en columnas ${leyenda.rioCols} · fila del puente ${leyenda.filaCruzable} ("${leyenda.charsPuente}") · fila maciza ${leyenda.filaBloqueada}`);

  // ── 1. La leyenda resuelta ──────────────────────────────────────────────
  ctx.expect("el agua es sólida por defecto", (leyenda.solid_chars ?? []).includes("w"), JSON.stringify(leyenda.solid_chars));
  ctx.expect("el puente NO es sólido", !(leyenda.solid_chars ?? []).includes("b"), JSON.stringify(leyenda.solid_chars));
  ctx.expect("el camino NO es sólido", !(leyenda.solid_chars ?? []).includes("_"), JSON.stringify(leyenda.solid_chars));
  ctx.expect("cada char del grid tiene nombre en la leyenda", Boolean(leyenda.legend?.w && leyenda.legend?.b), JSON.stringify(leyenda.legend));
  ctx.expect("hay una fila cruzable (el puente) y una maciza", leyenda.filaCruzable >= 0 && leyenda.filaBloqueada >= 0, JSON.stringify(leyenda));
  if (leyenda.filaCruzable < 0 || leyenda.filaBloqueada < 0) return;

  // ── 2. El vado se cruza andando ─────────────────────────────────────────
  const porElPuente = await cruzarPorLaFila(ctx, leyenda.filaCruzable);
  ctx.expect("el punto de partida del puente está libre", porElPuente.libre);
  ctx.expect(
    `el jugador CRUZA el río por el puente (fila ${leyenda.filaCruzable})`,
    porElPuente.cruzo,
    `x ${porElPuente.xSalida.toFixed(1)} → ${porElPuente.fin.x.toFixed(1)} (meta ${porElPuente.xMeta.toFixed(1)})`,
  );
  await ctx.shot("cruzado-por-el-puente");

  // ── 3. …y el agua no ────────────────────────────────────────────────────
  const contraElAgua = await cruzarPorLaFila(ctx, leyenda.filaBloqueada);
  ctx.expect("el punto de partida del agua está libre", contraElAgua.libre);
  ctx.expect(
    `el jugador NO cruza por el agua (fila ${leyenda.filaBloqueada})`,
    !contraElAgua.cruzo,
    `x ${contraElAgua.xSalida.toFixed(1)} → ${contraElAgua.fin.x.toFixed(1)} (meta ${contraElAgua.xMeta.toFixed(1)})`,
  );
  ctx.expect(
    "pero sí avanzó hasta la orilla",
    contraElAgua.fin.x > contraElAgua.xSalida + 0.5,
    `${contraElAgua.xSalida.toFixed(1)} → ${contraElAgua.fin.x.toFixed(1)}`,
  );
  await ctx.shot("contra-el-rio");

  // ── 4. `solid:false` en la leyenda abre el vado ─────────────────────────
  // Misma escena, mismo camino del jugador; lo único que cambia es lo que el
  // AUTOR declara del char de agua. Si `solid` dejara de leerse, el jugador
  // seguiría rebotando aquí y el guion se pone rojo.
  let servida = false;
  await ctx.page.route(`**/${FIXTURE}.json*`, async (route) => {
    const original = await route.fetch();
    const texto = await original.text();
    const escena = JSON.parse(readFileSync(FIXTURE_EN_DISCO, "utf8"));
    escena.terrain_legend = { ...escena.terrain_legend, w: { name: "vado", solid: false } };
    servida = true;
    // El cliente carga las fixtures con `import.meta.glob`, así que Vite las
    // sirve ya transformadas a módulo ES; se responde en el mismo formato en
    // el que venía.
    const esModulo = !texto.trimStart().startsWith("{");
    await route.fulfill(
      esModulo
        ? { body: `export default ${JSON.stringify(escena)};`, contentType: "application/javascript" }
        : { body: JSON.stringify(escena), contentType: "application/json" },
    );
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await ctx.nefan("loadFixture", FIXTURE);
  const conVado = await ctx.waitFor(
    "la escena con el vado declarado carga",
    () => {
      const g = window.__nefan.scene?.terrain_grid;
      return g && !(g.solid_chars ?? []).includes("w") ? { legend: g.legend.w, solid: g.solid_chars } : null;
    },
    20_000,
  );
  ctx.expect("la fixture se sirvió con el vado declarado", servida, String(servida));
  ctx.expect("`solid:false` saca el agua de solid_chars", !conVado.solid.includes("w"), JSON.stringify(conVado));
  ctx.expect("y conserva el nombre declarado", JSON.stringify(conVado.legend).includes("vado"), JSON.stringify(conVado.legend));

  const porElVado = await cruzarPorLaFila(ctx, leyenda.filaBloqueada);
  ctx.expect(
    `con el agua declarada vadeable, el jugador SÍ cruza por la fila ${leyenda.filaBloqueada}`,
    porElVado.cruzo,
    `x ${porElVado.xSalida.toFixed(1)} → ${porElVado.fin.x.toFixed(1)} (meta ${porElVado.xMeta.toFixed(1)})`,
  );
  await ctx.shot("vadeando");
}
