# QA · PR 1 de la tanda B — #532, «el motor ya puede decir que una bolsa de monedas se pisa»

Árbol `/home/al/code/ne-fan-qa-b1` (desprendido sobre `4ee43897`), bloque de puertos **+700**,
preset `e2e-sin-creditos`, **cero créditos** (el guardarraíl del runner confirmó `fake:true` en
cliente y bridge en las cinco corridas; `gasto sesión 0,00 €` en todas las capturas). Nada de
producción tocado: el árbol acaba con `qa/README.md` modificado y `qa/guiones/119-…mjs` nuevo, que
son mi entrega.

---

## Criterios → veredicto

La cita literal del usuario es **«- R: c»** = `footprint` opcional **y** `kind: "item"`, y la
corrección del coordinador fija la mitad viva: **«Ningún spawn deja de ser sólido por omitir un
campo.»** Eso es lo que se juzga aquí, no el plan.

| # | Criterio (de la petición, no del plan) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | El motor spawnea **una bolsa de monedas y se puede pasar por encima** | ✅ cumple | Guion 119 (mío), corrida `…09-45-32`: `en vivo, la bolsa mide 1×1 m — los [2,2] celdas que DECLARÓ el motor` · `la bolsa entra como \`item\`` · `el jugador ANDA hasta ponerse ENCIMA de la bolsa`. Guion 118 (del ingeniero), reproducido por mí en +700: `donde no había nada, la bolsa NO bloquea` |
| 2 | …**spawnea un carro y no** | ✅ cumple | Guion 119: `el carro mide 3×3 m — los [6,6] celdas que DECLARÓ el motor` · `el carro entra como \`prop\`` · `la pared del carro está a 1.9 m de su centro`. Guion 118: `empujando contra el carro, el jugador NO entra en su caja` · parada con 0,05 m de holgura |
| 3 | **Lo decide lo que el motor declara, no el `kind` por defecto** | ✅ cumple | Guion 119, en la MISMA partida: `el carro DECLARADO (3 m) y el cofre SIN declarar (1.5 m) miden distinto`. Unitario con literales: `consequence-handler.test.ts` → carro `[6,6]`→3 m, cofre sin declarar→1,5 m, granero `[20,14]`→10×7 m |
| 4 | **`object` conserva su huella 3×3 y sigue frenando cuando no declara nada** | ✅ cumple | Guion 119: `un \`object\` que no declara NADA sigue siendo sólido en su centro y sus cuatro bordes (el cofre)` con `1.5×1.5 m`; y lo mismo para `building` (forja, 4 m). Guion 91, sin tocar, sigue verde |
| 5 | **Ningún spawn deja de ser sólido por omitir un campo** — probado con las COMBINACIONES | ✅ cumple (4 de 6 en el juego) | Matriz medida en una sola partida (guion 119): `object` sin declarar 1,5 m sólido · `building` sin declarar 4 m sólido · `object [6,6]` 3 m sólido · `item [2,2]` 1 m se pisa · `npc` no es caja. **⚠️ No probado EN EL JUEGO**: `item` sin `footprint` (el motor falso no lo emite; cubierto por unitario con literal 0,5 m) y `footprint` en un `npc` (lo rechaza el contrato antes de llegar al juego) |
| 6 | **`footprint` solo afina el tamaño** (no el permiso) | ✅ cumple | `aabbBloquea` no se tocó (0 líneas en el diff); el `item` de 1 m no frena y el `object` de 3 m sí, con el mismo `dueno:{de:"runtime"}` en los dos (guion 119) |
| 7 | El contrato viaja vivo por las tres vías (zod, espejo Python, tool JSON) | ✅ cumple | Suite Python completa en mi árbol: `Ran 245 tests … OK`. `npm run verify`: `tests 2605 · pass 2605 · fail 0`. `grep` a cero de `valid_kinds` y de «footprint blocks movement either way» |
| 8 | El candado del campo que SOBREVIVE se pone rojo | ✅ cumple, **con el alcance recortado** | Reproducido el rojo del ingeniero al pie de la letra (validar y podar en `_spawn_entry`): `test_reaction … ok` y `FAILED (failures=2)` en los dos `test_reaction_sobrevive`. **Pero el universo del candado es solo `spawn_entity`** → H-2 |
| 9 | El resume devuelve lo que el motor declaró | ❌ **NO cumple** (declarado: es la PR 2) | Guion 119, medido: la bolsa **NO vuelve**; el carro vuelve de **1,5×1,5 m** habiendo declarado 3×3; su pared pasa de **1,90 m a 1,15 m** del centro → **0,75 m por lado** de suelo que antes era el carro. Captura `04-el-mismo-carro-tras-reanudar.png` |
| 10 | Fail-loud: lo que no vuelve, se dice | ✅ cumple | Guion 119: `lo que el motor puso y el resume no sabe devolver SE DICE en el registro del jugador, con su nombre`. En pantalla (captura 04): `session · «Bolsa de monedas» no vuelve al mundo: el juego no sabe pintar nada de tipo "item" (esperaba npc\|object\|building)` |
| 11 | El guion deja el criterio re-ejecutable | ✅ cumple | `qa/guiones/118-…` verde en mi árbol (4/4 con sus tres vecinos), y mi `119-…` verde. **Pero el 118 no puede ver un `footprint` ignorado en la bolsa** → H-3 |
| 12 | Mutación de los módulos que miden el cambio | ⚠️ **no probado** | Pedida y pendiente, como declara el ingeniero. No la corro: los tres pasan del tope local |
| 13 | El motor real (MCP) emite de verdad `footprint` | ⚠️ **no probado** | Mandato de cero créditos. El gotcha «narrative-mcp sin recompilar sirve el contrato viejo» sigue sin ejercerse contra el motor de verdad |

