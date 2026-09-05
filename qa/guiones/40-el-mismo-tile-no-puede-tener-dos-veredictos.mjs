/** El MISMO tile no puede tener dos veredictos según por dónde entre (#237).
 *
 *  QUÉ COMPARA. Los dos gates que ven una escena Format D recién salida del
 *  modelo, cada uno en su proceso:
 *
 *   · `EmittedSceneSchema` (nefan-core, zod) — el pre-flight de narrative-mcp.
 *     Su error VUELVE al modelo para que re-responda.
 *   · `validate_scene_response` (ai_server) — la vía de API directa, que NO
 *     tiene pre-flight delante.
 *
 *  ── EL CRITERIO, REDIBUJADO CON LA MEDIDA DELANTE ────────────────────────
 *
 *  Este guion nació (QA, 2026-08-29) exigiendo veredicto IDÉNTICO en todo, y
 *  con esa regla salía rojo por tres casos de `scatter`. Al ampliar la rejilla
 *  a los otros bloques declarativos, la regla se cae sola:
 *
 *      ground kind desconocido        zod=RECHAZA · ai_server=ACEPTA
 *      ground material desconocido    zod=RECHAZA · ai_server=ACEPTA
 *      ground no es lista             zod=RECHAZA · ai_server=ACEPTA
 *      volumes type desconocido       zod=RECHAZA · ai_server=ACEPTA
 *      volumes tower sin at           zod=RECHAZA · ai_server=ACEPTA
 *      vegetation density brutal      zod=RECHAZA · ai_server=ACEPTA
 *      scatter (los tres casos)       zod=RECHAZA · ai_server=ACEPTA
 *
 *  Los SEIS bloques declarativos se comportan igual, y la asimetría está
 *  ESCRITA en el código desde antes de la tanda — `narrative_schemas.py:224`:
 *  «Espejo laxo de parseGround …; el rechazo duro por-array lo hace el
 *  preflight zod del MCP». Es deliberada y tiene un motivo de jugador: por la
 *  vía MCP el zod rebota y el modelo RE-RESPONDE (barato, y el tile sale
 *  mejor); por la vía de API directa no hay re-respuesta, así que ai_server
 *  descarta el bloque malo con traza y SALVA el tile — perder un macizo de
 *  pinos es mucho menos malo que perder el tile entero.
 *
 *  Así que la igualdad estricta no es el invariante: es una regla más fuerte
 *  que la que el sistema quiere cumplir, y aplicarla habría hecho que
 *  `scatter` fuera el único de seis que tumba el tile. Lo que este guion
 *  exige, y que sí es el invariante que cuesta:
 *
 *   1. **Los CAMPOS de forma dan el mismo veredicto, exacto.** `size`,
 *      `terrain`, `biome`, `description`, las claves de una entity, `role`…
 *      Es el eje de #237: aquí un desacuerdo pierde el tile o lo cuela.
 *   2. **ai_server NUNCA es más estricto que el zod.** Esa es la dirección
 *      que cuesta: si ai_server rechaza lo que el pre-flight aceptó, no hay
 *      re-respuesta — `llm_client` devuelve None, el tile se pierde y el
 *      jugador ve `narrative_status: error`. La contraria degrada.
 *   3. **Los seis bloques declarativos se comportan IGUAL ENTRE SÍ.** Es lo
 *      que impide que `scatter` (o cualquiera) se separe de sus hermanos por
 *      un lado o por el otro sin que nadie se entere — que es exactamente lo
 *      que la tanda #203 estuvo a punto de hacer.
 *
 *  POR QUÉ NO BASTA `data/contract/fixtures/scene/`. Ese set corre en los dos
 *  procesos y exige el MISMO veredicto, así que solo puede contener casos del
 *  eje 1. Los bloques declarativos no caben ahí por construcción, y por eso
 *  hace falta este guion: sin él, la regla 3 no la vigila nadie.
 *
 *  CÓMO. Los mismos payloads a los dos gates, en subprocesos: `tsx` contra la
 *  FUENTE de nefan-core (no el `dist/`, que puede ir viejo — el set de
 *  fixtures llega al schema por `@nefan/core` compilado y por eso no se entera
 *  de un cambio sin rebuild) y `python3` contra `ai_server` (no hace falta el
 *  `.venv`: `narrative_schemas` es stdlib pura). Sin navegador y sin motor.
 *
 *  Probado en negativo, los tres ejes uno a uno (2026-08-29):
 *   · eje 1 — devolver `data.pop("size")` mudo a ai_server ⇒ rojo:
 *     «tile con size: zod=RECHAZA · ai_server=ACEPTA».
 *   · eje 2 — hacer que ai_server rechace un `terrain: []` que el zod acepta
 *     ⇒ rojo por los dos ejes 1 y 2 a la vez, que es lo correcto: ese caso es
 *     un campo Y es la dirección cara.
 *   · eje 3 — quitar la llamada a `refineScatter` del `superRefine` del zod
 *     ⇒ rojo: «scatter: zod=ACEPTA/py=ACEPTA», fuera de línea. Y el simétrico:
 *     hacer que ai_server LANCE ante scatter malo ⇒ rojo también,
 *     «scatter: zod=RECHAZA/py=RECHAZA». El eje 3 es el único que caza LAS DOS
 *     formas de separar un bloque de sus hermanos, y por eso existe.
 *
 *  OJO con el lever del eje 3: quitar `scatter_generators`/`scatter_zones` del
 *  `sceneBaseShape` NO pone esto rojo — el refinamiento sigue corriendo porque
 *  la escena es `.passthrough()` y los valores llegan igual. Lo que rompe esa
 *  otra cosa es el guardia de campos JSON→zod de `contract-prompts.test.ts`,
 *  que es quien vigila la DECLARACIÓN. Dos candados, dos sujetos.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** La EXCEPCIÓN del guardarraíl de gasto: este guion no abre el juego — lanza
 *  dos subprocesos que parsean JSON en memoria. */
