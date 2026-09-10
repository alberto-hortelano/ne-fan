# Triaje: las herramientas que miden (17 issues)

Verificado contra `main` = `5d67c8ca` el 2026-09-10, en solo lectura. Ninguna corrida de mutación,
ninguna corrida de cobertura: los números de HOY salen del log de CI de la última corrida verde de
`main` (`ba6b534e`, run `34451514617`, 07:49 UTC) y del `coverage/lcov.info` del árbol (5-sep).

| # | Qué dice | Veredicto |
|---|---|---|
| 356 | el `if` de precondición sale verde | **VIGENTE**, pero el coste se ha DOBLADO — reencuadrar el alcance |
| 388 | la cobertura cobra por tipar y documentar | **YA CUBIERTO POR #525** (mismo defecto, misma cura) |
| 429 | el tope local mide con la huella vieja | **VIGENTE** |
| 430 | narrative-state/session-storage fuera por coste de batería | **PREMATURA** — la contesta #443 |
| 431 | `registerSceneNpcs` CRAP 59 sin sujeto | **VIGENTE** (hoy 56,5; sigue siendo el peor de la casa) |
| 432 | el score lo calcula código que ningún test toca | **VIGENTE** |
| 436 | la cadena del reloj: 1 de 4 eslabones con candado | **VIGENTE** — fusionar con #437 |
| 437 | cuatro formas de romper el reparto en lotes | **VIGENTE** — fusionar con #436 |
| 441 | `scene-validate` es el 20 % del reloj | **REENCUADRADO** — el 70 % de su coste no es la batería |
| 442 | el loader recibe el directorio por parámetro | **VIGENTE** (latente) — fusionar con #444 y #473 |
| 443 | `perTest` es no-op; `tap-runner` sí filtraría | **VIGENTE** + **DECISIÓN DEL USUARIO** (gasta corrida) |
| 444 | ruta por concatenación: descarte silencioso | **VIGENTE** (latente) — fusionar |
| 462 | nadie mide `dispatcher.ts` ni `loadSession` | **VIGENTE y MAYOR de lo que dice** |
| 473 | `importadoresEn` no ve un import de directorio | **VIGENTE** (latente) — fusionar |
| 495 | el suelo está a 0,009 de la base | **YA CUBIERTO POR #525** |
| 525 | el suelo cuenta los comentarios en el denominador | **VIGENTE — CIERTO, y peor de lo que dice** |
| 541 | `cola` aconseja bajar `max-parallel` al revés | **VIGENTE** |

