# Crítica — tanda AB (#426) · veredicto: **REENCUADRADA**

El problema es real y pequeño; la solución del issue es más grande que el problema y la mitad de su
enum describe fuentes que **no pueden escribir** en el ledger. Lo que falta es UN campo que el
proveedor ya manda y el adaptador tira.

## El problema real, en una frase

Un evento del ledger no dice si el dólar se facturó, así que un ledger sucio solo se limpia adivinando
por el texto del prompt (`ai_server/tools/archivar_gasto_de_test.py:205-214`, igualdad contra las formas
`hero: …`/`skin …`).

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificación |
|---|---|
| Evento = `{t, usd, what, service}` | ✅ `ai_server/spend_tracker.py:116-119`; los 187 vivos y los 1.429 archivados tienen exactamente esas cuatro claves, todos `service: remote-gen` |
| «Un evento del fake-ai-server, uno de fixture y uno real son indistinguibles en disco» | ❌ **en dos de tres no hay evento**. El fake-ai-server sustituye a ai_server entero y no escribe ledger: su `/dev/status` devuelve `spend: {total_usd: 0, call_count: 0, calls: []}` literal (`labs/narrative/fake-ai-server.ts:552`). El banco (`qa/run.mjs`, preset `e2e-sin-creditos`) **no levanta remote-gen** (`start.sh:819-828`, `qa/lib/stack.mjs:87`). Ninguno de los dos ha producido jamás una línea |
| Llamantes de `SPEND.add` | 4, todos con `"remote-gen"` cableado: `style_pack_builder.py:294`, `surface_atlas_generator.py:431`, `routers/remote_generation.py:760` y `:778`. Los dos primeros hablan con fal/Meshy de VERDAD y no existe ningún fal falso en el árbol (`grep fake|mock|fixture ai_server/*.py routers/*.py` fuera de tests → 0); el cache-hit ya salta el `add` (`:430`). Solo el adaptador de sprite-forge puede recibir dinero de fixture |
| «las fixtures ya saben lo que son … el dato existe en el sitio que llama» | ✅ pero **más arriba** de donde dice: lo declara la RESPUESTA del servicio, no el llamante. `identity.json` trae `api: "fixture"` en la raíz y `skins.json` en `meta.skin.api`; el worker real emite `api: api.name` (sprite-forge `python/sprite_forge_skin/app.py:162,250`). El adaptador lee `ident["cost_usd"]` y **tira `ident["api"]`** (`remote_generation.py:759-760`, `:777-778`) |
| Guardia de #392 como molde | ✅ `spend_tracker.py:98-108`, por FORMA `…/cache/spend`; 5 tests en `test_spend_tracker.py:79-118`; guion headless en CI (`ci.yml:315`) |
| 187 eventos / $37,54, «4 de prompt `x`» | 187 / $37,54 ✅ (2026-08-11 → 09-01, sin cambios desde 09-04 11:07). **Los 4 `x` no están**: 0 eventos con `what` ≤ 3 caracteres en vivo ni en archivo. El techo que cita ya no existe |
| 1.616 falsos en `archivo/` | ✅ `archivo/cache/spend/`: 1.189 (fixture retirada, $673,44) + 240 (test, $57,60) = 1.429 = 1.616 − 187 |

## ¿Procedencia del EVENTO o del PROCESO?

Del **evento, pero solo la que dice el proveedor**. Hoy todo escritor del ledger real es remote-gen en
modo producción; la procedencia de proceso (`unittest` → temporal) ya está candada por #392. El único
agujero vivo es remote-gen **fuera de `unittest`** hablando con un forge que devuelva fixtures: los dos
guiones que apuntan el adaptador a un forge propio (`qa/sprites-sin-servicio.mjs:178`,
`qa/perfil-de-repintado-en-la-clave.mjs:110`) corren SIN `NEFAN_SPEND_DIR` y sin `unittest`, o sea
construyen `SPEND` sobre el ledger real; hoy no llegan a `add` (`--sin-skin`, `/sheets format=none`,
caché o 503), pero el guardia de proceso **no los cubre**, y el proceso no puede saber si el forge de
enfrente es real. La respuesta sí lo sabe. Por eso el campo va en el evento y sale de `api`, no de un
argumento que el llamante rellena a mano: en los dos llamantes de fal/Meshy ese argumento sería una
constante `real` — una declaración que no puede ser falsa no es un candado.

## El día después

