/** Página dev: renderiza el clay three.js de PRODUCCIÓN de una plantilla de
 *  estilo — el mismo camino que el juego (buildGreyboxSpec/renderGreybox para
 *  el plató, buildTileGreyboxSpec/renderTileGreybox para el tile oblicuo) —
 *  para capturarlo headless (labs/plantillas/capture.sh) como seed de los
 *  packs de estilo.
 *
 *  Query: ?mode=stage&scene=posada_calle   (fixture de data/scenes/proscenio)
 *         ?mode=tile&scene=settlement      (plan de _plantilla/planes)
 *
 *  Contrato de captura: al terminar pone document.title = "ready" (lo espera
 *  el virtual-time-budget de Chrome headless); un error lo pone en "error" y
 *  lo pinta en #err. */
import { stagePlanFromScene } from "@nefan-core/src/scene/stage/index.js";
import { buildGreyboxSpec } from "@nefan-core/src/scene/stage/greybox.js";
import {
  buildTileGreyboxSpec,
  parseGround,
  parseVolumes,
  type TileGreyboxPlan,
} from "@nefan-core/src/scene/blueprint/index.js";

// Los JSON entran al bundle vía glob (sin server.fs ni rutas absolutas).
const STAGE_FIXTURES = import.meta.glob("@nefan-core/data/scenes/proscenio/*.json");
const TILE_PLANS = import.meta.glob("@nefan-core/data/styles/_plantilla/planes/*.json");

function fail(msg: string, err?: unknown): never {
  const el = document.getElementById("err");
  if (el) {
    el.textContent = `${msg}${err ? `\n${String(err)}` : ""}`;
    el.style.display = "block";
  }
  document.title = "error";
  throw err instanceof Error ? err : new Error(msg);
}

async function loadJson(
  glob: Record<string, () => Promise<unknown>>,
  name: string,
): Promise<Record<string, unknown>> {
  const key = Object.keys(glob).find((k) => k.endsWith(`/${name}.json`));
  if (!key) {
    fail(`no existe "${name}.json" — disponibles: ${Object.keys(glob).map((k) => k.split("/").pop()).join(", ")}`);
  }
  const mod = (await glob[key]()) as { default?: Record<string, unknown> };
  return (mod.default ?? mod) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") ?? "stage";
  const name = params.get("scene") ?? "";
  if (!name) fail("falta ?scene=<nombre>");

  if (mode === "stage") {
    const raw = await loadJson(STAGE_FIXTURES, name);
    const plan = stagePlanFromScene(raw);
    if (!plan) fail(`la fixture "${name}" no tiene bloque stage`);
    const spec = buildGreyboxSpec(plan, name);
    const { renderGreybox } = await import("../scene/stage-greybox-render.js");
    document.body.appendChild(renderGreybox(spec));
  } else if (mode === "tile") {
    const raw = await loadJson(TILE_PLANS, name);
    const ground = parseGround(raw.ground ?? []);
    if (!ground.ok) fail(`ground inválido en "${name}": ${ground.error}`);
    const volumes = parseVolumes(raw.volumes ?? []);
    if (!volumes.ok) fail(`volumes inválido en "${name}": ${volumes.error}`);
    const plan: TileGreyboxPlan = {
      ground: ground.features,
      volumes: volumes.volumes,
      biome: typeof raw.biome === "string" ? raw.biome : undefined,
    };
    const spec = buildTileGreyboxSpec(plan, name);
    const { renderTileGreybox } = await import("../scene/tile-greybox-render.js");
    const { base, occluders } = renderTileGreybox(spec);
    // Composite: base + occluders en orden de baseline (los aéreos al final)
    // — la misma pinta que el tile en juego, en un solo canvas capturable.
    const full = document.createElement("canvas");
    full.width = base.width;
    full.height = base.height;
    const fctx = full.getContext("2d");
    if (!fctx) fail("sin contexto 2d");
    fctx.drawImage(base, 0, 0);
    const vb = spec.camera.view_box;
    const px = spec.camera.px_per_cell;
    const sorted = [...occluders].sort((a, b) =>
      Number(a.occ.overhead ?? false) - Number(b.occ.overhead ?? false) ||
      a.occ.baseline_y - b.occ.baseline_y,
    );
    for (const { occ, canvas } of sorted) {
      fctx.drawImage(canvas, (occ.bbox[0] - vb.minX) * px, (occ.bbox[1] - vb.minY) * px);
    }
    // Recorte al cuadrado del TILE (celdas 0..128): los márgenes del voladizo
    // del view_box son transparencia — ruido en un seed de estilo.
    const side = 128 * px;
    const out = document.createElement("canvas");
    out.width = side;
    out.height = side;
    const ctx = out.getContext("2d");
    if (!ctx) fail("sin contexto 2d");
    ctx.drawImage(full, (0 - vb.minX) * px, (0 - vb.minY) * px, side, side, 0, 0, side, side);
    document.body.appendChild(out);
  } else {
    fail(`mode desconocido "${mode}" (esperaba stage|tile)`);
  }
  document.title = "ready";
}

main().catch((err) => fail("render falló", err));