---

## Hallazgos

### Importantes

**H-1 · El resume devuelve otro mundo, y esta PR CREA esa incoherencia.**
Declarado por el ingeniero y planificado para la PR 2 — pero conviene medir qué pierde el jugador,
porque el informe lo cuenta como «el carro vuelve midiendo 3 celdas» y es algo más que eso.

*Reproducción desde el arranque*: `NEFAN_PORT_OFFSET=700 ./start.sh --preset e2e-sin-creditos` →
nueva partida en `alta_fantasia` → hablar con el tabernero hasta el turno 3 → pedirle por texto
libre las dos marcas → guardar y reanudar. O, sin manos:
`NEFAN_PORT_OFFSET=700 node qa/run.mjs 119-lo-que`.

Medido:

- **La bolsa desaparece.** El mundo vuelve con «6 cosa(s) que puso el motor» y ella no está. Se
  dice, con su nombre, en el registro de errores (✅ fail-loud), pero **no** en el muro «Tu partida
  vuelve incompleta» que sí tapa la pantalla por otro motivo — dos canales para dos pérdidas del
  mismo resume, y la del `item` es el silencioso.
- **El carro encoge de 3×3 m a 1,5×1,5 m**, render y colisión a la vez. Lo que el jugador
  esperaba: que la cosa que rodeó ayer siga donde estaba. No se atraviesa un carro visible —el
  volumen encoge con la caja, y eso lo comprobé en las capturas 02 y 04, tomadas desde los mismos
  9 m—, pero **gana 0,75 m por cada lado** de suelo que antes era el carro, y un granero
  `[20,14]` (10×7 m, hay test) volvería de 4×4.
- **Lo nuevo es la INCOHERENCIA, no el tamaño.** Antes de esta PR un `object` medía 1,5 m en vivo
  y 1,5 m al reanudar: coherente. Desde la PR 1 mide lo declarado en vivo y el defecto al volver.
  Si la tanda se recortara aquí, esto sería un **bloqueante**; como la PR 2 está comprometida y
  tiene guion esperándola, lo dejo en importante.

**H-2 · El candado del campo que sobrevive tiene un universo de UNA variante: la poda que no
caza.** El ingeniero enseña el rojo del `footprint` en `spawn_entity`, y ese rojo es real (lo
reproduje). Pero la clase de fallo que la crítica midió —«vivo de contrato, muerto de datos»—
sigue **entera** para las otras cinco variantes de consequence, que `validate_narrative_reaction`
reconstruye a mano exactamente como antes (`dialogue` :1268-1292, `story_update`, `schedule_event`
:1305-1313, `plugin_event` :1314-1329).

