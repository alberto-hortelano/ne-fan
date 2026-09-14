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
