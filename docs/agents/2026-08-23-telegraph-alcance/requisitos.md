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
