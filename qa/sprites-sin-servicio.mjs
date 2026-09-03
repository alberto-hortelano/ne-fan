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
 *  Lo arregla un índice de lo último que se supo de cada
 *  `{model}/{anim}/{angle}` (`cache/sprite_sheets/_base_keys.json`): su
 *  `base_key` y, desde #375, su perfil de repintado, porque los DOS entran en la
 *  clave del sheet vestido. Este guion es su candado: sin él, el arreglo solo se
 *  puede comprobar a mano y volvería a romperse el día que alguien reordene el
 *  adaptador.
 *
 *  Las cuatro comprobaciones, en orden:
 *    1. servicio ARRIBA  + personaje pagado → 200 `cached`, con URLs y hero
 *    2. servicio CAÍDO   + personaje pagado → 200 `cached` (EL ARREGLO)
 *    3. servicio CAÍDO   + personaje NUEVO  → 503 que dice POR QUÉ, no 500 mudo
 *    4. servicio CAÍDO, sin el índice        → 503 (el arreglo es de verdad el
 *       índice: si esto diera 200, el 2 estaría pasando por otra cosa)
 *    5. y en la 2, el arte servido de caché ha quedado APUNTADO en el
 *       asset-store —sheet Y hero, con su prompt, bajo el mismo ref (#376)—:
 *       el cache-hit es el único camino por el que pasa el arte pagado antes
 *       de que ese índice existiera, y este es el único sitio del repo donde
 *       el payload que compone `registrar_arte_de_personaje` se mide contra el
 *       zod REAL del store
 *
 *  ARRANCA TAMBIÉN EL ASSET-STORE, y no es decorado: desde #376 el adaptador
 *  indexa el hero y el sheet en LOS DOS caminos, y ese registro es fail-loud
 *  —el store es quien SIRVE estos frames, así que un 200 con él caído
 *  devolvería URLs muertas—. Sin él arriba, las cuatro comprobaciones de
 *  arriba darían 502 y este guion mediría el fallo equivocado. Su índice es un
 *  SQLite de usar y tirar (`NEFAN_MANIFEST_DB`, la palanca de #391): el del
 *  checkout no se toca ni para leerlo.
 *
 *  CERO CRÉDITOS, y no por confianza: `sprite-forge` se arranca con `--sin-skin`
 *  (sin worker de repintado, así que no hay nada que pueda llamar a un proveedor
 *  de imagen) y las cuatro rutas son o caché o error. Ninguna genera.
 *
 *  EL SUJETO SE LO PLANTA ÉL, y esa es la lección más cara de este guion. Antes
 *  buscaba un sheet pagado en `cache/sprite_sheets/`, o sea que dependía del
 *  accidente de lo que hubiera en la máquina de quien lo corriera: el día que
 *  #375 movió la clave, los 27 que había quedaron inalcanzables y el candado se
 *  puso ROJO sin que nada estuviera roto. Y regenerar uno era imposible sin el
 *  worker de repintado, que exige `rembg` (466 MB) que nadie tiene instalado —
 *  o sea un rojo permanente, que es la peor clase de candado.
 *
 *  Un «sheet pagado» son ficheros: frames + `meta.json` bajo la clave viva. Se
 *  escriben aquí y se borran al salir. La clave NO se recalcula a mano: se le
 *  pregunta al propio adaptador (`_skin_sheet_key` + `_perfil_efectivo`,
 *  importadas), porque una segunda implementación de la clave en este fichero
 *  sería el espejo que deriva — exactamente lo que #375 vino a cerrar.
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
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUERTOS_TODOS } from "./lib/stack.mjs";
import { puertoOcupado } from "./lib/puertos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const KEEP = process.argv.includes("--keep");
/** Reutilizar un remote-gen que ya esté arriba. Por defecto NO: ver abajo. */
const REUSAR = process.argv.includes("--reusar");

/** Nada de constantes copiadas: los puertos salen del mismo lector que usa el
 *  resto del banco, que además aplica `NEFAN_PORT_OFFSET`.
 *
 *  Que lo honre no es cosmética: era el ÚNICO consumidor de `qa/` que leía el
 *  snapshot a pelo, así que en un stack desplazado arrancaba su remote-gen en
 *  el puerto BASE — el del vecino— y medía contra el servicio de otro. Es
 *  literalmente el desenlace que esta tanda cierra. */
const FORGE_PORT = PUERTOS_TODOS.sprite_forge;
const RGEN_PORT = PUERTOS_TODOS.remote_gen;
const STORE_PORT = PUERTOS_TODOS.asset_store;
const FORGE_URL = `http://127.0.0.1:${FORGE_PORT}`;
const STORE_URL = `http://127.0.0.1:${STORE_PORT}`;
const SKINS_DIR = join(repoRoot, "cache/sprite_sheets");
const INDEX = join(SKINS_DIR, "_base_keys.json");
const FORGE_DIR = process.env.NEFAN_SPRITE_FORGE_DIR ?? join(process.env.HOME ?? "", "code/sprite-forge");

const fallos = [];
const hijos = [];
/** Lo que este guion escribió en `cache/` y tiene que llevarse al salir: el
 *  banco no deja arte de mentira en la caché del que lo corre. */
const plantados = [];
/** Los ficheros sueltos (el hero-shot) que este guion escribió en `cache/`. */
const plantadosFicheros = [];
/** El índice tal como lo encontramos, para devolverlo igual (o quitarlo si no
 *  estaba): el sujeto es nuestro, pero la caché es de quien corre el guion. */
let indicePrevio = null;
let habiaIndice = false;
/** El SQLite de usar y tirar del asset-store de este guion. */
let tmpStore = null;

function limpiar() {
  for (const d of plantados) rmSync(d, { recursive: true, force: true });
  for (const f of plantadosFicheros) rmSync(f, { force: true });
  if (habiaIndice) writeFileSync(INDEX, indicePrevio);
  else if (existsSync(INDEX)) rmSync(INDEX, { force: true });
  if (tmpStore) rmSync(tmpStore, { recursive: true, force: true });
}

/** Qué hay en el índice temporal del store, por kind. Se pregunta por HTTP
 *  (el fichero lo tiene abierto el hijo, que es su único dueño). */
async function filasDelStore(kind) {
  const res = await fetch(`${STORE_URL}/assets?asset_type=${kind}&limit=100`).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()).assets ?? [];
}

