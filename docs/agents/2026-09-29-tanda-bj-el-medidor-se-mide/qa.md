# QA — Tanda BJ: el medidor se mide (#769)

Verificado el 2026-09-29 sobre `feature/tanda-bj` @ 51967420, en el worktree `/home/al/code/ne-fan-tanda-bj`, con Node 26.10 (`nvm use node`). No he arreglado nada. Las roturas temporales que hice para probar en negativo se revirtieron con `git checkout -- <fichero>`, y `git status` queda limpio salvo el guion nuevo.

Guion ejecutable: `qa/guiones/230-el-medidor-se-mide-y-el-bridge-arranca-o-lo-dice.mjs` (`sinNavegador`, `sinMotor`). Se corre con `node qa/run.mjs --sin-navegador 230-el-medidor` y necesita antes `npm run coverage` en nefan-core. **Hoy sale ROJO** por los dos hallazgos H1 y H2; los demás asertos salen verdes.

## Criterios

| Criterio (requisitos + decisiones del usuario) | Veredicto | Evidencia |
|---|---|---|
| P1 · el core mide con `"el-arbol"` | ✅ | `crap-score.ts:92`. `npm run crap -- --check` → «EL ÁRBOL ENTERO de src/, bridge/ y services/ · 95.69% de 19547 líneas · sin cargar: 11 de 200 ficheros, 149 líneas». 200 = 156 `src` + 36 `bridge` + 8 `services`, es decir, todos los `.ts` de esos tres árboles. |
| P1 · sin bajar el 95 ni el 73 | ✅ | `quality-thresholds.json` con min 95 y max 73 intactos (diff: solo la nota). Mis medidas: 95,69 % local y 95,55 % en un clon `--depth 1` como el de CI; 0 funciones > 73. |
| P1 · la lógica de `register()` la carga y EJERCE un test | ✅ | `hooks-de-plugins.ts` lo cubren `bridge-hooks-de-plugins.test.ts` (6 tests) y `vocabulary.test.ts`. Pruebas en negativo: con `kind:"plugin"`→`"consequences"` o sin el `narrative_event`, rojo (según el informe del ingeniero; yo repetí las del sello y la conexión, ver abajo). `npm run ejercicio` → «Todas las baterías EJERCEN…». |
| P1 · el candado del universo puede ponerse rojo | ✅ | Guion 230 §1: `bridge/zz-sonda-230.ts` sin cargar, con cx 9 → exit 1, «90.0 sonda230 · bridge/zz-sonda-230.ts». §2: 164 líneas sin cargar en `services/` → «la cobertura de líneas bajó». Guion en negativo: con `universo:"lo-cargado"`, §1 y §2 salen **✘** (status 0). |
| P2 · `--apretar` solo BAJA o QUITA, nunca congela una roja nueva ni sube | ✅ | Guion 230 §3: congelada subida +50 y otra inventada → `--scripts --apretar` deja el fichero **byte a byte** como en git. §4: con una roja delante se niega (exit 1) y no toca el fichero. Guion en negativo: quitando la negativa y la eliminación de `no-esta`, §3 y §4 salen ✘. En nefan-html, `npm run crap -- --apretar` → «✔ nada que apretar: las 45 congeladas siguen en su cifra», sin diff. |
| P2 · los mensajes de `--apretar` llevan a quien los lee al sitio correcto | ❌ menor | **H2**. |
| P3 · `scripts/` tiene su propia `Medida`, `lo-cargado`, suelo en el número de hoy y foto de lo que pasa de 73 | ✅ | `npm run crap -- --scripts --check` → «551 funciones (LO CARGADO de nefan-core/scripts) · 80.38 % · 4 congeladas, 0 por encima · mínimo 80.1 % (margen 0.28 ≈ 11 líneas)». La foto son las 4 del plan. `ci.yml` corre el paso tras el `crap --check` del core. |
| P3 · la mutación de `scripts/` queda fuera | ✅ | `mutation-targets.json` sin `scripts/` (sin cambios); está declarado en `_lo_que_esto_NO_sujeta`. |
| P3 · el suelo de scripts aguanta en CI | ⚠️ no probado | La rama no está empujada y no hay PR. Clon superficial local: 80,40 %. El margen es de **11-12 líneas**. La propia nota pide ajustarlo con la cifra de la PR. |
| (b) el bridge arranca por la entrada nueva en el stack real | ✅ | `NEFAN_PORT_OFFSET=2300 ./start.sh --preset e2e-sin-creditos` → «✅ bridge :12177 (State API :12178)». Log: `State HTTP API listening … 12178`, `Logic Bridge listening … 12177`, `entorno produccion`. `/health` publica `gateway_url ws://127.0.0.1:12177`, `/plugins` → `[]` y `POST /plugins/register` sin sesión → 409 `no_session`. |
| (b) sesión, combate, viaje, plugins, resume, intake y reconexión en el juego real | ✅ | `node qa/run.mjs` con 28 guiones de navegador, **28/28 ✔**: 19, 29, 106 · 41, 42, 89 · 08, 09, 144 · 14, 142, 210, 211, 64, 66, 73 · 17, 48, 49, 54 · 171, 172, 20, 25, 100 · 77, 78, 140. Gasto: solo contra el fake (0 €). En la captura del 14 se ve en pantalla el `ambient_message` «el sistema «commerce» ha cambiado de versión (v1 → v2)…», que sale ahora de `hooks-de-plugins.ts`. |
| (b) reconexión: varios clientes seguidos | ✅ | Tres sockets consecutivos con un cliente `ws` propio. Cada uno recibe `bridge_hello`, `protocolo` (json), `protocolo` (schema) y `pong`, con `sessionId:""`. El log alterna `client connected` y `client disconnected`. |
| (b) cierre limpio con Ctrl+C | ✅ | `kill -INT` al grupo del launcher → «🧹 parando lo que arrancó este launcher…»; los puertos 12177, 12178, 21065 y 5300 quedan libres y no queda ningún proceso del grupo. |
| (b) puertos ocupados | ✅ | Gateway ocupado → exit 1, «el gateway WS no pudo escuchar en :29877: EADDRINUSE». State API ocupado → exit 1, «el State API no pudo escuchar en :29878», y el gateway queda libre. Base d0cc2231: el mismo exit 1, pero con la traza cruda de `events`. Es una mejora y se anunció. Con `start.sh` y el puerto ocupado: «❌ :12278 ocupado — State API NO arranca». Guion 230 §6. |
| (a) los tests nuevos del bridge se ponen rojos si se rompe lo que dicen | ✅ con reservas | Sin `world.release`, sin `suscriptores.delete`, con el entorno fijo en el hello o con el `protocolo` por broadcast → rojo en `bridge-conexion.test.ts`. Con `enviarEstado` sin sello en la fábrica → 2 rojos en `npm test`. Las reservas son **H1** (cuelgue en vez de rojo) y **H4** (`list` sin su tercer argumento sigue verde). |

