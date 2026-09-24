/** Atlas de superficies de la vista fps: el pipeline de imagen de la vista.
 *
 *  Al activarse un tile en la vista fps: layout determinista de superficies →
 *  caché cliente por (layoutKey = hash del layout canónico + estilo + versión)
 *  → si los gates dejan generar (Imagen IA en producción), POST /generate_surface_atlas (el server
 *  resuelve por CELDA contra la librería y pinta solo lo que falta) → fetch de
 *  cada celda del asset-store → texturas al FpsRenderer. Las celdas usadas se
 *  registran en el world-state (/scene/asset_refs) para la keep-list del
 *  prune. Cualquier fallo degrada a clay con error visible. */

import type {
  GenerateSurfaceAtlasResponse,
  SurfaceCellResult,
  SurfaceCellSpec,
} from "@nefan-core/src/contracts/remote-gen.js";
import {
  canonicalSurfaceLayoutJson,
  type SurfaceLayout,
} from "@nefan-core/src/scene/greybox/surfaces.js";
import {
  PoliticaDeAtlas,
  TOPE_DE_CORRIDA_MS,
  lineaDeBalance,
  type AlQuedarLibre,
  type Desenlace,
  type Restauracion,
} from "@nefan-core/src/scene/politica-de-atlas.js";
import type { PermisoDeEscenarios } from "@nefan-core/src/session/gates-de-imagen.js";
import { debugLogEnabled } from "../dev/debug-log.js";
import { errors } from "../ui/error-log.js";
import { cargarImagen, guardarMapping, leerMapping } from "./mapping-del-atlas.js";
import { conTope, registrarRefs, sha256Hex } from "./red-del-atlas.js";
import type { AtlasImage } from "../renderer/fps-gl.js";
import type { ArtePendiente } from "../renderer/types.js";

/** Versión CLIENTE del pipeline: bump ⇒ invalida instalaciones previas.
 *  v2: celdas hero por cara/rol (SURFACE_LAYOUT_VERSION 2). */
const FPS_ATLAS_CLIENT_VERSION = 2;
const CLIENT_CACHE_MAX = 12;
/** Tope de celdas por petición del server (SurfaceAtlasRequest max_length). */
const MAX_CELLS_PER_REQUEST = 64;

export interface FpsAtlasUrls {
  remote: string;
  assets: string;
  /** State API del bridge (keep-list del prune); "" = sin registro. */
  state: string;
}

export interface FpsAtlasDeps {
  /** Superficies del tile (FpsRenderer.getTileSurfaces) + metadatos. */
  getTile(key: string): {
    layout: SurfaceLayout;
    sceneDescription: string;
  } | null;
  apply(key: string, images: Map<string, AtlasImage>): void;
  clear(key: string): void;
  /** Tiles instalados sin textura (FpsRenderer.tilesSinAtlas), en su orden. */
  tilesSinAtlas(): string[];
  /** Qué hace un camino AUTOMÁTICO (activo o vecino): `generar` o `restaurar` (`gatesDeImagen`). */
  modoDeEscenarios(): PermisoDeEscenarios;
  log(msg: string): void;
  onGeneration?(e: { kind: "fps_atlas"; cached: boolean }): void;
  /** Solo para tests: el tope de una corrida (`TOPE_DE_CORRIDA_MS`). */
  topeDeCorridaMs?: number;
}

/** Para el ciclo del activo, que no se pregunta si sigue mandando al
 *  reinstalar de memoria o del mapping (su corrida nace después, en `runFor`). */
const SIEMPRE = (): boolean => true;

/** Las líneas POR TILE de una restauración van a la traza de desarrollo, no al
 *  HUD: al reanudar eran ocho seguidas y tapaban el registro de la partida
 *  (QA de #714, H1). Al HUD va UNA línea al vaciarse el carril. */
const traza = (msg: string): void => {
  if (debugLogEnabled()) console.log(`[fps-atlas] ${msg}`);
};

export class FpsAtlasController {
  private styleId = "";
  private cache = new Map<string, { layoutKey: string; images: Map<string, AtlasImage> }>();
  /** Qué tile arranca, cuál se encola y qué corrida sigue mandando lo decide
   *  core (`PoliticaDeAtlas`: no pagar dos veces, no descartar en silencio). Aquí
   *  solo queda el fetch, las imágenes y el renderer. */
  private politica = new PoliticaDeAtlas();

