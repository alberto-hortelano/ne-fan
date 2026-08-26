# QA — El bosque es uno solo y colisiona igual para todos (#243 · #233 · #232 · #234)

Validado sobre `feature/el-bosque-es-uno` @ `3405c85`, árbol limpio. Todo lo de abajo se midió
aquí; nada se da por bueno del informe del ingeniero.

**Veredicto: APTO CON RESERVAS.** La tanda cumple lo que el usuario pidió, incluida la decisión
de producto del 2026-08-26 (el techo lo decide el motor, acotado por arriba, y se puede pasar).
Ninguna reserva bloquea el merge, pero **una afirmación del informe es falsa y no debe quedar
escrita** (§C), hay una desviación de criterio que se decidió sola (§ hallazgo 2) y una clase de
fallo NUEVA que el informe no recoge (§ hallazgo 1).

---

## Criterios de aceptación, uno a uno

Sacados de `requisitos.md` — la petición original y su «Decisión de producto del usuario
(2026-08-26)», no del plan.

| Criterio (literal) | | Evidencia |
|---|---|---|
| «Un bosque en el que todo lo que se ve se comporta igual —o frena o se atraviesa, sin dos especies conviviendo—» | ✅ | `qa/guiones/30` (fixture) y **`qa/guiones/31` NUEVO** (partida real, normaliza el bridge): 0 objetos pintados que sean vegetación, los 28 troncos del tile frenan, la casa declarada como entity llega con `volume_id`. Capturas `89`/`90`: el pinar de postes marrones atravesables pasa a ser un pinar con copas y sombras que frena |
| «un solo camino desde el esquema hasta la huella colisionable, compartido por cliente, bridge y pre-generación» | ✅ | Candado `un-solo-derivador-del-plan` en `arch-rules.json` (raíces `nefan-html/src/**` y `nefan-core/bridge/**`); `sim-collision.ts` lee `world.__plan` y ya no parsea. **Medido sobre el tile REAL volcado del juego**: el collider del bridge pasa de **1.659 a 2.008** celdas sólidas (+349 que antes no veía) |
| «`density`, un significado por campo, candado» | ✅ | `vegetation_zones.density` y `scatter_zones.density` son las dos **ejemplares/m²** (`vegetation.ts` y `scatter.ts:167`): no es un significado por campo, es **uno**. Zod único consumido por el compositor y por el gate del motor; espejo Python con el mismo tope (`narrative_schemas.py`, `MAX_VEG_DENSITY = 0.08`) |
| «El techo deja de ser una constante y pasa a ser algo que el motor puede pedir por zona» | ✅ | `vegetation_zones[].density` en el schema Format D; el motor lo pide por zona (máx. 8) |
| «Acotado por arriba, sin excepción: no puede pedir uno intransitable **ni uno que cuelgue el cliente**» | ⚠️ | La mitad «intransitable» ✅ (abajo). La mitad «rendimiento»: `MAX_TILE_VOLUMES = 240` está medido por el ingeniero pero **yo no lo he re-medido** (§ No probado), y el valor **incumple el criterio del propio plan** (§ hallazgo 2) |
| «La cota superior tiene que dejar **siempre** un camino — y eso es verificable, no opinable» | ✅ | Guion 31 **jugando**: al tope del dial los dos troncos más juntos quedan a 2,69 m y dejan una banda continua de **0,77 m** de posiciones válidas para el cuerpo del jugador; el jugador **cruza** (5,77 m de avance por la perpendicular). BFS con cuerpo sobre el collider de producción, 5 seeds distintos: cruzan **jugador (r=0,4) y NPC (r=0,5)**, 77-84 % de la zona alcanzable |
| «La prosa del contrato dice lo que el código HACE» | ✅ | Verificados contra el código los seis números de `tile_instructions.md:201-231`: techo 0,08 · 2,58 m entre troncos · presupuesto 240 · «rest» a 0,08 pide ~328 y no cabe (medido: 328, recorte a 240 con aviso) · media zona ~164 · tile entero a 0,05 ~205 |
| «se retira la vegetación de postes (ruta B)» | ✅ | `grep -rn scattered` a cero en producción (solo quedan los tres textos del test que prueba el candado en negativo) y el término entra en `campos-retirados-no-vuelven` |
| «Cero euros» | ✅ | El chip de gasto marca `gasto sesión 0,00 € · total 0,00 €` en todas mis capturas de partida real (`93-QA-*`); ninguna corrida ha tocado un proveedor |
| Freno de `requisitos.md`: «si el bosque denso desaparece del mundo, para» | ✅ no se dispara | Los cuatro mundos pre-generados del usuario compuestos con el código nuevo: `cuentos_oscuros` 188/240 volúmenes (**76 árboles + 84 matas**, antes 3 árboles y 1.049 postes), `alta_fantasia` tile de entrada 49/240 con 28 árboles. **Cero avisos de presupuesto en los cuatro** |
| «Un bosque en el que todo lo que se ve se comporta igual… verificable jugando» (criterio de terminado) | ✅ | Guiones 30 y 31 en el juego real; `node qa/run.mjs` 28/30 (§ Estado de la casa) |

