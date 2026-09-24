/** Personajes animados por sprite: máquina de estados de animación por
 *  entidad, cola de generación de skins IA por descripción narrativa, y
 *  resolución por frame de qué modelo dibujar (base y_bot vs variante
 *  skinneada cuando su sheet ya está listo).
 *
 *  Contrato con CONFIG.graphics:
 *  - character_sprites=true → el set base de y_bot es obligatorio
 *    (`precargarHojasBase`, en `hojas-base.ts`, lanza si falta un sheet).
 *  - ai_skin=true → cada descripción encola un /skin_sprite_sheet por anim
 *    en orden de prioridad; ai_server caído degrada a la base y_bot con UNA
 *    entrada en el error-log por skin, sin reintentos.
 */
import { CONFIG } from "@nefan-core/src/config.js";
import { HOJAS_BASE_ANIMS } from "@nefan-core/src/contracts/sprite-census.js";
import { FusibleDeSkins } from "@nefan-core/src/session/fusible-de-skins.js";
import { skinPideSoloLoPagado, type PermisoDePersonajes } from "@nefan-core/src/session/gates-de-imagen.js";
import { errors } from "../ui/error-log.js";
import { SIN_ARTE, type SpriteRenderer } from "./sprite-renderer.js";
import { CadenaDeSkins } from "./cadena-de-skins.js";
import { artePendienteDeSkins } from "./arte-pendiente-de-skins.js";
import {
  avanzarAnimacion,
  BASE_ANIM_SET,
  type AnimInputs,
  type CharacterAnimState,
} from "./maquina-de-animacion.js";
import type { ArtePendiente } from "./types.js";

/** Modelo base con el set completo de sheets pre-rendereados. */
export const BASE_MODEL = "y_bot";

/** Las 10 animaciones del set base (idle/locomoción/combate). La fuente es
 *  el censo (nefan-core): la MISMA lista con la que el middleware decide qué
 *  modelos ofrece el título — una copia local divergente haría al censo
 *  validar hojas que este cliente no pide. */
export const BASE_ANIMS = HOJAS_BASE_ANIMS;

/** Anims que se generan automáticamente al spawnear un personaje (lo que se
 *  ve siempre). El resto se genera LAZY la primera vez que la entidad entra
 *  en esa anim (modelFor la encola) — cada llamada Meshy cuesta dinero real
 *  y muchas anims de combate no llegan a verse nunca en un NPC pacífico. */
const AUTO_SKIN_ANIMS: readonly string[] = ["idle", "walk", "run"];

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
  /** Anims que se preguntaron SOLO POR LO PAGADO y no lo estaban. No se
   *  vuelven a preguntar mientras el permiso siga en `restaurar` (sin esto,
   *  `modelFor` re-encolaría una por fotograma); se olvidan cuando el permiso
   *  sube a `generar`, y entonces el re-pedido las encuentra como hueco. */
  sinArte: Set<string>;
  /** Pedido a mano (`force`, menú dev): el jugador eligió pagar ESTE
   *  personaje, así que su set AUTOMÁTICO genera aunque el permiso sea
   *  `restaurar`. Sus lazy de `modelFor` NO: las dispara un fotograma, no el
   *  clic, y siguen al permiso como las de cualquiera (#756, en core:
   *  `skinPideSoloLoPagado`). */
  forzado: boolean;
}

export class CharacterSpriteManager {
  /** `${skinnedModel}/${anim}` cuyos frames están generados Y decodificados —
   *  solo entonces sustituyen a la base (evita el parpadeo SPRITE_PENDING). */
  private readySkins = new Set<string>();
  private skins = new Map<string, SkinState>();
  /** Cadena secuencial de generación y su balance (`cadena-de-skins.ts`). */
  private cadena = new CadenaDeSkins();

  constructor(
    private sprites: SpriteRenderer,
    private angle: string,
  ) {}

  /** Cortacircuitos de sesión (#236): cuántos personajes DISTINTOS con error
   *  de backend (red o 5xx) apagan los skins de la sesión, y por qué se cuentan
   *  personajes y no fallos, lo decide core (`FusibleDeSkins`). Aquí solo se le
   *  cuenta cada fallo y se hace lo que diga. */
  private fusible = new FusibleDeSkins();

  /** Decisión de la sesión y del entorno (no un fallo), la de
   *  `gatesDeImagen` en core: `base` (modo "vector": todos con la base y_bot,
   *  sin encolar nada), `restaurar` (Imagen IA en desarrollo: se pide SOLO lo
   *  ya pagado, con `resolve_only`) o `generar`. Nace en `generar` porque
   *  `ui/modos-de-graficos.ts` lo fija nada más construirse, antes del primer
   *  personaje; quien use el gestor suelto (el banco del cliente) lo ve como
   *  siempre. */
  private permiso: PermisoDePersonajes = "generar";

