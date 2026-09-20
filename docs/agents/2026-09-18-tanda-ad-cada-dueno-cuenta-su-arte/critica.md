# Crítica — tanda AD (#492) · **VIGENTE**, con cuatro correcciones factuales a `requisitos.md`

Medido sobre `main` = `a25d8c2f`, 2026-09-18. Todo lo que sigue está abierto, no recordado.

## El problema real, en una frase

`main.ts` sigue siendo quien cuenta el arte pendiente de todo el cliente porque nadie más lo sabe contar, y la
excepción de tamaño que lo protege dice, HOY, una cosa falsa sobre el menú dev.

La solución del issue ataca ese problema y no otro, y no es un «#358 bis»: la propia excepción lo invita
(`client-file-size.json:8`: «si alguien quiere bajarla, abre un issue con la frontera MEDIDA») y #492 es ese issue.

## La premisa, afirmación por afirmación

| Afirmación (requisitos / comentario 09-17) | Hoy | Veredicto |
|---|---|---|
| `DevMenu` tiene 3 deps y vive en `ui/dev-menu.ts` | `dev-menu.ts:22-26` (`listFakeItems`, `generate`, `log`); 166 líneas | cierto |
| `listFakeItems` en `main.ts:797-840`, 43 líneas | `main.ts:798-840` (43); docblock desde `:795`; `generateFakeItem` `:843-849`; `new DevMenu` `:856-860`. El bloque entero del menú es `:795-859` = **65 líneas** | cierto, y el sujeto que sale es el bloque de 65, no solo los 43 |
| «seis colaboradores: aspecto, characterSprites, fpsAtlasController, fpsRenderer, mundo, tileStore» | son **siete**: falta `spriteRenderer` (`main.ts:823`, `getCached(BASE_MODEL, "idle", …)` para la miniatura y_bot), más `CONFIG` y `BASE_MODEL` importados | **menor de lo dicho, en la dirección incómoda** |
| «`main.ts` en su tope sin holgura (1379/1379 ayer; re-medir)» | `wc -l` = **1381**; excepción `lineas: 1381` (`client-file-size.json:7`). Subió 2 con #659 (`b7b20650`) | cierto: 1381/1381 |
| Criterio 3: «el tope de `arch-rules.json` baja con él» | el tope NO está en `arch-rules.json` (grep de `main.ts`/`1381` = 0 ahí). Vive en `data/contract/client-file-size.json` y `test/client-file-size.test.ts:113` exige que la cifra sea **EXACTAMENTE** `wc -l`: no hay «holgura» posible por construcción, y bajarla no es opcional sino obligatorio en el mismo commit | **fichero equivocado**; el criterio se cumple solo |
| Tandas K y N ocupaban `main.ts` (motivo del «no entra» del 09-17) | las dos fusionadas: `c9be0d9c` (#654) y `900b5b71` (#637) | desbloqueado |
| Ninguna otra tanda de hoy toca `main.ts` | `grep main.ts docs/agents/2026-09-18-tanda-*/requisitos.md` → solo AD; ninguna nombra `fps-atlas`, `character-sprites`, `tile-store`, `dev-menu` ni `client-file-size` | **confirmado** |

**La premisa que está a medias: «cada dueño cuenta su propio arte».** Ningún dueño solo sabe hoy lo que
`listFakeItems` sabe, porque cada conteo cruza DOS fuentes:

- **Skins.** `CharacterSpriteManager` solo conoce los prompts que pasaron por `requestSkin`, y `requestSkin`
  devuelve sin anotar nada cuando el modo es maqueta o el fusible saltó (`character-sprites.ts:236-237`).
  Con una partida nueva —que nace en maqueta desde #579— el gestor tiene CERO registros y el menú de hoy lista a
  todos los NPC como «base y_bot» porque recorre `mundo.personajes` + `aspecto.skinPrompt()` (`main.ts:817-822`).
  Un `pendientes()` del gestor a solas listaría vacío justo en el modo por defecto: **el guion de QA tiene que
  medir eso, o el criterio 2 sale verde con una lista más corta**. Ese mismo recorrido ya está duplicado en
  `modos-de-graficos.ts:201-206` (`rePedirTodosLosSkins`): quien lo unifique paga una vez.
- **Atlas.** «Texturado» lo sabe el GL (`fpsRenderer.debugState().textured`, `main.ts:803-804`), los tiles los
  tiene `tileStore.entries`, y `fpsAtlasController` solo sabe `running` (`fps-atlas.ts:74`); sus deps
  (`fps-atlas.ts:38-50`) no incluyen la lista de tiles ni el estado texturado.

No invalida la tarea: cambia quién es «el dueño» (dos por kind, o uno al que se le da lo que le falta). Lo decide
el arquitecto; aquí solo queda dicho que el «~3 deps» del issue es optimista sin ese reparto.

## El día después

- **Para quien juega: nada.** Herramienta de desarrollo (`#dev-menu`). Deuda declarada: ítem (a) del backlog del
  plan del corte 8 (`docs/agents/2026-09-06-lo-que-le-queda-a-main/plan-8.md` §7), el último de #358 sin hacer.
- **Se vuelve obligatorio reescribir el `porque` de la excepción** (`client-file-size.json:8`): hoy dice que queda
  en `main.ts` «el menú dev, que el plan del corte 8 midió como inventario sobre todo lo demás (8 colaboradores)».
  Ya es falso a medias (la clase tiene 3) y mañana lo será del todo: documentación falsa candada.
- **Lo que nadie borrará si no se dice:** el docblock de `main.ts:851-853` («vive en la raíz, que es la única que
  lo ve todo») es la justificación de que se quede; se va con la función o queda mintiendo junto al `new DevMenu`.
- **Lo que no se mide:** el cliente no tiene cobertura, CRAP ni mutación (#664; `nefan-html/test` tiene UN test).
  Los `pendientes()` nuevos nacen sin medida salvo el test que el ingeniero escriba y el guion de QA.
- **Arbitrario en un mes:** dos formas distintas de contar si atlas y skins no comparten el `FakeItem` que ya
  es el tipo común (`dev-menu.ts:11-20`).

## Conflictos

- **Solapamiento:** ninguno en la cola. Ningún issue abierto toca `main.ts`, el menú dev ni los tres módulos.
- **Contradicción:** ninguna con `CLAUDE.md`. `la-logica-de-juego-no-vuelve-al-cliente` es un censo de
  IDENTIFICADORES (`arch-rules.json`, patrón con `pendingTiles|queuedTiles|skinsDisabled|personajesFallidos`):
  un `pendientes()` que no use esos nombres pasa aunque llevara lógica dentro. Que el criterio 4 lo cite no
  garantiza nada; la frontera la sujeta que un inventario de estado de RENDER (GL texturado, hojas en caché) es
  del cliente por definición. Sin conflicto, pero que nadie lo presente como candado de eso.
- **Dependencia oculta:** #680 (numeración de guiones): no existe HOY ningún guion que conduzca `#dev-menu`
  ni `#ds-menu-btn` (grep en `qa/` = 0; `capturar-portadas.mjs` solo lo oculta). El criterio 2 exige guion NUEVO
  con número al fusionar. El motor falso sirve `/skin_sprite_sheet` y `/generate_surface_atlas`
  (`labs/narrative/fake-ai-server.ts:123,150`): factible a cero créditos. El hook `__nefan` expone `skins` y
  `fpsAtlas` (`dev/nefan-hook.ts:145,81`) pero no la lista del menú; cómo la lee QA lo decide el arquitecto.

## Coste contra valor

Coste: ~65 líneas fuera de `main.ts`, dos o tres métodos nuevos en módulos de 376/437/292 líneas —tope 450;
`character-sprites.ts` va en 437, **13 de holgura**, y eso el arquitecto lo mira antes de meterle un método con
docblock—, un JSON de contrato reescrito, un guion nuevo. Sin créditos, sin mutación (cliente). Valor: cierra el
último ítem del programa #358, deja la excepción de tamaño diciendo la verdad y quita la única función de
`main.ts` que sabe de skins y atlas a la vez. **No hacerlo nunca:** el menú funciona igual y nadie lo nota; lo
único que envejece es el `porque` de la excepción, que ya envejeció. Tarea barata y honesta, no urgente. Entra.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

> **Medido el 2026-09-18 sobre `a25d8c2f`:** `listFakeItems` está en `main.ts:798-840` (43 líneas); el bloque
> del menú que sale entero es `:795-859` (docblocks + `generateFakeItem` + `new DevMenu`, 65 líneas). Toca
> **siete** colaboradores: aspecto · characterSprites · fpsAtlasController · fpsRenderer · mundo · **spriteRenderer**
> (miniatura y_bot, `:823`) · tileStore. `main.ts` mide **1381** y su excepción dice 1381.
>
> **Criterio 3 corregido:** el tope vive en `nefan-core/data/contract/client-file-size.json:7`, no en
> `arch-rules.json`, y `test/client-file-size.test.ts:113` exige la cifra EXACTA de `wc -l`: se actualiza en el
> mismo commit o el test está rojo. Se reescribe el `porque` (`:8`) para que deje de nombrar al menú dev como
> inventario de 8 colaboradores que se queda en la raíz, y se retira el docblock de `main.ts:851-853` que decía
> que el menú vive en la raíz «porque es la única que lo ve todo».
>
> **Criterio 1 matizado:** ningún dueño solo sabe hoy lo que cuenta `listFakeItems`. Skins: el gestor no anota
> prompts en maqueta ni con el fusible saltado (`character-sprites.ts:236-237`), y una partida nueva nace en
> maqueta; los prompts vivos los tienen `mundo.personajes` y `aspecto`. Atlas: «texturado» lo sabe el GL
> (`fpsRenderer.debugState()`), los tiles `tileStore`, y el controlador solo `running`. El arquitecto decide el
> reparto; el criterio es que **la lista sea idéntica a la de hoy en maqueta, en imagen y con un skin fallido**.
>
> **Criterio 2 matizado:** no existe guion que conduzca `#dev-menu` (grep en `qa/` = 0). Hace falta uno nuevo
> sobre `e2e-sin-creditos` que compare la lista antes/después en los tres estados de arriba; número al fusionar
> (#680). `character-sprites.ts` está en 437/450: si el método nuevo lo pasa del tope, no se sube el tope.