export const sinMotor = "compara dos validadores en subprocesos (tsx + python3); no abre partida ni habla con el motor";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");

/** Un tile mínimo y VÁLIDO para los dos. Cada caso lo perturba en un solo eje,
 *  para que la respuesta signifique algo. */
const base = {
  scene_id: "tile_0_0",
  scene_description: "Una plaza de tierra batida entre casas encaladas.",
  tile: { tx: 0, ty: 0 },
  biome: "dirt",
  entities: [{ id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1] }],
};
const npc = (extra) => ({ id: "roric", kind: "npc", name: "Guardia Roric", cell: [60, 60], footprint: [1, 1], ...extra });
const conNpc = (extra) => ({ ...base, entities: [...base.entities, npc(extra)] });

/** [nombre, payload, eje, por qué está en la rejilla]
 *
 *  `eje` es "campo" (forma de la escena o de una entity: los dos gates tienen
 *  que dar el MISMO veredicto) o el id del BLOQUE DECLARATIVO que perturba
 *  (`ground`, `volumes`, `vegetation_zones`, `scatter`: zod duro, ai_server
 *  laxo — y los cuatro tienen que comportarse igual entre sí). El eje
 *  "campo-pendiente" (campos que divergían con issue pendiente) nació y murió
 *  en la QA de PR-A de T7: `h` y `name` se alinearon en la misma vuelta y no
 *  quedó ninguno — una lista vacía no canda nada. */
// Generador VÁLIDO de verdad, comprobado contra `parseScatter`: un `cylinder`
// exige `rTop`, y la primera versión de este control usaba `r` — el guion se
// puso rojo y tenía razón (el dato de prueba estaba mal, no el código).
const gen = { pino: { parts: [{ shape: "sphere", r: 0.8, pos: [0, 1, 0] }] } };
const zona = (extra) => ({ kind: "pino", shape: { type: "rect", x0: 2, z0: 2, x1: 10, z1: 10 }, density: 0.05, ...extra });
const vz = (extra) => ({ id: "vz", kind: "tree", shape: { type: "rect", x0: 1, z0: 1, x1: 9, z1: 9 }, density: 0.02, ...extra });

