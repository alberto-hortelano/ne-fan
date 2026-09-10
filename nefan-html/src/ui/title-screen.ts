/** Title screen: saves → selección de mundo → editor de personaje.
 *
 * One overlay that handles the whole pre-game flow:
 *   1. Lists every saved session with metadata (read from the bridge).
 *   2. Lets the player resume a session, delete it, or start a new game.
 *   3. New game shows the WORLD SELECT: one card per game (cover del estilo
 *      servida por el State API del bridge + descripción) with a style
 *      override selector.
 *   4. Then the character editor (Mixamo model picker + skin prompt), and
 *      resolves with {gameId, styleId, appearance}.
 *
 * The screen is purely a UI; the caller (main.ts) decides what to do with the
 * resolved choice (call narrativeClient.startSession or .resumeSession).
 *
 * QUÉ QUEDA AQUÍ tras el troceo de #346: el ENRUTADOR. Esta clase no pinta
 * nada — monta el chasis, escucha al bridge, arma la promesa de `show()`,
 * cablea los colaboradores de cada pantalla y decide a dónde se va cuando una
 * termina (`ir(destino)`). Las siete hojas viven en `ui/titulo/` y no se
 * conocen entre sí (candado `las-hojas-del-titulo-no-se-atan-entre-si`): el
 * camino de vuelta pasa por aquí, que es el único que puede importarlas todas.
 */
import type { NarrativeClient } from "../net/narrative-client.js";
import type { NarrativeStatusDeJuego } from "@nefan-core/src/protocol/messages.js";
import { type AvisoAlJugador, errors } from "./error-log.js";
import { paso } from "./async-ui.js";
import { StyleApplyController } from "./style-apply.js";
import {
  AI_SERVER_HTTP,
  ASSET_STORE_URL,
  type DestinoDelTitulo,
  type TitleAction,
} from "./titulo/atomos.js";
import { type Avisos, crearAvisos } from "./titulo/avisos.js";
import { type Chasis, montarChasis } from "./titulo/chasis.js";
import { pintarCrearMundo } from "./titulo/crear-mundo.js";
import {
  pintarEditorDePersonaje,
  type EleccionDeMundo,
} from "./titulo/editor-de-personaje.js";
import { pintarHome } from "./titulo/home.js";
import { pintarPlanDeEstilo } from "./titulo/plan-de-estilo.js";
import {
  pintarProgresoDeMundo,
  pintarSelectorDeMundo,
} from "./titulo/selector-de-mundo.js";
import { type DepsDeSubirEstilo, pintarSubirEstilo } from "./titulo/subir-estilo.js";

/** Lo que resuelve `show()`. Vive en `titulo/atomos.ts` desde el primer corte
 *  de #346 —es vocabulario del título y lo van a leer varias de sus pantallas,
 *  no solo esta clase— y se re-exporta aquí para que su único consumidor de
 *  fuera (`main.ts:32`) lo siga importando del título, sin tener que saber cómo
 *  está troceado por dentro. */
export type { TitleAction };

export class TitleScreen {
  /** El overlay: `#title-screen`, su columna, la banda de «hay más partidas» y
   *  el botón de cierre. Es lo único del título que no se repinta nunca, y por
   *  eso es suyo todo lo que dura lo que dura la pantalla. */
  private readonly chasis: Chasis;
  /** La caja de `#ts-error`. Se construye UNA vez, en el constructor, y no en
   *  cada pintado del home: los avisos del registro (#306) tienen que
   *  SOBREVIVIR al repintado, que es literalmente el bug que #306 cerró. */
  private readonly avisos: Avisos;
  private resolve: ((action: TitleAction) => void) | null = null;
  /** Notifica show/hide al caller (main.ts oculta el chip de gráficos
   *  mientras el título está abierto). Cubre TODOS los cierres, incluido el
   *  modo fixtures por #ts-close, que no resuelve la promesa de show(). */
  onVisibilityChange: ((visible: boolean) => void) | null = null;
  private styleApply: StyleApplyController;