function ok(t) { console.log(`  ✔ ${t}`); }
function mal(t) { console.log(`  ✘ ${t}`); fallos.push(t); }

/** Espera a que el puerto esté ocupado (`quiero=true`) o libre (`quiero=false`).
 *
 *  El SONDEO ya no es propio —es `puertoOcupado` de `lib/puertos.mjs`, la única
 *  copia—, pero la espera sí se queda aquí y devolviendo booleano a propósito:
 *  este guion apaga servicios a media prueba y necesita AFIRMAR sobre el
 *  resultado (`mal("sprite-forge no se murió")`), no morir con una excepción
 *  que se llevaría por delante el resto del veredicto. */
async function waitPort(port, ms, quiero = true) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await puertoOcupado(port)) === quiero) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Le pregunta al ADAPTADOR qué clave compondría para esta petición, y con qué
 *  perfil e identidad de hoja base. No se calcula aquí: se importan
 *  `_perfil_efectivo` y `_skin_sheet_key` de producción y se llaman. Un segundo
 *  cálculo de la clave en este fichero sería el espejo que deriva, y el día que
 *  divergiera este guion daría fe de una clave que el juego no usa.
 *
 *  Es gratis: `GET /catalog` es disco y `POST /sheets format=none` es la
 *  identidad determinista de la hoja base, sin frames y sin pintar nada. */
