# QA — Los espejos de la sesión (#313 #314 #316)

Validado contra la petición literal del usuario —**«Seguimos cerrando issues»**— y contra los
siete criterios de la §4 de `requisitos.md`. Todo lo que sigue está **medido por mí**, no citado
del informe del ingeniero; donde repito una medida suya lo digo.

**Cero créditos.** Todo el trabajo de navegador va sobre el preset `e2e-sin-creditos`
(fake-ai-server), con el guardarraíl del runner declarando `fake:true` en cliente y bridge en cada
corrida, y con la barra de dev marcando `gasto sesión 0,00 € · total 0,00 €`. `data/games` intacto:
las corridas usan el disco efímero de `qa/.tmp/<run>/games`.

**Veredicto: apto con reservas.** Los siete criterios se cumplen y el síntoma de jugador está
arreglado en el juego real. Las reservas son tres hallazgos importantes que NO bloquean el merge y
sí piden issue, y uno de ellos ya lo he cerrado sembrando un guion.

---

## 1 · Los siete criterios

| # | Criterio (§4) | | Evidencia |
|---|---|---|---|
| 1 | Un `game_gen` del juego A no se pinta en la tarjeta del juego B | ✅ | Juego real, tres estados distintos: **(a)** A→B a mitad de generación · **(b)** dos mundos seguidos · **(c)** el `error` de un juego que no está en pantalla. Trazas completas en §2. Más `qa/guiones/38-…` verde y **probado en negativo** (§4) |
| 2 | `repartirStatus` no mira `kind`, y el `kind` no reaparece en el transporte | ✅ | `grep -rn 'kind === "game_gen"' nefan-core/src nefan-core/bridge nefan-html/src` → única aparición es un comentario (`status-labels.ts:196`). `grep -c game_gen bridge/{context,ws-server}.ts` → `0` y `0`. Cuerpo del reparto: `if ("gameId" in status) …`. Y **cuatro sondas de tipos mías**, no las suyas (§3): sellar la pre-generación, colarla por `send`, escribirla con sello y meter un status de partida por el verbo de juego salen **rojas** |
| 3 | El guion 38 reescrito, con el aserto A/B que hoy falla | ✅ | Verde en tres corridas. **Rojo con el sujeto roto, dos veces**: volviendo a UNA ranura en `title-screen.ts` cae el aserto A/B; volviendo a sellar en `ws-server.ts` cae el de cable. Salidas literales en §4 |
| 4 | El candado del diálogo entra a coste cero (deuda 66 · Fronteras 15) | ✅ | `npm run deuda` medido por mí: `Deuda PARCIAL — 66 items` · `Fronteras — deuda congelada · 15`. Idéntico a la línea base. La regla se pone **roja** al re-declarar `dialogueActive` (`pass 46 · fail 1`) y verde al restaurar (`pass 47 · fail 0`) |
| 5 | `InputProvider.dialogueActive` deja de ser campo público; `DevToolsDeps` y la copia scripted fuera; la LECTURA se conserva | ✅ | `grep -rn dialogueActive nefan-html/src/input/` → **vacío**. `DevToolsDeps` → solo aparece en una frase de comentario. `main.ts:1193` conserva la clave del hook. Guiones **37, 41 y 42 verdes**, que es lo que pedía el criterio: no se ponen rojos por el motivo equivocado, porque `state().dialogueActive` y `puedeAtacar()` siguen existiendo. (Que el 37 esté verde ya **no significa** que el gate funcione: I1) |
| 6 | Un aplicador que pasa el campo equivocado del mismo tipo deja de compilar | ✅ | Medido por mí sobre el árbol de la rama: `style: (s, f) => s.style(f.combatSystem)` → `TS2345: Argument of type 'string' is not assignable to parameter of type 'Pick<SessionFacets, "styleId">'` en core **y** en html. El record sigue siendo uno y ordenado; `NOMBRES_DE_SINK[0] === "mundo"` vivo (`test/session-facets.test.ts:192`); y lo que ya funcionaba sigue rojo, medido por mí: sink equivocado `TS2339`, neutro fuera `TS2741`, aplicador fuera `TS2741` (§4). **Con reserva importante: I2** |
| 7 | Los tres issues se cierran | ✅ con reservas | #313 y #314 se cierran limpiamente. #316 cierra el criterio que se le escribió, no el objetivo que lo motivaba (I2). Y deja abierto un coste que no estaba en el plan: `status-labels` sale del conjunto medible en local (I3) |

