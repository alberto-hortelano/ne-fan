/** #591: reproduce en el pintor DOM real la oscilación medida de ±4,5 px.
 * Proyección controlada: el paseo actual del motor falso llega a separar los
 * nombres 55 px, donde DEBEN volver. No se congela ese movimiento legítimo.
 * El guion 126 conserva la prueba completa de cámara, foco y separación. */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  const medida = await ctx.page.evaluate(async () => {
    const { WorldLabels } = await import("/src/ui/world-labels.ts");
    const host = document.createElement("div");
    host.style.cssText = "width: 100%; height: 100%";
    document.getElementById("world-labels").append(host);
    const pintor = new WorldLabels(host);
    const labels = [
      { id: "cerca", text: "Tabernero corpulento", pos: { x: 0, y: 0, z: 0 } },
      { id: "lejos", text: "Bandido de camino", pos: { x: 1, y: 0, z: 0 } },
    ];
    let distancia = 300;
    const proyectar = x => ({ x: 400 + x * distancia, y: 300 + x * 10, depthM: 8 + x * 2 });
    const ids = () => [...host.querySelectorAll("[data-label-id]")].map(n => n.dataset.labelId).join(" ");
    try {
      pintor.sync(labels, proyectar);
      const anchos = [...host.children].map(n => n.getBoundingClientRect().width);
      const borde = (anchos[0] + anchos[1]) / 2;
      distancia = borde - 4.5;
      pintor.sync(labels, proyectar);
      const inicial = ids();
      let cambios = 0;
      let previo = inicial;
      for (let i = 0; i < 900; i++) {
        distancia = borde - 4.5 * Math.cos(i * Math.PI / 90);
        pintor.sync(labels, proyectar);
        const actual = ids();
        if (actual !== previo) cambios++;
        previo = actual;
      }
      distancia = borde + 12;
      pintor.sync(labels, proyectar);
      const separados = ids();
      pintor.clear();
      distancia = borde + 1;
      pintor.sync(labels, proyectar);
      return { inicial, cambios, separados, trasLimpiar: ids(), anchos };
    } finally {
      pintor.clear();
      host.remove();
    }
  });
  ctx.log(`900 posiciones del borde: ${JSON.stringify(medida)}`);
  ctx.expect("el ensayo empieza con el lejano oculto por solape", medida.inicial === "cerca");
  ctx.expect("±4,5 px no hacen oscilar el nombre en 900 posiciones", medida.cambios === 0);
  ctx.expect("una separación real devuelve ambos nombres en el mismo frame", medida.separados === "cerca lejos");
  ctx.expect("limpiar el mundo olvida la histéresis", medida.trasLimpiar === "cerca lejos");
}
