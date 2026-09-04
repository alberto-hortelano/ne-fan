/** Personajes animados por sprite: máquina de estados de animación por
 *  entidad, cola de generación de skins IA por descripción narrativa, y
 *  resolución por frame de qué modelo dibujar (base y_bot vs variante
 *  skinneada cuando su sheet ya está listo).
 *
 *  Contrato con CONFIG.graphics:
 *  - character_sprites=true → el set base de y_bot es obligatorio
 *    (preloadBase lanza si falta un sheet — fail-loud).
 *  - ai_skin=true → cada descripción encola un /skin_sprite_sheet por anim
 *    en orden de prioridad; ai_server caído degrada a la base y_bot con UNA
 *    entrada en el error-log por skin, sin reintentos.
 */
import { CONFIG } from "@nefan-core/src/config.js";
import { HOJAS_BASE_ANIMS } from "@nefan-core/src/contracts/sprite-census.js";
import { FALLO_HOJAS_BASE } from "@nefan-core/src/protocol/status-motivo.js";
import { errors } from "../ui/error-log.js";
import type { SpriteRenderer } from "./sprite-renderer.js";

/** Modelo base con el set completo de sheets pre-rendereados. */
export const BASE_MODEL = "y_bot";

/** Las 10 animaciones del set base (idle/locomoción/combate). La fuente es
 *  el censo (nefan-core): la MISMA lista con la que el middleware decide qué
 *  modelos ofrece el título — una copia local divergente haría al censo
 *  validar hojas que este cliente no pide. */
export const BASE_ANIMS = HOJAS_BASE_ANIMS;

const BASE_ANIM_SET: ReadonlySet<string> = new Set(BASE_ANIMS);

/** One-shots: se reproducen hasta el final y no se interrumpen por
 *  locomoción (sí por muerte o por otro one-shot nuevo). */
const ONE_SHOT: ReadonlySet<string> = new Set([
  "quick",
  "heavy",
  "medium",
  "defensive",
  "precise",
  "hit_react",
  "death",
]);

/** Anims que se generan automáticamente al spawnear un personaje (lo que se
 *  ve siempre). El resto se genera LAZY la primera vez que la entidad entra
 *  en esa anim (modelFor la encola) — cada llamada Meshy cuesta dinero real
 *  y muchas anims de combate no llegan a verse nunca en un NPC pacífico. */
const AUTO_SKIN_ANIMS = ["idle", "walk", "run"] as const;

export interface CharacterAnimState {
  anim: string;
  animStartedAt: number;
}

export function newAnimState(now: number = performance.now()): CharacterAnimState {
  return { anim: "idle", animStartedAt: now };
}

export interface AnimInputs {
  alive: boolean;
  moving: boolean;
  sprinting?: boolean;
  /** Trigger por nivel (enemigos): state winding_up|attacking del sim. */
  attacking?: boolean;
  attackType?: string;
  /** Trigger por evento (player): anim one-shot que arranca ESTE frame
   *  (ataque de attack_started, hit_react de attack_landed). Reinicia aunque
   *  ya fuera la anim actual — dos quick seguidos se ven como dos golpes. */
  oneShot?: string;
  /** Anim pedida por el NpcDirector (NpcUpdate.animation). Sin sheet en el
   *  set base cae a idle — las ambient están mapeadas pero sin renderear. */
  requestedAnim?: string;
}

interface SkinState {
  prompt: string;
  /** Rol de estilo (commoner|noble|warrior) — elige la ref character_* del
   *  pack en el servidor. Ausente = commoner (default del server). */
  role?: string;
  /** Un fallo (Meshy caído, sin API key) marca el skin entero: no se
   *  reintenta ni se encolan más anims — la entidad vive en la base y_bot. */
  failed: boolean;
  /** Anims ya encoladas (o completadas) — cada (prompt, anim) se pide una vez. */
  queued: Set<string>;
}

