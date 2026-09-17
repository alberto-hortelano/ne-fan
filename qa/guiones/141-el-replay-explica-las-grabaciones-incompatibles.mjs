/** #317: cada grabación alcanza el selector o dice qué le falta; nunca deja
 * el título esperando un catálogo inventado sin styles.
 *
 * Y lo mismo consigo mismo (#639): las grabaciones son material de SESIÓN
 * —`labs/narrative/runs/` no está en git y la receta de worktree no lo copia—,
 * así que en cualquier árbol nuevo este guion no tiene NADA que reproducir. Eso
 * eran dos mentiras distintas, y las dos aquí dentro: sin el directorio moría
 * con un `ENOENT: scandir` disfrazado de juego roto, y con el directorio
 * presente y VACÍO salía ✔ sin haber afirmado una sola vez, porque su único
 * `ctx.expect` vive dentro del bucle. Las dos son ⊘ con su motivo: el guion que
 * nació para que el reproductor explique qué le falta a una grabación tiene que
 * saber explicar qué le falta a él. La red general —un verde exige haber
 * afirmado algo— está en `qa/lib/veredictos.mjs`, y este guion era el único de
 * los 143 que podía caer en ella. */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { puertosLibres, esperarPuertoArriba, esperarPuertoLibre } from "../lib/puertos.mjs";

export const sinMotor = "solo pide los catálogos de las grabaciones al replay; nunca inicia una partida ni llama al motor";
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export default async function (ctx) {
  const runs = join(RAIZ, "labs/narrative/runs");
  const hayDirectorio = existsSync(runs);
  const grabaciones = hayDirectorio ? readdirSync(runs, { withFileTypes: true }).filter(d => d.isDirectory()) : [];
  // Antes de pedir el puerto: si no hay qué reproducir, no se reserva nada.
  if (grabaciones.length === 0) {
    ctx.sinMedir(
      `no hay grabaciones que reproducir: labs/narrative/runs/ ${hayDirectorio ? "está vacío" : "no existe"}. ` +
        `Son material de sesión (fuera de git, y la receta de worktree no las copia), así que este guion no ` +
        `puede decir nada del reproductor en este árbol; se graban jugando con el flujo de labs/narrative/README.md.`,
    );
  }
  const [puerto] = await puertosLibres(1);
  for (const run of grabaciones) {
    const salida = [];
    const proc = spawn(process.execPath, ["labs/narrative/replay-server.mjs"], {
      cwd: RAIZ, env: { ...process.env, PORT: String(puerto), LOG: join(runs, run.name, "events.ndjson") }, stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stderr.on("data", b => salida.push(String(b)));
    try {
      await esperarPuertoArriba(puerto, { maxMs: 15000, quien: run.name, siMuere: () => proc.exitCode !== null ? salida.join("") : null });
      const url = new URL(ctx.page.url());
      url.searchParams.set("bridge", `ws://127.0.0.1:${puerto}`);
      await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await ctx.page.waitForSelector("#ts-new", { timeout: 15000 });
      await ctx.page.click("#ts-new");
      const estado = await ctx.waitFor(`${run.name}: selector o diagnóstico preciso`, nombre => {
        if (document.querySelector("[data-game-id]")) return "selector";
        const registro = document.getElementById("error-log")?.textContent ?? "";
        return registro.includes(nombre) && registro.includes("catálogo compatible") && registro.includes("falta o no es válido") ? "diagnóstico" : null;
      }, 15000, run.name);
      ctx.expect(`${run.name}: desenlace explícito`, estado === "selector" || estado === "diagnóstico", salida.join(""));
      ctx.log(`${run.name}: ${estado}`);
    } finally {
      proc.kill("SIGTERM");
      await esperarPuertoLibre(puerto, { maxMs: 15000 });
    }
  }
}
