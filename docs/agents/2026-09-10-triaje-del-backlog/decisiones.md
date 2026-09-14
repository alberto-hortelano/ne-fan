# Lo que necesita decisión del usuario

Sale del triaje de los 84 issues de núcleo (2026-09-10). Todo lo demás se hizo o se cerró.

El criterio de la frontera, aplicado por los cinco críticos: **es suyo** si cuesta dinero, si cambia
lo que el jugador siente, si elige entre dos diseños igual de defendibles, o si compromete tiempo
suyo. **No es suyo** lo que tiene respuesta canónica en el dominio o criterio ya escrito en
`CLAUDE.md` y los contratos — un zod que acepta lo que el borde rechaza, un guardián que no puede
ponerse rojo, un click que no llega. Eso se arregla y punto.

Cada una está formulada para contestarse en una línea.

---

## A · Lo que cuesta dinero

### 1 · #513 — ¿Qué le promete el juego a tu dinero cuando cierras la pestaña?

La premisa del issue era falsa y se corrigió al criticarlo: **cerrar la pestaña a mitad de un batch
pagado cuesta $0**. uvicorn no cancela la petición en vuelo, el servidor pinea lo que produce y la
re-corrida resuelve por contenido (cache-hit). La idempotencia ya existe.

- **(a)** Nada nuevo: el batch sigue necesitando la pestaña, y #513 se limita a que lo pagado quede
  con dueño y a que **el importe deje de mentir**. Cierra #548. Barato.
- **(b)** El batch pasa a ser un job del bridge con progreso y reanudación, como `generate_game`.
  El patrón ya existe; cuesta canal de progreso, estado del job y reanudación.

**Hoy (b) no ahorra ni un dólar frente a (a)**: se paga en tiempo, no en créditos.

Y una secundaria: **¿el arreglo del importe entra en #513 o va aparte?** Si va aparte, la cifra sigue
mintiendo mientras dure — y miente hasta **7,8×** (el atlas cotiza `ceil(missing/12) × $0,15`
ignorando que cada ref de cara abre página propia; el bloque de skins cotiza el **roster entero**
cada vez, ~$2,9 por personaje).

- R: Opcion a, el arreglo del importa van en 513

### 2 · ¿Con qué modo arranca una partida nueva?

Las dos puertas de la misma decisión no se tratan igual, y hoy es por omisión y no por elección:
en el **selector**, Escenarios y Personajes vienen en **Imagen IA** y se cambian con un click sin
confirmar; en el **home**, encender Imagen IA en un save **exige dos clicks** con «¿Confirmar?
Gastará créditos».

- **(a)** Se queda como está: una partida nueva nace gastando.
- **(b)** Nace en Maqueta 3D, y encender Imagen IA es explícito, como en el home.
- **(c)** Se recuerda lo último que elegiste entre pantallas del título.

Cuesta lo mismo en los tres casos (una tarde). Lo que cambia es **cuánto gasta quien pulsa «Nueva
partida» sin mirar**.

- R: b

### 3 · #465 — ¿Autorizas un playtest con el motor REAL?

Gasta créditos y tiempo suyo. Sirve para confirmar que el motor ancla los lugares con `anchor.rect`.
**El resto de #465 se hace sin preguntar**: el prompt y las cotas del zod son canónicos.

-R: adelante

---

## B · Lo que cambia lo que el jugador siente

### 4 · #484 — Los rótulos de nombre sobre el mundo (tres preguntas)

Hoy las tres están en «como está» **por omisión, no por decisión**.

1. **¿El rótulo de un enemigo se ve distinto del de un vecino?** Hoy el HUD lo nombra en rojo pero su
   rótulo de mundo es la misma caja crema que la del tabernero: de lejos no sabes a quién puedes
   pegar. **(A)** sí, en `--nf-danger` (el token existe; barato) · **(B)** no, todos iguales (coste 0).
  - R: a
