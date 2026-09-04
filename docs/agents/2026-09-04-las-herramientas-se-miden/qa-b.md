# T10 «Las herramientas se miden» — QA del carril B (#419, #383a, #339, #340)

Worktree desprendido `/home/al/code/ne-fan/.claude/worktrees/qa-t10-b` sobre `55cd613`
(`afa9ed7` B1 · `8bc8627` B2 · `55cd613` B3), `NEFAN_PORT_OFFSET` 400 asignado —
la batería eligió su propio bloque libre, que es lo que hace `qa/run.mjs`.
**Cero créditos** (guardarraíl `fake:true` en todas las corridas, `gasto total 0`),
**ninguna mutación de ninguna clase** lanzada, **ningún proceso ajeno tocado**.

Todo lo que el ingeniero afirma en `implementacion-2.md` está **rehecho por mí**, no
leído. Donde su número y el mío difieren, mando yo y lo digo.

---

## 1. Criterios, uno a uno

### #419 — los opcionales del wire se prueban AUSENTES

| Criterio | Veredicto | Evidencia |
|---|---|---|
| Los diez matables MUEREN con los tests nuevos | ✅ cumple | Harness propio (mutante aplicado en el fuente → batería declarada del módulo → `git checkout`): **los 14 mueren**, y el rojo es del test que toca. `:194`×2 → «sin id no entra…»; `:244` y `:293` → «sin position no entra…»; `:268 :269` → «lo que el tile NO declara no viaja…»; `:278`-`:281` → «un vecino sin prosa, sin ref, sin rol y sin combate…»; `:363`×2 → «un `place_id` que no es una cadena NO viaja…»; `:372`×2 → «una escena que no declara ningún opcional no emite ninguno» |
| …y **sobrevivían antes**: el mérito es de estos tests, no de un aserto que ya estaba | ✅ cumple | **Es la comprobación que el informe no hace.** Repetí los 16 mutantes con los ficheros de test de `af336af` (`git show af336af:nefan-core/test/…`): **los 16 SOBREVIVEN**. Con los de HEAD, 14 mueren y 2 sobreviven. Ningún verde por el motivo equivocado |
| La premisa del `deepEqual`: distingue `{a:1}` de `{a:1,b:undefined}` | ✅ cumple | Comprobado en node, no asumido: `assert/strict.deepEqual` **lanza** `ERR_ASSERTION` con `{a:1}` vs `{a:1,b:undefined}`, y también dentro de un array. Y aguanta más de lo necesario: hasta el `deepEqual` NO estricto lanza. Los dos ficheros importan `node:assert/strict` (`entidades-del-tile.test.ts:15`, `scene-normalize.test.ts:2`) |
| `:201` es EQUIVALENTE de verdad | ✅ cumple | Cierto y por la razón escrita: `Number.isFinite` solo devuelve `true` para primitivas number, así que `true && Number.isFinite(x)` no se separa de `typeof x === "number" && Number.isFinite(x)` con **ningún** valor. Medido: `"1"`, `true`, `false`, `null`, `""`, `[]`, `[5]` → `isFinite` false en los siete. El resultado de `numeros()` sale por un `as number[]`, así que tampoco hay narrowing que cambie nada en runtime |
| `:84` es EQUIVALENTE | ⚠️ **matiz — ver H4** | El **argumento** es correcto y el estado es inalcanzable en producción (los ocho productores de `dueno` escriben literales `{de:"tile",key}` / `{de:"runtime"}`; ni un spread, ni un `dueno` deserializado de JSON). Pero **equivalente no es**: lo maté con un test de un renglón que construye el estado con cast (`{de:"runtime", key} as unknown as DuenoDeEntity`) — verde sin mutante, **rojo con él** |
| No se tocó nada más del contrato | ✅ cumple | `git diff afa9ed7^..afa9ed7 -- mutation-targets.json`: solo los dos `porque`. `break` 96 y 98 intactos, baterías intactas, cero ficheros de test nuevos (el candado de baterías no entra en juego) |
| Los dos módulos vuelven a su suelo **con el número** | ⚠️ **no probado** | 121 y 313 mutantes > `tope_local` 120: `local` los rechaza y la primera medida ni siquiera puede ser local (`permisoLocal` rechaza el coste desconocido). Solo lo cierra la corrida posterior al merge. El informe lo declara así y no afirma score: correcto |

