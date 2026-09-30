**REENCUADRADA** — «ahí no faltan asertos, faltan tests» es falso para `footprint.ts` (sus 86 `NoCoverage` los ejerce la suite, 0 nadie) y cierto solo para 46 de los 169 de `volume-prims.ts`. El agujero de jugador más claro está en `collision.ts`, que el requisito deja fuera del núcleo, y 75 de los 79 de `ground-prims.ts` son código muerto que se borra.

## El problema real, en una frase
Hay ramas del greybox y de la colisión a las que el contrato deja llegar y de las que ningún test dice qué forma pintan ni por dónde se pasa. Esas ramas son muchas menos que los `NoCoverage`: esa cifra es por BATERÍA, no por suite.

## La premisa, afirmación por afirmación
Método: suite entera (`test/*.test.ts`, 3913 tests, 3m52s) con `NODE_V8_COVERAGE` y los offsets llevados a líneas con el `source-map-cache`. Cada mutante `NoCoverage` de la corrida 36684509746 queda clasificado: o lo ejecuta algún test de la suite, o no lo ejecuta ninguno. `git log 0afb76c3..HEAD -- nefan-core/src/scene/` sale vacío, así que los informes siguen describiendo el código de hoy.

| Fichero | NoCov | No lo ejecuta NINGÚN test | Quién ejecuta el resto |
|---|---|---|---|
| `greybox/volume-prims.ts` | 169 | **46** | `fps-atlas-golden` (117), `surfaces` (112): digests |
| `blueprint/footprint.ts` | 86 | **0** | `fps-atlas-golden` (86), `surfaces` (72), `fake-motor-contract` (70) y 20 ficheros más |
| `blueprint/collision.ts` | 72 | **18** | `scene-validate-golden` (54): golden |
| `blueprint/ground-prims.ts` | 79 | **75** | — |
| `fps-detail.ts` | 49 | 30 | (fuera: no es forma ni huella) |

- **Los 46 de `volume-prims`, todos alcanzables desde el zod**: `customPartSize` y `customPartAabb` con cilindro+`rTop`, cono y esfera (`:34-37`, `:104-112`, 30; `volumes.ts:284` los admite); tejado `flat` (`:243`, 7; `volumes.ts:119`); puerta en el borde `w` (`:281`, 6; `volumes.ts:122`); `carve` (`:164-165`, 2); `angle` de un prop (`:414`, 1). Sin rama muerta: se testean.
- **Los 18 de `collision.ts` son la vía libre de un `gate` con `orient:"y"`** (`clearGatePassage`, `:218-220`). En toda la suite `clearGatePassage` corre 7 veces, y las 7 con `orient:"x"` (`blueprint-collision.test.ts:75,91`). El único gate en `y` de los tests está en `test/fixtures/fps-plans/medieval.json:207` y solo alimenta el golden del atlas. **Nadie comprueba que por una puerta en un muro norte-sur se pueda pasar.** El zod la admite (`volumes.ts:205`).
- **Los 54 restantes de `collision.ts`** son los huecos de puerta `n`/`w`/`e` de un edificio `cutaway` (`:151-164`). Solo los ejecuta un golden. Para quien juega es «¿puedo entrar por esa puerta?», y hoy ningún aserto lo dice.
- **`ground-prims.ts`: 75 son código muerto.** `catmullRomSample` se invoca **0 veces** en la suite. Su único camino es `smoothPathSubdiv` (`:83`, `:124`), y el único llamante (`greybox.ts:162-167`) no lo pasa. Su docblock lo confiesa: «el suavizado de caminos del plató; el tile no lo usa» (`:46-48`), y el plató se retiró. Lo reexporta `index.ts:33` y no lo importa nadie. Tampoco hay quien pase `colors` ni `ellipseSegments`. Esto se **borra**, no se testea.
- **`footprint.ts` no es «la huella que colisiona» salvo para `gate` y `custom`** (`collision.ts:289,308`). La torre, la fuente, la roca y el prop-punto colisionan por `volumeSolidDiscRadiusCells` (`collision.ts:251-266`, `volume-metrics.ts` casos tower/rock/fountain/prop). Las ramas `NoCoverage` de `volumeFootprint` alimentan la exclusión del scatter (`scatter.ts:461`), el derive (`derive.ts:110`) y la forma pintada del prop (`volume-prims.ts:409`).
- **`depthPoint` es una salida muerta.** Sin consumidor fuera de `footprint.ts` (grep en `nefan-core/src`, `bridge`, `nefan-html/src` y tests): era la clave del orden del pintor de la vista oblicua. Carga unos 29 mutantes (19 `NoCoverage`, 8 `Survived`) que ningún test honrado puede matar.
- **«Se verifica con `npm run ejercicio`»**: no. Lo corrí sobre los tres módulos y sale verde **hoy** («Todas las baterías EJERCEN lo que su módulo muta», 0,8 s). Cuenta invocaciones por FICHERO y aquí falta por RAMA, así que no puede ponerse rojo por esta tarea.

