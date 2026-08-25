# VIGENTE (#184) · REENCUADRADA (#185)

#184 está bien apuntado: adelante sin cambios (y es MAYOR de lo que dice). #185 tiene el problema real con el
alcance equivocado: lo presenta como riesgo futuro cuando **ya se dispara con una escena legal y ordinaria**, así que
no falta solo un candado — falta corregir la constante que vigilaría. La sospecha del coordinador (un candado falso)
**queda tumbada**.

## El problema real, en una frase

- **#184** — el parche no puede comunicar *alcance* porque su visibilidad (la alfa) y su significado (el color)
son la misma variable con signo opuesto: cuanto más importa un píxel para saber dónde acaba el área, menos se ve.
- **#185** — `GROUND_OVERLAY_Y` se fijó midiendo dos fixtures en vez de acotando lo que el generador puede
producir, y el generador no tiene tope.

## La premisa, afirmación por afirmación

**#184 · «la alfa ES la calidad» + «la rampa roja no se ve nunca»** — CIERTAS las dos, y vigentes hoy (el último
commit sobre el fichero, `cf7b446`, no rozó el fragment). `nefan-html/src/renderer/fps-gl.ts:164` → `float a = mix(vQ,
step(0.001, vQ), uImpact) * uOpacity;`: en wind-up queda `a = vQ * uOpacity`, con `uOpacity` acotada a 1 (`:958`). El
color es `mix(rojo, verde, vQ)` (`:163`), así que rojo puro exige `vQ == 0`, y ahí `a == 0` con `discard` a `a <=
0.004` (`:165`). El perímetro es exactamente `vQ == 0`: `fillTelegraphQuality` (`:392-405`) calcula `q = dist * prec *
front`, con `prec` nula en `|s| == area_radius` y `dist` nula en el borde de la tolerancia — es un producto, y basta
que un factor caiga para borrar el píxel.

**#184 es MAYOR de lo que dice**: hay un tercer límite invisible que el issue no menciona. `front` es un escalón
duro (`u / d > 0.5 ? 1 : 0`, `:401`), el cono de ±60° de `isInFront`; fuera de él la calidad es 0 y el parche
desaparece sin degradado, así que el jugador tampoco ve **el arco** que cubre el ataque.

**#185 · «lo sube el stagger de 2 mm por prim, sin tope de N»** — CIERTO (`fps-spec.ts:48` y `:286`, con
`groundIdx` monótono creciente). **¿Y cuántas prims planas puede emitir `fps-spec`?** No acotado a nada útil:
`MAX_GROUND_FEATURES = 64` (`ground.ts:129`) acota *rasgos*, no *prims* — un `path` admite 16 puntos (`ground.ts:46`)
y emite (n−1) cajas + n juntas. Medido ejecutando `buildFpsTileSpec` de verdad:

| Tile | rasgos | prims planas | cara alta | vs. 0,2 m |
|---|---|---|---|---|
| 8 caminos 4 pts + 6 plazas (pueblo) | 14 | 62 | 0,1690 m | 31 mm de margen |
| **río + 4 embarcaderos + 6 caminos 5 pts + 4 plazas (puerto)** | **15** | **63** | **0,2160 m** | **ENTIERRA** |
| 64 caminos de 16 pts (tope del schema) | 64 | 477 | 0,9990 m | ENTIERRA por 80 cm |

Quince rasgos de los 64 permitidos ya lo entierran: no hace falta un tile patológico, hace falta un embarcadero,
porque `deck` arranca en `Y_DECK = 0.18` celdas (`greybox.ts:57`) = 0,09 m, el doble que un camino. El comentario de
`fps-gl.ts:66-72` («la cara alta queda en 0,13 m») describe una muestra con exactitud y **la generaliza a un rango que
no le corresponde**: ese es el defecto, y por eso #185 no es solo un candado.