### #383(a) — el segundo corte de `status-labels`

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Ni un texto cambió** | ✅ cumple | Extraje todos los literales de cadena (comillas, plantillas; sin comentarios) del fichero viejo y de las dos mitades: **79 y 79, diff vacío**. Y más fuerte: quitando comentarios y líneas en blanco, las **142 líneas de código** del viejo son un multiconjunto **idéntico** al de las dos mitades. El corte es mecánico: cero lógica movida |
| La superficie pública no pierde ni gana nada | ✅ cumple | 11 `export` en el viejo → **los mismos 11**, mismo nombre y mismo orden, repartidos 5 (`status-rotulo`) + 6 (`status-motivo`). Los dos `const` privados caen cada uno en su mitad: `DETALLE_POR_DEFECTO` en rótulo (`:77`), `EXTENSION_DE_FIXTURE` en motivo (`:79`) |
| **Las dos mitades no comparten nada** | ✅ cumple | `status-motivo.ts` no tiene **ni un `import`**; `status-rotulo.ts` conserva el único del padre (`./messages.js`). Lo único que se citan es prosa de cabecera. Ningún módulo importa al otro |
| Los 46 tests siguen, sin duplicar ni perder | ✅ cumple | 23 + 23 = 46, y el diff de los **títulos** de `it()` entre el fichero viejo y las dos mitades está **vacío** |
| `grep -rn status-labels` a cero en código vivo, `qa/`, `labs/` y docs de arquitectura | ✅ cumple | Barrido de todo el árbol (sin `node_modules`/`.git`/`dist`): fuera de `docs/agents/**` (que son actas históricas y deben quedarse) queda **una** aparición, `nefan-core/data/contract/mutacion-huella.json:1037` |
| …y esa aparición es un dato MEDIDO que no se falsifica | ✅ cumple | Confirmado: la entrada es de la corrida `33790710680` (`total: 162, vivos: 0`, `blob` de un árbol donde el fichero existía), y **B no tocó la huella** — `git diff af336af..HEAD -- mutacion-huella.json` sale vacío. Y las herramientas la tratan solas: `pendiente` dice «ya no está en el árbol (borrado o renombrado)» y `afectado` cae a `TODOS`. *Corrección menor al informe*: esa frase la da `pendiente`, no `deuda` — `deuda` no la menciona, porque el fichero no dejó supervivientes que listar |
| El contrato sustituye el módulo por dos, sin bajar suelo | ✅ cumple | `status-labels` desaparece; nacen `status-rotulo` y `status-motivo`, `break: 100` los dos, un fichero y una batería cada uno. La aritmética (162 mutantes, 0 vivos → dos 100 %) es sólida; el coste por mitad está sin medir y así está escrito |
| El candado de exhaustividad sobrevivió al corte | ✅ cumple | **Negativo mío**: añadí `"inventado_por_qa"` al `kind` de `NarrativeStatusDeSesion` → `npx tsc --noEmit` da **dos** errores, los dos apuntando ya al fichero nuevo: `status-rotulo.ts(77,7) TS2741` (falta en el `Record`) y `status-rotulo.ts(211,9) TS2322` («no assignable to type `never`»). Restaurado |
| El juego real, sin créditos | ✅ cumple | **Corrí la batería ENTERA, no los seis: `69 en verde · 0 en rojo de 69`** (`node qa/run.mjs`, preset `e2e-sin-creditos`, bloque de puertos elegido por el runner). Log en `qa/capturas/2026-09-04T12-35-22-185Z-313728` |
| Crítica visual del muro y del título | ✅ cumple | Captura `69-…-02-306-los-personajes-van-sin-vestir.png`: los dos avisos se leen enteros bajo «Nueva partida», titular en rojo y cuerpo en gris, con la frase del traductor completa («…genéralas con sprite-forge siguiendo docs/assets-de-personaje.md»), sin solaparse con la lista de partidas ni empujarla. La partición no dejó ni un texto cortado |
| `npm run verify` verde | ✅ cumple | **1983 tests · 0 fail** (exit 0). `nefan-html`: `npm run build` y `npm run lint` exit 0 |
| `npm run crap -- --check` | ✅ cumple | Con `coverage` regenerado por mí: «✔ dentro de los umbrales» · 1234 funciones · cobertura de líneas **89,2 %** (mínimo 89) · **0** por encima del tope CRAP 73 |
| La desviación de `client-file-size.json` (2.377 → 2.379) | ✅ cumple, auditada | El diff de `main.ts` es **exactamente** el `import` partido: se añaden `} from "@nefan-core/src/protocol/status-motivo.js";` e `import {`, y el `from` que quedaba pasa a `status-rotulo.js`. **Los seis símbolos son los mismos**; ni una línea de lógica. `wc -l`: 2.377 antes, 2.379 ahora. Y el candado es igualdad EXACTA en los dos sentidos (`test/client-file-size.test.ts:117`, `e.real !== e.lineas`), así que no actualizar la cifra habría sido el rojo |

