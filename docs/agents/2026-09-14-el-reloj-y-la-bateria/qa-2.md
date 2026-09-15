# QA · PR-3 de la segunda mitad de la tanda D — el reproductor bajo carga (#545)

Validado sobre `3653ef54` en `/home/al/code/ne-fan-qa545`, corriendo el reproductor **catorce veces**
(cinco de control a ×1 y nueve frenadas entre ×2 y ×40), más los candados en negativo re-rotos a
mano y las cuatro cifras del informe re-medidas. Cero créditos (todo por `e2e-sin-creditos` con su
guardarraíl). Ni un proceso ajeno tocado: el stack lo levanta y lo baja `qa/run.mjs` en el bloque que
él mismo reserva. `/home/al/code/ne-fan`, `/home/al/code/ne-fan-d545r` y `/home/al/code/ne-fan-d599`
no se tocaron.

**Veredicto: APTO CON HALLAZGOS.** El instrumento existe, la carga es real y medida, el diff respeta
la regla dura de la tanda **de sobra** (no cambia ni cómo se espera: solo añade un instrumento), y
las cuatro cifras del informe son ciertas. Lo que no se sostiene es la frase de portada —«el 91 sale
rojo a ×20»: **a ×20 salió rojo 1 de cada 5 veces en mi árbol**, y las otras cuatro el reproductor
imprimió *«la carga fue real y lo que se midió la aguantó»*— y la frontera con #496/#497: **el 75 SÍ
cambia de color bajo carga**, y el reproductor lo rotula «ROJO REPRODUCIDO». Con el dial a ×40 el
rojo sí es fiable (3 de 3).

Y el hallazgo que quedaba abierto está **cerrado con número**: lo del jugador dentro de la forja
**no es el reproductor exagerando, es un defecto del juego**, se reproduce **sin carga y sin
navegador**, y se ve **también a 60 fps**. Va con su ejecutable.

---

## 1 · Criterios, uno a uno

| # | Criterio (de `requisitos.md` §3, `plan-2.md` §4.3 y lo que declara el ingeniero) | | Evidencia |
|---|---|---|---|
| 1 | El reproductor **reproduce**: el 91 verde a ×1 y **rojo a ×20** sin tocar el guion | ❌ | 5 corridas a ×20 con carga REAL (razón 0,465–0,551): **1 roja, 4 verdes**. §2 |
| 1b | …y hay un dial con el que el rojo sí sale a demanda | ✅ | **×40: 3 de 3 rojas** (razón 0,152–0,309). §2 |
| 2 | El reproductor **se niega** cuando no hay carga (`--factor 1` → exit 1) | ✅ | `EXIT REAL=1` con razón 0,981, incluso con la máquina a `load 4,74`. §2.3 |
| 2b | …y esa negativa no se puede convertir en verde sin querer | ❌ | `--umbral abc` → **«✔ la carga fue REAL y está medida»** a ×1. H-2 |
| 3 | **El diff solo cambia CÓMO se espera, nunca QUÉ se cuenta ni sobre qué canal** | ✅ | 0 ficheros de `qa/guiones/`, 0 de producción; ni un aserto añadido o tocado. §3 |
| 4 | **80 y 75** fuera del diff y con su color apuntado; un cambio de color suyo es hallazgo | ❌ | `node qa/bajo-carga.mjs 75 --factor 20`: **verde quieto → ROJO a ×20**, `cambio: se-rompio`. H-4 |
| 4b | El 80 no cambia de color | ✅ | verde quieto y verde a ×20 (razón 0,273), dos estados medidos por mí |
| 5 | **Diagnóstico del 91**: cae la mitad que ANDA, y el aserto es `combate.mjs:61` | ⚠️ | De **5 rojos observados** (3 suyos + 2 míos, sobre 12 corridas frenadas), **1** es ese presupuesto; **3** son la colisión de la forja. §4 |
| 6 | La carga la mete CDP y **no le quita la máquina a nadie** | ✅ | El load máximo de UNA corrida: 3,3/16. El throttling baja el consumo del renderer. §6 |
| 7 | El ancla del tope del game loop está **probada en negativo** | ✅ | Re-rota por mí de dos formas (valor y forma), roja las dos, restaurada byte a byte. §5 |
| 8 | `qa/lib/carga.mjs` entra por la puerta de la totalidad del banco, sin exención | ✅ | Re-probado en negativo: un `qa/lib/*.mjs` nuevo sin dueño pone rojo el candado. §5 |
| 9 | `npm run verify` **2741 / 0** | ✅ | medido: `tests 2741 · pass 2741 · fail 0 · suites 488` |
| 10 | **Deuda 86 → 86**, y la línea base real son 86 y no 87 (CRAP 11, no 12) | ✅ | medido con cobertura fresca: `86 items = 11 fronteras + 11 CRAP + 64 supervivientes` |
| 11 | `npm run afectado` no selecciona nada | ✅ | `7 fichero(s) cambiado(s) · NO EJECUTA NADA` |
| 12 | El reproductor **no delata** la mitad silenciosa (`debeOcurrir:false`) | ✅ (es cierto) | Confirmado por construcción: verde↔verde da `igual`. Pero no está dicho en `qa/README.md`. H-6 |
| 13 | El veredicto no dice «aguantó» sin haber comparado | ❌ | Lo dice sobre un guion **rojo en las dos corridas**. H-3 |

