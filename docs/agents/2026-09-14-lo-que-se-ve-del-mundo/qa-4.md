# QA · PR 4 de la tanda C — #451 «un snapshot con una escena injugable deja de tirarse entero»

Árbol `/home/al/code/ne-fan-qa-c4`, rama del ingeniero (`a7b2a2fb`, sobre `main@ace26a1a`).
Bloque de puertos +500, preset `e2e-sin-creditos`, motor falso. **Cero créditos**: el guardarraíl
declaró `fake:true` en cliente y bridge en las cuatro corridas, y el contador del fake cerró en
`gasto total 0,00 €`. Nada de otros agentes de la máquina se tocó (`--parar` clasificó seis
procesos ajenos y los dejó).

**Veredicto: APTO CON HALLAZGOS.** El criterio 5 de la petición original se cumple entero y lo he
visto cumplirse en el juego real, en los cinco estados que pedía el coordinador. Pero la mitad
«conservar» abre un estado nuevo que antes no existía —un mundo conservado contra un mapa que ya
no es el suyo— y lo abre **en silencio**, que es lo que la casa no permite. Y dos de las cuatro
cosas que el ingeniero declara sin medir son peores de lo que las declara.

---

## Criterios

La cita que manda es la del usuario: **«Se sirve la entrada y las 8 buenas, y solo se vuelve a
pedir el tile malo»**, más la corrección del coordinador: **si la injugable es la de entrada, se
degrada como hoy pero el anillo bueno no se pierde**.

| Criterio | | Evidencia |
|---|---|---|
| Un snapshot con un tile injugable **sirve la partida igual** (entrada + tiles buenos) | ✅ | Guion 120 aserto 2 (`/generate_scene 9 → 9`) y guion 127 **E0/E1/E2**: con 0, 2 y 8 tiles malos la partida arranca sin una sola llamada al motor |
| …y **solo** vuelve a pedir el malo | ✅ | Guion 127 **E1**: `pedir tile_-1_-1` = 1 llamada, `pedir tile_0_-1` = 1 llamada, `pedir tile_1_-1` (sano) = 0. Con DOS malos, no con uno |
| …en vez de sustituirlo por uno de una sola escena | ✅ | Guion 120 aserto 6 y guion 127 **E3**: tras el bootstrap vivo el fichero sigue con 9 escenas |
| Decisión (i): la ENTRADA injugable **se degrada como hoy** | ✅ | 120 aserto 5 y 127 **E3** (`/generate_scene N → N+1`, una llamada, la de la entrada); el título sí la marca «⟳ obsoleto» |
| …y **el anillo bueno no se pierde** | ✅ | 120 aserto 6 (las ocho byte a byte) y 127 **E5(a)**: los lugares del mapa escrito coinciden con los de antes |
| **Estado: ninguna mala** (control negativo en el juego) | ✅ | 127 **E0**: 0 llamadas al motor y **0 líneas «se CRIBA»**. Sin este control, un `cribadas.push` incondicional saldría verde en todo lo demás |
| **Estado: dos del anillo malas** | ✅ | 127 **E1**: se criban LAS DOS (el set de ids cribados es exactamente el de las rotas), no la primera que falla |
| **Estado: todas (8) las del anillo malas** | ✅ *con reserva H‑2* | 127 **E2**: la partida arranca sin motor, se criban las ocho, al cliente se le sirve `["tile_0_0"]` y solo eso |
| **Estado: anillo entero bueno + entrada mala** | ✅ | 120 caso B; 127 **E5(a)** |
| **Estado: entrada mala Y una del anillo mala** (el mixto, que no está en el 120) | ⚠️ *cumple, con deuda — H‑5* | 127 **E3**: cura la entrada, conserva la mala del anillo **tal cual**, y la carga siguiente la vuelve a cribar |
| «El tile cribado no se cura en disco» — qué ve el jugador la 2.ª y la 3.ª vez | ❌ *peor de lo declarado — H‑3* | 127 **E4**: `[1,1,1]` llamadas al motor en tres partidas nuevas seguidas; el fichero nunca se toca. REANUDAR sí es gratis |
| El `world_map` del merge: ¿puede el jugador llegar a un lugar que el mapa ya no nombra? | ❌ **sí, y nadie lo dice — H‑1** | 127 **E5(b)**: el snapshot escrito queda con **8 escenas** cuyo `place_id` no está en su propio `world_map`, y **0 líneas** en el log del bridge |
| El coste real en créditos | ⚠️ no probado | Motor falso por mandato; lo que se mide es el número de llamadas, no el euro |
| El mundo con un anillo cribado **se ve** como uno sano | ✅ | Capturas (crítica visual abajo): desde el tile de entrada no hay ni un hueco ni una costura que delate los ocho que faltan |