/** Cuántos PERSONAJES distintos tienen que fallar antes de apagar los skins de
 *  la sesión entera.
 *
 *  El cortacircuitos no desaparece (#236): sigue siendo el único fusible
 *  contra una tormenta de peticiones que fallan todas —y, contra un
 *  sprite-forge sin actualizar, contra pagarlas todas—. Lo que cambia es el
 *  radio: apagaba a la PRIMERA, así que un 500 de un solo personaje devolvía
 *  al jugador el mundo de maniquíes idénticos que #173 vino a arreglar, sin
 *  salida salvo recargar. Tres personajes distintos fallando ya no es mala
 *  suerte: es el backend. Uno, sí puede serlo.
 *
 *  Se cuentan PERSONAJES y no fallos: un mismo personaje puede fallar en
 *  varias anims (`modelFor` encola las de combate perezosamente) y eso sigue
 *  siendo una sola evidencia sobre el estado del backend. */
export const UMBRAL_APAGADO_DE_SESION = 3;

export class CharacterSpriteManager {
  /** `${skinnedModel}/${anim}` cuyos frames están generados Y decodificados —
   *  solo entonces sustituyen a la base (evita el parpadeo SPRITE_PENDING). */
  private readySkins = new Set<string>();
  private skins = new Map<string, SkinState>();
  /** Cadena secuencial de generación: cada anim son varias llamadas Meshy
   *  (una por dirección) que el ai_server ya paraleliza; encolar prompts en
   *  paralelo desde el cliente solo acumula HTTP colgados de minutos. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private sprites: SpriteRenderer,
    private angle: string,
  ) {}

  /** Carga el set base completo de y_bot. Obligatorio antes del primer frame
   *  cuando character_sprites=true; lanza si falta cualquier sheet.
   *
   *  `allSettled` y no `all`: las diez hojas se piden igual en los dos casos
   *  —`all` no cancela nada—, pero `all` rechaza con la PRIMERA, así que el
   *  resumen «qué hacer» (main.ts) se registraba ANTES que los nueve fallos
   *  restantes y quedaba sepultado debajo en el panel, que va del más nuevo al
   *  más viejo. En un clon limpio fallan las diez (#255) y esa línea es la
   *  única accionable: se registra la última para que sea la primera que se
   *  lee. Sigue lanzando si falta cualquiera — el fail-loud no se toca. */
  async preloadBase(): Promise<void> {
    const cargas = await Promise.allSettled(
      BASE_ANIMS.map((anim) => this.sprites.loadAnimation(BASE_MODEL, anim, this.angle)),
    );
    const fallidas = BASE_ANIMS.filter((_, i) => cargas[i]?.status === "rejected");
    const primera = cargas.find((c) => c.status === "rejected");
    if (primera?.status === "rejected") {
      // El motivo CONCRETO de la primera viaja en el mensaje: sin él, agrupar
      // los fallos cambiaría «HTTP 404 on /sprites/y_bot/idle/…» por un
      // recuento que no dice dónde mirar.
      //
      // Y el CÓDIGO va delante porque este rechazo no se queda aquí: sube por
      // `setPlayerAppearance` hasta el catch del arranque, que lo traduce con
      // `motivoDeSesionParaElJugador`. Sin código, esa traducción no lo
      // reconocía y le decía al jugador que el servidor había fallado y que
      // reintentara (#255 p2, hallazgo H1 de QA).
      throw new Error(
        `${FALLO_HOJAS_BASE}: faltan ${fallidas.length} de ${BASE_ANIMS.length} hojas ` +
          `(${fallidas.join(", ")}) — ${String(primera.reason)}`,
      );
    }
  }

  get activeAngle(): string {
    return this.angle;
  }

