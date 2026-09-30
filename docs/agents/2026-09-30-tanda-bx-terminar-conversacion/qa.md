# QA — Tanda BX: terminar una conversación y el encargo en `--preset play`

Rama `tanda-bx-terminar-conversacion` @ `a6c1a734`. Todo en el bloque de puertos que eligió `qa/run.mjs` (+100). Los puertos por defecto no se tocaron, y `./start.sh` sin `--seco` no se arrancó.

## Peticiones literales

1. «La conversacion deberia tener un boton para finalizarla»
2. «No pone nada para pegar» (al arrancar con `./start.sh --preset play`)

## Criterios

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Hay un botón visible con opciones en pantalla | ✅ | La captura `351-…-01-b-con-opciones-y-terminar.png` muestra «[Esc] terminar» arriba a la derecha del panel. Guion 351 B: «un click en su centro le llega» |
| 2 | Visible durante el typewriter | ✅ | 351 A: `{"alcanzable":true,"texto":"Escterminar"}` con el espía `typewriter:true` |
| 3 | Visible con el texto libre abierto | ✅ | 351 C: alcanzable. 354 T: la captura `t-texto-a-medio-escribir` y el click cierra |
| 4 | Visible en una línea sin opciones | ⚠️ no probado en vivo | El motor falso siempre manda opciones. Es el mismo nodo, fuera de `#dialogue-choices`, y el typewriter (la barra vacía) es el estado visualmente equivalente, que sí está medido |
| 5 | Esc termina (y con el texto libre abierto retrocede un nivel) | ✅ | 351 A (Esc durante el typewriter) y 351 C (Esc, Esc). 354 T2: un doble Esc a ritmo humano (120 ms) cierra la caja y termina |
| 6 | Tras terminar, el ratón vuelve y se puede mover y atacar | ✅ (headless) | 351 A: W mueve; LMB abre un episodio del telegraph. 351 G: el botón devuelve el lock. 354 V: lo mismo tras viajar |
| 7 | Terminar NO dispara una petición al motor | ✅ | 351 B y C: `dialogueTurn` no sube. 354 T: el texto a medias no viaja |
| 8 | El motor lo ve después (opción B) | ✅ | 351 C: el `recent_dialogues` del saludo siguiente trae `chosen:"(el jugador da por terminada la conversación y se aparta)"` |
| 9 | La réplica tardía tras terminar va al registro | ✅ | 351 E: `{"panel":false}` y la línea «💬 … (vuelve a hablarle con E)» en el registro |
| 10 | El caso normal («elijo y espero») no cambia | ✅ | 351 F (control), 342, 343, 344 y 83 en verde. El 342 salió rojo 1 de 3 veces por la marcha hasta el tabernero, «no ocurrió en 4 s de sim», antes de tocar nada de BX; las otras 2 corridas, verde |
| 11 | `--preset play` imprime el encargo, legible, sin pausa, y dice cómo se engancha | ✅ | `./start.sh --preset play --seco` → exit 0. Imprime «abre OTRA terminal… lanza claude y pega:», el encargo en un párrafo y «se engancha solo al primer narrative_listen: le quita :3737 al placeholder». Foto de `ss` antes y después: sin puertos nuevos |
| 12 | Otros presets con motor sí lo imprimen; los que no tienen motor, no | ✅ | Con motor: `playtest-motor` («toma :3737 y ai_server se conecta solo (reintenta cada 5 s)», verificado en `llm_client.py:235,249`) y `story-web-sin-imagenes`. Sin él: `cliente-web`, `html-fixtures`, `e2e-sin-creditos` y `replay-web` |
| 13 | El encargo tiene una sola fuente, y un candado lo sujeta | ✅ | `data/contract/encargo-del-motor.txt`. `start-imprime-el-encargo.test.ts` y el test de BW: 60/60 en verde |
| 14 | `--seco` sin `--preset` falla | ✅ | exit 2 con el uso. `--seco --preset play`, en orden inverso, funciona |

## Pasada adversarial (guion nuevo `qa/guiones/354-terminar-la-conversacion-en-los-bordes.mjs`)

- **Doble clic en «terminar» con el ratón capturado**
  - El panel se cierra y el segundo click NO ataca: episodio `0 → 0`, y el lock vuelve.
  - El motor ve exactamente un fin por conversación: 4 fines para 4 terminadas (M, T, T2, D).
- **Morir con el panel abierto**
  - El panel sigue sobre el velo «Has caído» y el botón es alcanzable (captura `m-caido-con-el-panel`).
  - «terminar» lo cierra sin errores, el jugador despierta y el panel no vuelve.
- **Texto a medio escribir**
  - El click en «terminar» cierra y no manda nada.
  - Con Esc, lo escrito se BORRA sin preguntar: tras Esc y T, la caja vuelve vacía. Ver H2.
- **Terminar con el viaje en marcha**
  - El panel sigue abierto bajo el velo «Viajando…».
  - Esc lo cierra ANTES de llegar (`{"panel":false,"tile":"tile_0_0","llegado":null}`).
  - Al llegar no vuelve, W mueve y LMB ataca.
  - El BOTÓN no recibe el click: `tapa: DIV#narrative-loader.visible`. Ver H1.