### #339 + #340 — `break: "sin medir"` con candado y `src/narrative` en la totalidad

| Criterio | Veredicto | Evidencia |
|---|---|---|
| El candado de «sin medir» se ve **ROJO** | ✅ cumple | Negativo mío: puse `break: "sin medir"` a `scene-normalize` (medido) → ROJO: *«el módulo "scene-normalize" dice "sin medir" pero la huella ya trae src/scene/scene-normalize.ts, src/scene/tile-plan.ts: ya se midió, sube el suelo al score medido…»* |
| El `porque` de un `directorios_completos` corto se ve ROJO | ✅ cumple | «porque si ea» → ROJO: *«directorios_completos["src/narrative"]: "porque si ea" no explica nada — di por qué se mide entero AQUÍ y no en core-puro-sin-node»*. Y **vacío** lo para antes el zod, con mensaje útil: *«mutation-targets.json inválido: directorios_completos.0.porque String must contain at least 10 character(s)»* |
| **Las cuatro exclusiones no dejan huérfano a nadie** | ✅ cumple | 9 ficheros en `src/narrative/` = 5 módulos + 4 `!ruta`. Negativo: quitando **una** (`!src/narrative/types.ts`) → ROJO: *«src/narrative/types.ts está en un directorio que se mide entero y ningún módulo lo nombra — métetelo en el módulo que comparta su batería, o exclúyelo con "!…"»* |
| «Si alguien añade un fichero a `src/narrative` mañana» | ✅ cumple | Creé `src/narrative/zz-qa-nuevo.ts` → ROJO con el mismo mensaje, nombrando el fichero nuevo. Borrado |
| El candado que el repo **creía tener y no tenía** (`configDe`) | ✅ cumple, confirmado | `git grep configDe af336af -- nefan-core/test nefan-core/scripts` → **vacío**: ni un test lo llamaba, y `mutate.ts:120` decía «es determinista y tiene candado». Hoy lo llama `mutation-config.test.ts:243`. Negativo: hice que `configDe` volviera a escribir `break: 0` con `SIN_MEDIR` → ROJO: *«un módulo "sin medir" no puede llevar break en su config: {"high":80,"low":72,"break":0}»* |
| «Dos módulos reclaman el mismo fichero» | ✅ ya candado | Metí `src/narrative/ai-client.ts` también en `render-mode` → ROJO: *«src/narrative/ai-client.ts lo mutan dos módulos: "ai-client" y "render-mode"»* (más dos candados de batería) |
| «Un fichero en `directorios_completos` **y** en `sin_mutar`» | ✅ ya candado | ROJO: *«src/narrative/render-mode.ts está en sin_mutar y además lo muta el módulo "render-mode": decide una cosa»* |
| #339: los dos salen de `sin_mutar` | ✅ cumple | `sin_mutar` 36 → **34**; `scene-validate` y `tile-edges` son módulos con `break: "sin medir"`. Sus baterías coinciden con `testsQueImportan`: `scene-validate` → 4 tests (`scene-fixtures`, `scene-validate-golden`, `scene-validate-pasadas`, `scene-validate`); `tile-edges` → 2 (`scene-validate-pasadas`, `tile-edges`). El informe corrige bien el plan (eran cuatro, no cinco) |
| #340: `src/narrative` entra por `directorios_completos` con el porqué escrito | ✅ cumple | 138 palabras que dicen **por qué aquí y no en `core-puro-sin-node`** (`session-storage.ts` importa `node:fs`, meterlo en la regla rompería el build), con el precedente `src/plugins/dsl`. Es exactamente lo que el crítico pedía que no se perdiera |
| Criterio 5 del usuario: **ningún umbral subido, ningún `break` a la baja** | ✅ cumple | Comparación módulo a módulo `af336af` vs `HEAD`: `tope_local` 120 → 120; **un solo `break` cambia**, `asset-store-contrato` **0 → 77**, que es una SUBIDA y es leer la huella, no medir: `src/contracts/asset-store.ts` total 9, vivos 2 → 77,78 % → suelo 77. Ninguna batería de un módulo preexistente se tocó |
| No se pisa el carril A | ✅ cumple | `directorios_completos` tiene **dos** lectores (`mutation-plan.ts` y su test, los dos de B) y `.break` **tres** (`mutate.ts` ×2, `mutation-plan.ts`). Ni `scripts/mutacion.ts` ni `scripts/mutacion-huella.ts` leen ninguno de los dos: solo los nombran en comentarios. El cambio de forma no le llega a Ing-1 |
| El instrumento sigue funcionando con la forma nueva | ✅ cumple | `npm run mutacion -- pendiente` → «41 de 41 módulos (COMPLETA) · 10191 mutantes medidos antes + 9 módulo(s) sin base». `npm run afectado -- --rango af336af..HEAD` clasifica bien lo nuevo y lo borrado. `npm run deuda` corre sin romperse |
| Cada módulo nuevo sale con su `break` medido y commiteado (criterio 2) | ⚠️ **no probado, y abierto** | Siete nacen `"sin medir"`. Solo la corrida posterior al merge los cierra. Ver H5 y la reserva del veredicto |