  /** Encola la generación del skin IA para una descripción narrativa: las
   *  AUTO_SKIN_ANIMS al spawnear; el resto lo encola modelFor bajo demanda.
   *  Idempotente por prompt (dos NPCs con la misma descripción comparten
   *  skin). No-op con ai_skin=false o prompt vacío. */
  /** Cortacircuitos de sesión: se dispara cuando `UMBRAL_APAGADO_DE_SESION`
   *  personajes DISTINTOS han fallado con un error de backend (red o 5xx).
   *  Sin él, cada NPC × animación repetiría el mismo error (tormenta de 502
   *  con Meshy caído o sin créditos) y, contra un servicio que cobra antes de
   *  fallar, cada repetición sería dinero. */
  private skinsDisabled = false;

  /** Los personajes (por `skinnedModel`) que ya fallaron con error de backend.
   *  Es lo que cuenta contra el umbral, y por eso es un Set y no un contador:
   *  el mismo personaje fallando en tres anims es UNA evidencia, no tres. */
  private personajesFallidos = new Set<string>();

  /** Decisión de la sesión (no un fallo): el modo de render "vector" apaga
   *  los skins IA — todos los personajes se dibujan con la base y_bot, sin
   *  encolar ni gastar llamadas al modelo de imagen. */
  private allowed = true;

  get skinsAllowed(): boolean {
    return this.allowed;
  }

  setSkinsAllowed(allowed: boolean): void {
    this.allowed = allowed;
  }

  /** Rearma el cortacircuitos de fallos de backend: borra el flag, la cuenta
   *  de personajes fallidos Y **el recuerdo de los que fallaron**.
   *
   *  Las dos primeras cosas devuelven a la sesión la CAPACIDAD de pedir skins.
   *  La tercera es la que hace que eso sirva de algo, y faltaba: `requestSkin`
   *  sale antes para un personaje que ya tiene estado y no lleva `force`
   *  (`if (existing) { if (!opts.force …) return; }`), así que rearmar sin
   *  olvidar dejaba a los vecinos que ya habían fallado en maniquí para TODA
   *  la vida de la pestaña — `CharacterSpriteManager` es un singleton de
   *  módulo y su mapa `skins` sobrevive a volver al título y reanudar. El
   *  único camino de vuelta era el botón `force` del menú dev, o recargar. Un
   *  «rearme» que no rearma es peor que no tenerlo: promete una salida que no
   *  existe.
   *
   *  OLVIDAR y no re-pedir, que es la diferencia que cuesta dinero: borrar el
   *  estado deja que la SIGUIENTE petición de ese personaje empiece limpia,
   *  sin encolar nada aquí. Re-pedirlos en bloque pagaría los skins de los
   *  vecinos de la partida anterior, que en la nueva puede que no aparezcan.
   *  Y no se toca `readySkins`: el arte YA PAGADO se conserva, y la caché del
   *  renderer sirve esas anims sin una sola petición.
   *
   *  Se llama al ENTRAR o REANUDAR una sesión y cuando el usuario reactiva los
   *  personajes IA desde el menú dev. Lo primero es nuevo: hasta #236 el único
   *  llamante era el OFF→ON del menú dev. */
  rearmarCortacircuitos(): void {
    this.skinsDisabled = false;
    this.personajesFallidos.clear();
    for (const [skinnedModel, state] of this.skins) {
      if (state.failed) this.skins.delete(skinnedModel);
    }
  }

  /** Estado de un skin por prompt, para el menú dev. "ready" = la anim idle
   *  ya sustituye a la base; "pending" = pedido y en cola/generándose. */
  skinStatus(prompt: string): "ready" | "pending" | "failed" | "unrequested" {
    const skinned = this.sprites.skinKey(BASE_MODEL, prompt);
    if (this.readySkins.has(`${skinned}/idle`)) return "ready";
    const state = this.skins.get(skinned);
    if (!state) return "unrequested";
    return state.failed ? "failed" : "pending";
  }

