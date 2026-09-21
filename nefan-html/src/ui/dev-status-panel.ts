/** Panel de dev bajo el HUD (#dev-status, siempre visible): estado de la
 *  generación de imágenes IA (con aviso destacado ANTES de cada llamada de
 *  pago y el nº de imágenes en juego), contadores de caché de la sesión,
 *  gasto estimado en euros (server-side, GET /dev/status de remote-gen),
 *  config de generación activa y presencia de claves. Herramienta de
 *  desarrollo — datos ricos por tooltip, línea compacta a la vista. */

import type { DevStatus } from "@nefan-core/src/contracts/remote-gen.js";
import { errors } from "./error-log.js";

const POLL_MS = 5000;

export interface GenerationEvent {
  /** fps_atlas = superficies de la vista fps; client = caché cliente. */
  kind: "fps_atlas" | "client";
  cached: boolean;
}

export interface SessionInfo {
  renderMode?: string;
  styleId?: string;
}

const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

/** El texto accionable de una respuesta de error de ai_server: el `detail` de
 *  FastAPI, o el cuerpo crudo cuando no viene en esa forma.
 *
 *  Devuelve TAMBIÉN cómo se leyó, y no por simetría: «el server mandó esto» y
 *  «el server no mandó `detail`» no son la misma noticia, y quien lee el
 *  registro necesita saber si le falta un campo o si eso ES el campo. Por eso
 *  el cuerpo ilegible no se traga —su error entra en el texto que se enseña—:
 *  un `detail` vacío sin explicación manda a buscar donde no hay nada.
 *
 *  **Devuelve el detalle ENTERO, sin recortar** (H6 de la re-QA). Nació
 *  recortando a 300 caracteres «porque el destino es el HUD», y el `detail` que
 *  emite remote-gen para el checkout principal mide 337: el `mv` llegaba a la
 *  pantalla cortado en `…/archivo/cache/spend/ev`, y quien lo copiase archivaba
 *  el ledger con ese nombre. O sea que el recorte se comía exactamente el texto
 *  que este camino existe para entregar. Lo que se recorta, si acaso, es la
 *  LÍNEA VISIBLE, que la compone quien pinta; el tooltip y el registro son «lo
 *  rico» por diseño y se lo quedan entero. */
