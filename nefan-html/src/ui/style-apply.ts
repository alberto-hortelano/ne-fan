/** Batch "aplicar estilo a un juego" — genera y almacena por adelantado los
 *  assets estilizados de (juego, estilo) sobre el snapshot de mundo
 *  pre-generado, con estimación de coste ANTES de gastar (patrón
 *  styles/upload → complete) y registro persistente al terminar.
 *
 *  Corre en el CLIENTE contra remote-gen (:8768) porque reutiliza las claves
 *  de caché naturales del juego: las celdas del atlas se computan con el
 *  MISMO código puro que la partida (buildFpsTileSpec + buildLayout) y los
 *  prompts/roles de skin con las MISMAS reglas que main.ts — lo pre-pintado
 *  aquí es cache-hit exacto en partida. Idempotente: re-ejecutar tras un
 *  corte continúa por cache-hits ($0 en lo ya pagado). */
import type {
  GenerateSurfaceAtlasResponse,
  SkinSpriteSheetResponse,
  StyleCompleteResponse,
  StylesMissingResponse,
  SurfaceCellSpec,
} from "@nefan-core/src/contracts/remote-gen.js";
import { npcSkinStyleRef } from "@nefan-core/src/games/style-categories.js";
import { HOJAS_ANGLE } from "@nefan-core/src/contracts/sprite-census.js";
import {
  AUTO_SKIN_ANIMS,
  SKIN_CALLS_FALLBACK,
  SpriteCatalogSchema,
  skinImageCalls,
  type SpriteCatalog,
} from "@nefan-core/src/contracts/sprite-forge.js";
import {
  STYLE_APPLICATION_SCHEMA_VERSION,
  styleApplicationPinRef,
} from "@nefan-core/src/games/style-application-schema.js";
import { buildFpsTileSpec } from "@nefan-core/src/scene/blueprint/index.js";
import { buildLayout } from "@nefan-core/src/scene/greybox/surfaces.js";
import { formatDToWorld, type WorldScene } from "@nefan-core/src/scene/scene-normalize.js";
import type { NarrativeClient } from "../net/narrative-client.js";

/** Tope de celdas por petición del server (SurfaceAtlasRequest max_length). */
const MAX_CELLS_PER_REQUEST = 64;
/** Celdas por página pintada (pack_missing) — para estimar coste. */
const CELLS_PER_PAGE = 12;
/** Coste aprox. por página de atlas (nano-banana-pro vía fal). */
const ATLAS_PAGE_EST_USD = 0.15;
/** Ángulo del set de sprites: la constante única del censo (nefan-core), la
 *  misma que usa el `worldAngle` de main.ts — eran dos literales atados por
 *  un «DEBE coincidir». El ángulo entra en la clave de caché del skin, así
 *  que cambiarlo EN EL CENSO repaga todo el arte de personaje ya generado. */
const SKIN_ANGLE = HOJAS_ANGLE;

export interface StyleApplyBlock {
  id: "pack" | "atlas" | "skins";
  label: string;
  /** Items que faltan por generar (0 = todo en caché). */
  missing: number;
  /** `null` = coste NO DISPONIBLE (el catálogo contestó pero no puede costear
   *  y dijo por qué — la causa va en `notes`). Se enseña como «coste no
   *  disponible» y decide el usuario: jamás una cifra optimista presentada
   *  como real. */
  estCostUsd: number | null;
  /** true = coste exacto del server; false = estimación (~). */
  exact: boolean;
  selected: boolean;
}

export interface StyleApplyPlan {
  gameId: string;
  styleId: string;
  worldDocHash: string;
  blocks: StyleApplyBlock[];
  notes: string[];
  /** Internos para run(). */
  cells: SurfaceCellSpec[];
  sceneDescription: string;
  skins: Array<{ prompt: string; role?: string }>;
}

/** Corrida de estilo, tal y como la RECUERDA el controlador que la ejecuta.
 *
 *  Un batch que anuncia 3 skins y pide 2 es un bug de facturación: el jugador
 *  ve un coste y paga otro. Contarlo desde fuera contra un reloj no lo caza —
 *  esperar «al menos N peticiones» se agota igual si nunca llegan, y no dice
 *  nada si llegan de más. Aquí queda escrito lo que el plan PROMETIÓ, lo que la
 *  corrida EMITIÓ de verdad y cuándo se dio por terminada, para poder comparar
 *  las tres cosas cuando ya no queda nada en vuelo. */
export interface StyleRunLedger {
  /** Lo que anunció el plan (y por tanto lo que se le cobró al jugador). */
  planned: { skins: number; anims: number; cells: number };
  /** Lo que la corrida llegó a PEDIR de verdad. */
  issued: { skins: number; cells: number };
  /** Peticiones que el server declaró servidas de caché (no repagadas). */
  cached: { skins: number; cells: number };
  /** false mientras haya algo en vuelo. Es la señal de "ya se puede comparar". */
  done: boolean;
  failures: string[];
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
  /** Última corrida (o la que va) — la escribe `run()`, que es el camino que
   *  se prueba: un contador alimentado desde fuera se pondría verde solo. */
  private ledger: StyleRunLedger | null = null;