---

## 2 · Lo que medí yo, corrida a corrida

### 2.1 · Guion 91, las nueve corridas frenadas

| factor | razón sim/pared | fps | frame más largo | pared | `qa/run.mjs` | aserto que cayó |
|---|---|---|---|---|---|---|
| ×2 | **0,957** | 27,4 | 342 ms | 25,6 s | 0 verde | — (el reproductor **rechaza**: exit 1) |
| ×4 | **0,951** | 27,7 | **1.150 ms** | 66,0 s | 0 verde | — (el reproductor **rechaza**: exit 1) |
| ×8 | **0,774** | 19,5 | 2.116 ms | 34,4 s | 0 verde | — |
| ×20 | 0,551 | 6,6 | 5.815 ms | 61,9 s | **0 VERDE** | — |
| ×20 | 0,549 | 6,3 | 5.372 ms | 66,0 s | **0 VERDE** | — |
| ×20 | 0,465 | 5,2 | 6.324 ms | 75,4 s | **0 VERDE** | — |
| ×20 | 0,539 | 6,7 | 6.231 ms | 62,1 s | **0 VERDE** | — |
| ×20 | 0,518 | 6,3 | 5.796 ms | 62,1 s | **1 ROJO** | el jugador DENTRO de la forja · `parada (9.48, -12.05) · a 0.66 m del centro · le sobra -1.74 m al borde` |
| ×40 | 0,286 | 3,0 | 10.694 ms | 111,8 s | **1 ROJO** | forja · `le sobra -1.63 m al borde` |
| ×40 | 0,309 | 3,2 | 11.717 ms | 182,4 s | **1 ROJO** | forja · `le sobra -1.32 m al borde` |
| ×40 | 0,152 | 1,6 | 16.851 ms | 218,6 s | **1 ROJO** | **`ocurre: el jugador LLEGA andando a 2.2 m de barkeep — no ocurrió en 4000 ms`** (el presupuesto de `qa/lib/combate.mjs:62`) |

Control a ×1, cuatro veces: **0,980 · 0,981 · 0,981 · 0,983**, 28,5–28,8 fps, peor frame 237–320 ms,
el guion verde las cuatro. La corrida de control es **estable**, y el umbral de 0,90 la deja fuera
con margen: eso está bien medido.

### 2.2 · A partir de qué factor se cae (lo que pedía el encargo)

Son dos preguntas distintas y tienen dos respuestas distintas:

- **La carga se detecta a partir de ×8** (0,774). A ×2 (0,957) y a ×4 (0,951) el reproductor
  **se niega**, y hace bien según su propio criterio.
- **El rojo del guion no llega con la carga: llega con ×40.** A ×20, con la carga aceptada las cinco
  veces, el guion salió rojo **una**. A ×40, **tres de tres**. El defecto es probabilístico y el dial
  por defecto está justo donde la moneda cae de canto.

