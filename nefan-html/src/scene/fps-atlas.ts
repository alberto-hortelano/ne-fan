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
  lineaDeBalance,
  type Desenlace,
  type Restauracion,
} from "@nefan-core/src/scene/politica-de-atlas.js";
import type { PermisoDeEscenarios } from "@nefan-core/src/session/gates-de-imagen.js";
import { debugLogEnabled } from "../dev/debug-log.js";
import { errors } from "../ui/error-log.js";
import { cargarImagen, guardarMapping, leerMapping } from "./mapping-del-atlas.js";
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
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Para el ciclo del activo, que no se pregunta si sigue mandando al
 *  reinstalar de memoria o del mapping (su token nace después, en `runFor`). */
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
  /** Qué tile arranca, cuál se encola y qué run sigue mandando lo decide core
   *  (`PoliticaDeAtlas`: no pagar dos veces, no descartar en silencio). Aquí
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

  /** Los tiles que aún van en clay, como arte pendiente del menú dev. Los
   *  cuenta el renderer (`tilesSinAtlas`) y los pide este controller: el que
   *  cuenta es el que genera (#492). `inFlight` lee `running` —también durante
   *  una corrida `resolve_only`, que no pinta—, porque es lo que el menú decía
   *  antes de salir de la raíz y esta tanda no cambia la lista; pasarlo a
   *  `pintando` es otra decisión y tiene su issue. */
  pendientes(): ArtePendiente[] {
    return this.deps.tilesSinAtlas().map((key) => ({
      kind: "fps_atlas",
      id: key,
      label: `Atlas fps ${key} (clay — celdas ya en la librería salen gratis)`,
      // Sin miniatura: una del canvas WebGL es otro trabajo.
      thumb: null,
      inFlight: this.running,
      generar: () => this.runFor(key),
    }));
  }

  /** ¿La corrida en vuelo puede PINTAR, o solo restaura lo ya pagado?
   *
   *  `running` no distingue las dos, y desde que una partida nueva nace en
   *  maqueta esa diferencia la ve el jugador: en maqueta el cliente SÍ pide el
   *  atlas —con `resolve_only`, que no pinta ni cobra— y el panel de dev
   *  anunciaba «GENERANDO atlas de superficies» igual que en Imagen IA
   *  (hallazgo H3 de QA, tanda A). O sea, le decía que estaba gastando a quien
   *  acababa de elegir no gastar, en la pantalla de la tanda que se llama «el
   *  dinero no miente». */
  get pintando(): boolean {
    return this.politica.enVuelo && this.corridaQuePinta;
  }

  /** Con qué intención salió la corrida en vuelo. Se fija en `runFor`, que es
   *  quien sabe si lleva `resolve_only`, y se apaga al terminar el tile. */
  private corridaQuePinta = false;


  /** Tile activo nuevo. El arte YA PAGADO se restaura SIEMPRE (también en
   *  modo vector — lo ya pintado se conserva): memoria →
   *  mapping persistido (solo asset-store) → resolve_only contra la librería
   *  ($0). Pintar celdas nuevas solo con la generación activa. Un tile activo
   *  NUEVO supera al run en vuelo (el token de `runFor` desecha el anterior
   *  antes de aplicar nada); la MISMA clave se deduplica y se re-dispara al
   *  terminar. Las dos reglas y sus incidentes ($0.15×2 el 2026-08-14; el
   *  tile del jugador descartado al reanudar, #390) viven en
   *  `PoliticaDeAtlas`, en core. */
  async onActiveTile(key: string): Promise<void> {
    if (this.politica.pedir(key) === "encolado") return;
    // Hasta que `runFor` diga otra cosa, esta corrida NO pinta: restaurar de
    // memoria o del mapping persistido es $0, y el rótulo del panel no puede
    // heredar la intención de la corrida anterior.
    this.corridaQuePinta = false;
    try {
      if (await this.reinstallIfCached(key, SIEMPRE)) return;
      // Sin estilo NO se resuelve nada. El estilo llega con la respuesta de
      // start/resume, y la escena del bootstrap puede difundirse ANTES: una
      // resolución contra style_id "" no es la partida de nadie —ni acierta
      // en la librería ni deja arte reutilizable—. Quién re-dispara el atlas
      // cuando el estilo llega después no está verificado (el comentario que
      // había aquí citaba un `applySessionReady()` que no existe en el árbol);
      // anotado como issue en la tanda de #714.
      if (!this.styleId) {
        this.deps.log(`Atlas fps de ${key}: en espera del estilo de la sesión`);
        return;
      }
      if (await this.reinstallFromStorage(key, SIEMPRE, this.deps.log)) return;
      await this.runFor(key, { resolveOnly: this.deps.modoDeEscenarios() !== "generar" });
    } finally {
      // El re-disparo es la ÚLTIMA oportunidad de ese tile: si se lo come un
      // catch mudo, el jugador se queda en clay sin que nada lo diga y el
      // síntoma aparece a un pipeline de distancia.
      if (this.politica.terminar(key) === "re-disparar") {
        void this.onActiveTile(key).catch((err) =>
          // `scene` y no una fuente propia (tanda F, QA H-2): lo que falla es
          // el atlas de UN TILE de esta partida, que es exactamente lo que
          // registran los otros tres `push` de este fichero. La fuente
          // `fps-atlas` que había aquí decía «el atlas como SERVICIO» y era su
          // único emisor, así que la distinción no existía: se fue con ella.
          errors.push("scene", `re-disparo del atlas de ${key}`, err),
        );
      }
      // El activo cedió el paso: las restauraciones de los vecinos que
      // esperaban a que terminase pueden salir.
      this.bombearRestauraciones();
    }
  }

  /** Un tile INSTALADO que no es el activo (vecinos del resume, prefetch):
   *  recupera su arte YA PAGADO (#714) y, si los gates dejan generar, pinta lo
   *  que falte — el mismo trato que el activo (`gatesDeImagen`). Nunca supera
   *  la corrida del activo (no toca su token) y espera a que termine. Síncrono:
   *  encola y vuelve; los fallos van al error-log desde la bomba. */
  restaurar(key: string): void {
    this.politica.encolarRestauracion(key);
    this.bombearRestauraciones();
  }

  /** Cambio de partida: lo encolado y lo que va en el aire es de la anterior. */
  olvidarRestauraciones(): void {
    this.politica.olvidarRestauraciones();
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
        const b = this.politica.finDeRestauracion(r, d); // balance: UNA línea de HUD por tanda
        if (b) this.deps.log(lineaDeBalance(b));
        this.bombearRestauraciones();
      });
  }

  /** La escalera de siempre —memoria → mapping → librería— sin `nuevoRun` ni
   *  `corridaQuePinta`. Si pinta, lo dice (`onGeneration`, `pintado`). */
  private async ejecutarRestauracion(r: Restauracion): Promise<Desenlace> {
    const sigueMandando = () => this.politica.restauracionVigente(r);
    const aplicado = (): Desenlace => (sigueMandando() ? "aplicado" : "nada");
    if (await this.reinstallIfCached(r.key, sigueMandando)) return aplicado();
    if (!sigueMandando()) return "nada";
    if (!this.styleId) {
      traza(`${r.key}: restauración sin estilo de sesión — clay`);
      return "nada";
    }
    if (await this.reinstallFromStorage(r.key, sigueMandando, traza)) return aplicado();
    const tile = this.deps.getTile(r.key);
    if (!tile || !sigueMandando()) return "nada";
    const resolveOnly = this.deps.modoDeEscenarios() !== "generar";
    return this.resolverYAplicar(r.key, tile, resolveOnly, sigueMandando, traza);
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

  /** Generación manual (tecla G / menú dev) o auto (onActiveTile). Con
   *  `resolveOnly` NUNCA pinta: restaura lo que ya exista en la librería. */
  async runFor(key: string, { resolveOnly = false } = {}): Promise<void> {
    const tile = this.deps.getTile(key);
    if (!tile) return;
    // La intención de ESTA corrida, para que el panel no anuncie pintura donde
    // solo hay restauración (ver `pintando`).
    this.corridaQuePinta = !resolveOnly;
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
    const token = this.politica.nuevoRun();
    try {
      await this.resolverYAplicar(key, tile, resolveOnly, () => this.politica.vigente(token), this.deps.log);
    } catch (err) {
      errors.push("scene", `el atlas fps de ${key} falló — se queda en clay`, err);
    } finally {
      this.politica.finDeRun(token);
    }
  }

  /** POST del atlas (troceado) + descargas + keep-list + aplicar + caché. No
   *  decide quién manda: se lo pregunta a `sigueMandando` antes de aplicar
   *  (el token del activo en `runFor`; el id de la restauración en el carril
   *  de los vecinos). Lanza si falla: el llamante tiene el canal. */
  private async resolverYAplicar(
    key: string,
    tile: { layout: SurfaceLayout; sceneDescription: string },
    resolveOnly: boolean,
    sigueMandando: () => boolean,
    anunciar: (msg: string) => void,
  ): Promise<Desenlace> {
    const layoutKey = await this.layoutKeyFor(tile.layout);
    const cells = this.flattenCells(tile.layout);
    if (cells.length === 0) return "nada";
    if (!resolveOnly) anunciar(`Atlas fps del tile ${key}: ${cells.length} superficies…`);
    // El server capa cells a 64 por petición: trocear y fusionar (cada
    // celda se resuelve independiente contra la librería — mismo resultado).
    //
    // El acumulador NO es una `GenerateSurfaceAtlasResponse`: lo era, y eso
    // obligaba a arrastrar campos que aquí no lee nadie (`quoted_*`, la
    // cotización del panel de coste), sumándolos sin comprobar que fueran
    // números — un servidor que no los mandara propagaba `NaN` en silencio.
    // Lo que esta vista necesita de cada lote es esto y nada más.
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
    // Keep-list ANTES del corte por token: si otro tile superó a este en
    // vuelo, su arte (pagado o de la librería) sigue siendo de esta escena y
    // el prune no debe podarlo. Sin esto, «último gana» convertía arte
    // pagado en podable.
    void this.registerRefs(key, Object.values(data.cells).map((c) => c.hash));
    if (!sigueMandando()) return "nada"; // el tile activo cambió en vuelo

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

  /** Keep-list del prune: los hashes usados por la escena viva. Best-effort
   *  (un fallo no rompe la instalación) pero con traza. */
  private async registerRefs(sceneId: string, refs: string[]): Promise<void> {
    if (!this.urls.state || refs.length === 0) return;
    try {
      const res = await fetch(`${this.urls.state}/scene/asset_refs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: sceneId, refs: [...new Set(refs)] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      errors.push("scene", `asset_refs de ${sceneId} no registrados (prune podría podarlos)`, err);
    }
  }
}
