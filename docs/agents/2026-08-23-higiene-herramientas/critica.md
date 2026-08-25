# Veredicto: **#212 REENCUADRADA** (se cae la mitad del título) · **#213 OBSOLETA** (se cierra)

Tu medida es correcta y se queda corta: no es que añadir la raíz dé cero violaciones, es que **hoy
no puede dar ninguna** — ninguna regla apunta a `tools/`. Y `dump-config.ts` cuesta 0,34 s.

# #212 — «arch-rules: añadir `tools/**/*.mjs` como raíz de escaneo»

**El problema real**: `tools/render-sprite-sheets/` es código de producción (alimenta las hojas de
sprites del cliente) que **ningún gate mira**: ni fronteras, ni lint, ni CI. La solución propuesta
—una raíz de escaneo— no toca ese problema; la que sí lo toca es una línea de CI.

**La premisa, afirmación por afirmación:**

| Afirmación del issue | Verificación |
|---|---|
| «`tools/` no está en `scan.roots`, así que no lo cubre ni el fail-loud ni `campos-retirados-no-vuelven`» | Cierto el hecho, **falsa la causa**. No lo cubren porque **ninguna de las 17 reglas tiene un glob `files` que case con `tools/**`** (comprobado sobre `git show main:…/arch-rules.json`). La raíz sola escanea 4 ficheros contra **cero reglas aplicables** |
| «medir qué violaciones aparecen y congelar el número» | **Cero, y de dos maneras.** (1) Con la raíz añadida tal cual: 4 ficheros, **0 violaciones** (tu medida, confirmada). (2) Ampliando además los `files` de las tres reglas plausibles (`campos-retirados-no-vuelven` y las dos de `catch` silencioso) a `tools/**/*.mjs`: **también 0**. No hay número que congelar |
| «ojo con `tools/*/node_modules`» | **Ya resuelto**: `scan.ignore` lo incluye y `arch-collect.ts:walk` lo salta por nombre |
| «el CI no corre nada de `tools/`» | **Cierto.** `.github/workflows/ci.yml` tiene 4 jobs (nefan-core, narrative-mcp, nefan-html, ai-server); ninguno entra en `tools/` |

**Y remata**: `arch-collect.ts:loadArchFiles` solo parsea imports de `.ts` (`imports:
abs.endsWith(".ts") ? … : undefined`). Un `.mjs` entra sin grafo, así que las reglas `imports.forbid`
**no pueden** aplicarse ahí ni en el futuro: la raíz solo habilitaría reglas de texto.

**El día después** (con la raíz y nada más): el checker escanea 4 ficheros más sin **comprobar nada
nuevo** — «verde que no comprueba nada», y encima *parece* cobertura en la lista de raíces.

**Conflictos.** Con **#230, medible**: `afectado.ts:61` lista `data/contract/arch-rules.json` entre
los ficheros que **fuerzan la corrida completa** de mutación, «horas de CPU» (`afectado.ts:3`). El
issue más barato de la cola pagaría el gate más caro por cero cobertura. Con **#231** (el CI no tipa
`scripts/` ni `test/`): vecino, no solapado — no hace falta fusionarlos.

**Coste contra valor.** Primera mitad: coste real contra valor medido cero → **no se hace**. Segunda
mitad, el mejor ratio de la cola: `fbx-anim-span.test.mjs` son **6 tests que pasan sin una sola
dependencia npm** (`node:test`, `node:assert` y el `.mjs` local) en **68 ms** — lo ejecuté. Entra en
CI como **una línea** en un job existente. Si no se hace nunca, un parser de FBX binario que decide
el recorte de las animaciones del cliente se sigue verificando cuando alguien se acuerda.

**Qué le cambiarías al issue.** Título nuevo: `CI: los tests de tools/render-sprite-sheets no los corre nadie`. Cuerpo nuevo, pegar tal cual:

> `tools/render-sprite-sheets/fbx-anim-span.test.mjs` son 6 tests del lector de intervalos de FBX
> binario —el que decide dónde empieza y acaba cada clip en las hojas de sprites del cliente— y **el
> CI no los ejecuta**: `.github/workflows/ci.yml` solo tiene jobs de nefan-core, narrative-mcp,
> nefan-html y ai-server. El test no tiene dependencias (`node:test` + `node:assert` + el `.mjs`
> local), pasa en **68 ms** y no necesita `npm ci`: cabe como un `run` más en un job existente.
>
> **Lo que NO hay que hacer** (medido, 2026-08-23): añadir `tools/**/*.mjs` a `scan.roots` de
> `arch-rules.json`. Ninguna de las 17 reglas tiene un glob `files` que case con `tools/**`, así que
> la raíz escanearía 4 ficheros contra cero reglas; ampliando además los `files` de
> `campos-retirados-no-vuelven` y de las dos reglas de `catch` silencioso a `tools/**/*.mjs` el
> resultado también es **0 violaciones**. `arch-collect.ts` solo parsea imports de `.ts`, así que
> `imports.forbid` nunca aplicaría a un `.mjs`. Y tocar `arch-rules.json` fuerza la corrida completa
> de mutación (`afectado.ts:61`, #230): coste alto por cobertura cero.

# #213 — «dump-config.ts se quedó con una sola salida: ¿siguen valiendo tres hooks?»

**El problema real**: ninguno. El issue sospecha de un coste y el coste **no existe**.

**La premisa, afirmación por afirmación:**

| Afirmación | Verificación |
|---|---|
| «cuelga de tres hooks + `start.sh`», «emitía dos ficheros, ahora uno» | **Ciertas**: `nefan-core/package.json:33-35`, `start.sh:163`, y `dump-config.ts` solo escribe `data/runtime_config.json` |
| «medir cuánto cuesta — `tsx` arranca un runtime completo» | **Medido, tres corridas: 0,34 s cada una.** Un `npm run verify` dispara dos (prebuild + pretest) = **0,68 s** sobre build+lint+test completos; en CI, los mismos 0,68 s en un job que ya instala dos `node_modules`. `predev` y `start.sh` no están en ningún bucle de verificación |
| «puede que basten `predev` + `start.sh`» | El ahorro serían esos 0,68 s, a cambio de lo único que mantiene el snapshot en sync |

**El día después** (de quitar los hooks): `runtime_config.json` **está commiteado** (`git ls-files`) y
hoy coincide con `CONFIG` — lo regeneré tres veces y `git status` quedó limpio. No es suerte, es el
hook: cada `npm test` lo reescribe y una divergencia saldría como fichero sucio. En los **20 commits**
que han tocado `src/config.ts` no hay una sola deriva real (los 4 que no llevan el JSON son cambios
de comentario, o el refactor de puertos `c0c8b77`, que movió los valores a `SERVICES` sin cambiar un
número). Quitar `pretest`/`prebuild` retira ese mecanismo para ahorrar 0,68 s.

**Sobre tu candado** (`runtime_config.json` commiteado == `JSON.stringify(CONFIG)`): **cierra un
agujero real y aun así no lo pondría hoy.** El agujero: si alguien edita `config.ts` y se olvida del
`git add` del JSON regenerado, el CI **también** regenera antes de usarlo y pasa verde con el fichero
commiteado obsoleto — nadie compara contra git. Pero son cero ocurrencias en 20 commits, y el candado
sustituye una regeneración automática de 0,34 s por un paso manual (`npm run dump-config`) más un CI
rojo cuando se olvide: peor ergonomía por el mismo resultado. Si algún día se quiere, es un test de
cinco líneas **independiente de #213**, que pide lo contrario.

**Coste contra valor.** No hacer nada: 0,68 s por `verify`, snapshot fresco, cero deriva histórica. Hacerlo: una PR que toca `package.json` para ganar 0,68 s y perder una garantía.

**Texto para cerrar el issue (pegar tal cual):**

> Cerrado tras medirlo, que es lo que pedía el propio issue.
>
> `npx tsx scripts/dump-config.ts` tarda **0,34 s** (tres corridas, idénticas). Un `npm run verify`
> dispara dos (`prebuild` + `pretest`): **0,68 s** sobre build+lint+test completos. `predev` y
> `start.sh` no están en ningún bucle de verificación. El coste es irrelevante.
>
> Y los hooks no son solo coste: `data/runtime_config.json` está commiteado y hoy coincide al byte
> con `CONFIG` porque cada `npm test` lo reescribe. En los 20 últimos commits que tocan
> `src/config.ts` no hay una sola deriva. Quitar `pretest`/`prebuild` retiraría ese mecanismo a
> cambio de 0,68 s.
>
> El candado alternativo (comparar el JSON commiteado con `JSON.stringify(CONFIG)`) cierra un agujero
> real —el CI regenera antes de usar, así que pasaría verde con el fichero commiteado obsoleto— pero
> cambia una regeneración automática por un paso manual más un CI rojo, para un fallo que no ha
> ocurrido nunca. Si alguna vez se quiere, es un issue nuevo y distinto de este.