const CASOS = [
  // ── control ─────────────────────────────────────────────────────────────
  ["tile limpio", base, "campo", "control: si esto divergiera, el arnés estaría midiendo otra cosa"],
  ["tile con scatter real", { ...base, scatter_generators: gen, scatter_zones: [zona()] }, "campo", "control del otro lado: un scatter BUENO lo aceptan los dos"],

  // ── eje 1 · CAMPOS: veredicto idéntico, y es el eje de #237 ─────────────
  ["entity con clave desconocida", conNpc({ health: 60 }), "campo", "#259, y tiene fixture"],
  ["entity description vacía", conNpc({ description: "" }), "campo", "#237, entrada 2 de la tabla"],
  ["entity description en blanco", conNpc({ description: "   " }), "campo", "la divergencia residual que cerró la tanda"],
  ["tile con size", { ...base, size: { cols: 128, rows: 128, meters_per_cell: 0.5 } }, "campo", "#237, entrada 1"],
  ["tile con grid terrain", { ...base, terrain: ["ddd", "ddd"] }, "campo", "#237, la tercera de la misma línea"],
  ["tile con terrain vacío", { ...base, terrain: [] }, "campo", "el borde tolerado: los dos podan sin quejarse"],
  ["entity kind fuera del enum", conNpc({ kind: "creature" }), "campo", "vocabulario compartido"],
  ["role inventado", conNpc({ role: "herrero" }), "campo", "el vocabulario que YA candaban las fixtures"],
  ["entity cell no numérica", conNpc({ cell: ["a", 60] }), "campo", "forma de entity que ninguna fixture toca"],
  ["clave desconocida en la raíz", { ...base, nota_del_motor: "sin uso" }, "campo", "#400: la raíz es `.strict()` en el zod y allow-list fail-loud en ai_server"],
  ["entity footprint 0", conNpc({ footprint: [0, 1] }), "campo", "ídem"],
  ["escena sin tile", { ...base, tile: undefined }, "campo", "la variante retirada"],
  ["tile sin biome", (() => { const s = { ...base }; delete s.biome; return s; })(), "campo", "el bioma es la base del tile"],

  // ── eje 3 · BLOQUES DECLARATIVOS: los cuatro, igual entre sí ────────────
  // Sin estos seis casos la rejilla no puede ver que `scatter` se comporta
  // como sus hermanos, y el guion volvería a pedir una igualdad que el
  // sistema no quiere cumplir. Uno por bloque como mínimo.
  ["ground kind desconocido", { ...base, ground: [{ id: "g1", kind: "lava", rect: [1, 1, 4, 4], material: "stone" }] }, "ground", "bloque declarativo: zod duro, ai_server descarta el rasgo"],
  ["ground no es lista", { ...base, ground: "hola" }, "ground", "el campo entero inutilizable"],
  ["volumes type desconocido", { ...base, volumes: [{ id: "v1", type: "zeppelin", at: [5, 5], w: 2, d: 2, h: 3 }] }, "volumes", "bloque declarativo"],
  ["volumes tower sin at", { ...base, volumes: [{ id: "v1", type: "tower", h: 8 }] }, "volumes", "bloque declarativo"],
  ["vegetation density brutal", { ...base, vegetation_zones: [vz({ density: 99 })] }, "vegetation_zones", "bloque declarativo: el tope sale del paso del jugador"],
  ["scatter_zones basura", { ...base, scatter_zones: "hola" }, "scatter", "#203 metió scatter en el zod; tiene que quedar donde sus hermanos"],
  ["scatter zona sin generador", { ...base, scatter_generators: gen, scatter_zones: [zona({ kind: "no_existe" })] }, "scatter", "ídem"],
  ["scatter density negativa", { ...base, scatter_generators: gen, scatter_zones: [zona({ density: -1 })] }, "scatter", "ídem"],
  // ── heredados, alineados en la QA de PR-A de T7 (2026-09-03) ────────────
  // Medidos divergentes en `main` (zod rechaza / ai_server descarta o rellena)
  // y arreglados en la misma vuelta: son CAMPOS y llevan fixture compartida.
  ["entity h negativa", conNpc({ h: -1 }), "campo", "ai_server descartaba `h` en silencio y aceptaba"],
  ["entity h grande", conNpc({ h: 25 }), "campo", "los dos aceptan; ai_server perdía la altura (el recorte a 20 m es de formatDToWorld)"],
  ["entity sin name", conNpc({ name: undefined }), "campo", "ai_server rellenaba `name` con el id y aceptaba"],
];

