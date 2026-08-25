# El telegraph enseña hasta dónde llega (#184 + #185)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

## Por qué los dos van al mismo crítico

Mismo sujeto —el parche del telegraph del ataque— desde dos lados: qué información transmite
(#184) y qué impide que vuelva a desaparecer bajo el suelo (#185).

## Los issues

Cuerpos íntegros con `gh api repos/alberto-hortelano/ne-fan/issues/N`, N ∈ {184, 185}.

- **#184** — la alfa del shader **es** la calidad del golpe, así que donde el color debería ser
  rojo la alfa ya vale cero: **la rampa roja no se ve nunca** y el jugador solo ve el punto
  dulce. Confirmado línea a línea en `nefan-html/src/renderer/fps-gl.ts:164`. **Y es algo mayor**:
  hay un tercer límite invisible además del radial — `front` es un escalón duro de ±60° (`:401`),
  así que **el arco del cono también desaparece sin degradado**. Lo que se pierde es el **alcance**, y en este combate `factor_distancia` cae
  linealmente hasta 0 en el borde de la tolerancia, así que saber dónde acaba el área es justo
  lo que evita fallar el golpe.
- **#185** — el parche se dibuja a `GROUND_OVERLAY_Y` = 0,2 m, número medido sobre dos fixtures del
  golden **en vez de acotado contra lo que el generador puede producir**. Lo sube el stagger de 2 mm
  por prim (`fps-spec.ts:286`), y `MAX_GROUND_FEATURES = 64` acota **rasgos, no prims**: un `path` de
  16 puntos emite 31. **No es un riesgo futuro: ya ocurre.** El crítico ejecutó `buildFpsTileSpec`
  sobre tiles legales:

  | Tile | rasgos | prims planas | cara alta | vs. 0,2 m |
  |---|---|---|---|---|
  | 8 caminos + 6 plazas (pueblo) | 14 | 62 | 0,1690 m | 31 mm de margen |
  | río + 4 embarcaderos + 6 caminos + 4 plazas (puerto) | **15** | 63 | **0,2160 m** | **ENTIERRA** |
  | 64 caminos de 16 pts (tope del schema) | 64 | 477 | 0,9990 m | ENTIERRA por 80 cm |

  Quince rasgos de los 64 que permite el schema ya entierran el telegraph, porque `deck` arranca en
  `Y_DECK = 0.18` celdas = 0,09 m, el doble que un camino. **La tarea es doble: corregir la cota, no
  solo candarla.**

## Lo que hay que verificar, no dar por bueno

- ¿Sigue siendo cierto que la alfa codifica la calidad, tras los cambios de renderer del último
  mes? Enseña el código.
- ¿Cuántas prims planas puede llegar a emitir `fps-spec` de verdad? Si el número está acotado por
  construcción, #185 es menor de lo que dice.
- ~~El test de altura no puede ponerse rojo~~ — **SOSPECHA TUMBADA por el crítico, en sus dos
  mitades.** El test está en `nefan-core/test/surfaces.test.ts:246-284` (no en `nefan-html`: mi
  requisitos apuntaba al paquete equivocado); su `0.004` **sí casa** con el `0.002`, porque está en
  **celdas** y `TILE_MPC = 0.5`; y **sí se pone rojo**, verificado mutando `GROUND_STAGGER_M` a
  `0.02` y a `0`. Lo cierto es más fino: su cota de `:275` es proporcional a N —fija el escalón por
  prim, no la altura total— pero su sujeto declarado es el z-fighting, no el margen del overlay.
  **Falta un candado; no sobra uno falso**, que es mejor noticia: no hay nada que borrar.
- Las dos constantes viven en procesos distintos. Dato del crítico para el arquitecto:
  **`nefan-html` no tiene harness de test** —ni directorio `test/` ni script `test`—, así que el
  candado **no puede vivir junto a `GROUND_OVERLAY_Y`** sin mover la constante a core. No choca con
  «lógica en core, el cliente solo pinta»: `fps-renderer.ts:14` ya importa `buildFpsTileSpec` vía
  `@nefan-core/*`.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- Con el ataque preparado, el jugador **ve dónde deja de llegar**, no solo dónde pega perfecto.
- Un candado se pone rojo si el margen entre el overlay y el stack de suelo se agota.
- Capturas antes/después para juicio visual de director de arte.

## Fuera de alcance

Rediseñar la fórmula de combate o los tipos de ataque. Cambiar el arte del parche más allá de lo
que exige transmitir el alcance.

## Veredicto del crítico

**VIGENTE (#184) · REENCUADRADA (#185).** La fusión de los dos en una tanda es correcta:
mismo fichero, mismo parche, mismas capturas. Ver `critica.md`. Sin decisiones de producto pendientes.

---

# Ronda de corrección (coordinador, 2026-08-25)

QA da **APTO CON RESERVAS** (`qa.md`). Confirma y **amplía** las dos afirmaciones load-bearing
del ingeniero: la convención de altura estaba mal en los tres documentos (el plan corto media
rebanada, el issue y la crítica **una entera**), y el candado nuevo lo puso rojo de **cinco**
maneras, no tres.

Lo que hay que corregir antes de mergear la PR #263:

## C1 — H1: el candado tiene un agujero por donde vuelve #185 (obligatorio)

`groundOrder` solo se aplica a prims dentro de `GROUND_BAND_MIN/MAX` (0,045–0,185 celdas). Con
`Y_DECK = 0.18`, **cualquier capa nueva por encima del deck cae fuera de la banda**: no es calco
(conserva `depthWrite`, o sea entierra) y **el test no la mide**. QA lo reprodujo: una capa a
0,22 celdas da cara alta real 0,125 m —exactamente la cota del parche— con
`ground-overlay.test.ts` en **verde**.

O sea: la tanda arregla el enterramiento de hoy y deja abierta la puerta por la que volvería
mañana. Y el comentario de `greybox.ts:66-72` **promete lo contrario** — que es el mismo pecado
del comentario que esta tanda vino a borrar.

**No vale ampliar la banda a ojo.** Lo que hay que conseguir es que el test mida **todas** las
prims de suelo, esté donde esté su cota, o que sea imposible añadir una capa de suelo fuera del
mecanismo que la hace calco. Si el arreglo correcto resulta ser mayor que esta tanda, **dilo por
escrito** y abre el issue: es preferible eso a un candado que sabemos agujereado.

## C2 — H3/H4: los números de la convención vieja sobreviven en lo entregado

`3.2855` en la §3 de `implementacion.md` y `0,2115 / −0,0115` en el docstring del guion 22 están
calculados con `pos.y + t/2`. El propio hallazgo de la tanda es que esa convención es falsa:
dejarla escrita en la evidencia es sembrar el siguiente error. Corrígelos con la cota real
(`pos.y + t`), que QA ya midió: puerto **0,2310**, `robledo_tile` **0,1330**, `puerto_tile`
**0,2190**.

## C3 — H5: «arma desnuda» no es un estado alcanzable

Dos sitios lo describen como un caso probado. `main.ts:534` fija `playerWeaponId = "short_sword"`,
así que ese estado no existe hoy. O se dice que no es alcanzable, o se deja de citar como cubierto.

## C4 — H2, menor y a criterio: el destello de impacto no es afirmable

La tercera copia de la fórmula (la que se saltaba el cono frontal) es el único cambio visible
**sin candado**, porque `debugState` no publica su calidad. QA lo verificó a mano con la
proyección exacta —enemigo a la espalda: fórmula vieja **1.0**, nueva **0**— pero eso no queda
sujeto. Si publicar esa calidad es barato, hazlo; si no, decláralo como hueco conocido.

## Lo que NO se toca

- **El guion 23 de QA** (`23-telegraph-los-cinco-ataques-y-todo-suelo.mjs`) es suyo y está en
  verde con los 22 anteriores. No lo modifiques para que pase.
- **Las reservas de gusto** (el rojo muy saturado con halo; el relleno tiñe el suelo hasta
  quitarle identidad de material — los tablones pasan a naranja; el dial es
  `TELEGRAPH_FILL_MIN_A`) son del usuario, que está fuera. **Déjalas como están** y que las
  decida mirando.

## Gotcha que QA pagó y tú no tienes por qué volver a pagar

Tras un `git checkout`, **vite sigue sirviendo la versión anterior de un fichero de
`nefan-core`**. Hay que reiniciar el cliente antes de creerse un antes/después: si no, un
negativo sale falso-verde.

## Coste de máquina — restricción nueva de esta ronda

El usuario ha avisado de que la CPU va cargada. **Exporta `NEFAN_MUTATE_CONCURRENCY=3`** antes
de cualquier `npm run mutate`, y no corras la batería entera de QA más de una vez. El defecto
del repo (`floor(núcleos/2)` = 8 workers) asume una máquina libre, y no lo está.
