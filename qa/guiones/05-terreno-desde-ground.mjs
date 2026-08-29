/** El suelo del mundo sale de `ground`, y llega hasta la colisión.
 *
 *  Contexto (agosto 2026): se retiró el campo vectorial que el motor emitía y
 *  que el renderer 2D pintaba encima del grid. La única vía viva del suelo
 *  declarativo es ahora `ground` (paths, water, areas,
 *  decks) → `scene-expand` lo rasteriza al grid de terreno → `formatDToWorld`
 *  lo emite como `terrain_grid` → el cliente pinta ESE grid y deriva de él la
 *  colisión. Si esa cadena se rompe, el jugador ve un tile de hierba lisa: sin
 *  caminos, sin río, y andando por encima del agua.
 *
 *  Por eso el guion entra por una PARTIDA de verdad (título → mundo → vista →
 *  Comenzar) y no por el selector de fixtures: las fixtures traen su grid ya
 *  escrito a mano, así que pasarían aunque la rasterización estuviera muerta.
 *
 *  Cero créditos: preset 5, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar, celdaAMundo, esperarRegistro } from "../lib/sesion.mjs";

/** Precondición DECLARADA (la ejecuta qa/run.mjs antes de lanzar el guion):
 *   · `mundo` — el §6 exige un tile RASTERIZADO EN VIVO, y un mundo
 *     pre-generado por otro guion trae el anillo 3×3 ya horneado: el vecino
 *     del este existiría y el bridge lo re-difundiría de caché, con lo que
 *     este guion pasaría con la rasterización muerta. Sin artefacto de mundo,
 *     la partida arranca con bootstrap vivo y el vecino no existe. */
export const aisla = ["mundo"];

/** Puede disparar GENERACIÓN (escena del motor, página de atlas o skin): el
 *  runner ejerce el guardarraíl de cero créditos antes de lanzarlo y, contra
 *  un backend que no declare ser falso, este guion no corre (#295). Lo señaló
 *  el contador de rutas de pago del motor falso, no una lectura del código:
 *  `gasta` es «PUEDE gastar», no «gastó esta vez». */