### 2.3 · La negativa, y la máquina ocupada

`node qa/bajo-carga.mjs 91 --factor 1 --sin-quieto` → **exit real 1**, con `qa/run.mjs` saliendo 0
(el guion verde). Repetido con la máquina a `load 4,74` (5 min 4,14), lo más cargada que estuvo hoy:
la razón siguió en **0,981** y la negativa se mantuvo. **El throttling de CDP es un dial de verdad y
no se contamina con el load de la máquina a este nivel** — eso es un punto a favor del instrumento, y
lo mido porque era una de las dudas razonables.

### 2.4 · 80 y 75

| | 80 | 75 |
|---|---|---|
| `80 75` juntos, quieto | **✔ verde** | **✘ ROJO** |
| `80 75` juntos, ×20 (razón 0,273 / 0,282) | **✔ verde** | **✘ ROJO** |
| `75` solo, quieto | — | **✔ verde** (razón 0,842, ventana corta 2,8 s) |
| `75` solo, ×20 (razón **0,266**) | — | **✘ ROJO** → `cambio: se-rompio` |

El aserto que cae en el 75 es siempre el mismo, y es **un CONTADOR sobre un canal compartido**:

```
✘ 3 · #410 · el tile que vuelve con otras salidas NO re-deriva su colisión (misma huella)
    — 2 derivaciones (había 1) — la escena servida cambió en: npcs (barkeep: position)
✘ 3 · …porque la colisión se RESTAURÓ (el store lo cuenta) y la huella es la misma
    — 0 restauraciones · huella DISTINTA
```

O sea: la vida ambiental movió al tabernero entre las dos servidas del tile. Es la familia de
#496/#497 **exactamente como la clasifica la crítica por el texto del aserto** — y aun así **la
carga lo provoca**. Ver H-4.

---

## 3 · La regla dura del diff, comprobada mecánicamente

```
$ git diff --name-status 7a481ca6 3653ef54
A  nefan-core/test/carga-sintetica.test.ts
M  qa/README.md
A  qa/bajo-carga.mjs
A  qa/lib/carga.mjs
M  qa/run.mjs
$ git diff --name-only 7a481ca6 3653ef54 -- qa/guiones/            → 0
$ git diff --name-only … -- nefan-html/src nefan-core/src bridge   → 0
```

Y las líneas **añadidas** que rozan un aserto, un conteo o un canal son tres, y ninguna es un aserto:
dos son la comparación nueva de `carga.mjs` (que **lee** `estado`, no lo produce) y la tercera es el
`resultados.push` de siempre, que solo gana el campo `carga`. La instrumentación de `qa/run.mjs` está
entera detrás de `if (FACTOR_CPU !== null)`, así que **una corrida normal de la batería recorre el
mismo código que ayer**. La sonda escribe en `sessionStorage` bajo la clave `__qaCarga`, y el cliente
**no usa `sessionStorage` en ningún sitio** (`grep` a cero): no hay colisión.

**Criterio 3: cumplido, y con margen.** El diff no cambia siquiera «cómo se espera».

---

## 4 · El diagnóstico del 91: qué cae de verdad

El informe dice «cae la mitad que ANDA, no las sondas de la caja» y señala `qa/lib/combate.mjs`
(`tramoMs = 4_000`, que está en la **línea 62** y no en la 61 que cita el informe), de donde cuelgan
25 guiones. **Eso es cierto de UNA de las corridas, no del patrón.** Juntando las tres del ingeniero y las nueve mías, los rojos observados son cinco:

| rojo | cuántos | qué es |
|---|---|---|
| el jugador **dentro de la caja de la forja** | **3** | un defecto del JUEGO (§7), no un presupuesto de reloj |
| `no ocurrió en 4000 ms` (el barkeep) | **1** | **éste sí** es el presupuesto de pared de `combate.mjs:62` |
| la pared del cofre medida en 1,25 m contra 1,15 | 1 | el escenario deja de ser determinista aguas abajo |