  /** Estado para el hook __nefan / guiones de QA. */
  debugState(): StyleRunLedger | null {
    return this.ledger ? { ...this.ledger, failures: [...this.ledger.failures] } : null;
  }

  constructor(
    private narrative: NarrativeClient,
    private urls: StyleApplyUrls,
  ) {}

  /** Fase 1 — plan con coste, SIN gastar: snapshot del bridge, celdas de
   *  atlas exactas, roster de skins y pack faltante. Lanza con
   *  motivo si el snapshot no está vigente (generar el mundo primero). */
  async plan(gameId: string, styleId: string): Promise<StyleApplyPlan> {
    const snap = await this.narrative.getWorldSnapshot(gameId);
    if (!snap.ok) throw new Error(snap.error ?? "get_world_snapshot failed");
    if (!snap.snapshot) {
      throw new Error(
        snap.status === "stale"
          ? "el mundo generado quedó obsoleto (world.md cambió) — regenera el mundo primero"
          : "este juego no tiene el mundo generado — genera el mundo primero",
      );
    }
    const snapshot = snap.snapshot as { world_doc_hash: string; scenes: Record<string, SnapshotScene> };
    const scenes = Object.entries(snapshot.scenes);
    const notes: string[] = [];

    // ── Pack del estilo (dry-run exacto del server) ──
    const missRes = await fetch(`${this.urls.remote}/styles/${encodeURIComponent(styleId)}/missing`);
    if (!missRes.ok) throw new Error(`/styles/${styleId}/missing HTTP ${missRes.status}`);
    const pack = (await missRes.json()) as StylesMissingResponse;

    // ── Cuánto cuesta vestir un personaje: se PREGUNTA, no se estima ──
    // El catálogo lo publica sprite-forge y remote-gen lo reexpone. Antes esta
    // cuenta estaba copiada a mano aquí, y es la que se le enseña al usuario
    // justo antes de gastar.
    let catalog: SpriteCatalog | null = null;
    try {
      const catRes = await fetch(`${this.urls.remote}/sprite_catalog`);
      if (!catRes.ok) {
        notes.push(`No se pudo leer el catálogo de sprites (HTTP ${catRes.status}): el coste de los skins es una cota baja.`);
      } else {
        // Se valida contra el contrato zod (validado a su vez contra las
        // fixtures del servicio): un catálogo con otra forma es la misma
        // situación que no tenerlo, y se dice.
        const parsed = SpriteCatalogSchema.safeParse(await catRes.json());
        if (parsed.success) catalog = parsed.data;
        else notes.push(`El catálogo de sprites no cumple el contrato (${parsed.error.issues[0]?.message ?? "?"}): el coste de los skins es una cota baja.`);
      }
    } catch (err) {
      notes.push(`No se pudo leer el catálogo de sprites (${(err as Error).message}): el coste de los skins es una cota baja.`);
    }
    if (catalog && !catalog.skin.enabled) {
      notes.push(`El servicio de sprites no puede vestir personajes: ${catalog.skin.reason}.`);
    }
    // Catálogo INALCANZABLE ⇒ el suelo, etiquetado como estimación en la nota
    // de arriba. Catálogo que contesta pero no puede costear ⇒ coste NO
    // disponible con su causa: el suelo (4 llamadas frente a ~17 reales) no se
    // enseña nunca como si fuera el precio.
    let callsPerSkin: number | null;
    if (!catalog) {
      callsPerSkin = SKIN_CALLS_FALLBACK;
    } else {
      const info = skinImageCalls(catalog);
      if (info.ok) {
        callsPerSkin = info.calls;
      } else {
        callsPerSkin = null;
        notes.push(`El coste de vestir los personajes no está disponible: ${info.reason}`);
      }
    }
    const costPerImage =
      (catalog?.skin.enabled ? catalog.skin.cost_usd_per_call : null) ?? pack.cost_per_image_usd;

    // ── Celdas del atlas: mismas funciones puras que la vista en vivo ──
    // UNA normalización por escena para todo el batch: de ella salen el plan
    // (celdas del atlas) y los npcs/objects (skins). Dos llamadas darían dos
    // composiciones del mismo tile.
    const normalizadas = new Map<string, WorldScene>();
    for (const [sceneId, scene] of scenes) normalizadas.set(sceneId, formatDToWorld(scene));
    let cells: SurfaceCellSpec[] = [];
    let missingCells: number;
    let sceneDescription = "";
    {
      const seen = new Set<string>();
      for (const [sceneId, scene] of scenes) {
        if (scene.tile === undefined) continue;
        if (!sceneDescription && typeof scene.scene_description === "string") {
          sceneDescription = scene.scene_description;
        }
        // El MISMO plan que compone la partida, y por el mismo camino: la
        // normalización de core lo resuelve en `__plan` (src/scene/tile-plan.ts).
        // Antes esto lo recomponía a mano, y el seed que le pasaba —el id de
        // la escena— podía no ser el que usa la partida: mismas celdas por
        // casualidad, otro bosque en cuanto uno de los dos se moviera.
        const world = normalizadas.get(sceneId)!;
        const plan = world.__plan;
        if (!plan) continue;
        const fps = buildFpsTileSpec(plan, sceneId);
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
    }

    // ── Skins: mismas reglas de prompt/rol que la partida (main.ts) ──
    const skinSeen = new Set<string>();
    const skins: Array<{ prompt: string; role?: string }> = [];
    for (const [sceneId] of scenes) {
      const world = normalizadas.get(sceneId)!;
      for (const npc of world.npcs) {
        const prompt = npc.description ?? npc.name;
        if (!prompt || skinSeen.has(prompt)) continue;
        skinSeen.add(prompt);
        // Misma regla que la partida (npcSkinStyleRef) o la clave de caché
        // del skin diverge (doble pago).
        skins.push({ prompt, role: npcSkinStyleRef(npc) });
      }
      // Aquí había un segundo barrido para «enemigos (objects con bloque
      // combat)». Se va con su hermano de main.ts (#323): era el fósil de
      // `data/rooms/*.json` y `formatDToWorld` NUNCA emitió `combat` en
      // `objects[]`, así que no corrió jamás. Un enemigo es hoy un NPC con
      // `role:"hostile"`, o sea que lo cubre el bucle de arriba — y por el
      // mismo camino, con lo cual su clave de caché la deriva `npcSkinStyleRef`
      // igual que en partida (rol `warrior`) en vez de irse sin rol, que es
      // como el barrido viejo la habría hecho divergir el día que hubiera
      // llegado a ejecutarse.
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
      {
        id: "atlas",
        label: `Librería de superficies (${cells.length} celdas, ${missingCells} por pintar)`,
        missing: missingCells,
        estCostUsd:
          Math.round(Math.ceil(missingCells / CELLS_PER_PAGE) * ATLAS_PAGE_EST_USD * 100) / 100,
        exact: false,
        selected: missingCells > 0,
      },
      {
        id: "skins",
        label: `Skins de personaje (${skins.length} personajes × ${AUTO_SKIN_ANIMS.length} anims)`,
        missing: skins.length,
        estCostUsd:
          callsPerSkin === null
            ? null
            : Math.round(skins.length * callsPerSkin * costPerImage * 100) / 100,
        exact: false,
        selected: skins.length > 0,
      },
    ];
    return {
      gameId,
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
    const skinsBlock = plan.blocks.find((b) => b.id === "skins")!;
    const led: StyleRunLedger = {
      planned: {
        skins: selected.has("skins") ? skinsBlock.missing : 0,
        anims: AUTO_SKIN_ANIMS.length,
        cells: selected.has("atlas") ? plan.cells.length : 0,
      },
      issued: { skins: 0, cells: 0 },
      cached: { skins: 0, cells: 0 },
      done: false,
      failures,
    };
    this.ledger = led;

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
        const data = (await res.json()) as StyleCompleteResponse;
        packGenerated = data.generated.length;
        costUsd += data.cost_usd;
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
          led.issued.cells++;
          if (cell.cached) led.cached.cells++;
          else cellsPainted++;
        }
        if (data.missing > 0) {
          failures.push(`atlas: ${data.missing} celdas quedaron sin pintar`);
        }
      }
    }