const TS = `
import { validateContract } from ${JSON.stringify(join(CORE, "src/contract/model-io/validate.js"))};
import { EmittedSceneSchema } from ${JSON.stringify(join(CORE, "src/contract/model-io/scene-schema.js"))};
import { readFileSync } from "node:fs";
const casos = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = {};
for (const [n, p] of Object.entries(casos)) {
  const r = validateContract(EmittedSceneSchema, p);
  out[n] = r.ok ? "ACEPTA" : "RECHAZA";
}
console.log("<<<" + JSON.stringify(out) + ">>>");
`;

const PY = `
import json, sys, io, contextlib, copy
sys.path.insert(0, sys.argv[2])
from ai_server.narrative_schemas import validate_scene_response
casos = json.load(open(sys.argv[1]))
out = {}
for n, p in casos.items():
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            validate_scene_response(copy.deepcopy(p))
        out[n] = "ACEPTA"
    except Exception:
        out[n] = "RECHAZA"
print("<<<" + json.dumps(out) + ">>>")
`;

function veredictos(salida, quien) {
  const m = /<<<([\s\S]*?)>>>/.exec(salida);
  if (!m) throw new Error(`${quien} no devolvió veredictos:\n${salida.slice(0, 800)}`);
  return JSON.parse(m[1]);
}

