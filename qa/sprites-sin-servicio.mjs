#!/usr/bin/env node
/** ¿Sobrevive el arte YA PAGADO a que sprite-forge esté caído?
 *
 *  Desde 2026-08-24 las hojas de personaje las produce `sprite-forge`, un
 *  servicio en OTRO repositorio, y `/skin_sprite_sheet` de remote-gen es solo un
 *  adaptador. La clave del sheet vestido cuelga de la identidad de la hoja base
 *  (`base_key`), y esa identidad la da el servicio — así que la primera versión
 *  del adaptador la pedía ANTES de mirar su propia caché. Consecuencia: con el
 *  servicio caído, un sheet pagado que está en disco devolvía 503. En pantalla
 *  eso es cada NPC en maniquí y el retrato del diálogo en blanco, teniendo los
 *  ficheros ahí — peor que antes de la extracción, cuando la clave salía del
 *  disco local.
 *
 *  Lo arregla un índice de la última `base_key` conocida por
 *  `{model}/{anim}/{angle}` (`cache/sprite_sheets/_base_keys.json`). Este guion
 *  es su candado: sin él, el arreglo solo se puede comprobar a mano y volvería a
 *  romperse el día que alguien reordene el adaptador.
 *
 *  Las cuatro comprobaciones, en orden:
 *    1. servicio ARRIBA  + personaje pagado → 200 `cached`, con URLs y hero
 *    2. servicio CAÍDO   + personaje pagado → 200 `cached` (EL ARREGLO)
 *    3. servicio CAÍDO   + personaje NUEVO  → 503 que dice POR QUÉ, no 500 mudo
 *    4. servicio CAÍDO, sin el índice        → 503 (el arreglo es de verdad el
 *       índice: si esto diera 200, el 2 estaría pasando por otra cosa)
 *
 *  CERO CRÉDITOS, y no por confianza: `sprite-forge` se arranca con `--sin-skin`
 *  (sin worker de repintado, así que no hay nada que pueda llamar a un proveedor
 *  de imagen) y las cuatro rutas son o caché o error. Ninguna genera.
 *
 *  Vive fuera de `qa/guiones/` por la misma razón que `presets.mjs`: el runner
 *  arranca UN stack con navegador y se lo pasa a todos, y esto necesita arrancar
 *  y MATAR un servicio a media prueba, sin navegador ninguno.
 *
 *  Uso:  node qa/sprites-sin-servicio.mjs [--keep] [--reusar]
 *
 *  Arranca sus dos servicios y se niega a reutilizar un remote-gen ajeno sin
 *  `--reusar`: un proceso levantado antes de tu último cambio sigue ejecutando
 *  el adaptador VIEJO, y un verde así no vale nada (pasó durante la validación
 *  de esta misma tanda).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const KEEP = process.argv.includes("--keep");
/** Reutilizar un remote-gen que ya esté arriba. Por defecto NO: ver abajo. */
const REUSAR = process.argv.includes("--reusar");

/** Nada de constantes copiadas: los puertos y la URL del servicio salen de
 *  donde los lee el propio juego. */
const CONFIG = JSON.parse(readFileSync(join(repoRoot, "nefan-core/data/runtime_config.json"), "utf8"));
const FORGE_URL = String(CONFIG.ai_server?.sprite_forge_url ?? "");
if (!FORGE_URL) throw new Error("runtime_config.json no trae ai_server.sprite_forge_url");
const FORGE_PORT = Number(new URL(FORGE_URL).port || 8770);
const RGEN_PORT = Number(CONFIG.ports?.remote_gen ?? 8768);
const SKINS_DIR = join(repoRoot, "cache/sprite_sheets");
const INDEX = join(SKINS_DIR, "_base_keys.json");
const FORGE_DIR = process.env.NEFAN_SPRITE_FORGE_DIR ?? join(process.env.HOME ?? "", "code/sprite-forge");

const fallos = [];
const hijos = [];

function ok(t) { console.log(`  ✔ ${t}`); }
function mal(t) { console.log(`  ✘ ${t}`); fallos.push(t); }

function portBusy(port) {
  return new Promise((res) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.on("connect", () => (s.destroy(), res(true)));
    s.on("error", () => res(false));
    setTimeout(() => (s.destroy(), res(false)), 800);
  });
}

