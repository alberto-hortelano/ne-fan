# Interfaz de juego (cliente web)

La capa DOM sobre el lienzo del mundo: regiones, tema por style pack, toda acción como tecla Y botón, retrato del hablante.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Interfaz de juego

La UI in-game vive en una sola capa DOM sobre el lienzo (`#game-ui` en
`nefan-html/index.html`), separada del mundo. El lienzo es WebGL y no pinta
texto — los nombres de NPC son DOM temado (`ui/world-labels.ts`). Cada panel se
cuelga de una región (`#ui-top-left`, `#ui-bottom-center`…) que las apila —
nada de `bottom: 120px` a ojo. El único interruptor que queda en `#game-ui` es
`[data-locked]` (pointer lock): lo decide el CSS, no main.ts. Hubo también un
`[data-view]`, que murió con las otras dos vistas.

- **Estética diegética sobria**: panel translúcido, filete de 1 px, sin
  marco ornamental, una tipografía y un acento. Todo el color sale de
  custom properties (`--nf-*`) declaradas en `#game-ui`; `game-ui.css` no
  contiene ni un literal de color.
- **Tema por estilo**: cada style pack declara `ui` en su `style.json`
  (schema puro en `src/games/ui-theme.ts`, tema base `BASE_UI_THEME`). El
  bridge lo RECALCULA del pack en `start_session` y en `resume_session` y lo
  manda en `session_started.uiTheme` — **no se persiste en el save ni entra
  en `world`** (`serializeForLlm` manda `world` entero al modelo cada turno).
  Retocar una paleta y reanudar basta para verla. Sin estilo (fixtures,
  offline) rige el tema base. `test/ui-theme.test.ts` mide el contraste WCAG
  de los cinco temas shipped: un tema ilegible rompe el test.
