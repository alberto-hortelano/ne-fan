/** Todo lo que se ve en el bosque se comporta igual: o frena o no está.
 *
 *  Contexto (#243): una zona de vegetación plantaba DOS veces. Por un lado
 *  estampaba una entity `tree` de 1×1 por celda —cientos por tile— que el
 *  cliente pintaba como un poste marrón y que se ATRAVESABA; por otro derivaba
 *  un puñado de volúmenes tree de verdad, con copa y con tronco que frena. En
 *  la fixture de referencia eran 44 postes contra 3 árboles: el jugador veía un
 *  pinar y lo cruzaba andando, salvo en tres sitios.
 *
 *  Aquí se comprueba lo que le pasa a quien juega, no el recuento: que NINGÚN
 *  árbol del tile es atravesable, y que ninguno de los objetos que el cliente
 *  pinta encima del mundo es vegetación. El recuento entra solo como aserción
 *  pareada — sin ella, un tile sin árboles pasaría este guion entero.
 *
 *  Entra por el selector Room (`robledo_tile` declara el pinar del camino real
 *  y ocho árboles a mano): la vía de `html-fixtures`, sin motor y sin gastar un
 *  crédito.
 *
 *  EN NEGATIVO (probado el 2026-08-26): devolver el estampado de entities de
 *  vegetación a `scene-expand.ts` lo pone rojo por el paso 2 (aparecen objetos
 *  pintados que son vegetación y no tienen volumen). Quitar `volume_id` de la
 *  world scene lo pone rojo por el paso 3 (los ocho árboles declarados vuelven
 *  a pintarse como billboard). Y romper la colisión del tronco
 *  (`treeTrunkRadiusCells`) lo pone rojo por los pasos 4 y 5.
 */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor, así que el runner no lo gatea. El motivo va en el valor y no en
 *  un booleano porque hay que escribirlo, se ve en el diff y dice qué CLASE
 *  de guion es. */
export const sinMotor = "cierra el título y carga una fixture del selector; nunca arranca partida";

/** Espera a que el renderer EMITA frames nuevos: una captura pedida justo
 *  después de mover al jugador fotografía el frame ANTERIOR. Se espera por el
 *  contador de frames, nunca por reloj. */
async function esperarFrames(ctx, n = 3) {
  const antes = (await ctx.nefan("fps")).frames;
  await ctx.waitFor(
    `${n} frames nuevos`,
    ({ f0, n }) => (window.__nefan.fps().frames >= f0 + n ? true : null),
    10_000,
    { f0: antes, n },
  );
}

/** Sin bridge (preset `html-fixtures`) el arranque de partida falla a propósito
 *  y el jugador ve el muro de error. Se cierra por SU botón, como haría una
 *  persona, justo antes de cada captura. */