---

## A · El techo del dial: ¿derivado o elegido y justificado después?

**Derivado.** La cadena es real y no hay ningún `0.08` escrito en el código:

```
PASO_LIBRE_CELDAS = ceil(2·PLAYER_RADIUS_M / TILE_MPC) + 1        = 3        celdas
MIN_SEP_TREE      = 2·treeTrunkRadiusCells(VEG_TREE_S_MAX) + 3    = 5,16     celdas = 2,58 m
MAX_VEG_DENSITY   = floor((COEF/(MIN_SEP_TREE·TILE_MPC))²·100)/100 = 0,08    ejemplares/m²
```

Comprobación que decide la pregunta: **metiendo el suelo del plan (4,16 celdas) en la misma
expresión sale exactamente 0,13**. O sea, el 0,13 del plan y el 0,08 del ingeniero salen de la
MISMA fórmula con distinto suelo: lo que cambió es el suelo (por el rasterizado), no el techo.
El techo es su consecuencia. Y sigue siendo sensible a lo que dice serlo: si engorda el jugador
o el tronco, baja solo.

Tres matices que el informe no dice y conviene que estén escritos:

1. **El techo depende también de `VEG_SPACING_COEF = 0,75`, que es un número AJUSTADO**, no
   derivado (medido: con 0,70 el techo sería 0,07; con 0,80, 0,09). No toca la garantía de paso
   —esa es el suelo—, solo hasta dónde puede el engine entregar lo que le piden. La frase «sigue
   sin haber ningún número mágico» es cierta al 90 %, no al 100 %.
2. **Dentro del rango permitido, el suelo `MIN_SEP_TREE` no llega a morder nunca entre dos
   árboles del scatter**: `sepPorDensidad(0,08) = 5,303` celdas > `MIN_SEP_TREE = 5,16`. Solo
   muerde contra los árboles GRANDES que el motor declara a mano (ahí la separación por pares sí
   trabaja, y es una buena desviación del plan). Corolario útil: la garantía de paso no la
   sostiene el suelo, la sostiene el techo — y por eso subir el techo a mano rompería el juego,
   no solo la honestidad del contrato.
3. **El «+1 celda» de redondeo es el peor caso EN EJE**, no el peor caso. Dos troncos en
   diagonal pueden perder hasta 1,41 celdas por rasterizado. Hoy no muerde (el hueco medido
   sobra), pero el comentario de `vegetation.ts` afirma el peor caso con más seguridad de la que
   la geometría da.

### ¿Se pasa entre dos troncos a la densidad máxima, JUGANDO?

**Sí, y con holgura.** No en un test: en partida, por el camino del jugador.

