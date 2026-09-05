/** Guardia de fronteras arquitectónicas.
 *
 *  Las reglas viven en `data/contract/arch-rules.json`, el motor que las
 *  aplica en `src/contract/arch/check.ts` y el I/O (recorrer el repo, parsear
 *  imports) en `scripts/arch-collect.ts`. Este fichero es el guardia: falla
 *  con `ruta:línea → regla` cuando algo cruza una frontera.
 *
 *  Si falla: repara el import o el patrón. Si de verdad es legítimo, añade una
 *  excepción CON MOTIVO en el JSON — una excepción sin motivo no valida.
 *
 *  Las reglas `warn` son deuda YA existente, congelada en `max`: el test falla
 *  si CRECE, y avisa (sin fallar) cuando alguien la baja y toca reapretar. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ArchConfigSchema,
  checkArchitecture,
  deadExceptions,
  enclosingFunction,
  formatDeadExceptions,
  formatFailure,
  globToRegExp,
  reportByRule,
  type SourceFile,
} from "../src/contract/arch/check.js";
import { archConfig as config, loadArchFiles } from "../scripts/arch-collect.js";

const files = loadArchFiles();
const violations = checkArchitecture(config, files);
const reports = reportByRule(config, violations);

describe("fronteras arquitectónicas", () => {
  it("el escaneo encuentra el árbol del repo", () => {
    assert.ok(files.length > 200, `solo ${files.length} ficheros escaneados — ¿mal la raíz del repo?`);
  });

  // Una exención sobrevive al fichero que eximía y nadie se entera: la regla
  // vuelve a estar abierta en esa ruta el día que alguien la recree. Por eso
  // cada borrado tiene que limpiar la suya en la MISMA PR.
  it("[error] excepciones-vivas: ninguna exención apunta a un fichero que ya no existe", () => {
    const dead = deadExceptions(config, files);
    assert.equal(dead.length, 0, `\n${formatDeadExceptions(dead)}\n`);
  });

  // Probado en NEGATIVO contra la config real: sobre el árbol de hoy la regla
  // está verde, y una regla verde no demuestra nada por sí sola. El motor
  // acepta `SourceFile[]` fabricados, así que se le enseña el texto que la
  // regla existe para cortar y se comprueba que salta con su línea.
  //
  // Este es el candado que HEREDA a `blueprint-no-importa-stage`: aquella
  // regla prohibía a blueprint/** importar de stage/**, y se quedó sin sujeto
  // cuando el directorio del plató dejó de existir. Lo que sí puede volver es
  // el CAMPO, por copy-paste de un dump viejo — y eso es lo que se prueba.
  it("[error] campos-retirados-no-vuelven: los campos del plató saltan donde reaparezcan", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "campos-retirados-no-vuelven");

    // Literalmente lo que había hasta esta PR, en los tres procesos.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/narrative/types.ts",
          text: "interface LlmContext {\n  stage_request?: { bootstrap?: boolean };\n}\n",
          imports: [],
        },
        {
          path: "narrative-mcp/server.ts",
          text: "const k = 'stage_review';\n",
          imports: [],
        },
        {
          path: "labs/narrative/fake-ai-server.ts",
          text: "// linea\n// otra\nif (body.stage_request) return plato();\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "labs/narrative/fake-ai-server.ts:3",
        "narrative-mcp/server.ts:1",
        "nefan-core/src/narrative/types.ts:2",
      ],
      "el campo retirado tiene que saltar en cualquiera de los procesos escaneados",
    );

    // Los términos que entran con la retirada de los huérfanos del pipeline de
    // imagen de la oblicua: kinds de visión sin emisor, campos de LlmContext
    // que viajaban vacíos y sus rutas HTTP. Sin esta comprobación, añadirlos al
    // patrón sería una lista que nadie ha visto saltar.
    assert.deepEqual(
      deLaRegla([
        {
          path: "narrative-mcp/server.ts",
          text: "currentKind = 'blueprint_review';\n",
          imports: [],
        },
        {
          path: "nefan-core/src/narrative/types.ts",
          text: "interface LlmContext {\n  scene_analysis?: { total: number };\n}\n",
          imports: [],
        },
        {
          path: "ai_server/routers/generation.py",
          text: '@router.post("/analyze_scene_image")\n',
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "ai_server/routers/generation.py:1",
        "narrative-mcp/server.ts:1",
        "nefan-core/src/narrative/types.ts:2",
      ],
      "los huérfanos del pipeline oblicuo tienen que saltar igual que los del plató",
    );

    // Y los símbolos del EJE DE VISTAS, que entra a cero en la PR que lo
    // colapsa. En TS volver a escribirlos no compila, pero la mitad de los
    // roots no es TS: una fixture .json o un guion de qa pueden resucitar el
    // eje entero por copy-paste sin que nada se queje.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/data/contract/tools/x.json",
          text: '{\n  "enum": ["WORLD_VIEWS"]\n}\n',
          imports: [],
        },
        {
          path: "qa/guiones/99-x.mjs",
          text: "const vistas = WORLD_VIEWS;\n",
          imports: [],
        },
        {
          path: "nefan-html/src/ui/style-apply.ts",
          text: "const a = ANGLE_BY_VIEW[plan.view];\n",
          imports: [],
        },
        {
          path: "nefan-core/src/games/world-snapshot.ts",
          text: "export function branchForView() {}\nexport type WorldBranch = string;\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-core/data/contract/tools/x.json:2",
        "nefan-core/src/games/world-snapshot.ts:1",
        "nefan-core/src/games/world-snapshot.ts:2",
        "nefan-html/src/ui/style-apply.ts:1",
        "qa/guiones/99-x.mjs:1",
      ],
      "el eje de vistas tiene que saltar en cualquier proceso escaneado",
    );

    // Y las dos CARPETAS de style pack de las vistas retiradas, que entran a
    // cero el día que se archivan sus imágenes. El camino por el que vuelven
    // no es escribir código: es copiar un style.json viejo (o el pack de un
    // tercero) dentro de data/styles/. En TS el zod las rechaza; ai_server NO
    // valida el manifest y ahí la ref se caería del catálogo en silencio.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/data/styles/x/style.json",
          text: '{\n  "file": "overworld/settlement.jpg"\n}\n',
          imports: [],
        },
        {
          path: "ai_server/style_packs.py",
          text: 'REF_FOLDERS = ("proscenium", "faces")\n',
          imports: [],
        },
        {
          path: "nefan-core/data/contract/prompts/x.md",
          text: "Pick an overworld reference for the scene.\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "ai_server/style_packs.py:1",
        "nefan-core/data/contract/prompts/x.md:1",
        "nefan-core/data/styles/x/style.json:2",
      ],
      "las carpetas de las vistas retiradas tienen que saltar en cualquier proceso",
    );

    // Los TRES alias de sala (#175). `room_id`/`room_description` los emitía
    // formatDToWorld DUPLICADOS junto a scene_id/scene_description, y el
    // saneador de ai_server reescribía el uno desde el otro: el sitio por el
    // que vuelven es una fixture o un dump de escena copiado a mano, no
    // escribir código nuevo. `style_tag` volvía por el world.md de un juego,
    // que es prosa para el modelo y no la compila nadie.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/scene/scene-normalize.ts",
          text: "return {\n  room_id: raw.scene_id,\n};\n",
          imports: [],
        },
        {
          path: "ai_server/narrative_schemas.py",
          text: 'data["room_description"] = data["scene_description"]\n',
          imports: [],
        },
        {
          path: "nefan-core/data/scenes/robledo_tile.json",
          text: '{\n  "scene_id": "tile_0_0",\n  "style_tag": "settlement"\n}\n',
          imports: [],
        },
        {
          path: "nefan-core/data/games/x/world.md",
          text: "Preferir escenas con `style_tag` settlement.\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "ai_server/narrative_schemas.py:1",
        "nefan-core/data/games/x/world.md:1",
        "nefan-core/data/scenes/robledo_tile.json:3",
        "nefan-core/src/scene/scene-normalize.ts:2",
      ],
      "los alias de sala tienen que saltar en el código, en el saneador y en los datos",
    );

    // Y sus vecinos VIVOS, callados: `room_data` es el sobre del wire MCP y
    // `roomId` el mensaje `load_room` del protocolo. Si el patrón los cazara,
    // el gate nacería rojo contra dos campos en uso.
    assert.deepEqual(
      deLaRegla([
        {
          path: "narrative-mcp/server.ts",
          text: "async ({ room_data }) => JSON.parse(room_data)\n",
          imports: [],
        },
        {
          path: "nefan-core/src/protocol/messages.ts",
          text: "interface LoadRoom { roomId: string }\n",
          imports: [],
        },
      ]),
      [],
      "el sobre del wire MCP y el roomId del protocolo siguen vivos",
    );

    // Vecinos inocentes de ESTOS dos: el patrón casa PALABRAS completas, así
    // que `proscenio` (la palabra española, que aparece en los comentarios que
    // explican qué murió) y un identificador que solo las contenga se quedan
    // callados. Es lo que hace que la regla se pueda armar sin llenar el
    // código de perífrasis para esquivarla.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/scene/x.ts",
          text: "// El plató proscenio murió con su vista.\nconst overworlds = 0;\n",
          imports: [],
        },
      ]),
      [],
      "la prosa española y los identificadores compuestos no son las carpetas",
    );

    // Y los vecinos inocentes, callados: un identificador que solo CONTIENE la
    // palabra no es el campo (el patrón va con \b a los dos lados). `view` a
    // secas NO está en el patrón: `derived_views` y `?view=` de plugins están
    // vivos y el gate nacería rojo.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/scene/tile.ts",
          text: "const stage_requests_total = 0;\nconst image_reviews_total = 0;\n",
          imports: [],
        },
        {
          path: "nefan-core/src/plugins/views.ts",
          text: "const v = manifest.derived_views;\nfetch(`/plugins/${id}/inspect?view=${name}`);\n",
          imports: [],
        },
        // `view` y `branch` a secas tampoco: son palabras vivas en otros
        // contextos (una rama de git, la vista de un plugin).
        {
          path: "nefan-core/data/scenes/x.json",
          text: '{\n  "view": "algo",\n  "branch": "otra cosa"\n}\n',
          imports: [],
        },
      ]),
      [],
    );
  });

  // Nace VERDE, y una regla verde no distingue "nadie compone el plan por su
  // cuenta" de "el patrón no caza nada". Se le enseña exactamente lo que
  // existe para cortar —el cliente y el bridge derivando el plan— y lo que NO
  // debe cortar: el compositor de core y quien LEE el plan ya resuelto.
  it("[error] un-solo-derivador-del-plan: componer el plan fuera de core salta", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "un-solo-derivador-del-plan");

    // Literalmente lo que había hasta esta PR: el cliente componiendo el plan
    // del tile y el batch de estilo derivando los volúmenes por su cuenta. Y
    // el bridge, que es por donde volvería (la tentación de «derivo aquí y no
    // toco el wire»).
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/main.ts",
          text: "function composeTilePlan(\n  raw: Record<string, unknown>,\n): FpsTilePlan | null {\n",
          imports: [],
        },
        {
          path: "nefan-html/src/ui/style-apply.ts",
          text: "const derived = deriveVolumesFromSchema({ seed: sceneId }, declared);\n",
          imports: [],
        },
        {
          path: "nefan-core/bridge/sim-collision.ts",
          text: "// dos líneas\n// de contexto\nconst vols = deriveVolumesFromSchema(rec.scene_data, declared);\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-core/bridge/sim-collision.ts:3",
        "nefan-html/src/main.ts:1",
        "nefan-html/src/ui/style-apply.ts:1",
      ],
      "componer el plan fuera de core tiene que saltar, sea el cliente o el bridge",
    );

    // Y lo que NO es un segundo derivador: el compositor de core (fuera del
    // alcance de la regla a propósito) y quien lee el plan ya resuelto.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/scene/tile-plan.ts",
          text: "export function composeTilePlan(raw: Record<string, unknown>): TilePlanComposition {\n",
          imports: [],
        },
        {
          path: "nefan-html/src/main.ts",
          text: "const planInfo = (data.__plan as FpsTilePlan | undefined) ?? null;\n",
          imports: [],
        },
        {
          path: "nefan-core/bridge/sim-collision.ts",
          text: "const plan = world.__plan ?? null;\n",
          imports: [],
        },
      ]),
      [],
      "leer `__plan` no es derivarlo, y core es quien lo compone",
    );
  });

  // Nace ROJA a propósito (#318): al entrar listó los CINCO sitios reales de
  // nefan-html/src que se redefinían la respuesta en línea, y la misma PR los
  // migró al contrato. Este test fija lo que el patrón caza y lo que deja
  // pasar, para que el verde de mañana no sea «el patrón dejó de cazar».
  it("[error] las-respuestas-de-red-no-se-redefinen-en-linea: el cast a objeto anónimo salta; el cast al contrato no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter(
        (v) => v.ruleId === "las-respuestas-de-red-no-se-redefinen-en-linea",
      );

    // Literalmente lo que había hasta esta PR: el cast multilínea de
    // style-apply.ts:438 (la llave abre en la misma línea y la forma sigue
    // debajo), el de una línea de title-screen.ts:1194, y la variante sin
    // paréntesis envolvente que nadie escribió aún pero es el mismo defecto.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/ui/style-apply.ts",
          text: "// contexto\nconst data = (await res.json()) as {\n  ok?: boolean;\n  cached?: boolean;\n};\n",
          imports: [],
        },
        {
          path: "nefan-html/src/ui/title-screen.ts",
          text: "const data = (await res.json()) as { generated: string[]; cost_usd: number };\n",
          imports: [],
        },
        {
          path: "nefan-html/src/net/x.ts",
          text: "const d = await res.json() as { ok: boolean };\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-html/src/net/x.ts:1",
        "nefan-html/src/ui/style-apply.ts:2",
        "nefan-html/src/ui/title-screen.ts:1",
      ],
      "el cast a objeto anónimo sobre un .json() tiene que saltar, abra la llave donde la abra",
    );

    // Y los sanos, callados: el cast a un tipo importado del contrato (el
    // patrón que los 8 usos legítimos ya seguían), y un `as {` que no viene
    // de un .json() — un objeto literal casteado no es una respuesta de red.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/ui/style-apply.ts",
          text: "const data = (await res.json()) as GenerateSurfaceAtlasResponse;\n",
          imports: [],
        },
        {
          path: "nefan-html/src/renderer/sprite-renderer.ts",
          text: "const meta = (await res.json()) as SpriteSheetMeta;\n",
          imports: [],
        },
        {
          path: "nefan-html/src/ui/z.ts",
          text: "const opts = base as { color?: string };\n",
          imports: [],
        },
      ]),
      [],
      "castar al contrato importado es exactamente lo que la regla pide",
    );
  });

  // T4 «lo que ya no emite nadie» (#343 #344 #257 #368-F6): un caso por
  // familia de términos, en el proceso donde cada uno vivía. Sin verlos saltar,
  // los 45 términos nuevos del patrón serían una lista que nadie ha probado.
  // El terreno por chars (#335): los identificadores de la leyenda, de los
  // parches y del código que los servía. La vía de vuelta es un save o
  // snapshot anterior copiado a una fixture, o un saneador que reinyecte la
  // leyenda — por eso se enseña en JSON, en Python y en TS.
  it("[error] campos-retirados-no-vuelven: el terreno por chars salta donde reaparezca", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "campos-retirados-no-vuelven");

    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/data/scenes/x.json",
          text: '{\n  "biome": "grass",\n  "terrain_legend": { "w": "agua" }\n}\n',
          imports: [],
        },
        {
          path: "ai_server/narrative_schemas.py",
          text: 'for ch, name in RESERVED_TERRAIN.items():\n    legend.setdefault(ch, name)\ndata["terrain_patches"] = clean_p\n',
          imports: [],
        },
        {
          path: "nefan-core/src/scene/scene-normalize.ts",
          text: "export function resolveTerrainLegend(raw: unknown) {}\n",
          imports: [],
        },
        {
          path: "nefan-core/data/contract/tools/x.json",
          text: '{\n  "description": "a structure\'s wall_char/floor_char of your own"\n}\n',
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "ai_server/narrative_schemas.py:1",
        "ai_server/narrative_schemas.py:3",
        "nefan-core/data/contract/tools/x.json:2",
        "nefan-core/data/contract/tools/x.json:2",
        "nefan-core/data/scenes/x.json:3",
        "nefan-core/src/scene/scene-normalize.ts:1",
      ],
      "la leyenda, los parches y los chars propios tienen que saltar en datos, Python y TS",
    );

    // El único sitio donde el nombre SÍ se escribe es el rebote por nombre del
    // zod y su caso negativo, exceptuados por ruta: fuera de ellos, salta.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/contract/model-io/retired-terrain-fields.ts",
          text: 'export const X = ["terrain_legend"];\n',
          imports: [],
        },
      ]),
      [],
      "el fichero del rebote por nombre está exceptuado a propósito",
    );
  });

  // Las salidas no se sellan en la escena (#179). La regla verde de hoy no
  // distingue «nadie asigna `exits`» de «el patrón no casa nada», así que se le
  // enseña la línea exacta con la que el bridge sellaba las salidas y se comprueba
  // que salta donde toca —bridge y src/narrative— y que LEER no salta.
  it("[error] las-salidas-no-se-sellan-en-la-escena: asignar `.exits` en el bridge o en narrative salta; leerlo no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "las-salidas-no-se-sellan-en-la-escena");
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-core/bridge/handlers/x.ts", text: "scene.exits = links.map((l) => l);\n", imports: [] },
        { path: "nefan-core/src/narrative/y.ts", text: "const a = 1;\nrecord.scene_data.exits=[];\n", imports: [] },
        { path: "nefan-core/bridge/z.ts", text: "if (scene.exits === undefined) {}\nconst b = scene.exits ?? [];\n", imports: [] },
        { path: "nefan-html/src/world/w.ts", text: "entry.scene.exits = salidas;\n", imports: [] },
      ]).map((v) => `${v.path}:${v.line}`),
      ["nefan-core/bridge/handlers/x.ts:1", "nefan-core/src/narrative/y.ts:2"],
      "salta la asignación en bridge y narrative; no la lectura, ni la copia en memoria del cliente",
    );
  });

  // La PROSA del modelo anterior (#335): distinto patrón y distintos roots que
  // la regla de identificadores, porque lo que confunde a un agente no es un
  // nombre de campo sino una frase que le explica cómo declarar terreno por
  // chars. Se enseña en la documentación de arquitectura, en CLAUDE.md, en un
  // prompt y en un docstring Python — y se comprueba que la palabra «leyenda»
  // a secas (la de un mundo, la de un mapa dibujado) NO salta.
  it("[error] el-terreno-no-se-declara-por-chars: la prosa del terreno por chars salta donde se lea", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "el-terreno-no-se-declara-por-chars");

    assert.deepEqual(
      deLaRegla([
        {
          path: "docs/arquitectura/x.md",
          text: "El grid viaja para colisión.\nLa leyenda del terreno decide qué bloquea.\n",
          imports: [],
        },
        {
          path: "CLAUDE.md",
          text: "Cada char custom lleva su legend entry.\n",
          imports: [],
        },
        {
          path: "nefan-core/data/contract/prompts/x.md",
          text: "RESERVED TERRAIN CHARS — the engine stamps the grid for you\nOnly for CUSTOM chars your primitives introduce\n",
          imports: [],
        },
        {
          path: "ai_server/x.py",
          text: "# el tile no trae grid: su terrain legend es la declarada\n",
          imports: [],
        },
        {
          path: "nefan-html/public/x/index.html",
          text: "<p>Un char propio se declara sólido con la forma objeto.</p>\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "ai_server/x.py:1",
        "CLAUDE.md:1",
        "docs/arquitectura/x.md:2",
        "nefan-core/data/contract/prompts/x.md:1",
        "nefan-core/data/contract/prompts/x.md:2",
        "nefan-html/public/x/index.html:1",
      ],
      "la prosa del terreno por chars tiene que saltar en docs, CLAUDE.md, prompts, Python y páginas estáticas",
    );

    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/data/games/x/world.md",
          text: "Nadie distingue ya la crónica de la leyenda.\n",
          imports: [],
        },
        {
          path: "nefan-html/public/world_map/index.html",
          text: '<div class="legend"><span class="lg-site">Site</span></div>\n',
          imports: [],
        },
        {
          path: "nefan-core/src/scene/scene-normalize.ts",
          text: "// Chars del grid que bloquean el paso: solo w, el agua.\n",
          imports: [],
        },
      ]),
      [],
      "la leyenda de un mundo, la de un mapa dibujado y los chars del grid vigentes no son el modelo anterior",
    );
  });

  it("[error] campos-retirados-no-vuelven: las anclas de lugar de la escena (#408) saltan donde reaparezcan, y el anchor vivo no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "campos-retirados-no-vuelven");
    assert.deepEqual(
      deLaRegla([
        // El motor del banco, que era su único productor, volviendo a escribirlo.
        { path: "labs/narrative/fake-scenes.ts", text: 'place_anchors: [{ place_id: "taberna", rect: [52, 48, 24, 16] }],\n', imports: [] },
        // El espejo Python reinyectándolo en la allow-list.
        { path: "ai_server/x.py", text: 'SCENE_FIELDS = [*CAMPOS, "place_anchors"]\n', imports: [] },
      ]).map((v) => `${v.path}:${v.line}`),
      ["ai_server/x.py:1", "labs/narrative/fake-scenes.ts:1"],
      "el campo retirado salta en el banco y en Python",
    );
    // Y el canal VIVO, que se parece, no salta: el anchor del lugar por la tool.
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-core/bridge/handlers/scene.ts", text: "place.anchor = anchor;\n", imports: [] },
        { path: "narrative-mcp/server.ts", text: "anchor: z.object({ tx: z.number(), ty: z.number(), rect: RectSchema.optional() }),\n", imports: [] },
      ]),
      [],
      "`anchor` y `place.anchor` son el canal vivo (map_upsert_place)",
    );
  });

  it("[error] campos-retirados-no-vuelven: lo que ya no emite nadie salta donde reaparezca", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "campos-retirados-no-vuelven");

    assert.deepEqual(
      deLaRegla([
        // El kind WS sin emisor, en el receptor que lo esperaba.
        {
          path: "narrative-mcp/ws-bridge.ts",
          text: "if (msg.type === 'hello') return;\nif (msg.type === 'bridge_status_request') {\n",
          imports: [],
        },
        // El campo de manifest de plugin que ningún código aplicaba.
        {
          path: "nefan-core/src/plugins/types.ts",
          text: "fixtures: z.array(PluginFixtureSchema).default([]),\nslice_size_hint: z.number().int().positive().optional(),\n",
          imports: [],
        },
        // El sprite_hash que el cliente leía, vuelto por un guion de QA.
        {
          path: "qa/guiones/99-x.mjs",
          text: "const h = effect.data.sprite_hash;\n",
          imports: [],
        },
        // Los *_cache_dir de la config, por el snapshot commiteado.
        {
          path: "nefan-core/data/runtime_config.json",
          text: '{\n  "cache_root": "cache",\n  "texture_cache_dir": "x"\n}\n',
          imports: [],
        },
        // El directorio de un kind muerto, escrito a mano en Python.
        {
          path: "ai_server/x.py",
          text: 'AssetCache(cache_dir="cache/textures", asset_type="texture")\n',
          imports: [],
        },
        // La familia del snapshot del save, por un test que la resucite.
        {
          path: "nefan-core/test/x.test.ts",
          text: "s1.setAssetIndexSnapshot([]);\nassert.equal(s2.asset_index_snapshot.length, 0);\n",
          imports: [],
        },
        // Las tablas del lector de blobs y su literal de error.
        {
          path: "nefan-core/services/asset-store/blob-store.ts",
          text: 'const TEXTURE_MAPS = new Set(["albedo"]);\nreturn text(400, "Invalid map type");\n',
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "ai_server/x.py:1",
        "narrative-mcp/ws-bridge.ts:2",
        "nefan-core/data/runtime_config.json:3",
        "nefan-core/services/asset-store/blob-store.ts:1",
        "nefan-core/services/asset-store/blob-store.ts:2",
        "nefan-core/src/plugins/types.ts:2",
        "nefan-core/test/x.test.ts:1",
        "nefan-core/test/x.test.ts:2",
        "qa/guiones/99-x.mjs:1",
      ],
      "cada familia retirada en T4 tiene que saltar en el proceso donde vivía",
    );

    // Y lo vivo que se parece, callado: `cache/sprite_sheets` (sprite-forge),
    // el kind `surface`, `roughness`/`billboard` como vocabulario de three.js
    // y `sprite_sheet` en el guion 21.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/services/asset-store/config.ts",
          text: "spriteSheetsDir: abs(`${ai.cache_root}/sprite_sheets`),\nsurfaceDir: abs(ai.surface_cache_dir),\n",
          imports: [],
        },
        {
          path: "nefan-html/src/renderer/fps-gl.ts",
          text: "material.roughness = 0.8;\nconst billboard = new Sprite();\n",
          imports: [],
        },
        {
          path: "qa/guiones/21-x.mjs",
          text: "const HOJA_VESTIDA = /\\/cache\\/sprite_sheet\\//;\n",
          imports: [],
        },
      ]),
      [],
      "los términos son compuestos para no morder lo vivo",
    );
  });

  // La regla de casts cubre desde T4 los tres árboles de nefan-core que no son
  // test/: el cast que se tipó en prune.ts tiene que saltar si vuelve, y los
  // 14 casts legítimos de test/ sobre servidores fake tienen que seguir fuera.
  it("[error] las-respuestas-de-red-no-se-redefinen-en-linea: cubre src, bridge y services de nefan-core; test/ queda fuera", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter(
        (v) => v.ruleId === "las-respuestas-de-red-no-se-redefinen-en-linea",
      );
    const cast = "body = (await res.json()) as { refs?: unknown };\n";
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-core/services/asset-store/prune.ts", text: cast, imports: [] },
        { path: "nefan-core/src/narrative/ai-client.ts", text: cast, imports: [] },
        { path: "nefan-core/bridge/handlers/x.ts", text: cast, imports: [] },
        { path: "nefan-core/test/x.test.ts", text: cast, imports: [] },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-core/bridge/handlers/x.ts:1",
        "nefan-core/services/asset-store/prune.ts:1",
        "nefan-core/src/narrative/ai-client.ts:1",
      ],
      "el cast anónimo salta en los tres árboles de producción y no en test/",
    );
  });

  // La decisión (1) de #357: la dirección entre el banco de pruebas y el
  // código es test → banco. Se le enseña el import desde cada árbol de
  // producción y herramientas, y los dos árboles que lo importan
  // legítimamente — que callen es la mitad del candado.
  it("[error] el-banco-no-entra-en-produccion: importar qa/ desde producción o scripts salta; desde test/ y labs/ no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "el-banco-no-entra-en-produccion");
    const banco = (spec: string) => [{ spec, line: 3 }];
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-core/src/x.ts", text: "", imports: banco("../../qa/lib/stack.mjs") },
        { path: "nefan-core/bridge/handlers/x.ts", text: "", imports: banco("../../../qa/lib/puertos.mjs") },
        { path: "nefan-core/services/asset-store/x.ts", text: "", imports: banco("../../../qa/lib/sesion.mjs") },
        { path: "nefan-core/scripts/x.ts", text: "", imports: banco("../../qa/lib/veredictos.mjs") },
        { path: "nefan-html/src/ui/x.ts", text: "", imports: banco("../../../qa/lib/fixtures.mjs") },
        { path: "narrative-mcp/x.ts", text: "", imports: banco("../qa/lib/stack.mjs") },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "narrative-mcp/x.ts:3",
        "nefan-core/bridge/handlers/x.ts:3",
        "nefan-core/scripts/x.ts:3",
        "nefan-core/services/asset-store/x.ts:3",
        "nefan-core/src/x.ts:3",
        "nefan-html/src/ui/x.ts:3",
      ],
      "el import del banco salta en los seis árboles de producción y herramientas",
    );
    // Los tests lo miden (test → banco) y los labs SON banco; y un módulo que
    // solo se LLAMA qa-algo no es el directorio del banco.
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-core/test/x.test.ts", text: "", imports: banco("../../qa/lib/stack.mjs") },
        { path: "labs/narrative/x.ts", text: "", imports: banco("../../qa/lib/puertos.mjs") },
        { path: "nefan-core/src/x.ts", text: "", imports: banco("./qa-helpers.js") },
      ]),
      [],
      "test/ y labs/ importan el banco legítimamente; `qa-helpers` no es `qa/`",
    );
  });

  // La hermana por TEXTO (H3 de QA #454): la forma sin especificador con la
  // que el repo carga el banco. Se le enseñan las tres formas dinámicas, la
  // partida en tres líneas, y lo que tiene que callar: test/, labs/ y un
  // COMENTARIO que nombra `qa/lib/…` — que es lo que hay hoy en dos scripts.
  it("[error] el-banco-no-entra-en-produccion-ni-por-join: import(join(…\"qa\",\"lib\"…)) y require saltan; el comentario no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "el-banco-no-entra-en-produccion-ni-por-join");
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/x.ts",
          text: 'const m = await import(join(process.cwd(), "..", "qa", "lib", "stack.mjs"));\n',
          imports: [],
        },
        {
          path: "nefan-core/scripts/x.ts",
          text: 'const { offsetActual } = (await import(\n  join(repoRoot, "qa", "lib", "stack.mjs")\n)) as X;\n',
          imports: [],
        },
        { path: "nefan-html/src/x.ts", text: 'const m = await import("../../qa/lib/sonda.mjs");\n', imports: [] },
        { path: "narrative-mcp/x.ts", text: 'const m = require("../qa/lib/puertos.mjs");\n', imports: [] },
      ]).map((v) => `${v.path}:${v.line}`),
      ["narrative-mcp/x.ts:1", "nefan-core/scripts/x.ts:1", "nefan-core/src/x.ts:1", "nefan-html/src/x.ts:1"],
      "las tres formas dinámicas de cargar el banco saltan en producción y herramientas",
    );
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-core/test/x.test.ts", text: 'await import(join(repoRoot, "qa", "lib", "stack.mjs"));\n', imports: [] },
        { path: "labs/x.ts", text: 'await import(join(repoRoot, "qa", "lib", "stack.mjs"));\n', imports: [] },
        // Los dos comentarios verdaderos que hay hoy en scripts/, tal cual.
        { path: "nefan-core/scripts/dump-config.ts", text: " * (`portOffset` en TS, `qa/lib/stack.mjs` en el banco, `start.sh` en bash).\n", imports: [] },
        { path: "nefan-core/scripts/salud-sprite-forge.ts", text: " *  `qa/lib/presets-clasifica.mjs`, y por la misma razón\n", imports: [] },
        // Y un join de otra cosa con "qa" dentro.
        { path: "nefan-core/src/y.ts", text: 'const d = join(raiz, "qa", "capturas");\n', imports: [] },
      ]),
      [],
      "test/, labs/, la prosa que nombra el banco y un join ajeno callan",
    );
  });

  // El campo `scattered` y las PRIMITIVAS del esquema entran en dos reglas que
  // ya existían; sin verlas saltar sobre el término nuevo, añadirlo al patrón
  // es una lista que nadie ha probado.
  it("[error] la-fisica-no-se-copia-a-mano: re-declarar un cuerpo salta; leerlo del snapshot no", () => {
    const fisica = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "la-fisica-no-se-copia-a-mano");

    // Las cuatro formas de volver a escribir el número, en los dos lenguajes
    // que no pueden importar de core. Es la copia que hubo que retirar de
    // narrative_schemas.py, escrita otra vez.
    assert.deepEqual(
      fisica([
        {
          path: "ai_server/narrative_schemas.py",
          text: "TILE_MPC = 0.5\nNPC_RADIUS_M = 0.5\nPLAYER_RADIUS_M = 0.4\n",
          imports: [],
        },
        {
          path: "qa/guiones/99-lo-que-sea.mjs",
          text: "const BODY_RADIUS_M = 0.5;\n",
          imports: [],
        },
        {
          path: "labs/narrative/fake-ai-server.ts",
          text: "const cuerpo = { NPC_RADIUS_M: 0.5 };\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "ai_server/narrative_schemas.py:1",
        "ai_server/narrative_schemas.py:2",
        "ai_server/narrative_schemas.py:3",
        "labs/narrative/fake-ai-server.ts:1",
        "qa/guiones/99-lo-que-sea.mjs:1",
      ],
      "re-declarar un cuerpo del simulador fuera de su fuente salta en los cinco procesos escaneados",
    );

    // Vecinos inocentes: LEER el snapshot, o nombrar la constante sin
    // asignarle un número, es justo lo que la regla quiere que se haga.
    assert.deepEqual(
      fisica([
        {
          path: "ai_server/narrative_schemas.py",
          text: 'TILE_MPC = _PHYSICS["tile_mpc"]\nFOOTPRINT_MAX = dict(_PHYSICS["footprint_max_cells"])\n',
          imports: [],
        },
        {
          path: "qa/guiones/99-lo-que-sea.mjs",
          text: "// el radio del jugador (PLAYER_RADIUS_M) lo infla probeCollide\n",
          imports: [],
        },
      ]),
      [],
    );
  });

  // Hermana de la anterior una capa más arriba: allí es un número de física
  // re-escrito, aquí es DÓNDE escucha un servicio compuesto a mano en el único
  // proceso que no puede saberlo del snapshot. Sobre el árbol de hoy la regla
  // está verde —#341 se llevó su única ocurrencia—, así que hay que enseñarle
  // el texto que existe para cortar.
  it("[error] el-cliente-no-lee-el-puerto-del-snapshot: componer el puerto salta; leer el resto del snapshot no", () => {
    const puerto = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter(
        (v) => v.ruleId === "el-cliente-no-lee-el-puerto-del-snapshot",
      );

    // Literalmente la línea que había hasta #341, y la otra vía de llegar al
    // mismo sitio (el derivador del registro, sin pasar por `serviceUrl`).
    assert.deepEqual(
      puerto([
        {
          path: "nefan-html/src/net/game-client.ts",
          text:
            "const msg = `bridge did not connect within ${timeoutMs}ms — is nefan-core bridge " +
            "running on ws://localhost:${CONFIG.ports.bridge}?`;\n",
          imports: [],
        },
        {
          path: "nefan-html/src/main.ts",
          text: "// dos líneas antes\n\nconst p = portOf('game-gateway', {});\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      ["nefan-html/src/main.ts:3", "nefan-html/src/net/game-client.ts:1"],
      "componer a mano el puerto de un servicio en el cliente salta, venga del snapshot o del derivador",
    );

    // Vecinos inocentes, y son los tres que hay hoy en el árbol: leer OTRA
    // cosa del snapshot, citar la URL efectiva del socket, y el comentario de
    // `service-urls.ts` —el fichero que sí tiene que hablar de puertos—.
    assert.deepEqual(
      puerto([
        {
          path: "nefan-html/src/net/game-client.ts",
          text:
            "if (!CONFIG.session.require_bridge) {\n" +
            "  const msg = `bridge did not connect within ${timeoutMs}ms — ${bridge.url}`;\n}\n",
          imports: [],
        },
        {
          path: "nefan-html/src/net/service-urls.ts",
          text: " * (SERVICES.currentPort del contrato). */\nreturn resolveServiceUrl(name, envFromQuery());\n",
          imports: [],
        },
      ]),
      [],
    );
  });

  it("[error] scattered y las primitivas del esquema no vuelven al cliente", () => {
    const retirados = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "campos-retirados-no-vuelven");
    const cliente = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "cliente-no-convierte-celdas-a-metros");

    // `scattered`: la marca de las entities que estampaba la ruta B. Vuelve por
    // un dump viejo o por un saneador que la reinyecte, no escribiendo código.
    assert.deepEqual(
      retirados([
        {
          path: "nefan-core/src/scene/blueprint/derive.ts",
          text: "function isScatterEntity(ent: RawEntity): boolean {\n  return ent.scattered === true;\n}\n",
          imports: [],
        },
        {
          path: "ai_server/narrative_schemas.py",
          text: 'ent["scattered"] = True\n',
          imports: [],
        },
        {
          path: "nefan-core/data/scenes/robledo_tile.json",
          text: '{\n  "id": "pino_z0_3",\n  "scattered": true\n}\n',
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "ai_server/narrative_schemas.py:1",
        "nefan-core/data/scenes/robledo_tile.json:3",
        "nefan-core/src/scene/blueprint/derive.ts:2",
      ],
      "el campo de la ruta retirada salta en cualquiera de los procesos escaneados",
    );

    // Y las primitivas del esquema en el CLIENTE: leerlas es componer el plan
    // por su cuenta, que es la misma frontera que prohíbe convertir celdas.
    assert.deepEqual(
      cliente([
        {
          path: "nefan-html/src/main.ts",
          text: "const zonas = raw.vegetation_zones;\nconst mpc = raw.meters_per_cell;\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      ["nefan-html/src/main.ts:1", "nefan-html/src/main.ts:2"],
    );

    // Vecino inocente: el plan RESUELTO no nombra primitivas, y el cliente
    // puede seguir leyéndolo.
    assert.deepEqual(
      cliente([
        { path: "nefan-html/src/main.ts", text: "const plan = data.__plan;\n", imports: [] },
      ]),
      [],
    );
  });

  // Es EL criterio de la operación "solo la vista 3D": un único importador de
  // three en el cliente ⇒ un único contexto WebGL en la pestaña. Probado en
  // negativo contra la config real, porque la regla verde de hoy no distingue
  // "nadie más importa three" de "la excepción se comió la regla".
  // Nace VERDE (el último sleep, `esperarPeticiones` del guion 07, muere en la
  // misma PR), y una regla verde no demuestra nada por sí sola: se le enseña lo
  // que existe para cortar y lo que NO debe cortar.
  it("[error] qa-guiones-sin-espera-por-reloj: el sleep salta, el muestreo por frame no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "qa-guiones-sin-espera-por-reloj");

    // Las dos formas de dormir que había o podía haber en un guion.
    assert.deepEqual(
      deLaRegla([
        {
          // Literalmente `esperarPeticiones`, que muere en esta PR.
          path: "qa/guiones/07-npc-clave-del-skin.mjs",
          text: "while (Date.now() - t0 < maxMs) {\n  await ctx.page.waitForTimeout(200);\n}\n",
          imports: [],
        },
        {
          path: "qa/guiones/99-inventado.mjs",
          text: "// deja que respire\nawait new Promise((r) => setTimeout(r, 500));\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      ["qa/guiones/07-npc-clave-del-skin.mjs:2", "qa/guiones/99-inventado.mjs:2"],
      "un guion que duerme tiene que saltar, escriba el sleep como lo escriba",
    );

    // Y lo que NO es esperar por reloj: el bucle de muestreo por frame del
    // guion 10 (mide opacidades del velo y para por ESTADO, con un tope solo
    // de cortafuegos), y el runner, que necesita su polling y está fuera del
    // alcance de la regla a propósito.
    assert.deepEqual(
      deLaRegla([
        {
          path: "qa/guiones/10-fps-telegraph-etiquetas-y-niebla.mjs",
          text: "const tick = () => {\n  if (llegada && v === null) return res(ok);\n  setTimeout(tick, 16);\n};\n",
          imports: [],
        },
        { path: "qa/run.mjs", text: "await new Promise((r) => setTimeout(r, 150));\n", imports: [] },
        { path: "qa/lib/sesion.mjs", text: "await new Promise((r) => setTimeout(r, 5));\n", imports: [] },
      ]),
      [],
      "medir por frame no es dormir, y el runner queda fuera de la regla",
    );
  });

  // Nace VERDE: al extraer la cadena a migrate.ts, los dos únicos sitios que
  // nombran runMigrationStep en producción son su definición y su juez. Una
  // regla que solo se ha visto verde no distingue "nadie duplica la cadena" de
  // "el patrón no caza nada", así que se le enseña el segundo juez que existe
  // para cortar —el `if` local en register.ts que la tarea pedía a gritos— y
  // los dos dueños, callados.
  it("[error] cadena-de-migracion-unica: un segundo juez del salto de versión salta", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "cadena-de-migracion-unica");

    assert.deepEqual(
      deLaRegla([
        {
          // Exactamente la tentación: resolver el caso runtime aquí en vez de
          // preguntarle a migrate.ts.
          path: "nefan-core/src/plugins/register.ts",
          text:
            'import { runMigrationStep } from "./dsl/evaluate.js";\n' +
            "const slice = runMigrationStep(effects, ctx);\n",
          imports: [{ spec: "./dsl/evaluate.js", line: 1 }],
        },
        {
          path: "nefan-core/bridge/handlers/session.ts",
          text: "// resume rápido\nslice = runMigrationStep(m.migrate[v], ctx);\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-core/bridge/handlers/session.ts:2",
        "nefan-core/src/plugins/register.ts:1",
        "nefan-core/src/plugins/register.ts:2",
      ],
      "quien ejecute la cadena fuera de migrate.ts tiene que saltar, sea core o bridge",
    );

    // Los dos dueños: el intérprete que la define y el juez que la usa.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/plugins/dsl/evaluate.ts",
          text: "export function runMigrationStep(effects: Effect[], ctx: DslContext): unknown {\n",
          imports: [],
        },
        {
          path: "nefan-core/src/plugins/migrate.ts",
          text: "slice = runMigrationStep(effects, { slice, ...ctxExtras });\n",
          imports: [],
        },
      ]),
      [],
    );
  });

  it("[error] three-solo-en-fps-gl: cualquier otro importador de three salta", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "three-solo-en-fps-gl");

    // Los tres sitios que importaban three hasta esta PR (el clay del plató,
    // el del tile) más un fichero nuevo cualquiera.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/scene/stage-greybox-render.ts",
          text: "",
          imports: [{ spec: "three", line: 4 }],
        },
        {
          path: "nefan-html/src/scene/tile-greybox-render.ts",
          text: "",
          imports: [{ spec: "three/addons/loaders/GLTFLoader.js", line: 9 }],
        },
        {
          path: "nefan-html/src/ui/portrait.ts",
          text: "",
          imports: [{ spec: "three", line: 2 }],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-html/src/scene/stage-greybox-render.ts:4",
        "nefan-html/src/scene/tile-greybox-render.ts:9",
        "nefan-html/src/ui/portrait.ts:2",
      ],
    );

    // Y el dueño, callado — con el subpath de addons incluido.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/renderer/fps-gl.ts",
          text: "",
          imports: [
            { spec: "three", line: 17 },
            { spec: "three/examples/jsm/controls/OrbitControls.js", line: 18 },
          ],
        },
      ]),
      [],
    );
  });

  // #411: la regla que hasta aquí decía «cliente 2D» y toleraba `max: 2` sin
  // nombrar cuáles eran las dos. Ahora las nombra como exenciones CON
  // `funcion` y es error: una tercera puerta en cualquier otro fichero del
  // cliente salta, las dos nombradas callan mientras sean UNA llamada dentro
  // de su función, y una segunda llamada en el mismo fichero —o una puerta
  // que deja de llamar— también salta (QA-C de T13 lo encontró: la exención
  // por fichero dejaba las dos cosas en verde). El caso de UNA sola puerta no
  // distingue la regla de su contraria («ningún fichero del cliente salta»),
  // así que van las dos, y cada negativo lleva su positivo al lado.
  it("[error] solo-el-bridge-normaliza-la-escena: una tercera puerta salta; las dos nombradas callan si son UNA llamada dentro de su función", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files)
        .filter((v) => v.ruleId === "solo-el-bridge-normaliza-la-escena")
        .map((v) => `${v.path}:${v.line} [${v.severity}] ${v.detail}`);

    // La regla, tal como está: error, sin contador, sin «2D», dos puertas con función.
    const regla = config.rules.find((r) => r.id === "solo-el-bridge-normaliza-la-escena")!;
    assert.equal(regla.severity, "error");
    assert.equal(regla.max, undefined, "volvió el contador sin nombres");
    assert.doesNotMatch(regla.desc + regla.why, /\b2D\b/, "el cliente 2D se retiró el 2026-08-22");
    assert.deepEqual(
      regla.exceptions.map((e) => [e.path, e.funcion]),
      [
        ["nefan-html/src/main.ts", "addTileRaw"],
        ["nefan-html/src/ui/style-apply.ts", "StyleApplyController.plan"],
      ],
    );

    // Las dos puertas tal como están escritas hoy (misma forma que el árbol).
    const MAIN = [
      "const addTile = cargaDeTile.addTile;",
      "const addTileRaw = (raw: Record<string, unknown>, opts?: OpcionesDeCarga) => addTile({ ...formatDToWorld(raw), exits: [] }, opts);",
      "",
    ].join("\n");
    const STYLE = [
      "export class StyleApplyController {",
      "  private ledger: StyleRunLedger | null = null;",
      "",
      "  async plan(gameId: string, styleId: string): Promise<StyleApplyPlan> {",
      "    const normalizadas = new Map<string, WorldScene>();",
      "    for (const [sceneId, scene] of scenes) normalizadas.set(sceneId, formatDToWorld(scene));",
      "    return { cells: [] };",
      "  }",
      "",
      "  async run(plan: StyleApplyPlan): Promise<void> {",
      "    void plan;",
      "  }",
      "}",
      "",
    ].join("\n");
    const puertas: SourceFile[] = [
      { path: "nefan-html/src/main.ts", text: MAIN, imports: [] },
      { path: "nefan-html/src/ui/style-apply.ts", text: STYLE, imports: [] },
    ];
    assert.deepEqual(deLaRegla(puertas), [], "las dos puertas, UNA llamada cada una dentro de su función, callan");

    // Una tercera puerta: el fichero que más cerca está de tentarlo (recibe
    // la escena del wire), otro cualquiera, y el vecino del eximido —nombrar
    // `ui/style-apply.ts` no exime a `ui/style-apply-preview.ts`.
    assert.deepEqual(
      deLaRegla([
        ...puertas,
        { path: "nefan-html/src/world/carga-de-tile.ts", text: "const world = formatDToWorld(msg.scene);\n", imports: [] },
        { path: "nefan-html/src/ui/title-screen.ts", text: "preview.set(id, formatDToWorld (raw));\n", imports: [] },
        { path: "nefan-html/src/ui/style-apply-preview.ts", text: "formatDToWorld(x)\n", imports: [] },
      ]),
      [
        'nefan-html/src/ui/style-apply-preview.ts:1 [error] patrón prohibido: "formatDToWorld("',
        'nefan-html/src/ui/title-screen.ts:1 [error] patrón prohibido: "formatDToWorld ("',
        'nefan-html/src/world/carga-de-tile.ts:1 [error] patrón prohibido: "formatDToWorld("',
      ],
      "una normalización local fuera de las dos puertas es un tercer camino hasta la world scene",
    );

    // G1 · una SEGUNDA llamada en el fichero eximido: antes entraba gratis.
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-html/src/main.ts", text: MAIN + "const __segunda = formatDToWorld({} as never);\n", imports: [] },
      ]),
      ["nefan-html/src/main.ts:3 [error] fuera de la puerta `addTileRaw`: esta llamada vive en `__segunda`"],
    );
    // …y dos DENTRO de la misma función tampoco: la puerta es UNA llamada.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/main.ts",
          text: "const addTileRaw = (raw) => addTile({ ...formatDToWorld(raw), otra: formatDToWorld(raw) });\n",
          imports: [],
        },
      ]),
      ["nefan-html/src/main.ts:1 [error] la puerta `addTileRaw` es UNA llamada; esta es la 2ª"],
    );

    // G2 · la función nombrada deja de llamar: exención sin sujeto, no barra libre.
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-html/src/main.ts", text: "const addTileRaw = (raw) => addTile(raw as WorldScene);\n", imports: [] },
      ]),
      [
        `nefan-html/src/main.ts:1 [error] exención sin sujeto: \`addTileRaw\` ya no casa ${JSON.stringify(regla.text!.pattern)} en este fichero — borra la exención o vuelve a nombrar la puerta`,
      ],
    );

    // G4 · la puerta se renombra: la llamada ya no vive donde dice el JSON.
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-html/src/main.ts", text: MAIN.replace("addTileRaw =", "addTileRaw2 ="), imports: [] },
      ]),
      ["nefan-html/src/main.ts:2 [error] fuera de la puerta `addTileRaw`: esta llamada vive en `addTileRaw2`"],
    );

    // G5 · la llamada se mueve de `plan()` a `run()` de la misma clase.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/ui/style-apply.ts",
          text: STYLE.replace("    for (const [sceneId, scene] of scenes) normalizadas.set(sceneId, formatDToWorld(scene));\n", "").replace(
            "    void plan;",
            "    void formatDToWorld(plan);",
          ),
          imports: [],
        },
      ]),
      ["nefan-html/src/ui/style-apply.ts:10 [error] fuera de la puerta `StyleApplyController.plan`: esta llamada vive en `StyleApplyController.run`"],
    );
    // …y el mismo método `plan` en OTRA clase tampoco es la puerta.
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-html/src/ui/style-apply.ts", text: STYLE.replace("class StyleApplyController", "class StylePreview"), imports: [] },
      ]),
      ["nefan-html/src/ui/style-apply.ts:6 [error] fuera de la puerta `StyleApplyController.plan`: esta llamada vive en `StylePreview.plan`"],
    );
  });

  // El candado que sustituye a la prosa del criterio de aceptación de #225
  // («cada pieza se invoca sin levantar un servidor HTTP»). Hace falta porque
  // `bridge/` NO está en el reparto de mutación: nada más lo demuestra. Y
  // hace falta probarlo en negativo por partida doble — sobre el árbol de hoy
  // está verde, y una regla verde no demuestra nada: la primera versión de
  // estos handlers la puso ROJA por los COMENTARIOS que nombraban los tipos
  // del transporte, así que se sabe que caza texto de verdad.
  it("[error] handlers-sin-servidor: las cuatro formas de volver a atar un handler al transporte saltan", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "handlers-sin-servidor");

    // Las cuatro: el import del módulo, los dos tipos y el constructor. Da
    // igual si entran por un import, por una firma o por un parámetro
    // posicional — que es como estaban en el `handle` de 441 líneas.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/bridge/state-http/map-routes.ts",
          text: 'import type { IncomingMessage } from "node:http";\n',
          imports: [{ spec: "node:http", line: 1 }],
        },
        {
          path: "nefan-core/bridge/state-http/dispatch.ts",
          text: "function despacha(req: IncomingMessage, res: ServerResponse) {}\n",
        },
        {
          path: "nefan-core/bridge/state-http/npc-routes.ts",
          text: "const s = createServer((req, res) => {});\n",
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        // Dos aciertos por línea donde el import trae ADEMÁS el tipo: el
        // patrón caza los dos términos, y así se ve que no es uno solo el que
        // está haciendo todo el trabajo.
        "nefan-core/bridge/state-http/dispatch.ts:1",
        "nefan-core/bridge/state-http/dispatch.ts:1",
        "nefan-core/bridge/state-http/map-routes.ts:1",
        "nefan-core/bridge/state-http/map-routes.ts:1",
        "nefan-core/bridge/state-http/npc-routes.ts:1",
      ],
    );

    // Y los dos inocentes: el transporte, que es donde ESO tiene que vivir, y
    // un handler que solo habla de su contexto.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/bridge/state-http-server.ts",
          text: 'import { createServer, type IncomingMessage, type ServerResponse } from "node:http";\n',
          imports: [{ spec: "node:http", line: 1 }],
        },
        {
          path: "nefan-core/bridge/state-http/entity-routes.ts",
          text: "export const entityRoutes = { getEntity: (ctx, { params }) => ok(ctx.narrative.getEntity(params.id)) };\n",
        },
      ]),
      [],
    );
  });

  // Regla NUEVA y a cero: el verde de hoy no demuestra nada, porque no hay
  // ocupante que la ponga roja. La primera versión del patrón pedía
  // `window.addEventListener("keydown"` literal y se quedaba verde con SIETE
  // formas alcanzables — todas las de abajo menos la primera. Cada una es un
  // manejador de tecla de juego que respondería con el título delante, y las
  // ocho salieron de tres pasadas sucesivas sobre el mismo patrón: la lista
  // creció cada vez, que es justo el motivo por el que el candado FUERTE de
  // este invariante es el `no-restricted-syntax` de `nefan-html`, que mira el
  // AST. Este test defiende el alcance que la regla DECLARA tener.
  it("[error] teclas-de-juego-pasan-por-la-puerta: las ocho formas de registrar input saltan", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter(
        (v) => v.ruleId === "teclas-de-juego-pasan-por-la-puerta",
      );

    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/ui/uno.ts",
          text: 'window.addEventListener("keydown", f);\n',
        },
        // Comillas simples: nada obliga a dobles. `eslint-config-prettier`
        // desactiva las reglas de estilo y el CI no corre prettier.
        {
          path: "nefan-html/src/ui/dos.ts",
          text: "window.addEventListener('keydown', f);\n",
        },
        // El idioma MÁS común, y el que la primera versión no veía.
        {
          path: "nefan-html/src/ui/tres.ts",
          text: 'document.addEventListener("keydown", f);\n',
        },
        {
          path: "nefan-html/src/ui/cuatro.ts",
          text: 'document.body.addEventListener("mousedown", f);\n',
        },
        // La propiedad, sin `addEventListener` de por medio.
        {
          path: "nefan-html/src/ui/cinco.ts",
          text: "window.onkeydown = (e) => manejar(e);\n",
        },
        // Multilínea: lo que prettier produce con un manejador de nombre
        // largo. El patrón admite el salto de línea tras el paréntesis.
        {
          path: "nefan-html/src/ui/seis.ts",
          text: 'window.addEventListener(\n  "mousedown",\n  elManejadorDeAtaqueDelJugador,\n);\n',
        },
        // Las dos que encontró QA en la tercera pasada: el `window` implícito
        // —la forma más corta que alguien escribe sin pensar— y `globalThis`.
        {
          path: "nefan-html/src/ui/siete.ts",
          text: 'addEventListener("keydown", f);\n',
        },
        {
          path: "nefan-html/src/ui/ocho.ts",
          text: 'globalThis.addEventListener("keydown", f);\n',
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-html/src/ui/cinco.ts:1",
        "nefan-html/src/ui/cuatro.ts:1",
        "nefan-html/src/ui/dos.ts:1",
        "nefan-html/src/ui/ocho.ts:1",
        "nefan-html/src/ui/seis.ts:1",
        "nefan-html/src/ui/siete.ts:1",
        "nefan-html/src/ui/tres.ts:1",
        "nefan-html/src/ui/uno.ts:1",
      ],
      "las ocho formas de registrar una tecla de juego por fuera de la puerta tienen que saltar",
    );

    // Y los inocentes, que son los que la regla declara dejar fuera A
    // PROPÓSITO: la soltada (gatearla dejaría al jugador andando solo al
    // volver del título), la mirada, un listener sobre un ELEMENTO con foco
    // —el texto libre del diálogo— y la propia puerta.
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-html/src/ui/a.ts", text: 'window.addEventListener("keyup", f);\n' },
        { path: "nefan-html/src/ui/b.ts", text: 'window.addEventListener("mousemove", f);\n' },
        { path: "nefan-html/src/ui/c.ts", text: 'this.inputEl.addEventListener("keydown", f);\n' },
        // Un listener sobre un elemento con el receptor CORTO: el `(?<![.\\w])`
        // de la forma a secas tiene que dejarlo pasar, o la regla se comería
        // los controles con foco que el título necesita vivos.
        { path: "nefan-html/src/ui/d.ts", text: 'el.addEventListener("keydown", f);\n' },
        {
          path: "nefan-html/src/input/puerta-de-teclado.ts",
          text: 'window.addEventListener("keydown", conPuerta);\n',
        },
      ]),
      [],
    );
  });

  // Regla NUEVA y a cero fuera de su única excepción: el verde de hoy no
  // demuestra nada mientras no se vea saltar. Lo que defiende es la
  // ATRIBUCIÓN del titular — la mitad que `tsc` no puede candar, porque
  // escribir `kind: "consequences"` compila desde cualquier handler y es
  // exactamente por donde llegaron los seis mentirosos de #352.
  it("[error] ningun-aviso-culpa-al-motor: un aviso que se atribuye al motor salta; los kinds honestos no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "ningun-aviso-culpa-al-motor");

    assert.deepEqual(
      deLaRegla([
        // Los seis emisores de #352, tal y como estaban escritos el día que se
        // midieron. Cada uno cuenta un hecho distinto bajo el mismo titular.
        {
          path: "nefan-core/bridge/handlers/session.ts",
          text: 'ctx.broadcastNarrative({\n  phase: "error",\n  kind: "consequences",\n  message: avisoDeIlegibles(x),\n});\n',
        },
        {
          path: "nefan-core/bridge/handlers/simulation.ts",
          text: 'ctx.broadcastNarrative({ phase: "error", kind: "consequences", message: "no se pudo guardar" });\n',
        },
        {
          path: "nefan-core/bridge/context.ts",
          text: 'ctx.broadcastNarrative({ phase: "error", kind: "consequences", message: plugin });\n',
        },
        {
          path: "nefan-core/bridge/router.ts",
          text: 'return { a: "difusion", frame: { phase: "error", kind: "consequences" } };\n',
        },
        // Sin espacio tras los dos puntos: nada obliga a escribirlo con él, y
        // un patrón que pidiera `kind: "` literal dejaría pasar esta.
        {
          path: "nefan-core/bridge/handlers/scene.ts",
          text: 'broadcast({ kind:"consequences" });\n',
        },
        // Con el salto de línea que mete prettier cuando el objeto es largo.
        {
          path: "nefan-core/bridge/ws-server.ts",
          text: 'ctx.broadcastNarrative({\n  type: "narrative_status",\n  phase: "ready",\n  kind:\n    "consequences",\n});\n',
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-core/bridge/context.ts:1",
        "nefan-core/bridge/handlers/scene.ts:1",
        "nefan-core/bridge/handlers/session.ts:3",
        "nefan-core/bridge/handlers/simulation.ts:1",
        "nefan-core/bridge/router.ts:1",
        "nefan-core/bridge/ws-server.ts:4",
      ],
      "los seis emisores que culpaban al motor tienen que saltar, con y sin espacio y partidos en dos líneas",
    );

    // Y los inocentes: los cinco kinds que la tanda repartió —cada uno con su
    // hecho— y el único sitio donde `consequences` es cierto. Sin este
    // segundo bloque la regla podría estar prohibiendo el campo `kind` entero
    // y el primero saldría igual de verde.
    assert.deepEqual(
      deLaRegla([
        { path: "nefan-core/bridge/handlers/session.ts", text: 'kind: "restore",\n' },
        { path: "nefan-core/bridge/handlers/dialogue.ts", text: 'kind: "takeover",\n' },
        { path: "nefan-core/bridge/handlers/simulation.ts", text: 'kind: "save",\n' },
        { path: "nefan-core/bridge/context.ts", text: 'kind: "plugin",\n' },
        { path: "nefan-core/bridge/router.ts", text: 'kind: "action",\n' },
        { path: "nefan-core/bridge/handlers/tile.ts", text: 'kind: "tile",\n' },
        // El rechazo REAL del motor, en el fichero exceptuado: es el hecho que
        // el titular describe, y por eso sigue siendo legal.
        {
          path: "nefan-core/bridge/handlers/dialogue.ts",
          text: 'ctx.broadcastNarrative({ phase: "error", kind: "consequences", message: `Narrative engine error: ${e}` });\n',
        },
      ]),
      [],
    );
  });

  // La deuda congelada es la que más fácil se pudre: `max` se baja en la PR
  // que arregla un catch, y nadie vuelve a comprobar que el patrón siga
  // cazando los que quedan. Probado en negativo con las DOS formas que el
  // repo produce —el bloque vacío y el `.catch(() => {})`— y con el vecino
  // inocente: un catch que sí hace algo no cuenta como deuda.
  it("[deuda] html-sin-catch-silencioso: las dos formas de tragarse un error saltan", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "html-sin-catch-silencioso");

    assert.deepEqual(
      deLaRegla([
        { path: "nefan-html/src/scene/x.ts", text: "try {\n  f();\n} catch {}\n", imports: [] },
        { path: "nefan-html/src/ui/y.ts", text: "void p.catch(() => {});\n", imports: [] },
        // Un comentario dentro NO lo salva: documentar lo que se traga sigue
        // siendo tragárselo sin canal (es la deuda que queda congelada).
        {
          path: "nefan-html/src/ui/z.ts",
          text: "try {\n  f();\n} catch {\n  // degradación esperable\n}\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      ["nefan-html/src/scene/x.ts:3", "nefan-html/src/ui/y.ts:1", "nefan-html/src/ui/z.ts:3"],
    );

    // Y el catch con canal, callado: es exactamente lo que la regla pide.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/scene/x.ts",
          text: 'try {\n  f();\n} catch (err) {\n  errors.push("x", "falló", err);\n}\n',
          imports: [],
        },
        { path: "nefan-html/src/ui/y.ts", text: 'void p.catch((err) => errors.push("y", "falló", err));\n', imports: [] },
      ]),
      [],
    );
  });

  // Regla NUEVA que nace VERDE porque sus tres ocupantes —las 3 únicas
  // violaciones literales del patrón en el repo entero— se arreglaron en la
  // misma PR que la arma (2026-09-01). Una regla verde no demuestra nada, así
  // que se le enseña LITERALMENTE lo que había: el catch de comentario que
  // envolvía handleClientMessage ENTERO, el probe de takeover y el
  // .catch(() => {}) de postProgress. Y los sustitutos, callados — incluido el
  // tryParse cuyo `return null` es el caso legítimo documentado.
  it("[error] narrative-mcp-sin-catch-silencioso: las tres formas que había saltan; los sustitutos no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter(
        (v) => v.ruleId === "narrative-mcp-sin-catch-silencioso",
      );

    assert.deepEqual(
      deLaRegla([
        {
          // ws-bridge.ts:213 hasta esta PR: el catch que se comía CUALQUIER
          // excepción del despacho como si fuera un frame malformado.
          path: "narrative-mcp/ws-bridge.ts",
          text: "try {\n  const msg: ClientMsg = JSON.parse(String(raw));\n  this.enqueueRequest(msg);\n} catch {\n  // ignore malformed\n}\n",
          imports: [],
        },
        {
          // ws-bridge.ts:118 hasta esta PR: probe legítimo, cuerpo vacío no.
          path: "narrative-mcp/x.ts",
          text: "try {\n  const msg: PeerMsg = JSON.parse(String(raw));\n} catch {\n  // Not a peer message\n}\n",
          imports: [],
        },
        {
          // bridge-http-client.ts:55 hasta esta PR.
          path: "narrative-mcp/bridge-http-client.ts",
          text: "void fetch(url, opts)\n  .catch(() => {})\n  .finally(() => clearTimeout(timer));\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "narrative-mcp/bridge-http-client.ts:2",
        "narrative-mcp/ws-bridge.ts:4",
        "narrative-mcp/x.ts:3",
      ],
      "las tres formas de tragarse un error que tenía narrative-mcp tienen que saltar",
    );

    assert.deepEqual(
      deLaRegla([
        {
          // El tryParse del probe: null SOLO para «no era JSON», y lo juzga
          // handleClientMessage después. Un cuerpo con return no es un catch vacío.
          path: "narrative-mcp/ws-bridge.ts",
          text: "try {\n  return JSON.parse(String(raw)) as PeerMsg;\n} catch {\n  return null;\n}\n",
          imports: [],
        },
        {
          path: "narrative-mcp/x.ts",
          text: "try {\n  f();\n} catch (err) {\n  console.error('[narrative-mcp] error despachando:', err);\n}\n",
          imports: [],
        },
        {
          path: "narrative-mcp/bridge-http-client.ts",
          text: "void fetch(url, opts)\n  .catch((err: unknown) => {\n    console.error('[narrative-mcp] narrative_progress no entregado:', err);\n  })\n  .finally(() => clearTimeout(timer));\n",
          imports: [],
        },
      ]),
      [],
      "el tryParse documentado y los catch con canal son exactamente lo que la regla pide",
    );
  });

  // El root nefan-core/scripts entró el 2026-09-01 MEDIDO A CERO: verde por
  // definición, así que hay que ver saltar el glob — sin esto, añadir el root
  // sería decorativo (ficheros escaneados que ninguna regla mira). Un catch
  // vacío en las herramientas corrompe la MEDIDA (deuda, crap, mutación) sin
  // romper nada visible, y un «script de migrar saves» que ejecute la cadena
  // por su cuenta es el segundo juez que cadena-de-migracion-unica corta.
  it("[error] nefan-core/scripts está escaneado y sus reglas lo miran", () => {
    assert.ok(
      files.some((f) => f.path.startsWith("nefan-core/scripts/")),
      "nefan-core/scripts se cayó de scan.roots — las reglas dejarían de mirar las herramientas",
    );
    assert.deepEqual(
      checkArchitecture(config, [
        {
          path: "nefan-core/scripts/deuda.ts",
          text: "try {\n  medir();\n} catch {}\n",
          imports: [],
        },
        {
          path: "nefan-core/scripts/migrar-saves.ts",
          text: "const slice = runMigrationStep(effects, ctx);\n",
          imports: [],
        },
      ]).map((v) => `${v.ruleId}@${v.path}:${v.line}`),
      [
        "core-sin-catch-silencioso@nefan-core/scripts/deuda.ts:3",
        "cadena-de-migracion-unica@nefan-core/scripts/migrar-saves.ts:1",
      ],
      "las reglas extendidas a scripts tienen que cazar ahí igual que en src/",
    );
  });

  // Regla NUEVA de la familia «un solo escritor por hecho», nace verde el día
  // que las seis asignaciones de los dos handlers se mueven al dueño. Se le
  // enseña la reasignación que había y las CUATRO cosas que declara dejar
  // pasar: el nacimiento del ctx (sin punto), la lectura, la mutación de
  // contenido vía registerRuntimePlugin, la comparación — y el dueño.
  it("[error] los-plugins-activos-tienen-un-solo-escritor: reasignar fuera del dueño salta", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter(
        (v) => v.ruleId === "los-plugins-activos-tienen-un-solo-escritor",
      );

    // Literalmente lo que había en los dos handlers hasta esta PR.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/bridge/handlers/session.ts",
          text: "ctx.activePlugins = new Map();\n",
          imports: [],
        },
        {
          path: "nefan-core/bridge/handlers/game-gen.ts",
          text: "// contexto\nctx.activePlugins = activatePluginsForNewSession(ctx.narrative, manifests);\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-core/bridge/handlers/game-gen.ts:2",
        "nefan-core/bridge/handlers/session.ts:1",
      ],
      "la reasignación suelta en un handler tiene que saltar",
    );

    assert.deepEqual(
      deLaRegla([
        {
          // El NACIMIENTO del contexto: sin punto, y ahí es donde el campo
          // tiene que inicializarse (ws-server.ts y test/helpers.ts).
          path: "nefan-core/bridge/ws-server.ts",
          text: "const ctx: BridgeContext = {\n  activePlugins: new Map(),\n};\n",
          imports: [],
        },
        {
          // Mutar el CONTENIDO del Map vigente es otro hecho con otro dueño
          // (plugin_register en runtime), y leerlo es lo normal.
          path: "nefan-core/bridge/handlers/tile.ts",
          text: "const genCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);\nconst r = registerRuntimePlugin(narrative, ctx.activePlugins, raw);\n",
          imports: [],
        },
        {
          path: "nefan-core/bridge/x.ts",
          text: "if (ctx.activePlugins === otros) return;\n",
          imports: [],
        },
        {
          path: "nefan-core/bridge/plugins-activos.ts",
          text: "ctx.activePlugins = new Map();\n",
          imports: [],
        },
      ]),
      [],
      "nacer, leer, mutar contenido, comparar y el dueño quedan callados",
    );
  });

  // La deuda nueva de esta tanda (#181). Hace falta probarla en negativo por
  // partida doble: es `warn` con un `max` congelado —o sea, hoy está "verde"
  // por definición— y además su patrón lleva DOS exclusiones deliberadas (el
  // `.catch` en la misma línea y el `void main()` del GLSL). Un patrón que
  // excluye de más no se distingue de uno que no caza nada mirando el conteo.
  it("[deuda] html-sin-promesa-muda: el void mudo salta; el que tiene canal y el GLSL, no", () => {
    const deLaRegla = (files: SourceFile[]) =>
      checkArchitecture(config, files).filter((v) => v.ruleId === "html-sin-promesa-muda");

    // Las tres formas que tenía el cliente: el `void` suelto, el que va dentro
    // de un handler de una línea y el que viaja como argumento.
    assert.deepEqual(
      deLaRegla([
        {
          // Literalmente #181: el click de «Nueva partida» hasta esta PR.
          path: "nefan-html/src/ui/title-screen.ts",
          text: 'newBtn.addEventListener("click", () => {\n  void this.renderWorldSelect();\n});\n',
          imports: [],
        },
        {
          path: "nefan-html/src/ui/x.ts",
          text: 'btn.addEventListener("click", () => void this.onModeBadge(btn, sessions));\n',
          imports: [],
        },
        {
          path: "nefan-html/src/ui/y.ts",
          text: "setInterval(() => void this.poll(), POLL_MS);\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "nefan-html/src/ui/title-screen.ts:2",
        "nefan-html/src/ui/x.ts:1",
        "nefan-html/src/ui/y.ts:1",
      ],
      "un void sin canal tiene que saltar, esté suelto o dentro de un handler",
    );

    // Y lo que NO es una promesa muda: el `void p.catch(...)` (que sí tiene
    // canal), `paso()` (el sustituto), el `void main()` del GLSL — que no es
    // JavaScript ni es una promesa — y un `void 0`.
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-html/src/main.ts",
          text: 'void ctrl.onActiveTile(key).catch((err: unknown) => errors.push("scene", "falló", err));\n',
          imports: [],
        },
        {
          path: "nefan-html/src/ui/title-screen.ts",
          text: 'paso(this.renderWorldSelect(), "title", "abrir el selector de mundos");\n',
          imports: [],
        },
        {
          path: "nefan-html/src/renderer/fps-gl.ts",
          text: '"varying float vY; void main(){ vY = normalize(position).y; }",\n',
          imports: [],
        },
        { path: "nefan-html/src/ui/z.ts", text: "const nada = void 0;\n", imports: [] },
      ]),
      [],
      "un void con catch, el sustituto, el GLSL y `void 0` no son promesas mudas",
    );
  });

  for (const report of reports) {
    const { rule } = report;
    if (rule.severity === "error") {
      it(`[error] ${rule.id}`, () => {
        assert.equal(report.violations.length, 0, `\n${formatFailure(report)}\n`);
      });
    } else {
      it(`[deuda] ${rule.id} (max ${rule.max})`, () => {
        assert.ok(report.budget !== "excedido", `\n${formatFailure(report)}\n`);
        if (report.budget === "mejorable") {
          console.log(
            `  ℹ ${rule.id}: la deuda bajó a ${report.violations.length} (max=${rule.max}). ` +
              `Baja el max en data/contract/arch-rules.json para que no vuelva a subir.`,
          );
        }
      });
    }
  }
});

