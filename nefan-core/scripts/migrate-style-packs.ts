/** Migración one-shot de style packs al formato de refs libres (2026-08).
 *
 * Pack plano con categorías (`settlement.jpg` + style.json con `category`)
 * → carpetas por vista (`overworld/settlement.jpg`) + refs `{id, file,
 * description, gen_scene, seed, role}` + `tags` de pack. Cada imagen
 * CONSERVA su nombre antiguo como `id` y se mueve con `git mv` sin
 * recomprimir: la clave de caché de imagen ({style_id}/{id}:{content_hash})
 * queda byte-idéntica y el histórico generado se conserva.
 *
 * Idempotente: un pack ya migrado (refs con `id`) se salta. Se commitea el
 * resultado; el script se conserva una release para packs user_* de
 * terceros. Uso: npx tsx scripts/migrate-style-packs.ts [stylesDir]
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const stylesDir = resolve(process.argv[2] ?? join(import.meta.dirname, "..", "data", "styles"));

/** Carpeta de vista del formato nuevo por categoría antigua. */
function folderFor(category: string): string {
  if (category.startsWith("stage_")) return "proscenium";
  if (category.startsWith("fps_")) return "fps";
  if (category.startsWith("character_")) return "characters";
  return "overworld";
}

/** Id nuevo por categoría antigua: idéntico salvo personajes (sus ids no
 *  entran en claves de caché y se limpian del prefijo redundante) y la
 *  lámina fps (conserva el id, cambia el archivo). */
function idFor(category: string): string {
  if (category.startsWith("character_")) return category.slice("character_".length);
  return category;
}

function fileFor(category: string): string {
  if (category === "fps_surfaces") return "fps/surfaces.jpg";
  return `${folderFor(category)}/${idFor(category)}.jpg`;
}

/** Seed de encuadre de _plantilla/ por categoría (los personajes usan el
 *  frame de y_bot embebido en el builder, sin seed declarada). */
function seedFor(category: string): string | undefined {
  if (category.startsWith("character_")) return undefined;
  if (category === "fps_surfaces") return "fps/fps_surfaces.png";
  return `${folderFor(category)}/${category}.png`;
}

/** Descripciones en español (lo que lee el motor narrativo para elegir).
 *  Canónicas para packs de ambientación medieval/fantástica; acero_neon
 *  lleva las suyas (colonia espacial). */
const CANONICAL_DESC: Record<string, string> = {
  settlement:
    "una aldea con casas de tejados variados en torno a una plaza de mercado, huertos, campos y bosque en los bordes",
  farmland:
    "campiña de labranza: campos arados, una granja con establo, setos, cercas y un camino de tierra",
  forest:
    "un bosque salvaje sin edificios: arboleda densa, un claro, un sendero estrecho y un arroyo con rocas",
  wetland:
    "un pantano sin edificios: canales de agua turbia, juncos y musgo, árboles retorcidos y pasarelas de tablones",
  desert:
    "un desierto sin edificios: dunas, roquedos, matorral seco, un pequeño oasis y una senda arenosa",
  snow: "un paisaje nevado sin edificios: campos de nieve, pinos, rocas y un arroyo helado",
  fortress:
    "una fortaleza de piedra en campo abierto: murallas con torres y puerta, patio interior con barracones y los campos alrededor",
  interior:
    "el interior de un edificio habitado (taberna o gran salón) visto en corte, con el mundo continuando alrededor",
  underground:
    "una mazmorra iluminada con antorchas: corredores de piedra, cámaras, escaleras, pilares y escombros",
  fps_surfaces:
    "lámina de doce muestras planas de los materiales más comunes del mundo (muros, suelos, tejados, madera, piedra)",
  character_commoner: "una persona corriente con ropa de trabajo sencilla y gastada",
  character_noble: "una persona de alta posición con ropas ricas y joyas",
  character_warrior: "una persona de armas con armadura y armas propias del mundo",
  stage_street:
    "una calle principal a pie de suelo: fachadas variadas a ambos lados, un carro con barriles, una torre asomando al fondo",
  stage_plaza:
    "una plaza de mercado a pie de suelo: frente de templo, fuente de piedra, puestos con toldos, casas cerrando el fondo",
  stage_interior:
    "la sala común de una taberna: vigas de madera, hogar de piedra encendido, mesas y bancos, un mostrador y una escalera",
  stage_nature:
    "un claro de bosque a pie de suelo: un arroyo cruzado por una pasarela de madera, rocas con musgo, arboleda cerrando el fondo",
  stage_harbor:
    "un muelle fluvial: una grúa de madera de rueda, una barcaza amarrada, una caseta de peaje, redes y cajas",
  stage_gate:
    "la puerta de una ciudad amurallada vista desde fuera: torres gemelas, rastrillo levantado y el camino de entrada entre campos",
};

