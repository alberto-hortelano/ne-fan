/** Batch "aplicar estilo a un juego" — genera y almacena por adelantado los
 *  assets estilizados de (juego, vista, estilo) sobre el snapshot de mundo
 *  pre-generado, con estimación de coste ANTES de gastar (patrón
 *  styles/upload → complete) y registro persistente al terminar.
 *
 *  Corre en el CLIENTE contra remote-gen (:8768) porque reutiliza las claves
 *  de caché naturales del juego: las celdas del atlas se computan con el
 *  MISMO código puro que la vista fps (buildFpsTileSpec + buildLayout) y los
 *  prompts/roles de skin con las MISMAS reglas que main.ts — lo pre-pintado
 *  aquí es cache-hit exacto en partida. Idempotente: re-ejecutar tras un
 *  corte continúa por cache-hits ($0 en lo ya pagado).
 *
 *  Alcance v1 (REPORTADO en notes, nunca omitido en silencio): el repintado
 *  de tiles oblicuos y platós proscenio NO se pre-genera — su plano base es
 *  el clay WebGL del renderer en vivo y su clave depende de los vecinos ya
 *  pintados al explorar. Esos se pintan lazy en partida, como hoy. */
import type {
  GenerateSurfaceAtlasResponse,
  StylesMissingResponse,
  SurfaceCellSpec,
} from "@nefan-core/src/contracts/remote-gen.js";
import { npcSkinStyleRef } from "@nefan-core/src/games/style-categories.js";
import {
  STYLE_APPLICATION_SCHEMA_VERSION,
  styleApplicationPinRef,
} from "@nefan-core/src/games/style-application-schema.js";
import {
  buildFpsTileSpec,
  deriveVolumesFromSchema,
  parseGround,
  parseVolumes,
  type GroundFeature,
  type Volume,
} from "@nefan-core/src/scene/blueprint/index.js";
import { buildLayout } from "@nefan-core/src/scene/greybox/surfaces.js";
import { formatDToWorld } from "@nefan-core/src/scene/scene-normalize.js";
import type { NarrativeClient } from "../net/narrative-client.js";

/** Tope de celdas por petición del server (SurfaceAtlasRequest max_length). */
const MAX_CELLS_PER_REQUEST = 64;
/** Celdas por página pintada (pack_missing) — para estimar coste. */
const CELLS_PER_PAGE = 12;
/** Coste aprox. por página de atlas (nano-banana-pro vía fal). */
const ATLAS_PAGE_EST_USD = 0.15;
/** Llamadas de imagen por skin: 1 hero + lotes de atlas por anim auto.
 *  Espejo de `plan_dir_batches` (ai_server/sprite_skin_meshy.py, techo
 *  ATLAS_MAX_CELLS=10): idle (8 kf) = 8 lotes, walk/run (4 kf) = 4 lotes de
 *  2 direcciones. */
const SKIN_IMAGE_CALLS = 1 + 8 + 4 + 4;
const AUTO_SKIN_ANIMS = ["idle", "walk", "run"] as const;
/** Set de sprites por vista — DEBE coincidir con el `worldAngle` de main.ts
 *  ("frontal_8") o el skin pre-generado no es el que pedirá la partida. La
 *  tabla sobrevive a las dos vistas retiradas porque el vocabulario `view`
 *  sigue vivo en el contrato del bridge; el título ya solo pide "fps". */
const ANGLE_BY_VIEW: Record<string, string> = {
  overworld: "isometric_30",
  proscenium: "frontal_8",
  fps: "frontal_8",
};

export interface StyleApplyBlock {
  id: "pack" | "atlas" | "skins";
  label: string;
  /** Items que faltan por generar (0 = todo en caché). */
  missing: number;
  estCostUsd: number;
  /** true = coste exacto del server; false = estimación (~). */
  exact: boolean;
  selected: boolean;
}

export interface StyleApplyPlan {
  gameId: string;
  view: string;
  styleId: string;
  worldDocHash: string;
  blocks: StyleApplyBlock[];
  notes: string[];
  /** Internos para run(). */
  cells: SurfaceCellSpec[];
  sceneDescription: string;
  skins: Array<{ prompt: string; role?: string }>;
}

export interface StyleApplyResult {
  costUsd: number;
  cellsPainted: number;
  skinsPainted: number;
  packGenerated: number;
  failures: string[];
}

export interface StyleApplyUrls {
  remote: string;
  assets: string;
}

interface SnapshotScene {
  scene_id?: string;
  tile?: unknown;
  biome?: string;
  ground?: unknown[];
  volumes?: unknown[];
  scatter_generators?: unknown;
  scatter_zones?: unknown[];
  scene_description?: string;
  [k: string]: unknown;
}

