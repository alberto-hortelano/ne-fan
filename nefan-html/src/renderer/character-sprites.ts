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
import { errors } from "../ui/error-log.js";
import type { SpriteRenderer } from "./sprite-renderer.js";

/** Modelo base con el set completo de sheets pre-rendereados. */
export const BASE_MODEL = "y_bot";

/** Las 10 animaciones del set base (idle/locomoción/combate). */
export const BASE_ANIMS = [
  "idle",
  "walk",
  "run",
  "quick",
  "heavy",
  "medium",
  "defensive",
  "precise",
  "hit_react",
  "death",
] as const;

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
  /** Un fallo (Meshy caído, sin API key) marca el skin entero: no se
   *  reintenta ni se encolan más anims — la entidad vive en la base y_bot. */
  failed: boolean;
  /** Anims ya encoladas (o completadas) — cada (prompt, anim) se pide una vez. */
  queued: Set<string>;
}

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
   *  cuando character_sprites=true; lanza si falta cualquier sheet. */
  async preloadBase(): Promise<void> {
    await Promise.all(
      BASE_ANIMS.map((anim) => this.sprites.loadAnimation(BASE_MODEL, anim, this.angle)),
    );
  }

  /** Encola la generación del skin IA para una descripción narrativa: las
   *  AUTO_SKIN_ANIMS al spawnear; el resto lo encola modelFor bajo demanda.
   *  Idempotente por prompt (dos NPCs con la misma descripción comparten
   *  skin). No-op con ai_skin=false o prompt vacío. */
  requestSkin(prompt: string): void {
    if (!CONFIG.graphics.ai_skin || !prompt) return;
    const skinnedModel = this.sprites.skinKey(BASE_MODEL, prompt);
    if (this.skins.has(skinnedModel)) return;
    const state: SkinState = { prompt, failed: false, queued: new Set() };
    this.skins.set(skinnedModel, state);
    for (const anim of AUTO_SKIN_ANIMS) this.enqueueAnim(skinnedModel, state, anim);
  }

  private enqueueAnim(skinnedModel: string, state: SkinState, anim: string): void {
    state.queued.add(anim);
    this.chain = this.chain.then(async () => {
      if (state.failed) return;
      try {
        const sheet = await this.sprites.loadSkinnedAnimation(
          BASE_MODEL, anim, this.angle, state.prompt,
        );
        // Espera a que los PNG decodifiquen antes de marcar la anim lista:
        // la sustitución debe ser atómica, sin frames SPRITE_PENDING.
        await Promise.all(sheet.frames.flat().map((img) => img.decode()));
        this.readySkins.add(`${skinnedModel}/${anim}`);
      } catch (err) {
        // Meshy/ai_server caído o sin API key: la entidad se queda con la
        // base y_bot. Una entrada por skin; el flag corta lo ya encolado y
        // bloquea futuros lazy de este prompt (sin bucles de reintento).
        state.failed = true;
        errors.push(
          "sprite",
          `skin IA cancelada en "${anim}" para "${state.prompt.slice(0, 40)}" — se mantiene la base y_bot`,
          err,
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
    if (!skinPrompt || !CONFIG.graphics.ai_skin) return baseModel;
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