const ACERO_NEON_DESC: Record<string, string> = {
  settlement:
    "un distrito habitacional abierto de una colonia espacial: módulos y estructuras asimétricas sin muralla",
  farmland: "una zona agrícola hidropónica: hileras de invernaderos alargados y cultivos abiertos",
  forest: "una zona de flora alienígena densa y bioluminiscente, sin edificios",
  wetland:
    "una marisma alienígena sin edificios: pozas minerales turbias con un brillo tenue",
  desert: "un desierto alienígena árido sin edificios: dunas de polvo y roquedos afilados",
  snow: "una tundra alienígena helada sin edificios: campos de hielo y minerales cristalinos",
  fortress:
    "un complejo de seguridad fortificado en paisaje árido: perímetro recto con torres de vigilancia",
  interior:
    "el interior de un módulo habitado de la colonia (cantina o sala común) visto en corte",
  underground: "un nivel de mantenimiento subterráneo: corredores metálicos rectos y cámaras",
  fps_surfaces:
    "lámina de doce muestras planas de materiales de la colonia (metal cepillado, paneles, rejilla, hormigón)",
  character_commoner: "una persona trabajadora de la colonia con rostro humano visible",
  character_noble: "una persona administradora corporativa de la colonia con rostro humano visible",
  character_warrior:
    "una persona de seguridad de la colonia con exotraje blindado y arma compacta",
  stage_interior:
    "la cantina de una nave: paneles metálicos con tiras de neón, mesas y bancos atornillados",
  stage_street:
    "una calle-corredor anular dentro de una estación espacial: suelo de plancha metálica",
  stage_plaza: "la explanada central de una colonia bajo una cúpula transparente, con un holograma",
  stage_nature:
    "una cúpula de hidroponía con flora alienígena bioluminiscente flanqueando un paso",
  stage_harbor:
    "una bahía de atraque: el borde de una plataforma de aterrizaje con una lanzadera aparcada y una grúa",
  stage_gate:
    "la esclusa principal del perímetro de la colonia: puertas blindadas reforzadas",
};

/** Contenido EN de generación por categoría (el CATEGORY_SCENES del builder
 *  antiguo): pasa a `gen_scene` cuando el ref no traía `scene` propio. */
