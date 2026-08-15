/** Panel de dev bajo el HUD (#dev-status, siempre visible): estado de la
 *  generación de imágenes IA (con aviso destacado ANTES de cada llamada de
 *  pago y el nº de imágenes en juego), contadores de caché de la sesión,
 *  gasto estimado en euros (server-side, GET /dev/status de remote-gen),
 *  config de generación activa y presencia de claves. Herramienta de
 *  desarrollo — datos ricos por tooltip, línea compacta a la vista. */

import type { DevStatus } from "@nefan-core/src/contracts/remote-gen.js";
import type { PipelineStatus } from "../scene/auto-pipeline.js";
import type { StageImageStatus } from "../scene/stage-image.js";
import { errors } from "./error-log.js";

const POLL_MS = 5000;

/** Fase de la oblicua que gasta créditos (auto-pipeline.ts). */
const TILE_PAID_PHASE = "imagen";

export interface GenerationEvent {
  /** repaint/peel = proscenio; tile = oblicua; fps_atlas = superficies de la
   *  vista fps; client = caché cliente. */
  kind: "repaint" | "peel" | "tile" | "fps_atlas" | "client";
  cached: boolean;
}

export interface SessionInfo {
  view?: string;
  renderMode?: string;
  styleId?: string;
}

const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export class DevStatusPanel {
  private readonly genEl: HTMLElement;
  private readonly cacheEl: HTMLElement;
  private readonly spendEl: HTMLElement;
  private readonly configEl: HTMLElement;
  private readonly sessionEl: HTMLElement;
  private readonly toggle: HTMLInputElement;

  /** Contadores de caché de la sesión del navegador. */
  private hits = 0;
  private misses = 0;
  private clientHits = 0;

  /** Gasto total (USD) en el primer poll OK — "sesión" = total − baseline. */
  private baselineUsd: number | null = null;
  private usdEurRate: number | null = null;
  private offline = false;
  private firstPoll = true;

  /** Último estado del pipeline por tiles, para restaurarlo cuando el
   *  proscenio suelta el slot (nunca corren a la vez). */
  private lastTile: PipelineStatus | null = null;
  private readonly session: Required<SessionInfo> = { view: "", renderMode: "", styleId: "" };

  constructor(
    private readonly remoteUrl: string,
    private readonly log: (msg: string) => void,
  ) {
    const grab = (id: string): HTMLElement => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`DevStatusPanel: falta #${id} en index.html`);
      return el;
    };
    this.genEl = grab("ds-gen");
    this.cacheEl = grab("ds-cache");
    this.spendEl = grab("ds-spend");
    this.configEl = grab("ds-config");
    this.sessionEl = grab("ds-session");
    this.toggle = grab("devcache-toggle") as HTMLInputElement;
    this.toggle.addEventListener("change", () => this.onToggleChange());
    this.renderIdle();
    this.renderCache();
    this.setSession({});
    void this.poll();
    // OK: panel global, vida == app (nunca se desmonta).
    setInterval(() => void this.poll(), POLL_MS);
  }

  // ── Estado de generación (slot único: oblicua y proscenio nunca a la vez) ──

  setTilePipeline(s: PipelineStatus): void {
    this.lastTile = s;
    if (s.paused) {
      this.setGen(`pausado: ai_server no responde · cola ${s.queued}`, "paused");
    } else if (s.current && s.current.phase === TILE_PAID_PHASE) {
      // Fase de PAGO: 1 imagen en vuelo + la cola detrás.
      this.setGen(
        `GENERANDO imagen del tile ${s.current.key} · quedan ${s.queued + 1}`,
        "working",
      );
    } else if (s.current) {
      this.setGen(
        `tile ${s.current.key}: ${s.current.phase}` + (s.queued > 0 ? ` · cola ${s.queued}` : ""),
        "",
      );
    } else if (s.enabled) {
      this.setGen("img: al día", "");
    } else {
      this.renderIdle();
    }
  }

  setStage(s: StageImageStatus | null): void {
    if (s === null) {
      // El proscenio suelta el slot: restaurar lo que dijera la oblicua.
      if (this.lastTile) this.setTilePipeline(this.lastTile);
      else this.renderIdle();
      return;
    }
    switch (s.phase) {
      case "greybox":
        this.setGen(`plató ${s.key}: greybox (local, gratis)`, "");
        break;
      case "repaint":
        // Aviso emitido ANTES del POST de pago: el repintado es 1 imagen.
        this.setGen(`GENERANDO 1 imagen (plató ${s.key})`, "working");
        break;
      case "review":
        this.setGen(`plató ${s.key}: inventario por visión (${s.total ?? 0} declarados)`, "working");
        break;
      case "segment":
        this.setGen(`plató ${s.key}: segmentando ${s.label ?? ""}`, "working");
        break;
      case "peel":
        this.setGen(
          `plató ${s.key}: pelando ${s.label ?? ""} ${s.step ?? 0}/${s.total ?? 0} (LaMa, gratis)`,
          "working",
        );
        break;
    }
  }

  recordGeneration(e: GenerationEvent): void {
    if (e.kind === "client") this.clientHits++;
    else if (e.cached) this.hits++;
    else this.misses++;
    this.renderCache();
  }

  setSession(info: SessionInfo): void {
    if (info.view !== undefined) this.session.view = info.view;
    if (info.renderMode !== undefined) this.session.renderMode = info.renderMode;
    if (info.styleId !== undefined) this.session.styleId = info.styleId;
    const parts = [
      `vista ${this.session.view || "oblicua"}`,
      this.session.renderMode ? `gráficos ${this.session.renderMode}` : "",
      this.session.styleId ? `estilo ${this.session.styleId}` : "",
    ].filter(Boolean);
    this.sessionEl.textContent = parts.join(" · ");
  }

  // ── Poll del server (spend + config + dev-cache) ──

  private async poll(): Promise<void> {
    let st: DevStatus;
    try {
      const res = await fetch(`${this.remoteUrl}/dev/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      st = (await res.json()) as DevStatus;
    } catch {
      // Degradación esperable (preset 4 arranca sin ai_server): reflejar el
      // estado sin spamear — solo en la transición online→offline.
      if (!this.offline) {
        this.offline = true;
        this.spendEl.textContent = "";
        this.configEl.textContent = "ai_server offline (sin gasto/config)";
        this.toggle.disabled = true;
        this.toggle.parentElement!.title = "ai_server no responde — dev-cache no disponible";
        if (!this.firstPoll) this.log("panel dev: ai_server dejó de responder");
      }
      this.firstPoll = false;
      return;
    }
    if (this.offline) this.log("panel dev: ai_server de vuelta");
    this.offline = false;
    this.firstPoll = false;
    this.usdEurRate = st.config.usd_eur_rate;
    if (this.baselineUsd === null) this.baselineUsd = st.spend.total_usd;
    this.renderSpend(st);
    this.renderConfig(st);
    this.toggle.disabled = false;
    this.toggle.checked = st.api_cache.enabled;
  }

  private renderSpend(st: DevStatus): void {
    const rate = this.usdEurRate ?? 1;
    const sessionUsd = Math.max(0, st.spend.total_usd - (this.baselineUsd ?? 0));
    this.spendEl.textContent =
      `gasto sesión ${eurFmt.format(sessionUsd * rate)} · total ${eurFmt.format(st.spend.total_usd * rate)}`;
    const lastCalls = st.spend.calls
      .slice(-5)
      .map((c) => `  $${c.usd.toFixed(2)} ${c.service}: ${c.what}`)
      .join("\n");
    this.spendEl.title =
      `Coste ESTIMADO (tablas Meshy/fal, no facturación real).\n` +
      `Total: $${st.spend.total_usd.toFixed(2)} en ${st.spend.call_count} llamadas · ` +
      `tasa ${rate} €/$ (config.ts usd_eur_rate)` +
      (lastCalls ? `\nÚltimas llamadas:\n${lastCalls}` : "");
  }

  private renderConfig(st: DevStatus): void {
    const key = (name: string, ok: boolean) => `${name}${ok ? "✓" : "✗"}`;
    const channels = Object.keys(st.api_cache.channels).length;
    this.configEl.textContent =
      `escena ${st.config.scene_model} · plató ${st.config.stage_scene_model} · ` +
      `skins ${st.config.sprite_skin_model} · ${key("meshy", st.keys.meshy)} ${key("fal", st.keys.fal)}`;
    this.configEl.title =
      `Modelos activos (config.ts → runtime_config.json) y claves del .env ` +
      `(solo presencia).\nDev-cache: ${st.api_cache.enabled ? "ON" : "OFF"}, ` +
      `${channels} canal${channels === 1 ? "" : "es"} con respuesta guardada.`;
  }

  private onToggleChange(): void {
    const enabled = this.toggle.checked;
    void fetch(`${this.remoteUrl}/dev/api_cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.log(
          `dev-cache ${enabled ? "ON — las APIs de IA sirven su última respuesta (0 créditos)" : "OFF — llamadas reales"}`,
        );
      })
      .catch((err) => {
        this.toggle.checked = !enabled;
        errors.push("config", "no se pudo cambiar dev-cache en ai_server", err);
      });
  }

  private setGen(text: string, cls: "" | "working" | "paused"): void {
    this.genEl.textContent = text;
    this.genEl.className = `ds-gen${cls ? ` ${cls}` : ""}`;
  }

  private renderIdle(): void {
    this.setGen("img: inactivo", "");
  }

  private renderCache(): void {
    this.cacheEl.textContent =
      `caché ${this.hits}✓/${this.misses}✗` + (this.clientHits ? ` · cliente ${this.clientHits}` : "");
    this.cacheEl.title =
      `Imágenes de esta sesión del navegador: ${this.hits} hit(s) de caché del server, ` +
      `${this.misses} generación(es) real(es), ${this.clientHits} reinstalación(es) de caché cliente (sin red).`;
  }
}
