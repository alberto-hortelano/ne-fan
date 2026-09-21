# Crítica — Tanda AC (#605) · `scripts/mutacion.ts` troceado

**Veredicto: VIGENTE**, con tres correcciones de premisa y una de orden. Es deuda declarada de
lectura, no de medida: ningún número se mueve al hacerla, y hay que decirlo así en el issue al cerrar.

## El problema real, en una frase

`mutacion.ts` ha pasado de 738 líneas (`dfbd045a`, 2026-08-25) a **1.760** hoy (12 commits, +1.022
en 24 días, cada uno un verbo o un guardia nuevo), y quien toca `lotes` carga 1.760 líneas y 62
símbolos importados de `mutacion-huella.ts` (`mutacion.ts:64-146`). La solución propuesta (partir por
sujeto) ataca eso y solo eso: no cambia qué se mide ni quién lo sujeta.

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificación |
|---|---|
| «1.692 líneas y diez verbos» | 1.760 (`wc -l`); diez verbos en `VERBOS` (`mutacion.ts:1720-1731`). 58 líneas de cabecera + 89 de imports |
| «comparten poco más que el lector de la huella y los tipos» | **Falso a medias.** Medido por cierre de llamadas: `git`/`shaDelTag` los usan 5 verbos; `selloDeInforme`/`informesDelDirectorio`/`medidaDelDirectorio` los usan 5 (`traer`, `repartir`, `comparar`, `fusionar`, `manifiesto`); `leerCorrida`+`exigeDescargaLimpia`, 3. Y `comparar` tiene **39 líneas propias con un cierre de 356**, casi todo compartido con `repartir` (`contextoDeLaCorrida`, `repartosDeLaCorrida`, `hallazgosNuevos`, `huellaEnRevision`). «Un módulo por verbo» duplicaría eso; el corte honesto es por cierre |
| «es el fichero donde vive el veredicto de adopción» | **Obsoleto desde el día antes del issue.** `veredictoDeCorrida` está en `mutacion-huella.ts` desde #276 y `comparaEnSeco` en `mutacion-comparar.ts` (499 líneas, nacido en #581 el 09-14, candado `comparar-solo-lee` en `arch-rules.json:990`). En `mutacion.ts` solo queda el cableado del verbo (`mutacion.ts:1155-1201`) |
| «`scripts/` fuera de mutación y de CRAP» | Cierto: `crap-score.ts:42` `MEDIDOS = ["src/","bridge/","services/"]`; el perímetro de mutación lo define `core-puro-sin-node` (`arch-rules.json:186`), todo `src/**` |
| «lo único que lo sujeta son los `qa/mutacion-*-en-negativo.mjs`» | Casi. Cuatro ficheros: `cableado` (20 invariantes, **14 con `rompe` sobre `MUT` por texto exacto**, ~26 s, en CI `ci.yml:294`), `reparto-en-lotes` (9, 2 sobre `MUT`; ~4 min, `--solo-vigentes` ~7 s en CI `ci.yml:270`), `candados` (rompe la huella, no este fichero), `la-septima`. Ejercen el verbo por CLI (`cableado:90`, `npm run mutacion`), así que la CONDUCTA se comprueba igual tras el corte; lo que se rompe es la **ruta** de los 16 `rompe` y los mapas `fuentes` (`cableado:744`, `lotes:557`). Falla en voz alta: «patrón obsoleto» (`cableado:796-801`). Además hay **dos tests** que nombran el fichero: `test/afectado.test.ts:304` (instrumento, derivado del grafo → los trozos entran solos) y `:1297-1318` (censo textual de `"diff","--name-only"` en `afectado.ts`+`mutacion.ts`, exige ≥5; hoy 3+2). Si los `git diff` se mueven a otro fichero, ese censo baja a 3 y se pone rojo — bien —, pero si se mueven y alguien añade la ruta nueva al `GUIONES` sin más, vuelve a ser ciego al resto de `scripts/mutacion/` |
| «el patrón de #358 y #346» | No transfiere del todo: allí el corte movía CRAP y módulos de mutación (números que se ven en `deuda`). Aquí **no mueve ningún número**; el beneficio es de lectura y no lo verá ninguna herramienta |

## El día después

- Para quien juega: nada. Deuda declarada (label `deuda`), aceptado.
- Qué se vuelve más difícil: los 16 `rompe` por texto quedan repartidos en N ficheros; un
  refactor posterior dentro de `scripts/mutacion/` tiene que tocar los dos `.mjs` otra vez.
- Qué habría que borrar: el bloque de cabecera de 58 líneas (`mutacion.ts:1-58`) habla de «este
  fichero»; parte se queda, parte va con cada trozo. Y el guardia `if (process.argv[1]?.endsWith("mutacion.ts")) main()`
  (`:1760`) existe porque `mutate.ts:58` y `deuda.ts:40` IMPORTAN de `mutacion.ts`; si los 7 exports
  (`TAG`, `leerHuella`, `costeDe`, `estimaCoste`, `segundosDe`, `ficherosDesdeElTag`, `seleccionDesdeElTag`)
  se van a un módulo sin `main`, ese guardia sobra y probablemente nadie lo quite.
