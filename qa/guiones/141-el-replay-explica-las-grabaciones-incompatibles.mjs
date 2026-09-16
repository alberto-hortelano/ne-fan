/** #317: cada grabación alcanza el selector o dice qué le falta; nunca deja
 * el título esperando un catálogo inventado sin styles. */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { puertosLibres, esperarPuertoArriba, esperarPuertoLibre } from "../lib/puertos.mjs";

export const sinMotor = "solo pide los catálogos de las grabaciones al replay; nunca inicia una partida ni llama al motor";
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export default async function (ctx) {
  const runs = join(RAIZ, "labs/narrative/runs");
  const [puerto] = await puertosLibres(1);
  for (const run of readdirSync(runs, { withFileTypes: true }).filter(d => d.isDirectory())) {
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
