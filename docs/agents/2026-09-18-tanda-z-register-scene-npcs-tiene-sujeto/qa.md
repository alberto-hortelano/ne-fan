# QA — Tanda Z, «`registerSceneNpcs` tiene sujeto» (#431, absorbe #468)

Validado el 2026-09-20 sobre la rama `feature/tanda-z-register-scene-npcs-tiene-sujeto` (commit
`8d370e0b`) en el worktree `/home/al/code/ne-fan-tanda-z-register-scene-npcs-tiene-sujeto`, contra
los CINCO criterios del reencuadre del crítico (los que el coordinador aceptó), no contra los cuatro
originales del issue. Máquina cargada (load 9-10, otras tandas en marcha): todo lo del navegador va
en segundos de simulación y salió estable igual. Cero créditos en toda la prueba (`e2e-sin-creditos`,
`qa/run.mjs` eligiendo bloque de puertos solo: +200, +300 y +400).

## Criterios → veredicto → evidencia

| # | Criterio (reencuadre) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Bloque «Legacy scenes: `npcs[]`» borrado y su prosa con él; `grep -n "sceneData.npcs\|legacy\|Legacy" src/narrative/npc-records.ts` → 0; el acumulador `npcs` de `:31` se queda | ✅ cumple | `git diff main`: −28 líneas (`:76-102` + docblocks). El grep sale vacío (exit 1). `grep -n npcs` da 4 líneas, las cuatro el acumulador vivo (`:31`, `:67`, `:80`, `:85`). Fuera del fichero: `grep -rn "npcs\[\] con position\|legacy (npcs\|Legacy scenes: npcs"` sobre `*.ts,*.md,*.json,*.py` excluyendo `docs/agents` y `dist` → 0 |
| 2 | Sale del `!ruta` de `serialize-llm`, módulo propio `npc-records` con batería `narrative-state.test.ts` + `narrative-tiles.test.ts`, `break: "sin medir"`; el `porque` de `serialize-llm` pasa de cuatro a tres exclusiones; `npm run ejercicio` demuestra invocación | ✅ cumple | `grep -c '"!src/narrative/npc-records.ts"' mutation-targets.json` → 0; `grep -c "CUATRO EXCLUSIONES"` → 0 (el único «de los nueve» que queda es de los «nueve titulares» de otro módulo, `:571`). Módulo nuevo en `:986-996`. `npm run ejercicio -- npc-records` → «1 fichero(s) mutado(s) en 1 batería(s), 1.1s de reloj. Todas las baterías EJERCEN lo que su módulo muta». Verifiqué con el instrumento del plan las cuentas que firma el `porque`: `testsQueImportan(["src/narrative/npc-records.ts"])` → `['test/narrative-state.test.ts']` (= 1) y `testsQueImportan(["src/narrative/types.ts"]).length` → 12 (un `grep -l "narrative/types"` da 15; el que cuenta es el del plan). `narrative-tiles.test.ts` en las baterías de `main`: 0 (cierto que entra hoy por primera vez) |
| 3 | La primera medida se PIDE y no se espera; `local` se niega por coste desconocido; ningún test nuevo por decreto | ✅ cumple | `npm run mutacion -- pendiente` → «Se medirían 66 de 66 módulos … + 1 módulo(s) sin base: npc-records», y `npc-records` NO aparece en «Medibles aquí». `npm run mutacion -- local npc-records` → «NO se mide aquí: no hay medida previa de npc-records … Pídelo», `EXIT=1`. Ningún test de `npc-records` añadido (el único test nuevo es el candado de `mutation-config.test.ts`, ver hallazgos). `mutacion-huella.json` sin entradas de `npc-records`: el candado de «`sin medir` con número en la huella» no tiene todavía sujeto, como debe |
| 4 | CRAP de `registerSceneNpcs` < 68,5 sin que otra suba sobre su tope | ✅ cumple | Medido por mí: `npm run coverage` (3118/3118, 0 fail) y `npm run crap` → `28.0 28 100% registerSceneNpcs · src/narrative/npc-records.ts:14`; peor de la casa `handle · services/asset-store/http-server.ts:98` con 47,8 (cx 46, 91 %); «Tope (no empeorar): CRAP ≤ 73 — 0 por encima»; cobertura 96,16 %. `npm run crap -- --check` → «✔ dentro de los umbrales». `npm run deuda` → `grep npc-records\|registerSceneNpcs` sobre su salida: 0 líneas; la cola de CRAP la abre `handle — CRAP 48` |
| 5 | La nota `crap` de `quality-thresholds.json` deja de nombrar a #431 como «el sujeto que falta» y dice la medida nueva | ✅ cumple | `grep -c "sujeto que falta"` → 0. La nota dice 47,8 (cx 46, 91 %) para `handle` y 28,0 (cx 28, 100 %) para `registerSceneNpcs`: los cuatro números coinciden con mi `npm run crap` de hoy. `max` 73 y `objetivo` 30 sin tocar, como decidió el coordinador |
| F | Flujo real (§7 del plan, que el ingeniero NO corrió): entrar a un tile con NPCs, salir y volver | ✅ cumple | Guion nuevo `qa/guiones/154-ir-y-volver-no-repone-a-los-npc-del-tile.mjs`: **4 de 4 en verde** con la versión definitiva (par `09-viaje → 154` en +200 y tres aisladas en +300/+400) y **3 de 3 en rojo** en negativo (abajo). Además los 13 guiones que ejercen NPCs de escena, aislados: `07 09 126(×2) 128 15 42 50 54 57 58 66 81` → **13 en verde · 0 en rojo** (bloque +300, capturas en `qa/capturas/2026-09-20T10-53-42-196Z-186374`) |
| F.a | Purga al re-entrar de los `scene_init` que la escena deja de declarar | ⚠️ no probado en flujo real | El motor falso es determinista: re-difunde la MISMA escena, así que no hay `scene_init` que deje de figurar. Producirlo exigiría forzar la escena (regla del workaround). Lo sujeta `narrative-tiles.test.ts:116-124` («viejo» desaparece), ahora con mutación pedida |
| F.b | Mover por `firstRegistration` (mismo id declarado por OTRA escena en su primer registro) | ⚠️ no probado en flujo real | El destino del bench declara `${place.id}_vecino`, nunca un id ya vivo. Lo sujeta `narrative-tiles.test.ts:127-166` (Nogala). Lo que SÍ se jugó es el contrario: re-broadcast con `firstRegistration:false` **no teletransporta** (bloque 5 del guion 154) |
| F.c | Preservación de posición e inventario al re-entrar | ✅ posición · ⚠️ inventario | Posición: bloque 5 del 154 (tabernero, record puro: había huido 1,08-3,19 m según corrida y sigue lejos de su celda tras volver) y 5b (bandido, lo que ve el jugador). Inventario: los NPC del bench no tienen; lo cubre el mismo `it` de Nogala en unitario |
| N | Negativo del `!ruta` (§7 del plan) | ✅ cumple | Reintroducido `"!src/narrative/npc-records.ts"` en `serialize-llm` con el módulo nuevo puesto → `mutation-config.test.ts` **rojo** (33 pass · 1 fail): «módulo "serialize-llm": excluye "src/narrative/npc-records.ts" … y además lo muta el módulo "npc-records": decide una cosa». Revertido con `git checkout` |
| C | `npm run verify` que declara el ingeniero | ✅ (parcial, medido) | No repetí `verify` entero; sí `coverage` (= `npm test` con cobertura: 3118/3118), los 9 tests que leen el plan de mutación (464 pass) y los 7 que leen el árbol de `qa/` con el guion nuevo dentro (106 pass). El build y los `tsc` los dejo a la CI de la PR |