**Consecuencia para PR-4b, y es la que importa**: pasar el 91 al reloj de simulación arreglará el
rojo del barkeep y **no** el de la forja, que seguirá saliendo ~1 de cada 2 corridas a ×40. Quien lo
vea después del arreglo tendrá dos lecturas a mano —«queda #545 por rascar» o «relajemos el aserto de
la colisión»— y las dos son falsas. El aserto de la forja **está bien y está cazando un bug real**.

---

## 5 · Candados re-probados en negativo por mí

| Candado | Sabotaje | Resultado |
|---|---|---|
| ancla del tope | `0.1` → `0.25` en `main.ts:566` | ✖ rojo: `el juego topa el delta en 0.25 s y qa/lib/carga.mjs mide con 0.1 s` |
| ancla del tope | `/ 1000` → `/ 1000.0` (mismo valor, otra forma) | ✖ rojo: `no se encontró el tope del delta…` |
| restauración | `git status` + `diff` contra copia previa | limpio, y los 33 tests verdes otra vez |
| totalidad de `qa/lib` | añadir un `qa/lib/zzz-prueba-qa.mjs` que nadie importa | ✖ rojo: `qa/lib sin quien lo mire: zzz-prueba-qa.mjs` (borrado después) |
| la negativa del reproductor | `--factor 1` | **exit 1**, con el guion verde al lado |

Los 33 tests de `carga-sintetica.test.ts` no son de adorno: los seis desenlaces de `juzgaLaCarga` y
los cuatro de `comparaCorridas` están separados y cada uno tiene su caso. Eso está bien hecho.

---

## 6 · Uptime, antes y después de cada medida

| Medida | antes | después |
|---|---|---|
| `npm run verify` | `0,41 1,51 1,81` | `1,49 1,66 1,85` |
| 91 ×1 + ×20 (corrida 1) | `0,13 0,99 1,56` | `1,47 1,23 1,59` |
| 4 muestras seguidas a ×20 | `1,15 1,18 1,56` | pico `3,17` |
| barrido ×2/×4/×8/×40 | `0,81 1,40 1,65` | `1,59 1,54 1,67` |
| dos ×40 + `80 75` | `0,63 1,25 1,54` | `2,24 4,10 3,22` |
| ×1 con la máquina ya ocupada | `4,74 4,14 3,35` | `4,33 4,11 3,37` |

**Ninguna corrida suelta pasó de `load 3,3` sobre 16 hilos.** Los 4,x son míos, de encadenar medidas
sin pausa, no del throttling: lo confirma que el propio ×1 con la máquina a 4,74 midió 0,981. La
elección de CDP sobre `NEFAN_QA_GPU=0` (791 % de CPU, load 25/16) está bien razonada y bien escrita
en `qa/README.md` para que nadie lo reintente.

---

## 7 · El hallazgo que quedaba abierto: el jugador dentro de la forja

**Cerrado: es un defecto del JUEGO. No es el reproductor exagerando, no es un túnel por delta grande,
y se ve también a 60 fps.** Lo dejo reproducido en un ejecutable que corre en segundos y sin
navegador: **`qa/la-esquina-de-la-caja-se-corta.mjs`** (declarado en `qa/README.md`).

**El mecanismo.** `pasoDelJugador` (`src/simulation/paso-del-jugador.ts:96-100`) prueba los dos ejes
**por separado** — `solido(x+dx, z)` y `solido(x, z+dz)`. Yendo hacia la ESQUINA de una caja, cada
sondeo suelto sigue fuera (le sobra el otro eje) mientras la suma de los dos ya está dentro: ninguno
ve nada y el paso entero se aplica. Y una vez dentro, `aabbBloquea` (`obstaculos-del-jugador.ts:119`)
deja pasar TODO por la regla «salir sí, entrar no» (`yaDentro` → no bloquea), así que el jugador
**cruza el edificio entero**. Por eso el guion lo lee a 0,66–1,08 m del centro y no rozando la pared.

