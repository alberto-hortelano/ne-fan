# QA — PR 1 de la tanda E · #601 «la esquina»

Árbol `/home/al/code/ne-fan-qae1`, worktree desprendido sobre `5fe04988`. Batería de navegador con
`NEFAN_PORT_OFFSET=500`, preset `e2e-sin-creditos` y motor falso: **cero créditos** (el censo de la
corrida de mi guion dice «0 guion(es) tocaron alguna puerta»).

Todo lo que sigue está **medido hoy en este árbol**. Donde reproduzco un número del informe del
ingeniero lo digo, y donde mi medida no coincide con la suya, también.

---

## 1 · Criterios

| # | Criterio (de los requisitos y de lo que la PR promete) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | En diagonal contra una esquina **no se entra** en el edificio | ✅ cumple | Sonda propia: **117.000 carreras** contra cajas (5 tamaños × 5 relojes × 360 rumbos × 13 desvíos) → **0 entran**, penetración máx `0.000000` m. **16.200 carreras** contra el colisionador de CELDAS (el muro del plan) → **0 solapan**. Control con la base: 508 / 236 / 120 entran, hasta **7,399 m** de penetración |
| 2 | …y tampoco **se cruza entero** una vez dentro | ✅ cumple | Tabla de penetración de §1 del informe reproducida clavada: spawn en diagonal dentro de una caja 12×12 → `6.375 / 6.375 / 6.375 / **1.400**`. La penetración de partida es el tope, y no se supera |
| 3 | Las **dos mitades** son indispensables | ✅ cumple | Reproducido: `2 ejes + penetración` deja 6,375 m desde dentro en diagonal y 6,388 m entrando por la esquina; `secuencial + caja entera` deja 6,375 m desde dentro. Matiz medido que el informe no dice: desde un origen interior **sobre un eje** (−5, 0), `2 ejes + penetración` ya da 1,400 — la fuga es de la DIAGONAL, y el escenario del informe la elige bien |
| 4 | **`atrapado` era rama muerta** | ✅ cumple | Leído en el ÁRBOL, no con `grep`: `main.ts:617` pasa `desde: playerPos` y `solido: collidesAt`; `collidesAt` toma su origen de `getPlayerPos()` (`main.ts:481`, el MISMO objeto vivo). Con `desde === hasta` contestan `false` las cuatro fuentes cableadas: frontera (diferencia de conjuntos vacía), `collider` y `svgCollider` (`blocksMove` exime toda celda solapada en el origen), y caja (`pen(d) > pen(d)`). Sabotaje B (reintroducirlo) → 1 rojo |
| 5 | **El invariante intocable**: quien aparezca dentro de una CAJA puede salir | ✅ cumple | **12.528 carreras** (348 puntos interiores × 36 rumbos, 4 tamaños de caja): **0 atascados**, **0 carreras que aumenten la penetración**, y de los 8 rumbos cardinales **siempre se mueven los 8** |
| 5a | …en el **caso peor** que se me pidió comprobar | ✅ cumple | Centro EXACTO de una caja 12×12 → salen **8/8**. Borde interior a **1 cm** → salen 7/8, se mueven 8/8. Borde interior a **1 mm** → 7-8/8. Esquina interior a 1 cm y a 1 mm → 7-8/8. El único rumbo que no saca es el que va MÁS adentro, que es la regla |
| 5b | …con **dos cajas solapadas**, caja dentro de caja y cuatro en cruz (lo que NADIE probó) | ✅ cumple | 8.777 puntos interiores × 16 rumbos sobre cuatro geometrías, incluida la del defecto que motivó `reparto-de-spawns` (dos `building` 4×4 solapadas 0,4 m): **0 sin salida, 0 que no se muevan** |
| 5c | …con la fuente **TERRENO** (los edificios del PLAN), que es lo que la PR afirma en su docblock nuevo | ❌ NO cumple | Muro de celdas de grosor ≥ 2 m, jugador dentro: sale por **0 de 36 rumbos** y anda **0,15 m**. **Idéntico en la base** (columna de control medida), así que **no es regresión de esta PR**: lo que falla es la afirmación que la PR ESTRENA, no su código. Ver **H-1** |
| 6 | El **deslizamiento contra paredes** no cambia | ⚠️ matizado | Los TRES escenarios de control del informe salen idénticos. En barrido sistemático (147.168 carreras desde origen exterior, 5 geometrías incluido el colisionador de celdas real) **el 8,4 % acaba en otro punto**: 12.292 por **≤ un frame** (máx 0,0694 m, mediana 0,053 m) y 70 por más, y esas 70 son el arreglo. **0 regresiones, 0 clavados, 0 inversiones de paso.** «Idéntico metro a metro» vale para sus tres escenarios, no en general. Ver **H-2** |
| 7 | Sin **vibración ni enganche** contra una pared (lo que ve quien juega) | ✅ cumple | 29.160 carreras contra una casa 12×12: **0 con el paso invertido**. Siete escenarios de roce (frente, 45°, 85°, esquina, celdas): mismas cuentas de alternancia que la base |
| 8 | Para **orígenes exteriores** la conducta de las cajas no cambia | ✅ cumple | `node qa/equivalencia-de-cajas.mjs` → `TOTAL: 1440 sondas · 0 diferencias`, exit 0 (corrido por mí). Más mis 147.168 carreras con 0 regresiones |
| 9 | El **candado en el navegador**, desde el arranque y andando | ✅ cumple (lo aporto yo) | Guion nuevo `qa/guiones/134-la-esquina-del-edificio-no-se-corta.mjs`: 11 esquinas de 3 edificios del pueblo de Robledo, **verde**; con la base restaurada, **10 de 11 en rojo** y el control de frente VERDE. El ingeniero declaraba este hueco en su §5 |
| 10 | El **reproductor** se borró tras verlo en exit 1 | ✅ cumple | `qa/la-esquina-de-la-caja-se-corta.mjs` no está; su bloque de `qa/README.md` tampoco (`grep` = 0). Lo recuperé de `243d5b3b` y verifiqué su método antes de reemplazarlo por el guion 134 |
| 11 | `npm run verify` verde | ✅ cumple | `ℹ tests 2859 · pass 2859 · fail 0 · duration_ms 42711` · EXIT=0 |
| 12 | `npm run crap` sin empeorar | ✅ cumple | `1367 funciones · cobertura 95.92 % de 18106 líneas · Tope CRAP ≤ 73 — 0 por encima · Objetivo ≤ 30 — 7 por encima · Cobertura mínima 95 % — ahora 95.92 % · ✔ dentro de los umbrales` · EXIT=0 |
| 13 | Mutación local sin supervivientes nuevos | ✅ cumple | Re-medido hoy, clavado a su informe: `obstaculos-del-jugador 67 mutantes · 4 vivos · 94.0% (break 84)` y `paso-del-jugador 41 · 1 vivo · 97.6% (break 97)`. `npm run deuda` marca los dos «posiblemente obsoleta» y la huella commiteada sigue en 11/70 y 1/48, tal como él declara |
| 14 | La batería de navegador en verde | ✅ cumple | **29 guiones distintos + el mío** en dos tandas: 0 en rojo. Un ⊘ intermitente en el 119 que medí y NO es de esta PR (§4) |
| 15 | Los **candados probados en negativo** (los 7 del informe) | ✅ cumple | Los siete reproducidos uno a uno; tabla en §3. Uno de ellos (G) solo se reproduce sobre `dist` — ver **W-3** |
| 16 | «El plan se equivocaba en un sabotaje» | ✅ confirmado, en las dos direcciones | Con el sabotaje C puesto (encadenar el delta BRUTO) el test del **rincón cóncavo sale VERDE** y el único rojo es el espejo, «contra la pared que frena el PRIMER eje». El ingeniero tiene razón y el plan no |
| 17 | Cero créditos | ✅ cumple | Censo de la corrida del guion 134: «0 guion(es) tocaron alguna puerta». La batería usó el motor falso |

