/** Vista proscenio: pisar una zona de salida lleva al plató vecino.
 *
 *  Es el patrón "puertas de Resident Evil" y la ÚNICA forma de viajar en esta
 *  vista, así que una regresión aquí deja al jugador encerrado. Las fixtures
 *  posada_* están enlazadas entre sí y funcionan sin sesión (fallback local de
 *  transiciones), de modo que el guion no gasta un solo crédito. */
const DIR = {
  north: { yaw: Math.PI, dx: 0, dz: -1 },
  south: { yaw: 0, dx: 0, dz: 1 },
  east: { yaw: Math.PI / 2, dx: 1, dz: 0 },
  west: { yaw: -Math.PI / 2, dx: -1, dz: 0 },
};
const DIR_KEYS = Object.keys(DIR);

export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await ctx.nefan("loadFixture", "posada_salon");

  const stage = await ctx.waitFor("el plató se compone", () => window.__nefan.stage() ?? null);
  ctx.expect("la vista de la sesión es proscenio", (await ctx.nefan("view")) === "proscenium", await ctx.nefan("view"));
  ctx.expect("el plató declara salidas", (stage.exits ?? []).length > 0, `${(stage.exits ?? []).length} salidas`);
  await ctx.shot("salon");
  if (!stage.exits?.length) return;

  const origen = await ctx.page.evaluate(() => window.__nefan.scene?.scene_id ?? null);
  const salida = stage.exits.find((e) => DIR_KEYS.includes(e.edge)) ?? stage.exits[0];
  const dir = DIR[salida.edge];
  ctx.expect(`la salida "${salida.id}" tiene borde conocido`, Boolean(dir), salida.edge);
  if (!dir) return;
  ctx.log(`saliendo por ${salida.edge} hacia ${salida.to_place_id}`);

  // Arrancar DENTRO del plató, a 3 m de la zona, y caminar hacia ella: el
  // viaje debe dispararse por pisarla, no por teletransporte.
  const cx = (salida.rect.minX + salida.rect.maxX) / 2;
  const cz = (salida.rect.minZ + salida.rect.maxZ) / 2;
  await ctx.nefan("setPlayerPos", cx - dir.dx * 3, cz - dir.dz * 3);
  await ctx.nefan("setYaw", dir.yaw);

  // Pisar la zona PROPONE el viaje; viajar lo confirma el jugador (tecla Y).
  // Nadie se teletransporta contra su voluntad — por eso el guion pasa por
  // los dos pasos y no por uno.
  const propuesto = await ctx
    .holdUntil("up", "pisar la zona propone el viaje", () => window.__nefan.stageProposal() || null, 20_000)
    .catch((err) => {
      ctx.expect("pisar la zona de salida propone el viaje", false, err.message);
      return null;
    });
  ctx.expect("pisar la zona de salida propone el viaje", Boolean(propuesto));
  if (!propuesto) return;
  await ctx.shot("propuesta");

  await ctx.nefan("inputDriver.queueTileConfirm");
  const destino = await ctx
    .waitFor(
      "el plató cambia tras confirmar",
      (o) => {
        const id = window.__nefan.scene?.scene_id ?? null;
        return id && id !== o ? id : null;
      },
      20_000,
      origen,
    )
    .catch((err) => {
      ctx.expect("confirmar lleva al plató vecino", false, err.message);
      return null;
    });

  if (destino) {
    ctx.expect(`se viaja de "${origen}" a "${destino}"`, destino !== origen);
    const dentro = await ctx.page.evaluate(() => {
      const s = window.__nefan.stage();
      const p = window.__nefan.state().pos;
      if (!s?.bounds) return null;
      return {
        p,
        dentro: p.x >= s.bounds.minX && p.x <= s.bounds.maxX && p.z >= s.bounds.minZ && p.z <= s.bounds.maxZ,
      };
    });
    ctx.expect("el jugador aparece dentro de los límites del plató nuevo", dentro?.dentro === true, JSON.stringify(dentro));
    await ctx.shot("plato-vecino");
  }
}
