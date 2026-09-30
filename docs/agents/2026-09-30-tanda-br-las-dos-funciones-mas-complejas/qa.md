# QA — Tanda BR: el router del asset-store, derivado de `AssetStoreApi`

Rama `feature/tanda-br` (7377a91a + 8100212e sobre `main` 0afb76c3). Criterios tomados de la sección **reencuadrada** de `requisitos.md`, que manda.

## Qué se probó y cómo

- **Paridad del cable, base contra rama, con servidores reales.** Monté dos worktrees temporales en el scratchpad (0afb76c3 y 8100212e) y arranqué `services/asset-store/server.ts` en cada uno, con `NEFAN_PORT_OFFSET` 3100 y 3200 (puertos 11867 y 11967, antes libres), índices de usar y tirar (`NEFAN_MANIFEST_DB`), blobs sembrados idénticos (superficies, hero, frame de sheet) y un world-state falso en 12978/13078 para que el prune contestara 200. Les mandé en el mismo orden **122 peticiones crudas** (`node:http`, path sin normalizar): las 13 rutas, con registros, pins, unpins, prune, estilos de 3 y 4 segmentos, y las rarezas (`//` interior y exterior, barra final, `..` y `%2e%2e`, `%2F`, `%E0`, `HEAD`/`PUT`/`PATCH`/`FOO`, mayúsculas, cuerpo >256 KiB, JSON inválido, cuerpo vacío). Comparé status, **todas** las cabeceras menos Date/Connection, y el cuerpo (con sha1 para las imágenes; sin timestamps, y con el puerto normalizado en el texto del 503). **Resultado: `diff` vacío, IDÉNTICO en las 122; 47 de ellas son 200.** Una primera tanda de 119 contra el world-state caído dio también idéntico (prune 503 con el mismo texto). El **estado de la base de datos** que dejan las dos (tablas `assets`, `pins`, `meta`, y qué filas se tocaron en `last_used`) también es idéntico.
- **Motor falso del bench** (`labs/narrative/fake-ai-server.ts`, que usa `matchStylesRoute`), arrancado desde los dos árboles: 63 peticiones (20 URL de estilos × GET/POST/HEAD), IDÉNTICO.
- **Flujo real del usuario:** `node qa/run.mjs portadas` (preset `e2e-sin-creditos`) desde el árbol de la rama: el guion 26 salió en verde, con las cuatro portadas del selector de mundos servidas por el fake a 1536 px y el registro de errores vacío. Revisé la captura `02-portadas-del-bench-pintadas.png`: las cuatro tarjetas pintan su portada y ninguna sale con marca de avería.
- **State API:** enumeré por programa todos los pares de plantillas del mismo método y la misma longitud que pueden casar la misma URL. En `WorldStateApi` (30 endpoints) hay **0 pares**, así que el cambio de precedencia de `matchRoute` no puede cambiar ninguna respuesta del State API. En `AssetStoreApi` (13) hay **1**, el esperado: `getBlob` frente a `getSpriteHero`.
- `npm run verify` en el worktree de la rama: **3887/3887**, exit 0. `npm run crap -- --check`: dentro de umbrales. `handle` ya no aparece entre los que pasan del objetivo, que siguen siendo 5 por encima de 30 (antes 6), y el peor es `formatDToWorld` con 43,0.

## Criterios

