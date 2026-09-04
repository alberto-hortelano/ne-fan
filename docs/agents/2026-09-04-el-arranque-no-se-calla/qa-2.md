# QA-2 — T9 «El arranque no se calla»: PR-3 (#392, ledger) y PR-4 (#393, `--parar`)

Validado en el worktree desprendido `/home/al/code/ne-fan/.claude/worktrees/qa-t9-infra`, sobre
`12695db` (#392) y `40253ed` (#393). **`NEFAN_PORT_OFFSET=300`** en todo lo que abre puertos (0, 100
y 200 estaban ocupados; el 200 por otro agente, vivo durante toda la sesión). **Cero créditos**: no se
llamó a ninguna API de pago, y el guardarraíl es que el único servicio que se levantó fue
`e2e-sin-creditos`.

**El ledger del checkout principal no se tocó**: `cache/spend/events.jsonl` sigue en 187 líneas y
`md5 8ba5d5a91954de667b0995904249ffaf`, el mismo con el que empecé; `archivo/cache/spend/` sigue con
sus dos ficheros (240 + 1189). Todo lo que ejercí lo hice sobre copias en el scratchpad o sobre el
árbol del worktree. **Ningún proceso ajeno murió**: el stack del bloque 200 sobrevivió a las **siete**
corridas de `--parar` de esta sesión (`ss -ltn` idéntico antes y después), y los dos únicos procesos
que maté fuera de mis señuelos fueron dos señuelos míos huérfanos, por su PID.

---

## Criterios — #392 (el ledger de gasto)

| Criterio | | Evidencia |
|---|---|---|
| **Literal**: correr la suite **dos veces** deja el ledger con el mismo número de líneas | ✅ cumple | Sembré `cache/spend/events.jsonl` del worktree con una COPIA del real (187 líneas, `md5 8ba5d5a…`) para que hubiera algo que estropear. **Sin** la variable ×2 → `FAILED (errors=70)` y el ledger en **187 líneas, md5 8ba5d5a…**; **con** la variable ×2 → `Ran 224 tests … OK` y el ledger en **187 líneas, md5 8ba5d5a…**. Cuatro corridas, cero bytes movidos |
| **Literal**: el test que lo afirma existe y **se puso rojo antes** | ✅ cumple | `test_spend_tracker.LedgerRealFueraDeTestTest` (5 casos). Rojo **rehecho por mí**, no creído: borré el bloque `if root.resolve() == RUTA_REAL and "unittest" in sys.modules` → `FAILED (failures=2)` («RuntimeError not raised») y el ledger sembrado pasó de **187 a 230 líneas**. Restaurado con `git checkout`, `git status` limpio |
| La negativa va **en el tipo**: bajo test el ledger real no se puede nombrar | ✅ cumple, con una grieta → **H2** | Los cinco disfraces revientan: sin variable, absoluta, relativa (`cache/spend`, que se resuelve contra la raíz del repo y no contra el cwd), con `..` por en medio (`ai_server/../cache/spend`) y **enlace simbólico**. El mensaje nombra `NEFAN_SPEND_DIR` y trae el remedio con `mktemp` |
| `NEFAN_SPEND_DIR` **puesta pero en blanco** es fail-loud | ✅ cumple | `""`, `"   "` y `"\t"` → `RuntimeError: NEFAN_SPEND_DIR está puesta pero vacía…` |
| Un proceso de **producción** sigue arrancando | ✅ cumple | `import remote_gen_main` (que arrastra fastapi + starlette + httpx + pydantic + numpy + PIL) → OK, `unittest in sys.modules` = **False**, `SPEND.root == RUTA_REAL`. El olfateo, medido y no supuesto |
| El seam es el **runner** y el CI lo pasa | ✅ cumple | `.github/workflows/ci.yml:137`. Y es el ÚNICO sitio del repo que corre la suite (`grep` sobre `*.yml/*.sh/*.mjs/*.md` fuera de `docs/agents/`); la prosa viva que cita el comando (`docs/arquitectura/ia-servicios.md:74`) ya lleva la variable |
| Los 1429 eventos de test salen a `archivo/`, **copia y nunca `rm`** | ✅ cumple | 187 + 240 + 1189 = **1616** = el original. Reproduje el barrido entero sobre una copia: `A ARCHIVAR: 1429 eventos · $731.04 / SE QUEDAN: 187 eventos · $37.54`, cifras idénticas a las del informe |
| **El criterio de selección es seguro** (no barre arte pagado) | ⚠️ **con reserva** → **H1** | Sobre el ledger REAL, `contains` y la igualdad exacta seleccionan **los mismos 1429**: el peligro del lote retirado era hipotético, no real (§«sobre la mutación» abajo). Pero el criterio de la fixture **VIVA** sí barre arte real: de 6 `what` sintéticos construidos con la forma que emite producción, **3 se barren** |
| **Ningún residuo de test se le escapa** | ⚠️ **parcial** | Medido, no deducido: la suite de HOY escribe exactamente **43 eventos, $10,32**, y sus tres `what` son los tres que el criterio cubre. Se le escapan los **4 eventos `x`** ($0,96) que ya estaban declarados y no autorizados |
| La retirada es reproducible e **idempotente** | ✅ cumple, con un roce → **H4** | dry-run: `md5` del ledger idéntico. `--ejecutar`: mueve, y `∪` de ledger+archivo == el original línea a línea. Segunda corrida: `A ARCHIVAR: 0 eventos` |
| La ventana de fechas del lote declarado **se comprueba** | ✅ cumple | Un evento `hero: un herrero` con fecha 2026-09-03 (fuera de 24→31 ago) **para el guion** con salida ≠ 0 |
| Nada roto | ✅ cumple | `npm run verify` en `nefan-core` → **1976 pass / 0 fail**. `ruff check ai_server` → *All checks passed*. `npm run deuda` → **15 fronteras congeladas**, igual que la base |