export default async function (ctx) {
  const dir = mkdtempSync(join(tmpdir(), "nefan-qa-contrato-"));
  const casosPath = join(dir, "casos.json");
  const tsPath = join(dir, "zod.mts");
  const pyPath = join(dir, "py.py");
  writeFileSync(casosPath, JSON.stringify(Object.fromEntries(CASOS.map(([n, p]) => [n, p]))));
  writeFileSync(tsPath, TS);
  writeFileSync(pyPath, PY);

  const rTs = spawnSync("npx", ["tsx", tsPath, casosPath], { cwd: CORE, encoding: "utf8", timeout: 180000 });
  const rPy = spawnSync("python3", [pyPath, casosPath, RAIZ], { cwd: RAIZ, encoding: "utf8", timeout: 180000 });
  const zod = veredictos(`${rTs.stdout ?? ""}${rTs.stderr ?? ""}`, "el gate zod (tsx)");
  const py = veredictos(`${rPy.stdout ?? ""}${rPy.stderr ?? ""}`, "el saneador de ai_server (python3)");

  const divergentes = [];
  const coinciden = [];
  for (const [n, , eje, porque] of CASOS) {
    const linea = `${n} [${eje}]: zod=${zod[n]} · ai_server=${py[n]}`;
    if (zod[n] === py[n]) coinciden.push(linea);
    else divergentes.push({ n, eje, porque, linea });
  }
  for (const l of coinciden) ctx.log(`  = ${l}`);
  for (const d of divergentes) ctx.log(`  ~ ${d.linea}  — ${d.porque}`);

  // ── Guardarraíl: si los dos gates no distinguen nada, las comparaciones de
  // abajo serían verdes sin haber mirado. Se exige que la rejilla contenga
  // rechazos por los DOS lados y aceptaciones por los dos.
  const hayRechazo = Object.values(zod).includes("RECHAZA") && Object.values(py).includes("RECHAZA");
  const hayAcepta = Object.values(zod).includes("ACEPTA") && Object.values(py).includes("ACEPTA");
  ctx.expect(
    "la rejilla ejerce de verdad los dos gates (hay aceptaciones Y rechazos en ambos)",
    hayRechazo && hayAcepta && CASOS.length >= 20,
    `casos=${CASOS.length} · zod=${JSON.stringify(zod).length}B · py=${JSON.stringify(py).length}B`,
  );
  ctx.expect(
    "y hay casos donde los dos ya coinciden (si no, no habría nada que comparar)",
    coinciden.length >= 8,
    `${coinciden.length} coinciden de ${CASOS.length}`,
  );

  // ── EJE 1 · los CAMPOS de forma, veredicto idéntico ──────────────────────
  // Es el eje de #237, el único donde un desacuerdo pierde el tile o lo cuela.
  const camposDistintos = divergentes.filter((d) => d.eje === "campo");
  ctx.expect(
    "ningún CAMPO de forma recibe dos veredictos distintos según el proceso que lo mire",
    camposDistintos.length === 0,
    camposDistintos.map((d) => d.linea).join(" · "),
  );

  // ── EJE 2 · ai_server nunca más estricto que el zod ──────────────────────
  // La dirección que CUESTA: tras el pre-flight ya no hay re-respuesta, así
  // que un rechazo aquí no vuelve al modelo — se pierde el tile y el jugador
  // ve `narrative_status: error`. La contraria degrada (se cae el bloque).
  const pyMasEstricto = CASOS
    .filter(([n]) => py[n] === "RECHAZA" && zod[n] === "ACEPTA")
    .map(([n, , eje]) => `${n} [${eje}]`);
  ctx.expect(
    "ai_server nunca RECHAZA lo que el zod ACEPTA (eso pierde el tile sin re-respuesta)",
    pyMasEstricto.length === 0,
    pyMasEstricto.join(" · "),
  );

  // ── EJE 3 · los bloques declarativos, iguales entre sí ───────────────────
  // `ground`, `volumes`, `vegetation_zones` y `scatter` son el mismo tipo de
  // cosa y tienen la misma regla escrita (narrative_schemas.py:224). Este es
  // el candado que impide que uno se separe de los otros por cualquiera de
  // los dos lados sin que nadie se entere.
  const BLOQUES = ["ground", "volumes", "vegetation_zones", "scatter"];
  const conducta = new Map();
  for (const [n, , eje] of CASOS) {
    if (!BLOQUES.includes(eje)) continue;
    const c = `zod=${zod[n]}/py=${py[n]}`;
    if (!conducta.has(eje)) conducta.set(eje, new Set());
    conducta.get(eje).add(c);
  }
  const resumen = [...conducta].map(([b, cs]) => `${b}=${[...cs].join(",")}`);
  ctx.log(`  · conducta por bloque declarativo: ${resumen.join(" · ")}`);
  const esperada = "zod=RECHAZA/py=ACEPTA";
  const fueraDeLinea = [...conducta]
    .filter(([, cs]) => cs.size !== 1 || !cs.has(esperada))
    .map(([b, cs]) => `${b}: ${[...cs].join(",")}`);
  ctx.expect(
    `los ${BLOQUES.length} bloques declarativos se comportan IGUAL entre sí (${esperada})`,
    conducta.size === BLOQUES.length && fueraDeLinea.length === 0,
    `medidos ${conducta.size} de ${BLOQUES.length}${fueraDeLinea.length ? ` · fuera de línea: ${fueraDeLinea.join(" · ")}` : ""}`,
  );
}
