# QA — Tanda BV: las cercas finas no se atraviesan (#788)

Worktree `/home/al/code/ne-fan-tanda-bv`, rama `tanda-bv-cercas-finas`, commit `d0d9351a`.
Guion nuevo (sin commitear): `qa/guiones/350-la-cerca-fina-encierra-y-su-porton-deja-salir.mjs`.

## Método

- **Juego real.** `node qa/run.mjs 350` levanta `e2e-sin-creditos` en un bloque libre, sin tocar el stack `play` de los puertos por defecto. El guion hace el recorrido del jugador: título → partida nueva (alta_fantasia, maqueta) → comenzar.
  - Después carga por `loadSceneRaw` un tile Format D con cuatro cercas de `width` 0,3 (15 cm pintados, h 1,4):
    - A: anillo de eje con el trazo sobre la frontera de celdas;
    - B: anillo girado 30°;
    - C: anillo de eje con un `gate` `orient:"y"`;
    - D: anillo girado 30° con un hueco de 4 m.
  - Hay además un muro de referencia (`width` 2) cuyas caras coinciden con la celda.
  - En cada carrera el jugador se coloca en el centro del recinto y **anda** (inputDriver, tecla de avance, 8 s de sim, sprint en dos casos). Se afirma si sale o no.
- **Negativo.**
  - Con el `collision.ts` de `main` (3d0b30b3) copiado encima: el guion se pone ROJO, con 18 y 17 asertos rojos en dos corridas.
    - Se atraviesan las cuatro direcciones y la esquina del anillo de eje.
    - Se atraviesan los 4 lados y las 4 esquinas del girado.
    - Con la cerca muerta, los «controles del control» también caen.
  - Con `clearGatePassage` anulado: rojo exactamente el «por el portón se sale». El control no es vacuo.
  - En los dos casos se restauró con `git checkout HEAD -- …/collision.ts`. No se usó stash.
- **Pasada adversarial sobre las 445 celdas.** Script de QA (scratchpad, no se commitea). Toma el corpus de `medir-delta` (`nefan-core/data` + `labs/` del árbol principal) con la rejilla del plan COMPLETA (`planCollisionGrid`: ground + volumes).
  - Calcula las componentes conexas del espacio libre para el jugador (r 0,4) y el NPC (r 0,5) con `blocksCircle`, en una rejilla de 0,125 m, antes y después.
  - Pregunta si alguna componente de antes queda partida en ≥ 2 trozos de ≥ 1 m², o desaparece. Esa es la firma de un paso, una puerta o un vano cegado.
  - Probado en negativo: el anillo fino sale «PARTIDO: 3721 + 175,6 m²».

## Criterios

| # | Criterio (requisitos.md) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Un muro de cualquier `width` bloquea al JUGADOR en cualquier orientación | ✅ | Guion 350, en verde tres corridas. Cerca de 15 cm: <br>• de eje: N/S/E/O + esquina NE + sprint rasante, no sale (se para a 6,6 m del centro con la cerca a 7,5 m); <br>• girada 30°: 4 lados + 4 esquinas + sprint rasante, no sale (5,2–7,4 m con circunradio 8,5). <br>Contra `main`: rojo. |
| 1 | …y al NPC | ⚠️ no probado en juego | Solo tests unitarios (`escapa` con `NPC_RADIUS_M`). En el cliente no hay forma barata de empujar un NPC contra una cerca. La pasada adversarial usa r 0,5 y no encuentra pasos cegados. |
| 2 | Render ≠ colisión, con la relación escrita | ✅ | Medido en juego, cerca de eje: <br>• parada a 0,85–0,88 m de la cara PINTADA; <br>• radio medido contra el muro de referencia: 0,46–0,50 m; <br>• colisión «invisible»: **0,37–0,40 m**, menos de una celda (aserto ≤ 0,5 m). <br>En la girada: ≈ 0,75 m a la cara, ≈ 0,3 m de sobra. Capturas 02/04: el jugador queda a un brazo de la cerca, y se lee natural porque el fps-detail pinta postes y travesaños más gruesos que 15 cm. |
| 3 | Monotonía, delta medido sobre escenas reales | ✅ | Del ingeniero: 0 celdas quitadas, 445 añadidas en 17 tiles, 0 veredictos de `validateScene` cambiados. De QA: en los 17 tiles, con ground incluido, **0 componentes partidas y 0 desaparecidas**, para jugador y NPC. El espacio libre perdido va de 1 a 30 m² por tile; lo máximo es `labs/narrative/runs/2026-08-17_08-34-30` tile_0_1, que es franja a lo largo de muros diagonales, no un paso cerrado. |
| 4 | #787: sin tapas en puntas libres | ✅ | El guion 330 (§4, muro de width 12 que acaba en campo abierto) sigue verde en este worktree. La punta libre del anillo D, con el hueco de 4 m, deja salir. |
| 5 | Test que anda y se pone rojo contra `main` | ✅ | Del ingeniero: 23 rojos en `lo-que-se-pinta…`. De QA: el guion 350 contra `main`, rojo (arriba). |
| 6 | `gate` y `clearGatePassage` abren vano en muro fino | ✅ | Guion 350: por el portón de la cerca C se sale; por el lado opuesto, no. Con `clearGatePassage` anulado, rojo. |
| 7 | `markRotRect` / `markPolygon` / `markDisc` con el mismo criterio | ⚠️ no probado en juego | Solo unitarios (anillos de prop/building/prism a 30° y 45°, torre de r 0,3) y sabotajes del ingeniero. El guion no los ejerce. |
| — | Regresiones de colisión en juego | ✅ | `node qa/run.mjs 330 02-colision 45- 134 144`: 6/6 en verde (arrastró también el 145). |