  /** `force` (botón por-item del menú dev): salta el gate de sesión
   *  (`allowed`) y el cortacircuitos, y rearma un skin marcado failed para
   *  reintentarlo. NUNCA salta CONFIG.graphics.ai_skin — con el flag apagado
   *  no existe backend de skins que llamar (fail-loud en el caller). */
  requestSkin(prompt: string, opts: { force?: boolean; role?: string } = {}): void {
    if (!CONFIG.graphics.ai_skin || !prompt) return;
    if (!opts.force && (!this.allowed || this.skinsDisabled)) return;
    // La identidad cliente del skin sigue siendo el prompt (skinKey): dos
    // NPCs con el mismo prompt y rol distinto compartirían la primera hoja
    // pedida — caso raro; el servidor sí cachea ambas variantes por rol.
    const skinnedModel = this.sprites.skinKey(BASE_MODEL, prompt);
    const existing = this.skins.get(skinnedModel);
    if (existing) {
      if (!opts.force || !existing.failed) return;
      // Reintento explícito de ESTE personaje. El orden importa: primero se
      // rearma la sesión —que de paso OLVIDA a todos los fallidos, este
      // incluido— y luego se vuelve a sembrar su estado con su `role`, que es
      // lo que elige la ref de personaje del pack y no se puede perder.
      this.rearmarCortacircuitos();
      const state: SkinState = { prompt, role: opts.role ?? existing.role, failed: false, queued: new Set() };
      this.skins.set(skinnedModel, state);
      for (const anim of AUTO_SKIN_ANIMS) this.enqueueAnim(skinnedModel, state, anim);
      return;
    }
    if (opts.force) this.rearmarCortacircuitos();
    const state: SkinState = { prompt, role: opts.role, failed: false, queued: new Set() };
    this.skins.set(skinnedModel, state);
    for (const anim of AUTO_SKIN_ANIMS) this.enqueueAnim(skinnedModel, state, anim);
  }

  /** Libro de skins: qué personajes ha PEDIDO la partida y con qué rol, más
   *  las anims encoladas y las ya listas. Estado para el hook __nefan / QA —
   *  lo escribe `requestSkin`, que es el camino que se prueba. Sustituye a
   *  esperar N peticiones de red contra un reloj: aquí está escrito lo que el
   *  juego pidió, se conteste o no. */
  debugState(): Array<{ prompt: string; role?: string; queued: string[]; ready: string[]; failed: boolean }> {
    return [...this.skins.entries()].map(([skinnedModel, s]) => ({
      prompt: s.prompt,
      ...(s.role ? { role: s.role } : {}),
      queued: [...s.queued],
      ready: [...this.readySkins]
        .filter((k) => k.startsWith(`${skinnedModel}/`))
        .map((k) => k.slice(skinnedModel.length + 1)),
      failed: s.failed,
    }));
  }

  private enqueueAnim(skinnedModel: string, state: SkinState, anim: string): void {
    state.queued.add(anim);
    this.chain = this.chain.then(async () => {
      if (state.failed || this.skinsDisabled) return;
      try {
        const sheet = await this.sprites.loadSkinnedAnimation(
          BASE_MODEL, anim, this.angle, state.prompt, state.role,
        );
        // Espera a que los PNG decodifiquen antes de marcar la anim lista:
        // la sustitución debe ser atómica, sin frames SPRITE_PENDING.
        await Promise.all(sheet.frames.flat().map((img) => img.decode()));
        this.readySkins.add(`${skinnedModel}/${anim}`);
      } catch (err) {
        // Meshy/ai_server caído o sin API key: la entidad se queda con la base
        // y_bot y no se reintenta (sin bucles). El fallo marca el PERSONAJE, no
        // la sesión: los demás siguen pidiendo y recibiendo su skin.
        state.failed = true;
        // UNA entrada por fallo, SIEMPRE. Antes esto era un if/else cuya rama
        // muda —un 5xx con el flag de sesión ya puesto— no escribía nada; la
        // tapaba el corte de la cola de arriba, y quitar el flag de sesión la
        // habría convertido en el camino normal.
        errors.push(
          "sprite",
          `skin IA cancelada en "${anim}" para "${state.prompt.slice(0, 40)}" — se mantiene la base y_bot`,
          err,
        );
        const status = (err as { status?: number }).status;
        const backendDown = status === undefined || status >= 500;
        if (!backendDown) return;
        this.personajesFallidos.add(skinnedModel);
        if (this.skinsDisabled || this.personajesFallidos.size < UMBRAL_APAGADO_DE_SESION) return;
        this.skinsDisabled = true;
        errors.push(
          "sprite",
          `skins IA desactivados para la sesión: ${this.personajesFallidos.size} personajes ` +
            `distintos han fallado con error de backend (umbral ${UMBRAL_APAGADO_DE_SESION}). ` +
            `Los personajes usan la base y_bot. Último motivo: ${(err as Error).message}`,
        );
      }
    });
  }