export class StyleApplyController {
  constructor(
    private narrative: NarrativeClient,
    private urls: StyleApplyUrls,
  ) {}

  /** Fase 1 — plan con coste, SIN gastar: snapshot del bridge, celdas de
   *  atlas exactas (vista fps), roster de skins y pack faltante. Lanza con
   *  motivo si el snapshot no está vigente (generar el mundo primero). */
  async plan(gameId: string, view: string, styleId: string): Promise<StyleApplyPlan> {
    const snap = await this.narrative.getWorldSnapshot(gameId, view);
    if (!snap.ok) throw new Error(snap.error ?? "get_world_snapshot failed");
    if (!snap.snapshot) {
      throw new Error(
        snap.status === "stale"
          ? "el mundo generado quedó obsoleto (world.md cambió) — regenera el mundo primero"
          : "este juego no tiene el mundo generado para esta vista — genera el mundo primero",
      );
    }
    const snapshot = snap.snapshot as { world_doc_hash: string; scenes: Record<string, SnapshotScene> };
    const scenes = Object.entries(snapshot.scenes);
    const notes: string[] = [];

    // ── Pack del estilo (dry-run exacto del server) ──
    const missRes = await fetch(`${this.urls.remote}/styles/${encodeURIComponent(styleId)}/missing`);
    if (!missRes.ok) throw new Error(`/styles/${styleId}/missing HTTP ${missRes.status}`);
    const pack = (await missRes.json()) as StylesMissingResponse;

    // ── Celdas del atlas fps: mismas funciones puras que la vista en vivo ──
    let cells: SurfaceCellSpec[] = [];
    let missingCells = 0;
    let sceneDescription = "";
    if (view === "fps") {
      const seen = new Set<string>();
      for (const [sceneId, scene] of scenes) {
        if (scene.tile === undefined) continue;
        if (!sceneDescription && typeof scene.scene_description === "string") {
          sceneDescription = scene.scene_description;
        }
        // MISMO plan que compone la partida (composeTilePlan de main.ts):
        // ground/volumes parseados + volúmenes DERIVADOS del esquema — sin
        // esto las celdas no casarían con las que pedirá la vista fps.
        let ground: GroundFeature[] = [];
        if (Array.isArray(scene.ground)) {
          const parsed = parseGround(scene.ground);
          if (parsed.ok) ground = parsed.features;
        }
        let declared: Volume[] = [];
        if (Array.isArray(scene.volumes)) {
          const parsed = parseVolumes(scene.volumes);
          if (parsed.ok) declared = parsed.volumes;
        }
        const derived = deriveVolumesFromSchema(
          {
            scene_id: sceneId,
            structures: scene.structures as never,
            vegetation_zones: scene.vegetation_zones as never,
            entities: scene.entities as never,
          },
          declared,
        );
        const volumes = [...declared, ...derived];
        if (ground.length === 0 && volumes.length === 0) continue;
        const fps = buildFpsTileSpec(
          {
            ground,
            volumes,
            biome: scene.biome as never,
            scatter_generators: scene.scatter_generators as never,
            scatter_zones: scene.scatter_zones as never,
            scene_description: scene.scene_description as never,
          },
          sceneId,
        );
        const layout = buildLayout(fps.primsM);
        for (const page of layout.pages) {
          for (const c of page.cells) {
            // Identidad del asset = lo que entra en la clave del server.
            const identity = JSON.stringify([c.en, c.mat, c.kind, c.hints ?? [], c.ref ?? ""]);
            if (seen.has(identity)) continue;
            seen.add(identity);
            cells.push({
              key: c.key,
              mat: c.mat,
              kind: c.kind,
              desc: c.en,
              ...(c.ref !== undefined ? { ref: c.ref } : {}),
              base_color: c.baseColor,
              world_w: c.worldW,
              world_h: c.worldH,
              hints: c.hints,
            });
          }
        }
      }
      // Claves duplicadas entre tiles (misma key, distinta identidad) chocan
      // dentro de una petición: renombrar manteniendo la identidad del hash
      // (la clave de caché del server usa desc+contexto, no `key`).
      const usedKeys = new Set<string>();
      cells = cells.map((c) => {
        let k = c.key;
        for (let i = 2; usedKeys.has(k); i++) k = `${c.key}__${i}`;
        usedKeys.add(k);
        return k === c.key ? c : { ...c, key: k };
      });
      missingCells = await this.resolveMissing(cells, sceneDescription, styleId);
    } else {
      notes.push(
        view === "overworld"
          ? "Repintado de tiles oblicuos: se pinta al explorar (su plano base es el render en vivo)."
          : "Repintado de platós: se pinta al entrar en cada escena (su plano base es el render en vivo).",
      );
    }

    // ── Skins: mismas reglas de prompt/rol que la partida (main.ts) ──
    const skinSeen = new Set<string>();
    const skins: Array<{ prompt: string; role?: string }> = [];
    for (const [, scene] of scenes) {
      const world = formatDToWorld(scene as Record<string, unknown>) as {
        npcs?: Array<{ id: string; name?: string; description?: string; role?: string; style_ref?: string }>;
        objects?: Array<{ id: string; description?: string; combat?: unknown }>;
      };
      for (const npc of world.npcs ?? []) {
        const prompt = npc.description ?? npc.name ?? npc.id;
        if (!prompt || skinSeen.has(prompt)) continue;
        skinSeen.add(prompt);
        // Misma regla que la partida (npcSkinStyleRef) o la clave de caché
        // del skin diverge (doble pago).
        skins.push({ prompt, role: npcSkinStyleRef(npc) });
      }
      // Enemigos (objects con bloque combat): mismo prompt que main.ts, sin
      // rol (el cliente en partida tampoco lo envía — paridad de clave).
      for (const obj of world.objects ?? []) {
        if (!obj.combat) continue;
        const prompt = obj.description ?? obj.id;
        if (!prompt || skinSeen.has(prompt)) continue;
        skinSeen.add(prompt);
        skins.push({ prompt });
      }
    }
    if (skins.length === 0) notes.push("El mundo generado no declara personajes con skin.");

    const blocks: StyleApplyBlock[] = [
      {
        id: "pack",
        label: `Referencias del estilo (${pack.missing.length} categorías)`,
        missing: pack.missing.length,
        estCostUsd: pack.estimated_cost_usd,
        exact: true,
        selected: pack.missing.length > 0,
      },
      ...(view === "fps"
        ? [
            {
              id: "atlas" as const,
              label: `Librería de superficies fps (${cells.length} celdas, ${missingCells} por pintar)`,
              missing: missingCells,
              estCostUsd:
                Math.round(Math.ceil(missingCells / CELLS_PER_PAGE) * ATLAS_PAGE_EST_USD * 100) /
                100,
              exact: false,
              selected: missingCells > 0,
            },
          ]
        : []),
      {
        id: "skins",
        label: `Skins de personaje (${skins.length} personajes × ${AUTO_SKIN_ANIMS.length} anims)`,
        missing: skins.length,
        estCostUsd:
          Math.round(skins.length * SKIN_IMAGE_CALLS * pack.cost_per_image_usd * 100) / 100,
        exact: false,
        selected: skins.length > 0,
      },
    ];
    return {
      gameId,
      view,
      styleId,
      worldDocHash: snapshot.world_doc_hash,
      blocks,
      notes,
      cells,
      sceneDescription: sceneDescription || "materials and people of this world",
      skins,
    };
  }

