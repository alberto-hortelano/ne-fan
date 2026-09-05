/** La batería del grafo de imports del checker (`src/contract/arch/cierre.ts`).
 *
 *  TODO SINTÉTICO: ficheros fabricados con sus imports ya resueltos, sin
 *  recorrer el repo. Es lo que la hace barata —con `coverageAnalysis: off` cada
 *  mutante paga la batería entera, y `architecture.test.ts` escanea 600
 *  ficheros— y lo que la hace concluyente: el árbol de hoy está verde, y una
 *  regla verde no demuestra nada. Aquí se le enseña al motor justo lo que la
 *  regla existe para cortar: un `node:fs` a DOS saltos del cliente. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { caminoHasta, cierreDesde, violacionesDeCierre } from "../src/contract/arch/cierre.js";
import { ArchConfigSchema, checkArchitecture, type SourceFile } from "../src/contract/arch/check.js";

const f = (path: string, imports: SourceFile["imports"] = []): SourceFile => ({ path, text: "", imports });
const mapa = (...files: SourceFile[]): Map<string, SourceFile> => new Map(files.map((x) => [x.path, x]));

const regla = (extra: Record<string, unknown> = {}) =>
  ArchConfigSchema.parse({
    scan: { roots: [{ dir: "x", ext: [".ts"] }] },
    rules: [
      {
        id: "cierre-sin-node",
        desc: "d",
        why: "w",
        severity: "error",
        files: ["nefan-html/src/**/*.ts"],
        cierre: { forbid: ["^node:"], quien: "el cliente" },
        ...extra,
      },
    ],
  }).rules[0];

// El caso que da sentido a la regla: el cliente importa `a`, `a` importa `b`,
// `b` importa `node:fs`. Ninguna regla `imports` sobre el cliente lo ve.
const x = f("nefan-html/src/x.ts", [
  { spec: "@nefan-core/src/a.js", line: 3, resolved: "nefan-core/src/a.ts" },
]);
const a = f("nefan-core/src/a.ts", [{ spec: "./b.js", line: 1, resolved: "nefan-core/src/b.ts" }]);
const b = f("nefan-core/src/b.ts", [
  { spec: "zod", line: 1 },
  { spec: "node:fs", line: 2 },
]);

describe("cierre · un node:* a dos saltos salta, con el camino entero", () => {
  it("una violación, en el fichero que escribe el import, con su línea y la cadena completa", () => {
    const v = violacionesDeCierre(regla(), ["nefan-html/src/x.ts"], mapa(x, a, b));
    assert.deepEqual(
      v.map(({ path, line, detail }) => ({ path, line, detail })),
      [
        {
          path: "nefan-core/src/b.ts",
          line: 2,
          detail:
            '"node:fs" entra en el cliente por: nefan-html/src/x.ts → nefan-core/src/a.ts → nefan-core/src/b.ts → node:fs',
        },
      ],
    );
    assert.equal(v[0].ruleId, "cierre-sin-node");
    assert.equal(v[0].severity, "error");
  });

  it("el mismo grafo con el import limpio no salta: la regla no dispara por estar en el cierre", () => {
    const bLimpio = f("nefan-core/src/b.ts", [{ spec: "zod", line: 1 }]);
    assert.deepEqual(violacionesDeCierre(regla(), ["nefan-html/src/x.ts"], mapa(x, a, bLimpio)), []);
  });

  it("y pasa por `checkArchitecture` como cualquier otra regla: las entradas son los ficheros que casan `files`", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "cierre-sin-node",
          desc: "d",
          why: "w",
          severity: "error",
          files: ["nefan-html/src/**/*.ts"],
          cierre: { forbid: ["^node:"] },
        },
      ],
    });
    // `b` también casa un fichero del bridge que NO es entrada: el bridge puede
    // importar node:fs, y no debe aparecer como camino.
    const bridge = f("nefan-core/bridge/w.ts", [{ spec: "node:fs", line: 9 }]);
    const v = checkArchitecture(cfg, [x, a, b, bridge]);
    assert.equal(v.length, 1);
    assert.equal(v[0].path, "nefan-core/src/b.ts");
    assert.match(
      v[0].detail,
      /entra en el cierre por: nefan-html\/src\/x\.ts → /,
      "sin `quien`, el sujeto es «el cierre»",
    );
  });

  it("`cierre` y `imports` en la misma regla no validan: exactamente una forma", () => {
    assert.throws(() => regla({ imports: { forbid: ["^three$"] } }), /exactamente uno/);
  });
});

