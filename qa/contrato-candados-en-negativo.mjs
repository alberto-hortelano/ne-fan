#!/usr/bin/env node
/** ¿Se pueden poner ROJOS los candados del contrato de escena y sus espejos?
 *
 *  Hermano de `qa/mutacion-candados-en-negativo.mjs`, y vive fuera de
 *  `qa/guiones/` por la misma razón: `qa/run.mjs` carga TODO `.mjs` de esa
 *  carpeta y lo conduce contra un navegador con el preset `e2e-sin-creditos`
 *  levantado. Aquí no hay nada que un jugador pueda mirar —son schemas,
 *  saneadores y prompts—, así que un fichero en `guiones/` levantaría el stack
 *  entero para no pulsar una tecla.
 *
 *  POR QUÉ EXISTE. La tanda #203/#237/#259 es casi toda candados nuevos, y el
 *  usuario puso el listón en una frase: **«nacen rojos»**. Un candado que se
 *  instala ya verde no cierra nada, y en las dos tandas anteriores se colaron
 *  seis criterios así. El informe del ingeniero dice haber visto los tres en
 *  rojo antes de cerrarlos; esto lo vuelve a demostrar, y lo vuelve a
 *  demostrar cada vez que alguien lo ejecute — que es la diferencia entre una
 *  prueba y una afirmación.
 *
 *  Cómo funciona: por cada invariante, escribe el fuente ROTO a propósito
 *  (revirtiendo el arreglo de la tanda), corre SU batería y exige que FALLE.
 *  Restaura siempre, y al terminar verifica byte a byte que los tres ficheros
 *  volvieron a estar como estaban. Es barato: la batería más lenta es
 *  `contract-prompts` (~1,5 s, recorre 315 ficheros de corpus).
 *
 *  Toca tres procesos, así que la batería de cada invariante se declara con
 *  él: `ts:<fichero>` corre `node --import tsx --test` en nefan-core;
 *  `py:<módulo>` corre `python3 -m unittest` en la raíz (no hace falta el
 *  `.venv`: `narrative_schemas` es stdlib pura).
 *
 *      node qa/contrato-candados-en-negativo.mjs
 *      node qa/contrato-candados-en-negativo.mjs python   # solo los que casen
 *
 *  Verde = todos los candados listados se ponen rojos al romperlos.
 *  Rojo   = hay un candado que no comprueba lo que dice comprobar; el nombre
 *           del invariante dice exactamente cuál.
 *
 *  AVISO: escribe en el árbol de trabajo. Se niega a arrancar si los ficheros
 *  que va a tocar ya vienen sucios, porque entonces no puede devolverlos.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");

const SCHEMA = join(CORE, "src/contract/model-io/scene-schema.ts");
const PROMPT = join(CORE, "data/contract/prompts/ui_systems.md");
const SNAP = join(CORE, "src/games/world-snapshot.ts");
const PY = join(raiz, "ai_server/narrative_schemas.py");

/** [nombre, fichero, batería, [ [buscar, poner], … ] ]
 *
 *  Cada entrada revierte UN arreglo de la tanda. `buscar` tiene que aparecer
 *  exactamente una vez: si el código se mueve, el candado deja de apuntar a
 *  donde cree y esto lo dice en vez de dar un falso verde. */
