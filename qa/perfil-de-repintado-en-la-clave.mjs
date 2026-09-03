#!/usr/bin/env node
/** ¿Cambiar el perfil de repintado de una anim pide arte NUEVO, o sirve el viejo?
 *
 *  `keyframes` y `play_fps` de `nefan-core/data/sprite-set.json` son el PERFIL
 *  DE REPINTADO: deciden qué fotogramas se pintan y a qué velocidad se
 *  reproducen. Desde #369-R10 ese fichero no es una copia — `start.sh` se lo
 *  pasa a sprite-forge con `--set`, así que es el set VIVO. Hasta #375 el perfil
 *  no entraba en ninguna clave de caché (ni en la del sheet vestido de ne-fan ni
 *  en la `base_key` de sprite-forge), así que retocarlo producía un repintado
 *  distinto con la MISMA clave: se servía el arte viejo, sin error y sin aviso,
 *  con la factura ya pagada y el jugador viendo fotogramas que no corresponden
 *  al perfil declarado.
 *
 *  Esto es su candado **contra el servicio de VERDAD**. La batería de
 *  `ai_server/tests/test_sprite_forge_adapter.py` ya prueba la función de clave
 *  contra un sprite-forge de mentira; lo que ahí no se puede probar es la
 *  cadena entera que de verdad cuesta dinero: fichero del set → `GET /catalog`
 *  del servicio real (que MERGEA con su perfil por defecto y COLAPSA los
 *  keyframes que no caben en el ciclo) → clave del sheet vestido. Un espejo de
 *  esa aritmética en el lado Python es justo lo que #375 prohíbe, y solo el
 *  servicio real dice si el espejo existe.
 *
 *  Las seis comprobaciones:
 *    1. las 16 anims del set publican perfil UTILIZABLE, y lo declarado es lo
 *       efectivo (una anim sin perfil hereda el `PERFIL_POR_DEFECTO` de OTRO
 *       repo, y ese valor entraría en una clave de caché de ne-fan)
 *    2. tocar `keyframes` mueve la clave del VESTIDO — y revertir la devuelve
 *    3. tocar `play_fps` también
 *    4. y en los dos casos la `base_key` NO se mueve: la hoja base es gratis y
 *       no depende del perfil, así que meterlo allí repagaría arte que no cambió
 *    5. `4` y `4.0` en el set son el MISMO perfil: reescribir el JSON de otra
 *       manera no puede repagar ~16 llamadas de imagen por NPC
 *    6. con el servicio CAÍDO el catálogo sube como **503** y no como 502, que
 *       es lo único que deja al endpoint degradar y servir lo YA PAGADO desde
 *       `cache/sprite_sheets/_base_keys.json` — y ese índice, en su forma
 *       anterior a #375, se trata como AUSENTE y se DICE (nunca se le rellena
 *       el perfil con un defecto: una clave adivinada es un cache-miss
 *       disfrazado de acierto)
 *
 *  CERO CRÉDITOS, y no por confianza: sprite-forge arranca con `--sin-skin`
 *  (sin worker de repintado, así que **no existe proceso capaz de llamar a un
 *  proveedor de imagen**) y las dos rutas que se ejercen —`GET /catalog` y
 *  `POST /sheets format=none`— son disco y aritmética. Ni `/identity` ni
 *  `/skins` se llaman nunca.
 *
 *  Vive fuera de `qa/guiones/` por la misma razón que `sprites-sin-servicio.mjs`
 *  y `presets.mjs`: el runner arranca UN stack con navegador y se lo pasa a
 *  todos, y esto arranca y mata su propio servicio, no abre página ninguna y
 *  necesita el venv de Python (el sujeto es el adaptador, no el cliente).
 *
 *  El set se ejercita en una COPIA en `/tmp`, no en el fichero del repo: se
 *  afirma primero que la copia es idéntica byte a byte, así que el contenido
 *  que se mide es el vivo, y una muerte a media prueba no puede dejar el
 *  repositorio sucio con un perfil de mentira commiteable.
 *
 *  Uso:  node qa/perfil-de-repintado-en-la-clave.mjs [--keep]
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUERTOS_TODOS } from "./lib/stack.mjs";
import { puertoOcupado } from "./lib/puertos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const KEEP = process.argv.includes("--keep");

/** Nada de constantes copiadas: el puerto sale del snapshot de la fuente única
 *  y honra `NEFAN_PORT_OFFSET`, como manda `nadie-inventa-un-puerto`. */
const FORGE_PORT = PUERTOS_TODOS.sprite_forge;
const FORGE_URL = `http://127.0.0.1:${FORGE_PORT}`;
/** Un puerto donde no hay NADIE: el 6 necesita un servicio caído, y matar el
 *  que acabamos de arrancar dejaría el resto de comprobaciones sin servicio. */