describe("cierre · el grafo", () => {
  it("es el camino MÁS CORTO: con dos rutas hasta b, el mensaje enseña la directa", () => {
    // x → a → b y también x → b directo (línea 7). BFS llega antes por la directa.
    const xDirecto = f("nefan-html/src/x.ts", [
      { spec: "@nefan-core/src/a.js", line: 3, resolved: "nefan-core/src/a.ts" },
      { spec: "@nefan-core/src/b.js", line: 7, resolved: "nefan-core/src/b.ts" },
    ]);
    const padres = cierreDesde(["nefan-html/src/x.ts"], mapa(xDirecto, a, b));
    assert.deepEqual(caminoHasta(padres, "nefan-core/src/b.ts"), [
      "nefan-html/src/x.ts",
      "nefan-core/src/b.ts",
    ]);
    assert.deepEqual(padres.get("nefan-core/src/b.ts"), { desde: "nefan-html/src/x.ts", line: 7 });
  });

  it("…y también cuando la ruta larga se descubre ANTES: x → c → d → b frente a x → a → b", () => {
    // La búsqueda tiene que ser en anchura de verdad. Una pila (LIFO) expande
    // primero lo último encolado: aquí `c`, y llegaría a `b` por tres saltos
    // antes de que `a` lo alcance por dos. El mensaje enseñaría la ruta larga.
    const xc = f("nefan-html/src/x.ts", [
      { spec: "@nefan-core/src/a.js", line: 1, resolved: "nefan-core/src/a.ts" },
      { spec: "@nefan-core/src/c.js", line: 2, resolved: "nefan-core/src/c.ts" },
    ]);
    const c = f("nefan-core/src/c.ts", [{ spec: "./d.js", line: 1, resolved: "nefan-core/src/d.ts" }]);
    const d = f("nefan-core/src/d.ts", [{ spec: "./b.js", line: 1, resolved: "nefan-core/src/b.ts" }]);
    const v = violacionesDeCierre(regla(), ["nefan-html/src/x.ts"], mapa(xc, a, c, d, b));
    assert.deepEqual(
      v.map((z) => z.detail),
      [
        '"node:fs" entra en el cliente por: nefan-html/src/x.ts → nefan-core/src/a.ts → nefan-core/src/b.ts → node:fs',
      ],
    );
  });

  it("dos entradas que alcanzan el mismo fichero prohibido dan UNA violación, no una por entrada", () => {
    const y = f("nefan-html/src/y.ts", [
      { spec: "@nefan-core/src/b.js", line: 1, resolved: "nefan-core/src/b.ts" },
    ]);
    const v = violacionesDeCierre(regla(), ["nefan-html/src/x.ts", "nefan-html/src/y.ts"], mapa(x, y, a, b));
    assert.equal(v.length, 1);
    // …y la que se enseña es la corta (y → b), no la de dos saltos.
    assert.equal(
      v[0].detail,
      '"node:fs" entra en el cliente por: nefan-html/src/y.ts → nefan-core/src/b.ts → node:fs',
    );
  });

  it("un import sin `resolved` (paquete, builtin) no es arista: no se sigue ni se inventa", () => {
    const padres = cierreDesde(["nefan-html/src/x.ts"], mapa(x, a, b));
    assert.deepEqual([...padres.keys()].sort(), [
      "nefan-core/src/a.ts",
      "nefan-core/src/b.ts",
      "nefan-html/src/x.ts",
    ]);
    assert.equal(padres.get("nefan-html/src/x.ts"), null, "una entrada no tiene arista");
  });

  it("un ciclo no cuelga la búsqueda", () => {
    const p = f("nefan-html/src/p.ts", [{ spec: "./q.js", line: 1, resolved: "nefan-html/src/q.ts" }]);
    const q = f("nefan-html/src/q.ts", [{ spec: "./p.js", line: 1, resolved: "nefan-html/src/p.ts" }]);
    const padres = cierreDesde(["nefan-html/src/p.ts"], mapa(p, q));
    assert.equal(padres.size, 2);
    assert.deepEqual(violacionesDeCierre(regla(), ["nefan-html/src/p.ts"], mapa(p, q)), []);
  });

  it("un destino resuelto que NO está escaneado es violación con su camino, no una poda silenciosa", () => {
    // `a` importa algo fuera de scan.roots: lo que haya detrás no se ha mirado.
    const aFuera = f("nefan-core/src/a.ts", [{ spec: "../../fuera/z.js", line: 4, resolved: "fuera/z.ts" }]);
    const v = violacionesDeCierre(regla(), ["nefan-html/src/x.ts"], mapa(x, aFuera));
    assert.equal(v.length, 1);
    assert.equal(v[0].path, "nefan-core/src/a.ts", "se denuncia en quien lo importa");
    assert.equal(v[0].line, 4);
    assert.match(v[0].detail, /alcanza "fuera\/z\.ts" y el checker no lo escanea/);
    assert.match(v[0].detail, /Camino: nefan-html\/src\/x\.ts → nefan-core\/src\/a\.ts → fuera\/z\.ts$/);
  });

  it("una entrada eximida no abre el grafo: lo que solo se alcanza desde ella no se juzga", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "cierre-sin-node",
          desc: "d",
          why: "w",
          severity: "error",
          files: ["nefan-html/src/**/*.ts"],
          cierre: { forbid: ["^node:"] },
          exceptions: [{ path: "nefan-html/src/x.ts", reason: "es el guion de build, corre en Node" }],
        },
      ],
    });
    assert.deepEqual(checkArchitecture(cfg, [x, a, b]), []);
    // Y con una segunda entrada no eximida que también llega, vuelve a saltar.
    const y = f("nefan-html/src/y.ts", [
      { spec: "@nefan-core/src/a.js", line: 1, resolved: "nefan-core/src/a.ts" },
    ]);
    assert.equal(checkArchitecture(cfg, [x, y, a, b]).length, 1);
  });

  it("varios patrones en `forbid`: cada import que case es su propia violación", () => {
    const c = f("nefan-core/src/c.ts", [
      { spec: "node:path", line: 1 },
      { spec: "three", line: 2 },
      { spec: "zod", line: 3 },
    ]);
    const xc = f("nefan-html/src/x.ts", [
      { spec: "@nefan-core/src/c.js", line: 1, resolved: "nefan-core/src/c.ts" },
    ]);
    const v = violacionesDeCierre(
      regla({ cierre: { forbid: ["^node:", "^three$"] } }),
      ["nefan-html/src/x.ts"],
      mapa(xc, c),
    );
    assert.deepEqual(
      v.map((z) => `${z.line}:${z.detail.split(" ")[0]}`),
      ['1:"node:path"', '2:"three"'],
    );
  });
});
