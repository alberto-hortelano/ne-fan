# QA — Tanda BT: los volúmenes sin ejercer

Rama `feature/tanda-bt` @ `65d7d5d9` sobre `f6401993`. Validado contra `requisitos.md` (petición literal + reencuadre del crítico aceptado; decisión del coordinador: render ≠ colisión, el disco de colisión del prop-punto cabe en lo pintado con media celda de tolerancia). Material en el scratchpad de la sesión (`…/scratchpad/qa-bt/`: `volcar.mts`, `corpus/`, `out-base/`, `out-rama/`, `mutantes.py`, `neg-guion.py` y sus logs). Guion: `qa/guiones/330-la-puerta-en-y-y-las-del-cutaway-se-cruzan.mjs`.

## Criterios

| # | Criterio | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | Lo borrado (catmull, opciones del plató, `depthPoint`, fallbacks de color) no cambia NADA de lo que se pinta ni colisiona | ✅ | Volcado byte a byte de `formatDToWorld`, `buildFpsTileSpec` (greybox + scatter + relieve), `canonicalSurfaceLayoutJson(buildLayout(...))` (la clave del atlas), `buildTileGreyboxSpec`, `planCollisionGrid`, `deriveVolumesFromSchema`, `volumeFootprintCells` + disco, y la exclusión del scatter muestreada cada 0,25 celdas (con y sin `areas`). Base = worktree temporal en `f6401993`, rama = `65d7d5d9`. Corpus de 34 escenas: las 3 fixtures de `data/scenes`, los 2 planes de `test/fixtures/fps-plans`, el tile de bootstrap y un tile con lugar del motor falso, el `tile_0_0` archivado de **cada juego base** (`archivo/snapshots-bench-2026-08-22/{alta_fantasia,cuentos_oscuros,toledo_1200,colonia_aster}`) más los 8 vecinos de alta_fantasia, los 2 tiles reales de motor de `snapshots-sesion-portadas`, 11 saves archivados y un plan sintético con TODAS las ramas (cutaway n/w/e + dos puertas n, techo flat/gable-y/hip con `angle`, gate x/y, torre/fuente con y sin r, 5 variantes de prop, custom con cono/esfera/cilindro+rTop/tumbado, prism, roca, árbol, arbusto, suelo rect/elipse/polígono/path/agua/deck). **34/34 IGUALES** (ficheros de 0,6–1,1 MB). Control en negativo: con dos cambios de un carácter en la base (elipse 16→15 y prop-punto 1,4→1,45) salen 23/34 DISTINTOS, así que la comparación ve una diferencia de ese tamaño |
| 2a | El portón `orient:"y"` deja cruzar su muro | ✅ | Unitario: los tests del ingeniero, y mis mutantes Q4 (vano desplazado una celda) y Q5 (vano que ignora el grosor del anchor) salen ROJOS por aserto. En el juego: guion 330 §1, cruce andando `(-21,0) → (-12,35, 0)`; control: 12 m al norte el mismo muro NO se cruza (se para en x=−18,41) |
| 2b | Al cutaway se entra por las puertas `n`, `w` y `e` | ✅ | Unitario: Q1 (el hueco `n` solo limpia la fila exterior), Q2 (hueco `e` desplazado) y Q3 (boquete en la esquina SO) salen ROJOS. En el juego: guion 330 §2, se entra andando por n `(-1,-20)→(-1,-13,69)`, por w `(-7,-13)→(-0,58,-13)` y por e `(11,-12)→(4,65,-12)`. Control: por el muro sur, que no tiene puerta, NO se entra (para en z=−7,52) |
| 3 | Las ramas de `volume-prims.ts` sin ejecutor tienen asertos sobre la geometría emitida, no solo línea | ✅ | Q9 (cono con huella de medio radio), Q14 (puerta `e` pintada en la cara oeste), Q15 (jamba del gate 3→1) y Q10 (prop rect+angle sin giro en la huella) salen ROJOS en las baterías de la tanda. Ver el hallazgo H2 para lo que NO se sujeta |
| 4 | `footprint.ts` se afirma por sus consumidores reales, y queda escrita la relación 1,4 pintado / 1,3 colisión | ✅ | Q8 (disco del prop-punto descentrado +1) y Q11 (margen del scatter quitado solo en el lado sur) salen ROJOS. La decisión está escrita en el test (`lo-que-se-pinta-es-por-donde-se-pasa.test.ts`, bloque «prop») con la media celda de tolerancia que fijó el coordinador. Q12 (bloqueo del derive con fondo 0) NO lo cazan las baterías de la tanda, pero sí los tests del derive (`deriveVolumesFromSchema: entities del tile`, `composeTilePlan`) |
| 5 | Los tests nuevos afirman lo que dice el jugador (pasada adversarial, mutantes distintos de los 14 del ingeniero) | ✅ con reservas | 16 mutantes a mano (`mutantes.py`, aplicados en una copia del commit y restaurados; árbol limpio al final). 12 ROJOS en las 4 baterías de la tanda, siempre por aserto. 2 los cazan otros tests del área (Q6: disco de torre/fuente/roca +1, lo caza `volume-metrics`; Q12). **2 sobreviven a la suite ENTERA** (3861 tests; los 3 rojos de esa corrida también salen sin mutar en la copia, por entorno): Q13 y Q16, ver H2 y H3 |
| 6 | Hallazgo 3 del ingeniero: `markBand` pone un muro invisible más allá del extremo de un muro | ✅ CONFIRMADO | Medido de dos formas. (a) Analítica, sobre el código de la rama: tramo [[70,90],[100,90]]; lo pintado a ras de suelo acaba en u=100 y la colisión en la fila del eje llega a u=101 / 102 / 106 con `width` 3 / 5 / 12, o sea **0,5 / 1 / 3 m** de muro invisible por punta (= width/2). (b) Andando en el juego (guion 330 §3): contra el costado del muro de width 12 el jugador para a 0,40–0,54 m de la cara (el radio del cuerpo); contra la punta para a 3,45–3,48 m de donde se ve acabar el muro. Descontado el radio quedan **2,93–3,07 m de muro invisible** en cuatro corridas. Captura `…-05-parado-ante-la-punta-del-muro-grueso.png`: el muro acaba a la vista con 3 m de hierba delante y no se puede avanzar. En los tiles reales de motor archivados los muros que acaban dentro del tile tienen `width` 2–4, así que ahí son 0,5–1 m |
| 7 | Sin coste en créditos | ✅ | Preset `e2e-sin-creditos`, modo maqueta. Censo del runner: `gasto /generate_scene×1` (motor falso), `puertas —`, 0,00 € |