---

## 2 · Lo que medí yo, con el comando

Las sondas viven en el scratchpad de la sesión (no tocan producción) y todas importan
`nefan-core/dist` más una **reimplementación a mano de la base** sacada de
`git show 243d5b3b:nefan-core/src/simulation/{paso,obstaculos}-del-jugador.ts`, para poder correr
las dos versiones en el mismo proceso.

### 2.1 · La tabla de penetración (reproducción de §1 del informe)

```
velocidad 4.18 m/s · paso 0.070 m · caja 12×12 + radio 0.4 → pared inflada a 6.4 m del centro
PENETRACIÓN MÁXIMA alcanzada en todo el camino, incluida la de partida (m)

escenario                                  2 ejes+entera   2 ejes+penetr.  secuen.+entera  HOY
ESQUINA a 45° desde fuera                         6.388           6.388           0.000           0.000
CARA de frente, desde fuera (control)             0.000           0.000           0.000           0.000
SPAWNEADO dentro EN DIAGONAL (−5,−5)              6.375           6.375           6.375           1.400
SPAWNEADO dentro SOBRE UN EJE (−5, 0)             6.384           1.400           6.384           1.400
```

La fila 4 es mía y no está en el informe: desde un origen interior **alineado con un eje**, la
penetración sola YA acota. La fuga que el ingeniero mide es la de la **diagonal**, donde cada sondeo
suelto deja el `min` gobernado por el otro eje. Su escenario está bien elegido; su frase «la
penetración sola no cierra» es cierta **para la diagonal**, que es el caso que importa.

### 2.2 · ¿Se puede entrar hoy por algún camino?

```
=== CAJAS (aabbBloquea) · penetración máxima EN TODO EL CAMINO, HOY ===
forja 4×4 (el guion 91)            23400 carreras · 0 entran · penetración máx 0.000000 m
casa 12×12                         23400 carreras · 0 entran · penetración máx 0.000000 m
granero 20×14 fuera del origen     23400 carreras · 0 entran · penetración máx 0.000000 m
carro 3×2 (huella pequeña)         23400 carreras · 0 entran · penetración máx 0.000000 m
caseta 1×1                         23400 carreras · 0 entran · penetración máx 0.000000 m

=== TERRENO en celdas (blocksMove, el muro del plan) ===
  60 fps · paso 0.070 m · 3240 carreras · 0 acaban solapando una celda sólida
  30 fps · paso 0.139 m · 3240 carreras · 0 …
  20 fps · paso 0.209 m · 3240 carreras · 0 …
  12 fps · paso 0.348 m · 3240 carreras · 0 …
   6 fps · paso 0.418 m · 3240 carreras · 0 …

=== EL CONTROL: la MISMA batería con la BASE 243d5b3b ===
forja 4×4 (el guion 91)            23400 carreras · 508 ENTRAN · penetración máx 2.377 m
casa 12×12                         23400 carreras · 236 ENTRAN · penetración máx 6.386 m
granero 20×14 fuera del origen     23400 carreras · 120 ENTRAN · penetración máx 7.399 m
```