- **En negativo**: con la llamada a `sendDialogueEnd` quitada a mano en `conversacion.ts`, 354 se pone rojo en D2 (`fines = 0`). Revertido con `git checkout`.
- Los candados del banco sobre el guion nuevo (`un-salto-del-guion-se-observa`, `la-consulta-de-movimiento-tiene-dueno`): 72/72.

## Hallazgos

**Bloqueantes:** ninguno.

**Importantes:** ninguno.

**Menores:**

- **H1 · Durante un viaje, el botón se ve pero no se puede pulsar.**
  - Reproducción:
    1. `node qa/run.mjs 354`, o a mano: partida nueva y hablar con el tabernero.
    2. Con el panel abierto, pulsar la salida «Molino del bench».
    3. Intentar pulsar «terminar» mientras sale «Viajando…».
  - El velo `#narrative-loader` tapa el panel entero (captura `v-viaje-en-marcha-con-el-panel`): el panel se ve lavado detrás y no recibe clicks. Esc sí funciona.
  - Esperado: el requisito pide el botón «en cualquier estado del panel». Viajar con la conversación abierta es un estado previo a BX (el panel ya se quedaba abierto bajo el velo), pero el botón nuevo hereda el problema.
  - Opciones para el coordinador: cerrar el panel al pedir el viaje, o aceptarlo.
- **H2 · Esc tira el texto a medio escribir sin aviso.** Es el comportamiento anterior (`_closeFreeText` vacía la caja) y el plan lo decidió así. Pero ahora Esc, Esc (retroceder y terminar) es un gesto de un segundo, y quien escribió una frase larga la pierde entera. Aceptable. Si molesta, basta con conservar el valor al cerrar la caja.
- **H3 · Detalle visual.** El botón se apoya sobre la regla bajo el nombre del hablante, y la línea le toca el borde inferior (recorte ampliado de la captura 351-01). Por lo demás integra bien: usa `nf-action` con `kbd`, como las opciones y la barra de ataques, en la misma paleta y tipografía. «terminar» se entiende, aunque convive con la opción «Despedirse» del motor, que sí cuesta una petición. El jugador no tiene forma de saber que una es gratis y la otra no. No es un error, pero conviene saberlo.
- **H4 · Encargo.** Es útil y correcto para un Claude Code recién abierto en el checkout principal, donde `.mcp.json` declara `narrative`. Dos detalles:
  - `.mcp.json` está en `.gitignore`: en un worktree o un clon nuevo, «abre otra terminal en este directorio» lleva a un Claude sin la tool `narrative_listen`, y el encargo no lo dice;
  - la pausa de la TUI sigue en inglés y las líneas nuevas están en español.
- **H5 · Contexto del motor.** Cada fin ocupa una de las 10 entradas de `recent_dialogues`. Un jugador que abre y corta a menudo desplaza conversaciones reales fuera de la ventana. Solo es una observación.
- **Del banco, no de BX:** el 342 sale rojo de forma intermitente al acercarse andando al tabernero (1 de 3 corridas). El aviso «Tu partida vuelve incompleta» que documenta el ingeniero no salió en mis corridas.

## Workarounds usados

- **354 M: `setPlayerPos` junto al bandido con el panel abierto**, para producir el estado «caído con la conversación abierta». No afecta al jugador: el estado le llega igual si el bandido le alcanza mientras habla (el 351 lo cita como premisa: «el bandido pega mientras se habla»).
- **`plantarse` (`setPlayerPos` + `setYaw`) en los bloques con teclado**, heredado del 351. Solo coloca al jugador. La interacción va por E y los clicks reales.
- **Cerrar «Tu partida vuelve incompleta» con su botón al reanudar**, si aparece. En mis corridas no apareció. Si aparece, es un hallazgo del spawn fuera del tile, fuera de BX.
- **Cómo se produce el viaje lento**: `conductaDeTiles` del motor falso (`delay_ms` 15 s) y `/dev/soltar-replica`. Es conducta del motor, no del cliente.
- **El `--seco` en lugar del arranque real** de `--preset play`. El camino es el mismo `run_selection` con `arrancar()` como envoltorio. El diff confirma que `SECO` solo bifurca en `arrancar`, en el preflight y antes de `follow_logs`. Lo que no cubre: la salida real intercalada con los arranques de verdad.

## No probado

- **Esc en Chrome con ventana** (no headless): si devuelve el ratón sin gesto. No abrí `--headed` porque el usuario está jugando en ese escritorio. En headless lo devuelve siempre. El guion afirma «vuelve solo, o el registro lo dice».
- **Una línea sin opciones en vivo**: el motor falso no la produce (criterio 4).
- **La pausa interactiva de la TUI** (`pause_for_claude_code` con `read`): requiere TTY. Revisado solo en el diff.
- **`./start.sh --preset play` real**: prohibido en esta tanda. Visto solo en seco.
- **El motor real (Claude) leyendo la acotación y actuando en consecuencia**: solo se comprueba que llega en su contexto.

## Veredicto

**Apto con reservas.**

- Las dos peticiones se cumplen en el flujo real: el botón y Esc funcionan en los estados medidos, terminar no gasta y el motor lo ve después, y `--preset play` imprime qué pegar.
- Reservas:
  - H1: el botón no se puede pulsar bajo el velo del viaje (Esc sí funciona);
  - Esc en Chrome con ventana no se ha medido;
  - H2, H3, H4 y H5 son menores.
