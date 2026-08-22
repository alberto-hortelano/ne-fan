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
          path: "labs/narrative/fake-ai-server.mjs",
          text: "// linea\n// otra\nif (body.stage_request) return plato();\n",
          imports: [],
        },
      ]).map((v) => `${v.path}:${v.line}`),
      [
        "labs/narrative/fake-ai-server.mjs:3",
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
          path: "nefan-core/data/rooms/dev/x.json",
          text: '{\n  "view": "algo",\n  "branch": "otra cosa"\n}\n',
          imports: [],
        },
      ]),
      [],
    );
  });

  // Es EL criterio de la operación "solo la vista 3D": un único importador de
  // three en el cliente ⇒ un único contexto WebGL en la pestaña. Probado en
  // negativo contra la config real, porque la regla verde de hoy no distingue
  // "nadie más importa three" de "la excepción se comió la regla".
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