## Hallazgos

### H1 · importante — dos roturas del arranque cuelgan `npm test` en vez de ponerlo rojo
Pasos (lo reproduce el guion 230 §7):
1. En `nefan-core/bridge/arranque.ts`, desactiva `wss.on("connection", …)`. Es la regresión más probable del refactor: el oyente cambió de sitio.
2. Corre `node --import tsx --test test/bridge-arranque.test.ts`.

Resultado: no termina. Lo dejé 7,5 min y lo maté; el guion lo corta a los 90 s. `primerFrame` espera el primer frame sin plazo, y el WSS vivo mantiene el proceso en pie. Lo mismo pasa si `cerrar()` deja de cerrar el State API: `timeout 120` → exit 124.

El job `nefan-core` de `ci.yml` no tiene `timeout-minutes` (solo `candados-headless` lo tiene). En CI eso sería un runner colgado hasta 6 h en vez de un rojo. El informe dice que `cerrar()` «libera los dos puertos», y es verdad en verde. Lo que no se cumple es que el test «se pone rojo» ante la regresión: se cuelga.

Esperado: rojo en segundos, con el aserto que nombra lo roto (un plazo en `primerFrame` y en `cerrar()`), o un `timeout-minutes` en el job.

### H2 · menor — los mensajes de la medida de scripts recomiendan órdenes del cliente o del core
Pasos: sube a mano una congelada de `scripts-crap.json` y corre `npm run crap -- --scripts` en nefan-core. El aviso dice `` `npm run crap -- --apretar` la baja ``. Esa orden, en nefan-core, sale con 2: «--foto y --apretar son de las medidas con foto: --cliente o --scripts».