const PUERTO_MUERTO = FORGE_PORT + 1;
const SET_VIVO = join(repoRoot, "nefan-core", "data", "sprite-set.json");
const VENV = join(repoRoot, ".venv", "bin", "python");
const FORGE_DIR = process.env.NEFAN_SPRITE_FORGE_DIR ?? join(process.env.HOME ?? "", "code/sprite-forge");
/** La anim que se toca. `idle` porque su perfil (8 kf @ 2,2 fps) no es el de
 *  por defecto de nadie: si la clave se moviera por otra razón, se vería. */
const ANIM = "idle";

const fallos = [];
const hijos = [];
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

/** El DRIVER: las claves las compone el adaptador de VERDAD, importado del
 *  disco. Un cálculo propio en node sería una cuarta copia de la receta, y
 *  volvería a dar verde el día que la de producción cambiara. */
const DRIVER = `
import asyncio, inspect, json, sys
sys.path.insert(0, ${JSON.stringify(join(repoRoot, "ai_server"))})
from fastapi import HTTPException
from deps import deps
from routers import remote_generation as rg

url, anim, prompt = sys.argv[1], sys.argv[2], "Blas, el tabernero"
deps.config["sprite_forge_url"] = url

async def main():
    out = {}
    # El adaptador puede no tener el perfil: es JUSTO el fallo que se cierra, y
    # tiene que salir como un rojo que lo nombra, no como un stack de Python.
    if not hasattr(rg, "_perfil_efectivo"):
        out["sin_perfil_en_el_codigo"] = "el adaptador no tiene _perfil_efectivo"
        print(json.dumps(out)); return
    if "perfil" not in inspect.signature(rg._skin_sheet_key).parameters:
        out["sin_perfil_en_el_codigo"] = "_skin_sheet_key no recibe perfil"
        print(json.dumps(out)); return
    try:
        base = await rg._forge("/sheets", {"model": "y_bot", "anims": [anim],
                                           "angle": "frontal_8", "format": "none"}, timeout=300.0)
        out["base_key"] = base["sheets"][0]["base_key"]
    except HTTPException as e:
        out["sheets_status"] = e.status_code
        out["sheets_detail"] = str(e.detail)
        print(json.dumps(out)); return
    try:
        perfil = await rg._perfil_efectivo(anim)
    except HTTPException as e:
        out["catalog_status"] = e.status_code
        out["catalog_detail"] = str(e.detail)
        print(json.dumps(out)); return
    out["perfil"] = [perfil[0], perfil[1]]
    out["vestido"] = rg._skin_sheet_key(out["base_key"], "y_bot", anim, "frontal_8",
                                        prompt, "gpt-image-2", "", perfil)
    print(json.dumps(out))

asyncio.run(main())
`;

/** El índice de bases en su forma ANTERIOR a #375, leído por el código de hoy.
 *  Se ejerce sobre un fichero temporal: la caché real no se toca. */
const DRIVER_INDICE = `
import inspect, json, logging, sys, tempfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(join(repoRoot, "ai_server"))})
from routers import remote_generation as rg

tmp = Path(tempfile.mkdtemp()) / "_base_keys.json"
rg._BASE_KEYS_INDEX = tmp
out = {}

logs = []
class Cazador(logging.Handler):
    def emit(self, r): logs.append(r.getMessage())
logging.getLogger("ai_server").addHandler(Cazador())

tmp.write_text(json.dumps({"y_bot/idle/frontal_8": "84b8b91255a268db"}))
out["vieja_leida"] = rg._leer_bases()
out["vieja_dicha"] = any("forma anterior" in m for m in logs)
out["apuntar_lleva_perfil"] = "perfil" in inspect.signature(rg._apuntar_base).parameters

logs.clear()
tmp.write_text(json.dumps({"y_bot/idle/frontal_8":
    {"base_key": "84b8b91255a268db", "perfil": {"keyframes": 8, "play_fps": 2.2}}}))
out["nueva_leida"] = rg._leer_bases()

logs.clear()
tmp.write_text(json.dumps({"y_bot/idle/frontal_8":
    {"base_key": "84b8b91255a268db", "perfil": {"keyframes": 8}}}))
out["media_leida"] = rg._leer_bases()

print(json.dumps(out))
`;

function python(codigo, args = []) {
  const res = execFileSync(VENV, ["-c", codigo, ...args], {
    cwd: repoRoot, encoding: "utf8", env: { ...process.env, PYTHONWARNINGS: "ignore" },
  });
  const linea = res.trim().split("\n").pop();
  return JSON.parse(linea);
}