**El túnel por delta grande queda descartado con el número**: velocidad 4,18 m/s (`combat_config.json`:
`walk 1.9 × scale 2.2`) por el tope de 0,1 s = **0,42 m de paso máximo**, contra una banda sólida de
4,8 m. Atravesarla en un frame pediría un delta de 1,15 s, y el tope existe justo para eso.

**Lo que la carga cambia no es si se puede entrar, es cuántos rumbos entran** (medido, barriendo el
cuadrante de 0,05° en 0,05°):

| reloj | paso | ventana de ENTRADA |
|---|---|---|
| 60 fps | 0,070 m | **0,95°** de 90° [44,55–45,45] |
| 30 fps | 0,139 m | **1,45°** [44,30–45,70] |
| 20 fps | 0,209 m | **3,15°** [43,45–46,55] |
| 12 fps | 0,348 m | **5,25°** [42,40–47,60] |
| ≤ 10 fps | 0,418 m (topado) | **3,15°** — el tope deja de ensancharla |

Con el ojo de quien juega: **sí le puede pasar a un jugador con un portátil flojo**, y de hecho le
puede pasar a uno con una máquina buena — el uno por ciento de los rumbos posibles ya entra a 60 fps,
y lo que compra el portátil flojo es el triple de ventana. El tope de 0,1 s hace de techo, así que la
carga sintética **no fabrica** un defecto que el jugador no tenga: lo hace más probable, que es
exactamente lo que se le pedía al reproductor.

**Qué hacía falta para separarlo** (la pregunta del encargo): no el reloj de simulación de PR-4a.
Hacían falta **treinta líneas llamando a las dos funciones del propio juego** sin abrir un navegador.
Está hecho, con sus dos direcciones probadas: `QA_FIX_SIMULADO=1` (comprobar el destino combinado,
que es el arreglo natural) deja la ventana en **0,00°** en los cinco relojes y el ejecutable sale 1;
`QA_SIN_CAJA=1` rompe el control y también sale 1. Y una cosa que conviene saber antes de arreglarlo:
**inflar el radio por el tamaño del paso NO lo arregla** — la esquina es simétrica y la ventana se
mueve con la pared (medido: sigue habiendo rumbos que entran). El arreglo tiene que mirar el destino
**combinado**.

**Va a issue nuevo, no a esta PR.** Es del juego y no del banco; el aserto del 91 lleva razón. Toca
la PR 5 de #241 (#489), que es quien escribió esas dos funciones.

---

## 8 · Hallazgos

### H-1 · importante · El dial por defecto (×20) da el rojo 1 de cada 5, y las otras 4 dice «lo aguantó»

**Reproducción**, desde el arranque, en un árbol limpio:

```bash
cd /home/al/code/ne-fan-qa545
for i in 1 2 3 4 5; do node qa/bajo-carga.mjs 91 --factor 20 --sin-quieto; done
```

Mis cinco: razones 0,551 · 0,549 · 0,465 · 0,539 · 0,518 (carga REAL las cinco) → `qa/run.mjs`
salió **0, 0, 0, 0, 1**. El informe declara «tres corridas frenadas, las tres rojas»; juntando las
suyas y las mías son **4 de 8**.

**Qué esperaba quien lo va a usar**: la decisión del usuario dice «el reproductor bajo carga sintética
da el rojo **a demanda**». Con el dial por defecto no lo da: lo da a veces, y las otras veces imprime

```
✔ la carga fue REAL y está medida
  · ningún guion cambió de color: la carga fue real y lo que se midió la aguantó
```

que es justo la frase que enseña a ignorar el rojo. **Un reproductor intermitente que además tiene un
verde tranquilizador es peor que uno lento.** Con `--factor 40` salió rojo **3 de 3** (razones
0,152–0,309), al precio de 187–224 s por corrida en vez de 67.

**Lo que yo haría** (no lo hago: reporto): subir el defecto a ×40, o repetir N veces y que el
veredicto cuente **la frecuencia** («rojo en 1 de 5») en vez de fingir un desenlace binario. La
frecuencia es el dato que #545 necesita para juzgar un arreglo, y hoy no se imprime.

