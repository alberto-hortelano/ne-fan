# REENCUADRADA

El corte que pide el issue —uno por pantalla— **es el correcto, y lo confirma la medida que en `main.ts` dijo lo contrario**: las cuatro pantallas hoja necesitan 2-3 colaboradores, no la bolsa de treinta campos que T3 rechazó dos veces. Lo que está mal es el **alcance**: trocear solo las siete pantallas deja el fichero en ≈ 800 líneas, muy por encima del tope 450. Las 482 líneas que faltan están en tres sitios que el issue no nombra (los helpers del módulo, el chasis del overlay y los avisos). Con esos tres, el fichero baja a ≈ 284 y **la excepción desaparece del `client-file-size.json`**, que es el único cierre que no se puede discutir.

## El problema real, en una frase

`title-screen.ts` es el punto de convergencia de toda tanda con superficie visible: **39 commits en 23 PR en 30 días** (10,2 % de los 384 commits de `main`), repartidos sobre **las siete pantallas, ninguna muerta** (`renderWorldSelect` 23 commits, `CharEditor` 16, `Home` 13, `UploadStyle` 8, `CreateWorld` 6, `StylePlan` 4, `GenProgress` 3).

## La premisa, afirmación por afirmación

- **1.738 líneas, 7 `render*`, 11 `let`, 15 imports**: ✓ todo re-medido hoy sobre `1c7bf189`.
- **«Comparten clase, `this.content` y las constantes CSS, pero no mucho más»**: ✓ **y es el hallazgo que decide el veredicto.** Matriz de uso de los 11 campos: `renderStylePlan` usa `styleApply` (2) y nada más; `renderUploadStyle` solo `content` (11); `renderCreateWorld` `content`+`narrative`; `renderCharacterEditor` `content`+`resolve`. **N medido = 2-3 por hoja** (más 1 callback de vuelta), **≤ 6 en los dos concentradores** (`renderHome`, `renderWorldSelect`). Es el patrón `Deps…`+fábrica de `carga-de-tile.ts`, no un objeto de contexto. **Respuesta a la pregunta 2: sí, el corte por pantalla es el correcto, y no hace falta la bolsa.**
- **Los 11 `let`**: ninguno es campo de clase; **los 11 son locales de su `render*`** (Home 1, WorldSelect 5, StylePlan 1, UploadStyle 1, CharEditor 3). Salen solos con su pantalla. Al revés que en #358, aquí el mapa del issue no está muerto — es que el issue no lo trae.
- **«Cada tanda que toca UNA pantalla carga 1.700 líneas»**: ✓ a medias, y **hay que corregirlo**. Solo **17 de 39** commits tocan una pantalla; **20 tocan dos o más**, y **cinco tocan cuatro o cinco** (`239d7396`, `d880907b`, `62e96bed`, `55ad4705`, `b8d96a42`). Esos cinco no son «tandas que chocan»: son cambios al **vocabulario compartido** (CSS, layout, chasis, chips de modo). Un corte solo-por-pantalla los empeora —de un fichero a cinco—, **salvo si el vocabulario sale primero**. Por eso la PR 1 no es una pantalla.
- **Churn contra `main.ts`**: el requisitos compara 39/23 con 72/41 sin denominador. Medido: `main.ts` era 19,7 % de los commits; esto es **10,2 %**. La mitad. Sigue siendo el segundo fichero de choque del cliente, pero el argumento vale la mitad de lo que parece.
- **«Dos motores leen `client-file-size.json`»**: ✓ (`eslint.config.js` y `test/client-file-size.test.ts`). `afectado.test.ts:252` lo nombra pero como fixture.
- **«El título ya no tiene lógica de juego»**: ✓ verificado. Los tres imports de core de PR 7 de #241 están vivos (`eleccionDeEstilo`, `validarBorrador`, `validarSubidaDeEstilo`) y no queda decisión que mover.
- **`style-apply.ts` «cuelga de #346»** (`client-file-size.json`): ✗ **caducado**. Desde el 07-09 tiene issue propio, **#513**. Ese `"issue": "#346"` hay que reescribirlo a `#513` en la primera PR que toque el JSON.
- **#509 y #510 «tocan el título»** (requisitos): ✗. Los dos viven en `ui/modos-de-graficos.ts`, `game-ui.css`, `#gfx-panel` y `#error-log`; `title-screen.ts` no posee ninguno de esos ids. **Cero conflicto.**

## El corte propuesto, con la aritmética hecha ANTES

| PR | Qué sale | Sale | Entra | Fichero raíz |
|---|---|---|---|---|
| — | base `1c7bf189` | | | **1.738** |
| 1 | **átomos** `:1542-1738` (escapes, CSS, covers, badges, filas) | 197 | ~8 | **1.549** |
| 2 | **subir-estilo** (169+11 rótulos) + **plan-de-estilo** (92) | 272 | ~20 | **1.297** |
| 3 | **crear-mundo** (90) + **editor-de-personaje** (121) | 211 | ~16 | **1.102** |
| 4 | **home** (147 + `onModeBadge` 43 + `modeArmed` 7) | 197 | ~12 | **917** |
| 5 | **selector-de-mundo** (304 + progreso 23 + 19 de campos + suscripción `:171-207`, 37) | 383 | ~18 | **552** |
| 6 | **chasis** (`:208-346`, 139) + **avisos** (145) | 284 | ~16 | **284** |