const INVARIANTES = [
  // ── #203 · el guardia de campos JSON→zod ────────────────────────────────
  [
    "campos · el zod pierde `scatter_*` y el tool se lo sigue ofreciendo al modelo",
    SCHEMA, "ts:test/contract-prompts.test.ts",
    [["  scatter_generators: z.unknown().optional(),\n  scatter_zones: z.unknown().optional(),\n", ""]],
  ],
  [
    "campos · el zod pierde `attach` y el tool se lo sigue ofreciendo al modelo",
    SCHEMA, "ts:test/contract-prompts.test.ts",
    [['    attach: z.literal("wall").optional(),\n', ""]],
  ],
  // ── #203 · el guardia DÉBIL de términos prometidos ──────────────────────
  [
    "guardia débil · el prompt vuelve a prometer `player_choice`, que no existe en ningún proceso",
    PROMPT, "ts:test/contract-prompts.test.ts",
    [["dialogue_choice event", "player_choice event"]],
  ],
  // ── #259 · la entity cerrada ────────────────────────────────────────────
  [
    "entity · el `.strict()` vuelve a ser `.passthrough()` (la clave inventada se cae muda)",
    SCHEMA, "ts:test/scene-schema.test.ts",
    [["  .strict()\n  .superRefine((e, ctx) => {", "  .passthrough()\n  .superRefine((e, ctx) => {"]],
  ],
  // ── #237 · la frontera entre las dos poblaciones ────────────────────────
  [
    "frontera · `ExpandedSceneSchema` deja de exigir la expansión y una escena CRUDA la satisface",
    SCHEMA, "ts:test/scene-fixtures.test.ts",
    [
      [
        "    size: SceneSizeSchema,\n    terrain: z.array(z.string()).min(1),\n    terrain_legend: TerrainLegendSchema,",
        "    size: SceneSizeSchema.optional(),\n    terrain: z.array(z.string()).min(1).optional(),\n    terrain_legend: TerrainLegendSchema.optional(),",
      ],
      ["    __expanded: z.literal(true),", "    __expanded: z.literal(true).optional(),"],
    ],
  ],
  // El CABLEADO de la frontera: que el snapshot que el juego CARGA se valide
  // con el schema de la población cargada. Es la mitad del criterio 4 que
  // toca el arranque — sin esto, `scenes` vuelve a no tener tipo.
  // Se quita TAMBIÉN el import, y no por limpieza: dejándolo, el único que
  // protesta es el linter por la variable huérfana — un candado accidental que
  // desaparece en cuanto alguien borra la línea de más, y que además no dice
  // nada sobre el COMPORTAMIENTO. Lo que aquí se pregunta es si algún test se
  // entera de que la población cargada ha dejado de tener tipo.
  [
    "cableado · `WorldSnapshotSchema.scenes` vuelve a `z.unknown()` (la población cargada sin tipo)",
    SNAP, "ts:test/world-snapshot.test.ts",
    [
      [
        "    scenes: z.record(z.string(), ExpandedSceneSchema),",
        "    scenes: z.record(z.string(), z.record(z.string(), z.unknown())),",
      ],
      ['import { ExpandedSceneSchema } from "../contract/model-io/scene-schema.js";\n', ""],
    ],
  ],
  // ── #237/#259 · el espejo Python, por el set COMPARTIDO ─────────────────
  // Estos tres corren la misma batería que el lado TS (las fixtures de
  // data/contract/fixtures/scene/), que es el mecanismo que impide que un
  // proceso se endurezca sin el otro.
  [
    "python · el tile vuelve a podar `size`/`terrain` en silencio",
    PY, "py:ai_server.tests.test_contract_fixtures",
    [[
      '        if "size" in data:\n            raise ValueError("un tile no lleva `size` (la base es `biome` + primitivas)")\n' +
        '        if "terrain" in data and data["terrain"] != []:\n            raise ValueError(\n' +
        '                "un tile no lleva grid `terrain` completo (usa `biome` + `ground`/`volumes`)"\n            )\n',
      '        data.pop("size", None)\n',
    ]],
  ],
  [
    "python · la `description` vacía vuelve a caerse en silencio",
    PY, "py:ai_server.tests.test_contract_fixtures",
    [[
      '        if "description" in ent:\n            desc = ent["description"]\n' +
        '            if not isinstance(desc, str) or not desc.strip():\n                raise ValueError(\n' +
        '                    f"entity \'{eid}\': `description` es el PROMPT del skin del personaje y no "\n' +
        '                    f"puede ir vacía ({desc!r}). Descríbelo (aspecto, ropa, arma) o quita el campo"\n' +
        '                )\n            clean_ent["description"] = desc.strip()',
      '        if isinstance(ent.get("description"), str) and ent["description"].strip():\n' +
        '            clean_ent["description"] = ent["description"].strip()',
    ]],
  ],
  [
    "python · la allow-list de entity vuelve a ser muda (la clave desconocida por el desagüe)",
    PY, "py:ai_server.tests.test_contract_fixtures",
    [[
      "        desconocidas = [k for k in ent if k not in ENTITY_FIELDS]\n        if desconocidas:\n",
      "        desconocidas = []\n        if desconocidas:\n",
    ]],
  ],
];