- Qué parecerá arbitrario en un mes: `mutacion.ts` en cuatro trozos y `mutacion-huella.ts` con
  **2.383 líneas** en uno solo — y ése sí está medido (`candados-en-negativo`). No es alcance de
  esta tanda; se apunta.

## Conflictos

- **Ninguna de las otras 13 tandas toca `mutacion.ts`, `mutacion-huella.ts` ni `qa/mutacion-*.mjs`**
  (grep sobre los 14 `requisitos.md`: la única mención es `npm run mutacion -- pendiente` en T).
- **Dependencia oculta con la tanda T (corrida).** `mutacion.ts` es instrumento de medida
  (`afectado.ts:136,141`), y un diff sobre el instrumento fuerza la COMPLETA (`afectado.ts:573-580`,
  `todos: true`; test `afectado.test.ts:296`). Consecuencia doble: (1) la PR de AC, fusionada, pone
  `pendiente` = corrida entera (~20 min de runner, 0 minutos de persona; las dos últimas ya fueron
  completas); (2) **la atribución nombra a las PR del rango cuyo diff selecciona el módulo**
  (`mutacion-huella.ts:1244`), y una PR que selecciona TODOS sale como co-candidata de **cada
  superviviente nuevo** de esa corrida. T espera esa corrida para cerrar #675/#676. Orden que lo
  resuelve: fusionar AC **después** de que la corrida de T esté repartida; si no, aceptar por escrito
  que #605 aparecerá «o» al lado de cualquier dueño nuevo. No es bloqueo: es orden de fusión.

## Coste contra valor

- Coste: un contexto de ingeniero; mover código sin tocarlo (los `rompe` casan por texto exacto: el
  cuerpo tiene que quedar byte a byte); repuntar 16 triples + 2 mapas en `qa/` (→ regla de la casa:
  medir lo tocado, `cableado` 3×26 s y `lotes --solo-vigentes` 3×7 s); actualizar `GUIONES` en
  `afectado.test.ts:1297`; una corrida completa forzada.
- Valor: cero en cualquier medida; lectura y contexto para el siguiente que añada un verbo (ha pasado
  seis veces en dos semanas: `f9000a56` +259, `73570255` +365, `7ac698ee` +162, `0331509d` +133…).
- **«No hacer nada» es defendible con número**: el coste medido del monolito es 0 —ningún hallazgo
  de las nueve tandas de QA se atribuye al tamaño del fichero, y las 14 reversiones que importan
  siguen cazadas por texto exacto sea el fichero uno o cuatro. Si el usuario prefiere gastar el
  contexto en un issue de núcleo, cerrar #605 en «no se adopta, coste medido 0» es honesto. Se hace
  porque es barata, el mandato es vaciar la cola y la curva (+1.022 en 24 días) no va a parar sola.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

```
## Correcciones del crítico (2026-09-18)

- Cifras de hoy: 1.760 líneas (no 1.692). El veredicto de adopción NO vive aquí: está en
  `mutacion-huella.ts` (`veredictoDeCorrida`) y `mutacion-comparar.ts` (`comparaEnSeco`, #581).
- Criterio 1, matiz: el corte es por CIERRE DE LLAMADAS, no por verbo. `comparar` son 39 líneas
  propias sobre un cierre de 356 compartido con `repartir`; `traer`/`fusionar`/`manifiesto` comparten
  el sello y la lectura de informes. Un fichero por verbo duplicaría eso y queda PROHIBIDO.
- Criterio 2, añadir: los 16 `rompe` de `qa/mutacion-cableado-en-negativo.mjs` (14) y
  `qa/mutacion-reparto-en-lotes.mjs` (2) casan por TEXTO EXACTO contra `MUT`: se cambia la ruta del
  triple y el mapa `fuentes`, y el cuerpo movido queda byte a byte. Medido lo tocado: 3× cada uno,
  aislado y en par. Y `test/afectado.test.ts:1297` (`GUIONES`) tiene que censar TODOS los ficheros
  nuevos que hagan `git diff --name-only`, no solo el que quede en el sitio de hoy.
- Criterio 4, ya decidido por el árbol: los trozos entran en typecheck (`tsconfig.scripts.json`
  `scripts/**/*.ts`), lint y las reglas de `arch-rules.json` que globan `nefan-core/scripts/**/*.ts`
  SOLOS; y en el instrumento de medida por grafo (`instrumentoDeMedida`). No entran en CRAP ni en
  mutación por DEFINICIÓN del perímetro (src/ · bridge/ · services/), no por exención: no hay nada
  que escribir en `mutation-targets.json` ni en `quality-thresholds.json`. Un test unitario del
  delta ya existe (`candados-en-negativo` sobre la huella); no se añade otro.
- Orden de fusión: DESPUÉS de repartir la corrida que pide la tanda T, o se declara en la PR que
  #605 saldrá co-candidato de todo superviviente nuevo de esa corrida (diff de instrumento ⇒ todos).
- Al cerrar el issue: decir que no mueve ningún número y que el beneficio es de lectura.
```