### Sobre la mutación a `contains` que el ingeniero declara (§3.5)

**El rojo existe y lo rehíce**: cambiando la igualdad exacta del lote retirado por `contains` caen
**5 tests**, entre ellos `test_un_prompt_real_que_lo_contiene_NO_se_selecciona`. Confirmado.

**Pero el número que lo acompaña es de una fixture, no del ledger.** «se llevaba el `hero: un herrero
de la aldea del norte`, que es arte pagado» describe el ledger sintético de su test (7 eventos,
$3,12). Lo medí sobre el ledger REAL de 1616 líneas: con `contains`, el lote retirado selecciona
**exactamente los mismos 1429 eventos** — **$0,00 de arte real en juego**. La decisión sigue siendo la
correcta (es la que hay que tomar sin saber qué habrá mañana en el ledger), pero conviene que quede
escrito que en esta retirada concreta no había nada que salvar; el informe se puede leer al revés.

---

## Criterios — #393 (`--parar`)

| Criterio | | Evidencia |
|---|---|---|
| **Literal**: tras `--parar`, **ningún puerto propio sale como ajeno** | ✅ cumple | Mi guion, con los **nueve** puertos del bloque ocupados: 7 propios repartidos en 4 procesos (3 de ellos con dos puertos) por las **tres** vías de `worktree_de_pids` — cwd en la raíz, cwd en un subdirectorio, y cwd fuera con la ruta del proyecto en los ARGUMENTOS — → **0 líneas AJENO** sobre puertos propios, los 4 procesos muertos y los 7 puertos libres |
| …y en el **flujo real**, no solo con señuelos | ✅ cumple | `./start.sh --preset e2e-sin-creditos` a offset 300 y `./start.sh --parar`: `· :10177 :10178  …/node` — el bridge y la State API, un proceso y dos puertos, en **una** línea y clasificados propios. Mis 4 puertos abajo |
| **Literal**: el informe **no se parte** con la salida de `fuser` | ✅ cumple | `cat -A` sobre dos informes reales: ninguna línea empieza por dígito. **Rojo rehecho** con `start.sh` de `fe0b245`: 4 líneas con el pid pegado delante (`152725    ⏭  :10178  (desconocido)  — AJENO…`) |
| Lo ajeno se **enumera** y **no se toca** | ✅ cumple, salvo la carrera → **H5** | Señuelo ajeno por `cwd=/tmp` (dos puertos) y otro por `cwd=$HOME`: los dos **sobreviven** y salen `⏭ … AJENO, no se toca`, agrupados. El stack REAL de otro agente (`:10077 :10078`, `:3200`, `:18965`) intacto tras siete `--parar` |
| El aviso de `--parar-todo` deja de salir **por un fantasma** | ✅ el fantasma; ⚠️ la consecuencia → **H3** | Con `fe0b245` el fantasma es visible (`:10178`, `:9065`, `:9068` clasificados de otro); con el arreglo desaparece. Pero en esta máquina el aviso **siguió saliendo en las 7 corridas**, porque hay ajenos de verdad — y apunta a un comando que solo barre el bloque vigente |
| La prosa deja de mentir | ✅ cumple | `grep -c "STARTED_PORTS" CLAUDE.md` → **0**; `grep -c "∪" CLAUDE.md` → **0**. Las menciones que quedan en `start.sh` (`:114`, `:120`, `:186`, `:234`, `:1282`, `:1408`) son ciertas: describen `cleanup`, o dicen expresamente que `cmd_stop` no lo consulta |
| El candado **se vio rojo** | ✅ cumple | Rehecho con `start.sh` de `fe0b245`: `qa/no-mata-lo-ajeno.mjs` → **3 rojos** de los suyos; mi guion → **8 rojos**. Uno de los cuatro asertos del ingeniero (el del aviso) **no se pudo evaluar** en mi entorno → **H6** |
| Nada roto | ✅ cumple | `npm run verify` → **1976 pass / 0 fail** en la rama de #393 |

