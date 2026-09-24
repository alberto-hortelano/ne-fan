**#755 VIGENTE, con el criterio corregido · #756 VIGENTE → salida (b) · #748 REENCUADRADA (el contraste falla en más de un pack, y peor en `anime`)**

Verificado sobre `f25da654` (incluye #757). No hay solape de ficheros con AX si #756 va por (b); ver Conflictos.

## #755 · la línea de balance cuenta animaciones

**Problema real:** el jugador lee «15 sin arte» con 5 personajes delante, y la unidad («anim(s)») es de la tubería, no del juego.

**Premisa:**
- Cuenta animaciones: sí. `cadena-de-skins.ts:36-42` suma uno por cada llamada a `restaurado()` o `sinArte()`, y `character-sprites.ts:359,366` llama una vez por anim. `AUTO_SKIN_ANIMS` son 3 (`:43`), así que 5×3=15 y 3×3=9: cuadra con el issue.
- Texto literal «anim(s) restaurada(s)… sin arte pagado (base y_bot)» en `cadena-de-skins.ts:50`. Ningún guion ni test lo afirma (grep en `qa/`, `nefan-core/test` y `nefan-html` a cero). Cambiarlo no rompe nada, y hoy no lo sujeta nada.
- **El criterio del issue es incorrecto.** Pide comparar con «el número de NPC en escena», pero la unidad del gestor es el **skin**, uno por *prompt* (`skinKey`, `character-sprites.ts:247`). Dos NPC con la misma descripción comparten skin (`:244-246`). Además **el jugador también pide skin** (`aspecto-del-jugador.ts:161`, `modos-de-graficos.ts:258`). La comparación honesta es contra los prompts distintos que se pidieron, jugador incluido, que ya expone `__nefan.skins` (`debugState`, `:310`).
- **Hay una arista que el issue no menciona.** Las anims lazy (`modelFor`, `:429`) abren una tanda de la cadena **después**, y cada una vuelve a pasar por `sinArte()`. Si se cuenta por personaje y tanda, el mismo NPC vuelve a salir «sin arte» cada vez que ataca o muere. Los requisitos tienen que decidir qué pasa con esa segunda línea.
- «Aparte»: el gris sobre verde. `#combat-log` usa `--nf-ink-dim` sin fondo, directamente sobre la escena 3D (`game-ui.css:312-320`). Es un problema real pero distinto: el fondo es la escena, y ningún token lo mide (ver #748). **No debe ir en #755.**

**El día después:** el jugador ve una línea en su unidad. No se cierra ninguna puerta. La traza por anim seguirá existiendo si se deja, como propone el issue, para desarrollo.

## #756 · el forzado paga también las anims lazy

**Problema real:** en desarrollo, un solo clic en «Generar» abre un gasto sin techo ni aviso: cada anim lazy que el personaje llegue a usar mientras dure la pestaña.

**Premisa:** confirmada. `forzado` es `true` tras `force` (`character-sprites.ts:265,284,299`). `pedirAnim` decide `resolveOnly = !state.forzado && permiso !== "generar"` (`:343`), así que las lazy que encola `modelFor` (`:421-430`) generan. El botón solo dice «¿Confirmar? Gastará créditos» (`dev-menu.ts:106`). El comentario de `:60-62` lo declara intencionado.
**Alcance real, más pequeño de lo que parece:** `restaurar` solo existe con el techo de desarrollo (`gates-de-imagen.ts:188-191`). En producción el permiso es `generar` y las lazy se generan para todos. Y en `base` `modelFor` sale antes (`:412`). **`forzado` solo cambia algo en desarrollo.**

**Recomendación: (b).** La decisión del usuario del 2026-09-24 (#757) es que en desarrollo **lo automático** solo restaura y que se paga por un gesto deliberado. La anim lazy es automática por definición: la dispara un fotograma de `modelFor`, no un clic. Con (a), un clic seguiría abriendo un gasto que depende de lo que haga el personaje durante horas. Anunciarlo no le pone techo, y eso es justo lo que la decisión quería quitar del modo por defecto. Con (b), el clic paga exactamente lo que el clic enseña, que es el set automático. En producción no cambia nada.
**Qué cierra (b), dicho para que se acepte a sabiendas:**
- En desarrollo, un personaje forzado ataca y muere en y_bot si esas anims no estaban pagadas.
- El menú dev no ofrece pagarlas: `pendientes` marca «listo» en cuanto está la `idle` (`:220`).
- La salida es `NEFAN_ENTORNO=produccion`.
- Tampoco debe arreglarse con un botón «pagar las lazy» en esta tanda. Eso es (a) por otra puerta.

**Interacción con #755:** con (b), las lazy del forzado caen en `sinArte()`, así que el recuento por personaje tiene que saber qué es un personaje «parcial». Son dos issues que tocan la misma cadena: **van en el mismo cambio**, no en dos.

## #748 · muro de fallo en tema claro

**Problema real:** en el muro de fallo, «Cerrar» se lee mal o no se ve en algunos packs, y el hueco que tiene encima está descompensado.

**Premisa:**
- Hueco: confirmado, y **no depende del tema**. `#narrative-loader` tiene `gap: 14px` (`game-ui.css:373`). `.elapsed` vacío sigue siendo un hijo del flex (`index.html:143`; `muro-de-arranque.ts:38` lo vacía pero no lo quita), y `.dismiss` suma `margin-top: 6px` (`game-ui.css:403`). La cuenta es 14+0+14+6=34 px contra 14.
- Contraste: **el texto no es el problema en `acuarela_luminosa`**. «Cerrar» es `--nf-ink` sobre `raised` (6 %) encima de `fade`, y medido con los tokens del pack da ink/fade 9,1:1. Lo que falla es la silueta del botón: border/fade 1,55:1 (WCAG no-texto pide 3:1).
- **Es mayor de lo que dice el issue.** El mismo cálculo para todos los packs:

| Pack | border/fade | ink/fade | ink_dim/fade |
|---|---|---|---|
| `anime` | 1,03 | **1,03** | 2,5 |
| `acuarela_luminosa` | 1,55 | 9,1 | 3,3 |
| `acero_neon` | 2,04 | ok | ok |
| `medievo_crudo` | 2,25 | ok | ok |
| `sombra_de_cuento` | 2,05 | ok | ok |

  En `anime` (tinta oscura sobre `fade` oscuro, `#17140f` sobre `#12100c`) el texto de «Cerrar» es **invisible**, y el detalle queda por debajo de 3:1.
- La causa de fondo: `test/ui-theme.test.ts:154-169` mide la legibilidad contra `surface`, pero el muro pinta sobre `fade` (`game-ui.css:376`). **El par que usa el muro no lo mide nadie.** Por eso un pack nuevo repetiría el fallo.

**El día después:** «Cerrar» se ve en los cinco packs, y un pack nuevo con `fade` incompatible no pasa el test de tema. El test cierra la puerta a packs con `fade` libre, y es la que conviene cerrar.

## Conflictos

- **AX (#730 #729 #754)** toca `fps-atlas.ts` y la ruta de generar tiles del menú dev.
  - Con (b), #756 solo toca `character-sprites.ts`: sin solape.
  - (a) tocaría `dev-menu.ts`, que AX puede tocar por #729: otra razón para (b).
  - #755 no debe unificarse con la línea de balance del atlas (`fps-atlas.ts:383,408`). Hacerlo sería pisar AX.
- #748 comparte `game-ui.css` y `ui-theme.test.ts` con nadie de la cola abierta.
- **#664** (cliente sin cobertura): nada que resolver aquí.
- #757 ya está en `main`: esta tanda **cumple** su decisión y no la contradice.

## Coste contra valor

- **#755:** barato. Sin él, el registro sigue mintiendo por 3×.
- **#756:** una línea de lógica más el guion. Sin él, cada clic de desarrollo sigue siendo un gasto abierto, que es lo que #757 quería cerrar.
- **#748:** tokens de dos packs, una regla CSS y un aserto del test de tema. Sin él, un jugador de `anime` que ve un fallo no ve la salida.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

> **Criterios de aceptación (crítico)**
> 1. **#755**: la línea de balance cuenta PERSONAJES (skins distintos por prompt, jugador incluido), separando restaurados, parciales y sin arte, sin la palabra «anim». El recuento por anim, si queda, va a la traza de desarrollo. Una anim lazy que vuelve «sin arte» de un personaje ya contado NO produce otra línea que lo cuente de nuevo. El guion lo comprueba contra `__nefan.skins` (prompts distintos), no contra el número de NPC. El texto del rótulo sale de una función pura con test. En negativo: devolver el recuento por anim pone rojo el guion.
> 2. **#756, salida (b)**: `force` paga el set automático (idle/walk/run) del personaje. Sus anims lazy, con permiso `restaurar`, piden `resolve_only` igual que las de cualquier otro. Con permiso `generar` (producción) nada cambia. Guion en desarrollo, contra el motor falso:
>    - forzar un skin da Δ`/skin_sprite_sheet` = 3 de pago;
>    - llevar a ese personaje a una anim lazy (el jugador atacando vale) da Δ pagos 0 y POST con `resolve_only`.
>
>    En negativo: con `forzado` de vuelta en `resolveOnly`, el guion se pone rojo.
> 3. **#748**:
>    - el hueco entre el detalle y el primer botón visible del muro de fallo es igual al que hay entre el título y el detalle, medido en el DOM del guion;
>    - «Cerrar» cumple ink/fade ≥ 4,5 y border/fade ≥ 3 en TODOS los packs, candado en `ui-theme.test.ts` contra `fade`, no contra `surface`; hoy es rojo en `anime` y `acuarela_luminosa`;
>    - captura del muro en los dos packs.
> 4. #755 y #756 van en el mismo cambio (misma cadena). No se toca `fps-atlas.ts` (tanda AX).
>
> **Fuera de alcance:** el gris del registro sobre la escena (`#combat-log` sin fondo). Se abre como issue propio para poder cerrar #755.