  get permisoDeSkins(): PermisoDePersonajes {
    return this.permiso;
  }

  /** ¿El cortacircuitos tiene los skins apagados AHORA MISMO? (#510)
   *
   *  `permisoDeSkins` es el MODO que eligió la partida y el fusible no lo toca —a
   *  propósito: el rearme se pide apagando y encendiendo Personajes en el chip
   *  (lo canda el guion 51), y eso deja de funcionar si el fusible mueve el
   *  modo—. Pero entonces el chip decía «Skins IA» con el registro diciendo que
   *  estaban desactivados: dos verdades en pantalla. Este getter es el estado
   *  EFECTIVO, que es lo que el chip enseña. */
  get skinsSuspendidos(): boolean {
    return this.fusible.apagado;
  }

  /** Aviso de que el fusible ACABA de saltar. El chip solo se re-pinta cuando
   *  cambian los modos, y el fusible salta a mitad de partida sin que ningún
   *  modo se mueva: sin esto el chip seguiría mintiendo hasta el siguiente
   *  gesto del jugador. Lo cablea `ui/modos-de-graficos.ts`. */
  alSaltarElFusible: (() => void) | null = null;

  setPermisoDeSkins(permiso: PermisoDePersonajes): void {
    // Al SUBIR a generar, lo que se preguntó «solo si está pagado» y no lo
    // estaba deja de estar vetado: vuelve a ser hueco que re-pedir.
    if (permiso === "generar" && this.permiso !== "generar") {
      for (const state of this.skins.values()) state.sinArte.clear();
    }
    this.permiso = permiso;
  }

