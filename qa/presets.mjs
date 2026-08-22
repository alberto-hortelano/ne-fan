#!/usr/bin/env node
/** ¿Arranca cada preset de `./start.sh` lo que dice que arranca?
 *
 *  Es el candado ejecutable del criterio que dejó la retirada del cliente
 *  Godot (2026-08-22): el catálogo pasó de 11 servicios a 9 y de 10 presets a
 *  8, y las máscaras de `PRESET_PROFILES` son POSICIONALES. Un servicio que se
 *  añade o se quita desplaza todas las columnas de todas las filas, y el
 *  resultado no es un error: es un preset que levanta el servicio de al lado
 *  **en silencio**. Leer el script no lo caza —las máscaras siguen pareciendo
 *  correctas—, así que esto lo arranca de verdad y mira los puertos, que es lo
 *  que hace la tecla `s` (status) del menú.
 *
 *  No copia ni un dato del launcher: SERVICES, los puertos de SERVICE_LABELS,
 *  PRESET_SLUGS y PRESET_PROFILES se leen de `start.sh`. Si alguien añade un
 *  servicio y olvida una columna, la fila sale con ancho distinto y esto lo
 *  dice antes de arrancar nada.
 *
 *  Uso:
 *    node qa/presets.mjs                    todos los presets (~2-3 min)
 *    node qa/presets.mjs e2e html           solo los que casen con esos nombres
 *    node qa/presets.mjs --lista            qué comprobaría, sin arrancar nada
 *
 *  Cero créditos: arrancar un servicio no llama a ningún generador de pago.
 *
 *  AVISO (comportamiento PREEXISTENTE de start.sh, no de este guion): su
 *  `cleanup` mata TODOS los puertos de ALL_PORTS, incluido :3737, aunque no
 *  los haya arrancado él. Si corres esto con un terminal de Claude Code que
 *  posea el narrative-mcp, se lo lleva por delante. Ese hallazgo está en
 *  `docs/agents/2026-08-22-retirar-godot/qa.md`.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const START_SH = join(repoRoot, "start.sh");
const src = readFileSync(START_SH, "utf8");

/** Contenido de un array bash `NOMBRE=( … )` como lista de líneas crudas. */
function bashArray(name) {
  const m = src.match(new RegExp(`^${name}=\\(([\\s\\S]*?)^\\)`, "m"));
  if (!m) throw new Error(`no encuentro el array ${name} en start.sh`);
  return m[1]
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/** SERVICES=(bridge narrative-mcp …) va en una sola línea. */
const SERVICES = (src.match(/^SERVICES=\(([^)]*)\)/m) ?? [])[1]?.trim().split(/\s+/);
if (!SERVICES?.length) throw new Error("no encuentro SERVICES en start.sh");

/** clave de servicio → puertos que debe dejar escuchando.
 *  El puerto sale de SERVICE_LABELS ("bridge          :9877"), no de una
 *  constante copiada aquí. La State API (:9878) la levanta el propio bridge y
 *  no tiene slot: se lee de PORT_STATE. */
const PORT_STATE = Number((src.match(/^PORT_STATE=(\d+)/m) ?? [])[1]);
const labels = bashArray("SERVICE_LABELS").map((l) => l.replace(/^"|"$/g, ""));
if (labels.length !== SERVICES.length) {
  throw new Error(`SERVICE_LABELS tiene ${labels.length} entradas y SERVICES ${SERVICES.length}`);
}
const portsOf = {};
SERVICES.forEach((key, i) => {
  const p = labels[i].match(/:(\d+)/);
  if (!p) throw new Error(`la etiqueta de ${key} no declara puerto: ${labels[i]}`);
  portsOf[key] = [Number(p[1])];
});
portsOf.bridge.push(PORT_STATE);

const slugs = bashArray("PRESET_SLUGS").map((l) => l.replace(/^"|"$/g, ""));
const profiles = bashArray("PRESET_PROFILES").map((l) => l.replace(/^"|"$/g, "").trim().split(/\s+/));
if (slugs.length !== profiles.length) {
  throw new Error(`PRESET_SLUGS (${slugs.length}) y PRESET_PROFILES (${profiles.length}) no casan`);
}
for (const [i, row] of profiles.entries()) {
  if (row.length !== SERVICES.length) {
    throw new Error(
      `la máscara de "${slugs[i]}" tiene ${row.length} columnas y SERVICES ${SERVICES.length}: ` +
        `alguien añadió o quitó un servicio y no tocó todas las filas`,
    );
  }
}

const ALL_PORTS = [...new Set(Object.values(portsOf).flat())];