Cero caducados. Es coherente con el censo de agosto en una cosa y lo contradice en otra: el material
de estos issues es de hace 3-6 días y ninguno ha muerto, pero **cuatro cifras han cambiado** (#356,
#430, #431, #441) y en tres de los cuatro casos **a peor**.

---

## #525 · El suelo de cobertura cuenta los comentarios — **VIGENTE, y peor**

**Es cierto.** Y el mecanismo es más ancho que «los comentarios»: lo que V8 marca como no cubierto
es **todo el prólogo del fichero**, hasta la primera sentencia ejecutable de nivel superior —
cabecera, `interface`, `type` y los comentarios que los acompañan.

Evidencia directa, sin correr cobertura (`coverage/lcov.info` + el fuente):

```
src/scene/aim.ts      114/165 = 69,1 %  · las 51 líneas «no cubiertas» son las 1-56: cabecera,
                                           4 interfaces y un comentario. Desde la 57 (primera
                                           función) todo está cubierto.
src/simulation/mirada.ts  110/110 = 100 %  · idéntico de probado, pero tiene un `export const`
                                             en la línea 21, así que su cabecera cuenta CUBIERTA.
```

**La cifra que pedías.** Recontando el mismo lcov sin comentarios ni líneas en blanco:

| | líneas | cobertura |
|---|---|---|
| como lo mide el gate hoy | 26.152 / 29.355 | **89,089 %** |
| solo líneas con código | 18.122 / 19.177 | **94,499 %** |

- **10.178 de las 29.355 líneas del denominador (34,7 %) son comentario o blanco.**
- **2.148 de ellas cuentan como NO cubiertas** — o sea **el 67 % de las 3.203 líneas «descubiertas»
  que vigila el gate son prosa**.
- **136 de los 161 ficheros medidos (84 %)** tienen prólogo no cubierto: **1.796 líneas**, el 56 %
  de todo lo descubierto. Peores: `session/entidades-del-tile.ts` (51), `protocol/status-motivo.ts`
  (44), `protocol/escena-servida.ts` (36 de 45 descubiertas sobre 59 líneas → mide 24 %).

**Dos correcciones a la premisa con la que me lo mandaste, las dos importantes:**

1. **`crap --check` SÍ lo corre el CI.** `.github/workflows/ci.yml:69-70` (`npm run coverage` →
   `npm run crap -- --check`), y el workflow dispara `on: push: branches: [main]`. Lo que no lo
   corre es `verify` (local, a propósito, decisión del usuario del 2026-08-27, comentada en
   `ci.yml:64-68`).
2. **`main` NO está rojo en CI: está rojo en LOCAL y verde en CI.** El log de `ba6b534e` (hoy,
   07:49 UTC) dice `cobertura de líneas 89.1%` · `✔ dentro de los umbrales`. Y el comentario de
   #525 del 2026-09-07 mide lo contrario en la máquina de quien programa: **«en local `crap --check`
   sale rojo ya sobre `main` (88,96 %)»**. La brecha entre entornos (+0,6 documentada en
   `quality-thresholds.json`) es lo único que sostiene el verde.

Eso es peor que un rojo silencioso: el ingeniero ve rojo, el CI ve verde, y la reacción natural es
aprender a ignorar el rojo — exactamente `feedback_verde_que_no_comprueba`.

**Margen hoy: 0,1 puntos ≈ 30 líneas de 29.355.** Los ~40 renglones de cabecera del siguiente
módulo puro se lo comen. Tu intuición («cada módulo documentado de #241 y #346 lo ha empujado») la
confirma la traza de CI: `17038fc7` 89,3 → `1daea547` 89,2 → `ba6b534e` **89,1**.

**Qué hacer.** Arreglarlo, no decidirlo: es una herramienta que miente. El arreglo cabe entero en
`scripts/crap-score.ts` — la función `crapRows()` (líneas ~185-215) ya sabe descartar líneas no
ejecutables **por función** (`if (h === undefined) continue; // línea no ejecutable`) y no lo hace
en el denominador global. Ese fichero ya tiene el AST de TypeScript cargado. Y **cerrar #388 y #495
contra este**. Criterio de aceptación heredado de #388, que es el bueno: `aim.ts` y `mirada.ts`
tienen que medir parecido (hoy se llevan 31 puntos).

**Lo que NO se hace, y hay que decirlo porque los dos issues lo tientan**: bajar el suelo, ni apretar
prosa. Al re-basar sobre líneas ejecutables el suelo SUBE (89 → ~94 medido), que es la dirección
permitida.

## #388 · La cobertura cobra por tipar y documentar — **YA CUBIERTO POR #525**

Mismo defecto, misma cura, mismo fichero. #388 es el más antiguo y el mejor analizado (trae el
criterio de aceptación `aim.ts` ≈ `mirada.ts`); #525 trae la causa raíz (`--enable-source-maps`) y
la prueba de que hoy muerde. **Uno de los dos se cierra apuntando al otro**; recomiendo conservar
#525 y copiar en él el criterio de #388.

## #495 · El suelo a 0,009 de la base — **YA CUBIERTO POR #525**

Su punto 2 («subir la cobertura de la base por encima del ruido») ataca el síntoma. El ruido medido
en su comentario es ±0,10 sobre un margen de 0,06-0,09; con el denominador correcto el margen pasa
a ser de puntos enteros y el ruido deja de decidir. Su punto 3 (medir con
`NEFAN_TEST_CONCURRENCY=1`) sigue valiendo como comprobación, no como issue propio. **Cerrar contra
#525**, arrastrando su medida de varianza al cuerpo.

## #429 · El tope local mide con la huella de la última corrida — **VIGENTE**

Verificado línea a línea. `costeDe` (`scripts/mutacion.ts:254-260`) suma `m.total` de
`data/contract/mutacion-huella.json` — la foto de la última corrida autorizada — y `permisoLocal`
(`scripts/mutacion-huella.ts:940-967`) decide con eso. `scripts/mutate.ts:229-240` pide el permiso
**antes** de arrancar Stryker, así que el número real de mutantes no se consulta nunca. Un módulo
que engorde después de la última corrida sigue pasando. **Lo arregla el ingeniero**; criterio de
cierre en negativo tal como está escrito (engordar sin corrida nueva ⇒ `local` rechaza).

## #430 · narrative-state y session-storage fuera de la mutación — **PREMATURA**

La exclusión sigue viva y **la batería ha crecido**: `mutation-targets.json`, módulo `serialize-llm`,
`mutate: [..., "!src/narrative/narrative-state.ts", "!src/narrative/session-storage.ts", ...]`.
Ficheros de test que los importan hoy: **21** y **18** (el issue decía 18 y 16). Con
`coverageAnalysis: "off"` cada uno de los ~900 mutantes paga los 21.

Su primera vía («acotar la batería por sujeto») está medida y **cuesta rigor**: el comentario de
#441 mide en `npc-director` −85 % de reloj a cambio de perder un mutante cuyo único verdugo vive en
otro fichero. Su segunda vía (`perTest`) **está muerta** y es #443. Así que este issue no se puede
contestar antes que #443. **Bloquearlo ahí**, y anotarlo en el cuerpo.

## #431 · `registerSceneNpcs` CRAP 59 sin sujeto — **VIGENTE**, cifra corregida

Hoy, medido en CI sobre `main` (`ba6b534e`): **CRAP 56,5 · cx 44 · cob 81 %** —
`src/narrative/npc-records.ts:14`. Sigue siendo **el peor de la casa** por margen (el segundo es 46,8).
No existe `test/npc-records.test.ts`: `ls test/ | grep -i npc` da `bridge-npc`, `hablar-con-un-npc`,
`npc-behavior`, `npc-director`. El 81 % sigue viniendo de pasar por encima. **Lo hace el ingeniero**:
test con sujeto (registro, reemplazo, purga) y entrada en la totalidad de mutación.

## #432 · El score lo calcula código que ningún test toca — **VIGENTE**

`grep -rln "resumenDeMutantes\|esVivo\|segundosDe\|costeDe\b" test/` → **cero ficheros**. Las cuatro
viven en `scripts/mutation-plan.ts:1014,1027` y `scripts/mutacion.ts:254,268`, y `scripts/` está
fuera del perímetro (`arch-rules.json`, regla `core-puro-sin-node`, `files:` no incluye `scripts/`).
De las dos vías del issue, la barata tiene precedente en el propio repo
(`test/mutacion-huella.test.ts`, `test/afectado.test.ts`, `test/deuda.test.ts`, `test/crap-score.test.ts`
ya existen): **tests directos sobre las funciones puras**. No hace falta preguntar nada.

## #436 · La cadena del reloj: 1 de 4 eslabones con candado — **VIGENTE**, fusionar con #437
## #437 · Cuatro formas de romper el reparto en lotes — **VIGENTE**, fusionar con #436

Los dos siguen enteros y **tienen el mismo criterio de cierre y el mismo fichero**, así que hacerlos
por separado paga dos veces la misma puesta en marcha.

- Los tres eslabones sin candado están declarados como deuda en
  `qa/mutacion-reparto-en-lotes.mjs:345,352,359` (`deuda: 436`), y el peor —`segundosDe` cambiando
  MÁXIMO por suma— sigue sin test: `scripts/mutacion.ts:268-274` lo declara solo en la prosa y en el
  tipo.
- De #437: los ítems 1 y 2 están declarados en `qa/mutacion-reparto-en-lotes.mjs:378,391`
  (`deuda: 437`). **Corrección al cuerpo**: el ítem 2 dice «ya tiene candado» y eso es medio falso —
  el positivo existe (línea 208, lista `VIGENTES`), pero el negativo no, y CI corre ese guion con
  `--solo-vigentes` (`ci.yml`, job `candados-headless`), así que la lista `ABIERTOS` **no se ejecuta
  en CI**.
- Los ítems 3 y 4 **no están declarados en ninguna parte** y siguen en el código:
  `scripts/mutacion.ts:889-898` — `argv.includes("--todos")` descarta `idsCrudos` sin decir nada, y
  `idsCrudos.split(/\s+/).filter(Boolean)` no deduplica (`moduloPorId` valida existencia, no
  unicidad).

## #441 · `scene-validate` es el 20 % del reloj — **REENCUADRADO**

El número **sigue siendo cierto y está actualizado** contra la huella de la corrida `34339870322`
(9-sep): `scene-validate` = **2.532 s de 13.268 s = 19,1 %**, con 826 mutantes en un solo fichero, y
`tope_lote` = 1.800, así que no cabe y va solo.

Lo que ha cambiado es **qué lo arregla**, y lo dice su propio comentario del 4-sep con un modelo
ajustado al 4 %: de esos 2.532 s, la batería explica ~760. **Los ~1.750 restantes son el flood-fill
128×128 ejecutado con la condición rota y los mutantes desbocados que agotan el `timeoutMS` de 10 s.**
O sea: las dos vías que el cuerpo propone atacan como mucho el 30 %, y una de las dos (`perTest`)
está muerta. **Reescribir el cuerpo**: la palanca es el tiempo que tarda un mutante en morir o
rendirse, no la batería. (Bajar `timeoutMS` no es aflojar un umbral: `stryker.config.json` documenta
que se verificó fichero a fichero que no cambia lo que se mide.)

Dato de paso que mata la nota final de #541: **los 55 módulos tienen ya reloj medido**, ninguno va a
lote propio por falta de cronómetro.

## #442 · El loader recibe el directorio por parámetro — **VIGENTE** (latente)
## #444 · Ruta por concatenación: descarte silencioso — **VIGENTE** (latente)
## #473 · `importadoresEn` no ve un import de directorio — **VIGENTE** (latente)

Los tres son el mismo agujero visto desde tres sitios, los tres están en `scripts/` y los tres son
latentes (hoy no hay ningún caso vivo). **Una sola tanda.**

- **#442**: `src/plugins/loader.ts:66` — `loadGamePluginManifests(gamesDir, gameId)` arma el
  directorio común con `resolve(gamesDir, "..", "plugins")`. `data/plugins` solo aparece en
  comentarios y mensajes de error. El análisis lo sabe y lo dice: el comentario de
  `scripts/mutation-plan.ts` (dentro de `analizaLectura`) **cita este fichero por su nombre** como el
  caso que produce un descubrimiento ciego.
- **#444**: `cabezaCompuesta` (`scripts/mutation-plan.ts`, justo encima de `analizaLectura`)
  devuelve `undefined` para cualquier cosa que no sea una llamada a `join`/`resolve`. En la pasada 3
  eso hace `donde === undefined` y **la llamada se salta entera**: no suma directorio y **tampoco
  incrementa `descubrimientosCiegos`**. Un `readFileSync(\`${DIR}/${x}.json\`)` es invisible y no lo
  reclama la totalidad. Exactamente como está escrito.
- **#473**: `importadoresEn` (`scripts/afectado.ts:783-786`) prefiltra con
  `gitGrepL(rev, nombre, CARGABLES)` donde `nombre` es el basename sin extensión. Para `x/index.ts`
  eso es `"index"`, y un importador que escriba `from "./x"` nunca entra en candidatos, aunque
  `resuelveSinDisco` sabría resolverlo. Descarta de más, que es la dirección peligrosa.

## #462 · Nadie mide `dispatcher.ts` ni `loadSession` — **VIGENTE y MAYOR**

Confirmado y **más grande de lo que dice el cuerpo**. `src/plugins/dispatcher.ts` no aparece en
ningún `mutate` de los 55 módulos **ni en `sin_mutar`**: el único módulo que toca `src/plugins` es
`plugins-dsl`, con `src/plugins/dsl/*.ts`. Y no salta el candado de huérfanos porque
**`src/plugins/**` no está en el perímetro**: `arch-rules.json`, regla `core-puro-sin-node`, lista
diez carpetas y `src/plugins` no es una de ellas (solo entra `src/plugins/dsl`, por
`directorios_completos`). O sea: no es «falta un módulo», es que **media carpeta está fuera de la
totalidad y nada lo declara**, que es la forma de fallo que la totalidad existe para hacer imposible.

Y no es un rincón frío: hoy, en CI, `applyToState · src/plugins/dispatcher.ts:325` mide **CRAP 29,2
con cx 10 y cobertura 42 %** — la peor cobertura de las 25 primeras funciones de la cola.

## #541 · `cola` aconseja bajar `max-parallel` al revés — **VIGENTE**

Verificado. `costeDeLaMatriz` (`scripts/mutacion-huella.ts:880-902`) calcula `esperaPeor` sobre
**todos** los jobs de la corrida y devuelve `cabe: esperas[0].s <= topeEsperaS`; `cola`
(`scripts/mutacion.ts:1116-1140`) imprime `BAJA max-parallel` y pone `process.exitCode = 1` sin
mirar de qué corrida se trata. La cabecera del verbo (líneas 1100-1112) distingue los dos usos **solo
en prosa**. Sobre la propia matriz, la espera es consecuencia de `max-parallel`: bajarlo la alarga.

Es un defecto que hace mentir a la herramienta, no una política ⇒ **se arregla, no se pregunta**.
`max-parallel: 6` se queda donde está hasta que exista la medida que falta (una PR normal lanzada
mientras la matriz corre), que sigue sin existir.

## #356 · El `if` de precondición sale verde — **VIGENTE**, y el coste se ha DOBLADO

La premisa está intacta: `ctx.sinMedirBloque` existe (`qa/run.mjs:746`) y se usa **27 veces**;
`ctx.bloque(titulo, fn)` **no existe** (0 usos en `qa/guiones/`). Declarar sigue siendo voluntario y
no declarar sigue siendo gratis.

Lo que ha cambiado es el precio de la vía que el arquitecto descartó por tamaño. Entonces eran
«50 guiones y 178 esperas». Hoy: **101 guiones**, **296 `ctx.waitFor` + 58 `ctx.expectEspera` = 354
esperas**. El argumento que lo descartó («a medio migrar no canda nada») pesa ahora el doble.

**Reencuadrar el alcance, no el problema.** El problema —no declarar sale gratis— es real y sigue
siendo la vía barata de dar por verde lo que no se midió. Lo que ya no se sostiene es la solución
que el cuerpo propone: **migrar 101 guiones no debería intentarse**. El issue tiene que pedir el
resultado (que saltarse un bloque sin declararlo se ponga rojo) y dejar la forma abierta.

---

## Orden recomendado

Delante, lo que desmiente una medida falsa; detrás, lo que baja el reloj; al final, lo latente.

1. **#525** (cerrando #388 y #495 contra él) — la única medida que **hoy** miente en `main`, en la
   dirección que castiga documentar, y con 0,1 puntos de margen. Cabe en un fichero.
2. **#541** — un rojo que aconseja lo contrario del dato. Barato, y un rojo así se aprende a ignorar
   en dos semanas (lección de T10).
3. **#429** — el gate que protege tu máquina decide con la foto de antes. Barato.
4. **#443** — la palanca de reloj más grande que existe (hoy cada mutante paga la batería entera de
   su módulo). Los pasos 2, 3 y 4 del issue se miden en local sin gastar nada; solo el paso 1
   (score idéntico fichero a fichero) necesita corrida autorizada.