### Lo que el ingeniero declaró y he podido confirmar tal cual

- **No se abre camino de regeneración parcial de la entrada**: cierto, una llamada y solo una.
- **`world-snapshot.test.ts:446` y `:499` verdes sin tocarlos**: cierto. `npm test` en mi árbol:
  `tests 2598 · pass 2598 · fail 0`, el número exacto que declara.
- **La criba no afloja #302**: cierto — lo que se sirve sigue pasando `validateScene`, y el tile
  cribado no se registra en la sesión (`start_session` con el anillo cribado).
- **`get_world_snapshot` sigue contestando `ok:true`/`ready` con las escenas cribadas**: cierto, y
  lo declara. Consecuencia en créditos en H‑6.

---

## Hallazgos

### H‑1 · IMPORTANTE — el mundo conservado puede quedar apuntando a un mapa que ya no es el suyo, y no lo dice nadie

**Qué pasa.** Cuando la entrada es injugable, `writeSessionSnapshot` funde las 8 escenas del
fichero con el `world_map` **de la sesión viva** (`bridge/context.ts:188`), que el bootstrap acaba
de sembrar de cero (`bootstrap-tile.ts:35`, `llmCtx.bootstrap_world_map = true`). Las 8 escenas
conservadas llevan el `place_id` que les puso la generación ANTERIOR. Nada comprueba que esos
lugares existan en el mapa nuevo, y nada lo dice.

**Medido** (guion 127, bloque E5, corrida `2026-09-14T08-54-45-938Z-206707`):

```
E5 · escenas conservadas cuyo place_id no está en el mapa escrito:
     ["tile_-1_-1","tile_0_-1","tile_1_-1","tile_-1_0","tile_1_0","tile_-1_1","tile_0_1","tile_1_1"]
✘ E5 · una escena conservada que apunta a un lugar que el mapa no nombra se DICE (fail-loud),
       no se guarda en silencio — 8 escena(s) colgando y 0 líneas en el log del bridge
```

**Qué le pasa al jugador**, leído del código (esto NO lo he ejercido en pantalla, ver «No probado»):
`placeDeLaEscena` devuelve ese `place_id` porque la escena lo declara (`src/world-map/exits.ts:57`)
→ `salidasDePlace` pide `getOutgoingLinks` de un lugar que no existe → `[]`
(`src/world-map/world-map.ts:243`) → **el panel «Salidas» de esos ocho tiles sale vacío**, que es
justo lo que `src/world-map/bootstrap-place.ts:15-18` describe como el defecto de #172: *«sin
place_id el panel Salidas se apaga SIN UN SOLO AVISO y con él la única vía de viaje del cliente»*.
Y `recordSceneLoaded` se salta `attachRealizedScene` con un `if (this.worldMap.get(placeId))` mudo
(`src/narrative/narrative-state.ts:744-748`), así que esos tiles tampoco quedan atados a ningún
lugar del mapa.

**Por qué el verde del ingeniero no lo veía.** Con el motor falso los ids del mapa COINCIDEN entre
la pre-generación y el bootstrap vivo — lo medí: `E5 · lugares antes [molino_bench_place,
taberna_bench_place, world] · después [lo mismo]`, aserto verde. Con un motor real, el bootstrap es
otra llamada al LLM y siembra los lugares que le parece: la coincidencia de ids es la excepción, no
la regla. Para verlo he **fabricado** la divergencia (ver «Workarounds», W‑2): es la simulación de
un estado que el juego real produce solo, no un estado de laboratorio.

**Por qué es más grave de lo que dice el informe.** `implementacion-4.md:140-145` lo despacha con
«Estructuralmente no rompe nada (un tile del anillo no necesita un place para servirse: el guion 120
lo pide y lo pinta)». Servirse y pintarse no es la cuestión: la cuestión es que la única vía de
viaje del cliente se apaga, y que **el arreglo mínimo —decirlo— ni siquiera está**. CLAUDE.md no
deja elegir aquí: «nunca `return null` silencioso», y `writeSessionSnapshot` es exactamente el sitio
donde se conoce la causa.

**Reproducción desde el arranque:** `node qa/run.mjs 127` → bloque E5(b). Lo que esperaba el
jugador: que un mundo que el juego decide conservar sea un mundo que el juego sepa nombrar; y si no
lo sabe, que lo diga en el log como dice todo lo demás.