---

## Hallazgos

### H1 · IMPORTANTE — el criterio de la fixture VIVA barre arte real, y no tiene ventana

`es_de_test` compara el lote **retirado** por igualdad exacta (bien, y con un test que lo defiende)
pero el lote **vivo** por `contains`, y **sin** comprobación de fechas. `un herrero de pelo cano` es
un prompt perfectamente plausible para un NPC de un mundo de fantasía, y `what` se construye como
`f"hero: {prompt[:50]}"` / `f"skin {anim}: {prompt[:44]}"`, así que cualquier prompt de jugador que
empiece —o simplemente contenga— esa cadena entra en el barrido.

Medido con 6 `what` sintéticos construidos con la forma exacta de producción:

```
    SE BARRE  hero: un herrero de pelo cano y delantal de cuero quemad     (prompt de jugador)
    SE BARRE  skin walk: un herrero de pelo cano y delantal de cuero       (su locomoción)
    SE BARRE  hero: retrato de un herrero de pelo cano, forja de Roble     (lo contiene en medio)
    se queda  hero: un herrero de pelo negro, forja de Robledo             (control)
    se queda  hero: un herrero de la aldea del norte                       (control del lote retirado)
    SE BARRE  atlas d0: un herrero de pelo cano                            (un atlas, no un hero)
```

**Reproducción** desde el arranque: no hace falta arrancar nada — `python
ai_server/tools/archivar_gasto_de_test.py --ledger <un ledger con una de esas líneas>` las lista bajo
`A ARCHIVAR`. **Qué esperaba**: la misma protección que tiene el lote retirado. El dry-run y la
autorización humana son la red, pero una línea suelta entre 240 no se ve en la tabla, que agrupa por
`what`. **Asimetría a cerrar**: o el lote vivo también se selecciona por igualdad exacta de las tres
formas que produce el código (`hero: <prompt>`, `skin <anim>: <prompt>`), o se le declara una ventana
de fechas como al retirado. Hoy la única defensa del arte real es que nadie llame a su herrero como
la fixture.

### H2 · IMPORTANTE — la negativa es por checkout: desde un worktree se puede ensuciar el ledger del principal

`RUTA_REAL` se deriva del `__file__` del `spend_tracker.py` que se está ejecutando. Desde el worktree,
`NEFAN_SPEND_DIR=/home/al/code/ne-fan/cache/spend` —el ledger de verdad, el que mira el usuario— **se
construye sin quejarse**:

```
CONSTRUIDO SIN QUEJARSE. root = /home/al/code/ne-fan/cache/spend
RUTA_REAL de este checkout:  /home/al/code/ne-fan/.claude/worktrees/qa-t9-infra/cache/spend
```

Y la suite le escribe: sobre una **copia** del ledger real, `187 → 230 líneas`, `$37,54 → $47,86`.
**Reproducción**: desde cualquier worktree, `NEFAN_SPEND_DIR=/home/al/code/ne-fan/cache/spend python
-m unittest discover -s ai_server/tests`. **Qué esperaba**: que un directorio que se llama
`cache/spend` de *un* checkout de ne-fan esté igual de protegido que el propio. No es rebuscado: en
esta casa se trabaja en worktrees a diario (esta tanda entera), y una línea copiada de un documento o
de otro terminal trae la ruta absoluta del principal. La negativa cubre el olvido, que era el caso
mayoritario; no cubre el copiado. Un `root.name == "spend" and root.parent.name == "cache"`, o
comparar contra el `cache/spend` de la raíz del **git common dir**, lo cerraría.