async function cerrarMuroSiHay(ctx) {
  await ctx.page.evaluate(() => {
    const muro = document.getElementById("narrative-loader");
    if (muro?.classList.contains("error")) document.getElementById("narrative-loader-dismiss")?.click();
  });
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece al arrancar", () => (document.getElementById("ts-close") ? { hay: true } : null));
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  await ctx.nefan("loadFixture", "robledo_tile");
  await ctx.waitFor("la fixture carga", () => (window.__nefan.status().scene ? true : null));
  await ctx.waitFor(
    "el mundo 3D instala el tile",
    () => {
      const f = window.__nefan.fps();
      return f && f.ready && f.activeTile ? f : null;
    },
    20_000,
  );

  // ── 1. Hay bosque que mirar (si no, todo lo demás sale verde vacío) ──────
  const inventario = await ctx.page.evaluate(() => {
    const s = window.__nefan.scene;
    const vols = s.__plan?.volumes ?? [];
    const objetos = s.objects ?? [];
    return {
      arboles: vols.filter((v) => v.type === "tree").map((v) => ({ id: v.id, at: v.at, s: v.s ?? 1 })),
      volumenes: vols.length,
      // Lo que el cliente pinta ENCIMA del mundo (billboards): todo objeto de
      // la escena que no esté representado por un volumen del plan.
      pintados: objetos
        .filter((o) => o.volume_id === undefined)
        .map((o) => ({ id: o.id, desc: String(o.description ?? ""), cat: o.category })),
      // Las entities `tree` del Format D crudo: las que declaró el motor.
      entitiesArbol: (s.__format_d?.entities ?? []).filter((e) => e.kind === "tree").length,
    };
  });
  ctx.log(
    `plan: ${inventario.volumenes} volúmenes · ${inventario.arboles.length} árboles · ` +
      `${inventario.pintados.length} objetos pintados como entidad · ${inventario.entitiesArbol} entities tree`,
  );
  ctx.expect("la fixture trae un bosque que mirar", inventario.arboles.length >= 10, `${inventario.arboles.length} árboles`);

  // ── 2. Ningún objeto PINTADO es vegetación ──────────────────────────────
  // Los postes eran justo esto: entities `tree` que el renderer dibujaba como
  // billboard y que no estaban en el plan, así que no colisionaban.
  const postes = inventario.pintados.filter((o) => /pino|abeto|roble|zarza|matorral|árbol|arbol/i.test(o.desc));
  ctx.expect(
    "ningún objeto pintado como entidad es un árbol (los postes se fueron)",
    postes.length === 0,
    JSON.stringify(postes.slice(0, 6)),
  );

  // ── 3. Los árboles DECLARADOS tampoco llevan un poste dentro ────────────
  // La fixture declara 8 árboles como entity; cada uno deriva su volumen y
  // queda marcado (`volume_id`), así que se pinta UNA vez: la copa del
  // greybox, no un cilindro dentro de ella.
  ctx.expect(
    "los árboles que el motor declaró a mano siguen en la escena",
    inventario.entitiesArbol === 8,
    `${inventario.entitiesArbol}`,
  );

  // ── 4. CADA árbol del plan frena ────────────────────────────────────────
  const blandos = await ctx.page.evaluate((arboles) => {
    const g = window.__nefan.scene.terrain_grid;
    const [ox, oz] = g.origin;
    const mpc = g.meters_per_cell;
    return arboles.filter((a) => !window.__nefan.probeCollide(ox + a.at[0] * mpc, oz + a.at[1] * mpc));
  }, inventario.arboles);
  ctx.expect(
    "todos los árboles del tile frenan (ninguno es decorado)",
    blandos.length === 0,
    JSON.stringify(blandos.slice(0, 6)),
  );

  // ── 5. …y se nota andando, que es como se lo encuentra el jugador ───────
  // Se elige un árbol del pinar con sitio libre al sur y se camina contra él.
  const objetivo = await ctx.page.evaluate((arboles) => {
    const g = window.__nefan.scene.terrain_grid;
    const [ox, oz] = g.origin;
    const mpc = g.meters_per_cell;
    for (const a of arboles) {
      const x = ox + a.at[0] * mpc;
      const z = oz + a.at[1] * mpc;
      // Corredor libre 4 m al sur del tronco: sitio para tomar carrerilla.
      let libre = true;
      for (let d = 1.2; d <= 4; d += 0.4) libre = libre && !window.__nefan.probeCollide(x, z + d);
      if (libre) return { id: a.id, x, z };
    }
    return null;
  }, inventario.arboles);
  ctx.expect("hay un árbol al que se puede uno acercar", Boolean(objetivo), JSON.stringify(objetivo));
  if (!objetivo) return;
  ctx.log(`objetivo: ${objetivo.id} en (${objetivo.x.toFixed(1)}, ${objetivo.z.toFixed(1)})`);

  const salida = { x: objetivo.x, z: objetivo.z + 4 };
  await ctx.nefan("setPlayerPos", salida.x, salida.z);
  await ctx.nefan("setYaw", Math.PI); // norte, contra el tronco
  ctx.expect("el punto de partida está libre", (await ctx.nefan("probeCollide", salida.x, salida.z)) === false);

  // Se espera por el FALLO: si el jugador ATRAVIESA el tronco, la condición se
  // cumple y el guion se pone rojo. El timeout es el éxito.
  let atraveso = true;
  await ctx
    .holdUntil(
      "up",
      "el jugador ATRAVIESA el árbol (esto sería el fallo)",
      (limite) => (window.__nefan.state().pos.z <= limite ? true : null),
      6000,
      objetivo.z - 0.5,
    )
    .catch(() => {
      atraveso = false;
    });
  const fin = (await ctx.nefan("state")).pos;
  ctx.expect(
    "el jugador NO atraviesa el tronco",
    !atraveso,
    `z final ${fin.z.toFixed(2)} vs tronco ${objetivo.z.toFixed(2)}`,
  );
  ctx.expect(
    "pero sí avanzó hacia él (no estaba bloqueado de salida)",
    fin.z < salida.z - 0.5,
    `${salida.z.toFixed(2)} → ${fin.z.toFixed(2)}`,
  );

  await cerrarMuroSiHay(ctx);
  await esperarFrames(ctx);
  await ctx.shot("contra-el-tronco");
}
