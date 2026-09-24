#!/usr/bin/env node
/** ¿Se pueden poner ROJOS los candados de `data/contract/` y sus espejos?
 *
 *  Son tres familias: el CONTRATO DE ESCENA con su espejo Python (#203/#237/#259
 *  y siguientes); desde #662, el PADRÓN DE SONDAS DE MOVIMIENTO de `qa/`
 *  (`sondas-de-movimiento.json`), cuyo espejo son los guiones del banco; y desde
 *  #611 los DOS CONTRATOS DE ESPERAS del banco (`esperas-que-conducen.json` y
 *  `esperas-por-fotogramas.json`), donde lo que hay que poder poner rojo es la
 *  DERIVACIÓN de la clase de una exención — que es el candado que sustituyó a
 *  tres capas de forma sobre la prosa del `porque`, y el que tiene que ser capaz
 *  de cazar lo que aquellas no cazaban.
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
 *  «Rojo» es el CÓDIGO DE SALIDA de la batería, no solo su contador de fallos
 *  (#697): cuando el cuerpo de un `describe` lanza —un contrato roto leído ahí
 *  tumba la suite—, `node --test` sale con 1 (desde v24.15.0; `engines` lo
 *  exige) pero el resumen sigue diciendo `ℹ fail 0`, así que el veredicto mira
 *  `status`. El invariante «suite que lanza» lo canda: sin mirar `status`, o
 *  con un Node < 24.15 (que salía con 0), sale VERDE.
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
import { aplicarPares } from "./lib/anclas.mjs";
import { turnoDeCandados } from "./lib/turno-exclusivo.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");

const SCHEMA = join(CORE, "src/contract/model-io/scene-schema.ts");
const PROMPT = join(CORE, "data/contract/prompts/ui_systems.md");
const SNAP = join(CORE, "src/games/world-snapshot.ts");
const PY = join(raiz, "ai_server/narrative_schemas.py");
// Los dos del candado de SUPERVIVENCIA (#532): el tool que el modelo ve y una
// fixture con su `sobrevive`. Se tocan igual que los fuentes — escribir, exigir
// el rojo, restaurar— y entran en la comprobación byte a byte del final.
const TOOL = join(CORE, "data/contract/tools/narrative_react.json");
const FIXTURE_CARRO = join(CORE, "data/contract/fixtures/reaction/valid/spawn_object_footprint.json");
// Los dos del MECANISMO de #697: un contrato leído en el cuerpo de un
// `describe`. La fixture de `ground_plan` solo la lee `loadFixtures` en el
// cuerpo del describe de `contract-fixtures.test.ts` —ningún `it` la toca—, así
// que es la que DISCRIMINA: rota, la batería sale `ℹ fail 0` y solo el EXIT
// la delata (medido el 2026-09-23 en Node 24.11.1: 87 tests pasan a 69 y salía
// con 0; desde v24.15.0 sale con 1).
// `generate_scene.json` lo leen además tres `it`: sale rojo con o sin el
// arreglo, y está por ser el ejemplo del issue, no porque pruebe el mecanismo.
const FIXTURE_SUELO = join(CORE, "data/contract/fixtures/ground_plan/valid/minimo.json");
const TOOL_ESCENA = join(CORE, "data/contract/tools/generate_scene.json");
// Los cinco del padrón de SONDAS DE MOVIMIENTO (#662). El contrato es
// `data/contract/sondas-de-movimiento.json` y su espejo son los guiones del
// banco, así que el sabotaje se hace donde vive cada mitad: cuatro guiones y el
// propio padrón. Añadidos por QA al validar la PR-2 de la tanda P — el
// ingeniero probó las cinco negativas a mano en un script de scratchpad que se
// fue con la sesión, y un candado probado una vez es una afirmación, no una
// prueba (es la frase de la cabecera de este guion).
const PADRON_SONDAS = join(CORE, "data/contract/sondas-de-movimiento.json");
const G91 = join(raiz, "qa/guiones/91-la-forja-que-el-motor-pone-ya-no-se-atraviesa.mjs");
const G118 = join(raiz, "qa/guiones/118-el-carro-frena-y-la-bolsa-se-pisa.mjs");
const G128 = join(raiz, "qa/guiones/128-lo-que-el-motor-pone-de-golpe-no-se-pisa.mjs");
const G133 = join(raiz, "qa/guiones/133-la-parada-falsa-bajo-carga-de-verdad.mjs");
// Los DOS CONTRATOS DE ESPERAS (#611), con sus ocho entradas. Cinco sabotean el
// CONTRATO —una exención que afirma un sujeto que su predicado no toca es la
// mentira elaborada que la forma del texto dejaba pasar 7 pass · 0 fail— y tres
// sabotean el BANCO, que es donde viven las otras dos mentiras: las que se
// escriben sin tocar el contrato, y que por eso mismo pasaron 12·0 y 10·0 hasta
// que la QA de esta tanda las midió.
const CONDUCEN = join(CORE, "data/contract/esperas-que-conducen.json");
const FOTOGRAMAS = join(CORE, "data/contract/esperas-por-fotogramas.json");
// El test que lleva el ZOD de ese contrato: la vía `issue` se sabotea en su
// regla, porque el contrato ya no tiene ninguna exención por issue (tanda BB).
const T_FOTOGRAMAS = join(CORE, "test/espera-de-fotogramas-con-dueno.test.ts");
// …y los tres guiones desde los que se reproducen los dos agujeros que su QA
// midió: la clave compartida (H-1) y la referencia que no decide una función
// (H-2). Ésos NO se pueden sabotear desde el contrato: la mentira se escribe en
// el banco y el contrato ni se entera, que es justo lo que los hacía verdes.
const G05 = join(raiz, "qa/guiones/05-terreno-desde-ground.mjs");
const G69 = join(raiz, "qa/guiones/69-el-arranque-no-se-calla.mjs");
// (el 133 ya está arriba, como `G133`: lo usan las dos familias)

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
    "campos · el zod pierde `style_ref` de entity y el tool se lo sigue ofreciendo al modelo",
    SCHEMA, "ts:test/contract-prompts.test.ts",
    [["    style_ref: z.string().min(1).optional(),\n", ""]],
  ],
  // ── #400 · la raíz cerrada, y su brecha conocida ─────────────────────────
  [
    "campos · el zod gana un campo de raíz que el tool no ofrece (la brecha deja de ser vacía, #408)",
    SCHEMA, "ts:test/contract-prompts.test.ts",
    [["  entities: z.array(EntitySchema),\n} as const;", "  entities: z.array(EntitySchema),\n  nota_del_motor: z.string().optional(),\n} as const;"]],
  ],
  // ── #203 · el guardia DÉBIL de términos prometidos ──────────────────────
  // Vive en `contract-terms.test.ts` desde #347 (es trans-proceso y no puede
  // entrar en la batería de mutación); hasta el 2026-09-03 este invariante
  // seguía apuntando a `contract-prompts` y daba VERDE al romperlo — un
  // candado obsoleto que solo se vio al volver a ejecutar el guion.
  [
    "guardia débil · el prompt vuelve a prometer `player_choice`, que no existe en ningún proceso",
    PROMPT, "ts:test/contract-terms.test.ts",
    [["dialogue_choice event", "player_choice event"]],
  ],
  // ── #259 · la entity cerrada ────────────────────────────────────────────
  [
    "entity · el `.strict()` vuelve a ser `.passthrough()` (la clave inventada se cae muda)",
    SCHEMA, "ts:test/scene-schema.test.ts",
    [["  .strict()\n  .superRefine((e, ctx) => {", "  .passthrough()\n  .superRefine((e, ctx) => {"]],
  ],
  // ── #400 · la escena cerrada ────────────────────────────────────────────
  [
    "escena · el `.strict()` de la raíz vuelve a ser `.passthrough()` (la clave inventada cruza muda hasta el save)",
    SCHEMA, "ts:test/scene-schema.test.ts",
    [
      ["  .object(sceneBaseShape, { errorMap: sceneErrorMap(EMITTED_SCENE_FIELDS) })\n  .strict()", "  .object(sceneBaseShape, { errorMap: sceneErrorMap(EMITTED_SCENE_FIELDS) })\n  .passthrough()"],
      // Sin `;` al final desde #464: el `.strict()` de la escena expandida ya no
      // cierra la expresión — le sigue el `.superRefine` que valida el ALFABETO
      // del grid. La sonda buscaba `.strict();` y dejó de casar, así que este
      // candado pasó a no comprobar nada y lo cazó el propio guion («patrón
      // obsoleto»), que es exactamente para lo que existe esa cuenta.
      ['  }, { errorMap: sceneErrorMap([...SCENE_FIELDS, "__expanded"]) })\n  .strict()', '  }, { errorMap: sceneErrorMap([...SCENE_FIELDS, "__expanded"]) })\n  .passthrough()'],
    ],
  ],
  // ── #237 · la frontera entre las dos poblaciones ────────────────────────
  [
    "frontera · `ExpandedSceneSchema` deja de exigir la expansión y una escena CRUDA la satisface",
    SCHEMA, "ts:test/scene-fixtures.test.ts",
    [
      [
        "    size: SceneSizeSchema,\n    terrain: z.array(z.string()).min(1),",
        "    size: SceneSizeSchema.optional(),\n    terrain: z.array(z.string()).min(1).optional(),",
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
        '                    f"entity \'{eid}\': `description` es el texto del que se genera su arte (en un "\n' +
        '                    f"NPC, el prompt del skin) y no puede ir vacía ({desc!r}). Descríbelo (aspecto, "\n' +
        '                    f"ropa, arma) o quita el campo"\n' +
        '                )\n            clean_ent["description"] = desc.strip()',
      '        if isinstance(ent.get("description"), str) and ent["description"].strip():\n' +
        '            clean_ent["description"] = ent["description"].strip()',
    ]],
  ],
  [
    "python · la raíz vuelve a ser muda (la clave desconocida cruza hasta el save)",
    PY, "py:ai_server.tests.test_contract_fixtures",
    [[
      "    desconocidas = [k for k in data if k not in SCENE_FIELDS]\n    if desconocidas:\n",
      "    desconocidas = []\n    if desconocidas:\n",
    ]],
  ],
  [
    "python · el tile sin `biome` vuelve a recibir hierba por defecto, en silencio",
    PY, "py:ai_server.tests.test_contract_fixtures",
    [[
      '            raise ValueError(\n                "un tile necesita `biome` (grass|forest_floor|meadow|sand|dirt|stone|snow|swamp)"\n            )\n',
      '            data["biome"] = "grass"\n',
    ]],
  ],
  [
    "python · la altura no positiva vuelve a descartarse en silencio",
    PY, "py:ai_server.tests.test_contract_fixtures",
    [[
      '            if not isinstance(altura, (int, float)) or isinstance(altura, bool) or altura <= 0:\n                raise ValueError(f"entity \'{eid}\': `h` es la altura en metros y debe ser un número > 0 ({altura!r})")\n            clean_ent["h"] = float(altura)',
      '            if isinstance(altura, (int, float)) and not isinstance(altura, bool) and altura > 0:\n                clean_ent["h"] = float(altura)',
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
  // ── #532 · el campo que SOBREVIVE, y su totalidad ────────────────────────
  // La clase de fallo que estos tres cierran es la de #397 y #532: un campo
  // declarado en el zod, ofrecido al modelo en el tool y MUERTO en el saneador
  // Python. Las fixtures comparaban accept/reject, así que salía verde en las
  // dos suites y no llegaba nunca. Vivían en prosa en el informe de la PR 1
  // hasta que QA los pidió aquí (H-6): un rojo que solo existe si alguien lo
  // reproduce a mano deja de existir en dos tandas.
  [
    "python · el saneador vuelve a PODAR el `footprint` declarado (válido de contrato, muerto de datos)",
    PY, "py:ai_server.tests.test_contract_fixtures",
    [[
      "        if valor is not _AUSENTE:\n            entry[campo] = valor",
      '        if campo == "footprint":\n            valor = _AUSENTE\n        if valor is not _AUSENTE:\n            entry[campo] = valor',
    ]],
  ],
  [
    "totalidad · una fixture pierde el `sobrevive` de un campo y nadie prueba que llegue vivo",
    FIXTURE_CARRO, "ts:test/contract-fixtures.test.ts",
    [['        "character_type": "cart"\n      }\n    ]\n  },\n  "payload"', '        "name": "Carro de heno"\n      }\n    ]\n  },\n  "payload"']],
  ],
  [
    "totalidad · el tool ofrece al modelo un campo que NINGUNA fixture prueba (el `tono` de la QA de la PR 1)",
    TOOL, "ts:test/contract-fixtures.test.ts",
    [[
      '                "choices": {\n                  "type": "array",',
      '                "tono": {\n                  "type": "string"\n                },\n                "choices": {\n                  "type": "array",',
    ]],
  ],
  // ── #697 · una suite que LANZA pone rojo (el mecanismo, no los sitios) ──
  [
    "suite que lanza · una fixture de contrato rota, leída solo por un helper en el cuerpo de un `describe`",
    FIXTURE_SUELO, "ts:test/contract-fixtures.test.ts",
    [['{\n  "description": "un camino mínimo', '{ roto\n  "description": "un camino mínimo']],
  ],
  [
    "suite que lanza · `generate_scene.json` roto, leído en el cuerpo de un `describe` (el ejemplo del issue)",
    TOOL_ESCENA, "ts:test/contract-prompts.test.ts",
    [['{\n  "name": "generate_scene",', '{ roto\n  "name": "generate_scene",']],
  ],
  // ── #662 · el padrón de sondas de movimiento, UNA NEGATIVA POR GRAFÍA ────
  // El issue existe porque el censo anterior (el bloque 1 del guion 145) era un
  // `match(/__nefan\.probeCollide/g)` y por eso nació CIEGO a dos de las tres
  // grafías que llegan a la misma función. El candado nuevo lee el ÁRBOL, y eso
  // hay que demostrarlo GRAFÍA A GRAFÍA: una sola negativa con la forma directa
  // dejaría verde exactamente el mismo agujero con otro nombre.
  [
    "sondas · GRAFÍA ALIAS: un migrado rebindea `const punto = …probeCollide` y no lo declara",
    G91, "ts:test/la-consulta-de-movimiento-tiene-dueno.test.ts",
    [["const punto = window.__nefan.probePoint;\n    const paso = 0.05;", "const punto = window.__nefan.probeCollide;\n    const paso = 0.05;"]],
  ],
  [
    "sondas · GRAFÍA DIRECTA: un migrado vuelve a `window.__nefan.probeCollide(x, z)`",
    G118, "ts:test/la-consulta-de-movimiento-tiene-dueno.test.ts",
    [["  ctx.page.evaluate((p) => ({ bloquea: window.__nefan.probePoint(p.x, p.z) }), punto);",
      "  ctx.page.evaluate((p) => ({ bloquea: window.__nefan.probeCollide(p.x, p.z) }), punto);"]],
  ],
  [
    "sondas · GRAFÍA STRING: un migrado pasa por `ctx.nefan(\"probeCollide\", …)`, la que nadie veía",
    G128, "ts:test/la-consulta-de-movimiento-tiene-dueno.test.ts",
    [["  ctx.page.evaluate((q) => window.__nefan.probePoint(q.x, q.z), p);",
      '  ctx.nefan("probeCollide", p.x, p.z);']],
  ],
  [
    "sondas · LA OTRA DIRECCIÓN: alguien «arregla» una sonda de movimiento declarada y el padrón sobra",
    G133, "ts:test/la-consulta-de-movimiento-tiene-dueno.test.ts",
    [["    const pc = window.__nefan.probeCollide;", "    const pc = window.__nefan.probePoint;"]],
  ],
  [
    "sondas · EL MOTIVO: un `porque` vaciado a un encogimiento de hombros pasa por declaración",
    PADRON_SONDAS, "ts:test/la-consulta-de-movimiento-tiene-dueno.test.ts",
    [[
      '"porque": "Es la DEMOSTRACIÓN del defecto y ya está escrita como `ctx.log` y no como aserto: imprime que la sonda con la que el guion 09 decía medir #616 vale `false` también emparedado, porque es un movimiento de un punto a sí mismo. Migrarla borraría justo la línea que enseña por qué existe este padrón."',
      '"porque": "es movimiento, se queda"',
    ]],
  ],
  // ── #611 · la exención no se cree, se DERIVA ────────────────────────────
  // El invariante que sustituyó a la regex de proceso, a las veinte palabras
  // distintas y a la tirada de ocho: la `clase` de una exención la demuestra su
  // PREDICADO, leyendo del hook algo del proceso que nombra. Las tres capas de
  // forma cerraban la exención perezosa y NO la elaborada —QA lo midió con el
  // 58 pasado a `{ms}` y una excusa «bridge» en prosa plausible: 7 pass · 0
  // fail—, así que lo que hay que demostrar aquí es justo esa dirección.
  [
    "esperas · la exención del 43 dice esperar al BRIDGE y su predicado lee `dialogue`, no `scene`",
    CONDUCEN, "ts:test/esperas-que-conducen.test.ts",
    [['      "clase": "motor",', '      "clase": "bridge",']],
  ],
  // La otra mitad, y sin ella la de arriba se podría «arreglar» inventando la
  // lectura en el mapa: un nombre que el hook no tiene no deriva nada, y hasta
  // #611 nadie cruzaba el mapa con `nefan-hook.ts`.
  [
    "esperas · el mapa de clases nombra una lectura que el hook NO tiene (`escena` por `scene`)",
    CONDUCEN, "ts:test/esperas-que-conducen.test.ts",
    [['    "bridge": [\n      "scene"\n    ],', '    "bridge": [\n      "escena"\n    ],']],
  ],
  // El contrato HERMANO, que subió al mismo listón en la misma tanda: allí la
  // clase se deriva del SITIO (pared > cortafuegos del dueño, o `{sim}`
  // presente) en vez de del hook.
  [
    "esperas · la del 69 se reetiqueta «conducida en sim» y el sitio no lleva `{sim}` por ningún lado",
    FOTOGRAMAS, "ts:test/espera-de-fotogramas-con-dueno.test.ts",
    [['      "clase": "cortafuegos mayor",', '      "clase": "conducida en sim",']],
  ],
  // Y la vía `issue`, que es la única que ninguna lectura demuestra: su número
  // es obligatorio porque sin él no hay nada que pueda caducar. Que el issue
  // esté ABIERTO lo pregunta a GitHub el headless
  // `qa/la-exencion-por-issue-tiene-issue-vivo.mjs`, que no puede correr aquí:
  // esto es la mitad que sí vive en `npm test`.
  //
  // EL ANCLA ES LA REGLA DEL ZOD, NO UNA ENTRADA DEL CONTRATO. Hasta la tanda
  // BB se borraba el `"issue": 673` de la única exención por issue que había;
  // #673 se cerró, esa exención se fue con él y el sabotaje se quedó sin nada
  // que romper. Una entrada real vuelve a desaparecer cada vez que se cumple lo
  // que el contrato quiere —vaciarse—, así que se rompe lo que no caduca: la
  // regla «una exención por issue lleva su número». El test fabrica su propia
  // exención por issue sobre una copia del contrato y le quita el número; con
  // la regla anulada, esa copia pasa y el test se pone rojo.
  [
    "esperas · una exención por issue sin NÚMERO deja de rechazarse (y entonces no hay nada que caduque)",
    T_FOTOGRAMAS, "ts:test/espera-de-fotogramas-con-dueno.test.ts",
    [["if (e.clase === CLASE_ISSUE && e.issue === undefined) {", "if (e.clase === CLASE_ISSUE && false) {"]],
  ],
  // Los dos que la QA de la tanda AE probó a mano y pidió aquí (H-6): son un
  // `sed` cada uno y prueban lo NUEVO del hermano —la clave literal y la
  // derivación por el sitio— desde los dos lados, el contrato y el banco.
  [
    "esperas · el `desc` de la exención del 69 cambia UNA CIFRA y se queda sin la espera que eximía",
    FOTOGRAMAS, "ts:test/espera-de-fotogramas-con-dueno.test.ts",
    [["el bucle de juego avanza 60 fotogramas con el socket escupiendo basura\\\"\",", "el bucle de juego avanza 61 fotogramas con el socket escupiendo basura\\\"\","]],
  ],
  [
    "esperas · la pared del 69 baja al `CORTAFUEGOS_MS` del dueño y «cortafuegos mayor» deja de ser cierto",
    G69, "ts:test/espera-de-fotogramas-con-dueno.test.ts",
    [["    30_000,\n", "    20_000,\n"]],
  ],
  // Y LOS DOS QUE LA QA MIDIÓ EN VERDE (H-1 y H-2), reproducidos donde de
  // verdad se escribirían: en el banco. Los dos pasaban 12·0 y 10·0 antes de la
  // corrección, así que son los que hay que poder ver rojos cada vez.
  [
    "esperas · H-1: una espera NUEVA en el 05 se pone el MISMO `desc` que la exención honesta y se cuela debajo",
    G05, "ts:test/esperas-que-conducen.test.ts",
    [[
      "  const nuevo = await ctx\n    .holdUntil(\n",
      '  await ctx.holdUntil("up", "el jugador entra en el tile recién generado",\n' +
        "    () => window.__nefan.frontier.proposal ?? null, { ms: 120_000 }, null);\n" +
        "  const nuevo = await ctx\n    .holdUntil(\n",
    ]],
  ],
  [
    "esperas · H-2: una SOMBRA de `TRAZA` al final del 133 deja el predicado sin dueño y la exención sin derivar",
    G133, "ts:test/esperas-que-conducen.test.ts",
    [[
      '    JSON.stringify(anduvo),\n  );\n}\n',
      '    JSON.stringify(anduvo),\n  );\n}\nconst TRAZA = () => window.__nefan.scene ?? null;\n',
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
    return {
      status: r.status,
      fallos: m ? Number(m[1]) : -1,
      rotos: [...salida.matchAll(/✖ (.+?) \(/g)].map((x) => x[1]),
    };
  }
  const m = /FAILED \(failures=(\d+)\)/.exec(salida);
  const ok = /\nOK\b/.test(salida);
  return {
    status: r.status,
    fallos: m ? Number(m[1]) : ok ? 0 : -1,
    rotos: [...salida.matchAll(/FAIL: .*?fixture='([^']+)'/g)].map((x) => x[1]),
  };
}

const filtro = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const casa = (n) => filtro.length === 0 || filtro.some((f) => n.toLowerCase().includes(f.toLowerCase()));

const FICHEROS = [SCHEMA, PROMPT, SNAP, PY, TOOL, FIXTURE_CARRO, FIXTURE_SUELO, TOOL_ESCENA, PADRON_SONDAS, G91, G118, G128, G133, CONDUCEN, FOTOGRAMAS, T_FOTOGRAMAS, G05, G69];

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

// EL TURNO, antes de la foto (#572). Estos candados rompen fuentes de
// producción a mano y las restauran con una copia hecha al arrancar; dos
// instancias a la vez se fotografían la mutación de la otra y la «restauran»
// como si fuera el original. Pasó el 2026-09-10.
turnoDeCandados();
const original = new Map(FICHEROS.map((f) => [f, readFileSync(f, "utf8")]));
const restaura = () => { for (const [f, txt] of original) writeFileSync(f, txt); };

// Sin manejador, un Ctrl+C mata al guion SIN pasar por el `finally` y dejaba
// `scene-schema.ts` mutado —producción rota— en el árbol de trabajo (QA de
// #454). `restaura` es idempotente: vale para los dos caminos. El bucle es
// `spawnSync`, así que se cede el turno entre invariantes para que la señal
// pueda cortar en la siguiente frontera.
for (const [señal, codigo] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(señal, () => {
    console.error(`\n⊘ INTERRUMPIDO (${señal}) — restaurando los ${FICHEROS.length} ficheros antes de salir`);
    restaura();
    process.exit(codigo);
  });
}
const cede = () => new Promise((r) => setImmediate(r));

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
    // Sana solo si NO hay fallos Y sale con 0: una suite que lanza da
    // `ℹ fail 0` con EXIT 1, y esa base no es sana.
    const sana = r.fallos === 0 && r.status === 0;
    console.log(`  ${sana ? "verde ✔" : `${r.fallos} fallo(s), EXIT ${r.status} ✖`}  ${b}`);
    if (!sana) baseMala = true;
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
    const parche = aplicarPares(original.get(fichero), pares);
    if (!parche.ok) {
      console.log(`⚠️  ${nombre}`);
      console.log(`     el patrón aparece ${parche.veces} veces: el código se ha movido y este candado ya no lo apunta\n`);
      obsoletos.push(nombre);
      continue;
    }
    writeFileSync(fichero, parche.texto);
    const r = corre(bateria);
    // En TS manda también el código de salida (#697); en Python no cambia nada:
    // allí un `errors=` sin `failures=` seguía sin contar como rojo, y así sigue.
    const rojo = r.fallos > 0 || (bateria.startsWith("ts:") && r.status !== 0);
    if (!rojo) fallidos.push(nombre);
    console.log(`${rojo ? "🔴 rojo " : "🟢 VERDE"}  ${nombre}`);
    console.log(
      rojo
        ? `     lo caza (${bateria}): ${r.rotos.slice(0, 3).join(" | ") || "(sin nombre)"}`
        : `     ⚠️  ROMPERLO NO CAMBIA NADA: ningún test de ${bateria} se entera`,
    );
    await cede();
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
