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

    // Y los vecinos inocentes, callados: un identificador que solo CONTIENE la
    // palabra no es el campo (el patrón va con \b a los dos lados).
    assert.deepEqual(
      deLaRegla([
        {
          path: "nefan-core/src/scene/tile.ts",
          text: "const stage_requests_total = 0;\nconst reviewed = 'blueprint_review';\n",
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