- **Para quien juega: nada.** Es el panel de dev (`nefan-html/src/ui/dev-status-panel.ts:132-150`). Deuda declarada, vale.
- **Se toca más de un fichero Python**: `calls[]` de `/dev/status` cambia de forma → `nefan-core/src/contracts/remote-gen.ts:197-240` y la copia del fake (`fake-ai-server.ts:552`) tienen que decir lo mismo, o el contrato tiene dos formas.
- **Lo que debería morir y nadie borrará**: `archivar_gasto_de_test.py` (la arqueología que el issue quiere jubilar) y el paso 6 de `qa/el-ledger-de-gasto-no-lo-escribe-la-suite.mjs:37-43`, que lo candan. Si la procedencia entra, la herramienta por texto deja de tener razón de ser para eventos nuevos; hay que decidir si se archiva con los 187.
- **Arbitrario dentro de un mes**: un enum con `fake-ai-server` y `banco` que ningún código escribe. No debe existir.
- **Los 187 sin campo**: `_events()` es parse estricto (`spend_tracker.py:129-138`); un `total_usd()` «real» tiene que decidir qué hace con un evento sin campo. Pre-producción: archivar como en T9 es coherente con la casa (nunca borrar, `archivo/cache/spend/`), y deja el ledger con **cero** líneas legado en vez de una rama `desconocida` para siempre.

## Conflictos

Ninguno directo en los 37 abiertos. Roces: #683 (dónde vive material headless de QA) si QA añade guion; el
guion de #392 vive fuera de `qa/guiones/`, así que #680 (numeración) no aplica. `git log`: nada toca
`spend_tracker.py` desde `1f472c7b` (09-04). `manifest-kinds-con-productor.ts:67` lista `spend` como
kind del store — otra cosa, no se toca.

## Coste contra valor

**No hacer nada** es defendible: desde #392 el ledger real no ha recibido ni una línea de fixture y el
único camino de fuga (remote-gen fuera de `unittest` contra un forge de fixtures) no existe en el árbol.
Pero el coste de la versión reencuadrada es bajo —propagar un campo que ya llega, filtrar por él y
archivar 187 líneas— y el valor es que la PRÓXIMA fuga se filtra en un `jq` en vez de repetir T9.
La versión del issue (enum de cuatro, argumento obligatorio en los cuatro llamantes, `banco` y
`fake-ai-server` como valores) paga por tres fuentes que no escriben y candará una constante. **Lo que
NO debe hacerse**: inventar valores sin escritor; hacer que fal/Meshy «declaren» `real` a mano; migrar
los 187 por script mudo.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Reencuadre (crítico, 2026-09-18).** La procedencia la dice el PROVEEDOR, no el proceso ni el
> llamante: sprite-forge ya emite `api` (`"fixture"` en las fixtures canónicas; el nombre del proveedor
> en la respuesta real) y `remote_generation.py:759-778` lo tira. fal/Meshy no tienen doble falso en el
> árbol: su evento es real por construcción. El fake-ai-server y el banco **no escriben el ledger**
> (`fake-ai-server.ts:552`; `e2e-sin-creditos` no levanta remote-gen).
>
> Criterios corregidos:
> 1. Todo evento nuevo lleva procedencia obligatoria, con un conjunto CERRADO de valores **que tengan
>    escritor** (hoy dos: real / fixture; ni `banco` ni `fake-ai-server`). En el adaptador de
>    sprite-forge la procedencia sale de `api` de la respuesta, nunca de un literal.
> 2. `total_usd()` y `/dev/status` dan el gasto real sin mirar `what`; `calls[]` lleva el campo y el
>    contrato TS (`remote-gen.ts:197-240`) y la copia del fake (`fake-ai-server.ts:552`) lo reflejan.
> 3. Censo de llamantes por el árbol (`ast`): los cuatro de hoy, y que un `add` nuevo sin procedencia
>    falle al escribir.
> 4. Los 187 eventos sin campo se ARCHIVAN como en T9 (`archivo/cache/spend/`), no se migran ni se
>    marcan `desconocida`; el arquitecto dice qué pasa con `archivar_gasto_de_test.py` y el paso 6 de
>    `qa/el-ledger-de-gasto-no-lo-escribe-la-suite.mjs` (se jubilan o se declaran solo-legado).
> 5. Candado en negativo: un forge de mentira con `api: "fixture"` fuera de `unittest` y sin
>    `NEFAN_SPEND_DIR` no suma al gasto real (hoy el guardia de proceso no cubre ese camino).
>
> Retirar de «El issue» los «4 eventos de prompt `x`»: no existen en el ledger vivo.