### H‑2 · IMPORTANTE — el título dice «✓ generado» de un mundo del que solo se puede servir la entrada

**Medido** (guion 127, E2): con las OCHO del anillo injugables, el título lee
`Mundo: ✓ generado · Estilo Acuarela luminosa: — sin aplicar`, la partida arranca sin motor y al
cliente se le sirve `["tile_0_0"]` y nada más.

**Por qué importa, y por qué no es «la opción (c) por la puerta de atrás».** El usuario descartó
(c) —«se queda (a), pero el título dice el motivo»— para el caso en que el mundo se TIRA. Este es
otro caso, y es nuevo: hasta esta PR ese mismo fichero leía «⟳ obsoleto (regenera el mundo)» y el
jugador sabía a qué atenerse. Ahora lee «generado». Y no es un caso raro: la premisa del propio
issue es que *«`scene-validate` se endureció cinco veces en dos semanas y cada endurecimiento deja
injugable TODO snapshot en disco»* (`critica.md:18`) — un endurecimiento invalida tiles **por
clase**, no de uno en uno, así que «casi todo el anillo cribado» es el caso ESPERABLE.

**Lo que el jugador paga sin que se lo digan**: en `play` cada uno de esos ocho tiles se regenera
con el motor real cuando llega a él. El issue existía porque «el coste no es un tile malo, es
regenerar el mundo con el motor real»; con (b) tal como está ese coste no desaparece, se **aplaza y
se hace invisible**. Un recuento en el chip («✓ generado · 1 de 9 escenas servibles») costaría poco
y no es la opción (c): no explica el motivo, cuenta lo que hay.

### H‑3 · IMPORTANTE — el tile cribado se paga en CADA partida nueva, para siempre

`implementacion-4.md:162-165` dice «no se cura en disco **hasta que alguien lo regenere y escriba**».
Lo que no dice es que en el flujo normal **ese alguien no existe**: los únicos dos llamantes de
`writeSessionSnapshot` son el bootstrap vivo y `generate_game` (grep a dos resultados), y ninguno de
los dos corre cuando el snapshot se sirve bien. Así que para un tile del ANILLO la cura no llega
nunca, salvo regenerando el mundo entero — que es lo que el issue venía a evitar.

**Medido** (guion 127, E4), tres partidas nuevas seguidas sobre el mismo mundo:

```
E4 · llegar a tile_-1_-1 cuesta, partida tras partida: [1,1,1] llamadas
✔ E4 · el fichero sigue teniendo el tile roto tras las tres partidas
✔ E4 · REANUDAR una partida que ya lo generó no vuelve a pagarlo (el save sí lo guarda)
```

**Qué ve el jugador la segunda y la tercera vez**: exactamente lo mismo que la primera — el título
dice «✓ generado», la partida entra sin esperar, y al llegar a ese tile se genera otra vez. No hay
nada roto a la vista; lo que hay es una factura recurrente que nadie enseña. La buena noticia, y la
mido: **Continuar es gratis**, porque el tile regenerado vive en el save de esa partida.

Cumple la letra de (b). Lo señalo porque el informe lo declara como un coste «que ya costaba», y no
es el mismo: antes el mundo se regeneraba una vez y quedaba sano; ahora queda enfermo de por vida.

### H‑4 · MENOR — el aviso de criba se multiplica por dos cargas y por escena

Medido: 2 escenas malas ⇒ **4** líneas «se CRIBA» por partida; 8 malas ⇒ **16**. La puerta de carga
se atraviesa dos veces (el chip del título por `gameGenerationStatus`, y `start_session`), y ahora
cada travesía emite una línea POR ESCENA en vez de un único `throw`. Con un mundo mayoritariamente
cribado, el log del bridge se llena de repeticiones idénticas cada vez que alguien abre el título.
Es ruido, no un fallo — pero el aserto que lo mide está en el guion 127 (E1) para que se entere
quien lo empeore.

### H‑5 · MENOR — la cura de la entrada reescribe el fichero con el tile del anillo roto dentro

Medido (127, E3): con entrada mala **y** un vecino malo, el bootstrap vivo escribe las 9 escenas y
la del anillo vuelve al disco **idéntica a como estaba, rota**. Es coherente con el diseño
(`escenasQueSobreviven` no filtra por jugabilidad a propósito, y está escrito), pero la consecuencia
no está declarada: el fichero nunca se limpia, el aviso de criba es permanente y H‑3 se hereda.