  /** Fase 2 — ejecutar los bloques SELECCIONADOS (el caller ya confirmó el
   *  coste). Secuencial, con progreso; los fallos por item se acumulan y
   *  REPORTAN (un skin caído no aborta el batch). Al terminar: pin de los
   *  hashes en el asset-store + registro en el bridge. */
  async run(
    plan: StyleApplyPlan,
    onProgress: (message: string) => void,
  ): Promise<StyleApplyResult> {
    let costUsd = 0;
    let packGenerated = 0;
    let cellsPainted = 0;
    let skinsPainted = 0;
    const failures: string[] = [];
    const pinnedHashes = new Set<string>();
    const selected = new Set(plan.blocks.filter((b) => b.selected).map((b) => b.id));

    if (selected.has("pack") && plan.blocks.find((b) => b.id === "pack")!.missing > 0) {
      onProgress("Completando las referencias del estilo…");
      const res = await fetch(
        `${this.urls.remote}/styles/${encodeURIComponent(plan.styleId)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        },
      );
      if (!res.ok) {
        failures.push(`pack del estilo: HTTP ${res.status} ${await res.text().catch(() => "")}`);
      } else {
        const data = (await res.json()) as { generated?: string[]; cost_usd?: number };
        packGenerated = data.generated?.length ?? 0;
        costUsd += data.cost_usd ?? 0;
      }
    }

    if (selected.has("atlas") && plan.cells.length > 0) {
      for (let i = 0; i < plan.cells.length; i += MAX_CELLS_PER_REQUEST) {
        const chunk = plan.cells.slice(i, i + MAX_CELLS_PER_REQUEST);
        onProgress(
          `Pintando la librería de superficies (${Math.min(i + chunk.length, plan.cells.length)}/${plan.cells.length} celdas)…`,
        );
        const res = await fetch(`${this.urls.remote}/generate_surface_atlas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cells: chunk,
            scene_description: plan.sceneDescription,
            style_id: plan.styleId,
          }),
        });
        if (!res.ok) {
          failures.push(`atlas (lote ${i / MAX_CELLS_PER_REQUEST + 1}): HTTP ${res.status}`);
          continue;
        }
        const data = (await res.json()) as GenerateSurfaceAtlasResponse;
        costUsd += data.cost_usd;
        for (const cell of Object.values(data.cells)) {
          pinnedHashes.add(cell.hash);
          if (!cell.cached) cellsPainted++;
        }
        if (data.missing > 0) {
          failures.push(`atlas: ${data.missing} celdas quedaron sin pintar`);
        }
      }
    }

    if (selected.has("skins")) {
      const angle = ANGLE_BY_VIEW[plan.view] ?? "isometric_30";
      let done = 0;
      const total = plan.skins.length * AUTO_SKIN_ANIMS.length;
      for (const skin of plan.skins) {
        for (const anim of AUTO_SKIN_ANIMS) {
          done++;
          onProgress(`Skins: ${skin.prompt.slice(0, 32)}… (${done}/${total})`);
          try {
            const res = await fetch(`${this.urls.remote}/skin_sprite_sheet`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "y_bot",
                anim,
                angle,
                prompt: skin.prompt,
                style_id: plan.styleId,
                ...(skin.role ? { style_role: skin.role } : {}),
              }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as {
              ok?: boolean;
              cached?: boolean;
              meta?: { skin?: { cost_usd?: number } };
              error?: string;
            };
            if (!data.ok) throw new Error(data.error ?? "sin ok en la respuesta");
            const c = data.meta?.skin?.cost_usd ?? 0;
            costUsd += c;
            if (!data.cached) skinsPainted++;
          } catch (err) {
            failures.push(`skin "${skin.prompt.slice(0, 32)}" (${anim}): ${(err as Error).message}`);
          }
        }
      }
    }

    // Pin de lo pre-generado contra el prune (aún no hay save que lo
    // referencie). Los sprite sheets no pasan por el manifest — no se pinean.
    if (pinnedHashes.size > 0) {
      onProgress("Protegiendo los assets pre-generados…");
      try {
        // Regenerar estilo: soltar los pins de la aplicación anterior antes
        // de pinear los nuevos (mismo ref) — los assets del snapshot viejo
        // vuelven a ser podables.
        await fetch(
          `${this.urls.assets}/assets/pin/${encodeURIComponent(
            styleApplicationPinRef(plan.gameId, plan.view, plan.styleId),
          )}`,
          { method: "DELETE" },
        ).catch(() => undefined);
        const res = await fetch(`${this.urls.assets}/assets/pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ref: styleApplicationPinRef(plan.gameId, plan.view, plan.styleId),
            hashes: [...pinnedHashes],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        failures.push(`pin en el asset-store falló (el prune podría podarlos): ${(err as Error).message}`);
      }
    }

    onProgress("Registrando la aplicación del estilo…");
    const atlasTotal = plan.cells.length;
    const rec = await this.narrative.recordStyleApplication({
      schema_version: STYLE_APPLICATION_SCHEMA_VERSION,
      game_id: plan.gameId,
      view: plan.view,
      style_id: plan.styleId,
      world_doc_hash: plan.worldDocHash,
      applied_at: new Date().toISOString(),
      pinned_hashes: [...pinnedHashes],
      summary: {
        pack_generated: packGenerated,
        atlas_cells_painted: cellsPainted,
        atlas_cells_total: atlasTotal,
        skins_painted: skinsPainted,
        skins_total: plan.skins.length,
        cost_usd: Math.round(costUsd * 100) / 100,
      },
      notes: [...plan.notes, ...failures.map((f) => `fallo: ${f}`)].slice(0, 32),
    });
    if (!rec.ok) failures.push(`registro no persistido: ${rec.error ?? "error desconocido"}`);

    return {
      costUsd: Math.round(costUsd * 100) / 100,
      cellsPainted,
      skinsPainted,
      packGenerated,
      failures,
    };
  }

  /** resolve_only contra la librería ($0): cuántas celdas faltan por pintar. */
  private async resolveMissing(
    cells: SurfaceCellSpec[],
    sceneDescription: string,
    styleId: string,
  ): Promise<number> {
    let missing = 0;
    for (let i = 0; i < cells.length; i += MAX_CELLS_PER_REQUEST) {
      const res = await fetch(`${this.urls.remote}/generate_surface_atlas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells: cells.slice(i, i + MAX_CELLS_PER_REQUEST),
          scene_description: sceneDescription || "materials of this world",
          style_id: styleId,
          resolve_only: true,
        }),
      });
      if (!res.ok) throw new Error(`/generate_surface_atlas (resolve) HTTP ${res.status}`);
      const data = (await res.json()) as GenerateSurfaceAtlasResponse;
      missing += data.missing;
    }
    return missing;
  }
}
