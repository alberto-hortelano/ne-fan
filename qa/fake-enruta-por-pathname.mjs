#!/usr/bin/env node
/** ¿El fake enruta por PATHNAME, como FastAPI? (#319, segunda mitad)
 *
 *  Antes de la tanda «remote-gen atado», el fake comparaba `req.url ===`:
 *  `POST /skin_sprite_sheet?x=1` daba 404 aquí y 200 en el server real, y el
 *  ref del unpin salía corrupto con query (`mi_ref?x=1`). El arreglo enruta
 *  con `parseRequestPath(req.url).path`. Este guion es su candado: el
 *  typecheck de labs no ve comportamiento runtime, y ningún guion del runner
 *  llama al fake con query string — sin esto, la regresión al `===` vuelve a
 *  pasar en verde.
 *
 *  Tres comprobaciones (más el campo `cached` del contrato en el wire):
 *    1. GET  /health?x=1            → 200 (la clase entera del bug)
 *    2. POST /skin_sprite_sheet?x=1 → 200 con `ok=true` y `cached` booleano
 *    3. DELETE /assets/pin/mi_ref?x=1 → el ref vuelve LIMPIO ("mi_ref"),
 *       no "mi_ref?x=1" (el slice sobre req.url corrompía el ref)
 *
 *  CERO CRÉDITOS: el sujeto es el fake — no existe proveedor que llamar.
 *
 *  Vive fuera de `qa/guiones/` por lo mismo que `sprites-sin-servicio.mjs`:
 *  arranca su propio servicio y no necesita navegador ni stack del runner.
 *
 *  Uso:  node qa/fake-enruta-por-pathname.mjs   (NEFAN_PORT_OFFSET se honra)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUERTOS_TODOS } from "./lib/stack.mjs";
import { puertoOcupado } from "./lib/puertos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const PORT = PUERTOS_TODOS.fake_ai;

const fallos = [];
function ok(t) { console.log(`  ✔ ${t}`); }
function mal(t) { console.log(`  ✘ ${t}`); fallos.push(t); }

async function waitPort(port, ms, quiero = true) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await puertoOcupado(port)) === quiero) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  console.log("¿El fake enruta por pathname, como FastAPI?\n");
  if (await puertoOcupado(PORT)) {
    console.error(`el puerto ${PORT} está ocupado — usa NEFAN_PORT_OFFSET para un bloque libre`);
    process.exit(1);
  }
  // `detached` + kill del GRUPO: `npx` delega en `tsx` y matar solo al padre
  // deja al fake vivo reteniendo el puerto (pasó en la primera corrida).
  //
  // cwd `nefan-core`, EXACTAMENTE como `start_fake_ai` en start.sh (#309):
  // ahí tsx es devDependency declarada. Desde la raíz del repo —sin
  // package.json ni node_modules— `npx tsx` resolvería (o descargaría) un
  // tsx que nadie declara, y en un clon limpio este candado no arrancaría.
  const hijo = spawn("npx", ["tsx", "../labs/narrative/fake-ai-server.ts"], {
    cwd: join(repoRoot, "nefan-core"),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
    detached: true,
  });
  const log = [];
  hijo.stderr.on("data", (d) => log.push(String(d)));
  try {
    if (!(await waitPort(PORT, 15000))) {
      console.error(`el fake no levantó en :${PORT}\n${log.join("")}`);
      process.exit(1);
    }
    const base = `http://127.0.0.1:${PORT}`;

    const r1 = await fetch(`${base}/health?x=1`);
    if (r1.status === 200) ok("GET /health?x=1 → 200 (la query no cambia la ruta)");
    else mal(`GET /health?x=1 → ${r1.status} (¿regresión a req.url ===?)`);

    const r2 = await fetch(`${base}/skin_sprite_sheet?x=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "y_bot", anim: "idle", angle: "frontal_8",
        prompt: "candado de enrutado", style_id: "qa_pathname",
      }),
    });
    if (r2.status !== 200) {
      mal(`POST /skin_sprite_sheet?x=1 → ${r2.status} (el real, FastAPI, da 200)`);
    } else {
      const body = await r2.json();
      if (body.ok === true && typeof body.cached === "boolean") {
        ok(`POST /skin_sprite_sheet?x=1 → 200 con ok=true y cached=${body.cached} (el campo del contrato viaja)`);
      } else {
        mal(`200 pero el cuerpo no cumple el contrato: ok=${body.ok}, cached=${JSON.stringify(body.cached)}`);
      }
    }

    const r3 = await fetch(`${base}/assets/pin/mi_ref?x=1`, { method: "DELETE" });
    const b3 = r3.status === 200 ? await r3.json() : {};
    if (r3.status === 200 && b3.ref === "mi_ref") {
      ok("DELETE /assets/pin/mi_ref?x=1 → ref limpio (la query no corrompe el slice)");
    } else {
      mal(`DELETE /assets/pin/mi_ref?x=1 → ${r3.status}, ref=${JSON.stringify(b3.ref)} (esperado "mi_ref")`);
    }
  } finally {
    try { process.kill(-hijo.pid, "SIGKILL"); } catch { hijo.kill("SIGKILL"); }
  }

  console.log("");
  if (fallos.length) {
    console.log(`ROJO — ${fallos.length} de 3`);
    process.exit(1);
  }
  console.log("VERDE — el fake enruta por pathname y el contrato viaja con query incluida.");
  process.exit(0);
}

await main();
