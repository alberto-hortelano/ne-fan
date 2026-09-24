# QA — tanda BB (#731 #673): el título no pinta encima de la pantalla nueva

Validado el 2026-09-24 sobre el worktree `feature/tanda-bb` (base f25da654, sin commitear),
contra `e2e-sin-creditos` levantado por `node qa/run.mjs` en cada corrida (0 créditos: solo el
motor falso). Todo lo que se cita abajo se corrió hoy; nada se copia del informe del ingeniero.

## Criterios de aceptación

| Criterio (literal de `requisitos.md`) | Veredicto | Evidencia |
|---|---|---|
| 1 · El refresco tras una pre-generación no pinta nunca encima de una pantalla que el jugador ya ha dejado, para cualquier salida del selector | ✅ cumple | Guion 198 (A Volver, B Continuar, C Subir estilo, D Volver tras `error`): `2 en verde · 0 en rojo` (con el 199). **Negativo**: con los cuatro ficheros de `nefan-html/src/ui` del título en HEAD, 198 y 199 rojos en los 7 asertos de pantalla (`pantalla final: selector` en A-D; `editor`/`home` en E/H1/H2), restaurados byte a byte (`diff -r` vacío). Y por el camino del jugador, con el `ready` REAL del bridge: guion 200 bloque A verde, rojo sin el arreglo («pantalla final: selector») |
| 2 · Guion 198 que pulse «Volver» en la misma tarea en que se publica `ready`, afirme home con `#ts-new` operativo, sin poder salir verde por ir rápido; negativo rojo en f25da654 | ✅ cumple | `finYSalirEnLaMismaTarea` entrega el mensaje y pulsa en un solo `evaluate`; la `list_games` del refresco se RETIENE hasta que el destino está pintado y el aserto espera a `pedidas == entregadas` (`soltarYVerResuelto`), no un plazo. Afirma además que el refresco salió (`list_games` +1) y que «Nueva partida» abre el selector. Negativo rojo hoy (ver criterio 1) |
| 3 · En el banco no se añade espera de «título quieto»; `abrirSelectorDeMundos` y `regenerarMundo` no cambian | ✅ cumple | `git diff` no toca `qa/lib/sesion.mjs`; `grep -n "quieto" qa/lib/*.mjs` sin resultados nuevos |
| 4 · #673: la 17ª espera del 15 vuelve a `esperaDeFotogramas`, se borra su exención, y el 15 aislado corre 21 veces con 0 rojos, después del criterio 1 | ✅ cumple | Diff del 15: `esperarRedibujo = esperaDeFotogramas("loop")` en `encarar()`; exención #673 borrada de `esperas-por-fotogramas.json`. **Corridas mías**: `node qa/run.mjs 15-guardia` × 5 aislado → 5 × `1 en verde · 0 en rojo` (29 asertos cada una, con «pre-generación (ready): 9 escenas»). El ingeniero declara 21 × 21; yo respondo de mis 5 |
| 5 · Cero créditos; se cierran #731 y #673 desde la PR | ✅ / ⚠️ | Censo de gasto de todas las corridas: solo `/generate_scene` del motor falso, `puertas {}`. El cierre desde la PR no es comprobable: no hay PR aún |
| Añadido del coordinador: la pregunta «¿sigue siendo esta pantalla la que está delante?» vive en UN sitio y sirve al selector, «Continuar» y «Subir estilo»; medir si esas dos salidas también fallaban | ✅ cumple | `TitleScreen.pedida` + `pedirPantalla` (puerta de `ir()`) + `laQueHayDelante`; ninguna hoja lleva su propia copia. Medido: B «Continuar» y C «Subir estilo» del 198 rojos sin el arreglo |
| Lint de la tanda AY (`no-useless-assignment`, `preserve-caught-error` con `requireCatchParameter`) sobre los `.mjs` de esta tanda | ✅ cumple | `git fetch`; config de `origin/main` (54f54e76, `nefan-core/eslint.qa.config.js`) sobre 198, 199, 200, `retener.mjs`, 15 y `fotogramas.mjs`: **0 hallazgos**. La config se probó en negativo con un fichero sembrado: 4 hallazgos (los tres tipos de regla) |