const casos = slugs
  .map((slug, i) => ({ slug, mask: profiles[i] }))
  .filter(({ slug }) => slug !== "custom")
  .map(({ slug, mask }) => {
    const activos = SERVICES.filter((_, i) => mask[i] === "1");
    const esperados = [...new Set(activos.flatMap((k) => portsOf[k]))];
    return { slug, activos, esperados, prohibidos: ALL_PORTS.filter((p) => !esperados.includes(p)) };
  });

const args = process.argv.slice(2);
const soloLista = args.includes("--lista");
const filtros = args.filter((a) => !a.startsWith("--"));
const elegidos = casos.filter((c) => filtros.length === 0 || filtros.some((f) => c.slug.includes(f)));

function portBusy(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), 800);
  });
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function puertosArriba(ports) {
  const out = [];
  for (const p of ports) if (await portBusy(p)) out.push(p);
  return out;
}

if (soloLista) {
  console.log(`servicios: ${SERVICES.join(" ")}`);
  for (const c of elegidos) {
    console.log(`\n${c.slug}`);
    console.log(`  servicios : ${c.activos.join(" ")}`);
    console.log(`  esperados : ${c.esperados.sort((a, b) => a - b).join(" ")}`);
    console.log(`  prohibidos: ${c.prohibidos.sort((a, b) => a - b).join(" ")}`);
  }
  process.exit(0);
}

const sucios = await puertosArriba(ALL_PORTS);
if (sucios.length) {
  console.error(
    `❌ hay puertos ocupados antes de empezar (${sucios.join(", ")}). Párralo todo ` +
      `(./start.sh y tecla k) y vuelve a lanzar: si no, no se sabe quién levantó qué.`,
  );
  process.exit(2);
}

const resultados = [];
for (const c of elegidos) {
  process.stdout.write(`\n▶ ${c.slug}\n  esperado: ${c.esperados.sort((a, b) => a - b).join(" ")}\n`);
  const t0 = Date.now();
  // stdin cerrado: la pausa de Claude Code de los presets con motor lee EOF y
  // sigue, igual que si alguien pulsara Enter.
  const child = spawn("./start.sh", ["--preset", c.slug], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
    detached: true,
  });
  let stderr = "";
  child.stderr.on("data", (b) => (stderr += b));

  let arriba = [];
  const limite = Date.now() + 120_000;
  while (Date.now() < limite) {
    arriba = await puertosArriba(c.esperados);
    if (arriba.length === c.esperados.length) break;
    await esperar(500);
  }
  const faltan = c.esperados.filter((p) => !arriba.includes(p));
  const colados = await puertosArriba(c.prohibidos);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  arriba  : ${arriba.sort((a, b) => a - b).join(" ") || "(ninguno)"}   [${secs}s]`);
  const ok = faltan.length === 0 && colados.length === 0;
  if (faltan.length) console.log(`  ✘ NO levantó: ${faltan.join(" ")}`);
  if (colados.length) console.log(`  ✘ levantó lo que NO dice: ${colados.join(" ")}`);
  if (ok) console.log("  ✔ los puertos arriba son exactamente los de su máscara");
  if (!ok && stderr.trim()) console.log(`  stderr: ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
  resultados.push({ slug: c.slug, ok, faltan, colados });

  // Parar y ESPERAR A QUE EL LAUNCHER MUERA, no solo a que los puertos queden
  // libres. Su `cleanup` recorre ALL_PORTS con `fuser -k` (SIGKILL) y una
  // pausa por puerto: si el siguiente preset arranca mientras esa pasada sigue
  // viva, el launcher moribundo mata el servicio recién nacido del siguiente
  // (medido: el fake-ai-server salía "Killed" en :18765). Es la misma trampa
  // que le espera a una persona que para un preset y arranca otro seguido.
  const muerto = new Promise((r) => child.once("exit", r));
  try {
    process.kill(-child.pid, "SIGINT");
  } catch {
    /* ya muerto */
  }
  await Promise.race([muerto, esperar(30_000)]);
  const finLimite = Date.now() + 30_000;
  while (Date.now() < finLimite) {
    if ((await puertosArriba(ALL_PORTS)).length === 0) break;
    await esperar(500);
  }
  await esperar(1000);
  const restos = await puertosArriba(ALL_PORTS);
  if (restos.length) console.log(`  ⚠ quedaron puertos ocupados tras parar: ${restos.join(" ")}`);
}

console.log(`\n${"─".repeat(60)}`);
for (const r of resultados) console.log(`${r.ok ? "✔" : "✘"} ${r.slug}`);
const ok = resultados.filter((r) => r.ok).length;
console.log(`${ok}/${resultados.length} presets arrancan exactamente su máscara`);
process.exit(ok === resultados.length ? 0 : 1);
