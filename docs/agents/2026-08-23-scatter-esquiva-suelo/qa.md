# QA — el scatter derivado esquiva caminos y ríos (#174)

Rama `fix/scatter-esquiva-suelo` · commit `c53e6d4` · PR #242.
Validado el 2026-08-23 sin gastar un crédito (`e2e-sin-creditos` y `html-fixtures`).

## Criterios

| Criterio (de la petición y de `requisitos.md`) | Estado | Evidencia |
|---|---|---|
| El jugador **recorre el camino real** de `robledo_tile` sin quedarse clavado | ✅ cumple | `node qa/run.mjs 16` (stack arrancado de cero, 4 corridas): `eje del camino (fila 63.5): 0/249 muestras bloqueadas` · `avanzó 16.0 / 16.3 / 16.4 / 16.5 m por la calzada`. En negativo (sin la exclusión): `12/249` y `timeout: se queda contra el tronco` |
| La exclusión **aparta, no vacía** | ✅ cumple | Caso de referencia del issue reproducido por mi cuenta: `robledo_tile` + `{pino, rest, 0.5}` → **48** volúmenes `derived_veg_*` **antes y después** (los «56 tree/bush» del informe incluyen los 8 árboles declarados como entity); en banda del `camino_real` **3 → 0** (`[[94.7,62.9],[69.8,63.1],[118,61.2]] → []`); en el río **4 → 0**. En el juego: `arcenes del pinar: 20/172 muestras ocupadas` |
| La exclusión **NO** toca los derivados de `structures` ni de `entities` | ✅ cumple | Los 23 volúmenes no-vegetales salen **byte a byte idénticos** con y sin `ground`. Y con `structures`/`entities` puestas a propósito SOBRE el camino y SOBRE el agua, las dos sobreviven: `["derived_ent_prop_en_camino","derived_ent_arbol_en_agua"]`. Ahora además tiene candado: paso 5 nuevo del guion 16 (el `pozo` de la fixture está declarado a caballo de `camino_plaza` y `camino_herreria`) |
| El río declarado como `ground` **se pinta** | ✅ cumple | `qa/capturas/174-qa-04-rio-desde-el-puente.png` y `…-02-rio-y-puente-sin-arboles.png`: banda de agua + puente. Antes NO se pintaba (la vista 3D no pinta el `terrain_grid`, y el río era `terrain_patches`): era un muro invisible. Mejora real, no pedida por el issue |
| …y **el grid sale igual que antes** | ⚠️ matizado | No es idéntico: **40 celdas cambian, todas `_`→`b`** (el cruce del puente ya no lo borra el camino). Agua 960→960, hierba 14600→14600, `solid_chars` `["W","w"]` en ambos, ninguno de los dos chars es sólido → la colisión **de terreno** no se mueve. Lo que **sí** se mueve es la colisión del **plan** (fila siguiente) |
| El guion `16-scatter-esquiva-el-suelo.mjs` **se pone rojo** de verdad | ✅ cumple | Tres negativos míos, cada uno con stack limpio: (1) sin `if (onGround…)` → `12/249` bloqueadas + timeout del paseo; (2) exclusión que **vacía** la zona → `arcenes 0/172`, rojo; (3) fixture sin `vegetation_zones` → rojo en «la fixture declara una zona». **No puede pasar verde por llegar tarde**: los `waitFor` lanzan al vencer y el runner lo cuenta como fatal (`run.mjs:437-441`); **ni por no encontrar nada**: los negativos 2 y 3 lo demuestran |
| No hay regresión en el resto del juego | ❌ **NO cumple** | `node qa/run.mjs` (batería entera): **14/15**. `06-solidos-de-la-leyenda` en rojo — ver hallazgo 1 |
| Deuda y umbrales no empeoran | ✅ cumple | `npm run mutate -- blueprint-derive` → 63.5 % (break 59), y **cero supervivientes** en la línea `if (onGround(u, v)) continue;` (los 35 vivos de la función están en líneas que el diff mueve sin tocar). `npm run mutate -- blueprint-suelo` → 65.67 % (break 65). CI de la PR: 4/4 verde |
| El toque a `mutation-targets.json` | ⚠️ correcto en la forma, falso en el motivo | Ver hallazgo 4 |
| Sesión real con motor y créditos (`play`) | ⚠️ no probado | Ver «No probado» |

## Hallazgos

### 1 · BLOQUEANTE — declarar el río como `ground` anula en silencio el `solid:false` de la leyenda, y deja la batería en rojo

`06-solidos-de-la-leyenda` pasa de verde a rojo con esta rama:

```
✘ con el agua declarada vadeable, el jugador SÍ cruza por la fila 70 — x 8.3 → 9.6 (meta 15.3)
```

**Causa aislada** (no es el arreglo del issue, es el cambio de fixture del §6 del plan). Con el
código nuevo y la fixture **vieja**, el guion 06 vuelve a estar **verde, 1/1**. Con la fixture nueva,
rojo. Analíticamente: `planCollisionGrid` marca sólida el agua de `ground` con independencia de
`solid_chars` —celdas sólidas del plan **609 → 1592**, fila 90 cols 84-91 `"gggggggg"` →
`"SSSSSSSS"`— y el collider del plan se une al del terreno (`CollisionSystem.tileBlocks`).

Lo que esto significa para quien juega, más allá del guion: **el autor de una escena puede declarar
un vado (`terrain_legend.w = {name, solid:false}`) y el jugador seguirá rebotando** si esa misma agua
está declarada como rasgo `ground`. Dos fuentes de colisión que se contradicen, y gana la que el
autor no escribió. El mismo `planCollisionGrid` lo usa `bridge/sim-collision.ts`, así que también
afecta a los NPCs.

Reproducción desde el arranque:
1. `node qa/run.mjs 06` (levanta `e2e-sin-creditos`), o a mano: `./start.sh --preset html-fixtures`,
   selector Room → `robledo_tile`, y caminar hacia el este por una fila del río que no sea el puente
   con el agua declarada vadeable.
2. Esperado por el jugador/autor: cruza. Observado: rebota.

**El CI no lo ve**: `.github/workflows/ci.yml` no corre `qa/run.mjs`, y la verificación del ingeniero
fue `node qa/run.mjs 16`, no la batería. La contradicción entre las dos colisiones es preexistente;
lo que la vuelve observable —y rompe un guion que llevaba verde— es este cambio de fixture, que **el
issue no pedía**.

### 2 · IMPORTANTE — la zona de vegetación mete en la fixture 131 árboles que se ven y no colisionan

Al declarar `vegetation_zones` en `robledo_tile` se activa **la otra ruta**, la del grid
(`scene-expand.ts`), que estampa una entity `tree` 1×1 por celda elegida. Medido en el juego:

- `robledo_tile` pasa de **24 a 155** objetos (`prop` 15 → 146). 131 son `pino_z0_*`, cajas de
  `0,5 × 4 × 0,5 m`.
- **Colisión: 4 de 40** muestreados bloquean (y esos cuatro por solaparse con un árbol del
  blueprint), frente a **8 de 8** de los del blueprint.

Es decir: el jugador ve un pinar denso de troncos pelados y **lo atraviesa**. Capturas mías:
`qa/capturas/174-qa-01-pinar-desde-el-este.png`, `174-qa-02-camino-cruzando-el-pinar.png`,
`174-qa-03-dentro-del-pinar.png`.

Conducta preexistente de la ruta B, sí — pero hasta ahora **ninguna fixture la ejercía**, y ahora es
lo primero que ve quien abre `html-fixtures`. Efecto de segundo orden: el paso 4 del guion («el pinar
sigue plantado») mide **colisión**, o sea 8 árboles, mientras que lo que hay en pantalla son ~139: el
candado protege una décima parte de lo que la captura enseña.

### 3 · IMPORTANTE — una de las aserciones del test de la fixture es vacía y nunca podrá ponerse roja

En `test/derive-vegetation.test.ts`, «la fixture robledo_tile: el pinar flanquea el camino real y no
lo pisa»:

```js
assert.deepEqual(derived.filter((v) => at(v)[0] >= 84 && at(v)[0] <= 92).map(at), [], "río libre");
```

La zona declarada es `[2, 50, 46, 26]`, y el bucle sortea `u ∈ [area[0]+2, area[0]+area[2]-2]` =
**[4, 46]**. Medido: rango real del pinar **u 4.0 → 39.6**. El río está en las columnas 84-92: esa
línea **no puede fallar jamás**, ni con la exclusión desactivada. La otra mitad (la del camino) sí
muerde: 3 sobre la calzada sin exclusión → 0 con ella. Es el patrón «verde que no comprueba nada»:
o se mueve la zona para que cruce el río, o se borra la línea diciendo qué cobertura no da.
(La cobertura del agua **sí** existe, pero está en el test 1, con `ground` sintético.)

### 4 · MENOR — el motivo escrito en `mutation-targets.json` describe un efecto que no ocurre