| Criterio | Estado | Evidencia |
|---|---|---|
| R1 · `POST /assets/pin` probado por HTTP, éxito y 400 | ✅ | Hay un describe nuevo en `test/asset-store.test.ts` (200 + `pinnedHashes`, 400 del zod, 500 si el JSON es inválido, y el pin sobrevive al prune de punta a punta). Sabotaje «pin sin `db.pin`» → 2 rojos (lo repetí yo, M6). En vivo, un ref con `:`, `ñ`, espacio y `/` va y vuelve (pin → unpin con `encodeURIComponent`, `removed:1`) en los dos servidores |
| R2 · el router se deriva de `AssetStoreApi`: un endpoint sin handler no compila | ✅ | Lo repetí con tsc: un endpoint `otra` en el contrato → `TS2741 Property 'otra' is missing` |
| R2 · un handler sin endpoint no compila | ✅ | Handler `sobrante` → `TS2353`. Quitar `health` → `TS2353` / falta la clave. `services/**` está en el `include` del tsconfig de build, así que corre en `verify` |
| R2 · `/health` entra en el contrato | ✅ | `health` está en `AssetStoreApi` y `AssetStoreHealthResponse` se ha mudado al contrato |
| R2 · fricción `sprite_hero` frente a `/cache/{kind}/{hash}`, sin cambiar el wire | ✅ | La sonda da idéntico en `/cache/sprite_hero/<16hex>` → 200, `/cache//sprite_hero/…` → 200, `/cache/sprite_sheet/<h>` → 400 «Invalid kind» y `/cache/SPRITE_HERO/x` → 400. Sabotajes de `matchRoute`: regla vieja → 4 rojos, `<` → 5, sin `literales++` → 5, empate con `>=` → 1 |
| R2 · fricción `/styles/{id}/{file}` con subcarpeta | ✅ | Idéntico en 3 y 4 segmentos, 404 con 5, `//` interior, barra final, `%2F` → 400. Sabotajes: la subtabla del fake sin `getStyleRoleFile` → 1 rojo; `ficheroDeEstilo` sin rol → 2 rojos |
| R2 · fricción `decodeURIComponent` del unpin | ✅ | Idéntico con `a%2Fb%25c` → `a/b%c`, `caf%C3%A9`, `%20` y `%E0` → 500 «URI malformed» (rareza conservada). Sabotaje «sin decode» → 4 rojos |
| Ningún cambio de status ni de cuerpo en ninguna ruta | ✅ | 122 + 119 peticiones al store y 63 al fake: diff vacío en status, cabeceras y cuerpo, y la BD queda igual |
| El fake del bench (`matchStylesRoute`) casa igual | ✅ | 63/63 idénticas. El guion **310** lo vuelve a medir contra los dos procesos |
| `matchRoute` del State API sin regresión | ✅ | 0 pares ambiguos en `WorldStateApi`: el cambio es inerte por construcción. `state-http-dispatch` y `state-http-contract` en verde (112 tests en los 4 ficheros afectados) |
| `handle` < 30 como consecuencia | ✅ | `handle` 3,0 (lo mide el ingeniero; en mi pasada de `crap` ya no está en la lista de los que pasan del objetivo) |
| `npm run verify` verde | ✅ | 3887/3887, corrido por mí en `/home/al/code/ne-fan-tanda-br/nefan-core` |
| Mutación: no dejar vivo un mutante que hoy muere | ⚠️ | `asset-store-contrato`: 9/9 antes y después (lo dice el ingeniero; no lo repetí). `state-http-dispatch` (139 > tope 120) **no se ha medido**: está pedida en el trailer |

## Pasada adversarial sobre los candados que el ingeniero dice haber roto

Repetí cada sabotaje sobre un worktree temporal y corrí los 4 ficheros de test afectados. Salvo M7, todos se pusieron rojos:

| Sabotaje | Resultado |
|---|---|
| M1 `matchRoute` con la regla vieja | 4 rojos |
| M2 empate: gana la última (`>=`) | 1 rojo |
| M3 sin `literales++` | 5 rojos |
| M4 gana la menos específica (`<`) | 5 rojos |
| M5 unpin sin `decodeURIComponent` | 4 rojos |
| M6 pin sin `db.pin` | 2 rojos |
| **M7 `getBlob` sin `db.touch`** | **0 rojos. Agujero, que ya existía en 0afb76c3 (medido: también verde allí)** |
| M8 `by_hash` sin `db.touch` | 1 rojo |
| M9 `casarRuta` sin la regla literal | 2 rojos |
| M10 la subtabla de estilos sin `getStyleRoleFile` | 1 rojo |
| M11 `ficheroDeEstilo` ignora el rol | 2 rojos |
| M12 `rutaDePartes` sin colapsar | 28 rojos |
| T1–T3 tsc (falta handler, sobra handler, endpoint nuevo) | los tres fallan en tsc |
| **T4/T5 un handler lee un `{param}` que la plantilla no declara, o se renombra el param en el contrato** | **tsc en verde. Los tests HTTP sí lo cazan (2 rojos)** |

## Hallazgos

Ninguno bloqueante ni importante.

