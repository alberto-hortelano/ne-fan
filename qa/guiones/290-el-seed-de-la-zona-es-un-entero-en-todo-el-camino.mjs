/** El `seed` de una zona del tile es un ENTERO en todo el camino (tanda BP).
 *
 *  Petición: que el `seed` de `vegetation_zones` deje de costar un rechazo al
 *  motor (4 de 4 motores lo escribían como número, igual que el
 *  `scatter_zones[].seed` de al lado), sin sanear en silencio. La salida
 *  elegida: los dos `seed?` del tile comparten UNA definición entera 0..1e9
 *  (`nefan-core/src/scene/blueprint/zone-seed.ts`).
 *
 *  Qué NO repite este guion (ya candado en `npm test`): que el zod acepte y
 *  rechace (`test/derive-vegetation.test.ts`, `test/scatter.test.ts`), que la
 *  prosa diga el tipo (`test/contract-prompts.test.ts`) y el golden de
 *  `deriveVolumesFromSchema` sobre un tile sintético.
 *
 *  Qué SÍ mira, sobre el tile que sirve el MOTOR FALSO del banco
 *  (`labs/narrative/fake-scenes.ts` → `bootstrapTile()`, pinar + scatter) y
 *  por las TRES puertas que el tile cruza en producción:
 *
 *   1. PRE-FLIGHT (lo que narrative-mcp le contesta al motor:
 *      `validateContract(EmittedSceneSchema)`, lo mismo que
 *      `validateFormatDScene`): 0, 3 y 1e9 pasan en las dos zonas; "3",
 *      "claro_sur", 1.5, -1 y 1e10 vuelven con la RUTA del campo y la palabra
 *      «entero» — el motor tiene que poder corregir sin adivinar.
 *   2. BRIDGE (`validateScene`, la red de `handlers/tile.ts` y la tool
 *      `scene_validate`): mismos veredictos. Un tile con seed entero es
 *      jugable.
 *   3. LO QUE SE PINTA (`formatDToWorld` del bridge → `__plan` →
 *      `buildFpsTileSpec` del cliente): con seed entero el bosque SE PLANTA
 *      (antes del cambio el mismo tile salía con 0 árboles y un aviso), es
 *      determinista (dos normalizaciones = mismos bytes), el seed MANDA (3≠4,
 *      en vegetación y en scatter), y seed 0 ≠ sin seed en vegetación (un
 *      `||` lo colapsaría).
 *   4. SIN SEED NO CAMBIA: los ejemplares derivados del pinar del bootstrap
 *      (id, at, s) tienen el MISMO hash que con el código de ANTES del cambio
 *      (`8b726a58`, medido el 2026-09-29 por la QA de la tanda). Si algo ajeno
 *      mueve el pinar a propósito, se recaptura aquí diciendo por qué.
 *   5. ai_server (vía de API directa) conserva el seed entero tal cual: si lo
 *      tirara o lo convirtiera, la misma zona se plantaría distinto según la
 *      vía por la que llegó.
 *
 *  AGUJERO CONOCIDO (sale verde HOY, y se pone ROJO el día que se cierre, para
 *  que alguien lo suba a los asertos): ai_server NO mira `seed`, así que por la
 *  vía de API directa un `seed: "3"` pasa el saneador laxo y lo rechaza después
 *  `validateScene` en el bridge («El tile no es jugable») — se pierde el TILE
 *  entero, cuando la regla de los bloques declarativos
 *  (`narrative_schemas.py`, «LA REGLA DE LOS BLOQUES DECLARATIVOS») es
 *  descartar el bloque y salvar el tile. Preexistente (antes le pasaba al
 *  seed NUMÉRICO, que es el que escriben los motores); lo documenta el
 *  `qa.md` de la tanda BP.
 *
 *  EN NEGATIVO (2026-09-29, cada rotura a mano y revertida con `git checkout`):
 *   · `vegetation.ts` otra vez con `seed: z.string().min(1).max(64)` ⇒ rojos
 *     cinco asertos: acepta el entero, rechaza lo demás, SE PLANTA (0
 *     ejemplares), el seed MANDA y el del agujero (el bridge ya no tira el
 *     tile con seed "3");
 *   · `derive.ts` con `fnv1a(zone.seed ? String(zone.seed) : zone.type)` ⇒
 *     rojo «seed 0 ≠ sin seed»;
 *   · `derive.ts` con `fnv1a(String(zone.seed))` ⇒ rojo en el golden (4);
 *   · `scatter.ts` sin la comprobación del seed (`if (false) fail(`) ⇒ rojos
 *     «rechaza lo demás» (sStr/sFrac/sNeg/s1e10 pasan las dos puertas) y
 *     «scatterError con la ruta» (null).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "ejerce los validadores y la normalización en subprocesos (tsx + python3); no abre partida ni habla con el motor";
export const sinNavegador = "normaliza y construye la spec fps del tile en un subproceso y compara hashes; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");

/** Hash de los ejemplares derivados del pinar del bootstrap SIN seed, medido
 *  con el código de antes del cambio (8b726a58) y con el de después: iguales. */