const CANONICAL_GEN: Record<string, string> = {
  settlement:
    "a small village and its surroundings: houses with varied roofs around a market square (cobblestone paving ONLY in the square), packed-dirt streets leading out, gardens and fences, blending into plowed fields and a forest edge at the borders",
  farmland:
    "farmland countryside: plowed fields with crop rows, a farmhouse and a barn, hedges and wooden fences, a packed-dirt road, blending into open meadow and a forest edge",
  forest:
    "a wild forest with NO buildings: dense tree canopy, a clearing, a narrow dirt trail (NO paving), a stream with rocks, blending into open meadow at one side",
  wetland:
    "a swamp with NO buildings: murky water channels, reeds and moss, twisted trees, plank walkways over the mud, blending into wet meadow at one side",
  desert:
    "a desert with NO buildings: sand dunes, rocky outcrops, sparse dry shrubs, a small oasis, a sandy trail, blending into dry steppe at one side",
  snow: "a snowy landscape with NO buildings: snow fields, pine trees, rocks, a frozen stream, a trodden-snow trail, blending into alpine meadow at one side",
  fortress:
    "a stone fortress set in open landscape: outer walls with towers and a gate, an inner courtyard with barracks, and the fields around the walls with a packed-dirt road leading to the gate",
  interior:
    "the interior of an inhabited building (a tavern or great hall) shown in cutaway WITHIN its surroundings: no roof, furniture and floors visible, and the world continuing around the building — village street, grass, a neighbouring house, a dirt path reaching its door (never a floor plan floating on a void)",
  underground:
    "a torch-lit dungeon: stone corridors, chambers of different sizes, stairs, pillars and rubble",
  fps_surfaces:
    "twelve different flat material swatches, one per grid cell, covering the world's most common surfaces: whitewashed plaster wall, rough fieldstone masonry, weathered wooden planks, clay roof tiles, packed dirt ground, cobblestone paving, short grass, forest floor with leaf litter, thatch, dark rock, aged plaster with exposed brick, worn metal fittings",
  character_commoner: "a common villager in simple, worn work clothes",
  character_noble: "a richly dressed noble with fine fabrics and jewelry",
  character_warrior: "an armed warrior with period-appropriate armor and weapons",
  stage_street:
    "a curved main street: arcaded facades and varied house fronts on both sides, a cart with barrels, a tower rising above the bend",
  stage_plaza:
    "a market square: church front, a stone fountain, market stalls with awnings, houses closing the far side",
  stage_interior:
    "the common room of a tavern: timber beams, a stone hearth with fire, wooden tables and benches, a counter, a staircase",
  stage_nature:
    "a forest clearing: a stream crossed by a wooden footbridge, mossy rocks, dense tree mass closing the background",
  stage_harbor:
    "a river dock: a wooden treadwheel crane, a moored barge, a toll hut, nets and crates along the quay",
  stage_gate:
    "a walled city gate seen from outside: gatehouse with two towers, a raised portcullis, the road leading in, fields at the sides",
};

const PACK_TAGS: Record<string, string[]> = {
  medievo_crudo: ["medieval", "historico", "rural"],
  acero_neon: ["futurista", "espacial", "sci-fi"],
  acuarela_luminosa: ["fantasia", "luminoso", "medieval"],
  sombra_de_cuento: ["oscuro", "cuento", "fantasia"],
};

/** Orden nuevo de refs: overworld (settlement primera = fallback), proscenio
 *  (stage_street primera = el default del resolver antiguo), lámina fps y
 *  personajes (commoner primero). */
function sortKey(category: string): number {
  const order = [
    "settlement", "farmland", "forest", "wetland", "desert", "snow", "fortress", "interior", "underground",
    "stage_street", "stage_plaza", "stage_interior", "stage_nature", "stage_harbor", "stage_gate",
    "fps_surfaces",
    "character_commoner", "character_noble", "character_warrior",
  ];
  const i = order.indexOf(category);
  return i === -1 ? order.length : i;
}

function gitMv(from: string, to: string): void {
  // _staging/ está gitignored: git mv falla ahí — rename de FS normal. En lo
  // trackeado usar git mv preserva el rename en el índice (y el contenido no
  // se recomprime en ningún caso, así que el content_hash de caché no cambia).
  try {
    execFileSync("git", ["mv", from, to], { cwd: stylesDir, stdio: "pipe" });
  } catch {
    renameSync(join(stylesDir, from), join(stylesDir, to));
  }
}

