/** Retrato del personaje con el que se habla.
 *
 *  Dos fuentes, ninguna de las cuales gasta un céntimo extra:
 *
 *  1. El **hero-shot** que el pipeline de skins YA paga por personaje
 *     (1024², frontal, pose neutral, con la dirección de arte del pack).
 *     Estaba en disco sin que nadie lo mirara: aquí se recorta a busto.
 *  2. El **busto animado** del ciclo idle del sprite — la skin del personaje
 *     si existe, y si no el y_bot base. Es el caso por defecto cuando la
 *     generación de personajes está apagada, y el único cuando no hay hero.
 *
 *  Ambas se pintan en el MISMO lienzo con la misma ventana de encuadre: el
 *  panel no sabe cuál está viendo y el cambio de una a otra no mueve nada.  */

import { errors } from "./error-log.js";
import { SPRITE_PENDING, type SpriteRenderer, type SpriteSheet } from "../renderer/sprite-renderer.js";

/** Lado del lienzo en píxeles de dispositivo. El CSS lo muestra a 96. */
const PORTRAIT_PX = 192;

/** Ventana de reserva, si no se pudo medir el contenido (imagen sin decodificar
 *  o de otro origen sin CORS). Encuadra la figura centrada típica. */
const BUST_FALLBACK = { x: 0.28, y: 0.16, w: 0.34, h: 0.34 };

/** Qué parte de la figura entra en el busto, contando desde la coronilla.
 *  0.45 = cabeza, hombros y pecho — el encuadre que pidió el diseño. */
const BUST_FRACTION = 0.45;

/** Encuadre del busto en un hero-shot. Aquí no se mide nada: el hero tiene
 *  un encuadre CONOCIDO por construcción (el prompt pide figura entera,
 *  frontal, a la altura de los ojos, sobre la misma pose base), y su fondo
 *  es pintado —papel, muro, degradado—, así que ningún umbral de color
 *  separa la silueta sin un segmentador de verdad. Verificado sobre los
 *  hero-shots de cache/sprite_sheets/heroes/: la figura va de ~4% a ~96% del
 *  alto, centrada. */
const BUST_HERO = { x: 0.29, y: 0.03, w: 0.42, h: 0.42 };

interface Window {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Source =
  | { kind: "hero"; img: HTMLImageElement }
  | { kind: "bust"; sheet: SpriteSheet; startedAt: number }
  | { kind: "none" };

export class PortraitView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private source: Source = { kind: "none" };
  /** Sheets de busto ya cargados, por modelo. */
  private bustSheets = new Map<string, SpriteSheet>();
  /** Encuadre medido por fuente (ver measureBust). */
  private bustWindows = new Map<string, Window>();
  private token = 0;