El control es lo que hace que estos ceros signifiquen algo: la misma batería, sobre el mismo árbol,
reproduce el defecto con el código de la base.

Dato de paso que conviene tener escrito: **un túnel por delta grande es geométricamente imposible
contra una caja**. El paso máximo es `4,18 × 0,1 = 0,418 m` y la banda mínima que puede tener una
caja inflada es `2 × radio = 0,8 m` aunque el motor declare huella cero. Por eso la `caseta 1×1`
tampoco se atraviesa a 6 fps.

### 2.3 · El invariante de salida (el caso peor que se me pidió)

```
forja 4×4        centro EXACTO              pen 2.400 · salen 8/8 · se mueven 8/8 · (de 36: salen 36)
casa 12×12       centro EXACTO              pen 6.400 · salen 8/8 · se mueven 8/8 · (de 36: salen 36)
casa 12×12       borde interior +x (1 cm)   pen 0.010 · salen 7/8 · se mueven 8/8 · (de 36: salen 35)
casa 12×12       esquina interior (1 mm)    pen 0.001 · salen 8/8 · se mueven 8/8 · (de 36: salen 36)
granero 20×14    diagonal a media caja      pen 3.700 · salen 7/8 · se mueven 8/8 · (de 36: salen 35)
muro largo 40×6  borde interior -z (1 cm)   pen 0.010 · salen 7/8 · se mueven 8/8 · (de 36: salen 35)
…
348 puntos interiores × 36 rumbos = 12528 carreras
✔ ninguna carrera aumenta la penetración por encima de la de partida
✔ desde todo punto interior se sale de la caja por al menos un rumbo
```

El «7-8 de 8» del informe es exacto. El rumbo que no saca es siempre el que va más adentro. Y lo que
importa más que el 7 u 8: **por los 8 rumbos el jugador SE MUEVE**, así que nunca hay una tecla que
no haga nada.

Y el caso que el ingeniero no probó, **dos cajas a la vez** (alejarse del centro de una puede ser
acercarse al de la otra):

```
✔ dos `building` 4×4 solapadas 0,4 m (el defecto que motivó reparto-de-spawns)
    627 puntos DENTRO · 0 sin salida por ninguno de 16 rumbos · 0 que no se mueven
✔ dos `building` 12×12 solapadas en ESQUINA      4244 puntos · 0 sin salida · 0 quietos
✔ un `prop` 2×2 DENTRO de un `building` 12×12    2601 puntos · 0 sin salida · 0 quietos
✔ cuatro cajas en cruz, solapadas en el centro   1305 puntos · 0 sin salida · 0 quietos
```

### 2.4 · El deslizamiento, BASE contra HOY, clasificando cada diferencia

147.168 carreras desde origen EXTERIOR, cinco geometrías (caja-muro, caja-edificio, caja-rincón en
L, **terreno en celdas** y **rincón cóncavo en celdas**), 21×21 partidas × 72 rumbos, 600 frames a
60 fps con rumbo fijo:

```
TOTALES · 1·arreglo 34 · 2·REGRESIÓN 0 · 3·un frame de roce 12292 · 4·trayectoria distinta 36 · 5·SE CLAVA 0
```

- **0 regresiones**: en ninguna carrera acaba hoy dentro donde la base acababa fuera.
- **0 clavados**: en ninguna anda hoy menos de 0,3 m donde la base andaba más de 3.
- Las 36 «trayectoria distinta» son todas el mismo caso: `(−20,−20) rumbo 45°` y sus simétricos,
  donde la base **cruzaba el edificio en línea recta** (41,8 m) y hoy lo rodea (36,5 m).
- Las 12.292 pequeñas están acotadas por **un frame**: máx 0,0694 m contra un paso de 0,0697.

### 2.5 · ¿Vibra? ¿Se engancha?

```
paso de un frame a 60 fps: 0.0697 m
escenario                                     HOY: frames inv alt parado?   BASE: frames inv alt parado?
CAJA · de frente contra la cara oeste          196   0   1 SÍ          196   0   1 SÍ
CAJA · en diagonal 45° contra la cara          400   0   0 no          400   0   0 no
CAJA · rozando la pared a 85°                  400   0   1 no          400   0   1 no
CAJA · JUSTO a la ESQUINA suroeste a 45°       400   0   0 no          400   0   0 no   fin hoy (-0.30,-6.40) base (-0.30,-0.30)
TERRENO · de frente contra el muro             196   0   1 SÍ          196   0   1 SÍ
TERRENO · JUSTO a la ESQUINA a 45°             400   0   0 no          287   0   1 SÍ   fin hoy (-0.30,-6.40) base (-5.91,-5.91)
TERRENO · rozando a 5°                         400   0   1 no          400   0   1 no

barrido de vibración (81 partidas × 360 rumbos contra la casa 12×12): 0 carreras con el paso INVERTIDO
```

