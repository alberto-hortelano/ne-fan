**#751: REENCUADRADA · #746: VIGENTE**

## El problema real, en una frase
- #751: un test de `asset-store-contrato` da por hecho que un puerto que acaba de soltar seguirá libre, y cuando otro lo ocupa (el propio proceso u otra batería) falla. `ejercicio` no deja ver el fallo porque recorta el TAP a los últimos 2000 caracteres.
- #746: la espera del bloque 4 del guion 89 se cumple sin que llegue ningún frame, así que un rojo ahí señalaría a los aros en vez de a los frames que faltan.

## La premisa, afirmación por afirmación
**#751**
1. *«El TAP terminaba en `# fail 1`, pero ninguna línea decía `not ok`»*: **FALSA en su lectura.** He leído el log del intento 1 (`gh api …/jobs/107656772195/logs`). Lo que se ve empieza a mitad del test de nivel superior 13, y el TAP tiene 15. `ejercicio-de-bateria.ts:237` imprime `stdout.slice(-2000)`, así que el `not ok` estaba ANTES del corte. No es un fallo de fichero, ni un hook, ni una suite que lanza: es un test normal que falla.
2. *«Falla a veces con `--test-isolation=none`»*: **el aislamiento no tiene nada que ver.** El stderr del intento rojo trae la huella del fallo: `asset-store prune: keep-list no disponible (world-state contestó HTTP 404)`. En un intento verde del mismo job (línea 668) y en local sale `world-state inalcanzable … (fetch failed)`. Esa línea solo la emite el caso `world-state caído → la causa dice inalcanzable, y el 503 del prune la lleva` (`test/asset-store.test.ts:776-809`):
   - abre un servidor en el puerto 0, lo cierra y da por hecho que ahí «nadie escucha» (`:777`);
   - luego levanta `srv2` **también en el puerto 0** (`:790`).
   Si el kernel le da a `srv2` el puerto recién soltado, o si otra batería lo coge, el prune se contesta a sí mismo o a un desconocido y recibe 404. El 503 dice entonces «contestó HTTP 404» y `:803` (`includes("inalcanzable")`) falla. Ese test está en el nivel superior 10 («prune LRU con keep-list»), fuera de la cola de 2000 caracteres.
   **Reproducido de forma determinista**: con `srv2` sobre el puerto de `muerto` (`scratchpad/repro.ts`) salen la misma línea de log, exacta, y `503 keep-list unavailable (world-state contestó HTTP 404)`.
   **La carrera natural NO la he reproducido**:
   - 20 corridas en serie: 0 rojos;
   - 48 corridas a concurrencia 16: 0 rojos;
   - 768 corridas a concurrencia 4 con dos `npm run ejercicio` completos en paralelo (load average 6,5): 0 rojos y 0 «HTTP 404».
   Cuadra con una ventana de milisegundos y unos ~14k puertos candidatos. Es raro, pero existe, y CI corre esta batería en `npm test`, `coverage`, `ejercicio` y el dry run de mutación.
3. *«`ejercicio` solo imprime la cola del TAP»*: **CIERTA** (`ejercicio-de-bateria.ts:237`).
4. *«Relacionado con #697/#749: una suite que lanza se cuenta en el EXIT y no en `not ok`»*: **al revés en el Node de HOY.** Medido con v26.10 y los `node_args` del plan: un `describe` que lanza da `not ok 1 - s`, **`# fail 0`** y EXIT 1. `ejercicio` decide por el EXIT (`:231`), así que decide bien. Lo que miente es el contador del resumen, y por eso la cola no sirve ni aunque fuera más larga.

**#746**: **CIERTA.**
- `qa/guiones/89-…mjs:92` crea `ultimoOriginal: null`.
- `:118` lo llena en cada `state_update`.
- `:354` quita la reescritura y no lo limpia.
- `:359` espera `ultimoOriginal ? true : null`, que ya se cumplía desde el bloque 1.
- `vistos` (`:117`) existe y nadie lo lee después. La propuesta del issue ataca justo eso.

