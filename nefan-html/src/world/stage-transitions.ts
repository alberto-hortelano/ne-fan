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
  type ComposedStageExit,
} from "@nefan-core/src/scene/stage/index.js";
import { errors } from "../ui/error-log.js";

/** Si el destino no llega en este tiempo, se retira el velo y se devuelve el
 *  control (el error real ya habrá salido por narrative_status). La primera
 *  visita a un place lo GENERA el motor narrativo en vivo (2-3 min con LLM
 *  real) — el timeout es un cinturón contra cuelgues, no una espera normal. */
const TRANSITION_TIMEOUT_MS = 240_000;

export interface StageTransitionDeps {
  getPlayerPos(): { x: number; z: number };
  /** place_id de la escena de plató ACTUAL (formatDToWorld lo preserva en
   *  __format_d). */
  getCurrentPlaceId(): string | null;
  /** Pide la escena del place destino (bridge o fallback local de fixtures). */
  enterPlace(placeId: string): void;
  setFade(on: boolean): void;
  /** Propuesta de cruce en curso (prompt Y/N del cliente, la misma mecánica
   *  que la generación de tiles del overworld) — null = ocultar. */
  setProposal(exit: ComposedStageExit | null): void;
  log(msg: string): void;
}

export class StageTransitions {
  private transitioning = false;
  private pendingFromPlaceId: string | null = null;
  private pendingExitId: string | null = null;
  private armedExitId: string | null = null;
  /** Salida bajo el jugador con prompt Y/N visible (aún sin cruzar). */
  private proposedExit: ComposedStageExit | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: StageTransitionDeps) {
    HOT_REGISTRY.add(this);
  }

  /** true mientras hay una transición en vuelo — el gameLoop congela el
   *  movimiento del jugador (la cámara y las animaciones siguen). */
  get isTransitioning(): boolean {
    return this.transitioning;
  }

  /** true mientras hay un prompt de cruce visible (teclas Y/N activas). */
  get proposalActive(): boolean {
    return this.proposedExit !== null;
  }

  /** Tick por frame en vista proscenio: pisar una zona de salida PROPONE el
   *  cruce (prompt Y/N, la misma mecánica que la generación de tiles del
   *  overworld) — nada de transicionar en seco: cruzar puede costar una
   *  generación LLM y un paso accidental no debe cambiar de escena. */
  tick(stage: ComposedStage): void {
    if (this.transitioning) return;
    const p = this.deps.getPlayerPos();
    const exit = exitZoneAt(stage, p.x, p.z);
    if (!exit) {
      this.armedExitId = null;
      if (this.proposedExit) {
        this.proposedExit = null;
        this.deps.setProposal(null);
      }
      return;
    }
    if (exit.id === this.armedExitId) return; // declinada o zona de entrada: re-armar al salir
    if (this.proposedExit?.id === exit.id) return; // prompt ya visible
    this.proposedExit = exit;
    this.deps.setProposal(exit);
  }

  /** Y: cruzar la salida propuesta. */
  confirmProposal(): void {
    const exit = this.proposedExit;
    if (!exit || this.transitioning) return;
    this.proposedExit = null;
    this.deps.setProposal(null);
    const from = this.deps.getCurrentPlaceId();
    if (!from) {
      // Sin place no hay vuelta que resolver — transicionar igual (el spawn
      // degradará a __player_start en destino).
      errors.push("scene", "transición sin place_id en la escena actual — el spawn de vuelta no podrá resolverse");
    }
    this.transitioning = true;
    this.pendingFromPlaceId = from;
    this.pendingExitId = exit.id;
    this.deps.setFade(true);
    this.deps.log(`🎬 ${exit.label}`);
    this.deps.enterPlace(exit.to_place_id);
    this.timeoutId = setTimeout(() => {
      if (!this.transitioning) return;
      this.recover(`la escena destino no llegó en ${TRANSITION_TIMEOUT_MS / 1000}s`);
    }, TRANSITION_TIMEOUT_MS);
  }

  /** N: quedarse — la zona queda armada hasta salir y volver a entrar. */
  declineProposal(): void {
    if (!this.proposedExit) return;
    this.armedExitId = this.proposedExit.id;
    this.proposedExit = null;
    this.deps.setProposal(null);
  }

  /** Retira el prompt sin armar la zona (p. ej. se abre un diálogo): al
   *  volver el control, el tick re-propone si sigue en la zona. */
  cancelProposal(): void {
    if (!this.proposedExit) return;
    this.proposedExit = null;
    this.deps.setProposal(null);
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
    this.pendingExitId = null;
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
    // El jugador sigue DE PIE en la zona que disparó: armarla para que no
    // re-dispare en bucle — debe salir y volver a entrar para reintentar.
    this.armedExitId = this.pendingExitId;
    this.pendingExitId = null;
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

// ── HMR (dev): parcheo de prototipo — la máquina de transición sobrevive a
// la iteración sin recargar (y corta la cadena de invalidación de
// nefan-core/stage hacia main.ts). ─────────────────────────────────────────
type HotWindow = Window & { __nefanHotStageTransitions?: Set<StageTransitions> };
const HOT_REGISTRY: Set<StageTransitions> =
  ((window as HotWindow).__nefanHotStageTransitions ??= new Set());
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const Next = (mod as { StageTransitions?: typeof StageTransitions } | undefined)?.StageTransitions;
    if (!Next) return import.meta.hot!.invalidate();
    for (const inst of HOT_REGISTRY) Object.setPrototypeOf(inst, Next.prototype);
    console.log(`[hmr] StageTransitions parcheado (${HOT_REGISTRY.size} instancia/s)`);
  });
}