### H-2 · importante · `--umbral` no es fail-loud: un dedazo convierte la negativa en un «✔ la carga fue REAL»

```bash
node qa/bajo-carga.mjs 91 --factor 1 --sin-quieto --umbral abc
```

→ `⏱ ×1 · razón sim/pared 0.983 …` → **`✔ la carga fue REAL y está medida`**, exit 0. (Medido hoy;
sin la flag, la misma corrida sale `✘ LA CARGA NO FUE REAL`, exit 1.)

`UMBRAL = Number(opt("--umbral", …))` (`bajo-carga.mjs:98`) no se valida, y `razon > NaN` es siempre
`false`, así que **todo pasa por real**. Igual con `--umbral 1.5`. Es exactamente lo que
`factorDelEntorno` se molesta en impedir para el factor —«una variable mal escrita que se interpretara
como “sin carga” daría una corrida tranquila presentada como corrida bajo carga»— dejado abierto en la
otra mitad del mismo juicio. Y es peor que el del factor: un umbral no lo lee nadie en la salida, así
que el informe que se pegue después dirá «carga real» sin que nada lo contradiga.

### H-3 · importante · «lo que se midió la aguantó» sobre un guion que estaba ROJO en las dos corridas

```bash
node qa/bajo-carga.mjs 80 75 --factor 20
```

Salida real de hoy: el 75 **rojo en la quieta y rojo en la frenada** (`cambio: igual`) y el veredicto:

```
✔ la carga fue REAL y está medida
  · ningún guion cambió de color: la carga fue real y lo que se midió la aguantó
```

Comprobado también contra la función pura:
`veredictoDelReproductor({juicios:[real], comparacion:[{cambio:"igual", quieto:"rojo", cargado:"rojo"}]})`
→ `exit 0` + «…la aguantó». **Un guion rojo en las dos corridas no ha aguantado nada**, y el test que
cubre este caso (`carga real y nadie cambió de color: exit 0, pero se DICE que aguantó`) usa un
material sintético con `quieto:"verde"`, así que el desenlace real nunca se ejerce. Es el tercer
«verde que no comprueba nada» de esta herramienta, hermano de los dos que el ingeniero cazó él mismo.

### H-4 · importante · El 75 SÍ cambia de color bajo carga, y el reproductor lo llama «ROJO REPRODUCIDO»

```bash
node qa/bajo-carga.mjs 75 --factor 20     # el protocolo exacto del informe: solo, con control
```

→ `75 … ✔ quieto · ✘ ×20 · se-rompio`, y el veredicto imprime
**`ROJO REPRODUCIDO en: 75-la-huella-del-tile-no-lleva-las-salidas`**.

Esto contradice tres cosas a la vez:

1. `implementacion-4.md` §4.5 («verdes en los cuatro estados… ningún color cambió») — **no reproduce**;
2. la predicción de la crítica que el informe da por corroborada («el 75 aguanta 0,281 sin
   inmutarse»): a **0,266** no aguanta;
3. y, lo que de verdad importa, el separador de la tanda: «**el 75 no tiene ningún presupuesto en ms:
   si el 75 sale rojo, no es carga**». Sale rojo **por** la carga, y el aserto que cae es un
   **contador** contaminado por la vida ambiental (`2 derivaciones (había 1) — la escena servida
   cambió en: npcs (barkeep: position)`), o sea de la familia #496/#497.

No es una regresión del PR —no toca el guion, y el color quieto sigue siendo verde—, pero **cierra en
falso la frontera sobre la que se apoya PR-4b**: el reproductor no distingue un rojo de #545 de un
rojo de #496, y su etiqueta `se-rompio` está *definida* en el código como «el rojo reproducido, que es
el entregable de #545» (`qa/lib/carga.mjs:321-324`). Quien corra esto sobre el 75 y lea «ROJO
REPRODUCIDO» irá a arreglarle las esperas, que es tapar #496 — el riesgo exacto que el coordinador
puso por escrito. La crítica ya había anticipado el límite («donde NO se distingue: contaminación que
causa inanición»); lo que faltaba era el caso medido, y aquí está.