function preguntarAlAdaptador({ model, anim, angle, prompt }) {
  const py = `
import asyncio, json, sys
sys.path.insert(0, "ai_server")
from config_snapshot import load_config
from deps import deps
from routers import remote_generation as rg
# El mismo cargador que usa remote_gen_main al arrancar: el ai_model del skin
# entra en la clave, así que tiene que salir de la config de verdad.
deps.config = load_config()
model, anim, angle, prompt, forge_url = sys.argv[1:6]
# Se apunta EXPLÍCITAMENTE al sprite-forge que ha arrancado este guion: el
# snapshot que lee deps no honra NEFAN_PORT_OFFSET, y preguntarle la clave al
# servicio del vecino es medir contra otro despliegue.
deps.config["sprite_forge_url"] = forge_url
async def main():
    perfil = await rg._perfil_efectivo(anim)
    base = await rg._forge("/sheets", {"model": model, "anims": [anim],
                                       "angle": angle, "format": "none"}, timeout=600.0)
    hoja = base["sheets"][0]
    ai_model = str(deps.config["sprite_skin_model"])
    # style_key vacío: la petición del guion no lleva style_id, como la del test.
    clave = rg._skin_sheet_key(hoja["base_key"], model, anim, angle, prompt, ai_model, "", perfil)
    # El hero_key también sale del adaptador: es la clave que el registro del
    # arte de personaje usa como identidad y como ref de pin (#376), y
    # recomponerla aquí sería el espejo que deriva.
    hero = rg.hero_key(prompt, model, angle, ai_model, "")
    print(json.dumps({"clave": clave, "hero_key": hero, "base_key": hoja["base_key"],
                      "keyframes": perfil[0], "play_fps": perfil[1],
                      "directions": hoja["meta"]["directions"], "ai_model": ai_model}))
asyncio.run(main())
`;
  const r = spawnSync("bash", ["-c",
    `source .venv/bin/activate && exec python -c "$1" "$2" "$3" "$4" "$5" "$6"`,
    "--", py, model, anim, angle, prompt, FORGE_URL], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`no se pudo preguntar la clave al adaptador:\n${(r.stderr || r.stdout || "").trim()}`);
  }
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

/** Un PNG 1×1 válido. Los frames no se leen en esta prueba (el adaptador solo
 *  compone sus URLs), pero un sheet de bytes inventados no sería un sheet. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Planta en disco el sujeto de la prueba: un sheet «ya pagado» bajo la clave
 *  VIVA, con su meta y sus frames, **y su hero-shot**, y lo apunta en el índice
 *  tal como lo haría el adaptador. Devuelve qué hay que borrar al salir.
 *
 *  Se planta en vez de buscarse porque un candado que depende de que alguien
 *  haya pagado arte en ESTA máquina no es un candado: es una lotería que se
 *  pone roja cuando cambia una clave y que no se puede devolver a verde sin
 *  gastar (o sin 466 MB de `rembg`).
 *
 *  EL HERO SE PLANTA DESDE EL QA DE #376, y es el arreglo de un verde que no
 *  podía ponerse rojo: sin hero en disco, la rama que compone su fila no se
 *  ejecutaba NUNCA, así que el check «no se inventó la fila del hero» lo
 *  satisfacía igual de bien un registro roto. Con el hero plantado, este guion
 *  es lo único del repo que ejerce el payload del hero contra el zod REAL del
 *  store — el fake de pytest no valida y los tests de TS escriben el suyo a
 *  mano. */