  /** Corrida de estilo tal y como la recuerda quien la ejecuta (bench/QA). */
  styleRunState(): ReturnType<StyleApplyController["debugState"]> {
    return this.styleApply.debugState();
  }

  /** Última línea de progreso de pre-generación POR JUEGO.
   *
   *  Era UNA ranura, y ahí estaba el único síntoma de jugador de #313: el panel
   *  de generación vive dentro de `#ts-gen`, que es el del juego SELECCIONADO, y
   *  nada impide cambiar de tarjeta mientras se genera (el botón se deshabilita,
   *  los handlers de tarjeta no). Con el mundo de A generándose y la tarjeta de
   *  B delante, el jugador leía «Generando el anillo de tiles (3/8)…» y luego
   *  «Mundo de Miravanda generado» bajo la tarjeta de Valdesombra — reproducido
   *  en dos clicks. Un mapa por `gameId` no es una optimización: es lo que hace
   *  falta para poder NO pintar lo que no es de esta tarjeta, y el `gameId` que
   *  lo indexa es el que trajo el mensaje desde #313. */
  private readonly gameGenStatus = new Map<string, NarrativeStatusDeJuego>();
  /** Mundo seleccionado la última vez que se pintó el selector — el refresh
   *  tras un game_gen ready lo conserva, y es la clave con la que se decide
   *  QUÉ progreso se pinta. */
  private lastSelectedGameId: string | null = null;

  /** El progreso del mundo que el jugador está mirando, ya resuelto: es lo que
   *  la hoja del selector necesita para pintarlo sin conocer ni el mapa ni la
   *  tarjeta seleccionada, que son de esta clase. `null` (nada seleccionado
   *  todavía) y «seleccionado pero sin progreso» se colapsan a propósito: los
   *  dos se pintan igual, que es vaciando la línea. */
  private progresoDelMundoMirado(): NarrativeStatusDeJuego | undefined {
    return this.lastSelectedGameId === null
      ? undefined
      : this.gameGenStatus.get(this.lastSelectedGameId);
  }

  constructor(private narrative: NarrativeClient) {
    this.styleApply = new StyleApplyController(narrative, {
      remote: AI_SERVER_HTTP,
      assets: ASSET_STORE_URL,
    });
    // Progreso de la pre-generación de mundo: el job corre en el bridge y
    // difunde narrative_status kind "game_gen" — el título lo refleja en la
    // tarjeta/panel sin loaders de partida. Suscripción de vida completa
    // (el título vive tanto como la app).
    //
    // El canal ya viene filtrado desde el embudo (#312): aquí había un
    // `if (msg.kind !== "game_gen") return;` que era el segundo sitio del
    // cliente que sabía de kinds. Y no se filtra por SELLO, ni aquí ni allí —
    // desde #313 este mensaje no TIENE sello: se direcciona por `gameId`, que
    // es lo que se usa abajo para no pintar el progreso de un mundo en la
    // tarjeta de otro.
    this.narrative.onProgresoDeMundo((msg) => {
      // Se APUNTA siempre, sea de la tarjeta que sea: el jugador puede volver
      // a ella y tiene que encontrar el estado que dejó.
      this.gameGenStatus.set(msg.gameId, msg);
      const line = this.chasis.content.querySelector<HTMLElement>("#ts-gen-progress");
      if (line) pintarProgresoDeMundo(line, this.progresoDelMundoMirado());
      if (msg.phase === "error") {
        // AL REGISTRO TAMBIÉN, y no solo a la línea roja de la tarjeta. Antes
        // de #312 este fallo caía además en el handler de `main.ts`, que hacía
        // `errors.push`; el reparto en canales se lo llevó por delante y la
        // pre-generación pasó a fallar sin dejar rastro en ningún sitio
        // consultable. El texto rojo de `#ts-gen-progress` desaparece en cuanto
        // se repinta el selector — dos líneas más abajo, precisamente.
        errors.push("narrative", msg.message ?? "la pre-generación del mundo falló");
      }
      if (msg.phase === "ready" || msg.phase === "error") {
        // Refrescar chips/botones si el selector de mundo sigue en pantalla.
        const panel = this.chasis.content.querySelector("#ts-gen");
        if (panel && this.chasis.visible) {
          paso(
            this.pintarElSelector(this.lastSelectedGameId ?? undefined),
            "title",
            "refrescar el selector de mundos tras la generación",
          );
        }
      }
    });
    // EL DOM VA DETRÁS, como en el fichero de antes del corte: la suscripción
    // no puede recibir nada mientras se monta el overlay (ni un `await` en
    // medio), así que el orden de los dos efectos es el mismo que tenía.
    //
    // «Cerrar» sale por `alCerrar` y vuelve por `ocultar()`: el chasis sabe
    // esconder su raíz, pero no que hay alguien mirando desde fuera
    // (`onVisibilityChange`), y esa mitad es de esta clase.
    this.chasis = montarChasis({ alCerrar: () => this.hide() });
    this.avisos = crearAvisos({ content: this.chasis.content });
  }

