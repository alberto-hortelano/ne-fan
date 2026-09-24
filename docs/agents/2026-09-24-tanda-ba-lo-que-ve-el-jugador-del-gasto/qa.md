# QA — tanda BA (#755 #756 #748 + registro legible)

Worktree `/home/al/code/ne-fan-tanda-ba`, diff sin commitear sobre `f25da654`. Cero créditos: todo contra el motor falso (`e2e-sin-creditos`, `entorno=desarrollo` donde el guion lo declara). No se tocó código de producción; los dos sabotajes de los negativos se restauraron byte a byte (`cmp` contra copia previa).

Corridas propias: `node qa/run.mjs 194 195 174 179 78 177 178 104` → **8 en verde · 0 en rojo**, capturas en `qa/capturas/2026-09-24T18-53-55-103Z-1039884/`. Unitarios: `ui-theme` + `gates-de-imagen` 63/63, `nefan-html` 58/58.

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| 1 · #755: la línea cuenta PERSONAJES (skins por prompt, jugador incluido), sin «anim»; un personaje ya contado no vuelve a salir con su lazy; se olvida al entrar/reanudar | ✅ | 194 (1): `skins=[cazadora…, tabernero…, bandido…]` · líneas `["Skins: 1 personaje sin arte pagado (base y_bot)","Skins: 2 personajes sin arte pagado (base y_bot)"]` (suma 3 = 3 prompts). 194 (3): tras atacar, `nuevas = []`. Reanudar (179-4, captura 03): «Skins: 1 personaje restaurado de la librería ($0), 2 personajes sin arte pagado (base y_bot)» — vuelve a contar a todos. Negativo (ingeniero, salida pegada en implementacion.md): contar por anim → rojo 194 (1) «9 contados · 3 skins» |
| 2 · #756 (b): `force` paga idle/walk/run y nada más; su lazy pide `resolve_only` en `restaurar` | ✅ | 194 (2): `Δ pagos = 3`; 194 (3): `POST tras atacar: [{"anim":"quick","resolveOnly":true}]`, `Δ pagos = 0`. Regla en core (`skinPideSoloLoPagado`, tabla 12 filas). **Negativo mío**, distinto del del ingeniero: `return true` en la regla → 194 (2) rojo «no ocurrió en 60000 ms» y «Δ pagos = 0» (el forzado ya no paga ni su set). El del ingeniero (`delSetAutomatico:true`) pone rojo el (3) |
| 2 · …y con `generar` (producción) nada cambia | ⚠️ solo unitario | `en-desarrollo-lo-automatico-no-paga.test.ts` «…y en producción la lazy genera». Ningún guion lo recorre en navegador (el 180 no toca skins) |
| 3 · #748: hueco detalle→botón = título→detalle (±1 px) | ✅ | 195: los cinco packs «título→detalle 14 px · detalle→botón 14 px» (log). **Negativo mío**: quitar `.elapsed:empty{display:none}` → rojo en los cinco, «28 px» contra 14. El del ingeniero (margen de vuelta) da 20 |
| 3 · el muro va sobre `surface`, el botón es `accent`/`accent_ink`, y el test de tema mide la pila real en los cinco packs | ✅ | 195: 5×(panel = surface, botón = accent/accent_ink, título = danger) + HOVER en los cinco. `ui-theme.test.ts`: `describe("el muro se lee (#748)")` con `VELO_DEL_MURO` importado, no copiado. **Negativo mío**: `danger` de `sombra_de_cuento` de vuelta a `#8f3b3b` → rojo «peligro 2.33:1» y «título de fallo (danger) 2.56:1» |
| 3 · captura del muro en `anime` y `acuarela_luminosa` | ✅ | `195-…-04-195-muro-anime.png`, `…-03-195-muro-acuarela_luminosa.png` (y los otros tres packs, más `07-195-hover-anime`) |
| 4 · #755 y #756 en el mismo cambio; sin tocar `fps-atlas.ts` ni `dev-menu.ts` | ✅ | `git status`: ninguno de los dos aparece. 194 pulsa el botón del menú dev sin tocarlo |
| 5 · registro: cada línea `ink` sobre `surface`; captura sobre el suelo en `acuarela_luminosa` | ✅ | 195 REGISTRO en los cinco packs (estilo calculado). Captura `195-…-01-195-registro-acuarela_luminosa.png`: pastillas crema sobre suelo gris claro y sobre césped, legibles. 104 (tope de líneas, #506) sigue verde con las pastillas |
| Lint del banco con la config de `origin/main` (reglas de AY, #745) | ❌ | `eslint -c <config de origin/main> qa/guiones/194-* 195-*` → **2 errores `no-useless-assignment`**: `194:64 let body = null` y `195:169 let fin = null`. Con la config del worktree salen limpios: es el delta de `c8c58f02`. Al fusionar, `npm run lint` (→ `lint:qa`) de nefan-core se pone rojo. El 196 pasa con las dos configs |

## Hallazgos

### Bloqueante

1. **Los guiones 194 y 195 no pasan el lint de `origin/main`.** Reproducir: `git show origin/main:nefan-core/eslint.qa.config.js > /tmp/c.js && nefan-core/node_modules/.bin/eslint -c /tmp/c.js qa/guiones/194-*.mjs qa/guiones/195-*.mjs` → `194:64 The value assigned to 'body' is not used…` y `195:169 … 'fin' …`. Lo que el lint de AY quiere es exactamente lo que dice su comentario: «el valor inicial que un `try` sobrescribe antes de leerlo se escribe `let x;`». Bloquea porque la PR, rebasada sobre main, saldría roja en CI (`lint` está en `verify`). Corrección de dos líneas; no la hago.

### Importante

2. **El registro se mete debajo de «Quick» en los packs sans, y la pastilla lo hace visible.** Medido con el guion nuevo **196** (nació rojo): a 1280×800, en `anime` la línea «Gráficos: maqueta 3D…» llega a 447 px y el botón empieza en 384 (solape 63×17 px); en `acero_neon` 447 contra 392 (55×17). En los tres serif el registro se queda en 390 y no se cruza. Capturas `qa/capturas/2026-09-24T18-58-57-296Z-1072494/196-…-anime.png` y `…-acero_neon.png`: el rótulo «Quick» (acento) queda pintado sobre la pastilla crema/oscura y el texto de la línea asoma por debajo del botón. **Anterior a la tanda** en origen (el texto ya pasaba por detrás; `#ui-bottom-left` 34vw contra una barra centrada que empieza hacia el 30vw) y **agravado por ella** (antes era texto con sombra sobre el mundo; ahora una caja opaca que el `raised` translúcido del botón deja ver). No bloquea: el botón sigue encima y clicable. Lo repara quien decida el ancho de la región o el fondo de la barra; el 196 se pone verde solo.

3. **«Reintentar» y «Cerrar» de la oferta (#478, guion 78) son dos primarios iguales.** Captura `78-…-02-478-la-oferta-de-entrar.png`: dos botones ámbar rellenos, apilados, mismo peso; el que cierra sin hacer nada pesa lo mismo que el que entra. **Es lo que pide el criterio 3 al pie de la letra** («los botones del muro son la acción principal RELLENA»), así que no es una desviación del ingeniero. **Anterior en origen** (antes eran dos filetes iguales, tampoco había jerarquía) y **más notorio ahora** (dos rellenos gritan más que dos filetes). No bloquea. Si se quiere jerarquía, es una regla para `.dismiss` cuando `.volver` está visible, y es decisión de dirección de arte, no de esta tanda.

### Menor

4. **El filete del panel en `acuarela_luminosa` apenas recorta el panel.** Medido con la fórmula del test: `panel/velo` 1,27 y `border/panel` 1,65 (en los oscuros 1,07-1,12 y 1,9-2,0; `anime` 10,9 y 12,9). Captura `195-…-03-…-acuarela_luminosa.png`: el panel crema flota sobre un velo casi del mismo tono; lo delimita la sombra `--nf-shadow`, no el filete. El texto pasa (danger 4,40, ink_dim 3,50, botón 5,33/5,69). **No es regresión**: antes no había panel que recortar; el mismo filete tenue lo tienen todos los paneles del juego (`border/surface` < 3 en cuatro packs, ya anotado por el arquitecto en §6 del plan como issue a abrir). No bloquea.

5. **El balance de la partida nueva sale en dos líneas** (194-1: «1 personaje sin arte» y luego «2 personajes sin arte»): el jugador se viste en una tanda y los NPC del tile en otra. El jugador tiene que sumar. Cumple el criterio (cuenta personajes, no anims) y es correcto; solo se anota.

6. `mutation-targets.json` sigue diciendo «32 mutantes» de `gates-de-imagen` en su `porque`; hoy son 95. El ingeniero lo declara. Y `origin/main` (`c8c58f02`) mueve `mutation-targets.json` y `mutacion-huella.json`: el rebase los va a tocar.

## Pasada adversarial (lo que probé a falsificar)

- **Partido de `gatesDeImagen` (desviación 5).** Los dos supervivientes eran equivalentes de verdad: `characterMode: "" ` con `renderMode: "image"` da el mismo `modoEfectivoDePersonajes`, y `toggleLocalPersonajes` solo se lee sin modo elegido. `loQuePagaImagenIA` pregunta ahora a las mismas dos funciones por faceta que `gatesDeImagen`, así que H2 (rótulo = POST) se mantiene por construcción; sus dos tests siguen pasando sin tocarlos. No encontré entrada en la que las dos rutas discrepen.
- **Forzado en vector paga su set (desviación 4).** `skinPideSoloLoPagado("base", a mano, set automático) → false`: en modo vector el «Generar» del menú dev sigue pagando idle/walk/run, como antes; `modelFor` sale antes en `base`, así que sus lazy no se piden nunca (un forzado en vector ataca en y_bot: ya era así). Coherente con #757: el clic es el gesto deliberado. Solo unitario (tabla); no lo recorrí en navegador.
- **`VELO_DEL_MURO` sin valor por defecto en CSS (desviación 2).** `applyUiTheme(BASE_UI_THEME)` corre en `main.ts:277`, antes de cualquier muro salvo `muroDeArranque` (`config-de-combate.ts`, que se evalúa antes por ser import). En ese caso `--nf-velo-del-muro` no existe, el `color-mix` es inválido y el velo es transparente; detrás no ha corrido `main.ts`, así que no hay mundo ni título que velar, y el panel lee `--nf-surface` del `:root` de la hoja. Razonado sobre el código, **no visto en pantalla** (necesita `combat_config.json` roto; ningún guion lo recorre, lo dice el 174).
- **Padding vertical cero en las pastillas (desviación 1).** 104 verde: 8 líneas, `maxAlto 132 = contenido 132`, corte entre líneas. Correcto.
- **Cuándo se olvida «ya contado».** `empezarPartida` solo lo llama `vestir` (entrar/reanudar). El rearme del menú dev (`modos-de-graficos.ts`) y el de `force` no olvidan: apagar y encender skins en la misma partida no repite la línea. Cargar una fixture del selector «Room» dos veces en la misma pestaña tampoco la repite (no hay `vestir`). Es lo que decidió el arquitecto; anotado, no probado.
- **El 195 aplica los packs por `__nefan.ui.setTheme`**, no abriendo cinco partidas. Es la misma `applyUiTheme` que el bridge dispara por `theme:` (`main.ts:175`, `nefan-hook.ts:191`): no es estado sintético, es el mismo camino con otro disparador.

## Crítica visual (capturas propias, `2026-09-24T18-53-55-103Z-1039884/`)

- **Muro de fallo, cinco packs.** Todos se leen; en `anime` «Cerrar» pasa de invisible (1,03:1) a botón teja sobre papel crema; en los oscuros el botón relleno (cian, ámbar, salvia) es lo que más pesa y es la acción. El título en `danger` retocado en `medievo_crudo`/`sombra_de_cuento` sigue leyéndose como «fallo» (rojo apagado, no rosa). El velo de `medievo_crudo` (`fade` casi negro al 82 %) apaga el mundo casi del todo: era así antes.
- **Hover en `anime`** (`07-195-hover-anime`): halo oscuro de `ink`, texto intacto. Bien.
- **Espera** (`174-…-01-espera-con-anillo`): panel ajustado con anillo, «Viajando...», detalle y «0s». Mejor que antes: el título en acento sobre el velo claro de `acuarela` no se leía (1,9:1).
- **Oferta** (`78-…-02`): ver hallazgo 3.
- **Aviso sin bridge** (`78-…-01`): «Sin conexión con la partida» sobre panel, un solo botón. Bien.
- **Registro sobre el suelo** (`195-…-01`, `194-…-02`, `179-…-03`): pastillas crema con tinta negra sobre gris claro, césped y ajedrezado; el ragged derecho de anchos distintos lee como subtítulos, no como panel. Se tocan verticalmente a propósito; no molesta. Sobre la barra de ataques: hallazgo 2.

## Workarounds usados

- Ninguno sobre la feature. Los dos sabotajes (CSS y regla de core) fueron para los negativos, restaurados con `cp` + `cmp`. Mi `git checkout` de `sombra_de_cuento/style.json` tras el negativo del test de tema devolvió el fichero a HEAD (el valor VIEJO); lo volví a poner en `#b05050` y el `git diff` vuelve a ser la línea del ingeniero.
- Para el banco hacen falta las hojas de personaje en `nefan-html/public/sprites` y `nefan-core/dist` (el 195/196 leen `listStyles` de ahí); el ingeniero ya las había dejado en el worktree.

## No probado

- Producción (`generar`) en navegador: solo unitario.
- El «a medias» en flujo real (pide librería con arte parcial): solo unitario del cliente.
- Muro de arranque sin tema (velo ausente): razonado, no visto.
- `:focus-visible` del botón relleno: anillo por defecto del navegador, no medido.
- Gasto real de créditos: ninguno, por diseño.

## Guiones

- `qa/guiones/194-…` y `195-…` (del ingeniero): corridos en verde y en negativo con sabotajes distintos de los suyos (arriba). Fallan el lint de `origin/main` (hallazgo 1).
- `qa/guiones/196-el-registro-no-se-mete-debajo-de-la-barra-de-ataques.mjs` (mío, fila en `qa/README.md`): mide el hallazgo 2 pack a pack; **nace rojo** en `anime` y `acero_neon`, verde en los serif. Pasa el lint con las dos configs.

## Veredicto

**Apto con reservas.** Los cinco criterios se cumplen en el flujo real y sus candados se ponen rojos. La reserva que hay que resolver ANTES de fusionar es el hallazgo 1 (dos `let x = null` que el lint de `origin/main` rechaza: la PR saldría roja en CI). Los hallazgos 2 y 3 son anteriores a la tanda y no la bloquean, pero el 2 queda medido por el 196 para que no se olvide.