  constructor(
    private urls: FpsAtlasUrls,
    private deps: FpsAtlasDeps,
  ) {}

  setStyle(styleId: string): void {
    this.styleId = styleId;
  }

  get running(): boolean {
    return this.politica.enVuelo;
  }

  /** Restauraciones de tiles no activos sin terminar (encoladas + en vuelo).
   *  No entra en `running`: el `ready` del hook sigue siendo el del tile que
   *  pisa el jugador, y lo publica `status()` aparte para quien quiera
   *  esperarlas. */
  get restaurando(): number {
    return this.politica.restaurando;
  }

  /** ¿Algo en vuelo sobre ESTA clave (corrida o restauración)? Lo decide core. */
  ocupada(key: string): boolean {
    return this.politica.ocupada(key);
  }

  /** Los tiles que aún van en clay, como arte pendiente del menú dev. Los
   *  cuenta el renderer (`tilesSinAtlas`) y los pide este controller: el que
   *  cuenta es el que genera (#492). `inFlight` es de la FILA: solo la clave
   *  ocupada dice «Generando…» (QA de la tanda AX, H-4) — también con una
   *  corrida `resolve_only` o una restauración, porque un segundo POST de la
   *  misma clave es pagar dos veces (H-1). */
  pendientes(): ArtePendiente[] {
    return this.deps.tilesSinAtlas().map((key) => ({
      kind: "fps_atlas",
      id: key,
      label: `Atlas fps ${key} (clay — celdas ya en la librería salen gratis)`,
      // Sin miniatura: una del canvas WebGL es otro trabajo.
      thumb: null,
      inFlight: this.ocupada(key),
      generar: () => this.runFor(key),
    }));
  }

  /** Las claves que se están PINTANDO (no las que solo restauran): el panel
   *  dev las nombra (QA de las tandas A, H3, y AX, H-3). */
  get clavesPintando(): string[] {
    return this.politica.clavesPintando;
  }


  /** Tile activo nuevo. El arte YA PAGADO se restaura SIEMPRE (también en
   *  modo vector — lo ya pintado se conserva): memoria →
   *  mapping persistido (solo asset-store) → resolve_only contra la librería
   *  ($0). Pintar celdas nuevas solo con la generación activa. Un tile activo
   *  NUEVO nunca espera a la corrida de otro tile ni la desecha: cada una
   *  aplica a su clave (#729); la MISMA clave se deduplica y se re-dispara al
   *  quedar libre. Las reglas y sus incidentes ($0.15×2 el 2026-08-14; el
   *  tile del jugador descartado al reanudar, #390; el arte del menú dev
   *  tirado al cruzar de tile, #729) viven en `PoliticaDeAtlas`, en core. */
  async onActiveTile(key: string): Promise<void> {
    if (this.politica.pedir(key) === "encolado") return;
    try {
      if (await this.reinstallIfCached(key, SIEMPRE)) return;
      // Sin estilo NO se resuelve nada (style_id "" no es la partida de nadie).
      // En partida no ocurre: el estilo llega antes que cualquier escena (#730,
      // `nefan-core/test/el-estilo-llega-antes-que-la-escena.test.ts` y guion
      // 183). Aquí solo llega la fixture del selector «Room» sin partida.
      if (!this.styleId) {
        this.deps.log(`Atlas fps de ${key}: sin estilo de sesión (fixture sin partida) — clay`);
        return;
      }
      if (await this.reinstallFromStorage(key, SIEMPRE, this.deps.log)) return;
      await this.runFor(key, { resolveOnly: this.deps.modoDeEscenarios() !== "generar", origen: "activo" });
    } finally {
      this.redisparar(key, this.politica.terminar(key));
      // El activo cedió el paso: las restauraciones de los vecinos que
      // esperaban a que terminase pueden salir.
      this.bombearRestauraciones();
    }
  }