### H‑6 · MENOR — el batch de estilo da por completo un mundo cribado

`handleGetWorldSnapshot` (`style-apply.ts:32`) devuelve el snapshot ya cribado con `ok:true` /
`ready`. El batch de estilo —que **gasta créditos de verdad**— computa celdas y roster sobre 8
escenas y da el mundo por pintado; el 9.º tile, cuando el motor lo regenere en partida, no tiene
superficies pre-pintadas y se pagan en caliente. El ingeniero lo declara (`implementacion-4.md:156-159`)
y el coordinador dejó ese menor fuera; lo apunto solo por el lado del gasto, que es de mi mesa.

---

## El guion 120, y el sabotaje que su autor no probó

**Corrido tal cual**: verde, 15 asertos, `1 en verde · 0 en rojo`
(`/tmp/.../guion120-base.log`, capturas en `qa/capturas/2026-09-14T08-41-26-743Z-163030/`).

**Sabotaje mío** (uno que no está en su lista): copié el guion cambiando **una línea de su propio
montaje** para que el tile del anillo se «rompa» sin romperse — se le añade igualmente el NPC nuevo,
pero la celda sigue siendo transitable. O sea: el fichero se toca, el tile sigue siendo jugable.
Si los verdes del caso A vinieran de «alguien reescribió el snapshot» y no de la criba, seguirían
verdes. Resultado:

```
✘ 2. el bridge dice POR QUÉ criba: la escena y el NPC, no un silencio — (sin línea «se CRIBA»…)
✘ 3. …y el cribado se vuelve a pedir: exactamente una llamada, la suya — /generate_scene 9 → 9
```

Los dos asertos que sostienen el caso A se ponen rojos, y **solo esos dos**: el guion mide la criba,
no el hecho de haber tocado el fichero. Bien.

**Lo que sí queda flojo del 120, y por eso existe el 127**: sus dos casos son de cardinalidad uno.
Con un único tile malo, «se criba el primero que falla» y «se criban todos los que fallan» dan el
mismo verde; y el aserto «el título sigue diciendo ✓ generado» salió verde también en mi sabotaje,
donde no había nada malo — o sea, ese aserto solo, no discrimina nada.

**El sabotaje de código que NO pude aplicar**: quería invertir el orden del merge en
`bridge/context.ts:182` (`{...vivas, ...conservadas}`), que es la mutación más interesante y no está
en la lista del ingeniero. El sistema de permisos me deniega escribir en `nefan-core/` (coherente
con mi papel: no arreglo nada, y no lo he rodeado). Queda **declarado como no probado**. Analizado
sobre el código, lo cazan dos asertos independientes: el 6 del 120 («la entrada es la RECIÉN
generada: su NPC ya no nace en la celda sólida» — bajo la inversión ganaría la entrada injugable del
disco y el NPC seguiría en la celda sólida) y, por el otro lado, el de mi 127 E3 («la partida
siguiente ya arranca sin motor: la entrada se curó»). Si alguien puede correrlo, que lo corra; yo
no lo firmo como medido.

---

## Crítica visual

Capturas: `qa/capturas/2026-09-14T08-41-26-743Z-163030/120-…-01-partida-con-el-anillo-cribado.png`
y `qa/capturas/2026-09-14T08-54-45-938Z-206707/127-…-01-e2-solo-la-entrada-sobrevive.png`
(esta última es el caso extremo: 8 de 9 escenas cribadas).

**Lo que importa para #451, y está bien**: las dos capturas son indistinguibles de una partida sana.
No hay hueco, ni borde negro, ni costura, ni un tile a medio pintar donde faltan los vecinos: el
mundo se corta en el horizonte como se corta siempre, porque los tiles del anillo no se pintan hasta
que el jugador se acerca. El panel «Salidas» ofrece «→ Molino del bench (road)» igual que en un
mundo completo y el HUD está entero. La promesa «la partida no se entera de que faltaba un tile»
se cumple **a la vista**, no solo en los contadores. Eso es también, exactamente, lo que hace
necesario H‑2: si nada en pantalla lo delata, el único sitio donde el jugador podría enterarse es el
chip del título, y el chip dice «generado».

**Como director de arte**, sobre lo que hay en frame (es el modelo de superficies falso, así que
esto no juzga el arte de producción, juzga la composición greybox que sí es del juego):