## Hallazgos

**Bloqueantes:** ninguno.

**Importantes:** ninguno atribuible a la tanda.

**Menores:**

- **M1 · El dintel del `gate` queda a la altura de los ojos cuando el portón es bajo, y se atraviesa.** Es previo a la tanda: `gatePrims` no se toca. La tanda lo hace más probable, porque ahora una cerca fina con portón es un caso de uso real.
  - Reproducción: guion 350, captura `05-porton-en-la-cerca-fina-desde-dentro`. Es un `gate` con `h` 3.
  - Causa: `gatePrims` pinta el dintel como una caja de 1,8 m centrada en `h − 0,9`, o sea entre 1,2 y 3,0 m. La cámara está a ~1,6 m.
  - Lo que ve el jugador: una losa marrón maciza que cruza el encuadre, y la atraviesa andando. La colisión es 2D, así que no hay bug de colisión, pero sí de lectura.
  - Además, las jambas de piedra de 3 celdas y el dintel de 6,5 celdas de fondo sobre una cerca de 15 cm son un portón monumental en una valla de madera: escala e integración rotas.
  - Qué esperaba el jugador: un portón de valla, o por lo menos un vano por el que se pasa sin meter la cabeza en una viga.
  - Propuesta: abrir un issue aparte, con suelo de `h` para el vano o un dintel que nunca baje de ~2,2 m.
- **M2 · Con la mirada horizontal, parado contra la cerca, el jugador no la ve.** A 0,85 m de una cerca de 1,4 m, la cerca cae por debajo del encuadre (captura `01-…parado-ante-ella`: solo se ve el paisaje lejano). El jugador «choca con nada» hasta que mira abajo (captura `02-…mirando-abajo`). Es propio de toda FPS con obstáculos bajos, y la colisión 0,4 m más gruesa que lo pintado lo acentúa un poco. No lo arregla esta tanda; se anota como fricción.

## Workarounds usados

- **`loadSceneRaw` con un tile de bench.** Ninguna escena viva ni el motor falso declara hoy un `wall` de `width` < 1, así que el jugador no puede llegar a una cerca fina por el flujo normal.
  - Es la misma puerta que el selector «Room»: `load_room` al bridge, y el sim colisiona con `planCollisionGrid`, como en partida.
  - Veredicto: no oculta nada al usuario, pero el día que el motor declare una empalizada solo lo cubrirá este guion. No hay prueba con el motor real.
- **`setPlayerPos` al centro de cada recinto como punto de salida.** Solo coloca el punto de partida; todo el recorrido se ANDA. Justificación: el jugador real entraría por el portón o ya estaría dentro. Sin impacto.
- **Mirar abajo con ↓** para las fotos. Es el gesto del jugador, no un truco. Es parte del hallazgo M2.

## No probado

- NPC contra la cerca en el juego (req. 1, mitad NPC). Solo unitario y el análisis de componentes con r 0,5.
- `prism` fino, prop o building girado fino y torre de r < 0,5 en el juego (req. 7). Solo unitario.
- Una cerca fina declarada por el MOTOR REAL (preset `play`). No se tocó el stack `play` vivo, y costaría una sesión narrativa.
- La mutación de `blueprint-huella` sigue pendiente de la corrida autorizada, como dice `implementacion.md`.

## Veredicto

**Apto.** La cerca fina encierra en el juego real, tanto de eje como girada, andando y esprintando. El portón y el hueco dejan salir. El guion se pone rojo contra `main` y contra un sabotaje del vano. Las 445 celdas añadidas no ciegan ningún paso de las escenas reales. M1 (dintel bajo del `gate`, previo) y M2 (fricción visual) van aparte.