- El tile de bootstrap del preset `e2e-sin-creditos` declara su pinar **justo al tope**
  (`density: 0.08`), así que el caso peor del contrato se juega sin fixture inventada.
- Guion 31, tres corridas idénticas: 28 árboles, par más juntos `derived_veg_0_8 ↔
  derived_veg_0_22` a **2,69 m**, banda continua de **0,77 m** de posiciones válidas para el
  cuerpo (el sondeo ya lleva puesto el radio de 0,4 m), y el jugador **cruza andando**.
  Capturas `31-…-01-antes-de-cruzar-el-hueco.png` y `-02-despues-…`.
- Y en el mundo PRE-GENERADO del usuario (`alta_fantasia`, tile de entrada, misma densidad):
  `93-QA-mundo-pregenerado-A-03-tile00-pinar-desde-dentro.png` — se anda entre los troncos.
- BFS con cuerpo sobre `planCollisionGrid` + `createTerrainCollider` (el mismo par que usa el
  cliente), zona de 300 m² al tope, cinco tiles distintos: **jugador y NPC cruzan de lado a
  lado en los cinco**; 77-84 % de la superficie de la zona alcanzable desde el borde. Un tile
  ENTERO al tope se recorta a 240 volúmenes (densidad efectiva 0,0586/m²) con el aviso de los
  tres números, y también se cruza.

«Se anda en zigzag, nunca de frente», como dice la prosa del contrato, es una descripción
honesta de lo que se ve y de lo que se anda.

---

## B · La regresión visual del anillo de `alta_fantasia`

**Juicio: aceptable como estado intermedio. La tanda NO deja ese tile peor de lo que estaba** —
y la captura `92` lo hace parecer peor de lo que es porque está tomada a ~30 m sobre un tile
vacío.

Lo que medí antes de opinar (snapshot real del usuario):

- El tile (1,0) declara **UNA** zona de 30×20 celdas = **150 m²** dentro de un tile de 4.096 m²,
  y **nada más**: `volumes: 0`, `structures: 0`, `entities: 1`. El primer plano desnudo es el
  contenido del mundo, no un efecto de la tanda — y la captura `91` (el ANTES) enseña **el mismo
  prado vacío** con los postes a la misma distancia.
- Lo que cambió dentro de esos 150 m²: **48 postes de 1×1 celda sin copa, que se atravesaban, +
  2 árboles reales → 12 abetos reales** con copa, sombra y tronco que frena. El recuento de
  objetos baja; el área de COPA sube (12 copas de ~4-5 m de diámetro tapan más cielo que 48
  palos de 0,5 m).

Volví a fotografiarlo desde donde lo mira quien juega, en el mundo pre-generado y por el camino
real (partida nueva → andar al este → confirmar exploración):

| Captura | Qué se ve |
|---|---|
| `93-QA-…-B-02-tile10-abetal-desde-20m.png` | A 20 m: una línea de arbolado sobre un llano vacío — la lectura de «seto lejano» que preocupa. Es la distancia de la captura 92 |
| `93-QA-…-B-03-tile10-abetal-desde-8m.png` | A 8 m: un **borde de bosque que llena el encuadre**, con troncos, copas y profundidad |
| `93-QA-…-B-04-tile10-abetal-desde-dentro.png` | Dentro: bajo la copa, con troncos alrededor. Es un bosquete, y se lee como tal |

Como director de arte: el ANTES no era un bosque, era una empalizada de postes marrones sin
copa que además se atravesaba — incoherente entre lo que se ve y lo que se toca, que es
exactamente el bug de la tanda. El DESPUÉS es arbolado de verdad, con luz y sombra propias y
escala creíble. La única lectura mala (la hilera lejana) la produce **la vantage point y la
pobreza del tile**, no el cambio: un bosquete de 150 m² a 30 m de distancia se ve así antes y
después. La pareja `89`/`90` (robledo, misma cámara) no deja lugar a dudas: ahí la mejora es
inequívoca.