2. **¿Un rótulo desaparece cuando el personaje está detrás de una pared?** Hoy «Alcaldesa Mirla»
   flota sobre la fachada de la posada con ella dentro. **(A)** se oculta · **(B)** se atenúa mucho
   (los dos: test de oclusión por rótulo y frame, coste medio) · **(C)** se sigue viendo a través —
   te dice dónde está la gente del pueblo, y es gratis.
  - R: c
3. **Dos rótulos alineados se pisan.** **(A)** se oculta el más lejano (barato) · **(B)** se desplazan en vertical (medio) · **(C)** como está.
  - R: a


### 5 · #478 — El bridge llega tarde: ¿qué hace el cliente?

Arrancas sin bridge, ves el muro, y **después** el bridge se levanta. Hoy el muro se retira solo y
ahí acaba: te quedas en el visor, sin título, y la única salida es recargar.

- **(a)** Que se arranque solo — relanza el arranque al conectar y te planta el título. ~1 día; hay
  que decidir además qué pasa con la fixture que estuvieras mirando.
- **(b)** Que te lo ofrezca — el chip pasa a «Connected» y el muro da **«Reintentar»**. ~medio día.
- **(c)** Solo la verdad — el chip deja de mentir y nada más. Un par de horas.

(La mitad de «el chip deja de mentir» se hace en cualquiera de los tres: eso no es elección.)

- R: b

### 6 · #451 — Un snapshot de 9 escenas con UNA injugable se tira entero

- **(a)** Como hoy: se tira entero y se regenera desde cero.
- **(b)** Se sirve la entrada y las 8 buenas, y solo se vuelve a pedir el tile malo.
- **(c)** Se queda (a), pero el título **dice el motivo**.
- R: b

### 7 · #529 — Un enemigo inválido del motor tumba el FRAME entero

- **(a)** Se cae solo él, los demás entran, y el motivo vuelve al motor y al registro — es lo que el
  cliente ya hace. **Recomendada.**
- **(b)** Se sigue tirando el frame entero, pero el modal dice **qué enemigo y por qué**, en vez de
  «Fallo interno del juego».
- R: a

### 8 · #532 — Todo `object` que spawnea el motor es un muro sólido de 1,5 m

Una «bolsa de monedas» es hoy un muro. **Bloquea a #524** (los spawns se reparten a 1,8 m fijos sin
mirar su huella): hacer #524 antes es escribir un test que #532 reescribe.

- **(a)** `spawn_entity` gana `footprint` opcional · **(b)** gana `kind: "item"` · **(c)** las dos.
  **Recomendada la (c).** Toca zod, espejo Python y tool JSON.
- R: c

### 9 · #538 — Dónde reapareces al morir

Hoy: **donde te mataron, con el enemigo a 60/60 a un paso** — o sea, bucle de muerte.

- **(a)** Como hoy · **(b)** el `__player_start` del tile · **(c)** el último punto seguro ·
  **(d)** donde te mataron, pero el enemigo te suelta.

- R: a

---

## C · Proceso: lo que decide cuánto se espera

### 10 · #443 vs #441 — ¿Qué palanca del reloj de mutación se mide primero?

Cada una necesita **una corrida autorizada** para verificarse. La completa son 13.268 s de CPU
(221 min) y ~43 min de pared.

- **(a) #443** — cambiar de runner (`command` → `tap-runner`), que abarataría **todos** los módulos,
  porque hoy cada mutante paga la batería entera de su módulo. Con regla dura: si un solo score se
  mueve fichero a fichero, **no se adopta** y el issue se cierra con el número.
- **(b) #441** — acotar `scene-validate`, que él solo se lleva **2.532 s = el 19,1 %**, y cuyo coste
  es en un 70 % el mutante desbocado, no la batería.