function plantarSujeto(peticion) {
  const info = preguntarAlAdaptador(peticion);
  const dir = join(SKINS_DIR, info.clave);
  if (existsSync(dir)) throw new Error(`el sujeto ${info.clave} YA existe: no lo planto yo, y no lo voy a borrar`);
  const heroPath = join(SKINS_DIR, "heroes", `${info.hero_key}.png`);
  if (existsSync(heroPath)) throw new Error(`el hero ${info.hero_key} YA existe: no lo planto yo, y no lo voy a borrar`);
  mkdirSync(dirname(heroPath), { recursive: true });
  writeFileSync(heroPath, PNG_1x1);
  mkdirSync(dir, { recursive: true });
  for (let d = 0; d < info.directions; d += 1) {
    for (let f = 0; f < info.keyframes; f += 1) {
      writeFileSync(join(dir, `dir_${d}_frame_${String(f).padStart(3, "0")}.png`), PNG_1x1);
    }
  }
  // meta.json el ÚLTIMO, como hace el adaptador: su presencia significa "está
  // entero". Y con la misma forma, para que sea un sujeto y no un decorado.
  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    model: peticion.model, anim: peticion.anim, angle: peticion.angle,
    directions: info.directions, frame_count: info.keyframes, fps: info.play_fps,
    duration: Number((info.keyframes / info.play_fps).toFixed(4)),
    frame_width: 256, frame_height: 256,
    skin: { prompt: peticion.prompt, ai_model: info.ai_model, api: "plantado-por-qa",
            cost_usd: 0, base_key: info.base_key },
  }, null, 2));
  return { ...info, dir, heroPath, urls: info.directions * info.keyframes };
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

  habiaIndice = existsSync(INDEX);
  if (habiaIndice) indicePrevio = readFileSync(INDEX);
  mkdirSync(SKINS_DIR, { recursive: true });

  if (!existsSync(join(FORGE_DIR, "bin/sprite-forge.mjs"))) {
    console.log(`ROJO — sprite-forge no está en ${FORGE_DIR}.`);
    console.log("  Clónalo (github.com/alberto-hortelano/sprite-forge) o define NEFAN_SPRITE_FORGE_DIR.");
    return 1;
  }
  // ── sprite-forge, SIN worker de repintado: no hay nada que pueda gastar ──
  if (await puertoOcupado(FORGE_PORT)) {
    console.log(`ROJO — el puerto ${FORGE_PORT} ya está ocupado; este guion necesita matarlo a media prueba.`);
    return 1;
  }
  arrancar("node", ["bin/sprite-forge.mjs", "serve", "--sin-skin",
    "--assets", join(repoRoot, "assets/characters"),
    "--set", join(repoRoot, "nefan-core/data/sprite-set.json"), "--port", String(FORGE_PORT)],
  { cwd: FORGE_DIR }, "forge");
  if (!(await waitPort(FORGE_PORT, 120_000))) {
    console.log(`ROJO — sprite-forge no llegó a escuchar en :${FORGE_PORT}.`);
    for (const h of hijos) if (h.etiqueta === "forge") console.log(h.log.join("").trimEnd() || "  (sin una línea de log)");
    return 1;
  }

  // ── el sujeto, plantado por nosotros bajo la clave VIVA ──
  const cuerpo = { model: "y_bot", anim: "idle", angle: "frontal_8",
    prompt: `sujeto plantado por el banco ${Date.now()}` };
  const nuevo = { ...cuerpo, prompt: `personaje que no existe ${Date.now()}` };
  const s = plantarSujeto(cuerpo);
  plantados.push(s.dir);
  plantadosFicheros.push(s.heroPath);
  console.log(
    `sujeto plantado: ${cuerpo.model}/${cuerpo.anim}/${cuerpo.angle} — "${cuerpo.prompt}"\n` +
    `  clave viva ${s.clave} · hero ${s.hero_key} · base ${s.base_key} · ` +
    `perfil ${s.keyframes}kf@${s.play_fps}fps · ${s.urls} frames\n`,
  );

  // ── asset-store, contra un índice de usar y tirar ──
  //
  // Es quien SIRVE los frames y, desde #376, quien les da dueño: sin él, cada
  // petición del adaptador sería un 502 y este guion mediría otra cosa. El
  // índice va a un temporal (`NEFAN_MANIFEST_DB`, #391) para no escribir en el
  // del checkout ni una fila.
  if (await puertoOcupado(STORE_PORT)) {
    console.log(`ROJO — ya hay algo escuchando en :${STORE_PORT} y no lo he arrancado yo.`);
    console.log("  Este guion necesita SU asset-store, contra un índice temporal: si midiera");
    console.log("  contra el del vecino escribiría filas en la caché de otro. Párale (./start.sh → k).");
    return 1;
  }
  tmpStore = mkdtempSync(join(tmpdir(), "qa-sprites-store-"));
  // `node --import tsx` y no `npx tsx`: `npx` es un PADRE que lanza el server
  // como NIETO, así que el SIGKILL de la limpieza mata al lanzador y deja el
  // store escuchando. Medido: la siguiente corrida se negaba por «ya hay algo
  // en ese puerto» — suyo, del run anterior. Así el hijo ES el servidor.
  arrancar(process.execPath, ["--import", "tsx", "services/asset-store/server.ts"], {
    cwd: join(repoRoot, "nefan-core"),
    env: { ...process.env, NEFAN_MANIFEST_DB: join(tmpStore, "manifest.sqlite3"),
           NEFAN_ASSET_STORE_PORT: String(STORE_PORT) },
  }, "store");
  if (!(await waitPort(STORE_PORT, 120_000))) {
    console.log(`ROJO — el asset-store no llegó a escuchar en :${STORE_PORT}.`);
    for (const h of hijos) if (h.etiqueta === "store") console.log(h.log.join("").trimEnd());
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
  if (await puertoOcupado(RGEN_PORT)) {
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
      { cwd: repoRoot, env: { ...process.env, NEFAN_URL_ASSET_STORE: STORE_URL } }, "rgen");
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

  // 2 bis ─ y ese cache-hit ha dejado DUEÑO (#376): el arte que ya estaba
  //         pagado antes de que el índice existiera solo pasa por aquí.
  const heroes = await filasDelStore("sprite_hero");
  const sheets = await filasDelStore("sprite_sheet");
  const sheetApuntado = (sheets ?? []).find((f) => f.hash === hash1);
  if (sheetApuntado && sheetApuntado.prompt === cuerpo.prompt) {
    ok(`el cache-hit dejó el sheet apuntado con su prompt ("${sheetApuntado.prompt.slice(0, 40)}")`);
  } else {
    mal(`el cache-hit no apuntó el sheet ${hash1} con su prompt: ${JSON.stringify(sheets)?.slice(0, 200)}`);
  }
  // El HERO, contra el zod REAL del store. Es la mitad del cable que ningún
  // test de la PR ejercía: el fake de pytest no valida payloads y los tests de
  // TS escriben el suyo a mano, así que si la forma que compone
  // `registrar_arte_de_personaje` derivara, nadie se enteraría hasta ver un
  // NPC en maniquí. Aquí el payload es el de producción y el schema el de
  // producción.
  const heroApuntado = (heroes ?? []).find((f) => f.hash === s.hero_key);
  if (heroApuntado && heroApuntado.prompt === cuerpo.prompt) {
    ok(`y el HERO también, con su prompt y su clave (${s.hero_key})`);
  } else {
    mal(`el hero ${s.hero_key} no quedó apuntado con su prompt: ${JSON.stringify(heroes)?.slice(0, 200)}`);
  }
  // Y los dos bajo el MISMO ref, que es el «se sueltan juntos» del criterio de
  // cierre: un solo DELETE tiene que llevarse exactamente dos.
  const suelta = await fetch(`${STORE_URL}/assets/pin/${encodeURIComponent(`character:${s.hero_key}`)}`, {
    method: "DELETE",
  }).then((r) => r.json()).catch(() => null);
  if (suelta?.removed === 2) ok("y un solo DELETE del ref del personaje suelta hero Y frames (removed=2)");
  else mal(`el ref del personaje no tenía hero + frames: ${JSON.stringify(suelta)}`);

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
  if (!KEEP) {
    for (const h of hijos) if (h.p.exitCode === null) h.p.kill("SIGKILL");
    limpiar();
  } else {
    console.log(`\n  (--keep: el sujeto se queda en ${plantados.join(", ") || "ningún sitio"})`);
  }
}
process.exit(code);
