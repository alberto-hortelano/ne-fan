/** El HUD de ataques se genera desde el CATÁLOGO del sistema de combate de la
 *  sesión, y toda acción es tecla Y botón por el mismo camino.
 *
 *  Sin sesión rige el sistema estándar (5 tipos): es lo que ve quien abre una
 *  fixture. Con `systems.combat = "basic"` el HUD debe quedar en un solo
 *  botón — esa variante la cubre el test de nefan-core; aquí se comprueba que
 *  lo que el jugador VE casa con el catálogo activo. */
export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await ctx.nefan("loadFixture", "robledo_village");
  await ctx.waitFor("la fixture carga", () => (window.__nefan.status().scene ? true : null));

  const catalogo = (await ctx.nefan("state")).attackCatalog;
  const acciones = await ctx.nefan("ui.actions");
  const botones = acciones.attack ?? [];
  ctx.log(`catálogo: ${catalogo.join(", ")}`);

  ctx.expect("el sistema estándar ofrece 5 ataques", catalogo.length === 5, catalogo.join(","));
  ctx.expect(
    "hay un botón por ataque del catálogo",
    botones.length === catalogo.length,
    `${botones.length} botones vs ${catalogo.length} del catálogo`,
  );

  // La tecla y el botón son el mismo camino: seleccionar por el driver debe
  // reflejarse en lo que ofrece la barra.
  const segundo = catalogo[1];
  await ctx.nefan("inputDriver.selectAttack", segundo);
  const tras = await ctx.nefan("ui.actions");
  const activo = (tras.attack ?? []).find((b) => b.active || b.selected);
  ctx.expect(
    `seleccionar "${segundo}" queda reflejado en la barra`,
    Boolean(activo) && JSON.stringify(activo).includes(segundo),
    JSON.stringify(tras.attack),
  );
  await ctx.shot("hud");
}