### H3 · IMPORTANTE — el aviso de `--parar-todo` sigue saliendo en todo teardown, y promete algo que no hace

Dos cosas, y la segunda es la que preocupa:

1. `--parar` mira **los diez bloques** (`start.sh:1294-1299`), así que basta con que haya otro agente
   en la máquina —el estado normal— para que `saltados=1` y el aviso salga. Salió en **las siete**
   corridas de esta sesión, incluida la del flujo real. El fantasma está muerto; el efecto que el
   issue describía («todo teardown recomienda el arma prohibida») sigue vivo por una causa legítima.
2. `--parar-todo` barre **solo el bloque VIGENTE** (`cmd_stop`, rama `todo`: `puertos=("${ALL_PORTS[@]}")`,
   y el propio mensaje lo dice: *«Solo el bloque VIGENTE»*). Con los forasteros en el bloque 200 y yo
   en el 300, el aviso invita a un comando que **no se los llevaría** — y en cambio sí se llevaría
   cualquier ajeno que estuviera en MI bloque. La línea es literalmente «Para llevarte también lo
   ajeno», y es falsa en el caso multiagente, que es para el que se escribió.

**Reproducción**: con otro stack del catálogo arriba en cualquier bloque, `./start.sh --parar` desde
tu worktree. **Qué esperaba**: que el aviso solo aparezca cuando `--parar-todo` pueda hacer algo con
lo que enumera, o que diga «lo ajeno de otros bloques no se lo lleva ni `--parar-todo`».

### H4 · MENOR — la herramienta duplica en el archivo sin avisar; su hermana se niega

`archivar_gasto_de_test.py` abre el destino en modo `"a"` y solo comprueba que las líneas *estén*
(`faltan`), no que no estuvieran ya. Medido: mismo lote, mismo `--destino`, sobre un ledger
restaurado → **426 líneas en el archivo, 213 únicas**, y el guion dice `Archivados 213 eventos` las
dos veces. `ai_server/tools/archivar_sheets_varados.py:204` y `arte_de_personaje.py:210` hacen lo
contrario: `ERROR: ya existen en el archivo: … No se mueve nada.` Es el patrón de la casa para lo que
toca dinero, y aquí falta.

### H5 · IMPORTANTE — REGRESIÓN: `--parar` puede matar a un ajeno de verdad, y no podía antes

La foto de dueños se toma antes de barrer, pero **se sigue matando por PUERTO** (`kill_port`, que es
`fuser` con su bandera de matar sobre `<puerto>/tcp`), no por los pids de la foto. Un proceso ajeno
que tome un puerto del catálogo *durante* el barrido se lleva el tiro con la clasificación del
ocupante anterior. La ventana pasó de ~0 (antes se resolvía y se mataba puerto a puerto) a **toda la
segunda pasada** — medio segundo de `sleep` por puerto matado, hasta ~4 s con el bloque lleno.

**A/B medido, con el mismo guion de tiempos** (tres señuelos propios; a t≈1,2 s se retira el del
último puerto y entra uno ajeno con `cwd=/tmp`):

```
>>> PRE-arreglo (start.sh de fe0b245): el AJENO tardío SOBREVIVE
    informe:  153220    ⏭  :19065  … node /tmp/…  — AJENO, no se toca
>>> POST-arreglo-1: el AJENO tardío MUERE
    informe:     · :19065  … node /tmp/…
>>> POST-arreglo-2: el AJENO tardío MUERE
```

**Reproducción** desde el arranque: dos terminales. En A, `NEFAN_PORT_OFFSET=300 ./start.sh --parar`
con varios puertos del bloque ocupados; en B, arrancar un servicio en un puerto **alto** de ese
bloque durante los primeros segundos. **Qué esperaba**: que el comando SEGURO no pueda matar a nadie
que no haya demostrado ser mío. No es teórico en esta casa: `start.sh` se **niega** a arrancar sobre
un puerto ocupado, así que un agente que espera a que se libere un bloque arranca justo en la ventana
del `--parar` del otro. Es el escenario más probable, no el más raro. Remedio de una línea: matar los
pids de la foto (`kill "${f_pids[$i]}"`) en vez del puerto — y entonces un ocupante nuevo ni se
entera. **Es el único hallazgo que pediría cerrar antes de mergear**, porque el sujeto de la PR es
precisamente «no le cerreis sus servers».

