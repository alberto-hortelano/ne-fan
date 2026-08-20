# Interfaz de juego (cliente 2D)

La capa DOM común a las tres vistas: regiones, tema por style pack, toda acción como tecla Y botón, retrato del hablante.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Interfaz de juego (cliente 2D, las tres vistas)

La UI in-game vive en una sola capa DOM sobre el lienzo (`#game-ui` en
`nefan-html/index.html`), común a las tres vistas: el renderer cambia, la
interfaz no. Cada panel se cuelga de una región (`#ui-top-left`,
`#ui-bottom-center`…) que las apila — nada de `bottom: 120px` a ojo.
`#game-ui[data-view]` (oblique|proscenium|fps) y `[data-locked]` (pointer
lock) son los interruptores: lo que cambia por vista lo decide el CSS, no
main.ts.

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
- **Toda acción es tecla Y botón** (`ui/action-bar.ts`): hablar, atacar,
  elegir ataque, confirmar Y/N, viajar, reaparecer y las opciones de
  diálogo. El click entra por el MISMO camino que la tecla — el
  `IntentSink` del `InputProvider` (`queueAttack/queueInteract/…`), sin
  lógica duplicada en main.ts. Con el ratón capturado los botones se
  degradan a recordatorio de teclas (ningún botón HTML recibiría el click).
- **Diálogo con retrato** (`ui/portrait.ts`): el panel muestra al personaje
  con el que se habla. Por orden: el **hero-shot que el pipeline de skins ya
  pagó** (1024², servido por el asset-store en `/cache/sprite_hero/{key}`,
  fuera del manifest y del prune), o el **busto animado del ciclo idle** del
  sprite — la skin si existe, y si no y_bot. Coste extra 0. El hablante se
  casa por NOMBRE contra las entidades en el bridge
  (`src/narrative/speaker-resolve.ts`) y viaja en el efecto `show_dialogue`
  como `speakerId`/`speakerSkinPrompt`: el contrato del modelo NO cambia.
- La UI de **desarrollo** (barra `#dev-status`, menú de imágenes,
  `#error-log`) vive FUERA de `#game-ui` y no se tematiza nunca: el tema de
  un pack subido por un jugador no puede tocar el panel del gasto.