Lo medí, no lo deduje. Añadí `tono: z.string().optional()` a `DialogueConsequence`, corrí
`npm run gen:contract` (el campo entra en el tool JSON y en `narrative_event.md`, o sea: **el
modelo lo ve**) y luego las dos suites:

```
$ npx tsx --test test/contract-fixtures.test.ts test/contract-model-io.test.ts \
    test/contract-prompts.test.ts test/contract-terms.test.ts test/entity-vocabulary.test.ts
ℹ tests 117 · pass 117 · fail 0
$ python -m unittest ai_server.tests.test_contract_fixtures      →  Ran 5 tests … OK
```

Y el campo muere:

```
validate_narrative_reaction({'consequences':[{'type':'dialogue','speaker':'Tabernero',
                             'text':'Hola','tono':'burlón'}]})
→ {'consequences': [{'type': 'dialogue', 'speaker': 'Tabernero', 'text': 'Hola'}]}
   tono sobrevive: False           (y el zod del MCP sí lo conserva: `.passthrough()`)
```

Todo verde, campo muerto, divergencia entre las dos vías del modelo. Es el mismo agujero de #397 y
de #532, un `type` más allá. La frase del commit —«un campo nuevo del zod llega vivo solo»— es
cierta **solo dentro de `spawn_entity`**, y ni el commit ni `implementacion-1.md` lo acotan.
(Descarté otras dos hipótesis de poda: el codegen NO se come campos en silencio —`toJsonSchema`
lanza ante un `typeName` no soportado— y el bridge no tiene allow-list: `ai-client.ts:126` pasa
`data.consequences` tal cual.)

**H-3 · El quinto sabotaje: el guion 118 no puede ver un `footprint` ignorado en la BOLSA.**
Los cuatro sabotajes declarados atacan el LLAMANTE (`consequence-handler`) o el cliente
(`materializar-spawn`). El quinto ataca la función misma, que es donde `npm run afectado` también
apuntaría: `huellaEnMetros` ignorando su segundo argumento.

- **5a — para todas las clases** (`const celdas = FOOTPRINT_POR_DEFECTO[kind]`): el guion 118 sale
  con **un solo rojo de diez**, y el rojo es del carro. La línea de la bolsa sale así, en verde:
  `✔ la bolsa mide lo que el motor DECLARÓ (2×2 celdas = 0.5×0.5 m), no el defecto de su clase`
  — el propio texto se contradice y el aserto pasa.
- **5b — solo para `item`**: `1 en verde · 0 en rojo de 1`. **El guion 118 entero queda VERDE con
  la bolsa midiendo la mitad de lo que el motor declaró.**

La causa es estructural: `afirmaElTamano` compara lo que llegó al cliente contra
`huellaEnMetros(kind, footprint)` de `nefan-core/dist`, o sea **el oráculo es el código bajo
prueba**. El carro tiene un ancla independiente (`porDefecto = huella("object")`, que fija el 1,5 m
de la clase) y por eso 5a se caza; **la bolsa no tiene ninguna**. No hay bug escapado —los
unitarios sí lo cazan (`✖ un \`item\` sale con su clase y con tamaño`, 1 rojo de 83)— pero el guion,
que es la evidencia DESDE EL JUEGO y lo que se volverá a correr, no defiende la mitad del título
del issue. Restaurado con `md5sum -c` comprobado y `dist` reconstruido.

**H-4 · La derivación estructural copia los NOMBRES del contrato, no los TIPOS: los dos gates
dejan de rebotar igual.** `_spawn_entry` recorre `SPAWN_ENTITY_FIELDS` y **copia tal cual** todo
campo sin saneador propio. El tool JSON declara el tipo justo al lado (`character_type:
{"type":"string"}`) y Python no lo mira. Medido:

```
zod character_type=123 / {"a":1} / ["x"] / true  → rechaza las cuatro
Python ACEPTA las cuatro y las PROPAGA:
  {'type':'spawn_entity','entity_kind':'object','name':'Carro',…,'character_type':{'a':1}}
```