function corre(bateria) {
  const [modo, cual] = [bateria.slice(0, bateria.indexOf(":")), bateria.slice(bateria.indexOf(":") + 1)];
  const r =
    modo === "ts"
      ? spawnSync("node", ["--import", "tsx", "--test", "--test-concurrency=1", cual],
          { cwd: CORE, encoding: "utf8", timeout: 300000 })
      : spawnSync("python3", ["-m", "unittest", cual],
          { cwd: raiz, encoding: "utf8", timeout: 300000 });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (modo === "ts") {
    const m = /^ℹ fail (\d+)$/m.exec(salida);
    return { fallos: m ? Number(m[1]) : -1, rotos: [...salida.matchAll(/✖ (.+?) \(/g)].map((x) => x[1]) };
  }
  const m = /FAILED \(failures=(\d+)\)/.exec(salida);
  const ok = /\nOK\b/.test(salida);
  return {
    fallos: m ? Number(m[1]) : ok ? 0 : -1,
    rotos: [...salida.matchAll(/FAIL: .*?fixture='([^']+)'/g)].map((x) => x[1]),
  };
}

const filtro = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const casa = (n) => filtro.length === 0 || filtro.some((f) => n.toLowerCase().includes(f.toLowerCase()));

const FICHEROS = [SCHEMA, PROMPT, SNAP, PY];

// Se niega a arrancar sobre un árbol sucio: si el fichero ya trae cambios, la
// restauración de este guion los borraría. Es la única forma de que escribir
// en el árbol de otro sea seguro.
const sucio = spawnSync("git", ["status", "--porcelain", "--", ...FICHEROS.map((f) => relative(raiz, f))],
  { cwd: raiz, encoding: "utf8" });
if ((sucio.stdout ?? "").trim()) {
  console.error("✖ hay cambios sin commitear en los ficheros que este guion reescribe:");
  console.error(sucio.stdout);
  console.error("  commitéalos o guárdalos antes: este guion restaura al contenido del disco de ANTES de arrancar,");
  console.error("  y si algo lo interrumpiera a mitad, los perderías.");
  process.exit(2);
}

const original = new Map(FICHEROS.map((f) => [f, readFileSync(f, "utf8")]));
const restaura = () => { for (const [f, txt] of original) writeFileSync(f, txt); };

const fallidos = [];
const obsoletos = [];
try {
  // Base: si alguna batería YA está roja, cualquier "rojo" de después sería
  // el rojo de otra cosa — que es justo el error que este guion existe para
  // no cometer.
  const baterias = [...new Set(INVARIANTES.filter(([n]) => casa(n)).map(([, , b]) => b))];
  console.log("Base (nada roto):");
  let baseMala = false;
  for (const b of baterias) {
    const r = corre(b);
    console.log(`  ${r.fallos === 0 ? "verde ✔" : `${r.fallos} fallo(s) ✖`}  ${b}`);
    if (r.fallos !== 0) baseMala = true;
  }
  if (baseMala) {
    console.error("\n✖ una batería ya está roja de partida — arregla eso antes de medir nada aquí");
    restaura();
    process.exit(1);
  }
  console.log();

  for (const [nombre, fichero, bateria, pares] of INVARIANTES) {
    if (!casa(nombre)) continue;
    restaura();
    let texto = original.get(fichero);
    let malo = null;
    for (const [buscar, poner] of pares) {
      const veces = texto.split(buscar).length - 1;
      if (veces !== 1) { malo = `el patrón aparece ${veces} veces`; break; }
      texto = texto.replace(buscar, poner);
    }
    if (malo) {
      console.log(`⚠️  ${nombre}`);
      console.log(`     ${malo}: el código se ha movido y este candado ya no lo apunta\n`);
      obsoletos.push(nombre);
      continue;
    }
    writeFileSync(fichero, texto);
    const r = corre(bateria);
    const rojo = r.fallos > 0;
    if (!rojo) fallidos.push(nombre);
    console.log(`${rojo ? "🔴 rojo " : "🟢 VERDE"}  ${nombre}`);
    console.log(
      rojo
        ? `     lo caza (${bateria}): ${r.rotos.slice(0, 3).join(" | ") || "(sin nombre)"}`
        : `     ⚠️  ROMPERLO NO CAMBIA NADA: ningún test de ${bateria} se entera`,
    );
  }
} finally {
  restaura();
}

// Los ficheros tienen que haber vuelto EXACTAMENTE como estaban: esto escribe
// en el árbol de trabajo de alguien.
for (const [f, txt] of original) {
  if (readFileSync(f, "utf8") !== txt) {
    console.error(`\n✖ NO SE RESTAURÓ ${f} — revísalo con git diff antes de seguir`);
    process.exit(2);
  }
}

const probados = INVARIANTES.filter(([n]) => casa(n)).length;
console.log(`\n${"─".repeat(70)}`);
console.log(`Candados probados en negativo : ${probados}`);
console.log(`Nacen rojos al romperlos      : ${probados - fallidos.length - obsoletos.length}`);
console.log(`NO se enteran                 : ${fallidos.length}`);
for (const f of fallidos) console.log(`   🟢 ${f}`);
console.log(`Patrón obsoleto               : ${obsoletos.length}`);
for (const o of obsoletos) console.log(`   ⚠️  ${o}`);

const ok = fallidos.length === 0 && obsoletos.length === 0;
console.log(ok ? "\n✔ todos los candados del contrato comprueban lo que dicen" : "\n✖ hay candados que no comprueban nada");
process.exit(ok ? 0 : 1);