  /** Abre el título y resuelve con lo que el jugador elija.
   *
   *  `aviso` es el motivo por el que se VUELVE aquí (una sesión que no pudo
   *  arrancar): se pinta arriba, encima del botón, y desaparece al siguiente
   *  repintado del home.
   *
   *  La promesa se arma ANTES de pintar. Antes se armaba después del
   *  `await pintarElHome()` —o sea, después del `await listSessions()`— y
   *  durante esa ventana `this.resolve` seguía en `null`: el «Comenzar» del
   *  final del selector llamaba a `this.resolve?.(…)` y el optional chaining
   *  lo convertía en un no-op mudo. Con el enganche del botón movido al
   *  primer pintado, esa ventana pasaría a ser alcanzable de verdad. */
  async show(opts: { aviso?: string } = {}): Promise<TitleAction> {
    this.chasis.mostrar();
    this.onVisibilityChange?.(true);
    this.chasis.avisarDeCorte();
    const eleccion = new Promise<TitleAction>((res) => {
      this.resolve = res;
    });
    // Si el home no se puede pintar, show() RECHAZA (lo espera el catch de
    // main.ts): la promesa de arriba se queda pendiente y no la lee nadie.
    await this.pintarElHome(opts.aviso);
    return eleccion;
  }

  hide(): void {
    this.chasis.ocultar();
    this.onVisibilityChange?.(false);
  }

  /** ¿El overlay tapa el juego? Lo consulta el bench de QA: el título es el
   *  primer estado del sistema y ninguna comprobación vale mientras cubre la
   *  pantalla (regla del workaround — ocultarlo para fotografiar es trampa). */
  get isVisible(): boolean {
    return this.chasis.visible;
  }

  /** Un aviso del registro de errores (#306) llega al título. Lo llama el ÚNICO
   *  suscriptor de `errors.onAviso` (main.ts) y esta clase solo lo pasa: quién
   *  se pinta y cómo lo decide `ui/titulo/avisos.ts`. */
  avisar(aviso: AvisoAlJugador): void {
    this.avisos.avisar(aviso);
  }

  /** El fallo de `source` se ha resuelto: sus avisos se van de la pantalla. */
  retirarAvisos(source: string): void {
    this.avisos.retirar(source);
  }

  /** Los colaboradores de la pantalla de subida de estilo, en un solo sitio:
   *  la llaman el botón del selector y el enrutador, y dos listas de campos
   *  que hay que mantener iguales acaban siendo dos listas distintas. */
  private subirEstilo(): DepsDeSubirEstilo {
    return { content: this.chasis.content, ir: (d) => this.ir(d) };
  }