- **Las capas están decididas, no heredadas del orden del DOM** (#483):
  `#app-shell > canvas` (el mundo) va en `z-index: 0` y `#game-ui` en `1`,
  porque `FpsRenderer` inserta su lienzo DESPUÉS de la capa de UI y con los dos
  en `auto` ganaba el mundo. Lo de DEV vive fuera de `#app-shell` y por encima
  (`#error-log` 8900, `#dev-status` 10000). Dentro de `#game-ui` mandan las
  bandas `--z-*`, y la mirilla lleva la suya (`--z-hud`) en vez de depender de
  quién sea su hermano. Lo canda el guion 103 con `elementFromPoint`: los
  guiones que leen `data-target` daban verde con el punto tapado.
- **La vida se lee `vida / máximo`** (#527): la barra pinta el PORCENTAJE y el
  número de al lado la vida ABSOLUTA, así que con un máximo distinto de 100 —el
  día que un plugin lo dé— «100» con la barra a dos tercios no dice nada. El
  número vivo es `#player-hp-text` y el denominador `#player-hp-max`, apagado:
  dos nodos para que el primero siga siendo UN número. Guion 89.
- **El registro de partida cabe entero**: cuántas líneas se conservan y cuánto
  alto tiene la caja son el mismo número (`LINEAS_DEL_REGISTRO` en
  `ui/registro-de-la-partida.ts`, que escribe `--nf-log-lineas`). Estaban en dos
  ficheros y no coincidían: 8 líneas de tope contra 6,67 de caja, y la última
  salía partida por la mitad en cualquier resolución (#506). Guion 104.
- **Toda acción es tecla Y botón** (`ui/action-bar.ts`): hablar, atacar,
  elegir ataque, confirmar Y/N, viajar, reaparecer y las opciones de
  diálogo. El click entra por el MISMO camino que la tecla — el
  `IntentSink` del `InputProvider` (`queueAttack/queueInteract/…`), sin
  lógica duplicada en el cliente; la barra de ataques la pinta
  `ui/hud-de-combate.ts` desde el catálogo del sistema de combate de la
  sesión. Con el ratón capturado los botones se
  degradan a recordatorio de teclas (ningún botón HTML recibiría el click) —
  **menos el activo, que no se atenúa** (#506): lo único que marca el ataque
  elegido es su borde de acento, y atenuarlo con los demás lo dejaba en lo
  menos legible de la barra justo cuando se pelea. Guion 84.
- **Diálogo con retrato** (`ui/portrait.ts`): el panel muestra al personaje
  con el que se habla. Por orden: el **hero-shot que el pipeline de skins ya
  pagó** (1024², servido por el asset-store en `/cache/sprite_hero/{key}`,
  fuera del manifest y del prune), o el **busto animado del ciclo idle** del
  sprite — la skin si existe, y si no y_bot. Coste extra 0. El hablante se
  casa por NOMBRE contra las entidades en el bridge
  (`src/narrative/speaker-resolve.ts`) y viaja en el efecto `show_dialogue`
  como `speakerId`/`speakerSkinPrompt`: el contrato del modelo NO cambia.
- **Quien tapa la pantalla con algo pulsable SUELTA el ratón, y lo devuelve al
  quitarlo.** Son las dos mitades de un acto (#311/#323) y valen para los dos
  que existen: la conversación (`ui/conversacion.ts`, que apunta si lo tenía en
  la TRANSICIÓN cerrado→abierto y no en cada línea — el motor puede mandar dos
  `dialogue` seguidas, #502) y el muro de fallo (`ui/muro-de-carga.ts`, solo
  cuando pinta botones: el muro de espera no tiene ninguno, #503). Se devuelve
  solo si lo soltamos nosotros, y en el muro solo por su botón «Cerrar»: los
  demás caminos que lo quitan (el título, «Volver al título», un aviso
  resuelto) no llevan al jugador de vuelta al mundo. Guion 83.
- **El chip de gráficos enseña lo que se GENERA, no lo que dice el save**
  (#510): con el cortacircuitos de #236 saltado el modo sigue siendo «imagen» y
  no sale un skin, así que el chip lo dice y el panel explica cómo rearmarlo. El
  botón activo del panel sigue siendo el modo real — el rearme ES apagar y
  encender Personajes (guion 51). Y un gesto escribe UNA línea «Gráficos: …»: el
  bridge difunde `render_mode_changed` también al que lo pidió.
- La UI de **desarrollo** (barra `#dev-status`, menú de imágenes,
  `#error-log`) vive FUERA de `#game-ui` y no se tematiza nunca: el tema de
  un pack subido por un jugador no puede tocar el panel del gasto.
- **El título es un INTERRUPTOR** (#246, #285): `titleScreen.onVisibilityChange`
  llama a `marcarTitulo()` (`ui/titulo-manda.ts`), único escritor de
  `data-titulo` en `<html>`. Con él delante se apagan los PÍXELES (la regla de
  `dev-ui.css` que oculta `#game-ui` y `#error-log`) y se descarta el INPUT de
  juego, que entra por una sola puerta (`input/puerta-de-teclado.ts`,
  `alPulsarTecla`/`alPulsarRaton`) y lee `elTituloManda()` — el mismo atributo,
  así que los píxeles y las teclas no pueden discrepar. No es una lista de
  widgets: un panel o un manejador nuevo nacen ya apagados ahí. Lo canda
  `teclas-de-juego-pasan-por-la-puerta` en `arch-rules.json`. `keyup` NO pasa
  por la puerta a propósito (descartar una soltada deja al jugador andando
  solo), y `#dev-status` se queda visible: vigila el gasto. Ese panel está
  ACOTADO por `--dev-status-alto` (`base.css`), y el hueco que el título le
  reserva sale de la misma variable, en el fichero de al lado: un número, un
  sitio y cero JavaScript — por eso «Nueva partida» no se mueve bajo el cursor
  cuando el panel se rellena (#250). El valor sale de una medida (el panel
  entero a 500×480 **mientras avisa de que genera**, que es cuando hay dinero
  en juego), no del reposo, y lo sujeta el guion 33. El candado fuerte del
  input es `no-restricted-syntax` en `nefan-html/eslint.config.js`, que mira la
  llamada; la regla de `arch-rules.json` cubre formas de escritura y lo
  declara.