## Adversarial (lo que se buscó falsificar)

- **¿Alguna navegación del título que no pase por `ir()`/`pedirPantalla`?** No. Las cinco hojas
  navegan por `deps.ir` (grep de `.ir(` en `ui/titulo/*.ts`); `show()` entra por `ir({a:"home"})`;
  los repintados propios del home (tras borrar, tras cambiar el modo) reutilizan el turno a
  propósito y preguntan antes de escribir (199 H1/H2). `elegir` (Reanudar/Comenzar) resuelve
  `show()` y `main.ts` oculta el título: no es navegación del título. `#ts-close` (modo fixtures)
  oculta sin resolver; el turno queda como estaba y el siguiente `show()` lo renueva.
- **¿Puede el turno dejar una pantalla EN BLANCO?** No encontré vía. Ningún pintado vacía
  `content` antes de su `await`: el selector espera `listGames()` y luego escribe; el editor
  espera el censo y luego escribe; el home escribe el esqueleto en el bloque síncrono. El pintado
  que abandona deja lo que hay, y lo que hay es lo que pintó la navegación más reciente. El único
  caso en que no llega a pintar nada nuevo es que esa navegación FALLE (p. ej. `listGames`
  rechaza), y ahí el comportamiento es el de antes: botón devuelto y motivo en pantalla (96/98).
- **Doble clic rápido.** «Nueva partida» y «Continuar» se deshabilitan al primer clic (código, sin
  ventana). «Volver» × 2 en la misma tarea y «Volver» + «Nueva partida» en la misma tarea: guion
  200 B y C, verdes (un solo `#ts-new`, lista tardía del home no pisa al selector). Son guardas
  de regresión: no se ponen rojos sin el arreglo (medido) y el guion lo dice en su cabecera.
- **`ready` real en vez de entregado por el guion.** El 198 entrega el mensaje él mismo (desviación
  declarada por el ingeniero). El guion 200 A lo mide con la pre-generación de verdad y sin
  retener nada: `MutationObserver` sobre `data-gen-phase` que pulsa «Volver» en la vuelta del
  `ready`. Verde con el arreglo, rojo sin él. Con eso la desviación del 198 queda cubierta.