  constructor(
    private sprites: SpriteRenderer,
    private spritesBaseUrl: string,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = PORTRAIT_PX;
    this.canvas.height = PORTRAIT_PX;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("PortraitView: sin contexto 2D");
    this.ctx = ctx;
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Pide el retrato de un hablante. Resuelve async y nunca lanza: si no
   *  hay nada que mostrar, el lienzo queda vacío y el panel lo colapsa. */
  request(opts: { heroUrl?: string | null; skinModel?: string; baseModel: string }): void {
    const mine = ++this.token;
    this.source = { kind: "none" };
    this.clearCanvas();

    if (opts.heroUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = opts.heroUrl;
      img.decode()
        .then(() => {
          if (mine !== this.token) return;   // otro hablante ganó la carrera
          this.source = { kind: "hero", img };
          this.draw(performance.now());
        })
        .catch(() => {
          // Hero anunciado pero no servible: al busto, sin ruido de error
          // (el retrato es cosmético y el fallback es equivalente).
          if (mine === this.token) void this.useBust(opts, mine);
        });
      return;
    }
    void this.useBust(opts, mine);
  }

  private async useBust(opts: { skinModel?: string; baseModel: string }, mine: number): Promise<void> {
    // La skin generada, si la hay; si no, el modelo base (y_bot).
    // La skin solo se puede REUSAR de memoria: sus frames viven en el
    // asset-store, no en /sprites, así que no hay nada que pedir al servidor
    // estático. El modelo base sí se carga bajo demanda.
    for (const [model, allowFetch] of [[opts.skinModel, false], [opts.baseModel, true]] as const) {
      if (!model) continue;
      try {
        const sheet = await this.bustSheet(model, allowFetch);
        if (mine !== this.token) return;
        this.source = { kind: "bust", sheet, startedAt: performance.now() };
        return;
      } catch {
        // El siguiente candidato; el base es local y no debería fallar.
      }
    }
    errors.push("portrait", `sin retrato para "${opts.skinModel ?? opts.baseModel}" (ni hero ni sprite)`);
  }

  /** Sheet del busto: SOLO la dirección frontal del ciclo idle en el set
   *  `frontal_8` (mirada a cámara), que es el mismo del mundo — con una sola
   *  cámara no hay dos ángulos que reconciliar. Se carga por su cuenta
   *  porque son PNG locales y cuesta lo mismo que nada. */
  private async bustSheet(model: string, allowFetch: boolean): Promise<SpriteSheet> {
    const cached = this.bustSheets.get(model);
    if (cached) return cached;

    // Si la vista activa ya usa frontal_8 (fps), el sheet completo
    // está cargado: reusarlo en vez de pedir nada. `hasCached` antes de
    // `getCached` NO es redundante: getCached arranca una carga lazy cuando
    // falla, y para una skin eso significa pedir a /sprites unos frames que
    // viven en el asset-store — 404 y una entrada de error por cada NPC.
    if (this.sprites.hasCached(model, "idle", "frontal_8")) {
      const whole = this.sprites.getCached(model, "idle", "frontal_8");
      if (whole) {
        this.bustSheets.set(model, whole);
        return whole;
      }
    }

    if (!allowFetch) throw new Error(`sin sheet frontal_8 en memoria para "${model}"`);
    const base = `${this.spritesBaseUrl}/${model}/idle/frontal_8`;
    const res = await fetch(`${base}/meta.json`);
    if (!res.ok) throw new Error(`meta.json ${res.status} en ${base}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) throw new Error(`respuesta no-JSON en ${base}`);
    const meta = (await res.json()) as SpriteSheet;
    const frames = [
      Array.from({ length: meta.frame_count }, (_, f) => {
        const img = new Image();
        img.src = `${base}/dir_0_frame_${String(f).padStart(3, "0")}.png`;
        return img;
      }),
    ];
    const sheet: SpriteSheet = { ...meta, model, directions: 1, frames };
    this.bustSheets.set(model, sheet);
    return sheet;
  }

  /** Llamar por frame mientras el panel esté abierto. */
  tick(nowMs: number): void {
    if (this.source.kind === "bust") this.draw(nowMs);
  }

  private draw(nowMs: number): void {
    const src = this.source;
    if (src.kind === "none") return;
    if (src.kind === "hero") {
      this.paint(src.img, src.img.naturalWidth, src.img.naturalHeight, BUST_HERO);
      return;
    }
    const t = (nowMs - src.startedAt) / 1000;
    const frame = this.sprites.pickFrame(src.sheet, t, true);
    const img = this.sprites.pickImage(src.sheet, 0, frame);
    if (img === SPRITE_PENDING) return;
    this.paint(img, src.sheet.frame_width, src.sheet.frame_height, this.windowFor(src.sheet.model, img));
  }

  /** Encuadre del busto MEDIDO sobre la propia imagen: se localiza la figura
   *  y se recorta su parte alta. Una ventana fija no vale — y_bot, una skin
   *  generada y un hero-shot llenan su lienzo de formas distintas, y con
   *  medidas fijas alguno sale de cuerpo entero. Se mide una vez por fuente. */
  private windowFor(key: string, img: HTMLImageElement): Window {
    const known = this.bustWindows.get(key);
    if (known) return known;
    const win = measureBust(img) ?? BUST_FALLBACK;
    this.bustWindows.set(key, win);
    return win;
  }

  private paint(img: CanvasImageSource, srcW: number, srcH: number, win: Window): void {
    this.clearCanvas();
    this.ctx.drawImage(
      img,
      win.x * srcW, win.y * srcH, win.w * srcW, win.h * srcH,
      0, 0, PORTRAIT_PX, PORTRAIT_PX,
    );
  }

  private clearCanvas(): void {
    this.ctx.clearRect(0, 0, PORTRAIT_PX, PORTRAIT_PX);
  }

  clear(): void {
    this.token++;
    this.source = { kind: "none" };
    this.clearCanvas();
  }
}

/** Recuadro (en fracciones de la imagen) de la cabeza y el pecho de la figura
 *  de un SPRITE, midiendo su silueta por el canal alfa. Así el encuadre no
 *  depende de cuánto llene el personaje su celda: y_bot y una skin generada
 *  se recortan igual de bien sin números mágicos por sheet.
 *
 *  `null` si la imagen no trae alfa o no se puede leer el píxel (otro origen
 *  sin CORS) — el caller usa entonces un encuadre fijo. */
function measureBust(img: HTMLImageElement): Window | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;  // lienzo contaminado: el frame viene de otro origen
  }
  // Solo se mide lo que trae RECORTE (canal alfa): un sprite. Con un fondo
  // opaco no hay forma honesta de separar la silueta con un umbral —el fondo
  // de un hero-shot es papel o muro pintados— y el caller ya tiene para ese
  // caso un encuadre conocido.
  if (data[3] > 24) return null;
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;  // frame vacío
  const figureH = maxY - minY + 1;
  const side = Math.max(8, Math.round(figureH * BUST_FRACTION));
  // Cuadrado centrado en el eje de la figura, desde un poco antes de la
  // coronilla (deja aire sobre la cabeza).
  const cx = (minX + maxX) / 2;
  const top = Math.max(0, minY - side * 0.08);
  const left = Math.min(Math.max(0, cx - side / 2), w - side);
  return {
    x: left / w,
    y: Math.min(top, h - side) / h,
    w: side / w,
    h: side / h,
  };
}