**Menores**
1. **El `db.touch` de `GET /cache/{kind}/{hash}` no tiene test**, y ya no lo tenía en la base. Es lo que refresca el LRU del prune para el arte pagado que se está usando. Reproducción: borrar `if (result.touched) db.touch(result.touched);` de `services/asset-store/rutas.ts` y correr `node --import tsx --test test/asset-store.test.ts`: sale verde. No es una regresión de BR. Queda declarado como agujero A1 en el guion 310.
2. **La garantía de tipos no cubre los nombres de los parámetros.** `AssetRouteRequest.params` es `Record<string,string>`, así que un handler que lee `params.hash` donde la plantilla dice `{key}` compila. El requisito pedía «endpoint sin handler / handler sin endpoint», y eso sí se cumple; esto es el siguiente escalón. Hoy lo cazan los tests HTTP. Queda declarado como agujero A2 en el guion 310.
3. **Riesgo latente en `casarRuta`.** Cuando la mejor plantilla es literal y el path traía `//`, devuelve `null` en vez de probar la siguiente candidata. Con la tabla de hoy no tiene efecto (no hay ningún par literal/param del mismo método y longitud), pero una ruta literal futura que se solape con una de parámetros heredaría un 404 inesperado.
4. **El docblock de `matchRoute` pone un ejemplo que no existe:** «`/npcs/in_transit` antes que `/npcs/{id}`». La ruta real es `/npc/{id}`, que no compite con esa. Es prosa anterior que BR mantiene.
5. **Fuera de alcance, lo anoto por cercanía:** `nefan-html/src/ui/style-apply.ts:478-483` hace el `DELETE /assets/pin/{ref}` con `.catch(() => undefined)`. Es un catch mudo en el camino del pin, contra la convención de fallo ruidoso (fail-loud). Viene de antes.

## Workarounds usados

- **Worktrees temporales** con `node_modules` enlazado desde la rama. Son para medir la base, no para saltarse ningún obstáculo del usuario. **Sin efecto.**
- **Puertos por `NEFAN_ASSET_STORE_PORT`**, porque `server.ts` no aplica `NEFAN_PORT_OFFSET` a su puerto. Es un ajuste de entorno del bench, y un servidor arrancado a mano en la máquina del jugador no lo necesita. **Sin efecto.**
- **Sprites del cliente y `qa/node_modules`** copiados o enlazados desde el checkout principal para que `qa/run.mjs` pudiera correr. Viene de `.gitignore` y el propio runner da esa receta. **Sin efecto sobre la tanda.** Con los sprites puestos, `qa/fake-enruta-por-pathname.mjs` sale **VERDE** (3/3): el rojo que anotó el ingeniero era del entorno, como él decía.

## No probado

- **Mutación de `state-http-dispatch` tras la regla nueva:** 139 mutantes contra un tope local de 120, y la corrida autorizada está pendiente. Como mitigación, los 4 sabotajes a mano del matcher (M1–M4) se pusieron rojos.
- `mutacion local asset-store-contrato`: no lo repetí (lo aporta el ingeniero, 9/9 antes y después).
- Prune de verdad con el techo por encima de lo que hay (evicción real): cubierto por el test de punta a punta del ingeniero, no por mi sonda, porque `cache_max_bytes` viene de CONFIG y no se puede cambiar por entorno.

## Guion

`qa/guiones/310-el-fake-y-el-store-sirven-los-estilos-igual.mjs` (con `sinNavegador` y `sinMotor`, así que entra en `node qa/run.mjs --sin-navegador`; ~6 s). Hace esto:
- Arranca el asset-store real y el fake en puertos libres.
- Compara 28 URL servidas (portada, `style.json` y un fichero de cada carpeta de rol de cada pack, más las rarezas) y 4 sin ruta.
- **Sabotaje:** quita `getStyleRoleFile` de la subtabla del fake. La paridad se pone roja en las 17 URL de rol y solo en ellas.
- **Agujeros conocidos A1 y A2**, con un control de que el tsc sí mide.
- Toma el turno de candados, se niega a arrancar sobre un árbol sucio y restaura byte a byte.

Salida real: 22 ✔, `1 en verde · 0 en rojo`. **Probado en negativo:** con el fake leyendo `estilo.file.split("/").pop()` sale `✘ store y fake contestan IDÉNTICO …` (17 URL de rol en 404 en el fake) y `0 en verde · 1 en rojo`. Pasa `lint:qa` y los candados `un-salto-del-guion-se-observa`, `un-numero-un-guion` y `candados-headless-totalidad`.

## Veredicto

**Apto.** Todo lo que pedía la sección reencuadrada se cumple con evidencia medida: no cambia ni un status ni un cuerpo en 122 peticiones (y el fake da lo mismo en 63), la garantía de compilación funciona en las dos direcciones y el State API no puede regresar por construcción. Lo único pendiente es la medida de mutación de `state-http-dispatch`, que no cabe en local y ya está pedida.
