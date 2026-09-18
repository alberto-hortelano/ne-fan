# QA — Tanda R (#663): la séptima pareja de ids del título entra en el banco

Árbol: `/home/al/code/ne-fan-qa-r`, desprendido en `245d4180` (los dos commits del ingeniero sobre
`main` = `bb26b04a`). Bloque de puertos `NEFAN_PORT_OFFSET=1300`. Alcance: **#663 y nada más**.

**VEREDICTO: APTO CON HALLAZGOS.** Los tres hallazgos son de PROSA, ninguno de código. El corte es
correcto y demostrablemente invisible para el jugador. Lo que no está bien es lo que la tanda
AFIRMA de sí misma en dos sitios, y que el banco del cliente siguiera sin poder demostrar que puede
ponerse rojo.

## Criterios

| Criterio (de `requisitos.md` y del mandato) | Veredicto | Evidencia |
|---|---|---|
| CA-1 · el banco pasa de 6 a 7 parejas del censo de #555 | ✅ | `npm test` en `nefan-html`: 5 asertos, `pass 5 fail 0`. Los tres nuevos importan `MARCA_DEL_HOME`/`loQueCuentaLaBanda` (chasis), `esqueletoDelHome()` (home) y `tarjetaDePartidaHtml()` (tarjeta) |
| CA-2 · el test no regexea el fuente y se pone rojo con un sabotaje nombrado | ✅ | Los **cuatro** sabotajes del plan, reproducidos por mí uno a uno: cada uno **4 pass / 1 fail** y el rojo cae **exactamente** en el aserto que el plan predice (salidas en §«Sabotajes» abajo). El test lee la SALIDA de las funciones, no el fichero |
| CA-3 · `home.ts` bajo 450 sin subir ningún umbral | ✅ | `wc -l` → `home.ts` **376**, `tarjeta-de-partida.ts` **121**, `atomos-de-html.ts` **43**, `chasis.ts` **430**, `atomos.ts` **276**. `client-file-size.json`: `tope` 450 y las tres `excepciones` (1379/1687/568) **sin tocar** — verificado contra `git diff`, que solo cambia el `$comment` |
| CA-4 · si un unitario deja redundante un guion, el guion muere y se dice cuál | ⚠️ | **No muere ninguno, y eso es correcto** — pero el MOTIVO escrito está medido falso. Ver **H-2** |
| Cero créditos | ✅ | Censo de gasto de la corrida base: 3 guiones tocaron puerta, **todas contra `fake-ai-server`** del preset `e2e-sin-creditos`. `gasto sesión 0,00 € · total 0,00 €` en todas las capturas |
| `npm run verify` (nefan-core) verde | ✅ | Re-corrido por mí: `tests 3021 · suites 533 · pass 3021 · fail 0` |
| Los guiones del título siguen verdes | ✅ | `node qa/run.mjs 33 52 98 101 122` → **6 en verde · 0 en rojo de 6** (el filtro se lleva el 133 de propina, como en el informe) |
| El jugador no ve ningún cambio | ✅ | **Más fuerte que mirar capturas**: el código movido es **byte a byte idéntico**. `diff` de `sessionRowHtml`(viejo) vs `tarjetaDePartidaHtml`(nuevo) → única línea distinta, la de la firma. `modeBadgeHtml` y `formatDate` → `IDENTICO`. `BADGE_CSS` y `BTN_SMALL_*` → cadenas idénticas. El esqueleto del home → idéntico al `innerHTML` inline de antes. Un cambio visual es **inexpresable** por este corte |
| Deuda sin crecer | ✅ | Ningún fichero de `nefan-core/src` en el diff; `candados-headless-totalidad` 18/18 verde con mi guion nuevo dentro |
| El censo de `atomos.ts` es 8/15 y no 9 | ✅ | **Recontado por mí**, export a export, con el `grep` que el propio fichero prescribe: 8 líneas de 15 con ≥2 dueños, 9 símbolos de 16. Y los **siete** sin dos dueños son exactamente los que su docblock nombra (5 de la tarjeta de mundo + 2 URL de servicio) |
| Gasto real de créditos | ⚠️ no probado | Todo contra el motor falso, por mandato. No se ejerció ninguna puerta de pago real |

## Los sabotajes