---

## 2. Hallazgos

### H1 · IMPORTANTE — el contrato afirma que existen tres issues que hoy no existen

`data/contract/mutation-targets.json`, `porque` del módulo `serialize-llm`, última frase:

> «Los tres primeros tienen issue propio; el cuarto entra cuando alguien necesite medir esas dos líneas.»

Los «tres primeros» son `narrative-state.ts`, `session-storage.ts` y `npc-records.ts`.
**No hay ningún issue abierto sobre ninguno de los tres.**

Reproducción: `gh issue list --state open --limit 100` y búsquedas por título
(`narrative-state`, `session-storage`, `npc-records`, `registerSceneNpcs`) → cero.
Lo más cercano es #340, que es justo el issue que esta PR cierra.

El plan sí lo previó («Backlog → issues de GitHub, no prosa (**los abre el coordinador**)»),
así que la acción es del coordinador y no del ingeniero. Pero la frase va **commiteada y en
presente** en el fichero que el repo trata como fuente de verdad de qué se mide y por qué:
dentro de dos meses, quien lea el `porque` buscará tres issues que nadie abrió. Es el patrón
«una decisión correcta con una razón inventada» del propio feedback del usuario.

**Qué esperaría quien lo lee**: que la frase nombre los issues (`#NNN`), o que diga
«pendientes de abrir», o que los issues existan antes del merge. Las tres valen; la actual, no.

### H2 · MENOR — dos de los cuatro motivos de exclusión traen números que no reproducen

El informe los declara «medidos, no estimados». Medidos hoy con la herramienta del propio
contrato (`testsQueImportan`, que es lo que usa el candado) y contrastados con `grep`:

| fichero | dice el `porque` | mide `testsQueImportan` | `grep -l` |
|---|---|---|---|
| `narrative-state.ts` | DIECIOCHO | **18** ✅ | 18 |
| `session-storage.ts` | diecisiete | **16** ❌ | 16 |
| `npc-records.ts` | ni un test | **0** ✅ | 0 |
| `types.ts` | ONCE | **10** ❌ | 12 (incluye citas en comentario) |

