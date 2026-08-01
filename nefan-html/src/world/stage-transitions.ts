/** Transiciones entre platós de la vista proscenio — el patrón "puerta de
 *  Resident Evil": pisar una zona de salida corta a negro, pide la escena del
 *  place destino (cacheada = re-broadcast instantáneo; nueva = lazy realize
 *  del motor narrativo) y al llegar el plató nuevo el jugador aparece junto a
 *  la puerta de vuelta.
 *
 *  Máquina de estados mínima con re-armado: la salida pisada al aparecer no
 *  dispara hasta que el jugador la abandona (spawnPointForEntry ya deja el
 *  spawn FUERA de la zona; el armado cubre el fallback a __player_start). */

import {
  exitZoneAt,
  spawnPointForEntry,
  type ComposedStage,
} from "@nefan-core/src/scene/stage/index.js";
import { errors } from "../ui/error-log.js";

/** Si el destino no llega en este tiempo, se retira el velo y se devuelve el
 *  control (el error real ya habrá salido por narrative_status). */
const TRANSITION_TIMEOUT_MS = 45_000;

export interface StageTransitionDeps {
  getPlayerPos(): { x: number; z: number };
  /** place_id de la escena de plató ACTUAL (formatDToWorld lo preserva en
   *  __format_d). */
  getCurrentPlaceId(): string | null;
  /** Pide la escena del place destino (bridge o fallback local de fixtures). */
  enterPlace(placeId: string): void;
  setFade(on: boolean): void;
  log(msg: string): void;
}

export class StageTransitions {
  private transitioning = false;
  private pendingFromPlaceId: string | null = null;
  private armedExitId: string | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: StageTransitionDeps) {}

  /** true mientras hay una transición en vuelo — el gameLoop congela el
   *  movimiento del jugador (la cámara y las animaciones siguen). */
  get isTransitioning(): boolean {
    return this.transitioning;
  }

  /** Tick por frame en vista proscenio: dispara la transición al pisar una
   *  zona de salida (desarmada). */
  tick(stage: ComposedStage): void {
    if (this.transitioning) return;
    const p = this.deps.getPlayerPos();
    const exit = exitZoneAt(stage, p.x, p.z);
    if (!exit) {
      this.armedExitId = null;
      return;
    }
    if (exit.id === this.armedExitId) return; // aún no ha salido de su zona de entrada
    const from = this.deps.getCurrentPlaceId();
    if (!from) {
      // Sin place no hay vuelta que resolver — transicionar igual (el spawn
      // degradará a __player_start en destino).
      errors.push("scene", "transición sin place_id en la escena actual — el spawn de vuelta no podrá resolverse");
    }
    this.transitioning = true;
    this.pendingFromPlaceId = from;
    this.deps.setFade(true);
    this.deps.log(`🎬 ${exit.label}`);
    this.deps.enterPlace(exit.to_place_id);
    this.timeoutId = setTimeout(() => {
      if (!this.transitioning) return;
      this.recover(`la escena destino no llegó en ${TRANSITION_TIMEOUT_MS / 1000}s`);
    }, TRANSITION_TIMEOUT_MS);
  }

  /** Al instalarse un plató: devuelve el spawn de entrada si había transición
   *  en vuelo (y la cierra), o null (carga inicial/fixture — solo arma la
   *  zona bajo el jugador). El caller aplica el spawn y luego llama armAt. */
  resolveEntrySpawn(stage: ComposedStage): { x: number; z: number } | null {
    if (!this.transitioning) return null;
    this.clearTimer();
    this.transitioning = false;
    const from = this.pendingFromPlaceId;
    this.pendingFromPlaceId = null;
    this.deps.setFade(false);
    if (!from) return null;
    const spawn = spawnPointForEntry(stage, from);
    if (!spawn) {
      errors.push(
        "scene",
        `el plató no declara salida de vuelta hacia "${from}" — spawn en __player_start`,
      );
      return null;
    }
    return spawn;
  }

  /** Arma la salida bajo (x,z) para que no re-dispare hasta abandonarla. */
  armAt(stage: ComposedStage, x: number, z: number): void {
    this.armedExitId = exitZoneAt(stage, x, z)?.id ?? null;
  }

  /** Error del motor/bridge con transición en vuelo: retirar velo y devolver
   *  el control (el detalle ya está en el error-log vía narrative_status). */
  onError(): void {
    if (!this.transitioning) return;
    this.recover("el motor narrativo falló generando el destino");
  }

  private recover(reason: string): void {
    this.clearTimer();
    this.transitioning = false;
    this.pendingFromPlaceId = null;
    this.deps.setFade(false);
    errors.push("scene", `transición cancelada: ${reason}`);
  }

  private clearTimer(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
