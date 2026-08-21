/** Higiene del árbol: lo que un grep sobre CONTENIDO no puede ver.
 *
 *  `campos-retirados-no-vuelven` (arch-rules.json) mira el CONTENIDO de los
 *  ficheros de unas extensiones concretas. Dos cosas se le escapan por
 *  construcción, y las dos mordieron el mismo día (2026-08-21, al renombrar la
 *  fixture del pueblo):
 *
 *  1. Un **symlink trackeado que apunta a un fichero borrado**. `vite build`
 *     copia `public/` entera y hace `statSync` de cada entrada: un enlace roto
 *     tumba el build del cliente. No se vio en local porque `tsc` y `lint` no
 *     tocan `public/`, y el enlace además dejaba al visor del mapa
 *     (`public/world_map/index.html`, que hace `fetch("/scenes/{id}.json")`)
 *     pidiendo una escena inexistente.
 *  2. Un nombre retirado que sobrevive en la **RUTA** de un fichero en vez de
 *     en su texto: el nombre entero del enlace era el término prohibido, y un
 *     symlink no tiene bytes que grepear.
 *
 *  Se comprueba sobre ficheros TRACKEADOS: un enlace roto sin versionar es
 *  asunto de la máquina de cada uno, no del repo.
 *
 *  Los términos NO se escriben aquí: se derivan del patrón de la regla. Así
 *  este guardia cubre solo el que añada el siguiente que retire algo, sin
 *  necesitar una excepción en `arch-rules.json` que se pudriría en silencio. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { archConfig } from "../scripts/arch-collect.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Fichero versionado: modo de git (`120000` = symlink) y ruta relativa. */
export interface TrackedEntry {
  mode: string;
  path: string;
}

/** Symlinks del listado cuyo destino no existe. PURA: `resolves` decide, así
 *  que el negativo se prueba sin tocar el disco. */
export function danglingLinks(
  entries: readonly TrackedEntry[],
  resolves: (path: string) => boolean,
): string[] {
  return entries.filter((e) => e.mode === "120000" && !resolves(e.path)).map((e) => e.path);
}

/** Rutas que llevan un término retirado en el NOMBRE (no en el contenido). */
export function pathsWithRetiredTerms(
  paths: readonly string[],
  pattern: RegExp,
): { path: string; term: string }[] {
  const hits: { path: string; term: string }[] = [];
  for (const p of paths) {
    // `lastIndex` viaja entre llamadas si el patrón trae la flag global.
    const re = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    const m = re.exec(p);
    if (m) hits.push({ path: p, term: m[0] });
  }
  return hits;
}

function tracked(): TrackedEntry[] {
  const out = execFileSync("git", ["ls-files", "-s"], { cwd: REPO, encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      return { mode: meta.split(" ")[0], path };
    });
}

function retiredRule(): { pattern: RegExp; terms: string[] } {
  const rule = archConfig.rules.find((r) => r.id === "campos-retirados-no-vuelven");
  const source = rule?.text?.pattern;
  assert.ok(source, "la regla campos-retirados-no-vuelven debe existir con su patrón");
  // El patrón es `\b(a|b|c)\b`: la alternancia ES la lista de términos.
  const alternancia = /\(([^)]+)\)/.exec(source);
  assert.ok(alternancia, `patrón sin alternancia legible: ${source}`);
  return { pattern: new RegExp(source), terms: alternancia[1].split("|") };
}

const entries = tracked();

describe("higiene del árbol versionado", () => {
  it("ningún symlink trackeado apunta a un fichero que ya no existe", () => {
    const roto = danglingLinks(entries, (p) => existsSync(resolve(REPO, p)));
    assert.deepEqual(
      roto,
      [],
      `symlinks colgados (rompen \`vite build\`, que hace stat de todo public/): ${roto.join(", ")}`,
    );
  });

  it("ningún nombre de fichero lleva un término retirado", () => {
    const hits = pathsWithRetiredTerms(
      entries.map((e) => e.path),
      retiredRule().pattern,
    );
    assert.deepEqual(
      hits,
      [],
      `rutas con un término retirado: ${hits.map((h) => `${h.path} (${h.term})`).join(", ")}`,
    );
  });

  it("hay al menos un symlink trackeado — si no, este guardia no guarda nada", () => {
    const links = entries.filter((e) => e.mode === "120000");
    assert.ok(links.length > 0, "el repo servía fixtures por symlink; si ya no, retirar este test");
  });
});

describe("higiene del árbol — los guardias en negativo", () => {
  it("un symlink colgado se caza; uno vivo y un fichero normal no", () => {
    const fabricados: TrackedEntry[] = [
      { mode: "120000", path: "nefan-html/public/scenes/rota.json" },
      { mode: "120000", path: "nefan-html/public/scenes/viva.json" },
      { mode: "100644", path: "nefan-core/src/index.ts" },
    ];
    const vivos = new Set(["nefan-html/public/scenes/viva.json"]);
    assert.deepEqual(danglingLinks(fabricados, (p) => vivos.has(p)), [
      "nefan-html/public/scenes/rota.json",
    ]);
  });

  it("el patrón real caza CADA término retirado cuando está en la ruta", () => {
    const { pattern, terms } = retiredRule();
    assert.ok(terms.length >= 5, `la regla debería listar varios términos, listó ${terms.length}`);
    const rutas = terms.map((t) => `data/${t}.json`);
    assert.deepEqual(
      pathsWithRetiredTerms(rutas, pattern).map((h) => h.term),
      terms,
    );
  });

  it("no caza a un vecino inocente que solo comparte prefijo o sufijo", () => {
    const { pattern, terms } = retiredRule();
    const vecinos = terms.flatMap((t) => [`data/${t}s.json`, `data/pre_${t}_x/otro.json`]);
    // `pre_${t}_x` lleva guion bajo a los lados: `\b` no rompe dentro de una
    // palabra, así que un término embebido NO debe dar positivo.
    assert.deepEqual(pathsWithRetiredTerms(vecinos, pattern), []);
  });

  it("un fichero normal (no symlink) con nombre retirado también se caza", () => {
    const { pattern, terms } = retiredRule();
    const fabricados: TrackedEntry[] = [{ mode: "100644", path: `data/scenes/${terms[0]}.json` }];
    assert.deepEqual(danglingLinks(fabricados, () => true), []);
    assert.deepEqual(
      pathsWithRetiredTerms(
        fabricados.map((e) => e.path),
        pattern,
      ).map((h) => h.term),
      [terms[0]],
    );
  });
});