5. **#441 reencuadrado** — 19 % del reloj en un módulo, y la palanca real es el `timeoutMS`/el
   flood-fill, no la batería.
6. **#436 + #437 fusionados** — si el segundo que decide el reparto se corrompe, volvemos al
   `timeout-minutes: 180` y esta vez sin nadie mirando.
7. **#432** — el score que decide «está medido» lo calcula código sin test. Barato y con precedente.
8. **#462** — media `src/plugins/` fuera de la totalidad, en el camino por el que un plugin escribe
   estado del jugador, con `applyToState` al 42 %.
9. **#431** — el peor CRAP de la casa (56,5) sin nadie que lo tenga por sujeto.
10. **#442 + #444 + #473 fusionados** — los tres agujeros latentes del selector, una tanda.
11. **#356 reencuadrado** — cuando esté escrito lo que se pide de verdad.
12. **#430** — cuando #443 tenga respuesta.

## Hallazgo fuera de los 17

`quality-thresholds.json` fija `crap.max` en **73** y describe al peor de la casa como `handle` del
asset-store con **69,2**. Hoy `handle` mide **46,8** y el peor es **56,5**: hay **16,5 puntos de
techo que no aprietan**. Por la regla escrita en ese mismo fichero («un techo que ya no aprieta es un
permiso, así que baja con él»), toca bajarlo — y es la dirección permitida. No abro issue: lo dejo
anotado para quien haga #525, que ya va a tocar ese contrato.
