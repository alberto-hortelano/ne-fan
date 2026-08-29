/** Gate de arranque: los snapshots de mundo LOCALES contra `ExpandedSceneSchema`.
 *
 *  NO ES UN TEST, y no puede serlo: los `world/tile.json` de los juegos están en `.gitignore`
 *  (regenerable desde el título), así que un `it` que recorriera esos ficheros
 *  encontraría cero en CI y en cualquier clon limpio — compararía dos listas
 *  vacías y saldría verde sin haber mirado nada. Por eso vive aquí, se lanza a
 *  mano y dice cuántos ha visto: un 0/0 se lee como lo que es.
 *
 *  Para qué: `ExpandedSceneSchema` (#237) es lo primero que tipa la población
 *  que el juego CARGA. Si rechaza un snapshot, `start_session` deja de
 *  replayearlo y degrada al bootstrap vivo — que llama al motor y GASTA. Esta
 *  es la señal barata y temprana de eso; la cara es la factura.
 *
 *      npx tsx scripts/gate-snapshots.ts        # desde nefan-core/
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { ExpandedSceneSchema } from "../src/contract/model-io/scene-schema.js";

const GAMES = fileURLToPath(new URL("../data/games", import.meta.url));

let ok = 0;
let total = 0;
let juegosConSnapshot = 0;

for (const juego of readdirSync(GAMES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()) {
  const path = join(GAMES, juego, "world", "tile.json");
  if (!existsSync(path)) continue;
  juegosConSnapshot++;
  const snap = JSON.parse(readFileSync(path, "utf-8")) as { scenes?: Record<string, unknown> };
  for (const [id, scene] of Object.entries(snap.scenes ?? {})) {
    total++;
    const r = ExpandedSceneSchema.safeParse(scene);
    if (r.success) {
      ok++;
      continue;
    }
    const motivos = r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join(" · ");
    console.error(`  ✖ ${juego}/${id}: ${motivos}`);
  }
}

console.log(
  `ExpandedSceneSchema sobre snapshots LOCALES: ${ok}/${total} aceptadas ` +
    `(${juegosConSnapshot} juego(s) con snapshot en el árbol)`,
);
if (total === 0) {
  // Salida 2, NO 0. La prosa de arriba ya decía que un 0/0 no comprueba nada,
  // pero el proceso salía con éxito: quien lo encadenara (`… && algo`, un hook,
  // un CI futuro) veía verde de un gate que no había mirado un solo tile — y en
  // un clon limpio eso pasa SIEMPRE, porque los snapshots están gitignorados.
  // Una prosa honesta con un código de salida que miente es lo peor de las dos.
  console.error(
    "  ✖ sin snapshots locales: este gate no ha comprobado NADA. " +
      "Genera un mundo desde el título (o desde generate_game) y vuelve a correrlo.",
  );
  process.exit(2);
}
process.exit(ok === total ? 0 : 1);