La fila que más dice es la penúltima: con la BASE, andando a la esquina de un muro de celdas el
jugador acaba en (−5,91, −5,91) **dentro** y **deja de andar a los 287 frames**. Con el arreglo,
rodea y sigue.

---

## 3 · Los candados, probados en negativo por mí

Cada sabotaje puesto en el fuente, corrido y **restaurado byte a byte** (`md5sum` de los dos ficheros
contra `git show HEAD:` al terminar: idénticos).

| # | Sabotaje | Comando | Resultado mío | ¿Coincide con el informe? |
|---|---|---|---|---|
| A | El 2.º eje vuelve a salir del ORIGEN | `npx tsx --test test/paso-del-jugador.test.ts` | **2 rojos** (23/25): «LA ESQUINA (#601)…» y «`solido` se pregunta dos veces…» | sí, clavado |
| B | `atrapado` reintroducido | ídem | **1 rojo** (24/25): «`solido` se pregunta dos veces…» | sí |
| C | El 2.º sondeo encadena el delta BRUTO | ídem | **1 rojo** (24/25): «contra la pared que frena el PRIMER eje…» — **y el rincón cóncavo VERDE** | sí, y confirma su §4.1 |
| D | Vuelve la exención por CAJA ENTERA | `npx tsx --test test/obstaculos-del-jugador.test.ts` | **3 rojos** (22/25) | él dijo 2; hay uno más («bloquea el paso que deja MÁS metido») — a favor, no en contra |
| E | Comparación de penetración invertida | ídem | **10 rojos** (15/25), el primero `alejarse del centro nunca bloquea` | sí |
| F | `Math.min` → `Math.max` | ídem | **5 rojos** (20/25) | sí |
| G | Política de `dueno` invertida | `node qa/equivalencia-de-cajas.mjs` | **EXIT 1** · `✖ 365 sondas cambian de veredicto fuera de los spawns de runtime` | sí (ver **W-3**) |

### 3.1 · Los que busqué yo, cazando el verde con el defecto puesto

| # | Sabotaje | Resultado |
|---|---|---|
| H | `>` → `>=` en `cajaBloquea` (la igualdad bloquea: el que está dentro ya no puede ir paralelo a la cara) | **7 rojos** |
| L | A `penetracionEnCaja` se le quita el `+ radio` | **4 rojos** |
| M | **TOLERANCIA**: `pen(hasta) > pen(desde) + ε`, o sea «se puede entrar ε por frame». Es el cambio que escribiría alguien que creyese que el jugador vibra contra la pared | con **ε = 0,005 m**: los dos ficheros de test VERDES (25/25 y 25/25), `architecture` verde, `equivalencia` verde… **pero el defecto que produce mide 4 mm** y no es observable. Con **ε = 0,08 m** (el que sí dejaría entrar un frame entero): **`npm run verify` ROJO** («EL ARREGLO DE #489…») y `equivalencia-de-cajas` EXIT 1 con 285 sondas |

**Conclusión del barrido adversarial**: no encontré ningún sabotaje que deje todo verde con un
defecto que el jugador note. Lo que ata la tolerancia no es el aserto que uno esperaría —ver
**H-4**— sino los sondeos de ±1 cm desde un origen EXTERIOR («EL ARREGLO DE #489» y
`qa/equivalencia-de-cajas.mjs`). Cualquier hueco que dejen está por debajo del centímetro.

---

## 4 · El juego real, desde el arranque

`node qa/run.mjs` levanta él solo `e2e-sin-creditos` con motor falso. Log en el scratchpad
(`bateria-qae1.log`).

```
$ NEFAN_PORT_OFFSET=500 node qa/run.mjs colision-desde-huella forja porton pinar carro \
    spawn-vuelve etiquetas objeto-mirado lo-que-el-motor-pone velocidad-y-el-alcance
· bloque de puertos +500 (bridge :10377, HTML :3500)
· webgl: ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0)
✔ 02-colision-desde-huella
✔ 10-fps-telegraph-etiquetas-y-niebla
✔ 118-el-carro-frena-y-la-bolsa-se-pisa
✔ 128-lo-que-el-motor-pone-de-golpe-no-se-pisa
✔ 31-el-pinar-al-tope-se-cruza
✔ 45-el-porton-se-cruza-por-su-vano
✔ 61-el-objeto-mirado-dice-su-nombre
✔ 79-las-etiquetas-y-la-mirilla-siguen-lo-que-tienes-delante
✔ 81-el-spawn-vuelve-con-su-rol-y-lo-que-no-vuelve-se-dice
✔ 91-la-forja-que-el-motor-pone-ya-no-se-atraviesa
✔ 93-la-velocidad-y-el-alcance-los-dice-el-config
EXIT=0
```

El **91** (el que el issue señala) verde, sin sus tres rojos históricos. El **93** —que mide la
reaparición y documenta el H2 de #538 en su cabecera— también verde: esta PR no lo mueve.

Segunda tanda, elegida por tocar movimiento, frontera, terreno, reaparición y parada:

```
$ NEFAN_PORT_OFFSET=500 node qa/run.mjs rio terreno frontera parada tile-que-tarda ready-de-otra \
    aviso-del-arranque muro-cerrado mirilla rotulos declaro-al-reanudar esquina
✔ 05-terreno-desde-ground        ✔ 06-el-rio-solo-se-cruza-por-el-puente
✔ 103-la-mirilla-esta-encima-del-mundo    ✔ 109-el-tile-que-tarda-y-el-que-falla-lo-dicen
✔ 112-la-pregunta-de-la-frontera-vuelve-tras-hablar   ✔ 126-dos-rotulos-alineados-no-se-pisan
✔ 132-una-parada-que-nadie-ha-simulado-no-es-una-parada  ✔ 133-la-parada-falsa-bajo-carga-de-verdad
✔ 134-la-esquina-del-edificio-no-se-corta ✔ 35-un-ready-de-otra-partida-no-mueve-al-jugador
✔ 62 ✔ 70 ✔ 73 ✔ 77 ✔ 79 ✔ 86 ✔ 87 ✔ 94
⊘ 119-lo-que-el-motor-declaro-al-reanudar-la-partida — 1 bloque declarado sin medir
18 en verde · 0 en rojo · 1 SIN MEDIR de 19            EXIT=2
```

**El ⊘ del 119 NO es de esta PR, y lo medí en vez de suponerlo.** Corrido solo sobre HEAD dos veces
seguidas: **verde una y ⊘ la otra**. Sobre la base, verde. O sea: es intermitente, y su causa es la
que el propio guion declara (dónde deja el bench el spawn respecto al muro de la taberna). Encima el
bloque que lo declara decide con `probeCollide` sobre la recta jugador→bolsa (`:341-350`) y **no
llama a `pasoDelJugador` ni una vez**, así que el camino que esta PR cambia no participa. Queda
apuntado como fragilidad **preexistente** del banco: un ⊘ intermitente degrada la corrida entera a
exit 2.

### 4.1 · El guion que faltaba: `134-la-esquina-del-edificio-no-se-corta.mjs`

El ingeniero declara el hueco en su §5: *«Un candado de que el jugador no entra por la esquina EN EL
NAVEGADOR… ninguno camina en diagonal contra una esquina y afirma que no se entró»*. Lo escribí.

Carga la fixture `robledo_tile` del selector Room —sin motor, sin partida, **cero créditos**—,
descubre sondeando el rectángulo sólido de tres edificios del pueblo (Casa del Concejo, Capilla,
Herrería), se planta en la diagonal exterior de cada esquina a 4 m y **anda** contra ella.

```
$ NEFAN_PORT_OFFSET=500 node qa/run.mjs 134
casa_concejo: rectángulo sólido (ya inflado por el radio) x[-12.40, -4.60] z[-12.40, -6.60]
✔ el jugador NO se mete dentro del edificio casa_concejo por su esquina NO   (×11 esquinas)
✔ …y ANDA: contra la esquina NO de casa_concejo se mueve de donde salió      (×11)
✔ se midieron al menos CUATRO esquinas
✔ CONTROL: de frente contra la cara sur de casa_concejo el jugador se para PEGADO a ella
✔ 134-la-esquina-del-edificio-no-se-corta
censo de gasto · 0 guion(es) tocaron alguna puerta
```

**Probado en negativo** (devolviendo `pasoDelJugador` a la resolución de la base y restaurándolo
después):

```
✘ el jugador NO se mete dentro del edificio casa_concejo por su esquina NO — ocurrió · último valor {"x":-12.078,"z":-12.078}
✘ …por su esquina NE — ocurrió · {"x":-4.946,"z":-12.053}
✘ …por su esquina SO — ocurrió · {"x":-12.138,"z":-6.861}
✘ …por su esquina SE — ocurrió · {"x":-4.934,"z":-6.934}
✘ capilla por su esquina NO / SE
✘ herreria por sus CUATRO esquinas
✘ 134-la-esquina-del-edificio-no-se-corta          0 en verde · 1 en rojo de 1
    ✔ CONTROL: de frente contra la cara sur de casa_concejo el jugador se para PEGADO a ella
```

**10 de las 11 esquinas medidas en rojo, y el control de frente VERDE**: el rojo es de la esquina, no
de «dejó de frenar todo». Las tres mitades del guion (no entra · pero anda · el control de frente)
son lo que impide que salga verde midiendo campo abierto.

Un dato que sale de este guion y no estaba en ningún sitio: con el código de la base, andando a la
esquina de un edificio del PLAN el jugador **no cruzaba el edificio, se quedaba dentro y dejaba de
andar** (6,1 m recorridos y parado en (−11,91, −11,91), dentro de la Casa del Concejo). #601 dice
«se cruza entero», y eso es cierto para las cajas de runtime; para los edificios del pueblo era
peor: era una trampa. Ver **H-1**.

### 4.2 · Crítica visual

`qa/capturas/…/134-…-01-la-primera-esquina-casa_concejo.png`: el jugador está **fuera**, pegado a la
esquina sureste de la Casa del Concejo, con el río y la Herrería a la derecha. La maqueta 3D compone
bien —una sola luz rasante coherente en los dos edificios y en el árbol, el río lee como agua, las
escalas de puerta/ventana/tejado son creíbles— y nada de esto lo mueve la PR.

`…-03-el-control-de-frente.png`: pared marrón llenando el encuadre. Es exactamente lo que tiene que
enseñar (el jugador pegado a la cara sur) y es la prueba visual de que el control mide algo.

Dos cosas que vi y no son de esta PR: un rótulo de NPC («Greta») sale **cortado por el borde derecho
del viewport**, y la primera versión de mi propia captura salía mirando al horizonte porque tras
rodear la esquina el jugador sigue andando 10 s de mundo — lo arreglé disparando en la PRIMERA
esquina en vez de al final del bloque, que es una lección para cualquier guion que fotografíe
después de un `holdUntil`.

---

## 5 · Hallazgos

### H-1 · IMPORTANTE — la razón que la PR escribe para retirar `atrapado` es falsa en una de las fuentes, y se lee como garantía

**Qué dice la PR.** `src/simulation/obstaculos-del-jugador.ts:14-19`, párrafo **nuevo** de esta PR:

> «LAS TRES FUENTES SON «SALIR SÍ, ENTRAR NO», Y CADA UNA MIRA SU ORIGEN. […] Que las tres lo hagan
> por su cuenta es lo que permite que `pasoDelJugador` no tenga escape propio: **quien aparezca
> dentro de algo sale andando** sin que nadie le abra la puerta entera.»

Y `src/simulation/paso-del-jugador.ts:70-77` lo repite: *«…así que quien aparezca dentro de una
huella sale andando. El `atrapado` que vivía aquí […] era rama MUERTA»*.

**Qué está medido.** Para las CAJAS es cierto (§2.3: 12.528 carreras, 0 atascos). Para el TERRENO
—que es la fuente de solidez de los edificios del PLAN, o sea los del pueblo, porque
`planCollisionGrid` rasteriza la **huella entera** de cada volumen— es falso en cuanto el sólido
pasa de metro y medio:

```
Muro de terreno (celdas 0,5 m) de GROSOR variable, jugador colocado DENTRO en x=0 (el medio).
grosor   HOY: rumbos que sacan / metros máx      BASE 243d5b3b
  0.5 m   34/36  ·  1.02 m                       34/36  ·  0.97 m
    1 m   34/36  ·  1.02 m                       34/36  ·  0.97 m
  1.5 m   17/36  ·  1.02 m                       17/36  ·  0.97 m
    2 m    0/36  ·  0.15 m                        0/36  ·  0.15 m
    4 m    0/36  ·  0.15 m                        0/36  ·  0.15 m
   10 m    0/36  ·  0.15 m                        0/36  ·  0.15 m
   20 m    0/36  ·  0.15 m                        0/36  ·  0.15 m
```

El motivo está en `terrain-collision.ts:198-210`: `blocksMove` exime **las celdas que ya se
solapaban**, así que el jugador puede rebullirse dentro de su propio par de celdas y nada más; la
celda siguiente es sólida y NO estaba solapada, así que bloquea. Un edificio de Robledo mide 5×7 m:
quien acabe dentro no sale.

**Reproducción exacta**, desde el arranque del juego y sin sonda ninguna:

1. `NEFAN_PORT_OFFSET=500 ./start.sh --preset html-fixtures` (o `node qa/run.mjs 134 --keep`).
2. Cerrar el título, elegir `robledo_tile` en el selector Room.
3. En la consola: `window.__nefan.setPlayerPos(-8.5, -9.5)` (el centro de la Casa del Concejo).
4. Mantener W con cualquier orientación: el jugador se mueve **15 cm** y se para. Por ninguna de las
   ocho direcciones sale. La R tampoco lo saca (`puntoDeReaparicion` devuelve donde cayó: es el H2
   de #538, y **la PR 3 de esta tanda borra el escalón que existía justo para esto**).

**Gravedad y a quién le toca.** NO es regresión de esta PR: la base hace exactamente lo mismo
(columna derecha). Y esta PR **cierra la puerta principal** por la que se llegaba ahí —hasta hoy,
andar a la esquina de un edificio del pueblo te metía dentro y te dejaba encerrado (§4.1)—. Lo que
reprocho es la PROSA: sustituye una promesa vieja y falsa (`atrapado`, que prometía el escape y era
rama muerta) por una promesa nueva y falsa, y la usa como la razón de que el escape no haga falta.
Quien la lea dentro de un mes no añadirá el escape que un edificio del plan sí necesita.

**Recomendación**: vuelta al ingeniero solo para **dos frases** —decir qué fuente garantiza qué, y
que el terreno solo devuelve al que penetra menos de una celda— y **un issue** para el defecto de
juego, que queda fuera del alcance de #601. Cuerpo propuesto en §8.

### H-2 · MENOR — «idéntico metro a metro» solo vale para los tres escenarios de control

`implementacion-1.md` §1 presenta el deslizamiento como «idéntico metro a metro en los tres
primeros». Los tres lo son, los reproduje. Pero la frase se lee como «el deslizamiento no cambia», y
medido en barrido (§2.4) **el 8,4 % de las carreras acaba en otro punto**. Todas menos 70 por debajo
de un frame de paso (máx 0,0694 m), ninguna regresión, ninguna vibración. **No es un defecto**: es
una afirmación más ancha que su medida, y esta casa ya se ha cobrado esa factura («Una decisión
correcta con una razón inventada»). Basta con acotar la frase en el informe.

### H-3 · MENOR — `reaparicion.ts:24` sigue atribuyendo la regla a `pasoDelJugador`, que ya no la tiene

El ingeniero lo declara en su §5 y lo deja a la PR 3, que borra el bloque entero. De acuerdo con la
decisión; lo dejo escrito aquí para que no se pierda si la PR 3 cambia de alcance: hoy ese docblock
dice que el jugador «sale andando por la regla “salir sí, entrar no” **de `pasoDelJugador`**», y
`pasoDelJugador` ya no tiene ninguna regla propia.

### H-4 · MENOR — el aserto dice «un centímetro» y mueve diez

`test/obstaculos-del-jugador.test.ts:191`:

```ts
assert.equal(aabbBloquea(dentro, { x: 10.4, z: 0 }, R, [forja], conPlan), true, "pero un centímetro MÁS ADENTRO se bloquea");
```

`dentro` es `{x: 10.5}`, así que el paso es de **10 cm**, no de 1. Medido por qué importa: con una
tolerancia de 5 mm metida en `cajaBloquea` ese aserto sigue verde (§3.1, sabotaje M) — quien lo lea
creerá que ahí se cierra el centímetro, y no es ese aserto quien lo cierra. Un número en el texto que
no es el del código, en el fichero que la PR estrena.

### H-5 · MENOR (informativo) — `qa/equivalencia-de-cajas.mjs` ENCOGIÓ y conserva su nombre

Retirar el tercer origen (el de DENTRO) está bien razonado y escrito en el guion y en el README: ahí
la conducta ya no es la de la base **a propósito**. Pero el guion sigue llamándose lo que se llamaba
y su prosa sigue prometiendo «¿cambió de conducta algo que no fuera lo declarado?» cubriendo hoy
menos superficie: las 1.440 sondas ya no dicen NADA sobre orígenes interiores. La cobertura la
recogen los asertos de `test/obstaculos-del-jugador.test.ts`, así que no se pierde — pero es la
lección de la casa («un candado cubre menos de lo que su nombre promete») aplicada a un candado que
se encoge, y merece una línea en su cabecera diciendo qué **ya no** mira.

---

## 6 · Workarounds usados, y su veredicto

**W-1 · Sondeé el rectángulo sólido con el jugador aparcado a 28 m.** `probeCollide` es
`collidesAt`, o sea una consulta de MOVIMIENTO: preguntarle por el punto donde uno ya está contesta
siempre que no. Si hubiera preguntado desde el sitio, mi guion habría salido verde con el jugador en
mitad del edificio. **Veredicto**: no afecta al jugador (es instrumento de medida, y el patrón es el
del guion 02), pero es el **H2 de #538 apareciendo en mi instrumento**. Ya tiene dueño: la PR 3.
Queda escrito en la cabecera del guion 134 para que nadie lo «simplifique».

**W-2 · `setPlayerPos` para colocarme en la diagonal de cada esquina.** Es el patrón de los guiones
02, 05, 06 y 109. **Veredicto**: no es hallazgo — el jugador llega a esas esquinas andando; el
teletransporte solo se ahorra el paseo, y después **se anda de verdad** (`holdUntil("up")`), que es
donde vive la medida.

**W-3 · Para reproducir el sabotaje G tuve que sabotear `dist`, no `src`.** `qa/equivalencia-de-cajas.mjs`
importa `nefan-core/dist`, así que con el fuente saboteado y `dist` sin reconstruir el guion sale
**verde midiendo el código bueno** — me pasó, y el primer intento me dio un falso «el candado del
ingeniero no reproduce». **Veredicto**: no es defecto (está documentado: «son `nefan-core/dist` y
aritmética», y `npm run verify` construye antes de medir), pero sí es una trampa para quien pruebe
candados en negativo a mano. No afecta al jugador.

---

## 7 · No probado, y por qué

- **La corrida de mutación AUTORIZADA** (`traer` / `repartir` / `comparar`). No la pido ni la corro:
  no es del rol. El «0 nuevos» del ingeniero es el de su tabla a mano, no el de un hash — y él lo
  dice así. `npm run deuda` marca `paso-del-jugador`, `obstaculos-del-jugador` y `arch-cierre` como
  «posiblemente obsoleta». **Verificado en cambio**: los dos `local` de hoy dan exactamente sus
  números (4/67 y 1/41).
- **El coste por frame de `cajaBloquea`.** Ni él ni yo lo cronometramos en un frame real. Baja de
  tres sondeos a dos y la geometría es una resta y un `min`; en mis 117.000 carreras no hubo
  diferencia de reloj apreciable, pero eso no es una medida de frame.
- **Gasto real de créditos**: cero en todo. No hubo forma de medir el camino con Imagen IA encendida
  y no hacía falta: esta PR no toca esa frontera.
- **Las PR 2 (#583) y 3 (#538)** de la tanda: fuera de este informe.
- **La batería COMPLETA (132 guiones)**: corrí **29 distintos** + el mío en dos tandas, elegidos por
  tocar colisión, movimiento, frontera, terreno, reaparición y parada. Correr las 132 son ~3 h de
  navegador y la superficie del cambio no lo pide: `npm run verify` cubre 2.859 tests y el cambio
  vive en dos funciones puras.
- **Que el ⊘ del 119 no vuelva**: medí que es intermitente (verde una vez, ⊘ otra, sobre el MISMO
  commit) y que su bloque no toca el código de esta PR, pero no he buscado su causa raíz — es
  preexistente y no es de esta tanda.

---

## 8 · Issue propuesto (para H-1)

> **Título**: Quien acaba dentro de un edificio del PLAN no sale: la colisión de terreno solo
> devuelve al que penetra menos de una celda
>
> **Cuerpo**:
>
> `TerrainCollider.blocksMove` exime «las celdas sólidas que ya se solapaban en el origen»
> (`src/scene/terrain-collision.ts:198-210`). Eso devuelve a quien penetra un poco un muro fino,
> pero **no saca a quien está dentro de un sólido más ancho que su propio cuerpo**: la celda
> siguiente es sólida y no estaba solapada, así que bloquea. Y los edificios del plan son sólidos
> macizos — `planCollisionGrid` rasteriza la **huella entera** de cada volumen, no sus muros.
>
> Medido (jugador en el centro de un muro de celdas de 0,5 m, 36 rumbos, 60 fps):
>
> | grosor | rumbos que sacan | metros andados |
> |---|---|---|
> | 0,5-1 m | 34/36 | 1,02 |
> | 1,5 m | 17/36 | 1,02 |
> | ≥ 2 m | **0/36** | **0,15** |
>
> Un edificio de `robledo_tile` mide 5×7 m: quien acabe dentro se queda ahí. La **R** tampoco lo
> saca (`puntoDeReaparicion` devuelve donde cayó — el escalón 2 era inalcanzable, H2 de #538, y la
> PR 3 de la tanda E lo borra). O sea: **estado sin salida**, y tras esa PR sin ningún recurso
> escrito.
>
> **Cómo se llega ahí hoy.** #601 cerró la puerta grande (andar a una esquina en diagonal metía
> dentro y encerraba: medido, 10 de 11 esquinas del pueblo de Robledo con el código de `243d5b3b`).
> Quedan las que el propio #601 nombra y no arregla: un `spawn_entity` que cae encima del jugador,
> un tile que llega y le pone un edificio donde está (`reaparicion.ts:14` lo cita literalmente), y
> un resume de un save hecho en mal sitio.
>
> **Lo que NO vale**, y está medido en el plan de la tanda E: quitar la exención encierra a todos, y
> celda a celda literal sobre las cajas encierra igual (0 de 8 rumbos salen de una caja de 12×12).
> La pieza que falta es la que el plan nombra en su §6: **no existe una pregunta «¿es sólido este
> PUNTO?»** para nada, solo «¿puedo moverme hasta aquí?». Con ella, la salida natural es que el
> escape mire la DIRECCIÓN de menor penetración, como hace `penetracionEnCaja` desde #601.
>
> **Rastro de prosa a corregir con esto**: `src/simulation/obstaculos-del-jugador.ts:14-19` y
> `src/simulation/paso-del-jugador.ts:70-77` afirman hoy que las tres fuentes son «salir sí, entrar
> no» y que por eso «quien aparezca dentro de algo sale andando». Es cierto para las cajas y falso
> para el terreno.
>
> Etiquetas sugeridas: `juego`, `nucleo`.

---

## 9 · Veredicto

**APTO CON HALLAZGOS.**

Lo que la PR prometía, lo hace, y lo he comprobado por mi cuenta, desde el flujo del jugador y con la
base como control: la entrada diagonal por la esquina está cerrada en las dos fuentes de solidez
(133.200 carreras, cero entradas, contra 864 entradas de la base en la misma batería), el que
aparece dentro de una caja sigue pudiendo salir en todos los casos peores que se me pidieron probar
y en tres que nadie había probado, el deslizamiento no regresa ni vibra, `verify`/`crap`/mutación
están donde dice, los siete candados en negativo reproducen y los tres que busqué yo no encontraron
verde con defecto observable. El hueco que el ingeniero declaró —no había candado de navegador— lo
he cerrado con el guion 134, probado en negativo con 10 de 11 esquinas en rojo y el control en
verde.

Los hallazgos no son de conducta salvo uno, y ese ni es regresión ni es de esta PR: es **prosa nueva
que promete una garantía que solo una de las tres fuentes da** (H-1). Eso sí pide volver al
ingeniero, pero son dos frases; y el defecto de juego que destapa merece issue propio, con el cuerpo
de §8 listo.

**No bloquea la fusión.** H-2, H-4 y H-5 son correcciones de texto que caben en el mismo commit;
H-3 ya tiene dueño en la PR 3 de la tanda.