### H6 · MENOR — dos verdes flojos en `qa/no-mata-lo-ajeno.mjs`

1. **El aserto del aviso casi nunca se evalúa.** Se marca *sin veredicto* y el guion sale con **2**
   en cuanto hay una línea AJENO que no cite los dos puertos del señuelo — es decir, siempre que haya
   otro agente. Lo comprobé: verde con exit **2** sobre el código arreglado, y en la corrida en
   negativo (con `fe0b245`) el aserto que codifica el daño original del issue **tampoco** se evaluó.
   No es grave —el aserto hermético, que sí se evalúa siempre, es el que de verdad caza el fantasma—,
   pero el exit 2 no es la señal que parece: no distingue «no pude medir lo importante» de «no pude
   medir lo redundante». Mi guion lo sustituye por la forma **siempre evaluable**: el aviso sale *si y
   solo si* el informe imprimió al menos una línea AJENO.
2. **«el launcher se niega a arrancar sobre un puerto ajeno (exit 1)» pasa con CUALQUIER exit 1.** Me
   salió **verde por un motivo falso**: en un worktree recién creado no hay `node_modules`, el
   preflight sale con 1 antes de mirar puerto ninguno, y el aserto lo dio por bueno. Lo salvó el
   aserto siguiente («…y nombra al ocupante»), que sí se puso rojo. El primero, solo, es un verde que
   no comprueba nada.

### H7 · MENOR — la cifra que queda escrita omite la salvedad que el propio informe declara

`docs/arquitectura/ia-servicios.md` fija «El gasto REAL era **$37,54**», y el mensaje de commit
también. El informe del ingeniero declara acto seguido que dentro de esos 187 eventos hay **4 con el
prompt literal `x` ($0,96)** que huelen a sondeo de test. El documento de arquitectura es el que se
leerá dentro de tres meses, y ahí la cifra queda sin asterisco. Es la lección «una decisión correcta
con una razón inventada» en versión pequeña: un número redondo que se congela.

---

## Guiones entregados

Dos, los dos **fuera de `qa/guiones/`** por la razón de siempre (no tocan la página; el segundo
además ejecuta `--parar` y dentro de la batería se llevaría el stack que la batería mide). Copiados
al checkout principal en `/home/al/code/ne-fan/qa/`:

| Guion | Qué cubre que no estuviera cubierto | Verde | Rojo (probado) |
|---|---|---|---|
| **`qa/el-ledger-de-gasto-no-lo-escribe-la-suite.mjs`** | El criterio LITERAL de #392 punta a punta: la suite ×2 con y sin la variable, los 5 disfraces de la ruta real, el blanco, que producción sigue arrancando, y la herramienta de retirada **por su CLI** (dry-run, `--ejecutar`, vecino que se parece, ninguna línea perdida, idempotencia, ventana de fechas). Los tests del ingeniero afirman el constructor; esto afirma el efecto de la corrida | 29 comprobaciones, `EXIT=0` sobre `12695db` | Quitando la negativa del constructor: 5 rojos y **⊘ SIN MEDIR** sin correr la suite. Quitando el `.resolve()`: cae el disfraz con `..`. `contains` en el lote retirado: 5 rojos |
| **`qa/parar-clasifica-los-nueve-puertos.mjs`** | Los **nueve** puertos del bloque a la vez (no dos), las **tres** vías de `worktree_de_pids`, cuatro grupos de puertos compartidos (no uno), y el aviso de `--parar-todo` en su forma **siempre evaluable**. Más una sonda declarada de H5 | 13 comprobaciones, `EXIT=0` sobre `40253ed` | Con `start.sh` de `fe0b245`: **8 rojos**, incluidos «3 puertos propios salen AJENO», «los 4 pares salen sueltos» y «el informe se parte» |

**La puerta del primero merece una nota**: corre la suite, así que en un árbol sin el arreglo la
correría contra el ledger de verdad. Por eso comprueba la negativa **primero** y, si no está, sale con
2 sin ejecutar nada más. Probado: con el constructor mutilado, `⊘ SIN MEDIR` y `cache/` ni se crea.

Ninguno de los dos entra en `qa/README.md`, que enumera los sueltos como «el sexto/séptimo/octavo
ejecutable» — `no-mata-lo-ajeno.mjs` tampoco está ahí. **Lo dejo apuntado para el coordinador**: son
el noveno y el décimo.