function migratePack(styleId: string): void {
  const dir = join(stylesDir, styleId);
  const manifestPath = join(dir, "style.json");
  if (!existsSync(manifestPath)) {
    console.warn(`migrate: ${styleId} sin style.json — saltado`);
    return;
  }
  interface OldRef {
    category?: string;
    file?: string;
    scene?: string;
    perspective?: string;
    id?: string;
  }
  interface NewRef {
    id: string;
    file: string;
    description: string;
    gen_scene?: string;
    seed?: string;
    role?: string;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown> & {
    refs?: OldRef[];
  };
  const refs: OldRef[] = manifest.refs ?? [];
  if (refs.length > 0 && refs.every((r) => typeof r.id === "string")) {
    console.log(`migrate: ${styleId} ya en formato nuevo — saltado`);
    return;
  }
  const descs = styleId === "acero_neon" ? ACERO_NEON_DESC : CANONICAL_DESC;
  const out: NewRef[] = [];
  const sorted = [...refs].sort((a, b) => sortKey(String(a.category)) - sortKey(String(b.category)));
  for (const ref of sorted) {
    const category = String(ref.category ?? "");
    if (!category) continue;
    if (String(ref.perspective ?? "topdown") === "isometric") {
      console.warn(`migrate: ${styleId}/${category} isometric legacy — descartado`);
      continue;
    }
    const file = fileFor(category);
    const oldFile = String(ref.file ?? `${category}.jpg`);
    const folder = folderFor(category);
    mkdirSync(join(dir, folder), { recursive: true });
    if (existsSync(join(dir, oldFile)) && oldFile !== file) {
      gitMv(join(styleId, oldFile), join(styleId, file));
    }
    const entry: NewRef = {
      id: idFor(category),
      file,
      description: descs[category] ?? CANONICAL_DESC[category] ?? category,
    };
    const gen = String(ref.scene ?? "").trim() || CANONICAL_GEN[category];
    if (gen) entry.gen_scene = gen;
    const seed = seedFor(category);
    if (seed) entry.seed = seed;
    if (category === "fps_surfaces") entry.role = "fps_surfaces";
    out.push(entry);
  }
  const next = {
    style_id: manifest.style_id,
    name: manifest.name,
    description: manifest.description,
    style_token: manifest.style_token,
    cover: manifest.cover ?? "cover.jpg",
    tags: manifest.tags ?? PACK_TAGS[styleId] ?? ["medieval"],
    refs: out,
  };
  if (!PACK_TAGS[styleId] && !manifest.tags) {
    console.warn(`migrate: ${styleId} sin tags conocidos — asignado ["medieval"], REVISAR a mano`);
  }
  writeFileSync(manifestPath, JSON.stringify(next, null, 2) + "\n", "utf-8");
  console.log(`migrate: ${styleId} → ${out.length} refs en formato nuevo`);
}

function migratePlantilla(): void {
  const dir = join(stylesDir, "_plantilla");
  if (!existsSync(dir)) return;
  if (existsSync(join(dir, "oblicua"))) gitMv("_plantilla/oblicua", "_plantilla/overworld");
  if (existsSync(join(dir, "proscenio"))) gitMv("_plantilla/proscenio", "_plantilla/proscenium");
  const defaults: Array<[string, string]> = [
    ["overworld/settlement.png", "overworld/default.png"],
    ["proscenium/stage_street.png", "proscenium/default.png"],
    ["fps/fps_surfaces.png", "fps/default.png"],
  ];
  for (const [from, to] of defaults) {
    const src = join(dir, from);
    const dst = join(dir, to);
    if (existsSync(src) && !existsSync(dst)) {
      copyFileSync(src, dst);
      console.log(`migrate: _plantilla/${to} ← copia de ${from}`);
    }
  }
}

function migrateStaging(): void {
  const dir = join(stylesDir, "_staging");
  if (!existsSync(dir)) return;
  for (const pack of readdirSync(dir, { withFileTypes: true })) {
    if (!pack.isDirectory()) continue;
    for (const f of readdirSync(join(dir, pack.name))) {
      if (!f.endsWith(".jpg") && !f.endsWith(".png")) continue;
      const category = f.replace(/\.(jpg|png)$/, "");
      const target = fileFor(category);
      mkdirSync(join(dir, pack.name, folderFor(category)), { recursive: true });
      gitMv(join("_staging", pack.name, f), join("_staging", pack.name, target));
    }
  }
}

for (const entry of readdirSync(stylesDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
  migratePack(entry.name);
}
migratePlantilla();
migrateStaging();
console.log("migrate: hecho");
