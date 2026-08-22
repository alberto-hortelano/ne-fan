#!/usr/bin/env node
/** Pre-renderiza las hojas de sprites Mixamo que consume el cliente.
 *
 * Sustituye a `tools/render_sprite_sheets.py` + la escena de Godot: aquí la
 * escena la monta three.js (`page.mjs`) dentro de Chrome headless, conducido con
 * playwright-core. Los mismos flags de WebGL por software que usa `qa/run.mjs`
 * a diario, así que no hace falta GPU ni servidor X.
 *
 * Uso:
 *   node tools/render-sprite-sheets/render.mjs --models y_bot --anims idle
 *   node tools/render-sprite-sheets/render.mjs --all --angle frontal_8
 *
 * Salida (idéntica a la del renderizador de Godot, el consumidor no cambia):
 *   {out}/{model}/{anim}/{angle}/dir_{D}_frame_{F:03}.png
 *   {out}/{model}/{anim}/{angle}/meta.json
 *
 * Fail-loud: cualquier trabajo que falle se reporta con su causa y el proceso
 * sale con código distinto de cero. Nunca se escribe una hoja a medias sin
 * decirlo.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { declaredClipDuration } from "./fbx-anim-span.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const THREE_ROOT = join(HERE, "node_modules", "three");
const DEFAULT_ASSETS = join(REPO_ROOT, "assets", "characters");
const DEFAULT_OUT = join(REPO_ROOT, "nefan-html", "public", "sprites");
const CHROME_BIN = process.env.NEFAN_CHROME ?? "/usr/bin/google-chrome";

/** Intensidad de la luz direccional. El renderizador original usaba
 *  `light_energy = 1.5`; three no comparte unidades (Lambert con 1/π), así que
 *  el número está CALIBRADO, no copiado: es el que iguala la luminancia media de
 *  los píxeles con a>0 contra las hojas ya generadas. Medido sobre los 352
 *  fotogramas de `y_bot/idle` Y los de `paladin/idle`, no sobre una muestra —
 *  una media puede casar mientras la distribución no, que es justo lo que se nos
 *  escapó la primera vez.
 *  Si cambia el material, la versión de three o el modelo de color, hay que
 *  recalibrarlo con `comparar.py --todos`. */
const DEFAULT_LIGHT_INTENSITY = 4.65;

/** animation_id -> nombre del FBX (sin extensión) en el pack Sword and Shield.
 *  Portado tal cual del renderizador de Godot. */
const ANIM_MAP = {
  idle: "sword and shield idle",
  walk: "sword and shield walk",
  run: "sword and shield run",
  quick: "sword and shield attack (4)",
  heavy: "sword and shield slash",
  medium: "sword and shield slash (5)",
  defensive: "sword and shield block",
  precise: "sword and shield slash (3)",
  hit_react: "sword and shield impact",
  death: "sword and shield death",
};
const AMBIENT_ANIM_MAP = {
  talking: "standing_talking",
  drinking: "drinking",
  wounded_idle: "wounded_idle",
  sitting_idle: "sitting_idle",
  waving: "waving",
  praying: "praying_kneel",
};

// y_bot va PRIMERO y no es opcional: es el modelo base del cliente
// (`BASE_MODEL`), sobre el que se generan los skins. Un `--all` que lo
// saltara regeneraría a todos menos al único que el juego necesita.
const DEFAULT_MODELS = ["y_bot", "paladin", "eve", "warrok", "skeletonzombie", "arissa", "drake"];
const DEFAULT_ANIMS = Object.keys(ANIM_MAP);
// Un solo ángulo: el cliente lo tiene fijo. El flag sigue existiendo porque el
// ángulo forma parte de la ruta de salida y del meta.json.
const SUPPORTED_ANGLES = ["frontal_8"];

function parseArgs(argv) {
  const opts = {
    models: null,
    anims: null,
    angle: "frontal_8",
    all: false,
    directions: 8,
    width: 256,
    height: 256,
    fps: 12,
    out: DEFAULT_OUT,
    assets: DEFAULT_ASSETS,
    light: DEFAULT_LIGHT_INTENSITY,
    roughness: null,
    dryRun: false,
  };
  const list = (i) => {
    const vals = [];
    while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) vals.push(argv[++i]);
    if (vals.length === 0) throw new Error(`${argv[i]} necesita al menos un valor`);
    return { vals, i };
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    switch (key) {
      case "--models": { const r = list(i); opts.models = r.vals; i = r.i; break; }
      case "--anims": { const r = list(i); opts.anims = r.vals; i = r.i; break; }
      case "--angle": opts.angle = argv[++i]; break;
      case "--all": opts.all = true; break;
      case "--directions": opts.directions = Number(argv[++i]); break;
      case "--width": opts.width = Number(argv[++i]); break;
      case "--height": opts.height = Number(argv[++i]); break;
      case "--fps": opts.fps = Number(argv[++i]); break;
      case "--out": opts.out = resolve(argv[++i]); break;
      case "--assets": opts.assets = resolve(argv[++i]); break;
      case "--light": opts.light = Number(argv[++i]); break;
      case "--roughness": opts.roughness = Number(argv[++i]); break;
      case "--dry-run": opts.dryRun = true; break;
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`argumento desconocido: ${key}`);
    }
  }
  if (!SUPPORTED_ANGLES.includes(opts.angle)) {
    throw new Error(`ángulo "${opts.angle}" fuera de ${SUPPORTED_ANGLES.join(", ")}`);
  }
  for (const [k, v] of Object.entries({
    directions: opts.directions, width: opts.width, height: opts.height, fps: opts.fps,
  })) {
    if (!Number.isInteger(v) || v <= 0) throw new Error(`--${k} debe ser un entero > 0 (era "${v}")`);
  }
  if (!Number.isFinite(opts.light) || opts.light <= 0) {
    throw new Error(`--light debe ser un número > 0 (era "${opts.light}")`);
  }
  return opts;
}