  /** Lo que core devolvió al quedar libre la clave. Es la ÚLTIMA oportunidad
   *  de ese tile: si se la come un catch mudo, se queda en clay sin que nada
   *  lo diga. La manual pinta salvo que la corrida que esperaba ya dejara el
   *  atlas completo en memoria (dos G seguidas no pagan dos veces). */
  private redisparar(key: string, que: AlQuedarLibre): void {
    if (que === "nada") return;
    const p =
      que === "activo"
        ? this.onActiveTile(key)
        : this.reinstallIfCached(key, SIEMPRE).then((hit) => (hit ? undefined : this.runFor(key)));
    // `scene` (tanda F, QA H-2): lo que falla es el atlas de UN TILE.
    void p.catch((err) => errors.push("scene", `re-disparo del atlas de ${key}`, err));
  }

  /** Un tile INSTALADO que no es el activo (vecinos del resume, prefetch):
   *  recupera su arte YA PAGADO (#714) y, si los gates dejan generar, pinta lo
   *  que falte — el mismo trato que el activo (`gatesDeImagen`). Nunca toca
   *  la corrida del activo y espera a que termine su ciclo. Síncrono:
   *  encola y vuelve; los fallos van al error-log desde la bomba. */
  restaurar(key: string): void {
    this.politica.encolarRestauracion(key);
    this.bombearRestauraciones();
  }

  /** Cambio de mundo: lo encolado y lo que va en el aire —restauraciones y
   *  corridas— es del anterior. */
  cambioDeMundo(): void {
    this.politica.cambioDeMundo();
  }

  private bombearRestauraciones(): void {
    const r = this.politica.siguienteRestauracion();
    if (!r) return;
    void this.ejecutarRestauracion(r)
      .catch((err: unknown): Desenlace => {
        errors.push("scene", `la restauración del atlas de ${r.key} falló — se queda en clay`, err);
        return "nada";
      })
      .then((d) => {
        const { balance, alQuedarLibre } = this.politica.finDeRestauracion(r, d);
        if (balance) this.deps.log(lineaDeBalance(balance)); // UNA línea de HUD por tanda
        this.redisparar(r.key, alQuedarLibre);
        this.bombearRestauraciones();
      });
  }

  /** La escalera de siempre —memoria → mapping → librería— sin `nuevoRun`.
   *  Si pinta, lo dice (`onGeneration`, `pintado`). */
  private async ejecutarRestauracion(r: Restauracion): Promise<Desenlace> {
    const sigueMandando = () => this.politica.restauracionVigente(r);
    const aplicado = (): Desenlace => (sigueMandando() ? "aplicado" : "nada");
    if (await this.reinstallIfCached(r.key, sigueMandando)) return aplicado();
    if (!sigueMandando()) return "nada";
    if (!this.styleId) { // solo la fixture sin partida (#730)
      traza(`${r.key}: restauración sin estilo de sesión — clay`);
      return "nada";
    }
    if (await this.reinstallFromStorage(r.key, sigueMandando, traza)) return aplicado();
    const tile = this.deps.getTile(r.key);
    if (!tile || !sigueMandando()) return "nada";
    const resolveOnly = this.deps.modoDeEscenarios() !== "generar";
    return conTope(r.key, this.deps.topeDeCorridaMs ?? TOPE_DE_CORRIDA_MS, (signal) => this.resolverYAplicar(r.key, tile, resolveOnly, sigueMandando, traza, signal));
  }

  /** `sigueMandando` = false tras el `await` ⇒ no aplica, y cuenta como
   *  resuelto (quien lo superó se encarga del tile). */
  async reinstallIfCached(key: string, sigueMandando: () => boolean): Promise<boolean> {
    const tile = this.deps.getTile(key);
    if (!tile) return false;
    const layoutKey = await this.layoutKeyFor(tile.layout);
    const hit = this.cache.get(key);
    if (!hit || hit.layoutKey !== layoutKey) return false;
    if (sigueMandando()) this.deps.apply(key, hit.images);
    return true;
  }