Reproducción: `node --import tsx -e '…testsQueImportan(["src/narrative/session-storage.ts"]).length'` → 16.
No cambia ninguna decisión (16 ó 17 ficheros de batería por mutante es igual de caro), pero
es un número escrito bajo el rótulo «medido» que hoy no sale.

### H3 · MENOR — el motivo de excluir `npc-records.ts` no se sostiene con la configuración de este repo

El `porque` dice: *«no lo importa NI UN test: hoy solo daría `NoCoverage`, que es deuda de
cobertura y no medida de mutación»*.

- `stryker.config.json:6` → `"coverageAnalysis": "off"`. Con `off`, Stryker corre la batería
  entera para **cada** mutante y no calcula cobertura por mutante: **no hay estado `NoCoverage`**.
  Coherente con la huella: `grep -o NoCoverage mutacion-huella.json` → cero.
- Y sí se carga: `src/narrative/narrative-state.ts:33` importa `registerSceneNpcs`, y el cierre
  de imports de `test/narrative-state.test.ts` —que es **la batería del módulo que declara la
  exclusión**— contiene `src/narrative/npc-records.ts`.

O sea: sus mutantes se **ejecutarían** y saldrían casi todos **SUPERVIVIENTES**, no sin cubrir.
La decisión (excluirlo; lo que le falta es un test, no un mutante) sigue siendo la correcta —
y de hecho sale reforzada—, pero la razón escrita es falsa y es la que quedará.

### H4 · MENOR — `:84` está rotulado «equivalente» cuando es «inalcanzable bajo el tipo»

El cuerpo del `porque` lo dice bien («matarlo exigiría construir `{de:"runtime", key}` — justo
el estado que el tipo hace inexpresable»), pero la etiqueta es más fuerte que el hecho.
**Se puede matar**, y lo maté:

```ts
const imposible = { de: "runtime", key: "tile:0,0" } as unknown as DuenoDeEntity;
assert.equal(esDeEsteTile(imposible, "tile:0,0"), false);
```
→ verde sin mutante, `not ok` con `:84` aplicado. (Fichero temporal, borrado.)

**No pido que se escriba ese test** — sería exactamente el «verde que no comprueba nada» que
el repo persigue: un cast para inventar un estado que ningún productor puede construir
(verificados los ocho: literales, sin spread, sin JSON). La corrección es de palabra:
`inalcanzable bajo el tipo` en vez de `equivalente`, porque la diferencia importa el día que
alguien afloje `DuenoDeEntity`.

### H5 · MENOR — el mecanismo que B3 estrena cuelga de código sin un solo test

El punto de B3 es que la corrida imprima el número que hay que copiar al contrato
(`mutate.ts:263-271`, bloque `SIN SUELO`). Ese número es `Math.floor(r.score)`, y `score`/`vivos`
salen de `resumenDeMutantes` y `esVivo` (`mutation-plan.ts`), que **no los nombra ni un test**:

```
resumenDeMutantes  tests que lo nombran: 0
esVivo             tests que lo nombran: 0
```

`configDe` acaba de dejar de estar en esa lista (y ese era el hallazgo bueno del ingeniero);
el número que el contrato va a heredar, no. `scripts/` está además fuera del perímetro de
mutación, así que tampoco lo mide nada por debajo. No es un defecto de esta PR —la deuda ya
estaba—, pero es la pieza de la que ahora depende el cierre de siete suelos.

### H6 · MENOR (proceso) — la batería que se citó no es la batería que ejerce el módulo

El informe dice que corrió «los seis guiones que ejercen estos símbolos de punta a punta» y
que «el resto de guiones no toca estos símbolos». Los seis (24, 27, 46, 47, 67, 69) ejercen
**solo la mitad `status-motivo`**. La mitad `status-rotulo` —titular, `SalidaDelOverlay`,
`DETALLE_POR_DEFECTO`— la ejerce de punta a punta el **guion 20**
(`muro.titulo === "La partida no pudo empezar"` + la salida del muro), y el **56** afirma
titular y cuerpo de un fallo a mitad de partida. Ninguno de los dos se corrió.

No hay daño: corrí los 69 y salen verdes. Pero la frase «el resto no toca estos símbolos» es
falsa, y con el corte de un módulo que decide texto de pantalla la batería entera es barata
(unos 8 minutos, cero créditos) frente a elegir seis.