## Hallazgos

**H1 — importante (no bloquea esta tanda: es anterior a ella y el ingeniero ya lo anota como backlog 3). Muro invisible en la punta de todo muro.**
`markBand` (`collision.ts`) marca las celdas a ≤ width/2 del trazo, y eso incluye un semicírculo de radio width/2 más allá de cada extremo. `wallPrims` corta lo pintado en seco. Pasos: `node qa/run.mjs 330` y ver la captura 05. O a mano: con un tile que tenga un muro de `width` 12 que acabe en campo abierto, andar por su eje hacia la punta. Qué espera el jugador: poder llegar hasta la cara visible del muro, como le pasa en el costado. Qué pasa: choca con aire 3 m antes. El guion lo afirma como AGUJERO CONOCIDO (patrón del 148), así que se pondrá ROJO el día que se arregle. Probado: con la tapa quitada, el §4 da 0,00 m y sale rojo. Ojo para quien lo arregle: quitar la tapa sin más abre una rendija en las esquinas convexas de una polilínea. La tapa sobra en las puntas libres, no en los vértices. **Hay que abrir el issue**: el guion cita «backlog 3 de la tanda BT, issue por abrir».

**H2 — menor. El grosor del muro del cutaway (pintado frente a colisión) no lo sujeta nadie.**
Q16: si el muro pintado del cutaway pasa de `t` 1,2 a 2,4 (0,6 m más hacia dentro que la colisión, que se queda en 1,5), la suite entera sigue verde. El test «el hueco pintado es el hueco libre» solo mira la línea media del muro (`linea = 20.6`, etc.), así que ve dónde están los huecos pero no el grosor. Para el jugador, el día que alguien engorde ese muro se podrá meter medio cuerpo en una pared pintada. Coincide con el backlog 2 del ingeniero («no está escrito»). Lo registro porque el nombre del test promete más de lo que mide.

**H3 — menor. La elipse del suelo pintado puede cambiar de número de segmentos sin que nadie lo vea.**
Q13: con `ellipsePoints(..., 12)` en vez de 16 la suite entera sigue verde, y el golden del atlas también (sus planes no llevan elipses de suelo). El borrado de `ellipseSegments` es byte-idéntico (criterio 1), así que la tanda no rompe nada. Pero «`ground-prims.ts` sin líneas frías» no quiere decir que la forma pintada de una elipse esté afirmada. Queda fuera del alcance pedido: ahí solo se pidió borrar.

