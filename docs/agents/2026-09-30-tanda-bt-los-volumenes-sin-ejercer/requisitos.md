# Tanda BT — Los mutantes que ningún test ejerce en los volúmenes del greybox

## Petición del usuario (literal)

«Mutacion lanzada. Adelante con las dos» (2026-09-30). Responde a la propuesta del coordinador: «los mayores supervivientes de mutación sin ejercer están en `volume-prims.ts` (169) y `footprint.ts` (86): ahí no faltan asertos, faltan tests, y ya hay medida fresca».

## Lo medido (corrida 36684509746, 2026-09-30, sobre 0afb76c3; informes en `/home/al/code/ne-fan/nefan-core/reports/mutation/`, solo lectura)

- `src/scene/greybox/volume-prims.ts`: 535 vivos de 795 y 169 `NoCoverage`. Módulo `greybox-volumenes`, break 33 (junto a `greybox.ts` y `common.ts`).
- `src/scene/blueprint/footprint.ts`: 152 vivos de 227 y 86 `NoCoverage`. Módulo `blueprint-huella`, break 55 (junto a `collision.ts` y `volume-metrics.ts`).
- Otros ficheros con mucho `NoCoverage` en la misma corrida:
  - `blueprint/ground-prims.ts`: 79;
  - `blueprint/collision.ts`: 72;
  - `plugins/dsl/paths.ts`: 76 (plugins aparcados, queda fuera);
  - `fps-detail.ts`: 49.

## Qué se pide

Que las ramas de esos ficheros que ningún test ejerce pasen a tenerlo, empezando por `volume-prims.ts` y `footprint.ts`. Y que se ejerzan con asertos sobre lo que importa al jugador: la forma que se pinta y la huella que colisiona (memoria «Render ≠ colisión»). No basta con pasar por la línea. «Las métricas son síntomas»: si una rama sin test resulta inalcanzable desde el contrato (un tipo de volumen que el zod ya no admite, un defecto muerto), se borra en vez de testearla.

El crítico decide:
- el alcance: ¿solo esos dos, o también `ground-prims` y `collision`?;
- cómo se verifica. Los dos módulos pasan de sobra del `tope_local` de 120, así que `local` no los mide. La herramienta disponible es `npm run ejercicio`, y el resto irá a la próxima corrida autorizada. Hay que decir qué suelo se espera y no inventarlo.

## Restricciones

- Hay una corrida de mutación en marcha (36698868790) sobre `main` f6401993. No se toca el tag `mutacion-ultima` ni `reports/mutation/` del árbol principal.
- Todos los agentes en Opus. Guiones reservados: 330–339.
- NUNCA `git stash`. Para medir la base, `git worktree add` temporal en el scratchpad.
- En paralelo va la tanda BU (#782: el tipo de `scene_data` y `formatDToWorld`). BU toca `src/scene/scene-normalize.ts` y `SceneRecord`, no los builders greybox.

## Reencuadre del crítico (aceptado por el coordinador el 2026-09-30)


**Reencuadre del crítico (medido sobre la suite entera, no por batería).** Los `NoCoverage` son por batería. Ejecutados por NINGÚN test: volume-prims 46/169, footprint 0/86, collision 18/72, ground-prims 75/79. El alcance queda así, por orden:
1. **Borrar lo muerto**: `catmullRomSample`, `smoothPathSubdiv` y su reexport (`ground-prims.ts`, `index.ts:33`), los campos de `GroundPrimsOptions` que ningún llamante pasa, y `depthPoint` de `volumeFootprint`/`rotatedFootprint` (sin consumidor desde la retirada de la oblicua). Barrido de la prosa que los cita. El salto de score que produce se declara como borrado, no como test.
2. **Colisión, con asertos de paso**: un `gate` con `orient:"y"` deja cruzar el muro anfitrión (`clearGatePassage`, hoy 0 ejecuciones), y un `building` `cutaway` deja entrar por puertas `n`, `w` y `e` (hoy solo las ejecuta un golden).
3. **Forma pintada**: las 46 ramas de `volume-prims.ts` sin ejecutor (piezas custom cilindro+`rTop`/cono/esfera, tejado `flat`, puerta `w`, `carve`, prop con `angle`), con asertos sobre la geometría emitida.
4. `footprint.ts`: tras (1), sus ramas se afirman por sus consumidores reales (exclusión del scatter/derive, prop pintado, gate/custom en colisión), no por `volumeFootprint` suelto. La relación entre el radio pintado del prop-punto (1,4) y el que colisiona (1,3) se fija como decisión escrita.
**Fuera**: `fps-detail.ts` y `plugins/dsl/paths.ts`. **No vale** meter `fps-atlas-golden`/`surfaces` en las baterías para convertir `NoCoverage` en muertes por digest.
**Verificación**: `npm run ejercicio` es por fichero y hoy ya está verde, así que no la sirve. La prueba local es el mapa rama→ejecutor (suite con `NODE_V8_COVERAGE` + `source-map-cache`, unos 4 min): los 18 + 46 pasan a tener ejecutor y lo borrado desaparece. Opcionalmente, algunos mutantes aplicados a mano y revertidos (precedente #419). El score lo pone la próxima corrida autorizada. Los suelos (`break` 33/55/67) **no se tocan** hasta medir. Expectativa comprobable: `NoCoverage` a 0 en `collision.ts` y a ≤ 4 en `ground-prims.ts`, y en `volume-prims.ts` solo las que ejecuta el golden.
