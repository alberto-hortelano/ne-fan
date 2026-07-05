/** Pipeline automático de imagen IA por tile: cuando está activado (toggle
 *  Auto-img del HUD), cada tile de grid sin imagen pasa por las dos fases
 *  imagen → análisis (G→X) en una cola FIFO con UN job en vuelo (Meshy en
 *  serie). El análisis deriva el mundo jugable de la imagen: occluders (tall)
 *  y colisión (solid), clasificados por visión. Convive con las teclas
 *  manuales G/X esperando a que el controller quede libre antes de cada fase.
 *
 *  Errores:
 *  - Red caída (ai_server no responde): UNA entrada en el ErrorLog, el tile
 *    vuelve al frente de la cola y el pipeline queda en pausa sondeando
 *    /health cada 10 s hasta que vuelva. La cola no se vacía, sin spam.
 *  - HTTP 503 (scene_image_gen sin backend): el pipeline se auto-desactiva
 *    (onDisabled desmarca el toggle) — reintentarlo no va a arreglarlo.
 *  - Cualquier otro fallo de imagen: log y siguiente tile. Fallo del
 *    análisis: log y seguir (la imagen ya está instalada; X lo reintenta).
 *
 *  Sin dependencias de DOM: todo entra por deps inyectadas (testeable). */
import { errors } from "../ui/error-log.js";
import type { TileAnalysis } from "./scene-image.js";

export type PipelinePhase = "imagen" | "análisis";

export interface PipelineStatus {
  enabled: boolean;
  paused: boolean;
  current: { key: string; phase: PipelinePhase } | null;
  queued: number;
}

export interface PipelineDeps {
  hasImage(key: string): boolean;
  /** Tiles de grid registrados, en orden de llegada (bootstrap primero). */
  listGridTileKeys(): string[];
  isControllerBusy(): boolean;
  generate(key: string): Promise<void>;
  analyze(key: string): Promise<TileAnalysis>;
  onAnalyzed(key: string, analysis: TileAnalysis): void;
  onStatus(s: PipelineStatus): void;
  /** El servidor rechazó de raíz (503): desmarcar el toggle en la UI. */
  onDisabled(): void;
  healthUrl: string;
}