### H7 · MENOR — hueco encontrado y cerrado: la rama `salida: "cerrar"` no la medía nadie

`rotuloDeStatus` decide con qué botón sale el jugador del muro. El guion 20 mide la rama
`mundoVacio` (sin mundo detrás: «Volver al título» y **no** «Cerrar»). La otra rama —la de
todos los días: hay partida detrás, así que la salida es «Cerrar», y cerrar devuelve al
juego— **no la afirmaba ningún guion**. Un muro que ofreciera «Volver al título» con el mundo
pintado detrás le costaría al jugador su sesión en un click, y hoy salía verde.

Lo he cerrado con **`qa/guiones/71-un-fallo-con-partida-detras-se-cierra.mjs`** (+ su fila en
`qa/README.md`). Ver §5.

---

## 3. Workarounds usados, y su veredicto

| Workaround | Por qué | Veredicto |
|---|---|---|
| Copié `node_modules` de `nefan-core`, `nefan-html`, `qa` y `narrative-mcp` (345 MB) y `nefan-html/public/sprites/` (28 MB) del checkout principal al worktree | El worktree desprendido nace sin ellos y están gitignorados; sin las hojas la batería sale roja por algo que no es del cambio | **No es hallazgo.** El jugador no clona un worktree desprendido, y lo que un clon limpio ve ya lo mide el guion 27, que está verde. Declarado: los dejo puestos |
| Apliqué 16 mutantes en `src/session/entidades-del-tile.ts` y `src/scene/scene-normalize.ts`, y sustituí dos ficheros de test por su versión de `af336af` | Es el método que pide el criterio: aplicar, ver el rojo, revertir | **No es hallazgo.** Cada caso revierte con `git checkout --` dentro del propio arnés; `git status` limpio al terminar |
| Rompí a mano el contrato y `mutation-plan.ts` en ocho variantes para ver los candados rojos | «Un candado hay que verlo rojo» | **No es hallazgo.** Restaurado tras cada caso; `git status` limpio |
| Añadí `"inventado_por_qa"` al `kind` de `messages.ts` y clavé `salida` a `"volver-al-titulo"` en `status-rotulo.ts` | Negativos del candado de exhaustividad y del guion 71 | **No es hallazgo.** Los dos restaurados (`git checkout --`), verificado con `sed -n '120p'` y `git status` |
| Creé y borré `test/zz-qa-kill84.test.ts` y `src/narrative/zz-qa-nuevo.ts` | Matar `:84` con cast; provocar el huérfano de mañana | **No es hallazgo.** Los dos borrados |

Al cerrar, el árbol solo tiene lo mío: `M qa/README.md` y `?? qa/guiones/71-…mjs`. **No arreglé nada.**

---

## 4. No probado, y por qué

| Qué | Por qué |
|---|---|
| El **score** de `entidades-del-tile` (121 mutantes) y `scene-normalize` (313) — criterio 1 del usuario | Los dos pasan del `tope_local` de 120 y `local` los rechaza. Además hay una corrida del usuario en vuelo (`33866958770`) y tengo prohibido lanzar mutación de cualquier clase. La aritmética esperada (2 y 4 vivos → 98,3 % y 98,7 %) es **predicción**, no medida |
| El **suelo real** de los nueve módulos nuevos — criterio 2 | Una primera medida no puede ser local (`permisoLocal` rechaza el coste desconocido). Solo la corrida posterior al merge |
| Si cada mitad de #383a cabe bajo 120 | Mismo motivo. La estimación por líneas (~85 y ~77) es del ingeniero y no la puedo contrastar |
| Si `contrato-escena` deja informe — criterio 4 | Es de la corrida y del carril A |
| #381 y #420 | Carril A. No los he mirado |
| Que el bloque `SIN SUELO` de `mutate.ts` imprima el número correcto | Solo se ejecuta dentro de una corrida (H5) |

---

## 5. El guion que dejo

**`qa/guiones/71-un-fallo-con-partida-detras-se-cierra.mjs`** (+ fila en `qa/README.md`).