## El día después
- Para quien juega: si el test de la puerta en `y` o de las puertas `w`/`e` sale rojo, se destapa un muro que no se puede cruzar, y eso sí se juega. Del resto, nada visible. Es deuda declarada.
- Se borran cerca de 75 mutantes de `ground-prims` y unos 29 de `depthPoint`. **El score de `blueprint-suelo` sube sin un solo test nuevo**: hay que decirlo así en la PR y no venderlo como cobertura.
- Queda arbitrario, y hay que fijarlo a propósito en un test: el prop-punto se **pinta** con radio 1,4 (`footprint.ts:60` → `propPrims`) y **colisiona** con 1,3 (`collision.ts:260`). «Render ≠ colisión» lo permite, pero lo que se ponga en el aserto debe ser una decisión y no una copia del número.

## Conflictos
Ninguno. En la cola solo quedan #782 (BU, `scene-normalize`/`SceneRecord`) y #361-#363 (plugins aparcados). BU no toca estos ficheros. Nota ajena: `npm test` en el árbol principal da 1 rojo (`nadie-inventa-un-puerto`) por `labs/narrative/runs/tanda-bm-20260929/fase2/*.mjs`, que está ignorado. Es material de sesión, no de esta tarea.

## Coste contra valor
Borrar el código muerto es barato y seguro, y tiene el mayor retorno en mutantes. Los tests de colisión, 18 + 54, son el valor de jugador y cuestan poco. Los 46 de `volume-prims` son forma pintada, con un valor modesto y un coste bajo. Los 123 + 67 que hoy solo ejecuta un golden **no deben cerrarse metiendo `fps-atlas-golden`/`surfaces` en la batería**. Eso los pasa a `Killed` por un digest que dice «algo cambió» y no «esto está bien», y la petición pide asertos sobre la forma y la huella. Si no se hiciera nunca: el riesgo concreto es la puerta en `y` y los huecos `n`/`w`/`e`. Lo demás es deuda que ya está medida.

## Qué le cambiaría a `requisitos.md` (pegar bajo «Qué se pide»)

> **Reencuadre del crítico (medido sobre la suite entera, no por batería).** Los `NoCoverage` son por batería. Ejecutados por NINGÚN test: volume-prims 46/169, footprint 0/86, collision 18/72, ground-prims 75/79. El alcance queda así, por orden:
> 1. **Borrar lo muerto**: `catmullRomSample`, `smoothPathSubdiv` y su reexport (`ground-prims.ts`, `index.ts:33`), los campos de `GroundPrimsOptions` que ningún llamante pasa, y `depthPoint` de `volumeFootprint`/`rotatedFootprint` (sin consumidor desde la retirada de la oblicua). Barrido de la prosa que los cita. El salto de score que produce se declara como borrado, no como test.
> 2. **Colisión, con asertos de paso**: un `gate` con `orient:"y"` deja cruzar el muro anfitrión (`clearGatePassage`, hoy 0 ejecuciones), y un `building` `cutaway` deja entrar por puertas `n`, `w` y `e` (hoy solo las ejecuta un golden).
> 3. **Forma pintada**: las 46 ramas de `volume-prims.ts` sin ejecutor (piezas custom cilindro+`rTop`/cono/esfera, tejado `flat`, puerta `w`, `carve`, prop con `angle`), con asertos sobre la geometría emitida.
> 4. `footprint.ts`: tras (1), sus ramas se afirman por sus consumidores reales (exclusión del scatter/derive, prop pintado, gate/custom en colisión), no por `volumeFootprint` suelto. La relación entre el radio pintado del prop-punto (1,4) y el que colisiona (1,3) se fija como decisión escrita.
> **Fuera**: `fps-detail.ts` y `plugins/dsl/paths.ts`. **No vale** meter `fps-atlas-golden`/`surfaces` en las baterías para convertir `NoCoverage` en muertes por digest.
> **Verificación**: `npm run ejercicio` es por fichero y hoy ya está verde, así que no la sirve. La prueba local es el mapa rama→ejecutor (suite con `NODE_V8_COVERAGE` + `source-map-cache`, unos 4 min): los 18 + 46 pasan a tener ejecutor y lo borrado desaparece. Opcionalmente, algunos mutantes aplicados a mano y revertidos (precedente #419). El score lo pone la próxima corrida autorizada. Los suelos (`break` 33/55/67) **no se tocan** hasta medir. Expectativa comprobable: `NoCoverage` a 0 en `collision.ts` y a ≤ 4 en `ground-prims.ts`, y en `volume-prims.ts` solo las que ejecuta el golden.