Lo mismo en la negativa de `--apretar` (`` `npm run crap -- --check` dice cuáles ``: en nefan-core eso mide el CORE y sale verde) y en la pista de renombrado (`npm run crap -- --foto`). `informeConFoto` y `textoDeApretar` usan el texto del cliente para las dos medidas; el bloque de `deuda` sí dice `--scripts --apretar`.

Esperado: la orden correcta para cada medida. Lo sujeta el guion 230 §5, que hoy sale ROJO.

### H3 · menor, no anunciado — hay una ventana en la que un socket aceptado queda mudo
Antes, `wss.on("connection")` se colgaba de forma síncrona al crear el servidor. Ahora se cuelga después de `await` al `listening` del gateway **y** del State API.

Un cliente que conecta en ese hueco completa el handshake y no recibe nunca `bridge_hello`: sus frames se ignoran y no se suscribe. Lo demostré forzando que el State API tarde 300 ms (script en el scratchpad que envuelve `http.Server.listen`): el socket abrió, mandó `ping` y recibió `[]`. Sin retraso, el mismo cliente impaciente recibió `bridge_hello` + `pong`.

En el flujo normal la ventana es de un tick y `start.sh` espera al puerto antes de lanzar el cliente, así que no lo he visto sin forzarlo. Lo apunto porque es un cambio de comportamiento que ni el plan ni el informe mencionan. No está en el guion porque solo se ve forzando el retraso.

### H4 · menor — el tercer argumento de `list` no lo sujeta ningún test
Cambiando `pluginListSummary(id, m, ctx.narrative.pluginDelManifest(id)?.origin.author)` por `pluginListSummary(id, m, undefined)` en `hooks-de-plugins.ts`, `npm test` da **3679/3679 verde**. El test de `list` registra un plugin cuyo autor del manifest coincide con el del save, así que no distingue un caso del otro. El comportamiento no cambió respecto a la base; lo que falta es que el test lo vea.

## Otros cambios no anunciados (sin impacto medido)
- Orden y momento del log de arranque: la línea `NEFan Logic Bridge listening` sale ahora después de que escuchen los dos servidores (antes salía antes de escuchar), y el State API se anuncia primero. Nadie parsea esas líneas (`grep` en qa/, start.sh y labs: 0).
- Con el State API ocupado, el proceso termina con un mensaje legible en vez de con la traza de `events`. El exit 1 es el mismo.
- `makeCtx().subscribers` incluye ahora el socket capturador (tamaño +1), y `broadcasts` es el mensaje ya serializado y vuelto a leer. Está anunciado en parte; la suite pasa entera.

## Workarounds usados
- Para medir el suelo como en CI usé un clon `--depth 1` en el scratchpad con los `node_modules` del worktree enlazados. No afecta al usuario: es una aproximación al runner, no el runner.
- El H3 solo se ve forzando un State API lento. Es un workaround para OBSERVAR, y por eso lo dejo en «menor» y no afirmo que le pase a un jugador.
- Las roturas temporales del código para probar en negativo se revirtieron todas. `npm test` al final: 3679/3679.

## No probado
- La cifra de CI de las dos medidas: no hay PR ni push.
- La mutación: pedida por el ingeniero y sin resultado.
- `npm run verify` entero: sí corrí `npm test` (3×), `coverage`, `lint:qa`, `crap` ×3 medidas, `ejercicio` y `deuda`.

## Veredicto

**Apto con reservas.** Los tres puntos de #769 se cumplen con las decisiones del usuario. El bridge refactorizado se comporta igual en el juego real: 28/28 guiones de navegador, cierre limpio, puertos ocupados y reconexión. Los candados nuevos se ponen rojos cuando se rompe lo que dicen.

Las reservas son H1 (una regresión del arranque cuelga el test y el job en vez de ponerlos rojos) y H2 (los mensajes de la medida de scripts recomiendan órdenes que fallan). Las dos se pueden resolver dentro de la tanda, y el guion 230 las detecta.
