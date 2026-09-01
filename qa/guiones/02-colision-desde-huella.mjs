/** La colisión sale de la HUELLA declarada, nunca de los píxeles pintados.
 *
 *  Es uno de los invariantes más repetidos del proyecto y hasta ahora solo se
 *  comprobaba a ojo. El guion no usa coordenadas mágicas: descubre el borde
 *  del edificio sondeando con probeCollide, así sigue valiendo si la fixture
 *  se reordena. */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor, así que el runner no lo gatea. El motivo va en el valor y no en
 *  un booleano porque hay que escribirlo, se ve en el diff y dice qué CLASE
 *  de guion es. */
export const sinMotor = "cierra el título y carga una fixture del selector; nunca arranca partida";

import { cargarFixture } from "../lib/fixtures.mjs";

export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  // AFIRMA qué escena quedó puesta (#332): la espera propia era el patrón de #308.
  await cargarFixture(ctx, "robledo_tile");

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
  // la condición se cumple y el guion se pone rojo. El timeout ES el éxito, y
  // por eso se afirma con `expectEspera` (#261) en vez de tragarlo: que la
  // espera expire deja de ser un accidente que nadie mira y pasa a ser EL
  // DATO, escrito en el mismo sitio donde se espera. De paso desaparece el
  // baile del `let atraveso = true` que lo decía a través de una variable.
  const { ocurrio: atraveso } = await ctx.expectEspera(
    "el jugador atraviesa la huella del edificio",
    false,
    (limite) => (window.__nefan.state().pos.z <= limite ? true : null),
    {
      ms: 6000,
      arg: zBorde - 0.5,
      tecla: "up",
      aserto: "el jugador NO atraviesa la huella del edificio",
    },
  );

  const fin = (await ctx.nefan("state")).pos;
  ctx.log(`z final ${fin.z.toFixed(2)} vs borde ${zBorde.toFixed(2)} (atravesó: ${atraveso})`);
  ctx.expect("pero sí avanzó hacia él (no estaba bloqueado de salida)", fin.z < zSalida - 0.5, `${zSalida.toFixed(2)} → ${fin.z.toFixed(2)}`);
  await ctx.shot("contra-el-muro");
}