  /** A DÓNDE va el título cuando una de sus pantallas termina.
   *
   *  Es el único camino de vuelta que tienen las hojas de `ui/titulo/`: no
   *  pueden importarse entre sí (candado
   *  `las-hojas-del-titulo-no-se-atan-entre-si`), así que enruta quien puede
   *  importarlas todas. Los cinco destinos son las cinco pantallas navegables
   *  de #346, y el tipo los declara en `atomos.ts`.
   *
   *  DEVUELVE la promesa del repintado en vez de tragársela con un `paso()`
   *  de dentro: «Crear mundo» encadena el selector DENTRO de su `try`, y
   *  hacerla fire-and-forget movería de sitio ese fallo. Lo midió QA-3 sobre el
   *  juego real (guion 96): con la promesa tragada, un fallo del repintado deja
   *  la pantalla en «Mundo creado» con los dos botones apagados y sin salida.
   *  Quien no la espera la pasa por `paso()`, que es lo que ya hacía cada
   *  pantalla del título.
   *
   *  Tres de las cuatro vueltas al selector se `await`ean dentro de un `try`
   *  cuyo `catch` le pinta el motivo al jugador donde está
   *  (`#ts-style-progress`, `#ts-style-status`): tragarse el rechazo con un
   *  `paso()` propio mandaría esos fallos al registro —que el título tapa por
   *  CSS (#246/#306)— y dejaría la pantalla muda, que es el no-op de #181.
   *
   *  Y es `async` por los dos destinos SÍNCRONOS: sin él, un fallo al pintar
   *  «Crear mundo» o «Subir estilo» saldría por un `throw` de aquí —antes de
   *  que haya promesa— y `paso(this.ir(…), …)` no podría encauzarlo, que es
   *  justo lo que el llamante cree estar contratando (QA-3 H6). Hoy no tiene
   *  ocupante; la palabra cuesta lo que cuesta y la deuda es de las caras. */
  private async ir(destino: DestinoDelTitulo): Promise<void> {
    switch (destino.a) {
      case "home":
        return this.pintarElHome(destino.aviso, destino.tono);
      case "selector":
        return this.pintarElSelector(destino.preselect);
      case "crear-mundo":
        return this.crearMundo();
      case "subir-estilo":
        pintarSubirEstilo(this.subirEstilo());
        return;
      case "editor":
        return this.editorDePersonaje(destino);
    }
    // EL `never` ES EL CANDADO, y hay que ponerlo porque el `async` se llevó el
    // que había (TS2366): caerse por el final de una función `async` devuelve
    // `Promise<undefined>`, que es un `Promise<void>` válido, así que un destino
    // nuevo sin `case` compilaría y no haría nada. Aquí no compila. Va DESPUÉS
    // del switch y no en un `default`, que mataría el estrechamiento.
    const nunca: never = destino;
    throw new Error(`destino del título no contemplado: ${JSON.stringify(nunca)}`);
  }

  /** Cablea el SELECTOR DE MUNDOS y lo pinta. Seis colaboradores, como el home,
   *  y por el mismo motivo: es el otro concentrador del título.
   *
   *  Los dos que solo tiene esta pantalla son las dos mitades del progreso de
   *  pre-generación (#313), que esta clase posee porque el suscriptor del bridge
   *  vive aquí y sobrevive a cualquier repintado: `recordarMundo` apunta qué
   *  tarjeta se está mirando y `progresoDe` contesta por el mapa. La hoja no ve
   *  ninguno de los dos campos, y eso es lo que la deja sin `this`.
   *
   *  `mostrarPlanDeEstilo` no es un destino de `ir` porque el panel de coste no
   *  sustituye la pantalla: se monta DENTRO del hueco que el selector le abre.
   *  Se cablea aquí porque necesita el `StyleApplyController` —uno solo, el de
   *  esta clase, que es el que consulta el bench— y porque una hoja no puede
   *  importar a otra.
   *
   *  Y es `async` por lo mismo que `ir` y que `pintarElHome`, que es la familia
   *  que ha mordido tres veces en este programa (QA-2 H2, QA-3 H6, QA-4 H2): el
   *  oyente del bridge llama a este método dentro de un `paso(...)`, así que un
   *  `throw` SÍNCRONO de este cableado saldría antes de que exista promesa y
   *  `paso()` no podría encauzarlo. Hoy no tiene ocupante. */
  private async pintarElSelector(preselect?: string): Promise<void> {
    return pintarSelectorDeMundo(
      {
        content: this.chasis.content,
        narrative: this.narrative,
        recordarMundo: (gameId) => {
          this.lastSelectedGameId = gameId;
        },
        progresoDe: (gameId) => this.gameGenStatus.get(gameId),
        ir: (destino) => this.ir(destino),
        mostrarPlanDeEstilo: (hueco, gameId, styleId) =>
          pintarPlanDeEstilo(
            { hueco, styleApply: this.styleApply, ir: (d) => this.ir(d) },
            gameId,
            styleId,
          ),
      },
      preselect,
    );
  }

