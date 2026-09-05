# QA-C · PR #455 (issue #411) — **APTO CON HALLAZGOS**

Worktree `/home/al/code/ne-fan-t13-qa-c`, HEAD `83cf0ca` (rama de la PR) contra `main` = `3a0f8ef`. 2026-09-05.
Cero créditos, cero servicios: la PR es JSON + un test; nada arranca. CI de la PR: 5/5 verde (`gh pr checks 455`).

## Criterios (los del issue, literales) → veredicto

| Criterio | | Evidencia |
|---|---|---|
| «Que la regla nombre las dos llamadas por fichero y función» | ✅ | `arch-rules.json` regla `solo-el-bridge-normaliza-la-escena`: `exceptions[0].path = nefan-html/src/main.ts`, `reason` empieza «`addTileRaw`: …»; `exceptions[1].path = nefan-html/src/ui/style-apply.ts`, `reason` empieza «`StyleApplyController.plan`: …». Comprobado contra el código: `main.ts:807` es `const addTileRaw = (raw, opts) => addTile({ ...formatDToWorld(raw), exits: [] }, opts)`; `style-apply.ts:205` está dentro de `async plan(gameId, styleId)` (`:139`) de `export class StyleApplyController` (`:121`). **Salvedad**: «por función» lo dice la prosa del `reason`; el checker exime por FICHERO y nadie verifica la función (H1) |
| «Que la prosa deje de citar el cliente 2D» | ✅ (la regla) / ⚠️ (el fichero) | `desc` y `why` de la regla: 0 apariciones de «2D». `grep -c "cliente 2D" arch-rules.json`: **6 → 5**. Las 5 que quedan son `desc`/`why` de OTRAS cuatro reglas (líneas 116, 167, 184, 226, 373) — fuera del criterio literal, dentro de «los rastros confunden a los agentes» (H3) |
| «Que `max` se haya resuelto» | ✅ | `severity: "error"`, sin `max`. `npm run deuda`: fronteras **15 → 13** (las dos llamadas contaban como deuda congelada de la regla `warn`); total **72 → 70** en mi máquina con CRAP sin medir (= 83 → 81 con los 11 de CRAP del informe). Confirmado corriendo `deuda` con el JSON de `3a0f8ef` puesto y luego restaurado |
| Las llamadas del cliente son exactamente las dos nombradas | ✅ | `grep -rn "formatDToWorld(" nefan-html/src` → `main.ts:807`, `ui/style-apply.ts:205` y nada más (`:11` y `:34` son imports; `carga-de-tile.ts:218` y `style-apply.ts:274` son comentarios sin paréntesis, que el patrón `formatDToWorld\s*\(` no casa) |
| El candado se pone ROJO con una tercera llamada en otro fichero | ✅ | N1: `printf 'const __tercera = formatDToWorld({} as never);' >> nefan-html/src/world/carga-de-tile.ts` → `architecture.test.ts` 76/77, `✖ [error] solo-el-bridge-normaliza-la-escena · carga-de-tile.ts:392 — patrón prohibido: "formatDToWorld("` |
| … y en un fichero HERMANO del eximido | ✅ | N2: `nefan-html/src/ui/style-apply-vecino.ts` con la llamada → 76/77, `✖ … style-apply-vecino.ts:1`. El test sintético también lo cubre (`ui/style-apply-preview.ts` → 1 violación) |
| El test cubre los dos lados (regla vs. su contraria) | ✅ | N4: exención cambiada a glob `nefan-html/src/ui/*.ts` → el test nuevo se pone rojo (la tercera aserción distingue «exime al nombrado» de «exime a la carpeta»). N5: sin bloque `exceptions` → rojos el sintético Y el árbol real (`main.ts:807`). N6: `warn`+`max:2` → el sintético rojo (espera `[error]`) |
| `npm run verify` | ✅ | **2101/2101**, exit 0 (build + typecheck scripts/labs/tests + lint + test). El informe dice 2092: la diferencia es que este HEAD ya incluye PR-A (#453, +9 tests), no esta PR |
| `npm run deuda` sin crecer | ✅ | Ver arriba: baja 2, ninguna otra línea cambia (mismos 13 items listados, mismos 57 de mutación) |
| El `reason` describe lo que la función hace de verdad | ✅ con matiz | `addTileRaw`: sí es la única normalización local y entra por `loadSceneData ← loadSceneFile` (selector «Room»). Omite que también es el hook `window.__nefan.addTileRaw` del banco (`dev/nefan-hook.ts:294`; lo usan `qa/presupuesto-de-volumenes.mjs` y los guiones 58 y 68) — el comentario de la propia línea 807 sí dice «fixtures y benches» (H4). `StyleApplyController.plan`: exacto — es el batch «aplicar estilo» (celdas del atlas + roster de skins), no una «vista previa» como decían encargo y crítica; el ingeniero lo corrigió y tiene razón |

## Hallazgos

**H1 · importante (aceptado por el plan, pero sin candado) — la exención por FICHERO deja entrar una segunda llamada en `main.ts` o `style-apply.ts` sin que salte nada, y una exención cuyo fichero deja de llamar sigue viva.**
Repro N3 (desde el worktree, `nefan-core/`): `printf '\nconst __segunda = formatDToWorld({} as never);\n' >> ../nefan-html/src/main.ts && node --import tsx --test test/architecture.test.ts` → **77/77 verde** con DOS llamadas en `main.ts` (`grep -c` = 2). Repro N7: sustituir la llamada de `addTileRaw` por un cast (0 llamadas en `main.ts`) → **77/77 verde**, `excepciones-vivas` verde (solo mira que el fichero exista, `check.ts deadExceptions`). Qué esperaba: el issue pide nombrar «fichero y función»; hoy la función está nombrada en prosa y el checker cuenta cero-o-más por fichero. El plan §4 lo aceptó a sabiendas («la granularidad del checker es el fichero») y la severidad honesta es esta: no rompe nada hoy, pero es exactamente el hueco que la regla `warn`+`max:2` tenía («una tercera llamada podía entrar gratis») trasladado al interior de dos ficheros —y `main.ts` es el fichero más grande del cliente. Cubierto por el guion nuevo (abajo), que queda sin cablear en CI hasta que alguien lo decida.

**H2 · menor — `docs/arquitectura/vistas.md:188` sigue describiendo la regla como era antes de esta PR.**
Texto: «`solo-el-bridge-normaliza-la-escena` (warn con tope: la única asimetría admitida es la que el cliente necesita para las fixtures locales)». Ahora es `error` con dos puertas nombradas, y la segunda (el batch de estilo) no son «las fixtures locales». Es el documento que CLAUDE.md manda leer al tocar el cliente: quien lo lea sabrá menos que quien lea el JSON. Esperaba que la PR que cambia la regla cambiase la única prosa de arquitectura que la cita.

**H3 · menor — «cliente 2D» sobrevive en cuatro reglas vecinas del mismo fichero** (`arch-rules.json` líneas 116, 167, 226, 373 en `desc`; 184 en `why`). Fuera del criterio literal del issue (habla de ESTA regla), pero la decisión de la casa es barrido de prosa a cero cuando se retira algo, y el ingeniero lo vio (informe: «prosa histórica de otras reglas, fuera del alcance»). Dejarlo escrito para que alguien lo decida: cinco `sed` o un issue, no otra tanda que lo redescubra.

**H4 · menor — el comentario que precede a la puerta eximida contradice su `reason`.** `main.ts:805-806`: «API legacy (dropdown de fixtures, change_scene, saves sin migrar): mundo de UNA escena». `change_scene` no existe (solo vive en ese comentario, crítica de #405) y «saves sin migrar» murió con #336. El `reason` de la exención dice «fixtures del selector … no recibe escenas del motor» y omite el hook del banco (`__nefan.addTileRaw`, guion 68 paso 6 le pasa a propósito una escena SERVIDA para ver que `formatDToWorld` la rechaza). Dos textos a diez líneas describiendo la misma función de dos formas. Probablemente territorio de #405 (PR-F), pero la PR que nombra la función era el momento de dejar la línea diciendo lo mismo que el JSON.

## Guion nuevo — `qa/las-dos-puertas-de-formatdtoworld.mjs` (grupo **headless**, NO cableado en `ci.yml`)

Lo mecánico de este criterio que el candado de la PR NO cubre (H1): cuenta las llamadas fichero a fichero en `nefan-html/src/**/*.ts` con el mismo patrón que la regla, exige cero fuera de las exenciones, UNA en cada exención y que esa una esté dentro de la función nombrada entre acentos graves en el `reason` (con clase, si es `Clase.metodo`); además comprueba `severity: error`, sin `max`, y que `desc`/`why` no digan «2D». `node qa/las-dos-puertas-de-formatdtoworld.mjs` → **VERDE en `83cf0ca`** (8 ✔). En negativo, todos rojo con exit 1: G1 segunda llamada en `main.ts`; G2 `addTileRaw` deja de llamar («exención sin sujeto»); G3 llamada en `world/carga-de-tile.ts`; G4 `addTileRaw` renombrado («vive en `addTileRaw2`, no en `addTileRaw`»); G5 llamada movida de `plan()` a `run()`; G6 regla devuelta a `warn`/`max:2`/«2D» (3 ✖). Cero puertos, cero esperas, cero red; `architecture.test.ts` sigue 77/77 con el fichero presente. Si se prefiere que viva como `it()` en `architecture.test.ts` (que ya recorre el árbol real en el job `nefan-core`), la lógica es la misma; decidirlo es del ingeniero/coordinador, no mío.

## Workarounds usados

Ninguno sobre el producto. Para comparar `deuda` con `main` puse el JSON de `3a0f8ef` en el sitio y lo restauré con `git checkout` (árbol limpio comprobado). Todos los negativos (N1-N7, G1-G6) sobre ficheros reales, restaurados con `git checkout`; `git status` al final: solo el guion nuevo sin trackear.

## No probado

- CRAP (`npm run coverage`) no lo corrí: la PR no toca `src/` y `verify` no lo incluye; el 11 del informe es suyo, no mío.
- Mutación: nada que medir (`check.ts` en `sin_mutar`); no hay módulo afectado.

## Veredicto

**APTO CON HALLAZGOS.** El criterio de cierre literal de #411 se cumple: la regla nombra fichero y función, ya no dice «cliente 2D», es `error` sin `max`, el candado salta con una tercera puerta (otro fichero y hermano del eximido) y calla en las dos nombradas, `verify` 2101/2101 y la deuda baja 15 → 13 exactamente por las dos llamadas. Lo que queda (H1) es el límite que el plan aceptó: «por función» es prosa hasta que algo lo cuente — el guion adjunto lo cuenta, y cablearlo o llevarlo al test es decisión de quien cierre. H2 es la única prosa de arquitectura que cita la regla y quedó vieja; H3/H4 son barrido.