(Los pasos 2-4 de #443 se miden en local sin gastar nada; esto solo afecta al paso 1.)

- R: a

### 11 · #430 — Diferida hasta que #443 tenga respuesta

Si #443 sale que **no** compensa cambiar de runner: ¿entra `narrative-state.ts` en la medida
(~900 mutantes × 21 ficheros de batería) **pagando lo que cueste**, o se declara aparcado por escrito
con el número que lo justifique? La tercera vía —recortar su batería a mano— está medida y cuesta
rigor: en `npc-director` bajó el reloj un 85 % **y perdió un mutante** cuyo único verdugo vivía en
otro fichero.

### 12 · ¿Se serializan las baterías de la máquina?

Hoy «103/103 sin retocar un guion» valida un corte, y esa promesa **es falsa con la máquina
compartida y cierta con la máquina quieta** (cinco medidas hoy).

- **(a)** Lock global ya — cada corrida vuelve a ser un veredicto, al precio de hasta tres agentes
  esperando turno (del orden de una hora acumulada por tanda).
- **(b)** Nada: la batería es **indicativa** bajo carga y el veredicto es la corrida aislada.
  **Recomendada**, junto con arreglar los asertos: el reproductor bajo carga sintética da el rojo a
  demanda sin quitarle la máquina a nadie.
- **(c)** Declararlo en `qa/README.md` («solo válida con la máquina quieta»), que es documentar lo
  que ya pasa.

- R: b

---

## D · Una recomendación que no es pregunta

**#417** (el pin del arte de personaje es permanente: sin keep-list, lo medido no se puede reclamar)
**es vigente pero no urge**: 2 GiB de techo contra 130 MB en disco. Recomiendo **etiquetarlo
`futuro`** hasta que el disco apriete. Si prefieres que se haga, dilo y entra en la siguiente tanda.

-R: Ok, dejalo en futuro

---

## Respondidas — 2026-09-14

Las doce contestadas por el usuario. Esto es lo que abre cada respuesta, y es el documento que
citan los `requisitos.md` de las tandas que salen de aquí.

| # | Respuesta | Qué abre |
|---|---|---|
| 1 · #513 | **(a)**, y el arreglo del importe **entra en #513** | tanda A · lo pagado queda con dueño y el importe deja de mentir; absorbe **#548** |
| 2 · modo de partida nueva | **(b)** nace en Maqueta 3D | tanda A · el selector deja de venir en Imagen IA; encenderla es explícito, como en el home. Toca la misma zona que **#552** |
| 3 · #465 | **adelante** | playtest con el motor REAL (gasta créditos y su tiempo): se agenda aparte, con él delante |
| 4.1 · #484 | **(A)** el enemigo en `--nf-danger` | tanda C |
| 4.2 · #484 | **(C)** el rótulo se ve a través de la pared | tanda C · **coste 0**: es lo que ya hace. Se escribe como decisión, no como omisión |
| 4.3 · #484 | **(A)** se oculta el más lejano | tanda C |
| 5 · #478 | **(b)** chip «Connected» + **«Reintentar»** en el muro | tanda C |
| 6 · #451 | **(b)** se sirve la entrada y las buenas; solo se re-pide el tile malo | tanda C |
| 7 · #529 | **(a)** cae solo el enemigo inválido, el motivo vuelve al motor | tanda B |
| 8 · #532 | **(c)** `footprint` opcional **y** `kind: "item"` | tanda B · desbloquea **#524** |
| 9 · #538 | **(a)** se reaparece donde te mataron | **#538 NO se cierra**: (a) zanja el H10 (el bucle de muerte se acepta), pero el H2 sigue vivo y no era decisión suya — el cliente pasa una consulta de MOVIMIENTO donde core espera una de PUNTO, así que medio `puntoDeReaparicion` es inobservable y el guion 93 sale verde con el sabotaje. Eso es «un guardián que no puede ponerse rojo»: se arregla |
| 10 · #443 vs #441 | **(a)** #443 primero | tanda D · pasos 2-4 en local, sin gastar; el paso 1 pide corrida autorizada |
| 11 · #430 | diferida, correctamente: depende de lo que conteste #443 | — |
| 12 · baterías | **(b)** la batería es indicativa bajo carga | tanda D · es **#545**: arreglar los asertos y el reproductor bajo carga sintética, que da el rojo a demanda sin quitarle la máquina a nadie |
| D · #417 | sin objeción a la recomendación | etiquetado `futuro` |