La desviación que el ingeniero pidió mirar. **La declaración es correcta y no esconde trampa**: el
candado `mutation-config.test.ts` exige que un test que importe un fichero mutado esté en la batería
de ese módulo, y meterlo en `excluidos` habría sido mentira. Añadir tests a una batería sólo puede
matar MÁS mutantes, nunca bajar el score, así que no hay forma de maquillar nada por ahí.

Lo que **no** se sostiene es la frase del `porque`: «un mutante que rompa el parseo lo mata su
`assert.ok(p.ok)`». Medido:

```
npm run mutate -- blueprint-suelo → 501 mutantes · 172 vivos · score 65.7 % (break 65) · 174s
```

Idéntico al 65,7 % de la línea base registrada en ese mismo `porque`, **medida sin este test**: cero
mutantes nuevos muertos, mientras la batería paga el fichero una vez por mutante. No es un fallo —
es una frase que promete más de lo que hace. Sugerencia: escribir el número medido.

De paso: el `break: 65` sigue siendo el suelo de la medida vieja. Lo he vuelto a medir yo y no se
mueve, así que no está obsoleto; pero nadie lo había comprobado.

### 5 · MENOR — `npm run afectado` pedía los 17 módulos y se corrió 1 (yo he corrido 2)

El tool dice **EJECUTA LOS 17 MÓDULOS**, y entre sus motivos está `data/scenes/robledo_tile.json`
(«dato del paquete: los tests lo leen en runtime»). El ingeniero corrió sólo `blueprint-derive`,
razonando que es el único cuyo código mutado cambia. El razonamiento es bueno para el CÓDIGO, pero la
fixture cambió mucho y la leen ocho ficheros de test. He corrido además `blueprint-suelo` (65,7 %,
dentro). Los 15 restantes quedan a la nocturna; lo digo porque «ante la duda ejecuta de más» era la
regla.

### 6 · MENOR — «el grid sale igual» no es literal

40 celdas cambian (`_`→`b`): el cruce del puente, que antes borraba el camino al rasterizarse
después. Ninguno de los dos chars es sólido y los histogramas de agua y hierba no se mueven, así que
la colisión de terreno es la misma. El detalle está bien contado en `implementacion.md`; lo que
engaña es el titular. Y sí se mueve, mucho, la colisión del **plan** (hallazgo 1), que ese párrafo no
menciona.

### 7 · MENOR — la evidencia visual va tapada por el panel de errores

En `html-fixtures` el panel `error-log` ocupa el tercio derecho de todas las capturas y el muro «No
se pudo arrancar la partida» aparece **5 s después** de cargar la fixture, encima del juego. El par
`174-antes/despues` del ingeniero está parcialmente tapado por él. Es preexistente (el preset no
tiene bridge a propósito), pero convierte cualquier captura de `html-fixtures` en media captura.
El guion lo cierra por su botón, que es lo correcto.

## Lo que he añadido al guion

`qa/guiones/16-scatter-esquiva-el-suelo.mjs`, **paso 5** (59 líneas): el criterio «la exclusión NO
toca `structures` ni `entities`» no tenía candado ejecutable ni en el guion ni en la unidad. La
fixture trae el caso perfecto: `pozo` está declarado a mano en la celda `[62,80]`, **a caballo de
`camino_plaza` y `camino_herreria`**. El paso afirma tres cosas: que sigue en la escena, que sigue
siendo SÓLIDO, y —para que no envejezca en vacío— que de verdad está encima de un camino declarado.

Probado en los dos sentidos, con stack arrancado de cero:

```
verde:  pozo declarado a mano: presente · sobre ["camino_plaza","camino_herreria"]
        ✔ …y sigue siendo sólido (la exclusión no se comió su volumen)

rojo (fugando la exclusión al bucle de entities, que es justo lo prohibido):
        ✔ el pozo que el motor puso a mano sobre el camino sigue en la escena
        ✘ …y sigue siendo sólido — {"hay":true,"choca":false}
```

Ese rojo enseña además POR QUÉ hacía falta: la pérdida es **silenciosa**. El objeto sigue en la lista
de la escena y el camino sale aún más despejado, así que los pasos 2 y 3 seguirían verdes; lo único
que desaparece es el volumen con el que el jugador se topa.

`node --import tsx --test test/architecture.test.ts` → 33/33 (el guion no nombra campos retirados).

**Lo que sigue sin candado y no he podido añadir**: que el río se PINTE (un guion no lee píxeles, y
no hay estado que lo afirme sin bajar al renderer) y que los 131 árboles de la ruta B se vean o no
se vean — eso es juicio, y está en el hallazgo 2.