- **No hay jerarquía de materiales.** El damero se aplica igual al suelo, a la fachada, al marco de
  la puerta, al barril y al techo. La escala solo se lee contando cuadros: el barril y el campo
  están hechos «de lo mismo». En la captura del 120 —con el atlas a medio generar— el mismo plano
  sale salmón plano, y entonces la escena pierde incluso esa referencia.
- **Los dos paneles azules de la fachada no están integrados.** Flotan simétricos a la altura del
  ojo, sin marco, sin alféizar y sin una sombra que los pegue al muro: leen como calcomanías, no
  como ventanas. Es el defecto clásico de «assets aislados que no componen escena».
- **El plano superior no tiene apoyo visible.** Ocupa el tercio alto y, contra la banda de cielo,
  se lee como un techo suspendido sobre todo el horizonte en vez de como el tejado del edificio en
  el que estás. Es la silueta más débil del encuadre y es lo primero que mira el ojo.
- **La luz es única y coherente** (el interior del vano se oscurece como debe), pero **no hay sombra
  de contacto** en ningún sitio: el barril no se apoya, levita un poco.
- **El registro de DEV, abajo a la izquierda, es ilegible**: texto oliva sobre el verde del suelo.
  Es DEV y no es de esta PR, pero es la única superficie de la pantalla donde algo podría contarle a
  un humano lo que acaba de pasar con el mundo, y no se lee.

---

## Workarounds usados

| | Qué hice | Veredicto |
|---|---|---|
| **W‑1** | Romper un tile a mano en `world/tile.json` (celda de agua fabricada + NPC encima; NPC de la entrada movido a la huella de un sólido) | **No es un hallazgo.** Es la única forma de fabricar «generado bajo un validador anterior» sin un checkout viejo, y es la misma técnica del 120 y del 72. El jugador llega a ese estado solo, por el paso del tiempo |
| **W‑2** | Fabricar la divergencia del mapa poniendo `place_id: "lugar_que_ya_no_existe"` en los ocho tiles del anillo antes del caso de entrada rota (E5b) | **No es un hallazgo, es la simulación de uno.** Con el motor falso los ids del mapa coinciden entre pre-generación y bootstrap (medido en E5a), así que la divergencia que produce cualquier motor real no puede aparecer sola en el banco. Lo declaro como fabricado y el hallazgo H‑1 se lee con esa etiqueta |
| **W‑3** | Pedir los tiles por `request_tile` desde un segundo socket, en vez de caminar hasta la costura | **No es un hallazgo** para lo que mido (el coste en llamadas es el mismo mensaje que manda el cliente al llegar al borde), pero **sí deja sin medir** lo que ve el jugador al cruzar a pie hacia un tile cribado (la propuesta Y/N de la frontera). Declarado abajo |
| **W‑4** | Quise sabotear `bridge/context.ts` para el negativo del orden del merge y el permiso lo denegó | **Es una limitación de la prueba, no del producto.** No lo he rodeado. Queda como no probado |

---

## No probado

- **El gasto real en créditos.** Mandato de cero créditos: todo va contra el motor falso. Lo que
  mido es el número de llamadas a `/generate_scene`, no el euro.
- **El caso con el motor narrativo REAL**, que es precisamente donde vive H‑1: con el falso, los
  `place_id` del mapa coinciden entre generaciones y la divergencia no se da sola.
- **Cruzar a pie la costura hacia un tile cribado** (la propuesta de explorar, la espera, lo que se
  ve mientras se genera). Los tiles se pidieron por el cable.
- **El panel «Salidas» de un tile conservado con `place_id` colgando.** El defecto está medido en el
  FICHERO y razonado sobre el código; no lo he visto vacío en pantalla, porque para eso hay que
  caminar hasta uno de los ocho.
- **El sabotaje del orden del merge** (W‑4).
- **La mutación de `world-map`**, que el ingeniero pide y no espera. No la he corrido.
- **Tandas A, B y las PR 1–3 de C**: esta validación es de la PR 4 sobre su rama, no del conjunto.

---

## Entregables

- `qa/guiones/127-el-anillo-cribado-en-todos-sus-estados.mjs` — los seis estados; 24 asertos en la
  corrida (más los dos que trae `regenerarMundo`). **Nace ROJO en un solo aserto, E5(b), a
  propósito**: es H‑1 hecho ejecutable. Todos los demás están verdes. Probado en negativo por construcción (E0 es el control que apaga los demás si la
  criba fuera incondicional) y contra el montaje (el sabotaje del 120 arriba).
- Fila del 127 en `qa/README.md`.
- Sin tocar ni una línea de producción: `git status` de mi árbol solo enseña estos dos ficheros y
  este informe.