const GOLDEN_VEG_SIN_SEED = "be301a2dd7ae2978";

const TS = `
import { createHash } from "node:crypto";
import { bootstrapTile } from ${JSON.stringify(join(RAIZ, "labs/narrative/fake-scenes.ts"))};
import { formatDToWorld } from ${JSON.stringify(join(CORE, "src/scene/scene-normalize.ts"))};
import { buildFpsTileSpec } from ${JSON.stringify(join(CORE, "src/scene/blueprint/fps-spec.ts"))};
import { validateContract } from ${JSON.stringify(join(CORE, "src/contract/model-io/validate.ts"))};
import { EmittedSceneSchema } from ${JSON.stringify(join(CORE, "src/contract/model-io/scene-schema.ts"))};
import { validateScene } from ${JSON.stringify(join(CORE, "src/scene/scene-validate.ts"))};
import { writeFileSync } from "node:fs";
const h = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
const base = bootstrapTile();
const con = (veg, scat) => {
  const t = structuredClone(base);
  if (veg !== undefined) t.vegetation_zones = t.vegetation_zones.map((z) => ({ ...z, seed: veg }));
  if (scat !== undefined) t.scatter_zones = t.scatter_zones.map((z, i) => ({ ...z, seed: scat[i] }));
  return t;
};
const casos = {
  base: base,
  v0: con(0), v3: con(3), v4: con(4), v1e9: con(1e9),
  s0: con(undefined, [0, 0]), s34: con(undefined, [3, 4]), s56: con(undefined, [5, 6]), s1e9: con(undefined, [1e9, 1e9]),
  vStr: con("3"), vTexto: con("claro_sur"), vFrac: con(1.5), vNeg: con(-1), v1e10: con(1e10),
  sStr: con(undefined, ["3", 4]), sFrac: con(undefined, [1.5, 4]), sNeg: con(undefined, [-1, 4]), s1e10: con(undefined, [1e10, 4]),
};
const spec = (p) => buildFpsTileSpec({ ground: p.ground, volumes: p.volumes, biome: p.biome,
  scatter_generators: p.scatter_generators, scatter_zones: p.scatter_zones, scene_description: p.scene_description }, "0,0");
const out = {};
for (const [n, raw] of Object.entries(casos)) {
  const pre = validateContract(EmittedSceneSchema, structuredClone(raw));
  const vs = validateScene(structuredClone(raw), { required_crossings: [], bootstrap: true });
  const w1 = formatDToWorld(structuredClone(raw));
  const w2 = formatDToWorld(structuredClone(raw));
  const veg = (w1.__plan?.volumes ?? []).filter((v) => String(v.id).startsWith("derived_veg")).map((v) => [v.id, v.at, v.s]);
  const f1 = w1.__plan ? spec(w1.__plan) : null;
  const f2 = w2.__plan ? spec(w2.__plan) : null;
  out[n] = {
    pre: pre.ok ? "ok" : pre.error,
    bridge: vs.ok ? "ok" : vs.errors.join(" · "),
    avisos: w1.__plan_warnings ?? [],
    vegN: veg.length, veg: h(veg),
    mundoIgual: h(w1) === h(w2),
    prims: f1 ? h(f1.primsM) : null, primsIgual: f1 && f2 ? h(f1.primsM) === h(f2.primsM) : false,
    scatterError: f1?.scatterError ?? null,
  };
}
writeFileSync(process.argv[2], JSON.stringify({ out, casos }));
`;