  /** Generación manual (tecla G / menú dev) o auto (onActiveTile, `origen:
   *  "activo"`). Con `resolveOnly` NUNCA pinta: restaura lo que ya exista en
   *  la librería. Una corrida de otra clave no la desecha (#729): aplica a su
   *  tile mientras siga instalado con el mismo layout. */
  async runFor(
    key: string,
    { resolveOnly = false, origen = "manual" }: { resolveOnly?: boolean; origen?: "activo" | "manual" } = {},
  ): Promise<void> {
    const tile = this.deps.getTile(key);
    if (!tile) return;
    // Generación manual sin estilo: fail-loud. Pintar un atlas contra
    // `style_id` vacío gasta créditos en arte que ninguna partida volverá a
    // encontrar (la clave de caché del server lleva el estilo dentro).
    if (!this.styleId) {
      errors.push(
        "scene",
        `atlas fps de ${key}: no hay estilo de sesión (una fixture no lo tiene). ` +
          "Empieza una partida para que el arte que se pague sea reutilizable.",
      );
      return;
    }
    const token = this.politica.nuevoRun(key, { pinta: !resolveOnly, origen });
    if (token === "encolada") {
      // Core la encoló y la lanza al quedar libre la clave; la manual lo dice.
      if (origen === "manual") this.deps.log(`Atlas fps de ${key}: ya hay una corrida en vuelo — se pinta en cuanto acabe`);
      return;
    }
    // Sin el corte global de antes de #729 la clave no basta: el tile pudo
    // reinstalarse en vuelo con OTRA escena. La misma re-difundida sí aplica.
    const huella = canonicalSurfaceLayoutJson(tile.layout);
    const mismoLayout = (l: SurfaceLayout | undefined) => l === tile.layout || (!!l && canonicalSurfaceLayoutJson(l) === huella);
    const sigueMandando = () => this.politica.vigente(key, token) && mismoLayout(this.deps.getTile(key)?.layout);
    try {
      await conTope(key, this.deps.topeDeCorridaMs ?? TOPE_DE_CORRIDA_MS, (signal) => this.resolverYAplicar(key, tile, resolveOnly, sigueMandando, this.deps.log, signal));
    } catch (err) {
      errors.push("scene", `el atlas fps de ${key} falló — se queda en clay`, err);
    } finally {
      this.redisparar(key, this.politica.finDeRun(key, token));
    }
  }