## El guion 154, y por qué está escrito así

> **Renumerado 150 → 154 antes de commitear** (#680: el número de un guion lo decide la FUSIÓN, no
> quien lo escribe). En `main` el 150 y el 151 son de la tanda U, el 152 lo traen AD y AF, y el 153
> AB. Las capturas de esta sesión de QA llevan el prefijo `150-` porque se tomaron antes del
> renumerado; el fichero, la fila del README y este documento dicen 154.

`qa/guiones/154-ir-y-volver-no-repone-a-los-npc-del-tile.mjs` (fila sembrada en `qa/README.md`,
después de la del 149; el número lo decide la fusión, #680). Entra por el camino del jugador:
regenerar mundo → nueva partida → acercarse al bandido (lo engancha y persigue) → acercarse al
tabernero y un golpe al lado (huye, como mide el 15) → panel «Salidas» → ida → panel → vuelta. Lee el
LEDGER del save (`entities` de `state.json`, que es lo que `registerSceneNpcs` escribe) antes, en el
destino y al volver, y `enemies()`/`npcs()` del cliente. Afirma: los dos `scene_init` de `tile_0_0`
siguen **con su `spawned_at` original** (conservar ≠ reponer); ningún id dos veces; el vecino del
destino con `scene_id` del destino; el tabernero lejos de su celda tras volver si al irnos había
huido ≥ 0,5 m (si no, `sinMedirBloque`); el bandido fuera de su celda en save y cliente.

**Probado en negativo tres veces** (sabotaje `sed` sobre `npc-records.ts:82`, quitando
`&& !ids.has(e.id)` del filtro de purga —el mutante «purga a los que la escena SIGUE declarando» que
nombra el `porque` del módulo—, corrida, `git checkout`, `git status` limpio comprobado en el log):

| Corrida | Rojos | Detalle |
|---|---|---|
| neg-1 (versión inicial) | 2 | `spawned_at` nuevo en `bandido_1` y `barkeep`. **El aserto de posición del bandido se quedó VERDE con el sabotaje puesto** → ver hallazgo H2 |
| neg-2 | 2 + bloque 5 ⊘ | identidad ×2; el tabernero solo había paseado 0,89 m (< 1 m) → declarado sin medir |
| neg-3 (definitiva) | 3 | identidad ×2 + «barkeep sigue lejos de su celda» con `alVolver = [7.75, 0, -0.25]`, su celda EXACTA |

Positivos con la versión definitiva: par 09→154 (paseo 1,18 m) y aislados ×3 (1,32 · 1,08 · 3,19 m):
todos con el bloque 5 MEDIDO, 0 ⊘. Con la versión anterior (sin el golpe) el bloque 5 salió ⊘ en 1 de
4 (tabernero a 0,00 m de su celda al irnos), y por eso el golpe: su micro-wander solo no es fiable.

## Hallazgos

Ninguno bloqueante. Ninguno de los cinco criterios falla.

**H1 · importante (candado nuevo, frontera declarada incompleta) — el candado «una exclusión `!ruta`
DECLARATIVA no tapa lo que otro módulo ya mide» no ve el estado en que vivió #431, y no lo declara.**
Pasada adversarial sobre `mutation-config.test.ts` con cuatro construcciones del reparto (cada una
aplicada, corrida y restaurada con `git checkout`):

| Construcción | Qué dice `npm test` |
|---|---|
| B1 · `!src/narrative/npc-records.ts` reintroducido en `serialize-llm` CON el módulo `npc-records` puesto | **rojo** (el negativo del plan, correcto) |
| B2 · módulo `npc-records` borrado + `!ruta` reintroducido + motivo caducado escrito («`testsQueImportan` da 0», que hoy es falso: da 1) | **verde 34/34**. Es EXACTAMENTE el estado del árbol del 16-09 al 20-09 que esta tanda vino a corregir: una declarativa cuyo motivo es medible con el propio instrumento del plan y es mentira, sin que nadie más la mida |
| B3 · módulo `npc-director` borrado, dejando el carve-out `!src/world-map/npc-director.ts` de `world-map` en pie | **verde 464/464** en los 9 tests que leen el plan; `dueñoDe` dice que `world-map` es su dueño (cuenta los negados), así que `npc-director.ts` queda en el perímetro SIN MEDIDA y con dueño. Solo `npm run mutacion -- pendiente` lo menciona de pasada («desaparece(n) del plan npc-director: lo que mutaban puede haberse quedado sin dueño»), que fuerza la completa pero no pone nada en rojo. `lotes` calla |
| B4 · la misma declarativa (`!src/narrative/types.ts`) en dos módulos, sin que nadie la mida | verde 34/34: dos motivos para el mismo fichero, `dueñoDe` devuelve el primero |

El candado afirma lo que su nombre dice y lo prueba en negativo (B1), y su comentario declara dos
agujeros («carve-out con motivo caducado», «`!ruta` que no nombra a nadie»). **Lo que no declara es
B2**: una declarativa con motivo caducado y sin medida ajena — el caso de origen de la tanda — sigue
verde, y el motivo de #431 era una afirmación que `testsQueImportan` (la misma función que usa el
candado de baterías) desmiente en una línea. **Y B3 es el espejo del mismo agujero**: el comentario
del candado justifica saltarse los carve-outs porque «otro módulo lo mide», pero no comprueba que ese
otro módulo exista; un carve-out huérfano deja un fichero del perímetro sin medida en verde, que es
el estado que el candado de huérfanos existe para impedir. B3 y B4 son preexistentes (no los abre
esta PR); B2 es la frontera del candado NUEVO y debería estar escrita en su comentario, o cerrada:
para una declarativa cuyo motivo cite `testsQueImportan`, medirlo es una llamada. Propuesta: issue
(o el mismo ingeniero, si el coordinador lo quiere en esta PR): (a) declarar B2 en el comentario;
(b) candado hermano: todo carve-out (`!ruta` que sale de los positivos del propio módulo) tiene OTRO
módulo que lo muta, o se pone rojo.

