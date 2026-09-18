# Crítica — Tanda Q · #656 REENCUADRADA · #609 VIGENTE · #610 OBSOLETA

**La tanda NO va junta.** #656 y #609 comparten «el banco no sabe decir qué pasó». #610 comparte solo el tema, y su medida decisiva murió ayer en el commit que es HEAD. **#610 sale.**

**El problema real, uno por issue.** #656: cuando el tile no llega, la espera expira MUDA y nadie puede saber si el bridge contestó, falló o nunca recibió la petición (no es «mide en pared»). #609: el reproductor ya tiene los tres datos para reconocer un rojo de reloj y solo mira el texto del aserto. #610: pregunta cómo extender un detector cuya respuesta medida ya no vale.

---

## #656 · la premisa, afirmación por afirmación

| Afirmación del issue | Verificación |
|---|---|
| «rojo 2 de 3» | **Hoy 8 de 8 VERDE**: `node qa/run.mjs 127` × 8, disco al 69 %, 17-18 s por corrida. El issue midió sobre `e5cdebb5`; hoy es `900b5b71` |
| «mide por 90 s de PARED», patrón de #545 | **Falso como defecto.** El sujeto de esa espera es el BRIDGE, y `nefan-core/data/contract/esperas-que-conducen.json` ya bendice la pared para ese sujeto: sus exenciones 2 y 3 dicen literalmente «el BRIDGE generando y difundiendo un tile nuevo». El candado de #545 ni la mira: no hay tecla mantenida |
| «el disco lleno lo tumba» (el título) | **No sostenido.** Aritmética de los números del propio issue: las corridas rojas duraron ~1,7 min **de los cuales 90 s fue la espera expirada** → quedan ~12 s para arranque de stack + 6 partidas, que es lo que cuesta HOY una corrida entera (17 s). La máquina iba a velocidad de hoy hasta esa espera. **No se quedó sin presupuesto: se quedó sin respuesta**, y subir los 90 s no habría cambiado nada |
| «si hay señal del bridge, ésa es la espera; si no, decirlo» | **La hay y está publicada.** `bridge/handlers/tile.ts:189-199` difunde `narrative_status {kind:"tile", phase:"error"}`, y `:286-300` lo hace también cuando la ENTREGA se pierde (`abandonAll`). `nefan-html/src/main.ts:959-960` lo apunta en `TileLedger` (`ui/tile-ledger.ts`: `requested`/`arrived`/`source`/`error`), publicado en `__nefan.tileEpisodios`; su cabecera dice para qué nació: «un tope de reloj no sabe distinguir "va lento" de "murió"». Y el consumidor ya existe: `esperarRegistro(ctx, desc, libro, probe, maxMs)` (`qa/lib/sesion.mjs:581`), que al expirar imprime el libro |
| «el guion 127» (uno) | **Son DOS.** `qa/guiones/120-el-anillo-bueno-no-se-pierde.mjs:170-174` tiene el helper `pedirYEsperar` IDÉNTICO: mismos 90 s, mismo predicado mudo. El 127 lo copió del 120 (lo dice en su `:114`). Arreglar uno deja el otro |
| — (no lo dice el issue) | Los demás sitios que esperan un tile del bridge presupuestan **240_000** (guiones 08, 09, 15, 74, 75, 144 y `qa/lib/sesion.mjs:497,539`). Los 90 s del 120/127 son un **outlier**, no un número pensado |

**Reencuadre.** El problema no es el reloj: es el mudo. El entregable no puede ser «el 127 deja de ser rojo» —hoy no lo es y nadie sabe reproducirlo—; tiene que ser **que la expiración DIGA qué hizo el bridge**, en los dos guiones. Se puede poner rojo a propósito sin inventar nada: `POST /dev/tiles` del motor falso (`TILE_MODE=error` / `delay_ms`), que ya ejerce el guion 109.

**El día después.** El próximo rojo cuesta una lectura en vez de una tanda, y nadie vuelve a discutir el disco sin dato. El jugador no nota nada: es deuda de banco declarada, justificada por el criterio de #634/#673. Lo que sigue vivo si se hace a medias: el 120 mudo.

**Conflictos.** **#673 (abierto)** es la MISMA firma —rojo intermitente en el título, tras pre-generar las 9 escenas, en un sitio que el cambio no toca— y el 127 vive en ese escenario (`recargarAlTitulo` + `nuevaPartida` × 10 sobre mundo pre-generado). **Descartar #659 antes** (`state_update` sin `sessionId`), que es el instrumento que los dos señalan. No toca `esperas-que-conducen.json`: esta espera no conduce.