Con margen de incertidumbre en el cableado: **280-380**. **Sí alcanza el tope 450**, y esa es la diferencia con #358, donde el 450 era inalcanzable sin la bolsa. Las tres cajas que el issue **no** nombra (1 y 6) son 482 de las 1.508 líneas que salen: sin ellas se acaba en ≈ 800 y con la excepción intacta, o sea con el issue cerrado y el problema puesto.

**Orden**: 1 primero porque es el único con **cero `this`** (riesgo nulo) y porque cubre las cinco PR transversales del churn. 5 y 6 al final: son las que tocan el chasis y los tres huecos de mensaje, las únicas con riesgo real de cambio de conducta.

## Criterio de cierre, en cifras

1. `wc -l nefan-html/src/ui/title-screen.ts` **≤ 450** y, en consecuencia, **la excepción de `title-screen.ts` desaparece de `client-file-size.json`** (de cuatro a tres). Mientras siga siendo excepción con cifra exacta, sigue siendo un fichero con permiso especial: bajar de 1.738 a 900 y dejar la excepción es regalarse 900 líneas de recrecimiento, que es lo que el `$comment` del JSON ya advierte por escrito.
2. `grep -c "private.*render[A-Z]"` = **0**: la clase queda como enrutador.
3. **0 `let`** en el fichero raíz (hoy 11).
4. Ningún módulo nuevo por encima de 450 (el mayor previsto, `selector-de-mundo.ts`, ≈ 400).
5. Las **30 baterías** que conducen el título por `#ts-*` verdes **sin retocar un guion**.

## El día después

Para quien juega no cambia nada, y es deuda declarada: correcto. Lo que se cierra: `renderStylePlan` queda en su fichero justo cuando **#513** va a reescribirlo — es una ventaja (reescribe 92 líneas aisladas, no un god-file), pero obliga a que #513 empiece **después**. Lo que nadie borrará: el comentario de `qa/guiones/92...mjs:7` y `qa/README.md:222` citan `title-screen.ts:905-909` y `:1382`; quedan apuntando a líneas que no existirán (rastro de prosa, se barre con motivo). Lo arbitrario dentro de un mes: siete ficheros en `ui/titulo/` con nombres en español — es el patrón de la casa desde #358, no hace falta inventar otro.

## Conflictos

- **#513** (style-apply): decisión del usuario, **nunca en paralelo**. #346 completo → luego #513. Además, corregir su puntero en `client-file-size.json`.
- **#427** (tres huecos de mensaje sin dueño): su propio cuerpo dice *«si #346 se hace antes, esta decisión es su criterio de corte natural»*. **Sin conflicto, y #346 primero.** Aviso al ingeniero: la PR 6 mueve los tres huecos **verbatim**; decidir #427 dentro de un movimiento mecánico es colar un cambio de conducta.
- **#536** (motivos del pack) y **#425** (30 s mudos de `#ts-status`): aterrizan sobre `subir-estilo.ts` y `home.ts`. Si van antes, chocan con las PR 2 y 4. **Después.**
- **#537** (estilo de otro tema): bridge + registro; roza la marca del selector. Después de la PR 5.
- **Corrida de mutación `34339870322`** (`queued` sobre `1c7bf189`, COMPLETA): **cero conflicto, verificado.** `nefan-html` no entra en la mutación de core, y una PR que solo toque el cliente + `client-file-size.json` **selecciona cero módulos** — lo afirma `afectado.test.ts:252-259` (`ids: []`). Ni añade mutantes ni ensucia la atribución de `repartir`.
- **Trampa medida para la PR 6**: los guiones 19, 20 y 34 leen `document.getElementById("title-screen").firstElementChild` como el contenido. El chasis debe seguir dejando `content` como **primer hijo** de `#root`.

## Coste contra valor

«No hacer nada» es más débil aquí que en #358: el trinquete de la cifra exacta funciona (cuatro subidas en 30 días, las cuatro con motivo escrito), pero **el fichero es excepción de un tope que existe precisamente por él**, y el issue está nombrado dentro del propio candado. Seis PR mecánicas de 200-380 líneas movidas, con las 30 baterías del título como red y cero créditos, compran que #427, #425, #536, #513 y #537 —cinco issues abiertos, todos sobre este fichero— dejen de tocar el mismo sitio. Ese es el valor, y se cobra entero solo si se llega al 450.

## Qué le cambiarías a `requisitos.md` (para pegar tal cual)

- El alcance no son siete módulos: son **nueve cajas en seis PR**, y tres de ellas (átomos, chasis, avisos) no son pantallas. Sin esas tres el fichero se queda en ≈ 800 y la excepción no se puede retirar.
- El criterio de cierre es **`wc -l` ≤ 450 y la excepción de `title-screen.ts` fuera del `client-file-size.json`**, no una cifra congelada más baja.
- **20 de 39 commits tocan dos o más pantallas** y cinco tocan cuatro o cinco: el vocabulario compartido sale en la PR 1, antes que ninguna pantalla.
- El churn es **10,2 % de los commits de `main`**, la mitad que `main.ts` al abrirse #358. Decirlo con el denominador.
- **#509 y #510 no tocan este fichero** — sacarlos de la lista de conflictos. Los que sí: #427, #425, #536, #537 y #513, todos **después**.
- `client-file-size.json` dice que `style-apply.ts` «cuelga de #346»: reescribir ese `"issue"` a `#513` en la primera PR que toque el JSON.