**Lo que sí deja abierto**, y merece issue: los 8 tiles del anillo son 4.096 m² con un bosquete
de 150 m² y nada más. Eso es un mundo pobre, y la respuesta es regenerarlo con el contrato nuevo
(cero créditos de imagen), como dice el informe. No es deuda de esta tanda; es la deuda que esta
tanda ha dejado de disimular con postes.

---

## C · El guion 15 NO se movió: la explicación del informe es falsa

El informe (§6) atribuye 9,94-9,97 → **9,81** a haber arreglado #232 («el mercader encajonado
tiene menos sitio»). **No se sostiene, por dos vías independientes.**

**1. El número no se movió.** Cinco corridas del guion 15 sobre `3405c85`, cada una con stack
propio y disco virgen:

| corrida | distancia final del mercader |
|---|---|
| batería completa (1ª) | **9,96 m** |
| aislada ×3 | **9,95 · 9,93 · 9,96 m** |
| batería completa (2ª) | **9,94 m** |

Rango 9,93-9,96, indistinguible de la base de `main` (9,94 / 9,97). El 9,81 del informe es una
corrida suya, no un desplazamiento. Y se entiende por qué es ruidoso: en el caso rojo la
condición de parada nunca se cumple, así que `d1` se mide cuando salta el cortafuegos de 30 s —
es decir, cuenta cuántos ticks de sim cupieron en 30 s de reloj de pared. El guardia varía
igual (4,55 · 4,70 · 4,73 m).

**2. El mecanismo es imposible.** Volqué del juego el Format D real del tile del bench y comparé
la solidez que el bridge veía ANTES (solo `volumes` declarados, como hacía
`buildPlanCollider(rec.scene_data)`) con la de AHORA (plan compuesto):

```
celdas sólidas del plan — ANTES 1.659 · AHORA 2.008
celdas que el bridge NO veía y ahora sí: 349
la más cercana al tabernero, a 16,10 m
```

El mercader se desplaza **0,73 m**. La taberna, sus muros y su mobiliario son `volumes`
**DECLARADOS** y ya estaban en el collider del bridge antes de la tanda; lo nuevo (la casa
derivada de la entity y los 28 árboles del pinar) está a 16 m. No pudo quitarle sitio.

**Lo que sí explica #284**, medido de paso: la posición de arranque del tabernero (celda 60,52)
cae **dentro del prop `mostrador`** (rect `[55,51,6,2]`), y su propio cuerpo (r=0,5) la lee como
sólida — antes y después de la tanda. Con la semántica «salir sí, entrar no» consigue
despegarse 0,73 m y ahí se queda. Eso es el rojo del guion 15, y no es de esta tanda.

**Acción**: corregir §6 de `implementacion.md` y **no** trasladar esa explicación al issue #284
—donde se convertiría en la pista falsa que hace perder una tarde—. El dato útil para #284 es el
del mostrador.

---

## D · Las cinco cosas sin cubrir

**1. «Una `structure` de 5×5 es casi maciza por dentro».** Medido con el collider de producción
(muro cutaway de 1,5 celdas por lado, puerta w=4):

| lado | interior donde CABE el jugador (r=0,4) | …y un NPC (r=0,5) |
|---|---|---|
| 3×3 | **0 posiciones** — maciza entera | 0 |
| 5×5 | **0 posiciones** — no se puede entrar | 0 |
| 6×6 | sí | **0** |
| 8×8 y más | sí | sí |

- **¿Alcanzable jugando?** Sí: cualquier `structure` que el motor declare por debajo de 6×6 es
  una casa en la que no se puede entrar, y **ni el zod ni `validateScene` lo dicen** (el
  flood-fill no tiene cuerpo: el caso `ninguna-puerta-alcanzable` reporta 1 celda alcanzable
  mientras el cuerpo no cabe en ninguna).
