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
import { existsSync, readlinkSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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

/** Destino de un symlink, en ruta relativa al repo; `null` si apunta fuera o
 *  si el enlace ya no está en el árbol de trabajo. Ese último caso —enlace
 *  trackeado que alguien borró del disco sin llevar la baja al índice— es
 *  justo un enlace colgado: si `readlink` reventara aquí, el guardia moriría
 *  con ENOENT en vez de decir cuál es. */
function linkTarget(linkPath: string): string | null {
  const abs = resolve(REPO, linkPath);
  let raw: string;
  try {
    raw = readlinkSync(abs);
  } catch {
    return null;
  }
  const rel = relative(REPO, resolve(dirname(abs), raw));
  return rel.startsWith("..") ? null : rel;
}

/** Enlaces que cuelgan A PROPÓSITO: su destino está gitignoreado, así que en
 *  un clon limpio no existe y eso es lo esperado. Caso real: `labs/fps/sprites`
 *  apunta al banco de sprites generado del cliente (`.gitignore:48`), que el
 *  visor del lab sirve desde la máquina de cada uno. Un enlace así no es una
 *  fixture rota; distinguirlos con `git check-ignore` evita tanto el falso
 *  positivo como una lista de excepciones a mano que se pudriría. */
function ignoredTargets(links: readonly string[]): Set<string> {
  const candidatos = links.map(linkTarget).filter((t): t is string => t !== null);
  if (candidatos.length === 0) return new Set();
  let res: string;
  try {
    res = execFileSync("git", ["check-ignore", "--stdin"], {
      cwd: REPO,
      encoding: "utf8",
      input: candidatos.join("\n"),
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch (err) {
    // `check-ignore` sale con 1 cuando NINGUNA ruta está ignorada: eso no es
    // un error. Cualquier otro código sí lo es y se propaga.
    const status = (err as { status?: number }).status;
    if (status !== 1) throw err;
    return new Set();
  }
  return new Set(res ? res.split("\n") : []);
}

function retiredRule(): { pattern: RegExp; terms: string[] } {
  const rule = archConfig.rules.find((r) => r.id === "campos-retirados-no-vuelven");
  const source = rule?.text?.pattern;
  assert.ok(source, "la regla campos-retirados-no-vuelven debe existir con su patrón");
  // El patrón es `\b(a|b|c)\b`: la alternancia ES la lista de términos. Un
  // término puede llevar un lookahead pegado (`attach(?!\()` deja pasar los
  // métodos `attach(` del cliente y de narrative-mcp): para buscarlo en un
  // NOMBRE de fichero se le quita, porque ahí lo que cuenta es el literal.
  assert.ok(source.startsWith("\\b(") && source.endsWith(")\\b"), `patrón sin alternancia legible: ${source}`);
  const alternancia = source.slice(source.indexOf("(") + 1, source.lastIndexOf(")"));
  return { pattern: new RegExp(source), terms: alternancia.split("|").map((t) => t.replace(/\(\?[!=].*$/, "")) };
}

const entries = tracked();

describe("higiene del árbol versionado", () => {
  it("ningún symlink trackeado apunta a un fichero que ya no existe", () => {
    const links = entries.filter((e) => e.mode === "120000").map((e) => e.path);
    const porDiseno = ignoredTargets(links);
    const roto = danglingLinks(entries, (p) => {
      if (existsSync(resolve(REPO, p))) return true;
      const destino = linkTarget(p);
      return destino !== null && porDiseno.has(destino);
    });
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

  it("un enlace a un destino gitignoreado NO se caza: cuelga por diseño", () => {
    // En el árbol real hay al menos uno (`labs/fps/sprites` → banco de sprites
    // generado). Si el conjunto de "por diseño" se vaciara, el guardia estaría
    // pasando por suerte y no por criterio.
    const links = entries.filter((e) => e.mode === "120000").map((e) => e.path);
    const porDiseno = ignoredTargets(links);
    assert.ok(
      porDiseno.size > 0,
      "ningún enlace apunta ya a un destino ignorado: revisar si este filtro sigue haciendo falta",
    );
    // Y el filtro es lo ÚNICO que los salva: sin él, un enlace cuyo destino no
    // se versiona saldría marcado como roto en cualquier clon limpio.
    const conDestinoIgnorado = links.filter((p) => {
      const d = linkTarget(p);
      return d !== null && porDiseno.has(d);
    });
    assert.deepEqual(
      danglingLinks(
        conDestinoIgnorado.map((path) => ({ mode: "120000", path })),
        () => false,
      ),
      conDestinoIgnorado,
    );
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
