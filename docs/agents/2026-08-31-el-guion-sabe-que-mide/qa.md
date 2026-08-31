# QA — El guion sabe qué mide y puede decir ⊘ (#331 + #332)

Validado el 2026-08-31 sobre `tanda/el-guion-sabe-que-mide` (10 commits sobre main
`8673042`, HEAD `f04336c`), desde el punto de vista de quien corre `node qa/run.mjs`
y decide con su informe. Máquina limpia al empezar (ningún puerto del catálogo
ocupado). Cero créditos: todo contra `e2e-sin-creditos`/`html-fixtures`.

## Criterios (vara: `requisitos.md` de esta tarea)

| # | Criterio | Veredicto | Evidencia |
|---|----------|-----------|-----------|
| 1 | `ctx.sinMedir(motivo)` existe, ABORTA, ⊘ pintado y contado aparte | ✅ cumple | Batería de candados `331` cara 1: el 34 con `puerto_tile_inexistente` sale **⊘ exit 2** con huella `/declarado por el guion.*puerto_tile_inexistente/` — no rojo ni verde. Guion adversarial propio (92): declarado desde un helper a DOS niveles de pila, tras un `shot` → `⊘ … — declarado por el guion: <motivo>`, y el `expect("NUNCA debería llegar aquí")` posterior no llegó a correr (abortó de verdad). El resumen lo pinta con su propio icono y el pie lo cuenta aparte: `0 en verde · 0 en rojo · 2 SIN MEDIR de 2` |
| 2 | El canal no es vía de escape: motivo obligatorio, ⊘ visible, exit 2, reconversión vetada | ✅ cumple (2 bordes menores, abajo) | Motivo vacío → **rojo** «ctx.sinMedir exige el MOTIVO … y llegó ""» (guion adversarial 91 y entrada de candado probada, abajo). Cara 2 de la batería `331`: cebo `expect(false)` antes de declarar → **rojo exit 1** con huella `/no puede reconvertirse\|amnistía/`. Exit 2 + «esta corrida NO es un veredicto del juego» observados en 3 corridas distintas. La divergencia con los ⊘ del runner está escrita en el catch (`run.mjs:864-871`) |
| 3 | Una sola escala de veredictos | ✅ cumple | `ICONO` con `⊘` definido en UN sitio (`qa/lib/veredictos.mjs:24`); todos los demás `⊘` de `qa/` son prosa o mensajes con la misma semántica. `presets-clasifica.mjs` sin `AJENO` como estado (queda `ajenos[]` como detalle, y su exit conserva el matiz: degrada a 2 CUALQUIER ocupante ajeno). `veredictos.test.ts` **nace rojo** (mutado mentalmente `exitDeCorrida → 0`, fallan «rojos→1», «sin medir→2» y «el 2 gana al 1»; el ⊘-exclusivo caza un segundo estado con el icono). `presets-clasifica.test.ts` reescrito conserva los 9 casos incl. el matiz del ajeno |
| 4 | Migración a `qa/lib/fixtures.mjs`; negativos exceptuados con comentario; grep de INVOCACIONES | ✅ cumple | `grep -rn 'nefan("loadFixture"\|__nefan.loadFixture(' qa/` → **exactamente 4**: `lib/fixtures.mjs:46`, `44:75`, `44:94`, `24:87`. El 44 lleva su razón en `:69-75` (precondición que ESPERA a propósito) y el 24 la suya sobre `:87` («mide que el hook RECHAZA; migrarla borraría el negativo de #308»). Diffs de los 12 guiones revisados (01/06/10/15/25/30/32 línea a línea); los 3 scripts usan `ctxDeSonda(page)` + `cargarFixture` |
| 5 | La migración compra algo, probado en negativo | ✅ cumple | Batería `308` → 3/3 cazan, incl. el 01 migrado: rojo que NOMBRA («se pidió la fixture «robledo_tile» y el mundo se quedó en «null»»). Adversarial propio con OTRO guion y OTRO destrozo: `loadFixture` parcheado para cargar SIEMPRE `puerto_tile` (fixture equivocada puesta, no promesa rota) → `node qa/run.mjs 30-el-bosque` sale **rojo**: «se pidió la fixture «robledo_tile» y el mundo se quedó en «puerto_tile»». Revertido, `git status` limpio |
| 6 | Ningún guion elige fixture por posición; el 25 nombra | ✅ cumple | Diff del 25: muere el `filter(Boolean)[0]`, entra `cargarFixture(ctx, "robledo_tile")` con el porqué escrito. Grep de picks sobre `options` en guiones: los hits restantes son el 23 (enumera TODAS — es su sujeto), el 12 y un log del 28; el 34 busca por NOMBRE (`includes(f)`) |
| 7 | `cerrarMuroSiHay` medido una vez y borrado | ✅ cumple | `grep -rn cerrarMuroSiHay qa/` → **0**. El commit `f097989` documenta la medida completa: 4 guiones, 7 llamadas, corrida instrumentada `16 22 23 30` → 4 verdes y 0 «MURO PRESENTE», y a quién queda el caso del muro real (`fixtures-sin-bridge`/`captura-de-fixture`, que lo cierran por su botón — verificado abajo) |
| 8 | Presupuesto sin escribir en `data/scenes/`; primera corrida contra cliente ya arrancado | ✅ cumple | Reproducido el caso que fallaba, agravado: preset `html-fixtures` en bloque **+500 con la batería completa VIVA en +0** (el escenario de la desviación). `main.ts` transformado antes (curl 200), `node qa/presupuesto-de-volumenes.mjs 120` → **tabla a la PRIMERA** (`120 (120) 670.5 · 115.8 · 91.2 fps` — humo, no presupuesto: máquina compartida), `git status` limpio en `data/scenes/` antes y después. `fixtures-sin-bridge` → «✔ html-fixtures pinta sin backend» **pese al bridge ajeno vivo en :9877** — el muro «sin bridge» solo puede aparecer si la página habla con SU bloque, o sea que la desviación del `?offset=` compra exactamente lo que declara. `captura-de-fixture robledo_tile` → captura correcta (escena clay coherente, selector en robledo, panel de errores con el fail-loud, luz única y escalas bien) |
| 9 | `verify` verde; batería completa con los mismos verdes; deuda sin crecer; PR con `Closes` | ✅ cumple (la PR, del coordinador) | `npm run verify` → **1675 tests, 0 fail, exit 0**. `node qa/run.mjs` → **45 en verde · 0 en rojo · exit 0** — y 45 son TODOS los guiones (46 ficheros menos el 04 inexistente), así que «mismos verdes que la base» no admite hueco. `npm run deuda` → 65 items, todos «ya estaban»/«base de otro código», cero NUEVO. La PR no existe aún (sin push, como declara `implementacion.md`): el `Closes #331`/`Closes #332` queda para el coordinador |

## Hallazgos (priorizados)

1. **[importante · pre-existente · digno de issue] El hint del muro de bootstrap
   interpola el puerto por defecto, no el resuelto.** Confirmado y es peor de lo que
   suena: con `?offset=500` el WebSocket real falla contra `ws://127.0.0.1:10377` y el
   muro dice «is nefan-core bridge running on **ws://localhost:9877**?» — y en :9877
   puede haber un bridge VIVO de otro stack (lo había: el de la batería), así que el
   mensaje manda a comprobar un puerto donde todo parece estar bien. Las dos líneas
   contradictorias salen JUNTAS en el panel de errores (captura
   `qa/capturas/qa-validacion-criterio8.png`). Reproducción:
   `NEFAN_PORT_OFFSET=500 ./start.sh --preset html-fixtures` → abrir
   `http://localhost:3500/?offset=500` → leer `#narrative-loader-detail`. Causa:
   `nefan-html/src/net/game-client.ts:247` interpola `CONFIG.ports.bridge` (constante
   de módulo, ciega al query param) en vez del puerto que resolvió
   `serviceUrl("game-gateway")`. Fuera del alcance de la tanda (no se tocó); NO se
   arregló aquí.

2. **[menor] La sentinela de `sinMedir` es capturable por el propio guion.** Un
   `try { ctx.sinMedir(...) } catch {}` se la traga y el guion sigue y puede salir
   VERDE (guion adversarial 90: salió `✔`). Límite estructural de JS, no exigido por
   los criterios — pero pesa para #261: 44 de los 72 catches son `.catch(() => null)`,
   y un helper con catch genérico haría exactamente esto sin querer. Mitigación barata
   si se quiere: `sinMedir` deja una marca en el ctx ANTES de lanzar, y el runner veta
   el verde de un guion con la marca puesta cuya sentinela nunca llegó.

3. **[menor] Un bug real del cliente puede quedar bajo el velo de un ⊘ declarado.**
   Las excepciones de página se recogen DESPUÉS del catch del runner, así que no vetan
   la reconversión ni se pintan en el resumen (solo fallos de ROJOS se listan). Guion
   adversarial 93: pageerror provocado + `sinMedir` → veredicto `⊘` con el pageerror
   solo en el log en línea (`✘ 1 excepción(es) en la página`), invisible en el resumen.
   El exit 2 protege a nivel de corrida; a nivel de diagnóstico la excepción se pierde.
   Coherente con la divergencia documentada de los ⊘ del runner, pero es un borde que
   el criterio 2 no contempló — decisión para el coordinador si merece endurecerse.

4. **[menor · cosmético] La batería de candados confirma un ⊘ esperado con
   «lo caza …: (sin nombre)».** `motivos()` extrae líneas `· `/`✘ `, y el motivo de un
   ⊘ vive en la línea `⊘ nombre — motivo`: la confirmación de la cara 1 de #331 no
   enseña el motivo (la huella sí lo verificó). Solo legibilidad.

5. **[observación] El mensaje de `cargarFixture` atribuye toda divergencia a la carga
   tardía.** Mi destrozo de «fixture equivocada» (hallazgo 5 de la tabla) produce «la
   carga no había llegado cuando loadFixture dijo que sí (#308)» cuando la causa real
   era otra. Nombra las dos escenas — que es lo que permite diagnosticar —, pero la
   frase explicativa puede despistar. No bloquea.

6. **[operativo · para el coordinador] `./start.sh --parar` para por WORKTREE, no por
   bloque de puertos.** Lo ejercí por error: con `NEFAN_PORT_OFFSET=500` esperaba parar
   solo el +500 y se llevó también el stack de la batería completa en marcha (+0,
   mismo worktree). Es el comportamiento DOCUMENTADO («lo de ESTE worktree»), pero con
   `qa/run.mjs` eligiendo bloques dentro del mismo worktree, la tecla `k` puede matar
   una batería en curso. Efecto secundario valioso: la batería truncada reaccionó
   exactamente como promete la escala — 28 verdes, **0 rojos falsos**, 17 `⊘` con el
   motivo del stack caído y el epílogo «no son 17 guiones rotos» — el canal del runner,
   visto en producción sin buscarlo.

## Workarounds usados (regla del workaround)

- **4 guiones adversariales temporales** en `qa/guiones/90…93-*.mjs` (retirados del
  árbol tras la medida; conservados en el scratchpad de la sesión). Material de
  prueba, no camino del usuario.
- **Dos destrozos temporales revertidos**: `main.ts` (loadFixture → fixture equivocada
  siempre) para el criterio 5, y una entrada extra en
  `bateria-candados-en-negativo.mjs` para probar «motivo vacío». `git status` limpio
  tras cada uno.
- **La primera corrida de la batería completa la invalidé yo** (hallazgo 6): la
  corrida que vale es la segunda, limpia de punta a punta (45/45, exit 0 leído del
  runner, sin pipe).
- `npm run verify` corrió con los 4 guiones adversariales presentes como ficheros sin
  trackear; no afectan (exit 0, y retirarlos no puede subir ningún conteo congelado).

## No probado

- La parte de PR del criterio 9 (`Closes #331`/`Closes #332`, CI verde): la rama no
  está pusheada — la hace el coordinador después de este informe.
- El canal desde DENTRO de `waitFor` (#261): fuera de alcance declarado; el diseño
  (sentinela a profundidad de pila) quedó demostrado con el guion 92.
- Las cifras del presupuesto como presupuesto real: medidas con la batería en
  paralelo; el criterio era la tabla a la primera y el árbol limpio.
- La rama «⊘ NO esperado → `sinMedir[]`, nunca éxito» de la batería de candados
  (`codigoEsperado ≠ 2` con salida 2): verificada por lectura, no ejercida.

## Entrada de candado propuesta (probada cazando; NO commiteada)

Verifica que el motivo vacío se rechaza — la única cara del canal que la batería de
candados no cubre y que probé a mano. Corrida real: `🔴 rojo … lo caza: ERROR:
34-…: ctx.sinMedir exige el MOTIVO … y llegó ""` (exit 0 de la batería). Para pegar
en `INVARIANTES` de `qa/bateria-candados-en-negativo.mjs`:

```js
  [
    "#331 · el motivo vacío se RECHAZA: rojo que exige el motivo, no un ⊘ mudo",
    join(raiz, "qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs"),
    "34-con-el-titulo",
    [
      ['const FIXTURE = "puerto_tile";\n', 'const FIXTURE = "puerto_tile_inexistente";\n'],
      ["    ctx.sinMedir(\n", '    ctx.sinMedir(\n      "" ??\n'],
    ],
    /sinMedir exige el MOTIVO/,
  ],
```

(`"" ?? <template>` evalúa a `""`: fuerza el motivo vacío sin tocar el template.)

## Legibilidad del informe (crítica de producto)

Leído como recién llegado: el `⊘` se distingue del rojo en la línea del guion y en el
resumen, el motivo viaja completo a los dos sitios, el pie separa «K SIN MEDIR» de
verdes y rojos, y el epílogo «esta corrida NO es un veredicto del juego» quita la
tentación de leer los verdes como aval. El motivo del 34 dice qué faltó, dónde y qué
bloques se pararon con él — accionable sin abrir el guion. La caída real de mi
hallazgo 6 se diagnosticó de un vistazo con el informe solo. Las fricciones que
quedan son los hallazgos 3 y 4.

## Veredicto

**APTO.** Los nueve criterios se cumplen con evidencia ejecutada (el 9 completo salvo
la PR, que por diseño va después). Los hallazgos son menores o pre-existentes y
ninguno bloquea la tanda; el 1 (hint del muro con `:9877` fijo) merece issue propio.