- **¿Deja algún mundo base con un edificio inaccesible?** **No.** Los cuatro mundos
  pre-generados: la única `structure` es la taberna de `alta_fantasia`, y está tapada por un
  `volumes` declarado con puerta de 2 m; el resto son buildings no-cutaway (macizos por diseño,
  como ya lo eran). Confirmo la lectura del informe: **para el jugador esto no cambia nada** —
  el cliente ya componía el plan antes, así que ese 5×5 tampoco se podía entrar ayer. Lo único
  nuevo es que el validador ha dejado de mentir.

**2. El flood-fill sin cuerpo**: confirmado como arriba. Es exactamente el mismo agujero que
deja pasar el 5×5. Un issue, los dos.

**3. La banda de exclusión de caminos (0,5) menor que el radio del tronco**: la consecuencia
jugable la cubre el guion 16, verde en las dos baterías completas (el jugador recorre la calzada
entera). Medido además que el scatter respeta **3 celdas (1,50 m)** al rect de un edificio, y
con un bosque al tope encima de una casa el jugador **sigue pudiendo entrar**.

**4. Mutación**: `npm run mutacion -- pendiente` confirma **corrida COMPLETA (9.082 mutantes)** y
que ninguno de los módulos tocados cabe en el tope local. `scene-expand.ts` y `scene-validate.ts`
siguen en `sin_mutar` con su motivo escrito. Pedida y no medida: correcto según CLAUDE.md, pero
queda como deuda declarada de esta tanda.

**5. Nada jugado con el motor narrativo de verdad**: cierto. Todo lo verificado aquí pasa por
`fake-ai-server`. **No probado** (abajo).

---

## Hallazgos

### 1 · IMPORTANTE — un NPC dentro de una casa con puerta estrecha queda encerrado para siempre (nuevo con #232)

`structures[].doors[].width` tiene por defecto 4 celdas (2 m), pero el motor puede declarar
menos. Medido sobre una sala de 24×16:

| puerta | el jugador entra (r=0,4) | un NPC entra/sale (r=0,5) |
|---|---|---|
| w=1 (0,5 m) | no | no |
| **w=2 (1,0 m)** | **sí** | **NO** |
| w=3 (1,5 m) | sí | sí |
| w=4 (2,0 m) | sí | sí |

Un NPC mide 1,0 m de AABB (`NPC_RADIUS = 0.5`, `npc-behavior.ts:89`) y el collider bloquea por
solape, así que una puerta de 1,0 m no le deja pasar. **Hasta esta tanda daba igual: el bridge no
veía esos muros y el NPC los atravesaba.** Desde #232 los ve, y `stepTowards` acaba en
`giveUpMove`: el NPC se queda quieto donde esté.

*Reproducción desde el arranque*: `./start.sh --preset e2e-sin-creditos`, partida nueva; el propio
tile del bench declara `doors: [{ side: "south", at: 11, width: 2 }]` (que hoy no muerde porque un
`volumes` declarado con puerta de 2 m tapa esa `structure` — o sea: se salva de casualidad).
*Qué esperaba el jugador*: que un tendero pueda salir de su tienda.
*Nadie lo detecta*: el zod no mira anchuras de puerta contra cuerpos, y el flood-fill de
`validateScene` no tiene cuerpo. Mismo agujero que el 5×5.
**Sugerencia**: issue. La familia entera es «la máscara de jugabilidad no tiene cuerpo»; con
erosión por el radio MAYOR de los dos (NPC), el 5×5, la puerta de 1 m y el pasillo de una celda
caen a la vez.

### 2 · IMPORTANTE — `MAX_TILE_VOLUMES = 240` incumple el criterio de aceptación del propio plan