---

## 2 · El criterio 1, jugando (el único síntoma de jugador)

Stack: `node qa/run.mjs 38 --keep` con `TILE_DELAY_MS=900` (§6, workaround 1), conducido después a
mano con el navegador por el camino del jugador: título → «Nueva partida» → tarjeta → «Regenerar
mundo» (dos clicks, confirmación armada) → cambiar de tarjeta.

### (a) A→B a mitad de generación, y A→B→A

Muestreador a 30 ms sobre `#ts-gen-progress` / `#ts-gen-state`, que solo apunta los CAMBIOS:

```
ms 12067  A · "⚙ Generando el mundo de Miravanda: mapa y escena inicial..."   [generating]
ms 12152  A · "⚙ Generando el anillo de tiles (1/8)... · 0 min"               [progress]
ms 13050  A · "⚙ Generando el anillo de tiles (2/8)... · 0 min"
ms 13956  A · "⚙ Generando el anillo de tiles (3/8)... · 0 min"
ms 14887  A · "⚙ Generando el anillo de tiles (4/8)... · 0 min"
ms 15780  A · "⚙ Generando el anillo de tiles (5/8)... · 0 min"
ms 16320  ← clic en la tarjeta de cuentos_oscuros
          B · texto:"" fase:null · "Mundo: — sin generar · Estilo Sombra de cuento: — sin aplicar"
          ……… NINGÚN CAMBIO durante los 14 s siguientes (tiles 6, 7, 8 y el `ready` de A) ………
ms 30450  ← clic de vuelta en alta_fantasia
          A · "Mundo de Miravanda generado: 9 escenas."                        [ready]
```

Es exactamente el estado que la crítica reprodujo en `main` («⚙ Generando el anillo de tiles (3/8)»
y «Mundo de Miravanda generado» bajo la tarjeta de Valdesombra), y ahora la línea de B se queda
vacía. **La ausencia de filas entre 16320 y 30450 es la medida**: el muestreador solo escribe cuando
algo cambia, así que la línea de B no se movió ni una vez mientras A terminaba.

Captura del instante:
`qa/capturas/manual-2026-08-30-espejos/qa-313-B-delante-mientras-A-genera.png` (fuera de git como
todo `qa/capturas/`, regenerable con los pasos de arriba) — Valdesombra seleccionada (borde
naranja), panel de generación diciendo «Mundo: — sin generar · Estilo Sombra de cuento: — sin
aplicar» y **cero línea de progreso**, con Miravanda generándose por detrás.

### (b) Dos mundos seguidos

Con A generando, se cambia a B y se pulsa «⚙ Generar mundo» en B. El bridge serializa: B arranca en
cuanto A termina, y cada tarjeta enseña **solo lo suyo**:

```
ms 65580–69300  A · Miravanda, tiles 1..5
ms 69900        ← a la tarjeta de B: línea VACÍA
ms 73950        B · "⚙ Generando el mundo de La Comarca de Valdesombra: mapa y escena inicial..."
ms 74013–80370  B · tiles 1..8 (los suyos, contados desde 1)
ms 81300        B · "Mundo de La Comarca de Valdesombra generado: 9 escenas."   [ready]
```

Ningún frame de Miravanda (6/8, 7/8, 8/8, `ready`) apareció bajo la tarjeta de Valdesombra. Y al
volver a A, su propia línea sigue ahí: `"Mundo de Miravanda generado: 9 escenas." [ready]`. El mapa
por `gameId` retiene los dos estados a la vez.

### (c) El `error` de un juego que NO está en pantalla

Inyección de fallo en el BORDE (§6, workaround 2): en el `games` **efímero** de la corrida se le pone
a `cuentos_oscuros` un `style_id` inexistente, así que su pre-generación falla de verdad en el
bridge (`loadStyleManifest`) y emite el `phase:"error"` real de `runGameGeneration`. Se encola B
detrás de A y se vuelve a la tarjeta de A antes de que llegue el error:

```
línea de A cuando llega el error de B : "Mundo de Miravanda generado: 9 escenas." [ready]   ← intacta
registro de errores                    : narrative · "La generación del mundo falló: style.json
                                         not found for style «estilo_que_no_existe» …"        ← fail-loud vivo
al volver a la tarjeta de B            : mismo texto, [error], color rgb(170,68,68)          ← rojo, esperándole
```

