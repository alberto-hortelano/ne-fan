/** Las formas de NOMBRAR un lector de `node:fs`, en una sola tabla (#727).
 *
 *  La leen las baterías de los DOS detectores que comparten el reconocedor de
 *  `scripts/lectores-de-fs.ts`: el selector de la mutación
 *  (`descubrimientosDe`, en `test/afectado.test.ts`) y el barrido del banco
 *  (`recorridos`, en `test/un-solo-barrido-del-banco.test.ts`). Con una lista
 *  por batería, una forma nueva entraba en una y no en la otra, y los dos
 *  detectores volvían a ver cosas distintas sin que nadie se pusiera rojo:
 *  justo lo que #727 midió (`const { readdirSync: r } = await import(…)` y
 *  `const leer = readdirSync` los veía el barrido y NO el selector, con cero
 *  directorios y cero ciegos).
 *
 *  Cada forma recibe los ARGUMENTOS de la llamada tal como los quiere cada
 *  batería (`QA, { recursive: true }` para el barrido, `DIR` para el selector)
 *  y devuelve el fuente entero. Sin `describe`: es una tabla, no una batería. */

const FS = `import { readdirSync } from "node:fs";\n`;

/** Las que los dos detectores VEN como una llamada a `readdirSync`. */
export const FORMAS: readonly ((args: string) => string)[] = [
  (a) => `${FS}readdirSync(${a});`,
  (a) => `import { readdirSync as leer } from "node:fs";\nleer(${a});`,
  (a) => `import * as fs from "node:fs";\nfs.readdirSync(${a});`,
  (a) => `import fs from "node:fs";\nfs.readdirSync(${a});`,
  (a) => `import { readdir } from "node:fs/promises";\nawait readdir(${a});`,
  (a) => `import { promises } from "node:fs";\npromises.readdir(${a});`,
  (a) => `import fs from "node:fs";\nfs.promises.readdir(${a});`,
  (a) => `const { readdirSync: r } = await import("node:fs");\nr(${a});`,
  (a) => `const fs = await import("node:fs");\nfs.readdirSync(${a});`,
  (a) => `(await import("node:fs")).readdirSync(${a});`,
  (a) => `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nconst { readdirSync } = require("node:fs");\nreaddirSync(${a});`,
  (a) => `import * as fs from "node:fs";\nconst { readdirSync } = fs;\nreaddirSync(${a});`,
  (a) => `${FS}const leer = readdirSync;\nconst otra = leer;\notra(${a});`,
  (a) => `${FS}readdirSync?.(${a});`,
  // Las cinco que #727 dejó de tener por invisibles: eran «formas de LLEGAR a
  // node:fs que no se persiguen» del barrido, y el selector veía casi todas
  // por el nombre desnudo. Unificar sin ellas le habría quitado vista al
  // selector, que es la dirección que no se puede permitir.
  (a) => `import * as fs from "node:fs";\nfs["readdirSync"](${a});`,
  (a) => `import("node:fs").then((fs) => fs.readdirSync(${a}));`,
  (a) => "const fs = await import(`node:fs`);\n" + `fs.readdirSync(${a});`,
  (a) => `process.getBuiltinModule("node:fs").readdirSync(${a});`,
  (a) => `import fs = require("node:fs");\nfs.readdirSync(${a});`,
];

/** Lo que el selector de la mutación hace con una llamada que el reconocedor
 *  NO ata a node:fs: `ciego` si se LLAMA como un lector (`readdirSync`,
 *  `glob`, `readFile` con el nombre compuesto…) —no se sabe si lee, y eso se
 *  cuenta—, `invisible` si ni eso. El barrido del banco no tiene ciegos: para
 *  él todas estas son invisibles (LÍMITE MEDIDO (1) de su padrón). */
export type VeredictoDelSelector = "ciego" | "invisible";

export interface FormaInvisible {
  fuente: (args: string) => string;
  selector: VeredictoDelSelector;
}

/** Las que el reconocedor NO ve: es POR NOMBRE dentro del fichero, y aquí o no
 *  hay llamada a fs (el shell), o el nombre se pierde (pasado como valor,
 *  re-exportado desde otro fichero, un `require` con otro nombre, un receptor
 *  que llega de fuera), o no es node:fs (`fs-extra`, el paquete `glob`,
 *  `import.meta.glob`). Es el LÍMITE MEDIDO de los dos, con lo que hace cada
 *  uno. Las siete últimas las encontró la QA de BH (H1): el selector las veía
 *  por el nombre desnudo antes de #727, y las perdía sin contarlas. */
export const INVISIBLES: readonly FormaInvisible[] = [
  { fuente: () => `import { execSync } from "node:child_process";\nexecSync("find qa -name '*.mjs'");`, selector: "invisible" },
  { fuente: (a) => `${FS}const aplica = (f: typeof readdirSync) => f(${a});\naplica(readdirSync);`, selector: "invisible" },
  { fuente: (a) => `import { readdirSync } from "./helper-que-reexporta.js";\nreaddirSync(${a});`, selector: "ciego" },
  { fuente: (a) => `import { createRequire } from "node:module";\nconst pide = createRequire(import.meta.url);\npide("node:fs").readdirSync(${a});`, selector: "ciego" },
  { fuente: (a) => `export function lee(fs: typeof import("node:fs")) { return fs.readdirSync(${a}); }`, selector: "ciego" },
  { fuente: (a) => `${FS}const io = { readdirSync };\nio.readdirSync(${a});`, selector: "ciego" },
  { fuente: (a) => `import * as nodefs from "node:fs";\nexport class X { fs = nodefs; lee() { return this.fs.readdirSync(${a}); } }`, selector: "ciego" },
  { fuente: (a) => `import fse from "fs-extra";\nfse.readdirSync(${a});`, selector: "ciego" },
  { fuente: (a) => `import fs from "graceful-fs";\nfs.readdirSync(${a});`, selector: "ciego" },
  { fuente: (a) => `import { glob } from "glob";\nglob(${a});`, selector: "ciego" },
  { fuente: (a) => `import { globSync } from "tinyglobby";\nglobSync(${a});`, selector: "ciego" },
  { fuente: (a) => `(import.meta).glob(${a});`, selector: "ciego" },
];

/** Un `readdirSync` que NO viene de `node:fs` no es un lector (C3): ni un
 *  directorio leído ni un recorrido. El selector lo cuenta CIEGO, porque por
 *  el nombre no sabe si es un envoltorio de fs (QA de BH, H1). */
export const AJENO = (a: string): string => `import { readdirSync } from "./mio";\nreaddirSync(${a});`;