const HELP = `Renderiza hojas de sprites Mixamo con three.js (sin Godot).

  --models <id...>    Modelos de assets/characters/mixamo/ (por defecto: paladin)
  --anims <id...>     Animaciones: ${DEFAULT_ANIMS.join(", ")}
                      o ambiente: ${Object.keys(AMBIENT_ANIM_MAP).join(", ")}
  --angle <id>        ${SUPPORTED_ANGLES.join(" | ")} (por defecto: frontal_8)
  --all               Todos los modelos por defecto × todas las animaciones
  --directions <n>    Orientaciones por animación (8)
  --width/--height    Tamaño del frame (256)
  --fps <n>           Muestreo temporal (12)
  --out <dir>         Raíz de salida (nefan-html/public/sprites)
  --assets <dir>      Raíz de assets (assets/characters)
  --light <f>         Intensidad de la direccional (${DEFAULT_LIGHT_INTENSITY}, calibrada)
  --roughness <f>     Fuerza la rugosidad del material (por defecto: mate, 1.0).
                      Solo para recalibrar con comparar.py
  --dry-run           Lista los trabajos sin renderizar`;

function animFbxRelPath(animId) {
  if (animId in ANIM_MAP) return join("anims", "sword_and_shield", `${ANIM_MAP[animId]}.fbx`);
  if (animId in AMBIENT_ANIM_MAP) {
    return join("mixamo", "ambient_anims", `${AMBIENT_ANIM_MAP[animId]}.fbx`);
  }
  throw new Error(
    `animación desconocida "${animId}" (combate: ${DEFAULT_ANIMS.join(", ")}` +
      ` | ambiente: ${Object.keys(AMBIENT_ANIM_MAP).join(", ")})`,
  );
}

function resolveJobs(opts) {
  const models = opts.all ? opts.models ?? DEFAULT_MODELS : opts.models ?? ["paladin"];
  const anims = opts.all ? opts.anims ?? DEFAULT_ANIMS : opts.anims ?? ["idle"];
  return models.flatMap((m) => anims.map((a) => ({ model: m, anim: a })));
}

/** Servidor efímero sobre el directorio del tool + los assets. three y los FBX
 *  se sirven por HTTP porque los módulos ES y las texturas embebidas no cargan
 *  desde `file://` (CORS). */
function startServer(assetsRoot) {
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".fbx": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".wasm": "application/wasm",
  };
  const route = (urlPath) => {
    if (urlPath === "/" || urlPath === "/index.html") return join(HERE, "page.html");
    if (urlPath.startsWith("/three/")) return join(THREE_ROOT, urlPath.slice("/three/".length));
    if (urlPath.startsWith("/assets/")) return join(assetsRoot, urlPath.slice("/assets/".length));
    if (urlPath === "/page.mjs") return join(HERE, "page.mjs");
    return null;
  };
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = route(urlPath);
    // Traversal fuera de las dos raíces servidas: 403, nunca leer el fichero.
    const roots = [HERE, THREE_ROOT, assetsRoot];
    if (!file || !roots.some((r) => normalize(file).startsWith(r + sep) || normalize(file) === r)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const ext = file.slice(file.lastIndexOf("."));
    createReadStream(file)
      .on("error", (err) => {
        console.error(`  ! HTTP 404 ${urlPath}: ${err.message}`);
        res.writeHead(404).end("not found");
      })
      .on("open", () => res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" }))
      .pipe(res);
  });
  return new Promise((ok, ko) => {
    server.on("error", ko);
    server.listen(0, "127.0.0.1", () => ok({ server, port: server.address().port }));
  });
}

async function mustExist(path, what) {
  try {
    await stat(path);
  } catch {
    throw new Error(`${what} no existe: ${path}`);
  }
}

