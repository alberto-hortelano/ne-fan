# Requisitos — tanda BC: Líneas base verdes, anclas contadas en npm test y el .venv desde un worktree (#722 #723 #717)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye. Si un issue resulta obsoleto o ya resuelto, se dice con evidencia.

## Triaje previo (2026-09-24)

| 717 | HACEDERO | S | T4 | `qa/lib/python.mjs` resuelve NEFAN_PYTHON → .venv → python3, sin pasar por git-common-dir. `ai_server/lint.sh:40-42` sí pasa por él. El bloqueo por #704 ya no aplica: #704 se cerró el 09-23 |
| 722 | HACEDERO | S | T2 | `qa/mutacion-reparto-en-lotes.mjs:678-698` toma la línea base aunque venga roja y compara contra ella. Su hermano `mutacion-candados-en-negativo.mjs:368` ya se niega en ese caso |
| 723 | HACEDERO | M | T2 | `las-anclas-de-los-candados.test.ts:40` solo importa `invariantes-en-negativo.mjs`; las demás tablas siguen dentro de sus guiones. `aplicarPares(t, [])` → `{ok:true}` sin avisar (`qa/lib/anclas.mjs:42-56`) |

## Los issues, verbatim

### #722

> mutacion-reparto-en-lotes no exige una línea base verde: un checker rojo en limpio queda ciego y el guion fabrica «SIN CANDADO» falsos
> 
> `qa/mutacion-reparto-en-lotes.mjs` corre cada checker sobre el árbol limpio, imprime la línea base
> y compara contra ella aunque venga roja (`cableado:1`). Un checker rojo en la base queda ciego para
> TODOS los probes: su resultado roto ya no puede «cambiar», y el guion fabrica «SIN CANDADO Y SIN
> ISSUE» falsos. La forma 1 de #700 era un caso de esto (el patrón duplicado ponía rojo a `cableado`
> en limpio y el guion acusó a `fusionar` de #420 «reabierto»); #700 cierra ese caso concreto con el
> pre-vuelo de anclas, pero cualquier otra causa de base roja sigue produciéndolo. Los hermanos
> (`mutacion-candados`, `contrato`, `bateria`) ya se niegan con «arregla eso primero». Propuesta: la
> misma negativa aquí, o marcar como «sin medida» los probes cuyo checker viene rojo.
> Relacionado: #700, #605.
> 
> Sale de la tanda AM (#700).

### #723

> Las tablas rompe de los guiones en negativo se cuentan solo al correrlos, no en npm test
> 
> Desde #486 las anclas de la batería se cuentan en cada `npm test`
> (`las-anclas-de-los-candados.test.ts` sobre `qa/lib/invariantes-en-negativo.mjs`). Las de
> `mutacion-cableado-en-negativo.mjs`, `mutacion-candados-en-negativo.mjs`,
> `contrato-candados-en-negativo.mjs` y los ABIERTOS de `mutacion-reparto-en-lotes.mjs` viven dentro
> del guion: se cuentan cuando el guion corre (en `candados-headless`, sí; en el bucle local de
> `verify`, no). Propuesta: sacar cada tabla a `qa/lib/` y contarla con `anclasSueltas`
> (`qa/lib/anclas.mjs`, #700) desde el mismo test. Cuidado con los guiones que tienen efectos al
> cargar (`process.argv`, `turnoDeCandados`): por eso se mueve la TABLA, no se importa el guion.
> 
> Menor anotado por QA de AM: `aplicarPares(texto, [])` devuelve ok en silencio (una entrada SIN pares), el mismo modo de fallo que el `buscar` vacío, que sí lanza. Cabe en esta misma tarea.
> 
> Sale de la tanda AM (#700).

### #717

> qa/lib/python.mjs no encuentra el .venv del checkout principal desde un worktree, y la resolución del intérprete vive en JS y en bash sin paridad
> 
> `ai_server/lint.sh` (#709) resuelve el intérprete como `NEFAN_PYTHON` → `<raíz>/.venv` → `<padre de git-common-dir>/.venv` → `python3`. `qa/lib/python.mjs` hace `NEFAN_PYTHON` → `<raíz>/.venv` → `python3`, sin el paso del common-dir. Por eso un guion del banco que arranca Python desde un worktree de tanda necesita `NEFAN_PYTHON` a mano, y la misma regla vive en JS y en bash sin nada que las compare. Propuesta: que `python.mjs` adopte el paso del common-dir con un test de paridad (como `port-offset-paridad.test.ts`), o que invoque un `lint.sh --interprete` como única fuente. Toca el banco (`qa/lib`), así que hay que coordinarlo con #704.
> 
> Sale de la tanda AK (#709).

## Criterios de aceptación

Del crítico (`critica.md`), con las decisiones del coordinador aplicadas (2026-09-24):

1. **#722:** con un checker cuyo status sobre el árbol limpio no sea `0` (incluido `null`), `reparto` sin `--solo-vigentes` sale ≠0 ANTES del primer probe, nombrando el checker, y sin imprimir ningún «SIN CANDADO». Probado en negativo (un checker saboteado a rojo en limpio) y restaurado byte a byte. `--solo-vigentes` no cambia de conducta (guion 164 sigue verde). *Decisión del coordinador:* se hace como dice la crítica — con base roja o timeout, el guion se niega igual que los hermanos; no hay estado «sin medida».
2. **#723 menor:** `aplicarPares(t, [])` lanza, con test que lo exija; los llamadores vivos siguen verdes.
3. **#723 tablas — FUERA por decisión del coordinador.** No se mueve ninguna tabla a `npm test`: las cuatro ya se cuentan en cada PR (`ci.yml`, job `candados-headless`) y moverlas cuesta más de lo que da. El ingeniero redacta el texto de cierre de #723 con esa evidencia.
4. **#717:** una tabla de casos la comen JS y bash con el mismo veredicto (intérprete elegido o fallo): variable ausente/vacía/ruta/nombre de PATH (`NEFAN_PYTHON` como nombre del PATH incluido), `.venv` propio, `.venv` del common-dir, ninguno. Rojo probado quitando el paso de common-dir de una de las dos. Y un guion Python del banco arranca desde este worktree SIN `NEFAN_PYTHON`. `start.sh` queda fuera y nombrado.
5. Cero créditos; guiones solo en 202-205 si hacen falta. Todo `.mjs` nuevo pasa `no-useless-assignment` y `preserve-caught-error` (las enciende la tanda AY).

## Restricciones

- **Números de guion RESERVADOS: 202-205.** Hay otras tandas en paralelo (AX atlas, AY lint de qa/labs, AZ clientes WS del banco y `qa/lib/cable.mjs`/`sesion.mjs`, BA skins y tema de UI).
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node`.