const IDLE_POLL_MS = 250;
const HEALTH_POLL_MS = 10_000;
const MAX_GENERATE_RETRIES = 2;

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /Failed to fetch|NetworkError|load failed/i.test(msg);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class AutoImagePipeline {
  private queue: string[] = [];
  /** Tiles cuya escena cambió mientras su job estaba en vuelo: la imagen
   *  recién generada nace obsoleta y hay que regenerar con el esquema nuevo. */
  private dirty = new Set<string>();
  private retries = new Map<string, number>();
  private enabled = false;
  private paused = false;
  private draining = false;
  private current: { key: string; phase: PipelinePhase } | null = null;

  constructor(private deps: PipelineDeps) {}

  getStatus(): PipelineStatus {
    return {
      enabled: this.enabled,
      paused: this.paused,
      current: this.current ? { ...this.current } : null,
      queued: this.queue.length,
    };
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      for (const key of this.deps.listGridTileKeys()) {
        if (!this.deps.hasImage(key)) this.enqueue(key);
      }
    } else {
      this.queue = [];
      this.dirty.clear();
      this.retries.clear();
      this.paused = false;
    }
    this.emit();
    this.kick();
  }

  /** El mundo del cliente se vació (nueva sesión, resume, fixture): las
   *  claves encoladas ya no existen. Mantiene enabled — los tiles del mundo
   *  nuevo se re-encolan vía notifyTile al registrarse. */
  resetQueue(): void {
    this.queue = [];
    this.dirty.clear();
    this.retries.clear();
    this.emit();
  }

  /** Un tile fue (re)registrado. `invalidated` = su escena cambió respecto al
   *  registro anterior (la imagen previa, si la había, ya fue invalidada). */
  notifyTile(key: string, opts?: { invalidated?: boolean }): void {
    if (opts?.invalidated && this.current?.key === key) this.dirty.add(key);
    if (!this.enabled) return;
    if (this.deps.hasImage(key)) return;
    this.enqueue(key);
    this.emit();
    this.kick();
  }

  private enqueue(key: string): void {
    if (this.queue.includes(key) || this.current?.key === key) return;
    this.queue.push(key);
  }

  private emit(): void {
    this.deps.onStatus(this.getStatus());
  }

  private kick(): void {
    if (this.enabled && !this.draining && this.queue.length > 0) {
      this.draining = true;
      void this.drain().finally(() => {
        this.draining = false;
      });
    }
  }

  /** Espera a que el controller quede libre (tecla manual en curso). */
  private async waitIdle(): Promise<void> {
    while (this.enabled && this.deps.isControllerBusy()) {
      await sleep(IDLE_POLL_MS);
    }
  }

  /** ai_server caído: pausa con sondeo de /health hasta que responda. */
  private async pauseUntilHealthy(): Promise<void> {
    if (!this.paused) {
      this.paused = true;
      errors.push("auto-img", "ai_server no responde — pipeline en pausa (reintento cada 10 s)");
      this.emit();
    }
    while (this.enabled && this.paused) {
      await sleep(HEALTH_POLL_MS);
      if (!this.enabled) return;
      try {
        const res = await fetch(this.deps.healthUrl);
        if (res.ok) {
          this.paused = false;
          this.emit();
        }
      } catch {
        // sigue caído — siguiente sondeo (la entrada de log ya está puesta)
      }
    }
  }

  private async drain(): Promise<void> {
    while (this.enabled && this.queue.length > 0) {
      const key = this.queue.shift()!;
      if (this.deps.hasImage(key)) continue;

      // FASE 1: imagen (la única que gasta créditos; errores con matices)
      this.current = { key, phase: "imagen" };
      this.emit();
      await this.waitIdle();
      if (!this.enabled) break;
      try {
        await this.deps.generate(key);
      } catch (err) {
        if (isNetworkError(err)) {
          this.queue.unshift(key);
          this.current = null;
          await this.pauseUntilHealthy();
          continue;
        }
        if (/HTTP 503/.test(errMessage(err))) {
          errors.push(
            "auto-img",
            "scene_image_gen no disponible en el ai_server (¿MESHY_API_KEY?) — Auto-img desactivado",
          );
          this.setEnabled(false);
          this.deps.onDisabled();
          break;
        }
        errors.push("auto-img", `imagen de ${key} falló — sigo con el siguiente tile`, err);
        continue;
      }
      if (this.dirty.delete(key)) {
        // La escena cambió en vuelo: la imagen instalada ya fue invalidada por
        // el re-registro; regenerar con el esquema nuevo.
        this.enqueue(key);
        continue;
      }
      if (!this.deps.hasImage(key)) {
        // Carrera con una tecla manual: generate hizo early-return por busy.
        const n = this.retries.get(key) ?? 0;
        if (n < MAX_GENERATE_RETRIES) {
          this.retries.set(key, n + 1);
          this.enqueue(key);
        } else {
          errors.push("auto-img", `no pude generar ${key} tras ${n + 1} intentos — lo dejo`);
        }
        continue;
      }
      this.retries.delete(key);

      // FASE 2: análisis (X) — segmentación + clasificación + aplicación.
      // Error → log y seguir: la imagen ya está y X lo puede reintentar.
      await this.runPhase(key, "análisis", async () => {
        this.deps.onAnalyzed(key, await this.deps.analyze(key));
      });
    }
    this.current = null;
    this.emit();
  }

  /** Ejecuta una fase no crítica. Devuelve false solo si hay que abortar el
   *  tile (pipeline apagado); los errores no-red se loguean y se sigue. */
  private async runPhase(key: string, phase: PipelinePhase, fn: () => Promise<void>): Promise<boolean> {
    if (!this.enabled) return false;
    this.current = { key, phase };
    this.emit();
    await this.waitIdle();
    if (!this.enabled) return false;
    try {
      await fn();
    } catch (err) {
      if (isNetworkError(err)) {
        // Sin red tampoco tiene sentido la fase siguiente: pausar y reanudar
        // el resto de la cola cuando vuelva (este tile ya tiene imagen).
        await this.pauseUntilHealthy();
        return false;
      }
      errors.push("auto-img", `${phase} de ${key} falló — sigo`, err);
    }
    return true;
  }
}
