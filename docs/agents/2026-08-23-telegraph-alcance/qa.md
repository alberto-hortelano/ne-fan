# QA — El telegraph enseña hasta dónde llega (#184 + #185)

Rama `fix/telegraph-alcance` (PR #263), árbol en `9271ced`. Validado contra `requisitos.md` y los
cuerpos de los issues, **no** contra el plan. Cero créditos: todo con `e2e-sin-creditos` (fake-ai-server)
y el selector «Room».

Guion nuevo: **`qa/guiones/23-telegraph-los-cinco-ataques-y-todo-suelo.mjs`** (27 afirmaciones, verde,
probado en rojo de tres maneras). Fila añadida a `qa/README.md`.

---

## 1. Criterios → veredicto y evidencia

| # | Criterio (de la petición y de los issues) | | Evidencia |
|---|---|---|---|
| C1 | Con el ataque preparado, el jugador ve **dónde deja de llegar**, no solo el punto dulce | ✅ | Contorno rojo continuo en las 4 capturas que tomé en vivo y en las 6 del ingeniero. `fps().telegraph.borde.lejos` en cuadro para **los cinco** ataques: `413 / 336 / 358 / 449 / 413 px` sobre un lienzo de 775 (guion 23) |
| C1b | El **arco del cono** (±60°, el tercer límite que el issue no mencionaba) también se ve | ✅ | Las dos cuerdas convergiendo hacia el jugador en `telegraph-despues-01-heavy-campo-abierto.png` y en `capturas/qa-11-heavy-2.png`; en el shader el contorno sale de `attackAreaMargin`, que incluye `conoMargin` (`attack-area.ts:47`), y `test/attack-area.test.ts` afirma el borde del arco con un punto de margen **cero exacto** |
| C1c | La rampa roja deja de ser invisible (la alfa ya no ES la calidad) | ✅ | `TELEGRAPH_FILL_MIN_A = 0.28` (`fps-gl.ts:108`) + `a = max(relleno, borde·(1−uImpact))`. Antes/después: el «antes» es una mancha verde sin frontera (`telegraph-antes-01-*`), el «después» tiene marco |
| C1d | El borde **CERCANO** del alcance también se ve | ⚠️ | Existe y está proyectado, pero cae **fuera del cuadro**: con la mirada a −30° da `y = 1060 / 974 / 839 / 1294` px en un lienzo de 745–775 para heavy/quick/medium/defensive; solo `precise` (740) roza el borde inferior. Está a 0,2–0,7 m del jugador: es mirarse las botas, y con el tope de pitch en ±85° (`main.ts:1216`) se puede. No lo cuento como fallo — «hasta dónde llega» es el borde lejano — pero el guion 22 lo declara «en cuadro no exigible» y conviene que quede dicho aquí también |
| C2 | Un **candado** se pone rojo si el margen entre el overlay y el stack de suelo se agota | ✅ | Reproducido en rojo **cinco** veces (§3.2), incluida la convención equivocada. Con matiz importante: **tiene un agujero** (hallazgo H1) |
| C2b | La cota se **deriva** del generador, no se mide sobre fixtures | ✅ | `GROUND_OVERLAY_Y_M = GROUND_STACK_TOP_M + CLEARANCE` = 0,105 + 0,02 = **0,125 m**, leído en el renderer real: `{"topY":0.105,"overlayY":0.125,"holguraM":0.02,"calcos":57}` en `puerto_tile` |
| C2c | El techo del suelo es **constante**, traiga el tile los rasgos que traiga | ✅ | Guion 23 sobre **las tres** fixtures del selector: `puerto_tile` 57 calcos → 0,105 m; `robledo_tile` 14 → 0,105 m; `zorder_test` 0 → 0. Y en unidad, el peor tile legal del schema (1594 prims planas) tampoco pasa de 0,105 |
| C2d | El caso real es **reproducible** (#185 «ya ocurre») | ✅ | Medido con el código de `main` reconstruido: `puerto_tile` dejaba el suelo en **0,219 m** contra el parche a 0,2 → enterrado. Confirmado en el renderer REAL: con el escalonado repuesto y stack nuevo, el guion 23 imprime `cara alta 0.219 m ⇒ holgura -0.094 m` |
| C3 | Capturas antes/después para juicio de director de arte | ✅ | 12 pares en `docs/agents/2026-08-23-telegraph-alcance/capturas/`; mi crítica en §2 |
| — | **Fuera de alcance respetado**: no se rediseña la fórmula de combate ni los tipos de ataque | ✅ | `combat_config.json` sin tocar en el diff; `resolveAttack` solo extrae `FRONT_COS` a constante; `npm test` 1348/1348 |
| — | Una sola fórmula: el parche no puede divergir del daño | ✅ | `test/attack-area.test.ts` afirma paridad con `resolveAttack` punto por punto sobre rejilla 61×61 de los cinco tipos reales y **en dos marcos** (el trivial y uno desplazado y girado — el detalle que impide un falso verde referido al origen del mundo) |
| — | La **tercera** copia de la fórmula (destello de impacto) se saltaba el cono frontal | ✅ | Verificado numéricamente en el cliente vivo con la proyección exacta de `main.ts`: enemigo a la ESPALDA a la distancia óptima → fórmula vieja **1.0** (verde pleno: «golpe perfecto») · `attackAreaQuality` **0** (gris). A 90° → vieja 0.15, nueva 0. Ver §3.3 |
| — | Estados: **los cinco tipos** de ataque | ✅ | Guion 23: cada uno publica SU geometría (óptimo/radio/alcance distintos), ninguno pinta la del anterior, y el borde lejano cae en 4 alturas de pantalla distintas |
| — | Estados: **con y sin arma** | ⚠️ | «Sin arma» **no es un estado del juego**: `nefan-html/src/main.ts:534` fija `const playerWeaponId = "short_sword"`. Todo lo probado va con espada corta (heavy 1,7 ± 1,5 m = 2,0−0,3 y radio 2,5×0,8). Ver hallazgo H6: dos documentos entregados dicen «arma desnuda» sobre números que son de la espada |
| — | Estados: **enemigo delante y a la espalda** (en vivo) | ⚠️ | **No probado en vivo**: sin motor narrativo no hay enemigos (un enemigo exige `combat.weapon_id` en la entity, `main.ts:910`; ninguna fixture lo trae y el `fake-ai-server` no sirve ninguno). Cubierto por cálculo (arriba) y por `test/attack-area.test.ts` («a la espalda no hay área, ni siquiera a la distancia óptima») |
| — | Estados: **suelos que más rasgos apilan** | ✅ | `puerto_tile` (15 rasgos, 57 calcos, río + 4 embarcaderos) en vivo, y el peor tile legal del schema (64 rasgos, 1594 prims) en unidad |
| — | Estados: overlays y arranque | ✅ | Entrada por el flujo real: título → «Nueva partida» → mundo Miravanda + **Maqueta 3D** + **Base y_bot** → «Comenzar»; y por título → `✕ cerrar (modo fixtures)`. El muro de error (`narrative-loader`) se cierra por SU botón. El parche se ve en los dos caminos |
| — | Atlas pintado (superficies IA) | ⚠️ | **No probado — gasta créditos.** Es un hueco real, no una formalidad: ver H7 |
| — | Z-fighting temporal con cámara en movimiento | ⚠️ | **No juzgable aquí** (el navegador del bench corre a ~7 fps). Estructuralmente ya no puede ocurrir entre calcos: ninguno escribe profundidad, así que su orden es determinista y no depende del z-buffer |

---

## 2. Crítica visual (director de arte y jugador)

Miradas las 12 del ingeniero y 7 propias tomadas en vivo, copiadas junto a las suyas
(`capturas/qa-*.png`).

**Lo que funciona, y funciona mucho.** El par `04-puerto-sobre-el-embarcadero` es el que más dice, y el
ingeniero acierta al señalarlo: en el «antes» hay un NPC a dos pasos, `Heavy` marcado en el HUD y **la
pantalla no dice nada** — no hay parche, no hay borde, no hay pista de si ese golpe llega. En el
«después» hay un área cerrada con un contorno rojo continuo y un núcleo verde. **Sí se entiende hasta
dónde llega sin que nadie lo explique**: el rojo lee como «hasta aquí» sin leyenda, que es exactamente
lo que pedía #184.

**¿El contorno compite con el relleno o lo completa?** Lo completa. Son dos lecturas en dos escalas: el
degradado verde↔ocre es la puntería fina (dónde pega mejor) y el marco rojo es el dato binario (dentro
o fuera). No se estorban porque el rojo del contorno vive donde el relleno ya casi no tiene calidad. En
`precise` —el caso que el plan marcaba como riesgo, radio 0,77 m— el marco **no se come el parche**: la
banda de ±15 cm ocupa mucho en proporción, pero deja interior legible y el punto verde se distingue
(`telegraph-despues-01-precise`, y mi `qa-13-precise-windup.png`).

**¿Se lee sobre suelos claros y oscuros?** Sí, en los cuatro que he podido poner debajo:
- hierba media (`robledo_tile`, `zorder_test`): el mejor caso, contraste alto;
- empedrado claro del muelle: el rojo aguanta, el relleno casi desaparece;
- tablones oscuros del embarcadero: el relleno gana mucha presencia (naranja intenso) y el contorno
  sigue leyéndose;
- tierra del camino: correcto.
En una misma captura con dos suelos (`qa-20-puerto-heavy.png`) se ve el desequilibrio: **el mismo
parche parece dos parches distintos** según lo que tenga debajo, porque el relleno es alfa sobre el
color del suelo. No es un fallo — es la consecuencia natural de un decal translúcido — pero es lo que
haría que en un interior oscuro el parche pareciera un charco de lava.

**Reservas de arte (mías, no bloqueantes):**
1. El rojo está **muy saturado y con halo**; con ACES + exposición 1.1 satura hacia rosa en los bordes.
   Sobre madera oscura el conjunto parece un efecto mágico, no una guía de puntería.
2. El **suelo de alfa 0.28** (×2.2 de ganancia ⇒ ~0,19 de alfa real en el borde y ~0,66 en el punto
   dulce) tiñe el suelo lo bastante como para **quitarle identidad de material**: la hierba se vuelve
   oliva y los tablones, naranja. La crítica ya avisaba de que el riesgo pasaba de «no se ve» a «tapa»;
   hoy no tapa a nadie (los pies del NPC se pintan por encima, verificado en `despues-04`), pero sí
   cubre el suelo.
3. El **destello de impacto gris** es una losa grande y oscura que ocupa media pantalla (`qa-12`). Lee
   como sombra, no como «fallaste». No cambia respecto al «antes» salvo que ahora es más limpia (24
   pasos en vez de 10 — comparar `antes-02` con `despues-02`, el escalonado del borde desaparece).
4. La forma del contorno: con `heavy` a −30° la silueta es un rectángulo redondeado y **las cuerdas del
   cono quedan fuera de cuadro** salvo si miras más abajo; el jugador ve un límite lateral recto que en
   realidad es el radio, no el arco. No es incorrecto, es que el arco vive a los pies.

Ver «PARA EL USUARIO» al final: 1 y 2 son decisiones estéticas, no defectos, y no las toco.

---

## 3. Las dos afirmaciones que el coordinador pidió verificar

### 3.1 «Las medidas estaban cortas media rebanada» — **CIERTA, y más grande de lo que dice**

Reconstruí la geometría de `main` desde la de HEAD (el único cambio en `fps-spec` es
escalonado→`groundOrder`, y el lift viejo de la prim k era exactamente `(k+1)·0,002`), y medí la cara
alta con las **tres** convenciones posibles:

| Tile | prims planas | `pos.y` a secas | `pos.y + t/2` (centro) | `pos.y + t` (**BASE**, la real) |
|---|---|---|---|---|
| puerto del crítico (río + 4 decks + 6 caminos + 4 plazas) | 63 | **0,2160** | **0,2235** | **0,2310** |
| pueblo (8 caminos + 6 plazas) | 62 | **0,1690** | **0,1765** | 0,1840 |
| `robledo_tile` | 14 | 0,1180 | **0,1255** | **0,1330** |
| `puerto_tile` (la fixture nueva) | 57 | 0,2040 | 0,2115 | **0,2190** |

Los números en negrita son literalmente los que aparecen en cada documento:
- el **issue #185 y la crítica** (0,2160 · 0,1690) midieron `pos.y` **a secas**: cortos una rebanada
  ENTERA (15 mm), no media;
- el **plan** (0,2235 · 0,1765 · 0,1255) midió `pos.y + t/2`: cortos **media rebanada** (7,5 mm);
- la convención correcta es la BASE (`GreyboxPrimitive.pos` = «y = BASE de la pieza»,
  `greybox/common.ts:16`; y así la ancla el renderer: `g.translate(0, s[1]/2, 0)` para box/cylinder y
  `g.translate(0, t, 0)` para polygon, `fps-gl.ts:289/306/346`).

**Y lo confirma el renderer, no solo mi aritmética**: con el escalonado repuesto y un stack recién
arrancado, `fps().suelo` dice `cara alta 0.219 m` en `puerto_tile` y `0.133 m` en `robledo_tile` —
exactamente la columna BASE. Así que sí: **el defecto de #185 era mayor que el medido en cualquiera de
los tres documentos**, y la conclusión del ingeniero es correcta aunque su reparto de culpas no lo sea
(hallazgo H4).

**¿Tiene el test la convención equivocada?** No. `caraAltaM` de `ground-overlay.test.ts` usa
`p.pos[1] + t` con el grosor entero y el grosor correcto por forma (`size[0]` en `polygon`, `size[1]`
en `box`/`cylinder`). Y **no basta con eso**: lo que hace que un test así no pueda salir verde con el
parche enterrado es que la cota está acotada **por los dos lados** —`alta <= TOP` y `alta >= TOP`—, así
que medir por el centro no da «un poco de margen de más», da **rojo**. Lo probé:

```
N5 · caraAltaM medido por el CENTRO (pos + t/2)
  ✖ AssertionError: el techo 0.105 m está por encima de la cara alta real 0.0975 m
```

### 3.2 «El candado está probado en rojo de tres maneras» — **CIERTO; lo puse rojo de cinco**

Reproducido con `npx tsx --test test/ground-overlay.test.ts`, revirtiendo el árbol tras cada mutación
(script en el scratchpad; `git status` limpio al final):

| | Mutación | Resultado |
|---|---|---|
| N1 | `GROUND_STACK_TOP_CELLS = Y_DECK + LAYER_T/2` (media rebanada) | ✖ `cara alta 0.105 m supera el techo declarado 0.0975 m` — **el mensaje literal del informe** |
| N2 | Vuelve el lift de 2 mm por prim | ✖ `cara alta 3.293 m supera el techo declarado 0.105 m` (el informe dice 3,2855: ver H3) |
| N3 | `Y_DECK` 0,18 → 0,24 sin tocar la constante | ✖ `el techo 0.135 m está por encima de la cara alta real 0.08 m` |
| N4 | Techo inflado (`+0.1`) que nadie alcanza | ✖ `el techo 0.155 m está por encima de la cara alta real 0.105 m` |
| N5 | El propio test medido por el centro | ✖ (arriba) |

Y el **guion 22**, también en rojo, con stack nuevo y el escalonado repuesto: 4 afirmaciones caídas
(`holgura -0.094 m` en el puerto, `-0.036` en robledo, y el techo dejando de ser constante).

Dos cosas que se aprenden mirando los rojos:
- **N3 se pone rojo por la razón contraria a la que dice el comentario.** Subir `Y_DECK` a 0,24 saca las
  prims del deck de la banda `GROUND_BAND_MIN/MAX` (`fps-spec.ts:71-72`), así que dejan de contarse como
  rasgos de suelo y la cara alta MEDIDA *baja* a 0,08. Salta la cota inferior, no la superior. Es de ahí
  de donde sale el hallazgo H1.
- La cota inferior (`alta >= TOP`) es la mitad del candado que de verdad trabaja: sin ella pasan N1, N3,
  N4 y N5.

### 3.3 La tercera copia de la fórmula (§4.5 del informe) — **verificada**

En el cliente vivo, con la proyección exacta que ahora usa `main.ts:1728-1731`
(`avance = f·d`, `lateral = f×d`) y los params reales de `heavy`:

| Punto | fórmula VIEJA de `main.ts` | `attackAreaQuality` |
|---|---|---|
| delante, a la distancia óptima | 1.0 | **1.0** |
| **a la espalda, a la distancia óptima** | **1.0** (verde pleno: «golpe perfecto») | **0** (gris) |
| a 90°, a la distancia óptima | 0.15 (verdoso) | **0** |

O sea: el destello decía *golpe perfecto* mientras el resolver no hacía ni un punto de daño. El arreglo
es real y el cambio de comportamiento (gris) es el correcto.

---

## 4. Hallazgos

### H1 · IMPORTANTE — el candado nuevo tiene un agujero por donde vuelve #185

`groundOrder` (y por tanto el trato de calco, y por tanto la medida del test) solo se aplica a prims
dentro de la banda `GROUND_BAND_MIN 0.045 … GROUND_BAND_MAX 0.185` celdas (`fps-spec.ts:71-80`). Como
`Y_DECK = 0.18` y `LAYER_T = 0.03`, **cualquier capa nueva por encima del deck cae fuera de la banda**
(sobran 5 milésimas de celda). Y una prim fuera de la banda: (a) no es calco — conserva `depthWrite`,
así que **sí puede enterrar el telegraph**; (b) no la mide `ground-overlay.test.ts`, que filtra por
`groundOrder !== undefined`.

Reproducción (hecha y revertida): añadir en `groundFeaturePrims` una pasada más de `deck` a `0.22`
celdas —una pasarela, un embarcadero de dos alturas, lo que sea—:

```
capa nueva a 0.22 celdas (por encima de GROUND_BAND_MAX=0.185)
  ✔ ningún rasgo de suelo pasa de GROUND_STACK_TOP_M, ni en el peor tile del schema
  ✔ un tile de puerto ordinario deja sitio al calco con la holgura entera
  ✔ la cota del calco es el techo del suelo más la holgura, no un número a ojo
```

Verde. Y la cara alta REAL de esa capa es `(0.22 + 0.03) × 0.5 = 0.125 m` — **exactamente la cota del
parche**: coplanar, o sea enterrado o parpadeando.

Lo que lo convierte en hallazgo y no en paranoia es que el comentario de `greybox.ts:66-72` promete
literalmente lo contrario: «Si alguien añade una capa por encima del deck y no actualiza esto,
`test/ground-overlay.test.ts` se pone rojo». Es el **mismo pecado del comentario que esta tanda borró**
(el de `fps-gl.ts:66-72`, que generalizaba una medida): un comentario que dice más de lo que el código
sostiene. Hoy no rompe nada; el día que alguien añada una capa, rompe en silencio.

Pasos desde el arranque: no hay — es una regresión futura, no un estado alcanzable hoy.
Lo que esperaba: que el candado cubriera lo que su comentario promete.

### H2 · MENOR — el único cambio de comportamiento visible sin candado es el destello de impacto

La corrección de §4.5 (el enemigo a la espalda deja de teñir el destello de verde) no tiene test ni
guion: `nefan-html` no tiene harness y `debugState()` publica `telegraph.mode` pero **no la calidad ni
el color del destello**, así que ni siquiera es afirmable desde un guion. El resto de la tanda está
candado; esto viaja a fe. (Publicar `telegraph.impacto: {calidad}` en `debugState` lo haría afirmable
en tres líneas — no lo aplico, lo reporto.)

### H3 · MENOR — números medidos con la convención vieja que sobreviven en lo entregado

La tanda declara haber corregido el anclaje «en todos lados» (§0), pero quedaron dos:
- `implementacion.md` §3, salida N2: `cara alta 3.2855 m`. El test, con su `caraAltaM` por la BASE, no
  puede imprimir ese número: imprime **3.293**. 3,2855 es la medida por el CENTRO.
- `qa/guiones/22-telegraph-ensena-el-borde.mjs`, docstring: «`puerto_tile` … dejaba la cara alta del
  suelo en **0,2115 m**» y «holgura **−0,0115 m**». El renderer real dice **0,219** y **−0,019**
  (medido arriba, §3.1).

No afecta al código; sí a la próxima persona que use esos números como referencia — que es
exactamente cómo nació #185.

### H4 · MENOR — el reparto de culpas de §0 no es el que fue

«Esas cifras —las del plan, las de la crítica y las mías iniciales— usaban `pos[1] + grosor/2`»: la
crítica y el issue usaban `pos[1]` **a secas** (0,2160 y 0,1690 son eso), una rebanada entera corta. Y
la frase «el tile de puerto dejaba el suelo en 0,219 m … no en 0,2235 medidos mal» compara **dos tiles
distintos** (la fixture de 57 prims contra el tile sintético del crítico de 63); bien medido, el del
crítico son 0,231. La conclusión —el defecto era mayor— es correcta en los dos casos.

### H5 · MENOR — trampa operativa que puede convertir un «antes/después» en ficción

Editar un fichero de `nefan-core` con el cliente ya arrancado **no llega al navegador**: el dev server
de vite sigue sirviendo el transform anterior. Comprobado a pelo:

```
$ curl -s "http://localhost:3000/@fs/.../fps-spec.ts" | grep -c "0.002"   → 0
   (con la línea del escalonado presente en el fichero de disco, y tras `touch`)
```

Se dispara después de un `git checkout` del fichero (vite pierde el watch del inodo). Me costó un
negativo falso-verde: la primera vez que repuse el escalonado, el guion 22 salió **verde** midiendo
0,105 m. Con el stack recién arrancado, el mismo cambio da 0,219 m y rojo. Queda escrito en el
docstring del guion 23. Es también la razón por la que las capturas «antes» del ingeniero son
creíbles: solo cuadran si su stack se arrancó DESPUÉS del stash (y cuadran: enterrado bajo el deck).

### H6 · MENOR — «arma desnuda» en dos documentos, cuando el cliente siempre lleva espada

`nefan-html/src/main.ts:534`: `const playerWeaponId = "short_sword";` — constante, sin estado ni
inventario detrás. Los números que el guion 22 y la fila de `qa/README.md` atribuyen al «arma desnuda»
(alcance 0,2–3,2 m para `heavy`) son los de la **espada corta** (2,0−0,3 ± 1,5); desarmado sería
0,1–3,1 con radio 1,75. Consecuencia para QA: **«sin arma» no es un estado probable hoy**, y así lo
declaro arriba.

### H7 · MENOR (pero es el hueco real de verificación) — nada se ha visto con atlas pintado

Todas las capturas —las del ingeniero y las mías— son clay. No lo gasto, como se me pidió, pero digo
qué queda sin ver, que es más que el riesgo que él declara en §4.3:
1. su riesgo (una celda del atlas con alfa con agujeros ahora se vería a través, porque los calcos ya no
   escriben profundidad) — peor caso benigno;
2. **el mío, que es de arte**: el relleno del telegraph es alfa sobre el color del suelo, y sobre clay
   plano el resultado es limpio. Sobre superficies pintadas (con textura, grano y luz ya horneada) un
   velo verde‑naranja al 19–66 % es otra cosa, y la pregunta «¿se sigue leyendo el material debajo?» no
   tiene respuesta hasta que alguien lo pinte. Con esta iluminación de desarrollo (ambient alto) el
   parche ya es lo más saturado de la pantalla.

### H8 · MENOR — cosmético de HUD

Si el jugador cambia de ataque **mientras uno está en vuelo**, el HUD marca el nuevo inmediatamente y
el parche del suelo sigue mostrando el área del golpe en curso. El comportamiento del parche es el
correcto (el wind‑up ya empezó con esos metros); lo que discrepa un instante es el HUD. Lo cazó mi
guion 23 al probarlo en negativo (`medium` publicaba los metros de `heavy`).

---

## 5. Workarounds usados durante la prueba

| Workaround | ¿Afecta al jugador? |
|---|---|
| `?input=scripted` + `window.__nefan.inputDriver` para conducir | **No.** Es el camino de todos los guiones y ejerce el mismo código que 1..5 y LMB. El HUD refleja las mismas selecciones |
| «Bombeo» de ataques (re-disparar mientras no hay telegraph) para fotografiar el wind-up | **No** — es instrumentación del observador. Pero enseñó H8: un ataque en vuelo se come el cambio de tipo |
| Selector «Room» para llegar a `puerto_tile` | **No.** Es el camino documentado de las fixtures y está en el HUD; además funciona con sesión viva (cambié de la escena del motor al puerto sin recargar) |
| Mutaciones temporales del árbol (5 en core, 1 en el cliente, 1 en el guion) para los negativos | **No.** Todas revertidas; `git status` limpio verificado tras cada una |
| Reproducción del «antes» con `depthWrite:true` + holgura −0,01 | **No**, pero **enseña algo que conviene saber** (§6) |
| Cerrar la pestaña de mi navegador para correr el guion | **Sí, ojo**: con DOS clientes conectados al bridge el guion 22 falló por timeout esperando el wind-up. No es de esta tanda, pero explica un rojo intermitente si alguien deja una pestaña abierta |

---

## 6. Una observación estructural que nadie ha escrito

El síntoma de #185 está prevenido hoy por **dos mecanismos independientes**, y solo uno tiene candado:

1. la cota derivada (0,125 m > 0,105 m) — candada por `ground-overlay.test.ts` y por el guion 22;
2. que los calcos de suelo **ya no escriben profundidad** (`fps-gl.ts:756`) — sin candado ninguno.

Lo comprobé por accidente: puse la holgura en **−0,01 m** (el parche por debajo de la cara alta del
deck) y el telegraph **se seguía viendo entero** (`capturas/qa-30-enterrado.png`), porque los
calcos no ocluyen. Solo al devolver además `depthWrite = true` reapareció el síntoma exacto del
«antes»: el parche desaparece sobre el embarcadero y sobrevive sobre el empedrado
(`capturas/qa-31-enterrado-opaco.png`). Eso corrobora que la captura `telegraph-antes-04` es un
parche ENTERRADO y no un ataque sin cargar — que era la duda razonable que dejaba esa imagen.

No es una crítica: cinturón y tirantes está bien. Es que el candado vigila el tirante y el cinturón no
lo vigila nadie.

---

## 7. No probado (y por qué)

- **Atlas pintado / superficies IA** — gasta créditos. Hueco descrito en H7.
- **Enemigo real, delante y a la espalda, con destello en vivo** — no hay enemigos sin motor narrativo
  (hace falta `combat.weapon_id` en la entity; ninguna fixture lo trae y el fake-ai-server no lo sirve).
  Sustituido por cálculo con la proyección real y por el test de unidad.
- **Arma desnuda** — no es un estado alcanzable (H6).
- **Relieve pronunciado (`hill`)** — ninguna fixture lo declara. Verificado **por código** que el
  relieve se APLANA bajo todo rasgo de `ground` (`buildScatterExclusions(..., {areas:true})` en
  `fps-relief.ts:98`) y que el telegraph se drapea con ese mismo relieve, así que el margen de 2 cm se
  conserva punto a punto; pero no lo he visto en pantalla.
- **Parpadeo temporal (z-fighting) con la cámara en movimiento** — el navegador del bench va a ~7 fps y
  no permite juzgarlo. Argumento estructural en §1.
- **Mutación** — no repetí las corridas del ingeniero (el coordinador descartó la corrida completa).
  Sí verifiqué el resto de su §3: `npm test` **1348/1348**, `tsc --noEmit` y `eslint` del cliente
  limpios, y la suite entera de guiones con el mío dentro: **`node qa/run.mjs` → 22/22 en verde**.

---

## PARA EL USUARIO (decisiones que no son mías)

1. **Intensidad del contorno y del relleno.** El arreglo funciona: se entiende dónde acaba el golpe. La
   pregunta es de gusto, y la contestas tú mirando `capturas/telegraph-despues-04-puerto-sobre-el-embarcadero.png`
   y `capturas/qa-20-puerto-heavy.png`: el rojo va muy saturado y con halo, y el relleno tiñe el
   suelo lo bastante como para quitarle identidad de material (los tablones del embarcadero pasan a
   naranja). Si te sobra presencia, el plan ya dejó el dial: bajar `TELEGRAPH_FILL_MIN_A` (0.28) antes
   que tocar el contorno.
2. **El destello de impacto gris** (`capturas/qa-12-precise.png`) es una losa oscura de media
   pantalla. Es el comportamiento de antes con mejor silueta, así que no lo reporto como fallo — pero si
   te chirría, este es el momento.

---

## Veredicto

**APTO CON RESERVAS.**

Los dos issues se cierran de verdad: el jugador ve hasta dónde llega el golpe —en los cinco ataques y
también sobre un embarcadero—, la cota del parche se deriva del generador en vez de medirse, y el
candado existe y se pone rojo (lo puse cinco veces). Las reservas son **H1** (el candado tiene un
agujero por el que vuelve exactamente el bug que vigila, y su comentario promete cubrirlo), **H2** (el
único cambio de comportamiento visible sin candado) y **H7** (nada se ha visto con atlas pintado, que
es donde vive la pregunta de arte que queda). Ninguna es bloqueante ni pide revertir nada.