## Workarounds usados

| Workaround | Veredicto |
|---|---|
| Respaldé `qa/capturas/` antes de correr nada: `qa/run.mjs` borra la carpeta al arrancar | No afecta al jugador. Sí a quien lea la evidencia: `qa/capturas/` está en `.gitignore:63`, así que el par `174-antes/despues` **no está versionado** y muere en la siguiente corrida de la batería. Lo he restaurado en su sitio, pero es evidencia con fecha de caducidad |
| Rompí `derive.ts` a mano cuatro veces (exclusión fuera, exclusión que vacía, fuga a `entities`) y la fixture una | Es el método, no un apaño: cada rotura se restauró con `git checkout` y el árbol quedó limpio (`git diff HEAD --stat` = sólo mi guion) |
| Para la crítica visual usé un script propio de Playwright con `setPlayerPos`/`setYaw` | La misma API de bench que usan los guiones. No oculté ningún overlay: el muro de error se cerró por su botón |
| Reutilicé el stack con `--keep` tras restaurar un fichero de `nefan-core` | **Dio un ROJO FALSO** (el dev server seguía sirviendo el módulo roto). Gotcha para quien venga: tras tocar fuentes, stack de cero. Todas las conclusiones de este informe se tomaron arrancando limpio |

## No probado

- **Sesión real con motor narrativo y créditos** (`play`, `story-web-sin-imagenes`). Sí se ejerció la
  sesión con **bridge y motor falso**, que no es poco: el fake-ai emite `vegetation_zones` **y**
  `ground` con caminos y agua (`labs/narrative/fake-ai-server.mjs:229,286-313,328`), así que la ruta
  arreglada corre también sobre tiles generados en vivo — batería completa, 14/15.
- **El batch de estilo** (`style-apply.ts`) con `ground`: ni test ni guion. Sólo verificado por
  lectura que compone con el mismo `ground` parseado y el mismo derive que la partida.
- **La crítica visual con estilo aplicado**: `html-fixtures` no pide atlas, todo es clay. Un pinar con
  textura podría leerse distinto (mejor o peor) que el hallazgo 2.
- Los **15 módulos de mutación** restantes que `npm run afectado` pedía.
- **Coste en créditos: cero** en todo este informe, por construcción.

## Crítica visual

El arreglo **se lee de un vistazo y es el correcto**: en `174-qa-02-camino-cruzando-el-pinar.png` la
calzada sale limpia de punta a punta, con la vegetación abriéndose a los lados en vez de plantada
encima; comparada con `174-antes-01`, donde el jugador tiene un tronco a un palmo de la cara y no ve
el pueblo, la diferencia es de bug a juego. Y el río pintado (`174-qa-04`) cambia la escena entera:
antes era hierba con un muro invisible, ahora hay una lámina de agua y un puente que se lee como
puente —plano, ancho, cruzando— aunque en clay parezca más una rampa de tierra que tablones.

Lo que **no** compone es el pinar. La fixture no ha ganado una zona de vegetación: ha ganado una
**empalizada**. Desde el este (`174-qa-01`) el camino queda flanqueado por dos hileras de cilindros
marrones idénticos, del mismo grosor, casi a tocarse, sin copa; desde dentro (`174-qa-03`) es un
bosque de columnas peladas con la mirilla marcando «pino» sobre lo que parece un poste. Conviven dos
especies que no se parecen: ocho árboles del blueprint, con copa, sombra y volumen, y 131 postes de
la ruta B, sin copa, que además se atraviesan. La densidad no es creíble para «pinar ralo» —ni la
descripción que se le añadió a la escena lo sostiene— y el desajuste entre lo que se ve y lo que
frena es peor que el bug que veníamos a arreglar: allí un árbol invisible te paraba; aquí un bosque
visible te deja pasar. La densidad 0,15 está bien elegida para el blueprint (8 árboles) y mal para el
grid (131): son dos diales, y sólo se giró uno.

## Veredicto

**NO APTO.** El arreglo del issue #174 en sí es correcto, está medido y ahora está candado por los
dos lados (unidad + guion, ambos probados en negativo); si viniera solo, sería apto sin reservas. Lo
que no se puede mergear es la **fixture** tal como quedó: deja `qa/run.mjs` en 14/15, anula en
silencio el `solid:false` de la leyenda —contrato vivo del que depende que un autor pueda declarar un
vado— y planta en la única escena jugable del repo un pinar de 131 troncos atravesables. Vuelve al
ingeniero con los hallazgos 1, 2 y 3.