  /** Modelo a dibujar este frame para (descripción, anim): la variante
   *  skinneada si su sheet de ESA anim está listo, si no `baseModel` (y_bot
   *  salvo para un player con modelo alternativo completo en disco). Los
   *  skins siempre se generan sobre y_bot — su base img2img canónica.
   *
   *  Efecto lateral deliberado: la primera vez que una entidad entra en una
   *  anim fuera de AUTO_SKIN_ANIMS (un ataque, death…), aquí se encola su
   *  generación lazy — estará lista para las siguientes veces. */
  modelFor(skinPrompt: string | undefined, anim: string, baseModel: string = BASE_MODEL): string {
    if (!this.allowed || !skinPrompt || !CONFIG.graphics.ai_skin) return baseModel;
    const skinned = this.sprites.skinKey(BASE_MODEL, skinPrompt);
    if (this.readySkins.has(`${skinned}/${anim}`)) return skinned;
    const state = this.skins.get(skinned);
    if (state && !state.failed && !state.queued.has(anim) && BASE_ANIM_SET.has(anim)) {
      this.enqueueAnim(skinned, state, anim);
    }
    return baseModel;
  }

  /** Duración (ms) de una anim del set base; los skins comparten meta. */
  private durationMs(anim: string): number {
    if (!this.sprites.hasCached(BASE_MODEL, anim, this.angle)) return 1000;
    const sheet = this.sprites.getCached(BASE_MODEL, anim, this.angle);
    return sheet ? sheet.duration * 1000 : 1000;
  }

  /** Avanza la máquina de estados de animación de una entidad. Muta `state`
   *  y resetea `animStartedAt` solo cuando la anim cambia (o un one-shot por
   *  evento se re-dispara). Prioridad: muerte > one-shot por evento > ataque
   *  por nivel > one-shot en curso > locomoción > anim pedida > idle. */
  updateAnim(state: CharacterAnimState, inputs: AnimInputs, now: number = performance.now()): void {
    const set = (anim: string): void => {
      if (state.anim !== anim) {
        state.anim = anim;
        state.animStartedAt = now;
      }
    };

    if (!inputs.alive) {
      // death arranca en la transición viva→muerta y clampa en el último
      // frame (pickFrame de one-shot): el cadáver se queda en pantalla.
      set("death");
      return;
    }
    if (state.anim === "death") set("idle"); // respawn/revive

    if (inputs.oneShot && BASE_ANIM_SET.has(inputs.oneShot)) {
      state.anim = inputs.oneShot;
      state.animStartedAt = now;
      return;
    }

    if (inputs.attacking) {
      const attackAnim =
        inputs.attackType && BASE_ANIM_SET.has(inputs.attackType) ? inputs.attackType : "medium";
      // Nivel, no evento: arranca al entrar en winding_up|attacking y clampa
      // en el último frame si el estado del sim dura más que la anim.
      set(attackAnim);
      return;
    }

    const oneShotActive =
      ONE_SHOT.has(state.anim) && now - state.animStartedAt < this.durationMs(state.anim);
    if (oneShotActive) return;

    if (inputs.moving) {
      set(inputs.sprinting ? "run" : "walk");
      return;
    }
    if (inputs.requestedAnim) {
      set(BASE_ANIM_SET.has(inputs.requestedAnim) ? inputs.requestedAnim : "idle");
      return;
    }
    set("idle");
  }
}