    if (selected.has("skins")) {
      let done = 0;
      const total = plan.skins.length * AUTO_SKIN_ANIMS.length;
      for (const skin of plan.skins) {
        for (const anim of AUTO_SKIN_ANIMS) {
          done++;
          onProgress(`Skins: ${skin.prompt.slice(0, 32)}… (${done}/${total})`);
          // Se cuenta ANTES de disparar: "emitido" es lo que salió por el
          // cable, lo conteste el server o no.
          led.issued.skins++;
          try {
            const res = await fetch(`${this.urls.remote}/skin_sprite_sheet`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "y_bot",
                anim,
                angle: SKIN_ANGLE,
                prompt: skin.prompt,
                style_id: plan.styleId,
                ...(skin.role ? { style_role: skin.role } : {}),
              }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as SkinSpriteSheetResponse;
            // El servicio real jamás emite un campo `error` con 200 (los
            // fallos van por HTTPException): un 200 sin ok=true viola el
            // contrato y se dice tal cual.
            if (!data.ok) throw new Error("respuesta 200 sin ok=true (viola SkinSpriteSheetResponse)");
            const c = data.meta.skin?.cost_usd ?? 0;
            costUsd += c;
            if (data.cached) led.cached.skins++;
            else skinsPainted++;
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
            styleApplicationPinRef(plan.gameId, plan.styleId),
          )}`,
          { method: "DELETE" },
        ).catch(() => undefined);
        const res = await fetch(`${this.urls.assets}/assets/pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ref: styleApplicationPinRef(plan.gameId, plan.styleId),
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

    // Ya no queda nada en vuelo: a partir de aquí lo emitido es comparable con
    // lo prometido. Es la señal que sustituye a "espera 90 s a ver si llegan".
    led.done = true;

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
