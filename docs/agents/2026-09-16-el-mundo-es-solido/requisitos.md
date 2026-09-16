# Tanda E — «El mundo es sólido»

## La petición, literal

> «Abre tanda nueva y sigue cerrando issues»

(2026-09-16, tras cerrar #545 y fusionar la PR #612. La tanda D queda cerrada entera:
#443, #441, #597, #599, #529 y #545.)

Vale también la petición de fondo que gobierna toda la serie, del 2026-09-02:

> «Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los
> plugins los podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo
> eso deben ser plugins y tienen baja prioridad en cuanto a calidad del codigo.»

## Estado medido hoy

- `main` = `b0651856`, árbol limpio, CI verde.
- Backlog: **51 abiertos = 38 de núcleo + 13 `futuro`**.
- 132 guiones en `qa/guiones/`, once candados headless en CI.

## Los tres issues de la tanda, y por qué van juntos

Los tres tienen el MISMO sujeto técnico: **la geometría sólida del mundo y quién la consulta**.
No es una agrupación temática: los tres se citan entre sí en sus propios cuerpos, los tres
aterrizan en `nefan-core/src/simulation/` (`paso-del-jugador.ts`, `obstaculos-del-jugador.ts`,
`reaparicion.ts`) o en su espejo del servidor (`nefan-core/bridge/sim-collision.ts`), y los tres
son de lo que el jugador NOTA — que el mundo no es sólido.

| # | Título | Por qué está en la tanda |
|---|---|---|
| **#601** | En diagonal contra una esquina se entra en el edificio y se cruza entero, y pasa también a 60 fps | El jugador atraviesa el mundo. Con ventana medida (0,95° a 60 fps) y reproductor propio |
| **#583** | El sim no lee la huella de nadie: los NPCs atraviesan el carro que el jugador rodea | La otra mitad del mismo mundo: dos geometrías distintas para jugador y NPC |
| **#538** | La reaparición: el escalón «centro del tile» es inobservable (collidesAt consulta movimiento, no punto) y se reaparece junto al enemigo (bucle de muerte) | La MISMA confusión que #601: una consulta de movimiento usada donde hace falta una de punto |

### #601 — la esquina

Sale de la QA del reproductor de #545. Dos cosas que se suman:
1. `pasoDelJugador` prueba los dos ejes por separado: en diagonal cada sondeo suelto sigue fuera
   de la caja mientras **la suma de los dos ya está dentro**; nadie mira el destino combinado.
2. `aabbBloquea` deja pasar todo una vez dentro (`yaDentro`, la regla «salir sí, entrar no»),
   así que una vez dentro se cruza el edificio de lado a lado.

Descartado con número por el propio issue: **no es túnel por delta grande** (4,18 m/s × el tope de
0,1 s = 0,42 m de paso contra una banda de 4,8 m) y **inflar el radio del jugador no lo arregla**
(mueve el umbral, no la geometría del fallo).

Aviso que el issue escribe y esta tanda hereda: **la regla «salir sí, entrar no» no se puede
quitar** — existe para no encerrar a quien aparezca dentro de algo (ver `reparto-de-spawns.ts:20`).

Reproductor ya escrito: `qa/la-esquina-de-la-caja-se-corta.mjs` (nació con el issue, probado en
negativo por sus dos puertas). Guion de navegador relacionado: `91-la-forja-que-el-motor-pone-ya-no-se-atraviesa.mjs`
— tres de sus cinco rojos históricos se atribuyeron a ESTE issue en la tanda D.

### #583 — la huella que el sim no lee

`nefan-core/bridge/sim-collision.ts` construye la colisión del NPC solo con el `terrain_grid` y el
plan compuesto. **No lee la huella de ninguna entidad de runtime.** El jugador sí las lee
(`aabbBloquea` mira las cajas con dueño desde la PR 5 de #241).

**Conflicto que el crítico TIENE que resolver, y es de premisa**: la cabecera de `sim-collision.ts`
(líneas 20-27) declara HOY que eso es intencional y explica por qué («las cajas de los objetos sin
volumen son del JUGADOR… este proveedor no las llama A PROPÓSITO»). O sea: el issue pide cambiar
algo que el código documenta como decisión tomada. O la decisión caducó con #532/#490 (que es lo
que el issue sostiene: ahora el motor declara `footprint` y un granero de 10×7 m se atraviesa), o
el issue está reclamando una divergencia que se decidió a propósito. **No se implementa nada hasta
que eso esté dictaminado con el código delante.**

Lo que el issue mismo deja abierto: qué pasa con el NPC **que ya está dentro** de una caja recién
aparecida (candidata obvia: la misma regla «salir sí, entrar no»), y **cuánto cuesta por frame**
con el número de entidades de un tile real.

### #538 — la reaparición

Dos mitades, y solo la primera es técnica:

- **H2 (técnico)**: el cliente pasa a `puntoDeReaparicion` una consulta de MOVIMIENTO
  (`collidesAt`), no de punto, y esa consulta nunca dice «sólido» para la posición en la que el
  jugador ya está. El escalón «si estás en un sólido, al centro del tile» es por tanto
  **inobservable desde el juego**: el sabotaje «devuelve `pos` sin comprobar sólidos» deja el
  guion verde. Es la misma confusión de eje que #601: movimiento donde hacía falta punto.
- **H10 (decisión de juego)**: se reaparece donde te mataron, con el enemigo a un paso → muere, R,
  muere. El issue ofrece tres reglas: el `__player_start` del tile, el último punto seguro, o el
  centro con el enemigo desenganchado. **Es decisión del usuario, no del equipo.**

~~Ojo, dato caducado en el cuerpo: cita «el guion 93» y hoy el 93 es
`93-la-velocidad-y-el-alcance-los-dice-el-config.mjs`.~~ **CORREGIDO por el crítico el mismo día: el
dato NO estaba caducado y el error era mío.** Ese 93 es exactamente el que mide la reaparición
(bloque 4), documenta H2 palabra por palabra en su cabecera (`:45-56`) y lo registra en ejecución sin
afirmarlo (`:432`). Es el único guion del banco que afirma algo sobre reaparición. No hay nada que
re-localizar: lo escribí mirando el título del fichero en vez de su contenido.

## Lo que se le pide al crítico

1. **Verificar las tres premisas contra el código de HOY**, en este orden de riesgo:
   - #583 primero, por el conflicto con la cabecera de `sim-collision.ts` descrito arriba.
   - #601: ¿sigue existiendo la ventana angular? El reproductor
     `qa/la-esquina-de-la-caja-se-corta.mjs` da el rojo a demanda: **córrelo**, no lo cites.
   - #538: ¿sigue siendo inobservable el escalón? ¿Qué guion lo mide hoy?
2. **Decir si los tres deben hacerse tal como están escritos**, o si alguno está obsoleto,
   reencuadrado o prematuro. Precedente vivo: en esta serie el crítico ha tumbado o reencuadrado
   un issue en casi todas las tandas, y dos veces el issue estaba **ya hecho**.
3. **Nombrar las decisiones que son del usuario** y presentarlas con opciones cerradas y su coste:
   como mínimo la regla de reaparición de #538(b) y el NPC-ya-dentro de #583.
4. **Buscar el conflicto entre los tres**: #601 y #583 tocan la misma geometría desde los dos
   lados; si el arreglo de #601 cambia la forma de `aabbBloquea`, #583 hereda esa forma. Decir si
   hay orden obligado o si pueden ir en paralelo, y en qué ficheros chocarían.
5. Si algo cabe fuera de la tanda o falta un issue hermano sin número, decirlo.

## Restricciones de la casa que aplican a esta tanda

- **Cero créditos** en toda la verificación: `html-fixtures`, `e2e-sin-creditos`, motor falso.
- **Otros agentes trabajan en esta máquina**: nunca `pkill`, nunca matar por puerto, nunca
  `--parar-todo`. Arrancar solo con `NEFAN_PORT_OFFSET=<n> ./start.sh --preset <slug>` desde el
  árbol propio; parar solo con `NEFAN_PORT_OFFSET=<n> ./start.sh --parar` desde ese mismo árbol.
- **Ningún umbral se baja** (ni se sube para acomodar lo que acaba de crecer).
- Lo que se retira se retira entero: prosa, comentarios y docs incluidos, con `grep` a cero.
- Las cifras se **miden hoy**; copiar un número del issue bajo el rótulo «medido» no es medir.

---

# Decisiones del usuario (2026-09-16, tras la crítica)

Las cuatro se le presentaron con las opciones cerradas y el coste de cada una que escribió el
crítico. Lo elegido, literal:

### 1 · Alcance — **«Los tres, con #538 dentro»**

Entran #601, #583 y #538. El orden del crítico se respeta: **#601 primero y solo**, **#583 detrás y
nunca a la vez** (hereda la forma de `aabbBloquea`; el fichero que choca es
`src/simulation/obstaculos-del-jugador.ts`), y **#538 en paralelo con cualquiera de los dos**, porque
con la decisión 4 ya no toca ese fichero.

### 2 · El bucle de muerte (#538 H10) — **«A la sesión de combate»**

H10 **sale de esta tanda entero**. Sus tres causas van juntas a una sesión de diseño de combate:
(1) reapareces donde caíste, (2) el pestillo de `engaged` que no se suelta (**#377**, `futuro`) y
(3) morir cura a todos los enemigos a tope (`game-loop.ts:237`, **#325**, `futuro`). Partirlo aquí
arreglaría un tercio y congelaría los otros dos.

**Consecuencia obligatoria**: la tercera causa **no tiene issue propio** —está dentro de #325, que es
de economía de combate— y las tres juntas no están escritas en ningún sitio. Antes de cerrar #538 hay
que dejar H10 con dueño: un issue hermano `futuro` + `juego` que nombre las tres causas y las enlace,
o la anotación en #325 y #377. Cerrar #538 sin eso convierte un hallazgo medido en deuda invisible.

### 3 · El NPC que no puede rodear (#583) — **«Atraviesa si no puede rodear»**

La caja de runtime frena al NPC, **salvo cuando no hay salida**. Es la regla «salir sí, entrar no»
del jugador más un escape para el encajonado, y evita el NPC congelado sin abrir nada más.

Notas que el arquitecto hereda con esta decisión:
- «No puede rodear» hay que **definirlo con el código delante**: el steering es por deflexión con
  `TODO(A*)` declarado y hoy agota **7 deflexiones** y cae a `idle` (`npc-behavior.ts:117`, `:647-649`).
  La lectura barata es que ese agotamiento sea justo la puerta del escape; el arquitecto decide y lo
  escribe.
- El riesgo que motivó la pregunta **no desaparece, se contiene**: dos spawns del mismo turno dejan
  `HOLGURA_ENTRE_SPAWNS_M` = **1,0 m** y el cuerpo del NPC pide **1,5 m** (#289). Con esta decisión no
  bloquea a nadie, pero el hueco sigue mal dimensionado para el NPC: **anotarlo en #524** con las dos
  constantes, sin abrir issue nuevo.
- El escape es observable y **tiene que declararse**: un NPC atravesando una caja es exactamente el
  síntoma de #583. Que se vea en la traza de dev por qué pasó, o el arreglo se lee como el defecto.

### 4 · El escalón 2 de `puntoDeReaparicion` — **«Borrarla»**

Se borra la rama «si estás en un sólido, al centro del tile», que ningún llamante puede ejecutar, con
**todo su rastro**: la prosa de `reaparicion.ts:20-25`, la suite «lo que NO promete» de
`test/reaparicion.test.ts`, y las líneas `:45-56` de la cabecera del guion 93 que la describen. Regla
de la casa: lo que ya no tiene camino se borra el mismo día, no se documenta como legacy.

**Esto es lo que resuelve H2, y lo resuelve por retirada**: al morir el escalón 2 muere su parámetro
`solido`, y con él la consulta de MOVIMIENTO que el cliente le pasaba donde hacía falta una de PUNTO.
No hay que cablear ninguna consulta de punto. Si al hacerlo aparece que el parámetro sigue teniendo
otro uso vivo, **eso es un hallazgo y se reporta**, no se apaña.

Queda escrito para quien lo lea dentro de un mes: **la pieza que falta en el repositorio sigue
faltando** — no hay una pregunta «¿es sólido este PUNTO?» para las cajas, solo «¿puedo moverme hasta
aquí?». Esta tanda no la crea; la retira del único sitio donde estaba mal usada.

## Corte en PR

| PR | Issue | Qué | Orden |
|---|---|---|---|
| **1** | #601 | La entrada por la esquina y el «salir sí, entrar no» por caja entera → celda a celda, o su equivalente. Borra `qa/la-esquina-de-la-caja-se-corta.mjs` y sus dos líneas de `qa/README.md` | Primera y sola |
| **2** | #583 | Las huellas de los spawns de **runtime** entran en la colisión del sim, con el escape del encajonado. `spawnsDeRuntime` es la fuente, no `narrative.entities`. Ojo a la caché de `collidersFor`, que no invalida nunca | Detrás de la 1 |
| **3** | #538 | Borrar el escalón 2 con todo su rastro; dejar H10 con dueño antes de cerrar el issue | En paralelo |