- **Vecinos que usan `regenerarMundo` → «Volver» → `#ts-new`** (la firma de #731): 07 (+107),
  123 y 160, una corrida cada uno hoy: verdes.

## Crítica visual (capturas)

`qa/capturas/2026-09-24T18-53-14-887Z-1037787/` (198/199) y `…19-01-28-543Z-1086663/` (200):

- Home tras el refresco (`ready` y `error`, entregado y real): título, «Nueva partida» y «Bridge OK
  — 0 partidas guardadas» / «— Ninguna partida todavía —». Sin restos del selector, sin doble
  botón, sin panel de generación colgando. Igual en las tres capturas del home.
- Editor tras el refresco: «Crear personaje · Mundo: Miravanda», modelo «Y bot», «← Volver» y
  «Comenzar». Limpio.
- Subir estilo tras el refresco: formulario entero (nombre, etiquetas, fila de imagen, Subir).
  Limpio.
- 199 E (home con dos partidas: la real y el clon), H1 y H2 (selector con «Mundo: ✓ generado»).
  H1 y H2 son byte a byte la misma imagen (md5 igual): mismo estado del selector, no un defecto.
- Nada que reprochar como jugador: cada pantalla es la que se pidió, y solo esa. Lo único que
  se ve y no es de esta tanda: en el selector la cuarta tarjeta («Toledo, 1200») queda cortada por
  el scroll de la columna a 1280×800. Pre-existente.

## Hallazgos

**Bloqueantes**: ninguno.

**Importantes**: ninguno.

**Menores**

1. **198 y 199 no tienen fila en «Los guiones sembrados» de `qa/README.md`.** Es convención (el
   test `un-numero-un-guion` declara por escrito que no la mira), pero todos los guiones de las
   últimas tandas la tienen y el 199 es además el que documenta la mecánica de `retener.mjs`.
   Reproducción: `grep -n "198\|199" qa/README.md` → solo el `198 sondeos` del 109. Esperado:
   una fila por guion. (La del 200 la he añadido yo con el guion.)
2. **Misma familia, fuera del alcance de esta tanda, sin probar**: tres navegaciones AUTOMÁTICAS
   llegan tras un `await` largo y llevan al jugador al selector aunque se haya ido de la pantalla
   que las pidió: `crear-mundo.ts:119` (tras `createGame`, 1-3 min; la pantalla avisa «no cierres
   esta pantalla»), `subir-estilo.ts:232` y `:268` (tras subir/completar), `plan-de-estilo.ts:208`
   (1,2 s tras el comprobante). Pasan por `ir()`, así que toman turno y no dejan pintado huérfano
   —no es el defecto de #731—, pero cambian de pantalla sin que el jugador lo pida en ese instante.
   No probado: crear mundo y subir estilo necesitan motor real / remote-gen (gastan). Propuesta:
   issue aparte, no un cambio en esta tanda.

## Workarounds usados

Ninguno sobre el flujo del jugador. Dos cosas que conviene dejar dichas:

- **`qa/lib/retener.mjs`** (198/199) instrumenta `WebSocket` y `fetch` dentro de la página para
  retener respuestas. Es un instrumento de medida, no un obstáculo que el jugador tenga delante:
  reproduce el orden que da un bridge lento. Y el guion 200 demuestra el mismo defecto SIN retener
  nada, con el `ready` real, así que el veredicto no depende del instrumento.
- **Negativos**: los cuatro ficheros de `nefan-html/src/ui` del título se llevaron a HEAD con
  `git checkout`, se corrió, y se restauraron desde copia con `diff -r` vacío y `git status`
  idéntico al de partida. No se tocó código de producción.
- El primer intento del guion 200 cayó por un error mío (`waitForSelector` de `#ts-gen-progress`
  con «visible» sobre un `div` vacío): corregido a `state: "attached"`. No es del producto.

## No probado

- Cierre de #731 y #673 desde la PR (no existe aún).
- Las 21 corridas del criterio 4 las declara el ingeniero; yo corrí 5 (0 rojos). La frecuencia
  histórica del rojo (≈1/9) hace que 5 verdes no lo excluyan solos; junto con el negativo del 198
  y del 200 (el mecanismo, no la estadística) sí.
- Hallazgo menor 2 (navegaciones automáticas tras `createGame`/subida de estilo): gastan.
- `setRenderMode`/`deleteSession` FALLANDO con el jugador ya fuera (rama `catch` con
  `!sigueDelante()`): lo declara el propio informe como no cubierto; no lo conduje.

## Verificación de la casa

- `nefan-core npm test`: 3479/3479 antes de mi guion, y 3479/3479 repetido con el 200 y la fila
  del README en el árbol (el barrido del banco y el candado de numeración lo aceptan).
- `nefan-html`: `tsc --noEmit` OK · `eslint .` sin hallazgos · `npm test` 48/48.
- Sin solape con `origin/main` (54f54e76) en ningún fichero de la tanda; 198-201 siguen libres en
  `origin/main`.

## Material que deja QA

- `qa/guiones/200-el-ready-real-y-los-clics-rapidos-del-titulo.mjs` (+ su fila en `qa/README.md`):
  A `ready` real + «Volver» en la misma vuelta (rojo sin el arreglo) · B doble «Volver» · C
  «Volver» + «Nueva partida» en la misma tarea. `aisla: mundo, fake-ai`; 0 créditos.

## Veredicto

**Apto.** Los dos issues son un solo defecto del producto y está cerrado en el sitio correcto,
con tres guiones que lo demuestran en negativo (198, 199 y 200) y sin tocar el banco compartido.
Los dos hallazgos menores no condicionan la fusión: uno es una fila de README y el otro es un
issue nuevo.