---

## Workarounds usados

| Workaround | Veredicto |
|---|---|
| `npm install` en `nefan-html`, `nefan-core` y `narrative-mcp` del worktree | **Montaje de entorno, no defecto del producto.** Un worktree desprendido no trae `node_modules`. Pero destapó **H6.2**: sin ellas, el primer aserto de `no-mata-lo-ajeno.mjs` sale verde por un exit 1 que no tiene nada que ver con los puertos |
| Sembrar `cache/spend/events.jsonl` del **worktree** con una copia del ledger real (187 líneas) | **Justificado y no afecta al usuario.** Es la única forma de afirmar «la suite deja el mismo número de líneas» sin arriesgar el dinero de verdad: el `RUTA_REAL` del worktree es un fichero mío. Borrado al terminar |
| Ejercer la herramienta y el barrido sobre **copias** en el scratchpad, nunca sobre `cache/spend` ni `archivo/` del principal | **Obligado por el encargo**, y comprobado: `md5` del ledger principal idéntico al del inicio |
| Mutar `spend_tracker.py`, `archivar_gasto_de_test.py` y `start.sh` para ver los rojos, restaurando con `git checkout` | **Práctica normal de negativo.** `git status` limpio tras cada uno; lo verifiqué en cada vuelta |
| — *(incidencia, no workaround)* Corrí `python ai_server/tests/test_sprite_forge_adapter.py` estando en la rama de **#393**, que no lleva #392 | Error mío de rama. Sirvió de medida independiente del ANTES: **43 eventos, $10,32** escritos en el ledger del worktree con la suite en verde. En `12695db` el mismo comando da `FAILED (errors=56)` y no crea nada |

---

## No probado

- **Que el aviso de `--parar-todo` NO salga con la máquina limpia.** Es el aserto que codifica el daño
  original de #393 y **no pude evaluarlo**: hubo un stack de otro agente en el bloque 200 durante toda
  la sesión, y pararlo no es una opción. El ingeniero declara haberlo visto verde en limpio; yo no lo
  confirmo ni lo desmiento. Con H3 encima, es la parte más floja del cierre de #393.
- **`--parar-todo` / la tecla `K`**: prohibida por la restricción de la casa. Su camino nuevo
  (agrupar y matar una vez) queda revisado a ojo, como ya declaraba el ingeniero.
- **pytest**: no está instalado, así que no pude medir si `"unittest" in sys.modules` se cumple bajo
  él. Si algún día se adopta, hay que remedirlo (probablemente sí, `_pytest/unittest.py` es plugin por
  defecto, pero *probablemente* no es una medida).
- **Arrancar remote-gen de verdad** (no solo importarlo): el offset ≠ 0 no lo permite y el bloque 0
  puede ser de otro. La construcción del singleton, que es lo que el candado toca, ocurre **al
  importar**, y eso sí lo medí.
- **Gasto real de créditos**: cero en toda la sesión, por diseño. La aritmética del ledger es sobre
  ficheros, no sobre facturación.
- **Mutación**: nada que medir. Los dos cambios viven en `ai_server/`, `start.sh`, `qa/` y prosa, y
  `mutation-targets.json` solo cubre el núcleo puro de `nefan-core`. Coincide con lo declarado.

---

## Veredicto

**Apto con reservas.**

Las dos PR cumplen sus criterios literales y los rehíce todos yo, incluidos los rojos: #392 deja el
ledger idéntico tras cuatro corridas de la suite y revienta nombrando la variable cuando se la olvida;
#393 clasifica bien los nueve puertos, agrupa por proceso, no parte el informe y no toca lo ajeno.
`npm run verify` 1976/1976 en las dos ramas, la deuda congelada en 15, y el ledger del principal
intacto.

La reserva tiene un nombre: **H5**. La PR que existe para que `--parar` no empuje a matar servidores
ajenos ha introducido, de propina, la única manera en que `--parar` **puede** matar uno de verdad — y
el escenario que la dispara (un agente esperando a que se libere el bloque) es el habitual, no el
raro. Se cierra con una línea (matar los pids de la foto en vez del puerto). Después van **H1** (el
criterio vivo barre arte real por `contains`, sin la protección que sí tiene el retirado) y **H2** (la
negativa es por checkout, y desde un worktree se llega al ledger del principal). H3, H4, H6 y H7 son
para la cola, no para esta tanda.
