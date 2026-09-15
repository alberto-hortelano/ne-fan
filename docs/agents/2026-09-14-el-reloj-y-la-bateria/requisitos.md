# Tanda D · «El reloj y la batería»

## De dónde sale

Del triaje del backlog del 2026-09-10, cuyas doce decisiones contestó el usuario el 2026-09-14.
Su mensaje literal al entregarlas: **«Mutacion corriendo, decisiones respondidas»**.

Las dos decisiones de PROCESO (bloque C de `docs/agents/2026-09-10-triaje-del-backlog/decisiones.md`)
gobiernan esta tanda, y se citan literales abajo. **No se reabren.**

## Qué entra

### 1 · #443 — el runner de mutación, y va PRIMERO

La pregunta fue: «¿Qué palanca del reloj de mutación se mide primero?», con estas opciones:

- **(a) ELEGIDA** — «**#443** — cambiar de runner (`command` → `tap-runner`), que abarataría **todos**
  los módulos, porque hoy cada mutante paga la batería entera de su módulo. Con regla dura: si un
  solo score se mueve fichero a fichero, **no se adopta** y el issue se cierra con el número.»
- (b) descartada — #441, acotar `scene-validate`.

Respuesta literal: **«- R: a»**.

La regla dura es parte de la decisión, no un adorno: **si un solo score se mueve fichero a fichero,
no se adopta**, y el issue se cierra con el número. Un cambio de runner que mueve un score no es un
ahorro: es otra medida.

El propio issue parte el trabajo en cuatro, y solo el primero necesita corrida autorizada:

1. que el **score no cambie** fichero a fichero contra la medida actual;
2. que la suite lo **tolere**: `tap` exige reporte TAP y tests independientes — `node --test` emite
   TAP, pero hay que mirar el reporte real, no suponerlo;
3. **cuánto ahorra**, en segundos crudos, sobre una muestra con un módulo de batería grande y otro de
   batería pequeña;
4. qué pasa con el **tope de heap y el `timeoutMS`**, que hoy viajan en el `comando` del plan porque
   `node --test` abre un proceso hijo por fichero y los hijos no heredan las flags del padre.

Los pasos 2, 3 y 4 se hacen **en local y sin gastar runner**. El 1 pide corrida autorizada por una
persona.

### 2 · #441 — `scene-validate`, que ya no cabe en un job

Entra como **consecuencia**, no como sujeto: si #443 sale que sí compensa, el reloj de
`scene-validate` cae con el de todos y puede que vuelva a caber. Si sale que no, #441 sigue siendo la
palanca y hay que decir con qué número.

Medido el 2026-09-10 (corrida 34493904935): se comió el `timeout-minutes: 45` con **766 de 836
mutantes probados (91 %)**, no dejó informe, y por eso la corrida salió **INCOMPLETA** con el tag
quieto — los 54 módulos que sí midieron hubo que volver a pedirlos. El techo del job subió a 60
minutos **solo hasta que este issue parta el fichero**, y eso está escrito en `mutation.yml`.

### 3 · #430 — diferida, y aquí es donde se resuelve

Del triaje: «Si #443 sale que **no** compensa cambiar de runner: ¿entra `narrative-state.ts` en la
medida (~900 mutantes × 21 ficheros de batería) **pagando lo que cueste**, o se declara aparcado por
escrito con el número que lo justifique?»

No tenía respuesta porque **depende de lo que conteste #443**, y eso sigue siendo cierto. Entra en la
tanda para que la respuesta se escriba en cuanto #443 la tenga, en vez de quedarse esperando otro mes.
La tercera vía —recortar su batería a mano— está medida y **cuesta rigor**: en `npc-director` bajó el
reloj un 85 % y **perdió un mutante** cuyo único verdugo vivía en otro fichero.

### 4 · #545 — la batería mide por reloj de pared un juego que no corre por reloj de pared

La pregunta fue: «¿Se serializan las baterías de la máquina?», con estas opciones:

- (a) Lock global ya — cada corrida vuelve a ser un veredicto, al precio de hasta tres agentes
  esperando turno (del orden de una hora acumulada por tanda).