Las tres cosas que hacen falta a la vez: no contamina la tarjeta ajena, **no se calla** (el
`errors.push` de `title-screen.ts:170` sigue siendo incondicional) y el estado le espera al jugador
en la tarjeta que le toca.

---

## 3 · Criterio 2 — las sondas de tipos, medidas por mí

Fichero temporal dentro de `nefan-core/src/` (el `include` del tsconfig no ve la raíz — detalle que
importa: una sonda colocada fuera del `include` **compila sin mirar nada**, y esa es la forma
canónica de un verde vacío). Salida literal, ya borrado:

```
spike313.ts(13,5): TS2322: Type '"game_gen"' is not assignable to type '"consequences" | "tile" | "scene"'
    → Q1 · difundir la pre-generación por `broadcastNarrative`, el verbo que SELLA
spike313.ts(21,5): TS2322: Type '"narrative_status"' is not assignable to type '"state_update" | …'
    → Q2 · colarla por `send`, la otra salida
spike313.ts(35,5): TS2353: … 'sessionId' does not exist in type 'NarrativeStatusDeJuego'
    → Q3 · un `game_gen` CON sello de sesión
spike313.ts(53,5): TS2322: Type '"scene"' is not assignable to type '"game_gen"'
    → Q5 · un status de PARTIDA por `difundirDeJuego`
```