async function waitPort(port, ms, quiero = true) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await portBusy(port)) === quiero) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** El sujeto de la prueba: un personaje ya pagado y ALCANZABLE, o sea con
 *  `skin.base_key` en su meta (los sheets anteriores al traslado no lo tienen y
 *  ya no los encuentra nadie). Sin sujeto no se puede vouchear nada, así que
 *  esto es ROJO y no un verde vacío. */
function sujeto() {
  if (!existsSync(SKINS_DIR)) return null;
  for (const d of readdirSync(SKINS_DIR)) {
    const meta = join(SKINS_DIR, d, "meta.json");
    if (!existsSync(meta)) continue;
    const m = JSON.parse(readFileSync(meta, "utf8"));
    if (m?.skin?.base_key && m.model && m.anim && m.angle && m.skin.prompt) {
      return { hash: d, model: m.model, anim: m.anim, angle: m.angle, prompt: m.skin.prompt };
    }
  }
  return null;
}

async function pedirSkin(cuerpo) {
  const res = await fetch(`http://127.0.0.1:${RGEN_PORT}/skin_sprite_sheet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  }).catch((e) => ({ status: 0, _err: e.message }));
  if (!res.status) return { status: 0, body: { detail: res._err } };
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function arrancar(cmd, args, opts, etiqueta) {
  const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  p.stdout.on("data", (d) => log.push(String(d)));
  p.stderr.on("data", (d) => log.push(String(d)));
  hijos.push({ p, etiqueta, log });
  return p;
}

function matar(etiqueta) {
  for (const h of hijos) {
    if (h.etiqueta === etiqueta && h.p.exitCode === null) h.p.kill("SIGKILL");
  }
}

async function main() {
  console.log("¿Sobrevive el arte pagado a que sprite-forge esté caído?\n");

  if (!existsSync(join(FORGE_DIR, "bin/sprite-forge.mjs"))) {
    console.log(`ROJO — sprite-forge no está en ${FORGE_DIR}.`);
    console.log("  Clónalo (github.com/alberto-hortelano/sprite-forge) o define NEFAN_SPRITE_FORGE_DIR.");
    return 1;
  }
  const s = sujeto();
  if (!s) {
    console.log("ROJO — no hay ni un sheet de personaje ALCANZABLE en cache/sprite_sheets/");
    console.log("  (alcanzable = su meta.json trae skin.base_key). Sin arte pagado que");
    console.log("  proteger, este guion no puede dar fe de nada, así que no da verde.");
    console.log("  Para crear el sujeto sin gastar: arranca sprite-forge con");
    console.log("  SPRITE_FORGE_IMAGE_API=fake y pide un /skin_sprite_sheet cualquiera.");
    return 1;
  }
  console.log(`sujeto: ${s.model}/${s.anim}/${s.angle} — "${s.prompt}" (hash ${s.hash})\n`);
  const cuerpo = { model: s.model, anim: s.anim, angle: s.angle, prompt: s.prompt };
  const nuevo = { ...cuerpo, prompt: `personaje que no existe ${Date.now()}` };

  // ── sprite-forge, SIN worker de repintado: no hay nada que pueda gastar ──
  if (await portBusy(FORGE_PORT)) {
    console.log(`ROJO — el puerto ${FORGE_PORT} ya está ocupado; este guion necesita matarlo a media prueba.`);
    return 1;
  }
  arrancar("node", ["bin/sprite-forge.mjs", "serve", "--sin-skin",
    "--assets", join(repoRoot, "assets/characters"), "--port", String(FORGE_PORT)],
  { cwd: FORGE_DIR }, "forge");
  if (!(await waitPort(FORGE_PORT, 120_000))) {
    console.log(`ROJO — sprite-forge no llegó a escuchar en :${FORGE_PORT}.`);
    for (const h of hijos) if (h.etiqueta === "forge") console.log(h.log.join("").trimEnd() || "  (sin una línea de log)");
    return 1;
  }

  // ── remote-gen, que es quien tiene el adaptador ──
  //
  // Si ya hay uno escuchando, este guion NO lo reutiliza en silencio, y la razón
  // salió de tropezar con ella: Python carga el módulo del adaptador al
  // arrancar, así que un remote-gen levantado antes de tu último cambio sigue
  // ejecutando el código VIEJO. Durante la validación de esta misma tanda, un
  // proceso de hace dos minutos hizo que el guion diera VERDE con el bug
  // reintroducido a propósito. Un candado que da fe de un fichero que no es el
  // que corre es peor que no tener candado.
  if (await portBusy(RGEN_PORT)) {
    if (!REUSAR) {
      console.log(`ROJO — ya hay algo escuchando en :${RGEN_PORT} y no lo he arrancado yo.`);
      console.log("  Ese proceso cargó el adaptador cuando arrancó: si has tocado");
      console.log("  ai_server/routers/remote_generation.py después, este guion daría fe del");
      console.log("  código VIEJO. Párala (./start.sh → k) o pasa --reusar si sabes que es el bueno.");
      return 1;
    }
    console.log(`  ⚠️  reutilizo el remote-gen que ya estaba en :${RGEN_PORT} (--reusar):`);
    console.log("      este verde vale por el código que ESE proceso cargó, no por el del disco.\n");
  } else {
    arrancar("bash", ["-c", "source .venv/bin/activate && exec python -u ai_server/remote_gen_main.py"],
      { cwd: repoRoot }, "rgen");
    if (!(await waitPort(RGEN_PORT, 120_000))) {
      console.log(`ROJO — remote-gen no llegó a escuchar en :${RGEN_PORT}.`);
      for (const h of hijos) if (h.etiqueta === "rgen") console.log(h.log.join("").trimEnd());
      return 1;
    }
  }

  // 1 ─ con el servicio arriba, el pagado se sirve de caché
  let r = await pedirSkin(cuerpo);
  const urls1 = (r.body.frame_urls ?? []).reduce((a, f) => a + f.length, 0);
  if (r.status === 200 && r.body.cached === true && urls1 > 0) ok(`servicio arriba: 200 cached, ${urls1} urls`);
  else mal(`servicio arriba: esperaba 200 cached con urls, salió ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  const hash1 = r.body.hash;

  // ── se cae el servicio ──
  matar("forge");
  if (!(await waitPort(FORGE_PORT, 30_000, false))) { mal("sprite-forge no se murió"); }
  else console.log("\n  · sprite-forge caído\n");

  // 2 ─ EL ARREGLO: lo pagado sigue en pantalla
  r = await pedirSkin(cuerpo);
  const urls2 = (r.body.frame_urls ?? []).reduce((a, f) => a + f.length, 0);
  if (r.status === 200 && r.body.cached === true && r.body.hash === hash1 && urls2 === urls1) {
    ok(`servicio caído: el arte pagado sigue sirviéndose (200 cached, ${urls2} urls, mismo hash)`);
  } else {
    mal(`servicio caído: el arte PAGADO desapareció — ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }

  // 3 ─ lo nuevo no se puede generar, y se dice por qué
  r = await pedirSkin(nuevo);
  const detalle = String(r.body.detail ?? "");
  if (r.status === 503 && /no responde/.test(detalle) && /no est[áa] en la cach/.test(detalle)) {
    ok("servicio caído + personaje nuevo: 503 que explica la causa");
  } else {
    mal(`servicio caído + personaje nuevo: esperaba 503 explicando la causa, salió ${r.status} "${detalle.slice(0, 160)}"`);
  }

  // 4 ─ el arreglo es el índice, no otra cosa
  const bak = `${INDEX}.qa-bak`;
  let movido = false;
  if (existsSync(INDEX)) { renameSync(INDEX, bak); movido = true; }
  try {
    r = await pedirSkin(cuerpo);
    if (r.status === 503) ok("sin el índice de base_keys, el mismo pagado ya NO se puede servir (el arreglo es el índice)");
    else mal(`sin el índice, esperaba 503 y salió ${r.status}: el 2 está pasando por otro camino y no prueba lo que dice`);
  } finally {
    if (movido) renameSync(bak, INDEX);
  }

  console.log("");
  if (fallos.length) {
    console.log(`ROJO — ${fallos.length} comprobación(es) fallaron.`);
    return 1;
  }
  console.log("VERDE — el arte pagado sobrevive a la caída, y lo nuevo dice por qué no puede.");
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.log(`ROJO — ${e.stack ?? e.message}`);
} finally {
  if (!KEEP) for (const h of hijos) if (h.p.exitCode === null) h.p.kill("SIGKILL");
}
process.exit(code);