- **(b) ELEGIDA** — «Nada: la batería es **indicativa** bajo carga y el veredicto es la corrida
  aislada. **Recomendada**, junto con arreglar los asertos: el reproductor bajo carga sintética da el
  rojo a demanda sin quitarle la máquina a nadie.»
- (c) Declararlo en `qa/README.md`, que es documentar lo que ya pasa.

Respuesta literal: **«- R: b»**.

O sea: **no se serializa**, y a cambio hay dos entregas — (i) **arreglar los asertos** que hoy leen
paradas falsas, y (ii) el **reproductor bajo carga sintética**, que pone el rojo a demanda sin
ocupar la máquina. El hecho medido que lo motiva: la batería presupuesta progreso en **reloj de
pared** para un juego cuyo reloj de simulación se topa en **0,1 s por frame**
(`nefan-html/src/main.ts`, `Math.min((now-lastTime)/1000, 0.1)`), así que bajo carga los guiones leen
**paradas que no existen**. Y la promesa «103/103 sin retocar un guion» **es falsa con la máquina
compartida y cierta con la máquina quieta** — cinco medidas del 2026-09-10.

## Criterio de aceptación

1. #443 contestado **con un número**: o el runner se cambia con el score verificado **idéntico
   fichero a fichero** y el ahorro medido en segundos, o se cierra diciendo por qué no compensa. Las
   dos salidas son válidas; lo que no vale es un argumento sin cifra.
2. El paso 1 (score idéntico) llega cuando llegue la corrida autorizada: **no bloquea cerrar la
   tanda**. Los pasos 2-4 se entregan medidos.
3. #430 con su respuesta escrita, derivada de lo que conteste #443 — no una opinión.
4. Un guion de la batería que hoy lee una parada falsa bajo carga **deja de leerla**, y hay un
   **reproductor** que provoca ese rojo a demanda con carga sintética, sin ocupar la máquina de nadie.
5. `qa/README.md` dice lo que vale la batería bajo carga y lo que no.

## Fuera de alcance

- El lock global de las baterías (opción (a), descartada por el usuario).
- Recortar a mano la batería de ningún módulo: está medido que cuesta rigor.

## Avisos para el crítico

- **La regla dura de #443 es del usuario**: un score que se mueve = no se adopta. No la negocies.
- Nunca bajar un umbral ni recortar una batería para que un número quepa. Eso incluye `tope_lote`,
  `tope_local`, los `break` de cada módulo y el `timeout-minutes` del job.
- El 2026-09-10 se midió que **entre dos corridas el mismo módulo se mueve entre ×0,75 y ×1,14**
  sobre 61 ficheros. Cualquier «ahorro» por debajo de ese ruido no es un ahorro: dilo si el plan lo
  propone.
- El coste de una corrida completa: **13.268 s de CPU (221 min)** y ~43 min de pared.
- Hay otras instancias de Claude trabajando en esta máquina: **ninguna medida local puede ocupar la
  CPU sin acotarla**, y `tope_local` (120 mutantes) es la puerta que lo sujeta.
- Cero créditos.

---

## Correcciones del coordinador tras la crítica (2026-09-14)

La crítica está en `critica.md`, al lado. Se acepta entera. Esto es lo que cambia.

**#443 sigue en pie, y el paso 2 se reescribe.** La frase del issue —«`node --test` emite TAP»— es
**falsa hoy**: en Node v24.11.1 `node --import tsx --test <f>` emite `spec`, no TAP, también sin TTY.
Pero no tumba nada, porque **`tap-runner` no usa `--test` en absoluto**: lanza un proceso por fichero
ejecutándolo directo con un hook (`-r hook.cjs`), y `--test` allí está de hecho **prohibido** — el
hook escribe `stryker-output-<pid>.json` con su propio pid y con `--test` la cobertura acaba en hijos
cuyo pid nadie lee. Medido por el crítico: los cuatro ficheros de la batería de `scene-validate` más
`narrative-state`, `asset-store-server` y `bridge-session` —los de servidor, que eran el riesgo— salen
**exit 0 y TAP 13 válido** ejecutados directos. El paso 2 pasa a ser «comprobar que la batería corre
fichero a fichero SIN `--test`», que es lo que de verdad hace falta.