Antes de esta PR el campo se caía en la allow-list, así que la basura no cruzaba; ahora llega a la
consequence, al `EntityRecord.data` y al save (`data` es la consequence entera) y de ahí a
`serializeForLlm`. Es la contrapartida exacta del acierto de la opción B: el olvido desaparece y
entra la validación que nadie escribió. `qa/los-dos-gates-rebotan-igual.mjs` no lo cubre — corre
sobre `generate_scene`, no sobre `narrative_react` (lo verifiqué corriéndolo: 18 asertos, todos de
claves retiradas de escena).

**H-5 · `footprint` sin tope: el motor puede declarar una caja más grande que el tile.**
El plan lo decidió a propósito («inventar un tope sería un número sin medir»), pero el número está
medido y es del dominio: `TILE_SIZE_M = 64`. Medido en core:

```
footprint [400,400]   → zod ACEPTA · huellaEnMetros = {x:200,  z:200}
footprint [1,100000]  → zod ACEPTA · huellaEnMetros = {x:0.5,  z:50000}
```

Un `object [200,200]` es un muro de 100 m sobre un tile de 64: el tile entero se vuelve sólido, sin
un solo aviso. Y la asimetría está dentro del propio contrato: la escena **sí** acota
(`scene-schema.ts:148`, `topeDeFootprint`, con un motivo escrito para el modelo), el spawn no. El
modelo es un LLM y esto es lo que más pone. **No probado en el juego**: el motor falso no puede
emitir una huella arbitraria.

### Menores

**H-6 · Los dos rojos del candado no quedan ejecutables, y esta casa tiene el sitio hecho.**
`qa/contrato-candados-en-negativo.mjs` existe, corre en CI (job `candados-headless`) y ya tiene
seis invariantes `py:ai_server.tests.test_contract_fixtures` con este mismo patrón (escribir el
fuente roto, exigir el rojo, restaurar). Los dos nuevos —podar `footprint` en `_spawn_entry` y
quitarle `character_type` al `sobrevive` de una fixture— **no están ahí**: viven en prosa en
`implementacion-1.md`. Hoy son ciertos (los reproduje los dos); dentro de dos tandas nadie lo
sabrá, que es literalmente el caso del 05-09 que motivó ese job.

**H-7 · Dirección de arte: `item` y `object` se distinguen por un tono de gris, y el jugador no
tiene cómo saber cuál pisa.** Captura
`qa/capturas/ultima/119-…-01-la-bolsa-de-1x1-a-cinco-metros.png`: la bolsa (`#aa8`, 1×1×0,5 m) y el
cofre (`#666`, 1,5×1,5×1 m) se leen como **dos cajas beige de distinto tamaño**, no como «algo que
se pisa» y «algo que se rodea». La diferencia de altura (0,5 vs 1 m) ayuda; el color, bajo la luz
cálida de la escena, casi no. No hay afordancia: se aprende chocando. Y dos observaciones de
escala que salen del propio contrato que el modelo lee:

- `ui_systems.md` invita a poner «a coin pouch, a dropped key, a letter on the ground» y el zod
  dice «una moneda [1,1]». **[1,1] celdas = 0,5 m**, con `KIND_DEFAULT_HEIGHT.item = 0.5`: una
  llave caída se pinta como un cubo de medio metro a la altura de la rodilla. La rejilla no puede
  expresar nada más pequeño, así que la clase nueva nace con un suelo de escala que el texto no
  avisa.
- En el greybox, el carro de 3×3×1 m se lee como «un contenedor», no como un carro de heno
  (captura `02`). Es la limitación conocida del clay, no de esta PR; lo anoto porque el `footprint`
  declarado hace que el motor ponga volúmenes **grandes**, y ahí el greybox se nota más.

