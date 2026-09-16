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

Ojo, dato caducado en el cuerpo: cita «el guion 93» y hoy el 93 es
`93-la-velocidad-y-el-alcance-los-dice-el-config.mjs`. Hay que **re-localizar** qué guion mide hoy
la reaparición antes de citarlo en ningún criterio.

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
