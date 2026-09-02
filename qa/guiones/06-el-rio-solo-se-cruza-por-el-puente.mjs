/** El río solo se cruza por el puente — y el jugador lo nota.
 *
 *  `formatDToWorld` emite en `terrain_grid.solid_chars` los chars del grid que
 *  bloquean, y los fija el ENGINE (`DEFAULT_SOLID_CHARS`: muro y agua), no la
 *  escena: nadie puede declarar un río vadeable ni un puente sólido. Esa lista
 *  alimenta el colisionador del cliente y la colisión server-side de NPCs
 *  (`bridge/sim-collision.ts`), así que un fallo aquí encierra al jugador o le
 *  deja andar sobre el agua.
 *
 *  Se comprueba ANDANDO, no leyendo el JSON: el río de `robledo_tile` se cruza
 *  por su puente y no por el agua. El agua y el puente salen los dos de
 *  `ground` (water + deck): es la misma agua contada en el grid y en el plan,
 *  y las dos fuentes tienen que decir lo mismo.
 *
 *  La fila por la que se cruza es el CENTRO del puente, no su primera fila:
 *  con la escala del tile (0,5 m/celda) el jugador mide 1,6 celdas de ancho,
 *  así que caminar por el borde del tablero le mete medio cuerpo en el agua
 *  de la fila de al lado.
 */

import { cargarFixture } from "../lib/fixtures.mjs";

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor, así que el runner no lo gatea. El motivo va en el valor y no en
 *  un booleano porque hay que escribirlo, se ve en el diff y dice qué CLASE
 *  de guion es. */
export const sinMotor = "cierra el título y carga fixtures del selector; nunca arranca partida";

const FIXTURE = "robledo_tile";

/** Coloca al jugador al oeste del río en la fila `r` y le hace caminar al
 *  este, AFIRMANDO si tenía que llegar al otro lado o no.
 *
 *  El signo es DATO y no dos funciones: el mismo paseo tiene que cruzar por el
 *  puente y NO cruzar por el agua — lo decide qué chars son sólidos, que es
 *  justo lo que este guion mide. Por eso `debeCruzar` es un parámetro de
 *  `expectEspera` (#261): en el caso negativo el timeout ES el éxito, y así se
 *  escribe donde se espera en vez de viajar en un `let cruzo = true` que
 *  alguien tiene que acordarse de mirar. */
async function cruzarPorLaFila(ctx, r, debeCruzar, aserto, maxMs = 7000) {
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
  const { ocurrio: cruzo } = await ctx.expectEspera(
    `el jugador llega al otro lado por la fila ${r}`,
    debeCruzar,
    (m) => (window.__nefan.state().pos.x >= m ? true : null),
    { ms: maxMs, arg: punto.xMeta, tecla: "up", aserto },
  );
  const fin = (await ctx.nefan("state")).pos;
  return { ...punto, libre, cruzo, fin };
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  // AFIRMA qué escena quedó puesta (#332): la espera propia era el patrón de #308.
  await cargarFixture(ctx, FIXTURE);

  const solidez = await ctx.page.evaluate(() => {
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
      solid_chars: g.solid_chars,
      claves: Object.keys(g).sort(),
      rioCols: [min, max],
      filaCruzable,
      filaBloqueada,
      charsPuente: filaCruzable >= 0 ? g.grid[filaCruzable].slice(min, max + 1) : "",
    };
  });
  ctx.log(`río en columnas ${solidez.rioCols} · fila del puente ${solidez.filaCruzable} ("${solidez.charsPuente}") · fila maciza ${solidez.filaBloqueada}`);

  // ── 1. Lo que el engine fija como sólido ────────────────────────────────
  ctx.expect("el agua es sólida", (solidez.solid_chars ?? []).includes("w"), JSON.stringify(solidez.solid_chars));
  ctx.expect("el muro es sólido", (solidez.solid_chars ?? []).includes("W"), JSON.stringify(solidez.solid_chars));
  ctx.expect("el puente NO es sólido", !(solidez.solid_chars ?? []).includes("b"), JSON.stringify(solidez.solid_chars));
  ctx.expect("el camino NO es sólido", !(solidez.solid_chars ?? []).includes("_"), JSON.stringify(solidez.solid_chars));
  ctx.expect(
    "el grid viaja solo con lo que la colisión necesita (sin nombres por char)",
    JSON.stringify(solidez.claves) === JSON.stringify(["cols", "grid", "meters_per_cell", "origin", "rows", "solid_chars"]),
    JSON.stringify(solidez.claves),
  );
  ctx.expect("hay una fila cruzable (el puente) y una maciza", solidez.filaCruzable >= 0 && solidez.filaBloqueada >= 0, JSON.stringify(solidez));
  if (solidez.filaCruzable < 0 || solidez.filaBloqueada < 0) return;

  // ── 2. El puente se cruza andando ───────────────────────────────────────
  const porElPuente = await cruzarPorLaFila(
    ctx,
    solidez.filaCruzable,
    true,
    `el jugador CRUZA el río por el puente (fila ${solidez.filaCruzable})`,
  );
  ctx.expect("el punto de partida del puente está libre", porElPuente.libre);
  ctx.log(
    `por el puente: x ${porElPuente.xSalida.toFixed(1)} → ${porElPuente.fin.x.toFixed(1)} (meta ${porElPuente.xMeta.toFixed(1)})`,
  );
  await ctx.shot("cruzado-por-el-puente");

  // ── 3. …y el agua no ────────────────────────────────────────────────────
  const contraElAgua = await cruzarPorLaFila(
    ctx,
    solidez.filaBloqueada,
    false,
    `el jugador NO cruza por el agua (fila ${solidez.filaBloqueada})`,
  );
  ctx.expect("el punto de partida del agua está libre", contraElAgua.libre);
  ctx.log(
    `contra el agua: x ${contraElAgua.xSalida.toFixed(1)} → ${contraElAgua.fin.x.toFixed(1)} (meta ${contraElAgua.xMeta.toFixed(1)})`,
  );
  ctx.expect(
    "pero sí avanzó hasta la orilla",
    contraElAgua.fin.x > contraElAgua.xSalida + 0.5,
    `${contraElAgua.xSalida.toFixed(1)} → ${contraElAgua.fin.x.toFixed(1)}`,
  );
  await ctx.shot("contra-el-rio");
}