**H-8 · Asimetría de fail-loud entre los campos que solo valen para un `kind`.** `footprint` en un
`npc` se rechaza con una frase preciosa y espejada en los dos procesos; `role` y `style_ref` en un
`item` o un `object` se aceptan y se ignoran en silencio. Medido: `{entity_kind:"item",
name:"Bolsa maldita", role:"hostile"}` → **el zod ACEPTA**, y `combatForHostileRole` solo corre
para `kind === "npc"` (`consequence-handler.ts:125`), así que el motor cree haber puesto algo
hostil y puso una bolsa. Si la regla cruzada merecía un `superRefine`, esta merece la simétrica.

**H-9 · El tercer estado del motor falso: instrumento legítimo, con un filo.** Veredicto:
**instrumento, no banco divergente** — pero conviene decir por qué, porque no es obvio.

- Es de la MISMA clase que `fakeDialogueTurn`, que ya era estado de sesión mutable y ya obligaba a
  `aisla: ["fake-ai"]`. No introduce una categoría de riesgo nueva.
- **Lo verifiqué, no lo supuse**: corrí `119 48 49 50 66 67 81 91 118` en una tanda; mi guion y el
  118 (los dos que ponen el pestillo) corren ANTES por orden alfabético, y **los siete que dependen
  de los spawns por turno salieron verdes**. Comprobé además que los siete declaran
  `aisla: ["fake-ai"]` y que ninguno de los demás usa esas etiquetas.
- El filo: es un **pestillo global de sesión**, no un interruptor por turno. Quien mañana escriba
  un guion que use el cofre del turno 3 y olvide `aisla: ["fake-ai"]` no verá «el motor contestó
  otra cosa» sino «el motor no puso NADA», que se diagnostica peor. Y el motivo escrito («el cofre
  cae donde este guion mide») ya lo resuelve el delta del suelo que el propio 118 implementa: el
  pestillo es cinturón además de tirantes. No pido quitarlo; pido que `qa/README.md` diga que
  `aisla: ["fake-ai"]` es obligatorio para todo guion que cuente con los spawns por turno.

**H-10 · Las dos capturas del guion 118 no enseñan su sujeto — y enseñan un estado que el guion no
declara.** `118-…-01-encima-de-la-bolsa.png` y `…-02-contra-el-carro.png` muestran **al jugador
MUERTO** (`Vida 0/100`, «YOU DIED — press R to respawn», el Bandido de camino a 60 HP) mirando un
bosque: ni la bolsa ni el carro son identificables en ninguna de las dos. El 91 pelea con el hostil
y reaparece antes de medir, justamente por esto; el 118 no lo hace ni comprueba que el jugador esté
en pie. Las medidas del 118 son sondas y no dependen de que esté vivo, así que **no invalidan el
verde** — pero la evidencia que mirará una persona no prueba nada, y si mañana la muerte cortara el
movimiento el rojo diría otra cosa. (En mi guion lo resolví con `revivirSiHaceFalta`, prestado del
91.)

### Observación, no hallazgo