  /** A dónde va la línea de balance de los skins restaurados (una por tanda,
   *  como la del atlas). La cablea `ui/modos-de-graficos.ts`. */
  set anunciar(fn: ((msg: string) => void) | null) {
    this.cadena.anunciar = fn;
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
   *  LO QUE ESTO NO ARREGLA SOLO, dicho para que no se lea de más: el personaje
   *  que no falló pero se quedó a medias —sus anims encoladas se SALTARON al
   *  fundirse el fusible— no está en `skins` como `failed`, así que no se
   *  borra aquí ni tiene por qué. Vuelve por su camino natural: la próxima
   *  `requestSkin` completa lo que le falte del set automático y `modelFor`
   *  encola lo demás cuando la entidad entra en esa anim (#520). Lo que hace
   *  posible ese regreso es que una anim SALTADA se desapunte de `queued`, en
   *  `enqueueAnim`: sin eso los dos caminos preguntaban por un apunte que
   *  mentía y ninguno volvía a encolar nada.
   *
   *  Se llama al ENTRAR o REANUDAR una sesión y cuando el usuario reactiva los
   *  personajes IA desde el menú dev. Lo primero es nuevo: hasta #236 el único
   *  llamante era el OFF→ON del menú dev. */
  /** Entrar o reanudar una partida: rearma el cortacircuitos y olvida a
   *  quién contó ya la línea de balance (`cadena-de-skins.ts`), que es de la
   *  partida y no de la pestaña. El rearme del menú dev NO olvida eso. */
  empezarPartida(): void {
    this.rearmarCortacircuitos();
    this.cadena.olvidarContados();
  }

  rearmarCortacircuitos(): void {
    this.fusible.rearmar();
    for (const [skinnedModel, state] of this.skins) {
      if (state.failed) this.skins.delete(skinnedModel);
    }
  }

  /** Los skins que aún van sobre la base y_bot, para el menú dev. Recibe los
   *  prompts VIVOS porque este gestor solo conoce los que pasaron por
   *  `requestSkin` —en maqueta, ninguno—, y aquí solo se contesta lo que solo él
   *  sabe: la lista la arma `arte-pendiente-de-skins.ts` (#492).
   *
   *  `readySkins` se mira ANTES que el registro, y no es un atajo: rearmar el
   *  cortacircuitos borra la entrada del que falló y CONSERVA su arte, así que
   *  hay prompts con la `idle` puesta y sin registro. Preguntando solo al
   *  registro volverían a la lista a ofrecer que se pague lo ya pagado. */
  pendientes(prompts: Iterable<string>): ArtePendiente[] {
    return artePendienteDeSkins(prompts, {
      miniatura: this.sprites.getCached(BASE_MODEL, "idle", this.angle)?.frames[0]?.[0] ?? null,
      pedir: (prompt) => this.requestSkin(prompt, { force: true }),
      estado: (prompt) => {
        const skinned = this.sprites.skinKey(BASE_MODEL, prompt);
        if (this.readySkins.has(`${skinned}/idle`)) return "listo";
        const state = this.skins.get(skinned);
        // Sin ninguna anim en cola, nada se está generando: es un personaje
        // al que se le preguntó por lo pagado y no lo estaba (desarrollo).
        return !state || (!state.failed && state.queued.size === 0)
          ? "sin pedir"
          : state.failed ? "falló" : "generándose";
      },
    });
  }

  /** Encola la generación del skin IA para una descripción narrativa: las
   *  AUTO_SKIN_ANIMS al spawnear; el resto lo encola modelFor bajo demanda.
   *  Idempotente por prompt (dos NPCs con la misma descripción comparten
   *  skin). No-op con ai_skin=false o prompt vacío.
   *
   *  `force` (botón por-item del menú dev): salta el permiso de la sesión y
   *  del entorno (`permiso`: genera aunque sea `base` o `restaurar`, porque
   *  pulsarlo ES elegir pagar) y el cortacircuitos, y rearma un skin marcado
   *  failed para reintentarlo. NUNCA salta CONFIG.graphics.ai_skin — con el flag apagado
   *  no existe backend de skins que llamar (fail-loud en el caller). */
  requestSkin(prompt: string, opts: { force?: boolean; role?: string } = {}): void {
    if (!CONFIG.graphics.ai_skin || !prompt) return;
    if (!opts.force && (this.permiso === "base" || this.fusible.apagado)) return;
    // La identidad cliente del skin sigue siendo el prompt (skinKey): dos
    // NPCs con el mismo prompt y rol distinto compartirían la primera hoja
    // pedida — caso raro; el servidor sí cachea ambas variantes por rol.
    const skinnedModel = this.sprites.skinKey(BASE_MODEL, prompt);
    const existing = this.skins.get(skinnedModel);
    if (existing) {
      if (existing.failed) {
        // Un skin FALLIDO no se reintenta solo (sin bucles): hace falta el
        // botón `force` del menú dev.
        if (!opts.force) return;
        // Reintento explícito de ESTE personaje. El orden importa: primero se
        // rearma la sesión —que de paso OLVIDA a todos los fallidos, este
        // incluido— y luego se vuelve a sembrar su estado con su `role`, que es
        // lo que elige la ref de personaje del pack y no se puede perder.
        this.rearmarCortacircuitos();
        const state: SkinState = {
          prompt,
          role: opts.role ?? existing.role,
          failed: false,
          queued: new Set(),
          sinArte: new Set(),
          forzado: true,
        };
        this.skins.set(skinnedModel, state);
        for (const anim of AUTO_SKIN_ANIMS) this.enqueueAnim(skinnedModel, state, anim);
        return;
      }
      // VIVO, pero puede tener HUECOS, y es el caso de #520: cuando el fusible
      // se fundió, las anims que este personaje tenía ENCOLADAS y aún sin pedir
      // se saltaron. No falló —el apagón fue de otros tres—, así que
      // `rearmarCortacircuitos` no lo olvida y este `if (existing)` salía
      // derecho: el vecino se quedaba en maniquí el resto de la vida de la
      // pestaña, porque `CharacterSpriteManager` es un singleton de módulo y su
      // mapa sobrevive a volver al título. Pedir lo que falta del set
      // automático NO es re-pedir en bloque: se piden las anims de un personaje
      // que ESTA partida acaba de pedir, y solo las que nadie ha encolado.
      // `force` sobre uno vivo (el menú dev sobre un personaje que en
      // desarrollo solo restauraba): ahora es elegido, y lo que no estaba
      // pagado deja de estar vetado.
      if (opts.force) {
        existing.forzado = true;
        existing.sinArte.clear();
      }
      for (const anim of AUTO_SKIN_ANIMS) {
        if (!existing.queued.has(anim) && !existing.sinArte.has(anim)) this.enqueueAnim(skinnedModel, existing, anim);
      }
      return;
    }
    if (opts.force) this.rearmarCortacircuitos();
    const state: SkinState = {
      prompt,
      role: opts.role,
      failed: false,
      queued: new Set(),
      sinArte: new Set(),
      forzado: opts.force === true,
    };
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
    this.cadena.encolar(() => this.pedirAnim(skinnedModel, state, anim));
  }

  /** Un eslabón de la cadena: pide UNA anim de un personaje. */
  private async pedirAnim(skinnedModel: string, state: SkinState, anim: string): Promise<void> {
    if (state.failed) return;
    if (this.fusible.apagado) {
      // El apagón de la SESIÓN saltó esta anim ANTES de pedirla: no se pidió,
      // así que no puede quedarse apuntada como pedida (#520). Con el apunte
      // puesto, `queued` mentía: ni `requestSkin` ni `modelFor` volvían a
      // encolarla nunca —los dos preguntan por él—, y al rearmar el fusible
      // el personaje seguía en maniquí sin más salida que recargar. Olvidar
      // no gasta: deja que la SIGUIENTE petición empiece limpia.
      state.queued.delete(anim);
      return;
    }
    // La intención se decide AL PEDIR y no al encolar: si el permiso bajó
    // mientras esperaba turno, se pregunta solo por lo pagado. El elegido a
    // mano (`forzado`) paga su set automático y nada más (#756).
    const resolveOnly = skinPideSoloLoPagado(this.permiso, {
      elegidaAMano: state.forzado,
      delSetAutomatico: AUTO_SKIN_ANIMS.includes(anim),
    });
    try {
      const sheet = await this.sprites.loadSkinnedAnimation(
        BASE_MODEL,
        anim,
        this.angle,
        state.prompt,
        state.role,
        { resolveOnly },
      );
      if (sheet === SIN_ARTE) {
        // No está pagado y no se generó nada: NO es un fallo (ni `failed`
        // ni fusible). Se desapunta de `queued` para que un permiso más alto
        // lo encuentre como hueco, y se veta mientras siga en restaurar.
        state.queued.delete(anim);
        state.sinArte.add(anim);
        this.cadena.sinArte(skinnedModel);
        return;
      }
      // Espera a que los PNG decodifiquen antes de marcar la anim lista:
      // la sustitución debe ser atómica, sin frames SPRITE_PENDING.
      await Promise.all(sheet.frames.flat().map((img) => img.decode()));
      this.readySkins.add(`${skinnedModel}/${anim}`);
      if (resolveOnly) this.cadena.restaurado(skinnedModel);
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
      if (this.fusible.fallo(skinnedModel, (err as { status?: number }).status) !== "apagar") return;
      // SIN «la sesión» (#510-p3): el fusible es de esta PESTAÑA, y se funde
      // igual jugando una partida que mirando una fixture del selector, donde
      // no hay ninguna sesión de la que hablar. El aviso decía «desactivados
      // para la sesión» en los dos casos, así que en el segundo nombraba algo
      // que el jugador no tiene delante. Lo que sí es cierto siempre es qué
      // pasa (van con la base) y cómo se deshace (el chip de gráficos), y eso
      // es lo que se dice. `CharacterSpriteManager` no sabe si hay partida y
      // no tiene por qué: un texto que vale en los dos mundos no puede
      // equivocarse en ninguno.
      errors.push(
        "sprite",
        `skins IA desactivados: ${this.fusible.caidos} personajes distintos han fallado ` +
          `con error de backend (umbral ${this.fusible.umbral}). Los personajes van con la ` +
          `base y_bot hasta que los reactives en el chip de gráficos. ` +
          `Último motivo: ${(err as Error).message}`,
      );
      // …y que el chip de gráficos deje de decir lo contrario (#510).
      this.alSaltarElFusible?.();
    }
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
    if (this.permiso === "base" || !skinPrompt || !CONFIG.graphics.ai_skin) return baseModel;
    const skinned = this.sprites.skinKey(BASE_MODEL, skinPrompt);
    if (this.readySkins.has(`${skinned}/${anim}`)) return skinned;
    const state = this.skins.get(skinned);
    // `fusible.apagado` en la guarda, y no solo dentro de la cadena: con los
    // skins de la sesión apagados, `enqueueAnim` sale por su puerta de arriba y
    // desapunta la anim (#520) — así que sin esto se re-encolaría una promesa
    // por personaje y por FOTOGRAMA. Lo que ya está pagado se sigue dibujando:
    // la guarda es de la generación LAZY, no de `readySkins`.
    if (
      state &&
      !state.failed &&
      !this.fusible.apagado &&
      !state.queued.has(anim) &&
      !state.sinArte.has(anim) &&
      BASE_ANIM_SET.has(anim)
    ) {
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

  /** Avanza la máquina de animación de una entidad. La máquina vive en
   *  `maquina-de-animacion.ts` y aquí solo se le presta la duración de cada
   *  anim, que es lo único suyo que está en la caché de hojas (#492/H-1). */
  updateAnim(state: CharacterAnimState, inputs: AnimInputs, now: number = performance.now()): void {
    avanzarAnimacion(state, inputs, now, (anim) => this.durationMs(anim));
  }
}
