# QA — PR 3 de la tanda E · #538, la mitad que se resuelve POR RETIRADA

Árbol `/home/al/code/ne-fan-qae3`, commit `83953cf3` («La reaparición pierde la rama que nadie podía
pisar (#538)»), árbol limpio al empezar. Validado contra `requisitos.md` —en particular la
**decisión 4 del usuario**, «Borrarla», y la **decisión 2**, «H10 a la sesión de combate»—, no
contra el plan ni contra el informe del ingeniero.

**Veredicto: APTO CON HALLAZGOS.** La retirada es correcta y está demostrada: medí 99.932 puntos de
las tres fixtures y en ninguno la rama borrada se habría ejecutado, así que la PR no mueve al
jugador ni un milímetro. Pero **la puerta que la PR vende como el candado de la retirada no cierra**:
volví a meter la consulta de movimiento por la rendija que deja `Function.length` y `npm run verify`
dio 2847/2847 en verde con el aserto «tiene ARIDAD 1» EN VERDE. Es H-1, cuesta cuatro líneas de test
y debería entrar antes de fusionar.

---

## 1 · Criterios

| # | Criterio (de la petición y de las decisiones del usuario) | | Evidencia |
|---|---|---|---|
| 1 | `puntoDeReaparicion` queda con **aridad 1** | ✅ | `nefan-core/src/simulation/reaparicion.ts:32-34` es `puntoDeReaparicion(pos: { x: number; z: number }): Vec3` con un solo `return`. Medido sobre el build: `aridad dist = 1 · function puntoDeReaparicion(pos) { return { x: pos.x, y: 0, z: pos.z }; }` |
| 2 | Mueren el escalón 2, su parámetro `solido`, el escalón 3 y `rectDelTile` | ✅ | `git show HEAD -- …/reaparicion.ts`: se van los dos `if` y el `return { x: 0, y: 0, z: 2 }`. `grep -rn "rectDelTile"` en `nefan-core/src`, `nefan-html/src` y `qa` → **0**; único hit vivo en todo el repo: el `porque` de `mutation-targets.json`, que es el sitio de la casa para el motivo de un número |
| 3 | **H2 por retirada**: el parámetro `solido` no tenía otro uso vivo | ✅ | `grep -rn "puntoDeReaparicion"`: un solo llamante, `nefan-html/src/main.ts:537`, hoy con un argumento. `collidesAt` sigue vivo en otras cinco líneas del cliente (`main.ts:484,522,622,918`, `dev/nefan-hook.ts`), así que no quedan importaciones huérfanas |
| 4 | **La retirada no cambia nada observable** (no basta afirmarlo) | ✅ | `node qa/la-puerta-de-la-reaparicion.mjs` (guion nuevo, §4): **99.932 puntos de 99.932** sobre las tres fixtures, las dos políticas de `planAplicadoEn` y las tres fuentes de `collidesAt` → la pregunta del escalón retirado vale `false` en todos. Control: 12.763 de esos mismos puntos (12,8 %) SÍ dan sólido preguntados desde otro sitio |
| 5 | **H10 no se toca**: el jugador sigue reapareciendo donde cayó | ✅ | Guion 93 desde mi árbol: `✔ vuelve EXACTAMENTE donde cayó`. El diff no toca `game-loop.ts:220 respawn()` (ni la cura de enemigos), ni `combat/enemy-ai.ts` (`engaged`). `git show --stat HEAD` = 8 ficheros, ninguno de ellos |
| 6 | Nadie se queda encerrado al reaparecer dentro de algo | ✅ | Sonda con `pasoDelJugador` + `aabbBloquea` reales sobre una caja de 4×4 m: cadáver en (0,0), (1,5·1,5) y (2,3·0) → reaparece ahí y **sale por 8/8 rumbos** en los tres |
| 7 | El bloque 4 del guion 93 pasa de **registrar** a **afirmar** | ✅ | Dos asertos nuevos y **ninguno perdido**; las dos listas, en §3 |
| 8 | «Antes salían verdes tres asertos que ahora cazan el defecto» | ❌ | Falso para uno de los tres: el bloque 4 VIEJO ya afirmaba `vuelve EXACTAMENTE donde cayó (escalón 1: el sitio libre gana)` con el mismo `dist < 0.01`, así que el sabotaje de los ejes cruzados lo habría puesto rojo. H-3 |
| 9 | El trinquete `client-file-size.json` baja 1395 → 1394 **en el mismo commit** | ✅ | `wc -l nefan-html/src/main.ts` = **1394**; el JSON dice 1394 en el mismo diff. `node --test test/client-file-size.test.ts` → 7/7, con `✔ la cifra de cada excepción es EXACTAMENTE el tamaño de hoy` |
| 10 | **La puerta**: que no vuelva a entrar una consulta que no sea de PUNTO | ❌ | El aserto de aridad no la cierra: con la consulta recableada como parámetro opcional, `verify` da **2847/2847 verde** y el aserto de la ARIDAD sale ✔. H-1 |
| 11 | `npm run verify` verde | ✅ | `ℹ tests 2847 · pass 2847 · fail 0 · **skipped 0 · todo 0**` (43 s). Nada se puso verde callándose: el diff toca dos ficheros de test, `reaparicion.test.ts` pasa de 8 `it` a 4 y `architecture.test.ts` mantiene sus 58, así que el −4 está entero explicado |
| 12 | Ningún umbral tocado (`npm run crap`) | ✅ | `1365 funciones medidas · cobertura **95.89 %** · Tope CRAP ≤ 73 — 0 por encima · ✔ dentro de los umbrales`. Ojo: el informe declara 95,98 % y «la cobertura sube»; ver H-5 |
| 13 | Mutación: 100 % y `break: 100` intacto | ✅ | Reproducido: `npm run mutacion -- local reaparicion` → `ok reaparicion 2 mutantes · 0 vivos · score 100.0% (break 100) · 2s`. Informe borrado después de leerlo, `reports/` vuelve a no existir |
| 14 | Criterio 13 del plan: el `grep` de la retirada a cero | ⚠️ | Cumple **para los términos que el plan enumera**, pero no ve la LLAMADA retirada: sigue viva en `nefan-core/test/architecture.test.ts:2724`. H-2 |
| 15 | `arch-rules.json` sigue describiendo los tres escalones como regla de hoy | ⚠️ | Aplazado a la PR 1 por el ingeniero con su motivo (§6.2 de su informe). Es real, y es exactamente la forma en que un rastro sobrevive: H-6, con remedio de fusión |
| 16 | #538 no se cierra hasta que H10 tenga dueño | ⚠️ | El issue hermano **no está abierto**. Bloqueo declarado por el ingeniero y confirmado: sin él, cerrar #538 convierte un hallazgo medido en deuda invisible |
| 17 | Cero créditos en toda la verificación | ✅ | `censo de gasto: /generate_scene×1 · /generate_surface_atlas×1 (motor falso: $0)`. Preset `e2e-sin-creditos`, `NEFAN_PORT_OFFSET=400`, parado con `./start.sh --parar` del propio árbol |

---

## 2 · Hallazgos

### H-1 · IMPORTANTE — el candado de la ARIDAD deja entrar la consulta por la puerta de al lado

`Function.length` **deja de contar en el primer parámetro con valor por defecto**. O sea que la
forma más probable de que la consulta vuelva —añadirla como parámetro opcional, que es como se añade
un parámetro sin tocar al llamante— pasa por delante del único aserto que la PR pone de puerta.

**Reproducción exacta** (la hice y restauré; el árbol quedó byte a byte idéntico, `git diff
--exit-code` limpio):

1. `nefan-core/src/simulation/reaparicion.ts`:

```ts
export function puntoDeReaparicion(
  pos: { x: number; z: number },
  solido: (x: number, z: number) => boolean = () => false,
): Vec3 {
  if (solido(pos.x, pos.z)) return { x: 0, y: 0, z: 2 };
  return { x: pos.x, y: 0, z: pos.z };
}
```

2. `nefan-html/src/main.ts:537`: `const rp = puntoDeReaparicion(playerPos, collidesAt);` — la MISMA
   consulta de MOVIMIENTO que #538 acaba de retirar, de vuelta, y sin mover el `wc -l` del fichero.

**Salida real:**

```
ℹ tests 2847   ℹ pass 2847   ℹ fail 0
  ✔ tiene ARIDAD 1: no vuelve a entrar una consulta de solidez ni el rect del tile (0.095491ms)
```

Y el cliente también: `npm run lint` exit 0, `npm run build` exit 0. **Verde entero con el defecto
puesto.** El propio test dice de sí mismo que «recablear aquí una consulta que no sea de PUNTO tiene
que costar un rojo»: hoy no cuesta nada.

Qué esperaba el usuario: la decisión 4 dice que si el parámetro «sigue teniendo otro uso vivo, eso es
un hallazgo». El corolario es que la retirada tiene que *aguantar*, y el aserto que la sostiene
cubre menos de lo que su nombre promete.

**Remedio (del ingeniero, cuatro líneas):** en `test/reaparicion.test.ts`, junto a la aridad, afirmar
que **un argumento de más ni se llama ni cambia el resultado** — un espía que devuelva `true` y un
rect, y comprobar que el espía queda a cero y el punto sigue siendo el del cadáver. Es lo que hace el
bloque 1 del guion que dejo en §4, y ahí se puede copiar literal; conviene que viva además en
`test/`, que es lo que corre en CI. Lo que ese par de asertos **no** cubre y conviene decir en voz
alta: una inyección a nivel de módulo (un `setSolidoProvider()`, una importación desde core) no tiene
forma de parámetro y pasaría por delante de los dos.

### H-2 · MENOR — queda viva la llamada retirada, en el fichero que el ingeniero sí tocó

`nefan-core/test/architecture.test.ts:2724`, dentro de la fixture rotulada *«Lo que SIGUE siendo del
cliente y tiene que compilar»*:

```
"const rp = puntoDeReaparicion(playerPos, collidesAt, under?.rect ?? null);\n" +
```

Esa llamada no existe en ningún sitio desde este commit (y el `under?.rect` ni siquiera es la forma
que tenía: era `tileStore.getAt(...)?.rect`). Es «un test vivo alimentado con datos de un formato
muerto», que es el caso que CLAUDE.md nombra por su nombre. El ingeniero arregló la fixture hermana
**treinta líneas más abajo** (`:2746`, la de core) y no vio ésta; el `grep` del criterio 13 no la ve
porque busca `rectDelTile|escalón 2|centro del tile` y no la llamada.

**Reproducción:** `grep -rn "puntoDeReaparicion" --include=*.ts nefan-core/test` → un hit, y no es de
`reaparicion.test.ts`.

**Remedio:** pasar esa fixture a la llamada VIVA (`const rp = puntoDeReaparicion(playerPos);`), que
sigue siendo un ejemplo legítimo de «esto es del cliente y tiene que compilar».

### H-3 · MENOR — el commit afirma un negativo que no es cierto para uno de los tres sabotajes

Mensaje de commit: *«un bloque que solo escribe una línea de log no es un candado, y con él **los tres
sabotajes de esta PR salían verdes**»*, y `implementacion-3.md` §4 lo repite. **Comparado por el
TEXTO, no por el color**, el bloque 4 VIEJO ya tenía este aserto:

```
"vuelve EXACTAMENTE donde cayó (escalón 1: el sitio libre gana)",  dist < 0.01
```

El sabotaje D (`{ x: pos.z, …, z: pos.x }`) da `dist ≈ 15,7 m`, así que **ese** se habría puesto rojo
con el bloque antiguo igual que con el nuevo. La conversión sigue justificada por E y F —que el propio
informe señala como «la razón»—, pero el número es tres donde son dos. La casa tiene fichado lo que
pasa con la justificación que se escribe después y no se mide.

**Remedio:** corregir la frase en `implementacion-3.md` y, si la PR aún no está fusionada, en el
cuerpo del commit; si ya lo está, en la fila de `qa/README.md` basta con no repetirlo (esa fila hoy
solo dice que los tres sabotajes ponen rojo algo, que es cierto).

### H-4 · MENOR — el absoluto «vale `false` siempre» no es cierto, y está escrito en los tres sitios

`reaparicion.ts:13-22` («esa consulta contesta “libre” pase lo que pase»), el `porque` de
`mutation-targets.json` («vale `false` siempre») y el mensaje de commit escriben un absoluto. Medido,
hay un caso en que no vale `false` con origen = destino: la **tangencia exacta**, cuando `x + radio`
cae justo en el borde de una celda sólida. La exención de `blocksMove` («celda que ya solapabas») usa
un solape ABIERTO (`terrain-collision.ts:176` y `:207`, `circleOverlapsCell`), así que la celda que el cuerpo
solo TOCA no queda eximida.

```
celdas sólidas: 81 · radio jugador: 0.4
aleatorio 200000 puntos → from===to bloquea en 0 []
tangencia exacta x=-2.4 z=0 → blocksMove(from===to) = true
```

**No cambia el veredicto de la retirada**: pide `x ≡ 0,1 mod 0,5` exacto en binario, los arranques
que produce el motor caen en `≡ 0,25`, y en ese caso el código viejo habría teletransportado al medio
del tile a alguien que solo ROZA un muro — o sea que la retirada también lo mejora. Pero el absoluto
está escrito donde la casa guarda los motivos, y ahí un absoluto se mide.

**Remedio:** sustituir «siempre / pase lo que pase» por lo medido («no dice “sólido” de la posición
del propio jugador salvo en la tangencia exacta de una celda, que el juego no alcanza»), o dejar la
frase y enlazar el guion de §4, que lo imprime en cada corrida.

### H-5 · MENOR — «la cobertura sube» no reproduce

El informe declara **95,98 %** y dice que sube desde el 95,89 % que midió el plan sobre la base. En
este mismo commit yo mido:

```
1365 funciones medidas · cobertura 95.89% de 18082 líneas DE CÓDIGO · complejidad máxima 46
Cobertura mínima: 95% — ahora 95.89% (margen 0.89 puntos ≈ 161 líneas)
✔ dentro de los umbrales
```

Es decir, exactamente el número del plan. Puede ser varianza de la cobertura de V8 (0,09 puntos ≈ 16
líneas) o una corrida con otra concurrencia; en cualquier caso **el umbral se cumple igual** y esto no
bloquea nada. Lo anoto porque «sube» es una afirmación de medida y aquí no reproduce.

### H-6 · MENOR (de fusión, no de código) — el `why` de `arch-rules.json` sigue contando los tres escalones

`nefan-core/data/contract/arch-rules.json:311` dice todavía: *«El PUNTO DE REAPARICIÓN —la posición
actual si está libre, si no el centro del tile de debajo, y sin tile el origen— … y hoy es
`puntoDeReaparicion` en `src/simulation/reaparicion.ts`»*. Leído de corrido, describe como regla de
HOY una que ya no existe. El ingeniero lo declara y lo aplaza a la PR 1 (§6.2) porque esa línea JSON
es gigante y la PR 1 la tiene asignada; el argumento del conflicto es bueno, pero aplazar es
justamente como sobrevive un rastro.

**Remedio:** que el coordinador lo ponga como paso obligatorio al fusionar la PR 1 (una cláusula: «la
línea murió con #538; el token sigue prohibiendo que el cliente invente el centro de un rect») y, si
la PR 1 se retrasa o cambia de alcance, que vuelva a esta PR.

### H-7 · BLOQUEO YA DECLARADO — H10 no tiene dueño

Confirmado: no hay issue hermano. **#538 no puede cerrarse.** El cuerpo que propone el ingeniero es
bueno; le añado la evidencia que medí hoy, que es lo que le falta para que se lea sin fe:

> En la corrida del guion 93 de hoy (motor falso, cero créditos), el jugador muere peleando con
> «Bandido de camino», pulsa `R` y reaparece **en el mismo punto**, con el bandido a un paso y con
> **60/60 de vida** —curado a tope por el propio `respawn()`—. Las tres causas en una captura:
> `qa/capturas/2026-09-16T09-59-21-092Z-137869/…-01-reaparecido.png`.

---

## 3 · El bloque 4, comparado por el TEXTO

Ningún aserto se perdió; entran dos y uno cambia de nombre (le quitan «escalón 1», que era rastro).

| Antes (`HEAD~1`) | Ahora (`83953cf3`) |
|---|---|
| `sin interceptar, el borde vuelve a ser el del fichero (…)` | igual |
| `el jugador estaba MUERTO antes de la R (…)` | igual |
| `reaparece con la vida llena` | igual |
| `vuelve EXACTAMENTE donde cayó (escalón 1: el sitio libre gana)` | `vuelve EXACTAMENTE donde cayó` |
| `el punto en el que reaparece se puede PISAR (…)` | igual |
| *(nada: un `ctx.log` con `⚠ escalón 2 inalcanzable…`)* | **`hay un objeto sólido con el que medir la consulta de reaparición`** |
| *(nada)* | **`` `collidesAt` NO es una consulta de punto: la misma huella es sólida desde fuera y no con el jugador encima — por eso la reaparición no puede preguntar por sólidos (#538)``** |

Corrida real desde mi árbol (`NEFAN_PORT_OFFSET=400 node qa/run.mjs 93-la-velocidad`), los siete en
verde, `1 en verde · 0 en rojo de 1`, `censo de gasto: … (motor falso: $0)`.

Dos cosas que sí me convencen del cambio: el aserto «hay un objeto sólido con el que medir» separa
«no hay con qué medir» de «la asimetría cambió», que son noticias opuestas y con un `&&` habrían
colapsado; y la cabecera del guion deja escrito qué hacer el día que el aserto se ponga rojo (volver a
decidir la reaparición, no tocar el aserto), que es lo que impide que alguien lo «arregle».

---

## 4 · El guion que dejo · `qa/la-puerta-de-la-reaparicion.mjs`

Sin navegador, sin stack y sin créditos (unos segundos: `nefan-core/dist`, las fixtures del árbol y
aritmética). Está documentado en `qa/README.md`, junto a `equivalencia-de-cajas` y
`la-esquina-de-la-caja-se-corta`. Es un **candado**, no una reproducción.

```
$ node qa/la-puerta-de-la-reaparicion.mjs
1 · LA PUERTA: la reaparición no recibe ninguna consulta del mundo
  ✔ aridad 1 (`length` = 1)
  ✔ un argumento de más NO se llama: la consulta de solidez no tiene por dónde entrar
  ✔ y el punto devuelto sigue siendo el del cadáver (12.5, 0, -7.25)

2 · LA RETIRADA NO MUEVE A NADIE: `collidesAt(pos)` con el jugador EN `pos`, sobre las tres fixtures
    robledo_tile  plan true  · 16666 puntos · consigo mismo sólidos: 0 · desde otro sitio: 1592
    robledo_tile  plan false · 16666 puntos · consigo mismo sólidos: 0 · desde otro sitio: 2419
    puerto_tile   plan true  · 16658 puntos · consigo mismo sólidos: 0 · desde otro sitio: 2850
    puerto_tile   plan false · 16658 puntos · consigo mismo sólidos: 0 · desde otro sitio: 3960
    zorder_test   plan true  · 16642 puntos · consigo mismo sólidos: 0 · desde otro sitio: 971
    zorder_test   plan false · 16642 puntos · consigo mismo sólidos: 0 · desde otro sitio: 971
  ✔ 99932 puntos y NINGUNO se ve sólido a sí mismo: el escalón retirado no se alcanzaba…
3 · CONTROL: los mismos puntos, preguntados desde otro sitio del tile
  ✔ 12763 de 99932 SÍ dan sólido vistos desde otro sitio (12.8 %): hay mundo con el que medir
✔ la puerta sigue cerrada y la retirada de #538 no mueve a nadie en ninguno de los puntos medidos
```

**Probado en negativo por sus dos puertas**, y las dos salen 1:

- `QA_PUERTA_ABIERTA=1` mete la consulta de vuelta por la rendija de H-1 → bloque 1 rojo **con la
  aridad todavía en 1**, que es el hallazgo hecho ejecutable.
- `QA_SIN_SOLIDOS=1` deja el mundo sin una sola fuente de solidez → el CONTROL rojo. Anoto que a la
  primera **no se ponía rojo**: apagando solo terreno, plan y cajas, 3.072 puntos del borde seguían
  saliendo sólidos por la frontera del plano, o sea que mi propio control cubría menos de lo que
  prometía. Lo cazó el negativo, que es para lo que está.

Lo que el guion **no** hace y queda dicho: no corre en CI. Es candidato al job `candados-headless`
(no abre navegador, tarda segundos), pero tocar `ci.yml` y `banco-medido.json` no es mío: lo decide el
coordinador.

---

## 5 · Pasada adversarial — los cuatro estados que pide el encargo

| Estado | Antes | Hoy | Medido |
|---|---|---|---|
| Muere **dentro de un edificio** | reaparecía donde cayó (el escalón 2 no se alcanzaba) | igual | 99.932 puntos sin una sola diferencia; y sale andando por 8/8 rumbos |
| Muere **dentro de la caja de un spawn** del motor | igual | igual | los centros de cada objeto con huella entran en la malla del guion; `aabbBloquea` con `desde === hasta` exime por `yaDentro` idéntico |
| Muere **en el borde del tile** | igual | igual | `fronteraBloquea` con origen = destino compara el mismo conjunto de tiles ausentes: nunca bloquea. La frontera sigue frenando el paso HACIA el vecino ausente, que es lo que debe |
| Muere **sin tile bajo los pies** (era el escalón 3) | **ya era inalcanzable por DOS motivos independientes**: hacía falta que `solido()` dijera «sí» (nunca lo dice) *y* que no hubiera rect | devuelve el punto del cadáver | mismo barrido; y por lectura: el escalón 3 colgaba del `else` de una condición que nunca es cierta |

Conclusión de la pasada: **no hay ningún camino por el que un jugador note esta PR**, y no queda
ningún estado sin salida. El único cambio de conducta teórico que encontré es el de la tangencia
exacta (H-4), y va en la dirección buena.

---

## 6 · Workarounds usados durante la prueba, y su veredicto

1. **Sabotaje en el árbol** (H-1): edité `reaparicion.ts` y `main.ts`, corrí `verify`, y restauré
   desde copia. `git status --porcelain` vacío y `git diff --exit-code` limpio después. Es la forma
   que la casa usa para probar un candado en negativo; no contamina porque se restaura y se declara.
2. **`dist/` quedó sucio tras ese sabotaje** y mi primer intento del guion nuevo salió rojo **con el
   árbol limpio**: `verify` reconstruye `dist/`, así que el build conservaba la función saboteada.
   `dist/` está en `.gitignore`, o sea que `git status` limpio **no** significa build limpio.
   Reconstruido con `npm run build` antes de medir nada. Lo dejo escrito porque es una trampa para
   quien sabotee y mida después: el árbol dice la verdad y el build miente.
3. **Mutación local**: `reports/` no existía antes; tras `mutacion -- local reaparicion` lo borré
   entero para no bloquearle el `traer` al coordinador.
4. **`setPlayerPos` dentro del guion 93** (no es mío, es del banco): forzar la posición del jugador
   para preguntar la solidez desde fuera. No es un obstáculo para el jugador —es la única forma de
   preguntar una asimetría que por definición depende de dónde está—, y el guion lo declara en su
   comentario. **No lo cuento como hallazgo.**

No hice falta ocultar ningún overlay ni saltarme ninguna pantalla: el guion 93 arranca por el título
y el camino del jugador (`recargarAlTitulo` → `nuevaPartida` → `comenzar`), y muere peleando de
verdad con el hostil que suelta el motor falso.

---

## 7 · No probado

- **Si el pill «R reaparecer» sobrevive al respawn.** En la captura `…-01-reaparecido.png` el jugador
  está vivo (100/100), el registro ya dice `Respawned!` y el pill **sigue pintado**. Por construcción
  hay al menos un frame de retraso (`promptBar.set(…!eco.jugadorVivo…)`, `main.ts:654`, se calcula
  ANTES del `gameClient.tick()` que procesa el evento `player_respawned`), y el rAF puede estar
  frenado durante la captura, así que no puedo distinguir «un frame» de «se queda puesto». Es
  **preexistente y ajeno a esta PR**; si alguien quiere cerrarlo, se mide leyendo el pill N frames
  después del respawn.
- **Gasto real de créditos**: toda la verificación fue con el motor falso. El censo lo declara
  ($0) y no he ejercido ninguna puerta de pago de verdad.
- **La corrida de mutación de CI**: `deuda` avisa de lo esperado, que `reaparicion` queda
  «posiblemente obsoleta» hasta la siguiente autorización. La medida local (2 mutantes, 0 vivos) la
  reproduje; el delta oficial lo dirá el reparto.
- **Las PR 1 y 2 de la tanda**: no las he mirado. Aviso de interacción, para el coordinador: la PR 1
  cambia `aabbBloquea` a «penetración no creciente», y mi barrido de 99.932 puntos sobrevive a ese
  cambio por construcción (con origen = destino la penetración no crece), pero el 8/8 de «sale
  andando» habrá que volver a medirlo con la forma nueva.

---

## 8 · Qué merece issue y qué vuelve al ingeniero

**Vuelven al ingeniero, en esta PR:** H-1 (los cuatro asertos de la puerta), H-2 (la fixture), H-3
(la frase del informe) y H-4 (el absoluto, en los tres sitios donde está escrito). Ninguno es más de
un rato.

**No es de esta PR:** H-6 va al checklist de fusión de la PR 1. H-7 sigue siendo el bloqueo para
cerrar #538 y necesita el issue hermano con el cuerpo que ya está escrito, más la captura de hoy.

**Issue nuevo que propongo**, porque no es de #538 y se pierde si no se escribe:

> **`Function.length` no es una puerta: los candados de aridad del núcleo se saltan con un parámetro
> opcional**
> `test/reaparicion.test.ts` canda la retirada de #538 con `puntoDeReaparicion.length === 1`.
> Medido el 2026-09-16: reintroduciendo la consulta como `solido: (…) => boolean = () => false` y
> recableándola desde `main.ts`, `npm run verify` da 2847/2847 en verde y el aserto de la aridad
> sale ✔ — o sea, el defecto entero de vuelta sin un solo rojo. El patrón «aridad como puerta» hay
> que mirarlo allí donde se haya usado: la forma que sí cierra es afirmar que un argumento de más ni
> se llama ni cambia el resultado. Ejecutable con el sabotaje y su negativo:
> `qa/la-puerta-de-la-reaparicion.mjs` (`QA_PUERTA_ABIERTA=1`). Etiquetas: `nucleo`, `tests`.

---

## 9 · Veredicto

**APTO CON HALLAZGOS.** Lo que el usuario pidió —borrar la rama que nadie podía pisar, con todo su
rastro, sin tocar H10— está hecho y, por primera vez en este expediente, **medido**: 99.932 puntos y
cero diferencias. El jugador no nota nada, que es exactamente lo que tenía que pasar, y no queda
ningún estado sin salida. Lo que falla es la garantía, no la conducta: el candado que la PR vende
como «la puerta de la retirada» sale verde con el defecto puesto, y eso es lo que esta casa lleva
quince veces pagando. H-1 y H-2 antes de fusionar; #538 no se cierra hasta que H10 tenga dueño.