export const gasta = true;

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  const plano = await ctx.page.evaluate(() => {
    const s = window.__nefan.scene;
    const g = s.terrain_grid;
    const cuenta = {};
    for (const fila of g?.grid ?? []) for (const ch of fila) cuenta[ch] = (cuenta[ch] ?? 0) + 1;
    return {
      scene_id: s.scene_id,
      ground: s.ground ?? null,
      mpc: g?.meters_per_cell ?? null,
      origin: g?.origin ?? null,
      filas: g?.grid?.length ?? 0,
      solid_chars: g?.solid_chars ?? null,
      legend: g?.legend ?? null,
      cuenta,
    };
  });
  ctx.log(`escena ${plano.scene_id} · chars del grid: ${JSON.stringify(plano.cuenta)}`);

  // ── 1. El motor declara el suelo, y el grid existe ──────────────────────
  const rasgos = Array.isArray(plano.ground) ? plano.ground : [];
  const caminos = rasgos.filter((f) => f.kind === "path" && Array.isArray(f.points));
  const aguas = rasgos.filter((f) => f.kind === "water");
  ctx.expect("la escena de sesión trae plan de suelo (`ground`)", rasgos.length > 0, `${rasgos.length} rasgos`);
  ctx.expect("hay al menos un camino declarado", caminos.length > 0, `${caminos.length}`);
  ctx.expect("hay al menos una masa de agua declarada", aguas.length > 0, `${aguas.length}`);
  ctx.expect("el grid de terreno llega al cliente", plano.filas > 0, `${plano.filas} filas`);
  if (!rasgos.length || !plano.filas) return;

  // ── 2. Cada rasgo declarado tiene su char en el grid ────────────────────
  // Es la prueba de que el grid se DERIVA del plan y no viene escrito: se
  // comprueba celda a celda contra la geometría que declaró el motor.
  const enGrid = await ctx.page.evaluate(
    ({ caminos, aguas }) => {
      const g = window.__nefan.scene.terrain_grid;
      const ch = (c, r) => g.grid[Math.round(r)]?.[Math.round(c)] ?? "?";
      return {
        // Punto medio de cada tramo declarado del camino (los extremos pueden
        // caer justo en la costura del tile).
        caminos: caminos.map((f) => {
          const pts = f.points;
          const [ax, ay] = pts[Math.floor(pts.length / 2) - 1] ?? pts[0];
          const [bx, by] = pts[Math.floor(pts.length / 2)] ?? pts[pts.length - 1];
          const c = Math.min(g.grid[0].length - 1, (ax + bx) / 2);
          const r = Math.min(g.grid.length - 1, (ay + by) / 2);
          return { id: f.id, celda: [Math.round(c), Math.round(r)], char: ch(c, r) };
        }),
        // Centro de cada masa de agua (elipse o rect declarados en celdas).
        aguas: aguas.map((f) => {
          const c = f.ellipse ? f.ellipse.center[0] : f.rect[0] + f.rect[2] / 2;
          const r = f.ellipse ? f.ellipse.center[1] : f.rect[1] + f.rect[3] / 2;
          return { id: f.id, celda: [Math.round(c), Math.round(r)], char: ch(c, r) };
        }),
      };
    },
    { caminos, aguas },
  );

  for (const c of enGrid.caminos) {
    ctx.expect(
      `el camino "${c.id}" está rasterizado en el grid (celda ${c.celda})`,
      c.char === "_",
      `char "${c.char}", esperado "_"`,
    );
  }
  for (const a of enGrid.aguas) {
    ctx.expect(
      `el agua "${a.id}" está rasterizada en el grid (celda ${a.celda})`,
      a.char === "w",
      `char "${a.char}", esperado "w"`,
    );
  }

  // ── 3. La leyenda decide qué bloquea ────────────────────────────────────
  const solidos = plano.solid_chars ?? [];
  ctx.expect("el agua es un char sólido", solidos.includes("w"), JSON.stringify(solidos));
  ctx.expect("el muro es un char sólido", solidos.includes("W"), JSON.stringify(solidos));
  ctx.expect("el camino NO es sólido", !solidos.includes("_"), JSON.stringify(solidos));

  // ── 4. …y eso llega al colisionador del jugador ─────────────────────────
  // Muestreo del grid entero (1 de cada 3 celdas): el char de agua bloquea
  // SIEMPRE; el de camino es transitable salvo donde encima hay un volumen
  // declarado (fuente de la plaza, puestos del mercado) — por eso el listón
  // del camino es "la mayoría" y el del agua es "todas".
  const muestra = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    const [ox, oz] = g.origin;
    const m = g.meters_per_cell;
    const acc = {};
    for (let r = 0; r < g.grid.length; r += 3) {
      for (let c = 0; c < g.grid[r].length; c += 3) {
        const ch = g.grid[r][c];
        acc[ch] ??= { total: 0, bloquea: 0 };
        acc[ch].total++;
        if (window.__nefan.probeCollide(ox + (c + 0.5) * m, oz + (r + 0.5) * m)) acc[ch].bloquea++;
      }
    }
    return acc;
  });
  const agua = muestra.w ?? { total: 0, bloquea: 0 };
  const camino = muestra._ ?? { total: 0, bloquea: 0 };
  ctx.log(`muestreo: agua ${agua.bloquea}/${agua.total} bloquean · camino ${camino.bloquea}/${camino.total} bloquean`);
  ctx.expect("TODAS las celdas de agua muestreadas bloquean", agua.total > 0 && agua.bloquea === agua.total, `${agua.bloquea}/${agua.total}`);
  ctx.expect(
    "la mayoría de las celdas de camino son transitables",
    camino.total > 0 && camino.bloquea < camino.total / 2,
    `${camino.bloquea}/${camino.total} bloquean`,
  );
  await ctx.shot("tile-con-suelo");

  // ── 5. El jugador se lo encuentra andando, no leyendo el JSON ───────────
  // Punto de partida: el tramo libre más cercano al borde SUR del agua, con
  // pista de al menos 4 celdas para que se note el avance. Después se empuja
  // al jugador hacia el norte y gana la primera de dos condiciones de ESTADO:
  // meterse en el agua (el fallo) o avanzar medio metro (la prueba de empuje).
  const salida = await ctx.page.evaluate(
    ({ colAgua }) => {
      const g = window.__nefan.scene.terrain_grid;
      const [ox, oz] = g.origin;
      const m = g.meters_per_cell;
      const zDe = (r) => oz + (r + 0.5) * m;
      const x = ox + (colAgua + 0.5) * m;
      let rAgua = -1;
      for (let r = 0; r < g.grid.length; r++) if (g.grid[r][colAgua] === "w") rAgua = r;
      if (rAgua < 0) return null;
      let libres = [];
      for (let r = rAgua + 1; r < g.grid.length; r++) {
        if (!window.__nefan.probeCollide(x, zDe(r))) libres.push(r);
        else if (libres.length >= 4) break;
        else libres = [];
      }
      if (libres.length < 4) return null;
      return { x, zSalida: zDe(libres[3]), zAgua: zDe(rAgua), rAgua };
    },
    { colAgua: enGrid.aguas[0].celda[0] },
  );
  ctx.expect("hay una orilla sur libre desde la que empujar", salida !== null, JSON.stringify(salida));
  if (!salida) return;

  await ctx.nefan("setPlayerPos", salida.x, salida.zSalida);
  await ctx.nefan("setYaw", Math.PI); // forward = −Z = hacia el norte, contra el agua
  ctx.expect("el punto de partida está libre", (await ctx.nefan("probeCollide", salida.x, salida.zSalida)) === false);

  // Carrera de DOS condiciones de estado, sin reloj: o el jugador se mete en el
  // agua (el fallo) o avanza medio metro hacia ella (la prueba de que empujaba
  // de verdad y se paró en la orilla). Antes se empujaba 6 s y se daba por
  // hecho que 6 s dan 0,5 m — que es cierto en una máquina ociosa y falso en
  // una cargada: el movimiento va por delta de rAF.
  const carrera = await ctx.holdUntil(
    "up",
    "el jugador entra en el agua, o avanza medio metro hacia ella",
    ({ zAgua, zSalida }) => {
      const z = window.__nefan.state().pos.z;
      if (z <= zAgua) return { entro: true, z };
      if (z < zSalida - 0.5) return { entro: false, z };
      return null;
    },
    60_000,
    { zAgua: salida.zAgua, zSalida: salida.zSalida },
  );
  const fin = (await ctx.nefan("state")).pos;
  ctx.expect(
    "el jugador NO entra en el agua declarada en `ground`",
    !carrera.entro,
    `z final ${fin.z.toFixed(2)} vs última fila de agua ${salida.zAgua.toFixed(2)}`,
  );
  ctx.expect("pero sí avanzó hacia ella", fin.z < salida.zSalida - 0.5, `${salida.zSalida.toFixed(2)} → ${fin.z.toFixed(2)}`);
  await ctx.shot("contra-el-agua");

  // ── 6. Un tile NUEVO, rasterizado EN VIVO ───────────────────────────────
  // El tile de entrada puede venir de la PRE-GENERACIÓN del mundo (snapshot
  // con su grid ya horneado: el log del bridge lo canta como "world snapshot
  // HIT"), así que por sí solo no demuestra que la rasterización siga viva.
  // Explorar hacia el este pide un tile al motor y su grid se construye AHORA
  // en el bridge, desde el `ground` que el motor acaba de declarar. Camino del
  // jugador: caminar hasta la frontera, aceptar la propuesta y cruzar.
  //
  // Y esa distinción, que es TODO lo que este bloque afirma, hasta ahora no se
  // comprobaba: un tile servido de caché y uno rasterizado en vivo llegan
  // iguales al cliente, así que con un mundo pre-generado por otro guion el
  // vecino del este ya existía y esto pasaba en verde con la rasterización
  // muerta. El bridge declara el ORIGEN en el `ready` y el cliente lo apunta en
  // su episodio de tile: aquí se EXIGE "engine".
  const antesTiles = await ctx.nefan("tiles");
  const cols = await ctx.page.evaluate(() => window.__nefan.scene.terrain_grid.grid[0].length);
  await ctx.nefan("setPlayerPos", plano.origin[0] + (cols - 8) * plano.mpc, 0);
  await ctx.nefan("setYaw", Math.PI / 2); // este
  const propuesta = await ctx
    .holdUntil("up", "pisar la frontera propone explorar", () => window.__nefan.frontier.proposal ?? null, 120_000)
    .catch((err) => {
      ctx.expect("caminar al este propone explorar el tile vecino", false, err.message);
      return null;
    });
  ctx.expect("caminar al este propone explorar el tile vecino", Boolean(propuesta), JSON.stringify(propuesta));
  if (!propuesta) return;

  await ctx.nefan("inputDriver.queueTileConfirm");
  // Se sigue caminando hasta ENTRAR en el tile nuevo: hasta que el jugador lo
  // pisa, `scene` sigue siendo el de partida.
  const nuevo = await ctx
    .holdUntil(
      "up",
      "el jugador entra en el tile recién generado",
      (previos) => {
        const s = window.__nefan.scene;
        if (!s || previos.includes(s.scene_id)) return null;
        const g = s.terrain_grid;
        const cuenta = {};
        for (const fila of g?.grid ?? []) for (const ch of fila) cuenta[ch] = (cuenta[ch] ?? 0) + 1;
        const ch = (c, r) => g.grid[Math.round(r)]?.[Math.round(c)] ?? "?";
        const caminos = (s.ground ?? [])
          .filter((f) => f.kind === "path" && Array.isArray(f.points))
          .map((f) => {
            const pts = f.points;
            const [ax, ay] = pts[Math.floor(pts.length / 2) - 1] ?? pts[0];
            const [bx, by] = pts[Math.floor(pts.length / 2)] ?? pts[pts.length - 1];
            const c = Math.min(g.grid[0].length - 1, (ax + bx) / 2);
            const r = Math.min(g.grid.length - 1, (ay + by) / 2);
            return { id: f.id, celda: [Math.round(c), Math.round(r)], char: ch(c, r) };
          });
        return { scene_id: s.scene_id, rasgos: (s.ground ?? []).length, cuenta, caminos };
      },
      180_000,
      antesTiles.map((k) => k),
    )
    .catch((err) => {
      ctx.expect("el jugador entra en el tile recién generado", false, err.message);
      return null;
    });
  if (!nuevo) return;
  ctx.log(`tile nuevo ${nuevo.scene_id} · ${nuevo.rasgos} rasgos · chars ${JSON.stringify(nuevo.cuenta)}`);

  // De dónde salió, según el BRIDGE (no según lo que parezca desde aquí).
  const episodio = await esperarRegistro(
    ctx,
    `el cliente registra de dónde salió ${nuevo.scene_id}`,
    "tileEpisodios",
    (key) => window.__nefan.tileEpisodios.find((e) => e.key === key && e.source !== null) ?? null,
    30_000,
    nuevo.scene_id,
  );
  ctx.log(`episodio de tile: ${JSON.stringify(episodio)}`);
  ctx.expect(
    "el tile del que habla este bloque lo acaba de GENERAR el motor (no es un HIT de caché ni del mundo pre-generado)",
    episodio.source === "engine",
    `source=${episodio.source}`,
  );

  ctx.expect("el tile nuevo declara camino en `ground`", nuevo.caminos.length > 0, JSON.stringify(nuevo.caminos));
  for (const c of nuevo.caminos) {
    ctx.expect(
      `rasterización EN VIVO: el camino "${c.id}" del tile nuevo está en su grid (celda ${c.celda})`,
      c.char === "_",
      `char "${c.char}", esperado "_"`,
    );
  }
  ctx.expect(
    "el grid del tile nuevo tiene celdas de camino",
    (nuevo.cuenta["_"] ?? 0) > 0,
    `chars del grid: ${JSON.stringify(nuevo.cuenta)}`,
  );
  await ctx.shot("tile-nuevo-explorado");
}