**El paso 3 ya tiene cota, calculada gratis desde la huella**: techo de ahorro **73 %** (12.874 s →
3.514 s), suelo por arranque de proceso **15 %**, y **30 de los 55 módulos no pueden ahorrar nada**
pero son solo el 6 % del reloj. La palanca es real y está concentrada. `tap-runner@10.0.0` existe y es
la última, pero **no está instalado**: es coste, no bloqueo.

**La regla dura del usuario se cumple MÁS FUERTE de lo que pide, y no cuesta más.** «Que ningún score
se mueva fichero a fichero» es verificable —`mutacion-huella.json` va commiteada con `blob`, `total` y
las huellas de cada superviviente, y `deltaDeFichero` ya compara fichero a fichero; 87 de los 88 blobs
casan con HEAD— pero **es más débil que lo que la casa ya mide**: 92 supervivientes antes y otros 92
**distintos** después dan el mismo score. Así que el criterio pasa a ser **0 nuevos y 0 resueltos** en
los ficheros comparables, que es justo la distinción que `repartir` ya hace y que no cuesta un segundo
más. Se cumple el espíritu de la regla del usuario, no se relaja.

**Y aparecen dos agujeros de proceso que la tanda tiene que cerrar, porque sin ellos la regla no se
puede aplicar:**

1. **Ningún verbo compara sin escribir.** `repartir` acaba en `escribeHuella` y mueve el tag, así que
   medir una corrida con el runner nuevo **destruye la base contra la que había que compararla**.
   Hace falta una comparación **en seco**: mira y no toca. Sin eso, la regla dura del usuario es
   inaplicable por construcción — y ése es exactamente el tipo de criterio que se «cumple en verde»
   sin comprobar nada.
2. **136 mutantes (1,6 % de los detectados) están clasificados por el RELOJ y no por un test**:
   `Timeout`, repartidos en 13 módulos. Con otro runner esos se mueven solos. Van **reportados
   aparte**, o la decisión muere por ruido.

**#441: la cifra de hoy, y es peor de lo que parece.** 2.551 s = **19,8 %** del reloj (el 20 % no se
ha movido) y 1,42× `tope_lote`. Pero lo que importa es el otro número: su `presupuestoDelLote` son
3.249 s = **90,3 % del techo del job**, y solo aguanta un crecimiento de **×1,110** cuando la deriva
medida entre corridas llega a **×1,14**. O sea: **el margen que compró #571 ya está dentro del
ruido.** Sigue detrás de #443 —si el ahorro es del 73 %, #441 se disuelve— pero si #443 no compensa,
esto es urgente y no «la palanca siguiente».

**#430 se confirma PREMATURA, y su cuerpo miente en tres cifras**: ~900 mutantes cuando el plan del
mismo día decía ~675; 18 de 21 ficheros cuando hoy son **19**; y «arriesga el `timeout-minutes: 180`»
**ya no tiene sujeto** desde que #438 partió la corrida en matriz (hoy son 60 min por lote). Entra en
la tanda solo para **corregir esas tres cifras y escribir la respuesta** en cuanto #443 la tenga.

**#545 se reencuadra, y el alcance estaba mal por 30×.** No es un guion: son **30 de 112** los que
miden por reloj de pared algo que depende del reloj de simulación. El clamp está en `main.ts:577`. El
**reproductor bajo carga sintética es pieza nueva de cero**: el banco no tiene con qué. Y
`qa/README.md:120-134` **ya escribe la regla** y ya cita el tope de 0,1 s — la prosa existía y no
sujetó nada, que es el argumento de esta casa contra la prosa, aplicado a sí misma.

**Aviso que vale la tanda entera**: **#496 es una causa raíz DISTINTA y ya diagnosticada** de los
rojos de los guiones 80 y 75 (el bridge compartido difunde la vida ambiental del guion anterior a una
página sin sesión). **Arreglar asertos puede taparlo.** Ningún aserto de esta tanda puede volver
verde un guion cuyo rojo venga de #496: si al arreglar uno desaparece un rojo que era de #496, eso es
un hallazgo, no un éxito.