**H2 · menor (medida, no defecto) — «la posición del NPC se conserva al re-entrar» NO se puede
afirmar del record leyendo la posición de un hostil en el save.** Con el record del bandido borrado y
recreado por el sabotaje, el save lo mostró en (9,69 · 1,28) —su posición viva— y no en su celda:
`save()` vuelca la posición de los hostiles desde el sim de combate, así que el record repuesto
salió del save como si se hubiera conservado. El detector posicional honesto del record es un NPC
sin cuerpo en el sim (el tabernero), y así quedó el guion. Lo apunto porque cualquier guion futuro que
«mida preservación» sobre un hostil vía save medirá el sim, no el ledger (el 54 lo sabe: mide el
resume, donde es el sim quien reconstruye).

**H3 · menor (experiencia, ajena a la tanda) — al volver del viaje el jugador aparece de cara a una
pared oscura.** Captura `…/150-…-02-de-vuelta.png` (prefijo de antes del renumerado) (corrida 10-57-35): el fotograma de vuelta es casi
negro, el spawn de retorno mira a la fachada/interior de la taberna a un palmo, con el bandido a 60 de
vida encima (el combate siguió). No es de `npc-records` (el punto de spawn lo decide el viaje, #616 y
guion 144), pero un jugador que vuelve y ve negro pensará que se ha colgado. Para el backlog del viaje,
no para esta PR.

