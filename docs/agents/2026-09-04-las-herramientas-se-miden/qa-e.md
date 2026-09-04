# QA-E · PR-E «el reloj»: la corrida se parte en lotes

Worktree desprendido `/home/al/code/ne-fan/.claude/worktrees/qa-t10-e`, sobre `dffd3c4`
(«La corrida se parte en lotes por el reloj medido, y un lote muerto no puede declararla
completa»). Sin mutación de ninguna clase, sin `traer`, sin puertos, cero créditos.

El punto de vista es el de quien **opera** el ciclo: el ingeniero que pide una corrida y el
coordinador que la reparte. Y el sujeto es la herramienta que dice si todo lo demás está medido,
así que la pregunta que gobierna el informe no es «¿funciona?» sino **«¿puede quedarse más
permisiva sin que se note?»**.

---

## 1 · Criterios, uno a uno

### 1.1 · El invariante central: `modulos_pedidos` sale del PLAN

| Ataque | Resultado | `mueve_tag` | Evidencia |
|---|---|---|---|
| Los dos lotes vivos | COMPLETA | `true` | guion §VIGENTE / ensayo 1 |
| **Un lote muerto** (no sube nada) | ✅ INCOMPLETA, `⚠ 1 lote(s) SIN NOTICIAS` | `false`, exit 1 | verbo real, ensayo 2 |
| **Dos lotes muertos** | ✅ INCOMPLETA, nombra los dos | `false` | `fusionaCorrida` sintética [16] |
| **Todos los lotes muertos** | ✅ INCOMPLETA, 0 informes de 3 pedidos | `false` | [17] |
| Un lote sube un **artefacto vacío** (dir sin `corrida.json`) | ✅ se avisa, se ignora, cuenta como sin informe | `false`, exit 1 | ensayo 3 |
| Un lote sube un parcial **con `informes: []`** | ✅ no aporta nada, INCOMPLETA | `false` | [18] |
| **Plan ausente** | ✅ se niega citando el motivo | no se escribe la salida | ensayo 4 |
| Plan **JSON corrupto** (`{`) | ⚠️ `SyntaxError`, exit 1 | no se escribe | ensayo 8 |
| Plan **`{}`** | ⚠️ `TypeError: plan.lotes is not iterable`, exit 1 | no se escribe | ensayo 9 |
| Parcial con otro `sha` / `desde` / `origen` / `run_id` | ✅ lanza, con el mensaje escrito | — | [19]–[22] |
| Un módulo en **dos lotes** del plan | ✅ lanza | — | [23] |
| Informe de un módulo **fuera del plan** | ✅ lanza | — | [24] |
| **Dos parciales con el mismo módulo** | ✅ lanza | — | [25] |
| Informe **tocado dentro de un lote** | ✅ se niega antes de mezclar (sello #420) | — | ensayo 5 |
| **`fail-fast` reactivado** (`false` → `true`) | ✅ lo caza el guion de cableado (exit 1, «VERDE-FALSO») | y aun reactivado, los pedidos vienen del plan ⇒ INCOMPLETA | sonda G |
| Un lote sube el informe de **otro lote**, y el otro muere | ⚠️ se acepta; COMPLETA | `true` | [29]/[30] · **H7** |
| **Plan manipulado**: un lote fuera de `modulos_pedidos` | ❌ COMPLETA **y mueve el tag** | **`true`**, exit 0 | ensayo 6 · **H3** |
| **Plan manipulado**: `modulos_pedidos: []`, cero informes | ❌ COMPLETA **y mueve el tag** | **`true`**, exit 0 | ensayo 7 · **H3** |

**Veredicto del criterio: ✅ cumple para todo lo que puede pasarle a un LOTE, ❌ no cumple
para lo que puede pasarle al PLAN.** El diseño es correcto y está bien defendido por el lado que
la PR fue a arreglar: ningún lote, muerto, vacío, repetido, ajeno o suplantado consigue mover el
tag. Lo que queda abierto está un nivel más arriba —§H3—: `modulos_pedidos` sale del plan, sí,
pero el plan es **lo único que llega a la fusión sin sello y sin validar**.

Evidencia del caso central, con el verbo real:

```
$ npm run --silent mutacion -- fusionar --entrada reports/qa-lotes    # el lote 2 no subió nada
Corrida 424242 sobre SHA-DE- (rango), 2 lote(s)
  1 informe(s) de 2 pedido(s)
  INCOMPLETA — la corrida pidió 2 módulos y 1 no dejaron informe (apuntado)
  ⚠ 1 lote(s) SIN NOTICIAS: 2 (apuntado)
GITHUB_OUTPUT → completa=false / mueve_tag=false          exit=1
```

Y visto ROJO por mi cuenta: sustituyendo `modulos_pedidos: [...plan.modulos_pedidos].sort()` por
`[...new Set(informes.map((i) => i.modulo))].sort()`, mi guion cae en
`fusión · UN LOTE MUERTO deja la corrida INCOMPLETA y el tag QUIETO` (negativo 4).

### 1.2 · Los candados, rojos

| Criterio | Estado | Evidencia |
|---|---|---|
| `qa/mutacion-candados-en-negativo.mjs` → 41/41 | ✅ cumple | `41 · 41 rojos · 0 no se enteran · exit 0` |
| `qa/mutacion-cableado-en-negativo.mjs` → 12/12 | ✅ cumple | `12 · 11 rojos + 1 «no se enteran» solo al pre-romper; limpio: 12/12, exit 0` |
| Muestra rehecha a mano | ✅ cumple | el candado de `fail-fast` se ve rojo con `false → true`, no solo con el borrado (sonda G) |
| **¿Hay invariantes declarados que NADIE caza?** | ❌ **sí, seis** | §H1, H2, H4, H5, H6 y §1.3 · guion `qa/mutacion-reparto-en-lotes.mjs`, grupo ABIERTO: **9 de 9 sin candado** |

El dato que me diste —«se le coló un verde que no comprobaba nada en `cola`»— resultó ser el hilo
correcto: **hay otro de la misma forma exacta, y en la función hermana** (§H1).

### 1.3 · El reparto en lotes

| Criterio | Estado | Evidencia |
|---|---|---|
| Dos corridas del mismo plan dan el MISMO reparto | ✅ cumple | `lotes --todos` dos veces → `diff` vacío; y `--ids "hostiles apuntado blueprint-derive"` vs. el orden inverso → idéntico |
| Los módulos sin medida van SOLOS | ✅ cumple en el código | 17 lotes de un módulo (7…23) |
| …y hay quien lo compruebe | ❌ **NO** | §H1 |
| `medido` distingue «no cuesta nada» de «nadie sabe lo que cuesta» | ✅ cumple | `empaqueta([{cero,0},{nadie}])` → `{segundos:0, medido:true}` vs `{segundos:0, medido:false}` [4]; y el test 748 lo afirma |
| Ningún lote de VARIOS puede pasar de `tope_lote` | ✅ cumple | 200 módulos aleatorios: 0 lotes multi por encima; y relajar `<= tope` a `<= tope*2` pone la batería en 2 fallos (sonda A) |
| Un módulo que SOLO pasa del tope va solo, con margen negativo | ✅ cumple | `empaqueta([{gordo,5000},{b,10}])` → lote 1 `{modulos:[gordo], margen:-3200}` [1] |
| Todos sin medida | ✅ cumple | 3 módulos → 3 lotes [2] |
| Totalidad: cada pedido en exactamente un lote | ✅ cumple | 200/200 colocados, 0 duplicados, numeración 1..N sin huecos [10]-[12] |
| Segundos **negativos** | ⚠️ pasan como descuento | `{neg:-1000}` se empaqueta con `{x:1700}` y el lote suma 700 [3] · **H10** |
| Segundos **NaN / Infinity** | ⚠️ el lote sale `medido:true` con `segundos: NaN` y margen `NaN` | [5][6] · **H10** |
| Ids duplicados en la entrada | ⚠️ se aceptan y van al MISMO lote | `lotes --ids "hostiles hostiles"` → `lote 1 4s … hostiles hostiles` · **H9** |

El reparto de hoy reproduce el del informe del ingeniero al carácter (23 lotes, 41 módulos, seis
medidos y 17 solos; `blueprint-derive` a 153 s del tope). Y confirma una promesa concreta del
plan: **`contrato-escena` ya no puede quedarse el último de una cola de 41** — está en el lote 11,
solo.

### 1.4 · La siembra de los 52 tiempos

Ésta la he verificado **contra el log real de CI**, no contra el informe.

| Criterio | Estado | Evidencia |
|---|---|---|
| 52 filas estrenan `segundos` | ✅ cumple | 64 ficheros en la huella, 52 con `segundos` |
| Solo filas con sha `e67ae4d` | ✅ cumple | `Counter({e67ae4d…: 52})`; las 11 sin sembrar son de `81a7ce0` (7) y `7b817b9` (4) |
| Ninguna fila cambió nada más | ✅ cumple | comparación semántica contra `HEAD~1`: **0 filas** con cambios fuera de `segundos` |
| Los números son los de la corrida `33866958770` | ✅ cumple | `gh run view 33866958770 --log` (21.323 líneas) → 25 `Done in`, suma **10.174 s**, que es exactamente la cifra del plan. De los 24 módulos sembrados, **24 coinciden con el log y 0 discrepan** |
| `status-labels` NO se sembró | ✅ cumple | midió 27 s en el log; no hay módulo `status-labels` en el plan de hoy (`status-rotulo`, `status-motivo`); su fila `src/protocol/status-labels.ts` es la única con sha `e67ae4d` **sin** `segundos` |
| El 25.º módulo del log | ✅ coherente | `contrato-escena` arrancó y **nunca imprimió `Done in`**: es el que se comió el timeout, y no se sembró |
| La procedencia está escrita | ✅ cumple | el `_comment` de la huella cita la corrida (`33866958770`), el sha (`e67ae4d`), la fecha (`2026-09-04`), **que salió del log porque el campo no existía**, por qué el día malo y no la media, y la decisión de `status-labels` con su motivo |

Las dos decisiones declaradas son **ciertas y están escritas donde tienen que estar**. Es el
criterio mejor cumplido de la PR y contrasta con la deuda que la tanda lleva pagando dos veces
(«copiar el número del issue bajo el rótulo medido»): aquí el número se puede volver a derivar
del log en una orden.

### 1.5 · Umbrales y verificación declarada

| Criterio | Estado | Evidencia |
|---|---|---|
| `npm run verify` verde | ✅ cumple | `tests 2023 · suites 368 · pass 2023 · fail 0` |
| CRAP y cobertura dentro de tope | ✅ cumple | `CRAP ≤ 73 — 0 por encima · Cobertura 89.2% ≥ 89% · ✔` |
| Ningún umbral subido | ✅ cumple | `tope_local` sigue en 120; el diff de `mutation-targets.json` es **una línea**: `"tope_lote": 1800`. Ningún `break` tocado |
| `tope_lote` es un presupuesto nuevo, no una relajación | ✅ cumple | no existía; y hoy cabe en el `timeout-minutes: 45` del job |
| CLAUDE.md al día | ✅ cumple | los dos verbos nuevos en la tabla + el párrafo de la corrida partida |

---

## 2 · Hallazgos

Todos reproducibles con `node qa/mutacion-reparto-en-lotes.mjs` (grupo ABIERTO), que aplica cada
rotura, corre los checkers y dice quién se entera. Hoy: **9 de 9 sin candado**.

### IMPORTANTE

#### H1 · El lote propio de lo no cronometrado no lo comprueba nadie — y es el mismo verde que ya cazaste una vez

`empaqueta` manda cada módulo sin medida a su propio lote. Es correcto. Pero **ningún test lo
comprueba con más de uno**: las once llamadas a `empaqueta` de la batería pasan como mucho **un**
módulo sin `segundos`, y con uno solo «va solo» y «van todos juntos» son la misma cosa. Es la
forma exacta del verde que el ingeniero cazó en `cola` (mediana con dos jobs), en la función
hermana y en el invariante que hoy gobierna **17 de los 41 módulos**.

Reproducción: en `empaqueta`, después del bucle de `sinMedida`, juntar en uno los lotes con
`medido === false` — **sin tocar ninguna línea que los guiones busquen**:

```
$ node --import tsx --test test/mutacion-huella.test.ts     ℹ pass 118 · fail 0
$ node qa/mutacion-candados-en-negativo.mjs                 exit=0  (41/41)
$ npm run --silent mutacion -- lotes --todos
  7 lote(s) para 41 módulo(s) · tope 1800s (30 min)
  …
  lote  7  SIN MEDIDA DE RELOJ  ai-client apuntado asset-store-contrato consequence-handler
           contrato-escena contrato-sprite-forge entidades-del-tile mirada paso-del-jugador
           render-mode scene-validate serialize-llm speaker-resolve sprite-census status-motivo
           status-rotulo tile-edges
```

Un solo job con los 17 módulos sin cronometrar, `contrato-escena` dentro, contra un
`timeout-minutes: 45`. Es **literalmente el fallo que motivó la PR**, y todo verde.

*Aviso sobre el método*: mi primera versión de esta sonda borraba la línea del `lotes.push`, y el
guion de candados se ponía rojo — pero por su **patrón desaparecido**, no por la conducta. Eso se
lee igual que cazar el fallo sin serlo, así que la sonda del guion preserva los literales.

Qué esperaba quien opera: que la regla que él mismo declara como «la de `permisoLocal`» esté
defendida por un test con dos o más módulos sin medida, y que la totalidad
(`lotes sin medida === módulos sin medida`) sea una aserción y no una lectura a ojo del reparto.

#### H2 · `fusionar` puede dejar de verificar el sello de cada lote sin que nadie se entere

El mensaje de commit dice que «el sello de #420 es lo que hace segura la fusión: `reunir` verifica
cada informe contra el sha256 de SU parcial antes de mezclarlo, así que juntar N artefactos no
reabre el agujero». Esa frase **no la defiende nadie**: el candado del sello
(`sello · el guardia mira el CONTENIDO del informe`) ejerce `repartir` y rompe `selloDeInforme`,
no la llamada dentro de `fusionar`.

Reproducción: `const errores = verificaDescarga(parcial, presentes);` → `const errores: string[] = [];`

```
batería    ℹ pass 118 · fail 0        (baseline: igual)
cableado   exit=0  (12/12)            (baseline: igual)
```

Con eso, un informe suplantado dentro de un lote entra en la fusión, de ahí al artefacto único,
de ahí a `traer`/`repartir` —que sí lo comprobarían contra el manifiesto **fusionado**, que la
propia fusión acaba de fabricar con el sello del suplantado dentro— y de ahí a la huella
commiteada. Es #420 reabierto por la puerta nueva.

#### H3 · El plan es lo único que llega a la fusión sin sello y sin validar, y un plan incoherente MUEVE EL TAG

`fusionar` lee el plan con `JSON.parse(readFileSync(rutaPlan, "utf8")) as PlanDeCorrida`. No hay
schema, no hay sello, y **no hay comprobación de que `modulos_pedidos` contenga lo que los lotes
dicen medir**. Con el verbo real:

```
# el plan pone `apuntado` en el lote 2 pero NO en modulos_pedidos; el lote 2 muere
  1 informe(s) de 1 pedido(s)
  COMPLETA — midió todo lo que el rango seleccionaba y todos dejaron informe
  ⚠ 1 lote(s) SIN NOTICIAS: 2 (apuntado)
    …así que la corrida es INCOMPLETA y el tag no se mueve — que es exactamente lo que tiene que pasar.
GITHUB_OUTPUT → completa=true / mueve_tag=true          exit=0

# el plan llega con modulos_pedidos: [] y NINGÚN lote sube nada
  0 informe(s) de 0 pedido(s)
  COMPLETA — midió todo lo que el rango seleccionaba y todos dejaron informe
GITHUB_OUTPUT → completa=true / mueve_tag=true          exit=0
```

El segundo caso es el peor resultado posible del ciclo: **cero módulos medidos y el tag adelantado
declarándolo todo medido**, que es lo que #418 y #381 llevan dos tandas cerrando.

Dos cosas, y la segunda es visible hoy aunque nadie manipule nada:

1. **La contradicción en la salida.** El mismo párrafo dice `COMPLETA` y «la corrida es INCOMPLETA
   y el tag no se mueve». Quien lea el job se cree la segunda. `lotesSinNoticias` y
   `veredictoDeCorrida` pueden discrepar y nadie los cruza: **un lote sin noticias con veredicto
   COMPLETA es una contradicción por construcción**, y ahí es donde se corta más barato.
2. **La asimetría.** Cada informe de cada lote se comprueba con sha256 antes de mezclarlo; el
   documento del que sale el veredicto entero se lee sin mirar. Un plan corrupto muere (comprobado:
   `SyntaxError` con `{`, `TypeError` con `{}`, los dos con exit 1 y sin escribir la salida) —
   pero uno **bien formado e incoherente** pasa.

Alcance real, para no exagerarlo: hoy el plan lo escribe nuestra propia herramienta y el guion de
cableado sujeta al productor (`lotes · el PLAN lleva TODO lo pedido`, que además es una aserción
**permanente**, no solo una mutación). Esto es defensa en profundidad, no un bug vivo. Pero es la
única pieza sin ella, y es la que sostiene todo lo demás.

### MENOR (pero del mismo aparato)

#### H4 · La cadena del reloj tiene cuatro eslabones y candado en uno

`mutate` cronometra → `manifiesto` lo mete en el informe sellado → `repartir` lo lleva a la huella
→ `segundosDe` lo lee con MÁXIMO. Solo el primero tiene candado
(`reloj · mutate.ts guarda los segundos … y no al final`). Los otros tres se pueden deshacer en
verde:

| Rotura | batería | cableado | Consecuencia |
|---|---|---|---|
| `manifiesto` deja de leer `mutacion-tiempos.json` | 118/0 | 12/12 | los informes viajan sin reloj |
| `repartir` deja de escribir `segundos` en la huella | 2023/0 | 12/12 | la huella no gana el campo nunca ⇒ **41 lotes**, todos solos |
| `segundosDe` suma en vez de coger el máximo | 2023/0 | 12/12 | `blueprint-derive` pasa de 1.647 s a **6.588 s** y va solo con margen −4.788; el reparto entero cambia |

La última es la **decisión (e) que el propio informe declara** («va por fichero pero se lee con
MÁXIMO, sumar cuadruplicaría un módulo de cuatro ficheros»). Está escrita en el tipo, en el
comentario y en el informe; no está en ningún candado. La dirección de fallo es segura (se
sobre-particiona), pero la función se muere en silencio.

#### H5 · La matriz y el YAML pueden dejar de casar, y eso son 23 jobs midiendo los 41 módulos

`lotes` escribe `matriz=[{lote, ids}]` en `GITHUB_OUTPUT` y el workflow lee `matrix.lote` y
`matrix.ids`. **Nada comprueba que esas cuatro palabras sigan siendo las mismas**: renombrarlas a
`{numero, modulos}` deja la batería en 2023/0 y el cableado en 12/12.

Lo que pasaría en CI: `matrix.ids` vacío → `npm run mutate -- $IDS` sin argumentos → y
`aCorrer(plan, [])` devuelve `plan.modulos`, o sea **los 41 módulos en cada uno de los 23 jobs**,
hasta agotar el `timeout-minutes: 45`. Es la misma familia que el `--pedidos ""` que ya costó una
corrida entera y que este guion existe para cazar. Ningún test ni guion mira la salida `matriz`.

#### H6 · `tope_lote` y `timeout-minutes` son dos números en dos ficheros sin nada que los ate

`tope_lote: 1800` (30 min) y `timeout-minutes: 45` solo se sostienen juntos, y el porqué está
escrito dos veces en prosa. Subir `tope_lote` a 3600 deja la batería en 2023/0, el cableado en
12/12, y el reparto imprime tan campante `20 lote(s) … tope 3600s (60 min)`: la mitad de esos
lotes moriría a los 45 minutos. He añadido el candado a mi guion
(`presupuesto · tope_lote cabe en el timeout-minutes del job que lo ejecuta`), visto rojo.

#### H7 · La fusión no sabe de qué lote viene cada parcial

Un parcial (`Corrida`) no lleva su número de lote, así que si un lote sube el informe de un módulo
de otro lote, la fusión lo acepta (está «en algún lote del plan») y `lotesSinNoticias` deja de
nombrar al lote caído: `COMPLETA`, `mueve_tag=true`, y ni un aviso. Con el cableado de hoy no es
alcanzable —los ids vienen de la matriz, del mismo plan— pero es el tercer estado que el propio
diseño presume distinguir («lote medido / a medias / sin noticias») y aquí se pierde.

#### H8..H11 · Fricción del verbo (para quien lo usa a mano)

- **H8** — `lotes --todos --ids "hostiles"` **ignora `--ids` en silencio** y reparte los 41. En
  `mutate.ts` la casa hace lo contrario y lo dice: «dejar que se ignoren en silencio sería medir
  otra cosa de la que se ha pedido y no enterarse» (`--desde`/`--rango` lanzan).
- **H9** — `lotes --ids "hostiles hostiles"` acepta el duplicado y lo mete **dos veces en el mismo
  lote**; `modulos_pedidos` sale con la repetición dentro.
- **H10** — `segundos` no se valida en ninguna parte: negativo actúa de descuento (un `-1000` deja
  meter 1.700 s más en el lote), y `NaN`/`Infinity` producen un lote `medido: true` con
  `segundos: NaN` y margen `NaN` que se imprimiría tal cual. Hoy el campo lo escribe siempre
  `Math.round(r.segundos)`, así que es teórico; la huella se lee con `JSON.parse … as Huella`, sin
  schema (deuda anterior, no de esta PR).
- **H11** — un plan `{}` muere con `TypeError: plan.lotes is not iterable`. Falla fuerte, que es lo
  importante, pero no diagnostica; el plan ausente sí tiene un mensaje ejemplar y éste no.

#### H12 · Ningún guion de negativos corre en CI (deuda anterior, agravada)

`grep` sobre `.github/workflows/` a cero: ni `mutacion-candados-en-negativo.mjs` ni
`mutacion-cableado-en-negativo.mjs` (ni el mío) entran en `ci.yml`. Los cuatro invariantes nuevos
del cableado —`fail-fast: false`, el plan subido ANTES de medir, el cronómetro y el orden de los
pasos— son la **única** defensa de esas piezas, y solo se comprueban cuando alguien se acuerda de
lanzar dos scripts a mano. No es de PR-E (PR-A ya estaba así), pero PR-E aumenta lo que depende de
ello.

---

## 3 · Workarounds usados, y su veredicto

| Workaround | Por qué | Veredicto |
|---|---|---|
| `npm ci` en `nefan-core` **y en `narrative-mcp`** | el worktree venía sin `node_modules` | Montaje, no producto. Igual que hace `ci.yml`, que instala los dos |
| `npm run build` antes de `npm test` | `test/contract-fixtures.test.ts` carga `narrative-mcp/validators.ts` → `@nefan/core` → `dist/` | **No es hallazgo**: `npm run verify` ejecuta `build` antes de `test`, y en verde da 2023/2023. Un `npm test` a secas sobre un checkout limpio falla por esto, y está documentado en `ci.yml` |
| Crear y borrar `nefan-core/reports/` para los ensayos de fusión | `fusionar` y `lotes` escriben ahí; el directorio está gitignorado y no existía | Restaurado: `reports/` borrado al terminar, `git status` limpio |
| Romper fuentes a mano en las sondas | es la única forma de saber si un candado caza algo | Todas restauradas y verificadas con `git diff --quiet`; el guion que dejo lo hace en un `finally` y sale con 2 si algo no volvió |
| `gh run view --log` y `gh api …/jobs` | contrastar la siembra contra el log real y ejercer `cola` | Lecturas. Ni mutación, ni `traer`, ni créditos |

Ningún workaround esconde un obstáculo del operador: el flujo normal (`lotes`, `pendiente`,
`deuda`, `cola`) funciona tal cual y sin preparación.

---

## 4 · Lo que NO he podido probar, y qué haría falta exactamente

Las tres que el ingeniero declara abiertas **siguen abiertas**, y las confirmo. Esto es lo que
cierra cada una:

### 4.1 · El número real de `cola` (y con él, `max-parallel: 6`)

Lo que sí tengo, medido con el verbo y con datos reales — **la línea base de ANTES**:

```
$ npm run --silent mutacion -- cola 33866958770        # la mutación de un solo job
  1 job(s) · espera peor 0,0 min · pared 180,4 min · runner 180,4 min · sobrecoste 0,0 min

$ npm run --silent mutacion -- cola 33884294863        # una PR normal, hoy
  4 job(s) · espera peor 0,0 min (narrative-mcp) · pared 2,7 min · runner 4,3 min · sobrecoste 1,6 min
$ npm run --silent mutacion -- cola 33883940770
  4 job(s) · espera peor 0,0 min (nefan-html) · pared 2,7 min · runner 4,1 min · sobrecoste 1,4 min
```

O sea: **hoy una PR normal son 4 jobs, 0 min de cola y 2,7 min de pared**. Ése es el número contra
el que hay que comparar, y no existía.

Para cerrarlo hacen falta tres cosas y **una corrida en matriz**:

1. Autorizar la corrida (Actions → *Mutation testing* → Run workflow) y anotar su `run-id`.
2. **Mientras corre**, empujar un commit a una PR abierta (o re-lanzar su CI) y anotar el `run-id`
   de ESA corrida. Sin la PR concurrente no hay nada que medir: la pregunta no es cuánto espera la
   matriz, es cuánto espera **quien no la pidió**.
3. `npm run mutacion -- cola <run-de-la-PR>` → `esperaPeor` contra el presupuesto de 120 s (si pasa,
   el verbo ya sale con exit 1 y dice que se baje `max-parallel`), y
   `cola <run-de-la-matriz>` → `sobrecoste`, que son los minutos de runner que se pagan por las
   23 × (checkout + `npm ci` + dry-run).

Aritmética que **no** sustituye a la medida, pero acota la sorpresa: el repo es público y de una
cuenta de usuario; con el tope estándar de jobs simultáneos de la cuenta, `max-parallel: 6` deja
sitio a los 4 jobs de una PR. Es una cuenta, no un dato: hay que medirla.

### 4.2 · El reloj real por lote

Nadie ha visto ejecutarse el `timeout-minutes: 45`. Se cierra leyendo, en la primera corrida en
matriz, el `Done in` de cada lote y comparándolo con la suma que `lotes` presupuestó — con la
lectura concreta de si el factor 1,31 del día malo bastó de margen. Los seis lotes medidos
presupuestan **10.147 s** de los 10.174 que midió la corrida entera (los 27 s que faltan son
`status-labels`, que no se sembró), así que la comparación es directa.

### 4.3 · El viaje de N artefactos con sus N sellos

`reunir` baja 23 artefactos y verifica 23 sellos. Si `upload`/`download` no preservara los bytes,
**saltarían todos a la vez** y la corrida sería pérdida total; no hay forma de saberlo sin
ejecutarla. Lo único que se puede hacer antes es lo que ya está: el fail-loud es correcto y el
mensaje nombra el lote (`el lote informe-mutacion-N no casa con su propio manifiesto`). A vigilar
además en esa primera corrida: el `timeout-minutes: 20` de `reunir` tiene que cubrir bajar,
sellar, copiar y volver a subir el conjunto entero de informes (el artefacto único venía siendo
del orden de decenas de MB).

### 4.4 · Lo demás que no he probado

- **`contrato-escena` deja informe.** Su lote existe (el 11, solo) y ya no puede quedarse el
  último de una cola de 41, pero el arreglo de #418 sigue sin ejercerse en CI.
- **Que la matriz de GitHub construya bien 23 jobs desde `fromJSON`.** El JSON que emite `lotes`
  lo he leído; que Actions lo expanda no lo he ejecutado.
- **Re-lanzar jobs fallidos** sobre una corrida ya subida: `upload-artifact` con un nombre que ya
  existe en el mismo run es un conflicto conocido de la acción. No lo he provocado y no sé si esta
  versión lo tolera; con un solo artefacto el problema era el mismo, así que no es una regresión —
  pero ahora hay 23 nombres en vez de uno.

---

## 5 · Lo que dejo ejecutable

**`qa/mutacion-reparto-en-lotes.mjs`** (+ su sección en `qa/README.md`).

```bash
node qa/mutacion-reparto-en-lotes.mjs                 # ~4 min
node qa/mutacion-reparto-en-lotes.mjs --solo-vigentes # ~20 s
```

- **9 VIGENTES** (hoy verdes, candado de regresión): determinismo del reparto · ningún lote de
  varios por encima de `tope_lote` · cada pedido en exactamente un lote · lo no cronometrado en
  lote propio (con 17, no con uno) · `tope_lote` bajo el `timeout-minutes` del job · un lote muerto
  deja INCOMPLETA con el tag quieto · la fusión se niega sin plan · el sello de #420 dentro de cada
  lote · la procedencia escrita de los 52 relojes.
- **9 ABIERTOS** (hoy rojos): H1, H2, H4×3, H5, H6 y las dos conductas de H3. Cada uno se rompe a
  mano y se declara cazado solo si un checker CAMBIA respecto de su línea base. Se ponen verdes
  solos el día que alguien los tape.

**Probado en negativo**, que es lo único que hace que un guion valga: cinco de los nueve vigentes
se han visto rojos rompiendo a mano lo que dicen defender —`tope_lote` a 3600, `fusionar` sin
exigir el plan, el `_comment` sin la corrida, `modulos_pedidos` derivado de los parciales y los
lotes sin medida agrupados— y en los cinco el guion nombró **la línea correcta**. Y las roturas
del grupo ABIERTO están escritas para **no tocar ningún literal que los otros dos guiones busquen**,
después de descubrir que la primera versión salía «cazada» solo porque hacía desaparecer un patrón.

Árbol limpio al terminar: `git status` → solo `qa/README.md` modificado y
`qa/mutacion-reparto-en-lotes.mjs` nuevo. `npm run verify` sigue en **2023/2023**.

---

## 6 · Veredicto

# APTO CON RESERVAS

**Lo que está bien, y hay que decirlo:** el invariante central se sostiene por el lado que la PR
fue a arreglar. Ataqué el lote muerto por nueve caminos distintos —uno, dos, todos, vacío, sin
manifiesto, de otra corrida, repetido, ajeno, suplantado— y en los nueve la corrida sale
INCOMPLETA y el tag se queda quieto. El reparto es determinista, total, y no deja pasar un lote de
varios por encima del tope. Y la siembra es el trabajo mejor hecho de la tanda: 24 de 24 números
coinciden con el log real de la corrida `33866958770`, ninguna otra fila se tocó, la decisión de
no sembrar `status-labels` es correcta y **la procedencia está escrita donde se lee sola**.

**Por qué reservas.** El sujeto de esta PR es la herramienta que dice si todo lo demás está
medido, y ahí el listón es «candado, no prosa». Mi guion encuentra **nueve invariantes declarados
por escrito que hoy se pueden deshacer sin que nada se ponga rojo**, y dos de ellos son de la
familia que esta casa ya ha pagado:

- **H1** es el mismo verde-que-no-comprueba que el ingeniero se cazó a sí mismo en `cola`, en la
  función hermana, sobre el invariante que gobierna 17 de 41 módulos — y su violación reproduce
  exactamente el fallo que motivó la PR.
- **H2** deja sin defender la frase con la que el propio commit justifica que la fusión sea segura.
- **H3** es el único punto por el que el tag todavía puede moverse mintiendo, y la salida ya hoy
  se contradice cuando ocurre.

**Recomendación al coordinador:**

1. **No bloquea la corrida.** Al contrario: la corrida en matriz es lo único que cierra §4.1-§4.3,
   y cuanto antes se lance antes se curan los 17 lotes sin medida. Lánzala.
2. **H1, H2 y H3 vuelven al mismo ingeniero** antes de dar PR-E por cerrada. Son tres tests y una
   comprobación de coherencia; el más barato de los tres (H3) se cierra con una línea: **un lote
   sin noticias no puede convivir con un veredicto COMPLETA**.
3. **H4-H6 en la misma vuelta si cabe**, porque los tres son «una línea del cableado que se puede
   deshacer en verde» y ya hay un guion que los mide.
4. **H8-H12 a issue**, no a esta PR.
5. Cuando vuelva la corrida: comparar el `Done in` de cada lote con lo presupuestado, correr
   `cola` sobre la matriz **y sobre una PR lanzada mientras corría**, y sembrar los 17 relojes que
   faltan. Con eso `max-parallel: 6` deja de estar puesto a ojo, que era el criterio que marcaste.
