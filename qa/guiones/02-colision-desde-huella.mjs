/** La colisión sale de la HUELLA declarada, nunca de los píxeles pintados.
 *
 *  Es uno de los invariantes más repetidos del proyecto y hasta ahora solo se
 *  comprobaba a ojo. El guion no usa coordenadas mágicas: descubre el borde
 *  del edificio sondeando con probeCollide, así sigue valiendo si la fixture
 *  se reordena. */
export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await ctx.nefan("loadFixture", "robledo_village");
  await ctx.waitFor("la fixture carga", () => (window.__nefan.status().scene ? true : null));

  const objetivo = await ctx.page.evaluate(() => {
    const objs = window.__nefan.scene?.objects ?? [];
    const b = objs.find((o) => o.category === "building");
    return b ? { id: b.id, x: b.position[0], z: b.position[2], scale: b.scale } : null;
  });
  ctx.expect("la escena trae edificios con huella", Boolean(objetivo), JSON.stringify(objetivo));
  if (!objetivo) return;
  ctx.log(`objetivo: ${objetivo.id} en (${objetivo.x.toFixed(1)}, ${objetivo.z.toFixed(1)})`);

  ctx.expect("el centro del edificio colisiona", (await ctx.nefan("probeCollide", objetivo.x, objetivo.z)) === true);

  // Borde sur real, sondeado: desde 20 m al sur hacia el centro.
  const zBorde = await ctx.page.evaluate((o) => {
    for (let z = o.z + 20; z > o.z; z -= 0.25) {
      if (window.__nefan.probeCollide(o.x, z)) return z;
    }
    return null;
  }, objetivo);
  ctx.expect("se encuentra el borde sur sondeando", zBorde !== null, String(zBorde));
  if (zBorde === null) return;

  const zSalida = zBorde + 4;
  await ctx.nefan("setPlayerPos", objetivo.x, zSalida);
  await ctx.nefan("setYaw", Math.PI); // forward = -Z = hacia el norte, contra el muro
  ctx.expect("el punto de salida está libre", (await ctx.nefan("probeCollide", objetivo.x, zSalida)) === false);
  await ctx.shot("antes-de-empujar");

  // Se espera por el FALLO: si el jugador logra meterse dentro de la huella,
  // la condición se cumple y el guion se pone rojo. El timeout es el éxito.
  let atraveso = true;
  await ctx
    .holdUntil(
      "up",
      "el jugador ATRAVIESA el muro (esto sería el fallo)",
      (limite) => (window.__nefan.state().pos.z <= limite ? true : null),
      6000,
      zBorde - 0.5,
    )
    .catch(() => {
      atraveso = false;
    });

  const fin = (await ctx.nefan("state")).pos;
  ctx.expect("el jugador NO atraviesa la huella del edificio", !atraveso, `z final ${fin.z.toFixed(2)} vs borde ${zBorde.toFixed(2)}`);
  ctx.expect("pero sí avanzó hacia él (no estaba bloqueado de salida)", fin.z < zSalida - 0.5, `${zSalida.toFixed(2)} → ${fin.z.toFixed(2)}`);
  await ctx.shot("contra-el-muro");
}