(Q4 —un status de partida sin `sessionId` por `broadcastNarrative`— compila **a propósito**: el
sello lo estampa el transporte, que es el invariante de #282.)

Dónde NO llega el tipo, y lo digo porque el criterio dice «o el tipo lo hace inexpresable»: el
transporte todavía puede estampar un sello si se sale del literal —
`Object.assign({}, msg, { sessionId: narrative.session_id })` en `ws-server.ts` **compila**, medido—.
No lo considero un incumplimiento: el tipo cierra la vía natural (las cuatro de arriba) y la vía
retorcida la caza el guion 38, que puse rojo con ese sabotaje exacto (§4). Es reparto de trabajo
entre el tipo y el banco, no un agujero sin dueño.

---

## 4 · Probado en negativo: qué candado puede ponerse rojo y cuál no

Cada sujeto roto a mano, medido, y restaurado (árbol limpio al terminar: `git status` solo enseña el
guion nuevo).

| Candado | Sabotaje | Resultado |
|---|---|---|
| Guion 38, aserto A/B (#313) | `renderGameGenProgress` vuelve a UNA ranura (`[...map.values()].at(-1)`) | **ROJO** — `✘ el progreso del mundo A NO se pinta en la tarjeta de cuentos_oscuros — {"texto":"⚙ PRE-GENERACION DE MIRAVANDA","fase":"progress"}`. El control («SÍ se pinta al volver a A») sigue verde, que es lo que impide que «no se pinta en B» y «no se pinta en ninguna parte» sean el mismo verde |
| Guion 38, aserto de cable (#313) | `difundirDeJuego` de `ws-server.ts` vuelve a sellar | **ROJO** — `✘ cada game_gen real dice de qué juego es, y NINGUNO trae sello — ["alta_fantasia/1788087685-b74241", …]` |
| `el-gate-del-dialogo-no-vuelve-a-ser-un-campo` (#314) | `dialogueActive = false` re-declarado en `keyboard-input-provider.ts` | **ROJO** — `✖ [error] el-gate-del-dialogo-no-vuelve-a-ser-un-campo` · `pass 46 · fail 1` |
| …la misma regla | el mismo espejo con **otro nombre** (`dialogoActivo = false`) | **VERDE** — `pass 47 · fail 0`. Limitación conocida de una regla de texto; ver hallazgo menor M1 |
| #316, el campo equivocado | `style: (s, f) => s.style(f.combatSystem)` | **ROJO** — `TS2345` en core y en html |
| #316, el SINK equivocado | `mundo: (s, f) => s.style(f)` | **ROJO** — `TS2339: Property 'style' does not exist on type 'Pick<FacetSinks, "mundo">'` |
| #316, el neutro que falta | quitar `combatSystem: ""` de `NO_SESSION` | **ROJO** — `TS2741: Property 'combatSystem' is missing … but required in type 'SessionFacets'` |
| #316, el aplicador que falta | quitar la entrada `combat` de `APLICADORES` | **ROJO** — `TS2741: Property 'combat' is missing …` |
| **Guion 37 (#311/#314)** | el gate del proveedor neutralizado por completo (`if (this.deps.dialogoAbierto()) return;` → `if (false) return;`) | **VERDE ENTERO, los cinco asertos** → hallazgo importante I1 |
| **Guion 43 (nuevo)** | el mismo sabotaje, más el de `dev-tools-input.ts` | **ROJO, tres asertos** |

---

## 5 · Hallazgos

### I1 · IMPORTANTE — el guion 37 ya no puede ponerse rojo por lo que dice proteger

**Qué pasa.** Desde #314, las dos mitades que compara el vigilante del guion 37 salen de la MISMA
expresión: `__nefan.dialogue().visible` es `dialoguePanel.isVisible` (`main.ts:1270`) y
`__nefan.state().dialogueActive` es `dialogoAbierto()`, que es `() => dialoguePanel.isVisible`
(`main.ts:515`, `:1193`). Compara un booleano consigo mismo por dos caminos de una línea. Sus otros
asertos: el del movimiento el propio guion confiesa que sobrevive sin gate (lo suprime también el
bucle), y el del cierre en el mismo turno es la misma tautología.

**Medido, no deducido.** Neutralizando el gate del proveedor —que es exactamente la regresión que
#314 y su regla de `arch-rules` dicen vigilar— el guion 37 sale **verde entero**:

```
✔ abrir el diálogo pone el panel Y el gate del input, no uno solo (#311)
✔ …y con la conversación delante el jugador NO se mueve al mantener W
✔ cerrar el diálogo suelta el panel Y el gate en el mismo turno (#311)
✔ el vigilante ha visto la conversación abierta de verdad
✔ en NINGÚN fotograma el panel y el gate del input discreparon (#311)
```

**Por qué importa.** El `why` de la regla nueva dice, con razón, que `tsc` no impide re-declarar el
campo y que por eso hace falta el checker. Pero el checker es una regla de TEXTO sobre un nombre
(M1), así que entre el tipo y el checker quedaba un hueco: una copia con otro nombre. Y lo único que
podía cerrarlo —un guion que mida el EFECTO— estaba, desde este mismo PR, incapacitado. El PR editó
la prosa de 37 para decir que «lo que afirma es que el par que ve el JUGADOR no diverge», y eso ya
no es cierto: afirma que `dialoguePanel.isVisible === dialoguePanel.isVisible`.

**Ya está cerrado por mí**, que es la parte de esto que sí me toca: `qa/guiones/43-hablando-el-teclado-de-juego-no-responde.mjs`
(§7). Lo que queda para el ingeniero es decidir qué hacer con 37: o se le quita el vigilante
tautológico y su prosa, o se queda como está y su cabecera dice la verdad («esto ya no mide el
gate; lo mide el 43»). **No lo he tocado: reporto.**

### I2 · IMPORTANTE — #316 cierra el criterio, no el objetivo; y el cruce que queda se mudó al fichero peor medido

El criterio 6 está escrito con una sonda concreta y esa sonda sale roja. El **objetivo** que el
usuario escribió al reencuadrar el issue era otro: «hacer inexpresable el cableado equivocado». No
lo es. Cuatro sondas mías sobre la rama, `tsc --noEmit` en los dos proyectos:

| Sonda | Resultado |
|---|---|
| `style: (s, f) => s.style(f.combatSystem)` — el escalar suelto | **ROJO** `TS2345` ✔ |
| `style: (s, f) => s.style({ styleId: f.combatSystem })` — el `Pick` a mano con el campo equivocado | **VERDE**, cero errores |
| `combat: (s, f) => s.combat({ combatSystem: f.styleId })` — la dirección contraria | **VERDE** |
| `renderModes: (s, f) => s.renderModes({ renderMode: f.characterMode, characterMode: f.renderMode })` | **VERDE** |
| `renderModes: ({ renderMode, characterMode }) => applyRenderModes(characterMode, renderMode)` en `main.ts` | **VERDE** |

**Mi juicio, y difiere del que se me pidió que valorase.** Las tres primeras verdes NO me preocupan:
las ocho entradas del record tienen hoy la forma idéntica `(s, f) => s.X(f)`, así que construir el
`Pick` a mano es escribir una línea que no se parece a sus siete hermanas — es un acto deliberado y
visible en el diff, no el resbalón de un identificador. Eso es real y es lo que #316 compró: la
clase de error que de verdad ocurre (cambiar `f.styleId` por `f.combatSystem` de un tirón, un solo
token) ya no compila.

**La quinta sí me preocupa, y es la que nadie midió.** `applyRenderModes(renderMode: string,
characterMode = "")` recibe dos `string` posicionales, y cruzarlos en el sink de `main.ts` compila
verde y **no se parece a un error**: es la forma canónica del bug de orden de argumentos. Antes de
esta PR ese cruce era posible en DOS sitios (el aplicador en core y el sink en el cliente); ahora es
posible en UNO. O sea que la PR **mejora** la situación y no la empeora — pero el sitio que queda es
`nefan-html/src/main.ts`, que no tiene harness (#241), no entra en mutación y no lo mira ningún
test; y lo que ese sink alimenta son los gates de generación de imagen, que es el vecindario del
bug #249 que el módulo entero existe para evitar. Si `renderModes` recibiera un tipo con dos campos
distinguibles (o dos argumentos nombrados), el último cruce del mismo tipo desaparecería del repo.

**No es bloqueante y no es una regresión: es un issue nuevo**, y con el material para escribirlo
arriba.

### I3 · IMPORTANTE — #313 saca `status-labels` del conjunto medible en local

`status-labels.ts` absorbió el reparto y pasa de **116 mutantes** (los de `mutacion-huella.json`,
`run 33191631830`) a **133** (medida del ingeniero). `tope_local` es **120**. En cuanto una corrida
autorizada actualice la huella, `npm run mutacion -- local status-labels` se **negará**, y el módulo
pasa a depender de una autorización por Actions para cerrar su bucle. El ingeniero lo detectó, lo
escribió y **no tocó el umbral**, que es lo correcto — subir un umbral para que quepa lo que uno
acaba de engordar es la trampa que describe `feedback_metricas_son_sintomas`. Queda como decisión
del usuario: subir el tope, trocear el módulo, o aceptar que se pida.

De paso: el `_comment` de `mutation-targets.json` sigue enumerando «status-labels 100» entre los
módulos baratos. Ya estaba obsoleto antes (la huella decía 116), y esta tanda lo deja a 33 de
distancia. Nadie lo canda.

### M1 · menor — la regla nueva de `arch-rules` es por NOMBRE

`\bdialogueActive\b` sobre `nefan-html/src/input/**`. Medido: re-declarar el campo con ese nombre la
pone roja; declararlo como `dialogoActivo` la deja verde. La regla lo dice en su `why` («cubre la
REAPARICIÓN»), así que no es una promesa incumplida — pero conviene tenerlo escrito, porque el
argumento de la crítica («quien prohíbe el sexto espejo es el TIPO, y el checker cubre lo que el
tipo no puede») sólo se sostiene para ese nombre exacto. Lo que cubre el caso general es el guion 43.

### M2 · menor — con la tarjeta de B delante ya no se miente… pero tampoco se dice nada

#313 quitó la señal falsa y no dejó ninguna verdadera. Mirando la captura como jugador: la tarjeta
de Miravanda muestra el chip «Mundo ✓» **mientras se está regenerando** (el chip sale de
`selectedGame.generation`, que solo se refresca en `ready`/`error`), y las demás tarjetas no dicen
nada. Un jugador que lanza la generación de A —que en el juego de verdad son minutos— y se pone a
mirar B no tiene ni un píxel que le diga que A sigue trabajando; y si mira la tarjeta de A, el chip
le dice ✓ con datos rancios. No es criterio de esta tanda y no lo he tratado como fallo, pero es
la mitad que falta del arreglo: un chip «⚙ generando» por tarjeta lo cerraría.

### M3 · menor — se puede encolar una segunda generación del mismo mundo

`refreshGenPanel()` hace `genWorldBtn.disabled = false` incondicionalmente, así que basta cambiar de
tarjeta y volver para tener el botón vivo con A todavía generando (medido: `btn: "↻ Regenerar
mundo [ON]"` a mitad de la generación de A). Es **preexistente** —lo señalaba la propia
`critica.md`— y lo he verificado tal cual sigue. En el bench cuesta segundos; con el motor de verdad
cuesta minutos de trabajo del motor.

### M4 · menor — la captura del guion 38 no enseña su sujeto

`38-…-01-la-pre-generacion-tras-haber-jugado.png` sale el HOME del título con «Cargando saves desde
el bridge…»: se dispara después de que `regenerarMundo` vuelva al home. El guion mide bien y la
captura no enseña nada de lo que mide, justo en el issue cuyo síntoma es *una línea de texto bajo
una tarjeta*. Dos `ctx.shot` dentro del bloque 2 (con B delante y con A delante) serían la evidencia
que un humano mira.

### M5 · menor — hablando, el HUD sigue ofreciendo las teclas 1..5

En la captura del guion 43 se ve el panel con «**1** Seguir preguntando · **2** Despedirse» y, tres
centímetros más abajo, la barra de ataques con «**1** Quick · **2** Heavy · **3** Medium …» pintada
igual que siempre. El gate funciona (nada se filtra, medido), pero la pantalla ofrece dos
significados simultáneos para las mismas teclas y no atenúa ninguno. Fricción de interfaz, del
vecindario exacto de #314.

### M6 · menor — el verbo nuevo tiene dos implementaciones que nada obliga a coincidir

`difundirDeJuego` vive tres veces: la firma de `BridgeContext`, la implementación real de
`ws-server.ts` (que no sella) y el doble de `test/helpers.ts` (que tampoco). Nada canda que el doble
siga haciendo lo mismo que el real, y el único candado del comportamiento real —«ninguno trae
sello»— es el guion 38, que cuesta 90 s de navegador. `test/game-gen.test.ts` no se tocó y no afirma
ni el `gameId` ni la ausencia de sello, siendo el sitio barato para hacerlo. No es nuevo en su clase
(`broadcastNarrative` y `enviarNarrativo` ya vivían así), pero es el mismo patrón de espejo que esta
tanda ha venido a quitar, y merece una línea en el issue de seguimiento.

### Crítica visual — qué juzgo mirando, y qué es artefacto de banco

Capturas revisadas: la del título con B delante (§2a), las dos del guion 43 y la del guion 38.
Copiadas a `qa/capturas/manual-2026-08-30-espejos/`.

- **El título aguanta bien la mirada.** Las cuatro tarjetas con portada, chip de estado y descripción
  componen; el panel de generación a la derecha tiene jerarquía clara (estado → botones → progreso) y
  la línea de progreso ocupa su sitio incluso vacía, así que su aparición no desplaza nada. Lo que
  falta es información, no composición: M2.
- **La pantalla de diálogo tiene el conflicto de M5** y se ve de un vistazo: dos filas de teclas
  numeradas activas a la vez, con significados distintos, sin que ninguna se atenúe.
- **Artefactos de banco, NO defectos**: el damero negro de las paredes de la taberna (atlas del
  fake-ai-server), el maniquí cian del NPC y su retrato (skins falsos), y la columna de trazas de dev
  a la izquierda. Nada de eso se juzga aquí: con el motor de verdad son la superficie pintada y el
  skin del personaje.

### Ajenos, vistos de paso (NO de esta tanda, no cuentan en el veredicto)

- Un `style_id` inexistente en un `game.json` **no falla al cargar el juego**: el selector cae en
  silencio a otro estilo (visto durante la inyección de fallo — la tarjeta de Valdesombra pasó a
  decir «Estilo Acuarela luminosa» sin una sola queja). El fallo solo aparece al generar. Huele a
  #306 / fail-loud.
- El texto de error que lee el jugador es una ruta absoluta del sistema de ficheros
  («…/nefan-core/data/styles/estilo_que_no_existe/style.json»). Es #306.
- `./start.sh --parar` etiqueta `:9878` como «AJENO, no se toca» siendo del MISMO proceso que
  `:9877`, que sí para (y por tanto se lo lleva igual). El mensaje miente sobre lo que va a hacer.

---

## 6 · Workarounds usados, y por qué no son hallazgos

Regla del workaround: cada apaño se declara y se justifica, o se reporta.

1. **`TILE_DELAY_MS=900` en el fake-ai-server.** Con el motor falso a pelo, una pre-generación
   entera dura **156 ms** (medido: `generating` → `ready` en la primera corrida), así que la ventana
   A/B no la alcanza ninguna mano. `TILE_DELAY_MS` es una variable que el propio banco ofrece y
   documenta como *«retardo por tile (simula el motor real)»*. **No oculta ningún obstáculo del
   jugador: lo contrario.** En el juego de verdad esa ventana son minutos, así que 8 s se parecen
   más al caso real que 156 ms. No es hallazgo.
2. **Inyección de fallo en el BORDE para el caso (c).** `style_id: "estilo_que_no_existe"` escrito
   en el `game.json` del **games efímero de la corrida** (`qa/.tmp/<run>/games/…`), no en
   `data/games`. Es la misma técnica que ya usan los guiones 24 y 26 («el fallo se inyecta en el
   BORDE, no dentro del cliente») y produce el `phase:"error"` REAL de `runGameGeneration`, no uno
   inventado. Restaurado al terminar; `git status` limpio. No es hallazgo.
3. **Tres clicks encadenados desde `evaluate` (`element.click()`).** Solo para el caso (c), donde el
   error llega 26 ms después de confirmar y las ida-y-vuelta del navegador tardan segundos. Es el
   MISMO listener y el mismo camino que el click del jugador (los handlers de tarjeta y de botón son
   `addEventListener('click')` sin `isTrusted`); lo único que cambia es la precisión temporal. Los
   casos (a) y (b) van con clicks reales de Playwright de principio a fin. No es hallazgo.
4. **`__nefan.setPlayerPos` para plantar al jugador junto al NPC** en el guion 43. Es el
   teletransporte de bench que ya usan los guiones 32 y 37 para tener un punto de partida
   determinista; el jugador puede llegar andando, así que no se está saltando ningún obstáculo suyo.
   Sí es hallazgo de guion, y lo he escrito dentro: hay que **re-plantar en cada vuelta**, porque el
   NPC tiene vida ambiental y se va — mi primera `E` a mano cayó fuera de rango.
5. **Sabotajes temporales del código de producción** para las pruebas en negativo de §4. Cinco
   ficheros, uno cada vez, restaurados desde copia y verificados con `git status` (limpio). Ninguno
   commiteado. No he arreglado nada: los tres sabotajes que revelaron algo están reportados arriba
   como hallazgos, no aplicados.

**Lo que NO hizo falta**, y merece decirse porque era el riesgo: no tuve que ocultar ningún overlay,
ni forzar estado del cliente, ni saltarme una pantalla para llegar al síntoma de #313. Se llega en
cuatro clicks desde el título.

Sobre el bloque 2 nuevo del guion 38, que se me pidió mirar en concreto: **el mensaje que inyecta es
una forma que el bridge produce de verdad.** Entra por `ws.onmessage`, que es el ÚNICO punto de
entrada de producción (`bridge-client.ts:125`), y su JSON es el de la rama de error de
`handleGenerateGame` (`{type, phase, kind:"game_gen", gameId, message}`, sin `elapsedMs`). La única
diferencia con un frame real es que `runGameGeneration` sí pone `elapsedMs` en los de `progress`;
como es opcional y solo alimenta el sufijo « · 0 min», no cambia lo que el bloque mide. Y el bloque 3
del mismo guion afirma lo mismo sobre los frames **reales** del cable, así que el guion no descansa
sobre la forma inyectada.

---

## 7 · Guion sembrado

`qa/guiones/43-hablando-el-teclado-de-juego-no-responde.mjs` — lo mecánico de #314 que no estaba
cubierto, y la respuesta al hallazgo I1.

Mide, con el proveedor de TECLADO (sin `?input=scripted`, que no lee el gate) y con teclas reales:

- **lo que suprime SOLO el gate del proveedor**: la selección de ataque con `1..N`
  (`selectAttack` la hace el proveedor en su `keydown` y el bucle no la mira nunca);
- **lo que suprime SOLO `dev-tools-input.ts`** —el fichero al que #314 le quitó `DevToolsDeps`—: la
  tecla dev `B`, que el bucle consume ANTES del `if (dialoguePanel.isVisible)`. (`G` no se pulsa: en
  el juego de verdad pide el atlas y GASTA.)
- **el riesgo 2 del plan**, que no ejercía ningún guion: elegir la opción «**1**» con el teclado
  cierra el panel EN EL MISMO EVENTO, y esa tecla no puede acabar en el selector de ataque del HUD.
- Y, dicho dentro del guion para que no se lea de más, **lo que NO aísla**: el giro por flechas está
  gateado dos veces (`applyTurnKeys` vive dentro del `if (!dialoguePanel.isVisible)` del bucle), así
  que ese aserto es el hecho del jugador y no una medida del gate. Con el sabotaje sale verde, y el
  guion lo declara.

Cada aserto tiene su CONTROL sin diálogo delante: si las teclas no hicieran efecto estando libre, el
«no hicieron efecto hablando» sería el mismo verde.

**Probado en negativo** (§4): con los dos gates neutralizados salen rojos tres asertos —

```
✘ con la conversación delante, la tecla 5 NO cambia el ataque del HUD — precise (esperado medium)
✘ con la conversación delante, la tecla dev B NO cicla la vista de debug — off → collision
✘ …y esa misma «1» NO se filtra al selector de ataque del HUD (riesgo 2 de #314) — precise (esperado medium)
```

— y restaurado, verde. En la misma corrida, el guion 37 salió verde entero con el mismo sabotaje.

---

## 8 · Verificación de herramientas

| | |
|---|---|
| `npm run deuda` (nefan-core) | `66 items` · `Fronteras — deuda congelada · 15` — la línea base, sin mover |
| `npm test` (fronteras) | `pass 47 · fail 0`; con la regla nueva rota a mano, `pass 46 · fail 1` |
| `npm run verify` (nefan-core) | `tests 1645 · suites 297 · pass 1645 · fail 0` |
| `npx tsc --noEmit` (nefan-core y nefan-html) | `exit 0` en los dos, sobre el árbol de la rama (medido además en cada restauración de las sondas) |
| `npx eslint src --max-warnings=0` (nefan-html) | `exit 0` |
| Batería de guiones (`node qa/run.mjs`, corrida completa) | **`42 en verde · 0 en rojo de 42`** — con el guion 43 nuevo dentro, y con los dos intermitentes declarados (34 y 22) en verde en esta corrida |

---

## 9 · No probado

- **CI.** No hay PR abierta, así que no hay corrida del runner. Verde en local no es verde: lo dice
  CLAUDE.md y no lo suplo yo. **Queda pendiente del coordinador.**
- **`replay-web` sobre una película grabada ANTES de esta PR** (riesgo 4 del plan). No lo he
  ejercido —hace falta una película con pre-generación dentro— pero confirmo el mecanismo por
  lectura: `labs/narrative/replay-server.mjs:180` (`sellarComoDeEstaReproduccion`) estampa
  `sessionId` en **todo** frame de la timeline, así que un `game_gen` viejo (sin `gameId`) ya no cae
  en la rama del título sino en `esMio(sessionId)` —y el sello que le pone es justo el de la sesión
  servida—, con lo que se entrega al canal de la PARTIDA en vez de a la barra del título. Es banco y
  no juego, y en pre-producción una película vieja no se conserva; lo dejo dicho, no arreglado.
- **Gasto real de créditos.** Nada de esta tanda lo necesita y no se ha ejercido ninguna ruta de
  pago: guardarraíl del runner en verde en las seis corridas y `gasto sesión 0,00 € · total 0,00 €`
  en la barra de dev de todas las capturas.
- **Mutación autorizada.** `npm run mutacion -- local` lo corrió el ingeniero (session-facets 35/0,
  status-labels 133/0); no lo repito porque el segundo ya roza el `tope_local` (I3) y pedir una
  corrida de Actions no es mío.
- **El juego con el motor narrativo de verdad** (`play` / `story-web-sin-imagenes`). Fuera de
  alcance por la restricción de cero créditos; el camino que ejerzo es idéntico salvo el backend.

---

## 10 · Veredicto

**APTO CON RESERVAS.**

Los siete criterios se cumplen y ninguno nace verde. El único síntoma que nota un jugador —#313—
está arreglado y lo he visto arreglado en el juego real desde el arranque, en tres estados distintos
del sistema, con el candado del guion 38 puesto rojo dos veces para demostrar que mide.

Las reservas, por orden:

1. **I1 es lo que hay que decidir antes de dar la tanda por cerrada**: el guion 37 salió verde con
   el gate del diálogo completamente roto, y este PR reescribió su prosa afirmando lo contrario. Lo
   he cubierto sembrando el guion 43, así que la cobertura ya no falta; lo que queda es que el
   ingeniero corrija la cabecera de 37 (o le quite el vigilante tautológico), porque una prosa que
   promete lo que no mide es peor que no tenerla.
2. **I2 e I3 no bloquean nada y son issues**: el último cruce de campos del mismo tipo vive ahora en
   `main.ts`, el fichero peor medido del repo; y `status-labels` sale del conjunto medible en local
   a partir de la próxima huella.
3. Los seis menores son fricción y prosa, no corrección.

**No he arreglado nada.** Los cinco ficheros que rompí a propósito para probar en negativo están
restaurados; lo único que dejo en el árbol es el guion nuevo y este informe.