**Coste contra valor.** Barato: el helper existe, son dos guiones y admite candado en negativo. No hacerlo nunca deja dos esperas mudas de 90 s justo donde ya hay un rojo intermitente abierto (#673), y la próxima investigación empieza de cero. Vale la pena con el alcance corregido.

---

## #609 · VIGENTE, sin cambios de alcance

| Afirmación | Verificación |
|---|---|
| clasifica por el texto del aserto | Cierto: `qa/lib/carga.mjs:484-487`, tres regex (`no ocurrió en N ms`, `timeout esperando`, `expiró a los N ms`) |
| el rojo del 93 no lleva firma | Cierto: sus asertos dicen «medido 1.6000 m/s (1.28 m / 0.80 s, 30 m libres)» (`93:311-320`); ninguna regex casa |
| su causa es el reloj | Cierto, en el código: `medirVelocidad` (`93:176-205`) divide el camino por `(t_último − t_primero)/1000`, milisegundos de rAF = **pared**, contra un loop que topa el delta en 0,1 s (`nefan-html/src/main.ts:562`). Es la definición de #545 |
| lo que propone ya lo mide el reproductor | Cierto: «no existe en reposo» es `cambio === "se-rompio"` y «razón hundida» es `juicios[].real` (`carga.mjs:512-541`). El cambio es de **veredicto**, no de instrumento |

**El día después, con su riesgo.** Quien corra el reproductor sobre un rojo de reloj sin presupuesto deja de leer «aquí no hay nada de #545». Pero aflojar la tercera categoría afloja justo la defensa que nació de #496/#497, así que el criterio de aceptación tiene que incluir que el **guion 75 siga saliendo NO atribuible** —es el caso que costó el hallazgo H-4— o se cambia una mentira por la contraria.

**Coste contra valor.** Barato y headless: la lógica vive en `qa/lib/carga.mjs` y la ejerce `nefan-core/test/carga-sintetica.test.ts`. Sin conflicto con nada abierto.

**Lo que el issue no dice y hay que apuntar:** el 93 es un **sitio vivo de #545** (denominador de pared en su propia medida) y no está en la cola de nadie. Este issue hace que el instrumento reconozca un defecto que sigue ahí: son dos trabajos, y éste es el primero.

---

## #610 · OBSOLETA: su censo es de antes de `900b5b71`

El issue decide la vía con un censo: «el detector cruzado da 9 sitios, 8 son `frames(ctx,n)` en los guiones 37, 43, 58, 83, 86, 109 y 112 → extenderlo compra ocho exenciones y ni un defecto». Reimplementé el detector cruzado por mi cuenta y lo corrí en los dos árboles:

| Árbol | Sitios | Reparto |
|---|---|---|
| `900b5b71^` (antes de #606) | **8** | 7 × `frames()` (37, 43, 58, 83, 86, 109, 112) + 1 × `veredictoDe()` (`133:87`) |
| `900b5b71` = HEAD | **1** | solo `veredictoDe()` (`133:87`) |

**#606 se llevó por delante el censo:** las copias locales de `frames` (`git show 900b5b71^:qa/guiones/37-…:79`) se unificaron en `qa/lib/fotogramas.mjs`, con dueño y test propio. Hoy la extensión no compra ocho exenciones: como mucho **una**, el único `ctx.waitFor` de `fotogramas.mjs:137`.

Y el único sitio que quedaría marcado, `133:87`, **no es un defecto**: el propio guion lo declara en `133:350-354` — «ésta SÍ se presupuesta en pared a propósito y no se puede escribir de otra forma: con un presupuesto de sim saldría ⊘ en vez de medir». O sea **0 defectos y 1 exención** por cualquiera de los dos ejes: un candado sin sujeto vivo (lección de la tanda H).

**El eje propuesto tampoco está verificado.** Censé «el predicado lee el progreso del jugador y el presupuesto es de pared» sobre todo `qa/`: **28 sitios** (08, 09, 10×4, 104, 119, 125×2, 126×2, 144, 15, 37, 41×2, 61, 65, 74, 75, 79×4, 80, 93×2). Casi todos leen `state().pos` para medir la distancia a un NPC o a un objeto: el sujeto no es el jugador. «Un detector sobre ese eje no produce las ocho exenciones falsas» es una hipótesis sin medir, y mi medida apunta al revés.

**Conflicto y coste.** Todo detector nuevo paga en exenciones, y **#611 (abierto)** dice con medida que la exención en prosa plausible **no se puede verificar** (7 pass · 0 fail silenciando un sitio real): abrir una segunda cola de exenciones antes de resolver #611 es pagar dos veces. El trabajo es un detector nuevo con censo, contrato y prueba en negativo; lo que compra hoy es cero defectos, y no hacerlo nunca no cuesta nada medible. Lo que hay que conservar ya está escrito: el hueco DECLARADO y con caso ejecutable en `esperas-que-conducen.test.ts:122-143`.

---

## Qué le cambiaría a `requisitos.md` (redactado para pegarse)

1. **Título de #656** → «El 120 y el 127 esperan un tile con una espera MUDA: al expirar no dicen si el bridge contestó, falló o nunca recibió la petición». Retirar la causalidad del disco y dejar la aritmética: de los ~1,7 min de las corridas rojas, **90 s fueron la propia espera**, así que la máquina iba a velocidad de hoy hasta ese punto.
2. **Añadir a #656**: el sujeto es el bridge y la pared es legítima para él (exenciones 2 y 3 de `esperas-que-conducen.json`); la señal existe (`__nefan.tileEpisodios`) y el consumidor también (`esperarRegistro`, `qa/lib/sesion.mjs:581`); **el alcance son DOS guiones** (`120:170-174` y `127:134-141`); el criterio de aceptación es que la expiración HABLE, ejercida con `POST /dev/tiles`.
3. **Añadir a #656 la dependencia**: descartar **#659** antes, por la firma compartida con **#673**.
4. **Añadir a #609**: criterio de no-regresión — el guion **75** sigue saliendo NO atribuible. Y apuntar aparte que `93:176-205` es un sitio vivo de #545 sin dueño.
5. **Sacar #610 de la tanda**, y pegarle en el issue: «El censo que decidía esta vía es de antes de #606. Remedido sobre `900b5b71`: el detector cruzado da **1 sitio** (no 9), y ese sitio —`133:87`— es una espera de pared deliberada declarada en `133:350-354`. Cero defectos vivos por los dos ejes. El eje propuesto, censado, marca 28 sitios cuyo sujeto en su mayoría no es el jugador. Bloqueado además por #611. El hueco queda declarado y medido en `esperas-que-conducen.test.ts:122-143`, que es donde debe quedarse.»