---

## La segunda mitad de la tanda (2026-09-15)

Petición literal del usuario: **«sigue con la tanda D»**, después de autorizar las dos corridas
(«Autorizo la corrida, lánzala cuando acabe el ingeniero»).

**#443 está CERRADO en «no se adopta», con el número.** Lo que eso cambia para lo que queda:

Medido con dos corridas COMPLETAS sobre el MISMO commit (`e777c59a`): `34872537438` con `command`
y `34878198682` con `tap-runner` desde `feature/tap-runner`, rama que no toca ni un fichero del
perímetro mutado.

| medida | `command` | `tap-runner` | |
|---|---|---|---|
| corrida completa, reloj de pared | 44,5 min | 22,4 min | **−49,7 %** |
| reloj de CPU | 12.492 s | 4.566 s | **−63,4 %** |
| `scene-validate` | 43 min | 21 min | **−50,6 %** |

Lo tumbaron **26 mutantes** que `command` MATABA y que `tap-runner` devuelve como `RuntimeError`
—el proceso muere antes de emitir la cabecera TAP— y que por tanto salen del denominador: el score
baja en cinco ficheros y la regla dura del usuario dice que entonces no se adopta. Fuera de esos 26:
**0 nuevos y 0 resueltos** en los 85 ficheros comparables. Los 26 nominales están en **#597**.

### Lo que entra ahora

**1 · #441, con las cifras de HOY y una pregunta nueva.** `scene-validate` son **2.594 s = 20,8 %**
del reloj de CPU de la corrida entera, y su lote —él solo— tardó **43 de los 44,5 min** que tardó la
corrida completa: **es el camino crítico él solo**. Su `presupuestoDelLote` son 3.285 s = **91,3 %
del `techo_job`**, y la deriva medida entre corridas llega a ×1,14: el margen que compró #571 está
dentro del ruido. La respuesta escrita sigue siendo **partir el FICHERO** —nunca subir `tope_lote`
ni `timeout-minutes`—, pero ahora hay una alternativa medida que antes no existía: **si se arreglan
los 26 de #597, `scene-validate` baja a 1.242 s (−52 %) y #441 se disuelve sin tocar producción.**
Eso es exactamente lo que el crítico tiene que juzgar: cuál de las dos es la tarea que hay que
hacer, no cuál es más bonita.

**2 · #545, que ya se puede hacer porque la máquina está quieta.** Es lo que abrió la respuesta
**(b)** del usuario a la pregunta 12 del triaje («la batería es indicativa bajo carga y el veredicto
es la corrida aislada»), junto con **arreglar los asertos** y **el reproductor bajo carga sintética,
que da el rojo a demanda sin quitarle la máquina a nadie**. Alcance real medido por el crítico
anterior: **30 de 112 guiones**, no uno; el clamp está en `main.ts:577`; el reproductor es **pieza
nueva de cero**; y `qa/README.md:120-134` **ya escribe la regla y ya cita el tope de 0,1 s** — la
prosa existía y no sujetó nada, que es el argumento de esta casa contra la prosa aplicado a sí
misma. Se hace **con la máquina quieta a propósito**: su trabajo ES medir la batería bajo carga.

**3 · #430 sigue siendo del usuario.** Sus tres cifras están corregidas en el issue y la decisión
está servida: entra `narrative-state.ts` pagando lo que cueste, o se declara aparcado por escrito
con el número en `sin_mutar`. Lo que el cierre de #443 añade es que **la rebaja del −63,4 % vuelve a
la mesa si #597 se arregla**, así que la respuesta puede salir sola. No se toca sin él.

### El aviso que vale la tanda entera, otra vez

**#496 es una causa raíz DISTINTA y ya diagnosticada** de los rojos de los guiones 80 y 75: el
bridge compartido difunde la vida ambiental del guion anterior a una página sin sesión. **Arreglar
asertos puede taparlo.** Ningún aserto de esta tanda puede volver verde un guion cuyo rojo venga de
#496: si al arreglar uno desaparece un rojo que era de #496, **eso es un hallazgo, no un éxito**.