El plan (§7) escribió el criterio: *«el mayor escalón que sostiene ≥50 fps con 4 tiles, **un
escalón por debajo** por margen»*. La medida del ingeniero da **48,1 fps** a 240 con los cuatro
tiles en pantalla — por debajo del suelo — y no se tomó el escalón de margen. Su motivo es
sólido (`MAX_VOLUMES` deja declarar 160, y el recorte va `[declarados, derivados, vegetación]`,
así que un tope de 120 recortaría geometría declarada), pero eso **cambia el criterio**, y un
criterio se renegocia, no se relaja en la tabla de desviaciones. Queda dicho para que el usuario
decida si 48 fps al cruzar una esquina le vale.

### 3 · IMPORTANTE — §6 de `implementacion.md` afirma como hecho algo que no ocurrió

Ver §C. No cambia el veredicto de la tanda, pero es exactamente el tipo de explicación coherente
que se hereda como dato: si viaja a #284, cuesta una tarde a quien lo lea.

### 4 · MENOR — el aviso de presupuesto se le enseña al JUGADOR

`__plan_warnings` sale por `errors.push("scene", …)` (`main.ts:812`), o sea al panel de errores
rojo del juego. Para un tile legítimo que se pasa de presupuesto —el motor pidió un pinar de tile
entero—, el jugador ve una entrada de error por algo que no es un fallo suyo ni del juego. El
canal correcto para el motor ya existe (`validateScene` lo devuelve como error y el motor
re-responde); esto es la segunda puerta, para la escena que llega igual. Es coherente con el
resto del panel; lo anoto porque el usuario lo verá.

### 5 · MENOR — el saneador Python descarta la zona fuera de rango en silencio para el jugador

`narrative_schemas.py` descarta la `vegetation_zone` inválida con traza (patrón del fichero) en
vez de rebotar. El gate del MCP la rebota antes con el motivo, así que en el camino normal no se
llega; por el camino que no pase por ahí, el jugador se queda sin ese bosque y nadie se lo dice
en su idioma. Consistente con el resto del saneador; no lo abro como fallo.

### 6 · MENOR — el guion 25 es intermitente (no es de esta tanda)

`25-mirar-fixtures-no-se-lleva-la-partida` falló en una de las dos baterías completas
(«el título sigue ofreciendo la partida») y pasa **verde dos veces aislado**. Su sujeto (la lista
de saves del título) no lo toca esta tanda. Merece issue: un guion intermitente se ve igual que
uno roto.

---

## Guion nuevo

**`qa/guiones/31-el-pinar-al-tope-se-cruza.mjs`** — lo mecánico de la decisión de producto del
usuario, en partida real (motor → bridge → `formatDToWorld` → cliente, que es un camino distinto
del guion 30, que entra por el selector Room y normaliza en el cliente):

1. la partida trae una zona **al tope del dial** (si el bench baja la densidad, se pone rojo y
   obliga a buscar otro caso peor);
2. entre los dos troncos más juntos cabe el cuerpo del jugador, medido **en el grid** con
   `probeCollide`, no en el hueco analítico;
3. el jugador **cruza ese hueco andando**;
4. en sesión real ningún objeto pintado es vegetación, la casa declarada como entity la
   representa su volumen, y todos los troncos frenan.

**Probado en negativo** (los tres sobre el juego real, con `git checkout` detrás de cada uno):

| Rotura | Qué se pone rojo |
|---|---|
| disco de colisión del tronco ×2,4 en `collision.ts`, **sin tocar la derivación** (el fallo que obligó a bajar el techo) | paso 2: «hueco continuo 0.00 m entre derived_veg_0_8 y derived_veg_0_22 (a 2.69 m)» y con él el corredor del 3 |
| disco del tronco a radio 0 | paso 4: «["roble_1","roble_2","pino_1","pino_2","derived_veg_0_0","derived_veg_0_1"]» |
| `volume_id` anulado en `scene-normalize.ts` | paso 4: la casa del leñador vuelve a llegar sin volumen que la represente |