const PY = `
import json, sys, io, contextlib, copy
sys.path.insert(0, sys.argv[2])
from ai_server.narrative_schemas import validate_scene_response
casos = json.load(open(sys.argv[1]))["casos"]
out = {}
for n in ["v3", "v0", "s34", "vStr", "sStr"]:
    with contextlib.redirect_stdout(io.StringIO()):
        r = validate_scene_response(copy.deepcopy(casos[n]))
    out[n] = {"veg": [z.get("seed") for z in r.get("vegetation_zones") or []],
              "scat": [z.get("seed") for z in r.get("scatter_zones") or []]}
print("<<<" + json.dumps(out) + ">>>")
`;

export default async function (ctx) {
  const dir = mkdtempSync(join(tmpdir(), "nefan-qa-290-"));
  try {
    const tsPath = join(dir, "mide.mts");
    const pyPath = join(dir, "py.py");
    const resPath = join(dir, "res.json");
    writeFileSync(tsPath, TS);
    writeFileSync(pyPath, PY);
    const rTs = spawnSync("npx", ["tsx", tsPath, resPath], { cwd: CORE, encoding: "utf8", timeout: 180000 });
    if (rTs.status !== 0) throw new Error(`el subproceso tsx falló (${rTs.status}):\n${(rTs.stderr ?? "").slice(0, 1500)}`);
    const { readFileSync } = await import("node:fs");
    const { out: r } = JSON.parse(readFileSync(resPath, "utf8"));
    const rPy = spawnSync("python3", [pyPath, resPath, RAIZ], { cwd: RAIZ, encoding: "utf8", timeout: 180000 });
    const m = /<<<([\s\S]*?)>>>/.exec(`${rPy.stdout ?? ""}`);
    if (!m) throw new Error(`python3 no devolvió nada:\n${(rPy.stderr ?? "").slice(0, 1500)}`);
    const py = JSON.parse(m[1]);
    for (const [n, v] of Object.entries(r)) ctx.log(`  ${n}: pre=${v.pre === "ok" ? "ok" : "RECHAZA"} bridge=${v.bridge === "ok" ? "ok" : "RECHAZA"} vegN=${v.vegN} veg=${v.veg} prims=${v.prims}`);
    ctx.log(`  ai_server: ${JSON.stringify(py)}`);

    // ── 1 y 2 · las puertas aceptan el entero y rechazan lo demás diciendo QUÉ ──
    const buenos = ["base", "v0", "v3", "v4", "v1e9", "s0", "s34", "s56", "s1e9"];
    const noPasan = buenos.filter((n) => r[n].pre !== "ok" || r[n].bridge !== "ok");
    ctx.expect(
      "pre-flight y bridge aceptan un seed ENTERO (0, 3, 4, 1e9) en vegetation_zones y en scatter_zones",
      noPasan.length === 0,
      noPasan.map((n) => `${n}: pre=${r[n].pre} · bridge=${r[n].bridge}`).join(" | "),
    );
    const malos = { vStr: "vegetation_zones[0].seed", vTexto: "vegetation_zones[0].seed", vFrac: "vegetation_zones[0].seed", vNeg: "vegetation_zones[0].seed", v1e10: "vegetation_zones[0].seed",
      sStr: "scatter_zones[0].seed", sFrac: "scatter_zones[0].seed", sNeg: "scatter_zones[0].seed", s1e10: "scatter_zones[0].seed" };
    const malDichos = Object.entries(malos).filter(([n, ruta]) => {
      const dice = (s) => s !== "ok" && s.includes(ruta) && /entero/.test(s);
      return !(dice(r[n].pre) && dice(r[n].bridge));
    });
    ctx.expect(
      "lo que no es un entero 0..1e9 vuelve RECHAZADO por las dos puertas, con la ruta del campo y la palabra «entero»",
      malDichos.length === 0,
      malDichos.map(([n]) => `${n}: pre=${r[n].pre} · bridge=${r[n].bridge}`).join(" | "),
    );

    // ── 3 · lo que se pinta ──────────────────────────────────────────────
    ctx.expect(
      "con seed entero el pinar SE PLANTA (antes del cambio: 0 ejemplares y un aviso)",
      ["v0", "v3", "v4", "v1e9"].every((n) => r[n].vegN > 0 && r[n].avisos.length === 0),
      ["v0", "v3", "v4", "v1e9"].map((n) => `${n}: ${r[n].vegN} ejemplares, avisos=${JSON.stringify(r[n].avisos)}`).join(" | "),
    );
    const noDeterministas = Object.entries(r).filter(([, v]) => !v.mundoIgual || !v.primsIgual).map(([n]) => n);
    ctx.expect(
      "determinista: dos normalizaciones del mismo tile dan la misma world scene y la misma spec fps",
      noDeterministas.length === 0,
      noDeterministas.join(", "),
    );
    ctx.expect("el seed de vegetación MANDA: 3 y 4 plantan distinto", r.v3.veg !== r.v4.veg, `${r.v3.veg} vs ${r.v4.veg}`);
    ctx.expect("seed 0 no es «sin seed» en vegetación", r.v0.veg !== r.base.veg, `${r.v0.veg} vs ${r.base.veg}`);
    ctx.expect(
      "el seed de scatter MANDA: [3,4] y [5,6] pintan distinto, y ninguno rompe el scatter",
      r.s34.prims !== r.s56.prims && r.s34.scatterError === null && r.s56.scatterError === null && r.s1e9.scatterError === null,
      `${r.s34.prims} vs ${r.s56.prims} · errores: ${r.s34.scatterError} / ${r.s56.scatterError} / ${r.s1e9.scatterError}`,
    );
    ctx.expect(
      "un seed de scatter inválido no se pinta a medias: el cliente recibe scatterError con la ruta",
      typeof r.sStr.scatterError === "string" && r.sStr.scatterError.includes("scatter_zones[0].seed"),
      String(r.sStr.scatterError),
    );

    // ── 4 · sin seed no cambia ───────────────────────────────────────────
    ctx.expect(
      "el pinar del bootstrap SIN seed es el mismo que antes del cambio (hash de id/at/s de sus ejemplares)",
      r.base.veg === GOLDEN_VEG_SIN_SEED && r.base.vegN > 0,
      `hoy ${r.base.veg} (${r.base.vegN} ejemplares) · antes ${GOLDEN_VEG_SIN_SEED}`,
    );

    // ── 5 · ai_server conserva el entero ─────────────────────────────────
    ctx.expect(
      "ai_server (API directa) conserva el seed entero tal cual, en las dos zonas",
      JSON.stringify(py.v3.veg) === "[3]" && JSON.stringify(py.v0.veg) === "[0]" && JSON.stringify(py.s34.scat) === "[3,4]",
      JSON.stringify(py),
    );

    // ── AGUJERO CONOCIDO: ai_server no descarta el seed malo ─────────────
    const agujeroSigue = JSON.stringify(py.vStr.veg) === '["3"]' && JSON.stringify(py.sStr.scat) === '["3",4]' && r.vStr.bridge !== "ok";
    ctx.expect(
      "AGUJERO CONOCIDO sigue abierto (ai_server deja pasar seed:\"3\" y el bridge tira el tile); si se cierra, subirlo a los asertos",
      agujeroSigue,
      `ai_server: ${JSON.stringify(py.vStr)} / ${JSON.stringify(py.sStr)} · bridge: ${r.vStr.bridge}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