**La sospecha del candado falso** — **REFUTADA en sus dos mitades**. El test vive en
`nefan-core/test/surfaces.test.ts:246-284`, no en `nefan-html` (el requisitos apunta al paquete equivocado). (1) *«un
0.004 que no casa con el 0.002»*: no hay desajuste — el `60 * 0.004` de `:262` está en **celdas**, y `TILE_MPC = 0.5`
(`tile.ts:16`) ⇒ 0,002 m = 0,004 celdas: misma constante en otra unidad, con holgura para 60 prims. (2) *«no puede
ponerse rojo»*: se pone — comprobado mutando la constante y ejecutando, con `GROUND_STAGGER_M = 0.02` falla, y con `=
0` también (deja de cumplirse `new Set(ys).size === ys.length`); árbol restaurado. Lo cierto es más fino: la cota de
`assert.ok(lift <= specGround.length * 0.002)` (`:275`) es proporcional a N —fija el escalón *por prim* y calla sobre
la altura *total*—, pero ese test nunca fue un candado de altura: su sujeto es el z-fighting, y para eso funciona.
**Falta un candado; no sobra uno falso.**

**«¿Choca con lógica en core, el cliente solo pinta?»** — No: `fps-renderer.ts:14` ya importa `buildFpsTileSpec`
vía `@nefan-core/*` (`nefan-html/tsconfig.json:13`). El obstáculo real es otro y no está en el requisitos:
**`nefan-html` no tiene test harness** (ni `test/`, ni script `test`), así que el candado no puede vivir donde
vive `GROUND_OVERLAY_Y`.

## El día después

- **Para quien juega**: ve el contorno del área, no una mancha verde flotando, y deja de combatir a ciegas en puertos.
- **Qué se vuelve más difícil**: el suelo de alfa hace el parche más presente **siempre**, también cuando estorba (interiores, NPC a los pies): el riesgo pasa de «no se ve» a «tapa».
- **Qué borrar / qué parecerá arbitrario**: el comentario de `fps-gl.ts:66-72`, que miente en cuanto se toque el número; y un `GROUND_OVERLAY_Y` a mano, que derivado del core se explicaría solo.

## Conflictos

Ninguno externo. Barridos los 23 issues abiertos: nadie más toca el telegraph ni `GROUND_OVERLAY_Y`; el vecino más
próximo, **#174** (scatter sobre caminos), comparte los rasgos `ground` pero no su altura, y `arch-rules.json` calla
sobre el overlay. #184 y #185 sí se pisan (mismo fichero, mismo parche, mismas capturas): separarlos paga dos veces el
QA visual, así que la fusión del requisitos es buena.

## Coste contra valor

Barato y rentable. #184 es un suelo de alfa en un shader de cinco líneas; #185, derivar una cota del generador y
compararla con la constante. No hacer nada significa que el síntoma que acaba de arreglar la PR #183 vuelve solo en
cuanto el motor genere un puerto — sin que nadie lo relacione con el suelo, porque el jugador solo verá que el
telegraph «a veces no está».

## Qué le cambiaría a `requisitos.md`

Sustituir el bullet de **#185**:

> **#185** — el parche se dibuja a `GROUND_OVERLAY_Y` = 0,2 m, número medido sobre dos fixtures del golden en vez
> de acotado contra lo que el generador puede producir. Lo sube el stagger de 2 mm por prim (`fps-spec.ts:286`), y
> `MAX_GROUND_FEATURES = 64` acota *rasgos*, no *prims*: un `path` de 16 puntos emite 31. **No es un riesgo
> futuro: un tile de puerto con 15 rasgos (río, 4 embarcaderos, 6 caminos, 4 plazas) deja la cara alta en 0,216 m
> y ya entierra el telegraph.** La tarea es doble: corregir la cota y candarla contra el generador.

Sustituir la tercera viñeta de **«Lo que hay que verificar»**:

> El test de `stagger anti z-fighting` está en `nefan-core/test/surfaces.test.ts:246-284` (no en `nefan-html`) y
> **sí se pone rojo**: verificado mutando `GROUND_STAGGER_M` a `0.02` y a `0`. Su `0.004` es el `0.002` en celdas
> (`TILE_MPC = 0.5`), no un desajuste. Su cota de `:275` es proporcional a N —fija el escalón por prim, no la
> altura total—, pero su sujeto es el z-fighting, no el margen: no se toca, se añade un candado nuevo. Y
> `nefan-html` no tiene harness propio (el único es el de `nefan-core`), así que el candado no puede vivir junto
> a `GROUND_OVERLAY_Y` sin mover la constante — decisión del arquitecto.

Añadir a **#184**: «Hay un tercer límite invisible además del radial: `front` es un escalón duro de ±60°
(`fps-gl.ts:401`), así que el arco del cono también desaparece sin degradado.»