### H-5 · importante · La magnitud es una MEDIA y el defecto vive en la COLA

A ×4 el reproductor **rechaza** la corrida: razón 0,951 > 0,90, «NO se ha reproducido ninguna carga —
sube el factor». En esa misma corrida el **frame más largo fue de 1.150 ms**. Un frame así dentro de
un presupuesto de 4.000 ms de pared (`combate.mjs:62`) se come **1.050 ms de simulación, el 26 % del
presupuesto**; sobre los 66 s de la corrida entera, mueve la razón global **1,6 puntos**. O sea: la
condición que produce el defecto de #545 puede estar presente de sobra y la magnitud no verla.

La sonda **ya mide** `deltaMaxMs` y ya lo imprime; simplemente no vota. Mientras no vote, «no se ha
reproducido nada, sube el factor» significa «la media no se movió», no «no había condiciones para el
defecto» — y el consejo de subir el factor empuja fuera del régimen más realista (una máquina
compartida da frames largos sueltos, no un frenazo uniforme).

### H-6 · menor · Los límites declarados del instrumento viven en un fichero que se borra

`implementacion-4.md` §6 declara honestamente cuatro límites —la mitad silenciosa (`debeOcurrir:false`
sigue verde), que la carga es del RENDERER y de nadie más, que con la pestaña oculta no se mide, y que
`--concurrente` es un smoke y no una medida—. Ninguno está en `qa/README.md`, y
`.gitignore:97` (`docs/agents/*/implementacion*.md`) borra ese fichero del repo. Dentro de un mes
quedará una sección de README que dice lo que la herramienta ve y **nada** de lo que no ve, que es
como nacen las lecturas de más.

Sobre la pregunta del encargo —**¿es aceptable que no delate la mitad silenciosa?**—: **sí para esta
PR**, y el ingeniero acierta al dejarlo fuera. Un `debeOcurrir:false` sale verde en las dos corridas,
así que por comparación de colores es invisible por construcción, y hacerlo visible pide **atribuir
tiempo de simulación a cada espera**, que es el mecanismo de PR-4a. Lo que no es aceptable es que eso
solo esté escrito en el fichero que se borra: es **la mitad del defecto de #545** y hoy la tanda no
tiene dónde apuntarlo.

### H-7 · menor · `--factor` no tiene techo ni presupuesto de reloj

Medido: ×1 → 27 s · ×20 → 67–80 s · ×40 → 187–224 s. Un `--factor 200` por dedazo (el `0` de más que
todo el mundo teclea alguna vez) es una tarde sin un solo aviso, sobre una máquina compartida. El
factor absurdo es el único caso adversarial del encargo que **no probé** (§10).

### H-8 · menor · La corrida de CONTROL se mide pero no se juzga nunca

Por decisión escrita («el control existe para salir con razón ≈ 1»). Hoy no muerde —lo verifiqué a
propósito: con la máquina a `load 4,74` el control siguió en 0,981—, pero significa que un control que
hubiera corrido frenado entraría como base sin que nada lo dijera, y toda la comparación de colores
cuelga de él. Lo dejo como residuo, no como defecto activo, porque lo medí y aguantó.

### H-9 · menor · Un `catch` silencioso en el cableado

`qa/run.mjs`: `cargaDelGuion = await leerLaSonda(page).catch(() => null)`. Colapsa «la página murió»
con «no había sonda», y el juicio luego imprime «la sonda de reloj no llegó a instalarse en la
página», que en ese caso sería falso. El desenlace no es un verde (sale `no se pudo medir`, exit 2),
por eso es menor — pero es el `catch { return null }` que la guía de la casa nombra como el sitio
donde más se cuela.

---

## 9 · Workarounds usados, y su veredicto

