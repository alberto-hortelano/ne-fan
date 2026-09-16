# QA — PR 2 de la tanda E · #583 «el sim no lee la huella de los spawns de runtime»

Dos pasadas. La primera sobre `79ee640b` dictaminó **NO APTO** por un hallazgo bloqueante; la
segunda, sobre `92ab14ab` (rama `e/583-las-cajas-del-sim` rebasada sobre `main` = `393d5249`, que ya
trae #601 y #538), verifica el arreglo.

**Veredicto final: APTO CON HALLAZGOS.**

Árbol `/home/al/code/ne-fan-qae2`, `npm run build` antes de cada medida. Validado contra la
**decisión 3 del usuario** (`requisitos.md:146-161`), no contra `plan.md` ni contra los informes del
ingeniero. Cero créditos en todo: motor falso, `e2e-sin-creditos` levantado por `qa/run.mjs` con
`NEFAN_PORT_OFFSET=600`, y sondas headless sobre `dist/`.

---

# SEGUNDA PASADA (sobre `92ab14ab`)

## 1 · Los siete hallazgos de la primera pasada, uno a uno

| # | Hallazgo de la 1ª pasada | Estado | Evidencia MÍA (no la del informe) |
|---|---|---|---|
| **H-2** | *Bloqueante.* Al NPC al que le cae una caja encima no se le saca: **290 s de 300 dentro del carro**, 3 semillas | ✅ **CERRADO** | Sonda propia con el cableado de producción: el NPC llega a la cara del carro en **2,50 s** y se queda fuera. Traza tick a tick: `t+0,00 (−0,50) … t+2,50 (−3,50)`, caminando en línea recta hacia la cara más cercana. Aviso declarado: `"aldeano" quedó DENTRO de "carro" (se la pusieron encima) y sale andando por su cara más cercana antes de seguir a lo suyo` |
| **H-1** | *Importante.* «El mismo obstáculo se rodea si es del tile y no si es de runtime» | ❌ **ERA MÍO, y estaba mal** | El ingeniero tiene razón: `cell` es la **esquina** (`blueprint/derive.ts:133`, el rect es `[c, r, w, d]`), así que mi granero de `cell [64,64]` estaba centrado en (3,3) y el carro en (0.25,0.25) — comparé dos posiciones, no dos fuentes. Cruzado por mí, 300 s: centro (3,3) → tile x máx **−0,50** / runtime **−0,50**; centro (0,0) → **−3,50** / **−3,50**. **No hay asimetría.** Lo que queda —que no rodea— es el `TODO(A*)` genérico, y vive en **#618** |
| **H-3** | *Importante.* El coste escrito citaba 20 tick/s | ✅ **CERRADO** | La cabecera dice ahora «un tick por FRAME del cliente —60/s, no 20—» con la cadena de ficheros. Re-medido por mí **con la consulta nueva incluida** (1 salida + 1..7 pasos por tick y NPC, 10 NPCs, mediana de 7): 200 → 15,0 / 61,1 ms; **600 → 49,2 / 205,9 ms (20,6 % de un núcleo)**; 2400 → 204 / 846 ms. Escrito en el código: 15,1 / 62,2 · 53,9 / 222,5 · 214,9 / 870,2. Reproduce dentro del ruido, y el umbral («a partir de 600») queda escrito donde se lee |
| **H-4** | *Menor.* El docblock de `HOLGURA_ENTRE_SPAWNS_M` decía «no encierra a nadie» y «ni empatando» | ✅ **CERRADO** | Reescrito con mi medida y rotulado «MEDIDO … y no deducido»: por la línea central exacta pasa (`margen <= 0` → penetración 0) y **solo por ahí**; a 5 cm no pasa y **el escape no se abre**; cinco trayectorias (z = 0 · 0,05 · 0,1 · 0,3 · 0,6), una cruza y ninguna más, 0 escapes. Es exactamente lo que yo medí |
| **H-5** | *Menor.* El candado de la caché no veía una memoización con clave en `entities.length` | ✅ **CERRADO** | Repetí mi sabotaje (`if (e.length !== cajasN) …`) → `npx tsx --test test/sim-collision.test.ts` → **1 rojo**: «al cambiar de partida, las cajas son las de la partida NUEVA aunque mida lo mismo» (14/15) |
| **H-6** | *Menor.* La huella máxima del contrato (64 m) congelaba a quien estuviera dentro | ✅ **CERRADO** | Sonda propia: el NPC dentro de un `building` de 128 celdas **sale en 17,25 s** (antes: 0,03 m en 60 s). Hay caso en `test/cajas-de-runtime.test.ts` («también de la huella MÁXIMA que el contrato permite, 64 m, QA H-6») |
| **H-7** | *Menor.* Rastro muerto en `qa/README.md:472` | ✅ **CERRADO** | La ficha del 118 está en pasado y nombra el cambio (`#524 lo cambió por el reparto según el tamaño`). `grep` de «1,8 m fijos» en presente = 0; el único hit restante es la cabecera del guion 128, que describe en pasado el problema que #524 arregló |

## 2 · El arreglo de H-2, puesto a prueba de verdad

### 2.1 · ¿Comparten cuenta la penetración y la dirección?

Sí, y de la forma fuerte: `penetracionEnCaja` **está implementada como** `salidaDeCaja(p, caja, radio)?.pen ?? 0`.
No son dos cuentas que coinciden, es una sola leída por dos sitios. Comprobado el sabotaje que el
ingeniero anuncia, **`min` → `max`** en `salidaDeCaja`:

```
$ npx tsx --test test/obstaculos-del-jugador.test.ts test/cajas-de-runtime.test.ts \
                 test/sim-collision.test.ts test/npc-behavior.test.ts
ℹ tests 94 · pass 82 · fail 12
```

**12 rojos en las cuatro suites a la vez**, y caen los dos lados: «la PENETRACIÓN se mide por la cara
más cercana», «dentro, apunta a la cara MÁS CERCANA», «bloquea el paso que deja MÁS metido», «dice
POR DÓNDE SALIR…». Es la prueba de que no pueden divergir.

### 2.2 · Pasada adversarial sobre la salida (sonda propia, cableado de producción)

| Caso | Resultado |
|---|---|
| C1 · **exactamente en el centro** de la caja de 6 m, meta al este | sale en **3,07 s** (hacia +x, que es el desempate documentado) y llega a la meta |
| C2 · en una **esquina** (empate de márgenes) | sale en **0,57 s** y llega |
| C3 · **dos cajas solapadas** y el NPC dentro de las dos | sale en **3,07 s** y llega |
| C4 · la salida da **dentro de otra caja** | sale de la primera en **2,23 s**; se queda plantado contra la segunda (eso es #618) |
| C5 · la cara más cercana da al **agua del tile** | sale en **3,08 s**; se abre 1 escape sobre una caja y acaba a 12 m; el agua no se cruza |
| C6 · huella **máxima del contrato** (64 m) | sale en **17,25 s** |
| C7 · NPC con directiva `hold` (tendero en su puesto) | **no sale** en 120 s — pero **idéntico antes de #583** (alejamiento 0,00 m en los dos). No es regresión |
| C8 · NPC que **ya llegó** a su meta y la caja cae sobre ella | **no sale** en 120 s — **idéntico antes de #583**. No es regresión |
| C9 · NPC **sin directiva** (micro-wander) con un granero de 10 m encima | **no sale y no se mueve** (0,00 m); antes de #583 paseaba 4,5 m sin salir tampoco. Regresión estrecha → **A-2** |

El contrafactual «antes de #583» no es una reconstrucción: es el MISMO montaje con las cajas apagadas
para el NPC (`queImpideElPaso`/`porDondeSalirDeAqui`/`blocksCircle` neutralizados), que sobre campo
abierto es byte a byte lo que el sim veía.

## 3 · Hallazgos NUEVOS de la segunda pasada

### A-1 · El cable entre el proveedor y el sim no tenía candado: **2891 tests verdes con el defecto entero puesto** — *importante; cerrado por mí en el banco*

`bridge/context.ts:createSessionNpcBehavior` son cinco líneas que atan `SimCollisionProvider` al
`NpcWorldAdapter`. Las dos mitades tienen batería; **el cable no tenía ninguna**. Medido:

| Sabotaje (una línea en `bridge/context.ts`) | Suite de `nefan-core` |
|---|---|
| `porDondeSalirDeAqui: () => null` (mata el arreglo de H-2 entero) | `test/npc-behavior.test.ts` + `sim-collision` + `cajas-de-runtime`: **63/64 verde**, 1 rojo y es el del proveedor, no el del NPC |
| `queImpideElPaso: () => null` (mata #583 entero) | `npx tsx --test test/*.test.ts` → **ℹ tests 2891 · pass 2891 · fail 0** |

O sea: una edición de una línea revierte esta PR completa —y también el arreglo de H-2— y **la suite
entera sigue en verde**. Es el sabotaje que el encargo pedía buscar.

No es un defecto que el ingeniero introdujera (el `blocksMove` de antes tenía el mismo agujero), pero
esta PR pone **todo su valor** detrás de esas dos líneas. **Lo he cerrado yo, donde tocaba: en el
guion.** Ver §4.

### A-2 · Al NPC que solo pasea la salida no le alcanza si la caja es más ancha que su paseo — *menor*

`porDondeSalirDeAqui` se consulta dentro de `stepTowards`, o sea que saca a quien ya va a algún sitio.
El que solo pasea depende antes de `randomWaypoint` (`npc-behavior.ts:800-806`), que sortea 8 puntos
dentro de `wander_radius` y descarta los que `blocksCircle` dé por ocupados — y desde esta PR una caja
de runtime los ocupa. Si la caja es más ancha que ese radio, los ocho caen dentro, no hay waypoint, no
hay `stepTowards` y la salida no llega a preguntarse. Barrido medido (120 s):

```
  peasant (wander_radius 5 m)    granero  4 m → SALE (4,63 m)   ·  8 m → SALE (6,38 m)
                                 granero 10 m → ATRAPADO (0,00) · 20 m → ATRAPADO (0,00)
  villager (wander_radius 6 m)   granero 10 m → SALE (7,79 m)   · 20 m → ATRAPADO (0,00)
```

Umbral: **media huella + radio > `wander_radius`**. El defecto de la clase `building` son 8×8 celdas
= 4 m, muy por debajo; hace falta que el motor DECLARE un `footprint` de ≥ 20 celdas para un
campesino. Y en esos mismos casos, **antes de esta PR el NPC tampoco salía** del granero (paseaba 4,5 m
dentro de una huella de 5,5): el cambio es «se mueve dentro» → «se queda quieto dentro», no «salía y
ya no». Por eso es menor y no bloqueante. Remedio evidente y barato el día que se toque: que el
elector de waypoints, cuando no encuentre ninguno, pregunte por dónde se sale.

Registrado en el guion como `⚠ HALLAZGO` con su número, para que el día que se arregle cambie de cifra.

### A-3 · Lo que #618 se lleva, comprobado y sin asimetría — *anotación, no hallazgo*

El NPC sigue sin rodear un obstáculo centrado en su camino, y eso es lo que queda vivo de mi H-1. Con
el anclaje bien puesto lo hace **igual con las dos fuentes**, así que no es de esta frontera. El guion
lo mide con las dos y lo registra sin ponerlo rojo.

## 4 · El guion del banco, reforzado

`qa/el-mundo-solido-tambien-para-el-npc.mjs` (commiteado en la rama, con su ficha en `qa/README.md`).
Lo he cambiado en esta pasada por lo que cazó A-1: **ya no construye el adapter a mano**, lo pide a
producción.

```js
function simDeLaSesion(s, meta) {
  laPlaza(s, meta);
  const provider = createSimCollisionProvider(s);
  return { provider, sys: createSessionNpcBehavior({ narrative: s, simCollision: provider }, undefined) };
}
```

La meta pasa a ser un **place de verdad** del mapa del mundo (`worldMap.upsertPlace` con `anchor.rect`),
porque el adapter real la resuelve con `resolvePlaceTarget` y no con un `if` del guion.

Esto responde de paso a lo que el ingeniero preguntó: al ser `.mjs`, el «no opcional» del tipo no
protege al banco, y él tuvo que descubrirlo con un `TypeError` en ejecución. La respuesta correcta no
es añadir una comprobación de forma, es **dejar de escribir el adapter**: así el guion no puede
quedarse corto respecto al de producción, porque es el de producción.

Efecto medido, recompilando `dist` en cada sabotaje y restaurando después:

| Sabotaje | Antes (adapter a mano) | Ahora (adapter de producción) |
|---|---|---|
| `porDondeSalirDeAqui: () => null` en `context.ts` | verde | **2 rojos** (bloque 6: «siguió dentro 290 s de 300») |
| `queImpideElPaso: () => null` en `context.ts` | verde | **5 rojos** (bloques 2, 4 y 6) |

Y los cuatro sabotajes de la primera pasada siguen cazándose: sin fuente de cajas → 7 rojos; el escape
aceptando `de:"tile"` → 2; sin la pasada del escape → 3; `cajaBloquea` con `> 0` → 1.

```
$ node qa/el-mundo-solido-tambien-para-el-npc.mjs
  ✔ los seis bloques en verde        EXIT=0
```

**Sigo recomendando** meterlo en el job `candados-headless` de `ci.yml`: no abre navegador, no levanta
puertos, tarda ~40 s, y es hoy lo único que se enteraría de A-1. Tocar CI no es mío.

## 5 · Verificación de la segunda pasada

| Qué | Salida |
|---|---|
| `cd nefan-core && npm run verify` | **exit 0**, 0 `✖`, `tests 2891 · pass 2891 · fail 0` |
| `npm run coverage && npm run crap -- --check` | `1378 funciones · cobertura 95.86% · complejidad máxima 46` · `Tope CRAP ≤ 73 — 0 por encima` · `Objetivo ≤ 30 — 7 por encima` · `✔ dentro de los umbrales`. `decide` 40,5 y `move` 29,1 **sin crecer**; nada nuevo en la lista |
| `npm run deuda` | 1 de 59 módulos sin medir (`cajas-de-runtime`, pedido), **ningún superviviente NUEVO** |
| `NEFAN_PORT_OFFSET=600 node qa/run.mjs guardia carro forja spawn-vuelve colision-desde-huella porton runtime-aguanta parada-que-nadie npc-clave npc-que-el-cliente` | **10 en verde · 0 en rojo de 10**, capturas en `qa/capturas/2026-09-16T12-16-27-907Z-313623` |
| `node qa/el-mundo-solido-tambien-para-el-npc.mjs` | seis bloques en verde, exit 0, tres `⚠ HALLAZGO` registrados |
| Parada | `NEFAN_PORT_OFFSET=600 ./start.sh --parar` desde mi árbol. Ningún `pkill`, ningún puerto ajeno |

## 6 · Workarounds de la segunda pasada

Ocho sabotajes en el fuente (uno por vez, con `npx tsc` para rehacer `dist` y restaurados desde copia
intacta): `min→max` en `salidaDeCaja`, el proveedor sin salida, `stepTowards` ignorando la salida, las
dos líneas de `context.ts`, la caché con clave en `length`, y los cuatro de la primera pasada. Ninguno
sobrevive: `git diff` de producción vacío al terminar. Las sondas viven en el scratchpad y montan el
cableado de producción; no hay estado sintético en ningún cable.

**Un error mío que declaro**: en la primera versión de la sonda adversarial pasé el predicado «está
fuera» donde se esperaba «está dentro», y los nueve casos C salieron «SÍ (0 s)». Lo detecté al leer
que C1 decía haber salido en el tick 0, lo arreglé y repetí. Las cifras de arriba son las del
predicado corregido.

## 7 · No probado

- **Con el motor narrativo de verdad** (créditos). Todo es motor falso y sim headless.
- **El bridge bajo carga real de partida**: mis medidas son del proveedor aislado con la caché del
  tile cebada, no del hilo con combate + WS + saves a la vez.
- **La mutación**: `cajas-de-runtime` sigue `"sin medir"` por diseño del instrumento, `bridge/` está
  fuera del perímetro y `npc-behavior.ts` en `sin_mutar`. De las tres piezas de la PR, hoy **la
  mutación no mide ninguna**. Lo declara el informe y lo confirmo.
- **La tabla de CRAP contra la base función a función**: no he vuelto a medir `393d5249`; me quedo con
  el candado (`crap --check` verde, 0 sobre el tope, umbrales sin tocar).

## 8 · Veredicto

**APTO CON HALLAZGOS.**

El bloqueante está cerrado, y cerrado bien: la pieza que faltaba —la DIRECCIÓN de salida— comparte
cuenta con la penetración por construcción (una función llama a la otra), el desempate es determinista
y está escrito, y aguanta la pasada adversarial completa: centro exacto, esquina, dos cajas solapadas,
salida hacia otra caja, salida hacia el agua del tile y la huella máxima del contrato. 290 s → 2,5 s,
medido por mí con el cableado de producción.

Los otros seis hallazgos están cerrados con medida, no con prosa: el coste lleva el ritmo real y su
umbral, el docblock del reparto dice lo que el código hace, el candado de la caché ve la memoización
que se le escapaba, la huella de 64 m sale sola y el rastro muerto se barrió. Y **me corrigió con
razón en H-1**: la asimetría que reporté era mi anclaje, no el código; lo he reproducido cruzado y no
existe.

Queda abierto, y ninguno bloquea:

1. **A-1**, el cable sin candado. Lo he cerrado en el banco, pero solo sirve si alguien lo corre:
   el guion debería entrar en `candados-headless`.
2. **A-2**, el que solo pasea bajo una caja más ancha que su paseo. Estrecho, parcialmente
   preexistente, con umbral medido y remedio evidente: issue propio (o una línea en #618).
3. **#618** se queda con lo que de verdad le toca —el NPC no rodea—, ya sin la sospecha de asimetría
   que yo le había colgado.