## El día después
- Para quien juega: nada. Es deuda del banco, declarada y barata.
- Un rojo de `ejercicio` dirá **qué test** cayó y con qué error. El test del «world-state caído» será determinista, y dejará de ser una fuente de rojos intermitentes en cinco entradas de CI (y de dry runs de mutación abortados).
- No debe quedar: ni un reintento automático de baterías, ni un `--test-isolation` distinto, ni un cambio de los `node_args` del plan. Ninguno toca la causa, y los `node_args` van en pareja con la mutación (`mutation-targets.json`, `correEnElMismoProceso`).

## Conflictos
- **#725** (solapamiento parcial): tiene una línea «`scripts/ejercicio-de-bateria.ts`: comprobar cómo decide». Queda contestada con la medida de arriba: decide por el EXIT, que en v26 es correcto. Se puede anotar en #725 desde esta tanda. El resto de #725 (reporter en la mutación, censo por árbol) **no** entra aquí.
- **#749** (Node a la última en CI): es la razón de que el formato del resumen pueda cambiar sin avisar. Refuerza que se nombre el fallo por las líneas `not ok` y no por `# fail N`.
- Nada en `arch-rules.json` ni en `CLAUDE.md` choca. Todo vive en `nefan-core/scripts`, `nefan-core/test` y `qa/`.

## Coste contra valor
Coste pequeño: un test, el informe de un script y una espera. Si no se hiciera, la batería seguiría rompiendo CI de PR ajenas de vez en cuando. Cada vez alguien relanzaría a ciegas: no hay nada que diagnosticar en el log, y el mensaje «Arregla `npm test` primero» (`:236`) manda a mirar algo que está verde. Justo hoy ya ha costado un issue con un diagnóstico equivocado. Vale la pena.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

> **Diagnóstico de #751 (crítico, medido).** El `not ok` no faltaba: lo cortaba `stdout.slice(-2000)` (`ejercicio-de-bateria.ts:237`). El test que cae es `world-state caído → …` (`test/asset-store.test.ts:776`). Da por hecho que un puerto recién soltado sigue libre, pero `srv2` (u otro proceso) puede recibir ese mismo puerto y el prune se contesta con 404. Huella en el log rojo: «world-state contestó HTTP 404». Reproducido de forma determinista forzando la colisión. `--test-isolation=none` no tiene nada que ver.
>
> **Criterios de aceptación**
> 1. El caso «world-state caído» deja de depender de que un puerto soltado siga libre. En negativo: forzar la colisión que produce el 404 (reproductor del crítico) no puede poner rojo el test, o ya no se puede escribir.
> 2. Cuando una batería no pasa, `ejercicio` imprime **cada `not ok` con su bloque de error**: nombre del test y mensaje, esté donde esté en el TAP. En negativo, con dos baterías de prueba y el mismo aserto sobre las dos:
>    - una con el test que falla al PRINCIPIO de un TAP de más de 2000 caracteres;
>    - otra con un `describe` que lanza (v26: `not ok` con `# fail 0`).
>    Hoy las dos salen sin nombre.
> 3. `ejercicio` sigue decidiendo por el EXIT del proceso, no por el contador `# fail`. Los `node_args` del plan no se tocan.
> 4. Guion 89, bloque 4: la espera exige un frame visto DESPUÉS de quitar la reescritura. En negativo: si no llega ninguno, el ✘ cae en esa espera y la nombra, no en los aros.
> 5. En #725 se anota la medida sobre `ejercicio` (decide por el EXIT, correcto en v26) sin abrir el resto de ese issue.
> 6. Cero créditos. Lo observable es solo del banco, así que no hace falta guion nuevo: el 89 corregido pasa en local contra `e2e-sin-creditos`.