/** Reescribe UNA clave del perfil de UNA anim en la copia del set. */
function tocarSet(ruta, anim, campo, valor) {
  const set = JSON.parse(readFileSync(ruta, "utf8"));
  const a = set.animations.find((x) => x.id === anim);
  if (!a) throw new Error(`el set no trae la anim "${anim}"`);
  const antes = a[campo];
  a[campo] = valor;
  writeFileSync(ruta, `${JSON.stringify(set, null, 2)}\n`);
  return antes;
}

async function main() {
  console.log("¿Cambiar el perfil de repintado pide arte nuevo, o sirve el viejo en silencio?\n");

  if (!existsSync(join(FORGE_DIR, "bin/sprite-forge.mjs"))) {
    console.log(`ROJO — sprite-forge no está en ${FORGE_DIR}.`);
    console.log("  Clónalo (github.com/alberto-hortelano/sprite-forge) o define NEFAN_SPRITE_FORGE_DIR.");
    return 1;
  }
  if (!existsSync(VENV)) {
    console.log(`ROJO — no hay venv en ${VENV}: el sujeto es el adaptador de Python.`);
    return 1;
  }
  if (!existsSync(join(repoRoot, "assets/characters"))) {
    console.log("ROJO — falta assets/characters: sin hojas base no hay base_key que comparar.");
    return 1;
  }
  if (await puertoOcupado(FORGE_PORT)) {
    console.log(`ROJO — el puerto ${FORGE_PORT} ya está ocupado y este guion necesita SU sprite-forge`);
    console.log("  (uno ajeno tendría otro `--set` y mediría otro fichero). No mato a nadie: párala tú.");
    return 1;
  }
  if (await puertoOcupado(PUERTO_MUERTO)) {
    console.log(`ROJO — el 6 necesita un puerto SIN nadie y :${PUERTO_MUERTO} está ocupado.`);
    return 1;
  }

  // El set se ejerce en una copia, y se afirma que la copia es el fichero vivo.
  const dir = mkdtempSync(join(tmpdir(), "qa-perfil-"));
  const SET = join(dir, "sprite-set.json");
  copyFileSync(SET_VIVO, SET);
  if (readFileSync(SET).equals(readFileSync(SET_VIVO))) {
    ok(`el set que se mide es el VIVO (${SET_VIVO.replace(repoRoot + "/", "")}), copiado byte a byte`);
  } else {
    mal("la copia del set no es idéntica al fichero vivo: lo que se mida no vale");
    return 1;
  }

  // ── sprite-forge SIN worker de repintado: nada puede llamar a un proveedor ──
  const p = spawn("node", ["bin/sprite-forge.mjs", "serve", "--sin-skin",
    "--assets", join(repoRoot, "assets/characters"), "--set", SET, "--port", String(FORGE_PORT)],
  { cwd: FORGE_DIR, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  p.stdout.on("data", (d) => log.push(String(d)));
  p.stderr.on("data", (d) => log.push(String(d)));
  hijos.push(p);
  if (!(await waitPort(FORGE_PORT, 120_000))) {
    console.log(`ROJO — sprite-forge no llegó a escuchar en :${FORGE_PORT}.`);
    console.log(log.join("").trimEnd() || "  (sin una línea de log)");
    return 1;
  }

  // 1 ─ las 16 declaran perfil, y lo declarado es lo efectivo
  const cat = await (await fetch(`${FORGE_URL}/catalog`)).json();
  const efectivo = new Map((cat.animations ?? []).map((a) => [a.id, a]));
  const set = JSON.parse(readFileSync(SET, "utf8"));
  const sinPerfil = set.animations.filter((a) => a.keyframes == null || a.play_fps == null).map((a) => a.id);
  const divergen = set.animations
    .filter((a) => {
      const e = efectivo.get(a.id);
      return !e || e.skin_plan_error || e.keyframes !== a.keyframes || Number(e.play_fps) !== Number(a.play_fps);
    })
    .map((a) => a.id);
  if (sinPerfil.length === 0 && divergen.length === 0) {
    ok(`las ${set.animations.length} anims del set declaran su perfil y el catálogo publica EL MISMO`);
  } else {
    if (sinPerfil.length) {
      mal(`sin perfil declarado (heredan el defecto de OTRO repo, y ese valor entra en una clave de ne-fan): ${sinPerfil.join(", ")}`);
    }
    if (divergen.length) {
      mal(`lo declarado no es lo efectivo (o no se puede repintar): ${divergen.join(", ")}`);
    }
  }

  // 2/3/4 ─ tocar el perfil mueve la clave del vestido y NO la base
  const antes = python(DRIVER, [FORGE_URL, ANIM]);
  if (antes.sin_perfil_en_el_codigo) {
    mal(`EL FALLO DE #375 ESTÁ VIVO: ${antes.sin_perfil_en_el_codigo} — la clave del sheet vestido no depende del perfil de repintado, así que cambiarlo sirve el arte viejo en silencio`);
    return 1;
  }
  if (!antes.vestido) {
    mal(`no se pudo componer la clave con el set intacto: ${JSON.stringify(antes)}`);
    return 1;
  }
  console.log(`\n  · ${ANIM} · perfil ${antes.perfil[0]}kf@${antes.perfil[1]}fps · base ${antes.base_key} · vestido ${antes.vestido}\n`);

  for (const [campo, nuevo] of [["keyframes", antes.perfil[0] + 2], ["play_fps", antes.perfil[1] + 1.5]]) {
    const original = tocarSet(SET, ANIM, campo, nuevo);
    const d = python(DRIVER, [FORGE_URL, ANIM]);
    if (!d.vestido) {
      mal(`${campo}=${nuevo}: no se pudo componer la clave — ${JSON.stringify(d)}`);
    } else if (d.vestido === antes.vestido) {
      mal(`${campo}: ${original} → ${nuevo} NO movió la clave del vestido (${d.vestido}): se serviría el arte del perfil viejo`);
    } else if (d.base_key !== antes.base_key) {
      mal(`${campo}: movió la base_key (${antes.base_key} → ${d.base_key}): repagaría la hoja base, que no depende del perfil`);
    } else {
      ok(`${campo}: ${original} → ${nuevo} mueve la clave del vestido (${d.vestido}) y deja la base_key intacta`);
    }
    tocarSet(SET, ANIM, campo, original);
    const vuelta = python(DRIVER, [FORGE_URL, ANIM]);
    if (vuelta.vestido === antes.vestido) ok(`  y revertir ${campo} devuelve la clave original: sin repago espurio`);
    else mal(`revertir ${campo} NO devolvió la clave original (${vuelta.vestido} ≠ ${antes.vestido})`);
  }

  // 5 ─ el formato del número no repaga
  const orig = tocarSet(SET, ANIM, "play_fps", Number(antes.perfil[1]));
  const comoEntero = tocarSet(SET, ANIM, "keyframes", Number(antes.perfil[0]));
  void orig; void comoEntero;
  const reescrito = python(DRIVER, [FORGE_URL, ANIM]);
  if (reescrito.vestido === antes.vestido) {
    ok("reescribir el mismo perfil con otro formato de número NO mueve la clave");
  } else {
    mal(`reescribir el mismo perfil movió la clave (${reescrito.vestido} ≠ ${antes.vestido}): se repagaría por el formato del JSON`);
  }

  // 6 ─ el servicio caído sube como 503 (degradable), y el índice viejo no se finge
  const caido = python(DRIVER, [`http://127.0.0.1:${PUERTO_MUERTO}`, ANIM]);
  if (caido.sheets_status === 503) {
    ok("con el servicio caído el error sube como 503 — el código del que el endpoint sabe degradar");
  } else {
    mal(`con el servicio caído esperaba 503 (degradable) y salió ${JSON.stringify(caido)}: el arte ya pagado dejaría de servirse`);
  }
  const idx = python(DRIVER_INDICE);
  if (Object.keys(idx.vieja_leida).length === 0 && idx.vieja_dicha) {
    ok("el índice en la forma ANTERIOR a #375 se trata como ausente y se DICE (no se le adivina el perfil)");
  } else {
    mal(`el índice viejo no se trató como ausente o no se dijo: ${JSON.stringify(idx.vieja_leida)} / dicho=${idx.vieja_dicha}`);
  }
  if (Object.keys(idx.media_leida).length === 0) ok("una entrada a MEDIAS tampoco se parsea: media entrada no es media clave");
  else mal(`una entrada sin play_fps se aceptó: ${JSON.stringify(idx.media_leida)}`);
  if (idx.nueva_leida["y_bot/idle/frontal_8"]?.perfil?.play_fps === 2.2 && idx.apuntar_lleva_perfil) {
    ok("y el índice en la forma VIVA guarda y devuelve base_key Y perfil");
  } else {
    mal(`el índice no lleva el perfil (leído=${JSON.stringify(idx.nueva_leida)}, _apuntar_base lo recibe=${idx.apuntar_lleva_perfil}): con el servicio caído se serviría una clave adivinada`);
  }

  if (!KEEP) rmSync(dir, { recursive: true, force: true });
  console.log("");
  if (fallos.length) {
    console.log(`ROJO — ${fallos.length} comprobación(es) fallaron.`);
    return 1;
  }
  console.log("VERDE — el perfil entra en la clave del vestido, no en la base, y no repaga por el formato.");
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.log(`ROJO — ${e.stack ?? e.message}`);
} finally {
  if (!KEEP) for (const h of hijos) if (h.exitCode === null) h.kill("SIGKILL");
}
process.exit(code);