Los NPCs **no colisionan con ningún spawn de runtime**: la colisión server-side se construye solo
del `terrain_grid` y del plan del tile (`bridge/sim-collision.ts:69-94`), así que el carro de 3 m
que el jugador rodea, los vecinos lo atraviesan. Es de antes de esta PR (#489 lo dejó así) y está
fuera de alcance; lo anoto porque `footprint` permite ahora declarar un granero de 10×7 m y la
incoherencia pasa de imperceptible a visible.

---

## Lo que entrego

`qa/guiones/119-lo-que-el-motor-declaro-al-reanudar-la-partida.mjs` (+ su fila en `qa/README.md`).
Mide lo que el 91 y el 118 juntos **no** miden: la matriz de las cuatro combinaciones en UNA sola
partida, y el resume. Verde hoy —`1 en verde · 0 en rojo de 1`— porque las tres líneas del resume
roto van con `ctx.log` y no con `ctx.expect` (regla T10: un rojo a propósito se aprende a ignorar);
llevan el número medido y el prefijo `[PR 2]`. **Con la PR 2, esas tres líneas son un cambio de
verbo** y el guion pasa a ser su candado.

Probado en negativo por la vía más honesta que había: la primera versión salió **roja** en una
corrida real («el jugador ANDA hasta ponerse ENCIMA de la bolsa — `{"d":4.69}`») porque las cajas
de los turnos 3 y 4 se cruzaban en el camino; de ahí salió el guardia que declara `sinMedirBloque`
cuando la recta hasta la bolsa bloquea (un `item` no frena, así que lo que hubiera en medio sería
otra cosa). Y las tres capturas empezaron siendo **idénticas** porque `setPlayerPos` + `shot`
seguidos fotografían el sitio anterior; ahora esperan a que la cámara llegue.

## Workarounds usados, y por qué ninguno es del jugador

1. **Sabotajes con restauración**, uno por vez: podar `footprint` en `_spawn_entry` (Python), añadir
   `tono` al zod + `gen:contract`, y dos ediciones dentro de `huellaEnMetros` + `npm run build`.
   Todos restaurados y **comprobados**: `md5sum -c … OK`, `git status` limpio tras cada uno, `dist`
   reconstruido al final, `npm run verify` de cierre en `2605 pass · 0 fail`.
2. **En mi guion**: `setPlayerPos` para los tres miradores de las capturas —declarado en el
   fichero, y ninguna afirmación depende de él: todo lo que se afirma se mide con sondas o
   andando— y cerrar el muro «Tu partida vuelve incompleta» **por su botón**, no con CSS.
3. **Ningún workaround hizo falta para OBSERVAR la feature.** El criterio del jugador se alcanza
   por el flujo real desde el título: nueva partida → hablar con el tabernero → pedirle algo por
   texto libre → andar. Eso es lo que hacen el 118 y el 119.

Sí apareció, sin que yo lo provocara, un muro que el jugador ve al reanudar: **«Tu partida vuelve
incompleta — La partida guardada pone a Tabernero corpulento en (32,4, −7,3), donde no hay mundo»**.
Es ajeno a esta PR (el NPC ambiental se sale del tile) y no lo reporto como hallazgo suyo, pero
queda dicho: al reanudar esta partida el jugador se come un modal por un motivo y una línea de
registro por otro.

## No probado, y por qué

- **Gasto real de créditos y el motor narrativo de verdad (MCP)**: mandato de cero créditos. Queda
  sin ejercer el riesgo que el propio plan anota: `narrative-mcp` sin recompilar sirve el contrato
  viejo y el modelo **nunca mandaría `footprint`**. Nadie lo ha visto emitirlo.
- **`item` sin `footprint` en el juego** (0,5 m por defecto) y **`footprint` en un `npc` en el
  juego**: el motor falso no emite ni lo uno ni lo otro. Cubiertos por unitario con literales y por
  fixtures `invalid/`, no por un guion.
- **Huella extrema en el juego** (H-5): medida en core, no en partida.
- **Mutación** de `consequence-handler`, `scene-normalize` y `contrato-escena`: pedida y pendiente.
- **La batería completa** (71 guiones): corrí 9 (118, 119, 48, 49, 50, 66, 67, 81, 83, 91 en dos
  tandas), elegidos por dependencia del motor falso y del resume. `npm run crap -- --check` no lo
  corrí: exige `npm run coverage` delante y mi diff no entra en el CRAP (`qa/` está fuera).

---

## Veredicto

**APTO CON HALLAZGOS.**

Lo que el usuario pidió en la petición original —bolsa que se pisa, carro que no, y **decidido por
lo que el motor declara**— está hecho y lo he visto con el juego delante, desde el arranque, en las
cuatro combinaciones que este bench puede producir. La mitad viva de la (c) se respeta: ningún
spawn dejó de ser sólido por omitir un campo, y lo comprobé con las combinaciones y no con una.

Lo que impide el apto limpio son cinco cosas, ninguna de ellas un error de código escapado:
el resume incoherente que esta PR crea (H-1, con PR 2 comprometida), un candado cuyo alcance es
menor que el que promete el commit (H-2), un guion que no defiende la mitad del issue que da título
a la PR (H-3), una validación que la derivación se llevó por delante (H-4) y una huella sin tope
sobre un tile de 64 m (H-5).

Ninguno es bloqueante **a condición de que la PR 2 exista**. Si la tanda se recortara aquí, H-1
pasa a bloqueante.