  /** Cablea el HOME y lo pinta. Es el `Deps` más grande de las siete hojas —
   *  seis colaboradores— porque es la pantalla que más cosas del título toca:
   *  lista partidas por el bridge, resuelve la promesa de `show()` con un
   *  `resume`, va al selector, escribe en la caja de avisos y mueve la banda de
   *  «hay más partidas».
   *
   *  `avisos` era una fachada inline con los tres nombres que `crearAvisos`
   *  exporta, y desde la PR 6 es la fábrica misma: encaja por FORMA (TypeScript
   *  es estructural) sin que `avisos.ts` tenga que importar al home, que es lo
   *  que el candado prohíbe. Lo que la PR 4 predijo y NO ha pasado es que la
   *  llamada a `crearAvisos` viniera a parar aquí dentro: la caja tiene que
   *  sobrevivir al repintado (#306), así que se construye una sola vez en el
   *  constructor y aquí solo se pasa el campo.
   *
   *  Con eso, el `async` de este método SIGUE SIN OCUPANTE — el cuerpo es una
   *  llamada a la hoja y una lectura de campos, y ninguna de las dos lanza
   *  síncronamente. La palabra se queda igual, y no por inercia: el «Volver»
   *  del selector llama a esto dentro de un `paso(...)`, así que el día que el
   *  cableado gane una línea que pueda lanzar, el `throw` síncrono saldría
   *  antes de que exista promesa y `paso()` no podría encauzarlo — el jugador
   *  se quedaría sin motivo en pantalla y sin entrada en el registro.
   *  `renderHome` era `async` y esta palabra conserva esa garantía; es la
   *  familia que ha mordido tres veces en este programa (QA-2 H2, QA-3 H6,
   *  QA-4 H2). */
  private async pintarElHome(aviso?: string, tono?: "error" | "aviso"): Promise<void> {
    return pintarHome(
      {
        content: this.chasis.content,
        narrative: this.narrative,
        elegir: (accion) => this.resolve?.(accion),
        ir: (destino) => this.ir(destino),
        avisos: this.avisos,
        avisarDeCorte: () => this.chasis.avisarDeCorte(),
      },
      aviso,
      tono,
    );
  }

  /** Cablea «Crear mundo» y la pinta. Los colaboradores se construyen aquí, en
   *  el enrutador, porque son lo único que una hoja no puede saber de esta
   *  clase. */
  private crearMundo(): void {
    pintarCrearMundo({
      content: this.chasis.content,
      narrative: this.narrative,
      ir: (destino) => this.ir(destino),
    });
  }

  /** Cablea «Crear personaje» y la pinta. `elegir` es `this.resolve` visto
   *  desde la hoja, con su `?.` donde estaba: la promesa la arma y la resuelve
   *  esta clase (ver `show()`), no la pantalla. */
  private editorDePersonaje(eleccion: EleccionDeMundo): Promise<void> {
    return pintarEditorDePersonaje(
      {
        content: this.chasis.content,
        elegir: (accion) => this.resolve?.(accion),
        ir: (destino) => this.ir(destino),
      },
      eleccion,
    );
  }
}