Mide la rama de `SalidaDelOverlay` que nadie medía y, de paso, el único sitio donde las dos
mitades del módulo partido vuelven a encontrarse en ejecución (`main.ts`, que le pasa a
`setLoaderState` el titular, el detalle y la salida del **mismo** rótulo).

Se llega al estado **sin trucar nada**, con la técnica del guion 56: `chmod 0500` sobre el
directorio del save y contestar al tabernero, que es el turno que dispara `save()`. El permiso
se devuelve siempre.

En verde hoy:

```
▶ 71-un-fallo-con-partida-detras-se-cierra
    mundo antes del fallo: {"tiles":1,"escena":true}
    ✔ hay mundo pintado detrás (si no, la rama bajo prueba no es esta)
    muro: {"titulo":"No se pudo guardar la partida","detalle":"Lo que acaba de pasar en esta
           conversación podría faltar si reanudas.","volverVisible":false,"cerrarVisible":true}
    ✔ el muro trae TITULAR (mitad `status-rotulo`) y CUERPO (mitad `status-motivo`), y no son el mismo texto
    ✔ …y el cuerpo sigue en idioma de jugador, sin el volcado de quien programa
    ✔ con la partida pintada detrás el muro ofrece CERRAR
    ✔ …y NO «Volver al título», que aquí le costaría la sesión en un click
    ✔ cerrar devuelve al JUEGO: el mismo mundo sigue pintado detrás, no el título
```

**PROBADO EN NEGATIVO** (clavando `salida` a `"volver-al-titulo"` en `status-rotulo.ts:120`):

```
✔ 20-el-mundo-vacio-tiene-salida          ← la otra rama sigue VERDE con el defecto puesto
✘ 71-un-fallo-con-partida-detras-se-cierra
    · con la partida pintada detrás el muro ofrece CERRAR — …"volverVisible":true,"cerrarVisible":false
    · …y NO «Volver al título», que aquí le costaría la sesión en un click — …
```

El reparto es exacto: caen los dos asertos de la salida y ninguno más, y el 20 —que mide la
rama contraria— no se entera. Eso es la prueba de que el hueco existía. Fuente restaurada.

---

## 6. Veredicto

**APTO CON RESERVAS.**

Los tres commits hacen lo que se les pidió y **todo lo verificable sin corrida está
verificado**: los catorce mutantes mueren y —lo que el informe no comprobaba— **sobrevivían
con los tests de antes**; el corte de `status-labels` no movió ni una de sus 142 líneas de
código ni uno de sus 79 textos, y la batería **entera** (69/69) sigue verde en el juego real
con cero créditos; los cuatro candados de B3 los he visto rojos, más cuatro casos
adversariales que también lo están, y el candado que el repo *creía* tener (`configDe`) no lo
tenía y ahora sí. Ningún umbral subido: `tope_local` intacto y el único `break` que se mueve
sube. La desviación de `client-file-size.json` es exactamente lo declarado: dos líneas de
`import` y cero lógica.

Las reservas, por orden:

1. **H1** — hay una frase commiteada en el contrato que afirma tres issues que no existen.
   Es lo único que pediría corregir **antes** del merge (una línea, del coordinador o del
   ingeniero: nombrarlos o decir que están por abrir).
2. **Criterios 1 y 2 del usuario siguen ABIERTOS** y no los puede cerrar este carril: dos
   módulos por debajo de su suelo y siete sin suelo hasta la corrida posterior al merge. Es
   exactamente lo que el plan predijo y el informe lo declara sin fingir un score, que es la
   conducta correcta — pero la tanda **no está cerrada** hasta que esa corrida vuelva y sus
   números se commiteen.
3. **H2, H3, H4** — tres razones escritas en el contrato que no reproducen (dos números y un
   mecanismo). No cambian ninguna decisión; sí serán la documentación de dentro de dos meses.
4. **H5** — el número que esas siete líneas van a heredar lo calcula código sin un solo test.
   Merece issue, no bloqueo.

Nada de esto lo ve el jugador: la única parte del carril que llega a su pantalla —los rótulos
del título y del muro— está intacta al carácter, medida en el juego real y ahora con un guion
más que la sujeta por el lado que le faltaba.