Lo que **no** conseguí poner rojo por separado es el paso 3 (andar): sondeo y movimiento comparten
la misma función de colisión —que es justo la invariante de la tanda—, así que solo cae cuando el
2 ya está caído. Y no hay forma de cerrar el bosque por debajo: separación y techo salen de la
misma expresión, apretar una baja el otro y el zod rechaza la densidad. Queda escrito en el guion.

También verifiqué en negativo **el test clave del ingeniero**: con `PASO_LIBRE_CELDAS = 1`,
`vegetation-density.test.ts` se pone rojo en «en el GRID que colisiona el jugador, entre dos
troncos vecinos caben dos celdas libres» (3 fallos). Su en-negativo declarado es cierto.

---

## Workarounds usados

| Workaround | Veredicto |
|---|---|
| Para ver el bosque en el mundo PRE-GENERADO del usuario hubo que arrancar el stack a mano con `NEFAN_GAMES_DIR` apuntando a una copia que **conserva** `world/tile.json`: `qa/run.mjs` los borra a propósito | No es un obstáculo del jugador (él tiene su snapshot), pero **sí un hueco de cobertura**: ningún ejecutable de `qa/` prueba nunca un mundo pre-generado, y es lo primero que abre el usuario. Anotado, no reportado como fallo de la tanda |
| Los guiones 30 y 31 usan `setPlayerPos` para colocar al jugador frente al tronco / al hueco | No es hallazgo: es el teletransporte de bench documentado y ya usado por otros guiones, y lo que se afirma (colisión, paso) no depende de cómo se llegó. Al tile (1,0) se llegó por el camino real (andar + confirmar la exploración) y solo después se movió la cámara |
| Los tests en negativo exigieron editar código de producción a mano (radio del tronco, `volume_id`, `PASO_LIBRE_CELDAS`) | Restaurado con `git checkout` tras cada uno; `git status` limpio (solo el guion nuevo sin trackear). No queda nada tocado |
| Para volcar el Format D real del tile del bench añadí un guion temporal `99-volcado-temporal.mjs` | Borrado. Sirvió para medir §C sobre el dato real en vez de sobre una copia a mano del literal de `fake-ai-server.mjs` |

---

## No probado

- **El tope de rendimiento (`MAX_TILE_VOLUMES = 240`)**: no re-medí los fps. La medida del
  ingeniero lleva un pump de rAF parcheado y un hook de dev no commiteados, así que no es
  reproducible desde el árbol; la doy por declarada, no por verificada. Ver hallazgo 2.
- **El motor narrativo de verdad**: todo lo de arriba usa `fake-ai-server`. El contrato nuevo
  (unidad, techo, presupuesto, los avisos con los tres números) **no se ha visto ejercido por el
  modelo eligiendo densidades**. Es lo que más pide una sesión de `play` o
  `story-web-sin-imagenes` antes de dar por buena la prosa.
- **Mutación**: pedida, corrida completa, no medida (§D.4).
- **Gasto real de créditos**: cero por construcción del preset; no he ejercido ninguna ruta de
  pago, así que la paridad de claves de caché que demuestra el ingeniero la doy por declarada.

---

## Estado de la casa

```
nefan-core · npm test        1514/1514 en verde (274 suites)
qa/run.mjs (batería 1ª)      28/29 · único rojo: 15 (#284)
qa/run.mjs (batería 2ª, con el guion 31)  28/30 · rojos: 15 (#284) y 25 (intermitente, verde ×2 aislado)
qa/fixtures-sin-bridge.mjs   verde (100 frames, 1 tile, 6 billboards)
```

Capturas para mirar, en `qa/capturas/`: `89`/`90` (robledo antes/después, misma cámara),
`91`/`92` (anillo de `alta_fantasia`, del ingeniero), `93-QA-mundo-pregenerado-*` (mías, sobre el
snapshot real: el pinar al tope desde dentro y la abetal a 20 m, a 8 m y por dentro) y
`31-el-pinar-al-tope-se-cruza-*` (el hueco entre los dos troncos más juntos, antes y después de
cruzarlo).