export function detalleDelRechazo(cuerpo: string): { texto: string; forma: "detail" | "crudo" } {
  let texto = cuerpo;
  let forma: "detail" | "crudo" = "crudo";
  try {
    const json: unknown = JSON.parse(cuerpo);
    if (json && typeof json === "object" && typeof (json as { detail?: unknown }).detail === "string") {
      texto = (json as { detail: string }).detail;
      forma = "detail";
    }
  } catch (err) {
    texto = `${cuerpo} [cuerpo ilegible: ${err}]`;
  }
  return { texto: texto.trim(), forma };
}

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
  /** La firma del último RECHAZO con respuesta (`HTTP 500|<detalle>`), para
   *  decirlo una vez por causa y no cada 5 s. `null` = ahora no hay ninguno. */
  private ultimoRechazo: string | null = null;

  private readonly session: Required<SessionInfo> = { renderMode: "", styleId: "" };

  /** Último estado pintado de `setPainting` (evita repintar cada frame). */
  private painting = false;

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

  // ── Estado de generación ──

  /** Pintura en vuelo del ÚNICO pipeline de imagen que queda (atlas de
   *  superficies de la fps): aviso destacado mientras puede estar gastando.
   *  Se llama por frame — solo repinta en el cambio de estado. */
  setPainting(busy: boolean): void {
    if (busy === this.painting) return;
    this.painting = busy;
    if (busy) this.setGen("GENERANDO atlas de superficies del tile activo…", "working");
    else this.renderIdle();
  }

  recordGeneration(e: GenerationEvent): void {
    if (e.kind === "client") this.clientHits++;
    else if (e.cached) this.hits++;
    else this.misses++;
    this.renderCache();
  }

  setSession(info: SessionInfo): void {
    if (info.renderMode !== undefined) this.session.renderMode = info.renderMode;
    if (info.styleId !== undefined) this.session.styleId = info.styleId;
    // Sin chip de vista: el cliente tiene una sola. El que había se quedó
    // anunciando "vista oblicua" en cuanto nadie volvió a fijarlo — un HUD
    // que miente es peor que un HUD con un dato menos.
    const parts = [
      this.session.renderMode ? `gráficos ${this.session.renderMode}` : "",
      this.session.styleId ? `estilo ${this.session.styleId}` : "",
    ].filter(Boolean);
    this.sessionEl.textContent = parts.join(" · ");
  }

  // ── Poll del server (spend + config + dev-cache) ──

  private async poll(): Promise<void> {
    // CAÍDO y RECHAZADO son dos cosas distintas y se dicen distinto. Hasta
    // #426 el `!res.ok` entraba por el mismo `catch` que el fetch fallido, así
    // que un ai_server EN PIE contestando 500 se anunciaba como «offline» y su
    // `detail` —el único texto accionable que produce a propósito: hoy el `mv`
    // de un ledger anterior a #426— no llegaba a ninguna parte. Un HUD que
    // dice que un servicio está caído cuando está en pie miente dos veces.
    let res: Response;
    try {
      res = await fetch(`${this.remoteUrl}/dev/status`);
    } catch {
      // Degradación esperable (preset 4 arranca sin ai_server): reflejar el
      // estado sin spamear — solo en la transición online→offline.
      this.marcarCaido();
      return;
    }
    // El cuerpo se lee UNA vez y se parsea aparte, para que los dos desenlaces
    // de abajo puedan enseñarlo: `res.json()` se lo habría comido, y entonces
    // el «respuesta ilegible» solo podría repetir el `SyntaxError` sin decir
    // qué llegó — que es la mitad que le hace falta a quien lo lee.
    let cuerpo: string;
    try {
      cuerpo = await res.text();
    } catch (err) {
      cuerpo = `(el cuerpo de la respuesta no se pudo leer: ${err})`;
    }
    if (!res.ok) {
      this.marcarRechazo(`HTTP ${res.status}`, cuerpo);
      return;
    }
    let st: DevStatus;
    try {
      st = JSON.parse(cuerpo) as DevStatus;
    } catch {
      // 200 con un cuerpo que no es el contrato: el server está VIVO, así que
      // tampoco es «offline». Se dice como rechazo, y con el cuerpo delante —
      // `detalleDelRechazo` le pega el motivo del parse al texto.
      this.marcarRechazo("respuesta ilegible", cuerpo);
      return;
    }
    if (this.offline) this.log("panel dev: ai_server de vuelta");
    if (this.ultimoRechazo !== null) this.log("panel dev: ai_server vuelve a servir /dev/status");
    this.offline = false;
    this.ultimoRechazo = null;
    this.firstPoll = false;
    this.usdEurRate = st.config.usd_eur_rate;
    if (this.baselineUsd === null) this.baselineUsd = st.spend.total_usd;
    this.renderSpend(st);
    this.renderConfig(st);
    this.toggle.disabled = false;
    this.toggle.checked = st.api_cache.enabled;
  }

  /** ai_server NO responde (el fetch ni llega). Es la degradación esperable, y
   *  se anuncia una sola vez, en la transición. */
  private marcarCaido(): void {
    if (!this.offline) {
      this.offline = true;
      this.ultimoRechazo = null;
      this.spendEl.textContent = "";
      this.spendEl.title = "";
      this.configEl.textContent = "ai_server offline (sin gasto/config)";
      this.toggle.disabled = true;
      this.toggle.parentElement!.title = "ai_server no responde — dev-cache no disponible";
      if (!this.firstPoll) this.log("panel dev: ai_server dejó de responder");
    }
    this.firstPoll = false;
  }

  /** ai_server CONTESTÓ y se negó a dar el estado. No es una caída: hay alguien
   *  al otro lado explicando por qué, así que su causa se PINTA (línea visible
   *  corta, detalle entero en el tooltip, que es como este panel enseña lo
   *  rico) y además entra en el registro de errores, que es el canal de la
   *  casa. El aviso va UNA vez por causa porque el poll es cada 5 s. */
  private marcarRechazo(que: string, cuerpo: string): void {
    const { texto: detalle, forma } = detalleDelRechazo(cuerpo);
    this.offline = false;
    this.spendEl.textContent = "gasto no disponible";
    this.spendEl.title = detalle || que;
    this.configEl.textContent = `ai_server rechaza /dev/status (${que})`;
    this.configEl.title = detalle;
    this.toggle.disabled = true;
    this.toggle.parentElement!.title = `ai_server rechaza /dev/status (${que}) — dev-cache no disponible`;
    const firma = `${que}|${detalle}`;
    if (this.ultimoRechazo !== firma) {
      this.ultimoRechazo = firma;
      errors.push(
        "config",
        // Si no vino `detail`, se dice: así nadie busca un campo que el server
        // no mandó, y el texto de al lado se lee como lo que es (el cuerpo).
        `ai_server rechaza GET /dev/status (${que})${forma === "crudo" ? " y no manda `detail`" : ""}`,
        detalle || undefined,
      );
    }
    this.firstPoll = false;
  }

  private renderSpend(st: DevStatus): void {
    const rate = this.usdEurRate ?? 1;
    const sessionUsd = Math.max(0, st.spend.total_usd - (this.baselineUsd ?? 0));
    this.spendEl.textContent =
      `gasto sesión ${eurFmt.format(sessionUsd * rate)} · total ${eurFmt.format(st.spend.total_usd * rate)}`;
    const lastCalls = st.spend.calls
      .slice(-5)
      .map((c) => `  $${c.usd.toFixed(2)} ${c.service}: ${c.what}${c.procedencia === "real" ? "" : ` (${c.procedencia})`}`)
      .join("\n");
    this.spendEl.title =
      `Coste ESTIMADO (tablas Meshy/fal, no facturación real).\n` +
      `Total REAL: $${st.spend.total_usd.toFixed(2)} en ${st.spend.call_count} llamadas ` +
      `(fixture: $${st.spend.por_procedencia.fixture.usd.toFixed(2)} en ${st.spend.por_procedencia.fixture.call_count}) · ` +
      `tasa ${rate} €/$ (config.ts usd_eur_rate)` +
      (lastCalls ? `\nÚltimas llamadas:\n${lastCalls}` : "");
  }

  private renderConfig(st: DevStatus): void {
    const key = (name: string, ok: boolean) => `${name}${ok ? "✓" : "✗"}`;
    const channels = Object.keys(st.api_cache.channels).length;
    this.configEl.textContent =
      `superficies ${st.config.surface_model} · ` +
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