describe("motor de reglas", () => {
  it("glob: ** cruza directorios y también casa con cero", () => {
    const re = globToRegExp("a/**/*.ts");
    assert.ok(re.test("a/b.ts"));
    assert.ok(re.test("a/b/c/d.ts"));
    assert.ok(!re.test("z/b.ts"));
  });

  it("glob: * no cruza el separador", () => {
    const re = globToRegExp("a/*.ts");
    assert.ok(re.test("a/b.ts"));
    assert.ok(!re.test("a/b/c.ts"));
  });

  it("glob: los metacaracteres de regex se escapan", () => {
    assert.ok(globToRegExp("a.b/c.ts").test("a.b/c.ts"));
    assert.ok(!globToRegExp("a.b/c.ts").test("axb/c.ts"));
  });

  it("detecta un import prohibido y da su línea", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "r",
          desc: "d",
          why: "w",
          severity: "error",
          files: ["x/**/*.ts"],
          imports: { forbid: ["^three$"] },
        },
      ],
    });
    const found = checkArchitecture(cfg, [
      { path: "x/a.ts", text: "// three\nimport a from 'three';\n", imports: [{ spec: "three", line: 2 }] },
    ]);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
  });

  it("una excepción exime al fichero nombrado, no a sus vecinos", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "r",
          desc: "d",
          why: "w",
          severity: "error",
          files: ["x/**/*.ts"],
          imports: { forbid: ["^three$"] },
          exceptions: [{ path: "x/ok.ts", reason: "es el dueño del renderer" }],
        },
      ],
    });
    const files2: SourceFile[] = [
      { path: "x/ok.ts", text: "", imports: [{ spec: "three", line: 1 }] },
      { path: "x/no.ts", text: "", imports: [{ spec: "three", line: 1 }] },
    ];
    const found = checkArchitecture(cfg, files2);
    assert.deepEqual(
      found.map((v) => v.path),
      ["x/no.ts"],
    );
  });

  it("una excepción sin motivo no valida (fail-loud del propio contrato)", () => {
    assert.throws(() =>
      ArchConfigSchema.parse({
        scan: { roots: [{ dir: "x", ext: [".ts"] }] },
        rules: [
          {
            id: "r",
            desc: "d",
            why: "w",
            severity: "error",
            files: ["x/**/*.ts"],
            imports: { forbid: ["^three$"] },
            exceptions: [{ path: "x/ok.ts", reason: "" }],
          },
        ],
      }),
    );
  });

  it("una excepción a una ruta inexistente se denuncia; un glob no", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "r",
          desc: "d",
          why: "w",
          severity: "error",
          files: ["x/**/*.ts"],
          imports: { forbid: ["^three$"] },
          exceptions: [
            { path: "x/vivo.ts", reason: "existe" },
            { path: "x/borrado.ts", reason: "murió con la vista oblicua" },
            { path: "x/dev/*.ts", reason: "patrón: puede no casar hoy" },
          ],
        },
      ],
    });
    const dead = deadExceptions(cfg, [{ path: "x/vivo.ts", text: "" }]);
    assert.deepEqual(
      dead.map((d) => d.path),
      ["x/borrado.ts"],
    );
    // El motivo viaja al mensaje: es lo que dice qué había ahí.
    assert.match(formatDeadExceptions(dead), /murió con la vista oblicua/);
    // Y con el fichero presente, cero ruido.
    assert.deepEqual(
      deadExceptions(cfg, [
        { path: "x/vivo.ts", text: "" },
        { path: "x/borrado.ts", text: "" },
      ]),
      [],
    );
  });

  it("`exceptions[].funcion` solo vale en una regla `text`: en una de imports no valida", () => {
    const base = {
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "r",
          desc: "d",
          why: "w",
          severity: "error",
          files: ["x/**/*.ts"],
          exceptions: [{ path: "x/ok.ts", reason: "la puerta", funcion: "abre" }],
        },
      ],
    };
    assert.throws(
      () => ArchConfigSchema.parse({ ...base, rules: [{ ...base.rules[0], imports: { forbid: ["^three$"] } }] }),
      /funcion.*regla `text`/,
    );
    const cfg = ArchConfigSchema.parse({ ...base, rules: [{ ...base.rules[0], text: { pattern: "abrir\\(" } }] });
    assert.equal(cfg.rules[0].exceptions[0].funcion, "abre");
  });

  it("enclosingFunction: las tres formas de declarar, la clase del método, y null cuando no hay dueño", () => {
    const texto = [
      "export function suelta(a: number) {",
      "  return abrir(a);",
      "}",
      "const flecha = (x) => abrir(x);",
      "export class Caja {",
      "  private n = 0;",
      "  async metodo(a: string): Promise<void> {",
      "    if (a) {",
      "      abrir(a);",
      "    }",
      "  }",
      "}",
      "abrir(0);",
    ].join("\n");
    assert.equal(enclosingFunction(texto, 2), "suelta");
    assert.equal(enclosingFunction(texto, 4), "flecha");
    assert.equal(enclosingFunction(texto, 9), "Caja.metodo");
    assert.equal(enclosingFunction(texto, 13), null, "a nivel de módulo no hay función");
    assert.equal(enclosingFunction(texto, 99), null);
  });

  it("una regla warn sin max no valida", () => {
    assert.throws(() =>
      ArchConfigSchema.parse({
        scan: { roots: [{ dir: "x", ext: [".ts"] }] },
        rules: [{ id: "r", desc: "d", why: "w", severity: "warn", files: ["x/**"], text: { pattern: "a" } }],
      }),
    );
  });

  it("la deuda que crece se marca excedida; la que baja, mejorable", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "r",
          desc: "d",
          why: "w",
          severity: "warn",
          max: 1,
          files: ["x/**/*.ts"],
          text: { pattern: "mal" },
        },
      ],
    });
    const dos = checkArchitecture(cfg, [{ path: "x/a.ts", text: "mal\nmal\n" }]);
    assert.equal(reportByRule(cfg, dos)[0].budget, "excedido");
    const cero = checkArchitecture(cfg, [{ path: "x/a.ts", text: "bien\n" }]);
    assert.equal(reportByRule(cfg, cero)[0].budget, "mejorable");
  });
});