  /** POST del atlas (troceado) + descargas + keep-list + aplicar + caché. No
   *  decide quién manda: se lo pregunta a `sigueMandando` antes de aplicar
   *  (la corrida de la clave en `runFor`; el id de la restauración en el
   *  carril de los vecinos). Lanza si falla: el llamante tiene el canal. */
  private async resolverYAplicar(
    key: string,
    tile: { layout: SurfaceLayout; sceneDescription: string },
    resolveOnly: boolean,
    sigueMandando: () => boolean,
    anunciar: (msg: string) => void,
    signal: AbortSignal,
  ): Promise<Desenlace> {
    const layoutKey = await this.layoutKeyFor(tile.layout);
    const cells = this.flattenCells(tile.layout);
    if (cells.length === 0) return "nada";
    if (!resolveOnly) anunciar(`Atlas fps del tile ${key}: ${cells.length} superficies…`);
    // El server capa cells a 64 por petición: trocear y fusionar (cada celda
    // se resuelve independiente contra la librería). El acumulador NO es una
    // `GenerateSurfaceAtlasResponse`: arrastraba `quoted_*` sin comprobar que
    // fueran números, y un servidor que no los mandara propagaba `NaN`.
    const data = {
      cells: {} as Record<string, SurfaceCellResult>,
      pages_painted: 0,
      cached: true,
      cost_usd: 0,
      missing: 0,
    };
    for (let i = 0; i < cells.length; i += MAX_CELLS_PER_REQUEST) {
      const res = await fetch(`${this.urls.remote}/generate_surface_atlas`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells: cells.slice(i, i + MAX_CELLS_PER_REQUEST),
          scene_description: tile.sceneDescription || "a medieval settlement",
          style_id: this.styleId || undefined,
          layout_key: layoutKey.slice(0, 64),
          resolve_only: resolveOnly || undefined,
        }),
      });
      if (!res.ok) throw new Error(`generate_surface_atlas: HTTP ${res.status} ${await res.text()}`);
      const part = (await res.json()) as GenerateSurfaceAtlasResponse;
      Object.assign(data.cells, part.cells);
      data.pages_painted += part.pages_painted;
      data.cached = data.cached && part.cached;
      data.cost_usd = Math.round((data.cost_usd + part.cost_usd) * 100) / 100;
      data.missing += part.missing;
    }
    if (!resolveOnly) this.deps.onGeneration?.({ kind: "fps_atlas", cached: data.cached });
    // Keep-list ANTES del corte de vigencia: si la corrida dejó de mandar en
    // vuelo (cambio de mundo, tile reinstalado), su arte (pagado o de la
    // librería) sigue siendo de esa escena y el prune no debe podarlo.
    void registrarRefs(this.urls.state, key, Object.values(data.cells).map((c) => c.hash));
    if (!sigueMandando()) return "nada"; // ya no manda: no toca el renderer

    const resolvedKeys = Object.keys(data.cells);
    if (resolvedKeys.length === 0) {
      // Nada en la librería para este layout+estilo (tile aún sin pagar).
      if (resolveOnly) {
        anunciar(`Atlas fps de ${key}: sin celdas en la librería (clay — G o Imágenes… para pintar)`);
        return "sin-arte";
      }
      throw new Error("atlas sin celdas descargables");
    }

    const kindByKey = new Map(cells.map((c) => [c.key, c.kind]));
    const images = new Map<string, AtlasImage>();
    const failures: string[] = [];
    await Promise.all(
      Object.entries(data.cells).map(async ([cellKey, cell]) => {
        try {
          const img = await cargarImagen(`${this.urls.assets}${cell.url}`);
          images.set(cellKey, { image: img, kind: kindByKey.get(cellKey) ?? "tile" });
        } catch (err) {
          failures.push(cellKey);
          console.warn(`celda ${cellKey} no descargó — clay:`, err);
        }
      }),
    );
    if (!sigueMandando()) return "nada";
    if (images.size === 0) throw new Error("atlas sin celdas descargables");
    if (failures.length) {
      errors.push("scene", `atlas fps de ${key}: ${failures.length} celdas sin textura (clay)`);
    }
    this.deps.apply(key, images);
    // Caché (memoria + persistida) solo con el atlas COMPLETO: un parcial
    // debe reintentarse en la próxima visita.
    const complete = data.missing === 0 && failures.length === 0;
    if (complete) {
      this.cache.set(key, { layoutKey, images });
      while (this.cache.size > CLIENT_CACHE_MAX) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      guardarMapping(layoutKey, data.cells, kindByKey);
    }
    anunciar(
      data.missing > 0
        ? `Atlas fps de ${key}: ${images.size} superficies de la librería; faltan ${data.missing} por pintar (G o Imágenes…)`
        : `Atlas fps de ${key} instalado (${data.pages_painted} página(s) nuevas` +
          `${data.cached ? ", todo de la librería" : `, $${data.cost_usd}`})`,
    );
    // Pintar es GASTO: el balance del carril lo cuenta aparte.
    return data.pages_painted > 0 ? "pintado" : "aplicado";
  }

  /** Mapping local (`mapping-del-atlas.ts`): el resume restaura el arte
   *  pagado con SOLO el asset-store arriba (sin remote-gen). */
  private async reinstallFromStorage(
    key: string,
    sigueMandando: () => boolean,
    anunciar: (msg: string) => void,
  ): Promise<boolean> {
    const tile = this.deps.getTile(key);
    if (!tile) return false;
    const layoutKey = await this.layoutKeyFor(tile.layout);
    const images = await leerMapping(layoutKey, this.urls.assets);
    if (!images) return false;
    if (!sigueMandando()) return true;
    this.deps.apply(key, images);
    this.cache.set(key, { layoutKey, images });
    anunciar(`Atlas fps de ${key} restaurado (mapping local, $0)`);
    return true;
  }

  private async layoutKeyFor(layout: SurfaceLayout): Promise<string> {
    return sha256Hex(
      canonicalSurfaceLayoutJson(layout) + `|style:${this.styleId}|v${FPS_ATLAS_CLIENT_VERSION}`,
    );
  }

  private flattenCells(layout: SurfaceLayout): SurfaceCellSpec[] {
    return layout.pages.flatMap((p) =>
      p.cells.map((c) => ({
        key: c.key,
        mat: c.mat,
        kind: c.kind,
        desc: c.en,
        ...(c.ref !== undefined ? { ref: c.ref } : {}),
        base_color: c.baseColor,
        world_w: c.worldW,
        world_h: c.worldH,
        hints: c.hints,
      })),
    );
  }
}