**H4 · menor (docs) — `implementacion.md` dice «16 y 16 invocaciones» para las dos baterías y luego
«32 llamadas a `registerSceneNpcs` y 13 a `npcBehaviorExtras`»**; el `porque` del módulo dice lo
segundo. No lo remedí (el `ejercicio` público no imprime cuentas), pero el dato que va al contrato es
el del `porque`, y coincide con la suma. Solo señalo que el informe tiene dos cifras para lo mismo.

## Workarounds usados

- **Ninguno en el flujo del jugador.** Título, mundo, «Comenzar», teclas, panel «Salidas» y clics; ningún
  `display:none`, ningún estado forzado, ningún `setPos`.
- **Sabotaje de `npc-records.ts` para el negativo** (tres veces, `sed` + `git checkout`), con el árbol
  de código limpio comprobado después de cada una (`git status --short nefan-core/src` vacío en los
  tres logs). No es un workaround de observación: es la prueba en negativo que el rol exige, y no
  quedó nada de ella en el árbol.
- **Ediciones de `mutation-targets.json` para la pasada adversarial** (B1-B4), restauradas igual.
- Un golpe al lado del tabernero para que HUYA (y el bloque 5 tenga algo que distinguir): es una acción
  del jugador (LMB), no un forzado, y el guion la explica.

## No probado, y por qué

- **La mutación de `npc-records`**: pedida, no obtenida (no se lanza una corrida con 11 tandas en la
  máquina; `local` se niega y así debe ser). El módulo vive con `sin medir` hasta la corrida; la
  estimación de ~90-110 mutantes es del ingeniero, no medida.
- **Purga real y mover por `firstRegistration` en el juego** (F.a, F.b): el motor falso no los produce
  sin forzar la escena; cubiertos en unitario, con la medida de mutación pendiente.
- **Inventario al re-entrar** (F.c): los NPC del bench no llevan inventario.
- **`npm run verify` entero** (build + `tsc` ×3 + lint): corrí `npm test` con cobertura y los
  candados que tocan lo cambiado; el resto lo dice la CI de la PR.
- **La batería de navegador COMPLETA**: no corrida (13 guiones de NPC aislados + el 154 en par y
  aislado, sobre una máquina a load 10). Quien fusione la mide, como manda `requisitos.md`.

## Estado del árbol al cerrar

`git status`: `M qa/README.md` (fila del 154) y `?? qa/guiones/154-…mjs`. Nada más tocado. Los stacks
que levantó `qa/run.mjs` los paró él (bloques +200/+300/+400 libres al terminar; lo que queda arriba
en la máquina —`:3000`, `:3100`, `:3200`, `:18765`, `:18865`— es de otros worktrees, comprobado por
`/proc/<pid>/cwd`, y no se ha tocado).

## Veredicto

**Apto con reservas.** Los cinco criterios del reencuadre se cumplen y están medidos por mí, no
heredados; el flujo real que faltaba se jugó y tiene guion con negativo. La reserva es H1: el candado
nuevo nace con una frontera sin declarar que es justo el estado del que viene la tanda (B2), y su
comentario apoya el salto de los carve-outs en una premisa que no comprueba (B3). Ninguna de las dos
tumba la PR; las dos van escritas o van a issue antes de fusionar.