async function renderJob(page, base, opts, job) {
  const modelRel = join("mixamo", job.model, "character.fbx");
  const animRel = animFbxRelPath(job.anim);
  await mustExist(join(opts.assets, modelRel), `modelo "${job.model}"`);
  await mustExist(join(opts.assets, animRel), `animación "${job.anim}"`);
  const url = (rel) => `${base}/assets/${rel.split(sep).map(encodeURIComponent).join("/")}`;

  // La duración manda sobre el número de fotogramas, así que sale del intervalo
  // que declara el FBX y no del último keyframe (ver fbx-anim-span.mjs).
  const animBuf = await readFile(join(opts.assets, animRel));
  const durationOverride = declaredClipDuration(animBuf, "mixamo.com", `${job.model}/${job.anim}`);

  const info = await page.evaluate((o) => window.__spriteSetup(o), {
    modelUrl: url(modelRel),
    animUrl: url(animRel),
    animId: job.anim,
    angle: opts.angle,
    width: opts.width,
    height: opts.height,
    lightIntensity: opts.light,
    roughness: opts.roughness,
    durationOverride,
  });
  if (info.trackDuration > info.duration + 1e-4) {
    console.warn(
      `  ! el FBX declara ${info.duration.toFixed(4)} s pero sus claves llegan a` +
        ` ${info.trackDuration.toFixed(4)} s: se recortaría animación`,
    );
  }

  const frameStep = 1 / opts.fps;
  const frameCount = Math.max(1, Math.round(info.duration / frameStep));
  const outDir = join(opts.out, job.model, job.anim, opts.angle);
  await mkdir(outDir, { recursive: true });
  console.log(
    `  escala=${info.unitScale} alto=${info.modelHeightMetres} m · huesos=${info.boneCount}` +
      ` prefijo=${info.bonePrefix}${info.remapped ? ` (remap ${info.remapped} pistas de ${info.clipPrefix})` : ""}` +
      ` · rugosidad=${info.roughnesses.join("/")}` +
      `${info.hipsKeys ? ` · Hips XZ congelado (${info.hipsKeys} keys)` : ""}`,
  );
  console.log(
    `  ${opts.directions} dirs × ${frameCount} frames` +
      ` (duración declarada=${info.duration.toFixed(4)} s, última clave=${info.trackDuration.toFixed(4)} s)`,
  );

  for (let d = 0; d < opts.directions; d += 1) {
    const urls = await page.evaluate(
      ([dir, dirs, frames, fps]) => window.__spriteRenderDirection(dir, dirs, frames, fps),
      [d, opts.directions, frameCount, opts.fps],
    );
    if (urls.length !== frameCount) {
      throw new Error(`dir ${d}: la página devolvió ${urls.length} frames, se esperaban ${frameCount}`);
    }
    await Promise.all(
      urls.map((dataUrl, f) => {
        const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const name = `dir_${d}_frame_${String(f).padStart(3, "0")}.png`;
        return writeFile(join(outDir, name), Buffer.from(b64, "base64"));
      }),
    );
  }

  // Mismas 10 claves que escribía Godot, ordenadas y con tabulador, para que un
  // diff contra las hojas ya generadas sea legible.
  const meta = {
    angle: opts.angle,
    anim: job.anim,
    directions: opts.directions,
    duration: info.duration,
    fps: opts.fps,
    frame_count: frameCount,
    frame_height: opts.height,
    frame_width: opts.width,
    generated_at: new Date().toISOString().slice(0, 19),
    model: job.model,
  };
  await writeFile(join(outDir, "meta.json"), JSON.stringify(meta, null, "\t"));
  return { outDir, frameCount };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const jobs = resolveJobs(opts);
  console.log(
    `Renderizando ${jobs.length} hoja(s) · ángulo=${opts.angle} dirs=${opts.directions}` +
      ` fps=${opts.fps} frame=${opts.width}×${opts.height}`,
  );
  if (opts.dryRun) {
    for (const j of jobs) console.log(`→ ${j.model}/${j.anim}/${opts.angle}`);
    return 0;
  }
  await mustExist(opts.assets, "raíz de assets");
  await mustExist(CHROME_BIN, "Chrome (define NEFAN_CHROME si está en otro sitio)");

  const { server, port } = await startServer(opts.assets);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    executablePath: CHROME_BIN,
    headless: true,
    // Rasterizado por software: los mismos flags que qa/run.mjs. Sin esto no hay
    // contexto WebGL en headless sin GPU.
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
  });

  const failures = [];
  try {
    for (const job of jobs) {
      console.log(`\n▶ ${job.model}/${job.anim}/${opts.angle}`);
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") pageErrors.push(m.text());
      });
      try {
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => window.__spriteReady === true, null, { timeout: 30_000 });
        const { outDir, frameCount } = await renderJob(page, base, opts, job);
        console.log(`  ✔ ${opts.directions * frameCount} PNG + meta.json en ${outDir}`);
      } catch (err) {
        const extra = pageErrors.length ? `\n    página: ${pageErrors.join("\n    ")}` : "";
        console.error(`  ✘ ${job.model}/${job.anim}: ${err.message}${extra}`);
        failures.push(job);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} trabajo(s) fallaron:`);
    for (const j of failures) console.error(`  ${j.model}/${j.anim}`);
    return 1;
  }
  console.log("\nTodas las hojas renderizadas.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`render-sprite-sheets: ${err.message}`);
    process.exit(2);
  },
);