**Observación, no es hallazgo.** El fondo rojo oscuro del techo en las capturas 02–04 es el cierre del cutaway que añade la vista fps (`fps-spec`, «cutaways cerrados»). Visto desde fuera es la casa de tejado rojo de las capturas 01 y 05. Encaja con el diseño.

**Crítica visual (maqueta clay).** En `e2e-sin-creditos` las superficies son clay, no arte, así que no hay nada que juzgar de material. En cuanto a legibilidad, el vano del portón en `y` se lee como un pasadizo bajo el dintel, con las jambas a los lados y la muralla continua al fondo (captura 01). Los tres huecos del cutaway se ven como huecos de puerta con el exterior iluminado detrás (03 y 04). La luz es una sola y las escalas son coherentes entre muro, portón y casa. Lo único que desentona es H1: en la 05 se ve el muro acabar lejos y el jugador está parado en la hierba.

## Workarounds usados

- **La escena del guion entra por `loadSceneRaw`** (hook de desarrollo, la misma puerta que el selector «Room»: `load_room` al bridge, y el sim colisiona con `planCollisionGrid` sobre el plan, igual que en partida). No es una receta para que la prueba pase: **nada vivo trae un portón en `y` ni un cutaway con puertas n/w/e**. Las 3 fixtures no tienen ningún `gate` y su único cutaway (`zorder_test`) solo tiene puerta `s`. El motor falso sirve un `gate` `x` y una taberna con puerta `s`. Sus anexos con puerta `w` tienen techo, así que la puerta es decorativa. Solo el motor real podría declararlos, y eso gasta créditos. Veredicto: no afecta al jugador. El jugador que reciba esa escena del motor pasa por la misma función de colisión, en el bridge y en el cliente. Lo que no se ha probado es que el motor real llegue a emitirla (ver «No probado»).
- **`setPlayerPos`/`setYaw`** para plantar al jugador delante de cada puerta. Desde ahí todo se anda con la tecla de avance y el sim del bridge. Nada se teletransporta a la meta.
- **Banco del worktree**: copié `nefan-html/public/sprites` (arte generado, está en `.gitignore`) desde el checkout principal, tal como indica el runner (#476), y enlacé `qa/node_modules` mientras duró la corrida. Ni el código ni el juego cambian.
- **Mutantes**: siempre en worktrees temporales del scratchpad (`base` en `f6401993` y `mut` en `65d7d5d9`), nunca en el árbol del ingeniero. Al final se comprobó el árbol limpio. No usé `git stash` ni toqué el tag ni `reports/mutation`.

## Guion

`qa/guiones/330-la-puerta-en-y-y-las-del-cutaway-se-cruzan.mjs`: portón en `y` más su control, cutaway n/w/e más el control por el sur, y el muro grueso (costado de control y punta = agujero conocido). Corrida real con `node qa/run.mjs 330`: **11 asertos ✔ de 11**, bloque de puertos elegido por el runner y 0,00 €. Probado en negativo con `neg-guion.py`, que corre el guion en la copia mutada:

| Mutante | Resultado del guion |
|---|---|
| N0 sin mutar | ✔ entero |
| N1 `markBuilding` sin `case "n"` | ✘ SOLO «se ENTRA en el cutaway por su puerta `n`» |
| N2 `clearGatePassage` sin la rama `y` | ✘ SOLO «se CRUZA el muro norte-sur por el vano del portón en `y`» |
| N3 `markBand` sin tapa | ✘ SOLO el AGUJERO CONOCIDO (0,00 m) |

Candados del banco en verde con el guion dentro (135 tests: modo de gasto, cliente WS, consulta de movimiento, un número un guion, saltos observados, barrido único), y `eslint.qa.config.js` limpio.

## No probado

- **Que el motor narrativo real llegue a emitir un `gate` en `y` o un cutaway con puertas n/w/e.** Haría falta una sesión `play`, que gasta. Aquí solo se prueba que, si los emite, se cruzan.
- **El score de mutación.** Lo pone la próxima corrida autorizada, como dice el requisito. Mis 16 mutantes a mano son una muestra, no una medida.
- **`npm run verify` completo en la rama.** No lo he repetido, me fío del log del ingeniero (3959/3959). Sí he corrido las 4 baterías de la tanda (77/77) y las 32 del área (552/552).

## Veredicto

**Apto con reservas.** Lo borrado es byte-idéntico en todo lo que el juego pinta y colisiona, incluido el tile de cada juego base. En el juego real se cruza el portón en `y` y se entra por n/w/e, y los tests caen ante mutantes distintos de los del ingeniero. Las reservas no bloquean. H1 (el muro invisible de 3 m, confirmado y medido) necesita su issue. H2 y H3 son asertos que prometen más de lo que miden.