**Los cuatro del plan, reproducidos.** Cada uno **4 pass / 1 fail**, y el rojo en el aserto predicho
y solo en ése:

| Sabotaje | Aserto rojo | ¿Como se prometió? |
|---|---|---|
| `esqueletoDelHome()`: `id="ts-sessions"` → `id="ts-partidas"` | «el chasis busca el home por un id que el home PINTA» | ✅ |
| `chasis.ts`: `MARCA_DEL_HOME = "#ts-nada"` | el mismo | ✅ |
| `tarjetaDePartidaHtml`: `class="ts-save"` → `class="ts-partida"` | «y cuenta las partidas por una clase que la tarjeta PINTA» | ✅ |
| `loQueCuentaLaBanda` colapsada a `return FILA_DE_PARTIDA;` | «y fuera del home NO cuenta lo mismo (#553)» | ✅ |

**Los que el ingeniero NO probó, y que se me pidió buscar.** Los tres dejan el banco en **5 de 5
verde**:

| Sabotaje mío | Banco | ¿Lo caza alguien? |
|---|---|---|
| **SAB-5 · renombrado COORDINADO del id**: `esqueletoDelHome()` y `MARCA_DEL_HOME` a la vez, dejando huérfano el tercer lector `home.ts:120` | 🟢 5/5 | Sí, y a gritos: **5 de 6 guiones rojos** (`sessionsEl` queda `null` y revienta la lista de saves) |
| **SAB-6 · renombrado COORDINADO de la clase**: `tarjetaDePartidaHtml` y `FILA_DE_PARTIDA` a la vez, dejando huérfano `marcarTarjetaFallida` (`home.ts:372`) | 🟢 5/5 | Sí: guiones **52 y 98** |
| **SAB-7 · la privada del chasis reteclea el literal** (`querySelector("#ts-nada")` en vez de `MARCA_DEL_HOME`) — el agujero A que él declara | 🟢 5/5 | Sí: guiones **33 y 122**, exactamente los dos que predijo |

**Conclusión sobre los agujeros declarados: el ingeniero acertó en los dos, y su predicción de quién
los caza está MEDIDA y es correcta.** No hay hallazgo de cobertura aquí. Lo que sí hay es que todo
eso está cazado únicamente por una batería de navegador **que el CI no corre** — que es lo que
motiva el guion que dejo.

## Las dos preguntas que se me pidió resolver sobre `marcarTarjetaFallida`

El ingeniero dejó abierto que `marcarTarjetaFallida` (`home.ts:372`) lee `.ts-save` con
`closest()` y que esa clase la pinta ahora otro fichero. Se me pidió verificar las dos mitades:

**1 · ¿Lo caza de verdad el guion 52?** **SÍ, y él lo subestimó: también el 98.** Medido aislando el
defecto sin ruido — dejé la clase intacta en todas partes y apunté SOLO el `closest` a una clase que
nadie pinta (`.ts-huerfana`). El banco se queda en 5/5 verde; los guiones dicen:

```
✘ …y la tarjeta que falló se DISTINGUE de sus vecinas, no solo por un id opaco
    — la que falló: "rgb(42, 42, 48)" · las demás: ["rgb(42, 42, 48)","rgb(42, 42, 48)"]   ← guion 52
✘ …y se ve CUÁL: la tarjeta de esa partida queda marcada, como en el borrado fallido — []  ← guion 98
```

**2 · ¿Era igual de suelto antes del corte?** **SÍ.** En `bb26b04a`, `home.ts` ya tenía los dos
literales independientes en el MISMO fichero: `:429` pintaba `class="ts-save"` y `:413` leía
`closest(".ts-save")`, con cobertura cero. Y lo mismo con el id: `:130` pintaba y `:134` leía.
**No es regresión de esta tanda**; lo único que cambia es la distancia, tal y como él escribió.

**3 · El tercer lector que él DESCARTÓ** (`home.ts:120`, en su «Desviación 2») — lo puse a prueba
porque una justificación no verificada es el defecto que esta casa más repite. Su descarte **se
sostiene**: apuntado a un id que nadie pinta, **5 de 6 guiones se ponen rojos**. Rompe ruidosamente,
no en silencio. Con una precisión que conviene anotar: `sessionsEl` se toma con un `as HTMLElement`
sin guarda y se usa en 7 sitios, así que el fallo es un `TypeError`, no una degradación.

## Hallazgos

### H-1 · MENOR · El `$comment` que presume de re-medir cuatro cifras caducadas introduce una quinta, y es de esta tanda

`nefan-core/data/contract/client-file-size.json`, `$comment`, dice:

> …así que la tarjeta de una partida salió entera a `ui/tarjeta-de-partida.ts` […] y **`home.ts`
> quedó en 373**.

`home.ts` mide **376**. El propio informe del ingeniero dice 376 en cinco sitios; la cifra que llega
al contrato es otra.

Reproducción:

```
$ wc -l < nefan-html/src/ui/titulo/home.ts
376
$ grep -o 'home.ts` quedó en [0-9]*' nefan-core/data/contract/client-file-size.json
home.ts` quedó en 373
```

Lo que lo hace un hallazgo y no una errata: **nada lo canda**. `client-file-size.test.ts` vigila las
cifras del array `excepciones`, no el `$comment` (`grep -n comment` sobre ese test → cero líneas), y
ese párrafo es justamente el que acaba de corregir cuatro números caducados y de escribir «las
cifras caducan siempre». Todas las demás cifras que re-midió (437 / 431 / 430 / 411 / 389, y que
«no hay ningún fichero entre 438 y 567») **las verifiqué una a una y son correctas**: la única mala
es la del fichero que esta tanda tocó.

Arreglo: una línea, `373` → `376`. **No lo he tocado.**

### H-2 · MENOR · La regla 2 del banco justifica «no muere ningún guion» con una premisa medida FALSA

`nefan-html/test/README.md:48-49` (y, con otras palabras, el docblock del test y §3.7 del informe):

> …los cinco que tocan esos dos tokens —33, 52, 98, 101 y 122— miden GEOMETRÍA de navegador […] y
> **ninguno afirma que las dos puntas hablen del mismo elemento**, que es lo único que cubre el
> unitario.

Medido: **es falso**. Apliqué el sabotaje 3 —el renombrado de UN SOLO lado, o sea exactamente «las
dos puntas dejan de hablar del mismo elemento», el caso que el unitario existe para cazar— y corrí
la batería:

```
$ node qa/run.mjs 33 52 98 101 122        # con class="ts-partida" en la tarjeta
1 en verde · 5 en rojo de 6
```

**Los cinco guiones se ponen rojos.** El unitario no caza nada que la batería de navegador no cace.
La razón es que los guiones **hardcodean `.ts-save` y `#ts-sessions` ellos mismos**
(`33:306,331,336,338`, `52:87,90`, `98:85,94`, `101:76,191`), así que cualquier renombrado los
tumba.

Esto no invalida el test ni la decisión de no matar ningún guion — invalida el MOTIVO escrito. El
motivo correcto, y que sí se sostiene con lo medido, es doble:

1. Los guiones son **detectores de renombrado**, no verificadores de costura: se ponen rojos
   igual ante un renombrado CORRECTO y coordinado (SAB-5/6), donde el unitario acierta al quedarse
   verde. No distinguen las dos cosas; el unitario sí, y además **nombra qué punta está mal**.
2. **El CI no corre la batería de navegador** (`ci.yml` solo corre la clase `--sin-navegador`),
   mientras que `npm test` de `nefan-html` **sí** está en el job `nefan-html`. Ése es el eje real
   por el que el unitario paga su sitio.

Dicho de otro modo: el test se vendió por cobertura y lo que aporta es CI y precisión. Con la
justificación escrita, la próxima tanda que aplique la regla 2 decidirá contra una premisa falsa.

### H-3 · MENOR (deuda estructural, no defecto) · El banco del cliente era la única familia de candados sin hermano en negativo — y lo dejo resuelto

Todas las familias de candados de la casa tienen su `*-en-negativo.mjs` que vuelve a demostrar que
pueden ponerse rojas (`contrato-`, `mutacion-`, `esperas-`, `bateria-`). El banco del cliente nació
el 17 (#636) y creció el 18 (#663) **sin ninguno**: la única prueba de que sus asertos pueden
ponerse rojos era la tabla pegada en un `implementacion.md`, que es una afirmación, no una prueba, y
que además es de los documentos que **no se commitean**. La regla de la casa —«un headless nuevo
entra el día que nace o no lo corre nadie»— no se aplicó aquí.

**Entrego el guion**: `qa/guiones/148-el-banco-del-cliente-puede-ponerse-rojo.mjs`.

- Declara `sinMotor` y `sinNavegador`, así que **entra solo** en `node qa/run.mjs --sin-navegador`,
  que es el paso que el CI ya corre. No hay que acordarse de añadir nada a `ci.yml`.
- Prueba **seis sabotajes** —los cuatro de #663 más los dos de #555, que tampoco tenían hermano— y
  exige que se ponga rojo **EXACTAMENTE el aserto nombrado y solo ése**: un sabotaje que tumba tres
  asertos no demuestra que el suyo mide lo que dice.
- Y una tabla de **AGUJEROS CONOCIDOS** (los tres que medí arriba) que exige que sigan **verdes**,
  con quién los caza hoy. Es el trinquete en la dirección que falta: el día que alguien cierre uno,
  el guion se pone rojo con «YA NO ES UN AGUJERO: súbelo a SABOTAJES». Un agujero declarado en prosa
  envejece en silencio; declarado así, no.
- Se niega sobre árbol sucio, toma `turnoDeCandados()`, restaura en `finally` y en SIGINT/SIGTERM, y
  comprueba byte a byte que los cuatro ficheros volvieron.

Salida en verde:

```
· base (nada roto): 5 asertos, 0 rojo(s)
✔ el banco del cliente viene VERDE de partida
✔ los 5 asertos que este guion nombra siguen llamándose así
✔ sabotaje · el home pinta otro id y el chasis lo sigue buscando donde estaba
✔ sabotaje · el chasis busca una marca del home que el home no pinta
✔ sabotaje · la tarjeta pinta otra clase y la banda sigue contando la de antes
✔ sabotaje · la banda cuenta lo mismo dentro y fuera del home (repone #553)
✔ sabotaje · el chasis deja de estilizar uno de los seis (la foto de #555 se queda coja)
✔ sabotaje · el selector renombra un id que el chasis estiliza
✔ agujero CONOCIDO, sigue abierto · renombrado COORDINADO del id … `home.ts:120` huérfano
✔ agujero CONOCIDO, sigue abierto · renombrado COORDINADO de la clase … `marcarTarjetaFallida`
✔ agujero CONOCIDO, sigue abierto · la privada del chasis deja de usar `MARCA_DEL_HOME`
✔ los cuatro ficheros vuelven a estar byte a byte como estaban
```

**Probado en negativo TRES veces** (un guion que no puede ponerse rojo se ve igual que uno que
funciona):

| Rotura | Qué dijo |
|---|---|
| El aserto 1 del banco se vuelve tautológico (`true \|\| pintados.includes(id)`) | 🔴 ×2 — «ROMPERLO NO CAMBIA NADA: ningún aserto del banco se entera (esperaba «el chasis busca el home por un id que el home PINTA»)» |
| Un agujero se cierra (dejo el renombrado coordinado en una sola punta) | 🔴 «YA NO ES UN AGUJERO: ahora lo caza «…» — súbelo a SABOTAJES y bórralo de aquí» |
| Se renombra un aserto del banco | 🔴 «renombrados o borrados: y fuera del home NO cuenta lo mismo (#553) — actualiza este guion» |

El tercero importa especialmente: sin él, renombrar un aserto convertiría cada exigencia en «nadie
se entera» y el guion culparía al banco de lo que sería culpa suya.

## Crítica visual (director de arte)

Miré los cuatro estados que se me pidieron, en las capturas de la corrida base
(`qa/capturas/2026-09-18T08-12-23-707Z-147346/`):

- **Con partidas** (`33-02`, 5 saves): la lista lee bien. Jerarquía correcta —`game_id` en azul
  claro pesa más que el `session_id` en gris pequeño—, los badges «Imagen IA» / «Personajes base»
  comparten silueta exacta (es el `BADGE_CSS` movido, no copiado) y se alinean con el título de la
  fila sin pelearse con él. Los dos botones a la derecha, con el verde solo en el primario y el
  «Borrar» en rojo apagado con borde: la acción destructiva no grita. Luz única, paleta coherente.
- **Sin ninguna** (`98-01`): «— Ninguna partida todavía —» en cursiva gris. Limpio y sin hueco
  muerto; el ojo va al botón «Nueva partida», que es lo que toca.
- **Con una sola / lista corta** (`52-01`, 3 saves): sin banda de corte, correcto.
- **Con un borrado fallido** (`52-01`): la tarjeta que falló se distingue de verdad —borde `#a44` y
  fondo `#241a1a` contra el `#2a2a30` de las vecinas—. Es sutil pero legible a un golpe de vista, y
  ése era el punto del guion 52.
- **Estrecho con 12 partidas** (`33-03`): la banda «↓ hay 11 partidas más — desplaza la lista» sale
  con el número correcto (12 − 1 visible). Es la costura que esta tanda canda, funcionando.

**Sin regresión visual, y no por parecido: por construcción** (los templates son byte a byte los de
antes).

Una observación **fuera del alcance de #663**, que veo en `52-01` y no venía de esta tanda: el aviso
de borrado fallido le enseña al jugador tres líneas de ruta absoluta y `EACCES: permission denied,
unlink '/home/al/code/…/state.json'`. La primera frase sí es de jugador («La partida … SIGUE ahí…»);
lo de detrás no lo es. No lo toca esta tanda y no lo cuento como hallazgo suyo.

## Workarounds usados

**Ninguno que afecte al jugador.** No hice falta ocultar ningún overlay, forzar ningún estado ni
saltarme ninguna pantalla: los guiones conducen el juego desde el título y el banco corre en Node.
Lo único que escribí en el árbol fueron los sabotajes, **todos revertidos** (`git status` final:
solo mi guion nuevo, sin modificaciones a ningún fuente).

## No probado

- **Gasto real de créditos.** Todo contra `fake-ai-server` por mandato. El censo dice qué puertas se
  tocaron, no qué habría costado en producción.
- **La corrida de mutación.** #663 no toca `nefan-core/src`, así que no hay módulo que medir; sin
  sujeto no hay medida que pedir.
- **El juego con motor narrativo real.** Fuera de alcance y de presupuesto (cero créditos).

## Veredicto

**APTO CON HALLAZGOS.**

El corte está bien hecho y bien demostrado: las cifras del informe son exactas una a una, los cuatro
sabotajes se reproducen, el censo de `atomos.ts` recontado da lo que dice, `verify` está verde, los
guiones están verdes, y el cambio es **inexpresablemente invisible** para el jugador porque el
código movido es idéntico byte a byte. Los dos agujeros que el ingeniero declaró por adelantado son
reales, y su predicción de quién los caza es correcta y ahora está medida; el tercer lector que
descartó, bien descartado. Es un trabajo honesto: dejó escrito por adelantado lo que no cubría, que
es justo lo que suele tocarme encontrar a mí.

Lo que no está bien son dos frases:

- **H-1**: el contrato dice que `home.ts` quedó en 373 y son 376, en el mismo párrafo que corrige
  cuatro cifras caducadas ajenas. Una línea.
- **H-2**: la regla 2 del banco justifica no matar ningún guion con una premisa que se cae al
  medirla — los cinco guiones SÍ se ponen rojos cuando las dos puntas dejan de casar. La decisión es
  correcta; el motivo, no. Reescribirlo con los dos motivos que sí se sostienen (detector de
  renombrado vs. verificador de costura, y que el CI no corre la batería de navegador).

Ninguno bloquea. Los dos son prosa que envejece mal y que la próxima tanda se creería.

Y **H-3**, que no es un defecto de esta tanda sino la deuda que arrastraba: el banco del cliente ya
puede demostrar que se pone rojo, con
`qa/guiones/148-el-banco-del-cliente-puede-ponerse-rojo.mjs`, probado en negativo tres veces y
corriendo ya en el paso de CI que existe.

### Incidencia menor, ajena a esta tanda

`qa/guiones/` tiene **dos guiones con el número 126** (`126-dos-records-con-el-mismo-id-no-pintan-dos-mundos.mjs`
y `126-dos-rotulos-alineados-no-se-pisan.mjs`), así que `node qa/run.mjs 126` arranca los dos y
citarlo por número es ambiguo. Me lo encontré al numerar el mío (evité el choque con el 147 ya
existente usando el 148). No es de #663; lo dejo apuntado.