| Workaround | Por qué | ¿Afecta a quien use la herramienta? |
|---|---|---|
| Edité `nefan-html/src/main.ts` (dos sabotajes) para re-probar el ancla, y restauré | es la única forma de ver el candado rojo | No: `git status` limpio y los 33 tests verdes después. Es prueba en negativo, no un apaño |
| Añadí dos interruptores de entorno (`QA_FIX_SIMULADO`, `QA_SIN_CAJA`) **a mi propio ejecutable** | para que sus dos salidas rojas sean re-ejercitables por cualquiera | No: están documentados en su cabecera y en `qa/README.md` |
| Corrí una medida a ×1 **mientras mi propia cobertura ocupaba la máquina** | para comprobar si el load ajeno contamina la razón | No: fue una medida declarada, y el resultado (0,981) es parte del informe |

**Ningún workaround hizo falta para observar la feature.** El reproductor se corre como está
documentado, con el guion que está documentado, y funciona a la primera. Eso es lo bueno de esta PR y
conviene decirlo tan claro como los hallazgos.

---

## 10 · No probado, y por qué

- **Un factor absurdo (`--factor 1000`)**: no lo corrí. A ×40 una corrida ya cuesta 187–224 s y el
  crecimiento no es lineal; abortarla a mitad se arriesga a dejar un stack arriba en una máquina
  compartida, que es la regla que no se toca hoy. Lo digo como **no probado**, no como verde.
- **`--concurrente` con K alto**: fuera por política del encargo (ocupa la máquina). El ingeniero lo
  ejerció una vez con K=2; yo no lo repetí.
- **La pestaña oculta**: el código la contempla y su desenlace tiene test unitario, pero no hay forma
  de forzar `document.hidden` desde el camino del reproductor en Chromium headless. **No probado.**
- **La batería entera bajo carga**: no la corrí, y no hacía falta para nada de lo que se afirma aquí.
- **Los otros 47 guiones de la lista de #545**: siguen señalados por inspección. Esta PR entrega la
  palanca y un guion; eso está declarado y es correcto.
- **Que el instrumento se comporte igual en otra máquina**: todas las razones de este informe son de
  esta máquina (RTX 3060, 16 hilos) y de este día.

---

## 11 · Lo que dejo ejecutable

`qa/la-esquina-de-la-caja-se-corta.mjs` (nuevo, declarado en `qa/README.md`). No es un candado: es una
**reproducción**, y por eso sale **0 mientras el defecto viva** y 1 el día que alguien lo arregle —
que es cuando el fichero se borra con su párrafo del README. Sin navegador, sin stack y sin créditos;
segundos. Probado en negativo por sus dos puertas (`QA_FIX_SIMULADO=1` y `QA_SIN_CAJA=1`).

Lo mecánico del resto de este informe **no** se deja en guion a propósito: el color del 91 bajo carga
es una frecuencia, no un desenlace, y un guion que lo afirmara sería rojo 1 de cada 5 veces — o sea,
el defecto que H-1 denuncia, escrito otra vez.

---

## 12 · Veredicto

**APTO CON HALLAZGOS.**

Lo que está y es bueno: el instrumento existe y se corre por el camino de siempre; la magnitud elegida
(razón sim/pared con el tope del juego, anclado por test) es la correcta y «los fps» no lo habría
sido; la negativa a firmar una corrida que no frenó nada funciona y aguanta la máquina ocupada; la
palanca no le quita la máquina a nadie y el descarte de SwiftShader está medido y escrito; el diff no
toca ni un aserto ni una línea de producción; verify, deuda, CRAP y `afectado` dicen lo que el informe
dice; y el ingeniero declara sus propios defectos y sus propios límites, que es la mitad del valor de
un informe.

Lo que hay que arreglar antes de que PR-4b se apoye en esto como oráculo: **H-1** (el dial por defecto
no reproduce y el verde dice «aguantó»), **H-2** (`--umbral` sin fail-loud), **H-3** (el «aguantó»
sobre un rojo doble) y **H-4** (el 75 cambia de color y se rotula como rojo de #545). Los cuatro son
del banco, ninguno toca producción, y tres de ellos son la misma familia: **un desenlace tranquilizador
que se cumple sin haber mirado.**

Y una cosa que no es un hallazgo de esta PR pero sale de ella y vale más que ella: **el jugador entra
en los edificios por la esquina, también a 60 fps.** Issue nuevo, con su reproductor de segundos.
